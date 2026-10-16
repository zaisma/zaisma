#!/usr/bin/env node
// One roadmap item with what's needed to start it, read from GitHub's main (run `git fetch origin` first).
//   node scripts/roadmap-item.mjs            the first item in Now that's free to start
//   node scripts/roadmap-item.mjs 2          the second item in Now
//   node scripts/roadmap-item.mjs "Game database"   any item, by its exact name
//   node scripts/roadmap-item.mjs --now      every item in Now: settled or not, free to start or what it waits on
// Prints the item's row, whether it's settled, its project's goal and "Done when", whether its Needs
// and the First items before it are done, whether another worktree has claimed it, and the project's
// other rows. Exits 1 when Now is empty or the item isn't on the roadmap, 2 when the item has to wait.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { findRow, firstBlockers, parseRoadmap } from "./roadmap.mjs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const roadmap = parseRoadmap(git("show", "origin/main:docs/ROADMAP.md"));
const { nowItems } = roadmap;

/** Items marked `doing` in another worktree's roadmap but not on main: another session has started them. */
function claimsInOtherWorktrees() {
  const here = resolve(git("rev-parse", "--show-toplevel").trim());
  const claims = new Map();
  for (const line of git("worktree", "list", "--porcelain").split("\n")) {
    if (!line.startsWith("worktree ")) continue;
    const worktreePath = resolve(line.slice("worktree ".length));
    const roadmapPath = join(worktreePath, "docs/ROADMAP.md");
    if (worktreePath === here || !existsSync(roadmapPath)) continue;
    for (const row of parseRoadmap(readFileSync(roadmapPath, "utf8")).rows) {
      const onMain = findRow(roadmap, row.name);
      if (row.status === "doing" && onMain && onMain.status !== "doing" && onMain.status !== "done") claims.set(row.name.toLowerCase(), worktreePath);
    }
  }
  return claims;
}

const claims = claimsInOtherWorktrees();
const needsOf = (row) => row.needs.split(",").map((need) => need.trim()).filter(Boolean);
const statusOf = (name) => findRow(roadmap, name)?.status ?? "no such item";
const isFree = (row) =>
  row.status !== "done" && row.status !== "doing" && !claims.has(row.name.toLowerCase()) &&
  firstBlockers(roadmap, row).length === 0 && needsOf(row).every((need) => statusOf(need) === "done");

/** Why a row can't start yet, as plain lines; empty when it's free. */
function waitsOf(row) {
  const claim = claims.get(row.name.toLowerCase());
  return [
    ...(row.status === "done" ? ["it's done"] : []),
    ...(row.status === "doing" ? ["it's marked doing on main"] : []),
    ...firstBlockers(roadmap, row).map((blocker) => `${blocker.name} (${blocker.status}) is First ${blocker.gate === "now" ? "in Now" : "in its project"}: it lands before this starts`),
    ...needsOf(row).filter((need) => statusOf(need) !== "done").map((need) => `${need} (${statusOf(need)}) is in its Needs`),
    ...(claim ? [`another session has started it: marked doing in ${claim}`] : []),
  ];
}

if (process.argv[2] === "--now") {
  if (!nowItems.length) {
    console.log("Now is empty: nothing is lined up. Use the whats-next skill to propose what comes next.");
    process.exit(1);
  }
  for (const [i, item] of nowItems.entries()) {
    const row = findRow(roadmap, item.name);
    if (!row) { console.log(`${i + 1}. ${item.name}: no such item`); continue; }
    const waits = waitsOf(row);
    console.log(`${i + 1}. ${row.name}  [${row.isSettled ? "settled" : "not settled"}] ${waits.length ? `waits: ${waits.join("; ")}` : "free to start"}`);
  }
  process.exit(0);
}

const asked = process.argv.slice(2).join(" ").trim();
let name = asked;
if (!asked || /^\d+$/.test(asked)) {
  if (!nowItems.length) {
    console.log("Now is empty: nothing is lined up. Use the whats-next skill to propose what comes next.");
    process.exit(1);
  }
  if (!asked) {
    const free = nowItems.find((item) => { const row = findRow(roadmap, item.name); return row && isFree(row); });
    if (!free) {
      console.log("Every item in Now is done, started, claimed in another worktree or waiting on a First item:");
      for (const [i, item] of nowItems.entries()) {
        const claim = claims.get(item.name.toLowerCase());
        console.log(`  ${i + 1}. ${item.name}  (${statusOf(item.name)}${claim ? `, claimed in ${claim}` : ""})`);
      }
      process.exit(2);
    }
    name = free.name;
  } else {
    name = nowItems[Number(asked) - 1]?.name;
    if (!name) {
      console.log(`Now has ${nowItems.length} item${nowItems.length === 1 ? "" : "s"}: ${nowItems.map((item, i) => `${i + 1}. ${item.name}`).join("  ")}`);
      process.exit(1);
    }
  }
}

const row = findRow(roadmap, name);
if (!row) {
  const close = roadmap.rows.filter((candidate) => candidate.name.toLowerCase().includes(name.toLowerCase())).map((candidate) => candidate.name);
  console.log(`No roadmap item is named "${name}".${close.length ? ` Close: ${close.join("; ")}` : ""}`);
  process.exit(1);
}

const needs = needsOf(row);
const nowPlace = nowItems.findIndex((item) => item.name.toLowerCase() === row.name.toLowerCase());
const blockers = firstBlockers(roadmap, row);
const claim = claims.get(row.name.toLowerCase());

console.log(`Item: ${row.name}${nowPlace >= 0 ? `  (Now #${nowPlace + 1} of ${nowItems.length}, ${nowItems[nowPlace].part === "first" ? "First" : "Next"})` : "  (not in Now)"}`);
console.log(`Status: ${row.status}${row.mustOrNice ? `, ${row.mustOrNice}` : ""}`);
console.log(`Settled: ${row.isSettled ? "yes: talked through with Julius, so it's ready to build and its PR merges without him (a preview still needs his OK)" : "no: talk its design and scope through with Julius before building; he merges its PR"}`);
console.log(`Where: ${row.phase}${row.project.title ? ` > ${row.project.title}` : ""}`);
if (row.project.intro) console.log(`Project: ${row.project.intro}`);
console.log(`Needs: ${needs.length ? needs.map((need) => `${need} (${statusOf(need)})`).join(", ") : "nothing"}`);
console.log(`Notes: ${row.notes || "(none)"}`);
const others = roadmap.rows.filter((candidate) => candidate.project === row.project && candidate !== row);
if (others.length) {
  console.log("Other rows in the project:");
  for (const other of others) console.log(`  ${other.status.padEnd(8)} ${other.name}`);
}

const waits = [
  ...blockers.map((blocker) => `${blocker.name} (${blocker.status}) is First ${blocker.gate === "now" ? "in Now" : "in its project"}: it lands before this starts`),
  ...needs.filter((need) => statusOf(need) !== "done").map((need) => `${need} (${statusOf(need)}) is in its Needs`),
  ...(claim ? [`another session has started it: marked doing in ${claim}`] : []),
];
if (waits.length) {
  console.log("Waits:");
  for (const wait of waits) console.log(`  ${wait}`);
  process.exit(2);
}
