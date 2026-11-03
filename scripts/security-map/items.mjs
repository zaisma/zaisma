import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { anchorProblems, isFilledText, isObject, isScore, priorityOf, rescoreWay, scoreChangeProblems, unknownFieldProblems } from "./promises.mjs";
import { SECTOR_IDS } from "./schema.mjs";

/**
 * Security items as records with a closed shape. The records live in the private repo (zaisma/security,
 * items/), never this one; this file only knows their shape and how one may change. An item names the way
 * to break it's about and the goal of the work; how that work is done is never in it. Lines written when it
 * opened never change: a run moves fields and appends evidence. A question is an item with no proof yet.
 */

export const ITEM_KINDS = ["item", "question"];
export const ITEM_STATES = ["next", "doing", "done", "accepted", "closed_unproven"];
export const ANSWER_KINDS = ["remove", "shrink_damage", "make_harder", "notice_and_recover"];
export const OPENED_BY = ["merge_catch_up", "promise_challenge", "second_guess"];
export const PROOF_KINDS = ["failing_test", "cited_code"];

/** How long a question stays open with no proof. */
export const QUESTION_LIFETIME_DAYS = 14;

/** The states a daily review may move an item to: doing is the coordinator's, accepted is Julius's, closed_unproven only comes with age. */
export const REVIEW_SET_STATES = ["next", "done"];

const ITEM_FIELDS = ["item_id", "item_kind", "sector_id", "way_id", "item_line", "goal_line", "answer_kind", "opened_at", "opened_by", "item_state", "defense_score", "defense_reason", "damage_score", "damage_reason", "anchors", "scored_at", "score_stale_reason", "score_changes", "calls", "waits_on", "proof_kind", "proof_line", "test_path", "finding_id", "evidence"];
const EVIDENCE_FIELDS = ["added_at", "evidence_line", "rests_on_commit"];
const NEW_ITEM_FIELDS = ["item_slug", "item_kind", "sector_id", "way_id", "item_line", "goal_line", "answer_kind", "opened_by", "defense_score", "defense_reason", "damage_score", "damage_reason", "anchors", "calls", "waits_on", "proof_kind", "proof_line", "test_path"];
const ITEM_UPDATE_FIELDS = ["item_id", "evidence_line", "item_state", "defense_score", "defense_reason", "damage_score", "damage_reason", "changed_because", "anchors", "calls", "waits_on", "proof_kind", "proof_line", "test_path"];

const ITEM_ID = /^itm_\d{4}-\d{2}-\d{2}_[a-z0-9]+(-[a-z0-9]+)*$/;
const ITEM_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FINDING_ID = /^fnd_\d{4}-\d{2}-\d{2}_[a-z0-9-]+$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const OPEN_STATES = ["next", "doing"];
const MS_PER_DAY = 86400000;

const isTextList = (value) => Array.isArray(value) && value.every(isFilledText);

/** Where an item stands on the priority grid. */
export const priorityOfItem = (item) => priorityOf(item.defense_score, item.damage_score);

export const isOpenItem = (item) => OPEN_STATES.includes(item.item_state);

export const itemFilePathOf = (itemId) => `items/${itemId}.json`;

/** What makes two findings one item: the same way to break and the same cited code or test. */
export function itemMatchKeyOf({ way_id, anchors, test_path }) {
  return [way_id, ...anchors.map((anchor) => anchor.anchor_id).sort(), test_path ?? ""].join("|");
}

