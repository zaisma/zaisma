import { afterAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startServer } from "../../packages/game-server/bin/node.js";
import { RoomCore, defineGameServer, generateSigningKey, loadSigningKey, signPass, type GameServer, type RoomMessage, type RoomReach } from "../../packages/game-server/src/internal.ts";

// A game reaching its own live rooms (docs/DEVELOPER-API.md, "Reaching live rooms"): the room's calls and handler
// in RoomCore, and the same calls among the Node runner's own rooms. Zaisma's rooms: test/rooms/room-messages.test.ts.

const ISS = "https://rooms.zaisma.test";
const ORIGIN = "https://worlds.zaismausercontent.com";
const signing = await loadSigningKey(await generateSigningKey());

/** Worlds that tell each other things, and a server outside rooms that reaches them. */
const WORLDS = {
  maximumPlayerCount: 4,
  setup: () => ({}),
  async onMessage(state: unknown, player: { id: string; name: string }, room: any, message: any) {
    if (message.kind === "tell") room.send(player.id, { told: await room.sendToRoom(message.toRoomCode, { kind: "party", from: player.name }) });
    if (message.kind === "everyone") room.send(player.id, { everyone: await room.sendToEveryRoom({ kind: "news" }) });
    if (message.kind === "list") room.send(player.id, { listed: (await room.listRooms()).rooms.map((listed: { roomCode: string }) => listed.roomCode).sort() });
  },
  onRoomMessage(state: unknown, roomMessage: RoomMessage, room: any) {
    room.broadcast({ heard: roomMessage });
  },
  async onRequest(player: unknown, request: any, server: any) {
    if (request.kind === "room") return server.getRoom(request.roomCode);
    if (request.kind === "end") return server.endRoom(request.roomCode, "Closed by the moderators.");
    if (request.kind === "kick") return server.kickFromRoom(request.roomCode, request.playerId, { message: "Removed for griefing." });
    return server.sendToEveryRoom({ kind: "from_server" });
  },
} satisfies GameServer;

const running = startServer({ gameServer: WORLDS, gameSlug: "worlds", port: 0, origins: [ORIGIN], issuerUrl: ISS, loadPassKeys: async () => [signing.publicKey], roomStateFile: null });
await new Promise((resolve) => running.httpServer.once("listening", resolve));
const port = (running.httpServer.address() as { port: number }).port;
afterAll(() => running.close());

async function pass(sub: string) {
  const nowSec = Math.floor(Date.now() / 1000);
  return signPass(signing, { sub, name: sub.toUpperCase(), aud: "worlds", iss: ISS, pass_version_number: 1, kind: "guest", iat: nowSec, exp: nowSec + 60 });
}

/** A player in a room of the runner, with the messages the game sends them. */
async function join(sub: string, roomCode: string) {
  const ws = new WebSocket(`ws://localhost:${port}/v1/rooms/worlds/${roomCode}`, { origin: ORIGIN });
  const inbox: any[] = [];
  const waiters: ((message: any) => void)[] = [];
  ws.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === "probe") return ws.send(JSON.stringify({ type: "probe_answer", probeNumber: message.probeNumber }));
    const waiter = waiters.shift();
    waiter ? waiter(message) : inbox.push(message);
  });
  const next = () => (inbox.length ? Promise.resolve(inbox.shift()) : new Promise<any>((resolve) => waiters.push(resolve)));
  const until = async (type: string) => {
    for (;;) {
      const message = await next();
      if (message.type === type) return message;
    }
  };
  await new Promise((resolve) => ws.on("open", resolve));
  ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass: await pass(sub) }));
  await until("welcome");
  return { ws, until, say: (data: unknown) => ws.send(JSON.stringify({ type: "message", data })), fromGame: async () => (await until("message")).data };
}

async function request(sub: string, asked: unknown) {
  const response = await fetch(`http://localhost:${port}/v1/requests/worlds`, { method: "POST", headers: { origin: ORIGIN, "content-type": "text/plain" }, body: JSON.stringify({ pass: await pass(sub), request: asked }) });
  return ((await response.json()) as { answer: any }).answer;
}

describe("room messages on the Node runner, among its own rooms", () => {
  it("reach another room's onRoomMessage with who sent them, never back to the sender, and list the rooms", async () => {
    const ana = await join("ana", "AAAAAA");
    const ben = await join("ben", "BBBBBB");
    ana.say({ kind: "tell", toRoomCode: "BBBBBB" });
    expect(await ben.fromGame()).toEqual({ heard: { message: { kind: "party", from: "ANA" }, senderKind: "room", fromRoomCode: "AAAAAA", sentAt: expect.any(String) } });
    expect(await ana.fromGame()).toEqual({ told: { isDelivered: true } });
    ana.say({ kind: "tell", toRoomCode: "CCCCCC" });
    expect(await ana.fromGame()).toEqual({ told: { isDelivered: false } });
    ana.say({ kind: "everyone" });
    expect(await ben.fromGame()).toMatchObject({ heard: { message: { kind: "news" }, senderKind: "room", fromRoomCode: "AAAAAA" } });
    expect(await ana.fromGame()).toEqual({ everyone: { roomCount: 1 } });
    ana.say({ kind: "list" });
    expect(await ana.fromGame()).toEqual({ listed: ["AAAAAA", "BBBBBB"] });

    // The server outside rooms: who's in one, a send to every room, a kick and an end.
    const room = await request("moderator", { kind: "room", roomCode: "BBBBBB" });
    expect(room.room).toMatchObject({ roomCode: "BBBBBB", playerCount: 1, isKept: false, versionId: null, continent: null });
    expect(room.players).toEqual([{ playerId: "ben", name: "BEN", kind: "guest", isAway: false, awayReason: null, joinedAt: expect.any(String), isSpectator: false }]);
    expect(await request("moderator", { kind: "room", roomCode: "ZZZZZZ" })).toBeNull();
    expect(await request("moderator", { kind: "everyone" })).toEqual({ roomCount: 2 });
    expect(await ana.fromGame()).toMatchObject({ heard: { message: { kind: "from_server" }, senderKind: "server", fromRoomCode: null } });
    expect(await request("moderator", { kind: "kick", roomCode: "AAAAAA", playerId: "nobody" })).toEqual({ isDone: false });
    expect(await request("moderator", { kind: "kick", roomCode: "AAAAAA", playerId: "ana" })).toEqual({ isDone: true });
    expect(await ana.until("kicked")).toEqual({ type: "kicked", message: "Removed for griefing.", isKeptOut: false });
    expect(await request("moderator", { kind: "end", roomCode: "BBBBBB" })).toEqual({ isDone: true });
    expect(await ben.until("ended")).toEqual({ type: "ended", message: "Closed by the moderators.", endReason: "game" });
    ana.ws.close();
    ben.ws.close();
  });
});

