import {
  CREDIT_LIMITS,
  FREE_HOSTING_CENTS_PER_MONTH,
  MAXIMUM_GAME_STORAGE_SIZE_BYTES,
  NEARLY_USED_PCT,
  addCreditEntry,
  addHostingCharge,
  addWrittenOff,
  automaticTopUpsThisMonth,
  creditOf,
  gameHostingMonth,
  hostingUseThisMonth,
  monthStartDateOf,
  nextMonthStartDate,
  type Credit,
  type HostingAlertKind,
  type PausedReason,
} from "@zaisma/core";
import { authUserEmail, realEmail } from "./auth.ts";
import { deliverEmail, hostingEmail, type HostingEmailDetails, type HostingEmailKind } from "./email-codes.ts";
import { StripeRefusal, chargeSavedCard } from "./stripe.ts";
import type { Env } from "./env.ts";

/**
 * Every 5 minutes, the one judge of every game's month on the meter (docs/DECISIONS.md, "Hosting is priced with a
 * margin, with a free tier, and prepaid above it"): what it used, what's charged to its developer's credit, and
 * whether it's paused, written to game_hosting_months, which rooms, the relay, requests and the database read.
 * Games with use today, and once an hour every game with stored data, whose storage counts every day.
 *
 * - No budget: at its free allowance the game pauses (free_used).
 * - A budget: past its free allowance it draws whole cents from credit (the fraction carried), never past its budget
 *   (budget_used) or the balance (credit_used), and the automatic top-up runs first, so a developer with one on never
 *   pauses while it can still charge. What a game uses past either, its finishing hour included, is written off.
 * - A pause that no longer holds (a budget raised, credit added) is cleared, and the game's database told.
 *
 * The heads-ups (80% of the free allowance or of a budget), the pause and the storage's hard cap go to alert_notices
 * once per game per month for the alert_raised webhook, and to the developer by email.
 */
export async function runHostingJob(env: Env, nowMs = Date.now()): Promise<void> {
  const monthStart = monthStartDateOf(nowMs);
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const isHourly = new Date(nowMs).getUTCMinutes() < 5;
  const { results: games } = await env.DB.prepare(
    `SELECT id, slug, title, owner_id, monthly_budget_cents FROM games WHERE owner_id IS NOT NULL AND id IN (
       SELECT game_id FROM room_usage WHERE date = ?
       UNION SELECT game_id FROM room_usage WHERE ? AND date >= date(?, '-1 month') AND database_size_bytes > 0
       UNION SELECT game_id FROM game_hosting_months WHERE month_start_date = ? AND paused_at_ms IS NOT NULL)`,
  )
    .bind(today, isHourly ? 1 : 0, monthStart, monthStart)
    .all<{ id: string; slug: string; title: string; owner_id: string; monthly_budget_cents: number | null }>();
  const owners = new Map<string, Credit>();
  for (const game of games) {
    try {
      await judgeGame(env, game, owners, nowMs);
    } catch (error) {
      console.error("Hosting job: a game failed", game.id, error);
    }
  }
}

