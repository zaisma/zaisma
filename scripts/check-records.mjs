#!/usr/bin/env node
// What npm run check keeps about itself, on this machine and never in the repository: every local run's numbers, a log of failures by
// kind (local and GitHub's), each check's cost, catches and false alarms, and the optimization tasks a run files.
//
//   node scripts/check-records.mjs                                        the last runs, each check's record and the open tasks
//   node scripts/check-records.mjs --json                                 the same, as JSON
//   node scripts/check-records.mjs --close <task_id> --before <n> --after <n>   closes a task, only by its numbers: after must be under before, and back within the task's line
//
// A catch is a local failure that a later change fixed. A false alarm is a local failure the same files then passed, here or on GitHub.
// A miss is a GitHub failure of a check that passed here on the same files, or never ran here.
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const RECORD_DIRECTORY = join(homedir(), ".zaisma/check-records");
const RUNS_FILE = "runs.jsonl";
const FAILURES_FILE = "failures.jsonl";
const GITHUB_READS_FILE = "github-reads.jsonl";
const TASKS_FILE = "tasks.json";

/** How far above its baseline a number has to go to file a task. */
export const OVER_BASELINE_SHARE = 1.25;
/** How many earlier runs make a baseline, the fewest that count, and how many of the latest it compares with it, so one slow run on a busy Mac files nothing. */
export const BASELINE_RUN_COUNT = 20;
export const FEWEST_BASELINE_RUN_COUNT = 5;
export const LATEST_RUN_COUNT = 3;
/** A check this much slower than its baseline, at least: a second's difference on a two-second file is noise. */
export const SMALLEST_CHECK_GROWTH_SEC = 5;

const median = (values) => {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
};

function readLines(directory, file) {
  let text;
  try {
    text = readFileSync(join(directory, file), "utf8");
  } catch {
    return [];
  }
  return text.split("\n").flatMap((line) => {
    try {
      return line ? [JSON.parse(line)] : [];
    } catch {
      return [];
    }
  });
}

function appendLine(directory, file, value) {
  mkdirSync(directory, { recursive: true });
  appendFileSync(join(directory, file), `${JSON.stringify(value)}\n`);
}

export const readRuns = ({ directory = RECORD_DIRECTORY } = {}) => readLines(directory, RUNS_FILE);
export const readFailures = ({ directory = RECORD_DIRECTORY } = {}) => readLines(directory, FAILURES_FILE);
export const readGithubReads = ({ directory = RECORD_DIRECTORY } = {}) => readLines(directory, GITHUB_READS_FILE);
export const appendRun = (run, { directory = RECORD_DIRECTORY } = {}) => appendLine(directory, RUNS_FILE, run);
export const appendFailure = (failure, { directory = RECORD_DIRECTORY } = {}) => appendLine(directory, FAILURES_FILE, failure);
export const appendGithubRead = (read, { directory = RECORD_DIRECTORY } = {}) => appendLine(directory, GITHUB_READS_FILE, read);

export function readTasks({ directory = RECORD_DIRECTORY } = {}) {
  try {
    return JSON.parse(readFileSync(join(directory, TASKS_FILE), "utf8"));
  } catch {
    return [];
  }
}

