import { GENRE_LABELS, GENRES, PRICE_RANGES, currencyForCountry, priceRangeOf, requestCountryCode, searchLetterCount, searchWords, type DeviceKind, type Genre, type PriceRange } from "@zaisma/core";
import { tertiaryButton } from "./components/actions.ts";
import { divider, glassPane } from "./components/foundations.ts";
import { grid, row, stack, type GridItem, type LayoutItem } from "./components/layout.ts";
import { tagsInUse, type TagInUse } from "./components/data.ts";
import { filterMenu, type FilterGroup } from "./components/navigation.ts";
import { loadMore } from "./components/navigation.ts";
import { stateNote } from "./components/data.ts";
import { gameCard } from "./components/panes.ts";
import { tabSwitch, type SwitchTab } from "./components/switch.ts";
import { DEVICE_KIND_SOURCE, viewerDeviceKind } from "./device-kind.ts";
import type { Env } from "./env.ts";
import { MINIMUM_POPULAR_PLAYER_COUNT, coverPriceText, isTrending, paidGamesOwnedBy, shelfCounts, showcase, trendingScore, type ShelfCount, type ShowGame } from "./home.ts";
import { GAME_SEARCH, html, layout, scriptTags, securityHeaders } from "./html.ts";
import type { SearchSuggestions } from "./components/fields.ts";
import { pageScript } from "./page-scripts.ts";
import { MINIMUM_PLAYING_NOW_PLAYER_COUNT } from "./plays.ts";
import { viewerOf } from "./viewer.ts";
import type { CheckedPageName } from "./components/checked-pages.ts";

/**
 * Browse (/games): every listed game in one grid of covers on Zaisma's own glass, with players now under each, a calm search tool you find
 * a game with and leave (docs/DECISIONS.md, "Browse is every listed game in one grid"). Sorted by Popular, Trending, New or Recently
 * updated, with Best match in Popular's place while searching, filtered by genre, players and price in one Filter menu, searched by title,
 * developer or genre; games for the viewer's device first, the rest after a divider saying what they're made for, each with its note. The
 * sort, filters, search and page are all in the link. Nothing here can be bought: a title buys only its own name, and a republish nothing.
 */

export const BROWSE_SORTS = ["popular", "best_match", "trending", "new", "updated"] as const;
export type BrowseSort = (typeof BROWSE_SORTS)[number];
const SORT_LABELS: Record<BrowseSort, string> = { popular: "Popular", best_match: "Best match", trending: "Trending", new: "New", updated: "Updated" };
/** The first tab: Best match while searching, Popular otherwise. Neither is ever in the link: the search says which. */
const firstSortOf = (searchText: string): BrowseSort => (searchText ? "best_match" : "popular");

/** Browse's players filter (?players=): games that play alone, games with multiplayer, or any. */
export const BROWSE_PLAYERS = ["any", "single", "multiplayer"] as const;
export type BrowsePlayers = (typeof BROWSE_PLAYERS)[number];
const PLAYERS_LABELS: Record<BrowsePlayers, string> = { any: "Any", single: "Single-player", multiplayer: "Multiplayer" };
/** Browse's price filter (?price=): a game's price to play in bands (priceRangeOf), or any. */
export type BrowsePriceRange = PriceRange | "any";

/** Covers a page of Browse shows; the next page loads as you scroll. */
export const BROWSE_PAGE_GAME_COUNT = 48;
/** The longest search Browse reads; longer is cut. */
const MAXIMUM_SEARCH_CHARACTER_COUNT = 80;

export interface BrowseGame extends ShowGame {
  /** Why it may not suit the viewer's device ("Needs a keyboard"), for a game made for other devices; null when it fits. */
  device_note: string | null;
  /** Players in the last 7 days as the shelves count them; 0 for a game kept off them. */
  week_player_count: number;
  /** It holds Best match's exact-name place, which comes before the viewer's device. */
  is_exact_name: boolean;
}

export interface BrowseQuery {
  sort: BrowseSort;
  /** ?genre=, or any. */
  genre: Genre | "any";
  players: BrowsePlayers;
  priceRange: BrowsePriceRange;
  /** Trimmed; "" for none. */
  searchText: string;
  /** From 1. */
  pageNumber: number;
}

/** What the link asks for; anything unknown falls back to the default (Popular, or Best match while searching; any genre, players and price; no search; the first page). */
export function browseQuery(url: URL): BrowseQuery {
  const sort = url.searchParams.get("sort");
  const genre = url.searchParams.get("genre");
  const players = url.searchParams.get("players");
  const priceRange = url.searchParams.get("price");
  const pageNumber = Number(url.searchParams.get("page"));
  const searchText = (url.searchParams.get("search_text") ?? "").trim().slice(0, MAXIMUM_SEARCH_CHARACTER_COUNT);
  return {
    sort: (BROWSE_SORTS as readonly string[]).includes(sort ?? "") && sort !== "popular" && sort !== "best_match" ? (sort as BrowseSort) : firstSortOf(searchText),
    genre: (GENRES as readonly string[]).includes(genre ?? "") ? (genre as Genre) : "any",
    players: (BROWSE_PLAYERS as readonly string[]).includes(players ?? "") ? (players as BrowsePlayers) : "any",
    priceRange: (PRICE_RANGES as readonly string[]).includes(priceRange ?? "") ? (priceRange as PriceRange) : "any",
    searchText,
    pageNumber: Number.isInteger(pageNumber) && pageNumber > 1 ? pageNumber : 1,
  };
}

