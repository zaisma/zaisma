import { describe, expect, it, vi } from "vitest";
import {
  GameServerError,
  RoomCore,
  clientIdleTimeoutSec,
  defineGameServer,
  isRoomCode,
  relay,
  ROOM_LIMITS,
  type GameServer,
  type RoomNaming,
  type RoomStart,
  type Transport,
} from "../../packages/game-server/src/index.ts";

function transport() {
  const sent: Record<string, any[]> = {};
  const closed: string[] = [];
  const t: Transport = {
    send: (id, text) => (sent[id] ??= []).push(JSON.parse(text)),
    close: (id) => closed.push(id),
  };
  return { t, sent, closed };
}

/** What a call threw, to check its code and message. */
function thrown(call: () => unknown): any {
  try {
    call();
  } catch (error) {
    return error;
  }
  return undefined;
}

/** Collects what the room logs as game server errors while call runs, keeping the test output quiet. */
async function logged(call: () => unknown): Promise<unknown[]> {
  const errors: unknown[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void errors.push(args.at(-1)));
  try {
    await call();
  } finally {
    spy.mockRestore();
  }
  return errors;
}

const counter = defineGameServer({
  maximumPlayerCount: 2,
  setup: () => ({ count: 0, joined: [] as string[], left: [] as string[] }),
  onJoin: (s, p) => void s.joined.push(p.id),
  onLeave: (s, p) => void s.left.push(p.id),
  onMessage(s, p, messageData, room) {
    if (messageData === "boom") throw new Error("game bug");
    if (messageData === "end") return room.end("Someone won");
    s.count++;
    room.broadcast({ count: s.count, by: p.id });
  },
});

const message = (data: unknown) => JSON.stringify({ type: "message", data });

