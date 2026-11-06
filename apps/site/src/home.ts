import { type DeviceKind, friendsNowOf, type FriendsInGame, AGE_BAND_FLOOR_YEARS, KEPT_PLAYED_GAME_COUNT, NOT_BLOCKED_IN_COUNTRY_SQL, SHOWN_IN_LISTS_SQL, requestCountryCode, gameBySlug, mergePlayed, priceFor, priceText, readPlayModes, recentlyPlayed, recordPlayed, type Account, type Game, type LocalPrice, type MultiplayerMode } from "@zaisma/core";
import { isProtectionOfferDue, markProtectionOffered, protectAccountWindow } from "./account-protection.ts";
import { currentSession, readCookie } from "./auth.ts";
import type { Env } from "./env.ts";
import { glassPane, type ShownPicture } from "./components/foundations.ts";
import { newestPictureJsonSql, pictureFromJson } from "./placeholders.ts";
import { leadAndSide, stack, stackOfOne, type LayoutItem } from "./components/layout.ts";
import { MAXIMUM_GAME_ROW_CARD_COUNT, gameRow } from "./components/navigation.ts";
import { backdropWords, eventBanner, gameCard, gameCardPoster, type GameCardOptions } from "./components/panes.ts";
import { joinPath } from "./friends-now.ts";
import { MAXIMUM_WHATS_ON_CARD_COUNT, currentWhatsOn, eventOf, pickWhatsOnCards, whatsOnLineup, type WhatsOnLineupCard } from "./whats-on.ts";
import { esc, html, layout, pageData, playerLine, raw, scriptTags, type Raw } from "./html.ts";
import { HOME_SCRIPT, PLAYED_COOKIE } from "./home-script.ts";
import { MINIMUM_PLAYING_NOW_PLAYER_COUNT, playingNowCounts, shelfPlayers } from "./plays.ts";
import { viewerOf } from "./viewer.ts";
import { viewerDeviceKind } from "./device-kind.ts";

/**
 * The home page and what it needs, in two panes by what they're for, over Zaisma's own world, with no game's world. First what's for the player tonight: their
 * game beside What's on, or on a first visit one line flat on the backdrop and What's on alone. Then what else is here: friends playing, what people
 * are playing now, Never played, Popular, Trending, New and the kinds of game. An event's art runs across the top while one's on.
 * Which opening shows comes from an account's list or what this device played (PLAYED_COOKIE), from the first paint.
 */

export interface ShowGame {
  id: string;
  slug: string;
  title: string;
  description: string;
  developer: string | null;
  owner_id: string | null;
  cover: string | null;
  /** The cover as a page shows it, with its size and placeholder (gameCard). */
  cover_picture: ShownPicture | null;
  /** The square cover phones show instead, if the developer added one. */
  square: string | null;
  /** When the game first went live; it never moves. */
  first_published_at_ms: number | null;
  /** The last marked big update: the Updated tag and Continue playing's Recently updated. */
  big_update_at_ms: number | null;
  /** Where Browse's Recently updated places it; null is first_published_at_ms. */
  recently_updated_at_ms: number | null;
  /** How it's played, in a few words: "Single-player · Online co-op". */
  modes: string;
  devices: string[];
  controls: string[];
  /** portrait, landscape, either, or "" when not set. */
  screen_orientation: string;
  /** Up to 3 of GENRES. */
  genres: string[];
  /** It has a multiplayer mode, or a local or online play mode: Browse's Multiplayer filter. */
  is_multiplayer: boolean;
  /** It plays alone: a single play mode, or no modes said and no multiplayer: Browse's Single-player filter. */
  is_single_player: boolean;
  /** People playing it right now (checked browsers with it on screen); cards show it from MINIMUM_PLAYING_NOW_PLAYER_COUNT up. */
  playing_now_player_count: number;
  /** none, multiplayer or whole_game: a guest can't start a whole_game game without an account. */
  account_requirement: Game["account_requirement"];
  /** The color the developer tints Zaisma's glass with on the game's page; a card's lit foot takes it too. */
  glass_tint_color: string | null;
  /** It sells itself once (games.full_game_item_name): only owners play it. */
  is_paid: boolean;
  /** A paid game's price to play in the viewer's country; null for a free game, or a paid one not on sale now. */
  full_game_price: { currencyCode: string; priceMinorUnits: number } | null;
}

