import { DurableObject } from "cloudflare:workers";
import {
  ENDED_CLOSE_CODE,
  ERROR_TEXT,
  HOSTING_PAUSED_END_MESSAGE,
  NO_ANSWER_CLOSE_CODE,
  PassError,
  REMOVED_CLOSE_CODE,
  ROOM_LIMITS,
  ROOM_TUNING,
  VERSION_UPDATE_CLOSE_CODE,
  RoomCore,
  addTraffic,
  chatSettingsOf,
  checkRoomData,
  clientIdle,
  errorMessage,
  noTraffic,
  readChatMessage,
  restoreInfoOf,
  tidyRoomInfo,
  verifyPass,
  type ChatClientMessage,
  type ClientIdle,
  type GameServer,
  type PlayerChatSettings,
  type MoveAnswer,
  type MoveAsk,
  type Player,
  type PlayerKind,
  type RoomErrorCode,
  type RoomInfo,
  type RoomStart,
  type RoomTraffic,
  type SavedRoom,
  type ServerMessage,
} from "@zaisma/game-server/internal";
import { MAXIMUM_GAME_STORAGE_SIZE_BYTES, MATCH_FINISH_DURATION_SEC, type MatchUpdateMode, blocksAmong, gameStorageSizeBytes, friendsAmong, gameServerOf, isOldEnoughFor, noteQuickJoin, isHostingPaused, accountUsernameOf, type AccountRequirement, type AgeBand, type MultiplayerMode, type PrintedLogLine } from "@zaisma/core";
import { gameServer } from "./registry.ts";
import { gameDatabase, gameDatabaseObject } from "./database.ts";
import { SANDBOX, errorLine, isGameStartError, linesOf, sandboxServer, type SandboxServer, type SandboxStats } from "./sandbox.ts";
import { LogWriter } from "./logs.ts";
import { AwakeTime, countingDatabase, countingStorage } from "./usage-counts.ts";
import { roomPurchaseHandling } from "./purchases.ts";
import { filterChatMessage } from "./chat-filter.ts";
import { secretsForGameServer } from "./secrets.ts";
import { signingKey, type Env } from "./index.ts";

/** A socket's saved details, kept through hibernation. */
type Attachment =
  | { stage: "hello"; connectedAtMs: number; tester?: string }
  // tester: the tester link the player came through, which they can only play through while it's on.
  // seenAtMs: about when the player last sent a message (pings are answered without waking the room).
  // clientIdle: the idle check the player's game asked for, for game servers that leave it to the client.
  // kind: missing on players who joined before accounts got passes, all guests.
  // isSpectator: watching (maximumSpectatorCount), not playing: free, and never seated for friends' Join.
  // playCountedFromMs: where the player's time was last counted to (the hourly check-in), or joinedAtMs until then.
  | { stage: "in"; id: string; name: string; kind?: PlayerKind; joinedAtMs: number; tester?: string; seenAtMs?: number; clientIdle?: ClientIdle; isSpectator?: true; playCountedFromMs?: number }
  | { stage: "gone" };

interface Meta {
  gameId: string;
  slug: string;
  server: string;
  /** The game version a room started on: a sandboxed game server keeps running it until the room ends. */
  versionId?: string;
  roomCode: string;
  /** The country and continent the room's first player connected from, which is roughly where the room runs. */
  country?: string | null;
  continent?: string | null;
}

interface Saved {
  /** A turn-based room's state; a real-time room's is in stateChunkCount keys of its own (stateChunk:<index>). */
  state?: unknown;
  hasEnded?: boolean;
  usage?: Usage;
  /** When a real-time room's state was saved. */
  savedAtMs?: number;
  /** How many stateChunk:<index> keys a real-time room's state, as JSON, is split into. */
  stateChunkCount?: number;
  /** The players in a real-time room's match when it was saved, who come back as away if they aren't connected. */
  matchPlayers?: Player[];
  /** The game version that saved it: a room that switched versions (match_update_mode "now") tells onRestored. */
  versionId?: string;
  /** Saved as the room emptied (or found empty after a restart): onRestored hears nothing was lost, however long it slept. */
  isSavedEmpty?: boolean;
}

/** A version published "now" this room is moving to: when it switches at the latest, and whether players' games reload. */
interface PendingVersionUpdate {
  versionId: string;
  appliesAtMs: number;
  isReloading: boolean;
}

/** What the room has used since it last recorded it (recordUsage), kept with a sleeping room's state. */
interface Usage {
  roomPlayDurationSec: number;
  messageCount: number;
  /** The game's own game server running, for the hosting meter (missing in rooms saved before it, like the counts after it). */
  gameServerCpuDurationMs?: number;
  traffic?: RoomTraffic;
  /** The time the room was awake (AwakeTime), in ms. */
  roomAwakeDurationMs?: number;
  /** Players connecting (spectators aren't counted). */
  roomConnectionCount?: number;
  /** Times the room woke on its own (its alarm), was called by another room or Zaisma, or called the game's object. */
  objectRequestCount?: number;
  /** Rows the room wrote for the game: its storage, its listing, seats, logs and usage. */
  bookkeepingWrittenRowCount?: number;
  /** Sessions the room opened with its game server, and the time opening them took. */
  gameServerSessionCount?: number;
  gameServerStartupCpuDurationMs?: number;
  /** Files of the game server's logs written. */
  logFileCount?: number;
}

/** Nothing used yet. */
const noUsage = (): Usage => ({
  roomPlayDurationSec: 0,
  messageCount: 0,
  gameServerCpuDurationMs: 0,
  traffic: noTraffic(),
  roomAwakeDurationMs: 0,
  roomConnectionCount: 0,
  objectRequestCount: 0,
  bookkeepingWrittenRowCount: 0,
  gameServerSessionCount: 0,
  gameServerStartupCpuDurationMs: 0,
  logFileCount: 0,
});

/** Message types a room adds to room_message_types each time it records its use: its biggest, each way. */
const RECORDED_MESSAGE_TYPE_COUNT = 10;

/** A player must send their pass this soon after connecting. */
const HELLO_MS = 5000;
/** Extra sockets allowed past maximumPlayerCount and maximumSpectatorCount, and how many may be still saying hello at once. */
const SPARE_SOCKET_COUNT = 4;
/** How often a running room re-checks that its game is still live, so takedowns close rooms. */
const CHECK_MS = 60_000;
/** How often a room with players who came through tester links checks those links are still on. */
const TESTER_CHECK_MS = 10_000;
/** An empty room's saved state is deleted after this, unless the room is kept (room.setKept). */
const KEEP_EMPTY_MS = 24 * 3600 * 1000;
/** How long a reserved room waits for its players before it's cleared. */
const RESERVED_DURATION_MS = 600_000;
/** What a kept room's game server's log says when the game's storage is too full to keep another. */
const KEEP_REFUSED_TEXT = `Zaisma: this room can't be kept, because this game's storage is full at its ${MAXIMUM_GAME_STORAGE_SIZE_BYTES / 1024 ** 3} GB. Delete kept rooms (zaisma kept-rooms) or database rows to make room.`;
/** What players in a kept room hear when its developer deletes it. */
const KEPT_ROOM_DELETED_MESSAGE = "This world was deleted.";
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
/** How often a room with players checks whether its game's hosting paused, to start the hour its match gets to finish. */
const HOSTING_CHECK_MS = 5 * 60_000;
/**
 * How often a real-time room copies its sandboxed game server's state, never while a copy is under way:
 * a fresh session after a failure carries on from the last copy, so a match loses at most this much.
 */
const STATE_COPY_INTERVAL_MS = 5000;
/**
 * A real-time room's saved state, as JSON, is split into keys of this many characters: under the 2 MB a
 * stored value may be, even for text that takes two bytes a character, and a 32 MB state in under 128
 * keys, which one put writes at once.
 */