function writeTasks(tasks, { directory = RECORD_DIRECTORY } = {}) {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, TASKS_FILE);
  writeFileSync(`${path}.tmp`, `${JSON.stringify(tasks, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}

/** The kind of a failed test, from its error: what a run's failure log and the next steps group by. */
export function testFailureKind({ test_name: testName, error }) {
  if (testName === null) return "file_failed_to_load";
  return /timed? ?out/i.test(error) ? "timeout" : "assertion";
}

/**
 * What a run found, as failure log lines: { failure_kind, check_name, detail }. failure_kind is one of assertion, timeout,
 * file_failed_to_load, typecheck, pattern, layout, over_budget, handed_to_github and job (a GitHub job that failed with no test or typecheck error in its log).
 */
export function failureLines(result) {
  return [
    ...result.test_failures.map((failure) => ({ failure_kind: testFailureKind(failure), check_name: failure.file, detail: failure.test_name ?? failure.error.split("\n")[0] })),
    ...result.typecheck_failures.map((failure) => ({ failure_kind: "typecheck", check_name: "typecheck", detail: `${failure.file}:${failure.line}: ${failure.message}` })),
    ...result.pattern_failures.map((failure) => ({ failure_kind: "pattern", check_name: "patterns", detail: failure })),
    ...result.layout_failures.map((failure) => ({ failure_kind: "layout", check_name: `layout ${failure.split(" ")[0]}`, detail: failure })),
    ...(result.motion_failures ?? []).map((failure) => ({ failure_kind: "motion", check_name: "motion", detail: failure })),
    ...(result.budget?.hard_limits ?? []).map((limit) => ({ failure_kind: "over_budget", check_name: "whole run", detail: limit.line })),
    ...(result.outcome === "handed_to_github" ? [{ failure_kind: "handed_to_github", check_name: "whole run", detail: result.busy_reason }] : []),
  ];
}

/** The same lines for one failed job of GitHub's check (scripts/check.mjs, parseJobLog). */
export function githubFailureLines(job) {
  const lines = [
    ...job.test_failures.map((failure) => ({ failure_kind: testFailureKind(failure), check_name: failure.file, detail: failure.test_name ?? failure.error.split("\n")[0] })),
    ...job.typecheck_failures.map((failure) => ({ failure_kind: "typecheck", check_name: "typecheck", detail: `${failure.file}:${failure.line}: ${failure.message}` })),
  ];
  return (lines.length ? lines : [{ failure_kind: "job", check_name: job.job_name, detail: job.step_lines?.at(-1) ?? job.conclusion ?? "" }]).map((line) => ({ ...line, job_name: job.job_name }));
}

/** Why this run files tasks: { subject, metric_name, line_value, seen_value }. Every warning the run passed, and whatever stands about 25% above its baseline. */
export function optimizationReasons(run, earlierRuns) {
  const reasons = [...(run.warnings ?? []), ...(run.hard_limits ?? [])].map((limit) => ({ subject: "whole run", metric_name: limit.metric_name, line_value: limit.line_value, seen_value: limit.seen_value }));
  const comparableRuns = earlierRuns.filter((other) => other.is_budget_measured && other.has_workers_tests === run.has_workers_tests);
  const baselineRuns = comparableRuns.slice(0, -(LATEST_RUN_COUNT - 1)).slice(-BASELINE_RUN_COUNT);
  const latestRuns = [...comparableRuns.slice(-(LATEST_RUN_COUNT - 1)), run];
  if (baselineRuns.length >= FEWEST_BASELINE_RUN_COUNT && latestRuns.length === LATEST_RUN_COUNT) {
    for (const metricName of ["duration_sec", "cpu_average_core_count", "memory_peak_size_bytes"]) {
      const baseline = median(baselineRuns.map((other) => other[metricName]).filter(Number.isFinite));
      const latest = median(latestRuns.map((other) => other[metricName]).filter(Number.isFinite));
      if (baseline && latest > baseline * OVER_BASELINE_SHARE && !reasons.some((reason) => reason.metric_name === metricName)) reasons.push({ subject: "whole run", metric_name: metricName, line_value: baseline * OVER_BASELINE_SHARE, seen_value: latest });
    }
  }
  const history = new Map();
  for (const other of [...earlierRuns, run]) for (const check of other.checks ?? []) history.set(check.check_name, [...(history.get(check.check_name) ?? []), check.duration_sec]);
  for (const check of run.checks ?? []) {
    const durations = history.get(check.check_name);
    const earlier = durations.slice(0, -LATEST_RUN_COUNT).slice(-BASELINE_RUN_COUNT);
    if (earlier.length < FEWEST_BASELINE_RUN_COUNT) continue;
    const baseline = median(earlier);
    const latest = median(durations.slice(-LATEST_RUN_COUNT));
    if (latest > baseline * OVER_BASELINE_SHARE && latest - baseline >= SMALLEST_CHECK_GROWTH_SEC) reasons.push({ subject: check.check_name, metric_name: "duration_sec", line_value: baseline * OVER_BASELINE_SHARE, seen_value: latest });
  }
  return reasons;
}

const taskIdOf = ({ subject, metric_name: metricName }) => `task_${`${subject} ${metricName}`.replace(/[^a-zA-Z0-9]+/g, "_")}`;

/** Files a task for each reason with none open: answers the ones it opened. nowText is when. */
export function fileTasks(reasons, { nowText, commitSha = null, directory = RECORD_DIRECTORY } = {}) {
  const tasks = readTasks({ directory });
  const opened = [];
  for (const reason of reasons) {
    const id = taskIdOf(reason);
    if (tasks.some((task) => task.id === id && task.task_status === "open") || opened.some((task) => task.id === id)) continue;
    opened.push({ id, task_status: "open", opened_at: nowText, opened_on_commit_sha: commitSha, ...reason, before_value: null, after_value: null, closed_at: null });
  }
  if (opened.length) writeTasks([...tasks, ...opened], { directory });
  return opened;
}

/** Closes an open task by its numbers, or throws why it can't: only numbers close one, and they have to show it got better and back within the line. */
export function closeTask({ taskId, beforeValue, afterValue, nowText, directory = RECORD_DIRECTORY }) {
  const tasks = readTasks({ directory });
  const task = tasks.find((candidate) => candidate.id === taskId && candidate.task_status === "open");
  if (!task) throw new Error(`No open task is called ${taskId}. node scripts/check-records.mjs lists them.`);
  if (!Number.isFinite(beforeValue) || !Number.isFinite(afterValue)) throw new Error("A task closes only with its numbers: --before <n> --after <n>, measured on this machine.");
  if (afterValue >= beforeValue) throw new Error(`${afterValue} isn't under ${beforeValue}: the task stays open until a change makes the number smaller.`);
  if (afterValue > task.line_value) throw new Error(`${afterValue} is still over the task's line of ${task.line_value}: it stays open until the number is back under it.`);
  Object.assign(task, { task_status: "closed", before_value: beforeValue, after_value: afterValue, closed_at: nowText });
  writeTasks(tasks, { directory });
  return task;
}

