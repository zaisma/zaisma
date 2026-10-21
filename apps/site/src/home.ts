import { AGE_BAND_FLOOR_YEARS, KEPT_PLAYED_GAME_COUNT, SHOWN_IN_LISTS_SQL, gameBySlug, mergePlayed, readPlayModes, recentlyPlayed, recordPlayed, type Account, type Game, type MultiplayerMode } from "@zaisma/core";
import { isProtectionOfferDue, markProtectionOffered, protectAccountWindow } from "./account-protection.ts";
import { currentSession } from "./auth.ts";
import type { ShownTone } from "./background-tone.ts";
import type { Env } from "./env.ts";
import { backgroundsOfGames, type ShownBackground } from "./backgrounds.ts";
import { cutButton, runButton, textButton, textLink } from "./components/actions.ts";
import { glanceFacts } from "./components/data.ts";
import { glassPane, icon, tag, tray } from "./components/foundations.ts";
import { LIGHT_GLASS, SMOKED_GLASS } from "./components/tokens.ts";
import { rowArrows } from "./components/navigation.ts";
import { banner, gameCover } from "./components/panes.ts";
import { tabSwitch } from "./components/switch.ts";
import { esc, html, layout, pageData, playerLine, raw, scriptTags, styleTags, type Raw } from "./html.ts";
import { HOME_OPENING_SCRIPT, HOME_SCRIPT } from "./home-script.ts";
import { pageScriptPath } from "./page-scripts.ts";
import { pageStyle } from "./page-styles.ts";
import { MINIMUM_PLAYING_NOW_PLAYER_COUNT, playingNowCounts, shelfPlayers } from "./plays.ts";
import { viewerOf } from "./viewer.ts";

/**
 * The home page and what it needs. The page is the same for everyone (so it caches); the player's own
 * part, the game they played last and Continue playing, is filled in by the browser from what this
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
  /** The color the developer tints Zaisma's glass with while the game is in focus on the home. */
  glass_tint_color: string | null;
  /** What the home shows behind its glass while the game is in focus; null is Zaisma's own on both screens (the home's script fills it, backgroundsOfGames). */
  background: { wide: ShownBackground; phone: ShownBackground } | null;
}

const PEOPLE_ICON = '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="6" cy="5.2" r="2.4"/><path d="M1.8 13.2c0-2.4 1.9-4.2 4.2-4.2s4.2 1.8 4.2 4.2"/><circle cx="11.6" cy="5.8" r="1.9"/><path d="M10.9 9c2 .2 3.4 1.9 3.4 4"/></svg>';

