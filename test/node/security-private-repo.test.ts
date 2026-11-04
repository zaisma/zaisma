import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error: a plain JavaScript script without types
import { claimItem, commitAndPush, finishItem, markFindingFixed, pageLinesOf, pullClone, putItemBack, queueItemsOf, readState, settleItemCalls, withFindingStatus, withoutQueueLines, withPageShows } from "../../scripts/security-map/private-repo.mjs";
// @ts-expect-error: a plain JavaScript script without types
import { SECTORS, unexploredCase, withVerdict } from "../../scripts/security-map/schema.mjs";
import { temporaryFolder } from "../temporary-folder.ts";

/**
 * The private security repo's git helper (scripts/security-map/private-repo.mjs): the coordinator and the
 * security skills read the queue and record a fix through it, because a worktree session refuses git aimed
 * outside its own worktree. The git round trip runs against a local bare repo standing in for zaisma/security.
 */

const NOW = "2026-10-19T09:00:00.000Z";
const QUEUE = `# Queue

Findings waiting for a fix, most serious first. The daily review and the coordinator add and clear lines here.

URGENT: Accounts, findings/2026-10-18-some-slug.md
Security fix: findings/2026-10-18-some-slug.md; tier urgent; branch zaisma/security fix/fnd_2026-10-18_some-slug
`;
const README = "# Zaisma security\n\nMap page: https://claude.ai/artifact/abc\nMap page shows: 2026-10-18T03:00:00.000Z\n";
const GIT_IDENTITY = { GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" };

let workDir = "";
const savedEnvironment = { ...process.env };
beforeEach(() => {
  workDir = temporaryFolder("security-private-repo-");
  Object.assign(process.env, GIT_IDENTITY);
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  process.env = { ...savedEnvironment };
});

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** A bare repo with one commit on main (queue, README, export), and a clone of it. */
function remoteAndClone() {
  const remoteDir = join(workDir, "remote.git");
  const seedDir = join(workDir, "seed");
  git(workDir, "init", "--quiet", "--bare", "--initial-branch=main", remoteDir);
  git(workDir, "clone", "--quiet", remoteDir, seedDir);
  git(seedDir, "symbolic-ref", "HEAD", "refs/heads/main");
  writeFileSync(join(seedDir, "queue.md"), QUEUE);
  writeFileSync(join(seedDir, "README.md"), README);
  mkdirSync(join(seedDir, "exports"));
  writeFileSync(join(seedDir, "exports", "map-public.json"), JSON.stringify({ generated_at: "2026-10-19T03:00:00.000Z" }));
  git(seedDir, "add", "-A");
  git(seedDir, "commit", "--quiet", "-m", "Start");
  git(seedDir, "push", "--quiet", "origin", "main");
  const cloneDir = join(workDir, "clone");
  git(workDir, "clone", "--quiet", remoteDir, cloneDir);
  return { remoteDir, seedDir, cloneDir };
}

describe("reading the private repo", () => {
  it("lists only the queue's work lines", () => {
    expect(queueItemsOf(QUEUE)).toEqual([
      "URGENT: Accounts, findings/2026-10-18-some-slug.md",
      "Security fix: findings/2026-10-18-some-slug.md; tier urgent; branch zaisma/security fix/fnd_2026-10-18_some-slug",
    ]);
    expect(queueItemsOf("# Queue\n\nFindings waiting for a fix.\n")).toEqual([]);
  });

  it("says the map page is behind when the export is newer than the page", () => {
    const { cloneDir } = remoteAndClone();
    expect(readState(cloneDir)).toEqual({
      queue_items: queueItemsOf(QUEUE),
      map_page_url: "https://claude.ai/artifact/abc",
      map_page_shows_generated_at: "2026-10-18T03:00:00.000Z",
      export_generated_at: "2026-10-19T03:00:00.000Z",
      open_item_count: 0,
      last_review_date: null,
      is_map_page_behind: true,
    });
    expect(pageLinesOf("# Zaisma security\n")).toEqual({ map_page_url: null, map_page_shows_generated_at: null });
  });
});

describe("changing the private repo's files", () => {
  it("removes a finding's queue lines, its URGENT line too, and leaves the rest", () => {
    const { text, removed_lines } = withoutQueueLines(QUEUE, "findings/2026-10-18-some-slug.md");
    expect(removed_lines).toHaveLength(2);
    expect(queueItemsOf(text)).toEqual([]);
    expect(text).toContain("Findings waiting for a fix");
    expect(() => withoutQueueLines(QUEUE, " ")).toThrow(/Say which queue line/);
  });

  it("sets the README's Map page shows line, adding it under Map page when missing", () => {
    expect(pageLinesOf(withPageShows(README, NOW)).map_page_shows_generated_at).toBe(NOW);
    expect(withPageShows("Map page: https://claude.ai/artifact/abc\n", NOW)).toBe(`Map page: https://claude.ai/artifact/abc\nMap page shows: ${NOW}\n`);
    expect(() => withPageShows("# Zaisma security\n", NOW)).toThrow(/not published yet/);
  });

  it("sets a finding's status line in any of its usual shapes, or adds one", () => {
    expect(withFindingStatus("# Hole\n\nStatus: fix held: zaisma/security fix/fnd_x\n", "fixed 2026-10-19")).toBe("# Hole\n\nStatus: fixed 2026-10-19\n");
    expect(withFindingStatus("# Hole\n- **Status:** open: no branch, too big\n", "fixed 2026-10-19")).toBe("# Hole\n- **Status:** fixed 2026-10-19\n");
    expect(withFindingStatus("# Hole\n\nStatus of the door: unknown words\n", "fixed 2026-10-19")).toBe("# Hole\n\nStatus of the door: unknown words\n\nStatus: fixed 2026-10-19\n");
  });

  it("marks every case carrying the finding fixed, with the test as evidence and the door's anchors now", () => {
    const holeCase = withVerdict(unexploredCase({ case_id: "another-account", case_name: "Another account's data" }), { status: "hole", severity_tier: "urgent", finding_id: "fnd_2026-10-18_some-slug", verdict_at: NOW, verdict_anchor_hashes: { "src/fixture.ts:guard": "old" } });
    const otherCase = unexploredCase({ case_id: "no-session", case_name: "No session" });
    const door = { door_id: "api:GET /fixture", door_name: "fixture", door_kind: "api_call", sector_id: "accounts", source_path: "src/fixture.ts", anchors: [{ anchor_id: "src/fixture.ts:guard", source_path: "src/fixture.ts", symbol_name: "guard", source_hash_sha256: "new" }], gives: [], trusts: [], covered_by_door_id: null, cases: [holeCase, otherCase] };
    const map = SECTORS.map((sector: { sector_id: string }) => ({ ...sector, doors: sector.sector_id === "accounts" ? [door] : [] }));
    const evidence = { kind: "test", ref: "test/site/fixture.test.ts", note: "refuses another account's data" };
    const marked = markFindingFixed(map, { findingId: "fnd_2026-10-18_some-slug", evidence, now: NOW });
    expect(marked.case_refs).toEqual(["api:GET /fixture#another-account"]);
    const [fixedCase, untouched] = marked.map[0].doors[0].cases;
    expect(fixedCase).toMatchObject({ status: "fixed", severity_tier: null, evidence, finding_id: "fnd_2026-10-18_some-slug", verdict_at: NOW, verdict_anchor_hashes: { "src/fixture.ts:guard": "new" } });
    expect(untouched).toEqual(otherCase);
  });
});

describe("git on the private repo", () => {
  it("pulls the clone fast-forward and pushes a commit to main", () => {
    const { remoteDir, seedDir, cloneDir } = remoteAndClone();
    writeFileSync(join(seedDir, "log.md"), "2026-10-19: quiet night\n");
    git(seedDir, "add", "-A");
    git(seedDir, "commit", "--quiet", "-m", "Report");
    git(seedDir, "push", "--quiet", "origin", "main");
    expect(pullClone(cloneDir)).toBe("pulled");
    expect(pullClone(cloneDir)).toBe("up to date");

    writeFileSync(join(cloneDir, "README.md"), withPageShows(README, NOW));
    expect(commitAndPush(cloneDir, { message: `Map page shows ${NOW}`, paths: ["README.md"] })).toEqual({ committed_paths: ["README.md"], pushed: true });
    expect(git(remoteDir, "log", "-1", "--format=%s", "main")).toBe(`Map page shows ${NOW}`);
    expect(commitAndPush(cloneDir, { message: "Nothing" })).toEqual({ committed_paths: [], pushed: false });
  });

  it("rebases once when main moved, and never commits an unproven repro", () => {
    const { remoteDir, seedDir, cloneDir } = remoteAndClone();
    writeFileSync(join(seedDir, "log.md"), "2026-10-19: quiet night\n");
    git(seedDir, "add", "-A");
    git(seedDir, "commit", "--quiet", "-m", "Report");
    git(seedDir, "push", "--quiet", "origin", "main");

    writeFileSync(join(cloneDir, "queue.md"), withoutQueueLines(QUEUE, "URGENT:").text);
    expect(commitAndPush(cloneDir, { message: "Queue line handled", paths: ["queue.md"] }).pushed).toBe(true);
    expect(git(remoteDir, "log", "--format=%s", "main").split("\n")).toEqual(["Queue line handled", "Report", "Start"]);

    mkdirSync(join(cloneDir, "findings", "candidates"), { recursive: true });
    writeFileSync(join(cloneDir, "findings", "candidates", "2026-10-19-try.md"), "an unproven repro");
    expect(() => commitAndPush(cloneDir, { message: "Everything" })).toThrow(/unproven repros/);
    expect(git(cloneDir, "diff", "--cached", "--name-only")).toBe("");
    expect(readFileSync(join(cloneDir, "findings", "candidates", "2026-10-19-try.md"), "utf8")).toBe("an unproven repro");
  });

  it("refuses a clone that isn't on main", () => {
    const { cloneDir } = remoteAndClone();
    git(cloneDir, "checkout", "--quiet", "-b", "fix/fnd_2026-10-18_some-slug");
    expect(() => pullClone(cloneDir)).toThrow(/not main/);
  });
});

describe("an item through the private repo", () => {
  const ITEM_ID = "itm_2026-11-03_some-words";
  const CALL = "Whether it asks or waits.";
  const anItem = () => ({ item_id: ITEM_ID, item_kind: "item", sector_id: SECTORS[0].sector_id, way_id: "some-way", item_line: "A line.", goal_line: "After this, it's impossible.", answer_kind: "remove", opened_at: NOW, opened_by: "merge_catch_up", item_state: "next", defense_score: 3, defense_reason: "reason", damage_score: 3, damage_reason: "reason", anchors: [], scored_at: NOW, score_stale_reason: null, score_changes: [], calls: [CALL], waits_on: [], proof_kind: "failing_test", proof_line: "A test fails.", test_path: "test/node/old.test.ts", finding_id: null, evidence: [] });

  function cloneWithItem(item: Record<string, unknown> = anItem()) {
    const { remoteDir, seedDir, cloneDir } = remoteAndClone();
    mkdirSync(join(seedDir, "items"));
    writeFileSync(join(seedDir, `items/${ITEM_ID}.json`), JSON.stringify(item));
    git(seedDir, "add", "-A");
    git(seedDir, "commit", "--quiet", "-m", "An item");
    git(seedDir, "push", "--quiet", "origin", "main");
    git(cloneDir, "pull", "--quiet", "origin", "main");
    return { remoteDir, cloneDir };
  }
  const itemIn = (cloneDir: string) => JSON.parse(readFileSync(join(cloneDir, `items/${ITEM_ID}.json`), "utf8"));
  const pushedMessage = (remoteDir: string) => git(remoteDir, "log", "-1", "--format=%s", "main");

  /** A public checkout with one test on its origin/main. */
  function publicCheckout() {
    const remoteDir = join(workDir, "public.git");
    const repoRoot = join(workDir, "public");
    git(workDir, "init", "--quiet", "--bare", "--initial-branch=main", remoteDir);
    git(workDir, "clone", "--quiet", remoteDir, repoRoot);
    git(repoRoot, "symbolic-ref", "HEAD", "refs/heads/main");
    mkdirSync(join(repoRoot, "test"));
    writeFileSync(join(repoRoot, "test/guard.test.ts"), "// a test\n");
    git(repoRoot, "add", "-A");
    git(repoRoot, "commit", "--quiet", "-m", "Start");
    git(repoRoot, "push", "--quiet", "origin", "main");
    return repoRoot;
  }

  it("claims a next item for one launch and pushes only its file, then refuses a second claim", () => {
    const { remoteDir, cloneDir } = cloneWithItem();
    writeFileSync(join(cloneDir, "queue.md"), "someone else's change");
    expect(claimItem(cloneDir, { itemId: ITEM_ID, launchId: "launch-1" })).toMatchObject({ old_item_state: "next", new_item_state: "doing", committed_paths: [`items/${ITEM_ID}.json`], pushed: true });
    expect(itemIn(cloneDir)).toMatchObject({ item_state: "doing", claimed_by_launch_id: "launch-1" });
    expect(pushedMessage(remoteDir)).toBe(`${ITEM_ID}: claimed`);
    expect(() => claimItem(cloneDir, { itemId: ITEM_ID, launchId: "launch-2" })).toThrow("only a next item can be claimed");
  });

  it("changes nothing on a dry claim, and refuses an item that doesn't exist", () => {
    const { cloneDir } = cloneWithItem();
    expect(claimItem(cloneDir, { itemId: ITEM_ID, launchId: "launch-1", isDry: true })).toMatchObject({ new_item_state: "doing", is_dry: true });
    expect(itemIn(cloneDir).item_state).toBe("next");
    expect(() => claimItem(cloneDir, { itemId: "itm_2026-11-03_other", launchId: "launch-1" })).toThrow("No item has id");
  });

  it("puts a claimed item back with its claim gone", () => {
    const { cloneDir } = cloneWithItem();
    expect(() => putItemBack(cloneDir, { itemId: ITEM_ID })).toThrow("only a doing item");
    claimItem(cloneDir, { itemId: ITEM_ID, launchId: "launch-1" });
    putItemBack(cloneDir, { itemId: ITEM_ID });
    expect(itemIn(cloneDir)).toMatchObject({ item_state: "next", claimed_by_launch_id: null });
  });

  it("settles a call with its answer, and refuses a call that isn't open, an unknown field or an empty answer", () => {
    const { cloneDir } = cloneWithItem();
    const settle = (answers: unknown) => settleItemCalls(cloneDir, { itemId: ITEM_ID, answers, now: NOW });
    expect(() => settle([{ call_line: "Another call.", answer_line: "Asks." }])).toThrow("doesn't have open");
    expect(() => settle([{ call_line: CALL, answer_line: "Asks.", extra: 1 }])).toThrow("unknown field extra");
    expect(() => settle([{ call_line: CALL, answer_line: " " }])).toThrow("no answer_line");
    expect(() => settle([])).toThrow("Give the answers");
    settle([{ call_line: CALL, answer_line: "Asks." }]);
    expect(itemIn(cloneDir)).toMatchObject({ calls: [], settled_calls: [{ call_line: CALL, answer_line: "Asks.", settled_at: NOW }] });
  });

  it("closes a doing item only with a test on the public origin/main, as often as it's asked", () => {
    const { cloneDir } = cloneWithItem();
    const repoRoot = publicCheckout();
    const finish = (testPath: string) => finishItem(cloneDir, { itemId: ITEM_ID, testPath, date: "2026-11-04", now: NOW, repoRoot });
    expect(() => finish("test/guard.test.ts")).toThrow("only a doing item");
    claimItem(cloneDir, { itemId: ITEM_ID, launchId: "launch-1" });
    expect(() => finish("test/missing.test.ts")).toThrow("isn't on origin/main");
    expect(finish("test/guard.test.ts")).toMatchObject({ new_item_state: "done", is_changed: true });
    expect(itemIn(cloneDir)).toMatchObject({ item_state: "done", claimed_by_launch_id: null, proof_kind: "failing_test", test_path: "test/guard.test.ts" });
    expect(itemIn(cloneDir).evidence[0].rests_on_commit).toBe(git(repoRoot, "rev-parse", "origin/main"));
    expect(finish("test/guard.test.ts")).toMatchObject({ is_changed: false });
  });

  it("sends an item with a finding to mark-fixed", () => {
    const { cloneDir } = cloneWithItem({ ...anItem(), finding_id: "fnd_2026-11-03_some-words" });
    claimItem(cloneDir, { itemId: ITEM_ID, launchId: "launch-1" });
    expect(() => finishItem(cloneDir, { itemId: ITEM_ID, testPath: "test/guard.test.ts", date: "2026-11-04", now: NOW, repoRoot: publicCheckout() })).toThrow("close it with mark-fixed");
  });

  it("counts the open items where the coordinator reads the queue", () => {
    const { cloneDir } = cloneWithItem();
    expect(readState(cloneDir).open_item_count).toBe(1);
  });
});
