import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { AREA_ACCESS_BY_LEVEL, createAccount, createApiKey, gameBySlug } from "@zaisma/core";
import { TOOLS } from "../../apps/site/src/mcp.ts";
import { KEPT_ROOM_DELETED, KEPT_ROOMS } from "../../apps/site/src/schemas.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";
import { letPublish } from "../helpers.ts";

// A game's kept rooms through the developer API and MCP (apps/site/src/kept-rooms-api.ts): rooms its game
// server kept with room.setKept(true), one row each in kept_rooms, whose saved worlds share the game's free
// storage with its database. Deleting one asks the room through GAME_ROOMS, here the stand-in in
// test/site/rooms-database-worker.ts, which records the call; the real one is apps/rooms/src/room-updates.ts.

const SITE = "https://zaisma.test";
let token = "";
let nextId = 1;
let gameId = "";

/** The GAME_ROOMS stand-in's record of kept rooms deleted, and how it answers the next ones. */
const rooms = () => env.GAME_ROOMS as unknown as { takeKeptRoomDeletes(nextIsDeleted: boolean): Promise<{ gameId: string; slug: string; roomCode: string }[]> };

async function api(path: string, init: { method?: string; key?: string } = {}) {
  const res = await SELF.fetch(`${SITE}/api/dev${path}`, { method: init.method ?? "GET", headers: { authorization: `Bearer ${init.key ?? token}` } });
  const text = await res.text();
  const answer = JSON.parse(text) as any;
  if (!res.ok) expect(errorProblems(answer, res.status)).toEqual([]);
  return { status: res.status, answer, text };
}

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

async function keep(roomCode: string, fields: { name?: string | null; savedSizeBytes: number; lastPlayedAtMs: number | null; createdAtMs: number; forGameId?: string }) {
  await env.DB.prepare("INSERT INTO kept_rooms (game_id, room_code, name, saved_size_bytes, saved_at_ms, last_played_at_ms, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(fields.forGameId ?? gameId, roomCode, fields.name ?? null, fields.savedSizeBytes, fields.lastPlayedAtMs, fields.lastPlayedAtMs, fields.createdAtMs)
    .run();
}

const keptCodes = async (forGameId = gameId) => (await env.DB.prepare("SELECT room_code FROM kept_rooms WHERE game_id = ? ORDER BY room_code").bind(forGameId).all<{ room_code: string }>()).results.map((row) => row.room_code);
const readKey = () => createApiKey(env.DB, "dev-1", "reader", { accessLevel: "custom", areaAccess: { ...AREA_ACCESS_BY_LEVEL.full, game_access: "read" }, gameSlugs: null }).then((made) => made.token);

beforeEach(async () => {
  await env.DB.exec("DELETE FROM kept_rooms; DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;");
  await createAccount(env.DB, { id: "dev-1", username: "Pixel_Smith", ageBand: "18+" });
  await letPublish(env.DB, "dev-1");
  token = (await createApiKey(env.DB, "dev-1", "claude")).token;
  const made = await SELF.fetch(`${SITE}/api/dev/games`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ title: "Frostbound", slug: "frostbound" }) });
  expect(made.status).toBe(201);
  gameId = (await gameBySlug(env.DB, "frostbound"))!.id;
  await rooms().takeKeptRoomDeletes(true);
});

