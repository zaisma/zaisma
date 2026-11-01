import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createAccount, createGame, personOwner } from "@zaisma/core";
import "../../apps/site/src/index.ts";
import { BROWSE_PAGE_GAME_COUNT, browseQuery, deviceNote as note } from "../../apps/site/src/browse.ts";
import { viewerDeviceKind } from "../../apps/site/src/device-kind.ts";
import { HOME_SCRIPT } from "../../apps/site/src/home-script.ts";

const SITE = "https://zaisma.test";
const DAY_MS = 86_400_000;
const day = (agoDays: number) => new Date(Date.now() - agoDays * DAY_MS).toISOString().slice(0, 10);
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

interface SeedGame {
  slug: string;
  title: string;
  /** Players each day, on five networks so no one network is capped; 0 for none. */
  dailyPlayerCount?: number;
  publishedAgoDays: number;
  devices?: string;
  controls?: string;
  genres?: string;
  playModes?: string;
  /** Played only in the last 2 days, so it trends. */
  isRising?: boolean;
  /** Set straight on the row: what Browse must leave out, or rank as unplayed. */
  columns?: Record<string, string | number>;
}

const GAMES: SeedGame[] = [
  { slug: "browse-crowded", title: "Crowded Keep", dailyPlayerCount: 20, publishedAgoDays: 40, genres: "strategy" },
  { slug: "browse-busy", title: "Busy Harbor", dailyPlayerCount: 8, publishedAgoDays: 30, genres: "simulation", playModes: '[{"mode":"online","minimum_player_count":2,"maximum_player_count":8,"play_style":"together"}]' },
  { slug: "browse-keys", title: "Key Tactics", dailyPlayerCount: 5, publishedAgoDays: 20, devices: "computer", controls: "keyboard_mouse", genres: "strategy,role_playing" },
  { slug: "browse-thumbs", title: "Thumb Garden", publishedAgoDays: 2, devices: "phone", controls: "touch", genres: "puzzle" },
  { slug: "browse-quiet", title: "Quiet Lake", publishedAgoDays: 1, genres: "adventure" },
  { slug: "browse-rising", title: "Rising Tide", dailyPlayerCount: 4, isRising: true, publishedAgoDays: 10 },
  { slug: "browse-shelved", title: "Shelved Saga", dailyPlayerCount: 50, publishedAgoDays: 70, columns: { is_off_shelves: 1 } },
  { slug: "browse-relay", title: "Relay Race", publishedAgoDays: 15, columns: { multiplayer_mode: "relay" } },
  { slug: "browse-private", title: "Private Peak", dailyPlayerCount: 50, publishedAgoDays: 3, columns: { visibility: "private" } },
  { slug: "browse-held", title: "Held Hollow", dailyPlayerCount: 50, publishedAgoDays: 3, columns: { title_listing_reason: "Held for review." } },
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
    for (const [column, value] of Object.entries(seed.columns ?? {})) await env.DB.prepare(`UPDATE games SET ${column} = ? WHERE id = ?`).bind(value, game.id).run();
    // Played the same every day for two weeks and more, so it doesn't trend; a rising game only in the last 2 days, so it does.
    if (seed.dailyPlayerCount) {
      const rows = (seed.isRising ? [1, 2] : Array.from({ length: 16 }, (_, index) => index + 1)).flatMap((agoDays) => [7922, 3320, 5089, 2856, 701].map((asn) => [game.id, day(agoDays), asn, seed.dailyPlayerCount!]));
      // 20 rows a statement, inside D1's 100 values.
      for (let first = 0; first < rows.length; first += 20) {
        const part = rows.slice(first, first + 20);
        await env.DB.prepare(`INSERT INTO play_networks (game_id, date, autonomous_system_number, player_count) VALUES ${part.map(() => "(?, ?, ?, ?)").join(", ")}`).bind(...part.flat()).run();
      }
    }
  }
});

