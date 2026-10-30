import { describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { startServer } from "../../packages/game-server/bin/node.js";
// @ts-expect-error plain JavaScript without type declarations
import { localDatabase } from "../../packages/game-server/bin/node-parts.js";
import { REQUEST_ERROR_HTTP_STATUS, generateSigningKey, loadSigningKey, signPass, type PublicKey, type Server } from "../../packages/game-server/src/internal.ts";
import { signTestReceipt } from "../helpers.ts";

// Requests to onRequest on the developer's own server: the same address and answers as Zaisma rooms (test/rooms/requests.test.ts).

const ISS = "https://rooms.zaisma.test";
const ORIGIN = "https://shop.zaismausercontent.com";
const signing = await loadSigningKey(await generateSigningKey());
// The receipt key Zaisma publishes at its own address (/.well-known/receipt-jwks.json), apart from the pass key: receipts are signed with it, never the pass key.
const receiptSigning = await loadSigningKey(await generateSigningKey());

async function pass(sub: string, aud = "shop") {
  const nowSec = Math.floor(Date.now() / 1000);
  return signPass(signing, { sub, name: "Swift Fox 42", aud, iss: ISS, pass_version_number: 1, kind: "guest", iat: nowSec, exp: nowSec + 60 });
}

type KeyList = (refresh?: boolean) => Promise<PublicKey[]>;
async function serve(gameServer: object, { keys = async () => [signing.publicKey], receiptKeys = async () => [receiptSigning.publicKey] }: { keys?: KeyList; receiptKeys?: KeyList } = {}) {
  const own = startServer({ gameServer: gameServer, gameSlug: "shop", port: 0, origins: [ORIGIN], issuerUrl: ISS, loadPassKeys: keys, loadReceiptKeys: receiptKeys, database: localDatabase(":memory:") });
  await new Promise((resolve) => own.httpServer.once("listening", resolve));
  const portNumber = (own.httpServer.address() as { port: number }).port;
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

  it("check a purchase's receipt with server.verifyReceipt, the same answers as on Zaisma", async () => {
    const { own, send } = await serve({ onRequest: (player: unknown, request: { receipt: string }, server: Server) => server.verifyReceipt(request.receipt).catch((error: { name: string; code: string }) => ({ errorName: error.name, errorCode: error.code })) });
    const answerTo = async (receipt: string) => (await send({ receipt })).body.answer;
    expect(await answerTo(await signTestReceipt(receiptSigning, "shop", ISS))).toMatchObject({ aud: "shop", purchase_id: "purchase_8f3k2m9q1x7c4v6b0n5z", purchase_status: "completed", item_name: "gold_crown" });
    expect(await answerTo(await signTestReceipt(receiptSigning, "moon-base", ISS))).toEqual({ errorName: "ReceiptError", errorCode: "wrong_game" });
    // A pass is refused as one, before any key is looked up.
    expect(await answerTo(await pass("player_ana"))).toEqual({ errorName: "ReceiptError", errorCode: "wrong_kind" });
    expect(await answerTo(await signTestReceipt(await loadSigningKey(await generateSigningKey()), "shop", ISS))).toEqual({ errorName: "ReceiptError", errorCode: "unknown_key" });
    expect(await answerTo(await signTestReceipt(receiptSigning, "shop", "https://rooms.elsewhere.test"))).toEqual({ errorName: "ReceiptError", errorCode: "wrong_issuer" });
    expect(await answerTo("not.a.receipt")).toEqual({ errorName: "ReceiptError", errorCode: "malformed" });
    await own.close();
  });

  it("fetch Zaisma's receipt keys again once when a receipt's key is new, and no more", async () => {
    let fetchCount = 0;
    const published: PublicKey[] = [];
    const { own, send } = await serve(
      { onRequest: (player: unknown, request: { receipt: string }, server: Server) => server.verifyReceipt(request.receipt).then(() => "ok", (error: { code: string }) => error.code) },
      {
        receiptKeys: async (refresh = false) => {
          fetchCount += refresh ? 1 : 0;
          return refresh ? [receiptSigning.publicKey] : published;
        },
      },
    );
    const receipt = await signTestReceipt(receiptSigning, "shop", ISS);
    expect((await send({ receipt })).body.answer).toBe("ok");
    expect(fetchCount).toBe(1);
    const stranger = await signTestReceipt(await loadSigningKey(await generateSigningKey()), "shop", ISS);
    expect((await send({ receipt: stranger })).body.answer).toBe("unknown_key");
    expect(fetchCount).toBe(2);
    await own.close();
  });

  it("check a receipt in a room with room.verifyReceipt", async () => {
    const own = startServer({
      gameServer: {
        setup: () => ({}),
        async onMessage(state: unknown, player: { id: string }, room: { verifyReceipt(receipt: string): Promise<{ purchase_id: string }>; send(playerId: string, data: unknown): void }, message: string) {
          room.send(player.id, await room.verifyReceipt(message).then((claims) => ({ purchaseId: claims.purchase_id }), (error: { code: string }) => ({ errorCode: error.code })));
          return state;
        },
      },
      gameSlug: "shop",
      port: 0,
      origins: [ORIGIN],
      issuerUrl: ISS,
      loadPassKeys: async () => [signing.publicKey],
      loadReceiptKeys: async () => [receiptSigning.publicKey],
      roomStateFile: null,
    });
    await new Promise((resolve) => own.httpServer.once("listening", resolve));
    const socket = new WebSocket(`ws://localhost:${(own.httpServer.address() as { port: number }).port}/v1/rooms/shop/ABCDEF`, { origin: ORIGIN });
    const inbox: any[] = [];
    const waiters: ((message: any) => void)[] = [];
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "probe") return socket.send(JSON.stringify({ type: "probe_answer", probeNumber: message.probeNumber }));
      const waiter = waiters.shift();
      waiter ? waiter(message) : inbox.push(message);
    });
    const next = async (type: string) => {
      for (;;) {
        const message = inbox.length ? inbox.shift() : await new Promise<any>((resolve) => waiters.push(resolve));
        if (message.type === type) return message;
      }
    };
    const nextMessage = async () => (await next("message")).data;
    await new Promise((resolve) => socket.on("open", resolve));
    socket.send(JSON.stringify({ type: "hello", pass: await pass("player_ana") }));
    await next("welcome");
    const say = (data: unknown) => socket.send(JSON.stringify({ type: "message", data }));
    say(await signTestReceipt(receiptSigning, "shop", ISS));
    expect(await nextMessage()).toEqual({ purchaseId: "purchase_8f3k2m9q1x7c4v6b0n5z" });
    say(await signTestReceipt(receiptSigning, "moon-base", ISS));
    expect(await nextMessage()).toEqual({ errorCode: "wrong_game" });
    socket.close();
    await own.close();
  });

  it("never take a token signed with a receipt key for a pass, even with a pass's claims and issuer", async () => {
    const { own, send } = await serve({ onRequest: (player: { id: string }) => ({ playerId: player.id }) });
    const nowSec = Math.floor(Date.now() / 1000);
    const forged = await signPass(receiptSigning, { sub: "player_ana", name: "Swift Fox 42", aud: "shop", iss: ISS, pass_version_number: 1, kind: "guest", iat: nowSec, exp: nowSec + 60 });
    expect(await send({}, forged)).toMatchObject({ httpStatus: 401, body: { error: { code: "bad_pass" } } });
    expect((await send({})).httpStatus).toBe(200);
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

describe("request errors' HTTP statuses", () => {
  it("answer hosting_paused with 403, since it isn't a rate limit, and slow_down with 429", () => {
    expect(REQUEST_ERROR_HTTP_STATUS.hosting_paused).toBe(403);
    expect(REQUEST_ERROR_HTTP_STATUS.slow_down).toBe(429);
  });
});

describe("Node runner requests from players outside Zaisma", () => {
  it("reach onRequest with { playerToken, request }, as identifyPlayer says, with the same refusals as a hello", async () => {
    const own = startServer({
      gameServer: { onRequest: (player: { id: string; name: string; kind: string }) => player },
      gameSlug: "shop",
      port: 0,
      origins: [ORIGIN],
      issuerUrl: ISS,
      loadPassKeys: async () => [signing.publicKey],
      database: localDatabase(":memory:"),
      identifyPlayer: async (playerToken: string) => (playerToken === "throw" ? Promise.reject(new Error("down")) : playerToken === "good" ? { id: "own_ana", name: "Ana" } : null),
    });
    await new Promise((resolve) => own.httpServer.once("listening", resolve));
    const portNumber = (own.httpServer.address() as { port: number }).port;
    const send = async (body: object) => {
      const response = await fetch(`http://localhost:${portNumber}/v1/requests/shop`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain" }, body: JSON.stringify(body) });
      return { httpStatus: response.status, body: (await response.json()) as any };
    };
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await send({ playerToken: "good", request: { type: "who" } })).toEqual({ httpStatus: 200, body: { answer: { id: "own_ana", name: "Ana", kind: "outside_zaisma" } } });
      expect(await send({ playerToken: "nobody", request: {} })).toMatchObject({ httpStatus: 401, body: { error: { code: "bad_player_token" } } });
      // No guests unless outsideGuestsEnabled.
      expect(await send({ playerToken: null, request: {} })).toMatchObject({ httpStatus: 401, body: { error: { code: "bad_player_token" } } });
      expect(await send({ playerToken: "throw", request: {} })).toMatchObject({ httpStatus: REQUEST_ERROR_HTTP_STATUS.busy, body: { error: { code: "busy" } } });
      // Neither a pass nor a token, or a token over 8 KB, isn't a request.
      expect(await send({ request: {} })).toMatchObject({ httpStatus: 400, body: { error: { code: "bad_request" } } });
      expect(await send({ playerToken: "x".repeat(8 * 1024 + 1), request: {} })).toMatchObject({ httpStatus: 400, body: { error: { code: "bad_request" } } });
    } finally {
      errorLog.mockRestore();
      await own.close();
    }
  });
});
