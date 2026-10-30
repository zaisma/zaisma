/**
 * Players from outside Zaisma, for a game server on your own server: a game played anywhere but its Zaisma
 * page (exported, on another site, wrapped for a store) has no Zaisma pass, so its game sends a playerToken
 * instead (Zaisma.setUpOffZaisma) and your server says who that is with startServer's identifyPlayer. Such a
 * player joins with kind "outside_zaisma", in the same rooms as players from the Zaisma page.
 *
 * signInWithZaismaPlayers makes an identifyPlayer for players signed in with Zaisma (Sign in with Zaisma's ID
 * tokens): the same player ID and name as on Zaisma. guestPlayer is who a player with no token is, when
 * startServer's outsideGuestsEnabled lets them in: a temporary ID and a generated name, like Zaisma's guests.
 */

import { guestName } from "./names.ts";
import { fromBase64Url, type PublicKey } from "./pass.ts";
import { GameServerError, ROOM_LIMITS, tidyRoomInfo } from "./room.ts";

/** Who a player from outside Zaisma is, as identifyPlayer answers: an ID your server keeps for them, and the name others see. */
export interface OutsidePlayer {
  /** 1 to 100 characters: a Zaisma player ID for a player signed in with Zaisma, or your own accounts' IDs. */
  id: string;
  /** 1 to 40 characters, as other players see it. */
  name: string;
}

/** startServer's identifyPlayer: who a playerToken is, or null when it isn't one your server takes. */
export type IdentifyPlayer = (playerToken: string, connection: { origin: string | null }) => Promise<OutsidePlayer | null>;

export interface SignInWithZaismaPlayersOptions {
  /** Your sign-in apps' IDs (sign_in_app_…), 1 to 20: an ID token for any other app is refused. */
  signInAppIds: string[];
  /** Where Sign in with Zaisma runs, the ID tokens' iss: https://zaisma.com unless a local preview of Zaisma. */
  siteUrl?: string;
  /** async (isRefreshing) => the ID token keys; by default from <siteUrl>/.well-known/jwks.json, fetched again once on a key it doesn't know. */
  loadKeys?: (isRefreshing: boolean) => Promise<PublicKey[]>;
  /** async (playerId) => an account's public profile or null, for a token with no name (signed in without the profile scope). */
  loadProfile?: (playerId: string) => Promise<{ name: string } | null>;
}

export const OUTSIDE_PLAYER_LIMITS = {
  maximumIdCharacterCount: 100,
  maximumSignInAppCount: 20,
  /** How far an ID token's exp may be past, for clocks that differ a little. */
  clockLeewaySec: 60,
  /** How long the keys and profiles are kept before they're fetched again. */
  keysKeptMs: 3600_000,
  profileKeptMs: 300_000,
  /** A refresh for a key ID it doesn't know waits this long after the last fetch, so made-up key IDs can't make it fetch on every token. */
  minimumRefreshIntervalMs: 30_000,
  maximumProfileCount: 10_000,
} as const;

const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;
const SIGN_IN_APP_ID = /^sign_in_app_[a-z0-9]+$/;
const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** The ID token keys at <siteUrl>/.well-known/jwks.json, kept an hour; a fetch that fails keeps the keys already held. */
function keysAt(jwksUrl: string): (isRefreshing: boolean) => Promise<PublicKey[]> {
  let kept: { keys: PublicKey[]; fetchedAtMs: number } | null = null;
  let fetchedAtMs = 0;
  return async (isRefreshing) => {
    const nowMs = Date.now();
    if (kept && !isRefreshing && nowMs - kept.fetchedAtMs < OUTSIDE_PLAYER_LIMITS.keysKeptMs) return kept.keys;
    if (kept && isRefreshing && nowMs - fetchedAtMs < OUTSIDE_PLAYER_LIMITS.minimumRefreshIntervalMs) return kept.keys;
    fetchedAtMs = nowMs;
    try {
      const response = await fetch(jwksUrl);
      if (!response.ok) throw new Error(`Couldn't load Zaisma's sign-in keys from ${jwksUrl}`);
      kept = { keys: ((await response.json()) as { keys: PublicKey[] }).keys, fetchedAtMs: nowMs };
    } catch (error) {
      if (kept) return kept.keys;
      throw error;
    }
    return kept.keys;
  };
}

