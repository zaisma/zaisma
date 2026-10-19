import type { ContentRule } from "./review.ts";

/**
 * Review precedents ("The AI review learns from its misses." in docs/DECISIONS.md): a ruling a person made
 * when the AI review was wrong, which the judge reads with every brief. pass: the review was wrong to hold
 * games like this. hold: it was wrong to pass them. Each carries a stand-in test case written to show the
 * pattern, never a copy of a developer's game. Plain code with no storage, so the review test set's runner
 * (apps/site/src/review-set.ts) bundles it for Node.
 */

export const REVIEW_PRECEDENT_DECISIONS = { pass: "Pass games like this", hold: "Hold games like this" } as const;
export type ReviewPrecedentDecision = keyof typeof REVIEW_PRECEDENT_DECISIONS;

/** proposed (drafted, waiting for a person), testing (waiting for the test set), active (the judge reads it), failed (the test set didn't hold) or retired. */
export const REVIEW_PRECEDENT_STATUSES = ["proposed", "testing", "active", "failed", "retired"] as const;
export type ReviewPrecedentStatus = (typeof REVIEW_PRECEDENT_STATUSES)[number];

export const REVIEW_PRECEDENT_LIMITS = {
  /** The judge reads at most this many active rulings, oldest first. */
  maximumJudgedCount: 40,
  /** Tests of new rulings per day; the rest wait for the next day. */
  maximumTestCountPerDay: 10,
  /** Runs of the ruling's own stand-in and of every same-rule bad case. */
  testRunCount: 3,
  /** Runs of each honest case, for a hold ruling. */
  honestTestRunCount: 1,
} as const;

/** A ruling a person made when the AI review was wrong (migrations/0093_review_precedents.sql). */
export interface ReviewPrecedent {
  id: string;
  title: string;
  applies_when: string;
  decision: ReviewPrecedentDecision;
  content_rule: ContentRule | null;
  why: string;
  review_precedent_status: ReviewPrecedentStatus;
  from_version_id: string | null;
  from_report_group_id: string | null;
  replaces_review_precedent_id: string | null;
  case_title: string;
  case_description: string;
  case_index_html: string;
  /** What the test run found, as JSON (ReviewPrecedentTestResult). */
  test_result: string | null;
  tested_at_ms: number | null;
  created_by: string;
  created_at_ms: number;
  updated_at_ms: number;
}

/** What a ruling's test run found: each case that was run, and whether it came out right. */
export interface ReviewPrecedentTestResult {
  is_passing: boolean;
  cases: { name: string; is_honest: boolean; outcome: string; is_own_case: boolean }[];
  /** Plain words for the person: why it failed, or that it held. */
  summary: string;
}

/** The fields the judge reads from a ruling. */
export type JudgedReviewPrecedent = Pick<ReviewPrecedent, "id" | "title" | "applies_when" | "decision" | "content_rule" | "why">;

/** One ruling as the judge reads it: a numbered JSON line, so it can say which numbers it followed. */
export function reviewPrecedentLine(precedent: JudgedReviewPrecedent, number: number): string {
  return JSON.stringify({ number, decision: precedent.decision, content_rule: precedent.content_rule, applies_when: precedent.applies_when, why: precedent.why });
}
