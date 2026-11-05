import { ApiError, ISO_TIME, audit, gameBySlug, iso, newId } from "@zaisma/core";
import type { Env } from "./env.ts";
import { isTrending, shelfCounts, showcase, type ShowGame } from "./home.ts";

/**
 * What's on at Zaisma: the home's window on what's happening. It fills itself from what's really going on, so it never sits empty while there are
 * games and never waits on a person; an admin adds an event (art across the top of the home) or a pick (one game among its cards) when they want.
 * It changes with the week and is the same for everyone. The admin MCP posts, lists and ends entries (admin-mcp.ts); GET /whats-on answers it.
 */

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
/** How long a big update or a first release counts as news here. */
const NEWS_DURATION_MS = 14 * DAY_MS;
/** The most cards What's on gives: a first visit shows three, a returning player two. */
export const MAXIMUM_WHATS_ON_CARD_COUNT = 3;
export const MAXIMUM_EVENT_TITLE_CHARACTER_COUNT = 60;
export const MAXIMUM_EVENT_LINK_LABEL_CHARACTER_COUNT = 20;
export const MAXIMUM_EVENT_LINK_URL_CHARACTER_COUNT = 500;
export const MAXIMUM_ENTRY_DURATION_DAYS = 60;
export const MAXIMUM_ENTRY_START_DELAY_DAYS = 90;
export const MAXIMUM_EVENT_ART_SIZE_BYTES = 2 * 1024 * 1024;
const START_GRACE_DURATION_MS = 3_600_000;
const ENDED_LISTED_DURATION_DAYS = 30;
const DEFAULT_EVENT_LINK_LABEL = "Go play";
const ART_CACHE_DURATION_SEC = 86_400;

/** A row of whats_on_entries (migration 0238). */
export interface WhatsOnEntry {
  id: string;
  entry_kind: "event" | "pick";
  game_id: string | null;
  title: string | null;
  wide_art_key: string | null;
  narrow_art_key: string | null;
  link_url: string | null;
  link_label: string | null;
  starts_at_ms: number;
  ends_at_ms: number;
  created_at_ms: number;
  created_by: string;
}

export type WhatsOnTagWords = "Pick" | "Updated" | "New" | "Trending";
export interface WhatsOnCard {
  game: ShowGame;
  /** Why it's here; null for a game filling the window when nothing's happening. */
  tagWords: WhatsOnTagWords | null;
}
export interface WhatsOnEvent {
  id: string;
  title: string;
  wide_art_url: string;
  narrow_art_url: string | null;
  link_url: string;
  link_label: string;
}

const artUrl = (entryId: string, artSide: "wide" | "narrow") => `/whats-on-art/${entryId}/${artSide}`;
export const whatsOnArtKey = (entryId: string, artSide: "wide" | "narrow") => `whats-on-art/${entryId}/${artSide}`;

export const eventOf = (entry: WhatsOnEntry): WhatsOnEvent => ({
  id: entry.id,
  title: entry.title!,
  wide_art_url: artUrl(entry.id, "wide"),
  narrow_art_url: entry.narrow_art_key ? artUrl(entry.id, "narrow") : null,
  link_url: entry.link_url!,
  link_label: entry.link_label ?? DEFAULT_EVENT_LINK_LABEL,
});

/** Those showing at this moment, the newest start first. */
async function currentEntries(env: Env, nowMs: number): Promise<WhatsOnEntry[]> {
  const { results } = await env.DB.prepare("SELECT * FROM whats_on_entries WHERE ends_at_ms > ? AND starts_at_ms <= ? ORDER BY starts_at_ms DESC, created_at_ms DESC LIMIT 20").bind(nowMs, nowMs).all<WhatsOnEntry>();
  return results;
}

/** Where a game falls in a week's order: a plain hash of the week and its slug, so the order is new each week and the same for everyone. */
function weekOrder(slug: string, weekNumber: number): number {
  let hashNumber = 2166136261 ^ weekNumber;
  for (let characterIndex = 0; characterIndex < slug.length; characterIndex++) hashNumber = Math.imul(hashNumber ^ slug.charCodeAt(characterIndex), 16777619);
  return hashNumber >>> 0;
}

/**
 * What's on from these games: picks first, then what's new this fortnight (big updates, first releases), what's trending, the busiest of the week, then
 * any listed game, so it's empty only with no games. Inside each, the week's order. excludedSlugs are left out (the game already shown beside it).
 */