describe("RoomCore", () => {
  it("runs join, message and leave through the game server", () => {
    const { t, sent } = transport();
    const room = new RoomCore(counter, t);
    room.join({ id: "a", name: "A" });
    room.join({ id: "b", name: "B" });
    // hostPlayerId is always there, null without host controls.
    expect(sent.a![0]).toEqual({
      type: "welcome",
      me: { id: "a", name: "A" },
      players: [{ id: "a", name: "A" }],
      roomSettings: { isListed: true, isOpen: true, name: null, labels: {} },
      hostPlayerId: null,
      awayChecks: { idleTimeoutSec: 600, hiddenTimeoutSec: null },
    });
    expect(sent.a!.at(-1)).toEqual({ type: "players", players: [{ id: "a", name: "A" }, { id: "b", name: "B" }], hostPlayerId: null });

    expect(room.receive("a", message("hit"))).toBeNull();
    expect(sent.b!.at(-1)).toEqual({ type: "message", data: { count: 1, by: "a" } });

    room.leave("b");
    expect(room.state.left).toEqual(["b"]);
    expect(sent.a!.at(-1)).toEqual({ type: "players", players: [{ id: "a", name: "A" }], hostPlayerId: null });
  });

  it("caps players, and a reconnect keeps the same place without joining twice", () => {
    const { t } = transport();
    const room = new RoomCore(counter, t);
    room.join({ id: "a", name: "A" });
    room.join({ id: "b", name: "B" });
    expect(room.join({ id: "c", name: "C" })).toEqual({ ok: false, code: "full" });
    expect(room.join({ id: "a", name: "A" })).toEqual({ ok: true, rejoined: true });
    expect(room.state.joined).toEqual(["a", "b"]);
  });

  it("refuses big, malformed and flooding messages", () => {
    let now = 0;
    const room = new RoomCore(counter, transport().t, { now: () => now });
    room.join({ id: "a", name: "A" });
    expect(room.receive("a", message("x".repeat(ROOM_LIMITS.maximumMessageSizeBytes)))).toBe("too_big");
    expect(room.receive("a", "not json")).toBe("bad_message");
    expect(room.receive("a", JSON.stringify({ hello: 1 }))).toBe("bad_message");

    let refused = 0;
    for (let i = 0; i < 200; i++) if (room.receive("a", message("hit")) === "too_fast") refused++;
    expect(refused).toBeGreaterThan(100);
    now += 1000;
    expect(room.receive("a", message("hit"))).toBeNull();
  });

  it("survives a crash in game code", () => {
    const room = new RoomCore(counter, transport().t);
    room.join({ id: "a", name: "A" });
    expect(room.receive("a", message("boom"))).toBeNull();
    expect(room.receive("a", message("hit"))).toBeNull();
    expect(room.state.count).toBe(1);
  });

  it("ends the match and closes everyone", () => {
    const { t, sent, closed } = transport();
    const room = new RoomCore(counter, t);
    room.join({ id: "a", name: "A" });
    room.join({ id: "b", name: "B" });
    room.receive("a", message("end"));
    expect(sent.b!.at(-1)).toEqual({ type: "ended", message: "Someone won" });
    expect(closed).toEqual(["a", "b"]);
    expect(room.join({ id: "c", name: "C" })).toEqual({ ok: false, code: "ended" });
  });

  it("wakes from saved state without calling setup again", () => {
    const room = new RoomCore(counter, transport().t, { state: { count: 7, joined: ["a"], left: [] }, players: [{ id: "a", name: "A" }] });
    room.receive("a", message("hit"));
    expect(room.state.count).toBe(8);
  });

  it("relay passes messages to everyone else", () => {
    const { t, sent } = transport();
    const room = new RoomCore(relay, t);
    room.join({ id: "a", name: "A" });
    room.join({ id: "b", name: "B" });
    const before = sent.a!.length;
    room.receive("a", message({ x: 1 }));
    expect(sent.b!.at(-1)).toEqual({ type: "message", data: { fromPlayerId: "a", messageData: { x: 1 } } });
    expect(sent.a!.length).toBe(before);
  });

  it("a closed room takes no new players, but lets back players who were in it", () => {
    const lobby = defineGameServer({
      maximumPlayerCount: 4,
      setup: () => ({}),
      onMessage: (_s, _p, messageData, room) => room.setOpen(messageData !== "start"),
    });
    const { t, sent } = transport();
    const room = new RoomCore(lobby, t);
    room.join({ id: "a", name: "A" });
    room.join({ id: "b", name: "B" });
    room.listingChanged = false;
    room.receive("a", message("start"));
    expect(room.isOpen).toBe(false);
    expect(room.listingChanged).toBe(true);
    expect(sent.b!.at(-1)).toEqual({ type: "room_settings", roomSettings: { isListed: true, isOpen: false, name: null, labels: {} } });
    expect(room.join({ id: "c", name: "C" })).toEqual({ ok: false, code: "closed" });
    room.leave("b");
    expect(room.join({ id: "b", name: "B" })).toEqual({ ok: true, rejoined: false });
    // A sleeping room wakes as it was.
    const woken = new RoomCore(lobby, t, { state: room.state, room: room.saved });
    expect(woken.join({ id: "c", name: "C" })).toEqual({ ok: false, code: "closed" });
    expect(woken.join({ id: "a", name: "A" }).ok).toBe(true);
  });

  it("only the player who makes a room can hide it from the start", () => {
    const hidden = new RoomCore(counter, transport().t);
    hidden.join({ id: "a", name: "A" }, { isListed: false });
    expect(hidden.isListed).toBe(false);
    const shown = new RoomCore(counter, transport().t);
    shown.join({ id: "a", name: "A" });
    shown.join({ id: "b", name: "B" }, { isListed: false });
    expect(shown.isListed).toBe(true);
  });

  it("with host controls, the first player can hide and close the room, and nobody else can", () => {
    const { t, sent } = transport();
    const room = new RoomCore(relay, t);
    room.join({ id: "a", name: "A" });
    room.join({ id: "b", name: "B" });
    expect(room.receive("b", JSON.stringify({ type: "update_room", isOpen: false }))).toBe("not_allowed");
    expect(room.isOpen).toBe(true);
    expect(room.receive("a", JSON.stringify({ type: "update_room", isListed: false, isOpen: false }))).toBeNull();
    expect(sent.b!.at(-1)).toEqual({ type: "room_settings", roomSettings: { isListed: false, isOpen: false, name: null, labels: {} } });
    // Without host controls, only the game server decides.
    const plain = new RoomCore(counter, transport().t);
    plain.join({ id: "a", name: "A" });
    expect(plain.receive("a", JSON.stringify({ type: "update_room", isListed: false }))).toBe("not_allowed");
  });

  it("names and labels a room within the limits, from the game server, its maker or the relay's first player", () => {
    const named = defineGameServer({
      setup: () => ({}),
      onMessage(_s, _p, messageData, room) {
        const naming = messageData as RoomNaming;
        if (naming.name !== undefined) room.setName(naming.name);
        if (naming.labels !== undefined) room.setLabels(naming.labels);
      },
    });
    const { t, sent } = transport();
    const room = new RoomCore(named, t);
    room.join({ id: "a", name: "A" }, { name: "  Ana​'s   castle ", labels: { Mode: "Classic", Map: 3, Bad: { x: 1 } as never } });
    expect([room.name, room.labels]).toEqual(["Ana's castle", { Mode: "Classic", Map: "3" }]);
    // Later players don't set it up; the game server can change it.
    room.join({ id: "b", name: "B" }, { name: "Mine now" });
    expect(room.name).toBe("Ana's castle");
    room.receive("a", message({ name: "x".repeat(60), labels: { A: "1", B: "2", C: "3", D: "4", E: "5" } }));
    expect(room.name).toHaveLength(40);
    expect(Object.keys(room.labels)).toEqual(["A", "B", "C", "D"]);
    expect(sent.b!.at(-1)).toMatchObject({ type: "room_settings", roomSettings: { name: "x".repeat(40) } });
    room.receive("a", message({ name: null }));
    expect(room.name).toBeNull();
    // The relay's first player can name it; nobody else can.
    const relayed = new RoomCore(relay, transport().t);
    relayed.join({ id: "a", name: "A" });
    relayed.join({ id: "b", name: "B" });
    expect(relayed.receive("b", JSON.stringify({ type: "update_room", name: "Hijack" }))).toBe("not_allowed");
    expect(relayed.receive("a", JSON.stringify({ type: "update_room", name: "Friday night", labels: { Mode: "Co-op" } }))).toBeNull();
    expect([relayed.name, relayed.labels]).toEqual(["Friday night", { Mode: "Co-op" }]);
  });

  it("hands a player's join data to onJoin, once", () => {
    const got: unknown[] = [];
    const server = defineGameServer({ setup: () => ({}), onJoin: (_s, _p, _r, joinData) => void got.push(joinData) });
    const room = new RoomCore(server, transport().t);
    room.join({ id: "a", name: "A" }, { joinData: { character: "knight" } });
    room.join({ id: "b", name: "B" });
    room.join({ id: "a", name: "A" }, { joinData: { character: "again" } });
    expect(got).toEqual([{ character: "knight" }, undefined]);
  });

  it("reserves a room for some of its players, which starts with the data and lets only them in", () => {
    const reserved: [string, RoomStart][] = [];
    const { t } = transport();
    t.reserve = (code, start) => void reserved.push([code, start]);
    const lobby = defineGameServer({
      setup: (startData?: unknown) => ({ data: startData ?? null, code: "" }),
      onMessage(s, _p, messageData, room) {
        if (messageData === "big") room.reserve({ playerIds: ["a"], startData: "x".repeat(ROOM_LIMITS.maximumDataSizeBytes) });
        if (messageData === "nobody") room.reserve({ playerIds: ["zed"] });
        if (messageData === "go") s.code = room.reserve({ playerIds: ["a", "b", "zed", "a"], startData: { map: "Docks" }, name: "Final", labels: { Mode: "Ranked" } });
      },
    });
    const room = new RoomCore(lobby, t);
    room.join({ id: "a", name: "A" });
    room.join({ id: "b", name: "B" });
    room.receive("a", message("big"));
    room.receive("a", message("nobody"));
    expect(reserved).toEqual([]);
    room.receive("a", message("go"));
    expect(reserved).toHaveLength(1);
    const [code, start] = reserved[0]!;
    expect(isRoomCode(code) && room.state.code === code).toBe(true);
    // Only players in the room, once each; hidden unless the game lists it.
    expect(start).toEqual({ players: ["a", "b"], data: { map: "Docks" }, isListed: false, name: "Final", labels: { Mode: "Ranked" } });

    const match = new RoomCore(lobby, transport().t, { start });
    expect(match.state.data).toEqual({ map: "Docks" });
    expect([match.isOpen, match.isListed, match.name]).toEqual([false, false, "Final"]);
    expect(match.join({ id: "c", name: "C" })).toEqual({ ok: false, code: "closed" });
    expect(match.join({ id: "a", name: "A" }, { name: "Not yours", isListed: true })).toMatchObject({ ok: true });
    expect([match.name, match.isListed]).toEqual(["Final", false]);
    // A room that starts over (a restart) starts with the same data.
    expect(new RoomCore(lobby, transport().t, { room: match.saved }).state.data).toEqual({ map: "Docks" });
    // A bug that reserves over and over is stopped.
    for (let i = 0; i < 30; i++) room.receive("a", message("go"));
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
    room.join({ id: "a", name: "A" });
    expect(room.state.error).toBe("Reserved rooms aren't available here.");
  });

  it("refuses option names a room call doesn't take: the call throws, the room logs it, and nothing happens", async () => {
    const reserved: RoomStart[] = [];
    const asked: unknown[] = [];
    const { t, sent, closed } = transport();
    const server = defineGameServer({
      setup: () => ({}),
      onMessage(_s, _p, messageData, room) {
        if (messageData === "broadcast") room.broadcast("hi", { except: "a" } as never);
        if (messageData === "reserve") room.reserve({ players: ["a"] } as never);
        if (messageData === "kick") room.kick("b", { reason: "Too rough." } as never);
        if (messageData === "move") room.moveTo("FRSTAA", { players: ["a"] } as never);
      },
    });
    const room = new RoomCore(server, { ...t, reserve: (_code, start) => void reserved.push(start), moveTo: (_code, ask) => void asked.push(ask) });
    room.join({ id: "a", name: "A" });
    room.join({ id: "b", name: "B" });
    const before = sent.b!.length;
    const errors = await logged(() => {
      for (const call of ["broadcast", "reserve", "kick", "move"]) expect(room.receive("a", message(call))).toBeNull();
    });
    expect(errors.every((error) => error instanceof GameServerError)).toBe(true);
    expect(errors.map((error) => [(error as GameServerError).code, (error as GameServerError).message])).toEqual([
      ["unknown_option", "room.broadcast doesn't take except. It takes exceptPlayerId."],
      ["unknown_option", "room.reserve doesn't take players. It takes playerIds, startData, isListed, name, labels."],
      ["unknown_option", "room.kick doesn't take reason. It takes message, keepOut."],
      ["unknown_option", "room.moveTo doesn't take players. It takes playerIds, joinData."],
    ]);
    expect(sent.b!.length).toBe(before);
    expect([reserved, asked, closed]).toEqual([[], [], []]);
    expect([...room.players.keys()]).toEqual(["a", "b"]);
  });

  it("checks game server settings", () => {
    expect(thrown(() => defineGameServer({ maximumPlayerCount: 17, setup: () => ({}) }))).toMatchObject({ code: "bad_option" });
    expect(thrown(() => defineGameServer({ ticksPerSec: 60, setup: () => ({}) }))).toMatchObject({ code: "bad_option" });
    expect(() => defineGameServer({ maximumPlayerCount: 16, ticksPerSec: 30, setup: () => ({}) })).not.toThrow();
  });

  it("refuses an option it doesn't take, listing the ones it does", () => {
    const error = thrown(() => defineGameServer({ tickRate: 20, setup: () => ({}) } as never));
    expect(error).toBeInstanceOf(GameServerError);
    expect(error).toMatchObject({ code: "unknown_option", message: expect.stringContaining("A game server doesn't take tickRate. It takes maximumPlayerCount, ticksPerSec,") });
  });

  it("refuses an idle timeout unless the server does the idle check, and handlers that aren't functions", () => {
    expect(thrown(() => defineGameServer({ setup: () => ({}), idleCheck: "client", idleTimeoutSec: 60 }))).toMatchObject({ code: "bad_option", message: expect.stringContaining("idleTimeoutSec") });
    expect(thrown(() => defineGameServer({ setup: () => ({}), idleCheck: "off", idleTimeoutSec: 60 }))).toMatchObject({ code: "bad_option" });
    expect(() => defineGameServer({ setup: () => ({}), idleCheck: "server", idleTimeoutSec: 60 })).not.toThrow();
    expect(thrown(() => defineGameServer({ setup: () => ({}), onJoin: "hello" as never }))).toMatchObject({ code: "bad_option", message: "onJoin must be a function." });
    expect(thrown(() => defineGameServer({ setup: {} as never }))).toMatchObject({ code: "bad_option" });
  });
});

