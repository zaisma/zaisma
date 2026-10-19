// The review's fingerprint: what has to stay the same for the last run of the review test set to still count
// (review-set/README.md). npm test (test/node/review-set.test.ts) checks review-set/last-run.json against it, so the
// review's prompt or model can't change without a new full run.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The files whose every line can change a verdict (the readers, the judge and the evidence), and the wrangler vars that pick their models. */
export const REVIEW_FINGERPRINT_FILES = ["apps/site/src/review-readers.ts", "apps/site/src/review-judge.ts", "packages/core/src/review-evidence.ts", "packages/core/src/review-precedents.ts"];
export const REVIEW_MODEL_VARS = ["REVIEW_READER_MODEL", "REVIEW_JUDGE_MODEL"];

/**
 * The review as it was when the test set arrived (Oct 18, 2026): measured, but not held to passing. Every
 * fingerprint after it needs a passing run.
 */
export const BASELINE_FINGERPRINT_SHA256 = "";

/** The model vars' values in apps/site/wrangler.jsonc, by name. */
export function reviewModelVars(rootDirectory) {
  const config = readFileSync(join(rootDirectory, "apps/site/wrangler.jsonc"), "utf8");
  return Object.fromEntries(REVIEW_MODEL_VARS.map((name) => [name, new RegExp(`"${name}":\\s*"([^"]*)"`).exec(config)?.[1] ?? ""]));
}

/** sha256 (hex) of the review's files and its model vars. */
export function reviewFingerprint(rootDirectory) {
  const parts = [
    ...REVIEW_FINGERPRINT_FILES.map((path) => [path, readFileSync(join(rootDirectory, path), "utf8")]),
    ...Object.entries(reviewModelVars(rootDirectory)),
  ];
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
