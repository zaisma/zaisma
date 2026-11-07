#!/usr/bin/env node
// A pull request's pictures for the art review, made on GitHub's runners (.github/workflows/pictures.yml), never on a person's machine: the
// layout check's contact sheets and the motion sheet's strips and stills, for each page asked, on the pull request's head. No session waits
// for the Mac's one heavy run, and none waits behind another's.
//
//   npm run pictures -- --pr <number> --path <a page's whole path> [--path <another>…] --out <folder> [--json]
//       dispatches Pictures on the pull request's head, waits for it (one runner a page, side by side: usually a few minutes, at most 40),
//       and downloads every page's into <folder>: sheets/ (each state's contact sheet), strips/ (each run's strip and still), and
//       pictures.json, with the head, the run, and whether each page's layout check and motion sheet passed. Their output is in
//       <folder>/runs/pictures-<n>/layout.txt and motion.txt. The last line is PICTURES PASS or PICTURES FAIL; --json prints the answer.
//       A file two pages both make is kept as <page>--<name>, so no page's picture overwrites another's.
//   Push first: the pictures are of the head on GitHub. Run it in the background; it only waits on GitHub.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const WORKFLOW_FILE = "pictures.yml";
const FIND_RUN_LIMIT_MS = 2 * 60 * 1000;
const RUN_LIMIT_MS = 50 * 60 * 1000;
const FIND_EVERY_MS = 5000;
const WATCH_EVERY_MS = 30 * 1000;
const OPTIONS_WORDS = "The options are --pr <number>, --path <a page's whole path> (once a page), --out <folder> and --json.";

/** The command's input, checked: { pullRequestNumber, pagePaths, outFolder, isJson } or { error }. */
export function readInput(args) {
  const refuse = (message) => ({ error: { code: "invalid_input", message: `${message} ${OPTIONS_WORDS}` } });
  const pagePaths = [];
  let pullRequestNumber = null, outFolder = null, isJson = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index], value = args[index + 1];
    if (arg === "--json") { isJson = true; continue; }
    if (!["--pr", "--path", "--out"].includes(arg)) return refuse(`Unknown option ${arg}.`);
    if (value === undefined || value.startsWith("--")) return refuse(`${arg} takes a value.`);
    index++;
    if (arg === "--pr") pullRequestNumber = Number(value);
    if (arg === "--path") pagePaths.push(value);
    if (arg === "--out") outFolder = value;
  }
  if (!Number.isInteger(pullRequestNumber) || pullRequestNumber < 1) return refuse("Give --pr <the pull request's number>.");
  if (!pagePaths.length) return refuse("Give --path <a page's whole path> for each page the change touches, like --path / --path /g/cave-crew.");
  const badPath = pagePaths.find((path) => !/^\/[A-Za-z0-9/_.?&=-]*$/.test(path));
  if (badPath) return refuse(`${badPath} isn't a page's path: it starts with / and holds only letters, digits and / _ . ? & = -.`);
  if (!outFolder) return refuse("Give --out <folder>, like --out <scratchpad>/art.");
  return { pullRequestNumber, pagePaths: [...new Set(pagePaths)], outFolder, isJson };
}

