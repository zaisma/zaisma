import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createAccount, createGame, personOwner } from "@zaisma/core";
import "../../apps/site/src/index.ts";
import { BROWSE_PAGE_GAME_COUNT, browseQuery, deviceNote } from "../../apps/site/src/browse.ts";
import { viewerDeviceKind } from "../../apps/site/src/device-kind.ts";
import { HOME_SCRIPT } from "../../apps/site/src/home-script.ts";

const SITE = "https://zaisma.test";
const DAY_MS = 86_400_000;
const day = (agoDays: number) => new Date(Date.now() - agoDays * DAY_MS).toISOString().slice(0, 10);
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

interface SeedGame {
  slug: string;
  title: string;
  /** Players each of the last days, on five networks so no one network is capped; 0 for none. */
  dailyPlayerCount?: number;
  publishedAgoDays: number;
  devices?: string;
  controls?: string;
  genres?: string;
  playModes?: string;
}

const GAMES: SeedGame[] = [
  { slug: "browse-crowded", title: "Crowded Keep", dailyPlayerCount: 20, publishedAgoDays: 40, genres: "strategy" },
  { slug: "browse-busy", title: "Busy Harbor", dailyPlayerCount: 8, publishedAgoDays: 30, genres: "simulation", playModes: '[{"mode":"online","minimum_player_count":2,"maximum_player_count":8,"play_style":"together"}]' },
  { slug: "browse-keys", title: "Key Tactics", dailyPlayerCount: 5, publishedAgoDays: 20, devices: "computer", controls: "keyboard_mouse", genres: "strategy,role_playing" },
  { slug: "browse-thumbs", title: "Thumb Garden", publishedAgoDays: 2, devices: "phone", controls: "touch", genres: "puzzle" },
  { slug: "browse-quiet", title: "Quiet Lake", publishedAgoDays: 1, genres: "adventure" },
];

/** The covers' games on a Browse page, in order, and which list each is in. */
async function browse(query = "", init: RequestInit = {}): Promise<{ response: Response; text: string; slugs: string[]; otherSlugs: string[] }> {
  const response = await SELF.fetch(`${SITE}/games${query}`, init);
  const text = await response.text();
  const slugsIn = (id: string) => {
    const start = text.indexOf(`id="${id}"`);
    const end = id === "browse-games" ? text.indexOf('id="browse-other-games"') : text.indexOf("</section>", start);
    return start === -1 ? [] : [...text.slice(start, end).matchAll(/href="\/g\/(browse-[a-z0-9-]+)"/g)].map((match) => match[1]!).filter((slug, index, all) => all.indexOf(slug) === index);
  };
  return { response, text, slugs: slugsIn("browse-games"), otherSlugs: slugsIn("browse-other-games") };
}

beforeAll(async () => {
  await env.DB.exec(`DELETE FROM play_networks; DELETE FROM versions WHERE id LIKE 'v-browse-%'; DELETE FROM games WHERE slug LIKE 'browse-%';`);
  await createAccount(env.DB, { id: "browse-dev", username: "Lake_Studio", ageBand: "18+" });
  const owner = await personOwner(env.DB, "browse-dev");
  for (const seed of GAMES) {
    const game = await createGame(env.DB, { slug: seed.slug, title: seed.title, description: `About ${seed.title}.`, ownerId: owner.id, visibility: "listed" });
    await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, patch_notes, published_at_ms, created_at_ms) VALUES (?, ?, ?, 1, 0, 'approved', '', ?, 0)").bind(`v-${seed.slug}`, game.id, `games/${seed.slug}/v1`, Date.now() - seed.publishedAgoDays * DAY_MS).run();
    await env.DB.prepare("UPDATE games SET review_status = 'live', live_version_id = ?, devices = ?, controls = ?, genres = ?, play_modes = COALESCE(?, play_modes) WHERE id = ?")
      .bind(`v-${seed.slug}`, seed.devices ?? "", seed.controls ?? "", seed.genres ?? "", seed.playModes ?? null, game.id)
      .run();
    for (const agoDays of [1, 2, 3, 4, 5, 6]) {
      for (const asn of [7922, 3320, 5089, 2856, 701]) {
        if (seed.dailyPlayerCount) await env.DB.prepare("INSERT INTO play_networks (game_id, date, autonomous_system_number, player_count) VALUES (?, ?, ?, ?)").bind(game.id, day(agoDays), asn, seed.dailyPlayerCount).run();
      }
    }
  }
});

