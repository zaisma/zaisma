import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DOCS_ONLY_PATH,
  DOCS_TESTS_CHECK_NAME,
  ENGINES_CHECK_NAME,
  ENGINES_PATH,
  GITHUB_CHECK_NAME,
  applyEnginesProof,
  checkState,
  enginesBaseCommits,
  isDocsOnly,
  isEnginesChanged,
  judgeCheckedCode,
  sameCodeCommits,
  // @ts-expect-error: a plain JavaScript script without types
} from "../../scripts/ship-github-check.mjs";

/** scripts/ship-github-check.mjs: which GitHub check `npm run ship` counts for the code it ships. */

const ROOT = join(import.meta.dirname, "../..");
const workflow = readFileSync(join(ROOT, ".github/workflows/check.yml"), "utf8");

describe("the workflow and ship agree", () => {
  it("on the required check's name and the docs tests' name", () => {
    expect(workflow).toContain(`name: ${GITHUB_CHECK_NAME}\n`);
    expect(workflow).toContain(`name: ${DOCS_TESTS_CHECK_NAME}\n`);
    expect(workflow).toContain(`name: ${ENGINES_CHECK_NAME}\n`);
  });
  it("on which paths the engine exports play", () => {
    expect(workflow).toContain(`grep -qE '${ENGINES_PATH.source.replaceAll("\\/", "/")}'`);
  });
  it("on running the engine exports on every push to main, and failing the required check when they fail", () => {
    expect(workflow).toContain(`if [ "$EVENT_NAME" != pull_request ] ||`);
    expect(workflow).toContain(`if [ "$ENGINES_RESULT" = skipped ] && [ "$IS_ENGINES_CHANGED" = false ]; then engines_ok=true; fi`);
    // A skip passes only with the engines' own flag false; any other result but success leaves engines_ok false.
    expect(workflow).toContain(`if [ "$ENGINES_RESULT" = success ]; then engines_ok=true; fi`);
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

describe("isEnginesChanged", () => {
  it("is the code the engine samples play, and nothing else", () => {
    for (const path of ["apps/site/src/developer.ts", "apps/games/src/index.ts", "apps/compress/src/index.ts", "packages/core/src/uploads.ts", "packages/sdk/zaisma.js", "packages/cli/zaisma.mjs", "packages/game-server/src/pass.ts", "migrations/0001_init.sql", "scripts/preview/run.mjs", "scripts/engines/play.mjs", "test/engines/godot/build/index.html", ".github/workflows/check.yml", "package.json", "package-lock.json"]) expect(isEnginesChanged([path]), path).toBe(true);
    for (const path of ["apps/rooms/src/room.ts", "apps/photodna/src/index.ts", "docs/DEVELOPER-API.md", "scripts/ship.mjs", "scripts/ship-github-check.mjs", "test/site/uploads.test.ts", "test/shards.ts", "examples/arena/server.ts", "vitest.config.ts", "brand/README.md", ".github/workflows/watch.yml"]) expect(isEnginesChanged([path]), path).toBe(false);
    expect(isEnginesChanged(["docs/DEVELOPER-API.md", "packages/cli/zaisma.mjs"])).toBe(true);
    expect(isEnginesChanged([])).toBe(false);
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
  it("tells a docs-only run apart", () => {
    expect(checkState([run(GITHUB_CHECK_NAME, "completed", "success"), run(DOCS_TESTS_CHECK_NAME, "completed", "success")]).state).toBe("docs_passed");
    expect(checkState([run(GITHUB_CHECK_NAME, "completed", "failure"), run(DOCS_TESTS_CHECK_NAME, "completed", "failure")]).state).toBe("docs_failed");
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
  it("never counts docs tests for code", () => {
    expect(judgeCheckedCode([at("roadmap", "docs_passed"), at("talk", "docs_passed")]).verdict).toBe("none");
    expect(judgeCheckedCode([at("merge", "none")]).verdict).toBe("none");
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
  const folder = mkdtempSync(join(tmpdir(), "zaisma-ship-check-"));
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
