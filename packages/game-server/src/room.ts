/**
 * The game server API and the room logic shared by Zaisma rooms (Durable Objects)
 * and the Node runner, so a game behaves the same in both places.
 *
 * Words: the *client* is the game in the player's browser. The *game server* is the
 * developer's code that holds the official game state. A *room* is one live match,
 * running one copy of the game server.
 */

import { isRoomCode, roomCode } from "./names.ts";

export interface Player {
  /** player_…: a guest's ID lasts as long as their player pass. */
  id: string;
  name: string;
}

export interface Room {
  /** Players in the room right now, in join order. */
  readonly players: readonly Player[];
  /** Send messageData (plain JSON) to every player, or everyone except one. */
  broadcast(messageData: unknown, options?: BroadcastOptions): void;
  /** Send messageData (plain JSON) to one player. */
  send(playerId: string, messageData: unknown): void;
  /** End the match: everyone is told message (or "The match is over."), disconnected, and the room closes. */
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
   * Name the room, from the game or from what a player typed; null clears it. Names and labels a
   * player typed show on zaisma.com only if they pass Zaisma's text filter; your game is responsible
   * for them inside the game.
   */
  setName(name: string | null): void;
  /** Label the room, like { Mode: "Classic", Map: "Docks" }: up to 4, each name up to 16 characters and value up to 24. null clears them. */
  setLabels(labels: Record<string, string | number> | null): void;
  /**
   * Make a new room for some of this room's players, like a lobby starting a match, and move them
   * there. The new room runs this same game server: its setup(startData) gets your startData, only
   * the players named can join it (a closed room, until it opens), and it's hidden from room lists
   * unless isListed is true. Each player gets a "move" event in the game and joins when the game
   * says so. Returns the new room's code. startData is plain JSON, up to 4 KB; players can read it
   * but not change it.
   */
  reserve(options: ReserveOptions): string;
  /**
   * Remove a player from the room, telling them why in message (up to 200 characters; your game's
   * words, so keep them within the content rules). keepOut keeps them out of this room for the rest
   * of the match, and out of any room it reserves after. onLeave runs once the current handler is done.
   */
  kick(playerId: string, options?: KickOptions): void;
  /**
   * Send some of this room's players to another room of this game that already exists, like back to
   * their party's match or into the next area of an open world. The other room's canJoin decides with
   * your joinData (plain JSON, up to 4 KB) and holds a seat for each player it takes for a minute,
   * even if it's closed to new players; its onJoin gets the same joinData. Each player taken gets a
   * "move" event in the game, which follows by default. onMoved then says who was taken and who was
   * turned away; they stay here.
   */
  moveTo(roomCode: string, options: MoveOptions): void;
}

export interface BroadcastOptions {
  exceptPlayerId?: string;
}

export interface MoveOptions {
  playerIds: string[];
  joinData?: unknown;
}

/** Who another room took (room.moveTo) and who it turned away, and why. */
export interface MoveResult {
  roomCode: string;
  movedPlayers: Player[];
  refusedPlayers: { player: Player; error: { code: RoomErrorCode; message: string } }[];
}

/**
 * How a player came in. fromRoomCode: the room that sent them (room.moveTo), or null. isReturning:
 * they're coming back to the seat the room held for them, after walking away or losing their connection.
 */
export interface JoinInfo {
  fromRoomCode: string | null;
  isReturning: boolean;
}

/** Why a player walked away: no input (idle), or the game hidden in a real-time room. */
export type AwayReason = "idle" | "hidden";

/**
 * Why a player left: left (closed the game or left the room), connection_lost (the room holds their
 * seat), idle or hidden (they walked away, and the room holds their seat), kicked.
 */
export type LeaveReason = "left" | "connection_lost" | AwayReason | "kicked";

export interface LeaveInfo {
  leaveReason: LeaveReason;
}

/** What one room asks another when moving players there; from is the asking room's code, added by the transport. */
export interface MoveAsk {
  from: string;
  players: Player[];
  data?: unknown;
}

export interface KickOptions {
  message?: string;
  keepOut?: boolean;
}

/** A room made for some players: who, the startData its game server starts with, and how it shows. */
export interface ReserveOptions {
  playerIds: string[];
  startData?: unknown;
  isListed?: boolean;
  name?: string | null;
  labels?: Record<string, string | number> | null;
}

/** How a reserved room starts, as the room that made it sends it on. */
export interface RoomStart extends Pick<RoomSettings, "isListed" | "name" | "labels"> {
  players: string[];
  data?: unknown;
  /** Players kept out of the room that made this one, and why: they stay out of this one too. */
  keptOut?: Record<string, string>;
  /** The code of the room that made this one, where awayMode "send_to_lobby" sends players. Added by the transport. */
  lobby?: string;
}

/** A room's name and labels, as a game sets them. Leave a field out to keep it; null clears it. */
export interface RoomNaming {
  name?: string | null;
  labels?: Record<string, string | number> | null;
}

/** What canJoin answers: true (or nothing) lets the player in, false or { refusalMessage } turns them away. */
export type JoinAnswer = boolean | { refusalMessage: string } | void;

type Result<S> = void | S;