const DEVICE_PLURALS: Record<string, string> = { phone: "phones", tablet: "tablets", computer: "computers" };
const madeFor = (devices: string[]): string => `Made for ${devices.map((device) => DEVICE_PLURALS[device] ?? device).join(" and ")}`;

/** Why a game may not suit this device, in the game page's own words; null when it's made for it (or says nothing about devices). */
export function deviceNote(game: Pick<ShowGame, "devices" | "controls" | "screen_orientation">, deviceKind: DeviceKind): string | null {
  if (!game.devices.length || game.devices.includes(deviceKind)) return null;
  const isTouch = deviceKind !== "computer";
  if (game.controls.length) {
    if (isTouch && !game.controls.includes("touch")) return game.controls.includes("keyboard_mouse") ? "Needs a keyboard" : "Needs a gamepad";
    if (!isTouch && !game.controls.includes("keyboard_mouse") && !game.controls.includes("touch")) return "Needs a gamepad";
  }
  if (isTouch && (game.screen_orientation === "landscape" || game.screen_orientation === "portrait")) return `Best in ${game.screen_orientation}`;
  return madeFor(game.devices);
}

/** A text as a search compares it; one that's all punctuation or emoji, as it's written. */
const comparedWords = (text: string): string => searchWords(text) || text.toLowerCase();
const wordsOfGame = (game: ShowGame): string[] => [game.title, game.developer ?? "", ...game.genres.map((genre) => GENRE_LABELS[genre as Genre] ?? genre)];
const hasWordStart = (words: string, needle: string): boolean => ` ${words}`.includes(` ${needle}`);

/** Whether a game matches a search: its title, its developer's name or one of its genres, ignoring case, accents and punctuation. */
function matchesSearch(game: ShowGame, searchText: string): boolean {
  if (!searchText) return true;
  const needle = comparedWords(searchText);
  return wordsOfGame(game).some((word) => comparedWords(word).includes(needle));
}

/** Text under this much (searchLetterCount) has no exact-name place and no closest title. */
const MINIMUM_EXACT_NAME_LETTER_COUNT = 3;
const GENRE_WORDS = new Set(Object.values(GENRE_LABELS).map((label) => searchWords(label)));

/** Best match's tiers after the exact-name place: 1, the title's whole word or word start, or a developer's or genre's; 2, inside a word; 3, the closest title, found by no words at all. */
function matchTierOf(game: ShowGame, needle: string): 1 | 2 | 3 {
  const words = wordsOfGame(game).map(comparedWords);
  if (words.some((word) => hasWordStart(word, needle))) return 1;
  return words.some((word) => word.includes(needle)) ? 2 : 3;
}

/** Levenshtein, giving up past `maximumEditCount`: anything further is `maximumEditCount + 1`. */
function editDistance(first: string, second: string, maximumEditCount: number): number {
  const [from, to] = [[...first], [...second]];
  if (Math.abs(from.length - to.length) > maximumEditCount) return maximumEditCount + 1;
  let previous = Array.from({ length: to.length + 1 }, (_, index) => index);
  for (let fromIndex = 1; fromIndex <= from.length; fromIndex++) {
    const current = [fromIndex];
    for (let toIndex = 1; toIndex <= to.length; toIndex++) current[toIndex] = Math.min(previous[toIndex]! + 1, current[toIndex - 1]! + 1, previous[toIndex - 1]! + (from[fromIndex - 1] === to[toIndex - 1] ? 0 : 1));
    if (Math.min(...current) > maximumEditCount) return maximumEditCount + 1;
    previous = current;
  }
  return previous[to.length]!;
}

/** A search that finds nothing: the games whose title, or a run of as many of its words, is closest, within a third of the text's letters. A typo finds its game; a stranger's text finds nothing. */
function closestTitles<GameFound extends ShowGame>(games: GameFound[], searchText: string): GameFound[] {
  const needle = searchWords(searchText);
  const maximumEditCount = Math.floor([...needle].length / 3);
  if (!maximumEditCount || searchLetterCount(needle) < MINIMUM_EXACT_NAME_LETTER_COUNT) return [];
  const needleWordCount = needle.split(" ").length;
  const distanceOf = (game: GameFound): number => {
    const words = searchWords(game.title).split(" ");
    const runs = [words.join(" "), ...words.slice(0, Math.max(0, words.length - needleWordCount + 1)).map((_, index) => words.slice(index, index + needleWordCount).join(" "))];
    return Math.min(...runs.map((run) => editDistance(needle, run, maximumEditCount)));
  };
  const distances = new Map(games.map((game) => [game.id, distanceOf(game)]));
  const closestEditCount = Math.min(maximumEditCount + 1, ...distances.values());
  return closestEditCount > maximumEditCount ? [] : games.filter((game) => distances.get(game.id) === closestEditCount);
}