const PEOPLE_ICON = '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="6" cy="5.2" r="2.4"/><path d="M1.8 13.2c0-2.4 1.9-4.2 4.2-4.2s4.2 1.8 4.2 4.2"/><circle cx="11.6" cy="5.8" r="1.9"/><path d="M10.9 9c2 .2 3.4 1.9 3.4 4"/></svg>';

/**
 * Listed, live games with what their cards need, newest update first, leaving out games for players older than viewerAgeFloorYears,
 * games the listing check keeps off lists ("No slop") and games blocked in the viewer's country (countryCode, null when unknown).
 */
export async function showcase(env: Env, viewerAgeFloorYears: number, maximumGameCount = 200, countryCode: string | null = null): Promise<ShowGame[]> {
  const [{ results }, playingNow] = await Promise.all([env.DB
    .prepare(
      `SELECT games.id, games.slug, games.title, games.description, games.owner_id, games.devices, games.controls, games.screen_orientation, games.genres, games.play_modes, games.multiplayer_mode, games.account_requirement, games.glass_tint_color, games.full_game_item_name,
         ${FULL_GAME_ITEM_SQL},
         accounts.username AS developer, games.first_published_at_ms, games.big_update_at_ms, games.recently_updated_at_ms,
         ${newestPictureJsonSql("cover", "games.id")} AS cover,
         (SELECT id FROM game_images WHERE game_id = games.id AND kind = 'square' AND review_status = 'approved' ORDER BY created_at_ms DESC LIMIT 1) AS square
       FROM games
       LEFT JOIN owners ON owners.id = games.owner_id
       LEFT JOIN accounts ON accounts.id = owners.account_id
       WHERE games.review_status = 'live' AND games.visibility = 'listed' AND games.live_version_id IS NOT NULL AND games.minimum_player_age_years <= ? AND ${SHOWN_IN_LISTS_SQL} AND ${NOT_BLOCKED_IN_COUNTRY_SQL}
       ORDER BY COALESCE(games.recently_updated_at_ms, games.first_published_at_ms, games.updated_at_ms) DESC LIMIT ?`,
    )
    .bind(viewerAgeFloorYears, countryCode, maximumGameCount)
    .all<{ id: string; slug: string; title: string; description: string; owner_id: string | null; devices: string; controls: string; screen_orientation: string; genres: string; play_modes: string; multiplayer_mode: MultiplayerMode; account_requirement: Game["account_requirement"]; glass_tint_color: string | null; full_game_item_name: string | null; full_game_item: string | null; developer: string | null; first_published_at_ms: number | null; big_update_at_ms: number | null; recently_updated_at_ms: number | null; cover: string | null; square: string | null }>(),
    playingNowCounts(env),
  ]);
  return results.map((row) => {
    const playModes = readPlayModes(row.play_modes);
    return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    developer: row.developer,
    owner_id: row.owner_id,
    cover: row.cover ? `/img/${(JSON.parse(row.cover) as { id: string }).id}` : null,
    cover_picture: pictureFromJson(row.cover),
    square: row.square ? `/img/${row.square}` : null,
    first_published_at_ms: row.first_published_at_ms,
    big_update_at_ms: row.big_update_at_ms,
    recently_updated_at_ms: row.recently_updated_at_ms,
    modes: playerLine(playModes, row.multiplayer_mode !== "none"),
    devices: row.devices ? row.devices.split(",") : [],
    controls: row.controls ? row.controls.split(",") : [],
    screen_orientation: row.screen_orientation,
    genres: row.genres ? row.genres.split(",") : [],
    is_multiplayer: row.multiplayer_mode !== "none" || (playModes ?? []).some((playMode) => playMode.mode !== "single"),
    is_single_player: playModes ? playModes.some((playMode) => playMode.mode === "single") : row.multiplayer_mode === "none",
    playing_now_player_count: playingNow.get(row.id) ?? 0,
    account_requirement: row.account_requirement,
    glass_tint_color: row.glass_tint_color,
    is_paid: row.full_game_item_name !== null,
    full_game_price: fullGamePriceOf(row.full_game_item, countryCode),
    };
  });
}

/** The SQL that reads a game's full game item's prices as one JSON column, for fullGamePriceOf. */
export const FULL_GAME_ITEM_SQL = "(SELECT json_object('price_minor_units', price_minor_units, 'currency_code', currency_code, 'local_prices', local_prices) FROM game_items WHERE game_id = games.id AND item_name = games.full_game_item_name) AS full_game_item";

