// What the Screens bench keeps on the disk, answered by the preview's feedback server: its scripts, read fresh at each request so a change shows
// on a reload, the seen marks and the prepared profiles.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SAFE_AREA_PX, phoneMediaText, phoneSafeAreaText } from "./phone-media.mjs";
import { SIGN_INS } from "../sign-ins.mjs";

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

