import type { Account } from "@zaisma/core";
import type { Env } from "./env.ts";

/**
 * Sign-in through Supabase Auth, called over its REST API (no client library).
 * Sessions live in an HttpOnly cookie on zaisma.com only; the game domain never sees it.
 * Access tokens are checked here against Supabase's published keys, the same way
 * game servers check player passes, so most requests never call Supabase.
 *
 * Supabase answers only Zaisma (docs/DECISIONS.md, "Accounts open only through Zaisma"): every call uses
 * the secret key, and Supabase's publishable key is off, so nobody tries passwords or makes sign-ups around
 * Zaisma's limits and checks. A call for a player sends their address (Sb-Forwarded-For), so Supabase's own
 * per-address limits count players, not the few addresses Cloudflare calls from. Email codes are Zaisma's
 * own (email-codes.ts); Supabase never holds one.
 */

export interface Session {
  userId: string;
  email: string;
  access: string;
  refresh: string;
  /** When they last proved it's them (password, email code or passkey), in ms; 0 if unknown. */
  signedInAtMs: number;
  /** Supabase's ID for this session, the same across refreshes; "" when the token has none. */
  sessionId: string;
}

export function authConfigured(env: Env): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY);
}

/** The address a request came from, checked by Cloudflare and never stored, for Supabase's per-address limits. */
export const connectionAddressOf = (request: Request): string | null => request.headers.get("cf-connecting-ip");

async function auth(env: Env, path: string, init: { method?: string; body?: unknown; token?: string; connectionAddress?: string | null } = {}): Promise<Response> {
  const headers: Record<string, string> = { apikey: env.SUPABASE_SECRET_KEY! };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.token) headers["Authorization"] = `Bearer ${init.token}`;
  if (init.connectionAddress) headers["Sb-Forwarded-For"] = init.connectionAddress;
  return fetch(`${env.SUPABASE_URL}/auth/v1${path}`, { method: init.method ?? "POST", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}

/**
 * An account made without an email is known to Supabase by an address on this domain, which has no mail
 * servers, so nothing sent there goes anywhere. Its first part is random, never the username.
 */
export const NO_MAIL_DOMAIN = "no-mail.zaisma.com";

/** The email the player gave, or null when the account has none (Supabase's stand-in address). */
export const realEmail = (email: string): string | null => (email && !email.toLowerCase().endsWith(`@${NO_MAIL_DOMAIN}`) ? email : null);

const newNoMailEmail = () => `account-${[...crypto.getRandomValues(new Uint8Array(12))].map((byte) => byte.toString(16).padStart(2, "0")).join("")}@${NO_MAIL_DOMAIN}`;

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  user: { id: string; email?: string };
}

const toSession = (tokens: TokenResponse): Session => ({
  userId: tokens.user.id,
  email: tokens.user.email ?? "",
  access: tokens.access_token,
  refresh: tokens.refresh_token,
  signedInAtMs: tokenSignedInAtMs(tokens.access_token),
  sessionId: tokenClaims(tokens.access_token).session_id ?? "",
});

export async function refreshSession(env: Env, refresh: string, connectionAddress: string | null): Promise<Session | null> {
  const response = await auth(env, "/token?grant_type=refresh_token", { body: { refresh_token: refresh }, connectionAddress });
  return response.ok ? toSession((await response.json()) as TokenResponse) : null;
}

export async function signOutEverywhere(env: Env, access: string, connectionAddress: string | null): Promise<void> {
  await auth(env, "/logout?scope=global", { token: access, connectionAddress }).catch(() => {});
}

/** Ask Supabase to sign out every session of this token's user but its own; false when Supabase said no. */
export async function signOutOthers(env: Env, access: string, connectionAddress: string | null): Promise<boolean> {
  try {
    const response = await auth(env, "/logout?scope=others", { token: access, connectionAddress });
    if (!response.ok) console.error("Signing out other sessions failed:", response.status, await response.text());
    return response.ok;
  } catch (error) {
    console.error("Signing out other sessions failed:", error);
    return false;
  }
}

/**
 * Refuse every session of the account signed in before cutoffMs (checked by currentSession on each request), so
 * a session Supabase didn't sign out, or a refreshed token, can't outlive a new password or Sign out on every device.
 */
