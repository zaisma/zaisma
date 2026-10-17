/**
 * The game server API and the room logic shared by Zaisma rooms (Durable Objects)
 * and the Node runner, so a game behaves the same in both places.
 *
 * Words: the *client* is the game in the player's browser. The *game server* is the
 * developer's code that holds the official game state. A *room* is one live match,
 * running one copy of the game server. Names follow docs/NAMING.md.
 */

import { DatabaseError, type GameDatabase } from "./database.ts";
import { isRoomCode, roomCode } from "./names.ts";
import type { PlayerKind } from "./pass.ts";
import type { Server } from "./requests.ts";
import { readSchedules, type Schedule, type ScheduledRun } from "./schedules.ts";

export interface Player {
  /** An account's player ID is the same in every game; a guest's lasts only for their pass. */
  id: string;
  /** The account's name, or a guest's generated one like "Swift Fox 42". */
  name: string;
  /** A signed-in Zaisma account, or a guest. */
  kind: PlayerKind;
}

export interface Room {
  /** Players in the room right now, in join order. */
  readonly players: readonly Player[];
  /** Send a message to every player, or everyone but one (exceptPlayerId). */
  broadcast(message: unknown, broadcastOptions?: BroadcastOptions): void;
  /** Send a message to one player. */
  send(playerId: string, message: unknown): void;
  /** End the match: everyone is told why (message) and disconnected, and the room closes. */
  end(message?: string): void;
  /** Shown in room lists (the game page and Zaisma.rooms.list). A hidden room still works by code and link. */
  readonly isListed: boolean;
  setListed(isListed: boolean): void;
  /** Taking new players. A closed room lets back only players who were already in it. */
  readonly isOpen: boolean;
  setOpen(isOpen: boolean): void;
  /** The room's name, like "Ana's castle", or null. Up to 40 characters. */
  readonly name: string | null;
  /** Up to 4 labels players can filter by, like { Mode: "Classic", Map: "Docks" }. */
  readonly labels: Readonly<Record<string, string>>;
  /**
   * Name and label the room, from the game or from what a player typed. Names and labels a player
   * typed show on zaisma.com only if they pass Zaisma's text filter; your game is responsible for
   * them inside the game. Leave a field out to keep it; null clears it.
   */
  setInfo(nameAndLabels: RoomInfo): void;
  /**
   * Make a new room for some of this room's players, like a lobby starting a match, and move them
   * there. The new room runs this same game server: its setup(setupData) gets your setupData, only
   * the players named can join it (a closed room, until it opens), and it's hidden from room lists
   * unless you list it. Each player gets a "move" event in the game and joins when the game says so.
   * Returns the new room's code. setupData is plain JSON, up to 4 KB; players can read it but not change it.
   */
  reserve(reserveOptions: ReserveOptions): string;
  /**
   * Remove a player from the room, telling them why (message, up to 200 characters; your game's
   * words, so keep them within the content rules). keepOut keeps them out of this room for the rest
   * of the match, and out of any room it reserves after. onLeave runs once the current handler is done.
   */
  kick(playerId: string, kickOptions?: KickOptions): void;
  /**
   * Send some of this room's players to another room of this game that already exists, like back to
   * their party's match or into the next area of an open world. The other room's canJoin decides with
   * your joinData (plain JSON, up to 4 KB) and holds a seat for each player it takes for a minute,
   * even if it's closed to new players; its onJoin gets the same joinData. Each player taken gets a
   * "move" event in the game, which follows by default. onMoved then says who was taken and who was
   * turned away; they stay here.
   */
  moveTo(roomCode: string, moveOptions: MoveOptions): void;
  /**
   * The game's own SQLite database, shared by all its rooms and kept between matches: for what the
   * game server owns or must trust, like inventories, leaderboards and bans. Plain SQL, awaited in
   * any handler (which then runs as async). In Zaisma rooms it's part of the game's hosting; on your
   * own server the Node runner keeps it in a local file (--database), so the same code runs in both.
   */
  readonly database: GameDatabase;
  /**
   * The game's secrets, by name, like room.secrets.STRIPE_SECRET_KEY: set per game on Zaisma
   * (set_secret) and never shown again, or the environment variables on your own server. Calls to
   * other servers are plain fetch(); on Zaisma they reach the hosts the game lists in
   * game_server_allowed_hosts, and anything else throws an OutsideCallError.
   */
  readonly secrets: Readonly<Record<string, string>>;
}

export interface BroadcastOptions {
  /** A player who doesn't get it, like the one whose move this is. */
  exceptPlayerId?: string;
}

export interface MoveOptions {
  playerIds: string[];
  joinData?: unknown;
}

/** A player another room turned away (room.moveTo), with why: an error code and its message. */
export interface Refusal {
  player: Player;
  code: RoomErrorCode;
  message: string;
}

/** Who another room took (room.moveTo) and who it turned away. */
export interface MoveResult {
  roomCode: string;
  movedPlayers: Player[];
  refusals: Refusal[];
}

/**
 * How a player came in: fromRoomCode, the code of the room that sent them (room.moveTo), or null.
 * isReturning: they're coming back to the seat the room held for them, after walking away or losing their connection.
 */
export interface JoinInfo {
  fromRoomCode: string | null;
  isReturning: boolean;
}

/** Why a player walked away: no input (idle), or the game hidden in a real-time room. */
export type AwayReason = "idle" | "hidden";

/**
 * Why a player left: left (closed the game or left the room), lost (their connection dropped, and
 * the room holds their seat), idle or hidden (they walked away, and the room holds their seat), kicked.
 */
export type LeaveReason = "left" | "lost" | AwayReason | "kicked";

export interface LeaveInfo {
  reason: LeaveReason;
}

/** What one room asks another when moving players there; fromRoomCode is the asking room's, added by the transport. */
export interface MoveAsk {
  fromRoomCode: string;
  players: Player[];
  joinData: unknown;
}

/** The other room's answer to a MoveAsk: who it took, and who it turned away and why. */
export interface MoveAnswer {
  movedPlayerIds: string[];
  refusals: { playerId: string; code: RoomErrorCode; message: string }[];
}

export interface KickOptions {
  message?: string;
  keepOut?: boolean;
}

/** A room made for some players: who, the data its game server starts with, and how it shows. */
export interface ReserveOptions extends RoomInfo {
  playerIds: string[];
  setupData?: unknown;
  isListed?: boolean;
}

/** How a reserved room starts, as the room that made it sends it on. */
export interface RoomStart extends Pick<RoomSettings, "isListed" | "name" | "labels"> {
  playerIds: string[];
  setupData: unknown;
  /** Players kept out of the room that made this one, and why: they stay out of this one too. */
  keptOut?: Record<string, string>;
  /** The code of the room that made this one, where awayMode "lobby" sends players. Added by the transport. */
  lobbyRoomCode?: string;
}

/** A room's name and labels, as a game sets them. */
export interface RoomInfo {
  name?: string | null;
  labels?: Record<string, string | number> | null;
}

/** Who checks for players who give no input: the room (server), each player's game (client), or nobody (off). */
export type IdleCheck = "server" | "client" | "off";

/** What happens to a player who walks away: their seat is held (hold), or they're sent to the room that made this one (lobby). */
export type AwayMode = "hold" | "lobby";

/** A handler answers the new state, or nothing to keep it; an async handler (one that awaits room.database) answers it later. */
type HandlerResult<S> = void | S | Promise<void | S>;

