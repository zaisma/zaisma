import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readMap } from "./generate.mjs";
import { coveragePctOf, DONE_STATUSES, hasOpenFinding, SEVERITY_TIERS, STATUSES_WITH_EVIDENCE } from "./schema.mjs";

/**
 * exports/map-public.json: the only thing the Security map page reads, sanitised so it can carry nothing
 * private. A hole's door id would point at the hole, so a door with an open finding (a hole, or a stale
 * case that was one) is left out of its sector's doors entirely and counted only in hole_count_by_tier;
 * it comes back once its case is fixed. A door covered by a hidden one (an MCP tool over that API call)
 * is left out the same way, since it names it. Findings, anchors and verdict hashes are never exported, and
 * evidence only for robust, weak and fixed cases.
 *
 * "Since last night" compares with exports/history/<date>.json, a small index of the sanitised statuses
 * kept for HISTORY_KEEP_DAY_COUNT days, so a daytime re-export doesn't wipe a night's changes.
 */

export const EXPORT_FORMAT_VERSION = 1;
export const HISTORY_KEEP_DAY_COUNT = 14;

const EXPORTED_CASE_FIELDS = ["case_id", "case_name", "status", "severity_tier", "last_checked_at", "evidence", "stale_reason", "cases"];
const EXPORTED_DOOR_FIELDS = ["door_id", "door_name", "door_kind", "covered_by_door_id", "door_removed_at", "cases"];
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A case and every case nested in it. */
const casesWithNested = (cases) => cases.flatMap((theCase) => [theCase, ...casesWithNested(theCase.cases ?? [])]);

const hasOpenHole = (theCase) => theCase.status === "hole" || hasOpenFinding(theCase);

/** Door ids the export leaves out: those with an open finding, and those covered by one. */
function hiddenDoorIds(map) {
  const doors = map.flatMap((sector) => sector.doors);
  const hidden = new Set(doors.filter((door) => casesWithNested(door.cases).some(hasOpenHole)).map((door) => door.door_id));
  for (const door of doors) if (door.covered_by_door_id && hidden.has(door.covered_by_door_id)) hidden.add(door.door_id);
  return hidden;
}

function exportedCase(theCase) {
  const exported = {
    case_id: theCase.case_id,
    case_name: theCase.case_name,
    status: theCase.status,
    severity_tier: theCase.severity_tier ?? null,
    last_checked_at: theCase.verdict_at ?? null,
    evidence: STATUSES_WITH_EVIDENCE.includes(theCase.status) ? theCase.evidence : null,
    stale_reason: theCase.status === "stale" ? (theCase.stale_reason ?? null) : null,
  };
  if (theCase.cases?.length) exported.cases = theCase.cases.map(exportedCase);
  return exported;
}

/** "<case_id>" for a top-level case, "<case_id>/<nested case_id>" for one inside it, each with its case. */
function caseEntriesOf(cases, prefix = "") {
  return cases.flatMap((theCase) => {
    const key = `${prefix}${theCase.case_id}`;
    return [[key, theCase], ...caseEntriesOf(theCase.cases ?? [], `${key}/`)];
  });
}

/** The sanitised statuses and per-sector hole counts of an export: what a later export compares with. */
export function historyIndexOf(exported) {
  const caseStatusByDoor = {};
  const holeCountByTierBySector = {};
  for (const sector of exported.sectors) {
    holeCountByTierBySector[sector.sector_id] = { ...sector.hole_count_by_tier };
    for (const door of sector.doors) caseStatusByDoor[door.door_id] = Object.fromEntries(caseEntriesOf(door.cases).map(([key, theCase]) => [key, theCase.status]));
  }
  return { generated_at: exported.generated_at, case_status_by_door: caseStatusByDoor, hole_count_by_tier_by_sector: holeCountByTierBySector };
}

