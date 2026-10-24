import { env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createAccount, issueRoomKey, monthStartDateOf } from "@zaisma/core";
import { generateSigningKey, loadSigningKey } from "@zaisma/game-server/internal";
import type { Env } from "../../apps/rooms/src/index.ts";
import type { GameServerObject } from "../../apps/rooms/src/game-server.ts";
import type { GameDatabaseObject } from "../../apps/rooms/src/database.ts";
import { signTestReceipt } from "../helpers.ts";

// Requests from a game to its own game server's onRequest, outside any room (apps/rooms/src/game-server.ts).

const ROOMS = "https://rooms.zaisma.test";
const ORIGIN = "https://games.zaisma.test";
const e = env as unknown as Env;

/** A live game whose upload has this game server as its zaisma-server.js. */
async function addGame(slug: string, server: string, gameOptions: { multiplayerMode?: string; accountRequirement?: string } = {}) {
  const gameId = `game_${slug.replace(/-/g, "")}`;
  const versionId = `version_${slug.replace(/-/g, "")}`;
  await e.DB.prepare("INSERT INTO games (id, slug, title, review_status, live_version_id, multiplayer_mode, account_requirement, room_browsing, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 'live', ?, ?, ?, 'page', 0, 0)")
    .bind(gameId, slug, slug, versionId, gameOptions.multiplayerMode ?? "none", gameOptions.accountRequirement ?? "none")
    .run();
  await e.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES (?, ?, ?, 2, 0, 'approved', 0)").bind(versionId, gameId, `games/${versionId}`).run();
  await e.GAMES.put(`games/${versionId}/zaisma-server.js`, server);
  return { gameId, versionId };
}

