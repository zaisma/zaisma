import { reviewCostCents } from "./review-evidence.ts";
import { monthStartDateOf } from "./hosting.ts";

/**
 * Zaisma's own month: what it pays, line by
 * line, against its limit. Games with no real players share a part of free hosting, and stop when it's gone, so a farm of
 * empty games can't reach the games people play. At the limit, free games start no new rooms or relayed connections;
 * past it by a set amount, everything else they run stops too, so the bill can't run on. Paying games go on. All of it
 * ends with the month. The amounts live in the site Worker's secrets, never
 * here, since how the meter's prices relate to what they cost isn't published.
 */

/** The shares of the limit Julius hears at, and the last one is the stop. */
export const SPENDING_ALERT_PCTS = [70, 85, 100] as const;

/** R2's price: $0.015 per GB-month. */
export const STORED_PER_BYTE_MONTH_CENTS = 1.5 / 1024 ** 3;
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
  /** What games with no real players share in a month, of what they really cost. */
  unplayedGamesCostCents: number;
  /** How far past the limit free games' servers and schedules stop too. */
  pastLimitCeilingCents: number;
}

/** The private amounts, or null while any is missing or isn't a number above zero. */
export function spendingSettingsOf(env: { MONTHLY_SPENDING_LIMIT_CENTS?: string; FIXED_COST_CENTS_PER_MONTH?: string; STORAGE_AND_CHECKS_COST_CENTS_PER_MONTH?: string; METER_COST_SHARE_PCT?: string; UNPLAYED_GAMES_COST_CENTS_PER_MONTH?: string; PAST_LIMIT_CEILING_CENTS?: string }): SpendingSettings | null {
  const settings = {
    monthlyLimitCents: Number(env.MONTHLY_SPENDING_LIMIT_CENTS),
    fixedCostCents: Number(env.FIXED_COST_CENTS_PER_MONTH),
    storageAndChecksCostCents: Number(env.STORAGE_AND_CHECKS_COST_CENTS_PER_MONTH),
    meterCostSharePct: Number(env.METER_COST_SHARE_PCT),
    unplayedGamesCostCents: Number(env.UNPLAYED_GAMES_COST_CENTS_PER_MONTH),
    pastLimitCeilingCents: Number(env.PAST_LIMIT_CEILING_CENTS),
  };
  return Object.values(settings).every((settingNumber) => Number.isFinite(settingNumber) && settingNumber > 0) ? settings : null;
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
  const measuredStorageCents = facts.storedSizeBytes * STORED_PER_BYTE_MONTH_CENTS + facts.performanceCheckCount * PERFORMANCE_CHECK_COST_CENTS;
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

/** The month's stops, as the job last wrote them, for the hosting job to judge each game by. */
export const spendingStopsOf = (database: D1Database, nowMs = Date.now()) =>
  database.prepare("SELECT unplayed_games_stopped_at_ms, free_hosting_ended_at_ms FROM spending_months WHERE month_start_date = ?").bind(monthStartDateOf(nowMs)).first<{ unplayed_games_stopped_at_ms: number | null; free_hosting_ended_at_ms: number | null }>();

/** The month's row, as the job last wrote it, for the admin page. */
export const spendingMonthRow = (database: D1Database, nowMs = Date.now()) =>
  database.prepare("SELECT spent_cents, limit_cents, free_rooms_stopped_at_ms FROM spending_months WHERE month_start_date = ?").bind(monthStartDateOf(nowMs)).first<{ spent_cents: number; limit_cents: number; free_rooms_stopped_at_ms: number | null }>();
