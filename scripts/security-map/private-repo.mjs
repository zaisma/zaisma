#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { checkMapDirExport, exportMapDir } from "./export-public.mjs";
import { allDoors, defaultMapDir, generateMap, readMap, staleMissingEvidence, writeMap } from "./generate.mjs";
import { caseRefOf, withVerdict } from "./schema.mjs";

/**
 * Every git step on the private security repo (zaisma/security), from any checkout of zaisma/zaisma. A
 * worktree session refuses git aimed outside its own worktree (git -C, or a cd into another repo), but
 * not a node script that runs git itself, so the coordinator and the security skills go through this:
 *
 *   node scripts/security-map/private-repo.mjs read [--json]     pull (clone when missing), then the queue, the map page lines and whether the page is behind
 *   node scripts/security-map/private-repo.mjs pull              pull (clone when missing)
 *   node scripts/security-map/private-repo.mjs mark-fixed <finding_id> --test <path> [--note <text>]
 *        the finding fixed: its map cases fixed with that test as evidence, verify, export, the finding's
 *        status line, its queue lines gone, then commit and push
 *   node scripts/security-map/private-repo.mjs remove-queue-line <text>    queue.md lines holding <text> gone, then commit and push
 *   node scripts/security-map/private-repo.mjs page-shown        the README's "Map page shows:" line set to the export's generated_at, then commit and push
 *   node scripts/security-map/private-repo.mjs commit --message <text>     commit and push what's changed in the clone (after cli.mjs or a verdict)
 *
 * Options: --map-dir <path> (default ZAISMA_SECURITY_DIR, then ~/zaisma-private/security), --dry (say
 * what a change would do, change nothing), --date <YYYY-MM-DD> (mark-fixed, default today in UTC).
 * Each change starts from a pulled, clean clone and pushes to main; nothing here touches the public repo.
 */

const REPO_ROOT = join(import.meta.dirname, "../..");
const COMMANDS = ["read", "pull", "mark-fixed", "remove-queue-line", "page-shown", "commit"];
const SECURITY_REPO = "zaisma/security";
/** The public code the map's doors and test evidence are drawn from; mark-fixed needs it as on origin/main. */
const MAP_SOURCE_PATHS = ["apps", "packages", "scripts", "test"];
/** Unproven repros (hole-hunt keeps them out of commits); never committed even when .gitignore is missing. */
const CANDIDATES_PATH = "findings/candidates/";
const QUEUE_ITEM = /^\s*(?:[-*]\s+)?(URGENT:|Security fix:|hardening:)/;
const FINDING_ID = /^fnd_\d{4}-\d{2}-\d{2}_[a-z0-9-]+$/;

/** queue.md's work lines (URGENT, Security fix and hardening), without its heading and intro. */
export const queueItemsOf = (queueText) => queueText.split("\n").filter((line) => QUEUE_ITEM.test(line)).map((line) => line.trim());

/** queue.md without the work lines that hold matchText; answers the new text and the lines removed. */
export function withoutQueueLines(queueText, matchText) {
  if (!matchText.trim()) throw new Error("Say which queue line to remove: text it holds, like findings/2026-10-18-slug.md or the hardening row's name.");
  const removedLines = [];
  const kept = queueText.split("\n").filter((line) => {
    const isMatch = QUEUE_ITEM.test(line) && line.includes(matchText);
    if (isMatch) removedLines.push(line.trim());
    return !isMatch;
  });
  return { text: kept.join("\n"), removed_lines: removedLines };
}

/** The README's map page lines: the page's address and the export's generated_at it last showed (null when missing). */
export function pageLinesOf(readmeText) {
  return {
    map_page_url: readmeText.match(/^Map page: (\S+)/m)?.[1] ?? null,
    map_page_shows_generated_at: readmeText.match(/^Map page shows: (\S+)/m)?.[1] ?? null,
  };
}

/** The README with its "Map page shows:" line set (added under "Map page:" when missing). */
export function withPageShows(readmeText, generatedAt) {
  if (/^Map page shows: .*$/m.test(readmeText)) return readmeText.replace(/^Map page shows: .*$/m, `Map page shows: ${generatedAt}`);
  if (!/^Map page: .*$/m.test(readmeText)) throw new Error("The README has no Map page: line, so the map page isn't published yet. Skip with the line `map page not published yet`.");
  return readmeText.replace(/^(Map page: .*)$/m, `$1\nMap page shows: ${generatedAt}`);
}

/** A finding file with its status line (Status: …, bold or in a list) set, or one added at the end. */
export function withFindingStatus(findingText, statusText) {
  const statusLine = /^(\s*(?:[-*]\s+)?(?:\*\*)?Status(?:\*\*)?:(?:\*\*)?\s*).*$/im;
  if (statusLine.test(findingText)) return findingText.replace(statusLine, `$1${statusText}`);
  return `${findingText.replace(/\n*$/, "")}\n\nStatus: ${statusText}\n`;
}

