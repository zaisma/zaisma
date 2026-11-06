import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { ShowGame } from "../../apps/site/src/home.ts";
import { MAXIMUM_WHATS_ON_CARD_COUNT, currentWhatsOn, pickWhatsOnCards, postEvent, postNews, postPick, endEntry, whatsOnLineup, type WhatsOnEntry } from "../../apps/site/src/whats-on.ts";
import "../../apps/site/src/index.ts";

/** What's on at Zaisma (apps/site/src/whats-on.ts): fills itself, never empty with games, the same for everyone, and new each week. */

const NOW_MS = Date.UTC(2026, 10, 5);
const DAY_MS = 86_400_000;
const game = (slug: string, fields: Partial<ShowGame> = {}) => ({ id: `id-${slug}`, slug, title: slug, big_update_at_ms: null, first_published_at_ms: NOW_MS - 100 * DAY_MS, ...fields }) as ShowGame;
const pick = (gameId: string) => ({ game_id: gameId }) as WhatsOnEntry;
const options = { trendingSlugs: new Set<string>(), popularSlugs: [] as string[], nowMs: NOW_MS };
const PNG_BASE64 = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0));

describe("What's on's cards", () => {
  it("puts picks first, then updates, new games and what's trending, each tagged", () => {
    const games = [game("plain"), game("trending"), game("fresh", { first_published_at_ms: NOW_MS - DAY_MS }), game("updated", { big_update_at_ms: NOW_MS - DAY_MS }), game("picked")];
    const cards = pickWhatsOnCards(games, [pick("id-picked")], { ...options, trendingSlugs: new Set(["trending"]) });
    expect(cards.map((card) => [card.game.slug, card.tagWords])).toEqual([["picked", "Pick"], ["updated", "Updated"], ["fresh", "New"]]);
    expect(cards).toHaveLength(MAXIMUM_WHATS_ON_CARD_COUNT);
  });

  it("is never empty while there are games, and untagged when nothing's happening", () => {
    const cards = pickWhatsOnCards([game("quiet")], [], options);
    expect(cards.map((card) => [card.game.slug, card.tagWords])).toEqual([["quiet", null]]);
    expect(pickWhatsOnCards([], [], options)).toEqual([]);
  });

  it("leaves out the game shown beside it, and games kept off shelves unless a person picks one", () => {
    const games = [game("yours"), game("held"), game("other")];
    expect(pickWhatsOnCards(games, [], { ...options, excludedSlugs: new Set(["yours"]), offShelfSlugs: new Set(["held"]) }).map((card) => card.game.slug)).toEqual(["other"]);
    expect(pickWhatsOnCards(games, [pick("id-held")], { ...options, offShelfSlugs: new Set(["held"]) }).map((card) => card.game.slug)[0]).toBe("held");
  });

  it("orders by the week: the same all week and for everyone, and different over the weeks", () => {
    const games = Array.from({ length: 12 }, (_, gameIndex) => game(`game-${gameIndex}`));
    const slugsAt = (nowMs: number) => pickWhatsOnCards(games, [], { ...options, nowMs }).map((card) => card.game.slug).join();
    const weekStartMs = Math.floor(NOW_MS / (7 * DAY_MS)) * 7 * DAY_MS;
    expect(slugsAt(weekStartMs + DAY_MS)).toBe(slugsAt(weekStartMs + 6 * DAY_MS));
    const weeks = new Set(Array.from({ length: 8 }, (_, weekIndex) => slugsAt(weekStartMs + weekIndex * 7 * DAY_MS)));
    expect(weeks.size).toBeGreaterThan(1);
  });
});

