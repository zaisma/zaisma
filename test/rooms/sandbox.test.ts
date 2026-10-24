import { env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAccount, issueRoomKey, monthStartDateOf, takeBack } from "@zaisma/core";
import { loadSigningKey } from "@zaisma/game-server/internal";
import type { Env } from "../../apps/rooms/src/index.ts";
import type { Room } from "../../apps/rooms/src/room.ts";
import { signTestReceipt } from "../helpers.ts";

// Developers' own game servers, run in a sandbox (apps/rooms/src/sandbox.ts).

const R = "https://rooms.zaisma.test";
const ORIGIN = "https://games.zaisma.test";
const e = env as unknown as Env;

/** A live game set to run its own game server, with that server as its zaisma-server.js. */
async function addSandboxGame(slug: string, server: string) {
  const id = `g${slug.replace(/-/g, "")}`;
  const version = `v${slug.replace(/-/g, "")}`;
  await e.DB.prepare("INSERT INTO games (id, slug, title, review_status, live_version_id, multiplayer_mode, room_browsing, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 'live', ?, 'own', 'page', 0, 0)")
    .bind(id, slug, slug, version)
    .run();
  await e.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES (?, ?, ?, 2, 0, 'approved', 0)").bind(version, id, `games/${version}`).run();
  await e.GAMES.put(`games/${version}/zaisma-server.js`, server);
}

let address = 0;
async function newPass(game: string) {
  // The key the game page gets when Cloudflare's check on Play passes.
  const roomKey = await issueRoomKey(e.DB, `g${game.replace(/-/g, "")}`);
  const res = await SELF.fetch(`${R}/v1/pass`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain", "cf-connecting-ip": `198.51.100.${++address % 250}` }, body: JSON.stringify({ gameSlug: game, roomKey }) });
  return res.json<{ pass: string; player: { id: string; name: string } }>();
}

/** Try to join, and say what the room answered first. */
async function knock(game: string, code: string, joinData?: unknown, pass?: string) {
  pass ??= (await newPass(game)).pass;
  const up = await SELF.fetch(`${R}/v1/rooms/${game}/${code}`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `198.51.100.${++address % 250}` } });
  const ws = up.webSocket!;
  ws.accept();
  const first = new Promise<any>((r) => ws.addEventListener("message", (ev) => r(JSON.parse(ev.data as string)), { once: true }));
  ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass, joinData }));
  return first;
}

/** Join with a pass and join data, and say the first thing the game itself sends (or the room's error). */
async function arrive(game: string, code: string, joinData: unknown, pass: string) {
  const up = await SELF.fetch(`${R}/v1/rooms/${game}/${code}`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `198.51.100.${++address % 250}` } });
  const ws = up.webSocket!;
  ws.accept();
  const got = new Promise<any>((r) =>
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data as string);
      if (m.type === "message" || m.type === "error") r(m);
    }),
  );
  ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass, joinData }));
  return got;
}

/** Answer a probe at once, as the SDK does; a connection the test already closed has nothing to answer. */
function answerProbe(ws: WebSocket, probeNumber: number) {
  try {
    ws.send(JSON.stringify({ type: "probe_answer", probeNumber }));
  } catch {
    // Closed.
  }
}

async function join(game: string, code: string, joinData?: unknown, samePass?: string, isSpectator = false) {
  const { pass, player } = samePass ? { pass: samePass, player: null as never } : await newPass(game);
  const up = await SELF.fetch(`${R}/v1/rooms/${game}/${code}`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `198.51.100.${++address % 250}` } });
  expect(up.status).toBe(101);
  const ws = up.webSocket!;
  ws.accept();
  const inbox: any[] = [];
  const waiters: ((m: any) => void)[] = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data as string);
    // Probes are answered at once, as the SDK does.
    if (m.type === "probe") return answerProbe(ws, m.probeNumber);
    const w = waiters.shift();
    w ? w(m) : inbox.push(m);
  });
  const next = () => (inbox.length ? Promise.resolve(inbox.shift()) : new Promise<any>((r) => waiters.push(r)));
  /** The next message from the game (skipping the room's own player lists). */
  const fromGame = async () => {
    for (;;) {
      const m = await next();
      if (["message", "ended", "ending", "error", "kicked", "move"].includes(m.type)) return m;
    }
  };
  const say = (data: unknown) => ws.send(JSON.stringify({ type: "message", data }));
  ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass, ...(joinData !== undefined ? { joinData } : {}), ...(isSpectator ? { isSpectator } : {}) }));
  expect((await next()).type).toBe("welcome");
  /** The next state update (stateSyncEnabled), without its serverTimeMs, skipping anything else. */
  const nextState = async () => {
    for (;;) {
      const { serverTimeMs, ...frame } = await next();
      if (frame.type === "state") return frame;
    }
  };
  return { ws, player, pass, say, next: fromGame, nextState };
}

const COUNTER = `
export default {
  maximumPlayerCount: 4,
  setup: (setupData) => ({ count: 0 }),
  onJoin(state, player, room) { room.send(player.id, { hi: player.name, players: room.players.length }); },
  onMessage(state, player, message, room) {
    if (message === "add") { state.count++; room.broadcast({ count: state.count }); }
    if (message === "fetch") fetch("https://example.com").then(() => room.broadcast("reached the internet"), () => {});
    if (message === "spin") for (;;) {}
    if (message === "crash") throw new Error("oops");
    if (message === "who") room.send(player.id, { globals: typeof env, keys: Object.keys(globalThis).filter((k) => /zaisma|DB|GAMES/i.test(k)) });
    if (message === "end") room.end("Game over");
    return state;
  },
};
`;

