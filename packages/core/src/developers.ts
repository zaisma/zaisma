import { newRandomPart, sha256Hex } from "./ids.ts";
import type { ReviewReason } from "./review.ts";
import { checkAllowedHosts } from "./reach.ts";
import { checkOwnServerUrls } from "./own-servers.ts";
import { checkLinks, type GameLink } from "./links.ts";
import { randomKey } from "./game-access.ts";
import { ACCOUNT_REQUIREMENTS, MINIMUM_PLAYER_AGES, MULTIPLAYER_MODES, ROOM_BROWSING, type AccountRequirement, type Game, type MinimumPlayerAge, type RoomBrowsing, type Visibility } from "./types.ts";

/**
 * Developer accounts: API keys, game details, device labels and images.
 * The developer API, the MCP, the upload command and the dashboard all go through these.
 */

const now = () => Date.now();

// --- API keys ----------------------------------------------------------------

export interface ApiKey {
  id: string;
  account_id: string;
  name: string;
  access_level: AccessLevel;
  /** Only for custom keys: each area's choice, as JSON. A level's areas come from AREA_ACCESS_BY_LEVEL. */
  area_access: string | null;
  /** The game slugs the key works on, as a JSON list, or null for every game the owner has and will make. */
  game_slugs: string | null;
  created_at_ms: number;
  last_used_at_ms: number | null;
  /** The fingerprint of the network and country the key was last used from (security-log.ts, placeSha256For); null before its first use. */
  last_place_sha256: string | null;
  /** When the key first made a call through the MCP, or null while it hasn't: the moment an AI connected. */
  mcp_first_used_at_ms: number | null;
  /** When the key stops working, or null when it lasts until removed. */
  ends_at_ms: number | null;
  /** When Zaisma turned the key off because it was found in public, or null while it's on. Never turned back on. */
  turned_off_at_ms: number | null;
  /** Where the key was found (KEY_FOUND_IN), or null while it's on. */
  found_in: KeyFoundIn | null;
  /** The address it was found at, when there is a public one. */
  found_at_url: string | null;
  /** What the key was last used with, as security-log.ts words it ("Zaisma CLI 1.4"), when the account keeps where it's used from. */
  last_used_device: string | null;
  /** The network the key was last used from. */
  last_used_network_name: string | null;
  /** The city the key was last used from. */
  last_used_city_name: string | null;
  /** The region the key was last used from. */
  last_used_region_name: string | null;
  /** The country (two letters) the key was last used from. */
  last_used_country_code: string | null;
  /** api_key: made on zaisma.com/account. connected_app: an AI app connected by signing in (OAuth), which works only at the MCP. */
  kind: ApiKeyKind;
  /** The connected app's OAuth client_id (an mcp_client_… ID or its metadata document's URL); null for an API key. */
  mcp_client_id: string | null;
  /** Where the connected app sent the developer back after signing in, like claude.ai; null for an API key. */
  connected_app_host: string | null;
}

export const API_KEY_KINDS = ["api_key", "connected_app"] as const;
export type ApiKeyKind = (typeof API_KEY_KINDS)[number];

/** The end dates a new key can have, in days from now; no end date is also allowed. */
export const KEY_ENDS_AFTER_DAYS = [7, 30, 90, 365] as const;
/** Where a key found in public was found: GitHub's secret scanning, a game's uploaded files, or a forum post. */
export const KEY_FOUND_IN = ["github", "game_files", "forum_post"] as const;
export type KeyFoundIn = (typeof KEY_FOUND_IN)[number];

/** Whether a key works: on, turned off because it was found in public, or past its end date; for a connected app's token, also past its hour. */
export type KeyState = "on" | "turned_off" | "ended" | "token_ended";

