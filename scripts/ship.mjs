#!/usr/bin/env node
// Ship what's on GitHub's main: npm run ship, from any checkout of the repo.
//
// It never deploys the checkout it's run from. It fetches origin/main into its own clean copy
// (.claude/ship in the main checkout, a detached worktree), then from there:
//   0. stops if GitHub's check (tests and typecheck) failed on that commit, and waits for it if it's running;
//   1. lists the live database's pending migrations and applies them, in a terminal only:
//      wrangler asks first and shows the ✅. Without a terminal (Claude, a `!` command) it stops
//      before deploying anything, because there wrangler would apply them without asking;
//   2. deploys rooms, games and site, in that order;
//   3. publishes the command-line tool to npm when its version is new (also a terminal only:
//      npm asks you to sign in);
//   4. loads a game page, the MCP, a game's files and the rooms' keys on the live site.
// It also brings the main checkout's main up to date, when that is a clean fast-forward.
// The last line says how it went, for Claude to read: SHIP PASS, SHIP WAITING or SHIP FAIL.
//
//   npm run ship                              ship
//   npm run ship -- --dry                     say what it would ship; deploy and change nothing
//   npm run ship -- --dry --commit <ref>      the same for another commit, e.g. HEAD to try a change
//                                             to this script before it merges (never deploys)
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync, closeSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SITE_URL = "https://zaisma.com";
// A live, listed game whose page and files the last step loads.
const CHECK_GAME_SLUG = "arena";
const CHECK_GAME_URL = `https://${CHECK_GAME_SLUG}.zaismausercontent.com/`;
const ROOMS_URL = "https://rooms.zaisma.com";
// Deployed in this order: the site calls rooms and links to games, so they go first.
const WORKERS = ["rooms", "games", "site"];
// The job in .github/workflows/check.yml that has to pass on the commit before it ships.
const GITHUB_REPOSITORY = "zaisma/zaisma";
const GITHUB_CHECK_NAME = "Tests and typecheck";
const GITHUB_CHECK_WAIT_SEC = 600;

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
const logFolder = join(gitFolder, "zaisma-ship-logs");
const isInShipCopy = realpathSync(fileURLToPath(import.meta.url)) === (existsSync(join(shipCopy, "scripts/ship.mjs")) ? realpathSync(join(shipCopy, "scripts/ship.mjs")) : "");

if (!isInShipCopy) {
  // One ship at a time: two would deploy over each other from the same copy.
  const lockFile = join(gitFolder, "zaisma-ship.lock");
  let lockHandle;
  try {
    lockHandle = openSync(lockFile, "wx");
  } catch {
    const holderPid = Number(readFileSync(lockFile, "utf8")) || 0;
    let isHolderAlive = false;
    try {
      process.kill(holderPid, 0);
      isHolderAlive = holderPid > 0;
    } catch {}
    if (isHolderAlive) finish("FAIL", `another ship is running (process ${holderPid}); wait for its SHIP line, then run it again if needed.`, 1);
    rmSync(lockFile, { force: true });
    lockHandle = openSync(lockFile, "wx");
  }
  writeFileSync(lockHandle, String(process.pid));
  closeSync(lockHandle);
  const releaseLock = () => rmSync(lockFile, { force: true });
  process.on("exit", releaseLock);
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130));

  say("Fetching GitHub's main…");
  git(mainCheckout, ["fetch", "--quiet", "origin", "main"]);
  // A ref is read where the command runs, so HEAD is this checkout's.
  const commitSha = commitRef ? git(process.cwd(), ["rev-parse", "--verify", `${commitRef}^{commit}`]) : git(mainCheckout, ["rev-parse", "origin/main"]);
  if (existsSync(join(shipCopy, ".git"))) {
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
const shortSha = commitSha.slice(0, 7);
const commitSubject = git(shipCopy, ["log", "-1", "--format=%s"]);
say(`Shipping ${shortSha} ${commitSubject}`);
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
  say("Same commit as the last ship from this machine: shipping it again.");
}