export interface GameServer<S = any> {
  /** Up to 16. Defaults to 8. */
  maximumPlayerCount?: number;
  /** Ticks a second, up to 30. Leave out for turn-based games so the room can sleep between moves. */
  ticksPerSec?: number;
  /**
   * The room's first player is its host: they may hide, show, open, close and name the room, and
   * kick players, from the game. When the host leaves, the next player takes over. The relay has this on.
   */
  hostControlsEnabled?: boolean;
  /**
   * Who checks for players who give no input. "server" (the default): after idleTimeoutSec, the
   * player's game asks "Still there?", and 30 seconds later they walk away. "client": each player's
   * game decides (joinRoom({ idleTimeoutSec, idleCheckEnabled })), as the relay does. "off": nobody.
   */
  idleCheck?: IdleCheck;
  /** Seconds without input before "Still there?", 30 to 86400. Defaults to 600 (10 minutes). */
  idleTimeoutSec?: number;
  /**
   * What happens when a player walks away (idle, or the game hidden for 2 minutes in a real-time
   * room). "hold" (the default) takes them out of the match (onLeave) and holds their seat for
   * seatHoldDurationSec, so they come straight back to it. "lobby" sends them to the room that made
   * this one (room.reserve), holding their seat if there isn't one or it won't take them. Give onAway
   * to handle it yourself instead.
   */
  awayMode?: AwayMode;
  /**
   * How long the room holds a seat for a player who walked away or lost their connection, in
   * seconds: up to 1800, 0 for none. Defaults to 300. Held seats count toward maximumPlayerCount.
   */
  seatHoldDurationSec?: number;
  /**
   * The starting state. It must be plain JSON so a sleeping room can be saved and woken. setupData
   * is what room.reserve() passed when another room made this one, and null otherwise. Rooms need it;
   * a game server that only answers requests (onRequest) or runs on schedules can leave it out.
   */
  setup?(setupData: unknown): S;
  /**
   * A request from the player's game outside any room (Zaisma.server.request(request)), like a
   * leaderboard, a shop or a daily reward in a single-player game. Answer what the game gets back:
   * plain JSON, up to 1 MB, within 10 seconds. request is plain JSON from the player's browser, up
   * to 16 KB, so check it like any message; player is who sent it, from their player pass. There's no
   * room and no state: keep what lasts in server.database; server.secrets has the game's secrets. If it throws, the game gets
   * error.code "game_server_error" and you see the error with the game server's others.
   */
  onRequest?(player: Player, request: unknown, server: Server): unknown;
  /**
   * When the game server runs by itself, outside rooms and requests: daily resets, a weekly
   * leaderboard, a persistent world's turns. Up to 10, each a name and a cron in UTC (minute hour
   * day-of-month month day-of-week), so at most once a minute: [{ name: "daily-reset", cron: "0 0 * * *" }].
   */
  schedules?: Schedule[];
  /**
   * A schedule is due: run.name says which, run.scheduledAt the minute it was due (an ISO time, UTC).
   * There's no room, no player and no state: keep what lasts in server.database; server.secrets has the game's secrets. It has 30 seconds.
   * A run can rarely come twice or a little late (after a restart), so make it safe to repeat, like
   * a reset that checks run.scheduledAt against the last one it did. If it throws, you see the
   * error with the game server's others.
   */
  onSchedule?(run: ScheduledRun, server: Server): unknown;
  /**
   * joinData is what the player's game passed to joinRoom({ joinData }), like the character they
   * picked, or null. It comes from the player's browser, so check it like any message. For a player
   * another room sent (room.moveTo), joinData is what that room's game server passed, and
   * joinInfo.fromRoomCode is its code.
   */
  onJoin?(state: S, player: Player, room: Room, joinData: unknown, joinInfo: JoinInfo): HandlerResult<S>;
  /**
   * Say who may come in, before they join: answer true (or nothing) to let them in, false to turn them
   * away, or { refusalMessage } to turn them away with a message they see (up to 200 characters), like
   * a wrong room password in joinData or a full team. Anything else is a mistake and turns them away
   * too, logged as a game server error. Players coming back after a dropped connection don't ask
   * again. Only decide here; change the state in onJoin. If it throws, the player is turned away.
   * Players another room sends are asked when it sends them, with its joinData and
   * joinInfo.fromRoomCode, and not again when they arrive.
   */
  canJoin?(state: S, player: Player, room: Room, joinData: unknown, joinInfo: JoinInfo): JoinAnswer | Promise<JoinAnswer>;
  /** After room.moveTo: who the other room took, and who it turned away and why. */
  onMoved?(state: S, moveResult: MoveResult, room: Room): HandlerResult<S>;
  /** leaveInfo.reason says why they left; a player who lost their connection or walked away gets their seat held. */
  onLeave?(state: S, player: Player, room: Room, leaveInfo: LeaveInfo): HandlerResult<S>;
  /**
   * A player walked away. With onAway, they stay in the room and your game decides what happens:
   * kick them, move them (room.moveTo) or keep them. They don't count as playing meanwhile, and a
   * room where everyone is away stops ticking. onBack runs when they return.
   */
  onAway?(state: S, player: Player, room: Room, reason: AwayReason): HandlerResult<S>;
  onBack?(state: S, player: Player, room: Room): HandlerResult<S>;
  onMessage?(state: S, player: Player, message: unknown, room: Room): HandlerResult<S>;
  /** tickDurationSec: seconds since the last tick, about 1 / ticksPerSec (more when a tick was skipped). */
  onTick?(state: S, tickDurationSec: number, room: Room): HandlerResult<S>;
}

/**
 * What canJoin answers: true, or nothing (undefined or null), lets the player in; false turns them
 * away; { refusalMessage } turns them away with that message.
 */
export type JoinAnswer = boolean | { refusalMessage: string } | null | void;

function describeObject(given: object): string {
  try {
    return (JSON.stringify(given) ?? "an object").slice(0, 80);
  } catch {
    return "an object";
  }
}

/**
 * canJoin's answer as the room acts on it: let in, or turn away with a refusalMessage (null for the
 * usual one). Any other answer, like a string, is a mistake, described for the game server's errors.
 */
export function readJoinAnswer(answer: unknown): { isAllowed: true } | { isAllowed: false; refusalMessage: string | null } | { mistake: string } {
  if (answer === true || answer === undefined || answer === null) return { isAllowed: true };
  if (answer === false) return { isAllowed: false, refusalMessage: null };
  const refusalMessage = typeof answer === "object" && !Array.isArray(answer) ? (answer as { refusalMessage?: unknown }).refusalMessage : undefined;
  if (typeof refusalMessage === "string" && Object.keys(answer as object).length === 1) return { isAllowed: false, refusalMessage };
  const given = typeof answer === "string" ? `the text ${JSON.stringify(answer.slice(0, 60))}` : typeof answer === "object" ? describeObject(answer) : String(answer);
  return { mistake: `canJoin answered ${given}, so the player was turned away. Answer true (or nothing) to let them in, false to turn them away, or { refusalMessage: "Wrong room password." } to turn them away with a message.` };
}

/** Everything a game server object may have, in the order the docs give them. Anything else is refused. */
export const GAME_SERVER_OPTIONS = [
  "maximumPlayerCount",
  "ticksPerSec",
  "hostControlsEnabled",
  "idleCheck",
  "idleTimeoutSec",
  "awayMode",
  "seatHoldDurationSec",
  "setup",
  "onJoin",
  "canJoin",
  "onMoved",
  "onLeave",
  "onAway",
  "onBack",
  "onMessage",
  "onTick",
  "onRequest",
  "schedules",
  "onSchedule",
] as const satisfies readonly (keyof GameServer)[];

export const ROOM_LIMITS = {
  maximumPlayerCount: 16,
  defaultMaximumPlayerCount: 8,
  maximumTicksPerSec: 30,
  /** A room's name, its labels, and each label's name and value. */
  maximumNameCharacterCount: 40,
  maximumLabelCount: 4,
  maximumLabelNameCharacterCount: 16,
  maximumLabelValueCharacterCount: 24,
  /** Join data a player brings to a room, and setup data a reserved room starts with, as JSON. */
  maximumRoomDataSizeBytes: 4 * 1024,
  /** Rooms one room may reserve or move players to a minute: enough for a full lobby, not for a bug that does it every tick. */
  maximumReservesPerMin: 20,
  /** A kick's or a refusal's message. */
  maximumMessageCharacterCount: 200,
  /** Largest game message a client may send. */
  maximumGameMessageSizeBytes: 16 * 1024,
  /** Sustained game messages per second per player, with a short burst allowance. */
  gameMessagesPerSec: 30,
  gameMessageBurstCount: 60,
  /** The idle check's default and range (idleTimeoutSec, joinRoom({ idleTimeoutSec })). */
  defaultIdleTimeoutSec: 600,
  minimumIdleTimeoutSec: 30,
  maximumIdleTimeoutSec: 24 * 3600,
  /** How long a game hidden in a real-time room counts before its player is away. */
  hiddenTimeoutSec: 120,
  /** How long a seat is held by default, and at most (seatHoldDurationSec). */
  defaultSeatHoldDurationSec: 300,
  maximumSeatHoldDurationSec: 1800,
} as const;

/** "Still there?" waits this long for an answer, and the room this much more before it decides for itself. */
const IDLE_ASK_MS = 30_000;
const IDLE_GRACE_MS = 60_000;

/**
 * A game server object that breaks the rules, with a code, the option at fault and what to do
 * (like the developer API's errors, docs/NAMING.md).
 */