/** A game's place in today's shuffle: a hash of the UTC day and its ID (FNV-1a, mixed), so everyone sees one order all day and nothing a developer can pick buys a place in it. */
function dailyPlaceOf(gameId: string, utcDate: string): number {
  let hashNumber = 2166136261;
  for (const character of `${utcDate}:${gameId}`) hashNumber = Math.imul(hashNumber ^ character.charCodeAt(0), 16777619);
  hashNumber = Math.imul(hashNumber ^ (hashNumber >>> 15), 2246822507);
  return (hashNumber ^ (hashNumber >>> 13)) >>> 0;
}

/**
 * Every listed game the viewer can find, in the sort's order, those for their device first, each with its device note. Popular and
 * Trending rank by the home shelves' own counting (shelfCounts), with every game below a shelf's floor after the ranked ones in a daily
 * shuffle, so nothing listed is left out and each gets its turn; a game Zaisma keeps off the shelves is listed but ranks as if nobody played
 * it. Best match lists the game named exactly what was typed, then the tiers of matchTierOf, each in Popular's order. A search that finds
 * nothing falls back to the closest title.
 */
export async function browseGames(env: Env, options: { sort: BrowseSort; genre: Genre | "any"; players: BrowsePlayers; priceRange: BrowsePriceRange; searchText: string; deviceKind: DeviceKind; viewerAgeFloorYears: number; countryCode: string | null; nowMs?: number }): Promise<BrowseGame[]> {
  const nowMs = options.nowMs ?? Date.now();
  const [games, { counts }] = await Promise.all([
    showcase(env, options.viewerAgeFloorYears, Number.MAX_SAFE_INTEGER, options.countryCode),
    shelfCounts(env, options.viewerAgeFloorYears, nowMs),
  ]);
  const utcDate = new Date(nowMs).toISOString().slice(0, 10);
  const dailyPlaces = new Map(games.map((game) => [game.id, dailyPlaceOf(game.id, utcDate)]));
  const byDailyPlace = (first: ShowGame, second: ShowGame) => dailyPlaces.get(first.id)! - dailyPlaces.get(second.id)!;
  const updatedAtMs = (game: ShowGame) => game.recently_updated_at_ms ?? game.first_published_at_ms ?? 0;
  const countsOf = (game: ShowGame): ShelfCount | undefined => counts.get(game.slug);
  type Order = (first: ShowGame, second: ShowGame) => number;
  // Games a rule ranks first, by their score; the rest after them in the fallback's order (today's shuffle unless said).
  const ranked = (isRanked: (gameCounts: ShelfCount) => boolean, score: (gameCounts: ShelfCount) => number, fallback: Order = byDailyPlace): Order => (first, second) => {
    const [firstCounts, secondCounts] = [countsOf(first), countsOf(second)];
    const [isFirstRanked, isSecondRanked] = [Boolean(firstCounts && isRanked(firstCounts)), Boolean(secondCounts && isRanked(secondCounts))];
    if (isFirstRanked !== isSecondRanked) return isFirstRanked ? -1 : 1;
    if (isFirstRanked) return score(secondCounts!) - score(firstCounts!) || byDailyPlace(first, second);
    return fallback(first, second);
  };
  const popularOrder = ranked((gameCounts) => gameCounts.weekPlayerCount >= MINIMUM_POPULAR_PLAYER_COUNT, (gameCounts) => gameCounts.weekPlayerCount);
  const filtered = games
    .filter((game) => options.genre === "any" || game.genres.includes(options.genre))
    .filter((game) => options.players === "any" || (options.players === "multiplayer" ? game.is_multiplayer : game.is_single_player))
    .filter((game) => matchesPriceRange(game, options.priceRange));
  const matching = filtered.filter((game) => matchesSearch(game, options.searchText));
  const found = matching.length || !options.searchText ? matching : closestTitles(filtered, options.searchText);
  const needle = comparedWords(options.searchText);
  const matchTiers = new Map(options.sort === "best_match" && options.searchText ? found.map((game) => [game.id, matchTierOf(game, needle)]) : []);
  const tierOrder: Order = (first, second) => (matchTiers.get(first.id) ?? 0) - (matchTiers.get(second.id) ?? 0) || popularOrder(first, second);
  // The exact-name place holds one game, more players first when two titles match. Genre words and short text have none.
  const canHaveExactName = matchTiers.size > 0 && searchLetterCount(needle) >= MINIMUM_EXACT_NAME_LETTER_COUNT && !GENRE_WORDS.has(needle);
  const exactName = canHaveExactName ? found.filter((game) => comparedWords(game.title) === needle).sort(popularOrder)[0] : undefined;
  const order: Record<BrowseSort, Order> = {
    popular: popularOrder,
    best_match: (first, second) => Number(second === exactName) - Number(first === exactName) || tierOrder(first, second),
    // Trending games first by how strongly they trend, then the rest as Popular has them.
    trending: ranked(isTrending, trendingScore, popularOrder),
    new: (first, second) => (second.first_published_at_ms ?? 0) - (first.first_published_at_ms ?? 0),
    updated: (first, second) => updatedAtMs(second) - updatedAtMs(first),
  };
  const chosen = [...found].sort(order[options.sort === "best_match" && !options.searchText ? "popular" : options.sort]).map(
    (game): BrowseGame => ({ ...game, device_note: deviceNote(game, options.deviceKind), week_player_count: countsOf(game)?.weekPlayerCount ?? 0, is_exact_name: game === exactName }),
  );
  // The device's own first, each part keeping the sort's order; typing a game's name finds that game on any device.
  return [...chosen.filter((game) => game.is_exact_name), ...chosen.filter((game) => !game.device_note && !game.is_exact_name), ...chosen.filter((game) => game.device_note && !game.is_exact_name)];
}

