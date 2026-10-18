import { sha256Hex } from "./ids.ts";
import type { TesterLink } from "./db.ts";
import type { Game, Version } from "./types.ts";

/**
 * Tester links and previews open at fixed addresses on the game domain, one of each per game
 * (<slug>--tester, <slug>--preview), so a game address never holds a key (docs/DECISIONS.md, "No game
 * address holds a key"). Testers' progress survives a new link, and a preview's a new build, the way
 * players' saves survive an update. Slugs never contain "--".
 *
 * Those addresses serve only a browser holding Zaisma's access cookie. The zaisma.com page (a tester
 * link at /t/<token>, a preview at /p/<token>) makes a one-use grant that lasts a minute; the games
 * server swaps it for an access key it sets as the cookie, and checks it here on every request.
 */

export type AddressKind = "tester" | "preview";
export const ADDRESS_KINDS: readonly AddressKind[] = ["tester", "preview"];

/** The game domain name a game's tester links or previews open at, like sky-hopper--tester. */
export function gameAddress(slug: string, addressKind: AddressKind): string {
  return `${slug}--${addressKind}`;
}

/** Which game and kind of address a game domain name is, or null for a game's public address. */
export function readGameAddress(name: string): { slug: string; addressKind: AddressKind } | null {
  const match = name.match(/^([a-z0-9-]+?)--(tester|preview)$/);
  return match ? { slug: match[1]!, addressKind: match[2] as AddressKind } : null;
}

/** How long a grant can wait to be swapped for the cookie. */
export const ACCESS_GRANT_DURATION_MS = 60_000;
/** How long one opening of a tester link or preview lasts, at most: opening the link again makes a new one. */
export const ACCESS_PASS_DURATION_MS = 12 * 3600_000;

/** A secret for a link or a grant: lowercase letters and digits. */
export function randomKey(characterCount: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(characterCount)), (byte) => "abcdefghijklmnopqrstuvwxyz0123456789"[byte % 36]).join("");
}

const hashOf = (key: string) => sha256Hex(new TextEncoder().encode(key));

