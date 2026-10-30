import { ApiError, CREDIT_LIMITS, FREE_HOSTING_CENTS_PER_MONTH, checkIdKind, creditOf, isCreditLow, iso, monthStartDateOf, newId, passkeysFor, refundableTopUps, type CreditEntryKind } from "@zaisma/core";
import { confirmationOf } from "./session-proofs.ts";
import { logCallerEvent } from "./security-log.ts";
import { refundCharge, topUpCheckout } from "./stripe.ts";
import { askForSpending, spendingRequestAnswer, spendingRequestUrl, type SpendingChange } from "./spending-requests.ts";
import { creditPlanAnswer, stopCreditPlanForDeletion } from "./credit-plan-api.ts";
import { authUserEmail, realEmail, type Session } from "./auth.ts";
import type { Caller, NextStep } from "./developer.ts";
import type { Env } from "./env.ts";

/**
 * A developer's hosting credit through the developer API (docs/DECISIONS.md, "Hosting is priced with a margin, with
 * a free tier, and prepaid above it"): their AI reads the bill, starts a top-up (the person pays on Stripe's page),
 * and refunds an unspent one. Credit only comes in through Stripe's page, so Stripe is the seller of every top-up.
 * Each game's budget is on the game (PATCH /games/:slug, monthly_budget_cents); a first or higher one needs the
 * developer's passkey on zaisma.com (confirmation_needed with confirm_url), so a leaked key can't spend.
 *
 *   GET   /api/dev/credit                      the balance, top-ups, games' spending and entries
 *   POST  /api/dev/credit/top-ups              { amount_cents } → Stripe's page to pay on
 *   POST  /api/dev/credit/refunds              { top_up_id } → what's unspent of it, back to its card
 *
 * The monthly credit plan's calls are in credit-plan-api.ts.
 */

/** How far back the entries go. */
const ENTRY_DURATION_DAYS = 90;
const DAY_MS = 86_400_000;

/** Where the developer confirms spending with their passkey: the hosting part of Developer settings on zaisma.com. */
export const confirmUrlOf = (env: Env) => `${env.SITE_ORIGIN}/dashboard/settings#hosting`;

/** Whether this caller may turn spending on or up: our own page, with a passkey tap in the last 10 minutes. */
export async function withSpendingConfirmation(env: Env, caller: Caller, session: Session): Promise<Caller> {
  if (caller.via !== "dashboard") return caller;
  const confirmation = await confirmationOf(env, session, caller.accountId);
  return { ...caller, isSpendingConfirmed: confirmation.isPasskeyNeeded && confirmation.isConfirmed };
}

/**
 * Refuses turning spending on or up without the developer's passkey. A key or an AI app that asks gets the change kept as a
 * spending request: confirm_url opens a sheet naming it, where the developer approves with a passkey tap, and
 * get_spending_request checks the answer.
 */
export async function checkSpendingConfirmed(env: Env, caller: Caller, what: string, change: SpendingChange): Promise<void> {
  if (caller.isSpendingConfirmed) return;
  if (caller.via === "dashboard") {
    throw new ApiError("confirmation_needed", { message: `${what} spends the developer's money, so it needs their passkey.`, fix: "Tap your passkey, then do it again.", confirmUrl: confirmUrlOf(env) });
  }
  const spendingRequestId = await askForSpending(env, caller.accountId, change);
  throw new ApiError("confirmation_needed", {
    message: `${what} spends the developer's money, so it needs their passkey on zaisma.com.`,
    fix: "Give the developer confirm_url: it opens a sheet naming this exact change, where they approve with a passkey tap or decline. Check the answer with get_spending_request (spending_request_id). A key can turn spending off or down on its own.",
    confirmUrl: spendingRequestUrl(env, spendingRequestId),
    spendingRequestId,
  });
}

