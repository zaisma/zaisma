import {
  AGE_BAND_FLOOR_YEARS,
  KEPT_PLAYED_GAME_COUNT,
  addFavoriteGame,
  favoriteGames,
  forgetPlayed,
  friendsNowOf,
  gameBySlug,
  isFavoriteGame,
  playedHistory,
  removeFavoriteGame,
  requestCountryCode,
  type Account,
  type DeviceKind,
} from "@zaisma/core";
import { action, secondaryButton, textLink } from "./components/actions.ts";
import { glassPane } from "./components/foundations.ts";
import { cutField } from "./components/inputs.ts";
import { grid, row, stack, type GridItem, type LayoutItem } from "./components/layout.ts";
import { shelf } from "./components/navigation.ts";
import { banner, gameCard, type DropdownItem } from "./components/panes.ts";
import { stateNote } from "./components/data.ts";
import { tabSwitch } from "./components/switch.ts";
import type { CheckedPageName } from "./components/checked-pages.ts";
import { currentSession, readCookie } from "./auth.ts";
import { viewerDeviceKind } from "./device-kind.ts";
import type { Env } from "./env.ts";
import { KEEP_PLAYED_COOKIE_SOURCE, PLAYED_COOKIE } from "./home-script.ts";
import { coverPriceText, paidGamesOwnedBy, playable, showcase, type ShowGame } from "./home.ts";
import { html, layout, scriptTags, type Raw } from "./html.ts";
import { pageScript } from "./page-scripts.ts";
import { newestPictureJsonSql, pictureFromJson } from "./placeholders.ts";
import { MINIMUM_PLAYING_NOW_PLAYER_COUNT, playingNowCounts } from "./plays.ts";
import { viewerOf } from "./viewer.ts";
import type { ShownPicture } from "./components/foundations.ts";

/**
 * Your games (/your-games): the games the player chose, not everything they've played (docs/DECISIONS.md, "Your games is your games").
 * Favorites first, one of them the lead, twice the rest; then Recently played, with All you've played (/your-games/played) at its
 * heading's end; then For you, from plain rules; then the page ends, with Browse after it. A cover opens the game's page; on a computer
 * a small Play starts it from the cover. A guest's page is this device's played games (PLAYED_COOKIE), kept nowhere on Zaisma's side.
 */

/** How many games Recently played shows before All you've played. */
export const RECENTLY_PLAYED_SHOWN_COUNT = 10;
/** How many games For you suggests. */
export const FOR_YOU_GAME_COUNT = 5;

/** What a card in Your games needs of a game, for any game the player played, listed or not. */
interface YourGame {
  id: string;
  slug: string;
  title: string;
  cover_picture: ShownPicture | null;
  glass_tint_color: string | null;
  devices: string[];
  genres: string[];
  big_update_at_ms: number | null;
  playing_now_player_count: number;
  /** Made private or a draft, off the air, or being deleted: greyed, with no link. */
  is_gone: boolean;
  /** Taken down: never shown. */
  is_removed: boolean;
  minimum_player_age_years: number;
  is_paid: boolean;
  full_game_price: ShowGame["full_game_price"];
}

