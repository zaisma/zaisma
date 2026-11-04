#!/usr/bin/env node
// The contract test grid (docs/DOORS.md): every door tried by every kind of caller.
//
//   npm run grid                          Runs it here and prints every failure.
//   npm run grid -- --compare <sha>       GitHub's check: prints and fails only on what this change adds to <sha>.
//   npm run grid -- --record <file>       Writes every failure to <file>, for a private repository to keep. Prints only counts.
//   npm run grid -- --results <file>      Writes every cell to <file> and prints nothing. What --compare runs on the base.
//
// A public check's log is read by anyone, so --compare never prints a cell that's broken on the base too, and the runs it makes
// print nothing at all: only cells this change adds leave this script.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** What decides the grid's own cells: a change to these can name failures the base never tried. */
export const GRID_PATHS = ["test/grid/", "test/site/access-world.ts", "scripts/contract-grid.mjs"];
const LOCAL_COMMAND = "npm run grid -- --compare ";

const cellId = ({ door_id, caller_kind }) => `${door_id} | ${caller_kind}`;
const isFailed = (cell) => cell.cell_verdict !== "kept";

/**
 * What a change adds to the grid, from both runs' results. Only "new_failures" may name its cells: with the grid changed, a
 * new cell may be an old failure tried for the first time, and with a door gone that was failing, a new cell may be the same old
 * failure at the door's new name. So both give only a count; the second still fails, since a real new failure may be among them.
 */
export function compareGridResults({ headResults, baseResults, isGridChanged }) {
  const baseFailed = new Set(baseResults.cells.filter(isFailed).map(cellId));
  const newCells = headResults.cells.filter((cell) => isFailed(cell) && !baseFailed.has(cellId(cell)));
  const newDoorsNotTried = headResults.doors_not_tried.filter((door) => !baseResults.doors_not_tried.includes(door));
  const failureCount = newCells.length + newDoorsNotTried.length;
  if (failureCount === 0) return { outcome: "nothing_new", failure_count: 0, new_cells: [], new_doors_not_tried: [] };
  if (isGridChanged) return { outcome: "count_only_passes", failure_count: failureCount, new_cells: [], new_doors_not_tried: [] };
  const headDoorIds = new Set(headResults.cells.map((cell) => cell.door_id));
  const isFailingDoorGone = baseResults.cells.some((cell) => isFailed(cell) && !headDoorIds.has(cell.door_id));
  if (isFailingDoorGone) return { outcome: "count_only_fails", failure_count: failureCount, new_cells: [], new_doors_not_tried: [] };
  return { outcome: "new_failures", failure_count: failureCount, new_cells: newCells, new_doors_not_tried: newDoorsNotTried };
}

/** What a comparison prints: the one place a cell can reach a public log. */
export function comparisonLines(comparison, baseSha) {
  switch (comparison.outcome) {
    case "nothing_new":
      return ["Contract grid: this change adds nothing."];
    case "count_only_passes":
      return [`Contract grid: this change changes the grid itself, so it's not compared here. Run ${LOCAL_COMMAND}${baseSha} on your own machine.`];
    case "count_only_fails":
      return [`Contract grid: ${comparison.failure_count} new, and a door it can't compare with was renamed or removed. Run ${LOCAL_COMMAND}${baseSha} on your own machine.`];
    case "new_failures":
      return [
        `Contract grid: this change adds ${comparison.failure_count}.`,
        ...comparison.new_cells.map((cell) => `- ${cell.door_id}, as ${cell.caller_kind}: ${cell.problem_line}`),
        ...comparison.new_doors_not_tried.map((door) => `- ${door}: the grid couldn't try it.`),
      ];
  }
}

/** Runs the grid in a checkout and answers its results, or null when the run itself failed. Its output goes nowhere: it can name cells. */
function runGrid(checkout, resultsPath) {
  spawnSync("npx", ["vitest", "run", "--silent", "--reporter=./test/grid/reporter.ts", "--passWithNoTests"], {
    cwd: checkout,
    stdio: "ignore",
    env: { ...process.env, ZAISMA_CONTRACT_GRID: "1", ZAISMA_CONTRACT_GRID_RESULTS: resultsPath },
  });
  return existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, "utf8")) : null;
}

const git = (args, cwd = ROOT) => spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const stop = (line) => {
  console.error(line);
  process.exit(1);
};

