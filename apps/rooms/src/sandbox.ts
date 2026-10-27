import { GAME_SERVER_OPTIONS, OUTSIDE_CALL_REFUSAL_HEADER, PAIR_CHANGE_COUNT, OUTSIDE_CALL_ERROR_CODES, QUEUES_INPUT, RESERVE_WITH_ROOM_CODE, ROOM_LIMITS, STATE_SYNC, SYNCS_STATE, GameServerError, checkSchedules, defineGameServer, noSetupError, readJoinAnswer, unknownOptionError, type Audience, type AwayInfo, type AwayReason, type GameServer, type JoinAnswer, type JoinInfo, type LeaveInfo, type Player, type Purchase, type RestoreInfo, type Room, type ScheduledRun, type SendOptions, type StateSyncHooks, type VersionUpdate, roomCallChecksModuleSource, stateSyncModuleSource } from "@zaisma/game-server/internal";
import { LOG_LEVELS, LOG_LIMITS, SANDBOX_GAME_SERVER, logText, manifestKey, readPrintedLines, serverModules, type Manifest, type PrintedLogLine } from "@zaisma/core";
import type { Env } from "./index.ts";
import { noteLoadedVersion } from "./usage-counts.ts";

/**
 * Developers' own game servers, run in a Dynamic Worker: a sealed sandbox with a CPU limit and one
 * binding, its own game's database (database.ts). Its fetch() reaches only the hosts the game lists,
 * through our gateway (outbound.ts), and the room or the game's object hands it the game's secrets
 * (secrets.ts) when it opens a session. A game opts in with multiplayer_mode "own" and its game server in its
 * upload: a zaisma-server/ folder (index.js, importing the folder's other .js files by relative
 * path) or one zaisma-server.js. ES modules whose default export is the game server.
 *
 * The room (our Durable Object) still owns everything players touch: sockets, passes, limits,
 * mute, block and report. The sandbox only runs the game's handlers, and hands back what the game
 * asked the room to do (broadcast, send, end, kick, ...), which the room then does; canJoin only
 * answers yes or no. Each call carries what changed in the room since the last one (RoomChanges). A
 * turn-based room's state goes in and out with each call, since the room saves it after every change;
 * a real-time room's stays in the sandbox, which the room copies every few seconds
 * (STATE_COPY_INTERVAL_MS) to start a fresh session from, and its players' messages wait in the room
 * for the next tick, which runs them and onTick in one call. State sync (stateSyncEnabled) runs in the
 * sandbox too, where the state is: after each tick, or each call of a turn-based room, the session hands
 * back each player's frame as a "state" effect, and the room tells it who's backed up and who needs a full copy.
 * Requests (onRequest), schedules (onSchedule) and webhooks (onWebhook) go through the game's own object outside any room
 * (game-server.ts), with the same sandbox and the same database. A room or that object opens one session with the sandbox
 * when it wakes and makes every call through it, so a room is billed one request per wake rather
 * than one per message or tick.
 */

export const SANDBOX = SANDBOX_GAME_SERVER;

/**
 * The pairs of players in a room that a check says yes to: all the sandbox learns of blocks and
 * friendships, as room.hasBlockBetween and room.areFriends would answer.
 */
function pairsOf(room: Room, isPair: (firstPlayerId: string, secondPlayerId: string) => boolean): [string, string][] {
  const pairs: [string, string][] = [];
  const players = room.players;
  for (let i = 0; i < players.length; i++) for (const other of players.slice(i + 1)) if (isPair(players[i]!.id, other.id)) pairs.push([players[i]!.id, other.id]);
  return pairs;
}
/** Why each player in a room who isn't playing is away, as room.awayReason would answer. */
function awayReasonsOf(room: Room): Record<string, AwayReason> {
  const awayReasons: Record<string, AwayReason> = {};
  for (const player of room.players) {
    const awayReason = room.awayReason(player.id);
    if (awayReason !== null) awayReasons[player.id] = awayReason;
  }
  return awayReasons;
}
/** The ping of each player in a room the room has measured, as room.pingDurationMs would answer. */
function pingsOf(room: Room): Record<string, number> {
  const pings: Record<string, number> = {};
  for (const player of room.players) {
    const pingDurationMs = room.pingDurationMs(player.id);
    if (pingDurationMs !== null) pings[player.id] = pingDurationMs;
  }
  return pings;
}

/**
 * CPU per call into the sandbox. Cloudflare stops a call that runs on, but in practice only after
 * about 2 seconds whatever this says (tested Oct 13, 2026), so the room also gives up on a game
 * server that's stopped this often (FAILURE_COUNT): a stuck one can't keep freezing its rooms or burning CPU.
 */
const CPU_MS = 50;
const FAILURE_COUNT = 2;

/** What the game asked the room to do during one handler, in order. */
type Effect =
  | { do: "broadcast"; message: unknown; exceptPlayerId?: string; fromPlayerId?: string; audience?: unknown; delivery?: unknown; latestKey?: unknown }
  | { do: "send"; playerId: string; message: unknown; fromPlayerId?: string; delivery?: unknown; latestKey?: unknown }
  | { do: "broadcast_bytes"; bytes: unknown; exceptPlayerId?: string; fromPlayerId?: string; audience?: unknown; delivery?: unknown; latestKey?: unknown }
  | { do: "send_bytes"; playerId: string; bytes: unknown; fromPlayerId?: string; delivery?: unknown; latestKey?: unknown }
  | { do: "state"; playerIds: unknown; frame: unknown }
  | { do: "end"; message?: string }
  | { do: "listed"; isListed: boolean }
  | { do: "open"; isOpen: boolean }
  | { do: "friend_joins"; friendJoinsEnabled: boolean }
  | { do: "kept"; isKept: boolean }
  | { do: "info"; nameAndLabels: unknown }
  | { do: "reserve"; reserveOptions: unknown; roomCode: string }
  | { do: "kick"; playerId: unknown; kickOptions: unknown }
  | { do: "moveTo"; roomCode: unknown; moveOptions: unknown }
  | { do: "apply_version_update" };

/** The room as the sandbox sees it. The session keeps it, and each call sends only what changed (RoomChanges). */
interface Snapshot {
  players: Player[];
  /** The spectators watching, for room.spectators. */
  spectators: Player[];
  isListed: boolean;
  isOpen: boolean;
  friendJoinsEnabled: boolean;
  /** room.isKept: the room sleeps with its state when everyone leaves. */
  isKept: boolean;
  /** room.roomCode: this room's code. */
  roomCode: string;
  name: string | null;
  labels: Record<string, string>;
  /** When Zaisma will end the match (an ISO time), or null, for room.endsAt. */
  endsAt: string | null;
  /** The pairs of players in the room with a block between them, for room.hasBlockBetween. */
  blockPairs: [string, string][];
  /** The pairs of players in the room who are friends, for room.areFriends. */
  friendPairs: [string, string][];
  /** Each measured player's ping, for room.pingDurationMs. */
  pingDurationsMs: Record<string, number>;
  /** Why each player who isn't playing is away, for room.awayReason. */
  awayReasons: Record<string, AwayReason>;
  /** The room's clock when the call was made, for room.serverTimeMs. */
  serverTimeMs: number;
  /** Players whose connection is backed up, whom state sync skips. */
  backedUpPlayerIds: string[];
}

/** What changed in the room since the last call; serverTimeMs comes every time, and fullCopyPlayerIds when there are any: new connections, which state sync sends a full copy. */
type RoomChanges = Partial<Snapshot> & { serverTimeMs: number; fullCopyPlayerIds?: string[] };

/** A player's message or bytes waiting in the room for a real-time game server's next call. */
interface Queued {
  hook: "onMessage" | "onBytes";
  player: Player;
  payload: unknown;
}

interface Answer {
  /** A turn-based room's new state; a real-time room's stays in the sandbox. */
  state?: unknown;
  effects: Effect[];
  error?: string;
  /** Errors thrown by the input a call ran first, or by the handlers of a tick, up to 20 of them. */
  errors?: unknown;
  /** How many handlers threw in all. */
  errorCount?: unknown;
}

/**
 * Every answer from the sandbox can carry the lines the game server printed, and how long the call
 * waited on its database and outside calls (the rest is CPU, for the player-hour meter).
 */
type Printed = { logLines?: unknown; ioWaitDurationMs?: unknown; handlerStartedAtMs?: unknown; refusalLines?: unknown };

/** A game server's options as the sandbox reports them, and which of its handlers it has. */
export interface Settings {
  optionNames: unknown;
  maximumPlayerCount?: unknown;
  maximumSpectatorCount?: unknown;
  ticksPerSec?: unknown;
  hostControlsEnabled?: unknown;
  idleCheck?: unknown;
  idleTimeoutSec?: unknown;
  awayMode?: unknown;
  seatHoldDurationSec?: unknown;
  reconnectTimeoutSec?: unknown;
  maximumRoomCountPerPlayer?: unknown;
  stateSaveIntervalSec?: unknown;
  stateSyncEnabled?: unknown;
  /** As plain JSON; the game's object checks them (checkSchedules). */
  schedules?: unknown;
  handlerNames: unknown;
  /** The handlers the game server has that aren't functions, for the same check on them as on its own server. */
  badHandlerNames?: unknown;
  /** What the game server printed as it loaded. */
  logLines?: unknown;
}

