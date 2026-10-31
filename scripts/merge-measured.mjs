#!/usr/bin/env node
// The layout check's measured pages (scripts/layout-check.mjs, --measured): a JSON object of page fingerprints, each "passed" or "failed".
// GitHub's runs each write their share's, and this puts them together for main's cache, where the merge queue reads them to skip the pages
// no change reached (.github/workflows/check.yml and nightly.yml). Plain Node with no packages, so it runs before npm ci.
//
//   node scripts/merge-measured.mjs <file> <file or folder>...   writes to <file> what it holds and every .json given or in those folders
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/** The most fingerprints a file keeps, the newest. */
export const MEASURED_FINGERPRINT_LIMIT = 5000;

/** A measured file's fingerprints: none when there's no file yet. */
export function readMeasured(path) {
  if (!existsSync(path)) return {};
  const measured = JSON.parse(readFileSync(path, "utf8"));
  if (!measured || typeof measured !== "object" || Array.isArray(measured)) throw new Error(`${path} isn't a JSON object of fingerprints.`);
  return measured;
}

/** Fingerprints together, the later ones winning and counting as newest, at most MEASURED_FINGERPRINT_LIMIT. */
export function mergeMeasured(...lists) {
  const merged = new Map();
  for (const list of lists) for (const [fingerprint, result] of Object.entries(list ?? {})) {
    if (result !== "passed" && result !== "failed") continue;
    merged.delete(fingerprint);
    merged.set(fingerprint, result);
  }
  return Object.fromEntries([...merged].slice(-MEASURED_FINGERPRINT_LIMIT));
}

const jsonFilesIn = (path) => (statSync(path).isDirectory() ? readdirSync(path).sort().flatMap((name) => jsonFilesIn(join(path, name))) : path.endsWith(".json") ? [path] : []);

function main() {
  const [outPath, ...sources] = process.argv.slice(2);
  if (!outPath || !sources.length) {
    console.log("merge-measured.mjs takes the file to write and the files or folders to add: node scripts/merge-measured.mjs <file> <file or folder>...");
    process.exit(2);
  }
  const lists = [readMeasured(outPath), ...sources.filter((source) => existsSync(source)).flatMap(jsonFilesIn).map(readMeasured)];
  const merged = mergeMeasured(...lists);
  mkdirSync(dirname(outPath) || ".", { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(merged)}\n`);
  console.log(`${Object.keys(merged).length} measured page fingerprints in ${outPath}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();