export const MAXIMUM_API_KEY_COUNT = 10;
/** Connected apps are counted apart from keys, so connecting chat apps never blocks making a CI key. */
export const MAXIMUM_CONNECTED_APP_COUNT = 10;
/** A connected app's access token lasts an hour; the app refreshes it by itself. */
export const CONNECTED_APP_TOKEN_DURATION_SEC = 3600;
/** A refresh token used again this soon after it was swapped is a retry race, not theft: refused, but the connection stays. */
export const REFRESH_TOKEN_REUSE_GRACE_SEC = 60;
/** The most games one key can be limited to: as many as an owner can have. */
export const MAXIMUM_API_KEY_GAME_COUNT = 50;
const KEY = /^zsk_([a-z0-9]{20})_([A-Za-z0-9_-]{43})$/;
/** A connected app's tokens: zat_ (access, an hour) and zrt_ (refresh), each naming its connection. Only their SHA-256 is kept. */
const ACCESS_TOKEN = /^zat_([a-z0-9]{20})_[A-Za-z0-9_-]{43}$/;
const REFRESH_TOKEN = /^zrt_([a-z0-9]{20})_[A-Za-z0-9_-]{43}$/;
/** A key's shape inside other text: what GitHub's secret scanning and our own scans look for. Whole-token hash matches decide; this only finds candidates. */
const KEY_IN_TEXT = /\bzsk_[a-z0-9]{20}_[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g;
const DAY_MS = 86400_000;

/** Every distinct string in the text shaped like a key. Not proof of a key: check each with turnOffLeakedKey. */
export function apiKeyTokensIn(text: string): string[] {
  return [...new Set(text.match(KEY_IN_TEXT) ?? [])];
}

/**
 * What a key may do, by area (docs/DECISIONS.md, "Developers hold the keys"). Each area's choices go from
 * least to most, and each takes in the ones before it. Every key sees its games and their versions, so
 * game_access and version_access start at read.
 *
 *   game_access         read: list and get games, with images, versions, scans, tester links and secrets' names. write: details, visibility, images, tester links, secrets, game_server_allowed_hosts, own_server_urls, links, new games
 *   version_access      read: as games. upload: send files and make versions. publish: also publish, schedule and roll back
 *   stats_access        stats, player reports and history
 *   database_access     read: tables, indexes, use and export. write: run SQL and import
 *   save_access         players' cloud saves: read them and their copies. write: change, reset and restore them
 *   forum_access        read: search and read. write: post, reply, vote, follow and message Zaisma, in the developer's name
 *   sign_in_app_access  Sign in with Zaisma apps (the whole account's)
 *   webhook_access      webhooks (the whole account's)
 */
export const AREA_ACCESS_CHOICES = {
  game_access: ["read", "write"],
  version_access: ["read", "upload", "publish"],
  stats_access: ["none", "read"],
  database_access: ["none", "read", "write"],
  save_access: ["none", "read", "write"],
  forum_access: ["none", "read", "write"],
  sign_in_app_access: ["none", "read", "write"],
  webhook_access: ["none", "read", "write"],
} as const satisfies Record<string, readonly string[]>;
export type AccessArea = keyof typeof AREA_ACCESS_CHOICES;
export type AreaAccess = { [Area in AccessArea]: (typeof AREA_ACCESS_CHOICES)[Area][number] };
export const ACCESS_AREAS = Object.keys(AREA_ACCESS_CHOICES) as AccessArea[];
/** Areas that belong to the whole account, not to games, so only keys for every game reach them. */
export const ACCOUNT_AREAS: readonly AccessArea[] = ["sign_in_app_access", "webhook_access"];

/** The four fixed levels, the same words as the Teams roles, and custom: a choice per area. */
export const ACCESS_LEVELS = ["read", "upload", "publish", "full", "custom"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

/** What each fixed level gives. Read and upload keys read the forum but don't post in the developer's name. */
export const AREA_ACCESS_BY_LEVEL: Record<Exclude<AccessLevel, "custom">, AreaAccess> = {
  read: { game_access: "read", version_access: "read", stats_access: "read", database_access: "read", save_access: "read", forum_access: "read", sign_in_app_access: "read", webhook_access: "read" },
  upload: { game_access: "read", version_access: "upload", stats_access: "read", database_access: "read", save_access: "read", forum_access: "read", sign_in_app_access: "read", webhook_access: "read" },
  publish: { game_access: "write", version_access: "publish", stats_access: "read", database_access: "read", save_access: "read", forum_access: "write", sign_in_app_access: "read", webhook_access: "read" },
  full: { game_access: "write", version_access: "publish", stats_access: "read", database_access: "write", save_access: "write", forum_access: "write", sign_in_app_access: "write", webhook_access: "write" },
};

/** What a caller may do: a key's access, or everything for the developer on our own pages. */
export interface KeyAccess {
  /** The key's ID, or null when the call came from the developer's signed-in session. */
  apiKeyId: string | null;
  /** The key's name, or null when the call came from the developer's signed-in session. */
  apiKeyName: string | null;
  accessLevel: AccessLevel;
  areaAccess: AreaAccess;
  /** null: every game the owner has and will make. */
  gameSlugs: string[] | null;
  /** When the key stops working, or null: no end date, or a signed-in session. */
  endsAtMs: number | null;
}

export const FULL_ACCESS: KeyAccess = { apiKeyId: null, apiKeyName: null, accessLevel: "full", areaAccess: AREA_ACCESS_BY_LEVEL.full, gameSlugs: null, endsAtMs: null };

/** Whether access gives at least this choice in an area. */
export function allows(areaAccess: AreaAccess, area: AccessArea, choice: string): boolean {
  const choices: readonly string[] = AREA_ACCESS_CHOICES[area];
  return choices.indexOf(areaAccess[area]) >= choices.indexOf(choice);
}

/** What a key may do, from its row. Keys limited to some games never reach the account's own areas. */
export function keyAccess(key: Pick<ApiKey, "id" | "name" | "access_level" | "area_access" | "game_slugs"> & { ends_at_ms?: number | null }): KeyAccess {
  const gameSlugs = key.game_slugs ? (JSON.parse(key.game_slugs) as string[]) : null;
  const areaAccess: AreaAccess = key.access_level === "custom" ? storedAreaAccess(key.area_access) : { ...AREA_ACCESS_BY_LEVEL[key.access_level] };
  if (gameSlugs) for (const area of ACCOUNT_AREAS) (areaAccess as Record<AccessArea, string>)[area] = "none";
  return { apiKeyId: key.id, apiKeyName: key.name, accessLevel: key.access_level, areaAccess, gameSlugs, endsAtMs: key.ends_at_ms ?? null };
}

/** Whether access is a full key: every area at its last choice, for every game the owner has and will make. */
export function isFullKey(access: KeyAccess): boolean {
  return access.gameSlugs === null && ACCESS_AREAS.every((area) => access.areaAccess[area] === AREA_ACCESS_CHOICES[area][AREA_ACCESS_CHOICES[area].length - 1]);
}

/** A custom key's stored choices; an area added after it was made is none (or read, where read is the least). */
function storedAreaAccess(json: string | null): AreaAccess {
  const choices = (json ? JSON.parse(json) : {}) as Record<string, string>;
  const areaAccess: Record<string, string> = {};
  for (const area of ACCESS_AREAS) {
    const options: readonly string[] = AREA_ACCESS_CHOICES[area];
    areaAccess[area] = options.includes(choices[area] ?? "") ? choices[area]! : options[0]!;
  }
  return areaAccess as AreaAccess;
}

/** A problem with what a new key asks for, as the account page says it, or null when it's fine. */
export function checkKeyScope(scope: KeyScope): string | null {
  if (!ACCESS_LEVELS.includes(scope.accessLevel)) return "Choose what the key can do.";
  if (scope.endsAfterDays != null && !(KEY_ENDS_AFTER_DAYS as readonly number[]).includes(scope.endsAfterDays)) return "Choose when the key ends, or Never.";
  if (scope.gameSlugs) {
    if (scope.gameSlugs.length === 0) return "Choose at least one game, or All my games.";
    if (scope.gameSlugs.length > MAXIMUM_API_KEY_GAME_COUNT) return `A key can be limited to up to ${MAXIMUM_API_KEY_GAME_COUNT} games.`;
  }
  if (scope.accessLevel !== "custom") return null;
  if (!scope.areaAccess) return "Choose what the key can do in each area.";
  for (const area of ACCESS_AREAS) {
    const options: readonly string[] = AREA_ACCESS_CHOICES[area];
    if (!options.includes(scope.areaAccess[area])) return "Choose what the key can do in each area.";
  }
  if (scope.gameSlugs && ACCOUNT_AREAS.some((area) => scope.areaAccess![area] !== "none")) {
    return "Sign-in apps and webhooks belong to your whole account, so only a key for all your games can reach them.";
  }
  return null;
}

/** What a new key may do. Leaving it out makes a key for everything, as every key did before. */
export interface KeyScope {
  accessLevel: AccessLevel;
  /** Only for custom keys. */
  areaAccess?: AreaAccess;
  gameSlugs: string[] | null;
  /** Days until the key stops working (one of KEY_ENDS_AFTER_DAYS), or null for no end date. Leaving it out is null. */
  endsAfterDays?: number | null;
}

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Make a key. The full key is returned once; we keep only a hash of its secret part. Check the scope first (checkKeyScope). */
export async function createApiKey(database: D1Database, accountId: string, name: string, scope: KeyScope = { accessLevel: "full", gameSlugs: null }): Promise<{ key: ApiKey; token: string }> {
  const id = newRandomPart();
  const secret = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const key: ApiKey = {
    id,
    account_id: accountId,
    name,
    access_level: scope.accessLevel,
    area_access: scope.accessLevel === "custom" && scope.areaAccess ? JSON.stringify(Object.fromEntries(ACCESS_AREAS.map((area) => [area, scope.areaAccess![area]]))) : null,
    game_slugs: scope.gameSlugs ? JSON.stringify(scope.gameSlugs) : null,
    created_at_ms: now(),
    last_used_at_ms: null,
    last_place_sha256: null,
    mcp_first_used_at_ms: null,
    ends_at_ms: scope.endsAfterDays ? now() + scope.endsAfterDays * DAY_MS : null,
    turned_off_at_ms: null,
    found_in: null,
    found_at_url: null,
    last_used_device: null,
    last_used_network_name: null,
    last_used_city_name: null,
    last_used_region_name: null,
    last_used_country_code: null,
    kind: "api_key",
    mcp_client_id: null,
    connected_app_host: null,
  };
  await database
    .prepare("INSERT INTO api_keys (id, account_id, name, secret_hash, access_level, area_access, game_slugs, created_at_ms, ends_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, accountId, name, await sha256Hex(new TextEncoder().encode(secret)), key.access_level, key.area_access, key.game_slugs, key.created_at_ms, key.ends_at_ms)
    .run();
  return { key, token: `zsk_${id}_${secret}` };
}

const API_KEY_COLUMNS =
  "id, account_id, name, access_level, area_access, game_slugs, last_used_at_ms, last_place_sha256, mcp_first_used_at_ms, ends_at_ms, turned_off_at_ms, found_in, found_at_url, last_used_device, last_used_network_name, last_used_city_name, last_used_region_name, last_used_country_code, kind, mcp_client_id, connected_app_host";

async function liveCount(database: D1Database, accountId: string, kind: ApiKeyKind): Promise<number> {
  const row = await database
    .prepare("SELECT COUNT(*) AS key_count FROM api_keys WHERE account_id = ? AND kind = ? AND turned_off_at_ms IS NULL AND (ends_at_ms IS NULL OR ends_at_ms > ?)")
    .bind(accountId, kind, now())
    .first<{ key_count: number }>();
  return row?.key_count ?? 0;
}

/** Keys that work now: not turned off and not past their end date. These are the ones that count toward MAXIMUM_API_KEY_COUNT. Connected apps aren't keys here. */
export const liveApiKeyCount = (database: D1Database, accountId: string) => liveCount(database, accountId, "api_key");

/** Connected apps that work now, counted toward MAXIMUM_CONNECTED_APP_COUNT. */
export const liveConnectedAppCount = (database: D1Database, accountId: string) => liveCount(database, accountId, "connected_app");

/** Whether a key works, from its row. */
export function keyStateOf(key: Pick<ApiKey, "turned_off_at_ms" | "ends_at_ms">, nowMs = now()): KeyState {
  if (key.turned_off_at_ms !== null) return "turned_off";
  if (key.ends_at_ms !== null && key.ends_at_ms <= nowMs) return "ended";
  return "on";
}

export async function apiKeysFor(database: D1Database, accountId: string): Promise<ApiKey[]> {
  const { results } = await database
    .prepare(`SELECT ${API_KEY_COLUMNS}, created_at_ms FROM api_keys WHERE account_id = ? ORDER BY created_at_ms`)
    .bind(accountId)
    .all<ApiKey>();
  return results;
}

export async function revokeApiKey(database: D1Database, accountId: string, id: string): Promise<boolean> {
  const [, deletion] = await database.batch([
    // A connected app's tokens stop at once: first, while the row still says whose key it is.
    database.prepare("DELETE FROM connected_app_tokens WHERE api_key_id IN (SELECT id FROM api_keys WHERE id = ? AND account_id = ?)").bind(id, accountId),
    database.prepare("DELETE FROM api_keys WHERE id = ? AND account_id = ?").bind(id, accountId),
    // The places it was used from go with it.
    database.prepare("DELETE FROM security_places WHERE api_key_id = ? AND account_id = ?").bind(id, accountId),
  ]);
  return deletion!.meta.changes > 0;
}

/** The row a token names, when its whole secret matches (never from the shape alone); null otherwise. Compares in constant time. */
async function keyRowForToken(database: D1Database, token: string): Promise<(Omit<ApiKey, "created_at_ms"> & { secret_hash: string }) | null> {
  const keyMatch = token.match(KEY);
  if (!keyMatch) return null;
  // Only API keys: a connected app's row has a secret nobody ever sees, and its own tokens.
  const row = await database
    .prepare(`SELECT ${API_KEY_COLUMNS}, secret_hash FROM api_keys WHERE id = ? AND kind = 'api_key'`)
    .bind(keyMatch[1])
    .first<Omit<ApiKey, "created_at_ms"> & { secret_hash: string }>();
  if (!row) return null;
  const hash = await sha256Hex(new TextEncoder().encode(keyMatch[2]!));
  let mismatchNumber = hash.length ^ row.secret_hash.length;
  for (let i = 0; i < hash.length; i++) mismatchNumber |= hash.charCodeAt(i) ^ row.secret_hash.charCodeAt(i % row.secret_hash.length);
  return mismatchNumber === 0 ? row : null;
}

/**
 * The key a token is, with whether it works, or null. Marks a key that works as used (at most once an hour,
 * to save writes); a turned-off or ended key is never marked, so its last use stays when it stopped.
 */
export async function apiKeyForToken(database: D1Database, token: string): Promise<{ key: Omit<ApiKey, "created_at_ms">; keyState: KeyState } | null> {
  let key: Omit<ApiKey, "created_at_ms">;
  let keyState: KeyState;
  if (token.startsWith("zat_")) {
    const found = await connectedAppForToken(database, token, "access");
    if (!found) return null;
    key = keyOfTokenRow(found);
    keyState = keyStateOf(key);
    if (keyState === "on" && found.token_expires_at_ms !== null && found.token_expires_at_ms <= now()) keyState = "token_ended";
  } else {
    const row = await keyRowForToken(database, token);
    if (!row) return null;
    const { secret_hash: _, ...rest } = row;
    key = rest;
    keyState = keyStateOf(row);
  }
  if (keyState === "on" && (!key.last_used_at_ms || now() - key.last_used_at_ms > 3600_000)) {
    await database.prepare("UPDATE api_keys SET last_used_at_ms = ? WHERE id = ?").bind(now(), key.id).run();
  }
  return { key, keyState };
}

// --- Connected apps: AI apps that sign in to the MCP (OAuth) ------------------------

/** The connection a zat_ or zrt_ token belongs to, with the token's own end and rotation; null when no stored token matches. */
async function connectedAppForToken(
  database: D1Database,
  token: string,
  tokenKind: "access" | "refresh",
): Promise<(Omit<ApiKey, "created_at_ms"> & { token_expires_at_ms: number | null; token_rotated_at_ms: number | null }) | null> {
  const tokenMatch = token.match(tokenKind === "access" ? ACCESS_TOKEN : REFRESH_TOKEN);
  if (!tokenMatch) return null;
  const keyColumns = API_KEY_COLUMNS.split(", ").map((column) => `api_keys.${column}`).join(", ");
  // A lookup by the whole token's hash: the shape alone never finds a row.
  const row = await database
    .prepare(
      `SELECT ${keyColumns}, connected_app_tokens.expires_at_ms AS token_expires_at_ms, connected_app_tokens.rotated_at_ms AS token_rotated_at_ms
       FROM connected_app_tokens JOIN api_keys ON api_keys.id = connected_app_tokens.api_key_id
       WHERE connected_app_tokens.token_sha256 = ? AND connected_app_tokens.token_kind = ? AND api_keys.kind = 'connected_app'`,
    )
    .bind(await sha256Hex(new TextEncoder().encode(token)), tokenKind)
    .first<Omit<ApiKey, "created_at_ms"> & { token_expires_at_ms: number | null; token_rotated_at_ms: number | null }>();
  return row && row.id === tokenMatch[1] ? row : null;
}

/** The connection's own row, without its token's columns. */
function keyOfTokenRow(row: Omit<ApiKey, "created_at_ms"> & { token_expires_at_ms: number | null; token_rotated_at_ms: number | null }): Omit<ApiKey, "created_at_ms"> {
  const key: Partial<typeof row> = { ...row };
  delete key.token_expires_at_ms;
  delete key.token_rotated_at_ms;
  return key as Omit<ApiKey, "created_at_ms">;
}

/** What a connected app is: its name, its OAuth client_id and where it sent the developer back. */
export interface ConnectedAppIdentity {
  name: string;
  mcpClientId: string;
  connectedAppHost: string;
}

/** The live connections a new one from this app replaces: the same client_id, or the same name and host. */
export async function connectedAppsReplacedBy(database: D1Database, accountId: string, app: ConnectedAppIdentity): Promise<string[]> {
  const { results } = await database
    .prepare(
      `SELECT id FROM api_keys WHERE account_id = ? AND kind = 'connected_app' AND (mcp_client_id = ? OR (name = ? AND connected_app_host = ?))
       AND turned_off_at_ms IS NULL AND (ends_at_ms IS NULL OR ends_at_ms > ?)`,
    )
    .bind(accountId, app.mcpClientId, app.name, app.connectedAppHost, now())
    .all<{ id: string }>();
  return results.map((row) => row.id);
}

/**
 * Connect an app: an api_keys row of kind connected_app, so every check, log, list and end date that holds keys holds
 * it. Connecting the same app again replaces its old connection, tokens and places included, so the developer sees one
 * row. Its secret_hash is the hash of a secret nobody ever sees, so no zsk_ token can match it. Check the scope first.
 */
export async function createConnectedApp(database: D1Database, accountId: string, app: ConnectedAppIdentity & { scope: KeyScope; endsAtMs?: number | null }): Promise<ApiKey> {
  const replacedIds = await connectedAppsReplacedBy(database, accountId, app);
  const id = newRandomPart();
  const { scope } = app;
  const key: ApiKey = {
    id,
    account_id: accountId,
    name: app.name,
    access_level: scope.accessLevel,
    area_access: scope.accessLevel === "custom" && scope.areaAccess ? JSON.stringify(Object.fromEntries(ACCESS_AREAS.map((area) => [area, scope.areaAccess![area]]))) : null,
    game_slugs: scope.gameSlugs ? JSON.stringify(scope.gameSlugs) : null,
    created_at_ms: now(),
    last_used_at_ms: null,
    last_place_sha256: null,
    mcp_first_used_at_ms: null,
    // The end date chosen on the connect page, kept as a time by its code; or days from now.
    ends_at_ms: app.endsAtMs !== undefined ? app.endsAtMs : scope.endsAfterDays ? now() + scope.endsAfterDays * DAY_MS : null,
    turned_off_at_ms: null,
    found_in: null,
    found_at_url: null,
    last_used_device: null,
    last_used_network_name: null,
    last_used_city_name: null,
    last_used_region_name: null,
    last_used_country_code: null,
    kind: "connected_app",
    mcp_client_id: app.mcpClientId,
    connected_app_host: app.connectedAppHost,
  };
  const unseenSecretHash = await sha256Hex(crypto.getRandomValues(new Uint8Array(32)));
  await database.batch([
    ...replacedIds.flatMap((replacedId) => [
      database.prepare("DELETE FROM connected_app_tokens WHERE api_key_id = ?").bind(replacedId),
      database.prepare("DELETE FROM security_places WHERE api_key_id = ? AND account_id = ?").bind(replacedId, accountId),
      database.prepare("DELETE FROM api_keys WHERE id = ? AND account_id = ?").bind(replacedId, accountId),
    ]),
    database
      .prepare(
        "INSERT INTO api_keys (id, account_id, name, secret_hash, access_level, area_access, game_slugs, created_at_ms, ends_at_ms, kind, mcp_client_id, connected_app_host) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'connected_app', ?, ?)",
      )
      .bind(id, accountId, key.name, unseenSecretHash, key.access_level, key.area_access, key.game_slugs, key.created_at_ms, key.ends_at_ms, key.mcp_client_id, key.connected_app_host),
  ]);
  return key;
}

/** A connected app's tokens, as the token endpoint answers them. */
export interface ConnectedAppTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
}

/** New tokens for a connection, and the statements that store their hashes. */
async function newConnectedAppTokens(database: D1Database, apiKeyId: string): Promise<{ tokens: ConnectedAppTokens; statements: D1PreparedStatement[] }> {
  const createdAtMs = now();
  const accessToken = `zat_${apiKeyId}_${b64url(crypto.getRandomValues(new Uint8Array(32)))}`;
  const refreshToken = `zrt_${apiKeyId}_${b64url(crypto.getRandomValues(new Uint8Array(32)))}`;
  const hashOf = (token: string) => sha256Hex(new TextEncoder().encode(token));
  const insert = "INSERT INTO connected_app_tokens (token_sha256, api_key_id, token_kind, created_at_ms, expires_at_ms, rotated_at_ms) VALUES (?, ?, ?, ?, ?, NULL)";
  return {
    tokens: { accessToken, refreshToken, expiresInSec: CONNECTED_APP_TOKEN_DURATION_SEC },
    statements: [
      database.prepare(insert).bind(await hashOf(accessToken), apiKeyId, "access", createdAtMs, createdAtMs + CONNECTED_APP_TOKEN_DURATION_SEC * 1000),
      database.prepare(insert).bind(await hashOf(refreshToken), apiKeyId, "refresh", createdAtMs, null),
    ],
  };
}

/** A new connection's first tokens: an access token for an hour, and a refresh token for as long as the connection. */
export async function issueConnectedAppTokens(database: D1Database, apiKeyId: string): Promise<ConnectedAppTokens> {
  const { tokens, statements } = await newConnectedAppTokens(database, apiKeyId);
  await database.batch(statements);
  return tokens;
}

/**
 * Swap a refresh token for new tokens. Each refresh token works once (OAuth 2.1's rotation for public clients):
 * the old access tokens stop, and new ones are answered. A token swapped in the last REFRESH_TOKEN_REUSE_GRACE_SEC
 * is a retry race, refused as invalid with the connection kept; one swapped longer ago is reused, which only a
 * stolen copy does, and the caller removes the connection.
 */
export async function refreshConnectedApp(
  database: D1Database,
  refreshToken: string,
  mcpClientId: string,
): Promise<{ tokens: ConnectedAppTokens; key: Omit<ApiKey, "created_at_ms"> } | { refusal: "invalid" } | { refusal: "reused"; key: Omit<ApiKey, "created_at_ms"> }> {
  const found = await connectedAppForToken(database, refreshToken, "refresh");
  if (!found || found.mcp_client_id !== mcpClientId) return { refusal: "invalid" };
  const key = keyOfTokenRow(found);
  const rotatedAtMs = found.token_rotated_at_ms;
  if (rotatedAtMs !== null) return now() - rotatedAtMs <= REFRESH_TOKEN_REUSE_GRACE_SEC * 1000 ? { refusal: "invalid" } : { refusal: "reused", key };
  if (keyStateOf(key) !== "on") return { refusal: "invalid" };
  const tokenSha256 = await sha256Hex(new TextEncoder().encode(refreshToken));
  // Only one of two calls racing with the same token swaps it.
  const rotation = await database.prepare("UPDATE connected_app_tokens SET rotated_at_ms = ? WHERE token_sha256 = ? AND rotated_at_ms IS NULL").bind(now(), tokenSha256).run();
  if (rotation.meta.changes !== 1) return { refusal: "invalid" };
  const { tokens, statements } = await newConnectedAppTokens(database, key.id);
  await database.batch([database.prepare("DELETE FROM connected_app_tokens WHERE api_key_id = ? AND token_kind = 'access'").bind(key.id), ...statements]);
  return { tokens, key };
}

/** The account a key belongs to, or null (also null for a key that's turned off or ended). */
export async function accountForApiKey(database: D1Database, token: string): Promise<string | null> {
  const found = await apiKeyForToken(database, token);
  return found?.keyState === "on" ? found.key.account_id : null;
}

/**
 * Turn off the key a leaked token is: only when the whole token matches a key (never on the pattern alone), and
 * for good. Answers the key, or null when no key matches. A key already turned off is answered as it is, so the
 * same token sent twice changes nothing.
 */
export async function turnOffLeakedKey(
  database: D1Database,
  token: string,
  found: { foundIn: KeyFoundIn; foundAtUrl: string | null },
): Promise<{ key: Omit<ApiKey, "created_at_ms">; isNewlyTurnedOff: boolean } | null> {
  const row = await keyRowForToken(database, token);
  if (!row) return null;
  const turnedOffAtMs = now();
  const update = await database
    .prepare("UPDATE api_keys SET turned_off_at_ms = ?, found_in = ?, found_at_url = ? WHERE id = ? AND turned_off_at_ms IS NULL")
    .bind(turnedOffAtMs, found.foundIn, found.foundAtUrl, row.id)
    .run();
  const { secret_hash: _, ...key } = row;
  if (update.meta.changes === 0) return { key, isNewlyTurnedOff: false };
  return { key: { ...key, turned_off_at_ms: turnedOffAtMs, found_in: found.foundIn, found_at_url: found.foundAtUrl }, isNewlyTurnedOff: true };
}

// --- Game details --------------------------------------------------------------

export const VISIBILITIES: Visibility[] = ["draft", "listed", "unlisted", "private"];
export const DEVICES = ["phone", "tablet", "computer"] as const;
export const CONTROLS = ["touch", "keyboard_mouse", "gamepad"] as const;
export const SCREENS = ["portrait", "landscape", "either"] as const;
export const MAXIMUM_GAME_COUNT_PER_OWNER = 50;
export const PLAY_STYLES = ["co-op", "versus", "both"] as const;
/** The most players we name; more than that shows as "<n>+". */
export const MAXIMUM_PLAYER_COUNT = 1000;

/** One way to play, stored in games.play_modes and shown by the API as it is (docs/NAMING.md). */
export interface PlayMode {
  mode: "single" | "local" | "online";
  /** null for single. */
  minimum_player_count: number | null;
  /** null: no upper limit, shown as "<minimum>+ players", and for single. */
  maximum_player_count: number | null;
  play_style: (typeof PLAY_STYLES)[number] | null;
}

/** A game's play modes from its column, or null when the developer hasn't said. */
export function readPlayModes(json: string): PlayMode[] | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as PlayMode[];
  } catch {
    return null;
  }
}

