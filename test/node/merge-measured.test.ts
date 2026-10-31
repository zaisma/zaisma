import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain JavaScript script without types
import { MEASURED_FINGERPRINT_LIMIT, mergeMeasured, readMeasured } from "../../scripts/merge-measured.mjs";
import { temporaryFolder } from "../temporary-folder.ts";

/** scripts/merge-measured.mjs: the layout check's measured pages, put together from GitHub's shares for main's cache. */

const ROOT = join(import.meta.dirname, "../..");

describe("mergeMeasured", () => {
  it("keeps every fingerprint once, the later list winning, and drops what isn't a result", () => {
    expect(mergeMeasured({ a: "passed", b: "failed" }, { b: "passed", c: "failed", d: "maybe" }, undefined)).toEqual({ a: "passed", b: "passed", c: "failed" });
  });
  it("keeps only the newest when there are too many", () => {
    const many = Object.fromEntries(Array.from({ length: MEASURED_FINGERPRINT_LIMIT + 2 }, (_, index) => [`f${index}`, "passed"]));
    const merged = mergeMeasured(many, { f0: "failed" });
    expect(Object.keys(merged).length).toBe(MEASURED_FINGERPRINT_LIMIT);
    expect(merged.f0).toBe("failed");
    expect(merged.f1).toBe(undefined);
    expect(merged.f2).toBe(undefined);
  });
});

describe("node scripts/merge-measured.mjs", () => {
  const folder = temporaryFolder("merge-measured-");
  it("writes the file with what it held and every share's file in the folders given, missing ones skipped", () => {
    const out = join(folder, ".wrangler/layout-sweep-measured.json");
    mkdirSync(join(folder, "measured/layout-sweep-measured-1"), { recursive: true });
    mkdirSync(join(folder, "measured/layout-sweep-measured-2"), { recursive: true });
    writeFileSync(join(folder, "measured/layout-sweep-measured-1/layout-sweep-measured.json"), JSON.stringify({ a: "passed" }));
    writeFileSync(join(folder, "measured/layout-sweep-measured-2/layout-sweep-measured.json"), JSON.stringify({ b: "failed" }));
    const run = spawnSync(process.execPath, [join(ROOT, "scripts/merge-measured.mjs"), out, join(folder, "measured"), join(folder, "not-there")], { encoding: "utf8" });
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({ a: "passed", b: "failed" });
    expect(readMeasured(join(folder, "nothing.json"))).toEqual({});
    writeFileSync(join(folder, "list.json"), "[]");
    expect(() => readMeasured(join(folder, "list.json"))).toThrow("isn't a JSON object of fingerprints");
  });
});