/** A paid game's price to play in this country, from FULL_GAME_ITEM_SQL's column; null for a free game or one not on sale now. */
export function fullGamePriceOf(fullGameItem: string | null, countryCode: string | null): { currencyCode: string; priceMinorUnits: number } | null {
  if (!fullGameItem) return null;
  const prices = JSON.parse(fullGameItem) as { price_minor_units: number | null; currency_code: string | null; local_prices: string };
  return priceFor({ ...prices, local_prices: JSON.parse(prices.local_prices || "[]") as LocalPrice[] }, countryCode);
}

/**
 * Of these games, the paid ones the account plays without buying: those it bought (or was granted), and its own. One read, through the
 * purchases index by game and player.
 */
export async function paidGamesOwnedBy(env: Env, account: Pick<Account, "id" | "player_id"> | null | undefined, games: readonly Pick<ShowGame, "id" | "is_paid">[]): Promise<Set<string>> {
  const paidGameIds = games.filter((game) => game.is_paid).map((game) => game.id);
  if (!account || !paidGameIds.length) return new Set();
  const { results } = await env.DB.prepare(
    `SELECT purchases.game_id FROM purchases JOIN games ON games.id = purchases.game_id
       WHERE purchases.game_id IN (SELECT value FROM json_each(?1)) AND purchases.player_id = ?2 AND purchases.item_name = games.full_game_item_name AND purchases.item_kind = 'permanent' AND purchases.purchase_status = 'completed'
     UNION SELECT games.id FROM games JOIN owners ON owners.id = games.owner_id WHERE games.id IN (SELECT value FROM json_each(?1)) AND owners.account_id = ?3`,
  )
    .bind(JSON.stringify(paidGameIds), account.player_id, account.id)
    .all<{ game_id: string }>();
  return new Set(results.map((row) => row.game_id));
}

/** The price tag on a paid game's cover: its price to play, for a viewer who doesn't own it; nothing for a free game or an owner. */
export const coverPriceText = (game: Pick<ShowGame, "id" | "full_game_price">, ownedGameIds: ReadonlySet<string>): string | undefined =>
  game.full_game_price && !ownedGameIds.has(game.id) ? priceText(game.full_game_price.currencyCode, game.full_game_price.priceMinorUnits) : undefined;

const DAY_MS = 86_400_000;
/** Games per shelf, and the fewest that make a shelf worth showing. */
const MAXIMUM_SHELF_GAME_COUNT = 12;
const MINIMUM_SHELF_GAME_COUNT = 2;

/** A game's counted players as the shelves count them (plays.ts: no cloud networks, no one network carrying it). */
export interface ShelfCount {
  /** The last 7 days, today included: Popular. */
  weekPlayerCount: number;
  /** The last 3 days: Trending. */
  recentPlayerCount: number;
  /** The 14 days before those 3: what Trending compares against. */
  earlierPlayerCount: number;
}

/** Popular's floor: fewer counted players in 7 days than this keeps a game off the Popular shelf. */
export const MINIMUM_POPULAR_PLAYER_COUNT = 3;

/**
 * Each listed game's shelf counts, by slug, for games Zaisma hasn't kept off the shelves, and the slugs it has kept off
 * (offShelfSlugs). Read by the home's shelves and by Browse, so both rank alike.
 */
