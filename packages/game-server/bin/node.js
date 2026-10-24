#!/usr/bin/env node
// Run a Zaisma game server on your own Node server (Node 22.18 or later).
//
//   zaisma-game-server ./server.ts --game my-game --port 8080
//
// or from code: import { startServer } from "@zaisma/game-server/node".
//
// Players connect to wss://your-server/v1/rooms/<game>/<code>, the same address
// layout as Zaisma rooms, and prove who they are with Zaisma player passes,
// checked against the keys Zaisma publishes. Put it behind HTTPS (Caddy, nginx,
// a Cloudflare Tunnel) and add the address to your game's own servers (own_server_urls, or zaisma own-servers).
// The game's requests (onRequest) come to POST /v1/requests/<game> on the same port, and its
// schedules (onSchedule) run while it's up, at the minutes their crons give in UTC. A Zaisma webhook
// whose endpoint_url is https://your-server/v1/webhooks reaches onWebhook, checked with its signing
// secret in the ZAISMA_WEBHOOK_SIGNING_SECRET environment variable.
// The game's database (room.database) is a local SQLite file, --database-file, made on first use.
// Its rooms' states are another, --room-state-file, so a restarted server brings its matches back (onRestored).
// Its secrets (room.secrets, server.secrets) are this process's environment variables, and it calls
// other servers with plain fetch(), with no list: on your own server nothing stands in between.
import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { realpathSync } from "node:fs";
import { BUSY_CLOSE_CODE, ENDED_CLOSE_CODE, ERROR_TEXT, NO_ANSWER_CLOSE_CODE, PASS_ISSUER_URL, PassError, ReceiptError, REMOVED_CLOSE_CODE, REQUEST_ERROR_HTTP_STATUS, REQUEST_LIMITS, ROOM_LIMITS, ROOM_TUNING, WEBHOOK_LIMITS, GameServerError, RoomCore, restoreInfoOf, passesAreFriends, passesHaveBlockBetween, answerRequest, startSchedules, checkRoomData, clientIdle, defineGameServer, errorMessage, isRoomCode, readRequestBody, relay, requestError, runWebhook, tidyRoomInfo, verifyPass, verifyReceipt, verifyWebhook } from "../src/internal.ts";
import { checkedStartServerOptions, localDatabase, localRoomStates, passKeysFrom, profilesFrom, receiptKeysFrom, secretsFromEnvironment } from "./node-parts.js";

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
/** The most of one WebSocket message: a hello with the fullest pass and joinData at its limit, with room for its other fields. Messages after it are held to ROOM_LIMITS.maximumGameMessageSizeBytes. */
const MAXIMUM_SOCKET_MESSAGE_SIZE_BYTES = REQUEST_LIMITS.maximumPassSizeBytes + ROOM_LIMITS.maximumJoinDataSizeBytes + 4 * 1024;
/** A reserved room nobody comes to is dropped after this. */
const RESERVED_MS = 10 * 60 * 1000;
/** A room that took players from another (room.moveTo) waits this long for them, like its held seats. */
const SEAT_MS = 60 * 1000;
/** A room that empties keeps its saved state this long, like Zaisma's rooms, so players coming back find it as it was. A kept room (room.setKept) keeps it until it ends. */
const KEEP_EMPTY_MS = 24 * 3600 * 1000;
/** How often saved states of rooms that emptied over a day ago are deleted. */
const ROOM_STATE_SWEEP_MS = 3600 * 1000;
/** A player whose socket holds this much not yet sent is backed up: state sync skips them, and latest-only messages wait. */
const BACKED_UP_SIZE_BYTES = ROOM_TUNING.backedUpSizeBytes;
/** How often rooms with something waiting for a backed-up player check whether they caught up. */
const CATCH_UP_MS = 50;

