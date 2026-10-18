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

// The check the ruleset requires, which passes only when the jobs before it did.
export const GITHUB_CHECK_NAME = "Tests and typecheck";
// The job that runs instead of the full tests when only docs changed.
export const DOCS_TESTS_CHECK_NAME = "Docs tests";
// Paths that hold no code that's tested or deployed. The same paths are in check.yml's "What changed".
export const DOCS_ONLY_PATH = /^(docs\/|\.claude\/|CLAUDE\.md$|README\.md$)/;
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

/**
 * What one commit's check runs (GitHub's check-runs API, latest of each name) say about its code:
 * "passed" and "failed" for the full tests and typecheck, "docs_passed" and "docs_failed" when only the
 * docs tests ran, "running", or "none".
 */
export function checkState(checkRuns) {
  const check = checkRuns.find((checkRun) => checkRun.name === GITHUB_CHECK_NAME);
  if (!check) return { state: "none", url: null };
  if (check.status !== "completed") return { state: "running", url: check.html_url };
  const docsTests = checkRuns.find((checkRun) => checkRun.name === DOCS_TESTS_CHECK_NAME);
  const isDocsRun = Boolean(docsTests && docsTests.status === "completed" && docsTests.conclusion !== "skipped");
  const isPassed = check.conclusion === "success";
  return { state: `${isDocsRun ? "docs_" : ""}${isPassed ? "passed" : "failed"}`, url: check.html_url };
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
