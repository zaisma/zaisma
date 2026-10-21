#!/usr/bin/env node
// Run a Zaisma game server on your own Node server (Node 23.6 or later).
//
//   node packages/game-server/bin/node.js ./server.ts --game my-game --port 8080
//
// Players connect to wss://your-server/v1/rooms/<game>/<code>, the same address
// layout as Zaisma rooms, and prove who they are with Zaisma player passes,
// checked against the keys Zaisma publishes. Put it behind HTTPS (Caddy, nginx,
// a Cloudflare Tunnel) and add the address to your game's own servers (own_server_urls, or zaisma own-servers).
// The game's requests (onRequest) come to POST /v1/requests/<game> on the same port, and its
// schedules (onSchedule) run while it's up, at the minutes their crons give in UTC. A Zaisma webhook
// whose endpoint_url is https://your-server/v1/webhooks reaches onWebhook, checked with its signing
// secret in the ZAISMA_WEBHOOK_SIGNING_SECRET environment variable.
// The game's database (room.database) is a local SQLite file, --database, made on first use.
// Its rooms' states are another, --room-state, so a restarted server brings its matches back (onRestored).
// Its secrets (room.secrets, server.secrets) are this process's environment variables, and it calls
// other servers with plain fetch(), with no list: on your own server nothing stands in between.
import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { ERROR_TEXT, DATABASE_LIMITS, NO_ANSWER_CLOSE_CODE, PassError, REFUSED_CLOSE_CODE, REQUEST_ERROR_HTTP_STATUS, REQUEST_LIMITS, ROOM_LIMITS, WEBHOOK_LIMITS, RoomCore, restoreInfoOf, areFriends, hasBlockBetween, answerDatabase, answerRequest, checkBatch, checkPlayerId, eraseRefused, eraseStatements, tablesFromColumns, TABLE_COLUMNS_SQL, startSchedules, checkRoomData, checkStatement, clientIdle, defineGameServer, errorMessage, isRoomCode, plainRow, readDatabaseAnswer, readRequestBody, relay, requestError, runWebhook, tidyRoomInfo, tooManyRows, verifyPass, verifyWebhook } from "../src/index.ts";

const HELLO_MS = 5000;
/**
 * How often rooms check on their players (idle, hidden, held seats, players whose time to reconnect ran
 * out), and drop connections that stopped answering. Rooms that tick also check reconnects every tick.
 */
const SWEEP_MS = 5 * 1000;
/** A connection with no ping or message for this long is dropped. Games ping every 25 seconds (once a minute while hidden). */
const DEAD_MS = 75 * 1000;
/** The most of a request read: the request, its pass and the JSON around them. */
const MAXIMUM_REQUEST_BODY_SIZE_BYTES = REQUEST_LIMITS.maximumRequestSizeBytes + REQUEST_LIMITS.maximumPassSizeBytes + 1024;
/** A reserved room nobody comes to is dropped after this. */
const RESERVED_MS = 10 * 60 * 1000;
/** A room that took players from another (room.moveTo) waits this long for them, like its held seats. */
const SEAT_MS = 60 * 1000;
/** A room that empties keeps its saved state this long, like Zaisma's rooms, so players coming back find it as it was. */
const KEEP_EMPTY_MS = 24 * 3600 * 1000;
/** How often saved states of rooms that emptied over a day ago are deleted. */
const ROOM_STATE_SWEEP_MS = 3600 * 1000;

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
 * The game's database (room.database) in a local SQLite file, opened on first use: the same calls
 * as in Zaisma rooms, checked the same way, each call in one transaction. Zaisma's free limits don't
 * apply here; the file is yours. Copy it to move the data, or open it with any SQLite tool.
 */
