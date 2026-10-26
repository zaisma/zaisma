import { env, SELF } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import { createAccount, createApiKey, gameBySlug } from "@zaisma/core";
import { letPublish } from "../helpers.ts";

// What a developer sees of a game server that never started, in a game that isn't multiplayer "own":
// it counted no request and listed no schedule, but its errors are in get_stats all the same.

const SITE = "https://zaisma.test";
let token = "";

async function api(path: string, init: { method?: string; body?: unknown } = {}) {
  const res = await SELF.fetch(`${SITE}/api/dev${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, answer: (await res.json()) as any };
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM room_usage; DELETE FROM game_server_errors; DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;");
  await createAccount(env.DB, { id: "dev-1", username: "Pixel_Smith", ageBand: "18+" });
  await letPublish(env.DB, "dev-1");
  token = (await createApiKey(env.DB, "dev-1", "claude")).token;
  expect((await api("/games", { body: { title: "Hop", slug: "hop" } })).status).toBe(201);
});

it("get_stats shows why a single-player game's game server didn't start", async () => {
  const game = (await gameBySlug(env.DB, "hop"))!;
  const today = new Date().toISOString().slice(0, 10);
  await env.DB.prepare("INSERT INTO room_usage (game_id, date, game_server_crash_count) VALUES (?, ?, 1)").bind(game.id, today).run();
  await env.DB.prepare("INSERT INTO game_server_errors (game_id, version_id, kind, message, occurrence_count, first_at_ms, last_at_ms) VALUES (?, 'version_8f3k2m9q1x7c4v6b0n5z', 'crash', 'Didn''t start: ticksPerSec is 0. (bad_option)', 1, 1792000000000, 1792003600000)").bind(game.id).run();
  const { status, answer: stats } = await api("/games/hop/stats?period_duration_days=7");
  expect(status).toBe(200);
  expect(stats.game_server_errors).toEqual([
    { kind: "crash", message: "Didn't start: ticksPerSec is 0. (bad_option)", occurrence_count: 1, version_id: "version_8f3k2m9q1x7c4v6b0n5z", first_at: "2026-10-14T17:46:40.000Z", last_at: "2026-10-14T18:46:40.000Z" },
  ]);
  expect(stats.multiplayer_days[0].game_server).toEqual({ call_count: 0, request_count: 0, scheduled_run_count: 0, crash_count: 1, stopped_count: 0, ended_match_count: 0 });
});