/**
 * A call's state: a turn-based room's, handed in (and back in the answer), or none for a real-time
 * room, whose state the session keeps.
 */
type GivenState = { state: unknown } | null;

export interface Session {
  settings(): Promise<Settings & Printed>;
  /** The game's secrets changed: room.secrets and server.secrets are these from the next call. */
  setSecrets(secrets: Record<string, string>): Promise<void>;
  /** The starting state, kept by the session and handed back. */
  setup(setupData: unknown): Promise<Answer & Printed>;
  /** One handler, after any input still waiting (queued), in order. */
  call(hook: string, handlerArguments: unknown[], roomChanges: RoomChanges, given: GivenState, queued: Queued[]): Promise<Answer & Printed>;
  /** A real-time room's tick: the input that came since the last call, in order, then onTick. */
  tick(queued: Queued[], tickDurationSec: number, roomChanges: RoomChanges): Promise<Answer & Printed>;
  /** A real-time room's state as it is now, for the room to keep. */
  stateCopy(): Promise<unknown>;
  /** Start from a copy of the state, on a fresh session after the last one failed. */
  restore(state: unknown): Promise<void>;
  /** canJoin: the game's answer on a player coming in, as plain JSON. It can't change the state or the room. */
  check(player: Player, joinData: unknown, roomChanges: RoomChanges, given: GivenState, joinInfo: JoinInfo): Promise<{ answer?: unknown; error?: string } & Printed>;
  /** onRequest: what the game server answered a request, as plain JSON, or the error it threw. */
  request(player: Player, request: unknown): Promise<{ answer?: unknown; error?: string } & Printed>;
  /** onSchedule: one run of a schedule, or the error it threw. */
  schedule(run: ScheduledRun): Promise<{ error?: string } & Printed>;
  /** onWebhook: one event from a webhook, as plain JSON, or the error it threw. */
  webhook(event: unknown): Promise<{ error?: string } & Printed>;
}

