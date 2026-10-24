import { GENRE_LABELS, GENRES, requestCountryCode, type Genre } from "@zaisma/core";
import { textButton } from "./components/actions.ts";
import { glassPane } from "./components/foundations.ts";
import { grid, stack, type LayoutItem } from "./components/layout.ts";
import { loadMore } from "./components/navigation.ts";
import { emptyState } from "./components/data.ts";
import { gameCover } from "./components/panes.ts";
import { dividerWords } from "./components/reading.ts";
import { tabSwitch, type SwitchTab } from "./components/switch.ts";
import { DEVICE_KIND_SOURCE, viewerDeviceKind, type DeviceKind } from "./device-kind.ts";
import type { Env } from "./env.ts";
import { MINIMUM_POPULAR_PLAYER_COUNT, isTrending, shelfCounts, showcase, trendingScore, type ShelfCount, type ShowGame } from "./home.ts";
import { GAME_SEARCH, html, layout, scriptTags } from "./html.ts";
import { pageScript } from "./page-scripts.ts";
import { MINIMUM_PLAYING_NOW_PLAYER_COUNT } from "./plays.ts";
import { viewerOf } from "./viewer.ts";

/**
 * Browse (/games): every listed game in one grid of covers on Zaisma's own glass, with players now under each, a calm search tool you find
 * a game with and leave (docs/DECISIONS.md, "Browse is every listed game in one grid"). Sorted by Popular, Trending, New or Recently
 * updated, filtered by Multiplayer or a genre, searched by title, developer or genre; games for the viewer's device first, the rest after
 * a divider saying what they're made for, each with its note. The sort, filter, search and page are all in the link.
 */

export const BROWSE_SORTS = ["popular", "trending", "new", "updated"] as const;
export type BrowseSort = (typeof BROWSE_SORTS)[number];
const SORT_LABELS: Record<BrowseSort, string> = { popular: "Popular", trending: "Trending", new: "New", updated: "Recently updated" };

export type BrowseFilter = "all" | "multiplayer" | Genre;

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
  filter: BrowseFilter;
  /** Trimmed; "" for none. */
  searchText: string;
  /** From 1. */
  pageNumber: number;
}

/** What the link asks for; anything unknown falls back to the default (Popular, All, no search, the first page). */
export function browseQuery(url: URL): BrowseQuery {
  const sort = url.searchParams.get("sort");
  const filter = url.searchParams.get("filter");
  const pageNumber = Number(url.searchParams.get("page"));
  return {
    sort: (BROWSE_SORTS as readonly string[]).includes(sort ?? "") ? (sort as BrowseSort) : "popular",
    filter: filter === "multiplayer" || (GENRES as readonly string[]).includes(filter ?? "") ? (filter as BrowseFilter) : "all",
    searchText: (url.searchParams.get("search_text") ?? "").trim().slice(0, MAXIMUM_SEARCH_CHARACTER_COUNT),
    pageNumber: Number.isInteger(pageNumber) && pageNumber > 1 ? pageNumber : 1,
  };
}

const DEVICE_PLURALS: Record<string, string> = { phone: "phones", tablet: "tablets", computer: "computers" };
const madeFor = (devices: string[]): string => `Made for ${devices.map((device) => DEVICE_PLURALS[device] ?? device).join(" and ")}`;