describe("Browse's link", () => {
  it("reads the sort, filter, search and page, falling back to the defaults for anything else", () => {
    expect(browseQuery(new URL(`${SITE}/games`))).toEqual({ sort: "popular", filter: "all", searchText: "", pageNumber: 1 });
    expect(browseQuery(new URL(`${SITE}/games?sort=new&filter=horror&search_text=%20lake%20&page=3`))).toEqual({ sort: "new", filter: "horror", searchText: "lake", pageNumber: 3 });
    expect(browseQuery(new URL(`${SITE}/games?sort=best&filter=rpg&page=-2`))).toEqual({ sort: "popular", filter: "all", searchText: "", pageNumber: 1 });
    expect(browseQuery(new URL(`${SITE}/games?search_text=${"a".repeat(200)}`)).searchText).toHaveLength(80);
  });
});

describe("the viewer's device", () => {
  it("is what the page script measured, else a guess from the browser's name", () => {
    const request = (headers: Record<string, string>) => new Request(SITE, { headers });
    expect(viewerDeviceKind(request({ cookie: "a=1; zaisma_device_kind=tablet" }))).toBe("tablet");
    expect(viewerDeviceKind(request({ cookie: "zaisma_device_kind=watch", "user-agent": IPHONE }))).toBe("phone");
    expect(viewerDeviceKind(request({ "user-agent": "Mozilla/5.0 (Linux; Android 15; SM-X910) AppleWebKit/537.36 Chrome/130.0 Safari/537.36" }))).toBe("tablet");
    expect(viewerDeviceKind(request({ "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 Safari/605.1.15" }))).toBe("computer");
  });

  it("gives a game made for other devices the game page's own note", () => {
    expect(deviceNote({ devices: [], controls: [] }, "phone")).toBeNull();
    expect(deviceNote({ devices: ["phone", "computer"], controls: ["touch"] }, "phone")).toBeNull();
    expect(deviceNote({ devices: ["computer"], controls: ["keyboard_mouse"] }, "phone")).toBe("Needs a keyboard");
    expect(deviceNote({ devices: ["computer"], controls: ["gamepad"] }, "tablet")).toBe("Needs a gamepad");
    expect(deviceNote({ devices: ["computer"], controls: ["gamepad"] }, "computer")).toBeNull();
    expect(deviceNote({ devices: ["phone"], controls: ["touch"] }, "computer")).toBe("Made for phones");
    expect(deviceNote({ devices: ["tablet", "phone"], controls: [] }, "computer")).toBe("Made for tablets and phones");
  });
});