export async function endSessionsBefore(env: Env, accountId: string, cutoffMs: number, rounding: "down" | "up" = "down"): Promise<void> {
  // Supabase writes sign-in times in whole seconds, so a sign-in just after a new password's must not look older than the cut-off:
  // that one rounds down (measured from this device's fresh session); Sign out on every device has no new session to keep, so it rounds up.
  const wholeSecondMs = (rounding === "up" ? Math.ceil(cutoffMs / 1000) : Math.floor(cutoffMs / 1000)) * 1000;
  await env.DB.prepare("UPDATE accounts SET sessions_ended_at_ms = ? WHERE id = ?").bind(wholeSecondMs, accountId).run();
}

// --- Passwords: Supabase checks them and keeps only a hash ---

/** A Supabase user for a new account with a password and no email (known by a stand-in address), or null when Supabase said no. */
export async function createPasswordUser(env: Env, password: string): Promise<{ userId: string; email: string } | null> {
  const email = newNoMailEmail();
  const response = await auth(env, "/admin/users", { body: { email, password, email_confirm: true } });
  if (!response.ok) {
    console.error("Making a password sign-in failed:", response.status, await response.text());
    return null;
  }
  const { id } = (await response.json()) as { id?: string };
  return id ? { userId: id, email } : null;
}

export type PasswordSignIn = Session | "wrong" | "too-many" | "failed";

/** Sign in with the email Supabase knows the account by (the player's, or the stand-in) and a password. */
export async function signInWithPassword(env: Env, email: string, password: string, connectionAddress: string | null): Promise<PasswordSignIn> {
  const response = await auth(env, "/token?grant_type=password", { body: { email, password }, connectionAddress });
  if (response.ok) return toSession((await response.json()) as TokenResponse);
  if (response.status === 429) return "too-many";
  if (response.status === 400 || response.status === 422) return "wrong";
  console.error("Signing in with a password failed:", response.status, await response.text());
  return "failed";
}

/** Set a new password for a user (the caller checked it's them, recently). */
export async function setPassword(env: Env, userId: string, password: string): Promise<boolean> {
  const response = await auth(env, `/admin/users/${encodeURIComponent(userId)}`, { method: "PUT", body: { password } });
  if (!response.ok) console.error("Setting a password failed:", response.status, await response.text());
  return response.ok;
}

/** The email Supabase knows a user by: the player's own, or the stand-in for an account without one. */
export async function authUserEmail(env: Env, userId: string): Promise<string | null> {
  const user = await auth(env, `/admin/users/${encodeURIComponent(userId)}`, { method: "GET" });
  return user.ok ? (((await user.json()) as { email?: string }).email ?? null) : null;
}

/** What Supabase keeps about a user, for Download your data: undefined when Supabase couldn't be asked. */
export async function authUserRecord(env: Env, userId: string): Promise<AuthUserRecord | undefined> {
  try {
    const user = await auth(env, `/admin/users/${encodeURIComponent(userId)}`, { method: "GET" });
    return user.ok ? ((await user.json()) as AuthUserRecord) : undefined;
  } catch {
    return undefined;
  }
}

/** A Supabase user as its admin call answers it, in Supabase's words; identities are Google, Discord and the rest. */
export interface AuthUserRecord {
  email?: string;
  created_at?: string;
  last_sign_in_at?: string | null;
  identities?: { provider: string; identity_data?: Record<string, unknown>; created_at?: string; last_sign_in_at?: string | null }[];
}

/** A Supabase user as its admin list says it, in Supabase's words. */
interface AuthUser {
  id: string;
  email?: string;
  created_at?: string;
}

/**
 * The user Supabase knows by this email (lowercase), or null. Supabase's filter finds emails containing
 * the text, so only an exact match counts. Undefined when Supabase couldn't be asked.
 */
export async function authUserIdByEmail(env: Env, email: string): Promise<string | null | undefined> {
  const response = await auth(env, `/admin/users?${new URLSearchParams({ filter: email, page: "1", per_page: "50" })}`, { method: "GET" });
  if (!response.ok) {
    console.error("Looking up an email failed:", response.status, await response.text());
    return undefined;
  }
  const { users = [] } = (await response.json()) as { users?: AuthUser[] };
  return users.find((user) => user.email?.toLowerCase() === email)?.id ?? null;
}

