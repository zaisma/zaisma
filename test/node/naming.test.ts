import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { columnProblems, sourceProblems, tally, words } from "../naming-source.ts";
import { ADMIN_ERROR_CODES, ERROR_CODES } from "../../packages/core/src/errors.ts";
import { ERROR } from "../../apps/site/src/schemas.ts";

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

describe("docs/NAMING.md names what the code has", () => {
  const naming = readFileSync(join(ROOT, "docs/NAMING.md"), "utf8");
  const between = (start: string, end: string) => naming.slice(naming.indexOf(`\n${start}\n`), naming.indexOf(`\n${end}\n`));
  /** Every identifier in Zaisma's code and migrations. */
  const codeWords = new Set<string>();
  const readAll = (directory: string): void => {
    for (const entry of readdirSync(join(ROOT, directory), { withFileTypes: true })) {
      if (entry.isDirectory() && !["node_modules", "dist", ".wrangler"].includes(entry.name)) readAll(join(directory, entry.name));
      else if (/\.(ts|mts|js|mjs|sql)$/.test(entry.name)) for (const word of readFileSync(join(ROOT, directory, entry.name), "utf8").match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) codeWords.add(word);
    }
  };
  for (const directory of ["apps", "packages", "migrations"]) readAll(directory);

  it("in the Glossary: every name it gives is in the code", () => {
    // Placeholders (<slug>), patterns (*_path_count), quoted values, an ID's kind (pending_refund_…), words the prose builds names from and Stripe's own IDs (acct_…) aren't names.
    const proseWords = new Set(["nearly_used", "acct"]);
    const glossary = between("## Glossary", "## Adding a field, option or tool");
    const missing = [...glossary.matchAll(/`([^`]+)`/g)]
      .map((match) => match[1]!)
      .filter((name) => !name.includes("*"))
      .flatMap((name) => name.replace(/<[^>]*>/g, "").replace(/"[^"]*"/g, "").replace(/_…/g, "").match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [])
      .filter((word) => word.length > 2 && !proseWords.has(word) && !codeWords.has(word));
    expect([...new Set(missing)]).toEqual([]);
  });

  it("in Errors: only error codes the code has and the error's own fields", () => {
    const fields = Object.keys((ERROR.properties as Record<string, { properties: object }>).error!.properties);
    const named = [...between("## Errors", "## Next steps").matchAll(/`([a-z]+(?:_[a-z]+)+|[a-z]+)`/g)].map((match) => match[1]!);
    expect(named.filter((name) => name !== "null" && !fields.includes(name) && !(name in ERROR_CODES) && !(name in ADMIN_ERROR_CODES))).toEqual([]);
  });
});
