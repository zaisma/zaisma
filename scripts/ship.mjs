#!/usr/bin/env node
// Ship what's on GitHub's main: npm run ship, from any checkout of the repo.
//
// It never deploys the checkout it's run from. It fetches origin/main into its own clean copy
// (.claude/ship in the main checkout, a detached worktree), then from there:
//   Deploys with a Cloudflare API token from the macOS keychain (scripts/ship-token.mjs), never wrangler's sign-in;
//   0. stops unless GitHub's check (tests and typecheck) passed on that code: on the commit, or on the
//      pull request branch or earlier commit with exactly its code (scripts/ship-github-check.mjs);
//      waits for it while it's running; when main's last nightly layout sweep failed, measures the pages it named again on
//      that commit (nightly.yml as a re-check) and goes on only once they pass;
//   1. lists the live database's pending migrations and applies them. Ones that only add or change
//      (tables, columns, indexes, backfills) apply by themselves. When one deletes data (DROP TABLE,
//      DROP COLUMN, DELETE FROM, TRUNCATE) it needs a terminal, where wrangler asks Julius first;
//      without one (Claude, a `!` command) it stops before deploying anything; then makes any queue the
//      Workers name that the account doesn't have yet;
//   2. deploys rooms, games, photodna (with PhotoDNA's SDK from Julius's machine), compress and site, in that order;
//   3. checks that npm has the command-line tool's version: a GitHub workflow
//      (.github/workflows/publish-cli.yml) publishes it from main, never ship;
//   4. loads a game page, the MCP, a game's files and the rooms' pass and receipt keys on the live site, and runs the
//      security checks in scripts/ship-checks.mjs (headers, http, the private check game, R2 buckets,
//      /admin); a door that opens is SHIP FAIL, fixed before anything else.
// It also brings the main checkout's main up to date, when that is a clean fast-forward, and then links the private
// ops repo's skills into it when this machine has an ops clone (scripts/ops-setup.mjs --links).
// The last line says how it went, for Claude to read: SHIP PASS, SHIP WAITING or SHIP FAIL.
//
// An interruption isn't a failure (scripts/ship-resume.mjs): a step that loses the network (a Mac that slept, Wi-Fi)
// waits for it and runs again; when it stays away the last line is `SHIP FAIL interrupted: …` (exit code 3), and
// running it again picks up where it stopped, keeping the Workers this commit's ship already deployed.
//
//   npm run ship                              ship
//   npm run ship -- --dry                     say what it would ship; deploy and change nothing
//   npm run ship -- --dry --commit <ref>      the same for another commit, e.g. HEAD to try a change
//                                             to this script before it merges (never deploys)
import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync, closeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NIGHTLY_SWEEP_WORKFLOW, applyEnginesProof, applyNightlySweep, checkState, enginesBaseCommits, judgeCheckedCode, latestSweep, recheckOf, sameCodeCommits, sweepFailedPages, sweepRunTitle } from "./ship-github-check.mjs";
import { CHECK_GAME_SLUG, CHECK_GAME_URL, PUBLISH_CLI_WORKFLOW_URL, PUBLISH_GAME_SERVER_WORKFLOW_URL, ROOMS_URL, SITE_URL, checkBuckets, checkPackageOnNpm, checkSecurityAddresses, checkUrl, publishedKeyCount, securityTxtProblems } from "./ship-checks.mjs";
import { linkSkills, opsPlacesOf } from "./ops-setup.mjs";
import { INTERRUPTED_EXIT_CODE, INTERRUPTED_LINE_START, deployWorkers, liveVersionIdOf, readShipProgress, runThroughInterruptions, writeShipProgress } from "./ship-resume.mjs";
import { missingShipTokenHelp, useShipToken } from "./ship-token.mjs";
// Microsoft's PhotoDNA SDK (Julius's machine only) and Docker, for the photodna Worker's container.
import { ensureDocker, placePhotoDnaSdk } from "./photodna-sdk.mjs";

// Deployed in this order: the site calls rooms and photodna and links to games, so they go first.
const WORKERS = ["rooms", "games", "photodna", "compress", "site"];
// Where GitHub's check runs (.github/workflows/check.yml).
const GITHUB_REPOSITORY = "zaisma/zaisma";
const GITHUB_CHECK_WAIT_SEC = 600;
// How long a ship waits for another one that's running.
const SHIP_LOCK_WAIT_SEC = 1800;

const isDryRun = process.argv.includes("--dry");
const commitArgumentIndex = process.argv.indexOf("--commit");
const commitRef = commitArgumentIndex > 0 ? process.argv[commitArgumentIndex + 1] : null;
if (commitRef !== null && (!isDryRun || !commitRef)) {
  process.stdout.write("\nSHIP FAIL --commit <ref> only works with --dry: a real ship always deploys GitHub's main.\n");
  process.exit(1);
}
const hasTerminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);

