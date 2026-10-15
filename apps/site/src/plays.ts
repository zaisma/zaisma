import { gameBySlug, issueRoomKey, newId, testerLinkByToken, type Game } from "@zaisma/core";
import { checkAccessToken, readCookie } from "./auth.ts";
import type { Env } from "./env.ts";
import { playable } from "./home.ts";

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
 */

const DAY = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TICKET = /^[a-z0-9]{10,40}$/;
/** The page reports time at least every 5 minutes, so anything past this isn't real. */
const MAX_SECONDS = 600;
/** How long after their first play a player coming back is counted. */
const MAX_AFTER = 30;
/** On screen this long before a play counts (the page waits 60 seconds; a little leeway for clocks). */
const COUNT_AFTER_MS = 55_000;
/** A ticket is good for this long: a play longer than that stops adding time. */
const TICKET_MS = 6 * 3_600_000;

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
const ok = (body?: unknown) => (body === undefined ? new Response(null, { status: 204 }) : Response.json(body));

export async function handlePlays(request: Request, env: Env, path: string): Promise<Response | null> {
  const m = path.match(/^\/api\/plays\/([a-z0-9-]+)$/);
  if (!m) return null;
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
  const game = await gameBySlug(env.DB, m[1]!);
  if (body.tester !== undefined) return testerPlay(env, game, body);
  if (!game || !playable(game)) return new Response(null, { status: 404 });

  if (typeof body.ticket === "string") {
    if (!TICKET.test(body.ticket)) return new Response(null, { status: 400 });
    if (body.counted === true) await countTicket(env.DB, game.id, body.ticket, network(request));
    else await addTime(env.DB, game.id, body.ticket, body.seconds);
    return ok();
  }
  const facts = startFacts(body);
  await countStart(env.DB, game.id, facts);
  if (!(await checked(env, body.token))) return ok();
  const key = multiplayer(game) ? await issueRoomKey(env.DB, game.id) : undefined;
  // Only plays from a checked browser, and not the developer's own, can be counted.
  const ticket = (await ownGame(request, env, game)) ? undefined : await issueTicket(env.DB, game.id, facts);
  return ticket || key ? ok({ ...(ticket ? { ticket } : {}), ...(key ? { key } : {}) }) : ok();
}

/** Multiplayer with Zaisma's player passes: on Zaisma rooms or the game's own servers. */
const multiplayer = (game: Game) => game.multiplayer_mode !== "none" || Boolean(game.connect_hosts);

/** A play through a tester link: never counted, but a checked browser still gets its key to multiplayer. */
async function testerPlay(env: Env, game: Game | null, body: Record<string, unknown>): Promise<Response> {
  const link = typeof body.tester === "string" ? await testerLinkByToken(env.DB, body.tester) : null;
  if (!game || !link || link.slug !== game.slug || game.review_status !== "live" || !game.live_version_id) return new Response(null, { status: 404 });
  if (!multiplayer(game) || !(await checked(env, body.token))) return ok();
  return ok({ key: await issueRoomKey(env.DB, game.id) });
}

interface StartFacts {
  first: string | null;
  last: string | null;
  cfirst: string | null;
  clast: string | null;
}

function startFacts(body: Record<string, unknown>): StartFacts {
  const date = (v: unknown) => (typeof v === "string" && DATE.test(v) && Number.isFinite(Date.parse(v)) ? v : null);
  return { first: date(body.first), last: date(body.last), cfirst: date(body.cfirst), clast: date(body.clast) };
}

/** Every play started, checked or not: the "in all" numbers. */
export async function countStart(db: D1Database, gameId: string, f: StartFacts, now = Date.now()): Promise<void> {
  const day = today(now);
  const isNew = f.first === null;
  await db
    .prepare(
      "INSERT INTO play_days (game_id, day, plays, players, new_players) VALUES (?, ?, 1, ?, ?) ON CONFLICT (game_id, day) DO UPDATE SET plays = plays + 1, players = players + excluded.players, new_players = new_players + excluded.new_players",
    )
    .bind(gameId, day, isNew || f.last !== day ? 1 : 0, isNew ? 1 : 0)
    .run();
}