/** One page of Supabase's users, newest first (its admin list's order unless told otherwise), or null when Supabase couldn't be asked. */
export async function newestAuthUsers(env: Env, pageNumber: number, perPageCount: number): Promise<{ id: string; createdAtMs: number }[] | null> {
  const response = await auth(env, `/admin/users?${new URLSearchParams({ page: String(pageNumber), per_page: String(perPageCount) })}`, { method: "GET" });
  if (!response.ok) {
    console.error("Listing sign-ins failed:", response.status, await response.text());
    return null;
  }
  const { users = [] } = (await response.json()) as { users?: AuthUser[] };
  return users.map((user) => ({ id: user.id, createdAtMs: Date.parse(user.created_at ?? "") || 0 }));
}

// --- Email: an optional way back in ---

/**
 * Give the account this email, once Zaisma's own code to it was typed (email-codes.ts). "taken" when
 * another account has it.
 */
export async function setEmail(env: Env, userId: string, email: string): Promise<"set" | "taken" | "failed"> {
  const response = await auth(env, `/admin/users/${encodeURIComponent(userId)}`, { method: "PUT", body: { email, email_confirm: true } });
  if (response.ok) return "set";
  const answer = await response.text();
  if (response.status === 422 && answer.includes("email_exists")) return "taken";
  console.error("Setting an email failed:", response.status, answer);
  return "failed";
}

/** Forget the account's email: Supabase knows it by a new stand-in address from now on. */
export async function removeEmail(env: Env, userId: string): Promise<boolean> {
  const response = await auth(env, `/admin/users/${encodeURIComponent(userId)}`, { method: "PUT", body: { email: newNoMailEmail(), email_confirm: true } });
  if (!response.ok) console.error("Removing an email failed:", response.status, await response.text());
  return response.ok;
}

// --- Google and Discord, through Supabase (PKCE, so the code only works with this browser's cookie) ---

export const PROVIDERS = { google: "Google", discord: "Discord" } as const;
export type Provider = keyof typeof PROVIDERS;
export const isProvider = (name: string): name is Provider => Object.hasOwn(PROVIDERS, name);

let providerCache: { url: string; fetchedAtMs: number; on: Provider[] } | null = null;

/** The providers switched on in Supabase, so a button only shows once it works. */
export async function providersOn(env: Env): Promise<Provider[]> {
  const url = `${env.SUPABASE_URL}/auth/v1/settings`;
  if (providerCache?.url === url && Date.now() - providerCache.fetchedAtMs < 5 * 60_000) return providerCache.on;
  try {
    const response = await fetch(url, { headers: { apikey: env.SUPABASE_SECRET_KEY! } });
    if (!response.ok) return providerCache?.url === url ? providerCache.on : [];
    const { external = {} } = (await response.json()) as { external?: Record<string, boolean> };
    providerCache = { url, fetchedAtMs: Date.now(), on: (Object.keys(PROVIDERS) as Provider[]).filter((provider) => external[provider] === true) };
    return providerCache.on;
  } catch {
    return [];
  }
}

/** Where to send the browser to sign in with a provider. Supabase sends it back to /signin/callback?code=… */
export function providerUrl(env: Env, provider: Provider, challenge: string): string {
  const query = new URLSearchParams({ provider, redirect_to: `${env.SITE_ORIGIN}/signin/callback`, code_challenge: challenge, code_challenge_method: "s256" });
  return `${env.SUPABASE_URL}/auth/v1/authorize?${query}`;
}

export async function exchangeCode(env: Env, code: string, verifier: string, connectionAddress: string | null): Promise<Session | null> {
  const response = await auth(env, "/token?grant_type=pkce", { body: { auth_code: code, code_verifier: verifier }, connectionAddress });
  if (!response.ok) return null;
  const session = toSession((await response.json()) as TokenResponse);
  return session.email ? session : null;
}

/**
 * A session for someone who just proved it's them to Zaisma: a passkey (passkeys.ts) or an email code
 * (email-codes.ts). Supabase makes it: a one-time sign-in link for their email (or stand-in address), used
 * straight away, never sent.
 */