/** Plain words for each way to play, like "Local co-op" and "2–4 players". */
export function describePlayModes(playModes: PlayMode[]): { mode: PlayMode["mode"]; label: string; playerCount: string | null }[] {
  const styleWords = (style: PlayMode["play_style"]) => (style === "both" ? "co-op and versus" : style);
  const playerCount = (playMode: PlayMode) =>
    playMode.maximum_player_count === null
      ? `${playMode.minimum_player_count}+ players`
      : playMode.minimum_player_count === playMode.maximum_player_count
        ? `${playMode.minimum_player_count} players`
        : `${playMode.minimum_player_count}–${playMode.maximum_player_count} players`;
  return playModes.map((playMode) =>
    playMode.mode === "single"
      ? { mode: "single", label: "Single-player", playerCount: null }
      : { mode: playMode.mode, label: `${playMode.mode === "local" ? "Local" : "Online"} ${styleWords(playMode.play_style)}`, playerCount: playerCount(playMode) },
  );
}

const PLAY_MODES_EXAMPLE = '[{ "mode": "single" }, { "mode": "online", "minimum_player_count": 2, "maximum_player_count": 4, "play_style": "co-op" }]';
const MODE_ORDER = ["single", "local", "online"] as const;

/** Why an input was refused, before it becomes an error answer: the input at fault, what happened and what to do. */
export interface InputProblem {
  field: string;
  message: string;
  fix: string;
  /** The error code, when it isn't bad_<field>. */
  code?: string;
}

