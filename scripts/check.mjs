#!/usr/bin/env node
// One command for a change's checks: the tests it can reach and the typecheck side by side, and the Layout check for the pages
// it changed when this checkout's preview is awake. It prints PASS, or FAIL with, for each failure, the test file, the test's
// name and the first lines of its error, and each typecheck error as file:line: message. Never the full output.
//
//   npm run check                    runs the tests this checkout's change can reach (scripts/affected-tests.mjs), the typecheck,
//                                    and the Layout check for the changed pages when the preview is awake
//   npm run check -- --json          the same, as JSON; a refusal is {"error": {"code", "message", "fix"}}
//   npm run check -- --base <ref>    changes since that commit instead of since origin/main
//
// While a preview is awake on this machine, the Workers tests can't fit beside it (scripts/preview/memory.mjs): this runs the Node
// tests and lists the rest as left_to_github, which GitHub's check runs. Last line: PASS or FAIL.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, affectedChecks, changedPathsSince } from "./affected-tests.mjs";

export const ERROR_LINE_COUNT = 15;
const WORKERS_TESTS_WHILE_PREVIEW_AWAKE = "workers_tests_while_preview_awake";

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

/** The layout-check pages (their paths) that changed files name: apps/site/src/browse.ts is the page /browse. Only where the file's name is a page's path. */
export function pagesForChangedFiles(changedPaths, pagePaths) {
  const names = changedPaths.filter((path) => /^apps\/site\/src\/.+\.ts$/.test(path)).map((path) => path.replace(/^.*\//, "").replace(/\.ts$/, ""));
  return [...new Set(pagePaths.filter((pagePath) => pagePath !== "/" && names.some((name) => pagePath.split("/").includes(name))))];
}

/** The text a run prints: PASS or FAIL with each failure, ending on that word. */
export function formatResult(result) {
  const lines = [];
  for (const failure of result.test_failures) lines.push(`TEST ${failure.file}${failure.test_name ? ` > ${failure.test_name}` : ""}`, ...failure.error.split("\n").map((text) => `  ${text}`));
  for (const failure of result.typecheck_failures) lines.push(`TYPE ${failure.file}:${failure.line}: ${failure.message}`);
  for (const failure of result.layout_failures) lines.push(`LAYOUT ${failure}`);
  if (result.left_to_github.length) lines.push(`Left to GitHub's check (a preview is awake): ${result.left_to_github.length} Workers test file(s).`);
  for (const note of result.notes) lines.push(note);
  lines.push(result.is_pass ? "PASS" : "FAIL");
  return lines.join("\n");
}

function firstLines(text) {
  return text.split("\n").slice(0, ERROR_LINE_COUNT).join("\n");
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: ROOT, env: process.env });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (status) => resolve({ status: status ?? 1, output }));
  });
}

async function runVitest(testFiles) {
  const folder = mkdtempSync(join(tmpdir(), "zaisma-check-"));
  const reportPath = join(folder, "report.json");
  try {
    const { status, output } = await run("npx", ["vitest", "run", "--reporter=json", `--outputFile=${reportPath}`, ...testFiles]);
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
  const pagePaths = pagesForChangedFiles(changedPaths, layoutPagePaths());
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
  const testsRun = (async () => {
    if (!testFiles.length) return { failures: [], leftToGithub: [] };
    let run = await runVitest(testFiles);
    let leftToGithub = [];
    if (run.output.includes(WORKERS_TESTS_WHILE_PREVIEW_AWAKE)) {
      leftToGithub = testFiles.filter((path) => !path.startsWith("test/node/"));
      run = await runVitest(testFiles.filter((path) => path.startsWith("test/node/")));
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
  const unknown = args.filter((arg, i) => !["--json", "--base"].includes(arg) && args[i - 1] !== "--base");
  if (unknown.length) return refuse(isJson, "unknown_option", `Unknown option ${unknown.join(" ")}.`, "The options are --json and --base <ref>.");
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

function refuse(isJson, code, message, fix) {
  console.log(isJson ? JSON.stringify({ error: { code, message, fix } }) : `FAIL ${code}: ${message} ${fix}`);
  process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
