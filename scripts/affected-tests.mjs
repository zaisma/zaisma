#!/usr/bin/env node
// Which tests and checks a change can affect, from the repository's own graph, so a change runs only what it can break.
// A test file's graph is everything it runs: its imports, all the way down; for a test in a Workers project (core, games,
// game-server, rooms, site), its Worker's whole code from the wrangler config's main, the migrations and the set-up file;
// and every file or folder of this repository that a test or script names in a string, like join(ROOT, "docs/NAMING.md")
// or a folder it reads ("migrations"). The Layout check and the Engine exports have graphs too: the preview's Workers, its
// test data and their own scripts. A change reaches a test when it changes, adds or deletes a file in that test's graph,
// and a change to what every test runs on (EVERYTHING_PATHS) reaches them all.
//
//   npm run test:affected                    runs the tests this checkout's change can affect: everything changed since it
//                                            left origin/main, committed or not, new files included
//   npm run test:affected -- --list          only says which tests, and the changed file that reaches each
//   npm run test:affected -- --json          the same, as JSON
//   npm run test:affected -- --base <ref>    changes since that commit instead of since origin/main
//   npm run test:affected -- --all           when the change reaches every test, runs them all here too (otherwise it runs the
//                                            tests the change reaches by name, and leaves the rest to GitHub's check)
//
// GitHub's check (.github/workflows/check.yml, "What changed") runs it with --github to skip the Engine exports when a pull
// request changes nothing they play. Plain Node with no packages, so it runs before npm ci.
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A change to one of these reaches every test: what every test runs on (the packages, the test runner's set-up), and this graph. */
export const EVERYTHING_PATHS = ["package.json", "package-lock.json", "vitest.config.ts", "tsconfig.json", "scripts/affected-tests.mjs"];
// What vitest.config.ts runs besides itself: the passes it signs with. (test/shards.ts only deals files to GitHub's shards.)
const CONFIG_ENTRIES = ["packages/game-server/src/pass.ts"];
// What a Workers project's every test runs before its own code (vitest.config.ts's worker()): the set-up and the migrations it applies.
const WORKER_TEST_ENTRIES = ["test/apply-migrations.ts", "migrations/"];
// The site project's tests also run the rooms Worker's database code, bundled in vitest.config.ts.
const SITE_TEST_ENTRIES = ["test/site/rooms-database-worker.ts"];
// The node and layout projects' stand-ins for the Workers modules (vitest.config.ts's resolve.alias).
const NODE_TEST_ENTRIES = ["test/node/cloudflare-email.ts", "test/node/cloudflare-workers.ts"];
// The preview's Workers (scripts/preview/run.mjs runs them all in one wrangler dev), and everything its start and test data use.
const PREVIEW_WORKERS = ["site", "games", "rooms", "compress"];
const PREVIEW_ENTRIES = ["scripts/preview/", "migrations/", "package.json", "package-lock.json", ".github/workflows/check.yml"];
/** Each check GitHub's check runs on the preview, with what it runs besides the preview. */
export const PREVIEW_CHECKS = {
  layout_check: ["scripts/layout-check.mjs", "test/layout/"],
  engine_exports: ["scripts/engines/", "test/engines/"],
};

const CODE_FILE = /\.(ts|mts|js|mjs|cjs)$/;
// What in a Workers test runs its Worker's whole code (cloudflare:test's SELF and exports, or its Durable Objects).
const RUNS_WHOLE_WORKER = /\b(SELF|exports|runInDurableObject|runDurableObjectAlarm|listDurableObjectIds)\b/;
// Code that runs on Node and can name repository files: tests, scripts, the upload command. Workers can't read files.
const NAMES_FILES = /^(test|scripts|packages\/cli)\//;
const IMPORT_SPECIFIERS = [/\bfrom\s*["']([^"'\n]+)["']/g, /\bimport\s*["']([^"'\n]+)["']/g, /\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g, /\brequire\s*\(\s*["']([^"'\n]+)["']\s*\)/g];
const QUOTED = /["'`]([^"'`\s]{2,200})["'`]/g;

/**
 * The repository's graph: for each test file and each preview check, the files it depends on (paths from the root) and the
 * folders it reads whole (ending in "/"). Built once from the files as they are now.
 */
export function buildGraph({ root = ROOT } = {}) {
  const topLevel = new Set(readdirSync(root));
  const parsed = new Map();
  const isFolder = (path) => {
    try {
      return statSync(join(root, path)).isDirectory();
    } catch {
      return false;
    }
  };
  const isFile = (path) => {
    try {
      return statSync(join(root, path)).isFile();
    } catch {
      return false;
    }
  };
  const fromRoot = (absolutePath) => relative(root, absolutePath).split(sep).join("/");
  const isInside = (path) => path !== "" && !path.startsWith("..") && !path.startsWith("/");

  /** A module specifier from a file, as a path from the root: a file there, the path it would have (so deleting it still counts), or null outside the repository. */
  const resolveImport = (fromPath, specifier) => {
    const bare = specifier.replace(/[?#].*$/, "");
    let base;
    if (bare.startsWith("./") || bare.startsWith("../")) base = fromRoot(resolve(root, dirname(fromPath), bare));
    else if (bare.startsWith("@zaisma/")) base = workspacePath(bare);
    else return null;
    if (!base || !isInside(base)) return null;
    const candidates = [base, `${base}.ts`, `${base}.mts`, `${base}.js`, `${base}.mjs`, base.replace(/\.js$/, ".ts"), base.replace(/\.mjs$/, ".mts"), `${base}/index.ts`, `${base}/index.js`, `${base}/index.mjs`];
    return candidates.find(isFile) ?? base;
  };
  /** @zaisma/<package>[/<path>] by the package's own exports. */
  const workspacePath = (specifier) => {
    const [, name, subpath] = /^@zaisma\/([^/]+)(?:\/(.+))?$/.exec(specifier) ?? [];
    if (!name) return null;
    const packageFolder = `packages/${name}`;
    let manifest = {};
    try {
      manifest = JSON.parse(readFileSync(join(root, packageFolder, "package.json"), "utf8"));
    } catch {}
    const exported = manifest.exports?.[subpath ? `./${subpath}` : "."];
    const target = typeof exported === "string" ? exported : (exported?.default ?? exported?.import ?? null);
    return join(packageFolder, target ?? subpath ?? manifest.main ?? "index.js").split(sep).join("/");
  };
  /** A string a Node file has that names a file or folder of this repository, as a path from the root, or null. */
  const namedPath = (fromPath, text) => {
    const cleaned = text.replace(/\$\{[^}]*\}/g, "").replace(/^\/+/, "").replace(/\/+$/, "");
    if (!cleaned || cleaned.includes("://") || /[*?<>|]/.test(cleaned)) return null;
    if (text.startsWith("./") || text.startsWith("../")) {
      const path = fromRoot(resolve(root, dirname(fromPath), text));
      return isInside(path) && (isFile(path) || isFolder(path)) ? path : null;
    }
    // Only a path from the root: a single word names something only when it's at the top (like "migrations").
    if (!cleaned.includes("/") && !topLevel.has(cleaned)) return null;
    if (/^(node_modules|\.git|\.wrangler)(\/|$)/.test(cleaned)) return null;
    return isFile(cleaned) || isFolder(cleaned) ? cleaned : null;
  };
  /**
   * What one file depends on directly: { files, folders, named }. Files it imports are followed further; a folder it names is
   * read (a change anywhere in it counts) but not followed; code it names may be run or bundled (a script it spawns, a Worker it
   * builds), so it's followed.
   */
  const directOf = (path) => {
    if (parsed.has(path)) return parsed.get(path);
    const found = { files: new Set(), folders: new Set(), named: new Set() };
    parsed.set(path, found);
    if (!CODE_FILE.test(path) || !isFile(path)) return found;
    const source = readFileSync(join(root, path), "utf8");
    for (const pattern of IMPORT_SPECIFIERS) for (const [, specifier] of source.matchAll(pattern)) {
      const target = resolveImport(path, specifier);
      if (target) found.files.add(target);
    }
    if (NAMES_FILES.test(path)) {
      for (const match of source.matchAll(QUOTED)) {
        const text = match[1];
        // A single word ("apps", "docs") names a folder only as a path part, join(ROOT, "apps", app), or a call's own argument,
        // readD1Migrations("migrations"): elsewhere it's a word.
        const lineBefore = source.slice(source.lastIndexOf("\n", match.index) + 1, match.index);
        if (!text.includes("/") && !(/\b(join|resolve)\(/.test(lineBefore) && /,\s*$/.test(lineBefore)) && !/\w\(\s*$/.test(lineBefore)) continue;
        const target = namedPath(path, text);
        if (!target || target === path) continue;
        if (isFolder(target)) found.folders.add(`${target}/`);
        else if (CODE_FILE.test(target)) found.files.add(target);
        else found.named.add(target);
      }
    }
    return found;
  };
  /** Everything reachable from these entries. An entry "x/" is a folder whose code runs: its files are followed too. */
  const closure = (entries) => {
    const files = new Set();
    const folders = new Set();
    const queue = [];
    for (const entry of entries) {
      if (!entry.endsWith("/")) queue.push(entry);
      else {
        folders.add(entry);
        for (const path of filesUnder(root, entry)) if (CODE_FILE.test(path) && !path.includes("/build/")) queue.push(path);
      }
    }
    const followed = new Set();
    while (queue.length) {
      const path = queue.pop();
      if (followed.has(path)) continue;
      followed.add(path);
      files.add(path);
      const direct = directOf(path);
      for (const folder of direct.folders) folders.add(folder);
      for (const named of direct.named) files.add(named);
      for (const file of direct.files) if (!followed.has(file)) queue.push(file);
    }
    return { files, folders };
  };

  const workers = workerProjects(root);
  const workerEntries = (workerName) => {
    const config = `apps/${workerName}/wrangler.jsonc`;
    const text = readFileSync(join(root, config), "utf8");
    const main = /"main"\s*:\s*"([^"]+)"/.exec(text)?.[1];
    const assets = /"assets"\s*:\s*\{[^}]*"directory"\s*:\s*"([^"]+)"/.exec(text)?.[1];
    return [config, ...(main ? [fromRoot(resolve(root, "apps", workerName, main))] : []), ...(assets ? [`${fromRoot(resolve(root, "apps", workerName, assets))}/`] : [])];
  };
  const testFiles = filesUnder(root, "test/").filter((path) => path.endsWith(".test.ts")).sort();
  const targets = new Map();
  for (const testFile of testFiles) {
    const project = testFile.split("/")[1];
    const worker = workers.get(project);
    if (!worker) {
      targets.set(testFile, closure([testFile, ...NODE_TEST_ENTRIES]));
      continue;
    }
    // The Worker's own code runs when a test calls it (SELF, exports) or one of its Durable Objects (the rooms Worker's are
    // its main reason to be); a test that only imports what it tests runs only that.
    const isWholeWorkerRun = worker === "rooms" || [...closure([testFile]).files].some((path) => path.startsWith("test/") && CODE_FILE.test(path) && RUNS_WHOLE_WORKER.test(readFileSync(join(root, path), "utf8")));
    const [config, ...mainAndAssets] = workerEntries(worker);
    const entries = [testFile, config, ...(isWholeWorkerRun ? mainAndAssets : []), ...WORKER_TEST_ENTRIES, ...(project === "site" ? SITE_TEST_ENTRIES : [])];
    targets.set(testFile, closure(entries));
  }
  const previewEntries = [...PREVIEW_ENTRIES, ...PREVIEW_WORKERS.flatMap(workerEntries)];
  const checks = Object.fromEntries(Object.entries(PREVIEW_CHECKS).map(([check, entries]) => [check, closure([...previewEntries, ...entries])]));
  // The paths themselves, not what they name: this file names every entry above, and vitest.config.ts its projects' files.
  const configGraph = closure(CONFIG_ENTRIES);
  const everything = { files: new Set([...EVERYTHING_PATHS, ...configGraph.files]), folders: configGraph.folders };
  return { testFiles, targets, checks, everything };
}

/** Each Workers project's Worker, from vitest.config.ts's worker("<project>", "apps/<worker>/wrangler.jsonc", …) calls. */
export function workerProjects(root = ROOT) {
  const config = readFileSync(join(root, "vitest.config.ts"), "utf8");
  return new Map([...config.matchAll(/\bworker\(\s*"([\w-]+)",\s*"apps\/([\w-]+)\/wrangler\.jsonc"/g)].map(([, project, worker]) => [project, worker]));
}

/** Every file under a folder ("x/"), as paths from the root, without node_modules or anything hidden. */
function filesUnder(root, folder) {
  const found = [];
  const walk = (path) => {
    let entries;
    try {
      entries = readdirSync(join(root, path), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const child = `${path}${entry.name}`;
      if (entry.isDirectory()) walk(`${child}/`);
      else if (entry.isFile()) found.push(child);
    }
  };
  walk(folder);
  return found;
}

/** Whether a graph ({ files, folders }) has this path. */
const reaches = (graph, path) => graph.files.has(path) || [...graph.folders].some((folder) => path.startsWith(folder));

/**
 * What these changed paths (from the root) reach: the tests, each with the first changed path that reaches it; whether they reach
 * every test (and which paths do); and the preview checks they reach.
 */
export function affectedChecks({ changedPaths, graph = buildGraph() }) {
  const everythingPaths = changedPaths.filter((path) => reaches(graph.everything, path));
  const testFiles = [];
  for (const testFile of graph.testFiles) {
    const reachedBy = changedPaths.find((path) => reaches(graph.targets.get(testFile), path));
    if (reachedBy) testFiles.push({ path: testFile, reached_by: reachedBy });
  }
  const checks = Object.fromEntries(Object.entries(graph.checks).map(([check, checkGraph]) => [check, changedPaths.find((path) => reaches(checkGraph, path)) ?? null]));
  return {
    changed_path_count: changedPaths.length,
    is_every_test_reached: everythingPaths.length > 0,
    every_test_reached_by: everythingPaths,
    test_files: testFiles,
    test_file_count: graph.testFiles.length,
    is_layout_check_reached: checks.layout_check !== null,
    layout_check_reached_by: checks.layout_check,
    is_engine_exports_reached: checks.engine_exports !== null,
    engine_exports_reached_by: checks.engine_exports,
  };
}

/** The paths changed since base (committed or not, renames as both names) and the files git doesn't track yet. */
export function changedPathsSince(base, { root = ROOT } = {}) {
  const git = (args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.trim()}`);
    return result.stdout.split("\n").filter(Boolean);
  };
  const [mergeBase] = git(["merge-base", "HEAD", base]);
  return [...new Set([...git(["diff", "--name-only", "--no-renames", mergeBase]), ...git(["ls-files", "--others", "--exclude-standard"])])].sort();
}

