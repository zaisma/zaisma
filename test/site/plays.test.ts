import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addTime, clearCountedDay, countStart, countTicket, issueTicket, playingNowCounts, playSpikes, playStats, reportPlaying, shelfPlayers } from "../../apps/site/src/plays.ts";
import { shelves } from "../../apps/site/src/home.ts";
import { pageDataOf, pageScriptNames, pageScriptText } from "../strict-scripts.ts";

const SITE = "https://zaisma.test";
const DAY = 86_400_000;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const COMCAST = 7922;
const AMAZON = 16509;

// Cloudflare's check: "good" passes for a play on our site; anything else fails.
const realFetch = globalThis.fetch;
const verified: string[] = [];
beforeEach(async () => {
  verified.length = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://challenges.cloudflare.com/")) return realFetch(input, init);
    const form = new URLSearchParams(String(init?.body));
    verified.push(form.get("response")!);
    const good = form.get("secret") === "test-secret" && form.get("response") === "good";
    return Response.json(good ? { success: true, action: "play", hostname: "zaisma.test" } : { success: false });
  });
  await env.DB.exec("DELETE FROM play_days; DELETE FROM play_returns; DELETE FROM play_tickets; DELETE FROM play_networks; DELETE FROM room_keys; DELETE FROM tester_links; DELETE FROM versions WHERE id IN ('v1', 'v-next'); DELETE FROM games WHERE id LIKE 'g-play%';");
  const now = Date.now();
  await env.DB.prepare("INSERT INTO games (id, slug, title, review_status, visibility, live_version_id, created_at_ms, updated_at_ms) VALUES ('g-play', 'play-game', 'Play Game', 'live', 'listed', 'v1', ?, ?)").bind(now, now).run();
  await env.DB.prepare("INSERT INTO games (id, slug, title, review_status, visibility, live_version_id, created_at_ms, updated_at_ms) VALUES ('g-play-hidden', 'play-hidden', 'Hidden', 'live', 'private', 'v1', ?, ?)").bind(now, now).run();
  await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES ('v1', 'g-play-hidden', 'games/p/v1', 1, 0, 'approved', 0)").run();
});
afterEach(() => vi.unstubAllGlobals());

