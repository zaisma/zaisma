/**
 * The game server API and the room logic shared by Zaisma rooms (Durable Objects)
 * and the Node runner, so a game behaves the same in both places.
 *
 * Words: the *client* is the game in the player's browser. The *game server* is the
 * developer's code that holds the official game state. A *room* is one live match,
 * running one copy of the game server.
 */

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
}

type Result<S> = void | S;

export interface GameServer<S = any> {
  /** Up to 16. Defaults to 8. */
  maxPlayers?: number;
  /** Ticks per second, up to 30. Leave out for turn-based games so the room can sleep between moves. */
  tickRate?: number;
  /** The room's first player may hide, show, open and close it from the game. The relay has this on. */
  hostControls?: boolean;
  /** The starting state. It must be plain JSON so a sleeping room can be saved and woken. */
  setup(): S;
  onJoin?(state: S, player: Player, room: Room): Result<S>;
  onLeave?(state: S, player: Player, room: Room): Result<S>;
  onMessage?(state: S, player: Player, msg: unknown, room: Room): Result<S>;
  onTick?(state: S, dt: number, room: Room): Result<S>;
}

export const ROOM_LIMITS = {
  maxPlayers: 16,
  defaultPlayers: 8,
  maxTickRate: 30,
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

/** Whether a room shows in room lists and takes new players. */
export interface RoomSettings {
  listed: boolean;
  open: boolean;
}

/**
 * Messages from the room to a client. Clients send {t:"hello", pass, room?: {listed}} first, then
 * {t:"msg", d}; with hostControls, the first player may also send {t:"room", listed?, open?}.
 */
export type ServerMessage =
  | { t: "welcome"; me: Player; players: Player[]; room: RoomSettings }
  | { t: "players"; players: Player[] }
  | { t: "room"; room: RoomSettings }
  | { t: "msg"; d: unknown }
  | { t: "error"; code: RoomErrorCode; message: string }
  | { t: "ended"; reason: string };

export type RoomErrorCode = "full" | "closed" | "ended" | "too-big" | "too-fast" | "bad-message" | "bad-pass" | "no-hello" | "not-allowed" | "game-unavailable" | "busy";

export const ERROR_TEXT: Record<RoomErrorCode, string> = {
  full: "This room is full.",
  closed: "This room isn't taking new players.",
  ended: "This match has ended.",
  "too-big": "Message too big.",
  "too-fast": "Too many messages. Slow down.",
  "bad-message": "Messages must be JSON.",
  "bad-pass": "Your player pass isn't valid for this game.",
  "no-hello": "Send your player pass first.",
  "not-allowed": "Only the game server or the room's first player can change that.",
  "game-unavailable": "This game isn't available right now.",
  busy: "Rooms are busy. Try again soon.",
};

/** Listed, open and the players who have been in the room, saved with a sleeping room's state. */
export interface SavedRoom extends RoomSettings {
  known: string[];
}

/** How the room reaches players: a Durable Object's sockets, or a Node server's. */
export interface Transport {
  send(playerId: string, text: string): void;
  close(playerId: string, code: number, reason: string): void;
}

export function errorMessage(code: RoomErrorCode): string {
  return JSON.stringify({ t: "error", code, message: ERROR_TEXT[code] } satisfies ServerMessage);
}

/** WebSocket close code for a match that ended normally. */
export const CLOSE_ENDED = 4000;
/** Close code for a player refused or removed by the room. */
export const CLOSE_REFUSED = 4001;

/** How many past players a room remembers, so they can come back to a closed room. */
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
  /** Set when the player count, listed or open changed, so the room list can be brought up to date. */
  listingChanged = false;
  /** Players who have been in this room, newest last: they may come back after it closes. */
  readonly known = new Set<string>();
  private buckets = new Map<string, { tokens: number; at: number }>();
  private readonly now: () => number;
  readonly maxPlayers: number;
  private readonly api: Room;
  readonly server: GameServer<S>;
  private readonly transport: Transport;

  constructor(server: GameServer<S>, transport: Transport, opts: { state?: S; players?: Player[]; room?: SavedRoom; now?: () => number } = {}) {
    this.server = server;
    this.transport = transport;
    this.now = opts.now ?? Date.now;
    this.maxPlayers = server.maxPlayers ?? ROOM_LIMITS.defaultPlayers;
    for (const p of opts.players ?? []) this.players.set(p.id, p);
    if (opts.room) {
      this.listed = opts.room.listed;
      this.open = opts.room.open;
      for (const id of opts.room.known) this.known.add(id);
    }
    for (const p of this.players.values()) this.remember(p.id);
    this.state = opts.state !== undefined ? opts.state : server.setup();
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
    };
  }

  /** What a sleeping room saves besides the game's state. */
  get saved(): SavedRoom {
    return { listed: this.listed, open: this.open, known: [...this.known] };
  }

  get ticking(): boolean {
    return this.server.tickRate !== undefined;
  }

  /**
   * A player arrives. Joining again with the same ID (a reconnect) keeps their place. The player who
   * makes the room can make it hidden from the start, for a private match.
   */
  join(player: Player, opts: { listed?: boolean } = {}): { ok: true; rejoined: boolean } | { ok: false; code: RoomErrorCode } {
    if (this.ended) return { ok: false, code: "ended" };
    const rejoined = this.players.has(player.id);
    if (!rejoined && !this.open && !this.known.has(player.id)) return { ok: false, code: "closed" };
    if (!rejoined && this.players.size >= this.maxPlayers) return { ok: false, code: "full" };
    if (this.known.size === 0 && opts.listed === false) this.listed = false;
    this.players.set(player.id, player);
    this.remember(player.id);
    this.transport.send(player.id, JSON.stringify({ t: "welcome", me: player, players: this.list(), room: this.settings() } satisfies ServerMessage));
    if (!rejoined) {
      this.listingChanged = true;
      this.run(() => this.server.onJoin?.(this.state, player, this.api));
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
    if (msg && typeof msg === "object" && (msg as { t?: unknown }).t === "room") return this.hostChange(playerId, msg as Partial<RoomSettings>);
    if (!msg || typeof msg !== "object" || (msg as { t?: unknown }).t !== "msg") return "bad-message";
    this.run(() => this.server.onMessage?.(this.state, player, (msg as { d?: unknown }).d, this.api));
    return null;
  }

  /** The first player hides, shows, opens or closes the room, when the game server allows it. */
  private hostChange(playerId: string, msg: Partial<RoomSettings>): RoomErrorCode | null {
    if (!this.server.hostControls || this.players.keys().next().value !== playerId) return "not-allowed";
    const change: Partial<RoomSettings> = {};
    if (typeof msg.listed === "boolean") change.listed = msg.listed;
    if (typeof msg.open === "boolean") change.open = msg.open;
    this.settle(change);
    this.dirty = true;
    return null;
  }

  private settings(): RoomSettings {
    return { listed: this.listed, open: this.open };
  }

  /** Change listed or open, and tell everyone in the room. */
  private settle(change: Partial<RoomSettings>): void {
    const next = { ...this.settings(), ...change };
    if (next.listed === this.listed && next.open === this.open) return;
    this.listed = next.listed;
    this.open = next.open;
    this.listingChanged = true;
    const text = JSON.stringify({ t: "room", room: next } satisfies ServerMessage);
    for (const id of this.players.keys()) this.transport.send(id, text);
  }

  private remember(id: string): void {
    this.known.delete(id);
    this.known.add(id);
    if (this.known.size > REMEMBERED) this.known.delete(this.known.values().next().value!);
  }

  tick(dt: number): void {
    if (this.ended || !this.server.onTick) return;
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
    const text = JSON.stringify({ t: "players", players: this.list() } satisfies ServerMessage);
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
  private run(fn: () => Result<S>): void {
    try {
      const next = fn();
      if (next !== undefined) this.state = next as S;
      this.dirty = true;
    } catch (err) {
      console.error("Game server error:", err);
    }
  }
}
