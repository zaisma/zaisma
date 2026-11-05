// scripts/check-records.mjs: the failure log by kind, each check's cost, catches and false alarms, and the optimization tasks only numbers close.
import { describe, expect, it } from "vitest";
import { temporaryFolder } from "../temporary-folder";
// @ts-expect-error: a Node script with no types of its own.
import { appendFailure, appendRun, checkRecords, closeTask, failureCountsByKind, failureLines, fileTasks, githubFailureLines, localDurationsSecByCheck, optimizationReasons, readFailures, readRuns, readTasks, testFailureKind } from "../../scripts/check-records.mjs";

const folder = () => temporaryFolder("zaisma-check-records-test-");

const FILE = "test/site/forum.test.ts";
const passedOn = (treeId: string, durationSec = 10) => ({ tree_id: treeId, checks: [{ check_name: FILE, duration_sec: durationSec, check_status: "passed" }] });
const failedOn = (treeId: string) => ({ tree_id: treeId, checks: [{ check_name: FILE, duration_sec: 10, check_status: "failed" }] });
const recordOf = (runs: object[], { failures = [], githubReads = [] }: { failures?: object[]; githubReads?: object[] } = {}) => checkRecords({ runs, failures, githubReads }).find((record: { check_name: string }) => record.check_name === FILE);

describe("the failure log", () => {
  it("sorts a failed test by kind", () => {
    expect(testFailureKind({ test_name: "says hello", error: "expected 1 to be 2" })).toBe("assertion");
    expect(testFailureKind({ test_name: "says hello", error: "Test timed out in 5000ms." })).toBe("timeout");
    expect(testFailureKind({ test_name: null, error: "Cannot find module" })).toBe("file_failed_to_load");
  });

  it("logs every kind a local run can find", () => {
    const lines = failureLines({
      test_failures: [{ file: FILE, test_name: "says hello", error: "nope" }],
      typecheck_failures: [{ file: "a.ts", line: 3, message: "TS2322: no" }],
      pattern_failures: ["a.ts: raw"],
      layout_failures: ["/signin Phone light: see: button: spills"],
      budget: { hard_limits: [{ line: "duration_sec at 5:01" }] },
      outcome: "over_budget",
    });
    expect(lines.map((line: { failure_kind: string }) => line.failure_kind)).toEqual(["assertion", "typecheck", "pattern", "layout", "over_budget"]);
    expect(lines[3].check_name).toBe("layout /signin");
  });

  it("logs a hand to GitHub, so a Mac that's always busy shows", () => {
    const lines = failureLines({ test_failures: [], typecheck_failures: [], pattern_failures: [], layout_failures: [], outcome: "handed_to_github", busy_reason: "macOS calls the heat fair" });
    expect(lines).toEqual([{ failure_kind: "handed_to_github", check_name: "whole run", detail: "macOS calls the heat fair" }]);
  });

  it("logs a failed GitHub job, with its name, even when its log names no test", () => {
    expect(githubFailureLines({ job_name: "Layout check", conclusion: "failure", test_failures: [], typecheck_failures: [], step_lines: ["something broke"] })).toEqual([{ failure_kind: "job", check_name: "Layout check", detail: "something broke", job_name: "Layout check" }]);
    expect(githubFailureLines({ job_name: "Tests 1", test_failures: [{ file: FILE, test_name: "x", error: "e" }], typecheck_failures: [], step_lines: [] })[0]).toMatchObject({ failure_kind: "assertion", check_name: FILE, job_name: "Tests 1" });
  });

  it("counts by kind and by where", () => {
    expect(failureCountsByKind([{ source: "local", failure_kind: "assertion" }, { source: "local", failure_kind: "assertion" }, { source: "github", failure_kind: "job" }])).toEqual({ local: { assertion: 2 }, github: { job: 1 } });
  });

  it("keeps what it's given, and reads past a line a crash cut short", () => {
    const directory = folder();
    appendRun({ outcome: "pass" }, { directory });
    appendFailure({ failure_kind: "layout" }, { directory });
    expect(readRuns({ directory })).toEqual([{ outcome: "pass" }]);
    expect(readFailures({ directory })).toEqual([{ failure_kind: "layout" }]);
  });
});

describe("each check's record", () => {
  it("adds up its cost", () => {
    expect(recordOf([passedOn("a", 10), passedOn("b", 20)])).toMatchObject({ run_count: 2, total_duration_sec: 30, median_duration_sec: 10 });
  });

  it("calls a failure a later change fixed a catch", () => {
    expect(recordOf([failedOn("a"), passedOn("b")])).toMatchObject({ catch_count: 1, false_alarm_count: 0 });
  });

  it("calls a failure the same files then passed a false alarm", () => {
    expect(recordOf([failedOn("a"), passedOn("a")])).toMatchObject({ catch_count: 0, false_alarm_count: 1 });
  });

  it("calls a failure GitHub then passed on the same files a false alarm", () => {
    expect(recordOf([failedOn("a")], { githubReads: [{ tree_id: "a", github_state: "pass" }] })).toMatchObject({ false_alarm_count: 1 });
  });

  it("gives a failure with no later run no verdict yet", () => {
    expect(recordOf([failedOn("a")])).toMatchObject({ catch_count: 0, false_alarm_count: 0 });
  });

  it("calls a GitHub failure of a check that passed here, or never ran here, a miss", () => {
    const failures = [{ source: "github", check_name: FILE, tree_id: "a" }];
    expect(recordOf([passedOn("a")], { failures })).toMatchObject({ miss_count: 1 });
    expect(recordOf([], { failures })).toMatchObject({ miss_count: 1 });
    expect(recordOf([failedOn("a")], { failures })).toMatchObject({ miss_count: 0 });
  });

  it("gives the planner this machine's own durations", () => {
    expect(localDurationsSecByCheck([passedOn("a", 10), passedOn("b", 30), passedOn("c", 20)]).get(FILE)).toBe(20);
  });
});

