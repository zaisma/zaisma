import { DurableObject } from "cloudflare:workers";
import {
  CLOSE_NO_ANSWER,
  CLOSE_REFUSED,
  ERROR_TEXT,
  GameServerError,
  PassError,
  ROOM_LIMITS,
  RoomCore,
  clientIdleTimeoutSec,
  errorMessage,
  roomData,
  roomNaming,
  verifyPass,
  type GameServer,
  type JoinOptions,
  type MoveAsk,
  type Player,
  type RoomErrorCode,
  type RoomNaming,
  type RoomStart,
  type SavedRoom,
  type ServerMessage,
} from "@zaisma/game-server";
import { gameServerOf, pastFreeTier, type MultiplayerMode } from "@zaisma/core";
import { gameServer } from "./registry.ts";
import { SANDBOX, sandboxServer, type SandboxStats } from "./sandbox.ts";
import { signingKey, type Env } from "./index.ts";

/** A socket's saved details, kept through hibernation. */
type Attachment =
  | { stage: "hello"; at: number; tester?: string }
  // tester: the tester link the player came through, which they can only play through while it's on.
  // seen: about when the player last sent a message (pings are answered without waking the room).
  // idleTimeoutSec: the idle check the player's game asked for (null for none), for game servers that leave it to the client.
  | { stage: "in"; id: string; name: string; joinedAt: number; tester?: string; seen?: number; idleTimeoutSec?: number | null }
  | { stage: "gone" };

