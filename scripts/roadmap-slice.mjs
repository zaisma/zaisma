#!/usr/bin/env node
// One roadmap slice with what's needed to start it, read from GitHub's main (run `git fetch origin` first).
//   node scripts/roadmap-slice.mjs            the first slice in Now that's free to start
//   node scripts/roadmap-slice.mjs 2          the second slice in Now
//   node scripts/roadmap-slice.mjs "Game database console"   any slice, by its exact name
//   node scripts/roadmap-slice.mjs --now      every slice in Now: settled or not, free to start or what it waits on
//   node scripts/roadmap-slice.mjs --phases   each phase: reached or how far, with its gates
//   node scripts/roadmap-slice.mjs --unsettled   done slices built without being settled, by area
// Prints the slice's row, whether it's settled, its area and goal, its phase, whether its Needs and the
// First slices before it are done, whether another worktree has claimed it, and the area's other slices.
// Exits 1 when Now is empty or the slice isn't on the roadmap, 2 when the slice has to wait.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { currentPhase, findSlice, firstBlockers, needsOf, parseRoadmap, phaseLabel, phaseOf, phaseProgress, unsettledDoneSlices } from "./roadmap.mjs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const roadmap = parseRoadmap(git("show", "origin/main:docs/ROADMAP.md"));
const { nowSlices } = roadmap;

/** Slices marked `doing` in another worktree's roadmap but not on main: another session has started them. */
function claimsInOtherWorktrees() {
  const here = resolve(git("rev-parse", "--show-toplevel").trim());
  const claims = new Map();
  for (const line of git("worktree", "list", "--porcelain").split("\n")) {
    if (!line.startsWith("worktree ")) continue;
    const worktreePath = resolve(line.slice("worktree ".length));
    const roadmapPath = join(worktreePath, "docs/ROADMAP.md");
    if (worktreePath === here || !existsSync(roadmapPath)) continue;
    for (const slice of parseRoadmap(readFileSync(roadmapPath, "utf8")).slices) {
      const onMain = findSlice(roadmap, slice.name);
      if (slice.status === "doing" && onMain && onMain.status !== "doing" && onMain.status !== "done") claims.set(slice.name.toLowerCase(), worktreePath);
    }
  }
  return claims;
}

const claims = claimsInOtherWorktrees();
const statusOf = (name) => findSlice(roadmap, name)?.status ?? "no such slice";
const isFree = (slice) =>
  slice.status !== "done" && slice.status !== "doing" && !claims.has(slice.name.toLowerCase()) &&
  firstBlockers(roadmap, slice).length === 0 && needsOf(slice).every((need) => statusOf(need) === "done");
const whereOf = (slice) => `${slice.group} > ${slice.area.title}, ${phaseLabel(phaseOf(roadmap, slice))}`;
const nowEmpty = "Now is empty: nothing is lined up. Use the whats-next skill to propose what comes next.";

/** Why a slice can't start yet, as plain lines; empty when it's free. */
function waitsOf(slice) {
  const claim = claims.get(slice.name.toLowerCase());
  return [
    ...(slice.status === "done" ? ["it's done"] : []),
    ...(slice.status === "doing" ? ["it's marked doing on main"] : []),
    ...firstBlockers(roadmap, slice).map((blocker) => `${blocker.name} (${blocker.status}) is First ${blocker.gate === "now" ? "in Now" : "in its area"}: it lands before this starts`),
    ...needsOf(slice).filter((need) => statusOf(need) !== "done").map((need) => `${need} (${statusOf(need)}) is in its Needs`),
    ...(claim ? [`another session has started it: marked doing in ${claim}`] : []),
  ];
}

if (process.argv[2] === "--now") {
  if (!nowSlices.length) { console.log(nowEmpty); process.exit(1); }
  for (const [i, entry] of nowSlices.entries()) {
    const slice = findSlice(roadmap, entry.name);
    if (!slice) { console.log(`${i + 1}. ${entry.name}: no such slice`); continue; }
    const waits = waitsOf(slice);
    console.log(`${i + 1}. ${slice.name}  [${slice.isSettled ? "settled" : "not settled"}] ${waits.length ? `waits: ${waits.join("; ")}` : "free to start"}`);
  }
  process.exit(0);
}

