import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { countPlay, playStats } from "../../apps/site/src/plays.ts";
import { shelves } from "../../apps/site/src/home.ts";

const SITE = "https://zaisma.test";
const DAY = 86_400_000;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

beforeEach(async () => {
  await env.DB.exec("DELETE FROM play_days; DELETE FROM play_returns; DELETE FROM tester_links; DELETE FROM games WHERE id LIKE 'g-play%';");
  const now = Date.now();
  await env.DB.prepare("INSERT INTO games (id, slug, title, status, visibility, current_version_id, created_at, updated_at) VALUES ('g-play', 'play-game', 'Play Game', 'live', 'listed', 'v1', ?, ?)").bind(now, now).run();
  await env.DB.prepare("INSERT INTO games (id, slug, title, status, visibility, current_version_id, created_at, updated_at) VALUES ('g-play-hidden', 'play-hidden', 'Hidden', 'live', 'private', 'v1', ?, ?)").bind(now, now).run();
});

const send = (slug: string, body: unknown, headers: Record<string, string> = { origin: SITE }) =>
  SELF.fetch(`${SITE}/api/plays/${slug}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "text/plain", ...headers } });

describe("play stats", () => {
  it("counts plays, players, new players and time from the game page", async () => {
    const today = day(Date.now());
    expect((await send("play-game", { first: null, last: null })).status).toBe(204);
    // The same browser again today: a play, not another player.
    expect((await send("play-game", { first: today, last: today })).status).toBe(204);
    // Someone who first played three days ago, back for the first time today.
    expect((await send("play-game", { first: day(Date.now() - 3 * DAY), last: day(Date.now() - 3 * DAY) })).status).toBe(204);
    expect((await send("play-game", { seconds: 125 })).status).toBe(204);
    // Time past what the page could have sent is capped.
    expect((await send("play-game", { seconds: 99_999 })).status).toBe(204);

    const row = await env.DB.prepare("SELECT plays, players, new_players, play_seconds FROM play_days WHERE game_id = 'g-play'").first();
    expect(row).toEqual({ plays: 3, players: 2, new_players: 1, play_seconds: 725 });
    const back = await env.DB.prepare("SELECT first_day, after, players FROM play_returns WHERE game_id = 'g-play'").all();
    expect(back.results).toEqual([{ first_day: day(Date.now() - 3 * DAY), after: 3, players: 1 }]);
  });

  it("only counts plays of games players can open, sent from Zaisma", async () => {
    expect((await send("play-hidden", { first: null, last: null })).status).toBe(404);
    expect((await send("nope", { first: null, last: null })).status).toBe(404);
    expect((await send("play-game", { first: null, last: null }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await SELF.fetch(`${SITE}/api/plays/play-game`, { method: "POST", body: "{not json", headers: { origin: SITE } })).status).toBe(400);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM play_days").first("n")).toBe(0);
  });

  it("works out how many new players came back", async () => {
    const now = Date.parse("2026-10-20T12:00:00Z");
    // 4 new players on Oct 10; 2 came back the next day and 1 a week later.
    for (let i = 0; i < 4; i++) await countPlay(env.DB, "g-play", { first: null, last: null }, Date.parse("2026-10-10T09:00:00Z"));
    for (let i = 0; i < 2; i++) await countPlay(env.DB, "g-play", { first: "2026-10-10", last: "2026-10-10" }, Date.parse("2026-10-11T09:00:00Z"));
    await countPlay(env.DB, "g-play", { first: "2026-10-10", last: "2026-10-11" }, Date.parse("2026-10-17T09:00:00Z"));
    await countPlay(env.DB, "g-play", { seconds: 600 }, Date.parse("2026-10-17T09:05:00Z"));

    const stats = await playStats(env.DB, "g-play", 30, now);
    expect(stats.plays).toBe(7);
    expect(stats.new_players).toBe(4);
    expect(stats.minutes_played).toBe(10);
    expect(stats.minutes_per_play).toBe(1.4);
    expect(stats.came_back.after_1_day).toEqual({ percent: 50, players: 2, of: 4 });
    expect(stats.came_back.after_7_days).toEqual({ percent: 25, players: 1, of: 4 });
    // Thirty days haven't passed for anyone yet.
    expect(stats.came_back.after_30_days).toEqual({ percent: null, players: 0, of: 0 });
    expect(stats.days.map((d) => d.day)).toEqual(["2026-10-10", "2026-10-11", "2026-10-17"]);
  });

  it("counts from the game page, but never through a tester link", async () => {
    const page = await (await SELF.fetch(`${SITE}/g/play-game`)).text();
    expect(page).toContain('"/api/plays/play-game"');
    expect(page).toMatch(/remember\(\);\s*countPlay\(\);/);
    await env.DB.prepare("INSERT INTO tester_links (id, game_id, name, token, created_at) VALUES ('t1', 'g-play-hidden', 'Team', 'abcdefghij0123456789', ?)").bind(Date.now()).run();
    const tester = await SELF.fetch(`${SITE}/t/abcdefghij0123456789`);
    expect(tester.status).toBe(200);
    expect(await tester.text()).not.toContain("/api/plays/");
  });
});

describe("home page shelves", () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  const show = (slug: string, since: number | null = null) => ({ slug, title: slug, description: "", developer: null, owner_id: null, cover: null, square: null, updated: null, since, modes: "", devices: [] });
  const players = async (id: string, ago: number, n: number) =>
    env.DB
      .prepare("INSERT INTO play_days (game_id, day, plays, players) VALUES (?, ?, ?, ?) ON CONFLICT (game_id, day) DO UPDATE SET players = players + excluded.players")
      .bind(id, day(now - ago * DAY), n, n)
      .run();

  it("ranks popular by players this week and trending by players above the usual", async () => {
    const t = Date.now();
    for (const id of ["a", "b", "c", "d"]) await env.DB.prepare("INSERT INTO games (id, slug, title, status, visibility, current_version_id, created_at, updated_at) VALUES (?, ?, ?, 'live', 'listed', 'v1', ?, ?)").bind(`g-play-${id}`, `play-${id}`, id, t, t).run();
    // a: steady and big. b: steady and smaller. c: quiet, then a lot of players in the last 3 days.
    // d: only played two weeks ago.
    for (let i = 0; i < 17; i++) {
      await players("g-play-a", i, 40);
      await players("g-play-b", i, 10);
      await players("g-play-c", i, i < 3 ? 25 : 2);
    }
    await players("g-play-d", 12, 500);
    const games = ["a", "b", "c", "d"].map((x) => show(`play-${x}`, x === "d" ? now - 5 * DAY : x === "c" ? now - 20 * DAY : now - 200 * DAY));
    const { popular, trending, fresh } = await shelves(env, games, now);
    expect(popular.map((g) => g.slug)).toEqual(["play-a", "play-c", "play-b"]);
    // Only c is above its usual, and one game isn't a shelf.
    expect(trending).toEqual([]);
    await players("g-play-b", 0, 300);
    expect((await shelves(env, games, now)).trending.map((g) => g.slug)).toEqual(["play-b", "play-c"]);
    expect(fresh.map((g) => g.slug)).toEqual(["play-d", "play-c"]);
  });
});
