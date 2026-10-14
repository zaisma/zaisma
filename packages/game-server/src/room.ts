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
  id: string;
  name: string;
}

export interface Room {
  /** Players in the room right now, in join order. */
  readonly players: readonly Player[];
  /** Send a message to every player, or everyone except one. */
  broadcast(msg: unknown, opts?: { except?: string }): void;
  /** Send a message to one player. */
  send(playerId: string, msg: unknown): void;
  /** End the match: everyone is disconnected and the room closes. */
  end(reason?: string): void;
  /** Shown in room lists (the game page and Zaisma.rooms.list). A hidden room still works by code and link. */
  readonly listed: boolean;
  setListed(listed: boolean): void;
  /** Taking new players. A closed room lets back only players who were already in it. */
  readonly open: boolean;
  setOpen(open: boolean): void;
  /** The room's name, like "Ana's castle", or null. Up to 40 characters. */
  readonly name: string | null;
  /** Up to 4 labels players can filter by, like { Mode: "Classic", Map: "Docks" }. */
  readonly labels: Readonly<Record<string, string>>;
  /**
   * Name and label the room, from the game or from what a player typed. Names and labels a player
   * typed show on zaisma.com only if they pass Zaisma's text filter; your game is responsible for
   * them inside the game. Leave a field out to keep it; null clears it.
   */
  setInfo(info: RoomInfo): void;
  /**
   * Make a new room for some of this room's players, like a lobby starting a match, and move them
   * there. The new room runs this same game server: its setup(data) gets your data, only the players
   * named can join it (a closed room, until it opens), and it's hidden from room lists unless you
   * list it. Each player gets a "move" event in the game and joins when the game says so.
   * Returns the new room's code. The data is plain JSON, up to 4 KB; players can read it but not change it.
   */
  reserve(opts: ReserveOptions): string;
  /**
   * Remove a player from the room, telling them why (up to 200 characters; your game's words, so
   * keep them within the content rules). keepOut keeps them out of this room for the rest of the
   * match, and out of any room it reserves after. onLeave runs once the current handler is done.
   */
  kick(playerId: string, opts?: KickOptions): void;
  /**
   * Send some of this room's players to another room of this game that already exists, like back to
   * their party's match or into the next area of an open world. The other room's canJoin decides with
   * your data (plain JSON, up to 4 KB) and holds a seat for each player it takes for a minute, even
   * if it's closed to new players; its onJoin gets the same data. Each player taken gets a "move" event in the game, which follows by
   * default. onMoved then says who was taken and who was turned away; they stay here.
   */
  moveTo(code: string, opts: MoveOptions): void;
}

export interface MoveOptions {
  players: string[];
  data?: unknown;
}

/** Who another room took (room.moveTo) and who it turned away, and why. */
export interface MoveResult {
  code: string;
  moved: Player[];
  refused: { player: Player; code: RoomErrorCode; reason: string }[];
}

/** How a player came in: from, the code of the room that sent them (room.moveTo), or undefined. */
export interface JoinInfo {
  from?: string;
}

/** What one room asks another when moving players there; from is the asking room's code, added by the transport. */
export interface MoveAsk {
  from: string;
  players: Player[];
  data?: unknown;
}

export interface KickOptions {
  reason?: string;
  keepOut?: boolean;
}

/** A room made for some players: who, the data its game server starts with, and how it shows. */
export interface ReserveOptions extends RoomInfo {
  players: string[];
  data?: unknown;
  listed?: boolean;
}

/** How a reserved room starts, as the room that made it sends it on. */
export interface RoomStart extends Pick<RoomSettings, "listed" | "name" | "labels"> {
  players: string[];
  data?: unknown;
  /** Players kept out of the room that made this one, and why: they stay out of this one too. */
  keptOut?: Record<string, string>;
}

/** A room's name and labels, as a game sets them. */
export interface RoomInfo {
  name?: string | null;
  labels?: Record<string, string | number> | null;
}

type Result<S> = void | S;

