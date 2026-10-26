import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BACKGROUND_SCREENS, VISIBILITIES } from "../../packages/core/src/developers.ts";
import { findChrome } from "../../packages/cli/chrome.mjs";
import { SHADER_LIMITS } from "../../packages/cli/shader-check.mjs";
import { png } from "../site/png-stub.ts";
import { ERROR_CODES } from "../../packages/core/src/errors.ts";
import { FORUM_CATEGORIES, TOPIC_KINDS } from "../../packages/core/src/forum.ts";
import { dumpPart, importStatements, scanStatements } from "../../packages/game-server/src/internal.ts";
import { dumpParts, nodeRead, trickyDatabase } from "./dump-fixtures.ts";
import { zipStream, type ZipSource } from "../../apps/site/src/zip-writer.ts";

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
/** The user agent of each call, in step with calls. */
let userAgents: (string | undefined)[] = [];
/** What the stand-in answers, by "METHOD /path" (after /api/dev); anything else is a 404 not_found. */
let answers: Record<string, Answer | ((call: Call) => Answer)> = {};
/** The bytes of each file sent with PUT, by path. */
let sentBodies = new Map<string, Buffer>();

const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks);
  const isJsonBody = request.headers["content-type"] === "application/json";
  const call = { method: request.method!, path: request.url!.replace(/^\/api\/dev/, ""), body: isJsonBody ? JSON.parse(raw.toString("utf8")) : raw.length || null };
  calls.push(call);
  if (call.method === "PUT") sentBodies.set(call.path, raw);
  userAgents.push(request.headers["user-agent"]);
  // "PUT /files/*" answers every path in /files that has no answer of its own.
  const route = answers[`${call.method} ${call.path.split("?")[0]}`] ?? answers[`${call.method} ${call.path.split("?")[0]!.replace(/[^/]+$/, "*")}`];
  const answer = typeof route === "function" ? route(call) : (route ?? { status: 404, body: { error: { code: "not_found", message: "There's no API call at that path.", field: null, fix: "Check the path.", retry_after_sec: null } } });
  if (answer.body instanceof Uint8Array) {
    response.writeHead(answer.status, { "content-type": "application/zip" }).end(answer.body);
    return;
  }
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
  userAgents = [];
  answers = {};
  sentBodies = new Map();
});

/** Runs the command (asynchronously, so the stand-in API can answer) and gives what it printed and its exit code. */
function zaisma(commandArguments: string[], { key = "zsk_test_key", input = "", environment = {} as Record<string, string> } = {}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...commandArguments], { env: { ...process.env, ZAISMA_API: API, ZAISMA_KEY: key, ZAISMA_SCAN_CHECK_INTERVAL_MS: "1", ...environment } });
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

describe("the upload command's table in docs/DEVELOPER-API.md", () => {
  it("lists the commands and flags the command has, and only those", () => {
    const doc = readFileSync(join(ROOT, "docs/DEVELOPER-API.md"), "utf8");
    const table = doc.slice(doc.indexOf("## The upload command")).split("\n").filter((line) => line.startsWith("| `zaisma "));
    const documented = table.map((line) => {
      const cell = line.split(/(?<!\\)\|/)[1]!.trim().replace(/^`|`$/g, "").replace(/\\\|/g, "|");
      const words = cell.split(" ").slice(1).filter((word) => /^[a-z-]+$/.test(word) && !word.startsWith("-"));
      return { command: words[0]!, subcommand: words[1], flags: [...cell.matchAll(/--[a-z-]+/g)].map((match) => match[0]) };
    });
    const commandNames = help.commands.map((entry) => entry.command);
    for (const row of documented) {
      const full = commandNames.find((name) => name === [row.command, row.subcommand].filter(Boolean).join(" ")) ?? row.command;
      expect(commandNames, full).toContain(full);
      const flags = help.commands.find((entry) => entry.command === full)!.flags.map((entry) => entry.flag);
      for (const flag of row.flags) expect(flags, `${full} ${flag}`).toContain(flag);
    }
    const documentedCommands = new Set(documented.map((row) => commandNames.find((name) => name === [row.command, row.subcommand].filter(Boolean).join(" ")) ?? row.command));
    for (const name of commandNames.filter((name) => name !== "help")) expect(documentedCommands, name).toContain(name);
  });
});

