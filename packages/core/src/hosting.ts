import type { DoorLimitBinding } from "./doors.ts";
/**
 * Hosting on one meter (docs/DECISIONS.md, "Hosting is priced with a margin, with a free tier, and prepaid above
 * it", and "Hosting is priced by value"): every charge Cloudflare bills Zaisma for a game, with no gaps, and the chat
 * filter's AI checks between adults when a game turns them on, cost the game cents at the prices below, and every game gets FREE_HOSTING_CENTS_PER_MONTH of it free each month (UTC),
 * shown only as a percentage. Past it, a game with a budget draws from its developer's credit (credit.ts); one
 * without stops. Game files, saves, sign-in, publishing and spectators stay off the meter on purpose.
 */

/** What each thing costs a game on Zaisma, in US cents (Julius, Oct 26, 2026). */
export const HOSTING_PRICES = {
  /** $0.08 per 1,000 CPU-seconds of game server, wherever it runs, its startup included. */
  gameServerCpuCentsPerSec: 0.008,
  /** $1.20 per million sessions opened with a game server: a room starting it, a restart after a failure, the game's object waking. */
  gameServerSessionCentsPerSession: 0.00012,
  /** $0.008 for each version of a game server loaded on a day (UTC). */
  loadedVersionCentsPerDay: 0.8,
  /** $23.04 per 1,000 hours the game's rooms, its game server object and its database are awake. */
  awakeCentsPerSec: 0.00064,
  /** $0.03 per million messages players send to rooms. */
  inboundMessageCentsPerMessage: 0.000003,
  /** $1.80 per million times a player connects to a room. */
  roomConnectionCentsPerConnection: 0.00018,
  /** $0.60 per million times a room wakes on its own or is called by another of the game's rooms, or calls the game's object. */
  objectRequestCentsPerRequest: 0.00006,
  /** $0.60 per million calls to the game's database. */
  databaseCallCentsPerCall: 0.00006,
  /** $1.80 per million game server requests, a schedule's run and a webhook event counting as one. */
  requestCentsPerRequest: 0.00018,
  /** $0.20 per GB Zaisma's relay sends a game's players. */
  relayedCentsPerByte: 2e-8,
  /** $4 per million rows written: the game database's, and those Zaisma writes for the game (room lists, saves, its usage). */
  writtenRowCentsPerRow: 0.0004,
  /** $0.004 per million rows the game database reads. */
  readRowCentsPerRow: 0.0000004,
  /** $0.80 per GB-month the game's storage (its database and kept rooms) keeps. */
  storedCentsPerByteMonth: 8e-8,
  /** $18 per million files of the game server's logs written. */
  logFileCentsPerFile: 0.0018,
  /** $0.20 per 1,000 AI checks of chat between adults, for a game server with adultChatFilterEnabled: Zaisma pays for under-18s' checks. */
  adultChatCheckCentsPerCheck: 0.02,
} as const;

/** Each call a game server makes to another server counts this much game server CPU: the gateway's own work. */
export const OUTSIDE_CALL_CPU_DURATION_MS = 1;

/** The free allowance every game gets each month, at the prices above. */
export const FREE_HOSTING_CENTS_PER_MONTH = 1000;

/** A game's free allowance in a month: twice the size in the month it had its second one, the first time it filled one. */
export const freeAllowanceCents = (secondFreeAllowanceMonthStartDate: string | null, monthStartDate: string) => (secondFreeAllowanceMonthStartDate === monthStartDate ? 2 : 1) * FREE_HOSTING_CENTS_PER_MONTH;

/**
 * Where a game's free hosting really ends this month: a game with real players that hasn't had its second allowance has
 * it still to come. A game with no real players doesn't get it yet, and doesn't lose it.
 */
export const freeHostingEndCents = (secondFreeAllowanceMonthStartDate: string | null, monthStartDate: string, hasRealPlayersNow = true) => (secondFreeAllowanceMonthStartDate === null && hasRealPlayersNow ? 2 * FREE_HOSTING_CENTS_PER_MONTH : freeAllowanceCents(secondFreeAllowanceMonthStartDate, monthStartDate));

