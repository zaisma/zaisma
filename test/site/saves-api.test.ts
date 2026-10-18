import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { accountById, bumpSave, canonicalSave, createAccount, createApiKey, gameBySlug, saveHash, saveKey, type SaveData } from "@zaisma/core";
import { TOOLS } from "../../apps/site/src/mcp.ts";
import { SAVE, SAVE_CHANGED, SAVE_COPY, SAVE_COPY_LIST, SAVE_LIST } from "../../apps/site/src/schemas.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";
import { letPublish } from "../helpers.ts";

// A game's cloud saves through the developer API and MCP (apps/site/src/saves-api.ts): players' saves
// by player ID, changed with a copy kept first, apart from the game database.

const SITE = "https://zaisma.test";
let token = "";
let other = "";
let nextId = 1;
let gameId = "";
let fox = { accountId: "player-fox", playerId: "" };
let owl = { accountId: "player-owl", playerId: "" };

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

/** The player's game saving, as the game page's PUT /api/saves does: the next version, stored in R2. */
async function playerSaves(player: { accountId: string }, saveData: SaveData) {
  const text = canonicalSave(saveData);
  const row = await env.DB.prepare("SELECT version_number FROM saves WHERE account_id = ? AND game_id = ?").bind(player.accountId, gameId).first<{ version_number: number }>();
  const versionNumber = await bumpSave(env.DB, { accountId: player.accountId, gameId, baseVersionNumber: row?.version_number ?? 0, sha256: await saveHash(text), sizeBytes: new TextEncoder().encode(text).length, changedByKind: "player" });
  expect(versionNumber).not.toBeNull();
  await env.SAVES.put(saveKey(player.accountId, gameId), text);
}

const stored = async (player: { accountId: string }) => JSON.parse((await (await env.SAVES.get(saveKey(player.accountId, gameId)))!.text()));
const copyReasons = async () => (await env.DB.prepare("SELECT copy_reason FROM save_history ORDER BY saved_at_ms DESC, rowid DESC").all<{ copy_reason: string }>()).results.map((row) => row.copy_reason);

beforeEach(async () => {
  await env.DB.exec("DELETE FROM api_keys; DELETE FROM save_history; DELETE FROM saves; DELETE FROM audit_log; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;");
  await createAccount(env.DB, { id: "dev-1", username: "Pixel_Smith", ageBand: "18+" });
  await letPublish(env.DB, "dev-1");
  await createAccount(env.DB, { id: "dev-2", username: "Other_Dev", ageBand: "18+" });
  await letPublish(env.DB, "dev-2");
  await createAccount(env.DB, { id: fox.accountId, username: "Fox", ageBand: "18+" });
  await letPublish(env.DB, fox.accountId);
  await createAccount(env.DB, { id: owl.accountId, username: "Owl", ageBand: "16-17" });
  await letPublish(env.DB, owl.accountId);
  fox = { ...fox, playerId: (await accountById(env.DB, fox.accountId))!.player_id };
  owl = { ...owl, playerId: (await accountById(env.DB, owl.accountId))!.player_id };
  token = (await createApiKey(env.DB, "dev-1", "claude")).token;
  other = (await createApiKey(env.DB, "dev-2", "claude")).token;
  expect((await api("/games", { body: { title: "Sky Hopper" } })).status).toBe(201);
  gameId = (await gameBySlug(env.DB, "sky-hopper"))!.id;
});

