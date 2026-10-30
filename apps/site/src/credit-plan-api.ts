import { ApiError, CREDIT_LIMITS, iso } from "@zaisma/core";
import { checkSpendingConfirmed, creditAnswer, isAccountProtected } from "./credit-api.ts";
import { logCallerEvent } from "./security-log.ts";
import { creditPlanCheckout, nextMonthStartSec, stopCreditPlan } from "./stripe.ts";
import type { Caller, NextStep } from "./developer.ts";
import type { Env } from "./env.ts";

/**
 * The monthly credit plan through the developer API: credit filled back to a level the developer picks on the 1st of
 * every month (UTC), a subscription they start once on Stripe's page, so Stripe stays the seller of every payment. The
 * first payment fills to the level (at most $1,000); each 1st pays only what brings the balance back to it, nothing
 * under $1 or over the level. Stripe's events run it (stripe-events.ts); these calls start it, change its level and
 * stop it. A higher level spends more, so it needs the developer's passkey, as a game's higher budget does.
 *
 *   POST  /api/dev/credit/plan/checkout   { refill_level_cents } → Stripe's page to pay on
 *   PATCH /api/dev/credit/plan            { refill_level_cents }
 *   POST  /api/dev/credit/plan/stop       stops it at once; credit stays
 */

interface PlanRow {
  credit_balance_cents: number;
  credit_plan_subscription_id: string | null;
  credit_plan_refill_level_cents: number | null;
  credit_plan_status: "running" | "payment_failing" | null;
  credit_plan_started_at_ms: number | null;
}

const planRow = (env: Env, ownerId: string) =>
  env.DB.prepare("SELECT credit_balance_cents, credit_plan_subscription_id, credit_plan_refill_level_cents, credit_plan_status, credit_plan_started_at_ms FROM owners WHERE id = ?").bind(ownerId).first<PlanRow>();

/** The credit_plan answer on credit: null with no plan. next_payment_cents is what the next 1st pays at today's balance. */
export async function creditPlanAnswer(env: Env, ownerId: string, nowMs = Date.now()) {
  const row = await planRow(env, ownerId);
  if (!row?.credit_plan_subscription_id || row.credit_plan_refill_level_cents === null || row.credit_plan_status === null) return null;
  const refillCents = row.credit_plan_refill_level_cents - Math.max(0, row.credit_balance_cents);
  return {
    refill_level_cents: row.credit_plan_refill_level_cents,
    plan_status: row.credit_plan_status,
    next_payment_at: iso(nextMonthStartSec(nowMs) * 1000),
    next_payment_cents: refillCents < CREDIT_LIMITS.minimumRefillCents ? 0 : refillCents,
    started_at: iso(row.credit_plan_started_at_ms ?? nowMs),
  };
}

function checkRefillLevel(given: unknown): number {
  if (typeof given !== "number" || !Number.isInteger(given) || given < CREDIT_LIMITS.minimumRefillLevelCents || given > CREDIT_LIMITS.maximumRefillLevelCents) {
    throw new ApiError("bad_refill_level_cents", {
      message: `refill_level_cents ${JSON.stringify(given)} isn't a level Zaisma takes: whole cents from ${CREDIT_LIMITS.minimumRefillLevelCents} ($10) to ${CREDIT_LIMITS.maximumRefillLevelCents} ($10,000).`,
      field: "refill_level_cents",
      fix: "Give cents, not dollars: 4000 is $40.",
    });
  }
  return given;
}

const noPlan = () => new ApiError("no_credit_plan", { message: "The developer has no monthly credit plan.", fix: "start_credit_plan answers the page where they can start one; get_credit shows the plan (credit_plan)." });

