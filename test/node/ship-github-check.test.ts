import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DOCS_ONLY_PATH,
  DOCS_TESTS_CHECK_NAME, REACHED_TESTS_CHECK_NAME,
  ENGINES_CHECK_NAME,
  GITHUB_CHECK_NAME,
  NIGHTLY_SWEEP_CHECK_NAME,
  NIGHTLY_SWEEP_NAME,
  NIGHTLY_SWEEP_WORKFLOW,
  applyEnginesProof,
  applyNightlySweep,
  latestSweep,
  recheckOf,
  sweepFailedPages,
  sweepRunTitle,
  checkState,
  enginesBaseCommits,
  isDocsOnly,
  judgeCheckedCode,
  sameCodeCommits,
  // @ts-expect-error: a plain JavaScript script without types
} from "../../scripts/ship-github-check.mjs";
import { temporaryFolder } from "../temporary-folder.ts";

/** scripts/ship-github-check.mjs: which GitHub check `npm run ship` counts for the code it ships. */

const ROOT = join(import.meta.dirname, "../..");
const workflow = readFileSync(join(ROOT, ".github/workflows/check.yml"), "utf8");

describe("the workflow and ship agree", () => {
  it("on the required check's name and the docs tests' name", () => {
    expect(workflow).toContain(`name: ${GITHUB_CHECK_NAME}\n`);
    expect(workflow).toContain(`name: ${DOCS_TESTS_CHECK_NAME}\n`);
    expect(workflow).toContain(`name: ${ENGINES_CHECK_NAME} (\${{ matrix.shard }} of 3)\n`);
  });
  it("on what the engine exports run, from the repository's graph", () => {
    expect(workflow).toContain("node scripts/affected-tests.mjs --github");
    expect(workflow).toContain("EVENT_NAME: ${{ github.event_name }}");
  });
  it("on ship reading every run and attempt of a commit's checks", () => {
    const ship = readFileSync(join(ROOT, "scripts/ship.mjs"), "utf8");
    expect(ship).toContain("check-runs?filter=all&per_page=100");
    expect(ship).toContain('"--paginate"');
  });
  it("on checking merge groups, and passing a push to main the queue checked without running it again", () => {
    expect(workflow).toMatch(/^on:\n {2}pull_request:\n {2}merge_group:\n/m);
    expect(workflow).toContain("github.event.merge_group.base_sha");
    expect(workflow).toContain(`check-runs?check_name=${encodeURIComponent(GITHUB_CHECK_NAME)}&filter=all`);
    expect(workflow).toContain(`if [ "$IS_CHECKED_IN_QUEUE" = true ]; then echo "Checked in the merge queue: this commit passed there."; exit 0; fi`);
    // Every checking job steps aside for it; only the required check and main's caches run.
    for (const job of ["${{ needs.changes.outputs.is_full_suite == 'true' && 'Tests' || 'Reached tests' }} (", "Typecheck", "Engine exports (", "Preview test data", "Layout check\n", "Every screen (", "Docs tests"]) {
      const section = workflow.slice(workflow.indexOf(`name: ${job}`), workflow.indexOf("runs-on:", workflow.indexOf(`name: ${job}`)));
      expect(section, job).toContain("needs.changes.outputs.is_checked_in_queue != 'true'");
    }
  });
  it("on a pull request running only its reached tests as \"Reached tests\", and the merge queue every test with one more run of a failed file", () => {
    expect(workflow).toContain(`'Tests' || '${REACHED_TESTS_CHECK_NAME}'`);
    expect(workflow).toContain("github.event_name == 'merge_group' && '--rerun-failed-once'");
    expect(workflow).toContain("needs: [changes, tests, repeat-new-tests,");
  });
  it("on running the engine exports on every push to main, and failing the required check when they fail", () => {
    expect(workflow).toContain(`if [ "$ENGINES_RESULT" = skipped ] && [ "$IS_ENGINES_CHANGED" = false ]; then engines_ok=true; fi`);
    // A skip passes only with the engines' own flag false; any other result but success leaves engines_ok false.
    expect(workflow).toContain(`if [ "$ENGINES_RESULT" = success ]; then engines_ok=true; fi`);
  });
  it("on no gallery run of its own: a pull request's Layout check measures the gallery's pages with the rest", () => {
    expect(workflow).not.toContain("--gallery");
    expect(workflow).not.toContain("is_gallery_changed");
  });
  it("on the merge queue measuring every page its change reaches on every screen, and failing the required check when it fails", () => {
    const sweepJob = workflow.slice(workflow.indexOf("name: Every screen ("), workflow.indexOf("\n  docs-tests:"));
    expect(sweepJob).toContain("github.event_name == 'merge_group'");
    expect(sweepJob).toContain("run: npm run layout:check -- --sweep --shard ${{ matrix.shard }}/4 --measured .wrangler/layout-sweep-measured.json --changed-only");
    expect(sweepJob).toContain("restore-keys: layout-sweep-measured-");
    expect(sweepJob).toContain("name: layout-sweep-measured-${{ matrix.shard }}");
    expect(workflow).toContain("needs: [changes, tests, repeat-new-tests, typecheck, engines, seed, layout, sweep, docs-tests]");
    expect(workflow).toContain(`if [ "$EVENT_NAME" = merge_group ]; then sweep_ok=false; if [ "$SWEEP_RESULT" = success ]; then sweep_ok=true; fi; fi`);
    // Its measured pages reach main's cache once its commit is main, where the next merge group reads them.
    const mainJob = workflow.slice(workflow.indexOf("name: Measured pages for main"), workflow.indexOf("\n  check:"));
    expect(mainJob).toContain("event=merge_group");
    expect(mainJob).toContain("--pattern 'layout-sweep-measured-*'");
    expect(mainJob).toContain("node scripts/merge-measured.mjs .wrangler/layout-sweep-measured.json measured");
    expect(mainJob).toContain("key: layout-sweep-measured-${{ github.sha }}");
  });
  it("on which paths are docs only", () => {
    expect(workflow).toContain(`grep -qvE '${DOCS_ONLY_PATH.source.replaceAll("\\/", "/")}'`);
  });
  it("tests a pull request's branch exactly as it is", () => {
    const checkoutRefs = workflow.match(/ref: .*/g) ?? [];
    // Every job's checkout.
    expect(checkoutRefs.length).toBe(workflow.match(/actions\/checkout@/g)!.length);
    for (const ref of checkoutRefs) expect(ref).toBe("ref: ${{ github.event.pull_request.head.sha || github.sha }}");
  });
});

