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

/** What a game's use is shared out as, on the meter. */
export const HOSTING_KINDS = ["rooms", "game_server", "relayed_data", "database", "requests", "adult_chat_checks"] as const;
export type HostingKind = (typeof HOSTING_KINDS)[number];

/** Why a game's hosting is paused this month: its free allowance with no budget, its budget, or its developer's credit. */
export const PAUSED_REASONS = ["free_used", "budget_used", "credit_used"] as const;
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

/** How much of the free allowance cents use, in whole percent, at most 100. */
export const freeUsedPct = (usedCents: number) => Math.min(100, Math.floor((usedCents / FREE_HOSTING_CENTS_PER_MONTH) * 100));

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

/**
 * A game's use this month (UTC) from room_usage, in cents per kind and in total, with the share of the free
 * allowance it is. Storage counts each day at the size last recorded on or before it (the database records it
 * while it's used), today for the part of it that's gone.
 */
export async function hostingUseThisMonth(database: D1Database, gameId: string, nowMs = Date.now()): Promise<{ use: HostingUse; kinds: Record<HostingKind, number>; totalCents: number; freeUsedPct: number }> {
  const monthStart = monthStartDateOf(nowMs);
  const nextMonthStart = monthStartDateOf(Date.parse(`${monthStart}T00:00:00Z`) + 32 * DAY_MS);
  const [{ results: days }, before, loaded] = await Promise.all([
    database
      .prepare(`SELECT date, ${USAGE_COLUMNS.join(", ")}, database_size_bytes FROM room_usage WHERE game_id = ? AND date >= ? AND date < ? ORDER BY date`)
      .bind(gameId, monthStart, nextMonthStart)
      .all<Record<(typeof USAGE_COLUMNS)[number] | "database_size_bytes", number> & { date: string }>(),
    database.prepare("SELECT database_size_bytes FROM room_usage WHERE game_id = ? AND date < ? AND database_size_bytes > 0 ORDER BY date DESC LIMIT 1").bind(gameId, monthStart).first<{ database_size_bytes: number }>(),
    database.prepare("SELECT COUNT(*) AS loaded_version_count FROM loaded_versions WHERE game_id = ? AND date >= ? AND date < ?").bind(gameId, monthStart, nextMonthStart).first<{ loaded_version_count: number }>(),
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
  return { use, kinds, totalCents, freeUsedPct: freeUsedPct(totalCents) };
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
}

/** A game's month on the meter, or nothing used yet. */
export async function gameHostingMonth(database: D1Database, gameId: string, nowMs = Date.now()): Promise<GameHostingMonth> {
  const monthStart = monthStartDateOf(nowMs);
  const row = await database.prepare("SELECT * FROM game_hosting_months WHERE game_id = ? AND month_start_date = ?").bind(gameId, monthStart).first<GameHostingMonth>();
  return row ?? { game_id: gameId, month_start_date: monthStart, used_cents: 0, charged_cents: 0, written_off_cents: 0, paused_at_ms: null, paused_reason: null };
}

/**
 * Whether a game's hosting is paused this month: the site's hosting job is the one judge, so rooms, the relay,
 * requests and the database all read it here. A new month starts unpaused.
 */
export async function isHostingPaused(database: D1Database, gameId: string, nowMs = Date.now()): Promise<{ isPaused: boolean; pausedAtMs: number | null; pausedReason: PausedReason | null }> {
  const row = await database
    .prepare("SELECT paused_at_ms, paused_reason FROM game_hosting_months WHERE game_id = ? AND month_start_date = ?")
    .bind(gameId, monthStartDateOf(nowMs))
    .first<{ paused_at_ms: number | null; paused_reason: PausedReason | null }>();
  const pausedAtMs = row?.paused_at_ms ?? null;
  return { isPaused: pausedAtMs !== null, pausedAtMs, pausedReason: pausedAtMs !== null ? (row?.paused_reason ?? null) : null };
}

/** What a player or game server hears when a game's hosting is paused. */
export const HOSTING_PAUSED_TEXT = "This game's hosting is paused. It starts again when the month resets or its developer adds credit.";