/** The fewest browsers that make a game played. */
export const MINIMUM_REAL_PLAYER_COUNT = 2;
/** Past that, one browser for this much of what the game really costs Zaisma, in cents. */
export const REAL_PLAYER_COST_CENTS = 15;

/** Whether a game's browsers this month (counted plays off cloud networks, and tester links') clear its bar, which rises with its use. */
export const hasRealPlayers = (realPlayerCount: number, usedCents: number, meterCostSharePct: number) => realPlayerCount >= Math.max(MINIMUM_REAL_PLAYER_COUNT, Math.ceil(((usedCents * meterCostSharePct) / 100) / REAL_PLAYER_COST_CENTS));

/** A game's share of the shared database: new joins, passes, plays and saves a minute, per shard of GAME_LIMIT. */
export const GAME_LIMIT_PLAYER_COUNT_PER_SHARD = 25;
/** So one game tops out at about 400 calls a second, and the shared database keeps room for every other game. */
export const MAXIMUM_GAME_LIMIT_SHARD_COUNT = 40;

/** A game's shards, which grow with its real players by themselves: nobody asks. */
export const gameLimitShardCount = (realPlayerCount: number) => Math.min(MAXIMUM_GAME_LIMIT_SHARD_COUNT, 1 + Math.floor(realPlayerCount / GAME_LIMIT_PLAYER_COUNT_PER_SHARD));

/** Games' real player counts this isolate read, for a minute: passes and joins are the busiest thing the shared database does, so this adds only one read a minute. */
const gameRealPlayerCounts = new Map<string, { realPlayerCount: number; readAtMs: number }>();
const GAME_LIMIT_READ_INTERVAL_MS = 60_000;

/**
 * Whether a new join, pass, play or save goes past its game's share of the shared database. A player lands on one shard by
 * subject, so a game with more real players has more room, by itself. Running matches never come here. A database that
 * can't answer lets the call through: this protects the database, and the call will find out for itself.
 */
export async function isPastGameLimit(env: { GAME_LIMIT?: DoorLimitBinding }, database: D1Database, gameId: string, subject: string, nowMs = Date.now()): Promise<boolean> {
  if (!env.GAME_LIMIT) return false;
  let known = gameRealPlayerCounts.get(gameId);
  if (!known || nowMs - known.readAtMs > GAME_LIMIT_READ_INTERVAL_MS) {
    if (gameRealPlayerCounts.size > 10_000) gameRealPlayerCounts.clear();
    const row = await database.prepare("SELECT real_player_count FROM game_hosting_months WHERE game_id = ? AND month_start_date = ?").bind(gameId, monthStartDateOf(nowMs)).first<{ real_player_count: number }>().catch(() => null);
    known = { realPlayerCount: row?.real_player_count ?? 0, readAtMs: nowMs };
    gameRealPlayerCounts.set(gameId, known);
  }
  let subjectHashNumber = 2166136261;
  for (let index = 0; index < subject.length; index++) subjectHashNumber = Math.imul(subjectHashNumber ^ subject.charCodeAt(index), 16777619);
  const shardIndex = (subjectHashNumber >>> 0) % gameLimitShardCount(known.realPlayerCount);
  const answer = await env.GAME_LIMIT.limit({ key: `${gameId}:${shardIndex}` });
  return !("success" in answer && answer.success === true);
}

/**
 * An answer's fields no door declared, by door and day (docs/DOORS.md): the first of a day raises one alert, from the site's
 * job. Only the field's path is kept, never its value. A cut happens only when an answer and its schema disagree: a bug.
 */
export async function noteAnswerCut(database: D1Database, doorId: string, cutPaths: readonly string[], nowMs = Date.now()): Promise<void> {
  await database
    .prepare("INSERT INTO door_answer_cuts (door_id, date, field_paths, occurrence_count, first_cut_at_ms) VALUES (?, ?, ?, 1, ?) ON CONFLICT (door_id, date) DO UPDATE SET occurrence_count = occurrence_count + 1")
    .bind(doorId, new Date(nowMs).toISOString().slice(0, 10), cutPaths.slice(0, 20).join(", ").slice(0, 2000), nowMs)
    .run();
}

