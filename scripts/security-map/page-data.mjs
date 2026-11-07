import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readMap } from "./generate.mjs";
import { FINISHED_STATES, isCaseItem, isOpenItem, isWayWaitingForRescore, priorityOfItem, readItems } from "./items.mjs";
import { readPromises } from "./promises.mjs";
import { DONE_STATUSES, hasOpenFinding, SECTORS } from "./schema.mjs";

/**
 * What the Security map page shows, worked out from the private repo's records. Every field is copied by
 * name, so a reason, an anchor, a proof or a finding id can't reach the page, and a score leaves only as the
 * words and picture of its step. The rules here are the page's: a shield follows its worst open item, and
 * only a proven item moves one. A way an item closed after its last score shows as fixed and waiting for its
 * rescore, never as work ahead. A bug is never a way to break: a found one is an open item on the cases it sits
 * in, and the ones not found yet show as each sector's case coverage, how much of its doors' checklist is
 * tested and solid against how much is unexplored or stale.
 */

/** A shield's states, from whole to worst. */
export const SHIELD_STATES = ["whole", "cracked", "chipped", "torn"];
const SHIELD_STATE_BY_PRIORITY = { watch: "whole", fix_soon: "cracked", harden: "chipped", fix_now: "torn" };
/** The priorities that need attention, in the order they're shown. */
const ATTENTION_PRIORITIES = ["fix_now", "harden", "fix_soon"];

/**
 * A thin spot: a way whose damage reaches many games, everyone or money while its defense is one lock or
 * less, with no proven, open item that carries its whole weight. It never moves a shield; it's work ahead.
 */
export const MINIMUM_THIN_DAMAGE_SCORE = 4;
export const MAXIMUM_THIN_DEFENSE_SCORE = 3;

/** The pictures of a damage score and a defense score, from score 1 to score 5. */
export const HARM_LEVELS = ["one_player", "a_few", "one_game", "many_games", "everyone"];
export const LOCK_LEVELS = ["open", "key_in_it", "locked", "two_locks", "vault"];

/** A question has no proof yet, so it never moves a shield; the items that do are the proven, open ones. */
export const isShieldItem = (item) => item.item_kind === "item" && isOpenItem(item);

const worstStateOf = (states) => SHIELD_STATES[Math.max(0, ...states.map((state) => SHIELD_STATES.indexOf(state)))];

export const shieldStateOfItem = (item) => SHIELD_STATE_BY_PRIORITY[priorityOfItem(item)];

/** A sector's shield from its items, or Zaisma's from all of them: the worst open item decides. */
export const shieldStateOf = (items) => worstStateOf(items.filter(isShieldItem).map(shieldStateOfItem));

function harmAndLockOf({ damage_score, defense_score }, scales) {
  return {
    harm_level: HARM_LEVELS[damage_score - 1],
    harm_line: scales.damage_steps[damage_score - 1].step_example,
    lock_level: LOCK_LEVELS[defense_score - 1],
    lock_line: scales.defense_steps[defense_score - 1].step_example,
  };
}

const isThinScore = ({ damage_score, defense_score }) => damage_score >= MINIMUM_THIN_DAMAGE_SCORE && defense_score <= MAXIMUM_THIN_DEFENSE_SCORE;

/** An item answers a thin way when it's proven, open, on that way, and scored at the way's harm or more and its lock or less. */
const isAnsweredBy = (way, sectorId) => (item) => isShieldItem(item) && item.sector_id === sectorId && item.way_id === way.way_id && item.damage_score >= way.damage_score && item.defense_score <= way.defense_score;

/** The thin spots, worst harm first, then the weakest lock, then rollout order. A way fixed and waiting for its rescore isn't one: its score predates the fix. */
export function thinWaysOf(promises, items, scales) {
  return [...promises]
    .sort((first, second) => first.rollout_position - second.rollout_position)
    .flatMap((promise) => promise.ways_to_break.filter((way) => isThinScore(way) && !items.some(isAnsweredBy(way, promise.sector_id)) && !isWayWaitingForRescore(way, promise.sector_id, items)).map((way) => ({ promise, way })))
    .sort((first, second) => second.way.damage_score - first.way.damage_score || first.way.defense_score - second.way.defense_score)
    .map(({ promise, way }) => ({ sector_id: promise.sector_id, sector_name: sectorNameOf(promise.sector_id), way_line: way.way_line, ...harmAndLockOf(way, scales) }));
}