export class GameServerError extends Error {
  readonly code: "unknown_option" | "bad_option";
  readonly field: string;
  readonly fix: string;
  constructor(code: "unknown_option" | "bad_option", field: string, message: string, fix: string) {
    super(`${message} ${fix} (${code})`);
    this.code = code;
    this.field = field;
    this.fix = fix;
  }
}

/** The error for an option a game server doesn't take, naming the ones it does. */
export function unknownOptionError(field: string): GameServerError {
  return new GameServerError("unknown_option", field, `${field} isn't a game server option.`, `A game server takes: ${GAME_SERVER_OPTIONS.join(", ")}.`);
}

/** The error for a room whose game server has no setup(): it only answers requests or runs on schedules. */
export function noSetupError(): GameServerError {
  return new GameServerError("bad_option", "setup", "This game server has no setup(), so it can't run rooms; it only answers requests or runs on schedules.", "Add setup: (setupData) => ({ ...your starting state }) to run rooms too.");
}

/** A game server's schedules, checked (readSchedules), or GameServerError for the field schedules. */
export function checkSchedules(schedules: unknown, hasOnSchedule: boolean): Schedule[] {
  const read = readSchedules(schedules, hasOnSchedule);
  if ("message" in read) throw new GameServerError("bad_option", "schedules", read.message, read.fix);
  return read.schedules;
}

/** Check a game server's options once, when it's defined: unknown options and values out of range throw. */
export function defineGameServer<S>(server: GameServer<S>): GameServer<S> {
  for (const field of Object.keys(server ?? {})) if (!(GAME_SERVER_OPTIONS as readonly string[]).includes(field)) throw unknownOptionError(field);
  const bad = (field: string, message: string, fix: string) => new GameServerError("bad_option", field, message, fix);
  if (typeof server?.setup !== "function" && typeof server?.onRequest !== "function" && typeof server?.onSchedule !== "function") {
    throw bad(
      "setup",
      "A game server needs setup() to run rooms, onRequest() to answer requests or onSchedule() to run on schedules, or more than one.",
      "Add setup: (setupData) => ({ ...your starting state }) for rooms, onRequest(player, request, server) for requests, or schedules with onSchedule(run, server).",
    );
  }
  for (const field of GAME_SERVER_OPTIONS) {
    if (field.startsWith("on") || field === "canJoin" || field === "setup") {
      if (server[field] !== undefined && typeof server[field] !== "function") throw bad(field, `${field} isn't a function.`, `Give ${field} as a function, or leave it out.`);
    }
  }
  checkSchedules(server.schedules, typeof server.onSchedule === "function");
  const { maximumPlayerCount, ticksPerSec, hostControlsEnabled, idleCheck, idleTimeoutSec, awayMode, seatHoldDurationSec } = server;
  if (maximumPlayerCount !== undefined && !(Number.isInteger(maximumPlayerCount) && maximumPlayerCount >= 1 && maximumPlayerCount <= ROOM_LIMITS.maximumPlayerCount)) {
    throw bad("maximumPlayerCount", `maximumPlayerCount is ${JSON.stringify(maximumPlayerCount)}.`, `Give a whole number from 1 to ${ROOM_LIMITS.maximumPlayerCount}, like 8.`);
  }
  if (ticksPerSec !== undefined && !(typeof ticksPerSec === "number" && ticksPerSec > 0 && ticksPerSec <= ROOM_LIMITS.maximumTicksPerSec)) {
    throw bad("ticksPerSec", `ticksPerSec is ${JSON.stringify(ticksPerSec)}.`, `Give a number above 0 and up to ${ROOM_LIMITS.maximumTicksPerSec}, like 20, or leave it out for a turn-based game.`);
  }
  if (hostControlsEnabled !== undefined && typeof hostControlsEnabled !== "boolean") throw bad("hostControlsEnabled", "hostControlsEnabled isn't true or false.", "Give true or false.");
  if (idleCheck !== undefined && idleCheck !== "server" && idleCheck !== "client" && idleCheck !== "off") {
    throw bad("idleCheck", `idleCheck is ${JSON.stringify(idleCheck)}.`, 'Give "server" (the room checks, after idleTimeoutSec), "client" (each player\'s game decides) or "off".');
  }
  if (idleTimeoutSec !== undefined && !(typeof idleTimeoutSec === "number" && idleTimeoutSec >= ROOM_LIMITS.minimumIdleTimeoutSec && idleTimeoutSec <= ROOM_LIMITS.maximumIdleTimeoutSec)) {
    throw bad("idleTimeoutSec", `idleTimeoutSec is ${JSON.stringify(idleTimeoutSec)}.`, `Give seconds from ${ROOM_LIMITS.minimumIdleTimeoutSec} to ${ROOM_LIMITS.maximumIdleTimeoutSec}, like 600; to turn the idle check off, give idleCheck: "off".`);
  }
  if (awayMode !== undefined && awayMode !== "hold" && awayMode !== "lobby") throw bad("awayMode", `awayMode is ${JSON.stringify(awayMode)}.`, 'Give "hold" (hold their seat) or "lobby" (send them to the room that made this one).');
  if (seatHoldDurationSec !== undefined && !(typeof seatHoldDurationSec === "number" && seatHoldDurationSec >= 0 && seatHoldDurationSec <= ROOM_LIMITS.maximumSeatHoldDurationSec)) {
    throw bad("seatHoldDurationSec", `seatHoldDurationSec is ${JSON.stringify(seatHoldDurationSec)}.`, `Give seconds from 0 (no held seats) to ${ROOM_LIMITS.maximumSeatHoldDurationSec}, like 300.`);
  }
  return server;
}

/** Whether a room shows in room lists and takes new players, and its name and labels. */
export interface RoomSettings {
  isListed: boolean;
  isOpen: boolean;
  name: string | null;
  labels: Record<string, string>;
}

/**
 * Messages from the room to a client. Every message says its type; a game's own messages carry
 * theirs in data (docs/NAMING.md).
 *
 * Clients send {type: "hello", pass, joinData?, room?: {isListed?, name?, labels?}, idleTimeoutSec?,
 * idleCheckEnabled?} first (joinData is for canJoin and onJoin; the room's settings only count from
 * the player who makes it; the idle fields only where the game server's idleCheck is "client"), then
 * {type: "message", data}. With hostControlsEnabled, the host may also send {type: "room", isListed?,
 * isOpen?, name?, labels?} and {type: "kick", playerId, keepOut?}. hostPlayerId is null without host controls.
 *
 * Players who walk away (docs/DECISIONS.md): clients send the text "ping" every 30 seconds or so (the
 * room answers "pong"; a connection with no ping or message for about a minute is dropped), and
 * {type: "here"} now and then while the player gives input but the game sends nothing. They send
 * {type: "idle"} when the player didn't answer "Still there?", {type: "hidden"} and {type: "shown"} as
 * the game is hidden and shown (where welcome's awayChecks.hiddenTimeoutSec says it counts), and
 * {type: "back", joinData?, idleTimeoutSec?, idleCheckEnabled?} when the player returns. A player out
 * of the match with their seat held gets {type: "away"}, and once the seat is no longer held, their
 * connection closes with SEAT_GONE_CLOSE_CODE.
 */
export type ServerMessage =
  | { type: "welcome"; me: Player; players: Player[]; room: RoomSettings; hostPlayerId: string | null; awayChecks: AwayChecks }
  | { type: "players"; players: Player[]; hostPlayerId: string | null }
  | { type: "away"; reason: AwayReason; seatHoldDurationSec: number }
  | { type: "kicked"; message: string; isKeptOut: boolean }
  | { type: "room"; room: RoomSettings }
  | { type: "move"; roomCode: string }
  | { type: "message"; data: unknown }
  | { type: "error"; code: RoomErrorCode; message: string }
  | { type: "ended"; message: string };

export type RoomErrorCode =
  | "full"
  | "closed"
  | "ended"
  | "too_big"
  | "too_fast"
  | "bad_message"
  | "bad_pass"
  | "no_hello"
  | "not_allowed"
  | "game_unavailable"
  | "busy"
  | "kept_out"
  | "refused"
  | "no_room"
  | "month_limit"
  | "account_needed";

export const ERROR_TEXT: Record<RoomErrorCode, string> = {
  full: "This room is full.",
  closed: "This room isn't taking new players.",
  ended: "This match has ended.",
  too_big: "Message too big.",
  too_fast: "Too many messages. Slow down.",
  bad_message: "Messages must be JSON with a type the room takes.",
  bad_pass: "Your player pass isn't valid for this game.",
  no_hello: "Send your player pass first.",
  not_allowed: "Only the game server or the room's host can do that.",
  game_unavailable: "This game isn't available right now.",
  busy: "Rooms are busy. Try again soon.",
  kept_out: "You were removed from this room.",
  refused: "The game didn't let you into this room.",
  no_room: "That room isn't running.",
  month_limit: "This game has used this month's multiplayer time. New rooms open again next month.",
  account_needed: "Playing online needs a Zaisma account. Sign in on the game's page to play.",
};

