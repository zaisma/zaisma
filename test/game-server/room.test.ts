import { describe, expect, it } from "vitest";
import { RoomCore, defineGameServer, relay, ROOM_LIMITS, type Transport } from "../../packages/game-server/src/index.ts";

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

  it("checks game server settings", () => {
    expect(() => defineGameServer({ maxPlayers: 17, setup: () => ({}) })).toThrow();
    expect(() => defineGameServer({ tickRate: 60, setup: () => ({}) })).toThrow();
  });
});
