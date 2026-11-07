#!/usr/bin/env node
// The pages waiting for a stamp: one entry a pull request, kept in the repository's shared git folder so every checkout's preview reads
// the same ones, never in the repository. A session adds its entry once its page passed the motion sheet and the art-director reviewer;
// the Screens bench shows every waiting one at /design/screens?view=stamp (stamp-page.ts), and the stamp itself is pressed elsewhere,
// which writes the file the entry names as stamp_file_path. An entry whose stamp file is there for its head commit isn't waiting any more.
//
//   node scripts/preview/stamp-queue.mjs add --from <entry.json>   adds or replaces this pull request's entry; preview_sites, left out,
//                                                                  are this checkout's preview's addresses
//   node scripts/preview/stamp-queue.mjs remove --pr <number>
//   node scripts/preview/stamp-queue.mjs list [--json]
//
// An entry: { pull_request_number, head_sha, change_title, session_name, preview_sites, pages: [{ page_label, path, place_value,
// state_value, profile, contact_sheet_path }], concept_picture_path, findings: [{ piece, screen, state, finding, rule, outcome, answer }],
// stamp_file_path, waiting_since_at }. outcome is fixed, answered or open. Pictures are PNG or JPEG files on this Mac.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const STAMP_QUEUE_FOLDER_NAME = "zaisma-stamp-queue";
export const FINDING_OUTCOMES = ["fixed", "answered", "open"];
const ENTRY_FIELDS = ["pull_request_number", "head_sha", "change_title", "session_name", "preview_sites", "pages", "concept_picture_path", "findings", "stamp_file_path", "waiting_since_at"];
const PAGE_FIELDS = ["page_label", "path", "place_value", "state_value", "profile", "contact_sheet_path"];
const FINDING_FIELDS = ["piece", "screen", "state", "finding", "rule", "outcome", "answer"];
const PICTURE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);
const MOST_PAGES = 20;
const MOST_FINDINGS = 200;

/** Where the entries are: the repository's shared git folder, the same for every worktree. */
export function stampQueueFolder({ root = ROOT } = {}) {
  return join(resolve(root, execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: root, encoding: "utf8" }).trim()), STAMP_QUEUE_FOLDER_NAME);
}

const isPicturePath = (path) => typeof path === "string" && isAbsolute(path) && PICTURE_EXTENSIONS.has(extname(path).toLowerCase());
const unknownOf = (value, fields) => Object.keys(value).filter((name) => !fields.includes(name));

/** An entry checked and filled in: { entry } or { error: { code, message } }. Every field is closed; pictures are absolute PNG or JPEG paths. */
export function checkedEntry(value, { previewSites = [], nowText = new Date().toISOString() } = {}) {
  const refuse = (message) => ({ error: { code: "invalid_entry", message } });
  if (!value || typeof value !== "object" || Array.isArray(value)) return refuse("An entry is a JSON object.");
  const unknown = unknownOf(value, ENTRY_FIELDS);
  if (unknown.length) return refuse(`Unknown field ${unknown.join(", ")}. The fields are ${ENTRY_FIELDS.join(", ")}.`);
  if (!Number.isInteger(value.pull_request_number) || value.pull_request_number < 1) return refuse("pull_request_number is the pull request's number.");
  if (typeof value.head_sha !== "string" || !/^[0-9a-f]{40}$/.test(value.head_sha)) return refuse("head_sha is the pull request's head commit, 40 hex letters.");
  for (const name of ["change_title", "session_name"]) if (typeof value[name] !== "string" || !value[name].trim() || value[name].length > 200) return refuse(`${name} is words, up to 200 letters.`);
  const sites = value.preview_sites ?? previewSites;
  if (!Array.isArray(sites) || !sites.length || sites.some((site) => typeof site !== "string" || !/^https?:\/\/[^/]+$/.test(site))) return refuse("preview_sites lists the preview's addresses, like http://localhost:8800, with no path.");
  if (!Array.isArray(value.pages) || !value.pages.length || value.pages.length > MOST_PAGES) return refuse(`pages lists 1 to ${MOST_PAGES} pages.`);
  for (const page of value.pages) {
    const unknownPage = unknownOf(page ?? {}, PAGE_FIELDS);
    if (unknownPage.length) return refuse(`Unknown page field ${unknownPage.join(", ")}. A page's fields are ${PAGE_FIELDS.join(", ")}.`);
    if (typeof page.page_label !== "string" || !page.page_label.trim()) return refuse("Each page has its page_label.");
    if (typeof page.path !== "string" || !page.path.startsWith("/")) return refuse("Each page's path starts with /.");
    for (const name of ["place_value", "state_value", "profile"]) if (page[name] !== undefined && page[name] !== null && (typeof page[name] !== "string" || !/^[A-Za-z0-9_-]+$/.test(page[name]))) return refuse(`A page's ${name} is a bench value, letters, digits, - and _.`);
    if (!isPicturePath(page.contact_sheet_path)) return refuse("Each page's contact_sheet_path is the layout check's contact sheet for it (--pictures), an absolute PNG path.");
  }
  if (value.concept_picture_path !== null && value.concept_picture_path !== undefined && !isPicturePath(value.concept_picture_path)) return refuse("concept_picture_path is the page's concept or picked sketch, an absolute PNG or JPEG path, or null.");
  if (!Array.isArray(value.findings) || value.findings.length > MOST_FINDINGS) return refuse(`findings lists up to ${MOST_FINDINGS} of the reviewer's findings.`);
  for (const finding of value.findings) {
    const unknownFinding = unknownOf(finding ?? {}, FINDING_FIELDS);
    if (unknownFinding.length) return refuse(`Unknown finding field ${unknownFinding.join(", ")}. A finding's fields are ${FINDING_FIELDS.join(", ")}.`);
    if (typeof finding.finding !== "string" || !finding.finding.trim()) return refuse("Each finding says what it found, in finding.");
    if (!FINDING_OUTCOMES.includes(finding.outcome)) return refuse(`A finding's outcome is ${FINDING_OUTCOMES.join(", ")}.`);
  }
  if (value.stamp_file_path !== null && value.stamp_file_path !== undefined && (typeof value.stamp_file_path !== "string" || !isAbsolute(value.stamp_file_path))) return refuse("stamp_file_path is the absolute path the stamp is written to, or null.");
  return { entry: { ...value, preview_sites: sites, concept_picture_path: value.concept_picture_path ?? null, stamp_file_path: value.stamp_file_path ?? null, waiting_since_at: value.waiting_since_at ?? nowText } };
}

