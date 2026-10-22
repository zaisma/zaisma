import { ApiError, ISO_TIME, audit, iso, newId } from "@zaisma/core";
import type { Env } from "./env.ts";

/**
 * Announcements: short news Zaisma posts for players, shown as a closable banner at the top of
 * zaisma.com's home. One shows at a time, the newest current one (the latest start). The admin MCP
 * posts, lists and ends them (admin-mcp.ts), and GET /api/announcements answers the current ones for
 * anyone, with no key. Their text is Zaisma's own, but it's still escaped wherever it's shown.
 */

export const MAXIMUM_ANNOUNCEMENT_TEXT_CHARACTER_COUNT = 200;
export const MAXIMUM_LINK_LABEL_CHARACTER_COUNT = 30;
export const MAXIMUM_LINK_URL_CHARACTER_COUNT = 500;
/** The longest an announcement can show, from its start. */
export const MAXIMUM_ANNOUNCEMENT_DURATION_DAYS = 60;
/** How far ahead one can start, and how far back a start may be given (a clock a little behind). */
export const MAXIMUM_START_DELAY_DAYS = 90;
const START_GRACE_DURATION_MS = 3600_000;
/** How long ended ones stay in list_announcements. */
export const ENDED_SHOWN_DURATION_DAYS = 30;
/** The link's words when none were given. */
export const DEFAULT_LINK_LABEL = "Read more";
/** How long browsers and Cloudflare may keep GET /api/announcements. */
const PUBLIC_CACHE_DURATION_SEC = 60;
const DAY_MS = 86400_000;

/** A row of the announcements table (migration 0124). */
export interface Announcement {
  id: string;
  text: string;
  link_url: string | null;
  link_label: string | null;
  starts_at_ms: number;
  ends_at_ms: number;
  created_at_ms: number;
  created_by: string;
}

export type AnnouncementStatus = "current" | "upcoming" | "ended";

/** The link's words as shown: its own, or Read more when it has a link; null without one. */
export const shownLinkLabel = (announcement: Pick<Announcement, "link_url" | "link_label">) => (announcement.link_url ? (announcement.link_label ?? DEFAULT_LINK_LABEL) : null);

/** Those showing at this moment, the newest start first. */
async function currentAnnouncements(env: Env, nowMs: number): Promise<Announcement[]> {
  const { results } = await env.DB.prepare("SELECT * FROM announcements WHERE ends_at_ms > ? AND starts_at_ms <= ? ORDER BY starts_at_ms DESC, created_at_ms DESC LIMIT 20").bind(nowMs, nowMs).all<Announcement>();
  return results;
}

/** The one the home shows: the newest whose starts_at_ms <= now < ends_at_ms, or null. */
export async function currentAnnouncement(env: Env): Promise<{ id: string; text: string; link_url: string | null; link_label: string | null } | null> {
  const [newest] = await currentAnnouncements(env, Date.now());
  return newest ? { id: newest.id, text: newest.text, link_url: newest.link_url, link_label: shownLinkLabel(newest) } : null;
}

/** GET /api/announcements: the current ones, newest first, for anyone; cacheable for a minute. */
export async function handleAnnouncements(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path !== "/api/announcements") return null;
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  const announcements = (await currentAnnouncements(env, Date.now())).map((announcement) => ({
    id: announcement.id,
    text: announcement.text,
    link_url: announcement.link_url,
    link_label: shownLinkLabel(announcement),
    starts_at: iso(announcement.starts_at_ms)!,
    ends_at: iso(announcement.ends_at_ms)!,
  }));
  return Response.json({ announcements }, { headers: { "Cache-Control": `public, max-age=${PUBLIC_CACHE_DURATION_SEC}` } });
}

export function announcementStatus(announcement: Announcement, nowMs: number): AnnouncementStatus {
  if (announcement.ends_at_ms <= nowMs) return "ended";
  return announcement.starts_at_ms <= nowMs ? "current" : "upcoming";
}

