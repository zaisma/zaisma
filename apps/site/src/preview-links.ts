import { createHmac, timingSafeEqual } from "node:crypto";
import type { Version } from "@zaisma/core";

/**
 * Preview links (docs/DECISIONS.md, "Uploads are drafts"): zaisma.com/p/<version id>.<hour>.<HMAC>, for
 * the developer and their AI. The dashboard and the API hand out a fresh one every hour, each lasting a
 * day, with nothing stored: the HMAC is keyed with the version's own preview_link_key, so turning the
 * version's preview links off (a new key) ends every one handed out so far.
 */

const HOUR_MS = 3600_000;
/** A link handed out in one hour works for 25 hours from that hour's start, so always at least a day. */
const PREVIEW_LINK_HOUR_COUNT = 25;

const macOf = (key: string, versionId: string, hourNumber: number) => createHmac("sha256", key).update(`preview:${versionId}:${hourNumber}`).digest("hex").slice(0, 32);

/** This hour's preview link token for a version that passed, and when it stops working. Null before it passes. */
export function previewLinkToken(version: Pick<Version, "id" | "scan_status" | "preview_link_key">, nowMs = Date.now()): { token: string; expiresAtMs: number } | null {
  if (version.scan_status !== "approved" || !version.preview_link_key) return null;
  const hourNumber = Math.floor(nowMs / HOUR_MS);
  return { token: `${version.id}.${hourNumber.toString(36)}.${macOf(version.preview_link_key, version.id, hourNumber)}`, expiresAtMs: (hourNumber + PREVIEW_LINK_HOUR_COUNT) * HOUR_MS };
}

/** The version ID a preview link token names, before it's checked. */
export function readPreviewLinkToken(token: string): { versionId: string; hourNumber: number; mac: string } | null {
  const match = token.match(/^(version_[A-Za-z0-9_-]{1,60})\.([a-z0-9]{1,10})\.([0-9a-f]{32})$/);
  if (!match) return null;
  return { versionId: match[1]!, hourNumber: parseInt(match[2]!, 36), mac: match[3]! };
}

/** When a preview link token stops working, or null if it isn't one for this version or has ended. */
export function checkPreviewLinkToken(token: string, version: Pick<Version, "id" | "scan_status" | "preview_link_key">, nowMs = Date.now()): number | null {
  const read = readPreviewLinkToken(token);
  if (!read || read.versionId !== version.id || version.scan_status !== "approved" || !version.preview_link_key) return null;
  const expiresAtMs = (read.hourNumber + PREVIEW_LINK_HOUR_COUNT) * HOUR_MS;
  if (expiresAtMs <= nowMs || read.hourNumber * HOUR_MS > nowMs + 60_000) return null;
  const expected = Buffer.from(macOf(version.preview_link_key, version.id, read.hourNumber));
  return timingSafeEqual(expected, Buffer.from(read.mac)) ? expiresAtMs : null;
}