export function localDatabase(file) {
  let opened = null;
  const open = async () => {
    // Loaded only when a game uses its database, so games without one never see Node's SQLite warning.
    opened ??= import("node:sqlite").then(({ DatabaseSync }) => new DatabaseSync(file));
    return opened;
  };
  const run = (database, statements) => {
    database.exec("BEGIN");
    try {
      const results = statements.map(({ sql, values }) => {
        const rows = [];
        for (const row of database.prepare(sql).iterate(...values)) {
          if (rows.length >= DATABASE_LIMITS.maximumRowCount) throw tooManyRows();
          rows.push(plainRow(row));
        }
        return rows;
      });
      database.exec("COMMIT");
      return results;
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // SQLite already ended the transaction.
      }
      throw error;
    }
  };
  return {
    query: async (sql, values) => {
      const database = await open();
      return readDatabaseAnswer(answerDatabase(() => run(database, [checkStatement(sql, values)])[0]));
    },
    batch: async (statements) => {
      const database = await open();
      return readDatabaseAnswer(answerDatabase(() => run(database, checkBatch(statements))));
    },
    // The same rule as in Zaisma rooms (eraseStatements), in one transaction. A file that isn't there yet has nothing to erase.
    erasePlayer: async (playerId) => {
      const checkedPlayerId = readDatabaseAnswer(answerDatabase(() => checkPlayerId(playerId)));
      if (!opened && !existsSync(file)) return [];
      const database = await open();
      return readDatabaseAnswer(
        answerDatabase(() => {
          const statements = eraseStatements(tablesFromColumns(database.prepare(TABLE_COLUMNS_SQL).all()), checkedPlayerId);
          database.exec("BEGIN");
          try {
            const erasedTables = statements.map((statement) => {
              try {
                return { tableName: statement.tableName, erasedRowCount: Number(database.prepare(statement.sql).run(...statement.values).changes) };
              } catch (error) {
                throw eraseRefused(statement.tableName, error);
              }
            });
            database.exec("COMMIT");
            return erasedTables;
          } catch (error) {
            try {
              database.exec("ROLLBACK");
            } catch {
              // SQLite already ended the transaction.
            }
            throw error;
          }
        }),
      );
    },
  };
}

/**
 * The rooms' states in a local SQLite file (--room-state), made the first time a room saves: a
 * real-time room's every stateSaveIntervalSec and a turn-based room's after each change, so a
 * restarted server brings its matches back (onRestored). Apart from the game's database, which is the
 * game's own data: these are the runner's. One row a room, as JSON.
 */
export function localRoomStates(file) {
  let database = null;
  const open = () => {
    if (database) return database;
    // Loaded only once a room saves, so a server that never does never sees Node's SQLite warning.
    const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
    database = new DatabaseSync(file);
    database.exec("CREATE TABLE IF NOT EXISTS room_states (room_code TEXT PRIMARY KEY, state_json TEXT NOT NULL, match_players_json TEXT NOT NULL, saved_room_json TEXT NOT NULL, saved_at_ms INTEGER NOT NULL)");
    return database;
  };
  const isThere = () => database !== null || (file !== ":memory:" && existsSync(file));
  return {
    /** A room's saved state, the players in its match and the room, and when it was saved; null if it has none. */
    read(roomCode) {
      if (!isThere()) return null;
      const row = open().prepare("SELECT state_json, match_players_json, saved_room_json, saved_at_ms FROM room_states WHERE room_code = ?").get(roomCode);
      if (!row) return null;
      return { stateJson: row.state_json, matchPlayers: JSON.parse(row.match_players_json), savedRoom: JSON.parse(row.saved_room_json), savedAtMs: Number(row.saved_at_ms) };
    },
    write(roomCode, { stateJson, matchPlayers, savedRoom, savedAtMs }) {
      open()
        .prepare("INSERT INTO room_states (room_code, state_json, match_players_json, saved_room_json, saved_at_ms) VALUES (?, ?, ?, ?, ?) ON CONFLICT(room_code) DO UPDATE SET state_json = excluded.state_json, match_players_json = excluded.match_players_json, saved_room_json = excluded.saved_room_json, saved_at_ms = excluded.saved_at_ms")
        .run(roomCode, stateJson, JSON.stringify(matchPlayers), JSON.stringify(savedRoom), savedAtMs);
    },
    remove(roomCode) {
      if (isThere()) open().prepare("DELETE FROM room_states WHERE room_code = ?").run(roomCode);
    },
    /** Delete the states saved before then, except those of rooms still running. */
    removeOlder(beforeMs, runningRoomCodes) {
      if (!isThere()) return;
      const running = [...runningRoomCodes];
      open()
        .prepare(`DELETE FROM room_states WHERE saved_at_ms < ?${running.length ? ` AND room_code NOT IN (${running.map(() => "?").join(", ")})` : ""}`)
        .run(beforeMs, ...running);
    },
  };
}