/** list_announcements: showing and upcoming ones, and those ended in the last 30 days, newest start first; which one shows now. */
export async function listAnnouncements(env: Env): Promise<{ announcements: Announcement[]; shownAnnouncementId: string | null; nowMs: number }> {
  const nowMs = Date.now();
  const { results } = await env.DB.prepare("SELECT * FROM announcements WHERE ends_at_ms > ? ORDER BY starts_at_ms DESC, created_at_ms DESC LIMIT 100").bind(nowMs - ENDED_SHOWN_DURATION_DAYS * DAY_MS).all<Announcement>();
  const [shown] = await currentAnnouncements(env, nowMs);
  return { announcements: results, shownAnnouncementId: shown?.id ?? null, nowMs };
}

export async function announcementById(env: Env, id: string): Promise<Announcement> {
  const announcement = await env.DB.prepare("SELECT * FROM announcements WHERE id = ?").bind(id).first<Announcement>();
  if (!announcement) throw new ApiError("no_announcement", { message: `There's no announcement with the ID ${id}.`, field: "announcement_id", fix: "list_announcements lists them with their IDs." });
  return announcement;
}

/** An ISO time given for an announcement, as epoch milliseconds, or bad_time. */
function readTime(given: unknown, field: string): number {
  const atMs = typeof given === "string" && ISO_TIME.test(given) ? Date.parse(given) : NaN;
  if (!Number.isFinite(atMs)) {
    const said = typeof given === "string" ? `"${given.slice(0, 40)}"` : `a ${typeof given}`;
    throw new ApiError("bad_time", { message: `${field} is ${said}, not an ISO time.`, field, fix: `Give an ISO time with Z or an offset, like "${new Date(Date.now() + 7 * DAY_MS).toISOString().slice(0, 14)}00:00Z".` });
  }
  return atMs;
}

/** One or two plain sentences: no markup, links or line breaks (it's shown as plain text on the home). */
function checkText(given: string): string {
  const text = given.trim().replace(/\s+/g, " ");
  const fix = `Write one or two plain sentences of 1 to ${MAXIMUM_ANNOUNCEMENT_TEXT_CHARACTER_COUNT} characters, and put a link in link_url.`;
  if (!text || text.length > MAXIMUM_ANNOUNCEMENT_TEXT_CHARACTER_COUNT) throw new ApiError("bad_text", { message: `text is ${text.length} characters, not 1 to ${MAXIMUM_ANNOUNCEMENT_TEXT_CHARACTER_COUNT}.`, field: "text", fix });
  if (/[\r\n]/.test(given)) throw new ApiError("bad_text", { message: "text has a line break.", field: "text", fix });
  if (/[<>]|\]\(|\*\*|__|`|https?:\/\/|www\./i.test(text)) throw new ApiError("bad_text", { message: "text has markup or an address in it; it's shown as plain text.", field: "text", fix });
  const sentenceCount = text.split(/[.!?]+(?:\s+|$)/).filter((sentence) => sentence.trim()).length;
  if (sentenceCount > 2) throw new ApiError("bad_text", { message: `text is ${sentenceCount} sentences, not one or two.`, field: "text", fix });
  return text;
}

/** An https address, or a path on zaisma.com starting with / (never //, which leaves the site). */
function checkLinkUrl(given: string): string {
  const linkUrl = given.trim();
  const fix = 'Give an https address like "https://zaisma.com/forum", or a path on zaisma.com like "/forum".';
  if (linkUrl.startsWith("/")) {
    if (linkUrl.startsWith("//") || linkUrl.includes("\\") || /\s/.test(linkUrl)) throw new ApiError("bad_link_url", { message: `link_url "${linkUrl.slice(0, 60)}" isn't a path on zaisma.com.`, field: "link_url", fix });
    return linkUrl;
  }
  let parsed: URL | null = null;
  try {
    parsed = new URL(linkUrl);
  } catch {}
  if (!parsed || parsed.protocol !== "https:" || parsed.username || parsed.password || /\s/.test(linkUrl)) throw new ApiError("bad_link_url", { message: `link_url "${linkUrl.slice(0, 60)}" isn't an https address or a path on zaisma.com.`, field: "link_url", fix });
  return parsed.toString();
}