describe("optimization tasks", () => {
  const runOf = (duration_sec: number, has_workers_tests = true) => ({ is_budget_measured: true, has_workers_tests, duration_sec, cpu_average_core_count: 1, memory_peak_size_bytes: 1000, checks: [] });
  const history = Array.from({ length: 10 }, () => runOf(100));

  it("files one at a warning line or a hard limit", () => {
    const reasons = optimizationReasons({ ...runOf(250), warnings: [{ metric_name: "duration_sec", line_value: 240, seen_value: 250 }], hard_limits: [{ metric_name: "heat_level", line_value: 2, seen_value: 2 }] }, []);
    expect(reasons).toEqual([{ subject: "whole run", metric_name: "duration_sec", line_value: 240, seen_value: 250 }, { subject: "whole run", metric_name: "heat_level", line_value: 2, seen_value: 2 }]);
  });

  it("files nothing for one slow run on a busy Mac", () => {
    expect(optimizationReasons(runOf(200), history)).toEqual([]);
  });

  it("files one when the latest runs stand about 25% above the baseline", () => {
    expect(optimizationReasons(runOf(200), [...history, runOf(200), runOf(200)])).toEqual([{ subject: "whole run", metric_name: "duration_sec", line_value: 125, seen_value: 200 }]);
  });

  it("files nothing up to the 25%", () => {
    expect(optimizationReasons(runOf(125), [...history, runOf(125), runOf(125)])).toEqual([]);
  });

  it("compares a run only with runs that had Workers tests like it, and needs enough of them", () => {
    expect(optimizationReasons(runOf(200, false), [...history, runOf(200), runOf(200)])).toEqual([]);
    expect(optimizationReasons(runOf(200), [runOf(100), runOf(100), runOf(200), runOf(200)])).toEqual([]);
  });

  it("files one for a check that has grown, but not for a few seconds' noise", () => {
    const withCheck = (durationSec: number) => ({ ...runOf(100), checks: [{ check_name: FILE, duration_sec: durationSec, check_status: "passed" }] });
    const earlier = Array.from({ length: 10 }, () => withCheck(10));
    expect(optimizationReasons(withCheck(20), [...earlier, withCheck(20), withCheck(20)])).toEqual([{ subject: FILE, metric_name: "duration_sec", line_value: 12.5, seen_value: 20 }]);
    const small = Array.from({ length: 10 }, () => withCheck(2));
    expect(optimizationReasons(withCheck(4), [...small, withCheck(4), withCheck(4)])).toEqual([]);
  });

  const reason = { subject: "whole run", metric_name: "duration_sec", line_value: 240, seen_value: 250 };

  it("keeps one open task for one reason", () => {
    const directory = folder();
    expect(fileTasks([reason], { directory, nowText: "2026-11-04T00:00:00Z", commitSha: "abc" })).toHaveLength(1);
    expect(fileTasks([reason, reason], { directory, nowText: "2026-11-04T00:00:00Z" })).toEqual([]);
    expect(readTasks({ directory })).toHaveLength(1);
    expect(readTasks({ directory })[0]).toMatchObject({ id: "task_whole_run_duration_sec", task_status: "open", opened_on_commit_sha: "abc", before_value: null, after_value: null });
  });

  it("closes only by before and after numbers that show it back under its line", () => {
    const directory = folder();
    fileTasks([reason], { directory, nowText: "2026-11-04T00:00:00Z" });
    const close = (beforeValue: number, afterValue: number, taskId = "task_whole_run_duration_sec") => closeTask({ taskId, beforeValue, afterValue, nowText: "2026-11-05T00:00:00Z", directory });
    expect(() => close(NaN, 200)).toThrow("closes only with its numbers");
    expect(() => close(250, 250)).toThrow("isn't under 250");
    expect(() => close(250, 241)).toThrow("still over the task's line of 240");
    expect(() => close(250, 200, "task_nothing")).toThrow("No open task");
    expect(close(250, 200)).toMatchObject({ task_status: "closed", before_value: 250, after_value: 200, closed_at: "2026-11-05T00:00:00Z" });
    expect(() => close(250, 200)).toThrow("No open task");
  });

  it("opens a new task once the old one closed and the number came back", () => {
    const directory = folder();
    fileTasks([reason], { directory, nowText: "2026-11-04T00:00:00Z" });
    closeTask({ taskId: "task_whole_run_duration_sec", beforeValue: 250, afterValue: 200, nowText: "2026-11-05T00:00:00Z", directory });
    expect(fileTasks([reason], { directory, nowText: "2026-11-06T00:00:00Z" })).toHaveLength(1);
  });
});
