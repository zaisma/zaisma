#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkMapDirExport, exportMapDir } from "./export-public.mjs";
import { allDoors, defaultMapDir, generateMap, readMap, staleMissingEvidence, writeMap } from "./generate.mjs";
import { anchorHashes } from "./anchors.mjs";
import { caseIdsOf, isOpenItem, isWayWaitingForRescore, itemBackToNext, itemDoneWithTest, itemFilePathOf, itemProblems, itemQueueOf, itemsWithFindingFixed, itemWithCallsSettled, itemWithClaim, readItems } from "./items.mjs";
import { lastReviewDateOf, pageDataHashOf, pageDataOfMapDir } from "./page-data.mjs";
import { isFilledText, isObject, promiseProblems, readPromises, rescoreWay, unknownFieldProblems } from "./promises.mjs";
import { publicPromisesNextStepOf } from "./public-promises.mjs";
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
 *        status line, the item it came from done, its queue lines gone, then commit and push
 *   node scripts/security-map/private-repo.mjs remove-queue-line <text>    queue.md lines holding <text> gone, then commit and push
 *   node scripts/security-map/private-repo.mjs page-shown        the README's "Map page shows:" line set to the hash of what the page shows now, then commit and push; an uncommitted change that doesn't alter the page stays as it is, one that does is refused
 *   node scripts/security-map/private-repo.mjs commit --message <text> [--path <path>]    commit and push what's changed in the clone (after cli.mjs or a verdict), or only under each --path
 *   node scripts/security-map/private-repo.mjs items             pull, then where every item stands, as JSON
 *   node scripts/security-map/private-repo.mjs item <item_id>    pull, then one item whole, as JSON
 *   node scripts/security-map/private-repo.mjs item-claim <item_id> --launch-id <id>    a next item doing, for the session of that launch
 *   node scripts/security-map/private-repo.mjs item-back <item_id>    a doing item back to next
 *   node scripts/security-map/private-repo.mjs item-settle <item_id> --from <answers.json>    calls answered: a list of call_line and answer_line
 *   node scripts/security-map/private-repo.mjs item-done <item_id> --test <path> (--rescore <rescore.json> | --rescore-later)
 *        a doing item done, with the test on origin/main that guards it, and the way it's about rescored on
 *        origin/main's code with the fact that changed (defense_score, defense_reason, damage_score,
 *        damage_reason, changed_because, and added_anchors for code the fix added), in one commit; --rescore-later leaves the way fixed and waiting
 *        for its rescore. Run again with --rescore on a done item to rescore a way that's waiting. An item about
 *        cases has no way: it takes neither flag, and the next review settles its cases.
 *
 * Options: --map-dir <path> (default ZAISMA_SECURITY_DIR, then ~/zaisma-private/security), --dry (say
 * what a change would do, change nothing), --date <YYYY-MM-DD> (mark-fixed, default today in UTC).
 * Each change starts from a pulled, clean clone (page-shown: one whose uncommitted changes leave the page
 * as it is) and pushes to main; nothing here touches the public repo.
 */

const REPO_ROOT = join(import.meta.dirname, "../..");
const COMMANDS = ["read", "pull", "mark-fixed", "remove-queue-line", "page-shown", "commit", "items", "item", "item-claim", "item-back", "item-settle", "item-done"];
const SECURITY_REPO = "zaisma/security";
/** The public code the map's doors and test evidence are drawn from; mark-fixed needs it as on origin/main. */
const MAP_SOURCE_PATHS = ["apps", "packages", "scripts", "test"];
/** Unproven repros; never committed even when .gitignore is missing. */
const CANDIDATES_PATH = "findings/candidates/";
const QUEUE_ITEM = /^\s*(?:[-*]\s+)?(URGENT:|Security fix:)/;
const FINDING_ID = /^fnd_\d{4}-\d{2}-\d{2}_[a-z0-9-]+$/;

/** queue.md's work lines (URGENT and Security fix), without its heading and intro. */
export const queueItemsOf = (queueText) => queueText.split("\n").filter((line) => QUEUE_ITEM.test(line)).map((line) => line.trim());

/** queue.md without the work lines that hold matchText; answers the new text and the lines removed. */
export function withoutQueueLines(queueText, matchText) {
  if (!matchText.trim()) throw new Error("Say which queue line to remove: text it holds, like findings/2026-10-18-slug.md.");
  const removedLines = [];
  const kept = queueText.split("\n").filter((line) => {
    const isMatch = QUEUE_ITEM.test(line) && line.includes(matchText);
    if (isMatch) removedLines.push(line.trim());
    return !isMatch;
  });
  return { text: kept.join("\n"), removed_lines: removedLines };
}