/** The ways an item closed after their last score: fixed, waiting for the rescore that says where they stand now, in rollout order. */
export function rescoreWaitingWaysOf(promises, items) {
  return [...promises]
    .sort((first, second) => first.rollout_position - second.rollout_position)
    .flatMap((promise) => promise.ways_to_break.filter((way) => isWayWaitingForRescore(way, promise.sector_id, items)).map((way) => ({ sector_id: promise.sector_id, sector_name: sectorNameOf(promise.sector_id), way_line: way.way_line })));
}

function itemStandingOf(item, items) {
  if (item.item_state === "doing") return "being_fixed";
  if (item.calls.length) return "waits_on_your_call";
  const isWaitOpen = (wait) => !FINISHED_STATES.includes(items.find((other) => other.item_id === wait)?.item_state);
  return item.waits_on.some(isWaitOpen) ? "waits_on_other_work" : "up_next";
}

const sectorNameOf = (sectorId) => SECTORS.find((sector) => sector.sector_id === sectorId)?.sector_name ?? sectorId;

function attentionItemsOf(items, scales) {
  const placeOf = (item) => ATTENTION_PRIORITIES.indexOf(priorityOfItem(item));
  return items
    .filter((item) => isShieldItem(item) && placeOf(item) !== -1)
    .sort((first, second) => placeOf(first) - placeOf(second) || second.damage_score - first.damage_score || first.defense_score - second.defense_score || first.item_id.localeCompare(second.item_id))
    .map((item) => ({
      sector_id: item.sector_id,
      sector_name: sectorNameOf(item.sector_id),
      shield_state: shieldStateOfItem(item),
      item_line: item.item_line,
      goal_line: item.goal_line,
      item_standing: itemStandingOf(item, items),
      ...harmAndLockOf(item, scales),
    }));
}

/**
 * How much of a sector's doors' checklist is known: tested and solid (robust or fixed), unexplored, stale
 * (its code changed since the verdict), and found soft (weak) or open (a hole, or a stale case that was one).
 */
export function caseCoverageOf(doors) {
  const cases = doors.filter((door) => !door.door_removed_at).flatMap((door) => door.cases);
  const solidCount = cases.filter((theCase) => DONE_STATUSES.includes(theCase.status)).length;
  return {
    case_count: cases.length,
    solid_case_count: solidCount,
    solid_case_pct: cases.length ? Math.floor((solidCount / cases.length) * 100) : 0,
    unexplored_case_count: cases.filter((theCase) => theCase.status === "unexplored").length,
    stale_case_count: cases.filter((theCase) => theCase.status === "stale" && !hasOpenFinding(theCase)).length,
    weak_case_count: cases.filter((theCase) => theCase.status === "weak").length,
    hole_case_count: cases.filter(hasOpenFinding).length,
  };
}

const PRIORITY_ORDER = ["fix_now", "harden", "fix_soon", "watch"];

/** A sector's open items about cases, proven or not: each a bug found or suspected, open until a test guards its fix. Worst first. */
function caseItemsOf(sectorItems, items, scales) {
  return sectorItems
    .filter((item) => isCaseItem(item) && isOpenItem(item))
    .sort((first, second) => PRIORITY_ORDER.indexOf(priorityOfItem(first)) - PRIORITY_ORDER.indexOf(priorityOfItem(second)) || second.damage_score - first.damage_score || first.item_id.localeCompare(second.item_id))
    .map((item) => ({ item_line: item.item_line, goal_line: item.goal_line, is_question: item.item_kind === "question", shield_state: shieldStateOfItem(item), item_standing: itemStandingOf(item, items), ...harmAndLockOf(item, scales) }));
}