/** One call, once the router (developer.ts, checkCall) has checked the key. */
export async function creditPlanRoute(env: Env, path: string, method: string, body: Record<string, unknown>, caller: Caller): Promise<[unknown, number?]> {
  const ownerId = caller.ownerId;
  if (env.CREDIT_LIMIT && !(await env.CREDIT_LIMIT.limit({ key: ownerId })).success) {
    throw new ApiError("slow_down", { message: "Too many credit changes in a minute.", fix: "Wait a minute and try again.", retryAfterSec: 60 });
  }
  const row = await planRow(env, ownerId);
  const nextSteps: NextStep[] = [{ tool: "get_credit", arguments: {}, after_sec: null, reason: "The balance and the plan (credit_plan)." }];

  if (path === "/credit/plan/checkout" && method === "POST") {
    const refillLevelCents = checkRefillLevel(body.refill_level_cents);
    if (row?.credit_plan_subscription_id) throw new ApiError("already_credit_plan", { message: "The developer already has a monthly credit plan.", fix: "change_credit_plan sets another level; stop_credit_plan ends it. get_credit shows it (credit_plan)." });
    // Like a top-up, credit stays with the account, so the account needs a way back in first.
    if (!(await isAccountProtected(env, caller.accountId))) {
      throw new ApiError("account_not_protected", {
        message: "This account has no passkey and no email yet, and credit you buy stays with this account.",
        fix: `Add a passkey or an email on ${env.SITE_ORIGIN}/account, then start the plan again.`,
      });
    }
    const checkout = await creditPlanCheckout(env, ownerId, refillLevelCents);
    await logCallerEvent(env, caller, "credit_plan_started");
    const checkoutSteps: NextStep[] = [{ tool: "get_credit", arguments: {}, after_sec: null, reason: "Ask the developer to open checkout_url and pay there; once they have, get_credit shows the credit and the plan (credit_plan)." }];
    return [{ checkout_url: checkout.checkoutUrl, expires_at: iso(checkout.expiresAtMs), next_steps: checkoutSteps }, 201];
  }

  if (path === "/credit/plan" && method === "PATCH") {
    const refillLevelCents = checkRefillLevel(body.refill_level_cents);
    if (!row?.credit_plan_subscription_id || row.credit_plan_refill_level_cents === null) throw noPlan();
    if (refillLevelCents > row.credit_plan_refill_level_cents) await checkSpendingConfirmed(env, caller, "Raising the monthly credit plan's level", { requestKind: "credit_plan_refill_level", refillLevelCents });
    await env.DB.prepare("UPDATE owners SET credit_plan_refill_level_cents = ? WHERE id = ? AND credit_plan_subscription_id = ?").bind(refillLevelCents, ownerId, row.credit_plan_subscription_id).run();
    await logCallerEvent(env, caller, "credit_plan_changed");
    return [{ credit: await creditAnswer(env, ownerId), next_steps: nextSteps }];
  }

  if (path === "/credit/plan/stop" && method === "POST") {
    if (!row?.credit_plan_subscription_id) throw noPlan();
    const subscriptionId = row.credit_plan_subscription_id;
    // Gone from the row first, so Stripe's event for the ended subscription finds nothing and sends no email; put back if Stripe says no.
    const nowMs = Date.now();
    await env.DB.prepare("UPDATE owners SET credit_plan_subscription_id = NULL, credit_plan_refill_level_cents = NULL, credit_plan_status = NULL, credit_plan_started_at_ms = NULL, credit_plan_event_at_ms = ? WHERE id = ? AND credit_plan_subscription_id = ?").bind(nowMs, ownerId, subscriptionId).run();
    try {
      await stopCreditPlan(env, subscriptionId);
    } catch (error) {
      await env.DB.prepare("UPDATE owners SET credit_plan_subscription_id = ?, credit_plan_refill_level_cents = ?, credit_plan_status = ?, credit_plan_started_at_ms = ? WHERE id = ? AND credit_plan_subscription_id IS NULL")
        .bind(subscriptionId, row.credit_plan_refill_level_cents, row.credit_plan_status, row.credit_plan_started_at_ms, ownerId)
        .run();
      throw error;
    }
    await logCallerEvent(env, caller, "credit_plan_stopped");
    return [{ credit: await creditAnswer(env, ownerId), next_steps: nextSteps }];
  }

  throw new ApiError("bad_method", { message: `${method} isn't a call at ${path}.`, fix: "docs/DEVELOPER-API.md, Hosting and credit, lists the credit plan's calls." });
}

/** Before an account is deleted: its plan stops, so nothing charges the card again. One Stripe doesn't stop now is logged, and the deletion goes on. */
export async function stopCreditPlanForDeletion(env: Env, ownerId: string): Promise<void> {
  const row = await planRow(env, ownerId);
  if (!row?.credit_plan_subscription_id) return;
  try {
    await stopCreditPlan(env, row.credit_plan_subscription_id);
  } catch (error) {
    console.error("Couldn't stop a deleted account's monthly credit plan:", row.credit_plan_subscription_id, error);
  }
  await env.DB.prepare("UPDATE owners SET credit_plan_subscription_id = NULL, credit_plan_refill_level_cents = NULL, credit_plan_status = NULL, credit_plan_started_at_ms = NULL, credit_plan_event_at_ms = ? WHERE id = ?").bind(Date.now(), ownerId).run();
}