/** Check play modes from the API: each mode once, in a fixed order, with every key. Returns them, null to clear, or what's wrong. */
function checkPlayModes(given: unknown): PlayMode[] | null | InputProblem {
  if (given === null) return null;
  if (!Array.isArray(given) || given.length === 0) {
    return { field: "play_modes", message: "play_modes isn't a list with at least one play mode.", fix: `Send a list like ${PLAY_MODES_EXAMPLE}, or null to clear it.` };
  }
  const playModes: PlayMode[] = [];
  for (const [i, givenPlayMode] of given.entries()) {
    const playMode = givenPlayMode as Partial<PlayMode> | null;
    if (!playMode || typeof playMode !== "object" || !MODE_ORDER.includes(playMode.mode as PlayMode["mode"])) {
      return { field: `play_modes[${i}].mode`, message: `play_modes[${i}] has no mode, or one that isn't single, local or online.`, fix: `Make each entry an object with its mode, like { "mode": "single" }: ${PLAY_MODES_EXAMPLE}.` };
    }
    if (playModes.some((other) => other.mode === playMode.mode)) return { field: `play_modes[${i}].mode`, message: `play_modes has ${playMode.mode} twice.`, fix: "List each mode once." };
    if (playMode.mode === "single") {
      if ((playMode.minimum_player_count ?? null) !== null || (playMode.maximum_player_count ?? null) !== null || (playMode.play_style ?? null) !== null) {
        return { field: `play_modes[${i}]`, message: "The single mode takes no player counts or play_style.", fix: 'Send it as { "mode": "single" }.' };
      }
      playModes.push({ mode: "single", minimum_player_count: null, maximum_player_count: null, play_style: null });
      continue;
    }
    const minimumPlayerCount = playMode.minimum_player_count;
    const maximumPlayerCount = playMode.maximum_player_count ?? null;
    const example = `{ "mode": "${playMode.mode}", "minimum_player_count": 2, "maximum_player_count": 4, "play_style": "co-op" }`;
    if (!Number.isInteger(minimumPlayerCount) || minimumPlayerCount! < 2 || minimumPlayerCount! > MAXIMUM_PLAYER_COUNT) {
      return { field: `play_modes[${i}].minimum_player_count`, message: `The ${playMode.mode} mode's minimum_player_count is missing or isn't a whole number from 2 to ${MAXIMUM_PLAYER_COUNT}.`, fix: `Give the fewest players it takes, 2 or more, like ${example}.` };
    }
    if (maximumPlayerCount !== null && (!Number.isInteger(maximumPlayerCount) || maximumPlayerCount < minimumPlayerCount! || maximumPlayerCount > MAXIMUM_PLAYER_COUNT)) {
      return { field: `play_modes[${i}].maximum_player_count`, message: `The ${playMode.mode} mode's maximum_player_count is under its minimum_player_count or isn't a whole number up to ${MAXIMUM_PLAYER_COUNT}.`, fix: "Give the most players it takes, at least the minimum, or null for no limit." };
    }
    if (!PLAY_STYLES.includes(playMode.play_style as (typeof PLAY_STYLES)[number])) {
      return { field: `play_modes[${i}].play_style`, message: `The ${playMode.mode} mode's play_style is missing or isn't co-op, versus or both.`, fix: `Give play_style: co-op (together), versus (against each other) or both, like ${example}.` };
    }
    playModes.push({ mode: playMode.mode!, minimum_player_count: minimumPlayerCount!, maximum_player_count: maximumPlayerCount, play_style: playMode.play_style! });
  }
  return playModes.sort((first, second) => MODE_ORDER.indexOf(first.mode) - MODE_ORDER.indexOf(second.mode));
}