/** Accounts' public profiles at Zaisma (https://rooms.zaisma.com/v1/players/<id>), each kept 5 minutes; null when no account has that ID. */
function profilesAt(profilesUrl: string): (playerId: string) => Promise<{ name: string } | null> {
  const kept = new Map<string, { profile: { name: string } | null; fetchedAtMs: number }>();
  return async (playerId) => {
    const found = kept.get(playerId);
    if (found && Date.now() - found.fetchedAtMs < OUTSIDE_PLAYER_LIMITS.profileKeptMs) return found.profile;
    const response = await fetch(`${profilesUrl}/${encodeURIComponent(playerId)}`);
    if (response.status !== 200 && response.status !== 404) throw new Error(`Couldn't look up player ${playerId} at ${profilesUrl}`);
    const profile = response.status === 200 ? ((await response.json()) as { player: { name: string } }).player : null;
    if (kept.size > OUTSIDE_PLAYER_LIMITS.maximumProfileCount) kept.clear();
    kept.set(playerId, { profile, fetchedAtMs: Date.now() });
    return profile;
  };
}

/** A token's header and claims, unchecked, or null when it isn't a JWT. */
function tokenParts(token: string): { header: { alg?: unknown; typ?: unknown; kid?: unknown }; claims: Record<string, unknown>; signature: Uint8Array<ArrayBuffer> } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(decoder.decode(fromBase64Url(parts[0]!)));
    const claims = JSON.parse(decoder.decode(fromBase64Url(parts[1]!)));
    if (!header || typeof header !== "object" || !claims || typeof claims !== "object" || Array.isArray(claims)) return null;
    return { header, claims, signature: fromBase64Url(parts[2]!) };
  } catch {
    return null;
  }
}

/**
 * An identifyPlayer for players signed in with Zaisma: the game signs them in with Sign in with Zaisma and
 * sends the ID token as its playerToken. The token is checked like any OpenID Connect ID token: RS256 only,
 * signed by Zaisma's published key, its iss the siteUrl, its aud one of signInAppIds, not expired. The player
 * is { id, name }: the account's Zaisma player ID, the same as on Zaisma, and its name from the token (or its
 * public profile when the token has none). Answers null for any token that doesn't check out, and for an
 * account deleted since; throws only when Zaisma's keys or profiles can't be reached (the runner answers busy).
 *
 *   startServer({ gameServer, gameSlug, identifyPlayer: signInWithZaismaPlayers({ signInAppIds: ["sign_in_app_8f3k2m"] }) });
 */