let address = 0;
async function newPass(slug: string) {
  const roomKey = await issueRoomKey(e.DB, `game_${slug.replace(/-/g, "")}`);
  const response = await SELF.fetch(`${ROOMS}/v1/pass`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain", "cf-connecting-ip": `203.0.113.${++address % 250}` }, body: JSON.stringify({ gameSlug: slug, roomKey }) });
  return response.json<{ pass: string; player: { id: string; name: string; kind: string } }>();
}

/** Send a request as the SDK does, and say what came back. */
async function send(slug: string, request: unknown, pass?: string, origin = ORIGIN) {
  pass ??= (await newPass(slug)).pass;
  const response = await SELF.fetch(`${ROOMS}/v1/requests/${slug}`, { method: "POST", headers: { Origin: origin, "Content-Type": "text/plain", "cf-connecting-ip": `203.0.113.${++address % 250}` }, body: JSON.stringify({ pass, request }) });
  return { httpStatus: response.status, body: await response.json<any>(), allowedOrigin: response.headers.get("access-control-allow-origin") };
}

const objectOf = (gameId: string) => e.GAME_SERVER_OBJECTS.get(e.GAME_SERVER_OBJECTS.idFromName(gameId));

const LEADERBOARD = `
export default {
  async onRequest(player, request, server) {
    await server.database.query("CREATE TABLE IF NOT EXISTS scores (player_id TEXT PRIMARY KEY, best_score INTEGER NOT NULL)");
    if (request.type === "submit") {
      await server.database.query("INSERT INTO scores VALUES (?, ?) ON CONFLICT (player_id) DO UPDATE SET best_score = max(best_score, excluded.best_score)", [player.id, request.score]);
      return { isSaved: true };
    }
    if (request.type === "whoami") return player;
    if (request.type === "nothing") return undefined;
    if (request.type === "function") return () => 1;
    if (request.type === "huge") return "x".repeat(2 * 1024 * 1024);
    if (request.type === "crash") throw new Error("the shop is closed");
    if (request.type === "heavy") {
      let total = 0;
      for (let i = 0; i < 40_000_000; i++) total = (total + i * 7) % 1_000_003;
      return total;
    }
    return server.database.query("SELECT player_id, best_score FROM scores ORDER BY best_score DESC LIMIT 10");
  },
};`;

describe("game server requests", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM room_usage; DELETE FROM game_hosting_months; DELETE FROM game_server_errors; DELETE FROM versions; DELETE FROM games;");
  });

  it("answer from onRequest, with the game's database and who's asking, in a single-player game", async () => {
    await addGame("top-scores", LEADERBOARD);
    const { pass, player } = await newPass("top-scores");
    const saved = await send("top-scores", { type: "submit", score: 1200 }, pass);
    expect(saved).toEqual({ httpStatus: 200, body: { answer: { isSaved: true } }, allowedOrigin: ORIGIN });
    expect((await send("top-scores", { type: "leaderboard" })).body.answer).toEqual([{ player_id: player.id, best_score: 1200 }]);
    expect((await send("top-scores", { type: "whoami" }, pass)).body.answer).toEqual(player);
    expect((await send("top-scores", { type: "nothing" })).body).toEqual({ answer: null });
  });

  it("share the database with the game's rooms", async () => {
    const { gameId } = await addGame("shared-db", LEADERBOARD);
    await send("shared-db", { type: "submit", score: 7 });
    const stub = e.GAME_DATABASES.get(e.GAME_DATABASES.idFromName(gameId));
    await runInDurableObject(stub, (database: GameDatabaseObject) => {
      expect(database.query("SELECT best_score FROM scores", [])).toEqual({ queryResult: [{ best_score: 7 }] });
    });
  });

  it("say what went wrong, and show the developer why", async () => {
    const { gameId, versionId } = await addGame("broken-shop", LEADERBOARD);
    expect(await send("broken-shop", { type: "crash" })).toMatchObject({ httpStatus: 500, body: { error: { code: "game_server_error" } } });
    expect((await send("broken-shop", { type: "function" })).body.error.code).toBe("game_server_error");
    expect((await send("broken-shop", { type: "huge" })).body.error.code).toBe("game_server_error");
    // The game never sees the developer's error; the developer does, in their stats, once recorded.
    expect((await send("broken-shop", { type: "crash" })).body.error.message).toBe("The game's server couldn't answer this request.");
    await runDurableObjectAlarm(objectOf(gameId));
    const usage = await e.DB.prepare("SELECT game_server_request_count, game_server_crash_count FROM room_usage WHERE game_id = ?").bind(gameId).first();
    expect(usage).toEqual({ game_server_request_count: 4, game_server_crash_count: 4 });
    const { results: errors } = await e.DB.prepare("SELECT kind, message, occurrence_count, version_id FROM game_server_errors WHERE game_id = ? ORDER BY message").bind(gameId).all<{ kind: string; message: string; occurrence_count: number; version_id: string }>();
    expect(errors.map((error) => [error.kind, error.occurrence_count, error.version_id])).toEqual([
      ["crash", 1, versionId],
      ["crash", 1, versionId],
      ["crash", 2, versionId],
    ]);
    expect(errors.find((error) => error.occurrence_count === 2)!.message).toMatch(/^the shop is closed \(zaisma-server\.js:\d+:\d+\)$/);
    expect(errors.map((error) => error.message).join("\n")).toMatch(/isn't plain JSON/);
    expect(errors.map((error) => error.message).join("\n")).toMatch(/over 1 MB/);
  });

  it("check a purchase's receipt with server.verifyReceipt: its claims for this game, and a reason for anything else", async () => {
    await addGame("receipt-shop", "export default { onRequest: (player, request, server) => server.verifyReceipt(request.receipt).catch((error) => ({ errorName: error.name, errorCode: error.code })) };");
    const receiptKey = await loadSigningKey(e.RECEIPT_SIGNING_KEY!);
    const answerTo = async (receipt: string) => (await send("receipt-shop", { receipt })).body.answer;
    expect(await answerTo(await signTestReceipt(receiptKey, "receipt-shop", e.ISSUER))).toMatchObject({ aud: "receipt-shop", purchase_id: "purchase_8f3k2m9q1x7c4v6b0n5z", purchase_status: "completed", item_name: "gold_crown", receipt_version_number: 1 });
    // Refunded receipts are still genuine: the game reads purchase_status.
    expect(await answerTo(await signTestReceipt(receiptKey, "receipt-shop", e.ISSUER, { purchase_status: "refunded" }))).toMatchObject({ purchase_status: "refunded" });
    // Another game's receipt, a pass, a receipt from a stranger's key, one from the wrong issuer, and plain nonsense.
    expect(await answerTo(await signTestReceipt(receiptKey, "other-shop", e.ISSUER))).toEqual({ errorName: "ReceiptError", errorCode: "wrong_game" });
    // A pass is refused as one, though receipt checks here hold only the receipt keys.
    expect(await answerTo((await newPass("receipt-shop")).pass)).toEqual({ errorName: "ReceiptError", errorCode: "wrong_kind" });
    expect(await answerTo(await signTestReceipt(await loadSigningKey(await generateSigningKey()), "receipt-shop", e.ISSUER))).toEqual({ errorName: "ReceiptError", errorCode: "unknown_key" });
    expect(await answerTo(await signTestReceipt(receiptKey, "receipt-shop", "https://rooms.elsewhere.test"))).toEqual({ errorName: "ReceiptError", errorCode: "wrong_issuer" });
    expect(await answerTo(await signTestReceipt(receiptKey, "receipt-shop", e.ISSUER, { receipt_version_number: 2 }))).toEqual({ errorName: "ReceiptError", errorCode: "wrong_version" });
    expect(await answerTo("not.a.receipt")).toEqual({ errorName: "ReceiptError", errorCode: "malformed" });
  });

  it("check a receipt signed with a retired receipt key while it stays listed", async () => {
    await addGame("old-receipt-shop", "export default { onRequest: (player, request, server) => server.verifyReceipt(request.receipt).then((claims) => claims.purchase_id, (error) => error.code) };");
    const retired = await loadSigningKey(await generateSigningKey());
    const receipt = await signTestReceipt(retired, "old-receipt-shop", e.ISSUER);
    const original = e.RETIRED_RECEIPT_PUBLIC_KEYS;
    try {
      expect((await send("old-receipt-shop", { receipt })).body.answer).toBe("unknown_key");
      e.RETIRED_RECEIPT_PUBLIC_KEYS = JSON.stringify([retired.publicKey]);
      expect((await send("old-receipt-shop", { receipt })).body.answer).toBe("purchase_8f3k2m9q1x7c4v6b0n5z");
    } finally {
      e.RETIRED_RECEIPT_PUBLIC_KEYS = original;
    }
  });

  it("need onRequest", async () => {
    await addGame("rooms-only", "export default { setup: () => ({}) };", { multiplayerMode: "own" });
    expect(await send("rooms-only", { type: "leaderboard" })).toMatchObject({ httpStatus: 404, body: { error: { code: "no_request_handler" } } });
  });

  it("from a game server with no setup, which then runs no rooms", async () => {
    await addGame("requests-only", "export default { onRequest: () => ({ coinCount: 3 }) };", { multiplayerMode: "own" });
    expect((await send("requests-only", { type: "claimDailyReward" })).body).toEqual({ answer: { coinCount: 3 } });
    const up = await SELF.fetch(`${ROOMS}/v1/rooms/requests-only/K7Q2MX`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `203.0.113.${++address % 250}` } });
    // Turned away on the socket, saying why, since a browser never sees an HTTP status on a WebSocket.
    expect(up.status).toBe(101);
    const turnedAway = new Promise<any>((resolve) => up.webSocket!.addEventListener("message", (ev) => resolve(JSON.parse(ev.data as string)), { once: true }));
    up.webSocket!.accept();
    expect(await turnedAway).toMatchObject({ type: "error", code: "game_unavailable" });
    // Its developer sees why.
    const error = await e.DB.prepare("SELECT message FROM game_server_errors WHERE game_id = 'game_requestsonly'").first<{ message: string }>();
    expect(error!.message).toMatch(/^Didn't start: This game server has no setup\(\), so it can't run rooms/);
  });

  it("from a game server that knows it runs in Zaisma rooms (checkChat refuses there)", async () => {
    await addGame("runtime-shop", "export default { onRequest: () => ({ isZaismaRoomsSandbox: globalThis.isZaismaRoomsSandbox === true }) };", { multiplayerMode: "own" });
    expect((await send("runtime-shop", { type: "which" })).body).toEqual({ answer: { isZaismaRoomsSandbox: true } });
  });

  it("only with a good pass, from the game's own page", async () => {
    await addGame("checked-shop", LEADERBOARD);
    expect(await send("checked-shop", { type: "leaderboard" }, "not.a.pass")).toMatchObject({ httpStatus: 401, body: { error: { code: "bad_pass" } } });
    expect((await send("checked-shop", { type: "leaderboard" }, (await newPass("checked-shop")).pass, "https://evil.example")).body.error.code).toBe("bad_origin");
    await addGame("other-shop", LEADERBOARD);
    expect((await send("checked-shop", { type: "leaderboard" }, (await newPass("other-shop")).pass)).body.error.code).toBe("bad_pass");
  });

  it("turn away guests of a game that needs accounts, with a pass from before the change", async () => {
    const { gameId } = await addGame("members-shop", LEADERBOARD);
    const { pass } = await newPass("members-shop");
    await e.DB.prepare("UPDATE games SET account_requirement = 'whole_game' WHERE id = ?").bind(gameId).run();
    expect((await send("members-shop", { type: "leaderboard" }, pass)).body.error.code).toBe("account_needed");
  });

  it("turn away accounts younger than the game's minimum age, with a pass from before the change", async () => {
    const { gameId } = await addGame("grown-shop", LEADERBOARD);
    const teen = await createAccount(e.DB, { id: "supabase-requests-teen", username: "requests_teen", ageBand: "13-15" });
    const adult = await createAccount(e.DB, { id: "supabase-requests-adult", username: "requests_adult", ageBand: "18+" });
    const accountPass = async (accountId: string) =>
      (
        await (
          await SELF.fetch(`${ROOMS}/v1/pass`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "text/plain", "cf-connecting-ip": `203.0.113.${++address % 250}` }, body: JSON.stringify({ gameSlug: "grown-shop", roomKey: await issueRoomKey(e.DB, gameId, accountId) }) })
        ).json<{ pass: string }>()
      ).pass;
    const teenPass = await accountPass(teen.id);
    const adultPass = await accountPass(adult.id);
    await e.DB.prepare("UPDATE games SET account_requirement = 'whole_game', minimum_player_age_years = 16 WHERE id = ?").bind(gameId).run();
    expect(await send("grown-shop", { type: "leaderboard" }, teenPass)).toMatchObject({ httpStatus: 403, body: { error: { code: "game_not_open_to_player" } } });
    expect((await send("grown-shop", { type: "leaderboard" }, adultPass)).httpStatus).toBe(200);
  });

  it("are up to 16 KB of plain JSON", async () => {
    await addGame("big-shop", LEADERBOARD);
    expect(await send("big-shop", { type: "save", text: "x".repeat(17 * 1024) })).toMatchObject({ httpStatus: 413, body: { error: { code: "too_big" } } });
    const response = await SELF.fetch(`${ROOMS}/v1/requests/big-shop`, { method: "POST", headers: { Origin: ORIGIN }, body: "not json" });
    expect((await response.json<any>()).error.code).toBe("bad_request");
  });

  it("stop while the game's hosting is paused, read at most once a minute", async () => {
    const { gameId } = await addGame("busy-shop", LEADERBOARD);
    expect((await send("busy-shop", { type: "leaderboard" })).httpStatus).toBe(200);
    await e.DB.prepare("INSERT INTO game_hosting_months (game_id, month_start_date, used_cents, paused_at_ms, paused_reason) VALUES (?, ?, 500, ?, 'free_used')").bind(gameId, monthStartDateOf(), Date.now()).run();
    // Still the answer read a moment ago.
    expect((await send("busy-shop", { type: "leaderboard" })).httpStatus).toBe(200);
    const forget = () => runInDurableObject(objectOf(gameId), (object: GameServerObject) => void ((object as unknown as { hosting: null }).hosting = null));
    await forget();
    const refused = await send("busy-shop", { type: "leaderboard" });
    expect(refused).toMatchObject({ httpStatus: 429, body: { error: { code: "hosting_paused", message: "This game's hosting is paused. It starts again when the month resets or its developer adds credit." } } });
    // Credit came in: the site's job cleared the pause.
    await e.DB.prepare("UPDATE game_hosting_months SET paused_at_ms = NULL, paused_reason = NULL WHERE game_id = ?").bind(gameId).run();
    await forget();
    expect((await send("busy-shop", { type: "leaderboard" })).httpStatus).toBe(200);
  });

  it("count their CPU past the first 10 ms on the hosting meter", async () => {
    const { gameId } = await addGame("heavy-shop", LEADERBOARD);
    expect((await send("heavy-shop", { type: "heavy" })).httpStatus).toBe(200);
    await runInDurableObject(objectOf(gameId), (object: GameServerObject) => {
      const counting = object as unknown as { countCpu(cpuDurationMs: number): void; unrecorded: { outsideRoomCpuDurationMs: number } };
      const before = counting.unrecorded.outsideRoomCpuDurationMs;
      expect(before).toBeGreaterThan(0);
      // 10 ms of each call is included: 8 adds nothing, 210 adds 200.
      counting.countCpu(8);
      expect(counting.unrecorded.outsideRoomCpuDurationMs).toBe(before);
      counting.countCpu(210);
      expect(counting.unrecorded.outsideRoomCpuDurationMs).toBe(before + 200);
    });
    await runDurableObjectAlarm(objectOf(gameId));
    const usage = await e.DB.prepare("SELECT game_server_request_count, outside_room_cpu_duration_ms FROM room_usage WHERE game_id = ?").bind(gameId).first<{ game_server_request_count: number; outside_room_cpu_duration_ms: number }>();
    expect(usage!.game_server_request_count).toBe(1);
    expect(usage!.outside_room_cpu_duration_ms).toBeGreaterThan(200);
  });

  it("from a game server that doesn't start say so to its developer", async () => {
    const { gameId } = await addGame("typo-shop", "export default { onRequest: () => 1, tickRate: 20 };");
    expect((await send("typo-shop", { type: "leaderboard" })).body.error.code).toBe("game_server_error");
    await runDurableObjectAlarm(objectOf(gameId));
    const error = await e.DB.prepare("SELECT message FROM game_server_errors WHERE game_id = ?").bind(gameId).first<{ message: string }>();
    expect(error!.message).toMatch(/^Didn't start: tickRate isn't a game server option/);
  });
});