/**
 * The map with every case carrying findingId set fixed, with the test that now guards it as evidence and
 * the door's anchor hashes as they are now. Answers the new map and the case refs it changed.
 */
export function markFindingFixed(map, { findingId, evidence, now }) {
  const caseRefs = [];
  const next = map.map((sector) => ({
    ...sector,
    doors: sector.doors.map((door) => {
      const anchorHashes = Object.fromEntries(door.anchors.map((anchor) => [anchor.anchor_id, anchor.source_hash_sha256 ?? null]));
      return {
        ...door,
        cases: door.cases.map((theCase) => {
          if (theCase.finding_id !== findingId) return theCase;
          caseRefs.push(caseRefOf(door, theCase));
          return withVerdict(theCase, { status: "fixed", evidence, finding_id: findingId, verdict_at: now, verdict_anchor_hashes: anchorHashes });
        }),
      };
    }),
  }));
  return { map: next, case_refs: caseRefs };
}

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000 }).trim();
}

function runOrNull(command, args, cwd) {
  try {
    return run(command, args, cwd);
  } catch {
    return null;
  }
}

/** The clone pulled (fast-forward only) onto main, or cloned when the folder is missing. */
export function pullClone(mapDir) {
  if (!existsSync(mapDir)) {
    mkdirSync(dirname(mapDir), { recursive: true });
    run("gh", ["repo", "clone", SECURITY_REPO, mapDir], dirname(mapDir));
    return "cloned";
  }
  if (runOrNull("git", ["rev-parse", "--is-inside-work-tree"], mapDir) !== "true") throw new Error(`${mapDir} isn't a clone of ${SECURITY_REPO}. Move it aside, or point --map-dir at the clone.`);
  const branch = run("git", ["branch", "--show-current"], mapDir);
  if (branch !== "main") throw new Error(`The clone at ${mapDir} is on ${branch || "a detached HEAD"}, not main. Fix branches are hole-fix's; switch the clone back to main first.`);
  const before = run("git", ["rev-parse", "HEAD"], mapDir);
  try {
    run("git", ["pull", "--ff-only", "--quiet", "origin", "main"], mapDir);
  } catch (error) {
    throw new Error(`Couldn't fast-forward the clone at ${mapDir}: ${error.stderr?.trim() || error.message}`);
  }
  return run("git", ["rev-parse", "HEAD"], mapDir) === before ? "up to date" : "pulled";
}

/** A file in the clone, or "" when it isn't there. */
const readClonedText = (mapDir, path) => (existsSync(join(mapDir, path)) ? readFileSync(join(mapDir, path), "utf8") : "");

/** Tracked files changed in the clone ("M queue.md"); untracked files such as candidates aren't counted. */
const trackedChangesOf = (mapDir) => run("git", ["status", "--porcelain", "--untracked-files=no"], mapDir).split("\n").filter(Boolean);

function refuseDirtyClone(mapDir) {
  const changes = trackedChangesOf(mapDir);
  if (changes.length) throw new Error(`The clone at ${mapDir} has uncommitted changes (${changes.join(", ")}). Commit them first with \`node scripts/security-map/private-repo.mjs commit --message <text>\`, or find who left them.`);
}

/** Puts back the files a failed change wrote, so the clone is as pulled. */
function restoreClone(mapDir) {
  runOrNull("git", ["reset", "--hard", "--quiet", "HEAD"], mapDir);
  runOrNull("git", ["clean", "-fd", "--quiet", "--", "map", "exports"], mapDir);
}

/** Stages paths (every change when none are named), commits with message and pushes to main, rebasing once if main moved. */
export function commitAndPush(mapDir, { message, paths = [] }) {
  run("git", ["add", "-A", "--", ...(paths.length ? paths : ["."])], mapDir);
  const staged = run("git", ["diff", "--cached", "--name-only"], mapDir).split("\n").filter(Boolean);
  const candidates = staged.filter((path) => path.startsWith(CANDIDATES_PATH));
  if (candidates.length) {
    run("git", ["reset", "--quiet", "--", ...candidates], mapDir);
    throw new Error(`Refused: ${candidates.join(", ")} are unproven repros and never enter a commit. Add ${CANDIDATES_PATH} to the clone's .gitignore, then commit again.`);
  }
  if (staged.length) run("git", ["commit", "--quiet", "-m", message], mapDir);
  else if (run("git", ["rev-list", "--count", "origin/main..HEAD"], mapDir) === "0") return { committed_paths: [], pushed: false };
  try {
    run("git", ["push", "--quiet", "origin", "HEAD:main"], mapDir);
  } catch {
    try {
      run("git", ["pull", "--rebase", "--quiet", "origin", "main"], mapDir);
      run("git", ["push", "--quiet", "origin", "HEAD:main"], mapDir);
    } catch (error) {
      throw new Error(`Committed in ${mapDir} but couldn't push to ${SECURITY_REPO}'s main: ${error.stderr?.trim() || error.message}. Run \`node scripts/security-map/private-repo.mjs commit --message <text>\` again once main is reachable.`);
    }
  }
  return { committed_paths: staged, pushed: true };
}