/** A checked play's ticket, with what it will count once it's been on screen for a minute. */
export async function issueTicket(db: D1Database, gameId: string, f: StartFacts, now = Date.now()): Promise<string> {
  const id = newId();
  const day = today(now);
  await db
    .prepare("INSERT INTO play_tickets (id, game_id, issued_at, day, player, new_player, first_day) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, gameId, now, day, f.clast !== day ? 1 : 0, f.cfirst === null ? 1 : 0, f.cfirst)
    .run();
  return id;
}

/** A minute on screen: count the play, once, with the time it has so far. */
export async function countTicket(db: D1Database, gameId: string, id: string, asn: number, now = Date.now()): Promise<boolean> {
  const t = await db
    .prepare("UPDATE play_tickets SET counted_at = ? WHERE id = ? AND game_id = ? AND counted_at IS NULL AND issued_at <= ? AND issued_at > ? RETURNING *")
    .bind(now, id, gameId, now - COUNT_AFTER_MS, now - TICKET_MS)
    .first<{ day: string; player: number; new_player: number; first_day: string | null; seconds: number }>();
  if (!t) return false;
  const writes = [
    db
      .prepare(
        "INSERT INTO play_days (game_id, day, counted, counted_players, counted_new, counted_seconds) VALUES (?, ?, 1, ?, ?, ?) ON CONFLICT (game_id, day) DO UPDATE SET counted = counted + 1, counted_players = counted_players + excluded.counted_players, counted_new = counted_new + excluded.counted_new, counted_seconds = counted_seconds + excluded.counted_seconds",
      )
      .bind(gameId, t.day, t.player, t.new_player, t.seconds),
  ];
  if (t.player) {
    writes.push(
      db
        .prepare("INSERT INTO play_networks (game_id, day, asn, players) VALUES (?, ?, ?, 1) ON CONFLICT (game_id, day, asn) DO UPDATE SET players = players + 1")
        .bind(gameId, t.day, asn),
    );
  }
  // Back for the first time today: count it against the day they first played.
  const after = t.first_day ? Math.round((Date.parse(t.day) - Date.parse(t.first_day)) / DAY) : 0;
  if (!t.new_player && t.player && after >= 1 && after <= MAX_AFTER) {
    writes.push(
      db
        .prepare("INSERT INTO play_returns (game_id, first_day, after, players) VALUES (?, ?, ?, 1) ON CONFLICT (game_id, first_day, after) DO UPDATE SET players = players + 1")
        .bind(gameId, t.first_day, after),
    );
  }
  await db.batch(writes);
  return true;
}

/** Time on screen, never more than has passed since the ticket was issued. */
export async function addTime(db: D1Database, gameId: string, id: string, value: unknown, now = Date.now()): Promise<void> {
  const seconds = Math.min(Math.round(Number(value)), MAX_SECONDS);
  if (!Number.isFinite(seconds) || seconds < 1) return;
  const t = await db
    .prepare("UPDATE play_tickets SET seconds = seconds + ?1 WHERE id = ?2 AND game_id = ?3 AND issued_at > ?4 AND (seconds + ?1) * 1000 <= ?5 - issued_at + 10000 RETURNING counted_at")
    .bind(seconds, id, gameId, now - TICKET_MS, now)
    .first<{ counted_at: number | null }>();
  // Time before the play counted is added when it counts.
  if (t?.counted_at) {
    await db
      .prepare("INSERT INTO play_days (game_id, day, counted_seconds) VALUES (?, ?, ?) ON CONFLICT (game_id, day) DO UPDATE SET counted_seconds = counted_seconds + excluded.counted_seconds")
      .bind(gameId, today(now), seconds)
      .run();
  }
}

/** Cloudflare's answer about the browser that pressed Play. Each answer works once. */
async function checked(env: Env, token: unknown): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET;
  if (!secret || typeof token !== "string" || !token || token.length > 2048) return false;
  try {
    const res = await fetch(SITEVERIFY, { method: "POST", body: new URLSearchParams({ secret, response: token }) });
    const out = (await res.json()) as { success?: boolean; action?: string; hostname?: string };
    if (out.success !== true) return false;
    // Cloudflare's test keys (the preview) answer without the action or our hostname.
    if (secret.startsWith("1x0000000000000000000000000000000")) return true;
    return out.action === "play" && out.hostname === new URL(env.SITE_ORIGIN).hostname;
  } catch {
    return false;
  }
}

