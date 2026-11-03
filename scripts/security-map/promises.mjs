import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { anchorHashes } from "./anchors.mjs";
import { staleReasonOf } from "./generate.mjs";
import { SECTOR_IDS } from "./schema.mjs";

/**
 * Each sector's promise and the only ways it could break, as records with a closed shape. The records live
 * in the private repo (zaisma/security, promises/), never this one, so every call takes its directory;
 * this file only knows their shape. A way carries two scores, 1 to 5, each with a written reason, and the
 * code it rests on: when that code changes, its score goes stale until it's looked at again. The skill
 * (.claude/skills/security-map) says how they're kept.
 */

/** What a promise can rest on, strongest first. */
export const STRENGTH_KINDS = ["math", "structure", "tested", "trusted"];

/** A score's steps, lowest first. */
export const SCORE_STEPS = [1, 2, 3, 4, 5];

/** Where the priority grid cuts: a defense up to this is easy to pull off, a damage from this on is harmful. */
export const MAXIMUM_EASY_DEFENSE_SCORE = 2;
export const MINIMUM_HARMFUL_DAMAGE_SCORE = 3;

export const PRIORITIES = ["fix_now", "harden", "fix_soon", "watch"];

const PROMISE_FIELDS = ["sector_id", "rollout_position", "promise_line", "strengths", "ways_to_break"];
const STRENGTH_FIELDS = ["strength_kind", "strength_line", "strength_reason", "anchors", "strength_stale_reason"];
const WAY_FIELDS = ["way_id", "way_line", "defense_score", "defense_reason", "damage_score", "damage_reason", "anchors", "scored_at", "score_stale_reason", "score_changes"];
const SCORE_CHANGE_FIELDS = ["changed_at", "old_defense_score", "old_damage_score", "new_defense_score", "new_damage_score", "changed_because"];
const ANCHOR_FIELDS = ["anchor_id", "source_path", "symbol_name", "source_hash_sha256"];
const STEP_FIELDS = ["step_score", "step_example"];
const SCALE_FIELDS = ["defense_steps", "damage_steps"];

const WAY_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

/** Where a way falls on the priority grid. */
export function priorityOf(defenseScore, damageScore) {
  const isEasy = defenseScore <= MAXIMUM_EASY_DEFENSE_SCORE;
  const isHarmful = damageScore >= MINIMUM_HARMFUL_DAMAGE_SCORE;
  if (isEasy) return isHarmful ? "fix_now" : "fix_soon";
  return isHarmful ? "harden" : "watch";
}

const isFilledText = (value) => typeof value === "string" && value.trim().length > 0;
const isScore = (value) => SCORE_STEPS.includes(value);