/** What a game's use is shared out as, on the meter. */
export const HOSTING_KINDS = ["rooms", "game_server", "relayed_data", "database", "requests", "adult_chat_checks"] as const;
export type HostingKind = (typeof HOSTING_KINDS)[number];

/**
 * Why a game's hosting is paused this month: its free allowance with no budget, its budget, its developer's credit, the
 * share of free hosting games with no real players have (spending.ts), or the end of Zaisma's free hosting for the month.
 */
export const PAUSED_REASONS = ["free_used", "budget_used", "credit_used", "no_real_players", "free_hosting_ended"] as const;
export type PausedReason = (typeof PAUSED_REASONS)[number];

/** A game's raw use over a month, as room_usage adds it up. Every count but HOSTING_USE_FACTS is priced. */
export interface HostingUse {
  /** The time the game's rooms were awake: a ticking room all the while, a sleeping one up to 10 seconds after each event. */
  roomAwakeDurationSec: number;
  /** Messages players sent to its rooms. */
  inboundMessageCount: number;
  /** Players connecting to its rooms (spectators aren't counted). */
  roomConnectionCount: number;
  /** Rooms waking on their own, called by other rooms, or calling the game's object; and the object's own wakes. */
  objectRequestCount: number;
  /** Rows Zaisma wrote for the game: room lists, room saves, seats, its usage. */
  bookkeepingWrittenRowCount: number;
  /** Game server CPU in its rooms. */
  roomCpuDurationMs: number;
  /** Game server CPU in requests, schedule runs and webhooks. */
  outsideRoomCpuDurationMs: number;
  /** Game server CPU starting up: loading its code and opening each session. */
  startupCpuDurationMs: number;
  /** Calls the game server made to other servers. */
  outsideCallCount: number;
  /** Sessions opened with the game server. */
  gameServerSessionCount: number;
  /** Versions of the game server loaded, once each a day. */
  loadedVersionCount: number;
  /** Files of the game server's logs written. */
  logFileCount: number;
  relayedSizeBytes: number;
  /** Requests and webhook events to the game server. */
  requestCount: number;
  scheduledRunCount: number;
  /** The time the game's own object (requests, schedules, webhooks) was awake. */
  objectAwakeDurationSec: number;
  writtenRowCount: number;
  readRowCount: number;
  /** Calls to the game's database. */
  databaseCallCount: number;
  databaseAwakeDurationSec: number;
  /** The storage kept so far this month, as bytes kept for a whole month: each day's size, a day at a time. */
  monthStoredSizeBytes: number;
  /** The chat filter's AI checks of chat between adults (adultChatFilterEnabled). */
  adultChatCheckCount: number;
  /** Player time in its rooms: a fact, never priced. */
  roomPlayDurationSec: number;
  /** The storage's size as last recorded: a fact, priced as monthStoredSizeBytes. */
  databaseSizeBytes: number;
}

/** HostingUse's counts that are facts, not priced themselves. */
export const HOSTING_USE_FACTS = ["roomPlayDurationSec", "databaseSizeBytes"] as const satisfies readonly (keyof HostingUse)[];

/** No use yet. */
export const noHostingUse = (): HostingUse => ({
  roomAwakeDurationSec: 0,
  inboundMessageCount: 0,
  roomConnectionCount: 0,
  objectRequestCount: 0,
  bookkeepingWrittenRowCount: 0,
  roomCpuDurationMs: 0,
  outsideRoomCpuDurationMs: 0,
  startupCpuDurationMs: 0,
  outsideCallCount: 0,
  gameServerSessionCount: 0,
  loadedVersionCount: 0,
  logFileCount: 0,
  relayedSizeBytes: 0,
  requestCount: 0,
  scheduledRunCount: 0,
  objectAwakeDurationSec: 0,
  writtenRowCount: 0,
  readRowCount: 0,
  databaseCallCount: 0,
  databaseAwakeDurationSec: 0,
  monthStoredSizeBytes: 0,
  adultChatCheckCount: 0,
  roomPlayDurationSec: 0,
  databaseSizeBytes: 0,
});

