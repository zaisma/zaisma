import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { AREA_ACCESS_BY_LEVEL, createAccount, createApiKey, gameBySlug } from "@zaisma/core";
import { TOOLS } from "../../apps/site/src/mcp.ts";
import { EVERY_ROOM_SENT, LIVE_ROOM_WITH_PLAYERS, LIVE_ROOMS, ROOM_ENDED, ROOM_MESSAGE_CANCELLED, ROOM_MESSAGE_DELIVERED, ROOM_PLAYER_KICKED, SCHEDULED_ROOM_MESSAGES } from "../../apps/site/src/schemas.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";
import { letPublish } from "../helpers.ts";

// A game reaching its live rooms through the developer API and MCP (apps/site/src/room-messages-api.ts): the list
// from live_rooms, scheduled sends in scheduled_room_messages, and the rest through GAME_ROOMS, here the stand-in in
// test/site/rooms-database-worker.ts, which records each call and answers as asked. The real rooms:
// test/rooms/room-messages.test.ts.

const SITE = "https://zaisma.test";
let token = "";
let nextId = 1;
let gameId = "";

const rooms = () => env.GAME_ROOMS as unknown as { takeRoomReachCalls(nextAnswers?: Record<string, unknown>): Promise<{ call: string; asked: Record<string, unknown> }[]> };

