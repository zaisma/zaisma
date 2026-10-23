// The engine samples (test/engines/<engine>/build, each a web export as its engine wrote it) that the preview seeds and
// scripts/engines/play.mjs plays. GitHub's check splits them across runners: ENGINE_SAMPLE_SHARD="2/3" takes the second of
// three shares, and every sample is in exactly one.
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
// About how long a sample takes in the preview, upload, run in Chrome and play: a threaded build's run waits the whole
// PERFORMANCE_CHECK_MAXIMUM_RUN_DURATION_SEC (the preview's Chrome can't start it), the rest draw within seconds.
const THREADED_COST_SEC = 45;
const COST_SEC = 25;

/** Every sample in the repository, by folder name: threaded builds last, so the others' runs in Chrome don't wait behind theirs. */
export function allEngineSamples(root = ROOT) {
  const engines = readdirSync(join(root, "test/engines"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, "test/engines", entry.name, "build/index.html")))
    .map((entry) => entry.name)
    .sort();
  return [...engines.filter((engine) => !isThreaded(engine)), ...engines.filter(isThreaded)];
}

/** A threaded build: its folder name ends in -threads, and it runs only in a game frame isolated by Document-Isolation-Policy. */
export const isThreaded = (engine) => engine.endsWith("-threads");

/** The samples in one share of shardCount ("index/count", from 1), dealt by cost, the dearest first, each to the share with the least. */
export function engineSampleShard(engines, shard) {
  const [index, count] = shard.split("/").map(Number);
  if (!Number.isInteger(index) || !Number.isInteger(count) || index < 1 || index > count) throw new Error(`ENGINE_SAMPLE_SHARD is "${shard}": it takes a share and a count, like 2/3.`);
  const shares = Array.from({ length: count }, () => ({ costSec: 0, engines: [] }));
  const dearestFirst = [...engines].sort((a, b) => (isThreaded(b) ? THREADED_COST_SEC : COST_SEC) - (isThreaded(a) ? THREADED_COST_SEC : COST_SEC) || (a < b ? -1 : 1));
  for (const engine of dearestFirst) {
    const least = shares.reduce((lightest, share) => (share.costSec < lightest.costSec ? share : lightest));
    least.costSec += isThreaded(engine) ? THREADED_COST_SEC : COST_SEC;
    least.engines.push(engine);
  }
  return engines.filter((engine) => shares[index - 1].engines.includes(engine));
}

/** This run's samples: every one, or ENGINE_SAMPLE_SHARD's share of them. */
export function engineSamples({ root = ROOT, shard = process.env.ENGINE_SAMPLE_SHARD } = {}) {
  const engines = allEngineSamples(root);
  return shard ? engineSampleShard(engines, shard) : engines;
}
