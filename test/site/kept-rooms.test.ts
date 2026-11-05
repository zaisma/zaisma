import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { AREA_ACCESS_BY_LEVEL, createAccount, createApiKey, gameBySlug, gameStorageSizeBytes, keptRoomsSizeBytes, waitingKeptRoomsSizeBytes } from "@zaisma/core";
import { TOOLS } from "../../apps/site/src/mcp.ts";
import { apiCall, callerFor } from "../../apps/site/src/developer.ts";
import { answerGameDeletionRequest } from "../../apps/site/src/game-deletion-requests.ts";
import { GAME_DELETION_REQUEST, KEPT_ROOM_BROUGHT_BACK, KEPT_ROOM_DELETED, KEPT_ROOM_ERASED, KEPT_ROOM_RESTORE_BATCH_READ, KEPT_ROOM_RESTORE_BATCH_STARTED, KEPT_ROOM_RESTORED, KEPT_ROOM_RESTORES, KEPT_ROOMS, ROOM_ENDED } from "../../apps/site/src/schemas.ts";
import { restoreKeptRoomPage, type KeptRoomRestorePagePart } from "../../apps/site/src/kept-room-restores-api.ts";
import { bringBackFromCopy } from "../../apps/site/src/kept-room-copies.ts";
import type { Env } from "../../apps/site/src/env.ts";
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
const rooms = () => env.GAME_ROOMS as unknown as {
  takeKeptRoomDeletes(nextIsDeleted: boolean): Promise<{ gameId: string; slug: string; roomCode: string }[]>;
  takeRoomReachCalls(nextAnswers?: Record<string, unknown>): Promise<{ call: string; asked: Record<string, unknown> }[]>;
};

