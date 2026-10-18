import { accountById, createEntryGrant, gameBySlug, isIdOf, isOldEnoughFor, isTesterLinkOn, issueRoomKey, playsOnline, testerLinkVersion, newId, testerLinkByToken, tradeRoomKey, type Account, type Game } from "@zaisma/core";
import { currentSession } from "./auth.ts";
import { gameUrl, type Env } from "./env.ts";
import { playable } from "./home.ts";
import { pageScript } from "./page-scripts.ts";
import { isRealBrowser } from "./turnstile.ts";

/**
 * Play stats, counted by the game page (docs/DECISIONS.md: developer play stats built in, counted
 * plays are the official numbers). We keep only counts per game per day: no ID, no address, nothing
 * that says who played.
 *
 * A play is counted once Cloudflare's invisible check (Turnstile, run as the game page opens) says a
 * real browser pressed Play and the game has been on screen for a minute. The check's answer works
 * once, and a checked play gets a ticket: a random ID the page reports with, which can't claim time
 * faster than it passes and counts once. Every play started is still counted too, as a smaller "in all" line.
 *
 * The same check lets players into multiplayer (room-count protection): a checked browser in a
 * multiplayer game gets a key, which the page hands to its game to trade for a few player passes.
 * The developer's own plays and tester links get a key too; they just aren't counted.
 *
 *   POST /api/plays/:slug
 *     { first, last, cfirst, clast, token }   a play starts. first/last: the days this browser first
 *          and last played the game; cfirst/clast: the same for counted plays (YYYY-MM-DD, UTC, or
 *          null); token: the check's answer. Answers { ticket } when the play can be counted, and
 *          { key } when the browser was checked and the game is multiplayer.
 *     { tester, token }   a play through a tester link (its token): never counted; answers { key }.
 *     { ticket, counted: true }   a minute on screen: count the play
 *     { ticket, seconds }         time on screen since the last report, up to 10 minutes
 *
 *   POST /api/plays/:slug/entry   { then }: Play on an accounts-only game. Answers { entry_url }, the game
 *          domain's address that swaps a grant for its entry cookie and then opens then (a path and query
 *          inside the game); a guest gets account_needed and an account too young game_not_open_to_player.
 *
 *   POST /api/plays/:slug/account   the player signed in while the game runs (Zaisma.player.signIn, or
 *          "Keep your progress"). Answers { player: { id, name, kind } } for the account; given
 *          { roomKey }, the guest's key, also { key, playerKind } to the account's passes, the guest's key traded.
 */

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** The page reports time at least every 5 minutes, so anything past this isn't real. */
const MAXIMUM_REPORTED_DURATION_SEC = 600;
/** How long after their first play a player coming back is counted. */
const MAXIMUM_RETURN_AFTER_DAYS = 30;
/** On screen this long before a play counts (the page waits 60 seconds; a little leeway for clocks). */
const COUNT_AFTER_MS = 55_000;
/** A ticket is good for this long: a play longer than that stops adding time. */
const TICKET_MS = 6 * 3_600_000;

const today = (nowMs = Date.now()) => new Date(nowMs).toISOString().slice(0, 10);
const ok = (body?: unknown) => (body === undefined ? new Response(null, { status: 204 }) : Response.json(body));