describe("sandboxed game servers", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM room_usage; DELETE FROM game_hosting_months; DELETE FROM game_server_errors; DELETE FROM live_rooms; DELETE FROM versions; DELETE FROM games;");
  });

  it("runs the game's own server: state, messages and the room API", async () => {
    await addSandboxGame("counter", COUNTER);
    const a = await join("counter", "ABCDEF");
    expect(await a.next()).toEqual({ type: "message", data: { hi: a.player.name, players: 1 }, fromPlayerId: null });
    const b = await join("counter", "ABCDEF");
    expect(await b.next()).toEqual({ type: "message", data: { hi: b.player.name, players: 2 }, fromPlayerId: null });

    a.say("add");
    a.say("add");
    expect((await b.next()).data).toEqual({ count: 1 });
    expect((await b.next()).data).toEqual({ count: 2 });

    a.say("end");
    expect(await b.next()).toEqual({ type: "ended", message: "Game over", endReason: "game" });
  });

  it("gives the game server what each account owns, from its pass, and a guest nothing", async () => {
    await addSandboxGame(
      "wardrobe",
      `export default {
  maximumPlayerCount: 4,
  setup: () => ({}),
  onJoin(state, player, room) { room.send(player.id, { owned: player.ownedItemNames ?? null, everyone: room.players.map((other) => other.ownedItemNames ?? null) }); },
};`,
    );
    const account = await createAccount(e.DB, { id: "supabase-user-wardrobe", username: "Cape_Owner", ageBand: "18+" });
    await e.DB.prepare("INSERT INTO purchases (id, game_id, item_name, item_kind, player_id, purchase_source, purchase_status, created_at_ms, purchased_at_ms) VALUES ('purchase_wardrobecape1', 'gwardrobe', 'supporter_cape', 'permanent', ?, 'grant', 'completed', 0, 0)")
      .bind(account.player_id)
      .run();
    const roomKey = await issueRoomKey(e.DB, "gwardrobe", account.id);
    const { pass } = await (await SELF.fetch(`${R}/v1/pass`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain", "cf-connecting-ip": `198.51.100.${++address % 250}` }, body: JSON.stringify({ gameSlug: "wardrobe", roomKey }) })).json<{ pass: string }>();
    const owner = await join("wardrobe", "WRDRBE", undefined, pass);
    expect(await owner.next()).toEqual({ type: "message", data: { owned: ["supporter_cape"], everyone: [["supporter_cape"]] }, fromPlayerId: null });
    const guest = await join("wardrobe", "WRDRBE");
    expect(await guest.next()).toEqual({ type: "message", data: { owned: null, everyone: [["supporter_cape"], null] }, fromPlayerId: null });
    await e.DB.exec("DELETE FROM purchases; DELETE FROM accounts;");
  });

  it("runs onPurchase once for an account's purchase when the game's purchases go to its game server, and not when they go to the game", async () => {
    const PURCHASE_TAKER = `export default {
  maximumPlayerCount: 4,
  setup: () => ({}),
  onPurchase(state, player, room, purchase) { room.send(player.id, { bought: purchase.id, itemName: purchase.itemName, itemCount: purchase.itemCount, purchaseStatus: purchase.purchaseStatus, hasReceipt: typeof purchase.receipt === "string" }); },
  onMessage(state, player, message, room) { room.send(player.id, "pong"); },
};`;
    await addSandboxGame("delivered-here", PURCHASE_TAKER);
    await addSandboxGame("delivered-to-game", PURCHASE_TAKER);
    await e.DB.prepare("UPDATE games SET purchase_delivery = 'game_server' WHERE id = 'gdeliveredhere'").run();
    const account = await createAccount(e.DB, { id: "supabase-user-reviver", username: "Revive_Buyer", ageBand: "18+" });
    for (const [gameId, purchaseId] of [["gdeliveredhere", "purchase_deliveredhere1"], ["gdeliveredtogame", "purchase_deliveredgame1"]] as const) {
      await e.DB.prepare("INSERT INTO purchases (id, game_id, item_name, item_kind, item_count, player_id, purchase_source, purchase_status, created_at_ms, purchased_at_ms) VALUES (?, ?, 'revive', 'consumable', 3, ?, 'grant', 'completed', 0, 0)")
        .bind(purchaseId, gameId, account.player_id)
        .run();
    }
    const accountPass = async (slug: string, gameId: string) => {
      const roomKey = await issueRoomKey(e.DB, gameId, account.id);
      return (await (await SELF.fetch(`${R}/v1/pass`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain", "cf-connecting-ip": `198.51.100.${++address % 250}` }, body: JSON.stringify({ gameSlug: slug, roomKey }) })).json<{ pass: string }>()).pass;
    };
    const handledAt = async (purchaseId: string) => (await e.DB.prepare("SELECT handled_at_ms, handling_until_ms FROM purchases WHERE id = ?").bind(purchaseId).first<{ handled_at_ms: number | null; handling_until_ms: number | null }>())!;

    // purchase_delivery game_server: the join hands the purchase to onPurchase, with its receipt, and marks it handled.
    const here = await join("delivered-here", "DLVRHR", undefined, await accountPass("delivered-here", "gdeliveredhere"));
    expect(await here.next()).toEqual({ type: "message", data: { bought: "purchase_deliveredhere1", itemName: "revive", itemCount: 3, purchaseStatus: "completed", hasReceipt: true }, fromPlayerId: null });
    let handled = await handledAt("purchase_deliveredhere1");
    for (let i = 0; i < 50 && handled.handled_at_ms === null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      handled = await handledAt("purchase_deliveredhere1");
    }
    expect(handled).toEqual({ handled_at_ms: expect.any(Number), handling_until_ms: null });
    // A game page's zaisma:purchase message makes the room look again, and it finds nothing to hand over twice.
    here.ws.send(JSON.stringify({ type: "zaisma:purchase", purchaseId: "purchase_deliveredhere1" }));
    here.say("ping");
    expect(await here.next()).toEqual({ type: "message", data: "pong", fromPlayerId: null });

    // purchase_delivery game (the default): the game's own page takes it, so the room's game server gets nothing.
    const there = await join("delivered-to-game", "DLVRTG", undefined, await accountPass("delivered-to-game", "gdeliveredtogame"));
    there.ws.send(JSON.stringify({ type: "zaisma:purchase", purchaseId: "purchase_deliveredgame1" }));
    there.say("ping");
    expect(await there.next()).toEqual({ type: "message", data: "pong", fromPlayerId: null });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await handledAt("purchase_deliveredgame1")).toEqual({ handled_at_ms: null, handling_until_ms: null });
    await e.DB.exec("DELETE FROM purchases; DELETE FROM accounts;");
  });

  /** A pass for an account in a sandbox game, as the game page gets it once the player is signed in. */
  async function accountPassFor(slug: string, accountId: string) {
    const roomKey = await issueRoomKey(e.DB, `g${slug.replace(/-/g, "")}`, accountId);
    return (await (await SELF.fetch(`${R}/v1/pass`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain", "cf-connecting-ip": `198.51.100.${++address % 250}` }, body: JSON.stringify({ gameSlug: slug, roomKey }) })).json<{ pass: string }>()).pass;
  }
  async function addGrantedPurchase(purchaseId: string, slug: string, playerId: string, createdAtMs: number) {
    await e.DB.prepare("INSERT INTO purchases (id, game_id, item_name, item_kind, item_count, player_id, purchase_source, purchase_status, created_at_ms, purchased_at_ms) VALUES (?, ?, 'revive', 'consumable', 1, ?, 'grant', 'completed', ?, ?)")
      .bind(purchaseId, `g${slug.replace(/-/g, "")}`, playerId, createdAtMs, createdAtMs)
      .run();
  }
  const handlingOf = async (purchaseId: string) =>
    (await e.DB.prepare("SELECT handled_at_ms, handling_until_ms, refund_handled_at_ms, refund_handling_until_ms FROM purchases WHERE id = ?").bind(purchaseId).first<{ handled_at_ms: number | null; handling_until_ms: number | null; refund_handled_at_ms: number | null; refund_handling_until_ms: number | null }>())!;
  const GAME_ASKING_PURCHASE_HANDLING = `export default {
  maximumPlayerCount: 4,
  setup: () => ({ isBroken: false }),
  onPurchase(state, player, room, purchase) {
    room.send(player.id, { kind: "purchase", id: purchase.id, purchaseStatus: purchase.purchaseStatus, isBroken: state.isBroken });
    if (state.isBroken) throw new Error("the shop is down");
  },
  onRefund(state, player, room, purchase) { room.send(player.id, { kind: "refund", id: purchase.id, purchaseStatus: purchase.purchaseStatus, hasRefundedAt: typeof purchase.refundedAt === "string" }); },
  onMessage(state, player, message, room) {
    if (message === "break") state.isBroken = true;
    if (message === "mend") state.isBroken = false;
    room.send(player.id, message === "ping" ? "pong" : "ok");
    return state;
  },
};`;

  it("hands a granted purchase to onPurchase on join and its take-back to onRefund on the next join, each once, and never tells a refund of what the game never got", async () => {
    await e.DB.exec("DELETE FROM purchases; DELETE FROM accounts;");
    await addSandboxGame("refund-desk", GAME_ASKING_PURCHASE_HANDLING);
    await e.DB.prepare("UPDATE games SET purchase_delivery = 'game_server' WHERE id = 'grefunddesk'").run();
    const account = await createAccount(e.DB, { id: "supabase-user-refunder", username: "Refund_Buyer", ageBand: "18+" });
    await addGrantedPurchase("purchase_refunddesk0001", "refund-desk", account.player_id, 1);
    await addGrantedPurchase("purchase_refunddesk0002", "refund-desk", account.player_id, 2);
    // The second was taken back before the game ever got it: there is nothing to take back in the game.
    expect(await takeBack(e.DB, "purchase_refunddesk0002", "refunded", Date.now())).toBe(true);

    const first = await join("refund-desk", "RFNDDK", undefined, await accountPassFor("refund-desk", account.id));
    expect(await first.next()).toEqual({ type: "message", data: { kind: "purchase", id: "purchase_refunddesk0001", purchaseStatus: "completed", isBroken: false }, fromPlayerId: null });
    await vi.waitFor(async () => expect(await handlingOf("purchase_refunddesk0001")).toMatchObject({ handled_at_ms: expect.any(Number), handling_until_ms: null }));
    first.say("ping");
    expect(await first.next()).toEqual({ type: "message", data: "pong", fromPlayerId: null });
    expect(await handlingOf("purchase_refunddesk0002")).toEqual({ handled_at_ms: null, handling_until_ms: null, refund_handled_at_ms: null, refund_handling_until_ms: null });

    // Taken back after the game had it: the next join hears onRefund, with the status and refundedAt, and marks it told.
    const handledAtMs = (await handlingOf("purchase_refunddesk0001")).handled_at_ms;
    expect(await takeBack(e.DB, "purchase_refunddesk0001", "refunded", Date.now())).toBe(true);
    first.ws.close(1000);
    const second = await join("refund-desk", "RFNDDK", undefined, await accountPassFor("refund-desk", account.id));
    expect(await second.next()).toEqual({ type: "message", data: { kind: "refund", id: "purchase_refunddesk0001", purchaseStatus: "refunded", hasRefundedAt: true }, fromPlayerId: null });
    await vi.waitFor(async () => expect(await handlingOf("purchase_refunddesk0001")).toMatchObject({ handled_at_ms: handledAtMs, refund_handled_at_ms: expect.any(Number), refund_handling_until_ms: null }));

    // Joining again hands over nothing: neither the purchase nor its refund twice, and the never-handed one stays untold.
    second.ws.close(1000);
    const third = await join("refund-desk", "RFNDDK", undefined, await accountPassFor("refund-desk", account.id));
    await new Promise((resolve) => setTimeout(resolve, 150));
    third.say("ping");
    expect(await third.next()).toEqual({ type: "message", data: "pong", fromPlayerId: null });
    expect(await handlingOf("purchase_refunddesk0002")).toEqual({ handled_at_ms: null, handling_until_ms: null, refund_handled_at_ms: null, refund_handling_until_ms: null });
    third.ws.close(1000);
    await e.DB.exec("DELETE FROM purchases; DELETE FROM accounts;");
  });

  it("lets go of a purchase whose onPurchase threw, leaving it unhandled and unleased, and hands it over again on the player's next join", async () => {
    await e.DB.exec("DELETE FROM purchases; DELETE FROM accounts;");
    await addSandboxGame("flaky-shop", GAME_ASKING_PURCHASE_HANDLING);
    await e.DB.prepare("UPDATE games SET purchase_delivery = 'game_server' WHERE id = 'gflakyshop'").run();
    const account = await createAccount(e.DB, { id: "supabase-user-retrier", username: "Retry_Buyer", ageBand: "18+" });
    await addGrantedPurchase("purchase_flakyshop0001", "flaky-shop", account.player_id, 1);
    // A guest keeps the room open and breaks the shop before the buyer joins.
    const keeper = await join("flaky-shop", "FLAKYS");
    keeper.say("break");
    expect(await keeper.next()).toEqual({ type: "message", data: "ok", fromPlayerId: null });

    const failing = await join("flaky-shop", "FLAKYS", undefined, await accountPassFor("flaky-shop", account.id));
    expect(await failing.next()).toEqual({ type: "message", data: { kind: "purchase", id: "purchase_flakyshop0001", purchaseStatus: "completed", isBroken: true }, fromPlayerId: null });
    await vi.waitFor(async () => expect((await handlingOf("purchase_flakyshop0001")).handling_until_ms).toBeNull());
    // Only after it let go does a retry have a chance, so the lease is checked before anything else happens.
    expect(await handlingOf("purchase_flakyshop0001")).toEqual({ handled_at_ms: null, handling_until_ms: null, refund_handled_at_ms: null, refund_handling_until_ms: null });

    keeper.say("mend");
    expect(await keeper.next()).toEqual({ type: "message", data: "ok", fromPlayerId: null });
    failing.ws.close(1000);
    const retrying = await join("flaky-shop", "FLAKYS", undefined, await accountPassFor("flaky-shop", account.id));
    expect(await retrying.next()).toEqual({ type: "message", data: { kind: "purchase", id: "purchase_flakyshop0001", purchaseStatus: "completed", isBroken: false }, fromPlayerId: null });
    await vi.waitFor(async () => expect(await handlingOf("purchase_flakyshop0001")).toMatchObject({ handled_at_ms: expect.any(Number), handling_until_ms: null }));
    keeper.ws.close(1000);
    retrying.ws.close(1000);
    await e.DB.exec("DELETE FROM purchases; DELETE FROM accounts;");
  });

  it("runs onPurchase once for a player across two rooms of the game, and not at all when the game's purchases go to its own server", async () => {
    await e.DB.exec("DELETE FROM purchases; DELETE FROM accounts;");
    await addSandboxGame("twin-rooms", GAME_ASKING_PURCHASE_HANDLING);
    await addSandboxGame("own-backend", GAME_ASKING_PURCHASE_HANDLING);
    await e.DB.exec("UPDATE games SET purchase_delivery = 'game_server' WHERE id = 'gtwinrooms'; UPDATE games SET purchase_delivery = 'own_server' WHERE id = 'gownbackend'");
    const account = await createAccount(e.DB, { id: "supabase-user-twin", username: "Twin_Buyer", ageBand: "18+" });
    await addGrantedPurchase("purchase_twinrooms0001", "twin-rooms", account.player_id, 1);
    await addGrantedPurchase("purchase_ownbackend001", "own-backend", account.player_id, 1);

    // A player plays in one room of a game at a time: the first room hands it over, and the next room the player
    // joins finds it handled and hands nothing over again.
    const heardIn = async (room: Awaited<ReturnType<typeof join>>) => {
      room.say("ping");
      const heard: unknown[] = [];
      for (let message = await room.next(); message.data !== "pong"; message = await room.next()) heard.push(message.data);
      return heard;
    };
    const inFirst = await join("twin-rooms", "TWINAA", undefined, await accountPassFor("twin-rooms", account.id));
    await vi.waitFor(async () => expect(await handlingOf("purchase_twinrooms0001")).toMatchObject({ handled_at_ms: expect.any(Number), handling_until_ms: null }));
    expect(await heardIn(inFirst)).toEqual([{ kind: "purchase", id: "purchase_twinrooms0001", purchaseStatus: "completed", isBroken: false }]);
    inFirst.ws.close(1000);
    const inSecond = await join("twin-rooms", "TWINBB", undefined, await accountPassFor("twin-rooms", account.id));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await heardIn(inSecond)).toEqual([]);
    inSecond.ws.close(1000);

    // purchase_delivery own_server: the developer's own backend marks it handled, so the room's game server never gets it.
    const own = await join("own-backend", "OWNBAK", undefined, await accountPassFor("own-backend", account.id));
    await new Promise((resolve) => setTimeout(resolve, 200));
    own.say("ping");
    expect(await own.next()).toEqual({ type: "message", data: "pong", fromPlayerId: null });
    expect(await handlingOf("purchase_ownbackend001")).toEqual({ handled_at_ms: null, handling_until_ms: null, refund_handled_at_ms: null, refund_handling_until_ms: null });
    own.ws.close(1000);
    await e.DB.exec("DELETE FROM purchases; DELETE FROM accounts;");
  });

  it("checks a purchase's receipt for its own game with room.verifyReceipt, and says why not for any other", async () => {
    await addSandboxGame(
      "ticket-booth",
      `export default {
  maximumPlayerCount: 4,
  setup: () => ({}),
  async onMessage(state, player, message, room) {
    const answer = await room.verifyReceipt(message).then((claims) => ({ purchaseId: claims.purchase_id, purchaseStatus: claims.purchase_status, itemName: claims.item_name }), (error) => ({ errorName: error.name, errorCode: error.code }));
    room.send(player.id, answer);
    return state;
  },
};`,
    );
    const receiptKey = await loadSigningKey(e.RECEIPT_SIGNING_KEY!);
    const player = await join("ticket-booth", "TKTBTH");
    player.say(await signTestReceipt(receiptKey, "ticket-booth", e.ISSUER));
    expect(await player.next()).toEqual({ type: "message", fromPlayerId: null, data: { purchaseId: "purchase_8f3k2m9q1x7c4v6b0n5z", purchaseStatus: "completed", itemName: "gold_crown" } });
    player.say(await signTestReceipt(receiptKey, "other-booth", e.ISSUER));
    expect(await player.next()).toEqual({ type: "message", fromPlayerId: null, data: { errorName: "ReceiptError", errorCode: "wrong_game" } });
    // A pass is refused as one, though receipt checks here hold only the receipt keys.
    player.say((await newPass("ticket-booth")).pass);
    expect(await player.next()).toEqual({ type: "message", fromPlayerId: null, data: { errorName: "ReceiptError", errorCode: "wrong_kind" } });
  });

  it("runs a real-time game server's input with its next tick, in order; one that throws doesn't stop the rest", async () => {
    await addSandboxGame(
      "fast-ticker",
      `export default {
  maximumPlayerCount: 100,
  ticksPerSec: 60,
  setup: () => ({ said: [], toldCount: 0 }),
  onMessage(state, player, message, room) {
    if (message === "bad") throw new Error("bad input");
    state.said.push(message);
  },
  onBytes(state, player, bytes, room) {
    state.said.push("bytes " + bytes.join(","));
  },
  onTick(state, tickDurationSec, room) {
    let work = 0;
    for (let i = 0; i < 200000; i++) work += i;
    if (state.said.length === state.toldCount) return;
    state.toldCount = state.said.length;
    room.broadcast({ said: state.said });
  },
};`,
    );
    const a = await join("fast-ticker", "TKRTKR");
    for (const said of ["one", "bad", "two"]) a.say(said);
    a.ws.send(new Uint8Array([4, 5]));
    let told: any;
    do told = await a.next();
    while (told.data.said.length < 3);
    expect(told.data.said).toEqual(["one", "two", "bytes 4,5"]);
    a.ws.close(1000);
    let use: any = null;
    for (let i = 0; i < 40 && !use; i++) {
      use = await e.DB.prepare("SELECT game_server_cpu_duration_ms, game_server_crash_count, message_count FROM room_usage WHERE game_id = 'gfastticker'").first();
      if (!use) await new Promise((r) => setTimeout(r, 25));
    }
    expect(use).toMatchObject({ game_server_crash_count: 1, message_count: 4 });
    expect(use.game_server_cpu_duration_ms).toBeGreaterThan(0);
    const error = await e.DB.prepare("SELECT message FROM game_server_errors WHERE game_id = 'gfastticker'").first<{ message: string }>();
    expect(error!.message).toContain("bad input");
  });

  it("lets the game's own server turn friends' Join off for its room, and read it back", async () => {
    await addSandboxGame(
      "hushed",
      `export default {
  setup: () => ({}),
  onMessage(state, player, message, room) {
    if (message === "private") room.setFriendJoinsEnabled(false);
    room.send(player.id, { friendJoinsEnabled: room.friendJoinsEnabled });
  },
};`,
    );
    const a = await join("hushed", "HSHD23");
    a.say("check");
    expect(await a.next()).toEqual({ type: "message", data: { friendJoinsEnabled: true }, fromPlayerId: null });
    a.say("private");
    expect(await a.next()).toEqual({ type: "message", data: { friendJoinsEnabled: false }, fromPlayerId: null });
    let row: { friend_joins_enabled: number } | null = null;
    for (let i = 0; i < 40 && row?.friend_joins_enabled !== 0; i++) {
      row = await e.DB.prepare("SELECT friend_joins_enabled FROM live_rooms WHERE room_code = 'HSHD23'").first();
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(row).toEqual({ friend_joins_enabled: 0 });
  });

  it("asks the room whether two players have a block between them, as a player's game says it made one", async () => {
    await addSandboxGame(
      "walled",
      `export default {
  setup: () => ({}),
  onMessage(state, player, message, room) {
    const other = room.players.find((each) => each.id !== player.id);
    if (message === "check" && other) room.send(player.id, { passesHaveBlockBetween: room.hasBlockBetween(player.id, other.id), passesAreFriends: room.areFriends(player.id, other.id) });
  },
};`,
    );
    const a = await join("walled", "WALLED");
    const b = await join("walled", "WALLED");
    a.say("check");
    expect(await a.next()).toEqual({ type: "message", data: { passesHaveBlockBetween: false, passesAreFriends: false }, fromPlayerId: null });
    a.ws.send(JSON.stringify({ type: "block", playerId: b.player.id }));
    b.say("check");
    expect(await b.next()).toEqual({ type: "message", data: { passesHaveBlockBetween: true, passesAreFriends: false }, fromPlayerId: null });
  });

  it("reads each player's ping and the room's clock", async () => {
    await addSandboxGame(
      "pinged",
      `export default {
  setup: () => ({}),
  onMessage(state, player, message, room) {
    room.send(player.id, { pingDurationMs: room.pingDurationMs(player.id), nobodyPingDurationMs: room.pingDurationMs("nobody"), serverTimeMs: room.serverTimeMs() });
  },
};`,
    );
    const a = await join("pinged", "PNGDRM");
    // The client answers its first probe as it arrives, just after welcome.
    let answer: any = null;
    for (let i = 0; i < 20 && typeof answer?.data.pingDurationMs !== "number"; i++) {
      if (i) await new Promise((r) => setTimeout(r, 20));
      a.say("ping?");
      answer = await a.next();
    }
    expect(typeof answer.data.pingDurationMs).toBe("number");
    expect(answer.data.nobodyPingDurationMs).toBeNull();
    expect(Math.abs(answer.data.serverTimeMs - Date.now())).toBeLessThan(1000);
  });

  it("hears a player whose connection dropped as away, lost, and back, with room.awayReason", async () => {
    await addSandboxGame(
      "dropper",
      `export default {
  reconnectTimeoutSec: 20,
  setup: () => ({}),
  onAway(state, player, room, reason) { room.broadcast({ away: player.id, reason, awayReason: room.awayReason(player.id) }); },
  onBack(state, player, room) { room.broadcast({ back: player.id, awayReason: room.awayReason(player.id) }); },
  onLeave(state, player, room) { room.broadcast({ left: player.id }); },
};`,
    );
    const a = await join("dropper", "DRPSBX");
    const b = await join("dropper", "DRPSBX");
    b.ws.close(3000);
    expect(await a.next()).toEqual({ type: "message", data: { away: b.player.id, reason: "lost", awayReason: "lost" }, fromPlayerId: null });
    const again = await join("dropper", "DRPSBX", undefined, b.pass);
    expect(await a.next()).toEqual({ type: "message", data: { back: b.player.id, awayReason: null }, fromPlayerId: null });
    a.ws.close(1000);
    again.ws.close(1000);
  });

  it("sends each player their view of the state from the sandbox: a full copy, then what changed", async () => {
    await addSandboxGame(
      "cards",
      `export default {
  stateSyncEnabled: true,
  setup: () => ({ turn: 0, hands: {} }),
  onJoin(state, player) { state.hands[player.id] = ["A", "K"]; },
  onMessage(state, player, message) { if (message === "draw") state.hands[player.id].push("Q"); },
  stateView: (state, viewer, room) => ({ myHand: state.hands[viewer.id] || [], cardCounts: Object.fromEntries(Object.entries(state.hands).map(([id, hand]) => [id, hand.length])), players: room.players.length }),
};`,
    );
    const a = await join("cards", "CARDSA");
    expect(await a.nextState()).toEqual({ type: "state", full: { myHand: ["A", "K"], cardCounts: { [a.player.id]: 2 }, players: 1 } });
    const b = await join("cards", "CARDSA");
    expect(await b.nextState()).toEqual({ type: "state", full: { myHand: ["A", "K"], cardCounts: { [a.player.id]: 2, [b.player.id]: 2 }, players: 2 } });
    expect(await a.nextState()).toEqual({ type: "state", changes: [[["cardCounts", b.player.id], 2], [["players"], 2]] });
    b.say("draw");
    // A never sees B's cards, only how many he holds.
    expect(await a.nextState()).toEqual({ type: "state", changes: [[["cardCounts", b.player.id], 3]] });
    expect(await b.nextState()).toEqual({ type: "state", changes: [[["myHand"], ["A", "K", "Q"]], [["cardCounts", b.player.id], 3]] });
    // B's game connects again: a turn-based room has no tick, so the sandbox sends his copy at once.
    const again = await join("cards", "CARDSA", undefined, b.pass);
    expect(await again.nextState()).toEqual({ type: "state", full: { myHand: ["A", "K", "Q"], cardCounts: { [a.player.id]: 2, [b.player.id]: 3 }, players: 2 } });
  });

  it("sends a real-time game's state after its ticks, even without onTick", async () => {
    await addSandboxGame("drifter", `export default { ticksPerSec: 20, stateSyncEnabled: true, setup: () => ({ x: 0 }), onTick(state) { state.x++; } };`);
    const a = await join("drifter", "DRFTAB");
    const first = await a.nextState();
    expect(first).toMatchObject({ type: "state", full: { x: expect.any(Number) } });
    expect(await a.nextState()).toEqual({ type: "state", changes: [[["x"], first.full.x + 1]] });
    await addSandboxGame("still", `export default { ticksPerSec: 20, stateSyncEnabled: true, setup: () => ({ map: "docks" }) };`);
    const b = await join("still", "STLLAB");
    expect(await b.nextState()).toEqual({ type: "state", full: { map: "docks" } });
  });

  it("takes latest-only sends from the sandbox, and throws in the game's handler on a delivery it doesn't take", async () => {
    await addSandboxGame(
      "aimer",
      `export default {
  setup: () => ({}),
  onMessage(state, player, message, room) {
    if (message === "bad") room.broadcast({ type: "aim" }, { delivery: "lossy" });
    else if (message === "keyless") room.broadcast({ type: "aim" }, { delivery: "latest_only" });
    else if (message === "keyless-code") { try { room.broadcast({ type: "aim" }, { delivery: "latest_only" }); } catch (error) { room.broadcast({ type: "caught", code: error.code }); } }
    else room.broadcast({ type: "aim", angle: message }, { delivery: "latest_only", latestKey: "aim" });
  },
};`,
    );
    const a = await join("aimer", "AMRAAB");
    a.say("bad");
    a.say("keyless");
    // The error reaches the game's code with the same code RoomCore gives it.
    a.say("keyless-code");
    expect(await a.next()).toEqual({ type: "message", data: { type: "caught", code: "bad_option" }, fromPlayerId: null });
    a.say(45);
    expect(await a.next()).toEqual({ type: "message", data: { type: "aim", angle: 45 }, fromPlayerId: null });
    a.ws.close(1000);
    let error: { message: string } | null = null;
    for (let i = 0; i < 40 && !error; i++) {
      error = await e.DB.prepare("SELECT message FROM game_server_errors WHERE game_id = 'gaimer' AND message LIKE '%lossy%'").first<{ message: string }>();
      if (!error) await new Promise((r) => setTimeout(r, 25));
    }
    expect(error!.message).toContain('room.broadcast\'s delivery is "lossy". Give "reliable" (the default) or "latest_only".');
    // latest_only has no default key: the game's handler throws and says what to give.
    let keyless: { message: string } | null = null;
    for (let i = 0; i < 40 && !keyless; i++) {
      keyless = await e.DB.prepare("SELECT message FROM game_server_errors WHERE game_id = 'gaimer' AND message LIKE '%no latestKey%'").first<{ message: string }>();
      if (!keyless) await new Promise((r) => setTimeout(r, 25));
    }
    expect(keyless!.message).toContain("latest_only needs a latestKey");
  });

  it("ticks", async () => {
    await addSandboxGame(
      "ticker",
      `export default { ticksPerSec: 20, setup: () => ({ tickCount: 0 }), onTick(state, tickDurationSec, room) { state.tickCount++; if (state.tickCount === 3) room.broadcast({ tickCount: state.tickCount, isTimed: tickDurationSec > 0 }); return state; } };`,
    );
    const a = await join("ticker", "ABCDEF");
    expect((await a.next()).data).toEqual({ tickCount: 3, isTimed: true });
  });

  it("brings a real-time match back with its saved state after the room restarts, a few seconds behind", async () => {
    await addSandboxGame(
      "restarter",
      `export default {
  ticksPerSec: 20,
  stateSaveIntervalSec: 1,
  setup: () => ({ tickCount: 0, restored: null }),
  onTick(state) { state.tickCount++; },
  onRestored(state, restoreInfo, room) { state.restored = { ...restoreInfo, awayReasons: room.players.map((player) => room.awayReason(player.id)) }; },
  onMessage(state, player, message, room) { if (message === "how") room.send(player.id, { tickCount: state.tickCount, restored: state.restored }); },
  onBack(state, player, room) { room.broadcast({ back: player.id }); },
};`,
    );
    const a = await join("restarter", "RSTRTS");
    const stub = e.ROOMS.get(e.ROOMS.idFromName("restarter:RSTRTS"));
    // Saved within a second or so: the state as JSON, in chunks, with the players in the match.
    let saved: any;
    for (let tries = 0; tries < 50 && !saved?.stateChunkCount; tries++) {
      await new Promise((r) => setTimeout(r, 100));
      saved = await runInDurableObject(stub, (_room: Room, state) => state.storage.get("saved"));
    }
    expect(saved).toMatchObject({ stateChunkCount: 1, matchPlayers: [{ id: a.player.id }] });
    const savedState = JSON.parse((await runInDurableObject(stub, (_room: Room, state) => state.storage.get<string>("stateChunk:0")))!);
    expect(savedState.tickCount).toBeGreaterThan(0);

    // A restart, as every rooms deploy does: the object goes, with its sockets and what it had in memory.
    await runInDurableObject(stub, (_room: Room, state) => state.abort("restart")).catch(() => {});
    const back = await join("restarter", "RSTRTS", undefined, a.pass);
    // Coming back is a rejoin: onBack, not onJoin.
    expect(await back.next()).toEqual({ type: "message", data: { back: a.player.id }, fromPlayerId: null });
    back.say("how");
    const how = (await back.next()).data;
    // The match carries on from the save: not from setup, and it was told how much was lost, with its player away until they're back.
    expect(how.tickCount).toBeGreaterThanOrEqual(savedState.tickCount);
    expect(how.restored).toMatchObject({ savedAt: new Date(saved.savedAtMs).toISOString(), awayReasons: ["lost"] });
    expect(how.restored.lostDurationSec).toBeGreaterThanOrEqual(0);
    back.ws.close(1000);
  });

  it("keeps the game server off hosts its game doesn't list, away from our data, and within its limits", async () => {
    await addSandboxGame("hostile", COUNTER);
    const a = await join("hostile", "ABCDEF");
    await a.next(); // hi

    // The game lists no hosts, so the fetch is refused and nothing is broadcast (test/rooms/reach.test.ts has the rest).
    a.say("fetch");
    // Nothing of ours inside the sandbox: no bindings or data, only the flag that says it runs in Zaisma rooms (checkChat reads it).
    a.say("who");
    expect((await a.next()).data).toEqual({ globals: "undefined", keys: ["isZaismaRoomsSandbox"] });

    // A crash loses that one message; the room and its state carry on. (So does a loop that never
    // ends, cut off by the CPU limit, but only Cloudflare enforces that: locally it would hang the test.)
    a.say("crash");
    a.say("add");
    expect((await a.next()).data).toEqual({ count: 1 });
  });

  it("records the game server's work and errors for its developer, saying where in the file", async () => {
    await addSandboxGame("oops", COUNTER);
    const a = await join("oops", "ABCDEF");
    await a.next(); // hi
    a.say("crash");
    a.say("crash");
    a.say("add");
    expect((await a.next()).data).toEqual({ count: 1 });
    a.ws.close(1000);
    let row: any = null;
    for (let i = 0; i < 50 && !row; i++) {
      row = await e.DB.prepare("SELECT * FROM room_usage WHERE game_id = 'goops'").first();
      if (!row) await new Promise((r) => setTimeout(r, 20));
    }
    expect(row).toMatchObject({ room_count: 1, game_server_crash_count: 2, game_server_stopped_count: 0, game_server_ended_match_count: 0 });
    expect(row.game_server_call_count).toBeGreaterThanOrEqual(5);
    const err = await e.DB.prepare("SELECT kind, message, occurrence_count, version_id FROM game_server_errors WHERE game_id = 'goops'").first();
    expect(err).toMatchObject({ kind: "crash", occurrence_count: 2, version_id: "voops" });
    expect(err!.message).toMatch(/^oops \(zaisma-server\.js:\d+:\d+\)$/);
  });

  it("writes a new error within a minute of the game server hitting it, without waiting for the hourly check-in", async () => {
    await addSandboxGame("soon", COUNTER);
    const a = await join("soon", "ABCDEF");
    await a.next(); // hi
    a.say("crash");
    a.say("add");
    expect((await a.next()).data).toEqual({ count: 1 });
    const stub = e.ROOMS.get(e.ROOMS.idFromName("soon:ABCDEF"));
    // The room checked in just now, so the next hourly check-in is an hour away.
    await runInDurableObject(stub, (room: Room) => {
      (room as any).checkedInAtMs = Date.now();
      expect((room as any).hasUnrecordedError).toBe(true);
    });
    expect(await e.DB.prepare("SELECT kind FROM game_server_errors WHERE game_id = 'gsoon'").first()).toBeNull();
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await e.DB.prepare("SELECT kind, message, occurrence_count FROM game_server_errors WHERE game_id = 'gsoon'").first()).toMatchObject({ kind: "crash", occurrence_count: 1, message: expect.stringMatching(/^oops /) });
    a.ws.close(1000);
  });

  it("runs the game server's onEnding once the game's hosting pauses, with room.endsAt", async () => {
    await addSandboxGame(
      "closing",
      `export default {
  setup: () => ({ endingCount: 0 }),
  onJoin(state, player, room) { room.send(player.id, { endsAt: room.endsAt }); },
  onEnding(state, room) { state.endingCount++; room.broadcast({ endsAt: room.endsAt, endingCount: state.endingCount }); return state; },
};`,
    );
    const a = await join("closing", "ABCDEF");
    expect(await a.next()).toEqual({ type: "message", data: { endsAt: null }, fromPlayerId: null });
    await e.DB.prepare("INSERT INTO game_hosting_months (game_id, month_start_date, used_cents, paused_at_ms, paused_reason) VALUES ('gclosing', ?, 500, ?, 'free_used')").bind(monthStartDateOf(), Date.now()).run();
    // Make the room's 5-minute check on the game's hosting due now.
    const stub = e.ROOMS.get(e.ROOMS.idFromName("closing:ABCDEF"));
    await runInDurableObject(stub, (room: Room) => {
      (room as any).hostingCheckedAtMs = 0;
    });
    await runDurableObjectAlarm(stub);
    const ending = await a.next();
    expect(ending.type).toBe("ending");
    expect(Date.parse(ending.endsAt) - Date.now()).toBeGreaterThan(3500_000);
    expect(await a.next()).toEqual({ type: "message", data: { endsAt: ending.endsAt, endingCount: 1 }, fromPlayerId: null });
    a.ws.close(1000);
  });

  it("lets spectators watch: onSpectatorJoin, room.spectators and audience reach the game's own server, and spectators can't send", async () => {
    await addSandboxGame(
      "arena",
      `export default {
        maximumPlayerCount: 2,
        maximumSpectatorCount: 5,
        setup: () => ({}),
        onJoin(state, player, room) { room.send(player.id, { hi: player.name }); },
        onSpectatorJoin(state, spectator, room) { room.send(spectator.id, { watching: room.spectators.length, players: room.players.length }); },
        onMessage(state, player, message, room) {
          if (message === "all") room.broadcast({ to: "everyone" });
          if (message === "players") room.broadcast({ to: "players" }, { audience: "players" });
          if (message === "spectators") room.broadcast({ to: "spectators" }, { audience: "spectators" });
        },
      };`,
    );
    // Nobody's playing yet: there's nothing to watch, and a spectator never starts a room.
    const early = await SELF.fetch(`${R}/v1/rooms/arena/WATCHA`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `198.51.100.${++address % 250}` } });
    const earlySocket = early.webSocket!;
    earlySocket.accept();
    const earlyAnswer = new Promise<any>((r) => earlySocket.addEventListener("message", (ev) => r(JSON.parse(ev.data as string)), { once: true }));
    earlySocket.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass: (await newPass("arena")).pass, isSpectator: true }));
    expect(await earlyAnswer).toMatchObject({ type: "error", code: "room_not_running" });

    const a = await join("arena", "WATCHA");
    expect((await a.next()).data).toEqual({ hi: a.player.name });
    const watcher = await join("arena", "WATCHA", undefined, undefined, true);
    expect((await watcher.next()).data).toEqual({ watching: 1, players: 1 });
    a.say("all");
    a.say("players");
    a.say("spectators");
    expect((await watcher.next()).data).toEqual({ to: "everyone" });
    expect((await watcher.next()).data).toEqual({ to: "spectators" });
    expect((await a.next()).data).toEqual({ to: "everyone" });
    expect((await a.next()).data).toEqual({ to: "players" });
    watcher.say("hello");
    expect(await watcher.next()).toMatchObject({ type: "error", code: "spectator_cannot_send" });
  });

  it("passes a player's message on with fromPlayerId, from send and broadcast, and knows its room code", async () => {
    await addSandboxGame(
      "passer",
      `export default {
  maximumPlayerCount: 3,
  setup: () => ({}),
  onMessage(state, player, message, room) {
    const other = room.players.find((each) => each.id !== player.id);
    if (message === "pass") {
      room.send(other.id, { how: "send", roomCodeType: typeof room.roomCode }, { fromPlayerId: player.id });
      room.broadcast({ how: "broadcast", roomCode: room.roomCode }, { exceptPlayerId: player.id, fromPlayerId: player.id });
    }
    return state;
  },
};`,
    );
    const a = await join("passer", "PASSAA");
    const b = await join("passer", "PASSAA");
    a.say("pass");
    expect(await b.next()).toEqual({ type: "message", data: { how: "send", roomCodeType: "string" }, fromPlayerId: a.player.id });
    expect(await b.next()).toEqual({ type: "message", data: { how: "broadcast", roomCode: "PASSAA" }, fromPlayerId: a.player.id });
  });

  it("won't start a game server with an option it doesn't take, and tells its developer which ones it does", async () => {
    await addSandboxGame("old-names", `export default { tickRate: 20, setup: () => ({}) };`);
    const up = await SELF.fetch(`${R}/v1/rooms/old-names/ABCDEF`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `198.51.100.${++address % 250}` } });
    // Turned away on the socket, saying why, since a browser never sees an HTTP status on a WebSocket.
    expect(up.status).toBe(101);
    const turnedAway = new Promise<any>((resolve) => up.webSocket!.addEventListener("message", (ev) => resolve(JSON.parse(ev.data as string)), { once: true }));
    up.webSocket!.accept();
    // The game's own code won't start: unavailable until a new version, not busy.
    expect(await turnedAway).toMatchObject({ type: "error", code: "game_unavailable" });
    const err = await e.DB.prepare("SELECT kind, message, occurrence_count, version_id FROM game_server_errors WHERE game_id = 'goldnames'").first<{ message: string }>();
    expect(err).toMatchObject({ kind: "crash", occurrence_count: 1, version_id: "voldnames" });
    // Errors are kept to 600 characters, which keeps the whole list of options.
    expect(err!.message).toMatch(
      /^Didn't start: tickRate isn't a game server option\. A game server takes: maximumPlayerCount, maximumSpectatorCount, ticksPerSec, hostControlsEnabled, idleCheck, idleTimeoutSec, awayMode, seatHoldDurationSec, stateSyncEnabled, reconnectTimeoutSec, stateSaveIntervalSec, setup, onJoin, canJoin, onMoved, onLeave, onSpectatorJoin, onSpectatorLeave, onAway, onBack, onMessage, onBytes, onPurchase, onRefund, onTick, onEnding, onRestored, stateView, onVersionUpdate, onRequest, schedules, onSchedule, onWebhook\./,
    );
  });

  it("turns a player away when canJoin answers a string, and tells the developer what to answer instead", async () => {
    // A string used to mean "no, with this reason": a truthy "no" an AI could write meaning yes.
    await addSandboxGame("texty", `export default { setup: () => ({}), canJoin() { return "Welcome!"; } };`);
    expect(await knock("texty", "ABCDEF")).toEqual({ type: "error", code: "refused", message: "The game didn't let you into this room." });
    // Recorded at once, though nobody ever gets in for the room to empty.
    let row: { kind: string; message: string } | null = null;
    for (let i = 0; i < 50 && !row; i++) {
      row = await e.DB.prepare("SELECT kind, message FROM game_server_errors WHERE game_id = 'gtexty'").first<{ kind: string; message: string }>();
      if (!row) await new Promise((r) => setTimeout(r, 20));
    }
    expect(row).toMatchObject({ kind: "crash" });
    expect(row!.message).toContain('canJoin answered the text "Welcome!", so the player was turned away. Answer true (or nothing) to let them in');
  });

  it("waits for an async canJoin, and lets in a player when it answers nothing", async () => {
    await addSandboxGame("asyncy", `export default { setup: () => ({}), async canJoin(state, player, room, joinData) { if (!joinData) return { refusalMessage: "Pick a team." }; }, onJoin(state, player, room, joinData) { room.send(player.id, joinData); } };`);
    expect(await knock("asyncy", "ABCDEF")).toEqual({ type: "error", code: "refused", message: "Pick a team." });
    const a = await join("asyncy", "ABCDEF", { team: "red" });
    expect((await a.next()).data).toEqual({ team: "red" });
  });

  it("runs a game server split into files in a zaisma-server/ folder", async () => {
    await addSandboxGame("split", COUNTER);
    await e.GAMES.delete("games/vsplit/zaisma-server.js");
    await e.GAMES.put("games/vsplit/zaisma-server/index.js", `import { greet } from "./lib/words.js";\nexport default { setup: () => ({}), onJoin(state, player, room) { room.send(player.id, greet(player.name)); } };`);
    await e.GAMES.put("games/vsplit/zaisma-server/lib/words.js", `export const greet = (name) => "Hello " + name;`);
    const a = await join("split", "ABCDEF");
    expect((await a.next()).data).toBe(`Hello ${a.player.name}`);
  });

  it("loads data and WebAssembly from the folder", async () => {
    await addSandboxGame("wasm", COUNTER);
    await e.GAMES.delete("games/vwasm/zaisma-server.js");
    // A tiny WebAssembly module whose answer() returns 42.
    const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0, 7, 10, 1, 6, 97, 110, 115, 119, 101, 114, 0, 0, 10, 6, 1, 4, 0, 65, 42, 11]);
    await e.GAMES.put("games/vwasm/zaisma-server/answer.wasm", wasm);
    await e.GAMES.put("games/vwasm/zaisma-server/levels.json", JSON.stringify({ first: "Docks" }));
    await e.GAMES.put(
      "games/vwasm/zaisma-server/index.js",
      `import mod from "./answer.wasm";\nimport levels from "./levels.json";\nconst wasm = new WebAssembly.Instance(mod);\nexport default { setup: () => ({}), onJoin(state, player, room) { room.send(player.id, { answer: wasm.exports.answer(), level: levels.first }); } };`,
    );
    const a = await join("wasm", "ABCDEF");
    expect((await a.next()).data).toEqual({ answer: 42, level: "Docks" });
  });

  it("lets the game's own server turn players away and kick them, keeping kicked players out", async () => {
    await addSandboxGame(
      "guarded",
      `export default {
        setup: () => ({}),
        canJoin(state, player, room, joinData) { return (joinData && joinData.password === "docks") || { refusalMessage: "Wrong password." }; },
        onMessage(state, player, message, room) {
          const other = room.players.find((p) => p.id !== player.id);
          if (message === "kick" && other) room.kick(other.id, { message: "Too rough.", keepOut: true });
          if (message === "out") room.kick(player.id);
        },
      };`,
    );
    const turnedAway = await knock("guarded", "ABCDEF", { password: "nope" });
    expect(turnedAway).toEqual({ type: "error", code: "refused", message: "Wrong password." });

    const a = await join("guarded", "ABCDEF", { password: "docks" });
    const b = await join("guarded", "ABCDEF", { password: "docks" });
    a.say("kick");
    expect(await b.next()).toEqual({ type: "kicked", message: "Too rough.", isKeptOut: true });

    // Kept out, even with the password and a fresh connection under the same pass.
    const again = await knock("guarded", "ABCDEF", { password: "docks" }, b.pass);
    expect(again).toEqual({ type: "error", code: "kept_out", message: "Too rough." });

    // Kicking the last player empties the room like everyone leaving: it drops out of the room list.
    expect(await e.DB.prepare("SELECT player_count FROM live_rooms WHERE game_id = 'gguarded'").first()).toEqual({ player_count: 1 });
    a.say("out");
    expect(await a.next()).toEqual({ type: "kicked", message: "You were removed from this room.", isKeptOut: false });
    let row: unknown = {};
    for (let i = 0; i < 50 && row; i++) {
      row = await e.DB.prepare("SELECT player_count FROM live_rooms WHERE game_id = 'gguarded'").first();
      if (row) await new Promise((r) => setTimeout(r, 20));
    }
    expect(row).toBeNull();
  });

  it("moves players to another room that's already running, which can say no", async () => {
    await addSandboxGame(
      "world",
      `export default {
        setup: () => ({ locked: false }),
        canJoin(state, player, room, joinData, joinInfo) { return !(state.locked && joinInfo.fromRoomCode) || { refusalMessage: "This area is locked." }; },
        onJoin(state, player, room, joinData, joinInfo) { if (joinInfo.fromRoomCode) room.send(player.id, { arrived: joinData, fromRoomCode: joinInfo.fromRoomCode }); },
        onMessage(state, player, message, room) {
          if (message === "lock") state.locked = true;
          if (typeof message === "string" && message.startsWith("go ")) room.moveTo(message.slice(3), { playerIds: [player.id], joinData: { door: "north" } });
          return state;
        },
        onMoved(state, moveResult, room) {
          for (const refusal of moveResult.refusals) room.send(refusal.player.id, { stayed: refusal.message, code: refusal.code });
        },
      };`,
    );
    const forest = await join("world", "FRSTAA");
    const town = await join("world", "TWNAAA");
    town.say("go FRSTAA");
    expect(await town.next()).toEqual({ type: "move", roomCode: "FRSTAA" });

    // Same pass, the forest room: it gets the town's join data, not anything the browser sends.
    expect(await arrive("world", "FRSTAA", { door: "cheat" }, town.pass)).toEqual({ type: "message", data: { arrived: { door: "north" }, fromRoomCode: "TWNAAA" }, fromPlayerId: null });

    // A room that's locked, and one that isn't running, both say no; the player stays put.
    forest.say("lock");
    const other = await join("world", "THRDAA");
    other.say("go FRSTAA");
    expect(await other.next()).toEqual({ type: "message", data: { stayed: "This area is locked.", code: "refused" }, fromPlayerId: null });
    other.say("go ZZZZZZ");
    expect(await other.next()).toEqual({ type: "message", data: { stayed: "That room isn't running.", code: "room_not_running" }, fromPlayerId: null });
  });

  it("leaves a game without a game server file unavailable", async () => {
    await addSandboxGame("empty", COUNTER);
    await e.GAMES.delete("games/vempty/zaisma-server.js");
    const up = await SELF.fetch(`${R}/v1/rooms/empty/ABCDEF`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `198.51.100.${++address % 250}` } });
    expect(up.status).toBe(101);
    const turnedAway = new Promise<any>((resolve) => up.webSocket!.addEventListener("message", (ev) => resolve(JSON.parse(ev.data as string)), { once: true }));
    up.webSocket!.accept();
    expect(await turnedAway).toMatchObject({ type: "error", code: "game_unavailable" });
  });
});