async function main() {
  const args = process.argv.slice(2);
  const valueOf = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const flags = ["--list", "--json", "--all", "--base", "--github"];
  const unknown = args.filter((arg, i) => !flags.includes(arg) && args[i - 1] !== "--base");
  if (unknown.length) stop(`Unknown option ${unknown.join(" ")}. The options are --list, --json, --all, --base <ref> and --github.`);
  const isJson = args.includes("--json");
  if (args.includes("--github")) return github();
  const base = valueOf("--base") ?? "origin/main";
  let changedPaths;
  try {
    changedPaths = changedPathsSince(base);
  } catch (error) {
    stop(`${error.message}\nIs ${base} a commit here? git fetch origin brings origin/main up to date.`);
  }
  const affected = affectedChecks({ changedPaths });
  if (isJson) return console.log(JSON.stringify({ base, ...affected }, null, 2));
  if (!changedPaths.length) return console.log(`Nothing changed since this checkout left ${base}: no tests to run.`);
  const runsAll = affected.is_every_test_reached && args.includes("--all");
  const testFiles = runsAll ? null : affected.test_files.map((test) => test.path);
  console.log(`${changedPaths.length} changed path(s) since ${base}.`);
  if (affected.is_every_test_reached) console.log(`${affected.every_test_reached_by.join(", ")} changed, which every test runs on: GitHub's check runs all ${affected.test_file_count}.${runsAll ? " Running them all here too (--all)." : " Here, the tests the change reaches by name (--all runs every one)."}`);
  if (!runsAll) for (const test of affected.test_files) console.log(`  ${test.path}  (${test.reached_by})`);
  if (affected.is_layout_check_reached) console.log(`It reaches the Layout check (${affected.layout_check_reached_by}): npm run layout:check, on the preview.`);
  if (affected.is_engine_exports_reached) console.log(`It reaches the Engine exports (${affected.engine_exports_reached_by}): GitHub's check plays them.`);
  if (args.includes("--list")) return;
  if (testFiles && !testFiles.length) return console.log("No test file reaches anything this change touched.");
  console.log(`\nnpx vitest run ${runsAll ? "" : `(${testFiles.length} file(s))`}`);
  const result = spawnSync("npx", ["vitest", "run", ...(testFiles ?? [])], { cwd: ROOT, stdio: "inherit" });
  process.exit(result.status ?? 1);
}

