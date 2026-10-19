#!/usr/bin/env node
// Runs the listing check ("No slop") on its cases in review-set/listing-cases/: every case several times, and says which
// got their outcome, which didn't and which got different outcomes on different runs. review-set/README.md says how.
//   npm run listing-set                       every case, 3 runs each; a full run records review-set/listing-last-run.json
//   npm run listing-set -- --runs 5           more runs per case (1 to 10)
//   npm run listing-set -- --case <name>      only these cases (repeat --case); records nothing
//   npm run listing-set -- --var LISTING_CHECK_MODEL=<id>   try another model; records nothing
//   npm run listing-set -- --json             the summary and results as JSON
// The API key comes from ANTHROPIC_API_KEY, else apps/site/.dev.vars in this checkout or the main one. It's never printed.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { listingFingerprint, listingModelVars } from "./fingerprint.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const CASES_DIRECTORY = join(ROOT, "review-set/listing-cases");
const PARALLEL_CASE_COUNT = 4;
const MINIMUM_RECORDED_RUN_COUNT = 3;

function stop(message) {
  console.error(message);
  process.exit(1);
}

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
    if (!match) stop("--var takes NAME=value, like --var LISTING_CHECK_MODEL=claude-opus-5-5.");
    varOverrides[match[1]] = match[2];
  } else if (argument === "--json") isJson = true;
  else stop(`Unknown option ${argument}. The options are --runs <count>, --case <name>, --var NAME=value and --json.`);
}

// The check's code, bundled for Node.
const bundleDirectory = mkdtempSync(join(tmpdir(), "zaisma-listing-set-"));
const bundlePath = join(bundleDirectory, "listing-set.mjs");
await build({ entryPoints: [join(ROOT, "apps/site/src/listing-set.ts")], bundle: true, platform: "node", format: "esm", outfile: bundlePath, logLevel: "error" });
const listing = await import(pathToFileURL(bundlePath).href);
rmSync(bundleDirectory, { recursive: true, force: true });

// The cases.
let cases = [];
for (const name of readdirSync(CASES_DIRECTORY).sort()) {
  const folder = join(CASES_DIRECTORY, name);
  if (!statSync(folder).isDirectory()) continue;
  const paths = readdirSync(folder).filter((file) => file !== "case.json");
  let caseFile;
  try {
    caseFile = JSON.parse(readFileSync(join(folder, "case.json"), "utf8"));
  } catch (error) {
    stop(`${name}: case.json can't be read (${error.message}).`);
  }
  const problems = listing.checkListingCase(caseFile, paths);
  if (problems.length) stop(`${name}:\n  ${problems.join("\n  ")}`);
  cases.push({ name, ...caseFile, files: paths.map((path) => ({ path, bytes: new Uint8Array(readFileSync(join(folder, path))) })) });
}
if (caseNames.length) {
  const unknown = caseNames.filter((name) => !cases.some((listingCase) => listingCase.name === name));
  if (unknown.length) stop(`No case named ${unknown.join(", ")}.`);
  cases = cases.filter((listingCase) => caseNames.includes(listingCase.name));
}

// The API key and model.
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
const modelVars = { ...listingModelVars(ROOT), ...varOverrides };

async function runCase(listingCase) {
  const runs = [];
  for (let run = 0; run < runCount; run++) {
    try {
      runs.push(await listing.runListingCase({ ANTHROPIC_API_KEY: apiKey, ...modelVars }, listingCase));
    } catch (error) {
      if (!isJson) console.error(`${listingCase.name}: run ${run + 1} failed (${error.message}), counted as waiting for a person like the check would.`);
      runs.push({ items: Object.fromEntries(Object.keys(listingCase.expected).map((item) => [item, "person"])), declined_attempt_count: 0, cost_cents: 0 });
    }
  }
  return listing.listingCaseResult(listingCase, runs);
}
const results = [];
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(PARALLEL_CASE_COUNT, cases.length) }, async () => {
    while (next < cases.length) results.push(await runCase(cases[next++]));
  }),
);
results.sort((first, second) => (first.name < second.name ? -1 : 1));
const summary = listing.summarizeListingRun(results);

const isFullRun = !caseNames.length && !Object.keys(varOverrides).length && runCount >= MINIMUM_RECORDED_RUN_COUNT;
if (isFullRun) {
  const record = {
    fingerprint_sha256: listingFingerprint(ROOT),
    ran_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    model_vars: modelVars,
    run_count: runCount,
    summary,
    cases: results.map(({ cost_cents, ...result }) => result),
  };
  writeFileSync(join(ROOT, "review-set/listing-last-run.json"), `${JSON.stringify(record, null, 2)}\n`);
}

if (isJson) console.log(JSON.stringify({ summary, is_recorded: isFullRun, results }, null, 2));
else {
  for (const result of results.filter((each) => each.outcome !== "matched")) {
    console.log(`${result.name}: ${result.outcome}. Expected ${JSON.stringify(result.expected)}; got ${result.runs.map((run) => JSON.stringify(run)).join(" / ")}`);
  }
  console.log(
    `Matched: ${summary.matched_case_count} of ${summary.case_count} (${summary.honest_case_count} honest, ${summary.slop_case_count} slop). Missed: ${summary.missed_case_count}. Inconsistent: ${summary.inconsistent_case_count}. ` +
      `Declined tries: ${summary.declined_attempt_count}. Cost: $${(summary.cost_cents / 100).toFixed(2)}, ${(summary.cost_cents / Math.max(1, cases.length * runCount)).toFixed(2)}¢ per check. ` +
      `${runCount} run${runCount === 1 ? "" : "s"} per case with ${Object.entries(modelVars).map(([name, value]) => `${name}=${value}`).join(", ")}.`,
  );
  console.log(isFullRun ? "Recorded in review-set/listing-last-run.json." : "Not recorded: only a full run (every case, the configured model, at least 3 runs) is.");
  console.log(summary.is_passing ? "PASS" : "FAIL");
}
process.exit(summary.is_passing ? 0 : 1);