export async function shelfCounts(env: Env, viewerAgeFloorYears: number, nowMs = Date.now()): Promise<{ counts: Map<string, ShelfCount>; offShelfSlugs: Set<string> }> {
  const dateDaysAgo = (dayCount: number) => new Date(nowMs - dayCount * DAY_MS).toISOString().slice(0, 10);
  const [{ results: networks }, { results: held }] = await Promise.all([
    env.DB
      .prepare(
        `SELECT games.slug, play_networks.date, play_networks.autonomous_system_number, play_networks.player_count
         FROM play_networks JOIN games ON games.id = play_networks.game_id
         WHERE play_networks.date >= ? AND games.review_status = 'live' AND games.visibility = 'listed' AND games.is_off_shelves = 0 AND games.minimum_player_age_years <= ? AND ${SHOWN_IN_LISTS_SQL}`,
      )
      .bind(dateDaysAgo(16), viewerAgeFloorYears)
      .all<{ slug: string; date: string; autonomous_system_number: number; player_count: number }>(),
    env.DB.prepare("SELECT slug FROM games WHERE is_off_shelves = 1").all<{ slug: string }>(),
  ]);
  const byDay = new Map<string, Map<string, { autonomous_system_number: number; player_count: number }[]>>();
  for (const network of networks) {
    const days = byDay.get(network.slug) ?? new Map<string, { autonomous_system_number: number; player_count: number }[]>();
    days.set(network.date, [...(days.get(network.date) ?? []), network]);
    byDay.set(network.slug, days);
  }
  const counts = new Map<string, ShelfCount>();
  for (const [slug, days] of byDay) {
    const sum = (from: string, to = "9999") => [...days].filter(([date]) => date >= from && date < to).reduce((totalPlayerCount, [, rows]) => totalPlayerCount + shelfPlayers(rows), 0);
    counts.set(slug, { weekPlayerCount: sum(dateDaysAgo(6)), recentPlayerCount: sum(dateDaysAgo(2)), earlierPlayerCount: sum(dateDaysAgo(16), dateDaysAgo(2)) });
  }
  return { counts, offShelfSlugs: new Set(held.map((heldGame) => heldGame.slug)) };
}

/** Over 3 days, what the 14 before would suggest. */
const usualRecentPlayerCount = (counts: ShelfCount) => (counts.earlierPlayerCount / 14) * 3;
/** A game is trending with at least 10 players in 3 days, half as many again as usual. */
export const isTrending = (counts: ShelfCount): boolean => counts.recentPlayerCount >= 10 && counts.recentPlayerCount >= usualRecentPlayerCount(counts) * 1.5;
/** How strongly it trends: its usual plus 10, so a handful of players can't trend. */
export const trendingScore = (counts: ShelfCount): number => counts.recentPlayerCount / (usualRecentPlayerCount(counts) + 10);

/**
 * Popular, trending and new, the same for everyone, by plain rules from counted plays (plays.ts), not
 * AI, counting players the way shelfPlayers does. Popular: the most players in the last 7 days. Trending: more players in the last 3 days than
 * the 14 before would suggest, at least half as many again. New: first went live in the last 60 days, newest first. A shelf with too few games is left out.
 * gamesOnShelves is every listed game Zaisma hasn't kept off the shelves, in the order given: what's left to show when those three run short.
 */
export async function shelves<GameOnShelf extends Pick<ShowGame, "slug" | "first_published_at_ms">>(env: Env, games: GameOnShelf[] | Promise<GameOnShelf[]>, viewerAgeFloorYears: number, nowMs = Date.now()): Promise<{ popular: GameOnShelf[]; trending: GameOnShelf[]; fresh: GameOnShelf[]; gamesOnShelves: GameOnShelf[] }> {
  // The games may still be on their way (the home starts every read at once): the counts don't need them, only the picking after.
  const [{ counts: countsBySlug, offShelfSlugs: off }, listedGames] = await Promise.all([shelfCounts(env, viewerAgeFloorYears, nowMs), games]);
  const shelfCounted = [...countsBySlug].map(([slug, counts]) => ({ slug, ...counts }));
  const bySlug = new Map(listedGames.map((game) => [game.slug, game]));
  const pick = (slugs: string[]) => {
    const list = slugs.map((slug) => bySlug.get(slug)).filter((game): game is GameOnShelf => Boolean(game)).slice(0, MAXIMUM_SHELF_GAME_COUNT);
    return list.length >= MINIMUM_SHELF_GAME_COUNT ? list : [];
  };
  const popular = pick(shelfCounted.filter((counts) => counts.weekPlayerCount >= MINIMUM_POPULAR_PLAYER_COUNT).sort((first, second) => second.weekPlayerCount - first.weekPlayerCount).map((counts) => counts.slug));
  const trending = pick(shelfCounted.filter(isTrending).sort((first, second) => trendingScore(second) - trendingScore(first)).map((counts) => counts.slug));
  const fresh = pick(
    listedGames
      .filter((game) => game.first_published_at_ms && game.first_published_at_ms >= nowMs - 60 * DAY_MS && !off.has(game.slug))
      .sort((first, second) => second.first_published_at_ms! - first.first_published_at_ms!)
      .map((game) => game.slug),
  );
  return { popular, trending, fresh, gamesOnShelves: listedGames.filter((game) => !off.has(game.slug)) };
}

