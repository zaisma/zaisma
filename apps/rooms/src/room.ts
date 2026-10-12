import { DurableObject } from "cloudflare:workers";
import { CLOSE_REFUSED, PassError, RoomCore, errorMessage, verifyPass, type Player, type RoomErrorCode } from "@zaisma/game-server";
import { gameServer } from "./registry.ts";
import { signingKey, type Env } from "./index.ts";

/** A socket's saved details, kept through hibernation. */
type Attachment = { stage: "hello"; at: number } | { stage: "in"; id: string; name: string; joinedAt: number } | { stage: "gone" };

interface Meta {
  gameId: string;
  slug: string;
  server: string;
}

interface Saved {
  state?: unknown;
  ended?: boolean;
  usage?: Usage;
}

interface Usage {
  playerSeconds: number;
  messages: number;
}

/** A player must send their pass this soon after connecting. */
const HELLO_MS = 5000;
/** Extra sockets allowed past maxPlayers, for people still saying hello. */
const SPARE_SOCKETS = 4;
/** How often a running room re-checks that its game is still live, so takedowns close rooms. */
const CHECK_MS = 60_000;
/** An empty room's saved state is deleted after this. */
const KEEP_EMPTY_MS = 24 * 3600 * 1000;

/**
 * One room: one live match running one copy of the game server. Uses the WebSocket
 * Hibernation API, so a turn-based room costs nothing between moves: its state is
 * saved after every message and reloaded when the next one wakes it.
 */
export class Room extends DurableObject<Env> {
  private meta: Meta | null = null;
  private core: RoomCore | null = null;
  private ended = false;
  private usage: Usage = { playerSeconds: 0, messages: 0 };
  private saved: unknown = undefined;
  private lastCheck = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const got = await ctx.storage.get<Meta | Saved>(["meta", "saved"]);
      this.meta = (got.get("meta") as Meta | undefined) ?? null;
      const saved = (got.get("saved") as Saved | undefined) ?? {};
      this.saved = saved.state;
      this.ended = saved.ended ?? false;
      this.usage = saved.usage ?? this.usage;
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (!this.meta) {
      this.meta = { gameId: request.headers.get("x-game-id")!, slug: request.headers.get("x-game-slug")!, server: request.headers.get("x-game-server")! };
      await this.ctx.storage.put("meta", this.meta);
    }
    const server = gameServer(this.meta.server);
    if (!server) return new Response("This game isn't available right now", { status: 404 });

    this.dropStaleHellos();
    const max = (server.maxPlayers ?? 8) + SPARE_SOCKETS;
    const open = this.ctx.getWebSockets().filter((ws) => (ws.deserializeAttachment() as Attachment | null)?.stage !== "gone");
    if (open.length >= max) return new Response("This room is full", { status: 409 });

    const { 0: client, 1: socket } = new WebSocketPair();
    this.ctx.acceptWebSocket(socket);
    socket.serializeAttachment({ stage: "hello", at: Date.now() } satisfies Attachment);
    await this.ctx.storage.deleteAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment;
    if (typeof data !== "string") return this.refuse(ws, "bad-message");
    if (att.stage === "hello") return this.hello(ws, data);
    if (att.stage !== "in") return;

