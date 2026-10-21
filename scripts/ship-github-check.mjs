// Which GitHub check `npm run ship` (scripts/ship.mjs) counts for the commit it ships. Plain JavaScript
// like scripts/ship-checks.mjs, so a test can import it (ship.mjs deploys when imported).
//
// Ship deploys only code a full check passed on (.github/workflows/check.yml). That's the commit's own
// run, or the run of a commit with exactly the same code, so a merge never waits for the same tests
// twice:
// - a pull request's branch, when main's merge commit has its code: the ruleset makes a branch up to
//   date before it merges, its run tests the branch exactly as it is, and main never moves back (the
//   ruleset blocks force pushes);
// - an earlier commit on main, when only docs/, .claude/, CLAUDE.md or README.md changed since.
// A run that only ran the docs tests ("Docs tests") never counts for code.
// A pull request's run skips "Engine exports" when its branch changed none of the code that job plays
// (ENGINES_PATH); a run like that counts only with an Engine exports pass on the main commit it was cut from
// (applyEnginesProof), since the branch's code is that commit's code where the engines look.

// The check the ruleset requires, which passes only when the jobs before it did.
export const GITHUB_CHECK_NAME = "Tests and typecheck";
// The job that runs instead of the full tests when only docs changed.
export const DOCS_TESTS_CHECK_NAME = "Docs tests";
// Paths that hold no code that's tested or deployed. The same paths are in check.yml's "What changed".
export const DOCS_ONLY_PATH = /^(docs\/|\.claude\/|CLAUDE\.md$|README\.md$)/;
// The job that plays the engine samples. A pull request runs it only when its branch changes a path below; a push to main always does.
export const ENGINES_CHECK_NAME = "Engine exports";
// What npm run engines:play exercises: the site Worker (uploads, the scan, game pages), the games Worker, the compress
// Worker, the packages they and the upload command use, the database, the preview and the engine scripts and samples,
// the packages installed, and the workflow itself. The same paths are in check.yml's "What changed".
export const ENGINES_PATH = /^(apps\/(site|games|compress)\/|packages\/(core|sdk|cli|game-server)\/|migrations\/|scripts\/(preview|engines)\/|test\/engines\/|\.github\/workflows\/check\.yml$|package(-lock)?\.json$)/;
// How far back along main to look for a commit with the same code.
export const SAME_CODE_SEARCH_COMMIT_COUNT = 20;

const lines = (text) => (text ?? "").split("\n").map((line) => line.trim()).filter(Boolean);

/** Whether a change to these paths leaves the code as it was. */
export const isDocsOnly = (changedPaths) => changedPaths.every((path) => DOCS_ONLY_PATH.test(path));

/**
 * Commits whose code is exactly this commit's, newest first: the commit itself, then back along main
 * while only docs changed, each followed by the pull request branch it merged when that branch was up
 * to date with main and has the same code. `runGit(arguments)` answers git's output, or null when git
 * exits with an error.
 */
export function sameCodeCommits(runGit, commitSha, { searchCommitCount = SAME_CODE_SEARCH_COMMIT_COUNT } = {}) {
  const isSameCode = (otherSha) => {
    const changedPaths = runGit(["diff", "--name-only", otherSha, commitSha]);
    return changedPaths !== null && isDocsOnly(lines(changedPaths));
  };
  const commitShas = [];
  for (const mainSha of lines(runGit(["rev-list", "--first-parent", `--max-count=${searchCommitCount}`, commitSha]))) {
    if (mainSha !== commitSha && !isSameCode(mainSha)) break;
    commitShas.push(mainSha);
    const branchSha = lines(runGit(["rev-parse", "--verify", "--quiet", `${mainSha}^2`]))[0];
    const isBranchUpToDate = branchSha && runGit(["merge-base", "--is-ancestor", `${mainSha}^1`, branchSha]) !== null;
    if (isBranchUpToDate && isSameCode(branchSha)) commitShas.push(branchSha);
  }
  return commitShas;
}

/** Whether a change to these paths changes code the engine samples play. */
export const isEnginesChanged = (changedPaths) => changedPaths.some((path) => ENGINES_PATH.test(path));