describe("closed flags", () => {
  it("refuses a flag the command doesn't take, with the ones it does, and sends nothing", async () => {
    const result = await zaisma(["upload", "./build", "--game", "sky-hopper", "--patch-note", "Faster"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("doesn't take --patch-note");
    expect(result.stderr).toContain("Did you mean --patch-notes?");
    expect(result.stderr).toContain("--game, --patch-notes, --publish-when-approved, --match-update-mode and --json");
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
    expect(choicesOf("shader", "--screen")).toEqual([...BACKGROUND_SCREENS]);
    expect(choicesOf("check", "--screen")).toEqual([...BACKGROUND_SCREENS]);
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

describe("the user agent", () => {
  it("is the command and its version, so a game's history can say which command uploaded", async () => {
    answers["GET /games"] = { status: 200, body: { games: [], unread_topic_count: 0 } };
    await zaisma(["games", "--json"]);
    const { version } = JSON.parse(readFileSync(join(ROOT, "packages/cli/package.json"), "utf8")) as { version: string };
    expect(userAgents).toEqual([`zaisma-cli/${version}`]);
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
    expect(help.commands.map((entry) => entry.command)).toEqual(["games", "new", "check", "upload", "shader", "versions", "publish", "unschedule", "visibility", "allowed-hosts", "own-servers", "links", "links set", "links remove", "secrets", "secrets set", "secrets delete", "items", "items set", "items remove", "kept-rooms", "kept-rooms delete", "logs", "forum", "forum post", "forum message", "forum reply", "database", "database query", "database batch", "database export", "database import", "database restore", "database undo-restore", "saves", "saves get", "saves change", "saves replace", "saves reset", "saves copies", "saves copy", "saves restore", "export", "help"]);
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

describe("database restore", () => {
  const restore = { id: "database_restore_8f3k2m9q1x7c4v6b0n5z", restore_to_at: "2026-10-18T14:05:00.000Z", restored_at: "2026-10-18T15:00:00.000Z", undoes_database_restore_id: null, undo_expires_at: "2026-11-17T14:59:00.000Z" };

  it("goes back to a time and says how to undo it; undoes one by its id", async () => {
    answers["POST /games/sky-hopper/database/restores"] = { status: 200, body: { database_restore: restore, erased_again_player_count: 2, next_steps: [] } };
    const result = await zaisma(["database", "restore", "sky-hopper", "2026-10-18T14:05:00Z"]);
    expect(result.exitCode).toBe(0);
    expect(calls[0]).toMatchObject({ method: "POST", path: "/games/sky-hopper/database/restores", body: { restore_to_at: "2026-10-18T14:05:00Z" } });
    expect(result.stdout).toContain("Restored sky-hopper's database to 2026-10-18T14:05:00.000Z.\nErased 2 players again");
    expect(result.stdout).toContain(`zaisma database undo-restore sky-hopper ${restore.id}`);

    const undone = { database_restore: { ...restore, id: "database_restore_2b7x0q4n1m8k5c3v9z6d", undoes_database_restore_id: restore.id }, erased_again_player_count: 0, next_steps: [] };
    answers[`POST /games/sky-hopper/database/restores/${restore.id}/undo`] = { status: 200, body: undone };
    const undo = await zaisma(["database", "undo-restore", "sky-hopper", restore.id, "--json"]);
    expect(calls[1]).toMatchObject({ method: "POST", path: `/games/sky-hopper/database/restores/${restore.id}/undo` });
    expect(json(undo.stdout)).toEqual(undone);
  });
});

describe("export", () => {
  /** A .zip as Zaisma's export writes it (apps/site/src/zip-writer.ts). */
  async function zipOf(files: Record<string, string>): Promise<Uint8Array> {
    async function* sources(): AsyncGenerator<ZipSource> {
      for (const [path, text] of Object.entries(files)) yield { path, bytes: new TextEncoder().encode(text), modifiedAtMs: Date.UTC(2026, 9, 18) };
    }
    return new Uint8Array(await new Response(zipStream(sources())).arrayBuffer());
  }

  it("saves the export as a folder, with the database as a ready .sqlite file", async () => {
    const zip = await zipOf({
      "README.txt": "Sky Hopper: everything about it on Zaisma.\n",
      "versions/version_abc/index.html": "<!doctype html><p>hop</p>",
      "versions/version_abc/assets/hero.png": "png bytes",
      "database.sql": "BEGIN TRANSACTION;\nCREATE TABLE scores (player_id TEXT PRIMARY KEY, best_score INTEGER);\nINSERT INTO scores VALUES('player_a',1200);\nCOMMIT;\n",
      "saves.jsonl": '{"player_id":"player_a"}\n',
      "empty.json": "",
    });
    answers["GET /games/sky-hopper/export/download"] = { status: 200, body: zip };
    const folder = join(mkdtempSync(join(tmpdir(), "zaisma-export-")), "sky-hopper");
    const result = await zaisma(["export", "sky-hopper", "--folder", folder, "--json"]);
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    expect(json(result.stdout)).toEqual({ folder, file_count: 6, size_bytes: zip.length, database_file: join(folder, "database.sqlite") });
    expect(readFileSync(join(folder, "versions/version_abc/index.html"), "utf8")).toBe("<!doctype html><p>hop</p>");
    expect(readFileSync(join(folder, "versions/version_abc/assets/hero.png"), "utf8")).toBe("png bytes");
    expect(readFileSync(join(folder, "empty.json"), "utf8")).toBe("");
    expect(readdirSync(folder).sort()).toEqual(["README.txt", "database.sql", "database.sqlite", "empty.json", "saves.jsonl", "versions"]);
    const sqlite = new DatabaseSync(join(folder, "database.sqlite"));
    expect(sqlite.prepare("SELECT * FROM scores").all()).toEqual([{ player_id: "player_a", best_score: 1200 }]);
    sqlite.close();

    // Never into a folder with something in it.
    const again = await zaisma(["export", "sky-hopper", "--folder", folder, "--json"]);
    expect(again.exitCode).toBe(2);
    expect(json(again.stdout).error).toMatchObject({ code: "folder_not_empty", field: "folder" });
  });

  it("reads a zip64 export: more files than a plain zip can count", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 65_540; i++) files[`saves/${String(i).padStart(5, "0")}.json`] = i % 1000 ? "" : `{"i":${i}}`;
    answers["GET /games/sky-hopper/export/download"] = { status: 200, body: await zipOf(files) };
    const folder = join(mkdtempSync(join(tmpdir(), "zaisma-export-")), "out");
    const result = await zaisma(["export", "sky-hopper", "--folder", folder, "--json"]);
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    expect(json(result.stdout)).toMatchObject({ file_count: 65_540, database_file: null });
    expect(readdirSync(join(folder, "saves"))).toHaveLength(65_540);
    expect(readFileSync(join(folder, "saves/65000.json"), "utf8")).toBe('{"i":65000}');
  }, 120_000);

  it("passes on the API's refusal, and leaves no folder behind", async () => {
    answers["GET /games/sky-hopper/export/download"] = { status: 403, body: { error: { code: "key_not_allowed", message: "This API key can't make GET /games/:slug/export/download.", field: null, fix: "Make a read key.", retry_after_sec: null } } };
    const folder = join(mkdtempSync(join(tmpdir(), "zaisma-export-")), "out");
    const result = await zaisma(["export", "sky-hopper", "--folder", folder, "--json"]);
    expect(result.exitCode).toBe(1);
    expect(json(result.stdout).error.code).toBe("key_not_allowed");
    expect(existsSync(folder)).toBe(false);
  });
});

describe("database export and import", () => {
  /** The stand-in's export: the tricky database's dump, in small parts, by cursor, as Zaisma's would answer. */
  const answerExport = () => {
    const database = trickyDatabase();
    answers["GET /games/sky-hopper/database/export"] = (call) => {
      const part = dumpPart(nodeRead(database), new URL(`http://x${call.path}`).searchParams.get("cursor"), 150);
      return { status: 200, body: { dump_sql: part.dumpSql, next_cursor: part.nextCursor, read_row_count: 3 } };
    };
    return dumpParts(database).join("");
  };
  /** The stand-in's import: keeps each part, checks it reads as whole statements, and answers like Zaisma. */
  const answerImport = () => {
    const parts: string[] = [];
    answers["POST /games/sky-hopper/database/import"] = (call) => {
      const dumpSql = (call.body as { dump_sql: string }).dump_sql;
      parts.push(dumpSql);
      const plan = importStatements(dumpSql);
      return { status: 200, body: { statement_count: plan.statementCount, skipped_statement_count: plan.skippedStatementCount, read_row_count: 0, written_row_count: plan.statements.length, next_steps: [] } };
    };
    return parts;
  };

  it("saves every part as SQL, printed or in a file, or as a .sqlite file that's the same database", async () => {
    const whole = answerExport();
    const printed = await zaisma(["database", "export", "sky-hopper"]);
    expect(printed.exitCode).toBe(0);
    expect(printed.stdout).toBe(whole);
    expect(calls.length).toBeGreaterThan(3);
    expect(calls[1]!.path).toMatch(/^\/games\/sky-hopper\/database\/export\?cursor=/);

    const folder = mkdtempSync(join(tmpdir(), "zaisma-export-"));
    const saved = await zaisma(["database", "export", "sky-hopper", join(folder, "game.sql"), "--json"]);
    expect(json(saved.stdout)).toEqual({ dump_sql: null, file: join(folder, "game.sql"), part_count: calls.length / 2, read_row_count: (calls.length / 2) * 3 });
    expect(readFileSync(join(folder, "game.sql"), "utf8")).toBe(whole);

    const sqlite = await zaisma(["database", "export", "sky-hopper", join(folder, "game.sqlite")]);
    expect(sqlite.exitCode).toBe(0);
    expect(sqlite.stdout).toContain(`--database-file ${join(folder, "game.sqlite")}`);
    expect(dumpParts(new DatabaseSync(join(folder, "game.sqlite"))).join("")).toBe(whole);
    expect(existsSync(join(folder, `game.sqlite.partial`))).toBe(false);

    calls = [];
    const again = await zaisma(["database", "export", "sky-hopper", join(folder, "game.sqlite"), "--json"]);
    expect(again.exitCode).toBe(2);
    expect(json(again.stdout).error).toMatchObject({ code: "file_exists", field: "file" });
    expect(calls).toEqual([]);
  });

  it("sends a .sqlite file's dump, the same SQL Zaisma's export writes, in parts of whole statements", async () => {
    const folder = mkdtempSync(join(tmpdir(), "zaisma-import-"));
    const source = new DatabaseSync(join(folder, "game.sqlite"));
    source.exec(dumpParts(trickyDatabase()).join(""));
    source.close();
    const parts = answerImport();
    const result = await zaisma(["database", "import", "sky-hopper", join(folder, "game.sqlite"), "--json"], { environment: { ZAISMA_DUMP_PART_SIZE_BYTES: "200" } });
    expect(result.exitCode).toBe(0);
    expect(parts.length).toBeGreaterThan(3);
    expect(parts.join("")).toBe(dumpParts(trickyDatabase()).join(""));
    expect(json(result.stdout)).toMatchObject({ part_count: parts.length, skipped_statement_count: 4 });
  });

  it("cuts a .sql dump or a piped one at whole statements, triggers and quotes included, and says what went in when a part fails", async () => {
    const whole = dumpParts(trickyDatabase()).join("");
    const folder = mkdtempSync(join(tmpdir(), "zaisma-import-"));
    writeFileSync(join(folder, "game.sql"), whole);
    const parts = answerImport();
    expect((await zaisma(["database", "import", "sky-hopper", join(folder, "game.sql")], { environment: { ZAISMA_DUMP_PART_SIZE_BYTES: "150" } })).exitCode).toBe(0);
    expect(parts.join("")).toBe(whole);
    expect(parts.reduce((sum, part) => sum + scanStatements(part).length, 0)).toBe(scanStatements(whole).length);
    expect(parts.some((part) => part.includes("CREATE TRIGGER") && part.trimEnd().endsWith("END;"))).toBe(true);

    parts.length = 0;
    expect((await zaisma(["database", "import", "sky-hopper"], { input: whole })).exitCode).toBe(0);
    expect(parts).toEqual([whole.trim()]);

    let callCount = 0;
    answers["POST /games/sky-hopper/database/import"] = () =>
      ++callCount === 1
        ? { status: 200, body: { statement_count: 5, skipped_statement_count: 2, read_row_count: 0, written_row_count: 3, next_steps: [] } }
        : { status: 400, body: { error: { code: "bad_sql", message: "Statement 2 of the dump (CREATE TABLE players …) failed: SQLite: table players already exists.", field: "dump_sql", fix: "Drop it first.", retry_after_sec: null } } };
    const failed = await zaisma(["database", "import", "sky-hopper", join(folder, "game.sql"), "--json"], { environment: { ZAISMA_DUMP_PART_SIZE_BYTES: "150" } });
    expect(failed.exitCode).toBe(1);
    expect(json(failed.stdout).error.message).toContain("(Part 2 was undone; the 1 before it, 5 statements, went in.)");

    const empty = await zaisma(["database", "import", "sky-hopper", "--json"]);
    expect(json(empty.stdout).error).toMatchObject({ code: "missing_field", field: "file" });
    const notDatabase = await zaisma(["database", "import", "sky-hopper", join(folder, "game.sql").replace(".sql", ".db"), "--json"]);
    expect(json(notDatabase.stdout).error).toMatchObject({ code: "not_a_file", field: "file" });
    writeFileSync(join(folder, "broken.sqlite"), "not a database at all, just text that goes on for a while to fill a page header");
    expect(json((await zaisma(["database", "import", "sky-hopper", join(folder, "broken.sqlite"), "--json"])).stdout).error).toMatchObject({ code: "not_a_database", field: "file" });
  });
});

describe("saves", () => {
  const player = "player_8f3k2m9q1x7c4v6b0n5z";
  const save = { player_id: player, sha256: "ab", size_bytes: 30, saved_at: "2026-10-17T09:00:00.000Z", changed_by_kind: "player", save_copy_count: 1, version_id: null };
  const changed = { save: { ...save, changed_by_kind: "developer" }, kept_save_copy_id: "save_copy_4k2m9q1x7c4v6b0n5z8f", next_steps: [] };

  it("lists saves with when each was saved, and the opaque cursor as it came", async () => {
    answers["GET /games/sky-hopper/saves"] = { status: 200, body: { saves: [save], next_cursor: "saves_WyJwbGF5ZXJfOGYzayJd" } };
    const result = await zaisma(["saves", "sky-hopper"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`${player}  2026-10-17 09:00`);
    expect(result.stdout).toContain("zaisma saves sky-hopper --cursor saves_WyJwbGF5ZXJfOGYzayJd");
    answers["GET /games/sky-hopper/saves?cursor=saves_WyJwbGF5ZXJfOGYzayJd"] = { status: 200, body: { saves: [], next_cursor: null } };
    expect((await zaisma(["saves", "sky-hopper", "--cursor", "saves_WyJwbGF5ZXJfOGYzayJd"])).exitCode).toBe(0);
  });

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

describe("registered links", () => {
  const store = { link_name: "store", destination_url: "https://kit.itch.io/sky-hopper", is_on_game_page: true, who_can_open: "everyone", review_reason: null };
  const patched = (call: { body?: unknown }) => ({ status: 200, body: { game: { ...game, links: ((call.body as { links: object[] }).links).map((link) => ({ ...link, who_can_open: "signed_in_adults", review_reason: null })) }, review_message: null, game_server_problem: null, next_steps: [] } });

  it("lists them with who each opens for", async () => {
    answers["GET /games/sky-hopper"] = { status: 200, body: { game: { ...game, links: [store] } } };
    const shown = await zaisma(["links", "sky-hopper"]);
    expect(shown.exitCode).toBe(0);
    expect(shown.stdout).toContain("https://kit.itch.io/sky-hopper");
    expect(shown.stdout).toContain("opens for everyone, on the game page");
  });

  it("adds or changes one, and removes one, sending the whole list", async () => {
    answers["GET /games/sky-hopper"] = { status: 200, body: { game: { ...game, links: [store] } } };
    answers["PATCH /games/sky-hopper"] = patched;
    const added = await zaisma(["links", "set", "sky-hopper", "discord", "https://discord.gg/skyhopper"]);
    expect(added.exitCode).toBe(0);
    expect(calls[1]).toMatchObject({ method: "PATCH", body: { links: [{ link_name: "store", destination_url: "https://kit.itch.io/sky-hopper", is_on_game_page: true }, { link_name: "discord", destination_url: "https://discord.gg/skyhopper", is_on_game_page: false }] } });
    expect(added.stdout).toContain('Zaisma.links.open("discord")');
    await zaisma(["links", "set", "sky-hopper", "store", "https://kit.itch.io/sky-hopper-2", "--on-game-page"]);
    expect(calls[3]!.body).toEqual({ links: [{ link_name: "store", destination_url: "https://kit.itch.io/sky-hopper-2", is_on_game_page: true }] });
    await zaisma(["links", "remove", "sky-hopper", "store"]);
    expect(calls[5]!.body).toEqual({ links: [] });
    const missing = await zaisma(["links", "remove", "sky-hopper", "patreon", "--json"]);
    expect(missing.exitCode).toBe(1);
    expect(json(missing.stdout).error).toMatchObject({ code: "unknown_link", field: "link_name" });
  });
});

describe("own servers", () => {
  it("prints the game's own servers, or sets the whole list, and never takes both a list and --none", async () => {
    answers["GET /games/sky-hopper"] = { status: 200, body: { game: { ...game, own_server_urls: [] } } };
    expect((await zaisma(["own-servers", "sky-hopper"])).stdout).toContain("uses no servers of its own");
    answers["PATCH /games/sky-hopper"] = (call) => ({ status: 200, body: { game: { ...game, own_server_urls: (call.body as { own_server_urls: string[] }).own_server_urls }, review_message: null, game_server_problem: null, next_steps: [] } });
    const set = await zaisma(["own-servers", "sky-hopper", "wss://play.example.com,", "wss://eu.example.com"]);
    expect(set.exitCode).toBe(0);
    expect(calls[1]).toMatchObject({ method: "PATCH", body: { own_server_urls: ["wss://play.example.com", "wss://eu.example.com"] } });
    expect(set.stdout).toContain("connects to its own servers: wss://play.example.com, wss://eu.example.com");
    await zaisma(["own-servers", "sky-hopper", "--none"]);
    expect(calls[2]!.body).toEqual({ own_server_urls: [] });
    const both = await zaisma(["own-servers", "sky-hopper", "wss://play.example.com", "--none", "--json"]);
    expect(both.exitCode).not.toBe(0);
    expect(calls).toHaveLength(3);
  });
});

describe("game server reach and secrets", () => {
  it("prints the hosts, or sets the whole list from the arguments, commas or spaces", async () => {
    answers["GET /games/sky-hopper"] = { status: 200, body: { game: { ...game, game_server_allowed_hosts: [] } } };
    expect((await zaisma(["allowed-hosts", "sky-hopper"])).stdout).toContain("calls no other servers");
    answers["PATCH /games/sky-hopper"] = (call) => ({ status: 200, body: { game: { ...game, game_server_allowed_hosts: (call.body as { game_server_allowed_hosts: string[] }).game_server_allowed_hosts }, review_message: null, game_server_problem: null, next_steps: [] } });
    const set = await zaisma(["allowed-hosts", "sky-hopper", "discord.com,", "api.github.com"]);
    expect(set.exitCode).toBe(0);
    expect(calls[1]).toMatchObject({ method: "PATCH", body: { game_server_allowed_hosts: ["discord.com", "api.github.com"] } });
    expect(set.stdout).toContain("can call: discord.com, api.github.com");
    await zaisma(["allowed-hosts", "sky-hopper", "--none"]);
    expect(calls[2]!.body).toEqual({ game_server_allowed_hosts: [] });
  });

  it("sets a secret piped in, without its last line break, and never prints it", async () => {
    answers["PUT /games/sky-hopper/secrets/DISCORD_WEBHOOK_URL"] = { status: 200, body: { secret: { name: "DISCORD_WEBHOOK_URL", set_at: "2026-10-17T09:00:00.000Z" }, next_steps: [] } };
    const result = await zaisma(["secrets", "set", "sky-hopper", "DISCORD_WEBHOOK_URL"], { input: "https://discord.com/api/webhooks/1/abc\n" });
    expect(result.exitCode).toBe(0);
    expect(calls[0]).toMatchObject({ method: "PUT", body: { secret_value: "https://discord.com/api/webhooks/1/abc" } });
    expect(result.stdout + result.stderr).not.toContain("webhooks/1/abc");
    expect(result.stdout).toContain("server.secrets.DISCORD_WEBHOOK_URL");
  });

  it("refuses a secret with no value before anything is sent, and lists and deletes them", async () => {
    expect(json((await zaisma(["secrets", "set", "sky-hopper", "API_TOKEN", "--json"], { input: "" })).stdout).error).toMatchObject({ code: "missing_field", field: "secret_value" });
    expect(calls).toEqual([]);
    answers["GET /games/sky-hopper/secrets"] = { status: 200, body: { secrets: [{ name: "API_TOKEN", set_at: "2026-10-17T09:00:00.000Z" }] } };
    expect((await zaisma(["secrets", "sky-hopper"])).stdout).toContain("API_TOKEN");
    answers["DELETE /games/sky-hopper/secrets/API_TOKEN"] = { status: 200, body: { deleted_secret_name: "API_TOKEN", next_steps: [] } };
    expect((await zaisma(["secrets", "delete", "sky-hopper", "API_TOKEN"])).stdout).toContain("Deleted API_TOKEN");
  });
});

describe("items", () => {
  const revive = { item_name: "revive", title: "Revive", description: "", item_kind: "consumable", item_category: "gameplay", price_minor_units: 199, currency_code: "usd", local_prices: [] };
  const cape = { item_name: "supporter_cape", title: "Supporter's Cape", description: "", item_kind: "permanent", item_category: "cosmetic", price_minor_units: null, currency_code: null, local_prices: [] };
  const crown = { item_name: "gold_crown", title: "Gold Crown", description: "", item_kind: "permanent", item_category: "cosmetic", price_minor_units: 499, currency_code: "usd", local_prices: [] };
  const answered = (item: Record<string, unknown>) => ({ ...item, card_fee_note: null, created_at: "2026-10-22T09:00:00.000Z", updated_at: "2026-10-22T09:00:00.000Z" });
  const listing = (listed: Record<string, unknown>[]) => ({ status: 200, body: { items: listed.map(answered), refund_policy: "unused_within_14_days", refund_policy_text: null, own_payment_categories: [], purchase_label: { categories: ["gameplay"], has_own_payments: false } } });

  it("sets each added and changed item and removes each one gone from the file, leaving the rest alone", async () => {
    answers["GET /games/sky-hopper/items"] = listing([revive, cape, crown]);
    answers["PUT /games/sky-hopper/items/*"] = (call) => ({ status: 200, body: { item: answered({ item_name: call.path.split("/").pop(), ...(call.body as object) }), next_steps: [] } });
    answers["DELETE /games/sky-hopper/items/gold_crown"] = { status: 200, body: { removed_item_name: "gold_crown", next_steps: [] } };
    const boost = { item_name: "speed_boost", title: "Speed Boost", item_kind: "consumable", item_category: "gameplay", price_minor_units: 99, currency_code: "usd" };
    const file = join(mkdtempSync(join(tmpdir(), "zaisma-items-")), "items.json");
    writeFileSync(file, JSON.stringify([{ ...revive, price_minor_units: 149 }, cape, boost]));
    const result = await zaisma(["items", "set", "sky-hopper", file, "--json"]);
    expect(result.exitCode).toBe(0);
    const changes = calls.filter((call) => call.method !== "GET");
    expect(changes.map((call) => `${call.method} ${call.path}`)).toEqual(["PUT /games/sky-hopper/items/revive", "PUT /games/sky-hopper/items/speed_boost", "DELETE /games/sky-hopper/items/gold_crown"]);
    expect(changes[0]!.body).toEqual({ title: "Revive", description: "", item_kind: "consumable", item_category: "gameplay", price_minor_units: 149, currency_code: "usd", local_prices: [] });
    // Fields an item leaves out are sent as nothing set, so the API gets the whole item.
    expect(changes[1]!.body).toMatchObject({ description: "", local_prices: [] });
    expect(json(result.stdout)).toMatchObject({ set_item_names: ["revive", "speed_boost"], removed_item_names: ["gold_crown"] });
  });

  it("keeps an item players own when it's gone from the file, and says which", async () => {
    answers["GET /games/sky-hopper/items"] = listing([revive, crown]);
    answers["DELETE /games/sky-hopper/items/gold_crown"] = { status: 409, body: { error: { code: "item_has_owners", message: "3 completed purchases or grants are of gold_crown.", field: "item_name", fix: "Take its price off.", retry_after_sec: null } } };
    const result = await zaisma(["items", "set", "sky-hopper", "--json"], { input: JSON.stringify([revive]) });
    expect(result.exitCode).toBe(1);
    expect(json(result.stdout).error).toMatchObject({ code: "item_has_owners", field: "file" });
    expect(json(result.stdout).error.message).toContain("gold_crown");
  });

  it("refuses a file that isn't a list of items before anything is sent, and lists and removes items", async () => {
    expect(json((await zaisma(["items", "set", "sky-hopper", "--json"], { input: '{"revive": 199}' })).stdout).error).toMatchObject({ code: "bad_item", field: "file" });
    expect(json((await zaisma(["items", "set", "sky-hopper", "--json"], { input: JSON.stringify([{ ...revive, price: 199 }]) })).stdout).error).toMatchObject({ code: "unknown_field" });
    expect(calls).toEqual([]);
    answers["GET /games/sky-hopper/items"] = listing([revive]);
    const listed = await zaisma(["items", "sky-hopper"]);
    expect(listed.stdout).toContain("revive");
    expect(listed.stdout).toContain("1.99 USD");
    answers["DELETE /games/sky-hopper/items/revive"] = { status: 200, body: { removed_item_name: "revive", next_steps: [] } };
    expect((await zaisma(["items", "remove", "sky-hopper", "revive"])).stdout).toContain("Removed revive");
  });
});

describe("kept rooms", () => {
  const keptRooms = {
    kept_rooms: [
      { room_code: "H4RB9T", name: "Creative Build", saved_size_bytes: 12_500_000, saved_at: "2026-10-20T18:00:00.000Z", last_played_at: "2026-10-20T18:00:00.000Z", created_at: "2026-10-13T18:00:00.000Z" },
      { room_code: "Z2W8PD", name: null, saved_size_bytes: 0, saved_at: null, last_played_at: null, created_at: "2026-10-20T17:59:00.000Z" },
    ],
    kept_rooms_size_bytes: 12_500_000,
    storage_size_bytes: 12_600_000,
    maximum_storage_size_bytes: 10 * 1024 ** 3,
  };

  it("lists a game's kept rooms with their sizes and the game's storage, or the answer as-is with --json", async () => {
    answers["GET /games/sky-hopper/kept-rooms"] = { status: 200, body: keptRooms };
    const result = await zaisma(["kept-rooms", "sky-hopper"]);
    expect(result.exitCode).toBe(0);
    expect(calls).toEqual([{ method: "GET", path: "/games/sky-hopper/kept-rooms", body: null }]);
    expect(result.stdout).toContain("H4RB9T");
    expect(result.stdout).toContain("Creative Build");
    expect(result.stdout).toContain("11.9 MB");
    expect(result.stdout).toContain("Z2W8PD");
    expect(result.stdout).toContain("played never");
    expect(result.stdout).toContain("Storage: 12.0 MB of the 10.0 GB a game can keep");
    expect(json((await zaisma(["kept-rooms", "sky-hopper", "--json"])).stdout)).toEqual(keptRooms);
  });

  it("says how a game keeps a room when it has none", async () => {
    answers["GET /games/sky-hopper/kept-rooms"] = { status: 200, body: { ...keptRooms, kept_rooms: [], kept_rooms_size_bytes: 0, storage_size_bytes: 0 } };
    expect((await zaisma(["kept-rooms", "sky-hopper"])).stdout).toContain("room.setKept(true)");
  });

  it("deletes one by its code, and passes on the API's refusal", async () => {
    answers["DELETE /games/sky-hopper/kept-rooms/K7Q2MX"] = { status: 200, body: { is_deleted: true, next_steps: [] } };
    const result = await zaisma(["kept-rooms", "delete", "sky-hopper", "K7Q2MX"]);
    expect(result.exitCode).toBe(0);
    expect(calls).toEqual([{ method: "DELETE", path: "/games/sky-hopper/kept-rooms/K7Q2MX", body: null }]);
    expect(result.stdout).toContain("Deleted kept room K7Q2MX from sky-hopper");
    expect(json((await zaisma(["kept-rooms", "delete", "sky-hopper", "K7Q2MX", "--json"])).stdout)).toEqual({ is_deleted: true, next_steps: [] });
    const noRoom = { error: { code: "no_kept_room", message: "sky-hopper has no kept room H4RB9T.", field: "room_code", fix: "list_kept_rooms gives this game's kept rooms.", retry_after_sec: null } };
    answers["DELETE /games/sky-hopper/kept-rooms/H4RB9T"] = { status: 404, body: noRoom };
    const refused = await zaisma(["kept-rooms", "delete", "sky-hopper", "H4RB9T", "--json"]);
    expect(refused.exitCode).not.toBe(0);
    expect(json(refused.stdout).error).toMatchObject({ code: "no_kept_room", field: "room_code" });
  });

  it("is in help", async () => {
    const help = await zaisma(["help"]);
    expect(help.stdout).toContain("kept-rooms");
    expect(help.stdout).toContain("kept-rooms delete");
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

  it("upload waits for the version's run in Chrome, then says how it started and what could be smaller", async () => {
    const check = (checkStatus: string) => ({
      check_status: checkStatus,
      checked_at: checkStatus === "checked" ? "2026-10-21T12:00:00Z" : null,
      browser_description: "Chrome 141 on a computer with no graphics card",
      loading_duration_sec: checkStatus === "checked" ? 9.1 : null,
      start_download_size_bytes: checkStatus === "checked" ? 610 * 1024 * 1024 : null,
      start_file_count: checkStatus === "checked" ? 12 : null,
      start_memory_size_bytes: checkStatus === "checked" ? 1.2 * 1024 ** 3 : null,
      longest_start_task_duration_ms: checkStatus === "checked" ? 800 : null,
      notes:
        checkStatus === "checked"
          ? [
              { code: "missing_file_at_start", message: "The game asked for Build/levels/forest.bundle while starting, and it isn't in this version.", path: "Build/levels/forest.bundle", saved_size_bytes: null, fix: "Upload it." },
              { code: "audio_could_be_opus", message: "95 MB of WAV and AIFF audio could be about 10 MB as Ogg Opus.", path: null, saved_size_bytes: 89_000_000, fix: "Convert it." },
            ]
          : [],
    });
    uploadAnswers("approved");
    let checkCount = 0;
    answers["GET /games/sky-hopper/versions/version_8f3k2m9q1x7c4v6b"] = () => ({ status: 200, body: { version: { ...version("approved"), performance_check: check(++checkCount > 3 ? "checked" : "checking") } } });
    const result = await zaisma(["upload", folder, "--game", "sky-hopper"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      [
        "Started in Chrome (a standard computer, no graphics card)",
        "  First frame after 9.1 s · 610.0 MB downloaded before it · 1.2 GB memory at start",
        "  The game asked for Build/levels/forest.bundle while starting, and it isn't in this version. Fix: Upload it.",
        "  Could be smaller:",
        "  · 95 MB of WAV and AIFF audio could be about 10 MB as Ogg Opus. Fix: Convert it.",
        "Passed. Your private preview:",
      ].join("\n"),
    );

    // A run that doesn't finish in time is left to zaisma versions, with the same exit code.
    uploadAnswers("approved");
    answers["GET /games/sky-hopper/versions/version_8f3k2m9q1x7c4v6b"] = { status: 200, body: { version: { ...version("approved"), performance_check: check("waiting") } } };
    const waiting = await zaisma(["upload", folder, "--game", "sky-hopper"]);
    expect(waiting.exitCode).toBe(0);
    expect(waiting.stdout).toContain("Still checking how it starts in Chrome; zaisma versions sky-hopper --json shows it.");
  });

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

describe("check and automatic fixes", () => {
  /** A game folder made of these files (text, or bytes). */
  const gameFolder = (files: Record<string, string | Buffer>) => {
    const folder = mkdtempSync(join(tmpdir(), "zaisma-check-"));
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(folder, path, ".."), { recursive: true });
      writeFileSync(join(folder, path), content);
    }
    return folder;
  };
  /** Every file in a folder with its bytes, to show it wasn't changed. */
  const snapshot = (folder: string) => Object.fromEntries((readdirSync(folder, { recursive: true, withFileTypes: true }) as { name: string; parentPath: string; isFile(): boolean }[]).filter((entry) => entry.isFile()).map((entry) => [join(entry.parentPath, entry.name), readFileSync(join(entry.parentPath, entry.name)).toString("base64")]));
  const threaded = { "index.html": "<!doctype html><script>const GODOT_THREADS_ENABLED = true;</script>", "index.wasm": "" };

  it("says what could be smaller, read from the files' first bytes, without changing the exit code", async () => {
    // A minute of CD-quality WAV, 10 MB.
    const sound = Buffer.alloc(10 * 1024 * 1024);
    sound.write("RIFF", 0);
    sound.write("WAVEfmt ", 8);
    sound.writeUInt32LE(16, 16);
    sound.writeUInt32LE(176_400, 28);
    sound.write("data", 36);
    sound.writeUInt32LE(sound.length - 44, 40);
    const result = await zaisma(["check", gameFolder({ "index.html": '<!doctype html><script src="game.js"></script>', "game.js": "// the game", "music/theme.wav": sound })], { key: "" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Could be smaller:\n  · 10 MB of WAV and AIFF audio could be about 1 MB as Ogg Opus. Fix: Convert it (ffmpeg");
    expect(result.stdout).toContain("Ready to upload: 3 files");
    const answer = json((await zaisma(["check", gameFolder({ "index.html": "<!doctype html>", "music/theme.wav": sound }), "--json"], { key: "" })).stdout);
    expect(answer.performance_notes).toEqual([expect.objectContaining({ code: "audio_could_be_opus", path: "music/theme.wav" })]);
  });

  it("needs no key and sends nothing: a clean folder passes, one with a threaded build ends with 6 and says how to fix it", async () => {
    const clean = await zaisma(["check", gameFolder({ "index.html": '<!doctype html><canvas></canvas><script src="game.js"></script>', "game.js": "// the game" })], { key: "" });
    expect(clean.exitCode).toBe(0);
    expect(clean.stdout).toContain("Ready to upload: 2 files");

    const result = await zaisma(["check", gameFolder(threaded)], { key: "" });
    expect(result.exitCode).toBe(6);
    expect(result.stdout).toContain("[needs_threads]");
    expect(result.stdout).toContain("Thread Support off");
    expect(calls).toEqual([]);
  });

  it("prints the check's answer with --json, and passes a folder whose only problems the upload fixes", async () => {
    const folder = gameFolder({ "index.html": '<!doctype html><script src="https://cdn.example.com/lib.js"></script>', ".env": "SECRET=1" });
    const result = await zaisma(["check", folder, "--game", "sky-hopper", "--json"], { key: "" });
    expect(result.exitCode).toBe(0);
    const answer = json(result.stdout);
    expect(answer).toMatchObject({ file_count: 2, omitted_problem_count: 0 });
    expect(answer.problems.map((problem: { code: string }) => problem.code)).toEqual(["hidden_file", "outside_file"]);
    expect(answer.problems.every((problem: { is_fixed_by_upload_command: boolean }) => problem.is_fixed_by_upload_command)).toBe(true);
  });

  it("counts the game's own servers when the game is named and there's a key", async () => {
    answers["GET /games/sky-hopper"] = { status: 200, body: { game: { ...game, own_server_urls: ["wss://play.example.com"] } } };
    const folder = gameFolder({ "index.html": '<!doctype html><script>new WebSocket("wss://play.example.com/room"); fetch("https://api.other.example/x")</script>' });
    const answer = json((await zaisma(["check", folder, "--game", "sky-hopper", "--json"])).stdout);
    expect(answer.problems.map((problem: { code: string; message: string }) => problem.message)).toEqual([expect.stringContaining("api.other.example")]);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(["GET /games/sky-hopper"]);
  });

  it("upload downloads outside files and unpacks compressed ones in what it sends, never in the folder, and says what it changed", async () => {
    answers["GET /outside/lib.js"] = { status: 200, body: "window.lib = true;" };
    const folder = gameFolder({
      "index.html": `<!doctype html><script src="${API}/outside/lib.js"></script><script>loadData("Build/game.data.gz")</script>`,
      "Build/game.data.gz": gzipSync(Buffer.from("level data")),
    });
    const before = snapshot(folder);
    answers["POST /games/sky-hopper/uploads"] = (call) => ({ status: 200, body: { file_count: 3, size_bytes: 100, missing_file_hashes: (call.body as { files: { sha256: string }[] }).files.map((file) => file.sha256) } });
    answers["PUT /files/*"] = { status: 200, body: { storage_status: "stored_now" } };
    answers["POST /games/sky-hopper/versions"] = { status: 200, body: { version: version("scanning"), next_steps: [] } };
    answers["GET /games/sky-hopper/versions/version_8f3k2m9q1x7c4v6b"] = { status: 200, body: { version: version("approved") } };
    const result = await zaisma(["upload", folder, "--game", "sky-hopper", "--json"], {});
    expect(result.exitCode).toBe(0);
    const list = (calls.find((call) => call.path === "/games/sky-hopper/uploads")!.body as { files: { path: string; sha256: string }[] }).files;
    const site = new URL(API).host.replace(":", "_");
    expect(list.map((file) => file.path).sort()).toEqual(["Build/game.data", "index.html", `zaisma-outside/${site}/outside/lib.js`]);
    const sentText = (path: string) => sentBodies.get(`/files/${list.find((file) => file.path === path)!.sha256}`)?.toString("utf8");
    expect(sentText("index.html")).toBe(`<!doctype html><script src="zaisma-outside/${site}/outside/lib.js"></script><script>loadData("Build/game.data")</script>`.replace('src="zaisma', 'src="./zaisma'));
    expect(sentText("Build/game.data")).toBe("level data");
    expect(sentText(`zaisma-outside/${site}/outside/lib.js`)).toBe("window.lib = true;");
    expect(result.stderr).toContain("Changed in this upload only (your folder stays as it is):");
    expect(result.stderr).toContain(`Downloaded ${API}/outside/lib.js into zaisma-outside/${site}/outside/lib.js`);
    expect(result.stderr).toContain("Unpacked Build/game.data.gz into Build/game.data");
    expect(json(result.stdout)).toEqual({ version: version("approved") });
    expect(snapshot(folder)).toEqual(before);
  });

  it("upload stops before sending anything when an outside file can't be downloaded, or Zaisma would refuse a file", async () => {
    const unreachable = await zaisma(["upload", gameFolder({ "index.html": `<script src="${API}/outside/missing.js"></script>` }), "--game", "sky-hopper", "--json"]);
    expect(unreachable.exitCode).toBe(1);
    expect(json(unreachable.stdout).error).toMatchObject({ code: "outside_file_unreachable", field: `${API}/outside/missing.js` });
    expect(calls.filter((call) => !call.path.startsWith("/outside/"))).toEqual([]);

    const refused = await zaisma(["upload", gameFolder({ "index.html": "<!doctype html>", "setup.exe": "MZ" }), "--game", "sky-hopper", "--json"]);
    expect(refused.exitCode).toBe(1);
    expect(json(refused.stdout).error).toMatchObject({ code: "file_type_not_allowed", field: "folder" });
    expect(refused.stderr).toContain("Zaisma refuses the upload until these are fixed:");
    expect(calls.filter((call) => !call.path.startsWith("/outside/"))).toEqual([]);
  });
});

/** A shader's texture: a small PNG of a pattern. */
const noise = Buffer.from(await png(16, 16, (x, y) => [(x * 37 + y * 11) & 255, (x * 5 + y * 53) & 255, 128]));

describe("shader folders", () => {
  const IMAGE_PASS = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n  vec2 uv = fragCoord / iResolution.xy;\n  fragColor = vec4(mix(vec3(0.1, 0.12, 0.25), vec3(0.4, 0.5, 0.8), uv.y) + texture(iChannel0, uv).rgb * 0.6 + texture(iChannel1, uv * 2.0).rgb * 0.05, 1.0);\n}\n";
  const BUFFER_PASS = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n  vec2 uv = fragCoord / iResolution.xy;\n  vec2 spot = vec2(0.5 + 0.3 * sin(iTime * 0.5), 0.5);\n  fragColor = texture(iChannel0, uv) * 0.97 + vec4(vec3(smoothstep(0.05, 0.0, distance(uv, spot))), 1.0) * 0.3;\n}\n";
  const channels = {
    image: [
      { channel_index: 0, input_kind: "buffer", buffer_name: "a" },
      { channel_index: 1, input_kind: "texture", texture_file: "noise.png" },
    ],
    "buffer-a": [{ channel_index: 0, input_kind: "buffer", buffer_name: "a", filter: "nearest" }],
  };
  /** A shader's folder: the image pass, buffer a and a texture, wired by channels.json, with any files changed or added (null leaves one out). */
  const shaderFolder = (changes: Record<string, string | Buffer | null> = {}) => {
    const folder = mkdtempSync(join(tmpdir(), "zaisma-shader-"));
    const files = { "image.glsl": IMAGE_PASS, "buffer-a.glsl": BUFFER_PASS, "channels.json": JSON.stringify(channels), "noise.png": noise, ...changes };
    for (const [name, content] of Object.entries(files)) if (content !== null) writeFileSync(join(folder, name), content);
    return folder;
  };
  /** What the API would take for the folder above, with the texture's image. */
  const sentShader = (imageId: string) => ({
    screen: "wide",
    image: {
      source: IMAGE_PASS,
      channels: [
        { channel_index: 0, input_kind: "buffer", buffer_name: "a", image_id: null, filter: "linear", wrap: "clamp" },
        { channel_index: 1, input_kind: "texture", buffer_name: null, image_id: imageId, filter: "linear", wrap: "repeat" },
      ],
    },
    buffers: [{ buffer_name: "a", source: BUFFER_PASS, channels: [{ channel_index: 0, input_kind: "buffer", buffer_name: "a", image_id: null, filter: "nearest", wrap: "clamp" }] }],
  });
  const textureImage = (id: string, reviewStatus = "approved") => ({ id, kind: "shader_texture", review_status: reviewStatus, review_reason: null, listing_reason: null, width_px: 16, height_px: 16, size_bytes: noise.length, image_url: `${API}/img/${id}`, created_at: "2026-10-23T09:00:00Z" });
  const shaderAnswer = { shader: { id: "shader_8f3k2m9q1x7c4v6b", screen: "wide", review_status: "pending" }, review_message: "It's drawn and checked in a minute or two.", next_steps: [] };

  it("refuses a folder it doesn't read exactly before anything is sent, each with its code and a fix", async () => {
    const refusal = async (folder: string, command = ["shader", folder, "--game", "sky-hopper", "--screen", "wide"]) => json((await zaisma([...command, "--json"])).stdout).error;
    expect(await refusal(shaderFolder({ "image.glsl": null }))).toMatchObject({ code: "no_image_pass", field: "folder" });
    expect(await refusal(shaderFolder({ "notes.txt": "ideas" }))).toMatchObject({ code: "unknown_shader_file", field: "notes.txt", fix: expect.stringContaining("image.glsl, buffer-a.glsl") });
    expect(await refusal(shaderFolder({ "sky.jpg": noise }))).toMatchObject({ code: "unknown_shader_file", field: "sky.jpg", message: "No channel in channels.json reads sky.jpg." });
    expect(await refusal(shaderFolder({ "channels.json": "{ image: [] }" }))).toMatchObject({ code: "bad_channels_file", field: "channels.json" });
    expect(await refusal(shaderFolder({ "channels.json": JSON.stringify({ ...channels, imagee: [] }) }))).toMatchObject({ code: "unknown_field", field: "channels.json: imagee" });
    expect(await refusal(shaderFolder({ "channels.json": JSON.stringify({ ...channels, "buffer-b": [] }) }))).toMatchObject({ code: "bad_channels_file", field: "channels.json: buffer-b", message: expect.stringContaining("no buffer-b.glsl") });
    const imageIdChannel = { image: [{ channel_index: 1, input_kind: "texture", image_id: "image_8f3k2m9q1x7c4v6b" }] };
    expect(await refusal(shaderFolder({ "channels.json": JSON.stringify(imageIdChannel), "noise.png": null }))).toMatchObject({ code: "unknown_field", field: "channels.json: image[0].image_id", fix: expect.stringContaining("texture_file") });
    expect(await refusal(shaderFolder({ "channels.json": JSON.stringify({ image: [{ channel_index: 0, input_kind: "buffer", buffer_name: "c" }] }), "noise.png": null }))).toMatchObject({ code: "bad_shader_channel", field: "channels.json: image[0].buffer_name" });
    expect(await refusal(shaderFolder({ "channels.json": JSON.stringify({ image: [{ channel_index: 4, input_kind: "buffer", buffer_name: "a" }] }), "noise.png": null }))).toMatchObject({ code: "bad_shader_channel", field: "channels.json: image[0].channel_index" });
    expect(await refusal(shaderFolder({ "noise.png": Buffer.from("not a picture") }))).toMatchObject({ code: "not_an_image", field: "noise.png" });
    expect(await refusal(shaderFolder({ "buffer-a.glsl": "x".repeat(SHADER_LIMITS.maximumPassSizeBytes + 1) }))).toMatchObject({ code: "shader_too_big", field: "buffer-a.glsl" });
    // The command line is closed too: the screen is a choice, and a game's folder takes neither --screen nor --draw-on-zaisma.
    expect(await refusal(shaderFolder(), ["shader", shaderFolder(), "--game", "sky-hopper"])).toMatchObject({ code: "missing_field", field: "--screen" });
    expect(await refusal(shaderFolder(), ["shader", shaderFolder(), "--game", "sky-hopper", "--screen", "tall"])).toMatchObject({ code: "bad_screen", field: "--screen" });
    expect(await refusal(shaderFolder(), ["check", mkdtempSync(join(tmpdir(), "zaisma-game-")), "--screen", "phone"])).toMatchObject({ code: "unknown_field", field: "--screen" });
    expect(await refusal(shaderFolder(), ["check", shaderFolder(), "--draw-on-zaisma"])).toMatchObject({ code: "missing_field", field: "--game" });
    expect(calls).toEqual([]);
  });

  it("shader sends the texture, then the shader with the texture's image, and prints the answers as they are", async () => {
    answers["GET /games/sky-hopper"] = { status: 200, body: { game, images: [] } };
    const added = { image: textureImage("image_n0153texture1"), review_message: "It's ready.", next_steps: [] };
    answers["POST /games/sky-hopper/images"] = { status: 201, body: added };
    answers["POST /games/sky-hopper/shaders"] = { status: 201, body: shaderAnswer };
    const result = await zaisma(["shader", shaderFolder(), "--game", "sky-hopper", "--screen", "wide", "--json"]);
    expect(result.exitCode).toBe(0);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(["GET /games/sky-hopper", "POST /games/sky-hopper/images?kind=shader_texture", "POST /games/sky-hopper/shaders"]);
    expect(calls[1]!.body).toBe(noise.length);
    expect(calls[2]!.body).toEqual(sentShader("image_n0153texture1"));
    expect(json(result.stdout)).toEqual({ texture_images: [{ texture_file: "noise.png", image_id: "image_n0153texture1", added_image: added }], added_shader: shaderAnswer });
    expect(result.stderr).toContain("Sending noise.png");
  });

  it("shader uses a texture the game has already, byte for byte, and waits for one a person approves", async () => {
    answers["GET /games/sky-hopper"] = { status: 200, body: { game, images: [textureImage("image_other0texture"), textureImage("image_same0texture")] } };
    answers["GET /img/image_other0texture"] = { status: 200, body: new Uint8Array(Buffer.alloc(noise.length, 7)) };
    answers["GET /img/image_same0texture"] = { status: 200, body: new Uint8Array(noise) };
    answers["POST /games/sky-hopper/shaders"] = { status: 201, body: shaderAnswer };
    const reused = await zaisma(["shader", shaderFolder(), "--game", "sky-hopper", "--screen", "wide"]);
    expect(reused.exitCode).toBe(0);
    expect(calls.some((call) => call.path.startsWith("/games/sky-hopper/images"))).toBe(false);
    expect(calls.find((call) => call.path === "/games/sky-hopper/shaders")!.body).toEqual(sentShader("image_same0texture"));
    expect(reused.stdout).toContain("Sent shader_8f3k2m9q1x7c4v6b for wide: pending.");

    calls = [];
    // Not there to use again, then sent and waiting for a person, then approved.
    let checkCount = 0;
    answers["GET /games/sky-hopper"] = () => {
      checkCount++;
      return { status: 200, body: { game, images: checkCount === 1 ? [] : [textureImage("image_waiting0texture", checkCount === 2 ? "pending" : "approved")] } };
    };
    answers["POST /games/sky-hopper/images"] = { status: 201, body: { image: textureImage("image_waiting0texture", "pending"), review_message: "A person looks.", next_steps: [] } };
    const waited = await zaisma(["shader", shaderFolder(), "--game", "sky-hopper", "--screen", "wide", "--json"]);
    expect(waited.exitCode).toBe(0);
    expect(calls.find((call) => call.path === "/games/sky-hopper/shaders")!.body).toEqual(sentShader("image_waiting0texture"));

    answers["GET /games/sky-hopper"] = { status: 200, body: { game, images: [textureImage("image_waiting0texture", "pending")] } };
    const stillWaiting = await zaisma(["shader", shaderFolder(), "--game", "sky-hopper", "--screen", "wide", "--json"]);
    expect(stillWaiting.exitCode).toBe(1);
    expect(json(stillWaiting.stdout).error).toMatchObject({ code: "shader_texture_not_approved", field: "noise.png" });
  });

  it("check draws a shader's folder on Zaisma with --draw-on-zaisma, saves the sheet beside it and ends with 6 when it wouldn't pass", async () => {
    answers["GET /games/sky-hopper"] = { status: 200, body: { game, images: [textureImage("image_same0texture")] } };
    answers["GET /img/image_same0texture"] = { status: 200, body: new Uint8Array(noise) };
    answers["GET /shader-checks/sheet.png"] = { status: 200, body: new Uint8Array(Buffer.from("the sheet")) };
    const shaderCheck = { compile_error: null, quality_checks: [{ quality_level: 0, check_frame_ms: 21.4, maximum_check_frame_ms: 75 }], flash_count: 0, is_glass_smoked: true, glass_tint_pct: 74, notes: [{ code: "forces_thick_glass", message: "Words over it need smoked glass tinted 74%.", fix: "Keep its contrast gentler." }], sheet_url: `${API}/shader-checks/sheet.png`, sheet_expires_at: "2026-10-24T09:00:00Z" };
    answers["POST /games/sky-hopper/shader-checks"] = { status: 200, body: { shader_check: shaderCheck, remaining_shader_check_count: 99, next_steps: [] } };
    const folder = shaderFolder();
    const result = await zaisma(["check", folder, "--game", "sky-hopper", "--screen", "wide", "--draw-on-zaisma", "--json"]);
    expect(result.exitCode).toBe(0);
    expect(calls.find((call) => call.path === "/games/sky-hopper/shader-checks")!.body).toEqual(sentShader("image_same0texture"));
    const sheetFile = `${folder}-wide-check.png`;
    expect(json(result.stdout)).toEqual({ renderer_kind: "zaisma", shader_check: shaderCheck, remaining_shader_check_count: 99, sheet_file: expect.stringMatching(/-wide-check\.png$/), texture_images: [{ texture_file: "noise.png", image_id: "image_same0texture", added_image: null }] });
    expect(readFileSync(sheetFile, "utf8")).toBe("the sheet");

    const slow = { ...shaderCheck, quality_checks: [{ quality_level: 0, check_frame_ms: 120, maximum_check_frame_ms: 75 }], notes: [] };
    answers["POST /games/sky-hopper/shader-checks"] = { status: 200, body: { shader_check: slow, remaining_shader_check_count: 98, next_steps: [] } };
    const tooSlow = await zaisma(["check", folder, "--game", "sky-hopper", "--draw-on-zaisma"]);
    expect(tooSlow.exitCode).toBe(6);
    expect(tooSlow.stdout).toContain("A frame: 120 ms in the check; the most is 75. Too slow [shader_too_slow]");
    expect(tooSlow.stdout).toContain("Drawn for wide on Zaisma (98 checks left today).");
    expect(tooSlow.stdout).toContain("Fix what's above, then check again.");
  });

  const chromePath = findChrome([join(ROOT, ".wrangler/chrome"), join(ROOT, "chrome")]);
  it.skipIf(!chromePath || typeof WebSocket !== "function")(
    "check draws a shader's folder in a local Chrome with the check's own page: buffers, textures, timings, glass and the sheet",
    async () => {
      const folder = shaderFolder();
      const result = await zaisma(["check", folder, "--screen", "phone", "--json"], { key: "", environment: { CHROME_PATH: chromePath! } });
      expect(result.exitCode).toBe(0);
      const answer = json(result.stdout);
      expect(answer).toMatchObject({ renderer_kind: "local_chrome", remaining_shader_check_count: null, texture_images: [], shader_check: { compile_error: null, sheet_url: null, flash_count: 0 } });
      expect(answer.shader_check.quality_checks).toEqual([{ quality_level: 0, check_frame_ms: expect.any(Number), maximum_check_frame_ms: 75 }]);
      expect(typeof answer.shader_check.is_glass_smoked).toBe("boolean");
      expect(readFileSync(`${folder}-phone-check.png`).subarray(1, 4).toString()).toBe("PNG");

      const broken = await zaisma(["check", shaderFolder({ "buffer-a.glsl": BUFFER_PASS.replace("0.97", "fade") }), "--json"], { key: "", environment: { CHROME_PATH: chromePath! } });
      expect(broken.exitCode).toBe(6);
      expect(json(broken.stdout).shader_check.compile_error).toMatch(/^It didn't compile: buffer a: .*fade/);
      expect(calls).toEqual([]);
    },
    120_000,
  );
});