export function signInWithZaismaPlayers(options: SignInWithZaismaPlayersOptions): IdentifyPlayer {
  const fields = ["signInAppIds", "siteUrl", "loadKeys", "loadProfile"];
  if (!options || typeof options !== "object") throw new GameServerError("bad_option", "options", "signInWithZaismaPlayers takes one object of options.", 'Call signInWithZaismaPlayers({ signInAppIds: ["sign_in_app_…"] }).');
  for (const field of Object.keys(options)) {
    if (!fields.includes(field)) throw new GameServerError("unknown_option", field, `${field} isn't a signInWithZaismaPlayers option.`, `signInWithZaismaPlayers takes: ${fields.join(", ")}.`);
  }
  const { signInAppIds, siteUrl = "https://zaisma.com" } = options;
  if (!Array.isArray(signInAppIds) || signInAppIds.length < 1 || signInAppIds.length > OUTSIDE_PLAYER_LIMITS.maximumSignInAppCount || !signInAppIds.every((id) => typeof id === "string" && SIGN_IN_APP_ID.test(id))) {
    throw new GameServerError("bad_option", "signInAppIds", "signInAppIds isn't a list of sign-in app IDs.", `Give 1 to ${OUTSIDE_PLAYER_LIMITS.maximumSignInAppCount} of your sign-in apps' IDs, like ["sign_in_app_8f3k2m"] (list_sign_in_apps shows them).`);
  }
  if (typeof siteUrl !== "string" || !URL.canParse(siteUrl)) throw new GameServerError("bad_option", "siteUrl", "siteUrl isn't a URL.", 'Give where Sign in with Zaisma runs, like "https://zaisma.com".');
  for (const field of ["loadKeys", "loadProfile"] as const) {
    if (options[field] !== undefined && typeof options[field] !== "function") throw new GameServerError("bad_option", field, `${field} isn't a function.`, field === "loadKeys" ? "Give async (isRefreshing) => the keys, as a list." : "Give async (playerId) => { name } or null.");
  }
  const loadKeys = options.loadKeys ?? keysAt(`${siteUrl}/.well-known/jwks.json`);
  const loadProfile = options.loadProfile ?? profilesAt("https://rooms.zaisma.com/v1/players");

  return async (playerToken) => {
    const parts = typeof playerToken === "string" ? tokenParts(playerToken) : null;
    // An ID token, never an access token (at+jwt) or a token signed any other way.
    if (!parts || parts.header.alg !== "RS256" || parts.header.typ !== "JWT" || typeof parts.header.kid !== "string") return null;
    const { header, claims } = parts;
    const nowSec = Math.floor(Date.now() / 1000);
    if (claims.iss !== siteUrl || typeof claims.aud !== "string" || !signInAppIds.includes(claims.aud)) return null;
    if (typeof claims.exp !== "number" || claims.exp + OUTSIDE_PLAYER_LIMITS.clockLeewaySec <= nowSec) return null;
    if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > OUTSIDE_PLAYER_LIMITS.maximumIdCharacterCount) return null;
    // A key published since the keys were fetched: fetched again once.
    let jwk = (await loadKeys(false)).find((key) => key.kid === header.kid);
    if (!jwk) jwk = (await loadKeys(true)).find((key) => key.kid === header.kid);
    if (!jwk || jwk.kty !== "RSA" || !jwk.n || !jwk.e) return null;
    const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e }, RS256, false, ["verify"]);
    const [signedHeader, signedClaims] = playerToken.split(".");
    if (!(await crypto.subtle.verify(RS256, key, parts.signature, encoder.encode(`${signedHeader}.${signedClaims}`)))) return null;
    // A token without the profile scope carries no name: the account's public one. A deleted account has none, and plays no more.
    const name = typeof claims.name === "string" && claims.name ? claims.name : ((await loadProfile(claims.sub))?.name ?? null);
    return name ? { id: claims.sub, name } : null;
  };
}

/** A player with no token, when startServer's outsideGuestsEnabled lets them in: a temporary player ID and a generated name, as Zaisma's guests have. */
export function guestPlayer(): OutsidePlayer {
  const randomPart = Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 20);
  return { id: `player_${randomPart}`, name: guestName() };
}

/** What identifyPlayer answered, checked for the runner: the player, with their name tidied, or what was wrong with it. */
export function checkedOutsidePlayer(given: unknown): { player: OutsidePlayer } | { mistake: string } {
  if (!given || typeof given !== "object" || Array.isArray(given)) return { mistake: "identifyPlayer answered something other than { id, name } or null." };
  const { id, name } = given as { id?: unknown; name?: unknown };
  if (typeof id !== "string" || !id || id.length > OUTSIDE_PLAYER_LIMITS.maximumIdCharacterCount) return { mistake: `identifyPlayer's id isn't text of 1 to ${OUTSIDE_PLAYER_LIMITS.maximumIdCharacterCount} characters.` };
  const tidied = typeof name === "string" ? tidyRoomInfo({ name }).name : null;
  if (typeof name !== "string" || !tidied || name.trim().length > ROOM_LIMITS.maximumNameCharacterCount) return { mistake: `identifyPlayer's name isn't text of 1 to ${ROOM_LIMITS.maximumNameCharacterCount} characters.` };
  return { player: { id, name: tidied } };
}
