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
  authAt: number;
}

export function authConfigured(env: Env): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY);
}

async function auth(env: Env, path: string, init: { method?: string; body?: unknown; token?: string; secret?: boolean } = {}): Promise<Response> {
  const headers: Record<string, string> = { apikey: init.secret ? env.SUPABASE_SECRET_KEY ?? "" : env.SUPABASE_PUBLISHABLE_KEY! };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.token) headers["Authorization"] = `Bearer ${init.token}`;
  return fetch(`${env.SUPABASE_URL}/auth/v1${path}`, { method: init.method ?? "POST", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}

export type SendResult = "sent" | "too-many" | "failed";

/** Email a sign-in code. With create=false, an unknown email quietly gets nothing. */
export async function sendCode(env: Env, email: string, create: boolean): Promise<SendResult> {
  const res = await auth(env, "/otp", { body: { email, create_user: create } });
  if (res.ok) return "sent";
  if (res.status === 429) return "too-many";
  // Unknown email on the sign-in path: answer as if sent, so the form doesn't reveal who has an account.
  if (!create && (res.status === 422 || res.status === 400)) return "sent";
  console.error("Sending a sign-in code failed:", res.status, await res.text());
  return "failed";
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  user: { id: string; email?: string };
}

const toSession = (t: TokenResponse): Session => ({ userId: t.user.id, email: t.user.email ?? "", access: t.access_token, refresh: t.refresh_token, authAt: authTime(t.access_token) });

export async function verifyCode(env: Env, email: string, code: string): Promise<Session | null> {
  const res = await auth(env, "/verify", { body: { type: "email", email, token: code } });
  return res.ok ? toSession((await res.json()) as TokenResponse) : null;
}

async function refreshSession(env: Env, refresh: string): Promise<Session | null> {
  const res = await auth(env, "/token?grant_type=refresh_token", { body: { refresh_token: refresh } });
  return res.ok ? toSession((await res.json()) as TokenResponse) : null;
}

export async function signOutEverywhere(env: Env, access: string): Promise<void> {
  await auth(env, "/logout?scope=global", { token: access }).catch(() => {});
}

/**
 * A session for someone who just signed in with a passkey (checked by us, see passkeys.ts).
 * Supabase makes it: a one-time sign-in link for their email, used straight away, never sent.
 */
export async function sessionForUser(env: Env, userId: string): Promise<Session | null> {
  if (!env.SUPABASE_SECRET_KEY) return null;
  const user = await auth(env, `/admin/users/${encodeURIComponent(userId)}`, { method: "GET", secret: true });
  const email = user.ok ? ((await user.json()) as { email?: string }).email : undefined;
  if (!email) return null;
  const link = await auth(env, "/admin/generate_link", { body: { type: "magiclink", email }, secret: true });
  if (!link.ok) {
    console.error("Making a passkey session failed:", link.status, await link.text());
    return null;
  }
  const l = (await link.json()) as { hashed_token?: string; properties?: { hashed_token?: string } };
  const tokenHash = l.hashed_token ?? l.properties?.hashed_token;
  if (!tokenHash) return null;
  const res = await auth(env, "/verify", { body: { type: "magiclink", token_hash: tokenHash } });
  const session = res.ok ? toSession((await res.json()) as TokenResponse) : null;
  return session?.userId === userId ? session : null;
}

/** Remove the sign-in record (and email) from Supabase. Needs the secret key. */
export async function deleteAuthUser(env: Env, userId: string): Promise<boolean> {
  if (!env.SUPABASE_SECRET_KEY) return false;
  const res = await auth(env, `/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE", secret: true });
  if (!res.ok && res.status !== 404) console.error("Deleting a sign-in failed:", res.status, await res.text());
  return res.ok || res.status === 404;
}

// --- Access token checks -----------------------------------------------------

type Jwk = JsonWebKey & { kid: string; alg?: string };
let keyCache: { url: string; at: number; keys: Jwk[] } | null = null;

async function signingKeys(env: Env, force = false): Promise<Jwk[]> {
  const url = `${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
  if (!force && keyCache?.url === url && Date.now() - keyCache.at < 10 * 60_000) return keyCache.keys;
  const res = await fetch(url);
  if (!res.ok) return keyCache?.url === url ? keyCache.keys : [];
  const { keys } = (await res.json()) as { keys: Jwk[] };
  keyCache = { url, at: Date.now(), keys };
  return keys;
}

const ALGS: Record<string, { import: Parameters<typeof crypto.subtle.importKey>[2]; verify: Parameters<typeof crypto.subtle.verify>[0] }> = {
  ES256: { import: { name: "ECDSA", namedCurve: "P-256" }, verify: { name: "ECDSA", hash: "SHA-256" } },
  RS256: { import: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, verify: "RSASSA-PKCS1-v1_5" },
};

/** The user ID and email in a valid access token, "expired" if it was valid but is old, or null. */
export async function checkAccessToken(env: Env, token: string): Promise<{ userId: string; email: string; authAt: number } | "expired" | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  let header: { alg: string; kid?: string };
  let claims: { sub?: string; email?: string; iss?: string; aud?: string | string[]; exp?: number };
  try {
    header = JSON.parse(b64urlText(h));
    claims = JSON.parse(b64urlText(p));
  } catch {
    return null;
  }
  const alg = ALGS[header.alg];
  if (!alg) return null;
  let jwk = (await signingKeys(env)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await signingKeys(env, true)).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const { kid: _kid, alg: _alg, ...material } = jwk;
  const key = await crypto.subtle.importKey("jwk", { ...material, key_ops: ["verify"] }, alg.import, false, ["verify"]);
  if (!(await crypto.subtle.verify(alg.verify, key, b64urlBytes(s), new TextEncoder().encode(`${h}.${p}`)))) return null;

  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== `${env.SUPABASE_URL}/auth/v1` || !auds.includes("authenticated") || !claims.sub) return null;
  if (!(typeof claims.exp === "number" && claims.exp > Date.now() / 1000 + 10)) return "expired";
  return { userId: claims.sub, email: claims.email ?? "", authAt: authTime(token) };
}

/** When the person behind a token last signed in: Supabase lists each way they proved it (amr). */
function authTime(token: string): number {
  try {
    const claims = JSON.parse(b64urlText(token.split(".")[1] ?? "")) as { amr?: { timestamp?: number }[] };
    return Math.max(0, ...(claims.amr ?? []).map((a) => (typeof a.timestamp === "number" ? a.timestamp * 1000 : 0)));
  } catch {
    return 0;
  }
}

function b64urlBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function b64urlText(s: string): string {
  return new TextDecoder().decode(b64urlBytes(s));
}

// --- Cookies -----------------------------------------------------------------

const SESSION_DAYS = 180;

function secure(env: Env): boolean {
  return env.SITE_ORIGIN.startsWith("https:");
}

/** __Host- cookies can't be set by subdomains or for other paths. Plain names on http://localhost. */
export function cookieName(env: Env, name: string): string {
  return secure(env) ? `__Host-${name}` : name;
}

export function setCookie(env: Env, name: string, value: string, opts: { maxAge: number; readable?: boolean }): string {
  return [
    `${cookieName(env, name)}=${value}`,
    "Path=/",
    `Max-Age=${opts.maxAge}`,
    "SameSite=Lax",
    ...(opts.readable ? [] : ["HttpOnly"]),
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
export function sessionCookies(env: Env, s: Session): string[] {
  const maxAge = SESSION_DAYS * 86400;
  return [setCookie(env, "zaisma", `${s.access}~${s.refresh}`, { maxAge }), setCookie(env, "zaisma_in", "1", { maxAge, readable: true })];
}

export function clearSessionCookies(env: Env): string[] {
  return [setCookie(env, "zaisma", "", { maxAge: 0 }), setCookie(env, "zaisma_in", "", { maxAge: 0, readable: true })];
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