/** A stand-in for a session with a real-time game server: it keeps its state, as the sandbox does, and counts what it's asked. */
function tickingSession(asked: { method: string; queued?: any[]; roomChanges?: any }[], failing: { isFailing: boolean }) {
  let state: any;
  return {
    settings: async () => ({ optionNames: ["ticksPerSec", "setup", "onMessage", "onTick"], ticksPerSec: 10, handlerNames: ["setup", "onMessage", "onTick"] }),
    setup: async () => ((state = { tickCount: 0, said: [] as string[] }), { state, effects: [] }),
    call: async (hook: string, _handlerArguments: unknown[], roomChanges: unknown, _given: unknown, queued: any[]) => {
      asked.push({ method: `call ${hook}`, queued, roomChanges });
      return { effects: [] };
    },
    tick: async (queued: any[], _tickDurationSec: number, roomChanges: unknown) => {
      asked.push({ method: "tick", queued, roomChanges });
      if (failing.isFailing) throw new Error("Worker exceeded CPU time limit.");
      for (const input of queued) state.said.push(input.payload);
      state.tickCount++;
      return { effects: [] };
    },
    stateCopy: async () => structuredClone(state),
    restore: async (copy: unknown) => {
      asked.push({ method: "restore" });
      state = copy;
    },
  };
}

