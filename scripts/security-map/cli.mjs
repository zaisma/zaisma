#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writePage } from "./build-page.mjs";
import { checkMapDirExport, exportMapDir } from "./export-public.mjs";
import { chains, NIGHTLY_CASE_BUDGET, pickFrontier } from "./frontier.mjs";
import { defaultMapDir, generateMap, readMap, staleMissingEvidence, writeMap } from "./generate.mjs";
import { demoExport } from "./page/demo-export.mjs";
import { seedMapDir } from "./seed-robust.mjs";

/**
 * The security map's commands (the security-map skill says when each runs):
 *
 *   node scripts/security-map/cli.mjs generate   refresh doors from the code; changed code makes verdicts stale
 *   node scripts/security-map/cli.mjs seed       set robust what the repo's tests and ship checks prove
 *   node scripts/security-map/cli.mjs frontier   tonight's cases: stale, the recheck sample, then unexplored
 *   node scripts/security-map/cli.mjs chains     leak-then-use pairs not tried yet
 *   node scripts/security-map/cli.mjs export     write exports/map-public.json (--check re-checks it)
 *   node scripts/security-map/cli.mjs page       build the Security map page from the export (--out <path>, --export <path> or --demo <doors per sector>)
 *   node scripts/security-map/cli.mjs verify     generate, then stale any case whose cited test is gone
 *
 * Options: --map-dir <path> (default ZAISMA_SECURITY_DIR, then ~/zaisma-private/security),
 * --budget <cases> (frontier, default 40), --date <YYYY-MM-DD> (frontier and export, default today in UTC).
 */

const REPO_ROOT = join(import.meta.dirname, "../..");
const COMMANDS = ["generate", "seed", "frontier", "chains", "export", "verify", "page"];

function readArguments(argv) {
  const [command, ...rest] = argv;
  const options = { mapDir: defaultMapDir(), budgetCaseCount: NIGHTLY_CASE_BUDGET, date: new Date().toISOString().slice(0, 10), isCheck: false, outPath: null, exportPath: null, demoDoorCountPerSector: null };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === "--check") options.isCheck = true;
    else if (flag === "--map-dir") options.mapDir = rest[++index];
    else if (flag === "--budget") options.budgetCaseCount = Number(rest[++index]);
    else if (flag === "--date") options.date = rest[++index];
    else if (flag === "--out") options.outPath = rest[++index];
    else if (flag === "--export") options.exportPath = rest[++index];
    else if (flag === "--demo") options.demoDoorCountPerSector = Number(rest[++index]);
    else throw new Error(`Unknown option ${flag}. Options: --map-dir <path>, --budget <cases>, --date <YYYY-MM-DD>, --check (export), --out <path>, --export <path>, --demo <doors per sector> (page).`);
  }
  if (!COMMANDS.includes(command)) throw new Error(`Say one of: ${COMMANDS.join(", ")}.`);
  if (!Number.isInteger(options.budgetCaseCount) || options.budgetCaseCount < 1) throw new Error("--budget is a whole number of cases, like 40.");
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
  } else if (command === "seed") {
    list("Seeded robust", seedMapDir({ repoRoot: REPO_ROOT, mapDir }));
  } else if (command === "frontier") {
    console.log(JSON.stringify(pickFrontier(readMap(mapDir), { date: options.date, budgetCaseCount: options.budgetCaseCount }), null, 2));
  } else if (command === "chains") {
    const triedPath = join(mapDir, "chains-tried.json");
    console.log(JSON.stringify(chains(readMap(mapDir), existsSync(triedPath) ? JSON.parse(readFileSync(triedPath, "utf8")) : []), null, 2));
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
