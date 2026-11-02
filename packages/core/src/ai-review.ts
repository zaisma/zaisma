import type { Version } from "./types.ts";

/**
 * Where a version stands with the AI review ("Fixed checks first, the AI review after publishing" in
 * docs/DECISIONS.md): a version passes the fixed checks by itself, and the AI review follows behind for what other
 * people can reach. not_started: nobody asked, so only its developer can reach it. waiting: asked for, and not sent
 * yet (a free daily review, or the next run). reviewing: with the readers or the judge. passed: it passed, or a
 * person passed it. stopped: held or rejected (scan_status says which). skipped: past the review's monthly budget,
 * it went on with the fixed checks alone.
 */
export const AI_REVIEW_STATUSES = ["not_started", "waiting", "reviewing", "passed", "stopped", "skipped"] as const;
export type AiReviewStatus = (typeof AI_REVIEW_STATUSES)[number];

/** at_once: full price, about a minute. batch: half price, usually under an hour. */
export const AI_REVIEW_SPEEDS = ["at_once", "batch"] as const;
export type AiReviewSpeed = (typeof AI_REVIEW_SPEEDS)[number];

/** The daily review a waiting version waits for a free one of. */
export const AI_REVIEW_WAITING_REASONS = ["daily_large_reviews_used", "daily_small_reviews_used"] as const;
export type AiReviewWaitingReason = (typeof AI_REVIEW_WAITING_REASONS)[number];

export const AI_REVIEW_LIMITS = {
  /** A game with this many counted plays in the last 7 days is reviewed at once: a bad update would reach too many before a batch ends. */
  minimumAtOnceWeeklyPlayCount: 1000,
  /** A scheduled release's review starts this long before its time: a batch ends within 24 hours. */
  scheduledStartBeforeDurationHours: 24,
  /** Reviews each usual time is measured from, and how far back. */
  usualDurationReviewCount: 50,
  usualDurationPeriodDays: 14,
  /** The share of those reviews the usual time covers: "usually" has to be true. */
  usualDurationPct: 80,
  /** Too few reviews to measure: what Anthropic's docs and the first reviews say. */
  minimumUsualDurationReviewCount: 5,
  defaultBatchDurationMin: 60,
  defaultAtOnceDurationMin: 1,
  /** Batch times are said to the next 5 minutes: a more exact number would promise more than a batch can. */
  batchDurationStepMin: 5,
  /** Anthropic takes up to 256 MB in a batch; this keeps one inside a Worker's memory. */
  maximumBatchSizeBytes: 32 * 1024 * 1024,
  /** A shared read this big isn't kept: the file is read again instead. */
  maximumReadFileRowSizeBytes: 64 * 1024,
  readFileKeptDurationDays: 180,
  /** A waiting review no job has moved in this long is queued again: its message was lost, or its job kept failing. */
  staleQueuedDurationMin: 60,
} as const;

/** The review is over, and it let the version through. */
export const isAiReviewDone = (version: Pick<Version, "ai_review_status">): boolean => version.ai_review_status === "passed" || version.ai_review_status === "skipped";

/** Whether other people may reach this version: its review let it through, or its developer has earned going first. */
export const isOpenToOthers = (version: Pick<Version, "ai_review_status" | "is_open_before_ai_review">): boolean => isAiReviewDone(version) || version.is_open_before_ai_review === 1;

/** isOpenToOthers as a WHERE fragment on versions. */
export const OPEN_TO_OTHERS_SQL = "(ai_review_status IN ('passed', 'skipped') OR is_open_before_ai_review = 1)";

/** The review is still to finish. */
export const isAiReviewPending = (version: Pick<Version, "ai_review_status">): boolean => version.ai_review_status === "waiting" || version.ai_review_status === "reviewing";

/** The share-th percentile of a list of durations, in whole minutes: at_once rounds up to the minute, batch up to its step. */
export function usualDurationMin(durationsMs: number[], speed: AiReviewSpeed): number {
  if (durationsMs.length < AI_REVIEW_LIMITS.minimumUsualDurationReviewCount) return speed === "batch" ? AI_REVIEW_LIMITS.defaultBatchDurationMin : AI_REVIEW_LIMITS.defaultAtOnceDurationMin;
  const sorted = [...durationsMs].sort((first, second) => first - second);
  const atShareMs = sorted[Math.min(sorted.length - 1, Math.ceil((sorted.length * AI_REVIEW_LIMITS.usualDurationPct) / 100) - 1)]!;
  const step = speed === "batch" ? AI_REVIEW_LIMITS.batchDurationStepMin : 1;
  return Math.max(step, Math.ceil(atShareMs / 60_000 / step) * step);
}

/** A duration as a page says it: "a minute", "about 40 minutes", "about 2 hours". */
export function usualDurationWords(durationMin: number): string {
  if (durationMin <= 1) return "about a minute";
  if (durationMin < 90) return `about ${durationMin} minutes`;
  return `about ${Math.round(durationMin / 60)} hours`;
}