/** A RoomCore with one player in it, the room messages it sends going to reach, and what its players were sent. */
function roomWith(gameServer: GameServer, reach?: RoomReach, nowMs = () => 1_000_000) {
  const sent: any[] = [];
  const core = new RoomCore(defineGameServer(gameServer), { roomCode: "AAAAAA", send: (playerId, text) => sent.push({ playerId, ...JSON.parse(text) }), close: () => {}, ...(reach ? { roomReach: reach } : {}) }, { now: nowMs });
  core.join({ id: "ana", name: "Ana", kind: "guest" }, {});
  return { core, sent };
}

const roomMessage = (message: unknown): RoomMessage => ({ message, senderKind: "developer", fromRoomCode: null, sentAt: "2026-10-29T20:00:00.000Z" });

describe("a room's game server and room messages", () => {
  it("hands a room message to players' games when the game server has no onRoomMessage, and takes 100 a second", () => {
    const { core, sent } = roomWith({ setup: () => ({}) });
    expect(core.receiveRoomMessage(roomMessage({ kind: "announcement" }))).toBe(true);
    expect(sent.filter((each) => each.type === "room_message")).toEqual([{ playerId: "ana", type: "room_message", roomMessage: roomMessage({ kind: "announcement" }) }]);
    for (let index = 1; index < 100; index++) expect(core.receiveRoomMessage(roomMessage(index))).toBe(true);
    expect(core.receiveRoomMessage(roomMessage("one too many"))).toBe(false);
  });

  it("checks the room's sends: plain JSON, another room's code, 20 a second, and a runtime that offers them", async () => {
    const asked: unknown[] = [];
    const reach: RoomReach = { sendToRoom: async (toRoomCode, message) => (asked.push([toRoomCode, message]), { isDelivered: true }), sendToEveryRoom: async (message, labels) => (asked.push([message, labels]), { roomCount: 4 }), listRooms: async () => ({ rooms: [] }) };
    const failures: string[] = [];
    const tryIt = async (work: () => Promise<unknown>) => {
      try {
        await work();
      } catch (error) {
        failures.push((error as { code: string }).code);
      }
    };
    const game: GameServer = {
      setup: () => ({}),
      async onMessage(state, player, room, message: any) {
        if (message === "bigint") await tryIt(() => room.sendToRoom("BBBBBB", { count: 10n }));
        if (message === "self") await tryIt(() => room.sendToRoom("AAAAAA", { kind: "echo" }));
        if (message === "labels") await tryIt(() => room.sendToEveryRoom({ kind: "news" }, { labels: { Map: 3 } as never }));
        if (message === "north") await room.sendToEveryRoom({ kind: "news" }, { labels: { Region: " North " } });
        if (message === "burst") for (let index = 0; index < 21; index++) await tryIt(() => room.sendToRoom("BBBBBB", index));
      },
    };
    const { core } = roomWith(game, reach);
    for (const message of ["bigint", "self", "labels", "north", "burst"]) core.receive("ana", JSON.stringify({ type: "message", data: message }));
    await core.settled();
    // The send to every room counts toward the room's 20 a second, so the burst's last two are refused; mistakes count for nothing.
    expect(failures).toEqual(["bad_room_call", "bad_room_call", "bad_room_call", "room_call_limit", "room_call_limit"]);
    expect(asked[0]).toEqual([{ kind: "news" }, { Region: "North" }]);
    expect(asked).toHaveLength(20);

    const without = roomWith(game);
    without.core.receive("ana", JSON.stringify({ type: "message", data: "self" }));
    await without.core.settled();
    expect(failures.at(-1)).toBe("room_call_unavailable");
  });

  it("runs onRoomMessage with the room message, its state answer kept", async () => {
    const { core, sent } = roomWith({ setup: () => ({ isBloodMoon: false }), onRoomMessage: (state, given, room) => (room.broadcast({ kind: (given.message as { kind: string }).kind }), { isBloodMoon: true }) });
    core.receiveRoomMessage(roomMessage({ kind: "blood_moon" }));
    await core.settled();
    expect(core.state).toEqual({ isBloodMoon: true });
    expect(sent.filter((each) => each.type === "message").map((each) => each.data)).toEqual([{ kind: "blood_moon" }]);
  });
});