const ROOM = { players: [], spectators: [], isListed: true, isOpen: true, friendJoinsEnabled: true, name: null, labels: {}, endsAt: null, pingDurationMs: () => null, awayReason: () => null, passesHaveBlockBetween: () => false, passesAreFriends: () => false, serverTimeMs: () => Date.now() } as never;
const PLAYER = { id: "player_a", name: "A", kind: "guest" as const };

describe("a game server whose sandbox keeps failing", () => {
  it("gets a fresh session after a failure that carries on from the last copy, and gives up after the second", async () => {
    const { wrapSession } = await import("../../apps/rooms/src/sandbox.ts");
    const asked: { method: string }[] = [];
    const failing = { isFailing: false };
    let opened = 0;
    let broken = 0;
    const server = await wrapSession(async () => (opened++, tickingSession(asked, failing) as never), () => broken++);
    await server.setup!(null);
    await server.onTick!(undefined, 0.1, ROOM);
    await server.onTick!(undefined, 0.1, ROOM);
    expect(await server.stateCopy()).toMatchObject({ tickCount: 2 });
    await server.onTick!(undefined, 0.1, ROOM);
    failing.isFailing = true;
    await expect(server.onTick!(undefined, 0.1, ROOM)).rejects.toThrow("CPU time limit");
    expect([opened, broken]).toEqual([2, 0]);
    // The fresh session starts from the copy, two ticks in: the third tick since is lost, not the match.
    failing.isFailing = false;
    asked.length = 0;
    await server.onTick!(undefined, 0.1, ROOM);
    expect(asked.map((each) => each.method)).toEqual(["restore", "tick"]);
    expect(await server.stateCopy()).toMatchObject({ tickCount: 3 });
    failing.isFailing = true;
    await expect(server.onTick!(undefined, 0.1, ROOM)).rejects.toThrow("CPU time limit");
    expect([opened, broken]).toEqual([2, 1]);
    // From then on it fails at once, without asking the sandbox again.
    failing.isFailing = false;
    await expect(server.onTick!(undefined, 0.1, ROOM)).rejects.toThrow("stopped working");
    expect(server.stats.failureCount).toBe(2);
  });
});

