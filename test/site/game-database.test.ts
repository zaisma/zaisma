import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { MAXIMUM_GAME_STORAGE_SIZE_BYTES, addDatabaseRestore, createAccount, createApiKey, nextMonthStartDate } from "@zaisma/core";
import { TOOLS } from "../../apps/site/src/mcp.ts";
import { DATABASE, DATABASE_EXPORT, DATABASE_RESTORED, STATEMENT_RESULT } from "../../apps/site/src/schemas.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";
import { letPublish } from "../helpers.ts";

// A game's own database through the developer API and MCP (apps/site/src/game-database.ts): the real
// database code, reached through the GAME_DATABASES service binding (vitest.config.ts).

const SITE = "https://zaisma.test";
let token = "";
let other = "";
let nextId = 1;

/** Call the developer API; every refusal must have the error's shape, a listed code and that code's HTTP status. */
async function api(path: string, init: { method?: string; body?: unknown; key?: string } = {}) {
  const res = await SELF.fetch(`${SITE}/api/dev${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { authorization: `Bearer ${init.key ?? token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const answer = (await res.json()) as any;
  if (!res.ok) expect(errorProblems(answer, res.status)).toEqual([]);
  return { status: res.status, answer };
}

/** Call an MCP tool: its answer, checked against the tool's output schema, or { error } with the error's fields. */
async function tool(name: string, toolArguments: Record<string, unknown>): Promise<any> {
  const res = await SELF.fetch(`${SITE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: toolArguments } }),
  });
  const { result } = (await res.json()) as any;
  if (result.isError) {
    expect(errorProblems(result.structuredContent)).toEqual([]);
    return result.structuredContent;
  }
  expect(schemaProblems(TOOLS.find((candidate) => candidate.name === name)!.outputSchema!, result.structuredContent, name)).toEqual([]);
  return result.structuredContent;
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;");
  await createAccount(env.DB, { id: "dev-1", username: "Pixel_Smith", ageBand: "18+" });
  await letPublish(env.DB, "dev-1");
  await createAccount(env.DB, { id: "dev-2", username: "Other_Dev", ageBand: "18+" });
  await letPublish(env.DB, "dev-2");
  token = (await createApiKey(env.DB, "dev-1", "claude")).token;
  other = (await createApiKey(env.DB, "dev-2", "claude")).token;
  // A new game each time, so a new database: game IDs are random.
  expect((await api("/games", { body: { title: "Sky Hopper" } })).status).toBe(201);
});

describe("the game database through the API and MCP", () => {
  it("starts empty, with this month's use on the game's hosting meter", async () => {
    const overview = await tool("get_database", { slug: "sky-hopper" });
    expect(schemaProblems(DATABASE, overview)).toEqual([]);
    expect(overview).toEqual({
      tables: [],
      indexes: [],
      database_use_this_month: {
        read_row_count: expect.any(Number),
        written_row_count: 0,
        storage_size_bytes: expect.any(Number),
        maximum_storage_size_bytes: MAXIMUM_GAME_STORAGE_SIZE_BYTES,
      },
      hosting_use_this_month: expect.objectContaining({ free_used_pct: 0, is_paused: false, paused_reason: null, resets_on_date: nextMonthStartDate(), monthly_budget_cents: null, spent_from_credit_cents: 0 }),
      restores: [],
    });
  });

  it("runs SQL with values, answers rows and what each statement read and wrote, and lists tables and indexes", async () => {
    expect(await tool("query_database", { slug: "sky-hopper", sql: "CREATE TABLE scores (player_id TEXT PRIMARY KEY, best_score INTEGER NOT NULL, replay BLOB)" })).toMatchObject({ rows: [], next_steps: [] });
    await tool("query_database", { slug: "sky-hopper", sql: "CREATE INDEX scores_by_best_score ON scores (best_score)" });
    const inserted = await tool("query_database", { slug: "sky-hopper", sql: "INSERT INTO scores VALUES (?, ?, ?), (?, ?, NULL) RETURNING player_id", values: ["player_a", 1200, { blob_base64: "AAEC/w==" }, "player_b", 900] });
    expect(inserted.rows).toEqual([{ player_id: "player_a" }, { player_id: "player_b" }]);
    expect(inserted.written_row_count).toBeGreaterThanOrEqual(2);

    const selected = await tool("query_database", { slug: "sky-hopper", sql: "SELECT player_id, best_score, replay FROM scores ORDER BY best_score DESC" });
    expect(selected.rows).toEqual([
      { player_id: "player_a", best_score: 1200, replay: { blob_base64: "AAEC/w==" } },
      { player_id: "player_b", best_score: 900, replay: null },
    ]);
    expect(selected.read_row_count).toBeGreaterThanOrEqual(2);
    expect(selected.written_row_count).toBe(0);

    const overview = await tool("get_database", { slug: "sky-hopper" });
    expect(overview.tables).toEqual([{ name: "scores", sql: "CREATE TABLE scores (player_id TEXT PRIMARY KEY, best_score INTEGER NOT NULL, replay BLOB)" }]);
    // SQLite's own index for the primary key has no SQL, so only the one made with CREATE INDEX shows.
    expect(overview.indexes).toEqual([{ name: "scores_by_best_score", table_name: "scores", sql: "CREATE INDEX scores_by_best_score ON scores (best_score)" }]);
    expect(overview.database_use_this_month.written_row_count).toBeGreaterThanOrEqual(2);
  });

  it("runs a batch in one transaction: all of it, or, when one statement fails, none", async () => {
    await tool("query_database", { slug: "sky-hopper", sql: "CREATE TABLE inventories (player_id TEXT, item TEXT, item_count INTEGER, PRIMARY KEY (player_id, item))" });
    const moved = await tool("batch_database", {
      slug: "sky-hopper",
      statements: [
        { sql: "INSERT INTO inventories VALUES (?, ?, 1)", values: ["player_a", "golden_wing"] },
        { sql: "SELECT item_count FROM inventories WHERE player_id = ?", values: ["player_a"] },
      ],
    });
    expect(moved.statement_results.map((result: any) => result.rows)).toEqual([[], [{ item_count: 1 }]]);
    for (const result of moved.statement_results) expect(schemaProblems(STATEMENT_RESULT, result)).toEqual([]);

    const failed = await tool("batch_database", { slug: "sky-hopper", statements: [{ sql: "DELETE FROM inventories" }, { sql: "INSERT INTO missing VALUES (1)" }] });
    expect(failed.error).toMatchObject({ code: "bad_sql", field: "statements", message: expect.stringContaining("no such table: missing") });
    expect((await tool("query_database", { slug: "sky-hopper", sql: "SELECT count(*) AS item_count FROM inventories" })).rows).toEqual([{ item_count: 1 }]);
  });

  it("refuses what the database doesn't take, saying which input and how to fix it", async () => {
    const refusal = async (body: unknown, path = "query") => (await api(`/games/sky-hopper/database/${path}`, { body })).answer.error;
    expect(await refusal({ sql: "SELECT 1; SELECT 2" })).toMatchObject({ code: "bad_sql", field: "sql", fix: expect.stringContaining("batch_database") });
    expect(await refusal({ sql: "BEGIN" })).toMatchObject({ code: "bad_sql", field: "sql" });
    expect(await refusal({ values: [] })).toMatchObject({ code: "missing_field", field: "sql" });
    expect(await refusal({ sql: "SELECT ?", values: [true] })).toMatchObject({ code: "bad_values", field: "values[0]", fix: "Give 1 for true and 0 for false." });
    expect(await refusal({ sql: "SELECT ?", values: [{ level: 3 }] })).toMatchObject({ code: "bad_values", field: "values[0]" });
    expect(await refusal({ sql: "SELECT ?", values: [{ blob_base64: "not base64!" }] })).toMatchObject({ code: "bad_values", field: "values[0]" });
    expect(await refusal({ sql: "SELECT 1", limit: 5 })).toMatchObject({ code: "unknown_field", field: "limit" });
    expect(await refusal({ statements: ["SELECT 1"] }, "batch")).toMatchObject({ code: "bad_sql", field: "statements" });
    expect(await refusal({ statements: [{ sql: "SELECT ?", values: [false] }] }, "batch")).toMatchObject({ code: "bad_values", field: "statements[0].values[0]" });
    expect(await refusal({ statements: [] }, "batch")).toMatchObject({ code: "bad_sql", field: "statements" });

    const tooMany = await refusal({ sql: "WITH RECURSIVE counter(number) AS (SELECT 1 UNION ALL SELECT number + 1 FROM counter WHERE number < 10001) SELECT number FROM counter" });
    expect(tooMany).toMatchObject({ code: "too_many_rows", field: null });
    const tooBig = await refusal({ sql: "WITH RECURSIVE counter(number) AS (SELECT 1 UNION ALL SELECT number + 1 FROM counter WHERE number < 9) SELECT zeroblob(1000000) AS padding FROM counter" });
    expect(tooBig).toMatchObject({ code: "answer_too_big" });

    expect((await api("/games/sky-hopper/database/query")).answer.error.code).toBe("bad_method");
  });

  it("is only the game's developer's", async () => {
    const refused = await api("/games/sky-hopper/database/query", { body: { sql: "SELECT 1" }, key: other });
    expect(refused.answer.error).toMatchObject({ code: "no_game", field: "slug" });
    expect((await api("/games/sky-hopper/database", { key: other })).answer.error.code).toBe("no_game");
  });
});

/** The whole database through export_database, part by part, and how many parts it took. */
async function exportAll(slugText: string): Promise<{ dumpSql: string; parts: string[] }> {
  const parts: string[] = [];
  let cursor: string | null = null;
  do {
    const part: any = await tool("export_database", { slug: slugText, ...(cursor ? { cursor } : {}) });
    expect(schemaProblems(DATABASE_EXPORT, part)).toEqual([]);
    parts.push(part.dump_sql);
    cursor = part.next_cursor;
  } while (cursor);
  return { dumpSql: parts.join(""), parts };
}

const rowsOf = async (slugText: string, sql: string) => (await tool("query_database", { slug: slugText, sql })).rows;

describe("the game database's import and export", () => {
  it("exports SQLite's own dump, and imports it into another game's database as it was", async () => {
    await tool("batch_database", {
      slug: "sky-hopper",
      statements: [
        { sql: "CREATE TABLE players (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, speed REAL, replay BLOB, name_length INTEGER GENERATED ALWAYS AS (length(name)))" },
        { sql: "CREATE TABLE inventories (player_id INTEGER, item TEXT, item_count INTEGER, PRIMARY KEY (player_id, item)) WITHOUT ROWID" },
        { sql: "CREATE TABLE \"odd \"\"name\"\"\" (note TEXT)" },
        { sql: "INSERT INTO players (name, speed, replay) VALUES (?, 2.0, ?), (?, NULL, NULL), ('gone', 1, NULL)", values: ["it's\nme; really", { blob_base64: "AAEC/w==" }, "Ünïcode 🎮"] },
        { sql: "DELETE FROM players WHERE name = 'gone'" },
        { sql: "INSERT INTO inventories VALUES (1, 'golden_wing', 2), (2, 'boots', 1)" },
        { sql: "INSERT INTO \"odd \"\"name\"\"\" VALUES ('ok')" },
        { sql: "CREATE INDEX players_by_speed ON players (speed)" },
        { sql: "CREATE VIEW fast_players AS SELECT name FROM players WHERE speed > 1" },
        { sql: "CREATE TRIGGER count_items AFTER INSERT ON inventories BEGIN UPDATE players SET speed = coalesce(speed, 0) + 1 WHERE id = NEW.player_id; END" },
      ],
    });

    const { dumpSql, parts } = await exportAll("sky-hopper");
    expect(parts).toHaveLength(1);
    expect(dumpSql.startsWith("PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\nCREATE TABLE players")).toBe(true);
    expect(dumpSql).toContain(`INSERT INTO "players"("id","name","speed","replay") VALUES(1,'it''s\nme; really',2.0,X'000102FF');`);
    expect(dumpSql).toContain("INSERT INTO sqlite_sequence VALUES('players',3);");
    expect(dumpSql.endsWith("CREATE TRIGGER count_items AFTER INSERT ON inventories BEGIN UPDATE players SET speed = coalesce(speed, 0) + 1 WHERE id = NEW.player_id; END;\nCOMMIT;\n")).toBe(true);
    // The trigger comes after the rows, so it doesn't fire on them.
    expect(dumpSql.indexOf("CREATE TRIGGER")).toBeGreaterThan(dumpSql.indexOf("INSERT INTO \"inventories\""));

    expect((await api("/games", { body: { title: "Moon Hopper" } })).status).toBe(201);
    const imported = await tool("import_database", { slug: "moon-hopper", dump_sql: dumpSql });
    expect(imported).toMatchObject({ skipped_statement_count: 4, next_steps: [{ tool: "get_database", arguments: { slug: "moon-hopper" } }] });
    expect(imported.written_row_count).toBeGreaterThan(0);

    for (const sql of ["SELECT * FROM players ORDER BY id", "SELECT * FROM inventories ORDER BY player_id", 'SELECT * FROM "odd ""name"""', "SELECT * FROM fast_players", "SELECT * FROM sqlite_sequence", "SELECT type, name, sql FROM sqlite_schema WHERE substr(name, 1, 4) <> '_cf_' ORDER BY name"]) {
      expect(await rowsOf("moon-hopper", sql)).toEqual(await rowsOf("sky-hopper", sql));
    }
    expect((await rowsOf("moon-hopper", "SELECT replay, typeof(speed) AS speed_type FROM players WHERE id = 1"))[0]).toEqual({ replay: { blob_base64: "AAEC/w==" }, speed_type: "real" });
    // And the new database's export is the same dump.
    expect((await exportAll("moon-hopper")).dumpSql).toBe(dumpSql);
  });

  // Four megabytes in and out of a database: a busy runner takes past the default 5 seconds.
  it("exports up to 4 MB a part, at whole rows, and each part imports on its own", async () => {
    await tool("query_database", { slug: "sky-hopper", sql: "CREATE TABLE replays (replay_id INTEGER PRIMARY KEY, replay BLOB)" });
    const megabyte = btoa("\u0007".repeat(1_000_000));
    for (let i = 0; i < 5; i++) await tool("query_database", { slug: "sky-hopper", sql: "INSERT INTO replays (replay) VALUES (?)", values: [{ blob_base64: megabyte }] });
    const { parts } = await exportAll("sky-hopper");
    expect(parts.length).toBe(3);
    for (const part of parts) expect(part.endsWith(";\n")).toBe(true);

    expect((await api("/games", { body: { title: "Moon Hopper" } })).status).toBe(201);
    for (const part of parts) await tool("import_database", { slug: "moon-hopper", dump_sql: part });
    expect(await rowsOf("moon-hopper", "SELECT replay_id, length(replay) AS size_bytes FROM replays")).toEqual([1, 2, 3, 4, 5].map((replayId) => ({ replay_id: replayId, size_bytes: 1_000_000 })));
  }, 30_000);

  it("imports what sqlite3's .dump writes, unistr and all", async () => {
    const sqlite3Dump = [
      "PRAGMA foreign_keys=OFF;",
      "BEGIN TRANSACTION;",
      "CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, d BLOB, s REAL);",
      "INSERT INTO t VALUES(1,unistr('a''b\\u000ac'),x'00ff',2.0);",
      "INSERT INTO t VALUES(2,replace('x\\ny','\\n',char(10)),NULL,NULL);",
      "ANALYZE sqlite_schema;",
      "INSERT INTO sqlite_stat1 VALUES('t','ti','1 1');",
      "PRAGMA writable_schema=ON;",
      "CREATE TABLE IF NOT EXISTS sqlite_sequence(name,seq);",
      "DELETE FROM sqlite_sequence;",
      "INSERT INTO sqlite_sequence VALUES('t',9);",
      "CREATE INDEX ti ON t(name);",
      "PRAGMA writable_schema=OFF;",
      "COMMIT;",
    ].join("\n");
    const imported = await tool("import_database", { slug: "sky-hopper", dump_sql: sqlite3Dump });
    expect(imported).toMatchObject({ statement_count: 14, skipped_statement_count: 9 });
    expect(await rowsOf("sky-hopper", "SELECT id, name, d FROM t ORDER BY id")).toEqual([
      { id: 1, name: "a'b\nc", d: { blob_base64: "AP8=" } },
      { id: 2, name: "x\ny", d: null },
    ]);
    expect(await rowsOf("sky-hopper", "SELECT name, seq FROM sqlite_sequence")).toEqual([{ name: "t", seq: 9 }]);
  });

  it("only adds, all of a part or none of it, and says which statement stopped it", async () => {
    await tool("query_database", { slug: "sky-hopper", sql: "CREATE TABLE scores (player_id TEXT PRIMARY KEY, best_score INTEGER)" });
    const refusal = async (dumpSql: unknown) => (await api("/games/sky-hopper/database/import", { body: { dump_sql: dumpSql } })).answer.error;

    const exists = await refusal("CREATE TABLE extra (note TEXT);\nINSERT INTO extra VALUES('kept?');\nCREATE TABLE scores (player_id TEXT);");
    expect(exists).toMatchObject({ code: "bad_sql", field: "dump_sql", message: expect.stringMatching(/^Statement 3 of the dump \(CREATE TABLE scores \(player_id TEXT\)\) failed: SQLite: .*already exists/), fix: expect.stringContaining("DROP TABLE") });
    expect(await rowsOf("sky-hopper", "SELECT name FROM sqlite_schema WHERE name = 'extra'")).toEqual([]);

    expect(await refusal("INSERT INTO scores VALUES('player_a', 1);\nUPDATE scores SET best_score = 0;")).toMatchObject({ code: "bad_sql", message: expect.stringContaining("Statement 2 of the dump (UPDATE scores SET best_score = 0): UPDATE isn't a CREATE or INSERT.") });
    expect(await refusal("INSERT OR REPLACE INTO scores VALUES('player_a', 1);")).toMatchObject({ code: "bad_sql" });
    expect(await refusal("INSERT INTO scores VALUES('player_a', 1);\nINSERT INTO scores VALUES('player_a', 2);")).toMatchObject({ code: "bad_sql", message: expect.stringContaining("Statement 2 of the dump") });
    expect(await rowsOf("sky-hopper", "SELECT count(*) AS score_count FROM scores")).toEqual([{ score_count: 0 }]);

    expect(await refusal("x".repeat(5 * 1024 * 1024 + 1))).toMatchObject({ code: "dump_too_big", field: "dump_sql" });
    expect(await refusal(42)).toMatchObject({ code: "bad_sql", field: "dump_sql" });
    expect((await api("/games/sky-hopper/database/import", { body: { sql: "CREATE TABLE a (b)" } })).answer.error).toMatchObject({ code: "unknown_field", field: "sql" });
    expect((await api("/games/sky-hopper/database/import", { body: {} })).answer.error).toMatchObject({ code: "missing_field", field: "dump_sql" });

    expect((await api("/games/sky-hopper/database/export?cursor=nonsense")).answer.error).toMatchObject({ code: "bad_cursor", field: "cursor" });
    expect((await api("/games/sky-hopper/database/export?limit=5")).answer.error).toMatchObject({ code: "unknown_field", field: "limit" });
    expect((await api("/games/sky-hopper/database/export", { key: other })).answer.error.code).toBe("no_game");
    expect((await api("/games/sky-hopper/database/import", { body: { dump_sql: "CREATE TABLE a (b);" }, key: other })).answer.error.code).toBe("no_game");
  });

  it("erases one player's rows from every table with a player_id column, the same through the API and MCP", async () => {
    await tool("batch_database", {
      slug: "sky-hopper",
      statements: [
        { sql: "CREATE TABLE scores (player_id TEXT PRIMARY KEY, best_score INTEGER NOT NULL)" },
        { sql: "CREATE TABLE matches (match_id INTEGER, winner_player_id TEXT)" },
        { sql: "CREATE TABLE inventory (player_id TEXT, item TEXT)" },
        { sql: "INSERT INTO scores VALUES ('player_mia', 10), ('player_kai', 20)" },
        { sql: "INSERT INTO matches VALUES (1, 'player_mia')" },
        { sql: "INSERT INTO inventory VALUES ('player_mia', 'sword'), ('player_mia', 'shield')" },
      ],
    });
    const erased = await api("/games/sky-hopper/database/erase-player", { body: { player_id: "player_mia" } });
    expect(erased.status).toBe(200);
    expect(schemaProblems(TOOLS.find((candidate) => candidate.name === "erase_player")!.outputSchema!, erased.answer)).toEqual([]);
    expect(erased.answer).toEqual({
      erased_tables: [
        { table_name: "inventory", erased_row_count: 2 },
        { table_name: "scores", erased_row_count: 1 },
      ],
      written_row_count: expect.any(Number),
      next_steps: [],
    });
    expect(erased.answer.written_row_count).toBeGreaterThanOrEqual(3);
    expect((await tool("query_database", { slug: "sky-hopper", sql: "SELECT winner_player_id FROM matches" })).rows).toEqual([{ winner_player_id: "player_mia" }]);
    // Any player ID, even one with no rows: every table it looked in says 0.
    expect(await tool("erase_player", { slug: "sky-hopper", player_id: "player_nobody" })).toEqual({ erased_tables: [{ table_name: "inventory", erased_row_count: 0 }, { table_name: "scores", erased_row_count: 0 }], written_row_count: 0, next_steps: [] });

    expect((await api("/games/sky-hopper/database/erase-player", { body: { player_id: "mia_plays" } })).answer.error).toMatchObject({ code: "bad_player_id", field: "player_id", fix: expect.stringContaining("account_deleted") });
    expect((await api("/games/sky-hopper/database/erase-player", { body: {} })).answer.error).toMatchObject({ code: "bad_player_id", field: "player_id" });
    const readKey = (await createApiKey(env.DB, "dev-1", "ci", { accessLevel: "read", gameSlugs: null })).token;
    expect((await api("/games/sky-hopper/database/erase-player", { body: { player_id: "player_kai" }, key: readKey })).answer.error.code).toBe("key_not_allowed");
    expect((await api("/games/sky-hopper/database/erase-player", { body: { player_id: "player_kai" }, key: other })).answer.error.code).toBe("no_game");
    expect((await tool("query_database", { slug: "sky-hopper", sql: "SELECT player_id FROM scores" })).rows).toEqual([{ player_id: "player_kai" }]);
  });
});

describe("restoring the game database to a time", () => {
  const HOUR_MS = 3_600_000;
  const DAY_MS = 24 * HOUR_MS;
  const restoredBookmarks = (): Promise<string[]> => (env as any).GAME_DATABASES.takeRestoredBookmarks();
  /** The game made two days ago, so there's time to go back to. */
  const madeDaysAgo = (dayCount: number) => env.DB.prepare("UPDATE games SET created_at_ms = ? WHERE slug = 'sky-hopper'").bind(Date.now() - dayCount * DAY_MS).run();
  const isoMinute = (atMs: number) => `${new Date(atMs).toISOString().slice(0, 16)}:00Z`;

  beforeEach(async () => {
    await madeDaysAgo(2);
    await env.DB.exec("DELETE FROM database_restores; DELETE FROM player_erases; DELETE FROM security_events;");
    await restoredBookmarks();
  });

  it("goes back to a moment, lists the restore, and can undo it, through the API and MCP", async () => {
    const restoreToAt = isoMinute(Date.now() - HOUR_MS);
    const restored = await api("/games/sky-hopper/database/restores", { body: { restore_to_at: restoreToAt } });
    expect(restored.status).toBe(200);
    expect(schemaProblems(DATABASE_RESTORED, restored.answer)).toEqual([]);
    const restore = restored.answer.database_restore;
    expect(restored.answer).toEqual({
      database_restore: { id: expect.stringMatching(/^database_restore_/), restore_to_at: new Date(restoreToAt).toISOString(), restored_at: expect.any(String), undoes_database_restore_id: null, undo_expires_at: expect.any(String) },
      erased_again_player_count: 0,
      next_steps: [
        { tool: "get_database", arguments: { slug: "sky-hopper" }, after_sec: null, reason: expect.any(String) },
        { tool: "undo_database_restore", arguments: { slug: "sky-hopper", database_restore_id: restore.id }, after_sec: null, reason: expect.any(String) },
      ],
    });
    expect(Date.parse(restore.undo_expires_at) - Date.parse(restore.restored_at)).toBeGreaterThan(29 * DAY_MS);
    expect(await restoredBookmarks()).toEqual([`bookmark-${Date.parse(restoreToAt)}`]);

    const overview = await tool("get_database", { slug: "sky-hopper" });
    expect(overview.restores).toEqual([restore]);
    const history = await api("/games/sky-hopper/history");
    expect(history.answer.events).toContainEqual(expect.objectContaining({ subject_name: restore.restore_to_at, description: "Restored the database to an earlier time" }));

    // The undo goes back to just before the restore, with the bookmark the restore kept.
    const undone = await tool("undo_database_restore", { slug: "sky-hopper", database_restore_id: restore.id });
    expect(undone.database_restore).toMatchObject({ undoes_database_restore_id: restore.id, restore_to_at: restore.restored_at });
    expect(undone.next_steps).toEqual([{ tool: "get_database", arguments: { slug: "sky-hopper" }, after_sec: null, reason: expect.any(String) }]);
    expect((await restoredBookmarks())[0]).toMatch(/^undo-\d+$/);
    expect((await tool("get_database", { slug: "sky-hopper" })).restores.map((listed: { id: string }) => listed.id)).toEqual([undone.database_restore.id, restore.id]);
    // And the database answers as before after its restarts.
    expect((await tool("query_database", { slug: "sky-hopper", sql: "SELECT 1 AS one" })).rows).toEqual([{ one: 1 }]);
  });

  it("keeps the month's use, which the restore would roll back", async () => {
    await tool("batch_database", { slug: "sky-hopper", statements: [{ sql: "CREATE TABLE scores (player_id TEXT, best_score INTEGER)" }, { sql: "INSERT INTO scores VALUES ('player_mia', 1), ('player_kai', 2), ('player_ivy', 3)" }] });
    const before = (await tool("get_database", { slug: "sky-hopper" })).database_use_this_month.written_row_count;
    expect(before).toBeGreaterThanOrEqual(3);
    await tool("restore_database", { slug: "sky-hopper", restore_to_at: isoMinute(Date.now() - HOUR_MS) });
    expect((await tool("get_database", { slug: "sky-hopper" })).database_use_this_month.written_row_count).toBe(before);
  });

  it("erases again the players erased since that moment", async () => {
    await tool("batch_database", { slug: "sky-hopper", statements: [{ sql: "CREATE TABLE scores (player_id TEXT, best_score INTEGER)" }, { sql: "INSERT INTO scores VALUES ('player_mia', 1), ('player_kai', 2)" }] });
    const restoreToAt = isoMinute(Date.now() - HOUR_MS);
    await tool("erase_player", { slug: "sky-hopper", player_id: "player_mia" });
    expect(await env.DB.prepare("SELECT erase_status FROM player_erases WHERE player_id = 'player_mia'").first("erase_status")).toBe("erased");
    // What a restore to before the erase brings back.
    await tool("query_database", { slug: "sky-hopper", sql: "INSERT INTO scores VALUES ('player_mia', 1)" });
    const restored = await tool("restore_database", { slug: "sky-hopper", restore_to_at: restoreToAt });
    expect(restored.erased_again_player_count).toBe(1);
    expect((await tool("query_database", { slug: "sky-hopper", sql: "SELECT player_id FROM scores" })).rows).toEqual([{ player_id: "player_kai" }]);
    // Erased before that moment: already gone in what it went back to.
    expect((await tool("restore_database", { slug: "sky-hopper", restore_to_at: new Date().toISOString() })).erased_again_player_count).toBe(0);
  });

  it("refuses a time it can't go back to, a restore it can't undo, a weaker key and too many restores", async () => {
    const restoreTo = (restoreToAt: unknown, key?: string) => api("/games/sky-hopper/database/restores", { body: { restore_to_at: restoreToAt }, key });
    for (const restoreToAt of ["yesterday", "2026-10-18 14:05", 1760000000, isoMinute(Date.now() + 5 * 60_000), isoMinute(Date.now() - 31 * DAY_MS)]) {
      expect((await restoreTo(restoreToAt)).answer.error).toMatchObject({ code: "bad_time", field: "restore_to_at", fix: expect.stringContaining("get_history") });
    }
    await madeDaysAgo(0);
    expect((await restoreTo(isoMinute(Date.now() - HOUR_MS))).answer.error).toMatchObject({ code: "bad_time", message: expect.stringContaining("before the game was made") });
    await madeDaysAgo(2);
    expect((await api("/games/sky-hopper/database/restores", { body: {} })).answer.error).toMatchObject({ code: "missing_field", field: "restore_to_at" });
    expect(await restoredBookmarks()).toEqual([]);

    expect((await api("/games/sky-hopper/database/restores/database_restore_nothing/undo", { method: "POST" })).answer.error).toMatchObject({ code: "no_database_restore", field: "database_restore_id" });
    const readKey = (await createApiKey(env.DB, "dev-1", "ci", { accessLevel: "read", gameSlugs: null })).token;
    expect((await restoreTo(isoMinute(Date.now() - HOUR_MS), readKey)).answer.error.code).toBe("key_not_allowed");
    expect((await restoreTo(isoMinute(Date.now() - HOUR_MS), other)).answer.error.code).toBe("no_game");

    // Another game's restore can't be undone from this one.
    expect((await api("/games", { body: { title: "Tower Climb" } })).status).toBe(201);
    const towerGameId = await env.DB.prepare("SELECT id FROM games WHERE slug = 'tower-climb'").first<string>("id");
    await addDatabaseRestore(env.DB, { id: "database_restore_tower", game_id: towerGameId!, restore_to_at_ms: Date.now() - HOUR_MS, undo_bookmark: "undo-tower", undoes_database_restore_id: null, restored_at_ms: Date.now() });
    expect((await api("/games/sky-hopper/database/restores/database_restore_tower/undo", { method: "POST" })).answer.error.code).toBe("no_database_restore");

    // Up to 5 restores and undos a minute per game (the local stand-in for rate limits may count other tests' restores too).
    let refused: any = null;
    for (let i = 0; i < 6 && !refused; i++) {
      const answered = await restoreTo(isoMinute(Date.now() - HOUR_MS));
      if (answered.status !== 200) refused = answered.answer.error;
    }
    expect(refused).toMatchObject({ code: "slow_down", retry_after_sec: 60 });
  });
});
