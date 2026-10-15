import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { columnProblems, sourceProblems, tally, words } from "../naming-source.ts";

/**
 * docs/NAMING.md holds for Zaisma's own code. Names not yet moved over are listed in
 * test/naming-baseline.json, per file and per table; any new one fails, and so does any listed one
 * that's gone, so the list only shrinks. After fixing names: npm run naming:baseline.
 */

const ROOT = join(import.meta.dirname, "../..");
const BASELINE = join(ROOT, "test/naming-baseline.json");
type Counts = Record<string, Record<string, number>>;

/** What's new compared with the baseline, and what the baseline still lists but is gone. */
function compare(current: Counts, baseline: Counts): { added: string[]; gone: string[] } {
  const added: string[] = [];
  const gone: string[] = [];
  for (const [where, problems] of Object.entries(current)) {
    for (const [key, count] of Object.entries(problems)) {
      const before = baseline[where]?.[key] ?? 0;
      if (count > before) added.push(`${where}  ${key}${count - before > 1 ? ` (${count - before} more)` : ""}`);
    }
  }
  for (const [where, problems] of Object.entries(baseline)) {
    for (const [key, count] of Object.entries(problems)) {
      if ((current[where]?.[key] ?? 0) < count) gone.push(`${where}  ${key}`);
    }
  }
  return { added, gone };
}

describe("Zaisma's own names follow docs/NAMING.md", () => {
  const source = tally(sourceProblems(ROOT));
  const columns = tally(columnProblems(join(ROOT, "migrations")));

  if (process.env.NAMING_WRITE_BASELINE) {
    it("writes the baseline", () => {
      writeFileSync(BASELINE, `${JSON.stringify({ source, columns }, null, 2)}\n`);
    });
    return;
  }

  const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as { source: Counts; columns: Counts };
  const advice = "Fix the names (docs/NAMING.md); once they're fixed, run npm run naming:baseline to shrink the list.";

  it("in the code: names declared in apps/ and packages/", () => {
    const { added, gone } = compare(source, baseline.source);
    expect(added, `New names that break docs/NAMING.md. ${advice}`).toEqual([]);
    expect(gone, `Fixed names still listed in test/naming-baseline.json. Run npm run naming:baseline.`).toEqual([]);
  });

  it("in the database: the columns the migrations make", () => {
    const { added, gone } = compare(columns, baseline.columns);
    expect(added, `New columns that break docs/NAMING.md. ${advice}`).toEqual([]);
    expect(gone, `Fixed columns still listed in test/naming-baseline.json. Run npm run naming:baseline.`).toEqual([]);
  });
});

describe("the check itself", () => {
  it("splits names in any style", () => {
    expect(words("getHTTPStatus")).toEqual(["get", "http", "status"]);
    expect(words("play_duration_min")).toEqual(["play", "duration", "min"]);
    expect(words("MAXIMUM_GAME_COUNT_PER_OWNER")).toEqual(["maximum", "game", "count", "per", "owner"]);
  });
});
