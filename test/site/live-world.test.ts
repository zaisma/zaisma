import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { playingNowAnswer } from "../../apps/site/src/live-world.ts";

const SITE = "https://zaisma.test";
const NOW_MS = Date.UTC(2026, 10, 3, 12);

async function playing(playerCount: number, nowMs: number): Promise<void> {
  await env.DB.prepare("DELETE FROM play_tickets").run();
  await env.DB.prepare("INSERT OR IGNORE INTO games (id, slug, title, description) VALUES ('game_world', 'world-game', 'World Game', '')").run();
  for (let i = 0; i < playerCount; i++) {
    await env.DB.prepare("INSERT INTO play_tickets (id, game_id, issued_at_ms, reported_at_ms, date, is_first_play_today, is_new_player) VALUES (?, 'game_world', ?, ?, '2026-11-03', 0, 0)").bind(`ticket_${i}`, nowMs, nowMs).run();
  }
}

describe("who's playing", () => {
  it("answers everyone playing and nobody's private details, with no key", async () => {
    await playing(3, NOW_MS);
    const answer = await playingNowAnswer({ ...env, PLAYING_NOW_CACHE_SECONDS: "0" }, NOW_MS);
    expect(answer.playing_now_player_count).toBe(3);
    const response = await SELF.fetch(`${SITE}/api/playing-now`);
    expect(response.status).toBe(200);
    expect(Object.keys(await response.json<object>()).sort()).toEqual(["busiest_games", "playing_now_player_count"]);
  });

  it("takes a pretend count only on a local site", async () => {
    const pretend = await (await SELF.fetch(`${SITE}/api/playing-now?preview_players=640`)).json<{ playing_now_player_count: number }>();
    expect(pretend.playing_now_player_count).not.toBe(640);
  });
});
