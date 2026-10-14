#!/usr/bin/env node
// Run a Zaisma game server on your own Node server (Node 23.6 or later).
//
//   node packages/game-server/bin/node.js ./server.ts --game my-game --port 8080
//
// Players connect to wss://your-server/v1/rooms/<game>/<code>, the same address
// layout as Zaisma rooms, and prove who they are with Zaisma player passes,
// checked against the keys Zaisma publishes. Put it behind HTTPS (Caddy, nginx,
// a Cloudflare Tunnel) and add the address to your game's own servers in Zaisma.
import { WebSocketServer } from "ws";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { CLOSE_REFUSED, ERROR_TEXT, PassError, RoomCore, defineGameServer, errorMessage, isRoomCode, relay, roomData, roomInfo, verifyPass } from "../src/index.ts";

const HELLO_MS = 5000;
/** A reserved room nobody comes to is dropped after this. */
const RESERVED_MS = 10 * 60 * 1000;
/** A room that took players from another (room.moveTo) waits this long for them, like its held seats. */
const SEAT_MS = 60 * 1000;

/** Fetch Zaisma's published pass keys, caching them for an hour. */
export function keysFrom(jwksUrl) {
  let cache = null;
  return async (refresh = false) => {
    if (cache && !refresh && Date.now() - cache.at < 3600_000) return cache.keys;
    const res = await fetch(jwksUrl);
    if (!res.ok) throw new Error(`Couldn't load player pass keys from ${jwksUrl}`);
    cache = { at: Date.now(), keys: (await res.json()).keys };
    return cache.keys;
  };
}

/**
 * Start a server. Options: server (a game server object), game (its Zaisma slug),
 * port, origins (allowed page origins), issuer, keys (async () => public keys).
 */
