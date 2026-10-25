import { describe, expect, it } from "vitest";
// @ts-expect-error: a Node script with no types of its own.
import { ERROR_LINE_COUNT, formatResult, pagesForChangedFiles, parseTypecheck, parseVitestReport } from "../../scripts/check.mjs";

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