/** What the coordinator reads at the top of every run: the queue's work lines and whether the map page is behind the export. */
export function readState(mapDir) {
  const exportText = readClonedText(mapDir, "exports/map-public.json");
  const exportGeneratedAt = exportText ? JSON.parse(exportText).generated_at ?? null : null;
  const pageLines = pageLinesOf(readClonedText(mapDir, "README.md"));
  return {
    queue_items: queueItemsOf(readClonedText(mapDir, "queue.md")),
    ...pageLines,
    export_generated_at: exportGeneratedAt,
    is_map_page_behind: Boolean(pageLines.map_page_url && exportGeneratedAt && exportGeneratedAt !== pageLines.map_page_shows_generated_at),
  };
}

/** Refuses when this checkout's code differs from origin/main, since a fixed verdict's anchors must be the live code's. */
function refuseCheckoutOffMain() {
  run("git", ["fetch", "--quiet", "origin", "main"], REPO_ROOT);
  const differing = run("git", ["diff", "--name-only", "origin/main", "--", ...MAP_SOURCE_PATHS], REPO_ROOT).split("\n").filter(Boolean);
  if (differing.length) throw new Error(`This checkout's code isn't origin/main's (${differing.slice(0, 5).join(", ")}${differing.length > 5 ? ", …" : ""}), so the fixed verdict would cite old code. Bring it up to date (git merge --ff-only origin/main here, or the app's sync with the base branch) and run again.`);
}

/** findings/<date>-<slug>.md for fnd_<date>_<slug>, else the finding file that names the id, else null. */
function findingFileOf(mapDir, findingId) {
  const [, day, slug] = findingId.match(/^fnd_(\d{4}-\d{2}-\d{2})_(.+)$/);
  if (existsSync(join(mapDir, `findings/${day}-${slug}.md`))) return `findings/${day}-${slug}.md`;
  if (!existsSync(join(mapDir, "findings"))) return null;
  const named = readdirSync(join(mapDir, "findings")).find((name) => name.endsWith(".md") && readFileSync(join(mapDir, "findings", name), "utf8").includes(findingId));
  return named ? `findings/${named}` : null;
}


async function markFixed(mapDir, { findingId, testPath, note, date, isDry }) {
  if (!FINDING_ID.test(findingId ?? "")) throw new Error("mark-fixed needs the finding's id, like fnd_2026-10-18_slug.");
  if (!testPath) throw new Error("mark-fixed needs --test <path>: the regression test in zaisma/zaisma that now guards it, like test/site/api-keys.test.ts.");
  if (!existsSync(join(REPO_ROOT, testPath))) throw new Error(`${testPath} isn't in this checkout. Give the test's path from the repo's root.`);
  const findingPath = findingFileOf(mapDir, findingId);
  const caseRefs = allDoors(readMap(mapDir)).flatMap((door) => door.cases.filter((theCase) => theCase.finding_id === findingId).map((theCase) => caseRefOf(door, theCase)));
  if (caseRefs.length === 0 && !findingPath) throw new Error(`No map case or finding file carries ${findingId}. Check the id in queue.md.`);
  const queueMatch = findingPath ?? findingId;
  const plan = { finding_id: findingId, case_refs: caseRefs, finding_path: findingPath, queue_lines: withoutQueueLines(readClonedText(mapDir, "queue.md"), queueMatch).removed_lines };
  if (isDry) return { ...plan, is_dry: true };
  refuseCheckoutOffMain();
  try {
    const now = new Date().toISOString();
    await generateMap({ repoRoot: REPO_ROOT, mapDir, now });
    const evidence = { kind: "test", ref: testPath, note: note ?? `the regression test that guards this case since ${date}` };
    const marked = markFindingFixed(readMap(mapDir), { findingId, evidence, now });
    writeMap(mapDir, staleMissingEvidence(marked.map, REPO_ROOT).map);
    exportMapDir({ mapDir, now, date });
    const problems = checkMapDirExport({ mapDir });
    if (problems.length) throw new Error(`The public export leaks: ${problems.join("; ")}.`);
    if (findingPath) writeFileSync(join(mapDir, findingPath), withFindingStatus(readFileSync(join(mapDir, findingPath), "utf8"), `fixed ${date}`));
    const queue = withoutQueueLines(readClonedText(mapDir, "queue.md"), queueMatch);
    if (queue.removed_lines.length) writeFileSync(join(mapDir, "queue.md"), queue.text);
    const pushed = commitAndPush(mapDir, { message: `Mark ${findingId} fixed`, paths: ["map", "exports", "queue.md", ...(findingPath ? [findingPath] : [])] });
    return { ...plan, case_refs: marked.case_refs, ...pushed };
  } catch (error) {
    restoreClone(mapDir);
    throw error;
  }
}

