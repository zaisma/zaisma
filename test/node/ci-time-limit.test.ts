import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a Node script with no types of its own.
import { CI_CEILING_SEC, CI_WARNING_SEC, ceilingVerdict, clockText, finishedRunSec, slowestJob, slowestTenthSec, warningVerdict } from "../../scripts/ci-time-limit.mjs";
// @ts-expect-error: a Node script with no types of its own.
import { repeatRunnerPlan } from "../../scripts/affected-tests.mjs";

const ROOT = join(import.meta.dirname, "../..");
const workflow = readFileSync(join(ROOT, ".github/workflows/check.yml"), "utf8");
const nightly = readFileSync(join(ROOT, ".github/workflows/nightly.yml"), "utf8");

const startedAt = "2026-11-04T10:00:00Z";
const startMs = Date.parse(startedAt);
const job = (name: string, startSec: number, endSec: number, conclusion = "success") => ({ name, conclusion, started_at: new Date(startMs + startSec * 1000).toISOString(), completed_at: new Date(startMs + endSec * 1000).toISOString() });

/** Each job in check.yml: its id, the jobs it needs and its timeout-minutes. */
function workflowJobs(text: string) {
  const section = text.slice(text.indexOf("\njobs:\n"));
  return [...section.matchAll(/^ {2}([a-z-]+):\n([\s\S]*?)(?=^ {2}[a-z-]+:\n|(?![\s\S]))/gm)].map(([, id, body]) => {
    const needsLine = body!.match(/^ {4}needs: (.+)$/m)?.[1] ?? "";
    return { id: id!, needs: needsLine.replace(/[[\]\s]/g, "").split(",").filter(Boolean), timeoutMinutes: Number(body!.match(/^ {4}timeout-minutes: (\d+)$/m)?.[1]) };
  });
}

describe("CI's ceiling", () => {
  it("is 5:00, with a warning line at 4:00", () => {
    expect([CI_CEILING_SEC, CI_WARNING_SEC]).toEqual([300, 240]);
    expect(clockText(245)).toBe("4:05");
  });

  it("lets a run through at the ceiling and fails it past that, naming its slowest job", () => {
    const jobs = [job("Typecheck", 10, 40), job("Layout check (2 of 4)", 10, 290), job("Engine exports (1 of 4)", 10, 180, "skipped")];
    expect(ceilingVerdict({ runStartedAt: startedAt, nowMs: startMs + 300_000, jobs }).is_over_ceiling).toBe(false);
    const over = ceilingVerdict({ runStartedAt: startedAt, nowMs: startMs + 301_000, jobs });
    expect(over.is_over_ceiling).toBe(true);
    expect(over.line).toContain("5:01");
    expect(over.line).toContain("Layout check (2 of 4), 4:40");
  });

  it("counts a failed job as the slowest, and no skipped or cancelled one", () => {
    expect(slowestJob([job("A", 0, 100, "failure"), job("B", 0, 900, "skipped"), job("C", 0, 800, "cancelled")]).name).toBe("A");
    expect(slowestJob([])).toBeNull();
  });

  it("fails the required check when the time limit's step fails, whatever the jobs did", () => {
    const check = workflow.slice(workflow.indexOf("name: Tests and typecheck"));
    expect(check).toContain("run: node scripts/ci-time-limit.mjs --check");
    expect(check).toContain("continue-on-error: true");
    expect(check).toContain('if [ "$TIME_LIMIT_OUTCOME" = failure ]; then');
    expect(check.indexOf('if [ "$TIME_LIMIT_OUTCOME" = failure ]; then')).toBeLessThan(check.indexOf('if [ "$CHANGES_RESULT" != success ]'));
  });

  it("holds every job to a time limit, and no chain of them far past the ceiling", () => {
    const jobs = workflowJobs(workflow);
    expect(jobs.map((each) => each.id)).toEqual(expect.arrayContaining(["changes", "tests", "seed", "layout", "sweep", "check"]));
    for (const each of jobs) {
      expect(each.timeoutMinutes, each.id).toBeGreaterThan(0);
      expect(each.timeoutMinutes, each.id).toBeLessThanOrEqual(4);
    }
    // What changed and the verdict take seconds, whatever whole minute their limits round to, so they count for nothing here.
    const minutesOf = new Map(jobs.map((each) => [each.id, ["changes", "check"].includes(each.id) ? 0 : each.timeoutMinutes]));
    const needsOf = new Map(jobs.map((each) => [each.id, each.needs]));
    const chainMinutes = (id: string): number => minutesOf.get(id)! + Math.max(0, ...needsOf.get(id)!.map(chainMinutes));
    // A chain that reached its limits would fail on the ceiling first: these only stop a stuck job.
    for (const each of jobs) expect(chainMinutes(each.id), each.id).toBeLessThanOrEqual(7);
  });
});

describe("how long a finished run took", () => {
  it("runs to its last job's end, not GitHub's updated_at", () => {
    expect(finishedRunSec(startedAt, [job("A", 5, 100), job("B", 5, 200), job("C", 5, 900, "skipped")])).toBe(200);
    expect(finishedRunSec(startedAt, [])).toBeNull();
  });
});

describe("the warning line", () => {
  const seconds = (count: number, durationSec: number) => Array.from({ length: count }, () => durationSec);
  it("reads the slowest tenth, so one slow run says nothing and a growing tail does", () => {
    expect(slowestTenthSec([...seconds(49, 200), 500])).toBe(200);
    expect(warningVerdict([...seconds(49, 200), 500]).is_over_warning).toBe(false);
    const growing = warningVerdict([...seconds(40, 200), ...seconds(10, 250)]);
    expect(growing.is_over_warning).toBe(true);
    expect(growing.line).toContain("4:10");
  });
  it("runs each night, outside a re-check of failed pages", () => {
    const job = nightly.slice(nightly.indexOf("\n  ci-time:"));
    expect(job).toContain("if: ${{ !inputs.pages }}");
    expect(job).toContain("node scripts/ci-time-limit.mjs --report");
  });
});

describe("New tests ten times", () => {
  it("keeps to one runner for a small file, and always makes ten runs", () => {
    const plan = repeatRunnerPlan(["test/node/small.test.ts"], { "test/node/small.test.ts": 500 });
    expect(plan.include).toEqual([{ runner: 1, runner_count: 1, run_count: 10 }]);
  });
  it("shares a slow file across runners, up to one a run", () => {
    const some = repeatRunnerPlan(["test/site/slow.test.ts"], { "test/site/slow.test.ts": 40_000 }).include;
    expect(some.length).toBeGreaterThan(1);
    expect(some.reduce((sum: number, each: { run_count: number }) => sum + each.run_count, 0)).toBe(10);
    expect(some.every((each: { runner_count: number }) => each.runner_count === some.length)).toBe(true);
    const most = repeatRunnerPlan(["test/site/slowest.test.ts"], { "test/site/slowest.test.ts": 900_000 }).include;
    expect(most).toHaveLength(10);
    expect(most.every((each: { run_count: number }) => each.run_count === 1)).toBe(true);
  });
  it("is what the workflow takes from What changed", () => {
    expect(workflow).toContain("matrix: ${{ fromJSON(needs.changes.outputs.repeat_runner_plan) }}");
  });
});
