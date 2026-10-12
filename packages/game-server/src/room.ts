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
}

type Result<S> = void | S;

export interface GameServer<S = any> {
  /** Up to 16. Defaults to 8. */
  maxPlayers?: number;
  /** Ticks per second, up to 30. Leave out for turn-based games so the room can sleep between moves. */
  tickRate?: number;
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

/** Messages from the room to a client. Clients send {t:"hello", pass} first, then {t:"msg", d}. */
export type ServerMessage =
  | { t: "welcome"; me: Player; players: Player[] }
  | { t: "players"; players: Player[] }
  | { t: "msg"; d: unknown }
  | { t: "error"; code: RoomErrorCode; message: string }
  | { t: "ended"; reason: string };

export type RoomErrorCode = "full" | "ended" | "too-big" | "too-fast" | "bad-message" | "bad-pass" | "no-hello" | "game-unavailable" | "busy";

export const ERROR_TEXT: Record<RoomErrorCode, string> = {
  full: "This room is full.",
  ended: "This match has ended.",
  "too-big": "Message too big.",
  "too-fast": "Too many messages. Slow down.",
  "bad-message": "Messages must be JSON.",
  "bad-pass": "Your player pass isn't valid for this game.",
  "no-hello": "Send your player pass first.",
  "game-unavailable": "This game isn't available right now.",
  busy: "Rooms are busy. Try again soon.",
};

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

export class RoomCore<S = any> {
  state: S;
  readonly players = new Map<string, Player>();
  ended = false;
  /** Messages received from clients, for usage counts. */
  messages = 0;
  /** Set when the state changed and a sleeping room should save it. */
  dirty = false;
  private buckets = new Map<string, { tokens: number; at: number }>();
  private readonly now: () => number;
  readonly maxPlayers: number;
  private readonly api: Room;
  readonly server: GameServer<S>;
  private readonly transport: Transport;

  constructor(server: GameServer<S>, transport: Transport, opts: { state?: S; players?: Player[]; now?: () => number } = {}) {
    this.server = server;
    this.transport = transport;
    this.now = opts.now ?? Date.now;
    this.maxPlayers = server.maxPlayers ?? ROOM_LIMITS.defaultPlayers;
    for (const p of opts.players ?? []) this.players.set(p.id, p);
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
    };
  }

  get ticking(): boolean {
    return this.server.tickRate !== undefined;
  }

  /** A player arrives. Joining again with the same ID (a reconnect) keeps their place. */
  join(player: Player): { ok: true; rejoined: boolean } | { ok: false; code: RoomErrorCode } {
    if (this.ended) return { ok: false, code: "ended" };
    const rejoined = this.players.has(player.id);
    if (!rejoined && this.players.size >= this.maxPlayers) return { ok: false, code: "full" };
    this.players.set(player.id, player);
    this.transport.send(player.id, JSON.stringify({ t: "welcome", me: player, players: this.list() } satisfies ServerMessage));
    if (!rejoined) {
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
    if (!msg || typeof msg !== "object" || (msg as { t?: unknown }).t !== "msg") return "bad-message";
    this.run(() => this.server.onMessage?.(this.state, player, (msg as { d?: unknown }).d, this.api));
    return null;
  }

  tick(dt: number): void {
    if (this.ended || !this.server.onTick) return;
    this.run(() => this.server.onTick!(this.state, dt, this.api));
  }

  end(reason: string): void {
    if (this.ended) return;
    this.ended = true;
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
