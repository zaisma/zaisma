import {
  CRASH_KINDS,
  FRAME_RATE_BUCKETS,
  LOADING_BUCKETS_SEC,
  MEMORY_BUCKETS_BYTES,
  PLAYER_PERFORMANCE_LIMITS,
  browserOf,
  bucketOf,
  countsWithin,
  osOf,
  playerPerformanceRow,
  readPlayPerformanceReport,
  type PerformanceDay,
  type PlayerPerformanceRow,
} from "@zaisma/core";
import { accountById, createEntryGrant, fullGameOwner, gameBySlug, isIdOf, isOldEnoughFor, isTesterLinkOn, issueRoomKey, playsOnline, recordReturningPlay, testerLinkVersion, newId, testerLinkByToken, tradeRoomKey, type Account, type Game } from "@zaisma/core";
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
 *     { ticket, seconds, is_away } time on screen since the last report, up to 10 minutes; is_away: true
 *          when the tab was hidden. A ticket whose last report is under 6 minutes old and not away is "playing now".
 *          With performance, how the game ran since the last report (addPerformance), unless the developer turned measuring off.
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
/** A playing page reports at least every 5 minutes, so a ticket that reported within this long is "playing now". */
export const PLAYING_NOW_WINDOW_MS = 6 * 60_000;
/** Fewest players for "playing now" to show on public pages, so a new game never looks empty. */
export const MINIMUM_PLAYING_NOW_PLAYER_COUNT = 3;

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
  if (!game || !(playable(game) || isKeptForOwners(game))) return new Response(null, { status: 404 });

  if (typeof body.ticket === "string") {
    if (!isIdOf("play_ticket", body.ticket)) return new Response(null, { status: 400 });
    if (body.counted === true) {
      // A signed-in player's counted play counts toward the developer's standing (standing.ts); a guest is a browser that costs a bot nothing.
      if (await countTicket(env.DB, game.id, body.ticket, network(request))) {
        const { accountId, cookies } = await signedIn(request, env);
        if (accountId && !(await ownGame(env, game, accountId))) await recordReturningPlay(env.DB, game.id, accountId, today());
        return withCookies(ok(), cookies);
      }
    } else {
      await addTime(env.DB, game.id, body.ticket, body.seconds);
      await reportPlaying(env.DB, game.id, body.ticket, body.is_away === true);
      if (body.performance !== undefined && game.performance_measuring_enabled) await addPerformance(env.DB, game, body.ticket, body.performance, request.headers.get("user-agent") ?? "");
    }
    return ok();
  }
  // A game that needs an account, or is for older players, starts no play for anyone it doesn't let in.
  const viewer = game.account_requirement === "whole_game" || game.minimum_player_age_years > 13 ? await signedIn(request, env) : null;
  const isOwner = await fullGameOwner(env.DB, game, viewer?.account ?? null);
  // A paid game the developer hid is still there for the players who bought it, and for nobody else.
  if (!playable(game) && !isOwner) return withCookies(new Response(null, { status: 404 }), viewer?.cookies ?? []);
  const turnedAway = viewer ? refusal(game, viewer.account, isOwner) : null;
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
 * Who a game turns away (docs/DECISIONS.md, "Games can keep out younger age bands", "How paid games work"): a guest of an
 * accounts-only game, an account younger than its minimum age, and an account that doesn't own a paid game (isOwner, from
 * fullGameOwner). Null when the player may play.
 */
export function refusal(game: Pick<Game, "account_requirement" | "minimum_player_age_years" | "full_game_item_name" | "title">, account: Pick<Account, "age_band"> | null, isOwner: boolean): Response | null {
  if (!account && game.account_requirement === "whole_game") return refused("account_needed", "This game needs a Zaisma account. Sign in to play.");
  const tooYoung = ageRefusal(game, account);
  if (tooYoung) return tooYoung;
  return game.full_game_item_name !== null && !isOwner ? refused("full_game_not_owned", `Buy ${game.title} to play.`) : null;
}

/** A paid game the developer made private or a draft, still live: bought means kept, so it plays on for its owners (fullGameOwner). */
export function isKeptForOwners(game: Game): boolean {
  return game.full_game_item_name !== null && game.review_status === "live" && Boolean(game.live_version_id) && (game.visibility === "draft" || game.visibility === "private");
}