describe("a game's kept rooms", () => {
  it("are listed most recently played first, with their sizes summed into the game's storage, to a read-only key", async () => {
    const nowMs = Date.now();
    await keep("K7Q2MX", { name: "Valhalla Survival", savedSizeBytes: 3_000_000, lastPlayedAtMs: nowMs - 3_600_000, createdAtMs: nowMs - 86_400_000 });
    await keep("H4RB9T", { name: "Creative Build", savedSizeBytes: 12_500_000, lastPlayedAtMs: nowMs, createdAtMs: nowMs - 7 * 86_400_000 });
    await keep("Z2W8PD", { savedSizeBytes: 0, lastPlayedAtMs: null, createdAtMs: nowMs - 60_000 });

    const listed = await api("/games/frostbound/kept-rooms", { key: await readKey() });
    expect(listed.status).toBe(200);
    expect(schemaProblems(KEPT_ROOMS, listed.answer)).toEqual([]);
    expect(listed.answer.kept_rooms.map((keptRoom: { room_code: string }) => keptRoom.room_code)).toEqual(["H4RB9T", "K7Q2MX", "Z2W8PD"]);
    expect(listed.answer.kept_rooms[0]).toEqual({
      room_code: "H4RB9T",
      name: "Creative Build",
      saved_size_bytes: 12_500_000,
      saved_at: new Date(nowMs).toISOString(),
      last_played_at: new Date(nowMs).toISOString(),
      created_at: new Date(nowMs - 7 * 86_400_000).toISOString(),
    });
    expect(listed.answer.kept_rooms[2]).toMatchObject({ name: null, saved_at: null, last_played_at: null });
    expect(listed.answer.kept_rooms_size_bytes).toBe(15_500_000);
    expect(listed.answer.storage_size_bytes).toBeGreaterThanOrEqual(15_500_000);
    expect(listed.answer.free_storage_size_bytes).toBe(500 * 1024 * 1024);
  });

  it("are none at first, with the storage the database alone", async () => {
    const listed = await api("/games/frostbound/kept-rooms");
    expect(schemaProblems(KEPT_ROOMS, listed.answer)).toEqual([]);
    expect(listed.answer).toMatchObject({ kept_rooms: [], kept_rooms_size_bytes: 0 });
    expect(listed.answer.storage_size_bytes).toBeGreaterThanOrEqual(0);
  });

  it("are only the game's own, and another developer's game isn't there", async () => {
    await createAccount(env.DB, { id: "dev-2", username: "Nora_Lindqvist", ageBand: "18+" });
    await letPublish(env.DB, "dev-2");
    const strangerToken = (await createApiKey(env.DB, "dev-2", "claude")).token;
    const made = await SELF.fetch(`${SITE}/api/dev/games`, { method: "POST", headers: { authorization: `Bearer ${strangerToken}`, "content-type": "application/json" }, body: JSON.stringify({ title: "Ember Keep", slug: "ember-keep" }) });
    expect(made.status).toBe(201);
    const strangerGameId = (await gameBySlug(env.DB, "ember-keep"))!.id;
    await keep("K7Q2MX", { name: "Mine", savedSizeBytes: 100, lastPlayedAtMs: Date.now(), createdAtMs: Date.now() });
    await keep("K7Q2MX", { name: "Theirs", savedSizeBytes: 900, lastPlayedAtMs: Date.now(), createdAtMs: Date.now(), forGameId: strangerGameId });

    const mine = await api("/games/frostbound/kept-rooms");
    expect(mine.answer.kept_rooms.map((keptRoom: { name: string }) => keptRoom.name)).toEqual(["Mine"]);
    expect(mine.answer.kept_rooms_size_bytes).toBe(100);

    // The stranger reaching the developer's game gets the same answer as a game that isn't there.
    const onTheirs = await api("/games/frostbound/kept-rooms", { key: strangerToken });
    const onNothing = await api("/games/no-such-game/kept-rooms", { key: strangerToken });
    expect(onTheirs.status).toBe(404);
    expect({ status: onTheirs.status, code: onTheirs.answer.error.code }).toEqual({ status: onNothing.status, code: onNothing.answer.error.code });
    const deleting = await api("/games/frostbound/kept-rooms/K7Q2MX", { method: "DELETE", key: strangerToken });
    expect(deleting.status).toBe(404);
    expect(deleting.answer.error.code).toBe(onNothing.answer.error.code);
    expect(await keptCodes()).toEqual(["K7Q2MX"]);
    expect(await keptCodes(strangerGameId)).toEqual(["K7Q2MX"]);
    expect(await rooms().takeKeptRoomDeletes(true)).toEqual([]);
  });
});

describe("the game's storage alerts", () => {
  it("count kept rooms with the database: nearly full at 80% of the free 500 MB, full at all of it", async () => {
    const alertKinds = async () => (await api("/games/frostbound")).answer.alerts.map((alert: { kind: string }) => alert.kind).filter((kind: string) => kind.startsWith("database_"));
    expect(await alertKinds()).toEqual([]);
    await keep("K7Q2MX", { savedSizeBytes: 410 * 1024 * 1024, lastPlayedAtMs: Date.now(), createdAtMs: Date.now() });
    expect(await alertKinds()).toEqual(["database_nearly_full"]);
    await keep("H4RB9T", { savedSizeBytes: 90 * 1024 * 1024, lastPlayedAtMs: Date.now(), createdAtMs: Date.now() });
    expect(await alertKinds()).toEqual(["database_full"]);
    const full = (await api("/games/frostbound")).answer.alerts.find((alert: { kind: string }) => alert.kind === "database_full");
    expect(full.fix).toContain("delete_kept_room");
  });
});