describe("What's on's events", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM whats_on_entries");
  });
  const endsAt = () => new Date(Date.now() + 2 * DAY_MS).toISOString();

  it("keeps an event's art and serves it as a picture", async () => {
    const posted = await postEvent(env, { title: "Zombie weekend", wideArtBase64: PNG_BASE64, linkUrl: "/games", endsAt: endsAt() }, "test");
    const art = await SELF.fetch(`https://zaisma.test/whats-on-art/${posted.id}/wide`);
    expect(art.headers.get("Content-Type")).toBe("image/png");
    expect(art.headers.get("X-Content-Type-Options")).toBe("nosniff");
    await art.arrayBuffer();
    const missing = await SELF.fetch(`https://zaisma.test/whats-on-art/${posted.id}/narrow`);
    expect(missing.status).toBe(404);
    await missing.arrayBuffer();
  });

  it("refuses art that isn't a picture, a link that leaves as script, and a date too far off", async () => {
    await expect(postEvent(env, { title: "A", wideArtBase64: btoa("<svg onload=x>"), linkUrl: "/games", endsAt: endsAt() }, "test")).rejects.toThrow(/isn't a PNG/);
    await expect(postEvent(env, { title: "A", wideArtBase64: PNG_BASE64, linkUrl: "javascript:alert(1)", endsAt: endsAt() }, "test")).rejects.toThrow(/link_url/);
    await expect(postEvent(env, { title: "A", wideArtBase64: PNG_BASE64, linkUrl: "//elsewhere.test", endsAt: endsAt() }, "test")).rejects.toThrow(/link_url/);
    await expect(postEvent(env, { title: "A", wideArtBase64: PNG_BASE64, linkUrl: "/games", endsAt: new Date(Date.now() + 90 * DAY_MS).toISOString() }, "test")).rejects.toThrow(/ends_at/);
  });

  it("gives the strip to the newest event, and puts an older one with a poster and player news among the cards, never every card", async () => {
    const older = await postEvent(env, { title: "Night races", wideArtBase64: PNG_BASE64, cardArtBase64: PNG_BASE64, linkUrl: "/games?genre=racing", startsAt: new Date(Date.now() - 50 * 60_000).toISOString(), endsAt: endsAt() }, "test");
    await postEvent(env, { title: "No poster", wideArtBase64: PNG_BASE64, linkUrl: "/games", startsAt: new Date(Date.now() - 55 * 60_000).toISOString(), endsAt: endsAt() }, "test");
    const newest = await postEvent(env, { title: "Zombie weekend", wideArtBase64: PNG_BASE64, linkUrl: "/games", endsAt: endsAt() }, "test");
    const news = await postNews(env, { title: "Winter jam winners", linkUrl: "/forum", startsAt: new Date(Date.now() - 40 * 60_000).toISOString(), endsAt: endsAt() }, "test");
    const { event, entryCards } = await currentWhatsOn(env);
    expect(event?.id).toBe(newest.id);
    expect(entryCards.map((card) => [card.id, card.entryKind, card.art?.imageUrl ?? null])).toEqual([[older.id, "event", `/whats-on-art/${older.id}/card`], [news.id, "news", null]]);
    const games = [{ game: game("one"), tagWords: null }, { game: game("two"), tagWords: null }];
    expect(whatsOnLineup(entryCards, games, 3).map((card) => card.cardKind)).toEqual(["entry", "entry", "game"]);
    expect(whatsOnLineup(entryCards, games, 2).map((card) => card.cardKind)).toEqual(["entry", "game"]);
    expect(whatsOnLineup(entryCards, [], 2).map((card) => card.cardKind)).toEqual(["entry", "entry"]);
    const poster = await SELF.fetch(`https://zaisma.test/whats-on-art/${older.id}/card`);
    expect(poster.headers.get("Content-Type")).toBe("image/png");
    await poster.arrayBuffer();
    await expect(postNews(env, { title: "", linkUrl: "/forum", endsAt: endsAt() }, "test")).rejects.toThrow(/title/);
  });

  it("refuses a pick of a game players can't find, and ends an entry once", async () => {
    await expect(postPick(env, { gameSlug: "no-such-game", endsAt: endsAt() }, "test")).rejects.toThrow(/no listed, live game/);
    const posted = await postEvent(env, { title: "Zombie weekend", wideArtBase64: PNG_BASE64, linkUrl: "/games", endsAt: endsAt() }, "test");
    await endEntry(env, posted.id, "test");
    await expect(endEntry(env, posted.id, "test")).rejects.toThrow(/ended already/);
  });
});