/**
 * Whether a game's price to play is in the range: a free game, with in-game purchases or not, is free; a paid game not on sale right now
 * is in no range but any.
 */
function matchesPriceRange(game: Pick<ShowGame, "is_paid" | "full_game_price">, priceRange: BrowsePriceRange): boolean {
  if (priceRange === "any") return true;
  if (game.is_paid && !game.full_game_price) return false;
  return priceRangeOf(game.full_game_price) === priceRange;
}

/** The price filter's words, with the viewer's currency symbol where it's the dollar, the euro or the pound, else in US dollars. */
function priceRangeLabels(countryCode: string | null): Record<BrowsePriceRange, string> {
  const symbol = { usd: "$", eur: "€", gbp: "£" }[currencyForCountry(countryCode) ?? "usd"] ?? "$";
  return { any: "Any price", free: "Free", under_5: `Under ${symbol}5`, "5_to_15": `${symbol}5 to ${symbol}15`, "15_to_30": `${symbol}15 to ${symbol}30`, "30_and_up": `${symbol}30 and up` };
}

/** A link to Browse with this query, leaving out what's the default. */
export function browseHref(query: Partial<BrowseQuery>): string {
  const parameters = new URLSearchParams();
  if (query.sort && query.sort !== "popular" && query.sort !== "best_match") parameters.set("sort", query.sort);
  if (query.genre && query.genre !== "any") parameters.set("genre", query.genre);
  if (query.players && query.players !== "any") parameters.set("players", query.players);
  if (query.priceRange && query.priceRange !== "any") parameters.set("price", query.priceRange);
  if (query.searchText) parameters.set("search_text", query.searchText);
  if (query.pageNumber && query.pageNumber > 1) parameters.set("page", String(query.pageNumber));
  const search = parameters.toString();
  return `/games${search ? `?${search}` : ""}`;
}

const coverOf = (game: BrowseGame, coverIndex: number, ownedGameIds: ReadonlySet<string>): GridItem => ({
  kind: "block",
  markup: gameCard({
    title: game.title,
    picture: game.cover_picture,
    href: `/g/${game.slug}`,
    tintColor: game.glass_tint_color,
    facts: { deviceNote: game.device_note ?? undefined, playerCount: game.playing_now_player_count >= MINIMUM_PLAYING_NOW_PLAYER_COUNT ? game.playing_now_player_count : undefined, priceText: coverPriceText(game, ownedGameIds) },
    // The first row loads with the page, the very first cover before anything else.
    isEager: coverIndex < 6,
    hasHighPriority: coverIndex === 0,
  }),
});

/** What the divider before the other devices' games says: what most of them are made for. */
function otherDevicesWords(games: BrowseGame[]): string {
  const deviceCounts = new Map<string, number>();
  for (const game of games) deviceCounts.set(game.devices.join(","), (deviceCounts.get(game.devices.join(",")) ?? 0) + 1);
  const mostCommon = [...deviceCounts].sort((first, second) => second[1] - first[1])[0]?.[0] ?? "computer";
  return madeFor(mostCommon.split(","));
}

/**
 * Which state on the checks' list this Browse is (components/checked-pages.ts). The sort and the page number don't change how it's laid
 * out, and no games at all (never so in the preview, which has games) counts as Games.
 */
function browseState(query: BrowseQuery, isSignedIn: boolean, gameCount: number): CheckedPageName {
  if (query.searchText) return gameCount ? "Games, a search" : "Games, nothing found";
  if (query.genre !== "any") return gameCount ? "Games, one genre" : "Games, an empty genre";
  if (query.players !== "any") return gameCount ? "Games, multiplayer" : "Games, an empty genre";
  if (query.priceRange !== "any") return gameCount ? "Games, a price range" : "Games, an empty price range";
  return isSignedIn ? "Games, signed in" : "Games";
}