/** Listed, live games with what their cards need, newest update first, leaving out games for players older than viewerAgeFloorYears and games the listing check keeps off lists ("No slop"). */
export async function showcase(env: Env, viewerAgeFloorYears: number, maximumGameCount = 200): Promise<ShowGame[]> {
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
       WHERE games.review_status = 'live' AND games.visibility = 'listed' AND games.live_version_id IS NOT NULL AND games.minimum_player_age_years <= ? AND ${SHOWN_IN_LISTS_SQL}
       ORDER BY COALESCE(versions.published_at_ms, games.updated_at_ms) DESC LIMIT ?`,
    )
    .bind(viewerAgeFloorYears, maximumGameCount)
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

/** Shown in place of a cover for a game that has none: the home's rows are covers, so a game without one gets Zaisma's mark on glass. */
const PLACEHOLDER_COVER = "/zaisma-mark-metal.svg";

/** How many of Popular's top games a guest's first visit draws its opening game from. */
const GUEST_PICK_COUNT = 8;

const shownPlayerCount = (game: ShowGame): number | undefined => (game.playing_now_player_count >= MINIMUM_PLAYING_NOW_PLAYER_COUNT ? game.playing_now_player_count : undefined);

/** A game in one of the home's rows (the home's script builds the same in the browser for Continue playing). */
const coverOf = (game: ShowGame): Raw => gameCover({ title: game.title, imageUrl: game.cover ?? PLACEHOLDER_COVER, href: `/g/${game.slug}`, facts: { playerCount: shownPlayerCount(game) } });

/** A row of the shelf: its heading (a link to Browse with this sort, when it has one), its arrows and its covers. */
function row(id: string, title: string, sortName: string | null, list: ShowGame[]): Raw {
  return html`<section class="home-row" aria-labelledby="${id}-title">
<div class="home-row-head"><h2 id="${id}-title">${sortName ? textLink(title, `/games?sort=${sortName}`, { isQuiet: true }) : title}</h2>${rowArrows({ rowName: title, trackId: `track-${id}` })}</div>
<div class="home-track" id="track-${id}" data-fades-sideways>${list.map(coverOf)}</div>
</section>`;
}

export async function home(env: Env, request: Request): Promise<Response> {
  // A younger account never finds a game for older players; everyone else sees the same page.
  const viewer = await viewerOf(request, env);
  // Back to progress they saved with neither a passkey nor an email: asked once to protect the account.
  const isProtectionOffered = viewer.account ? await isProtectionOfferDue(env, viewer.account, viewer.email) : false;
  if (isProtectionOffered) await markProtectionOffered(env, viewer.account!.id);
  const games = await showcase(env, viewer.ageFloorYears);
  const [{ popular, trending, fresh }, backgrounds] = await Promise.all([shelves(env, games, viewer.ageFloorYears), backgroundsOfGames(env, games)]);
  for (const game of games) game.background = backgrounds.get(game.id) ?? null;
  // A guest's first visit opens on one of Popular's top games, drawn in the browser so the page stays one cached copy; before anything is popular, the newest.
  const guestPicks = (popular.length ? popular : games).slice(0, GUEST_PICK_COUNT).map((game) => game.slug);
  const first = games.find((game) => game.slug === guestPicks[0]);
  // What the browser needs of each game; its owner and ID stay on the server.
  const browserGames = games.map((game) => Object.fromEntries(Object.entries(game).filter(([name]) => name !== "owner_id" && name !== "id")));
  const body = first
    ? html`<div class="home">
<div class="home-window" aria-hidden="true"></div>
<div class="home-pane" id="home-pane">${tray({
        label: "The game in focus",
        head: html`<div class="home-stage-in"><div class="home-head${first.cover ? " has-cover" : ""}" id="home-head"><div class="cover-art home-art" data-cut-line="0" aria-hidden="true"><img id="home-art" src="${first.cover ?? PLACEHOLDER_COVER}" alt=""></div><h1 id="home-title">${first.title}</h1></div>
<div class="control-row home-actions">${runButton("Play", { href: `/g/${first.slug}?play`, isBig: true, icon: "play" })}${cutButton("Details", { href: `/g/${first.slug}`, isBig: true })}</div>
<div class="home-more" id="home-more"><div class="home-more-in" id="home-more-in"><p class="home-facts" id="home-facts">${[first.developer ? `by ${first.developer}` : "", first.modes].filter(Boolean).join(" · ")}</p><div id="home-glance">${shownPlayerCount(first) !== undefined ? glanceFacts({ playerCount: shownPlayerCount(first) }) : ""}</div><p class="home-description" id="home-description">${first.description}</p></div></div></div>`,
        body: html`<div class="home-cue">${textButton("More games", { href: "#home-games", icon: "chevron-down" })}</div>`,
      })}</div>
<div class="home-shelf" id="home-games">${glassPane({
        paneSize: "full",
        label: "Games",
        body: html`${env.SUPABASE_URL
          ? html`<div id="home-guest" hidden>${banner({ text: "You're playing as a guest. Your progress stays on this device. Make an account to keep it everywhere.", icon: "person", action: { label: "Make an account", href: "/join" } })}</div>`
          : ""}
<section class="home-row" id="home-continue" aria-labelledby="continue-title" hidden>
<div class="home-row-head"><h2 id="continue-title">Continue playing</h2>${tabSwitch({ label: "Sort", switchSize: "small", tabs: [{ label: "Recently played", tabValue: "played", isCurrent: true }, { label: "Recently updated", tabValue: "updated", isCurrent: false }] })}${rowArrows({ rowName: "Continue playing", trackId: "track-continue" })}</div>
<div class="home-track" id="track-continue" data-fades-sideways></div>
</section>
${popular.length ? row("popular", "Popular", "popular", popular) : ""}
${trending.length ? row("trending", "Trending", "trending", trending) : ""}
${fresh.length ? row("new", "New", "new", fresh) : ""}
<div class="home-all">${textButton("All games", { href: "/games" })}</div>`,
      })}</div>
</div>
<noscript><style>.home-stage-in { opacity: 1 !important; }</style></noscript>`
    : html`<div class="home"><div class="home-window" aria-hidden="true"></div>${glassPane({ paneSize: "medium", body: html`<h1>Every kind of game. One link away.</h1><p>The first games are on their way.</p>` })}</div>`;
  const response = layout(env, {
    title: "Zaisma: every kind of game, one link away",
    // Filtered for a signed-in viewer's age, so no shared cache keeps it.
    isPrivate: Boolean(viewer.account),
    nav: "home",
    viewer,
    isRebuilt: true,
    // Play opens the game's page in a frame of the home.
    frames: ["'self'"],
    // The opening game is chosen before the first paint, so the page opens on its color and glass (home-script.ts's HOME_OPENING_SCRIPT).
    head: html`${first ? html`${pageData("home-opening", { slugs: games.map((game) => game.slug), guest_picks: guestPicks, tones: openingTones(games) })}<script src="${pageScriptPath(HOME_OPENING_SCRIPT)}"></script>` : ""}${styleTags(HOME_STYLE)}`,
    body: html`${body}
${isProtectionOffered ? protectAccountWindow() : ""}
${pageData("home-data", {
      games: browserGames,
      guest_picks: guestPicks,
      minimum_playing_now_player_count: MINIMUM_PLAYING_NOW_PLAYER_COUNT,
      placeholder_cover: PLACEHOLDER_COVER,
      icons: { people: icon("people").html, clock: icon("clock").html },
      parts: { updated_tag: tag("Updated", "new").html },
    })}${scriptTags(HOME_SCRIPT)}`,
  });
  for (const cookie of viewer.cookies) response.headers.append("Set-Cookie", cookie);
  return response;
}

/** Each game's measured tone on each screen, for the games whose background has one. */
function openingTones(games: ShowGame[]): Record<string, { wide: ShownTone | null; phone: ShownTone | null }> {
  const toneOf = (background: ShownBackground) => (background.source === "zaisma" ? null : background.tone);
  return Object.fromEntries(
    games.flatMap((game) => (game.background && (toneOf(game.background.wide) || toneOf(game.background.phone)) ? [[game.slug, { wide: toneOf(game.background.wide), phone: toneOf(game.background.phone) }]] : [])),
  );
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

/**
 * The home's own placing (the pane, the shelf, the rows, the game in place); every piece in them is a component. The game in focus fills the
 * screen with its background behind the glass; the pane holds its words and Play, the shelf below holds the rows.
 */
const HOME_STYLE = pageStyle("home", () => `
/* The opening game's color and glass, before its background has loaded (home-script.ts's HOME_OPENING_SCRIPT): the same glass the
   backdrop script then gives every pane, so nothing turns from light to dark as it arrives. */
html[data-home-start][style*="--home-tone"] body { background-color: var(--home-tone); }
html[data-home-glass="light"] [data-glass]:not([data-cut-line]) { ${LIGHT_GLASS} --glass-tint: var(--home-glass-tint); }
html[data-home-glass="smoked"] [data-glass]:not([data-cut-line]) { ${SMOKED_GLASS} --glass-tint: var(--home-glass-tint); }
.home { display: grid; grid-template-columns: 390px minmax(0, 1fr); column-gap: var(--gap-block-block); align-items: start; container-type: inline-size;
  /* The staged pane: up to 520px, but no more than 45% of the page's width, and only as wide as leaves about a third of the window's
     height for the world above it (its cover grows with it, 9 wide to 5 tall, the rest of it about 160px); never narrower than docked. */
  /* Room under the staged pane, so it floats over the screen's foot: the page's edge; on a phone twice that, above its home bar. */
  --stage-gap: var(--pad-pane);
  --stage-w: max(390px, min(520px, 45cqw, (0.65 * (100svh - var(--header-room)) - 160px) * 1.78)); }
/* The window: the world, clear, above the pane and the shelf, which come up over it as the page scrolls. */
/* As tall as leaves the compact pane whole on screen under it, so Play is in view as the page opens on any screen. The script measures
   the compact pane (--home-pane-h, with room for a title on two lines); without it, a pane's usual height is kept free. */
.home-window { grid-column: 1 / -1; grid-row: 1; height: max(120px, calc(100svh - var(--header-room) - var(--home-pane-h, 220px) - var(--stage-gap))); }
.home-pane { grid-column: 1; grid-row: 2; position: sticky; top: var(--header-room); z-index: 5; margin-bottom: var(--gap-block-block); }
.is-home-ready .home-pane { transition: transform 0.45s cubic-bezier(.2,.8,.2,1), width 0.45s cubic-bezier(.2,.8,.2,1), margin-top 0.42s cubic-bezier(.2,.8,.2,1); }
/* The pane is a tray's head: staged, "More games" sits on the tray under it; docked, the tray tucks away and the head is a whole pane. */
.home-pane > .tray-group { width: 100%; }
.home-pane .tray-head { max-height: calc(100svh - var(--header-room) - var(--pad-pane)); }
/* The pane never scrolls: compact it's the cover and Play, and open its details are clamped to fit, so it gets no scrollbar. */
.home-stage-in { overflow: hidden; opacity: 0; transition: opacity 0.25s; }
.is-home-ready .home-stage-in { opacity: 1; }
/* The game's cover is its face here: its title and studio are on it, as the studio drew them, over a background that stays a background.
   The title is still the page's heading, for screen readers; a game without a cover shows it in words instead. */
.home-head h1 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin: 0; font: var(--type-title); text-wrap: balance; }
.home-head.has-cover h1 { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.home-head:not(.has-cover) .home-art { display: none; }
.home-facts { margin: 0; font: var(--type-words); }
.home-actions { margin-top: var(--gap-block-block); }
/* At the top of the page the pane is compact: the cover, Play and Details. Scrolling (or choosing a cover) opens the rest below the buttons,
   so the buttons never move on a wide screen. */
.home-more { height: 0; overflow: hidden; transition: height 0.42s cubic-bezier(.2,.8,.2,1); }
.home-more-in { display: flex; flex-direction: column; gap: var(--gap-block-block); padding-top: var(--gap-block-block); opacity: 0; transition: opacity 0.2s; }
.home-facts:empty, #home-glance:empty { display: none; }
.is-pane-open .home-more { height: var(--more-h, auto); }
.is-pane-open .home-more-in { opacity: 1; transition: opacity 0.3s 0.1s; }
.home-description { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; margin: 0; }
@media (max-height: 640px) and (min-width: 761px) { .home-description { display: none; } }
/* The shelf: one long sheet of glass with every row on it. */
.home-shelf { grid-column: 2; grid-row: 2; min-width: 0; margin-bottom: var(--gap-block-block); }
/* The shelf and the pane glide only once the page is ready: as it opens, they're simply put where the measured pane leaves them. */
.is-home-ready .home-shelf { transition: transform 0.45s cubic-bezier(.2,.8,.2,1); }
/* On a wide screen the page opens staged, as a phone does: the game in focus centered over its world, larger, with Play under it, and the
   shelf waiting just below the screen. The first scroll docks the pane into its column and brings the shelf up beside it; back at the
   top, it's staged again. The opening script stages it before the first paint (html[data-home-staged]), so without scripts the page
   simply opens docked. */
/* Staged, the tray under the pane says there's more below: "More games", its arrow drifting down. It takes the page down to the shelf,
   and tucks away as the pane docks. */
.home-cue { display: flex; justify-content: center; }
.home-cue .text-words > svg { order: 2; animation: home-cue-drift 1.6s ease-in-out infinite; }
@keyframes home-cue-drift { 0%, 100% { transform: translateY(-2px); } 50% { transform: translateY(3px); } }
.home-pane .tray { padding-block: var(--gap-words-words); }
.home:not(.is-staged-wide) .home-pane .tray { height: 0; padding-block: 0; border: 0; overflow: hidden; visibility: hidden; }
@media (min-width: 761px) {
  html[data-home-staged] .home-pane { width: var(--stage-w); transform: translateX(calc(50cqw - 50%)); }
  html[data-home-staged] .home-shelf { transform: translateY(calc(var(--home-pane-h, 220px) + var(--stage-gap))); }
}
.home-shelf > .glass-pane { width: 100%; }
/* A row is its heading and its covers, a word's gap apart; rows are a block's gap apart, and nothing else adds room. */
.home-row-head { display: flex; align-items: center; gap: var(--gap-block-block); margin-bottom: var(--gap-words-words); }
.home-row-head h2 { margin: 0; font: var(--type-section); white-space: nowrap; }
/* The row's controls sit at its right end, the sort switch before the arrows. */
.home-row-head > .steps, .home-row-head > .tab-switch { margin-left: auto; }
.home-row-head > .tab-switch + .steps { margin-left: 0; }
/* A row of covers scrolls sideways, fading over a side with more; room round the covers for their lifted shadow. */
.home-track { --fade-sideways-px: 48px; display: flex; gap: var(--gap-block-block); padding: 0 var(--gap-words-words); margin: 0 calc(-1 * var(--gap-words-words)); scroll-padding-inline: var(--gap-words-words); }
.home-track > .cover { flex: 0 0 clamp(200px, 17vw, 260px); }
.home-track > .cover.is-placeholder .cover-art img { object-fit: contain; padding: 14%; background: var(--well); }
.home-all { display: flex; justify-content: center; }
/* A game's background: a layer over Zaisma's own, fading in when it is ready. */
/* Zaisma's own backdrop starts unseen and fades in when it's the first background (or after a few seconds, should the script not run). */
canvas.backdrop { opacity: 0; transition: opacity 500ms ease; animation: home-backdrop-late 0s 4s forwards; }
canvas.backdrop.is-shown { opacity: 1; }
@keyframes home-backdrop-late { to { opacity: 1; } }
.home-world { opacity: 0; object-fit: cover; border: 0; transition-property: opacity; transition-timing-function: ease; }
.home-world.is-shown { opacity: 1; }
/* Play: Zaisma steps aside. The glass slides off to the edges and the game's page opens over the world in place. */
.home-game { position: fixed; inset: 0; z-index: 30; width: 100%; height: 100%; border: 0; background: #000; opacity: 0; visibility: hidden; transition: opacity 0.3s 0.5s, visibility 0s 0.8s; }
.is-game-shown .home-game { opacity: 1; visibility: visible; transition: opacity 0.3s 0.5s, visibility 0s; }
.is-playing { overflow: hidden; }
.is-playing .home-shelf { transform: translateY(110vh); transition: transform 0.5s cubic-bezier(.4,0,.2,1); }
.is-playing .home-pane { transform: translateX(calc(-100% - 40px)); }
.is-playing header.top { transform: translate(-50%, -150%); }
@media (max-width: 1100px) { .home { grid-template-columns: 340px minmax(0, 1fr); } .home-head h1 { font: var(--type-heading); } }
@media (max-width: 760px) {
  .home { display: block; --stage-gap: calc(2 * var(--pad-pane) + env(safe-area-inset-bottom, 0px)); }
  /* The card is as wide as the screen, but on a screen nearly as wide as tall only as wide as leaves about a third of it for the world
     above (its cover grows with it, 9 wide to 5 tall, the rest of it about 110px), centered. */
  .home-pane { position: relative; top: auto; width: min(100%, max(280px, (0.65 * (100svh - var(--header-room)) - 110px) * 1.78)); margin-inline: auto; }
  .is-pane-open.home-pane { margin-top: calc(-1 * var(--more-h, 0px)); }
  .home-description { display: none; }
  .home-row-head > .steps { display: none; }
  /* Continue playing's sort switch takes its own line under the heading, at its own width, instead of running past the pane. */
  .home-row-head { flex-wrap: wrap; row-gap: var(--gap-words-control); }
  .home-row-head > h2 { flex: 1 0 100%; }
  .home-row-head > .tab-switch { margin-left: 0; max-width: 100%; }
  .home-track > .cover { flex-basis: 64vw; }
}
@media (prefers-reduced-motion: reduce) {
  .home-pane, .home-more, .home-more-in, .home-shelf, .home-world, .home-game, canvas.backdrop, .is-playing .home-shelf { transition: none !important; }
  .home-cue .text-words > svg { animation: none; }
}
`);
