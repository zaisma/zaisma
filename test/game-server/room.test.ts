import { describe, expect, it, vi } from "vitest";
import { GameServerError, RoomCore, addTraffic, bytesFrame, defineGameServer, isRoomCode, noTraffic, readJoinAnswer, relay, restoreInfoOf, ROOM_LIMITS, type GameServer, type MoveAnswer, type RoomStart, type Transport } from "../../packages/game-server/src/internal.ts";

function transport() {
  const sent: Record<string, any[]> = {};
  const frames: Record<string, Uint8Array[]> = {};
  const closed: string[] = [];
  const t: Transport = {
    send: (id, text) => (sent[id] ??= []).push(JSON.parse(text)),
    sendBytes: (id, frame) => (frames[id] ??= []).push(frame),
    close: (id) => closed.push(id),
  };
  return { t, sent, frames, closed };
}

/** A binary frame as players' games read it: who it's from (null for the game server) and the bytes. */
function readFrame(frame: Uint8Array) {
  const fromLength = frame[0]!;
  return { fromPlayerId: fromLength ? new TextDecoder().decode(frame.subarray(1, 1 + fromLength)) : null, bytes: [...frame.subarray(1 + fromLength)] };
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

/** Answer every probe the room has sent, as players' games do at once, and the probes those answers bring. */
function answerProbes(room: RoomCore, sent: Record<string, any[]>) {
  for (let isAnswering = true; isAnswering; ) {
    isAnswering = false;
    for (const [id, messages] of Object.entries(sent)) {
      for (const message of messages) {
        if (message.type !== "probe" || message.isAnswered) continue;
        message.isAnswered = isAnswering = true;
        room.receive(id, JSON.stringify({ type: "probe_answer", probeNumber: message.probeNumber }));
      }
    }
  }
}
const nobodyJoined = { fromRoomCode: null, isReturning: false, isSpectator: false };

describe("RoomCore", () => {
  it("runs join, message and leave through the game server", () => {
    const { t, sent } = transport();
    const room = new RoomCore(counter, t);
    room.join({ id: "a", name: "A", kind: "guest" });
    room.join({ id: "b", name: "B", kind: "guest" });
    expect(sent.a![0]).toEqual({
      type: "welcome",
      me: { id: "a", name: "A", kind: "guest" },
      isSpectator: false,
      players: [{ id: "a", name: "A", kind: "guest", awayReason: null }],
      room: { isListed: true, isOpen: true, friendJoinsEnabled: true, name: null, labels: {} },
      spectatorCount: 0,
      hostPlayerId: null,
      awayChecks: { idleTimeoutSec: 600, hiddenTimeoutSec: null },
      endsAt: null,
      probeIntervalSec: null,
    });
    expect(sent.a!.at(-1)).toEqual({ type: "players", players: [{ id: "a", name: "A", kind: "guest", awayReason: null }, { id: "b", name: "B", kind: "guest", awayReason: null }], hostPlayerId: null });

    expect(room.receive("a", msg("hit"))).toBeNull();
    expect(sent.b!.at(-1)).toEqual({ type: "message", data: { count: 1, by: "a" } });

    room.leave("b");
    expect(room.state.left).toEqual(["b"]);
    expect(sent.a!.at(-1)).toEqual({ type: "players", players: [{ id: "a", name: "A", kind: "guest", awayReason: null }], hostPlayerId: null });
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

  it("tells every player and the game server once when Zaisma will end the match, and keeps it through a sleep", () => {
    const ender = defineGameServer({
      setup: () => ({ endingCount: 0, seenEndsAt: null as string | null }),
      onEnding(state, room) {
        state.endingCount++;
        state.seenEndsAt = room.endsAt;
        room.broadcast({ saved: true });
      },
    });
    const { t, sent } = transport();
    const room = new RoomCore(ender, t);
    room.join({ id: "a", name: "A", kind: "guest" });
    expect(sent.a![0]).toMatchObject({ type: "welcome", endsAt: null });
    expect(room.endsAt).toBeNull();

    const endsAt = new Date(Date.now() + 3600_000).toISOString();
    room.startEnding(endsAt);
    room.startEnding(new Date(Date.now() + 60_000).toISOString());
    expect(room.endsAt).toBe(endsAt);
    expect(sent.a!.filter((message) => message.type === "ending")).toEqual([{ type: "ending", endsAt }]);
    expect(room.state).toEqual({ endingCount: 1, seenEndsAt: endsAt });
    expect(sent.a!.at(-1)).toEqual({ type: "message", data: { saved: true } });

    // A player who joins after hears it in their welcome.
    room.join({ id: "b", name: "B", kind: "guest" });
    expect(sent.b![0]).toMatchObject({ type: "welcome", endsAt });

    // A sleeping room keeps it, and doesn't run onEnding again on waking.
    expect(room.saved.endsAt).toBe(endsAt);
    const woken = new RoomCore(ender, transport().t, { state: room.state, room: room.saved, players: [...room.players.values()] });
    expect(woken.endsAt).toBe(endsAt);
    woken.startEnding(new Date(Date.now() + 60_000).toISOString());
    expect(woken.state.endingCount).toBe(1);

    // A match that already ended doesn't start ending.
    const over = new RoomCore(counter, transport().t);
    over.join({ id: "a", name: "A", kind: "guest" });
    over.end("Someone won");
    over.startEnding(endsAt);
    expect(over.endsAt).toBeNull();
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
    expect(sent.b!.at(-1)).toEqual({ type: "room", room: { isListed: true, isOpen: false, friendJoinsEnabled: true, name: null, labels: {} }, spectatorCount: 0 });
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
    expect(sent.b!.at(-1)).toEqual({ type: "room", room: { isListed: false, isOpen: false, friendJoinsEnabled: true, name: null, labels: {} }, spectatorCount: 0 });
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
    expect(() => defineGameServer({ maximumPlayerCount: 100, ticksPerSec: 60, setup: () => ({}) })).not.toThrow();
    expect(() => defineGameServer({ maximumPlayerCount: 101, setup: () => ({}) })).toThrow("maximumPlayerCount is 101. Give a whole number from 1 to 100, like 8.");
    expect(() => defineGameServer({ ticksPerSec: 61, setup: () => ({}) })).toThrow("ticksPerSec is 61. Give a number above 0 and up to 60, like 30, or leave it out for a turn-based game.");
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
      "tickRate isn't a game server option. A game server takes: maximumPlayerCount, maximumSpectatorCount, ticksPerSec, hostControlsEnabled, idleCheck, idleTimeoutSec, awayMode, seatHoldDurationSec, stateSyncEnabled, reconnectTimeoutSec, stateSaveIntervalSec, setup, onJoin, canJoin, onMoved, onLeave, onSpectatorJoin, onSpectatorLeave, onAway, onBack, onMessage, onBytes, onTick, onEnding, onRestored, stateView, onVersionUpdate, onRequest, schedules, onSchedule, onWebhook. (unknown_option)",
    );
  });

  it("takes bytes from players for onBytes, under the same limits as messages", () => {
    const got: number[][] = [];
    const { t, frames } = transport();
    const room = new RoomCore(defineGameServer({ setup: () => ({}), onBytes: (_s, player, bytes, api) => {
      got.push([...bytes]);
      api.sendBytes(player.id, new Uint8Array([9]));
      api.broadcastBytes(new Uint8Array(new Uint16Array([258]).buffer), { exceptPlayerId: player.id });
    } }), t);
    room.join({ id: "a", name: "A", kind: "guest" });
    room.join({ id: "b", name: "B", kind: "guest" });
    expect(room.receiveBytes("a", new Uint8Array([1, 2, 3]))).toBeNull();
    expect(got).toEqual([[1, 2, 3]]);
    // From the game server: no sender in the header.
    expect(frames.a!.map(readFrame)).toEqual([{ fromPlayerId: null, bytes: [9] }]);
    expect(frames.b!.map(readFrame)).toEqual([{ fromPlayerId: null, bytes: [2, 1] }]);
    expect(room.receiveBytes("a", new Uint8Array(ROOM_LIMITS.maximumGameMessageSizeBytes + 1))).toBe("too_big");
    expect(room.receiveBytes("nobody", new Uint8Array([1]))).toBe("ended");
    let refusal: string | null = null;
    for (let i = 0; i < ROOM_LIMITS.gameMessageBurstCount + 5 && !refusal; i++) refusal = room.receiveBytes("b", new Uint8Array([i]));
    expect(refusal).toBe("too_fast");
    // Bytes and messages share one budget.
    expect(room.receive("b", msg("hi"))).toBe("too_fast");

    const textOnly = new RoomCore(defineGameServer({ setup: () => ({}), onMessage: () => {} }), transport().t);
    textOnly.join({ id: "a", name: "A", kind: "guest" });
    expect(textOnly.receiveBytes("a", new Uint8Array([1]))).toBe("bad_message");
  });

  it("passes bytes on through the relay, saying whose they are", () => {
    const { t, frames } = transport();
    const room = new RoomCore(relay, t);
    for (const id of ["player_a", "player_b", "player_c"]) room.join({ id, name: id, kind: "guest" });
    room.receiveBytes("player_a", new Uint8Array([7, 8]));
    expect(frames.player_a).toBeUndefined();
    expect(frames.player_b!.map(readFrame)).toEqual([{ fromPlayerId: "player_a", bytes: [7, 8] }]);
    expect(frames.player_c!.map(readFrame)).toEqual([{ fromPlayerId: "player_a", bytes: [7, 8] }]);
    expect(bytesFrame(new Uint8Array([1]), "player_a")).toEqual(new Uint8Array([8, ...new TextEncoder().encode("player_a"), 1]));
  });

  it("counts the room's traffic by message type, each way", () => {
    const { t } = transport();
    const room = new RoomCore(defineGameServer({ setup: () => ({}), onMessage: (_s, _p, message, api) => api.broadcast(message), onBytes: () => {} }), t);
    for (const id of "abcdefgh") room.join({ id, name: id, kind: "guest" });
    room.takeTraffic();
    room.receive("a", msg({ type: "move", x: 1 }));
    room.receive("a", msg("no type"));
    room.receiveBytes("a", new Uint8Array(10));
    const traffic = room.takeTraffic();
    const type = (direction: string, messageType: string) => traffic.messageTypes.find((each) => each.direction === direction && each.messageType === messageType);
    expect(type("inbound", "move")).toMatchObject({ messageCount: 1, sizeBytes: msg({ type: "move", x: 1 }).length });
    expect(type("inbound", "(none)")).toMatchObject({ messageCount: 1 });
    expect(type("inbound", "(bytes)")).toMatchObject({ messageCount: 1, sizeBytes: 10, largestSizeBytes: 10 });
    // A broadcast to 8 players counts 8 out.
    expect(type("outbound", "move")).toMatchObject({ messageCount: 8 });
    expect(type("outbound", "(none)")).toMatchObject({ messageCount: 8 });
    expect(traffic.outboundMessageCount).toBe(16);
    expect(traffic.inboundSizeBytes).toBe(msg({ type: "move", x: 1 }).length + msg("no type").length + 10);
    // Taken: the counts start again.
    expect(room.takeTraffic()).toEqual(noTraffic());

    // Past 20 types each way, the rest count as (other).
    for (let i = 0; i < 25; i++) room.receive("b", msg({ type: `kind${i}` }));
    const many = room.takeTraffic();
    expect(many.messageTypes.filter((each) => each.direction === "inbound").length).toBe(21);
    expect(many.messageTypes.find((each) => each.direction === "inbound" && each.messageType === "(other)")).toMatchObject({ messageCount: 5 });
    expect(addTraffic(many, many).messageTypes.find((each) => each.direction === "inbound" && each.messageType === "(other)")).toMatchObject({ messageCount: 10 });
  });

  it("takes 100 players, and turns the 101st away as full", () => {
    const room = new RoomCore(defineGameServer({ maximumPlayerCount: 100, ticksPerSec: 60, setup: () => ({}) }), transport().t);
    for (let i = 0; i < 100; i++) expect(room.join({ id: `p${i}`, name: `P${i}`, kind: "guest" }).isAllowed).toBe(true);
    expect(room.join({ id: "p100", name: "P100", kind: "guest" })).toMatchObject({ isAllowed: false, code: "full" });
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
    expect(sent.a!.at(-1)).toEqual({ type: "players", players: [{ id: "a", name: "A", kind: "guest", awayReason: null }], hostPlayerId: null });
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

  it("turns friends' Join off for a room: from its maker, the game server, the host, a reserve, and after a sleep", () => {
    const { t, sent } = transport();
    const room = new RoomCore(counter, t);
    // The player who makes the room can start it private; a later joiner can't change it.
    room.join({ id: "a", name: "A", kind: "guest" }, { friendJoinsEnabled: false });
    room.join({ id: "b", name: "B", kind: "guest" }, { friendJoinsEnabled: true });
    expect((room as any).api.friendJoinsEnabled).toBe(false);
    expect(sent.b![0].room.friendJoinsEnabled).toBe(false);
    room.listingChanged = false;
    (room as any).api.setFriendJoinsEnabled(true);
    expect((room as any).api.friendJoinsEnabled).toBe(true);
    expect(room.listingChanged).toBe(true);
    expect(sent.a!.at(-1)).toEqual({ type: "room", room: { isListed: true, isOpen: true, friendJoinsEnabled: true, name: null, labels: {} }, spectatorCount: 0 });
    // A sleeping room wakes with it as it was.
    (room as any).api.setFriendJoinsEnabled(false);
    expect(new RoomCore(counter, transport().t, { state: room.state, room: room.saved }).friendJoinsEnabled).toBe(false);

    // The relay's host switches it too.
    const relayed = new RoomCore(relay, transport().t);
    relayed.join({ id: "h", name: "H", kind: "guest" });
    expect(relayed.receive("h", JSON.stringify({ type: "room", friendJoinsEnabled: false }))).toBeNull();
    expect(relayed.friendJoinsEnabled).toBe(false);

    // A room reserved with it off starts off; one reserved without it takes Join.
    const reserved: RoomStart[] = [];
    const lobby = new RoomCore(counter, { ...transport().t, reserve: (_code, start) => void reserved.push(start) });
    lobby.join({ id: "a", name: "A", kind: "guest" });
    (lobby as any).api.reserve({ playerIds: ["a"], friendJoinsEnabled: false });
    (lobby as any).api.reserve({ playerIds: ["a"] });
    expect(new RoomCore(counter, transport().t, { start: reserved[0]! }).friendJoinsEnabled).toBe(false);
    expect(new RoomCore(counter, transport().t, { start: reserved[1]! }).friendJoinsEnabled).toBe(true);
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
    expect(sent.b!.at(-1)).toEqual({ type: "players", players: [{ id: "b", name: "B", kind: "guest", awayReason: null }], hostPlayerId: "b" });
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
    expect(sent.b!.at(-1)).toEqual({ type: "players", players: [{ id: "b", name: "B", kind: "guest", awayReason: null }], hostPlayerId: null });
    expect(room.state.left).toEqual([["a", "idle"]]);
    expect(room.playingCount).toBe(1);
    expect(room.heldSeatCount).toBe(1);
    // The held seat counts toward maximumPlayerCount.
    expect(room.join({ id: "c", name: "C", kind: "guest" })).toEqual({ isAllowed: false, code: "full" });
    // While out, the player's messages wait; coming back gives them their seat, without asking canJoin.
    expect(room.receive("a", msg("hit"))).toBeNull();
    c.now += 60_000;
    expect(room.receive("a", say("back", { joinData: { color: "red" } }))).toBeNull();
    expect(room.state.joined.at(-1)).toEqual(["a", { fromRoomCode: null, isReturning: true, isSpectator: false }]);
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
    answerProbes(room, sent);
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
    answerProbes(room, sent);
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
    answerProbes(room, sent);
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
    answerProbes(slow, turns.sent);
    slow.receive("a", say("hidden"));
    c.now += 9 * 60_000;
    slow.sweep();
    expect(slow.players.has("a")).toBe(true);
  });

  it("holds the seat of a player whose connection was lost, but not one who left", () => {
    const { t } = transport();
    // reconnectTimeoutSec 0: a dropped player leaves the match at once.
    const room = new RoomCore(hosted({ reconnectTimeoutSec: 0 }), t);
    room.join({ id: "a", name: "A", kind: "guest" });
    room.join({ id: "b", name: "B", kind: "guest" });
    room.leave("a", "lost");
    room.leave("b");
    expect(room.state.left).toEqual([["a", "lost"], ["b", "left"]]);
    expect(room.heldSeatCount).toBe(1);
    expect(room.join({ id: "a", name: "A", kind: "guest" })).toEqual({ isAllowed: true, isRejoin: false });
    expect(room.state.joined.at(-1)).toEqual(["a", { fromRoomCode: null, isReturning: true, isSpectator: false }]);
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
    const keeper = hosted({ maximumPlayerCount: 3, reconnectTimeoutSec: 0, onAway: () => {} });
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

describe("friends between players", () => {
  it("knows which players are friends from their accounts, keeps it while the room sleeps, and a new join replaces it", () => {
    const seen: boolean[] = [];
    const watcher = defineGameServer({ maximumPlayerCount: 4, setup: () => ({}), onJoin: (_state, player, room) => void (player.id === "b" && seen.push(room.areFriends("a", "b"), room.areFriends("b", "a"))) });
    const { t } = transport();
    const room = new RoomCore(watcher, t);
    room.join({ id: "a", name: "A", kind: "account" });
    // B joins as A's friend, found as B came in (Zaisma's record, or the passes).
    room.setFriends("b", ["a"]);
    room.join({ id: "b", name: "B", kind: "account" });
    room.join({ id: "c", name: "C", kind: "guest" });
    expect(seen).toEqual([true, true]);
    expect(room.areFriends("a", "c")).toBe(false);
    expect(room.areFriends("a", "a")).toBe(false);
    const woken = new RoomCore(watcher, transport().t, { state: room.state, room: room.saved });
    expect(woken.areFriends("b", "a")).toBe(true);
    // Removed since: B's next join finds no friendship, and the room forgets it.
    woken.setFriends("b", []);
    expect(woken.areFriends("a", "b")).toBe(false);
  });
});

describe("blocks between players", () => {
  const blocks = (sent: Record<string, any[]>, id: string) => (sent[id] ?? []).filter((message) => message.type === "blocks").map((message) => message.playerIds);
  const seen: boolean[] = [];
  const watcher = defineGameServer({
    maximumPlayerCount: 4,
    setup: () => ({}),
    onJoin: (_state, player, room) => void (player.id === "c" && seen.push(room.hasBlockBetween("a", "b"), room.hasBlockBetween("b", "a"), room.hasBlockBetween("a", "c"))),
  });

  it("puts up a wall both ways from the players' accounts, tells both games, and the game server can ask", () => {
    const { t, sent } = transport();
    const room = new RoomCore(watcher, t);
    room.join({ id: "a", name: "A", kind: "account" });
    // B joins with a block between them and A, found as B came in (Zaisma's record, or the passes).
    room.setAccountBlocks("b", ["a"]);
    room.join({ id: "b", name: "B", kind: "account" });
    expect(blocks(sent, "a")).toEqual([["b"]]);
    expect(blocks(sent, "b")).toEqual([["a"]]);
    // Each hears it before the player list says the other is here.
    const types = sent.a!.map((message) => message.type);
    expect(types.indexOf("blocks")).toBeLessThan(types.lastIndexOf("players"));
    room.join({ id: "c", name: "C", kind: "guest" });
    expect(seen).toEqual([true, true, false]);
    // C has no blocks, so C hears nothing about them.
    expect(blocks(sent, "c")).toEqual([]);
    expect(room.hasBlockBetween("a", "a")).toBe(false);
  });

  it("takes a block a player's game says it made, and its unblock, and keeps them while the room sleeps", () => {
    const { t, sent } = transport();
    const room = new RoomCore(watcher, t);
    room.join({ id: "a", name: "A", kind: "guest" });
    room.join({ id: "b", name: "B", kind: "guest" });
    expect(room.receive("a", JSON.stringify({ type: "block", playerId: "b" }))).toBeNull();
    expect(room.hasBlockBetween("b", "a")).toBe(true);
    expect(blocks(sent, "b")).toEqual([["a"]]);
    // Saying it again changes nothing, and nobody is told twice.
    expect(room.receive("a", JSON.stringify({ type: "block", playerId: "b" }))).toBeNull();
    expect(blocks(sent, "b")).toEqual([["a"]]);
    // Only players the room knows, and never oneself.
    expect(room.receive("a", JSON.stringify({ type: "block", playerId: "zz" }))).toBe("bad_message");
    expect(room.receive("a", JSON.stringify({ type: "block", playerId: "a" }))).toBe("bad_message");

    const woken = new RoomCore(watcher, t, { state: room.state, room: room.saved, players: [...room.players.values()] });
    expect(woken.hasBlockBetween("a", "b")).toBe(true);
    // Only the blocker can take it back.
    expect(woken.receive("b", JSON.stringify({ type: "unblock", playerId: "a" }))).toBeNull();
    expect(woken.hasBlockBetween("a", "b")).toBe(true);
    expect(woken.receive("a", JSON.stringify({ type: "unblock", playerId: "b" }))).toBeNull();
    expect(woken.hasBlockBetween("a", "b")).toBe(false);
    expect(blocks(sent, "b").at(-1)).toEqual([]);
  });

  it("finds a player's account blocks afresh each time they join, so one taken back is gone", () => {
    const { t, sent } = transport();
    const room = new RoomCore(watcher, t);
    room.join({ id: "a", name: "A", kind: "account" });
    room.setAccountBlocks("b", ["a"]);
    room.join({ id: "b", name: "B", kind: "account" });
    room.leave("b");
    room.setAccountBlocks("b", []);
    room.join({ id: "b", name: "B", kind: "account" });
    expect(room.hasBlockBetween("a", "b")).toBe(false);
    // A new connection hears its blocks afresh: none now, so nothing is said.
    expect(blocks(sent, "b")).toEqual([["a"]]);
    expect(blocks(sent, "a")).toEqual([["b"], []]);
  });
});

describe("ping and the room's clock", () => {
  const game = (overrides: Partial<GameServer> = {}) =>
    defineGameServer({
      setup: () => ({ left: [] as any[] }),
      onLeave: (s, p, _room, leaveInfo) => void s.left.push([p.id, leaveInfo.reason]),
      ...overrides,
    } as GameServer);
  const recording = () => {
    const sent: Record<string, any[]> = {};
    const closed: [string, number][] = [];
    const t: Transport = { send: (id, text) => (sent[id] ??= []).push(JSON.parse(text)), close: (id, closeCode) => closed.push([id, closeCode]) };
    return { t, sent, closed };
  };
  const probes = (messages: any[] | undefined) => (messages ?? []).filter((message) => message.type === "probe");
  const answer = (room: RoomCore, id: string, probeNumber: number) => room.receive(id, JSON.stringify({ type: "probe_answer", probeNumber }));
  /** Answer the probes a player hasn't answered yet, as their game does. */
  const answerAll = (room: RoomCore, sent: Record<string, any[]>, id: string) => {
    for (const probe of probes(sent[id])) if (!probe.isAnswered) (probe.isAnswered = true), answer(room, id, probe.probeNumber);
  };
  const player = (id: string) => ({ id, name: id.toUpperCase(), kind: "guest" as const });

  it("probes a player right after welcome, saying how often a ticking room probes", () => {
    const now = 1_000_000;
    const turns = recording();
    new RoomCore(game(), turns.t, { now: () => now }).join(player("a"));
    expect(turns.sent.a![0]).toMatchObject({ type: "welcome", probeIntervalSec: null });
    expect(turns.sent.a![1]).toEqual({ type: "probe", probeNumber: 1, serverTimeMs: now, pingDurationMs: null });
    const ticking = recording();
    new RoomCore(game({ ticksPerSec: 20, onTick: () => {} }), ticking.t, { now: () => now }).join(player("a"));
    expect(ticking.sent.a![0]).toMatchObject({ type: "welcome", probeIntervalSec: ROOM_LIMITS.probeIntervalSec });
    expect(ticking.sent.a![1]).toMatchObject({ type: "probe", probeNumber: 1 });
  });

  it("measures ping from the answers, smoothed, and tells the player the same number", () => {
    let now = 1_000_000;
    const { t, sent } = recording();
    const room = new RoomCore(game({ ticksPerSec: 20, onTick: () => {} }), t, { now: () => now });
    room.join(player("a"));
    now += 80;
    expect(answer(room, "a", 1)).toBeNull();
    expect((room as any).api.pingDurationMs("a")).toBe(80);
    // The first measurement brings a probe at once, so the player's game hears its ping too.
    expect(probes(sent.a).at(-1)).toEqual({ type: "probe", probeNumber: 2, serverTimeMs: now, pingDurationMs: 80 });
    now += 40;
    answer(room, "a", 2);
    expect((room as any).api.pingDurationMs("a")).toBe(70);
    now += ROOM_LIMITS.probeIntervalSec * 1000;
    room.tick(0.05);
    expect(probes(sent.a).at(-1)).toMatchObject({ probeNumber: 3, pingDurationMs: 70 });
  });

  it("probes a ticking room's players every probeIntervalSec, and not before", () => {
    let now = 1_000_000;
    const { t, sent } = recording();
    const room = new RoomCore(game({ ticksPerSec: 20, onTick: () => {} }), t, { now: () => now });
    room.join(player("a"));
    expect(probes(sent.a)).toHaveLength(1);
    now += ROOM_LIMITS.probeIntervalSec * 1000 - 50;
    room.tick(0.05);
    expect(probes(sent.a)).toHaveLength(1);
    now += 50;
    room.tick(0.05);
    expect(probes(sent.a)).toHaveLength(2);
    // A room that doesn't tick doesn't probe on a timer: it sleeps between moves.
    const turns = recording();
    const slow = new RoomCore(game(), turns.t, { now: () => now });
    slow.join(player("a"));
    answer(slow, "a", 1);
    now += 60_000;
    slow.sweep();
    expect(probes(turns.sent.a)).toHaveLength(2);
  });

  it("doesn't count probe answers as messages or input, but limits answers that match no probe", () => {
    let now = 1_000_000;
    const { t } = recording();
    const room = new RoomCore(game({ idleTimeoutSec: 60 }), t, { now: () => now });
    room.join(player("a"));
    expect(answer(room, "a", 1)).toBeNull();
    expect(answer(room, "a", 2)).toBeNull();
    expect(room.messageCount).toBe(0);
    // Unknown answers are counted and take from the 30 a second.
    expect(answer(room, "a", 999)).toBeNull();
    expect(room.messageCount).toBe(1);
    let refused = 0;
    for (let i = 0; i < ROOM_LIMITS.gameMessageBurstCount + 1; i++) if (answer(room, "a", 999) === "too_fast") refused++;
    expect(refused).toBeGreaterThan(0);
    expect(room.receive("a", msg("hit"))).toBe("too_fast");
    // A player who answers probes but gives no input still goes idle.
    const later = recording();
    const watched = new RoomCore(game({ idleTimeoutSec: 60 }), later.t, { now: () => now });
    watched.join(player("b"));
    for (let i = 0; i < 20; i++) {
      now += 10_000;
      answerAll(watched, later.sent, "b");
      watched.sweep();
    }
    expect(watched.players.has("b")).toBe(false);
    expect(watched.held.get("b")?.reason).toBe("idle");
  });

  it("drops a player whose probe goes unanswered for probeAnswerTimeoutSec, at the next tick or sweep", () => {
    let now = 1_000_000;
    const { t, closed } = recording();
    const room = new RoomCore(game({ ticksPerSec: 20, onTick: () => {} }), t, { now: () => now });
    room.join(player("a"));
    room.join(player("b"));
    now += ROOM_LIMITS.probeAnswerTimeoutSec * 1000 - 1;
    // b answers; a doesn't.
    answer(room, "b", 2);
    room.tick(0.05);
    expect(closed).toEqual([]);
    now += 1;
    room.tick(0.05);
    expect(closed).toEqual([["a", 4003]]);
    // Dropped: still in the match, reconnecting, for reconnectTimeoutSec.
    expect(room.state.left).toEqual([]);
    expect((room as any).api.awayReason("a")).toBe("lost");
    // The runtime's close event comes later and changes nothing.
    room.leave("a", "lost");
    expect(room.state.left).toEqual([]);
    now += ROOM_LIMITS.defaultReconnectTimeoutSec * 1000;
    room.tick(0.05);
    expect(room.state.left).toEqual([["a", "lost"]]);
    expect(room.held.get("a")?.reason).toBe("lost");
    expect(room.players.has("b")).toBe(true);

    const turns = recording();
    const slow = new RoomCore(game(), turns.t, { now: () => now });
    slow.join(player("a"));
    now += ROOM_LIMITS.probeAnswerTimeoutSec * 1000;
    slow.sweep();
    expect(turns.closed).toEqual([["a", 4003]]);
    expect(slow.state.left).toEqual([]);
    now += ROOM_LIMITS.defaultReconnectTimeoutSec * 1000;
    slow.sweep();
    expect(slow.state.left).toEqual([["a", "lost"]]);
  });

  it("probes every sentBytesPerProbe sent, and drops a player maximumUnansweredSentBytes behind", () => {
    const now = 1_000_000;
    const big = "x".repeat(100 * 1024);
    const pushing = game({ onMessage: (_s: any, _p: any, data: any, room: any) => room.broadcast(data === "big" ? big : data) });
    const { t, sent, closed } = recording();
    const room = new RoomCore(pushing, t, { now: () => now });
    room.join(player("a"));
    room.join(player("b"));
    // b sends messages that push about 100 KB to everyone; b answers its probes, a doesn't.
    for (let i = 0; i < 3; i++) {
      room.receive("b", msg("big"));
      answerAll(room, sent, "b");
    }
    expect(probes(sent.a)).toHaveLength(2);
    expect(probes(sent.a)[1].probeNumber).toBeGreaterThan(1);
    let count = 3;
    while (!closed.length && count < 40) {
      room.receive("b", msg("big"));
      answerAll(room, sent, "b");
      count++;
    }
    expect(closed).toEqual([["a", 4003]]);
    // Dropped on the send that took them past 2 MB.
    expect(count * (big.length + 30)).toBeGreaterThan(ROOM_LIMITS.maximumUnansweredSentBytes);
    expect((count - 1) * big.length).toBeLessThanOrEqual(ROOM_LIMITS.maximumUnansweredSentBytes);
    expect(room.state.left).toEqual([]);
    // b, who answers, gets the players list with a reconnecting, after the message that dropped a.
    expect(sent.b!.at(-1)).toMatchObject({ type: "players", players: [{ id: "a", awayReason: "lost" }, { id: "b", awayReason: null }] });

    // Answering the probes in between keeps a player in.
    const kept = recording();
    const steady = new RoomCore(pushing, kept.t, { now: () => now });
    steady.join(player("a"));
    steady.join(player("b"));
    for (let i = 0; i < 60; i++) {
      steady.receive("b", msg("big"));
      answerAll(steady, kept.sent, "a");
      answerAll(steady, kept.sent, "b");
    }
    expect(kept.closed).toEqual([]);
    expect(steady.players.has("a")).toBe(true);
  });

  it("reads the room's clock and a missing player's ping", () => {
    const now = 1_234_567;
    const room = new RoomCore(game(), recording().t, { now: () => now });
    expect((room as any).api.serverTimeMs()).toBe(now);
    expect((room as any).api.pingDurationMs("nobody")).toBeNull();
  });
});

describe("dropped players stay in the match", () => {
  const game = (overrides: Partial<GameServer> = {}) =>
    defineGameServer({
      maximumPlayerCount: 3,
      setup: () => ({ joined: [] as any[], left: [] as any[], away: [] as any[], back: [] as string[], score: 0 }),
      onJoin: (s, p, _room, _joinData, joinInfo) => void s.joined.push([p.id, joinInfo.isReturning]),
      onLeave: (s, p, _room, leaveInfo) => void s.left.push([p.id, leaveInfo.reason]),
      onAway: (s, p, room, reason) => void s.away.push([p.id, reason, room.awayReason(p.id)]),
      onBack: (s, p, room) => {
        s.back.push(p.id);
        room.send(p.id, { score: s.score });
      },
      onMessage: (s) => void s.score++,
      ...overrides,
    } as GameServer);
  const player = (id: string) => ({ id, name: id.toUpperCase(), kind: "guest" as const });
  const setUp = (server: GameServer = game()) => {
    const clock = { now: 1_000_000 };
    const { t, sent, closed } = transport();
    const room = new RoomCore(server, t, { now: () => clock.now });
    return { clock, room, sent, closed, api: (room as any).api };
  };
  const lastPlayers = (messages: any[] | undefined) => (messages ?? []).filter((message) => message.type === "players").at(-1);

  it("keeps a dropped player in the room as away, lost: onAway runs, onLeave doesn't, and everyone's list says so", () => {
    const { room, sent, api } = setUp();
    room.join(player("a"));
    room.join(player("b"));
    room.receive("a", msg("point"));
    room.leave("a", "lost");
    expect(api.players.map((p: any) => p.id)).toEqual(["a", "b"]);
    expect(api.awayReason("a")).toBe("lost");
    expect(api.awayReason("b")).toBeNull();
    expect(room.state.away).toEqual([["a", "lost", "lost"]]);
    expect(room.state.left).toEqual([]);
    expect(room.playingCount).toBe(1);
    expect(lastPlayers(sent.b)).toEqual({ type: "players", players: [{ id: "a", name: "A", kind: "guest", awayReason: "lost" }, { id: "b", name: "B", kind: "guest", awayReason: null }], hostPlayerId: null });
    // A second close, or the runtime's after the room acted, changes nothing.
    room.leave("a", "lost");
    expect(room.state.away).toHaveLength(1);
  });

  it("lets them carry on where they were when they're back in time: onBack, no onJoin, the state kept", () => {
    const { clock, room, sent, api } = setUp();
    room.join(player("a"));
    room.join(player("b"));
    room.receive("a", msg("point"));
    answerProbes(room, sent);
    room.leave("a", "lost");
    clock.now += 29_000;
    room.sweep();
    sent.a = [];
    expect(room.join(player("a"))).toEqual({ isAllowed: true, isRejoin: true });
    expect(room.state.back).toEqual(["a"]);
    expect(room.state.joined).toEqual([["a", false], ["b", false]]);
    expect(room.state.score).toBe(1);
    expect(api.awayReason("a")).toBeNull();
    expect(room.playingCount).toBe(2);
    // Their welcome lists them as playing, and onBack's message reaches them after it.
    expect(sent.a![0]).toMatchObject({ type: "welcome", players: [{ id: "a", awayReason: null }, { id: "b", awayReason: null }] });
    expect(sent.a!.find((message) => message.type === "message")).toEqual({ type: "message", data: { score: 1 } });
    expect(lastPlayers(sent.b).players.map((p: any) => p.awayReason)).toEqual([null, null]);
    expect(room.nextReconnectDeadlineMs()).toBeNull();
  });

  it("takes them out of the match at reconnectTimeoutSec, through a sweep or a tick, with their seat held", () => {
    const { clock, room, sent, api } = setUp();
    room.join(player("a"));
    room.join(player("b"));
    answerProbes(room, sent);
    room.leave("a", "lost");
    expect(room.nextReconnectDeadlineMs()).toBe(clock.now + 30_000);
    clock.now += 29_999;
    room.sweep();
    expect(room.state.left).toEqual([]);
    clock.now += 1;
    room.sweep();
    expect(room.state.left).toEqual([["a", "lost"]]);
    expect(api.players.map((p: any) => p.id)).toEqual(["b"]);
    expect(room.held.get("a")?.reason).toBe("lost");
    expect(room.heldSeatCount).toBe(1);
    room.join(player("a"));
    expect(room.state.joined.at(-1)).toEqual(["a", true]);

    const ticking = setUp(game({ ticksPerSec: 20, onTick: () => {}, reconnectTimeoutSec: 5 }));
    ticking.room.join(player("a"));
    ticking.room.join(player("b"));
    ticking.room.leave("a", "lost");
    ticking.clock.now += 5_000;
    ticking.room.tick(0.05);
    expect(ticking.room.state.left).toEqual([["a", "lost"]]);
  });

  it("takes a dropped player out at once with reconnectTimeoutSec 0, as before", () => {
    const { room, api } = setUp(game({ reconnectTimeoutSec: 0 }));
    room.join(player("a"));
    room.join(player("b"));
    room.leave("a", "lost");
    expect(room.state.away).toEqual([]);
    expect(room.state.left).toEqual([["a", "lost"]]);
    expect(api.players.map((p: any) => p.id)).toEqual(["b"]);
    expect(room.held.get("a")?.reason).toBe("lost");
  });

  it("checks reconnectTimeoutSec when the game server is defined", () => {
    const define = (reconnectTimeoutSec: unknown) => () => defineGameServer({ setup: () => ({}), reconnectTimeoutSec } as GameServer);
    for (const given of [-1, 301, "30"]) {
      expect(define(given)).toThrow(`reconnectTimeoutSec is ${JSON.stringify(given)}. Give seconds from 0 (leave at once) to 300, like 30. (bad_option)`);
    }
    expect(define(0)).not.toThrow();
    expect(define(300)).not.toThrow();
    expect(() => defineGameServer({ setup: () => ({}), reconnectSec: 30 } as GameServer)).toThrow("reconnectTimeoutSec");
  });

  it("hears again, as lost, from a player kept as idle whose connection then drops", () => {
    const { clock, room } = setUp();
    room.join(player("a"));
    room.join(player("b"));
    room.receive("a", JSON.stringify({ type: "idle" }));
    expect(room.nextReconnectDeadlineMs()).toBeNull();
    room.leave("a", "lost");
    expect(room.state.away).toEqual([["a", "idle", "idle"], ["a", "lost", "lost"]]);
    expect(room.nextReconnectDeadlineMs()).toBe(clock.now + 30_000);
    room.join(player("a"));
    expect(room.state.back).toEqual(["a"]);
  });

  it("hands the host on while the host reconnects, and back once they return still first", () => {
    const { room, sent } = setUp(game({ hostControlsEnabled: true }));
    room.join(player("a"));
    room.join(player("b"));
    expect(room.hostPlayerId).toBe("a");
    room.leave("a", "lost");
    expect(room.hostPlayerId).toBe("b");
    expect(lastPlayers(sent.b).hostPlayerId).toBe("b");
    room.join(player("a"));
    expect(room.hostPlayerId).toBe("a");
    expect(lastPlayers(sent.b).hostPlayerId).toBe("a");
  });

  it("counts a reconnecting player's seat toward a full room", async () => {
    const { room } = setUp(game({ maximumPlayerCount: 2 }));
    room.join(player("a"));
    room.join(player("b"));
    room.leave("a", "lost");
    expect(await room.admit(player("c"))).toEqual({ isAllowed: false, code: "full" });
    expect(await room.admit(player("a"))).toEqual({ isAllowed: true });
  });

  it("sends, counts and probes nothing for a reconnecting player, so they're never dropped as too far behind", () => {
    const { clock, room, sent, closed } = setUp(game({ ticksPerSec: 20, onTick: (_s: any, _d: any, r: any) => r.broadcast("x".repeat(100 * 1024)) }));
    room.join(player("a"));
    room.join(player("b"));
    room.leave("a", "lost");
    sent.a = [];
    const traffic = room.takeTraffic();
    for (let i = 0; i < 40; i++) {
      clock.now += 500;
      room.tick(0.05);
      answerProbes(room, { b: sent.b! });
    }
    expect(sent.a).toEqual([]);
    expect(closed).toEqual([]);
    expect(traffic.outboundMessageCount).toBeGreaterThan(0);
    expect(room.takeTraffic().outboundSizeBytes).toBeLessThan(41 * (100 * 1024 + 64));
    expect(room.state.left).toEqual([]);
  });

  it("keeps reconnecting players through a sleep, though the room wakes with only the players it has connections for", () => {
    const { clock, room } = setUp();
    room.join(player("a"));
    room.join(player("b"));
    room.leave("a", "lost");
    const saved = room.saved;
    expect(saved.reconnecting).toEqual({ a: { player: player("a"), untilMs: clock.now + 30_000 } });
    const { t } = transport();
    const woke = new RoomCore(game(), t, { state: room.state, players: [player("b")], room: saved, now: () => clock.now });
    expect((woke as any).api.awayReason("a")).toBe("lost");
    expect(woke.playingCount).toBe(1);
    expect(woke.nextReconnectDeadlineMs()).toBe(clock.now + 30_000);
    woke.join(player("a"));
    expect(woke.state.back).toEqual(["a"]);
    expect(woke.state.joined).toEqual([["a", false], ["b", false]]);

    // Woken after their time ran out: they come back to their held seat.
    const late = new RoomCore(game(), transport().t, { state: room.state, players: [player("b")], room: saved, now: () => clock.now + 31_000 });
    late.join(player("a"));
    expect(late.state.left).toEqual([["a", "lost"]]);
    expect(late.state.joined.at(-1)).toEqual(["a", true]);

    // A room that starts afresh (a ticking room's state isn't saved) doesn't keep them.
    const fresh = new RoomCore(game(), transport().t, { room: saved, now: () => clock.now });
    expect(fresh.players.size).toBe(0);
  });

  it("ends a match without trying to reach reconnecting players", () => {
    const { room, closed } = setUp();
    room.join(player("a"));
    room.join(player("b"));
    room.leave("a", "lost");
    room.end("Over");
    expect(closed).toEqual(["b"]);
    expect(room.nextReconnectDeadlineMs()).toBeNull();
  });
});

describe("A real-time room restarted with its saved state", () => {
  const player = (id: string) => ({ id, name: id.toUpperCase(), kind: "guest" as const });
  const racing = () =>
    defineGameServer({
      ticksPerSec: 20,
      setup: () => ({ laps: 0, setUp: true, restored: [] as unknown[], away: [] as string[][], back: [] as string[], left: [] as string[][] }),
      onTick: (s) => void s.laps++,
      onRestored: (s, restoreInfo, room) => void s.restored.push({ ...restoreInfo, awayReasons: room.players.map((p) => room.awayReason(p.id)) }),
      onAway: (s, p, _room, reason) => void s.away.push([p.id, reason]),
      onBack: (s, p) => void s.back.push(p.id),
      onLeave: (s, p, _room, leaveInfo) => void s.left.push([p.id, leaveInfo.reason]),
    });

  it("skips setup, runs onRestored once with the lost seconds, and keeps its players away until they reconnect", () => {
    const clock = { now: Date.parse("2026-10-21T12:00:10Z") };
    const { t } = transport();
    const saved = { laps: 412, setUp: false, restored: [], away: [], back: [], left: [] };
    const room = new RoomCore(racing(), t, {
      state: saved,
      room: { isListed: true, isOpen: true, friendJoinsEnabled: true, name: null, labels: {}, knownPlayerIds: ["a", "b"] },
      restoreInfo: restoreInfoOf(Date.parse("2026-10-21T12:00:06Z"), clock.now),
      lostPlayers: [player("a"), player("b")],
      now: () => clock.now,
    });
    expect(room.state.setUp).toBe(false);
    expect(room.state.laps).toBe(412);
    expect(room.state.restored).toEqual([{ savedAt: "2026-10-21T12:00:06.000Z", lostDurationSec: 4, savedVersionId: null, awayReasons: ["lost", "lost"] }]);
    // Then each is away as a dropped connection, with the whole reconnectTimeoutSec from now.
    expect(room.state.away).toEqual([["a", "lost"], ["b", "lost"]]);
    expect(room.playingCount).toBe(0);
    expect(room.nextReconnectDeadlineMs()).toBe(clock.now + 30_000);
    // Nobody's playing, so nothing ticks.
    room.tick(0.05);
    expect(room.state.laps).toBe(412);

    // Reconnecting is a rejoin: onBack, no onJoin, and the match carries on.
    expect(room.join(player("a"))).toEqual({ isAllowed: true, isRejoin: true });
    expect(room.state.back).toEqual(["a"]);
    room.tick(0.05);
    expect(room.state.laps).toBe(413);
    // One who isn't back in time leaves as lost.
    clock.now += 30_000;
    room.sweep();
    expect(room.state.left).toEqual([["b", "lost"]]);
    expect(room.held.get("b")?.reason).toBe("lost");
  });

  it("lets players still connected (an eviction without a restart) carry on, and runs nothing without onRestored", () => {
    const { t } = transport();
    const server = racing();
    delete server.onRestored;
    const room = new RoomCore(server, t, { state: { laps: 5, setUp: false, restored: [], away: [], back: [], left: [] }, players: [player("a")], restoreInfo: restoreInfoOf(Date.now()), lostPlayers: [player("a"), player("b")] });
    expect(room.state.away).toEqual([["b", "lost"]]);
    expect(room.playingCount).toBe(1);
    room.tick(0.05);
    expect(room.state.laps).toBe(6);
  });

  it("checks stateSaveIntervalSec when the game server is defined", () => {
    const define = (stateSaveIntervalSec: unknown) => () => defineGameServer({ ticksPerSec: 20, setup: () => ({}), stateSaveIntervalSec } as GameServer);
    for (const given of [0, 61, "5"]) {
      expect(define(given)).toThrow(`stateSaveIntervalSec is ${JSON.stringify(given)}. Give a number of seconds from 1 to 60, like 5, or leave it out for 5. (bad_option)`);
    }
    expect(define(1)).not.toThrow();
    expect(define(60)).not.toThrow();
    expect(() => defineGameServer({ setup: () => ({}), onRestored: 1 } as never)).toThrow("onRestored isn't a function.");
  });
});

describe("A match moving to a version published now", () => {
  it("tells every player it's coming, runs onVersionUpdate when held, and switches through the transport when the game server says", async () => {
    const { t, sent } = transport();
    let switchCount = 0;
    const heard: unknown[] = [];
    const room = new RoomCore(
      defineGameServer({ setup: () => ({}), onVersionUpdate: (_state, versionUpdate) => void heard.push(versionUpdate), onMessage: (_state, _player, message, api) => (message === "round over" ? api.applyVersionUpdate() : undefined) }),
      { ...t, applyVersionUpdate: () => switchCount++ },
    );
    room.join({ id: "a", name: "A", kind: "guest" });
    // Nothing coming: applyVersionUpdate does nothing.
    room.receive("a", msg("round over"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(switchCount).toBe(0);
    room.startVersionUpdate({ versionId: "version_two", appliesAt: "2026-10-21T12:05:00.000Z", isReloading: true }, true);
    expect(sent.a!.at(-1)).toEqual({ type: "versionUpdate", step: "coming", versionId: "version_two", appliesAt: "2026-10-21T12:05:00.000Z", isReloading: true });
    expect(heard).toEqual([{ versionId: "version_two", forcedAt: "2026-10-21T12:05:00.000Z" }]);
    room.receive("a", msg("round over"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(switchCount).toBe(1);
    room.tellVersionUpdateNow();
    expect(sent.a!.at(-1)).toMatchObject({ type: "versionUpdate", step: "now", versionId: "version_two" });
  });

  it("doesn't run onVersionUpdate when the room doesn't hold for it, and does nothing on a transport without updates", () => {
    const { t, sent } = transport();
    const heard: unknown[] = [];
    const room = new RoomCore(defineGameServer({ setup: () => ({}), onVersionUpdate: (_state, versionUpdate) => void heard.push(versionUpdate) }), t);
    room.join({ id: "a", name: "A", kind: "guest" });
    room.startVersionUpdate({ versionId: "version_two", appliesAt: "2026-10-21T12:00:10.000Z", isReloading: false }, false);
    expect(heard).toEqual([]);
    expect(sent.a!.at(-1)).toMatchObject({ type: "versionUpdate", step: "coming" });
    expect(() => defineGameServer({ setup: () => ({}), onVersionUpdate: "soon" } as never)).toThrow("onVersionUpdate isn't a function.");
  });
});

describe("spectators", () => {
  const PLAYER_A = { id: "a", name: "A", kind: "guest" as const };
  const PLAYER_B = { id: "b", name: "B", kind: "guest" as const };
  const WATCHER = { id: "w", name: "W", kind: "account" as const };
  const arena = (overrides: Partial<GameServer> = {}) =>
    defineGameServer({
      maximumPlayerCount: 2,
      maximumSpectatorCount: 3,
      setup: () => ({ watched: [] as string[], left: [] as string[], asked: [] as boolean[] }),
      onSpectatorJoin: (s, spectator) => void s.watched.push(spectator.id),
      onSpectatorLeave: (s, spectator) => void s.left.push(spectator.id),
      onMessage(_s, _p, message, room) {
        if (message === "all") room.broadcast({ to: "everyone" });
        if (message === "players") room.broadcast({ to: "players" }, { audience: "players" });
        if (message === "spectators") room.broadcast({ to: "spectators" }, { audience: "spectators" });
        if (message === "bytes") room.broadcastBytes(new Uint8Array([7]), { audience: "spectators" });
        if (message === "one") room.send("w", { to: "w" });
        if (message === "kick") room.kick("w", { keepOut: true });
      },
      ...overrides,
    });

  it("checks maximumSpectatorCount: a whole number from 0 to 100", () => {
    for (const given of [-1, 101, 2.5, "20"]) {
      expect(() => defineGameServer({ maximumSpectatorCount: given as never, setup: () => ({}) })).toThrow(GameServerError);
    }
    expect(() => defineGameServer({ maximumSpectatorCount: 100, setup: () => ({}) })).not.toThrow();
    let refusal: unknown;
    try {
      defineGameServer({ maximumSpectatorCount: 101, setup: () => ({}) });
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toMatchObject({ code: "bad_option", field: "maximumSpectatorCount", fix: "Give a whole number from 0 to 100, like 20, or leave it out so nobody watches." });
  });

  it("lets a spectator watch a full, closed room without counting as playing", () => {
    const { t, sent } = transport();
    const room = new RoomCore(arena(), t);
    room.join(PLAYER_A);
    room.join(PLAYER_B);
    expect(room.join({ id: "c", name: "C", kind: "guest" })).toMatchObject({ isAllowed: false, code: "full" });
    expect(room.join(WATCHER, { isSpectator: true })).toEqual({ isAllowed: true, isRejoin: false });
    expect(sent.w![0]).toMatchObject({ type: "welcome", isSpectator: true, spectatorCount: 1, players: [{ id: "a" }, { id: "b" }], awayChecks: { idleTimeoutSec: null, hiddenTimeoutSec: null } });
    expect(room.playingCount).toBe(2);
    expect(room.spectatorCount).toBe(1);
    expect([...room.players.keys()]).toEqual(["a", "b"]);
    expect(room.state.watched).toEqual(["w"]);
    // Everyone hears how many watch.
    expect(sent.a!.at(-1)).toMatchObject({ type: "room", spectatorCount: 1 });
  });

  it("sends spectators what goes to everyone or to them, never what goes only to players", () => {
    const { t, sent, frames } = transport();
    const room = new RoomCore(arena(), t);
    room.join(PLAYER_A);
    room.join(WATCHER, { isSpectator: true });
    const heard = () => sent.w!.filter((message) => message.type === "message").map((message) => message.data);
    room.receive("a", msg("all"));
    room.receive("a", msg("players"));
    room.receive("a", msg("spectators"));
    room.receive("a", msg("one"));
    expect(heard()).toEqual([{ to: "everyone" }, { to: "spectators" }, { to: "w" }]);
    expect(sent.a!.filter((message) => message.type === "message").map((message) => message.data)).toEqual([{ to: "everyone" }, { to: "players" }]);
    room.receive("a", msg("bytes"));
    expect(frames.w).toHaveLength(1);
    expect(frames.a).toBeUndefined();
  });

  it("refuses an audience it doesn't know, as a mistake in the game's call", () => {
    const { t } = transport();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const room = new RoomCore(arena({ onMessage: (_s, _p, _message, room) => room.broadcast("x", { audience: "crowd" as never }) }), t);
    room.join(PLAYER_A);
    room.receive("a", msg("go"));
    expect(String(errors.mock.calls.at(-1)?.[1])).toContain('Give "everyone", "players" or "spectators"');
    errors.mockRestore();
  });

  it("refuses anything a spectator sends but probe answers, and keeps it off the room's message count", () => {
    const { t, sent } = transport();
    const room = new RoomCore(arena(), t);
    room.join(PLAYER_A);
    room.join(WATCHER, { isSpectator: true });
    const messageCount = room.messageCount;
    expect(room.receive("w", msg("all"))).toBe("spectator_cannot_send");
    expect(room.receive("w", JSON.stringify({ type: "here" }))).toBe("spectator_cannot_send");
    expect(room.receiveBytes("w", new Uint8Array([1]))).toBe("spectator_cannot_send");
    const probe = sent.w!.find((message) => message.type === "probe");
    expect(room.receive("w", JSON.stringify({ type: "probe_answer", probeNumber: probe.probeNumber }))).toBeNull();
    expect(room.messageCount).toBe(messageCount);
    expect(sent.a!.filter((message) => message.type === "message")).toEqual([]);
    // Limited like anyone's messages.
    let lastCode: string | null = null;
    for (let i = 0; i < ROOM_LIMITS.gameMessageBurstCount + 5; i++) lastCode = room.receive("w", msg("x"));
    expect(lastCode).toBe("too_fast");
  });

  it("turns away the spectator past maximumSpectatorCount with watching_full, and nobody where it's 0", async () => {
    const { t } = transport();
    const room = new RoomCore(arena(), t);
    room.join(PLAYER_A);
    for (const id of ["w1", "w2", "w3"]) expect(room.join({ id, name: id, kind: "guest" }, { isSpectator: true }).isAllowed).toBe(true);
    expect(await room.admit({ id: "w4", name: "w4", kind: "guest" }, null, { isSpectator: true })).toEqual({ isAllowed: false, code: "watching_full" });
    expect(room.join({ id: "w4", name: "w4", kind: "guest" }, { isSpectator: true })).toMatchObject({ isAllowed: false, code: "watching_full" });
    // A spectator reconnecting keeps their place.
    expect(room.join({ id: "w1", name: "w1", kind: "guest" }, { isSpectator: true })).toEqual({ isAllowed: true, isRejoin: true });

    const off = new RoomCore(arena({ maximumSpectatorCount: undefined }), transport().t);
    off.join(PLAYER_A);
    expect(await off.admit(WATCHER, null, { isSpectator: true })).toEqual({ isAllowed: false, code: "watching_full" });
  });

  it("asks canJoin with joinInfo.isSpectator, and lets a closed room be watched", async () => {
    const asked: boolean[] = [];
    const room = new RoomCore(
      arena({
        canJoin: (_s, player, _room, _joinData, joinInfo) => {
          asked.push(joinInfo.isSpectator);
          return player.id !== "nope" || { refusalMessage: "No watching for you." };
        },
      }),
      transport().t,
    );
    expect(await room.admit(PLAYER_A)).toEqual({ isAllowed: true });
    room.join(PLAYER_A);
    room.join(PLAYER_B);
    room.isOpen = false;
    expect(await room.admit(WATCHER, null, { isSpectator: true })).toEqual({ isAllowed: true });
    expect(await room.admit({ id: "nope", name: "N", kind: "guest" }, null, { isSpectator: true })).toEqual({ isAllowed: false, code: "refused", message: "No watching for you." });
    expect(asked).toEqual([false, true, true]);
  });

  it("keeps a player in the match from watching it too, and a spectator who joins the match stops watching", async () => {
    const { t } = transport();
    const room = new RoomCore(arena(), t);
    room.join(PLAYER_A);
    expect(await room.admit(PLAYER_A, null, { isSpectator: true })).toMatchObject({ isAllowed: false, code: "bad_message" });
    room.join(WATCHER, { isSpectator: true });
    expect(room.join(WATCHER).isAllowed).toBe(true);
    expect(room.spectatorCount).toBe(0);
    expect(room.players.has("w")).toBe(true);
    expect(room.state.left).toEqual(["w"]);
  });

  it("lets a spectator go with onSpectatorLeave, holding no seat, and kicks one with keepOut", async () => {
    const { t, sent, closed } = transport();
    const room = new RoomCore(arena(), t);
    room.join(PLAYER_A);
    room.join(WATCHER, { isSpectator: true });
    room.leave("w", "lost");
    expect(room.state.left).toEqual(["w"]);
    expect(room.heldSeatCount).toBe(0);
    expect(room.spectatorCount).toBe(0);
    expect(sent.a!.at(-1)).toMatchObject({ type: "room", spectatorCount: 0 });

    room.join(WATCHER, { isSpectator: true });
    room.receive("a", msg("kick"));
    expect(sent.w!.at(-1)).toMatchObject({ type: "kicked", isKeptOut: true });
    expect(closed).toContain("w");
    expect(room.state.left).toEqual(["w", "w"]);
    expect(await room.admit(WATCHER, null, { isSpectator: true })).toMatchObject({ isAllowed: false, code: "kept_out" });
  });

  it("never walks a spectator away, and tells them when the match ends", () => {
    let nowMs = 1_000_000;
    const { t, sent, closed } = transport();
    const room = new RoomCore(arena({ idleTimeoutSec: 30 }), t, { now: () => nowMs });
    room.join(PLAYER_A);
    room.join(WATCHER, { isSpectator: true });
    answerProbes(room, sent);
    nowMs += 3600_000;
    room.receive("a", JSON.stringify({ type: "here" }));
    answerProbes(room, sent);
    room.sweep();
    expect(room.spectatorCount).toBe(1);
    expect(sent.w!.some((message) => message.type === "away")).toBe(false);
    room.end("Game over");
    expect(sent.w!.at(-1)).toEqual({ type: "ended", message: "Game over" });
    expect(closed).toContain("w");
    expect(room.spectatorCount).toBe(0);
  });
});

describe("state sync", () => {
  const player = (id: string) => ({ id, name: id.toUpperCase(), kind: "guest" as const });
  /** A transport whose players are backed up when the test says, as bufferedAmount says on your own server. */
  const recording = () => {
    const sent: Record<string, any[]> = {};
    const backedUp = new Set<string>();
    const t: Transport = {
      send: (id, text) => (sent[id] ??= []).push(JSON.parse(text)),
      sendBytes: (id, frame) => (sent[id] ??= []).push({ type: "bytes", bytes: [...frame.subarray(1)] }),
      close: () => {},
      isBackedUp: (id) => backedUp.has(id),
    };
    return { t, sent, backedUp, states: (id: string) => (sent[id] ?? []).filter((message) => message.type === "state").map(({ serverTimeMs, ...frame }) => frame) };
  };
  /** A turn-based card game: each player sees their own hand and how many cards the others hold. */
  const cards = defineGameServer({
    stateSyncEnabled: true,
    setup: () => ({ turn: 0, hands: {} as Record<string, string[]> }),
    onJoin: (s, p) => void (s.hands[p.id] = ["A", "K"]),
    onMessage(s, p, message) {
      if (message === "draw") s.hands[p.id]!.push("Q");
      if (message === "pass") s.turn++;
    },
    stateView: (s, viewer) => ({ turn: s.turn, myHand: s.hands[viewer.id] ?? [], cardCounts: Object.fromEntries(Object.entries(s.hands).map(([id, hand]) => [id, hand.length])) }),
  });

  it("sends a joining player a full copy, then only what changed, each their own view", () => {
    const { t, states } = recording();
    const room = new RoomCore(cards, t);
    room.join(player("ana"));
    expect(states("ana")).toEqual([{ type: "state", full: { turn: 0, myHand: ["A", "K"], cardCounts: { ana: 2 } } }]);
    room.join(player("bo"));
    expect(states("bo")).toEqual([{ type: "state", full: { turn: 0, myHand: ["A", "K"], cardCounts: { ana: 2, bo: 2 } } }]);
    expect(states("ana").at(-1)).toEqual({ type: "state", changes: [[["cardCounts", "bo"], 2]] });
    room.receive("bo", msg("draw"));
    // Ana never sees Bo's cards, only how many he has.
    expect(states("ana").at(-1)).toEqual({ type: "state", changes: [[["cardCounts", "bo"], 3]] });
    expect(states("bo").at(-1)).toEqual({ type: "state", changes: [[["myHand"], ["A", "K", "Q"]], [["cardCounts", "bo"], 3]] });
    // A handler that changes nothing anyone sees sends nothing.
    const sentCount = states("ana").length;
    room.receive("ana", msg("nothing"));
    expect(states("ana")).toHaveLength(sentCount);
  });

  it("sends a spectator the state too: a full copy as they come to watch, their own view, then what changed", () => {
    const { t, states } = recording();
    const room = new RoomCore(defineGameServer({ ...cards, maximumSpectatorCount: 5 }), t);
    room.join(player("ana"));
    room.join(player("wes"), { isSpectator: true });
    // A spectator holds no hand, so their view has none.
    expect(states("wes")).toEqual([{ type: "state", full: { turn: 0, myHand: [], cardCounts: { ana: 2 } } }]);
    room.receive("ana", msg("pass"));
    expect(states("wes").at(-1)).toEqual({ type: "state", changes: [[["turn"], 1]] });
  });

  it("sends a ticking room's changes after each tick, with the room's clock, and a reconnecting player a full copy", () => {
    let now = 1_000_000;
    const { t, sent, states } = recording();
    const racing = defineGameServer({ stateSyncEnabled: true, ticksPerSec: 20, setup: () => ({ x: 0 }), onTick: (s) => void s.x++ });
    const room = new RoomCore(racing, t, { now: () => now });
    room.join(player("ana"));
    expect(states("ana")).toEqual([]);
    room.tick(0.05);
    expect(sent.ana!.filter((message) => message.type === "state")).toEqual([{ type: "state", serverTimeMs: now, full: { x: 1 } }]);
    now += 50;
    room.tick(0.05);
    expect(sent.ana!.at(-1)).toEqual({ type: "state", serverTimeMs: now, changes: [[["x"], 2]] });
    room.leave("ana", "lost");
    room.tick(0.05);
    expect(states("ana")).toHaveLength(2);
    room.join(player("ana"));
    room.tick(0.05);
    // Nobody played meanwhile, so the room didn't tick: her new connection gets the next state in full.
    expect(states("ana").at(-1)).toEqual({ type: "state", full: { x: 3 } });
    // Without onTick, every tick still has its round.
    const still = recording();
    const quiet = new RoomCore(defineGameServer({ stateSyncEnabled: true, ticksPerSec: 20, setup: () => ({ x: 7 }) }), still.t);
    quiet.join(player("ana"));
    quiet.tick(0.05);
    expect(still.states("ana")).toEqual([{ type: "state", full: { x: 7 } }]);
  });

  it("skips a backed-up player, then sends them a full copy once they catch up", () => {
    const { t, states, backedUp } = recording();
    const racing = defineGameServer({ stateSyncEnabled: true, ticksPerSec: 20, setup: () => ({ x: 0 }), onTick: (s) => void s.x++ });
    const room = new RoomCore(racing, t);
    room.join(player("ana"));
    room.join(player("bo"));
    room.tick(0.05);
    backedUp.add("ana");
    room.tick(0.05);
    room.tick(0.05);
    expect(states("ana")).toEqual([{ type: "state", full: { x: 1 } }]);
    expect(states("bo").at(-1)).toEqual({ type: "state", changes: [[["x"], 3]] });
    backedUp.delete("ana");
    room.tick(0.05);
    expect(states("ana").at(-1)).toEqual({ type: "state", full: { x: 4 } });

    // A turn-based room has no tick: the copy goes as soon as they've caught up.
    const turns = recording();
    const cardRoom = new RoomCore(cards, turns.t);
    cardRoom.join(player("ana"));
    turns.backedUp.add("ana");
    cardRoom.join(player("bo"));
    expect(turns.states("ana")).toHaveLength(1);
    expect(cardRoom.isCatchingUp).toBe(true);
    cardRoom.catchUp();
    expect(turns.states("ana")).toHaveLength(1);
    turns.backedUp.delete("ana");
    cardRoom.catchUp();
    expect(turns.states("ana").at(-1)).toEqual({ type: "state", full: { turn: 0, myHand: ["A", "K"], cardCounts: { ana: 2, bo: 2 } } });
    expect(cardRoom.isCatchingUp).toBe(false);
  });

  it("in Zaisma rooms, counts a player backed up when a probe is late past their ping with 64 KB sent since their last answer", () => {
    let now = 1_000_000;
    const big = "x".repeat(40 * 1024);
    const pushing = defineGameServer({ setup: () => ({}), onMessage: (_s, _p, message, room) => room.broadcast(message === "big" ? big : message) });
    const sent: Record<string, any[]> = {};
    const room = new RoomCore(pushing, { send: (id, text) => (sent[id] ??= []).push(JSON.parse(text)), close: () => {} }, { now: () => now });
    room.join(player("ana"));
    room.join(player("bo"));
    const answerAll = (id: string) => {
      for (const probe of sent[id]!.filter((message) => message.type === "probe" && !message.isAnswered)) {
        probe.isAnswered = true;
        room.receive(id, JSON.stringify({ type: "probe_answer", probeNumber: probe.probeNumber }));
      }
    };
    now += 40;
    answerAll("ana");
    answerAll("ana");
    expect(room.isBackedUp("ana")).toBe(false);
    // A probe goes out, then 80 KB: late, but not yet past her 40 ms ping and 250 ms.
    room.receive("bo", msg("big"));
    room.receive("bo", msg("big"));
    (room as any).probe("ana");
    now += 200;
    expect(room.isBackedUp("ana")).toBe(false);
    now += 100;
    expect(room.isBackedUp("ana")).toBe(true);
    answerAll("ana");
    expect(room.isBackedUp("ana")).toBe(false);
    // Late with little sent: a slow answer on a quiet connection isn't a backlog.
    const quiet = new RoomCore(pushing, { send: () => {}, close: () => {} }, { now: () => now });
    quiet.join(player("cy"));
    now += 2000;
    expect(quiet.isBackedUp("cy")).toBe(false);
  });

  it("doesn't send a view over maximumStateViewSizeBytes, and tells the game's errors once", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { t, states } = recording();
      const huge = defineGameServer({ stateSyncEnabled: true, setup: () => ({ map: "x".repeat(ROOM_LIMITS.maximumStateViewSizeBytes) }), onMessage: () => {} });
      const room = new RoomCore(huge, t);
      room.join(player("ana"));
      room.receive("ana", msg("again"));
      expect(states("ana")).toEqual([]);
      expect(errors.mock.calls.filter(([line]) => String(line).includes("over the 1024 KB a player can be sent"))).toHaveLength(1);
    } finally {
      errors.mockRestore();
    }
  });

  it("checks the options", () => {
    expect(() => defineGameServer({ stateSyncEnabled: "yes" as never, setup: () => ({}) })).toThrow(expect.objectContaining({ code: "bad_option", field: "stateSyncEnabled" }));
    expect(() => defineGameServer({ stateView: () => ({}), setup: () => ({}) })).toThrow(expect.objectContaining({ code: "bad_option", field: "stateView" }));
    expect(() => defineGameServer({ stateSyncEnabled: true, stateView: {} as never, setup: () => ({}) })).toThrow(expect.objectContaining({ code: "bad_option", field: "stateView" }));
  });
});

describe("latest-only messages", () => {
  const player = (id: string) => ({ id, name: id.toUpperCase(), kind: "guest" as const });
  const recording = () => {
    const sent: Record<string, any[]> = {};
    const backedUp = new Set<string>();
    const t: Transport = {
      send: (id, text) => (sent[id] ??= []).push(JSON.parse(text)),
      sendBytes: (id, frame) => (sent[id] ??= []).push({ type: "bytes", bytes: [...frame.subarray(1)] }),
      close: () => {},
      isBackedUp: (id) => backedUp.has(id),
    };
    return { t, sent, backedUp, game: (id: string) => (sent[id] ?? []).filter((message) => message.type === "message" || message.type === "bytes").map((message) => message.data ?? message.bytes) };
  };
  /** Whatever a player's message says to send, the game server sends: { send, options }. */
  const echo = defineGameServer({
    setup: () => ({}),
    onMessage(_s, _p, message: any, room) {
      if (message.bytes) room.broadcastBytes(new Uint8Array(message.bytes), message.options);
      else if (message.to) room.send(message.to, message.send, message.options);
      else room.broadcast(message.send, message.options);
    },
  });

  it("skips older latest-only messages for a backed-up player, keeps reliable ones, and sends the newest once they catch up", () => {
    const { t, backedUp, game } = recording();
    const room = new RoomCore(echo, t);
    room.join(player("ana"));
    room.join(player("bo"));
    backedUp.add("ana");
    for (const x of [1, 2, 3]) room.receive("bo", msg({ send: { type: "position", x }, options: { delivery: "latest_only" } }));
    room.receive("bo", msg({ send: { type: "chat", text: "hi" } }));
    room.receive("bo", msg({ send: { type: "aim", angle: 9 }, options: { delivery: "latest_only", latestKey: "aim" } }));
    room.receive("bo", msg({ bytes: [7], options: { delivery: "latest_only" } }));
    room.receive("bo", msg({ bytes: [8], options: { delivery: "latest_only" } }));
    // The reliable one went at once; the latest-only ones wait.
    expect(game("ana")).toEqual([{ type: "chat", text: "hi" }]);
    // Bo isn't backed up: he gets every one.
    expect(game("bo").filter((data: any) => data.type === "position")).toHaveLength(3);
    room.catchUp();
    expect(game("ana")).toHaveLength(1);
    backedUp.delete("ana");
    room.catchUp();
    expect(game("ana")).toEqual([{ type: "chat", text: "hi" }, { type: "position", x: 3 }, { type: "aim", angle: 9 }, [8]]);
    expect(room.isCatchingUp).toBe(false);
  });

  it("sends what waited before a newer latest-only message once a player is no longer backed up", () => {
    const { t, backedUp, game } = recording();
    const room = new RoomCore(echo, t);
    room.join(player("ana"));
    backedUp.add("ana");
    room.receive("ana", msg({ to: "ana", send: { type: "position", x: 1 }, options: { delivery: "latest_only" } }));
    room.receive("ana", msg({ to: "ana", send: { type: "score", points: 5 }, options: { delivery: "latest_only" } }));
    backedUp.delete("ana");
    room.receive("ana", msg({ to: "ana", send: { type: "position", x: 2 }, options: { delivery: "latest_only" } }));
    expect(game("ana")).toEqual([{ type: "position", x: 1 }, { type: "score", points: 5 }, { type: "position", x: 2 }]);
  });

  it("keeps up to 64 slots a player: the 65th key replaces the least recently replaced", () => {
    const { t, backedUp, game } = recording();
    const room = new RoomCore(echo, t);
    room.join(player("ana"));
    backedUp.add("ana");
    const api = (room as any).api;
    for (let i = 0; i <= ROOM_LIMITS.maximumLatestOnlySlotCount; i++) api.send("ana", { key: i }, { delivery: "latest_only", latestKey: `k${i}` });
    backedUp.delete("ana");
    room.catchUp();
    const got = game("ana");
    expect(got).toHaveLength(ROOM_LIMITS.maximumLatestOnlySlotCount);
    expect(got[0]).toEqual({ key: 1 });
    expect(got.at(-1)).toEqual({ key: ROOM_LIMITS.maximumLatestOnlySlotCount });
  });

  it("refuses a delivery or latestKey it doesn't take, saying what to give", () => {
    const room = new RoomCore(echo, recording().t);
    room.join(player("ana"));
    const api = (room as any).api;
    expect(() => api.broadcast({}, { delivery: "lossy" })).toThrow('room.broadcast\'s delivery is "lossy". Give "reliable" (the default) or "latest_only".');
    expect(() => api.send("ana", {}, { latestKey: "x".repeat(41) })).toThrow("room.send's latestKey must be text up to 40 characters");
    expect(() => api.send("ana", {}, { priority: 1 })).toThrow("room.send doesn't take priority. It takes: delivery, latestKey.");
    expect(() => api.sendBytes("ana", new Uint8Array([1]), { delivery: 1 })).toThrow("room.sendBytes's delivery is 1.");
  });

  it("counts reliable messages that went to a backed-up player, for get_stats' hint", () => {
    const { t, backedUp } = recording();
    const room = new RoomCore(echo, t);
    room.join(player("ana"));
    room.join(player("bo"));
    backedUp.add("ana");
    room.receive("bo", msg({ send: { type: "position", x: 1 } }));
    room.receive("bo", msg({ send: { type: "position", x: 2 }, options: { delivery: "latest_only" } }));
    expect(room.takeTraffic().messageTypes.find((type) => type.direction === "outbound" && type.messageType === "position")).toMatchObject({ messageCount: 3, backedUpMessageCount: 1 });
  });
});

describe("Kept rooms", () => {
  it("tells the game server its room's code, or null where the transport has none", () => {
    const seen: (string | null)[] = [];
    const server = defineGameServer({ setup: () => ({}), onJoin: (_state, _player, room) => void seen.push(room.roomCode) });
    new RoomCore(server, { ...transport().t, roomCode: "WRLD22" }).join({ id: "a", name: "A", kind: "guest" });
    new RoomCore(server, transport().t).join({ id: "b", name: "B", kind: "guest" });
    expect(seen).toEqual(["WRLD22", null]);
  });

  it("keeps a room through room.setKept, tells the transport through listingChanged once, and does nothing after the end", () => {
    const room = new RoomCore(counter, transport().t);
    room.join({ id: "a", name: "A", kind: "guest" });
    const api = (room as any).api;
    expect(api.isKept).toBe(false);
    room.listingChanged = false;
    room.dirty = false;
    api.setKept(true);
    expect(api.isKept).toBe(true);
    expect(room.isKept).toBe(true);
    expect(room.listingChanged).toBe(true);
    expect(room.dirty).toBe(true);
    // The same again changes nothing.
    room.listingChanged = false;
    room.dirty = false;
    api.setKept(true);
    expect(room.listingChanged).toBe(false);
    expect(room.dirty).toBe(false);
    // And back to an ordinary room.
    api.setKept(false);
    expect(api.isKept).toBe(false);
    expect(room.listingChanged).toBe(true);

    // An ended room stays as it was.
    room.receive("a", msg("end"));
    expect(room.ended).toBe(true);
    room.listingChanged = false;
    api.setKept(true);
    expect(api.isKept).toBe(false);
    expect(room.listingChanged).toBe(false);
  });

  it("saves isKept with the room, so a kept room wakes kept and an ordinary one doesn't", () => {
    const room = new RoomCore(counter, transport().t);
    room.join({ id: "a", name: "A", kind: "guest" });
    expect(room.saved.isKept).toBeUndefined();
    expect(new RoomCore(counter, transport().t, { state: room.state, room: room.saved }).isKept).toBe(false);
    (room as any).api.setKept(true);
    expect(room.saved.isKept).toBe(true);
    const woken = new RoomCore(counter, transport().t, { state: room.state, room: room.saved });
    expect(woken.isKept).toBe(true);
    expect((woken as any).api.isKept).toBe(true);
  });

  it("reserves a kept room only when room.reserve asks for one", () => {
    const reserved: RoomStart[] = [];
    const lobby = new RoomCore(counter, { ...transport().t, reserve: (_code, start) => void reserved.push(start) });
    lobby.join({ id: "a", name: "A", kind: "guest" });
    (lobby as any).api.reserve({ playerIds: ["a"], isKept: true });
    (lobby as any).api.reserve({ playerIds: ["a"] });
    expect(reserved[0]!.isKept).toBe(true);
    expect("isKept" in reserved[1]!).toBe(false);
    expect(new RoomCore(counter, transport().t, { start: reserved[0]! }).isKept).toBe(true);
    expect(new RoomCore(counter, transport().t, { start: reserved[1]! }).isKept).toBe(false);
  });

  it("gives a room saved as it emptied lostDurationSec 0, however long it slept", () => {
    const nowMs = Date.parse("2026-10-21T12:00:00Z");
    const weekAgoMs = nowMs - 7 * 24 * 3600 * 1000;
    expect(restoreInfoOf(weekAgoMs, nowMs, "version_one", true)).toEqual({ savedAt: "2026-10-14T12:00:00.000Z", lostDurationSec: 0, savedVersionId: "version_one" });
    expect(restoreInfoOf(weekAgoMs, nowMs, "version_one")).toEqual({ savedAt: "2026-10-14T12:00:00.000Z", lostDurationSec: 7 * 24 * 3600, savedVersionId: "version_one" });
    expect(restoreInfoOf(weekAgoMs, nowMs, null, false).lostDurationSec).toBe(7 * 24 * 3600);
  });
});