if (process.argv[2] === "--phases") {
  const current = currentPhase(roadmap);
  for (const phase of roadmap.phases) {
    const progress = phaseProgress(roadmap, phase);
    const state = phase.reachedOn ? `reached ${phase.reachedOn}` : `${progress.mustDoneCount} of ${progress.mustCount} must slices done${phase === current ? " (current)" : ""}`;
    console.log(`${phaseLabel(phase)}: ${state}`);
    for (const gate of progress.gates) console.log(`  gate ${gate.name}: ${gate.doneCount} of ${gate.count} done (with what it needs)`);
  }
  const later = roadmap.slices.filter((slice) => !phaseOf(roadmap, slice));
  console.log(`Later: ${later.length} slices not on the timeline yet`);
  process.exit(0);
}

if (process.argv[2] === "--unsettled") {
  const slices = unsettledDoneSlices(roadmap);
  if (!slices.length) console.log("Every done slice is settled.");
  let area = null;
  for (const slice of slices) {
    if (slice.area !== area) { area = slice.area; console.log(`${slice.group} > ${area.title}`); }
    console.log(`  ${slice.name}`);
  }
  process.exit(0);
}

const asked = process.argv.slice(2).join(" ").trim();
let name = asked;
if (!asked || /^\d+$/.test(asked)) {
  if (!nowSlices.length) { console.log(nowEmpty); process.exit(1); }
  if (!asked) {
    const free = nowSlices.find((entry) => { const slice = findSlice(roadmap, entry.name); return slice && isFree(slice); });
    if (!free) {
      console.log("Every slice in Now is done, started, claimed in another worktree or waiting on a First slice:");
      for (const [i, entry] of nowSlices.entries()) {
        const claim = claims.get(entry.name.toLowerCase());
        console.log(`  ${i + 1}. ${entry.name}  (${statusOf(entry.name)}${claim ? `, claimed in ${claim}` : ""})`);
      }
      process.exit(2);
    }
    name = free.name;
  } else {
    name = nowSlices[Number(asked) - 1]?.name;
    if (!name) {
      console.log(`Now has ${nowSlices.length} slice${nowSlices.length === 1 ? "" : "s"}: ${nowSlices.map((entry, i) => `${i + 1}. ${entry.name}`).join("  ")}`);
      process.exit(1);
    }
  }
}

const slice = findSlice(roadmap, name);
if (!slice) {
  const close = roadmap.slices.filter((candidate) => candidate.name.toLowerCase().includes(name.toLowerCase())).map((candidate) => candidate.name);
  console.log(`No roadmap slice is named "${name}".${close.length ? ` Close: ${close.join("; ")}` : ""}`);
  process.exit(1);
}

const needs = needsOf(slice);
const nowPlace = nowSlices.findIndex((entry) => entry.name.toLowerCase() === slice.name.toLowerCase());
const blockers = firstBlockers(roadmap, slice);
const claim = claims.get(slice.name.toLowerCase());
const phase = phaseOf(roadmap, slice);

console.log(`Slice: ${slice.name}${nowPlace >= 0 ? `  (Now #${nowPlace + 1} of ${nowSlices.length}, ${nowSlices[nowPlace].part === "first" ? "First" : "Next"})` : "  (not in Now)"}`);
console.log(`Status: ${slice.status}${slice.mustOrNice ? `, ${slice.mustOrNice}` : ""}`);
console.log(`Settled: ${
  slice.isSettled ? "yes: talked through with Julius, so it's ready to build and its PR merges without him (a preview still needs his OK)"
  : slice.status === "done" ? "no: built without being settled; it isn't checked off until Julius settles it (talk-through)"
  : "no: talk its design and scope through with Julius first (talk-through)"
}`);
console.log(`Where: ${whereOf(slice)}`);
if (slice.area.goal) console.log(`Area goal: ${slice.area.goal}`);
console.log(phase ? `Phase goal: ${phase.goal}` : "Phase: Later, not on the timeline yet");
console.log(`Needs: ${needs.length ? needs.map((need) => `${need} (${statusOf(need)})`).join(", ") : "nothing"}`);
console.log(`Notes: ${slice.notes || "(none)"}`);
const others = roadmap.slices.filter((candidate) => candidate.area === slice.area && candidate !== slice);
if (others.length) {
  console.log("Other slices in the area:");
  for (const other of others) console.log(`  ${other.status.padEnd(8)} ${other.phase.padEnd(6)} ${other.name}`);
}

const waits = [
  ...blockers.map((blocker) => `${blocker.name} (${blocker.status}) is First ${blocker.gate === "now" ? "in Now" : "in its area"}: it lands before this starts`),
  ...needs.filter((need) => statusOf(need) !== "done").map((need) => `${need} (${statusOf(need)}) is in its Needs`),
  ...(claim ? [`another session has started it: marked doing in ${claim}`] : []),
];
if (waits.length) {
  console.log("Waits:");
  for (const wait of waits) console.log(`  ${wait}`);
  process.exit(2);
}