// GitHub's check on this commit (.github/workflows/check.yml): tests and typecheck. A failed one stops
// the ship; one still running is waited for. Without gh or a check (older commits) it says so and goes on.
function readGithubCheck() {
  let result;
  try {
    result = run("gh", ["api", `repos/${GITHUB_REPOSITORY}/commits/${commitSha}/check-runs`, "--jq", `[.check_runs[] | select(.name == "${GITHUB_CHECK_NAME}")][0] // {} | {status, conclusion, html_url}`]);
  } catch (error) {
    return { problem: error.message };
  }
  if (result.exitCode !== 0) return { problem: result.output.trim().split("\n").at(-1) };
  return JSON.parse(result.output);
}
say("Reading GitHub's check…");
let githubCheck = readGithubCheck();
for (let waitedSec = 0; !isDryRun && githubCheck.status && githubCheck.status !== "completed" && waitedSec < GITHUB_CHECK_WAIT_SEC; waitedSec += 15) {
  if (waitedSec === 0) say(`Waiting for GitHub's check to finish (${githubCheck.html_url})…`);
  await new Promise((resolve) => setTimeout(resolve, 15000));
  githubCheck = readGithubCheck();
}
let githubCheckNote;
if (githubCheck.problem) githubCheckNote = `couldn't read GitHub's check (${githubCheck.problem})`;
else if (!githubCheck.status) githubCheckNote = "no GitHub check on this commit";
else if (githubCheck.status !== "completed") {
  githubCheckNote = `GitHub's check still running (${githubCheck.html_url})`;
  if (!isDryRun) finish("FAIL", `${shortSha}: GitHub's check didn't finish in ${GITHUB_CHECK_WAIT_SEC / 60} minutes (${githubCheck.html_url}); nothing deployed. Run npm run ship again once it has.`, 1);
} else if (["success", "neutral", "skipped"].includes(githubCheck.conclusion)) githubCheckNote = "GitHub's check passed";
else {
  githubCheckNote = `GitHub's check ${githubCheck.conclusion} (${githubCheck.html_url})`;
  if (!isDryRun) finish("FAIL", `${shortSha}: ${githubCheckNote}; nothing deployed. Fix main, then ship again.`, 1);
}
say(githubCheckNote);

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

// Packages, installed again only when the lockfile changed.
const lockfileHash = createHash("sha256").update(readFileSync(join(shipCopy, "package-lock.json"))).digest("hex");
const installedHashFile = join(shipCopy, "node_modules", ".zaisma-ship-lockfile-hash");
if (!existsSync(installedHashFile) || readFileSync(installedHashFile, "utf8") !== lockfileHash) {
  say("Installing packages…");
  const install = run("npm", ["ci", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: shipCopy });
  if (install.exitCode !== 0) {
    say(install.output.trim());
    finish("FAIL", `${shortSha}: npm ci failed in the ship copy; nothing deployed.`, 1);
  }
  writeFileSync(installedHashFile, lockfileHash);
}
const wranglerBin = join(shipCopy, "node_modules", ".bin", "wrangler");
const siteFolder = join(shipCopy, "apps", "site");

function listPendingMigrations() {
  const result = run(wranglerBin, ["d1", "migrations", "list", "zaisma", "--remote"], { cwd: siteFolder, env: { ...process.env, FORCE_COLOR: "0" } });
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

say("Checking the live database's migrations…");
let pendingMigrations = listPendingMigrations();
if (pendingMigrations.length) {
  say(`Pending migrations: ${pendingMigrations.join(", ")}`);
  if (isDryRun) {
    // Reported in the summary below.
  } else if (!hasTerminal) {
    finish(
      "WAITING",
      `${shortSha}: ${pendingMigrations.length} migration(s) to apply first (${pendingMigrations.join(", ")}); nothing deployed. Run npm run ship in a terminal tab: wrangler asks before applying, then it deploys.`,
      2,
    );
  } else {
    // wrangler asks "continue? (Y/n)" itself and prints each migration's ✅.
    spawnSync(wranglerBin, ["d1", "migrations", "apply", "zaisma", "--remote"], { cwd: siteFolder, stdio: "inherit" });
    pendingMigrations = listPendingMigrations();
    if (pendingMigrations.length) finish("FAIL", `${shortSha}: still pending: ${pendingMigrations.join(", ")}; nothing deployed.`, 1);
    say("Migrations applied.");
  }
} else {
  say("No pending migrations.");
}

// The command-line tool on npm.
const cliVersion = JSON.parse(readFileSync(join(shipCopy, "packages/cli/package.json"), "utf8")).version;
const npmView = run("npm", ["view", "@zaisma/cli", "version"]);
const npmVersion = npmView.exitCode === 0 ? npmView.output.trim() : null;
const isNewer = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(/[.-]/).map((part) => Number(part) || 0));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};
const isCliNew = npmVersion !== null && isNewer(cliVersion, npmVersion);

if (isDryRun) {
  const migrationsNote = pendingMigrations.length ? `${pendingMigrations.length} migration(s) to apply first (${pendingMigrations.join(", ")})` : "no migrations";
  const cliNote = npmVersion === null ? "couldn't check npm" : isCliNew ? `CLI ${cliVersion} to publish (npm has ${npmVersion})` : `CLI ${cliVersion} already on npm`;
  finish("DRY", `${shortSha}: would deploy ${WORKERS.join(", ")}; ${githubCheckNote}; ${migrationsNote}; ${cliNote}.`, 0);
}