export interface GameServer<S = any> {
  /** Up to 16. Defaults to 8. */
  maxPlayers?: number;
  /** Ticks per second, up to 30. Leave out for turn-based games so the room can sleep between moves. */
  tickRate?: number;
  /**
   * The room's first player is its host: they may hide, show, open, close and name the room, and
   * kick players, from the game. When the host leaves, the next player takes over. The relay has this on.
   */
  hostControls?: boolean;
  /**
   * The starting state. It must be plain JSON so a sleeping room can be saved and woken. data is
   * what room.reserve() passed when another room made this one, and undefined otherwise.
   */
  setup(data?: unknown): S;
  /**
   * data is what the player's game passed to joinRoom({ data }), like the character they picked, or
   * undefined. It comes from the player's browser, so check it like any message. For a player another
   * room sent (room.moveTo), data is what that room's game server passed, and info.from is its code.
   */
  onJoin?(state: S, player: Player, room: Room, data?: unknown, info?: JoinInfo): Result<S>;
  /**
   * Say who may come in, before they join: return false, or a reason the player sees (up to 200
   * characters), to turn them away, like a wrong room password in data or a full team. Anything
   * else lets them in. Players coming back after a dropped connection don't ask again. Only decide
   * here; change the state in onJoin. If it throws, the player is turned away. Players another room
   * sends are asked when it sends them, with its data and info.from, and not again when they arrive.
   */
  canJoin?(state: S, player: Player, room: Room, data?: unknown, info?: JoinInfo): boolean | string | void | Promise<boolean | string | void>;
  /** After room.moveTo: who the other room took, and who it turned away and why. */
  onMoved?(state: S, result: MoveResult, room: Room): Result<S>;
  onLeave?(state: S, player: Player, room: Room): Result<S>;
  onMessage?(state: S, player: Player, msg: unknown, room: Room): Result<S>;
  onTick?(state: S, dt: number, room: Room): Result<S>;
}

export const ROOM_LIMITS = {
  maxPlayers: 16,
  defaultPlayers: 8,
  maxTickRate: 30,
  /** A room's name, its labels, and each label's name and value, in characters. */
  nameLength: 40,
  labels: 4,
  labelName: 16,
  labelValue: 24,
  /** Data a player brings to a room, and data a reserved room starts with, in bytes of JSON. */
  dataBytes: 4 * 1024,
  /** Rooms one room may reserve or move players to a minute: enough for a full lobby, not for a bug that does it every tick. */
  reservesPerMinute: 20,
  /** A kick's or a refusal's reason, in characters. */
  reasonLength: 200,
  /** Largest message a client may send, in bytes. */
  messageBytes: 16 * 1024,
  /** Sustained messages per second per player, with a short burst allowance. */
  messagesPerSecond: 30,
  burst: 60,
} as const;

/** Check a game server's settings once, when it's defined. */
export function defineGameServer<S>(server: GameServer<S>): GameServer<S> {
  if (typeof server.setup !== "function") throw new Error("A game server needs a setup() function");
  const max = server.maxPlayers ?? ROOM_LIMITS.defaultPlayers;
  if (!Number.isInteger(max) || max < 1 || max > ROOM_LIMITS.maxPlayers) throw new Error(`maxPlayers must be 1 to ${ROOM_LIMITS.maxPlayers}`);
  if (server.tickRate !== undefined && !(server.tickRate > 0 && server.tickRate <= ROOM_LIMITS.maxTickRate)) {
    throw new Error(`tickRate must be above 0 and at most ${ROOM_LIMITS.maxTickRate}`);
  }
  return server;
}

/** Whether a room shows in room lists and takes new players, and its name and labels. */
export interface RoomSettings {
  listed: boolean;
  open: boolean;
  name: string | null;
  labels: Record<string, string>;
}

/**
 * Messages from the room to a client. Clients send {t:"hello", pass, data?, room?: {listed, name, labels}}
 * first (data is for canJoin and onJoin; the room's settings only count from the player who makes it), then
 * {t:"msg", d}; with hostControls, the host may also send {t:"room", listed?, open?, name?, labels?} and
 * {t:"kick", player, keepOut?}. host is in welcome and players only with hostControls.
 */
export type ServerMessage =
  | { t: "welcome"; me: Player; players: Player[]; room: RoomSettings; host?: string | null }
  | { t: "players"; players: Player[]; host?: string | null }
  | { t: "kicked"; reason: string; keptOut: boolean }
  | { t: "room"; room: RoomSettings }
  | { t: "move"; code: string }
  | { t: "msg"; d: unknown }
  | { t: "error"; code: RoomErrorCode; message: string }
  | { t: "ended"; reason: string };

