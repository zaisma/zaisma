import { ApiError, PLAN_LIMITS, PRO_PRICE_CENTS_PER_MONTH, iso, planOf } from "@zaisma/core";
import { dailyCheckCount } from "./performance-check.ts";
import { largeReviewCount, smallReviewCount } from "./scan.ts";
import { logCallerEvent } from "./security-log.ts";
import { proCheckout, setProCancelled } from "./stripe.ts";
import type { Caller, NextStep } from "./developer.ts";
import type { Env } from "./env.ts";

/**
 * A developer's plan through the developer API (docs/DECISIONS.md, "Zaisma Pro raises the daily limits."): free, or
 * Zaisma Pro, $10 a month on their card apart from credit. Their AI reads the plan, starts the checkout (the person
 * pays on Stripe's page), cancels at the end of the paid month and takes that back. Stripe's events set when Pro ends
 * (stripe-events.ts); nothing here ends it by Zaisma's own clock.
 *
 *   GET  /api/dev/pro           the plan, its limits and what today used
 *   POST /api/dev/pro/checkout  → Stripe's page to pay on
 *   POST /api/dev/pro/cancel    Pro ends at the end of the paid month
 *   POST /api/dev/pro/resume    takes cancelling back
 */

interface ProRow {
  pro_until_ms: number | null;
  is_pro_cancelled: number;
  stripe_subscription_id: string | null;
}

const proRow = (env: Env, ownerId: string) =>
  env.DB.prepare("SELECT pro_until_ms, is_pro_cancelled, stripe_subscription_id FROM owners WHERE id = ?").bind(ownerId).first<ProRow>().then((row) => row ?? { pro_until_ms: null, is_pro_cancelled: 0, stripe_subscription_id: null });

const limitsAnswer = (plan: keyof typeof PLAN_LIMITS) => ({
  maximum_large_review_count: PLAN_LIMITS[plan].maximumLargeReviewsPerDay,
  maximum_small_review_count: PLAN_LIMITS[plan].maximumSmallReviewsPerDay,
  maximum_performance_check_count: PLAN_LIMITS[plan].maximumDailyCheckCount,
  maximum_version_count: PLAN_LIMITS[plan].maximumVersionsPerDay,
  maximum_game_size_bytes: PLAN_LIMITS[plan].maximumGameSizeBytes,
});

/** The pro_answer: the owner's plan, what each plan allows and what today used. */
export async function proAnswer(env: Env, ownerId: string, nowMs = Date.now()) {
  const row = await proRow(env, ownerId);
  const plan = planOf(row, nowMs);
  const [usedLargeReviewCount, usedSmallReviewCount, usedPerformanceCheckCount] = await Promise.all([largeReviewCount(env, ownerId, nowMs), smallReviewCount(env, ownerId, nowMs), dailyCheckCount(env, ownerId, nowMs)]);
  return {
    pro: {
      plan,
      pro_ends_at: plan === "pro" ? iso(row.pro_until_ms!) : null,
      is_pro_cancelled: plan === "pro" && row.is_pro_cancelled === 1,
      monthly_price_cents: PRO_PRICE_CENTS_PER_MONTH,
      limits: { free: limitsAnswer("free"), pro: limitsAnswer("pro") },
      used_today: { large_review_count: usedLargeReviewCount, small_review_count: usedSmallReviewCount, performance_check_count: usedPerformanceCheckCount },
    },
  };
}

/** One call, once the router (developer.ts, checkCall) has checked the key. */
export async function proRoute(env: Env, path: string, method: string, caller: Caller): Promise<[unknown, number?]> {
  const ownerId = caller.ownerId;
  if (path === "/pro" && method === "GET") return [await proAnswer(env, ownerId)];

  if (env.PRO_LIMIT && !(await env.PRO_LIMIT.limit({ key: ownerId })).success) {
    throw new ApiError("slow_down", { message: "Too many Zaisma Pro changes in a minute.", fix: "Wait a minute and try again.", retryAfterSec: 60 });
  }
  const row = await proRow(env, ownerId);
  const isPro = planOf(row) === "pro";

  if (path === "/pro/checkout" && method === "POST") {
    // A second subscription would be billed beside the first, so any subscription Stripe still holds (cancelled until
    // the month ends, or a renewal it is retrying) is refused too.
    if (isPro || row.stripe_subscription_id) {
      throw new ApiError("already_pro", {
        message: !isPro ? "Stripe still holds the developer's Zaisma Pro subscription: a renewal that hasn't gone through." : row.is_pro_cancelled ? "The developer has Zaisma Pro until the end of the paid month, and it's cancelled." : "The developer already has Zaisma Pro.",
        fix: !isPro ? "get_pro shows the plan; start_pro works again once Stripe lets the subscription go or the renewal goes through." : row.is_pro_cancelled ? "resume_pro takes the cancelling back; Pro then renews as before." : "get_pro shows when it renews.",
      });
    }
    const checkout = await proCheckout(env, ownerId);
    await logCallerEvent(env, caller, "pro_checkout_started");
    const nextSteps: NextStep[] = [{ tool: "get_pro", arguments: {}, after_sec: null, reason: "Ask the developer to open checkout_url and pay there; once they have, get_pro shows Zaisma Pro." }];
    return [{ checkout_url: checkout.checkoutUrl, expires_at: iso(checkout.expiresAtMs), next_steps: nextSteps }, 201];
  }

  if ((path === "/pro/cancel" || path === "/pro/resume") && method === "POST") {
    const isCancelling = path === "/pro/cancel";
    if (!isPro || !row.stripe_subscription_id || (isCancelling ? row.is_pro_cancelled === 1 : row.is_pro_cancelled === 0)) {
      throw new ApiError("not_pro", {
        message: !isPro ? "The developer has no Zaisma Pro." : isCancelling ? "Zaisma Pro is cancelled already." : "Zaisma Pro isn't cancelled, so there's nothing to take back.",
        fix: !isPro ? "start_pro answers the page where they can start it." : "get_pro shows the plan and whether it is cancelled.",
      });
    }
    await setProCancelled(env, row.stripe_subscription_id, isCancelling);
    await env.DB.prepare("UPDATE owners SET is_pro_cancelled = ? WHERE id = ?").bind(isCancelling ? 1 : 0, ownerId).run();
    await logCallerEvent(env, caller, isCancelling ? "pro_cancelled" : "pro_resumed");
    return [{ ...(await proAnswer(env, ownerId)), next_steps: [] satisfies NextStep[] }];
  }

  throw new ApiError("bad_method", { message: `${method} isn't a call at ${path}.`, fix: "docs/DEVELOPER-API.md, Zaisma Pro, lists the calls." });
}
