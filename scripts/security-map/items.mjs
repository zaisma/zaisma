import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { anchorProblems, isFilledText, isObject, isScore, priorityOf, rescoreWay, scoreChangeProblems, unknownFieldProblems } from "./promises.mjs";
import { SECTOR_IDS, SECTORS } from "./schema.mjs";

/**
 * Security items as records with a closed shape. The records live in the private repo (zaisma/security,
 * items/), never this one; this file only knows their shape and how one may change. An item names the way
 * to break it's about and the goal of the work; how that work is done is never in it. Lines written when it
 * opened never change: a run moves fields and appends evidence. A question is an item with no proof yet. The
 * coordinator reads them as a second roadmap: it claims one for a session, a talk settles its calls, and the
 * session closes it with the test that guards it.
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

const ITEM_FIELDS = ["item_id", "item_kind", "sector_id", "way_id", "item_line", "goal_line", "answer_kind", "opened_at", "opened_by", "item_state", "defense_score", "defense_reason", "damage_score", "damage_reason", "anchors", "scored_at", "score_stale_reason", "score_changes", "calls", "waits_on", "proof_kind", "proof_line", "test_path", "finding_id", "evidence", "settled_calls", "claimed_by_launch_id"];
const SETTLED_CALL_FIELDS = ["call_line", "answer_line", "settled_at"];
const SETTLE_ANSWER_FIELDS = ["call_line", "answer_line"];
const EVIDENCE_FIELDS = ["added_at", "evidence_line", "rests_on_commit"];
const NEW_ITEM_FIELDS = ["item_slug", "item_kind", "sector_id", "way_id", "item_line", "goal_line", "answer_kind", "opened_by", "defense_score", "defense_reason", "damage_score", "damage_reason", "anchors", "calls", "waits_on", "proof_kind", "proof_line", "test_path"];
const ITEM_UPDATE_FIELDS = ["item_id", "evidence_line", "item_state", "defense_score", "defense_reason", "damage_score", "damage_reason", "changed_because", "anchors", "calls", "waits_on", "proof_kind", "proof_line", "test_path"];

const ITEM_ID = /^itm_\d{4}-\d{2}-\d{2}_[a-z0-9]+(-[a-z0-9]+)*$/;
const ITEM_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FINDING_ID = /^fnd_\d{4}-\d{2}-\d{2}_[a-z0-9-]+$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const OPEN_STATES = ["next", "doing"];
/** The priorities a session takes in turn, in the order they're picked: fix now goes first by the queue, and watch takes none. */
const TURN_PRIORITIES = ["harden", "fix_soon"];
/** The states that end what waits on an item. */
export const FINISHED_STATES = ["done", "closed_unproven"];
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
  if (item.claimed_by_launch_id !== undefined && item.claimed_by_launch_id !== null && !isFilledText(item.claimed_by_launch_id)) problems.push(`${label} needs claimed_by_launch_id as text or null`);
  if (item.settled_calls !== undefined && !Array.isArray(item.settled_calls)) problems.push(`${label} needs settled_calls as a list`);
  else for (const settled of item.settled_calls ?? []) {
    if (!isObject(settled)) {
      problems.push(`${label} has a settled call that isn't an object`);
      continue;
    }
    problems.push(...unknownFieldProblems(settled, SETTLED_CALL_FIELDS, `${label} settled call`));
    if (!isFilledText(settled.call_line) || !isFilledText(settled.answer_line) || !ISO_TIME.test(settled.settled_at ?? "")) problems.push(`${label} settled call needs call_line, answer_line and settled_at`);
  }
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
    settled_calls: [],
    claimed_by_launch_id: null,
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
  if (item.item_state === "doing" && update.item_state === "next") problems.push(`${label} puts it back to next, but ${item.item_id} is doing: the claim is the coordinator's`);
  const reopenedCalls = (update.calls ?? []).filter((call) => (item.settled_calls ?? []).some((settled) => settled.call_line === call));
  if (reopenedCalls.length) problems.push(`${label} reopens a call already settled: ${reopenedCalls.join("; ")}`);
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

/** An item done, with the test that now guards it as its proof. */
const itemGuardedBy = (item, { testPath, date, now, commit }) => ({
  ...item,
  item_state: "done",
  proof_kind: "failing_test",
  proof_line: `${testPath} guards it since ${date}.`,
  test_path: testPath,
  claimed_by_launch_id: null,
  evidence: [...item.evidence, { added_at: now, evidence_line: `Fixed on ${date}, guarded by ${testPath}.`, rests_on_commit: commit }],
});

/** The items a fixed finding came from, done, with the test that now guards them as their proof. */
export function itemsWithFindingFixed(items, { findingId, testPath, date, now }) {
  return items.filter((item) => item.finding_id === findingId).map((item) => itemGuardedBy(item, { testPath, date, now, commit: testPath }));
}