/** All the game server's CPU, in seconds: in rooms and outside them, starting up, and its outside calls. */
export const gameServerCpuSec = (use: HostingUse) => (use.roomCpuDurationMs + use.outsideRoomCpuDurationMs + use.startupCpuDurationMs + use.outsideCallCount * OUTSIDE_CALL_CPU_DURATION_MS) / 1000;

/** A month's use in cents per kind and in total, fractions kept. */
export function hostingCostCents(use: HostingUse): { kinds: Record<HostingKind, number>; totalCents: number } {
  const prices = HOSTING_PRICES;
  const kinds: Record<HostingKind, number> = {
    rooms:
      use.roomAwakeDurationSec * prices.awakeCentsPerSec +
      use.inboundMessageCount * prices.inboundMessageCentsPerMessage +
      use.roomConnectionCount * prices.roomConnectionCentsPerConnection +
      use.objectRequestCount * prices.objectRequestCentsPerRequest +
      use.bookkeepingWrittenRowCount * prices.writtenRowCentsPerRow,
    game_server:
      gameServerCpuSec(use) * prices.gameServerCpuCentsPerSec +
      use.gameServerSessionCount * prices.gameServerSessionCentsPerSession +
      use.loadedVersionCount * prices.loadedVersionCentsPerDay +
      use.logFileCount * prices.logFileCentsPerFile,
    relayed_data: use.relayedSizeBytes * prices.relayedCentsPerByte,
    database:
      use.writtenRowCount * prices.writtenRowCentsPerRow +
      use.readRowCount * prices.readRowCentsPerRow +
      use.monthStoredSizeBytes * prices.storedCentsPerByteMonth +
      use.databaseCallCount * prices.databaseCallCentsPerCall +
      use.databaseAwakeDurationSec * prices.awakeCentsPerSec,
    requests: (use.requestCount + use.scheduledRunCount) * prices.requestCentsPerRequest + use.objectAwakeDurationSec * prices.awakeCentsPerSec,
    adult_chat_checks: use.adultChatCheckCount * prices.adultChatCheckCentsPerCheck,
  };
  return { kinds, totalCents: HOSTING_KINDS.reduce((sumCents, kind) => sumCents + kinds[kind], 0) };
}

/** How much of the month's free allowance cents use, in whole percent, at most 100. */
export const freeUsedPct = (usedCents: number, allowanceCents = FREE_HOSTING_CENTS_PER_MONTH) => Math.min(100, Math.floor((usedCents / allowanceCents) * 100));

/** Each kind's share of the use, in whole percent adding to 100 (largest remainders), biggest first; none for no use. */
export function hostingShares(kinds: Record<HostingKind, number>): { kind: HostingKind; sharePct: number }[] {
  const totalCents = HOSTING_KINDS.reduce((sumCents, kind) => sumCents + kinds[kind], 0);
  if (totalCents <= 0) return [];
  const exact = HOSTING_KINDS.map((kind) => ({ kind, exactPct: (kinds[kind] / totalCents) * 100 }));
  const shares = exact.map(({ kind, exactPct }) => ({ kind, sharePct: Math.floor(exactPct), remainder: exactPct - Math.floor(exactPct) }));
  let missingPct = 100 - shares.reduce((sumPct, share) => sumPct + share.sharePct, 0);
  for (const share of [...shares].sort((first, second) => second.remainder - first.remainder)) {
    if (missingPct-- <= 0) break;
    share.sharePct++;
  }
  return shares.filter((share) => share.sharePct > 0).sort((first, second) => second.sharePct - first.sharePct).map(({ kind, sharePct }) => ({ kind, sharePct }));
}

