import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a Node script with no types of its own.
import { LAYOUT_CHECK_RUNS, PRESS_CHECK_SCREEN_NAME } from "../../scripts/layout-check.mjs";

/** The sweep's press check (no answer within 400 ms) runs on a screen the sweep measures: a name that matches none quietly turns the rule off. */

const SOURCE = readFileSync(join(import.meta.dirname, "../../scripts/layout-check.mjs"), "utf8");

describe("the sweep's press check", () => {
  it("runs on exactly one of the sweep's screens", () => {
    const names = (LAYOUT_CHECK_RUNS.sweep.sizes as { name: string }[]).map((size) => size.name);
    expect(names.filter((name) => name === PRESS_CHECK_SCREEN_NAME), `the sweep's screens are ${names.join(", ")}`).toEqual([PRESS_CHECK_SCREEN_NAME]);
  });

  it("is on a laptop screen, and the check asks for that screen by the constant", () => {
    expect(PRESS_CHECK_SCREEN_NAME).toMatch(/^Laptop/);
    expect(SOURCE).toContain('options.tiers.includes("sweep") && size.name === PRESS_CHECK_SCREEN_NAME');
  });

  it("is not asked of a screen the pull request's run measures with the page tier only", () => {
    expect(LAYOUT_CHECK_RUNS.pull_request.tiersOf({})).toEqual(["page"]);
  });
});