describe("a real-time game server in the sandbox", () => {
  it("gets the messages since the last tick with the tick, in one call and in order", async () => {
    const { wrapSession } = await import("../../apps/rooms/src/sandbox.ts");
    const asked: { method: string; queued?: any[] }[] = [];
    const server = await wrapSession(async () => tickingSession(asked, { isFailing: false }) as never, () => {});
    await server.setup!(null);
    for (const said of ["one", "two", "three"]) expect(server.onMessage!(undefined, PLAYER, said, ROOM)).toBeUndefined();
    expect(asked).toEqual([]);
    await server.onTick!(undefined, 1 / 60, ROOM);
    expect(asked.map((each) => [each.method, each.queued!.map((input) => input.payload)])).toEqual([["tick", ["one", "two", "three"]]]);
    expect(await server.stateCopy()).toMatchObject({ said: ["one", "two", "three"], tickCount: 1 });
    // Messages that came before a join go first, with the join's call.
    server.onMessage!(undefined, PLAYER, "four", ROOM);
    await server.onJoin!(undefined, PLAYER, ROOM, null, { fromRoomCode: null, isReturning: false, isSpectator: false });
    expect(asked.at(-1)).toMatchObject({ method: "call onJoin", queued: [{ hook: "onMessage", payload: "four" }] });
    expect(server.stats.callCount).toBe(3);
  });

  it("sends only what changed in the room since the last call", async () => {
    const { wrapSession } = await import("../../apps/rooms/src/sandbox.ts");
    const { RoomCore } = await import("@zaisma/game-server");
    const asked: { method: string; roomChanges?: any }[] = [];
    const server = await wrapSession(async () => tickingSession(asked, { isFailing: false }) as never, () => {});
    const core = new RoomCore(server, { roomCode: "K7Q2MX", send: () => {}, close: () => {} });
    await core.settled();
    core.join({ id: "player_a", name: "A", kind: "account" });
    core.join({ id: "player_b", name: "B", kind: "account" });
    await core.settled();
    core.tick(0.1);
    await core.settled();
    // The second join's call had the players; the tick after it, nothing new but the clock.
    expect(Object.keys(asked.at(-1)!.roomChanges)).toEqual(["serverTimeMs"]);
    core.setFriends("player_a", ["player_b"]);
    core.tick(0.1);
    await core.settled();
    expect(asked.at(-1)!.roomChanges).toMatchObject({ friendPairs: [["player_a", "player_b"]], blockPairs: [] });
    core.tick(0.1);
    await core.settled();
    expect(asked.at(-1)!.roomChanges.friendPairs).toBeUndefined();
  });
});