/** The month a time is in, as its first day like "2026-10-01" (UTC). */
export const monthStartDateOf = (nowMs = Date.now()) => `${new Date(nowMs).toISOString().slice(0, 7)}-01`;

const DAY_MS = 24 * 3600_000;

/** room_usage's columns a month adds up, and the HostingUse count each goes to. */
const USAGE_FIELDS = {
  room_play_duration_sec: "roomPlayDurationSec",
  room_awake_duration_sec: "roomAwakeDurationSec",
  message_count: "inboundMessageCount",
  room_connection_count: "roomConnectionCount",
  object_request_count: "objectRequestCount",
  bookkeeping_written_row_count: "bookkeepingWrittenRowCount",
  relayed_size_bytes: "relayedSizeBytes",
  game_server_cpu_duration_ms: "roomCpuDurationMs",
  outside_room_cpu_duration_ms: "outsideRoomCpuDurationMs",
  game_server_startup_cpu_duration_ms: "startupCpuDurationMs",
  outside_call_count: "outsideCallCount",
  game_server_session_count: "gameServerSessionCount",
  log_file_count: "logFileCount",
  game_server_request_count: "requestCount",
  game_server_scheduled_run_count: "scheduledRunCount",
  object_awake_duration_sec: "objectAwakeDurationSec",
  database_written_row_count: "writtenRowCount",
  database_read_row_count: "readRowCount",
  database_call_count: "databaseCallCount",
  database_awake_duration_sec: "databaseAwakeDurationSec",
  adult_chat_check_count: "adultChatCheckCount",
} as const satisfies Record<string, keyof HostingUse>;
const USAGE_COLUMNS = Object.keys(USAGE_FIELDS) as (keyof typeof USAGE_FIELDS)[];
/** room_usage's split of a game's play and use: facts about who used it, never priced on their own. */
const PLAY_SPLIT_COLUMNS = ["new_player_room_play_duration_sec", "rented_network_room_play_duration_sec", "rented_share_room_use_cents", "rented_share_request_count", "rented_share_relay_credential_count", "relay_credential_count"] as const;

/**
 * A game's use this month (UTC) from room_usage, in cents per kind and in total, with the share of the free
 * allowance it is. Storage counts each day at the size last recorded on or before it (the database records it
 * while it's used), today for the part of it that's gone.
 */
