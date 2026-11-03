import { reviewCostCents } from "./review-evidence.ts";
import { monthStartDateOf } from "./hosting.ts";

/**
 * Zaisma's own month: what it pays, line by
 * line, against its limit. At the limit, free games start no new rooms or relayed connections until the month resets;
 * paying games go on, and so does everything else in a free game. The amounts live in the site Worker's secrets, never
 * here, since how the meter's prices relate to what they cost isn't published.
 */

/** The shares of the limit Julius hears at, and the last one is the stop. */
export const SPENDING_ALERT_PCTS = [70, 85, 100] as const;

/** R2's price: $0.015 per GB-month. */
export const STORED_COST_CENTS_PER_BYTE_MONTH = 1.5 / 1024 ** 3;
/** A performance check is about a minute of Browser Rendering, at $0.09 an hour. */
export const PERFORMANCE_CHECK_COST_CENTS = 0.15;
/** What a card payment costs: 2.9% and 30¢. */
const CARD_FEE_PCT = 2.9;
const CARD_FEE_CENTS = 30;

/** The private amounts, from the site Worker's secrets. */
export interface SpendingSettings {
  monthlyLimitCents: number;
  fixedCostCents: number;
  storageAndChecksCostCents: number;
  /** What the meter's prices really cost Zaisma, as a share of them. */
  meterCostSharePct: number;
}

/** The private amounts, or null while any is missing or isn't a number above zero. */
export function spendingSettingsOf(env: { MONTHLY_SPENDING_LIMIT_CENTS?: string; FIXED_COST_CENTS_PER_MONTH?: string; STORAGE_AND_CHECKS_COST_CENTS_PER_MONTH?: string; METER_COST_SHARE_PCT?: string }): SpendingSettings | null {
  const settings = {
    monthlyLimitCents: Number(env.MONTHLY_SPENDING_LIMIT_CENTS),
    fixedCostCents: Number(env.FIXED_COST_CENTS_PER_MONTH),
    storageAndChecksCostCents: Number(env.STORAGE_AND_CHECKS_COST_CENTS_PER_MONTH),
    meterCostSharePct: Number(env.METER_COST_SHARE_PCT),
  };
  return Object.values(settings).every((amount) => Number.isFinite(amount) && amount > 0) ? settings : null;
}

/** What the job reads from the database, before it's priced. */
export interface SpendingFacts {
  /** Reviews and the listing check, as they counted themselves. */
  reviewCostCents: number;
  /** Tokens of report triage, the forum and chat's checks, on aiModel. */
  aiInputTokenCount: number;
  aiOutputTokenCount: number;
  aiModel: string;
  storedSizeBytes: number;
  performanceCheckCount: number;
  /** This month's meter past what credit paid, at the meter's prices: the free allowances, the grace and what's written off. */
  unpaidMeterCents: number;
  /** Last month's charges to credit. */
  lastMonthHostingChargedCents: number;
  lastMonthStorageChargedCents: number;
  /** Last month's rows in earnings. */
  lastMonthEarningsCents: number;
}

/** The month's lines, in whole cents, rounded up so a line is never smaller than it is. */
export interface SpendingMonth {
  fixedCostCents: number;
  aiCostCents: number;
  storageAndChecksCostCents: number;
  freeHostingCostCents: number;
  spentCents: number;
  earnedLastMonthCents: number;
  limitCents: number;
}

/**
 * What the month has spent and may. Fixed costs and the storage line count whole from the 1st, the storage line going
 * higher only when what's measured does. A paying game's hosting isn't spending, since credit paid for it, so what's
 * earned is that credit less what it cost to serve. The storage charges count whole: what they cost is the storage line.
 */
export function spendingMonthOf(settings: SpendingSettings, facts: SpendingFacts): SpendingMonth {
  const fixedCostCents = Math.ceil(settings.fixedCostCents);
  const aiCostCents = Math.ceil(facts.reviewCostCents + reviewCostCents(facts.aiModel, { inputTokenCount: facts.aiInputTokenCount, outputTokenCount: facts.aiOutputTokenCount, cacheReadTokenCount: 0, cacheWriteTokenCount: 0 }));
  const measuredStorageCents = facts.storedSizeBytes * STORED_COST_CENTS_PER_BYTE_MONTH + facts.performanceCheckCount * PERFORMANCE_CHECK_COST_CENTS;
  const storageAndChecksCostCents = Math.ceil(Math.max(settings.storageAndChecksCostCents, measuredStorageCents));
  const freeHostingCostCents = Math.ceil((Math.max(0, facts.unpaidMeterCents) * settings.meterCostSharePct) / 100);
  const earnedLastMonthCents = Math.max(0, Math.floor((facts.lastMonthHostingChargedCents * (100 - settings.meterCostSharePct)) / 100 + facts.lastMonthStorageChargedCents + facts.lastMonthEarningsCents));
  return {
    fixedCostCents,
    aiCostCents,
    storageAndChecksCostCents,
    freeHostingCostCents,
    spentCents: fixedCostCents + aiCostCents + storageAndChecksCostCents + freeHostingCostCents,
    earnedLastMonthCents,
    limitCents: Math.ceil(settings.monthlyLimitCents) + earnedLastMonthCents,
  };
}