function run(command, commandArguments, options = {}) {
  const result = spawnSync(command, commandArguments, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  return { exitCode: result.status ?? 1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function git(folder, gitArguments) {
  const result = run("git", ["-C", folder, ...gitArguments]);
  if (result.exitCode !== 0) throw new Error(`git ${gitArguments.join(" ")} failed: ${result.output.trim()}`);
  return result.output.trim();
}

const say = (line = "") => process.stdout.write(`${line}\n`);
const finish = (status, summary, exitCode) => {
  say();
  say(`SHIP ${status} ${summary}`);
  process.exit(exitCode);
};

// The main checkout owns .git; every worktree points at it.
const gitFolder = git(process.cwd(), ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
const mainCheckout = dirname(gitFolder);
const shipCopy = join(mainCheckout, ".claude", "ship");
const lastShipFile = join(gitFolder, "zaisma-ship-last.json");
const progressFile = join(gitFolder, "zaisma-ship-progress.json");
const logFolder = join(gitFolder, "zaisma-ship-logs");

// The commit being shipped, once it's known: an interrupted ship names it and what of it is live.
let shippingSha = null;
function finishInterrupted(label) {
  const liveWorkers = shippingSha ? Object.keys(readShipProgress(progressFile, shippingSha).version_ids) : [];
  say();
  say(`${INTERRUPTED_LINE_START} ${shippingSha ? `${shippingSha.slice(0, 7)}: ` : ""}the network stayed away while ${label}; ${liveWorkers.length ? `${liveWorkers.join(", ")} deployed` : "nothing deployed"}. Nothing failed: npm run ship again picks up where this one stopped.`);
  process.exit(INTERRUPTED_EXIT_CODE);
}

/** A command that needs the network: run again once the network is back, and the ship ends interrupted when it stays away. */
async function runOnline(label, command, commandArguments, options = {}, { beforeRetry = () => {} } = {}) {
  const answer = await runThroughInterruptions(
    label,
    (retryIndex) => {
      if (retryIndex) beforeRetry();
      return run(command, commandArguments, options);
    },
    { say },
  );
  if (answer.isInterrupted) finishInterrupted(label);
  return answer;
}
const isInShipCopy = realpathSync(fileURLToPath(import.meta.url)) === (existsSync(join(shipCopy, "scripts/ship.mjs")) ? realpathSync(join(shipCopy, "scripts/ship.mjs")) : "");

if (!isInShipCopy) {
  // One ship at a time: two would deploy over each other from the same copy. A second one waits its
  // turn, then ships whatever main is by then, so sessions that merge at once never need each other.
  const lockFile = join(gitFolder, "zaisma-ship.lock");
  let lockHandle;
  for (let waitedSec = 0; !lockHandle; waitedSec += 10) {
    try {
      lockHandle = openSync(lockFile, "wx");
      break;
    } catch {}
    let holderPid = 0;
    try {
      holderPid = Number(readFileSync(lockFile, "utf8")) || 0;
    } catch {}
    let isHolderAlive = false;
    try {
      process.kill(holderPid, 0);
      isHolderAlive = holderPid > 0;
    } catch {}
    if (!isHolderAlive) {
      rmSync(lockFile, { force: true });
      continue;
    }
    if (isDryRun) finish("FAIL", `another ship is running (process ${holderPid}); a dry run doesn't wait for it.`, 1);
    if (waitedSec >= SHIP_LOCK_WAIT_SEC) finish("FAIL", `another ship (process ${holderPid}) was still running after ${SHIP_LOCK_WAIT_SEC / 60} minutes; nothing deployed. Run npm run ship again once it's done.`, 1);
    if (waitedSec === 0) say(`Another ship is running (process ${holderPid}); waiting for it to finish, then shipping main as it is by then…`);
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
  writeFileSync(lockHandle, String(process.pid));
  closeSync(lockHandle);
  const releaseLock = () => rmSync(lockFile, { force: true });
  process.on("exit", releaseLock);
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130));

  say("Fetching GitHub's main…");
  const fetched = await runOnline("fetching GitHub's main", "git", ["-C", mainCheckout, "fetch", "--quiet", "origin", "main"]);
  if (fetched.exitCode !== 0) finish("FAIL", `couldn't fetch GitHub's main (${fetched.output.trim().split("\n").at(-1)}); nothing deployed.`, 1);
  // A ref is read where the command runs, so HEAD is this checkout's.
  const commitSha = commitRef ? git(process.cwd(), ["rev-parse", "--verify", `${commitRef}^{commit}`]) : git(mainCheckout, ["rev-parse", "origin/main"]);
  if (existsSync(join(shipCopy, ".git"))) {
    // A ship killed in the middle of a checkout leaves git's lock behind; this one holds the ship lock, so it's nobody's.
    rmSync(join(git(shipCopy, ["rev-parse", "--absolute-git-dir"]), "index.lock"), { force: true });
    git(shipCopy, ["checkout", "--quiet", "--detach", "--force", commitSha]);
    // Everything not on main goes, except installed packages (reinstalled when the lockfile changes).
    git(shipCopy, ["clean", "-ffdxq", "-e", "node_modules"]);
  } else {
    // --force takes the folder back if it was deleted by hand but is still registered.
    git(mainCheckout, ["worktree", "add", "--quiet", "--force", "--detach", shipCopy, commitSha]);
  }
  if (!existsSync(join(shipCopy, "scripts/ship.mjs"))) finish("FAIL", "GitHub's main has no scripts/ship.mjs.", 1);
  // The rest runs from main's own copy of this script, so a stale checkout never ships with old steps.
  const shipRun = spawnSync(process.execPath, [join(shipCopy, "scripts/ship.mjs"), ...process.argv.slice(2)], { cwd: shipCopy, stdio: "inherit" });
  process.exit(shipRun.status ?? 1);
}

// From here on this is main's copy of the script, running in the clean copy.
const commitSha = git(shipCopy, ["rev-parse", "HEAD"]);
shippingSha = commitSha;
const shortSha = commitSha.slice(0, 7);
const commitSubject = git(shipCopy, ["log", "-1", "--format=%s"]);
say(`Shipping ${shortSha} ${commitSubject}`);
// Every wrangler call below, and the checks that call Cloudflare, use this token from the keychain,
// never wrangler's own sign-in. Without one nothing deploys.
if (!useShipToken()) {
  say(missingShipTokenHelp());
  finish("FAIL", `${shortSha}: no Cloudflare API token for ship in the keychain (steps above); nothing deployed.`, 1);
}
let lastShip = null;
try {
  lastShip = JSON.parse(readFileSync(lastShipFile, "utf8"));
} catch {}
if (lastShip?.commit_sha && lastShip.commit_sha !== commitSha) {
  const log = run("git", ["-C", shipCopy, "log", "--format=  %h %s", `${lastShip.commit_sha}..${commitSha}`]);
  const newCommits = log.exitCode === 0 ? log.output.trim().split("\n").filter(Boolean) : [];
  if (newCommits.length) {
    say(`New since the last ship from this machine (${lastShip.shipped_at}):`);
    for (const line of newCommits.slice(0, 20)) say(line);
    if (newCommits.length > 20) say(`  … and ${newCommits.length - 20} more`);
  }
} else if (lastShip?.commit_sha === commitSha) {
  say("Same commit as the last ship from this machine: shipping it again, keeping each Worker whose live version it deployed.");
}

// GitHub's check on this code (.github/workflows/check.yml): the full tests and typecheck, on this
// commit or on one with exactly its code (scripts/ship-github-check.mjs), so a merge that's up to date
// ships on its pull request's run at once. A failed one stops the ship; one that may still decide it is
// waited for; no full check on this code, or no way to read it, stops it too.
async function readCheckState(sha) {
  let result;
  try {
    // Every run and attempt (filter=all): the default shows only the newest, which can be main's own push run that steps aside for
    // the merge queue's (checkState reads each check by its latest run).
    result = await runOnline("reading GitHub's check", "gh", ["api", "--paginate", `repos/${GITHUB_REPOSITORY}/commits/${sha}/check-runs?filter=all&per_page=100`, "--jq", ".check_runs[] | {name, status, conclusion, html_url, completed_at}"]);
  } catch (error) {
    return { problem: error.message };
  }
  if (result.exitCode !== 0) return { problem: result.output.trim().split("\n").at(-1) };
  return { commitSha: sha, ...checkState(result.output.split("\n").filter((line) => line.startsWith("{")).map((line) => JSON.parse(line))) };
}
const runShipCopyGit = (gitArguments) => {
  const result = run("git", ["-C", shipCopy, ...gitArguments]);
  return result.exitCode === 0 ? result.output : null;
};
const sameCodeShas = sameCodeCommits(runShipCopyGit, commitSha);
async function readCheckStates(shas) {
  const commitStates = [];
  for (const sha of shas) commitStates.push(await readCheckState(sha));
  return commitStates;
}
async function readCheckedCode() {
  const commitStates = await readCheckStates(sameCodeShas);
  const problem = commitStates.find((commitState) => commitState.problem);
  if (problem) return { verdict: "unreadable", ...problem };
  const checked = judgeCheckedCode(commitStates);
  // A pull request's run that skipped Engine exports (none of its code changed) stands on the engines' pass before it.
  if (checked.verdict !== "passed" || checked.engines !== "skipped") return checked;
  const baseStates = await readCheckStates(enginesBaseCommits(runShipCopyGit, sameCodeShas, checked.commitSha));
  const baseProblem = baseStates.find((baseState) => baseState.problem);
  return baseProblem ? { verdict: "unreadable", ...baseProblem } : applyEnginesProof(checked, baseStates);
}
say("Reading GitHub's check…");
let checkedCode = await readCheckedCode();
for (let waitedSec = 0; !isDryRun && checkedCode.verdict === "running" && waitedSec < GITHUB_CHECK_WAIT_SEC; waitedSec += 15) {
  if (waitedSec === 0) say(`Waiting for GitHub's check to finish (${checkedCode.url})…`);
  await new Promise((resolve) => setTimeout(resolve, 15000));
  checkedCode = await readCheckedCode();
}
const checkedCommitNote = checkedCode.commitSha && checkedCode.commitSha !== commitSha ? ` on ${checkedCode.commitSha.slice(0, 7)}, which has exactly this code` : "";
let githubCheckNote;
if (checkedCode.verdict === "passed") githubCheckNote = `GitHub's check passed${checkedCommitNote}${checkedCode.enginesProofSha ? `, its pull request changed none of the code Engine exports plays, and they passed on ${checkedCode.enginesProofSha.slice(0, 7)} before it` : ""}`;
else if (checkedCode.verdict === "unreadable") githubCheckNote = `couldn't read GitHub's check (${checkedCode.problem})`;
else if (checkedCode.verdict === "none") githubCheckNote = checkedCode.enginesNote ? `no Engine exports pass on this code (${checkedCode.enginesNote})` : "no full GitHub check on this code";
else if (checkedCode.verdict === "running") githubCheckNote = `GitHub's check still running (${checkedCode.url})`;
else githubCheckNote = `GitHub's check failed${checkedCommitNote} (${checkedCode.url})`;
if (!isDryRun && checkedCode.verdict === "running") finish("FAIL", `${shortSha}: GitHub's check didn't finish in ${GITHUB_CHECK_WAIT_SEC / 60} minutes (${checkedCode.url}); nothing deployed. Run npm run ship again once it has.`, 1);
if (!isDryRun && checkedCode.verdict === "failed") finish("FAIL", `${shortSha}: ${githubCheckNote}; nothing deployed. Fix main, then ship again.`, 1);
if (!isDryRun && checkedCode.verdict !== "passed") finish("FAIL", `${shortSha}: ${githubCheckNote}; nothing deployed, since only code a full check passed on ships.`, 1);
say(githubCheckNote);

// Main's latest nightly layout sweep (.github/workflows/nightly.yml), which measures every page on every screen. After a failed one, the
// pages it named are measured again on this commit (a re-check, nightly.yml with commit_sha and pages; a whole sweep of this commit when
// it named none), and the ship goes ahead once they pass. A re-check already run on this code counts; one still going is waited for.
const SWEEP_RECHECK_WAIT_SEC = 1800;
async function readSweepRuns() {
  let listed;
  try {
    listed = await runOnline("reading main's nightly layout sweep", "gh", ["run", "list", "--repo", GITHUB_REPOSITORY, "--workflow", NIGHTLY_SWEEP_WORKFLOW, "--branch", "main", "--limit", "40", "--json", "databaseId,status,conclusion,url,displayTitle,createdAt"]);
  } catch (error) {
    return { problem: error.message };
  }
  if (listed.exitCode !== 0) return { problem: listed.output.trim().split("\n").at(-1) };
  try {
    return { runs: JSON.parse(listed.output.slice(listed.output.indexOf("[")) || "[]") };
  } catch {
    return { problem: `gh run list answered ${listed.output.trim().slice(0, 120)}` };
  }
}
async function readNightlySweep() {
  const { runs, problem } = await readSweepRuns();
  if (problem) return { problem };
  const latest = latestSweep(runs);
  if (!latest) return null;
  const failedPages = latest.conclusion === "failure" ? sweepFailedPages((await runOnline("reading the nightly sweep's failed pages", "gh", ["run", "view", String(latest.databaseId), "--repo", GITHUB_REPOSITORY, "--log-failed"])).output) : [];
  return { ...latest, failedPages, recheck: latest.conclusion === "failure" ? recheckOf(runs, latest, sameCodeShas) : null };
}
/** The failed sweep's pages measured again on this commit: the re-check run, once it finished or the wait ran out. */
async function recheckSweep(sweep) {
  let recheck = sweep.recheck;
  if (!recheck) {
    const startedMs = Date.now();
    const fields = ["-f", `commit_sha=${commitSha}`, ...(sweep.failedPages.length ? ["-f", `pages=${JSON.stringify(sweep.failedPages)}`] : [])];
    say(sweep.failedPages.length ? `Measuring ${sweep.failedPages.join(", ")} again on ${shortSha} (main's last nightly layout sweep failed on them)…` : `Sweeping ${shortSha} again (main's last nightly layout sweep failed)…`);
    const started = await runOnline("starting the layout re-check", "gh", ["workflow", "run", NIGHTLY_SWEEP_WORKFLOW, "--repo", GITHUB_REPOSITORY, "--ref", "main", ...fields]);
    if (started.exitCode !== 0) return { problem: started.output.trim().split("\n").at(-1) };
    const title = sweepRunTitle(commitSha, sweep.failedPages.length > 0);
    for (let waitedSec = 0; !recheck && waitedSec < 120; waitedSec += 5) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const { runs, problem } = await readSweepRuns();
      if (problem) return { problem };
      recheck = runs.find((run) => run.displayTitle === title && Date.parse(run.createdAt) >= startedMs - 60_000) ?? null;
    }
    if (!recheck) return { problem: `no run called "${title}" started within 2 minutes of gh workflow run` };
  }
  if (recheck.status !== "completed") say(`Waiting for the layout re-check (${recheck.url})…`);
  for (let waitedSec = 0; recheck.status !== "completed" && waitedSec < SWEEP_RECHECK_WAIT_SEC; waitedSec += 20) {
    await new Promise((resolve) => setTimeout(resolve, 20000));
    const { runs, problem } = await readSweepRuns();
    if (problem) return { problem };
    recheck = runs.find((run) => run.databaseId === recheck.databaseId) ?? recheck;
  }
  return recheck;
}
const nightlySweep = await readNightlySweep();
if (!isDryRun && nightlySweep?.problem) finish("FAIL", `${shortSha}: couldn't read main's nightly layout sweep (${nightlySweep.problem}); nothing deployed.`, 1);
let sweepRecheck = nightlySweep && !nightlySweep.problem ? nightlySweep.recheck : null;
if (!isDryRun && checkedCode.verdict === "passed" && nightlySweep?.conclusion === "failure") {
  sweepRecheck = await recheckSweep(nightlySweep);
  if (sweepRecheck.problem) finish("FAIL", `${shortSha}: main's last nightly layout sweep failed (${nightlySweep.url}), and its pages couldn't be measured again (${sweepRecheck.problem}); nothing deployed.`, 1);
  if (sweepRecheck.status !== "completed") finish("FAIL", `${shortSha}: the layout re-check didn't finish in ${SWEEP_RECHECK_WAIT_SEC / 60} minutes (${sweepRecheck.url}); nothing deployed. Run npm run ship again once it has.`, 1);
}
const sweptCode = applyNightlySweep(checkedCode, nightlySweep?.problem ? null : nightlySweep, sweepRecheck);
if (!isDryRun && sweptCode.verdict === "sweep_failed") finish("FAIL", `${shortSha}: ${sweptCode.sweepNote}; nothing deployed.`, 1);
if (isDryRun && nightlySweep?.conclusion === "failure" && !sweepRecheck) say(`main's last nightly layout sweep failed (${nightlySweep.url})${nightlySweep.failedPages.length ? ` on ${nightlySweep.failedPages.join(", ")}` : ""}: a ship would measure ${nightlySweep.failedPages.length ? "them" : "every page"} again on ${shortSha} first (not with --dry)`);
else say(sweptCode.sweepNote ?? (nightlySweep?.problem ? `couldn't read main's nightly layout sweep (${nightlySweep.problem})` : nightlySweep ? `main's last nightly layout sweep passed (${nightlySweep.url})` : "no nightly layout sweep on main yet"));

// The main checkout's main, brought up to date when that can't lose anything.
function updateMainCheckout() {
  const branch = run("git", ["-C", mainCheckout, "symbolic-ref", "--quiet", "--short", "HEAD"]).output.trim();
  const behindCount = Number(run("git", ["-C", mainCheckout, "rev-list", "--count", `main..${commitSha}`]).output.trim()) || 0;
  const aheadCount = Number(run("git", ["-C", mainCheckout, "rev-list", "--count", `${commitSha}..main`]).output.trim()) || 0;
  if (behindCount === 0) return "main checkout: up to date";
  if (aheadCount > 0) return `main checkout: left alone, its main has ${aheadCount} commit(s) not on GitHub`;
  if (branch !== "main") {
    // Not checked out there: move the branch only, fast-forward only.
    const result = run("git", ["-C", mainCheckout, "fetch", "--quiet", "origin", "main:main"]);
    return result.exitCode === 0 ? `main checkout: main moved up ${behindCount} commit(s) (checkout is on ${branch || "a detached commit"}, left as it is)` : `main checkout: left alone (${result.output.trim().split("\n")[0]})`;
  }
  const changedFiles = run("git", ["-C", mainCheckout, "status", "--porcelain", "--untracked-files=no"]).output.trim();
  if (changedFiles) return `main checkout: left alone, it has uncommitted changes (${changedFiles.split("\n").length} file(s))`;
  const result = run("git", ["-C", mainCheckout, "merge", "--quiet", "--ff-only", commitSha]);
  return result.exitCode === 0 ? `main checkout: pulled ${behindCount} commit(s)` : `main checkout: left alone (${result.output.trim().split("\n")[0]})`;
}
const mainCheckoutNote = isDryRun ? "main checkout: not touched (--dry)" : updateMainCheckout();
say(mainCheckoutNote);
// Right after the pull, so sessions starting now find every skill: a pull that removed a tracked skill folder is
// followed at once by its link to the ops clone.
if (!isDryRun) {
  const opsSkills = linkSkills({ checkoutDir: mainCheckout, opsDir: opsPlacesOf().opsDir });
  if (opsSkills.linked.length || opsSkills.removed.length) say(`ops skills: linked ${opsSkills.linked.join(", ") || "none"}; removed ${opsSkills.removed.join(", ") || "none"}`);
}

// Packages, installed again only when the lockfile changed.
const lockfileHash = createHash("sha256").update(readFileSync(join(shipCopy, "package-lock.json"))).digest("hex");
const installedHashFile = join(shipCopy, "node_modules", ".zaisma-ship-lockfile-hash");
if (!existsSync(installedHashFile) || readFileSync(installedHashFile, "utf8") !== lockfileHash) {
  say("Installing packages…");
  const install = await runOnline("installing packages", "npm", ["ci", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: shipCopy });
  if (install.exitCode !== 0) {
    say(install.output.trim());
    finish("FAIL", `${shortSha}: npm ci failed in the ship copy; nothing deployed.`, 1);
  }
  writeFileSync(installedHashFile, lockfileHash);
}
const wranglerBin = join(shipCopy, "node_modules", ".bin", "wrangler");
const siteFolder = join(shipCopy, "apps", "site");
const runWrangler = (argumentList) => run(wranglerBin, argumentList, { cwd: siteFolder, env: { ...process.env, FORCE_COLOR: "0" } });

async function listPendingMigrations() {
  const result = await runOnline("reading the live database's migrations", wranglerBin, ["d1", "migrations", "list", "zaisma", "--remote"], { cwd: siteFolder, env: { ...process.env, FORCE_COLOR: "0" } });
  if (result.exitCode !== 0) {
    say(result.output.trim());
    finish("FAIL", `${shortSha}: couldn't read the live database's migrations (above); nothing deployed.`, 1);
  }
  if (/No migrations to apply/.test(result.output)) return [];
  const migrationFiles = [...new Set(result.output.match(/\b\d{4}_[\w.-]+\.sql\b/g) ?? [])];
  if (!migrationFiles.length) {
    say(result.output.trim());
    finish("FAIL", `${shortSha}: couldn't tell which migrations are pending (wrangler's answer is above); nothing deployed.`, 1);
  }
  return migrationFiles;
}

// Statements that throw data away. A migration with one waits for Julius; anything else (new
// tables, columns, indexes, renames, backfills) applies by itself (Julius, Oct 16, 2026).
const DELETING_STATEMENT = /\b(drop\s+table|drop\s+column|delete\s+from|truncate)\b/i;

/** Each pending migration's statements that delete data, as "file: statement" lines. */
function deletingStatements(migrationFiles) {
  return migrationFiles.flatMap((file) =>
    readFileSync(join(shipCopy, "migrations", file), "utf8")
      .split("\n")
      .map((line) => line.replace(/--.*$/, "").trim())
      .filter((line) => DELETING_STATEMENT.test(line))
      .map((line) => `${file}: ${line}`),
  );
}

say("Checking the live database's migrations…");
const pendingMigrations = await listPendingMigrations();
// Ones an earlier, interrupted ship of this commit applied are said in the summary too.
let appliedMigrations = isDryRun ? [] : readShipProgress(progressFile, commitSha).applied_migrations;
const pendingDeletions = deletingStatements(pendingMigrations);
if (pendingMigrations.length) {
  say(`Pending migrations: ${pendingMigrations.join(", ")}`);
  for (const line of pendingDeletions) say(`  deletes data: ${line}`);
  if (isDryRun) {
    // Reported in the summary below.
  } else if (pendingDeletions.length && !hasTerminal) {
    finish(
      "WAITING",
      `${shortSha}: ${pendingMigrations.length} migration(s) to apply first (${pendingMigrations.join(", ")}), and ${pendingDeletions.length} statement(s) in them delete data (above); nothing deployed. Run npm run ship in a terminal tab: wrangler asks before applying, then it deploys.`,
      2,
    );
  } else {
    // A migration that deletes data: wrangler asks "continue? (Y/n)" in the terminal. Otherwise
    // CI=1 makes it answer yes itself, run again when the network went away under it: the live database
    // lists the ones that applied, so it applies the rest. Either way it prints each migration's ✅.
    if (pendingDeletions.length) {
      spawnSync(wranglerBin, ["d1", "migrations", "apply", "zaisma", "--remote"], { cwd: siteFolder, stdio: "inherit" });
    } else {
      const applied = await runOnline("applying migrations", wranglerBin, ["d1", "migrations", "apply", "zaisma", "--remote"], { cwd: siteFolder, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "1" } });
      say(applied.output.trim());
    }
    const stillPendingMigrations = await listPendingMigrations();
    if (stillPendingMigrations.length) finish("FAIL", `${shortSha}: still pending: ${stillPendingMigrations.join(", ")}; nothing deployed.`, 1);
    const progress = readShipProgress(progressFile, commitSha);
    appliedMigrations = [...new Set([...progress.applied_migrations, ...pendingMigrations])];
    writeShipProgress(progressFile, { ...progress, applied_migrations: appliedMigrations });
    say("Migrations applied.");
  }
} else {
  say("No pending migrations.");
}

// Queues the Workers use that the account doesn't have yet, made before anything deploys: like a migration
// that only adds, a new queue holds nothing, so it's made by itself.
const queueNames = [...new Set(WORKERS.flatMap((worker) => [...readFileSync(join(shipCopy, "apps", worker, "wrangler.jsonc"), "utf8").matchAll(/"queue":\s*"([\w-]+)"/g)].map((match) => match[1])))];
const runWranglerOnline = (label, argumentList) => runOnline(label, wranglerBin, argumentList, { cwd: siteFolder, env: { ...process.env, FORCE_COLOR: "0" } });
const listedQueues = queueNames.length ? await runWranglerOnline("listing the queues", ["queues", "list"]) : { exitCode: 0, output: "" };
if (listedQueues.exitCode !== 0) {
  say(listedQueues.output.trim());
  finish("FAIL", `${shortSha}: couldn't list the account's queues (above); nothing deployed.`, 1);
}
const missingQueues = queueNames.filter((name) => !new RegExp(`\\s${name}\\s`).test(listedQueues.output));
if (missingQueues.length && !isDryRun) {
  for (const name of missingQueues) {
    const made = await runWranglerOnline(`making the queue ${name}`, ["queues", "create", name]);
    // One made just before the network went away is there already.
    if (made.exitCode !== 0 && !/already exists/i.test(made.output)) {
      say(made.output.trim());
      finish("FAIL", `${shortSha}: couldn't make the queue ${name} (above); nothing deployed.`, 1);
    }
  }
  say(`Queues made: ${missingQueues.join(", ")}.`);
}

// Secrets a Worker can't run without, checked before anything deploys: rooms signs receipts with
// RECEIPT_SIGNING_KEY, and without it every purchase read answers receipts_unavailable.
const REQUIRED_SECRETS = { "zaisma-rooms": ["PASS_SIGNING_KEY", "RECEIPT_SIGNING_KEY"] };
for (const [workerName, secretNames] of Object.entries(REQUIRED_SECRETS)) {
  const listed = await runWranglerOnline(`listing ${workerName}'s secrets`, ["secret", "list", "--name", workerName, "--format", "json"]);
  if (listed.exitCode !== 0) {
    say(listed.output.trim());
    finish("FAIL", `${shortSha}: couldn't list ${workerName}'s secrets (above); nothing deployed.`, 1);
  }
  const missingSecrets = secretNames.filter((name) => !listed.output.includes(`"${name}"`));
  if (missingSecrets.length) finish("FAIL", `${shortSha}: ${workerName} has no ${missingSecrets.join(" or ")}: put it with \`node scripts/rooms-key.mjs | npx wrangler secret put ${missingSecrets[0]} --config apps/rooms/wrangler.jsonc\`; nothing deployed.`, 1);
}

// The command-line tool and the game server package on npm.
const cliVersion = JSON.parse(readFileSync(join(shipCopy, "packages/cli/package.json"), "utf8")).version;
const gameServerVersion = JSON.parse(readFileSync(join(shipCopy, "packages/game-server/package.json"), "utf8")).version;

const photoDnaSdkProblem = placePhotoDnaSdk(shipCopy);
if (photoDnaSdkProblem) finish("FAIL", `${shortSha}: PhotoDNA's SDK: ${photoDnaSdkProblem}; nothing deployed.`, 1);

const dockerProblem = isDryRun ? null : ensureDocker();
if (dockerProblem) finish("FAIL", `${shortSha}: ${dockerProblem}; nothing deployed.`, 1);

if (isDryRun) {
  const migrationsNote = pendingMigrations.length
    ? `${pendingMigrations.length} migration(s) to apply first (${pendingMigrations.join(", ")}), ${pendingDeletions.length ? `${pendingDeletions.length} statement(s) deleting data, so Julius answers in a terminal` : "applied by themselves"}`
    : "no migrations";
  const npmNote = (await Promise.all([checkPackageOnNpm("@zaisma/cli", cliVersion, PUBLISH_CLI_WORKFLOW_URL, { waitSec: 0 }), checkPackageOnNpm("@zaisma/game-server", gameServerVersion, PUBLISH_GAME_SERVER_WORKFLOW_URL, { waitSec: 0 })])).map((result) => result.note).join("; ");
  // Once against the live site, reported and never failing, so a change to the checks can be tried first.
  const nowResults = [...checkBuckets(runWrangler), ...(await checkSecurityAddresses({ zaismaKey: process.env.ZAISMA_KEY, attemptCount: 1 }))];
  const nowFailed = nowResults.filter((result) => !result.isPass);
  const securityNote = nowFailed.length ? `security now: ${nowFailed.length} of ${nowResults.length} failing (${nowFailed.map((result) => result.note).join("; ")})` : `security now: all ${nowResults.length} hold`;
  const queuesNote = missingQueues.length ? `would make the queue(s) ${missingQueues.join(", ")}` : "every queue there";
  finish("DRY", `${shortSha}: would deploy ${WORKERS.join(", ")}; ${githubCheckNote}; ${migrationsNote}; ${queuesNote}; ${npmNote}; ${securityNote}.`, 0);
}

// Deploys. Each Worker version is tagged with the commit, so the dashboard shows what's live. One this commit's
// ship deployed before it was interrupted, still live, is kept (scripts/ship-resume.mjs).
mkdirSync(logFolder, { recursive: true });
const workerEnvironment = { ...process.env, FORCE_COLOR: "0" };
await deployWorkers({
  workers: WORKERS,
  commitSha,
  progressPath: progressFile,
  say,
  readLiveVersionId: async (worker) => {
    const status = await runOnline(`reading ${worker}'s live version`, wranglerBin, ["deployments", "status", "--json"], { cwd: join(shipCopy, "apps", worker), env: workerEnvironment });
    return status.exitCode === 0 ? liveVersionIdOf(status.output) : null;
  },
  deployWorker: async (worker) => {
    process.stdout.write(`Deploying ${worker}… `);
    const started = Date.now();
    const deployMessage = `${shortSha} ${commitSubject}`.slice(0, 100);
    // Docker can stop while the Mac sleeps: photodna's container needs it started again before another try.
    const beforeRetry = () => (worker === "photodna" ? ensureDocker() : null);
    const result = await runOnline(`deploying ${worker}`, wranglerBin, ["deploy", "--tag", shortSha, "--message", deployMessage], { cwd: join(shipCopy, "apps", worker), env: workerEnvironment }, { beforeRetry });
    writeFileSync(join(logFolder, `${worker}.log`), result.output);
    if (result.exitCode !== 0) {
      say("failed");
      say(result.output.trim().split("\n").slice(-30).join("\n"));
      const liveNote = WORKERS.indexOf(worker) ? `${WORKERS.slice(0, WORKERS.indexOf(worker)).join(" and ")} deployed, ` : "";
      finish("FAIL", `${shortSha}: ${liveNote}${worker} failed (above; full log in ${join(logFolder, `${worker}.log`)}).`, 1);
    }
    const versionId = result.output.match(/Current Version ID: ([\w-]+)/)?.[1] ?? null;
    say(`done in ${Math.round((Date.now() - started) / 1000)}s${versionId ? ` (version ${versionId.slice(0, 8)})` : ""}`);
    return versionId;
  },
});
writeFileSync(lastShipFile, JSON.stringify({ commit_sha: commitSha, shipped_at: new Date().toISOString() }));

// The live site, the way a player and an AI reach it, with a few tries while the new versions spread. Checks that
// failed because the network went away run again once it's back.
say("Checking the live site…");
const zaismaKey = process.env.ZAISMA_KEY;
const mcpInitialize = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "zaisma-ship", version: "1" } } });
const ok = (isGood) => (response, body) => (isGood(response, body) ? [] : ["unexpected answer"]);
async function checkLiveSite() {
  // The wrangler calls are synchronous, so they run before any fetch starts and no timeout fires while they block.
  const bucketResults = checkBuckets(runWrangler);
  const [gamePage, mcp, gameFiles, rooms, receiptKeys, securityTxt, cliResult, gameServerResult, securityResults] = await Promise.all([
    checkUrl("game page", `${SITE_URL}/g/${CHECK_GAME_SLUG}`, {}, ok((response, body) => response.status === 200 && body.includes("<iframe"))),
    // With a key: a real MCP session starts. Without one: the MCP answers with its structured no_key error.
    zaismaKey
      ? checkUrl("MCP", `${SITE_URL}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${zaismaKey}` }, body: mcpInitialize }, ok((response, body) => response.status === 200 && body.includes('"serverInfo"')))
      : checkUrl("MCP", `${SITE_URL}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: mcpInitialize }, ok((response, body) => response.status === 401 && body.includes('"no_key"')), { passNote: " (its no_key answer, as expected without ZAISMA_KEY)" }),
    // The game's page opens at its version's own address: followed there.
    checkUrl("game files", CHECK_GAME_URL, {}, ok((response) => response.status === 200), { isSameOriginRedirectFollowed: true }),
    checkUrl("rooms", `${ROOMS_URL}/.well-known/jwks.json`, {}, ok((response, body) => response.status === 200 && publishedKeyCount(body) >= 1)),
    // It answers 503 when RECEIPT_SIGNING_KEY isn't set or a receipt setting doesn't load: then receipts answer receipts_unavailable.
    checkUrl("receipt keys", `${ROOMS_URL}/.well-known/receipt-jwks.json`, {}, ok((response, body) => response.status === 200 && publishedKeyCount(body) >= 1)),
    checkUrl("security.txt", `${SITE_URL}/.well-known/security.txt`, {}, securityTxtProblems),
    checkPackageOnNpm("@zaisma/cli", cliVersion, PUBLISH_CLI_WORKFLOW_URL, { readPublishRunStatus: () => readPublishRunStatus(PUBLISH_CLI_WORKFLOW_URL) }),
    checkPackageOnNpm("@zaisma/game-server", gameServerVersion, PUBLISH_GAME_SERVER_WORKFLOW_URL, { readPublishRunStatus: () => readPublishRunStatus(PUBLISH_GAME_SERVER_WORKFLOW_URL) }),
    checkSecurityAddresses({ zaismaKey }),
  ]);
  const checks = [gamePage, mcp, gameFiles, rooms, receiptKeys, securityTxt];
  const securityChecks = [...bucketResults, ...securityResults];
  return { checks, cliResult, gameServerResult, securityChecks };
}
// The status of a publish workflow's run for this commit, or null; read without blocking, since other checks may still run.
function readPublishRunStatus(workflowUrl) {
  const commandArguments = ["run", "list", "--repo", GITHUB_REPOSITORY, "--workflow", basename(workflowUrl), "--commit", commitSha, "--limit", "1", "--json", "status", "--jq", ".[0].status // empty"];
  return new Promise((resolve) => execFile("gh", commandArguments, { encoding: "utf8" }, (error, stdout) => resolve(error ? null : stdout.trim() || null)));
}
let liveSite;
const liveCheck = await runThroughInterruptions(
  "checking the live site",
  async () => {
    liveSite = await checkLiveSite();
    const failedNotes = [...liveSite.checks, liveSite.cliResult, liveSite.gameServerResult, ...liveSite.securityChecks].filter((result) => !result.isPass).map((result) => result.note);
    return { exitCode: failedNotes.length ? 1 : 0, output: failedNotes.join("\n") };
  },
  { say },
);
if (liveCheck.isInterrupted) finishInterrupted("checking the live site");
const { checks, cliResult, gameServerResult, securityChecks } = liveSite;
for (const result of [...checks, cliResult, gameServerResult, ...securityChecks]) say(`  ${result.isPass ? "✓" : "✗"} ${result.note}`);

const migrationsNote = appliedMigrations.length ? `migrations applied: ${appliedMigrations.join(", ")}` : "no migrations";
const failedSecurityChecks = securityChecks.filter((result) => !result.isPass);
const otherFailedChecks = [...checks, cliResult, gameServerResult].filter((result) => !result.isPass);
if (failedSecurityChecks.length && failedSecurityChecks.every((result) => !result.isChecked)) {
  const alsoFailed = otherFailedChecks.length ? `; the live check also failed: ${otherFailedChecks.map((result) => result.note).join("; ")}` : "";
  finish("FAIL", `${shortSha} deployed (${WORKERS.join(", ")}) but a security check couldn't get an answer, so it isn't known to hold: ${failedSecurityChecks.map((result) => result.note).join("; ")}${alsoFailed}. Ship again once it answers; no check found a door open. ${migrationsNote}; ${mainCheckoutNote}.`, 1);
}
if (failedSecurityChecks.length) {
  const alsoFailed = otherFailedChecks.length ? `; the live check also failed: ${otherFailedChecks.map((result) => result.note).join("; ")}` : "";
  finish("FAIL", `${shortSha} deployed (${WORKERS.join(", ")}) but a security check failed, and fixing it goes ahead of everything else: ${failedSecurityChecks.map((result) => result.note).join("; ")}${alsoFailed}. ${migrationsNote}; ${mainCheckoutNote}.`, 1);
}
if (otherFailedChecks.length) {
  finish("FAIL", `${shortSha} deployed (${WORKERS.join(", ")}) but the live check failed: ${otherFailedChecks.map((result) => result.note).join("; ")}. ${migrationsNote}; ${mainCheckoutNote}.`, 1);
}
finish("PASS", `${shortSha} live: ${WORKERS.join(", ")} deployed; ${checks.map((result) => result.note).join(", ")}; ${cliResult.note}; ${gameServerResult.note}; security held (${securityChecks.length} checks); ${migrationsNote}; ${mainCheckoutNote}.`, 0);