describe("isDocsOnly", () => {
  it("is docs/, .claude/, CLAUDE.md and README.md, nothing else", () => {
    expect(isDocsOnly(["docs/DEVELOPER-API.md", ".claude/hooks/fetch-main.sh", "CLAUDE.md", "README.md"])).toBe(true);
    expect(isDocsOnly([])).toBe(true);
    for (const path of ["apps/site/src/index.ts", "scripts/ship.mjs", ".github/workflows/check.yml", "CLAUDE.md.bak", "packages/docs/x.md", "brand/README.md", "review-set/README.md", "test/node/ship-github-check.test.ts"]) expect(isDocsOnly(["docs/DEVELOPER-API.md", path])).toBe(false);
  });
});

describe("checkState", () => {
  const run = (name: string, status: string, conclusion: string | null) => ({ name, status, conclusion, html_url: `https://github.test/${name}` });
  it("reads the full check", () => {
    expect(checkState([run(GITHUB_CHECK_NAME, "completed", "success"), run(DOCS_TESTS_CHECK_NAME, "completed", "skipped")]).state).toBe("passed");
    expect(checkState([run(GITHUB_CHECK_NAME, "completed", "failure"), run(DOCS_TESTS_CHECK_NAME, "completed", "skipped")]).state).toBe("failed");
    expect(checkState([run(GITHUB_CHECK_NAME, "in_progress", null)]).state).toBe("running");
    expect(checkState([run("Typecheck", "completed", "success")]).state).toBe("none");
  });
  it("counts a run before the docs tests existed as full", () => {
    expect(checkState([run(GITHUB_CHECK_NAME, "completed", "success")])).toEqual({ state: "passed", url: `https://github.test/${GITHUB_CHECK_NAME}`, engines: "none" });
  });
  it("says what the engine exports did", () => {
    const full = (engines: ReturnType<typeof run>[]) => checkState([run(GITHUB_CHECK_NAME, "completed", "success"), ...engines]);
    expect(full([run(ENGINES_CHECK_NAME, "completed", "success")])).toMatchObject({ state: "passed", engines: "passed" });
    expect(full([run(ENGINES_CHECK_NAME, "completed", "skipped")])).toMatchObject({ state: "passed", engines: "skipped" });
    expect(full([run(ENGINES_CHECK_NAME, "in_progress", null)]).engines).toBe("running");
    expect(full([run(ENGINES_CHECK_NAME, "completed", "failure")]).engines).toBe("failed");
    expect(full([]).engines).toBe("none");
  });
  it("reads the engine exports' shares together", () => {
    const full = (engines: ReturnType<typeof run>[]) => checkState([run(GITHUB_CHECK_NAME, "completed", "success"), ...engines]);
    const share = (index: number, status: string, conclusion: string | null) => run(`${ENGINES_CHECK_NAME} (${index} of 3)`, status, conclusion);
    expect(full([share(1, "completed", "success"), share(2, "completed", "success"), share(3, "completed", "success")]).engines).toBe("passed");
    expect(full([share(1, "completed", "success"), share(2, "completed", "failure"), share(3, "in_progress", null)]).engines).toBe("failed");
    expect(full([share(1, "completed", "success"), share(2, "in_progress", null), share(3, "completed", "success")]).engines).toBe("running");
    expect(full([share(1, "completed", "cancelled"), share(2, "completed", "success"), share(3, "completed", "success")]).engines).toBe("failed");
    // A matrix job its pull request skipped: one run, under the name before its shares were known.
    expect(full([run(`${ENGINES_CHECK_NAME} (\${{ matrix.shard }} of 3)`, "completed", "skipped")]).engines).toBe("skipped");
    expect(full([run("Engine exports soon", "completed", "failure")]).engines).toBe("none");
  });
  it("reads each check by its latest run, across runs and attempts", () => {
    const at = (name: string, status: string, conclusion: string | null, completedAt: string | null) => ({ ...run(name, status, conclusion), completed_at: completedAt });
    expect(checkState([at(GITHUB_CHECK_NAME, "completed", "failure", "2026-10-23T10:00:00Z"), at(GITHUB_CHECK_NAME, "completed", "success", "2026-10-23T10:05:00Z")]).state).toBe("passed");
    expect(checkState([at(GITHUB_CHECK_NAME, "completed", "success", "2026-10-23T10:05:00Z"), at(GITHUB_CHECK_NAME, "completed", "failure", "2026-10-23T10:09:00Z")]).state).toBe("failed");
    expect(checkState([at(GITHUB_CHECK_NAME, "completed", "success", "2026-10-23T10:05:00Z"), at(GITHUB_CHECK_NAME, "in_progress", null, null)]).state).toBe("running");
    // A merge group that ran only the docs tests, and main's push after it, which ran nothing: still only docs.
    const docsGroup = [at(GITHUB_CHECK_NAME, "completed", "success", "2026-10-23T10:01:00Z"), at(DOCS_TESTS_CHECK_NAME, "completed", "success", "2026-10-23T10:00:30Z"), at("Tests (${{ matrix.shard }} of 4)", "completed", "skipped", "2026-10-23T10:00:00Z")];
    const lightPush = [at(GITHUB_CHECK_NAME, "completed", "success", "2026-10-23T10:03:00Z"), at(DOCS_TESTS_CHECK_NAME, "completed", "skipped", "2026-10-23T10:02:00Z")];
    expect(checkState([...docsGroup, ...lightPush]).state).toBe("docs_passed");
    expect(checkState([...lightPush, at("Tests (1 of 4)", "completed", "success", "2026-10-23T10:00:40Z")]).state).toBe("passed");
  });
  it("reads a merge group's engine exports past main's push run, which skipped them", () => {
    const full = (engines: ReturnType<typeof run>[]) => checkState([run(GITHUB_CHECK_NAME, "completed", "success"), ...engines]);
    const share = (index: number, conclusion: string) => run(`${ENGINES_CHECK_NAME} (${index} of 3)`, "completed", conclusion);
    const skippedOnPush = run(`${ENGINES_CHECK_NAME} (\${{ matrix.shard }} of 3)`, "completed", "skipped");
    expect(full([share(1, "success"), share(2, "success"), share(3, "success"), skippedOnPush]).engines).toBe("passed");
    expect(full([share(1, "success"), share(2, "failure"), share(3, "success"), skippedOnPush]).engines).toBe("failed");
  });
  it("tells a docs-only run apart", () => {
    expect(checkState([run(GITHUB_CHECK_NAME, "completed", "success"), run(DOCS_TESTS_CHECK_NAME, "completed", "success")]).state).toBe("docs_passed");
    expect(checkState([run(GITHUB_CHECK_NAME, "completed", "failure"), run(DOCS_TESTS_CHECK_NAME, "completed", "failure")]).state).toBe("docs_failed");
  });
  it("tells a pull request's run of only its reached tests apart", () => {
    expect(checkState([run(GITHUB_CHECK_NAME, "completed", "success"), run(`${REACHED_TESTS_CHECK_NAME} (1 of 4)`, "completed", "success"), run("Tests (1 of 4)", "completed", "skipped")]).state).toBe("reached_passed");
    expect(checkState([run(GITHUB_CHECK_NAME, "completed", "success"), run("Tests (1 of 4)", "completed", "success")]).state).toBe("passed");
  });
});