/** Each check's record, slowest in total first: { check_name, run_count, total_duration_sec, median_duration_sec, catch_count, false_alarm_count, miss_count }. */
export function checkRecords({ runs, failures, githubReads }) {
  const records = new Map();
  const recordOf = (checkName) => {
    if (!records.has(checkName)) records.set(checkName, { check_name: checkName, run_count: 0, total_duration_sec: 0, durations: [], catch_count: 0, false_alarm_count: 0, miss_count: 0 });
    return records.get(checkName);
  };
  const passedTrees = new Set(githubReads.filter((read) => read.github_state === "pass").map((read) => read.tree_id));
  const seen = new Map();
  for (const run of runs) {
    for (const check of run.checks ?? []) {
      const record = recordOf(check.check_name);
      record.run_count++;
      record.total_duration_sec += check.duration_sec;
      record.durations.push(check.duration_sec);
      seen.set(check.check_name, [...(seen.get(check.check_name) ?? []), { tree_id: run.tree_id, is_failed: check.check_status === "failed" }]);
    }
  }
  for (const [checkName, outcomes] of seen) {
    outcomes.forEach((outcome, index) => {
      if (!outcome.is_failed) return;
      const next = outcomes.slice(index + 1).find((later) => !later.is_failed || later.tree_id !== outcome.tree_id);
      if (passedTrees.has(outcome.tree_id) || (next && !next.is_failed && next.tree_id === outcome.tree_id)) recordOf(checkName).false_alarm_count++;
      else if (next && !next.is_failed) recordOf(checkName).catch_count++;
    });
  }
  for (const failure of failures.filter((line) => line.source === "github")) {
    const here = seen.get(failure.check_name)?.filter((outcome) => outcome.tree_id === failure.tree_id) ?? [];
    if (!here.some((outcome) => outcome.is_failed)) recordOf(failure.check_name).miss_count++;
  }
  return [...records.values()]
    .map(({ durations, ...record }) => ({ ...record, total_duration_sec: Math.round(record.total_duration_sec * 10) / 10, median_duration_sec: median(durations) }))
    .sort((first, second) => second.total_duration_sec - first.total_duration_sec);
}