export function pickWhatsOnCards(games: readonly ShowGame[], picks: readonly WhatsOnEntry[], options: { trendingSlugs: ReadonlySet<string>; popularSlugs: readonly string[]; excludedSlugs?: ReadonlySet<string>; offShelfSlugs?: ReadonlySet<string>; nowMs: number }): WhatsOnCard[] {
  const weekNumber = Math.floor(options.nowMs / WEEK_MS);
  const inWeekOrder = (list: readonly ShowGame[]) => [...list].sort((first, second) => weekOrder(first.slug, weekNumber) - weekOrder(second.slug, weekNumber));
  const listed = games.filter((game) => !options.excludedSlugs?.has(game.slug));
  const onShelves = listed.filter((game) => !options.offShelfSlugs?.has(game.slug));
  const isRecent = (atMs: number | null) => atMs !== null && atMs >= options.nowMs - NEWS_DURATION_MS;
  const groups: { tagWords: WhatsOnTagWords | null; list: readonly ShowGame[] }[] = [
    { tagWords: "Pick", list: picks.flatMap((pick) => listed.filter((game) => game.id === pick.game_id)) },
    { tagWords: "Updated", list: inWeekOrder(onShelves.filter((game) => isRecent(game.big_update_at_ms))) },
    { tagWords: "New", list: inWeekOrder(onShelves.filter((game) => isRecent(game.first_published_at_ms))) },
    { tagWords: "Trending", list: inWeekOrder(onShelves.filter((game) => options.trendingSlugs.has(game.slug))) },
    { tagWords: null, list: options.popularSlugs.flatMap((slug) => onShelves.filter((game) => game.slug === slug)) },
    { tagWords: null, list: inWeekOrder(onShelves) },
  ];
  const cards = new Map<string, WhatsOnCard>();
  for (const { tagWords, list } of groups) for (const game of list) if (!cards.has(game.slug)) cards.set(game.slug, { game, tagWords });
  return [...cards.values()].slice(0, MAXIMUM_WHATS_ON_CARD_COUNT);
}

/** The home's and the API's read: the event showing, if any, and the picks showing, split from one query. */
export async function currentWhatsOn(env: Env, nowMs = Date.now()): Promise<{ event: WhatsOnEntry | null; picks: WhatsOnEntry[] }> {
  const entries = await currentEntries(env, nowMs);
  return { event: entries.find((entry) => entry.entry_kind === "event") ?? null, picks: entries.filter((entry) => entry.entry_kind === "pick") };
}

/** GET /whats-on (MCP get_whats_on): what the home's window shows anyone, with no player's own game left out. */
export async function whatsOnAnswer(env: Env, nowMs = Date.now()) {
  const [{ event, picks }, games, { counts, offShelfSlugs }] = await Promise.all([currentWhatsOn(env, nowMs), showcase(env, 13), shelfCounts(env, 13, nowMs)]);
  const trendingSlugs = new Set([...counts].filter(([, shelfCount]) => isTrending(shelfCount)).map(([slug]) => slug));
  const popularSlugs = [...counts].sort(([, first], [, second]) => second.weekPlayerCount - first.weekPlayerCount).map(([slug]) => slug);
  return {
    event: event ? eventOf(event) : null,
    cards: pickWhatsOnCards(games, picks, { trendingSlugs, popularSlugs, offShelfSlugs, nowMs }).map(({ game, tagWords }) => ({ slug: game.slug, title: game.title, cover_url: game.cover, tag: tagWords })),
  };
}

/** GET /whats-on-art/:id/:side: an event's art. It's Zaisma's own, sent as a picture and kept in caches for a day. */
export async function handleWhatsOnArt(request: Request, env: Env, path: string): Promise<Response | null> {
  const match = path.match(/^\/whats-on-art\/(whats_on_entry_[a-z0-9]+)\/(wide|narrow)$/);
  if (!match) return null;
  const object = await env.GAMES.get(whatsOnArtKey(match[1]!, match[2] as "wide" | "narrow"));
  if (!object) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream", "Cache-Control": `public, max-age=${ART_CACHE_DURATION_SEC}`, "X-Content-Type-Options": "nosniff", ETag: object.httpEtag } });
}

// --- The admin tools' side ---

function readTime(given: string, field: string): number {
  const atMs = ISO_TIME.test(given) ? Date.parse(given) : NaN;
  if (!Number.isFinite(atMs)) throw new ApiError("bad_time", { message: `${field} is "${given.slice(0, 40)}", not an ISO time.`, field, fix: 'Give an ISO time with Z or an offset, like "2026-12-01T17:00:00Z".' });
  return atMs;
}