/** What changed since the baseline index, from the exported (sanitised) sectors only; empty lists with no baseline. */
export function sinceLastNightOf(sectors, baseline) {
  const sinceLastNight = { baseline_generated_at: baseline?.generated_at ?? null, explored_cases: [], stale_cases: [], new_doors: [] };
  if (!baseline) return sinceLastNight;
  for (const sector of sectors) {
    for (const door of [...sector.doors].sort((first, second) => (first.door_id < second.door_id ? -1 : first.door_id > second.door_id ? 1 : 0))) {
      const before = baseline.case_status_by_door?.[door.door_id];
      const entries = caseEntriesOf(door.cases).sort(([first], [second]) => (first < second ? -1 : first > second ? 1 : 0));
      if (!before && !entries.some(([, theCase]) => theCase.status === "fixed")) sinceLastNight.new_doors.push({ sector_id: sector.sector_id, door_id: door.door_id, door_name: door.door_name, door_kind: door.door_kind });
      for (const [key, theCase] of entries) {
        const was = before?.[key];
        if (STATUSES_WITH_EVIDENCE.includes(theCase.status) && theCase.status !== was) sinceLastNight.explored_cases.push({ sector_id: sector.sector_id, door_id: door.door_id, case_id: key, case_name: theCase.case_name, status: theCase.status });
        if (theCase.status === "stale" && was !== "stale") sinceLastNight.stale_cases.push({ sector_id: sector.sector_id, door_id: door.door_id, case_id: key, case_name: theCase.case_name, stale_reason: theCase.stale_reason });
      }
    }
  }
  return sinceLastNight;
}

/** `baseline` is a history index (historyIndexOf of an earlier export), or null. */
export function exportPublic(map, { now, baseline = null }) {
  const hidden = hiddenDoorIds(map);
  const sectors = map.map((sector) => {
    const doors = sector.doors.filter((door) => !door.door_removed_at);
    const cases = doors.flatMap((door) => door.cases);
    const holeCountByTier = Object.fromEntries(SEVERITY_TIERS.map((tier) => [tier, 0]));
    for (const theCase of casesWithNested(cases)) if (hasOpenHole(theCase) && theCase.severity_tier in holeCountByTier) holeCountByTier[theCase.severity_tier] += 1;
    const baselineHoleCounts = baseline ? baseline.hole_count_by_tier_by_sector?.[sector.sector_id] : null;
    return {
      sector_id: sector.sector_id,
      sector_name: sector.sector_name,
      attacker_goal: sector.attacker_goal,
      coverage_pct: coveragePctOf(cases),
      door_count: doors.length,
      case_count: cases.length,
      done_case_count: cases.filter((theCase) => DONE_STATUSES.includes(theCase.status)).length,
      hole_count_by_tier: holeCountByTier,
      hole_count_by_tier_at_baseline: baseline ? Object.fromEntries(SEVERITY_TIERS.map((tier) => [tier, baselineHoleCounts?.[tier] ?? 0])) : null,
      doors: doors
        .filter((door) => !hidden.has(door.door_id))
        .sort((first, second) => (first.door_id < second.door_id ? -1 : first.door_id > second.door_id ? 1 : 0))
        .map((door) => ({
          door_id: door.door_id,
          door_name: door.door_name,
          door_kind: door.door_kind,
          covered_by_door_id: door.covered_by_door_id ?? null,
          door_removed_at: door.door_removed_at ?? null,
          cases: door.cases.map(exportedCase),
        })),
    };
  });
  return { export_format_version: EXPORT_FORMAT_VERSION, generated_at: now, sectors, since_last_night: sinceLastNightOf(sectors, baseline) };
}

/**
 * What in an export breaks the sanitiser's rule; [] when nothing does. Given the map it came from, it also
 * checks that no hidden door, finding or case id is anywhere in the text.
 */