const STATE_CHUNK_CHARACTER_COUNT = 512 * 1024;
const stateChunkKey = (index: number) => `stateChunk:${index}`;
/** Storage keys a kept room's backup reads at a time: a few state chunks of 512K characters each at most. */
const BACKUP_PAGE_KEY_COUNT = 8;
/** Storage keys a restore puts at once: the most one put takes. */
const RESTORE_PUT_KEY_COUNT = 128;
/** Where each player's owned items wait out hibernation: ownedItemNames:<player id>. */
const OWNED_ITEM_NAMES_KEY_PREFIX = "ownedItemNames:";


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
  /** Set while the game's sandboxed game server failed its last start on Zaisma's side: the room answers busy (try again), not gone. */
  private hasStartFailed = false;
  /** What the game's own server printed in this room, waiting to go to the game's logs (logs.ts). */
  private logs: LogWriter | null = null;
  private hasEnded = false;
  private usage: Usage = noUsage();
  /** The room's awake time as Cloudflare bills it, and its storage and D1 as the meter counts their writes. */
  private readonly awake = new AwakeTime();
  private readonly storage: DurableObjectStorage;
  private readonly db: D1Database;
  /** A real-time room's last copy of its sandboxed game server's state (STATE_COPY_INTERVAL_MS). */
  private stateCopy: unknown = undefined;
  /** When the room last took that copy, as it saves its state too. */
  private stateCopiedAtMs = 0;
  /** A real-time room's save under way, so saves never overlap. */
  private stateSaving: Promise<void> | null = null;
  /** What a real-time room last saved (its state as JSON and its match's players), so an unchanged one isn't written again. */
  private savedStateKey: string | null = null;
  /** How many stateChunk:<index> keys the room's storage has. */
  private stateChunkCount = 0;
  /** When the room's saved real-time state was saved, the players in its match then, and the version that saved it (Saved). */
  private savedAtMs: number | undefined = undefined;
  private matchPlayers: Player[] = [];
  private savedVersionId: string | undefined = undefined;
  /** A version published "now" the room is moving to, kept so a room that sleeps meanwhile still switches. */
  private pendingVersionUpdate: PendingVersionUpdate | null = null;
  private versionUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set once the room said its state is too big to save, so it says so once. */
  private hasReportedStateSize = false;
  /** The game server loading, so players reconnecting at once share one (a sandbox opens one session). */
  private loading: Promise<GameServer | null> | null = null;
  /**
   * The room's sockets of players and spectators in it, by player ID, the accounts among the players, and
   * the spectators' IDs; rebuilt after any socket comes in or goes.
   */
  private socketIndex: { byPlayerId: Map<string, WebSocket[]>; accountPlayerIds: string[]; spectatorIds: Set<string> } | null = null;
  private saved: unknown = undefined;
  private savedRoom: SavedRoom | undefined = undefined;
  /**
   * The items each player in the room owns, from the pass they joined with (Player.ownedItemNames), kept in
   * storage under ownedItemNamesKey so players rebuilt after hibernation keep them: a socket's attachment is
   * too small for up to 1,000 names.
   */
  private ownedItemNamesByPlayerId = new Map<string, string[]>();
  private lastCheckAtMs = 0;
  private lastTesterCheckAtMs = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** A room that ticks slower than it probes probes on this timer too, so its players hear from it every probe interval. */
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  /** The seat registry call for the game's object failed and was logged, so a lasting failure logs once. */
  private hasLoggedSeatFailure = false;
  /** The game's room browsing setting, read with its status; null until read since waking. */
  private browsing: string | null = null;
  /** What the game needs an account for, read with its status: guests can't join unless it's none. */
  private accountRequirement: AccountRequirement = "none";
  /** The youngest age that can play, read with its status: younger accounts can't join, and leave when it rises. */
  private minimumPlayerAgeYears = 13;
  /** What this room last wrote to live_rooms ("" for no row), so unchanged rooms don't write again. */
  private listedAs: string | undefined = undefined;
  /** The seats this room last told its game's object (who is in the match, who is playing), so unchanged ones aren't sent again; undefined when it doesn't know. */
  private syncedSeatsAs: string | undefined = undefined;
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
  /** When the room last checked whether its game's hosting paused. */
  private hostingCheckedAtMs = 0;
  /** Kept (room.setKept), as this room accepted it and kept_rooms has it: it sleeps with its state when everyone leaves. */
  private isKept = false;
  /** The room's saved state was saved as it emptied (Saved.isSavedEmpty). */
  private isSavedEmpty = false;
  /** About how many bytes the room's saved state takes, for kept_rooms. */
  private savedSizeBytes = 0;
  /** The game's live version, read with its status: an empty kept room wakes on it. */
  private liveVersionId: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.storage = countingStorage(ctx.storage, (writtenRowCount) => this.countWritten(writtenRowCount));
    this.db = countingDatabase(env.DB, (writtenRowCount) => this.countWritten(writtenRowCount));
    // Games ping every 25 seconds or so; the answer doesn't wake the room, and the time is kept per socket.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.blockConcurrencyWhile(() => this.readStored());
  }

  /** Reads what the room keeps into memory: when it wakes, and again after a restore puts its world back. */
  private async readStored(): Promise<void> {
    const got = await this.ctx.storage.get<Meta | Saved | SavedRoom | number | string[] | PendingVersionUpdate>(["meta", "saved", "room", "checkedInAtMs", "hostingCheckedAtMs", "seatedPlayerIds", "versionUpdate"]);
    this.pendingVersionUpdate = (got.get("versionUpdate") as PendingVersionUpdate | undefined) ?? null;
    this.meta = (got.get("meta") as Meta | undefined) ?? null;
    const saved = (got.get("saved") as Saved | undefined) ?? {};
    this.saved = saved.state;
    this.savedRoom = got.get("room") as SavedRoom | undefined;
    this.hasEnded = saved.hasEnded ?? false;
    this.usage = { ...noUsage(), ...saved.usage };
    this.savedVersionId = saved.versionId;
    this.isSavedEmpty = saved.isSavedEmpty === true;
    this.isKept = this.savedRoom?.isKept === true && !this.hasEnded;
    // A turn-based room saved for a version switch keeps its state in "saved", with when and who.
    if (!saved.stateChunkCount && saved.savedAtMs !== undefined) {
      this.savedAtMs = saved.savedAtMs;
      this.matchPlayers = saved.matchPlayers ?? [];
    }
    // A real-time room's state, saved in pieces with one put, so a restart never reads half a save.
    if (saved.stateChunkCount) {
      const keys = Array.from({ length: saved.stateChunkCount }, (_, index) => stateChunkKey(index));
      const chunks = await this.ctx.storage.get<string>(keys);
      const text = keys.map((key) => chunks.get(key) ?? "").join("");
      try {
        this.saved = JSON.parse(text);
        this.savedAtMs = saved.savedAtMs;
        this.matchPlayers = saved.matchPlayers ?? [];
        this.savedStateKey = stateKeyOf(text, this.matchPlayers);
        this.savedSizeBytes = utf8SizeBytes(text);
      } catch (error) {
        console.error("Couldn't read the room's saved state:", error);
      }
      this.stateChunkCount = saved.stateChunkCount;
    }
    this.checkedInAtMs = (got.get("checkedInAtMs") as number | undefined) ?? 0;
    this.hostingCheckedAtMs = (got.get("hostingCheckedAtMs") as number | undefined) ?? 0;
    this.seatedPlayerIds = got.get("seatedPlayerIds") as string[] | undefined;
    this.alarmAtMs = await this.ctx.storage.getAlarm();
    for (const [key, names] of await this.ctx.storage.list<string[]>({ prefix: OWNED_ITEM_NAMES_KEY_PREFIX })) this.ownedItemNamesByPlayerId.set(key.slice(OWNED_ITEM_NAMES_KEY_PREFIX.length), names);
  }

  async fetch(request: Request): Promise<Response> {
    this.noteAwake();
    // A call from another room or Zaisma; anything else is a player connecting (spectators are taken off once they say so).
    if (request.method === "POST") this.usage.objectRequestCount = (this.usage.objectRequestCount ?? 0) + 1;
    else this.usage.roomConnectionCount = (this.usage.roomConnectionCount ?? 0) + 1;
    // Another room of the same game reserving this one (only rooms can reach this; players' requests are WebSockets).
    if (request.method === "POST" && new URL(request.url).pathname === "/reserve") return this.reserved(request);
    if (request.method === "POST" && new URL(request.url).pathname === "/expect") return this.expecting(request);
    if (request.method === "POST" && new URL(request.url).pathname === "/unseat") return this.unseating(request);
    if (request.method === "POST" && new URL(request.url).pathname === "/version-update") return this.versionUpdating(request);
    if (request.method === "POST" && new URL(request.url).pathname === "/delete") return this.deleting(request);
    if (request.method === "POST" && new URL(request.url).pathname === "/backup") return this.backingUp(request);
    if (request.method === "POST" && new URL(request.url).pathname === "/restore") return this.restoring(request);
    if (!this.meta || !this.meta.roomCode) {
      this.meta = {
        gameId: request.headers.get("x-game-id")!,
        slug: request.headers.get("x-game-slug")!,
        server: request.headers.get("x-game-server")!,
        versionId: request.headers.get("x-game-version") ?? undefined,
        ...this.meta,
        roomCode: request.headers.get("x-room-code")!,
        country: this.meta?.country ?? (request.headers.get("x-room-country") || null),
        continent: this.meta?.continent ?? (request.headers.get("x-room-continent") || null),
      };
      await this.storage.put("meta", this.meta);
    }
    if (this.isKept) await this.wakeKeptOnLiveVersion();
    const server = await this.load();
    // 404 when the game is gone or its game server can't start (no file, or its own code refuses); a start that failed on Zaisma's side answers 503, which the Worker says as busy so the SDK tries again.
    if (!server) return new Response("This game isn't available right now", { status: this.hasStartFailed ? 503 : 404 });

    this.dropStaleHellos();
    const maximumSocketCount = (server.maximumPlayerCount ?? ROOM_LIMITS.defaultMaximumPlayerCount) + (server.maximumSpectatorCount ?? 0) + SPARE_SOCKET_COUNT;
    // Only sockets of players and spectators fill the room. Sockets still saying hello have a few places of their own, and when those are taken the oldest is let go, so connections that never show a pass can't turn real players away.
    const sayingHello: { socket: WebSocket; connectedAtMs: number }[] = [];
    let inCount = 0;
    for (const existing of this.ctx.getWebSockets()) {
      const attachment = existing.deserializeAttachment() as Attachment | null;
      if (attachment?.stage === "in") inCount++;
      else if (attachment?.stage === "hello") sayingHello.push({ socket: existing, connectedAtMs: attachment.connectedAtMs ?? 0 });
    }
    if (inCount >= maximumSocketCount) return new Response("This room is full", { status: 409 });
    sayingHello.sort((first, second) => first.connectedAtMs - second.connectedAtMs);
    while (sayingHello.length >= SPARE_SOCKET_COUNT) this.refuse(sayingHello.shift()!.socket, "no_hello");

    const { 0: client, 1: socket } = new WebSocketPair();
    this.ctx.acceptWebSocket(socket);
    const tester = request.headers.get("x-tester-link") || undefined;
    socket.serializeAttachment({ stage: "hello", connectedAtMs: Date.now(), ...(tester ? { tester } : {}) } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = socket.deserializeAttachment() as Attachment;
    if (attachment.stage === "hello") {
      this.noteAwake();
      return typeof message === "string" ? this.hello(socket, message) : this.refuse(socket, "no_hello");
    }
    if (attachment.stage !== "in") return;
    // Spectators are free: their messages don't keep the room awake on the meter.
    if (!attachment.isSpectator) this.noteAwake();

    // Pings never get here; any other message shows the player is still connected.
    const nowMs = Date.now();
    if (nowMs - (attachment.seenAtMs ?? attachment.joinedAtMs ?? 0) > SEEN_MS) socket.serializeAttachment({ ...attachment, seenAtMs: nowMs } satisfies Attachment);

    await this.load();
    const core = this.room();
    if (!core) return;
    if (Date.now() - this.lastCheckAtMs > CHECK_MS && !(await this.gameStillLive())) return;
    if (Date.now() - this.lastTesterCheckAtMs > TESTER_CHECK_MS) await this.testerLinksStillOn();
    if ((socket.deserializeAttachment() as Attachment).stage !== "in") return;
    // Chat goes through Zaisma's filter on its way, so the room takes it before the game's messages.
    const chat = typeof message === "string" ? readChatMessage(message) : null;
    if (chat) return this.chat(socket, core, attachment.id, chat);
    const startedCount = core.handlerStartCount;
    const errorCode = typeof message === "string" ? core.receive(attachment.id, message) : core.receiveBytes(attachment.id, new Uint8Array(message));
    if (errorCode) socket.send(errorMessage(errorCode));
    // A ticking room whose game server only queues input: plain input and probe answers start no handler, and the next tick applies them, so each need not wait on a busy room.
    if (core.queuesInput && core.handlerStartCount === startedCount) return;
    await this.settle(core);
  }

  /**
   * A player's chat message (room.chat): the room checks it and asks the game server's onChat (startChat),
   * Zaisma's filter looks, and it goes to those who may read it (deliverChat) or the sender hears why not
   * (stopChat). Nobody may read it: nothing to check, and the sender still hears it went.
   */
  private async chat(socket: WebSocket, core: RoomCore, playerId: string, chat: ChatClientMessage): Promise<void> {
    const started = await core.startChat(playerId, chat);
    if (!started || !this.meta) return;
    let answer: { isAllowed: boolean; reason: string | null; message: string | null; hasSwearing: boolean; hasSlur: boolean } = { isAllowed: true, reason: null, message: null, hasSwearing: false, hasSlur: false };
    if (started.receiverPlayerIds.length) {
      try {
        answer = await filterChatMessage(this.env, {
          gameId: this.meta.gameId,
          text: started.text,
          senderPlayerId: playerId,
          receiverPlayerIds: started.receiverPlayerIds,
          recentTexts: started.recentTexts,
          source: "rooms",
          isAdultFilterEnabled: core.server.adultChatFilterEnabled === true,
        });
      } catch (error) {
        console.error("Couldn't filter a chat message:", error);
        socket.send(errorMessage("busy", undefined, { chatNumber: chat.chatNumber }));
        return;
      }
    }
    if (answer.isAllowed) core.deliverChat(playerId, chat.chatNumber, started.receiverPlayerIds, { text: started.text, hasSwearing: answer.hasSwearing, hasSlur: answer.hasSlur });
    else core.stopChat(playerId, chat.chatNumber, answer.reason ?? "not_allowed_to_chat", answer.message ?? "");
  }

  async webSocketClose(socket: WebSocket, code: number): Promise<void> {
    this.noteAwake();
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
    this.noteAwake();
    this.usage.objectRequestCount = (this.usage.objectRequestCount ?? 0) + 1;
    this.alarmAtMs = null;
    if (this.pendingVersionUpdate && this.pendingVersionUpdate.appliesAtMs <= Date.now()) await this.applyVersionUpdate();
    // The sockets are read afresh at each check, in case any went without the room hearing.
    this.socketIndex = null;
    if (this.logs?.hasWaitingLines) await this.logs.write();
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
      // The hour the match got to finish, once the game's hosting paused, is up.
      if (core && !this.hasEnded && core.endsAt !== null && Date.parse(core.endsAt) <= Date.now()) {
        core.end(HOSTING_PAUSED_END_MESSAGE, "hosting_paused");
        await this.finish();
        return;
      }
      // The checks first, then the wait for the game server: a busy ticking room's handlers can run long, and must not hold back the hosting check, the usage or the hourly check-in.
      if (core && !this.hasEnded) {
        core.sweep();
        if (Date.now() - this.hostingCheckedAtMs >= HOSTING_CHECK_MS) await this.checkHosting(core);
      }
      if (this.hasUnrecordedError) {
        this.hasUnrecordedError = false;
        await this.recordUsage(false);
      }
      if (this.sockets().length && Date.now() - this.checkedInAtMs >= CHECK_IN_MS) {
        if (await this.gameStillLive()) await this.list(true);
        await this.touchSeats();
        // A kept world's size, for the game's storage, at most hourly rather than with every save.
        if (this.isKept) await this.keepRow();
        // A long match's player time, game server health and the rest of its use shouldn't wait for the room to empty.
        this.countPlayTime();
        await this.recordUsage(false);
        // Also when the room has no row to touch (everyone walked away).
        this.checkedInAtMs = Date.now();
        await this.storage.put("checkedInAtMs", this.checkedInAtMs);
      }
      if (core && !this.hasEnded) {
        await this.settle(core);
        if (this.isRowStale) await this.list();
      }
      return;
    }
    if (await this.reconnecting()) return;
    await this.seat();
    // A kept room sleeps with its state and no alarm, so it costs only its storage until someone joins.
    if (this.isKept && !this.hasEnded) return this.sleepKept();
    await this.unlist();
    const emptiedAtMs = await this.storage.get<number>("emptiedAtMs");
    if (emptiedAtMs === undefined) {
      await this.storage.put("emptiedAtMs", Date.now());
      await this.setAlarm(Date.now() + KEEP_EMPTY_MS);
    } else if (Date.now() - emptiedAtMs >= KEEP_EMPTY_MS) {
      await this.storage.deleteAll();
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
    await this.wakeForReconnects(core);
  }

  /** Wake when the first player whose connection dropped runs out of time to come back, so the game hears they left. */
  private async wakeForReconnects(core: RoomCore): Promise<void> {
    const deadlineMs = core.ended ? null : core.nextReconnectDeadlineMs();
    if (deadlineMs !== null) await this.wake(deadlineMs);
  }

  /**
   * A room with nobody connected whose players' connections dropped: those whose time to come back ran
   * out leave the match, and it wakes again for the rest. False once nobody is reconnecting, so it
   * empties as usual. A turn-based room that slept meanwhile finds them in its saved room.
   */
  private async reconnecting(): Promise<boolean> {
    if (this.hasEnded || (!this.core && !Object.keys(this.savedRoom?.reconnecting ?? {}).length)) return false;
    await this.load();
    const core = this.room();
    if (!core || core.ended || core.nextReconnectDeadlineMs() === null) return false;
    core.sweep();
    await this.settle(core);
    return core.nextReconnectDeadlineMs() !== null;
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
    await this.storage.setAlarm(alarmAtMs);
  }

  /**
   * Set this room up for the players another room reserved it for: closed to everyone else, hidden
   * unless the game listed it, and starting with the game's data. A room that's already in use says no.
   */
  private async reserved(request: Request): Promise<Response> {
    if (this.meta || this.savedRoom) return new Response("This room is taken", { status: 409 });
    const gameId = request.headers.get("x-game-id")!;
    if ((await isHostingPaused(this.db, gameId)).isPaused) return new Response(ERROR_TEXT.hosting_paused, { status: 403 });
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
      reservedPlayerIds: start.playerIds,
      setupData: start.setupData ?? null,
      ...(start.keptOut ? { keptOut: start.keptOut } : {}),
      ...(typeof start.lobbyRoomCode === "string" && start.lobbyRoomCode ? { lobbyRoomCode: start.lobbyRoomCode } : {}),
    };
    // Like an empty room, but cleared after RESERVED_DURATION_MS if nobody comes, as on the Node runner.
    const nowMs = Date.now();
    await this.storage.put({ meta: this.meta, room: this.savedRoom, emptiedAtMs: nowMs - KEEP_EMPTY_MS + RESERVED_DURATION_MS });
    await this.setAlarm(nowMs + RESERVED_DURATION_MS);
    return new Response(null, { status: 204 });
  }

  /**
   * Another room of the same game sends players here (room.moveTo): the game server decides who it
   * takes, and holds a seat for each for a minute. A room that isn't running takes nobody.
   */
  private async expecting(request: Request): Promise<Response> {
    if (!this.meta?.roomCode || this.hasEnded || this.meta.gameId !== request.headers.get("x-game-id")) return new Response("No such room", { status: 404 });
    const ask = (await request.json()) as MoveAsk;
    const players = Array.isArray(ask?.players) ? ask.players.filter((player) => typeof player?.id === "string" && typeof player?.name === "string" && (player.kind === "guest" || player.kind === "account")).slice(0, ROOM_LIMITS.maximumPlayerCount) : [];
    if (typeof ask?.fromRoomCode !== "string" || !players.length) return new Response("Bad request", { status: 400 });
    if (!(await this.load()) || !(await this.gameStillLive())) return new Response("No such room", { status: 404 });
    const core = this.room();
    if (!core) return new Response("No such room", { status: 404 });
    const answer = await core.expect({ fromRoomCode: ask.fromRoomCode, players: players.map((player) => ({ id: player.id, name: player.name, kind: player.kind })), joinData: ask.joinData ?? null });
    await core.settled();
    this.savedRoom = core.saved;
    await this.storage.put("room", this.savedRoom);
    await this.save();
    // The seat held for them counts towards how full the room looks, now.
    await this.list();
    return Response.json(answer);
  }

  /**
   * The game's object says this player joined another room of the game past what the game allows
   * (maximumRoomCountPerPlayer): their seat here is given up, and they hear "Joined from somewhere else".
   * A player this room doesn't have is no mistake: it answers 200 and does nothing.
   */
  private async unseating(request: Request): Promise<Response> {
    const ok = () => new Response(null, { status: 200 });
    if (!this.meta?.roomCode || this.hasEnded || this.meta.gameId !== request.headers.get("x-game-id")) return ok();
    const asked = (await request.json().catch(() => null)) as { playerId?: unknown } | null;
    if (typeof asked?.playerId !== "string") return new Response("Bad request", { status: 400 });
    const playerId = asked.playerId;
    const playerSockets = this.sockets(playerId).filter((socket) => !(socket.deserializeAttachment() as Attachment & { stage: "in" }).isSpectator);
    if (!playerSockets.length && !this.core) return ok();
    // Built while their sockets still count, as a sleeping room is rebuilt from its connections.
    if (!(await this.load())) return ok();
    const core = this.room();
    if (!core) return ok();
    for (const socket of playerSockets) {
      this.retire(socket);
      try {
        socket.close(REMOVED_CLOSE_CODE, "Joined from somewhere else");
      } catch {
        // Already closed.
      }
    }
    // They chose to go: no seat is held for them here.
    core.leave(playerId, "left");
    if (this.playerSockets().length === 0) this.dismissSpectators();
    if (this.sockets().length === 0) {
      await core.settled();
      await this.emptied();
    } else await this.settle(core);
    return ok();
  }

  /**
   * A player came into this room on their own: tell the game's object, which closes their seat in the
   * game's other rooms past what the game allows. It never holds up their welcome, and a failure leaves
   * them seated (a join must not fail on bookkeeping; the connection limits are the backstop).
   */
  private async takeSeat(playerId: string, maximumRoomCountPerPlayer: number): Promise<void> {
    const meta = this.meta;
    if (!meta?.roomCode) return;
    try {
      const { roomCodesToLeave } = await this.callGameObject().get(this.env.GAME_SERVER_OBJECTS.idFromName(meta.gameId)).seat(meta.gameId, meta.roomCode, playerId, maximumRoomCountPerPlayer);
      await Promise.all(
        roomCodesToLeave.map((roomCode) =>
          this.env.ROOMS.get(this.env.ROOMS.idFromName(`${meta.slug}:${roomCode}`)).fetch("https://room/unseat", { method: "POST", headers: { "x-game-id": meta.gameId }, body: JSON.stringify({ playerId }) }),
        ),
      );
    } catch (error) {
      console.error("Couldn't give up the player's other seats:", error);
    }
  }

  private async hello(socket: WebSocket, text: string): Promise<void> {
    const tester = (socket.deserializeAttachment() as Attachment & { stage: "hello" }).tester;
    let pass: unknown;
    let made: { isListed?: boolean; friendJoinsEnabled?: boolean; joinData?: unknown; clientIdle?: ClientIdle } & RoomInfo = {};
    // From quickJoin: rather another room than one with someone this player blocked.
    let avoidsBlockedPlayers = false;
    // From quickJoin at all: the game joins players by itself, which its Rooms tab says.
    let isQuickJoin = false;
    // The version the player's game runs (from Zaisma's SDK), or null when it didn't say.
    let helloVersionId: string | null = null;
    // Come to watch, not to play (joinRoom({ isSpectator: true })).
    let isSpectator = false;
    try {
      const hello = JSON.parse(text) as { type?: unknown; pass?: unknown; joinData?: unknown; room?: { isListed?: unknown; friendJoinsEnabled?: unknown; name?: unknown; labels?: unknown }; avoidBlockedPlayers?: unknown; isQuickJoin?: unknown; versionId?: unknown; isSpectator?: unknown };
      if (hello.type !== "hello") return this.refuse(socket, "no_hello");
      pass = hello.pass;
      isSpectator = hello.isSpectator === true;
      // Spectators are free: their connection comes off the meter.
      if (isSpectator) this.usage.roomConnectionCount = Math.max(0, (this.usage.roomConnectionCount ?? 0) - 1);
      helloVersionId = typeof hello.versionId === "string" && hello.versionId ? hello.versionId : null;
      avoidsBlockedPlayers = hello.avoidBlockedPlayers === true;
      isQuickJoin = hello.isQuickJoin === true;
      // The idle check the player's game asked for, for game servers that leave it to the client.
      made.clientIdle = clientIdle(hello);
      // How the player who makes the room sets it up; the room takes it only from them.
      const room = hello.room && typeof hello.room === "object" ? hello.room : {};
      made = { ...made, ...(room.isListed === true ? { isListed: true } : {}), ...(room.friendJoinsEnabled === false ? { friendJoinsEnabled: false } : {}), ...tidyRoomInfo(room as RoomInfo) };
      // What the player brings for the game server's onJoin, like the character they picked.
      const checked = checkRoomData(hello.joinData, ROOM_LIMITS.maximumJoinDataSizeBytes);
      if (!checked.isValid) return this.refuse(socket, "too_big");
      made.joinData = checked.checkedData;
    } catch {
      return this.refuse(socket, "no_hello");
    }
    if (typeof pass !== "string") return this.refuse(socket, "no_hello");
    if (!this.meta) return this.refuse(socket, "game_unavailable");

    let player: Player;
    // Who the player may chat with, from their pass: the room keeps it, and the game never sees it.
    let chatSettings: PlayerChatSettings | null = null;
    try {
      const claims = await verifyPass(pass, [(await signingKey(this.env)).publicKey], { gameSlug: this.meta.slug, issuerUrl: this.env.ISSUER });
      chatSettings = chatSettingsOf(claims);
      // An account's pass is proof only: its name comes from its profile, and a deleted account's pass stops working.
      const name = claims.kind === "account" ? await accountUsernameOf(this.db, claims.sub) : claims.name;
      if (!name) return this.refuse(socket, "bad_pass");
      player = { id: claims.sub, name, kind: claims.kind === "account" ? "account" : "guest", ...(claims.owned_item_names?.length ? { ownedItemNames: claims.owned_item_names } : {}) };
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
      const account = await this.db.prepare("SELECT age_band FROM accounts WHERE player_id = ?").bind(player.id).first<{ age_band: AgeBand }>();
      if (!account || !isOldEnoughFor(account.age_band, this.minimumPlayerAgeYears)) return this.refuse(socket, "game_not_open_to_player");
    }
    await this.load();
    const core = this.room();
    if (!core) return this.refuse(socket, "game_unavailable");
    // A spectator watches a match: one with nobody in it isn't running, and a spectator never starts one.
    if (isSpectator && core.players.size === 0) return this.refuse(socket, "room_not_running");
    // A player always plays the version their room runs: a newcomer whose game runs another one reloads at the
    // room's first (the game domain serves it to the room's players). Players already in the room come back in
    // whatever they run, so a reconnect never bounces them out of their match; built-in game servers have no version.
    const roomVersionId = this.meta.server === SANDBOX ? this.meta.versionId : undefined;
    if (roomVersionId && helloVersionId && helloVersionId !== roomVersionId && !core.players.has(player.id) && !core.spectators.has(player.id) && !core.expects(player.id)) {
      return this.refuse(socket, "other_version", undefined, { versionId: roomVersionId });
    }
    // Once its game's hosting pauses, a room takes back only players it knows or is holding a place for, and its match gets an hour to finish.
    if (!core.players.has(player.id) && !core.spectators.has(player.id) && !core.expects(player.id) && (await this.checkHosting(core))) return this.refuse(socket, "hosting_paused");
    // Blocks between this account and the players the room remembers, found afresh, so one taken back since is gone.
    // Spectators send nothing, so nothing of theirs reaches a player to block.
    if (player.kind === "account" && core.known.size > 0 && !isSpectator) {
      // The players in the match first: the lookups take the first 100, and a big room remembers more than that.
      const knownPlayerIds = [...core.players.keys(), ...[...core.known].filter((playerId) => !core.players.has(playerId))];
      const blocks = await blocksAmong(this.db, player.id, knownPlayerIds);
      // quickJoin prefers rooms without anyone the player blocked, and comes back here only when nothing else fits.
      if (avoidsBlockedPlayers && blocks.some((block) => block.blocker_player_id === player.id && core.players.has(block.blocked_player_id))) return this.refuse(socket, "blocked_player_here");
      core.setAccountBlocks(player.id, blocks.map((block) => (block.blocker_player_id === player.id ? block.blocked_player_id : block.blocker_player_id)));
      // And friends among them, for the game server's room.areFriends.
      core.setFriends(player.id, await friendsAmong(this.db, player.id, knownPlayerIds));
    }
    // The room's rules and the game's canJoin, before anyone hears about this player.
    const admitted = await core.admit(player, made.joinData, { isSpectator });
    // Spectators send nothing, chat included.
    if (admitted.isAllowed) core.setChatSettings(player.id, isSpectator ? null : chatSettings);
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
      other.close(REMOVED_CLOSE_CODE, "Joined from somewhere else");
    }
    await this.keepOwnedItemNames(player);
    const nowMs = Date.now();
    socket.serializeAttachment({ stage: "in", id: player.id, name: player.name, kind: player.kind, joinedAtMs: nowMs, seenAtMs: nowMs, ...(tester ? { tester } : {}), clientIdle: made.clientIdle ?? {}, ...(isSpectator ? { isSpectator: true as const } : {}) } satisfies Attachment);
    this.socketIndex = null;
    // Players who come on their own take a seat; those the game moved here (or reserved this room for), reconnects and spectators don't.
    const takesSeat = !isSpectator && !core.players.has(player.id) && !core.isArrivingByMove(player.id);
    const joined = core.join(player, { ...made, isSpectator });
    if (!joined.isAllowed) return this.refuse(socket, joined.code, joined.message);
    if (takesSeat) this.ctx.waitUntil(this.takeSeat(player.id, core.maximumRoomCountPerPlayer));
    if (isQuickJoin && !this.isQuickJoinNoted) {
      this.isQuickJoinNoted = true;
      // Only a line of copy rides on it, so a busy database never holds up the player.
      await noteQuickJoin(this.db, this.meta.gameId).catch(() => (this.isQuickJoinNoted = false));
    }
    await core.settled();
    if (core.players.size === 1) await this.storage.delete("emptiedAtMs");
    await this.settle(core);
    await this.wake(Date.now() + SWEEP_MS);
  }

  /** Keeps what a joining player owns for when the room wakes from hibernation; a pass with nothing owned clears it. */
  private async keepOwnedItemNames(player: Player): Promise<void> {
    const key = `${OWNED_ITEM_NAMES_KEY_PREFIX}${player.id}`;
    if (player.ownedItemNames?.length) {
      this.ownedItemNamesByPlayerId.set(player.id, player.ownedItemNames);
      await this.storage.put(key, player.ownedItemNames);
    } else if (this.ownedItemNamesByPlayerId.delete(player.id)) {
      await this.storage.delete(key);
    }
  }

  /** A player as the room rebuilds them from a socket's attachment, with what they own. */
  private playerOf(attachment: { id: string; name: string; kind?: Player["kind"] }): Player {
    const ownedItemNames = this.ownedItemNamesByPlayerId.get(attachment.id);
    return { id: attachment.id, name: attachment.name, kind: attachment.kind ?? "guest", ...(ownedItemNames ? { ownedItemNames } : {}) };
  }

  /** A player's connection closed: they left, or it was lost (the room then holds their seat a while). */
  private async left(socket: WebSocket, why: "left" | "lost"): Promise<void> {
    // A sleeping room is rebuilt from its connected sockets: build it while this player still counts as one, so the game hears them go.
    if ((socket.deserializeAttachment() as Attachment).stage === "in" && !this.core && (await this.load())) this.room();
    const attachment = this.retire(socket);
    if (attachment.stage !== "in") return;
    const core = this.sockets(attachment.id).length === 0 && (await this.load()) ? this.room() : null;
    core?.leave(attachment.id, why);
    if (this.playerSockets().length === 0) this.dismissSpectators();
    if (this.sockets().length === 0) {
      await core?.settled();
      await this.emptied();
    } else if (core) await this.settle(core);
  }

  /**
   * A room with only spectators left has no match to watch: they're told it ended and go, so the room
   * empties as when everyone leaves.
   */
  private dismissSpectators(): void {
    const text = JSON.stringify({ type: "ended", message: "The match ended.", endReason: "no_players" } satisfies ServerMessage);
    for (const socket of this.sockets()) {
      const attachment = this.retire(socket);
      if (attachment.stage === "in") this.core?.leave(attachment.id);
      try {
        socket.send(text);
        socket.close(ENDED_CLOSE_CODE, "Match ended");
      } catch {
        // Already closed.
      }
    }
  }

  /** Mark a socket as gone, counting the time its player spent in the room since the last check-in. Watching is free: a spectator's time isn't counted. */
  private retire(socket: WebSocket): Attachment {
    const attachment = socket.deserializeAttachment() as Attachment;
    if (attachment.stage === "in" && !attachment.isSpectator) this.usage.roomPlayDurationSec += Math.round((Date.now() - (attachment.playCountedFromMs ?? attachment.joinedAtMs ?? Date.now())) / 1000);
    socket.serializeAttachment({ stage: "gone" } satisfies Attachment);
    this.socketIndex = null;
    return attachment;
  }

  /** At the hourly check-in: each connected player's time so far into this.usage, counted from there on, so a long match reaches the meter hourly. */
  private countPlayTime(nowMs = Date.now()): void {
    for (const socket of this.sockets()) {
      const attachment = socket.deserializeAttachment() as Attachment;
      if (attachment.stage !== "in" || attachment.isSpectator) continue;
      this.usage.roomPlayDurationSec += Math.round((nowMs - (attachment.playCountedFromMs ?? attachment.joinedAtMs)) / 1000);
      socket.serializeAttachment({ ...attachment, playCountedFromMs: nowMs } satisfies Attachment);
    }
  }

  /** Everyone has gone: stop ticking, record usage, drop the room's row, and clean up after a day. */
  private async emptied(): Promise<void> {
    this.stopTicking();
    await this.recordUsage();
    await this.logs?.write();
    if (this.core && !this.core.ticking) this.core.dirty = true;
    // A real-time room saves once more, so one rejoined within the day (or a kept one, whenever) wakes as it was.
    await this.save(true, true);
    await this.seat();
    if (this.isKept && !this.hasEnded) {
      // Waits for whoever joins next: listed at nobody in it, with no alarm, unless dropped players may still come back.
      await this.sleepKept();
      if (this.core && this.core.nextReconnectDeadlineMs() !== null) {
        this.savedRoom = this.core.saved;
        await this.storage.put("room", this.savedRoom);
        await this.wakeForReconnects(this.core);
      } else this.forgetCore();
      return;
    }
    await this.unlist();
    await this.syncCoreSeats();
    await this.storage.put("emptiedAtMs", Date.now());
    await this.setAlarm(Date.now() + KEEP_EMPTY_MS);
    // Players whose connection dropped are still in the match: the room keeps them, and wakes when their time runs out.
    if (this.core && this.core.nextReconnectDeadlineMs() !== null) {
      this.savedRoom = this.core.saved;
      await this.storage.put("room", this.savedRoom);
      await this.wakeForReconnects(this.core);
    } else this.forgetCore();
  }

  /**
   * An emptied room forgets its running match once it's saved, so every rejoin wakes it from the save
   * (onRestored, as on your own server), whether the object stayed in memory or not. A state that
   * wasn't saved (too big) stays, since waking from nothing would start the match over.
   */
  private forgetCore(): void {
    const core = this.core;
    if (!core || core.ended || this.hasEnded || this.saved === undefined) return;
    this.savedRoom = core.saved;
    void this.storage.put("room", this.savedRoom);
    this.core = null;
    this.socketIndex = null;
  }

  /**
   * Whether the game's hosting is paused this month (hosting.ts). A running match that finds it is ends
   * MATCH_FINISH_DURATION_SEC after the pause, so every room of the game ends together: its game server
   * and players hear when (room.endsAt). Read again while the match is ending: once the pause is gone (credit
   * came in, a budget was raised, the month reset), the end is called off and the room takes players again.
   */
  private async checkHosting(core: RoomCore): Promise<boolean> {
    // Kept, since a sleeping room forgets: otherwise every wake would check.
    this.hostingCheckedAtMs = Date.now();
    await this.storage.put("hostingCheckedAtMs", this.hostingCheckedAtMs);
    const hosting = await isHostingPaused(this.db, this.meta!.gameId);
    if (!hosting.isPaused) {
      if (core.endsAt !== null && !core.ended) {
        core.cancelEnding();
        this.savedRoom = core.saved;
        await this.storage.put("room", this.savedRoom);
        await this.settle(core);
      }
      return false;
    }
    if (core.endsAt !== null) return true;
    if (core.players.size > 0 && !core.ended) {
      const endsAtMs = Math.max(Date.now(), hosting.pausedAtMs! + MATCH_FINISH_DURATION_SEC * 1000);
      core.startEnding(new Date(endsAtMs).toISOString());
      // Kept with the room, so a room that sleeps and wakes keeps the same end.
      this.savedRoom = core.saved;
      await this.storage.put("room", this.savedRoom);
      await this.settle(core);
      await this.wake(endsAtMs);
    }
    return true;
  }

  /** What the game's own server printed: to its logs soon (logs.ts), at once when a file's worth is waiting. */
  private printed(lines: PrintedLogLine[]): void {
    if (!this.meta || !lines.length) return;
    const logs = (this.logs ??= new LogWriter(this.env, this.meta.gameId, this.meta.roomCode ?? "room"));
    logs.add(lines, "room", this.meta.roomCode ?? null, this.meta.versionId ?? "");
    const delayMs = logs.writeDelayMs();
    if (delayMs === 0) this.ctx.waitUntil(logs.write());
    else if (delayMs !== null) void this.wake(Date.now() + delayMs);
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
    await this.logs?.write();
    await this.unlist();
    await this.syncSeats([], []);
    // An ended kept room is gone for good: its world goes with the day's cleanup like any room's.
    if (this.isKept) await this.unkeepRow();
    const chunkKeys = Array.from({ length: this.stateChunkCount }, (_, index) => stateChunkKey(index));
    this.stateChunkCount = 0;
    // One write with the chunks' delete (no await between them), so an ended room never wakes with its state.
    const ended = this.storage.put({ saved: { hasEnded: true } satisfies Saved, emptiedAtMs: Date.now() });
    await Promise.all([ended, chunkKeys.length ? this.storage.delete(chunkKeys) : null]);
    await this.setAlarm(Date.now() + KEEP_EMPTY_MS);
  }

  /**
   * Bring this room's row in live_rooms up to date: every room with players in it has one, for
   * "playing now" on the game page, with the player count, the most players, the seats it holds,
   * whether new players can join and whether it may be listed. Players who walked away don't count.
   * Writes only when something changed, or to check in (touch).
   */
  private async list(touch = false): Promise<void> {
    await this.writeRow(touch);
    // After the row, so the bookkeeping for the game's object never holds up what the room lists.
    await this.syncCoreSeats(touch);
  }

  private async writeRow(touch: boolean): Promise<void> {
    const core = this.core;
    const meta = this.meta;
    if (!core || !meta?.roomCode) return;
    if (this.browsing === null && !(await this.gameStillLive())) return;
    core.listingChanged = false;
    await this.checkKept(core);
    // What the room keeps for itself, so a hidden or closed room stays that way after a restart.
    this.savedRoom = core.saved;
    await this.storage.put("room", this.savedRoom);
    const isListed = core.isListed && this.browsing !== "off" ? 1 : 0;
    // A listed kept room keeps its row with nobody in it, like a server waiting for players.
    const live = !this.hasEnded && !core.ended && (core.playingCount > 0 || (this.isKept && isListed === 1));
    const labels = JSON.stringify(core.labels);
    // The version a sandboxed game server runs, which the game domain serves the room's players.
    const versionId = meta.server === SANDBOX ? (meta.versionId ?? null) : null;
    const isKept = this.isKept ? 1 : 0;
    const as = live ? JSON.stringify([core.playingCount, core.heldSeatCount, core.maximumPlayerCount, core.spectatorCount, core.maximumSpectatorCount, core.isOpen, isListed, core.friendJoinsEnabled, core.name, labels, versionId, isKept]) : "";
    if (as === this.listedAs && !touch) return;
    if (!live) return this.unlist();
    const nowMs = Date.now();
    await this.rowWrite(as, () =>
      this.db.prepare(
        // A name a person hid stays hidden while the room lives (is_name_hidden is never overwritten here).
        "INSERT INTO live_rooms (game_id, room_code, player_count, held_seat_count, maximum_player_count, spectator_count, maximum_spectator_count, is_listed, is_open, friend_joins_enabled, name, labels, country, continent, version_id, is_kept, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(game_id, room_code) DO UPDATE SET player_count = excluded.player_count, held_seat_count = excluded.held_seat_count, maximum_player_count = excluded.maximum_player_count, spectator_count = excluded.spectator_count, maximum_spectator_count = excluded.maximum_spectator_count, is_listed = excluded.is_listed, is_open = excluded.is_open, friend_joins_enabled = excluded.friend_joins_enabled, name = excluded.name, labels = excluded.labels, version_id = excluded.version_id, is_kept = excluded.is_kept, updated_at_ms = excluded.updated_at_ms",
      )
        .bind(meta.gameId, meta.roomCode, core.playingCount, core.heldSeatCount, core.maximumPlayerCount, core.spectatorCount, core.maximumSpectatorCount, isListed, core.isOpen ? 1 : 0, core.friendJoinsEnabled ? 1 : 0, core.name, labels, meta.country ?? null, meta.continent ?? null, versionId, isKept, nowMs, nowMs)
        .run(),
    );
    // Checked in: the next check-in is due an hour from now.
    this.checkedInAtMs = nowMs;
    await this.storage.put("checkedInAtMs", nowMs);
  }

  /**
   * Bring room_players up to date with the accounts connected here, for friends' Join (guests are
   * never written). Writes only what changed; a failed write (a busy database) never stops the
   * game, and is tried again in full next time.
   */
  private async seat(): Promise<void> {
    const meta = this.meta;
    if (!meta?.roomCode) return;
    const playerIds = this.indexed().accountPlayerIds;
    const was = this.seatedPlayerIds;
    if (was && was.join() === playerIds.join()) return;
    const nowMs = Date.now();
    const database = this.db;
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
      await this.storage.delete("seatedPlayerIds");
      return;
    }
    this.seatedPlayerIds = playerIds;
    await this.storage.put("seatedPlayerIds", playerIds);
  }

  /** The hourly check-in for room_players, so rows of rooms that stop without saying so drop off. */
  private async touchSeats(): Promise<void> {
    if (!this.meta?.roomCode || !this.seatedPlayerIds?.length) return;
    await this.db.prepare("UPDATE room_players SET updated_at_ms = ? WHERE game_id = ? AND room_code = ? AND server_url IS NULL").bind(Date.now(), this.meta.gameId, this.meta.roomCode).run();
  }

  /** Tell the game's object who sits in this room and who is playing, when that changed (or at the hourly check-in): its one-room rule and its count of players playing now read it. */
  private async syncSeats(seatedPlayerIds: string[], playingPlayerIds: string[], isForced = false): Promise<void> {
    const meta = this.meta;
    if (!meta?.roomCode) return;
    const as = JSON.stringify([[...seatedPlayerIds].sort(), [...playingPlayerIds].sort()]);
    if (as === this.syncedSeatsAs && !isForced) return;
    try {
      await this.callGameObject().get(this.env.GAME_SERVER_OBJECTS.idFromName(meta.gameId)).syncSeats(meta.gameId, meta.roomCode, seatedPlayerIds, playingPlayerIds);
      this.syncedSeatsAs = as;
      this.hasLoggedSeatFailure = false;
    } catch (error) {
      // Tried again with the next row write.
      this.syncedSeatsAs = undefined;
      if (!this.hasLoggedSeatFailure) console.error("Couldn't tell the game's object who sits in this room:", error);
      this.hasLoggedSeatFailure = true;
    }
  }

  /** The players the room has in its match and the ones playing, to the game's object. */
  private async syncCoreSeats(isForced = false): Promise<void> {
    const core = this.core;
    if (!core) return;
    await this.syncSeats([...core.players.keys()], [...core.players.keys()].filter((playerId) => !core.kept.has(playerId)), isForced);
  }

  private async unlist(): Promise<void> {
    if (this.listedAs === "" || !this.meta?.roomCode) return;
    await this.rowWrite("", () => this.db.prepare("DELETE FROM live_rooms WHERE game_id = ? AND room_code = ?").bind(this.meta!.gameId, this.meta!.roomCode!).run());
  }

  /**
   * The game server kept the room, or stopped keeping it (room.setKept). A keep is turned back while the
   * game's storage is past its free 500 MB, until Hosting billing: the room stays as it was and the game
   * server's log says why. Rooms already kept keep saving, so no world is ever lost to the limit.
   */
  private async checkKept(core: RoomCore): Promise<void> {
    if (core.isKept === this.isKept || this.hasEnded) return;
    if (!core.isKept) {
      this.isKept = false;
      await this.unkeepRow();
      return;
    }
    if (await this.isStorageFull()) {
      core.isKept = false;
      this.printed([{ atMs: Date.now(), level: "warn", text: KEEP_REFUSED_TEXT }]);
      return;
    }
    this.isKept = true;
    await this.keepRow();
  }

  /** Whether the game's database and kept rooms together are at the most storage a game can have. A check that fails lets the keep through. */
  private async isStorageFull(): Promise<boolean> {
    try {
      const databaseSizeBytes = (await gameDatabaseObject(this.env, this.meta!.gameId).usageThisMonth()).storageSizeBytes;
      return (await gameStorageSizeBytes(this.db, databaseSizeBytes, this.meta!.gameId)) >= MAXIMUM_GAME_STORAGE_SIZE_BYTES;
    } catch (error) {
      console.error("Couldn't read the game's storage:", error);
      return false;
    }
  }

  /** Write the kept room's row: its name, its saved size and when it was saved and last played, for the developer and the game's storage. */
  private async keepRow(lastPlayedAtMs = Date.now()): Promise<void> {
    const meta = this.meta;
    if (!meta?.roomCode) return;
    // A turn-based room's state is measured here; a real-time room's as it's saved (writeRealTimeState).
    if (!this.stateChunkCount && !this.core?.ticking) this.savedSizeBytes = this.saved === undefined ? 0 : utf8SizeBytes(JSON.stringify(this.saved) ?? "");
    const nowMs = Date.now();
    await this.db.prepare(
      "INSERT INTO kept_rooms (game_id, room_code, name, saved_size_bytes, saved_at_ms, last_played_at_ms, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(game_id, room_code) DO UPDATE SET name = excluded.name, saved_size_bytes = excluded.saved_size_bytes, saved_at_ms = excluded.saved_at_ms, last_played_at_ms = excluded.last_played_at_ms",
    )
      .bind(meta.gameId, meta.roomCode, this.core?.name ?? this.savedRoom?.name ?? null, this.savedSizeBytes, this.savedAtMs ?? (this.saved !== undefined ? nowMs : null), lastPlayedAtMs, nowMs)
      .run()
      .catch((error) => console.error("kept_rooms write failed", error));
  }

  private async unkeepRow(): Promise<void> {
    this.isKept = false;
    if (!this.meta?.roomCode) return;
    await this.db.prepare("DELETE FROM kept_rooms WHERE game_id = ? AND room_code = ?")
      .bind(this.meta.gameId, this.meta.roomCode)
      .run()
      .catch((error) => console.error("kept_rooms delete failed", error));
  }

  /**
   * A kept room with nobody in it: its row says so (listed at nobody, or gone if hidden), kept_rooms has
   * its size, and its state is marked as saved empty. It sets no alarm, so it costs only its storage.
   */
  private async sleepKept(): Promise<void> {
    await this.storage.delete("emptiedAtMs");
    if (this.core) await this.list();
    else if (this.meta?.roomCode) {
      // Woke with nobody back after a restart: the row still counts the players it had.
      await this.db.prepare("UPDATE live_rooms SET player_count = 0, held_seat_count = 0, updated_at_ms = ? WHERE game_id = ? AND room_code = ?")
        .bind(Date.now(), this.meta.gameId, this.meta.roomCode)
        .run()
        .catch((error) => console.error("live_rooms write failed", error));
      this.listedAs = undefined;
    }
    // Nobody played on from the last save, so a world waking from it lost nothing (at most a few seconds before a restart).
    if (!this.isSavedEmpty) await this.markSavedEmpty();
    // Found empty after a restart, its players were last there when it last saved.
    await this.keepRow(this.core ? Date.now() : (this.savedAtMs ?? Date.now()));
  }

  /** Mark a real-time room's last save as saved empty (Saved.isSavedEmpty), without writing its state again. */
  private async markSavedEmpty(): Promise<void> {
    if (this.savedAtMs === undefined) return;
    const saved = await this.storage.get<Saved>("saved");
    if (saved?.savedAtMs === undefined) return;
    await this.storage.put("saved", { ...saved, isSavedEmpty: true } satisfies Saved);
    this.isSavedEmpty = true;
  }

  /**
   * An empty kept room wakes on the game's live version, whatever version saved it: a world never ends, so
   * it never reaches a next match. Its saved state reaches onRestored with savedVersionId, as with a
   * version published "now", so the game brings an older world up to date in one place.
   */
  private async wakeKeptOnLiveVersion(): Promise<void> {
    if (!this.meta || this.meta.server !== SANDBOX || this.hasEnded || this.core || this.sockets().length) return;
    if (!(await this.gameStillLive()) || !this.liveVersionId || this.liveVersionId === this.meta.versionId) return;
    this.pendingVersionUpdate = { versionId: this.liveVersionId, isReloading: false, appliesAtMs: Date.now() };
    await this.applyVersionUpdate();
  }

  /**
   * The developer deletes a kept room's world (DELETE /games/:slug/kept-rooms/:room_code, through the
   * rooms Worker): players in it are sent out, and everything the room keeps goes now, not after a day.
   */
  /**
   * Everything a kept room keeps, for Zaisma's nightly backup (apps/site/src/backups.ts, through
   * GameStorageService.keptRoomBackup): one JSON line per storage key, { key, value }, read a page at a
   * time so a big world never sits whole in memory. What JSON can't hold (bytes, Maps, Dates) is tagged
   * (storedValueJson). Putting each back with storage.put restores the room (restoring).
   */
  private async backingUp(request: Request): Promise<Response> {
    if (!this.meta || this.meta.gameId !== request.headers.get("x-game-id")) return new Response("No such room", { status: 404 });
    const storage = this.ctx.storage;
    let startAfter: string | undefined;
    let isDone = false;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (isDone) return controller.close();
        const page = await storage.list({ startAfter, limit: BACKUP_PAGE_KEY_COUNT });
        let lines = "";
        for (const [key, storedValue] of page) {
          lines += `${JSON.stringify({ key, stored_value: storedValueJson(storedValue) })}\n`;
          startAfter = key;
        }
        isDone = page.size < BACKUP_PAGE_KEY_COUNT;
        if (lines) controller.enqueue(encoder.encode(lines));
      },
    });
    return new Response(body, { headers: { "content-type": "application/jsonl" } });
  }

  /**
   * A kept room's world back from its backup's JSON lines, for a restore from Zaisma's backups
   * (apps/site/src/restore.ts, through GameStorageService.restoreKeptRoom), a page of keys at a time, then
   * read into memory as if the room had just woken. The meta key goes in last, so a world without one is
   * an earlier try cut short, cleared first; a room that already holds a world is never replaced (409).
   */
  private async restoring(request: Request): Promise<Response> {
    if (this.meta) return new Response("This room already holds a world.", { status: 409 });
    if (!request.body) return new Response("No world sent.", { status: 400 });
    await this.ctx.storage.deleteAll();
    let meta: unknown;
    let entries: Record<string, unknown> = {};
    let entryCount = 0;
    const putEntries = async () => {
      if (entryCount) await this.ctx.storage.put(entries);
      entries = {};
      entryCount = 0;
    };
    let rest = "";
    const decoder = new TextDecoder();
    const takeLine = async (line: string) => {
      if (!line.trim()) return;
      const { key: storageKey, ...fields } = JSON.parse(line) as { key: string } & Record<string, unknown>;
      // Lines from before stored values were tagged hold plain JSON as value.
      const storedValue = "stored_value" in fields ? storedValueOf(fields.stored_value) : fields["value"];
      if (storageKey === "meta") {
        meta = storedValue;
        return;
      }
      entries[storageKey] = storedValue;
      entryCount++;
      if (entryCount >= RESTORE_PUT_KEY_COUNT) await putEntries();
    };
    for await (const chunk of request.body) {
      const lines = (rest + decoder.decode(chunk, { stream: true })).split("\n");
      rest = lines.pop()!;
      for (const line of lines) await takeLine(line);
    }
    await takeLine(rest + decoder.decode());
    await putEntries();
    if (!meta) return new Response("The world has no meta key: not a kept room's backup.", { status: 400 });
    await this.ctx.storage.put("meta", meta);
    await this.ctx.blockConcurrencyWhile(() => this.readStored());
    return new Response(null, { status: 204 });
  }

  private async deleting(request: Request): Promise<Response> {
    if (!this.meta || this.meta.gameId !== request.headers.get("x-game-id")) return new Response("No such room", { status: 404 });
    if (this.sockets().length && (await this.load())) {
      const core = this.room();
      if (core && !core.ended) {
        core.end(KEPT_ROOM_DELETED_MESSAGE, "kept_room_deleted");
        await core.settled();
      }
    }
    for (const socket of this.ctx.getWebSockets()) {
      if ((socket.deserializeAttachment() as Attachment | null)?.stage === "gone") continue;
      this.retire(socket);
      try {
        socket.close(REMOVED_CLOSE_CODE, "Deleted");
      } catch {
        // Already closed.
      }
    }
    await this.finish();
    await this.unkeepRow();
    await this.storage.deleteAll();
    await this.storage.deleteAlarm();
    this.alarmAtMs = null;
    // Nothing comes back: the room stays ended while this object lives, and starts empty after.
    this.saved = undefined;
    this.savedRoom = undefined;
    this.stateChunkCount = 0;
    return new Response(null, { status: 204 });
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
    if (this.probeTimer) clearInterval(this.probeTimer);
    this.probeTimer = null;
  }

  /** Move what the room and its game server used since last time into this.usage: messages, traffic and CPU. */
  private takeUse(): void {
    if (this.core) {
      this.usage.messageCount += this.core.messageCount;
      this.core.messageCount = 0;
      this.usage.traffic = addTraffic(this.usage.traffic ?? noTraffic(), this.core.takeTraffic());
    }
    const stats = (this.server as { stats?: SandboxStats } | null)?.stats;
    if (stats) {
      this.usage.gameServerCpuDurationMs = (this.usage.gameServerCpuDurationMs ?? 0) + stats.cpuDurationMs;
      this.usage.gameServerSessionCount = (this.usage.gameServerSessionCount ?? 0) + stats.sessionCount;
      this.usage.gameServerStartupCpuDurationMs = (this.usage.gameServerStartupCpuDurationMs ?? 0) + stats.startupCpuDurationMs;
      stats.cpuDurationMs = stats.sessionCount = stats.startupCpuDurationMs = 0;
    }
    if (this.logs) {
      const logs = this.logs.takeUse();
      this.usage.logFileCount = (this.usage.logFileCount ?? 0) + logs.fileCount;
      this.countWritten(logs.writtenRowCount);
    }
  }

  /** An event the room handles at nowMs: the awake time it adds on the meter. */
  private noteAwake(nowMs = Date.now()): void {
    this.usage.roomAwakeDurationMs = (this.usage.roomAwakeDurationMs ?? 0) + this.awake.note(nowMs);
  }

  /** Rows the room wrote for the game, on the meter. */
  private countWritten(writtenRowCount: number): void {
    this.usage.bookkeepingWrittenRowCount = (this.usage.bookkeepingWrittenRowCount ?? 0) + writtenRowCount;
  }

  /** The game's object, for a call that counts as one of the room's requests on the meter. */
  private callGameObject(): Env["GAME_SERVER_OBJECTS"] {
    this.usage.objectRequestCount = (this.usage.objectRequestCount ?? 0) + 1;
    return this.env.GAME_SERVER_OBJECTS;
  }

  /**
   * Add this room's player time, message count, traffic, game server CPU and health to the game's daily
   * usage, with its biggest message types each way. Nothing about players. Called when the room empties
   * or ends (ended), and hourly while it runs.
   */
  private async recordUsage(ended = true): Promise<void> {
    this.takeUse();
    const stats = (this.server as { stats?: SandboxStats } | null)?.stats;
    const health = { callCount: stats?.callCount ?? 0, crashCount: stats?.crashCount ?? 0, stoppedCount: stats?.stoppedCount ?? 0, endedMatchCount: ended && this.isBroken ? 1 : 0 };
    const errors = stats ? [...stats.errors.values()] : [];
    if (stats) {
      stats.callCount = stats.waitDurationMs = stats.crashCount = stats.stoppedCount = 0;
      stats.errors.clear();
    }
    const usage = this.usage;
    const traffic = usage.traffic ?? noTraffic();
    const cpuDurationMs = Math.round(usage.gameServerCpuDurationMs ?? 0);
    // Whole seconds go now; the rest waits for the next record.
    const awakeDurationSec = Math.floor((usage.roomAwakeDurationMs ?? 0) / 1000);
    const meterCounts = [usage.roomConnectionCount ?? 0, usage.objectRequestCount ?? 0, usage.gameServerSessionCount ?? 0, Math.round(usage.gameServerStartupCpuDurationMs ?? 0), usage.logFileCount ?? 0];
    if (!this.meta || !(usage.roomPlayDurationSec || usage.messageCount || traffic.outboundMessageCount || cpuDurationMs || awakeDurationSec || meterCounts.some(Boolean) || health.callCount || health.crashCount || health.stoppedCount || health.endedMatchCount)) return;
    const date = new Date().toISOString().slice(0, 10);
    const nowMs = Date.now();
    const biggest = (["inbound", "outbound"] as const).flatMap((direction) =>
      traffic.messageTypes
        .filter((type) => type.direction === direction)
        .sort((first, second) => second.sizeBytes - first.sizeBytes)
        .slice(0, RECORDED_MESSAGE_TYPE_COUNT),
    );
    // This record's own rows are counted before it's written, a row a statement, so recording never needs another record.
    const writtenRowCount = (usage.bookkeepingWrittenRowCount ?? 0) + 1 + biggest.length + errors.length;
    // Written past the counting wrapper (this.db), since its rows are counted above.
    await this.env.DB.batch([
      this.env.DB.prepare(
        "INSERT INTO room_usage (game_id, date, room_count, room_play_duration_sec, message_count, inbound_size_bytes, outbound_message_count, outbound_size_bytes, game_server_cpu_duration_ms, game_server_call_count, game_server_crash_count, game_server_stopped_count, game_server_ended_match_count, room_awake_duration_sec, room_connection_count, object_request_count, game_server_session_count, game_server_startup_cpu_duration_ms, log_file_count, bookkeeping_written_row_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(game_id, date) DO UPDATE SET room_count = room_count + excluded.room_count, room_play_duration_sec = room_play_duration_sec + excluded.room_play_duration_sec, message_count = message_count + excluded.message_count, inbound_size_bytes = inbound_size_bytes + excluded.inbound_size_bytes, outbound_message_count = outbound_message_count + excluded.outbound_message_count, outbound_size_bytes = outbound_size_bytes + excluded.outbound_size_bytes, game_server_cpu_duration_ms = game_server_cpu_duration_ms + excluded.game_server_cpu_duration_ms, game_server_call_count = game_server_call_count + excluded.game_server_call_count, game_server_crash_count = game_server_crash_count + excluded.game_server_crash_count, game_server_stopped_count = game_server_stopped_count + excluded.game_server_stopped_count, game_server_ended_match_count = game_server_ended_match_count + excluded.game_server_ended_match_count, room_awake_duration_sec = room_awake_duration_sec + excluded.room_awake_duration_sec, room_connection_count = room_connection_count + excluded.room_connection_count, object_request_count = object_request_count + excluded.object_request_count, game_server_session_count = game_server_session_count + excluded.game_server_session_count, game_server_startup_cpu_duration_ms = game_server_startup_cpu_duration_ms + excluded.game_server_startup_cpu_duration_ms, log_file_count = log_file_count + excluded.log_file_count, bookkeeping_written_row_count = bookkeeping_written_row_count + excluded.bookkeeping_written_row_count",
      ).bind(this.meta.gameId, date, ended ? 1 : 0, usage.roomPlayDurationSec, usage.messageCount, traffic.inboundSizeBytes, traffic.outboundMessageCount, traffic.outboundSizeBytes, cpuDurationMs, health.callCount, health.crashCount, health.stoppedCount, health.endedMatchCount, awakeDurationSec, ...meterCounts, writtenRowCount),
      ...biggest.map((type) =>
        this.env.DB.prepare(
          "INSERT INTO room_message_types (game_id, date, message_type, direction, message_count, size_bytes, largest_size_bytes, backed_up_message_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(game_id, date, message_type, direction) DO UPDATE SET message_count = message_count + excluded.message_count, size_bytes = size_bytes + excluded.size_bytes, largest_size_bytes = MAX(largest_size_bytes, excluded.largest_size_bytes), backed_up_message_count = backed_up_message_count + excluded.backed_up_message_count",
        ).bind(this.meta!.gameId, date, type.messageType, type.direction, type.messageCount, type.sizeBytes, type.largestSizeBytes, type.backedUpMessageCount ?? 0),
      ),
      ...errors.map((error) =>
        this.env.DB.prepare(
          "INSERT INTO game_server_errors (game_id, version_id, kind, message, occurrence_count, first_at_ms, last_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(game_id, version_id, kind, message) DO UPDATE SET occurrence_count = occurrence_count + excluded.occurrence_count, last_at_ms = excluded.last_at_ms",
        ).bind(this.meta!.gameId, this.meta!.versionId ?? "", error.kind, error.message, error.occurrenceCount, error.firstAtMs, nowMs),
      ),
    ]);
    this.usage = { ...noUsage(), roomAwakeDurationMs: (usage.roomAwakeDurationMs ?? 0) - awakeDurationSec * 1000 };
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
    const nobody = (refusalCode: "room_not_running" | "busy"): MoveAnswer => ({ movedPlayerIds: [], refusals: ask.players.map((player) => ({ playerId: player.id, code: refusalCode, message: ERROR_TEXT[refusalCode] })) });
    const work = (async () => {
      let answer: MoveAnswer;
      if (roomCode === meta.roomCode || !meta.roomCode) answer = nobody("room_not_running");
      else {
        try {
          const response = await this.env.ROOMS.get(this.env.ROOMS.idFromName(`${meta.slug}:${roomCode}`)).fetch("https://room/expect", {
            method: "POST",
            headers: { "x-game-id": meta.gameId },
            body: JSON.stringify({ ...ask, fromRoomCode: meta.roomCode } satisfies MoveAsk),
          });
          answer = response.ok ? await response.json() : nobody("room_not_running");
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
    // Players whose seat is held are still connected, but out of the match; spectators are connected, but watching.
    const held = this.savedRoom?.held ?? {};
    const presence: Record<string, { seenAtMs?: number; clientIdle?: ClientIdle }> = {};
    const spectators: Player[] = [];
    const players = this.sockets().flatMap((socket) => {
      const attachment = socket.deserializeAttachment() as Attachment & { stage: "in" };
      if (attachment.isSpectator) {
        spectators.push(this.playerOf(attachment));
        return [];
      }
      if (Object.hasOwn(held, attachment.id)) return [];
      presence[attachment.id] = { seenAtMs: attachment.seenAtMs ?? attachment.joinedAtMs, clientIdle: attachment.clientIdle };
      return [this.playerOf(attachment)];
    });
    const transport = {
      roomCode: this.meta!.roomCode,
      send: (id: string, text: string) => this.sockets(id).forEach((socket) => socket.send(text)),
      sendBytes: (id: string, frame: Uint8Array) => this.sockets(id).forEach((socket) => socket.send(frame)),
      close: (id: string, code: number, reason: string) => {
        this.sockets(id).forEach((socket) => {
          this.retire(socket);
          socket.close(code, reason);
        });
        // The game kicked the last player: the room empties like when everyone leaves, spectators and all.
        if (!this.core?.ended && this.playerSockets().length === 0) {
          this.dismissSpectators();
          void this.emptied();
        }
      },
      reserve: (roomCode: string, start: RoomStart) => this.reserve(roomCode, start),
      moveTo: (roomCode: string, ask: Omit<MoveAsk, "fromRoomCode">) => this.moveTo(roomCode, ask),
      // A game server built into this Worker reaches its game's database directly; a sandboxed one through its own binding (sandbox.ts).
      database: gameDatabase(this.env, this.meta!.gameId),
      applyVersionUpdate: () => void this.applyVersionUpdate(),
      // Purchases for onPurchase and onRefund, from D1: the game's own, for players joined here (RoomCore asks only for them).
      purchaseHandling: roomPurchaseHandling(this.env, { id: this.meta!.gameId, slug: this.meta!.slug }),
    };
    // Turn-based rooms wake with their saved state. A real-time room restarted (every rooms deploy, or
    // evicted) comes back with the state it last saved: the players in its match then who aren't
    // connected are away until they reconnect (the sockets of an eviction without a deploy are still
    // here), and onRestored runs. Either way, the room stays as listed or hidden, and open or closed, as it was.
    // A turn-based room comes back the same way after switching versions (match_update_mode "now").
    const isVersionSwitch = this.savedVersionId !== undefined && this.savedVersionId !== this.meta?.versionId;
    // A turn-based room that wakes with none of its match's players connected was restarted (every connection closed), and comes back the same way. Dropped players it's waiting on stay as they were saved.
    const isRestarted = !server.ticksPerSec && this.matchPlayers.length > 0 && !this.matchPlayers.some((matchPlayer) => players.some((connected) => connected.id === matchPlayer.id)) && !Object.keys(this.savedRoom?.reconnecting ?? {}).length;
    if ((server.ticksPerSec || isVersionSwitch || isRestarted) && this.saved !== undefined && this.savedAtMs !== undefined && !this.hasEnded) {
      const lostPlayers = this.matchPlayers.filter((player) => !players.some((connected) => connected.id === player.id));
      // A sandboxed game server starts from the saved state with its next call, which is onRestored.
      void (server as SandboxServer).restore?.(this.saved);
      this.core = new RoomCore(server, transport, { state: this.saved, players, spectators, room: this.savedRoom, presence, restoreInfo: restoreInfoOf(this.savedAtMs, Date.now(), this.savedVersionId ?? null, this.isSavedEmpty), lostPlayers });
      this.core.savedAtMs = this.savedAtMs;
    } else if (!server.ticksPerSec && this.saved !== undefined) {
      this.core = new RoomCore(server, transport, { state: this.saved, players, spectators, room: this.savedRoom, presence });
    } else {
      this.core = new RoomCore(server, transport, { room: this.savedRoom });
      for (const player of players) this.core.join(player, { clientIdle: presence[player.id]?.clientIdle });
      for (const spectator of spectators) this.core.join(spectator, { isSpectator: true });
    }
    this.core.dirty = false;
    return this.core;
  }

  /**
   * Load the game server: a built-in one, or the game's own in its sandbox. A version with no game
   * server file, or one whose code won't start (like an option the game server doesn't take), leaves the
   * room unavailable, like a takedown (404), and the game's errors say why (once per room). A start that
   * failed on Zaisma's side answers busy (503), so players try again.
   */
  private async load(): Promise<GameServer | null> {
    if (this.server || !this.meta) return this.server;
    if (this.meta.server !== SANDBOX) return (this.server = gameServer(this.meta.server));
    if (!this.meta.versionId) return null;
    // Players connecting at once (all of them, after a restart) wait for the same sandbox.
    this.loading ??= this.openSandbox().finally(() => (this.loading = null));
    return this.loading;
  }

  private async openSandbox(): Promise<GameServer | null> {
    if (!this.meta?.versionId) return null;
    this.hasStartFailed = false;
    try {
      const { secrets, changedAtMs } = await secretsForGameServer(this.env, this.meta.gameId);
      this.secretsChangedAtMs = changedAtMs;
      this.logs ??= new LogWriter(this.env, this.meta.gameId, this.meta.roomCode ?? "room");
      await this.logs.checkWatched();
      this.server = await sandboxServer(this.env, this.ctx.exports, this.meta.gameId, this.meta.versionId, secrets, () => this.broken(), () => this.newError(), (lines) => this.printed(lines));
    } catch (error) {
      // The game's own mistake stays unavailable until a new version; a moment's failure of ours is tried again.
      this.hasStartFailed = !isGameStartError(error);
      console.error("Couldn't start the game server:", error);
      this.printed(linesOf(null, `Zaisma: the game server didn't start: ${String(error instanceof Error ? error.message : error)}`));
      if (!this.hasRecordedStartError) {
        this.hasRecordedStartError = true;
        const nowMs = Date.now();
        await this.db.prepare(
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
    else if (this.timer) {
      this.stopTicking();
      // Everyone walked away: the room may sleep, so its state as it stopped is what it wakes with.
      void this.saveRealTimeState(core, true);
    }
  }

  private startTicking(core: RoomCore): void {
    if (!core.ticking || this.timer) return;
    let lastTickAtMs = Date.now();
    this.stateCopiedAtMs = Date.now();
    let isCopying = false;
    const server = this.server as SandboxServer | null;
    // A tick slower than the probe interval can't probe on time (the player's game reconnects after 8 seconds of silence), so the room checks twice an interval on its own timer, and probes each player once the interval has passed.
    if (1000 / core.server.ticksPerSec! > ROOM_TUNING.probeIntervalSec * 1000) {
      this.probeTimer = setInterval(() => {
        if (!core.ended) core.probeDue();
      }, (ROOM_TUNING.probeIntervalSec * 1000) / 2);
    }
    this.timer = setInterval(() => {
      const nowMs = Date.now();
      this.noteAwake(nowMs);
      core.tick((nowMs - lastTickAtMs) / 1000);
      lastTickAtMs = nowMs;
      if (!core.ended) void this.saveRealTimeState(core);
      // A sandboxed game server's state, copied now and then (built-in ones keep theirs in core.state); a save takes one too.
      if (typeof server?.stateCopy === "function" && !isCopying && !this.stateSaving && nowMs - this.stateCopiedAtMs >= STATE_COPY_INTERVAL_MS) {
        this.stateCopiedAtMs = nowMs;
        isCopying = true;
        void server
          .stateCopy()
          .then((copy) => (this.stateCopy = copy))
          .finally(() => (isCopying = false));
      }
      if (core.ended) void this.finish();
      else if (nowMs - this.lastCheckAtMs > CHECK_MS) void this.gameStillLive();
      else if (nowMs - this.lastTesterCheckAtMs > TESTER_CHECK_MS) void this.testerLinksStillOn();
      else if (core.listingChanged) void this.list();
    }, 1000 / core.server.ticksPerSec!);
  }

  /** A takedown or a changed game server ends the match. Also picks up the game's room browsing and account settings, and new secrets. */
  private async gameStillLive(): Promise<boolean> {
    this.lastCheckAtMs = Date.now();
    const row = await this.db.prepare(
      "SELECT review_status, live_version_id, live_version_match_update_mode, has_live_version_game_file_changes, multiplayer_mode, built_in_server, room_browsing, account_requirement, minimum_player_age_years, secrets_changed_at_ms FROM games WHERE id = ?",
    )
      .bind(this.meta!.gameId)
      .first<{
        review_status: string;
        live_version_id: string | null;
        live_version_match_update_mode: MatchUpdateMode;
        has_live_version_game_file_changes: number;
        multiplayer_mode: MultiplayerMode;
        built_in_server: string | null;
        room_browsing: string;
        account_requirement: AccountRequirement;
        minimum_player_age_years: number;
        secrets_changed_at_ms: number | null;
      }>();
    if (row && row.review_status === "live" && row.live_version_id && gameServerOf(row) === this.meta!.server) {
      this.liveVersionId = row.live_version_id;
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
      // A version published "now" that this room missed (it slept, or the rooms Worker's call didn't reach it).
      if (row.live_version_match_update_mode === "now" && this.meta?.versionId && row.live_version_id !== this.meta.versionId && this.pendingVersionUpdate?.versionId !== row.live_version_id) {
        void this.startVersionUpdate(row.live_version_id, row.has_live_version_game_file_changes === 1).catch((error) => console.error("Couldn't start the version update:", error));
      }
      return true;
    }
    // A kept world outlives its game being unavailable (a takedown, or made private): its players go, and it sleeps kept.
    if (this.isKept && !this.hasEnded) {
      await this.sendAway();
      return false;
    }
    this.room()?.end("This game isn't available right now.", "game_unavailable");
    for (const socket of this.ctx.getWebSockets()) {
      this.retire(socket);
      socket.close(REMOVED_CLOSE_CODE, "Game unavailable");
    }
    await this.finish();
    return false;
  }

  /** A kept room whose game isn't available: everyone is told and goes, its world is saved, and it leaves room lists. */
  private async sendAway(): Promise<void> {
    for (const socket of this.ctx.getWebSockets()) {
      if ((socket.deserializeAttachment() as Attachment | null)?.stage === "gone") continue;
      this.retire(socket);
      try {
        socket.send(errorMessage("game_unavailable"));
        socket.close(REMOVED_CLOSE_CODE, "Game unavailable");
      } catch {
        // Already closed.
      }
    }
    this.stopTicking();
    if (this.core && !this.core.ticking) this.core.dirty = true;
    await this.save(true, true);
    await this.unlist();
    await this.seat();
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
    const { results } = await this.db.prepare(`SELECT id FROM tester_links WHERE id IN (${links.map(() => "?").join(", ")}) AND revoked_at_ms IS NULL AND (ends_at_ms IS NULL OR ends_at_ms > ?)`)
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
        socket.close(REMOVED_CLOSE_CODE, "Tester link turned off");
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
    const { results } = await this.db.prepare(`SELECT player_id, age_band FROM accounts WHERE player_id IN (${playerIds.map(() => "?").join(", ")})`)
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
        socket.close(REMOVED_CLOSE_CODE, "game_not_open_to_player");
      } catch {
        // Already closed.
      }
    }
  }

  /** The game's own game server keeps failing (stuck in a loop, say): end the match rather than freeze it. */
  private broken(): void {
    console.error(`Game server for ${this.meta?.slug} stopped working; ending room ${this.meta?.roomCode}`);
    this.isBroken = true;
    this.room()?.end("This game's server stopped working.", "game_server_stopped");
    void this.finish();
  }

  /** Save a turn-based room's state after each change, so it can sleep between moves, and a real-time room's every few seconds (or now: isForced). */
  private async save(isForced = false, isSavedEmpty = false): Promise<void> {
    const core = this.core;
    if (core?.ended) await this.finish();
    if (core?.ticking && !this.hasEnded) return this.saveRealTimeState(core, isForced, isSavedEmpty);
    if (!core || this.hasEnded || core.ticking || !core.dirty) return;
    // A sleeping room forgets what's only in memory, so its use so far goes with its state.
    this.takeUse();
    core.dirty = false;
    this.saved = core.state;
    // With who was in the match and when, so a room that wakes without any of them (Zaisma restarted its rooms) brings them back as dropped players.
    const savedAtMs = Date.now();
    const matchPlayers = [...core.players.values()];
    const versionId = this.meta?.versionId;
    await this.storage.put("saved", { state: core.state, usage: this.usage, savedAtMs, matchPlayers, ...(versionId ? { versionId } : {}) } satisfies Saved);
    this.savedAtMs = savedAtMs;
    this.matchPlayers = matchPlayers;
    this.savedVersionId = versionId;
  }

  /** The rooms Worker says the game published a version "now" (room-updates.ts): start moving to it. */
  private async versionUpdating(request: Request): Promise<Response> {
    const update = (await request.json()) as { versionId?: unknown; hasGameFileChanges?: unknown };
    if (typeof update?.versionId !== "string" || !update.versionId) return new Response("Bad request", { status: 400 });
    if (!this.meta || this.meta.gameId !== request.headers.get("x-game-id")) return new Response("No such room", { status: 404 });
    await this.startVersionUpdate(update.versionId, update.hasGameFileChanges !== false);
    return new Response(null, { status: 204 });
  }

  /**
   * Move the match to a version published "now": players hear it's coming, and it switches after
   * ROOM_LIMITS.defaultVersionUpdateDelaySec, or, with the game server's onVersionUpdate, when it calls
   * room.applyVersionUpdate() or after ROOM_LIMITS.maximumVersionUpdateDelaySec. A room with nobody in it switches at once.
   */
  private async startVersionUpdate(versionId: string, isReloading: boolean): Promise<void> {
    if (!this.meta || this.hasEnded || this.meta.versionId === versionId || this.pendingVersionUpdate?.versionId === versionId) return;
    const isAnyoneHere = this.sockets().length > 0;
    const server = isAnyoneHere ? await this.load() : null;
    const core = server ? this.room() : null;
    this.pendingVersionUpdate = { versionId, isReloading, appliesAtMs: Date.now() };
    if (!core || core.ended) return this.applyVersionUpdate();
    const isHeld = Boolean(core.server.onVersionUpdate);
    const appliesAtMs = Date.now() + (isHeld ? ROOM_LIMITS.maximumVersionUpdateDelaySec : ROOM_LIMITS.defaultVersionUpdateDelaySec) * 1000;
    this.pendingVersionUpdate = { versionId, isReloading, appliesAtMs };
    await this.storage.put("versionUpdate", this.pendingVersionUpdate);
    core.startVersionUpdate({ versionId, appliesAt: new Date(appliesAtMs).toISOString(), isReloading }, isHeld);
    if (this.versionUpdateTimer) clearTimeout(this.versionUpdateTimer);
    this.versionUpdateTimer = setTimeout(() => void this.applyVersionUpdate(), appliesAtMs - Date.now());
    // And an alarm, in case the room sleeps before then.
    await this.wake(appliesAtMs);
    await core.settled();
  }

  /**
   * Switch to the version coming: save the match (with the version that saved it), tell every player and
   * close their connections (VERSION_UPDATE_CLOSE_CODE), and run the new version from the next hello, which
   * restores the state (onRestored with savedVersionId). Players come back as dropped players do.
   */
  private async applyVersionUpdate(): Promise<void> {
    const update = this.pendingVersionUpdate;
    if (!update || !this.meta) return;
    this.pendingVersionUpdate = null;
    if (this.versionUpdateTimer) clearTimeout(this.versionUpdateTimer);
    this.versionUpdateTimer = null;
    await this.storage.delete("versionUpdate");
    if (this.hasEnded) return;
    const core = this.core;
    const savedVersionId = this.meta.versionId;
    if (core) {
      await core.settled();
      if (core.ended) return this.finish();
      this.stopTicking();
      if (core.ticking) await this.saveRealTimeState(core, true);
      else {
        this.takeUse();
        const savedAtMs = Date.now();
        const matchPlayers = [...core.players.values()];
        this.savedRoom = core.saved;
        await this.storage.put({ saved: { state: core.state, usage: this.usage, savedAtMs, matchPlayers, ...(savedVersionId ? { versionId: savedVersionId } : {}) } satisfies Saved, room: this.savedRoom });
        this.saved = core.state;
        this.savedAtMs = savedAtMs;
        this.matchPlayers = matchPlayers;
        this.savedVersionId = savedVersionId;
      }
      core.tellVersionUpdateNow();
    } else if (this.saved !== undefined && this.savedAtMs === undefined) {
      // A turn-based room asleep with nobody in it: its saved state comes back on the new version, as one that switched.
      this.savedAtMs = Date.now();
      this.savedVersionId = savedVersionId;
      await this.storage.put("saved", { state: this.saved, usage: this.usage, savedAtMs: this.savedAtMs, matchPlayers: [], ...(savedVersionId ? { versionId: savedVersionId } : {}) } satisfies Saved);
    }
    this.meta = { ...this.meta, versionId: update.versionId };
    await this.storage.put("meta", this.meta);
    // Before anyone reloads: the game domain serves the room's players the version its row names.
    if (this.meta.roomCode && this.meta.server === SANDBOX) {
      await this.db.prepare("UPDATE live_rooms SET version_id = ? WHERE game_id = ? AND room_code = ?")
        .bind(update.versionId, this.meta.gameId, this.meta.roomCode)
        .run()
        .catch((error) => console.error("live_rooms version write failed", error));
    }
    for (const socket of this.ctx.getWebSockets()) {
      if ((socket.deserializeAttachment() as Attachment | null)?.stage === "gone") continue;
      this.retire(socket);
      try {
        socket.close(VERSION_UPDATE_CLOSE_CODE, "Updating");
      } catch {
        // Already closed.
      }
    }
    // The new version's game server opens with the next hello.
    this.core = null;
    this.server = null;
    this.loading = null;
    this.stateCopy = undefined;
    this.socketIndex = null;
  }

  /**
   * Save a real-time room's state every stateSaveIntervalSec (or now: isForced), when it changed, so a
   * restart brings the match back a few seconds behind: the sandboxed game server's state, or a built-in
   * one's, as JSON in chunks, with the match's players and the room, all in one put. Never two at once.
   */
  private async saveRealTimeState(core: RoomCore, isForced = false, isSavedEmpty = false): Promise<void> {
    if (this.stateSaving) {
      if (!isForced) return;
      await this.stateSaving;
    }
    const intervalMs = (core.server.stateSaveIntervalSec ?? ROOM_LIMITS.defaultStateSaveIntervalSec) * 1000;
    const nowMs = Date.now();
    core.savedAtMs ??= nowMs;
    if (this.hasEnded || core.ended || (!isForced && nowMs - core.savedAtMs < intervalMs)) return;
    core.savedAtMs = nowMs;
    this.stateSaving = this.writeRealTimeState(core, nowMs, isSavedEmpty).finally(() => (this.stateSaving = null));
    await this.stateSaving;
  }

  private async writeRealTimeState(core: RoomCore, savedAtMs: number, isSavedEmpty = false): Promise<void> {
    const server = this.server as SandboxServer | null;
    let state: unknown = core.state;
    if (typeof server?.stateCopy === "function") {
      this.stateCopiedAtMs = savedAtMs;
      state = this.stateCopy = await server.stateCopy();
    }
    if (this.hasEnded || core.ended || state === undefined) return;
    let text: string;
    try {
      text = JSON.stringify(state);
    } catch (error) {
      console.error("Couldn't save the room's state:", error);
      return;
    }
    const matchPlayers = [...core.players.values()];
    const stateKey = stateKeyOf(text, matchPlayers);
    if (stateKey === this.savedStateKey) {
      // Unchanged since the last save, which now counts as saved empty: nobody played on from it.
      if (isSavedEmpty && !this.isSavedEmpty) await this.markSavedEmpty();
      return;
    }
    // Counted byte by byte only when it could be too big: UTF-8 takes at most 3 bytes a character here.
    const maximumSizeBytes = ROOM_LIMITS.maximumSavedStateSizeBytes;
    if (text.length > maximumSizeBytes || (text.length * 3 > maximumSizeBytes && utf8SizeBytes(text) > maximumSizeBytes)) {
      if (!this.hasReportedStateSize) {
        this.hasReportedStateSize = true;
        this.printed([{ atMs: Date.now(), level: "warn", text: "Zaisma: this room's state is over 32 MB, so it isn't saved and a restart starts it fresh." }]);
      }
      return;
    }
    // A sleeping or restarted room forgets what's only in memory, so its use so far goes with its state.
    this.takeUse();
    const chunkCount = Math.max(1, Math.ceil(text.length / STATE_CHUNK_CHARACTER_COUNT));
    this.savedRoom = core.saved;
    const versionId = this.meta?.versionId;
    const entries: Record<string, unknown> = { saved: { savedAtMs, stateChunkCount: chunkCount, matchPlayers, usage: this.usage, ...(versionId ? { versionId } : {}), ...(isSavedEmpty ? { isSavedEmpty } : {}) } satisfies Saved, room: this.savedRoom };
    for (let index = 0; index < chunkCount; index++) entries[stateChunkKey(index)] = text.slice(index * STATE_CHUNK_CHARACTER_COUNT, (index + 1) * STATE_CHUNK_CHARACTER_COUNT);
    const staleKeys = Array.from({ length: Math.max(0, this.stateChunkCount - chunkCount) }, (_, index) => stateChunkKey(chunkCount + index));
    // Written together (no await between the put and the delete), so a restart reads all of one save or the one before.
    const written = this.storage.put(entries);
    await Promise.all([written, staleKeys.length ? this.storage.delete(staleKeys) : null]);
    this.stateChunkCount = chunkCount;
    this.savedStateKey = stateKey;
    this.isSavedEmpty = isSavedEmpty;
    // Counted byte by byte only for a kept room, whose size goes towards the game's storage.
    this.savedSizeBytes = this.isKept ? utf8SizeBytes(text) : text.length;
    this.savedVersionId = versionId;
    this.saved = state;
    this.savedAtMs = savedAtMs;
    this.matchPlayers = matchPlayers;
  }

  private refuse(socket: WebSocket, code: RoomErrorCode, message?: string, details?: { versionId: string }): void {
    socket.serializeAttachment({ stage: "gone" } satisfies Attachment);
    this.socketIndex = null;
    try {
      socket.send(errorMessage(code, message, details));
      socket.close(REMOVED_CLOSE_CODE, code);
    } catch {
      // Already closed.
    }
  }

  /** Open sockets of players and spectators in the room, optionally just one player's. */
  private sockets(playerId?: string): WebSocket[] {
    const index = this.indexed();
    return playerId === undefined ? [...index.byPlayerId.values()].flat() : [...(index.byPlayerId.get(playerId) ?? [])];
  }

  /** Open sockets of players in the room, spectators left out. */
  private playerSockets(): WebSocket[] {
    const index = this.indexed();
    return [...index.byPlayerId].flatMap(([playerId, sockets]) => (index.spectatorIds.has(playerId) ? [] : sockets));
  }

  /**
   * The sockets of players in the room by player ID, and the accounts among them, sorted: read from the
   * sockets once, not for every message a room sends (a 100-player room sends to each player every tick).
   */
  private indexed(): NonNullable<Room["socketIndex"]> {
    if (this.socketIndex) return this.socketIndex;
    const byPlayerId = new Map<string, WebSocket[]>();
    const accountPlayerIds = new Set<string>();
    const spectatorIds = new Set<string>();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as Attachment | null;
      if (attachment?.stage !== "in") continue;
      byPlayerId.set(attachment.id, [...(byPlayerId.get(attachment.id) ?? []), socket]);
      // Spectators aren't playing, so friends' Join never finds them here.
      if (attachment.isSpectator) spectatorIds.add(attachment.id);
      else if (attachment.kind === "account") accountPlayerIds.add(attachment.id);
    }
    return (this.socketIndex = { byPlayerId, accountPlayerIds: [...accountPlayerIds].sort(), spectatorIds });
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

/** A saved state's key: its JSON and who was in the match, since either changing is worth a save. */
/**
 * A stored value as JSON for a kept room's backup: what JSON can't hold is tagged as { $stored: kind, … }
 * (bytes as base64, Maps and Sets as their entries, Dates, big integers, undefined), and so is a plain
 * object that has a $stored key of its own. storedValueOf reads it back.
 */
export function storedValueJson(storedValue: unknown): unknown {
  if (storedValue === undefined) return { $stored: "undefined" };
  if (typeof storedValue === "bigint") return { $stored: "bigint", text: storedValue.toString() };
  if (storedValue === null || typeof storedValue !== "object") return storedValue;
  if (storedValue instanceof ArrayBuffer) return { $stored: "bytes", base64: bytesBase64(new Uint8Array(storedValue)) };
  if (ArrayBuffer.isView(storedValue)) return { $stored: "bytes", view: storedValue.constructor.name, base64: bytesBase64(new Uint8Array(storedValue.buffer, storedValue.byteOffset, storedValue.byteLength)) };
  if (storedValue instanceof Date) return { $stored: "date", ms: storedValue.getTime() };
  if (storedValue instanceof Map) return { $stored: "map", entries: [...storedValue].map(([entryKey, entryValue]) => [storedValueJson(entryKey), storedValueJson(entryValue)]) };
  if (storedValue instanceof Set) return { $stored: "set", values: [...storedValue].map(storedValueJson) };
  if (Array.isArray(storedValue)) return storedValue.map(storedValueJson);
  const object = Object.fromEntries(Object.entries(storedValue).map(([name, entryValue]) => [name, storedValueJson(entryValue)]));
  return "$stored" in object ? { $stored: "object", entries: object } : object;
}

/** A value storedValueJson wrote, as it was stored. */
export function storedValueOf(json: unknown): unknown {
  if (json === null || typeof json !== "object") return json;
  if (Array.isArray(json)) return json.map(storedValueOf);
  const tagged = json as Record<string, unknown>;
  if (!("$stored" in tagged)) return Object.fromEntries(Object.entries(tagged).map(([name, entryValue]) => [name, storedValueOf(entryValue)]));
  if (tagged.$stored === "undefined") return undefined;
  if (tagged.$stored === "bigint") return BigInt(tagged.text as string);
  if (tagged.$stored === "date") return new Date(tagged.ms as number);
  if (tagged.$stored === "map") return new Map((tagged.entries as [unknown, unknown][]).map(([entryKey, entryValue]) => [storedValueOf(entryKey), storedValueOf(entryValue)]));
  if (tagged.$stored === "set") return new Set((tagged.values as unknown[]).map(storedValueOf));
  if (tagged.$stored === "object") return Object.fromEntries(Object.entries(tagged.entries as Record<string, unknown>).map(([name, entryValue]) => [name, storedValueOf(entryValue)]));
  if (tagged.$stored === "bytes") {
    const bytes = Uint8Array.from(atob(tagged.base64 as string), (character) => character.charCodeAt(0));
    const View = typeof tagged.view === "string" ? (globalThis as unknown as Record<string, unknown>)[tagged.view] : undefined;
    if (typeof View !== "function") return bytes.buffer;
    const bytesPerElement = (View as unknown as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ?? 1;
    return new (View as new (buffer: ArrayBuffer, offsetBytes: number, elementCount: number) => unknown)(bytes.buffer, 0, bytes.byteLength / bytesPerElement);
  }
  throw new Error(`A kept room's backup holds a value tagged ${String(tagged.$stored)}, which no backup writes.`);
}

function bytesBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

function stateKeyOf(stateText: string, matchPlayers: Player[]): string {
  return `${matchPlayers.map((player) => player.id).join(" ")}\n${stateText}`;
}

/** How many bytes a text takes as UTF-8, without making a copy of it. */
function utf8SizeBytes(text: string): number {
  let sizeBytes = text.length;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0x800 && (code < 0xd800 || code > 0xdfff)) sizeBytes += 2;
    else if (code >= 0x80 && (code < 0xd800 || code > 0xdfff)) sizeBytes += 1;
    // A surrogate pair is 4 bytes for 2 characters: 1 extra each.
    else if (code >= 0xd800 && code <= 0xdfff) sizeBytes += 1;
  }
  return sizeBytes;
}