interface Meta {
  gameId: string;
  slug: string;
  server: string;
  /** The game version a room started on: a sandboxed game server keeps running it until the room ends. */
  version?: string;
  /** Rooms made before room browsing don't know their code, and aren't listed. */
  code?: string;
  /** The country and continent the room's first player connected from, which is roughly where the room runs. */
  country?: string | null;
  continent?: string | null;
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
/** Extra sockets allowed past maximumPlayerCount, for people still saying hello. */
const SPARE_SOCKETS = 4;
/** How often a running room re-checks that its game is still live, so takedowns close rooms. */
const CHECK_MS = 60_000;
/** How often a room with players who came through tester links checks those links are still on. */
const TESTER_CHECK_MS = 10_000;
/** An empty room's saved state is deleted after this. */
const KEEP_EMPTY_MS = 24 * 3600 * 1000;
/** How often a room with players checks in, so rooms that stop without saying so drop off. */
const CHECK_IN_MS = 3600 * 1000;
/**
 * How often a room with players wakes to check on them (idle, hidden, held seats, dead connections).
 * A wake is a request and a few milliseconds; pings in between are answered without waking it.
 */
const SWEEP_MS = 30_000;
/**
 * A connection with no ping or message for this long is dropped: a closed laptop, lost signal. Games
 * ping every 25 seconds, and browsers slow a hidden page's timers to once a minute.
 */
const DEAD_MS = 75_000;
/** A socket's seen time is written at most this often, so busy rooms don't rewrite it on every message. */
const SEEN_MS = 15_000;


/**
 * One room: one live match running one copy of the game server. Uses the WebSocket
 * Hibernation API, so a turn-based room costs nothing between moves: its state is
 * saved after every message and reloaded when the next one wakes it.
 */
export class Room extends DurableObject<Env> {
  private meta: Meta | null = null;
  private core: RoomCore | null = null;
  /** The game server, loaded on first use since waking (a sandboxed one opens its session then). */
  private server: GameServer | null = null;
  /** Set when the game server kept failing and the room ended for it. */
  private wasBroken = false;
  private ended = false;
  private usage: Usage = { playerSeconds: 0, messages: 0 };
  private saved: unknown = undefined;
  private savedRoom: SavedRoom | undefined = undefined;
  private lastCheck = 0;
  private lastTesterCheck = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** The game's room browsing setting, read with its status; null until read since waking. */
  private browsing: string | null = null;
  /** What this room last wrote to live_rooms ("" for no row), so unchanged rooms don't write again. */
  private listedAs: string | undefined = undefined;
  /** Rooms this room is still setting up for its players (room.reserve), so it doesn't sleep before they're told. */
  private moving: Promise<void>[] = [];
  /** When the room's alarm is set for, so wakes that are already covered don't write it again. */
  private alarmAt: number | null = null;
  /** When the room last checked in (its row and usage), which it does hourly. */
  private checkedIn = 0;
  /** The room's row didn't take its last write, so the next check writes it again. */
  private rowStale = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Games ping every 25 seconds or so; the answer doesn't wake the room, and the time is kept per socket.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.blockConcurrencyWhile(async () => {
      const got = await ctx.storage.get<Meta | Saved | SavedRoom | number>(["meta", "saved", "room", "checkedIn"]);
      this.meta = (got.get("meta") as Meta | undefined) ?? null;
      const saved = (got.get("saved") as Saved | undefined) ?? {};
      this.saved = saved.state;
      this.savedRoom = got.get("room") as SavedRoom | undefined;
      this.ended = saved.ended ?? false;
      this.usage = saved.usage ?? this.usage;
      this.checkedIn = (got.get("checkedIn") as number | undefined) ?? 0;
      this.alarmAt = await ctx.storage.getAlarm();
    });
  }

  async fetch(request: Request): Promise<Response> {
    // Another room of the same game reserving this one (only rooms can reach this; players' requests are WebSockets).
    if (request.method === "POST" && new URL(request.url).pathname === "/reserve") return this.reserved(request);
    if (request.method === "POST" && new URL(request.url).pathname === "/expect") return this.expecting(request);
    if (!this.meta || !this.meta.code) {
      this.meta = {
        gameId: request.headers.get("x-game-id")!,
        slug: request.headers.get("x-game-slug")!,
        server: request.headers.get("x-game-server")!,
        version: request.headers.get("x-game-version") ?? undefined,
        ...this.meta,
        code: request.headers.get("x-room-code") ?? undefined,
        country: this.meta?.country ?? (request.headers.get("x-room-country") || null),
        continent: this.meta?.continent ?? (request.headers.get("x-room-continent") || null),
      };
      await this.ctx.storage.put("meta", this.meta);
    }
    const server = await this.load();
    if (!server) return new Response("This game isn't available right now", { status: 404 });

    this.dropStaleHellos();
    const max = (server.maximumPlayerCount ?? ROOM_LIMITS.defaultMaximumPlayerCount) + SPARE_SOCKETS;
    const open = this.ctx.getWebSockets().filter((ws) => (ws.deserializeAttachment() as Attachment | null)?.stage !== "gone");
    if (open.length >= max) return new Response("This room is full", { status: 409 });

    const { 0: client, 1: socket } = new WebSocketPair();
    this.ctx.acceptWebSocket(socket);
    const tester = request.headers.get("x-tester-link") || undefined;
    socket.serializeAttachment({ stage: "hello", at: Date.now(), ...(tester ? { tester } : {}) } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment;
    if (typeof data !== "string") return this.refuse(ws, "bad_message");
    if (att.stage === "hello") return this.hello(ws, data);
    if (att.stage !== "in") return;

    // Pings never get here; any other message shows the player is still connected.
    const now = Date.now();
    if (now - (att.seen ?? att.joinedAt) > SEEN_MS) ws.serializeAttachment({ ...att, seen: now } satisfies Attachment);

    await this.load();
    const core = this.room();
    if (!core) return;
    if (Date.now() - this.lastCheck > CHECK_MS && !(await this.gameStillLive())) return;
    if (Date.now() - this.lastTesterCheck > TESTER_CHECK_MS) await this.testerLinksStillOn();
    if ((ws.deserializeAttachment() as Attachment).stage !== "in") return;
    const err = core.receive(att.id, data);
    if (err) ws.send(errorMessage(err));
    await this.settle(core);
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    // Closed on purpose (1000, or 1001 as a page goes away), or the connection was lost.
    await this.left(ws, code === 1000 || code === 1001 ? "left" : "connection_lost");
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, "Bye");
    } catch {
      // Already closed.
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.left(ws, "connection_lost");
  }

  /**
   * A room with players wakes every half a minute to check on them, and checks in every hour. An
   * empty room's leftovers are cleared a day after the last player left, including a room that
   * stopped without hearing its players go (a restart).
   */
  async alarm(): Promise<void> {
    this.alarmAt = null;
    if (this.sockets().length) {
      // The next check first, so one that fails (a busy database) doesn't stop the room checking on its players.
      await this.wake(Date.now() + SWEEP_MS);
      await this.load();
      const core = this.room();
      for (const ws of this.unanswered()) {
        await this.left(ws, "connection_lost");
        try {
          ws.close(CLOSE_NO_ANSWER, "No answer");
        } catch {
          // Already closed.
        }
      }
      if (core && !this.ended) {
        core.sweep();
        await this.settle(core);
        if (this.rowStale) await this.list();
      }
      if (this.sockets().length && Date.now() - this.checkedIn >= CHECK_IN_MS) {
        if (await this.gameStillLive()) await this.list(true);
        // A long match's game server health shouldn't wait for the room to empty.
        await this.recordUsage(false);
        // Also when the room has no row to touch (everyone walked away).
        this.checkedIn = Date.now();
        await this.ctx.storage.put("checkedIn", this.checkedIn);
      }
      return;
    }
    await this.unlist();
    const since = await this.ctx.storage.get<number>("emptySince");
    if (since === undefined) {
      await this.ctx.storage.put("emptySince", Date.now());
      await this.setAlarm(Date.now() + KEEP_EMPTY_MS);
    } else if (Date.now() - since >= KEEP_EMPTY_MS) {
      await this.ctx.storage.deleteAll();
    } else {
      await this.setAlarm(since + KEEP_EMPTY_MS);
    }
  }

  /** After the game server ran: finish what it started, keep ticking only while someone's playing, save and bring the room's row up to date. */
  private async settle(core: RoomCore): Promise<void> {
    await core.settled();
    await this.moved();
    await core.settled();
    if (!this.ended && !core.ended) this.pace(core);
    await this.save();
    if (core.listingChanged) await this.list();
  }

  /** Sockets of players the room hasn't heard from, not even a ping, for too long. */
  private unanswered(now = Date.now()): WebSocket[] {
    return this.sockets().filter((ws) => {
      const att = ws.deserializeAttachment() as Attachment & { stage: "in" };
      const pinged = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
      return now - Math.max(pinged, att.seen ?? 0, att.joinedAt) > DEAD_MS;
    });
  }

  /** Make sure the room wakes by then: writes the alarm only if it isn't already due sooner. */
  private async wake(at: number): Promise<void> {
    if (this.alarmAt !== null && this.alarmAt <= at && this.alarmAt > Date.now()) return;
    await this.setAlarm(at);
  }

  private async setAlarm(at: number): Promise<void> {
    this.alarmAt = at;
    await this.ctx.storage.setAlarm(at);
  }

  /**
   * Set this room up for the players another room reserved it for: closed to everyone else, hidden
   * unless the game listed it, and starting with the game's data. A room that's already in use says no.
   */
  private async reserved(request: Request): Promise<Response> {
    if (this.meta || this.savedRoom) return new Response("This room is taken", { status: 409 });
    const gameId = request.headers.get("x-game-id")!;
    if (await pastFreeTier(this.env.DB, gameId)) return new Response(ERROR_TEXT.month_limit, { status: 403 });
    const start = (await request.json()) as RoomStart;
    this.meta = {
      gameId,
      slug: request.headers.get("x-game-slug")!,
      server: request.headers.get("x-game-server")!,
      version: request.headers.get("x-game-version") ?? undefined,
      code: request.headers.get("x-room-code")!,
      country: request.headers.get("x-room-country") || null,
      continent: request.headers.get("x-room-continent") || null,
    };
    this.savedRoom = {
      isListed: start.isListed,
      isOpen: false,
      name: start.name,
      labels: start.labels,
      known: start.players,
      data: start.data,
      ...(start.keptOut ? { keptOut: start.keptOut } : {}),
      ...(typeof start.lobby === "string" && start.lobby ? { lobby: start.lobby } : {}),
    };
    // Like an empty room: cleared after a day if nobody comes.
    await this.ctx.storage.put({ meta: this.meta, room: this.savedRoom, emptySince: Date.now() });
    await this.setAlarm(Date.now() + KEEP_EMPTY_MS);
    return new Response(null, { status: 204 });
  }

  /**
   * Another room of the same game sends players here (room.moveTo): the game server decides who it
   * takes, and holds a seat for each for a minute. A room that isn't running takes nobody.
   */
  private async expecting(request: Request): Promise<Response> {
    if (!this.meta?.code || this.ended || this.meta.gameId !== request.headers.get("x-game-id")) return new Response("No such room", { status: 404 });
    const ask = (await request.json()) as MoveAsk;
    const players = Array.isArray(ask?.players) ? ask.players.filter((p) => typeof p?.id === "string" && typeof p?.name === "string").slice(0, 16) : [];
    if (typeof ask?.from !== "string" || !players.length) return new Response("Bad request", { status: 400 });
    if (!(await this.load()) || !(await this.gameStillLive())) return new Response("No such room", { status: 404 });
    const core = this.room();
    if (!core) return new Response("No such room", { status: 404 });
    const answer = await core.expect({ from: ask.from, players: players.map((p) => ({ id: p.id, name: p.name })), data: ask.data });
    await core.settled();
    this.savedRoom = core.saved;
    await this.ctx.storage.put("room", this.savedRoom);
    await this.save();
    return Response.json(answer);
  }

  private async hello(ws: WebSocket, text: string): Promise<void> {
    const tester = (ws.deserializeAttachment() as Attachment & { stage: "hello" }).tester;
    let pass: unknown;
    let made: JoinOptions = {};
    try {
      const hello = JSON.parse(text) as { type?: unknown; pass?: unknown; joinData?: unknown; idleCheck?: unknown; idleTimeoutSec?: unknown; newRoom?: { isListed?: unknown; name?: unknown; labels?: unknown } };
      if (hello.type !== "hello") return this.refuse(ws, "no_hello");
      pass = hello.pass;
      // The idle check the player's game asked for, for game servers that leave it to the client.
      const idleTimeoutSec = clientIdleTimeoutSec(hello.idleCheck, hello.idleTimeoutSec);
      if (idleTimeoutSec !== undefined) made.idleTimeoutSec = idleTimeoutSec;
      // How the player who makes the room sets it up; the room takes it only from them.
      const newRoom = hello.newRoom && typeof hello.newRoom === "object" ? hello.newRoom : {};
      made = { ...made, ...(newRoom.isListed === false ? { isListed: false } : {}), ...roomNaming(newRoom as RoomNaming) };
      // What the player brings for the game server's onJoin, like the character they picked.
      const joinData = roomData(hello.joinData);
      if (!joinData.ok) return this.refuse(ws, "too_big");
      made.joinData = joinData.data;
    } catch {
      return this.refuse(ws, "no_hello");
    }
    if (typeof pass !== "string" || !this.meta) return this.refuse(ws, "bad_pass");

    let player: Player;
    try {
      const claims = await verifyPass(pass, [(await signingKey(this.env)).publicKey], { gameSlug: this.meta.slug, issuer: this.env.ISSUER });
      player = { id: claims.sub, name: claims.name };
    } catch (err) {
      if (!(err instanceof PassError)) throw err;
      return this.refuse(ws, "bad_pass");
    }
    if (this.ended) return this.refuse(ws, "ended");
    if (!(await this.gameStillLive())) return this.refuse(ws, "game_unavailable");
    await this.load();
    const core = this.room();
    if (!core) return this.refuse(ws, "game_unavailable");
    // Past this month's free tier, a room with nobody in it opens only for players it's holding a place for.
    if (core.players.size === 0 && !core.expects(player.id) && (await pastFreeTier(this.env.DB, this.meta.gameId))) return this.refuse(ws, "month_limit");
    // The room's rules and the game's canJoin, before anyone hears about this player.
    const admitted = await core.admit(player, made.joinData);
    if (!admitted.ok) return this.refuse(ws, admitted.code, admitted.message);
    if ((ws.deserializeAttachment() as Attachment).stage !== "hello") return;

    // The same player connecting again (a reconnect or a second tab) replaces the old connection.
    for (const other of this.sockets(player.id)) {
      this.retire(other);
      other.close(CLOSE_REFUSED, "Joined from somewhere else");
    }
    const now = Date.now();
    ws.serializeAttachment({ stage: "in", id: player.id, name: player.name, joinedAt: now, seen: now, ...(tester ? { tester } : {}), ...(made.idleTimeoutSec !== undefined ? { idleTimeoutSec: made.idleTimeoutSec } : {}) } satisfies Attachment);
    const result = core.join(player, made);
    if (!result.ok) return this.refuse(ws, result.code, result.message);
    await core.settled();
    if (core.players.size === 1) await this.ctx.storage.delete("emptySince");
    await this.settle(core);
    await this.wake(Date.now() + SWEEP_MS);
  }

  /** A player's connection closed: they left, or it was lost (the room then holds their seat a while). */
  private async left(ws: WebSocket, why: "left" | "connection_lost"): Promise<void> {
    const att = this.retire(ws);
    if (att.stage !== "in") return;
    const core = this.sockets(att.id).length === 0 && (await this.load()) ? this.room() : null;
    core?.leave(att.id, why);
    if (this.sockets().length === 0) {
      await core?.settled();
      await this.emptied();
    } else if (core) await this.settle(core);
  }

  /** Mark a socket as gone, counting the time its player spent in the room. */
  private retire(ws: WebSocket): Attachment {
    const att = ws.deserializeAttachment() as Attachment;
    if (att.stage === "in") this.usage.playerSeconds += Math.round((Date.now() - att.joinedAt) / 1000);
    ws.serializeAttachment({ stage: "gone" } satisfies Attachment);
    return att;
  }

  /** Everyone has gone: stop ticking, record usage, drop the room's row, and clean up after a day. */
  private async emptied(): Promise<void> {
    this.stopTicking();
    await this.recordUsage();
    if (this.core && !this.core.ticking) this.core.dirty = true;
    await this.save();
    await this.unlist();
    await this.ctx.storage.put("emptySince", Date.now());
    await this.setAlarm(Date.now() + KEEP_EMPTY_MS);
  }

  /** The match is over for good: nobody else can join this room. */
  private async finish(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    this.stopTicking();
    await this.recordUsage();
    await this.unlist();
    await this.ctx.storage.put({ saved: { ended: true } satisfies Saved, emptySince: Date.now() });
    await this.setAlarm(Date.now() + KEEP_EMPTY_MS);
  }

  /**
   * Bring this room's row in live_rooms up to date: every room with players in it has one, for
   * "playing now" on the game page, with the player count, the most players, the seats it holds,
   * whether new players can join and whether it may be listed. Players who walked away don't count.
   * Writes only when something changed, or to check in (touch).
   */
  private async list(touch = false): Promise<void> {
    const core = this.core;
    const meta = this.meta;
    if (!core || !meta?.code) return;
    if (this.browsing === null && !(await this.gameStillLive())) return;
    core.listingChanged = false;
    // What the room keeps for itself, so a hidden or closed room stays that way after a restart.
    this.savedRoom = core.saved;
    await this.ctx.storage.put("room", this.savedRoom);
    const live = !this.ended && !core.ended && core.playing > 0;
    const listed = core.isListed && this.browsing !== "off" ? 1 : 0;
    const labels = JSON.stringify(core.labels);
    const as = live ? JSON.stringify([core.playing, core.heldSeats, core.maximumPlayerCount, core.isOpen, listed, core.name, labels]) : "";
    if (as === this.listedAs && !touch) return;
    if (!live) return this.unlist();
    const now = Date.now();
    await this.rowWrite(as, () =>
      this.env.DB.prepare(
        // A name a person hid stays hidden while the room lives (name_hidden is never overwritten here).
        "INSERT INTO live_rooms (game_id, code, players, held, max_players, listed, open, name, labels, country, continent, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(game_id, code) DO UPDATE SET players = excluded.players, held = excluded.held, max_players = excluded.max_players, listed = excluded.listed, open = excluded.open, name = excluded.name, labels = excluded.labels, updated_at = excluded.updated_at",
      )
        .bind(meta.gameId, meta.code, core.playing, core.heldSeats, core.maximumPlayerCount, listed, core.isOpen ? 1 : 0, core.name, labels, meta.country ?? null, meta.continent ?? null, now, now)
        .run(),
    );
    // Checked in: the next check-in is due an hour from now.
    this.checkedIn = now;
    await this.ctx.storage.put("checkedIn", now);
  }

  private async unlist(): Promise<void> {
    if (this.listedAs === "" || !this.meta?.code) return;
    await this.rowWrite("", () => this.env.DB.prepare("DELETE FROM live_rooms WHERE game_id = ? AND code = ?").bind(this.meta!.gameId, this.meta!.code!).run());
  }

  /**
   * Write the room's row, remembering what it now says. If the write fails (a busy database), the
   * room tries again at its next check, so its row never stays wrong until something else changes.
   */
  private async rowWrite(as: string, write: () => Promise<unknown>): Promise<void> {
    const was = this.listedAs;
    this.listedAs = as;
    try {
      await write();
      this.rowStale = false;
    } catch (err) {
      if (this.listedAs === as) this.listedAs = was;
      this.rowStale = true;
      throw err;
    }
  }

  private stopTicking(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Add this room's player time and message count to the game's daily usage. Nothing about players. */
  /**
   * Add this room's player time, message count and game server health to the game's daily usage.
   * Nothing about players. Called when the room empties or ends (ended), and hourly while it runs.
   */
  private async recordUsage(ended = true): Promise<void> {
    if (this.core) {
      this.usage.messages += this.core.messages;
      this.core.messages = 0;
    }
    const stats = (this.server as { stats?: SandboxStats } | null)?.stats;
    const health = { calls: stats?.calls ?? 0, crashes: stats?.crashes ?? 0, stops: stats?.stops ?? 0, broken: ended && this.wasBroken ? 1 : 0 };
    const errors = stats ? [...stats.errors.values()] : [];
    if (stats) {
      stats.calls = stats.ms = stats.crashes = stats.stops = 0;
      stats.errors.clear();
    }
    if (!this.meta || !(this.usage.playerSeconds || this.usage.messages || health.calls || health.crashes || health.stops || health.broken)) return;
    const day = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    await this.env.DB.batch([
      this.env.DB.prepare(
        "INSERT INTO room_usage (game_id, day, rooms, player_seconds, messages, server_calls, server_crashes, server_stops, server_broken_rooms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(game_id, day) DO UPDATE SET rooms = rooms + excluded.rooms, player_seconds = player_seconds + excluded.player_seconds, messages = messages + excluded.messages, server_calls = server_calls + excluded.server_calls, server_crashes = server_crashes + excluded.server_crashes, server_stops = server_stops + excluded.server_stops, server_broken_rooms = server_broken_rooms + excluded.server_broken_rooms",
      ).bind(this.meta.gameId, day, ended ? 1 : 0, this.usage.playerSeconds, this.usage.messages, health.calls, health.crashes, health.stops, health.broken),
      ...errors.map((e) =>
        this.env.DB.prepare(
          "INSERT INTO game_server_errors (game_id, version_id, kind, message, count, first_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(game_id, version_id, kind, message) DO UPDATE SET count = count + excluded.count, last_at = excluded.last_at",
        ).bind(this.meta!.gameId, this.meta!.version ?? "", e.kind, e.message, e.count, e.first, now),
      ),
    ]);
    this.usage = { playerSeconds: 0, messages: 0 };
  }

  /**
   * The game reserved a room (room.reserve): set it up, then tell its players where to go. Players
   * learn the code only once the room is waiting for them, so nobody else can get there first.
   */
  private reserve(code: string, start: RoomStart): void {
    const meta = this.meta!;
    const work = (async () => {
      const headers = { "x-game-id": meta.gameId, "x-game-slug": meta.slug, "x-game-server": meta.server, "x-game-version": meta.version ?? "", "x-room-code": code, "x-room-country": meta.country ?? "", "x-room-continent": meta.continent ?? "" };
      // The new room knows where it came from, for game servers that send players who walk away back to their lobby.
      const body = JSON.stringify({ ...start, ...(meta.code ? { lobby: meta.code } : {}) } satisfies RoomStart);
      const res = await this.env.ROOMS.get(this.env.ROOMS.idFromName(`${meta.slug}:${code}`)).fetch("https://room/reserve", { method: "POST", headers, body });
      if (!res.ok) throw new Error(`room ${code} said ${res.status}`);
      const text = JSON.stringify({ type: "move", roomCode: code } satisfies ServerMessage);
      for (const id of start.players) this.sockets(id).forEach((ws) => ws.send(text));
    })().catch((err) => console.error("Couldn't reserve a room:", err));
    this.moving.push(work);
  }

  /**
   * The game sends players to another of its rooms (room.moveTo): ask that room, tell the players it
   * takes where to go, and give the game server the answer (onMoved).
   */
  private moveTo(code: string, ask: Omit<MoveAsk, "from">): void {
    const meta = this.meta!;
    const nobody = (c: "no_room" | "busy") => ({ moved: [] as string[], refused: ask.players.map((p) => ({ id: p.id, code: c, reason: ERROR_TEXT[c] })) });
    const work = (async () => {
      let answer: { moved: string[]; refused: { id: string; code: RoomErrorCode; reason: string }[] };
      if (code === meta.code || !meta.code) answer = nobody("no_room");
      else {
        try {
          const res = await this.env.ROOMS.get(this.env.ROOMS.idFromName(`${meta.slug}:${code}`)).fetch("https://room/expect", {
            method: "POST",
            headers: { "x-game-id": meta.gameId },
            body: JSON.stringify({ ...ask, from: meta.code } satisfies MoveAsk),
          });
          answer = res.ok ? await res.json() : nobody("no_room");
        } catch (err) {
          console.error("Couldn't move players:", err);
          answer = nobody("busy");
        }
      }
      const text = JSON.stringify({ type: "move", roomCode: code } satisfies ServerMessage);
      for (const id of answer.moved) this.sockets(id).forEach((ws) => ws.send(text));
      this.core?.moved(code, answer, ask.players);
    })().catch((err) => console.error("Couldn't move players:", err));
    this.moving.push(work);
  }

  /** Wait for reserved rooms still being set up, and moves still being asked. */
  private async moved(): Promise<void> {
    while (this.moving.length) await Promise.all(this.moving.splice(0));
  }

  /** The room's game server, built on first use or after waking from hibernation. */
  private room(): RoomCore | null {
    if (this.core) return this.core;
    const server = this.server;
    if (!server) return null;
    // Players whose seat is held are still connected, but out of the match.
    const held = this.savedRoom?.held ?? {};
    const presence: Record<string, { seen?: number; idleTimeoutSec?: number | null }> = {};
    const players = this.sockets().flatMap((ws) => {
      const att = ws.deserializeAttachment() as Attachment & { stage: "in" };
      if (Object.hasOwn(held, att.id)) return [];
      presence[att.id] = { seen: att.seen ?? att.joinedAt, idleTimeoutSec: att.idleTimeoutSec };
      return [{ id: att.id, name: att.name }];
    });
    const transport = {
      send: (id: string, text: string) => this.sockets(id).forEach((ws) => ws.send(text)),
      close: (id: string, code: number, reason: string) => {
        this.sockets(id).forEach((ws) => {
          this.retire(ws);
          ws.close(code, reason);
        });
        // The game kicked the last player: the room empties like when everyone leaves.
        if (!this.core?.ended && this.sockets().length === 0) void this.emptied();
      },
      reserve: (code: string, start: RoomStart) => this.reserve(code, start),
      moveTo: (code: string, ask: Omit<MoveAsk, "from">) => this.moveTo(code, ask),
    };
    // Turn-based rooms wake with their saved state. A ticking room's state isn't saved,
    // so if one is ever evicted mid-match, it starts fresh and everyone joins again.
    // Either way, the room stays as listed or hidden, and as open or closed, as it was.
    if (!server.ticksPerSec && this.saved !== undefined) {
      this.core = new RoomCore(server, transport, { state: this.saved, players, room: this.savedRoom, presence });
    } else {
      this.core = new RoomCore(server, transport, { room: this.savedRoom });
      for (const p of players) this.core.join(p, { idleTimeoutSec: presence[p.id]?.idleTimeoutSec });
    }
    this.core.dirty = false;
    return this.core;
  }

  /**
   * Load the game server: a built-in one, or the game's own in its sandbox. A sandbox that can't
   * open (no game server file, or it fails to start) leaves the room unavailable, like a takedown.
   */
  private async load(): Promise<GameServer | null> {
    if (this.server || !this.meta) return this.server;
    if (this.meta.server !== SANDBOX) return (this.server = gameServer(this.meta.server));
    if (!this.meta.version) return null;
    try {
      this.server = await sandboxServer(this.env, this.meta.gameId, this.meta.version, () => this.broken());
    } catch (error) {
      console.error("Couldn't start the game server:", error);
      // Options Zaisma doesn't take (an unknown name, a value out of range): the developer sees why with the game's server errors.
      if (error instanceof GameServerError) await this.recordStartError(error.message);
    }
    return this.server;
  }

  /** A game server that couldn't start, recorded like a crash so its developer sees the reason in their stats and the MCP. */
  private async recordStartError(message: string): Promise<void> {
    const nowMs = Date.now();
    await this.env.DB.prepare(
      "INSERT INTO game_server_errors (game_id, version_id, kind, message, count, first_at, last_at) VALUES (?, ?, 'crash', ?, 1, ?, ?) ON CONFLICT(game_id, version_id, kind, message) DO UPDATE SET count = count + 1, last_at = excluded.last_at",
    )
      .bind(this.meta!.gameId, this.meta!.version ?? "", message.slice(0, 500), nowMs, nowMs)
      .run()
      .catch((error) => console.error("Couldn't record the game server's error:", error));
  }

  /** A real-time room ticks while someone's playing; a room where everyone walked away stops until someone's back. */
  private pace(core: RoomCore): void {
    if (core.playing > 0) this.startTicking(core);
    else this.stopTicking();
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
      else if (now - this.lastTesterCheck > TESTER_CHECK_MS) void this.testerLinksStillOn();
      else if (core.listingChanged) void this.list();
    }, 1000 / core.server.ticksPerSec!);
  }

  /** A takedown or a changed game server ends the match. Also picks up the game's room browsing setting. */
  private async gameStillLive(): Promise<boolean> {
    this.lastCheck = Date.now();
    const row = await this.env.DB.prepare("SELECT review_status, live_version_id, multiplayer_mode, built_in_server, room_browsing FROM games WHERE id = ?")
      .bind(this.meta!.gameId)
      .first<{ review_status: string; live_version_id: string | null; multiplayer_mode: MultiplayerMode; built_in_server: string | null; room_browsing: string }>();
    if (row && row.review_status === "live" && row.live_version_id && gameServerOf(row) === this.meta!.server) {
      if (row.room_browsing !== this.browsing) {
        this.browsing = row.room_browsing;
        if (this.core) this.core.listingChanged = true;
      }
      return true;
    }
    this.room()?.end("This game isn't available right now.");
    for (const ws of this.ctx.getWebSockets()) {
      this.retire(ws);
      ws.close(CLOSE_REFUSED, "Game unavailable");
    }
    await this.finish();
    return false;
  }

  /**
   * Players who came through a tester link leave the room once the developer turns it off. Checked
   * every 10 seconds, only while such players are in the room, so other rooms never read the table.
   */
  private async testerLinksStillOn(): Promise<void> {
    this.lastTesterCheck = Date.now();
    const links = [...new Set(this.sockets().map((ws) => (ws.deserializeAttachment() as Attachment & { stage: "in" }).tester).filter((t): t is string => Boolean(t)))];
    if (!links.length) return;
    const { results } = await this.env.DB.prepare(`SELECT id FROM tester_links WHERE id IN (${links.map(() => "?").join(", ")}) AND revoked_at_ms IS NULL`)
      .bind(...links)
      .all<{ id: string }>();
    const on = new Set(results.map((r) => r.id));
    for (const ws of this.sockets()) {
      const tester = (ws.deserializeAttachment() as Attachment & { stage: "in" }).tester;
      if (!tester || on.has(tester)) continue;
      try {
        ws.send(errorMessage("game_unavailable"));
      } catch {
        // Already closed.
      }
      await this.left(ws, "left");
      try {
        ws.close(CLOSE_REFUSED, "Tester link turned off");
      } catch {
        // Already closed.
      }
    }
  }

  /** The game's own game server keeps failing (stuck in a loop, say): end the match rather than freeze it. */
  private broken(): void {
    console.error(`Game server for ${this.meta?.slug} stopped working; ending room ${this.meta?.code}`);
    this.wasBroken = true;
    this.room()?.end("This game's server stopped working.");
    void this.finish();
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

  private refuse(ws: WebSocket, code: RoomErrorCode, message?: string): void {
    ws.serializeAttachment({ stage: "gone" } satisfies Attachment);
    try {
      ws.send(errorMessage(code, message));
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
      if (att?.stage === "hello" && now - att.at > HELLO_MS) this.refuse(ws, "no_hello");
      // Sockets already refused but not yet gone don't hold a place.
    }
  }
}