describe("judgeCheckedCode", () => {
  const at = (commitSha: string, state: string) => ({ commitSha, state, url: `https://github.test/${commitSha}` });
  it("ships on a pull request's pass while main's own run is still going", () => {
    expect(judgeCheckedCode([at("merge", "running"), at("branch", "passed")])).toMatchObject({ verdict: "passed", commitSha: "branch" });
  });
  it("stops on a failure on the commit itself, whatever passed elsewhere", () => {
    expect(judgeCheckedCode([at("merge", "failed"), at("branch", "passed")]).verdict).toBe("failed");
    expect(judgeCheckedCode([at("roadmap", "docs_failed"), at("merge", "passed")]).verdict).toBe("failed");
  });
  it("goes by the newest finished full check", () => {
    expect(judgeCheckedCode([at("roadmap", "docs_passed"), at("merge", "failed"), at("branch", "passed")])).toMatchObject({ verdict: "failed", commitSha: "merge" });
    expect(judgeCheckedCode([at("roadmap", "docs_passed"), at("merge", "running"), at("branch", "passed")])).toMatchObject({ verdict: "passed", commitSha: "branch" });
  });
  it("waits while only a running check could decide", () => {
    expect(judgeCheckedCode([at("merge", "running"), at("branch", "docs_passed")]).verdict).toBe("running");
  });
  it("never counts a pull request's run of only its reached tests for code: the merge queue's run decides", () => {
    expect(judgeCheckedCode([at("merge", "running"), at("branch", "reached_passed")]).verdict).toBe("running");
    expect(judgeCheckedCode([at("merge", "passed"), at("branch", "reached_passed")])).toMatchObject({ verdict: "passed", commitSha: "merge" });
  });
  it("never counts docs tests for code", () => {
    expect(judgeCheckedCode([at("roadmap", "docs_passed"), at("talk", "docs_passed")]).verdict).toBe("none");
    expect(judgeCheckedCode([at("merge", "none")]).verdict).toBe("none");
  });
});