describe("kicking and turning players away", () => {
  // Kicks whoever says "kick <id>"; a password in the player's joinData lets them in.
  const guarded = defineGameServer({
    hostControlsEnabled: false,
    setup: () => ({ count: 0, left: [] as string[], asked: [] as string[] }),
    canJoin(s, p, _room, joinData) {
      s.asked.push(p.id);
      if (p.id === "boom") throw new Error("game bug");
      if (p.id === "nobody") return false;
      // A string answer is a mistake: it turns the player away rather than letting them in.
      if (p.id === "mistake") return "Wrong password." as never;
      return (joinData as { password?: string } | undefined)?.password === "docks" || { refusalMessage: "Wrong password." };
    },
    onLeave: (s, p) => void s.left.push(p.id),
    onMessage(s, _p, messageData, room) {
      const [word, id, keep] = String(messageData).split(" ");
      if (word === "kick") room.kick(id!, { message: "Too rough.", keepOut: keep === "out" });
      s.count++;
    },
  });
  const pw = { password: "docks" };

  it("lets the game server turn players away at the door, with its refusal message", async () => {
    const room = new RoomCore(guarded, transport().t);
    expect(await room.admit({ id: "a", name: "A" }, pw)).toEqual({ ok: true });
    expect(await room.admit({ id: "b", name: "B" }, { password: "nope" })).toEqual({ ok: false, code: "refused", message: "Wrong password." });
    expect(await room.admit({ id: "nobody", name: "N" }, pw)).toEqual({ ok: false, code: "refused" });
    // A game server that crashes deciding turns the player away rather than letting them past it.
    expect(await room.admit({ id: "boom", name: "X" }, pw)).toEqual({ ok: false, code: "refused" });
    room.join({ id: "a", name: "A" }, { joinData: pw });
    // A player already in the room (a reconnect) isn't asked again.
    room.state.asked = [];
    expect(await room.admit({ id: "a", name: "A" })).toEqual({ ok: true });
    expect(room.state.asked).toEqual([]);
  });

  it("turns a player away with the usual message when canJoin answers a string, and logs the mistake", async () => {
    const room = new RoomCore(guarded, transport().t);
    let admission: unknown;
    const errors = await logged(async () => {
      admission = await room.admit({ id: "mistake", name: "M" }, pw);
    });
    expect(admission).toEqual({ ok: false, code: "refused" });
    expect(errors).toEqual(["Wrong password."]);
  });

  it("kicks a player, running onLeave after the handler that kicked them, without losing either's changes", () => {
    const { t, sent, closed } = transport();
    const room = new RoomCore(guarded, t);
    room.join({ id: "a", name: "A" });
    room.join({ id: "b", name: "B" });
    expect(room.receive("a", message("kick b"))).toBeNull();
    expect(sent.b!.at(-1)).toEqual({ type: "kicked", message: "Too rough.", isKeptOut: false });
    expect(closed).toEqual(["b"]);
    expect(room.state).toMatchObject({ count: 1, left: ["b"] });
    expect(sent.a!.at(-1)).toEqual({ type: "players", players: [{ id: "a", name: "A" }], hostPlayerId: null });
    // Kicked without keepOut, they may come back while the room is open.
    expect(room.join({ id: "b", name: "B" })).toEqual({ ok: true, rejoined: false });
  });

  it("keeps a kicked player out for the rest of the match, and out of rooms it reserves", async () => {
    const reserved: RoomStart[] = [];
    const { t } = transport();
    const room = new RoomCore(guarded, { ...t, reserve: (_code, start) => reserved.push(start) });
    room.join({ id: "a", name: "A" });
    room.join({ id: "b", name: "B" });
    room.receive("a", message("kick b out"));
    expect(await room.admit({ id: "b", name: "B" }, pw)).toEqual({ ok: false, code: "kept_out", message: "Too rough." });
    expect(room.join({ id: "b", name: "B" })).toEqual({ ok: false, code: "kept_out", message: "Too rough." });

    // A sleeping room wakes still keeping them out.
    const woken = new RoomCore(guarded, transport().t, { state: room.state, room: room.saved });
    expect(woken.join({ id: "b", name: "B" })).toMatchObject({ ok: false, code: "kept_out" });

    // The match the room starts keeps them out too, even once it opens.
    (room as any).api.reserve({ playerIds: ["a"] });
    expect(reserved[0]!.keptOut).toEqual({ b: "Too rough." });
    const match = new RoomCore(guarded, transport().t, { start: reserved[0]! });
    match.join({ id: "a", name: "A" });
    (match as any).api.setOpen(true);
    expect(match.join({ id: "b", name: "B" })).toMatchObject({ ok: false, code: "kept_out" });
  });

  it("forgets a kicked player, so a closed room doesn't let them back", () => {
    const room = new RoomCore(guarded, transport().t);
    room.join({ id: "a", name: "A" });
    room.join({ id: "b", name: "B" });
    room.receive("a", message("kick b"));
    (room as any).api.setOpen(false);
    expect(room.join({ id: "b", name: "B" })).toEqual({ ok: false, code: "closed" });
  });

  it("gives relay games a host who can kick, and hands it on when they leave", () => {
    const { t, sent, closed } = transport();
    const room = new RoomCore(relay, t);
    room.join({ id: "a", name: "A" });
    room.join({ id: "b", name: "B" });
    room.join({ id: "c", name: "C" });
    expect(sent.c![0]).toMatchObject({ type: "welcome", hostPlayerId: "a" });

    expect(room.receive("b", JSON.stringify({ type: "kick", playerId: "c" }))).toBe("not_allowed");
    expect(room.receive("a", JSON.stringify({ type: "kick", playerId: "a" }))).toBe("bad_message");
    expect(room.receive("a", JSON.stringify({ type: "kick", playerId: "c", keepOut: true }))).toBeNull();
    // Players can't type the message: no free text between strangers.
    expect(sent.c!.at(-1)).toEqual({ type: "kicked", message: "The host removed you from this room.", isKeptOut: true });
    expect(closed).toEqual(["c"]);

    room.leave("a");
    expect(sent.b!.at(-1)).toEqual({ type: "players", players: [{ id: "b", name: "B" }], hostPlayerId: "b" });
    expect(room.receive("b", JSON.stringify({ type: "update_room", isOpen: false }))).toBeNull();
  });
});