/**
 * Start a server. Options (all closed: an unknown one is a GameServerError unknown_option, one of the
 * wrong kind a bad_option, before anything listens): gameServer (a game server object) and gameSlug
 * (its Zaisma slug) are required. port (8080), origins (allowed page origins, by default
 * https://<gameSlug>.zaismausercontent.com; none allows any page), issuerUrl (who signs the passes; Zaisma's),
 * loadPassKeys (async (isRefreshing) => the pass keys; by default from <issuerUrl>/.well-known/jwks.json),
 * loadReceiptKeys (the same for room.verifyReceipt and server.verifyReceipt; by default from
 * <issuerUrl>/.well-known/receipt-jwks.json), loadProfile (async (playerId) => an account's public profile or null),
 * database (room.database and server.database; by default a local file, zaisma-database.sqlite, made the
 * first time the game uses it), secrets (room.secrets and server.secrets; by default this process's
 * environment variables), webhookSigningSecret (the whsec_ secret of the webhook whose events come to
 * /v1/webhooks; by default the ZAISMA_WEBHOOK_SIGNING_SECRET environment variable) and roomStateFile (where
 * rooms save their states, so a restart brings matches back; by default zaisma-room-states.sqlite, null to keep none).
 * Answers { close(), httpServer }: close() saves every room first and finishes once the server has stopped.
 */
