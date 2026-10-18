import { env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { FREE_REQUEST_COUNT_PER_MONTH, createAccount, issueRoomKey, usageMonth } from "@zaisma/core";
import type { Env } from "../../apps/rooms/src/index.ts";
import type { GameServerObject } from "../../apps/rooms/src/game-server.ts";
import type { GameDatabaseObject } from "../../apps/rooms/src/database.ts";

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
    return server.database.query("SELECT player_id, best_score FROM scores ORDER BY best_score DESC LIMIT 10");
  },
};`;

describe("game server requests", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM room_usage; DELETE FROM game_server_errors; DELETE FROM versions; DELETE FROM games;");
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

  it("need onRequest", async () => {
    await addGame("rooms-only", "export default { setup: () => ({}) };", { multiplayerMode: "own" });
    expect(await send("rooms-only", { type: "leaderboard" })).toMatchObject({ httpStatus: 404, body: { error: { code: "no_request_handler" } } });
  });

  it("from a game server with no setup, which then runs no rooms", async () => {
    await addGame("requests-only", "export default { onRequest: () => ({ coinCount: 3 }) };", { multiplayerMode: "own" });
    expect((await send("requests-only", { type: "claimDailyReward" })).body).toEqual({ answer: { coinCount: 3 } });
    const up = await SELF.fetch(`${ROOMS}/v1/rooms/requests-only/K7Q2MX`, { headers: { Upgrade: "websocket", Origin: ORIGIN, "cf-connecting-ip": `203.0.113.${++address % 250}` } });
    expect(up.status).toBe(404);
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

  it("stop at the month's free requests", async () => {
    const { gameId } = await addGame("busy-shop", LEADERBOARD);
    expect((await send("busy-shop", { type: "leaderboard" })).httpStatus).toBe(200);
    await runInDurableObject(objectOf(gameId), (object: GameServerObject) => {
      (object as unknown as { requestUse: { month: string; requestCount: number } }).requestUse = { month: usageMonth(), requestCount: FREE_REQUEST_COUNT_PER_MONTH };
    });
    const refused = await send("busy-shop", { type: "leaderboard" });
    expect(refused).toMatchObject({ httpStatus: 429, body: { error: { code: "request_limit" } } });
    expect(refused.body.error.message).toMatch(/1,000,000 requests this month\. They work again on \d{4}-\d{2}-01 \(UTC\)\./);
    // A new month starts from nothing.
    await runInDurableObject(objectOf(gameId), (object: GameServerObject) => {
      (object as unknown as { requestUse: { month: string; requestCount: number } }).requestUse = { month: "2026-01", requestCount: FREE_REQUEST_COUNT_PER_MONTH };
    });
    expect((await send("busy-shop", { type: "leaderboard" })).httpStatus).toBe(200);
  });

  it("from a game server that doesn't start say so to its developer", async () => {
    const { gameId } = await addGame("typo-shop", "export default { onRequest: () => 1, tickRate: 20 };");
    expect((await send("typo-shop", { type: "leaderboard" })).body.error.code).toBe("game_server_error");
    await runDurableObjectAlarm(objectOf(gameId));
    const error = await e.DB.prepare("SELECT message FROM game_server_errors WHERE game_id = ?").bind(gameId).first<{ message: string }>();
    expect(error!.message).toMatch(/^Didn't start: tickRate isn't a game server option/);
  });
});