export function publicExportProblems(exported, map = null) {
  const problems = [];
  if (exported?.export_format_version !== EXPORT_FORMAT_VERSION) problems.push(`export_format_version is ${JSON.stringify(exported?.export_format_version)}, not ${EXPORT_FORMAT_VERSION}`);
  const sectors = Array.isArray(exported?.sectors) ? exported.sectors : [];
  if (map) {
    const text = JSON.stringify(exported);
    for (const doorId of hiddenDoorIds(map)) if (text.includes(JSON.stringify(doorId))) problems.push(`the door ${doorId}, which has or is covered by an open finding, is in the export`);
    for (const door of map.flatMap((sector) => sector.doors)) {
      for (const theCase of casesWithNested(door.cases)) if (theCase.finding_id && text.includes(theCase.finding_id)) problems.push(`the finding ${theCase.finding_id} is in the export`);
    }
  }
  const doorIds = new Set();
  const doors = sectors.flatMap((sector) => sector.doors ?? []);
  for (const door of doors) {
    if (doorIds.has(door.door_id)) problems.push(`the door id ${door.door_id} is in the export twice`);
    doorIds.add(door.door_id);
  }
  const checkCases = (door, cases, path) => {
    for (const theCase of cases) {
      const label = `${door.door_id}#${path}${theCase.case_id}`;
      if (theCase.status === "hole") problems.push(`${door.door_id} shows a hole case`);
      const extra = Object.keys(theCase).filter((field) => !EXPORTED_CASE_FIELDS.includes(field));
      if (extra.length) problems.push(`${label} exports ${extra.join(", ")}`);
      if (theCase.evidence && !STATUSES_WITH_EVIDENCE.includes(theCase.status)) problems.push(`${label} exports evidence while ${theCase.status}`);
      checkCases(door, theCase.cases ?? [], `${path}${theCase.case_id}/`);
    }
  };
  for (const door of doors) {
    const extra = Object.keys(door).filter((field) => !EXPORTED_DOOR_FIELDS.includes(field));
    if (extra.length) problems.push(`${door.door_id} exports ${extra.join(", ")}`);
    if (door.covered_by_door_id && !doorIds.has(door.covered_by_door_id)) problems.push(`${door.door_id} is covered by ${door.covered_by_door_id}, which isn't in the export`);
    checkCases(door, door.cases ?? [], "");
  }
  return problems;
}

const exportPathOf = (mapDir) => join(mapDir, "exports", "map-public.json");
const historyDirOf = (mapDir) => join(mapDir, "exports", "history");
const defaultDate = () => new Date().toISOString().slice(0, 10);

/** The newest history index dated strictly before `date`, or null. */
function readBaseline(mapDir, date) {
  const directory = historyDirOf(mapDir);
  if (!existsSync(directory)) return null;
  const days = readdirSync(directory).map((name) => name.replace(/\.json$/, "")).filter((name) => DAY_PATTERN.test(name) && name < date).sort();
  const newest = days.at(-1);
  return newest ? JSON.parse(readFileSync(join(directory, `${newest}.json`), "utf8")) : null;
}

/** Writes today's history index and deletes the ones dated more than HISTORY_KEEP_DAY_COUNT days before `date`. */
function writeHistory(mapDir, date, exported) {
  const directory = historyDirOf(mapDir);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${date}.json`), `${JSON.stringify(historyIndexOf(exported), null, 2)}\n`);
  const oldestKept = new Date(`${date}T00:00:00Z`);
  oldestKept.setUTCDate(oldestKept.getUTCDate() - HISTORY_KEEP_DAY_COUNT);
  const oldestKeptDay = oldestKept.toISOString().slice(0, 10);
  for (const name of readdirSync(directory)) {
    const day = name.replace(/\.json$/, "");
    if (DAY_PATTERN.test(day) && day < oldestKeptDay) rmSync(join(directory, name));
  }
}

/** Writes mapDir's export and checks it; throws when the check fails, so nothing unsafe is left to publish. */
export function exportMapDir({ mapDir, now = new Date().toISOString(), date = defaultDate() }) {
  const map = readMap(mapDir);
  const exported = exportPublic(map, { now, baseline: readBaseline(mapDir, date) });
  const problems = publicExportProblems(exported, map);
  if (problems.length) throw new Error(`The public export would leak: ${problems.join("; ")}.`);
  mkdirSync(join(mapDir, "exports"), { recursive: true });
  writeFileSync(exportPathOf(mapDir), `${JSON.stringify(exported, null, 2)}\n`);
  writeHistory(mapDir, date, exported);
  return exported;
}

/** Re-reads mapDir's written export and checks it against the map (export --check). */
export function checkMapDirExport({ mapDir }) {
  return publicExportProblems(JSON.parse(readFileSync(exportPathOf(mapDir), "utf8")), readMap(mapDir));
}