/** The filters in use, in the menu's order: each said as its tag, with the link to Browse without it. */
function filtersInUse(query: BrowseQuery, priceLabels?: Record<BrowsePriceRange, string>): TagInUse[] {
  const without = (change: Partial<BrowseQuery>) => browseHref({ ...query, ...change, pageNumber: 1 });
  return [
    ...(query.genre !== "any" ? [{ label: GENRE_LABELS[query.genre], removeHref: without({ genre: "any" }) }] : []),
    ...(query.players !== "any" ? [{ label: PLAYERS_LABELS[query.players], removeHref: without({ players: "any" }) }] : []),
    ...(query.priceRange !== "any" ? [{ label: priceLabels?.[query.priceRange] ?? query.priceRange, removeHref: without({ priceRange: "any" }) }] : []),
  ];
}

/** The Filter menu's groups: genre, players and price, each choice a link to Browse with it picked and the rest kept. */
function filterGroups(query: BrowseQuery, priceLabels: Record<BrowsePriceRange, string>): FilterGroup[] {
  const picked = (change: Partial<BrowseQuery>) => browseHref({ ...query, ...change, pageNumber: 1 });
  return [
    {
      groupName: "genre",
      label: "Genre",
      icon: "games",
      pickedLabel: query.genre === "any" ? "Any" : GENRE_LABELS[query.genre],
      choices: (["any", ...GENRES] as (Genre | "any")[]).map((genre) => ({ label: genre === "any" ? "Any" : GENRE_LABELS[genre], href: picked({ genre }), isCurrent: query.genre === genre })),
    },
    {
      groupName: "players",
      label: "Players",
      icon: "people",
      pickedLabel: PLAYERS_LABELS[query.players],
      choices: BROWSE_PLAYERS.map((players) => ({ label: PLAYERS_LABELS[players], href: picked({ players }), isCurrent: query.players === players })),
    },
    {
      groupName: "price",
      label: "Price",
      icon: "price-tag",
      pickedLabel: priceLabels[query.priceRange],
      choices: (["any", ...PRICE_RANGES] as BrowsePriceRange[]).map((priceRange) => ({ label: priceLabels[priceRange], href: picked({ priceRange }), isCurrent: query.priceRange === priceRange })),
    },
  ];
}

/** The results: this page's covers for the viewer's device, then those for others after their divider, then Load more or nothing. */
function results(query: BrowseQuery, games: BrowseGame[], ownedGameIds: ReadonlySet<string>): GridItem[] {
  if (!games.length) {
    const filterCount = filtersInUse(query).length;
    // One filter alone says which; more than one, that they don't meet.
    const filterTitle =
      filterCount > 1 ? "No games match these filters yet"
      : query.genre !== "any" ? `No ${GENRE_LABELS[query.genre].toLowerCase()} games yet`
      : query.players !== "any" ? `No ${PLAYERS_LABELS[query.players].toLowerCase()} games yet`
      : "No games in this price range yet";
    const state = query.searchText
      ? stateNote({ stateKind: "empty", title: `No games match "${query.searchText}"`, text: "Try a game's title, its developer or a genre.", action: tertiaryButton("Clear search", { href: browseHref({ ...query, searchText: "", pageNumber: 1 }) }) })
      : filterCount
        ? stateNote({ stateKind: "empty", title: filterTitle, text: "Every listed game shows with no filters.", action: tertiaryButton("Clear filters", { href: browseHref({ sort: query.sort }) }) })
        : stateNote({ stateKind: "empty", title: "No games yet", text: "The first games are on their way." });
    return [{ kind: "block", markup: state }];
  }
  const firstIndex = (query.pageNumber - 1) * BROWSE_PAGE_GAME_COUNT;
  const pageGames = games.slice(firstIndex, firstIndex + BROWSE_PAGE_GAME_COUNT);
  const fitting = pageGames.filter((game) => !game.device_note || game.is_exact_name);
  const others = pageGames.filter((game) => game.device_note && !game.is_exact_name);
  const allOthers = games.filter((game) => game.device_note && !game.is_exact_name);
  const hasMore = firstIndex + BROWSE_PAGE_GAME_COUNT < games.length;
  return [
    // Both lists are always there, so Load more can add to either; an empty one takes no room until a page brings it covers.
    { kind: "block", isHidden: !fitting.length && query.pageNumber === 1 && Boolean(others.length), markup: grid({ whenEmpty: stateNote({ stateKind: "empty", title: "No games on this page", text: "Every game here is made for another device." }), id: "browse-games", itemSize: "cover", label: "Games", items: fitting.map((game, coverIndex) => coverOf(game, coverIndex, ownedGameIds)) }) },
    {
      kind: "block",
      isHidden: !others.length,
      markup: stack({ items: [{ kind: "words", markup: divider({ words: otherDevicesWords(allOthers) }) }, { kind: "block", markup: grid({ whenEmpty: stateNote({ stateKind: "empty", title: "Nothing for other devices", text: "Every game here plays on this one." }), id: "browse-other-games", itemSize: "cover", label: "Games made for other devices", items: others.map((game, coverIndex) => coverOf(game, fitting.length + coverIndex, ownedGameIds)) }) }] }),
    },
    ...(hasMore
      ? [{ kind: "block" as const, markup: loadMore({ href: browseHref({ ...query, pageNumber: query.pageNumber + 1 }), label: "More games", listId: "browse-games", moreListIds: ["browse-other-games"], isLoadedOnScroll: true }) }]
      : []),
  ];
}