describe("Browse's link", () => {
  it("reads the sort, genre, players, price, search and page, falling back to the defaults for anything else", () => {
    expect(browseQuery(new URL(`${SITE}/games`))).toEqual({ sort: "popular", genre: "any", players: "any", priceRange: "any", searchText: "", pageNumber: 1 });
    expect(browseQuery(new URL(`${SITE}/games?sort=new&genre=horror&players=multiplayer&price=15_to_30&search_text=%20lake%20&page=3`))).toEqual({ sort: "new", genre: "horror", players: "multiplayer", priceRange: "15_to_30", searchText: "lake", pageNumber: 3 });
    expect(browseQuery(new URL(`${SITE}/games?sort=best&genre=rpg&players=lots&price=cheap&page=-2`))).toEqual({ sort: "popular", genre: "any", players: "any", priceRange: "any", searchText: "", pageNumber: 1 });
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
    const deviceNote = (game: { devices: string[]; controls: string[]; screen_orientation?: string }, deviceKind: Parameters<typeof note>[1]) => note({ screen_orientation: "any", ...game }, deviceKind);
    expect(deviceNote({ devices: [], controls: [] }, "phone")).toBeNull();
    expect(deviceNote({ devices: ["phone", "computer"], controls: ["touch"] }, "phone")).toBeNull();
    expect(deviceNote({ devices: ["computer"], controls: ["keyboard_mouse"] }, "phone")).toBe("Needs a keyboard");
    expect(deviceNote({ devices: ["computer"], controls: ["gamepad"] }, "tablet")).toBe("Needs a gamepad");
    expect(deviceNote({ devices: ["computer"], controls: ["gamepad"] }, "computer")).toBeNull();
    expect(deviceNote({ devices: ["phone"], controls: ["touch"] }, "computer")).toBe("Made for phones");
    expect(deviceNote({ devices: ["tablet", "phone"], controls: [] }, "computer")).toBe("Made for tablets and phones");
    expect(deviceNote({ devices: ["computer"], controls: [], screen_orientation: "landscape" }, "phone")).toBe("Best in landscape");
    expect(deviceNote({ devices: ["computer"], controls: [], screen_orientation: "landscape" }, "tablet")).toBe("Best in landscape");
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

  it("leaves out private and held games, and ranks an off-shelf game as if nobody played it", async () => {
    const { slugs, otherSlugs } = await browse("", { headers: { cookie: "zaisma_device_kind=computer" } });
    for (const hidden of ["browse-private", "browse-held"]) expect([...slugs, ...otherSlugs]).not.toContain(hidden);
    expect(slugs).toContain("browse-shelved");
    expect(slugs.indexOf("browse-shelved")).toBeGreaterThan(slugs.indexOf("browse-rising"));
  });

  it("puts trending games first on Trending, then the rest as Popular has them", async () => {
    const { slugs } = await browse("?sort=trending", { headers: { cookie: "zaisma_device_kind=computer" } });
    expect(slugs.slice(0, 4)).toEqual(["browse-rising", "browse-crowded", "browse-busy", "browse-keys"]);
  });

  it("sorts by New and Recently updated", async () => {
    const { slugs: fresh } = await browse("?sort=new", { headers: { cookie: "zaisma_device_kind=computer" } });
    expect(fresh.indexOf("browse-quiet")).toBeLessThan(fresh.indexOf("browse-crowded"));
    // No 60-day window, unlike the home's New row.
    expect(fresh.indexOf("browse-shelved")).toBeGreaterThan(fresh.indexOf("browse-crowded"));
    const { slugs: updated } = await browse("?sort=updated", { headers: { cookie: "zaisma_device_kind=computer" } });
    expect(updated.indexOf("browse-quiet")).toBeLessThan(updated.indexOf("browse-busy"));
  });

  it("filters by players and by a genre, together too", async () => {
    const { slugs: multiplayer } = await browse("?players=multiplayer", { headers: { cookie: "zaisma_device_kind=computer" } });
    expect(multiplayer).toEqual(expect.arrayContaining(["browse-busy", "browse-relay"]));
    expect(multiplayer).toHaveLength(2);
    const { slugs: strategy } = await browse("?genre=strategy", { headers: { cookie: "zaisma_device_kind=computer" } });
    expect(strategy).toEqual(["browse-crowded", "browse-keys"]);
    const { slugs: single } = await browse("?players=single", { headers: { cookie: "zaisma_device_kind=computer" } });
    expect(single).not.toEqual(expect.arrayContaining(["browse-relay"]));
    const { slugs: both } = await browse("?genre=strategy&players=multiplayer", { headers: { cookie: "zaisma_device_kind=computer" } });
    expect(both.every((slug) => strategy.includes(slug) && multiplayer.includes(slug))).toBe(true);
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
    const { text: emptyFilter } = await browse("?genre=horror");
    expect(emptyFilter).toContain("No horror games yet");
    const { text: emptyFilters } = await browse("?genre=horror&price=30_and_up");
    expect(emptyFilters).toContain("No games match these filters yet");
    expect(emptyFilters).toContain("Clear filters");
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

describe("the search's suggestions", () => {
  const suggest = async (searchText: string, headers: Record<string, string> = { cookie: "zaisma_device_kind=computer" }) => {
    const response = await SELF.fetch(`${SITE}/games/suggestions?search_text=${encodeURIComponent(searchText)}`, { headers });
    return { response, answer: (await response.json()) as { finishes: string[]; games: { title: string; page_url: string; cover_url: string; fact: string }[] } };
  };

  it("finishes what's typed from titles, developers and genres, and lists the games Browse finds", async () => {
    const { response, answer } = await suggest("Qui");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(answer.finishes).toEqual(["Quiet Lake"]);
    expect(answer.games).toEqual([{ title: "Quiet Lake", page_url: "/g/browse-quiet", cover_url: "", fact: "By Lake_Studio" }]);
    expect((await suggest("lake_s")).answer.finishes).toEqual(["Lake_Studio"]);
    expect((await suggest("role")).answer.finishes).toEqual(["Role-playing"]);
    expect((await suggest("role")).answer.games.map((game) => game.title)).toEqual(["Key Tactics"]);
  });

  it("puts the finish that finds the most games first, and shows at most three of each", async () => {
    const { answer } = await suggest("s");
    expect(answer.finishes.length).toBeLessThanOrEqual(3);
    expect(answer.games.length).toBeLessThanOrEqual(3);
    expect(answer.finishes[0]).toBe("Strategy");
  });

  it("shows nothing a stranger couldn't find on Browse", async () => {
    expect((await suggest("private pe")).answer).toEqual({ finishes: [], games: [] });
    expect((await suggest("held hol")).answer).toEqual({ finishes: [], games: [] });
    expect((await suggest("")).answer).toEqual({ finishes: [], games: [] });
  });

  it("says why a game may not suit the viewer's device, as its cover does", async () => {
    const { answer } = await suggest("key t", { "user-agent": IPHONE });
    expect(answer.games).toEqual([expect.objectContaining({ title: "Key Tactics", fact: "Needs a keyboard" })]);
  });

  it("is where every player page's header search and Browse's own ask as you type", async () => {
    for (const path of ["/", "/games?search_text=lake"]) expect(await (await SELF.fetch(`${SITE}${path}`)).text()).toMatch(/<form[^>]*action="\/games"[^>]*data-suggest="\/games\/suggestions"/);
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
