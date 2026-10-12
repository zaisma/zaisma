import { describe, expect, it } from "vitest";
import { RoomCore, defineGameServer, type Transport } from "../../packages/game-server/src/index.ts";
import arena from "../../examples/arena/server.ts";
import fourInARow from "../../examples/four-in-a-row/server.ts";

function transport() {
  const sent: Record<string, any[]> = {};
  const t: Transport = { send: (id, text) => (sent[id] ??= []).push(JSON.parse(text)), close: () => {} };
  return { t, sent, last: (id: string) => sent[id]!.filter((m) => m.t === "msg").at(-1)?.d };
}
const msg = (d: unknown) => JSON.stringify({ t: "msg", d });

describe("arena", () => {
  it("adds bots for a lone player and removes them when a friend joins", () => {
    const { t, last } = transport();
    const room = new RoomCore(defineGameServer(arena), t);
    room.join({ id: "a", name: "A" });
    room.tick(0.05);
    expect(last("a").s).toHaveLength(3);
    room.join({ id: "b", name: "B" });
    room.tick(0.05);
    expect(last("a").s.map((r: any[]) => r[0]).sort()).toEqual(["a", "b"]);
  });

  it("moves players by their input and ignores junk", () => {
    const { t, last } = transport();
    const room = new RoomCore(defineGameServer(arena), t);
    room.join({ id: "a", name: "A" });
    room.join({ id: "b", name: "B" });
    room.tick(0.05);
    const before = last("a").s.find((r: any[]) => r[0] === "a");
    room.receive("a", msg({ i: [1, 0] }));
    room.receive("a", msg({ i: ["x", null] }));
    for (let i = 0; i < 5; i++) room.tick(0.05);
    const after = last("a").s.find((r: any[]) => r[0] === "a");
    expect(after[1]).toBeGreaterThan(before[1]);
  });
});

describe("four in a row", () => {
  const play = () => {
    const tr = transport();
    const room = new RoomCore(defineGameServer(fourInARow), tr.t);
    room.join({ id: "a", name: "A" });
    room.join({ id: "b", name: "B" });
    return { room, ...tr };
  };

  it("takes turns, drops pieces to the bottom and finds a win", () => {
    const { room, last } = play();
    room.receive("b", msg({ col: 0 })); // not b's turn
    expect(last("a").board[35]).toBe(0);
    for (const [who, col] of [["a", 0], ["b", 1], ["a", 0], ["b", 1], ["a", 0], ["b", 1], ["a", 0]] as const) room.receive(who, msg({ col }));
    const s = last("a");
    expect(s.board[35]).toBe(1);
    expect(s.winner).toBe(1);
    expect(s.line.sort((x: number, y: number) => x - y)).toEqual([14, 21, 28, 35]);
  });

  it("keeps a player's seat when they come back, and spectators can't move", () => {
    const { room, last } = play();
    room.join({ id: "c", name: "C" });
    room.receive("c", msg({ col: 3 }));
    expect(last("c").board.every((v: number) => v === 0)).toBe(true);
    room.leave("a");
    room.join({ id: "a", name: "A" });
    expect(last("a").seats).toEqual(["a", "b"]);
  });
});