/** GET /games: Browse. */
export async function browsePage(env: Env, request: Request): Promise<Response> {
  const query = browseQuery(new URL(request.url));
  const viewer = await viewerOf(request, env);
  const deviceKind = viewerDeviceKind(request);
  const countryCode = requestCountryCode(request);
  const games = await browseGames(env, { ...query, deviceKind, viewerAgeFloorYears: viewer.ageFloorYears, countryCode });
  const firstIndex = (query.pageNumber - 1) * BROWSE_PAGE_GAME_COUNT;
  const ownedGameIds = await paidGamesOwnedBy(env, viewer.account, games.slice(firstIndex, firstIndex + BROWSE_PAGE_GAME_COUNT));
  const sortTabs: SwitchTab[] = [firstSortOf(query.searchText), "trending" as const, "new" as const, "updated" as const].map((sort) => ({ label: SORT_LABELS[sort], href: browseHref({ ...query, sort, pageNumber: 1 }), isCurrent: query.sort === sort }));
  const isClosestTitle = Boolean(query.searchText && games.length) && !games.some((game) => matchesSearch(game, query.searchText));
  const priceLabels = priceRangeLabels(countryCode);
  const tags = filtersInUse(query, priceLabels);
  const body = html`<div id="browse" data-device-kind="${deviceKind}">${glassPane({
    paneWidth: "full",
    label: "Browse",
    body: stack({
      items: [
        { kind: "words", markup: html`<h1>${isClosestTitle ? `Closest to "${query.searchText}"` : query.searchText ? `Games matching "${query.searchText}"` : "Browse"}</h1>` },
        {
          kind: "block",
          markup: row({
            widths: "lead-fills",
            label: "Sort and filter",
            items: [
              { kind: "control", markup: tabSwitch({ label: "Sort", switchSize: "small", tabs: sortTabs }) },
              { kind: "control", markup: filterMenu({ id: "browse-filter", groups: filterGroups(query, priceLabels), clearHref: browseHref({ sort: query.sort, searchText: query.searchText }), filterCount: tags.length }) },
            ],
          }),
        },
        // The tags read as words: they keep the words margin, in line with the heading.
        ...(tags.length ? [{ kind: "words" as const, markup: tagsInUse({ tags }) }] : []),
        ...results(query, games, ownedGameIds),
      ],
    }),
  })}</div>`;
  const response = layout(env, {
    title: query.searchText ? `${query.searchText}: games on Zaisma` : "Browse games on Zaisma",
    // Filtered for a signed-in viewer's age, so no shared cache keeps it.
    isPrivate: Boolean(viewer.account),
    nav: "browse",
    viewer,
    checkedPage: browseState(query, viewer.account !== null && viewer.account !== undefined, games.length),
    pageShape: "wide",
    search: { ...GAME_SEARCH, searchText: query.searchText, keep: { ...(query.genre !== "any" ? { genre: query.genre } : {}), ...(query.players !== "any" ? { players: query.players } : {}), ...(query.priceRange !== "any" ? { price: query.priceRange } : {}) } },
    body: html`${body}${scriptTags(BROWSE_SCRIPT)}`,
  });
  // The order depends on the device, so a cache keeps one copy per device cookie.
  response.headers.append("Vary", "Cookie");
  for (const cookie of viewer.cookies) response.headers.append("Set-Cookie", cookie);
  return response;
}

/** Finishes and games a suggestions answer holds at most: the search field shows three of each. */
const MAXIMUM_SUGGESTION_COUNT = 3;
/** How long the edge keeps an answer: a new game or a new count shows within a minute. */
const SUGGESTIONS_KEPT_MS = 60_000;

/**
 * What the header's search suggests as you type (GET /games/suggestions?search_text=, SearchSuggestions): the games Browse's search found,
 * in its Best match order, so nothing shows that a stranger couldn't find on Browse; and the ways to finish what's typed, from those games'
 * titles, developers and genres, the one whose games have the most players first, so a short title with no players falls behind real games.
 */