/** The grid on the base, from a clean copy of it, or "no_grid" when the base has none yet. */
function runBase(baseSha, temporary) {
  if (git(["cat-file", "-e", `${baseSha}:scripts/contract-grid.mjs`]).status !== 0) return "no_grid";
  const copy = join(temporary, "base");
  if (git(["worktree", "add", "--detach", "--quiet", copy, baseSha]).status !== 0) return null;
  try {
    const isSameLock = git(["diff", "--quiet", baseSha, "HEAD", "--", "package-lock.json"]).status === 0;
    if (isSameLock) symlinkSync(join(ROOT, "node_modules"), join(copy, "node_modules"));
    else if (spawnSync("npm", ["ci", "--no-audit", "--no-fund"], { cwd: copy, stdio: "ignore" }).status !== 0) return null;
    const resultsPath = join(temporary, "base.json");
    spawnSync("node", ["scripts/contract-grid.mjs", "--results", resultsPath], { cwd: copy, stdio: "ignore" });
    return existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, "utf8")) : null;
  } finally {
    git(["worktree", "remove", "--force", copy]);
  }
}

function compare(baseSha) {
  const temporary = mkdtempSync(join(tmpdir(), "contract-grid-"));
  const crashed = `Contract grid: a run didn't finish. Run ${LOCAL_COMMAND}${baseSha} on your own machine.`;
  try {
    let headResults = runGrid(ROOT, join(temporary, "head.json"));
    if (!headResults) stop(crashed);
    // None broken on this change means there's nothing to subtract, so the base needn't run at all.
    if (!headResults.cells.some(isFailed) && headResults.doors_not_tried.length === 0) return console.log(comparisonLines({ outcome: "nothing_new" }, baseSha).join("\n"));
    const baseResults = runBase(baseSha, temporary);
    // Report-only at first: a base with no grid has nothing to compare with, and everything here would look new.
    if (baseResults === "no_grid") return console.log(comparisonLines({ outcome: "nothing_new" }, baseSha).join("\n"));
    if (!baseResults) stop(crashed);
    const isGridChanged = GRID_PATHS.some((path) => git(["diff", "--quiet", baseSha, "HEAD", "--", path]).status !== 0);
    let comparison = compareGridResults({ headResults, baseResults, isGridChanged });
    if (comparison.outcome === "new_failures") {
      // Once more, so a cell that failed by chance isn't new.
      headResults = runGrid(ROOT, join(temporary, "head-again.json"));
      if (!headResults) stop(crashed);
      comparison = compareGridResults({ headResults, baseResults, isGridChanged });
    }
    const lines = comparisonLines(comparison, baseSha).join("\n");
    if (comparison.outcome === "new_failures" || comparison.outcome === "count_only_fails") stop(lines);
    console.log(lines);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function local() {
  const temporary = mkdtempSync(join(tmpdir(), "contract-grid-"));
  try {
    const results = runGrid(ROOT, join(temporary, "results.json"));
    if (!results) stop("Contract grid: the run didn't finish. Run it with ZAISMA_CONTRACT_GRID=1 npx vitest run to see why.");
    const failed = results.cells.filter(isFailed);
    for (const cell of failed) console.log(`- ${cell.door_id}, as ${cell.caller_kind}: ${cell.cell_verdict}. ${cell.problem_line}`);
    for (const door of results.doors_not_tried) console.log(`- ${door}: the grid couldn't try it.`);
    console.log(`Contract grid: ${results.cells.length} cells, ${failed.length} failed, ${results.doors_not_tried.length} doors not tried.`);
    if (failed.length + results.doors_not_tried.length > 0) process.exit(1);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function record(path) {
  const temporary = mkdtempSync(join(tmpdir(), "contract-grid-"));
  try {
    const results = runGrid(ROOT, join(temporary, "results.json"));
    if (!results) stop("Contract grid: the run didn't finish.");
    const commitSha = git(["rev-parse", "HEAD"]).stdout.trim();
    const failures = results.cells.filter(isFailed).sort((first, second) => cellId(first).localeCompare(cellId(second)));
    writeFileSync(resolve(path), `${JSON.stringify({ recorded_at: new Date().toISOString(), commit_sha: commitSha, cell_count: results.cells.length, failures, doors_not_tried: results.doors_not_tried }, null, 1)}\n`);
    console.log(`Contract grid: ${results.cells.length} cells, ${failures.length} failed, ${results.doors_not_tried.length} doors not tried.`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [flag, given] = process.argv.slice(2);
  if (flag === "--compare" && given) compare(given);
  else if (flag === "--record" && given) record(given);
  else if (flag === "--results" && given) {
    if (!runGrid(ROOT, resolve(given))) process.exit(1);
  } else if (!flag) local();
  else stop("Use: npm run grid [-- --compare <sha> | --record <file> | --results <file>]");
}