/** The games behind these ids or slugs, with what their cards need, in no order. */
async function yourGamesBy(env: Env, column: "id" | "slug", keys: string[]): Promise<YourGame[]> {
  if (!keys.length) return [];
  const [{ results }, playingNow] = await Promise.all([
    env.DB.prepare(
      `SELECT games.id, games.slug, games.title, games.visibility, games.review_status, games.live_version_id, games.big_update_at_ms, games.minimum_player_age_years,
         games.devices, games.genres, games.glass_tint_color, games.full_game_item_name, ${newestPictureJsonSql("cover", "games.id")} AS cover,
         EXISTS (SELECT 1 FROM game_deletions WHERE game_deletions.game_id = games.id) AS is_being_deleted
       FROM games WHERE games.${column} IN (SELECT value FROM json_each(?))`,
    )
      .bind(JSON.stringify(keys))
      .all<{ id: string; slug: string; title: string; visibility: string; review_status: string; live_version_id: string | null; big_update_at_ms: number | null; minimum_player_age_years: number; devices: string; genres: string; glass_tint_color: string | null; full_game_item_name: string | null; cover: string | null; is_being_deleted: number }>(),
    playingNowCounts(env),
  ]);
  return results.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    cover_picture: pictureFromJson(row.cover),
    glass_tint_color: row.glass_tint_color,
    devices: row.devices ? row.devices.split(",") : [],
    genres: row.genres ? row.genres.split(",") : [],
    big_update_at_ms: row.big_update_at_ms,
    playing_now_player_count: playingNow.get(row.id) ?? 0,
    is_removed: row.review_status === "removed",
    is_gone: row.review_status !== "live" || !row.live_version_id || (row.visibility !== "listed" && row.visibility !== "unlisted") || Boolean(row.is_being_deleted),
    minimum_player_age_years: row.minimum_player_age_years,
    is_paid: row.full_game_item_name !== null,
    // A price shows only on For you's cards, which come from showcase with theirs.
    full_game_price: null,
  }));
}

/** One game's card in Your games: Play from the cover on a computer, More with Remove where it can be removed, greyed when gone. */
interface CardOptions {
  game: Pick<YourGame, "id" | "slug" | "title" | "cover_picture" | "glass_tint_color" | "playing_now_player_count" | "is_gone" | "devices"> & { full_game_price?: ShowGame["full_game_price"] };
  isUpdated: boolean;
  friendNames: string[];
  /** For you's why: "Because you played Ash Hollow". */
  reasonText?: string;
  /** Remove: a signed-in player's form, or a guest's button the page's script answers. Left out, no More. */
  removeBy?: "account" | "device";
  ownedGameIds: ReadonlySet<string>;
  menuIdPrefix: string;
  isEager?: boolean;
}

function card(options: CardOptions): LayoutItem {
  const game = options.game;
  const removeItem: DropdownItem | null = options.removeBy === "account"
    ? { ...action("remove"), action: `/api/me/played/${game.slug}/remove` }
    : options.removeBy === "device"
      ? { ...action("remove"), isButton: true, dataAttributes: { "remove-from-device": game.slug } }
      : null;
  const playerCount = game.playing_now_player_count >= MINIMUM_PLAYING_NOW_PLAYER_COUNT ? game.playing_now_player_count : undefined;
  return {
    kind: "block",
    markup: html`<div class="your-game" data-slug="${game.slug}" data-title="${game.title.toLowerCase()}">${gameCard({
      title: game.title,
      picture: game.cover_picture,
      href: `/g/${game.slug}`,
      tintColor: game.glass_tint_color,
      facts: {
        playerCount: game.is_gone ? undefined : playerCount,
        isUpdated: options.isUpdated && !game.is_gone,
        friends: options.friendNames.length && !game.is_gone ? options.friendNames.map((username) => ({ username })) : undefined,
        reasonText: options.reasonText,
        priceText: game.full_game_price ? coverPriceText({ id: game.id, full_game_price: game.full_game_price }, options.ownedGameIds) : undefined,
      },
      quickPlayHref: game.is_gone ? undefined : `/g/${game.slug}?play`,
      isGone: game.is_gone,
      menu: removeItem ? { id: `${options.menuIdPrefix}-${game.slug}-menu`, label: game.title, items: [removeItem] } : undefined,
      isEager: options.isEager,
      hasHighPriority: options.isEager,
    })}</div>`,
  };
}

/** Games for this device first, each part keeping its order, as every list does. */
function forDeviceFirst<Game extends { devices: string[] }>(games: Game[], deviceKind: DeviceKind): Game[] {
  const fits = (game: Game) => !game.devices.length || game.devices.includes(deviceKind);
  return [...games.filter(fits), ...games.filter((game) => !fits(game))];
}

/**
 * For you: listed games the player hasn't played or favorited, sharing a genre with games they have, the genre most of theirs share
 * first, then players now. Each says which of their games it's for: the latest played of that genre. Plain rules, nothing paid or placed.
 */
