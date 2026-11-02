import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createAccount, createGame, personOwner, searchLetterCount, searchWords, titleNamesZaisma } from "@zaisma/core";
import "../../apps/site/src/index.ts";
import { browseGames, suggestionsFor, type BrowseSort } from "../../apps/site/src/browse.ts";
import type { Env } from "../../apps/site/src/env.ts";

/** Search that can't be bought: a title buys only its own name, and a game with too few players to rank gets its turn in a daily shuffle. */

const SITE = "https://zaisma.test";
const DAY_MS = 86_400_000;
const NOW_MS = Date.UTC(2026, 10, 2, 12);
const dateAgo = (agoDays: number) => new Date(NOW_MS - agoDays * DAY_MS).toISOString().slice(0, 10);

const GAMES: { slug: string; title: string; dailyPlayerCount?: number; devices?: string; genres?: string }[] = [
  { slug: "just-a", title: "A" },
  { slug: "aa", title: "Aa" },
  { slug: "ashen-crown", title: "Ashen Crown", dailyPlayerCount: 40 },
  { slug: "hades", title: "Hades", dailyPlayerCount: 10 },
  { slug: "hades-too", title: "Hades", dailyPlayerCount: 2 },
  { slug: "hades-ii", title: "Hades II", dailyPlayerCount: 40 },
  { slug: "shades", title: "Shades", dailyPlayerCount: 60 },
  { slug: "racing", title: "Racing" },
  { slug: "road-kings", title: "Road Kings", dailyPlayerCount: 30, genres: "racing" },
  { slug: "eclair", title: "Éclair Garden" },
  { slug: "hollow-tide", title: "Hollow-Tide" },
  { slug: "wrangler", title: "Wrangler's Run" },
  { slug: "ember-court", title: "Ember Court", devices: "computer" },
  { slug: "ember-gardens", title: "Ember Gardens", dailyPlayerCount: 30, devices: "phone" },
  { slug: "sky", title: "天空" },
  { slug: "one-sky", title: "天" },
  { slug: "go", title: "Go", dailyPlayerCount: 1 },
  { slug: "go-karts", title: "Go Karts", dailyPlayerCount: 20 },
];

const found = async (searchText: string, options: { sort?: BrowseSort; deviceKind?: "phone" | "computer"; nowMs?: number } = {}) =>
  browseGames(env as unknown as Env, { sort: options.sort ?? (searchText ? "best_match" : "popular"), genre: "any", players: "any", priceRange: "any", searchText, deviceKind: options.deviceKind ?? "computer", viewerAgeFloorYears: 13, countryCode: null, nowMs: options.nowMs ?? NOW_MS });
const slugsFor = async (...args: Parameters<typeof found>) => (await found(...args)).map((game) => game.slug);

beforeAll(async () => {
  await createAccount(env.DB, { id: "match-dev", username: "Lake_Studio", ageBand: "18+" });
  const owner = await personOwner(env.DB, "match-dev");
  for (const seed of GAMES) {
    const game = await createGame(env.DB, { slug: seed.slug, title: seed.title, description: "", ownerId: owner.id, visibility: "listed" });
    await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, patch_notes, published_at_ms, created_at_ms) VALUES (?, ?, ?, 1, 0, 'approved', '', ?, 0)").bind(`v-${seed.slug}`, game.id, `games/${seed.slug}/v1`, NOW_MS - DAY_MS).run();
    await env.DB.prepare("UPDATE games SET review_status = 'live', live_version_id = ?, first_published_at_ms = ?, devices = ?, genres = ? WHERE id = ?").bind(`v-${seed.slug}`, NOW_MS - DAY_MS, seed.devices ?? "", seed.genres ?? "", game.id).run();
    if (seed.dailyPlayerCount) {
      // Five networks, so no one network is capped, on one day of the last week.
      for (const asn of [7922, 3320, 5089, 2856, 701]) await env.DB.prepare("INSERT INTO play_networks (game_id, date, autonomous_system_number, player_count) VALUES (?, ?, ?, ?)").bind(game.id, dateAgo(1), asn, seed.dailyPlayerCount).run();
    }
  }
});

describe("what a search compares", () => {
  it("ignores case, accents and punctuation", () => {
    expect(searchWords("Pokémon")).toBe("pokemon");
    expect(searchWords("Hollow-Knight!")).toBe("hollow knight");
    expect(searchWords("Wrangler's   Run")).toBe("wranglers run");
    expect(searchWords("ｈａｄｅｓ")).toBe("hades");
  });

  it("keeps the marks that change a letter in Japanese", () => {
    expect(searchWords("が")).not.toBe(searchWords("か"));
  });

  it("counts a Chinese or Japanese character as 2", () => {
    expect(searchLetterCount("ab")).toBe(2);
    expect(searchLetterCount("a b c")).toBe(3);
    expect(searchLetterCount("天")).toBe(2);
    expect(searchLetterCount("天空")).toBe(4);
    expect(searchLetterCount("かな")).toBe(4);
  });

  it("finds the whole word Zaisma in a title, and nothing longer", () => {
    for (const title of ["Zaisma", "zaisma quest", "ZAISMA!", "Zaïsma Run", "The Zaisma's Quest", "Quest: Zaisma"]) expect(titleNamesZaisma(title)).toBe(true);
    for (const title of ["Zaismatic", "Zaismas", "Zai Sma", "Neon Rush"]) expect(titleNamesZaisma(title)).toBe(false);
  });
});