/** An item claimed for the session of this launch on the desk board: only one waiting, and never a question, which has no proof to act on. */
export function itemWithClaim(item, { launchId }) {
  if (item.item_state !== "next") throw new Error(`${item.item_id} is ${item.item_state}, and only a next item can be claimed.`);
  if (item.item_kind === "question") throw new Error(`${item.item_id} is a question: it takes no session until a daily review proves it.`);
  if (!isFilledText(launchId)) throw new Error("A claim needs the launch id of the session's row on the desk board.");
  return { ...item, item_state: "doing", claimed_by_launch_id: launchId };
}

/** A claimed item put back, when its start failed, its session stopped or its talk ended with nothing built. */
export function itemBackToNext(item) {
  if (item.item_state !== "doing") throw new Error(`${item.item_id} is ${item.item_state}, and only a doing item goes back to next.`);
  return { ...item, item_state: "next", claimed_by_launch_id: null };
}

/** An open item with these calls answered: each leaves calls and joins settled_calls, and any others stay open. */
export function itemWithCallsSettled(item, answers, { now }) {
  if (!isOpenItem(item)) throw new Error(`${item.item_id} is ${item.item_state}, so its calls aren't open.`);
  if (!Array.isArray(answers) || !answers.length) throw new Error("Give the answers as a list of call_line and answer_line.");
  const problems = answers.flatMap((answer, index) => {
    if (!isObject(answer)) return [`answer ${index + 1} isn't an object`];
    const answerProblems = unknownFieldProblems(answer, SETTLE_ANSWER_FIELDS, `answer ${index + 1}`);
    if (!item.calls.includes(answer.call_line)) answerProblems.push(`answer ${index + 1} names a call ${item.item_id} doesn't have open`);
    if (!isFilledText(answer.answer_line)) answerProblems.push(`answer ${index + 1} has no answer_line`);
    return answerProblems;
  });
  if (problems.length) throw new Error(problems.join("; "));
  const answered = answers.map((answer) => answer.call_line);
  return {
    ...item,
    calls: item.calls.filter((call) => !answered.includes(call)),
    settled_calls: [...(item.settled_calls ?? []), ...answers.map(({ call_line, answer_line }) => ({ call_line, answer_line, settled_at: now }))],
  };
}

/** An item a session finished, done with its guarding test; one a daily review already closed stays as it is. A finding's item closes through mark-fixed instead. */
export function itemDoneWithTest(item, { testPath, date, now, commit }) {
  if (item.finding_id) throw new Error(`${item.item_id} came with finding ${item.finding_id}: close it with mark-fixed.`);
  if (item.item_state === "done") return item;
  if (item.item_state !== "doing") throw new Error(`${item.item_id} is ${item.item_state}, and only a doing item is finished by a session.`);
  return itemGuardedBy(item, { testPath, date, now, commit });
}

/**
 * Where every item stands for the coordinator: fix-now items, the ones a session could take in turn (in the order
 * they're picked, with what they still wait on), what's claimed, and counts of what takes no session. A wait named
 * by an item's id clears when that item ends; any other wait stays open here, for the caller who can read it.
 */
export function itemQueueOf(items) {
  const entryOf = (item) => ({
    item_id: item.item_id,
    item_kind: item.item_kind,
    sector_id: item.sector_id,
    sector_name: SECTORS.find((sector) => sector.sector_id === item.sector_id)?.sector_name ?? item.sector_id,
    priority: priorityOfItem(item),
    item_line: item.item_line,
    goal_line: item.goal_line,
    calls: item.calls,
    settled_calls: item.settled_calls ?? [],
    opens_with: item.calls.length ? "talk" : "build",
    open_waits_on: item.waits_on.filter((wait) => !FINISHED_STATES.includes(items.find((other) => other.item_id === wait)?.item_state)),
    finding_id: item.finding_id,
    claimed_by_launch_id: item.claimed_by_launch_id ?? null,
    score_stale_reason: item.score_stale_reason,
  });
  const waiting = items.filter((item) => item.item_state === "next" && item.item_kind === "item");
  const inTurn = waiting.filter((item) => TURN_PRIORITIES.includes(priorityOfItem(item)));
  const pickOrder = (first, second) => TURN_PRIORITIES.indexOf(priorityOfItem(first)) - TURN_PRIORITIES.indexOf(priorityOfItem(second)) || second.damage_score - first.damage_score || first.defense_score - second.defense_score || first.opened_at.localeCompare(second.opened_at);
  return {
    fix_now_items: waiting.filter((item) => priorityOfItem(item) === "fix_now").map(entryOf),
    in_turn_items: [...inTurn].sort(pickOrder).map(entryOf),
    doing_items: items.filter((item) => item.item_state === "doing").map(entryOf),
    watch_items: waiting.filter((item) => priorityOfItem(item) === "watch").map(entryOf),
    question_count: items.filter((item) => item.item_kind === "question" && isOpenItem(item)).length,
    accepted_count: items.filter((item) => item.item_state === "accepted").length,
  };
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
