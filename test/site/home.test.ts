import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createAccount, createGame, personOwner, setBackground } from "@zaisma/core";
import "../../apps/site/src/index.ts";
import { HOME_SCRIPT, PLAYED_COOKIE } from "../../apps/site/src/home-script.ts";
import { cookieName } from "../../apps/site/src/auth.ts";
import { sessionCookie, useSessions } from "../grid/site-world.ts";

/**
 * The home page (apps/site/src/home.ts): two panes over Zaisma's own world. First what's for the player tonight, then what else is here.
 */

const SITE = "https://zaisma.test";
const DAY_MS = 86_400_000;
const day = (agoDays: number) => new Date(Date.now() - agoDays * DAY_MS).toISOString().slice(0, 10);

const LIVE_SLUGS = ["home-one", "home-two", "home-three", "home-four", "home-five", "home-six", "home-seven", "home-eight", "home-nine", "home-ten"];

async function homePage(cookies: Record<string, string> = {}): Promise<{ response: Response; text: string; data: { games: { slug: string; owner_id?: string; id?: string; description?: string; [field: string]: unknown }[] } }> {
  const cookie = Object.entries(cookies).map(([name, cookieValue]) => `${cookieName(env, name)}=${cookieValue}`).join("; ");
  const response = await SELF.fetch(`${SITE}/`, { headers: cookie ? { cookie } : {} });
  const text = await response.text();
  const data = JSON.parse(text.match(/<script type="application\/json" id="home-data">([\s\S]*?)<\/script>/)![1]!);
  return { response, text, data };
}

beforeAll(async () => {
  await env.DB.exec(`DELETE FROM game_backgrounds; DELETE FROM game_shaders; DELETE FROM play_networks; DELETE FROM versions WHERE id LIKE 'v-home-%'; DELETE FROM game_images WHERE id = 'image-home-world'; DELETE FROM game_images WHERE game_id IN (SELECT id FROM games WHERE slug LIKE 'home-%'); DELETE FROM games WHERE slug LIKE 'home-%';`);
  await createAccount(env.DB, { id: "home-dev", username: "Home_Dev", ageBand: "18+" });
  const owner = await personOwner(env.DB, "home-dev");
  const now = Date.now();
  for (const [index, slug] of LIVE_SLUGS.entries()) {
    const game = await createGame(env.DB, { slug, title: `Home ${slug}`, description: `About ${slug}.`, ownerId: owner.id, visibility: "listed" });
    await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, patch_notes, published_at_ms, created_at_ms) VALUES (?, ?, ?, 1, 0, 'approved', '', ?, 0)").bind(`v-home-${slug}`, game.id, `games/${slug}/v1`, now - index * DAY_MS).run();
    await env.DB.prepare("UPDATE games SET review_status = 'live', live_version_id = ?, first_published_at_ms = ? WHERE id = ?").bind(`v-home-${slug}`, now - index * DAY_MS, game.id).run();
    // The first ten games all have players this week, the earlier ones more (five providers, so no one network is capped).
    for (const [providerIndex, asn] of [7922, 3320, 5089, 2856, 701].entries()) {
      await env.DB.prepare("INSERT INTO play_networks (game_id, date, autonomous_system_number, player_count) VALUES (?, ?, ?, ?)").bind(game.id, day(1), asn, 30 - index + providerIndex).run();
    }
  }
  // One game has a picture for its background, another a shader.
  const two = await env.DB.prepare("SELECT id FROM games WHERE slug = 'home-two'").first<{ id: string }>();
  await env.DB.prepare("INSERT INTO game_images (id, game_id, kind, content_type, width_px, height_px, size_bytes, review_status, created_at_ms) VALUES ('image-home-world', ?, 'background', 'image/webp', 1920, 1080, 100, 'approved', ?)").bind(two!.id, now).run();
  await setBackground(env.DB, two!.id, "wide", "image", "image-home-world", null);
  const three = await env.DB.prepare("SELECT id FROM games WHERE slug = 'home-three'").first<{ id: string }>();
  await env.DB.prepare("INSERT INTO game_shaders (id, game_id, screen, size_bytes, review_status, created_at_ms) VALUES ('shader-home-three', ?, 'wide', 10, 'approved', ?)").bind(three!.id, now).run();
  await setBackground(env.DB, three!.id, "wide", "shader", null, "shader-home-three");
  // The shader's tone was measured when the check drew it; the picture's wasn't (one kept before tones were).
  await env.DB.prepare("UPDATE game_shaders SET average_color = '#101828', is_glass_smoked = 1, glass_tint_pct = 46 WHERE id = 'shader-home-three'").run();
});