/**
 * Start a server. Options: server (a game server object), game (its Zaisma slug),
 * port, origins (allowed page origins), issuer, keys (async () => public keys),
 * profiles (async (playerId) => an account's public profile or null), database (room.database
 * and server.database; by default a local file, zaisma-database.sqlite, made the first time the game uses it),
 * secrets (room.secrets and server.secrets; by default this process's environment variables),
 * webhookSigningSecret (the whsec_ secret of the webhook whose events come to /v1/webhooks; by default
 * the ZAISMA_WEBHOOK_SIGNING_SECRET environment variable), roomStateFile (where rooms save their
 * states, so a restart brings matches back; by default zaisma-room-states.sqlite, null to keep none).
 */
export function startServer({ server, game, port, origins, issuer = "https://rooms.zaisma.com", keys, profiles = profilesFrom(issuer), database = localDatabase("zaisma-database.sqlite"), secrets = secretsFromEnvironment(), webhookSigningSecret = process.env.ZAISMA_WEBHOOK_SIGNING_SECRET, roomStateFile = "zaisma-room-states.sqlite" }) {
  const definition = defineGameServer(server);
  const roomStates = roomStateFile === null ? null : localRoomStates(roomStateFile);
  const stateSaveIntervalMs = (definition.stateSaveIntervalSec ?? ROOM_LIMITS.defaultStateSaveIntervalSec) * 1000;
  // Schedules run while this server is up; one that's down when a run is due misses that run.
  const schedules = startSchedules(definition, { database, secrets }, (run, failure) => console.error(`Game server error in onSchedule ("${run.name}", due ${run.scheduledAt}):`, failure));
  const rooms = new Map(); // code -> { core, sockets: Map<playerId, ws>, timer }
  const httpServer = createServer((request, response) => answerHttp(request, response));
  const wss = new WebSocketServer({ server: httpServer, maxPayload: 64 * 1024 });
  httpServer.listen(port);

  /**
   * Who a pass is: checked against Zaisma's keys (fetched again once when its key is new), with an
   * account's name from its public profile, and the pass's claims, for blocks between players. Null
   * for an account deleted since; PassError for a bad pass.
   */
  async function playerFrom(pass) {
    const claims = await verifyPass(pass, await keys(), { game, issuer }).catch(async (error) => {
      // A new key may have been published since we cached them.
      if (error instanceof PassError && error.code === "unknown_key") return verifyPass(pass, await keys(true), { game, issuer });
      throw error;
    });
    // An account's pass is proof only: its name comes from its public profile, and a deleted account's pass stops working.
    const name = claims.kind === "account" ? (await profiles(claims.sub))?.name : claims.name;
    return name ? { player: { id: claims.sub, name, kind: claims.kind }, claims } : null;
  }

  // Requests from the game to onRequest, outside any room: POST /v1/requests/<game> with { pass, request },
  // sent as text/plain JSON so browsers need no preflight. Answers { answer } or { error: { code, message } }.
  function answerHttp(request, response) {
    if (request.url === "/v1/webhooks") return answerWebhook(request, response);
    const origin = request.headers.origin;
    const isAllowed = !origins.length || origins.includes(origin);
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", ...(isAllowed && origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}) };
    const reply = (httpStatus, body) => {
      response.writeHead(httpStatus, headers);
      response.end(JSON.stringify(body));
    };
    const fail = (code, message) => reply(REQUEST_ERROR_HTTP_STATUS[code], requestError(code, message));
    if (request.method === "OPTIONS") {
      response.writeHead(204, { ...headers, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type" });
      return response.end();
    }
    if (request.method !== "POST" || request.url !== `/v1/requests/${game}`) {
      response.writeHead(404, { "Content-Type": "text/plain" });
      return response.end("Not found");
    }
    if (!isAllowed) return fail("bad_origin");
    let text = "";
    let isTooBig = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (isTooBig) return;
      text += chunk;
      if (text.length > MAXIMUM_REQUEST_BODY_SIZE_BYTES) isTooBig = true;
    });
    request.on("end", async () => {
      try {
        if (isTooBig) return fail("too_big");
        const body = readRequestBody(text);
        if ("code" in body) return fail(body.code);
        let checked;
        try {
          checked = await playerFrom(body.pass);
        } catch (error) {
          if (error instanceof PassError) return fail("bad_pass");
          throw error;
        }
        if (!checked) return fail("bad_pass");
        const outcome = await answerRequest(definition, checked.player, body.request, { database, secrets });
        if ("answer" in outcome) return reply(200, { answer: outcome.answer });
        if (outcome.code === "game_server_error") console.error("Game server error in onRequest:", outcome.failure);
        fail(outcome.code);
      } catch (error) {
        console.error("Couldn't answer a request:", error);
        fail("busy");
      }
    });
  }

  // Events from a Zaisma webhook whose endpoint_url is this server's /v1/webhooks: signed the Standard
  // Webhooks way, checked with its signing secret, then handed to onWebhook. An account_deleted event
  // first erases the player from the local database when the event's game says
  // deleted_account_erase_enabled, the same switch Zaisma follows for its own databases. Answers 204 when
  // that and onWebhook finished, so Zaisma counts it delivered; anything else is tried again later.
  function answerWebhook(request, response) {
    const reply = (httpStatus, message) => {
      response.writeHead(httpStatus, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
      response.end(message);
    };
    if (request.method !== "POST") return reply(405, "Webhooks are POSTed.");
    if (!webhookSigningSecret) return reply(503, "Set ZAISMA_WEBHOOK_SIGNING_SECRET to the webhook's signing_secret to take its events.");
    let text = "";
    let isTooBig = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (isTooBig) return;
      text += chunk;
      if (text.length > WEBHOOK_LIMITS.maximumEventSizeBytes) isTooBig = true;
    });
    request.on("end", async () => {
      try {
        if (isTooBig) return reply(413, "The event is too big.");
        const header = (name) => (typeof request.headers[name] === "string" ? request.headers[name] : null);
        const checked = await verifyWebhook(webhookSigningSecret, { webhookId: header("webhook-id"), webhookTimestamp: header("webhook-timestamp"), webhookSignature: header("webhook-signature") }, text);
        if ("failure" in checked) return reply(401, checked.failure);
        const event = checked.event;
        const isAccountDeleted = event.kind === "account_deleted";
        if (isAccountDeleted && event.game?.deleted_account_erase_enabled === true) {
          try {
            await database.erasePlayer(event.player_id);
          } catch (error) {
            console.error(`Couldn't erase ${event.player_id} from the game database (${event.id}):`, error);
            return reply(500, "Erasing the player failed; Zaisma tries the event again later.");
          }
        }
        if (typeof definition.onWebhook !== "function") return isAccountDeleted ? reply(204, "") : reply(404, "This game server has no onWebhook.");
        const outcome = await runWebhook(definition, event, { database, secrets });
        if ("failure" in outcome) {
          console.error(`Game server error in onWebhook (${checked.event.kind}, ${checked.event.id}):`, outcome.failure);
          return reply(500, "onWebhook failed; Zaisma tries the event again later.");
        }
        reply(204, "");
      } catch (error) {
        console.error("Couldn't take a webhook:", error);
        reply(500, "Couldn't take the event.");
      }
    });
  }

  // start: how a reserved room begins (room.reserve). It's made before its players hear the code,
  // closed to everyone but them. A room with a saved state (a restart) comes back with it instead.
  function roomFor(code, start) {
    let room = rooms.get(code);
    if (room) return room;
    const saved = start ? null : readSaved(code);
    const sockets = new Map();
    const core = new RoomCore(
      definition,
      {
        database,
        secrets,
        send: (id, text) => sockets.get(id)?.send(text),
        sendBytes: (id, frame) => sockets.get(id)?.send(frame, { binary: true }),
        close: (id, code, reason) => {
          const ws = sockets.get(id);
          ws?.close(code, reason);
          // A connection too far behind: its close frame would wait behind the backlog it can't read, so free it now (the game sees 1006 and reconnects).
          if (code === NO_ANSWER_CLOSE_CODE) ws?.terminate();
        },
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
      // Its players aren't connected yet: they're away until they reconnect, as in Zaisma rooms.
      saved ? { state: saved.state, room: saved.savedRoom, restoreInfo: restoreInfoOf(saved.savedAtMs), lostPlayers: saved.matchPlayers } : { start },
    );
    if (saved) core.savedAtMs = saved.savedAtMs;
    // passes: each player's checked pass, newest, for the blocks and friendships between them (hasBlockBetween, areFriends).
    // savedStateKey: what the room last saved (its state and its match's players), so an unchanged one isn't written again.
    room = { core, sockets, passes: new Map(), timer: null, waiting: false, savedStateKey: saved ? stateKeyOf(saved.stateJson, saved.matchPlayers) : null, hasReportedStateSize: false };
    rooms.set(code, room);
    return room;
  }

  /** A room's saved state from the file, or null if it has none (or it can't be read). */
  function readSaved(code) {
    try {
      const saved = roomStates?.read(code);
      return saved ? { ...saved, state: JSON.parse(saved.stateJson) } : null;
    } catch (error) {
      console.error(`Couldn't read room ${code}'s saved state:`, error);
      return null;
    }
  }

  /** Save a room's state, the players in its match and the room, when its state changed. Ended rooms have nothing to come back to. */
  function saveRoom(code, room) {
    if (!roomStates || room.core.ended) return;
    const nowMs = Date.now();
    room.core.savedAtMs = nowMs;
    let stateJson;
    try {
      stateJson = JSON.stringify(room.core.state);
    } catch (error) {
      return console.error(`Couldn't save room ${code}'s state:`, error);
    }
    const matchPlayers = [...room.core.players.values()];
    const stateKey = stateJson === undefined ? null : stateKeyOf(stateJson, matchPlayers);
    if (stateKey === null || stateKey === room.savedStateKey) return;
    if (Buffer.byteLength(stateJson) > ROOM_LIMITS.maximumSavedStateSizeBytes) {
      if (!room.hasReportedStateSize) console.warn(`Room ${code}'s state is over 32 MB, so it isn't saved and a restart starts it fresh.`);
      room.hasReportedStateSize = true;
      return;
    }
    try {
      roomStates.write(code, { stateJson, matchPlayers, savedRoom: room.core.saved, savedAtMs: nowMs });
      room.savedStateKey = stateKey;
    } catch (error) {
      console.error(`Couldn't save room ${code}'s state:`, error);
    }
  }

  /** A turn-based room saves after each change, once its game server has finished with it. */
  function keep(code, room) {
    if (definition.ticksPerSec || !roomStates) return;
    void room.core.settled().then(() => {
      if (!room.core.dirty) return;
      room.core.dirty = false;
      saveRoom(code, room);
    });
  }

  /** A real-time room ticks while someone's playing, saving its state every stateSaveIntervalSec, and stops while everyone's walked away. */
  function pace(code, room) {
    if (!definition.ticksPerSec) return keep(code, room);
    if (room.core.playingCount > 0 && !room.core.ended) {
      if (room.timer) return;
      let lastTickAtMs = Date.now();
      room.core.savedAtMs ??= lastTickAtMs;
      room.timer = setInterval(() => {
        const nowMs = Date.now();
        room.core.tick((nowMs - lastTickAtMs) / 1000);
        lastTickAtMs = nowMs;
        if (nowMs - room.core.savedAtMs >= stateSaveIntervalMs) saveRoom(code, room);
      }, 1000 / definition.ticksPerSec);
    } else if (room.timer) {
      clearInterval(room.timer);
      room.timer = null;
      saveRoom(code, room);
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

  // A room with nobody connected stays while players whose connection dropped have time to come back, and while it holds seats.
  // One that empties keeps its saved state for a day; one that ended keeps none.
  function closeIfEmpty(code, room) {
    if (rooms.get(code) !== room || room.waiting || (!room.core.ended && (room.sockets.size > 0 || room.core.heldSeatCount > 0 || room.core.nextReconnectDeadlineMs() !== null))) return;
    if (room.timer) clearInterval(room.timer);
    rooms.delete(code);
    try {
      if (room.core.ended) roomStates?.remove(code);
      else saveRoom(code, room);
    } catch (error) {
      console.error(`Couldn't update room ${code}'s saved state:`, error);
    }
  }

  // Check on every room's players: connections that stopped answering, idle and hidden players, held seats that ran out.
  let roomStatesSweptAtMs = 0;
  const sweeper = setInterval(() => {
    const nowMs = Date.now();
    for (const [code, room] of rooms) {
      for (const ws of room.sockets.values()) if (nowMs - ws.zaismaSeenAtMs > DEAD_MS) ws.terminate();
      room.core.sweep();
      pace(code, room);
      closeIfEmpty(code, room);
    }
    if (roomStates && nowMs - roomStatesSweptAtMs >= ROOM_STATE_SWEEP_MS) {
      roomStatesSweptAtMs = nowMs;
      try {
        roomStates.removeOlder(nowMs - KEEP_EMPTY_MS, rooms.keys());
      } catch (error) {
        console.error("Couldn't delete old room states:", error);
      }
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
    if (typeof definition.setup !== "function") return refuse("game_unavailable", "This game server has no setup(), so it runs no rooms: it only answers requests, runs on schedules or takes webhooks.");
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
        // Bytes (a binary frame) go to the game server's onBytes, under the same limits as messages.
        const errorCode = text === null ? room?.core.receiveBytes(playerId, binaryBytes(received)) : room?.core.receive(playerId, text);
        if (errorCode) ws.send(errorMessage(errorCode));
        if (room) pace(code, room);
        return;
      }
      let pass;
      let made = {};
      try {
        const hello = JSON.parse(text ?? "");
        if (hello.type !== "hello" || typeof hello.pass !== "string") return refuse("no_hello");
        pass = hello.pass;
        if (hello.room && typeof hello.room === "object") made = { ...(hello.room.isListed === false ? { isListed: false } : {}), ...(hello.room.friendJoinsEnabled === false ? { friendJoinsEnabled: false } : {}), ...tidyRoomInfo(hello.room) };
        made.clientIdle = clientIdle(hello);
        const checked = checkRoomData(hello.joinData);
        if (!checked.isValid) return refuse("too_big");
        made.joinData = checked.checkedData;
      } catch {
        return refuse("no_hello");
      }
      let checked;
      try {
        checked = await playerFrom(pass);
      } catch (error) {
        if (error instanceof PassError) return refuse("bad_pass");
        throw error;
      }
      if (!checked) return refuse("bad_pass");
      const { player, claims } = checked;
      clearTimeout(helloTimer);
      const room = roomFor(code);
      // The room's rules and the game's canJoin, before anyone hears about this player.
      const admitted = await room.core.admit(player, made.joinData);
      if (!admitted.isAllowed) {
        closeIfEmpty(code, room);
        return refuse(admitted.code, admitted.message);
      }
      room.sockets.get(player.id)?.close(REFUSED_CLOSE_CODE, "Joined from somewhere else");
      room.sockets.set(player.id, ws);
      // Blocks between accounts come in their passes: this player's and those of everyone the room remembers.
      room.passes.set(player.id, claims);
      for (const id of room.passes.keys()) if (!room.core.known.has(id) && id !== player.id) room.passes.delete(id);
      room.core.setAccountBlocks(player.id, [...room.passes].filter(([id, other]) => id !== player.id && hasBlockBetween(claims, other)).map(([id]) => id));
      room.core.setFriends(player.id, [...room.passes].filter(([id, other]) => id !== player.id && areFriends(claims, other)).map(([id]) => id));
      // Rooms here aren't in Zaisma's room lists, but listed, open and closed work the same for the game.
      const joined = room.core.join(player, made);
      if (!joined.isAllowed) {
        room.sockets.delete(player.id);
        closeIfEmpty(code, room);
        return refuse(joined.code, joined.message);
      }
      playerId = player.id;
      room.waiting = false;
      pace(code, room);
    });

    // Closed on purpose (1000, or 1001 as a page goes away), or lost: then the room holds the seat a while.
    ws.on("close", (closeCode) => {
      clearTimeout(helloTimer);
      const room = rooms.get(code);
      if (!room || !playerId || room.sockets.get(playerId) !== ws) return;
      room.sockets.delete(playerId);
      room.core.leave(playerId, closeCode === 1000 || closeCode === 1001 ? "left" : "lost");
      pace(code, room);
      closeIfEmpty(code, room);
    });
  });

  // Every room saves as the server stops, so a clean restart loses nothing.
  const close = () =>
    new Promise((done) => {
      clearInterval(sweeper);
      schedules.stop();
      for (const [code, room] of rooms) {
        if (room.timer) clearInterval(room.timer);
        saveRoom(code, room);
      }
      // Players' games hear a restart (1012) and reconnect, to the same room once this server is back.
      for (const ws of wss.clients) ws.close(1012, "Server restarting");
      setTimeout(() => {
        for (const ws of wss.clients) ws.terminate();
      }, 2000).unref?.();
      wss.close(() => httpServer.close(done));
      httpServer.closeAllConnections?.();
    });
  return { wss, httpServer, rooms, close };
}