/** A change to a game's details, in the games table's own names, so it's stored as it is. */
export interface DetailsChange {
  title?: string;
  description?: string;
  visibility?: Visibility;
  devices?: string[];
  controls?: string[];
  /** null: not set. */
  screen_orientation?: (typeof SCREENS)[number] | null;
  /** null clears it. */
  play_modes?: PlayMode[] | null;
  /** Copy signed-in players' browser saves to their account. Off for games that keep their own saves. */
  cloud_saves_enabled?: boolean;
  /** Show guests with progress the "Keep your progress" card. Off for games that offer accounts their own way. */
  account_offer_enabled?: boolean;
  /** Erase a player who deletes their Zaisma account from the game database. Off for games that must keep some of their rows. */
  deleted_account_erase_enabled?: boolean;
  /** Zaisma's Join (friends on zaisma.com, Zaisma.friends) takes players into its rooms. Off greys it as "This game doesn't take joins". */
  friend_joins_enabled?: boolean;
  room_browsing?: RoomBrowsing;
  /** none (guests welcome), multiplayer (guests play alone) or whole_game (accounts only). */
  account_requirement?: AccountRequirement;
  /** The youngest age that can play: 13, 16 or 18. Above 13 the game needs accounts for the whole game. */
  minimum_player_age_years?: MinimumPlayerAge;
  /** none, relay, or own (the game's zaisma-server.js in a sandbox on our rooms). */
  multiplayer_mode?: (typeof MULTIPLAYER_MODES)[number];
  /** The hosts its game server may call (game server reach), checked by checkAllowedHosts. */
  game_server_allowed_hosts?: string[];
  /** The game's own servers players' browsers connect to, checked by checkOwnServerUrls. */
  own_server_urls?: string[];
  /** Its registered links, the whole list, checked by checkLinks (and their sites by checkLinkSites). */
  links?: GameLink[];
}

