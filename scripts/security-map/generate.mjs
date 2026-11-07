import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { anchorHashes } from "./anchors.mjs";
import { collectDoors } from "./doors.mjs";
import { loadSiteModule } from "./load-site.mjs";
import { caseRefOf, orderedCase, SECTORS, unexploredCase, withStale } from "./schema.mjs";

/**
 * Refreshing the map from the code without losing what's known: a door new to the code is added with
 * every case of its kind's checklist unexplored; a known door keeps its cases; a door gone from the code
 * is kept, marked door_removed_at (code comes back, and its past holes matter). Any verdict whose door's
 * code changed since (its anchors' hashes) goes stale and rejoins the night's work. The map's data lives
 * in the private repo (zaisma/security), never this one, so every call takes its directory.
 */

export const CHECKLISTS = JSON.parse(readFileSync(new URL("./checklists.json", import.meta.url), "utf8"));

/** The map's directory: --map-dir, else ZAISMA_SECURITY_DIR, else the private repo's clone at ~/zaisma-private/security. */
export const defaultMapDir = () => process.env.ZAISMA_SECURITY_DIR || join(homedir(), "zaisma-private/security");

/** The map as sectors in SECTORS' order, each with its doors; a sector with no file yet starts empty. */
export function readMap(mapDir) {
  return SECTORS.map((sector) => {
    const filePath = join(mapDir, "map", `${sector.sector_id}.json`);
    const stored = existsSync(filePath) ? JSON.parse(readFileSync(filePath, "utf8")) : { doors: [] };
    return { ...sector, doors: stored.doors ?? [] };
  });
}

/** Writes each sector's file, key-stable and sorted, so a re-run with nothing new changes nothing. */
export function writeMap(mapDir, map) {
  mkdirSync(join(mapDir, "map"), { recursive: true });
  for (const sector of map) {
    const stored = { sector_id: sector.sector_id, sector_name: sector.sector_name, attacker_goal: sector.attacker_goal, doors: [...sector.doors].sort((first, second) => first.door_id.localeCompare(second.door_id)).map(orderedDoor) };
    writeFileSync(join(mapDir, "map", `${sector.sector_id}.json`), `${JSON.stringify(stored, null, 2)}\n`);
  }
}

export function orderedDoor(door) {
  return {
    door_id: door.door_id,
    door_name: door.door_name,
    door_kind: door.door_kind,
    sector_id: door.sector_id,
    source_path: door.source_path,
    anchors: door.anchors.map((anchor) => ({ anchor_id: anchor.anchor_id, source_path: anchor.source_path, symbol_name: anchor.symbol_name, source_hash_sha256: anchor.source_hash_sha256 ?? null })),
    gives: door.gives ?? [],
    trusts: door.trusts ?? [],
    covered_by_door_id: door.covered_by_door_id ?? null,
    stored_value: door.stored_value ?? null,
    door_removed_at: door.door_removed_at ?? null,
    cases: door.cases.map(orderedCase),
  };
}

/** Every door on the map, with its sector. */
export const allDoors = (map) => map.flatMap((sector) => sector.doors);

/** Why a verdict no longer holds for these anchor hashes, or null when the code is identical. */
export function staleReasonOf(verdictAnchorHashes, currentHashes) {
  const reasons = [];
  for (const [anchorId, hash] of Object.entries(currentHashes)) {
    if (hash === null) reasons.push(`${anchorId} is missing from the code`);
    else if (!(anchorId in verdictAnchorHashes)) reasons.push(`the door now relies on ${anchorId} too`);
    else if (verdictAnchorHashes[anchorId] !== hash) reasons.push(`${anchorId} changed`);
  }
  for (const anchorId of Object.keys(verdictAnchorHashes)) if (!(anchorId in currentHashes)) reasons.push(`the door no longer relies on ${anchorId}`);
  return reasons.length ? `${reasons.join("; ")} since the verdict` : null;
}

/** A door's cases: what's known kept, its kind's checklist added unexplored, checklist cases first in their order. */
function mergedCases(kind, knownCases, checklists) {
  const checklist = checklists[kind] ?? [];
  const knownById = new Map(knownCases.map((theCase) => [theCase.case_id, theCase]));
  const fromChecklist = checklist.map((item) => (knownById.has(item.case_id) ? { ...knownById.get(item.case_id), case_name: item.case_name } : unexploredCase(item)));
  const checklistIds = new Set(checklist.map((item) => item.case_id));
  const added = knownCases.filter((theCase) => !checklistIds.has(theCase.case_id)).sort((first, second) => first.case_id.localeCompare(second.case_id));
  return [...fromChecklist, ...added];
}

