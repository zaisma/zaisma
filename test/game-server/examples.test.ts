import { describe, expect, it } from "vitest";
import { RoomCore, defineGameServer, type Transport } from "../../packages/game-server/src/index.ts";
import arena from "../../examples/arena/server.ts";
import fourInARow from "../../examples/four-in-a-row/server.ts";

function transport() {
  const sent: Record<string, any[]> = {};
  const t: Transport = { send: (id, text) => (sent[id] ??= []).push(JSON.parse(text)), close: () => {} };
  return { t, sent, last: (id: string) => sent[id]!.filter((message) => message.type === "message").at(-1)?.data };
}
const msg = (data: unknown) => JSON.stringify({ type: "message", data });

describe("arena", () => {
  it("adds bots for a lone player and removes them when a friend joins", () => {
    const { t, last } = transport();
    const room = new RoomCore(defineGameServer(arena), t);
    room.join({ id: "a", name: "A", kind: "guest" });
    room.tick(0.05);
    expect(last("a").snapshot).toHaveLength(3);
    room.join({ id: "b", name: "B", kind: "guest" });
    room.tick(0.05);
    expect(last("a").snapshot.map((body: { id: string }) => body.id).sort()).toEqual(["a", "b"]);
  });

  it("moves players by their input and ignores junk", () => {
    const { t, last } = transport();
    const room = new RoomCore(defineGameServer(arena), t);
    room.join({ id: "a", name: "A", kind: "guest" });
    room.join({ id: "b", name: "B", kind: "guest" });
    room.tick(0.05);
    const before = last("a").snapshot.find((body: { id: string }) => body.id === "a");
    room.receive("a", msg({ input: [1, 0] }));
    room.receive("a", msg({ input: ["x", null] }));
    for (let i = 0; i < 5; i++) room.tick(0.05);
    const after = last("a").snapshot.find((body: { id: string }) => body.id === "a");
    expect(after.x).toBeGreaterThan(before.x);
  });

  it("takes the color a player brings as join data", () => {
    const { t, last } = transport();
    const room = new RoomCore(defineGameServer(arena), t);
    room.join({ id: "a", name: "A", kind: "guest" }, { joinData: { color: "#7dff8a" } });
    room.tick(0.05);
    expect(last("a").snapshot.find((body: { id: string }) => body.id === "a").color).toBe("#7dff8a");
  });
});

describe("four in a row", () => {
  const play = () => {
    const tr = transport();
    const room = new RoomCore(defineGameServer(fourInARow), tr.t);
    room.join({ id: "a", name: "A", kind: "guest" });
    room.join({ id: "b", name: "B", kind: "guest" });
    return { room, ...tr };
  };

  it("takes turns, drops pieces to the bottom and finds a win", () => {
    const { room, last } = play();
    room.receive("b", msg({ column: 0 })); // not b's turn
    expect(last("a").board[35]).toBe(0);
    for (const [who, column] of [["a", 0], ["b", 1], ["a", 0], ["b", 1], ["a", 0], ["b", 1], ["a", 0]] as const) room.receive(who, msg({ column }));
    const game = last("a");
    expect(game.board[35]).toBe(1);
    expect(game.winnerSeat).toBe(1);
    expect(game.winningCells.sort((x: number, y: number) => x - y)).toEqual([14, 21, 28, 35]);
    room.receive("b", msg({ playAgain: true }));
    expect(last("a")).toMatchObject({ winnerSeat: 0, isDraw: false, turnSeat: 2 });
  });

  it("keeps a player's seat when they come back, and spectators can't move", () => {
    const { room, last } = play();
    room.join({ id: "c", name: "C", kind: "guest" });
    room.receive("c", msg({ column: 3 }));
    expect(last("c").board.every((cell: number) => cell === 0)).toBe(true);
    room.leave("a");
    room.join({ id: "a", name: "A", kind: "guest" });
    expect(last("a").seatPlayerIds).toEqual(["a", "b"]);
  });
});