function readDates(startsAt: string | undefined, endsAt: string, nowMs: number): { startsAtMs: number; endsAtMs: number } {
  const startsAtMs = startsAt === undefined ? nowMs : readTime(startsAt, "starts_at");
  if (startsAtMs < nowMs - START_GRACE_DURATION_MS || startsAtMs > nowMs + MAXIMUM_ENTRY_START_DELAY_DAYS * DAY_MS) throw new ApiError("bad_time", { message: `starts_at ${iso(startsAtMs)} isn't from an hour ago to ${MAXIMUM_ENTRY_START_DELAY_DAYS} days ahead.`, field: "starts_at", fix: "Leave starts_at out to show it now, or give a time in that range." });
  const endsAtMs = readTime(endsAt, "ends_at");
  const latestEndAtMs = startsAtMs + MAXIMUM_ENTRY_DURATION_DAYS * DAY_MS;
  if (endsAtMs <= startsAtMs || endsAtMs <= nowMs || endsAtMs > latestEndAtMs) throw new ApiError("bad_time", { message: `ends_at ${iso(endsAtMs)} isn't after starts_at and now, within ${MAXIMUM_ENTRY_DURATION_DAYS} days of starts_at.`, field: "ends_at", fix: `Give a time after starts_at and now, by ${iso(latestEndAtMs)}.` });
  return { startsAtMs, endsAtMs };
}

/** A picture sent with a tool call, from its first bytes: PNG, WebP or JPEG, within the size cap. */
function readArt(base64: string, field: string): { bytes: Uint8Array; contentType: string } {
  const fix = `Send a PNG, WebP or JPEG of up to ${MAXIMUM_EVENT_ART_SIZE_BYTES} bytes, as base64.`;
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  } catch {
    throw new ApiError("bad_art", { message: `${field} isn't base64.`, field, fix });
  }
  if (bytes.length > MAXIMUM_EVENT_ART_SIZE_BYTES) throw new ApiError("bad_art", { message: `${field} is ${bytes.length} bytes, over ${MAXIMUM_EVENT_ART_SIZE_BYTES}.`, field, fix });
  const startsWith = (...byteNumbers: number[]) => byteNumbers.every((byteNumber, byteIndex) => bytes[byteIndex] === byteNumber);
  const contentType = startsWith(0x89, 0x50, 0x4e, 0x47) ? "image/png" : startsWith(0xff, 0xd8, 0xff) ? "image/jpeg" : startsWith(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 ? "image/webp" : null;
  if (!contentType) throw new ApiError("bad_art", { message: `${field} isn't a PNG, WebP or JPEG.`, field, fix });
  return { bytes, contentType };
}

function checkEventLink(given: string): string {
  const linkUrl = given.trim();
  const isPath = linkUrl.startsWith("/") && !linkUrl.startsWith("//") && !linkUrl.includes("\\") && !/\s/.test(linkUrl);
  let isHttps = false;
  try {
    isHttps = new URL(linkUrl).protocol === "https:";
  } catch {}
  if ((!isPath && !isHttps) || linkUrl.length > MAXIMUM_EVENT_LINK_URL_CHARACTER_COUNT) throw new ApiError("bad_link_url", { message: `link_url "${linkUrl.slice(0, 60)}" isn't an https address or a path on zaisma.com.`, field: "link_url", fix: 'Give an https address, or a path on zaisma.com like "/games?genre=survival".' });
  return linkUrl;
}

export interface EventToPost {
  title: string;
  wideArtBase64: string;
  narrowArtBase64?: string;
  linkUrl: string;
  linkLabel?: string;
  startsAt?: string;
  endsAt: string;
}

