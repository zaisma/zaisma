import { describe, expect, it } from "vitest";
import { RoomCore, defineGameServer, isRoomCode, relay, ROOM_LIMITS, type RoomStart, type Transport } from "../../packages/game-server/src/index.ts";

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
  maxPlayers: 2,
  setup: () => ({ count: 0, joined: [] as string[], left: [] as string[] }),
  onJoin: (s, p) => void s.joined.push(p.id),
  onLeave: (s, p) => void s.left.push(p.id),
  onMessage(s, p, msg, room) {
    if (msg === "boom") throw new Error("game bug");
    if (msg === "end") return room.end("Someone won");
    s.count++;
    room.broadcast({ count: s.count, by: p.id });
  },
});

const msg = (d: unknown) => JSON.stringify({ t: "msg", d });

describe("RoomCore", () => {
  it("runs join, message and leave through the game server", () => {
    const { t, sent } = transport();
    const room = new RoomCore(counter, t);
    room.join({ id: "a", name: "A" });
    room.join({ id: "b", name: "B" });
    expect(sent.a![0]).toEqual({ t: "welcome", me: { id: "a", name: "A" }, players: [{ id: "a", name: "A" }], room: { listed: true, open: true, name: null, labels: {} } });
    expect(sent.a!.at(-1)).toEqual({ t: "players", players: [{ id: "a", name: "A" }, { id: "b", name: "B" }] });

    expect(room.receive("a", msg("hit"))).toBeNull();
    expect(sent.b!.at(-1)).toEqual({ t: "msg", d: { count: 1, by: "a" } });

    room.leave("b");
    expect(room.state.left).toEqual(["b"]);
    expect(sent.a!.at(-1)).toEqual({ t: "players", players: [{ id: "a", name: "A" }] });
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
    expect(room.receive("a", msg("x".repeat(ROOM_LIMITS.messageBytes)))).toBe("too-big");
    expect(room.receive("a", "not json")).toBe("bad-message");
    expect(room.receive("a", JSON.stringify({ hello: 1 }))).toBe("bad-message");

    let refused = 0;
    for (let i = 0; i < 200; i++) if (room.receive("a", msg("hit")) === "too-fast") refused++;
    expect(refused).toBeGreaterThan(100);
    now += 1000;
    expect(room.receive("a", msg("hit"))).toBeNull();
  });

  it("survives a crash in game code", () => {
    const room = new RoomCore(counter, transport().t);
    room.join({ id: "a", name: "A" });
    expect(room.receive("a", msg("boom"))).toBeNull();
    expect(room.receive("a", msg("hit"))).toBeNull();
    expect(room.state.count).toBe(1);
  });

  it("ends the match and closes everyone", () => {
    const { t, sent, closed } = transport();
    const room = new RoomCore(counter, t);
    room.join({ id: "a", name: "A" });
    room.join({ id: "b", name: "B" });
    room.receive("a", msg("end"));
    expect(sent.b!.at(-1)).toEqual({ t: "ended", reason: "Someone won" });
    expect(closed).toEqual(["a", "b"]);
    expect(room.join({ id: "c", name: "C" })).toEqual({ ok: false, code: "ended" });
  });

  it("wakes from saved state without calling setup again", () => {
    const room = new RoomCore(counter, transport().t, { state: { count: 7, joined: ["a"], left: [] }, players: [{ id: "a", name: "A" }] });
    room.receive("a", msg("hit"));
    expect(room.state.count).toBe(8);
  });

  it("relay passes messages to everyone else", () => {
    const { t, sent } = transport();
    const room = new RoomCore(relay, t);
    room.join({ id: "a", name: "A" });
    room.join({ id: "b", name: "B" });
    const before = sent.a!.length;
    room.receive("a", msg({ x: 1 }));
    expect(sent.b!.at(-1)).toEqual({ t: "msg", d: { from: "a", data: { x: 1 } } });
    expect(sent.a!.length).toBe(before);
  });

  it("a closed room takes no new players, but lets back players who were in it", () => {
    const lobby = defineGameServer({
      maxPlayers: 4,
      setup: () => ({}),
      onMessage: (_s, _p, msg, room) => room.setOpen(msg !== "start"),
    });
    const { t, sent } = transport();
    const room = new RoomCore(lobby, t);
    room.join({ id: "a", name: "A" });
    room.join({ id: "b", name: "B" });
    room.listingChanged = false;
    room.receive("a", msg("start"));
    expect(room.open).toBe(false);
    expect(room.listingChanged).toBe(true);
    expect(sent.b!.at(-1)).toEqual({ t: "room", room: { listed: true, open: false, name: null, labels: {} } });
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
    hidden.join({ id: "a", name: "A" }, { listed: false });
    expect(hidden.listed).toBe(false);
    const shown = new RoomCore(counter, transport().t);
    shown.join({ id: "a", name: "A" });
    shown.join({ id: "b", name: "B" }, { listed: false });
    expect(shown.listed).toBe(true);
  });

  it("with host controls, the first player can hide and close the room, and nobody else can", () => {
    const { t, sent } = transport();
    const room = new RoomCore(relay, t);
    room.join({ id: "a", name: "A" });
    room.join({ id: "b", name: "B" });
    expect(room.receive("b", JSON.stringify({ t: "room", open: false }))).toBe("not-allowed");
    expect(room.open).toBe(true);
    expect(room.receive("a", JSON.stringify({ t: "room", listed: false, open: false }))).toBeNull();
    expect(sent.b!.at(-1)).toEqual({ t: "room", room: { listed: false, open: false, name: null, labels: {} } });
    // Without host controls, only the game server decides.
    const plain = new RoomCore(counter, transport().t);
    plain.join({ id: "a", name: "A" });
    expect(plain.receive("a", JSON.stringify({ t: "room", listed: false }))).toBe("not-allowed");
  });

  it("names and labels a room within the limits, from the game server, its maker or the relay's first player", () => {
    const named = defineGameServer({ setup: () => ({}), onMessage: (_s, _p, msg, room) => room.setInfo(msg as never) });
    const { t, sent } = transport();
    const room = new RoomCore(named, t);
    room.join({ id: "a", name: "A" }, { name: "  Ana\u200b's   castle ", labels: { Mode: "Classic", Map: 3, Bad: { x: 1 } as never } });
    expect([room.name, room.labels]).toEqual(["Ana's castle", { Mode: "Classic", Map: "3" }]);
    // Later players don't set it up; the game server can change it.
    room.join({ id: "b", name: "B" }, { name: "Mine now" });
    expect(room.name).toBe("Ana's castle");
    room.receive("a", msg({ name: "x".repeat(60), labels: { A: "1", B: "2", C: "3", D: "4", E: "5" } }));
    expect(room.name).toHaveLength(40);
    expect(Object.keys(room.labels)).toEqual(["A", "B", "C", "D"]);
    expect(sent.b!.at(-1)).toMatchObject({ t: "room", room: { name: "x".repeat(40) } });
    room.receive("a", msg({ name: null }));
    expect(room.name).toBeNull();
    // The relay's first player can name it; nobody else can.
    const relayed = new RoomCore(relay, transport().t);
    relayed.join({ id: "a", name: "A" });
    relayed.join({ id: "b", name: "B" });
    expect(relayed.receive("b", JSON.stringify({ t: "room", name: "Hijack" }))).toBe("not-allowed");
    expect(relayed.receive("a", JSON.stringify({ t: "room", name: "Friday night", labels: { Mode: "Co-op" } }))).toBeNull();
    expect([relayed.name, relayed.labels]).toEqual(["Friday night", { Mode: "Co-op" }]);
  });

  it("hands a player's join data to onJoin, once", () => {
    const got: unknown[] = [];
    const server = defineGameServer({ setup: () => ({}), onJoin: (_s, _p, _r, data) => void got.push(data) });
    const room = new RoomCore(server, transport().t);
    room.join({ id: "a", name: "A" }, { data: { character: "knight" } });
    room.join({ id: "b", name: "B" });
    room.join({ id: "a", name: "A" }, { data: { character: "again" } });
    expect(got).toEqual([{ character: "knight" }, undefined]);
  });

  it("reserves a room for some of its players, which starts with the data and lets only them in", () => {
    const reserved: [string, RoomStart][] = [];
    const { t } = transport();
    t.reserve = (code, start) => void reserved.push([code, start]);
    const lobby = defineGameServer({
      setup: (data?: unknown) => ({ data: data ?? null, code: "" }),
      onMessage(s, _p, msg, room) {
        if (msg === "big") room.reserve({ players: ["a"], data: "x".repeat(ROOM_LIMITS.dataBytes) });
        if (msg === "nobody") room.reserve({ players: ["zed"] });
        if (msg === "go") s.code = room.reserve({ players: ["a", "b", "zed", "a"], data: { map: "Docks" }, name: "Final", labels: { Mode: "Ranked" } });
      },
    });
    const room = new RoomCore(lobby, t);
    room.join({ id: "a", name: "A" });
    room.join({ id: "b", name: "B" });
    room.receive("a", msg("big"));
    room.receive("a", msg("nobody"));
    expect(reserved).toEqual([]);
    room.receive("a", msg("go"));
    expect(reserved).toHaveLength(1);
    const [code, start] = reserved[0]!;
    expect(isRoomCode(code) && room.state.code === code).toBe(true);
    // Only players in the room, once each; hidden unless the game lists it.
    expect(start).toEqual({ players: ["a", "b"], data: { map: "Docks" }, listed: false, name: "Final", labels: { Mode: "Ranked" } });

    const match = new RoomCore(lobby, transport().t, { start });
    expect(match.state.data).toEqual({ map: "Docks" });
    expect([match.open, match.listed, match.name]).toEqual([false, false, "Final"]);
    expect(match.join({ id: "c", name: "C" })).toEqual({ ok: false, code: "closed" });
    expect(match.join({ id: "a", name: "A" }, { name: "Not yours", listed: true })).toMatchObject({ ok: true });
    expect([match.name, match.listed]).toEqual(["Final", false]);
    // A room that starts over (a restart) starts with the same data.
    expect(new RoomCore(lobby, transport().t, { room: match.saved }).state.data).toEqual({ map: "Docks" });
    // A bug that reserves over and over is stopped.
    for (let i = 0; i < 30; i++) room.receive("a", msg("go"));
    expect(reserved).toHaveLength(ROOM_LIMITS.reservesPerMinute);
  });

  it("can't reserve rooms where the host doesn't make them", () => {
    const server = defineGameServer({ setup: () => ({ error: "" }), onJoin(s, p, room) { try { room.reserve({ players: [p.id] }); } catch (err) { s.error = (err as Error).message; } } });
    const room = new RoomCore(server, transport().t);
    room.join({ id: "a", name: "A" });
    expect(room.state.error).toBe("Reserved rooms aren't available here");
  });

  it("checks game server settings", () => {
    expect(() => defineGameServer({ maxPlayers: 17, setup: () => ({}) })).toThrow();
    expect(() => defineGameServer({ tickRate: 60, setup: () => ({}) })).toThrow();
  });
});

