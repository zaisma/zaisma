import { describe, expect, it } from "vitest";
import { RoomCore, applyStateChanges, defineGameServer, type Transport } from "../../packages/game-server/src/internal.ts";
import arena from "../../examples/arena/server.ts";
import fourInARow from "../../examples/four-in-a-row/server.ts";

function transport() {
  const sent: Record<string, any[]> = {};
  const t: Transport = { roomCode: "K7Q2MX", send: (id, text) => (sent[id] ??= []).push(JSON.parse(text)), close: () => {} };
  return { t, sent, last: (id: string) => sent[id]!.filter((message) => message.type === "message").at(-1)?.data };
}
const msg = (data: unknown) => JSON.stringify({ type: "message", data });

describe("arena", () => {
  /** The room as each player's game sees it: its messages, and its view of the state, as the SDK builds it from state updates. */
  function arenaRoom() {
    const { t, sent } = transport();
    const room = new RoomCore(defineGameServer(arena), t);
    /** A player's world now: every state update they got, applied in order. */
    const world = (id: string) => {
      let state: unknown = null;
      for (const message of sent[id]!) {
        if (message.type !== "state") continue;
        state = "full" in message ? message.full : applyStateChanges(state, message.changes);
      }
      return state as { bodies: Record<string, { x: number; y: number; score: number; color: string; name: string; isDashing: boolean; isOut: boolean }> };
    };
    return { room, sent, world };
  }

  it("adds bots for a lone player and removes them when a friend joins", () => {
    const { room, world } = arenaRoom();
    room.join({ id: "a", name: "A", kind: "guest" });
    room.tick(0.05);
    expect(Object.keys(world("a").bodies)).toHaveLength(3);
    room.join({ id: "b", name: "B", kind: "guest" });
    room.tick(0.05);
    expect(Object.keys(world("a").bodies).sort()).toEqual(["a", "b"]);
    // The friend's game got a full copy as they joined, the same world.
    expect(world("b")).toEqual(world("a"));
  });

  it("moves players by their input and ignores junk, sending only what changed", () => {
    const { room, sent, world } = arenaRoom();
    room.join({ id: "a", name: "A", kind: "guest" });
    room.join({ id: "b", name: "B", kind: "guest" });
    // Players start at random places: b stands behind a, so a moving right never bumps into b.
    Object.assign(room.state.bodies.a!, { x: 0, y: 0 });
    Object.assign(room.state.bodies.b!, { x: -120, y: 0 });
    room.tick(0.05);
    const before = world("a").bodies.a!;
    room.receive("a", msg({ input: [1, 0] }));
    room.receive("a", msg({ input: ["x", null] }));
    for (let i = 0; i < 5; i++) room.tick(0.05);
    expect(world("a").bodies.a!.x).toBeGreaterThan(before.x);
    // After the full copy, only a's position changes: b stands still.
    const changes = sent.b!.filter((message) => message.type === "state" && "changes" in message).at(-1).changes as [(string | number)[], unknown][];
    expect(changes.every(([path]) => path[1] === "a")).toBe(true);
    // Nothing of the game server's physics goes out.
    expect(Object.keys(world("b").bodies.a!).sort()).toEqual(["color", "isDashing", "isOut", "name", "score", "x", "y"]);
  });

  it("takes the color a player brings as join data", () => {
    const { room, world } = arenaRoom();
    room.join({ id: "a", name: "A", kind: "guest" }, { joinData: { color: "#7dff8a" } });
    room.tick(0.05);
    expect(world("a").bodies.a!.color).toBe("#7dff8a");
  });

  it("freezes a player whose connection dropped, keeping their place and score, until they're back", () => {
    const { room, world } = arenaRoom();
    room.join({ id: "a", name: "A", kind: "guest" });
    room.join({ id: "b", name: "B", kind: "guest" });
    room.receive("a", msg({ input: [1, 0] }));
    room.tick(0.05);
    room.leave("a", "lost");
    room.tick(0.05);
    const frozen = world("b").bodies.a!;
    for (let i = 0; i < 10; i++) room.tick(0.05);
    expect(world("b").bodies.a).toMatchObject({ x: frozen.x, y: frozen.y, score: frozen.score });
    // Back: the same body, moving again on new input.
    room.join({ id: "a", name: "A", kind: "guest" });
    room.receive("a", msg({ input: [1, 0] }));
    for (let i = 0; i < 5; i++) room.tick(0.05);
    expect(world("a").bodies.a!.x).toBeGreaterThan(frozen.x);
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

  it("gives a player whose connection dropped the board when they're back, their seat kept meanwhile", () => {
    const { room, sent, last } = play();
    room.receive("a", msg({ column: 3 }));
    room.leave("a", "lost");
    room.join({ id: "c", name: "C", kind: "guest" });
    expect(last("c").seatPlayerIds).toEqual(["a", "b"]);
    sent.a = [];
    room.join({ id: "a", name: "A", kind: "guest" });
    expect(last("a")).toMatchObject({ seatPlayerIds: ["a", "b"], turnSeat: 2 });
    expect(last("a").board[38]).toBe(1);
  });

  it("pairs only lobby players who are playing, and a player back from a dropped connection once they're back", () => {
    const tr = transport();
    const lobby = new RoomCore(defineGameServer(fourInARow), { ...tr.t, reserve: (code, start) => reserved.push(start.playerIds) });
    const reserved: string[][] = [];
    // The player who makes the room labels it the lobby, as the game does.
    lobby.join({ id: "a", name: "A", kind: "guest" }, { labels: { Room: "Lobby" } });
    lobby.leave("a", "lost");
    lobby.join({ id: "b", name: "B", kind: "guest" });
    expect(reserved).toEqual([]);
    lobby.join({ id: "a", name: "A", kind: "guest" });
    expect(reserved).toEqual([["a", "b"]]);
  });
});
