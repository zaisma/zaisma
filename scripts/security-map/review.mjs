import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { anchorHashes } from "./anchors.mjs";
import { checkMapDirExport, exportMapDir } from "./export-public.mjs";
import { generateMap } from "./generate.mjs";
import { isOpenItem, isQuestionPastLifetime, isWayWaitingForRescore, itemFromNight, itemMatchKeyOf, itemProblems, itemWithUpdate, priorityOfItem, QUESTION_LIFETIME_DAYS, readItems, writeItems } from "./items.mjs";
import { commitAndPush, pullClone, run, withFindingStatus, withQueueLines } from "./private-repo.mjs";
import { isFilledText, isObject, isScore, priorityOf, promiseProblems, readPromises, refreshedAnchors, refreshPromises, rescoreWay, unknownFieldProblems, writePromises } from "./promises.mjs";
import { SECTORS } from "./schema.mjs";
import { seedMapDir } from "./seed-robust.mjs";

/**
 * The daily review's two calls (the daily-review skill says how a run uses them). review-start answers all a
 * run needs to read, in one JSON. review-finish takes the night's record, checks it whole and applies it or
 * nothing, so the rules on how a record may change hold whatever a run writes. Everything here is about the
 * private repo's records; nothing reaches this repo or the public export.
 */

/** About what a night may cost in model requests, subagents counted. */
export const STEP_BUDGET_PER_NIGHT = 50;

/** The ways a night's blind look covers: about a tenth of a night's steps. */
export const SECOND_GUESS_WAY_COUNT = 2;

/** Paths listed in a catch-up; a merge past this is counted, not listed. */
const CHANGED_PATH_CAP = 200;

const NIGHT_FIELDS = ["summary_line", "model_name", "started_at", "step_count", "is_contracts_checked", "is_grid_checked", "is_pattern_rules_checked", "way_rescores", "strength_refreshes", "new_ways", "new_items", "item_updates", "second_guesses", "challenge"];
const WAY_RESCORE_FIELDS = ["way_id", "defense_score", "defense_reason", "damage_score", "damage_reason", "changed_because"];
const STRENGTH_REFRESH_FIELDS = ["sector_id", "strength_line", "strength_reason"];
const NEW_WAY_FIELDS = ["sector_id", "way_id", "way_line", "defense_score", "defense_reason", "damage_score", "damage_reason", "anchors"];
const SECOND_GUESS_FIELDS = ["way_id", "defense_score", "damage_score", "guess_reason"];
const CHALLENGE_FIELDS = ["sector_id", "way_ids_done", "is_finished", "stopped_because"];
const INPUT_ANCHOR_FIELDS = ["source_path", "symbol_name"];
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

const sectorNameOf = (sectorId) => SECTORS.find((sector) => sector.sector_id === sectorId)?.sector_name ?? sectorId;
const allWaysOf = (promises) => promises.flatMap((promise) => promise.ways_to_break.map((way) => ({ ...way, sector_id: promise.sector_id })));

/** Every reviews/*.json, oldest first. */
export function readReviews(mapDir) {
  const directory = join(mapDir, "reviews");
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => name.endsWith(".json")).sort().map((name) => JSON.parse(readFileSync(join(directory, name), "utf8")));
}

/** The promise a night challenges: the one a past night stopped partway, else the one left longest, in rollout order on a tie. */
export function challengeOf(promises, reviews) {
  const last = reviews.at(-1)?.challenge ?? null;
  if (last && !last.is_finished) return { sector_id: last.sector_id, way_ids_done: last.way_ids_done, is_resumed: true };
  const finishedOn = (sectorId) => reviews.filter((review) => review.challenge?.sector_id === sectorId && review.challenge.is_finished).map((review) => review.review_date).at(-1) ?? "";
  const [next] = [...promises].sort((first, second) => finishedOn(first.sector_id).localeCompare(finishedOn(second.sector_id)) || first.rollout_position - second.rollout_position);
  return { sector_id: next.sector_id, way_ids_done: [], is_resumed: false };
}