describe("kicking and turning players away", () => {
  // Kicks whoever says "kick <id>"; a password in the player's data lets them in.
  const guarded = defineGameServer({
    hostControls: false,
    setup: () => ({ count: 0, left: [] as string[], asked: [] as string[] }),
    canJoin(s, p, _room, data) {
      s.asked.push(p.id);
      if (p.id === "boom") throw new Error("game bug");
      if (p.id === "nobody") return false;
      return (data as { password?: string } | undefined)?.password === "docks" || "Wrong password.";
    },
    onLeave: (s, p) => void s.left.push(p.id),
    onMessage(s, _p, msg, room) {
      const [word, id, keep] = String(msg).split(" ");
      if (word === "kick") room.kick(id!, { reason: "Too rough.", keepOut: keep === "out" });
      s.count++;
    },
  });
  const pw = { password: "docks" };

  it("lets the game server turn players away at the door, with its reason", async () => {
    const room = new RoomCore(guarded, transport().t);
    expect(await room.admit({ id: "a", name: "A" }, pw)).toEqual({ ok: true });
    expect(await room.admit({ id: "b", name: "B" }, { password: "nope" })).toEqual({ ok: false, code: "refused", message: "Wrong password." });
    expect(await room.admit({ id: "nobody", name: "N" }, pw)).toEqual({ ok: false, code: "refused" });
    // A game server that crashes deciding turns the player away rather than letting them past it.
    expect(await room.admit({ id: "boom", name: "X" }, pw)).toEqual({ ok: false, code: "refused" });
    room.join({ id: "a", name: "A" }, { data: pw });
    // A player already in the room (a reconnect) isn't asked again.
    room.state.asked = [];
    expect(await room.admit({ id: "a", name: "A" })).toEqual({ ok: true });
    expect(room.state.asked).toEqual([]);
  });

  it("kicks a player, running onLeave after the handler that kicked them, without losing either's changes", () => {
    const { t, sent, closed } = transport();
    const room = new RoomCore(guarded, t);
    room.join({ id: "a", name: "A" });
    room.join({ id: "b", name: "B" });
    expect(room.receive("a", msg("kick b"))).toBeNull();
    expect(sent.b!.at(-1)).toEqual({ t: "kicked", reason: "Too rough.", keptOut: false });
    expect(closed).toEqual(["b"]);
    expect(room.state).toMatchObject({ count: 1, left: ["b"] });
    expect(sent.a!.at(-1)).toEqual({ t: "players", players: [{ id: "a", name: "A" }] });
    // Kicked without keepOut, they may come back while the room is open.
    expect(room.join({ id: "b", name: "B" })).toEqual({ ok: true, rejoined: false });
  });

  it("keeps a kicked player out for the rest of the match, and out of rooms it reserves", async () => {
    const reserved: RoomStart[] = [];
    const { t } = transport();
    const room = new RoomCore(guarded, { ...t, reserve: (_code, start) => reserved.push(start) });
    room.join({ id: "a", name: "A" });
    room.join({ id: "b", name: "B" });
    room.receive("a", msg("kick b out"));
    expect(await room.admit({ id: "b", name: "B" }, pw)).toEqual({ ok: false, code: "kept-out", message: "Too rough." });
    expect(room.join({ id: "b", name: "B" })).toEqual({ ok: false, code: "kept-out", message: "Too rough." });

    // A sleeping room wakes still keeping them out.
    const woken = new RoomCore(guarded, transport().t, { state: room.state, room: room.saved });
    expect(woken.join({ id: "b", name: "B" })).toMatchObject({ ok: false, code: "kept-out" });

    // The match the room starts keeps them out too, even once it opens.
    (room as any).api.reserve({ players: ["a"] });
    expect(reserved[0]!.keptOut).toEqual({ b: "Too rough." });
    const match = new RoomCore(guarded, transport().t, { start: reserved[0]! });
    match.join({ id: "a", name: "A" });
    (match as any).api.setOpen(true);
    expect(match.join({ id: "b", name: "B" })).toMatchObject({ ok: false, code: "kept-out" });
  });

  it("forgets a kicked player, so a closed room doesn't let them back", () => {
    const room = new RoomCore(guarded, transport().t);
    room.join({ id: "a", name: "A" });
    room.join({ id: "b", name: "B" });
    room.receive("a", msg("kick b"));
    (room as any).api.setOpen(false);
    expect(room.join({ id: "b", name: "B" })).toEqual({ ok: false, code: "closed" });
  });

  it("gives relay games a host who can kick, and hands it on when they leave", () => {
    const { t, sent, closed } = transport();
    const room = new RoomCore(relay, t);
    room.join({ id: "a", name: "A" });
    room.join({ id: "b", name: "B" });
    room.join({ id: "c", name: "C" });
    expect(sent.c![0]).toMatchObject({ t: "welcome", host: "a" });

    expect(room.receive("b", JSON.stringify({ t: "kick", player: "c" }))).toBe("not-allowed");
    expect(room.receive("a", JSON.stringify({ t: "kick", player: "a" }))).toBe("bad-message");
    expect(room.receive("a", JSON.stringify({ t: "kick", player: "c", keepOut: true }))).toBeNull();
    // Players can't type the reason: no free text between strangers.
    expect(sent.c!.at(-1)).toEqual({ t: "kicked", reason: "The host removed you from this room.", keptOut: true });
    expect(closed).toEqual(["c"]);

    room.leave("a");
    expect(sent.b!.at(-1)).toEqual({ t: "players", players: [{ id: "b", name: "B" }], host: "b" });
    expect(room.receive("b", JSON.stringify({ t: "room", open: false }))).toBeNull();
  });
});