export function startServer({ server, game, port, origins, issuer = "https://rooms.zaisma.com", keys }) {
  const definition = defineGameServer(server);
  const rooms = new Map(); // code -> { core, sockets: Map<playerId, ws>, timer }
  const wss = new WebSocketServer({ port, maxPayload: 64 * 1024 });

  // start: how a reserved room begins (room.reserve). It's made before its players hear the code,
  // closed to everyone but them.
  function roomFor(code, start) {
    let room = rooms.get(code);
    if (room) return room;
    const sockets = new Map();
    const core = new RoomCore(
      definition,
      {
        send: (id, text) => sockets.get(id)?.send(text),
        close: (id, code, reason) => sockets.get(id)?.close(code, reason),
        reserve: (next, how) => {
          // It waits for its players, then goes like any room once it's empty.
          wait(next, roomFor(next, how), RESERVED_MS);
          for (const id of how.players) sockets.get(id)?.send(JSON.stringify({ t: "move", code: next }));
        },
        // Another room here takes the players it wants; they're told to go, and this room hears who went.
        moveTo: (next, ask) => {
          const target = rooms.get(next);
          const answer = target && next !== code
            ? target.core.expect({ ...ask, from: code })
            : Promise.resolve({ moved: [], refused: ask.players.map((p) => ({ id: p.id, code: "no-room", reason: ERROR_TEXT["no-room"] })) });
          answer
            .then((a) => {
              if (target && a.moved.length) wait(next, target, SEAT_MS);
              for (const id of a.moved) sockets.get(id)?.send(JSON.stringify({ t: "move", code: next }));
              core.moved(next, a, ask.players);
            })
            .catch((err) => console.error("Couldn't move players:", err));
        },
      },
      { start },
    );
    room = { core, sockets, timer: null, waiting: false };
    if (definition.tickRate) {
      let last = Date.now();
      room.timer = setInterval(() => {
        const now = Date.now();
        core.tick((now - last) / 1000);
        last = now;
      }, 1000 / definition.tickRate);
    }
    rooms.set(code, room);
    return room;
  }

  /** Keep a room for players on their way, even if it empties meanwhile. */
  function wait(code, room, ms) {
    room.waiting = true;
    clearTimeout(room.waitTimer);
    room.waitTimer = setTimeout(() => {
      room.waiting = false;
      closeIfEmpty(code, room);
    }, ms);
    room.waitTimer.unref?.();
  }

  function closeIfEmpty(code, room) {
    if (rooms.get(code) !== room || room.waiting || (room.sockets.size > 0 && !room.core.ended)) return;
    if (room.timer) clearInterval(room.timer);
    rooms.delete(code);
  }

  wss.on("connection", (ws, req) => {
    const m = /^\/v1\/rooms\/([a-z0-9-]{1,40})\/([A-Z0-9]{6})$/.exec(req.url ?? "");
    const refuse = (code, message) => {
      ws.send(errorMessage(code, message));
      ws.close(CLOSE_REFUSED, code);
    };
    if (!m || m[1] !== game || !isRoomCode(m[2])) return ws.close(CLOSE_REFUSED, "Unknown room");
    if (origins.length && !origins.includes(req.headers.origin)) return ws.close(CLOSE_REFUSED, "Not allowed from here");
    const code = m[2];
    let playerId = null;
    const helloTimer = setTimeout(() => playerId || refuse("no-hello"), HELLO_MS);

    ws.on("message", async (data, isBinary) => {
      const text = isBinary ? null : data.toString();
      if (playerId) {
        const room = rooms.get(code);
        const err = text === null ? "bad-message" : room?.core.receive(playerId, text);
        if (err) ws.send(errorMessage(err));
        return;
      }
      let pass;
      let made = {};
      try {
        const msg = JSON.parse(text ?? "");
        if (msg.t !== "hello" || typeof msg.pass !== "string") return refuse("no-hello");
        pass = msg.pass;
        if (msg.room && typeof msg.room === "object") made = { ...(msg.room.listed === false ? { listed: false } : {}), ...roomInfo(msg.room) };
        const data = roomData(msg.data);
        if (!data.ok) return refuse("too-big");
        made.data = data.data;
      } catch {
        return refuse("no-hello");
      }
      let claims;
      try {
        claims = await verifyPass(pass, await keys(), { game, issuer }).catch(async (err) => {
          // A new key may have been published since we cached them.
          if (err instanceof PassError && err.code === "unknown-key") return verifyPass(pass, await keys(true), { game, issuer });
          throw err;
        });
      } catch (err) {
        if (err instanceof PassError) return refuse("bad-pass");
        throw err;
      }
      clearTimeout(helloTimer);
      const room = roomFor(code);
      // The room's rules and the game's canJoin, before anyone hears about this player.
      const admitted = await room.core.admit({ id: claims.sub, name: claims.name }, made.data);
      if (!admitted.ok) {
        closeIfEmpty(code, room);
        return refuse(admitted.code, admitted.message);
      }
      room.sockets.get(claims.sub)?.close(CLOSE_REFUSED, "Joined from somewhere else");
      room.sockets.set(claims.sub, ws);
      // Rooms here aren't in Zaisma's room lists, but listed, open and closed work the same for the game.
      const result = room.core.join({ id: claims.sub, name: claims.name }, made);
      if (!result.ok) {
        room.sockets.delete(claims.sub);
        closeIfEmpty(code, room);
        return refuse(result.code, result.message);
      }
      playerId = claims.sub;
      room.waiting = false;
    });

    ws.on("close", () => {
      clearTimeout(helloTimer);
      const room = rooms.get(code);
      if (!room || !playerId || room.sockets.get(playerId) !== ws) return;
      room.sockets.delete(playerId);
      room.core.leave(playerId);
      closeIfEmpty(code, room);
    });
  });

  return { wss, rooms, close: () => new Promise((done) => { for (const r of rooms.values()) if (r.timer) clearInterval(r.timer); wss.close(done); }) };
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const file = process.argv[2];
  const game = arg("game");
  if (!file || !game) {
    console.log("Usage: node bin/node.js <server.ts | relay> --game <slug> [--port 8080] [--origin https://<slug>.zaismausercontent.com]");
    process.exit(1);
  }
  const server = file === "relay" ? relay : (await import(pathToFileURL(resolve(file)).href)).default;
  const port = Number(arg("port", "8080"));
  const origins = (arg("origin", `https://${game}.zaismausercontent.com`) ?? "").split(",").filter(Boolean);
  startServer({ server, game, port, origins, keys: keysFrom(arg("jwks", "https://rooms.zaisma.com/.well-known/jwks.json")) });
  console.log(`Game server for "${game}" on port ${port}. Players connect to /v1/rooms/${game}/<code>.`);
}