describe("applyNightlySweep", () => {
  const passed = { verdict: "passed", state: "passed", commitSha: "main", url: "https://github.test/main" };
  const nightly = readFileSync(join(ROOT, ".github/workflows/nightly.yml"), "utf8");
  const failed = { conclusion: "failure", url: "https://github.test/sweep", failedPages: ["Home", "Sign in"] };
  it("is the nightly workflow's last job, which ship runs again itself with the commit and the pages", () => {
    expect(nightly).toContain(`name: ${NIGHTLY_SWEEP_CHECK_NAME}\n`);
    expect(nightly).toContain(`name: ${NIGHTLY_SWEEP_NAME}\n`);
    expect(NIGHTLY_SWEEP_WORKFLOW).toBe("nightly.yml");
    expect(nightly).toMatch(/workflow_dispatch:\n {4}inputs:\n {6}commit_sha:/);
    expect(nightly).toContain("      pages:\n");
    expect(nightly).toContain(`npm run layout:check -- --sweep --shard \${{ matrix.shard }}/4 --pages "$PAGES"`);
    const ship = readFileSync(join(ROOT, "scripts/ship.mjs"), "utf8");
    expect(ship).toContain('"--workflow", NIGHTLY_SWEEP_WORKFLOW, "--branch", "main"');
    expect(ship).toContain('"workflow", "run", NIGHTLY_SWEEP_WORKFLOW');
    expect(ship).toContain("`commit_sha=${commitSha}`");
    expect(ship).toContain("`pages=${JSON.stringify(sweep.failedPages)}`");
  });
  it("names its runs as nightly.yml's run-name does", () => {
    expect(nightly).toContain("run-name: ${{ inputs.commit_sha && format('Layout sweep on {0}{1}', inputs.commit_sha, inputs.pages && ' (re-check)' || '') || 'Nightly layout sweep' }}");
    expect(sweepRunTitle()).toBe("Nightly layout sweep");
    expect(sweepRunTitle("abc123")).toBe("Layout sweep on abc123");
    expect(sweepRunTitle("abc123", true)).toBe("Layout sweep on abc123 (re-check)");
  });
  it("passes before the first sweep and after a passed one", () => {
    expect(applyNightlySweep(passed, null)).toBe(passed);
    expect(applyNightlySweep(passed, { conclusion: "success", url: "https://github.test/sweep", failedPages: [] })).toBe(passed);
  });
  it("goes ahead after a failed sweep once its pages passed again on this code", () => {
    const recheck = { status: "completed", conclusion: "success", url: "https://github.test/recheck" };
    const shipped = applyNightlySweep(passed, failed, recheck);
    expect(shipped.verdict).toBe("passed");
    expect(shipped.sweepNote).toBe("main's last nightly layout sweep failed (https://github.test/sweep) on Home, Sign in, and those pages passed again on this code (https://github.test/recheck)");
    expect(applyNightlySweep(passed, { ...failed, failedPages: [] }, recheck).sweepNote).toContain("and a whole sweep passed again on this code");
  });
  it("stops the ship when the pages failed again, or nothing measured them, naming both links and the pages", () => {
    const again = applyNightlySweep(passed, failed, { status: "completed", conclusion: "failure", url: "https://github.test/recheck" });
    expect(again.verdict).toBe("sweep_failed");
    expect(again.sweepNote).toBe("main's last nightly layout sweep failed (https://github.test/sweep) on Home, Sign in, and failed again on this code (https://github.test/recheck): fix the pages and merge, and the next ship measures them again");
    expect(applyNightlySweep(passed, failed).sweepNote).toContain(", and nothing measured them again on this code:");
    expect(applyNightlySweep(passed, failed, { status: "in_progress", conclusion: "", url: "https://github.test/recheck" }).verdict).toBe("sweep_failed");
  });
  it("leaves a verdict that didn't pass as it is", () => {
    const failedCheck = { ...passed, verdict: "failed" };
    expect(applyNightlySweep(failedCheck, failed)).toBe(failedCheck);
  });
  it("reads the pages from the failed jobs' log: the check's list line from every share, or its FAIL lines before it had one", () => {
    const listed = 'Sweep (2 of 4)\tRun\t2026-10-31T02:14:00Z LAYOUT FAILED PAGES ["Account closed","Sign in"]\nSweep (3 of 4)\tRun\t2026-10-31T02:15:00Z LAYOUT FAILED PAGES ["Developer settings, a spending request","Sign in"]\nSweep (3 of 4)\tRun\tz FAIL Home (/) Phone dark: 1';
    expect(sweepFailedPages(listed)).toEqual(["Account closed", "Sign in", "Developer settings, a spending request"]);
    const log = "Sweep (2 of 4)\tRun npm run layout:check\t2026-10-27T02:14:00Z FAIL Home (/) Steam Deck dark: 2\nSweep (2 of 4)\tRun\t2026-10-27T02:14:01Z FAIL Sign in (/signin) Phone light: 1\nSweep (2 of 4)\tRun\tz FAIL Home (/) Phone dark: 1\n  ok Games (/games) Phone light";
    expect(sweepFailedPages(log)).toEqual(["Home", "Sign in"]);
  });
});

