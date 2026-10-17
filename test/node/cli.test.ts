import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { VISIBILITIES } from "../../packages/core/src/developers.ts";
import { ERROR_CODES } from "../../packages/core/src/errors.ts";
import { FORUM_CATEGORIES, TOPIC_KINDS } from "../../packages/core/src/forum.ts";

/**
 * The upload command's outward side ("Nothing for an AI to guess" in docs/DECISIONS.md): closed
 * flags, --json with the API's answers as-is, and exit codes. The command runs against a stand-in
 * API on localhost that records every call.
 */

const ROOT = join(import.meta.dirname, "../..");
const CLI = join(ROOT, "packages/cli/zaisma.mjs");

type Call = { method: string; path: string; body: unknown };
type Answer = { status: number; body: unknown };
let calls: Call[] = [];
/** What the stand-in answers, by "METHOD /path" (after /api/dev); anything else is a 404 not_found. */
let answers: Record<string, Answer | ((call: Call) => Answer)> = {};

const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks);
  const isJsonBody = request.headers["content-type"] === "application/json";
  const call = { method: request.method!, path: request.url!.replace(/^\/api\/dev/, ""), body: isJsonBody ? JSON.parse(raw.toString("utf8")) : raw.length || null };
  calls.push(call);
  const route = answers[`${call.method} ${call.path.split("?")[0]}`];
  const answer = typeof route === "function" ? route(call) : (route ?? { status: 404, body: { error: { code: "not_found", message: "There's no API call at that path.", field: null, fix: "Check the path.", retry_after_sec: null } } });
  if (typeof answer.body === "string") {
    response.writeHead(answer.status, { "content-type": "text/html" }).end(answer.body);
    return;
  }
  response.writeHead(answer.status, { "content-type": "application/json" }).end(JSON.stringify(answer.body));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const API = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  calls = [];
  answers = {};
});

/** Runs the command (asynchronously, so the stand-in API can answer) and gives what it printed and its exit code. */
function zaisma(commandArguments: string[], { key = "zsk_test_key", input = "" } = {}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...commandArguments], { env: { ...process.env, ZAISMA_API: API, ZAISMA_KEY: key, ZAISMA_SCAN_CHECK_INTERVAL_MS: "1" } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (exitCode) => resolve({ exitCode: exitCode ?? -1, stdout, stderr }));
    child.stdin.end(input);
  });
}
const json = (text: string) => JSON.parse(text);

const help = json((await zaisma(["help", "--json"])).stdout) as {
  commands: { command: string; arguments: { name: string; choices: string[] | null }[]; flags: { flag: string; choices: string[] | null }[] }[];
  exit_codes: { exit_code: number; name: string; meaning: string }[];
  error_codes: { code: string; meaning: string }[];
};
const commandFlags = (command: string) => help.commands.find((entry) => entry.command === command)!.flags;

const game = { slug: "sky-hopper", title: "Sky Hopper", visibility: "draft", review_status: "pending", review_reason: null, page_url: "https://zaisma.test/g/sky-hopper" };
const version = (scanStatus: string) => ({ id: "version_8f3k2m9q1x7c4v6b", scan_status: scanStatus, is_live: false, preview_url: scanStatus === "approved" ? "https://sky-hopper--secret.zaismausercontent.test/" : null, review_reason: null, findings: scanStatus === "approved" || scanStatus === "scanning" ? [] : [{ code: "hidden_iframe", severity: "hold", message: "A hidden frame.", content_rule: null, path: "index.html", fix: "Remove the hidden frame." }], scheduled_publish_at: null });