/** One game's month: charge, pause or clear, alert. */
async function judgeGame(env: Env, game: { id: string; title: string; owner_id: string; monthly_budget_cents: number | null }, owners: Map<string, Credit>, nowMs: number): Promise<void> {
  const [use, month] = await Promise.all([hostingUseThisMonth(env.DB, game.id, nowMs), gameHostingMonth(env.DB, game.id, nowMs)]);
  const budgetCents = game.monthly_budget_cents;
  let credit = owners.get(game.owner_id) ?? (await creditOf(env.DB, game.owner_id));
  let chargedCents = month.charged_cents;
  let writtenOffCents = month.written_off_cents;
  let reason: PausedReason | null = null;
  if (budgetCents === null) {
    if (use.totalCents >= FREE_HOSTING_CENTS_PER_MONTH) reason = "free_used";
  } else {
    const owedCents = Math.max(0, Math.floor(use.totalCents - FREE_HOSTING_CENTS_PER_MONTH) - chargedCents - writtenOffCents);
    if (owedCents > 0 && credit.balanceCents < owedCents) credit = await topUpAutomatically(env, game.owner_id, credit, nowMs);
    const chargeableCents = Math.max(0, Math.min(owedCents, budgetCents - chargedCents, credit.balanceCents));
    if (chargeableCents > 0 && (await addHostingCharge(env.DB, { ownerId: game.owner_id, gameId: game.id, amountCents: chargeableCents, nowMs }))) {
      chargedCents += chargeableCents;
      const balanceBeforeCents = credit.balanceCents;
      credit = { ...credit, balanceCents: credit.balanceCents - chargeableCents };
      await tellCreditLow(env, game.owner_id, credit, balanceBeforeCents, nowMs);
    }
    const isPastFree = use.totalCents >= FREE_HOSTING_CENTS_PER_MONTH;
    if (chargedCents >= budgetCents && isPastFree) reason = "budget_used";
    else if (isPastFree && credit.balanceCents <= 0) reason = "credit_used";
    // What it used past its budget or the balance is Zaisma's: never charged later.
    const leftOverCents = owedCents - (chargedCents - month.charged_cents);
    if (reason && leftOverCents > 0) {
      await addWrittenOff(env.DB, { ownerId: game.owner_id, gameId: game.id, amountCents: leftOverCents, nowMs });
      writtenOffCents += leftOverCents;
    }
  }
  owners.set(game.owner_id, credit);

  // A pause keeps its first moment, so every room of the game ends an hour after it, together.
  const pausedAtMs = reason ? (month.paused_at_ms ?? nowMs) : null;
  await env.DB.prepare(
    `INSERT INTO game_hosting_months (game_id, month_start_date, used_cents, charged_cents, written_off_cents, paused_at_ms, paused_reason) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (game_id, month_start_date) DO UPDATE SET used_cents = excluded.used_cents, charged_cents = excluded.charged_cents, written_off_cents = excluded.written_off_cents, paused_at_ms = excluded.paused_at_ms, paused_reason = excluded.paused_reason`,
  )
    .bind(game.id, month.month_start_date, use.totalCents, chargedCents, writtenOffCents, pausedAtMs, reason)
    .run();
  // Told again every run while paused: a restore of the database rolls back what it was told.
  if (pausedAtMs !== null || month.paused_at_ms !== null) await tellDatabase(env, game.id, pausedAtMs);

  const details: HostingEmailDetails = { gameTitle: game.title, monthName: monthName(nowMs), resetsOnText: resetsOnText(nowMs), pausedReason: reason ?? undefined, spentCents: chargedCents, budgetCents: budgetCents ?? undefined };
  const reached: HostingAlertKind[] = [];
  if (reason) reached.push("hosting_paused");
  else if (budgetCents === null && use.totalCents >= (FREE_HOSTING_CENTS_PER_MONTH * NEARLY_USED_PCT) / 100) reached.push("hosting_nearly_paused");
  else if (budgetCents !== null && chargedCents >= (budgetCents * NEARLY_USED_PCT) / 100) reached.push("hosting_budget_nearly_used");
  if (use.use.databaseSizeBytes >= MAXIMUM_GAME_STORAGE_SIZE_BYTES) reached.push("database_full");
  else if (use.use.databaseSizeBytes >= (MAXIMUM_GAME_STORAGE_SIZE_BYTES * NEARLY_USED_PCT) / 100) reached.push("database_nearly_full");
  for (const kind of reached) {
    const noticed = await env.DB.prepare("INSERT OR IGNORE INTO alert_notices (game_id, alert_kind, month_start_date, noticed_at_ms) VALUES (?, ?, ?, ?)").bind(game.id, kind, month.month_start_date, nowMs).run();
    if (noticed.meta.changes && (kind === "hosting_paused" || kind === "hosting_nearly_paused" || kind === "hosting_budget_nearly_used")) await emailOwner(env, game.owner_id, kind, details);
  }
}

/**
 * Tops the owner's credit up from their saved card when it's under their line and the month's limit has room, before
 * a game would pause. Idempotent per owner, month and count, so a retry is the same charge. A declined card turns
 * automatic top-up off and tells them, since trying it again would fail the same way. Answers the credit after.
 */