// Runs inside the sandbox, beside the game's file. Plain JavaScript: nothing here is trusted by the
// room, which checks everything it's handed back like any message from a player.
const harness = (entry: string) => `
import "./outside-calls.js";
import { withLogs, timedWait } from "./logs.js";
import { WorkerEntrypoint, RpcTarget } from "cloudflare:workers";
import stateSync from "./state-sync.js";
import roomCalls from "./room-calls.js";
import server from "./${entry}";

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const newRoomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => ALPHABET[byte & 31]).join("");
const HOOKS = ["onJoin", "onLeave", "onSpectatorJoin", "onSpectatorLeave", "onMessage", "onBytes", "onTick", "onMoved", "onAway", "onBack", "onEnding", "onRestored", "onVersionUpdate", "onPurchase", "onRefund"];
// A call hands back up to this many of the errors its handlers threw (errorCount says how many there were).
const ERROR_COUNT = 20;
const HANDLERS = ["setup", "canJoin", "onRequest", "onSchedule", "onWebhook", "stateView", ...HOOKS];
const MAXIMUM_STATE_VIEW_SIZE_BYTES = ${ROOM_LIMITS.maximumStateViewSizeBytes};
const MAXIMUM_RESERVES_PER_MIN = ${ROOM_LIMITS.maximumReservesPerMin};
const ROOM_LIMITS = ${JSON.stringify(ROOM_LIMITS)};
// room.roomCode before the room's first call says its code: a code no room has, so it's always a string.
const STAND_IN_ROOM_CODE = "SANDBX";

// room.database, through the binding the room gave this sandbox: its own game's database and nothing else.
class DatabaseError extends Error {
  constructor(error) {
    super(error.message + " " + error.fix + " (" + error.code + ")");
    this.name = "DatabaseError";
    this.code = error.code;
    this.fix = error.fix;
  }
}

// What a game's own room calls and handler answers get wrong, thrown at the call: the same codes and fields as on a game's own server.
class GameServerError extends Error {
  constructor(code, field, message, fix) {
    super(message + " " + fix + " (" + code + ")");
    this.name = "GameServerError";
    this.code = code;
    this.field = field;
    this.fix = fix;
  }
}

// The checks every room call goes through, the same ones a room runs on its own server.
const checks = roomCalls.checksFor(GameServerError, ROOM_LIMITS);

// Calls that change the room or send from it, which canJoin and stateView can't make.
const CHANGING_CALLS = ["broadcast", "send", "broadcastBytes", "sendBytes", "end", "setListed", "setOpen", "setFriendJoinsEnabled", "setKept", "setInfo", "reserve", "kick", "moveTo", "applyVersionUpdate"];

// A handler's answer is the state when it is a plain object or an array; nothing keeps the state.
function isStateAnswer(given) {
  if (Array.isArray(given)) return true;
  if (typeof given !== "object" || given === null) return false;
  const prototype = Object.getPrototypeOf(given);
  return prototype === Object.prototype || prototype === null;
}

function badHandlerAnswer(handlerName, answer) {
  const given = typeof answer === "string" ? "the text " + JSON.stringify(answer.slice(0, 60)) : answer === null ? "null" : typeof answer === "object" ? "a " + ((answer.constructor && answer.constructor.name) || "non-plain") + " object" : String(answer).slice(0, 60);
  return new GameServerError("bad_handler_answer", handlerName, handlerName + " answered " + given + ", so the state stayed as it was.", "Answer the new state as a plain object or an array, or answer nothing to keep the state.");
}

function gameDatabase(binding) {
  const read = (answer) => {
    if (answer.error) throw new DatabaseError(answer.error);
    return answer.queryResult;
  };
  return {
    async query(sql, values) { return read(await timedWait(binding.query(sql, values === undefined ? [] : values))); },
    async batch(statements) { return read(await timedWait(binding.batch(statements))); },
    async erasePlayer(playerId) { return read(await timedWait(binding.erasePlayer(playerId))); },
  };
}

class ReceiptError extends Error {
  constructor(code) {
    super("Receipt rejected: " + code);
    this.name = "ReceiptError";
    this.code = code;
  }
}

// room.verifyReceipt and server.verifyReceipt: checked by the rooms Worker, which has every receipt key and knows the game.
function receiptChecker(binding) {
  return async (receipt) => {
    const answer = await timedWait(binding.verify(receipt));
    if (answer.errorCode) throw new ReceiptError(answer.errorCode);
    return answer.claims;
  };
}

// A send's delivery and latestKey as the effect carries them.
function sendFields(checked) {
  return { delivery: checked.delivery.isLatestOnly ? "latest_only" : undefined, latestKey: checked.delivery.isLatestOnly ? checked.delivery.latestKey : undefined, fromPlayerId: checked.fromPlayerId === null ? undefined : checked.fromPlayerId };
}

// Calls that reserve rooms or move players, counted a minute at a time like a room on its own server does.
function reserveCounter() {
  let reservedAtMs = [];
  return (call) => {
    const nowMs = Date.now();
    reservedAtMs = reservedAtMs.filter((at) => nowMs - at < 60000);
    if (reservedAtMs.length >= MAXIMUM_RESERVES_PER_MIN) throw new GameServerError("room_call_limit", call, "A room can reserve rooms or move players up to " + MAXIMUM_RESERVES_PER_MIN + " times a minute.", "Reserve one room for a whole group, or wait a minute.");
    reservedAtMs.push(nowMs);
  };
}

// The room a handler is given: what it asks for is recorded, after the same checks a room on its own server makes, so a mistake throws
// in the game's own handler. readOnlyFor names a handler (canJoin, stateView) that may only read: the calls that change the room throw.
function recorder(snapshot, effects, database, secrets, verifyReceipt, countReserve, readOnlyFor) {
  const clockOffsetMs = (snapshot.serverTimeMs ?? Date.now()) - Date.now();
  const playerIds = () => snapshot.players.map((player) => player.id);
  const room = {
    database,
    secrets,
    verifyReceipt,
    get players() { return snapshot.players.map((player) => ({ ...player })); },
    get spectators() { return snapshot.spectators.map((spectator) => ({ ...spectator })); },
    broadcast(message, broadcastOptions) { const checked = checks.checkBroadcast(message, broadcastOptions); effects.push({ do: "broadcast", message, exceptPlayerId: checked.exceptPlayerId, audience: checked.audience, ...sendFields(checked) }); },
    send(playerId, message, sendOptions) { const checked = checks.checkSend(playerId, message, sendOptions); effects.push({ do: "send", playerId: checked.playerId, message, ...sendFields(checked) }); },
    broadcastBytes(bytes, broadcastOptions) { const checked = checks.checkBroadcastBytes(bytes, broadcastOptions); effects.push({ do: "broadcast_bytes", bytes: copyBytes(checked.bytes), exceptPlayerId: checked.exceptPlayerId, audience: checked.audience, ...sendFields(checked) }); },
    sendBytes(playerId, bytes, sendOptions) { const checked = checks.checkSendBytes(playerId, bytes, sendOptions); effects.push({ do: "send_bytes", playerId: checked.playerId, bytes: copyBytes(checked.bytes), ...sendFields(checked) }); },
    end(message) { effects.push({ do: "end", message: checks.checkEnd(message) }); },
    get isListed() { return snapshot.isListed; },
    setListed(isListed) { snapshot.isListed = Boolean(isListed); effects.push({ do: "listed", isListed: snapshot.isListed }); },
    get isOpen() { return snapshot.isOpen; },
    setOpen(isOpen) { snapshot.isOpen = Boolean(isOpen); effects.push({ do: "open", isOpen: snapshot.isOpen }); },
    get friendJoinsEnabled() { return snapshot.friendJoinsEnabled; },
    setFriendJoinsEnabled(isEnabled) { snapshot.friendJoinsEnabled = Boolean(isEnabled); effects.push({ do: "friend_joins", friendJoinsEnabled: snapshot.friendJoinsEnabled }); },
    get isKept() { return snapshot.isKept === true; },
    get roomCode() { return typeof snapshot.roomCode === "string" ? snapshot.roomCode : STAND_IN_ROOM_CODE; },
    setKept(isKept) { snapshot.isKept = Boolean(isKept); effects.push({ do: "kept", isKept: snapshot.isKept }); },
    get name() { return snapshot.name; },
    get labels() { return { ...snapshot.labels }; },
    get endsAt() { return snapshot.endsAt ?? null; },
    setInfo(nameAndLabels) { effects.push({ do: "info", nameAndLabels: checks.checkSetInfo(nameAndLabels) }); },
    reserve(reserveOptions) {
      const checked = checks.checkReserve(reserveOptions, playerIds());
      countReserve("room.reserve");
      const roomCode = newRoomCode();
      effects.push({ do: "reserve", reserveOptions: checked, roomCode });
      return roomCode;
    },
    kick(playerId, kickOptions) { const checked = checks.checkKick(playerId, kickOptions); effects.push({ do: "kick", playerId: checked.playerId, kickOptions: { message: checked.message, keepOut: checked.isKeptOut } }); },
    moveTo(roomCode, moveOptions) {
      const checked = checks.checkMoveTo(roomCode, moveOptions, playerIds());
      countReserve("room.moveTo");
      effects.push({ do: "moveTo", roomCode: checked.toRoomCode, moveOptions: { playerIds: checked.playerIds, joinData: checked.joinData } });
    },
    hasBlockBetween(firstPlayerId, secondPlayerId) { return (snapshot.blockPairs || []).some((pair) => (pair[0] === firstPlayerId && pair[1] === secondPlayerId) || (pair[0] === secondPlayerId && pair[1] === firstPlayerId)); },
    areFriends(firstPlayerId, secondPlayerId) { return (snapshot.friendPairs || []).some((pair) => (pair[0] === firstPlayerId && pair[1] === secondPlayerId) || (pair[0] === secondPlayerId && pair[1] === firstPlayerId)); },
    pingDurationMs(playerId) { const pings = snapshot.pingDurationsMs || {}; return Object.hasOwn(pings, playerId) ? pings[playerId] : null; },
    serverTimeMs() { return Date.now() + clockOffsetMs; },
    awayReason(playerId) { const awayReasons = snapshot.awayReasons || {}; return Object.hasOwn(awayReasons, playerId) ? awayReasons[playerId] : null; },
    applyVersionUpdate() { effects.push({ do: "apply_version_update" }); },
  };
  if (readOnlyFor) {
    for (const call of CHANGING_CALLS) {
      room[call] = () => { throw new GameServerError("room_call_unavailable", "room." + call, readOnlyFor + " can't change the room.", "Only read from room in " + readOnlyFor + "; change the room in the handlers that run after it, like onJoin or onMessage."); };
    }
  }
  return room;
}

// Bytes the game hands the room, copied as they are now (the game may reuse its buffer).
function copyBytes(checked) {
  return new Uint8Array(checked.buffer.slice(checked.byteOffset, checked.byteOffset + checked.byteLength));
}

// A handler may be async (it awaits room.database): what it asked the room to do is handed back once it's done.
async function answer(handler, effects, state) {
  try {
    const next = await handler();
    return { state: next === undefined ? state : next, effects };
  } catch (error) {
    return { effects, error: String((error && error.stack) || error) };
  }
}

// room.secrets and server.secrets: plain text by name, which the game can read but not change.
function frozenSecrets(given) {
  const secrets = {};
  for (const [name, secretValue] of Object.entries(given && typeof given === "object" ? given : {})) if (typeof secretValue === "string") secrets[name] = secretValue;
  return Object.freeze(secrets);
}

class Session extends RpcTarget {
  #database;
  #secrets;
  #verifyReceipt;
  // The room's reserves and moves this minute, for the limit.
  #countReserve = reserveCounter();
  // A real-time room's state lives here between calls; a turn-based room's comes with each call.
  #state;
  // The room as the last call left it: each call sends only what changed.
  #room = { players: [], spectators: [], isListed: true, isOpen: true, friendJoinsEnabled: true, isKept: false, roomCode: STAND_IN_ROOM_CODE, name: null, labels: {}, endsAt: null, blockPairs: [], friendPairs: [], pingDurationsMs: {}, awayReasons: {}, serverTimeMs: Date.now(), backedUpPlayerIds: [] };
  // What each player was last sent of the state, with stateSyncEnabled; a fresh session sends everyone a full copy.
  #stateTracker = server.stateSyncEnabled === true ? stateSync.newStateTracker(MAXIMUM_STATE_VIEW_SIZE_BYTES) : null;
  constructor(database, secrets, verifyReceipt) {
    super();
    this.#database = database;
    this.#secrets = frozenSecrets(secrets);
    this.#verifyReceipt = verifyReceipt;
  }
  setSecrets(secrets) {
    this.#secrets = frozenSecrets(secrets);
  }
  settings() {
    return withLogs(() => ({
      optionNames: Object.keys(server),
      maximumPlayerCount: server.maximumPlayerCount,
      maximumSpectatorCount: server.maximumSpectatorCount,
      ticksPerSec: server.ticksPerSec,
      hostControlsEnabled: server.hostControlsEnabled,
      idleCheck: server.idleCheck,
      idleTimeoutSec: server.idleTimeoutSec,
      awayMode: server.awayMode,
      seatHoldDurationSec: server.seatHoldDurationSec,
      reconnectTimeoutSec: server.reconnectTimeoutSec,
      maximumRoomCountPerPlayer: server.maximumRoomCountPerPlayer,
      stateSaveIntervalSec: server.stateSaveIntervalSec,
      stateSyncEnabled: server.stateSyncEnabled,
      schedules: plain(server.schedules),
      handlerNames: HANDLERS.filter((name) => typeof server[name] === "function"),
      badHandlerNames: HANDLERS.filter((name) => server[name] !== undefined && typeof server[name] !== "function"),
    }));
  }
  setup(setupData) {
    return withLogs(async () => {
      const answered = await answer(() => server.setup(setupData), [], undefined);
      if (!answered.error) this.#state = answered.state;
      return answered;
    });
  }
  stateCopy() {
    return this.#state;
  }
  restore(state) {
    this.#state = state;
  }
  // This call's room: the kept one with what changed, copied, so what a handler sets (room.setListed) lasts only this call.
  #take(roomChanges) {
    const { fullCopyPlayerIds, ...changes } = roomChanges && typeof roomChanges === "object" ? roomChanges : {};
    Object.assign(this.#room, changes);
    if (this.#stateTracker && Array.isArray(fullCopyPlayerIds)) for (const playerId of fullCopyPlayerIds) this.#stateTracker.forget(playerId);
    return { ...this.#room };
  }
  call(hook, handlerArguments, roomChanges, given, queued) {
    return withLogs(() => this.#call(hook, handlerArguments, roomChanges, given, queued));
  }
  async #call(hook, handlerArguments, roomChanges, given, queued) {
    if (given) this.#state = given.state;
    const room = this.#take(roomChanges);
    const effects = [];
    const errors = await this.#input(queued, room, effects);
    const error = HOOKS.includes(hook) && typeof server[hook] === "function" ? await this.#run(hook, handlerArguments, room, effects) : null;
    // A turn-based room's state sync follows each call (hook "sync" runs only that); a real-time room's, each tick.
    if (given) this.#syncState(room, effects, errors);
    return { effects, ...(given && !error ? { state: this.#state } : {}), ...(error ? { error } : {}), ...listed(errors) };
  }
  tick(queued, tickDurationSec, roomChanges) {
    return withLogs(() => this.#tick(queued, tickDurationSec, roomChanges));
  }
  async #tick(queued, tickDurationSec, roomChanges) {
    const room = this.#take(roomChanges);
    const effects = [];
    const errors = await this.#input(queued, room, effects);
    if (typeof server.onTick === "function") {
      const error = await this.#run("onTick", [tickDurationSec], room, effects);
      if (error) errors.push(error);
    }
    this.#syncState(room, effects, errors);
    return { effects, ...listed(errors) };
  }
  // A round of state sync: each connected player's view (stateView) as a "state" effect, a full copy or what changed.
  #syncState(snapshot, effects, errors) {
    if (!this.#stateTracker) return;
    const awayReasons = snapshot.awayReasons || {};
    // Players in the match with a connection, and the spectators, who watch it.
    const viewers = new Map([...snapshot.players.filter((player) => awayReasons[player.id] !== "lost"), ...(snapshot.spectators || [])].map((player) => [player.id, player]));
    const state = this.#state;
    // stateView only answers; a call that changes the room throws room_call_unavailable.
    const viewRoom = typeof server.stateView === "function" ? recorder(snapshot, [], this.#database, this.#secrets, this.#verifyReceipt, this.#countReserve, "stateView") : null;
    const viewOf = viewRoom ? (playerId) => server.stateView(state, { ...viewers.get(playerId) }, viewRoom) : null;
    const round = this.#stateTracker.round(state, [...viewers.keys()], viewOf, new Set(snapshot.backedUpPlayerIds || []));
    for (const frame of round.frames) effects.push({ do: "state", playerIds: frame.playerIds, frame: frame.frame });
    errors.push(...round.problems);
  }
  // Players' messages and bytes that waited for this call, in the order they came. One that throws doesn't stop the rest.
  async #input(queued, room, effects) {
    const errors = [];
    for (const input of Array.isArray(queued) ? queued : []) {
      if ((input.hook !== "onMessage" && input.hook !== "onBytes") || typeof server[input.hook] !== "function") continue;
      const error = await this.#run(input.hook, [input.player, input.payload], room, effects);
      if (error) errors.push(error);
    }
    return errors;
  }
  // One handler on the state: what it answers is the new state (nothing keeps it). Answers the error it threw, or null.
  async #run(hook, handlerArguments, snapshot, effects) {
    const room = recorder(snapshot, effects, this.#database, this.#secrets, this.#verifyReceipt, this.#countReserve);
    // Every handler is (state, who or what it's about, room, then what else it hears): onJoin(state, player, room, joinData, joinInfo),
    // onMessage(state, player, room, message), onAway(state, player, room, awayInfo), onTick(state, tickDurationSec, room), and so on;
    // onEnding has only (state, room).
    const state = this.#state;
    const full = hook === "onEnding" ? [state, room] : [state, handlerArguments[0], room, ...handlerArguments.slice(1)];
    try {
      const next = await server[hook](...full);
      if (next === undefined) return null;
      // Anything but a plain object or an array is a mistake, and the state stays as it was.
      if (!isStateAnswer(next)) return String(badHandlerAnswer(hook, next).stack);
      this.#state = next;
      return null;
    } catch (error) {
      return String((error && error.stack) || error);
    }
  }
  check(player, joinData, roomChanges, given, joinInfo) {
    return withLogs(() => this.#check(player, joinData, roomChanges, given, joinInfo));
  }
  async #check(player, joinData, roomChanges, given, joinInfo) {
    if (given) this.#state = given.state;
    const snapshot = this.#take(roomChanges);
    if (typeof server.canJoin !== "function") return { answer: true };
    let answer;
    try {
      answer = await server.canJoin(this.#state, player, recorder(snapshot, [], this.#database, this.#secrets, this.#verifyReceipt, this.#countReserve, "canJoin"), joinData, joinInfo);
    } catch (error) {
      return { error: String((error && error.stack) || error) };
    }
    // Handed back as plain JSON; the room reads it like any game server's answer (true, false or { refusalMessage }).
    try {
      return { answer: answer === undefined ? null : JSON.parse(JSON.stringify(answer)) };
    } catch {
      return { answer: "(an answer that isn't plain JSON)" };
    }
  }
  // onRequest(player, request, server): no room and no state, only the game's database and secrets.
  request(player, request) {
    return withLogs(() => this.#request(player, request));
  }
  async #request(player, request) {
    if (typeof server.onRequest !== "function") return { error: "This game server has no onRequest" };
    let answer;
    try {
      answer = await server.onRequest(player, request, { database: this.#database, secrets: this.#secrets, verifyReceipt: this.#verifyReceipt });
    } catch (error) {
      return { error: String((error && error.stack) || error) };
    }
    // Handed back as plain JSON; the game's object checks its size like any game server's answer.
    if (answer === undefined || answer === null) return { answer: null };
    let text;
    try {
      text = JSON.stringify(answer);
    } catch {
      text = undefined;
    }
    if (text === undefined) return { error: "onRequest answered something that isn't plain JSON, like a function or an object that refers to itself. Answer numbers, text, true or false, null, lists and plain objects." };
    return { answer: JSON.parse(text) };
  }
  // onSchedule(run, server): like a request, with no player and nothing handed back.
  schedule(run) {
    return withLogs(() => this.#schedule(run));
  }
  async #schedule(run) {
    if (typeof server.onSchedule !== "function") return { error: "This game server has no onSchedule" };
    try {
      await server.onSchedule(run, { database: this.#database, secrets: this.#secrets, verifyReceipt: this.#verifyReceipt });
      return {};
    } catch (error) {
      return { error: String((error && error.stack) || error) };
    }
  }
  // onWebhook(event, server): like a run, with the webhook's event.
  webhook(event) {
    return withLogs(() => this.#webhook(event));
  }
  async #webhook(event) {
    if (typeof server.onWebhook !== "function") return { error: "This game server has no onWebhook" };
    try {
      await server.onWebhook(event, { database: this.#database, secrets: this.#secrets, verifyReceipt: this.#verifyReceipt });
      return {};
    } catch (error) {
      return { error: String((error && error.stack) || error) };
    }
  }
}

// The errors a call's handlers threw, up to ERROR_COUNT of them, for its answer.
function listed(errors) {
  return errors.length ? { errors: errors.slice(0, ERROR_COUNT), errorCount: errors.length } : {};
}

// An option as plain JSON, or a note saying it isn't, for the game's object to report.
function plain(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return "(something that isn't plain JSON)";
  }
}

export default class extends WorkerEntrypoint {
  open(secrets) {
    if (!server || (typeof server.setup !== "function" && typeof server.onRequest !== "function" && typeof server.onSchedule !== "function" && typeof server.onWebhook !== "function")) throw new Error("${entry} must export default a game server with setup() for rooms, onRequest() for requests, onSchedule() for schedules or onWebhook() for webhooks");
    return new Session(gameDatabase(this.env.DATABASE), secrets, receiptChecker(this.env.RECEIPTS));
  }
}
`;