describe("reading saves", () => {
  it("lists the players with a save, by player ID, a page at a time", async () => {
    expect(await tool("list_saves", { slug: "sky-hopper" })).toEqual({ saves: [], next_cursor: null });
    await playerSaves(fox, { coins: "120" });
    await playerSaves(owl, { coins: "5" });
    await playerSaves(owl, { coins: "6" });
    const listed = await tool("list_saves", { slug: "sky-hopper" });
    expect(schemaProblems(SAVE_LIST, listed)).toEqual([]);
    const [first, second] = [fox, owl].sort((a, b) => (a.playerId < b.playerId ? -1 : 1));
    expect(listed.saves.map((save: { player_id: string }) => save.player_id)).toEqual([first!.playerId, second!.playerId]);
    expect(listed.saves.find((save: { player_id: string }) => save.player_id === owl.playerId)).toMatchObject({ changed_by_kind: "player", save_copy_count: 0, sha256: await saveHash(canonicalSave({ coins: "6" })), size_bytes: 13 });

    // 101 more players: the first page stops at 100 and the next picks up after it.
    const statements = [];
    for (let i = 0; i < 101; i++) {
      const id = `bulk-${i}`;
      statements.push(env.DB.prepare("INSERT INTO accounts (id, player_id, username, age_band, created_at_ms, updated_at_ms) VALUES (?, ?, 'Bulk_' || ?, '18+', 0, 0)").bind(id, `player_bulk${String(i).padStart(3, "0")}`, i));
      statements.push(env.DB.prepare("INSERT INTO saves (account_id, game_id, version_number, sha256, size_bytes, updated_at_ms) VALUES (?, ?, 1, 'x', 2, 0)").bind(id, gameId));
    }
    await env.DB.batch(statements);
    const page = (await api("/games/sky-hopper/saves")).answer;
    expect(page.saves).toHaveLength(100);
    expect(page.next_cursor).toMatch(/^cursor_[a-z0-9]+$/);
    const rest = (await api(`/games/sky-hopper/saves?cursor=${page.next_cursor}`)).answer;
    expect(rest.saves).toHaveLength(3);
    expect(rest.next_cursor).toBeNull();
    expect(new Set([...page.saves, ...rest.saves].map((save: { player_id: string }) => save.player_id)).size).toBe(103);
    expect((await api("/games/sky-hopper/saves?cursor=12345")).answer.error).toMatchObject({ code: "bad_cursor", field: "cursor" });
  });

  it("reads a save whole or some keys, with IndexedDB databases", async () => {
    const database = { name: "/idbfs", version: 21, stores: [{ name: "FILE_DATA", keyPath: null, autoIncrement: false, indexes: [], records: [["/idbfs/save", { contents: { $z: ["view", "Uint8Array", "Bw=="] } }]] }] };
    await playerSaves(fox, { idb: [database], local: { coins: "120", "level,best": "3" } });
    const whole = await tool("get_save", { slug: "sky-hopper", player_id: fox.playerId });
    expect(schemaProblems(SAVE, whole)).toEqual([]);
    expect(whole.save).toMatchObject({ player_id: fox.playerId, changed_by_kind: "player", local_storage_items: { coins: "120", "level,best": "3" }, missing_keys: [], indexeddb_databases: [database] });
    // Keys can hold commas, so each is its own parameter.
    const some = await tool("get_save", { slug: "sky-hopper", player_id: fox.playerId, keys: ["level,best", "gems"] });
    expect(some.save).toMatchObject({ local_storage_items: { "level,best": "3" }, missing_keys: ["gems"], indexeddb_databases: null });
    expect((await api(`/games/sky-hopper/saves/${fox.playerId}?keys=coins`)).answer.save.local_storage_items).toEqual({ coins: "120" });
  });

  it("says which save, player or game it didn't find, and keeps other developers out", async () => {
    await playerSaves(fox, { coins: "1" });
    expect((await tool("get_save", { slug: "sky-hopper", player_id: owl.playerId })).error).toMatchObject({ code: "no_save", field: "player_id" });
    expect((await tool("get_save", { slug: "sky-hopper", player_id: "player_nobodyatall000000" })).error).toMatchObject({ code: "no_player", field: "player_id" });
    expect((await api("/games/sky-hopper/saves/version_8f3k2m9q1x7c4v6b0n5z")).answer.error).toMatchObject({ code: "wrong_id_kind", field: "player_id" });
    expect((await api(`/games/sky-hopper/saves/${fox.playerId}`, { key: other })).answer.error).toMatchObject({ code: "no_game" });
    expect((await api("/games/sky-hopper/saves", { key: other })).status).toBe(404);
    expect((await api(`/games/sky-hopper/saves/${fox.playerId}?key=coins`)).answer.error).toMatchObject({ code: "unknown_field", field: "key" });
  });
});