describe("Browse", () => {
  it("lists every listed game, most played this week first, then the rest newest first", async () => {
    const { response, text, slugs } = await browse("", { headers: { cookie: "zaisma_device_kind=computer" } });
    expect(response.status).toBe(200);
    expect(slugs.slice(0, 3)).toEqual(["browse-crowded", "browse-busy", "browse-keys"]);
    expect(slugs.indexOf("browse-quiet")).toBeGreaterThan(slugs.indexOf("browse-keys"));
    expect(text).toContain('aria-current="page"');
    expect(text).toMatch(/<h1>Browse<\/h1>/);
  });

  it("sorts by New and Recently updated", async () => {
    const { slugs: fresh } = await browse("?sort=new", { headers: { cookie: "zaisma_device_kind=computer" } });
    expect(fresh.indexOf("browse-quiet")).toBeLessThan(fresh.indexOf("browse-crowded"));
    const { slugs: updated } = await browse("?sort=updated", { headers: { cookie: "zaisma_device_kind=computer" } });
    expect(updated.indexOf("browse-quiet")).toBeLessThan(updated.indexOf("browse-busy"));
  });

  it("filters by Multiplayer and by a genre", async () => {
    const { slugs: multiplayer } = await browse("?filter=multiplayer", { headers: { cookie: "zaisma_device_kind=computer" } });
    expect(multiplayer).toEqual(["browse-busy"]);
    const { slugs: strategy } = await browse("?filter=strategy", { headers: { cookie: "zaisma_device_kind=computer" } });
    expect(strategy).toEqual(["browse-crowded", "browse-keys"]);
  });

  it("searches titles, developers and genre labels, ignoring case", async () => {
    const headers = { cookie: "zaisma_device_kind=computer" };
    expect((await browse("?search_text=LAKE", { headers })).slugs).toEqual(expect.arrayContaining(["browse-quiet", "browse-crowded"]));
    expect((await browse("?search_text=garden", { headers })).otherSlugs).toEqual(["browse-thumbs"]);
    expect((await browse("?search_text=role-playing", { headers })).slugs).toEqual(["browse-keys"]);
  });

  it("says when nothing matches, with a way back", async () => {
    const { text } = await browse("?search_text=zzzz-nothing");
    expect(text).toContain("No games match");
    expect(text).toContain("Clear search");
    const { text: emptyFilter } = await browse("?filter=horror");
    expect(emptyFilter).toContain("No horror games yet");
  });

  it("puts games for the viewer's device first, the rest after a divider with their note", async () => {
    const phone = await browse("", { headers: { "user-agent": IPHONE } });
    expect(phone.slugs).not.toContain("browse-keys");
    expect(phone.slugs).toContain("browse-thumbs");
    expect(phone.otherSlugs).toEqual(["browse-keys"]);
    expect(phone.text).toContain("Made for computers");
    expect(phone.text).toContain("Needs a keyboard");
    expect(phone.text).toContain('data-device-kind="phone"');
    const computer = await browse("", { headers: { cookie: "zaisma_device_kind=computer" } });
    expect(computer.otherSlugs).toEqual(["browse-thumbs"]);
    expect(computer.text).toContain("Made for phones");
    expect(computer.response.headers.get("vary")).toContain("Cookie");
  });

  it("pages after 48 games, the next page a link that also loads as you scroll", async () => {
    const owner = await personOwner(env.DB, "browse-dev");
    for (let index = 0; index < BROWSE_PAGE_GAME_COUNT; index += 1) {
      const slug = `browse-filler-${index}`;
      const game = await createGame(env.DB, { slug, title: `Filler ${index}`, description: "Filler.", ownerId: owner.id, visibility: "listed" });
      await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, patch_notes, published_at_ms, created_at_ms) VALUES (?, ?, ?, 1, 0, 'approved', '', ?, 0)").bind(`v-${slug}`, game.id, `games/${slug}/v1`, Date.now() - (100 + index) * DAY_MS).run();
      await env.DB.prepare("UPDATE games SET review_status = 'live', live_version_id = ? WHERE id = ?").bind(`v-${slug}`, game.id).run();
    }
    const first = await browse("", { headers: { cookie: "zaisma_device_kind=computer" } });
    expect(first.text).toMatch(/data-load-more="browse-games browse-other-games"/);
    expect(first.text).toContain("data-loads-on-scroll");
    expect(first.text).toContain('href="/games?page=2"');
    const second = await browse("?page=2", { headers: { cookie: "zaisma_device_kind=computer" } });
    expect([...second.slugs, ...second.otherSlugs].some((slug) => first.slugs.includes(slug))).toBe(false);
    expect(second.otherSlugs).toContain("browse-thumbs");
  });

  it("is in the header, which searches games from player pages", async () => {
    const { text } = await browse();
    expect(text).toMatch(/href="\/games"[^>]*aria-current="page"[^>]*>[\s\S]*?Browse/);
    expect(text).toMatch(/<form[^>]*action="\/games"/);
    const home = await (await SELF.fetch(`${SITE}/`)).text();
    expect(home).toMatch(/<form[^>]*action="\/games"/);
  });
});

describe("the home's rows", () => {
  it("put games for this device first, and keep the device for Browse", () => {
    expect(HOME_SCRIPT.sourceText).toContain("zaisma_device_kind");
    expect(HOME_SCRIPT.sourceText).toMatch(/\["track-popular", "track-trending", "track-new"\]/);
  });

  it("carry each game's devices for the script", async () => {
    const text = await (await SELF.fetch(`${SITE}/`)).text();
    const data = JSON.parse(text.match(/<script type="application\/json" id="home-data">([\s\S]*?)<\/script>/)![1]!);
    expect(data.games.find((game: { slug: string }) => game.slug === "browse-thumbs").devices).toEqual(["phone"]);
  });
});