/** A page's path as a file name's start: / is "home", /g/cave-crew is "g-cave-crew". */
export function pathSlug(pagePath) {
  return pagePath.replace(/^\/+|\/+$/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "home";
}

/**
 * Where each page's pictures go in one folder: [{ from, name }], by kind (sheets or strips). A name two pages both make is kept as
 * <page>--<name> for each of them, so none overwrites another.
 */
export function flattenedPictures(pages) {
  const counts = new Map();
  for (const page of pages) for (const name of page.names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return pages.flatMap((page) => page.names.map((name) => ({ from: join(page.folder, name), name: counts.get(name) > 1 ? `${pathSlug(page.page_path)}--${name}` : name })));
}

/** The answer's last line. */
export function verdictLine(pages) {
  const failed = pages.filter((page) => page.layout_outcome !== "success" || page.motion_outcome !== "success");
  if (!pages.length) return "PICTURES FAIL: the run left no pictures (see its log).";
  if (!failed.length) return `PICTURES PASS: ${pages.length} page(s), layout check and motion sheet passed on each.`;
  return `PICTURES FAIL: ${failed.map((page) => `${page.page_path} (layout check ${page.layout_outcome}, motion sheet ${page.motion_outcome})`).join("; ")}. Fix it at the component, push, and run this again.`;
}

const gh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const picturesIn = (folder) => (existsSync(folder) ? readdirSync(folder).filter((name) => /\.(png|jpe?g)$/i.test(name)).sort() : []);

async function main() {
  const input = readInput(process.argv.slice(2));
  const say = (value, text) => console.log(input.isJson ? JSON.stringify(value, null, 2) : text);
  const stop = (code, message) => { say({ error: { code, message } }, `PICTURES FAIL: ${message}`); process.exit(2); };
  if (input.error) stop(input.error.code, input.error.message);
  const { pullRequestNumber, pagePaths } = input;
  const outFolder = resolve(input.outFolder);

  let pull;
  try {
    pull = JSON.parse(gh(["pr", "view", String(pullRequestNumber), "--json", "headRefOid,state"]));
  } catch (error) {
    stop("no_pull_request", `gh couldn't read pull request #${pullRequestNumber}: ${String(error.stderr || error.message).trim()}`);
  }
  if (pull.state !== "OPEN") stop("pull_request_not_open", `#${pullRequestNumber} is ${pull.state.toLowerCase()}: pictures are for an open pull request's head.`);
  const headSha = pull.headRefOid;
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    gh(["workflow", "run", WORKFLOW_FILE, "--ref", "main", "-f", `pull_request_number=${pullRequestNumber}`, "-f", `head_sha=${headSha}`, "-f", `page_paths=${JSON.stringify(pagePaths)}`, "-f", `request_id=${requestId}`]);
  } catch (error) {
    stop("dispatch_failed", `GitHub didn't start Pictures: ${String(error.stderr || error.message).trim()}`);
  }
  if (!input.isJson) console.log(`Pictures of ${pagePaths.join(", ")} at ${headSha.slice(0, 7)}: asked GitHub, finding the run.`);

  let run = null;
  for (const startedMs = Date.now(); !run && Date.now() - startedMs < FIND_RUN_LIMIT_MS; ) {
    await wait(FIND_EVERY_MS);
    const runs = JSON.parse(gh(["run", "list", "--workflow", WORKFLOW_FILE, "--event", "workflow_dispatch", "--limit", "30", "--json", "databaseId,displayTitle,url"]));
    run = runs.find((each) => each.displayTitle.includes(`(${requestId})`)) ?? null;
  }
  if (!run) stop("run_not_found", `GitHub took the ask but no Pictures run named ${requestId} showed within ${FIND_RUN_LIMIT_MS / 60000} minutes: see gh run list --workflow ${WORKFLOW_FILE}.`);
  if (!input.isJson) console.log(`The run: ${run.url}`);

  let status = null;
  for (const startedMs = Date.now(); Date.now() - startedMs < RUN_LIMIT_MS; await wait(WATCH_EVERY_MS)) {
    status = JSON.parse(gh(["run", "view", String(run.databaseId), "--json", "status,conclusion"]));
    if (status.status === "completed") break;
  }
  if (status?.status !== "completed") stop("run_unfinished", `${run.url} is still running after ${RUN_LIMIT_MS / 60000} minutes.`);
  if (status.conclusion === "cancelled") stop("run_cancelled", `${run.url} was cancelled (a newer ask for #${pullRequestNumber} replaces one still running).`);

  const runsFolder = join(outFolder, "runs");
  for (const kind of ["runs", "sheets", "strips"]) rmSync(join(outFolder, kind), { recursive: true, force: true });
  mkdirSync(runsFolder, { recursive: true });
  try {
    gh(["run", "download", String(run.databaseId), "--pattern", "pictures-*", "--dir", runsFolder]);
  } catch (error) {
    stop("download_failed", `The run's pictures didn't download: ${String(error.stderr || error.message).trim()}. The run: ${run.url}`);
  }
  const pages = readdirSync(runsFolder).sort().flatMap((name) => {
    const runPath = join(runsFolder, name, "run.json");
    if (!existsSync(runPath)) return [];
    return [{ ...JSON.parse(readFileSync(runPath, "utf8")), folder: join(runsFolder, name) }];
  });
  for (const kind of ["sheets", "strips"]) {
    mkdirSync(join(outFolder, kind), { recursive: true });
    for (const { from, name } of flattenedPictures(pages.map((page) => ({ page_path: page.page_path, folder: join(page.folder, kind), names: picturesIn(join(page.folder, kind)) })))) copyFileSync(from, join(outFolder, kind, name));
  }
  const answer = {
    pull_request_number: pullRequestNumber, head_sha: headSha, run_url: run.url,
    sheets_folder: join(outFolder, "sheets"), strips_folder: join(outFolder, "strips"),
    pages: pages.map(({ page_path, layout_outcome, motion_outcome, folder }) => ({ page_path, layout_outcome, motion_outcome, layout_output_path: join(folder, "layout.txt"), motion_output_path: join(folder, "motion.txt") })),
    is_passed: pages.length > 0 && pages.every((page) => page.layout_outcome === "success" && page.motion_outcome === "success"),
  };
  writeFileSync(join(outFolder, "pictures.json"), JSON.stringify(answer, null, 2));
  say(answer, [
    ...answer.pages.map((page) => `${page.page_path}: layout check ${page.layout_outcome}, motion sheet ${page.motion_outcome}`),
    `Sheets: ${answer.sheets_folder} (${picturesIn(answer.sheets_folder).length}). Strips: ${answer.strips_folder} (${picturesIn(answer.strips_folder).length}).`,
    verdictLine(pages),
  ].join("\n"));
  process.exit(answer.is_passed ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