/**
 * What one commit's check runs (GitHub's check-runs API, latest of each name) say about its code:
 * "passed" and "failed" for the full tests and typecheck, "docs_passed" and "docs_failed" when only the
 * docs tests ran, "running", or "none". `engines` is the Engine exports job's own state: "passed", "failed",
 * "running", "skipped" (a pull request that changed none of its code) or "none".
 */
export function checkState(checkRuns) {
  const check = checkRuns.find((checkRun) => checkRun.name === GITHUB_CHECK_NAME);
  if (!check) return { state: "none", url: null, engines: "none" };
  const engineRun = checkRuns.find((checkRun) => checkRun.name === ENGINES_CHECK_NAME);
  const engines = !engineRun ? "none" : engineRun.status !== "completed" ? "running" : engineRun.conclusion === "success" ? "passed" : engineRun.conclusion === "skipped" ? "skipped" : "failed";
  if (check.status !== "completed") return { state: "running", url: check.html_url, engines };
  const docsTests = checkRuns.find((checkRun) => checkRun.name === DOCS_TESTS_CHECK_NAME);
  const isDocsRun = Boolean(docsTests && docsTests.status === "completed" && docsTests.conclusion !== "skipped");
  const isPassed = check.conclusion === "success";
  return { state: `${isDocsRun ? "docs_" : ""}${isPassed ? "passed" : "failed"}`, url: check.html_url, engines };
}

/**
 * The verdict on the code being shipped, from its same-code commits' states, newest first (the commit
 * being shipped is the first): "passed" or "failed" from the newest finished full check, except that a
 * failure on the commit itself always stops it; "running" while one may still decide it; "none" when
 * no full check exists on this code.
 */
export function judgeCheckedCode(commitStates) {
  const [own] = commitStates;
  if (own && (own.state === "failed" || own.state === "docs_failed")) return { verdict: "failed", ...own };
  const decider = commitStates.find((commitState) => commitState.state === "passed" || commitState.state === "failed");
  if (decider) return { verdict: decider.state, ...decider };
  const running = commitStates.find((commitState) => commitState.state === "running");
  if (running) return { verdict: "running", ...running };
  return { verdict: "none", ...(own ?? {}) };
}

/**
 * The main commit a pull request's run was cut from and the commits with its code, for a verdict that rests on a
 * run that skipped Engine exports: the first parent of the merge commit (among `mainShas`, newest first) that
 * merged `branchSha`. Empty when `branchSha` merged nowhere there. The pull request's branch was up to date with it
 * when it merged, so where the engines look the branch's code is that commit's.
 */
export function enginesBaseCommits(runGit, mainShas, branchSha, { searchCommitCount = SAME_CODE_SEARCH_COMMIT_COUNT } = {}) {
  for (const mainSha of mainShas) {
    if (lines(runGit(["rev-parse", "--verify", "--quiet", `${mainSha}^2`]))[0] !== branchSha) continue;
    const baseSha = lines(runGit(["rev-parse", "--verify", "--quiet", `${mainSha}^1`]))[0];
    return baseSha ? sameCodeCommits(runGit, baseSha, { searchCommitCount }) : [];
  }
  return [];
}

/**
 * A passed verdict whose run skipped Engine exports stands only on an Engine exports pass at the commit the pull
 * request was cut from: the newest of `baseStates` (those commits' checkState answers, newest first) that ran the
 * job decides, "running" waits, a failure stops, and none at all means the code was never played.
 */
export function applyEnginesProof(checked, baseStates) {
  if (checked.verdict !== "passed" || checked.engines !== "skipped") return checked;
  const proof = baseStates.find((baseState) => ["passed", "failed", "running"].includes(baseState.engines));
  if (!proof) return { ...checked, verdict: "none", enginesNote: "its pull request skipped Engine exports and no Engine exports run on the commit before it passed" };
  if (proof.engines === "passed") return { ...checked, enginesProofSha: proof.commitSha };
  return { ...checked, verdict: proof.engines, url: proof.url, enginesNote: "Engine exports on the commit before the merge" };
}