/** The ways a night's blind look covers: settled ones, the same for one date and different across dates. */
export function secondGuessSampleOf(promises, date) {
  const rank = (wayId) => createHash("sha256").update(`${date}\n${wayId}`).digest("hex");
  return allWaysOf(promises).filter((way) => !way.score_stale_reason).sort((first, second) => (rank(first.way_id) < rank(second.way_id) ? -1 : 1)).slice(0, SECOND_GUESS_WAY_COUNT).map((way) => ({ way_id: way.way_id, sector_id: way.sector_id, way_line: way.way_line, anchors: way.anchors.map(({ source_path, symbol_name }) => ({ source_path, symbol_name })) }));
}

/** The commits on this checkout's history since a moment, each with the paths it changed; nothing before a first review. */
export function mergesSince(repoRoot, sinceTime) {
  if (!sinceTime) return { merges: [], changed_paths: [], changed_path_count: 0 };
  const isShallow = run("git", ["rev-parse", "--is-shallow-repository"], repoRoot) === "true";
  if (isShallow) {
    try {
      run("git", ["fetch", "--quiet", `--shallow-since=${sinceTime}`, "origin", "main"], repoRoot);
    } catch {
      // A sandbox that can't deepen still reads what it has.
    }
  }
  const lines = run("git", ["log", "--first-parent", "--diff-merges=first-parent", "--name-only", "--format=%x01%H%x09%s", `--since=${sinceTime}`, "HEAD"], repoRoot).split("\n");
  const merges = [];
  const paths = new Set();
  for (const line of lines) {
    if (line.startsWith("\u0001")) {
      const [commit, subject] = line.slice(1).split("\t");
      merges.push({ commit, subject });
    } else if (line.trim()) paths.add(line.trim());
  }
  return { merges, changed_paths: [...paths].sort().slice(0, CHANGED_PATH_CAP), changed_path_count: paths.size };
}

/** All a run reads, from records already loaded. */
export function reviewOutlineOf({ promises, items, reviews, date }) {
  const challenge = challengeOf(promises, reviews);
  const challenged = promises.find((promise) => promise.sector_id === challenge.sector_id);
  const summaryOf = (item) => ({ item_id: item.item_id, item_kind: item.item_kind, item_state: item.item_state, sector_id: item.sector_id, way_id: item.way_id, item_line: item.item_line, priority: priorityOfItem(item), score_stale_reason: item.score_stale_reason, calls: item.calls, settled_calls: item.settled_calls ?? [], claimed_by_launch_id: item.claimed_by_launch_id ?? null });
  return {
    review_date: date,
    step_budget: STEP_BUDGET_PER_NIGHT,
    last_review: reviews.at(-1) ?? null,
    stale_ways: allWaysOf(promises).filter((way) => way.score_stale_reason).map((way) => ({ way_id: way.way_id, sector_id: way.sector_id, way_line: way.way_line, defense_score: way.defense_score, damage_score: way.damage_score, score_stale_reason: way.score_stale_reason })),
    rescore_waiting_ways: allWaysOf(promises).filter((way) => isWayWaitingForRescore(way, way.sector_id, items)).map((way) => ({ way_id: way.way_id, sector_id: way.sector_id, way_line: way.way_line, defense_score: way.defense_score, damage_score: way.damage_score })),
    stale_strengths: promises.flatMap((promise) => promise.strengths.filter((strength) => strength.strength_stale_reason).map((strength) => ({ sector_id: promise.sector_id, strength_line: strength.strength_line, strength_stale_reason: strength.strength_stale_reason }))),
    open_items: items.filter(isOpenItem).map(summaryOf),
    accepted_items: items.filter((item) => item.item_state === "accepted").map(summaryOf),
    questions_closing_tonight: items.filter((item) => isQuestionPastLifetime(item, date)).map((item) => item.item_id),
    question_lifetime_days: QUESTION_LIFETIME_DAYS,
    challenge: { ...challenge, promise_line: challenged.promise_line, strengths: challenged.strengths.map(({ strength_kind, strength_line, anchors }) => ({ strength_kind, strength_line, anchors })), ways: challenged.ways_to_break.map(({ way_id, way_line, defense_score, damage_score, anchors }) => ({ way_id, way_line, defense_score, damage_score, anchors })) },
    second_guess_sample: secondGuessSampleOf(promises, date),
  };
}