function unknownFieldProblems(record, fields, label) {
  return Object.keys(record).filter((field) => !fields.includes(field)).map((field) => `${label} has an unknown field ${field}`);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function anchorProblems(anchors, label) {
  if (!Array.isArray(anchors) || anchors.length === 0) return [`${label} cites no code in anchors`];
  return anchors.flatMap((anchor, index) => {
    const anchorLabel = `${label} anchor ${index + 1}`;
    if (!isObject(anchor)) return [`${anchorLabel} isn't an object`];
    const problems = unknownFieldProblems(anchor, ANCHOR_FIELDS, anchorLabel);
    if (!isFilledText(anchor.source_path) || !isFilledText(anchor.symbol_name)) problems.push(`${anchorLabel} needs source_path and symbol_name`);
    else if (anchor.anchor_id !== `${anchor.source_path}:${anchor.symbol_name}`) problems.push(`${anchorLabel} needs anchor_id ${anchor.source_path}:${anchor.symbol_name}`);
    return problems;
  });
}

function scoreChangeProblems(change, label) {
  if (!isObject(change)) return [`${label} isn't an object`];
  const problems = unknownFieldProblems(change, SCORE_CHANGE_FIELDS, label);
  if (!ISO_TIME.test(change.changed_at ?? "")) problems.push(`${label} needs changed_at as an ISO time`);
  for (const field of ["old_defense_score", "old_damage_score", "new_defense_score", "new_damage_score"]) if (!isScore(change[field])) problems.push(`${label} has ${field} outside 1 to 5`);
  if (!isFilledText(change.changed_because)) problems.push(`${label} doesn't say what changed`);
  return problems;
}

function wayProblems(way, sectorId) {
  if (!isObject(way)) return [`${sectorId} has a way that isn't an object`];
  const label = `${sectorId} way ${way.way_id ?? "with no way_id"}`;
  const problems = unknownFieldProblems(way, WAY_FIELDS, label);
  if (!WAY_ID.test(way.way_id ?? "")) problems.push(`${label} needs a way_id in lowercase words with hyphens`);
  for (const field of ["way_line", "defense_reason", "damage_reason"]) if (!isFilledText(way[field])) problems.push(`${label} has no ${field}`);
  for (const field of ["defense_score", "damage_score"]) if (!isScore(way[field])) problems.push(`${label} has ${field} outside 1 to 5`);
  if (!ISO_TIME.test(way.scored_at ?? "")) problems.push(`${label} needs scored_at as an ISO time`);
  if (way.score_stale_reason !== null && !isFilledText(way.score_stale_reason)) problems.push(`${label} needs score_stale_reason as text or null`);
  problems.push(...anchorProblems(way.anchors, label));
  if (!Array.isArray(way.score_changes)) problems.push(`${label} needs score_changes as a list`);
  else problems.push(...way.score_changes.flatMap((change, index) => scoreChangeProblems(change, `${label} score change ${index + 1}`)));
  return problems;
}

function strengthProblems(strength, sectorId, index) {
  const label = `${sectorId} strength ${index + 1}`;
  if (!isObject(strength)) return [`${label} isn't an object`];
  const problems = unknownFieldProblems(strength, STRENGTH_FIELDS, label);
  if (!STRENGTH_KINDS.includes(strength.strength_kind)) problems.push(`${label} has strength_kind ${JSON.stringify(strength.strength_kind)}, not one of ${STRENGTH_KINDS.join(", ")}`);
  for (const field of ["strength_line", "strength_reason"]) if (!isFilledText(strength[field])) problems.push(`${label} has no ${field}`);
  if (strength.strength_stale_reason !== null && !isFilledText(strength.strength_stale_reason)) problems.push(`${label} needs strength_stale_reason as text or null`);
  problems.push(...anchorProblems(strength.anchors, label));
  return problems;
}

function scaleProblems(scales) {
  if (!isObject(scales)) return ["scales.json is missing or isn't an object"];
  const problems = unknownFieldProblems(scales, SCALE_FIELDS, "scales.json");
  for (const field of SCALE_FIELDS) {
    const steps = scales[field];
    if (!Array.isArray(steps) || steps.length !== SCORE_STEPS.length || steps.some((step, index) => !isObject(step) || step.step_score !== SCORE_STEPS[index])) {
      problems.push(`scales.json needs ${field} with one step for each score, 1 to 5, in order`);
      continue;
    }
    for (const step of steps) {
      problems.push(...unknownFieldProblems(step, STEP_FIELDS, `scales.json ${field} step ${step.step_score}`));
      if (!isFilledText(step.step_example)) problems.push(`scales.json ${field} step ${step.step_score} has no step_example`);
    }
  }
  return problems;
}

/** Everything wrong with the promises; [] when each sector has one in the closed shape. */
export function promiseProblems({ scales, promises }) {
  const problems = scaleProblems(scales);
  const sectorIds = promises.map((promise) => promise?.sector_id);
  for (const sectorId of SECTOR_IDS) if (!sectorIds.includes(sectorId)) problems.push(`${sectorId} has no promise`);
  for (const sectorId of sectorIds) if (!SECTOR_IDS.includes(sectorId)) problems.push(`${sectorId} isn't a sector`);
  if (new Set(sectorIds).size !== sectorIds.length) problems.push("A sector has two promises");
  const positions = promises.map((promise) => promise?.rollout_position).sort((first, second) => first - second);
  if (positions.some((position, index) => position !== index + 1)) problems.push("rollout_position has to run from 1 with no gap or repeat");
  const wayIds = new Set();
  for (const promise of promises) {
    if (!isObject(promise)) {
      problems.push("A promise isn't an object");
      continue;
    }
    const sectorId = promise.sector_id;
    problems.push(...unknownFieldProblems(promise, PROMISE_FIELDS, sectorId));
    if (!isFilledText(promise.promise_line)) problems.push(`${sectorId} has no promise_line`);
    if (!Array.isArray(promise.strengths) || promise.strengths.length === 0) problems.push(`${sectorId} rests on no strengths`);
    else problems.push(...promise.strengths.flatMap((strength, index) => strengthProblems(strength, sectorId, index)));
    if (!Array.isArray(promise.ways_to_break) || promise.ways_to_break.length === 0) {
      problems.push(`${sectorId} lists no ways to break`);
      continue;
    }
    for (const way of promise.ways_to_break) {
      problems.push(...wayProblems(way, sectorId));
      if (wayIds.has(way?.way_id)) problems.push(`way_id ${way?.way_id} is used twice`);
      wayIds.add(way?.way_id);
    }
  }
  return problems;
}

const hashesAsScored = (anchors) => Object.fromEntries(anchors.map((anchor) => [anchor.anchor_id, anchor.source_hash_sha256]));

/** One record's anchors stamped where they have no hash yet, and why what it says no longer holds (null when the code is identical). */
function refreshedAnchors(anchors, currentHashes) {
  const stamped = anchors.map((anchor) => ({ ...anchor, source_hash_sha256: anchor.source_hash_sha256 ?? currentHashes[anchor.anchor_id] ?? null }));
  return { anchors: stamped, stale_reason: staleReasonOf(hashesAsScored(stamped), currentHashes) };
}

/**
 * The promises with each score and strength checked against the code at repoRoot. An anchor with no hash
 * yet is new and takes today's; one whose code has changed keeps the hash it was scored on, so its score
 * stays stale until rescoreWay settles it.
 */
export function refreshPromises({ stored, repoRoot, sourceByPath = new Map() }) {
  const refresh = (record, staleField) => {
    const { anchors, stale_reason } = refreshedAnchors(record.anchors, anchorHashes(repoRoot, record.anchors, sourceByPath));
    return { ...record, anchors, [staleField]: stale_reason };
  };
  return {
    scales: stored.scales,
    promises: stored.promises.map((promise) => ({
      ...promise,
      strengths: promise.strengths.map((strength) => refresh(strength, "strength_stale_reason")),
      ways_to_break: promise.ways_to_break.map((way) => refresh(way, "score_stale_reason")),
    })),
  };
}

/**
 * A way looked at again: it rests on the code as it is now, and a score that moved keeps its old value and
 * the fact that moved it, appended. Scores never move without changed_because.
 */
export function rescoreWay(way, { defense_score, defense_reason, damage_score, damage_reason, changed_because, now, currentHashes }) {
  const isMoved = defense_score !== way.defense_score || damage_score !== way.damage_score;
  if (isMoved && !isFilledText(changed_because)) throw new Error(`${way.way_id}: a score moves only with changed_because, the fact that changed.`);
  const change = { changed_at: now, old_defense_score: way.defense_score, old_damage_score: way.damage_score, new_defense_score: defense_score, new_damage_score: damage_score, changed_because };
  return {
    ...way,
    defense_score,
    defense_reason,
    damage_score,
    damage_reason,
    anchors: way.anchors.map((anchor) => ({ ...anchor, source_hash_sha256: currentHashes[anchor.anchor_id] ?? null })),
    scored_at: now,
    score_stale_reason: null,
    score_changes: isMoved ? [...way.score_changes, change] : way.score_changes,
  };
}

/** What the promises command prints for each sector, in rollout order. */
export function promiseSummaries({ promises }) {
  return [...promises].sort((first, second) => first.rollout_position - second.rollout_position).map((promise) => {
    const way_count_by_priority = Object.fromEntries(PRIORITIES.map((priority) => [priority, promise.ways_to_break.filter((way) => priorityOf(way.defense_score, way.damage_score) === priority).length]));
    return {
      sector_id: promise.sector_id,
      rollout_position: promise.rollout_position,
      promise_line: promise.promise_line,
      way_count: promise.ways_to_break.length,
      way_count_by_priority,
      stale_refs: [
        ...promise.strengths.filter((strength) => strength.strength_stale_reason).map((strength) => `${promise.sector_id} ${strength.strength_kind}: ${strength.strength_stale_reason}`),
        ...promise.ways_to_break.filter((way) => way.score_stale_reason).map((way) => `${way.way_id}: ${way.score_stale_reason}`),
      ],
    };
  });
}

/** promises/scales.json and one promises/<sector_id>.json per sector; a sector with no file is left for promiseProblems to name. */
export function readPromises(mapDir) {
  const directory = join(mapDir, "promises");
  const readJson = (fileName) => {
    const filePath = join(directory, fileName);
    return existsSync(filePath) ? JSON.parse(readFileSync(filePath, "utf8")) : null;
  };
  return { scales: readJson("scales.json"), promises: SECTOR_IDS.map((sectorId) => readJson(`${sectorId}.json`)).filter(Boolean) };
}

/** Each sector's file, key-stable, so a re-run with nothing new changes nothing. */
export function writePromises(mapDir, { promises }) {
  const directory = join(mapDir, "promises");
  mkdirSync(directory, { recursive: true });
  for (const promise of promises) writeFileSync(join(directory, `${promise.sector_id}.json`), `${JSON.stringify(promise, null, 2)}\n`);
}