/** Whether an entry's stamp is in, for the head it waits on. */
export function isStamped(entry) {
  if (!entry.stamp_file_path || !existsSync(entry.stamp_file_path)) return false;
  try {
    return JSON.parse(readFileSync(entry.stamp_file_path, "utf8")).head_sha === entry.head_sha;
  } catch {
    return false;
  }
}

/** Every entry still waiting, the longest-waiting first. */
export function waitingEntries({ folder = stampQueueFolder() } = {}) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder).filter((name) => /^pr-\d+\.json$/.test(name)).flatMap((name) => {
    try {
      const { entry } = checkedEntry(JSON.parse(readFileSync(join(folder, name), "utf8")));
      return entry && !isStamped(entry) ? [entry] : [];
    } catch {
      return [];
    }
  }).sort((first, second) => first.waiting_since_at.localeCompare(second.waiting_since_at));
}

/** A waiting entry's picture, by kind: "concept", or "sheet" with the page's index. Only a file an entry names is ever read. */
export function entryPicture(entries, pullRequestNumber, pictureKind, pageIndex = 0) {
  const entry = entries.find((each) => each.pull_request_number === pullRequestNumber);
  const path = pictureKind === "concept" ? entry?.concept_picture_path : pictureKind === "sheet" ? entry?.pages[pageIndex]?.contact_sheet_path : null;
  if (!path || !existsSync(path)) return null;
  return { bytes: readFileSync(path), content_type: extname(path).toLowerCase() === ".png" ? "image/png" : "image/jpeg" };
}

/** This checkout's preview's addresses: its tailnet name over HTTPS first, when it has one, then localhost. */
export function ownPreviewSites({ root = ROOT } = {}) {
  try {
    const state = JSON.parse(readFileSync(join(root, ".wrangler/preview-run/state.json"), "utf8"));
    const port = 8800 + state.offset;
    return [...(state.phone_host ? [`https://${state.phone_host}:${port}`] : []), `http://localhost:${port}`];
  } catch {
    return [];
  }
}

function writeEntry(folder, entry) {
  mkdirSync(folder, { recursive: true });
  const path = join(folder, `pr-${entry.pull_request_number}.json`);
  writeFileSync(`${path}.next`, `${JSON.stringify(entry, null, 2)}\n`);
  renameSync(`${path}.next`, path);
  return path;
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  const valueOf = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
  const isJson = args.includes("--json");
  const say = (value, text) => console.log(isJson ? JSON.stringify(value, null, 2) : text);
  const stop = (code, message) => { say({ error: { code, message } }, `STAMP QUEUE FAIL: ${message}`); process.exit(2); };
  const folder = stampQueueFolder();
  if (command === "add") {
    if (!valueOf("--from")) stop("missing_from", "add takes --from <entry.json>.");
    let value;
    try { value = JSON.parse(readFileSync(valueOf("--from"), "utf8")); } catch (error) { stop("unreadable_entry", `${valueOf("--from")} isn't JSON: ${error.message}`); }
    const { entry, error } = checkedEntry(value, { previewSites: ownPreviewSites() });
    if (error) stop(error.code, error.message);
    const path = writeEntry(folder, entry);
    return say({ entry, entry_path: path }, `Waiting for a stamp: pull request ${entry.pull_request_number}, ${entry.pages.length} page(s). See it at ${entry.preview_sites[0]}/design/screens?view=stamp`);
  }
  if (command === "remove") {
    const number = Number(valueOf("--pr"));
    if (!Number.isInteger(number) || number < 1) stop("missing_pr", "remove takes --pr <number>.");
    rmSync(join(folder, `pr-${number}.json`), { force: true });
    return say({ removed_pull_request_number: number }, `Pull request ${number} isn't waiting for a stamp any more.`);
  }
  if (command === "list") {
    const entries = waitingEntries({ folder });
    return say({ entries }, entries.length ? entries.map((entry) => `#${entry.pull_request_number} ${entry.change_title} (${entry.session_name}): ${entry.pages.map((page) => page.page_label).join(", ")}`).join("\n") : "No page is waiting for a stamp.");
  }
  stop("unknown_command", "The commands are add --from <entry.json>, remove --pr <number> and list [--json].");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