// Loaded before the game's own code, so the console it prints with is this one: each line goes to the
// call it was printed in (AsyncLocalStorage, since every room of a version shares this sandbox and their
// calls take turns at each await) and comes back with that call's answer. Lines printed outside any call,
// as the game's code loads or from a timer, go with the next answer. Nothing reaches Zaisma's own logs.
const logs = `
import { AsyncLocalStorage } from "node:async_hooks";
const LEVELS = ${JSON.stringify(LOG_LEVELS)};
const LINE_COUNT = ${LOG_LIMITS.callLineCount};
const CHARACTER_COUNT = ${LOG_LIMITS.lineCharacterCount};
const ERROR_LINE_COUNT = 20;
const store = new AsyncLocalStorage();
// The game's own code can replace Date.now: the clock this reports with is the one from before it loaded.
const nativeNow = Date.now.bind(Date);
let loose = { lines: [], droppedCount: 0 };
function text(given) {
  if (typeof given === "string") return given;
  if (given instanceof Error) return given.stack || String(given);
  try {
    const json = JSON.stringify(given);
    return json === undefined ? String(given) : json;
  } catch {
    return String(given);
  }
}
for (const level of LEVELS) {
  console[level] = (...values) => {
    const printed = store.getStore() || loose;
    if (printed.lines.length >= LINE_COUNT) {
      printed.droppedCount++;
      return;
    }
    let line;
    try {
      line = values.map(text).join(" ");
    } catch {
      line = "(something that can't be printed)";
    }
    printed.lines.push({ atMs: nativeNow(), level, text: line.length > CHARACTER_COUNT ? line.slice(0, CHARACTER_COUNT - 1) + "…" : line });
  };
}
console.trace = console.debug;
console.dir = console.log;
console.table = console.log;
// The time of the waits that ended in this call, each as [from, to]: overlapping waits (calls and timers
// running side by side) count once. Merged when they pile up, so a call with a timer per row stays small.
function waitsMerged(waits) {
  const sorted = waits.slice().sort((first, second) => first[0] - second[0]);
  const merged = [];
  for (const wait of sorted) {
    const last = merged[merged.length - 1];
    if (last && wait[0] <= last[1]) last[1] = Math.max(last[1], wait[1]);
    else merged.push([wait[0], wait[1]]);
  }
  return merged;
}
export function addWait(printed, fromMs, toMs) {
  if (!printed || printed.isDone || !(toMs > fromMs)) return;
  printed.waits.push([fromMs, toMs]);
  if (printed.waits.length > 256) printed.waits = waitsMerged(printed.waits);
}
// Runs work as one call, and hands back its answer with what it printed, when its handler began and how long it waited on I/O.
export async function withLogs(work) {
  // The clock moves only across I/O, so it is read once the call has had its turn: calls made at the same moment
  // take turns here, and the time a call waited for the others' turns isn't the game server running.
  await new Promise((resolve) => nativeSetTimeout(resolve, 0));
  const handlerStartedAtMs = nativeNow();
  const printed = { lines: loose.lines, droppedCount: loose.droppedCount, waits: [], isDone: false, refusalLines: [] };
  loose = { lines: [], droppedCount: 0 };
  let answer;
  try {
    answer = await store.run(printed, work);
  } finally {
    printed.isDone = true;
  }
  if (printed.droppedCount) printed.lines.push({ atMs: nativeNow(), level: "warn", text: "Zaisma: this call printed " + printed.droppedCount + " more lines than the " + LINE_COUNT + " a call keeps; they weren't kept." });
  const ioWaitDurationMs = waitsMerged(printed.waits).reduce((total, wait) => total + wait[1] - wait[0], 0);
  answer = { ...answer, handlerStartedAtMs, ...(ioWaitDurationMs ? { ioWaitDurationMs } : {}), ...(printed.refusalLines.length ? { refusalLines: printed.refusalLines } : {}) };
  return printed.lines.length ? { ...answer, logLines: printed.lines } : answer;
}
// A refused outside call, for the game's server errors whether or not the game server catches it.
export function refused(line) {
  const printed = store.getStore();
  if (printed && !printed.isDone && printed.refusalLines.length < ERROR_LINE_COUNT && !printed.refusalLines.includes(line)) printed.refusalLines.push(line);
}
// Waits on the database or another server, counting the time toward the call's I/O wait: inside the
// sandbox the clock moves only across I/O, so the rest of a call's time is the game server running.
export async function timedWait(waited) {
  const printed = store.getStore();
  const startedAtMs = nativeNow();
  try {
    return await waited;
  } finally {
    addWait(printed, startedAtMs, nativeNow());
  }
}
// A timer's wait counts too, once it fires inside the call. The clock only moves across I/O, so the
// time since the timer was set can include work done before it was; the wait is at most the delay.
const nativeSetTimeout = globalThis.setTimeout;
const nativeSetInterval = globalThis.setInterval;
function timerWait(printed, sinceMs, delay) {
  const nowMs = nativeNow();
  addWait(printed, nowMs - Math.min(nowMs - sinceMs, Math.max(0, Number(delay) || 0)), nowMs);
  return nowMs;
}
globalThis.setTimeout = function setTimeout(callback, delay, ...rest) {
  const printed = store.getStore();
  if (!printed || typeof callback !== "function") return nativeSetTimeout(callback, delay, ...rest);
  const setAtMs = nativeNow();
  return nativeSetTimeout(function (...given) {
    timerWait(printed, setAtMs, delay);
    callback.apply(this, given);
  }, delay, ...rest);
};
globalThis.setInterval = function setInterval(callback, delay, ...rest) {
  const printed = store.getStore();
  if (!printed || typeof callback !== "function") return nativeSetInterval(callback, delay, ...rest);
  let sinceMs = nativeNow();
  return nativeSetInterval(function (...given) {
    sinceMs = timerWait(printed, sinceMs, delay);
    callback.apply(this, given);
  }, delay, ...rest);
};
if (globalThis.scheduler && typeof globalThis.scheduler.wait === "function") {
  const nativeWait = globalThis.scheduler.wait.bind(globalThis.scheduler);
  globalThis.scheduler.wait = async function wait(delay, options) {
    const printed = store.getStore();
    const setAtMs = nativeNow();
    await nativeWait(delay, options);
    timerWait(printed, setAtMs, delay);
  };
}
`;

