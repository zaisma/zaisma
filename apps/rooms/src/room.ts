import { DurableObject } from "cloudflare:workers";
import {
  ERROR_TEXT,
  MONTH_LIMIT_END_MESSAGE,
  NO_ANSWER_CLOSE_CODE,
  PassError,
  REFUSED_CLOSE_CODE,
  ROOM_LIMITS,
  RoomCore,
  checkRoomData,
  clientIdle,
  errorMessage,
  tidyRoomInfo,
  verifyPass,
  type ClientIdle,
  type GameServer,
  type MoveAnswer,
  type MoveAsk,
  type Player,
  type PlayerKind,
  type RoomErrorCode,
  type RoomInfo,
  type RoomStart,
  type SavedRoom,
  type ServerMessage,
} from "@zaisma/game-server";
import { MATCH_FINISH_DURATION_SEC, blocksAmong, friendsAmong, gameServerOf, isOldEnoughFor, noteQuickJoin, pastFreeTier, accountUsernameOf, type AccountRequirement, type AgeBand, type MultiplayerMode } from "@zaisma/core";
import { gameServer } from "./registry.ts";
import { gameDatabase } from "./database.ts";
import { SANDBOX, errorLine, sandboxServer, type SandboxServer, type SandboxStats } from "./sandbox.ts";
import { secretsForGameServer } from "./secrets.ts";
import { signingKey, type Env } from "./index.ts";

/** A socket's saved details, kept through hibernation. */
type Attachment =
  | { stage: "hello"; connectedAtMs: number; tester?: string }
  // tester: the tester link the player came through, which they can only play through while it's on.
  // seenAtMs: about when the player last sent a message (pings are answered without waking the room).
  // clientIdle: the idle check the player's game asked for, for game servers that leave it to the client.
  // kind: missing on players who joined before accounts got passes, all guests.
  | { stage: "in"; id: string; name: string; kind?: PlayerKind; joinedAtMs: number; tester?: string; seenAtMs?: number; clientIdle?: ClientIdle }
  | { stage: "gone" };

interface Meta {
  gameId: string;
  slug: string;
  server: string;
  /** The game version a room started on: a sandboxed game server keeps running it until the room ends. */
  versionId?: string;
  /** Rooms made before room browsing don't know their code, and aren't listed. */
  roomCode?: string;
  /** The country and continent the room's first player connected from, which is roughly where the room runs. */
  country?: string | null;
  continent?: string | null;
}

interface Saved {
  state?: unknown;
  hasEnded?: boolean;
  usage?: Usage;
}

interface Usage {
  roomPlayDurationSec: number;
  messageCount: number;
}