/** A one-use grant for a browser to open a game's tester or preview address. */
export async function createAccessGrant(
  database: D1Database,
  pass: { gameId: string; addressKind: AddressKind; testerId?: string; versionId?: string; expiresAtMs: number },
  nowMs = Date.now(),
): Promise<string> {
  const grantKey = randomKey(32);
  await database
    .prepare("INSERT INTO game_access_passes (grant_key_hash, game_id, address_kind, tester_id, version_id, created_at_ms, expires_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(await hashOf(grantKey), pass.gameId, pass.addressKind, pass.testerId ?? null, pass.versionId ?? null, nowMs, Math.min(pass.expiresAtMs, nowMs + ACCESS_PASS_DURATION_MS))
    .run();
  return grantKey;
}

/** Swap a grant for the access key, once and within a minute. Null when it's used, old or for another address. */
export async function useAccessGrant(
  database: D1Database,
  grant: { grantKey: string; gameId: string; addressKind: AddressKind },
  nowMs = Date.now(),
): Promise<{ accessKey: string; expiresAtMs: number } | null> {
  if (!/^[a-z0-9]{32}$/.test(grant.grantKey)) return null;
  const accessKey = randomKey(32);
  const row = await database
    .prepare(
      "UPDATE game_access_passes SET grant_used_at_ms = ?, access_key_hash = ? WHERE grant_key_hash = ? AND game_id = ? AND address_kind = ? AND grant_used_at_ms IS NULL AND created_at_ms > ? AND expires_at_ms > ? RETURNING expires_at_ms",
    )
    .bind(nowMs, await hashOf(accessKey), await hashOf(grant.grantKey), grant.gameId, grant.addressKind, nowMs - ACCESS_GRANT_DURATION_MS, nowMs)
    .first<{ expires_at_ms: number }>();
  return row ? { accessKey, expiresAtMs: row.expires_at_ms } : null;
}

/** What an access key opens, while it lasts: a tester link's ID, or a preview's version. */
export async function accessPassByKey(
  database: D1Database,
  pass: { accessKey: string; gameId: string; addressKind: AddressKind },
  nowMs = Date.now(),
): Promise<{ tester_id: string | null; version_id: string | null; expires_at_ms: number } | null> {
  if (!/^[a-z0-9]{32}$/.test(pass.accessKey)) return null;
  return database
    .prepare("SELECT tester_id, version_id, expires_at_ms FROM game_access_passes WHERE access_key_hash = ? AND game_id = ? AND address_kind = ? AND expires_at_ms > ?")
    .bind(await hashOf(pass.accessKey), pass.gameId, pass.addressKind, nowMs)
    .first();
}

/** Turning a version's preview links off ends every opening of them too. */
export async function endPreviewPasses(database: D1Database, versionId: string): Promise<void> {
  await database.prepare("DELETE FROM game_access_passes WHERE address_kind = 'preview' AND version_id = ?").bind(versionId).run();
}

/** Passes that have ended, and grants nobody swapped in time. */
export async function deleteEndedAccessPasses(database: D1Database, nowMs = Date.now()): Promise<void> {
  await database
    .prepare("DELETE FROM game_access_passes WHERE expires_at_ms < ? OR (grant_used_at_ms IS NULL AND created_at_ms < ?)")
    .bind(nowMs, nowMs - ACCESS_GRANT_DURATION_MS)
    .run();
}

// --- The game entry ----------------------------------------------------------
//
// An accounts-only game (account_requirement whole_game) serves its public address only to a browser that
// came through its zaisma.com page: the page asks for a grant (POST /api/plays/:slug/entry, which checks the
// account and its age), and the games server swaps it for a cookie at <slug>.<game domain>/_zaisma/enter.
// Nothing is stored per player: both are HMACs keyed with the game's entry_signing_key, so a new key ends
// every grant and cookie at once. The grant works for a minute (not once), and only ever reaches the
// player's own frame, inside an encrypted URL.

const ENTRY_TOKEN_PATTERN = /^(\d{1,15})\.([0-9a-f]{64})$/;

async function entryHmacKey(signingKey: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(signingKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function signEntry(game: Pick<Game, "id" | "entry_signing_key">, purpose: "grant" | "entry", expiresAtMs: number): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", await entryHmacKey(game.entry_signing_key), new TextEncoder().encode(`${purpose}|${game.id}|${expiresAtMs}`));
  return `${expiresAtMs}.${Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Whether a grant or cookie is this game's, for this purpose, and still on. crypto.subtle.verify compares in constant time. */
async function isEntrySigned(game: Pick<Game, "id" | "entry_signing_key">, purpose: "grant" | "entry", token: string, nowMs: number): Promise<boolean> {
  const match = ENTRY_TOKEN_PATTERN.exec(token);
  if (!match || !game.entry_signing_key) return false;
  const expiresAtMs = Number(match[1]);
  if (expiresAtMs <= nowMs) return false;
  const signature = Uint8Array.from(match[2]!.match(/../g)!, (pair) => parseInt(pair, 16));
  return crypto.subtle.verify("HMAC", await entryHmacKey(game.entry_signing_key), signature, new TextEncoder().encode(`${purpose}|${game.id}|${expiresAtMs}`));
}

/** A grant for the player's frame to enter an accounts-only game's public address: good for a minute. */
export async function createEntryGrant(game: Pick<Game, "id" | "entry_signing_key">, nowMs = Date.now()): Promise<string> {
  return signEntry(game, "grant", nowMs + ACCESS_GRANT_DURATION_MS);
}

/** Swap a grant for the entry cookie's value, lasting 12 hours. Null when the grant is old, another game's or from before a new key. */
export async function useEntryGrant(game: Pick<Game, "id" | "entry_signing_key">, grant: string, nowMs = Date.now()): Promise<{ cookieValue: string; expiresAtMs: number } | null> {
  if (!(await isEntrySigned(game, "grant", grant, nowMs))) return null;
  const expiresAtMs = nowMs + ACCESS_PASS_DURATION_MS;
  return { cookieValue: await signEntry(game, "entry", expiresAtMs), expiresAtMs };
}

/** Whether an entry cookie's value still opens this game. */
export function isEntryCookieValid(game: Pick<Game, "id" | "entry_signing_key">, cookieValue: string, nowMs = Date.now()): Promise<boolean> {
  return isEntrySigned(game, "entry", cookieValue, nowMs);
}

/** A tester link opens its game while it's on and before its end date. */
export function isTesterLinkOn(link: Pick<TesterLink, "revoked_at_ms" | "ends_at_ms">, nowMs = Date.now()): boolean {
  return link.revoked_at_ms === null && (link.ends_at_ms === null || link.ends_at_ms > nowMs);
}

/**
 * The version a tester link opens now: the live one, the newest that passed, or the one the developer
 * picked. Null when there's nothing to open: no live version yet, or the picked one is gone.
 */
export async function testerLinkVersion(
  database: D1Database,
  game: Pick<Game, "id" | "review_status" | "live_version_id">,
  link: Pick<TesterLink, "version_choice" | "picked_version_id">,
): Promise<Version | null> {
  if (link.version_choice === "live") {
    if (game.review_status !== "live" || !game.live_version_id) return null;
    return database.prepare("SELECT * FROM versions WHERE id = ?").bind(game.live_version_id).first<Version>();
  }
  if (link.version_choice === "picked") {
    return database.prepare("SELECT * FROM versions WHERE id = ? AND game_id = ? AND scan_status = 'approved'").bind(link.picked_version_id, game.id).first<Version>();
  }
  return database.prepare("SELECT * FROM versions WHERE game_id = ? AND scan_status = 'approved' ORDER BY created_at_ms DESC LIMIT 1").bind(game.id).first<Version>();
}
