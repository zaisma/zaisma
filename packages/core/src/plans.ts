/**
 * A developer's plan and its daily limits (docs/DECISIONS.md, "Zaisma Pro raises the daily limits."): free, or Zaisma
 * Pro, $10 a month on the developer's card, apart from credit. Every place that compares against a daily limit reads
 * it through limitsFor, so none can disagree about who is Pro. Seats come with Teams and custom domains with Custom
 * game domains, so neither is here.
 */

export const PLAN_KINDS = ["free", "pro"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export interface PlanLimits {
  /** Large reviews a day per developer, across all their games: a new game or a real change, read and judged. */
  maximumLargeReviewsPerDay: number;
  /** Small reviews a day per developer, across all their games: versions whose reads called the reader model. */
  maximumSmallReviewsPerDay: number;
  /** Performance checks a day per developer, counted from UTC midnight; past them a version just isn't measured. */
  maximumDailyCheckCount: number;
  /** Versions a game can get in a day. */
  maximumVersionsPerDay: number;
  /** The biggest a game's files can be together. */
  maximumGameSizeBytes: number;
}

/**
 * Every daily limit, by plan: the one place code reads them (through limitsFor). REVIEW_LIMITS in review-evidence.ts still
 * holds the free review numbers, unread, because that file can't change without a paid review-set run; plans.test.ts
 * keeps the two the same.
 */
export const PLAN_LIMITS: Record<PlanKind, PlanLimits> = {
  free: { maximumLargeReviewsPerDay: 5, maximumSmallReviewsPerDay: 30, maximumDailyCheckCount: 20, maximumVersionsPerDay: 20, maximumGameSizeBytes: 2 * 1024 ** 3 },
  pro: { maximumLargeReviewsPerDay: 20, maximumSmallReviewsPerDay: 100, maximumDailyCheckCount: 60, maximumVersionsPerDay: 100, maximumGameSizeBytes: 10 * 1024 ** 3 },
};

export const PRO_PRICE_CENTS_PER_MONTH = 1000;

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

/** A size like "2 GB" on the free plan reads "2 GB (10 GB with Zaisma Pro)"; on Pro, just the Pro size. */
export function withProSize(plan: PlanKind): string {
  const gigabytes = (kind: PlanKind) => `${PLAN_LIMITS[kind].maximumGameSizeBytes / 1024 ** 3} GB`;
  return plan === "pro" ? gigabytes("pro") : `${gigabytes("free")} (${gigabytes("pro")} with Zaisma Pro)`;
}