/** Everything wrong with one item's shape; [] when it's whole. */
export function itemProblems(item) {
  if (!isObject(item)) return ["An item isn't an object"];
  const label = `item ${item.item_id ?? "with no item_id"}`;
  const problems = unknownFieldProblems(item, ITEM_FIELDS, label);
  if (!ITEM_ID.test(item.item_id ?? "")) problems.push(`${label} needs an item_id like itm_2026-11-04_some-words`);
  if (!ITEM_KINDS.includes(item.item_kind)) problems.push(`${label} has item_kind ${JSON.stringify(item.item_kind)}, not one of ${ITEM_KINDS.join(", ")}`);
  if (!ITEM_STATES.includes(item.item_state)) problems.push(`${label} has item_state ${JSON.stringify(item.item_state)}, not one of ${ITEM_STATES.join(", ")}`);
  if (!SECTOR_IDS.includes(item.sector_id)) problems.push(`${label} has a sector_id that isn't a sector`);
  if (!OPENED_BY.includes(item.opened_by)) problems.push(`${label} has opened_by ${JSON.stringify(item.opened_by)}, not one of ${OPENED_BY.join(", ")}`);
  if (!ISO_TIME.test(item.opened_at ?? "") || !ISO_TIME.test(item.scored_at ?? "")) problems.push(`${label} needs opened_at and scored_at as ISO times`);
  for (const field of ["way_id", "item_line", "goal_line", "defense_reason", "damage_reason"]) if (!isFilledText(item[field])) problems.push(`${label} has no ${field}`);
  for (const field of ["defense_score", "damage_score"]) if (!isScore(item[field])) problems.push(`${label} has ${field} outside 1 to 5`);
  if (item.score_stale_reason !== null && !isFilledText(item.score_stale_reason)) problems.push(`${label} needs score_stale_reason as text or null`);
  if (!isTextList(item.calls) || !isTextList(item.waits_on)) problems.push(`${label} needs calls and waits_on as lists of text`);
  if (item.finding_id !== null && !FINDING_ID.test(item.finding_id ?? "")) problems.push(`${label} needs finding_id like fnd_2026-11-04_some-words, or null`);
  if (!Array.isArray(item.anchors)) problems.push(`${label} needs anchors as a list`);
  else if (item.anchors.length) problems.push(...anchorProblems(item.anchors, label));
  if (!Array.isArray(item.score_changes)) problems.push(`${label} needs score_changes as a list`);
  else problems.push(...item.score_changes.flatMap((change, index) => scoreChangeProblems(change, `${label} score change ${index + 1}`)));
  if (!Array.isArray(item.evidence)) problems.push(`${label} needs evidence as a list`);
  else for (const entry of item.evidence) {
    if (!isObject(entry)) {
      problems.push(`${label} has evidence that isn't an object`);
      continue;
    }
    problems.push(...unknownFieldProblems(entry, EVIDENCE_FIELDS, `${label} evidence`));
    if (!ISO_TIME.test(entry.added_at ?? "") || !isFilledText(entry.evidence_line) || !isFilledText(entry.rests_on_commit)) problems.push(`${label} evidence needs added_at, evidence_line and rests_on_commit`);
  }
  if (item.item_kind === "question") {
    if (item.proof_kind !== null || item.proof_line !== null || item.test_path !== null) problems.push(`${label} is a question, so it holds no proof; with proof it's an item`);
    if (item.answer_kind !== null && !ANSWER_KINDS.includes(item.answer_kind)) problems.push(`${label} has answer_kind ${JSON.stringify(item.answer_kind)}, not one of ${ANSWER_KINDS.join(", ")} or null`);
    if (isScore(item.defense_score) && isScore(item.damage_score) && priorityOfItem(item) === "fix_now") problems.push(`${label} is a question, and a question can't stand at fix now: prove it first`);
  } else {
    if (!ANSWER_KINDS.includes(item.answer_kind)) problems.push(`${label} has answer_kind ${JSON.stringify(item.answer_kind)}, not one of ${ANSWER_KINDS.join(", ")}`);
    if (!PROOF_KINDS.includes(item.proof_kind)) problems.push(`${label} needs proof_kind, one of ${PROOF_KINDS.join(", ")}: with no failing test or cited code it's a question`);
    if (!isFilledText(item.proof_line)) problems.push(`${label} has no proof_line`);
    if (item.proof_kind === "failing_test" && !isFilledText(item.test_path)) problems.push(`${label} proves with a failing test, so it needs test_path`);
    if (item.proof_kind === "cited_code" && !item.anchors?.length) problems.push(`${label} proves with cited code, so it needs anchors`);
  }
  return problems;
}

/** A new item from a night's record: closed input, with the anchors already stamped by the caller. */
export function itemFromNight(input, { date, now, anchors }) {
  const problems = unknownFieldProblems(input, NEW_ITEM_FIELDS, `new item ${input.item_slug ?? "with no item_slug"}`);
  if (!ITEM_SLUG.test(input.item_slug ?? "")) problems.push(`new item ${input.item_slug ?? ""} needs item_slug in lowercase words with hyphens`);
  if (problems.length) return { problems };
  const item = {
    item_id: `itm_${date}_${input.item_slug}`,
    item_kind: input.item_kind,
    sector_id: input.sector_id,
    way_id: input.way_id,
    item_line: input.item_line,
    goal_line: input.goal_line,
    answer_kind: input.answer_kind ?? null,
    opened_at: now,
    opened_by: input.opened_by,
    item_state: "next",
    defense_score: input.defense_score,
    defense_reason: input.defense_reason,
    damage_score: input.damage_score,
    damage_reason: input.damage_reason,
    anchors,
    scored_at: now,
    score_stale_reason: null,
    score_changes: [],
    calls: input.calls ?? [],
    waits_on: input.waits_on ?? [],
    proof_kind: input.proof_kind ?? null,
    proof_line: input.proof_line ?? null,
    test_path: input.test_path ?? null,
    finding_id: null,
    evidence: [],
  };
  return { item, problems: itemProblems(item) };
}

