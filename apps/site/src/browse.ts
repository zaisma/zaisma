import { GENRE_LABELS, GENRES, PRICE_RANGES, currencyForCountry, priceRangeOf, requestCountryCode, type DeviceKind, type Genre, type PriceRange } from "@zaisma/core";
import { tertiaryButton } from "./components/actions.ts";
import { divider, glassPane } from "./components/foundations.ts";
import { grid, row, stack, type LayoutItem } from "./components/layout.ts";
import { tagsInUse, type TagInUse } from "./components/data.ts";
import { filterMenu, type FilterGroup } from "./components/navigation.ts";
import { loadMore } from "./components/navigation.ts";
import { emptyState } from "./components/data.ts";
import { gameCard } from "./components/playing.ts";
import { tabSwitch, type SwitchTab } from "./components/switch.ts";
import { DEVICE_KIND_SOURCE, viewerDeviceKind } from "./device-kind.ts";
import type { Env } from "./env.ts";
import { MINIMUM_POPULAR_PLAYER_COUNT, coverPriceText, isTrending, paidGamesOwnedBy, shelfCounts, showcase, trendingScore, type ShelfCount, type ShowGame } from "./home.ts";
import { GAME_SEARCH, html, layout, scriptTags } from "./html.ts";
import { pageScript } from "./page-scripts.ts";
import { MINIMUM_PLAYING_NOW_PLAYER_COUNT } from "./plays.ts";
import { viewerOf } from "./viewer.ts";
import type { CheckedPageName } from "./components/checked-pages.ts";

/**
 * Browse (/games): every listed game in one grid of covers on Zaisma's own glass, with players now under each, a calm search tool you find
 * a game with and leave (docs/DECISIONS.md, "Browse is every listed game in one grid"). Sorted by Popular, Trending, New or Recently
 * updated, filtered by genre, players and price in one Filter menu, searched by title, developer or genre; games for the viewer's device
 * first, the rest after a divider saying what they're made for, each with its note. The sort, filters, search and page are all in the link.
 */

export const BROWSE_SORTS = ["popular", "trending", "new", "updated"] as const;
export type BrowseSort = (typeof BROWSE_SORTS)[number];
const SORT_LABELS: Record<BrowseSort, string> = { popular: "Popular", trending: "Trending", new: "New", updated: "Updated" };

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

