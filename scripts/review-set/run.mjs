#!/usr/bin/env node
// Runs the AI review on the review test set: every sample game, several times, and says what it caught, which honest
// games it held and which got different verdicts on different runs. review-set/README.md says how to use it.
//   npm run review-set                          the whole set, 3 runs per case; a full run records review-set/last-run.json
//   npm run review-set -- --runs 5              more runs per case (1 to 10)
//   npm run review-set -- --case <name>         only these cases (repeat --case); records nothing
//   npm run review-set -- --var REVIEW_JUDGE_MODEL=<id>   try another model; records nothing
//   npm run review-set -- --json                the summary and results as JSON
// Public cases are in review-set/cases/, private ones in $ZAISMA_REVIEW_SET_PRIVATE_DIR/cases/ (by default
// ~/zaisma-private/security/review-set, the private zaisma/security repo). The API key comes from ANTHROPIC_API_KEY,
// else apps/site/.dev.vars in this checkout or the main one. It's never printed.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { reviewFingerprint, reviewModelVars } from "./fingerprint.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const PUBLIC_DIRECTORY = join(ROOT, "review-set");
const PRIVATE_DIRECTORY = process.env.ZAISMA_REVIEW_SET_PRIVATE_DIR || join(homedir(), "zaisma-private/security/review-set");
const PARALLEL_CASE_COUNT = 4;
const MINIMUM_RECORDED_RUN_COUNT = 3;

function stop(message) {
  console.error(message);
  process.exit(1);
}

// Options.
let runCount = 3;
const caseNames = [];
const varOverrides = {};
let isJson = false;
for (let index = 2; index < process.argv.length; index++) {
  const argument = process.argv[index];
  if (argument === "--runs") {
    runCount = Number(process.argv[++index]);
    if (!Number.isInteger(runCount) || runCount < 1 || runCount > 10) stop("--runs takes a whole number from 1 to 10.");
  } else if (argument === "--case") {
    const name = process.argv[++index];
    if (!name) stop("--case takes a case's folder name.");
    caseNames.push(name);
  } else if (argument === "--var") {
    const match = /^([A-Z_]+)=(.+)$/.exec(process.argv[++index] ?? "");
    if (!match) stop("--var takes NAME=value, like --var REVIEW_JUDGE_MODEL=claude-opus-5-5.");
    varOverrides[match[1]] = match[2];
  } else if (argument === "--json") isJson = true;
  else stop(`Unknown option ${argument}. The options are --runs <count>, --case <name>, --var NAME=value and --json.`);
}

// The review's code, bundled for Node (Node can't strip packages/core's TypeScript by itself).
const bundleDirectory = mkdtempSync(join(tmpdir(), "zaisma-review-set-"));
const bundlePath = join(bundleDirectory, "review-set.mjs");
await build({ entryPoints: [join(ROOT, "apps/site/src/review-set.ts")], bundle: true, platform: "node", format: "esm", outfile: bundlePath, logLevel: "error" });
const review = await import(pathToFileURL(bundlePath).href);
rmSync(bundleDirectory, { recursive: true, force: true });

// The cases.
function filesUnder(directory) {
  const files = [];
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push({ path: relative(directory, full).split("\\").join("/"), bytes: new Uint8Array(readFileSync(full)) });
    }
  };
  walk(directory);
  return files;
}

function loadCases(directory, isPrivate) {
  const casesDirectory = join(directory, "cases");
  if (!existsSync(casesDirectory)) return [];
  const cases = [];
  for (const name of readdirSync(casesDirectory).sort()) {
    const folder = join(casesDirectory, name);
    if (!statSync(folder).isDirectory()) continue;
    const gameDirectory = join(folder, "game");
    const files = existsSync(gameDirectory) ? filesUnder(gameDirectory) : [];
    let caseFile;
    try {
      caseFile = JSON.parse(readFileSync(join(folder, "case.json"), "utf8"));
    } catch (error) {
      stop(`${name}: case.json can't be read (${error.message}).`);
    }
    const problems = review.checkCase(caseFile, files.map((file) => file.path));
    if (problems.length) stop(`${name}:\n  ${problems.join("\n  ")}`);
    cases.push({ name, ...caseFile, is_private: isPrivate, files });
  }
  return cases;
}

const hasPrivateCases = existsSync(join(PRIVATE_DIRECTORY, "cases"));
if (!hasPrivateCases && !isJson) console.error(`No private cases at ${PRIVATE_DIRECTORY}/cases: running the public ones. Clone them with: gh repo clone zaisma/security ~/zaisma-private/security`);
let cases = [...loadCases(PUBLIC_DIRECTORY, false), ...loadCases(PRIVATE_DIRECTORY, true)];
if (caseNames.length) {
  const unknown = caseNames.filter((name) => !cases.some((gameCase) => gameCase.name === name));
  if (unknown.length) stop(`No case named ${unknown.join(", ")}.`);
  cases = cases.filter((gameCase) => caseNames.includes(gameCase.name));
}