/**
 * isListed, isOpen, the players who have been in the room, the players kept out of it and a reserved
 * room's setup data, saved with a sleeping room's state.
 */
export interface SavedRoom extends RoomSettings {
  knownPlayerIds: string[];
  setupData?: unknown;
  keptOut?: Record<string, string>;
  expected?: Record<string, Expected>;
  held?: Record<string, Held>;
  kept?: Record<string, AwayReason>;
  lobbyRoomCode?: string;
}

/** A seat held for a player out of the match: who, why they're out, and until when. */
export interface Held {
  player: Player;
  reason: "lost" | AwayReason;
  untilMs: number;
}

/** When a room counts its players as away, or null when it doesn't: no input (idle), and the game hidden. */
export interface AwayChecks {
  idleTimeoutSec: number | null;
  hiddenTimeoutSec: number | null;
}

/** A player another room is sending here: the join data it sent, where from, and until when their seat is held. */
export interface Expected {
  joinData: unknown;
  fromRoomCode: string;
  untilMs: number;
}

/** The idle check a player's game asked for, for idleCheck "client": its timeout, or none at all. */
export interface ClientIdle {
  idleTimeoutSec?: number;
  idleCheckEnabled?: boolean;
}

/** How long a room holds a seat for a player another room is sending. */
const SEAT_MS = 60_000;

/** How the room reaches players: a Durable Object's sockets, or a Node server's. */
export interface Transport {
  send(playerId: string, text: string): void;
  close(playerId: string, closeCode: number, reason: string): void;
  /** Set up a reserved room, then send each of its players a "move" message. Without it, rooms can't reserve. */
  reserve?(roomCode: string, start: RoomStart): void;
  /**
   * Ask another room of the game to take some players (its expect()), send each player it takes a
   * "move" message, then hand the answer to this room's moved(). Without it, rooms can't move players.
   */
  moveTo?(roomCode: string, ask: Omit<MoveAsk, "fromRoomCode">): void;
  /** The game's database, as room.database. Without it, its calls fail with database_unavailable. */
  database?: GameDatabase;
  /** The game's secrets, as room.secrets. Without them, there are none. */
  secrets?: Readonly<Record<string, string>>;
}

/** room.secrets and server.secrets where a game has none. */
export const NO_SECRETS: Readonly<Record<string, string>> = Object.freeze({});

/** room.database where the room has no database: every call fails, saying so. */
const NO_DATABASE: GameDatabase = {
  query: () => Promise.reject(new DatabaseError("database_unavailable", "This room has no game database.", "On your own server, start the Node runner with --database <file>, or pass database to startServer.")),
  batch: () => Promise.reject(new DatabaseError("database_unavailable", "This room has no game database.", "On your own server, start the Node runner with --database <file>, or pass database to startServer.")),
};

/**
 * Plain JSON within ROOM_LIMITS.maximumRoomDataSizeBytes, copied, or isValid false if it isn't.
 * Nothing (undefined or null) is null. Players' data that fails this is refused.
 */
export function checkRoomData(given: unknown): { isValid: true; checkedData: unknown } | { isValid: false } {
  if (given === undefined || given === null) return { isValid: true, checkedData: null };
  let text: string | undefined;
  try {
    text = JSON.stringify(given);
  } catch {
    return { isValid: false };
  }
  if (text === undefined || new TextEncoder().encode(text).length > ROOM_LIMITS.maximumRoomDataSizeBytes) return { isValid: false };
  return { isValid: true, checkedData: JSON.parse(text) };
}

/** An error for a client. message replaces the usual text, like the game's reason for turning a player away. */
export function errorMessage(code: RoomErrorCode, message?: string): string {
  return JSON.stringify({ type: "error", code, message: message || ERROR_TEXT[code] } satisfies ServerMessage);
}

/** Whether a player may come in, and if not, why. */
export type Admission = { isAllowed: true } | { isAllowed: false; code: RoomErrorCode; message?: string };

/** WebSocket close code for a match that ended normally. */
export const ENDED_CLOSE_CODE = 4000;
/** Close code for a player refused or removed by the room. */
export const REFUSED_CLOSE_CODE = 4001;
/** Close code for a player who walked away, once the room stops holding their seat. They may try to come back. */
export const SEAT_GONE_CLOSE_CODE = 4002;
/** Close code for a connection that stopped answering. */
export const NO_ANSWER_CLOSE_CODE = 4003;

/** How many past players a room remembers, so they can come back to a closed room, and how many it keeps out. */
const REMEMBERED_PLAYER_COUNT = 64;

const NOBODY_JOINED: JoinInfo = { fromRoomCode: null, isReturning: false };

export class RoomCore<S = any> {
  state: S;
  readonly players = new Map<string, Player>();
  ended = false;
  /** Messages received from clients, for usage counts. */
  messageCount = 0;
  /** Set when the state changed and a sleeping room should save it. */
  dirty = false;
  isListed = true;
  isOpen = true;
  name: string | null = null;
  labels: Record<string, string> = {};
  /** Set when the player count, isListed or isOpen changed, so the room list can be brought up to date. */
  listingChanged = false;
  /** Players who have been in this room, newest last: they may come back after it closes. */
  readonly known = new Set<string>();
  /** Players kicked and kept out for the rest of the match, with the message they were given. */
  readonly keptOut = new Map<string, string>();
  /** Players other rooms are sending here (room.moveTo), with a seat each until they arrive. */
  readonly expected = new Map<string, Expected>();
  /** Seats held for players out of the match (walked away, or lost their connection) until they come back or it runs out. */
  readonly held = new Map<string, Held>();
  /** Players who walked away that onAway kept in the room, and why. */
  readonly kept = new Map<string, AwayReason>();
  /** The room that made this one, where awayMode "lobby" sends players who walk away. */
  lobbyRoomCode: string | null = null;
  /** When each player in the match was last heard from, when their game was hidden, and the idle check their game asked for. */
  private presence = new Map<string, Presence>();
  /** Players this room is sending to its lobby for walking away, so onMoved doesn't hear of it. */
  private sentAway = new Set<string>();
  /** What a reserved room started with, kept so a room that starts over starts the same way. */
  private setupData: unknown = null;
  /** When this room last reserved rooms, for the limit. */
  private reservedAtMs: number[] = [];
  private buckets = new Map<string, { tokenCount: number; filledAtMs: number }>();
  private readonly now: () => number;
  readonly maximumPlayerCount: number;
  private readonly api: Room;
  readonly server: GameServer<S>;
  private readonly transport: Transport;
  /**
   * Set once a handler returns a promise (a game server in a sandbox): from then on handlers run
   * one after another, each with the state the last one left.
   */
  private queue: Promise<void> | null = null;
  /** Handlers waiting in the queue, so ticks don't pile up behind a slow game server. */
  private waitingCount = 0;
  /** Handlers running right now, and what waits for them to finish (a kicked player's onLeave). */
  private depth = 0;
  private afterHandler: (() => void)[] = [];

