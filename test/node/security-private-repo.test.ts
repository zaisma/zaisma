import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error: a plain JavaScript script without types
import { commitAndPush, markFindingFixed, pageLinesOf, pullClone, queueItemsOf, readState, withFindingStatus, withoutQueueLines, withPageShows } from "../../scripts/security-map/private-repo.mjs";
// @ts-expect-error: a plain JavaScript script without types
import { SECTORS, unexploredCase, withVerdict } from "../../scripts/security-map/schema.mjs";

/**
 * The private security repo's git helper (scripts/security-map/private-repo.mjs): the coordinator and the
 * security skills read the queue and record a fix through it, because a worktree session refuses git aimed
 * outside its own worktree. The git round trip runs against a local bare repo standing in for zaisma/security.
 */

const NOW = "2026-10-19T09:00:00.000Z";
const QUEUE = `# Queue

Findings waiting for a fix, most serious first. The Nightly security review adds and clears lines here.

URGENT: Accounts, findings/2026-10-18-some-slug.md
Security fix: findings/2026-10-18-some-slug.md; tier urgent; branch zaisma/security fix/fnd_2026-10-18_some-slug
hardening: propose roadmap row Tighter session lifetimes (accounts)
`;
const README = "# Zaisma security\n\nMap page: https://claude.ai/artifact/abc\nMap page shows: 2026-10-18T03:00:00.000Z\n";
const GIT_IDENTITY = { GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" };

let workDir = "";
const savedEnvironment = { ...process.env };
beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "security-private-repo-"));
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
      "hardening: propose roadmap row Tighter session lifetimes (accounts)",
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
      is_map_page_behind: true,
    });
    expect(pageLinesOf("# Zaisma security\n")).toEqual({ map_page_url: null, map_page_shows_generated_at: null });
  });
});

describe("changing the private repo's files", () => {
  it("removes a finding's queue lines, its URGENT line too, and leaves the rest", () => {
    const { text, removed_lines } = withoutQueueLines(QUEUE, "findings/2026-10-18-some-slug.md");
    expect(removed_lines).toHaveLength(2);
    expect(queueItemsOf(text)).toEqual(["hardening: propose roadmap row Tighter session lifetimes (accounts)"]);
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
    git(seedDir, "commit", "--quiet", "-m", "Nightly report");
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
    git(seedDir, "commit", "--quiet", "-m", "Nightly report");
    git(seedDir, "push", "--quiet", "origin", "main");

    writeFileSync(join(cloneDir, "queue.md"), withoutQueueLines(QUEUE, "hardening:").text);
    expect(commitAndPush(cloneDir, { message: "Queue line handled", paths: ["queue.md"] }).pushed).toBe(true);
    expect(git(remoteDir, "log", "--format=%s", "main").split("\n")).toEqual(["Queue line handled", "Nightly report", "Start"]);

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