/** Check a change from the API (docs/NAMING.md). Returns the tidied change or a plain error. */
export function checkDetails(input: Record<string, unknown>): { change: DetailsChange } | { problem: InputProblem } {
  const change: DetailsChange = {};
  const refuse = (field: string, message: string, fix: string) => ({ problem: { field, message, fix } });
  if ("title" in input) {
    const title = typeof input.title === "string" ? input.title.trim().replace(/\s+/g, " ") : "";
    if (!title || title.length > 80) return refuse("title", "title is empty or over 80 characters.", "Give a title of 1 to 80 characters.");
    change.title = title;
  }
  if ("description" in input) {
    if (typeof input.description !== "string" || input.description.trim().length > 500) return refuse("description", "description isn't text of up to 500 characters.", "Shorten it to 500 characters; it's shown on the game page.");
    change.description = input.description.trim();
  }
  if ("visibility" in input) {
    if (!VISIBILITIES.includes(input.visibility as Visibility)) {
      return refuse("visibility", `visibility ${JSON.stringify(input.visibility)} isn't one of the choices.`, "Give listed (on Zaisma for everyone), unlisted (only people with the link), or private or draft (only you and tester links).");
    }
    change.visibility = input.visibility as Visibility;
  }
  for (const [field, allowed] of [["devices", DEVICES], ["controls", CONTROLS]] as const) {
    if (!(field in input)) continue;
    const given = input[field];
    if (!Array.isArray(given) || !given.every((label) => typeof label === "string" && (allowed as readonly string[]).includes(label))) {
      return refuse(field, `${field} isn't a list of ${allowed.join(", ")}.`, `Send a list of any of: ${allowed.join(", ")}, like ["${allowed[0]}"].`);
    }
    change[field] = allowed.filter((label) => given.includes(label));
  }
  if ("screen_orientation" in input) {
    if (input.screen_orientation !== null && !SCREENS.includes(input.screen_orientation as (typeof SCREENS)[number])) {
      return refuse("screen_orientation", `screen_orientation ${JSON.stringify(input.screen_orientation)} isn't one of the choices.`, `Give one of ${SCREENS.join(", ")}, or null for not set.`);
    }
    change.screen_orientation = input.screen_orientation as (typeof SCREENS)[number] | null;
  }
  if ("play_modes" in input) {
    const playModes = checkPlayModes(input.play_modes);
    if (playModes && !Array.isArray(playModes)) return { problem: playModes };
    change.play_modes = playModes;
  }
  if ("cloud_saves_enabled" in input) {
    if (typeof input.cloud_saves_enabled !== "boolean") return refuse("cloud_saves_enabled", "cloud_saves_enabled isn't true or false.", "Send true (players' saves follow them to any device) or false (the game keeps its own saves).");
    change.cloud_saves_enabled = input.cloud_saves_enabled;
  }
  if ("account_offer_enabled" in input) {
    if (typeof input.account_offer_enabled !== "boolean") return refuse("account_offer_enabled", "account_offer_enabled isn't true or false.", "Send true (guests with progress get the \"Keep your progress\" card) or false (no card: the game offers accounts its own way).");
    change.account_offer_enabled = input.account_offer_enabled;
  }
  if ("deleted_account_erase_enabled" in input) {
    if (typeof input.deleted_account_erase_enabled !== "boolean") return refuse("deleted_account_erase_enabled", "deleted_account_erase_enabled isn't true or false.", "Send true (Zaisma erases a player who deletes their account from the game database: rows whose player_id is theirs) or false (you handle account_deleted events yourself).");
    change.deleted_account_erase_enabled = input.deleted_account_erase_enabled;
  }
  if ("friend_joins_enabled" in input) {
    const fix = "Send true (the default: friends' Join on zaisma.com takes players into this game's rooms) or false (Join shows greyed as \"This game doesn't take joins\"). One room turns it off with room.setFriendJoinsEnabled(false).";
    if (typeof input.friend_joins_enabled !== "boolean") return refuse("friend_joins_enabled", "friend_joins_enabled isn't true or false.", fix);
    change.friend_joins_enabled = input.friend_joins_enabled;
  }
  if ("room_browsing" in input) {
    if (!ROOM_BROWSING.includes(input.room_browsing as RoomBrowsing)) {
      return refuse("room_browsing", `room_browsing ${JSON.stringify(input.room_browsing)} isn't one of the choices.`, "Give page (open rooms listed on the game page and to the game), game (only to the game) or off.");
    }
    change.room_browsing = input.room_browsing as RoomBrowsing;
  }
  if ("account_requirement" in input) {
    if (!ACCOUNT_REQUIREMENTS.includes(input.account_requirement as AccountRequirement)) {
      return refuse("account_requirement", `account_requirement ${JSON.stringify(input.account_requirement)} isn't one of the choices.`, "Give none (guests play everything), multiplayer (guests play alone; only signed-in players get player passes) or whole_game (players sign in before Play).");
    }
    change.account_requirement = input.account_requirement as AccountRequirement;
  }
  if ("minimum_player_age_years" in input) {
    if (!MINIMUM_PLAYER_AGES.includes(input.minimum_player_age_years as MinimumPlayerAge)) {
      return { problem: { code: "bad_minimum_player_age", field: "minimum_player_age_years", message: `minimum_player_age_years ${JSON.stringify(input.minimum_player_age_years)} isn't 13, 16 or 18.`, fix: "Use 13, 16 or 18: the youngest age that can play." } };
    }
    change.minimum_player_age_years = input.minimum_player_age_years as MinimumPlayerAge;
  }
  if ("multiplayer_mode" in input) {
    if (!MULTIPLAYER_MODES.includes(input.multiplayer_mode as (typeof MULTIPLAYER_MODES)[number])) {
      return refuse("multiplayer_mode", `multiplayer_mode ${JSON.stringify(input.multiplayer_mode)} isn't one of the choices.`, "Give none (no Zaisma rooms), relay (Zaisma passes messages, no server code) or own (your game server from zaisma-server/).");
    }
    change.multiplayer_mode = input.multiplayer_mode as (typeof MULTIPLAYER_MODES)[number];
  }
  if ("game_server_allowed_hosts" in input) {
    const checked = checkAllowedHosts(input.game_server_allowed_hosts);
    if ("problem" in checked) return checked;
    change.game_server_allowed_hosts = checked.allowedHosts;
  }
  if ("own_server_urls" in input) {
    const checked = checkOwnServerUrls(input.own_server_urls);
    if ("problem" in checked) return checked;
    change.own_server_urls = checked.ownServerUrls;
  }
  if ("links" in input) {
    const checked = checkLinks(input.links);
    if ("problem" in checked) return checked;
    change.links = checked.links;
  }
  return { change };
}