/** The credit_answer: everything about an owner's credit. */
export async function creditAnswer(env: Env, ownerId: string, nowMs = Date.now()) {
  const sinceMs = nowMs - ENTRY_DURATION_DAYS * DAY_MS;
  const lastMonthStartDate = monthStartDateOf(Date.parse(`${monthStartDateOf(nowMs)}T00:00:00Z`) - DAY_MS);
  const [credit, creditPlan, topUps, { results: entries }, { results: games }] = await Promise.all([
    creditOf(env.DB, ownerId),
    creditPlanAnswer(env, ownerId, nowMs),
    refundableTopUps(env.DB, ownerId, nowMs),
    env.DB.prepare("SELECT credit_entries.id, entry_kind, amount_cents, games.slug AS game_slug, credit_entries.created_at_ms FROM credit_entries LEFT JOIN games ON games.id = credit_entries.game_id WHERE credit_entries.owner_id = ? AND credit_entries.created_at_ms >= ? ORDER BY credit_entries.created_at_ms DESC")
      .bind(ownerId, sinceMs)
      .all<{ id: string; entry_kind: CreditEntryKind; amount_cents: number; game_slug: string | null; created_at_ms: number }>(),
    env.DB.prepare(
      "SELECT games.slug, games.title, games.monthly_budget_cents, COALESCE(game_hosting_months.charged_cents, 0) AS charged_cents, COALESCE(last_month.used_cents, 0) AS last_month_used_cents FROM games LEFT JOIN game_hosting_months ON game_hosting_months.game_id = games.id AND game_hosting_months.month_start_date = ? LEFT JOIN game_hosting_months AS last_month ON last_month.game_id = games.id AND last_month.month_start_date = ? WHERE games.owner_id = ? AND (games.monthly_budget_cents IS NOT NULL OR game_hosting_months.charged_cents > 0 OR last_month.used_cents > ?) ORDER BY games.title",
    )
      .bind(monthStartDateOf(nowMs), lastMonthStartDate, ownerId, FREE_HOSTING_CENTS_PER_MONTH)
      .all<{ slug: string; title: string; monthly_budget_cents: number | null; charged_cents: number; last_month_used_cents: number }>(),
  ]);
  return {
    balance_cents: credit.balanceCents,
    is_credit_low: isCreditLow(credit),
    credit_plan: creditPlan,
    top_ups: topUps
      .filter((topUp) => topUp.createdAtMs >= nowMs - CREDIT_LIMITS.refundableDurationDays * DAY_MS)
      .map((topUp) => ({ id: topUp.id, amount_cents: topUp.amountCents, refundable_cents: topUp.refundableCents, refund_ends_at: iso(topUp.refundableUntilMs), created_at: iso(topUp.createdAtMs) })),
    games: games.map((game) => ({ slug: game.slug, title: game.title, monthly_budget_cents: game.monthly_budget_cents, spent_from_credit_this_month_cents: game.charged_cents, last_month_beyond_free_cents: Math.max(0, Math.round(game.last_month_used_cents) - FREE_HOSTING_CENTS_PER_MONTH) })),
    entries: entries.map((entry) => ({ id: entry.id, entry_kind: entry.entry_kind, amount_cents: entry.amount_cents, game_slug: entry.game_slug, created_at: iso(entry.created_at_ms) })),
  };
}

/** Whether the account has a passkey or a real email: a way back in that isn't just a password. */
export async function isAccountProtected(env: Env, accountId: string): Promise<boolean> {
  if ((await passkeysFor(env.DB, accountId)).length > 0) return true;
  const email = await authUserEmail(env, accountId);
  return Boolean(email && realEmail(email));
}

const wholeCents = (given: unknown) => typeof given === "number" && Number.isInteger(given);