/** The README's map page lines: the page's address and the hash of the data it last showed (null when missing). */
export function pageLinesOf(readmeText) {
  return {
    map_page_url: readmeText.match(/^Map page: (\S+)/m)?.[1] ?? null,
    map_page_shows_data_hash: readmeText.match(/^Map page shows: (\S+)/m)?.[1] ?? null,
  };
}

/** The README with its "Map page shows:" line set (added under "Map page:" when missing). */
export function withPageShows(readmeText, dataHash) {
  if (/^Map page shows: .*$/m.test(readmeText)) return readmeText.replace(/^Map page shows: .*$/m, `Map page shows: ${dataHash}`);
  if (!/^Map page: .*$/m.test(readmeText)) throw new Error("The README has no Map page: line, so the map page isn't published yet. Skip with the line `map page not published yet`.");
  return readmeText.replace(/^(Map page: .*)$/m, `$1\nMap page shows: ${dataHash}`);
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

export function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000 }).trim();
}

function runOrNull(command, args, cwd) {
  try {
    return run(command, args, cwd);
  } catch {
    return null;
  }
}

/** queue.md with these work lines put above the ones it holds, under its heading and intro. */
export function withQueueLines(queueText, lines) {
  const queueLines = queueText.split("\n");
  const firstItemIndex = queueLines.findIndex((line) => QUEUE_ITEM.test(line));
  if (firstItemIndex === -1) return `${queueText.replace(/\n*$/, "")}\n\n${lines.join("\n")}\n`;
  queueLines.splice(firstItemIndex, 0, ...lines);
  return queueLines.join("\n");
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
      run("git", ["pull", "--rebase", "--autostash", "--quiet", "origin", "main"], mapDir);
      run("git", ["push", "--quiet", "origin", "HEAD:main"], mapDir);
    } catch (error) {
      throw new Error(`Committed in ${mapDir} but couldn't push to ${SECURITY_REPO}'s main: ${error.stderr?.trim() || error.message}. Run \`node scripts/security-map/private-repo.mjs commit --message <text>\` again once main is reachable.`);
    }
  }
  return { committed_paths: staged, pushed: true };
}

/** The ways an item closed after their last score, waiting for item-done --rescore or the next review. */
function rescoreWaitingWayIdsOf(mapDir) {
  const items = readItems(mapDir);
  return readPromises(mapDir).promises.flatMap((promise) => promise.ways_to_break.filter((way) => isWayWaitingForRescore(way, promise.sector_id, items)).map((way) => way.way_id));
}

