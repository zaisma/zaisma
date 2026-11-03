import { aiUsage, monthStartDateOf, newSpendingAlertPcts, spendingMonthOf, spendingSettingsOf, type SpendingMonth } from "@zaisma/core";
import { sendAlert } from "./email.ts";
import type { Env } from "./env.ts";
import { emailOwner, resetsOnText } from "./hosting-job.ts";
import { sendPush } from "./push.ts";

/** Games told of the stop per run, so one run never sends a whole month's email at once. */
const MAXIMUM_STOP_NOTICE_COUNT_PER_RUN = 50;
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * After every hosting job, Zaisma's own month (spending.ts): what it spent against its limit, written to
 * spending_months, which the doors of rooms and the relay read. Julius hears at each share of the limit, and at the
 * limit free games get the stop, with their running matches an hour to finish. The stop is lifted if the limit rises
 * above what's spent. A new month has no row, so it starts with no stop.
 */
export async function runSpendingJob(env: Env, nowMs = Date.now()): Promise<void> {
  const monthStartDate = monthStartDateOf(nowMs);
  const settings = spendingSettingsOf(env);
  if (!settings) {
    await tellSettingsMissing(env, monthStartDate, nowMs);
    return;
  }
  const monthStartMs = Date.parse(`${monthStartDate}T00:00:00Z`);
  const lastMonthStartMs = Date.parse(`${monthStartDateOf(monthStartMs - 1)}T00:00:00Z`);
  const [usage, unpaid, stored, performance, charges, earnings] = await Promise.all([
    aiUsage(env.DB, monthStartDate.slice(0, 7)),
    env.DB.prepare("SELECT COALESCE(SUM(used_cents - charged_cents), 0) AS unpaid_meter_cents FROM game_hosting_months WHERE month_start_date = ?").bind(monthStartDate).first<{ unpaid_meter_cents: number }>(),
    env.DB.prepare("SELECT COALESCE(SUM(stored_size_bytes), 0) AS stored_size_bytes FROM owners").first<{ stored_size_bytes: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS check_count FROM performance_checks WHERE queued_at_ms >= ?").bind(monthStartMs).first<{ check_count: number }>(),
    env.DB.prepare("SELECT entry_kind, -SUM(amount_cents) AS charged_cents FROM credit_entries WHERE entry_kind IN ('hosting_charge', 'storage_charge') AND created_at_ms >= ? AND created_at_ms < ? GROUP BY entry_kind").bind(lastMonthStartMs, monthStartMs).all<{ entry_kind: string; charged_cents: number }>(),
    env.DB.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS earnings_cents FROM earnings WHERE earned_at_ms >= ? AND earned_at_ms < ?").bind(lastMonthStartMs, monthStartMs).first<{ earnings_cents: number }>(),
  ]);
  const chargedCents = (kind: string) => charges.results.find((row) => row.entry_kind === kind)?.charged_cents ?? 0;
  const month = spendingMonthOf(settings, {
    reviewCostCents: usage.review_cost_cents,
    aiInputTokenCount: usage.input_token_count + usage.chat_input_token_count,
    aiOutputTokenCount: usage.output_token_count + usage.chat_output_token_count,
    aiModel: env.AI_MODEL,
    storedSizeBytes: stored?.stored_size_bytes ?? 0,
    performanceCheckCount: performance?.check_count ?? 0,
    unpaidMeterCents: unpaid?.unpaid_meter_cents ?? 0,
    lastMonthHostingChargedCents: chargedCents("hosting_charge"),
    lastMonthStorageChargedCents: chargedCents("storage_charge"),
    lastMonthEarningsCents: earnings?.earnings_cents ?? 0,
  });
  const isAtLimit = month.spentCents >= month.limitCents;
  const row = await env.DB
    .prepare(
      `INSERT INTO spending_months (month_start_date, fixed_cost_cents, ai_cost_cents, storage_and_checks_cost_cents, free_hosting_cost_cents, spent_cents, earned_last_month_cents, limit_cents, free_rooms_stopped_at_ms, measured_at_ms)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, CASE WHEN ?9 THEN ?10 END, ?10)
       ON CONFLICT (month_start_date) DO UPDATE SET fixed_cost_cents = excluded.fixed_cost_cents, ai_cost_cents = excluded.ai_cost_cents, storage_and_checks_cost_cents = excluded.storage_and_checks_cost_cents, free_hosting_cost_cents = excluded.free_hosting_cost_cents, spent_cents = excluded.spent_cents, earned_last_month_cents = excluded.earned_last_month_cents, limit_cents = excluded.limit_cents, free_rooms_stopped_at_ms = CASE WHEN ?9 THEN COALESCE(free_rooms_stopped_at_ms, ?10) END, measured_at_ms = excluded.measured_at_ms
       RETURNING told_pct, free_rooms_stopped_at_ms`,
    )
    .bind(monthStartDate, month.fixedCostCents, month.aiCostCents, month.storageAndChecksCostCents, month.freeHostingCostCents, month.spentCents, month.earnedLastMonthCents, month.limitCents, isAtLimit ? 1 : 0, nowMs)
    .first<{ told_pct: number; free_rooms_stopped_at_ms: number | null }>();
  await tellJulius(env, month, monthStartDate, row?.told_pct ?? 0, nowMs);
  if (row?.free_rooms_stopped_at_ms != null) await tellStoppedGames(env, monthStartDate, row.free_rooms_stopped_at_ms, nowMs);
}

/** Once a share of the limit is reached: pushed and emailed, the highest share claimed so a run going past two says both, once. */
async function tellJulius(env: Env, month: SpendingMonth, monthStartDate: string, toldPct: number, nowMs: number): Promise<void> {
  const alertPcts = newSpendingAlertPcts(month, toldPct);
  const highestPct = alertPcts.at(-1);
  if (highestPct === undefined) return;
  const claimed = await env.DB.prepare("UPDATE spending_months SET told_pct = ? WHERE month_start_date = ? AND told_pct < ?").bind(highestPct, monthStartDate, highestPct).run();
  if (!claimed.meta.changes) return;
  const lines = `Fixed ${dollars(month.fixedCostCents)}, AI ${dollars(month.aiCostCents)}, storage and checks ${dollars(month.storageAndChecksCostCents)}, free hosting ${dollars(month.freeHostingCostCents)}. Earned last month: ${dollars(month.earnedLastMonthCents)}.`;
  const isStopped = highestPct === 100;
  const title = isStopped ? "Free rooms stopped: spending limit reached" : `Spending at ${alertPcts.join("% and ")}% of the limit`;
  const message = `${dollars(month.spentCents)} of ${dollars(month.limitCents)} this month. ${lines}${isStopped ? ` Free games start no new rooms until ${resetsOnText(nowMs)}; paying games go on.` : ""}`;
  await sendPush(env, { title, message, priorityNumber: isStopped ? 1 : 0 });
  await sendAlert(env, title, message);
}

/**
 * The developers of free games with rooms or relayed connections this month: an alert for the webhook, and an email,
 * once per stop. A game paused by itself has already heard why, and a game that has used none has nothing to lose.
 */
async function tellStoppedGames(env: Env, monthStartDate: string, stoppedAtMs: number, nowMs: number): Promise<void> {
  const { results: games } = await env.DB
    .prepare(
      `SELECT games.id, games.title, games.owner_id FROM games JOIN owners ON owners.id = games.owner_id
       WHERE (games.monthly_budget_cents IS NULL OR owners.credit_balance_cents <= 0)
         AND games.id IN (SELECT game_id FROM room_usage WHERE date >= ?1 AND (room_awake_duration_sec > 0 OR relayed_size_bytes > 0))
         AND games.id NOT IN (SELECT game_id FROM game_hosting_months WHERE month_start_date = ?1 AND paused_at_ms IS NOT NULL)
         AND games.id NOT IN (SELECT game_id FROM alert_notices WHERE alert_kind = 'free_rooms_stopped' AND month_start_date = ?1 AND alert_subject = ?2)
       LIMIT ?3`,
    )
    .bind(monthStartDate, String(stoppedAtMs), MAXIMUM_STOP_NOTICE_COUNT_PER_RUN)
    .all<{ id: string; title: string; owner_id: string }>();
  for (const game of games) {
    const noticed = await env.DB.prepare("INSERT OR IGNORE INTO alert_notices (game_id, alert_kind, month_start_date, alert_subject, noticed_at_ms) VALUES (?, 'free_rooms_stopped', ?, ?, ?)").bind(game.id, monthStartDate, String(stoppedAtMs), nowMs).run();
    if (noticed.meta.changes) await emailOwner(env, game.owner_id, "free_rooms_stopped", { gameTitle: game.title, resetsOnText: resetsOnText(nowMs) });
  }
}

/** Without the private amounts there's no limit to hold, so Julius hears, once a month. A Zaisma of your own runs without them. */
async function tellSettingsMissing(env: Env, monthStartDate: string, nowMs: number): Promise<void> {
  await env.DB.prepare("INSERT OR IGNORE INTO spending_months (month_start_date) VALUES (?)").bind(monthStartDate).run();
  const claimed = await env.DB.prepare("UPDATE spending_months SET settings_missing_told_at_ms = ? WHERE month_start_date = ? AND settings_missing_told_at_ms IS NULL").bind(nowMs, monthStartDate).run();
  if (claimed.meta.changes) await sendPush(env, { title: "The monthly spending limit isn't set", message: "MONTHLY_SPENDING_LIMIT_CENTS, FIXED_COST_CENTS_PER_MONTH, STORAGE_AND_CHECKS_COST_CENTS_PER_MONTH and METER_COST_SHARE_PCT are the site Worker's secrets. Until all four are set, nothing limits what Zaisma spends.", priorityNumber: 1 });
}