describe("latestSweep and recheckOf", () => {
  const run = (databaseId: number, displayTitle: string, createdAt: string, conclusion = "success", status = "completed") => ({ databaseId, displayTitle, createdAt, conclusion, status, url: `https://github.test/${databaseId}` });
  const runs = [
    run(6, "Layout sweep on other (re-check)", "2026-10-31T16:00:00Z"),
    run(5, "Layout sweep on abc (re-check)", "2026-10-31T15:00:00Z", "", "in_progress"),
    run(4, "Layout sweep on abc (re-check)", "2026-10-31T14:00:00Z", "cancelled"),
    run(3, "Layout sweep on old (re-check)", "2026-10-31T02:00:00Z"),
    run(2, "Nightly layout sweep", "2026-10-31T08:00:00Z", "failure"),
    run(1, "Nightly layout sweep", "2026-10-30T02:00:00Z"),
  ];
  it("takes main's newest whole sweep that passed or failed, never a re-check", () => {
    expect(latestSweep(runs)?.databaseId).toBe(2);
    expect(latestSweep([run(9, "Layout sweep on abc", "2026-10-31T17:00:00Z", "failure"), ...runs])?.databaseId).toBe(9);
    expect(latestSweep([run(9, "Nightly layout sweep", "2026-10-31T17:00:00Z", "cancelled")])).toBe(null);
    expect(latestSweep([])).toBe(null);
  });
  it("finds the re-check on this code started after the sweep, one still going included, and skips a cancelled one", () => {
    const sweep = latestSweep(runs)!;
    expect(recheckOf(runs, sweep, ["abc"])?.databaseId).toBe(5);
    expect(recheckOf(runs, sweep, ["new", "abc"])?.databaseId).toBe(5);
    expect(recheckOf(runs, sweep, ["old"])).toBe(null);
    expect(recheckOf(runs, sweep, ["nothing"])).toBe(null);
    expect(recheckOf([run(7, "Layout sweep on abc", "2026-10-31T17:00:00Z", "", "queued"), ...runs], sweep, ["abc"])?.databaseId).toBe(7);
  });
});