/** One call, once the router (developer.ts, checkCall) has checked the key. */
export async function creditRoute(env: Env, path: string, method: string, body: Record<string, unknown>, caller: Caller): Promise<[unknown, number?]> {
  const ownerId = caller.ownerId;
  if (path === "/credit" && method === "GET") return [{ credit: await creditAnswer(env, ownerId) }];

  const spendingRequestMatch = path.match(/^\/spending-requests\/([^/]+)$/);
  if (spendingRequestMatch && method === "GET") {
    const id = spendingRequestMatch[1]!;
    checkIdKind("spending_request", id, "spending_request_id", "A spending request's ID comes with confirmation_needed (spending_request_id).");
    const answer = await spendingRequestAnswer(env, caller.accountId, id);
    if (!answer) throw new ApiError("no_spending_request", { message: `You have no spending request ${JSON.stringify(id.slice(0, 60))}.`, field: "spending_request_id", fix: "The ID comes with confirmation_needed (spending_request_id) when a raise needs the developer." });
    return [{ spending_request: answer }];
  }

  if (path === "/credit/top-ups" || path === "/credit/refunds") {
    if (env.CREDIT_LIMIT && !(await env.CREDIT_LIMIT.limit({ key: ownerId })).success) {
      throw new ApiError("slow_down", { message: "Too many top-ups and refunds in a minute.", fix: "Wait a minute and try again.", retryAfterSec: 60 });
    }
  }

  if (path === "/credit/top-ups" && method === "POST") {
    const amountCents = body.amount_cents;
    if (!wholeCents(amountCents) || (amountCents as number) < CREDIT_LIMITS.minimumTopUpCents || (amountCents as number) > CREDIT_LIMITS.maximumTopUpCents) {
      throw new ApiError("bad_top_up_amount", {
        message: `amount_cents ${JSON.stringify(amountCents)} isn't a top-up Zaisma takes: whole cents from ${CREDIT_LIMITS.minimumTopUpCents} ($10) to ${CREDIT_LIMITS.maximumTopUpCents} ($1,000).`,
        field: "amount_cents",
        fix: "Give cents, not dollars: 2000 is $20.",
      });
    }
    // Credit is money held for the account, so (like linking a parent) a top-up waits until the account has a passkey or an email to get back in with.
    if (!(await isAccountProtected(env, caller.accountId))) {
      throw new ApiError("account_not_protected", {
        message: "This account has no passkey and no email yet, and credit you buy stays with this account.",
        fix: `Add a passkey or an email on ${env.SITE_ORIGIN}/account, then top up again.`,
      });
    }
    const checkout = await topUpCheckout(env, ownerId, amountCents as number);
    await logCallerEvent(env, caller, "credit_top_up_started");
    const nextSteps: NextStep[] = [{ tool: "get_credit", arguments: {}, after_sec: null, reason: "Ask the developer to open checkout_url and pay there; once they have, get_credit shows the new balance." }];
    return [{ checkout_url: checkout.checkoutUrl, expires_at: iso(checkout.expiresAtMs), next_steps: nextSteps }, 201];
  }

  if (path === "/credit/refunds" && method === "POST") {
    const topUpFix = "get_credit lists your top-ups with what each still refunds (refundable_cents).";
    checkIdKind("top_up", body.top_up_id, "top_up_id", topUpFix);
    const topUps = await refundableTopUps(env.DB, ownerId);
    const topUp = topUps.find((each) => each.id === body.top_up_id);
    if (!topUp) throw new ApiError("no_top_up", { message: `You have no top-up ${JSON.stringify(String(body.top_up_id ?? "").slice(0, 40))}.`, field: "top_up_id", fix: topUpFix });
    if (topUp.refundableCents <= 0 || !topUp.stripeObjectId) {
      throw new ApiError("top_up_not_refundable", { message: topUp.unspentCents <= 0 ? "That top-up is spent or refunded already." : "That top-up is over 30 days old, so it doesn't refund.", field: "top_up_id", fix: topUpFix });
    }
    const refundedCents = await refundTopUp(env, ownerId, topUp.id, topUp.stripeObjectId, topUp.refundableCents);
    await logCallerEvent(env, caller, "credit_refunded");
    const nextSteps: NextStep[] = [{ tool: "get_credit", arguments: {}, after_sec: null, reason: "The balance after the refund." }];
    return [{ refunded_cents: refundedCents, next_steps: nextSteps }];
  }

  throw new ApiError("bad_method", { message: `${method} isn't a call at ${path}.`, fix: "docs/DEVELOPER-API.md, Hosting and credit, lists the credit calls." });
}

/**
 * Refunds what's unspent of a top-up to its card: the credit comes out first, with the top-up's refunded_cents, so it
 * can't be spent meanwhile and Stripe's charge.refunded event adds nothing; put back if Stripe says no.
 */
async function refundTopUp(env: Env, ownerId: string, topUpId: string, paymentIntentId: string, amountCents: number, idempotencyKey?: string): Promise<number> {
  const entryId = newId("credit_entry");
  const nowMs = Date.now();
  const [reserved] = await env.DB.batch([
    env.DB.prepare("INSERT INTO credit_entries (id, owner_id, entry_kind, amount_cents, created_at_ms) SELECT ?, ?, 'refund', ?, ? WHERE (SELECT credit_balance_cents FROM owners WHERE id = ?) >= ?").bind(entryId, ownerId, -amountCents, nowMs, ownerId, amountCents),
    env.DB.prepare("UPDATE owners SET credit_balance_cents = credit_balance_cents - ? WHERE id = ? AND credit_balance_cents >= ?").bind(amountCents, ownerId, amountCents),
    env.DB.prepare("UPDATE credit_entries SET refunded_cents = refunded_cents + ? WHERE id = ? AND EXISTS (SELECT 1 FROM credit_entries WHERE id = ?)").bind(amountCents, topUpId, entryId),
  ]);
  if (!reserved?.meta.changes) throw new ApiError("top_up_not_refundable", { message: "That top-up's credit was spent a moment ago.", field: "top_up_id", fix: "get_credit shows what each top-up still refunds." });
  try {
    const refund = await refundCharge(env, paymentIntentId, amountCents, idempotencyKey ?? `refund:${entryId}`);
    await env.DB.prepare("UPDATE credit_entries SET stripe_object_id = ? WHERE id = ?").bind(refund.id, entryId).run();
    return amountCents;
  } catch (error) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM credit_entries WHERE id = ?").bind(entryId),
      env.DB.prepare("UPDATE owners SET credit_balance_cents = credit_balance_cents + ? WHERE id = ?").bind(amountCents, ownerId),
      env.DB.prepare("UPDATE credit_entries SET refunded_cents = refunded_cents - ? WHERE id = ?").bind(amountCents, topUpId),
    ]);
    throw error;
  }
}