// Deploys. Each Worker version is tagged with the commit, so the dashboard shows what's live.
mkdirSync(logFolder, { recursive: true });
for (const worker of WORKERS) {
  process.stdout.write(`Deploying ${worker}… `);
  const started = Date.now();
  const deployMessage = `${shortSha} ${commitSubject}`.slice(0, 100);
  const result = run(wranglerBin, ["deploy", "--tag", shortSha, "--message", deployMessage], { cwd: join(shipCopy, "apps", worker), env: { ...process.env, FORCE_COLOR: "0" } });
  writeFileSync(join(logFolder, `${worker}.log`), result.output);
  if (result.exitCode !== 0) {
    say("failed");
    say(result.output.trim().split("\n").slice(-30).join("\n"));
    const liveNote = WORKERS.indexOf(worker) ? `${WORKERS.slice(0, WORKERS.indexOf(worker)).join(" and ")} deployed, ` : "";
    finish("FAIL", `${shortSha}: ${liveNote}${worker} failed (above; full log in ${join(logFolder, `${worker}.log`)}).`, 1);
  }
  const versionId = result.output.match(/Current Version ID: ([\w-]+)/)?.[1];
  say(`done in ${Math.round((Date.now() - started) / 1000)}s${versionId ? ` (version ${versionId.slice(0, 8)})` : ""}`);
}
writeFileSync(lastShipFile, JSON.stringify({ commit_sha: commitSha, shipped_at: new Date().toISOString() }));

let cliNote;
if (npmVersion === null) cliNote = "couldn't check npm for the CLI";
else if (!isCliNew) cliNote = `CLI ${cliVersion} already on npm`;
else if (!hasTerminal) cliNote = `CLI ${cliVersion} NOT published (npm has ${npmVersion}): run npm run ship in a terminal tab, where npm can ask you to sign in`;
else {
  say(`Publishing CLI ${cliVersion} to npm (npm has ${npmVersion})…`);
  const publish = spawnSync("npm", ["publish", "--access", "public"], { cwd: join(shipCopy, "packages/cli"), stdio: "inherit" });
  cliNote = publish.status === 0 ? `CLI ${cliVersion} published` : `CLI ${cliVersion} publish FAILED (above)`;
}

// The live site, the way a player and an AI reach it. A few tries, while the new versions spread.
async function check(name, url, init, isGood, passNote = "") {
  let lastProblem = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 3000));
    try {
      const response = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(15000) });
      const body = await response.text();
      if (isGood(response, body)) return { name, isPass: true, note: `${name} ${response.status}${passNote}` };
      lastProblem = `${name} ${response.status} ${body.slice(0, 120).replace(/\s+/g, " ")}`;
    } catch (error) {
      lastProblem = `${name} ${error.message}`;
    }
  }
  return { name, isPass: false, note: lastProblem };
}

say("Checking the live site…");
const zaismaKey = process.env.ZAISMA_KEY;
const mcpInitialize = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "zaisma-ship", version: "1" } } });
const checks = await Promise.all([
  check("game page", `${SITE_URL}/g/${CHECK_GAME_SLUG}`, {}, (response, body) => response.status === 200 && body.includes("<iframe")),
  // With a key: a real MCP session starts. Without one: the MCP answers with its structured no_key error.
  zaismaKey
    ? check("MCP", `${SITE_URL}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${zaismaKey}` }, body: mcpInitialize }, (response, body) => response.status === 200 && body.includes('"serverInfo"'))
    : check("MCP", `${SITE_URL}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: mcpInitialize }, (response, body) => response.status === 401 && body.includes('"no_key"'), " (its no_key answer, as expected without ZAISMA_KEY)"),
  check("game files", CHECK_GAME_URL, {}, (response) => response.status === 200),
  check("rooms", `${ROOMS_URL}/.well-known/jwks.json`, {}, (response, body) => response.status === 200 && body.includes('"keys"')),
]);
for (const result of checks) say(`  ${result.isPass ? "✓" : "✗"} ${result.note}`);

const migrationsNote = pendingMigrations.length ? "migrations applied" : "no migrations";
const failedChecks = checks.filter((result) => !result.isPass);
if (failedChecks.length) {
  finish("FAIL", `${shortSha} deployed (${WORKERS.join(", ")}) but the live check failed: ${failedChecks.map((result) => result.note).join("; ")}. ${migrationsNote}; ${cliNote}; ${mainCheckoutNote}.`, 1);
}
finish("PASS", `${shortSha} live: ${WORKERS.join(", ")} deployed; ${checks.map((result) => result.note).join(", ")}; ${migrationsNote}; ${cliNote}; ${mainCheckoutNote}.`, 0);