// The API key and models.
function devVarsKey(checkout) {
  const path = join(checkout, "apps/site/.dev.vars");
  if (!existsSync(path)) return "";
  const line = readFileSync(path, "utf8").split("\n").find((candidate) => candidate.startsWith("ANTHROPIC_API_KEY="));
  return line ? line.slice("ANTHROPIC_API_KEY=".length).trim().replace(/^["']|["']$/g, "") : "";
}
function mainCheckout() {
  try {
    return /^worktree (.+)$/m.exec(execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: ROOT, encoding: "utf8" }))?.[1] ?? "";
  } catch {
    return "";
  }
}
const apiKey = process.env.ANTHROPIC_API_KEY || devVarsKey(ROOT) || (mainCheckout() && devVarsKey(mainCheckout()));
if (!apiKey) stop("No ANTHROPIC_API_KEY: set it in the environment or apps/site/.dev.vars.");
const modelVars = { ...reviewModelVars(ROOT), ...varOverrides };

// Run: a few cases at a time, each case's runs one after another.
async function runCase(gameCase) {
  const runs = [];
  for (let run = 0; run < runCount; run++) {
    try {
      runs.push(await review.reviewCase({ ANTHROPIC_API_KEY: apiKey, ...modelVars }, gameCase));
    } catch (error) {
      if (!isJson) console.error(`${gameCase.name}: run ${run + 1} failed (${error.message}), counted as held like the scan would.`);
      runs.push({ decision: "held", finding_codes: ["ai_review_failed"], is_child_safety: false, declined_attempt_count: 0, is_judge_declined: false, cost_cents: 0, input_token_count: 0, output_token_count: 0 });
    }
  }
  return review.caseResult(gameCase, runs);
}
const results = [];
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(PARALLEL_CASE_COUNT, cases.length) }, async () => {
    while (next < cases.length) {
      const gameCase = cases[next++];
      results.push(await runCase(gameCase));
    }
  }),
);
results.sort((first, second) => (first.name < second.name ? -1 : 1));
const summary = review.summarizeRun(results);

// Record a full run.
const isFullRun = !caseNames.length && !Object.keys(varOverrides).length && runCount >= MINIMUM_RECORDED_RUN_COUNT;
if (isFullRun) {
  const record = (resultsToRecord) => ({
    fingerprint_sha256: reviewFingerprint(ROOT),
    ran_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    model_vars: modelVars,
    run_count: runCount,
    summary,
    cases: resultsToRecord.map(({ is_private, cost_cents, input_token_count, output_token_count, ...result }) => result),
  });
  writeFileSync(join(PUBLIC_DIRECTORY, "last-run.json"), `${JSON.stringify(record(results.filter((result) => !result.is_private)), null, 2)}\n`);
  if (hasPrivateCases) writeFileSync(join(PRIVATE_DIRECTORY, "last-run.json"), `${JSON.stringify(record(results.filter((result) => result.is_private)), null, 2)}\n`);
}

if (isJson) {
  console.log(JSON.stringify({ summary, is_recorded: isFullRun, results }, null, 2));
} else {
  for (const result of results) {
    if (result.outcome === "held_bad" || result.outcome === "passed_honest") continue;
    console.log(`${result.name}${result.is_private ? " (private)" : ""}: ${result.outcome}, decisions ${result.decisions.join(" ")}${result.finding_codes.length ? `, codes ${result.finding_codes.join(" ")}` : ""}`);
  }
  for (const result of results) {
    if (!result.declined_attempt_count) continue;
    console.log(`${result.name}${result.is_private ? " (private)" : ""}: the judge declined ${result.declined_attempt_count} tries over ${result.decisions.length} runs; ${result.declined_run_count} of the runs declined every try and were held for a person.`);
  }
  console.log(
    `Bad games held: ${summary.held_bad_case_count} of ${summary.bad_case_count}. Honest games passed: ${summary.passed_honest_case_count} of ${summary.honest_case_count}. ` +
      `Inconsistent: ${summary.inconsistent_case_count}. Private cases: ${summary.private_case_count}. Tokens: ${summary.input_token_count} in, ${summary.output_token_count} out. ` +
      `Cost: $${(summary.cost_cents / 100).toFixed(2)}, ${(summary.cost_cents / Math.max(1, cases.length * runCount)).toFixed(2)}¢ per judged review. ` +
      `Judge declined: ${summary.declined_attempt_count} tries, ${summary.declined_review_count} of ${cases.length * runCount} reviews every try. ` +
      `${runCount} run${runCount === 1 ? "" : "s"} per case with ${Object.entries(modelVars).map(([name, value]) => `${name}=${value}`).join(", ")}.`,
  );
  console.log(isFullRun ? `Recorded in review-set/last-run.json${hasPrivateCases ? " and the private last-run.json" : ""}.` : "Not recorded: only a full run (every case, the configured models, at least 3 runs) is.");
  console.log(summary.is_passing ? "PASS" : "FAIL");
}
process.exit(summary.is_passing ? 0 : 1);
