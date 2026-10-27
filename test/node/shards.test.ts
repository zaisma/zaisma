import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALONE_TEST_FILES, CI_WORKER_COUNT, SHARD_TEST_DURATIONS_MS, dealIntoShards, shardCostMs } from "../shards.ts";
// @ts-expect-error: a Node script with no types of its own.
import { allEngineSamples, engineSampleShard } from "../../scripts/engines/samples.mjs";
// @ts-expect-error: a Node script with no types of its own.
import { LAYOUT_CHECK_PAGES, layoutCheckShard } from "../../scripts/layout-check.mjs";

/** test/shards.ts: how GitHub's check deals the test files out to its four runners; and the engine samples and layout pages to theirs. */

const ROOT = join(import.meta.dirname, "../..");
const SHARD_COUNT = 4;
const workflow = readFileSync(join(ROOT, ".github/workflows/check.yml"), "utf8");

const testFilesIn = (folder: string): string[] =>
  readdirSync(join(ROOT, "test", folder), { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? testFilesIn(join(folder, entry.name)) : entry.name.endsWith(".test.ts") ? [`test/${join(folder, entry.name)}`] : []));
const projects = ["node", "site", "games", "core", "game-server", "rooms", "load"];
const allTestFiles = projects.flatMap(testFilesIn);

describe("the shards", () => {
  it("name only files that exist, so a renamed file's cost isn't lost", () => {
    for (const path of Object.keys(SHARD_TEST_DURATIONS_MS)) expect(existsSync(join(ROOT, path)), path).toBe(true);
  });

  it("run every test file once, the same on every runner", () => {
    const shards = dealIntoShards(allTestFiles, SHARD_COUNT);
    expect(shards).toHaveLength(SHARD_COUNT);
    expect(shards.flat().sort()).toEqual([...allTestFiles].sort());
    expect(dealIntoShards([...allTestFiles].reverse(), SHARD_COUNT)).toEqual(shards);
  });

  it("finish together: no shard costs a fifth more than the average", () => {
    const costs = dealIntoShards(allTestFiles, SHARD_COUNT).map((paths) => paths.reduce((sum, path) => sum + shardCostMs(path), 0));
    const averageCostMs = costs.reduce((sum, cost) => sum + cost, 0) / SHARD_COUNT;
    expect(Math.max(...costs)).toBeLessThan(averageCostMs * 1.2);
  });

  it("are the ones the workflow runs, four files at once", () => {
    expect(workflow).toContain(`npm test -- --shard=\${{ matrix.shard }}/${SHARD_COUNT}`);
    expect(workflow).toContain(`TEST_WORKER_COUNT: ${CI_WORKER_COUNT}`);
    for (const path of ALONE_TEST_FILES) expect(existsSync(join(ROOT, path)), path).toBe(true);
  });

  it("put the slowest files in different shards", () => {
    const shards = dealIntoShards(["test/site/access-checks.test.ts", "test/node/cli.test.ts", "test/site/accounts.test.ts"], 3);
    expect(shards.map((paths) => paths.length)).toEqual([1, 1, 1]);
  });
});

describe("the preview checks' shares", () => {
  it("play every engine sample once, threaded builds last in line", () => {
    const engines: string[] = allEngineSamples();
    expect(engines.length).toBeGreaterThan(5);
    expect(engines.at(-1)).toMatch(/-threads$/);
    for (const count of [1, 2, 3, 4]) {
      const shares = Array.from({ length: count }, (_, i) => engineSampleShard(engines, `${i + 1}/${count}`) as string[]);
      expect(shares.flat().sort()).toEqual([...engines].sort());
    }
    expect(workflow).toContain("ENGINE_SAMPLE_SHARD: ${{ matrix.shard }}/3");
    expect(() => engineSampleShard(engines, "4/3")).toThrow(/like 2\/3/);
  });

  it("measure every page once", () => {
    for (const count of [1, 2, 3, 4]) {
      const shares = Array.from({ length: count }, (_, i) => layoutCheckShard(LAYOUT_CHECK_PAGES, `${i + 1}/${count}`) as { name: string }[]);
      expect(shares.flat().map((page) => page.name).sort()).toEqual(LAYOUT_CHECK_PAGES.map((page: { name: string }) => page.name).sort());
    }
    expect(workflow).toContain("LAYOUT_CHECK_SHARD: ${{ matrix.shard }}/4");
  });
});