export type RoomErrorCode = "full" | "closed" | "ended" | "too-big" | "too-fast" | "bad-message" | "bad-pass" | "no-hello" | "not-allowed" | "game-unavailable" | "busy" | "kept-out" | "refused" | "no-room" | "month-limit";

export const ERROR_TEXT: Record<RoomErrorCode, string> = {
  full: "This room is full.",
  closed: "This room isn't taking new players.",
  ended: "This match has ended.",
  "too-big": "Message too big.",
  "too-fast": "Too many messages. Slow down.",
  "bad-message": "Messages must be JSON.",
  "bad-pass": "Your player pass isn't valid for this game.",
  "no-hello": "Send your player pass first.",
  "not-allowed": "Only the game server or the room's host can do that.",
  "game-unavailable": "This game isn't available right now.",
  busy: "Rooms are busy. Try again soon.",
  "kept-out": "You were removed from this room.",
  refused: "The game didn't let you into this room.",
  "no-room": "That room isn't running.",
  "month-limit": "This game has used this month's multiplayer time. New rooms open again next month.",
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

/** Plain JSON within ROOM_LIMITS.dataBytes, or undefined if it isn't. Players' data that fails this is refused. */
export function roomData(data: unknown): { ok: true; data: unknown } | { ok: false } {
  if (data === undefined) return { ok: true, data: undefined };
  let text: string | undefined;
  try {
    text = JSON.stringify(data);
  } catch {
    return { ok: false };
  }
  if (text === undefined || new TextEncoder().encode(text).length > ROOM_LIMITS.dataBytes) return { ok: false };
  return { ok: true, data: JSON.parse(text) };
}

/** An error for a client. message replaces the usual text, like the game's reason for turning a player away. */
export function errorMessage(code: RoomErrorCode, message?: string): string {
  return JSON.stringify({ t: "error", code, message: message || ERROR_TEXT[code] } satisfies ServerMessage);
}

/** Whether a player may come in, and if not, why. */
export type Admission = { ok: true } | { ok: false; code: RoomErrorCode; message?: string };

/** WebSocket close code for a match that ended normally. */
export const CLOSE_ENDED = 4000;
/** Close code for a player refused or removed by the room. */
export const CLOSE_REFUSED = 4001;

/** How many past players a room remembers, so they can come back to a closed room, and how many it keeps out. */
const REMEMBERED = 64;

export class RoomCore<S = any> {
  state: S;
  readonly players = new Map<string, Player>();
  ended = false;
  /** Messages received from clients, for usage counts. */
  messages = 0;
  /** Set when the state changed and a sleeping room should save it. */
  dirty = false;
  listed = true;
  open = true;
  name: string | null = null;
  labels: Record<string, string> = {};
  /** Set when the player count, listed or open changed, so the room list can be brought up to date. */
  listingChanged = false;
  /** Players who have been in this room, newest last: they may come back after it closes. */
  readonly known = new Set<string>();
  /** Players kicked and kept out for the rest of the match, with the reason they were given. */
  readonly keptOut = new Map<string, string>();
  /** Players other rooms are sending here (room.moveTo), with a seat each until they arrive. */
  readonly expected = new Map<string, Expected>();
  /** What a reserved room started with, kept so a room that starts over starts the same way. */
  private data: unknown = undefined;
  /** When this room last reserved rooms, for the limit. */
  private reservedAt: number[] = [];
  private buckets = new Map<string, { tokens: number; at: number }>();
  private readonly now: () => number;
  readonly maxPlayers: number;
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
   * with its data. A saved room (opts.room) wakes as it was.
   */
  constructor(server: GameServer<S>, transport: Transport, opts: { state?: S; players?: Player[]; room?: SavedRoom; start?: RoomStart; now?: () => number } = {}) {
    this.server = server;
    this.transport = transport;
    this.now = opts.now ?? Date.now;
    this.maxPlayers = server.maxPlayers ?? ROOM_LIMITS.defaultPlayers;
    for (const p of opts.players ?? []) this.players.set(p.id, p);
    if (opts.room) {
      this.listed = opts.room.listed;
      this.open = opts.room.open;
      this.name = opts.room.name ?? null;
      this.labels = opts.room.labels ?? {};
      for (const id of opts.room.known) this.known.add(id);
      this.data = opts.room.data;
      this.keepOut(opts.room.keptOut);
      for (const [id, e] of Object.entries(opts.room.expected ?? {})) this.expected.set(id, e);
    } else if (opts.start) {
      this.open = false;
      this.listed = opts.start.listed;
      this.name = opts.start.name;
      this.labels = opts.start.labels;
      for (const id of opts.start.players) this.known.add(id);
      this.data = opts.start.data;
      this.keepOut(opts.start.keptOut);
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
      broadcast: (msg, o) => this.broadcast(msg, o?.except),
      send: (id, msg) => {
        if (this.players.has(id)) this.transport.send(id, JSON.stringify({ t: "msg", d: msg } satisfies ServerMessage));
      },
      end: (reason) => this.end(reason ?? "The match is over."),
      get listed() {
        return core.listed;
      },
      setListed: (listed) => this.settle({ listed: Boolean(listed) }),
      get open() {
        return core.open;
      },
      setOpen: (open) => this.settle({ open: Boolean(open) }),
      get name() {
        return core.name;
      },
      get labels() {
        return { ...core.labels };
      },
      setInfo: (info) => this.settle(roomInfo(info)),
      reserve: (o) => this.reserve(o),
      kick: (id, o) => this.kick(id, o),
      moveTo: (code, o) => this.moveTo(code, o),
    };
  }

  /** What a sleeping room saves besides the game's state. */
  get saved(): SavedRoom {
    return {
      ...this.settings(),
      known: [...this.known],
      ...(this.data !== undefined ? { data: this.data } : {}),
      ...(this.keptOut.size ? { keptOut: Object.fromEntries(this.keptOut) } : {}),
      ...(this.seatsHeld() ? { expected: Object.fromEntries(this.expected) } : {}),
    };
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
    return this.server.tickRate !== undefined;
  }

  /**
   * Whether a player may come in: the room's own rules (over, kept out, closed, full), then the game
   * server's canJoin with the data the player brought. Call before join; join checks the room's rules again.
   */
  async admit(player: Player, data?: unknown): Promise<Admission> {
    const door = this.door(player.id);
    if (door) return door;
    // Players already in, and players another room sent (asked when it sent them), don't ask again.
    if (this.players.has(player.id) || this.seat(player.id)) return { ok: true };
    return this.ask(player, data, {});
  }

  /** The game server's canJoin, then the room's rules again, since things may change while it decides. */
  private async ask(player: Player, data: unknown, info: JoinInfo): Promise<Admission> {
    const moving = info.from !== undefined;
    if (!this.server.canJoin) return this.door(player.id, moving) ?? { ok: true };
    await this.settled();
    let verdict: unknown;
    try {
      verdict = await this.server.canJoin(this.state, player, this.api, data, info);
    } catch (err) {
      console.error("Game server error:", err);
      return { ok: false, code: "refused" };
    }
    if (verdict === false) return { ok: false, code: "refused" };
    if (typeof verdict === "string") return { ok: false, code: "refused", ...(tidy(verdict, ROOM_LIMITS.reasonLength) ? { message: tidy(verdict, ROOM_LIMITS.reasonLength) } : {}) };
    return this.door(player.id, moving) ?? { ok: true };
  }

  /**
   * The room's own rules for a player coming in, or null if they may. A player already in may always
   * come back, and a player another room sent has a seat. moving: the game is sending this player
   * from another room, which a closed room still takes (closed keeps out strangers, not the game).
   */
  private door(id: string, moving = false): Admission | null {
    if (this.ended) return { ok: false, code: "ended" };
    const out = this.keptOut.get(id);
    if (out !== undefined) return { ok: false, code: "kept-out", message: out };
    if (this.players.has(id) || this.seat(id)) return null;
    if (!moving && !this.open && !this.known.has(id)) return { ok: false, code: "closed" };
    if (this.players.size + this.seatsHeld() >= this.maxPlayers) return { ok: false, code: "full" };
    return null;
  }

  /** Whether this room is holding a place for a player: they've been in it, or another room is sending them. */
  expects(id: string): boolean {
    return this.known.has(id) || this.seat(id) !== null;
  }

  /** The seat held for a player another room is sending, if it hasn't run out. */
  private seat(id: string): Expected | null {
    const e = this.expected.get(id);
    if (e && e.until > this.now()) return e;
    if (e) this.expected.delete(id);
    return null;
  }

  /** Seats held for players other rooms are sending, dropping those that ran out. */
  private seatsHeld(): number {
    let held = 0;
    for (const id of [...this.expected.keys()]) if (!this.players.has(id) && this.seat(id)) held++;
    return held;
  }

  /**
   * Another room of the game wants to send players here (its room.moveTo). Each is checked like a
   * newcomer, with the room's rules and canJoin given the sending room's data; those taken get a
   * seat for a minute. Says who was taken and who wasn't, and why.
   */
  async expect(ask: MoveAsk): Promise<{ moved: string[]; refused: { id: string; code: RoomErrorCode; reason: string }[] }> {
    const moved: string[] = [];
    const refused: { id: string; code: RoomErrorCode; reason: string }[] = [];
    const data = roomData(ask.data);
    for (const player of ask.players) {
      const verdict = this.players.has(player.id) ? ({ ok: false, code: "bad-message", message: "Already in that room." } as const) : await this.ask(player, data.ok ? data.data : undefined, { from: ask.from });
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
   * makes the room can hide it from the start (a private match) and name and label it. data is what
   * the player's game sent along, for onJoin.
   */
  join(player: Player, opts: { listed?: boolean; data?: unknown } & RoomInfo = {}): { ok: true; rejoined: boolean } | { ok: false; code: RoomErrorCode; message?: string } {
    const rejoined = this.players.has(player.id);
    const door = this.door(player.id);
    if (door && !door.ok) return door;
    // A player another room sent brings what that room's game server passed, not what their browser sent.
    const seat = rejoined ? null : this.seat(player.id);
    this.expected.delete(player.id);
    const data = seat ? seat.data : opts.data;
    const info: JoinInfo = seat ? { from: seat.from } : {};
    if (this.known.size === 0) {
      if (opts.listed === false) this.listed = false;
      Object.assign(this, roomInfo({ name: opts.name, labels: opts.labels }));
    }
    this.players.set(player.id, player);
    this.remember(player.id);
    this.transport.send(player.id, JSON.stringify({ t: "welcome", me: player, players: this.list(), room: this.settings(), ...this.hostField() } satisfies ServerMessage));
    if (!rejoined) {
      this.listingChanged = true;
      this.run(() => this.server.onJoin?.(this.state, player, this.api, data, info));
      this.broadcastPlayers();
    }
    return { ok: true, rejoined };
  }

  leave(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    this.players.delete(playerId);
    this.buckets.delete(playerId);
    this.listingChanged = true;
    if (this.ended) return;
    this.run(() => this.server.onLeave?.(this.state, player, this.api));
    this.broadcastPlayers();
  }

  /** A raw text message from a client. Returns an error code if it was refused. */
  receive(playerId: string, text: string): RoomErrorCode | null {
    const player = this.players.get(playerId);
    if (!player || this.ended) return "ended";
    this.messages++;
    if (text.length > ROOM_LIMITS.messageBytes || new TextEncoder().encode(text).length > ROOM_LIMITS.messageBytes) return "too-big";
    if (!this.take(playerId)) return "too-fast";
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      return "bad-message";
    }
    if (msg && typeof msg === "object" && (msg as { t?: unknown }).t === "room") return this.hostChange(playerId, msg as Record<string, unknown>);
    if (msg && typeof msg === "object" && (msg as { t?: unknown }).t === "kick") return this.hostKick(playerId, msg as Record<string, unknown>);
    if (!msg || typeof msg !== "object" || (msg as { t?: unknown }).t !== "msg") return "bad-message";
    this.run(() => this.server.onMessage?.(this.state, player, (msg as { d?: unknown }).d, this.api));
    return null;
  }

  /** The host: the room's first player, when the game server has host controls on. */
  get host(): string | null {
    return this.server.hostControls ? (this.players.keys().next().value ?? null) : null;
  }

  private hostField(): { host?: string | null } {
    return this.server.hostControls ? { host: this.host } : {};
  }

  /**
   * The host kicks a player, when the game server allows it. Players can't type the reason (no free
   * text between strangers), so the kicked player is told the host removed them.
   */
  private hostKick(playerId: string, msg: Record<string, unknown>): RoomErrorCode | null {
    if (this.host !== playerId) return "not-allowed";
    if (typeof msg.player !== "string" || msg.player === playerId || !this.players.has(msg.player)) return "bad-message";
    this.kick(msg.player, { reason: "The host removed you from this room.", keepOut: msg.keepOut === true });
    return null;
  }

  /** The host hides, shows, opens, closes, names or labels the room, when the game server allows it. */
  private hostChange(playerId: string, msg: Record<string, unknown>): RoomErrorCode | null {
    if (this.host !== playerId) return "not-allowed";
    const change: Partial<RoomSettings> = roomInfo(msg as RoomInfo);
    if (typeof msg.listed === "boolean") change.listed = msg.listed;
    if (typeof msg.open === "boolean") change.open = msg.open;
    this.settle(change);
    this.dirty = true;
    return null;
  }

  private settings(): RoomSettings {
    return { listed: this.listed, open: this.open, name: this.name, labels: { ...this.labels } };
  }

  /** Change listed, open, the name or labels, and tell everyone in the room. */
  private settle(change: Partial<RoomSettings>): void {
    const next = { ...this.settings(), ...change };
    if (JSON.stringify(next) === JSON.stringify(this.settings())) return;
    this.listed = next.listed;
    this.open = next.open;
    this.name = next.name;
    this.labels = next.labels;
    this.listingChanged = true;
    const text = JSON.stringify({ t: "room", room: next } satisfies ServerMessage);
    for (const id of this.players.keys()) this.transport.send(id, text);
  }

  /** A room made for some of this room's players (room.reserve). Mistakes in the game's call throw. */
  private reserve(opts: ReserveOptions & { code?: unknown }): string {
    if (!this.transport.reserve) throw new Error("Reserved rooms aren't available here");
    if (this.ended) throw new Error("This room has ended");
    const players = [...new Set(Array.isArray(opts?.players) ? opts.players : [])].filter((id) => this.players.has(id));
    if (!players.length) throw new Error("room.reserve needs players who are in this room");
    const data = roomData(opts.data);
    if (!data.ok) throw new Error(`Reserved room data must be plain JSON up to ${ROOM_LIMITS.dataBytes / 1024} KB`);
    this.limit();
    const info = roomInfo({ name: opts.name ?? null, labels: opts.labels ?? {} });
    // A game server in a sandbox picks the code itself, since it tells the game at once.
    const code = typeof opts.code === "string" && isRoomCode(opts.code) ? opts.code : roomCode();
    this.transport.reserve(code, {
      players,
      data: data.data,
      listed: opts.listed === true,
      name: info.name ?? null,
      labels: info.labels ?? {},
      ...(this.keptOut.size ? { keptOut: Object.fromEntries(this.keptOut) } : {}),
    });
    return code;
  }

  /** Send players to another room of the game (room.moveTo). Mistakes in the game's call throw. */
  private moveTo(code: string, opts: MoveOptions): void {
    if (!this.transport.moveTo) throw new Error("Moving players isn't available here");
    if (this.ended) throw new Error("This room has ended");
    if (typeof code !== "string" || !isRoomCode(code)) throw new Error("room.moveTo needs a room code");
    const players = [...new Set(Array.isArray(opts?.players) ? opts.players : [])].map((id) => this.players.get(id)).filter((p): p is Player => Boolean(p));
    if (!players.length) throw new Error("room.moveTo needs players who are in this room");
    const data = roomData(opts.data);
    if (!data.ok) throw new Error(`Move data must be plain JSON up to ${ROOM_LIMITS.dataBytes / 1024} KB`);
    this.limit();
    this.transport.moveTo(code, { players, data: data.data });
  }

  /**
   * The other room's answer to room.moveTo, for onMoved. Players it took who already left, or who
   * aren't here, are left out.
   */
  moved(code: string, answer: { moved: string[]; refused: { id: string; code: RoomErrorCode; reason: string }[] }, sent: Player[]): void {
    if (this.ended || !this.server.onMoved) return;
    const who = new Map(sent.map((p) => [p.id, p]));
    const result: MoveResult = {
      code,
      moved: answer.moved.map((id) => who.get(id)).filter((p): p is Player => Boolean(p)),
      refused: answer.refused.filter((r) => who.has(r.id)).map((r) => ({ player: who.get(r.id)!, code: r.code, reason: r.reason })),
    };
    this.run(() => this.server.onMoved!(this.state, result, this.api));
  }

  /** Reserving rooms and moving players share one limit a minute. */
  private limit(): void {
    const now = this.now();
    this.reservedAt = this.reservedAt.filter((at) => now - at < 60_000);
    if (this.reservedAt.length >= ROOM_LIMITS.reservesPerMinute) throw new Error(`A room can reserve rooms or move players up to ${ROOM_LIMITS.reservesPerMinute} times a minute`);
    this.reservedAt.push(now);
  }

  /** Remove a player (room.kick). Their onLeave runs once the handler that kicked them is done. */
  kick(playerId: string, opts?: KickOptions): void {
    const player = this.players.get(playerId);
    if (!player || this.ended) return;
    const reason = tidy(opts?.reason, ROOM_LIMITS.reasonLength) || ERROR_TEXT["kept-out"];
    const keptOut = opts?.keepOut === true;
    this.known.delete(playerId);
    if (keptOut) this.keepOut({ [playerId]: reason });
    this.transport.send(playerId, JSON.stringify({ t: "kicked", reason, keptOut } satisfies ServerMessage));
    this.transport.close(playerId, CLOSE_REFUSED, "Removed from the room");
    this.players.delete(playerId);
    this.buckets.delete(playerId);
    this.listingChanged = true;
    this.dirty = true;
    this.soon(() => {
      if (this.ended) return;
      this.run(() => this.server.onLeave?.(this.state, player, this.api));
      this.broadcastPlayers();
    });
  }

  /** Keep players out, newest last, up to as many as the room remembers. */
  private keepOut(players: Record<string, string> | undefined): void {
    for (const [id, reason] of Object.entries(players ?? {})) {
      if (typeof reason !== "string") continue;
      this.keptOut.delete(id);
      this.keptOut.set(id, reason.slice(0, ROOM_LIMITS.reasonLength));
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

  tick(dt: number): void {
    if (this.ended || !this.server.onTick) return;
    // A game server that hasn't caught up skips this tick; dt carries the time over to the next one.
    if (this.waiting > 1) return;
    this.run(() => this.server.onTick!(this.state, dt, this.api));
  }

  end(reason: string): void {
    if (this.ended) return;
    this.ended = true;
    this.listingChanged = true;
    const text = JSON.stringify({ t: "ended", reason } satisfies ServerMessage);
    for (const id of [...this.players.keys()]) {
      this.transport.send(id, text);
      this.transport.close(id, CLOSE_ENDED, "Match ended");
    }
    this.players.clear();
  }

  private list(): Player[] {
    return [...this.players.values()];
  }

  private broadcast(msg: unknown, except?: string): void {
    const text = JSON.stringify({ t: "msg", d: msg } satisfies ServerMessage);
    for (const id of this.players.keys()) if (id !== except) this.transport.send(id, text);
  }

  private broadcastPlayers(): void {
    const text = JSON.stringify({ t: "players", players: this.list(), ...this.hostField() } satisfies ServerMessage);
    for (const id of this.players.keys()) this.transport.send(id, text);
  }

  /** Token bucket per player: a short burst is fine, a flood is dropped. */
  private take(playerId: string): boolean {
    const now = this.now();
    const b = this.buckets.get(playerId) ?? { tokens: ROOM_LIMITS.burst, at: now };
    b.tokens = Math.min(ROOM_LIMITS.burst, b.tokens + ((now - b.at) / 1000) * ROOM_LIMITS.messagesPerSecond);
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
      } catch (err) {
        console.error("Game server error:", err);
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
      } catch (err) {
        console.error("Game server error:", err);
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

// Characters that hide text or flip its direction.
const HIDDEN = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;
const tidy = (v: unknown, max: number) =>
  String(v ?? "")
    .normalize("NFKC")
    .replace(HIDDEN, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();

/** A name and labels within the limits, with hidden characters dropped. Fields left out stay out. */
export function roomInfo(info: RoomInfo): Partial<Pick<RoomSettings, "name" | "labels">> {
  const out: Partial<Pick<RoomSettings, "name" | "labels">> = {};
  if (info.name !== undefined) out.name = info.name === null ? null : tidy(info.name, ROOM_LIMITS.nameLength) || null;
  if (info.labels !== undefined) {
    const labels: Record<string, string> = {};
    if (info.labels && typeof info.labels === "object") {
      for (const [k, v] of Object.entries(info.labels)) {
        const key = tidy(k, ROOM_LIMITS.labelName);
        const value = typeof v === "string" || typeof v === "number" ? tidy(v, ROOM_LIMITS.labelValue) : "";
        if (key && value && Object.keys(labels).length < ROOM_LIMITS.labels) labels[key] = value;
      }
    }
    out.labels = labels;
  }
  return out;
}