/**
 * What GitHub's check runs on a change: everything (is_full_suite) in the merge queue and on main, and on a pull request whose change
 * reaches every test; otherwise the test files it reaches (reached_test_files). And the test files it adds or changes
 * (changed_test_files), which a pull request runs ten times.
 */
export function githubTestPlan({ eventName, changedPaths, affected }) {
  const isFullSuite = eventName !== "pull_request" || affected.is_every_test_reached;
  const testFiles = new Set(affected.test_files.map((test) => test.path));
  return {
    is_full_suite: isFullSuite,
    reached_test_files: isFullSuite ? [] : [...testFiles],
    changed_test_files: eventName === "pull_request" ? changedPaths.filter((path) => path.startsWith("test/") && path.endsWith(".test.ts") && testFiles.has(path)) : [],
  };
}

/**
 * For GitHub's "What changed": the paths a pull request changed since it left main (BASE_SHA...HEAD_SHA) or a push changed
 * (BASE_SHA..HEAD_SHA, by RANGE_DOTS), and what they reach, as the step's outputs is_engines_changed, is_full_suite,
 * reached_test_files and changed_test_files (githubTestPlan; the lists space-separated). A push to main (EVENT_NAME) runs everything.
 */
function github() {
  const { BASE_SHA, HEAD_SHA, RANGE_DOTS = "...", EVENT_NAME, GITHUB_OUTPUT } = process.env;
  const result = spawnSync("git", ["diff", "--name-only", "--no-renames", `${BASE_SHA}${RANGE_DOTS}${HEAD_SHA}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) stop(`git diff ${BASE_SHA}${RANGE_DOTS}${HEAD_SHA}: ${result.stderr.trim()}`);
  const changedPaths = result.stdout.split("\n").filter(Boolean);
  const affected = affectedChecks({ changedPaths });
  console.log(JSON.stringify(affected, null, 2));
  const plan = githubTestPlan({ eventName: EVENT_NAME, changedPaths, affected });
  console.log(plan.is_full_suite ? "The tests: every one." : `The tests: the ${plan.reached_test_files.length} file(s) this change reaches.`);
  if (plan.changed_test_files.length) console.log(`Ten runs of the test files it adds or changes: ${plan.changed_test_files.join(" ")}.`);
  const isEnginesChanged = EVENT_NAME !== "pull_request" || affected.is_engine_exports_reached;
  console.log(isEnginesChanged ? `The Engine exports run${EVENT_NAME === "pull_request" ? ` (${affected.engine_exports_reached_by} changed)` : " on every push to main"}.` : "Nothing the Engine exports run changed: skipping them.");
  if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, `is_engines_changed=${isEnginesChanged}\nis_full_suite=${plan.is_full_suite}\nreached_test_files=${plan.reached_test_files.join(" ")}\nchanged_test_files=${plan.changed_test_files.join(" ")}\n`);
}

function stop(message) {
  console.error(message);
  process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
