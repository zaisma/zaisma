import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a Node script with no types of its own.
import { ERROR_LINE_COUNT, formatGithubResult, formatResult, judgeCheckRuns, pagesForChangedFiles, parseJobLog, parseTypecheck, parseVitestReport } from "../../scripts/check.mjs";

/** scripts/check.mjs: how it reads vitest's and tsc's output and what it prints. */

const ROOT = "/repo";

describe("parseVitestReport", () => {
  it("names each failed test with its file and the first lines of its error", () => {
    const longError = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n");
    const failures = parseVitestReport(
      {
        testResults: [
          { name: `${ROOT}/test/node/a.test.ts`, status: "failed", assertionResults: [{ fullName: "a refuses", status: "failed", failureMessages: [longError] }, { fullName: "a works", status: "passed", failureMessages: [] }] },
          { name: `${ROOT}/test/node/b.test.ts`, status: "passed", assertionResults: [{ fullName: "b works", status: "passed", failureMessages: [] }] },
        ],
      },
      { root: ROOT },
    );
    expect(failures).toEqual([{ file: "test/node/a.test.ts", test_name: "a refuses", error: longError.split("\n").slice(0, ERROR_LINE_COUNT).join("\n") }]);
  });

  it("reports a file that failed to load with no test name", () => {
    const failures = parseVitestReport({ testResults: [{ name: `${ROOT}/test/node/c.test.ts`, status: "failed", message: "Cannot find module", assertionResults: [] }] }, { root: ROOT });
    expect(failures).toEqual([{ file: "test/node/c.test.ts", test_name: null, error: "Cannot find module" }]);
  });
});

describe("parseTypecheck", () => {
  it("turns tsc errors into file, line and message", () => {
    const output = "apps/site/src/a.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.\nFound 1 error.\n";
    expect(parseTypecheck(output)).toEqual([{ file: "apps/site/src/a.ts", line: 12, message: "TS2322: Type 'string' is not assignable to type 'number'." }]);
  });
});

describe("pagesForChangedFiles", () => {
  it("maps a changed site file to the pages whose path has its name", () => {
    expect(pagesForChangedFiles(["apps/site/src/browse.ts", "README.md"], ["/", "/browse", "/signin"])).toEqual(["/browse"]);
    expect(pagesForChangedFiles(["docs/NAMING.md"], ["/browse"])).toEqual([]);
  });
});

describe("formatResult", () => {
  const empty = { test_failures: [], typecheck_failures: [], layout_failures: [], left_to_github: [], notes: [], is_pass: true };
  it("ends on PASS when nothing failed", () => {
    expect(formatResult(empty).split("\n").at(-1)).toBe("PASS");
  });
  it("lists each failure and ends on FAIL", () => {
    const text = formatResult({ ...empty, is_pass: false, test_failures: [{ file: "test/node/a.test.ts", test_name: "a refuses", error: "boom" }], typecheck_failures: [{ file: "x.ts", line: 3, message: "TS1: bad" }] });
    expect(text).toBe("TEST test/node/a.test.ts > a refuses\n  boom\nTYPE x.ts:3: TS1: bad\nFAIL");
  });
});

/** Two real job logs from GitHub's check (Oct 24, 2026), cut to the steps that failed: a test shard and an Engine exports shard. */
const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

describe("parseJobLog", () => {
  it("names a failed test in a shard's log with its file, its name and the first lines of its error", () => {
    const parsed = parseJobLog(fixture("github-job-tests.log"));
    expect(parsed.test_failures).toHaveLength(1);
    expect(parsed.test_failures[0]).toMatchObject({ file: "test/node/stored-values.test.ts", test_name: "page scripts > put values into styles, addresses and HTML only where that was looked at" });
    expect(parsed.test_failures[0].error.split("\n")[0]).toMatch(/^AssertionError: Check what each puts there/);
    expect(parsed.test_failures[0].error).toContain("❯ test/node/stored-values.test.ts:113:173");
    expect(parsed.test_failures[0].error).not.toMatch(/\x1b|Z /);
    expect(parsed.typecheck_failures).toEqual([]);
    expect(parsed.step_lines).toEqual([]);
  });

  it("gives the last lines of the step that failed when the log names no test", () => {
    const parsed = parseJobLog(fixture("github-job-engines.log"));
    expect(parsed.test_failures).toEqual([]);
    expect(parsed.step_lines).toContain("  FAIL three: the game page got no performance report with a load time and frame seconds.");
    expect(parsed.step_lines.at(-1)).toBe("ENGINES FAIL: 1 engine check(s) failed.");
    expect(parsed.step_lines.join("\n")).not.toContain("tail -n 80");
  });

  it("reads typecheck errors and a test file that failed to load", () => {
    const log = [
      "2026-10-24T21:02:01.0952712Z ##[group]Run npm run typecheck",
      "2026-10-24T21:02:01.1018767Z ##[endgroup]",
      "2026-10-24T21:02:20.1018767Z apps/site/src/a.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      "2026-10-24T21:02:20.2018767Z ##[error]Process completed with exit code 2.",
    ].join("\n");
    expect(parseJobLog(log).typecheck_failures).toEqual([{ file: "apps/site/src/a.ts", line: 12, message: "TS2322: Type 'string' is not assignable to type 'number'." }]);
    const suites = ["⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯", "", " FAIL   node  test/node/c.test.ts [ test/node/c.test.ts ]", "Error: Cannot find module './gone'", "⎯⎯⎯⎯⎯⎯⎯[1/1]⎯", " Test Files  1 failed (1)"].join("\n");
    expect(parseJobLog(suites).test_failures).toEqual([{ file: "test/node/c.test.ts", test_name: null, error: "Error: Cannot find module './gone'" }]);
  });
});

describe("judgeCheckRuns", () => {
  const run = (name: string, status: string, conclusion: string | null) => ({ id: 1, name, status, conclusion, html_url: "https://github.com/x" });
  it("leaves out the required check, which only sums up, when another job failed", () => {
    const judged = judgeCheckRuns([run("Tests and typecheck", "completed", "failure"), run("Tests (2 of 4)", "completed", "failure"), run("Typecheck", "completed", "success")]);
    expect(judged.state).toBe("fail");
    expect(judged.failed_jobs.map((job: { name: string }) => job.name)).toEqual(["Tests (2 of 4)"]);
  });
  it("is pending while a job runs and nothing failed, and when no job has started", () => {
    expect(judgeCheckRuns([run("Typecheck", "completed", "success"), run("Tests (1 of 4)", "in_progress", null)])).toMatchObject({ state: "pending", pending_job_names: ["Tests (1 of 4)"] });
    expect(judgeCheckRuns([]).state).toBe("pending");
    expect(judgeCheckRuns([run("Typecheck", "completed", "success"), run("Docs tests", "completed", "skipped")]).state).toBe("pass");
  });
});

describe("formatGithubResult", () => {
  it("prints each failed job with its failures and ends on the state", () => {
    const text = formatGithubResult({
      pull_request_number: 104,
      commit_sha: "3bc3b5e07f5e38bf1a7c0cdd7f7d6bd94dc973e3",
      state: "fail",
      pending_job_names: [],
      failed_jobs: [{ job_name: "Tests (2 of 4)", url: "https://github.com/run", test_failures: [{ file: "test/node/a.test.ts", test_name: "a refuses", error: "boom" }], typecheck_failures: [], step_lines: [] }],
    });
    expect(text).toBe("GitHub's check on 3bc3b5e (pull request 104)\nJOB Tests (2 of 4) https://github.com/run\nTEST test/node/a.test.ts > a refuses\n  boom\nFAIL");
  });
});