export async function topUpAutomatically(env: Env, ownerId: string, credit: Credit, nowMs = Date.now()): Promise<Credit> {
  const automatic = credit.automaticTopUp;
  if (!automatic.isEnabled || !credit.stripeCustomerId || !credit.stripePaymentMethodId || automatic.topUpAmountCents === null || automatic.monthlyTopUpLimitCents === null) return credit;
  if (automatic.topUpBelowCents !== null && credit.balanceCents >= automatic.topUpBelowCents) return credit;
  const { toppedUpCents, topUpCount } = await automaticTopUpsThisMonth(env.DB, ownerId, nowMs);
  if (toppedUpCents + automatic.topUpAmountCents > automatic.monthlyTopUpLimitCents) return credit;
  try {
    const paymentIntent = await chargeSavedCard(env, {
      ownerId,
      customerId: credit.stripeCustomerId,
      paymentMethodId: credit.stripePaymentMethodId,
      amountCents: automatic.topUpAmountCents,
      idempotencyKey: `automatic-top-up:${ownerId}:${monthStartDateOf(nowMs).slice(0, 7)}:${topUpCount + 1}`,
    });
    if (paymentIntent.status !== "succeeded") return credit;
    const added = await addTopUp(env, { ownerId, amountCents: automatic.topUpAmountCents, paymentIntentId: paymentIntent.id, isAutomatic: true, nowMs });
    if (added) {
      const leftThisMonthCents = automatic.monthlyTopUpLimitCents - toppedUpCents - automatic.topUpAmountCents;
      await emailOwner(env, ownerId, "automatic_top_up_made", { topUpCents: automatic.topUpAmountCents, leftThisMonthCents, monthlyLimitCents: automatic.monthlyTopUpLimitCents, monthName: monthName(nowMs) });
    }
    return creditOf(env.DB, ownerId);
  } catch (error) {
    if (!(error instanceof StripeRefusal)) throw error;
    await turnOffAutomaticTopUp(env, ownerId, error.stripeMessage);
    return { ...credit, automaticTopUp: { ...automatic, isEnabled: false } };
  }
}

/** A top-up that went through: the credit, refundable for 180 days, and every paused game of the owner's starts again if it can. */
export async function addTopUp(env: Env, topUp: { ownerId: string; amountCents: number; paymentIntentId: string; isAutomatic: boolean; nowMs?: number }): Promise<boolean> {
  const nowMs = topUp.nowMs ?? Date.now();
  const id = await addCreditEntry(env.DB, {
    ownerId: topUp.ownerId,
    entryKind: "top_up",
    amountCents: topUp.amountCents,
    stripeObjectId: topUp.paymentIntentId,
    refundableUntilMs: nowMs + CREDIT_LIMITS.refundableDurationDays * 86_400_000,
    isAutomatic: topUp.isAutomatic,
    createdAtMs: nowMs,
  });
  if (!id) return false;
  await clearPauses(env, topUp.ownerId, nowMs);
  return true;
}

/** Clears this month's credit_used pauses of the owner's games, and the budget_used one of a game whose budget now has room. */
export async function clearPauses(env: Env, ownerId: string, nowMs = Date.now(), gameId: string | null = null): Promise<void> {
  const { results: cleared } = await env.DB.prepare(
    `UPDATE game_hosting_months SET paused_at_ms = NULL, paused_reason = NULL
     WHERE month_start_date = ? AND paused_at_ms IS NOT NULL AND game_id IN (SELECT id FROM games WHERE owner_id = ? AND monthly_budget_cents IS NOT NULL AND (? IS NULL OR id = ?))
       AND (paused_reason = 'credit_used' OR (paused_reason IN ('budget_used', 'free_used') AND charged_cents < (SELECT monthly_budget_cents FROM games WHERE id = game_hosting_months.game_id)))
       AND (SELECT credit_balance_cents FROM owners WHERE id = ?) > 0
     RETURNING game_id`,
  )
    .bind(monthStartDateOf(nowMs), ownerId, gameId, gameId, ownerId)
    .all<{ game_id: string }>();
  for (const row of cleared) await tellDatabase(env, row.game_id, null);
}

