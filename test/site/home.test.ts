import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createAccount, createGame, personOwner, setBackground } from "@zaisma/core";
import "../../apps/site/src/index.ts";

/**
 * The home page (apps/site/src/home.ts): the game in focus with its pane, and the shelf of Continue playing, Popular, Trending and New under it.
 * The page is the same for everyone, so these read it as a stranger sees it.
 */

const SITE = "https://zaisma.test";
const DAY_MS = 86_400_000;
const day = (agoDays: number) => new Date(Date.now() - agoDays * DAY_MS).toISOString().slice(0, 10);

const LIVE_SLUGS = ["home-one", "home-two", "home-three", "home-four", "home-five", "home-six", "home-seven", "home-eight", "home-nine", "home-ten"];

async function homePage(): Promise<{ response: Response; text: string; data: { games: { slug: string; background: unknown; owner_id?: string; id?: string }[]; guest_picks: string[] } }> {
  const response = await SELF.fetch(`${SITE}/`);
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
    await env.DB.prepare("UPDATE games SET review_status = 'live', live_version_id = ? WHERE id = ?").bind(`v-home-${slug}`, game.id).run();
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
});

describe("the home page", () => {
  it("ends with an All games link into Browse, never a grid of every game", async () => {
    const { text } = await homePage();
    expect(text).not.toContain('class="grid"');
    expect(text).toMatch(/<a class="shell text-btn" href="\/games"[^>]*>[\s\S]*?All games/);
  });

  it("lists Popular, then Trending and New when they have games, after Continue playing", async () => {
    const { text } = await homePage();
    const headings = [...text.matchAll(/<h2 id="([a-z]+)-title">/g)].map((match) => match[1]);
    expect(headings[0]).toBe("continue");
    expect(headings).toContain("popular");
    const order = ["continue", "popular", "trending", "new"].filter((id) => headings.includes(id));
    expect(headings).toEqual(order);
    expect(text).toContain('href="/games?sort=popular"');
  });

  it("gives a guest at most Popular's top 8 to open on, in Popular's order", async () => {
    const { text, data } = await homePage();
    expect(data.guest_picks.length).toBeLessThanOrEqual(8);
    expect(data.guest_picks.length).toBeGreaterThan(0);
    // Popular's covers are on the page in its order; the picks are its first ones.
    const popular = text.slice(text.indexOf('id="track-popular"'), text.indexOf("</section>", text.indexOf('id="track-popular"')));
    const onPage = [...popular.matchAll(/href="\/g\/([a-z0-9-]+)"/g)].map((match) => match[1]);
    expect(onPage.slice(0, data.guest_picks.length)).toEqual(data.guest_picks);
    expect(data.guest_picks[0]).toBe("home-one");
  });

  it("links a cover to its game's page and the pane's Play and Details to the game", async () => {
    const { text } = await homePage();
    expect(text).toContain('<a class="cover-art" href="/g/home-one"');
    expect(text).toMatch(/<a class="shell run-wrap" href="\/g\/home-one\?play"/);
    expect(text).toMatch(/<a class="shell cut-btn[^"]*" href="\/g\/home-one"/);
  });

  it("sends a game's background for the browser to put behind the glass, from the game's own site for a shader", async () => {
    const { data } = await homePage();
    const bySlug = Object.fromEntries(data.games.map((game) => [game.slug, game]));
    expect(bySlug["home-one"]!.background).toBeNull();
    expect(bySlug["home-two"]!.background).toMatchObject({ wide: { source: "image", imageUrl: `${SITE}/img/image-home-world` }, phone: { source: "image" } });
    const shader = (bySlug["home-three"]!.background as { wide: { source: string; frameUrl: string; stillUrl: string } }).wide;
    expect(shader.source).toBe("shader");
    // The runner is on the game domain, never zaisma.com; the still its glass is measured from is zaisma.com's.
    expect(new URL(shader.frameUrl).origin).not.toBe(SITE);
    expect(shader.frameUrl).toContain("/_zaisma/background?screen=wide&shader=shader-home-three");
    expect(shader.stillUrl).toBe(`${SITE}/shaders/shader-home-three/still.png`);
  });

  it("keeps the games' owners and IDs out of what the browser gets", async () => {
    const { data } = await homePage();
    for (const game of data.games) {
      expect(game.owner_id).toBeUndefined();
      expect(game.id).toBeUndefined();
    }
  });

  it("is the same page for everyone, so it caches: no per-viewer markup", async () => {
    const first = await homePage();
    const second = await homePage();
    expect(second.text).toBe(first.text);
    expect(first.response.headers.get("cache-control")).not.toBe("no-store");
    // What is the player's own comes from the browser (the guest note, Continue playing) and starts hidden.
    expect(first.text).toMatch(/<section class="home-row" id="home-continue"[^>]*hidden/);
  });

  it("refuses to be framed by other sites, as every page does", async () => {
    const { response } = await homePage();
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
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