    const core = this.room();
    if (!core) return;
    if (Date.now() - this.lastCheck > CHECK_MS && !(await this.gameStillLive())) return;
    const err = core.receive(att.id, data);
    if (err) ws.send(errorMessage(err));
    await this.save();
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    await this.left(ws);
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, "Bye");
    } catch {
      // Already closed.
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.left(ws);
  }

  /** An empty room's leftovers are cleared a day after the last player left. */
  async alarm(): Promise<void> {
    if (this.ctx.getWebSockets().length === 0) await this.ctx.storage.deleteAll();
  }

  private async hello(ws: WebSocket, text: string): Promise<void> {
    let pass: unknown;
    try {
      const msg = JSON.parse(text) as { t?: unknown; pass?: unknown };
      if (msg.t !== "hello") return this.refuse(ws, "no-hello");
      pass = msg.pass;
    } catch {
      return this.refuse(ws, "no-hello");
    }
    if (typeof pass !== "string" || !this.meta) return this.refuse(ws, "bad-pass");

    let player: Player;
    try {
      const claims = await verifyPass(pass, [(await signingKey(this.env)).publicKey], { game: this.meta.slug, issuer: this.env.ISSUER });
      player = { id: claims.sub, name: claims.name };
    } catch (err) {
      if (!(err instanceof PassError)) throw err;
      return this.refuse(ws, "bad-pass");
    }
    if (this.ended) return this.refuse(ws, "ended");
    if (!(await this.gameStillLive())) return this.refuse(ws, "game-unavailable");
    const core = this.room();
    if (!core) return this.refuse(ws, "game-unavailable");

    // The same player connecting again (a reconnect or a second tab) replaces the old connection.
    for (const other of this.sockets(player.id)) {
      this.retire(other);
      other.close(CLOSE_REFUSED, "Joined from somewhere else");
    }
    ws.serializeAttachment({ stage: "in", id: player.id, name: player.name, joinedAt: Date.now() } satisfies Attachment);
    const result = core.join(player);
    if (!result.ok) return this.refuse(ws, result.code);
    this.startTicking(core);
    await this.save();
  }

  private async left(ws: WebSocket): Promise<void> {
    const att = this.retire(ws);
    if (att.stage !== "in") return;
    if (this.sockets(att.id).length === 0) this.room()?.leave(att.id);
    if (this.sockets().length === 0) await this.emptied();
    else await this.save();
  }

  /** Mark a socket as gone, counting the time its player spent in the room. */
  private retire(ws: WebSocket): Attachment {
    const att = ws.deserializeAttachment() as Attachment;
    if (att.stage === "in") this.usage.playerSeconds += Math.round((Date.now() - att.joinedAt) / 1000);
    ws.serializeAttachment({ stage: "gone" } satisfies Attachment);
    return att;
  }

  /** Everyone has gone: stop ticking, record usage, and clean up after a day. */
  private async emptied(): Promise<void> {
    this.stopTicking();
    await this.recordUsage();
    if (this.core && !this.core.ticking) this.core.dirty = true;
    await this.save();
    await this.ctx.storage.setAlarm(Date.now() + KEEP_EMPTY_MS);
  }

  /** The match is over for good: nobody else can join this room. */
  private async finish(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    this.stopTicking();
    await this.recordUsage();
    await this.ctx.storage.put("saved", { ended: true } satisfies Saved);
    await this.ctx.storage.setAlarm(Date.now() + KEEP_EMPTY_MS);
  }

  private stopTicking(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Add this room's player time and message count to the game's daily usage. Nothing about players. */
  private async recordUsage(): Promise<void> {
    if (this.core) {
      this.usage.messages += this.core.messages;
      this.core.messages = 0;
    }
    if (this.meta && (this.usage.playerSeconds || this.usage.messages)) {
      const day = new Date().toISOString().slice(0, 10);
      await this.env.DB.prepare(
        "INSERT INTO room_usage (game_id, day, rooms, player_seconds, messages) VALUES (?, ?, 1, ?, ?) ON CONFLICT(game_id, day) DO UPDATE SET rooms = rooms + 1, player_seconds = player_seconds + excluded.player_seconds, messages = messages + excluded.messages",
      )
        .bind(this.meta.gameId, day, this.usage.playerSeconds, this.usage.messages)
        .run();
      this.usage = { playerSeconds: 0, messages: 0 };
    }
  }

  /** The room's game server, built on first use or after waking from hibernation. */
  private room(): RoomCore | null {
    if (this.core) return this.core;
    const server = this.meta && gameServer(this.meta.server);
    if (!server) return null;
    const players = this.sockets().map((ws) => {
      const att = ws.deserializeAttachment() as Attachment & { stage: "in" };
      return { id: att.id, name: att.name };
    });
    const transport = {
      send: (id: string, text: string) => this.sockets(id).forEach((ws) => ws.send(text)),
      close: (id: string, code: number, reason: string) =>
        this.sockets(id).forEach((ws) => {
          this.retire(ws);
          ws.close(code, reason);
        }),
    };
    // Turn-based rooms wake with their saved state. A ticking room's state isn't saved,
    // so if one is ever evicted mid-match, it starts fresh and everyone joins again.
    if (!server.tickRate && this.saved !== undefined) {
      this.core = new RoomCore(server, transport, { state: this.saved, players });
    } else {
      this.core = new RoomCore(server, transport);
      for (const p of players) this.core.join(p);
    }
    this.core.dirty = false;
    return this.core;
  }

  private startTicking(core: RoomCore): void {
    if (!core.ticking || this.timer) return;
    let last = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      core.tick((now - last) / 1000);
      last = now;
      if (core.ended) void this.finish();
      else if (now - this.lastCheck > CHECK_MS) void this.gameStillLive();
    }, 1000 / core.server.tickRate!);
  }

  /** A takedown or a changed game server ends the match. */
  private async gameStillLive(): Promise<boolean> {
    this.lastCheck = Date.now();
    const row = await this.env.DB.prepare("SELECT status, current_version_id, game_server FROM games WHERE id = ?")
      .bind(this.meta!.gameId)
      .first<{ status: string; current_version_id: string | null; game_server: string | null }>();
    if (row && row.status === "live" && row.current_version_id && row.game_server === this.meta!.server) return true;
    this.room()?.end("This game isn't available right now.");
    for (const ws of this.ctx.getWebSockets()) {
      this.retire(ws);
      ws.close(CLOSE_REFUSED, "Game unavailable");
    }
    await this.finish();
    return false;
  }

  /** Save a turn-based room's state after each change, so it can sleep between moves. */
  private async save(): Promise<void> {
    const core = this.core;
    if (core?.ended) await this.finish();
    if (!core || this.ended || core.ticking || !core.dirty) return;
    this.usage.messages += core.messages;
    core.messages = 0;
    core.dirty = false;
    this.saved = core.state;
    await this.ctx.storage.put("saved", { state: core.state, usage: this.usage } satisfies Saved);
  }

  private refuse(ws: WebSocket, code: RoomErrorCode): void {
    ws.serializeAttachment({ stage: "gone" } satisfies Attachment);
    try {
      ws.send(errorMessage(code));
      ws.close(CLOSE_REFUSED, code);
    } catch {
      // Already closed.
    }
  }

  /** Open sockets of players in the room, optionally just one player's. */
  private sockets(playerId?: string): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => {
      const att = ws.deserializeAttachment() as Attachment | null;
      return att?.stage === "in" && (playerId === undefined || att.id === playerId);
    });
  }

  private dropStaleHellos(): void {
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att?.stage === "hello" && now - att.at > HELLO_MS) this.refuse(ws, "no-hello");
      // Sockets already refused but not yet gone don't hold a place.
    }
  }
}
