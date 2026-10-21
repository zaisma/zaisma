import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SHARD_TEST_DURATIONS_MS, dealIntoShards, shardCostMs } from "../shards.ts";

/** test/shards.ts: how GitHub's check deals the test files out to its six runners. */

const ROOT = join(import.meta.dirname, "../..");
const SHARD_COUNT = 6;

const testFilesIn = (folder: string): string[] =>
  readdirSync(join(ROOT, "test", folder), { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? testFilesIn(join(folder, entry.name)) : entry.name.endsWith(".test.ts") ? [`test/${join(folder, entry.name)}`] : []));
const projects = ["node", "site", "games", "core", "game-server", "rooms"];
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

  it("put the slowest files in different shards", () => {
    const shards = dealIntoShards(["test/site/access-checks.test.ts", "test/node/cli.test.ts", "test/site/accounts.test.ts"], 3);
    expect(shards.map((paths) => paths.length)).toEqual([1, 1, 1]);
  });
});