const send = (slug: string, body: unknown, headers: Record<string, string> = { origin: SITE }) =>
  SELF.fetch(`${SITE}/api/plays/${slug}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "text/plain", ...headers } });
const row = () => env.DB.prepare("SELECT started_play_count, started_player_count, started_new_player_count, play_count, player_count, new_player_count, play_duration_sec FROM play_days WHERE game_id = 'g-play'").first();
const NEW = { first: null, last: null, cfirst: null, clast: null };

describe("counted plays", () => {
  it("counts every play started, but gives a ticket only to a checked browser", async () => {
    expect((await send("play-game", NEW)).status).toBe(204);
    expect((await send("play-game", { ...NEW, token: "forged" })).status).toBe(204);
    const res = await send("play-game", { ...NEW, token: "good" });
    expect(res.status).toBe(200);
    const { ticket } = await res.json<{ ticket: string }>();
    expect(ticket).toMatch(/^play_ticket_[a-z0-9]+$/);
    expect(verified).toEqual(["forged", "good"]);
    // Three plays started, none counted yet: a play counts after a minute on screen.
    expect(await row()).toMatchObject({ started_play_count: 3, play_count: 0 });
    expect((await send("play-game", { ticket, counted: true })).status).toBe(204);
    expect(await row()).toMatchObject({ play_count: 0 });
  });

  it("counts a ticket once, after a minute, and never more time than has passed", async () => {
    const t0 = Date.now();
    const id = await issueTicket(env.DB, "g-play", NEW, t0);
    expect(await countTicket(env.DB, "g-play", id, COMCAST, t0 + 30_000)).toBe(false);
    // 120 seconds claimed 30 seconds in: refused. 50 seconds at 50: kept for when the play counts.
    await addTime(env.DB, "g-play", id, 120, t0 + 30_000);
    await addTime(env.DB, "g-play", id, 50, t0 + 50_000);
    expect(await countTicket(env.DB, "g-play", "someoneelse", COMCAST, t0 + 60_000)).toBe(false);
    expect(await countTicket(env.DB, "g-play", id, COMCAST, t0 + 60_000)).toBe(true);
    expect(await countTicket(env.DB, "g-play", id, COMCAST, t0 + 61_000)).toBe(false);
    await addTime(env.DB, "g-play", id, 30, t0 + 90_000);
    expect(await row()).toMatchObject({ play_count: 1, player_count: 1, new_player_count: 1, play_duration_sec: 80 });
    expect((await env.DB.prepare("SELECT autonomous_system_number, player_count FROM play_networks WHERE game_id = 'g-play'").all()).results).toEqual([{ autonomous_system_number: COMCAST, player_count: 1 }]);
  });

  it("counts a checked browser's ticket as playing now until it hides, goes quiet or leaves", async () => {
    const t0 = Date.now();
    const id = await issueTicket(env.DB, "g-play", NEW, t0);
    await issueTicket(env.DB, "g-play-hidden", NEW, t0);
    // At once, and only for its own game.
    expect((await playingNowCounts(env, t0 + 1000)).get("g-play")).toBe(1);
    expect((await playingNowCounts(env, t0 + 1000)).get("g-play-hidden")).toBe(1);
    // A hidden tab isn't playing; coming back, with no time to report, counts again.
    await reportPlaying(env.DB, "g-play", id, true, t0 + 60_000);
    expect((await playingNowCounts(env, t0 + 61_000)).get("g-play")).toBeUndefined();
    await reportPlaying(env.DB, "g-play", id, false, t0 + 120_000);
    expect((await playingNowCounts(env, t0 + 121_000)).get("g-play")).toBe(1);
    // Six minutes after its last report, it's gone.
    expect((await playingNowCounts(env, t0 + 120_000 + 5 * 60_000)).get("g-play")).toBe(1);
    expect((await playingNowCounts(env, t0 + 120_000 + 7 * 60_000)).get("g-play")).toBeUndefined();
    // Another game's ticket, or a ticket id that isn't this game's, moves nothing.
    await reportPlaying(env.DB, "g-play-hidden", id, true, t0 + 130_000);
    expect((await playingNowCounts(env, t0 + 131_000)).get("g-play")).toBe(1);
  });

  it("takes the page's reports of hiding and coming back, and never counts a browser without a ticket", async () => {
    const { ticket } = await (await send("play-game", { ...NEW, token: "good" })).json<{ ticket: string }>();
    // A checked browser counts at once; an unchecked one has no ticket and doesn't.
    await send("play-game", NEW);
    await send("play-game", { ...NEW, token: "forged" });
    expect((await playingNowCounts(env)).get("g-play")).toBe(1);
    expect((await send("play-game", { ticket, seconds: 0, is_away: true })).status).toBe(204);
    expect((await playingNowCounts(env)).get("g-play")).toBeUndefined();
    expect((await send("play-game", { ticket, seconds: 0, is_away: false })).status).toBe(204);
    expect((await playingNowCounts(env)).get("g-play")).toBe(1);
  });

  it("shows playing now for a single-player game from 3 players up, on its page and the home", async () => {
    await env.DB.prepare("UPDATE games SET play_modes = 'single', multiplayer_mode = 'none' WHERE id = 'g-play'").run();
    for (let i = 0; i < 2; i++) await issueTicket(env.DB, "g-play", NEW);
    const page = async () => (await SELF.fetch(`${SITE}/g/play-game`)).text();
    const home = async () => (await SELF.fetch(`${SITE}/`)).text();
    expect(await page()).toMatch(/id="playing-now" hidden><ul class="glance"><li>[\s\S]*?<b>2<\/b> playing now/);
    expect(await home()).not.toContain("<b>2</b> playing now");
    await issueTicket(env.DB, "g-play", NEW);
    expect(await page()).toMatch(/id="playing-now"><ul class="glance"><li>[\s\S]*?<b>3<\/b> playing now/);
    expect(await home()).toContain("<b>3</b> playing now");
  });

  it("only takes plays of games players can open, sent from Zaisma", async () => {
    expect((await send("play-hidden", NEW)).status).toBe(404);
    expect((await send("nope", NEW)).status).toBe(404);
    expect((await send("play-game", NEW, { origin: "https://evil.example" })).status).toBe(403);
    expect((await SELF.fetch(`${SITE}/api/plays/play-game`, { method: "POST", body: "{not json", headers: { origin: SITE } })).status).toBe(400);
    expect((await send("play-game", { ticket: "../../x", counted: true })).status).toBe(400);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM play_days").first("n")).toBe(0);
  });

  it("works out how many new players came back, from counted plays", async () => {
    const now = Date.parse("2026-10-20T12:00:00Z");
    const play = async (at: string, cfirst: string | null, clast: string | null, seconds = 0) => {
      const t = Date.parse(at);
      const facts = { first: cfirst, last: clast, cfirst, clast };
      await countStart(env.DB, "g-play", facts, t);
      const id = await issueTicket(env.DB, "g-play", facts, t);
      if (seconds) await addTime(env.DB, "g-play", id, seconds, t + seconds * 1000);
      await countTicket(env.DB, "g-play", id, COMCAST, t + Math.max(60, seconds) * 1000);
    };
    // 4 new players on Oct 10; 2 came back the next day and 1 a week later.
    for (let i = 0; i < 4; i++) await play("2026-10-10T09:00:00Z", null, null);
    for (let i = 0; i < 2; i++) await play("2026-10-11T09:00:00Z", "2026-10-10", "2026-10-10");
    await play("2026-10-17T09:00:00Z", "2026-10-10", "2026-10-11", 600);

    const stats = await playStats(env.DB, "g-play", 30, now);
    expect(stats.play_count).toBe(7);
    expect(stats.started_play_count).toBe(7);
    expect(stats.new_player_count).toBe(4);
    expect(stats.play_duration_min).toBe(10);
    expect(stats.average_play_duration_min).toBe(1.4);
    expect(stats.came_back.after_1_day).toEqual({ returned_pct: 50, returned_player_count: 2, new_player_count: 4 });
    expect(stats.came_back.after_7_days).toEqual({ returned_pct: 25, returned_player_count: 1, new_player_count: 4 });
    expect(stats.came_back.after_30_days).toEqual({ returned_pct: null, returned_player_count: 0, new_player_count: 0 });
    expect(stats.days.map((day) => day.date)).toEqual(["2026-10-10", "2026-10-11", "2026-10-17"]);
  });

  it("gives a checked browser in a multiplayer game its key to player passes", async () => {
    // A single-player game: no key.
    expect(await (await send("play-game", { ...NEW, token: "good" })).json()).not.toHaveProperty("key");
    await env.DB.prepare("UPDATE games SET multiplayer_mode = 'relay' WHERE id LIKE 'g-play%'").run();
    const both = await (await send("play-game", { ...NEW, token: "good" })).json<{ ticket: string; key: string }>();
    expect(both.ticket).toMatch(/^play_ticket_[a-z0-9]+$/);
    expect(await env.DB.prepare("SELECT game_id, pass_count FROM room_keys WHERE id = ?").bind(both.key).first()).toEqual({ game_id: "g-play", pass_count: 0 });
    expect((await send("play-game", { ...NEW, token: "forged" })).status).toBe(204);
  });

  it("gives a tester link's checked browser a key, never counting the play", async () => {
    await env.DB.prepare("INSERT INTO tester_links (id, game_id, name, token, created_at_ms) VALUES ('t1', 'g-play-hidden', 'Team', 'abcdefghij0123456789', ?)").bind(Date.now()).run();
    const tester = { tester: "abcdefghij0123456789", token: "good" };
    // A single-player game has nothing to check for.
    expect((await send("play-hidden", tester)).status).toBe(204);
    await env.DB.prepare("UPDATE games SET multiplayer_mode = 'relay' WHERE id = 'g-play-hidden'").run();
    const { key } = await (await send("play-hidden", tester)).json<{ key: string }>();
    expect(key).toMatch(/^room_key_[a-z0-9]+$/);
    expect((await send("play-hidden", { ...tester, token: "forged" })).status).toBe(204);
    expect((await send("play-game", tester)).status).toBe(404);
    expect((await send("play-hidden", { ...tester, tester: "abcdefghij0123456780" })).status).toBe(404);
    // On a build players don't have yet, no key: online play would reach the live version's rooms and data.
    await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES ('v-next', 'g-play-hidden', 'games/p/next', 1, 0, 'approved', 9)").run();
    await env.DB.prepare("UPDATE tester_links SET version_choice = 'newest_passed' WHERE id = 't1'").run();
    expect(await (await send("play-hidden", tester)).text()).toBe("");
    await env.DB.prepare("UPDATE tester_links SET version_choice = 'live' WHERE id = 't1'").run();
    // Past its end date, no more keys.
    await env.DB.prepare("UPDATE tester_links SET ends_at_ms = ? WHERE id = 't1'").bind(Date.now() - 1).run();
    expect((await send("play-hidden", tester)).status).toBe(404);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM play_days").first("n")).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM play_tickets").first("n")).toBe(0);
  });

  it("checks on the game page, and through a tester link only for multiplayer", async () => {
    const res = await SELF.fetch(`${SITE}/g/play-game`);
    expect(res.headers.get("content-security-policy")).toContain("https://challenges.cloudflare.com");
    const page = await res.text();
    expect(pageScriptNames(page)).toContain("play-counter");
    expect(pageDataOf(page, "game-page-data")).toMatchObject({ slug: "play-game", tester_token: null, turnstile_site_key: "test-site-key" });
    expect(page).toContain('id="play-check"');
    expect(await pageScriptText(page, (path) => SELF.fetch(`${SITE}${path}`))).toMatch(/if \(!gamePage\.tester_token\) remember\(\);\s*if \(!gamePage\.tester_token \|\| gamePage\.is_multiplayer\) countPlay\(\);/);
    await env.DB.prepare("INSERT INTO tester_links (id, game_id, name, token, created_at_ms) VALUES ('t1', 'g-play-hidden', 'Team', 'abcdefghij0123456789', ?)").bind(Date.now()).run();
    const tester = await SELF.fetch(`${SITE}/t/abcdefghij0123456789`);
    expect(tester.status).toBe(200);
    expect(tester.headers.get("content-security-policy")).not.toContain("challenges.cloudflare.com");
    // No play reports (signing in while playing still tells the game who the player is).
    expect(pageScriptNames(await tester.text())).not.toContain("play-counter");
    // A multiplayer game checks the browser for its player passes, without counting the play.
    await env.DB.prepare("UPDATE games SET multiplayer_mode = 'relay' WHERE id = 'g-play-hidden'").run();
    const multi = await SELF.fetch(`${SITE}/t/abcdefghij0123456789`);
    expect(multi.headers.get("content-security-policy")).toContain("https://challenges.cloudflare.com");
    const text = await multi.text();
    expect(pageScriptNames(text)).toContain("play-counter");
    expect(pageDataOf(text, "game-page-data")).toMatchObject({ tester_token: "abcdefghij0123456789", is_multiplayer: true });
    expect(await pageScriptText(text, (path) => SELF.fetch(`${SITE}${path}`))).toContain('"zaisma:room-key"');
  });
});

describe("faked plays", () => {
  it("leaves cloud networks out of the shelves, and caps any one network", () => {
    const network = (autonomousSystemNumber: number, playerCount: number) => ({ autonomous_system_number: autonomousSystemNumber, player_count: playerCount });
    expect(shelfPlayers([network(COMCAST, 5), network(AMAZON, 500)])).toBe(5);
    // 100 players: no network carries more than 30 of them.
    expect(shelfPlayers([network(COMCAST, 90), network(3320, 10)])).toBe(40);
    // Small games: up to 10 from one network.
    expect(shelfPlayers([network(COMCAST, 12)])).toBe(10);
    // Bots on cloud servers don't raise the share one network can carry.
    expect(shelfPlayers([network(COMCAST, 90), network(3320, 10), network(AMAZON, 10_000)])).toBe(40);
  });

  it("flags a spike, and admin can remove the day's counts", async () => {
    const now = Date.parse("2026-10-20T12:00:00Z");
    for (let i = 1; i <= 7; i++) await env.DB.prepare("INSERT INTO play_days (game_id, date, play_count, player_count) VALUES ('g-play', ?, 4, 4)").bind(day(now - i * DAY)).run();
    await env.DB.prepare("INSERT INTO play_days (game_id, date, started_play_count, play_count, player_count) VALUES ('g-play', ?, 300, 200, 200)").bind(day(now)).run();
    await env.DB.prepare("INSERT INTO play_networks (game_id, date, autonomous_system_number, player_count) VALUES ('g-play', ?1, ?2, 150), ('g-play', ?1, ?3, 50)").bind(day(now), AMAZON, COMCAST).run();
    const [spike] = await playSpikes(env.DB, now);
    expect(spike).toMatchObject({ game_id: "g-play", date: day(now), player_count: 200, usual_players_per_day: 4, network_count: 2, biggest_network_pct: 75, hosting_network_pct: 75 });

    await clearCountedDay(env.DB, "g-play", day(now));
    expect(await env.DB.prepare("SELECT started_play_count, play_count, player_count FROM play_days WHERE game_id = 'g-play' AND date = ?").bind(day(now)).first()).toEqual({ started_play_count: 300, play_count: 0, player_count: 0 });
    expect(await playSpikes(env.DB, now)).toEqual([]);
  });
});

describe("home page shelves", () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  const show = (slug: string, firstPublishedAtMs: number | null = null) => ({ slug, title: slug, description: "", developer: null, owner_id: null, cover: null, square: null, published_at_ms: null, first_published_at_ms: firstPublishedAtMs, modes: "", devices: [], playing_now_player_count: 0 });
  // Players spread over five providers, so no one network is capped.
  const players = async (id: string, ago: number, n: number) => {
    for (const [i, asn] of [7922, 3320, 5089, 2856, 701].entries()) {
      const share = Math.floor(n / 5) + (i < n % 5 ? 1 : 0);
      if (!share) continue;
      await env.DB
        .prepare("INSERT INTO play_networks (game_id, date, autonomous_system_number, player_count) VALUES (?, ?, ?, ?) ON CONFLICT (game_id, date, autonomous_system_number) DO UPDATE SET player_count = player_count + excluded.player_count")
        .bind(id, day(now - ago * DAY), asn, share)
        .run();
    }
  };

  it("ranks popular by players this week and trending by players above the usual", async () => {
    const t = Date.now();
    for (const id of ["a", "b", "c", "d"]) await env.DB.prepare("INSERT INTO games (id, slug, title, review_status, visibility, live_version_id, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 'live', 'listed', 'v1', ?, ?)").bind(`g-play-${id}`, `play-${id}`, id, t, t).run();
    // a: steady and big. b: steady and smaller. c: quiet, then a lot of players in the last 3 days.
    // d: only played two weeks ago.
    for (let i = 0; i < 17; i++) {
      await players("g-play-a", i, 40);
      await players("g-play-b", i, 10);
      await players("g-play-c", i, i < 3 ? 25 : 2);
    }
    await players("g-play-d", 12, 500);
    const games = ["a", "b", "c", "d"].map((x) => show(`play-${x}`, x === "d" ? now - 5 * DAY : x === "c" ? now - 20 * DAY : now - 200 * DAY));
    const { popular, trending, fresh } = await shelves(env, games, 18, now);
    expect(popular.map((g) => g.slug)).toEqual(["play-a", "play-c", "play-b"]);
    // Only c is above its usual, and one game isn't a shelf.
    expect(trending).toEqual([]);
    // Bots on cloud servers don't move a game.
    await env.DB.prepare("INSERT INTO play_networks (game_id, date, autonomous_system_number, player_count) VALUES ('g-play-b', ?, ?, 100000)").bind(day(now), AMAZON).run();
    expect((await shelves(env, games, 18, now)).trending).toEqual([]);
    await players("g-play-b", 0, 300);
    expect((await shelves(env, games, 18, now)).trending.map((g) => g.slug)).toEqual(["play-b", "play-c"]);
    expect(fresh.map((g) => g.slug)).toEqual(["play-d", "play-c"]);
    // Admin can keep a game off every shelf.
    await env.DB.prepare("UPDATE games SET is_off_shelves = 1 WHERE id IN ('g-play-b', 'g-play-d')").run();
    const after = await shelves(env, games, 18, now);
    expect(after.popular.map((g) => g.slug)).toEqual(["play-a", "play-c"]);
    expect(after.fresh).toEqual([]);
  });
});