/**
 * A game for 16 or 18 and up needs accounts for the whole game, since only accounts have an age
 * (docs/DECISIONS.md, "Games can keep out younger age bands"). A change that leaves the game above 13 and
 * names another account_requirement is refused with a fix; one that doesn't name it gets whole_game,
 * so a minimum alone works in one call. Lowering the minimum to 13 leaves account_requirement as it is.
 */
export function settleMinimumAge(game: Pick<Game, "minimum_player_age_years" | "account_requirement">, change: DetailsChange): { change: DetailsChange } | { problem: InputProblem } {
  const minimumPlayerAgeYears = change.minimum_player_age_years ?? game.minimum_player_age_years;
  if (minimumPlayerAgeYears <= 13) return { change };
  if (change.account_requirement !== undefined && change.account_requirement !== "whole_game") {
    return {
      problem: {
        code: "accounts_needed_for_minimum_age",
        field: "account_requirement",
        message: `account_requirement ${change.account_requirement} lets guests play, but the game is for ${minimumPlayerAgeYears} and up, and guests have no age.`,
        fix: "A game for 16 or 18 and up needs accounts for the whole game, since only accounts have an age. Set minimum_player_age_years to 13 first to let guests in.",
      },
    };
  }
  return { change: game.account_requirement === "whole_game" ? change : { ...change, account_requirement: "whole_game" } };
}

/** Players can already see this game, so new words on it wait for review. */
export function shownToPlayers(game: Game): boolean {
  return Boolean(game.live_version_id) && game.visibility !== "draft" && game.review_status !== "pending";
}

/**
 * Apply a change. A new title or description on a game players can see waits for review in
 * details_waiting_for_review; everything else applies straight away. Returns whether words are waiting.
 */
export async function applyDetails(database: D1Database, game: Game, change: DetailsChange): Promise<{ isWaitingForReview: boolean }> {
  const assignments: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, columnValue: unknown) => {
    assignments.push(`${column} = ?`);
    values.push(columnValue);
  };
  const words: { title?: string; description?: string } = {};
  if (change.title !== undefined && change.title !== game.title) words.title = change.title;
  if (change.description !== undefined && change.description !== game.description) words.description = change.description;
  let isWaitingForReview = false;
  if (Object.keys(words).length) {
    if (shownToPlayers(game)) {
      const waitingWords = { ...(game.details_waiting_for_review ? (JSON.parse(game.details_waiting_for_review) as object) : {}), ...words };
      set("details_waiting_for_review", JSON.stringify(waitingWords));
      isWaitingForReview = true;
    } else {
      if (words.title !== undefined) set("title", words.title);
      if (words.description !== undefined) set("description", words.description);
    }
  }
  if (change.visibility) set("visibility", change.visibility);
  if (change.devices) set("devices", change.devices.join(","));
  if (change.controls) set("controls", change.controls.join(","));
  if (change.screen_orientation !== undefined) set("screen_orientation", change.screen_orientation ?? "");
  if (change.play_modes !== undefined) set("play_modes", change.play_modes ? JSON.stringify(change.play_modes) : "");
  if (change.cloud_saves_enabled !== undefined) set("cloud_saves_enabled", change.cloud_saves_enabled ? 1 : 0);
  if (change.account_offer_enabled !== undefined) set("account_offer_enabled", change.account_offer_enabled ? 1 : 0);
  if (change.deleted_account_erase_enabled !== undefined) set("deleted_account_erase_enabled", change.deleted_account_erase_enabled ? 1 : 0);
  if (change.friend_joins_enabled !== undefined) set("friend_joins_enabled", change.friend_joins_enabled ? 1 : 0);
  if (change.room_browsing !== undefined) set("room_browsing", change.room_browsing);
  if (change.account_requirement !== undefined) set("account_requirement", change.account_requirement);
  if (change.minimum_player_age_years !== undefined) set("minimum_player_age_years", change.minimum_player_age_years);
  // A change that lets fewer people in ends every game entry handed out so far (game-access.ts).
  const isTightening = (change.minimum_player_age_years ?? 0) > game.minimum_player_age_years || (change.account_requirement === "whole_game" && game.account_requirement !== "whole_game");
  if (isTightening) set("entry_signing_key", randomKey(32));
  // Rooms running the old setting end within a minute, when they next check the game.
  if (change.multiplayer_mode !== undefined) set("multiplayer_mode", change.multiplayer_mode);
  // The gateway reads the list again within a minute (apps/rooms/src/outbound.ts).
  if (change.game_server_allowed_hosts !== undefined) set("game_server_allowed_hosts", JSON.stringify(change.game_server_allowed_hosts));
  // Players' next page load connects to them, and the game's menu names them.
  if (change.own_server_urls !== undefined) set("own_server_urls", JSON.stringify(change.own_server_urls));
  if (change.links !== undefined) {
    set("links", JSON.stringify(change.links));
    // A link whose site couldn't be checked yet puts the game first in line for the next check.
    set("links_checked_at_ms", change.links.every((link) => link.checked_at_ms !== null) ? now() : null);
  }
  if (assignments.length) {
    set("updated_at_ms", now());
    await database.prepare(`UPDATE games SET ${assignments.join(", ")} WHERE id = ?`).bind(...values, game.id).run();
  }
  // Rooms update their own rows when they next check in; turning listing off takes them off lists at once.
  if (change.room_browsing === "off") await database.prepare("UPDATE live_rooms SET is_listed = 0 WHERE game_id = ?").bind(game.id).run();
  return { isWaitingForReview };
}

/** Admin: accept or drop the words waiting for review. */
export async function settleDetailsWaitingForReview(database: D1Database, game: Game, accept: boolean): Promise<void> {
  const waitingWords = game.details_waiting_for_review ? (JSON.parse(game.details_waiting_for_review) as { title?: string; description?: string }) : {};
  await database
    .prepare("UPDATE games SET title = ?, description = ?, details_waiting_for_review = NULL, updated_at_ms = ? WHERE id = ?")
    .bind(accept ? (waitingWords.title ?? game.title) : game.title, accept ? (waitingWords.description ?? game.description) : game.description, now(), game.id)
    .run();
}