export interface GameServer<S = any> {
  /** Up to 16. Defaults to 8. */
  maximumPlayerCount?: number;
  /** Up to 30. Leave out for turn-based games so the room can sleep between moves. */
  ticksPerSec?: number;
  /**
   * The room's first player is its host: they may hide, show, open, close and name the room, and
   * kick players, from the game. When the host leaves, the next player takes over. The relay has this on.
   */
  hostControlsEnabled?: boolean;
  /**
   * Who checks for players who stopped giving input: "server" (the default) asks "Still there?"
   * after idleTimeoutSec; "client" lets each player's game decide (joinRoom({ idleCheck,
   * idleTimeoutSec })), as the relay does; "off" never checks.
   */
  idleCheck?: IdleCheck;
  /** With idleCheck "server": seconds without input before "Still there?", 30 to 86400. Defaults to 600. 30 seconds later the player walks away. */
  idleTimeoutSec?: number;
  /**
   * What happens when a player walks away (idle, or the game hidden for 2 minutes in a real-time
   * room). "hold_seat" (the default) takes them out of the match (onLeave) and holds their seat for
   * seatHoldDurationSec, so they come straight back to it. "send_to_lobby" sends them to the room that
   * made this one (room.reserve), holding their seat if there isn't one or it won't take them. Give
   * onAway to handle it yourself instead.
   */
  awayMode?: AwayMode;
  /**
   * How long the room holds a seat for a player who walked away or lost their connection: up to 1800,
   * 0 for none. Defaults to 300. Held seats count toward maximumPlayerCount.
   */
  seatHoldDurationSec?: number;
  /**
   * The starting state. It must be plain JSON so a sleeping room can be saved and woken. startData is
   * what room.reserve() passed when another room made this one, and undefined otherwise.
   */
  setup(startData?: unknown): S;
  /**
   * joinData is what the player's game passed to joinRoom({ joinData }), like the character they
   * picked, or undefined. It comes from the player's browser, so check it like any message. For a
   * player another room sent (room.moveTo), joinData is what that room's game server passed, and
   * joinInfo.fromRoomCode is its code.
   */
  onJoin?(state: S, player: Player, room: Room, joinData: unknown, joinInfo: JoinInfo): Result<S>;
  /**
   * Say who may come in, before they join: return false, or { refusalMessage } (up to 200 characters,
   * shown to the player), to turn them away, like a wrong room password in joinData or a full team;
   * return true, or nothing, to let them in. Anything else turns them away too, as a mistake. Players
   * coming back after a dropped connection don't ask again. Only decide here; change the state in
   * onJoin. If it throws, the player is turned away. Players another room sends are asked when it
   * sends them, with its joinData and joinInfo.fromRoomCode, and not again when they arrive.
   */
  canJoin?(state: S, player: Player, room: Room, joinData: unknown, joinInfo: JoinInfo): JoinAnswer | Promise<JoinAnswer>;
  /** After room.moveTo: who the other room took, and who it turned away and why. */
  onMoved?(state: S, moveResult: MoveResult, room: Room): Result<S>;
  /** leaveInfo.leaveReason says why they left; a player who lost their connection or walked away gets their seat held. */
  onLeave?(state: S, player: Player, room: Room, leaveInfo: LeaveInfo): Result<S>;
  /**
   * A player walked away. With onAway, they stay in the room and your game decides what happens:
   * kick them, move them (room.moveTo) or keep them. They don't count as playing meanwhile, and a
   * room where everyone is away stops ticking. onBack runs when they return.
   */
  onAway?(state: S, player: Player, room: Room, awayReason: AwayReason): Result<S>;
  onBack?(state: S, player: Player, room: Room): Result<S>;
  /** messageData is what the player's game sent (room.send), parsed from JSON. Check it: it comes from the player's browser. */
  onMessage?(state: S, player: Player, messageData: unknown, room: Room): Result<S>;
  /** tickDurationSec: seconds since the last tick, about 1 / ticksPerSec. */
  onTick?(state: S, tickDurationSec: number, room: Room): Result<S>;
}

export type IdleCheck = "server" | "client" | "off";
export type AwayMode = "hold_seat" | "send_to_lobby";

/** Every option a game server may have, settings and handlers; defineGameServer refuses anything else. */
export const GAME_SERVER_OPTIONS = [
  "maximumPlayerCount",
  "ticksPerSec",
  "hostControlsEnabled",
  "idleCheck",
  "idleTimeoutSec",
  "awayMode",
  "seatHoldDurationSec",
  "setup",
  "canJoin",
  "onJoin",
  "onMoved",
  "onLeave",
  "onAway",
  "onBack",
  "onMessage",
  "onTick",
] as const;

const HANDLERS = new Set<string>(["setup", "canJoin", "onJoin", "onMoved", "onLeave", "onAway", "onBack", "onMessage", "onTick"]);

export const ROOM_LIMITS = {
  maximumPlayerCount: 16,
  defaultMaximumPlayerCount: 8,
  maximumTicksPerSec: 30,
  /** A room's name, its labels, and each label's name and value. */
  maximumNameCharacterCount: 40,
  maximumLabelCount: 4,
  maximumLabelNameCharacterCount: 16,
  maximumLabelValueCharacterCount: 24,
  /** joinData a player brings to a room, and startData a reserved room starts with, as JSON. */
  maximumDataSizeBytes: 4 * 1024,
  /** Rooms one room may reserve or move players to a minute: enough for a full lobby, not for a bug that does it every tick. */
  maximumReservesPerMin: 20,
  /** A kick's message, a refusal's or an end's. */
  maximumMessageCharacterCount: 200,
  /** Largest message a client may send. */
  maximumMessageSizeBytes: 16 * 1024,
  /** Sustained messages a second per player, with a short burst allowance. */
  messagesPerSec: 30,
  messageBurstCount: 60,
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
 * A mistake in a game server's options or in a call it made, with a stable code: unknown_option (a
 * name it doesn't take), bad_option (a value it doesn't take), not_available (a call this room can't
 * make here), room_ended or slow_down (too many reserves and moves a minute).
 */
export type GameServerErrorCode = "unknown_option" | "bad_option" | "not_available" | "room_ended" | "slow_down";