/** The alerts a month has reached and not been told: none, or the shares it went past, smallest first. */
export function newSpendingAlertPcts(month: Pick<SpendingMonth, "spentCents" | "limitCents">, toldPct: number): number[] {
  return SPENDING_ALERT_PCTS.filter((alertPct) => alertPct > toldPct && month.spentCents * 100 >= month.limitCents * alertPct);
}

/** What a payment earned: what's left after its card fee. Tax isn't Zaisma's, so it's never passed in. */
export const earnedAfterCardFeeCents = (paidCents: number) => Math.max(0, Math.floor(paidCents - (paidCents * CARD_FEE_PCT) / 100 - CARD_FEE_CENTS));

/** A game with no budget, or a budget and nothing to spend: Zaisma pays for all of its hosting. A game with no owner isn't on the meter. */
const isFreeGame = (game: { owner_id: string | null; monthly_budget_cents: number | null; credit_balance_cents: number | null }) => game.owner_id !== null && (game.monthly_budget_cents === null || (game.credit_balance_cents ?? 0) <= 0);

/**
 * Whether a game can start rooms and relayed connections: its own pause (isHostingPaused), else the month's stop if
 * it's a free game. Read at the door, in one query, so a game with no meter row yet is covered and a budget or credit
 * lifts the stop for it at once. pausedAtMs is the same moment for every room, so they all end together.
 */
export async function roomHostingOf(database: D1Database, gameId: string, nowMs = Date.now()): Promise<{ isPaused: boolean; pausedAtMs: number | null }> {
  const row = await database
    .prepare(
      `SELECT games.owner_id, games.monthly_budget_cents, owners.credit_balance_cents, game_hosting_months.paused_at_ms, spending_months.free_rooms_stopped_at_ms
       FROM games LEFT JOIN owners ON owners.id = games.owner_id
       LEFT JOIN game_hosting_months ON game_hosting_months.game_id = games.id AND game_hosting_months.month_start_date = ?1
       LEFT JOIN spending_months ON spending_months.month_start_date = ?1
       WHERE games.id = ?2`,
    )
    .bind(monthStartDateOf(nowMs), gameId)
    .first<{ owner_id: string | null; monthly_budget_cents: number | null; credit_balance_cents: number | null; paused_at_ms: number | null; free_rooms_stopped_at_ms: number | null }>();
  const pausedAtMs = row?.paused_at_ms ?? (row && isFreeGame(row) ? row.free_rooms_stopped_at_ms : null) ?? null;
  return { isPaused: pausedAtMs !== null, pausedAtMs };
}

/** When the month's stop reached this game, for what its developer sees: null when there's no stop or the game pays its way. */
export async function freeRoomsStoppedAtMs(database: D1Database, game: { id: string; owner_id: string | null; monthly_budget_cents: number | null }, nowMs = Date.now()): Promise<number | null> {
  const row = await database
    .prepare("SELECT spending_months.free_rooms_stopped_at_ms, (SELECT credit_balance_cents FROM owners WHERE id = ?) AS credit_balance_cents FROM spending_months WHERE month_start_date = ?")
    .bind(game.owner_id, monthStartDateOf(nowMs))
    .first<{ free_rooms_stopped_at_ms: number | null; credit_balance_cents: number | null }>();
  return row && isFreeGame({ ...game, credit_balance_cents: row.credit_balance_cents }) ? row.free_rooms_stopped_at_ms : null;
}

/** The month's row, as the job last wrote it, for the admin page. */
export const spendingMonthRow = (database: D1Database, nowMs = Date.now()) =>
  database.prepare("SELECT spent_cents, limit_cents, free_rooms_stopped_at_ms FROM spending_months WHERE month_start_date = ?").bind(monthStartDateOf(nowMs)).first<{ spent_cents: number; limit_cents: number; free_rooms_stopped_at_ms: number | null }>();