/**
 * The map merged with the doors in the code now. hashesOf(door) gives { anchor_id: hash or null } for a
 * door's anchors. Pure: answers the new map and what changed ({ new_door_ids, removed_door_ids,
 * stale_case_refs, missing_anchor_ids }).
 */
export function mergeDoors({ map, doors, hashesOf, now, checklists = CHECKLISTS, warn = () => {} }) {
  const knownById = new Map(allDoors(map).map((door) => [door.door_id, door]));
  const summary = { new_door_ids: [], removed_door_ids: [], stale_case_refs: [], missing_anchor_ids: [] };
  const merged = [];
  for (const codeDoor of doors) {
    const known = knownById.get(codeDoor.door_id);
    if (!known) summary.new_door_ids.push(codeDoor.door_id);
    const hashes = hashesOf(codeDoor);
    for (const [anchorId, hash] of Object.entries(hashes)) {
      if (hash !== null || summary.missing_anchor_ids.includes(anchorId)) continue;
      summary.missing_anchor_ids.push(anchorId);
      warn(`Anchor ${anchorId} isn't in the code any more: every verdict that relied on it is stale. Point the door at where the code went (scripts/security-map/doors.mjs).`);
    }
    const cases = mergedCases(codeDoor.door_kind, known?.cases ?? [], checklists).map((theCase) => {
      if (theCase.status === "unexplored" || theCase.status === "stale") return theCase;
      const staleReason = staleReasonOf(theCase.verdict_anchor_hashes ?? {}, hashes);
      if (!staleReason) return theCase;
      summary.stale_case_refs.push(caseRefOf(codeDoor, theCase));
      return withStale(theCase, staleReason);
    });
    merged.push({ ...codeDoor, anchors: codeDoor.anchors.map((anchor) => ({ ...anchor, source_hash_sha256: hashes[anchor.anchor_id] ?? null })), door_removed_at: null, cases });
  }
  const codeIds = new Set(doors.map((door) => door.door_id));
  for (const known of knownById.values()) {
    if (codeIds.has(known.door_id)) continue;
    if (!known.door_removed_at) summary.removed_door_ids.push(known.door_id);
    merged.push({ ...known, door_removed_at: known.door_removed_at ?? now, cases: mergedCases(known.door_kind, known.cases, checklists) });
  }
  return { map: map.map((sector) => ({ ...sector, doors: merged.filter((door) => door.sector_id === sector.sector_id) })), summary };
}

/**
 * Cases whose cited test or ship check is gone from the repo go stale too: the proof they stood on is
 * gone. Probe evidence lives in the private repo and isn't checked here.
 */
export function staleMissingEvidence(map, repoRoot) {
  const staleCaseRefs = [];
  const next = map.map((sector) => ({
    ...sector,
    doors: sector.doors.map((door) => ({
      ...door,
      cases: door.cases.map((theCase) => {
        const evidence = theCase.evidence;
        if (theCase.status === "stale" || !evidence || evidence.kind === "probe" || existsSync(join(repoRoot, evidence.ref))) return theCase;
        staleCaseRefs.push(caseRefOf(door, theCase));
        return withStale(theCase, `its evidence ${evidence.ref} is gone from the repo`);
      }),
    })),
  }));
  return { map: next, stale_case_refs: staleCaseRefs };
}

/** Refreshes the map in mapDir from the code at repoRoot. doors defaults to every door in the code now. */
export async function generateMap({ repoRoot, mapDir, doors, now = new Date().toISOString(), warn = () => {} }) {
  const codeDoors = doors ?? (await collectDoors(repoRoot, await loadSiteModule(repoRoot), warn));
  const sourceByPath = new Map();
  const { map, summary } = mergeDoors({ map: readMap(mapDir), doors: codeDoors, hashesOf: (door) => anchorHashes(repoRoot, door.anchors, sourceByPath), now, warn });
  writeMap(mapDir, map);
  return summary;
}
