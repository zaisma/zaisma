// Reads docs/ROADMAP.md: Now (its First and Next parts), the phases with their gates, and every slice with
// the group, area and phase it belongs to. Shared by scripts/roadmap-slice.mjs and the roadmap test.

const firstLabel = /^\*\*First:\*\*\s*(.*)$/;
const nextLabel = /^\*\*Next:\*\*\s*(.*)$/;
const goalLabel = /^\*\*Goal:\*\*\s*(.*)$/;
const reachedLabel = /^\*\*Reached:\*\*\s*(.*)$/;
const gatesLabel = /^\*\*Gates:\*\*\s*(.*)$/;
const nowEntry = /^\d+\.\s+(.+?)(?:\s+\((.+)\))?$/;
const phaseHeading = /^### Phase (\d+): (.+)$/;

/** The `##` sections that aren't groups of areas. */
const SECTIONS = new Set(["Now", "Phases", "How to read this"]);

/** Where a slice sits when it isn't on the timeline yet. */
export const LATER = "Later";

/** Slice names in a "**First:** a, b" line; "nothing" or an empty line is none. */
function namesAfterLabel(rest) {
  const trimmed = rest.trim().replace(/\.$/, "");
  if (!trimmed || trimmed.toLowerCase() === "nothing") return [];
  return trimmed.split(",").map((name) => name.trim()).filter(Boolean);
}

/** A slice's Needs cell as names. */
export const needsOf = (slice) => slice.needs.split(",").map((name) => name.trim()).filter(Boolean);

/**
 * @param {string} text the whole of docs/ROADMAP.md
 * @returns {{
 *   nowSlices: { name: string, part: "first" | "next" }[],
 *   phases: { number: number, name: string, goal: string, reachedOn: string, gateSliceNames: string[] }[],
 *   groups: { title: string, intro: string, areas: object[] }[],
 *   areas: { title: string, group: string, goal: string, firstSliceNames: string[] }[],
 *   slices: { group: string, area: object, phase: string, status: string, mustOrNice: string, isSettled: boolean, name: string, needs: string, notes: string }[],
 * }}
 */