export async function hostingUseThisMonth(database: D1Database, gameId: string, nowMs = Date.now()): Promise<{ use: HostingUse; playSplit: Record<(typeof PLAY_SPLIT_COLUMNS)[number], number>; kinds: Record<HostingKind, number>; totalCents: number; freeUsedPct: number; secondFreeAllowanceMonthStartDate: string | null }> {
  const monthStart = monthStartDateOf(nowMs);
  const nextMonthStart = monthStartDateOf(Date.parse(`${monthStart}T00:00:00Z`) + 32 * DAY_MS);
  const [{ results: days }, before, loaded, game] = await Promise.all([
    database
      .prepare(`SELECT date, ${USAGE_COLUMNS.join(", ")}, database_size_bytes, ${PLAY_SPLIT_COLUMNS.join(", ")} FROM room_usage WHERE game_id = ? AND date >= ? AND date < ? ORDER BY date`)
      .bind(gameId, monthStart, nextMonthStart)
      .all<Record<(typeof USAGE_COLUMNS)[number] | "database_size_bytes" | (typeof PLAY_SPLIT_COLUMNS)[number], number> & { date: string }>(),
    database.prepare("SELECT database_size_bytes FROM room_usage WHERE game_id = ? AND date < ? AND database_size_bytes > 0 ORDER BY date DESC LIMIT 1").bind(gameId, monthStart).first<{ database_size_bytes: number }>(),
    database.prepare("SELECT COUNT(*) AS loaded_version_count FROM loaded_versions WHERE game_id = ? AND date >= ? AND date < ?").bind(gameId, monthStart, nextMonthStart).first<{ loaded_version_count: number }>(),
    database.prepare("SELECT second_free_allowance_month_start_date FROM games WHERE id = ?").bind(gameId).first<{ second_free_allowance_month_start_date: string | null }>(),
  ]);
  const use: HostingUse = { ...noHostingUse(), loadedVersionCount: loaded?.loaded_version_count ?? 0, databaseSizeBytes: before?.database_size_bytes ?? 0 };
  for (const day of days) for (const column of USAGE_COLUMNS) use[USAGE_FIELDS[column]] += day[column] ?? 0;
  // Each day of the month so far, at the storage's size last recorded by then (a row with 0 is one the database didn't write).
  const now = new Date(nowMs);
  const monthStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const monthDayCount = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const sizeByDate = new Map(days.filter((day) => day.database_size_bytes > 0).map((day) => [day.date, day.database_size_bytes]));
  let sizeBytes = use.databaseSizeBytes;
  for (let dayStartMs = monthStartMs; dayStartMs <= nowMs; dayStartMs += DAY_MS) {
    sizeBytes = sizeByDate.get(new Date(dayStartMs).toISOString().slice(0, 10)) ?? sizeBytes;
    use.monthStoredSizeBytes += (sizeBytes * Math.min(1, (nowMs - dayStartMs) / DAY_MS)) / monthDayCount;
  }
  use.databaseSizeBytes = sizeBytes;
  const { kinds, totalCents } = hostingCostCents(use);
  const secondFreeAllowanceMonthStartDate = game?.second_free_allowance_month_start_date ?? null;
  const playSplit = Object.fromEntries(PLAY_SPLIT_COLUMNS.map((column) => [column, days.reduce((sum, day) => sum + (day[column] ?? 0), 0)])) as Record<(typeof PLAY_SPLIT_COLUMNS)[number], number>;
  return { use, playSplit, kinds, totalCents, freeUsedPct: freeUsedPct(totalCents, freeAllowanceCents(secondFreeAllowanceMonthStartDate, monthStart)), secondFreeAllowanceMonthStartDate };
}

/** A game's month on the meter, as the site's hosting job last wrote it. */
export interface GameHostingMonth {
  game_id: string;
  month_start_date: string;
  used_cents: number;
  charged_cents: number;
  written_off_cents: number;
  paused_at_ms: number | null;
  paused_reason: PausedReason | null;
  /** Browsers with a counted play this month, off cloud networks, and tester links'. */
  real_player_count: number;
  /** What the rented share used, as the job last added it up, and when it ran out. */
  rented_share_used_cents: number;
  rented_share_stopped_at_ms: number | null;
  /** Whether they clear the game's bar, as the job last judged it (hasRealPlayers). */
  has_real_players: number;
}

/** A game's month on the meter, or nothing used yet. */
export async function gameHostingMonth(database: D1Database, gameId: string, nowMs = Date.now()): Promise<GameHostingMonth> {
  const monthStart = monthStartDateOf(nowMs);
  const row = await database.prepare("SELECT * FROM game_hosting_months WHERE game_id = ? AND month_start_date = ?").bind(gameId, monthStart).first<GameHostingMonth>();
  return row ?? { game_id: gameId, month_start_date: monthStart, used_cents: 0, charged_cents: 0, written_off_cents: 0, paused_at_ms: null, paused_reason: null, real_player_count: 0, rented_share_used_cents: 0, rented_share_stopped_at_ms: null, has_real_players: 0 };
}

/** What stops a game this month, as its doors read it. */
export interface GameHosting {
  /** When everything it runs paused, null when it runs. */
  pausedAtMs: number | null;
  pausedReason: PausedReason | null;
  /** When the month's limit stopped new rooms and relayed connections, for a free game; null otherwise. */
  freeRoomsStoppedAtMs: number | null;
  /** When the traffic on rented networks used its share of the game (rented-share.ts): those players stop, and everyone else plays on. */
  rentedShareStoppedAtMs: number | null;
}

