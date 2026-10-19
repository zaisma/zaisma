import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { VISIBILITIES } from "../../packages/core/src/developers.ts";
import { ERROR_CODES } from "../../packages/core/src/errors.ts";
import { FORUM_CATEGORIES, TOPIC_KINDS } from "../../packages/core/src/forum.ts";
import { dumpPart, importStatements, scanStatements } from "../../packages/game-server/src/index.ts";
import { dumpParts, nodeRead, trickyDatabase } from "./dump-fixtures.ts";

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
    expect(help.commands.map((entry) => entry.command)).toEqual(["games", "new", "check", "upload", "versions", "publish", "unschedule", "visibility", "allowed-hosts", "own-servers", "links", "links set", "links remove", "secrets", "secrets set", "secrets delete", "forum", "forum post", "forum message", "forum reply", "database", "database query", "database batch", "database export", "database import", "database restore", "database undo-restore", "saves", "saves get", "saves change", "saves replace", "saves reset", "saves copies", "saves copy", "saves restore", "help"]);
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
    expect(sqlite.stdout).toContain(`--database ${join(folder, "game.sqlite")}`);
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