/** A saved state's key: its JSON and who was in the match, since either changing is worth a save. */
function stateKeyOf(stateJson, matchPlayers) {
  return `${matchPlayers.map((player) => player.id).join(" ")}\n${stateJson}`;
}

/** room.secrets and server.secrets on your own server: the environment variables, as they were at the start. */
export function secretsFromEnvironment() {
  return Object.freeze(Object.fromEntries(Object.entries(process.env).filter(([, environmentValue]) => typeof environmentValue === "string")));
}

/** A binary frame from ws (a Buffer, an ArrayBuffer or a fragmented frame's pieces) as a Uint8Array of its own. */
function binaryBytes(received) {
  if (Array.isArray(received)) return new Uint8Array(Buffer.concat(received));
  if (received instanceof ArrayBuffer) return new Uint8Array(received.slice(0));
  return new Uint8Array(received.buffer.slice(received.byteOffset, received.byteOffset + received.byteLength));
}

function flag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const file = process.argv[2];
  const game = flag("game");
  if (!file || !game) {
    console.log("Usage: node bin/node.js <server.ts | relay> --game <slug> [--port 8080] [--origin https://<slug>.zaismausercontent.com] [--database zaisma-database.sqlite] [--room-state zaisma-room-states.sqlite] [--jwks https://rooms.zaisma.com/.well-known/jwks.json]");
    process.exit(1);
  }
  const server = file === "relay" ? relay : (await import(pathToFileURL(resolve(file)).href)).default;
  const portNumber = Number(flag("port", "8080"));
  const origins = (flag("origin", `https://${game}.zaismausercontent.com`) ?? "").split(",").filter(Boolean);
  const running = startServer({ server, game, port: portNumber, origins, keys: keysFrom(flag("jwks", "https://rooms.zaisma.com/.well-known/jwks.json")), database: localDatabase(resolve(flag("database", "zaisma-database.sqlite"))), roomStateFile: resolve(flag("room-state", "zaisma-room-states.sqlite")) });
  // Stopped (a restart, Ctrl-C): every room saves first, so its match comes back where it was.
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => running.close().then(() => process.exit(0)));
  const scheduleNames = (server.schedules ?? []).map((schedule) => `${schedule.name} (${schedule.cron})`);
  const webhookNote = ` Webhooks come to POST /v1/webhooks${process.env.ZAISMA_WEBHOOK_SIGNING_SECRET ? "" : " once ZAISMA_WEBHOOK_SIGNING_SECRET is set"}${typeof server.onWebhook === "function" ? "" : " (account_deleted only: it erases the player from the database)"}.`;
  console.log(`Game server for "${game}" on port ${portNumber}. Players connect to /v1/rooms/${game}/<code>; requests come to POST /v1/requests/${game}.${scheduleNames.length ? ` Schedules, in UTC: ${scheduleNames.join(", ")}.` : ""}${webhookNote}`);
}