describe("a game server's new errors", () => {
  it("are new once a session, even after the room recorded them", async () => {
    const { wrapSession } = await import("../../apps/rooms/src/sandbox.ts");
    let message = "boom";
    const session = {
      settings: async () => ({ optionNames: ["setup", "onTick"], handlerNames: ["setup", "onTick"] }),
      setup: async () => ({ state: {}, effects: [] }),
      call: async (_hook: string, state: unknown) => ({ state, effects: [], error: `Error: ${message}` }),
    };
    let newErrorCount = 0;
    const server = await wrapSession(async () => session as never, () => {}, {}, () => newErrorCount++);
    const room = { players: [], spectators: [], isListed: true, isOpen: true, name: null, labels: {}, endsAt: null , serverTimeMs: () => Date.now() } as never;
    await expect(server.onTick!({}, 0.1, room)).rejects.toThrow("boom");
    await expect(server.onTick!({}, 0.1, room)).rejects.toThrow("boom");
    expect(newErrorCount).toBe(1);
    // The room recorded them (recordUsage empties the list): the same error again isn't new.
    server.stats.errors.clear();
    await expect(server.onTick!({}, 0.1, room)).rejects.toThrow("boom");
    expect(newErrorCount).toBe(1);
    message = "another";
    await expect(server.onTick!({}, 0.1, room)).rejects.toThrow("another");
    expect(newErrorCount).toBe(2);
  });
});

