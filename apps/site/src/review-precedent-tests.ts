import {
  REVIEW_PRECEDENT_LIMITS,
  addReviewUsage,
  aiUsage,
  audit,
  type ReviewPrecedent,
  type ReviewPrecedentTestResult,
} from "@zaisma/core";
import { PUBLIC_REVIEW_CASES, type PublicReviewCase } from "./generated/review-set-public-cases.generated.ts";
import { caseOutcome, reviewCase, standInCase, type CaseRun, type ReviewCase, type ReviewSetProtection } from "./review-set.ts";
import { readCode, readPictures } from "./review-readers.ts";
import { judgeVersion } from "./review-judge.ts";
import { activeReviewPrecedents } from "./review-precedents.ts";
import type { Env } from "./env.ts";

/**
 * The gate on a new review precedent ("The AI review learns from its misses." in docs/DECISIONS.md): before the
 * judge reads a ruling, the review runs with it in force on its own stand-in case and on the public cases that
 * could go wrong with it. A pass ruling must still hold every bad game of its content rule (or every bad game, once,
 * when it names none); a hold ruling must still pass every honest game. Private cases aren't in the Worker: the
 * local `npm run review-set -- --precedents` run measures those (review-set/README.md).
 */

export type ReviewPrecedentTestDeps = Parameters<typeof reviewCase>[2];

const PARALLEL_RUN_COUNT = 3;
const TEST_RETRY_AFTER_MS = 60 * 60 * 1000;
/** Rulings tested per scheduled run: each test is up to a few dozen judged reviews. */
const TEST_COUNT_PER_RUN = 2;

/** A public case as the review runs it. */
function toReviewCase(publicCase: PublicReviewCase): ReviewCase {
  return {
    name: publicCase.name,
    title: publicCase.title,
    description: publicCase.description,
    is_honest: publicCase.is_honest,
    content_rule: publicCase.content_rule,
    protection: publicCase.protection as ReviewSetProtection | null,
    why: publicCase.why,
    is_private: false,
    files: publicCase.files.map((file) => ({ path: file.path, bytes: new TextEncoder().encode(file.text) })),
  };
}

/** The cases a ruling is tried on, with how often each is run and what a good outcome is. */
export function testPlan(precedent: ReviewPrecedent, publicCases: PublicReviewCase[] = PUBLIC_REVIEW_CASES): { gameCase: ReviewCase; runCount: number; isOwnCase: boolean }[] {
  const own = { gameCase: standInCase(precedent), runCount: REVIEW_PRECEDENT_LIMITS.testRunCount, isOwnCase: true };
  if (precedent.decision === "hold") {
    return [own, ...publicCases.filter((publicCase) => publicCase.is_honest).map((publicCase) => ({ gameCase: toReviewCase(publicCase), runCount: REVIEW_PRECEDENT_LIMITS.honestTestRunCount, isOwnCase: false }))];
  }
  const sameRule = publicCases.filter((publicCase) => !publicCase.is_honest && publicCase.content_rule === precedent.content_rule);
  const neighbors = precedent.content_rule && sameRule.length ? sameRule : publicCases.filter((publicCase) => !publicCase.is_honest);
  const runCount = precedent.content_rule && sameRule.length ? REVIEW_PRECEDENT_LIMITS.testRunCount : REVIEW_PRECEDENT_LIMITS.honestTestRunCount;
  return [own, ...neighbors.map((publicCase) => ({ gameCase: toReviewCase(publicCase), runCount, isOwnCase: false }))];
}

/**
 * Runs a ruling's test: it's `active` when every case comes out right with it (and the other rulings) in force,
 * `failed` otherwise, with the cases and a sentence stored for the person. Costs go in the review's budget.
 */
