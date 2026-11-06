import { describe, expect, it } from "vitest";
import { GAME_LINE_MAXIMUM_LETTER_COUNT, GAME_PAGE_SHELF_GAME_COUNT, firstSentence, gamePageShelves } from "../../apps/site/src/pages.ts";
import type { ShowGame } from "../../apps/site/src/home.ts";

/**
 * A game's page (apps/site/src/pages.ts): the line under its name, and its two shelves at the end, More from the developer and More like
 * this (other developers' games of the same kind, most played this week first, earned, never sold).
 */

const shown = (slug: string, ownerId: string | null, genres: string[], firstPublishedAtMs = 0): ShowGame => ({ slug, owner_id: ownerId, genres, first_published_at_ms: firstPublishedAtMs }) as ShowGame;

describe("the line under a game's name", () => {
  it("is its description's first sentence", () => {
    expect(firstSentence("Dig, build and explore together. Bring the whole crew.")).toBe("Dig, build and explore together.");
    expect(firstSentence("Harvest carrots\nIt saves like a Unity game does.")).toBe("Harvest carrots");
    expect(firstSentence("")).toBe("");
  });

  it("is cut at a word, past its longest", () => {
    const long = `${"word ".repeat(60)}end.`;
    const line = firstSentence(long);
    expect(line.length).toBeLessThanOrEqual(GAME_LINE_MAXIMUM_LETTER_COUNT + 1);
    expect(line.endsWith("…")).toBe(true);
    expect(line).not.toMatch(/\s…$/);
  });
});

describe("a game page's shelves", () => {
  const game = { slug: "ashfall", owner_id: "owner_studio", genres: "adventure,role_playing" };
  const showcase = [
    shown("ashfall", "owner_studio", ["adventure"]),
    shown("ashfall-demo", "owner_studio", ["adventure"]),
    shown("lantern", "owner_other", ["adventure"], 2),
    shown("frostline", "owner_other", ["role_playing"], 1),
    shown("racer", "owner_other", ["racing"]),
    shown("held", "owner_other", ["adventure"]),
  ];
  const counts = { counts: new Map([["frostline", { weekPlayerCount: 40 }], ["lantern", { weekPlayerCount: 3 }]]), offShelfSlugs: new Set(["held"]) };

  it("give the developer's own games their row, never this game", () => {
    expect(gamePageShelves(game, showcase, counts).developerGames.map((otherGame) => otherGame.slug)).toEqual(["ashfall-demo"]);
  });

  it("fill More like this with other developers' games of the same kind, most played this week first, none kept off the shelves", () => {
    expect(gamePageShelves(game, showcase, counts).likeGames.map((otherGame) => otherGame.slug)).toEqual(["frostline", "lantern"]);
  });

  it("show no More like this for a game with no kind", () => {
    expect(gamePageShelves({ ...game, genres: "" }, showcase, counts).likeGames).toEqual([]);
  });

  it("hold at most a shelf's worth each", () => {
    const many = Array.from({ length: 20 }, (_, gameIndex) => shown(`other-${gameIndex}`, "owner_other", ["adventure"]));
    expect(gamePageShelves(game, many, counts).likeGames).toHaveLength(GAME_PAGE_SHELF_GAME_COUNT);
  });
});
