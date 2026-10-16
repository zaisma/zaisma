import type { Env } from "./env.ts";

/**
 * Sign-in through Supabase Auth, called over its REST API (no client library).
 * Sessions live in an HttpOnly cookie on zaisma.com only; the game domain never sees it.
 * Access tokens are checked here against Supabase's published keys, the same way
 * game servers check player passes, so most requests never call Supabase.
 */

export interface Session {
  userId: string;
  email: string;
  access: string;
  refresh: string;
  /** When they last proved it's them (email code or passkey), in ms; 0 if unknown. */
  signedInAtMs: number;
}

export function authConfigured(env: Env): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY);
}

async function auth(env: Env, path: string, init: { method?: string; body?: unknown; token?: string; isAdminCall?: boolean } = {}): Promise<Response> {
  const headers: Record<string, string> = { apikey: init.isAdminCall ? env.SUPABASE_SECRET_KEY ?? "" : env.SUPABASE_PUBLISHABLE_KEY! };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.token) headers["Authorization"] = `Bearer ${init.token}`;
  return fetch(`${env.SUPABASE_URL}/auth/v1${path}`, { method: init.method ?? "POST", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}

export type SendResult = "sent" | "too-many" | "failed";

/** Email a sign-in code. With create=false, an unknown email quietly gets nothing. */
export async function sendCode(env: Env, email: string, create: boolean): Promise<SendResult> {
  const response = await auth(env, "/otp", { body: { email, create_user: create } });
  if (response.ok) return "sent";
  if (response.status === 429) return "too-many";
  // Unknown email on the sign-in path: answer as if sent, so the form doesn't reveal who has an account.
  if (!create && (response.status === 422 || response.status === 400)) return "sent";
  console.error("Sending a sign-in code failed:", response.status, await response.text());
  return "failed";
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  user: { id: string; email?: string };
}

const toSession = (tokens: TokenResponse): Session => ({ userId: tokens.user.id, email: tokens.user.email ?? "", access: tokens.access_token, refresh: tokens.refresh_token, signedInAtMs: tokenSignedInAtMs(tokens.access_token) });

export async function verifyCode(env: Env, email: string, code: string): Promise<Session | null> {
  const response = await auth(env, "/verify", { body: { type: "email", email, token: code } });
  return response.ok ? toSession((await response.json()) as TokenResponse) : null;
}

async function refreshSession(env: Env, refresh: string): Promise<Session | null> {
  const response = await auth(env, "/token?grant_type=refresh_token", { body: { refresh_token: refresh } });
  return response.ok ? toSession((await response.json()) as TokenResponse) : null;
}

export async function signOutEverywhere(env: Env, access: string): Promise<void> {
  await auth(env, "/logout?scope=global", { token: access }).catch(() => {});
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
    const response = await fetch(url, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY! } });
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

export async function exchangeCode(env: Env, code: string, verifier: string): Promise<Session | null> {
  const response = await auth(env, "/token?grant_type=pkce", { body: { auth_code: code, code_verifier: verifier } });
  if (!response.ok) return null;
  const session = toSession((await response.json()) as TokenResponse);
  return session.email ? session : null;
}

/**
 * A session for someone who just signed in with a passkey (checked by us, see passkeys.ts).
 * Supabase makes it: a one-time sign-in link for their email, used straight away, never sent.
 */
export async function sessionForUser(env: Env, userId: string): Promise<Session | null> {
  if (!env.SUPABASE_SECRET_KEY) return null;
  const user = await auth(env, `/admin/users/${encodeURIComponent(userId)}`, { method: "GET", isAdminCall: true });
  const email = user.ok ? ((await user.json()) as { email?: string }).email : undefined;
  if (!email) return null;
  const link = await auth(env, "/admin/generate_link", { body: { type: "magiclink", email }, isAdminCall: true });
  if (!link.ok) {
    console.error("Making a passkey session failed:", link.status, await link.text());
    return null;
  }
  const linkDetails = (await link.json()) as { hashed_token?: string; properties?: { hashed_token?: string } };
  const tokenHash = linkDetails.hashed_token ?? linkDetails.properties?.hashed_token;
  if (!tokenHash) return null;
  const response = await auth(env, "/verify", { body: { type: "magiclink", token_hash: tokenHash } });
  const session = response.ok ? toSession((await response.json()) as TokenResponse) : null;
  return session?.userId === userId ? session : null;
}

/** Remove the sign-in record (and email) from Supabase. Needs the secret key. */
export async function deleteAuthUser(env: Env, userId: string): Promise<boolean> {
  if (!env.SUPABASE_SECRET_KEY) return false;
  const response = await auth(env, `/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE", isAdminCall: true });
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
}

/** The user ID and email in a valid access token, "expired" if it was valid but is old, or null. */
export async function checkAccessToken(env: Env, token: string): Promise<{ userId: string; email: string; signedInAtMs: number } | "expired" | null> {
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
  return { userId: claims.sub, email: claims.email ?? "", signedInAtMs: tokenSignedInAtMs(token) };
}

/** When the person behind a token last signed in, in ms: Supabase lists each way they proved it (amr). */
function tokenSignedInAtMs(token: string): number {
  try {
    const claims = JSON.parse(b64urlText(token.split(".")[1] ?? "")) as SupabaseJwtClaims;
    return Math.max(0, ...(claims.amr ?? []).map((method) => (typeof method.timestamp === "number" ? method.timestamp * 1000 : 0)));
  } catch {
    return 0;
  }
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
 * `cookies` then holds the new cookies to send back.
 */
export async function currentSession(request: Request, env: Env): Promise<(Session & { cookies: string[] }) | null> {
  if (!authConfigured(env)) return null;
  const raw = readCookie(request, env, "zaisma");
  if (!raw) return null;
  const [access, refresh] = raw.split("~") as [string, string | undefined];
  if (!access || !refresh) return null;
  const checked = await checkAccessToken(env, access);
  if (checked && checked !== "expired") return { ...checked, access, refresh, cookies: [] };
  if (checked === null) return null;
  const fresh = await refreshSession(env, refresh);
  if (!fresh) return null;
  return { ...fresh, cookies: sessionCookies(env, fresh) };
}