export async function testReviewPrecedent(env: Env, precedent: ReviewPrecedent, deps?: ReviewPrecedentTestDeps): Promise<ReviewPrecedentTestResult> {
  const runDeps = deps ?? { readCode, readPictures, judge: judgeVersion };
  const inForce = [...(await activeReviewPrecedents(env.DB)).filter((active) => active.id !== precedent.id), precedent];
  const plan = testPlan(precedent);
  const cases: ReviewPrecedentTestResult["cases"] = [];
  let costCents = 0;
  for (let index = 0; index < plan.length; index += PARALLEL_RUN_COUNT) {
    await Promise.all(
      plan.slice(index, index + PARALLEL_RUN_COUNT).map(async ({ gameCase, runCount, isOwnCase }) => {
        const runs: CaseRun[] = [];
        for (let runIndex = 0; runIndex < runCount; runIndex++) {
          try {
            runs.push(await reviewCase(env, gameCase, runDeps, inForce));
          } catch {
            // Counted as held, as the scan would.
            runs.push({ decision: "held", finding_codes: ["ai_review_failed"], is_child_safety: false, declined_attempt_count: 0, is_judge_declined: false, cost_cents: 0, input_token_count: 0, output_token_count: 0 });
          }
        }
        costCents += runs.reduce((runningCents, caseRun) => runningCents + caseRun.cost_cents, 0);
        cases.push({ name: gameCase.name, is_honest: gameCase.is_honest, outcome: caseOutcome(gameCase.is_honest, runs.map((caseRun) => caseRun.decision)), is_own_case: isOwnCase });
      }),
    );
  }
  await addReviewUsage(env.DB, costCents);
  const wrong = cases.filter((tested) => tested.outcome !== "held_bad" && tested.outcome !== "passed_honest");
  const isPassing = wrong.length === 0;
  const summary = isPassing
    ? `Held: ${cases.length} cases came out right with the ruling in force.`
    : `Didn't hold: ${wrong.map((tested) => `${tested.is_own_case ? "its own test game" : tested.name} (${tested.outcome.replace(/_/g, " ")})`).join(", ")}.`;
  return { is_passing: isPassing, cases, summary };
}

/**
 * The scheduled run: tests the waiting rulings, at most REVIEW_PRECEDENT_LIMITS.maximumTestCountPerDay a day and
 * TEST_COUNT_PER_RUN a run, while the review's budget lasts. A test that never finished (the Worker was cut
 * off) is tried again after an hour. A ruling that replaces another retires it when it goes live.
 */
export async function testWaitingReviewPrecedents(env: Env, deps?: ReviewPrecedentTestDeps, nowMs = Date.now()): Promise<number> {
  if (!env.ANTHROPIC_API_KEY) return 0;
  if ((await aiUsage(env.DB)).review_cost_cents >= (Number(env.AI_REVIEW_MONTHLY_BUDGET_CENTS) || 0)) return 0;
  const startedToday = await env.DB.prepare("SELECT COUNT(*) AS started_count FROM review_precedents WHERE tested_at_ms > ?").bind(nowMs - 24 * 60 * 60 * 1000).first<{ started_count: number }>();
  const remainingTestCount = Math.min(TEST_COUNT_PER_RUN, REVIEW_PRECEDENT_LIMITS.maximumTestCountPerDay - (startedToday?.started_count ?? 0));
  if (remainingTestCount <= 0) return 0;
  const { results } = await env.DB
    .prepare("SELECT * FROM review_precedents WHERE review_precedent_status = 'testing' AND (tested_at_ms IS NULL OR (test_result IS NULL AND tested_at_ms < ?)) ORDER BY updated_at_ms LIMIT ?")
    .bind(nowMs - TEST_RETRY_AFTER_MS, remainingTestCount)
    .all<ReviewPrecedent>();
  let testedCount = 0;
  for (const precedent of results) {
    // Claim it, so an overlapping run never tests it twice.
    const claim = await env.DB
      .prepare("UPDATE review_precedents SET tested_at_ms = ? WHERE id = ? AND review_precedent_status = 'testing' AND (tested_at_ms IS NULL OR (test_result IS NULL AND tested_at_ms < ?))")
      .bind(nowMs, precedent.id, nowMs - TEST_RETRY_AFTER_MS)
      .run();
    if (!claim.meta.changes) continue;
    try {
      const testResult = await testReviewPrecedent(env, precedent, deps);
      const status = testResult.is_passing ? "active" : "failed";
      await env.DB.prepare("UPDATE review_precedents SET review_precedent_status = ?, test_result = ?, updated_at_ms = ? WHERE id = ? AND review_precedent_status = 'testing'").bind(status, JSON.stringify(testResult), Date.now(), precedent.id).run();
      if (testResult.is_passing && precedent.replaces_review_precedent_id) {
        await env.DB.prepare("UPDATE review_precedents SET review_precedent_status = 'retired', updated_at_ms = ? WHERE id = ? AND review_precedent_status = 'active'").bind(Date.now(), precedent.replaces_review_precedent_id).run();
      }
      await audit(env.DB, null, "review-precedent-tested", `${precedent.title}: ${testResult.summary}`, "system");
      testedCount++;
    } catch (error) {
      // Tried again after an hour.
      console.error("review precedent test failed", precedent.id, error);
    }
  }
  return testedCount;
}
