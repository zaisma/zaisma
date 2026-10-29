#!/usr/bin/env node
// One command for a change's checks on this machine: the typecheck, the Node tests the change can reach and the change's own new or
// changed Workers test files side by side, and the Layout check for the pages it changed when this checkout's preview is awake.
// Every other Workers test file the change reaches is left to GitHub's check on the pull request (Julius, Oct 26, 2026: tests stay
// off his Mac), and so are its own when another Workers test run is already going on this machine (one at a time,
// scripts/preview/memory.mjs). It prints PASS, or FAIL with, for each failure, the test file, the test's
// name and the first lines of its error, and each typecheck error as file:line: message. Never the full output.
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
// While a preview is awake on this machine, the Workers tests can't fit beside it (scripts/preview/memory.mjs): this runs the Node
// tests and lists its own Workers files as left_to_github too. Last line: PASS or FAIL (or PENDING, for --pr and --commit).
// Exit status: 0 PASS, 1 FAIL, 2 a refusal, 3 PENDING.
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { ROOT, affectedChecks, changedPathsSince } from "./affected-tests.mjs";
import { LINE_DIRECTORY, isAlive, readLine } from "./preview/memory.mjs";
import { GITHUB_CHECK_NAME } from "./ship-github-check.mjs";

export const ERROR_LINE_COUNT = 15;
const WORKERS_TESTS_WHILE_PREVIEW_AWAKE = "workers_tests_while_preview_awake";
const GITHUB_REPOSITORY = "zaisma/zaisma";
const FAILED_CONCLUSIONS = ["failure", "timed_out", "cancelled", "action_required", "startup_failure"];
// Test files that run on plain Node, light enough for this machine; every other project's run in the Workers runtime.
const NODE_TEST_FILE = /^test\/(node|layout|contracts)\//;
// Files at once for the change's own Workers test files here: each takes about 0.9 GB.
const OWN_WORKERS_WORKER_COUNT = 2;

/**
 * Which of the reached test files run here and which are left to GitHub's check: the Node ones and the change's own Workers test
 * files (ones it adds or changes) run here, unless another Workers test run is going on this machine; every other Workers file goes
 * to GitHub.
 */
export function splitTestFiles(testFiles, changedPaths, { isWorkersRunGoing = false } = {}) {
  const changed = new Set(changedPaths);
  // The Layout check's own tests measure every page: GitHub's, never a laptop's (the change's pages are measured here instead, below).
  const isWholeLayout = (path) => path.startsWith("test/layout/");
  const here = testFiles.filter((path) => !isWholeLayout(path) && (NODE_TEST_FILE.test(path) || (!isWorkersRunGoing && changed.has(path))));
  return { here, leftToGithub: testFiles.filter((path) => !here.includes(path)) };
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
    [...sourceOf(path).matchAll(/component\(\{[^}]*?group:\s*"([a-z-]+)"(?:,\s*subgroup:\s*"([a-z-]+)")?/g)].map(([, group, subgroup]) => (subgroup ? `/design/${group}/${subgroup}` : `/design/${group}`)));
  return [...new Set([...named, ...galleryPaths.filter((galleryPath) => pagePaths.includes(galleryPath))])];
}

/** The text a run prints: PASS or FAIL with each failure, ending on that word. */
export function formatResult(result) {
  const lines = [];
  for (const failure of result.test_failures) lines.push(`TEST ${failure.file}${failure.test_name ? ` > ${failure.test_name}` : ""}`, ...failure.error.split("\n").map((text) => `  ${text}`));
  for (const failure of result.typecheck_failures) lines.push(`TYPE ${failure.file}:${failure.line}: ${failure.message}`);
  for (const failure of result.layout_failures) lines.push(`LAYOUT ${failure}`);
  if (result.left_to_github.length) lines.push(`Left to GitHub's check: ${result.left_to_github.length} Workers test file(s). Push, and read npm run check -- --pr <number>.`);
  for (const note of result.notes) lines.push(note);
  lines.push(result.is_pass ? "PASS" : "FAIL");
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
  return { pull_request_number: pullRequestNumber, commit_sha: commitSha, state: judged.state, pending_job_names: judged.pending_job_names, failed_jobs: failedJobs };
}

