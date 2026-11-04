import { REQUEST_LIMITS } from "@zaisma/game-server/internal";
import { answersJson, bodyProblem, doorPathPattern, isPastLevel, queryProblem, gameData, listOf, orNothing, text, yesOrNo, type DoorAnswer, type DoorCallerProvenByFunction, type DoorContract, type DoorLimit, type DoorLimitBindings, type DoorReach, type DoorShape, type DoorTakes, type DoorTrust } from "@zaisma/core";

/**
 * Every address on rooms.zaisma.com (docs/DOORS.md). The rooms Worker's fetch finds the row before anything else
 * runs, and an address with no row is answered as nothing there. A game's page is proven by its Origin, and a
 * player by their pass, each by the function named, since both take the request's body or the game's row.
 */
export interface RoomAddressDoor {
  method: "GET" | "POST" | "ANY";
  path: string;
  contract: DoorContract;
}

const INDEX = "apps/rooms/src/index.ts";
const PATH_PARTS: Readonly<Record<string, string>> = { player_id: "[a-z0-9_-]{1,60}", slug: "[a-z0-9-]{1,40}", room_code: "[A-Z0-9]{6}" };

const SLUG = text(40);
/** A pass, at most; playerToken and receipts fit in it too. */
const PASS = text(96 * 1024);
const ROOM_KEY = text(100);
const TESTER = { tester: text(40) };

/** An answer's top level, closed, with each field the shape it's sent in. */
const answerOf = (fields: Record<string, unknown>) => answersJson({ type: "object", properties: fields, required: Object.keys(fields), additionalProperties: false });
const JSON_TEXT = { type: "string" };
const JSON_FLAG = { type: "boolean" };
const JSON_NUMBER = { type: "number" };
const JSON_LIST = { type: "array" };
const JSON_OBJECT = { type: "object" };
const OPEN_ANSWER = answersJson(JSON_OBJECT);
const orNull = (type: string) => ({ type: [type, "null"] });
const eitherAnswer = (...answers: DoorAnswer[]) => answersJson({ anyOf: answers.map((answer) => (answer as { schema: unknown }).schema) });

/** Before a player is known, an address counts at the level a whole building clears. */
const BY_ADDRESS: DoorLimit = { level: "building", counts: "address" };
const FROM_MEMORY: DoorLimit = { whyNoLimit: "answers_from_memory" };

const open = (method: RoomAddressDoor["method"], path: string, answers: DoorAnswer, limit: DoorLimit, query: Record<string, DoorShape> = {}): RoomAddressDoor => ({
  method,
  path,
  contract: { whoMayCall: "anyone", reaches: "nothing_private", trusts: [], takes: { query, body: null }, answers, limit },
});
const proven = (
  method: RoomAddressDoor["method"],
  path: string,
  whoMayCall: DoorCallerProvenByFunction,
  symbolName: string,
  reaches: DoorReach,
  trusts: readonly DoorTrust[],
  takes: DoorTakes,
  answers: DoorAnswer,
  limit: DoorLimit,
): RoomAddressDoor => ({
  method,
  path,
  contract: { whoMayCall, reaches, trusts, provenBy: { source_path: INDEX, symbol_name: symbolName }, takes, answers, limit },
});
const jsonBody = (fields: Record<string, DoorShape>, required: readonly string[], maximumSizeBytes = 256 * 1024): DoorTakes => ({ query: {}, body: { kind: "json", fields, required, maximumSizeBytes } });

