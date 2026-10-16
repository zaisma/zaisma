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
import { ERROR_TEXT, PassError, REFUSED_CLOSE_CODE, RoomCore, checkRoomData, clientIdle, defineGameServer, errorMessage, isRoomCode, relay, tidyRoomInfo, verifyPass } from "../src/index.ts";

const HELLO_MS = 5000;
/** How often rooms check on their players (idle, hidden, held seats), and drop connections that stopped answering. */
const SWEEP_MS = 15 * 1000;
/** A connection with no ping or message for this long is dropped. Games ping every 25 seconds (once a minute while hidden). */
const DEAD_MS = 75 * 1000;
/** A reserved room nobody comes to is dropped after this. */
const RESERVED_MS = 10 * 60 * 1000;
/** A room that took players from another (room.moveTo) waits this long for them, like its held seats. */
const SEAT_MS = 60 * 1000;

/** Fetch Zaisma's published pass keys, caching them for an hour. */
export function keysFrom(jwksUrl) {
  let cache = null;
  return async (refresh = false) => {
    if (cache && !refresh && Date.now() - cache.fetchedAtMs < 3600_000) return cache.keys;
    const response = await fetch(jwksUrl);
    if (!response.ok) throw new Error(`Couldn't load player pass keys from ${jwksUrl}`);
    cache = { fetchedAtMs: Date.now(), keys: (await response.json()).keys };
    return cache.keys;
  };
}

/**
 * Look up accounts' public profiles at Zaisma (<issuer>/v1/players/<id>), caching each for 5 minutes.
 * An account's pass proves only who the player is; its name comes from here. Null when no account
 * has that ID (deleted since its pass was made).
 */
export function profilesFrom(issuer) {
  const cache = new Map();
  return async (playerId) => {
    const cached = cache.get(playerId);
    if (cached && Date.now() - cached.fetchedAtMs < 300_000) return cached.profile;
    const response = await fetch(`${issuer}/v1/players/${encodeURIComponent(playerId)}`);
    if (response.status !== 200 && response.status !== 404) throw new Error(`Couldn't look up player ${playerId} at ${issuer}`);
    const profile = response.status === 200 ? (await response.json()).player : null;
    if (cache.size > 10_000) cache.clear();
    cache.set(playerId, { fetchedAtMs: Date.now(), profile });
    return profile;
  };
}

/**
 * Start a server. Options: server (a game server object), game (its Zaisma slug),
 * port, origins (allowed page origins), issuer, keys (async () => public keys),
 * profiles (async (playerId) => an account's public profile or null).
 */