export function suggestionsFor(games: BrowseGame[], searchText: string): SearchSuggestions {
  const needle = comparedWords(searchText);
  if (!needle) return { finishes: [], games: [] };
  // Each finish once, however it's written, with what searching it finds and where it first shows in the order.
  const finishes = new Map<string, { finish: string; playerCount: number; gameCount: number; firstIndex: number }>();
  games.forEach((game, gameIndex) => {
    for (const word of wordsOfGame(game)) {
      const key = comparedWords(word);
      if (!key.startsWith(needle) || key === needle || finishes.has(key)) continue;
      const finding = games.filter((each) => matchesSearch(each, word));
      finishes.set(key, { finish: word, playerCount: finding.reduce((totalPlayerCount, each) => totalPlayerCount + each.week_player_count, 0), gameCount: finding.length, firstIndex: gameIndex });
    }
  });
  return {
    finishes: [...finishes.values()].sort((first, second) => second.playerCount - first.playerCount || second.gameCount - first.gameCount || first.firstIndex - second.firstIndex).slice(0, MAXIMUM_SUGGESTION_COUNT).map((each) => each.finish),
    games: games.slice(0, MAXIMUM_SUGGESTION_COUNT).map((game) => ({
      title: game.title,
      page_url: `/g/${game.slug}`,
      cover_url: game.cover ?? game.square ?? "",
      // Why it may not suit this device first, as on its cover; else players now, from the floor Browse shows them at; else its developer.
      fact: game.device_note ?? (game.playing_now_player_count >= MINIMUM_PLAYING_NOW_PLAYER_COUNT ? `${game.playing_now_player_count.toLocaleString("en-US")} playing` : game.developer ? `By ${game.developer}` : ""),
    })),
  };
}