describe("Best match", () => {
  it("doesn't let a short title buy a place: a is only what its players earn", async () => {
    const slugs = await slugsFor("a");
    expect(slugs.indexOf("ashen-crown")).toBeLessThan(slugs.indexOf("just-a"));
    expect((await found("a")).some((game) => game.is_exact_name)).toBe(false);
  });

  it("lists the game named exactly what was typed, then word starts, then inside a word, most players first", async () => {
    expect(await slugsFor("hades")).toEqual(["hades", "hades-ii", "hades-too", "shades"]);
  });

  it("gives the exact-name place to one game, more players first", async () => {
    const games = await found("hades");
    expect(games.filter((game) => game.is_exact_name).map((game) => game.slug)).toEqual(["hades"]);
  });

  it("has no exact-name place for genre words or text under 3 letters", async () => {
    const racing = await found("racing");
    expect(racing.some((game) => game.is_exact_name)).toBe(false);
    expect(racing[0]!.slug).toBe("road-kings");
    expect((await found("go")).map((game) => game.slug).slice(0, 2)).toEqual(["go-karts", "go"]);
    // One Chinese or Japanese character is 2; two of them have the place.
    expect((await found("天空"))[0]).toMatchObject({ slug: "sky", is_exact_name: true });
    expect((await found("天")).some((game) => game.is_exact_name)).toBe(false);
  });

  it("finds a title through accents and punctuation", async () => {
    expect(await slugsFor("eclair")).toEqual(["eclair"]);
    expect(await slugsFor("hollow tide")).toEqual(["hollow-tide"]);
    expect(await slugsFor("wranglers")).toEqual(["wrangler"]);
    expect(await slugsFor("wrangler")).toEqual(["wrangler"]);
  });

  it("keeps the exact name first on any device, then the viewer's device", async () => {
    const onPhone = await slugsFor("ember court", { deviceKind: "phone" });
    expect(onPhone[0]).toBe("ember-court");
    const games = await found("ember", { deviceKind: "phone" });
    expect(games[0]!.slug).toBe("ember-gardens");
  });

  it("falls back to the closest title, which catches typos, and finds nothing for a stranger's text", async () => {
    expect(await slugsFor("hdes")).toEqual(expect.arrayContaining(["hades", "hades-too"]));
    expect(await slugsFor("ashen crwn")).toEqual(["ashen-crown"]);
    expect(await slugsFor("zzzzzzzz")).toEqual([]);
    expect(await slugsFor("zq")).toEqual([]);
  });

  it("uses another sort when one is picked, with no exact-name place", async () => {
    const games = await found("hades", { sort: "trending" });
    expect(games.some((game) => game.is_exact_name)).toBe(false);
    expect(games[0]!.slug).toBe("shades");
  });

  it("takes Popular's place on Browse's tabs only while searching, and stays out of the link", async () => {
    const searching = await (await SELF.fetch(`${SITE}/games?search_text=hades`)).text();
    expect(searching).toContain("Best match");
    expect(searching).not.toMatch(/>Popular</);
    expect(searching).toContain('href="/games?sort=new&amp;search_text=hades"');
    expect(searching).toContain('href="/games?search_text=hades"');
    const browsing = await (await SELF.fetch(`${SITE}/games`)).text();
    expect(browsing).toMatch(/>Popular</);
    expect(browsing).not.toContain("Best match");
  });

  it("says when it shows the closest title", async () => {
    expect(await (await SELF.fetch(`${SITE}/games?search_text=hdes`)).text()).toContain("Closest to &quot;hdes&quot;");
  });
});

describe("the daily shuffle", () => {
  it("is one order for everyone all day, and another the next day", async () => {
    const unranked = (slugs: string[]) => slugs.filter((slug) => ["just-a", "aa", "racing", "eclair", "hollow-tide", "wrangler", "ember-court", "sky", "one-sky", "go"].includes(slug));
    const morning = unranked(await slugsFor("", { nowMs: NOW_MS - 3 * 3_600_000 }));
    expect(unranked(await slugsFor("", { nowMs: NOW_MS + 3 * 3_600_000 }))).toEqual(morning);
    const days = await Promise.all([1, 2, 3].map(async (agoDays) => unranked(await slugsFor("", { nowMs: NOW_MS - agoDays * DAY_MS }))));
    expect(days.some((order) => order.join() !== morning.join())).toBe(true);
  });

  it("comes after every game with enough players to rank", async () => {
    const slugs = await slugsFor("");
    expect(slugs.slice(0, 3)).toEqual(["shades", ...["ashen-crown", "hades-ii"].sort((first, second) => slugs.indexOf(first) - slugs.indexOf(second))]);
    expect(slugs.indexOf("just-a")).toBeGreaterThan(slugs.indexOf("hades"));
  });
});

describe("the search field's list", () => {
  it("lists games in the same match order", async () => {
    const games = await found("hades");
    expect(suggestionsFor(games, "hades").games.map((game) => game.page_url)).toEqual(["/g/hades", "/g/hades-ii", "/g/hades-too"]);
  });

  it("ranks finishes by players, so a short title with none falls behind real games", async () => {
    const { finishes } = suggestionsFor(await found("a"), "a");
    expect(finishes[0]).toBe("Ashen Crown");
    expect(finishes).not.toContain("A");
    expect(finishes.indexOf("Aa")).not.toBe(0);
  });

  it("shows the closest title's game for a typo", async () => {
    expect(suggestionsFor(await found("ashen crwn"), "ashen crwn").games.map((game) => game.title)).toEqual(["Ashen Crown"]);
  });
});
