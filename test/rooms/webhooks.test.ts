import { createExecutionContext, env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { monthStartDateOf } from "@zaisma/core";
import { GameServerWebhookService, type GameServerObject } from "../../apps/rooms/src/game-server.ts";
import type { GameDatabaseObject } from "../../apps/rooms/src/database.ts";
import type { Env } from "../../apps/rooms/src/index.ts";

// Webhooks to the game server: a webhook whose destination_kind is game_server hands its events to the
// game's own game server, whose onWebhook turns them into a Discord post or a GitHub issue with the
// game's secrets (apps/rooms/src/game-server.ts). The site's side: test/site/webhooks.test.ts. The same
// onWebhook on the developer's own server: test/node/webhooks.test.ts. The internet here is
// vitest.config.ts's stand-in, which answers with what it was sent.

const e = env as unknown as Env;

async function addGame(slug: string, server: string, reviewStatus = "live") {
  const gameId = `game_${slug.replace(/-/g, "")}`;
  const versionId = `version_${slug.replace(/-/g, "")}`;
  await e.DB.prepare("INSERT INTO games (id, slug, title, review_status, live_version_id, multiplayer_mode, room_browsing, game_server_allowed_hosts, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, 'none', 'page', ?, 0, 0)")
    .bind(gameId, slug, slug, reviewStatus, versionId, JSON.stringify(["discord.example.test"]))
    .run();
  await e.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES (?, ?, ?, 2, 0, 'approved', 0)").bind(versionId, gameId, `games/${versionId}`).run();
  await e.GAMES.put(`games/${versionId}/zaisma-server.js`, server);
  return { gameId, versionId };
}

const objectOf = (gameId: string) => e.GAME_SERVER_OBJECTS.get(e.GAME_SERVER_OBJECTS.idFromName(gameId));

/** Send an event the way the site does, through the service binding's entrypoint. */
function sendEvent(gameId: string, event: Record<string, unknown>) {
  return new GameServerWebhookService(createExecutionContext(), e).webhook(gameId, JSON.stringify(event));
}

async function gameRows(gameId: string, sql: string) {
  const stub = e.GAME_DATABASES.get(e.GAME_DATABASES.idFromName(gameId));
  return ((await runInDurableObject(stub, (database: GameDatabaseObject) => database.query(sql, []))) as { queryResult: Record<string, unknown>[] }).queryResult;
}

/** Record the stats now rather than a minute from now. */
async function recordNow(gameId: string) {
  await runInDurableObject(objectOf(gameId), (object: GameServerObject) => {
    (object as unknown as { recordAtMs: number }).recordAtMs = 0;
  });
  await runDurableObjectAlarm(objectOf(gameId));
}

const BUG = { id: "webhook_event_8f3k2m9q1x7c4v6b0n5z", kind: "bug_reported", created_at: "2026-10-17T12:00:00.000Z", game: { slug: "sky-hopper" }, version: null, bug_report: { id: "report_4k2m", player_text: "Stuck on level 2" } };

// A bug report becomes a "Discord post" with the game's own token, kept in its database by event.id.
const DISCORD = `
export default {
  async onWebhook(event, server) {
    if (event.kind === "test") return;
    if (event.bug_report?.player_text === "crash") throw new Error("Discord said no");
    const response = await fetch("https://discord.example.test/api/webhooks/123", { method: "POST", headers: { authorization: server.secrets.DISCORD_TOKEN ?? "none" }, body: JSON.stringify({ content: event.bug_report.player_text }) });
    const sent = await response.json();
    await server.database.query("CREATE TABLE IF NOT EXISTS posts (event_id TEXT PRIMARY KEY, host TEXT, authorization TEXT)");
    await server.database.query("INSERT INTO posts VALUES (?, ?, ?) ON CONFLICT DO NOTHING", [event.id, sent.host, sent.authorization]);
  },
};`;

describe("webhooks to the game server", () => {
  beforeEach(async () => {
    await e.DB.exec("DELETE FROM room_usage; DELETE FROM game_hosting_months; DELETE FROM game_server_errors; DELETE FROM versions; DELETE FROM games;");
  });

  it("reach onWebhook with the event, the game's secrets, database and reach, and count as requests", async () => {
    const { gameId } = await addGame("sky-hopper", DISCORD);
    await e.GAME_SECRETS.get(e.GAME_SECRETS.idFromName(gameId)).setSecret("DISCORD_TOKEN", "Bot token-one", Date.now());
    expect(await sendEvent(gameId, BUG)).toEqual({ failureMessage: null });
    expect(await gameRows(gameId, "SELECT * FROM posts")).toEqual([{ event_id: BUG.id, host: "discord.example.test", authorization: "Bot token-one" }]);
    expect(await sendEvent(gameId, { ...BUG, kind: "test", bug_report: null })).toEqual({ failureMessage: null });
    await recordNow(gameId);
    expect(await e.DB.prepare("SELECT game_server_request_count FROM room_usage WHERE game_id = ?").bind(gameId).first()).toEqual({ game_server_request_count: 2 });
  });

  it("say what onWebhook threw, for the delivery and the game server's errors", async () => {
    const { gameId, versionId } = await addGame("sky-hopper", DISCORD);
    const outcome = await sendEvent(gameId, { ...BUG, bug_report: { player_text: "crash" } });
    expect(outcome.failureMessage).toMatch(/^onWebhook threw: Discord said no \(zaisma-server\.js:\d+:\d+\)$/);
    await recordNow(gameId);
    const error = await e.DB.prepare("SELECT kind, message, version_id FROM game_server_errors WHERE game_id = ?").bind(gameId).first();
    expect(error).toEqual({ kind: "crash", message: expect.stringMatching(/^onWebhook: Discord said no/), version_id: versionId });
  });

  it("fail, to be tried again, when nothing can take them", async () => {
    const { gameId: withoutHandler } = await addGame("requests-only", "export default { onRequest: () => 1 };");
    expect((await sendEvent(withoutHandler, BUG)).failureMessage).toContain("without onWebhook");
    // Zaisma erases a deleted account's rows itself, so with no onWebhook there's nothing left to deliver.
    expect((await sendEvent(withoutHandler, { ...BUG, kind: "account_deleted", bug_report: null, account_deletion: { player_id: "player_mia", deleted_account_erase_enabled: true } })).failureMessage).toBeNull();
    const { gameId: held } = await addGame("held-game", DISCORD, "held");
    expect((await sendEvent(held, BUG)).failureMessage).toContain("isn't playable");
    expect(await gameRows(held, "SELECT name FROM sqlite_master WHERE name = 'posts'")).toEqual([]);
    const { gameId: noServer, versionId } = await addGame("no-server", DISCORD);
    await e.GAMES.delete(`games/${versionId}/zaisma-server.js`);
    expect((await sendEvent(noServer, BUG)).failureMessage).toContain("has no game server");
  });

  it("stop while the game's hosting is paused", async () => {
    const { gameId } = await addGame("busy-game", DISCORD);
    await e.DB.prepare("INSERT INTO game_hosting_months (game_id, month_start_date, used_cents, paused_at_ms, paused_reason) VALUES (?, ?, 500, ?, 'free_used')").bind(gameId, monthStartDateOf(), Date.now()).run();
    expect((await sendEvent(gameId, BUG)).failureMessage).toContain("hosting is paused");
    expect(await gameRows(gameId, "SELECT name FROM sqlite_master WHERE name = 'posts'")).toEqual([]);
  });

  it("are enough for a game server", async () => {
    const { gameId } = await addGame("hooks-only", "export default { onWebhook() {} };");
    expect(await sendEvent(gameId, BUG)).toEqual({ failureMessage: null });
  });
});
