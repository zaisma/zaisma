// Which GitHub check `npm run ship` (scripts/ship.mjs) counts for the commit it ships. Plain JavaScript
// like scripts/ship-checks.mjs, so a test can import it (ship.mjs deploys when imported).
//
// Ship deploys only code a full check passed on (.github/workflows/check.yml). That's the commit's own
// run (for a commit the merge queue landed, its merge group's, on that very commit: main's own push run
// then only passes on it), or the run of a commit with exactly the same code, so a merge never waits for
// the same tests twice:
// - a pull request's branch, when main's merge commit has its code: the ruleset makes a branch up to
//   date before it merges, its run tests the branch exactly as it is, and main never moves back (the
//   ruleset blocks force pushes);
// - an earlier commit on main, when only docs/, .claude/, CLAUDE.md or README.md changed since.
// A run that only ran the docs tests ("Docs tests") never counts for code.
// A pull request's run skips "Engine exports" when its branch changed nothing that job runs (scripts/affected-tests.mjs,
// from the repository's graph); a run like that counts only with an Engine exports pass on the main commit it was cut
// from (applyEnginesProof), since the branch's code is that commit's code where the engines look.
// A pull request's Layout check measures pages only for how they arrange their pieces; every page on every screen is measured each night
// on main (.github/workflows/nightly.yml), and a failed sweep stops the ship until it passes again (applyNightlySweep).

// The check the ruleset requires, which passes only when the jobs before it did.
export const GITHUB_CHECK_NAME = "Tests and typecheck";
// The job that runs instead of the full tests when only docs changed.
export const DOCS_TESTS_CHECK_NAME = "Docs tests";
// Paths that hold no code that's tested or deployed. The same paths are in check.yml's "What changed".
export const DOCS_ONLY_PATH = /^(docs\/|\.claude\/|CLAUDE\.md$|README\.md$)/;
// The jobs that play the engine samples, "Engine exports (1 of 3)" and the rest, each with its share of them. A pull request runs
// them only when its branch changes something they run (scripts/affected-tests.mjs); a push to main always does.
export const ENGINES_CHECK_NAME = "Engine exports";
const isEnginesCheck = (name) => name === ENGINES_CHECK_NAME || name.startsWith(`${ENGINES_CHECK_NAME} (`);
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
 * What one commit's check runs (GitHub's check-runs API with filter=all: every run and every attempt) say about its code:
 * "passed" and "failed" for the full tests and typecheck, "docs_passed" and "docs_failed" when only the docs tests ran,
 * "running", or "none". Each check counts by its latest run (one still going counts first). A commit the merge queue landed has
 * two workflow runs, its merge group's and main's own push, which skips the checking jobs the queue already ran; a rerun that
 * found the code already checked does the same. So `engines`, the Engine exports jobs' state with all their shares together,
 * counts the latest run of each share that ran, and is "skipped" (a pull request that changed nothing they run) only when none
 * did: "passed", "failed" (any share), "running", "skipped" or "none". And only docs tests ran when tests never did.
 */
export function checkState(checkRuns) {
  const check = latestOf(checkRuns.filter((checkRun) => checkRun.name === GITHUB_CHECK_NAME));
  if (!check) return { state: "none", url: null, engines: "none" };
  const isRan = (checkRun) => !(checkRun.status === "completed" && checkRun.conclusion === "skipped");
  const allEngineRuns = checkRuns.filter((checkRun) => isEnginesCheck(checkRun.name));
  const ranEngineRuns = allEngineRuns.filter(isRan);
  const engineRuns = ranEngineRuns.length ? [...new Set(ranEngineRuns.map((checkRun) => checkRun.name))].map((name) => latestOf(ranEngineRuns.filter((checkRun) => checkRun.name === name))) : allEngineRuns;
  const isEngines = (conclusion) => engineRuns.length > 0 && engineRuns.every((engineRun) => engineRun.status === "completed" && engineRun.conclusion === conclusion);
  const engines = !engineRuns.length ? "none" : engineRuns.some((engineRun) => engineRun.status === "completed" && !["success", "skipped"].includes(engineRun.conclusion)) ? "failed" : engineRuns.some((engineRun) => engineRun.status !== "completed") ? "running" : isEngines("success") ? "passed" : isEngines("skipped") ? "skipped" : "failed";
  if (check.status !== "completed") return { state: "running", url: check.html_url, engines };
  const isDocsRun = checkRuns.some((checkRun) => checkRun.name === DOCS_TESTS_CHECK_NAME && checkRun.status === "completed" && isRan(checkRun)) && !checkRuns.some((checkRun) => checkRun.name.startsWith("Tests (") && isRan(checkRun));
  const isPassed = check.conclusion === "success";
  return { state: `${isDocsRun ? "docs_" : ""}${isPassed ? "passed" : "failed"}`, url: check.html_url, engines };
}

/** The latest of these runs of one check: one still going, else the last to finish (the first given, when they don't say when). */
function latestOf(checkRuns) {
  const going = checkRuns.find((checkRun) => checkRun.status !== "completed");
  if (going) return going;
  return checkRuns.reduce((latest, checkRun) => (latest && (Date.parse(checkRun.completed_at ?? "") || 0) <= (Date.parse(latest.completed_at ?? "") || 0) ? latest : checkRun), undefined);
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
// The nightly sweep's last job, which passes only when every share did.
export const NIGHTLY_SWEEP_CHECK_NAME = "Nightly layout sweep result";
// The command that runs it again, once the pages are fixed and merged.
export const NIGHTLY_SWEEP_RERUN_COMMAND = "gh workflow run nightly.yml";

/**
 * The pages a failed sweep names, from its failed jobs' log (layout-check.mjs prints "FAIL <page> (<path>) <screen> <theme>: <count>"),
 * each once, in the order they failed.
 */
export function sweepFailedPages(logText) {
  return [...new Set([...(logText ?? "").matchAll(/\sFAIL (.+?) \(\/[^)]*\) /g)].map((match) => match[1]))];
}

/**
 * A passed verdict stands only while main's latest nightly sweep (`sweep`: { conclusion, url, failedPages }, or null before the first)
 * hasn't failed: a failed one stops the ship with its link, the pages it named and how to clear it. Only a pass or a failure decides
 * (a cancelled run says nothing), and no run yet passes.
 */
export function applyNightlySweep(checked, sweep) {
  if (checked.verdict !== "passed" || !sweep || sweep.conclusion !== "failure") return checked;
  const pages = sweep.failedPages?.length ? `, on ${sweep.failedPages.join(", ")}` : "";
  return { ...checked, verdict: "sweep_failed", sweepUrl: sweep.url, sweepNote: `main's last nightly layout sweep failed (${sweep.url})${pages}: fix the pages, merge, and run it again with ${NIGHTLY_SWEEP_RERUN_COMMAND}` };
}

export function applyEnginesProof(checked, baseStates) {
  if (checked.verdict !== "passed" || checked.engines !== "skipped") return checked;
  const proof = baseStates.find((baseState) => ["passed", "failed", "running"].includes(baseState.engines));
  if (!proof) return { ...checked, verdict: "none", enginesNote: "its pull request skipped Engine exports and no Engine exports run on the commit before it passed" };
  if (proof.engines === "passed") return { ...checked, enginesProofSha: proof.commitSha };
  return { ...checked, verdict: proof.engines, url: proof.url, enginesNote: "Engine exports on the commit before the merge" };
}