/** A game for older players turns away guests (who have no age) and younger accounts. Tester links follow it too. */
export function ageRefusal(game: Pick<Game, "minimum_player_age_years">, account: Pick<Account, "age_band"> | null): Response | null {
  if (game.minimum_player_age_years <= 13) return null;
  if (!account) return refused("account_needed", "This game needs a Zaisma account. Sign in to play.");
  return isOldEnoughFor(account.age_band, game.minimum_player_age_years) ? null : refused("game_not_open_to_player", "This game isn't open to your account.");
}

const refused = (code: "account_needed" | "game_not_open_to_player" | "full_game_not_owned", message: string) => Response.json({ error: { code, message } }, { status: 403, headers: { "Cache-Control": "no-store" } });

/**
 * Play on an accounts-only game: the game domain serves its public address only to a browser holding the
 * entry cookie (game-access.ts, "The game entry"), so the page asks here for a grant, after the checks.
 */
async function handlePlayEntry(request: Request, env: Env, game: Game | null, body: Record<string, unknown>): Promise<Response> {
  if (!game || !(playable(game) || isKeptForOwners(game)) || game.account_requirement !== "whole_game") return new Response(null, { status: 404 });
  const { account, cookies } = await signedIn(request, env);
  // Every paid game is accounts-only (settlePaidGame), so its entry, the only way to its files, reaches only its owners.
  const isOwner = await fullGameOwner(env.DB, game, account);
  if (!playable(game) && !isOwner) return withCookies(new Response(null, { status: 404 }), cookies);
  const turnedAway = refusal(game, account, isOwner);
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
  // A paid game's rooms take only its owners, so an account that doesn't own it gets no key.
  const key = game && body.roomKey !== undefined && (await fullGameOwner(env.DB, game, account)) ? await tradeRoomKey(env.DB, game.id, body.roomKey, account.id) : null;
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
    .prepare("INSERT INTO play_tickets (id, game_id, issued_at_ms, reported_at_ms, date, is_first_play_today, is_new_player, first_play_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, gameId, nowMs, nowMs, date, facts.clast !== date ? 1 : 0, facts.cfirst === null ? 1 : 0, facts.cfirst)
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

/** The page is still open and playing (or hidden, with isAway): what "playing now" counts. */
export async function reportPlaying(database: D1Database, gameId: string, id: string, isAway: boolean, nowMs = Date.now()): Promise<void> {
  await database
    .prepare("UPDATE play_tickets SET reported_at_ms = ?1, away_at_ms = CASE WHEN ?2 THEN ?1 ELSE NULL END WHERE id = ?3 AND game_id = ?4 AND issued_at_ms > ?5")
    .bind(nowMs, isAway ? 1 : 0, id, gameId, nowMs - TICKET_MS)
    .run();
}

/**
 * Players on screen right now in each game, from the tickets of checked plays: guests included, nothing
 * personal. The developer's own plays and unchecked browsers have no ticket, so they never count. The same
 * for everyone, cached for a short while so a page of games costs one read.
 */
export async function playingNowCounts(env: Env, nowMs = Date.now()): Promise<Map<string, number>> {
  const cacheDurationSec = Number(env.PLAYING_NOW_CACHE_SECONDS ?? 30);
  const cache = cacheDurationSec > 0 ? (caches as unknown as { default: Cache }).default : null;
  const key = new Request("https://playing-now.zaisma.internal/v1");
  const hit = await cache?.match(key);
  if (hit) return new Map(Object.entries((await hit.json()) as Record<string, number>));
  const { results } = await env.DB
    .prepare("SELECT game_id, COUNT(*) AS player_count FROM play_tickets WHERE reported_at_ms > ? AND away_at_ms IS NULL GROUP BY game_id")
    .bind(nowMs - PLAYING_NOW_WINDOW_MS)
    .all<{ game_id: string; player_count: number }>();
  const counts = new Map(results.map((row) => [row.game_id, row.player_count]));
  await cache?.put(key, Response.json(Object.fromEntries(counts), { headers: { "Cache-Control": `max-age=${cacheDurationSec}` } }));
  return counts;
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
 * How the game ran in a play since its last report (docs/DECISIONS.md, "How a game runs for its players is the
 * developer's, as totals"), added to the day's totals for its version and device group. Only with a ticket of
 * this game, so only from a browser Cloudflare checked, never a tester link or the developer's own play. The
 * browser and system are read here from the request's User-Agent, which isn't kept. The server keeps the
 * backstop: every value is clamped, a ticket counts its play, load time and memory once (its first report)
 * and a crash once, and it can't claim more measured time than it has been open.
 */
export async function addPerformance(database: D1Database, game: Pick<Game, "id" | "live_version_id">, ticketId: string, sent: unknown, userAgent: string, nowMs = Date.now()): Promise<boolean> {
  const report = readPlayPerformanceReport(sent);
  if (!report || !game.live_version_id) return false;
  const ticket = await database
    .prepare("SELECT issued_at_ms, has_performance_loading, has_performance_crash, measured_duration_sec FROM play_tickets WHERE id = ? AND game_id = ? AND issued_at_ms > ?")
    .bind(ticketId, game.id, nowMs - TICKET_MS)
    .first<{ issued_at_ms: number; has_performance_loading: number; has_performance_crash: number; measured_duration_sec: number }>();
  if (!ticket) return false;
  // A little leeway for clocks, as addTime has.
  const openDurationSec = (nowMs - ticket.issued_at_ms) / 1000 + 10;
  const isFirstReport = !ticket.has_performance_loading;
  const crashKind = ticket.has_performance_crash ? null : report.crash_kind;
  const measuredDurationSec = Math.max(0, Math.min(report.measured_duration_sec, Math.floor(openDurationSec - ticket.measured_duration_sec)));
  // A long frame is 50 ms or more, so there can't be more than 20 a second.
  const longFrameCount = Math.min(report.long_frame_count, measuredDurationSec * 20);
  if (!isFirstReport && !crashKind && !measuredDurationSec) return false;
  // Taken from the ticket first, so the same report sent twice at once counts once.
  const taken = await database
    .prepare(
      "UPDATE play_tickets SET has_performance_loading = 1, has_performance_crash = ?1, measured_duration_sec = measured_duration_sec + ?2 WHERE id = ?3 AND has_performance_loading = ?4 AND has_performance_crash = ?5 AND measured_duration_sec = ?6",
    )
    .bind(ticket.has_performance_crash || crashKind ? 1 : 0, measuredDurationSec, ticketId, ticket.has_performance_loading, ticket.has_performance_crash, ticket.measured_duration_sec)
    .run();
  if (!taken.meta.changes) return false;
  // The version the frame ran: the live one, or one published earlier that a room still plays.
  const versionId =
    report.version_id && report.version_id !== game.live_version_id && (await database.prepare("SELECT 1 FROM versions WHERE id = ? AND game_id = ? AND published_at_ms IS NOT NULL").bind(report.version_id, game.id).first())
      ? report.version_id
      : game.live_version_id;
  const loadingCounts = LOADING_BUCKETS_SEC.map(() => 0).concat(0);
  if (isFirstReport && report.loading_duration_sec !== null) loadingCounts[bucketOf(LOADING_BUCKETS_SEC, Math.min(report.loading_duration_sec, openDurationSec))]! += 1;
  const memoryCounts = MEMORY_BUCKETS_BYTES.map(() => 0).concat(0);
  if (isFirstReport && report.peak_memory_size_bytes > 0) memoryCounts[bucketOf(MEMORY_BUCKETS_BYTES, report.peak_memory_size_bytes)]! += 1;
  const crashCounts = CRASH_KINDS.map((kind) => (kind === crashKind ? 1 : 0));
  await database
    .prepare(
      `INSERT INTO performance_days (game_id, date, version_id, browser_name, os_name, device_kind, graphics_family, play_count, loading_counts, frame_rate_seconds, long_frame_count, measured_duration_sec, error_stop_count, context_lost_count, stopped_responding_count, memory_counts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (game_id, date, version_id, browser_name, os_name, device_kind, graphics_family) DO UPDATE SET
         play_count = play_count + excluded.play_count, ${addedCounts("loading_counts", loadingCounts.length)}, ${addedCounts("frame_rate_seconds", FRAME_RATE_BUCKETS.length + 1)},
         long_frame_count = long_frame_count + excluded.long_frame_count, measured_duration_sec = measured_duration_sec + excluded.measured_duration_sec,
         error_stop_count = error_stop_count + excluded.error_stop_count, context_lost_count = context_lost_count + excluded.context_lost_count,
         stopped_responding_count = stopped_responding_count + excluded.stopped_responding_count, ${addedCounts("memory_counts", memoryCounts.length)}`,
    )
    .bind(
      game.id,
      today(nowMs),
      versionId,
      browserOf(userAgent),
      osOf(userAgent),
      report.device_kind,
      report.graphics_family,
      isFirstReport ? 1 : 0,
      JSON.stringify(loadingCounts),
      JSON.stringify(countsWithin(report.frame_rate_seconds, measuredDurationSec)),
      longFrameCount,
      measuredDurationSec,
      ...crashCounts,
      JSON.stringify(memoryCounts),
    )
    .run();
  return true;
}

/** A JSON array of counts added to the new row's, bucket by bucket, in one statement, so reports at once never lose counts. */
const addedCounts = (column: string, bucketCount: number) =>
  `${column} = json_array(${Array.from({ length: bucketCount }, (_, i) => `COALESCE(json_extract(${column}, '$[${i}]'), 0) + COALESCE(json_extract(excluded.${column}, '$[${i}]'), 0)`).join(", ")})`;

/** The developer API's performance (PLAYER_PERFORMANCE in schemas.ts). */
export interface PlayerPerformance {
  version_totals: ({ version_id: string } & PlayerPerformanceRow)[];
  device_totals: ({ version_id: string; browser_name: string; os_name: string; device_kind: string; graphics_family: string } & PlayerPerformanceRow)[];
}

/**
 * How a game ran for its players over the last `periodDurationDays` days: each version, then the newest version by
 * device group, with groups under 20 plays folded into one other row.
 */
export async function playerPerformance(database: D1Database, gameId: string, periodDurationDays: number, nowMs = Date.now()): Promise<PlayerPerformance> {
  const { results } = await database
    .prepare(
      "SELECT performance_days.*, versions.created_at_ms AS version_created_at_ms FROM performance_days LEFT JOIN versions ON versions.id = performance_days.version_id WHERE performance_days.game_id = ? AND performance_days.date >= ?",
    )
    .bind(gameId, today(nowMs - (periodDurationDays - 1) * DAY_MS))
    .all<Record<string, unknown> & { version_created_at_ms: number | null }>();
  const readCounts = (text: unknown) => {
    try {
      const counts = JSON.parse(String(text));
      return Array.isArray(counts) ? counts.map((bucketCount) => Number(bucketCount) || 0) : [];
    } catch {
      return [];
    }
  };
  const days = results.map((row) => ({
    ...(row as unknown as PerformanceDay),
    loading_counts: readCounts(row.loading_counts),
    frame_rate_seconds: readCounts(row.frame_rate_seconds),
    memory_counts: readCounts(row.memory_counts),
    versionCreatedAtMs: row.version_created_at_ms ?? 0,
  }));
  const versionIds = [...new Set(days.sort((first, second) => second.versionCreatedAtMs - first.versionCreatedAtMs).map((day) => day.version_id))];
  const newestDays = days.filter((day) => day.version_id === versionIds[0]);
  const groups = new Map<string, typeof newestDays>();
  for (const day of newestDays) {
    const key = [day.browser_name, day.os_name, day.device_kind, day.graphics_family].join(" ");
    groups.set(key, [...(groups.get(key) ?? []), day]);
  }
  const byDevice: PlayerPerformance["device_totals"] = [];
  const foldedDays: PerformanceDay[] = [];
  for (const groupDays of groups.values()) {
    const row = playerPerformanceRow(groupDays);
    if (row.play_count < PLAYER_PERFORMANCE_LIMITS.minimumGroupPlayCount) foldedDays.push(...groupDays);
    else byDevice.push({ version_id: versionIds[0]!, browser_name: groupDays[0]!.browser_name, os_name: groupDays[0]!.os_name, device_kind: groupDays[0]!.device_kind, graphics_family: groupDays[0]!.graphics_family, ...row });
  }
  byDevice.sort((first, second) => second.play_count - first.play_count);
  if (foldedDays.length) byDevice.push({ version_id: versionIds[0]!, browser_name: "other", os_name: "other", device_kind: "other", graphics_family: "other", ...playerPerformanceRow(foldedDays) });
  return {
    version_totals: versionIds.map((versionId) => ({ version_id: versionId, ...playerPerformanceRow(days.filter((day) => day.version_id === versionId)) })),
    device_totals: byDevice,
  };
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
// How the game runs, from the game frame's _zaisma/performance.js: added up here and sent with the time reports, so it rides
// the checked ticket. Only once the frame says it's settled (it drew, crashed or gave up waiting), so the first report has the load time.
const newMeasured = () => ({ device_kind: mine, version_id: null, graphics_family: null, loading_duration_sec: null, frame_rate_seconds: [], long_frame_count: 0, measured_duration_sec: 0, crash_kind_counts: {}, peak_memory_size_bytes: 0 });
let measured = null, isSettled = false, aliveAt = 0, hasStoppedResponding = false;
const amount = (v) => (typeof v === "number" && isFinite(v) && v > 0 ? v : 0);
addEventListener("message", (e) => {
  if (!frame || e.origin !== gameOrigin || e.source !== frame.contentWindow || !e.data) return;
  const d = e.data;
  if (d.type === "zaisma:alive") aliveAt = Date.now();
  if (d.type !== "zaisma:performance") return;
  aliveAt = Date.now();
  measured = measured || newMeasured();
  if (typeof d.version_id === "string") measured.version_id = d.version_id;
  if (typeof d.graphics_family === "string") measured.graphics_family = d.graphics_family;
  if (measured.loading_duration_sec === null && typeof d.loading_duration_sec === "number") measured.loading_duration_sec = d.loading_duration_sec;
  if (Array.isArray(d.frame_rate_seconds)) measured.frame_rate_seconds = d.frame_rate_seconds.slice(0, 16).map((seconds, i) => (measured.frame_rate_seconds[i] || 0) + amount(seconds));
  measured.long_frame_count += amount(d.long_frame_count);
  measured.measured_duration_sec += amount(d.measured_duration_sec);
  for (const kind of ["error_stop", "context_lost"]) if (d.crash_kind_counts && amount(d.crash_kind_counts[kind])) measured.crash_kind_counts[kind] = 1;
  measured.peak_memory_size_bytes = Math.max(measured.peak_memory_size_bytes, amount(d.peak_memory_size_bytes));
  if (d.is_settled === true) isSettled = true;
});
// What's been measured since the last report, or nothing; load time, memory and what the frame is stay for the next.
const measuredReport = () => {
  if (!measured || !isSettled) return {};
  const report = measured;
  measured = { ...newMeasured(), version_id: report.version_id, graphics_family: report.graphics_family, loading_duration_sec: report.loading_duration_sec, peak_memory_size_bytes: report.peak_memory_size_bytes };
  return JSON.stringify(report).length <= ${PLAYER_PERFORMANCE_LIMITS.maximumReportSizeBytes} ? { performance: report } : {};
};
// Every report says whether the tab is hidden, so "playing now" leaves a game the moment its player does.
const flush = (away) => {
  if (since) { shown += Date.now() - since; since = document.hidden ? 0 : Date.now(); }
  if (!ticket) return;
  const seconds = Math.floor((shown - sent) / 1000);
  if (seconds >= 1 || away) { beacon({ ticket, seconds: Math.max(seconds, 0), is_away: Boolean(away), ...measuredReport() }); sent += Math.max(seconds, 0) * 1000; }
};
const tick = () => {
  // The game frame stopped answering while on screen: frozen or crashed. Once a play.
  if (frame && aliveAt && !document.hidden && !hasStoppedResponding && Date.now() - aliveAt >= ${PLAYER_PERFORMANCE_LIMITS.stoppedRespondingAfterSec * 1000}) {
    hasStoppedResponding = true;
    measured = measured || newMeasured();
    measured.crash_kind_counts.stopped_responding = 1;
    isSettled = true;
  }
  if (ticket && !counted && onScreen() >= 60000) {
    counted = true;
    flush(document.hidden);
    post({ ticket, counted: true }).then(() => { const mine = load()[SLUG] || {}; save({ ...mine, cfirst: mine.cfirst || day(), clast: day() }); });
  }
  if (onScreen() - sent >= 300000) flush(document.hidden);
};
return () => {
  // A tester link's play is never counted: the check is only for multiplayer.
  if (TESTER) return check().then((token) => post({ tester: TESTER, token })).then(gotKey);
  const mine = load()[SLUG] || {};
  const start = { first: mine.first || null, last: mine.last || null, cfirst: mine.cfirst || null, clast: mine.clast || null };
  save({ ...mine, first: mine.first || day(), last: day() });
  since = document.hidden ? 0 : Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flush(true);
    else { since = Date.now(); if (aliveAt) aliveAt = Date.now(); if (ticket) post({ ticket, seconds: 0, is_away: false }); }
  });
  addEventListener("pagehide", () => flush(true));
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
