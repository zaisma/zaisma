#!/usr/bin/env node
// One runner's share of the tests in GitHub's check (.github/workflows/check.yml, "Tests" and "Reached tests"): every test, or only
// the files given, dealt out by test/shards.ts. In the merge queue a failed file runs once more, so one flake doesn't throw a whole
// batch out of the queue (Julius, Oct 26, 2026): still failing, the shard fails; passing on that run, the shard passes and names each
// such test in the job's summary and in flaky_tests.json ({ file, test_name, first_error }), which the merge desk files as a fix at
// its cause. A flake is never left retrying.
//
//   node scripts/test-shard.mjs --shard 1/4                        every test file's share for shard 1
//   node scripts/test-shard.mjs --shard 1/4 --files "a b"          only these files' share
//   node scripts/test-shard.mjs --shard 1/4 --rerun-failed-once    the merge queue's run
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./affected-tests.mjs";
import { parseVitestReport } from "./check.mjs";

export const FLAKY_TESTS_PATH = "flaky_tests.json";

/** The failures that passed when their files ran again: each failure of the first run whose file's second run passed. */
export function flakyTests(firstFailures, secondFailures) {
  const stillFailingFiles = new Set(secondFailures.map((failure) => failure.file));
  return firstFailures.filter((failure) => !stillFailingFiles.has(failure.file)).map((failure) => ({ file: failure.file, test_name: failure.test_name, first_error: failure.error }));
}

function runVitest(args) {
  const reportPath = join(mkdtempSync(join(tmpdir(), "zaisma-shard-")), "report.json");
  const result = spawnSync("npx", ["vitest", "run", "--passWithNoTests", "--reporter=default", "--reporter=json", `--outputFile.json=${reportPath}`, ...args], { cwd: ROOT, stdio: "inherit" });
  let failures = [];
  try {
    failures = parseVitestReport(JSON.parse(readFileSync(reportPath, "utf8")));
  } catch {}
  return { isPassed: result.status === 0, failures };
}

function main() {
  const args = process.argv.slice(2);
  const valueOf = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const shard = valueOf("--shard");
  if (!/^\d+\/\d+$/.test(shard ?? "")) {
    console.error("--shard needs <n>/<count>, like --shard 1/4.");
    process.exit(2);
  }
  const files = (valueOf("--files") ?? "").split(/\s+/).filter(Boolean);
  if (args.includes("--files") && !files.length) {
    console.log("No test file for this run: nothing to run.");
    return;
  }
  const first = runVitest([`--shard=${shard}`, ...files]);
  if (first.isPassed) return;
  const failedFiles = [...new Set(first.failures.map((failure) => failure.file))];
  if (!args.includes("--rerun-failed-once") || !failedFiles.length) process.exit(1);
  console.log(`\nRunning the ${failedFiles.length} failed file(s) once more, to tell a flake from a failure: ${failedFiles.join(" ")}`);
  const second = runVitest(failedFiles);
  if (!second.isPassed) process.exit(1);
  const flaky = flakyTests(first.failures, second.failures);
  writeFileSync(join(ROOT, FLAKY_TESTS_PATH), JSON.stringify(flaky, null, 2));
  const text = [`Flaky: ${flaky.length} test(s) failed, then passed when their files ran again. Each is fixed at its cause:`, ...flaky.map((test) => `- ${test.file}${test.test_name ? ` > ${test.test_name}` : ""}`)].join("\n");
  console.log(`\n${text}`);
  for (const test of flaky) console.log(`::warning file=${test.file}::Flaky: ${test.test_name ?? "the file"} failed, then passed on a second run.`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
