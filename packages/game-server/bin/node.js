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
import { CLOSE_REFUSED, ERROR_TEXT, PassError, RoomCore, clientIdleTimeoutSec, defineGameServer, errorMessage, isRoomCode, relay, roomData, roomNaming, verifyPass } from "../src/index.ts";

const HELLO_MS = 5000;
/** How often rooms check on their players (idle, hidden, held seats), and drop connections that stopped answering. */
const SWEEP_MS = 15 * 1000;
/** A connection with no ping or message for this long is dropped. Games ping every 25 seconds (once a minute while hidden). */
const DEAD_MS = 75 * 1000;
/** A reserved room nobody comes to is dropped after this. */
const RESERVED_MS = 10 * 60 * 1000;
/** A room that took players from another (room.moveTo) waits this long for them, like its held seats. */
const SEAT_MS = 60 * 1000;

/** Fetch Zaisma's published pass keys, caching them for an hour: a loadPublicKeys for startServer. */
export function publicKeysFrom(jwksUrl) {
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
 * Start a server. Options: gameServer (a game server object), gameSlug (its Zaisma slug), port,
 * allowedOrigins (page origins players may connect from; [] for any), issuer, and loadPublicKeys
 * (async (refresh) => Zaisma's public keys, like publicKeysFrom(jwksUrl)). Anything else is refused.
 */
export function startServer(options) {
  const allowed = ["gameServer", "gameSlug", "port", "allowedOrigins", "issuer", "loadPublicKeys"];
  const unknown = Object.keys(options).filter((name) => !allowed.includes(name));
  if (unknown.length) throw new Error(`startServer doesn't take ${unknown.join(", ")}. It takes ${allowed.join(", ")}.`);
  const { gameServer, gameSlug: game, port, allowedOrigins: origins, issuer = "https://rooms.zaisma.com", loadPublicKeys: keys } = options;
  const definition = defineGameServer(gameServer);
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
          // It waits for its players, then goes like any room once it's empty. It knows where it came from (awayMode "send_to_lobby").
          wait(next, roomFor(next, { ...how, lobby: code }), RESERVED_MS);
          for (const id of how.players) sockets.get(id)?.send(JSON.stringify({ type: "move", roomCode: next }));
        },
        // Another room here takes the players it wants; they're told to go, and this room hears who went.
        moveTo: (next, ask) => {
          const target = rooms.get(next);
          const answer = target && next !== code
            ? target.core.expect({ ...ask, from: code })
            : Promise.resolve({ moved: [], refused: ask.players.map((p) => ({ id: p.id, code: "no_room", reason: ERROR_TEXT.no_room })) });
          answer
            .then((a) => {
              if (target && a.moved.length) wait(next, target, SEAT_MS);
              for (const id of a.moved) sockets.get(id)?.send(JSON.stringify({ type: "move", roomCode: next }));
              core.moved(next, a, ask.players);
            })
            .catch((err) => console.error("Couldn't move players:", err));
        },
      },
      { start },
    );
    room = { core, sockets, timer: null, waiting: false };
    rooms.set(code, room);
    return room;
  }

  /** A real-time room ticks while someone's playing, and stops while everyone's walked away. */
  function pace(room) {
    if (!definition.ticksPerSec) return;
    if (room.core.playing > 0 && !room.core.ended) {
      if (room.timer) return;
      let last = Date.now();
      room.timer = setInterval(() => {
        const now = Date.now();
        room.core.tick((now - last) / 1000);
        last = now;
      }, 1000 / definition.ticksPerSec);
    } else if (room.timer) {
      clearInterval(room.timer);
      room.timer = null;
    }
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

  // A room with nobody connected stays while it holds seats, so players who lost their connection can come back.
  function closeIfEmpty(code, room) {
    if (rooms.get(code) !== room || room.waiting || (!room.core.ended && (room.sockets.size > 0 || room.core.heldSeats > 0))) return;
    if (room.timer) clearInterval(room.timer);
    rooms.delete(code);
  }

  // Check on every room's players: connections that stopped answering, idle and hidden players, held seats that ran out.
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      for (const ws of room.sockets.values()) if (now - ws.zaismaSeen > DEAD_MS) ws.terminate();
      room.core.sweep();
      pace(room);
      closeIfEmpty(code, room);
    }
  }, SWEEP_MS);
  sweeper.unref?.();

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
    const helloTimer = setTimeout(() => playerId || refuse("no_hello"), HELLO_MS);
    ws.zaismaSeen = Date.now();

    ws.on("message", async (data, isBinary) => {
      const text = isBinary ? null : data.toString();
      ws.zaismaSeen = Date.now();
      // Games ping every 25 seconds or so, so a connection that stops answering can be dropped.
      if (text === "ping") return ws.send("pong");
      if (playerId) {
        const room = rooms.get(code);
        const err = text === null ? "bad_message" : room?.core.receive(playerId, text);
        if (err) ws.send(errorMessage(err));
        if (room) pace(room);
        return;
      }
      let pass;
      let made = {};
      try {
        const hello = JSON.parse(text ?? "");
        if (hello.type !== "hello" || typeof hello.pass !== "string") return refuse("no_hello");
        pass = hello.pass;
        if (hello.newRoom && typeof hello.newRoom === "object") made = { ...(hello.newRoom.isListed === false ? { isListed: false } : {}), ...roomNaming(hello.newRoom) };
        const idleTimeoutSec = clientIdleTimeoutSec(hello.idleCheck, hello.idleTimeoutSec);
        if (idleTimeoutSec !== undefined) made.idleTimeoutSec = idleTimeoutSec;
        const joinData = roomData(hello.joinData);
        if (!joinData.ok) return refuse("too_big");
        made.joinData = joinData.data;
      } catch {
        return refuse("no_hello");
      }
      let claims;
      try {
        claims = await verifyPass(pass, await keys(), { gameSlug: game, issuer }).catch(async (err) => {
          // A new key may have been published since we cached them.
          if (err instanceof PassError && err.code === "unknown_key") return verifyPass(pass, await keys(true), { gameSlug: game, issuer });
          throw err;
        });
      } catch (err) {
        if (err instanceof PassError) return refuse("bad_pass");
        throw err;
      }
      clearTimeout(helloTimer);
      const room = roomFor(code);
      // The room's rules and the game's canJoin, before anyone hears about this player.
      const admitted = await room.core.admit({ id: claims.sub, name: claims.name }, made.joinData);
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
      pace(room);
    });

    // Closed on purpose (1000, or 1001 as a page goes away), or lost: then the room holds the seat a while.
    ws.on("close", (closeCode) => {
      clearTimeout(helloTimer);
      const room = rooms.get(code);
      if (!room || !playerId || room.sockets.get(playerId) !== ws) return;
      room.sockets.delete(playerId);
      room.core.leave(playerId, closeCode === 1000 || closeCode === 1001 ? "left" : "connection_lost");
      pace(room);
      closeIfEmpty(code, room);
    });
  });

  const close = () =>
    new Promise((done) => {
      clearInterval(sweeper);
      for (const r of rooms.values()) if (r.timer) clearInterval(r.timer);
      wss.close(done);
    });
  return { wss, rooms, close };
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
  const gameServer = file === "relay" ? relay : (await import(pathToFileURL(resolve(file)).href)).default;
  const port = Number(arg("port", "8080"));
  const allowedOrigins = (arg("origin", `https://${game}.zaismausercontent.com`) ?? "").split(",").filter(Boolean);
  startServer({ gameServer, gameSlug: game, port, allowedOrigins, loadPublicKeys: publicKeysFrom(arg("jwks", "https://rooms.zaisma.com/.well-known/jwks.json")) });
  console.log(`Game server for "${game}" on port ${port}. Players connect to /v1/rooms/${game}/<code>.`);
}
