/**
 * A developer's plan (docs/DECISIONS.md, "Zaisma Pro sells what developers want, never a way past a wait"): free, or
 * Zaisma Pro, $10 a month on the developer's card, apart from credit. Pro sells storage (storage.ts) and performance
 * checks; reviews and versions a day are the same for everyone. Seats come with Teams and custom domains with Custom
 * game domains, so neither is here.
 */

export const PLAN_KINDS = ["free", "pro"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export interface PlanLimits {
  /** Performance checks a day per developer, counted from UTC midnight; past them a version just isn't measured. */
  maximumDailyCheckCount: number;
}

/** Every limit a plan sets, read through limitsFor, so no two places can disagree about who is Pro. */
export const PLAN_LIMITS: Record<PlanKind, PlanLimits> = {
  free: { maximumDailyCheckCount: 20 },
  pro: { maximumDailyCheckCount: 60 },
};

export const PRO_PRICE_CENTS_PER_MONTH = 1000;

/** Zaisma Pro's first payment refunds on request within these days of it, and Pro ends then (docs/DECISIONS.md, "Zaisma Pro refunds"). */
export const PRO_REFUND_LIMITS = { refundableDurationDays: 14 } as const;

/** pro while pro_until_ms (the end of the period Stripe last said was paid) is in the future, else free. */
export function planOf(owner: { pro_until_ms: number | null }, nowMs = Date.now()): PlanKind {
  return owner.pro_until_ms !== null && owner.pro_until_ms > nowMs ? "pro" : "free";
}

/** An owner's plan, and so their limits. An unknown owner has the free ones. */
export async function limitsFor(database: D1Database, ownerId: string, nowMs = Date.now()): Promise<PlanLimits> {
  return PLAN_LIMITS[await planFor(database, ownerId, nowMs)];
}

export async function planFor(database: D1Database, ownerId: string, nowMs = Date.now()): Promise<PlanKind> {
  const owner = await database.prepare("SELECT pro_until_ms FROM owners WHERE id = ?").bind(ownerId).first<{ pro_until_ms: number | null }>();
  return owner ? planOf(owner, nowMs) : "free";
}