/**
 * An item changed by a night: a new line of evidence always, the fields that may move, nothing else. Answers
 * the new item and what's wrong. An accepted item takes evidence and nothing more: reopening it is Julius's.
 */
export function itemWithUpdate(item, update, { now, commit, anchors, currentHashes }) {
  const label = `update to ${item.item_id}`;
  const problems = unknownFieldProblems(update, ITEM_UPDATE_FIELDS, label);
  if (!isFilledText(update.evidence_line)) problems.push(`${label} needs evidence_line: an item changes only with new evidence`);
  if (item.evidence.some((entry) => entry.evidence_line === update.evidence_line)) problems.push(`${label} repeats evidence it already holds, and only new evidence changes an item`);
  const movedFields = ITEM_UPDATE_FIELDS.filter((field) => !["item_id", "evidence_line"].includes(field) && update[field] !== undefined);
  if (item.item_state === "accepted" && movedFields.length) problems.push(`${label} changes ${movedFields.join(", ")}, but ${item.item_id} is accepted: a run only appends evidence, and reopening it is Julius's`);
  if (update.item_state !== undefined && !REVIEW_SET_STATES.includes(update.item_state)) problems.push(`${label} sets item_state ${JSON.stringify(update.item_state)}, and a run only sets ${REVIEW_SET_STATES.join(" or ")}`);
  if (problems.length) return { problems };
  const evidence = [...item.evidence, { added_at: now, evidence_line: update.evidence_line, rests_on_commit: commit }];
  if (item.item_state === "accepted") return { item: { ...item, evidence }, problems: [] };
  const hasProof = update.proof_kind !== undefined;
  let next = { ...item, evidence };
  if (update.item_state !== undefined) next.item_state = update.item_state;
  if (update.calls !== undefined) next.calls = update.calls;
  if (update.waits_on !== undefined) next.waits_on = update.waits_on;
  if (hasProof) {
    next.proof_kind = update.proof_kind;
    next.proof_line = update.proof_line ?? null;
    next.test_path = update.test_path ?? null;
    if (PROOF_KINDS.includes(update.proof_kind)) next.item_kind = "item";
  }
  next.anchors = anchors;
  const scores = {
    defense_score: update.defense_score ?? item.defense_score,
    defense_reason: update.defense_reason ?? item.defense_reason,
    damage_score: update.damage_score ?? item.damage_score,
    damage_reason: update.damage_reason ?? item.damage_reason,
  };
  try {
    next = rescoreWay(next, { ...scores, changed_because: update.changed_because, now, currentHashes });
  } catch (error) {
    return { problems: [error.message] };
  }
  return { item: next, problems: itemProblems(next) };
}

/** Whether a question's lifetime is over on this day. */
export function isQuestionPastLifetime(item, date) {
  if (item.item_kind !== "question" || !isOpenItem(item)) return false;
  return (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${item.opened_at.slice(0, 10)}T00:00:00Z`)) / MS_PER_DAY >= QUESTION_LIFETIME_DAYS;
}

/** The items a fixed finding came from, done, with the test that now guards them as their proof. */
export function itemsWithFindingFixed(items, { findingId, testPath, date, now }) {
  return items.filter((item) => item.finding_id === findingId).map((item) => ({
    ...item,
    item_state: "done",
    proof_kind: "failing_test",
    proof_line: `${testPath} guards it since ${date}.`,
    test_path: testPath,
    evidence: [...item.evidence, { added_at: now, evidence_line: `Fixed on ${date}, guarded by ${testPath}.`, rests_on_commit: testPath }],
  }));
}

/** Every items/*.json in the private repo. */
export function readItems(mapDir) {
  const directory = join(mapDir, "items");
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => name.endsWith(".json")).sort().map((name) => JSON.parse(readFileSync(join(directory, name), "utf8")));
}

/** Each item's file, key-stable. */
export function writeItems(mapDir, items) {
  mkdirSync(join(mapDir, "items"), { recursive: true });
  for (const item of items) writeFileSync(join(mapDir, itemFilePathOf(item.item_id)), `${JSON.stringify(item, null, 2)}\n`);
}