export const ROOM_ADDRESS_DOORS: readonly RoomAddressDoor[] = [
  open("ANY", "/", { kind: "redirect" }, FROM_MEMORY),
  open("ANY", "/.well-known/jwks.json", answerOf({ keys: JSON_LIST }), FROM_MEMORY),
  open("ANY", "/.well-known/receipt-jwks.json", answerOf({ keys: JSON_LIST }), FROM_MEMORY),
  open("GET", "/v1/players/:player_id", answerOf({ player: JSON_OBJECT }), BY_ADDRESS),
  proven("POST", "/v1/friends", "game_page", "answerFriends", "account", ["game_origin", "player_pass"], jsonBody({ gameSlug: SLUG, pass: PASS }, ["gameSlug"]), answerOf({ friends: JSON_LIST }), { level: "busy", counts: "player", group: "friends" }),
  proven(
    "POST",
    "/v1/friends/room",
    "game_page",
    "answerFriends",
    "account",
    ["game_origin", "player_pass"],
    jsonBody({ gameSlug: SLUG, pass: PASS, serverUrl: orNothing(text(1000)), roomCode: orNothing(text(40)), friendJoinsEnabled: yesOrNo }, ["gameSlug"]),
    answerOf({ isSet: JSON_FLAG }),
    { level: "busy", counts: "player", group: "friends" },
  ),
  proven(
    "POST",
    "/v1/chat/check",
    "pass_holder",
    "answerChatCheck",
    "room",
    ["player_pass"],
    jsonBody({ gameSlug: SLUG, senderPass: orNothing(PASS), receiverPasses: listOf(orNothing(PASS), 200), text: text(64 * 1024), recentTexts: listOf(text(64 * 1024), 100), isAdultFilterEnabled: yesOrNo }, ["gameSlug"], 4 * 1024 * 1024),
    OPEN_ANSWER,
    { level: "busy", counts: "player" },
  ),
  proven("POST", "/v1/items/unhandled", "game_page", "answerPurchases", "purchase", ["game_origin", "player_pass"], jsonBody({ gameSlug: SLUG, pass: PASS }, ["gameSlug"]), answerOf({ purchases: JSON_LIST }), { level: "busy", counts: "player", group: "items" }),
  proven("POST", "/v1/items/handled", "game_page", "answerPurchases", "purchase", ["game_origin", "player_pass"], jsonBody({ gameSlug: SLUG, pass: PASS, purchaseId: gameData(4096) }, ["gameSlug"]), answerOf({ isHandled: JSON_FLAG }), { level: "busy", counts: "player", group: "items" }),
  proven(
    "POST",
    "/v1/pass",
    "game_page",
    "isGameOrigin",
    "account",
    ["game_origin", "session"],
    jsonBody({ gameSlug: SLUG, roomKey: ROOM_KEY }, ["gameSlug"]),
    answerOf({ pass: JSON_TEXT, player: JSON_OBJECT, expiresAt: JSON_TEXT, playShare: JSON_TEXT }),
    { level: "steady", counts: "player" },
  ),
  proven("POST", "/v1/relay", "game_page", "isGameOrigin", "room", ["game_origin", "session"], jsonBody({ gameSlug: SLUG, roomKey: ROOM_KEY, playShare: text(400), hasGraphicsChip: yesOrNo, isInputSeen: yesOrNo }, ["gameSlug"]), answerOf({ iceServers: JSON_LIST, expiresAt: JSON_TEXT }), {
    level: "steady",
    counts: "player",
  }),
  proven("POST", "/v1/rooms", "game_page", "isGameOrigin", "room", ["game_origin"], jsonBody({ gameSlug: SLUG }, ["gameSlug"]), answerOf({ roomCode: JSON_TEXT }), BY_ADDRESS),
  proven(
    "POST",
    "/v1/report",
    "game_page",
    "isGameOrigin",
    "room",
    ["game_origin"],
    jsonBody({ gameSlug: SLUG, reason: text(100), roomCode: text(40), playerId: text(100), playerName: text(200), details: text(4000), chatMessages: gameData(4 * 1024 * 1024) }, ["gameSlug"], 4 * 1024 * 1024),
    answerOf({ isReported: JSON_FLAG }),
    BY_ADDRESS,
  ),
  proven(
    "POST",
    "/v1/filter",
    "game_page",
    "isGameOrigin",
    "nothing_private",
    ["game_origin"],
    jsonBody({ gameSlug: SLUG, text: text(64 * 1024) }, ["gameSlug"]),
    answerOf({ isAllowed: JSON_FLAG, reason: orNull("string"), message: orNull("string"), hasSwearing: JSON_FLAG, hasSlur: JSON_FLAG, text: JSON_TEXT }),
    BY_ADDRESS,
  ),
  proven(
    "POST",
    "/v1/requests/:slug",
    "game_page",
    "answerGameRequest",
    "game",
    ["game_origin", "player_pass"],
    { query: {}, body: { kind: "json", fields: { pass: PASS, request: gameData(REQUEST_LIMITS.maximumRequestSizeBytes), playShare: text(400), hasGraphicsChip: yesOrNo, isInputSeen: yesOrNo }, maximumSizeBytes: REQUEST_LIMITS.maximumRequestSizeBytes + REQUEST_LIMITS.maximumPassSizeBytes + 2048 } },
    answerOf({ answer: {} }),
    { level: "busy", counts: "player" },
  ),
  proven(
    "GET",
    "/v1/rooms/:slug",
    "game_page",
    "gameOrigin",
    "room",
    ["game_origin", "tester_link"],
    { query: { ...TESTER, left: text(40), region: text(40), labels: text(2000) }, body: null },
    answerOf({ rooms: JSON_LIST, playing: JSON_OBJECT, joinableRoomCount: JSON_NUMBER, openRoomCount: JSON_NUMBER, regions: JSON_LIST, region: orNull("string"), moreOpenRoomCount: JSON_NUMBER, filters: JSON_LIST }),
    BY_ADDRESS,
  ),
  proven("GET", "/v1/items/:slug", "game_page", "gameOrigin", "nothing_private", ["game_origin", "tester_link"], { query: TESTER, body: null }, answerOf({ items: JSON_LIST }), BY_ADDRESS),
  proven("GET", "/v1/rooms/:slug/:room_code", "game_page", "gameOrigin", "room", ["game_origin", "tester_link", "player_pass"], { query: TESTER, body: null }, { kind: "empty" }, BY_ADDRESS),
];

