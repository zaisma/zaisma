import { idKindInWords, idKindOf, isIdOf, newRandomPart, sha256Hex } from "./ids.ts";
import type { ReviewReason } from "./review.ts";
import { checkAllowedHosts } from "./reach.ts";
import { checkOwnServerUrls } from "./own-servers.ts";
import { checkLinks, type GameLink } from "./links.ts";
import { checkShownText } from "./shown-text.ts";
import { randomKey } from "./game-access.ts";
// The shader drawing the check, `zaisma check` and every runner share, kept with the upload command so it can draw a shader locally.
import {
  SHADER_BUFFER_NAMES,
  SHADER_HEAD,
  SHADER_LIMITS,
  SHADER_TEXTURE_BITMAP_OPTIONS,
  SHADER_VERTEX_SOURCE,
  shaderChannelSampling,
  shaderPassesInDrawOrder,
  shaderReadsQuality,
  shaderWithoutComments,
  wrapShader,
  wrapShaderBuffer,
  wrapShaderPass,
} from "../../cli/shader-check.mjs";
export { SHADER_BUFFER_NAMES, SHADER_HEAD, SHADER_LIMITS, SHADER_TEXTURE_BITMAP_OPTIONS, SHADER_VERTEX_SOURCE, shaderChannelSampling, shaderPassesInDrawOrder, shaderReadsQuality, shaderWithoutComments, wrapShader, wrapShaderBuffer, wrapShaderPass };
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
 *   purchase_access     items and purchases: read the items, settings, purchases and receipts. write: set and remove items, grant, refund
 *   forum_access        read: search and read. write: post, reply, vote, follow and message Zaisma, in the developer's name
 *   sign_in_app_access  Sign in with Zaisma apps (the whole account's)
 *   webhook_access      webhooks (the whole account's)
 *   credit_access       hosting credit (the whole account's). read: balance, top-ups and spending. write: also start a top-up,
 *                       refund one, and turn automatic top-up off or down (on or up needs the developer's passkey on zaisma.com)
 *   stripe_account_access  the Stripe account sales go to (the whole account's). read: whether it's connected and can take
 *                       payments. write: also turn Stripe Tax on or off, disconnect, and ask for a connection link (connecting
 *                       itself needs the developer's passkey on zaisma.com)
 */
export const AREA_ACCESS_CHOICES = {
  game_access: ["read", "write"],
  version_access: ["read", "upload", "publish"],
  stats_access: ["none", "read"],
  database_access: ["none", "read", "write"],
  save_access: ["none", "read", "write"],
  purchase_access: ["none", "read", "write"],
  forum_access: ["none", "read", "write"],
  sign_in_app_access: ["none", "read", "write"],
  webhook_access: ["none", "read", "write"],
  credit_access: ["none", "read", "write"],
  stripe_account_access: ["none", "read", "write"],
} as const satisfies Record<string, readonly string[]>;
export type AccessArea = keyof typeof AREA_ACCESS_CHOICES;
export type AreaAccess = { [Area in AccessArea]: (typeof AREA_ACCESS_CHOICES)[Area][number] };
export const ACCESS_AREAS = Object.keys(AREA_ACCESS_CHOICES) as AccessArea[];
/** Areas that belong to the whole account, not to games, so only keys for every game reach them. */
export const ACCOUNT_AREAS: readonly AccessArea[] = ["sign_in_app_access", "webhook_access", "credit_access", "stripe_account_access"];

/** The four fixed levels, the same words as the Teams roles, and custom: a choice per area. */
export const ACCESS_LEVELS = ["read", "upload", "publish", "full", "custom"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

/** What each fixed level gives. Read and upload keys read the forum but don't post in the developer's name. */
export const AREA_ACCESS_BY_LEVEL: Record<Exclude<AccessLevel, "custom">, AreaAccess> = {
  read: { game_access: "read", version_access: "read", stats_access: "read", database_access: "read", save_access: "read", purchase_access: "read", forum_access: "read", sign_in_app_access: "read", webhook_access: "read", credit_access: "read", stripe_account_access: "read" },
  upload: { game_access: "read", version_access: "upload", stats_access: "read", database_access: "read", save_access: "read", purchase_access: "read", forum_access: "read", sign_in_app_access: "read", webhook_access: "read", credit_access: "read", stripe_account_access: "read" },
  publish: { game_access: "write", version_access: "publish", stats_access: "read", database_access: "read", save_access: "read", purchase_access: "read", forum_access: "write", sign_in_app_access: "read", webhook_access: "read", credit_access: "read", stripe_account_access: "read" },
  full: { game_access: "write", version_access: "publish", stats_access: "read", database_access: "write", save_access: "write", purchase_access: "write", forum_access: "write", sign_in_app_access: "write", webhook_access: "write", credit_access: "write", stripe_account_access: "write" },
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
    return "Sign-in apps, webhooks, hosting credit and your Stripe account belong to your whole account, so only a key for all your games can reach them.";
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
/** The genres a game can pick, in a PC store's words, shown on Browse in this order. */
export const GENRES = ["action", "adventure", "role_playing", "shooter", "strategy", "simulation", "racing", "sports", "fighting", "platformer", "puzzle", "horror", "survival", "sandbox", "card_and_board", "party", "rhythm", "visual_novel"] as const;
export type Genre = (typeof GENRES)[number];
/** What pages show for each genre. */
export const GENRE_LABELS: Record<Genre, string> = {
  action: "Action", adventure: "Adventure", role_playing: "Role-playing", shooter: "Shooter", strategy: "Strategy", simulation: "Simulation",
  racing: "Racing", sports: "Sports", fighting: "Fighting", platformer: "Platformer", puzzle: "Puzzle", horror: "Horror", survival: "Survival",
  sandbox: "Sandbox", card_and_board: "Card and board", party: "Party", rhythm: "Rhythm", visual_novel: "Visual novel",
};
/** A game picks at most this many genres, so it can't sit in every filter. */
export const MAXIMUM_GENRE_COUNT = 3;
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
  /** Up to MAXIMUM_GENRE_COUNT of GENRES, in GENRES order. */
  genres?: Genre[];
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
  /** Zaisma's Join (friends on zaisma.com, Zaisma.friends) takes players into its rooms. Off grays it as "This game doesn't take joins". */
  friend_joins_enabled?: boolean;
  /** Zaisma measures how the game runs for its players (load time, frame rate, stutter, crashes), as totals for get_stats. */
  performance_measuring_enabled?: boolean;
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
  /** The color Zaisma tints its glass with over the game's background, #RRGGBB; null clears it. */
  glass_tint_color?: string | null;
}

/** Check a change from the API (docs/NAMING.md). Returns the tidied change or a plain error. */
export function checkDetails(input: Record<string, unknown>): { change: DetailsChange } | { problem: InputProblem } {
  const change: DetailsChange = {};
  const refuse = (field: string, message: string, fix: string) => ({ problem: { field, message, fix } });
  if ("title" in input) {
    const checked = checkShownText(input.title, { field: "title", maximumCharacterCount: 80, isRequired: true });
    if ("problem" in checked) return checked;
    change.title = checked.text;
  }
  if ("description" in input) {
    const checked = checkShownText(input.description, { field: "description", maximumCharacterCount: 500, isMultiline: true });
    if ("problem" in checked) return checked;
    change.description = checked.text;
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
  if ("genres" in input) {
    const given = input.genres === null ? [] : input.genres;
    const isGenreList = Array.isArray(given) && given.every((genre) => typeof genre === "string" && (GENRES as readonly string[]).includes(genre));
    if (!isGenreList || new Set(given).size !== given.length || given.length > MAXIMUM_GENRE_COUNT) {
      return refuse("genres", `genres isn't a list of up to ${MAXIMUM_GENRE_COUNT} of Zaisma's genres.`, `Send up to ${MAXIMUM_GENRE_COUNT} different ones of: ${GENRES.join(", ")}, like ["role_playing", "strategy"], or [] for none.`);
    }
    change.genres = GENRES.filter((genre) => (given as string[]).includes(genre));
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
    const fix = "Send true (the default: friends' Join on zaisma.com takes players into this game's rooms) or false (Join shows grayed as \"This game doesn't take joins\"). One room turns it off with room.setFriendJoinsEnabled(false).";
    if (typeof input.friend_joins_enabled !== "boolean") return refuse("friend_joins_enabled", "friend_joins_enabled isn't true or false.", fix);
    change.friend_joins_enabled = input.friend_joins_enabled;
  }
  if ("performance_measuring_enabled" in input) {
    const fix = "Send true (the default: Zaisma measures load time, frame rate, stutter and crashes in players' browsers, as totals in get_stats) or false (nothing of Zaisma's measures the game, and get_stats has performance null).";
    if (typeof input.performance_measuring_enabled !== "boolean") return refuse("performance_measuring_enabled", "performance_measuring_enabled isn't true or false.", fix);
    change.performance_measuring_enabled = input.performance_measuring_enabled;
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
  if ("glass_tint_color" in input) {
    if (input.glass_tint_color !== null && !isGlassTintColor(input.glass_tint_color)) {
      return { problem: { code: "bad_color", field: "glass_tint_color", message: `glass_tint_color ${JSON.stringify(input.glass_tint_color)} isn't a color like "#6b3fa0".`, fix: 'Give a color as # and six hex digits, like "#6b3fa0", or null for no tint.' } };
    }
    change.glass_tint_color = input.glass_tint_color === null ? null : (input.glass_tint_color as string).toLowerCase();
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
    // New words go through the listing check ("No slop"), shown or not.
    set("listing_check_requested_at_ms", now());
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
  if (change.genres) set("genres", change.genres.join(","));
  if (change.screen_orientation !== undefined) set("screen_orientation", change.screen_orientation ?? "");
  if (change.play_modes !== undefined) set("play_modes", change.play_modes ? JSON.stringify(change.play_modes) : "");
  if (change.cloud_saves_enabled !== undefined) set("cloud_saves_enabled", change.cloud_saves_enabled ? 1 : 0);
  if (change.account_offer_enabled !== undefined) set("account_offer_enabled", change.account_offer_enabled ? 1 : 0);
  if (change.deleted_account_erase_enabled !== undefined) set("deleted_account_erase_enabled", change.deleted_account_erase_enabled ? 1 : 0);
  if (change.friend_joins_enabled !== undefined) set("friend_joins_enabled", change.friend_joins_enabled ? 1 : 0);
  if (change.performance_measuring_enabled !== undefined) set("performance_measuring_enabled", change.performance_measuring_enabled ? 1 : 0);
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
  if (change.glass_tint_color !== undefined) set("glass_tint_color", change.glass_tint_color);
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

/**
 * cover: landscape, the game's card and picture. square: an optional second cover for phones. share: an optional picture for shared links, in place of the cover.
 * background and phone_background: the game's world behind Zaisma's glass, on wide screens and on phones (Backgrounds, below), with no title on it.
 * shader_texture: a picture a background shader reads through a channel (ShaderManifest, below); image matching checks it like any
 * picture, and what the shader draws with it is checked in the shader's frames, so it gets no listing check of its own.
 */
export type ImageKind = "cover" | "square" | "screenshot" | "share" | "background" | "phone_background" | "shader_texture";
export const IMAGE_KINDS: readonly ImageKind[] = ["cover", "square", "screenshot", "share", "background", "phone_background", "shader_texture"];
/** Kinds a game keeps several of, so a new one never replaces an older one when it's approved. */
export const MANY_IMAGE_KINDS: readonly ImageKind[] = ["screenshot", "shader_texture"];
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
  /** Why it wasn't approved, as JSON (a ReviewReason); NULL otherwise. */
  review_reason: string | null;
  /** Why it keeps the game off lists ("No slop"), or held it (fake_reward), as JSON (a ReviewReason); NULL when none. */
  listing_reason: string | null;
  /** When a person cleared it: the listing check leaves it alone after. */
  cleared_at_ms: number | null;
  /** Its tone, for a background (0116): its average color (#RRGGBB), whether the glass over it is smoked, and how strong the glass's tint is; NULL until measured. */
  average_color: string | null;
  is_glass_smoked: number | null;
  glass_tint_pct: number | null;
  created_at_ms: number;
}

/**
 * A game Zaisma's lists may show ("No slop" in docs/DECISIONS.md): nothing the listing check found keeps it off,
 * on the title or on a cover, square cover or share picture that isn't rejected. A WHERE fragment on `games`; the
 * list's own query adds that it's live and listed. Developer profiles and links don't use it.
 */
export const SHOWN_IN_LISTS_SQL =
  "games.title_listing_reason IS NULL AND NOT EXISTS (SELECT 1 FROM game_images WHERE game_images.game_id = games.id AND game_images.kind != 'screenshot' AND game_images.review_status != 'rejected' AND game_images.listing_reason IS NOT NULL)";

/** The same as SHOWN_IN_LISTS_SQL, for a game and its images in hand, with whether it's live and listed. */
export function isShownInLists(game: Pick<Game, "review_status" | "visibility" | "live_version_id" | "title_listing_reason">, images: Pick<GameImage, "kind" | "review_status" | "listing_reason">[]): boolean {
  if (game.review_status !== "live" || game.visibility !== "listed" || !game.live_version_id || game.title_listing_reason) return false;
  return !images.some((image) => image.kind !== "screenshot" && image.review_status !== "rejected" && image.listing_reason);
}

/** Ask for the listing check on a game (a picture or its words changed); the queue and the cron run it. */
export async function requestListingCheck(database: D1Database, gameId: string): Promise<void> {
  await database.prepare("UPDATE games SET listing_check_requested_at_ms = ? WHERE id = ?").bind(now(), gameId).run();
}

export const IMAGE_LIMITS = {
  maximumSizeBytes: 5 * 1024 * 1024,
  minimumSidePx: 320,
  maximumSidePx: 8192,
  maximumScreenshotCount: 8,
  minimumSquareSidePx: 512,
  /** A background fills a screen, so its long side is at least this. */
  minimumBackgroundLongSidePx: 1600,
  /** A wide background's width ÷ height. */
  minimumWideBackgroundRatio: 1.3,
  maximumWideBackgroundRatio: 2.4,
  /** A phone background's height ÷ width. */
  minimumPhoneBackgroundRatio: 1.6,
  maximumPhoneBackgroundRatio: 2.4,
};

/** Whether a background picture has its screen's shape: landscape for wide, portrait for phones, and big enough to fill it. */
export function isBackgroundShape(kind: "background" | "phone_background", widthPx: number, heightPx: number): boolean {
  if (Math.max(widthPx, heightPx) < IMAGE_LIMITS.minimumBackgroundLongSidePx) return false;
  if (kind === "background") return widthPx / heightPx >= IMAGE_LIMITS.minimumWideBackgroundRatio && widthPx / heightPx <= IMAGE_LIMITS.maximumWideBackgroundRatio;
  return heightPx / widthPx >= IMAGE_LIMITS.minimumPhoneBackgroundRatio && heightPx / widthPx <= IMAGE_LIMITS.maximumPhoneBackgroundRatio;
}

/** A square cover is as wide as it is tall, give or take 1%. */
export const isSquare = (widthPx: number, heightPx: number) => Math.abs(widthPx - heightPx) <= Math.max(widthPx, heightPx) * 0.01;

/** Where an image's file lives in the games bucket. */
export const imageKey = (image: Pick<GameImage, "game_id" | "id">) => `images/${image.game_id}/${image.id}`;
/** Where a picture's share card JPEG is kept once it's made (the site's /img/:id/card.jpg), deleted with the picture. */
export const cardImageKey = (image: Pick<GameImage, "game_id" | "id">) => `images/${image.game_id}/${image.id}.card.jpg`;

/**
 * The widths an approved picture is also kept at, as WebP made from it the first time a page asks (/img/<id>/w<width>.webp), so a page
 * downloads the size it shows: a cover on a phone, a wide screen's background. Never wider than the picture itself.
 */
export const SIZED_IMAGE_WIDTHS_PX = [320, 480, 640, 960, 1440, 1920] as const;
export const sizedImageKey = (image: Pick<GameImage, "game_id" | "id">, widthPx: number) => `images/${image.game_id}/${image.id}.w${widthPx}.webp`;
/** Every copy kept of a picture besides itself: its share card and its sizes, deleted with it. */
export const imageCopyKeys = (image: Pick<GameImage, "game_id" | "id">): string[] => [cardImageKey(image), ...SIZED_IMAGE_WIDTHS_PX.map((widthPx) => sizedImageKey(image, widthPx))];
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

export async function addImage(database: D1Database, image: Omit<GameImage, "review_status" | "review_reason" | "listing_reason" | "cleared_at_ms" | "created_at_ms" | keyof BackgroundTone>): Promise<GameImage> {
  const row: GameImage = { ...image, review_status: "pending", review_reason: null, listing_reason: null, cleared_at_ms: null, average_color: null, is_glass_smoked: null, glass_tint_pct: null, created_at_ms: now() };
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
 * Approve an image (rejectedReason null) or reject it, saying why. An approved cover (landscape, square or share) replaces the game's
 * old one of that kind; the old files to delete from storage are returned. Rejected files are kept, in case they need reporting.
 * `decidedBy` "person" also clears it, so the listing check leaves it alone; "check" keeps the check's listing_reason.
 */
export async function settleImage(database: D1Database, image: GameImage, rejectedReason: ReviewReason | null, decidedBy: "person" | "check" = "person", listingReason: ReviewReason | null = null): Promise<GameImage[]> {
  if (rejectedReason) {
    await database.batch([
      database.prepare("UPDATE game_images SET review_status = 'rejected', review_reason = ?, listing_reason = NULL WHERE id = ?").bind(JSON.stringify(rejectedReason), image.id),
      // A rejected background stops showing: its screen goes back to its default.
      database.prepare("DELETE FROM game_backgrounds WHERE game_id = ? AND image_id = ?").bind(image.game_id, image.id),
    ]);
    return [];
  }
  const { results: replaced } =
    !MANY_IMAGE_KINDS.includes(image.kind)
      ? await database.prepare("SELECT * FROM game_images WHERE game_id = ? AND kind = ? AND review_status = 'approved' AND id != ?").bind(image.game_id, image.kind, image.id).all<GameImage>()
      : { results: [] as GameImage[] };
  await database.batch([
    decidedBy === "person"
      ? database.prepare("UPDATE game_images SET review_status = 'approved', listing_reason = NULL, cleared_at_ms = ? WHERE id = ?").bind(now(), image.id)
      : database.prepare("UPDATE game_images SET review_status = 'approved', listing_reason = ? WHERE id = ?").bind(listingReason ? JSON.stringify(listingReason) : null, image.id),
    ...replaced.map((old) => database.prepare("DELETE FROM game_images WHERE id = ?").bind(old.id)),
    // A background chosen for its screen hands its place to the one replacing it, checked the same way.
    ...replaced.map((old) => database.prepare("UPDATE game_backgrounds SET image_id = ?, updated_at_ms = ? WHERE game_id = ? AND source = 'image' AND image_id = ?").bind(image.id, now(), image.game_id, old.id)),
  ]);
  return replaced;
}

export async function deleteImageRow(database: D1Database, id: string): Promise<void> {
  await database.prepare("DELETE FROM game_images WHERE id = ?").bind(id).run();
}

// --- Backgrounds -------------------------------------------------------------------

/**
 * A game's background, behind Zaisma's glass on the home (while the game is in focus) and on its game page: one for wide screens
 * (desktops and tablets) and one for phones. Each shows a picture (an image of kind background or phone_background), a shader, or
 * Zaisma's own; phone can also follow wide, which it does until it's set. Choosing is its own step (setBackground), so the
 * developer sees a shader's check and previews it before it shows anywhere.
 */
export type BackgroundScreen = "wide" | "phone";
export const BACKGROUND_SCREENS: readonly BackgroundScreen[] = ["wide", "phone"];
/** zaisma: Zaisma's own background. image and shader: the game's own, by its ID. wide: phones show the wide one (phone only). */
export type BackgroundSource = "zaisma" | "image" | "shader" | "wide";
export const BACKGROUND_SOURCES: readonly BackgroundSource[] = ["zaisma", "image", "shader", "wide"];
/** The image kind each screen's pictures are. */
export const BACKGROUND_IMAGE_KINDS: Record<BackgroundScreen, "background" | "phone_background"> = { wide: "background", phone: "phone_background" };

/** A row of the game_shaders table: the same names the developer API shows. */
export interface GameShader {
  id: string;
  game_id: string;
  screen: BackgroundScreen;
  /** Its passes' sources together. */
  size_bytes: number;
  review_status: ImageReviewStatus;
  /** Why it wasn't approved, as JSON (a ReviewReason); NULL otherwise. */
  review_reason: string | null;
  /** What the check measured at each quality level it timed, as JSON (ShaderQualityCheck[], readQualityChecks); NULL until it ran. It replaced check_frame_ms (0134), which nothing reads. */
  quality_checks: string | null;
  /** The most flashes the check counted in any one second; NULL until it ran. */
  flash_count: number | null;
  checked_at_ms: number | null;
  /** How many buffers it has, and how many textures its channels name (0134). */
  buffer_count: number;
  texture_count: number;
  /** Its tone, for a background (0116): its average color (#RRGGBB), whether the glass over it is smoked, and how strong the glass's tint is; NULL until measured. */
  average_color: string | null;
  is_glass_smoked: number | null;
  glass_tint_pct: number | null;
  created_at_ms: number;
}

/** A row of the game_backgrounds table, or the default a screen has without one. */
export interface GameBackground {
  game_id: string;
  screen: BackgroundScreen;
  source: BackgroundSource;
  image_id: string | null;
  shader_id: string | null;
  updated_at_ms: number | null;
}

/**
 * Shaders: Shadertoy's form, `void mainImage(out vec4 fragColor, in vec2 fragCoord)`, in WebGL2's GLSL (GLSL ES 3.00), so most
 * Shadertoy shaders paste in and run: an image pass, up to four buffers that keep their picture between frames (Shadertoy's Buffers A
 * to D) and up to four textures the developer sends, read through iChannel0 to iChannel3 (ShaderManifest). One shader serves every
 * device: it reads iQuality (0 for phones and slow devices, 1, 2 for desktops), and the check holds each level to its own time.
 * The check draws it before anyone sees it; players' browsers draw it at fewer pixels and at most 30 frames a second, stepping down a
 * level, then to fewer pixels, then holding a still frame, on a device that can't keep up. SHADER_LIMITS and the drawing live in
 * packages/cli/shader-check.mjs, shared with `zaisma check`.
 */

/** What the check measured at one quality level: its median frame, scaled to the renderer's speed, against that level's most. */
export interface ShaderQualityCheck {
  quality_level: number;
  check_frame_ms: number;
  maximum_check_frame_ms: number;
}

/** A shader's quality checks as its row keeps them; [] until the check ran. */
export function readQualityChecks(stored: string | null): ShaderQualityCheck[] {
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored) as unknown;
    return Array.isArray(parsed) ? (parsed as ShaderQualityCheck[]) : [];
  } catch {
    return [];
  }
}

/** Buffers A to D, as a shader names them. */
export type ShaderBufferName = "a" | "b" | "c" | "d";
/** What a channel reads: one of the shader's buffers, or one of the game's pictures of kind shader_texture. */
export type ShaderChannelInputKind = "buffer" | "texture";
export const SHADER_CHANNEL_INPUT_KINDS: readonly ShaderChannelInputKind[] = ["buffer", "texture"];
/** linear: smooth (a texture's with mipmaps, for noise and painted pictures). nearest: each texel as it is. */
export type ShaderChannelFilter = "linear" | "nearest";
export const SHADER_CHANNEL_FILTERS: readonly ShaderChannelFilter[] = ["linear", "nearest"];
/** clamp: the edge's texel goes on past the edge. repeat: the picture tiles. */
export type ShaderChannelWrap = "clamp" | "repeat";
export const SHADER_CHANNEL_WRAPS: readonly ShaderChannelWrap[] = ["clamp", "repeat"];

/** One iChannel of a pass: the same names the developer API takes and shows. */
export interface ShaderChannel {
  /** 0 to 3: iChannel0 to iChannel3. */
  channel_index: number;
  input_kind: ShaderChannelInputKind;
  /** The buffer it reads, with input_kind buffer; null otherwise. A buffer reading itself, or one drawn after it, gets that buffer's last frame. */
  buffer_name: ShaderBufferName | null;
  /** The picture it reads, with input_kind texture: an approved shader_texture of the game; null otherwise. */
  image_id: string | null;
  filter: ShaderChannelFilter;
  wrap: ShaderChannelWrap;
}
/** One pass: its mainImage, and what its channels read. */
export interface ShaderPass {
  source: string;
  channels: ShaderChannel[];
}
export interface ShaderBuffer extends ShaderPass {
  buffer_name: ShaderBufferName;
}
/**
 * A whole shader, as the API takes it and the games bucket keeps it (shaderManifestKey): the image pass, which draws the background,
 * and up to four buffers, each drawn to a picture kept between frames. Each frame the runner draws the buffers in order (a to d), then
 * the image pass. The image pass's source is also kept alone (shaderKey), the shader's source_url.
 */
export interface ShaderManifest {
  image: ShaderPass;
  buffers: ShaderBuffer[];
}

/** A shader sent before buffers and textures (0134): its one pass, with no channels. */
export const shaderManifestFromSource = (source: string): ShaderManifest => ({ image: { source, channels: [] }, buffers: [] });

/** One pass as a runner draws it, in order: bufferName null is the image pass, drawn last onto the canvas. */
export interface ShaderDrawPass {
  bufferName: ShaderBufferName | null;
  source: string;
  channels: ShaderChannel[];
}

/** The pictures a shader's channels read, each once, in the order they first come. */
export function shaderTextureImageIds(manifest: ShaderManifest): string[] {
  const ids: string[] = [];
  for (const pass of shaderPassesInDrawOrder(manifest)) for (const channel of pass.channels) if (channel.image_id && !ids.includes(channel.image_id)) ids.push(channel.image_id);
  return ids;
}

/** A buffer's picture: half floats where the browser can draw to them (EXT_color_buffer_float), else 8 bits a channel. */
export const SHADER_BUFFER_FORMATS = {
  float: { internalFormatName: "RGBA16F", formatName: "RGBA", typeName: "HALF_FLOAT" },
  fallback: { internalFormatName: "RGBA8", formatName: "RGBA", typeName: "UNSIGNED_BYTE" },
};

/** Where a shader's image pass's source lives in the games bucket, with its manifest, still and sampled frames beside it. */
export const shaderKey = (gameId: string, id: string) => `shaders/${gameId}/${id}.glsl`;
export const shaderManifestKey = (gameId: string, id: string) => `shaders/${gameId}/${id}.json`;
export const shaderStillKey = (gameId: string, id: string) => `shaders/${gameId}/${id}.still.png`;
export const shaderFrameKey = (gameId: string, id: string, frameIndex: number) => `shaders/${gameId}/${id}.frame-${frameIndex}.png`;
/** Every key a shader has in the games bucket. */
export const shaderKeys = (gameId: string, id: string) => [shaderKey(gameId, id), shaderManifestKey(gameId, id), shaderStillKey(gameId, id), ...Array.from({ length: SHADER_LIMITS.sampledFrameCount }, (_, frameIndex) => shaderFrameKey(gameId, id, frameIndex))];

/** What's wrong with one pass's text before it's drawn, or null: Shadertoy's mainImage, with nothing a runner doesn't give it. */
export function shaderSourceProblem(source: string): string | null {
  const code = shaderWithoutComments(source);
  if (!/\bvoid\s+mainImage\s*\(/.test(code)) return "It has no mainImage function: void mainImage(out vec4 fragColor, in vec2 fragCoord).";
  if (/^\s*#\s*version\b/m.test(code)) return "It has a #version line; Zaisma gives the shader its own (WebGL2's #version 300 es).";
  if (/^\s*#\s*extension\b/m.test(code)) return "It has an #extension line; shaders get no extensions.";
  if (/\bvoid\s+main\s*\(/.test(code) || /\bgl_FragColor\b/.test(code)) return "It has its own main() or writes gl_FragColor; Zaisma writes main() round mainImage, which writes fragColor.";
  if (/\btexture2D\w*\s*\(/.test(code)) return "It calls texture2D, WebGL1's name; WebGL2's GLSL calls it texture.";
  if (/\biMouse\b/.test(code)) return "It reads iMouse; backgrounds get no mouse.";
  if (/\b(iChannelTime|iSampleRate)\b/.test(code)) return "It reads iChannelTime or iSampleRate; backgrounds get no sound or video, only buffers and textures.";
  return null;
}

/**
 * Checks a shader as the API takes it: { image: { source, channels }, buffers: [{ buffer_name, source, channels }] }, closed all the
 * way down. Each channel names a buffer the shader has or a picture by its ID (the API checks it's an approved shader_texture of the
 * game). Returns the shader with every default filled in, or what's wrong.
 */
export function checkShaderManifest(given: { image?: unknown; buffers?: unknown }): ShaderManifest | InputProblem {
  if (given.image === undefined || given.image === null) return { code: "missing_field", field: "image", message: "image is missing: the shader's image pass.", fix: SHADER_IMAGE_FIX };
  if (given.buffers !== undefined && given.buffers !== null && !Array.isArray(given.buffers)) return { code: "bad_buffers", field: "buffers", message: "buffers isn't a list.", fix: SHADER_BUFFERS_FIX };
  const givenBuffers = (given.buffers ?? []) as unknown[];
  if (givenBuffers.length > SHADER_LIMITS.maximumBufferCount) return { code: "too_many_buffers", field: "buffers", message: `The shader has ${givenBuffers.length} buffers; the most is ${SHADER_LIMITS.maximumBufferCount}.`, fix: "Use buffers a to d at most; one buffer's four channels (red, green, blue, alpha) can carry more than one value." };
  const bufferNames: ShaderBufferName[] = [];
  for (const [bufferIndex, givenBuffer] of givenBuffers.entries()) {
    const name = isPlainObject(givenBuffer) ? givenBuffer.buffer_name : undefined;
    if (!SHADER_BUFFER_NAMES.includes(name as ShaderBufferName) || bufferNames.includes(name as ShaderBufferName)) {
      return { code: "bad_buffers", field: `buffers[${bufferIndex}].buffer_name`, message: isPlainObject(givenBuffer) ? `buffers[${bufferIndex}]'s buffer_name ${JSON.stringify(name ?? null)} isn't a, b, c or d${bufferNames.includes(name as ShaderBufferName) ? " the shader hasn't used already" : ""}.` : `buffers[${bufferIndex}] isn't an object.`, fix: SHADER_BUFFERS_FIX };
    }
    bufferNames.push(name as ShaderBufferName);
  }
  const image = checkShaderPass(given.image, "image", null, bufferNames);
  if ("field" in image) return image;
  const buffers: ShaderBuffer[] = [];
  for (const [bufferIndex, givenBuffer] of givenBuffers.entries()) {
    const pass = checkShaderPass(givenBuffer, `buffers[${bufferIndex}]`, bufferNames[bufferIndex]!, bufferNames);
    if ("field" in pass) return pass;
    buffers.push({ buffer_name: bufferNames[bufferIndex]!, ...pass });
  }
  const manifest: ShaderManifest = { image, buffers };
  const textureIds = shaderTextureImageIds(manifest);
  if (textureIds.length > SHADER_LIMITS.maximumShaderTextureCount) {
    return { code: "too_many_shader_textures", field: "image.channels", message: `The shader's channels name ${textureIds.length} textures; a shader reads up to ${SHADER_LIMITS.maximumShaderTextureCount}.`, fix: "Name at most 4 different textures across the image pass and its buffers; several channels can read the same one." };
  }
  return manifest;
}

const SHADER_SOURCE_FIX = "Send Shadertoy's form in WebGL2's GLSL: helper functions, then void mainImage(out vec4 fragColor, in vec2 fragCoord), with no main(), #version or #extension lines. It reads iResolution, iTime, iTimeDelta, iFrame, iQuality, iChannel0 to iChannel3, iChannelResolution and iGlassPanes.";
const SHADER_IMAGE_FIX = `Send image: { "source": "void mainImage(out vec4 fragColor, in vec2 fragCoord) { … }", "channels": [] }. ${SHADER_SOURCE_FIX}`;
const SHADER_BUFFERS_FIX = 'Send buffers as a list of up to 4, each { "buffer_name": "a", "source": "void mainImage(…) { … }", "channels": [] }, buffer_name a, b, c or d, each once; or leave buffers out.';
const SHADER_CHANNEL_FIX =
  'Give each channel { "channel_index": 0, "input_kind": "buffer", "buffer_name": "a" } or { "channel_index": 1, "input_kind": "texture", "image_id": "image_…" }, optionally with "filter" (linear or nearest) and "wrap" (clamp or repeat); channel_index 0 to 3, each once in a pass.';
const SHADER_PASS_FIELDS = ["source", "channels"];
const SHADER_CHANNEL_FIELDS = ["channel_index", "input_kind", "buffer_name", "image_id", "filter", "wrap"];

const isPlainObject = (given: unknown): given is Record<string, unknown> => typeof given === "object" && given !== null && !Array.isArray(given);

/** One pass of a shader: its source and channels, checked. bufferName null is the image pass. */
function checkShaderPass(given: unknown, field: string, bufferName: ShaderBufferName | null, bufferNames: ShaderBufferName[]): ShaderPass | InputProblem {
  if (!isPlainObject(given)) return bufferName === null ? { code: "not_a_shader", field, message: "image isn't an object with the pass's source and channels.", fix: SHADER_IMAGE_FIX } : { code: "bad_buffers", field, message: `${field} isn't an object.`, fix: SHADER_BUFFERS_FIX };
  const fields = bufferName === null ? SHADER_PASS_FIELDS : ["buffer_name", ...SHADER_PASS_FIELDS];
  const unknown = Object.keys(given).find((key) => !fields.includes(key));
  if (unknown !== undefined) return { code: "unknown_field", field: `${field}.${unknown}`, message: `${unknown} isn't a field of ${bufferName === null ? "the image pass" : "a buffer"}.`, fix: `Leave it out. ${bufferName === null ? "The image pass" : "A buffer"} takes: ${fields.join(", ")}.` };
  const source = given.source;
  if (typeof source !== "string" || !source.trim()) return { code: "not_a_shader", field: `${field}.source`, message: `${field}.source isn't the pass's GLSL text.`, fix: SHADER_SOURCE_FIX };
  if (new TextEncoder().encode(source).byteLength > SHADER_LIMITS.maximumPassSizeBytes) {
    return { code: "shader_too_big", field: `${field}.source`, message: `${field}.source is over ${SHADER_LIMITS.maximumPassSizeBytes / 1024} KB.`, fix: "Take out unused functions and long comments, or move work into a buffer of its own (each pass gets 64 KB)." };
  }
  const problem = shaderSourceProblem(source);
  if (problem) return { code: "not_a_shader", field: `${field}.source`, message: `${field}.source isn't a background shader's pass: ${problem}`, fix: SHADER_SOURCE_FIX };
  if (given.channels !== undefined && given.channels !== null && !Array.isArray(given.channels)) return { code: "bad_shader_channel", field: `${field}.channels`, message: `${field}.channels isn't a list.`, fix: SHADER_CHANNEL_FIX };
  const givenChannels = (given.channels ?? []) as unknown[];
  if (givenChannels.length > SHADER_LIMITS.maximumChannelCount) return { code: "bad_shader_channel", field: `${field}.channels`, message: `${field} has ${givenChannels.length} channels; a pass has iChannel0 to iChannel3.`, fix: SHADER_CHANNEL_FIX };
  const channels: ShaderChannel[] = [];
  for (const [channelIndex, givenChannel] of givenChannels.entries()) {
    const channelField = `${field}.channels[${channelIndex}]`;
    const channel = checkShaderChannel(givenChannel, channelField, bufferNames);
    if ("field" in channel) return channel;
    if (channels.some((other) => other.channel_index === channel.channel_index)) return { code: "bad_shader_channel", field: `${channelField}.channel_index`, message: `${field} has channel_index ${channel.channel_index} twice.`, fix: SHADER_CHANNEL_FIX };
    channels.push(channel);
  }
  return { source, channels };
}

function checkShaderChannel(given: unknown, field: string, bufferNames: ShaderBufferName[]): ShaderChannel | InputProblem {
  const refuse = (refusedField: string, message: string): InputProblem => ({ code: "bad_shader_channel", field: refusedField, message, fix: SHADER_CHANNEL_FIX });
  if (!isPlainObject(given)) return refuse(field, `${field} isn't an object.`);
  const unknown = Object.keys(given).find((key) => !SHADER_CHANNEL_FIELDS.includes(key));
  if (unknown !== undefined) return { code: "unknown_field", field: `${field}.${unknown}`, message: `${unknown} isn't a field of a channel.`, fix: `Leave it out. A channel takes: ${SHADER_CHANNEL_FIELDS.join(", ")}.` };
  const channelIndex = given.channel_index;
  if (typeof channelIndex !== "number" || !Number.isInteger(channelIndex) || channelIndex < 0 || channelIndex >= SHADER_LIMITS.maximumChannelCount) return refuse(`${field}.channel_index`, `${field}.channel_index isn't 0, 1, 2 or 3.`);
  const inputKind = given.input_kind as ShaderChannelInputKind;
  if (!SHADER_CHANNEL_INPUT_KINDS.includes(inputKind)) return refuse(`${field}.input_kind`, `${field}.input_kind ${JSON.stringify(given.input_kind ?? null)} isn't buffer or texture.`);
  const bufferName = given.buffer_name ?? null;
  const imageId = given.image_id ?? null;
  if (inputKind === "buffer") {
    if (!bufferNames.includes(bufferName as ShaderBufferName)) {
      return refuse(`${field}.buffer_name`, bufferName === null ? `${field} reads a buffer but names none.` : `${field} reads buffer ${JSON.stringify(bufferName)}, which the shader doesn't have${bufferNames.length ? ` (it has ${bufferNames.join(", ")})` : ""}.`);
    }
    if (imageId !== null) return refuse(`${field}.image_id`, `${field} reads a buffer, so it takes no image_id.`);
  } else {
    if (typeof imageId !== "string" || !isIdOf("image", imageId)) {
      const sentKind = typeof imageId === "string" ? idKindOf(imageId) : null;
      if (sentKind) return { code: "wrong_id_kind", field: `${field}.image_id`, message: `That's ${idKindInWords(sentKind)}; ${field}.image_id takes an image ID.`, fix: "get_game lists the game's images: add_image with kind shader_texture sends a texture." };
      return refuse(`${field}.image_id`, `${field} reads a texture but names no image_id.`);
    }
    if (bufferName !== null) return refuse(`${field}.buffer_name`, `${field} reads a texture, so it takes no buffer_name.`);
  }
  const filter = (given.filter ?? "linear") as ShaderChannelFilter;
  if (!SHADER_CHANNEL_FILTERS.includes(filter)) return refuse(`${field}.filter`, `${field}.filter ${JSON.stringify(given.filter)} isn't linear or nearest.`);
  // Shadertoy's defaults: textures tile, buffers clamp at their edges.
  const wrap = (given.wrap ?? (inputKind === "texture" ? "repeat" : "clamp")) as ShaderChannelWrap;
  if (!SHADER_CHANNEL_WRAPS.includes(wrap)) return refuse(`${field}.wrap`, `${field}.wrap ${JSON.stringify(given.wrap)} isn't clamp or repeat.`);
  return { channel_index: channelIndex, input_kind: inputKind, buffer_name: inputKind === "buffer" ? (bufferName as ShaderBufferName) : null, image_id: inputKind === "texture" ? (imageId as string) : null, filter, wrap };
}

/**
 * The sharpening upscale every runner draws last (the game site's runner and Zaisma's own pages' backdrop): the passes' picture,
 * drawn at fewer pixels (SHADER_LIMITS.runtimeDrawShareNumber), scaled up to the canvas with Catmull-Rom (nine bilinear taps) and a
 * light contrast-adaptive sharpen over the four texels round it, which lifts detail more where the picture is flat and leaves edges
 * alone, so nothing rings. Spatial only: nothing from an earlier frame, so nothing ghosts. zaismaDrawnSize is the part of zaismaDrawn
 * the passes drew, in its texels from its bottom left (the site's backdrop shares one picture between canvases of many sizes).
 */
export const SHADER_UPSCALE_SOURCE = `#version 300 es
precision highp float;
uniform sampler2D zaismaDrawn;
uniform vec2 zaismaDrawnSize;
uniform vec2 zaismaCanvasSize;
out vec4 zaismaFragColor;
vec3 zaismaTap(vec2 texel) {
  return texture(zaismaDrawn, clamp(texel, vec2(0.5), zaismaDrawnSize - 0.5) / vec2(textureSize(zaismaDrawn, 0))).rgb;
}
void main() {
  vec2 at = gl_FragCoord.xy / zaismaCanvasSize * zaismaDrawnSize;
  vec2 middle = floor(at - 0.5) + 0.5, f = at - middle;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)), w1 = 1.0 + f * f * (-2.5 + 1.5 * f), w2 = f * (0.5 + f * (2.0 - 1.5 * f)), w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2, at0 = middle - 1.0, at3 = middle + 2.0, at12 = middle + w2 / w12;
  vec3 color = (zaismaTap(vec2(at0.x, at0.y)) * w0.x + zaismaTap(vec2(at12.x, at0.y)) * w12.x + zaismaTap(vec2(at3.x, at0.y)) * w3.x) * w0.y
    + (zaismaTap(vec2(at0.x, at12.y)) * w0.x + zaismaTap(vec2(at12.x, at12.y)) * w12.x + zaismaTap(vec2(at3.x, at12.y)) * w3.x) * w12.y
    + (zaismaTap(vec2(at0.x, at3.y)) * w0.x + zaismaTap(vec2(at12.x, at3.y)) * w12.x + zaismaTap(vec2(at3.x, at3.y)) * w3.x) * w3.y;
  vec3 north = zaismaTap(at + vec2(0.0, 1.0)), south = zaismaTap(at - vec2(0.0, 1.0)), east = zaismaTap(at + vec2(1.0, 0.0)), west = zaismaTap(at - vec2(1.0, 0.0));
  vec3 low = min(min(min(north, south), min(east, west)), color), high = max(max(max(north, south), max(east, west)), color);
  vec3 weight = -sqrt(clamp(min(low, 2.0 - high) / max(high, vec3(0.0001)), 0.0, 1.0)) / 7.0;
  zaismaFragColor = vec4(clamp((color + (north + south + east + west) * weight) / (1.0 + 4.0 * weight), 0.0, 1.0), 1.0);
}`;

export async function addShader(database: D1Database, shader: Pick<GameShader, "id" | "game_id" | "screen" | "size_bytes" | "buffer_count" | "texture_count">): Promise<GameShader> {
  const row: GameShader = { ...shader, review_status: "pending", review_reason: null, quality_checks: null, flash_count: null, checked_at_ms: null, average_color: null, is_glass_smoked: null, glass_tint_pct: null, created_at_ms: now() };
  await database
    .prepare("INSERT INTO game_shaders (id, game_id, screen, size_bytes, buffer_count, texture_count, review_status, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(row.id, row.game_id, row.screen, row.size_bytes, row.buffer_count, row.texture_count, row.review_status, row.created_at_ms)
    .run();
  return row;
}

export async function shaderById(database: D1Database, id: string): Promise<GameShader | null> {
  return database.prepare("SELECT * FROM game_shaders WHERE id = ?").bind(id).first<GameShader>();
}

/** A game's shaders, newest first. */
export async function shadersForGame(database: D1Database, gameId: string): Promise<GameShader[]> {
  const { results } = await database.prepare("SELECT * FROM game_shaders WHERE game_id = ? ORDER BY created_at_ms DESC, id DESC").bind(gameId).all<GameShader>();
  return results;
}

/** Shaders the check drew that wait for a person: the check's safety half asked for one, or couldn't answer. */
export async function shadersWaitingForPerson(database: D1Database): Promise<(GameShader & { slug: string; title: string })[]> {
  const { results } = await database
    .prepare("SELECT game_shaders.*, games.slug, games.title FROM game_shaders JOIN games ON games.id = game_shaders.game_id WHERE game_shaders.review_status = 'pending' AND game_shaders.checked_at_ms IS NOT NULL ORDER BY game_shaders.created_at_ms LIMIT 100")
    .all<GameShader & { slug: string; title: string }>();
  return results;
}

/**
 * The shader check's result: approved (rejectedReason null) or rejected, with what it measured at each quality level. A shader the check
 * drew but left for a person keeps pending, with its numbers (waitsForPerson).
 */
export async function settleShader(database: D1Database, shader: Pick<GameShader, "id">, rejectedReason: ReviewReason | null, qualityChecks: ShaderQualityCheck[] | null, flashCount: number | null, waitsForPerson = false): Promise<void> {
  const reviewStatus = rejectedReason ? "rejected" : waitsForPerson ? "pending" : "approved";
  await database
    .prepare("UPDATE game_shaders SET review_status = ?, review_reason = ?, quality_checks = ?, flash_count = ?, checked_at_ms = ? WHERE id = ?")
    .bind(reviewStatus, rejectedReason ? JSON.stringify(rejectedReason) : null, qualityChecks ? JSON.stringify(qualityChecks) : null, flashCount, now(), shader.id)
    .run();
}

/** A background's tone, as its picture's or shader's row keeps it. */
export interface BackgroundTone {
  average_color: string;
  is_glass_smoked: number;
  glass_tint_pct: number;
}

/** Keeps a background picture's or shader's tone, measured from the picture or the shader's still. */
export async function setBackgroundTone(database: D1Database, table: "game_images" | "game_shaders", id: string, tone: BackgroundTone): Promise<void> {
  await database.prepare(`UPDATE ${table} SET average_color = ?, is_glass_smoked = ?, glass_tint_pct = ? WHERE id = ?`).bind(tone.average_color, tone.is_glass_smoked, tone.glass_tint_pct, id).run();
}

/** What a screen shows without a row: Zaisma's own on wide; phones follow wide. */
const defaultBackground = (gameId: string, screen: BackgroundScreen): GameBackground => ({ game_id: gameId, screen, source: screen === "wide" ? "zaisma" : "wide", image_id: null, shader_id: null, updated_at_ms: null });

/** Both screens' backgrounds, the defaults filled in. */
export async function backgroundsFor(database: D1Database, gameId: string): Promise<Record<BackgroundScreen, GameBackground>> {
  const { results } = await database.prepare("SELECT * FROM game_backgrounds WHERE game_id = ?").bind(gameId).all<GameBackground>();
  const set = (screen: BackgroundScreen) => results.find((row) => row.screen === screen) ?? defaultBackground(gameId, screen);
  return { wide: set("wide"), phone: set("phone") };
}

/** Choose what a screen shows. The caller checks the image or shader is this game's, approved and for this screen. */
export async function setBackground(database: D1Database, gameId: string, screen: BackgroundScreen, source: BackgroundSource, imageId: string | null, shaderId: string | null): Promise<GameBackground> {
  const row: GameBackground = { game_id: gameId, screen, source, image_id: source === "image" ? imageId : null, shader_id: source === "shader" ? shaderId : null, updated_at_ms: now() };
  await database
    .prepare("INSERT INTO game_backgrounds (game_id, screen, source, image_id, shader_id, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (game_id, screen) DO UPDATE SET source = excluded.source, image_id = excluded.image_id, shader_id = excluded.shader_id, updated_at_ms = excluded.updated_at_ms")
    .bind(row.game_id, row.screen, row.source, row.image_id, row.shader_id, row.updated_at_ms)
    .run();
  return row;
}

/** A screen showing this image or shader, which is going away, goes back to its default. */
export async function dropChosenBackground(database: D1Database, gameId: string, chosen: { imageId: string } | { shaderId: string }): Promise<void> {
  const [column, id] = "imageId" in chosen ? ["image_id", chosen.imageId] : ["shader_id", chosen.shaderId];
  await database.prepare(`DELETE FROM game_backgrounds WHERE game_id = ? AND ${column} = ?`).bind(gameId, id).run();
}

/** A glass tint as the API takes it: #RRGGBB. */
export const isGlassTintColor = (given: unknown): given is string => typeof given === "string" && /^#[0-9a-fA-F]{6}$/.test(given);