  /**
   * startOptions.start makes a reserved room: closed, open only to the players it was made for, and
   * set up with its setup data. A saved room (startOptions.room) wakes as it was, with
   * startOptions.presence saying when each of its players was last heard from and the idle check
   * their game asked for.
   */
  constructor(
    server: GameServer<S>,
    transport: Transport,
    startOptions: { state?: S; players?: Player[]; room?: SavedRoom; start?: RoomStart; presence?: Record<string, { seenAtMs?: number; clientIdle?: ClientIdle }>; now?: () => number } = {},
  ) {
    this.server = server;
    this.transport = transport;
    this.now = startOptions.now ?? Date.now;
    this.maximumPlayerCount = server.maximumPlayerCount ?? ROOM_LIMITS.defaultMaximumPlayerCount;
    for (const player of startOptions.players ?? []) {
      this.players.set(player.id, player);
      const was = startOptions.presence?.[player.id];
      this.presence.set(player.id, { seenAtMs: was?.seenAtMs ?? this.now(), clientIdle: clientIdle(was?.clientIdle) });
    }
    const saved = startOptions.room;
    if (saved) {
      this.isListed = saved.isListed !== false;
      this.isOpen = saved.isOpen !== false;
      this.name = saved.name ?? null;
      this.labels = saved.labels ?? {};
      for (const id of saved.knownPlayerIds ?? []) this.known.add(id);
      this.setupData = saved.setupData ?? null;
      this.keepOut(saved.keptOut);
      for (const [id, expected] of Object.entries(saved.expected ?? {})) this.expected.set(id, expected);
      for (const [id, held] of Object.entries(saved.held ?? {})) if (!this.players.has(id)) this.held.set(id, held);
      for (const [id, reason] of Object.entries(saved.kept ?? {})) if (this.players.has(id)) this.kept.set(id, reason);
      this.lobbyRoomCode = saved.lobbyRoomCode ?? null;
    } else if (startOptions.start) {
      const start = startOptions.start;
      this.isOpen = false;
      this.isListed = start.isListed;
      this.name = start.name;
      this.labels = start.labels;
      for (const id of start.playerIds) this.known.add(id);
      this.setupData = start.setupData ?? null;
      this.keepOut(start.keptOut);
      this.lobbyRoomCode = start.lobbyRoomCode ?? null;
    }
    for (const player of this.players.values()) this.remember(player.id);
    if (startOptions.state !== undefined) this.state = startOptions.state;
    else {
      if (typeof server.setup !== "function") throw noSetupError();
      const first = server.setup(this.setupData) as S | Promise<S>;
      if (isPromise(first)) {
        this.state = undefined as S;
        this.run(() => first);
      } else this.state = first;
    }
    const core = this;
    this.api = {
      get players() {
        return [...core.players.values()];
      },
      broadcast: (message, broadcastOptions) => this.broadcast(message, broadcastOptions?.exceptPlayerId),
      send: (playerId, message) => {
        if (this.players.has(playerId)) this.transport.send(playerId, JSON.stringify({ type: "message", data: message } satisfies ServerMessage));
      },
      end: (message) => this.end(message ?? "The match is over."),
      get isListed() {
        return core.isListed;
      },
      setListed: (isListed) => this.settle({ isListed: Boolean(isListed) }),
      get isOpen() {
        return core.isOpen;
      },
      setOpen: (isOpen) => this.settle({ isOpen: Boolean(isOpen) }),
      get name() {
        return core.name;
      },
      get labels() {
        return { ...core.labels };
      },
      setInfo: (nameAndLabels) => this.settle(tidyRoomInfo(closed(nameAndLabels, ["name", "labels"], "room.setInfo"))),
      reserve: (reserveOptions) => this.reserve(reserveOptions),
      kick: (playerId, kickOptions) => this.kick(playerId, kickOptions),
      moveTo: (toRoomCode, moveOptions) => this.moveTo(toRoomCode, moveOptions),
      database: transport.database ?? NO_DATABASE,
      secrets: transport.secrets ?? NO_SECRETS,
    };
  }

  /** What a sleeping room saves besides the game's state. */
  get saved(): SavedRoom {
    this.countHeldSeats();
    return {
      ...this.settings(),
      knownPlayerIds: [...this.known],
      ...(this.setupData !== null ? { setupData: this.setupData } : {}),
      ...(this.keptOut.size ? { keptOut: Object.fromEntries(this.keptOut) } : {}),
      ...(this.expected.size ? { expected: Object.fromEntries(this.expected) } : {}),
      ...(this.held.size ? { held: Object.fromEntries(this.held) } : {}),
      ...(this.kept.size ? { kept: Object.fromEntries(this.kept) } : {}),
      ...(this.lobbyRoomCode ? { lobbyRoomCode: this.lobbyRoomCode } : {}),
    };
  }

  /** Players in the match who haven't walked away: what room lists and "playing now" count. */
  get playingCount(): number {
    return this.players.size - this.kept.size;
  }

  /** Seats the room holds for players on their way (room.moveTo) or out of the match for now. */
  get heldSeatCount(): number {
    return this.countHeldSeats();
  }

  /** Resolves once every handler started so far has finished (at once for game servers that answer at once). */
  async settled(): Promise<void> {
    while (this.queue) {
      const queued = this.queue;
      await queued;
      if (this.queue === queued) return;
    }
  }

  get ticking(): boolean {
    return this.server.ticksPerSec !== undefined;
  }

  /**
   * Whether a player may come in: the room's own rules (over, kept out, closed, full), then the game
   * server's canJoin with the join data the player brought. Call before join; join checks the room's rules again.
   */
  async admit(player: Player, joinData: unknown = null): Promise<Admission> {
    const door = this.door(player.id);
    if (door) return door;
    // Players already in, players another room sent (asked when it sent them) and players coming back to a held seat don't ask again.
    if (this.players.has(player.id) || this.seat(player.id) || this.holding(player.id)) return { isAllowed: true };
    return this.ask(player, joinData, NOBODY_JOINED);
  }

  /** The game server's canJoin, then the room's rules again, since things may change while it decides. */
  private async ask(player: Player, joinData: unknown, joinInfo: JoinInfo): Promise<Admission> {
    const isMoving = joinInfo.fromRoomCode !== null;
    if (!this.server.canJoin) return this.door(player.id, isMoving) ?? { isAllowed: true };
    await this.settled();
    let answer: unknown;
    try {
      answer = await this.server.canJoin(this.state, player, this.api, joinData, joinInfo);
    } catch (error) {
      console.error("Game server error:", error);
      return { isAllowed: false, code: "refused" };
    }
    const read = readJoinAnswer(answer);
    if ("mistake" in read) {
      console.error(`Game server error: ${read.mistake}`);
      return { isAllowed: false, code: "refused" };
    }
    if (!read.isAllowed) {
      const message = tidy(read.refusalMessage, ROOM_LIMITS.maximumMessageCharacterCount);
      return { isAllowed: false, code: "refused", ...(message ? { message } : {}) };
    }
    return this.door(player.id, isMoving) ?? { isAllowed: true };
  }

  /**
   * The room's own rules for a player coming in, or null if they may. A player already in may always
   * come back, and a player another room sent, or whose seat is held, has a seat. isMoving: the game is
   * sending this player from another room, which a closed room still takes (closed keeps out
   * strangers, not the game).
   */
  private door(id: string, isMoving = false): Admission | null {
    if (this.ended) return { isAllowed: false, code: "ended" };
    const keptOutMessage = this.keptOut.get(id);
    if (keptOutMessage !== undefined) return { isAllowed: false, code: "kept_out", message: keptOutMessage };
    if (this.players.has(id) || this.seat(id) || this.holding(id)) return null;
    if (!isMoving && !this.isOpen && !this.known.has(id)) return { isAllowed: false, code: "closed" };
    if (this.players.size + this.countHeldSeats() >= this.maximumPlayerCount) return { isAllowed: false, code: "full" };
    return null;
  }

  /** Whether this room is holding a place for a player: they've been in it, another room is sending them, or their seat is held. */
  expects(id: string): boolean {
    return this.known.has(id) || this.seat(id) !== null || this.holding(id) !== null;
  }

  /** The seat held for a player out of the match, if it hasn't run out. */
  private holding(id: string): Held | null {
    const held = this.held.get(id);
    if (held && held.untilMs > this.now()) return held;
    if (held) {
      this.held.delete(id);
      this.listingChanged = true;
      this.dirty = true;
    }
    return null;
  }

  /** The seat held for a player another room is sending, if it hasn't run out. */
  private seat(id: string): Expected | null {
    const expected = this.expected.get(id);
    if (expected && expected.untilMs > this.now()) return expected;
    if (expected) this.expected.delete(id);
    return null;
  }

  /** Seats held for players other rooms are sending and players out of the match, dropping those that ran out. */
  private countHeldSeats(): number {
    let heldSeatCount = 0;
    for (const id of [...this.expected.keys()]) if (!this.players.has(id) && this.seat(id)) heldSeatCount++;
    for (const id of [...this.held.keys()]) if (this.holding(id)) heldSeatCount++;
    return heldSeatCount;
  }

  /**
   * Another room of the game wants to send players here (its room.moveTo). Each is checked like a
   * newcomer, with the room's rules and canJoin given the sending room's join data; those taken get a
   * seat for a minute. Says who was taken and who wasn't, and why.
   */
  async expect(ask: MoveAsk): Promise<MoveAnswer> {
    const answer: MoveAnswer = { movedPlayerIds: [], refusals: [] };
    const checked = checkRoomData(ask.joinData);
    const joinData = checked.isValid ? checked.checkedData : null;
    for (const player of ask.players) {
      const verdict: Admission = this.players.has(player.id)
        ? { isAllowed: false, code: "bad_message", message: "Already in that room." }
        : await this.ask(player, joinData, { fromRoomCode: ask.fromRoomCode, isReturning: false });
      if (verdict.isAllowed) {
        this.expected.set(player.id, { joinData, fromRoomCode: ask.fromRoomCode, untilMs: this.now() + SEAT_MS });
        answer.movedPlayerIds.push(player.id);
      } else answer.refusals.push({ playerId: player.id, code: verdict.code, message: verdict.message || ERROR_TEXT[verdict.code] });
    }
    if (answer.movedPlayerIds.length) this.dirty = true;
    return answer;
  }

