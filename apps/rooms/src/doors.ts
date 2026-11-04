import { doorPathPattern, type DoorCallerProvenByFunction, type DoorContract, type DoorReach, type DoorTrust } from "@zaisma/core";

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

const open = (method: RoomAddressDoor["method"], path: string, reaches: DoorReach = "nothing_private"): RoomAddressDoor => ({ method, path, contract: { whoMayCall: "anyone", reaches, trusts: [] } });
const proven = (method: RoomAddressDoor["method"], path: string, whoMayCall: DoorCallerProvenByFunction, symbolName: string, reaches: DoorReach, trusts: readonly DoorTrust[]): RoomAddressDoor => ({
  method,
  path,
  contract: { whoMayCall, reaches, trusts, provenBy: { source_path: INDEX, symbol_name: symbolName } },
});

export const ROOM_ADDRESS_DOORS: readonly RoomAddressDoor[] = [
  open("ANY", "/"),
  open("ANY", "/.well-known/jwks.json"),
  open("ANY", "/.well-known/receipt-jwks.json"),
  open("GET", "/v1/players/:player_id"),
  proven("POST", "/v1/friends", "game_page", "answerFriends", "account", ["game_origin", "player_pass"]),
  proven("POST", "/v1/friends/room", "game_page", "answerFriends", "account", ["game_origin", "player_pass"]),
  proven("POST", "/v1/chat/check", "pass_holder", "answerChatCheck", "room", ["player_pass"]),
  proven("POST", "/v1/items/unhandled", "game_page", "answerPurchases", "purchase", ["game_origin", "player_pass"]),
  proven("POST", "/v1/items/handled", "game_page", "answerPurchases", "purchase", ["game_origin", "player_pass"]),
  proven("POST", "/v1/pass", "game_page", "isGameOrigin", "account", ["game_origin", "session"]),
  proven("POST", "/v1/relay", "game_page", "isGameOrigin", "room", ["game_origin", "player_pass"]),
  proven("POST", "/v1/rooms", "game_page", "isGameOrigin", "room", ["game_origin", "player_pass"]),
  proven("POST", "/v1/report", "game_page", "isGameOrigin", "room", ["game_origin", "player_pass"]),
  proven("POST", "/v1/filter", "game_page", "isGameOrigin", "nothing_private", ["game_origin"]),
  proven("POST", "/v1/requests/:slug", "game_page", "answerGameRequest", "game", ["game_origin", "player_pass"]),
  proven("GET", "/v1/rooms/:slug", "game_page", "gameOrigin", "room", ["game_origin", "tester_link"]),
  proven("GET", "/v1/items/:slug", "game_page", "gameOrigin", "nothing_private", ["game_origin", "tester_link"]),
  proven("GET", "/v1/rooms/:slug/:room_code", "game_page", "gameOrigin", "room", ["game_origin", "tester_link", "player_pass"]),
];

const patterns = ROOM_ADDRESS_DOORS.map((door) => ({ door, pattern: doorPathPattern(door.path, PATH_PARTS) }));

/** The row for a request, or null: an address and method with no row is nothing there. */
export function roomAddressDoorAt(path: string, method: string): RoomAddressDoor | null {
  return patterns.find(({ door, pattern }) => (door.method === "ANY" || door.method === method) && pattern.test(path))?.door ?? null;
}