describe("moving players to a room that's already running", () => {
  // An area of an open world: takes players moving in unless it's "locked", and remembers where they came from.
  const area = defineGameServer({
    maximumPlayerCount: 3,
    setup: () => ({ locked: false, arrived: [] as unknown[], results: [] as unknown[] }),
    canJoin: (s, _p, _room, _joinData, joinInfo) => !(s.locked && joinInfo.fromRoomCode) || { refusalMessage: "This area is locked." },
    onJoin: (s, p, _room, joinData, joinInfo) => void s.arrived.push({ id: p.id, joinData: joinData ?? null, fromRoomCode: joinInfo.fromRoomCode }),
    onMessage(s, p, messageData, room) {
      if (messageData === "lock") s.locked = true;
      const [word, code, ...ids] = String(messageData).split(" ");
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
          void (target ? target.expect({ ...ask, from: code }) : Promise.resolve({ moved: [], refused: ask.players.map((p) => ({ id: p.id, code: "no_room" as const, reason: "That room isn't running." })) })).then((a) => {
            for (const id of a.moved) (moves[id] ??= []).push(next);
            core.moved(next, a, ask.players);
          });
        },
      });
      rooms.set(code, core);
      return core;
    };
    return { make, moves, rooms };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("sends players to another room, which gets the sending room's data and where they came from", async () => {
    const { make, moves } = world();
    const town = make("TWNAAA");
    const forest = make("FRSTAA");
    forest.join({ id: "z", name: "Z" });
    town.join({ id: "a", name: "A" });
    town.join({ id: "b", name: "B" });
    town.receive("a", message("go FRSTAA a b"));
    await tick();
    expect(moves).toEqual({ a: ["FRSTAA"], b: ["FRSTAA"] });
    expect(town.state.results).toEqual([{ roomCode: "FRSTAA", movedPlayers: [{ id: "a", name: "A" }, { id: "b", name: "B" }], refusedPlayers: [] }]);

    // They arrive with the town's joinData, not whatever their browser sends, and the game isn't asked again.
    expect(await forest.admit({ id: "a", name: "A" }, { door: "cheat" })).toEqual({ ok: true });
    forest.join({ id: "a", name: "A" }, { joinData: { door: "cheat" } });
    expect(forest.state.arrived.at(-1)).toEqual({ id: "a", joinData: { door: "north" }, fromRoomCode: "TWNAAA" });
  });

  it("holds a seat for each player on their way, even in a closed room, for a minute", async () => {
    let now = 0;
    const target = new RoomCore(area, transport().t, { now: () => now });
    target.join({ id: "z", name: "Z" });
    (target as any).api.setOpen(false);
    expect(await target.expect({ from: "TWNAAA", players: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }] })).toEqual({
      moved: ["a", "b"],
      refused: [{ id: "c", code: "full", reason: "This room is full." }],
    });
    // The seats count as taken, so nobody else gets in ahead of them.
    (target as any).api.setOpen(true);
    expect(await target.admit({ id: "x", name: "X" })).toEqual({ ok: false, code: "full" });
    // A sleeping room wakes still holding them.
    const woken = new RoomCore(area, transport().t, { state: target.state, room: target.saved, now: () => now });
    expect(woken.join({ id: "a", name: "A" })).toMatchObject({ ok: true });
    // Seats run out after a minute.
    now += 61_000;
    expect(await target.admit({ id: "x", name: "X" })).toEqual({ ok: true });
    (target as any).api.setOpen(false);
    expect(target.join({ id: "b", name: "B" })).toEqual({ ok: false, code: "closed" });
  });

  it("lets the other room say no, and tells the sending room who stayed and why", async () => {
    const { make, moves } = world();
    const town = make("TWNAAA");
    const keep = make("KEEPAA");
    keep.join({ id: "z", name: "Z" });
    keep.receive("z", message("lock"));
    town.join({ id: "a", name: "A" });
    town.receive("a", message("go KEEPAA"));
    town.receive("a", message("go GNEAAA"));
    await tick();
    expect(moves).toEqual({});
    // Each answer comes back when that room has decided, so they can arrive in either order.
    expect([...town.state.results].sort((x: any, y: any) => x.roomCode.localeCompare(y.roomCode))).toEqual([
      { roomCode: "GNEAAA", movedPlayers: [], refusedPlayers: [{ player: { id: "a", name: "A" }, error: { code: "no_room", message: "That room isn't running." } }] },
      { roomCode: "KEEPAA", movedPlayers: [], refusedPlayers: [{ player: { id: "a", name: "A" }, error: { code: "refused", message: "This area is locked." } }] },
    ]);
    expect([...town.players.keys()]).toEqual(["a"]);
  });

  it("refuses mistakes in the game's call", () => {
    const { make } = world();
    const town = make("TWNAAA");
    town.join({ id: "a", name: "A" });
    const api = (town as any).api;
    expect(() => api.moveTo("nope", { playerIds: ["a"] })).toThrow("room code");
    expect(() => api.moveTo("FRSTAA", { playerIds: ["stranger"] })).toThrow("playerIds of players in this room");
    expect(() => api.moveTo("FRSTAA", { playerIds: ["a"], joinData: "x".repeat(5000) })).toThrow("plain JSON");
  });
});