/** The developer playing their own game, signed in. Never refreshes the session, so it can't sign them out. */
async function ownGame(request: Request, env: Env, game: Game): Promise<boolean> {
  if (!game.owner_id) return false;
  const access = readCookie(request, env, "zaisma")?.split("~")[0];
  if (!access) return false;
  const who = await checkAccessToken(env, access).catch(() => null);
  if (!who || who === "expired") return false;
  return Boolean(await env.DB.prepare("SELECT 1 FROM owners WHERE id = ? AND account_id = ?").bind(game.owner_id, who.userId).first());
}

/** The internet provider's network number (ASN) of the connection, or 0 when unknown. */
function network(request: Request): number {
  const asn = Number((request as { cf?: { asn?: unknown } }).cf?.asn);
  return Number.isInteger(asn) && asn > 0 ? asn : 0;
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
export function shelfPlayers(networks: { asn: number; players: number }[]): number {
  // The share is of players on other networks, so bots on cloud servers can't raise it.
  const homes = networks.filter((r) => r.asn !== 0 && !HOSTING_NETWORKS.has(r.asn));
  const cap = Math.max(10, Math.ceil(homes.reduce((n, r) => n + r.players, 0) * 0.3));
  return homes.reduce((n, r) => n + Math.min(r.players, cap), 0);
}

export interface PlayStats {
  days: { day: string; plays: number; players: number; new_players: number; minutes_played: number; all_plays: number }[];
  /** Counted plays: the official number. */
  plays: number;
  /** Every play started, counted or not. */
  all_plays: number;
  new_players: number;
  minutes_played: number;
  /** Average time on screen per counted play, in minutes, or null before any. */
  minutes_per_play: number | null;
  /**
   * Of the players whose first counted play was in the 30 days before, how many came back 1, 7 and
   * 30 days later. Only days that are over count, so a new game shows null (percent) for a while.
   */
  came_back: Record<"after_1_day" | "after_7_days" | "after_30_days", { percent: number | null; players: number; of: number }>;
}

/** A game's play stats for the last `days` days (including today). */
export async function playStats(db: D1Database, gameId: string, days: number, now = Date.now()): Promise<PlayStats> {
  const from = today(now - (days - 1) * DAY);
  // Coming back after 30 days looks at players who first played up to 60 days ago.
  const oldest = today(now - (MAX_AFTER + 30) * DAY);
  const [{ results: rows }, { results: returns }] = await Promise.all([
    db
      .prepare("SELECT day, plays, counted, counted_players, counted_new, counted_seconds FROM play_days WHERE game_id = ? AND day >= ? ORDER BY day")
      .bind(gameId, from < oldest ? from : oldest)
      .all<{ day: string; plays: number; counted: number; counted_players: number; counted_new: number; counted_seconds: number }>(),
    db
      .prepare("SELECT first_day, after, players FROM play_returns WHERE game_id = ? AND first_day >= ? AND after IN (1, 7, 30)")
      .bind(gameId, oldest)
      .all<{ first_day: string; after: number; players: number }>(),
  ]);
  const shown = rows.filter((r) => r.day >= from);
  const plays = shown.reduce((n, r) => n + r.counted, 0);
  const seconds = shown.reduce((n, r) => n + r.counted_seconds, 0);
  const newBy = new Map(rows.map((r) => [r.day, r.counted_new]));
  const cameBack = (after: number) => {
    // Players who first played on a day in the 30 before the last day that's over, `after` days on.
    const days = Array.from({ length: 30 }, (_, i) => today(now - (after + 1 + i) * DAY));
    const of = days.reduce((n, d) => n + (newBy.get(d) ?? 0), 0);
    const set = new Set(days);
    const players = returns.filter((r) => r.after === after && set.has(r.first_day)).reduce((n, r) => n + r.players, 0);
    return { percent: of ? Math.round((players / of) * 100) : null, players, of };
  };
  return {
    days: shown.map((r) => ({ day: r.day, plays: r.counted, players: r.counted_players, new_players: r.counted_new, minutes_played: Math.round(r.counted_seconds / 60), all_plays: r.plays })),
    plays,
    all_plays: shown.reduce((n, r) => n + r.plays, 0),
    new_players: shown.reduce((n, r) => n + r.counted_new, 0),
    minutes_played: Math.round(seconds / 60),
    minutes_per_play: plays ? Math.round((seconds / 60 / plays) * 10) / 10 : null,
    came_back: { after_1_day: cameBack(1), after_7_days: cameBack(7), after_30_days: cameBack(30) },
  };
}

/**
 * The game page's part. As the page opens it asks Cloudflare's invisible check about this browser, so
 * Play doesn't wait for it; on Play it reports the start with the check's answer. A checked play gets
 * a ticket, and in a multiplayer game a key for the game's passes. After a minute on screen it asks for the play to count,
 * and reports time on screen when the page is hidden and every 5 minutes. Which games this browser
 * played, and when it first and last did, stay in this browser (zaisma:plays).
 */
export function playCounter(slug: string, siteKey: string | undefined, tester?: string): string {
  return `// The key to player passes the check gives a checked browser in a multiplayer game, for the game to ask for (zaisma:room-key).
let gotKey;
const roomKey = new Promise((done) => (gotKey = (r) => done((r && r.key) || null)));
const countPlay = (() => {
const api = "/api/plays/${slug}", KEY = "zaisma:plays", SLUG = ${JSON.stringify(slug)}, SITE_KEY = ${JSON.stringify(siteKey ?? "")}, TESTER = ${JSON.stringify(tester ?? "")};
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
})();`;
}

export interface PlaySpike {
  game_id: string;
  title: string;
  is_off_shelves: number;
  day: string;
  players: number;
  /** Counted players a day in the week before, on average. */
  usual: number;
  networks: number;
  /** Share of the day's players from its biggest network, and from cloud networks, in percent. */
  top_share: number;
  hosting_share: number;
}

/**
 * Days, today or yesterday, when a game had far more counted players than usual (5 times its average
 * over the week before, and at least 30), with how spread out they were: for admin to check.
 */
export async function playSpikes(db: D1Database, now = Date.now()): Promise<PlaySpike[]> {
  const { results } = await db
    .prepare("SELECT play_days.game_id, games.title, games.is_off_shelves, play_days.day, play_days.counted_players FROM play_days JOIN games ON games.id = play_days.game_id WHERE play_days.day >= ?")
    .bind(today(now - 8 * DAY))
    .all<{ game_id: string; title: string; is_off_shelves: number; day: string; counted_players: number }>();
  const spikes: PlaySpike[] = [];
  for (const d of [today(now), today(now - DAY)]) {
    for (const r of results.filter((x) => x.day === d && x.counted_players >= 30)) {
      const week = Array.from({ length: 7 }, (_, i) => today(Date.parse(d) - (i + 1) * DAY));
      const usual = results.filter((x) => x.game_id === r.game_id && week.includes(x.day)).reduce((n, x) => n + x.counted_players, 0) / 7;
      if (r.counted_players < usual * 5) continue;
      const { results: nets } = await db.prepare("SELECT asn, players FROM play_networks WHERE game_id = ? AND day = ?").bind(r.game_id, d).all<{ asn: number; players: number }>();
      const total = nets.reduce((n, x) => n + x.players, 0) || 1;
      spikes.push({
        game_id: r.game_id,
        title: r.title,
        is_off_shelves: r.is_off_shelves,
        day: d,
        players: r.counted_players,
        usual: Math.round(usual * 10) / 10,
        networks: nets.length,
        top_share: Math.round((Math.max(0, ...nets.map((x) => x.players)) / total) * 100),
        hosting_share: Math.round((nets.filter((x) => HOSTING_NETWORKS.has(x.asn)).reduce((n, x) => n + x.players, 0) / total) * 100),
      });
    }
  }
  return spikes;
}

/** Take a day's counted plays away from a game (they looked faked). Every play started stays. */
export async function clearCountedDay(db: D1Database, gameId: string, day: string): Promise<void> {
  await db.batch([
    db.prepare("UPDATE play_days SET counted = 0, counted_players = 0, counted_new = 0, counted_seconds = 0 WHERE game_id = ? AND day = ?").bind(gameId, day),
    db.prepare("DELETE FROM play_networks WHERE game_id = ? AND day = ?").bind(gameId, day),
  ]);
}
