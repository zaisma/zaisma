import { PLAYER_HOUR_INCLUDED_CPU_DURATION_SEC } from "./rooms.ts";

/**
 * Hosting on one meter (docs/DECISIONS.md, "Hosting is priced with a margin, with a free tier, and prepaid above
 * it"): everything a game runs on Zaisma's servers (room time, game server CPU, relayed data, its database and its
 * game server requests) costs cents at twice what Cloudflare charges us, and every game gets
 * FREE_HOSTING_CENTS_PER_MONTH of it free each month (UTC), shown only as a percentage. Past it, a game with a
 * budget draws from its developer's credit (credit.ts); one without stops. Game files, saves, sign-in, publishing
 * and spectators stay off the meter on purpose.
 */

/** What each thing costs a game on Zaisma, in US cents (Julius, Oct 16, 17, 20 and 22, 2026). */
export const HOSTING_PRICES = {
  /** $2 per 1,000 player-hours in Zaisma rooms. */
  roomPlayCentsPerHour: 0.2,
  /** Game server CPU each player-hour in rooms includes. */
  includedCpuDurationSecPerPlayerHour: PLAYER_HOUR_INCLUDED_CPU_DURATION_SEC,
  /** Game server CPU each request, schedule run and webhook includes; past it, it's CPU. */
  includedCpuDurationMsPerRequest: 10,
  /** $1.60 per million game server requests, a schedule's run counting as one. */
  requestCentsPerRequest: 0.00016,
  /** $0.04 per 1,000 CPU-seconds of game server past what's included. */
  gameServerCpuCentsPerSec: 0.004,
  /** $0.10 per GB Zaisma's relay sends a game's players. */
  relayedCentsPerByte: 1e-8,
  /** $2 per million rows the game database writes. */
  writtenRowCentsPerRow: 0.0002,
  /** $0.002 per million rows it reads. */
  readRowCentsPerRow: 0.0000002,
  /** $0.40 per GB-month the game's storage (its database and kept rooms) keeps. */
  storedCentsPerByteMonth: 4e-8,
} as const;

/** The free allowance every game gets each month: $5 at the prices above, about 2,500 player-hours of rooms alone. */
export const FREE_HOSTING_CENTS_PER_MONTH = 500;

/** What a game's use is shared out as, on the meter. */
export const HOSTING_KINDS = ["room_play", "game_server_cpu", "relayed_data", "database", "requests"] as const;
export type HostingKind = (typeof HOSTING_KINDS)[number];

/** Why a game's hosting is paused this month: its free allowance with no budget, its budget, or its developer's credit. */
export const PAUSED_REASONS = ["free_used", "budget_used", "credit_used"] as const;
export type PausedReason = (typeof PAUSED_REASONS)[number];

/** A game's raw use over a month, as room_usage adds it up. */
export interface HostingUse {
  roomPlayDurationSec: number;
  relayedSizeBytes: number;
  /** Game server CPU in its rooms. */
  roomCpuDurationMs: number;
  /** Game server CPU in requests, schedule runs and webhooks past the first includedCpuDurationMsPerRequest of each. */
  outsideRoomCpuDurationMs: number;
  /** Requests and webhook events to the game server. */
  requestCount: number;
  scheduledRunCount: number;
  writtenRowCount: number;
  readRowCount: number;
  /** The storage kept so far this month, as bytes kept for a whole month: each day's size, a day at a time. */
  monthStoredSizeBytes: number;
  /** The storage's size as last recorded. */
  databaseSizeBytes: number;
}

/** A month's use in cents per kind and in total, fractions kept. */
export function hostingCostCents(use: HostingUse): { kinds: Record<HostingKind, number>; totalCents: number } {
  const prices = HOSTING_PRICES;
  const includedRoomCpuSec = (prices.includedCpuDurationSecPerPlayerHour * use.roomPlayDurationSec) / 3600;
  const cpuSec = Math.max(0, use.roomCpuDurationMs / 1000 - includedRoomCpuSec) + use.outsideRoomCpuDurationMs / 1000;
  const kinds: Record<HostingKind, number> = {
    room_play: (use.roomPlayDurationSec / 3600) * prices.roomPlayCentsPerHour,
    game_server_cpu: cpuSec * prices.gameServerCpuCentsPerSec,
    relayed_data: use.relayedSizeBytes * prices.relayedCentsPerByte,
    database: use.writtenRowCount * prices.writtenRowCentsPerRow + use.readRowCount * prices.readRowCentsPerRow + use.monthStoredSizeBytes * prices.storedCentsPerByteMonth,
    requests: (use.requestCount + use.scheduledRunCount) * prices.requestCentsPerRequest,
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

/**
 * A game's use this month (UTC) from room_usage, in cents per kind and in total, with the share of the free
 * allowance it is. Storage counts each day at the size last recorded on or before it (the database records it
 * while it's used), today for the part of it that's gone.
 */
export async function hostingUseThisMonth(database: D1Database, gameId: string, nowMs = Date.now()): Promise<{ use: HostingUse; kinds: Record<HostingKind, number>; totalCents: number; freeUsedPct: number }> {
  const monthStart = monthStartDateOf(nowMs);
  const [{ results: days }, before] = await Promise.all([
    database
      .prepare(
        "SELECT date, room_play_duration_sec, relayed_size_bytes, game_server_cpu_duration_ms, outside_room_cpu_duration_ms, game_server_request_count, game_server_scheduled_run_count, database_written_row_count, database_read_row_count, database_size_bytes FROM room_usage WHERE game_id = ? AND date >= ? ORDER BY date",
      )
      .bind(gameId, monthStart)
      .all<{
        date: string;
        room_play_duration_sec: number;
        relayed_size_bytes: number;
        game_server_cpu_duration_ms: number;
        outside_room_cpu_duration_ms: number;
        game_server_request_count: number;
        game_server_scheduled_run_count: number;
        database_written_row_count: number;
        database_read_row_count: number;
        database_size_bytes: number;
      }>(),
    database.prepare("SELECT database_size_bytes FROM room_usage WHERE game_id = ? AND date < ? AND database_size_bytes > 0 ORDER BY date DESC LIMIT 1").bind(gameId, monthStart).first<{ database_size_bytes: number }>(),
  ]);
  const use: HostingUse = { roomPlayDurationSec: 0, relayedSizeBytes: 0, roomCpuDurationMs: 0, outsideRoomCpuDurationMs: 0, requestCount: 0, scheduledRunCount: 0, writtenRowCount: 0, readRowCount: 0, monthStoredSizeBytes: 0, databaseSizeBytes: before?.database_size_bytes ?? 0 };
  for (const day of days) {
    use.roomPlayDurationSec += day.room_play_duration_sec;
    use.relayedSizeBytes += day.relayed_size_bytes;
    use.roomCpuDurationMs += day.game_server_cpu_duration_ms;
    use.outsideRoomCpuDurationMs += day.outside_room_cpu_duration_ms;
    use.requestCount += day.game_server_request_count;
    use.scheduledRunCount += day.game_server_scheduled_run_count;
    use.writtenRowCount += day.database_written_row_count;
    use.readRowCount += day.database_read_row_count;
  }
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