describe("players who walk away", () => {
  const hosted = (options: Partial<GameServer> = {}) =>
    defineGameServer({
      maximumPlayerCount: 2,
      setup: () => ({ joined: [] as any[], left: [] as any[], away: [] as any[], back: [] as string[] }),
      onJoin: (s, p, _room, _joinData, joinInfo) => void s.joined.push([p.id, joinInfo]),
      onLeave: (s, p, _room, leaveInfo) => void s.left.push([p.id, leaveInfo.leaveReason]),
      ...options,
    } as GameServer);
  const clock = () => {
    const c = { now: 1_000_000 };
    return { c, now: () => c.now };
  };
  const say = (type: string, more: object = {}) => JSON.stringify({ type, ...more });

  it("tells each player when the room counts them away", () => {
    const { t, sent } = transport();
    new RoomCore(hosted(), t).join({ id: "a", name: "A" });
    expect(sent.a![0].awayChecks).toEqual({ idleTimeoutSec: 600, hiddenTimeoutSec: null });
    const ticking = transport();
    new RoomCore(hosted({ ticksPerSec: 10, idleTimeoutSec: 120 }), ticking.t).join({ id: "a", name: "A" });
    expect(ticking.sent.a![0].awayChecks).toEqual({ idleTimeoutSec: 120, hiddenTimeoutSec: 120 });
    const off = transport();
    new RoomCore(hosted({ idleCheck: "off" }), off.t).join({ id: "a", name: "A" });
    expect(off.sent.a![0].awayChecks).toEqual({ idleTimeoutSec: null, hiddenTimeoutSec: null });
  });

  it("takes a player who didn't answer 'Still there?' out of the match, holds their seat, and lets them straight back", () => {
    const { t, sent, closed } = transport();
    const { c, now } = clock();
    const room = new RoomCore(hosted(), t, { now });
    room.join({ id: "a", name: "A" });
    room.join({ id: "b", name: "B" });
    expect(room.receive("a", say("idle"))).toBeNull();
    expect(sent.a!.at(-1)).toEqual({ type: "away", awayReason: "idle", seatHoldDurationSec: 300 });
    expect(sent.b!.at(-1)).toEqual({ type: "players", players: [{ id: "b", name: "B" }], hostPlayerId: null });
    expect(room.state.left).toEqual([["a", "idle"]]);
    expect(room.playing).toBe(1);
    expect(room.heldSeats).toBe(1);
    // The held seat counts toward maximumPlayerCount.
    expect(room.join({ id: "c", name: "C" })).toEqual({ ok: false, code: "full" });
    // While out, the player's messages wait; coming back gives them their seat, without asking canJoin.
    expect(room.receive("a", message("hit"))).toBeNull();
    c.now += 60_000;
    expect(room.receive("a", say("back", { joinData: { color: "red" } }))).toBeNull();
    expect(room.state.joined.at(-1)).toEqual(["a", { fromRoomCode: null, isReturning: true }]);
    expect(sent.a!.at(-1)).toMatchObject({ type: "players" });
    expect(room.heldSeats).toBe(0);
    expect(closed).toEqual([]);
  });

  it("frees a held seat once it runs out, and closes that player's connection", () => {
    const { t, closed } = transport();
    const { c, now } = clock();
    const room = new RoomCore(hosted({ seatHoldDurationSec: 60 }), t, { now });
    room.join({ id: "a", name: "A" });
    room.receive("a", say("idle"));
    c.now += 59_000;
    room.sweep();
    expect(closed).toEqual([]);
    c.now += 1_000;
    room.sweep();
    expect(closed).toEqual(["a"]);
    expect(room.heldSeats).toBe(0);
    expect(room.receive("a", say("back"))).toBe("ended");
  });

  it("decides for itself when a game sends nothing for longer than the idle check allows", () => {
    const { t, sent } = transport();
    const { c, now } = clock();
    const room = new RoomCore(hosted({ idleTimeoutSec: 60 }), t, { now });
    room.join({ id: "a", name: "A" });
    room.join({ id: "b", name: "B" });
    // "Still there?" takes 30 seconds, and the room gives the game a minute more to say.
    c.now += 60_000 + 30_000 + 59_000;
    room.receive("b", say("here"));
    room.sweep();
    expect(room.playing).toBe(2);
    c.now += 1_000;
    room.sweep();
    expect(sent.a!.at(-1)).toEqual({ type: "away", awayReason: "idle", seatHoldDurationSec: 300 });
    expect(room.playing).toBe(1);
  });

  it("lets a player's game set its own idle check only where the game server leaves it to the client", () => {
    const { t, sent } = transport();
    const { c, now } = clock();
    const room = new RoomCore(defineGameServer({ ...relay, maximumPlayerCount: 4 }), t, { now });
    room.join({ id: "a", name: "A" }, { idleTimeoutSec: null });
    room.join({ id: "b", name: "B" }, { idleTimeoutSec: 45 });
    room.join({ id: "c", name: "C" });
    expect([sent.a![0].awayChecks.idleTimeoutSec, sent.b![0].awayChecks.idleTimeoutSec, sent.c![0].awayChecks.idleTimeoutSec]).toEqual([null, 45, 600]);
    c.now += 24 * 3600_000;
    room.sweep();
    expect(room.players.has("a")).toBe(true);
    expect(room.players.has("b")).toBe(false);
    const server = transport();
    new RoomCore(hosted(), server.t).join({ id: "a", name: "A" }, { idleTimeoutSec: null });
    expect(server.sent.a![0].awayChecks.idleTimeoutSec).toBe(600);
    // A hello's idleCheck and idleTimeoutSec: "off" is none, seconds are kept within the limits, nothing is the default.
    expect([clientIdleTimeoutSec("off", 300), clientIdleTimeoutSec("on", 5), clientIdleTimeoutSec("on", 45), clientIdleTimeoutSec(undefined, undefined)]).toEqual([null, 30, 45, undefined]);
  });

  it("counts a game hidden for 2 minutes as away in a real-time room, and not in a turn-based one", () => {
    const { t, sent } = transport();
    const { c, now } = clock();
    const room = new RoomCore(hosted({ ticksPerSec: 10 }), t, { now });
    room.join({ id: "a", name: "A" });
    room.join({ id: "b", name: "B" });
    room.receive("a", say("hidden"));
    room.receive("b", say("hidden"));
    c.now += 60_000;
    room.receive("b", say("shown"));
    c.now += 60_000;
    room.sweep();
    expect(sent.a!.at(-1)).toEqual({ type: "away", awayReason: "hidden", seatHoldDurationSec: 300 });
    expect([...room.players.keys()]).toEqual(["b"]);

    const turns = transport();
    const slow = new RoomCore(hosted(), turns.t, { now });
    slow.join({ id: "a", name: "A" });
    slow.receive("a", say("hidden"));
    c.now += 9 * 60_000;
    slow.sweep();
    expect(slow.players.has("a")).toBe(true);
  });

  it("holds the seat of a player whose connection was lost, but not one who left", () => {
    const { t } = transport();
    const room = new RoomCore(hosted(), t);
    room.join({ id: "a", name: "A" });
    room.join({ id: "b", name: "B" });
    room.leave("a", "connection_lost");
    room.leave("b");
    expect(room.state.left).toEqual([["a", "connection_lost"], ["b", "left"]]);
    expect(room.heldSeats).toBe(1);
    expect(room.join({ id: "a", name: "A" })).toEqual({ ok: true, rejoined: false });
    expect(room.state.joined.at(-1)).toEqual(["a", { fromRoomCode: null, isReturning: true }]);
    // A player out of the match whose connection then closes on purpose is gone for good.
    room.receive("a", say("idle"));
    room.leave("a");
    expect(room.heldSeats).toBe(0);
  });

  it("lets the game decide with onAway: the player stays, doesn't count as playing, and a room where everyone's away stops ticking", () => {
    const { t, sent } = transport();
    const room = new RoomCore(
      hosted({
        ticksPerSec: 10,
        setup: () => ({ joined: [] as any[], left: [] as any[], away: [] as any[], back: [] as string[], ticks: 0 }),
        onAway: (s, p, _room, awayReason) => void s.away.push([p.id, awayReason]),
        onBack: (s, p) => void s.back.push(p.id),
        onTick: (s) => void s.ticks++,
      }),
      t,
    );
    room.join({ id: "a", name: "A" });
    room.tick(0.1);
    room.receive("a", say("idle"));
    expect(room.state.away).toEqual([["a", "idle"]]);
    expect(room.players.has("a")).toBe(true);
    expect(room.playing).toBe(0);
    expect(sent.a!.some((m) => m.type === "away")).toBe(false);
    room.tick(0.1);
    expect(room.state.ticks).toBe(1);
    room.receive("a", say("back"));
    expect(room.state.back).toEqual(["a"]);
    expect(room.playing).toBe(1);
    expect(room.saved.kept).toBeUndefined();
  });

  it("sends a player who walked away to the lobby that made the room, holding their seat if the lobby says no", () => {
    const { t } = transport();
    const asked: any[] = [];
    const room = new RoomCore(
      hosted({ awayMode: "send_to_lobby", onMoved: (s: any) => void (s.heard = true) }),
      { ...t, moveTo: (code, ask) => asked.push([code, ask]) },
      { start: { players: ["a"], isListed: false, name: null, labels: {}, lobby: "LBBYAA" } },
    );
    room.join({ id: "a", name: "A" });
    room.receive("a", say("idle"));
    expect(asked).toEqual([["LBBYAA", { players: [{ id: "a", name: "A" }] }]]);
    room.moved("LBBYAA", { moved: [], refused: [{ id: "a", code: "full", reason: "This room is full." }] }, [{ id: "a", name: "A" }]);
    expect((room.state as any).heard).toBeUndefined();
    expect(room.heldSeats).toBe(1);
    expect(room.saved.lobby).toBe("LBBYAA");
  });

  it("keeps held seats and players kept away through a sleep", async () => {
    const { t } = transport();
    const keeper = hosted({ maximumPlayerCount: 3, onAway: () => {} });
    const room = new RoomCore(keeper, t);
    room.join({ id: "a", name: "A" });
    room.join({ id: "b", name: "B" });
    room.leave("a", "connection_lost");
    room.receive("b", say("idle"));
    const woke = new RoomCore(keeper, t, { state: room.state, players: [{ id: "b", name: "B" }], room: room.saved });
    expect(woke.heldSeats).toBe(1);
    expect(woke.playing).toBe(0);
    expect(await woke.admit({ id: "a", name: "A" })).toEqual({ ok: true });
  });

  it("checks the away settings when the game server is defined", () => {
    expect(() => defineGameServer({ setup: () => ({}), idleTimeoutSec: 5 })).toThrow("idleTimeoutSec");
    expect(() => defineGameServer({ setup: () => ({}), awayMode: "home" as never })).toThrow("awayMode");
    expect(() => defineGameServer({ setup: () => ({}), seatHoldDurationSec: 4000 })).toThrow("seatHoldDurationSec");
    expect(() => defineGameServer({ setup: () => ({}), idleCheck: "off", awayMode: "send_to_lobby", seatHoldDurationSec: 0 })).not.toThrow();
  });
});
