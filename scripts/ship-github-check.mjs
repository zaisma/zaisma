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
// A run that only ran the docs tests ("Docs tests") never counts for code, and neither does a pull request's run that ran only the
// tests its change reaches ("Reached tests (1 of 4)" and the rest, instead of "Tests (1 of 4)"): only the merge queue's and main's
// runs, which run every test, count since then (Julius, Oct 26, 2026).
// A pull request's run skips "Engine exports" when its branch changed nothing that job runs (scripts/affected-tests.mjs,
// from the repository's graph); a run like that counts only with an Engine exports pass on the main commit it was cut
// from (applyEnginesProof), since the branch's code is that commit's code where the engines look.
// A pull request's Layout check measures pages only for how they arrange their pieces; the merge queue measures every page its change
// reaches on every screen (check.yml, "Every screen"), and every page is measured each night on main (.github/workflows/nightly.yml).
// After a failed sweep, the ship measures the pages it named again on the commit it ships, and goes ahead only when they pass
// (applyNightlySweep).

// The check the ruleset requires, which passes only when the jobs before it did.
export const GITHUB_CHECK_NAME = "Tests and typecheck";
// The job that runs instead of the full tests when only docs changed.
export const DOCS_TESTS_CHECK_NAME = "Docs tests";
// The test jobs of a pull request's run that ran only the tests its change reaches, "Reached tests (1 of 4)" and the rest.
export const REACHED_TESTS_CHECK_NAME = "Reached tests";
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
 * "reached_passed" and "reached_failed" when only the tests a pull request's change reaches ran,
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
  const isReachedRun = checkRuns.some((checkRun) => checkRun.name.startsWith(`${REACHED_TESTS_CHECK_NAME} (`) && isRan(checkRun)) && !checkRuns.some((checkRun) => checkRun.name.startsWith("Tests (") && isRan(checkRun));
  const isPassed = check.conclusion === "success";
  return { state: `${isDocsRun ? "docs_" : isReachedRun ? "reached_" : ""}${isPassed ? "passed" : "failed"}`, url: check.html_url, engines };
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
// The night's sweep's title, and the workflow's name.
export const NIGHTLY_SWEEP_NAME = "Nightly layout sweep";
// The workflow the ship runs to measure a failed sweep's pages again, on the commit it ships.
export const NIGHTLY_SWEEP_WORKFLOW = "nightly.yml";
// What a re-check's title ends in (nightly.yml's run-name): a sweep of only some pages, which never counts as main's latest sweep.
export const RECHECK_TITLE_END = " (re-check)";

/**
 * A run's title, as nightly.yml's run-name gives it: "Nightly layout sweep" for the night's, "Layout sweep on <sha>" for a whole sweep of
 * one commit, and "Layout sweep on <sha> (re-check)" for only some pages of it.
 */
export function sweepRunTitle(commitSha = null, isRecheck = false) {
  return commitSha ? `Layout sweep on ${commitSha}${isRecheck ? RECHECK_TITLE_END : ""}` : NIGHTLY_SWEEP_NAME;
}

/**
 * The pages a failed sweep names, from its failed jobs' log, each once, in the order they failed: layout-check.mjs's
 * "LAYOUT FAILED PAGES [<names>]" lines, one per share, or, in a log from before them, its "FAIL <page> (<path>) <screen> <theme>" lines.
 */
export function sweepFailedPages(logText) {
  const lists = [...(logText ?? "").matchAll(/LAYOUT FAILED PAGES (\[.*\])\s*$/gm)].flatMap((match) => {
    try {
      return JSON.parse(match[1]);
    } catch {
      return [];
    }
  });
  if (lists.length) return [...new Set(lists)];
  return [...new Set([...(logText ?? "").matchAll(/\sFAIL (.+?) \(\/[^)]*\) /g)].map((match) => match[1]))];
}

/**
 * Main's latest whole sweep among nightly.yml's runs (gh run list's databaseId, status, conclusion, url, displayTitle, createdAt; newest
 * first): the newest finished one that passed or failed and isn't a re-check (a cancelled run says nothing), or null before the first.
 */
export function latestSweep(runs) {
  return runs.find((run) => run.status === "completed" && ["success", "failure"].includes(run.conclusion) && !run.displayTitle?.endsWith(RECHECK_TITLE_END)) ?? null;
}

/**
 * The run that measured a failed sweep's pages again on this code: the newest of nightly.yml's runs started after the sweep whose title
 * names one of the commits with this code (`sameCodeShas`), a re-check or a whole sweep, finished or still going; null when there's none.
 */
export function recheckOf(runs, sweep, sameCodeShas) {
  const titles = sameCodeShas.flatMap((sha) => [sweepRunTitle(sha, true), sweepRunTitle(sha)]);
  return runs.find((run) => titles.includes(run.displayTitle) && Date.parse(run.createdAt) > Date.parse(sweep.createdAt) && !(run.status === "completed" && !["success", "failure"].includes(run.conclusion))) ?? null;
}

/**
 * A passed verdict stands while main's latest sweep (`sweep`: { conclusion, url, failedPages }, or null before the first) passed, or, when
 * it failed, once its pages passed again on this code (`recheck`, the run recheckOf found and waited for): a failed or missing re-check
 * stops the ship with both links and the pages. Only a pass or a failure decides, and no run yet passes.
 */
export function applyNightlySweep(checked, sweep, recheck = null) {
  if (checked.verdict !== "passed" || !sweep || sweep.conclusion !== "failure") return checked;
  const pages = sweep.failedPages?.length ? ` on ${sweep.failedPages.join(", ")}` : "";
  if (recheck?.status === "completed" && recheck.conclusion === "success") return { ...checked, sweepNote: `main's last nightly layout sweep failed (${sweep.url})${pages}, and ${pages ? "those pages" : "a whole sweep"} passed again on this code (${recheck.url})` };
  const again = recheck ? `, and failed again on this code (${recheck.url})` : ", and nothing measured them again on this code";
  return { ...checked, verdict: "sweep_failed", sweepUrl: sweep.url, sweepNote: `main's last nightly layout sweep failed (${sweep.url})${pages}${again}: fix the pages and merge, and the next ship measures them again` };
}

export function applyEnginesProof(checked, baseStates) {
  if (checked.verdict !== "passed" || checked.engines !== "skipped") return checked;
  const proof = baseStates.find((baseState) => ["passed", "failed", "running"].includes(baseState.engines));
  if (!proof) return { ...checked, verdict: "none", enginesNote: "its pull request skipped Engine exports and no Engine exports run on the commit before it passed" };
  if (proof.engines === "passed") return { ...checked, enginesProofSha: proof.commitSha };
  return { ...checked, verdict: proof.engines, url: proof.url, enginesNote: "Engine exports on the commit before the merge" };
}