async function api(method: string, path: string, body?: unknown, key = token) {
  const response = await SELF.fetch(`${SITE}/api/dev${path}`, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const answer = (await response.json()) as any;
  if (!response.ok) expect(errorProblems(answer, response.status)).toEqual([]);
  return { status: response.status, answer };
}

async function tool(name: string, toolArguments: Record<string, unknown>): Promise<any> {
  const response = await SELF.fetch(`${SITE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: toolArguments } }),
  });
  const { result } = (await response.json()) as any;
  if (result.isError) {
    expect(errorProblems(result.structuredContent)).toEqual([]);
    return result.structuredContent;
  }
  expect(schemaProblems(TOOLS.find((candidate) => candidate.name === name)!.outputSchema!, result.structuredContent, name)).toEqual([]);
  return result.structuredContent;
}

async function addLiveRoom(roomCode: string, fields: { labels?: Record<string, string>; createdAtMs: number; playerCount?: number; updatedAtMs?: number; isKept?: boolean }) {
  await env.DB.prepare("INSERT INTO live_rooms (game_id, room_code, player_count, held_seat_count, maximum_player_count, spectator_count, maximum_spectator_count, is_listed, is_open, friend_joins_enabled, name, labels, country, continent, version_id, is_kept, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 0, 8, 0, 0, 1, 1, 1, NULL, ?, 'DE', 'EU', NULL, ?, ?, ?)")
    .bind(gameId, roomCode, fields.playerCount ?? 1, JSON.stringify(fields.labels ?? {}), fields.isKept ? 1 : 0, fields.createdAtMs, fields.updatedAtMs ?? Date.now())
    .run();
}

const readKey = () => createApiKey(env.DB, "dev-1", "reader", { accessLevel: "custom", areaAccess: { ...AREA_ACCESS_BY_LEVEL.full, game_access: "read" }, gameSlugs: null }).then((made) => made.token);

beforeEach(async () => {
  await env.DB.exec("DELETE FROM scheduled_room_messages; DELETE FROM live_rooms; DELETE FROM security_events; DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;");
  await createAccount(env.DB, { id: "dev-1", username: "Pixel_Smith", ageBand: "18+" });
  await letPublish(env.DB, "dev-1");
  token = (await createApiKey(env.DB, "dev-1", "claude")).token;
  const made = await SELF.fetch(`${SITE}/api/dev/games`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ title: "Frostbound", slug: "frostbound" }) });
  expect(made.status).toBe(201);
  gameId = (await gameBySlug(env.DB, "frostbound"))!.id;
  await rooms().takeRoomReachCalls();
});

describe("reaching live rooms through the API and MCP", () => {
  it("lists the game's live rooms newest first, by labels and a page at a time, and never a stopped room", async () => {
    const nowMs = Date.now();
    await addLiveRoom("AAAAAA", { createdAtMs: nowMs - 3000, labels: { Region: "North" } });
    await addLiveRoom("BBBBBB", { createdAtMs: nowMs - 2000, labels: { Region: "South" } });
    await addLiveRoom("CCCCCC", { createdAtMs: nowMs - 1000, labels: { Region: "North", Mode: "Hardcore" } });
    // A room that stopped checking in, and a kept room asleep with nobody in it.
    await addLiveRoom("DDDDDD", { createdAtMs: nowMs - 9000, updatedAtMs: nowMs - 3 * 3600_000 });
    await addLiveRoom("KKKKKK", { createdAtMs: nowMs - 8000, updatedAtMs: nowMs - 3 * 3600_000, playerCount: 0, isKept: true });

    const listed = await tool("list_rooms", { slug: "frostbound" });
    expect(listed.rooms.map((room: { room_code: string }) => room.room_code)).toEqual(["CCCCCC", "BBBBBB", "AAAAAA", "KKKKKK"]);
    expect(listed.room_count).toBe(4);
    expect(listed.next_cursor).toBeNull();
    expect(listed.rooms[0]).toEqual({ room_code: "CCCCCC", name: null, labels: { Region: "North", Mode: "Hardcore" }, player_count: 1, maximum_player_count: 8, spectator_count: 0, is_listed: true, is_open: true, is_kept: false, version_id: null, continent: "EU", created_at: new Date(nowMs - 1000).toISOString() });
    expect((await tool("list_rooms", { slug: "frostbound", labels: { Region: "North" } })).rooms.map((room: { room_code: string }) => room.room_code)).toEqual(["CCCCCC", "AAAAAA"]);

    const { status, answer } = await api("GET", "/games/frostbound/rooms?labels=north");
    expect([status, answer.error.code, answer.error.field]).toEqual([400, "bad_labels", "labels"]);
    expect((await api("GET", "/games/frostbound/rooms?cursor=cursor_nope")).answer.error.code).toBe("bad_cursor");
    expect(schemaProblems(LIVE_ROOMS, (await api("GET", "/games/frostbound/rooms")).answer)).toEqual([]);
  });

  it("looks into one room through the rooms, and says no_room for a room that isn't running", async () => {
    const found = await tool("get_room", { slug: "frostbound", room_code: "K7Q2MX" });
    expect(schemaProblems(LIVE_ROOM_WITH_PLAYERS, found)).toEqual([]);
    expect(found.players).toEqual([{ player_id: "player_standinplayer000001", name: "Ana", kind: "account", is_away: false, away_reason: null, joined_at: "2026-10-29T12:00:00.000Z", is_spectator: false }]);
    expect(await rooms().takeRoomReachCalls({ getRoom: null })).toEqual([{ call: "getRoom", asked: { gameId, slug: "frostbound", roomCode: "K7Q2MX" } }]);
    const missing = await tool("get_room", { slug: "frostbound", room_code: "K7Q2MX" });
    expect([missing.error.code, missing.error.field]).toEqual(["no_room", "room_code"]);
  });

  it("sends a message to one room, refusing what isn't plain JSON within 16 KB, and says when the room is gone or busy", async () => {
    const sent = await api("POST", "/games/frostbound/rooms/k7q2mx/messages", { message: { kind: "freeze", player_id: "player_x" } });
    expect(schemaProblems(ROOM_MESSAGE_DELIVERED, sent.answer)).toEqual([]);
    expect(await rooms().takeRoomReachCalls({ sendRoomMessage: { deliveryOutcome: "no_room" } })).toEqual([{ call: "sendRoomMessage", asked: { gameId, slug: "frostbound", roomCode: "K7Q2MX", message: { kind: "freeze", player_id: "player_x" } } }]);
    expect((await tool("send_room_message", { slug: "frostbound", room_code: "K7Q2MX", message: "hello" })).error.code).toBe("no_room");
    await rooms().takeRoomReachCalls({ sendRoomMessage: { deliveryOutcome: "room_busy" } });
    const busy = await api("POST", "/games/frostbound/rooms/K7Q2MX/messages", { message: 1 });
    expect([busy.status, busy.answer.error.code, busy.answer.error.retry_after_sec]).toEqual([429, "room_busy", 1]);
    await rooms().takeRoomReachCalls();
    for (const message of [null, "x".repeat(17 * 1024)]) {
      const refused = await api("POST", "/games/frostbound/rooms/K7Q2MX/messages", { message });
      expect([refused.status, refused.answer.error.code, refused.answer.error.field]).toEqual([400, "bad_room_message", "message"]);
    }
    expect((await api("POST", "/games/frostbound/rooms/NOPE/messages", { message: 1 })).answer.error.code).toBe("bad_room_code");
    expect(await rooms().takeRoomReachCalls()).toEqual([]);
  });

  it("sends to every room now, past the game's limit refuses, and only a write key sends", async () => {
    const sent = await tool("send_to_every_room", { slug: "frostbound", message: { kind: "announcement" }, labels: { Region: "North" } });
    expect(sent).toMatchObject({ room_count: 3, scheduled_room_message: null });
    expect(schemaProblems(EVERY_ROOM_SENT, sent)).toEqual([]);
    expect(await rooms().takeRoomReachCalls({ sendToEveryRoom: { roomCount: 0, isLimited: true } })).toEqual([{ call: "sendToEveryRoom", asked: { gameId, slug: "frostbound", labels: { Region: "North" }, message: { kind: "announcement" } } }]);
    const limited = await api("POST", "/games/frostbound/room-messages", { message: 1 });
    expect([limited.status, limited.answer.error.code]).toEqual([429, "every_room_send_limit"]);
    await rooms().takeRoomReachCalls();
    expect((await api("POST", "/games/frostbound/room-messages", { message: 1, labels: ["North"] })).answer.error.code).toBe("bad_labels");
    const reader = await readKey();
    expect((await api("POST", "/games/frostbound/room-messages", { message: 1 }, reader)).answer.error.code).toBe("key_not_allowed");
    expect((await api("GET", "/games/frostbound/rooms", undefined, reader)).status).toBe(200);
  });

  it("schedules a send to every room, lists it, cancels it, and refuses a time out of range or past 100 waiting", async () => {
    const sendAt = new Date(Date.now() + 3600_000).toISOString();
    const scheduled = await tool("send_to_every_room", { slug: "frostbound", message: { kind: "blood_moon" }, send_at: sendAt });
    expect(scheduled.room_count).toBeNull();
    expect(scheduled.scheduled_room_message).toEqual({ id: expect.stringMatching(/^scheduled_room_message_[a-z0-9]+$/), send_at: new Date(Date.parse(sendAt)).toISOString(), labels: null, created_at: expect.any(String) });
    expect(scheduled.next_steps.map((step: { tool: string }) => step.tool)).toEqual(["list_room_messages", "cancel_room_message"]);
    expect(await rooms().takeRoomReachCalls()).toEqual([]);

    const listed = await api("GET", "/games/frostbound/room-messages");
    expect(schemaProblems(SCHEDULED_ROOM_MESSAGES, listed.answer)).toEqual([]);
    expect(listed.answer.scheduled_room_messages).toEqual([{ id: scheduled.scheduled_room_message.id, message: { kind: "blood_moon" }, labels: null, send_at: scheduled.scheduled_room_message.send_at, created_at: expect.any(String), sent_at: null, delivered_room_count: null }]);

    for (const given of ["tomorrow", new Date(Date.now() + 1000).toISOString(), new Date(Date.now() + 91 * 86400_000).toISOString()]) {
      const refused = await api("POST", "/games/frostbound/room-messages", { message: 1, send_at: given });
      expect([refused.status, refused.answer.error.code, refused.answer.error.field]).toEqual([400, "bad_time", "send_at"]);
    }

    const cancelled = await api("DELETE", `/games/frostbound/room-messages/${scheduled.scheduled_room_message.id}`);
    expect(schemaProblems(ROOM_MESSAGE_CANCELLED, cancelled.answer)).toEqual([]);
    expect((await tool("cancel_room_message", { slug: "frostbound", scheduled_room_message_id: scheduled.scheduled_room_message.id })).error.code).toBe("no_scheduled_room_message");
    expect((await api("DELETE", "/games/frostbound/room-messages/version_abc")).answer.error.code).toBe("wrong_id_kind");

    const nowMs = Date.now();
    await env.DB.batch(Array.from({ length: 100 }, (_, index) => env.DB.prepare("INSERT INTO scheduled_room_messages (id, game_id, room_message_json, send_at_ms, created_at_ms) VALUES (?, ?, '1', ?, ?)").bind(`scheduled_room_message_full${index}`, gameId, nowMs + 3600_000, nowMs)));
    const full = await api("POST", "/games/frostbound/room-messages", { message: 1, send_at: sendAt });
    expect([full.status, full.answer.error.code]).toEqual([409, "too_many_scheduled_room_messages"]);
  });

  it("removes a player from a room, and ends a room only with confirm, each in the game's history", async () => {
    const kicked = await tool("kick_player", { slug: "frostbound", room_code: "K7Q2MX", player_id: "player_ana0000000000000001", message: "Removed for griefing.", is_kept_out: true });
    expect(schemaProblems(ROOM_PLAYER_KICKED, kicked)).toEqual([]);
    expect(await rooms().takeRoomReachCalls({ kickPlayer: { kickOutcome: "no_player_in_room" } })).toEqual([{ call: "kickPlayer", asked: { gameId, slug: "frostbound", roomCode: "K7Q2MX", playerId: "player_ana0000000000000001", message: "Removed for griefing.", isKeptOut: true } }]);
    expect((await api("POST", "/games/frostbound/rooms/K7Q2MX/kick", { player_id: "player_ana0000000000000001" })).answer.error.code).toBe("no_player_in_room");
    await rooms().takeRoomReachCalls();
    expect((await api("POST", "/games/frostbound/rooms/K7Q2MX/kick", { player_id: "ana" })).answer.error.code).toBe("bad_player_id");
    expect((await api("POST", "/games/frostbound/rooms/K7Q2MX/kick", { player_id: "player_ana0000000000000001", message: "x".repeat(201) })).answer.error.code).toBe("bad_kick_message");

    const unconfirmed = await tool("end_room", { slug: "frostbound", room_code: "K7Q2MX" });
    expect([unconfirmed.error.code, unconfirmed.error.field]).toEqual(["needs_confirm", "confirm"]);
    expect(await rooms().takeRoomReachCalls()).toEqual([]);
    const ended = await tool("end_room", { slug: "frostbound", room_code: "K7Q2MX", message: "Closing for maintenance.", confirm: true });
    expect(schemaProblems(ROOM_ENDED, ended)).toEqual([]);
    expect(await rooms().takeRoomReachCalls()).toEqual([{ call: "endRoom", asked: { gameId, slug: "frostbound", roomCode: "K7Q2MX", message: "Closing for maintenance." } }]);

    const history = (await env.DB.prepare("SELECT action FROM audit_log WHERE game_id = ? AND action LIKE 'room-%' ORDER BY rowid").bind(gameId).all<{ action: string }>()).results.map((row) => row.action);
    expect(history).toEqual(["room-player-kicked", "room-ended"]);
  });
});
