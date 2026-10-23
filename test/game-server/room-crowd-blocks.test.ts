import { describe, expect, it } from "vitest";
import { MAXIMUM_OTHER_PLAYER_COUNT, blocksAmong, friendsAmong } from "../../packages/core/src/index.ts";
import { ROOM_LIMITS, RoomCore, defineGameServer } from "../../packages/game-server/src/index.ts";

// A stand-in database that answers the two queries over in-memory rows, honouring the bound player lists as the SQL does.
function standInDatabase(blocks: [string, string][], friendships: [string, string][]) {
  return {
    prepare: (sql: string) => ({
      bind: (...bound: string[]) => ({
        all: async () => {
          const [me, othersJson] = bound as [string, string];
          const others = new Set<string>(JSON.parse(othersJson));
          if (sql.includes("FROM blocks")) {
            return { results: blocks.filter(([blocker, blocked]) => (blocker === me && others.has(blocked)) || (blocked === me && others.has(blocker))).map(([blocker, blocked]) => ({ blocker_player_id: blocker, blocked_player_id: blocked })) };
          }
          return { results: friendships.filter(([mine, friend]) => mine === me && others.has(friend)).map(([, friend]) => ({ player_id: friend })) };
        },
      }),
    }),
  } as unknown as D1Database;
}

/** Players p1 to p<count> join in order, each looked up against the room's remembered players the way Zaisma's rooms do as they join. */
async function fillRoom(database: D1Database, count: number) {
  const room = new RoomCore(defineGameServer({ maximumPlayerCount: ROOM_LIMITS.maximumPlayerCount, setup: () => ({}) }), { send() {}, sendBytes() {}, close() {} } as never);
  for (let number = 1; number <= count; number++) {
    const player = { id: `p${number}`, name: `p${number}`, kind: "account" as const };
    if (room.known.size > 0) {
      const blocks = await blocksAmong(database, player.id, [...room.known]);
      room.setAccountBlocks(player.id, blocks.map((block) => (block.blocker_player_id === player.id ? block.blocked_player_id : block.blocker_player_id)));
      room.setFriends(player.id, await friendsAmong(database, player.id, [...room.known]));
    }
    expect(room.join(player).isAllowed).toBe(true);
  }
  return room;
}

describe("A full room's blocks and friends", () => {
  it("looks them up among as many players as a room holds", () => {
    expect(MAXIMUM_OTHER_PLAYER_COUNT).toBeGreaterThanOrEqual(ROOM_LIMITS.maximumPlayerCount);
  });

  it("finds a block and a friendship between the first player and the 66th of 100", async () => {
    const database = standInDatabase([["p66", "p1"]], [["p66", "p2"], ["p2", "p66"]]);
    const room = await fillRoom(database, 100);
    expect(room.players.size).toBe(100);
    expect(room.hasBlockBetween("p1", "p66")).toBe(true);
    expect(room.areFriends("p2", "p66")).toBe(true);
  });

  it("finds them for the last player to join a full room", async () => {
    const database = standInDatabase([["p100", "p1"]], [["p100", "p3"], ["p3", "p100"]]);
    const room = await fillRoom(database, 100);
    expect(room.hasBlockBetween("p1", "p100")).toBe(true);
    expect(room.areFriends("p3", "p100")).toBe(true);
  });
});