/**
 * A game card: the developer's cover and nothing else, since a studio's art carries its own name and
 * logo. It opens the game's page; only a Play button starts a game. A game without a cover gets its
 * title engraved on a plate. `flag` is a small note on the art, like "Updated".
 */
export function tile(game: Pick<ShowGame, "slug" | "title" | "cover" | "square"> & { playing_now_player_count?: number }, options: { flag?: string } = {}): Raw {
  return raw(card(game, options.flag));
}

/**
 * The card's HTML (the home page's script builds the same in the browser). Phones
 * show square cards: the square cover when there is one, otherwise the landscape cover whole (never
 * cropped, so no logo is cut off) over a blurred copy of itself.
 */
function card(game: Pick<ShowGame, "slug" | "title" | "cover" | "square"> & { playing_now_player_count?: number }, flag?: string, label = game.title): string {
  const art = !game.cover
    ? `<span class="named"><span>${esc(game.title)}</span></span>`
    : game.square
      ? `<picture><source media="(max-width:640px)" srcset="${esc(game.square)}"><img src="${esc(game.cover)}" alt="" loading="lazy"></picture>`
      : `<span class="fill" style="--fill:url(${esc(game.cover)})"></span><img src="${esc(game.cover)}" alt="" loading="lazy">`;
  return `<div class="hit block"><a class="tile${game.cover && !game.square ? " wide" : ""}" href="/g/${esc(game.slug)}" aria-label="${esc(label)}"><span class="pic">${art}${flag ? `<span class="flag">${esc(flag)}</span>` : ""}</span></a>${(game.playing_now_player_count ?? 0) >= MINIMUM_PLAYING_NOW_PLAYER_COUNT ? `<span class="players">${PEOPLE_ICON}${game.playing_now_player_count}<span class="sr"> playing now</span></span>` : ""}</div>`;
}

const shownPlayerCount = (game: ShowGame): number | undefined => (game.playing_now_player_count >= MINIMUM_PLAYING_NOW_PLAYER_COUNT ? game.playing_now_player_count : undefined);

/** What kind of game it is and how it's played, for the line under a card's title. */

/** A game in one of the home's lists. */
const coverOf = (game: ShowGame, ownedGameIds: ReadonlySet<string>, options: Pick<GameCardOptions, "isEager" | "hasHighPriority" | "playHref"> & { tagWords?: string | null } = {}): Raw =>
  gameCard({ title: game.title, picture: game.cover_picture, href: `/g/${game.slug}`, playHref: options.playHref, tintColor: game.glass_tint_color, isEager: options.isEager, hasHighPriority: options.hasHighPriority, facts: { playerCount: shownPlayerCount(game), tagWords: options.tagWords ?? undefined, priceText: coverPriceText(game, ownedGameIds) } });

/** A shelf's games with those made for this kind of device first, as the home's script keeps them, so they're in their place from the first paint. */
const forDeviceFirst = (list: ShowGame[], deviceKind: DeviceKind) => {
  const fits = (game: ShowGame) => !game.devices.length || game.devices.includes(deviceKind);
  return [...list.filter(fits), ...list.filter((game) => !fits(game))];
};

function homeGameRow(id: string, title: string, titleHref: string | undefined, list: ShowGame[], ownedGameIds: ReadonlySet<string>): LayoutItem {
  return { kind: "block", markup: gameRow({ id, trackId: `track-${id}`, title, seeAll: titleHref ? { href: titleHref, gameCount: list.length, coverPictures: list.map((game) => game.cover_picture) } : undefined, items: list.map((game) => ({ kind: "block" as const, markup: coverOf(game, ownedGameIds) })) }) };
}

/** A game friends are in: who's there, and Join when it would let the player in. */
function friendsCoverPicture(playing: FriendsInGame, games: readonly ShowGame[]): ShowGame["cover_picture"] {
  const game = playing.game!, listed = games.find((each) => each.slug === game.slug);
  return listed?.cover_picture ?? (game.cover_image_id ? { imageUrl: `/img/${game.cover_image_id}`, widthPx: 1600, heightPx: 900, placeholderDataUrl: null } : null);
}

function friendsCard(playing: FriendsInGame, games: readonly ShowGame[]): Raw {
  const game = playing.game!, listed = games.find((each) => each.slug === game.slug);
  const coverPicture = friendsCoverPicture(playing, games);
  const names = playing.friends.map((friend) => friend.name);
  return gameCard({ title: game.title, picture: coverPicture, href: `/g/${game.slug}`, tintColor: listed?.glass_tint_color, joinHref: playing.join && !playing.join.refusal ? joinPath(game.slug, playing.join) : undefined, facts: { friends: names.map((username) => ({ username })) } });
}