/** post_whats_on_event: its art goes to storage first, so a row never names art that isn't there. */
export async function postEvent(env: Env, toPost: EventToPost, actor: string): Promise<WhatsOnEntry> {
  const nowMs = Date.now();
  const title = toPost.title.trim();
  if (!title || title.length > MAXIMUM_EVENT_TITLE_CHARACTER_COUNT) throw new ApiError("bad_event_title", { message: `title is ${title.length} characters, not 1 to ${MAXIMUM_EVENT_TITLE_CHARACTER_COUNT}.`, field: "title", fix: "Give the event's name: screen readers read it, since the art shows it." });
  const linkUrl = checkEventLink(toPost.linkUrl);
  const linkLabel = toPost.linkLabel?.trim() || null;
  if (linkLabel && linkLabel.length > MAXIMUM_EVENT_LINK_LABEL_CHARACTER_COUNT) throw new ApiError("bad_link_label", { message: `link_label is ${linkLabel.length} characters, not 1 to ${MAXIMUM_EVENT_LINK_LABEL_CHARACTER_COUNT}.`, field: "link_label", fix: "Give a short label for its button." });
  const { startsAtMs, endsAtMs } = readDates(toPost.startsAt, toPost.endsAt, nowMs);
  const wideArt = readArt(toPost.wideArtBase64, "wide_art_base64");
  const narrowArt = toPost.narrowArtBase64 === undefined ? null : readArt(toPost.narrowArtBase64, "narrow_art_base64");
  const id = newId("whats_on_entry");
  await env.GAMES.put(whatsOnArtKey(id, "wide"), wideArt.bytes, { httpMetadata: { contentType: wideArt.contentType } });
  if (narrowArt) await env.GAMES.put(whatsOnArtKey(id, "narrow"), narrowArt.bytes, { httpMetadata: { contentType: narrowArt.contentType } });
  await env.DB.prepare("INSERT INTO whats_on_entries (id, entry_kind, title, wide_art_key, narrow_art_key, link_url, link_label, starts_at_ms, ends_at_ms, created_at_ms, created_by) VALUES (?, 'event', ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, title, whatsOnArtKey(id, "wide"), narrowArt ? whatsOnArtKey(id, "narrow") : null, linkUrl, linkLabel, startsAtMs, endsAtMs, nowMs, actor).run();
  await audit(env.DB, null, "whats-on-event-posted", `${id}: ${title}`, actor);
  return entryById(env, id);
}

/** post_whats_on_pick: one listed game among What's on's cards until ends_at. */
export async function postPick(env: Env, toPost: { gameSlug: string; startsAt?: string; endsAt: string }, actor: string): Promise<WhatsOnEntry> {
  const nowMs = Date.now();
  const game = await gameBySlug(env.DB, toPost.gameSlug);
  if (!game || game.review_status !== "live" || game.visibility !== "listed" || !game.live_version_id) throw new ApiError("no_game", { message: `There's no listed, live game called ${toPost.gameSlug}.`, field: "game_slug", fix: "Give the slug of a game players can find in Zaisma's lists." });
  const { startsAtMs, endsAtMs } = readDates(toPost.startsAt, toPost.endsAt, nowMs);
  const id = newId("whats_on_entry");
  await env.DB.prepare("INSERT INTO whats_on_entries (id, entry_kind, game_id, starts_at_ms, ends_at_ms, created_at_ms, created_by) VALUES (?, 'pick', ?, ?, ?, ?, ?)").bind(id, game.id, startsAtMs, endsAtMs, nowMs, actor).run();
  await audit(env.DB, game.id, "whats-on-pick-posted", `${id}: ${game.slug}`, actor);
  return entryById(env, id);
}

export async function entryById(env: Env, id: string): Promise<WhatsOnEntry> {
  const entry = await env.DB.prepare("SELECT * FROM whats_on_entries WHERE id = ?").bind(id).first<WhatsOnEntry>();
  if (!entry) throw new ApiError("no_whats_on_entry", { message: `There's no What's on entry with the ID ${id}.`, field: "whats_on_entry_id", fix: "list_whats_on lists them with their IDs." });
  return entry;
}

/** list_whats_on: showing and upcoming entries, and those ended in the last 30 days, the newest start first. */
export async function listEntries(env: Env, nowMs = Date.now()): Promise<WhatsOnEntry[]> {
  const { results } = await env.DB.prepare("SELECT * FROM whats_on_entries WHERE ends_at_ms > ? ORDER BY starts_at_ms DESC, created_at_ms DESC LIMIT 100").bind(nowMs - ENDED_LISTED_DURATION_DAYS * DAY_MS).all<WhatsOnEntry>();
  return results;
}

/** end_whats_on_entry: it ends now (one that hadn't started never shows). */
export async function endEntry(env: Env, id: string, actor: string): Promise<WhatsOnEntry> {
  const entry = await entryById(env, id);
  const nowMs = Date.now();
  if (entry.ends_at_ms <= nowMs) throw new ApiError("whats_on_entry_ended", { message: `${id} ended already.`, field: "whats_on_entry_id", fix: "list_whats_on shows what's still on." });
  await env.DB.prepare("UPDATE whats_on_entries SET ends_at_ms = ?, starts_at_ms = MIN(starts_at_ms, ?) WHERE id = ?").bind(nowMs, nowMs, id).run();
  await audit(env.DB, entry.game_id, "whats-on-entry-ended", id, actor);
  return entryById(env, id);
}

/** An entry as the admin tools answer it. */
export const entryAnswer = (entry: WhatsOnEntry, nowMs = Date.now()) => ({
  id: entry.id,
  entry_kind: entry.entry_kind,
  game_id: entry.game_id,
  title: entry.title,
  wide_art_url: entry.wide_art_key ? artUrl(entry.id, "wide") : null,
  narrow_art_url: entry.narrow_art_key ? artUrl(entry.id, "narrow") : null,
  link_url: entry.link_url,
  link_label: entry.entry_kind === "event" ? (entry.link_label ?? DEFAULT_EVENT_LINK_LABEL) : null,
  starts_at: iso(entry.starts_at_ms)!,
  ends_at: iso(entry.ends_at_ms)!,
  entry_status: entry.ends_at_ms <= nowMs ? ("ended" as const) : entry.starts_at_ms <= nowMs ? ("current" as const) : ("upcoming" as const),
  created_at: iso(entry.created_at_ms)!,
  created_by: entry.created_by,
});