const patterns = ROOM_ADDRESS_DOORS.map((door) => ({ door, pattern: doorPathPattern(door.path, PATH_PARTS) }));

/** The row for a request, or null: an address and method with no row is nothing there. */
export function roomAddressDoorAt(path: string, method: string): RoomAddressDoor | null {
  return patterns.find(({ door, pattern }) => (door.method === "ANY" || door.method === method) && pattern.test(path))?.door ?? null;
}

/** The address's ceiling across all of rooms.zaisma.com, then the row's shape: each before any of the door's own code runs. Answers why it refuses, or null. */
export async function guardRoomDoor(request: Request, env: DoorLimitBindings, door: RoomAddressDoor): Promise<"past_limit" | { field: string; problem: string } | "too_big" | "bad_json" | null> {
  if (await isPastLevel(env, "building", "rooms", request.headers.get("cf-connecting-ip") ?? "local")) return "past_limit";
  const { takes } = door.contract;
  const problem = queryProblem(takes.query, new URL(request.url).searchParams, request.method === "GET");
  if (problem) return problem;
  const { body } = takes;
  if (!body || request.method === "GET" || request.method === "HEAD") return null;
  if (Number(request.headers.get("content-length") ?? 0) > body.maximumSizeBytes) return "too_big";
  if (body.kind !== "json") return null;
  const bodyText = await request.clone().text();
  if (bodyText.length > body.maximumSizeBytes) return "too_big";
  let given: unknown;
  try {
    given = JSON.parse(bodyText);
  } catch {
    return "bad_json";
  }
  if (!given || typeof given !== "object" || Array.isArray(given)) return "bad_json";
  return bodyProblem(body.fields, body.required ?? [], given as Record<string, unknown>);
}
