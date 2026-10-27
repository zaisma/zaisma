import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tests that hang on the real clock flake (Julius, Oct 26, 2026): a test that takes today's date or month from the real clock splits
 * across midnight UTC from the code it checks, and a test that sleeps a fixed time races the work it waits for. So no test file may
 * do either more often than it did on Oct 26, 2026 (test/real-time-baseline.json, which only shrinks): a new test sets the clock
 * (vi.setSystemTime, or a fixed time passed in) and waits on what it waits for (vi.waitFor, a promise the code settles), never a
 * fixed sleep. A file where real time is the point (the full-room load test) keeps its count in the baseline.
 * REAL_TIME_WRITE_BASELINE=1 writes the baseline from the files as they are, only to lower it after a fix.
 */

const ROOT = join(import.meta.dirname, "../..");
const BASELINE_PATH = join(ROOT, "test/real-time-baseline.json");

/** Today's date or month, or a part of the date, read from the real clock. */
export const REAL_CALENDAR = /(new Date\(\)|new Date\(Date\.now\(\)[^)]*\))\.(toISOString\(\)\.slice\(0,\s*(7|10)\)|getUTC(Date|Day|Month|FullYear|Hours))/g;
/** A fixed sleep: new Promise((resolve) => setTimeout(resolve, 50)) and the like. */
export const REAL_SLEEP = /setTimeout\(\s*\w+\s*,\s*[0-9_]+\s*\)/g;

type Counts = { real_calendar_count: number; real_sleep_count: number };

export function realTimeCounts(source: string): Counts {
  return { real_calendar_count: source.match(REAL_CALENDAR)?.length ?? 0, real_sleep_count: source.match(REAL_SLEEP)?.length ?? 0 };
}

function testSourceFiles(): string[] {
  const found: string[] = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      // The engine samples are other projects' builds, and this file shows the patterns it looks for.
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && relative(ROOT, path) !== "test/engines") walk(path);
      } else if (entry.name.endsWith(".ts") && relative(ROOT, path) !== "test/node/test-clock.test.ts") found.push(relative(ROOT, path));
    }
  };
  walk(join(ROOT, "test"));
  return found.sort();
}

describe("tests and the real clock", () => {
  it("finds today's date from the real clock and fixed sleeps, and nothing that sets the time", () => {
    expect(realTimeCounts("const today = new Date().toISOString().slice(0, 10);")).toEqual({ real_calendar_count: 1, real_sleep_count: 0 });
    expect(realTimeCounts("const day = new Date(Date.now() - 2 * DAY_MS).toISOString().slice(0, 10); const year = new Date().getUTCFullYear();")).toEqual({ real_calendar_count: 2, real_sleep_count: 0 });
    expect(realTimeCounts("await new Promise((resolve) => setTimeout(resolve, 1_500));")).toEqual({ real_calendar_count: 0, real_sleep_count: 1 });
    expect(realTimeCounts('vi.setSystemTime(new Date("2026-10-26T12:00:00Z")); const today = new Date("2026-10-26T12:00:00Z").toISOString().slice(0, 10); setTimeout(() => done(), delayMs);')).toEqual({ real_calendar_count: 0, real_sleep_count: 0 });
  });

  it("are never used more than the baseline allows", () => {
    const counts = Object.fromEntries(testSourceFiles().map((path) => [path, realTimeCounts(readFileSync(join(ROOT, path), "utf8"))]).filter(([, each]) => (each as Counts).real_calendar_count + (each as Counts).real_sleep_count > 0)) as Record<string, Counts>;
    if (process.env.REAL_TIME_WRITE_BASELINE) writeFileSync(BASELINE_PATH, `${JSON.stringify(counts, null, 2)}\n`);
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Record<string, Counts>;
    const over = Object.entries(counts).flatMap(([path, each]) => {
      const allowed = baseline[path] ?? { real_calendar_count: 0, real_sleep_count: 0 };
      return [
        ...(each.real_calendar_count > allowed.real_calendar_count ? [`${path}: ${each.real_calendar_count} read(s) of today's date or month from the real clock (${allowed.real_calendar_count} allowed). Set the clock: vi.setSystemTime(new Date("2026-10-26T12:00:00Z")), or pass the code a fixed time.`] : []),
        ...(each.real_sleep_count > allowed.real_sleep_count ? [`${path}: ${each.real_sleep_count} fixed sleep(s) (${allowed.real_sleep_count} allowed). Wait on what you wait for: vi.waitFor(() => …), or a promise the code settles.`] : []),
      ];
    });
    expect(over).toEqual([]);
  });
});