/** The failure log's counts by kind, split by where each happened: { local: { assertion: 3 }, github: { job: 1 } }. */
export function failureCountsByKind(failures) {
  const counts = { local: {}, github: {} };
  for (const { source, failure_kind: kind } of failures) counts[source][kind] = (counts[source][kind] ?? 0) + 1;
  return counts;
}

/**
 * What a local run costs a check going by this machine's earlier runs, or null: the middle of its recent durations. scripts/check.mjs plans
 * with it, so a run takes as many of the reached files as fit the budget.
 */
export function localDurationsSecByCheck(runs) {
  const durations = new Map();
  for (const run of runs.slice(-BASELINE_RUN_COUNT)) for (const check of run.checks ?? []) durations.set(check.check_name, [...(durations.get(check.check_name) ?? []), check.duration_sec]);
  return new Map([...durations].map(([checkName, values]) => [checkName, median(values)]));
}

function report({ directory }) {
  const runs = readRuns({ directory });
  const failures = readFailures({ directory });
  const githubReads = readGithubReads({ directory });
  return {
    recent_runs: runs.slice(-10).map(({ checks, ...run }) => run),
    run_count: runs.length,
    failure_counts_by_kind: failureCountsByKind(failures),
    checks: checkRecords({ runs, failures, githubReads }),
    open_tasks: readTasks({ directory }).filter((task) => task.task_status === "open"),
  };
}

function reportText({ recent_runs: recentRuns, run_count: runCount, failure_counts_by_kind: counts, checks, open_tasks: openTasks }) {
  const lines = [`${runCount} local run(s) on record. The latest:`];
  for (const run of recentRuns) lines.push(`  ${run.started_at} ${run.outcome} ${run.duration_sec}s, ${run.cpu_average_core_count ?? "?"} cores, ${run.memory_peak_size_bytes ? (run.memory_peak_size_bytes / 1024 ** 3).toFixed(1) : "?"} GB, heat ${run.heat_peak_status ?? "?"}, pressure ${run.memory_pressure_peak_status ?? "?"}: ${run.ran_test_file_count ?? 0} test file(s) here, ${run.left_to_github_count ?? 0} left to GitHub`);
  lines.push(`Failures by kind: here ${JSON.stringify(counts.local)}, on GitHub ${JSON.stringify(counts.github)}.`);
  lines.push("Checks, costliest first (runs, total seconds, middle seconds, catches, false alarms, misses):");
  for (const check of checks.slice(0, 25)) lines.push(`  ${check.check_name}: ${check.run_count}, ${check.total_duration_sec}, ${check.median_duration_sec}, ${check.catch_count}, ${check.false_alarm_count}, ${check.miss_count}`);
  lines.push(openTasks.length ? `${openTasks.length} open optimization task(s):` : "No open optimization tasks.");
  for (const task of openTasks) lines.push(`  ${task.id}: ${task.subject} ${task.metric_name} at ${task.seen_value}, its line ${task.line_value}`);
  return lines.join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const isJson = args.includes("--json");
  const valueOf = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const directory = RECORD_DIRECTORY;
  const refuse = (code, message, fix) => {
    console.log(isJson ? JSON.stringify({ error: { code, message, fix } }) : `FAIL ${code}: ${message} ${fix}`);
    process.exit(2);
  };
  const VALUED = ["--close", "--before", "--after"];
  const unknown = args.filter((arg, i) => !["--json", ...VALUED].includes(arg) && !VALUED.includes(args[i - 1]));
  if (unknown.length) refuse("unknown_option", `Unknown option ${unknown.join(" ")}.`, "The options are --json and --close <task_id> --before <n> --after <n>.");
  if (args.includes("--close")) {
    try {
      const task = closeTask({ taskId: valueOf("--close"), beforeValue: Number(valueOf("--before")), afterValue: Number(valueOf("--after")), nowText: new Date().toISOString(), directory });
      console.log(isJson ? JSON.stringify(task, null, 2) : `Closed ${task.id}: ${task.before_value} to ${task.after_value}.`);
    } catch (error) {
      refuse("task_not_closed", error.message, "Measure the number before and after the change, then close it with both.");
    }
    return;
  }
  const answer = report({ directory });
  console.log(isJson ? JSON.stringify(answer, null, 2) : reportText(answer));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