  /**
   * A player arrives. Joining again with the same ID (a reconnect) keeps their place. The player who
   * makes the room can hide it from the start (a private match) and name and label it. joinData is
   * what the player's game sent along, for onJoin; clientIdle is the idle check it asked for (idleCheck "client").
   */
  join(
    player: Player,
    joinOptions: { isListed?: boolean; joinData?: unknown; clientIdle?: ClientIdle } & RoomInfo = {},
  ): { isAllowed: true; isRejoin: boolean } | { isAllowed: false; code: RoomErrorCode; message?: string } {
    const isRejoin = this.players.has(player.id);
    const door = this.door(player.id);
    if (door && !door.isAllowed) return door;
    // A player another room sent brings what that room's game server passed, not what their browser sent.
    const seat = isRejoin ? null : this.seat(player.id);
    const back = isRejoin || seat ? null : this.holding(player.id);
    this.expected.delete(player.id);
    if (back) this.held.delete(player.id);
    const joinData = seat ? seat.joinData : (joinOptions.joinData ?? null);
    const joinInfo: JoinInfo = seat ? { fromRoomCode: seat.fromRoomCode, isReturning: false } : back ? { fromRoomCode: null, isReturning: true } : NOBODY_JOINED;
    if (this.known.size === 0) {
      if (joinOptions.isListed === false) this.isListed = false;
      Object.assign(this, tidyRoomInfo({ name: joinOptions.name, labels: joinOptions.labels }));
    }
    this.players.set(player.id, player);
    this.remember(player.id);
    this.presence.set(player.id, { seenAtMs: this.now(), clientIdle: joinOptions.clientIdle === undefined ? (this.presence.get(player.id)?.clientIdle ?? {}) : clientIdle(joinOptions.clientIdle) });
    this.transport.send(player.id, JSON.stringify({ type: "welcome", me: player, players: this.list(), room: this.settings(), hostPlayerId: this.hostPlayerId, awayChecks: this.checks(player.id) } satisfies ServerMessage));
    if (!isRejoin) {
      this.listingChanged = true;
      this.run(() => this.server.onJoin?.(this.state, player, this.api, joinData, joinInfo));
      this.broadcastPlayers();
    } else if (this.kept.has(player.id)) this.back(player.id);
    return { isAllowed: true, isRejoin };
  }

  /**
   * A player's connection closed: they left (closed the game, or followed a move), or it was lost. A
   * lost player's seat is held for a while, so they can come straight back.
   */
  leave(playerId: string, reason: "left" | "lost" = "left"): void {
    if (this.held.has(playerId)) {
      // A player out of the match went for good: their seat is free. A lost connection keeps it held.
      if (reason === "left") {
        this.held.delete(playerId);
        this.listingChanged = true;
        this.dirty = true;
      }
      return;
    }
    const player = this.players.get(playerId);
    if (!player) return;
    this.out(playerId);
    if (this.ended) return;
    if (reason === "lost") this.hold(player, "lost");
    this.run(() => this.server.onLeave?.(this.state, player, this.api, { reason }));
    this.broadcastPlayers();
  }

  /** Take a player out of the match, forgetting what the room knew about them while they were in. */
  private out(playerId: string): void {
    this.players.delete(playerId);
    this.kept.delete(playerId);
    this.presence.delete(playerId);
    this.buckets.delete(playerId);
    this.listingChanged = true;
    this.dirty = true;
  }

  /** Hold a seat for a player out of the match, for the game's seatHoldDurationSec. */
  private hold(player: Player, reason: Held["reason"]): number {
    const seatHoldDurationSec = this.server.seatHoldDurationSec ?? ROOM_LIMITS.defaultSeatHoldDurationSec;
    if (seatHoldDurationSec > 0) this.held.set(player.id, { player, reason, untilMs: this.now() + seatHoldDurationSec * 1000 });
    this.listingChanged = true;
    this.dirty = true;
    return seatHoldDurationSec;
  }

  /** When this room counts a player as away (welcome's awayChecks), by the game's settings and what their game asked for. */
  private checks(playerId: string): AwayChecks {
    return { idleTimeoutSec: this.idleTimeoutSecFor(playerId), hiddenTimeoutSec: this.ticking ? ROOM_LIMITS.hiddenTimeoutSec : null };
  }

  /** Seconds without input before a player counts as idle, or null if nobody checks for them. */
  private idleTimeoutSecFor(playerId: string): number | null {
    const idleCheck = this.server.idleCheck ?? "server";
    const serverTimeoutSec = this.server.idleTimeoutSec ?? ROOM_LIMITS.defaultIdleTimeoutSec;
    if (idleCheck === "off") return null;
    if (idleCheck === "server") return serverTimeoutSec;
    const asked = this.presence.get(playerId)?.clientIdle ?? {};
    if (asked.idleCheckEnabled === false) return null;
    return asked.idleTimeoutSec ?? serverTimeoutSec;
  }

  /**
   * A player walked away: idle (they didn't answer "Still there?", or the room heard nothing for
   * longer), or their game hidden too long in a real-time room. The game's onAway decides; otherwise
   * they leave the match with their seat held, and with awayMode "lobby" are sent to the lobby.
   */
  private walkAway(playerId: string, reason: AwayReason): void {
    const player = this.players.get(playerId);
    if (!player || this.ended || this.kept.has(playerId)) return;
    if (this.server.onAway) {
      const presence = this.presence.get(playerId);
      if (presence) presence.hiddenAtMs = undefined;
      this.kept.set(playerId, reason);
      this.listingChanged = true;
      this.dirty = true;
      this.run(() => this.server.onAway!(this.state, player, this.api, reason));
      return;
    }
    this.out(playerId);
    const seatHoldDurationSec = this.hold(player, reason);
    this.transport.send(playerId, JSON.stringify({ type: "away", reason, seatHoldDurationSec } satisfies ServerMessage));
    this.run(() => this.server.onLeave?.(this.state, player, this.api, { reason }));
    this.broadcastPlayers();
    if (this.server.awayMode === "lobby" && this.lobbyRoomCode && this.transport.moveTo) {
      this.sentAway.add(playerId);
      this.transport.moveTo(this.lobbyRoomCode, { players: [player], joinData: null });
    } else if (!seatHoldDurationSec) this.transport.close(playerId, SEAT_GONE_CLOSE_CODE, "Seat no longer held");
  }

  /** A player who walked away is back: kept in the room by onAway, or coming back to their held seat. */
  private back(playerId: string, joinData?: unknown, asked?: ClientIdle): RoomErrorCode | null {
    const player = this.players.get(playerId);
    if (player) {
      if (!this.kept.delete(playerId)) return null;
      this.listingChanged = true;
      this.dirty = true;
      this.run(() => this.server.onBack?.(this.state, player, this.api));
      return null;
    }
    const held = this.holding(playerId);
    if (!held) return null;
    const checked = checkRoomData(joinData);
    const joined = this.join(held.player, { joinData: checked.isValid ? checked.checkedData : null, clientIdle: asked });
    return joined.isAllowed ? null : joined.code;
  }

  /**
   * Check on the room's players, every half a minute or so: players the room hasn't heard from in
   * longer than the idle check allows (a game that doesn't ask "Still there?"), and players whose
   * game has been hidden too long in a real-time room, walk away; held seats that ran out are freed,
   * and those players' connections close.
   */
  sweep(): void {
    if (this.ended) return;
    const nowMs = this.now();
    for (const [id, presence] of [...this.presence]) {
      if (this.kept.has(id)) continue;
      const idleTimeoutSec = this.idleTimeoutSecFor(id);
      if (idleTimeoutSec !== null && nowMs - presence.seenAtMs >= idleTimeoutSec * 1000 + IDLE_ASK_MS + IDLE_GRACE_MS) this.walkAway(id, "idle");
      else if (this.ticking && presence.hiddenAtMs !== undefined && nowMs - presence.hiddenAtMs >= ROOM_LIMITS.hiddenTimeoutSec * 1000) this.walkAway(id, "hidden");
    }
    for (const [id, held] of [...this.held]) {
      if (held.untilMs > nowMs) continue;
      this.held.delete(id);
      this.listingChanged = true;
      this.dirty = true;
      this.transport.close(id, SEAT_GONE_CLOSE_CODE, "Seat no longer held");
    }
  }

