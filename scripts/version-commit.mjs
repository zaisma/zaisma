#!/usr/bin/env node
// Whether a pull request's commit only sets the CLI's or game server's version on top of a commit that passed GitHub's check. It then
// changes nothing that check tests, so .github/workflows/check.yml ("What changed") runs it as a docs change; the merge queue still runs every
// test on the pull request merged with main. Anything else, or GitHub not answering, is no: the commit gets the whole check.
// Plain Node with no packages, so it runs before npm ci.
//
//   node scripts/version-commit.mjs <commit sha>     prints true or false
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { GITHUB_CHECK_NAME } from "./ship-github-check.mjs";

const VERSIONED_PACKAGE_DIFF_LINE = /^diff --git a\/(packages\/(?:cli|game-server)\/package\.json) b\/\1$/;
const VERSION_CHANGE_LINE = /^[-+] {2}"version": "\d+\.\d+\.\d+",$/;
const DIFF_HEADER_LINE = /^(index [0-9a-f]+\.\.[0-9a-f]+( \d+)?|--- a\/\S+|\+\+\+ b\/\S+|@@ .* @@.*)$/;

/** Whether a `git diff --unified=0` changes the version line of the versioned packages' manifests and nothing else, with nothing unusual in it. */
export function isVersionOnlyDiff(unifiedDiff) {
  const diffLines = unifiedDiff.split("\n").filter(Boolean);
  if (!diffLines.some((line) => VERSIONED_PACKAGE_DIFF_LINE.test(line))) return false;
  return diffLines.every((line) => (line.startsWith("diff ") ? VERSIONED_PACKAGE_DIFF_LINE.test(line) : VERSION_CHANGE_LINE.test(line) || DIFF_HEADER_LINE.test(line)));
}

/** The commit's one parent when the commit only sets a version, else null (a merge commit has two). `runGit(arguments)` answers git's output. */
export function parentOfVersionCommit(runGit, commitSha) {
  const [, parentSha, ...otherParents] = runGit(["rev-list", "--parents", "--max-count=1", commitSha]).trim().split(" ");
  if (!parentSha || otherParents.length) return null;
  return isVersionOnlyDiff(runGit(["diff", "--unified=0", parentSha, commitSha])) ? parentSha : null;
}

/** Whether GitHub's latest runs of the required check on this commit all passed, from the check-runs API's answer. */
export function isCheckPassed(checkRuns) {
  const required = checkRuns.filter((checkRun) => checkRun.name === GITHUB_CHECK_NAME);
  return required.length > 0 && required.every((checkRun) => checkRun.status === "completed" && checkRun.conclusion === "success");
}

function main() {
  const runGit = (gitArguments) => execFileSync("git", gitArguments, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const parentSha = parentOfVersionCommit(runGit, process.argv[2]);
  if (!parentSha) return false;
  const answer = execFileSync("gh", ["api", `repos/${process.env.GITHUB_REPOSITORY}/commits/${parentSha}/check-runs?check_name=${encodeURIComponent(GITHUB_CHECK_NAME)}&per_page=100`], { encoding: "utf8" });
  return isCheckPassed(JSON.parse(answer).check_runs);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  let isVersionCommit = false;
  try {
    isVersionCommit = main();
  } catch (error) {
    console.error(`Checking the whole commit: ${error.message}`);
  }
  console.log(String(isVersionCommit));
}