/** review-start: pull, refresh the map and the scores from the code, and say what a run reads. */
export async function startReview({ repoRoot, mapDir, date, warn }) {
  const clone = pullClone(mapDir);
  const generated = await generateMap({ repoRoot, mapDir, warn });
  const seeded = seedMapDir({ repoRoot, mapDir });
  const stored = readPromises(mapDir);
  const problems = promiseProblems(stored);
  if (problems.length) throw new Error(`The promises have problems:\n  ${problems.join("\n  ")}`);
  const refreshed = refreshPromises({ stored, repoRoot });
  writePromises(mapDir, refreshed);
  const reviews = readReviews(mapDir);
  return {
    clone,
    head_commit: run("git", ["rev-parse", "HEAD"], repoRoot),
    ...mergesSince(repoRoot, reviews.at(-1)?.finished_at ?? null),
    new_door_ids: generated.new_door_ids,
    removed_door_ids: generated.removed_door_ids,
    stale_case_count: generated.stale_case_refs.length,
    seeded_case_count: seeded.length,
    grid: readGridFailures(mapDir),
    patterns: readPatternFindings(mapDir),
    ...reviewOutlineOf({ promises: refreshed.promises, items: refreshItems(readItems(mapDir), repoRoot), reviews, date }),
  };
}

