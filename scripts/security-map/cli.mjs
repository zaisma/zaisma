#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writePage } from "./build-page.mjs";
import { checkMapDirExport, exportMapDir } from "./export-public.mjs";
import { defaultMapDir, generateMap, readMap, staleMissingEvidence, writeMap } from "./generate.mjs";
import { demoExport } from "./page/demo-export.mjs";
import { promiseProblems, promiseSummaries, readPromises, refreshPromises, writePromises } from "./promises.mjs";
import { finishReview, reviewStepCountOf, startReview } from "./review.mjs";
import { seedMapDir } from "./seed-robust.mjs";

/**
 * The security map's commands (the security-map skill says when each runs):
 *
 *   node scripts/security-map/cli.mjs generate   refresh doors from the code; changed code makes verdicts stale
 *   node scripts/security-map/cli.mjs seed       set robust what the repo's tests and ship checks prove
 *   node scripts/security-map/cli.mjs export     write exports/map-public.json (--check re-checks it)
 *   node scripts/security-map/cli.mjs page       build the Security map page from the export (--out <path>, --export <path> or --demo <doors per sector>)
 *   node scripts/security-map/cli.mjs verify     generate, then stale any case whose cited test is gone
 *   node scripts/security-map/cli.mjs promises   check the sectors' promises, and mark stale the scores whose code changed (--check changes nothing)
 *   node scripts/security-map/cli.mjs review-start    the daily review's whole catch-up, as JSON
 *   node scripts/security-map/cli.mjs review-finish --from <night.json> [--again]    check the night whole, apply it, commit and push
 *   node scripts/security-map/cli.mjs review-steps --from <YYYY-MM-DD> --to <YYYY-MM-DD>    the steps the daily reviews counted in those days
 *
 * Options: --map-dir <path> (default ZAISMA_SECURITY_DIR, then ~/zaisma-private/security),
 * --date <YYYY-MM-DD> (export and the review commands, default today in UTC).
 */

const REPO_ROOT = join(import.meta.dirname, "../..");
const COMMANDS = ["generate", "seed", "export", "verify", "page", "promises", "review-start", "review-finish", "review-steps"];

function readArguments(argv) {
  const [command, ...rest] = argv;
  const options = { mapDir: defaultMapDir(), fromText: null, toText: null, isAgain: false, date: new Date().toISOString().slice(0, 10), isCheck: false, outPath: null, exportPath: null, demoDoorCountPerSector: null };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === "--check") options.isCheck = true;
    else if (flag === "--map-dir") options.mapDir = rest[++index];
    else if (flag === "--from") options.fromText = rest[++index];
    else if (flag === "--to") options.toText = rest[++index];
    else if (flag === "--again") options.isAgain = true;
    else if (flag === "--date") options.date = rest[++index];
    else if (flag === "--out") options.outPath = rest[++index];
    else if (flag === "--export") options.exportPath = rest[++index];
    else if (flag === "--demo") options.demoDoorCountPerSector = Number(rest[++index]);
    else throw new Error(`Unknown option ${flag}. Options: --map-dir <path>, --from <path or day>, --to <day>, --again, --date <YYYY-MM-DD>, --check (export, promises), --out <path>, --export <path>, --demo <doors per sector> (page).`);
  }
  if (!COMMANDS.includes(command)) throw new Error(`Say one of: ${COMMANDS.join(", ")}.`);
  if (command === "review-finish" && !options.fromText) throw new Error("review-finish needs --from <night.json>: the night's record, as the daily-review skill says.");
  if (command === "review-steps" && !(options.fromText && options.toText)) throw new Error("review-steps needs --from <YYYY-MM-DD> and --to <YYYY-MM-DD>.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) throw new Error("--date is a day like 2026-10-18.");
  if (command === "page") {
    if (!options.outPath) throw new Error("page needs --out <path>: the HTML file to write, in your session's scratchpad.");
    if (options.exportPath && options.demoDoorCountPerSector !== null) throw new Error("Use --export or --demo, not both.");
    if (options.demoDoorCountPerSector !== null && (!Number.isInteger(options.demoDoorCountPerSector) || options.demoDoorCountPerSector < 1)) throw new Error("--demo is a whole number of doors per sector, like 60.");
  }
  return { command, options };
}

const warn = (text) => console.warn(`warning: ${text}`);
const list = (label, items) => console.log(`${label}: ${items.length}${items.length ? `\n  ${items.join("\n  ")}` : ""}`);

async function main() {
  const { command, options } = readArguments(process.argv.slice(2));
  const { mapDir } = options;
  if (command === "generate" || command === "verify") {
    const summary = await generateMap({ repoRoot: REPO_ROOT, mapDir, warn });
    list("New doors", summary.new_door_ids);
    list("Removed doors", summary.removed_door_ids);
    list("Went stale", summary.stale_case_refs);
    if (command === "verify") {
      const { map, stale_case_refs } = staleMissingEvidence(readMap(mapDir), REPO_ROOT);
      writeMap(mapDir, map);
      list("Stale, evidence gone", stale_case_refs);
    }
  } else if (command === "page") {
    if (options.demoDoorCountPerSector !== null) await writePage({ exportObject: demoExport({ doorCountPerSector: options.demoDoorCountPerSector }), outPath: options.outPath, mapDir });
    else await writePage({ exportPath: options.exportPath ?? join(mapDir, "exports", "map-public.json"), outPath: options.outPath, mapDir });
  } else if (command === "promises") {
    const stored = readPromises(mapDir);
    const problems = promiseProblems(stored);
    if (problems.length) throw new Error(`The promises have problems:\n  ${problems.join("\n  ")}`);
    const refreshed = refreshPromises({ stored, repoRoot: REPO_ROOT });
    if (!options.isCheck) writePromises(mapDir, refreshed);
    for (const summary of promiseSummaries(refreshed)) console.log(`${summary.rollout_position}. ${summary.sector_id}: ${summary.promise_line}\n   ${summary.way_count} ways (${Object.entries(summary.way_count_by_priority).map(([priority, wayCount]) => `${priority} ${wayCount}`).join(", ")})`);
    list("Stale", promiseSummaries(refreshed).flatMap((summary) => summary.stale_refs));
  } else if (command === "seed") {
    list("Seeded robust", seedMapDir({ repoRoot: REPO_ROOT, mapDir }));
  } else if (command === "review-start") {
    console.log(JSON.stringify(await startReview({ repoRoot: REPO_ROOT, mapDir, date: options.date, warn }), null, 2));
  } else if (command === "review-finish") {
    console.log(JSON.stringify(finishReview({ repoRoot: REPO_ROOT, mapDir, night: JSON.parse(readFileSync(options.fromText, "utf8")), now: new Date().toISOString(), date: options.date, isAgain: options.isAgain }), null, 2));
  } else if (command === "review-steps") {
    console.log(JSON.stringify(reviewStepCountOf(mapDir, { fromDate: options.fromText, toDate: options.toText }), null, 2));
  } else if (options.isCheck) {
    const problems = checkMapDirExport({ mapDir });
    if (problems.length) throw new Error(`The public export leaks: ${problems.join("; ")}.`);
    console.log("The public export carries nothing private.");
  } else {
    const exported = exportMapDir({ mapDir, date: options.date });
    for (const sector of exported.sectors) console.log(`${sector.sector_name}: ${sector.coverage_pct}% (${sector.done_case_count} of ${sector.case_count} cases, ${sector.door_count} doors)`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