  /** A raw text message from a client. Returns an error code if it was refused. */
  receive(playerId: string, text: string): RoomErrorCode | null {
    const player = this.players.get(playerId);
    const isHeld = !player && this.held.has(playerId);
    if ((!player && !isHeld) || this.ended) return "ended";
    this.messageCount++;
    if (text.length > ROOM_LIMITS.maximumGameMessageSizeBytes || new TextEncoder().encode(text).length > ROOM_LIMITS.maximumGameMessageSizeBytes) return "too_big";
    if (!this.take(playerId)) return "too_fast";
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return "bad_message";
    }
    const message = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
    // Out of the match with their seat held, a player can only come back; anything else waits.
    if (isHeld) return message.type === "back" ? this.back(playerId, message.joinData, message as ClientIdle) : null;
    const presence = this.presence.get(playerId);
    if (presence) presence.seenAtMs = this.now();
    switch (message.type) {
      case "room":
        return this.hostChange(playerId, message);
      case "kick":
        return this.hostKick(playerId, message);
      case "here":
        return null;
      case "idle":
        this.walkAway(playerId, "idle");
        return null;
      case "hidden":
        if (presence && this.ticking) presence.hiddenAtMs ??= this.now();
        return null;
      case "shown":
        if (presence) presence.hiddenAtMs = undefined;
        return this.kept.get(playerId) === "hidden" ? this.back(playerId) : null;
      case "back":
        return this.back(playerId);
      case "message":
        this.run(() => this.server.onMessage?.(this.state, player!, message.data, this.api));
        return null;
      default:
        return "bad_message";
    }
  }

  /** The host: the room's first player, when the game server has host controls on. */
  get hostPlayerId(): string | null {
    return this.server.hostControlsEnabled ? (this.players.keys().next().value ?? null) : null;
  }

  /**
   * The host kicks a player, when the game server allows it. Players can't type the message (no free
   * text between strangers), so the kicked player is told the host removed them.
   */
  private hostKick(playerId: string, message: Record<string, unknown>): RoomErrorCode | null {
    if (this.hostPlayerId !== playerId) return "not_allowed";
    const kickedId = message.playerId;
    if (typeof kickedId !== "string" || kickedId === playerId || !this.players.has(kickedId)) return "bad_message";
    this.kick(kickedId, { message: "The host removed you from this room.", keepOut: message.keepOut === true });
    return null;
  }

  /** The host hides, shows, opens, closes, names or labels the room, when the game server allows it. */
  private hostChange(playerId: string, message: Record<string, unknown>): RoomErrorCode | null {
    if (this.hostPlayerId !== playerId) return "not_allowed";
    const change: Partial<RoomSettings> = tidyRoomInfo(message as RoomInfo);
    if (typeof message.isListed === "boolean") change.isListed = message.isListed;
    if (typeof message.isOpen === "boolean") change.isOpen = message.isOpen;
    this.settle(change);
    this.dirty = true;
    return null;
  }

  private settings(): RoomSettings {
    return { isListed: this.isListed, isOpen: this.isOpen, name: this.name, labels: { ...this.labels } };
  }

  /** Change isListed, isOpen, the name or labels, and tell everyone in the room. */
  private settle(change: Partial<RoomSettings>): void {
    const next = { ...this.settings(), ...change };
    if (JSON.stringify(next) === JSON.stringify(this.settings())) return;
    this.isListed = next.isListed;
    this.isOpen = next.isOpen;
    this.name = next.name;
    this.labels = next.labels;
    this.listingChanged = true;
    const text = JSON.stringify({ type: "room", room: next } satisfies ServerMessage);
    for (const id of this.players.keys()) this.transport.send(id, text);
  }

  /** A room made for some of this room's players (room.reserve). Mistakes in the game's call throw. */
  private reserve(reserveOptions: ReserveOptions & { roomCode?: unknown }): string {
    if (!this.transport.reserve) throw new Error("Reserved rooms aren't available here");
    if (this.ended) throw new Error("This room has ended");
    // A game server in a sandbox picks the code itself (roomCode), since it tells the game at once.
    const given = closed(reserveOptions, ["playerIds", "setupData", "isListed", "name", "labels", "roomCode"], "room.reserve");
    const playerIds = [...new Set(Array.isArray(given.playerIds) ? given.playerIds : [])].filter((id) => this.players.has(id));
    if (!playerIds.length) throw new Error("room.reserve needs playerIds of players who are in this room");
    const checked = checkRoomData(given.setupData);
    if (!checked.isValid) throw new Error(`room.reserve's setupData must be plain JSON up to ${ROOM_LIMITS.maximumRoomDataSizeBytes / 1024} KB`);
    this.limit();
    const nameAndLabels = tidyRoomInfo({ name: given.name ?? null, labels: given.labels ?? {} });
    const newRoomCode = typeof given.roomCode === "string" && isRoomCode(given.roomCode) ? given.roomCode : roomCode();
    this.transport.reserve(newRoomCode, {
      playerIds,
      setupData: checked.checkedData,
      isListed: given.isListed === true,
      name: nameAndLabels.name ?? null,
      labels: nameAndLabels.labels ?? {},
      ...(this.keptOut.size ? { keptOut: Object.fromEntries(this.keptOut) } : {}),
    });
    return newRoomCode;
  }

  /** Send players to another room of the game (room.moveTo). Mistakes in the game's call throw. */
  private moveTo(toRoomCode: string, moveOptions: MoveOptions): void {
    if (!this.transport.moveTo) throw new Error("Moving players isn't available here");
    if (this.ended) throw new Error("This room has ended");
    if (typeof toRoomCode !== "string" || !isRoomCode(toRoomCode)) throw new Error("room.moveTo needs a room code");
    const given = closed(moveOptions, ["playerIds", "joinData"], "room.moveTo");
    const players = [...new Set(Array.isArray(given.playerIds) ? given.playerIds : [])].map((id) => this.players.get(id)).filter((player): player is Player => Boolean(player));
    if (!players.length) throw new Error("room.moveTo needs playerIds of players who are in this room");
    const checked = checkRoomData(given.joinData);
    if (!checked.isValid) throw new Error(`room.moveTo's joinData must be plain JSON up to ${ROOM_LIMITS.maximumRoomDataSizeBytes / 1024} KB`);
    this.limit();
    this.transport.moveTo(toRoomCode, { players, joinData: checked.checkedData });
  }

  /**
   * The other room's answer to room.moveTo, for onMoved. Players it took who already left, or who
   * aren't here, are left out.
   */
  moved(toRoomCode: string, answer: MoveAnswer, sent: Player[]): void {
    // The room sending a player who walked away to its lobby: if the lobby turned them away, their seat
    // here stays held, and with no seat held (seatHoldDurationSec: 0) there's nothing to stay connected for.
    if (sent.length === 1 && this.sentAway.delete(sent[0]!.id)) {
      const id = sent[0]!.id;
      if (!answer.movedPlayerIds.includes(id) && !this.players.has(id) && !this.holding(id)) this.transport.close(id, SEAT_GONE_CLOSE_CODE, "Seat no longer held");
      return;
    }
    if (this.ended || !this.server.onMoved) return;
    const who = new Map(sent.map((player) => [player.id, player]));
    const moveResult: MoveResult = {
      roomCode: toRoomCode,
      movedPlayers: answer.movedPlayerIds.map((id) => who.get(id)).filter((player): player is Player => Boolean(player)),
      refusals: answer.refusals.filter((refusal) => who.has(refusal.playerId)).map((refusal) => ({ player: who.get(refusal.playerId)!, code: refusal.code, message: refusal.message })),
    };
    this.run(() => this.server.onMoved!(this.state, moveResult, this.api));
  }

  /** Reserving rooms and moving players share one limit a minute. */
  private limit(): void {
    const nowMs = this.now();
    this.reservedAtMs = this.reservedAtMs.filter((reservedAtMs) => nowMs - reservedAtMs < 60_000);
    if (this.reservedAtMs.length >= ROOM_LIMITS.maximumReservesPerMin) throw new Error(`A room can reserve rooms or move players up to ${ROOM_LIMITS.maximumReservesPerMin} times a minute`);
    this.reservedAtMs.push(nowMs);
  }

  /** Remove a player (room.kick). Their onLeave runs once the handler that kicked them is done. */
  kick(playerId: string, kickOptions?: KickOptions): void {
    const given = closed(kickOptions ?? {}, ["message", "keepOut"], "room.kick");
    const player = this.players.get(playerId);
    const held = this.held.get(playerId);
    if ((!player && !held) || this.ended) return;
    const message = tidy(given.message, ROOM_LIMITS.maximumMessageCharacterCount) || ERROR_TEXT.kept_out;
    const isKeptOut = given.keepOut === true;
    this.known.delete(playerId);
    if (isKeptOut) this.keepOut({ [playerId]: message });
    this.transport.send(playerId, JSON.stringify({ type: "kicked", message, isKeptOut } satisfies ServerMessage));
    this.transport.close(playerId, REFUSED_CLOSE_CODE, "Removed from the room");
    this.held.delete(playerId);
    this.out(playerId);
    // A player out of the match with their seat held already left it: there's no onLeave to run.
    if (!player) return;
    this.soon(() => {
      if (this.ended) return;
      this.run(() => this.server.onLeave?.(this.state, player, this.api, { reason: "kicked" }));
      this.broadcastPlayers();
    });
  }

  /** Keep players out, newest last, up to as many as the room remembers. */
  private keepOut(players: Record<string, string> | undefined): void {
    for (const [id, message] of Object.entries(players ?? {})) {
      if (typeof message !== "string") continue;
      this.keptOut.delete(id);
      this.keptOut.set(id, message.slice(0, ROOM_LIMITS.maximumMessageCharacterCount));
      if (this.keptOut.size > REMEMBERED_PLAYER_COUNT) this.keptOut.delete(this.keptOut.keys().next().value!);
    }
  }

  /** Run now, or once the handler running now is done, so a handler never runs inside another. */
  private soon(work: () => void): void {
    if (this.depth) this.afterHandler.push(work);
    else work();
  }

  private flush(): void {
    while (!this.depth && this.afterHandler.length) this.afterHandler.shift()!();
  }

  private remember(id: string): void {
    this.known.delete(id);
    this.known.add(id);
    if (this.known.size > REMEMBERED_PLAYER_COUNT) this.known.delete(this.known.values().next().value!);
  }

  tick(tickDurationSec: number): void {
    // A room where everyone walked away stops running until someone's back.
    if (this.ended || !this.server.onTick || this.playingCount === 0) return;
    // A game server that hasn't caught up skips this tick; tickDurationSec carries the time over to the next one.
    if (this.waitingCount > 1) return;
    this.run(() => this.server.onTick!(this.state, tickDurationSec, this.api));
  }

  end(message: string): void {
    if (this.ended) return;
    this.ended = true;
    this.listingChanged = true;
    const text = JSON.stringify({ type: "ended", message } satisfies ServerMessage);
    for (const id of [...this.players.keys(), ...this.held.keys()]) {
      this.transport.send(id, text);
      this.transport.close(id, ENDED_CLOSE_CODE, "Match ended");
    }
    this.players.clear();
    this.held.clear();
    this.kept.clear();
    this.presence.clear();
  }

  private list(): Player[] {
    return [...this.players.values()];
  }

  private broadcast(message: unknown, exceptPlayerId?: string): void {
    const text = JSON.stringify({ type: "message", data: message } satisfies ServerMessage);
    for (const id of this.players.keys()) if (id !== exceptPlayerId) this.transport.send(id, text);
  }

  private broadcastPlayers(): void {
    const text = JSON.stringify({ type: "players", players: this.list(), hostPlayerId: this.hostPlayerId } satisfies ServerMessage);
    for (const id of this.players.keys()) this.transport.send(id, text);
  }

  /** Token bucket per player: a short burst is fine, a flood is dropped. */
  private take(playerId: string): boolean {
    const nowMs = this.now();
    const bucket = this.buckets.get(playerId) ?? { tokenCount: ROOM_LIMITS.gameMessageBurstCount, filledAtMs: nowMs };
    bucket.tokenCount = Math.min(ROOM_LIMITS.gameMessageBurstCount, bucket.tokenCount + ((nowMs - bucket.filledAtMs) / 1000) * ROOM_LIMITS.gameMessagesPerSec);
    bucket.filledAtMs = nowMs;
    this.buckets.set(playerId, bucket);
    if (bucket.tokenCount < 1) return false;
    bucket.tokenCount -= 1;
    return true;
  }

  /** Run a game server handler. A crash in game code is logged and never takes the room down. */
  private run(handler: () => HandlerResult<S> | Promise<HandlerResult<S>>): void {
    if (!this.queue) {
      let next: HandlerResult<S> | Promise<HandlerResult<S>>;
      this.depth++;
      try {
        next = handler();
      } catch (error) {
        console.error("Game server error:", error);
        this.depth--;
        this.flush();
        return;
      }
      this.depth--;
      if (!isPromise(next)) {
        if (next !== undefined) this.state = next as S;
        this.dirty = true;
        this.flush();
        return;
      }
      this.queue = Promise.resolve();
      const started = next;
      handler = () => started;
    }
    this.waitingCount++;
    this.queue = this.queue.then(async () => {
      this.depth++;
      try {
        const next = await handler();
        if (next !== undefined) this.state = next as S;
        this.dirty = true;
      } catch (error) {
        console.error("Game server error:", error);
      } finally {
        this.waitingCount--;
        this.depth--;
        this.flush();
      }
    });
  }
}

