import { describe, expect, it } from "vitest";
import WebSocket from "ws";
// @ts-expect-error plain JavaScript runner without type declarations
import { localDatabase, startServer } from "../../packages/game-server/bin/node.js";
import { generateSigningKey, loadSigningKey, signPass, type Server } from "../../packages/game-server/src/internal.ts";

// Requests to onRequest on the developer's own server: the same address and answers as Zaisma rooms (test/rooms/requests.test.ts).

const ISS = "https://rooms.zaisma.test";
const ORIGIN = "https://shop.zaismausercontent.com";
const signing = await loadSigningKey(await generateSigningKey());

async function pass(sub: string, aud = "shop") {
  const nowSec = Math.floor(Date.now() / 1000);
  return signPass(signing, { sub, name: "Swift Fox 42", aud, iss: ISS, pass_version_number: 1, kind: "guest", iat: nowSec, exp: nowSec + 60 });
}

async function serve(gameServer: object) {
  const own = startServer({ server: gameServer, game: "shop", port: 0, origins: [ORIGIN], issuer: ISS, keys: async () => [signing.publicKey], database: localDatabase(":memory:") });
  await new Promise((resolve) => own.wss.once("listening", resolve));
  const portNumber = (own.wss.address() as { port: number }).port;
  const send = async (request: unknown, givenPass?: string, origin = ORIGIN, path = "/v1/requests/shop") => {
    const response = await fetch(`http://localhost:${portNumber}${path}`, { method: "POST", headers: { Origin: origin, "Content-Type": "text/plain" }, body: JSON.stringify({ pass: givenPass ?? (await pass("player_ana")), request }) });
    return { httpStatus: response.status, body: (await response.json().catch(() => null)) as any, allowedOrigin: response.headers.get("access-control-allow-origin") };
  };
  return { own, send, portNumber };
}

const SHOP = {
  async onRequest(player: { id: string }, request: { type: string; coinCount?: number }, server: Server) {
    await server.database.query("CREATE TABLE IF NOT EXISTS wallets (player_id TEXT PRIMARY KEY, coin_count INTEGER NOT NULL)");
    if (request.type === "crash") throw new Error("the shop is closed");
    if (request.type === "add") await server.database.query("INSERT INTO wallets VALUES (?, ?) ON CONFLICT (player_id) DO UPDATE SET coin_count = coin_count + excluded.coin_count", [player.id, request.coinCount!]);
    const [wallet] = await server.database.query("SELECT coin_count FROM wallets WHERE player_id = ?", [player.id]);
    return { playerId: player.id, coinCount: wallet?.coin_count ?? 0 };
  },
};

describe("Node runner requests", () => {
  it("give onRequest the environment variables as server.secrets, the same code as on Zaisma", async () => {
    process.env.ZAISMA_TEST_API_TOKEN = "token-from-the-environment";
    const { own, send } = await serve({ onRequest: (player: unknown, request: unknown, server: Server) => ({ token: server.secrets.ZAISMA_TEST_API_TOKEN ?? null, isFrozen: Object.isFrozen(server.secrets) }) });
    try {
      expect((await send({})).body).toEqual({ answer: { token: "token-from-the-environment", isFrozen: true } });
    } finally {
      delete process.env.ZAISMA_TEST_API_TOKEN;
      await own.close();
    }
  });

  it("answer from onRequest with the local database, for a game server with no rooms", async () => {
    const { own, send } = await serve(SHOP);
    expect(await send({ type: "add", coinCount: 5 })).toEqual({ httpStatus: 200, body: { answer: { playerId: "player_ana", coinCount: 5 } }, allowedOrigin: ORIGIN });
    expect((await send({ type: "wallet" })).body).toEqual({ answer: { playerId: "player_ana", coinCount: 5 } });
    await own.close();
  });

  it("answer the same errors as Zaisma rooms", async () => {
    const { own, send } = await serve(SHOP);
    expect(await send({ type: "crash" })).toMatchObject({ httpStatus: 500, body: { error: { code: "game_server_error", message: "The game's server couldn't answer this request." } } });
    expect(await send({ type: "wallet" }, "not.a.pass")).toMatchObject({ httpStatus: 401, body: { error: { code: "bad_pass" } } });
    expect((await send({ type: "wallet" }, await pass("player_ana", "other-game"))).body.error.code).toBe("bad_pass");
    expect((await send({ type: "wallet" }, undefined, "https://evil.example")).body.error.code).toBe("bad_origin");
    expect((await send({ type: "save", text: "x".repeat(17 * 1024) })).body.error.code).toBe("too_big");
    expect((await send({ type: "wallet" }, undefined, ORIGIN, "/v1/requests/other-game")).httpStatus).toBe(404);
    await own.close();
  });

  it("need onRequest, and a game server without setup runs no rooms", async () => {
    const roomsOnly = await serve({ setup: () => ({}) });
    expect((await roomsOnly.send({ type: "wallet" })).body.error.code).toBe("no_request_handler");
    await roomsOnly.own.close();

    const { own, portNumber } = await serve(SHOP);
    const socket = new WebSocket(`ws://localhost:${portNumber}/v1/rooms/shop/ABCDEF`, { origin: ORIGIN });
    const first = new Promise<any>((resolve) => socket.once("message", (raw) => resolve(JSON.parse(raw.toString()))));
    expect(await first).toMatchObject({ type: "error", code: "game_unavailable" });
    socket.close();
    await own.close();
  });
});