/** GET /games/suggestions: the search field's finishes and games, kept at the edge for a minute per search, age floor, country and device. */
export async function browseSuggestions(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const searchText = (url.searchParams.get("search_text") ?? "").trim().slice(0, MAXIMUM_SEARCH_CHARACTER_COUNT);
  const viewer = await viewerOf(request, env);
  const deviceKind = viewerDeviceKind(request);
  const countryCode = requestCountryCode(request);
  // The answer depends only on these, so every viewer they match shares it: the key holds them, never who's asking.
  const cacheKey = new Request(`${url.origin}/games/suggestions?${new URLSearchParams({ search_text: searchText.toLowerCase(), age_floor_years: String(viewer.ageFloorYears), country_code: countryCode ?? "", device_kind: deviceKind })}`);
  const cache = typeof caches === "undefined" ? null : (caches as unknown as { default: Cache }).default;
  const kept = searchText && cache ? await cache.match(cacheKey) : undefined;
  let body: string;
  if (kept) body = await kept.text();
  else {
    const games = searchText ? await browseGames(env, { sort: "best_match", genre: "any", players: "any", priceRange: "any", searchText, deviceKind, viewerAgeFloorYears: viewer.ageFloorYears, countryCode }) : [];
    body = JSON.stringify(suggestionsFor(games, searchText));
    if (searchText && cache) await cache.put(cacheKey, new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${SUGGESTIONS_KEPT_MS / 1000}` } }));
  }
  const response = new Response(request.method === "HEAD" ? null : body, { headers: securityHeaders(env, { "Content-Type": "application/json", "Cache-Control": "private, max-age=60" }) });
  for (const cookie of viewer.cookies) response.headers.append("Set-Cookie", cookie);
  return response;
}

/**
 * Browse's script: the search narrows the grid in place on Enter or a finish picked (the search's own list shows its games as you type, so
 * the grid never redraws under it), and comes back whole once the search is emptied, keeping the link in step; a sort or
 * genre swaps the grid in place without loading the page (its switch slides once, and the background stays put), and a page drawn for
 * another device than this one is drawn again once in the right order.
 */
export const BROWSE_SCRIPT = pageScript("browse", String.raw`(() => {
${DEVICE_KIND_SOURCE}
const browse = document.getElementById("browse");
if (!browse) return;
const search = document.querySelector('header .find input[name="search_text"]');
let latest = 0;
// The pane's rows: a switch stays where it is (only its links and current tab follow the new page), so a slide on it isn't cut short.
function swap(next) {
  const rows = (root) => { const sorts = root.querySelector(".tab-switch"); return sorts ? Array.from(sorts.closest(".stack-cell").parentElement.children) : []; };
  const here = rows(browse), there = rows(next);
  if (!here.length || !there.length) { browse.replaceChildren(...Array.from(next.childNodes).map((node) => document.importNode(node, true))); return; }
  const parent = here[0].parentElement;
  here.forEach((row, at) => {
    const to = there[at];
    if (!to) { row.remove(); return; }
    const switchHere = row.querySelector(".tab-switch"), switchThere = to.querySelector(".tab-switch");
    // The Filter menu beside the sorts keeps the new sort in its links.
    const menuHere = row.querySelector(".filter-menu"), menuThere = to.querySelector(".filter-menu");
    if (menuHere && menuThere) menuHere.replaceWith(document.importNode(menuThere, true));
    const labelsOf = (each) => Array.from(each.querySelectorAll(":scope > a")).map((tab) => tab.textContent).join();
    // Across a search the first tab changes its name (Best match, Popular): then the switch is drawn again instead.
    if (switchHere && switchThere && labelsOf(switchHere) === labelsOf(switchThere)) {
      const tabsThere = switchThere.querySelectorAll(":scope > a");
      switchHere.querySelectorAll(":scope > a").forEach((tab, index) => {
        const tabThere = tabsThere[index]; if (!tabThere) return;
        tab.href = tabThere.getAttribute("href");
        if (tabThere.getAttribute("aria-current") === "page") { if (tab.getAttribute("aria-current") !== "page") { switchHere.querySelectorAll(":scope > a").forEach((each) => each.removeAttribute("aria-current")); tab.setAttribute("aria-current", "page"); if (switchHere.pickTab) switchHere.pickTab(tab); } }
      });
    } else row.replaceWith(document.importNode(to, true));
  });
  there.slice(here.length).forEach((row) => parent.append(document.importNode(row, true)));
}
function show(href, isNewEntry, isSearch, reopenedGroupName, slideLanded) {
  const asked = ++latest;
  Promise.all([fetch(href, { headers: { accept: "text/html" }, credentials: "same-origin" }).then((response) => response.ok ? response.text() : Promise.reject(response.status)), slideLanded]).then(([text]) => {
    if (asked !== latest) return;
    const page = new DOMParser().parseFromString(text, "text/html"), next = page.getElementById("browse");
    if (!next) return;
    if (isSearch) browse.replaceChildren(...Array.from(next.childNodes).map((node) => document.importNode(node, true))); else swap(next);
    browse.dataset.deviceKind = next.dataset.deviceKind;
    document.title = page.title;
    if (isNewEntry === "push") history.pushState(null, "", href); else if (isNewEntry) history.replaceState(null, "", href);
    browse.querySelectorAll("[data-loads-on-scroll]").forEach((holder) => window.zaismaLoadMore && window.zaismaLoadMore.watch(holder));
    if (typeof reopenedGroupName === "string") reopenFilter(reopenedGroupName);
  }).catch(() => { if (isNewEntry === "push") location.href = href; });
}
// A sort or a genre: its tab slides at once, and the grid follows when the page's games have come and the slab has landed. The slide runs
// on the page's one thread and drawing a grid of covers holds that thread longer than the slide lasts, so a grid drawn on the way stops the slab.
browse.addEventListener("click", (event) => {
  const tab = event.target.closest && event.target.closest(".tab-switch > a[href]");
  if (!tab || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const sw = tab.parentElement;
  if (tab.getAttribute("aria-current") === "page") return;
  sw.querySelectorAll(":scope > a").forEach((each) => each.removeAttribute("aria-current"));
  tab.setAttribute("aria-current", "page");
  if (sw.pickTab) sw.pickTab(tab);
  const slab = sw.querySelector(".switch-slab");
  const slideMs = slab && !matchMedia("(prefers-reduced-motion: reduce)").matches ? parseFloat(getComputedStyle(slab).getPropertyValue("--slide-ms")) || 0 : 0;
  show(tab.getAttribute("href"), "push", false, undefined, new Promise((landed) => setTimeout(landed, slideMs)));
});
// A filter picked or taken away: the pane is drawn again in place, its menu and tags with it. The open menu floats outside the pane (in
// the page's top layer), so its picks are heard on the whole page; picked there, the menu opens again at once on its ways, the way just
// changed in focus, so filters are picked one after another without it closing.
document.addEventListener("click", (event) => {
  const link = event.target.closest && event.target.closest("#browse-filter a[href], #browse .tags-in-use a[href]");
  if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const panel = link.closest("[data-filter-panel]");
  show(link.getAttribute("href"), "push", true, panel ? panel.getAttribute("data-filter-panel") : null);
});
function reopenFilter(groupName) {
  requestAnimationFrame(() => {
    const menu = document.getElementById("browse-filter"), button = document.querySelector('[aria-controls="browse-filter"]');
    if (!menu || !button || !menu.floating) return;
    menu.classList.add("opens-at-once");
    button.click();
    const row = groupName ? menu.querySelector('[data-filter-opens="' + groupName + '"]') : menu.querySelector(".filter-group");
    if (row) row.focus({ preventScroll: true });
    requestAnimationFrame(() => menu.classList.remove("opens-at-once"));
  });
}
window.addEventListener("popstate", () => show(location.pathname + location.search));
if (zaismaDeviceKind() !== browse.dataset.deviceKind) show(location.pathname + location.search);
if (search) {
  // The search as the page's address has it now, with the sort and genre picked here since it loaded.
  const searched = () => {
    const url = new URL(location.href);
    const searchText = search.value.trim();
    // A new search goes to Best match, whichever sort was picked before it.
    if (searchText) { url.searchParams.set("search_text", searchText); url.searchParams.delete("sort"); } else url.searchParams.delete("search_text");
    url.searchParams.delete("page");
    return url.pathname + url.search;
  };
  // Emptied (Clear, or every letter deleted) while the grid shows a search: every game again.
  search.addEventListener("input", () => { if (!search.value.trim() && new URL(location.href).searchParams.has("search_text")) show(searched(), true, true); });
  const form = search.closest("form");
  if (form) form.addEventListener("submit", (event) => { event.preventDefault(); show(searched(), true, true); });
}
})();`);
