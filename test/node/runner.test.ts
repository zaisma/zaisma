import { afterAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
// @ts-expect-error plain JavaScript runner without type declarations
import { startServer } from "../../packages/game-server/bin/node.js";
import { defineGameServer, generateSigningKey, loadSigningKey, relay, signPass } from "../../packages/game-server/src/index.ts";

const ISS = "https://rooms.zaisma.test";
const ORIGIN = "https://arena.zaismausercontent.com";
const signing = await loadSigningKey(await generateSigningKey());
const server = startServer({ server: relay, game: "arena", port: 0, origins: [ORIGIN], issuer: ISS, keys: async () => [signing.publicKey] });
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
    const m = text === "pong" ? { t: "pong" } : JSON.parse(text);
    const w = waiters.shift();
    w ? w(m) : inbox.push(m);
  });
  const next = () => (inbox.length ? Promise.resolve(inbox.shift()) : new Promise<any>((r) => waiters.push(r)));
  const closed = new Promise<number>((r) => ws.on("close", (code) => r(code)));
  const open = new Promise((r) => ws.on("open", r));
  return { ws, next, closed, open };
}

describe("Node runner", () => {
  it("runs the same game server with Zaisma player passes", async () => {
    const a = connect();
    const b = connect();
    await Promise.all([a.open, b.open]);
    a.ws.send(JSON.stringify({ t: "hello", pass: await pass("a") }));
    expect(await a.next()).toMatchObject({ t: "welcome", me: { id: "a", name: "A" } });
    b.ws.send(JSON.stringify({ t: "hello", pass: await pass("b") }));
    expect((await b.next()).t).toBe("welcome");
    await a.next(); // players: a
    await a.next(); // players: a, b
    a.ws.send(JSON.stringify({ t: "msg", d: "hi" }));
    await b.next(); // b's players list
    expect(await b.next()).toEqual({ t: "msg", d: { from: "a", data: "hi" } });
    a.ws.close();
    b.ws.close();
  });

  it("refuses other origins and passes for other games", async () => {
    expect(await connect("https://evil.example").closed).toBe(4001);
    const c = connect();
    await c.open;
    c.ws.send(JSON.stringify({ t: "hello", pass: await pass("c", "other-game") }));
    expect(await c.next()).toMatchObject({ t: "error", code: "bad-pass" });
    expect(await c.closed).toBe(4001);
  });

  it("reserves a room for some players, with its data and nobody else", async () => {
    // A lobby that sends the first two players to a match of their own; the match keeps what each brought.
    const lobby = defineGameServer({
      setup: (data?: unknown) => ({ data: data ?? null, brought: {} as Record<string, unknown> }),
      onJoin(s, p, room, data) {
        s.brought[p.id] = data;
        if (!s.data && room.players.length === 2) room.reserve({ players: room.players.map((x) => x.id), data: { map: "Docks" } });
        if (s.data) room.send(p.id, s);
      },
    });
    const own = startServer({ server: lobby, game: "arena", port: 0, origins: [ORIGIN], issuer: ISS, keys: async () => [signing.publicKey] });
    await new Promise((r) => own.wss.once("listening", r));
    const at = (own.wss.address() as { port: number }).port;
    const until = async (c: { next: () => Promise<any> }, t: string) => {
      for (;;) {
        const m = await c.next();
        if (m.t === t) return m;
      }
    };
    const a = connect(ORIGIN, "/v1/rooms/arena/LBBYAA", at);
    const b = connect(ORIGIN, "/v1/rooms/arena/LBBYAA", at);
    await Promise.all([a.open, b.open]);
    a.ws.send(JSON.stringify({ t: "hello", pass: await pass("a") }));
    await until(a, "welcome");
    b.ws.send(JSON.stringify({ t: "hello", pass: await pass("b") }));
    const { code } = await until(a, "move");
    expect((await until(b, "move")).code).toBe(code);

    const stranger = connect(ORIGIN, `/v1/rooms/arena/${code}`, at);
    await stranger.open;
    stranger.ws.send(JSON.stringify({ t: "hello", pass: await pass("c") }));
    expect(await stranger.next()).toMatchObject({ t: "error", code: "closed" });
    const m = connect(ORIGIN, `/v1/rooms/arena/${code}`, at);
    await m.open;
    m.ws.send(JSON.stringify({ t: "hello", pass: await pass("a"), data: { character: "knight" } }));
    expect(await until(m, "msg")).toEqual({ t: "msg", d: { data: { map: "Docks" }, brought: { a: { character: "knight" } } } });
    for (const c of [a, b, m]) c.ws.close();
    await own.close();
  });

  it("moves players to another room that's running, which gets the data and can say no", async () => {
    const world = defineGameServer({
      setup: () => ({}),
      onJoin(_s, p, room, data, info) {
        if (info?.from) room.send(p.id, { arrived: data, from: info.from });
      },
      onMessage(_s, p, msg, room) {
        room.moveTo(String(msg), { players: [p.id], data: { door: "north" } });
      },
      onMoved(_s, result, room) {
        for (const r of result.refused) room.send(r.player.id, { stayed: r.code });
      },
    });
    const own = startServer({ server: world, game: "arena", port: 0, origins: [ORIGIN], issuer: ISS, keys: async () => [signing.publicKey] });
    await new Promise((r) => own.wss.once("listening", r));
    const at = (own.wss.address() as { port: number }).port;
    const until = async (c: { next: () => Promise<any> }, t: string) => {
      for (;;) {
        const m = await c.next();
        if (m.t === t) return m;
      }
    };
    const forest = connect(ORIGIN, "/v1/rooms/arena/FRSTAA", at);
    const town = connect(ORIGIN, "/v1/rooms/arena/TWNAAA", at);
    await Promise.all([forest.open, town.open]);
    forest.ws.send(JSON.stringify({ t: "hello", pass: await pass("f") }));
    await until(forest, "welcome");
    town.ws.send(JSON.stringify({ t: "hello", pass: await pass("a") }));
    await until(town, "welcome");

    town.ws.send(JSON.stringify({ t: "msg", d: "ZZZZZZ" }));
    expect(await until(town, "msg")).toEqual({ t: "msg", d: { stayed: "no-room" } });
    town.ws.send(JSON.stringify({ t: "msg", d: "FRSTAA" }));
    expect(await until(town, "move")).toEqual({ t: "move", code: "FRSTAA" });

    const moved = connect(ORIGIN, "/v1/rooms/arena/FRSTAA", at);
    await moved.open;
    moved.ws.send(JSON.stringify({ t: "hello", pass: await pass("a"), data: { door: "cheat" } }));
    expect(await until(moved, "msg")).toEqual({ t: "msg", d: { arrived: { door: "north" }, from: "TWNAAA" } });
    for (const c of [forest, town, moved]) c.ws.close();
    await own.close();
  });

  it("answers pings, takes players who walk away out of the match with their seat held, and lets them back", async () => {
    const duel = defineGameServer({
      maxPlayers: 2,
      setup: () => ({}),
      onJoin(_s, p, room, _data, info) {
        room.broadcast({ joined: p.id, back: info?.back === true });
      },
      onLeave(_s, p, room, info) {
        room.broadcast({ left: p.id, why: info?.why });
      },
    });
    const own = startServer({ server: duel, game: "arena", port: 0, origins: [ORIGIN], issuer: ISS, keys: async () => [signing.publicKey] });
    await new Promise((r) => own.wss.once("listening", r));
    const at = (own.wss.address() as { port: number }).port;
    const until = async (c: { next: () => Promise<any> }, t: string) => {
      for (;;) {
        const m = await c.next();
        if (m.t === t) return m;
      }
    };
    const a = connect(ORIGIN, "/v1/rooms/arena/DLAAAA", at);
    const b = connect(ORIGIN, "/v1/rooms/arena/DLAAAA", at);
    await Promise.all([a.open, b.open]);
    a.ws.send("ping");
    expect(await a.next()).toEqual({ t: "pong" });
    a.ws.send(JSON.stringify({ t: "hello", pass: await pass("a") }));
    expect((await until(a, "welcome")).away).toEqual({ idle: 600, hidden: null });
    b.ws.send(JSON.stringify({ t: "hello", pass: await pass("b") }));
    await until(b, "welcome");

    b.ws.send(JSON.stringify({ t: "idle" }));
    expect(await until(b, "away")).toEqual({ t: "away", why: "idle", seconds: 300 });
    expect((await until(a, "msg")).d).toEqual({ joined: "a", back: false });
    expect((await until(a, "msg")).d).toEqual({ joined: "b", back: false });
    expect((await until(a, "msg")).d).toEqual({ left: "b", why: "idle" });
    // The held seat keeps the room full.
    const c = connect(ORIGIN, "/v1/rooms/arena/DLAAAA", at);
    await c.open;
    c.ws.send(JSON.stringify({ t: "hello", pass: await pass("c") }));
    expect(await c.next()).toMatchObject({ t: "error", code: "full" });

    b.ws.send(JSON.stringify({ t: "back" }));
    await until(b, "welcome");
    expect((await until(a, "msg")).d).toEqual({ joined: "b", back: true });
    for (const x of [a, b]) x.ws.close();
    await own.close();
  });
});
