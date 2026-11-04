import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error: a plain JavaScript script without types
import { itemFromNight, itemProblems, itemsWithFindingFixed, itemWithUpdate, isQuestionPastLifetime, readItems, writeItems } from "../../scripts/security-map/items.mjs";
// @ts-expect-error: a plain JavaScript script without types
import { readState } from "../../scripts/security-map/private-repo.mjs";
// @ts-expect-error: a plain JavaScript script without types
import { readPromises, writePromises } from "../../scripts/security-map/promises.mjs";
// @ts-expect-error: a plain JavaScript script without types
import { applyNight, challengeOf, finishReview, mergesSince, readGridFailures, readReviews, reviewOutlineOf, reviewStepCountOf, SECOND_GUESS_WAY_COUNT, secondGuessSampleOf } from "../../scripts/security-map/review.mjs";
// @ts-expect-error: a plain JavaScript script without types
import { SECTOR_IDS, SECTORS } from "../../scripts/security-map/schema.mjs";
import { temporaryFolder } from "../temporary-folder.ts";

/**
 * The daily review's records and calls (scripts/security-map/review.mjs, items.mjs): how a record may change is
 * refused in code, a night applies whole or not at all, and the git round trip runs against a local bare repo
 * standing in for zaisma/security.
 */

const DATE = "2026-11-04";
const NOW = "2026-11-04T07:53:00.000Z";
const COMMIT = "abc1234";
const GIT_IDENTITY = { GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" };
const SOURCE = "export function guardCall(input) {\n  return input === 1;\n}\n\nexport function otherCall(input) {\n  return input === 2;\n}\n";
const ANCHOR = { source_path: "src/guard.ts", symbol_name: "guardCall" };

type Anchor = { anchor_id: string; source_path: string; symbol_name: string; source_hash_sha256: string | null };
type Way = { way_id: string; way_line: string; defense_score: number; defense_reason: string; damage_score: number; damage_reason: string; anchors: Anchor[]; scored_at: string; score_stale_reason: string | null; score_changes: unknown[] };
type Promise_ = { sector_id: string; rollout_position: number; promise_line: string; strengths: unknown[]; ways_to_break: Way[] };
type Item = Record<string, any>;

let workDir = "";
let repoRoot = "";
const savedEnvironment = { ...process.env };
beforeEach(() => {
  workDir = temporaryFolder("security-review-");
  repoRoot = join(workDir, "code");
  mkdirSync(join(repoRoot, "src"), { recursive: true });
  writeFileSync(join(repoRoot, "src/guard.ts"), SOURCE);
  Object.assign(process.env, GIT_IDENTITY);
  git(repoRoot, "init", "--quiet", "--initial-branch=main");
  git(repoRoot, "add", "-A");
  git(repoRoot, "commit", "--quiet", "-m", "Start");
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  process.env = { ...savedEnvironment };
});

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const scales = () => ({ defense_steps: [1, 2, 3, 4, 5].map((step_score) => ({ step_score, step_example: "example" })), damage_steps: [1, 2, 3, 4, 5].map((step_score) => ({ step_score, step_example: "example" })) });

function way(wayId: string, defense = 3, damage = 3): Way {
  return { way_id: wayId, way_line: `The way ${wayId}`, defense_score: defense, defense_reason: "reason", damage_score: damage, damage_reason: "reason", anchors: [{ anchor_id: "src/guard.ts:guardCall", ...ANCHOR, source_hash_sha256: null }], scored_at: NOW, score_stale_reason: null, score_changes: [] };
}

function promisesFixture(): Promise_[] {
  return SECTOR_IDS.map((sectorId: string, index: number) => ({ sector_id: sectorId, rollout_position: index + 1, promise_line: `Promise of ${sectorId}`, strengths: [{ strength_kind: "tested", strength_line: `Strength of ${sectorId}`, strength_reason: "reason", anchors: [{ anchor_id: "src/guard.ts:guardCall", ...ANCHOR, source_hash_sha256: null }], strength_stale_reason: null }], ways_to_break: [way(`${sectorId}-first`), way(`${sectorId}-second`)] }));
}

const firstSector = SECTOR_IDS[0];

function night(extra: Record<string, unknown> = {}) {
  return { summary_line: "A quiet night", model_name: "claude-opus-5-5", started_at: NOW, step_count: 42, is_contracts_checked: false, is_grid_checked: false, way_rescores: [], strength_refreshes: [], new_ways: [], new_items: [], item_updates: [], second_guesses: [], challenge: { sector_id: firstSector, way_ids_done: [], is_finished: false, stopped_because: "out of steps" }, ...extra };
}

function newItem(extra: Record<string, unknown> = {}) {
  return { item_slug: "some-gap", item_kind: "item", sector_id: firstSector, way_id: `${firstSector}-first`, item_line: "A gap in the first way.", goal_line: "After this, it's impossible unless the guard has a bug.", answer_kind: "make_harder", opened_by: "merge_catch_up", defense_score: 3, defense_reason: "reason", damage_score: 3, damage_reason: "reason", anchors: [ANCHOR], calls: [], waits_on: [], proof_kind: "cited_code", proof_line: "guardCall takes any input.", test_path: null, ...extra };
}

function apply(extra: Record<string, unknown> = {}, records: { items?: Item[]; reviews?: unknown[]; promises?: Promise_[]; date?: string } = {}) {
  return applyNight({ promises: records.promises ?? promisesFixture(), scales: scales(), items: records.items ?? [], reviews: records.reviews ?? [], night: night(extra), now: NOW, date: records.date ?? DATE, reviewId: records.date ?? DATE, headCommit: COMMIT, repoRoot });
}

const openedItem = (extra: Record<string, unknown> = {}) => apply({ new_items: [newItem(extra)] }).items[0] as Item;
const problemsOf = (extra: Record<string, unknown> = {}, records = {}) => (apply(extra, records).problems as string[]).join("\n");

describe("what a record may be", () => {
  it("opens an item with its proof, and holds nothing the shape doesn't name", () => {
    const item = openedItem();
    expect(item.item_id).toBe(`itm_${DATE}_some-gap`);
    expect(item.item_state).toBe("next");
    expect(item.anchors[0].source_hash_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(itemProblems(item)).toEqual([]);
    expect(itemProblems({ ...item, plan_steps: ["do this"] }).join()).toContain("unknown field plan_steps");
  });

  it("refuses an item with no proof: with no failing test or cited code it's a question", () => {
    expect(problemsOf({ new_items: [newItem({ proof_kind: null, proof_line: null })] })).toContain("it's a question");
    expect(problemsOf({ new_items: [newItem({ proof_kind: "failing_test", test_path: null })] })).toContain("needs test_path");
    expect(problemsOf({ new_items: [newItem({ proof_kind: "cited_code", anchors: [] })] })).toContain("needs anchors");
  });

  it("refuses a question at fix now, and a cited symbol that isn't in the code", () => {
    expect(problemsOf({ new_items: [newItem({ item_kind: "question", proof_kind: null, proof_line: null, defense_score: 1, damage_score: 5 })] })).toContain("can't stand at fix now");
    expect(problemsOf({ new_items: [newItem({ anchors: [{ source_path: "src/guard.ts", symbol_name: "nothingHere" }] })] })).toContain("isn't in the code");
  });

  it("holds one finding to one item: the same way and cited code adds evidence instead", () => {
    const item = openedItem();
    expect(problemsOf({ new_items: [newItem({ item_slug: "same-gap-again" })] }, { items: [item] })).toContain(`same way and cited code as ${item.item_id}`);
    expect(problemsOf({ new_items: [newItem({ item_slug: "same-gap-again", anchors: [{ source_path: "src/guard.ts", symbol_name: "otherCall" }] })] }, { items: [item] })).toBe("");
  });

  it("refuses a new item naming a way nobody listed", () => {
    expect(problemsOf({ new_items: [newItem({ way_id: "no-such-way" })] })).toContain("no way has it");
  });
});

describe("how a record may change", () => {
  const update = (item: Item, change: Record<string, unknown>) => itemWithUpdate(item, { item_id: item.item_id, ...change }, { now: NOW, commit: COMMIT, anchors: item.anchors, currentHashes: Object.fromEntries(item.anchors.map((anchor: Anchor) => [anchor.anchor_id, anchor.source_hash_sha256])) });

  it("changes only with new evidence, and never rewords what opened it", () => {
    const item = openedItem();
    expect(update(item, { item_state: "done" }).problems.join()).toContain("needs evidence_line");
    expect(update(item, { evidence_line: "New fact", item_line: "Reworded" }).problems.join()).toContain("unknown field item_line");
    expect(update(item, { evidence_line: "New fact", goal_line: "Reworded" }).problems.join()).toContain("unknown field goal_line");
    const changed = update(item, { evidence_line: "New fact", item_state: "done" }).item;
    expect(changed.item_state).toBe("done");
    expect(changed.item_line).toBe(item.item_line);
    expect(changed.evidence).toEqual([{ added_at: NOW, evidence_line: "New fact", rests_on_commit: COMMIT }]);
    expect(update(changed, { evidence_line: "New fact" }).problems.join()).toContain("repeats evidence");
  });

  it("moves a score only with the fact that changed, keeping the old one", () => {
    const item = openedItem();
    expect(update(item, { evidence_line: "New fact", defense_score: 4 }).problems.join()).toContain("changed_because");
    const moved = update(item, { evidence_line: "New fact", defense_score: 4, changed_because: "A check now sits in front" }).item;
    expect(moved.score_changes).toHaveLength(1);
    expect(moved.score_changes[0]).toMatchObject({ old_defense_score: 3, new_defense_score: 4, changed_because: "A check now sits in front" });
  });

  it("lets a run set only next or done", () => {
    const item = openedItem();
    for (const state of ["doing", "accepted", "closed_unproven"]) expect(update(item, { evidence_line: "New fact", item_state: state }).problems.join()).toContain("a run only sets");
  });

  it("gives an accepted item evidence and nothing else, and tells Julius", () => {
    const accepted: Item = { ...openedItem(), item_state: "accepted" };
    expect(update(accepted, { evidence_line: "New fact", item_state: "next" }).problems.join()).toContain("reopening it is Julius's");
    expect(update(accepted, { evidence_line: "New fact", defense_score: 1, changed_because: "x" }).problems.join()).toContain("reopening it is Julius's");
    const result = apply({ item_updates: [{ item_id: accepted.item_id, evidence_line: "New fact" }] }, { items: [accepted] });
    expect(result.problems).toEqual([]);
    expect(result.items[0].item_state).toBe("accepted");
    expect(result.for_julius.join()).toContain("New fact");
  });

  it("turns a question into an item once it has proof", () => {
    const question = openedItem({ item_kind: "question", proof_kind: null, proof_line: null });
    const proven = update(question, { evidence_line: "Found it", proof_kind: "cited_code", proof_line: "guardCall takes any input." });
    expect(proven.problems).toEqual([]);
    expect(proven.item.item_kind).toBe("item");
  });

  it("marks an item whose code changed stale, and clears that when it's looked at again", () => {
    const item = openedItem();
    writeFileSync(join(repoRoot, "src/guard.ts"), SOURCE.replace("input === 1", "input === 3"));
    const later = apply({}, { items: [item] });
    expect(later.items[0].score_stale_reason).toContain("changed");
    const lookedAt = apply({ item_updates: [{ item_id: item.item_id, evidence_line: "Read the new code" }] }, { items: [item] });
    expect(lookedAt.items[0].score_stale_reason).toBeNull();
  });
});

describe("a question's lifetime", () => {
  it("closes unproven at 14 days and not before", () => {
    const question = openedItem({ item_kind: "question", proof_kind: null, proof_line: null });
    expect(isQuestionPastLifetime(question, "2026-11-17")).toBe(false);
    expect(isQuestionPastLifetime(question, "2026-11-18")).toBe(true);
    const closed = apply({}, { items: [question], date: "2026-11-18" });
    expect(closed.items[0].item_state).toBe("closed_unproven");
    expect(closed.review.closed_question_ids).toEqual([question.item_id]);
    expect(isQuestionPastLifetime(openedItem(), "2027-01-01")).toBe(false);
  });
});

describe("the night's other rules", () => {
  it("refuses a field it doesn't know and a field it needs, and applies nothing", () => {
    const result = apply({ made_up: 1 });
    expect(result.problems.join()).toContain("unknown field made_up");
    expect(result.items).toBeUndefined();
    const { step_count: _gone, ...withoutSteps } = night();
    expect(applyNight({ promises: promisesFixture(), scales: scales(), items: [], reviews: [], night: withoutSteps, now: NOW, date: DATE, reviewId: DATE, headCommit: COMMIT, repoRoot }).problems.join()).toContain("no step_count");
  });

  it("moves a way's score only with the fact that changed", () => {
    expect(problemsOf({ way_rescores: [{ way_id: `${firstSector}-first`, defense_score: 4, defense_reason: "r", damage_score: 3, damage_reason: "r", changed_because: null }] })).toContain("changed_because");
    const moved = apply({ way_rescores: [{ way_id: `${firstSector}-first`, defense_score: 4, defense_reason: "r", damage_score: 3, damage_reason: "r", changed_because: "A check landed" }] });
    expect(moved.promises[0].ways_to_break[0].score_changes).toHaveLength(1);
    expect(moved.review.rescored_way_ids).toEqual([`${firstSector}-first`]);
  });

  it("refuses a way at fix now with no open item at fix now", () => {
    const rescore = { way_id: `${firstSector}-first`, defense_score: 1, defense_reason: "r", damage_score: 5, damage_reason: "r", changed_because: "It got easy" };
    expect(problemsOf({ way_rescores: [rescore] })).toContain("no open item at fix now");
    expect(problemsOf({ way_rescores: [rescore], new_items: [newItem({ defense_score: 1, damage_score: 5 })] })).toBe("");
  });

  it("adds a way a challenge finds, whose anchors rest on today's code", () => {
    const result = apply({ new_ways: [{ sector_id: firstSector, way_id: "a-new-way", way_line: "A new way", defense_score: 4, defense_reason: "r", damage_score: 2, damage_reason: "r", anchors: [ANCHOR] }] });
    expect(result.promises[0].ways_to_break.at(-1).anchors[0].source_hash_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.review.new_way_ids).toEqual(["a-new-way"]);
  });

  it("a blind look that disagrees opens a question and overwrites nothing", () => {
    const wayId = `${firstSector}-second`;
    const same = apply({ second_guesses: [{ way_id: wayId, defense_score: 4, damage_score: 4, guess_reason: "Reads as hard and harmful" }] });
    expect(same.items).toEqual([]);
    const differs = apply({ second_guesses: [{ way_id: wayId, defense_score: 1, damage_score: 5, guess_reason: "Reads as easy" }] });
    expect(differs.promises[0].ways_to_break[1].defense_score).toBe(3);
    expect(differs.items[0]).toMatchObject({ item_kind: "question", opened_by: "second_guess", item_state: "next", way_id: wayId });
    expect(differs.items[0].evidence[0].evidence_line).toContain("Reads as easy");
    expect(differs.review.second_guess_disagreement_way_ids).toEqual([wayId]);
    const onOpenItem = apply({ second_guesses: [{ way_id: `${firstSector}-first`, defense_score: 1, damage_score: 5, guess_reason: "Reads as easy" }] }, { items: [openedItem()] });
    expect(onOpenItem.items).toHaveLength(1);
    expect(onOpenItem.items[0].evidence).toHaveLength(1);
  });

  it("puts a fix-now item in the queue with a finding, so it goes first", () => {
    const result = apply({ new_items: [newItem({ defense_score: 1, damage_score: 5 })] });
    const sectorName = SECTORS[0].sector_name;
    expect(result.items[0].finding_id).toBe(`fnd_${DATE}_some-gap`);
    expect(result.queue_lines).toEqual([`URGENT: ${sectorName}, findings/${DATE}-some-gap.md`, `Security fix: findings/${DATE}-some-gap.md; tier urgent; no branch: from the daily review`]);
    expect(result.findings[0].text).toContain("Status: open: no branch");
    expect(apply({ new_items: [newItem()] }).queue_lines).toEqual([]);
  });

  it("ties a fixed finding back to its item, with the test as its proof", () => {
    const item = { ...openedItem(), finding_id: `fnd_${DATE}_some-gap` };
    const [fixed] = itemsWithFindingFixed([item, openedItem({ item_slug: "other" })], { findingId: item.finding_id, testPath: "test/node/guard.test.ts", date: DATE, now: NOW });
    expect(fixed).toMatchObject({ item_state: "done", proof_kind: "failing_test", test_path: "test/node/guard.test.ts" });
    expect(itemProblems(fixed)).toEqual([]);
  });
});

describe("which promise a night challenges", () => {
  const finished = (sectorId: string, date: string) => ({ review_date: date, challenge: { sector_id: sectorId, way_ids_done: [], is_finished: true, stopped_because: null } });

  it("goes in rollout order first, then to the one left longest", () => {
    const promises = promisesFixture();
    expect(challengeOf(promises, []).sector_id).toBe(SECTOR_IDS[0]);
    expect(challengeOf(promises, [finished(SECTOR_IDS[0], "2026-11-01")]).sector_id).toBe(SECTOR_IDS[1]);
    const allOnce = SECTOR_IDS.map((sectorId: string, index: number) => finished(sectorId, `2026-11-0${index + 1}`));
    expect(challengeOf(promises, allOnce).sector_id).toBe(SECTOR_IDS[0]);
  });

  it("picks up where a night stopped, across nights", () => {
    const wayId = `${firstSector}-first`;
    const first = apply({ challenge: { sector_id: firstSector, way_ids_done: [wayId], is_finished: false, stopped_because: "out of steps" } });
    expect(first.review.challenge.way_ids_done).toEqual([wayId]);
    expect(challengeOf(promisesFixture(), [first.review])).toEqual({ sector_id: firstSector, way_ids_done: [wayId], is_resumed: true });
    const refused = problemsOf({ challenge: { sector_id: firstSector, way_ids_done: [], is_finished: true, stopped_because: null } }, { reviews: [first.review] });
    expect(refused).toContain(`weren't looked at: ${firstSector}-second`);
    const second = apply({ challenge: { sector_id: firstSector, way_ids_done: [`${firstSector}-second`], is_finished: true, stopped_because: null } }, { reviews: [first.review] });
    expect(second.problems).toEqual([]);
    expect(second.review.challenge.way_ids_done).toEqual([wayId, `${firstSector}-second`]);
  });

  it("refuses a challenge on another promise, or one that stopped without saying why", () => {
    expect(problemsOf({ challenge: { sector_id: SECTOR_IDS[1], way_ids_done: [], is_finished: false, stopped_because: "x" } })).toContain("tonight's is");
    expect(problemsOf({ challenge: { sector_id: firstSector, way_ids_done: [], is_finished: false, stopped_because: null } })).toContain("stopped_because");
  });
});

describe("what a run reads", () => {
  it("samples settled ways, the same for one date and different across dates, with no scores", () => {
    const promises = promisesFixture();
    const sample = secondGuessSampleOf(promises, DATE);
    expect(sample).toHaveLength(SECOND_GUESS_WAY_COUNT);
    expect(secondGuessSampleOf(promises, DATE)).toEqual(sample);
    expect(Object.keys(sample[0])).not.toContain("defense_score");
    const dates = ["2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];
    expect(dates.some((date) => JSON.stringify(secondGuessSampleOf(promises, date)) !== JSON.stringify(sample))).toBe(true);
    promises[0]!.ways_to_break[0]!.score_stale_reason = "changed";
    for (const date of dates) expect(secondGuessSampleOf(promises, date).map((entry: { way_id: string }) => entry.way_id)).not.toContain(`${firstSector}-first`);
  });

  it("reads the contract grid's last run from the private repo, and none before its first", () => {
    const mapDir = temporaryFolder("grid-failures-");
    expect(readGridFailures(mapDir)).toBeNull();
    mkdirSync(join(mapDir, "grid"));
    writeFileSync(join(mapDir, "grid", "failures.json"), JSON.stringify({ commit_sha: "abc", failures: [{ door_id: "page:GET /x", caller_kind: "stranger" }] }));
    expect(readGridFailures(mapDir).failures).toHaveLength(1);
  });

  it("outlines stale records, open items and tonight's challenge", () => {
    const promises = promisesFixture();
    promises[0]!.ways_to_break[0]!.score_stale_reason = "its code changed";
    const outline = reviewOutlineOf({ promises, items: [openedItem(), { ...openedItem({ item_slug: "known" }), item_state: "accepted" }], reviews: [], date: DATE });
    expect(outline.stale_ways.map((entry: { way_id: string }) => entry.way_id)).toEqual([`${firstSector}-first`]);
    expect(outline.open_items.map((entry: { priority: string }) => entry.priority)).toEqual(["harden"]);
    expect(outline.accepted_items).toHaveLength(1);
    expect(outline.challenge.sector_id).toBe(firstSector);
    expect(outline.step_budget).toBe(50);
  });

  it("lists the merges since the last review, none before the first", () => {
    expect(mergesSince(repoRoot, null)).toEqual({ merges: [], changed_paths: [], changed_path_count: 0 });
    writeFileSync(join(repoRoot, "src/other.ts"), "export const other = 1;\n");
    git(repoRoot, "add", "-A");
    execFileSync("git", ["commit", "--quiet", "-m", "Add other"], { cwd: repoRoot, env: { ...process.env, GIT_COMMITTER_DATE: "2030-01-02T00:00:00Z", GIT_AUTHOR_DATE: "2030-01-02T00:00:00Z" } });
    const caughtUp = mergesSince(repoRoot, "2030-01-01T00:00:00Z");
    expect(caughtUp.merges.map((merge: { subject: string }) => merge.subject)).toEqual(["Add other"]);
    expect(caughtUp.changed_paths).toEqual(["src/other.ts"]);
    expect(mergesSince(repoRoot, "2030-02-01T00:00:00Z").merges).toEqual([]);
  });
});

describe("finishing a night in the private repo", () => {
  function clone() {
    const remoteDir = join(workDir, "remote.git");
    const mapDir = join(workDir, "clone");
    git(workDir, "init", "--quiet", "--bare", "--initial-branch=main", remoteDir);
    git(workDir, "clone", "--quiet", remoteDir, mapDir);
    git(mapDir, "symbolic-ref", "HEAD", "refs/heads/main");
    mkdirSync(join(mapDir, "promises"));
    mkdirSync(join(mapDir, "map"));
    for (const sector of SECTORS) writeFileSync(join(mapDir, "map", `${sector.sector_id}.json`), `${JSON.stringify({ ...sector, doors: [] }, null, 2)}\n`);
    writeFileSync(join(mapDir, "promises", "scales.json"), JSON.stringify(scales()));
    writePromises(mapDir, { promises: promisesFixture() });
    writeFileSync(join(mapDir, "queue.md"), "# Queue\n\nWork waits here.\n");
    writeFileSync(join(mapDir, "log.md"), "# Log\n");
    git(mapDir, "add", "-A");
    git(mapDir, "commit", "--quiet", "-m", "Start");
    git(mapDir, "push", "--quiet", "origin", "main");
    return { remoteDir, mapDir };
  }
  const finish = (mapDir: string, extra: Record<string, unknown> = {}, isAgain = false, date = DATE) => finishReview({ repoRoot, mapDir, night: night(extra), now: NOW, date, isAgain });
  const headOf = (dir: string) => git(dir, "rev-parse", "main");

  it("writes the review, the log, the items and the queue, then pushes", () => {
    const { remoteDir, mapDir } = clone();
    const before = headOf(remoteDir);
    const result = finish(mapDir, { new_items: [newItem({ defense_score: 1, damage_score: 5 })] });
    expect(result.review_id).toBe(DATE);
    expect(result.fix_now_findings).toEqual([`findings/${DATE}-some-gap.md`]);
    expect(headOf(remoteDir)).not.toBe(before);
    expect(git(mapDir, "status", "--porcelain")).toBe("");
    expect(readReviews(mapDir)[0]).toMatchObject({ review_id: DATE, step_count: 42, is_contracts_checked: false });
    expect(readItems(mapDir)[0].finding_id).toBe(`fnd_${DATE}_some-gap`);
    expect(readFileSync(join(mapDir, "log.md"), "utf8")).toContain(`${DATE}: daily review: A quiet night`);
    const queue = readFileSync(join(mapDir, "queue.md"), "utf8");
    expect(queue.indexOf("URGENT:")).toBeLessThan(queue.indexOf("Security fix:"));
    expect(readState(mapDir).queue_items).toHaveLength(2);
    expect(readState(mapDir).last_review_date).toBe(DATE);
  });

  it("writes nothing at all when any part of the night is wrong", () => {
    const { remoteDir, mapDir } = clone();
    const before = headOf(remoteDir);
    expect(() => finish(mapDir, { new_items: [newItem({ proof_kind: null, proof_line: null })] })).toThrow("nothing was written");
    expect(headOf(remoteDir)).toBe(before);
    expect(git(mapDir, "status", "--porcelain")).toBe("");
    expect(existsSync(join(mapDir, "reviews"))).toBe(false);
  });

  it("refuses items edited by hand, so a settled line can't be reworded or deleted around the rules", () => {
    const { mapDir } = clone();
    finish(mapDir, { new_items: [newItem()] });
    const path = join(mapDir, `items/itm_${DATE}_some-gap.json`);
    const text = readFileSync(path, "utf8");
    writeFileSync(path, text.replace("A gap in the first way.", "Reworded."));
    expect(() => finish(mapDir, {}, true)).toThrow("changed by hand");
    writeFileSync(path, text);
    rmSync(path);
    expect(() => finish(mapDir, {}, true)).toThrow("changed by hand");
    git(mapDir, "checkout", "--", "items");
    expect(finish(mapDir, {}, true).review_id).toBe(`${DATE}-2`);
  });

  it("refuses a second review the same day unless it says so", () => {
    const { mapDir } = clone();
    finish(mapDir);
    expect(() => finish(mapDir)).toThrow("reviewed already");
    expect(finish(mapDir, {}, true).review_id).toBe(`${DATE}-2`);
  });

  it("keeps the items and reviews out of the public export", () => {
    const { mapDir } = clone();
    writeFileSync(join(mapDir, "map", `${firstSector}.json`), readFileSync(join(mapDir, "map", `${firstSector}.json`), "utf8").replace("\n}\n", '\n}\n\n'));
    const result = finish(mapDir, { summary_line: "MARKER-SUMMARY", new_items: [newItem({ item_line: "MARKER-ITEM" })] });
    expect(result.is_map_exported).toBe(true);
    const exported = readFileSync(join(mapDir, "exports", "map-public.json"), "utf8");
    expect(exported).not.toContain("MARKER");
  });

  it("doesn't export when the map hasn't moved, so the page isn't behind every morning", () => {
    const { mapDir } = clone();
    expect(finish(mapDir).is_map_exported).toBe(false);
    expect(existsSync(join(mapDir, "exports"))).toBe(false);
  });

  it("sums the steps the reviews counted, for the week's count", () => {
    const { mapDir } = clone();
    finish(mapDir);
    finish(mapDir, { challenge: { sector_id: firstSector, way_ids_done: [], is_finished: false, stopped_because: "out of steps" } }, false, "2026-11-05");
    expect(reviewStepCountOf(mapDir, { fromDate: "2026-11-04", toDate: "2026-11-05" }).total_step_count).toBe(84);
    expect(reviewStepCountOf(mapDir, { fromDate: "2026-11-05", toDate: "2026-11-05" }).total_step_count).toBe(42);
  });

  it("reads and writes items whole", () => {
    const { mapDir } = clone();
    const { item } = itemFromNight(newItem(), { date: DATE, now: NOW, anchors: [{ anchor_id: "src/guard.ts:guardCall", ...ANCHOR, source_hash_sha256: "abc" }] });
    writeItems(mapDir, [item]);
    expect(readItems(mapDir)).toEqual([item]);
    expect(readPromises(mapDir).promises).toHaveLength(SECTOR_IDS.length);
  });
});