/** Why a game may not suit this device, in the game page's own words; null when it's made for it (or says nothing about devices). */
export function deviceNote(game: Pick<ShowGame, "devices" | "controls">, deviceKind: DeviceKind): string | null {
  if (!game.devices.length || game.devices.includes(deviceKind)) return null;
  const isTouch = deviceKind !== "computer";
  if (game.controls.length) {
    if (isTouch && !game.controls.includes("touch")) return game.controls.includes("keyboard_mouse") ? "Needs a keyboard" : "Needs a gamepad";
    if (!isTouch && !game.controls.includes("keyboard_mouse") && !game.controls.includes("touch")) return "Needs a gamepad";
  }
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
export async function browseGames(env: Env, options: { sort: BrowseSort; filter: BrowseFilter; searchText: string; deviceKind: DeviceKind; viewerAgeFloorYears: number; countryCode: string | null; nowMs?: number }): Promise<BrowseGame[]> {
  const [games, { counts }] = await Promise.all([
    showcase(env, options.viewerAgeFloorYears, Number.MAX_SAFE_INTEGER, options.countryCode),
    shelfCounts(env, options.viewerAgeFloorYears, options.nowMs),
  ]);
  const updatedAtMs = (game: ShowGame) => game.published_at_ms ?? 0;
  const byUpdate = (first: ShowGame, second: ShowGame) => updatedAtMs(second) - updatedAtMs(first);
  const countsOf = (game: ShowGame): ShelfCount | undefined => counts.get(game.slug);
  const ranked = (isRanked: (gameCounts: ShelfCount) => boolean, score: (gameCounts: ShelfCount) => number) => (first: ShowGame, second: ShowGame) => {
    const [firstCounts, secondCounts] = [countsOf(first), countsOf(second)];
    const [isFirstRanked, isSecondRanked] = [Boolean(firstCounts && isRanked(firstCounts)), Boolean(secondCounts && isRanked(secondCounts))];
    if (isFirstRanked !== isSecondRanked) return isFirstRanked ? -1 : 1;
    if (isFirstRanked) return score(secondCounts!) - score(firstCounts!) || byUpdate(first, second);
    return byUpdate(first, second);
  };
  const popularOrder = ranked((gameCounts) => gameCounts.weekPlayerCount >= MINIMUM_POPULAR_PLAYER_COUNT, (gameCounts) => gameCounts.weekPlayerCount);
  const order: Record<BrowseSort, (first: ShowGame, second: ShowGame) => number> = {
    popular: popularOrder,
    // Trending games first by how strongly they trend, then the rest as Popular has them.
    trending: (first, second) => ranked(isTrending, trendingScore)(first, second) || popularOrder(first, second),
    new: (first, second) => (second.first_published_at_ms ?? 0) - (first.first_published_at_ms ?? 0),
    updated: byUpdate,
  };
  const chosen = games
    .filter((game) => options.filter === "all" || (options.filter === "multiplayer" ? game.is_multiplayer : game.genres.includes(options.filter)))
    .filter((game) => matchesSearch(game, options.searchText))
    .sort(order[options.sort])
    .map((game): BrowseGame => ({ ...game, device_note: deviceNote(game, options.deviceKind) }));
  // The device's own first, each part keeping the sort's order.
  return [...chosen.filter((game) => !game.device_note), ...chosen.filter((game) => game.device_note)];
}

/** A link to Browse with this query, leaving out what's the default. */
export function browseHref(query: Partial<BrowseQuery>): string {
  const parameters = new URLSearchParams();
  if (query.sort && query.sort !== "popular") parameters.set("sort", query.sort);
  if (query.filter && query.filter !== "all") parameters.set("filter", query.filter);
  if (query.searchText) parameters.set("search_text", query.searchText);
  if (query.pageNumber && query.pageNumber > 1) parameters.set("page", String(query.pageNumber));
  const search = parameters.toString();
  return `/games${search ? `?${search}` : ""}`;
}

const coverOf = (game: BrowseGame, coverIndex: number): LayoutItem => ({
  kind: "block",
  markup: gameCover({
    title: game.title,
    imageUrl: game.cover,
    href: `/g/${game.slug}`,
    facts: game.device_note ? { deviceNote: game.device_note } : { playerCount: game.playing_now_player_count >= MINIMUM_PLAYING_NOW_PLAYER_COUNT ? game.playing_now_player_count : undefined },
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

/** The results: this page's covers for the viewer's device, then those for others after their divider, then Load more or nothing. */
function results(query: BrowseQuery, games: BrowseGame[]): LayoutItem[] {
  if (!games.length) {
    const filterLabel = query.filter === "multiplayer" ? "multiplayer" : query.filter === "all" ? "" : GENRE_LABELS[query.filter].toLowerCase();
    const state = query.searchText
      ? emptyState({ title: `No games match "${query.searchText}"`, text: "Try a game's title, its developer or a genre.", action: textButton("Clear search", { href: browseHref({ ...query, searchText: "", pageNumber: 1 }) }) })
      : query.filter !== "all"
        ? emptyState({ title: `No ${filterLabel} games yet`, text: "Every listed game is under All.", action: textButton("All games", { href: browseHref({ sort: query.sort }) }) })
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
    { kind: "block", isHidden: !fitting.length && query.pageNumber === 1 && Boolean(others.length), markup: grid({ id: "browse-games", itemSize: "cover", label: "Games", items: fitting.map(coverOf) }) },
    {
      kind: "block",
      isHidden: !others.length,
      markup: stack({ items: [{ kind: "words", markup: dividerWords(otherDevicesWords(allOthers)) }, { kind: "block", markup: grid({ id: "browse-other-games", itemSize: "cover", label: "Games made for other devices", items: others.map((game, coverIndex) => coverOf(game, fitting.length + coverIndex)) }) }] }),
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
  const games = await browseGames(env, { ...query, deviceKind, viewerAgeFloorYears: viewer.ageFloorYears, countryCode: requestCountryCode(request) });
  const sortTabs: SwitchTab[] = BROWSE_SORTS.map((sort) => ({ label: SORT_LABELS[sort], href: browseHref({ ...query, sort, pageNumber: 1 }), isCurrent: query.sort === sort }));
  const filterTabs: SwitchTab[] = (["all", "multiplayer", ...GENRES] as BrowseFilter[]).map((filter) => ({
    label: filter === "all" ? "All" : filter === "multiplayer" ? "Multiplayer" : GENRE_LABELS[filter],
    href: browseHref({ ...query, filter, pageNumber: 1 }),
    isCurrent: query.filter === filter,
  }));
  const body = html`<div id="browse" data-device-kind="${deviceKind}">${glassPane({
    paneWidth: "full",
    label: "Browse",
    body: stack({
      items: [
        { kind: "words", markup: html`<h1>${query.searchText ? `Games matching "${query.searchText}"` : "Browse"}</h1>` },
        { kind: "control", markup: tabSwitch({ label: "Sort", switchSize: "small", tabs: sortTabs }) },
        { kind: "control", markup: tabSwitch({ label: "Genre", switchSize: "small", isFramed: true, tabs: filterTabs }) },
        ...results(query, games),
      ],
    }),
  })}</div>`;
  const response = layout(env, {
    title: query.searchText ? `${query.searchText}: games on Zaisma` : "Browse games on Zaisma",
    // Filtered for a signed-in viewer's age, so no shared cache keeps it.
    isPrivate: Boolean(viewer.account),
    nav: "browse",
    viewer,
    isRebuilt: true,
    search: { ...GAME_SEARCH, searchText: query.searchText, keep: { ...(query.sort !== "popular" ? { sort: query.sort } : {}), ...(query.filter !== "all" ? { filter: query.filter } : {}) } },
    body: html`${body}${scriptTags(BROWSE_SCRIPT)}`,
  });
  // The order depends on the device, so a cache keeps one copy per device cookie.
  response.headers.append("Vary", "Cookie");
  for (const cookie of viewer.cookies) response.headers.append("Set-Cookie", cookie);
  return response;
}

/**
 * Browse's script: the search narrows the grid as you type (a quarter second after the last key), keeping the link in step, and a page
 * drawn for another device than this one is drawn again once in the right order.
 */
export const BROWSE_SCRIPT = pageScript("browse", String.raw`(() => {
${DEVICE_KIND_SOURCE}
const browse = document.getElementById("browse");
if (!browse) return;
const search = document.querySelector('header .find input[name="search_text"]');
let latest = 0;
function show(href, isNewEntry) {
  const asked = ++latest;
  fetch(href, { headers: { accept: "text/html" }, credentials: "same-origin" }).then((response) => response.ok ? response.text() : Promise.reject(response.status)).then((text) => {
    if (asked !== latest) return;
    const next = new DOMParser().parseFromString(text, "text/html").getElementById("browse");
    if (!next) return;
    browse.replaceChildren(...Array.from(next.childNodes).map((node) => document.importNode(node, true)));
    browse.dataset.deviceKind = next.dataset.deviceKind;
    document.title = new DOMParser().parseFromString(text, "text/html").title;
    if (isNewEntry !== undefined) history.replaceState(null, "", href);
    browse.querySelectorAll("[data-loads-on-scroll]").forEach((holder) => window.zaismaLoadMore && window.zaismaLoadMore.watch(holder));
  }).catch(() => {});
}
if (zaismaDeviceKind() !== browse.dataset.deviceKind) show(location.pathname + location.search);
if (search) {
  let timer = 0;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const url = new URL(location.href);
      const searchText = search.value.trim();
      if (searchText) url.searchParams.set("search_text", searchText); else url.searchParams.delete("search_text");
      url.searchParams.delete("page");
      show(url.pathname + url.search, true);
    }, 250);
  });
}
})();`);