async function api(path: string, init: { method?: string; key?: string; body?: unknown } = {}) {
  const res = await SELF.fetch(`${SITE}/api/dev${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${init.key ?? token}`, ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
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
  await env.DB.exec("DELETE FROM game_deletion_requests; DELETE FROM games_ever_played; DELETE FROM security_events; DELETE FROM kept_rooms; DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;");
  await createAccount(env.DB, { id: "dev-1", username: "Pixel_Smith", ageBand: "18+" });
  await letPublish(env.DB, "dev-1");
  token = (await createApiKey(env.DB, "dev-1", "claude")).token;
  const made = await SELF.fetch(`${SITE}/api/dev/games`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ title: "Frostbound", slug: "frostbound" }) });
  expect(made.status).toBe(201);
  gameId = (await gameBySlug(env.DB, "frostbound"))!.id;
  await rooms().takeKeptRoomDeletes(true);
  await rooms().takeRoomReachCalls();
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
      erases_at: null,
    });
    expect(listed.answer.kept_rooms[2]).toMatchObject({ name: null, saved_at: null, last_played_at: null });
    expect(listed.answer.kept_rooms_size_bytes).toBe(15_500_000);
    expect(listed.answer.storage_size_bytes).toBeGreaterThanOrEqual(15_500_000);
    expect(listed.answer.maximum_storage_size_bytes).toBe(10 * 1024 ** 3);
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
  it("count kept rooms with the database: nearly full at 80% of the 10 GB a game keeps, full at all of it", async () => {
    const alertKinds = async () => (await api("/games/frostbound")).answer.alerts.map((alert: { kind: string }) => alert.kind).filter((kind: string) => kind.startsWith("database_"));
    expect(await alertKinds()).toEqual([]);
    await keep("K7Q2MX", { savedSizeBytes: 8.2 * 1024 ** 3, lastPlayedAtMs: Date.now(), createdAtMs: Date.now() });
    expect(await alertKinds()).toEqual(["database_nearly_full"]);
    await keep("H4RB9T", { savedSizeBytes: 1.8 * 1024 ** 3, lastPlayedAtMs: Date.now(), createdAtMs: Date.now() });
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
    expect(deleted.answer).toEqual({ is_deleted: true, erases_at: null, next_steps: [expect.objectContaining({ tool: "bring_back_kept_room", arguments: { slug: "frostbound", room_code: "K7Q2MX" } }), expect.objectContaining({ tool: "list_kept_rooms", arguments: { slug: "frostbound" } })] });
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

describe("a kept world in a game other people played", () => {
  const WEEK_MS = 7 * 86_400_000;
  const K7 = "/games/frostbound/kept-rooms/K7Q2MX";
  const tappedCaller = async () => ({ ...(await callerFor(env, new Request(SITE), "dev-1"))!, isPasskeyConfirmed: true });
  const erasesAtMs = async (code = "K7Q2MX") => (await env.DB.prepare("SELECT erases_at_ms FROM kept_rooms WHERE game_id = ? AND room_code = ?").bind(gameId, code).first<{ erases_at_ms: number | null }>())?.erases_at_ms;

  beforeEach(async () => {
    await env.DB.prepare("INSERT INTO games_ever_played (account_id, game_id, first_played_at_ms) VALUES ('another-player', ?, 1)").bind(gameId).run();
    await keep("K7Q2MX", { name: "Valhalla Survival", savedSizeBytes: 3_000, lastPlayedAtMs: Date.now(), createdAtMs: Date.now() });
    await keep("H4RB9T", { savedSizeBytes: 500, lastPlayedAtMs: null, createdAtMs: Date.now() });
  });

  it("waits a week when a key deletes it: the room holds it, nothing is erased, and the answer says until when", async () => {
    const before = Date.now();
    const deleted = await api(K7, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(schemaProblems(KEPT_ROOM_DELETED, deleted.answer)).toEqual([]);
    expect(Date.parse(deleted.answer.erases_at) - before).toBeGreaterThanOrEqual(WEEK_MS);
    expect(deleted.answer.next_steps[0]).toMatchObject({ tool: "bring_back_kept_room", arguments: { slug: "frostbound", room_code: "K7Q2MX" } });
    expect(await rooms().takeKeptRoomDeletes(true)).toEqual([]);
    expect(await rooms().takeRoomReachCalls()).toEqual([{ call: "holdKeptRoom", asked: { gameId, slug: "frostbound", roomCode: "K7Q2MX", erasesAtMs: Date.parse(deleted.answer.erases_at), message: null } }]);
    expect(await keptCodes()).toEqual(["H4RB9T", "K7Q2MX"]);

    const again = await api(K7, { method: "DELETE" });
    expect(again.answer.erases_at).toBe(deleted.answer.erases_at);
    expect(await rooms().takeRoomReachCalls()).toEqual([]);
  });

  it("keeps its row and doesn't wait when the room doesn't answer", async () => {
    await rooms().takeRoomReachCalls({ holdKeptRoom: { holdOutcome: "failed" } });
    expect((await api(K7, { method: "DELETE" })).status).toBeGreaterThanOrEqual(500);
    expect(await erasesAtMs()).toBeNull();
  });

  it("leaves the game's storage limit at once and is listed with when it's erased", async () => {
    const deleted = await api(K7, { method: "DELETE" });
    const listed = await api("/games/frostbound/kept-rooms");
    expect(schemaProblems(KEPT_ROOMS, listed.answer)).toEqual([]);
    expect(listed.answer.kept_rooms.find((row: { room_code: string }) => row.room_code === "K7Q2MX").erases_at).toBe(deleted.answer.erases_at);
    expect(listed.answer.kept_rooms.find((row: { room_code: string }) => row.room_code === "H4RB9T").erases_at).toBeNull();
    expect(listed.answer.kept_rooms_size_bytes).toBe(500);
    expect(listed.answer.waiting_kept_rooms_size_bytes).toBe(3_000);
    expect(await keptRoomsSizeBytes(env.DB, gameId)).toBe(500);
    expect(await waitingKeptRoomsSizeBytes(env.DB, gameId)).toBe(3_000);
    expect(await gameStorageSizeBytes(env.DB, 100, gameId)).toBe(600);
  });

  it("comes back as it was with a key, until its week is over", async () => {
    expect((await api(`${K7}/bring-back`, { method: "POST" })).answer.error).toMatchObject({ code: "kept_room_not_waiting", field: "room_code" });
    await api(K7, { method: "DELETE" });
    await rooms().takeRoomReachCalls();
    const back = await api(`${K7}/bring-back`, { method: "POST" });
    expect(back.status).toBe(200);
    expect(schemaProblems(KEPT_ROOM_BROUGHT_BACK, back.answer)).toEqual([]);
    expect(await rooms().takeRoomReachCalls()).toEqual([{ call: "bringBackKeptRoom", asked: { gameId, slug: "frostbound", roomCode: "K7Q2MX" } }]);
    expect(await erasesAtMs()).toBeNull();

    await api(K7, { method: "DELETE" });
    await env.DB.prepare("UPDATE kept_rooms SET erases_at_ms = 1 WHERE room_code = 'K7Q2MX'").run();
    expect((await api(`${K7}/bring-back`, { method: "POST" })).answer.error).toMatchObject({ code: "kept_room_erasing", field: "room_code" });
  });

  it("is erased sooner only with the developer's passkey tap, never with a key alone", async () => {
    expect((await api(`${K7}/erase-now`, { method: "POST" })).answer.error.code).toBe("kept_room_not_waiting");
    await api(K7, { method: "DELETE" });

    const asked = await api(`${K7}/erase-now`, { method: "POST" });
    expect(asked.status).toBe(403);
    expect(asked.answer.error.code).toBe("confirmation_needed");
    const requestId = asked.answer.error.game_deletion_request_id as string;
    expect(asked.answer.error.confirm_url).toContain(`game_deletion_request=${requestId}`);
    expect(await rooms().takeKeptRoomDeletes(true)).toEqual([]);
    expect(await erasesAtMs()).not.toBeNull();

    const request = await api(`/games/frostbound/deletion-requests/${requestId}`);
    expect(schemaProblems(GAME_DELETION_REQUEST, request.answer)).toEqual([]);
    expect(request.answer.game_deletion_request).toMatchObject({ request_kind: "erase_kept_room_now", room_code: "K7Q2MX", request_status: "waiting" });

    const caller = (await callerFor(env, new Request(SITE), "dev-1"))!;
    await expect(answerGameDeletionRequest(env, caller, requestId, "approved")).rejects.toMatchObject({ code: "confirmation_needed" });
    expect(await erasesAtMs()).not.toBeNull();

    expect(await answerGameDeletionRequest(env, await tappedCaller(), requestId, "approved")).toEqual({ outcome: "answered", gameSlug: "frostbound", requestKind: "erase_kept_room_now" });
    expect(await rooms().takeKeptRoomDeletes(true)).toEqual([{ gameId, slug: "frostbound", roomCode: "K7Q2MX" }]);
    expect(await keptCodes()).toEqual(["H4RB9T"]);
    expect((await api(`/games/frostbound/deletion-requests/${requestId}`)).answer.game_deletion_request.request_status).toBe("approved");
  });

  it("answers the erase itself with is_erased", async () => {
    await api(K7, { method: "DELETE" });
    const erased = await apiCall(env, await tappedCaller(), "POST", `${K7}/erase-now`);
    expect(schemaProblems(KEPT_ROOM_ERASED, erased)).toEqual([]);
    expect(erased.is_erased).toBe(true);
  });

  it("waits its week too when a key ends it, with the players hearing the message", async () => {
    const ended = await api("/games/frostbound/rooms/K7Q2MX/end", { method: "POST", body: { message: "Closing for maintenance.", confirm: true } });
    expect(ended.status).toBe(200);
    expect(schemaProblems(ROOM_ENDED, ended.answer)).toEqual([]);
    expect(Date.parse(ended.answer.erases_at)).toBe(await erasesAtMs());
    expect(await rooms().takeRoomReachCalls()).toEqual([{ call: "holdKeptRoom", asked: expect.objectContaining({ roomCode: "K7Q2MX", message: "Closing for maintenance." }) }]);
  });

  it("ends any other room as before", async () => {
    const ended = await api("/games/frostbound/rooms/Z2W8PD/end", { method: "POST", body: { confirm: true } });
    expect(ended.answer).toMatchObject({ is_ended: true, erases_at: null });
    expect(await rooms().takeRoomReachCalls()).toEqual([{ call: "endRoom", asked: expect.objectContaining({ roomCode: "Z2W8PD" }) }]);
  });

  it("alerts the developer once a day per game when a key deletes worlds", async () => {
    await api(K7, { method: "DELETE" });
    await api("/games/frostbound/kept-rooms/H4RB9T", { method: "DELETE" });
    const alerts = () => env.DB.prepare("SELECT COUNT(*) AS alert_count FROM security_events WHERE account_id = 'dev-1' AND kind = 'kept_rooms_deleted'").first<{ alert_count: number }>();
    expect((await alerts())!.alert_count).toBe(1);
    await env.DB.prepare("UPDATE security_events SET happened_at_ms = happened_at_ms - 86400001 WHERE kind = 'kept_rooms_deleted'").run();
    await env.DB.prepare("UPDATE kept_rooms SET erases_at_ms = NULL").run();
    await api(K7, { method: "DELETE" });
    expect((await alerts())!.alert_count).toBe(2);
  });

  it("needs game_access write to bring back or erase", async () => {
    await api(K7, { method: "DELETE" });
    const key = await readKey();
    expect((await api(`${K7}/bring-back`, { method: "POST", key })).answer.error.code).toBe("key_not_allowed");
    expect((await api(`${K7}/erase-now`, { method: "POST", key })).answer.error.code).toBe("key_not_allowed");
    expect(await erasesAtMs()).not.toBeNull();
  });
});

describe("a kept room's world going back", () => {
  beforeEach(async () => {
    await env.DB.prepare("UPDATE games SET created_at_ms = ? WHERE id = ?").bind(Date.now() - 2 * 86_400_000, gameId).run();
  });

  const moment = () => new Date(Date.now() - 3_600_000).toISOString();

  it("goes back to a moment, says what's next and shows in the game's history", async () => {
    await keep("K7Q2MX", { savedSizeBytes: 100, lastPlayedAtMs: Date.now(), createdAtMs: Date.now() - 86_400_000 });
    await rooms().takeRoomReachCalls();
    const restoreToAt = moment();
    const restored = await api("/games/frostbound/kept-rooms/k7q2mx/restores", { method: "POST", body: { restore_to_at: restoreToAt } });
    expect(restored.status).toBe(200);
    expect(schemaProblems(KEPT_ROOM_RESTORED, restored.answer)).toEqual([]);
    expect(restored.answer.kept_room_restore).toMatchObject({ id: "kept_room_restore_standin", room_code: "K7Q2MX", restore_to_at: restoreToAt });
    expect(restored.answer.live_version_published_since).toBeNull();
    expect(restored.answer.next_steps.map((step: { tool: string }) => step.tool)).toEqual(["undo_kept_room_restore", "list_kept_room_restores"]);
    expect((await rooms().takeRoomReachCalls()).map((entry) => entry.call)).toEqual(["restoreKeptRoom"]);
    const history = await api("/games/frostbound/history");
    expect(history.answer.events.map((event: { description: string }) => event.description).join()).toContain("restored");
  });

  it("refuses a bad moment, a read-only key, an unknown world and a closed body", async () => {
    await keep("K7Q2MX", { savedSizeBytes: 100, lastPlayedAtMs: Date.now(), createdAtMs: Date.now() - 86_400_000 });
    const path = "/games/frostbound/kept-rooms/K7Q2MX/restores";
    expect((await api(path, { method: "POST", body: { restore_to_at: "an hour ago" } })).answer.error.code).toBe("bad_time");
    expect((await api(path, { method: "POST", body: { restore_to_at: moment(), extra: true } })).status).toBe(400);
    expect((await api(path, { method: "POST", key: await readKey(), body: { restore_to_at: moment() } })).status).toBe(403);
    await rooms().takeRoomReachCalls({ restoreKeptRoom: { outcome: "no_kept_room" } });
    expect((await api(path, { method: "POST", body: { restore_to_at: moment() } })).answer.error.code).toBe("no_kept_room");
    await rooms().takeRoomReachCalls({ restoreKeptRoom: { outcome: "bad_time", earliestRestoreToAtMs: Date.now() - 1000 } });
    expect((await api(path, { method: "POST", body: { restore_to_at: moment() } })).answer.error.code).toBe("bad_time");
    await rooms().takeRoomReachCalls({ restoreKeptRoom: { outcome: "no_history" } });
    expect((await api(path, { method: "POST", body: { restore_to_at: moment() } })).status).toBe(501);
    await rooms().takeRoomReachCalls({ restoreKeptRoom: { outcome: "limited" } });
    expect((await api(path, { method: "POST", body: { restore_to_at: moment() } })).answer.error.code).toBe("slow_down");
    await rooms().takeRoomReachCalls();
  });

  it("warns when the live version went live after the moment, naming the version live then", async () => {
    await keep("K7Q2MX", { savedSizeBytes: 100, lastPlayedAtMs: Date.now(), createdAtMs: Date.now() - 86_400_000 });
    const nowMs = Date.now();
    await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms, published_at_ms) VALUES ('version_before', ?, 'x', 1, 0, 'approved', 0, ?), ('version_since', ?, 'y', 1, 0, 'approved', 0, ?)").bind(gameId, nowMs - 7_200_000, gameId, nowMs - 60_000).run();
    await env.DB.prepare("UPDATE games SET live_version_id = 'version_since', live_version_published_at_ms = ? WHERE id = ?").bind(nowMs - 60_000, gameId).run();
    const restored = await api("/games/frostbound/kept-rooms/K7Q2MX/restores", { method: "POST", body: { restore_to_at: moment() } });
    expect(restored.answer.live_version_published_since).toMatchObject({ version_id: "version_since" });
    expect(restored.answer.next_steps[0]).toMatchObject({ tool: "publish_version", arguments: { slug: "frostbound", version_id: "version_before" } });
  });

  it("lists how far back it can go, from when it was kept, and its restores, to a read-only key", async () => {
    const createdAtMs = Date.now() - 3_600_000;
    await keep("K7Q2MX", { savedSizeBytes: 100, lastPlayedAtMs: Date.now(), createdAtMs });
    await env.DB.prepare("INSERT INTO kept_room_restores (id, game_id, room_code, restore_to_at_ms, undo_bookmark, restored_at_ms) VALUES ('kept_room_restore_one', ?, 'K7Q2MX', ?, 'undo', ?)").bind(gameId, createdAtMs, Date.now()).run();
    const listed = await api("/games/frostbound/kept-rooms/K7Q2MX/restores", { key: await readKey() });
    expect(schemaProblems(KEPT_ROOM_RESTORES, listed.answer)).toEqual([]);
    expect(listed.answer.earliest_restore_to_at).toBe(new Date(createdAtMs).toISOString());
    expect(listed.answer.restores.map((restore: { id: string }) => restore.id)).toEqual(["kept_room_restore_one"]);
  });
});

describe("every kept room going back", () => {
  beforeEach(async () => {
    await env.DB.prepare("UPDATE games SET created_at_ms = ? WHERE id = ?").bind(Date.now() - 2 * 86_400_000, gameId).run();
  });

  /** A queue that runs nothing: the test runs each page. */
  const pages: KeptRoomRestorePagePart[] = [];
  const withQueue = () => ({ ...env, BACKUP_QUEUE: { send: async (body: KeptRoomRestorePagePart) => void pages.push(body) } }) as unknown as Env;

  it("goes a page at a time, skipping waiting worlds and worlds kept since, and counts what happened", async () => {
    pages.length = 0;
    const atMs = Date.now() - 3_600_000;
    await keep("AAAAAA", { savedSizeBytes: 1, lastPlayedAtMs: null, createdAtMs: atMs - 1000 });
    await keep("BBBBBB", { savedSizeBytes: 1, lastPlayedAtMs: null, createdAtMs: atMs - 1000 });
    await keep("CCCCCC", { savedSizeBytes: 1, lastPlayedAtMs: null, createdAtMs: atMs + 1000 });
    await keep("DDDDDD", { savedSizeBytes: 1, lastPlayedAtMs: null, createdAtMs: atMs - 1000 });
    await env.DB.prepare("UPDATE kept_rooms SET erases_at_ms = ? WHERE room_code = 'DDDDDD'").bind(Date.now() + 60_000).run();
    await env.DB.prepare("INSERT INTO kept_room_restore_batches (id, game_id, restore_to_at_ms, started_at_ms, kept_room_count) VALUES ('kept_room_restore_batch_one', ?, ?, ?, 4)").bind(gameId, atMs, Date.now()).run();
    await rooms().takeRoomReachCalls({ restoreKeptRoom: { outcome: "failed" } });
    // One world fails, by the stand-in's one answer for all: both named.
    await restoreKeptRoomPage(withQueue(), { part_kind: "kept_room_restore_page", game_id: gameId, slug: "frostbound", kept_room_restore_batch_id: "kept_room_restore_batch_one", after_room_code: "" });
    const calls = await rooms().takeRoomReachCalls();
    expect(calls.map((entry) => entry.asked.roomCode).sort()).toEqual(["AAAAAA", "BBBBBB"]);
    expect(calls[0]!.asked.batchId).toBe("kept_room_restore_batch_one");
    const read = await api("/games/frostbound/kept-room-restores/kept_room_restore_batch_one");
    expect(schemaProblems(KEPT_ROOM_RESTORE_BATCH_READ, read.answer)).toEqual([]);
    expect(read.answer.kept_room_restore_batch).toMatchObject({ kept_room_count: 4, restored_room_count: 0, failed_room_count: 2, skipped_room_count: 2, failed_room_codes: ["AAAAAA", "BBBBBB"], finished_at: expect.any(String) });
    expect(pages).toEqual([]);
  });

  it("names the database and version calls with the same time, and refuses a second while one runs", async () => {
    await keep("AAAAAA", { savedSizeBytes: 1, lastPlayedAtMs: null, createdAtMs: Date.now() - 86_400_000 });
    const restoreToAt = new Date(Date.now() - 3_600_000).toISOString();
    const started = await apiCall(withQueue(), (await callerFor(withQueue(), new Request(SITE), "dev-1"))!, "POST", "/games/frostbound/kept-room-restores", { restore_to_at: restoreToAt });
    expect(schemaProblems(KEPT_ROOM_RESTORE_BATCH_STARTED, started)).toEqual([]);
    expect((started as any).next_steps).toContainEqual(expect.objectContaining({ tool: "restore_database", arguments: { slug: "frostbound", restore_to_at: restoreToAt } }));
    expect(pages.at(-1)).toMatchObject({ part_kind: "kept_room_restore_page", game_id: gameId, after_room_code: "" });
    await expect(apiCall(withQueue(), (await callerFor(withQueue(), new Request(SITE), "dev-1"))!, "POST", "/games/frostbound/kept-room-restores", { restore_to_at: restoreToAt })).rejects.toMatchObject({ code: "kept_room_restore_batch_running" });
  });
});

describe("a deleted world coming back", () => {
  const remember = (roomCode: string, fields: { savedSizeBytes?: number; deletedAtMs?: number } = {}) =>
    env.DB.prepare("INSERT INTO deleted_kept_rooms (game_id, room_code, name, saved_size_bytes, deleted_at_ms) VALUES (?, ?, 'Valhalla', ?, ?)").bind(gameId, roomCode, fields.savedSizeBytes ?? 100, fields.deletedAtMs ?? Date.now() - 86_400_000).run();

  it("is listed until its copy goes, then isn't there to bring back", async () => {
    await remember("K7Q2MX");
    await remember("LDWRLD", { deletedAtMs: Date.now() - 29 * 86_400_000 });
    const listed = await api("/games/frostbound/kept-rooms");
    expect(schemaProblems(KEPT_ROOMS, listed.answer)).toEqual([]);
    expect(listed.answer.deleted_kept_rooms).toMatchObject([{ room_code: "K7Q2MX", name: "Valhalla", bring_back_started_at: null, bring_back_failed_at: null }]);
    expect(listed.answer.deleted_kept_room_count).toBe(1);
    expect((await api("/games/frostbound/kept-rooms/LDWRLD/bring-back", { method: "POST" })).answer.error.code).toBe("no_kept_room");
  });

  it("says so on a Zaisma that can't read its copies, and won't undo a takedown", async () => {
    await remember("K7Q2MX");
    expect((await api("/games/frostbound/kept-rooms/K7Q2MX/bring-back", { method: "POST" })).answer.error.code).toBe("kept_room_copies_unavailable");
    await env.DB.prepare("UPDATE games SET review_status = 'removed' WHERE id = ?").bind(gameId).run();
    const caller = (await callerFor(env as unknown as Env, new Request(SITE), "dev-1"))!;
    await expect(bringBackFromCopy(env as unknown as Env, { ...(await gameBySlug(env.DB, "frostbound"))!, review_status: "removed" }, "K7Q2MX", caller, Date.now())).rejects.toMatchObject({ code: "game_removed" });
    await env.DB.prepare("UPDATE games SET review_status = 'live' WHERE id = ?").bind(gameId).run();
  });

  it("doesn't come back past the game's 10 GB, under a code in use or past the day's limit", async () => {
    const copies = { ...env, KEPT_ROOM_COPY_KEY_ID: "id", KEPT_ROOM_COPY_KEY_SECRET: "secret", BACKUP_QUEUE: { send: async () => {} } } as unknown as Env;
    const game = (await gameBySlug(env.DB, "frostbound"))!;
    const caller = (await callerFor(copies, new Request(SITE), "dev-1"))!;
    await remember("TBGWRD", { savedSizeBytes: 11 * 1024 ** 3 });
    await expect(bringBackFromCopy(copies, game, "TBGWRD", caller, Date.now())).rejects.toMatchObject({ code: "game_storage_full" });
    await keep("KEPTXN", { savedSizeBytes: 1, lastPlayedAtMs: null, createdAtMs: 0 });
    await remember("KEPTXN");
    await expect(bringBackFromCopy(copies, game, "KEPTXN", caller, Date.now())).rejects.toMatchObject({ code: "room_code_in_use" });
    await env.DB.prepare("DELETE FROM kept_rooms WHERE room_code = 'KEPTXN'").run();
    await env.DB.prepare("INSERT INTO deleted_kept_rooms (game_id, room_code, saved_size_bytes, deleted_at_ms, bring_back_started_at_ms) VALUES (?, 'BGNEXX', ?, 1, ?)").bind(gameId, 100 * 1024 ** 3, Date.now()).run();
    await remember("LMTSXX");
    await expect(bringBackFromCopy(copies, game, "LMTSXX", caller, Date.now())).rejects.toMatchObject({ code: "slow_down" });
  });
});

describe("the MCP", () => {
  it("brings a waiting kept room back with bring_back_kept_room, and erase_kept_room_now asks for the tap", async () => {
    await env.DB.prepare("INSERT INTO games_ever_played (account_id, game_id, first_played_at_ms) VALUES ('another-player', ?, 1)").bind(gameId).run();
    await keep("K7Q2MX", { savedSizeBytes: 2048, lastPlayedAtMs: Date.now(), createdAtMs: Date.now() });
    const deleted = await tool("delete_kept_room", { slug: "frostbound", room_code: "K7Q2MX" });
    expect(deleted.erases_at).toEqual(expect.any(String));
    expect((await tool("erase_kept_room_now", { slug: "frostbound", room_code: "K7Q2MX" })).error.code).toBe("confirmation_needed");
    expect((await tool("bring_back_kept_room", { slug: "frostbound", room_code: "K7Q2MX" })).is_brought_back).toBe(true);
    expect((await tool("bring_back_kept_room", { slug: "frostbound", room_code: "K7Q2MX" })).error.code).toBe("kept_room_not_waiting");
  });

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
