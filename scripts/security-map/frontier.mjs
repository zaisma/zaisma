import { createHash } from "node:crypto";
import { caseRefOf, coveragePctOf } from "./schema.mjs";

/**
 * A night's work, picked from the map with no model: every stale case first, then a deterministic tenth
 * of the probe-backed robust ones re-checked (so a lazily passed case can't harden into a blind spot),
 * at most RECHECK_CASE_CAP, then unexplored cases from the least-covered sector, all within a budget.
 * And the leak-then-use chains not tried yet.
 */

/** Cases a nightly review can probe thoroughly; stale and recheck cases count against it. --budget changes it. */
export const NIGHTLY_CASE_BUDGET = 40;

/** The share of probe-backed robust cases re-checked each night. */
const RECHECK_SHARE = 0.1;

/**
 * The most rechecks a night, a quarter of the budget, so at least 30 of 40 cases always go to stale and
 * unexplored work. Only probe-backed cases are sampled: one backed by a test or ship check is proven
 * again by GitHub's check on every push and by every ship, so a probe adds nothing there (and day-one
 * seeding alone makes 600 of them, whose tenth would fill every night).
 */
export const RECHECK_CASE_CAP = 10;

const liveDoors = (sector) => sector.doors.filter((door) => !door.door_removed_at);

/** About a tenth of the given robust case refs, in a rank that's the same for one date and different across dates. */
export function recheckSample(robustCaseRefs, date) {
  const rank = (caseRef) => createHash("sha256").update(`${date}\n${caseRef}`).digest("hex");
  const ranked = robustCaseRefs.map((caseRef) => ({ caseRef, rank: rank(caseRef) })).sort((first, second) => (first.rank < second.rank ? -1 : first.rank > second.rank ? 1 : 0));
  return ranked.slice(0, Math.ceil(robustCaseRefs.length * RECHECK_SHARE)).map((ranked) => ranked.caseRef);
}

/** The night's ordered work list, each { bucket: "stale" | "recheck" | "unexplored", sector_id, door_id, case_id, case_ref }. */
export function pickFrontier(map, { date, budgetCaseCount = NIGHTLY_CASE_BUDGET }) {
  const item = (bucket, sector, door, theCase) => ({ bucket, sector_id: sector.sector_id, door_id: door.door_id, case_id: theCase.case_id, case_ref: caseRefOf(door, theCase) });
  const every = map.flatMap((sector) => liveDoors(sector).flatMap((door) => door.cases.map((theCase) => ({ sector, door, theCase }))));
  const stale = every.filter(({ theCase }) => theCase.status === "stale").map(({ sector, door, theCase }) => item("stale", sector, door, theCase));
  const robust = every.filter(({ theCase }) => theCase.status === "robust" && theCase.evidence?.kind === "probe");
  const sampled = new Set(recheckSample(robust.map(({ door, theCase }) => caseRefOf(door, theCase)), date).slice(0, RECHECK_CASE_CAP));
  const recheck = robust.filter(({ door, theCase }) => sampled.has(caseRefOf(door, theCase))).map(({ sector, door, theCase }) => item("recheck", sector, door, theCase));
  const sectorOrder = map
    .map((sector, index) => ({ sector, index, coveragePct: coveragePctOf(liveDoors(sector).flatMap((door) => door.cases)) }))
    .sort((first, second) => first.coveragePct - second.coveragePct || first.index - second.index)
    .map(({ sector }) => sector);
  const unexplored = sectorOrder.flatMap((sector) =>
    [...liveDoors(sector)]
      .sort((first, second) => first.door_id.localeCompare(second.door_id))
      .flatMap((door) => door.cases.filter((theCase) => theCase.status === "unexplored").map((theCase) => item("unexplored", sector, door, theCase))),
  );
  return [...stale, ...recheck, ...unexplored].slice(0, budgetCaseCount);
}

/**
 * Leak-then-use chains not tried yet: for each thing, every door that gives it crossed with every other
 * door that trusts it, minus the pairs in chains-tried.json ({ thing, giver_door_id, truster_door_id }).
 */
export function chains(map, triedChains = []) {
  const tried = new Set(triedChains.map((chain) => `${chain.thing}\n${chain.giver_door_id}\n${chain.truster_door_id}`));
  const doors = map.flatMap(liveDoors).sort((first, second) => first.door_id.localeCompare(second.door_id));
  const things = [...new Set(doors.flatMap((door) => door.gives ?? []))].sort();
  return things.flatMap((thing) => {
    const givers = doors.filter((door) => door.gives?.includes(thing));
    const trusters = doors.filter((door) => door.trusts?.includes(thing));
    return givers.flatMap((giver) =>
      trusters.filter((truster) => truster.door_id !== giver.door_id && !tried.has(`${thing}\n${giver.door_id}\n${truster.door_id}`)).map((truster) => ({ thing, giver_door_id: giver.door_id, truster_door_id: truster.door_id })),
    );
  });
}