/** Pauses a game at once, as when its budget is lowered below this month's charges. */
export async function pauseNow(env: Env, gameId: string, reason: PausedReason, nowMs = Date.now()): Promise<void> {
  const { results } = await env.DB.prepare(
    `INSERT INTO game_hosting_months (game_id, month_start_date, paused_at_ms, paused_reason) VALUES (?, ?, ?, ?)
     ON CONFLICT (game_id, month_start_date) DO UPDATE SET paused_at_ms = COALESCE(paused_at_ms, excluded.paused_at_ms), paused_reason = excluded.paused_reason
     RETURNING paused_at_ms`,
  )
    .bind(gameId, monthStartDateOf(nowMs), nowMs, reason)
    .all<{ paused_at_ms: number }>();
  await tellDatabase(env, gameId, results[0]?.paused_at_ms ?? nowMs);
}

/** Tells a game's database when its hosting paused (null: running), so it stops after the finishing hour. Never fails the job. */
async function tellDatabase(env: Env, gameId: string, pausedAtMs: number | null): Promise<void> {
  try {
    await env.GAME_DATABASES?.setHostingPause(gameId, pausedAtMs);
  } catch (error) {
    console.error("Couldn't tell the game's database about its hosting:", error);
  }
}

export async function turnOffAutomaticTopUp(env: Env, ownerId: string, failureText: string | null): Promise<void> {
  const turnedOff = await env.DB.prepare("UPDATE owners SET automatic_top_up_enabled = 0 WHERE id = ? AND automatic_top_up_enabled = 1").bind(ownerId).run();
  if (turnedOff.meta.changes) await emailOwner(env, ownerId, "automatic_top_up_failed", { failureText: failureText ?? undefined });
}

/** Once per top-up, when the balance drops under creditLowPct of the last one; and when it reaches zero. */
async function tellCreditLow(env: Env, ownerId: string, credit: Credit, balanceBeforeCents: number, nowMs: number): Promise<void> {
  if (credit.balanceCents <= 0 && balanceBeforeCents > 0) {
    await emailOwner(env, ownerId, "credit_used_up", {});
    return;
  }
  const lastTopUp = await env.DB.prepare("SELECT amount_cents, created_at_ms FROM credit_entries WHERE owner_id = ? AND entry_kind = 'top_up' ORDER BY created_at_ms DESC LIMIT 1").bind(ownerId).first<{ amount_cents: number; created_at_ms: number }>();
  if (!lastTopUp || credit.balanceCents >= (lastTopUp.amount_cents * CREDIT_LIMITS.creditLowPct) / 100) return;
  const told = await env.DB.prepare("UPDATE owners SET credit_low_told_at_ms = ? WHERE id = ? AND (credit_low_told_at_ms IS NULL OR credit_low_told_at_ms < ?)").bind(nowMs, ownerId, lastTopUp.created_at_ms).run();
  if (told.meta.changes) await emailOwner(env, ownerId, "credit_low", { balanceCents: credit.balanceCents });
}

/** An email to the owner's account, when it has an email; the alerts and the API say the same either way. */
export async function emailOwner(env: Env, ownerId: string, kind: HostingEmailKind, details: HostingEmailDetails): Promise<void> {
  try {
    const owner = await env.DB.prepare("SELECT account_id FROM owners WHERE id = ?").bind(ownerId).first<{ account_id: string | null }>();
    const email = owner?.account_id ? realEmail((await authUserEmail(env, owner.account_id)) ?? "") : null;
    if (email) await deliverEmail(env, email, hostingEmail(env, kind, details));
  } catch (error) {
    console.error("Couldn't email the developer about hosting:", error);
  }
}

const monthName = (nowMs: number) => new Date(nowMs).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
/** "Nov 1" */
export const resetsOnText = (nowMs: number) => new Date(`${nextMonthStartDate(nowMs)}T00:00:00Z`).toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