describe("applyEnginesProof", () => {
  const skipped = { verdict: "passed", state: "passed", commitSha: "branch", url: "https://github.test/branch", engines: "skipped" };
  const base = (commitSha: string, engines: string) => ({ commitSha, state: "passed", url: `https://github.test/${commitSha}`, engines });
  it("leaves a run that played the engines alone", () => {
    const played = { ...skipped, engines: "passed" };
    expect(applyEnginesProof(played, [])).toBe(played);
    const failed = { ...skipped, verdict: "failed" };
    expect(applyEnginesProof(failed, [base("main", "passed")])).toBe(failed);
  });
  it("passes a skipped run on the engines' pass before the merge", () => {
    expect(applyEnginesProof(skipped, [base("docs", "skipped"), base("main", "passed")])).toMatchObject({ verdict: "passed", enginesProofSha: "main" });
  });
  it("waits for, or stops on, the engines before the merge", () => {
    expect(applyEnginesProof(skipped, [base("main", "running"), base("older", "passed")]).verdict).toBe("running");
    expect(applyEnginesProof(skipped, [base("main", "failed"), base("older", "passed")]).verdict).toBe("failed");
  });
  it("ships nothing the engines never played", () => {
    expect(applyEnginesProof(skipped, []).verdict).toBe("none");
    expect(applyEnginesProof(skipped, [base("docs", "skipped")]).verdict).toBe("none");
  });
});

