#!/usr/bin/env node
// One command for a change's checks on this machine: the typecheck, the pattern rules (docs/PATTERN-RULES.md), the Node tests the change can reach and the change's own new or
// changed Workers test files side by side, and the Layout check for the pages it changed when this checkout's preview is awake.
// Then as many of the other Workers test files the change reaches as fit the budget (scripts/check-budget.mjs), a batch at a time; the
// rest are left to GitHub's check on the pull request, and so are its own when another Workers test run is already going on this machine
// (one at a time, scripts/preview/memory.mjs). The whole site's and every screen's runs are always GitHub's. It runs at low priority, one
// run on a machine at a time, waits up to two minutes for a busy Mac and then hands everything to GitHub's check. Over a hard limit it
// stops there and says OVER BUDGET, never PASS. Every run records its numbers (scripts/check-records.mjs). It prints PASS, or FAIL with,
// for each failure, the test file, the test's name and the first lines of its error, and each typecheck error as file:line: message.
// Never the full output.
//
//   npm run check                    runs the Node tests this checkout's change can reach (scripts/affected-tests.mjs), its own
//                                    Workers test files, the typecheck, and the Layout check for the changed pages when the preview
//                                    is awake
//   npm run check -- --json          the same, as JSON; a refusal is {"error": {"code", "message", "fix"}}
//   npm run check -- --base <ref>    changes since that commit instead of since origin/main
//   npm run check -- --pr <number>   reads GitHub's check on that pull request's latest commit instead of running anything:
//                                    PENDING with the jobs still running, PASS, or FAIL with each failed job's failures in the
//                                    same lines (its tests, its typecheck errors, or the last lines of the step that failed)
//   npm run check -- --commit <sha>  the same for one commit
//
// Test runs never wait for memory (scripts/preview/memory.mjs): when its own Workers files don't fit this runs the Node tests alone, and
// when those don't either it runs no tests, listing each file that didn't run here as left_to_github and left_to_github_for_memory. Last
// line: PASS or FAIL, naming what that left out of it, OVER BUDGET or HANDED TO GITHUB (or PENDING, for --pr and --commit).
// Exit status: 0 PASS, 1 FAIL, 2 a refusal, 3 PENDING, 4 OVER BUDGET, 5 HANDED TO GITHUB.
import { execFile, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { ROOT, affectedChecks, changedPathsSince } from "./affected-tests.mjs";
import { CPU_AVERAGE_FROM_SEC, DURATION_WARNING_SEC, budgetLine, budgetVerdict, busyReason, isRunWaiting, readMachineState, releaseRunTurn, startBudgetWatch, waitForRunTurn } from "./check-budget.mjs";
import { appendFailure, appendGithubRead, appendRun, checkRecords, failureLines, fileTasks, githubFailureLines, localDurationsSecByCheck, optimizationReasons, readFailures, readGithubReads, readRuns, readTasks } from "./check-records.mjs";
import { LINE_DIRECTORY, NO_ROOM_FOR_TESTS, isAlive, readLine, runAtLowPriority } from "./preview/memory.mjs";
import { GITHUB_CHECK_NAME } from "./ship-github-check.mjs";

export const ERROR_LINE_COUNT = 15;
const GITHUB_REPOSITORY = "zaisma/zaisma";
const FAILED_CONCLUSIONS = ["failure", "timed_out", "cancelled", "action_required", "startup_failure"];
// Test files that run on plain Node, light enough for this machine; every other project's run in the Workers runtime.
const NODE_TEST_FILE = /^test\/(node|layout|contracts)\//;
// Files at once for a test run here. Measured Nov 4, 2026 on the 8 GB Mac: 2 Node files stayed at 1.7 GB and 3 passed the 2 GB warning at 2.5 GB; a Workers file takes about 0.9 GB.
const LOCAL_WORKER_COUNT = 2;
// How many files a last line names; --json lists them all.
const NAMED_FILE_COUNT = 5;
// The Workers projects' files a run may take beyond its own, going by what fits. Every other project is GitHub's: the Layout check's own tests measure every page, and test/load measures how fast something runs.
const EXTRA_TEST_FILE = /^test\/(core|games|game-server|rooms|site)\//;
// How many extra files go in one vitest run, so a run can stop between batches. Each batch pays for vitest's start again.
const EXTRA_BATCH_FILE_COUNT = 8;
// A run takes no more extra files once it expects to end past this: under the warning line, with room for one batch going long.
export const EXTRA_FILES_UNTIL_SEC = DURATION_WARNING_SEC - 30;
// What an extra file costs here until this machine has measured it: what GitHub's runners measured (test/shard-weights.json) times LOCAL_SLOWER_SHARE, plus a Workers file's own start.
const LOCAL_SLOWER_SHARE = 1.5;
const WORKERS_START_SEC = 8;
const STOP_GRACE_MS = 5000;
const EXIT_STATUS_BY_OUTCOME = { pass: 0, fail: 1, over_budget: 4, handed_to_github: 5 };

/**
 * Which of the reached test files run here, which only if they fit the budget, and which are left to GitHub's check: the Node ones and the
 * change's own Workers test files (ones it adds or changes) run here, unless another Workers test run is going on this machine; the other
 * Workers files are extra; every other file goes to GitHub.
 */
export function splitTestFiles(testFiles, changedPaths, { isWorkersRunGoing = false } = {}) {
  const changed = new Set(changedPaths);
  // The Layout check's own tests measure every page: GitHub's, never a laptop's (the change's pages are measured here instead, below).
  const isWholeLayout = (path) => path.startsWith("test/layout/");
  const here = testFiles.filter((path) => !isWholeLayout(path) && (NODE_TEST_FILE.test(path) || (!isWorkersRunGoing && changed.has(path))));
  const extras = isWorkersRunGoing ? [] : testFiles.filter((path) => !here.includes(path) && EXTRA_TEST_FILE.test(path));
  return { here, extras, leftToGithub: testFiles.filter((path) => !here.includes(path)) };
}

/** What a file is likely to cost here: this machine's own record of it, or else GitHub's times made slower. */
export function estimatedDurationSec(path, { localDurationsSec = new Map(), githubDurationsMs = {} } = {}) {
  return localDurationsSec.get(path) ?? WORKERS_START_SEC + ((githubDurationsMs[path] ?? 0) / 1000) * LOCAL_SLOWER_SHARE;
}

/**
 * The extra files in the order they're worth running: first any named like a changed file (apps/site/src/forum.ts, test/site/forum.test.ts),
 * then the ones that have caught most here, then the cheapest, so a run takes as many as it can.
 */
export function rankExtraFiles(files, changedPaths, { catchCountByFile = new Map(), ...estimates } = {}) {
  const changedNames = new Set(changedPaths.map((path) => path.replace(/^.*\//, "").replace(/\.[^.]*$/, "")));
  const isNamed = (path) => changedNames.has(path.replace(/^.*\//, "").replace(/\.test\.[^.]*$/, ""));
  return [...files].sort((first, second) => isNamed(second) - isNamed(first) || (catchCountByFile.get(second) ?? 0) - (catchCountByFile.get(first) ?? 0) || estimatedDurationSec(first, estimates) - estimatedDurationSec(second, estimates) || first.localeCompare(second));
}

/** The next files to run, in order, that fit the seconds left at this many files at once: never more than a batch. */
export function nextExtraBatch(rankedFiles, { remainingSec, workerCount = LOCAL_WORKER_COUNT, ...estimates }) {
  const batch = [];
  let totalSec = WORKERS_START_SEC;
  for (const path of rankedFiles.slice(0, EXTRA_BATCH_FILE_COUNT)) {
    totalSec += estimatedDurationSec(path, estimates) / workerCount;
    if (totalSec > remainingSec) break;
    batch.push(path);
  }
  return batch;
}

/** Whether a Workers test run has its turn on this machine now (scripts/preview/memory.mjs's line). */
function isWorkersRunGoing({ directory = LINE_DIRECTORY } = {}) {
  try {
    return readLine({ directory }).entries.some((entry) => entry.kind === "test" && !entry.is_node_only && entry.turn_given_at_ms !== null && isAlive(entry.pid));
  } catch {
    return false;
  }
}

/** The failed tests in vitest's JSON report: the file, the test's full name and the first lines of its error. A file that failed to load has no test name. */
export function parseVitestReport(report, { root = ROOT } = {}) {
  const failures = [];
  for (const file of report.testResults ?? []) {
    const path = file.name.startsWith(root) ? relative(root, file.name) : file.name;
    const failedTests = (file.assertionResults ?? []).filter((test) => test.status === "failed");
    for (const test of failedTests) failures.push({ file: path, test_name: test.fullName, error: firstLines((test.failureMessages ?? []).join("\n")) });
    if (file.status === "failed" && !failedTests.length) failures.push({ file: path, test_name: null, error: firstLines(file.message ?? "") });
  }
  return failures;
}

/** tsc's lines as { file, line, message }: `a.ts(3,5): error TS2322: Type…` becomes a.ts:3: TS2322: Type… */
export function parseTypecheck(output) {
  return output
    .split("\n")
    .map((text) => text.match(/^(.+?)\((\d+),\d+\): error (TS\d+: .*)$/))
    .filter(Boolean)
    .map(([, file, line, message]) => ({ file, line: Number(line), message }));
}

/**
 * The layout-check pages (their paths) that changed files name: apps/site/src/browse.ts is the page /browse, only where the file's name is a
 * page's path. A changed component file names the gallery pages that show its components (each component({ group, subgroup }) in it is
 * /design/<group>/<subgroup>, or /design/<group> for a group of one page): sourceOf(path) reads a changed file's text.
 */
export function pagesForChangedFiles(changedPaths, pagePaths, sourceOf = () => "") {
  const names = changedPaths.filter((path) => /^apps\/site\/src\/.+\.ts$/.test(path)).map((path) => path.replace(/^.*\//, "").replace(/\.ts$/, ""));
  const named = pagePaths.filter((pagePath) => pagePath !== "/" && names.some((name) => pagePath.split("/").includes(name)));
  const galleryPaths = changedPaths.filter((path) => /^apps\/site\/src\/components\/.+\.ts$/.test(path)).flatMap((path) =>
    [...sourceOf(path).matchAll(/component\(\{[^}]*?group:\s*"([a-z-]+)",\s*subgroup:\s*"([a-z-]+)"/g)].map(([, group, subgroup]) => `/design/${group}/${subgroup}`));
  return [...new Set([...named, ...galleryPaths.filter((galleryPath) => pagePaths.includes(galleryPath))])];
}

/**
 * The tests that run here, going by what fits now: every file in here, then only the Node ones when the Workers ones have no room,
 * then none. Never waits (scripts/preview/memory.mjs). runVitest(files, env) answers { output, report }. Answers the failures, and
 * which files went to GitHub: leftToGithub all that didn't run here, leftForMemory those of them only for lack of memory.
 */
export async function runTestsThatFit({ here, testFiles, normallyHere = here, runVitest }) {
  const isRefused = (run) => !run.report && run.output.includes(NO_ROOM_FOR_TESTS);
  const nodeFiles = here.filter((path) => NODE_TEST_FILE.test(path));
  let ranHere = here;
  const workerLimit = { TEST_WORKER_COUNT: String(LOCAL_WORKER_COUNT) };
  let run = here.length ? await runVitest(here, workerLimit) : null;
  if (run && isRefused(run) && here.length > nodeFiles.length) {
    ranHere = nodeFiles;
    run = nodeFiles.length ? await runVitest(nodeFiles, workerLimit) : null;
  }
  if (run && isRefused(run)) {
    ranHere = [];
    run = null;
  }
  // A run the budget stopped says nothing about its files: GitHub's check runs them.
  if (run?.is_stopped) return { failures: [], ranHere: [], report: null, leftToGithub: testFiles, leftForMemory: [] };
  const left = { ranHere, report: run?.report ?? null, leftToGithub: testFiles.filter((path) => !ranHere.includes(path)), leftForMemory: normallyHere.filter((path) => !ranHere.includes(path)) };
  if (!run) return { failures: [], ...left };
  if (!run.report) return { failures: [{ file: "vitest", test_name: null, error: firstLines(run.output) }], ...left };
  return { failures: parseVitestReport(run.report), ...left };
}

/** Each test file in vitest's JSON report as a check: { check_name, duration_sec, check_status }. */
export function testFileChecks(report, { root = ROOT } = {}) {
  return (report?.testResults ?? []).map((file) => ({
    check_name: file.name.startsWith(root) ? relative(root, file.name) : file.name,
    duration_sec: Math.round(((file.endTime ?? file.startTime ?? 0) - (file.startTime ?? 0)) / 100) / 10,
    check_status: file.status === "failed" ? "failed" : "passed",
  }));
}

/** The text a run prints: PASS or FAIL with each failure, ending on that word and what the memory left out of it. */
export function formatResult(result) {
  const lines = [];
  for (const failure of result.test_failures) lines.push(`TEST ${failure.file}${failure.test_name ? ` > ${failure.test_name}` : ""}`, ...failure.error.split("\n").map((text) => `  ${text}`));
  for (const failure of result.typecheck_failures) lines.push(`TYPE ${failure.file}:${failure.line}: ${failure.message}`);
  for (const failure of result.pattern_failures) lines.push(`PATTERN ${failure}`);
  for (const failure of result.layout_failures) lines.push(`LAYOUT ${failure}`);
  const forMemory = result.left_to_github_for_memory ?? [];
  const others = result.left_to_github.length - forMemory.length;
  if (others) lines.push(`Left to GitHub's check: ${others} Workers test file(s). Push, and read npm run check -- --pr <number>.`);
  for (const note of result.notes) lines.push(note);
  const namedText = `${forMemory.slice(0, NAMED_FILE_COUNT).join(", ")}${forMemory.length > NAMED_FILE_COUNT ? ` and ${forMemory.length - NAMED_FILE_COUNT} more (--json lists them)` : ""}`;
  if (forMemory.length) lines.push("No room in the memory cap for these tests, and test runs never wait for it: push, and read npm run check -- --pr <number>. npm run preview:list shows what holds the memory.");
  if (result.budget) lines.push(budgetLine(result.budget));
  for (const warning of result.budget?.warnings ?? []) lines.push(`Warning: ${warning.line}.`);
  if (result.filed_task_count) lines.push(`Filed ${result.filed_task_count} optimization task(s).`);
  if (result.open_task_count) lines.push(`${result.open_task_count} optimization task(s) open: node scripts/check-records.mjs lists them.`);
  const isFailed = result.test_failures.length || result.typecheck_failures.length || result.pattern_failures.length || result.layout_failures.length;
  const overBudgetText = (result.budget?.hard_limits ?? []).map((limit) => limit.line).join("; ");
  if (result.outcome === "handed_to_github") lines.push(`HANDED TO GITHUB: ${result.busy_reason}, so nothing ran here. Not a pass: push, and read npm run check -- --pr <number>.`);
  else if (result.outcome === "over_budget" && !isFailed) lines.push(`OVER BUDGET: ${overBudgetText}. It stopped there. Not a pass: what it didn't finish is left to GitHub's check, so push, and read npm run check -- --pr <number>.`);
  else lines.push(`${result.is_pass ? "PASS" : "FAIL"}${result.outcome === "over_budget" ? `, and over budget: ${overBudgetText}` : ""}${forMemory.length ? `, without ${forMemory.length} test file(s) that didn't run here, left to GitHub's check: ${namedText}` : ""}`);
  return lines.join("\n");
}

/** A GitHub Actions job log's lines as printed: no timestamps, no colors. */
export function cleanJobLog(log) {
  return log
    .replace(/^\uFEFF/, "")
    .split("\n")
    .map((line) => line.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, "").replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\r$/, ""));
}

/** vitest's "Failed Tests" and "Failed Suites" blocks in a log: each failed test's file and name, and the first lines of its error. */
export function parseVitestLog(lines) {
  const failures = [];
  let isInBlock = false;
  let heads = [];
  let errorLines = [];
  const flush = () => {
    const error = firstLines(errorLines.filter((text) => text.trim()).join("\n"));
    for (const head of heads) failures.push({ ...head, error });
    heads = [];
    errorLines = [];
  };
  for (const line of lines) {
    if (/^⎯+ Failed (Tests|Suites) \d+ ⎯+$/.test(line.trim())) {
      flush();
      isInBlock = true;
      continue;
    }
    if (!isInBlock) continue;
    if (/^\s*Test Files\s/.test(line) || line.startsWith("##[")) {
      flush();
      isInBlock = false;
      continue;
    }
    if (/^⎯+(\[\d+\/\d+\])?⎯*$/.test(line.trim())) {
      flush();
      continue;
    }
    const head = line.match(/^\s*FAIL\s+(?:\S+\s+)?(\S+\.[cm]?[jt]sx?)(?:\s+>\s+(.+?))?(?:\s+\[.*\])?\s*$/);
    if (head) {
      if (errorLines.some((text) => text.trim())) flush();
      heads.push({ file: head[1], test_name: head[2] ?? null });
      continue;
    }
    if (heads.length) errorLines.push(line);
  }
  flush();
  return failures;
}

/** The last lines the step that failed printed, when the log names no test or typecheck error (the Engine exports, the preview). */
export function failedStepLines(lines) {
  const errorIndex = lines.findIndex((line) => line.startsWith("##[error]"));
  const end = errorIndex === -1 ? lines.length : errorIndex;
  let start = 0;
  for (let i = end - 1; i >= 0; i--) {
    if (lines[i].startsWith("##[endgroup]")) start = i + 1;
    if (lines[i].startsWith("##[group]Run ")) break;
  }
  const printed = lines.slice(start, end).filter((line) => line.trim() && !line.startsWith("##["));
  const errors = lines.slice(end).filter((line) => line.startsWith("##[error]") && !/^##\[error\]Process completed with exit code/.test(line));
  return [...printed.slice(-ERROR_LINE_COUNT), ...errors.map((line) => line.slice("##[error]".length))].slice(-ERROR_LINE_COUNT);
}

/** One failed job's log, read the way the local run reads its own output. */
export function parseJobLog(log) {
  const lines = cleanJobLog(log);
  const test_failures = parseVitestLog(lines);
  const typecheck_failures = parseTypecheck(lines.join("\n"));
  return { test_failures, typecheck_failures, step_lines: test_failures.length || typecheck_failures.length ? [] : failedStepLines(lines) };
}

/** A commit's check runs (GitHub's latest of each) as PASS, PENDING or FAIL, and the jobs that failed. The required check, which only sums the others up, counts as a failed job only when nothing else failed. */
export function judgeCheckRuns(checkRuns) {
  const pendingJobNames = checkRuns.filter((checkRun) => checkRun.status !== "completed").map((checkRun) => checkRun.name);
  const failedRuns = checkRuns.filter((checkRun) => checkRun.status === "completed" && FAILED_CONCLUSIONS.includes(checkRun.conclusion));
  const failedJobs = failedRuns.some((checkRun) => checkRun.name !== GITHUB_CHECK_NAME) ? failedRuns.filter((checkRun) => checkRun.name !== GITHUB_CHECK_NAME) : failedRuns;
  const state = failedJobs.length ? "fail" : pendingJobNames.length || !checkRuns.length ? "pending" : "pass";
  return { state, pending_job_names: pendingJobNames, failed_jobs: failedJobs };
}

/** What --pr and --commit print: each failed job with its failures, then PASS, PENDING or FAIL. */
export function formatGithubResult(result) {
  const lines = [`GitHub's check on ${result.commit_sha.slice(0, 7)}${result.pull_request_number ? ` (pull request ${result.pull_request_number})` : ""}`];
  for (const job of result.failed_jobs) {
    lines.push(`JOB ${job.job_name} ${job.url}`);
    for (const failure of job.test_failures) lines.push(`TEST ${failure.file}${failure.test_name ? ` > ${failure.test_name}` : ""}`, ...failure.error.split("\n").map((text) => `  ${text}`));
    for (const failure of job.typecheck_failures) lines.push(`TYPE ${failure.file}:${failure.line}: ${failure.message}`);
    for (const text of job.step_lines) lines.push(`  ${text}`);
  }
  if (result.pending_job_names.length) lines.push(`Still running: ${result.pending_job_names.join(", ")}.`);
  if (result.state === "pending" && !result.pending_job_names.length) lines.push("No job has started on this commit yet.");
  lines.push(result.state.toUpperCase());
  return lines.join("\n");
}

async function gh(args) {
  return (await promisify(execFile)("gh", args, { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 })).stdout;
}

export async function githubCheck({ pullRequestNumber = null, commitSha = null }) {
  if (pullRequestNumber) commitSha = JSON.parse(await gh(["pr", "view", String(pullRequestNumber), "--repo", GITHUB_REPOSITORY, "--json", "headRefOid"])).headRefOid;
  const checkRuns = JSON.parse(await gh(["api", "--paginate", "--slurp", `repos/${GITHUB_REPOSITORY}/commits/${commitSha}/check-runs?per_page=100`])).flatMap((page) => page.check_runs);
  const judged = judgeCheckRuns(checkRuns);
  const failedJobs = await Promise.all(
    judged.failed_jobs.map(async (checkRun) => {
      let parsed;
      try {
        parsed = parseJobLog(await gh(["api", `repos/${GITHUB_REPOSITORY}/actions/jobs/${checkRun.id}/logs`]));
      } catch {
        parsed = { test_failures: [], typecheck_failures: [], step_lines: [`GitHub has no log for this job (${checkRun.conclusion}): open ${checkRun.html_url}`] };
      }
      return { job_name: checkRun.name, conclusion: checkRun.conclusion, url: checkRun.html_url, ...parsed };
    }),
  );
  const result = { pull_request_number: pullRequestNumber, commit_sha: commitSha, state: judged.state, pending_job_names: judged.pending_job_names, failed_jobs: failedJobs };
  recordGithubRead(result);
  return result;
}

/** A read of GitHub's check goes in the failure log and each check's record, once for a commit. Keeping it never gets in a read's way. */
export function recordGithubRead(result, { nowText = new Date().toISOString(), treeIdOf = commitTreeId, directory } = {}) {
  if (result.state === "pending") return;
  try {
    const options = directory ? { directory } : {};
    const treeId = treeIdOf(result.commit_sha);
    appendGithubRead({ read_at: nowText, commit_sha: result.commit_sha, tree_id: treeId, github_state: result.state }, options);
    const logged = readFailures(options);
    for (const line of result.failed_jobs.flatMap(githubFailureLines)) {
      const isLogged = logged.some((failure) => failure.source === "github" && failure.commit_sha === result.commit_sha && failure.job_name === line.job_name && failure.check_name === line.check_name && failure.detail === line.detail);
      if (!isLogged) appendFailure({ logged_at: nowText, source: "github", commit_sha: result.commit_sha, tree_id: treeId, ...line }, options);
    }
  } catch {}
}

/** The commit's tree, or null when this checkout hasn't got it. */
function commitTreeId(commitSha) {
  const answer = spawnSync("git", ["rev-parse", `${commitSha}^{tree}`], { cwd: ROOT, encoding: "utf8" });
  return answer.status === 0 ? answer.stdout.trim() : null;
}

/** What the files here are, so two runs on the same files match: HEAD's tree, and a hash of what's changed on top of it. */
function workingTreeId() {
  const tree = commitTreeId("HEAD");
  const changes = spawnSync("sh", ["-c", "git diff HEAD; git ls-files --others --exclude-standard"], { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).stdout ?? "";
  return changes ? `${tree}+${createHash("sha256").update(changes).digest("hex").slice(0, 16)}` : tree;
}

function firstLines(text) {
  return text.split("\n").slice(0, ERROR_LINE_COUNT).join("\n");
}

/** The process groups of what a local run started, for its budget to measure and to stop. Each command is a group of its own, with everything under it. */
const runningGroups = new Set();
let budgetWatch = null;
let isRunStopped = false;

function run(command, args, env = {}) {
  return new Promise((resolve) => {
    if (isRunStopped) return resolve({ status: 1, output: "", is_stopped: true });
    const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...env }, detached: true });
    runningGroups.add(child.pid);
    budgetWatch?.addProcessGroup(child.pid);
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (status) => {
      runningGroups.delete(child.pid);
      resolve({ status: status ?? 1, output, is_stopped: isRunStopped });
    });
  });
}

function signalGroups(signal) {
  for (const groupId of runningGroups) {
    try {
      process.kill(-groupId, signal);
    } catch {}
  }
}

/** Stops everything the run started, and nothing more starts: asks, then kills whatever hasn't ended. */
function stopRun() {
  isRunStopped = true;
  signalGroups("SIGTERM");
  setTimeout(() => signalGroups("SIGKILL"), STOP_GRACE_MS).unref();
}

async function runVitest(testFiles, env = {}) {
  const folder = mkdtempSync(join(tmpdir(), "zaisma-check-"));
  const reportPath = join(folder, "report.json");
  try {
    const { status, output, is_stopped: isStopped } = await run("npx", ["vitest", "run", "--reporter=json", `--outputFile=${reportPath}`, ...testFiles], env);
    let report = null;
    try {
      report = JSON.parse(readFileSync(reportPath, "utf8"));
    } catch {}
    return { status, output, report, is_stopped: isStopped && !report };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** Whether this checkout's preview is awake: it has run, and its log doesn't end asleep (the test of scripts/preview/background.mjs). */
export function isPreviewAwake({ root = ROOT } = {}) {
  try {
    readFileSync(join(root, ".wrangler/preview-run/state.json"), "utf8");
    return !/Asleep at [^\n]*\n(?![\s\S]*Waking up at)/.test(readFileSync(join(root, ".wrangler/preview-run/preview.log"), "utf8"));
  } catch {
    return false;
  }
}

function layoutPagePaths() {
  const source = readFileSync(join(ROOT, "apps/site/src/components/checked-pages.ts"), "utf8");
  return [...source.matchAll(/\bpath:\s*"([^"]+)"/g)].map(([, path]) => path);
}

async function checkLayout(changedPaths, affected, notes, checks) {
  if (!affected.is_layout_check_reached) return [];
  if (!isPreviewAwake()) {
    notes.push("The change reaches the Layout check, but this checkout's preview isn't awake: npm run preview:start, then npm run layout:check -- --only <path>.");
    return [];
  }
  const pagePaths = pagesForChangedFiles(changedPaths, layoutPagePaths(), (path) => { try { return readFileSync(join(ROOT, path), "utf8"); } catch { return ""; } });
  if (!pagePaths.length) {
    notes.push(`The change reaches the Layout check (${affected.layout_check_reached_by}) but names no page: npm run layout:check -- --only <path> for the pages you changed.`);
    return [];
  }
  const failures = [];
  for (const pagePath of pagePaths) {
    const startMs = Date.now();
    const { output, is_stopped: isStopped } = await run(process.execPath, [join(ROOT, "scripts/layout-check.mjs"), "--only", pagePath, "--json"]);
    if (isStopped) break;
    const failureCount = failures.length;
    try {
      const report = JSON.parse(output.slice(output.indexOf("{")));
      if (report.error) failures.push(`${pagePath}: ${report.message}`);
      for (const failure of report.failures ?? []) failures.push(`${failure.page} ${failure.size} ${failure.theme}: ${failure.check}: ${failure.element}: ${failure.said}`);
    } catch {
      failures.push(`${pagePath}: the Layout check printed nothing readable: ${firstLines(output)}`);
    }
    checks.push({ check_name: `layout ${pagePath}`, duration_sec: Math.round((Date.now() - startMs) / 100) / 10, check_status: failures.length > failureCount ? "failed" : "passed" });
  }
  return failures;
}

/** Runs a command as one check, recording what it took. */
async function timedCheck(checks, checkName, work) {
  const startMs = Date.now();
  const failures = await work();
  if (!isRunStopped) checks.push({ check_name: checkName, duration_sec: Math.round((Date.now() - startMs) / 100) / 10, check_status: failures.length ? "failed" : "passed" });
  return failures;
}

/** The extra test files, a batch at a time, while they fit and the Mac has room. Answers their failures, the checks they ran, and which it left, with a note on why it stopped. */
async function runExtraFiles(rankedFiles, { checks, notes, estimates }) {
  const failures = [];
  const ranFiles = [];
  let remaining = rankedFiles;
  while (remaining.length && !isRunStopped) {
    const numbers = budgetWatch.numbers();
    const batch = nextExtraBatch(remaining, { remainingSec: EXTRA_FILES_UNTIL_SEC - numbers.duration_sec, ...estimates });
    if (!batch.length) break;
    if (isRunWaiting()) {
      notes.push("Another local check is waiting, so this one left off its extra test files.");
      break;
    }
    const reason = busyReason(readMachineState({ processGroupIds: [...runningGroups] }));
    if (reason) {
      notes.push(`The extra test files stopped here: ${reason}.`);
      break;
    }
    const answer = await runVitest(batch, { TEST_WORKER_COUNT: String(LOCAL_WORKER_COUNT) });
    if (answer.is_stopped) break;
    if (!answer.report && answer.output.includes(NO_ROOM_FOR_TESTS)) {
      notes.push("The extra test files stopped here: no room left in the memory cap.");
      break;
    }
    if (!answer.report) failures.push({ file: "vitest", test_name: null, error: firstLines(answer.output) });
    else {
      failures.push(...parseVitestReport(answer.report));
      checks.push(...testFileChecks(answer.report));
    }
    ranFiles.push(...batch);
    remaining = remaining.filter((path) => !batch.includes(path));
  }
  return { failures, ranFiles };
}

/** The budget's verdict on a finished run. The CPU's average counts only once a run has gone long enough for one to mean anything. */
function verdictOn(numbers, hardLimitsSeen) {
  const verdict = budgetVerdict({ ...numbers, cpu_average_core_count: numbers.duration_sec >= CPU_AVERAGE_FROM_SEC ? numbers.cpu_average_core_count : null });
  const seen = new Set(verdict.hard_limits.map((limit) => limit.metric_name));
  return { ...numbers, warnings: verdict.warnings.filter((warning) => !hardLimitsSeen.some((limit) => limit.metric_name === warning.metric_name)), hard_limits: [...verdict.hard_limits, ...hardLimitsSeen.filter((limit) => !seen.has(limit.metric_name))] };
}

/** Writes a run's numbers and failures down and files its tasks. Keeping records never fails a run. */
function recordRun(result, { startedAt, earlierRuns, checks, waitDurationSec }) {
  try {
    const nowText = new Date().toISOString();
    const commitSha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
    const treeId = workingTreeId();
    const run = {
      started_at: startedAt,
      finished_at: nowText,
      base: result.base,
      commit_sha: commitSha,
      tree_id: treeId,
      outcome: result.outcome,
      wait_duration_sec: Math.round(waitDurationSec),
      is_budget_measured: Boolean(result.budget),
      has_workers_tests: checks.some((check) => EXTRA_TEST_FILE.test(check.check_name)),
      ...(result.budget ?? {}),
      ran_test_file_count: checks.filter((check) => check.check_name.startsWith("test/")).length,
      left_to_github_count: result.left_to_github.length,
      checks,
    };
    appendRun(run);
    for (const line of failureLines(result)) appendFailure({ logged_at: nowText, source: "local", commit_sha: commitSha, tree_id: treeId, ...line });
    const filedTasks = result.budget ? fileTasks(optimizationReasons(run, earlierRuns), { nowText, commitSha }) : [];
    return { filed_task_count: filedTasks.length, open_task_count: readTasks().filter((task) => task.task_status === "open").length };
  } catch (error) {
    return { filed_task_count: 0, open_task_count: 0, record_error: error.message };
  }
}

export async function check({ base = "origin/main", say = () => {} } = {}) {
  const changedPaths = changedPathsSince(base);
  const affected = affectedChecks({ changedPaths });
  const notes = [];
  const testFiles = affected.test_files.map((test) => test.path);
  const emptyResult = { base, changed_path_count: changedPaths.length, test_file_count: testFiles.length, test_failures: [], typecheck_failures: [], pattern_failures: [], layout_failures: [], left_to_github_for_memory: [], notes };
  const startedAt = new Date().toISOString();
  const earlierRuns = readRuns();
  const turn = await waitForRunTurn({ say });
  if (!turn.is_turn_taken) {
    const result = { ...emptyResult, left_to_github: testFiles, outcome: "handed_to_github", busy_reason: turn.busy_reason, is_pass: false };
    return { ...result, ...recordRun(result, { startedAt, earlierRuns, checks: [], waitDurationSec: turn.wait_duration_sec }) };
  }
  let hardLimitsSeen = [];
  budgetWatch = startBudgetWatch({
    onHardLimit: (limits) => {
      hardLimitsSeen = limits;
      stopRun();
    },
  });
  try {
    const checks = [];
    const split = splitTestFiles(testFiles, changedPaths, { isWorkersRunGoing: isWorkersRunGoing() });
    // One after another: tsc holds about 1 GB, and beside the tests it took the run past the memory warning (2.6 GB, measured Nov 4, 2026).
    const typecheckFailures = await timedCheck(checks, "typecheck", () =>
      run("npx", ["tsc", "--noEmit"]).then(({ status, output, is_stopped: isStopped }) => {
        if (isStopped) return [];
        const failures = parseTypecheck(output);
        return status !== 0 && !failures.length ? [{ file: "tsc", line: 0, message: firstLines(output) }] : failures;
      }),
    );
    // What the change adds to where it left the base, as GitHub's check asks.
    const patternFailures = await timedCheck(checks, "patterns", () =>
      run("git", ["merge-base", base, "HEAD"])
        .then(({ output }) => run("node", ["scripts/pattern-rules.mjs", "--compare", output.trim()]))
        .then(({ status, output, is_stopped: isStopped }) => (status === 0 || isStopped ? [] : output.trim().split("\n"))),
    );
    const tests = await runTestsThatFit({ here: split.here, testFiles, normallyHere: splitTestFiles(testFiles, changedPaths).here, runVitest });
    checks.push(...testFileChecks(tests.report));
    const layoutFailures = await checkLayout(changedPaths, affected, notes, checks);
    const records = checkRecords({ runs: earlierRuns, failures: readFailures(), githubReads: readGithubReads() });
    const estimates = { localDurationsSec: localDurationsSecByCheck(earlierRuns), githubDurationsMs: JSON.parse(readFileSync(join(ROOT, "test/shard-weights.json"), "utf8")) };
    const ranked = rankExtraFiles(split.extras, changedPaths, { catchCountByFile: new Map(records.map((record) => [record.check_name, record.catch_count])), ...estimates });
    const extras = tests.leftForMemory.length ? { failures: [], ranFiles: [] } : await runExtraFiles(ranked, { checks, notes, estimates });
    if (affected.is_every_test_reached) notes.push(`${affected.every_test_reached_by.join(", ")} changed, which every test runs on: GitHub's check runs all ${affected.test_file_count}.`);
    const budget = verdictOn(budgetWatch.stop(), hardLimitsSeen);
    const testFailures = [...tests.failures, ...extras.failures];
    const hasFailure = testFailures.length || typecheckFailures.length || patternFailures.length || layoutFailures.length;
    const isOverBudget = budget.hard_limits.length > 0;
    const result = {
      ...emptyResult,
      test_failures: testFailures,
      typecheck_failures: typecheckFailures,
      pattern_failures: patternFailures,
      layout_failures: layoutFailures,
      left_to_github: tests.leftToGithub.filter((path) => !extras.ranFiles.includes(path)),
      left_to_github_for_memory: tests.leftForMemory,
      budget,
      outcome: isOverBudget ? "over_budget" : hasFailure ? "fail" : "pass",
      is_pass: !hasFailure && !isOverBudget,
    };
    return { ...result, ...recordRun(result, { startedAt, earlierRuns, checks, waitDurationSec: turn.wait_duration_sec }) };
  } finally {
    budgetWatch.stop();
    budgetWatch = null;
    releaseRunTurn();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isJson = args.includes("--json");
  const valueOptions = ["--base", "--pr", "--commit"];
  const unknown = args.filter((arg, i) => !["--json", ...valueOptions].includes(arg) && !valueOptions.includes(args[i - 1]));
  if (unknown.length) return refuse(isJson, "unknown_option", `Unknown option ${unknown.join(" ")}.`, "The options are --json, --base <ref>, --pr <number> and --commit <sha>.");
  if (args.includes("--pr") || args.includes("--commit")) return mainGithub(args, isJson);
  const base = args.includes("--base") ? args[args.indexOf("--base") + 1] : undefined;
  if (args.includes("--base") && !base) return refuse(isJson, "missing_base", "--base needs a commit.", "Pass --base origin/main, or leave it out.");
  runAtLowPriority();
  // What the run started is in process groups of its own, so a Ctrl-C reaches only this process: it stops them too.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      signalGroups("SIGTERM");
      releaseRunTurn();
      process.exit(1);
    });
  }
  let result;
  try {
    result = await check({ base, say: (line) => !isJson && console.log(line) });
  } catch (error) {
    return refuse(isJson, "no_base_commit", error.message.split("\n")[0], `git fetch origin brings origin/main up to date, or pass --base <ref>.`);
  }
  console.log(isJson ? JSON.stringify(result, null, 2) : formatResult(result));
  process.exit(EXIT_STATUS_BY_OUTCOME[result.outcome]);
}

async function mainGithub(args, isJson) {
  const pullRequestText = args.includes("--pr") ? args[args.indexOf("--pr") + 1] : null;
  const commitSha = args.includes("--commit") ? args[args.indexOf("--commit") + 1] : null;
  if (args.includes("--pr") && args.includes("--commit")) return refuse(isJson, "pr_and_commit", "--pr and --commit both name a commit.", "Pass one: --pr <number> reads the pull request's latest commit.");
  if (args.includes("--base")) return refuse(isJson, "base_with_github", "--base is for the local run; --pr and --commit read GitHub's check.", "Leave --base out.");
  if (args.includes("--pr") && !/^\d+$/.test(pullRequestText ?? "")) return refuse(isJson, "bad_pull_request_number", `--pr needs a pull request's number, not ${pullRequestText ?? "nothing"}.`, "Pass --pr 104; gh pr list shows the open ones.");
  if (args.includes("--commit") && !/^[0-9a-f]{7,40}$/.test(commitSha ?? "")) return refuse(isJson, "bad_commit_sha", `--commit needs a commit's sha, not ${commitSha ?? "nothing"}.`, "Pass --commit with git rev-parse HEAD's answer, pushed to GitHub.");
  let result;
  try {
    result = await githubCheck({ pullRequestNumber: pullRequestText ? Number(pullRequestText) : null, commitSha });
  } catch (error) {
    const said = String(error.stderr || error.message).trim().split("\n")[0];
    return refuse(isJson, "github_unreachable", `gh couldn't read the check: ${said}`, "Check gh auth status, and that the pull request or commit is on zaisma/zaisma.");
  }
  console.log(isJson ? JSON.stringify(result, null, 2) : formatGithubResult(result));
  process.exit({ pass: 0, fail: 1, pending: 3 }[result.state]);
}

function refuse(isJson, code, message, fix) {
  console.log(isJson ? JSON.stringify({ error: { code, message, fix } }) : `FAIL ${code}: ${message} ${fix}`);
  process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