describe("moving players to a room that's already running", () => {
  // An area of an open world: takes players moving in unless it's "locked", and remembers where they came from.
  const area = defineGameServer({
    maxPlayers: 3,
    setup: () => ({ locked: false, arrived: [] as unknown[], results: [] as unknown[] }),
    canJoin: (s, _p, _room, _data, info) => !(s.locked && info?.from) || "This area is locked.",
    onJoin: (s, p, _room, data, info) => void s.arrived.push({ id: p.id, data: data ?? null, from: info?.from ?? null }),
    onMessage(s, p, msg, room) {
      if (msg === "lock") s.locked = true;
      const [word, code, ...ids] = String(msg).split(" ");
      if (word === "go") room.moveTo(code!, { players: ids.length ? ids : [p.id], data: { door: "north" } });
    },
    onMoved: (s, result) => void s.results.push(result),
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
          void (target ? target.expect({ ...ask, from: code }) : Promise.resolve({ moved: [], refused: ask.players.map((p) => ({ id: p.id, code: "no-room" as const, reason: "That room isn't running." })) })).then((a) => {
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
    town.receive("a", msg("go FRSTAA a b"));
    await tick();
    expect(moves).toEqual({ a: ["FRSTAA"], b: ["FRSTAA"] });
    expect(town.state.results).toEqual([{ code: "FRSTAA", moved: [{ id: "a", name: "A" }, { id: "b", name: "B" }], refused: [] }]);

    // They arrive with the town's data, not whatever their browser sends, and the game isn't asked again.
    expect(await forest.admit({ id: "a", name: "A" }, { door: "cheat" })).toEqual({ ok: true });
    forest.join({ id: "a", name: "A" }, { data: { door: "cheat" } });
    expect(forest.state.arrived.at(-1)).toEqual({ id: "a", data: { door: "north" }, from: "TWNAAA" });
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
    keep.receive("z", msg("lock"));
    town.join({ id: "a", name: "A" });
    town.receive("a", msg("go KEEPAA"));
    town.receive("a", msg("go GNEAAA"));
    await tick();
    expect(moves).toEqual({});
    // Each answer comes back when that room has decided, so they can arrive in either order.
    expect([...town.state.results].sort((x: any, y: any) => x.code.localeCompare(y.code))).toEqual([
      { code: "GNEAAA", moved: [], refused: [{ player: { id: "a", name: "A" }, code: "no-room", reason: "That room isn't running." }] },
      { code: "KEEPAA", moved: [], refused: [{ player: { id: "a", name: "A" }, code: "refused", reason: "This area is locked." }] },
    ]);
    expect([...town.players.keys()]).toEqual(["a"]);
  });

  it("refuses mistakes in the game's call", () => {
    const { make } = world();
    const town = make("TWNAAA");
    town.join({ id: "a", name: "A" });
    const api = (town as any).api;
    expect(() => api.moveTo("nope", { players: ["a"] })).toThrow("room code");
    expect(() => api.moveTo("FRSTAA", { players: ["stranger"] })).toThrow("players who are in this room");
    expect(() => api.moveTo("FRSTAA", { players: ["a"], data: "x".repeat(5000) })).toThrow("plain JSON");
  });
});