describe("changing saves", () => {
  it("changes some keys, keeps the rest, and keeps a copy of what it replaced", async () => {
    const database = { name: "game", version: 1, stores: [] };
    await playerSaves(fox, { idb: [database], local: { coins: "120", level: "3", tutorial: "done" } });
    const changed = await tool("change_save", { slug: "sky-hopper", player_id: fox.playerId, local_storage_items: { coins: "500", tutorial: null, gems: "2" } });
    expect(schemaProblems(SAVE_CHANGED, changed)).toEqual([]);
    expect(changed).toMatchObject({ save: { changed_by_kind: "developer", save_copy_count: 1 }, kept_save_copy_id: expect.stringMatching(/^save_copy_[a-z0-9]+$/), next_steps: [] });
    expect(await stored(fox)).toEqual({ idb: [database], local: { coins: "500", gems: "2", level: "3" } });
    expect(await copyReasons()).toEqual(["developer"]);
    const copy = await tool("get_save_copy", { slug: "sky-hopper", player_id: fox.playerId, save_copy_id: changed.kept_save_copy_id });
    expect(schemaProblems(SAVE_COPY, copy)).toEqual([]);
    expect(copy.save_copy).toMatchObject({ copy_reason: "developer", is_current_save: false, local_storage_items: { coins: "120", level: "3", tutorial: "done" } });

    // The same change again changes nothing.
    expect(await tool("change_save", { slug: "sky-hopper", player_id: fox.playerId, local_storage_items: { coins: "500" } })).toMatchObject({ save: { save_copy_count: 1 }, kept_save_copy_id: null });
  });

  it("keeps one copy for a run of the developer's own changes, so the player's copies stay", async () => {
    await playerSaves(fox, { level: "1" });
    await playerSaves(fox, { level: "2" });
    for (let i = 0; i < 10; i++) expect((await api(`/games/sky-hopper/saves/${fox.playerId}`, { method: "PATCH", body: { local_storage_items: { coins: String(i) } } })).status).toBe(200);
    expect(await copyReasons()).toEqual(["developer"]);
    // Once the player's game saves again, the next change keeps a copy again.
    await playerSaves(fox, { level: "3" });
    const changed = (await api(`/games/sky-hopper/saves/${fox.playerId}`, { method: "PATCH", body: { local_storage_items: { coins: "99" } } })).answer;
    expect(changed.kept_save_copy_id).not.toBeNull();
    expect(await copyReasons()).toEqual(["developer", "developer"]);
  });

  it("makes a save for a player who has none", async () => {
    const made = await tool("change_save", { slug: "sky-hopper", player_id: owl.playerId, local_storage_items: { welcome_gift: "1" } });
    expect(made).toMatchObject({ save: { changed_by_kind: "developer", save_copy_count: 0 }, kept_save_copy_id: null });
    expect(await stored(owl)).toEqual({ welcome_gift: "1" });
  });

  it("replaces the whole save, with both parts given", async () => {
    await playerSaves(fox, { idb: [{ name: "game", version: 1, stores: [] }], local: { coins: "120" } });
    const missing = await tool("replace_save", { slug: "sky-hopper", player_id: fox.playerId, local_storage_items: { coins: "0" } });
    expect(missing.error).toMatchObject({ code: "missing_field", field: "indexeddb_databases" });
    const badDatabases = await api(`/games/sky-hopper/saves/${fox.playerId}`, { method: "PUT", body: { local_storage_items: {}, indexeddb_databases: [{ name: "game" }] } });
    expect(badDatabases.answer.error).toMatchObject({ code: "bad_indexeddb_databases", field: "indexeddb_databases" });
    const replaced = await tool("replace_save", { slug: "sky-hopper", player_id: fox.playerId, local_storage_items: { coins: "0", level: "1" }, indexeddb_databases: [] });
    expect(replaced.save).toMatchObject({ changed_by_kind: "developer" });
    expect(await stored(fox)).toEqual({ coins: "0", level: "1" });
  });

  it("resets a save to empty, and restores what it replaced", async () => {
    await playerSaves(fox, { level: "9", coins: "5000" });
    const reset = await tool("reset_save", { slug: "sky-hopper", player_id: fox.playerId });
    expect(reset.save).toMatchObject({ size_bytes: 2, changed_by_kind: "developer" });
    expect(await stored(fox)).toEqual({});
    const copies = await tool("list_save_copies", { slug: "sky-hopper", player_id: fox.playerId });
    expect(schemaProblems(SAVE_COPY_LIST, copies)).toEqual([]);
    expect(copies.save_copies).toEqual([{ id: reset.kept_save_copy_id, saved_at: expect.stringMatching(/Z$/), copy_reason: "developer", sha256: await saveHash(canonicalSave({ level: "9", coins: "5000" })), size_bytes: 28, is_current_save: false }]);

    const restored = await tool("restore_save_copy", { slug: "sky-hopper", player_id: fox.playerId, save_copy_id: reset.kept_save_copy_id });
    expect(restored.save).toMatchObject({ changed_by_kind: "developer" });
    // The empty save it replaced was the developer's own change, so no copy of it.
    expect(restored.kept_save_copy_id).toBeNull();
    expect(await stored(fox)).toEqual({ coins: "5000", level: "9" });
    expect((await tool("list_save_copies", { slug: "sky-hopper", player_id: fox.playerId })).save_copies[0].is_current_save).toBe(true);

    expect((await tool("reset_save", { slug: "sky-hopper", player_id: owl.playerId })).error).toMatchObject({ code: "no_save" });
    expect((await tool("restore_save_copy", { slug: "sky-hopper", player_id: fox.playerId, save_copy_id: "save_copy_nothinghere00000000" })).error).toMatchObject({ code: "no_save_copy", field: "save_copy_id" });
  });

  it("refuses values that aren't text, saves over 5 MB, and changes to a game with cloud saves off", async () => {
    await playerSaves(fox, { coins: "1" });
    const notText = await api(`/games/sky-hopper/saves/${fox.playerId}`, { method: "PATCH", body: { local_storage_items: { coins: 500 } } });
    expect(notText.answer.error).toMatchObject({ code: "bad_local_storage_items", field: "local_storage_items.coins" });
    expect((await api(`/games/sky-hopper/saves/${fox.playerId}`, { method: "PATCH", body: { local_storage_items: {} } })).answer.error).toMatchObject({ code: "bad_local_storage_items" });
    expect((await api(`/games/sky-hopper/saves/${fox.playerId}`, { method: "PATCH", body: { local_storage_items: { a: "1" }, extra: 1 } })).answer.error).toMatchObject({ code: "unknown_field", field: "extra" });
    const big = await api(`/games/sky-hopper/saves/${fox.playerId}`, { method: "PATCH", body: { local_storage_items: { big: "x".repeat(5 * 1024 * 1024) } } });
    expect(big.answer.error).toMatchObject({ code: "save_too_big" });

    await env.DB.prepare("UPDATE games SET cloud_saves_enabled = 0 WHERE id = ?").bind(gameId).run();
    expect((await tool("reset_save", { slug: "sky-hopper", player_id: fox.playerId })).error).toMatchObject({ code: "cloud_saves_off", field: "slug" });
    // Reading still works.
    expect((await tool("get_save", { slug: "sky-hopper", player_id: fox.playerId })).save.local_storage_items).toEqual({ coins: "1" });
    expect(await stored(fox)).toEqual({ coins: "1" });
  });
});