// Plain class fields (no TypeScript-only syntax) so Node can run this file directly.
export class GameServerError extends Error {
  readonly code: GameServerErrorCode;
  constructor(code: GameServerErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Refuses option names a call doesn't take, listing the ones it does. */
export function refuseUnknownOptions(given: unknown, allowed: readonly string[], what: string): void {
  if (given === undefined || given === null) return;
  if (typeof given !== "object" || Array.isArray(given)) throw new GameServerError("bad_option", `${what} takes an object with ${allowed.join(", ")}.`);
  const unknown = Object.keys(given).filter((name) => !allowed.includes(name));
  if (unknown.length) throw new GameServerError("unknown_option", `${what} doesn't take ${unknown.join(", ")}. It takes ${allowed.join(", ")}.`);
}

/** Check a game server's options once, when it's defined: unknown names and values out of range throw, saying what's allowed. */
export function defineGameServer<S>(server: GameServer<S>): GameServer<S> {
  refuseUnknownOptions(server, GAME_SERVER_OPTIONS, "A game server");
  if (typeof server.setup !== "function") throw new GameServerError("bad_option", "A game server needs a setup() function.");
  for (const name of Object.keys(server)) {
    const option = (server as unknown as Record<string, unknown>)[name];
    if (HANDLERS.has(name) && option !== undefined && typeof option !== "function") throw new GameServerError("bad_option", `${name} must be a function.`);
  }
  const maximumPlayerCount = server.maximumPlayerCount ?? ROOM_LIMITS.defaultMaximumPlayerCount;
  if (!Number.isInteger(maximumPlayerCount) || maximumPlayerCount < 1 || maximumPlayerCount > ROOM_LIMITS.maximumPlayerCount) {
    throw new GameServerError("bad_option", `maximumPlayerCount must be a whole number from 1 to ${ROOM_LIMITS.maximumPlayerCount}.`);
  }
  if (server.ticksPerSec !== undefined && !(typeof server.ticksPerSec === "number" && server.ticksPerSec > 0 && server.ticksPerSec <= ROOM_LIMITS.maximumTicksPerSec)) {
    throw new GameServerError("bad_option", `ticksPerSec must be above 0 and at most ${ROOM_LIMITS.maximumTicksPerSec}; leave it out for a turn-based game.`);
  }
  if (server.hostControlsEnabled !== undefined && typeof server.hostControlsEnabled !== "boolean") throw new GameServerError("bad_option", "hostControlsEnabled must be true or false.");
  if (server.idleCheck !== undefined && !["server", "client", "off"].includes(server.idleCheck)) throw new GameServerError("bad_option", `idleCheck must be "server", "client" or "off".`);
  if (server.idleTimeoutSec !== undefined) {
    if ((server.idleCheck ?? "server") !== "server") throw new GameServerError("bad_option", `idleTimeoutSec only applies with idleCheck "server".`);
    if (!(typeof server.idleTimeoutSec === "number" && server.idleTimeoutSec >= ROOM_LIMITS.minimumIdleTimeoutSec && server.idleTimeoutSec <= ROOM_LIMITS.maximumIdleTimeoutSec)) {
      throw new GameServerError("bad_option", `idleTimeoutSec must be ${ROOM_LIMITS.minimumIdleTimeoutSec} to ${ROOM_LIMITS.maximumIdleTimeoutSec}.`);
    }
  }
  if (server.awayMode !== undefined && server.awayMode !== "hold_seat" && server.awayMode !== "send_to_lobby") throw new GameServerError("bad_option", `awayMode must be "hold_seat" or "send_to_lobby".`);
  if (server.seatHoldDurationSec !== undefined && !(typeof server.seatHoldDurationSec === "number" && server.seatHoldDurationSec >= 0 && server.seatHoldDurationSec <= ROOM_LIMITS.maximumSeatHoldDurationSec)) {
    throw new GameServerError("bad_option", `seatHoldDurationSec must be 0 to ${ROOM_LIMITS.maximumSeatHoldDurationSec}.`);
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
 * Messages between the room and a client, as JSON: each says its type. Clients send hello first:
 * { type: "hello", pass, joinData?, newRoom?: { isListed?, name?, labels? }, idleCheck?, idleTimeoutSec? }
 * (joinData is for canJoin and onJoin; newRoom only counts from the player who makes the room;
 * idleCheck "on" or "off" and idleTimeoutSec only where the game server leaves the idle check to the
 * client), then { type: "message", data }. With hostControlsEnabled, the host may also send
 * { type: "update_room", isListed?, isOpen?, name?, labels? } and { type: "kick", playerId, keepOut? }.
 * hostPlayerId is null without host controls.
 *
 * Players who walk away (docs/DECISIONS.md): clients send the text "ping" every 30 seconds or so (the
 * room answers "pong"; a connection with no ping or message for about a minute is dropped), and
 * { type: "here" } now and then while the player gives input but the game sends nothing. They send
 * { type: "idle" } when the player didn't answer "Still there?", { type: "hidden" } and
 * { type: "shown" } as the game is hidden and shown (where welcome's awayChecks.hiddenTimeoutSec says
 * it counts), and { type: "back", joinData?, idleCheck?, idleTimeoutSec? } when the player returns.
 * A player out of the match with their seat held gets { type: "away" }, and once the seat is no
 * longer held, their connection closes with CLOSE_SEAT_GONE.
 */
export type ServerMessage =
  | { type: "welcome"; me: Player; players: Player[]; roomSettings: RoomSettings; hostPlayerId: string | null; awayChecks: AwayChecks }
  | { type: "players"; players: Player[]; hostPlayerId: string | null }
  | { type: "away"; awayReason: AwayReason; seatHoldDurationSec: number }
  | { type: "kicked"; message: string; isKeptOut: boolean }
  | { type: "room_settings"; roomSettings: RoomSettings }
  | { type: "move"; roomCode: string }
  | { type: "message"; data: unknown }
  | { type: "error"; code: RoomErrorCode; message: string }
  | { type: "ended"; message: string };

/** The types of message a client sends, after hello. */
export const CLIENT_MESSAGE_TYPES = ["message", "update_room", "kick", "here", "idle", "hidden", "shown", "back"] as const;

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
  | "month_limit";

export const ERROR_TEXT: Record<RoomErrorCode, string> = {
  full: "This room is full.",
  closed: "This room isn't taking new players.",
  ended: "This match has ended.",
  too_big: "Message too big.",
  too_fast: "Too many messages. Slow down.",
  bad_message: `Messages must be JSON with a type: ${CLIENT_MESSAGE_TYPES.join(", ")}.`,
  bad_pass: "Your player pass isn't valid for this game.",
  no_hello: "Send your player pass first.",
  not_allowed: "Only the game server or the room's host can do that.",
  game_unavailable: "This game isn't available right now.",
  busy: "Rooms are busy. Try again soon.",
  kept_out: "You were removed from this room.",
  refused: "The game didn't let you into this room.",
  no_room: "That room isn't running.",
  month_limit: "This game has used this month's multiplayer time. New rooms open again next month.",
};

/**
 * Listed, open, the players who have been in the room, the players kept out of it and a reserved
 * room's data, saved with a sleeping room's state.
 */
export interface SavedRoom extends RoomSettings {
  known: string[];
  data?: unknown;
  keptOut?: Record<string, string>;
  expected?: Record<string, Expected>;
  held?: Record<string, Held>;
  kept?: Record<string, AwayReason>;
  lobby?: string;
}

/** A seat held for a player out of the match: who, why they're out, and until when. */
export interface Held {
  player: Player;
  why: "connection_lost" | AwayReason;
  until: number;
}

/** When a room counts its players as away, or null when it doesn't: no input (idle), and the game hidden. */
export interface AwayChecks {
  idleTimeoutSec: number | null;
  hiddenTimeoutSec: number | null;
}

/** A player another room is sending here: the data it sent, where from, and until when their seat is held. */
export interface Expected {
  data?: unknown;
  from: string;
  until: number;
}

/** How long a room holds a seat for a player another room is sending. */
const SEAT_MS = 60_000;

/** How the room reaches players: a Durable Object's sockets, or a Node server's. */
export interface Transport {
  send(playerId: string, text: string): void;
  close(playerId: string, code: number, reason: string): void;
  /** Set up a reserved room, then send each of its players a "move" message. Without it, rooms can't reserve. */
  reserve?(code: string, start: RoomStart): void;
  /**
   * Ask another room of the game to take some players (its expect()), send each player it takes a
   * "move" message, then hand the answer to this room's moved(). Without it, rooms can't move players.
   */
  moveTo?(code: string, ask: Omit<MoveAsk, "from">): void;
}

/** Plain JSON within ROOM_LIMITS.maximumDataSizeBytes, or undefined if it isn't. Players' joinData that fails this is refused. */
export function roomData(data: unknown): { ok: true; data: unknown } | { ok: false } {
  if (data === undefined) return { ok: true, data: undefined };
  let text: string | undefined;
  try {
    text = JSON.stringify(data);
  } catch {
    return { ok: false };
  }
  if (text === undefined || new TextEncoder().encode(text).length > ROOM_LIMITS.maximumDataSizeBytes) return { ok: false };
  return { ok: true, data: JSON.parse(text) };
}

/** An error for a client. message replaces the usual text, like the game's refusalMessage for turning a player away. */
export function errorMessage(code: RoomErrorCode, message?: string): string {
  return JSON.stringify({ type: "error", code, message: message || ERROR_TEXT[code] } satisfies ServerMessage);
}

/**
 * The idle check a player's game asked for (joinRoom({ idleCheck, idleTimeoutSec })), as a hello or
 * back message says it: seconds within the limits, null for none ("off"), or undefined for the default.
 */
export function clientIdleTimeoutSec(idleCheck: unknown, idleTimeoutSec: unknown): number | null | undefined {
  if (idleCheck === "off") return null;
  if (typeof idleTimeoutSec !== "number" || !Number.isFinite(idleTimeoutSec)) return undefined;
  return Math.min(ROOM_LIMITS.maximumIdleTimeoutSec, Math.max(ROOM_LIMITS.minimumIdleTimeoutSec, Math.round(idleTimeoutSec)));
}

/** Whether a player may come in, and if not, why. */
export type Admission = { ok: true } | { ok: false; code: RoomErrorCode; message?: string };

/** WebSocket close code for a match that ended normally. */
export const CLOSE_ENDED = 4000;
/** Close code for a player refused or removed by the room. */
export const CLOSE_REFUSED = 4001;
/** Close code for a player who walked away, once the room stops holding their seat. They may try to come back. */
export const CLOSE_SEAT_GONE = 4002;
/** Close code for a connection that stopped answering. */
export const CLOSE_NO_ANSWER = 4003;

/** How many past players a room remembers, so they can come back to a closed room, and how many it keeps out. */
const REMEMBERED = 64;

/** What a player brings when they join: the room settings the player who makes it asks for, their joinData and their game's idle check. */
export interface JoinOptions extends RoomNaming {
  isListed?: boolean;
  joinData?: unknown;
  /** From clientIdleTimeoutSec: null for none, undefined for the default. */
  idleTimeoutSec?: number | null;
}

export class RoomCore<S = any> {
  state: S;
  readonly players = new Map<string, Player>();
  ended = false;
  /** Messages received from clients, for usage counts. */
  messages = 0;
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
  /** The room that made this one, where awayMode "send_to_lobby" sends players who walk away. */
  lobby: string | null = null;
  /** When each player in the match was last heard from, when their game was hidden, and the idle check their game asked for. */
  private presence = new Map<string, Presence>();
  /** Players this room is sending to its lobby for walking away, so onMoved doesn't hear of it. */
  private sentAway = new Set<string>();
  /** What a reserved room started with, kept so a room that starts over starts the same way. */
  private data: unknown = undefined;
  /** When this room last reserved rooms, for the limit. */
  private reservedAt: number[] = [];
  private buckets = new Map<string, { tokens: number; at: number }>();
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
  private waiting = 0;
  /** Handlers running right now, and what waits for them to finish (a kicked player's onLeave). */
  private depth = 0;
  private afterHandler: (() => void)[] = [];

  /**
   * opts.start makes a reserved room: closed, open only to the players it was made for, and set up
   * with its data. A saved room (opts.room) wakes as it was, with opts.presence saying when each of
   * its players was last heard from and the idle check their game asked for.
   */
  constructor(
    server: GameServer<S>,
    transport: Transport,
    opts: { state?: S; players?: Player[]; room?: SavedRoom; start?: RoomStart; presence?: Record<string, { seen?: number; idleTimeoutSec?: number | null }>; now?: () => number } = {},
  ) {
    this.server = server;
    this.transport = transport;
    this.now = opts.now ?? Date.now;
    this.maximumPlayerCount = server.maximumPlayerCount ?? ROOM_LIMITS.defaultMaximumPlayerCount;
    for (const p of opts.players ?? []) {
      this.players.set(p.id, p);
      const was = opts.presence?.[p.id];
      this.presence.set(p.id, { seen: was?.seen ?? this.now(), idleTimeoutSec: was?.idleTimeoutSec });
    }
    if (opts.room) {
      this.isListed = opts.room.isListed;
      this.isOpen = opts.room.isOpen;
      this.name = opts.room.name ?? null;
      this.labels = opts.room.labels ?? {};
      for (const id of opts.room.known) this.known.add(id);
      this.data = opts.room.data;
      this.keepOut(opts.room.keptOut);
      for (const [id, e] of Object.entries(opts.room.expected ?? {})) this.expected.set(id, e);
      for (const [id, h] of Object.entries(opts.room.held ?? {})) if (!this.players.has(id)) this.held.set(id, h);
      for (const [id, why] of Object.entries(opts.room.kept ?? {})) if (this.players.has(id)) this.kept.set(id, why);
      this.lobby = opts.room.lobby ?? null;
    } else if (opts.start) {
      this.isOpen = false;
      this.isListed = opts.start.isListed;
      this.name = opts.start.name;
      this.labels = opts.start.labels;
      for (const id of opts.start.players) this.known.add(id);
      this.data = opts.start.data;
      this.keepOut(opts.start.keptOut);
      this.lobby = opts.start.lobby ?? null;
    }
    for (const p of this.players.values()) this.remember(p.id);
    if (opts.state !== undefined) this.state = opts.state;
    else {
      const first = server.setup(this.data) as S | Promise<S>;
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
      broadcast: (messageData, options) => {
        refuseUnknownOptions(options, ["exceptPlayerId"], "room.broadcast");
        this.broadcast(messageData, options?.exceptPlayerId);
      },
      send: (id, messageData) => {
        if (this.players.has(id)) this.transport.send(id, JSON.stringify({ type: "message", data: messageData } satisfies ServerMessage));
      },
      end: (message) => this.end(tidy(message, ROOM_LIMITS.maximumMessageCharacterCount) || "The match is over."),
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
      setName: (name) => this.settle(roomNaming({ name })),
      setLabels: (labels) => this.settle(roomNaming({ labels })),
      // A game server in a sandbox picks the code itself, since it tells the game at once (sandbox.ts).
      reserve: (options: ReserveOptions, chosenRoomCode?: string) => this.reserve(options, chosenRoomCode),
      kick: (id, options) => this.kick(id, options),
      moveTo: (roomCode, options) => this.moveTo(roomCode, options),
    };
  }

  /** What a sleeping room saves besides the game's state. */
  get saved(): SavedRoom {
    this.seatsHeld();
    return {
      ...this.settings(),
      known: [...this.known],
      ...(this.data !== undefined ? { data: this.data } : {}),
      ...(this.keptOut.size ? { keptOut: Object.fromEntries(this.keptOut) } : {}),
      ...(this.expected.size ? { expected: Object.fromEntries(this.expected) } : {}),
      ...(this.held.size ? { held: Object.fromEntries(this.held) } : {}),
      ...(this.kept.size ? { kept: Object.fromEntries(this.kept) } : {}),
      ...(this.lobby ? { lobby: this.lobby } : {}),
    };
  }

  /** Players in the match who haven't walked away: what room lists and "playing now" count. */
  get playing(): number {
    return this.players.size - this.kept.size;
  }

  /** Seats the room holds for players on their way (room.moveTo) or out of the match for now. */
  get heldSeats(): number {
    return this.seatsHeld();
  }

  /** Resolves once every handler started so far has finished (at once for game servers that answer at once). */
  async settled(): Promise<void> {
    while (this.queue) {
      const q = this.queue;
      await q;
      if (this.queue === q) return;
    }
  }

  get ticking(): boolean {
    return this.server.ticksPerSec !== undefined;
  }

  /**
   * Whether a player may come in: the room's own rules (over, kept out, closed, full), then the game
   * server's canJoin with the joinData the player brought. Call before join; join checks the room's rules again.
   */
  async admit(player: Player, joinData?: unknown): Promise<Admission> {
    const door = this.door(player.id);
    if (door) return door;
    // Players already in, players another room sent (asked when it sent them) and players coming back to a held seat don't ask again.
    if (this.players.has(player.id) || this.seat(player.id) || this.holding(player.id)) return { ok: true };
    return this.ask(player, joinData, { fromRoomCode: null, isReturning: false });
  }

  /** The game server's canJoin, then the room's rules again, since things may change while it decides. */
  private async ask(player: Player, joinData: unknown, joinInfo: JoinInfo): Promise<Admission> {
    const moving = joinInfo.fromRoomCode !== null;
    if (!this.server.canJoin) return this.door(player.id, moving) ?? { ok: true };
    await this.settled();
    let answer: unknown;
    try {
      answer = await this.server.canJoin(this.state, player, this.api, joinData, joinInfo);
    } catch (error) {
      console.error("Game server error:", error);
      return { ok: false, code: "refused" };
    }
    if (answer === false) return { ok: false, code: "refused" };
    if (answer !== true && answer !== undefined && answer !== null) {
      const refusalMessage = (answer as { refusalMessage?: unknown }).refusalMessage;
      if (typeof answer !== "object" || typeof refusalMessage !== "string") {
        console.error("Game server error: canJoin must answer true, false or { refusalMessage }, not", answer);
        return { ok: false, code: "refused" };
      }
      const message = tidy(refusalMessage, ROOM_LIMITS.maximumMessageCharacterCount);
      return { ok: false, code: "refused", ...(message ? { message } : {}) };
    }
    return this.door(player.id, moving) ?? { ok: true };
  }

  /**
   * The room's own rules for a player coming in, or null if they may. A player already in may always
   * come back, and a player another room sent, or whose seat is held, has a seat. moving: the game is
   * sending this player from another room, which a closed room still takes (closed keeps out
   * strangers, not the game).
   */
  private door(id: string, moving = false): Admission | null {
    if (this.ended) return { ok: false, code: "ended" };
    const out = this.keptOut.get(id);
    if (out !== undefined) return { ok: false, code: "kept_out", message: out };
    if (this.players.has(id) || this.seat(id) || this.holding(id)) return null;
    if (!moving && !this.isOpen && !this.known.has(id)) return { ok: false, code: "closed" };
    if (this.players.size + this.seatsHeld() >= this.maximumPlayerCount) return { ok: false, code: "full" };
    return null;
  }

  /** Whether this room is holding a place for a player: they've been in it, another room is sending them, or their seat is held. */
  expects(id: string): boolean {
    return this.known.has(id) || this.seat(id) !== null || this.holding(id) !== null;
  }

  /** The seat held for a player out of the match, if it hasn't run out. */
  private holding(id: string): Held | null {
    const h = this.held.get(id);
    if (h && h.until > this.now()) return h;
    if (h) {
      this.held.delete(id);
      this.listingChanged = true;
      this.dirty = true;
    }
    return null;
  }

  /** The seat held for a player another room is sending, if it hasn't run out. */
  private seat(id: string): Expected | null {
    const e = this.expected.get(id);
    if (e && e.until > this.now()) return e;
    if (e) this.expected.delete(id);
    return null;
  }

  /** Seats held for players other rooms are sending and players out of the match, dropping those that ran out. */
  private seatsHeld(): number {
    let held = 0;
    for (const id of [...this.expected.keys()]) if (!this.players.has(id) && this.seat(id)) held++;
    for (const id of [...this.held.keys()]) if (this.holding(id)) held++;
    return held;
  }

  /**
   * Another room of the game wants to send players here (its room.moveTo). Each is checked like a
   * newcomer, with the room's rules and canJoin given the sending room's joinData; those taken get a
   * seat for a minute. Says who was taken and who wasn't, and why.
   */
  async expect(ask: MoveAsk): Promise<{ moved: string[]; refused: { id: string; code: RoomErrorCode; reason: string }[] }> {
    const moved: string[] = [];
    const refused: { id: string; code: RoomErrorCode; reason: string }[] = [];
    const data = roomData(ask.data);
    for (const player of ask.players) {
      const verdict = this.players.has(player.id)
        ? ({ ok: false, code: "bad_message", message: "Already in that room." } as const)
        : await this.ask(player, data.ok ? data.data : undefined, { fromRoomCode: ask.from, isReturning: false });
      if (verdict.ok) {
        this.expected.set(player.id, { ...(data.ok && data.data !== undefined ? { data: data.data } : {}), from: ask.from, until: this.now() + SEAT_MS });
        moved.push(player.id);
      } else refused.push({ id: player.id, code: verdict.code, reason: verdict.message || ERROR_TEXT[verdict.code] });
    }
    if (moved.length) this.dirty = true;
    return { moved, refused };
  }

  /**
   * A player arrives. Joining again with the same ID (a reconnect) keeps their place. The player who
   * makes the room can hide it from the start (a private match) and name and label it. joinData is
   * what the player's game sent along, for onJoin; idleTimeoutSec is the idle check it asked for
   * (idleCheck "client").
   */
  join(player: Player, options: JoinOptions = {}): { ok: true; rejoined: boolean } | { ok: false; code: RoomErrorCode; message?: string } {
    const rejoined = this.players.has(player.id);
    const door = this.door(player.id);
    if (door && !door.ok) return door;
    // A player another room sent brings what that room's game server passed, not what their browser sent.
    const seat = rejoined ? null : this.seat(player.id);
    const back = rejoined || seat ? null : this.holding(player.id);
    this.expected.delete(player.id);
    if (back) this.held.delete(player.id);
    const joinData = seat ? seat.data : options.joinData;
    const joinInfo: JoinInfo = { fromRoomCode: seat ? seat.from : null, isReturning: Boolean(back) };
    if (this.known.size === 0) {
      if (options.isListed === false) this.isListed = false;
      Object.assign(this, roomNaming({ name: options.name, labels: options.labels }));
    }
    this.players.set(player.id, player);
    this.remember(player.id);
    this.presence.set(player.id, { seen: this.now(), idleTimeoutSec: options.idleTimeoutSec === undefined ? this.presence.get(player.id)?.idleTimeoutSec : options.idleTimeoutSec });
    this.transport.send(player.id, JSON.stringify({ type: "welcome", me: player, players: this.list(), roomSettings: this.settings(), hostPlayerId: this.host, awayChecks: this.checks(player.id) } satisfies ServerMessage));
    if (!rejoined) {
      this.listingChanged = true;
      this.run(() => this.server.onJoin?.(this.state, player, this.api, joinData, joinInfo));
      this.broadcastPlayers();
    } else if (this.kept.has(player.id)) this.back(player.id);
    return { ok: true, rejoined };
  }

  /**
   * A player's connection closed: they left (closed the game, or followed a move), or it was lost. A
   * lost player's seat is held for a while, so they can come straight back.
   */
  leave(playerId: string, leaveReason: "left" | "connection_lost" = "left"): void {
    if (this.held.has(playerId)) {
      // A player out of the match went for good: their seat is free. A lost connection keeps it held.
      if (leaveReason === "left") {
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
    if (leaveReason === "connection_lost") this.hold(player, "connection_lost");
    this.run(() => this.server.onLeave?.(this.state, player, this.api, { leaveReason }));
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

  /** Hold a seat for a player out of the match, for the game's seatHoldDurationSec. Returns that duration. */
  private hold(player: Player, why: Held["why"]): number {
    const seatHoldDurationSec = this.server.seatHoldDurationSec ?? ROOM_LIMITS.defaultSeatHoldDurationSec;
    if (seatHoldDurationSec > 0) this.held.set(player.id, { player, why, until: this.now() + seatHoldDurationSec * 1000 });
    this.listingChanged = true;
    this.dirty = true;
    return seatHoldDurationSec;
  }

  /** When this room counts a player as away (welcome's awayChecks), by the game's settings and what their game asked for. */
  private checks(playerId: string): AwayChecks {
    return { idleTimeoutSec: this.idleLimit(playerId), hiddenTimeoutSec: this.ticking ? ROOM_LIMITS.hiddenTimeoutSec : null };
  }

  /** Seconds without input before a player counts as idle, or null if the idle check is off for them. */
  private idleLimit(playerId: string): number | null {
    const idleCheck = this.server.idleCheck ?? "server";
    if (idleCheck === "off") return null;
    if (idleCheck === "server") return this.server.idleTimeoutSec ?? ROOM_LIMITS.defaultIdleTimeoutSec;
    const chosenIdleTimeoutSec = this.presence.get(playerId)?.idleTimeoutSec;
    return chosenIdleTimeoutSec === undefined ? ROOM_LIMITS.defaultIdleTimeoutSec : chosenIdleTimeoutSec;
  }

  /**
   * A player walked away: idle (they didn't answer "Still there?", or the room heard nothing for
   * longer), or their game hidden too long in a real-time room. The game's onAway decides; otherwise
   * they leave the match with their seat held, and with awayMode "send_to_lobby" are sent to the lobby.
   */
  private walkAway(playerId: string, awayReason: AwayReason): void {
    const player = this.players.get(playerId);
    if (!player || this.ended || this.kept.has(playerId)) return;
    if (this.server.onAway) {
      const p = this.presence.get(playerId);
      if (p) p.hiddenAt = undefined;
      this.kept.set(playerId, awayReason);
      this.listingChanged = true;
      this.dirty = true;
      this.run(() => this.server.onAway!(this.state, player, this.api, awayReason));
      return;
    }
    this.out(playerId);
    const seatHoldDurationSec = this.hold(player, awayReason);
    this.transport.send(playerId, JSON.stringify({ type: "away", awayReason, seatHoldDurationSec } satisfies ServerMessage));
    this.run(() => this.server.onLeave?.(this.state, player, this.api, { leaveReason: awayReason }));
    this.broadcastPlayers();
    if (this.server.awayMode === "send_to_lobby" && this.lobby && this.transport.moveTo) {
      this.sentAway.add(playerId);
      this.transport.moveTo(this.lobby, { players: [player] });
    } else if (!seatHoldDurationSec) this.transport.close(playerId, CLOSE_SEAT_GONE, "Seat no longer held");
  }

  /** A player who walked away is back: kept in the room by onAway, or coming back to their held seat. */
  private back(playerId: string, joinData?: unknown, idleTimeoutSec?: number | null): RoomErrorCode | null {
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
    const brought = roomData(joinData);
    const result = this.join(held.player, { joinData: brought.ok ? brought.data : undefined, idleTimeoutSec });
    return result.ok ? null : result.code;
  }

  /**
   * Check on the room's players, every half a minute or so: players the room hasn't heard from in
   * longer than the idle check allows (a game that doesn't ask "Still there?"), and players whose
   * game has been hidden too long in a real-time room, walk away; held seats that ran out are freed,
   * and those players' connections close.
   */
  sweep(): void {
    if (this.ended) return;
    const now = this.now();
    for (const [id, p] of [...this.presence]) {
      if (this.kept.has(id)) continue;
      const idleTimeoutSec = this.idleLimit(id);
      if (idleTimeoutSec !== null && now - p.seen >= idleTimeoutSec * 1000 + IDLE_ASK_MS + IDLE_GRACE_MS) this.walkAway(id, "idle");
      else if (this.ticking && p.hiddenAt !== undefined && now - p.hiddenAt >= ROOM_LIMITS.hiddenTimeoutSec * 1000) this.walkAway(id, "hidden");
    }
    for (const [id, h] of [...this.held]) {
      if (h.until > now) continue;
      this.held.delete(id);
      this.listingChanged = true;
      this.dirty = true;
      this.transport.close(id, CLOSE_SEAT_GONE, "Seat no longer held");
    }
  }

  /** A raw text message from a client. Returns an error code if it was refused. */
  receive(playerId: string, text: string): RoomErrorCode | null {
    const player = this.players.get(playerId);
    const held = !player && this.held.has(playerId);
    if ((!player && !held) || this.ended) return "ended";
    this.messages++;
    if (text.length > ROOM_LIMITS.maximumMessageSizeBytes || new TextEncoder().encode(text).length > ROOM_LIMITS.maximumMessageSizeBytes) return "too_big";
    if (!this.take(playerId)) return "too_fast";
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return "bad_message";
    }
    const m = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
    // Out of the match with their seat held, a player can only come back; anything else waits.
    if (held) return m.type === "back" ? this.back(playerId, m.joinData, clientIdleTimeoutSec(m.idleCheck, m.idleTimeoutSec)) : null;
    const p = this.presence.get(playerId);
    if (p) p.seen = this.now();
    switch (m.type) {
      case "update_room":
        return this.hostChange(playerId, m);
      case "kick":
        return this.hostKick(playerId, m);
      case "here":
        return null;
      case "idle":
        this.walkAway(playerId, "idle");
        return null;
      case "hidden":
        if (p && this.ticking) p.hiddenAt ??= this.now();
        return null;
      case "shown":
        if (p) p.hiddenAt = undefined;
        return this.kept.get(playerId) === "hidden" ? this.back(playerId) : null;
      case "back":
        return this.back(playerId);
      case "message":
        this.run(() => this.server.onMessage?.(this.state, player!, m.data, this.api));
        return null;
      default:
        return "bad_message";
    }
  }

  /** The host: the room's first player, when the game server has host controls on. */
  get host(): string | null {
    return this.server.hostControlsEnabled ? (this.players.keys().next().value ?? null) : null;
  }

  /**
   * The host kicks a player, when the game server allows it. Players can't type the message (no free
   * text between strangers), so the kicked player is told the host removed them.
   */
  private hostKick(playerId: string, request: Record<string, unknown>): RoomErrorCode | null {
    if (this.host !== playerId) return "not_allowed";
    if (typeof request.playerId !== "string" || request.playerId === playerId || !this.players.has(request.playerId)) return "bad_message";
    this.kick(request.playerId, { message: "The host removed you from this room.", keepOut: request.keepOut === true });
    return null;
  }

  /** The host hides, shows, opens, closes, names or labels the room, when the game server allows it. */
  private hostChange(playerId: string, request: Record<string, unknown>): RoomErrorCode | null {
    if (this.host !== playerId) return "not_allowed";
    const change: Partial<RoomSettings> = roomNaming(request as RoomNaming);
    if (typeof request.isListed === "boolean") change.isListed = request.isListed;
    if (typeof request.isOpen === "boolean") change.isOpen = request.isOpen;
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
    const text = JSON.stringify({ type: "room_settings", roomSettings: next } satisfies ServerMessage);
    for (const id of this.players.keys()) this.transport.send(id, text);
  }

  /** A room made for some of this room's players (room.reserve). Mistakes in the game's call throw. */
  private reserve(options: ReserveOptions, chosenRoomCode?: string): string {
    refuseUnknownOptions(options, ["playerIds", "startData", "isListed", "name", "labels"], "room.reserve");
    if (!this.transport.reserve) throw new GameServerError("not_available", "Reserved rooms aren't available here.");
    if (this.ended) throw new GameServerError("room_ended", "This room has ended.");
    const players = [...new Set(Array.isArray(options?.playerIds) ? options.playerIds : [])].filter((id) => this.players.has(id));
    if (!players.length) throw new GameServerError("bad_option", "room.reserve needs playerIds of players in this room.");
    const startData = roomData(options.startData);
    if (!startData.ok) throw new GameServerError("bad_option", `startData must be plain JSON up to ${ROOM_LIMITS.maximumDataSizeBytes / 1024} KB.`);
    this.limit();
    const naming = roomNaming({ name: options.name ?? null, labels: options.labels ?? {} });
    const code = typeof chosenRoomCode === "string" && isRoomCode(chosenRoomCode) ? chosenRoomCode : roomCode();
    this.transport.reserve(code, {
      players,
      data: startData.data,
      isListed: options.isListed === true,
      name: naming.name ?? null,
      labels: naming.labels ?? {},
      ...(this.keptOut.size ? { keptOut: Object.fromEntries(this.keptOut) } : {}),
    });
    return code;
  }

  /** Send players to another room of the game (room.moveTo). Mistakes in the game's call throw. */
  private moveTo(code: string, options: MoveOptions): void {
    refuseUnknownOptions(options, ["playerIds", "joinData"], "room.moveTo");
    if (!this.transport.moveTo) throw new GameServerError("not_available", "Moving players isn't available here.");
    if (this.ended) throw new GameServerError("room_ended", "This room has ended.");
    if (typeof code !== "string" || !isRoomCode(code)) throw new GameServerError("bad_option", "room.moveTo needs a room code, like the one room.reserve gave.");
    const players = [...new Set(Array.isArray(options?.playerIds) ? options.playerIds : [])].map((id) => this.players.get(id)).filter((p): p is Player => Boolean(p));
    if (!players.length) throw new GameServerError("bad_option", "room.moveTo needs playerIds of players in this room.");
    const joinData = roomData(options.joinData);
    if (!joinData.ok) throw new GameServerError("bad_option", `joinData must be plain JSON up to ${ROOM_LIMITS.maximumDataSizeBytes / 1024} KB.`);
    this.limit();
    this.transport.moveTo(code, { players, data: joinData.data });
  }

  /**
   * The other room's answer to room.moveTo, for onMoved. Players it took who already left, or who
   * aren't here, are left out.
   */
  moved(code: string, answer: { moved: string[]; refused: { id: string; code: RoomErrorCode; reason: string }[] }, sent: Player[]): void {
    // The room sending a player who walked away to its lobby: if the lobby turned them away, their seat
    // here stays held, and with no seat held (seatHoldDurationSec: 0) there's nothing to stay connected for.
    if (sent.length === 1 && this.sentAway.delete(sent[0]!.id)) {
      const id = sent[0]!.id;
      if (!answer.moved.includes(id) && !this.players.has(id) && !this.holding(id)) this.transport.close(sent[0]!.id, CLOSE_SEAT_GONE, "Seat no longer held");
      return;
    }
    if (this.ended || !this.server.onMoved) return;
    const who = new Map(sent.map((p) => [p.id, p]));
    const moveResult: MoveResult = {
      roomCode: code,
      movedPlayers: answer.moved.map((id) => who.get(id)).filter((p): p is Player => Boolean(p)),
      refusedPlayers: answer.refused.filter((r) => who.has(r.id)).map((r) => ({ player: who.get(r.id)!, error: { code: r.code, message: r.reason } })),
    };
    this.run(() => this.server.onMoved!(this.state, moveResult, this.api));
  }

  /** Reserving rooms and moving players share one limit a minute. */
  private limit(): void {
    const now = this.now();
    this.reservedAt = this.reservedAt.filter((at) => now - at < 60_000);
    if (this.reservedAt.length >= ROOM_LIMITS.maximumReservesPerMin) throw new GameServerError("slow_down", `A room can reserve rooms or move players up to ${ROOM_LIMITS.maximumReservesPerMin} times a minute.`);
    this.reservedAt.push(now);
  }

  /** Remove a player (room.kick). Their onLeave runs once the handler that kicked them is done. */
  kick(playerId: string, options?: KickOptions): void {
    refuseUnknownOptions(options, ["message", "keepOut"], "room.kick");
    const player = this.players.get(playerId);
    const held = this.held.get(playerId);
    if ((!player && !held) || this.ended) return;
    const message = tidy(options?.message, ROOM_LIMITS.maximumMessageCharacterCount) || ERROR_TEXT.kept_out;
    const isKeptOut = options?.keepOut === true;
    this.known.delete(playerId);
    if (isKeptOut) this.keepOut({ [playerId]: message });
    this.transport.send(playerId, JSON.stringify({ type: "kicked", message, isKeptOut } satisfies ServerMessage));
    this.transport.close(playerId, CLOSE_REFUSED, "Removed from the room");
    this.held.delete(playerId);
    this.out(playerId);
    // A player out of the match with their seat held already left it: there's no onLeave to run.
    if (!player) return;
    this.soon(() => {
      if (this.ended) return;
      this.run(() => this.server.onLeave?.(this.state, player, this.api, { leaveReason: "kicked" }));
      this.broadcastPlayers();
    });
  }

  /** Keep players out, newest last, up to as many as the room remembers. */
  private keepOut(players: Record<string, string> | undefined): void {
    for (const [id, message] of Object.entries(players ?? {})) {
      if (typeof message !== "string") continue;
      this.keptOut.delete(id);
      this.keptOut.set(id, message.slice(0, ROOM_LIMITS.maximumMessageCharacterCount));
      if (this.keptOut.size > REMEMBERED) this.keptOut.delete(this.keptOut.keys().next().value!);
    }
  }

  /** Run now, or once the handler running now is done, so a handler never runs inside another. */
  private soon(fn: () => void): void {
    if (this.depth) this.afterHandler.push(fn);
    else fn();
  }

  private flush(): void {
    while (!this.depth && this.afterHandler.length) this.afterHandler.shift()!();
  }

  private remember(id: string): void {
    this.known.delete(id);
    this.known.add(id);
    if (this.known.size > REMEMBERED) this.known.delete(this.known.values().next().value!);
  }

  tick(tickDurationSec: number): void {
    // A room where everyone walked away stops running until someone's back.
    if (this.ended || !this.server.onTick || this.playing === 0) return;
    // A game server that hasn't caught up skips this tick; tickDurationSec carries the time over to the next one.
    if (this.waiting > 1) return;
    this.run(() => this.server.onTick!(this.state, tickDurationSec, this.api));
  }

  end(message: string): void {
    if (this.ended) return;
    this.ended = true;
    this.listingChanged = true;
    const text = JSON.stringify({ type: "ended", message } satisfies ServerMessage);
    for (const id of [...this.players.keys(), ...this.held.keys()]) {
      this.transport.send(id, text);
      this.transport.close(id, CLOSE_ENDED, "Match ended");
    }
    this.players.clear();
    this.held.clear();
    this.kept.clear();
    this.presence.clear();
  }

  private list(): Player[] {
    return [...this.players.values()];
  }

  private broadcast(messageData: unknown, exceptPlayerId?: string): void {
    const text = JSON.stringify({ type: "message", data: messageData } satisfies ServerMessage);
    for (const id of this.players.keys()) if (id !== exceptPlayerId) this.transport.send(id, text);
  }

  private broadcastPlayers(): void {
    const text = JSON.stringify({ type: "players", players: this.list(), hostPlayerId: this.host } satisfies ServerMessage);
    for (const id of this.players.keys()) this.transport.send(id, text);
  }

  /** Token bucket per player: a short burst is fine, a flood is dropped. */
  private take(playerId: string): boolean {
    const now = this.now();
    const b = this.buckets.get(playerId) ?? { tokens: ROOM_LIMITS.messageBurstCount, at: now };
    b.tokens = Math.min(ROOM_LIMITS.messageBurstCount, b.tokens + ((now - b.at) / 1000) * ROOM_LIMITS.messagesPerSec);
    b.at = now;
    this.buckets.set(playerId, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  /** Run a game server handler. A crash in game code is logged and never takes the room down. */
  private run(fn: () => Result<S> | Promise<Result<S>>): void {
    if (!this.queue) {
      let next: Result<S> | Promise<Result<S>>;
      this.depth++;
      try {
        next = fn();
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
      fn = () => started;
    }
    this.waiting++;
    this.queue = this.queue.then(async () => {
      this.depth++;
      try {
        const next = await fn();
        if (next !== undefined) this.state = next as S;
        this.dirty = true;
      } catch (error) {
        console.error("Game server error:", error);
      } finally {
        this.waiting--;
        this.depth--;
        this.flush();
      }
    });
  }
}

function isPromise<T>(v: unknown): v is Promise<T> {
  return typeof (v as { then?: unknown } | null)?.then === "function";
}

/** What the room knows about a player in the match, for the away checks. */
interface Presence {
  /** When the room last heard from them (any message but a ping). */
  seen: number;
  /** Since when their game has been hidden, as their game said. */
  hiddenAt?: number;
  /** The idle check their game asked for, for idleCheck "client": seconds, null for none, or undefined for the default. */
  idleTimeoutSec?: number | null;
}

// Characters that hide text or flip its direction.
const HIDDEN = /[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
const tidy = (v: unknown, max: number) =>
  String(v ?? "")
    .normalize("NFKC")
    .replace(HIDDEN, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();

/** A name and labels within the limits, with hidden characters dropped. Fields left out stay out. */
export function roomNaming(naming: RoomNaming): Partial<Pick<RoomSettings, "name" | "labels">> {
  const out: Partial<Pick<RoomSettings, "name" | "labels">> = {};
  if (naming.name !== undefined) out.name = naming.name === null ? null : tidy(naming.name, ROOM_LIMITS.maximumNameCharacterCount) || null;
  if (naming.labels !== undefined) {
    const labels: Record<string, string> = {};
    if (naming.labels && typeof naming.labels === "object") {
      for (const [k, v] of Object.entries(naming.labels)) {
        const key = tidy(k, ROOM_LIMITS.maximumLabelNameCharacterCount);
        const value = typeof v === "string" || typeof v === "number" ? tidy(v, ROOM_LIMITS.maximumLabelValueCharacterCount) : "";
        if (key && value && Object.keys(labels).length < ROOM_LIMITS.maximumLabelCount) labels[key] = value;
      }
    }
    out.labels = labels;
  }
  return out;
}