/** What the link asks for; anything unknown falls back to the default (Popular, any genre, players and price, no search, the first page). */
export function browseQuery(url: URL): BrowseQuery {
  const sort = url.searchParams.get("sort");
  const genre = url.searchParams.get("genre");
  const players = url.searchParams.get("players");
  const priceRange = url.searchParams.get("price");
  const pageNumber = Number(url.searchParams.get("page"));
  return {
    sort: (BROWSE_SORTS as readonly string[]).includes(sort ?? "") ? (sort as BrowseSort) : "popular",
    genre: (GENRES as readonly string[]).includes(genre ?? "") ? (genre as Genre) : "any",
    players: (BROWSE_PLAYERS as readonly string[]).includes(players ?? "") ? (players as BrowsePlayers) : "any",
    priceRange: (PRICE_RANGES as readonly string[]).includes(priceRange ?? "") ? (priceRange as PriceRange) : "any",
    searchText: (url.searchParams.get("search_text") ?? "").trim().slice(0, MAXIMUM_SEARCH_CHARACTER_COUNT),
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

/** Whether a game matches a search: its title, its developer's name or one of its genres, ignoring case. */
function matchesSearch(game: ShowGame, searchText: string): boolean {
  if (!searchText) return true;
  const needle = searchText.toLowerCase();
  const words = [game.title, game.developer ?? "", ...game.genres.map((genre) => GENRE_LABELS[genre as Genre] ?? genre)];
  return words.some((word) => word.toLowerCase().includes(needle));
}

/**
 * Every listed game the viewer can find, in the sort's order, those for their device first, each with its device note. Popular and
 * Trending rank by the home shelves' own counting (shelfCounts), with every game below a shelf's floor after the ranked ones, newest
 * update first, so nothing listed is left out; a game Zaisma keeps off the shelves is listed but ranks as if nobody played it.
 */
export async function browseGames(env: Env, options: { sort: BrowseSort; genre: Genre | "any"; players: BrowsePlayers; priceRange: BrowsePriceRange; searchText: string; deviceKind: DeviceKind; viewerAgeFloorYears: number; countryCode: string | null; nowMs?: number }): Promise<BrowseGame[]> {
  const [games, { counts }] = await Promise.all([
    showcase(env, options.viewerAgeFloorYears, Number.MAX_SAFE_INTEGER, options.countryCode),
    shelfCounts(env, options.viewerAgeFloorYears, options.nowMs),
  ]);
  const updatedAtMs = (game: ShowGame) => game.published_at_ms ?? 0;
  const byUpdate = (first: ShowGame, second: ShowGame) => updatedAtMs(second) - updatedAtMs(first);
  const countsOf = (game: ShowGame): ShelfCount | undefined => counts.get(game.slug);
  type Order = (first: ShowGame, second: ShowGame) => number;
  // Games a rule ranks first, by their score; the rest after them in the fallback's order (newest update first unless said).
  const ranked = (isRanked: (gameCounts: ShelfCount) => boolean, score: (gameCounts: ShelfCount) => number, fallback: Order = byUpdate): Order => (first, second) => {
    const [firstCounts, secondCounts] = [countsOf(first), countsOf(second)];
    const [isFirstRanked, isSecondRanked] = [Boolean(firstCounts && isRanked(firstCounts)), Boolean(secondCounts && isRanked(secondCounts))];
    if (isFirstRanked !== isSecondRanked) return isFirstRanked ? -1 : 1;
    if (isFirstRanked) return score(secondCounts!) - score(firstCounts!) || byUpdate(first, second);
    return fallback(first, second);
  };
  const popularOrder = ranked((gameCounts) => gameCounts.weekPlayerCount >= MINIMUM_POPULAR_PLAYER_COUNT, (gameCounts) => gameCounts.weekPlayerCount);
  const order: Record<BrowseSort, Order> = {
    popular: popularOrder,
    // Trending games first by how strongly they trend, then the rest as Popular has them.
    trending: ranked(isTrending, trendingScore, popularOrder),
    new: (first, second) => (second.first_published_at_ms ?? 0) - (first.first_published_at_ms ?? 0),
    updated: byUpdate,
  };
  const chosen = games
    .filter((game) => options.genre === "any" || game.genres.includes(options.genre))
    .filter((game) => options.players === "any" || (options.players === "multiplayer" ? game.is_multiplayer : game.is_single_player))
    .filter((game) => matchesSearch(game, options.searchText))
    .filter((game) => matchesPriceRange(game, options.priceRange))
    .sort(order[options.sort])
    .map((game): BrowseGame => ({ ...game, device_note: deviceNote(game, options.deviceKind) }));
  // The device's own first, each part keeping the sort's order.
  return [...chosen.filter((game) => !game.device_note), ...chosen.filter((game) => game.device_note)];
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
  if (query.sort && query.sort !== "popular") parameters.set("sort", query.sort);
  if (query.genre && query.genre !== "any") parameters.set("genre", query.genre);
  if (query.players && query.players !== "any") parameters.set("players", query.players);
  if (query.priceRange && query.priceRange !== "any") parameters.set("price", query.priceRange);
  if (query.searchText) parameters.set("search_text", query.searchText);
  if (query.pageNumber && query.pageNumber > 1) parameters.set("page", String(query.pageNumber));
  const search = parameters.toString();
  return `/games${search ? `?${search}` : ""}`;
}

const coverOf = (game: BrowseGame, coverIndex: number, ownedGameIds: ReadonlySet<string>): LayoutItem => ({
  kind: "block",
  markup: gameCard({
    title: game.title,
    imageUrl: game.cover,
    href: `/g/${game.slug}`,
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
function results(query: BrowseQuery, games: BrowseGame[], ownedGameIds: ReadonlySet<string>): LayoutItem[] {
  if (!games.length) {
    const filterCount = filtersInUse(query).length;
    // One filter alone says which; more than one, that they don't meet.
    const filterTitle =
      filterCount > 1 ? "No games match these filters yet"
      : query.genre !== "any" ? `No ${GENRE_LABELS[query.genre].toLowerCase()} games yet`
      : query.players !== "any" ? `No ${PLAYERS_LABELS[query.players].toLowerCase()} games yet`
      : "No games in this price range yet";
    const state = query.searchText
      ? emptyState({ title: `No games match "${query.searchText}"`, text: "Try a game's title, its developer or a genre.", action: tertiaryButton("Clear search", { href: browseHref({ ...query, searchText: "", pageNumber: 1 }) }) })
      : filterCount
        ? emptyState({ title: filterTitle, text: "Every listed game shows with no filters.", action: tertiaryButton("Clear filters", { href: browseHref({ sort: query.sort }) }) })
        : emptyState({ title: "No games yet", text: "The first games are on their way." });
    return [{ kind: "block", markup: state }];
  }
  const firstIndex = (query.pageNumber - 1) * BROWSE_PAGE_GAME_COUNT;
  const pageGames = games.slice(firstIndex, firstIndex + BROWSE_PAGE_GAME_COUNT);
  const fitting = pageGames.filter((game) => !game.device_note);
  const others = pageGames.filter((game) => game.device_note);
  const allOthers = games.filter((game) => game.device_note);
  const hasMore = firstIndex + BROWSE_PAGE_GAME_COUNT < games.length;
  return [
    // Both lists are always there, so Load more can add to either; an empty one takes no room until a page brings it covers.
    { kind: "block", isHidden: !fitting.length && query.pageNumber === 1 && Boolean(others.length), markup: grid({ whenEmpty: emptyState({ title: "No games on this page", text: "Every game here is made for another device." }), id: "browse-games", itemSize: "cover", label: "Games", items: fitting.map((game, coverIndex) => coverOf(game, coverIndex, ownedGameIds)) }) },
    {
      kind: "block",
      isHidden: !others.length,
      markup: stack({ items: [{ kind: "words", markup: divider({ words: otherDevicesWords(allOthers) }) }, { kind: "block", markup: grid({ whenEmpty: emptyState({ title: "Nothing for other devices", text: "Every game here plays on this one." }), id: "browse-other-games", itemSize: "cover", label: "Games made for other devices", items: others.map((game, coverIndex) => coverOf(game, fitting.length + coverIndex, ownedGameIds)) }) }] }),
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
  const sortTabs: SwitchTab[] = BROWSE_SORTS.map((sort) => ({ label: SORT_LABELS[sort], href: browseHref({ ...query, sort, pageNumber: 1 }), isCurrent: query.sort === sort }));
  const priceLabels = priceRangeLabels(countryCode);
  const tags = filtersInUse(query, priceLabels);
  const body = html`<div id="browse" data-device-kind="${deviceKind}">${glassPane({
    paneWidth: "full",
    label: "Browse",
    body: stack({
      items: [
        { kind: "words", markup: html`<h1>${query.searchText ? `Games matching "${query.searchText}"` : "Browse"}</h1>` },
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
        ...(tags.length ? [{ kind: "block" as const, markup: tagsInUse({ tags }) }] : []),
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
    search: { ...GAME_SEARCH, searchText: query.searchText, keep: { ...(query.sort !== "popular" ? { sort: query.sort } : {}), ...(query.genre !== "any" ? { genre: query.genre } : {}), ...(query.players !== "any" ? { players: query.players } : {}), ...(query.priceRange !== "any" ? { price: query.priceRange } : {}) } },
    body: html`${body}${scriptTags(BROWSE_SCRIPT)}`,
  });
  // The order depends on the device, so a cache keeps one copy per device cookie.
  response.headers.append("Vary", "Cookie");
  for (const cookie of viewer.cookies) response.headers.append("Set-Cookie", cookie);
  return response;
}

/**
 * Browse's script: the search narrows the grid as you type (a quarter second after the last key), keeping the link in step, a sort or
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
    if (switchHere && switchThere) {
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
function show(href, isNewEntry, isSearch, reopenedGroupName) {
  const asked = ++latest;
  fetch(href, { headers: { accept: "text/html" }, credentials: "same-origin" }).then((response) => response.ok ? response.text() : Promise.reject(response.status)).then((text) => {
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
// A sort or a genre: its tab slides at once, and the grid follows when the page's games come.
browse.addEventListener("click", (event) => {
  const tab = event.target.closest && event.target.closest(".tab-switch > a[href]");
  if (!tab || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const sw = tab.parentElement;
  if (tab.getAttribute("aria-current") === "page") return;
  sw.querySelectorAll(":scope > a").forEach((each) => each.removeAttribute("aria-current"));
  tab.setAttribute("aria-current", "page");
  if (sw.pickTab) sw.pickTab(tab);
  show(tab.getAttribute("href"), "push");
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
  let timer = 0;
  // The search as the page's address has it now, with the sort and genre picked here since it loaded.
  const searched = () => {
    const url = new URL(location.href);
    const searchText = search.value.trim();
    if (searchText) url.searchParams.set("search_text", searchText); else url.searchParams.delete("search_text");
    url.searchParams.delete("page");
    return url.pathname + url.search;
  };
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => show(searched(), true, true), 250);
  });
  const form = search.closest("form");
  if (form) form.addEventListener("submit", (event) => { event.preventDefault(); clearTimeout(timer); show(searched(), true, true); });
}
})();`);