export async function sessionForUser(env: Env, userId: string, connectionAddress: string | null): Promise<Session | null> {
  const email = await authUserEmail(env, userId);
  if (!email) return null;
  const link = await auth(env, "/admin/generate_link", { body: { type: "magiclink", email } });
  if (!link.ok) {
    console.error("Making a passkey session failed:", link.status, await link.text());
    return null;
  }
  const linkDetails = (await link.json()) as { hashed_token?: string; properties?: { hashed_token?: string } };
  const tokenHash = linkDetails.hashed_token ?? linkDetails.properties?.hashed_token;
  if (!tokenHash) return null;
  const response = await auth(env, "/verify", { body: { type: "magiclink", token_hash: tokenHash }, connectionAddress });
  const session = response.ok ? toSession((await response.json()) as TokenResponse) : null;
  return session?.userId === userId ? session : null;
}

/** Remove the sign-in record (and email) from Supabase. */
export async function deleteAuthUser(env: Env, userId: string): Promise<boolean> {
  const response = await auth(env, `/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) console.error("Deleting a sign-in failed:", response.status, await response.text());
  return response.ok || response.status === 404;
}

// --- Access token checks -----------------------------------------------------

type Jwk = JsonWebKey & { kid: string; alg?: string };
let keyCache: { url: string; fetchedAtMs: number; keys: Jwk[] } | null = null;

async function signingKeys(env: Env, force = false): Promise<Jwk[]> {
  const url = `${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
  if (!force && keyCache?.url === url && Date.now() - keyCache.fetchedAtMs < 10 * 60_000) return keyCache.keys;
  const response = await fetch(url);
  if (!response.ok) return keyCache?.url === url ? keyCache.keys : [];
  const { keys } = (await response.json()) as { keys: Jwk[] };
  keyCache = { url, fetchedAtMs: Date.now(), keys };
  return keys;
}

const SIGNING_ALGORITHMS: Record<string, { import: Parameters<typeof crypto.subtle.importKey>[2]; verify: Parameters<typeof crypto.subtle.verify>[0] }> = {
  ES256: { import: { name: "ECDSA", namedCurve: "P-256" }, verify: { name: "ECDSA", hash: "SHA-256" } },
  RS256: { import: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, verify: "RSASSA-PKCS1-v1_5" },
};

/** A Supabase access token's claims, in the JWT standard's and Supabase's own words (amr: how they signed in, and when, in seconds). */
interface SupabaseJwtClaims {
  sub?: string;
  email?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  amr?: { timestamp?: number }[];
  session_id?: string;
}

/** The user ID and email in a valid access token, "expired" if it was valid but is old, or null. */
export async function checkAccessToken(env: Env, token: string): Promise<{ userId: string; email: string; signedInAtMs: number; sessionId: string } | "expired" | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedClaims, encodedSignature] = parts as [string, string, string];
  let header: { alg: string; kid?: string };
  let claims: SupabaseJwtClaims;
  try {
    header = JSON.parse(b64urlText(encodedHeader));
    claims = JSON.parse(b64urlText(encodedClaims));
  } catch {
    return null;
  }
  const algorithm = SIGNING_ALGORITHMS[header.alg];
  if (!algorithm) return null;
  let jwk = (await signingKeys(env)).find((signingKey) => signingKey.kid === header.kid);
  if (!jwk) jwk = (await signingKeys(env, true)).find((signingKey) => signingKey.kid === header.kid);
  if (!jwk) return null;
  const { kid: keyId, alg: algorithmName, ...material } = jwk;
  const key = await crypto.subtle.importKey("jwk", { ...material, key_ops: ["verify"] }, algorithm.import, false, ["verify"]);
  if (!(await crypto.subtle.verify(algorithm.verify, key, b64urlBytes(encodedSignature), new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`)))) return null;

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== `${env.SUPABASE_URL}/auth/v1` || !audiences.includes("authenticated") || !claims.sub) return null;
  if (!(typeof claims.exp === "number" && claims.exp > Date.now() / 1000 + 10)) return "expired";
  return { userId: claims.sub, email: claims.email ?? "", signedInAtMs: tokenSignedInAtMs(token), sessionId: claims.session_id ?? "" };
}

/** The claims in a token we got from Supabase or checked, without checking it again; {} when it can't be read. */
function tokenClaims(token: string): SupabaseJwtClaims {
  try {
    return JSON.parse(b64urlText(token.split(".")[1] ?? "")) as SupabaseJwtClaims;
  } catch {
    return {};
  }
}

/** When the person behind a token last signed in, in ms: Supabase lists each way they proved it (amr). */
function tokenSignedInAtMs(token: string): number {
  return Math.max(0, ...(tokenClaims(token).amr ?? []).map((method) => (typeof method.timestamp === "number" ? method.timestamp * 1000 : 0)));
}

function b64urlBytes(encoded: string): Uint8Array {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((encoded.length + 3) % 4);
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function b64urlText(encoded: string): string {
  return new TextDecoder().decode(b64urlBytes(encoded));
}

// --- Cookies -----------------------------------------------------------------

const SESSION_DURATION_DAYS = 180;

function secure(env: Env): boolean {
  return env.SITE_ORIGIN.startsWith("https:");
}

/** __Host- cookies can't be set by subdomains or for other paths. Plain names on http://localhost. */
export function cookieName(env: Env, name: string): string {
  return secure(env) ? `__Host-${name}` : name;
}

export function setCookie(env: Env, name: string, cookieValue: string, options: { maximumAgeSec: number; isReadable?: boolean }): string {
  return [
    `${cookieName(env, name)}=${cookieValue}`,
    "Path=/",
    `Max-Age=${options.maximumAgeSec}`,
    "SameSite=Lax",
    ...(options.isReadable ? [] : ["HttpOnly"]),
    ...(secure(env) ? ["Secure"] : []),
  ].join("; ");
}

/** Set on a download a page started (an export's .zip), readable, so the page knows the browser's own download has taken over. */
export const downloadStartedCookie = (env: Env) => setCookie(env, "download_started", "1", { maximumAgeSec: 60, isReadable: true });

export function readCookie(request: Request, env: Env, name: string): string | null {
  const want = cookieName(env, name);
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === want) return part.slice(i + 1).trim();
  }
  return null;
}

/** The session cookie plus a readable "signed in" hint, so cached pages can show the right header link. */
export function sessionCookies(env: Env, session: Session): string[] {
  const sessionDurationSec = SESSION_DURATION_DAYS * 86400;
  return [setCookie(env, "zaisma", `${session.access}~${session.refresh}`, { maximumAgeSec: sessionDurationSec }), setCookie(env, "zaisma_in", "1", { maximumAgeSec: sessionDurationSec, isReadable: true })];
}

export function clearSessionCookies(env: Env): string[] {
  return [setCookie(env, "zaisma", "", { maximumAgeSec: 0 }), setCookie(env, "zaisma_in", "", { maximumAgeSec: 0, isReadable: true })];
}

/**
 * The signed-in person, if any. An expired access token is swapped for a fresh one;
 * `cookies` then holds the new cookies to send back. `accountRow` is their account's row as the check
 * below read it (null with none yet), before any birthday since is applied: viewerOf passes it through
 * accountWithBirthday, so a page reads the row once.
 */
export async function currentSession(request: Request, env: Env): Promise<(Session & { cookies: string[]; accountRow: Account | null }) | null> {
  if (!authConfigured(env)) return null;
  const raw = readCookie(request, env, "zaisma");
  if (!raw) return null;
  const [access, refresh] = raw.split("~") as [string, string | undefined];
  if (!access || !refresh) return null;
  const checked = await checkAccessToken(env, access);
  let session: (Session & { cookies: string[] }) | null = null;
  if (checked && checked !== "expired") session = { ...checked, access, refresh, cookies: [] };
  else if (checked === "expired") {
    const fresh = await refreshSession(env, refresh, connectionAddressOf(request));
    if (fresh) session = { ...fresh, cookies: sessionCookies(env, fresh) };
  }
  if (!session) return null;
  // The backstop for a new password and Sign out on every device: a refreshed token keeps its session's
  // sign-in time, so a session from before the cut-off stays out even when Supabase didn't revoke it.
  const accountRow = await env.DB.prepare("SELECT * FROM accounts WHERE id = ?").bind(session.userId).first<Account>();
  if (accountRow?.sessions_ended_at_ms != null && session.signedInAtMs < accountRow.sessions_ended_at_ms) return null;
  return { ...session, accountRow };
}