export function forYouGames(candidates: ShowGame[], played: { slug: string; title: string; genres: string[] }[], excludedSlugs: ReadonlySet<string>): { game: ShowGame; becauseTitle: string }[] {
  if (!played.length) return [];
  const genreCounts = new Map<string, number>();
  for (const game of played) for (const genre of game.genres) genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
  const scored = candidates
    .filter((game) => !excludedSlugs.has(game.slug))
    .map((game) => {
      const sharedGenres = game.genres.filter((genre) => genreCounts.has(genre));
      const sharedGameCount = sharedGenres.reduce((runningCount, genre) => runningCount + (genreCounts.get(genre) ?? 0), 0);
      return { game, sharedGameCount, sharedGenres };
    })
    .filter((entry) => entry.sharedGameCount > 0)
    .sort((first, second) => second.sharedGameCount - first.sharedGameCount || second.game.playing_now_player_count - first.game.playing_now_player_count);
  return scored.slice(0, FOR_YOU_GAME_COUNT).map(({ game, sharedGenres }) => {
    const because = played.find((playedGame) => playedGame.genres.some((genre) => sharedGenres.includes(genre)))!;
    return { game, becauseTitle: because.title };
  });
}

/** The slugs this device played, newest first, from PLAYED_COOKIE: a guest's games, kept nowhere on Zaisma's side. */
function devicePlayedSlugs(request: Request, env: Env): string[] {
  return (readCookie(request, env, PLAYED_COOKIE) ?? "").split(",").filter((slug) => /^[a-z0-9-]{1,64}$/.test(slug)).slice(0, KEPT_PLAYED_GAME_COUNT);
}

/** Friends playing now, by game id: their names, for the friends corner of a game's cover. Respects each friend's own settings (friendsNowOf). */
async function friendNamesByGame(env: Env, account: Account | null): Promise<Map<string, string[]>> {
  if (!account) return new Map();
  const now = await friendsNowOf(env.DB, account.id, AGE_BAND_FLOOR_YEARS[account.age_band]);
  return new Map(now.playing.filter((playing) => playing.game_id).map((playing) => [playing.game_id!, playing.friends.map((friend) => friend.name)]));
}