/**
 * What stops a game this month. The site's hosting and spending jobs are the judges, so rooms, the relay, requests and
 * the database all read it here, in one query. A new month starts with nothing. A free game has no budget, or a budget
 * and no credit: Zaisma pays for all of its hosting. Read at the door, so a game with no meter row yet is covered, and
 * a budget with credit lifts the month's stops for it at once. A game with no owner isn't on the meter.
 */
export async function gameHosting(database: D1Database, gameId: string, nowMs = Date.now()): Promise<GameHosting> {
  const row = await database
    .prepare(
      `SELECT games.owner_id, games.monthly_budget_cents, owners.credit_balance_cents, month.paused_at_ms, month.paused_reason, month.has_real_players, month.rented_share_stopped_at_ms, spending.free_rooms_stopped_at_ms, spending.unplayed_games_stopped_at_ms, spending.free_hosting_ended_at_ms
       FROM (SELECT ?2 AS id) AS asked LEFT JOIN games ON games.id = asked.id LEFT JOIN owners ON owners.id = games.owner_id
       LEFT JOIN game_hosting_months AS month ON month.game_id = asked.id AND month.month_start_date = ?1
       LEFT JOIN spending_months AS spending ON spending.month_start_date = ?1`,
    )
    .bind(monthStartDateOf(nowMs), gameId)
    .first<{ owner_id: string | null; monthly_budget_cents: number | null; credit_balance_cents: number | null; paused_at_ms: number | null; paused_reason: PausedReason | null; has_real_players: number | null; rented_share_stopped_at_ms: number | null; free_rooms_stopped_at_ms: number | null; unplayed_games_stopped_at_ms: number | null; free_hosting_ended_at_ms: number | null }>();
  const rentedShareStoppedAtMs = row?.rented_share_stopped_at_ms ?? null;
  if (row?.paused_at_ms != null) return { pausedAtMs: row.paused_at_ms, pausedReason: row.paused_reason, freeRoomsStoppedAtMs: null, rentedShareStoppedAtMs };
  const isFree = row?.owner_id != null && (row.monthly_budget_cents === null || (row.credit_balance_cents ?? 0) <= 0);
  if (!row || !isFree) return { pausedAtMs: null, pausedReason: null, freeRoomsStoppedAtMs: null, rentedShareStoppedAtMs };
  if (row.free_hosting_ended_at_ms !== null) return { pausedAtMs: row.free_hosting_ended_at_ms, pausedReason: "free_hosting_ended", freeRoomsStoppedAtMs: null, rentedShareStoppedAtMs };
  if (row.unplayed_games_stopped_at_ms !== null && !row.has_real_players) return { pausedAtMs: row.unplayed_games_stopped_at_ms, pausedReason: "no_real_players", freeRoomsStoppedAtMs: null, rentedShareStoppedAtMs };
  return { pausedAtMs: null, pausedReason: null, freeRoomsStoppedAtMs: row.free_rooms_stopped_at_ms, rentedShareStoppedAtMs };
}

/** Whether a game's hosting is paused this month: requests, schedules and everything else it runs. */
export async function isHostingPaused(database: D1Database, gameId: string, nowMs = Date.now()): Promise<{ isPaused: boolean; pausedAtMs: number | null; pausedReason: PausedReason | null }> {
  const { pausedAtMs, pausedReason } = await gameHosting(database, gameId, nowMs);
  return { isPaused: pausedAtMs !== null, pausedAtMs, pausedReason };
}

/** Whether a game can start rooms and relayed connections: its pause, or the month's limit. pausedAtMs is one moment for every room, so they end together. */
export async function roomHostingOf(database: D1Database, gameId: string, nowMs = Date.now()): Promise<{ isPaused: boolean; pausedAtMs: number | null }> {
  const hosting = await gameHosting(database, gameId, nowMs);
  const pausedAtMs = hosting.pausedAtMs ?? hosting.freeRoomsStoppedAtMs;
  return { isPaused: pausedAtMs !== null, pausedAtMs };
}

/** What a player or game server hears when a game's hosting is paused. */
export const HOSTING_PAUSED_TEXT = "This game's hosting is paused. It starts again when the month resets or its developer adds credit.";