function isPromise<T>(given: unknown): given is Promise<T> {
  return typeof (given as { then?: unknown } | null)?.then === "function";
}

/** What the room knows about a player in the match, for the away checks. */
interface Presence {
  /** When the room last heard from them (any message but a ping). */
  seenAtMs: number;
  /** Since when their game has been hidden, as their game said. */
  hiddenAtMs?: number;
  /** The idle check their game asked for, for idleCheck "client". */
  clientIdle: ClientIdle;
}

/** The idle check a player's game asked for, from its hello or back message: a timeout within the limits, and whether to check at all. */
export function clientIdle(given: unknown): ClientIdle {
  const asked = (given && typeof given === "object" ? given : {}) as Record<string, unknown>;
  const out: ClientIdle = {};
  if (typeof asked.idleTimeoutSec === "number" && Number.isFinite(asked.idleTimeoutSec)) {
    out.idleTimeoutSec = Math.min(ROOM_LIMITS.maximumIdleTimeoutSec, Math.max(ROOM_LIMITS.minimumIdleTimeoutSec, Math.round(asked.idleTimeoutSec)));
  }
  if (typeof asked.idleCheckEnabled === "boolean") out.idleCheckEnabled = asked.idleCheckEnabled;
  return out;
}

/** A game's call options with only the fields it takes: anything else throws, naming the ones it does. */
function closed<T extends object>(given: T, fields: readonly string[], call: string): Partial<T> {
  if (given === null || typeof given !== "object") return {};
  for (const field of Object.keys(given)) {
    if (!fields.includes(field)) throw new Error(`${call} doesn't take ${field}. It takes: ${fields.filter((name) => name !== "roomCode").join(", ")}.`);
  }
  return given;
}

// Characters that hide text or flip its direction.
const HIDDEN = /[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
const tidy = (given: unknown, maximumCharacterCount: number) =>
  String(given ?? "")
    .normalize("NFKC")
    .replace(HIDDEN, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumCharacterCount)
    .trim();

/** A name and labels within the limits, with hidden characters dropped. Fields left out stay out. */
export function tidyRoomInfo(nameAndLabels: RoomInfo): Partial<Pick<RoomSettings, "name" | "labels">> {
  const out: Partial<Pick<RoomSettings, "name" | "labels">> = {};
  if (nameAndLabels.name !== undefined) out.name = nameAndLabels.name === null ? null : tidy(nameAndLabels.name, ROOM_LIMITS.maximumNameCharacterCount) || null;
  if (nameAndLabels.labels !== undefined) {
    const labels: Record<string, string> = {};
    if (nameAndLabels.labels && typeof nameAndLabels.labels === "object") {
      for (const [labelName, labelValue] of Object.entries(nameAndLabels.labels)) {
        const key = tidy(labelName, ROOM_LIMITS.maximumLabelNameCharacterCount);
        const shown = typeof labelValue === "string" || typeof labelValue === "number" ? tidy(labelValue, ROOM_LIMITS.maximumLabelValueCharacterCount) : "";
        if (key && shown && Object.keys(labels).length < ROOM_LIMITS.maximumLabelCount) labels[key] = shown;
      }
    }
    out.labels = labels;
  }
  return out;
}
