import { BaseSequencer, type TestSpecification } from "vitest/node";
import { readFileSync } from "node:fs";
import { relative } from "node:path";

/**
 * How GitHub's check splits the tests across its runners (npm test -- --shard=N/6, .github/workflows/check.yml).
 * Vitest's own split deals files out by a hash of their path, so it can put the slowest files together and
 * leave one runner far behind the others. Here every file has a cost, and the files are dealt out slowest
 * first, each to the runner with the least so far, so the runners finish together.
 *
 * A file's cost is its tests' time on GitHub's runners (test/shard-weights.json, the files over a second;
 * refresh it from the Tests jobs' logs when a file gets much slower) plus what every file costs before its
 * tests start: its set-up, about 1.4 seconds of the migrations applied to a fresh database.
 */
export const SHARD_TEST_DURATIONS_MS: Record<string, number> = JSON.parse(readFileSync(new URL("./shard-weights.json", import.meta.url).pathname, "utf8"));
const SETUP_DURATION_MS = 1400;
const UNLISTED_FILE_TEST_DURATION_MS = 300;

/** A test file's cost in milliseconds, by its path from the repository root. */
export function shardCostMs(path: string): number {
  return SETUP_DURATION_MS + (SHARD_TEST_DURATIONS_MS[path] ?? UNLISTED_FILE_TEST_DURATION_MS);
}

/** The files in each of shardCount shards (the same on every runner, since it depends only on the paths). */
export function dealIntoShards(paths: string[], shardCount: number): string[][] {
  const shards = Array.from({ length: shardCount }, () => ({ costMs: 0, paths: [] as string[] }));
  const slowestFirst = [...paths].sort((a, b) => shardCostMs(b) - shardCostMs(a) || (a < b ? -1 : 1));
  for (const path of slowestFirst) {
    const lightest = shards.reduce((least, shard) => (shard.costMs < least.costMs ? shard : least));
    lightest.costMs += shardCostMs(path);
    lightest.paths.push(path);
  }
  return shards.map((shard) => shard.paths);
}

/** Vitest's sequencer with its split by hash replaced by dealIntoShards (set in vitest.config.ts). */
export class BalancedShardSequencer extends BaseSequencer {
  override async shard(specifications: TestSpecification[]): Promise<TestSpecification[]> {
    const { index, count } = this.ctx.config.shard!;
    const pathOf = (specification: TestSpecification) => relative(this.ctx.config.root, specification.moduleId);
    const mine = new Set(dealIntoShards(specifications.map(pathOf), count)[index - 1]);
    return specifications.filter((specification) => mine.has(pathOf(specification)));
  }
}