describe("spectators in Zaisma rooms", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM room_usage; DELETE FROM live_rooms; DELETE FROM versions; DELETE FROM games;");
    await addSandboxGame("watched", "export default { maximumPlayerCount: 2, maximumSpectatorCount: 7, setup: () => ({}), onMessage() {} };");
  });

  /** The game's row in a table once it matches, waiting for the room to write it. */
  async function rowOnce(sql: string, isWanted: (row: any) => boolean): Promise<any> {
    let row: any = null;
    for (let i = 0; i < 50; i++) {
      row = await e.DB.prepare(sql).bind("gwatched").first();
      if (row && isWanted(row)) return row;
      await new Promise((r) => setTimeout(r, 20));
    }
    return row;
  }

  it("needs a valid pass to watch, like playing", async () => {
    await join("watched", "WTCHPS");
    const up = await SELF.fetch(`${R}/v1/rooms/watched/WTCHPS`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `198.51.100.${++address % 250}` } });
    const ws = up.webSocket!;
    ws.accept();
    const answer = new Promise<any>((r) => ws.addEventListener("message", (ev) => r(JSON.parse(ev.data as string)), { once: true }));
    ws.send(JSON.stringify({ type: "hello", protocolVersionNumber: 1, pass: "not a pass", isSpectator: true }));
    expect(await answer).toMatchObject({ type: "error", code: "bad_pass" });
  });

  it("counts spectators in the room's row apart from its players, and watching isn't player time", async () => {
    const player = await join("watched", "WTCHRW");
    const watcher = await join("watched", "WTCHRW", undefined, undefined, true);
    expect(await rowOnce("SELECT * FROM live_rooms WHERE game_id = ?", (row) => row.spectator_count === 1)).toMatchObject({ player_count: 1, spectator_count: 1, maximum_spectator_count: 7 });
    // As if the spectator had watched for an hour.
    await runInDurableObject(e.ROOMS.get(e.ROOMS.idFromName("watched:WTCHRW")), (_room: Room, state) => {
      for (const socket of state.getWebSockets()) {
        const attachment = socket.deserializeAttachment();
        if (attachment?.isSpectator) socket.serializeAttachment({ ...attachment, joinedAtMs: Date.now() - 3600_000 });
      }
    });
    watcher.ws.close(1000);
    expect(await rowOnce("SELECT * FROM live_rooms WHERE game_id = ?", (row) => row.spectator_count === 0)).toMatchObject({ player_count: 1, spectator_count: 0 });
    player.ws.close(1000);
    const usage = await rowOnce("SELECT * FROM room_usage WHERE game_id = ?", () => true);
    expect(usage.room_play_duration_sec).toBeLessThan(60);
  });

  it("tells spectators the match ended once the last player leaves", async () => {
    const player = await join("watched", "WTCHND");
    const watcher = await join("watched", "WTCHND", undefined, undefined, true);
    const closed = new Promise<number>((r) => watcher.ws.addEventListener("close", (ev) => r(ev.code)));
    player.ws.close(1000);
    expect(await watcher.next()).toEqual({ type: "ended", message: "The match ended.", endReason: "no_players" });
    expect(await closed).toBe(4000);
    expect(await rowOnce("SELECT COUNT(*) AS room_count FROM live_rooms WHERE game_id = ?", (row) => row.room_count === 0)).toEqual({ room_count: 0 });
  });
});
