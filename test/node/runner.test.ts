import { afterAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
// @ts-expect-error plain JavaScript runner without type declarations
import { startServer } from "../../packages/game-server/bin/node.js";
import { generateSigningKey, loadSigningKey, relay, signPass } from "../../packages/game-server/src/index.ts";

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

function connect(origin = ORIGIN, path = "/v1/rooms/arena/ABCDEF") {
  const ws = new WebSocket(`ws://localhost:${port}${path}`, { origin });
  const inbox: any[] = [];
  const waiters: ((m: any) => void)[] = [];
  ws.on("message", (d) => {
    const m = JSON.parse(d.toString());
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
});
