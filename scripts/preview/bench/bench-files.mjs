// What the Screens bench keeps on the disk, answered by the preview's feedback server: its scripts, read fresh at each request so a change shows
// on a reload, the seen marks, the prepared profiles and the pages waiting for a stamp (stamp-queue.mjs).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SAFE_AREA_PX, phoneMediaText, phoneSafeAreaText } from "./phone-media.mjs";
import { SIGN_INS } from "../sign-ins.mjs";
import { entryPicture, waitingEntries } from "../stamp-queue.mjs";

export const BENCH_PATH = "/__preview/bench/";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../..");
/** A session's own test accounts, under "Prepared for this work". Per checkout: they're for the work in it. */
export const PREPARED_PROFILES_FILE = join(ROOT, ".wrangler/preview-run/prepared-profiles.json");
/** A piece stays seen on a branch and off it: this many of its looks count. */
export const MAXIMUM_SEEN_LOOKS = 5;

/** Seen marks outlast a worktree, in the repository's shared git folder, never in the repository. */
const seenFile = () => join(resolve(ROOT, execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: ROOT, encoding: "utf8" }).trim()), "zaisma-bench-seen.json");
const readJson = (file, otherwise) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return otherwise; } };
const writeJson = (file, value) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(`${file}.next`, JSON.stringify(value)); renameSync(`${file}.next`, file); };

/** The test accounts for the profile menu: this checkout's prepared ones, then the rest with what each is for. */
export const profilesToShow = () => ({ prepared: readJson(PREPARED_PROFILES_FILE, []), test_accounts: SIGN_INS });

/** seen is { "<place>/<state>/<guest|signed_in>": [look, …] }: a state pressed in this look, newest last, at most MAXIMUM_SEEN_LOOKS. */
export function seenAfter(seen, keyText, lookText) {
  const looks = (seen[keyText] ?? []).filter((each) => each !== lookText);
  return { ...seen, [keyText]: [...looks, lookText].slice(-MAXIMUM_SEEN_LOOKS) };
}

/** A PNG's or JPEG's size from its first bytes, or null. */
export function pictureSize(bytes) {
  if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47) return { width_px: bytes.readUInt32BE(16), height_px: bytes.readUInt32BE(20) };
  for (let at = 2; at + 9 < bytes.length && bytes[0] === 0xff && bytes[1] === 0xd8;) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width_px: bytes.readUInt16BE(at + 7), height_px: bytes.readUInt16BE(at + 5) };
    at += 2 + bytes.readUInt16BE(at + 2);
  }
  return null;
}

/** A waiting entry as the stamp view takes it: each picture as its address and size, never its path on this Mac. */
function stampEntryToShow(entry) {
  const shown = (kind, pageIndex = 0) => {
    const found = entryPicture([entry], entry.pull_request_number, kind, pageIndex);
    const size = found && pictureSize(found.bytes);
    return size ? { url: `${BENCH_PATH}stamp-picture?pr=${entry.pull_request_number}&kind=${kind}&page=${pageIndex}`, ...size } : null;
  };
  const { pages, concept_picture_path: conceptPath, stamp_file_path: stampPath, ...rest } = entry;
  return { ...rest, concept: shown("concept"), pages: pages.map(({ contact_sheet_path: sheetPath, ...page }, pageIndex) => ({ ...page, sheet: shown("sheet", pageIndex) })) };
}

const readBody = async (request) => { const chunks = []; for await (const chunk of request) chunks.push(chunk); return Buffer.concat(chunks).toString("utf8"); };
const sendJson = (response, status, value) => { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(value)); };

export async function answerBench(request, response, url) {
  const name = url.pathname.slice(BENCH_PATH.length);
  if (request.method === "GET" && name === "frame.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
    return response.end(readFileSync(join(HERE, "frame-script.js"), "utf8").replace("/*PHONE_MEDIA*/", `const phoneMediaText = ${phoneMediaText.toString()};\nconst phoneSafeAreaText = ${phoneSafeAreaText.toString()};\nconst SAFE_AREA_PX = ${JSON.stringify(SAFE_AREA_PX)};`));
  }
  if (request.method === "GET" && name === "bench.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
    return response.end(readFileSync(join(HERE, "bench-script.js"), "utf8"));
  }
  if (request.method === "GET" && name === "profiles") return sendJson(response, 200, profilesToShow());
  if (request.method === "GET" && name === "stamps") return sendJson(response, 200, { entries: waitingEntries().map(stampEntryToShow) });
  if (request.method === "GET" && name === "stamp-picture") {
    const found = entryPicture(waitingEntries(), Number(url.searchParams.get("pr")), url.searchParams.get("kind"), Number(url.searchParams.get("page") ?? 0));
    if (!found) return sendJson(response, 404, { error: { code: "picture_not_found", message: "No waiting entry names that picture, or its file is gone." } });
    response.writeHead(200, { "content-type": found.content_type, "cache-control": "no-store" });
    return response.end(found.bytes);
  }
  if (name === "seen" && request.method === "GET") return sendJson(response, 200, readJson(seenFile(), {}));
  if (name === "seen" && request.method === "POST") {
    const { key_text: keyText, look_text: lookText } = JSON.parse(await readBody(request));
    const seen = seenAfter(readJson(seenFile(), {}), String(keyText), String(lookText));
    writeJson(seenFile(), seen);
    return sendJson(response, 200, seen);
  }
  if (name === "seen" && request.method === "DELETE") { writeJson(seenFile(), {}); return sendJson(response, 200, {}); }
  sendJson(response, 404, { error: { code: "not_found", message: `Nothing at ${request.method} ${url.pathname}.` } });
}