// Loaded before the game's own code, so the fetch it finds is this one: a call our gateway refused
// (outbound.ts) throws an OutsideCallError saying why and what to do, instead of answering like the
// server it was meant for. The gateway decides either way; this only shapes the error.
const outsideCalls = `
import { timedWait, refused } from "./logs.js";
class OutsideCallError extends Error {
  constructor(error) {
    super(error.message + " " + error.fix + " (" + error.code + ")");
    this.name = "OutsideCallError";
    this.code = error.code;
    this.fix = error.fix;
  }
  // The same error as @zaisma/game-server's, whichever copy a game checks with.
  static [Symbol.hasInstance](candidate) {
    return candidate instanceof Error && candidate.name === "OutsideCallError" && ${JSON.stringify(OUTSIDE_CALL_ERROR_CODES)}.includes(candidate.code);
  }
}
const outsideFetch = globalThis.fetch;
globalThis.fetch = async function fetch(input, init) {
  // Where the game server called from: after the awaits below that is gone from the error's own stack.
  const calledFrom = new Error().stack;
  const response = await timedWait(outsideFetch(input, init));
  if (!response.headers.has("${OUTSIDE_CALL_REFUSAL_HEADER}")) return response;
  let error;
  try {
    error = (await response.json()).error;
  } catch {
    error = { code: response.headers.get("${OUTSIDE_CALL_REFUSAL_HEADER}"), message: "The call was refused.", fix: "" };
  }
  // Shown in the game's server errors with its code, whether or not the game server catches the error.
  refused("OutsideCallError: " + String(error.message).replace(/\\.$/, "") + " (" + error.code + ")");
  const failure = new OutsideCallError(error);
  failure.stack = failure.name + ": " + failure.message + String(calledFrom).replace(/^[^\\n]*/, "");
  throw failure;
};
globalThis.OutsideCallError = OutsideCallError;
// Reading an answer's body is a wait on the other server too, not the game server running.
for (const name of ["text", "json", "arrayBuffer", "blob", "formData", "bytes"]) {
  const read = Response.prototype[name];
  if (typeof read !== "function") continue;
  Response.prototype[name] = function (...given) {
    return timedWait(read.apply(this, given));
  };
}
for (const Reader of [globalThis.ReadableStreamDefaultReader, globalThis.ReadableStreamBYOBReader]) {
  const read = Reader && Reader.prototype.read;
  if (typeof read !== "function") continue;
  Reader.prototype.read = function (...given) {
    return timedWait(read.apply(this, given));
  };
}
`;

/** A version's game server files and their code, or null if it has none (or too much). */
async function serverCode(env: Env, versionId: string): Promise<{ entry: string; modules: Record<string, string | WorkerLoaderModule> } | null> {
  const version = await env.DB.prepare("SELECT id, kind, r2_prefix FROM versions WHERE id = ?").bind(versionId).first<{ id: string; kind: "zip" | "files"; r2_prefix: string }>();
  if (!version) return null;
  const manifest = version.kind === "files" ? ((await (await env.GAMES.get(manifestKey(version.id)))?.json<Manifest>()) ?? null) : null;
  const found = await serverModules(env.GAMES, version, manifest);
  if (!found || "error" in found) return null;
  const modules: Record<string, string | WorkerLoaderModule> = {};
  for (const file of found.files) {
    const object = await env.GAMES.get(file.key);
    if (!object) return null;
    // import levels from "./levels.json" gives the data; import physics from "./physics.wasm" a WebAssembly.Module.
    if (file.path.endsWith(".wasm")) modules[file.path] = { wasm: await object.arrayBuffer() };
    else if (file.path.endsWith(".json")) {
      try {
        modules[file.path] = { json: JSON.parse(await object.text()) };
      } catch {
        throw new Error(`${file.path} isn't valid JSON`);
      }
    } else modules[file.path] = { js: await object.text() };
  }
  return { entry: found.entry, modules };
}

/**
 * How to open a session with a game version's server in its sandbox. One sandbox per game version,
 * shared by all its rooms and its requests in a place, and warm while in use. Null if the version has
 * no game server file.
 */
export async function sandboxOpener(env: Env, exports: Cloudflare.Exports, gameId: string, versionId: string): Promise<((secrets: Record<string, string>) => Promise<Session>) | null> {
  const code = await serverCode(env, versionId);
  if (code === null) return null;
  await noteLoadedVersion(env.DB, gameId, versionId);
  const ours = exports as unknown as Record<"GameDatabaseBinding" | "GameServerOutbound" | "ReceiptCheckBinding", (options: { props: { gameId: string } }) => Fetcher>;
  const worker = env.LOADER.get(`${gameId}:${versionId}`, () => ({
    compatibilityDate: "2026-10-01",
    mainModule: "harness.js",
    // The game's files keep their paths, so its relative imports work: ./physics.js from zaisma-server/index.js.
    modules: { ...code.modules, "harness.js": harness(code.entry), "outside-calls.js": outsideCalls, "logs.js": logs, "state-sync.js": stateSyncModuleSource(), "room-calls.js": roomCallChecksModuleSource() },
    // AsyncLocalStorage, so each call's lines stay with it (logs.js).
    compatibilityFlags: ["nodejs_als"],
    // Its internet is our gateway, which takes only https to the hosts the game lists; and two bindings,
    // its own game's database (room.database) and receipt checks for its own game (room.verifyReceipt).
    // All are fixed to the game by props it can't see.
    globalOutbound: ours.GameServerOutbound({ props: { gameId } }),
    env: { DATABASE: ours.GameDatabaseBinding({ props: { gameId } }), RECEIPTS: ours.ReceiptCheckBinding({ props: { gameId } }) },
    limits: { cpuMs: CPU_MS },
  }));
  return (secrets) => (worker.getEntrypoint() as unknown as { open(secrets: Record<string, string>): Promise<Session> }).open(secrets);
}