function firstLines(text) {
  return text.split("\n").slice(0, ERROR_LINE_COUNT).join("\n");
}

function run(command, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...env } });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (status) => resolve({ status: status ?? 1, output }));
  });
}

async function runVitest(testFiles, env = {}) {
  const folder = mkdtempSync(join(tmpdir(), "zaisma-check-"));
  const reportPath = join(folder, "report.json");
  try {
    const { status, output } = await run("npx", ["vitest", "run", "--reporter=json", `--outputFile=${reportPath}`, ...testFiles], env);
    let report = null;
    try {
      report = JSON.parse(readFileSync(reportPath, "utf8"));
    } catch {}
    return { status, output, report };
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

async function checkLayout(changedPaths, affected, notes) {
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
    const { output } = await run(process.execPath, [join(ROOT, "scripts/layout-check.mjs"), "--only", pagePath, "--json"]);
    try {
      const report = JSON.parse(output.slice(output.indexOf("{")));
      if (report.error) failures.push(`${pagePath}: ${report.message}`);
      for (const failure of report.failures ?? []) failures.push(`${failure.page} ${failure.size} ${failure.theme}: ${failure.check}: ${failure.element}: ${failure.said}`);
    } catch {
      failures.push(`${pagePath}: the Layout check printed nothing readable: ${firstLines(output)}`);
    }
  }
  return failures;
}

export async function check({ base = "origin/main" } = {}) {
  const changedPaths = changedPathsSince(base);
  const affected = affectedChecks({ changedPaths });
  const notes = [];
  const testFiles = affected.test_files.map((test) => test.path);
  const split = splitTestFiles(testFiles, changedPaths, { isWorkersRunGoing: isWorkersRunGoing() });
  const testsRun = (async () => {
    if (!split.here.length) return { failures: [], leftToGithub: split.leftToGithub };
    const hasWorkersFiles = split.here.some((path) => !NODE_TEST_FILE.test(path));
    let run = await runVitest(split.here, hasWorkersFiles ? { TEST_WORKER_COUNT: String(OWN_WORKERS_WORKER_COUNT) } : {});
    let leftToGithub = split.leftToGithub;
    if (run.output.includes(WORKERS_TESTS_WHILE_PREVIEW_AWAKE)) {
      leftToGithub = testFiles.filter((path) => !NODE_TEST_FILE.test(path));
      run = await runVitest(testFiles.filter((path) => NODE_TEST_FILE.test(path)));
    }
    if (!run.report) return { failures: [{ file: "vitest", test_name: null, error: firstLines(run.output) }], leftToGithub };
    return { failures: parseVitestReport(run.report), leftToGithub };
  })();
  const typecheckRun = run("npx", ["tsc", "--noEmit"]).then(({ status, output }) => {
    const failures = parseTypecheck(output);
    return status !== 0 && !failures.length ? [{ file: "tsc", line: 0, message: firstLines(output) }] : failures;
  });
  const [tests, typecheckFailures] = await Promise.all([testsRun, typecheckRun]);
  const layoutFailures = await checkLayout(changedPaths, affected, notes);
  if (affected.is_every_test_reached) notes.push(`${affected.every_test_reached_by.join(", ")} changed, which every test runs on: GitHub's check runs all ${affected.test_file_count}.`);
  const result = {
    base,
    changed_path_count: changedPaths.length,
    test_file_count: testFiles.length,
    test_failures: tests.failures,
    typecheck_failures: typecheckFailures,
    layout_failures: layoutFailures,
    left_to_github: tests.leftToGithub,
    notes,
  };
  return { ...result, is_pass: !tests.failures.length && !typecheckFailures.length && !layoutFailures.length };
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
  let result;
  try {
    result = await check({ base });
  } catch (error) {
    return refuse(isJson, "no_base_commit", error.message.split("\n")[0], `git fetch origin brings origin/main up to date, or pass --base <ref>.`);
  }
  console.log(isJson ? JSON.stringify(result, null, 2) : formatResult(result));
  process.exit(result.is_pass ? 0 : 1);
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