/** The part of the page from an element with this id to the next with that id. */
const between = (text: string, fromId: string, toId: string) => text.slice(text.indexOf(`id="${fromId}"`), text.indexOf(`id="${toId}"`));
const coverSlugs = (markup: string) => [...markup.matchAll(/<a class="cover-art[^>]* href="\/g\/([a-z-]+)"/g)].map((found) => found[1]);

describe("the home page", () => {
  it("opens a first visit on the line flat on the backdrop, What's on alone, then each row of games on a pane of its own", async () => {
    const { text } = await homePage();
    expect(text).toMatch(/<div class="stack-cell[^"]*" id="home-first-visit"><div class="backdrop-words"><h1>One place to play every kind of game\.<\/h1><p>Press Play, install nothing, bring your friends\.<\/p>/);
    // Playing now's games are all in What's on here, so its row drops out; Popular is a pane of its own.
    expect(text).toMatch(/<section class="glass glass-pane full"[^>]*aria-label="Popular"><svg[\s\S]*?<section class="game-row" id="popular"/);
    const whatsOn = text.slice(text.indexOf('id="home-first-visit"'), text.indexOf('aria-label="Popular"'));
    expect(coverSlugs(whatsOn)).toHaveLength(3);
    expect(whatsOn).toContain("is-lead-wide");
    expect(text).not.toContain('id="never-played"');
  });

  it("shows nothing of Zaisma's on a cover: tags sit on the title's line, in place of the count", async () => {
    const { text } = await homePage();
    expect(text).not.toContain("cover-mark");
    expect(text).toMatch(/<div class="cover-meta"><span class="cover-name one-line">[^<]*<\/span><span class="tag new"/);
    for (const art of text.matchAll(/<a class="cover-art[\s\S]*?<\/a>/g)) expect(art[0]).not.toContain('class="tag');
  });

  it("opens a returning guest on their game beside What's on, with Play and Details, and leaves that game out of What's on", async () => {
    const { text } = await homePage({ [PLAYED_COOKIE]: "home-three,home-one" });
    expect(text).not.toContain("backdrop-words");
    expect(text).toContain("lead-and-side");
    const lead = text.slice(text.indexOf('class="lead-and-side-lead"'), text.indexOf('class="lead-and-side-side"'));
    expect(coverSlugs(lead)).toEqual(["home-three"]);
    expect(lead).toContain('href="/g/home-three?play"');
    // Play and Details' icon end the title's line, and no card says what kind of game it is.
    expect(lead).toMatch(/<div class="cover-meta has-actions">[\s\S]*?cover-name[\s\S]*?href="\/g\/home-three\?play"/);
    expect(text).not.toContain('class="cover-actions"><div class="layout-row');
    const sideStart = text.indexOf('class="lead-and-side-side"');
    const side = text.slice(sideStart, text.indexOf('<section class="glass glass-pane', text.indexOf('id="whats-on"', sideStart)));
    expect(coverSlugs(side)).toHaveLength(2);
    expect(coverSlugs(side)).not.toContain("home-three");
    expect(text).toContain('id="never-played"');
  });

  it("leaves out a row whose games all showed higher up", async () => {
    const { text } = await homePage({ [PLAYED_COOKIE]: "home-one" });
    const shelfIds = [...text.matchAll(/<h2 class="game-row-title" id="([a-z-]+)/g)].map((found) => found[1]);
    expect(new Set(shelfIds).size).toBe(shelfIds.length);
    expect(text).not.toMatch(/id="new-title"/);
  });

  it("shows no game's world: its background stays on the game's page", async () => {
    const { text } = await homePage();
    expect(text).not.toContain("image-home-world");
    expect(text).not.toContain("shader-home-three");
    expect(text).not.toContain("data-world");
  });

  it("keeps the games' owners, IDs and everything else out of what the browser gets", async () => {
    const { data } = await homePage();
    expect(Object.keys(data)).toEqual(["account_played"]);
  });

  it("is the same page for everyone without a cookie, so it caches", async () => {
    const first = await homePage();
    const second = await homePage();
    expect(second.text).toBe(first.text);
    expect(first.response.headers.get("cache-control")).not.toBe("no-store");
  });

  it("shows player news as a card among What's on's, tagged News, and never as a line of its own", async () => {
    const now = Date.now();
    await env.DB.prepare("INSERT INTO whats_on_entries (id, entry_kind, title, link_url, starts_at_ms, ends_at_ms, created_at_ms, created_by) VALUES ('whats_on_entry_homenews', 'news', 'Jam winners', '/games', ?, ?, ?, 'test')").bind(now - 1000, now + DAY_MS, now).run();
    const { text } = await homePage();
    expect(text).toMatch(/id="whats-on"[\s\S]*?Jam winners[\s\S]*?>News</);
    expect(text).not.toMatch(/class="banner[\s"][^>]*>(?:(?!<\/section>)[\s\S])*?Jam winners/);
    await env.DB.prepare("DELETE FROM whats_on_entries WHERE id = 'whats_on_entry_homenews'").run();
  });

  it("runs an event's art across the top until it ends, in a well on a pane, with its name for a screen reader and its one button, and nothing to close it with", async () => {
    const now = Date.now();
    await env.DB.prepare("INSERT INTO whats_on_entries (id, entry_kind, title, wide_art_key, link_url, starts_at_ms, ends_at_ms, created_at_ms, created_by) VALUES ('whats_on_entry_homeevent', 'event', 'Zombie weekend', 'k', '/games', ?, ?, ?, 'test')").bind(now - 1000, now + DAY_MS, now).run();
    const { text } = await homePage();
    expect(text).toMatch(/id="home-event"[\s\S]*?<img class="reveals" src="\/whats-on-art\/whats_on_entry_homeevent\/wide"[^>]*alt="Zombie weekend"/);
    expect(text).toContain("Go play");
    expect(text).not.toContain("banner_close");
    expect(text).toMatch(/id="home-event"[\s\S]*?<div class="event-banner"><section class="glass glass-pane full compact"[\s\S]*?<div class="well carving event-banner-well holds-art"/);
    await env.DB.prepare("UPDATE whats_on_entries SET ends_at_ms = ? WHERE id = 'whats_on_entry_homeevent'").bind(now - 1).run();
    expect((await homePage()).text).not.toContain('id="home-event"');
    await env.DB.prepare("DELETE FROM whats_on_entries WHERE id = 'whats_on_entry_homeevent'").run();
  });

  it("opens a device that played before the cookie kept it again, once, and asks for nothing else", () => {
    expect(HOME_SCRIPT.sourceText).toContain("location.reload()");
    expect(HOME_SCRIPT.sourceText).not.toContain("fetch(");
    expect(HOME_SCRIPT.sourceText).not.toContain("getGamepads");
  });

  it("refuses to be framed by other sites, as every page does", async () => {
    const { response } = await homePage();
    expect(response.headers.get("Content-Security-Policy") ?? "").toMatch(/frame-ancestors '(none|self)'(;|$)/);
  });
});

describe("the home's friends playing", () => {
  it("shows at most 10 games friends are in, most friends first, as game cards in a carved row whose See all opens /friends", async () => {
    await useSessions();
    await createAccount(env.DB, { id: "home-viewer", username: "Home_Viewer", ageBand: "18+" });
    const owner = await personOwner(env.DB, "home-dev");
    const now = Date.now();
    const slugs = [...LIVE_SLUGS, "home-eleven", "home-twelve", "home-thirteen"];
    for (const slug of slugs.slice(LIVE_SLUGS.length)) {
      const game = await createGame(env.DB, { slug, title: `Home ${slug}`, description: `About ${slug}.`, ownerId: owner.id, visibility: "listed" });
      await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, patch_notes, published_at_ms, created_at_ms) VALUES (?, ?, ?, 1, 0, 'approved', '', ?, 0)").bind(`v-home-${slug}`, game.id, `games/${slug}/v1`, now).run();
      await env.DB.prepare("UPDATE games SET review_status = 'live', live_version_id = ? WHERE id = ?").bind(`v-home-${slug}`, game.id).run();
    }
    // One friend in each of 13 games, and a second in home-thirteen, which so comes first.
    const friends = [...slugs.map((slug) => ({ slug, id: `home-friend-${slug}` })), { slug: "home-thirteen", id: "home-friend-second" }];
    for (const [index, friend] of friends.entries()) {
      await createAccount(env.DB, { id: friend.id, username: `Home_Friend_${index}`, ageBand: "18+" });
      await env.DB.prepare("INSERT INTO friendships (account_id, friend_account_id, created_at_ms) VALUES ('home-viewer', ?, ?), (?, 'home-viewer', ?)").bind(friend.id, now, friend.id, now).run();
      await env.DB.prepare("INSERT INTO presences (account_id, seen_at_ms, game_id, game_seen_at_ms) SELECT ?, ?, id, ? FROM games WHERE slug = ?").bind(friend.id, now, now, friend.slug).run();
    }
    const response = await SELF.fetch(`${SITE}/`, { headers: { cookie: `${await sessionCookie("home-viewer")}; __Host-zaisma_in=1` } });
    const text = await response.text();
    const friendsRow = text.slice(text.indexOf('<section class="game-row" id="friends-playing"'), text.indexOf("</section>", text.indexOf('id="friends-playing"')));
    expect(friendsRow).toContain('href="/friends"');
    expect(coverSlugs(friendsRow)).toHaveLength(10);
    expect(coverSlugs(friendsRow)[0]).toBe("home-thirteen");
    // Who's in it shows as faces before the name, and in the card's label.
    expect(friendsRow).toContain("Home_Friend_12, Home_Friend_13 playing");
  });
});

describe("the home with fewer games", () => {
  it("shows the empty state under two games", async () => {
    await env.DB.exec("UPDATE games SET visibility = 'private' WHERE slug LIKE 'home-%' AND slug != 'home-one'");
    const { text } = await homePage();
    expect(text).toContain("Every kind of game. One link away.");
    expect(text).not.toContain('id="home-games"');
    await env.DB.exec("UPDATE games SET visibility = 'listed' WHERE slug LIKE 'home-%'");
  });
});

describe("the game page in a frame of the home", () => {
  const request = (headers: Record<string, string>) => SELF.fetch(`${SITE}/g/home-one?play`, { headers });

  it("may be framed by Zaisma's own pages, and only by a same-site frame", async () => {
    expect((await request({ "sec-fetch-dest": "iframe", "sec-fetch-site": "same-origin" })).headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
    for (const headers of [{} as Record<string, string>, { "sec-fetch-dest": "iframe", "sec-fetch-site": "cross-site" }, { "sec-fetch-dest": "document", "sec-fetch-site": "same-origin" }]) {
      expect((await request(headers)).headers.get("content-security-policy"), JSON.stringify(headers)).toContain("frame-ancestors 'none'");
    }
  });

  it("tells caches the answer depends on how it was asked for", async () => {
    expect((await request({})).headers.get("vary")).toContain("Sec-Fetch-Dest");
  });
});