/** A game version's server in its sandbox, with the game's secrets, as a game server the room can run. Null if the version has none. */
export async function sandboxServer(env: Env, exports: Cloudflare.Exports, gameId: string, versionId: string, secrets: Record<string, string>, onBroken: () => void, onNewError?: () => void, onLogLines?: (lines: PrintedLogLine[]) => void): Promise<SandboxServer | null> {
  const open = await sandboxOpener(env, exports, gameId, versionId);
  return open === null ? null : wrapSession(open, onBroken, secrets, onNewError, onLogLines);
}

/**
 * The lines a call into the sandbox printed, plus its error in full when it threw, for the game's logs
 * (docs/DEVELOPER-API.md, "A game server's logs"). The error goes in as a line of its own because a
 * game server that throws prints nothing about it.
 */
/**
 * Whether a game server failed to start because of the game's own code (an option it doesn't take, no
 * setup, its code throwing, a file that isn't valid JSON), which trying again won't fix, rather than
 * Zaisma's side (storage, secrets, the sandbox itself) failing for a moment.
 */
export function isGameStartError(error: unknown): boolean {
  if (error instanceof GameServerError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith("Game server error:") || message.endsWith("isn't valid JSON");
}

export function linesOf(answer: { logLines?: unknown; error?: unknown } | null | undefined, extraError?: string): PrintedLogLine[] {
  const lines = readPrintedLines(answer?.logLines);
  const error = extraError ?? (typeof answer?.error === "string" && answer.error ? answer.error : undefined);
  if (error) lines.push({ atMs: Date.now(), level: "error", text: logText(error) });
  return lines;
}

/**
 * A sandboxed game server as a room runs it: its stats, a way to hand it the game's secrets again, and,
 * for a real-time room, a copy of its state (stateCopy) and a way to start again from one (restore).
 */
export type SandboxServer = GameServer & {
  stats: SandboxStats;
  setSecrets(secrets: Record<string, string>): Promise<void>;
  /** A real-time room's state as it is now (the last copy if the sandbox can't answer), or undefined for a turn-based room. */
  stateCopy(): Promise<unknown>;
  /** Carry on from this copy of a real-time room's state, from the next call. */
  restore(state: unknown): Promise<void>;
};

/** What the room last sent the session, to send only what changed; pairChangeCount undefined means always look again. */
interface SentRoom {
  playersKey: string;
  spectatorsKey: string;
  settingsKey: string;
  pingsKey: string;
  awayReasonsKey: string;
  pairsKey: string;
  pairChangeCount: number | undefined;
  backedUpKey: string;
}

/** A game server's options as the sandbox reports them, as the game gave them, so defineGameServer checks them like any game server's. */
export function optionsOf(settings: Settings) {
  return {
    ...(settings.maximumPlayerCount !== undefined ? { maximumPlayerCount: settings.maximumPlayerCount as number } : {}),
    ...(settings.maximumSpectatorCount !== undefined ? { maximumSpectatorCount: settings.maximumSpectatorCount as number } : {}),
    ...(settings.ticksPerSec !== undefined ? { ticksPerSec: settings.ticksPerSec as number } : {}),
    ...(settings.hostControlsEnabled !== undefined ? { hostControlsEnabled: settings.hostControlsEnabled as boolean } : {}),
    ...(settings.idleCheck !== undefined ? { idleCheck: settings.idleCheck as GameServer["idleCheck"] } : {}),
    ...(settings.idleTimeoutSec !== undefined ? { idleTimeoutSec: settings.idleTimeoutSec as number } : {}),
    ...(settings.awayMode !== undefined ? { awayMode: settings.awayMode as GameServer["awayMode"] } : {}),
    ...(settings.seatHoldDurationSec !== undefined ? { seatHoldDurationSec: settings.seatHoldDurationSec as number } : {}),
    ...(settings.reconnectTimeoutSec !== undefined ? { reconnectTimeoutSec: settings.reconnectTimeoutSec as number } : {}),
    ...(settings.maximumRoomCountPerPlayer !== undefined ? { maximumRoomCountPerPlayer: settings.maximumRoomCountPerPlayer as number } : {}),
    ...(settings.stateSaveIntervalSec !== undefined ? { stateSaveIntervalSec: settings.stateSaveIntervalSec as number } : {}),
    ...(settings.stateSyncEnabled !== undefined ? { stateSyncEnabled: settings.stateSyncEnabled as boolean } : {}),
  };
}

/**
 * A game server that runs its handlers through a session with the sandbox. If the sandbox itself
 * fails (over its CPU limit, or restarted), that call is lost and the next gets a fresh session;
 * after FAILURE_COUNT of those, onBroken is called once and every later call fails at once. A game
 * server with an option it doesn't take, or one out of range, doesn't start (GameServerError).
 * onNewError is called for each distinct error the room hasn't kept yet, so it records it soon.
 */
export async function wrapSession(open: (secrets: Record<string, string>) => Promise<Session>, onBroken: () => void, secrets: Record<string, string> = {}, onNewError?: () => void, onLogLines?: (lines: PrintedLogLine[]) => void): Promise<SandboxServer> {
  // A fresh session after a failure gets the secrets as they are by then.
  let currentSecrets = secrets;
  const openedAtMs = Date.now();
  let session = await open(currentSecrets);
  const settings = await session.settings();
  const startupCpuDurationMs = Date.now() - openedAtMs;
  const printed = (lines: PrintedLogLine[]) => {
    if (lines.length) onLogLines?.(lines);
  };
  printed(linesOf(settings));
  const optionNames = Array.isArray(settings.optionNames) ? settings.optionNames.map(String) : [];
  for (const name of optionNames) if (!(GAME_SERVER_OPTIONS as readonly string[]).includes(name)) throw unknownOptionError(name);
  const handlerNames = new Set(Array.isArray(settings.handlerNames) ? settings.handlerNames.map(String) : []);
  // A game server for requests or schedules alone doesn't run rooms, and one whose schedules don't read doesn't start anywhere.
  if (!handlerNames.has("setup")) throw noSetupError();
  checkSchedules(settings.schedules, handlerNames.has("onSchedule"));
  const stats: SandboxStats = { callCount: 0, waitDurationMs: 0, cpuDurationMs: 0, sessionCount: 1, startupCpuDurationMs, failureCount: 0, crashCount: 0, stoppedCount: 0, errors: new Map() };
  // Errors this session already reported as new: stats.errors empties each time the room records them, and a repeat isn't new.
  const reportedErrorKeys = new Set<string>();
  const record = (kind: "crash" | "stopped", text: string) => {
    const message = errorLine(text);
    const seen = stats.errors.get(`${kind}\n${message}`);
    if (seen) seen.occurrenceCount++;
    // A room keeps a handful of distinct errors; a game that throws a new message every tick can't fill the table.
    else if (stats.errors.size < MAXIMUM_ERROR_COUNT) {
      stats.errors.set(`${kind}\n${message}`, { kind, message, occurrenceCount: 1, firstAtMs: Date.now() });
      if (!reportedErrorKeys.has(`${kind}\n${message}`) && reportedErrorKeys.size < MAXIMUM_ERROR_COUNT) {
        reportedErrorKeys.add(`${kind}\n${message}`);
        onNewError?.();
      }
    }
  };

  // A real-time game server keeps its state in the sandbox, and its players' input waits in the room for the next call.
  const isTicking = settings.ticksPerSec !== undefined;
  const isSyncingState = settings.stateSyncEnabled === true;
  const queued: Queued[] = [];
  /** The room as the session last heard it; null when a fresh session needs all of it. */
  let sent: SentRoom | null = null;
  /** A real-time room's last copy of its state (setup's, then stateCopy's), for a fresh session to start from. */
  let lastCopy: unknown = undefined;
  /** A fresh session that hasn't had the last copy yet. */
  let needsRestore = false;

  /** One call into the sandbox, counting it and its CPU, and handling a sandbox that fails. */
  const reach = async <T extends Printed & { error?: string }>(work: () => Promise<T>): Promise<T> => {
    const startedAtMs = Date.now();
    if (stats.failureCount >= FAILURE_COUNT) throw new Error("This game's server stopped working");
    let answer: T;
    try {
      if (needsRestore) {
        await session.restore(lastCopy);
        needsRestore = false;
      }
      answer = await work();
    } catch (error) {
      stats.stoppedCount++;
      const stopped = /CPU time/i.test(String(error)) ? "Ran on too long and was stopped, like a loop that never ends" : `The game server stopped: ${String(error)}`;
      record("stopped", stopped);
      printed(linesOf(null, `Zaisma: ${stopped}`));
      if (++stats.failureCount >= FAILURE_COUNT) onBroken();
      else {
        const reopenedAtMs = Date.now();
        session = await open(currentSecrets);
        stats.sessionCount++;
        stats.startupCpuDurationMs += Date.now() - reopenedAtMs;
        sent = null;
        needsRestore = isTicking;
      }
      throw error;
    }
    const callDurationMs = Date.now() - startedAtMs;
    stats.callCount++;
    stats.waitDurationMs += callDurationMs;
    // The call's time less its waits on the database and other servers: the game server running, plus the call's own small cost.
    stats.cpuDurationMs += Math.max(0, callDurationMs - (typeof answer.ioWaitDurationMs === "number" ? answer.ioWaitDurationMs : 0));
    printed(linesOf(answer));
    // Outside calls the gateway refused, whether or not the game server caught them: each is a mistake for the developer to see.
    for (const line of refusalsOf(answer)) {
      stats.crashCount++;
      record("crash", line);
    }
    if (answer.error) {
      stats.crashCount++;
      record("crash", answer.error);
    }
    return answer;
  };
  const ask = async (work: () => Promise<Answer & Printed>, room: Room | null): Promise<unknown> => {
    const answer = await reach(work);
    // A call the room refused when it ran what the game asked for is a mistake in the game, like a handler that threw.
    const failures = room ? apply(answer.effects, room) : [];
    if (failures.length) {
      stats.crashCount += failures.length;
      for (const failure of failures) record("crash", failure);
      printed(failures.flatMap((failure) => linesOf(null, failure)));
    }
    // Input and tick handlers that threw: each is a crash, and the others' changes stand.
    const errors = Array.isArray(answer.errors) ? answer.errors.filter((error): error is string => typeof error === "string") : [];
    if (errors.length) {
      stats.crashCount += Math.max(errors.length, typeof answer.errorCount === "number" ? answer.errorCount : 0);
      for (const error of errors) record("crash", error);
      printed(errors.flatMap((error) => linesOf(null, error)));
    }
    if (answer.error) throw new Error(`Game server error: ${answer.error.slice(0, 2000)}`);
    return answer.state;
  };
  /**
   * What changed in the room since the last call: the players, the room's settings, pings, and the
   * block and friend pairs, which are looked for again only when the players or the room's pairs changed.
   */
  const roomChanges = (room: Room): RoomChanges => {
    const was = sent;
    const players = [...room.players];
    const playersKey = players.map((player) => `${player.id}\t${player.kind}\t${player.name}\t${player.ownedItemNames?.join(",") ?? ""}`).join("\n");
    const spectators = [...room.spectators];
    const spectatorsKey = spectators.map((spectator) => `${spectator.id}\t${spectator.kind}\t${spectator.name}`).join("\n");
    const settings = { isListed: room.isListed, isOpen: room.isOpen, friendJoinsEnabled: room.friendJoinsEnabled, isKept: room.isKept, roomCode: room.roomCode, name: room.name, labels: room.labels, endsAt: room.endsAt };
    const settingsKey = JSON.stringify(settings);
    const pingDurationsMs = pingsOf(room);
    const pingsKey = JSON.stringify(pingDurationsMs);
    const awayReasons = awayReasonsOf(room);
    const awayReasonsKey = JSON.stringify(awayReasons);
    const pairChangeCount = (room as unknown as { [PAIR_CHANGE_COUNT]?: number })[PAIR_CHANGE_COUNT];
    const changes: RoomChanges = { serverTimeMs: room.serverTimeMs() };
    // State sync's viewers: who's backed up, and the new connections that get a full copy.
    const viewers = isSyncingState ? (room as unknown as { [STATE_SYNC]?: StateSyncHooks })[STATE_SYNC]?.viewers() : undefined;
    const backedUpKey = viewers ? viewers.backedUpPlayerIds.join(" ") : "";
    if (viewers && (!was || was.backedUpKey !== backedUpKey)) changes.backedUpPlayerIds = viewers.backedUpPlayerIds;
    if (viewers?.fullCopyPlayerIds.length) changes.fullCopyPlayerIds = viewers.fullCopyPlayerIds;
    if (!was || was.playersKey !== playersKey) changes.players = players;
    if (!was || was.spectatorsKey !== spectatorsKey) changes.spectators = spectators;
    if (!was || was.settingsKey !== settingsKey) Object.assign(changes, settings);
    if (!was || was.pingsKey !== pingsKey) changes.pingDurationsMs = pingDurationsMs;
    if (!was || was.awayReasonsKey !== awayReasonsKey) changes.awayReasons = awayReasons;
    let pairsKey = was?.pairsKey ?? "";
    if (!was || was.playersKey !== playersKey || pairChangeCount === undefined || was.pairChangeCount !== pairChangeCount) {
      const blockPairs = pairsOf(room, (first, second) => room.hasBlockBetween(first, second));
      const friendPairs = pairsOf(room, (first, second) => room.areFriends(first, second));
      pairsKey = JSON.stringify([blockPairs, friendPairs]);
      if (!was || was.pairsKey !== pairsKey) Object.assign(changes, { blockPairs, friendPairs });
    }
    sent = { playersKey, spectatorsKey, settingsKey, pingsKey, awayReasonsKey, pairsKey, pairChangeCount, backedUpKey };
    return changes;
  };
  /** A turn-based room's state goes with each call; a real-time room's is in the sandbox. */
  const given = (state: unknown): GivenState => (isTicking ? null : { state });
  // The room as it is when the handler runs, even if the call waits (a fresh session's restore) while it changes.
  const call = (hook: string, state: unknown, handlerArguments: unknown[], room: Room) => {
    const changes = roomChanges(room);
    const input = queued.splice(0);
    return ask(() => session.call(hook, handlerArguments, changes, given(state), input), room);
  };
  /** A real-time room's input waits for the next call, which runs it first; RoomCore keeps its last state meanwhile. */
  const queue = (hook: Queued["hook"], player: Player, payload: unknown): undefined => {
    queued.push({ hook, player, payload });
    return undefined;
  };

  // The options pass through as the game gave them, so defineGameServer checks them like any game server's.
  const server = {
    ...optionsOf(settings),
    // The sandbox runs the game's stateView itself; this stands in for it, so its options are checked like any game server's.
    ...(handlerNames.has("stateView") ? { stateView: () => null } : {}),
    setup: async (setupData: unknown) => {
      const state = await ask(() => session.setup(setupData), null);
      if (isTicking) lastCopy = state;
      return state;
    },
    onJoin: (state: unknown, player: Player, room: Room, joinData: unknown, joinInfo: JoinInfo) => call("onJoin", state, [player, joinData, joinInfo], room),
    onLeave: (state: unknown, player: Player, room: Room, leaveInfo: LeaveInfo) => call("onLeave", state, [player, leaveInfo], room),
    onMessage: (state: unknown, player: Player, room: Room, message: unknown) => (isTicking ? queue("onMessage", player, message) : call("onMessage", state, [player, message], room)),
    onTick: (state: unknown, tickDurationSec: number, room: Room) => {
      if (!isTicking) return call("onTick", state, [tickDurationSec], room);
      // Nothing to run: no call. With state sync, every tick has its round.
      if (!queued.length && !handlerNames.has("onTick") && !isSyncingState) return undefined;
      const input = queued.splice(0);
      const changes = roomChanges(room);
      return ask(() => session.tick(input, tickDurationSec, changes), room);
    },
    onMoved: (state: unknown, moveResult: unknown, room: Room) => call("onMoved", state, [moveResult], room),
    // Only for game servers that have them: with onAway, players who walk away stay in the room; without onBytes, bytes are refused.
    ...(handlerNames.has("onBytes") ? { onBytes: (state: unknown, player: Player, room: Room, bytes: Uint8Array) => (isTicking ? queue("onBytes", player, bytes) : call("onBytes", state, [player, bytes], room)) } : {}),
    ...(handlerNames.has("onSpectatorJoin") ? { onSpectatorJoin: (state: unknown, spectator: Player, room: Room) => call("onSpectatorJoin", state, [spectator], room) } : {}),
    ...(handlerNames.has("onSpectatorLeave") ? { onSpectatorLeave: (state: unknown, spectator: Player, room: Room) => call("onSpectatorLeave", state, [spectator], room) } : {}),
    ...(handlerNames.has("onAway") ? { onAway: (state: unknown, player: Player, room: Room, awayInfo: AwayInfo) => call("onAway", state, [player, awayInfo], room) } : {}),
    ...(handlerNames.has("onBack") ? { onBack: (state: unknown, player: Player, room: Room) => call("onBack", state, [player], room) } : {}),
    ...(handlerNames.has("onEnding") ? { onEnding: (state: unknown, room: Room) => call("onEnding", state, [], room) } : {}),
    // Only for game servers that take purchases: a room without onPurchase never takes one.
    ...(handlerNames.has("onPurchase") ? { onPurchase: (state: unknown, player: Player, room: Room, purchase: Purchase) => call("onPurchase", state, [player, purchase], room) } : {}),
    ...(handlerNames.has("onRefund") ? { onRefund: (state: unknown, player: Player, room: Room, purchase: Purchase) => call("onRefund", state, [player, purchase], room) } : {}),
    ...(handlerNames.has("onRestored") ? { onRestored: (state: unknown, restoreInfo: RestoreInfo, room: Room) => call("onRestored", state, [restoreInfo], room) } : {}),
    ...(handlerNames.has("onVersionUpdate") ? { onVersionUpdate: (state: unknown, versionUpdate: VersionUpdate, room: Room) => call("onVersionUpdate", state, [versionUpdate], room) } : {}),
    ...(handlerNames.has("canJoin")
      ? {
          canJoin: async (state: unknown, player: Player, room: Room, joinData: unknown, joinInfo: JoinInfo) => {
            const changes = roomChanges(room);
            const checked = await reach(() => session.check(player, joinData, changes, given(state), joinInfo));
            if (checked.error) throw new Error(`Game server error: ${checked.error.slice(0, 2000)}`);
            // A wrong answer (like a string) turns the player away, and its developer sees why with the game's server errors.
            const read = readJoinAnswer(checked.answer);
            if ("mistake" in read) {
              stats.crashCount++;
              record("crash", read.mistake.message);
              printed(linesOf(null, read.mistake.message));
              throw new Error(`Game server error: ${read.mistake.message}`);
            }
            return checked.answer as JoinAnswer;
          },
        }
      : {}),
  } satisfies GameServer;
  defineGameServer(server);
  /** A round of state sync outside the game server's own calls, like a turn-based room's player reconnecting. */
  const syncState = async (state: unknown, room: Room): Promise<undefined> => {
    await call("sync", state, [], room);
    return undefined;
  };
  const setSecrets = async (secrets: Record<string, string>) => {
    currentSecrets = secrets;
    try {
      await session.setSecrets(secrets);
    } catch (error) {
      // The next session opens with them anyway.
      console.error("Couldn't hand the game server its new secrets:", error);
    }
  };
  const stateCopy = async (): Promise<unknown> => {
    if (!isTicking || needsRestore || stats.failureCount >= FAILURE_COUNT) return lastCopy;
    try {
      lastCopy = await session.stateCopy();
    } catch (error) {
      // The next call finds out and opens a fresh session; the last copy stands.
      console.error("Couldn't copy the game server's state:", error);
    }
    return lastCopy;
  };
  const restore = async (state: unknown): Promise<void> => {
    lastCopy = state;
    needsRestore = isTicking;
  };
  return { ...server, ...(isTicking ? { [QUEUES_INPUT]: true } : {}), ...(isSyncingState ? { [SYNCS_STATE]: syncState } : {}), stats, setSecrets, stateCopy, restore };
}

export interface SandboxStats {
  callCount: number;
  /** Time spent waiting on the game server, for our own measurements. */
  waitDurationMs: number;
  /** The game server's time running in its calls (each call's time less its I/O waits), for the hosting meter. */
  cpuDurationMs: number;
  /** Sessions opened with the sandbox (each one call Cloudflare bills; calls on an open session aren't), for the hosting meter. */
  sessionCount: number;
  /** The time opening those sessions took (loading the code, starting it, its options), counted as CPU on the hosting meter. */
  startupCpuDurationMs: number;
  /** Times the sandbox itself failed; FAILURE_COUNT of them end the room. */
  failureCount: number;
  crashCount: number;
  stoppedCount: number;
  errors: Map<string, { kind: "crash" | "stopped"; message: string; occurrenceCount: number; firstAtMs: number }>;
}

/** Distinct errors a room keeps until it records them. */
const MAXIMUM_ERROR_COUNT = 5;

/**
 * An error as its developer should see it: the message and where in zaisma-server.js it happened,
 * without our harness's lines. Up to 600 characters, so an unknown option's error keeps the whole list of options.
 */
export function errorLine(text: string): string {
  const lines = text.split("\n").map((line) => line.trim());
  const where = lines.find((line) => /zaisma-server[^\s:()]*\.js:\d+:\d+/.test(line))?.match(/zaisma-server[^\s:()]*\.js:\d+:\d+/)?.[0];
  const message = lines[0]!.replace(/^Error: /, "");
  return (where ? `${message} (${where})` : message).slice(0, 600);
}

/** The refused outside calls a call's answer reports, as lines for the game's server errors. */
export function refusalsOf(answer: Printed): string[] {
  return Array.isArray(answer.refusalLines) ? answer.refusalLines.filter((line): line is string => typeof line === "string") : [];
}

/** A broadcast effect's audience, as the room API takes it (it checks it). */
function audienceOf(effect: { audience?: unknown }): { audience?: Audience } {
  return effect.audience !== undefined && effect.audience !== null ? { audience: effect.audience as Audience } : {};
}

/** A send effect's delivery and latestKey, as the room API takes them (it checks them). */
function sendOptionsOf(effect: { delivery?: unknown; latestKey?: unknown; fromPlayerId?: unknown }): SendOptions {
  return {
    ...(effect.delivery !== undefined ? { delivery: effect.delivery as SendOptions["delivery"] } : {}),
    ...(effect.latestKey !== undefined ? { latestKey: effect.latestKey as string } : {}),
    ...(typeof effect.fromPlayerId === "string" ? { fromPlayerId: effect.fromPlayerId } : {}),
  };
}

/** Do what the game asked, through the same room API built-in game servers use, so the same checks apply. */
function apply(effects: unknown, room: Room): string[] {
  const failures: string[] = [];
  if (!Array.isArray(effects)) return failures;
  const asObject = (given: unknown): object => (given && typeof given === "object" ? given : {});
  // The sandbox checked each call as the game made it; the room checks them all again, since nothing from the sandbox is trusted.
  if (effects.length > MAXIMUM_EFFECT_COUNT) {
    failures.push(String(new GameServerError("room_call_limit", "room", `A handler made more than ${MAXIMUM_EFFECT_COUNT} room calls in one go.`, "Send fewer, bigger messages.")));
  }
  for (const effect of effects.slice(0, MAXIMUM_EFFECT_COUNT) as Effect[]) {
    try {
      switch (effect?.do) {
        case "broadcast":
          room.broadcast(effect.message, { ...(typeof effect.exceptPlayerId === "string" ? { exceptPlayerId: effect.exceptPlayerId } : {}), ...audienceOf(effect), ...sendOptionsOf(effect) });
          break;
        case "send":
          if (typeof effect.playerId === "string") room.send(effect.playerId, effect.message, sendOptionsOf(effect));
          break;
        case "broadcast_bytes":
          if (effect.bytes instanceof Uint8Array) {
            room.broadcastBytes(effect.bytes, {
              ...(typeof effect.exceptPlayerId === "string" ? { exceptPlayerId: effect.exceptPlayerId } : {}),
              ...audienceOf(effect),
              ...sendOptionsOf(effect),
            });
          }
          break;
        case "send_bytes":
          if (typeof effect.playerId === "string" && effect.bytes instanceof Uint8Array) room.sendBytes(effect.playerId, effect.bytes, sendOptionsOf(effect));
          break;
        case "state":
          (room as unknown as { [STATE_SYNC]?: StateSyncHooks })[STATE_SYNC]?.send(effect.playerIds, effect.frame);
          break;
        case "end":
          room.end(typeof effect.message === "string" ? effect.message : undefined);
          break;
        case "listed":
          room.setListed(effect.isListed === true);
          break;
        case "open":
          room.setOpen(effect.isOpen === true);
          break;
        case "friend_joins":
          room.setFriendJoinsEnabled(effect.friendJoinsEnabled === true);
          break;
        case "kept":
          room.setKept(effect.isKept === true);
          break;
        case "info":
          room.setInfo(asObject(effect.nameAndLabels) as never);
          break;
        case "reserve":
          (room as unknown as { [RESERVE_WITH_ROOM_CODE]: (reserveOptions: unknown, roomCode: unknown) => string })[RESERVE_WITH_ROOM_CODE](asObject(effect.reserveOptions), effect.roomCode);
          break;
        case "kick":
          if (typeof effect.playerId === "string") room.kick(effect.playerId, asObject(effect.kickOptions) as never);
          break;
        case "moveTo":
          room.moveTo(effect.roomCode as string, asObject(effect.moveOptions) as never);
          break;
        case "apply_version_update":
          room.applyVersionUpdate();
          break;
      }
    } catch (error) {
      failures.push(String(error));
    }
  }
  return failures;
}

/** The most room calls one handler answer may carry; the rest are dropped. */
const MAXIMUM_EFFECT_COUNT = 1000;
