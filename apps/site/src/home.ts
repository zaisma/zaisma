import { AGE_BAND_FLOOR_YEARS, KEPT_PLAYED_GAME_COUNT, NOT_BLOCKED_IN_COUNTRY_SQL, SHOWN_IN_LISTS_SQL, requestCountryCode, gameBySlug, mergePlayed, readPlayModes, recentlyPlayed, recordPlayed, type Account, type Game, type MultiplayerMode } from "@zaisma/core";
import { isProtectionOfferDue, markProtectionOffered, protectAccountWindow } from "./account-protection.ts";
import { currentSession } from "./auth.ts";
import type { Env } from "./env.ts";
import { backgroundsOfGames, type ShownBackground } from "./backgrounds.ts";
import { textButton } from "./components/actions.ts";
import { glassPane, icon, tag } from "./components/foundations.ts";
import { row, stack, type LayoutItem } from "./components/layout.ts";
import { shelf } from "./components/navigation.ts";
import { banner, gameCover } from "./components/panes.ts";
import { currentAnnouncement } from "./announcements.ts";
import { shownAddress } from "./markup.ts";
import { esc, html, layout, pageData, playerLine, raw, scriptTags, type Raw } from "./html.ts";
import { HOME_SCRIPT } from "./home-script.ts";
import { MINIMUM_PLAYING_NOW_PLAYER_COUNT, playingNowCounts, shelfPlayers } from "./plays.ts";
import { viewerOf } from "./viewer.ts";

/**
 * The home page and what it needs: one sheet of rows, there as the page opens, and Zaisma's news above them while there is any. The
 * page is the same for everyone (so it caches); the player's own part, Continue playing, is filled in by the browser from what this
 * device remembers, plus the account's list when signed in.
 */

export interface ShowGame {
  id: string;
  slug: string;
  title: string;
  description: string;
  developer: string | null;
  owner_id: string | null;
  cover: string | null;
  /** The square cover phones show instead, if the developer added one. */
  square: string | null;
  /** When the version players get now went live. */
  published_at_ms: number | null;
  /** When the game first went live. */
  first_published_at_ms: number | null;
  /** How it's played, in a few words: "Single-player · Online co-op". */
  modes: string;
  devices: string[];
  /** People playing it right now (checked browsers with it on screen); cards show it from MINIMUM_PLAYING_NOW_PLAYER_COUNT up. */
  playing_now_player_count: number;
  /** none, multiplayer or whole_game: a guest can't start a whole_game game without an account. */
  account_requirement: Game["account_requirement"];
  /** The color the developer tints Zaisma's glass with while the game's background is behind it on the home. */
  glass_tint_color: string | null;
  /** What the home shows behind its glass while the game's cover is pointed at; null is Zaisma's own on both screens (the home's script fills it, backgroundsOfGames). */
  background: { wide: ShownBackground; phone: ShownBackground } | null;
}

const PEOPLE_ICON = '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="6" cy="5.2" r="2.4"/><path d="M1.8 13.2c0-2.4 1.9-4.2 4.2-4.2s4.2 1.8 4.2 4.2"/><circle cx="11.6" cy="5.8" r="1.9"/><path d="M10.9 9c2 .2 3.4 1.9 3.4 4"/></svg>';

/**
 * Listed, live games with what their cards need, newest update first, leaving out games for players older than viewerAgeFloorYears,
 * games the listing check keeps off lists ("No slop") and games blocked in the viewer's country (countryCode, null when unknown).
 */
export async function showcase(env: Env, viewerAgeFloorYears: number, maximumGameCount = 200, countryCode: string | null = null): Promise<ShowGame[]> {
  const [{ results }, playingNow] = await Promise.all([env.DB
    .prepare(
      `SELECT games.id, games.slug, games.title, games.description, games.owner_id, games.devices, games.play_modes, games.multiplayer_mode, games.account_requirement, games.glass_tint_color,
         accounts.username AS developer, versions.published_at_ms,
         (SELECT MIN(published_at_ms) FROM versions WHERE game_id = games.id) AS first_published_at_ms,
         (SELECT id FROM game_images WHERE game_id = games.id AND kind = 'cover' AND review_status = 'approved' ORDER BY created_at_ms DESC LIMIT 1) AS cover,
         (SELECT id FROM game_images WHERE game_id = games.id AND kind = 'square' AND review_status = 'approved' ORDER BY created_at_ms DESC LIMIT 1) AS square
       FROM games
       LEFT JOIN owners ON owners.id = games.owner_id
       LEFT JOIN accounts ON accounts.id = owners.account_id
       LEFT JOIN versions ON versions.id = games.live_version_id
       WHERE games.review_status = 'live' AND games.visibility = 'listed' AND games.live_version_id IS NOT NULL AND games.minimum_player_age_years <= ? AND ${SHOWN_IN_LISTS_SQL} AND ${NOT_BLOCKED_IN_COUNTRY_SQL}
       ORDER BY COALESCE(versions.published_at_ms, games.updated_at_ms) DESC LIMIT ?`,
    )
    .bind(viewerAgeFloorYears, countryCode, maximumGameCount)
    .all<{ id: string; slug: string; title: string; description: string; owner_id: string | null; devices: string; play_modes: string; multiplayer_mode: MultiplayerMode; account_requirement: Game["account_requirement"]; glass_tint_color: string | null; developer: string | null; published_at_ms: number | null; first_published_at_ms: number | null; cover: string | null; square: string | null }>(),
    playingNowCounts(env),
  ]);
  return results.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    developer: row.developer,
    owner_id: row.owner_id,
    cover: row.cover ? `/img/${row.cover}` : null,
    square: row.square ? `/img/${row.square}` : null,
    published_at_ms: row.published_at_ms,
    first_published_at_ms: row.first_published_at_ms,
    modes: playerLine(readPlayModes(row.play_modes), row.multiplayer_mode !== "none"),
    devices: row.devices ? row.devices.split(",") : [],
    playing_now_player_count: playingNow.get(row.id) ?? 0,
    account_requirement: row.account_requirement,
    glass_tint_color: row.glass_tint_color,
    background: null,
  }));
}

