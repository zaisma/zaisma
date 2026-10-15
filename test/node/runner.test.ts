import { afterAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
// @ts-expect-error plain JavaScript runner without type declarations
import { startServer } from "../../packages/game-server/bin/node.js";
import { ERROR_TEXT, defineGameServer, generateSigningKey, loadSigningKey, relay, signPass } from "../../packages/game-server/src/index.ts";

const ISS = "https://rooms.zaisma.test";
const ORIGIN = "https://arena.zaismausercontent.com";
const signing = await loadSigningKey(await generateSigningKey());
const loadPublicKeys = async () => [signing.publicKey];
const server = startServer({ gameServer: relay, gameSlug: "arena", port: 0, allowedOrigins: [ORIGIN], issuer: ISS, loadPublicKeys });
await new Promise((r) => server.wss.once("listening", r));
const port = (server.wss.address() as { port: number }).port;
afterAll(() => server.close());

async function pass(sub: string, aud = "arena") {
  const now = Math.floor(Date.now() / 1000);
  return signPass(signing, { sub, name: sub.toUpperCase(), aud, iss: ISS, kind: "guest", iat: now, exp: now + 60 });
}

function connect(origin = ORIGIN, path = "/v1/rooms/arena/ABCDEF", on = port) {
  const ws = new WebSocket(`ws://localhost:${on}${path}`, { origin });
  const inbox: any[] = [];
  const waiters: ((m: any) => void)[] = [];
  ws.on("message", (d) => {
    const text = d.toString();
    const m = text === "pong" ? { type: "pong" } : JSON.parse(text);
    const w = waiters.shift();
    w ? w(m) : inbox.push(m);
  });
  const next = () => (inbox.length ? Promise.resolve(inbox.shift()) : new Promise<any>((r) => waiters.push(r)));
  const closed = new Promise<number>((r) => ws.on("close", (code) => r(code)));
  const open = new Promise((r) => ws.on("open", r));
  return { ws, next, closed, open };
}

/** The next message of a type, skipping the others. */
async function until(c: { next: () => Promise<any> }, type: string) {
  for (;;) {
    const m = await c.next();
    if (m.type === type) return m;
  }
}

describe("Node runner", () => {
  it("runs the same game server with Zaisma player passes", async () => {
    const a = connect();
    const b = connect();
    await Promise.all([a.open, b.open]);
    a.ws.send(JSON.stringify({ type: "hello", pass: await pass("a") }));
    expect(await a.next()).toMatchObject({ type: "welcome", me: { id: "a", name: "A" }, hostPlayerId: "a" });
    b.ws.send(JSON.stringify({ type: "hello", pass: await pass("b") }));
    expect((await b.next()).type).toBe("welcome");
    await a.next(); // players: a
    await a.next(); // players: a, b
    a.ws.send(JSON.stringify({ type: "message", data: "hi" }));
    await b.next(); // b's players list
    expect(await b.next()).toEqual({ type: "message", data: { fromPlayerId: "a", messageData: "hi" } });
    a.ws.close();
    b.ws.close();
  });

  it("refuses options it doesn't take, listing the ones it does", () => {
    expect(() => startServer({ server: relay, gameSlug: "arena", port: 0, allowedOrigins: [ORIGIN], loadPublicKeys })).toThrow(
      "startServer doesn't take server. It takes gameServer, gameSlug, port, allowedOrigins, issuer, loadPublicKeys.",
    );
  });

  it("refuses other origins and passes for other games", async () => {
    expect(await connect("https://evil.example").closed).toBe(4001);
    const c = connect();
    await c.open;
    c.ws.send(JSON.stringify({ type: "hello", pass: await pass("c", "other-game") }));
    expect(await c.next()).toMatchObject({ type: "error", code: "bad_pass" });
    expect(await c.closed).toBe(4001);
  });

  it("turns players away with the game's refusalMessage, or the usual message when canJoin answers wrongly", async () => {
    const locked = defineGameServer({
      setup: () => ({}),
      canJoin: (_s, _p, _room, joinData) => {
        const password = (joinData as { password?: string } | undefined)?.password;
        if (password === "mistake") return "Wrong password" as never;
        return password === "docks" || { refusalMessage: "Wrong password" };
      },
    });
    const own = startServer({ gameServer: locked, gameSlug: "arena", port: 0, allowedOrigins: [ORIGIN], issuer: ISS, loadPublicKeys });
    await new Promise((r) => own.wss.once("listening", r));
    const at = (own.wss.address() as { port: number }).port;
    const knock = async (password: string) => {
      const c = connect(ORIGIN, "/v1/rooms/arena/LCKDAA", at);
      await c.open;
      c.ws.send(JSON.stringify({ type: "hello", pass: await pass(`player_${password}`), joinData: { password } }));
      const answer = await c.next();
      c.ws.close();
      return answer;
    };
    expect(await knock("nope")).toEqual({ type: "error", code: "refused", message: "Wrong password" });
    expect(await knock("mistake")).toEqual({ type: "error", code: "refused", message: ERROR_TEXT.refused });
    expect(await knock("docks")).toMatchObject({ type: "welcome" });
    await own.close();
  });

  it("reserves a room for some players, with its data and nobody else", async () => {
    // A lobby that sends the first two players to a match of their own; the match keeps what each brought.
    const lobby = defineGameServer({
      setup: (startData?: unknown) => ({ data: startData ?? null, brought: {} as Record<string, unknown> }),
      onJoin(s, p, room, joinData) {
        s.brought[p.id] = joinData;
        if (!s.data && room.players.length === 2) room.reserve({ playerIds: room.players.map((x) => x.id), startData: { map: "Docks" } });
        if (s.data) room.send(p.id, s);
      },
    });
    const own = startServer({ gameServer: lobby, gameSlug: "arena", port: 0, allowedOrigins: [ORIGIN], issuer: ISS, loadPublicKeys });
    await new Promise((r) => own.wss.once("listening", r));
    const at = (own.wss.address() as { port: number }).port;
    const a = connect(ORIGIN, "/v1/rooms/arena/LBBYAA", at);
    const b = connect(ORIGIN, "/v1/rooms/arena/LBBYAA", at);
    await Promise.all([a.open, b.open]);
    a.ws.send(JSON.stringify({ type: "hello", pass: await pass("a") }));
    await until(a, "welcome");
    b.ws.send(JSON.stringify({ type: "hello", pass: await pass("b") }));
    const { roomCode } = await until(a, "move");
    expect((await until(b, "move")).roomCode).toBe(roomCode);

    const stranger = connect(ORIGIN, `/v1/rooms/arena/${roomCode}`, at);
    await stranger.open;
    stranger.ws.send(JSON.stringify({ type: "hello", pass: await pass("c") }));
    expect(await stranger.next()).toMatchObject({ type: "error", code: "closed" });
    const m = connect(ORIGIN, `/v1/rooms/arena/${roomCode}`, at);
    await m.open;
    m.ws.send(JSON.stringify({ type: "hello", pass: await pass("a"), joinData: { character: "knight" } }));
    expect(await until(m, "message")).toEqual({ type: "message", data: { data: { map: "Docks" }, brought: { a: { character: "knight" } } } });
    for (const c of [a, b, m]) c.ws.close();
    await own.close();
  });

  it("moves players to another room that's running, which gets the data and can say no", async () => {
    const world = defineGameServer({
      setup: () => ({}),
      onJoin(_s, p, room, joinData, joinInfo) {
        if (joinInfo.fromRoomCode) room.send(p.id, { arrived: joinData, fromRoomCode: joinInfo.fromRoomCode });
      },
      onMessage(_s, p, messageData, room) {
        room.moveTo(String(messageData), { playerIds: [p.id], joinData: { door: "north" } });
      },
      onMoved(_s, moveResult, room) {
        for (const refused of moveResult.refusedPlayers) room.send(refused.player.id, { stayed: refused.error.code });
      },
    });
    const own = startServer({ gameServer: world, gameSlug: "arena", port: 0, allowedOrigins: [ORIGIN], issuer: ISS, loadPublicKeys });
    await new Promise((r) => own.wss.once("listening", r));
    const at = (own.wss.address() as { port: number }).port;
    const forest = connect(ORIGIN, "/v1/rooms/arena/FRSTAA", at);
    const town = connect(ORIGIN, "/v1/rooms/arena/TWNAAA", at);
    await Promise.all([forest.open, town.open]);
    forest.ws.send(JSON.stringify({ type: "hello", pass: await pass("f") }));
    await until(forest, "welcome");
    town.ws.send(JSON.stringify({ type: "hello", pass: await pass("a") }));
    await until(town, "welcome");

    town.ws.send(JSON.stringify({ type: "message", data: "ZZZZZZ" }));
    expect(await until(town, "message")).toEqual({ type: "message", data: { stayed: "no_room" } });
    town.ws.send(JSON.stringify({ type: "message", data: "FRSTAA" }));
    expect(await until(town, "move")).toEqual({ type: "move", roomCode: "FRSTAA" });

    const moved = connect(ORIGIN, "/v1/rooms/arena/FRSTAA", at);
    await moved.open;
    moved.ws.send(JSON.stringify({ type: "hello", pass: await pass("a"), joinData: { door: "cheat" } }));
    expect(await until(moved, "message")).toEqual({ type: "message", data: { arrived: { door: "north" }, fromRoomCode: "TWNAAA" } });
    for (const c of [forest, town, moved]) c.ws.close();
    await own.close();
  });

  it("answers pings, takes players who walk away out of the match with their seat held, and lets them back", async () => {
    const duel = defineGameServer({
      maximumPlayerCount: 2,
      setup: () => ({}),
      onJoin(_s, p, room, _joinData, joinInfo) {
        room.broadcast({ joined: p.id, isReturning: joinInfo.isReturning });
      },
      onLeave(_s, p, room, leaveInfo) {
        room.broadcast({ left: p.id, leaveReason: leaveInfo.leaveReason });
      },
    });
    const own = startServer({ gameServer: duel, gameSlug: "arena", port: 0, allowedOrigins: [ORIGIN], issuer: ISS, loadPublicKeys });
    await new Promise((r) => own.wss.once("listening", r));
    const at = (own.wss.address() as { port: number }).port;
    const a = connect(ORIGIN, "/v1/rooms/arena/DLAAAA", at);
    const b = connect(ORIGIN, "/v1/rooms/arena/DLAAAA", at);
    await Promise.all([a.open, b.open]);
    a.ws.send("ping");
    expect(await a.next()).toEqual({ type: "pong" });
    a.ws.send(JSON.stringify({ type: "hello", pass: await pass("a") }));
    expect((await until(a, "welcome")).awayChecks).toEqual({ idleTimeoutSec: 600, hiddenTimeoutSec: null });
    b.ws.send(JSON.stringify({ type: "hello", pass: await pass("b") }));
    await until(b, "welcome");

    b.ws.send(JSON.stringify({ type: "idle" }));
    expect(await until(b, "away")).toEqual({ type: "away", awayReason: "idle", seatHoldDurationSec: 300 });
    expect((await until(a, "message")).data).toEqual({ joined: "a", isReturning: false });
    expect((await until(a, "message")).data).toEqual({ joined: "b", isReturning: false });
    expect((await until(a, "message")).data).toEqual({ left: "b", leaveReason: "idle" });
    // The held seat keeps the room full.
    const c = connect(ORIGIN, "/v1/rooms/arena/DLAAAA", at);
    await c.open;
    c.ws.send(JSON.stringify({ type: "hello", pass: await pass("c") }));
    expect(await c.next()).toMatchObject({ type: "error", code: "full" });

    b.ws.send(JSON.stringify({ type: "back" }));
    await until(b, "welcome");
    expect((await until(a, "message")).data).toEqual({ joined: "b", isReturning: true });
    for (const x of [a, b]) x.ws.close();
    await own.close();
  });
});