/** The first visit's words, flat on the backdrop, from what Zaisma is. */
const FIRST_VISIT_LINE = "One place to play every kind of game.";
const FIRST_VISIT_SMALLER_LINE = "Press Play, install nothing, bring your friends.";
/** What's on's cards beside a player's own game; alone on a first visit it has MAXIMUM_WHATS_ON_CARD_COUNT. */
const WHATS_ON_BESIDE_GAME_CARD_COUNT = 2;

export async function home(env: Env, request: Request): Promise<Response> {
  // A younger account never finds a game for older players; everyone else sees the same page.
  const viewer = await viewerOf(request, env);
  const account = viewer.account;
  const deviceKind = viewerDeviceKind(request);
  // Back to progress they saved with neither a passkey nor an email: asked once to protect the account.
  const protectionOffer = async (signedInAccount: Account): Promise<boolean> => {
    const isDue = await isProtectionOfferDue(env, signedInAccount, viewer.email);
    if (isDue) await markProtectionOffered(env, signedInAccount.id);
    return isDue;
  };
  // Every read the page needs starts at once, one wave to the database: the shelves take the games only to pick from, once their own reads are back.
  const gamesRead = showcase(env, viewer.ageFloorYears, undefined, requestCountryCode(request));
  const [isProtectionOffered, games, { popular, trending, fresh, gamesOnShelves }, accountPlayed, whatsOn, friendsNow] = await Promise.all([
    account ? protectionOffer(account) : false,
    gamesRead,
    shelves(env, gamesRead, viewer.ageFloorYears),
    // An account's Continue playing, in its place from the first paint; a guest's comes with the request (PLAYED_COOKIE), below.
    account ? recentlyPlayed(env.DB, account.id, AGE_BAND_FLOOR_YEARS[account.age_band]) : Promise.resolve([]),
    currentWhatsOn(env),
    account ? friendsNowOf(env.DB, account.id, AGE_BAND_FLOOR_YEARS[account.age_band]) : Promise.resolve(null),
  ]);
  const ownedGameIds = await paidGamesOwnedBy(env, account, games);
  // Zaisma's event, shown from the first paint until it ends.
  // An account's from the server; a guest's from the slugs this device sends, kept nowhere. The home's script adds this device's to an account's.
  const guestPlayedSlugs = account ? [] : (readCookie(request, env, PLAYED_COOKIE) ?? "").split(",").filter((slug) => /^[a-z0-9-]{1,64}$/.test(slug)).slice(0, KEPT_PLAYED_GAME_COUNT);
  const playedSlugs = account ? accountPlayed.map((entry) => entry.slug) : guestPlayedSlugs;
  const playedGames = playedSlugs.flatMap((slug) => games.filter((game) => game.slug === slug));
  const isReturning = playedGames.length > 0;
  const event = whatsOn.event ? eventOf(whatsOn.event) : null;
  const eventStrip: LayoutItem[] = event
    ? [{ kind: "block", id: "home-event", markup: eventBanner({ title: event.title, widePicture: event.wide_art_url, narrowPicture: event.narrow_art_url, action: { label: event.link_label, href: event.link_url } }) }]
    : [];
  const yourGame = playedGames[0];
  const nowMs = Date.now();
  const whatsOnCards = pickWhatsOnCards(games, whatsOn.picks, {
    trendingSlugs: new Set(trending.map((game) => game.slug)),
    popularSlugs: popular.map((game) => game.slug),
    excludedSlugs: new Set(yourGame ? [yourGame.slug] : []),
    offShelfSlugs: new Set(games.filter((game) => !gamesOnShelves.includes(game)).map((game) => game.slug)),
    nowMs,
  });
  // Zaisma's own first (events' posters, then news), never every card while there are games, then games.
  const whatsOnLine = whatsOnLineup(whatsOn.entryCards, whatsOnCards, yourGame ? WHATS_ON_BESIDE_GAME_CARD_COUNT : MAXIMUM_WHATS_ON_CARD_COUNT);
  const lineupCardOf = (card: WhatsOnLineupCard, coverIndex: number): Raw =>
    card.cardKind === "game"
      ? coverOf(card.game, ownedGameIds, { tagWords: card.tagWords, isEager: true, hasHighPriority: !yourGame && coverIndex === 0 })
      : card.entryKind === "event" && card.art
        ? gameCardPoster({ title: card.title, picture: card.art, href: card.linkUrl, isEager: true })
        : gameCard({ title: card.title, picture: card.art, href: card.linkUrl, isEager: true, facts: { tagWords: "News" } });
  const whatsOnRow = gameRow({ id: "whats-on", trackId: "track-whats-on", title: "What's on", allInView: { isLeadWide: !yourGame }, items: whatsOnLine.map((card, coverIndex) => ({ kind: "block" as const, markup: lineupCardOf(card, coverIndex) })) });
  const yourGamePlayedAtMs = yourGame ? accountPlayed.find((entry) => entry.slug === yourGame.slug)?.played_at_ms : undefined;
  const isYourGameUpdated = Boolean(yourGame?.big_update_at_ms && yourGamePlayedAtMs && yourGame.big_update_at_ms > yourGamePlayedAtMs);
  // What's for the player tonight: their game alone on its pane, and What's on as a Game row beside it, each only as tall as it holds.
  const forTonight = yourGame
    ? leadAndSide({ lead: { kind: "block", markup: glassPane({ paneWidth: "full", label: "Your game", body: stackOfOne(coverOf(yourGame, ownedGameIds, { playHref: `/g/${yourGame.slug}?play`, tagWords: isYourGameUpdated ? "Updated" : undefined, isEager: true, hasHighPriority: true })) }) }, side: { kind: "block", markup: whatsOnRow } })
    : whatsOnRow;
  // What else is here. A row whose games all showed higher up would only repeat them, and leaves.
  const shownSlugs = new Set([...(yourGame ? [yourGame.slug] : []), ...whatsOnLine.flatMap((card) => (card.cardKind === "game" ? [card.game.slug] : []))]);
  const playingNow = gamesOnShelves.filter((game) => game.playing_now_player_count >= MINIMUM_PLAYING_NOW_PLAYER_COUNT).sort((first, second) => second.playing_now_player_count - first.playing_now_player_count).slice(0, MAXIMUM_GAME_ROW_CARD_COUNT);
  const neverPlayed = gamesOnShelves.filter((game) => !playedSlugs.includes(game.slug)).slice(0, MAXIMUM_GAME_ROW_CARD_COUNT);
  const rows = [
    { id: "playing-now", title: "Playing now", titleHref: undefined, list: playingNow, isShown: true },
    { id: "never-played", title: "Never played", titleHref: undefined, list: neverPlayed, isShown: isReturning },
    { id: "popular", title: "Popular", titleHref: "/games?sort=popular", list: popular, isShown: true },
    { id: "trending", title: "Trending", titleHref: "/games?sort=trending", list: trending, isShown: isReturning },
    { id: "new", title: "New", titleHref: "/games?sort=new", list: fresh, isShown: isReturning },
  ].filter(({ list, isShown }) => {
    if (!isShown || !list.length) return false;
    const isRepeat = list.every((game) => shownSlugs.has(game.slug));
    for (const game of list) shownSlugs.add(game.slug);
    return !isRepeat;
  });
  const friendsPlaying = (friendsNow?.playing ?? []).filter((playing) => playing.game);
  const friendsSection: LayoutItem[] = friendsPlaying.length
    ? [{ kind: "block", markup: gameRow({ id: "friends-playing", trackId: "track-friends-playing", title: "Friends playing", seeAll: { href: "/friends", gameCount: friendsPlaying.length, coverPictures: friendsPlaying.map((playing) => friendsCoverPicture(playing, games)) }, items: friendsPlaying.slice(0, MAXIMUM_GAME_ROW_CARD_COUNT).map((playing) => ({ kind: "block" as const, markup: friendsCard(playing, games) })) }) }]
    : [];
  // Past the rows, the whole of Browse: every game, every kind.
  // What else is here: each kind of list on its own Game row, each its own pane.
  const whatElse: LayoutItem[] = [...friendsSection, ...rows.map(({ id, title, titleHref, list }) => homeGameRow(id, title, titleHref, forDeviceFirst(list, deviceKind), ownedGameIds))];
  const body = games.length >= MINIMUM_SHELF_GAME_COUNT
    ? html`<div id="home-games">${isReturning ? html`<h1 class="sr">Games on Zaisma</h1>` : ""}${stack({
        items: [
          ...eventStrip,
          ...(isReturning ? [] : [{ kind: "block" as const, id: "home-first-visit", markup: backdropWords({ line: FIRST_VISIT_LINE, smallerLine: FIRST_VISIT_SMALLER_LINE }) }]),
          { kind: "block", markup: forTonight },
          ...whatElse,
        ],
      })}</div>`
    : stack({ items: [...eventStrip, { kind: "block", markup: glassPane({ paneWidth: "fit", body: stack({ items: [{ kind: "words", markup: html`<h1>Every kind of game. One link away.</h1>` }, { kind: "words", markup: html`<p>The first games are on their way.</p>` }] }) }) }] });
  const response = layout(env, {
    title: "Zaisma: every kind of game, one link away",
    // Filtered for a signed-in viewer's age, or showing what this device played, so no shared cache keeps it.
    isPrivate: Boolean(viewer.account) || guestPlayedSlugs.length > 0,
    nav: "home",
    viewer,
    checkedPage: isReturning ? "Home, returning" : viewer.account ? "Home, signed in" : "Home",
    pageShape: "full",
    body: html`${body}
${isProtectionOffered ? protectAccountWindow() : ""}
${pageData("home-data", { is_signed_in: Boolean(account)})}${scriptTags(HOME_SCRIPT)}`,
  });
  for (const cookie of viewer.cookies) response.headers.append("Set-Cookie", cookie);
  return response;
}


