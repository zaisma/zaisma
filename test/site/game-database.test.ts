import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { GAME_DATABASE_FREE_LIMITS, createAccount, createApiKey, nextMonthStartDate } from "@zaisma/core";
import { TOOLS } from "../../apps/site/src/mcp.ts";
import { DATABASE, STATEMENT_RESULT } from "../../apps/site/src/schemas.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";

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
  await createAccount(env.DB, { id: "dev-1", name: "Pixel Smith", ageBand: "18+" });
  await createAccount(env.DB, { id: "dev-2", name: "Other Dev", ageBand: "18+" });
  token = (await createApiKey(env.DB, "dev-1", "claude")).token;
  other = (await createApiKey(env.DB, "dev-2", "claude")).token;
  // A new game each time, so a new database: game IDs are random.
  expect((await api("/games", { body: { title: "Sky Hopper" } })).status).toBe(201);
});

describe("the game database through the API and MCP", () => {
  it("starts empty, with this month's use against the free limits", async () => {
    const overview = await tool("get_database", { slug: "sky-hopper" });
    expect(schemaProblems(DATABASE, overview)).toEqual([]);
    expect(overview).toEqual({
      tables: [],
      indexes: [],
      database_use_this_month: {
        read_row_count: expect.any(Number),
        written_row_count: 0,
        storage_size_bytes: expect.any(Number),
        free_read_row_count: GAME_DATABASE_FREE_LIMITS.readRowCountPerMonth,
        free_written_row_count: GAME_DATABASE_FREE_LIMITS.writtenRowCountPerMonth,
        free_storage_size_bytes: GAME_DATABASE_FREE_LIMITS.storageSizeBytes,
        has_reached_free_reads: false,
        has_reached_free_writes: false,
        has_reached_free_storage: false,
        reset_date: nextMonthStartDate(),
      },
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