export function parseRoadmap(text) {
  const nowSlices = [];
  const phases = [];
  const groups = [];
  const areas = [];
  const slices = [];

  let section = "";
  let part = "next";
  let phase = null;
  let group = null;
  let area = null;
  let header = null;
  for (const line of text.split("\n")) {
    if (/^## /.test(line)) {
      section = line.slice(3).trim();
      phase = null; area = null; header = null;
      group = SECTIONS.has(section) ? null : { title: section, intro: "", areas: [] };
      if (group) groups.push(group);
      continue;
    }

    if (section === "Now") {
      const first = line.match(firstLabel);
      if (first) { part = "first"; for (const name of namesAfterLabel(first[1])) nowSlices.push({ name, part }); continue; }
      if (nextLabel.test(line)) { part = "next"; continue; }
      const entry = line.match(nowEntry);
      if (entry) nowSlices.push({ name: entry[1], part });
      continue;
    }

    if (section === "Phases") {
      const heading = line.match(phaseHeading);
      if (heading) { phase = { number: Number(heading[1]), name: heading[2].trim(), goal: "", reachedOn: "", gateSliceNames: [] }; phases.push(phase); continue; }
      if (/^### /.test(line)) { phase = null; continue; }
      if (!phase) continue;
      const goal = line.match(goalLabel);
      if (goal) phase.goal = goal[1].trim();
      const reached = line.match(reachedLabel);
      // "**Reached:** Oct 11, 2026, live on zaisma.com." keeps the date.
      if (reached) phase.reachedOn = reached[1].match(/[A-Z][a-z]{2} \d{1,2}, \d{4}/)?.[0] ?? reached[1].trim();
      const gates = line.match(gatesLabel);
      if (gates) phase.gateSliceNames.push(...namesAfterLabel(gates[1]));
      continue;
    }

    if (!group) continue;
    if (/^### /.test(line)) {
      area = { title: line.slice(4).trim(), group: group.title, goal: "", firstSliceNames: [] };
      group.areas.push(area); areas.push(area); header = null;
      continue;
    }
    if (!line.startsWith("|")) {
      header = null;
      if (!area) { if (line.trim() && !group.intro) group.intro = line.trim(); continue; }
      const goal = line.match(goalLabel);
      if (goal) area.goal = goal[1].trim();
      const first = line.match(firstLabel);
      if (first) area.firstSliceNames.push(...namesAfterLabel(first[1]));
      continue;
    }
    if (!area) continue;
    const cells = line.slice(1, -1).split("|").map((cell) => cell.trim());
    if (cells.every((cell) => /^-+$/.test(cell))) continue;
    if (!header) { header = cells.map((cell) => cell.toLowerCase()); continue; }
    const get = (key) => cells[header.indexOf(key)] ?? "";
    // "Item" is the name column's old title: another worktree may still have the old file.
    slices.push({ group: group.title, area, phase: get("phase"), status: get("status"), mustOrNice: get("must/nice"), isSettled: get("settled").toLowerCase() === "yes", name: get("slice") || get("item"), needs: get("needs"), notes: get("notes") });
  }

  return { nowSlices, phases, groups, areas, slices };
}

const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

/** Slices a person does (named "Julius: …" or "Gleb: …") have no design to settle. */
export const isPersonSlice = (slice) => /^(Julius|Gleb):/.test(slice.name);

/** Done slices that were built without being settled: not checked off until Julius settles them. */
export function unsettledDoneSlices(roadmap) {
  return roadmap.slices.filter((slice) => slice.status === "done" && !slice.isSettled && !isPersonSlice(slice));
}

/** The slice with this exact name, or undefined. */
export function findSlice(roadmap, name) {
  return roadmap.slices.find((slice) => sameName(slice.name, name));
}

/** The phase a slice counts toward, or undefined for a slice in Later. */
export function phaseOf(roadmap, slice) {
  return roadmap.phases.find((phase) => sameName(phase.name, slice.phase));
}

/** "Phase 1: Beta", or "Later". */
export const phaseLabel = (phase) => phase ? `Phase ${phase.number}: ${phase.name}` : LATER;

/** The first phase not reached yet: the one being worked on. */
export function currentPhase(roadmap) {
  return roadmap.phases.find((phase) => !phase.reachedOn);
}

/** Every slice a slice needs, directly or through its Needs' Needs, once each. */
export function neededSlices(roadmap, slice) {
  const seen = new Map();
  const walk = (name) => {
    const needed = findSlice(roadmap, name);
    if (!needed || seen.has(needed.name)) return;
    seen.set(needed.name, needed);
    needsOf(needed).forEach(walk);
  };
  needsOf(slice).forEach(walk);
  return [...seen.values()];
}

/**
 * How far a phase is: its must slices done, and for each gate the slices it needs, done.
 * @returns {{ mustDoneCount: number, mustCount: number, gates: { name: string, doneCount: number, count: number }[] }}
 */
export function phaseProgress(roadmap, phase) {
  const must = roadmap.slices.filter((slice) => sameName(slice.phase, phase.name) && /must/i.test(slice.mustOrNice));
  const gates = phase.gateSliceNames.map((name) => {
    const gate = findSlice(roadmap, name);
    const needed = gate ? [...neededSlices(roadmap, gate), gate] : [];
    return { name, doneCount: needed.filter((slice) => slice.status === "done").length, count: needed.length };
  });
  return { mustDoneCount: must.filter((slice) => slice.status === "done").length, mustCount: must.length, gates };
}

/**
 * What has to land before this slice can start, beyond its own Needs: First slices in Now, then its
 * area's First slices. A First slice never waits on the others in its own First list.
 * @returns {{ name: string, status: string, gate: "now" | "area" }[]}
 */
export function firstBlockers(roadmap, slice) {
  const statusOf = (name) => findSlice(roadmap, name)?.status ?? "no such slice";
  const blockers = [];
  const nowFirst = roadmap.nowSlices.filter((entry) => entry.part === "first").map((entry) => entry.name);
  if (!nowFirst.some((name) => sameName(name, slice.name))) {
    for (const name of nowFirst) if (statusOf(name) !== "done") blockers.push({ name, status: statusOf(name), gate: "now" });
  }
  const areaFirst = slice.area.firstSliceNames ?? [];
  if (!areaFirst.some((name) => sameName(name, slice.name))) {
    for (const name of areaFirst) if (statusOf(name) !== "done") blockers.push({ name, status: statusOf(name), gate: "area" });
  }
  return blockers;
}

/** Names in Now, in First and Gates lines and in Needs that aren't a slice on the roadmap. */
export function unknownNames(roadmap) {
  const named = [
    ...roadmap.nowSlices.map((entry) => entry.name),
    ...roadmap.areas.flatMap((area) => area.firstSliceNames),
    ...roadmap.phases.flatMap((phase) => phase.gateSliceNames),
    ...roadmap.slices.flatMap(needsOf),
  ];
  return [...new Set(named.filter((name) => !findSlice(roadmap, name)))];
}