/**
 * Recently played, for signed-in players.
 *   GET  /api/me/played          { played: [{ slug, played_at_ms }] }, newest first
 *   POST /api/me/played/:slug    remember that they just pressed Play
 *   POST /api/me/played          { played: [{ slug, played_at_ms }] } from this device's list, when a guest makes an account
 */
export async function handlePlayed(request: Request, env: Env, path: string): Promise<Response | null> {
  const match = path.match(/^\/api\/me\/played(?:\/([a-z0-9-]+))?$/);
  if (!match) return null;
  const json = (body: unknown, httpStatus = 200, cookies: string[] = []) => {
    const response = Response.json(body, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
    for (const cookie of cookies) response.headers.append("Set-Cookie", cookie);
    return response;
  };
  const session = await currentSession(request, env);
  if (!session) return json({ error: "Signed out" }, 401);
  const account = await env.DB.prepare("SELECT id, age_band FROM accounts WHERE id = ?").bind(session.userId).first<Pick<Account, "id" | "age_band">>();
  if (!account) return json({ error: "No account" }, 401, session.cookies);
  if (!match[1] && request.method === "GET") return json({ played: await recentlyPlayed(env.DB, account.id, AGE_BAND_FLOOR_YEARS[account.age_band]) }, 200, session.cookies);
  if (!match[1] && request.method === "POST") {
    let body: { played?: unknown };
    try {
      body = await request.json();
    } catch {
      return json({ error: "Bad list" }, 400, session.cookies);
    }
    const list = Array.isArray(body.played) ? body.played.slice(0, KEPT_PLAYED_GAME_COUNT) : [];
    const nowMs = Date.now();
    const played: { gameId: string; playedAtMs: number }[] = [];
    for (const entry of list as { slug?: unknown; played_at_ms?: unknown }[]) {
      const game = typeof entry?.slug === "string" ? await gameBySlug(env.DB, entry.slug) : null;
      const playedAtMs = Number(entry?.played_at_ms);
      if (game && playable(game) && Number.isFinite(playedAtMs) && playedAtMs > 0) played.push({ gameId: game.id, playedAtMs: Math.min(playedAtMs, nowMs) });
    }
    await mergePlayed(env.DB, account.id, played);
    return json({ ok: true }, 200, session.cookies);
  }
  if (match[1] && request.method === "POST") {
    const game = await gameBySlug(env.DB, match[1]);
    if (!game || !playable(game)) return json({ error: "No such game" }, 404, session.cookies);
    await recordPlayed(env.DB, account.id, game.id);
    return json({ ok: true }, 200, session.cookies);
  }
  return json({ error: "Not here" }, 405, session.cookies);
}

/** Games players can open by their link. */
export function playable(game: Game): boolean {
  return game.review_status === "live" && Boolean(game.live_version_id) && (game.visibility === "listed" || game.visibility === "unlisted");
}