/** The contract test grid's last run on main (grid/failures.json, which its workflow in the private repo writes); null before its first. */
export function readGridFailures(mapDir) {
  const path = join(mapDir, "grid", "failures.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

/** The pattern rules' last run on main (patterns/findings.json, which their workflow in the private repo writes); null before its first. */
export function readPatternFindings(mapDir) {
  const path = join(mapDir, "patterns", "findings.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

/** Items with score_stale_reason set from the code as it is now. */
function refreshItems(items, repoRoot) {
  const sourceByPath = new Map();
  return items.map((item) => {
    const { anchors, stale_reason } = refreshedAnchors(item.anchors, anchorHashes(repoRoot, item.anchors, sourceByPath));
    return { ...item, anchors, score_stale_reason: stale_reason };
  });
}

/** Input anchors stamped with the code as it is now; a symbol that isn't there is a problem, not a hash. */
function stampedAnchors(anchors, label, { repoRoot, sourceByPath, problems }) {
  if (!Array.isArray(anchors)) {
    problems.push(`${label} needs anchors as a list of source_path and symbol_name`);
    return [];
  }
  const stamped = anchors.map((anchor) => {
    problems.push(...unknownFieldProblems(anchor, INPUT_ANCHOR_FIELDS, `${label} anchor`));
    return { anchor_id: `${anchor.source_path}:${anchor.symbol_name}`, source_path: anchor.source_path, symbol_name: anchor.symbol_name };
  });
  const hashes = anchorHashes(repoRoot, stamped, sourceByPath);
  return stamped.map((anchor) => {
    if (hashes[anchor.anchor_id] === null || hashes[anchor.anchor_id] === undefined) problems.push(`${label} cites ${anchor.anchor_id}, which isn't in the code`);
    return { ...anchor, source_hash_sha256: hashes[anchor.anchor_id] ?? null };
  });
}

function nightShapeProblems(night) {
  if (!isObject(night)) return ["The night's record isn't an object"];
  const problems = unknownFieldProblems(night, NIGHT_FIELDS, "the night");
  for (const field of NIGHT_FIELDS) if (night[field] === undefined) problems.push(`the night has no ${field}`);
  for (const field of ["summary_line", "model_name"]) if (!isFilledText(night[field])) problems.push(`the night has no ${field}`);
  if (!ISO_TIME.test(night.started_at ?? "")) problems.push("the night needs started_at as an ISO time");
  if (!Number.isInteger(night.step_count) || night.step_count < 0) problems.push("the night needs step_count as a whole number");
  for (const field of ["is_contracts_checked", "is_grid_checked", "is_pattern_rules_checked"]) if (typeof night[field] !== "boolean") problems.push(`the night needs ${field} as true or false`);
  for (const field of ["way_rescores", "strength_refreshes", "new_ways", "new_items", "item_updates", "second_guesses"]) if (!Array.isArray(night[field])) problems.push(`the night needs ${field} as a list`);
  return problems;
}

/**
 * A night's record applied to the records, in memory. Answers the new records and every problem found;
 * with any problem the caller writes nothing, so a run fixes its record and calls again.
 */
export function applyNight({ promises, scales, items, reviews, night, now, date, reviewId, headCommit, repoRoot, mergeCount = 0 }) {
  const problems = nightShapeProblems(night);
  if (problems.length) return { problems };
  const context = { repoRoot, sourceByPath: new Map(), problems };
  const nextPromises = structuredClone(promises);
  const wayIndex = new Map(nextPromises.flatMap((promise) => promise.ways_to_break.map((way, index) => [way.way_id, { promise, index }])));

  for (const rescore of night.way_rescores) {
    problems.push(...unknownFieldProblems(rescore, WAY_RESCORE_FIELDS, `rescore of ${rescore.way_id}`));
    const found = wayIndex.get(rescore.way_id);
    if (!found) {
      problems.push(`rescore of ${rescore.way_id}: no way has that way_id`);
      continue;
    }
    const way = found.promise.ways_to_break[found.index];
    try {
      found.promise.ways_to_break[found.index] = rescoreWay(way, { defense_score: rescore.defense_score, defense_reason: rescore.defense_reason, damage_score: rescore.damage_score, damage_reason: rescore.damage_reason, changed_because: rescore.changed_because, now, currentHashes: anchorHashes(repoRoot, way.anchors, context.sourceByPath) });
    } catch (error) {
      problems.push(error.message);
    }
  }

  for (const refresh of night.strength_refreshes) {
    problems.push(...unknownFieldProblems(refresh, STRENGTH_REFRESH_FIELDS, "a strength refresh"));
    const promise = nextPromises.find((candidate) => candidate.sector_id === refresh.sector_id);
    const strength = promise?.strengths.find((candidate) => candidate.strength_line === refresh.strength_line);
    if (!strength) {
      problems.push(`strength refresh: ${refresh.sector_id} has no strength with that strength_line`);
      continue;
    }
    const currentHashes = anchorHashes(repoRoot, strength.anchors, context.sourceByPath);
    strength.strength_reason = refresh.strength_reason;
    strength.anchors = strength.anchors.map((anchor) => ({ ...anchor, source_hash_sha256: currentHashes[anchor.anchor_id] ?? null }));
    strength.strength_stale_reason = null;
  }

  const newWayIds = [];
  for (const input of night.new_ways) {
    problems.push(...unknownFieldProblems(input, NEW_WAY_FIELDS, `new way ${input.way_id}`));
    const promise = nextPromises.find((candidate) => candidate.sector_id === input.sector_id);
    if (!promise) {
      problems.push(`new way ${input.way_id}: ${input.sector_id} isn't a sector`);
      continue;
    }
    const anchors = stampedAnchors(input.anchors, `new way ${input.way_id}`, context);
    promise.ways_to_break.push({ way_id: input.way_id, way_line: input.way_line, defense_score: input.defense_score, defense_reason: input.defense_reason, damage_score: input.damage_score, damage_reason: input.damage_reason, anchors, scored_at: now, score_stale_reason: null, score_changes: [] });
    newWayIds.push(input.way_id);
  }

  const itemsById = new Map(refreshItems(items, repoRoot).map((item) => [item.item_id, item]));
  const updatedItemIds = [];
  const forJulius = [];
  for (const update of night.item_updates) {
    const item = itemsById.get(update.item_id);
    if (!item) {
      problems.push(`update: no item has item_id ${update.item_id}`);
      continue;
    }
    const anchors = update.anchors === undefined ? item.anchors : stampedAnchors(update.anchors, `update to ${item.item_id}`, context);
    const currentHashes = anchorHashes(repoRoot, anchors, context.sourceByPath);
    const result = itemWithUpdate(item, update, { now, commit: headCommit, anchors, currentHashes });
    problems.push(...result.problems);
    if (!result.item) continue;
    itemsById.set(item.item_id, result.item);
    updatedItemIds.push(item.item_id);
    if (item.item_state === "accepted") forJulius.push(`${item.item_id} is an accepted risk with new evidence: ${update.evidence_line}`);
  }

  const openedItemIds = [];
  const openItem = (item) => {
    itemsById.set(item.item_id, item);
    openedItemIds.push(item.item_id);
  };
  for (const input of night.new_items) {
    const anchors = stampedAnchors(input.anchors, `new item ${input.item_slug}`, context);
    const result = itemFromNight(input, { date, now, anchors });
    problems.push(...result.problems);
    if (!result.item) continue;
    if (itemsById.has(result.item.item_id)) problems.push(`${result.item.item_id} exists already: findings on it are evidence`);
    if (!wayIndex.has(input.way_id) && !newWayIds.includes(input.way_id)) problems.push(`${result.item.item_id} names way_id ${input.way_id}, and no way has it`);
    const twin = [...itemsById.values()].find((other) => other.item_state !== "closed_unproven" && itemMatchKeyOf(other) === itemMatchKeyOf(result.item));
    if (twin) problems.push(`${result.item.item_id} is the same way and cited code as ${twin.item_id}: add evidence to that one`);
    if (!problems.length) openItem(result.item);
  }

  const secondGuessWayIds = [];
  const disagreements = [];
  for (const guess of night.second_guesses) {
    problems.push(...unknownFieldProblems(guess, SECOND_GUESS_FIELDS, `second guess of ${guess.way_id}`));
    const found = wayIndex.get(guess.way_id);
    if (!found) {
      problems.push(`second guess: no way has way_id ${guess.way_id}`);
      continue;
    }
    if (!isScore(guess.defense_score) || !isScore(guess.damage_score) || !isFilledText(guess.guess_reason)) {
      problems.push(`second guess of ${guess.way_id} needs both scores, 1 to 5, and guess_reason`);
      continue;
    }
    const way = found.promise.ways_to_break[found.index];
    secondGuessWayIds.push(way.way_id);
    const guessed = priorityOf(guess.defense_score, guess.damage_score);
    const recorded = priorityOf(way.defense_score, way.damage_score);
    if (guessed === recorded) continue;
    disagreements.push(way.way_id);
    const line = `A blind look placed this at ${guessed} (defense ${guess.defense_score}, damage ${guess.damage_score}): ${guess.guess_reason}`;
    const open = [...itemsById.values()].find((item) => item.way_id === way.way_id && isOpenItem(item));
    if (open) {
      itemsById.set(open.item_id, { ...open, evidence: [...open.evidence, { added_at: now, evidence_line: line, rests_on_commit: headCommit }] });
      updatedItemIds.push(open.item_id);
      continue;
    }
    const opened = itemFromNight({ item_slug: `second-guess-${way.way_id}`, item_kind: "question", sector_id: found.promise.sector_id, way_id: way.way_id, item_line: `A blind look and the record place ${way.way_id} differently: ${guessed} against ${recorded}.`, goal_line: `After this, the scores of ${way.way_id} rest on facts both looks accept.`, opened_by: "second_guess", defense_score: way.defense_score, defense_reason: way.defense_reason, damage_score: way.damage_score, damage_reason: way.damage_reason }, { date, now, anchors: way.anchors });
    problems.push(...opened.problems);
    if (opened.item) openItem({ ...opened.item, evidence: [{ added_at: now, evidence_line: line, rests_on_commit: headCommit }] });
  }

  const closedQuestionIds = [];
  for (const item of itemsById.values()) {
    if (!isQuestionPastLifetime(item, date)) continue;
    itemsById.set(item.item_id, { ...item, item_state: "closed_unproven", evidence: [...item.evidence, { added_at: now, evidence_line: `Closed unproven after ${QUESTION_LIFETIME_DAYS} days.`, rests_on_commit: headCommit }] });
    closedQuestionIds.push(item.item_id);
  }

  const assigned = challengeOf(promises, reviews);
  const challenge = night.challenge;
  if (!isObject(challenge)) problems.push("the night needs challenge: sector_id, way_ids_done, is_finished, stopped_because");
  else {
    problems.push(...unknownFieldProblems(challenge, CHALLENGE_FIELDS, "the challenge"));
    if (challenge.sector_id !== assigned.sector_id) problems.push(`the challenge is on ${challenge.sector_id}, and tonight's is ${assigned.sector_id}`);
    if (!Array.isArray(challenge.way_ids_done)) problems.push("the challenge needs way_ids_done as a list");
    if (typeof challenge.is_finished !== "boolean") problems.push("the challenge needs is_finished as true or false");
    if (!challenge.is_finished && !isFilledText(challenge.stopped_because)) problems.push("a challenge not finished says why in stopped_because, so the next night picks it up");
  }
  const wayIdsDone = [...new Set([...assigned.way_ids_done, ...(challenge?.way_ids_done ?? []), ...newWayIds.filter((wayId) => nextPromises.find((promise) => promise.sector_id === assigned.sector_id)?.ways_to_break.some((way) => way.way_id === wayId))])];
  const challengedPromise = nextPromises.find((promise) => promise.sector_id === assigned.sector_id);
  if (challenge?.is_finished) {
    const missing = challengedPromise.ways_to_break.map((way) => way.way_id).filter((wayId) => !wayIdsDone.includes(wayId));
    if (missing.length) problems.push(`the challenge says finished, and these ways weren't looked at: ${missing.join(", ")}`);
  }

  const nextItems = [...itemsById.values()];
  for (const item of nextItems) problems.push(...itemProblems(item));
  problems.push(...promiseProblems({ scales, promises: nextPromises }));
  const openFixNowWays = new Set(nextItems.filter((item) => item.item_kind === "item" && isOpenItem(item) && priorityOfItem(item) === "fix_now").map((item) => item.way_id));
  for (const way of allWaysOf(nextPromises)) if (priorityOf(way.defense_score, way.damage_score) === "fix_now" && !openFixNowWays.has(way.way_id)) problems.push(`${way.way_id} stands at fix now with no open item at fix now: open one, with its proof`);
  if (problems.length) return { problems };

  const findings = [];
  const queueLines = [];
  for (const item of nextItems) {
    if (item.item_kind !== "item" || !isOpenItem(item) || priorityOfItem(item) !== "fix_now" || item.finding_id) continue;
    const [, day, slug] = item.item_id.match(/^itm_(\d{4}-\d{2}-\d{2})_(.+)$/);
    const findingId = `fnd_${day}_${slug}`;
    const findingPath = `findings/${day}-${slug}.md`;
    const text = withFindingStatus([`# ${item.item_line}`, "", `- Finding: ${findingId}. Item: ${item.item_id}.`, `- Sector: ${item.sector_id}. Way to break: ${item.way_id}.`, `- Goal: ${item.goal_line}`, `- Defense ${item.defense_score}: ${item.defense_reason}`, `- Damage ${item.damage_score}: ${item.damage_reason}`, `- Proof: ${item.proof_line}${item.test_path ? ` (${item.test_path})` : ""}`, `- Cited code: ${item.anchors.map((anchor) => anchor.anchor_id).join(", ") || "none"}`].join("\n"), "open: no branch, from the daily review");
    findings.push({ path: findingPath, text });
    queueLines.push(`URGENT: ${sectorNameOf(item.sector_id)}, ${findingPath}`, `Security fix: ${findingPath}; tier urgent; no branch: from the daily review`);
    itemsById.set(item.item_id, { ...item, finding_id: findingId });
  }

  return {
    problems: [],
    promises: nextPromises,
    items: [...itemsById.values()],
    findings,
    queue_lines: queueLines,
    for_julius: forJulius,
    review: {
      review_id: reviewId,
      review_date: date,
      started_at: night.started_at,
      finished_at: now,
      reviewed_commit: headCommit,
      model_name: night.model_name,
      step_count: night.step_count,
      merge_count: mergeCount,
      is_contracts_checked: night.is_contracts_checked,
      is_grid_checked: night.is_grid_checked,
      is_pattern_rules_checked: night.is_pattern_rules_checked,
      rescored_way_ids: night.way_rescores.map((rescore) => rescore.way_id),
      new_way_ids: newWayIds,
      opened_item_ids: openedItemIds,
      updated_item_ids: updatedItemIds,
      closed_question_ids: closedQuestionIds,
      second_guess_way_ids: secondGuessWayIds,
      second_guess_disagreement_way_ids: disagreements,
      challenge: { sector_id: assigned.sector_id, way_ids_done: wayIdsDone, is_finished: challenge.is_finished, stopped_because: challenge.is_finished ? null : challenge.stopped_because },
      summary_line: night.summary_line,
    },
  };
}

/** The file a review goes in: reviews/<date>.json, or <date>-<n>.json for a run asked to go again that day. */
function reviewIdFor(mapDir, date, isAgain) {
  const taken = existsSync(join(mapDir, "reviews")) ? readdirSync(join(mapDir, "reviews")).filter((name) => name.startsWith(date)) : [];
  if (!taken.length) return date;
  if (!isAgain) throw new Error(`reviews/${date}.json exists: ${date} was reviewed already. A second run that day says so with --again.`);
  return `${date}-${taken.length + 1}`;
}

/** review-finish: the night checked whole, then written, exported when the map moved, committed and pushed. */
export function finishReview({ repoRoot, mapDir, night, now, date, isAgain = false }) {
  const editedItems = run("git", ["status", "--porcelain", "--", "items"], mapDir);
  if (editedItems) throw new Error(`items/ changed by hand (${editedItems.split("\n").join(", ")}). An item changes only through this call: put the files back with \`git checkout -- items\` and say the change in the night's item_updates.`);
  const reviewId = reviewIdFor(mapDir, date, isAgain);
  const stored = readPromises(mapDir);
  const reviews = readReviews(mapDir);
  const refreshed = refreshPromises({ stored, repoRoot });
  const headCommit = run("git", ["rev-parse", "HEAD"], repoRoot);
  const result = applyNight({ promises: refreshed.promises, scales: stored.scales, items: readItems(mapDir), reviews, night, now, date, reviewId, headCommit, repoRoot, mergeCount: mergesSince(repoRoot, reviews.at(-1)?.finished_at ?? null).merges.length });
  if (result.problems.length) throw new Error(`The night's record has problems, and nothing was written:\n  ${result.problems.join("\n  ")}`);
  const isMapMoved = Boolean(run("git", ["status", "--porcelain", "--", "map"], mapDir));
  writePromises(mapDir, { promises: result.promises });
  writeItems(mapDir, result.items);
  mkdirSync(join(mapDir, "reviews"), { recursive: true });
  writeFileSync(join(mapDir, `reviews/${reviewId}.json`), `${JSON.stringify(result.review, null, 2)}\n`);
  mkdirSync(join(mapDir, "findings"), { recursive: true });
  for (const finding of result.findings) writeFileSync(join(mapDir, finding.path), finding.text);
  if (result.queue_lines.length) writeFileSync(join(mapDir, "queue.md"), withQueueLines(existsSync(join(mapDir, "queue.md")) ? readFileSync(join(mapDir, "queue.md"), "utf8") : "# Queue\n", result.queue_lines));
  const { review } = result;
  const logLine = `${reviewId}: daily review: ${night.summary_line} (${review.merge_count} merges, ${review.rescored_way_ids.length} rescored, ${review.opened_item_ids.length} items opened, challenged ${review.challenge.sector_id}${review.challenge.is_finished ? "" : " partway"}, contracts ${review.is_contracts_checked ? "checked" : "not checked"}, ${review.step_count} steps)`;
  writeFileSync(join(mapDir, "log.md"), `${existsSync(join(mapDir, "log.md")) ? readFileSync(join(mapDir, "log.md"), "utf8").replace(/\n*$/, "\n") : ""}${logLine}\n`);
  if (isMapMoved) {
    exportMapDir({ mapDir, now, date });
    const leaks = checkMapDirExport({ mapDir });
    if (leaks.length) throw new Error(`The public export leaks, and nothing was pushed: ${leaks.join("; ")}.`);
  }
  const pushed = commitAndPush(mapDir, { message: `Daily review ${reviewId}` });
  return { review_id: reviewId, ...pushed, committed_paths: undefined, committed_path_count: pushed.committed_paths.length, is_map_exported: isMapMoved, opened_item_ids: review.opened_item_ids, closed_question_ids: review.closed_question_ids, fix_now_findings: result.findings.map((finding) => finding.path), for_julius: result.for_julius };
}

/** The steps the reviews counted in a span of days, for the week's count: their transcripts are in their sandboxes, not on any Mac. */
export function reviewStepCountOf(mapDir, { fromDate, toDate }) {
  const reviews = readReviews(mapDir).filter((review) => review.review_date >= fromDate.slice(0, 10) && review.review_date <= toDate.slice(0, 10));
  return { review_count: reviews.length, total_step_count: reviews.reduce((sum, review) => sum + review.step_count, 0), step_counts: reviews.map((review) => ({ review_id: review.review_id, step_count: review.step_count, model_name: review.model_name })) };
}