/** What the coordinator reads at the top of every run: the queue's work lines, whether the map page is behind the records, the last daily review's day and what the printed promises need. */
export function readState(mapDir) {
  const pageData = pageDataOfMapDir(mapDir);
  const pageDataHash = pageData ? pageDataHashOf(pageData) : null;
  const pageLines = pageLinesOf(readClonedText(mapDir, "README.md"));
  return {
    queue_items: queueItemsOf(readClonedText(mapDir, "queue.md")),
    ...pageLines,
    page_data_hash: pageDataHash,
    last_review_date: lastReviewDateOf(mapDir),
    open_item_count: readItems(mapDir).filter(isOpenItem).length,
    rescore_waiting_way_ids: rescoreWaitingWayIdsOf(mapDir),
    is_map_page_behind: Boolean(pageLines.map_page_url && pageDataHash && pageDataHash !== pageLines.map_page_shows_data_hash),
    public_promises_next_step: publicPromisesNextStepOf(mapDir),
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
    const fixedItems = itemsWithFindingFixed(readItems(mapDir), { findingId, testPath, date, now });
    for (const item of fixedItems) writeFileSync(join(mapDir, itemFilePathOf(item.item_id)), `${JSON.stringify(item, null, 2)}\n`);
    const pushed = commitAndPush(mapDir, { message: `Mark ${findingId} fixed`, paths: ["map", "exports", "queue.md", ...(findingPath ? [findingPath] : []), ...fixedItems.map((item) => itemFilePathOf(item.item_id))] });
    return { ...plan, case_refs: marked.case_refs, fixed_item_ids: fixedItems.map((item) => item.item_id), ...pushed };
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

/** The page's hash from the clone's last commit, as if nothing were uncommitted, or null while that commit has no promises. */
function committedPageDataHashOf(mapDir) {
  const temporaryDir = mkdtempSync(join(tmpdir(), "security-map-committed-"));
  try {
    const archivePath = join(temporaryDir, "head.tar");
    const treeDir = join(temporaryDir, "tree");
    mkdirSync(treeDir);
    run("git", ["archive", "--format=tar", "-o", archivePath, "HEAD"], mapDir);
    run("tar", ["-xf", archivePath, "-C", treeDir], mapDir);
    const pageData = pageDataOfMapDir(treeDir);
    return pageData ? pageDataHashOf(pageData) : null;
  } finally {
    rmSync(temporaryDir, { recursive: true, force: true });
  }
}

/** The README's "Map page shows:" line set to the page's hash. An uncommitted change that leaves the page as it is stays uncommitted; one that alters it is refused. */
export function pageShown(mapDir, { isDry = false } = {}) {
  const { page_data_hash: dataHash } = readState(mapDir);
  if (!dataHash) throw new Error("The private repo has no promises yet, so the page has nothing to show.");
  const changes = run("git", ["status", "--porcelain"], mapDir).split("\n").filter(Boolean).map((line) => line.trim());
  if (dataHash !== committedPageDataHashOf(mapDir)) throw new Error(`An uncommitted change in the clone at ${mapDir} alters what the page shows (one of: ${changes.join(", ")}), so the record would say the page shows what no commit holds. Commit it with \`node scripts/security-map/private-repo.mjs commit --message <text>\`, or find who left it; then build, publish and run page-shown again.`);
  const readmeChanges = run("git", ["status", "--porcelain", "--", "README.md"], mapDir);
  const stagedPaths = run("git", ["diff", "--cached", "--name-only"], mapDir).split("\n").filter(Boolean);
  if (readmeChanges || stagedPaths.length) throw new Error(`The clone at ${mapDir} has ${readmeChanges ? "an uncommitted change to README.md" : `staged files (${stagedPaths.join(", ")})`}, which this commit would carry. Commit it with \`node scripts/security-map/private-repo.mjs commit --message <text>\`, or find who left it, and run page-shown again.`);
  const readmePath = join(mapDir, "README.md");
  const next = withPageShows(readFileSync(readmePath, "utf8"), dataHash);
  if (isDry) return { map_page_shows_data_hash: dataHash, is_dry: true };
  writeFileSync(readmePath, next);
  return { map_page_shows_data_hash: dataHash, ...commitAndPush(mapDir, { message: `Map page shows ${dataHash.slice(0, 12)}`, paths: ["README.md"] }) };
}

/** One item from the clone, whole. */
function readItem(mapDir, itemId) {
  const path = itemFilePathOf(itemId ?? "");
  if (!itemId || !existsSync(join(mapDir, path))) throw new Error(`No item has id ${JSON.stringify(itemId ?? "")}. \`items\` lists them.`);
  return JSON.parse(readFileSync(join(mapDir, path), "utf8"));
}

/** One item changed, checked whole, and committed alone, so a run's other files never ride along. */
function changeItem(mapDir, { itemId, change, message, isDry }) {
  const item = readItem(mapDir, itemId);
  const next = change(item);
  const problems = itemProblems(next);
  if (problems.length) throw new Error(`The item would break its shape: ${problems.join("; ")}.`);
  const answer = { item_id: itemId, old_item_state: item.item_state, new_item_state: next.item_state };
  if (isDry) return { ...answer, is_dry: true };
  if (JSON.stringify(next) === JSON.stringify(item)) return { ...answer, is_changed: false };
  writeFileSync(join(mapDir, itemFilePathOf(itemId)), `${JSON.stringify(next, null, 2)}\n`);
  try {
    return { ...answer, is_changed: true, ...commitAndPush(mapDir, { message: `${itemId}: ${message}`, paths: [itemFilePathOf(itemId)] }) };
  } catch (error) {
    restoreClone(mapDir);
    throw error;
  }
}

export function claimItem(mapDir, { itemId, launchId, isDry = false }) {
  return changeItem(mapDir, { itemId, isDry, message: "claimed", change: (item) => itemWithClaim(item, { launchId }) });
}

export function putItemBack(mapDir, { itemId, isDry = false }) {
  return changeItem(mapDir, { itemId, isDry, message: "back to next", change: itemBackToNext });
}

export function settleItemCalls(mapDir, { itemId, answers, now, isDry = false }) {
  return changeItem(mapDir, { itemId, isDry, message: "calls settled", change: (item) => itemWithCallsSettled(item, answers, { now }) });
}

const RESCORE_FIELDS = ["defense_score", "defense_reason", "damage_score", "damage_reason", "changed_because"];
/** The code a fix added that the way now rests on, so a later change to it makes the score stale. */
const ADDED_ANCHOR_FIELDS = ["source_path", "symbol_name"];

/** Everything wrong with a closed item's rescore of its way; [] when it's whole. The scores' range is promiseProblems'. */
export function rescoreProblems(rescore) {
  if (!isObject(rescore)) return [`The rescore is an object with ${RESCORE_FIELDS.join(", ")} and, if the fix added code the way rests on, added_anchors`];
  const problems = unknownFieldProblems(rescore, [...RESCORE_FIELDS, "added_anchors"], "the rescore");
  for (const field of RESCORE_FIELDS) if (rescore[field] === undefined) problems.push(`the rescore has no ${field}`);
  for (const field of ["defense_reason", "damage_reason", "changed_because"]) if (rescore[field] !== undefined && !isFilledText(rescore[field])) problems.push(`the rescore has an empty ${field}`);
  if (rescore.added_anchors !== undefined) {
    if (!Array.isArray(rescore.added_anchors)) problems.push("the rescore needs added_anchors as a list of source_path and symbol_name");
    else rescore.added_anchors.forEach((anchor, index) => {
      if (!isObject(anchor)) return problems.push(`the rescore's added anchor ${index + 1} isn't an object`);
      problems.push(...unknownFieldProblems(anchor, ADDED_ANCHOR_FIELDS, `the rescore's added anchor ${index + 1}`));
      if (!isFilledText(anchor.source_path) || !isFilledText(anchor.symbol_name)) problems.push(`the rescore's added anchor ${index + 1} needs source_path and symbol_name`);
    });
  }
  return problems;
}

/** The way with the rescore's added anchors after its own, each new one unstamped until rescoreWay stamps it. */
function wayWithAddedAnchors(way, addedAnchors = []) {
  const known = new Set(way.anchors.map((anchor) => anchor.anchor_id));
  const added = addedAnchors.map(({ source_path, symbol_name }) => ({ anchor_id: `${source_path}:${symbol_name}`, source_path, symbol_name, source_hash_sha256: null })).filter((anchor) => !known.has(anchor.anchor_id) && known.add(anchor.anchor_id));
  return { ...way, anchors: [...way.anchors, ...added] };
}

/** Each anchor's hash in origin/main's code, so a rescore rests on what's live, not on this checkout. */
function liveAnchorHashes(repoRoot, anchors) {
  const sourceByPath = new Map(anchors.map((anchor) => [anchor.source_path, runOrNull("git", ["show", `origin/main:${anchor.source_path}`], repoRoot)]));
  return anchorHashes(repoRoot, anchors, sourceByPath);
}

/**
 * An item finished: done with its guarding test on the public origin/main, and the way it's about rescored on
 * origin/main's code through rescoreWay, the item and the way's promise in one commit. With isRescoreLater the
 * way stays as it was and the page shows it fixed, waiting for its rescore. A done item takes a rescore of a way
 * still waiting for one (an item closed by mark-fixed or a review too); one already rescored changes nothing.
 */
export function finishItem(mapDir, { itemId, testPath, rescore = null, isRescoreLater = false, date, now, repoRoot = REPO_ROOT, isDry = false }) {
  if (!testPath) throw new Error("item-done needs --test <path>: the test in zaisma/zaisma that now guards it, like test/node/guard.test.ts.");
  if (rescore) {
    const problems = rescoreProblems(rescore);
    if (problems.length) throw new Error(`The rescore would break its shape: ${problems.join("; ")}.`);
  }
  run("git", ["fetch", "--quiet", "origin", "main"], repoRoot);
  if (runOrNull("git", ["cat-file", "-e", `origin/main:${testPath}`], repoRoot) === null) throw new Error(`${testPath} isn't on origin/main yet. Close the item once its pull request is live.`);
  const commit = run("git", ["rev-parse", "origin/main"], repoRoot);
  const item = readItem(mapDir, itemId);
  const next = item.item_state === "done" ? item : itemDoneWithTest(item, { testPath, date, now, commit });
  const itemProblemList = itemProblems(next);
  if (itemProblemList.length) throw new Error(`The item would break its shape: ${itemProblemList.join("; ")}.`);
  if (next.way_id === null) {
    if (rescore || isRescoreLater) throw new Error(`${itemId} is about cases (${caseIdsOf(next).join(", ")}), not a way to break, so there's no way to rescore: run it without --rescore or --rescore-later, and the next review settles the cases.`);
    const answer = { item_id: itemId, old_item_state: item.item_state, new_item_state: next.item_state, way_id: null, case_ids: caseIdsOf(next), way_rescore: "no_way" };
    if (isDry) return { ...answer, is_dry: true };
    if (JSON.stringify(next) === JSON.stringify(item)) return { ...answer, is_changed: false };
    writeFileSync(join(mapDir, itemFilePathOf(itemId)), `${JSON.stringify(next, null, 2)}\n`);
    try {
      return { ...answer, is_changed: true, ...commitAndPush(mapDir, { message: `${itemId}: done`, paths: [itemFilePathOf(itemId)] }) };
    } catch (error) {
      restoreClone(mapDir);
      throw error;
    }
  }
  if (Boolean(rescore) === isRescoreLater) throw new Error("item-done needs one of --rescore <rescore.json> (the way rescored with the fact that changed: defense_score, defense_reason, damage_score, damage_reason, changed_because) or --rescore-later (the way left waiting for the next review's rescore).");
  const stored = readPromises(mapDir);
  const promise = stored.promises.find((candidate) => candidate.sector_id === next.sector_id);
  const wayIndex = promise?.ways_to_break.findIndex((way) => way.way_id === next.way_id) ?? -1;
  if (wayIndex === -1) throw new Error(`${itemId} is about way ${next.way_id}, and promises/${next.sector_id}.json has no way with that way_id.`);
  const way = promise.ways_to_break[wayIndex];
  const isWaiting = isWayWaitingForRescore(way, next.sector_id, [next]);
  const wayRescore = !isWaiting ? "already_rescored" : rescore ? "rescored" : "waiting";
  const writes = [];
  if (JSON.stringify(next) !== JSON.stringify(item)) writes.push({ path: itemFilePathOf(itemId), record: next });
  if (wayRescore === "rescored") {
    const changedBecause = `${rescore.changed_because.trim()} ${itemId} closed, guarded by ${testPath} at ${commit.slice(0, 12)}.`;
    const { added_anchors, ...scores } = rescore;
    const anchoredWay = wayWithAddedAnchors(way, added_anchors);
    const currentHashes = liveAnchorHashes(repoRoot, anchoredWay.anchors);
    const missing = anchoredWay.anchors.filter((anchor) => !currentHashes[anchor.anchor_id]).map((anchor) => anchor.anchor_id);
    if (missing.length) throw new Error(`The way would rest on code origin/main doesn't have: ${missing.join(", ")}. Name a function, method or const as it is on main.`);
    promise.ways_to_break[wayIndex] = rescoreWay(anchoredWay, { ...scores, changed_because: changedBecause, now, currentHashes });
    const problems = promiseProblems(stored);
    if (problems.length) throw new Error(`The promises would break their shape: ${problems.join("; ")}.`);
    writes.push({ path: `promises/${next.sector_id}.json`, record: promise });
  }
  const answer = { item_id: itemId, old_item_state: item.item_state, new_item_state: next.item_state, way_id: way.way_id, case_ids: [], way_rescore: wayRescore, ...(wayRescore === "rescored" ? { new_defense_score: rescore.defense_score, new_damage_score: rescore.damage_score } : {}) };
  if (isDry) return { ...answer, is_dry: true };
  if (!writes.length) return { ...answer, is_changed: false };
  for (const { path, record } of writes) writeFileSync(join(mapDir, path), `${JSON.stringify(record, null, 2)}\n`);
  const message = [item.item_state !== "done" ? "done" : null, wayRescore === "rescored" ? `${way.way_id} rescored` : null].filter(Boolean).join(", ");
  try {
    return { ...answer, is_changed: true, ...commitAndPush(mapDir, { message: `${itemId}: ${message}`, paths: writes.map(({ path }) => path) }) };
  } catch (error) {
    restoreClone(mapDir);
    throw error;
  }
}

function readArguments(argv) {
  const [command, ...rest] = argv;
  const options = { mapDir: defaultMapDir(), isDry: false, isJson: false, date: new Date().toISOString().slice(0, 10), message: null, testPath: null, note: null, launchId: null, fromPath: null, rescorePath: null, isRescoreLater: false, paths: [], positional: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === "--dry") options.isDry = true;
    else if (flag === "--json") options.isJson = true;
    else if (flag === "--map-dir") options.mapDir = rest[++index];
    else if (flag === "--date") options.date = rest[++index];
    else if (flag === "--message") options.message = rest[++index];
    else if (flag === "--path") options.paths.push(rest[++index]);
    else if (flag === "--test") options.testPath = rest[++index];
    else if (flag === "--note") options.note = rest[++index];
    else if (flag === "--launch-id") options.launchId = rest[++index];
    else if (flag === "--from") options.fromPath = rest[++index];
    else if (flag === "--rescore") options.rescorePath = rest[++index];
    else if (flag === "--rescore-later") options.isRescoreLater = true;
    else if (flag.startsWith("--")) throw new Error(`Unknown option ${flag}. Options: --map-dir <path>, --dry, --json, --date <YYYY-MM-DD>, --message <text> and --path <path> (commit), --test <path> (mark-fixed, item-done), --note <text> (mark-fixed), --launch-id <id> (item-claim), --from <path> (item-settle), --rescore <path> or --rescore-later (item-done).`);
    else options.positional.push(flag);
  }
  if (!COMMANDS.includes(command)) throw new Error(`Say one of: ${COMMANDS.join(", ")}.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) throw new Error("--date is a day like 2026-10-18.");
  if (command === "commit" && !options.message) throw new Error('commit needs --message <text>: plain, like "Map update 2026-10-18".');
  if (command === "item-settle" && !options.fromPath) throw new Error("item-settle needs --from <answers.json>: a list of call_line and answer_line.");
  return { command, options };
}

function printRead(state, pullResult) {
  console.log(`Clone: ${pullResult}`);
  console.log(`Queue: ${state.queue_items.length}${state.queue_items.length ? `\n  ${state.queue_items.join("\n  ")}` : " (empty)"}`);
  console.log(`Open items: ${state.open_item_count} (\`items\` says where each stands)`);
  console.log(`Ways waiting for a rescore: ${state.rescore_waiting_way_ids.length ? state.rescore_waiting_way_ids.join(", ") : "none"}`);
  console.log(`Last daily review: ${state.last_review_date ?? "none yet"}`);
  if (!state.map_page_url) console.log("Map page: not published yet");
  else console.log(`Map page: ${state.map_page_url}
Map page shows: ${state.map_page_shows_data_hash ?? "nothing yet"}
Map page behind: ${state.is_map_page_behind ? "yes" : "no"}`);
  console.log(`Public promises: ${state.public_promises_next_step ?? "nothing to do"}`);
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
  if (command === "items") {
    console.log(JSON.stringify(itemQueueOf(readItems(mapDir)), null, 2));
    return;
  }
  if (command === "item") {
    console.log(JSON.stringify(readItem(mapDir, options.positional[0]), null, 2));
    return;
  }
  let result;
  if (command === "commit") {
    if (options.isDry) result = { changes: run("git", ["status", "--porcelain"], mapDir).split("\n").filter(Boolean), message: options.message, is_dry: true };
    else result = commitAndPush(mapDir, { message: options.message, paths: options.paths });
  } else if (command === "page-shown") {
    result = pageShown(mapDir, { isDry: options.isDry });
  } else {
    refuseDirtyClone(mapDir);
    if (command === "mark-fixed") result = await markFixed(mapDir, { findingId: options.positional[0], testPath: options.testPath, note: options.note, date: options.date, isDry: options.isDry });
    else if (command === "remove-queue-line") result = removeQueueLine(mapDir, { matchText: options.positional.join(" "), isDry: options.isDry });
    else if (command === "item-claim") result = claimItem(mapDir, { itemId: options.positional[0], launchId: options.launchId, isDry: options.isDry });
    else if (command === "item-back") result = putItemBack(mapDir, { itemId: options.positional[0], isDry: options.isDry });
    else if (command === "item-settle") result = settleItemCalls(mapDir, { itemId: options.positional[0], answers: JSON.parse(readFileSync(options.fromPath, "utf8")), now: new Date().toISOString(), isDry: options.isDry });
    else if (command === "item-done") result = finishItem(mapDir, { itemId: options.positional[0], testPath: options.testPath, rescore: options.rescorePath ? JSON.parse(readFileSync(options.rescorePath, "utf8")) : null, isRescoreLater: options.isRescoreLater, date: options.date, now: new Date().toISOString(), isDry: options.isDry });
  }
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