export function startServer(options) {
  const { gameServer, gameSlug, port: portNumber, origins, issuerUrl, loadPassKeys = passKeysFrom(`${issuerUrl}/.well-known/jwks.json`), loadReceiptKeys = receiptKeysFrom(`${issuerUrl}/.well-known/receipt-jwks.json`), loadProfile = profilesFrom(issuerUrl), database = localDatabase("zaisma-database.sqlite"), secrets = secretsFromEnvironment(), webhookSigningSecret = process.env.ZAISMA_WEBHOOK_SIGNING_SECRET, roomStateFile = "zaisma-room-states.sqlite" } = checkedStartServerOptions(options, PASS_ISSUER_URL);
  const definition = defineGameServer(gameServer);
  const roomStates = roomStateFile === null ? null : localRoomStates(roomStateFile);
  const stateSaveIntervalMs = (definition.stateSaveIntervalSec ?? ROOM_LIMITS.defaultStateSaveIntervalSec) * 1000;
  // Schedules run while this server is up; one that's down when a run is due misses that run.
  const schedules = startSchedules(definition, { database, secrets, verifyReceipt: receiptClaims }, (run, failure) => console.error(`Game server error in onSchedule ("${run.name}", due ${run.scheduledAt}):`, failure));
  const rooms = new Map(); // code -> { core, sockets: Map<playerId, ws>, timer }
  const httpServer = createServer((request, response) => answerHttp(request, response));
  const wss = new WebSocketServer({ server: httpServer, maxPayload: MAXIMUM_SOCKET_MESSAGE_SIZE_BYTES });
  httpServer.listen(portNumber);

  /** room.verifyReceipt and server.verifyReceipt: a receipt for this game from Zaisma's receipt issuer, checked against its keys (fetched again once when its key is new). */
  async function receiptClaims(receipt) {
    const expect = { gameSlug, issuerUrl: `${issuerUrl}/receipts` };
    return verifyReceipt(receipt, await loadReceiptKeys(), expect).catch(async (error) => {
      if (error instanceof ReceiptError && error.code === "unknown_key") return verifyReceipt(receipt, await loadReceiptKeys(true), expect);
      throw error;
    });
  }

  /**
   * Who a pass is: checked against Zaisma's keys (fetched again once when its key is new), with an
   * account's name from its public profile, and the pass's claims, for blocks between players. Null
   * for an account deleted since; PassError for a bad pass.
   */
  async function playerFrom(pass) {
    const claims = await verifyPass(pass, await loadPassKeys(), { gameSlug, issuerUrl }).catch(async (error) => {
      // A new key may have been published since we cached them.
      if (error instanceof PassError && error.code === "unknown_key") return verifyPass(pass, await loadPassKeys(true), { gameSlug, issuerUrl });
      throw error;
    });
    // An account's pass is proof only: its name comes from its public profile, and a deleted account's pass stops working.
    const name = claims.kind === "account" ? (await loadProfile(claims.sub))?.name : claims.name;
    // What the account owns here rides in its pass, as on Zaisma rooms (player.ownedItemNames).
    const owned = claims.owned_item_names?.length ? { ownedItemNames: claims.owned_item_names } : {};
    // A kind added after v1 plays as a guest here, as in Zaisma rooms.
    return name ? { player: { id: claims.sub, name, kind: claims.kind === "account" ? "account" : "guest", ...owned }, claims } : null;
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
    if (request.method !== "POST" || request.url !== `/v1/requests/${gameSlug}`) {
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
        const outcome = await answerRequest(definition, checked.player, body.request, { database, secrets, verifyReceipt: receiptClaims });
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
  // Webhooks way, checked with its signing secret, then handed to onWebhook. An event about another game
  // (one webhook can take several) is skipped with 204, before anything else, so it never erases this
  // game's rows. An account_deleted event about this game first erases the player from the local
  // database when its account_deletion says deleted_account_erase_enabled, the same switch Zaisma follows
  // for its own databases. Answers 204 when that and onWebhook finished, so Zaisma counts it delivered;
  // anything else is tried again later.
  function answerWebhook(request, response) {
    const reply = (httpStatus, message) => {
      response.writeHead(httpStatus, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
      response.end(message);
    };
    if (request.method !== "POST") return reply(405, "Webhooks are POSTed.");
    if (!webhookSigningSecret) return reply(503, "Set ZAISMA_WEBHOOK_SIGNING_SECRET to the webhook's signing_secret to take its events.");
    const header = (name) => (typeof request.headers[name] === "string" ? request.headers[name] : null);
    const headers = { webhookId: header("webhook-id"), webhookTimestamp: header("webhook-timestamp"), webhookSignature: header("webhook-signature") };
    // A POST with no headers, or an old timestamp, is turned away before its body is read.
    const refuse = (httpStatus, error) => {
      response.once("finish", () => request.destroy());
      reply(httpStatus, `${error.message} ${error.fix}`);
    };
    const chunks = [];
    let sizeBytes = 0;
    let isAnswered = false;
    verifyWebhook(webhookSigningSecret, headers, "").then((early) => {
      if ("error" in early && early.error.code !== "bad_signature" && !isAnswered && !response.headersSent) {
        isAnswered = true;
        return refuse(401, early.error);
      }
    });
    request.on("data", (chunk) => {
      if (isAnswered) return;
      sizeBytes += chunk.length;
      if (sizeBytes <= WEBHOOK_LIMITS.maximumEventSizeBytes) return void chunks.push(chunk);
      isAnswered = true;
      refuse(413, { message: `The event is over ${WEBHOOK_LIMITS.maximumEventSizeBytes} bytes, more than any event Zaisma sends.`, fix: "Only take POSTs Zaisma's webhooks send." });
    });
    request.on("end", async () => {
      try {
        if (isAnswered) return;
        const text = Buffer.concat(chunks).toString("utf8");
        const checked = await verifyWebhook(webhookSigningSecret, headers, text);
        if (isAnswered) return;
        if ("error" in checked) return reply(401, `${checked.error.message} ${checked.error.fix}`);
        const event = checked.event;
        if (event.game && event.game.slug !== gameSlug) return reply(204, "");
        const isAccountDeleted = event.kind === "account_deleted";
        const deletion = event.account_deletion;
        if (isAccountDeleted && event.game?.slug === gameSlug && deletion?.deleted_account_erase_enabled === true) {
          try {
            await database.erasePlayer(deletion.player_id);
          } catch (error) {
            console.error(`Couldn't erase ${deletion.player_id} from the game database (${event.id}):`, error);
            return reply(500, "Erasing the player failed; Zaisma tries the event again later.");
          }
        }
        if (typeof definition.onWebhook !== "function") return isAccountDeleted ? reply(204, "") : reply(404, "This game server has no onWebhook.");
        const outcome = await runWebhook(definition, event, { database, secrets, verifyReceipt: receiptClaims });
        if ("error" in outcome) {
          console.error(`Game server error in onWebhook (${checked.event.kind}, ${checked.event.id}):`, outcome.error.message);
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
        roomCode: code,
        database,
        secrets,
        verifyReceipt: receiptClaims,
        send: (id, text) => sockets.get(id)?.send(text),
        sendBytes: (id, frame) => sockets.get(id)?.send(frame, { binary: true }),
        isBackedUp: (id) => (sockets.get(id)?.bufferedAmount ?? 0) >= BACKED_UP_SIZE_BYTES,
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
            : Promise.resolve({ movedPlayerIds: [], refusals: ask.players.map((player) => ({ playerId: player.id, code: "room_not_running", message: ERROR_TEXT.room_not_running })) });
          answer
            .then((moveAnswer) => {
              if (target && moveAnswer.movedPlayerIds.length) wait(next, target, SEAT_MS);
              for (const id of moveAnswer.movedPlayerIds) sockets.get(id)?.send(JSON.stringify({ type: "move", roomCode: next }));
              core.moved(next, moveAnswer, ask.players);
            })
            .catch((error) => console.error("Couldn't move players:", error));
        },
      },
      // As in Zaisma's rooms: a room that ticks comes back with its state and onRestored, its match's players away until they
      // reconnect; a turn-based room comes back with its state and its room settings alone.
      saved ? { state: saved.state, room: saved.savedRoom, ...(definition.ticksPerSec ? { restoreInfo: restoreInfoOf(saved.savedAtMs, Date.now(), null, saved.isSavedEmpty), lostPlayers: saved.matchPlayers } : {}) } : { start },
    );
    if (saved) core.savedAtMs = saved.savedAtMs;
    // passes: each player's checked pass, newest, for the blocks and friendships between them (passesHaveBlockBetween, passesAreFriends).
    // savedStateKey: what the room last saved (its state and its match's players), so an unchanged one isn't written again.
    room = { core, sockets, passes: new Map(), timer: null, waiting: false, savedStateKey: saved ? stateKeyOf(saved.stateJson, saved.matchPlayers, saved.savedRoom.isKept === true) : null, hasReportedStateSize: false };
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

  /**
   * Save a room's state, the players in its match and the room, when its state changed (or it was kept or
   * unkept). Ended rooms have nothing to come back to. isSavedEmpty: saved as the room emptied.
   */
  function saveRoom(code, room, isSavedEmpty = false) {
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
    const stateKey = stateJson === undefined ? null : stateKeyOf(stateJson, matchPlayers, room.core.isKept);
    if (stateKey === null) return;
    if (stateKey === room.savedStateKey) {
      if (isSavedEmpty) roomStates.markEmpty(code, room.core.saved, matchPlayers);
      return;
    }
    if (Buffer.byteLength(stateJson) > ROOM_LIMITS.maximumSavedStateSizeBytes) {
      if (!room.hasReportedStateSize) console.warn(`Room ${code}'s state is over 32 MB, so it isn't saved and a restart starts it fresh.`);
      room.hasReportedStateSize = true;
      return;
    }
    try {
      roomStates.write(code, { stateJson, matchPlayers, savedRoom: room.core.saved, savedAtMs: nowMs, isSavedEmpty });
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

  // A room with only spectators left has no match to watch: they're told it ended and go, so it empties.
  function dismissSpectatorsIfAlone(room) {
    if ([...room.sockets.keys()].some((id) => !room.core.spectators.has(id))) return;
    const text = JSON.stringify({ type: "ended", message: "The match ended.", endReason: "no_players" });
    for (const [id, ws] of [...room.sockets]) {
      room.sockets.delete(id);
      room.core.leave(id);
      ws.send(text);
      ws.close(ENDED_CLOSE_CODE, "Match ended");
    }
  }

  // A room with nobody connected stays while players whose connection dropped have time to come back, and while it holds seats.
  // One that empties keeps its saved state for a day (a kept one until it ends); one that ended keeps none.
  function closeIfEmpty(code, room) {
    if (rooms.get(code) !== room || room.waiting || (!room.core.ended && (room.sockets.size > 0 || room.core.heldSeatCount > 0 || room.core.nextReconnectDeadlineMs() !== null))) return;
    if (room.timer) clearInterval(room.timer);
    rooms.delete(code);
    try {
      if (room.core.ended) roomStates?.remove(code);
      else saveRoom(code, room, true);
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

  // Players who were backed up get what waited for them once their socket drains (ws has no event for it).
  const catcher = setInterval(() => {
    for (const room of rooms.values()) if (room.core.isCatchingUp) room.core.catchUp();
  }, CATCH_UP_MS);
  catcher.unref?.();

  wss.on("connection", (ws, request) => {
    const address = /^\/v1\/rooms\/([a-z0-9-]{1,40})\/([A-Z0-9]{6})$/.exec(request.url ?? "");
    const refuse = (code, message) => {
      ws.send(errorMessage(code, message));
      // Busy is a try-again (1013); every other refusal is final (4001).
      ws.close(code === "busy" ? BUSY_CLOSE_CODE : REMOVED_CLOSE_CODE, code);
    };
    // Refused before the hello too, with a code the SDK reads: a browser never sees why a socket closed otherwise.
    if (!address || address[1] !== gameSlug || !isRoomCode(address[2])) return refuse("game_unavailable");
    if (origins.length && !origins.includes(request.headers.origin)) return refuse("bad_origin");
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
      // Come to watch, not to play (joinRoom({ isSpectator: true })).
      let isSpectator = false;
      try {
        const hello = JSON.parse(text ?? "");
        if (hello.type !== "hello" || typeof hello.pass !== "string") return refuse("no_hello");
        pass = hello.pass;
        isSpectator = hello.isSpectator === true;
        if (hello.room && typeof hello.room === "object") made = { ...(hello.room.isListed === true ? { isListed: true } : {}), ...(hello.room.friendJoinsEnabled === false ? { friendJoinsEnabled: false } : {}), ...tidyRoomInfo(hello.room) };
        made.clientIdle = clientIdle(hello);
        const checked = checkRoomData(hello.joinData, ROOM_LIMITS.maximumJoinDataSizeBytes);
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
        // Zaisma couldn't be reached for the account's name: the player tries again, nothing crashes.
        console.error("Couldn't check a player's pass:", error);
        return refuse("busy");
      }
      if (!checked) return refuse("bad_pass");
      const { player, claims } = checked;
      clearTimeout(helloTimer);
      // A spectator watches a match: one with nobody in it isn't running, and a spectator never starts one.
      if (isSpectator && !(rooms.get(code)?.core.players.size > 0)) return refuse("room_not_running");
      const room = roomFor(code);
      // The room's rules and the game's canJoin, before anyone hears about this player.
      const admitted = await room.core.admit(player, made.joinData, { isSpectator });
      if (!admitted.isAllowed) {
        closeIfEmpty(code, room);
        return refuse(admitted.code, admitted.message);
      }
      room.sockets.get(player.id)?.close(REMOVED_CLOSE_CODE, "Joined from somewhere else");
      room.sockets.set(player.id, ws);
      // Blocks between accounts come in their passes: this player's and those of everyone the room remembers.
      // Spectators send nothing, so nothing of theirs reaches a player to block.
      if (!isSpectator) {
        room.passes.set(player.id, claims);
        for (const id of room.passes.keys()) if (!room.core.known.has(id) && id !== player.id) room.passes.delete(id);
        room.core.setAccountBlocks(player.id, [...room.passes].filter(([id, other]) => id !== player.id && passesHaveBlockBetween(claims, other)).map(([id]) => id));
        room.core.setFriends(player.id, [...room.passes].filter(([id, other]) => id !== player.id && passesAreFriends(claims, other)).map(([id]) => id));
      }
      // Rooms here aren't in Zaisma's room lists, but listed, open and closed work the same for the game.
      const joined = room.core.join(player, { ...made, isSpectator });
      if (!joined.isAllowed) {
        room.sockets.delete(player.id);
        closeIfEmpty(code, room);
        return refuse(joined.code, joined.message);
      }
      playerId = player.id;
      room.waiting = false;
      pace(code, room);
    });

    // A frame over the size limit (or a broken one) is an error on this one socket: it closes and the close handler below takes it out, the runner keeps going.
    ws.on("error", () => ws.terminate());

    // Closed on purpose (1000, or 1001 as a page goes away), or lost: then the room holds the seat a while.
    ws.on("close", (closeCode) => {
      clearTimeout(helloTimer);
      const room = rooms.get(code);
      if (!room || !playerId || room.sockets.get(playerId) !== ws) return;
      room.sockets.delete(playerId);
      room.core.leave(playerId, closeCode === 1000 || closeCode === 1001 ? "left" : "lost");
      dismissSpectatorsIfAlone(room);
      pace(code, room);
      closeIfEmpty(code, room);
    });
  });

  // Every room saves as the server stops, so a clean restart loses nothing.
  const close = () =>
    new Promise((done) => {
      clearInterval(sweeper);
      clearInterval(catcher);
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
      wss.close(() => httpServer.close(() => done()));
      httpServer.closeAllConnections?.();
    });
  return { close, httpServer };
}

/** A saved state's key: its JSON, who was in the match and whether the room is kept, since any of them changing is worth a save. */
function stateKeyOf(stateJson, matchPlayers, isKept) {
  return `${isKept ? "kept " : ""}${matchPlayers.map((player) => player.id).join(" ")}\n${stateJson}`;
}

/** A binary frame from ws (a Buffer, an ArrayBuffer or a fragmented frame's pieces) as a Uint8Array of its own. */
function binaryBytes(received) {
  if (Array.isArray(received)) return new Uint8Array(Buffer.concat(received));
  if (received instanceof ArrayBuffer) return new Uint8Array(received.slice(0));
  return new Uint8Array(received.buffer.slice(received.byteOffset, received.byteOffset + received.byteLength));
}

const USAGE = "Usage: zaisma-game-server <server.ts | relay> --game <slug> [--port 8080] [--origin <url>,<url>] [--issuer-url https://rooms.zaisma.com] [--database-file zaisma-database.sqlite] [--room-state-file zaisma-room-states.sqlite]";
const FLAGS = ["game", "port", "origin", "issuer-url", "database-file", "room-state-file"];

/** The command line's flags by name, or null for one this runner doesn't take (or one missing its value). */
function flagsFrom(argumentList) {
  const flags = {};
  for (let i = 0; i < argumentList.length; i += 2) {
    const name = /^--(.+)$/.exec(argumentList[i])?.[1];
    if (!name || !FLAGS.includes(name) || argumentList[i + 1] === undefined || argumentList[i + 1].startsWith("--")) return null;
    flags[name] = argumentList[i + 1];
  }
  return flags;
}

// Run as a command. An npm bin is a symlink to this file, so both sides are resolved before they're compared.
async function runCommand() {
  const file = process.argv[2];
  const flags = file ? flagsFrom(process.argv.slice(3)) : null;
  if (!file || file.startsWith("--") || !flags?.game) {
    console.log(USAGE);
    process.exit(1);
  }
  const gameServer = file === "relay" ? relay : (await import(pathToFileURL(resolve(file)).href)).default;
  const portNumber = Number(flags.port ?? "8080");
  let running;
  try {
    running = startServer({
      gameServer,
      gameSlug: flags.game,
      port: portNumber,
      ...(flags.origin !== undefined ? { origins: flags.origin.split(",").filter(Boolean) } : {}),
      ...(flags["issuer-url"] !== undefined ? { issuerUrl: flags["issuer-url"] } : {}),
      ...(flags["database-file"] !== undefined ? { database: localDatabase(resolve(flags["database-file"])) } : {}),
      roomStateFile: resolve(flags["room-state-file"] ?? "zaisma-room-states.sqlite"),
    });
  } catch (error) {
    // A bad flag, or an option the runner refuses: said plainly, before anything listens.
    console.error(error instanceof GameServerError ? error.message : error);
    process.exit(1);
  }
  // Stopped (a restart, Ctrl-C): every room saves first, so its match comes back where it was.
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => running.close().then(() => process.exit(0)));
  const scheduleNames = (gameServer.schedules ?? []).map((schedule) => `${schedule.name} (${schedule.cron})`);
  const webhookNote = ` Webhooks come to POST /v1/webhooks${process.env.ZAISMA_WEBHOOK_SIGNING_SECRET ? "" : " once ZAISMA_WEBHOOK_SIGNING_SECRET is set"}${typeof gameServer.onWebhook === "function" ? "" : " (account_deleted only: it erases the player from the database)"}.`;
  console.log(`Game server for "${flags.game}" on port ${portNumber}. Players connect to /v1/rooms/${flags.game}/<code>; requests come to POST /v1/requests/${flags.game}.${scheduleNames.length ? ` Schedules, in UTC: ${scheduleNames.join(", ")}.` : ""}${webhookNote}`);
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) await runCommand();
