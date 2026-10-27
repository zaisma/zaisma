import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createAccount, createApiKey, recordPlayerErased } from "@zaisma/core";
import { TOOLS } from "../../apps/site/src/mcp.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";
import { letPublish } from "../helpers.ts";

// A restore of a game's database when something goes wrong around it (apps/site/src/game-database.ts): the real
// database code, reached through the GAME_DATABASES service binding (vitest.config.ts). Apart from game-database.test.ts,
// which exhausts the API's per-minute limits.

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

describe("restoring the game database when things go wrong", () => {
  const HOUR_MS = 3_600_000;
  const DAY_MS = 24 * HOUR_MS;
  const restoredBookmarks = (): Promise<string[]> => (env as any).GAME_DATABASES.takeRestoredBookmarks();
  const isoMinute = (atMs: number) => `${new Date(atMs).toISOString().slice(0, 16)}:00Z`;

  beforeEach(async () => {
    await env.DB.prepare("UPDATE games SET created_at_ms = ? WHERE slug = 'sky-hopper'").bind(Date.now() - 2 * DAY_MS).run();
    await env.DB.exec("DELETE FROM database_restores; DELETE FROM player_erases; DELETE FROM security_events;");
    await restoredBookmarks();
  });

  it("works again after a restore to a moment the game's hosting was paused, changes nothing when D1 can't keep the restore, and queues an erase it can't repeat", async () => {
    await tool("batch_database", { slug: "sky-hopper", statements: [{ sql: "CREATE TABLE scores (player_id TEXT, best_score INTEGER)" }, { sql: "INSERT INTO scores VALUES ('player_mia', 1)" }] });
    // A restore to a moment the game's hosting was paused works again once hosting runs.
    // The restore brings back the pause the moment had, two hours ago; hosting runs now.
    await (env as any).GAME_DATABASES.bringBackPauseOnRestore(Date.now() - 2 * HOUR_MS);
    try {
      await tool("restore_database", { slug: "sky-hopper", restore_to_at: isoMinute(Date.now() - HOUR_MS) });
      expect((await tool("query_database", { slug: "sky-hopper", sql: "SELECT best_score FROM scores" })).rows).toEqual([{ best_score: 1 }]);
    } finally {
      await (env as any).GAME_DATABASES.bringBackPauseOnRestore(null);
    }
    // D1 can't keep the restore's record: nothing changes, and it goes back to the time once D1 can.
    await restoredBookmarks();
    await env.DB.exec("DELETE FROM database_restores");
    const before = (await tool("get_database", { slug: "sky-hopper" })).database_use_this_month.written_row_count;
    const restoreToAt = isoMinute(Date.now() - HOUR_MS);
    await env.DB.exec("CREATE TRIGGER refuse_restore_record BEFORE INSERT ON database_restores BEGIN SELECT RAISE(ABORT, 'D1 is down'); END");
    try {
      const refused = await api("/games/sky-hopper/database/restores", { body: { restore_to_at: restoreToAt } });
      expect(refused.status).toBe(503);
      expect(refused.answer.error).toMatchObject({ code: "database_unavailable", message: expect.stringContaining("as it was"), fix: expect.any(String) });
    } finally {
      await env.DB.exec("DROP TRIGGER refuse_restore_record");
    }
    // The restore was set and then pointed back at the present: nothing is left waiting for the object's next start.
    const bookmarks = await restoredBookmarks();
    expect(bookmarks).toEqual([`bookmark-${Date.parse(restoreToAt)}`, expect.stringMatching(/^undo-\d+$/)]);
    expect((await tool("query_database", { slug: "sky-hopper", sql: "SELECT best_score FROM scores" })).rows).toEqual([{ best_score: 1 }]);
    expect((await tool("get_database", { slug: "sky-hopper" })).database_use_this_month.written_row_count).toBeGreaterThanOrEqual(before);
    expect(await env.DB.prepare("SELECT count(*) AS restore_count FROM database_restores").first("restore_count")).toBe(0);
    // Once D1 answers, it goes back.
    const restored = await tool("restore_database", { slug: "sky-hopper", restore_to_at: restoreToAt });
    expect(restored.database_restore.id).toMatch(/^database_restore_/);
    expect((await restoredBookmarks())[0]).toBe(`bookmark-${Date.parse(restoreToAt)}`);
    // A player it can't erase again goes back to the erase queue instead of failing the restore.
    await tool("batch_database", {
      slug: "sky-hopper",
      statements: [
        { sql: "CREATE TABLE players (player_id TEXT PRIMARY KEY)" },
        { sql: "CREATE TABLE trophies (owner TEXT REFERENCES players (player_id))" },
        { sql: "INSERT INTO players VALUES ('player_mia')" },
        { sql: "INSERT INTO trophies VALUES ('player_mia')" },
      ],
    });
    const gameId = (await env.DB.prepare("SELECT id FROM games WHERE slug = 'sky-hopper'").first<string>("id"))!;
    await recordPlayerErased(env.DB, gameId, "player_mia", Date.now());
    // The foreign key refuses the erase, so it goes back to the queue, tried again on the webhook schedule.
    const restoredAgain = await tool("restore_database", { slug: "sky-hopper", restore_to_at: isoMinute(Date.now() - HOUR_MS) });
    expect(restoredAgain.erased_again_player_count).toBe(0);
    expect(await env.DB.prepare("SELECT erase_status FROM player_erases WHERE game_id = ? AND player_id = 'player_mia'").bind(gameId).first("erase_status")).toBe("pending");
  });

});