describe("closed flags", () => {
  it("refuses a flag the command doesn't take, with the ones it does, and sends nothing", async () => {
    const result = await zaisma(["upload", "./build", "--game", "sky-hopper", "--patch-note", "Faster"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("doesn't take --patch-note");
    expect(result.stderr).toContain("Did you mean --patch-notes?");
    expect(result.stderr).toContain("--game, --patch-notes, --publish-when-approved and --json");
    expect(result.stderr).toContain("(unknown_field)");
    expect(calls).toEqual([]);
  });

  it("answers in the API's error shape with --json", async () => {
    const result = await zaisma(["games", "--slug", "sky-hopper", "--json"]);
    expect(result.exitCode).toBe(2);
    expect(json(result.stdout)).toEqual({ error: { code: "unknown_field", message: "zaisma games doesn't take --slug.", field: "--slug", fix: "zaisma games takes only --json.", retry_after_sec: null } });
    expect(result.stderr).toBe("");
  });

  it("refuses an argument too many, a missing one, a missing value and a repeated flag", async () => {
    expect(json((await zaisma(["versions", "sky-hopper", "extra", "--json"])).stdout).error.code).toBe("unknown_field");
    expect(json((await zaisma(["publish", "sky-hopper", "--json"])).stdout).error).toMatchObject({ code: "missing_field", field: "version_id" });
    expect(json((await zaisma(["upload", "./build", "--json"])).stdout).error).toMatchObject({ code: "missing_field", field: "--game" });
    expect(json((await zaisma(["upload", "./build", "--game", "--json"])).stdout).error).toMatchObject({ code: "missing_value", field: "--game" });
    expect(json((await zaisma(["upload", "./build", "--game", "a", "--game=b", "--json"])).stdout).error).toMatchObject({ code: "repeated_field", field: "--game" });
    expect(json((await zaisma(["forum", "reply", "topic_1", "--reopen=yes", "--json"])).stdout).error).toMatchObject({ code: "takes_no_value", field: "--reopen" });
    expect(json((await zaisma(["forum", "post", "--kind", "bug", "--title", "x", "--category", "cli", "--json"])).stdout).error).toMatchObject({ code: "missing_field", field: "--text" });
    expect(calls).toEqual([]);
  });

  it("checks choices before calling the API, with the valid list", async () => {
    const visibility = await zaisma(["visibility", "sky-hopper", "public", "--json"]);
    expect(visibility.exitCode).toBe(2);
    expect(json(visibility.stdout).error).toMatchObject({ code: "bad_visibility", field: "visibility", fix: "Give one of: listed, unlisted, private, draft." });
    expect(json((await zaisma(["forum", "post", "--kind", "bug report", "--json"])).stdout).error).toMatchObject({ code: "bad_kind", field: "--kind" });
    expect(json((await zaisma(["forum", "message", "--kind", "talk", "--json"])).stdout).error).toMatchObject({ code: "bad_kind", field: "--kind" });
    expect(json((await zaisma(["forum", "post", "--category", "Rooms", "--json"])).stdout).error).toMatchObject({ code: "bad_category", field: "--category" });
    expect(calls).toEqual([]);
  });

  it("takes the same choices as the API", () => {
    const choicesOf = (command: string, flag: string) => commandFlags(command).find((entry) => entry.flag === flag)!.choices;
    expect(help.commands.find((entry) => entry.command === "visibility")!.arguments[1]!.choices!.sort()).toEqual([...VISIBILITIES].sort());
    expect(choicesOf("forum post", "--kind")).toEqual([...TOPIC_KINDS]);
    expect(choicesOf("forum message", "--kind")).toEqual(TOPIC_KINDS.filter((kind) => kind !== "talk"));
    expect(choicesOf("forum post", "--category")).toEqual(FORUM_CATEGORIES);
    expect(choicesOf("forum message", "--category")).toEqual(FORUM_CATEGORIES);
  });

  it("names the new command and flag for renamed ones", async () => {
    const show = await zaisma(["show", "sky-hopper", "--visibility", "listed", "--json"]);
    expect(show.exitCode).toBe(2);
    expect(json(show.stdout).error).toMatchObject({ code: "renamed_command", message: "zaisma show is now zaisma visibility.", fix: "Run: zaisma visibility sky-hopper listed" });
    expect(json((await zaisma(["feedback", "--json"])).stdout).error.code).toBe("renamed_command");
    expect(json((await zaisma(["upload", "./build", "--game", "a", "--notes", "x", "--json"])).stdout).error).toMatchObject({ code: "renamed_field", field: "--notes", message: "--notes is now --patch-notes." });
    expect(json((await zaisma(["nope", "--json"])).stdout).error.code).toBe("unknown_command");
  });
});

describe("--json", () => {
  it("prints the API's answer as-is, and nothing else", async () => {
    const answer = { games: [game], unread_topic_count: 0 };
    answers["GET /games"] = { status: 200, body: answer };
    const result = await zaisma(["games", "--json"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${JSON.stringify(answer)}\n`);

    const changed = { game: { ...game, visibility: "listed" }, next_steps: [] };
    answers["PATCH /games/sky-hopper"] = { status: 200, body: changed };
    const visibility = await zaisma(["visibility", "sky-hopper", "listed", "--json"]);
    expect(json(visibility.stdout)).toEqual(changed);
    expect(calls.at(-1)).toEqual({ method: "PATCH", path: "/games/sky-hopper", body: { visibility: "listed" } });
  });

  it("prints the API's error as-is on failure, with exit code 1", async () => {
    const error = { error: { code: "no_game", message: "You have no game called nope.", field: "slug", fix: "List your games with list_games.", retry_after_sec: null } };
    answers["GET /games/nope"] = { status: 404, body: error };
    const result = await zaisma(["versions", "nope", "--json"]);
    expect(result.exitCode).toBe(1);
    expect(json(result.stdout)).toEqual(error);

    const plain = await zaisma(["versions", "nope"]);
    expect(plain.exitCode).toBe(1);
    expect(plain.stdout).toBe("");
    expect(plain.stderr).toBe("zaisma: You have no game called nope. List your games with list_games. (no_game)\n");
  });

  it("says so in the same shape when the answer isn't JSON or there's no key", async () => {
    answers["GET /games"] = { status: 502, body: "<html>Bad gateway</html>" };
    const result = await zaisma(["games", "--json"]);
    expect(result.exitCode).toBe(1);
    expect(json(result.stdout).error).toMatchObject({ code: "unexpected_answer", retry_after_sec: 60 });
    const noKey = await zaisma(["games", "--json"], { key: "" });
    expect(noKey.exitCode).toBe(1);
    expect(json(noKey.stdout).error).toMatchObject({ code: "no_key", field: "ZAISMA_KEY" });
  });

  it("prints both forum tabs' answers by the API's tab names", async () => {
    const yours = { topics: [], next_cursor: null };
    const messages = { topics: [], next_cursor: null };
    answers["GET /forum"] = (call) => ({ status: 200, body: call.path.includes("tab=yours") ? yours : messages });
    expect(json((await zaisma(["forum", "--json"])).stdout)).toEqual({ yours, messages });
  });

  it("help --json lists every command, and the exit codes and error codes the docs list", async () => {
    expect(help.commands.map((entry) => entry.command)).toEqual(["games", "new", "upload", "versions", "publish", "unschedule", "visibility", "forum", "forum post", "forum message", "forum reply", "database", "database query", "database batch", "saves", "saves get", "saves change", "saves replace", "saves reset", "saves copies", "saves copy", "saves restore", "help"]);
    const docs = readFileSync(join(ROOT, "docs/DEVELOPER-API.md"), "utf8");
    const section = docs.slice(docs.indexOf("\n## The upload command\n"));
    const exitRows = [...section.matchAll(/^\| (\d+) \| `([a-z_]+)` \| (.+) \|$/gm)].map((row) => ({ exit_code: Number(row[1]), name: row[2], meaning: row[3] }));
    expect(exitRows).toEqual(help.exit_codes);
    const errorRows = [...section.matchAll(/^\| `([a-z_]+)` \| (.+) \|$/gm)].map((row) => ({ code: row[1], meaning: row[2] }));
    expect(errorRows).toEqual(help.error_codes);
    // The command's own codes never reuse the API's, and every code it can answer with is one or the other.
    expect(help.error_codes.filter((entry) => entry.code in ERROR_CODES)).toEqual([]);
    const source = readFileSync(CLI, "utf8");
    const usedCodes = new Set([...source.matchAll(/(?:refuse\(|code: )"([a-z_]+)"/g)].map((match) => match[1]!));
    for (const entry of help.commands) for (const option of [...entry.flags.map((flag) => ({ name: flag.flag.slice(2).replaceAll("-", "_"), choices: flag.choices })), ...entry.arguments]) if (option.choices) usedCodes.add(`bad_${option.name}`);
    const known = new Set([...Object.keys(ERROR_CODES), ...help.error_codes.map((entry) => entry.code)]);
    expect([...usedCodes].filter((code) => !known.has(code))).toEqual([]);
  });
});

describe("database", () => {
  const scores = { rows: [{ player_id: "player_a", best_score: 1200, replay: { blob_base64: "AAEC" } }], read_row_count: 1, written_row_count: 0 };

  it("sends one statement with its values, from an argument or piped in, and prints the rows", async () => {
    answers["POST /games/sky-hopper/database/query"] = { status: 200, body: { ...scores, next_steps: [] } };
    const result = await zaisma(["database", "query", "sky-hopper", "SELECT * FROM scores WHERE best_score > ?", "--values", "[1000]"]);
    expect(result.exitCode).toBe(0);
    expect(calls[0]).toMatchObject({ method: "POST", path: "/games/sky-hopper/database/query", body: { sql: "SELECT * FROM scores WHERE best_score > ?", values: [1000] } });
    expect(result.stdout).toBe("player_id  best_score  replay\nplayer_a   1200        <blob, 3 bytes>\n1 row. Read 1, wrote 0.\n");

    const piped = await zaisma(["database", "query", "sky-hopper", "--json"], { input: "SELECT 1\n" });
    expect(calls[1]!.body).toEqual({ sql: "SELECT 1" });
    expect(json(piped.stdout)).toEqual({ ...scores, next_steps: [] });
  });

  it("sends a JSON file of statements as one batch", async () => {
    const folder = mkdtempSync(join(tmpdir(), "zaisma-batch-"));
    const statements = [{ sql: "DELETE FROM scores WHERE player_id = ?", values: ["player_a"] }, { sql: "SELECT count(*) AS score_count FROM scores" }];
    writeFileSync(join(folder, "fix.json"), JSON.stringify(statements));
    answers["POST /games/sky-hopper/database/batch"] = { status: 200, body: { statement_results: [scores, scores], next_steps: [] } };
    const result = await zaisma(["database", "batch", "sky-hopper", join(folder, "fix.json"), "--json"]);
    expect(result.exitCode).toBe(0);
    expect(calls[0]!.body).toEqual({ statements });
  });

  it("refuses values or statements that aren't JSON lists before anything is sent", async () => {
    const badValues = await zaisma(["database", "query", "sky-hopper", "SELECT ?", "--values", "1000", "--json"]);
    expect(badValues.exitCode).toBe(2);
    expect(json(badValues.stdout).error).toMatchObject({ code: "bad_values", field: "--values" });
    const badFile = await zaisma(["database", "batch", "sky-hopper", "--json"], { input: "DELETE FROM scores" });
    expect(json(badFile.stdout).error).toMatchObject({ code: "bad_sql", field: "file" });
    const missing = await zaisma(["database", "batch", "sky-hopper", "/nowhere/fix.json", "--json"]);
    expect(json(missing.stdout).error).toMatchObject({ code: "not_a_file", field: "file" });
    expect(calls).toEqual([]);
  });
});

describe("saves", () => {
  const player = "player_8f3k2m9q1x7c4v6b0n5z";
  const save = { player_id: player, sha256: "ab", size_bytes: 30, updated_at: "2026-10-17T09:00:00.000Z", changed_by_kind: "player", save_copy_count: 1 };
  const changed = { save: { ...save, changed_by_kind: "developer" }, kept_save_copy_id: "save_copy_4k2m9q1x7c4v6b0n5z8f", next_steps: [] };

  it("reads some keys, each its own parameter, and prints them", async () => {
    answers[`GET /games/sky-hopper/saves/${player}`] = { status: 200, body: { save: { ...save, local_storage_items: { "level,best": "3" }, missing_keys: ["gems"], indexeddb_databases: null } } };
    const result = await zaisma(["saves", "get", "sky-hopper", player, "--keys", '["level,best", "gems"]']);
    expect(result.exitCode).toBe(0);
    expect(calls[0]!.path).toBe(`/games/sky-hopper/saves/${player}?keys=level%2Cbest&keys=gems`);
    expect(result.stdout).toContain("level,best = 3\ngems: not in the save\n");
  });

  it("changes keys from an argument or piped in, and says how to undo it", async () => {
    answers[`PATCH /games/sky-hopper/saves/${player}`] = { status: 200, body: changed };
    const result = await zaisma(["saves", "change", "sky-hopper", player, '{"coins": "500", "tutorial": null}']);
    expect(result.exitCode).toBe(0);
    expect(calls[0]).toMatchObject({ method: "PATCH", body: { local_storage_items: { coins: "500", tutorial: null } } });
    expect(result.stdout).toContain(`zaisma saves restore sky-hopper ${player} save_copy_4k2m9q1x7c4v6b0n5z8f`);
    const piped = await zaisma(["saves", "change", "sky-hopper", player, "--json"], { input: '{"coins": "1"}' });
    expect(calls[1]!.body).toEqual({ local_storage_items: { coins: "1" } });
    expect(json(piped.stdout)).toEqual(changed);
  });

  it("replaces the whole save with what saves get --json printed", async () => {
    answers[`PUT /games/sky-hopper/saves/${player}`] = { status: 200, body: changed };
    const printed = { save: { ...save, local_storage_items: { coins: "0" }, missing_keys: [], indexeddb_databases: [] } };
    expect((await zaisma(["saves", "replace", "sky-hopper", player], { input: JSON.stringify(printed) })).exitCode).toBe(0);
    expect(calls[0]!.body).toEqual({ local_storage_items: { coins: "0" }, indexeddb_databases: [] });
  });

  it("refuses keys or a save that aren't JSON before anything is sent", async () => {
    expect(json((await zaisma(["saves", "get", "sky-hopper", player, "--keys", "coins", "--json"])).stdout).error).toMatchObject({ code: "bad_keys", field: "--keys" });
    expect(json((await zaisma(["saves", "change", "sky-hopper", player, "coins=500", "--json"])).stdout).error).toMatchObject({ code: "bad_local_storage_items", field: "items_json" });
    expect(json((await zaisma(["saves", "replace", "sky-hopper", player, "--json"], { input: '{"coins": "0"}' })).stdout).error).toMatchObject({ code: "bad_local_storage_items", field: "file" });
    expect(calls).toEqual([]);
  });
});

describe("--scheduled-publish-at", () => {
  it("takes an ISO time with an offset and sends it as-is", async () => {
    answers["POST /games/sky-hopper/versions/version_8f3k2m9q1x7c4v6b/publish"] = { status: 200, body: { game, version: { ...version("approved"), scheduled_publish_at: "2026-11-01T16:00:00Z" }, next_steps: [] } };
    const result = await zaisma(["publish", "sky-hopper", "version_8f3k2m9q1x7c4v6b", "--scheduled-publish-at", "2026-11-01T17:00+01:00"]);
    expect(result.exitCode).toBe(0);
    expect(calls).toEqual([{ method: "POST", path: "/games/sky-hopper/versions/version_8f3k2m9q1x7c4v6b/publish", body: { scheduled_publish_at: "2026-11-01T17:00+01:00" } }]);
    expect(result.stdout).toContain("2026-11-01T16:00:00Z");
  });

  it("refuses a time without a zone, and writes out this computer's offset for it", async () => {
    for (const written of ["2026-11-01 17:00", "2026-11-01T17:00", "1792012345678", "tomorrow"]) {
      const result = await zaisma(["publish", "sky-hopper", "version_8f3k2m9q1x7c4v6b", "--scheduled-publish-at", written, "--json"]);
      expect(result.exitCode, written).toBe(2);
      expect(json(result.stdout).error, written).toMatchObject({ code: "bad_time", field: "--scheduled-publish-at" });
    }
    const local = json((await zaisma(["publish", "sky-hopper", "version_8f3k2m9q1x7c4v6b", "--scheduled-publish-at=2026-11-01 17:00", "--json"])).stdout).error;
    expect(local.fix).toMatch(/"2026-11-01T17:00[+-]\d\d:\d\d"/);
    expect(calls).toEqual([]);
  });
});

describe("exit codes", () => {
  const folder = mkdtempSync(join(tmpdir(), "zaisma-cli-"));
  writeFileSync(join(folder, "index.html"), "<!doctype html><title>Sky Hopper</title>");
  const fileSha256 = createHash("sha256").update(readFileSync(join(folder, "index.html"))).digest("hex");
  const uploadAnswers = (finalScanStatus: string) => {
    let checkCount = 0;
    answers["POST /games/sky-hopper/uploads"] = { status: 200, body: { file_count: 1, size_bytes: 40, missing_file_hashes: [fileSha256] } };
    answers[`PUT /files/${fileSha256}`] = { status: 200, body: { storage_status: "stored_now" } };
    answers["POST /games/sky-hopper/versions"] = { status: 200, body: { version: version("scanning"), next_steps: [] } };
    // Scanning for the first two checks, then the final status.
    answers["GET /games/sky-hopper/versions/version_8f3k2m9q1x7c4v6b"] = () => ({ status: 200, body: { version: version(++checkCount > 2 ? finalScanStatus : "scanning") } });
  };

  for (const [scanStatus, exitCode] of [["approved", 0], ["held", 3], ["rejected", 4], ["scanning", 5]] as const) {
    it(`upload ends with ${exitCode} when the version is ${scanStatus}, and --json prints its last answer`, async () => {
      uploadAnswers(scanStatus);
      const result = await zaisma(["upload", folder, "--game", "sky-hopper", "--patch-notes", "First version", "--json"]);
      expect(result.exitCode).toBe(exitCode);
      expect(json(result.stdout)).toEqual({ version: version(scanStatus) });
      expect(result.stderr).toContain("is being scanned");
      expect(calls.find((call) => call.path === "/games/sky-hopper/versions")!.body).toMatchObject({ patch_notes: "First version", publish_when_approved: false });

      expect(calls.find((call) => call.method === "PUT")).toMatchObject({ path: `/files/${fileSha256}` });

      uploadAnswers(scanStatus);
      const plain = await zaisma(["upload", folder, "--game", "sky-hopper"]);
      expect(plain.exitCode).toBe(exitCode);
    });
  }

  it("lists them in the help", async () => {
    const result = await zaisma(["help"]);
    expect(result.exitCode).toBe(0);
    for (const exit of help.exit_codes) expect(result.stdout).toContain(`  ${exit.exit_code}  ${exit.meaning}`);
    for (const entry of help.commands) for (const flag of entry.flags) expect(result.stdout).toContain(`${flag.flag}: `);
  });

  it("a folder that isn't one ends with 2, before anything is sent", async () => {
    const result = await zaisma(["upload", join(folder, "missing"), "--game", "sky-hopper", "--json"]);
    expect(result.exitCode).toBe(2);
    expect(json(result.stdout).error).toMatchObject({ code: "not_a_folder", field: "folder" });
    expect(calls).toEqual([]);
  });
});