describe("sameCodeCommits", () => {
  const folder = temporaryFolder("zaisma-ship-check-");
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  const runGit = (gitArguments: string[]) => {
    const result = spawnSync("git", ["-C", folder, "-c", "user.name=Test", "-c", "user.email=test@zaisma.test", "-c", "commit.gpgsign=false", ...gitArguments], { encoding: "utf8" });
    return result.status === 0 ? result.stdout : null;
  };
  const git = (...gitArguments: string[]) => {
    const output = runGit(gitArguments);
    if (output === null) throw new Error(`git ${gitArguments.join(" ")} failed`);
    return output.trim();
  };
  const commit = (path: string, text: string) => {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
    git("add", "-A");
    git("commit", "-q", "-m", `change ${path}`);
    return git("rev-parse", "HEAD");
  };
  git("init", "-q", "-b", "main");
  commit("apps/site/src/index.ts", "one");
  // A pull request that's up to date with main merges.
  git("checkout", "-q", "-b", "slice");
  const branchSha = commit("apps/site/src/index.ts", "two");
  git("checkout", "-q", "main");
  git("merge", "-q", "--no-ff", "-m", "Merge slice", "slice");
  const mergeSha = git("rev-parse", "HEAD");
  // Then a docs change lands on its own.
  const docsSha = commit("docs/DEVELOPER-API.md", "live");

  it("finds the pull request's branch for its merge commit", () => {
    expect(sameCodeCommits(runGit, mergeSha)).toEqual([mergeSha, branchSha]);
  });
  it("goes back past docs-only commits, and no further than the code", () => {
    expect(sameCodeCommits(runGit, docsSha)).toEqual([docsSha, mergeSha, branchSha]);
  });
  it("skips a branch that wasn't up to date when it merged", () => {
    git("checkout", "-q", "-b", "behind", mergeSha);
    const behindSha = commit("apps/games/src/index.ts", "behind");
    git("checkout", "-q", "main");
    const codeSha = commit("apps/rooms/src/index.ts", "moved");
    git("merge", "-q", "--no-ff", "-m", "Merge behind", "behind");
    const behindMergeSha = git("rev-parse", "HEAD");
    // The branch never had main's latest code, so its run didn't test what merged.
    expect(sameCodeCommits(runGit, behindMergeSha)).toEqual([behindMergeSha]);
    expect(sameCodeCommits(runGit, behindMergeSha)).not.toContain(behindSha);
    expect(sameCodeCommits(runGit, codeSha)).toEqual([codeSha]);
  });

  it("finds the main commit a pull request was cut from, for the engines' proof", () => {
    // mergeSha merged branchSha; its first parent is the commit before it.
    const parentSha = git("rev-parse", `${mergeSha}^1`);
    expect(enginesBaseCommits(runGit, [docsSha, mergeSha], branchSha)).toEqual([parentSha]);
    expect(enginesBaseCommits(runGit, [docsSha, mergeSha], docsSha)).toEqual([]);
  });
});