export async function handlePlays(request: Request, env: Env, path: string): Promise<Response | null> {
  const match = path.match(/^\/api\/plays\/([a-z0-9-]+)(\/account|\/entry)?$/);
  if (!match) return null;
  if (request.method !== "POST") return new Response(null, { status: 405 });
  // Only the game page counts plays: another site can't send them from its visitors' browsers.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(env.SITE_ORIGIN).origin) return new Response(null, { status: 403 });
  // By connection address, checked by Cloudflare and never stored.
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  if (env.PLAY_LIMIT && !(await env.PLAY_LIMIT.limit({ key: ip })).success) return new Response(null, { status: 429 });

  const text = await request.text();
  if (text.length > 4096) return new Response(null, { status: 413 });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) ?? {};
  } catch {
    return new Response(null, { status: 400 });
  }
  const game = await gameBySlug(env.DB, match[1]!);
  if (match[2] === "/entry") return handlePlayEntry(request, env, game, body);
  if (match[2]) return signedInWhilePlaying(request, env, game, body);
  if (body.tester !== undefined) return testerPlay(request, env, game, body);
  if (!game || !playable(game)) return new Response(null, { status: 404 });

  if (typeof body.ticket === "string") {
    if (!isIdOf("play_ticket", body.ticket)) return new Response(null, { status: 400 });
    if (body.counted === true) await countTicket(env.DB, game.id, body.ticket, network(request));
    else await addTime(env.DB, game.id, body.ticket, body.seconds);
    return ok();
  }
  // A game that needs an account, or is for older players, starts no play for anyone it doesn't let in.
  const viewer = game.account_requirement === "whole_game" || game.minimum_player_age_years > 13 ? await signedIn(request, env) : null;
  const turnedAway = viewer ? refusal(game, viewer.account) : null;
  if (turnedAway) return withCookies(turnedAway, viewer!.cookies);
  const facts = startFacts(body);
  await countStart(env.DB, game.id, facts);
  if (!(await isRealBrowser(env, body.token, "play"))) return ok();
  const { accountId, cookies } = viewer ?? (await signedIn(request, env));
  // A signed-in player plays as their account in every game, everyone else as a guest.
  const key = playsOnline(game) ? await issueRoomKey(env.DB, game.id, accountId) : undefined;
  // Only plays from a checked browser, and not the developer's own, can be counted.
  const ticket = (await ownGame(env, game, accountId)) ? undefined : await issueTicket(env.DB, game.id, facts);
  const playerKind = accountId ? "account" : "guest";
  return withCookies(ticket || key ? ok({ ...(ticket ? { ticket } : {}), ...(key ? { key, playerKind } : {}) }) : ok(), cookies);
}

/** A play through a tester link: never counted, but a checked browser still gets its key to multiplayer. */
async function testerPlay(request: Request, env: Env, game: Game | null, body: Record<string, unknown>): Promise<Response> {
  const link = typeof body.tester === "string" ? await testerLinkByToken(env.DB, body.tester) : null;
  if (!game || !link || !isTesterLinkOn(link) || link.slug !== game.slug || game.review_status !== "live" || !game.live_version_id) return new Response(null, { status: 404 });
  // Online play only on the version players have, so a test build never reaches live rooms, game servers or data.
  const opens = await testerLinkVersion(env.DB, game, link);
  if (opens?.id !== game.live_version_id) return ok();
  const viewer = game.minimum_player_age_years > 13 ? await signedIn(request, env) : null;
  const turnedAway = viewer ? ageRefusal(game, viewer.account) : null;
  if (turnedAway) return withCookies(turnedAway, viewer!.cookies);
  if (!playsOnline(game) || !(await isRealBrowser(env, body.token, "play"))) return ok();
  const { accountId, cookies } = viewer ?? (await signedIn(request, env));
  return withCookies(ok({ key: await issueRoomKey(env.DB, game.id, accountId), playerKind: accountId ? "account" : "guest" }), cookies);
}

/**
 * Who a game turns away (docs/DECISIONS.md, "Games can keep out younger age bands"): a guest of an
 * accounts-only game, and an account younger than its minimum age. Null when the player may play.
 */
export function refusal(game: Pick<Game, "account_requirement" | "minimum_player_age_years">, account: Pick<Account, "age_band"> | null): Response | null {
  if (!account && game.account_requirement === "whole_game") return refused("account_needed", "This game needs a Zaisma account. Sign in to play.");
  return ageRefusal(game, account);
}