/** GET /your-games */
export async function yourGamesPage(env: Env, request: Request): Promise<Response> {
  const viewer = await viewerOf(request, env);
  const account = viewer.account;
  const deviceKind = viewerDeviceKind(request);
  const countryCode = requestCountryCode(request);
  const [history, favorites, friendNames, candidates] = await Promise.all([
    account ? playedHistory(env.DB, account.id, viewer.ageFloorYears) : Promise.resolve(null),
    account ? favoriteGames(env.DB, account.id, viewer.ageFloorYears) : Promise.resolve([]),
    friendNamesByGame(env, account),
    showcase(env, viewer.ageFloorYears, 200, countryCode),
  ]);
  // A guest's history: this device's played games, in its order, never one taken down or for older players.
  const deviceSlugs = account ? [] : devicePlayedSlugs(request, env);
  const playedEntries: { game_id: string; played_at_ms: number | null; slug: string }[] = history
    ? history.map((entry) => ({ game_id: entry.game_id, played_at_ms: entry.played_at_ms, slug: entry.slug }))
    : deviceSlugs.map((slug) => ({ game_id: "", played_at_ms: null, slug }));
  const games = await yourGamesBy(env, "slug", [...new Set([...playedEntries.map((entry) => entry.slug), ...favorites.map((favorite) => favorite.slug)])]);
  const gameBySlugHere = new Map(games.filter((game) => !game.is_removed && game.minimum_player_age_years <= viewer.ageFloorYears).map((game) => [game.slug, game]));
  const playedAtBySlug = new Map(playedEntries.map((entry) => [entry.slug, entry.played_at_ms]));
  const isUpdatedSince = (game: YourGame) => {
    const playedAtMs = playedAtBySlug.get(game.slug);
    return Boolean(playedAtMs && game.big_update_at_ms && game.big_update_at_ms > playedAtMs);
  };

  const favoriteList = favorites.flatMap((favorite) => gameBySlugHere.get(favorite.slug) ?? []);
  // The lead: a favorite updated since it was played, else the one played last (favoriteGames' order), else the newest favorite.
  const leadFavorite = favoriteList.find((game) => !game.is_gone && isUpdatedSince(game)) ?? favoriteList.find((game) => !game.is_gone) ?? favoriteList[0];
  const favoritesInOrder = leadFavorite ? [leadFavorite, ...forDeviceFirst(favoriteList.filter((game) => game !== leadFavorite), deviceKind)] : [];
  const favoriteSlugs = new Set(favoriteList.map((game) => game.slug));
  const recentList = forDeviceFirst(playedEntries.flatMap((entry) => (favoriteSlugs.has(entry.slug) ? [] : gameBySlugHere.get(entry.slug) ?? [])), deviceKind);
  const ownedGameIds = await paidGamesOwnedBy(env, account, candidates);
  const forYou = forYouGames(
    candidates,
    playedEntries.flatMap((entry) => {
      const game = gameBySlugHere.get(entry.slug);
      return game ? [{ slug: game.slug, title: game.title, genres: game.genres }] : [];
    }),
    new Set([...gameBySlugHere.keys()]),
  );
  const removeBy = account ? "account" : "device";
  const cardOf = (game: YourGame, menuIdPrefix: string, isEager = false, canRemove = true) =>
    card({ game, isUpdated: isUpdatedSince(game), friendNames: friendNames.get(game.id) ?? [], removeBy: canRemove ? removeBy : undefined, ownedGameIds, menuIdPrefix, isEager });

  const hasAnything = favoritesInOrder.length > 0 || recentList.length > 0;
  const favoritesPane = favoritesInOrder.length
    ? glassPane({
        paneWidth: "full",
        label: "Favorites",
        body: stack({ items: [{ kind: "block", markup: shelf({ id: "favorites", trackId: "favorites-grid", title: "Favorites", coversAs: "grid_with_lead_cell", items: favoritesInOrder.map((game, coverIndex) => cardOf(game, "favorite", coverIndex < 3, false)) }) }] }),
      })
    : "";
  const forYouItems = forYou.map(({ game, becauseTitle }) => card({ game: { ...game, is_gone: false }, isUpdated: false, friendNames: friendNames.get(game.id) ?? [], reasonText: `Because you played ${becauseTitle}`, ownedGameIds, menuIdPrefix: "for-you" }));
  const restItems: LayoutItem[] = [
    ...(recentList.length
      ? [{ kind: "block" as const, markup: shelf({ id: "recently-played", trackId: "recently-played-grid", title: "Recently played", endLink: { words: "All you've played", href: "/your-games/played" }, coversAs: "grid", items: recentList.slice(0, RECENTLY_PLAYED_SHOWN_COUNT).map((game, coverIndex) => cardOf(game, "recent", !favoritesInOrder.length && coverIndex < 3)) }) }]
      : []),
    ...(forYouItems.length
      ? [{ kind: "block" as const, markup: shelf({ id: "for-you", trackId: "for-you-grid", title: "For you", coversAs: "grid", items: forYouItems }) }]
      : []),
    { kind: "words", markup: html`<p>That's all your games. ${textLink("Browse every game", "/games")}</p>` },
  ];
  const guestLine: LayoutItem[] = !account && env.SUPABASE_URL
    ? [{ kind: "block", markup: banner({ text: "These are the games played on this device. Make an account to keep them, and your favorites, everywhere.", icon: "person", action: { label: "Make an account", href: "/join?next=/your-games" } }) }]
    : [];
  const body = hasAnything
    ? html`<div id="your-games">${stack({ items: [...guestLine, ...(favoritesPane ? [{ kind: "block" as const, markup: favoritesPane }] : []), { kind: "block", markup: glassPane({ paneWidth: "full", label: "Recently played and For you", body: stack({ items: restItems }) }) }] })}</div>`
    : html`<div id="your-games">${stack({ items: [...guestLine, { kind: "block", markup: glassPane({ paneWidth: "full", label: "Your games", body: stack({ items: [{ kind: "words", markup: html`<h1>Your games</h1>` }, { kind: "block", markup: stateNote({ stateKind: "empty", title: "Games you play show up here.", text: "Find one to start with on Browse.", action: secondaryButton("Browse games", { href: "/games" }) }) }] }) }) }] })}</div>`;
  const checkedPage: CheckedPageName = !hasAnything ? "Your games, nothing played" : account ? "Your games, signed in" : "Your games, a guest";
  const response = layout(env, {
    title: "Your games on Zaisma",
    isPrivate: true,
    nav: "your-games",
    viewer,
    checkedPage,
    pageShape: "wide",
    body: html`${body}${scriptTags(YOUR_GAMES_SCRIPT)}`,
  });
  response.headers.append("Vary", "Cookie");
  for (const cookie of viewer.cookies) response.headers.append("Set-Cookie", cookie);
  return response;
}