export function startServer({ server, game, port, origins, issuer = "https://rooms.zaisma.com", keys, profiles = profilesFrom(issuer) }) {
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
          // It waits for its players, then goes like any room once it's empty. It knows where it came from (awayMode "lobby").
          wait(next, roomFor(next, { ...how, lobbyRoomCode: code }), RESERVED_MS);
          for (const id of how.playerIds) sockets.get(id)?.send(JSON.stringify({ type: "move", roomCode: next }));
        },
        // Another room here takes the players it wants; they're told to go, and this room hears who went.
        moveTo: (next, ask) => {
          const target = rooms.get(next);
          const answer = target && next !== code
            ? target.core.expect({ ...ask, fromRoomCode: code })
            : Promise.resolve({ movedPlayerIds: [], refusals: ask.players.map((player) => ({ playerId: player.id, code: "no_room", message: ERROR_TEXT.no_room })) });
          answer
            .then((moveAnswer) => {
              if (target && moveAnswer.movedPlayerIds.length) wait(next, target, SEAT_MS);
              for (const id of moveAnswer.movedPlayerIds) sockets.get(id)?.send(JSON.stringify({ type: "move", roomCode: next }));
              core.moved(next, moveAnswer, ask.players);
            })
            .catch((error) => console.error("Couldn't move players:", error));
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
    if (room.core.playingCount > 0 && !room.core.ended) {
      if (room.timer) return;
      let lastTickAtMs = Date.now();
      room.timer = setInterval(() => {
        const nowMs = Date.now();
        room.core.tick((nowMs - lastTickAtMs) / 1000);
        lastTickAtMs = nowMs;
      }, 1000 / definition.ticksPerSec);
    } else if (room.timer) {
      clearInterval(room.timer);
      room.timer = null;
    }
  }

  /** Keep a room for players on their way, even if it empties meanwhile. */
  function wait(code, room, durationMs) {
    room.waiting = true;
    clearTimeout(room.waitTimer);
    room.waitTimer = setTimeout(() => {
      room.waiting = false;
      closeIfEmpty(code, room);
    }, durationMs);
    room.waitTimer.unref?.();
  }

  // A room with nobody connected stays while it holds seats, so players who lost their connection can come back.
  function closeIfEmpty(code, room) {
    if (rooms.get(code) !== room || room.waiting || (!room.core.ended && (room.sockets.size > 0 || room.core.heldSeatCount > 0))) return;
    if (room.timer) clearInterval(room.timer);
    rooms.delete(code);
  }

  // Check on every room's players: connections that stopped answering, idle and hidden players, held seats that ran out.
  const sweeper = setInterval(() => {
    const nowMs = Date.now();
    for (const [code, room] of rooms) {
      for (const ws of room.sockets.values()) if (nowMs - ws.zaismaSeenAtMs > DEAD_MS) ws.terminate();
      room.core.sweep();
      pace(room);
      closeIfEmpty(code, room);
    }
  }, SWEEP_MS);
  sweeper.unref?.();

  wss.on("connection", (ws, request) => {
    const address = /^\/v1\/rooms\/([a-z0-9-]{1,40})\/([A-Z0-9]{6})$/.exec(request.url ?? "");
    const refuse = (code, message) => {
      ws.send(errorMessage(code, message));
      ws.close(REFUSED_CLOSE_CODE, code);
    };
    if (!address || address[1] !== game || !isRoomCode(address[2])) return ws.close(REFUSED_CLOSE_CODE, "Unknown room");
    if (origins.length && !origins.includes(request.headers.origin)) return ws.close(REFUSED_CLOSE_CODE, "Not allowed from here");
    const code = address[2];
    let playerId = null;
    const helloTimer = setTimeout(() => playerId || refuse("no_hello"), HELLO_MS);
    ws.zaismaSeenAtMs = Date.now();

    ws.on("message", async (received, isBinary) => {
      const text = isBinary ? null : received.toString();
      ws.zaismaSeenAtMs = Date.now();
      // Games ping every 25 seconds or so, so a connection that stops answering can be dropped.
      if (text === "ping") return ws.send("pong");
      if (playerId) {
        const room = rooms.get(code);
        const errorCode = text === null ? "bad_message" : room?.core.receive(playerId, text);
        if (errorCode) ws.send(errorMessage(errorCode));
        if (room) pace(room);
        return;
      }
      let pass;
      let made = {};
      try {
        const hello = JSON.parse(text ?? "");
        if (hello.type !== "hello" || typeof hello.pass !== "string") return refuse("no_hello");
        pass = hello.pass;
        if (hello.room && typeof hello.room === "object") made = { ...(hello.room.isListed === false ? { isListed: false } : {}), ...tidyRoomInfo(hello.room) };
        made.clientIdle = clientIdle(hello);
        const checked = checkRoomData(hello.joinData);
        if (!checked.isValid) return refuse("too_big");
        made.joinData = checked.checkedData;
      } catch {
        return refuse("no_hello");
      }
      let claims;
      try {
        claims = await verifyPass(pass, await keys(), { game, issuer }).catch(async (error) => {
          // A new key may have been published since we cached them.
          if (error instanceof PassError && error.code === "unknown_key") return verifyPass(pass, await keys(true), { game, issuer });
          throw error;
        });
      } catch (error) {
        if (error instanceof PassError) return refuse("bad_pass");
        throw error;
      }
      // An account's pass is proof only: its name comes from its public profile, and a deleted account's pass stops working.
      const name = claims.kind === "account" ? (await profiles(claims.sub))?.name : claims.name;
      if (!name) return refuse("bad_pass");
      const player = { id: claims.sub, name, kind: claims.kind };
      clearTimeout(helloTimer);
      const room = roomFor(code);
      // The room's rules and the game's canJoin, before anyone hears about this player.
      const admitted = await room.core.admit(player, made.joinData);
      if (!admitted.isAllowed) {
        closeIfEmpty(code, room);
        return refuse(admitted.code, admitted.message);
      }
      room.sockets.get(claims.sub)?.close(REFUSED_CLOSE_CODE, "Joined from somewhere else");
      room.sockets.set(claims.sub, ws);
      // Rooms here aren't in Zaisma's room lists, but listed, open and closed work the same for the game.
      const joined = room.core.join(player, made);
      if (!joined.isAllowed) {
        room.sockets.delete(claims.sub);
        closeIfEmpty(code, room);
        return refuse(joined.code, joined.message);
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
      room.core.leave(playerId, closeCode === 1000 || closeCode === 1001 ? "left" : "lost");
      pace(room);
      closeIfEmpty(code, room);
    });
  });

  const close = () =>
    new Promise((done) => {
      clearInterval(sweeper);
      for (const room of rooms.values()) if (room.timer) clearInterval(room.timer);
      wss.close(done);
    });
  return { wss, rooms, close };
}

function flag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const file = process.argv[2];
  const game = flag("game");
  if (!file || !game) {
    console.log("Usage: node bin/node.js <server.ts | relay> --game <slug> [--port 8080] [--origin https://<slug>.zaismausercontent.com]");
    process.exit(1);
  }
  const server = file === "relay" ? relay : (await import(pathToFileURL(resolve(file)).href)).default;
  const portNumber = Number(flag("port", "8080"));
  const origins = (flag("origin", `https://${game}.zaismausercontent.com`) ?? "").split(",").filter(Boolean);
  startServer({ server, game, port: portNumber, origins, keys: keysFrom(flag("jwks", "https://rooms.zaisma.com/.well-known/jwks.json")) });
  console.log(`Game server for "${game}" on port ${portNumber}. Players connect to /v1/rooms/${game}/<code>.`);
}