/** A game for older players turns away guests (who have no age) and younger accounts. Tester links follow it too. */
export function ageRefusal(game: Pick<Game, "minimum_player_age_years">, account: Pick<Account, "age_band"> | null): Response | null {
  if (game.minimum_player_age_years <= 13) return null;
  if (!account) return refused("account_needed", "This game needs a Zaisma account. Sign in to play.");
  return isOldEnoughFor(account.age_band, game.minimum_player_age_years) ? null : refused("game_not_open_to_player", "This game isn't open to your account.");
}

const refused = (code: "account_needed" | "game_not_open_to_player", message: string) => Response.json({ error: { code, message } }, { status: 403, headers: { "Cache-Control": "no-store" } });

/**
 * Play on an accounts-only game: the game domain serves its public address only to a browser holding the
 * entry cookie (game-access.ts, "The game entry"), so the page asks here for a grant, after the checks.
 */
async function handlePlayEntry(request: Request, env: Env, game: Game | null, body: Record<string, unknown>): Promise<Response> {
  if (!game || !playable(game) || game.account_requirement !== "whole_game") return new Response(null, { status: 404 });
  const { account, cookies } = await signedIn(request, env);
  const turnedAway = refusal(game, account);
  if (turnedAway) return withCookies(turnedAway, cookies);
  // Where to go inside the game: a path and query, checked again by the games server.
  const then = typeof body.then === "string" && body.then.length <= 2000 ? body.then : "";
  const entryUrl = `${gameUrl(env, game.slug)}_zaisma/enter?grant=${await createEntryGrant(game)}${then ? `&then=${encodeURIComponent(then)}` : ""}`;
  return withCookies(Response.json({ entry_url: entryUrl }, { headers: { "Cache-Control": "no-store" } }), cookies);
}

/**
 * The player signed in while the game runs: who they are now, for the game page to tell its game, and
 * the guest's room key traded for one to the account's passes. The guest's key is the proof that
 * Cloudflare checked this browser, so the trade needs no new check.
 */
async function signedInWhilePlaying(request: Request, env: Env, game: Game | null, body: Record<string, unknown>): Promise<Response> {
  const { account, cookies } = await signedIn(request, env);
  if (!account) return new Response(null, { status: 401 });
  const key = game && body.roomKey !== undefined ? await tradeRoomKey(env.DB, game.id, body.roomKey, account.id) : null;
  return withCookies(ok({ player: { id: account.player_id, name: account.username, kind: "account" }, ...(key ? { key, playerKind: "account" } : {}) }), cookies);
}

interface StartFacts {
  first: string | null;
  last: string | null;
  cfirst: string | null;
  clast: string | null;
}

function startFacts(body: Record<string, unknown>): StartFacts {
  const date = (sentDate: unknown) => (typeof sentDate === "string" && DATE.test(sentDate) && Number.isFinite(Date.parse(sentDate)) ? sentDate : null);
  return { first: date(body.first), last: date(body.last), cfirst: date(body.cfirst), clast: date(body.clast) };
}

/** Every play started, checked or not: the "in all" numbers. */
export async function countStart(database: D1Database, gameId: string, facts: StartFacts, nowMs = Date.now()): Promise<void> {
  const date = today(nowMs);
  const isNew = facts.first === null;
  await database
    .prepare(
      "INSERT INTO play_days (game_id, date, started_play_count, started_player_count, started_new_player_count) VALUES (?, ?, 1, ?, ?) ON CONFLICT (game_id, date) DO UPDATE SET started_play_count = started_play_count + 1, started_player_count = started_player_count + excluded.started_player_count, started_new_player_count = started_new_player_count + excluded.started_new_player_count",
    )
    .bind(gameId, date, isNew || facts.last !== date ? 1 : 0, isNew ? 1 : 0)
    .run();
}