/** The page's whole data: one shield for Zaisma, one per sector in rollout order, what needs attention, the thin spots and the work ahead. grid and patterns are null before their first run. */
export function pageDataOf({ scales, promises, items, map = [], grid, patterns, lastReviewDate }) {
  const shieldItems = items.filter(isShieldItem);
  const countOfPriority = (priority) => shieldItems.filter((item) => priorityOfItem(item) === priority).length;
  const attentionItems = attentionItemsOf(items, scales);
  const thinWays = thinWaysOf(promises, items, scales);
  const rescoreWaitingWays = rescoreWaitingWaysOf(promises, items);
  const workAhead = {
    fix_now_count: countOfPriority("fix_now"),
    harden_count: countOfPriority("harden"),
    fix_soon_count: countOfPriority("fix_soon"),
    watch_count: countOfPriority("watch"),
    question_count: items.filter((item) => item.item_kind === "question" && isOpenItem(item)).length,
    grid_failure_count: (grid?.failures.length ?? 0) + (grid?.doors_not_tried.length ?? 0),
    pattern_finding_count: patterns?.findings.length ?? 0,
    thin_way_count: thinWays.length,
    rescore_waiting_count: rescoreWaitingWays.length,
    changed_code_count: promises.flatMap((promise) => [...promise.strengths.map((strength) => strength.strength_stale_reason), ...promise.ways_to_break.map((way) => way.score_stale_reason)]).filter(Boolean).length,
  };
  return {
    shield_state: shieldStateOf(items),
    attention_count: attentionItems.length,
    ahead_count: workAhead.watch_count + workAhead.question_count + workAhead.grid_failure_count + workAhead.pattern_finding_count,
    last_review_date: lastReviewDate,
    sectors: [...promises]
      .sort((first, second) => first.rollout_position - second.rollout_position)
      .map((promise) => {
        const sectorItems = items.filter((item) => item.sector_id === promise.sector_id);
        const sectorMap = map.find((sector) => sector.sector_id === promise.sector_id);
        return {
          sector_id: promise.sector_id,
          sector_name: sectorNameOf(promise.sector_id),
          shield_state: shieldStateOf(sectorItems),
          promise_line: promise.promise_line,
          open_item_count: sectorItems.filter((item) => isShieldItem(item) && priorityOfItem(item) !== "watch").length,
          watch_item_count: sectorItems.filter((item) => isShieldItem(item) && priorityOfItem(item) === "watch").length,
          strengths: promise.strengths.map(({ strength_kind, strength_line }) => ({ strength_kind, strength_line })),
          ways: promise.ways_to_break.map((way) => ({ way_line: way.way_line, is_waiting_for_rescore: isWayWaitingForRescore(way, promise.sector_id, items), ...harmAndLockOf(way, scales) })),
          has_doors: !SECTORS.find((sector) => sector.sector_id === promise.sector_id)?.has_no_doors,
          case_coverage: caseCoverageOf(sectorMap?.doors ?? []),
          case_items: caseItemsOf(sectorItems, items, scales),
        };
      }),
    attention_items: attentionItems,
    thin_ways: thinWays,
    rescore_waiting_ways: rescoreWaitingWays,
    work_ahead: workAhead,
  };
}

/** The newest reviews/<date>.json's day, or null before the first review. */
export function lastReviewDateOf(mapDir) {
  const reviewsPath = join(mapDir, "reviews");
  if (!existsSync(reviewsPath)) return null;
  return readdirSync(reviewsPath).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, 10)).sort().at(-1) ?? null;
}

const readJsonOrNull = (filePath) => (existsSync(filePath) ? JSON.parse(readFileSync(filePath, "utf8")) : null);

/** The records a shield or a printed promise rests on, as the private repo holds them. */
export function readPageInputs(mapDir) {
  return {
    ...readPromises(mapDir),
    items: readItems(mapDir),
    map: readMap(mapDir),
    grid: readJsonOrNull(join(mapDir, "grid", "failures.json")),
    patterns: readJsonOrNull(join(mapDir, "patterns", "findings.json")),
    lastReviewDate: lastReviewDateOf(mapDir),
  };
}

/** The page's data from the private repo, or null while it has no promises yet. */
export function pageDataOfMapDir(mapDir) {
  const inputs = readPageInputs(mapDir);
  return inputs.scales && inputs.promises.length ? pageDataOf(inputs) : null;
}

/** What the README's "Map page shows:" line holds: it changes exactly when the page would. */
export const pageDataHashOf = (pageData) => createHash("sha256").update(JSON.stringify(pageData)).digest("hex");