/** GET /your-games/played: All you've played, every game, searched as you type and sorted by Recently played or Recently updated. */
export async function allPlayedPage(env: Env, request: Request): Promise<Response> {
  const viewer = await viewerOf(request, env);
  const account = viewer.account;
  const sort = new URL(request.url).searchParams.get("sort") === "updated" ? "updated" : "played";
  const history = account ? await playedHistory(env.DB, account.id, viewer.ageFloorYears) : null;
  const slugs = history ? history.map((entry) => entry.slug) : devicePlayedSlugs(request, env);
  const games = (await yourGamesBy(env, "slug", slugs)).filter((game) => !game.is_removed && game.minimum_player_age_years <= viewer.ageFloorYears);
  const bySlug = new Map(games.map((game) => [game.slug, game]));
  const playedAtBySlug = new Map((history ?? []).map((entry) => [entry.slug, entry.played_at_ms]));
  const ordered = slugs.flatMap((slug) => bySlug.get(slug) ?? []);
  const sorted = sort === "updated" ? [...ordered].sort((first, second) => (second.big_update_at_ms ?? 0) - (first.big_update_at_ms ?? 0)) : ordered;
  const friendNames = await friendNamesByGame(env, account);
  const items = sorted.map((game, coverIndex) =>
    card({
      game,
      isUpdated: Boolean(playedAtBySlug.get(game.slug) && game.big_update_at_ms && game.big_update_at_ms > playedAtBySlug.get(game.slug)!),
      friendNames: friendNames.get(game.id) ?? [],
      removeBy: account ? "account" : "device",
      ownedGameIds: new Set(),
      menuIdPrefix: "played",
      isEager: coverIndex < 6,
    }),
  );
  const body = html`<div id="all-played">${glassPane({
    paneWidth: "full",
    label: "All you've played",
    body: stack({
      items: [
        { kind: "words", markup: html`<h1>All you've played</h1>` },
        {
          kind: "block",
          markup: row({
            widths: "lead-fills",
            label: "Search and sort",
            items: [
              { kind: "control", markup: cutField({ id: "played-search", name: "search_text", label: "Search your games", type: "search", icon: "search", text: "", autocomplete: "off" }) },
              { kind: "control", markup: tabSwitch({ label: "Sort", switchSize: "small", tabs: [{ label: "Recently played", href: "/your-games/played", isCurrent: sort === "played" }, { label: "Recently updated", href: "/your-games/played?sort=updated", isCurrent: sort === "updated" }] }) },
            ],
          }),
        },
        {
          kind: "block",
          markup: grid({ id: "played-grid", itemSize: "cover", isAtLeastTwoAcross: true, items: items as GridItem[], whenEmpty: stateNote({ stateKind: "empty", title: "Games you play show up here.", text: "Find one to start with on Browse.", action: secondaryButton("Browse games", { href: "/games" }) }) }),
        },
      ],
    }),
  })}</div>`;
  const response = layout(env, {
    title: "All you've played on Zaisma",
    isPrivate: true,
    nav: "your-games",
    viewer,
    checkedPage: "All you've played",
    pageShape: "wide",
    body: html`${body}${scriptTags(YOUR_GAMES_SCRIPT)}`,
  });
  response.headers.append("Vary", "Cookie");
  for (const cookie of viewer.cookies) response.headers.append("Set-Cookie", cookie);
  return response;
}

/**
 * The player's own changes from Your games and a game's page:
 *   POST /api/me/favorites/:slug          add a favorite
 *   POST /api/me/favorites/:slug/remove   take it off
 *   POST /api/me/played/:slug/remove      Remove from Your games (and the profile); playing it again brings it back
 * A form post (no script) goes back to where it came from; a script's gets JSON.
 */
export async function handleYourGamesChanges(request: Request, env: Env, path: string): Promise<Response | null> {
  const match = path.match(/^\/api\/me\/(favorites|played)\/([a-z0-9-]+)(\/remove)?$/);
  if (!match || request.method !== "POST") return null;
  const [, list, slug, remove] = match;
  if (list === "played" && !remove) return null;
  const isForm = !(request.headers.get("Accept") ?? "").includes("application/json");
  const answer = (body: Record<string, unknown>, httpStatus: number, cookies: string[] = []) => {
    const back = list === "favorites" ? `/g/${slug}` : "/your-games";
    const response = isForm && httpStatus < 400 ? new Response(null, { status: 303, headers: { Location: back } }) : Response.json(body, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
    for (const cookie of cookies) response.headers.append("Set-Cookie", cookie);
    return response;
  };
  const session = await currentSession(request, env);
  if (!session) return answer({ error: { code: "not_signed_in", message_for_people: "Sign in to keep favorites.", fix: "Sign in, then try again." } }, 401);
  const game = await gameBySlug(env.DB, slug!);
  if (!game) return answer({ error: { code: "game_not_found", message_for_people: "There's no game at that link.", fix: "Check the game's link." } }, 404, session.cookies);
  if (list === "played") {
    await forgetPlayed(env.DB, session.userId, game.id);
    return answer({ ok: true }, 200, session.cookies);
  }
  if (remove) {
    await removeFavoriteGame(env.DB, session.userId, game.id);
    return answer({ ok: true, is_favorite: false }, 200, session.cookies);
  }
  if (!playable(game)) return answer({ error: { code: "game_not_found", message_for_people: "There's no game at that link.", fix: "Check the game's link." } }, 404, session.cookies);
  const added = await addFavoriteGame(env.DB, session.userId, game.id);
  if (added === "too_many") return answer({ error: { code: "too_many_favorites", message_for_people: "You have 1,000 favorites. Remove one to add another.", fix: "Remove a favorite from Your games, then add this one." } }, 400, session.cookies);
  return answer({ ok: true, is_favorite: await isFavoriteGame(env.DB, session.userId, game.id) }, 200, session.cookies);
}

/**
 * Your games' script: All you've played's search narrows the covers as you type; Remove takes a card away (a guest's from this device's
 * list, an account's through its form, sent here so the page needn't reload); For you's covers get their reason.
 */
export const YOUR_GAMES_SCRIPT = pageScript("your-games", String.raw`(() => {
${KEEP_PLAYED_COOKIE_SOURCE}
const search = document.getElementById("played-search");
if (search) search.addEventListener("input", () => {
  const words = search.value.trim().toLowerCase();
  for (const game of document.querySelectorAll(".your-game")) game.parentElement.hidden = Boolean(words) && !game.dataset.title.includes(words);
});
function takeAway(slug) {
  for (const game of document.querySelectorAll('.your-game[data-slug="' + CSS.escape(slug) + '"]')) game.parentElement.remove();
}
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-from-device]");
  if (!button) return;
  const slug = button.dataset.removeFromDevice;
  try {
    const list = JSON.parse(localStorage.getItem("zaisma:played") || "[]").filter((entry) => entry.slug !== slug);
    localStorage.setItem("zaisma:played", JSON.stringify(list));
    keepPlayedCookie(list);
  } catch {}
  takeAway(slug);
});
document.addEventListener("submit", (event) => {
  const form = event.target;
  const match = (form.getAttribute("action") || "").match(/^\/api\/me\/played\/([a-z0-9-]+)\/remove$/);
  if (!match) return;
  event.preventDefault();
  fetch(form.action, { method: "POST", headers: { Accept: "application/json" } }).then((response) => { if (response.ok) takeAway(match[1]); }).catch(() => form.submit());
});
})();`);