/** A checked play's ticket, with what it will count once it's been on screen for a minute. */
export async function issueTicket(database: D1Database, gameId: string, facts: StartFacts, nowMs = Date.now()): Promise<string> {
  const id = newId("play_ticket");
  const date = today(nowMs);
  await database
    .prepare("INSERT INTO play_tickets (id, game_id, issued_at_ms, date, is_first_play_today, is_new_player, first_play_date) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, gameId, nowMs, date, facts.clast !== date ? 1 : 0, facts.cfirst === null ? 1 : 0, facts.cfirst)
    .run();
  return id;
}

/** A minute on screen: count the play, once, with the time it has so far. */
export async function countTicket(database: D1Database, gameId: string, id: string, autonomousSystemNumber: number, nowMs = Date.now()): Promise<boolean> {
  const ticket = await database
    .prepare("UPDATE play_tickets SET counted_at_ms = ? WHERE id = ? AND game_id = ? AND counted_at_ms IS NULL AND issued_at_ms <= ? AND issued_at_ms > ? RETURNING *")
    .bind(nowMs, id, gameId, nowMs - COUNT_AFTER_MS, nowMs - TICKET_MS)
    .first<{ date: string; is_first_play_today: number; is_new_player: number; first_play_date: string | null; play_duration_sec: number }>();
  if (!ticket) return false;
  const writes = [
    database
      .prepare(
        "INSERT INTO play_days (game_id, date, play_count, player_count, new_player_count, play_duration_sec) VALUES (?, ?, 1, ?, ?, ?) ON CONFLICT (game_id, date) DO UPDATE SET play_count = play_count + 1, player_count = player_count + excluded.player_count, new_player_count = new_player_count + excluded.new_player_count, play_duration_sec = play_duration_sec + excluded.play_duration_sec",
      )
      .bind(gameId, ticket.date, ticket.is_first_play_today, ticket.is_new_player, ticket.play_duration_sec),
  ];
  if (ticket.is_first_play_today) {
    writes.push(
      database
        .prepare("INSERT INTO play_networks (game_id, date, autonomous_system_number, player_count) VALUES (?, ?, ?, 1) ON CONFLICT (game_id, date, autonomous_system_number) DO UPDATE SET player_count = player_count + 1")
        .bind(gameId, ticket.date, autonomousSystemNumber),
    );
  }
  // Back for the first time today: count it against the day they first played.
  const afterDays = ticket.first_play_date ? Math.round((Date.parse(ticket.date) - Date.parse(ticket.first_play_date)) / DAY_MS) : 0;
  if (!ticket.is_new_player && ticket.is_first_play_today && afterDays >= 1 && afterDays <= MAXIMUM_RETURN_AFTER_DAYS) {
    writes.push(
      database
        .prepare("INSERT INTO play_returns (game_id, first_play_date, after_days, player_count) VALUES (?, ?, ?, 1) ON CONFLICT (game_id, first_play_date, after_days) DO UPDATE SET player_count = player_count + 1")
        .bind(gameId, ticket.first_play_date, afterDays),
    );
  }
  await database.batch(writes);
  return true;
}

/** Time on screen, never more than has passed since the ticket was issued. */
export async function addTime(database: D1Database, gameId: string, id: string, reportedDurationSec: unknown, nowMs = Date.now()): Promise<void> {
  const durationSec = Math.min(Math.round(Number(reportedDurationSec)), MAXIMUM_REPORTED_DURATION_SEC);
  if (!Number.isFinite(durationSec) || durationSec < 1) return;
  const ticket = await database
    .prepare("UPDATE play_tickets SET play_duration_sec = play_duration_sec + ?1 WHERE id = ?2 AND game_id = ?3 AND issued_at_ms > ?4 AND (play_duration_sec + ?1) * 1000 <= ?5 - issued_at_ms + 10000 RETURNING counted_at_ms")
    .bind(durationSec, id, gameId, nowMs - TICKET_MS, nowMs)
    .first<{ counted_at_ms: number | null }>();
  // Time before the play counted is added when it counts.
  if (ticket?.counted_at_ms) {
    await database
      .prepare("INSERT INTO play_days (game_id, date, play_duration_sec) VALUES (?, ?, ?) ON CONFLICT (game_id, date) DO UPDATE SET play_duration_sec = play_duration_sec + excluded.play_duration_sec")
      .bind(gameId, today(nowMs), durationSec)
      .run();
  }
}

/**
 * The signed-in player's account (null for a guest), with the cookies of a session it refreshed: a game
 * page can sit open longer than a sign-in lasts before the player presses Play.
 */
async function signedIn(request: Request, env: Env): Promise<{ account: Account | null; accountId: string | null; cookies: string[] }> {
  const session = await currentSession(request, env).catch(() => null);
  // Signed in but the account isn't finished (no name or age yet): a guest until it is.
  const account = session ? await accountById(env.DB, session.userId) : null;
  return { account, accountId: account?.id ?? null, cookies: session?.cookies ?? [] };
}

function withCookies(response: Response, cookies: string[]): Response {
  for (const cookie of cookies) response.headers.append("Set-Cookie", cookie);
  return response;
}

/** The developer playing their own game, signed in. */
async function ownGame(env: Env, game: Game, accountId: string | null): Promise<boolean> {
  if (!game.owner_id || !accountId) return false;
  return Boolean(await env.DB.prepare("SELECT 1 FROM owners WHERE id = ? AND account_id = ?").bind(game.owner_id, accountId).first());
}

/** The internet provider's network number (ASN) of the connection, or 0 when unknown. */
function network(request: Request): number {
  const autonomousSystemNumber = Number((request as { cf?: { asn?: unknown } }).cf?.asn);
  return Number.isInteger(autonomousSystemNumber) && autonomousSystemNumber > 0 ? autonomousSystemNumber : 0;
}

/**
 * Cloud and hosting networks, where bots usually run and few players do (people on a VPN can land
 * here too). Their players count for developers' stats but not for the shelves.
 */
export const HOSTING_NETWORKS = new Set([
  16509, 14618, 8987, // Amazon
  15169, 396982, 19527, // Google
  8075, 8068, // Microsoft
  14061, // DigitalOcean
  16276, // OVH
  24940, 213230, // Hetzner
  63949, // Linode (Akamai)
  20473, // Vultr
  31898, // Oracle
  45102, 37963, // Alibaba
  132203, 45090, // Tencent
  51167, // Contabo
  12876, // Scaleway
  60781, 16265, 28753, // Leaseweb
  36352, // ColoCrossing
  9009, // M247
  212238, 60068, // Datacamp, CDN77
  13335, // Cloudflare
]);

/**
 * Players a game's day counts for on the shelves: counted players, without hosting networks, and
 * no one network carrying more than 30% of them (or 10, for small games).
 */
export function shelfPlayers(networks: { autonomous_system_number: number; player_count: number }[]): number {
  // The share is of players on other networks, so bots on cloud servers can't raise it.
  const homes = networks.filter((network) => network.autonomous_system_number !== 0 && !HOSTING_NETWORKS.has(network.autonomous_system_number));
  const maximumNetworkPlayerCount = Math.max(10, Math.ceil(homes.reduce((totalPlayerCount, network) => totalPlayerCount + network.player_count, 0) * 0.3));
  return homes.reduce((totalPlayerCount, network) => totalPlayerCount + Math.min(network.player_count, maximumNetworkPlayerCount), 0);
}

/** The developer API's play_stats (PLAY_STATS in schemas.ts), passed through as it is. */
export interface PlayStats {
  days: { date: string; play_count: number; player_count: number; new_player_count: number; play_duration_min: number; started_play_count: number }[];
  /** Counted plays: the official number. */
  play_count: number;
  /** Every play started, counted or not. */
  started_play_count: number;
  new_player_count: number;
  play_duration_min: number;
  /** Average time on screen per counted play, in minutes, or null before any. */
  average_play_duration_min: number | null;
  /**
   * Of the players whose first counted play was in the 30 days before, how many came back 1, 7 and
   * 30 days later. Only days that are over count, so a new game shows null (returned_pct) for a while.
   */
  came_back: Record<"after_1_day" | "after_7_days" | "after_30_days", { returned_pct: number | null; returned_player_count: number; new_player_count: number }>;
}

/** A game's play stats for the last `periodDurationDays` days (including today). */
export async function playStats(database: D1Database, gameId: string, periodDurationDays: number, nowMs = Date.now()): Promise<PlayStats> {
  const from = today(nowMs - (periodDurationDays - 1) * DAY_MS);
  // Coming back after 30 days looks at players who first played up to 60 days ago.
  const oldest = today(nowMs - (MAXIMUM_RETURN_AFTER_DAYS + 30) * DAY_MS);
  const [{ results: rows }, { results: returns }] = await Promise.all([
    database
      .prepare("SELECT date, started_play_count, play_count, player_count, new_player_count, play_duration_sec FROM play_days WHERE game_id = ? AND date >= ? ORDER BY date")
      .bind(gameId, from < oldest ? from : oldest)
      .all<{ date: string; started_play_count: number; play_count: number; player_count: number; new_player_count: number; play_duration_sec: number }>(),
    database
      .prepare("SELECT first_play_date, after_days, player_count FROM play_returns WHERE game_id = ? AND first_play_date >= ? AND after_days IN (1, 7, 30)")
      .bind(gameId, oldest)
      .all<{ first_play_date: string; after_days: number; player_count: number }>(),
  ]);
  const shown = rows.filter((row) => row.date >= from);
  const playCount = shown.reduce((totalPlayCount, row) => totalPlayCount + row.play_count, 0);
  const playDurationSec = shown.reduce((totalDurationSec, row) => totalDurationSec + row.play_duration_sec, 0);
  const newPlayerCountByDate = new Map(rows.map((row) => [row.date, row.new_player_count]));
  const cameBack = (afterDays: number) => {
    // Players who first played on a day in the 30 before the last day that's over, `afterDays` days on.
    const firstPlayDates = Array.from({ length: 30 }, (_, i) => today(nowMs - (afterDays + 1 + i) * DAY_MS));
    const newPlayerCount = firstPlayDates.reduce((totalPlayerCount, date) => totalPlayerCount + (newPlayerCountByDate.get(date) ?? 0), 0);
    const set = new Set(firstPlayDates);
    const returnedPlayerCount = returns.filter((row) => row.after_days === afterDays && set.has(row.first_play_date)).reduce((totalPlayerCount, row) => totalPlayerCount + row.player_count, 0);
    return { returned_pct: newPlayerCount ? Math.round((returnedPlayerCount / newPlayerCount) * 100) : null, returned_player_count: returnedPlayerCount, new_player_count: newPlayerCount };
  };
  return {
    days: shown.map((row) => ({ date: row.date, play_count: row.play_count, player_count: row.player_count, new_player_count: row.new_player_count, play_duration_min: Math.round(row.play_duration_sec / 60), started_play_count: row.started_play_count })),
    play_count: playCount,
    started_play_count: shown.reduce((totalPlayCount, row) => totalPlayCount + row.started_play_count, 0),
    new_player_count: shown.reduce((totalPlayerCount, row) => totalPlayerCount + row.new_player_count, 0),
    play_duration_min: Math.round(playDurationSec / 60),
    average_play_duration_min: playCount ? Math.round((playDurationSec / 60 / playCount) * 10) / 10 : null,
    came_back: { after_1_day: cameBack(1), after_7_days: cameBack(7), after_30_days: cameBack(30) },
  };
}

/**
 * The game page's part. As the page opens it asks Cloudflare's invisible check about this browser, so
 * Play doesn't wait for it; on Play it reports the start with the check's answer. A checked play gets
 * a ticket, and in a multiplayer game a key for the game's passes. After a minute on screen it asks for the play to count,
 * and reports time on screen when the page is hidden and every 5 minutes. Which games this browser
 * played, and when it first and last did, stay in this browser (zaisma:plays). It reads the game page's
 * gamePage (pages.ts), whose script comes first.
 */
export const PLAY_COUNTER_SCRIPT = pageScript("play-counter", `// The key to player passes the check gives a checked browser in a multiplayer game, for the game to ask for (zaisma:room-key),
// and whose passes it gives: the signed-in account's, or a guest's. A guest who signs in while playing gets the account's instead.
let gotKey;
let roomKey =new Promise((done) => (gotKey = (r) => done(r && r.key ? { key: r.key, playerKind: r.playerKind } : null)));
const countPlay = (() => {
const api = "/api/plays/" + gamePage.slug, KEY = "zaisma:plays", SLUG = gamePage.slug, SITE_KEY = gamePage.turnstile_site_key, TESTER = gamePage.tester_token || "";
const post = (body) => fetch(api, { method: "POST", body: JSON.stringify(body), keepalive: true }).then((r) => (r.status === 200 ? r.json() : null)).catch(() => null);
const beacon = (body) => { const data = JSON.stringify(body); if (!(navigator.sendBeacon && navigator.sendBeacon(api, data))) post(body); };
const day = () => new Date().toISOString().slice(0, 10);
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { return {}; } };
const save = (mine) => {
  const all = load();
  all[SLUG] = mine;
  // The 200 games played most recently.
  const keep = Object.entries(all).sort((a, b) => (b[1].last || "").localeCompare(a[1].last || "")).slice(0, 200);
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(keep))); } catch {}
};
// Cloudflare's invisible check starts as the page opens, so its answer is ready by the time the player
// taps Play. Each answer works once and lasts 5 minutes; Cloudflare renews it while the page stays open.
let answer = null, answeredAt = 0, widget = null, broken = !SITE_KEY;
const waiting = [];
const settle = () => waiting.splice(0).forEach((w) => w());
const answered = (t) => { answer = t || null; answeredAt = Date.now(); settle(); };
if (SITE_KEY) {
  const go = () => {
    try {
      widget = turnstile.render(document.getElementById("play-check"), { sitekey: SITE_KEY, action: "play", appearance: "interaction-only", "refresh-expired": "auto", callback: answered, "expired-callback": () => (answer = null), "error-callback": settle, "timeout-callback": settle });
    } catch { broken = true; settle(); }
  };
  if (window.turnstile) go();
  else {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = go;
    s.onerror = () => { broken = true; settle(); };
    document.head.appendChild(s);
  }
}
// The check's answer for this play, or null if it can't give one (the play still runs, it just isn't counted).
const check = () => new Promise((done) => {
  const take = () => { const t = answer; answer = null; done(t); };
  if (answer && Date.now() - answeredAt < 240000) return take();
  if (broken) return done(null);
  // An answer about to run out: ask for a fresh one.
  if (answer && widget !== null) { answer = null; try { turnstile.reset(widget); } catch {} }
  const timer = setTimeout(() => done(null), 20000);
  waiting.push(() => { clearTimeout(timer); answer ? take() : done(null); });
});
let ticket = null, shown = 0, since = 0, sent = 0, counted = false;
const onScreen = () => shown + (since ? Date.now() - since : 0);
const flush = () => {
  if (since) { shown += Date.now() - since; since = document.hidden ? 0 : Date.now(); }
  if (!ticket) return;
  const seconds = Math.floor((shown - sent) / 1000);
  if (seconds >= 1) { beacon({ ticket, seconds }); sent += seconds * 1000; }
};
const tick = () => {
  if (ticket && !counted && onScreen() >= 60000) {
    counted = true;
    flush();
    post({ ticket, counted: true }).then(() => { const mine = load()[SLUG] || {}; save({ ...mine, cfirst: mine.cfirst || day(), clast: day() }); });
  }
  if (onScreen() - sent >= 300000) flush();
};
return () => {
  // A tester link's play is never counted: the check is only for multiplayer.
  if (TESTER) return check().then((token) => post({ tester: TESTER, token })).then(gotKey);
  const mine = load()[SLUG] || {};
  const start = { first: mine.first || null, last: mine.last || null, cfirst: mine.cfirst || null, clast: mine.clast || null };
  save({ ...mine, first: mine.first || day(), last: day() });
  since = document.hidden ? 0 : Date.now();
  document.addEventListener("visibilitychange", () => { if (document.hidden) flush(); else since = Date.now(); });
  addEventListener("pagehide", flush);
  setInterval(tick, 5000);
  check().then((token) => post({ ...start, token })).then((r) => { if (r && r.ticket) ticket = r.ticket; gotKey(r); });
};
})();`);

export interface PlaySpike {
  game_id: string;
  title: string;
  is_off_shelves: number;
  date: string;
  player_count: number;
  /** Counted players a day in the week before, on average. */
  usual_players_per_day: number;
  network_count: number;
  /** Share of the day's players from its biggest network, and from cloud networks, in percent. */
  biggest_network_pct: number;
  hosting_network_pct: number;
}

/**
 * Days, today or yesterday, when a game had far more counted players than usual (5 times its average
 * over the week before, and at least 30), with how spread out they were: for admin to check.
 */
export async function playSpikes(database: D1Database, nowMs = Date.now()): Promise<PlaySpike[]> {
  const { results } = await database
    .prepare("SELECT play_days.game_id, games.title, games.is_off_shelves, play_days.date, play_days.player_count FROM play_days JOIN games ON games.id = play_days.game_id WHERE play_days.date >= ?")
    .bind(today(nowMs - 8 * DAY_MS))
    .all<{ game_id: string; title: string; is_off_shelves: number; date: string; player_count: number }>();
  const spikes: PlaySpike[] = [];
  for (const date of [today(nowMs), today(nowMs - DAY_MS)]) {
    for (const row of results.filter((day) => day.date === date && day.player_count >= 30)) {
      const week = Array.from({ length: 7 }, (_, i) => today(Date.parse(date) - (i + 1) * DAY_MS));
      const usualPlayersPerDay = results.filter((day) => day.game_id === row.game_id && week.includes(day.date)).reduce((totalPlayerCount, day) => totalPlayerCount + day.player_count, 0) / 7;
      if (row.player_count < usualPlayersPerDay * 5) continue;
      const { results: networks } = await database.prepare("SELECT autonomous_system_number, player_count FROM play_networks WHERE game_id = ? AND date = ?").bind(row.game_id, date).all<{ autonomous_system_number: number; player_count: number }>();
      const totalPlayerCount = networks.reduce((playerCount, network) => playerCount + network.player_count, 0) || 1;
      spikes.push({
        game_id: row.game_id,
        title: row.title,
        is_off_shelves: row.is_off_shelves,
        date,
        player_count: row.player_count,
        usual_players_per_day: Math.round(usualPlayersPerDay * 10) / 10,
        network_count: networks.length,
        biggest_network_pct: Math.round((Math.max(0, ...networks.map((network) => network.player_count)) / totalPlayerCount) * 100),
        hosting_network_pct: Math.round((networks.filter((network) => HOSTING_NETWORKS.has(network.autonomous_system_number)).reduce((playerCount, network) => playerCount + network.player_count, 0) / totalPlayerCount) * 100),
      });
    }
  }
  return spikes;
}

/** Take a day's counted plays away from a game (they looked faked). Every play started stays. */
export async function clearCountedDay(database: D1Database, gameId: string, date: string): Promise<void> {
  await database.batch([
    database.prepare("UPDATE play_days SET play_count = 0, player_count = 0, new_player_count = 0, play_duration_sec = 0 WHERE game_id = ? AND date = ?").bind(gameId, date),
    database.prepare("DELETE FROM play_networks WHERE game_id = ? AND date = ?").bind(gameId, date),
  ]);
}