export async function gamesWithDetailsWaitingForReview(database: D1Database): Promise<Game[]> {
  const { results } = await database.prepare("SELECT * FROM games WHERE details_waiting_for_review IS NOT NULL ORDER BY updated_at_ms").all<Game>();
  return results;
}

// --- Covers and screenshots ------------------------------------------------------

/** cover: landscape, the game's card and picture. square: an optional second cover for phones. share: an optional picture for shared links, in place of the cover. */
export type ImageKind = "cover" | "square" | "screenshot" | "share";
export type ImageReviewStatus = "pending" | "approved" | "rejected";

/** A row of the game_images table: the same names the developer API shows. */
export interface GameImage {
  id: string;
  game_id: string;
  kind: ImageKind;
  content_type: string;
  width_px: number;
  height_px: number;
  size_bytes: number;
  review_status: ImageReviewStatus;
  /** Why a person didn't approve it, as JSON (a ReviewReason); NULL otherwise. */
  review_reason: string | null;
  created_at_ms: number;
}

export const IMAGE_LIMITS = { maximumSizeBytes: 5 * 1024 * 1024, minimumSidePx: 320, maximumSidePx: 8192, maximumScreenshotCount: 8, minimumSquareSidePx: 512 };

/** A square cover is as wide as it is tall, give or take 1%. */
export const isSquare = (widthPx: number, heightPx: number) => Math.abs(widthPx - heightPx) <= Math.max(widthPx, heightPx) * 0.01;

/** Where an image's file lives in the games bucket. */
export const imageKey = (image: Pick<GameImage, "game_id" | "id">) => `images/${image.game_id}/${image.id}`;
/** Where a picture's share card JPEG is kept once it's made (the site's /img/:id/card.jpg), deleted with the picture. */
export const cardImageKey = (image: Pick<GameImage, "game_id" | "id">) => `images/${image.game_id}/${image.id}.card.jpg`;
/** Where a cover or screenshot that matched known abuse material is kept for reporting. Never served or listed. */
export const heldImageKey = (gameId: string, id: string) => `held-images/${gameId}/${id}`;

/**
 * What an image really is, read from its bytes (never the name or the type it claims):
 * PNG, JPEG or WebP with its size, or null. SVG and everything else is refused.
 */
export function sniffImage(bytes: Uint8Array): { type: "image/png" | "image/jpeg" | "image/webp"; widthPx: number; heightPx: number } | null {
  const uint16BigEndian = (byteIndex: number) => (bytes[byteIndex]! << 8) | bytes[byteIndex + 1]!;
  const uint32BigEndian = (byteIndex: number) => ((bytes[byteIndex]! << 24) >>> 0) + (bytes[byteIndex + 1]! << 16) + (bytes[byteIndex + 2]! << 8) + bytes[byteIndex + 3]!;
  const uint24LittleEndian = (byteIndex: number) => bytes[byteIndex]! | (bytes[byteIndex + 1]! << 8) | (bytes[byteIndex + 2]! << 16);
  const ascii = (byteIndex: number, characterCount: number) => String.fromCharCode(...bytes.subarray(byteIndex, byteIndex + characterCount));
  if (bytes.length < 30) return null;

  if (bytes[0] === 0x89 && ascii(1, 3) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a && ascii(12, 4) === "IHDR") {
    return { type: "image/png", widthPx: uint32BigEndian(16), heightPx: uint32BigEndian(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    let byteIndex = 2;
    while (byteIndex + 9 < bytes.length) {
      if (bytes[byteIndex] !== 0xff) return null;
      const markerCode = bytes[byteIndex + 1]!;
      if (markerCode === 0xff) {
        byteIndex++;
        continue;
      }
      // Start-of-frame markers carry the size; C4, C8 and CC are other tables.
      if (markerCode >= 0xc0 && markerCode <= 0xcf && markerCode !== 0xc4 && markerCode !== 0xc8 && markerCode !== 0xcc) {
        return { type: "image/jpeg", widthPx: uint16BigEndian(byteIndex + 7), heightPx: uint16BigEndian(byteIndex + 5) };
      }
      byteIndex += 2 + uint16BigEndian(byteIndex + 2);
    }
    return null;
  }
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { type: "image/webp", widthPx: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff, heightPx: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff };
    }
    if (chunk === "VP8L" && bytes[20] === 0x2f) {
      const packedSizeNumber = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
      return { type: "image/webp", widthPx: (packedSizeNumber & 0x3fff) + 1, heightPx: ((packedSizeNumber >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { type: "image/webp", widthPx: uint24LittleEndian(24) + 1, heightPx: uint24LittleEndian(27) + 1 };
  }
  return null;
}

export async function addImage(database: D1Database, image: Omit<GameImage, "review_status" | "review_reason" | "created_at_ms">): Promise<GameImage> {
  const row: GameImage = { ...image, review_status: "pending", review_reason: null, created_at_ms: now() };
  await database
    .prepare("INSERT INTO game_images (id, game_id, kind, content_type, width_px, height_px, size_bytes, review_status, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(row.id, row.game_id, row.kind, row.content_type, row.width_px, row.height_px, row.size_bytes, row.review_status, row.created_at_ms)
    .run();
  return row;
}

export async function imageById(database: D1Database, id: string): Promise<GameImage | null> {
  return database.prepare("SELECT * FROM game_images WHERE id = ?").bind(id).first<GameImage>();
}

export async function imagesForGame(database: D1Database, gameId: string): Promise<GameImage[]> {
  const { results } = await database.prepare("SELECT * FROM game_images WHERE game_id = ? ORDER BY kind, created_at_ms").bind(gameId).all<GameImage>();
  return results;
}

export async function pendingImages(database: D1Database): Promise<(GameImage & { slug: string; title: string })[]> {
  const { results } = await database
    .prepare("SELECT game_images.*, games.slug, games.title FROM game_images JOIN games ON games.id = game_images.game_id WHERE game_images.review_status = 'pending' ORDER BY game_images.created_at_ms LIMIT 100")
    .all<GameImage & { slug: string; title: string }>();
  return results;
}

/**
 * Approve an image (rejectedReason null) or reject it, saying why. An approved cover (landscape or square) replaces the game's
 * old one of that kind; the old files to delete from storage are returned. Rejected files are kept, in case they need reporting.
 */
export async function settleImage(database: D1Database, image: GameImage, rejectedReason: ReviewReason | null): Promise<GameImage[]> {
  if (rejectedReason) {
    await database.prepare("UPDATE game_images SET review_status = 'rejected', review_reason = ? WHERE id = ?").bind(JSON.stringify(rejectedReason), image.id).run();
    return [];
  }
  const { results: replaced } =
    image.kind !== "screenshot"
      ? await database.prepare("SELECT * FROM game_images WHERE game_id = ? AND kind = ? AND review_status = 'approved' AND id != ?").bind(image.game_id, image.kind, image.id).all<GameImage>()
      : { results: [] as GameImage[] };
  await database.batch([
    database.prepare("UPDATE game_images SET review_status = 'approved' WHERE id = ?").bind(image.id),
    ...replaced.map((old) => database.prepare("DELETE FROM game_images WHERE id = ?").bind(old.id)),
  ]);
  return replaced;
}

export async function deleteImageRow(database: D1Database, id: string): Promise<void> {
  await database.prepare("DELETE FROM game_images WHERE id = ?").bind(id).run();
}
