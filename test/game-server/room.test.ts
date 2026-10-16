import { describe, expect, it, vi } from "vitest";
import { GameServerError, RoomCore, defineGameServer, isRoomCode, readJoinAnswer, relay, ROOM_LIMITS, type GameServer, type MoveAnswer, type RoomStart, type Transport } from "../../packages/game-server/src/index.ts";

function transport() {
  const sent: Record<string, any[]> = {};
  const closed: string[] = [];
  const t: Transport = {
    send: (id, text) => (sent[id] ??= []).push(JSON.parse(text)),
    close: (id) => closed.push(id),
  };
  return { t, sent, closed };
}

const counter = defineGameServer({
  maximumPlayerCount: 2,
  setup: () => ({ count: 0, joined: [] as string[], left: [] as string[] }),
  onJoin: (s, p) => void s.joined.push(p.id),
  onLeave: (s, p) => void s.left.push(p.id),
  onMessage(s, p, message, room) {
    if (message === "boom") throw new Error("game bug");
    if (message === "end") return room.end("Someone won");
    s.count++;
    room.broadcast({ count: s.count, by: p.id });
  },
});

const msg = (data: unknown) => JSON.stringify({ type: "message", data });
const nobodyJoined = { fromRoomCode: null, isReturning: false };

describe("RoomCore", () => {
  it("runs join, message and leave through the game server", () => {
    const { t, sent } = transport();
    const room = new RoomCore(counter, t);
    room.join({ id: "a", name: "A", kind: "guest" });
    room.join({ id: "b", name: "B", kind: "guest" });
    expect(sent.a![0]).toEqual({
      type: "welcome",
      me: { id: "a", name: "A", kind: "guest" },
      players: [{ id: "a", name: "A", kind: "guest" }],
      room: { isListed: true, isOpen: true, name: null, labels: {} },
      hostPlayerId: null,
      awayChecks: { idleTimeoutSec: 600, hiddenTimeoutSec: null },
    });
    expect(sent.a!.at(-1)).toEqual({ type: "players", players: [{ id: "a", name: "A", kind: "guest" }, { id: "b", name: "B", kind: "guest" }], hostPlayerId: null });

    expect(room.receive("a", msg("hit"))).toBeNull();
    expect(sent.b!.at(-1)).toEqual({ type: "message", data: { count: 1, by: "a" } });

    room.leave("b");
    expect(room.state.left).toEqual(["b"]);
    expect(sent.a!.at(-1)).toEqual({ type: "players", players: [{ id: "a", name: "A", kind: "guest" }], hostPlayerId: null });
  });

  it("caps players, and a reconnect keeps the same place without joining twice", () => {
    const { t } = transport();
    const room = new RoomCore(counter, t);
    room.join({ id: "a", name: "A", kind: "guest" });
    room.join({ id: "b", name: "B", kind: "guest" });
    expect(room.join({ id: "c", name: "C", kind: "guest" })).toEqual({ isAllowed: false, code: "full" });
    expect(room.join({ id: "a", name: "A", kind: "guest" })).toEqual({ isAllowed: true, isRejoin: true });
    expect(room.state.joined).toEqual(["a", "b"]);
  });

  it("refuses big, malformed and flooding messages, and the old short message shape", () => {
    let now = 0;
    const room = new RoomCore(counter, transport().t, { now: () => now });
    room.join({ id: "a", name: "A", kind: "guest" });
    expect(room.receive("a", msg("x".repeat(ROOM_LIMITS.maximumGameMessageSizeBytes)))).toBe("too_big");
    expect(room.receive("a", "not json")).toBe("bad_message");
    expect(room.receive("a", JSON.stringify({ hello: 1 }))).toBe("bad_message");
    expect(room.receive("a", JSON.stringify({ t: "msg", d: "hit" }))).toBe("bad_message");

    let refused = 0;
    for (let i = 0; i < 200; i++) if (room.receive("a", msg("hit")) === "too_fast") refused++;
    expect(refused).toBeGreaterThan(100);
    now += 1000;
    expect(room.receive("a", msg("hit"))).toBeNull();
  });

  it("survives a crash in game code", () => {
    const room = new RoomCore(counter, transport().t);
    room.join({ id: "a", name: "A", kind: "guest" });
    expect(room.receive("a", msg("boom"))).toBeNull();
    expect(room.receive("a", msg("hit"))).toBeNull();
    expect(room.state.count).toBe(1);
  });

  it("ends the match and closes everyone", () => {
    const { t, sent, closed } = transport();
    const room = new RoomCore(counter, t);
    room.join({ id: "a", name: "A", kind: "guest" });
    room.join({ id: "b", name: "B", kind: "guest" });
    room.receive("a", msg("end"));
    expect(sent.b!.at(-1)).toEqual({ type: "ended", message: "Someone won" });
    expect(closed).toEqual(["a", "b"]);
    expect(room.join({ id: "c", name: "C", kind: "guest" })).toEqual({ isAllowed: false, code: "ended" });
  });

  it("wakes from saved state without calling setup again", () => {
    const room = new RoomCore(counter, transport().t, { state: { count: 7, joined: ["a"], left: [] }, players: [{ id: "a", name: "A", kind: "guest" }] });
    room.receive("a", msg("hit"));
    expect(room.state.count).toBe(8);
  });

  it("relay passes messages to everyone else", () => {
    const { t, sent } = transport();
    const room = new RoomCore(relay, t);
    room.join({ id: "a", name: "A", kind: "guest" });
    room.join({ id: "b", name: "B", kind: "guest" });
    const before = sent.a!.length;
    room.receive("a", msg({ x: 1 }));
    expect(sent.b!.at(-1)).toEqual({ type: "message", data: { fromPlayerId: "a", data: { x: 1 } } });
    expect(sent.a!.length).toBe(before);
  });

  it("a closed room takes no new players, but lets back players who were in it", () => {
    const lobby = defineGameServer({
      maximumPlayerCount: 4,
      setup: () => ({}),
      onMessage: (_s, _p, message, room) => room.setOpen(message !== "start"),
    });
    const { t, sent } = transport();
    const room = new RoomCore(lobby, t);
    room.join({ id: "a", name: "A", kind: "guest" });
    room.join({ id: "b", name: "B", kind: "guest" });
    room.listingChanged = false;
    room.receive("a", msg("start"));
    expect(room.isOpen).toBe(false);
    expect(room.listingChanged).toBe(true);
    expect(sent.b!.at(-1)).toEqual({ type: "room", room: { isListed: true, isOpen: false, name: null, labels: {} } });
    expect(room.join({ id: "c", name: "C", kind: "guest" })).toEqual({ isAllowed: false, code: "closed" });
    room.leave("b");
    expect(room.join({ id: "b", name: "B", kind: "guest" })).toEqual({ isAllowed: true, isRejoin: false });
    // A sleeping room wakes as it was.
    const woken = new RoomCore(lobby, t, { state: room.state, room: room.saved });
    expect(woken.join({ id: "c", name: "C", kind: "guest" })).toEqual({ isAllowed: false, code: "closed" });
    expect(woken.join({ id: "a", name: "A", kind: "guest" }).isAllowed).toBe(true);
  });

  it("only the player who makes a room can hide it from the start", () => {
    const hidden = new RoomCore(counter, transport().t);
    hidden.join({ id: "a", name: "A", kind: "guest" }, { isListed: false });
    expect(hidden.isListed).toBe(false);
    const shown = new RoomCore(counter, transport().t);
    shown.join({ id: "a", name: "A", kind: "guest" });
    shown.join({ id: "b", name: "B", kind: "guest" }, { isListed: false });
    expect(shown.isListed).toBe(true);
  });

  it("with host controls, the first player can hide and close the room, and nobody else can", () => {
    const { t, sent } = transport();
    const room = new RoomCore(relay, t);
    room.join({ id: "a", name: "A", kind: "guest" });
    room.join({ id: "b", name: "B", kind: "guest" });
    expect(room.receive("b", JSON.stringify({ type: "room", isOpen: false }))).toBe("not_allowed");
    expect(room.isOpen).toBe(true);
    expect(room.receive("a", JSON.stringify({ type: "room", isListed: false, isOpen: false }))).toBeNull();
    expect(sent.b!.at(-1)).toEqual({ type: "room", room: { isListed: false, isOpen: false, name: null, labels: {} } });
    // Without host controls, only the game server decides.
    const plain = new RoomCore(counter, transport().t);
    plain.join({ id: "a", name: "A", kind: "guest" });
    expect(plain.receive("a", JSON.stringify({ type: "room", isListed: false }))).toBe("not_allowed");
  });

  it("names and labels a room within the limits, from the game server, its maker or the relay's first player", () => {
    const named = defineGameServer({ setup: () => ({}), onMessage: (_s, _p, message, room) => room.setInfo(message as never) });
    const { t, sent } = transport();
    const room = new RoomCore(named, t);
    room.join({ id: "a", name: "A", kind: "guest" }, { name: "  Ana​'s   castle ", labels: { Mode: "Classic", Map: 3, Bad: { x: 1 } as never } });
    expect([room.name, room.labels]).toEqual(["Ana's castle", { Mode: "Classic", Map: "3" }]);
    // Later players don't set it up; the game server can change it.
    room.join({ id: "b", name: "B", kind: "guest" }, { name: "Mine now" });
    expect(room.name).toBe("Ana's castle");
    room.receive("a", msg({ name: "x".repeat(60), labels: { A: "1", B: "2", C: "3", D: "4", E: "5" } }));
    expect(room.name).toHaveLength(40);
    expect(Object.keys(room.labels)).toEqual(["A", "B", "C", "D"]);
    expect(sent.b!.at(-1)).toMatchObject({ type: "room", room: { name: "x".repeat(40) } });
    room.receive("a", msg({ name: null }));
    expect(room.name).toBeNull();
    // A field setInfo doesn't take is refused (the handler throws, so nothing changes).
    room.receive("a", msg({ title: "Nope" }));
    expect(room.name).toBeNull();
    // The relay's first player can name it; nobody else can.
    const relayed = new RoomCore(relay, transport().t);
    relayed.join({ id: "a", name: "A", kind: "guest" });
    relayed.join({ id: "b", name: "B", kind: "guest" });
    expect(relayed.receive("b", JSON.stringify({ type: "room", name: "Hijack" }))).toBe("not_allowed");
    expect(relayed.receive("a", JSON.stringify({ type: "room", name: "Friday night", labels: { Mode: "Co-op" } }))).toBeNull();
    expect([relayed.name, relayed.labels]).toEqual(["Friday night", { Mode: "Co-op" }]);
  });

  it("hands a player's join data to onJoin, once, and null when there's none", () => {
    const got: unknown[] = [];
    const server = defineGameServer({ setup: () => ({}), onJoin: (_s, _p, _r, joinData, joinInfo) => void got.push([joinData, joinInfo]) });
    const room = new RoomCore(server, transport().t);
    room.join({ id: "a", name: "A", kind: "guest" }, { joinData: { character: "knight" } });
    room.join({ id: "b", name: "B", kind: "guest" });
    room.join({ id: "a", name: "A", kind: "guest" }, { joinData: { character: "again" } });
    expect(got).toEqual([
      [{ character: "knight" }, nobodyJoined],
      [null, nobodyJoined],
    ]);
  });

  it("reserves a room for some of its players, which starts with the setup data and lets only them in", () => {
    const reserved: [string, RoomStart][] = [];
    const { t } = transport();
    t.reserve = (code, start) => void reserved.push([code, start]);
    const lobby = defineGameServer({
      setup: (setupData: unknown) => ({ setupData, code: "" }),
      onMessage(s, _p, message, room) {
        if (message === "big") room.reserve({ playerIds: ["a"], setupData: "x".repeat(ROOM_LIMITS.maximumRoomDataSizeBytes) });
        if (message === "nobody") room.reserve({ playerIds: ["zed"] });
        if (message === "old") room.reserve({ players: ["a"] } as never);
        if (message === "go") s.code = room.reserve({ playerIds: ["a", "b", "zed", "a"], setupData: { map: "Docks" }, name: "Final", labels: { Mode: "Ranked" } });
      },
    });
    const room = new RoomCore(lobby, t);
    expect(room.state.setupData).toBeNull();
    room.join({ id: "a", name: "A", kind: "guest" });
    room.join({ id: "b", name: "B", kind: "guest" });
    room.receive("a", msg("big"));
    room.receive("a", msg("nobody"));
    room.receive("a", msg("old"));
    expect(reserved).toEqual([]);
    room.receive("a", msg("go"));
    expect(reserved).toHaveLength(1);
    const [code, start] = reserved[0]!;
    expect(isRoomCode(code) && room.state.code === code).toBe(true);
    // Only players in the room, once each; hidden unless the game lists it.
    expect(start).toEqual({ playerIds: ["a", "b"], setupData: { map: "Docks" }, isListed: false, name: "Final", labels: { Mode: "Ranked" } });

    const match = new RoomCore(lobby, transport().t, { start });
    expect(match.state.setupData).toEqual({ map: "Docks" });
    expect([match.isOpen, match.isListed, match.name]).toEqual([false, false, "Final"]);
    expect(match.join({ id: "c", name: "C", kind: "guest" })).toEqual({ isAllowed: false, code: "closed" });
    expect(match.join({ id: "a", name: "A", kind: "guest" }, { name: "Not yours", isListed: true })).toMatchObject({ isAllowed: true });
    expect([match.name, match.isListed]).toEqual(["Final", false]);
    // A room that starts over (a restart) starts with the same setup data.
    expect(new RoomCore(lobby, transport().t, { room: match.saved }).state.setupData).toEqual({ map: "Docks" });
    // A bug that reserves over and over is stopped.
    for (let i = 0; i < 30; i++) room.receive("a", msg("go"));
    expect(reserved).toHaveLength(ROOM_LIMITS.maximumReservesPerMin);
  });

  it("can't reserve rooms where the host doesn't make them", () => {
    const server = defineGameServer({
      setup: () => ({ error: "" }),
      onJoin(s, p, room) {
        try {
          room.reserve({ playerIds: [p.id] });
        } catch (err) {
          s.error = (err as Error).message;
        }
      },
    });
    const room = new RoomCore(server, transport().t);
    room.join({ id: "a", name: "A", kind: "guest" });
    expect(room.state.error).toBe("Reserved rooms aren't available here");
  });

  it("checks game server settings, and refuses options it doesn't take with the ones it does", () => {
    expect(() => defineGameServer({ maximumPlayerCount: 17, setup: () => ({}) })).toThrow("maximumPlayerCount");
    expect(() => defineGameServer({ ticksPerSec: 60, setup: () => ({}) })).toThrow("ticksPerSec");
    expect(() => defineGameServer({ hostControlsEnabled: "yes" as never, setup: () => ({}) })).toThrow("hostControlsEnabled");
    expect(() => defineGameServer({ onTick: 5 as never, setup: () => ({}) })).toThrow("onTick");
    expect(() => defineGameServer({} as never)).toThrow("setup");
    let refusal: GameServerError | null = null;
    try {
      defineGameServer({ tickRate: 20, setup: () => ({}) } as never);
    } catch (error) {
      refusal = error as GameServerError;
    }
    expect(refusal).toBeInstanceOf(GameServerError);
    expect(refusal).toMatchObject({ code: "unknown_option", field: "tickRate" });
    expect(refusal!.message).toBe(
      "tickRate isn't a game server option. A game server takes: maximumPlayerCount, ticksPerSec, hostControlsEnabled, idleCheck, idleTimeoutSec, awayMode, seatHoldDurationSec, setup, onJoin, canJoin, onMoved, onLeave, onAway, onBack, onMessage, onTick. (unknown_option)",
    );
  });

  it("gives onTick the seconds since the last tick", () => {
    const got: number[] = [];
    const room = new RoomCore(defineGameServer({ ticksPerSec: 20, setup: () => ({}), onTick: (_s, tickDurationSec) => void got.push(tickDurationSec) }), transport().t);
    room.join({ id: "a", name: "A", kind: "guest" });
    room.tick(0.05);
    expect(got).toEqual([0.05]);
  });
});