/** A player must send their pass this soon after connecting. */
const HELLO_MS = 5000;
/** Extra sockets allowed past maximumPlayerCount, for people still saying hello. */
const SPARE_SOCKET_COUNT = 4;
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
/** How often a room with players checks whether its game has used the month's free tier, to start the hour its match gets to finish. */
const FREE_TIER_CHECK_MS = 5 * 60_000;


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
  /** When the game's secrets had last changed as its sandboxed game server got them, to hand it new ones when they change. */
  private secretsChangedAtMs: number | null = null;
  /** Set when the game server kept failing and the room ended for it. */
  private isBroken = false;
  /** Set once the game server failed to start and the game's errors say so, so a room that keeps failing writes it once. */
  private hasRecordedStartError = false;
  private hasEnded = false;
  private usage: Usage = { roomPlayDurationSec: 0, messageCount: 0 };
  private saved: unknown = undefined;
  private savedRoom: SavedRoom | undefined = undefined;
  private lastCheckAtMs = 0;
  private lastTesterCheckAtMs = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** The game's room browsing setting, read with its status; null until read since waking. */
  private browsing: string | null = null;
  /** What the game needs an account for, read with its status: guests can't join unless it's none. */
  private accountRequirement: AccountRequirement = "none";
  /** The youngest age that can play, read with its status: younger accounts can't join, and leave when it rises. */
  private minimumPlayerAgeYears = 13;
  /** What this room last wrote to live_rooms ("" for no row), so unchanged rooms don't write again. */
  private listedAs: string | undefined = undefined;
  /** The accounts this room last wrote to room_players, sorted; undefined when it doesn't know (it rewrites them all). */
  private seatedPlayerIds: string[] | undefined = undefined;
  /** This room told the game a player came in through quickJoin (noteQuickJoin); once is enough while it's awake. */
  private isQuickJoinNoted = false;
  /** Rooms this room is still setting up for its players (room.reserve), so it doesn't sleep before they're told. */
  private moving: Promise<void>[] = [];
  /** When the room's alarm is set for, so wakes that are already covered don't write it again. */
  private alarmAtMs: number | null = null;
  /** When the room last checked in (its row and usage), which it does hourly. */
  private checkedInAtMs = 0;
  /** The room's row didn't take its last write, so the next check writes it again. */
  private isRowStale = false;
  /** The game server hit an error the room hasn't written to game_server_errors yet: written within a minute. */
  private hasUnrecordedError = false;
  /** When the room last checked whether its game has used the month's free tier. */
  private freeTierCheckedAtMs = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Games ping every 25 seconds or so; the answer doesn't wake the room, and the time is kept per socket.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.blockConcurrencyWhile(async () => {
      const got = await ctx.storage.get<Meta | Saved | SavedRoom | number | string[]>(["meta", "saved", "room", "checkedInAtMs", "freeTierCheckedAtMs", "seatedPlayerIds"]);
      this.meta = (got.get("meta") as Meta | undefined) ?? null;
      const saved = (got.get("saved") as Saved | undefined) ?? {};
      this.saved = saved.state;
      this.savedRoom = got.get("room") as SavedRoom | undefined;
      this.hasEnded = saved.hasEnded ?? false;
      this.usage = { roomPlayDurationSec: saved.usage?.roomPlayDurationSec ?? 0, messageCount: saved.usage?.messageCount ?? 0 };
      this.checkedInAtMs = (got.get("checkedInAtMs") as number | undefined) ?? 0;
      this.freeTierCheckedAtMs = (got.get("freeTierCheckedAtMs") as number | undefined) ?? 0;
      this.seatedPlayerIds = got.get("seatedPlayerIds") as string[] | undefined;
      this.alarmAtMs = await ctx.storage.getAlarm();
    });
  }

  async fetch(request: Request): Promise<Response> {
    // Another room of the same game reserving this one (only rooms can reach this; players' requests are WebSockets).
    if (request.method === "POST" && new URL(request.url).pathname === "/reserve") return this.reserved(request);
    if (request.method === "POST" && new URL(request.url).pathname === "/expect") return this.expecting(request);
    if (!this.meta || !this.meta.roomCode) {
      this.meta = {
        gameId: request.headers.get("x-game-id")!,
        slug: request.headers.get("x-game-slug")!,
        server: request.headers.get("x-game-server")!,
        versionId: request.headers.get("x-game-version") ?? undefined,
        ...this.meta,
        roomCode: request.headers.get("x-room-code") ?? undefined,
        country: this.meta?.country ?? (request.headers.get("x-room-country") || null),
        continent: this.meta?.continent ?? (request.headers.get("x-room-continent") || null),
      };
      await this.ctx.storage.put("meta", this.meta);
    }
    const server = await this.load();
    if (!server) return new Response("This game isn't available right now", { status: 404 });

    this.dropStaleHellos();
    const maximumSocketCount = (server.maximumPlayerCount ?? ROOM_LIMITS.defaultMaximumPlayerCount) + SPARE_SOCKET_COUNT;
    const open = this.ctx.getWebSockets().filter((existing) => (existing.deserializeAttachment() as Attachment | null)?.stage !== "gone");
    if (open.length >= maximumSocketCount) return new Response("This room is full", { status: 409 });

    const { 0: client, 1: socket } = new WebSocketPair();
    this.ctx.acceptWebSocket(socket);
    const tester = request.headers.get("x-tester-link") || undefined;
    socket.serializeAttachment({ stage: "hello", connectedAtMs: Date.now(), ...(tester ? { tester } : {}) } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = socket.deserializeAttachment() as Attachment;
    if (typeof message !== "string") return this.refuse(socket, "bad_message");
    if (attachment.stage === "hello") return this.hello(socket, message);
    if (attachment.stage !== "in") return;

    // Pings never get here; any other message shows the player is still connected.
    const nowMs = Date.now();
    if (nowMs - (attachment.seenAtMs ?? attachment.joinedAtMs ?? 0) > SEEN_MS) socket.serializeAttachment({ ...attachment, seenAtMs: nowMs } satisfies Attachment);

    await this.load();
    const core = this.room();
    if (!core) return;
    if (Date.now() - this.lastCheckAtMs > CHECK_MS && !(await this.gameStillLive())) return;
    if (Date.now() - this.lastTesterCheckAtMs > TESTER_CHECK_MS) await this.testerLinksStillOn();
    if ((socket.deserializeAttachment() as Attachment).stage !== "in") return;
    const errorCode = core.receive(attachment.id, message);
    if (errorCode) socket.send(errorMessage(errorCode));
    await this.settle(core);
  }

  async webSocketClose(socket: WebSocket, code: number): Promise<void> {
    // Closed on purpose (1000, or 1001 as a page goes away), or the connection was lost.
    await this.left(socket, code === 1000 || code === 1001 ? "left" : "lost");
    try {
      socket.close(code === 1005 || code === 1006 ? 1000 : code, "Bye");
    } catch {
      // Already closed.
    }
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.left(socket, "lost");
  }

  /**
   * A room with players wakes every half a minute to check on them, and checks in every hour. An
   * empty room's leftovers are cleared a day after the last player left, including a room that
   * stopped without hearing its players go (a restart).
   */
  async alarm(): Promise<void> {
    this.alarmAtMs = null;
    if (this.sockets().length) {
      // The next check first, so one that fails (a busy database) doesn't stop the room checking on its players.
      await this.wake(Date.now() + SWEEP_MS);
      await this.load();
      const core = this.room();
      for (const socket of this.unanswered()) {
        await this.left(socket, "lost");
        try {
          socket.close(NO_ANSWER_CLOSE_CODE, "No answer");
        } catch {
          // Already closed.
        }
      }
      // The hour the match got to finish, once the game used the month's free tier, is up.
      if (core && !this.hasEnded && core.endsAt !== null && Date.parse(core.endsAt) <= Date.now()) {
        core.end(MONTH_LIMIT_END_MESSAGE);
        await this.finish();
        return;
      }
      if (core && !this.hasEnded) {
        core.sweep();
        await this.settle(core);
        if (this.isRowStale) await this.list();
        if (Date.now() - this.freeTierCheckedAtMs >= FREE_TIER_CHECK_MS) await this.checkFreeTier(core);
      }
      if (this.hasUnrecordedError) {
        this.hasUnrecordedError = false;
        await this.recordUsage(false);
      }
      if (this.sockets().length && Date.now() - this.checkedInAtMs >= CHECK_IN_MS) {
        if (await this.gameStillLive()) await this.list(true);
        await this.touchSeats();
        // A long match's game server health shouldn't wait for the room to empty.
        await this.recordUsage(false);
        // Also when the room has no row to touch (everyone walked away).
        this.checkedInAtMs = Date.now();
        await this.ctx.storage.put("checkedInAtMs", this.checkedInAtMs);
      }
      return;
    }
    await this.unlist();
    await this.seat();
    const emptiedAtMs = await this.ctx.storage.get<number>("emptiedAtMs");
    if (emptiedAtMs === undefined) {
      await this.ctx.storage.put("emptiedAtMs", Date.now());
      await this.setAlarm(Date.now() + KEEP_EMPTY_MS);
    } else if (Date.now() - emptiedAtMs >= KEEP_EMPTY_MS) {
      await this.ctx.storage.deleteAll();
    } else {
      await this.setAlarm(emptiedAtMs + KEEP_EMPTY_MS);
    }
  }

  /** After the game server ran: finish what it started, keep ticking only while someone's playing, save and bring the room's row up to date. */
  private async settle(core: RoomCore): Promise<void> {
    await core.settled();
    await this.moved();
    await core.settled();
    if (!this.hasEnded && !core.ended) this.pace(core);
    await this.save();
    if (core.listingChanged) await this.list();
    await this.seat();
  }

  /** Sockets of players the room hasn't heard from, not even a ping, for too long. */
  private unanswered(nowMs = Date.now()): WebSocket[] {
    return this.sockets().filter((socket) => {
      const attachment = socket.deserializeAttachment() as Attachment & { stage: "in" };
      const pinged = this.ctx.getWebSocketAutoResponseTimestamp(socket)?.getTime() ?? 0;
      return nowMs - Math.max(pinged, attachment.seenAtMs ?? 0, attachment.joinedAtMs ?? 0) > DEAD_MS;
    });
  }

  /** Make sure the room wakes by then: writes the alarm only if it isn't already due sooner. */
  private async wake(wakeAtMs: number): Promise<void> {
    if (this.alarmAtMs !== null && this.alarmAtMs <= wakeAtMs && this.alarmAtMs > Date.now()) return;
    await this.setAlarm(wakeAtMs);
  }

  private async setAlarm(alarmAtMs: number): Promise<void> {
    this.alarmAtMs = alarmAtMs;
    await this.ctx.storage.setAlarm(alarmAtMs);
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
      versionId: request.headers.get("x-game-version") ?? undefined,
      roomCode: request.headers.get("x-room-code")!,
      country: request.headers.get("x-room-country") || null,
      continent: request.headers.get("x-room-continent") || null,
    };
    this.savedRoom = {
      isListed: start.isListed,
      isOpen: false,
      friendJoinsEnabled: start.friendJoinsEnabled !== false,
      name: start.name,
      labels: start.labels,
      knownPlayerIds: start.playerIds,
      setupData: start.setupData ?? null,
      ...(start.keptOut ? { keptOut: start.keptOut } : {}),
      ...(typeof start.lobbyRoomCode === "string" && start.lobbyRoomCode ? { lobbyRoomCode: start.lobbyRoomCode } : {}),
    };
    // Like an empty room: cleared after a day if nobody comes.
    await this.ctx.storage.put({ meta: this.meta, room: this.savedRoom, emptiedAtMs: Date.now() });
    await this.setAlarm(Date.now() + KEEP_EMPTY_MS);
    return new Response(null, { status: 204 });
  }

  /**
   * Another room of the same game sends players here (room.moveTo): the game server decides who it
   * takes, and holds a seat for each for a minute. A room that isn't running takes nobody.
   */
  private async expecting(request: Request): Promise<Response> {
    if (!this.meta?.roomCode || this.hasEnded || this.meta.gameId !== request.headers.get("x-game-id")) return new Response("No such room", { status: 404 });
    const ask = (await request.json()) as MoveAsk;
    const players = Array.isArray(ask?.players) ? ask.players.filter((player) => typeof player?.id === "string" && typeof player?.name === "string" && (player.kind === "guest" || player.kind === "account")).slice(0, 16) : [];
    if (typeof ask?.fromRoomCode !== "string" || !players.length) return new Response("Bad request", { status: 400 });
    if (!(await this.load()) || !(await this.gameStillLive())) return new Response("No such room", { status: 404 });
    const core = this.room();
    if (!core) return new Response("No such room", { status: 404 });
    const answer = await core.expect({ fromRoomCode: ask.fromRoomCode, players: players.map((player) => ({ id: player.id, name: player.name, kind: player.kind })), joinData: ask.joinData ?? null });
    await core.settled();
    this.savedRoom = core.saved;
    await this.ctx.storage.put("room", this.savedRoom);
    await this.save();
    return Response.json(answer);
  }

  private async hello(socket: WebSocket, text: string): Promise<void> {
    const tester = (socket.deserializeAttachment() as Attachment & { stage: "hello" }).tester;
    let pass: unknown;
    let made: { isListed?: boolean; friendJoinsEnabled?: boolean; joinData?: unknown; clientIdle?: ClientIdle } & RoomInfo = {};
    // From quickJoin: rather another room than one with someone this player blocked.
    let avoidsBlockedPlayers = false;
    // From quickJoin at all: the game joins players by itself, which its Rooms tab says.
    let isQuickJoin = false;
    try {
      const hello = JSON.parse(text) as { type?: unknown; pass?: unknown; joinData?: unknown; room?: { isListed?: unknown; friendJoinsEnabled?: unknown; name?: unknown; labels?: unknown }; avoidBlockedPlayers?: unknown; isQuickJoin?: unknown };
      if (hello.type !== "hello") return this.refuse(socket, "no_hello");
      pass = hello.pass;
      avoidsBlockedPlayers = hello.avoidBlockedPlayers === true;
      isQuickJoin = hello.isQuickJoin === true;
      // The idle check the player's game asked for, for game servers that leave it to the client.
      made.clientIdle = clientIdle(hello);
      // How the player who makes the room sets it up; the room takes it only from them.
      const room = hello.room && typeof hello.room === "object" ? hello.room : {};
      made = { ...made, ...(room.isListed === false ? { isListed: false } : {}), ...(room.friendJoinsEnabled === false ? { friendJoinsEnabled: false } : {}), ...tidyRoomInfo(room as RoomInfo) };
      // What the player brings for the game server's onJoin, like the character they picked.
      const checked = checkRoomData(hello.joinData);
      if (!checked.isValid) return this.refuse(socket, "too_big");
      made.joinData = checked.checkedData;
    } catch {
      return this.refuse(socket, "no_hello");
    }
    if (typeof pass !== "string" || !this.meta) return this.refuse(socket, "bad_pass");

    let player: Player;
    try {
      const claims = await verifyPass(pass, [(await signingKey(this.env)).publicKey], { game: this.meta.slug, issuer: this.env.ISSUER });
      // An account's pass is proof only: its name comes from its profile, and a deleted account's pass stops working.
      const name = claims.kind === "account" ? await accountUsernameOf(this.env.DB, claims.sub) : claims.name;
      if (!name) return this.refuse(socket, "bad_pass");
      player = { id: claims.sub, name, kind: claims.kind };
    } catch (error) {
      if (!(error instanceof PassError)) throw error;
      return this.refuse(socket, "bad_pass");
    }
    if (this.hasEnded) return this.refuse(socket, "ended");
    if (!(await this.gameStillLive())) return this.refuse(socket, "game_unavailable");
    // Passes aren't given to guests of games that need accounts; this catches one given before the game changed.
    if (player.kind === "guest" && this.accountRequirement !== "none") return this.refuse(socket, "account_needed");
    // Passes aren't given to younger accounts either; the band comes from D1, since a pass never carries an age.
    if (player.kind === "account" && this.minimumPlayerAgeYears > 13) {
      const account = await this.env.DB.prepare("SELECT age_band FROM accounts WHERE player_id = ?").bind(player.id).first<{ age_band: AgeBand }>();
      if (!account || !isOldEnoughFor(account.age_band, this.minimumPlayerAgeYears)) return this.refuse(socket, "game_not_open_to_player");
    }
    await this.load();
    const core = this.room();
    if (!core) return this.refuse(socket, "game_unavailable");
    // Past this month's free tier, a room takes back only players it knows or is holding a place for, and its match gets an hour to finish.
    if (!core.players.has(player.id) && !core.expects(player.id) && (core.endsAt !== null || (await this.checkFreeTier(core)))) return this.refuse(socket, "month_limit");
    // Blocks between this account and the players the room remembers, found afresh, so one taken back since is gone.
    if (player.kind === "account" && core.known.size > 0) {
      const blocks = await blocksAmong(this.env.DB, player.id, [...core.known]);
      // quickJoin prefers rooms without anyone the player blocked, and comes back here only when nothing else fits.
      if (avoidsBlockedPlayers && blocks.some((block) => block.blocker_player_id === player.id && core.players.has(block.blocked_player_id))) return this.refuse(socket, "blocked_player_here");
      core.setAccountBlocks(player.id, blocks.map((block) => (block.blocker_player_id === player.id ? block.blocked_player_id : block.blocker_player_id)));
      // And friends among them, for the game server's room.areFriends.
      core.setFriends(player.id, await friendsAmong(this.env.DB, player.id, [...core.known]));
    }
    // The room's rules and the game's canJoin, before anyone hears about this player.
    const admitted = await core.admit(player, made.joinData);
    if (!admitted.isAllowed) {
      this.refuse(socket, admitted.code, admitted.message);
      // A canJoin that crashed or answered wrongly turns everyone away, so the room may never fill and empty: record it now, for its developer.
      if ((this.server as { stats?: SandboxStats } | null)?.stats?.errors.size) await this.recordUsage(false);
      return;
    }
    if ((socket.deserializeAttachment() as Attachment).stage !== "hello") return;

    // The same player connecting again (a reconnect or a second tab) replaces the old connection.
    for (const other of this.sockets(player.id)) {
      this.retire(other);
      other.close(REFUSED_CLOSE_CODE, "Joined from somewhere else");
    }
    const nowMs = Date.now();
    socket.serializeAttachment({ stage: "in", id: player.id, name: player.name, kind: player.kind, joinedAtMs: nowMs, seenAtMs: nowMs, ...(tester ? { tester } : {}), clientIdle: made.clientIdle ?? {} } satisfies Attachment);
    const joined = core.join(player, made);
    if (!joined.isAllowed) return this.refuse(socket, joined.code, joined.message);
    if (isQuickJoin && !this.isQuickJoinNoted) {
      this.isQuickJoinNoted = true;
      // Only a line of copy rides on it, so a busy database never holds up the player.
      await noteQuickJoin(this.env.DB, this.meta.gameId).catch(() => (this.isQuickJoinNoted = false));
    }
    await core.settled();
    if (core.players.size === 1) await this.ctx.storage.delete("emptiedAtMs");
    await this.settle(core);
    await this.wake(Date.now() + SWEEP_MS);
  }

  /** A player's connection closed: they left, or it was lost (the room then holds their seat a while). */
  private async left(socket: WebSocket, why: "left" | "lost"): Promise<void> {
    const attachment = this.retire(socket);
    if (attachment.stage !== "in") return;
    const core = this.sockets(attachment.id).length === 0 && (await this.load()) ? this.room() : null;
    core?.leave(attachment.id, why);
    if (this.sockets().length === 0) {
      await core?.settled();
      await this.emptied();
    } else if (core) await this.settle(core);
  }

  /** Mark a socket as gone, counting the time its player spent in the room. */
  private retire(socket: WebSocket): Attachment {
    const attachment = socket.deserializeAttachment() as Attachment;
    if (attachment.stage === "in") this.usage.roomPlayDurationSec += Math.round((Date.now() - (attachment.joinedAtMs ?? Date.now())) / 1000);
    socket.serializeAttachment({ stage: "gone" } satisfies Attachment);
    return attachment;
  }

  /** Everyone has gone: stop ticking, record usage, drop the room's row, and clean up after a day. */
  private async emptied(): Promise<void> {
    this.stopTicking();
    await this.recordUsage();
    if (this.core && !this.core.ticking) this.core.dirty = true;
    await this.save();
    await this.unlist();
    await this.seat();
    await this.ctx.storage.put("emptiedAtMs", Date.now());
    await this.setAlarm(Date.now() + KEEP_EMPTY_MS);
  }

  /**
   * Whether the game has used this month's free tier. The first time a running match finds it has, it
   * gets MATCH_FINISH_DURATION_SEC to finish: its game server and players hear when it ends (room.endsAt).
   */
  private async checkFreeTier(core: RoomCore): Promise<boolean> {
    if (core.endsAt !== null) return true;
    // Kept, since a sleeping room forgets: otherwise every wake would check.
    this.freeTierCheckedAtMs = Date.now();
    await this.ctx.storage.put("freeTierCheckedAtMs", this.freeTierCheckedAtMs);
    if (!(await pastFreeTier(this.env.DB, this.meta!.gameId))) return false;
    if (core.players.size > 0 && !core.ended) {
      const endsAtMs = Date.now() + MATCH_FINISH_DURATION_SEC * 1000;
      core.startEnding(new Date(endsAtMs).toISOString());
      // Kept with the room, so a room that sleeps and wakes keeps the same end.
      this.savedRoom = core.saved;
      await this.ctx.storage.put("room", this.savedRoom);
      await this.settle(core);
      await this.wake(endsAtMs);
    }
    return true;
  }

  /** A new distinct error in the game server: write it within a minute, for its webhooks, not at the hourly check-in. */
  private newError(): void {
    this.hasUnrecordedError = true;
    void this.wake(Date.now() + 60_000);
  }

  /** The match is over for good: nobody else can join this room. */
  private async finish(): Promise<void> {
    if (this.hasEnded) return;
    this.hasEnded = true;
    this.stopTicking();
    await this.recordUsage();
    await this.unlist();
    await this.ctx.storage.put({ saved: { hasEnded: true } satisfies Saved, emptiedAtMs: Date.now() });
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
    if (!core || !meta?.roomCode) return;
    if (this.browsing === null && !(await this.gameStillLive())) return;
    core.listingChanged = false;
    // What the room keeps for itself, so a hidden or closed room stays that way after a restart.
    this.savedRoom = core.saved;
    await this.ctx.storage.put("room", this.savedRoom);
    const live = !this.hasEnded && !core.ended && core.playingCount > 0;
    const isListed = core.isListed && this.browsing !== "off" ? 1 : 0;
    const labels = JSON.stringify(core.labels);
    const as = live ? JSON.stringify([core.playingCount, core.heldSeatCount, core.maximumPlayerCount, core.isOpen, isListed, core.friendJoinsEnabled, core.name, labels]) : "";
    if (as === this.listedAs && !touch) return;
    if (!live) return this.unlist();
    const nowMs = Date.now();
    await this.rowWrite(as, () =>
      this.env.DB.prepare(
        // A name a person hid stays hidden while the room lives (is_name_hidden is never overwritten here).
        "INSERT INTO live_rooms (game_id, room_code, player_count, held_seat_count, maximum_player_count, is_listed, is_open, friend_joins_enabled, name, labels, country, continent, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(game_id, room_code) DO UPDATE SET player_count = excluded.player_count, held_seat_count = excluded.held_seat_count, maximum_player_count = excluded.maximum_player_count, is_listed = excluded.is_listed, is_open = excluded.is_open, friend_joins_enabled = excluded.friend_joins_enabled, name = excluded.name, labels = excluded.labels, updated_at_ms = excluded.updated_at_ms",
      )
        .bind(meta.gameId, meta.roomCode, core.playingCount, core.heldSeatCount, core.maximumPlayerCount, isListed, core.isOpen ? 1 : 0, core.friendJoinsEnabled ? 1 : 0, core.name, labels, meta.country ?? null, meta.continent ?? null, nowMs, nowMs)
        .run(),
    );
    // Checked in: the next check-in is due an hour from now.
    this.checkedInAtMs = nowMs;
    await this.ctx.storage.put("checkedInAtMs", nowMs);
  }

  /**
   * Bring room_players up to date with the accounts connected here, for friends' Join (guests are
   * never written). Writes only what changed; a failed write (a busy database) never stops the
   * game, and is tried again in full next time.
   */
  private async seat(): Promise<void> {
    const meta = this.meta;
    if (!meta?.roomCode) return;
    const playerIds = [...new Set(this.sockets().flatMap((socket) => {
      const attachment = socket.deserializeAttachment() as Attachment & { stage: "in" };
      return attachment.kind === "account" ? [attachment.id] : [];
    }))].sort();
    const was = this.seatedPlayerIds;
    if (was && was.join() === playerIds.join()) return;
    const nowMs = Date.now();
    const database = this.env.DB;
    this.seatedPlayerIds = undefined;
    try {
      await database.batch([
        ...(was
          ? was.filter((playerId) => !playerIds.includes(playerId)).map((playerId) => database.prepare("DELETE FROM room_players WHERE game_id = ? AND room_code = ? AND player_id = ? AND server_url IS NULL").bind(meta.gameId, meta.roomCode!, playerId))
          : [database.prepare("DELETE FROM room_players WHERE game_id = ? AND room_code = ? AND server_url IS NULL").bind(meta.gameId, meta.roomCode!)]),
        ...playerIds
          .filter((playerId) => !was?.includes(playerId))
          .map((playerId) =>
            database
              .prepare("INSERT INTO room_players (game_id, room_code, player_id, joined_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?) ON CONFLICT (game_id, room_code, player_id) DO UPDATE SET updated_at_ms = excluded.updated_at_ms, server_url = NULL")
              .bind(meta.gameId, meta.roomCode!, playerId, nowMs, nowMs),
          ),
      ]);
    } catch (error) {
      console.error("room_players write failed", error);
      await this.ctx.storage.delete("seatedPlayerIds");
      return;
    }
    this.seatedPlayerIds = playerIds;
    await this.ctx.storage.put("seatedPlayerIds", playerIds);
  }

  /** The hourly check-in for room_players, so rows of rooms that stop without saying so drop off. */
  private async touchSeats(): Promise<void> {
    if (!this.meta?.roomCode || !this.seatedPlayerIds?.length) return;
    await this.env.DB.prepare("UPDATE room_players SET updated_at_ms = ? WHERE game_id = ? AND room_code = ? AND server_url IS NULL").bind(Date.now(), this.meta.gameId, this.meta.roomCode).run();
  }

  private async unlist(): Promise<void> {
    if (this.listedAs === "" || !this.meta?.roomCode) return;
    await this.rowWrite("", () => this.env.DB.prepare("DELETE FROM live_rooms WHERE game_id = ? AND room_code = ?").bind(this.meta!.gameId, this.meta!.roomCode!).run());
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
      this.isRowStale = false;
    } catch (error) {
      if (this.listedAs === as) this.listedAs = was;
      this.isRowStale = true;
      throw error;
    }
  }

  private stopTicking(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Add this room's player time, message count and game server health to the game's daily usage.
   * Nothing about players. Called when the room empties or ends (ended), and hourly while it runs.
   */
  private async recordUsage(ended = true): Promise<void> {
    if (this.core) {
      this.usage.messageCount += this.core.messageCount;
      this.core.messageCount = 0;
    }
    const stats = (this.server as { stats?: SandboxStats } | null)?.stats;
    const health = { callCount: stats?.callCount ?? 0, crashCount: stats?.crashCount ?? 0, stoppedCount: stats?.stoppedCount ?? 0, endedMatchCount: ended && this.isBroken ? 1 : 0 };
    const errors = stats ? [...stats.errors.values()] : [];
    if (stats) {
      stats.callCount = stats.waitDurationMs = stats.crashCount = stats.stoppedCount = 0;
      stats.errors.clear();
    }
    if (!this.meta || !(this.usage.roomPlayDurationSec || this.usage.messageCount || health.callCount || health.crashCount || health.stoppedCount || health.endedMatchCount)) return;
    const date = new Date().toISOString().slice(0, 10);
    const nowMs = Date.now();
    await this.env.DB.batch([
      this.env.DB.prepare(
        "INSERT INTO room_usage (game_id, date, room_count, room_play_duration_sec, message_count, game_server_call_count, game_server_crash_count, game_server_stopped_count, game_server_ended_match_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(game_id, date) DO UPDATE SET room_count = room_count + excluded.room_count, room_play_duration_sec = room_play_duration_sec + excluded.room_play_duration_sec, message_count = message_count + excluded.message_count, game_server_call_count = game_server_call_count + excluded.game_server_call_count, game_server_crash_count = game_server_crash_count + excluded.game_server_crash_count, game_server_stopped_count = game_server_stopped_count + excluded.game_server_stopped_count, game_server_ended_match_count = game_server_ended_match_count + excluded.game_server_ended_match_count",
      ).bind(this.meta.gameId, date, ended ? 1 : 0, this.usage.roomPlayDurationSec, this.usage.messageCount, health.callCount, health.crashCount, health.stoppedCount, health.endedMatchCount),
      ...errors.map((error) =>
        this.env.DB.prepare(
          "INSERT INTO game_server_errors (game_id, version_id, kind, message, occurrence_count, first_at_ms, last_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(game_id, version_id, kind, message) DO UPDATE SET occurrence_count = occurrence_count + excluded.occurrence_count, last_at_ms = excluded.last_at_ms",
        ).bind(this.meta!.gameId, this.meta!.versionId ?? "", error.kind, error.message, error.occurrenceCount, error.firstAtMs, nowMs),
      ),
    ]);
    this.usage = { roomPlayDurationSec: 0, messageCount: 0 };
  }

  /**
   * The game reserved a room (room.reserve): set it up, then tell its players where to go. Players
   * learn the code only once the room is waiting for them, so nobody else can get there first.
   */
  private reserve(roomCode: string, start: RoomStart): void {
    const meta = this.meta!;
    const work = (async () => {
      const headers = { "x-game-id": meta.gameId, "x-game-slug": meta.slug, "x-game-server": meta.server, "x-game-version": meta.versionId ?? "", "x-room-code": roomCode, "x-room-country": meta.country ?? "", "x-room-continent": meta.continent ?? "" };
      // The new room knows where it came from, for game servers that send players who walk away back to their lobby.
      const body = JSON.stringify({ ...start, ...(meta.roomCode ? { lobbyRoomCode: meta.roomCode } : {}) } satisfies RoomStart);
      const response = await this.env.ROOMS.get(this.env.ROOMS.idFromName(`${meta.slug}:${roomCode}`)).fetch("https://room/reserve", { method: "POST", headers, body });
      if (!response.ok) throw new Error(`room ${roomCode} said ${response.status}`);
      const text = JSON.stringify({ type: "move", roomCode } satisfies ServerMessage);
      for (const id of start.playerIds) this.sockets(id).forEach((socket) => socket.send(text));
    })().catch((error) => console.error("Couldn't reserve a room:", error));
    this.moving.push(work);
  }

  /**
   * The game sends players to another of its rooms (room.moveTo): ask that room, tell the players it
   * takes where to go, and give the game server the answer (onMoved).
   */
  private moveTo(roomCode: string, ask: Omit<MoveAsk, "fromRoomCode">): void {
    const meta = this.meta!;
    const nobody = (refusalCode: "no_room" | "busy"): MoveAnswer => ({ movedPlayerIds: [], refusals: ask.players.map((player) => ({ playerId: player.id, code: refusalCode, message: ERROR_TEXT[refusalCode] })) });
    const work = (async () => {
      let answer: MoveAnswer;
      if (roomCode === meta.roomCode || !meta.roomCode) answer = nobody("no_room");
      else {
        try {
          const response = await this.env.ROOMS.get(this.env.ROOMS.idFromName(`${meta.slug}:${roomCode}`)).fetch("https://room/expect", {
            method: "POST",
            headers: { "x-game-id": meta.gameId },
            body: JSON.stringify({ ...ask, fromRoomCode: meta.roomCode } satisfies MoveAsk),
          });
          answer = response.ok ? await response.json() : nobody("no_room");
        } catch (error) {
          console.error("Couldn't move players:", error);
          answer = nobody("busy");
        }
      }
      const text = JSON.stringify({ type: "move", roomCode } satisfies ServerMessage);
      for (const id of answer.movedPlayerIds) this.sockets(id).forEach((socket) => socket.send(text));
      this.core?.moved(roomCode, answer, ask.players);
    })().catch((error) => console.error("Couldn't move players:", error));
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
    const presence: Record<string, { seenAtMs?: number; clientIdle?: ClientIdle }> = {};
    const players = this.sockets().flatMap((socket) => {
      const attachment = socket.deserializeAttachment() as Attachment & { stage: "in" };
      if (Object.hasOwn(held, attachment.id)) return [];
      presence[attachment.id] = { seenAtMs: attachment.seenAtMs ?? attachment.joinedAtMs, clientIdle: attachment.clientIdle };
      return [{ id: attachment.id, name: attachment.name, kind: attachment.kind ?? "guest" }];
    });
    const transport = {
      send: (id: string, text: string) => this.sockets(id).forEach((socket) => socket.send(text)),
      close: (id: string, code: number, reason: string) => {
        this.sockets(id).forEach((socket) => {
          this.retire(socket);
          socket.close(code, reason);
        });
        // The game kicked the last player: the room empties like when everyone leaves.
        if (!this.core?.ended && this.sockets().length === 0) void this.emptied();
      },
      reserve: (roomCode: string, start: RoomStart) => this.reserve(roomCode, start),
      moveTo: (roomCode: string, ask: Omit<MoveAsk, "fromRoomCode">) => this.moveTo(roomCode, ask),
      // A game server built into this Worker reaches its game's database directly; a sandboxed one through its own binding (sandbox.ts).
      database: gameDatabase(this.env, this.meta!.gameId),
    };
    // Turn-based rooms wake with their saved state. A ticking room's state isn't saved,
    // so if one is ever evicted mid-match, it starts fresh and everyone joins again.
    // Either way, the room stays as listed or hidden, and as open or closed, as it was.
    if (!server.ticksPerSec && this.saved !== undefined) {
      this.core = new RoomCore(server, transport, { state: this.saved, players, room: this.savedRoom, presence });
    } else {
      this.core = new RoomCore(server, transport, { room: this.savedRoom });
      for (const player of players) this.core.join(player, { clientIdle: presence[player.id]?.clientIdle });
    }
    this.core.dirty = false;
    return this.core;
  }

  /**
   * Load the game server: a built-in one, or the game's own in its sandbox. A sandbox that can't
   * open (no game server file, or it fails to start) leaves the room unavailable, like a takedown,
   * and the game's errors say why (once per room), like an option the game server doesn't take.
   */
  private async load(): Promise<GameServer | null> {
    if (this.server || !this.meta) return this.server;
    if (this.meta.server !== SANDBOX) return (this.server = gameServer(this.meta.server));
    if (!this.meta.versionId) return null;
    try {
      const { secrets, changedAtMs } = await secretsForGameServer(this.env, this.meta.gameId);
      this.secretsChangedAtMs = changedAtMs;
      this.server = await sandboxServer(this.env, this.ctx.exports, this.meta.gameId, this.meta.versionId, secrets, () => this.broken(), () => this.newError());
    } catch (error) {
      console.error("Couldn't start the game server:", error);
      if (!this.hasRecordedStartError) {
        this.hasRecordedStartError = true;
        const nowMs = Date.now();
        await this.env.DB.prepare(
          "INSERT INTO game_server_errors (game_id, version_id, kind, message, occurrence_count, first_at_ms, last_at_ms) VALUES (?, ?, 'crash', ?, 1, ?, ?) ON CONFLICT(game_id, version_id, kind, message) DO UPDATE SET occurrence_count = occurrence_count + 1, last_at_ms = excluded.last_at_ms",
        )
          .bind(this.meta.gameId, this.meta.versionId, `Didn't start: ${errorLine(String(error instanceof Error ? error.message : error))}`, nowMs, nowMs)
          .run()
          .catch((writeError: unknown) => console.error("Couldn't record the game server's error:", writeError));
      }
    }
    return this.server;
  }

  /** A real-time room ticks while someone's playing; a room where everyone walked away stops until someone's back. */
  private pace(core: RoomCore): void {
    if (core.playingCount > 0) this.startTicking(core);
    else this.stopTicking();
  }

  private startTicking(core: RoomCore): void {
    if (!core.ticking || this.timer) return;
    let lastTickAtMs = Date.now();
    this.timer = setInterval(() => {
      const nowMs = Date.now();
      core.tick((nowMs - lastTickAtMs) / 1000);
      lastTickAtMs = nowMs;
      if (core.ended) void this.finish();
      else if (nowMs - this.lastCheckAtMs > CHECK_MS) void this.gameStillLive();
      else if (nowMs - this.lastTesterCheckAtMs > TESTER_CHECK_MS) void this.testerLinksStillOn();
      else if (core.listingChanged) void this.list();
    }, 1000 / core.server.ticksPerSec!);
  }

  /** A takedown or a changed game server ends the match. Also picks up the game's room browsing and account settings, and new secrets. */
  private async gameStillLive(): Promise<boolean> {
    this.lastCheckAtMs = Date.now();
    const row = await this.env.DB.prepare("SELECT review_status, live_version_id, multiplayer_mode, built_in_server, room_browsing, account_requirement, minimum_player_age_years, secrets_changed_at_ms FROM games WHERE id = ?")
      .bind(this.meta!.gameId)
      .first<{ review_status: string; live_version_id: string | null; multiplayer_mode: MultiplayerMode; built_in_server: string | null; room_browsing: string; account_requirement: AccountRequirement; minimum_player_age_years: number; secrets_changed_at_ms: number | null }>();
    if (row && row.review_status === "live" && row.live_version_id && gameServerOf(row) === this.meta!.server) {
      this.accountRequirement = row.account_requirement;
      if (row.minimum_player_age_years > this.minimumPlayerAgeYears) {
        this.minimumPlayerAgeYears = row.minimum_player_age_years;
        await this.removeTooYoung();
      }
      this.minimumPlayerAgeYears = row.minimum_player_age_years;
      if (row.secrets_changed_at_ms !== this.secretsChangedAtMs) await this.newSecrets();
      if (row.room_browsing !== this.browsing) {
        this.browsing = row.room_browsing;
        if (this.core) this.core.listingChanged = true;
      }
      return true;
    }
    this.room()?.end("This game isn't available right now.");
    for (const socket of this.ctx.getWebSockets()) {
      this.retire(socket);
      socket.close(REFUSED_CLOSE_CODE, "Game unavailable");
    }
    await this.finish();
    return false;
  }

  /** The game's secrets changed: its sandboxed game server gets them from its next call. */
  private async newSecrets(): Promise<void> {
    const server = this.server as SandboxServer | null;
    if (!server || typeof server.setSecrets !== "function") return;
    try {
      const { secrets, changedAtMs } = await secretsForGameServer(this.env, this.meta!.gameId);
      this.secretsChangedAtMs = changedAtMs;
      await server.setSecrets(secrets);
    } catch (error) {
      console.error("Couldn't read the game's new secrets:", error);
    }
  }

  /**
   * Players who came through a tester link leave the room once the developer turns it off or it ends. Checked
   * every 10 seconds, only while such players are in the room, so other rooms never read the table.
   */
  private async testerLinksStillOn(): Promise<void> {
    this.lastTesterCheckAtMs = Date.now();
    const links = [...new Set(this.sockets().map((socket) => (socket.deserializeAttachment() as Attachment & { stage: "in" }).tester).filter((tester): tester is string => Boolean(tester)))];
    if (!links.length) return;
    const { results } = await this.env.DB.prepare(`SELECT id FROM tester_links WHERE id IN (${links.map(() => "?").join(", ")}) AND revoked_at_ms IS NULL AND (ends_at_ms IS NULL OR ends_at_ms > ?)`)
      .bind(...links, Date.now())
      .all<{ id: string }>();
    const on = new Set(results.map((link) => link.id));
    for (const socket of this.sockets()) {
      const tester = (socket.deserializeAttachment() as Attachment & { stage: "in" }).tester;
      if (!tester || on.has(tester)) continue;
      try {
        socket.send(errorMessage("game_unavailable"));
      } catch {
        // Already closed.
      }
      await this.left(socket, "left");
      try {
        socket.close(REFUSED_CLOSE_CODE, "Tester link turned off");
      } catch {
        // Already closed.
      }
    }
  }

  /** The game's minimum age rose (or the room woke to one above 13): accounts now too young leave, all found in one read. */
  private async removeTooYoung(): Promise<void> {
    const accounts = this.sockets().filter((socket) => (socket.deserializeAttachment() as Attachment & { stage: "in" }).kind === "account");
    if (!accounts.length) return;
    const playerIds = [...new Set(accounts.map((socket) => (socket.deserializeAttachment() as Attachment & { stage: "in" }).id))];
    const { results } = await this.env.DB.prepare(`SELECT player_id, age_band FROM accounts WHERE player_id IN (${playerIds.map(() => "?").join(", ")})`)
      .bind(...playerIds)
      .all<{ player_id: string; age_band: AgeBand }>();
    const oldEnough = new Set(results.filter((account) => isOldEnoughFor(account.age_band, this.minimumPlayerAgeYears)).map((account) => account.player_id));
    for (const socket of accounts) {
      if (oldEnough.has((socket.deserializeAttachment() as Attachment & { stage: "in" }).id)) continue;
      try {
        socket.send(errorMessage("game_not_open_to_player"));
      } catch {
        // Already closed.
      }
      await this.left(socket, "left");
      try {
        socket.close(REFUSED_CLOSE_CODE, "game_not_open_to_player");
      } catch {
        // Already closed.
      }
    }
  }

  /** The game's own game server keeps failing (stuck in a loop, say): end the match rather than freeze it. */
  private broken(): void {
    console.error(`Game server for ${this.meta?.slug} stopped working; ending room ${this.meta?.roomCode}`);
    this.isBroken = true;
    this.room()?.end("This game's server stopped working.");
    void this.finish();
  }

  /** Save a turn-based room's state after each change, so it can sleep between moves. */
  private async save(): Promise<void> {
    const core = this.core;
    if (core?.ended) await this.finish();
    if (!core || this.hasEnded || core.ticking || !core.dirty) return;
    this.usage.messageCount += core.messageCount;
    core.messageCount = 0;
    core.dirty = false;
    this.saved = core.state;
    await this.ctx.storage.put("saved", { state: core.state, usage: this.usage } satisfies Saved);
  }

  private refuse(socket: WebSocket, code: RoomErrorCode, message?: string): void {
    socket.serializeAttachment({ stage: "gone" } satisfies Attachment);
    try {
      socket.send(errorMessage(code, message));
      socket.close(REFUSED_CLOSE_CODE, code);
    } catch {
      // Already closed.
    }
  }

  /** Open sockets of players in the room, optionally just one player's. */
  private sockets(playerId?: string): WebSocket[] {
    return this.ctx.getWebSockets().filter((socket) => {
      const attachment = socket.deserializeAttachment() as Attachment | null;
      return attachment?.stage === "in" && (playerId === undefined || attachment.id === playerId);
    });
  }

  private dropStaleHellos(): void {
    const nowMs = Date.now();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as Attachment | null;
      if (attachment?.stage === "hello" && nowMs - (attachment.connectedAtMs ?? 0) > HELLO_MS) this.refuse(socket, "no_hello");
      // Sockets already refused but not yet gone don't hold a place.
    }
  }
}