/** Unspent credit past its 30 days, which deleting the account doesn't refund: the delete box names it first. */
export async function creditKeptOnDeletionCents(env: Env, accountId: string, nowMs = Date.now()): Promise<number> {
  const owner = await env.DB.prepare("SELECT id FROM owners WHERE account_id = ?").bind(accountId).first<{ id: string }>();
  if (!owner) return 0;
  return (await refundableTopUps(env.DB, owner.id, nowMs)).reduce((keptCents, topUp) => keptCents + topUp.unspentCents - topUp.refundableCents, 0);
}

/**
 * Before an account is deleted: the monthly credit plan stopped, and every top-up's refundable part back to its card, since the credit goes with the
 * account. One Stripe doesn't take now waits in pending_refunds, with only the payment and the amount, and the
 * deletion goes on: the account's owner asked for it, and retryPendingRefunds pays it once Stripe takes it.
 */
export async function refundForDeletion(env: Env, accountId: string, nowMs = Date.now()): Promise<void> {
  const owner = await env.DB.prepare("SELECT id FROM owners WHERE account_id = ?").bind(accountId).first<{ id: string }>();
  if (!owner) return;
  // The monthly credit plan stops first, so no refill lands on credit that's going.
  await stopCreditPlanForDeletion(env, owner.id);
  for (const topUp of await refundableTopUps(env.DB, owner.id, nowMs)) {
    if (topUp.refundableCents <= 0 || !topUp.stripeObjectId) continue;
    // The same key for every try, so a refund Stripe made without answering is never made twice.
    const pendingRefundId = newId("pending_refund");
    try {
      await refundTopUp(env, owner.id, topUp.id, topUp.stripeObjectId, topUp.refundableCents, `refund:${pendingRefundId}`);
    } catch (error) {
      console.error("Couldn't refund a deleted account's top-up now; it waits in pending_refunds:", topUp.id, error);
      await env.DB.prepare("INSERT INTO pending_refunds (id, stripe_payment_intent_id, amount_cents, created_at_ms) VALUES (?, ?, ?, ?)").bind(pendingRefundId, topUp.stripeObjectId, topUp.refundableCents, nowMs).run();
    }
  }
}

/** A pending refund is first tried again this long after the deletion, then hourly; refundsStuck tells Julius of one past 30 days. */
const PENDING_REFUND_FIRST_RETRY_MS = 5 * 60_000;
const PENDING_REFUND_RETRY_INTERVAL_MS = 3_600_000;

/** Every 5 minutes: the deleted accounts' refunds whose next try is due, each gone once Stripe takes it. */
export async function retryPendingRefunds(env: Env, nowMs = Date.now()): Promise<void> {
  const { results: due } = await env.DB.prepare(
    "SELECT id, stripe_payment_intent_id, amount_cents FROM pending_refunds WHERE (last_tried_at_ms IS NULL AND created_at_ms <= ?) OR last_tried_at_ms <= ? ORDER BY created_at_ms LIMIT 50",
  )
    .bind(nowMs - PENDING_REFUND_FIRST_RETRY_MS, nowMs - PENDING_REFUND_RETRY_INTERVAL_MS)
    .all<{ id: string; stripe_payment_intent_id: string; amount_cents: number }>();
  for (const refund of due) {
    // Claimed first, so two runs at once try it once.
    const claimed = await env.DB.prepare("UPDATE pending_refunds SET last_tried_at_ms = ?, try_count = try_count + 1 WHERE id = ? AND COALESCE(last_tried_at_ms, 0) < ?").bind(nowMs, refund.id, nowMs).run();
    if (!claimed.meta.changes) continue;
    try {
      await refundCharge(env, refund.stripe_payment_intent_id, refund.amount_cents, `refund:${refund.id}`);
      await env.DB.prepare("DELETE FROM pending_refunds WHERE id = ?").bind(refund.id).run();
    } catch (error) {
      console.error("A deleted account's refund still didn't go through:", refund.id, error);
    }
  }
}