describe("kicking and turning players away", () => {
  // Kicks whoever says "kick <id>"; a password in the player's join data lets them in.
  const guarded = defineGameServer({
    hostControlsEnabled: false,
    setup: () => ({ count: 0, left: [] as string[], asked: [] as string[] }),
    canJoin(s, p, _room, joinData) {
      s.asked.push(p.id);
      if (p.id === "boom") throw new Error("game bug");
      if (p.id === "nobody") return false;
      // An answer canJoin doesn't take: a string reads like a reason, but isn't one.
      if (p.id === "texter") return "Wrong password." as never;
      return (joinData as { password?: string } | null)?.password === "docks" || { refusalMessage: "Wrong password." };
    },
    onLeave: (s, p) => void s.left.push(p.id),
    onMessage(s, _p, message, room) {
      const [word, id, keep] = String(message).split(" ");
      if (word === "kick") room.kick(id!, { message: "Too rough.", keepOut: keep === "out" });
      if (word === "oldkick") room.kick(id!, { reason: "Too rough." } as never);
      s.count++;
    },
  });
  const pw = { password: "docks" };

  it("lets the game server turn players away at the door, with its message", async () => {
    const room = new RoomCore(guarded, transport().t);
    expect(await room.admit({ id: "a", name: "A", kind: "guest" }, pw)).toEqual({ isAllowed: true });
    expect(await room.admit({ id: "b", name: "B", kind: "guest" }, { password: "nope" })).toEqual({ isAllowed: false, code: "refused", message: "Wrong password." });
    expect(await room.admit({ id: "nobody", name: "N", kind: "guest" }, pw)).toEqual({ isAllowed: false, code: "refused" });
    // A game server that crashes deciding turns the player away rather than letting them past it.
    expect(await room.admit({ id: "boom", name: "X", kind: "guest" }, pw)).toEqual({ isAllowed: false, code: "refused" });
    // So does an answer canJoin doesn't take, like a string, logged for the developer with what to answer instead.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await room.admit({ id: "texter", name: "T", kind: "guest" }, pw)).toEqual({ isAllowed: false, code: "refused" });
    expect(String(logged.mock.calls.at(-1)?.[0])).toContain('canJoin answered the text "Wrong password.", so the player was turned away. Answer true (or nothing) to let them in');
    logged.mockRestore();
    room.join({ id: "a", name: "A", kind: "guest" }, { joinData: pw });
    // A player already in the room (a reconnect) isn't asked again.
    room.state.asked = [];
    expect(await room.admit({ id: "a", name: "A", kind: "guest" })).toEqual({ isAllowed: true });
    expect(room.state.asked).toEqual([]);
  });

  it("kicks a player, running onLeave after the handler that kicked them, without losing either's changes", () => {
    const { t, sent, closed } = transport();
    const room = new RoomCore(guarded, t);
    room.join({ id: "a", name: "A", kind: "guest" });
    room.join({ id: "b", name: "B", kind: "guest" });
    expect(room.receive("a", msg("oldkick b"))).toBeNull();
    expect(closed).toEqual([]);
    expect(room.receive("a", msg("kick b"))).toBeNull();
    expect(sent.b!.at(-1)).toEqual({ type: "kicked", message: "Too rough.", isKeptOut: false });
    expect(closed).toEqual(["b"]);
    expect(room.state).toMatchObject({ count: 1, left: ["b"] });
    expect(sent.a!.at(-1)).toEqual({ type: "players", players: [{ id: "a", name: "A", kind: "guest" }], hostPlayerId: null });
    // Kicked without keepOut, they may come back while the room is open.
    expect(room.join({ id: "b", name: "B", kind: "guest" })).toEqual({ isAllowed: true, isRejoin: false });
  });

  it("keeps a kicked player out for the rest of the match, and out of rooms it reserves", async () => {
    const reserved: RoomStart[] = [];
    const { t } = transport();
    const room = new RoomCore(guarded, { ...t, reserve: (_code, start) => reserved.push(start) });
    room.join({ id: "a", name: "A", kind: "guest" });
    room.join({ id: "b", name: "B", kind: "guest" });
    room.receive("a", msg("kick b out"));
    expect(await room.admit({ id: "b", name: "B", kind: "guest" }, pw)).toEqual({ isAllowed: false, code: "kept_out", message: "Too rough." });
    expect(room.join({ id: "b", name: "B", kind: "guest" })).toEqual({ isAllowed: false, code: "kept_out", message: "Too rough." });

    // A sleeping room wakes still keeping them out.
    const woken = new RoomCore(guarded, transport().t, { state: room.state, room: room.saved });
    expect(woken.join({ id: "b", name: "B", kind: "guest" })).toMatchObject({ isAllowed: false, code: "kept_out" });

    // The match the room starts keeps them out too, even once it opens.
    (room as any).api.reserve({ playerIds: ["a"] });
    expect(reserved[0]!.keptOut).toEqual({ b: "Too rough." });
    const match = new RoomCore(guarded, transport().t, { start: reserved[0]! });
    match.join({ id: "a", name: "A", kind: "guest" });
    (match as any).api.setOpen(true);
    expect(match.join({ id: "b", name: "B", kind: "guest" })).toMatchObject({ isAllowed: false, code: "kept_out" });
  });

  it("forgets a kicked player, so a closed room doesn't let them back", () => {
    const room = new RoomCore(guarded, transport().t);
    room.join({ id: "a", name: "A", kind: "guest" });
    room.join({ id: "b", name: "B", kind: "guest" });
    room.receive("a", msg("kick b"));
    (room as any).api.setOpen(false);
    expect(room.join({ id: "b", name: "B", kind: "guest" })).toEqual({ isAllowed: false, code: "closed" });
  });

  it("gives relay games a host who can kick, and hands it on when they leave", () => {
    const { t, sent, closed } = transport();
    const room = new RoomCore(relay, t);
    room.join({ id: "a", name: "A", kind: "guest" });
    room.join({ id: "b", name: "B", kind: "guest" });
    room.join({ id: "c", name: "C", kind: "guest" });
    expect(sent.c![0]).toMatchObject({ type: "welcome", hostPlayerId: "a" });

    expect(room.receive("b", JSON.stringify({ type: "kick", playerId: "c" }))).toBe("not_allowed");
    expect(room.receive("a", JSON.stringify({ type: "kick", playerId: "a" }))).toBe("bad_message");
    expect(room.receive("a", JSON.stringify({ type: "kick", playerId: "c", keepOut: true }))).toBeNull();
    // Players can't type the message: no free text between strangers.
    expect(sent.c!.at(-1)).toEqual({ type: "kicked", message: "The host removed you from this room.", isKeptOut: true });
    expect(closed).toEqual(["c"]);

    room.leave("a");
    expect(sent.b!.at(-1)).toEqual({ type: "players", players: [{ id: "b", name: "B", kind: "guest" }], hostPlayerId: "b" });
    expect(room.receive("b", JSON.stringify({ type: "room", isOpen: false }))).toBeNull();
  });
});