describe("deleting a kept room", () => {
  it("asks the room, removes its row and says so in the game's history", async () => {
    await keep("K7Q2MX", { name: "Valhalla Survival", savedSizeBytes: 3_000_000, lastPlayedAtMs: Date.now(), createdAtMs: Date.now() });
    await keep("H4RB9T", { savedSizeBytes: 500, lastPlayedAtMs: null, createdAtMs: Date.now() });

    const deleted = await api("/games/frostbound/kept-rooms/K7Q2MX", { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(schemaProblems(KEPT_ROOM_DELETED, deleted.answer)).toEqual([]);
    expect(deleted.answer).toEqual({ is_deleted: true, next_steps: [expect.objectContaining({ tool: "list_kept_rooms", arguments: { slug: "frostbound" } })] });
    expect(await rooms().takeKeptRoomDeletes(true)).toEqual([{ gameId, slug: "frostbound", roomCode: "K7Q2MX" }]);
    expect(await keptCodes()).toEqual(["H4RB9T"]);
    expect((await api("/games/frostbound/kept-rooms")).answer.kept_rooms_size_bytes).toBe(500);

    const history = await api("/games/frostbound/history");
    expect(history.answer.events.map((event: { description: string }) => event.description)).toContain("Deleted a kept room");
  });

  it("takes a code in lower case", async () => {
    await keep("K7Q2MX", { savedSizeBytes: 10, lastPlayedAtMs: null, createdAtMs: Date.now() });
    expect((await api("/games/frostbound/kept-rooms/k7q2mx", { method: "DELETE" })).status).toBe(200);
    expect(await rooms().takeKeptRoomDeletes(true)).toEqual([{ gameId, slug: "frostbound", roomCode: "K7Q2MX" }]);
    expect(await keptCodes()).toEqual([]);
  });

  it("needs game_access write: a read-only key is refused, with the row kept", async () => {
    await keep("K7Q2MX", { savedSizeBytes: 10, lastPlayedAtMs: null, createdAtMs: Date.now() });
    const refused = await api("/games/frostbound/kept-rooms/K7Q2MX", { method: "DELETE", key: await readKey() });
    expect(refused.status).toBe(403);
    expect(refused.answer.error.code).toBe("key_not_allowed");
    expect(await keptCodes()).toEqual(["K7Q2MX"]);
    expect(await rooms().takeKeptRoomDeletes(true)).toEqual([]);
  });

  it("refuses a code the game has no kept room for, and one that isn't a room code", async () => {
    await keep("K7Q2MX", { savedSizeBytes: 10, lastPlayedAtMs: null, createdAtMs: Date.now() });
    const unknown = await api("/games/frostbound/kept-rooms/H4RB9T", { method: "DELETE" });
    expect(unknown.status).toBe(404);
    expect(unknown.answer.error).toMatchObject({ code: "no_kept_room", field: "room_code" });
    for (const badCode of ["K7Q2", "K7Q2MXX", "K0Q2MX", "K7Q-MX"]) {
      const bad = await api(`/games/frostbound/kept-rooms/${encodeURIComponent(badCode)}`, { method: "DELETE" });
      expect(bad.status, badCode).toBe(400);
      expect(bad.answer.error, badCode).toMatchObject({ code: "bad_room_code", field: "room_code" });
    }
    expect(await keptCodes()).toEqual(["K7Q2MX"]);
    expect(await rooms().takeKeptRoomDeletes(true)).toEqual([]);
  });

  it("keeps the row when the room doesn't answer", async () => {
    await keep("K7Q2MX", { savedSizeBytes: 10, lastPlayedAtMs: null, createdAtMs: Date.now() });
    await rooms().takeKeptRoomDeletes(false);
    const failed = await api("/games/frostbound/kept-rooms/K7Q2MX", { method: "DELETE" });
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(await keptCodes()).toEqual(["K7Q2MX"]);
    expect(await rooms().takeKeptRoomDeletes(true)).toHaveLength(1);
  });
});

describe("the MCP", () => {
  it("lists and deletes kept rooms with list_kept_rooms and delete_kept_room", async () => {
    await keep("K7Q2MX", { name: "Valhalla Survival", savedSizeBytes: 2048, lastPlayedAtMs: Date.now(), createdAtMs: Date.now() });
    const listed = await tool("list_kept_rooms", { slug: "frostbound" });
    expect(schemaProblems(KEPT_ROOMS, listed)).toEqual([]);
    expect(listed.kept_rooms).toHaveLength(1);
    expect(listed.kept_rooms_size_bytes).toBe(2048);

    const deleted = await tool("delete_kept_room", { slug: "frostbound", room_code: "K7Q2MX" });
    expect(schemaProblems(KEPT_ROOM_DELETED, deleted)).toEqual([]);
    expect(deleted.is_deleted).toBe(true);
    expect(await keptCodes()).toEqual([]);

    const again = await tool("delete_kept_room", { slug: "frostbound", room_code: "K7Q2MX" });
    expect(again.error).toMatchObject({ code: "no_kept_room", field: "room_code" });
  });
});