function removeQueueLine(mapDir, { matchText, isDry }) {
  const queue = withoutQueueLines(readClonedText(mapDir, "queue.md"), matchText ?? "");
  if (queue.removed_lines.length === 0) throw new Error(`No queue line holds ${JSON.stringify(matchText)}. \`read\` lists them.`);
  if (isDry) return { removed_lines: queue.removed_lines, is_dry: true };
  writeFileSync(join(mapDir, "queue.md"), queue.text);
  return { removed_lines: queue.removed_lines, ...commitAndPush(mapDir, { message: "Queue line handled", paths: ["queue.md"] }) };
}

function pageShown(mapDir, { isDry }) {
  const { export_generated_at: generatedAt } = readState(mapDir);
  if (!generatedAt) throw new Error("There's no exports/map-public.json yet: run node scripts/security-map/cli.mjs export first.");
  const readmePath = join(mapDir, "README.md");
  const next = withPageShows(readFileSync(readmePath, "utf8"), generatedAt);
  if (isDry) return { map_page_shows_generated_at: generatedAt, is_dry: true };
  writeFileSync(readmePath, next);
  return { map_page_shows_generated_at: generatedAt, ...commitAndPush(mapDir, { message: `Map page shows ${generatedAt}`, paths: ["README.md"] }) };
}

function readArguments(argv) {
  const [command, ...rest] = argv;
  const options = { mapDir: defaultMapDir(), isDry: false, isJson: false, date: new Date().toISOString().slice(0, 10), message: null, testPath: null, note: null, positional: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === "--dry") options.isDry = true;
    else if (flag === "--json") options.isJson = true;
    else if (flag === "--map-dir") options.mapDir = rest[++index];
    else if (flag === "--date") options.date = rest[++index];
    else if (flag === "--message") options.message = rest[++index];
    else if (flag === "--test") options.testPath = rest[++index];
    else if (flag === "--note") options.note = rest[++index];
    else if (flag.startsWith("--")) throw new Error(`Unknown option ${flag}. Options: --map-dir <path>, --dry, --json, --date <YYYY-MM-DD>, --message <text> (commit), --test <path> and --note <text> (mark-fixed).`);
    else options.positional.push(flag);
  }
  if (!COMMANDS.includes(command)) throw new Error(`Say one of: ${COMMANDS.join(", ")}.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) throw new Error("--date is a day like 2026-10-18.");
  if (command === "commit" && !options.message) throw new Error('commit needs --message <text>: plain, like "Nightly map update 2026-10-18".');
  return { command, options };
}

function printRead(state, pullResult) {
  console.log(`Clone: ${pullResult}`);
  console.log(`Queue: ${state.queue_items.length}${state.queue_items.length ? `\n  ${state.queue_items.join("\n  ")}` : " (empty)"}`);
  if (!state.map_page_url) console.log("Map page: not published yet");
  else console.log(`Map page: ${state.map_page_url}\nMap page shows: ${state.map_page_shows_generated_at ?? "nothing yet"}\nExport generated_at: ${state.export_generated_at ?? "no export yet"}\nMap page behind: ${state.is_map_page_behind ? "yes, republish it (security-map skill, Page)" : "no"}`);
}

async function main() {
  const { command, options } = readArguments(process.argv.slice(2));
  const { mapDir } = options;
  const pullResult = pullClone(mapDir);
  if (command === "read") {
    const state = readState(mapDir);
    if (options.isJson) console.log(JSON.stringify({ clone: pullResult, ...state }, null, 2));
    else printRead(state, pullResult);
    return;
  }
  if (command === "pull") {
    console.log(`Clone: ${pullResult}`);
    return;
  }
  let result;
  if (command === "commit") {
    if (options.isDry) result = { changes: run("git", ["status", "--porcelain"], mapDir).split("\n").filter(Boolean), message: options.message, is_dry: true };
    else result = commitAndPush(mapDir, { message: options.message });
  } else {
    refuseDirtyClone(mapDir);
    if (command === "mark-fixed") result = await markFixed(mapDir, { findingId: options.positional[0], testPath: options.testPath, note: options.note, date: options.date, isDry: options.isDry });
    else if (command === "remove-queue-line") result = removeQueueLine(mapDir, { matchText: options.positional.join(" "), isDry: options.isDry });
    else result = pageShown(mapDir, { isDry: options.isDry });
  }
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