describe("moving players to a room that's already running", () => {
  // An area of an open world: takes players moving in unless it's "locked", and remembers where they came from.
  const area = defineGameServer({
    maximumPlayerCount: 3,
    setup: () => ({ locked: false, arrived: [] as unknown[], results: [] as unknown[] }),
    canJoin: (s, _p, _room, _joinData, joinInfo) => !(s.locked && joinInfo.fromRoomCode) || { refusalMessage: "This area is locked." },
    onJoin: (s, p, _room, joinData, joinInfo) => void s.arrived.push({ id: p.id, joinData, fromRoomCode: joinInfo.fromRoomCode }),
    onMessage(s, p, message, room) {
      if (message === "lock") s.locked = true;
      const [word, code, ...ids] = String(message).split(" ");
      if (word === "go") room.moveTo(code!, { playerIds: ids.length ? ids : [p.id], joinData: { door: "north" } });
    },
    onMoved: (s, moveResult) => void s.results.push(moveResult),
  });

  /** Two rooms of one game wired together like the Node runner does. */
  function world() {
    const rooms = new Map<string, RoomCore>();
    const moves: Record<string, string[]> = {};
    const make = (code: string) => {
      const sent = transport();
      const core: RoomCore = new RoomCore(area, {
        ...sent.t,
        moveTo: (next, ask) => {
          const target = rooms.get(next);
          const nobody: MoveAnswer = { movedPlayerIds: [], refusals: ask.players.map((p) => ({ playerId: p.id, code: "no_room" as const, message: "That room isn't running." })) };
          void (target ? target.expect({ ...ask, fromRoomCode: code }) : Promise.resolve(nobody)).then((answer) => {
            for (const id of answer.movedPlayerIds) (moves[id] ??= []).push(next);
            core.moved(next, answer, ask.players);
          });
        },
      });
      rooms.set(code, core);
      return core;
    };
    return { make, moves, rooms };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("sends players to another room, which gets the sending room's join data and where they came from", async () => {
    const { make, moves } = world();
    const town = make("TWNAAA");
    const forest = make("FRSTAA");
    forest.join({ id: "z", name: "Z", kind: "guest" });
    town.join({ id: "a", name: "A", kind: "guest" });
    town.join({ id: "b", name: "B", kind: "guest" });
    town.receive("a", msg("go FRSTAA a b"));
    await tick();
    expect(moves).toEqual({ a: ["FRSTAA"], b: ["FRSTAA"] });
    expect(town.state.results).toEqual([{ roomCode: "FRSTAA", movedPlayers: [{ id: "a", name: "A", kind: "guest" }, { id: "b", name: "B", kind: "guest" }], refusals: [] }]);

    // They arrive with the town's join data, not whatever their browser sends, and the game isn't asked again.
    expect(await forest.admit({ id: "a", name: "A", kind: "guest" }, { door: "cheat" })).toEqual({ isAllowed: true });
    forest.join({ id: "a", name: "A", kind: "guest" }, { joinData: { door: "cheat" } });
    expect(forest.state.arrived.at(-1)).toEqual({ id: "a", joinData: { door: "north" }, fromRoomCode: "TWNAAA" });
  });

  it("holds a seat for each player on their way, even in a closed room, for a minute", async () => {
    let now = 0;
    const target = new RoomCore(area, transport().t, { now: () => now });
    target.join({ id: "z", name: "Z", kind: "guest" });
    (target as any).api.setOpen(false);
    expect(await target.expect({ fromRoomCode: "TWNAAA", players: [{ id: "a", name: "A", kind: "guest" }, { id: "b", name: "B", kind: "guest" }, { id: "c", name: "C", kind: "guest" }], joinData: null })).toEqual({
      movedPlayerIds: ["a", "b"],
      refusals: [{ playerId: "c", code: "full", message: "This room is full." }],
    });
    // The seats count as taken, so nobody else gets in ahead of them.
    (target as any).api.setOpen(true);
    expect(await target.admit({ id: "x", name: "X", kind: "guest" })).toEqual({ isAllowed: false, code: "full" });
    // A sleeping room wakes still holding them.
    const woken = new RoomCore(area, transport().t, { state: target.state, room: target.saved, now: () => now });
    expect(woken.join({ id: "a", name: "A", kind: "guest" })).toMatchObject({ isAllowed: true });
    // Seats run out after a minute.
    now += 61_000;
    expect(await target.admit({ id: "x", name: "X", kind: "guest" })).toEqual({ isAllowed: true });
    (target as any).api.setOpen(false);
    expect(target.join({ id: "b", name: "B", kind: "guest" })).toEqual({ isAllowed: false, code: "closed" });
  });

  it("lets the other room say no, and tells the sending room who stayed and why", async () => {
    const { make, moves } = world();
    const town = make("TWNAAA");
    const keep = make("KEEPAA");
    keep.join({ id: "z", name: "Z", kind: "guest" });
    keep.receive("z", msg("lock"));
    town.join({ id: "a", name: "A", kind: "guest" });
    town.receive("a", msg("go KEEPAA"));
    town.receive("a", msg("go GNEAAA"));
    await tick();
    expect(moves).toEqual({});
    // Each answer comes back when that room has decided, so they can arrive in either order.
    expect([...town.state.results].sort((x: any, y: any) => x.roomCode.localeCompare(y.roomCode))).toEqual([
      { roomCode: "GNEAAA", movedPlayers: [], refusals: [{ player: { id: "a", name: "A", kind: "guest" }, code: "no_room", message: "That room isn't running." }] },
      { roomCode: "KEEPAA", movedPlayers: [], refusals: [{ player: { id: "a", name: "A", kind: "guest" }, code: "refused", message: "This area is locked." }] },
    ]);
    expect([...town.players.keys()]).toEqual(["a"]);
  });

  it("refuses mistakes in the game's call", () => {
    const { make } = world();
    const town = make("TWNAAA");
    town.join({ id: "a", name: "A", kind: "guest" });
    const api = (town as any).api;
    expect(() => api.moveTo("nope", { playerIds: ["a"] })).toThrow("room code");
    expect(() => api.moveTo("FRSTAA", { playerIds: ["stranger"] })).toThrow("players who are in this room");
    expect(() => api.moveTo("FRSTAA", { playerIds: ["a"], joinData: "x".repeat(5000) })).toThrow("plain JSON");
    expect(() => api.moveTo("FRSTAA", { players: ["a"] })).toThrow("room.moveTo doesn't take players. It takes: playerIds, joinData.");
  });
});

describe("players who walk away", () => {
  const hosted = (overrides: Partial<GameServer> = {}) =>
    defineGameServer({
      maximumPlayerCount: 2,
      setup: () => ({ joined: [] as any[], left: [] as any[], away: [] as any[], back: [] as string[] }),
      onJoin: (s, p, _room, _joinData, joinInfo) => void s.joined.push([p.id, joinInfo]),
      onLeave: (s, p, _room, leaveInfo) => void s.left.push([p.id, leaveInfo.reason]),
      ...overrides,
    } as GameServer);
  const clock = () => {
    const c = { now: 1_000_000 };
    return { c, now: () => c.now };
  };
  const say = (type: string, more: object = {}) => JSON.stringify({ type, ...more });

  it("tells each player when the room counts them away", () => {
    const { t, sent } = transport();
    new RoomCore(hosted(), t).join({ id: "a", name: "A", kind: "guest" });
    expect(sent.a![0].awayChecks).toEqual({ idleTimeoutSec: 600, hiddenTimeoutSec: null });
    const ticking = transport();
    new RoomCore(hosted({ ticksPerSec: 10, idleTimeoutSec: 120 }), ticking.t).join({ id: "a", name: "A", kind: "guest" });
    expect(ticking.sent.a![0].awayChecks).toEqual({ idleTimeoutSec: 120, hiddenTimeoutSec: 120 });
    const off = transport();
    new RoomCore(hosted({ idleCheck: "off" }), off.t).join({ id: "a", name: "A", kind: "guest" });
    expect(off.sent.a![0].awayChecks).toEqual({ idleTimeoutSec: null, hiddenTimeoutSec: null });
  });

  it("takes a player who didn't answer 'Still there?' out of the match, holds their seat, and lets them straight back", () => {
    const { t, sent, closed } = transport();
    const { c, now } = clock();
    const room = new RoomCore(hosted(), t, { now });
    room.join({ id: "a", name: "A", kind: "guest" });
    room.join({ id: "b", name: "B", kind: "guest" });
    expect(room.receive("a", say("idle"))).toBeNull();
    expect(sent.a!.at(-1)).toEqual({ type: "away", reason: "idle", seatHoldDurationSec: 300 });
    expect(sent.b!.at(-1)).toEqual({ type: "players", players: [{ id: "b", name: "B", kind: "guest" }], hostPlayerId: null });
    expect(room.state.left).toEqual([["a", "idle"]]);
    expect(room.playingCount).toBe(1);
    expect(room.heldSeatCount).toBe(1);
    // The held seat counts toward maximumPlayerCount.
    expect(room.join({ id: "c", name: "C", kind: "guest" })).toEqual({ isAllowed: false, code: "full" });
    // While out, the player's messages wait; coming back gives them their seat, without asking canJoin.
    expect(room.receive("a", msg("hit"))).toBeNull();
    c.now += 60_000;
    expect(room.receive("a", say("back", { joinData: { color: "red" } }))).toBeNull();
    expect(room.state.joined.at(-1)).toEqual(["a", { fromRoomCode: null, isReturning: true }]);
    expect(sent.a!.at(-1)).toMatchObject({ type: "players" });
    expect(room.heldSeatCount).toBe(0);
    expect(closed).toEqual([]);
  });

  it("frees a held seat once it runs out, and closes that player's connection", () => {
    const { t, closed } = transport();
    const { c, now } = clock();
    const room = new RoomCore(hosted({ seatHoldDurationSec: 60 }), t, { now });
    room.join({ id: "a", name: "A", kind: "guest" });
    room.receive("a", say("idle"));
    c.now += 59_000;
    room.sweep();
    expect(closed).toEqual([]);
    c.now += 1_000;
    room.sweep();
    expect(closed).toEqual(["a"]);
    expect(room.heldSeatCount).toBe(0);
    expect(room.receive("a", say("back"))).toBe("ended");
  });

  it("decides for itself when a game sends nothing for longer than the idle check allows", () => {
    const { t, sent } = transport();
    const { c, now } = clock();
    const room = new RoomCore(hosted({ idleTimeoutSec: 60 }), t, { now });
    room.join({ id: "a", name: "A", kind: "guest" });
    room.join({ id: "b", name: "B", kind: "guest" });
    // "Still there?" takes 30 seconds, and the room gives the game a minute more to say.
    c.now += 60_000 + 30_000 + 59_000;
    room.receive("b", say("here"));
    room.sweep();
    expect(room.playingCount).toBe(2);
    c.now += 1_000;
    room.sweep();
    expect(sent.a!.at(-1)).toEqual({ type: "away", reason: "idle", seatHoldDurationSec: 300 });
    expect(room.playingCount).toBe(1);
  });

  it("lets a player's game set its own idle check only where the game server's idleCheck is client", () => {
    const { t, sent } = transport();
    const { c, now } = clock();
    const room = new RoomCore(defineGameServer({ ...relay, maximumPlayerCount: 4 }), t, { now });
    room.join({ id: "a", name: "A", kind: "guest" }, { clientIdle: { idleCheckEnabled: false } });
    room.join({ id: "b", name: "B", kind: "guest" }, { clientIdle: { idleTimeoutSec: 45 } });
    room.join({ id: "c", name: "C", kind: "guest" });
    expect([sent.a![0].awayChecks.idleTimeoutSec, sent.b![0].awayChecks.idleTimeoutSec, sent.c![0].awayChecks.idleTimeoutSec]).toEqual([null, 45, 600]);
    c.now += 24 * 3600_000;
    room.sweep();
    expect(room.players.has("a")).toBe(true);
    expect(room.players.has("b")).toBe(false);
    const server = transport();
    new RoomCore(hosted(), server.t).join({ id: "a", name: "A", kind: "guest" }, { clientIdle: { idleCheckEnabled: false } });
    expect(server.sent.a![0].awayChecks.idleTimeoutSec).toBe(600);
    // With idleCheck client, the game server's idleTimeoutSec is the default.
    const client = transport();
    new RoomCore(hosted({ idleCheck: "client", idleTimeoutSec: 90 }), client.t).join({ id: "a", name: "A", kind: "guest" });
    expect(client.sent.a![0].awayChecks.idleTimeoutSec).toBe(90);
  });

  it("counts a game hidden for 2 minutes as away in a real-time room, and not in a turn-based one", () => {
    const { t, sent } = transport();
    const { c, now } = clock();
    const room = new RoomCore(hosted({ ticksPerSec: 10 }), t, { now });
    room.join({ id: "a", name: "A", kind: "guest" });
    room.join({ id: "b", name: "B", kind: "guest" });
    room.receive("a", say("hidden"));
    room.receive("b", say("hidden"));
    c.now += 60_000;
    room.receive("b", say("shown"));
    c.now += 60_000;
    room.sweep();
    expect(sent.a!.at(-1)).toEqual({ type: "away", reason: "hidden", seatHoldDurationSec: 300 });
    expect([...room.players.keys()]).toEqual(["b"]);

    const turns = transport();
    const slow = new RoomCore(hosted(), turns.t, { now });
    slow.join({ id: "a", name: "A", kind: "guest" });
    slow.receive("a", say("hidden"));
    c.now += 9 * 60_000;
    slow.sweep();
    expect(slow.players.has("a")).toBe(true);
  });

  it("holds the seat of a player whose connection was lost, but not one who left", () => {
    const { t } = transport();
    const room = new RoomCore(hosted(), t);
    room.join({ id: "a", name: "A", kind: "guest" });
    room.join({ id: "b", name: "B", kind: "guest" });
    room.leave("a", "lost");
    room.leave("b");
    expect(room.state.left).toEqual([["a", "lost"], ["b", "left"]]);
    expect(room.heldSeatCount).toBe(1);
    expect(room.join({ id: "a", name: "A", kind: "guest" })).toEqual({ isAllowed: true, isRejoin: false });
    expect(room.state.joined.at(-1)).toEqual(["a", { fromRoomCode: null, isReturning: true }]);
    // A player out of the match whose connection then closes on purpose is gone for good.
    room.receive("a", say("idle"));
    room.leave("a");
    expect(room.heldSeatCount).toBe(0);
  });

  it("lets the game decide with onAway: the player stays, doesn't count as playing, and a room where everyone's away stops ticking", () => {
    const { t, sent } = transport();
    const room = new RoomCore(
      hosted({
        ticksPerSec: 10,
        setup: () => ({ joined: [] as any[], left: [] as any[], away: [] as any[], back: [] as string[], ticks: 0 }),
        onAway: (s, p, _room, reason) => void s.away.push([p.id, reason]),
        onBack: (s, p) => void s.back.push(p.id),
        onTick: (s) => void s.ticks++,
      }),
      t,
    );
    room.join({ id: "a", name: "A", kind: "guest" });
    room.tick(0.1);
    room.receive("a", say("idle"));
    expect(room.state.away).toEqual([["a", "idle"]]);
    expect(room.players.has("a")).toBe(true);
    expect(room.playingCount).toBe(0);
    expect(sent.a!.some((m) => m.type === "away")).toBe(false);
    room.tick(0.1);
    expect(room.state.ticks).toBe(1);
    room.receive("a", say("back"));
    expect(room.state.back).toEqual(["a"]);
    expect(room.playingCount).toBe(1);
    expect(room.saved.kept).toBeUndefined();
  });

  it("sends a player who walked away to the lobby that made the room, holding their seat if the lobby says no", () => {
    const { t } = transport();
    const asked: any[] = [];
    const room = new RoomCore(
      hosted({ awayMode: "lobby", onMoved: (s: any) => void (s.heard = true) }),
      { ...t, moveTo: (code, ask) => asked.push([code, ask]) },
      { start: { playerIds: ["a"], setupData: null, isListed: false, name: null, labels: {}, lobbyRoomCode: "LBBYAA" } },
    );
    room.join({ id: "a", name: "A", kind: "guest" });
    room.receive("a", say("idle"));
    expect(asked).toEqual([["LBBYAA", { players: [{ id: "a", name: "A", kind: "guest" }], joinData: null }]]);
    room.moved("LBBYAA", { movedPlayerIds: [], refusals: [{ playerId: "a", code: "full", message: "This room is full." }] }, [{ id: "a", name: "A", kind: "guest" }]);
    expect((room.state as any).heard).toBeUndefined();
    expect(room.heldSeatCount).toBe(1);
    expect(room.saved.lobbyRoomCode).toBe("LBBYAA");
  });

  it("keeps held seats and players kept away through a sleep", async () => {
    const { t } = transport();
    const keeper = hosted({ maximumPlayerCount: 3, onAway: () => {} });
    const room = new RoomCore(keeper, t);
    room.join({ id: "a", name: "A", kind: "guest" });
    room.join({ id: "b", name: "B", kind: "guest" });
    room.leave("a", "lost");
    room.receive("b", say("idle"));
    const woke = new RoomCore(keeper, t, { state: room.state, players: [{ id: "b", name: "B", kind: "guest" }], room: room.saved });
    expect(woke.heldSeatCount).toBe(1);
    expect(woke.playingCount).toBe(0);
    expect(await woke.admit({ id: "a", name: "A", kind: "guest" })).toEqual({ isAllowed: true });
  });

  it("checks the away settings when the game server is defined", () => {
    expect(() => defineGameServer({ setup: () => ({}), idleTimeoutSec: 5 })).toThrow("idleTimeoutSec");
    expect(() => defineGameServer({ setup: () => ({}), idleCheck: "never" as never })).toThrow("idleCheck");
    expect(() => defineGameServer({ setup: () => ({}), awayMode: "home" as never })).toThrow("awayMode");
    expect(() => defineGameServer({ setup: () => ({}), seatHoldDurationSec: 4000 })).toThrow("seatHoldDurationSec");
    expect(() => defineGameServer({ setup: () => ({}), idleCheck: "off", awayMode: "lobby", seatHoldDurationSec: 0 })).not.toThrow();
  });
});

describe("canJoin's answer", () => {
  it("lets in on true or nothing, turns away on false or { refusalMessage }, and calls anything else a mistake", () => {
    expect(readJoinAnswer(true)).toEqual({ isAllowed: true });
    expect(readJoinAnswer(undefined)).toEqual({ isAllowed: true });
    expect(readJoinAnswer(null)).toEqual({ isAllowed: true });
    expect(readJoinAnswer(false)).toEqual({ isAllowed: false, refusalMessage: null });
    expect(readJoinAnswer({ refusalMessage: "Wrong room password." })).toEqual({ isAllowed: false, refusalMessage: "Wrong room password." });
    // A truthy string used to mean "no, with this reason"; now it's a mistake, never a yes.
    for (const wrong of ["Wrong password.", "ok", 1, {}, { refusalMessage: 7 }, { refusalMessage: "No.", isAllowed: false }, ["no"]]) {
      expect(readJoinAnswer(wrong)).toEqual({ mistake: expect.stringContaining("so the player was turned away") });
    }
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(readJoinAnswer(circular)).toEqual({ mistake: expect.stringContaining("canJoin answered an object") });
  });

  it("shows the player the refusalMessage, tidied and cut to 200 characters", async () => {
    const room = new RoomCore(defineGameServer({ setup: () => ({}), canJoin: () => ({ refusalMessage: `  ${"No ".repeat(100)}\u200b ` }) }), transport().t);
    const admission = await room.admit({ id: "a", name: "A", kind: "guest" });
    expect(admission).toMatchObject({ isAllowed: false, code: "refused" });
    expect((admission as { message: string }).message).toHaveLength(ROOM_LIMITS.maximumMessageCharacterCount);
    expect((admission as { message: string }).message.startsWith("No No")).toBe(true);
  });
});