const DAY_MS = 86_400_000;
/** Games per shelf, and the fewest that make a shelf worth showing. */
const MAXIMUM_SHELF_GAME_COUNT = 12;
const MINIMUM_SHELF_GAME_COUNT = 2;

/**
 * Popular, trending and new, the same for everyone, by plain rules from counted plays (plays.ts), not
 * AI, counting players the way shelfPlayers does. Popular: the most players in the last 7 days. Trending: more players in the last 3 days than
 * the 14 before would suggest, at least half as many again. New: first went live in the last 60 days, newest first. A shelf with too few games is left out.
 */
export async function shelves<GameOnShelf extends Pick<ShowGame, "slug" | "first_published_at_ms">>(env: Env, games: GameOnShelf[], viewerAgeFloorYears: number, nowMs = Date.now()): Promise<{ popular: GameOnShelf[]; trending: GameOnShelf[]; fresh: GameOnShelf[] }> {
  const dateDaysAgo = (dayCount: number) => new Date(nowMs - dayCount * DAY_MS).toISOString().slice(0, 10);
  // Counted players by network, for listed games Zaisma hasn't kept off the shelves.
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
  // Each game's days, as the shelves count them (plays.ts: no cloud networks, no one network carrying it).
  const byDay = new Map<string, Map<string, { autonomous_system_number: number; player_count: number }[]>>();
  for (const network of networks) {
    const days = byDay.get(network.slug) ?? new Map<string, { autonomous_system_number: number; player_count: number }[]>();
    days.set(network.date, [...(days.get(network.date) ?? []), network]);
    byDay.set(network.slug, days);
  }
  const shelfCounts = [...byDay].map(([slug, days]) => {
    const sum = (from: string, to = "9999") => [...days].filter(([date]) => date >= from && date < to).reduce((totalPlayerCount, [, rows]) => totalPlayerCount + shelfPlayers(rows), 0);
    return { slug, weekPlayerCount: sum(dateDaysAgo(6)), recentPlayerCount: sum(dateDaysAgo(2)), earlierPlayerCount: sum(dateDaysAgo(16), dateDaysAgo(2)) };
  });
  const off = new Set(held.map((heldGame) => heldGame.slug));
  const bySlug = new Map(games.map((game) => [game.slug, game]));
  const pick = (slugs: string[]) => {
    const list = slugs.map((slug) => bySlug.get(slug)).filter((game): game is GameOnShelf => Boolean(game)).slice(0, MAXIMUM_SHELF_GAME_COUNT);
    return list.length >= MINIMUM_SHELF_GAME_COUNT ? list : [];
  };
  const popular = pick(shelfCounts.filter((counts) => counts.weekPlayerCount >= 3).sort((first, second) => second.weekPlayerCount - first.weekPlayerCount).map((counts) => counts.slug));
  // Over 3 days, what the 14 before would suggest, plus 10 so a handful of players can't trend.
  const usualRecentPlayerCount = (counts: { earlierPlayerCount: number }) => (counts.earlierPlayerCount / 14) * 3;
  const trending = pick(
    shelfCounts
      .filter((counts) => counts.recentPlayerCount >= 10 && counts.recentPlayerCount >= usualRecentPlayerCount(counts) * 1.5)
      .sort((first, second) => second.recentPlayerCount / (usualRecentPlayerCount(second) + 10) - first.recentPlayerCount / (usualRecentPlayerCount(first) + 10))
      .map((counts) => counts.slug),
  );
  const fresh = pick(
    games
      .filter((game) => game.first_published_at_ms && game.first_published_at_ms >= nowMs - 60 * DAY_MS && !off.has(game.slug))
      .sort((first, second) => second.first_published_at_ms! - first.first_published_at_ms!)
      .map((game) => game.slug),
  );
  return { popular, trending, fresh };
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

/** A game in one of the home's rows (the home's script builds the same in the browser for Continue playing). */
export const coverOf = (game: ShowGame): Raw => gameCover({ title: game.title, imageUrl: game.cover ?? null, href: `/g/${game.slug}`, facts: { playerCount: shownPlayerCount(game) } });

/** One of the home's shelves: its heading (a link to Browse with this sort), its arrows and its covers. */
function homeShelf(id: string, title: string, sortName: string, list: ShowGame[]): LayoutItem {
  return { kind: "block", markup: shelf({ id, trackId: `track-${id}`, title, titleHref: `/games?sort=${sortName}`, items: list.map((game) => ({ kind: "block" as const, markup: coverOf(game) })) }) };
}

/** What of each game the home's script needs: Continue playing's covers and the background behind the cover pointed at. */
const BROWSER_GAME_FIELDS = ["slug", "title", "cover", "published_at_ms", "playing_now_player_count", "glass_tint_color", "background"] as const;

export async function home(env: Env, request: Request): Promise<Response> {
  // A younger account never finds a game for older players; everyone else sees the same page.
  const viewer = await viewerOf(request, env);
  // Back to progress they saved with neither a passkey nor an email: asked once to protect the account.
  const isProtectionOffered = viewer.account ? await isProtectionOfferDue(env, viewer.account, viewer.email) : false;
  if (isProtectionOffered) await markProtectionOffered(env, viewer.account!.id);
  const games = await showcase(env, viewer.ageFloorYears, undefined, requestCountryCode(request));
  const [{ popular, trending, fresh }, backgrounds, news] = await Promise.all([shelves(env, games, viewer.ageFloorYears), backgroundsOfGames(env, games), currentAnnouncement(env)]);
  for (const game of games) game.background = backgrounds.get(game.id) ?? null;
  const browserGames = games.map((game) => Object.fromEntries(BROWSER_GAME_FIELDS.map((name) => [name, game[name]])));
  // Zaisma's news, until it ends or this device closes it (the script shows it unless it's been closed).
  const newsLink = news ? shownAddress(news.link_url) : null;
  const newsBanner: LayoutItem[] = news
    ? [{ kind: "block", id: "home-news", isHidden: true, markup: html`<div data-announcement-id="${news.id}">${banner({ text: news.text, icon: "megaphone", action: newsLink ? { label: news.link_label ?? "Read more", href: newsLink } : undefined, closeLabel: "Close" })}</div>` }]
    : [];
  const guestBanner: LayoutItem[] = env.SUPABASE_URL
    ? [{ kind: "block", id: "home-guest", isHidden: true, markup: banner({ text: "You're playing as a guest. Your progress stays on this device. Make an account to keep it everywhere.", icon: "person", action: { label: "Make an account", href: "/join" } }) }]
    : [];
  // Shown by the home's script once this device (or the account) has played something.
  const continuePlaying = shelf({
    id: "continue",
    trackId: "track-continue",
    title: "Continue playing",
    sortTabs: [{ label: "Recently played", tabValue: "played", isCurrent: true }, { label: "Recently updated", tabValue: "updated", isCurrent: false }],
    items: [],
  });
  const body = games.length
    ? html`<div id="home-games">${glassPane({
        paneWidth: "full",
        label: "Games",
        body: html`<h1 class="sr">Games on Zaisma</h1>${stack({
          items: [
            ...newsBanner,
            ...guestBanner,
            { kind: "block", id: "home-continue", isHidden: true, markup: continuePlaying },
            ...(popular.length ? [homeShelf("popular", "Popular", "popular", popular)] : []),
            ...(trending.length ? [homeShelf("trending", "Trending", "trending", trending)] : []),
            ...(fresh.length ? [homeShelf("new", "New", "new", fresh)] : []),
            { kind: "block", markup: row({ widths: "fit", alignment: "center", items: [{ kind: "control", markup: textButton("All games", { href: "/games" }) }] }) },
          ],
        })}`,
      })}</div>`
    : glassPane({ paneWidth: "fit", body: stack({ items: [{ kind: "words", markup: html`<h1>Every kind of game. One link away.</h1>` }, { kind: "words", markup: html`<p>The first games are on their way.</p>` }] }) });
  const response = layout(env, {
    title: "Zaisma: every kind of game, one link away",
    // Filtered for a signed-in viewer's age, so no shared cache keeps it.
    isPrivate: Boolean(viewer.account),
    nav: "home",
    viewer,
    isRebuilt: true,
    body: html`${body}
${isProtectionOffered ? protectAccountWindow() : ""}
${pageData("home-data", {
      games: browserGames,
      minimum_playing_now_player_count: MINIMUM_PLAYING_NOW_PLAYER_COUNT,
      icons: { people: icon("people").html, clock: icon("clock").html },
      parts: { updated_tag: tag("Updated", "new").html },
    })}${scriptTags(HOME_SCRIPT)}`,
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
  if (request.method === "POST" && request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Bad origin" }, 403);
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