export interface AnnouncementToPost {
  text: string;
  linkUrl?: string;
  linkLabel?: string;
  startsAt?: string;
  endsAt: string;
}

/** post_announcement: checks it, saves it and records it in the audit log. */
export async function postAnnouncement(env: Env, toPost: AnnouncementToPost, actor: string): Promise<Announcement> {
  const nowMs = Date.now();
  const text = checkText(toPost.text);
  const linkUrl = toPost.linkUrl === undefined ? null : checkLinkUrl(toPost.linkUrl);
  if (toPost.linkLabel !== undefined && linkUrl === null) throw new ApiError("bad_link_label", { message: "link_label was given without link_url.", field: "link_label", fix: "Give link_url too, or leave link_label out." });
  const linkLabel = toPost.linkLabel === undefined ? null : toPost.linkLabel.trim();
  if (linkLabel !== null && (!linkLabel || linkLabel.length > MAXIMUM_LINK_LABEL_CHARACTER_COUNT)) {
    throw new ApiError("bad_link_label", { message: `link_label is ${linkLabel.length} characters, not 1 to ${MAXIMUM_LINK_LABEL_CHARACTER_COUNT}.`, field: "link_label", fix: `Give 1 to ${MAXIMUM_LINK_LABEL_CHARACTER_COUNT} characters, like "See what's new", or leave it out for "${DEFAULT_LINK_LABEL}".` });
  }
  const startsAtMs = toPost.startsAt === undefined ? nowMs : readTime(toPost.startsAt, "starts_at");
  if (startsAtMs < nowMs - START_GRACE_DURATION_MS || startsAtMs > nowMs + MAXIMUM_START_DELAY_DAYS * DAY_MS) {
    throw new ApiError("bad_time", { message: `starts_at ${iso(startsAtMs)} isn't from an hour ago to ${MAXIMUM_START_DELAY_DAYS} days ahead.`, field: "starts_at", fix: "Leave starts_at out to show it now, or give a time up to 90 days ahead." });
  }
  const endsAtMs = readTime(toPost.endsAt, "ends_at");
  const latestEndAtMs = startsAtMs + MAXIMUM_ANNOUNCEMENT_DURATION_DAYS * DAY_MS;
  if (endsAtMs <= startsAtMs || endsAtMs <= nowMs || endsAtMs > latestEndAtMs) {
    throw new ApiError("bad_time", {
      message: endsAtMs > latestEndAtMs ? `ends_at ${iso(endsAtMs)} is more than ${MAXIMUM_ANNOUNCEMENT_DURATION_DAYS} days after starts_at.` : `ends_at ${iso(endsAtMs)} isn't after ${endsAtMs <= nowMs ? "now" : "starts_at"}.`,
      field: "ends_at",
      fix: `Give a time after starts_at and now, at most ${MAXIMUM_ANNOUNCEMENT_DURATION_DAYS} days after starts_at (by ${iso(latestEndAtMs)}).`,
    });
  }
  const id = newId("announcement");
  await env.DB.prepare("INSERT INTO announcements (id, text, link_url, link_label, starts_at_ms, ends_at_ms, created_at_ms, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, text, linkUrl, linkLabel, startsAtMs, endsAtMs, nowMs, actor).run();
  await audit(env.DB, null, "announcement-posted", `${id}: ${text}`, actor);
  return announcementById(env, id);
}

/** end_announcement: it ends now (one that hadn't started never shows). */
export async function endAnnouncement(env: Env, id: string, actor: string): Promise<Announcement> {
  const announcement = await announcementById(env, id);
  const nowMs = Date.now();
  if (announcement.ends_at_ms <= nowMs) throw new ApiError("announcement_ended", { message: `${id} ended at ${iso(announcement.ends_at_ms)}.`, field: "announcement_id", fix: "list_announcements shows which are showing now." });
  await env.DB.prepare("UPDATE announcements SET ends_at_ms = ?, starts_at_ms = MIN(starts_at_ms, ?) WHERE id = ?").bind(nowMs, nowMs, id).run();
  await audit(env.DB, null, "announcement-ended", id, actor);
  return announcementById(env, id);
}
