import { gameBySlug } from "@zaisma/core";
import type { Env } from "./env.ts";
import { playable } from "./home.ts";

/**
 * Play stats, counted by the game page (docs/DECISIONS.md: developer play stats built in). When a
 * player presses Play the page says whether this browser played the game before, and from when;
 * while the game is on screen it adds up the time. We keep only counts per game per day: no ID, no
 * address, nothing that says who played.
 *
 *   POST /api/plays/:slug   { first, last }   a play starts: the days this browser first and last
 *                                              played the game (YYYY-MM-DD, UTC), or null
 *                           { seconds }        time on screen since the last report, up to 10 minutes
 */

const DAY = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** The page reports time at least every 5 minutes, so anything past this isn't real. */
const MAX_SECONDS = 600;
/** How long after their first play a player coming back is counted. */
const MAX_AFTER = 30;

const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

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
  if (text.length > 500) return new Response(null, { status: 413 });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) ?? {};
  } catch {
    return new Response(null, { status: 400 });
  }
  const game = await gameBySlug(env.DB, m[1]!);
  if (!game || !playable(game)) return new Response(null, { status: 404 });
  await countPlay(env.DB, game.id, body);
  return new Response(null, { status: 204 });
}

/** Add one report from a game page to the game's counts. */
export async function countPlay(db: D1Database, gameId: string, body: Record<string, unknown>, now = Date.now()): Promise<void> {
  const day = today(now);
  if (body.seconds !== undefined) {
    const seconds = Math.round(Number(body.seconds));
    if (!Number.isFinite(seconds) || seconds < 1) return;
    await db
      .prepare("INSERT INTO play_days (game_id, day, play_seconds) VALUES (?, ?, ?) ON CONFLICT (game_id, day) DO UPDATE SET play_seconds = play_seconds + excluded.play_seconds")
      .bind(gameId, day, Math.min(seconds, MAX_SECONDS))
      .run();
    return;
  }
  const date = (v: unknown) => (typeof v === "string" && DATE.test(v) && Number.isFinite(Date.parse(v)) ? v : null);
  const first = date(body.first);
  const last = date(body.last);
  const isNew = first === null;
  const firstToday = last !== day;
  const writes = [
    db
      .prepare(
        "INSERT INTO play_days (game_id, day, plays, players, new_players) VALUES (?, ?, 1, ?, ?) ON CONFLICT (game_id, day) DO UPDATE SET plays = plays + 1, players = players + excluded.players, new_players = new_players + excluded.new_players",
      )
      .bind(gameId, day, isNew || firstToday ? 1 : 0, isNew ? 1 : 0),
  ];
  // Back for the first time today: count it against the day they first played.
  const after = first ? Math.round((Date.parse(day) - Date.parse(first)) / DAY) : 0;
  if (!isNew && firstToday && after >= 1 && after <= MAX_AFTER) {
    writes.push(
      db
        .prepare("INSERT INTO play_returns (game_id, first_day, after, players) VALUES (?, ?, ?, 1) ON CONFLICT (game_id, first_day, after) DO UPDATE SET players = players + 1")
        .bind(gameId, first, after),
    );
  }
  await db.batch(writes);
}

export interface PlayStats {
  days: { day: string; plays: number; players: number; new_players: number; minutes_played: number }[];
  plays: number;
  new_players: number;
  minutes_played: number;
  /** Average time on screen per play, in minutes, or null before any play. */
  minutes_per_play: number | null;
  /**
   * Of the players who first played in the 30 days before, how many came back 1, 7 and 30 days
   * later. Only days that are over count, so a new game shows null (percent) for a while.
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
      .prepare("SELECT day, plays, players, new_players, play_seconds FROM play_days WHERE game_id = ? AND day >= ? ORDER BY day")
      .bind(gameId, from < oldest ? from : oldest)
      .all<{ day: string; plays: number; players: number; new_players: number; play_seconds: number }>(),
    db
      .prepare("SELECT first_day, after, players FROM play_returns WHERE game_id = ? AND first_day >= ? AND after IN (1, 7, 30)")
      .bind(gameId, oldest)
      .all<{ first_day: string; after: number; players: number }>(),
  ]);
  const shown = rows.filter((r) => r.day >= from);
  const plays = shown.reduce((n, r) => n + r.plays, 0);
  const seconds = shown.reduce((n, r) => n + r.play_seconds, 0);
  const newBy = new Map(rows.map((r) => [r.day, r.new_players]));
  const cameBack = (after: number) => {
    // Players who first played on a day in the 30 before the last day that's over, `after` days on.
    const days = Array.from({ length: 30 }, (_, i) => today(now - (after + 1 + i) * DAY));
    const of = days.reduce((n, d) => n + (newBy.get(d) ?? 0), 0);
    const set = new Set(days);
    const players = returns.filter((r) => r.after === after && set.has(r.first_day)).reduce((n, r) => n + r.players, 0);
    return { percent: of ? Math.round((players / of) * 100) : null, players, of };
  };
  return {
    days: shown.map((r) => ({ day: r.day, plays: r.plays, players: r.players, new_players: r.new_players, minutes_played: Math.round(r.play_seconds / 60) })),
    plays,
    new_players: shown.reduce((n, r) => n + r.new_players, 0),
    minutes_played: Math.round(seconds / 60),
    minutes_per_play: plays ? Math.round((seconds / 60 / plays) * 10) / 10 : null,
    came_back: { after_1_day: cameBack(1), after_7_days: cameBack(7), after_30_days: cameBack(30) },
  };
}

/**
 * The game page's part: counts the play when it starts, then the time the game is on screen, sent
 * when the page is hidden and every 5 minutes. Which games this browser played, and when it first
 * and last did, stay in this browser (zaisma:plays).
 */
export function playCounter(slug: string): string {
  return `const countPlay = (() => {
const api = "/api/plays/${slug}";
const send = (body) => { const data = JSON.stringify(body); if (!(navigator.sendBeacon && navigator.sendBeacon(api, data))) fetch(api, { method: "POST", body: data, keepalive: true }).catch(() => {}); };
let shown = 0, since = 0;
const flush = () => {
  if (since) { shown += Date.now() - since; since = document.hidden ? 0 : Date.now(); }
  const seconds = Math.floor(shown / 1000);
  if (seconds >= 1) { send({ seconds }); shown -= seconds * 1000; }
};
return () => {
  const day = new Date().toISOString().slice(0, 10);
  let all = {};
  try { all = JSON.parse(localStorage.getItem("zaisma:plays") || "{}") || {}; } catch {}
  const mine = all[${JSON.stringify(slug)}] || {};
  send({ first: mine.first || null, last: mine.last || null });
  all[${JSON.stringify(slug)}] = { first: mine.first || day, last: day };
  // The 200 games played most recently.
  const keep = Object.entries(all).sort((a, b) => (b[1].last || "").localeCompare(a[1].last || "")).slice(0, 200);
  try { localStorage.setItem("zaisma:plays", JSON.stringify(Object.fromEntries(keep))); } catch {}
  since = document.hidden ? 0 : Date.now();
  document.addEventListener("visibilitychange", () => { if (document.hidden) flush(); else since = Date.now(); });
  addEventListener("pagehide", flush);
  setInterval(() => { if (shown + (since ? Date.now() - since : 0) >= 300000) flush(); }, 60000);
};
})();`;
}
