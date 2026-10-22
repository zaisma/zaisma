import { newId, sha256Hex } from "./ids.ts";
import { hiddenCharacterOf } from "./shown-text.ts";
import { checkText } from "./text-filter.ts";
import { b64url } from "./webauthn.ts";

/**
 * Sign in with Zaisma (docs/DECISIONS.md, "Sign in with Zaisma ships with Zaisma accounts in games"):
 * developers' sign-in apps, the apps each player said yes to, and the one-use codes between them.
 * The OpenID Connect pages and calls themselves are the site's (apps/site/src/sign-in.ts).
 */

const now = () => Date.now();

/** confidential: keeps a client secret on its own server. public: a page or phone app, PKCE alone. */
export const SIGN_IN_APP_KINDS = ["confidential", "public"] as const;
export type SignInAppKind = (typeof SIGN_IN_APP_KINDS)[number];

export const MAXIMUM_SIGN_IN_APP_COUNT = 20;
export const MAXIMUM_REDIRECT_URL_COUNT = 10;
/** How long a code from the consent page works: long enough for a site's server to swap it, no more. */
export const SIGN_IN_CODE_DURATION_SEC = 120;

export interface SignInApp {
  id: string;
  owner_id: string;
  name: string;
  kind: SignInAppKind;
  /** A JSON list of exact URLs. */
  redirect_urls: string;
  client_secret_sha256: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}

/** An app a player said yes to, with what the account page shows of it. */
export interface SignInGrant {
  sign_in_app_id: string;
  name: string;
  redirect_urls: string;
  created_at_ms: number;
  last_used_at_ms: number;
}

/** A code from the consent page, as the token call takes it back. */
export interface SignInCode {
  sign_in_app_id: string;
  account_id: string;
  redirect_url: string;
  code_challenge: string | null;
  nonce: string | null;
  scope: string;
  signed_in_at_ms: number;
  expires_at_ms: number;
}

export const redirectUrlsOf = (app: { redirect_urls: string }): string[] => JSON.parse(app.redirect_urls) as string[];

/** An app's name, checked: what players see on the consent page, so it can't pass for Zaisma's own. */
export function checkSignInAppName(input: unknown): { name: string } | { error: string } {
  const name = typeof input === "string" ? input.normalize("NFKC").replace(/\s+/g, " ").trim() : "";
  if (!name || name.length > 60) return { error: "name is empty or over 60 characters." };
  const hidden = hiddenCharacterOf(name);
  if (hidden) return { error: `name holds ${hidden}, a character that's invisible or flips text direction.` };
  if (/z\W*a\W*i\W*s\W*m\W*a/i.test(name)) return { error: "name can't say Zaisma: players would take the app for Zaisma's own." };
  // Only the word check: a site's own address in its name ("skyhopper.io") is fine here.
  const textCheck = checkText(name);
  if (!textCheck.isAllowed && textCheck.reason === "words") return { error: "name has words that aren't allowed." };
  return { name };
}

/**
 * A redirect URL, checked and in its standard form, or why it can't be one: https, or http on this
 * computer (localhost) for development; no #fragment and no user name. Sign-ins only go back to one
 * of these, exactly.
 */
export function checkRedirectUrl(given: unknown): { redirectUrl: string } | { error: string } {
  if (typeof given !== "string" || given.length > 500) return { error: "Each redirect URL is text of up to 500 characters." };
  let url: URL;
  try {
    url = new URL(given);
  } catch {
    return { error: `${JSON.stringify(given)} isn't a whole URL.` };
  }
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) return { error: `${given} isn't https (http only works for localhost).` };
  if (url.hash || given.includes("#")) return { error: `${given} has a #fragment, which redirect URLs can't have.` };
  if (url.username || url.password) return { error: `${given} has a user name or password in it.` };
  return { redirectUrl: url.href };
}

export async function signInAppsFor(database: D1Database, ownerId: string): Promise<SignInApp[]> {
  const { results } = await database.prepare("SELECT * FROM sign_in_apps WHERE owner_id = ? ORDER BY created_at_ms").bind(ownerId).all<SignInApp>();
  return results;
}

export async function signInAppById(database: D1Database, id: string): Promise<SignInApp | null> {
  return database.prepare("SELECT * FROM sign_in_apps WHERE id = ?").bind(id).first<SignInApp>();
}

/** A new client secret: shown once, only its SHA-256 kept. */
async function newClientSecret(): Promise<{ clientSecret: string; clientSecretSha256: string }> {
  const clientSecret = b64url(crypto.getRandomValues(new Uint8Array(32)));
  return { clientSecret, clientSecretSha256: await sha256Hex(new TextEncoder().encode(clientSecret)) };
}

export async function createSignInApp(
  database: D1Database,
  input: { ownerId: string; name: string; kind: SignInAppKind; redirectUrls: string[] },
): Promise<{ app: SignInApp; clientSecret: string | null }> {
  const secret = input.kind === "confidential" ? await newClientSecret() : null;
  const createdAtMs = now();
  const app: SignInApp = {
    id: newId("sign_in_app"),
    owner_id: input.ownerId,
    name: input.name,
    kind: input.kind,
    redirect_urls: JSON.stringify(input.redirectUrls),
    client_secret_sha256: secret?.clientSecretSha256 ?? null,
    created_at_ms: createdAtMs,
    updated_at_ms: createdAtMs,
  };
  await database
    .prepare("INSERT INTO sign_in_apps (id, owner_id, name, kind, redirect_urls, client_secret_sha256, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(app.id, app.owner_id, app.name, app.kind, app.redirect_urls, app.client_secret_sha256, app.created_at_ms, app.updated_at_ms)
    .run();
  return { app, clientSecret: secret?.clientSecret ?? null };
}

/** What an update changes; replaceClientSecret asks for a new secret (the old one stops working). */
export interface SignInAppChange {
  name?: string;
  redirectUrls?: string[];
  replaceClientSecret?: boolean;
}

/** A new name or redirect URLs, and for a confidential app a new client secret when asked. */
export async function updateSignInApp(database: D1Database, app: SignInApp, change: SignInAppChange): Promise<{ app: SignInApp; clientSecret: string | null }> {
  const secret = change.replaceClientSecret && app.kind === "confidential" ? await newClientSecret() : null;
  const updated: SignInApp = {
    ...app,
    name: change.name ?? app.name,
    redirect_urls: change.redirectUrls ? JSON.stringify(change.redirectUrls) : app.redirect_urls,
    client_secret_sha256: secret?.clientSecretSha256 ?? app.client_secret_sha256,
    updated_at_ms: now(),
  };
  await database
    .prepare("UPDATE sign_in_apps SET name = ?, redirect_urls = ?, client_secret_sha256 = ?, updated_at_ms = ? WHERE id = ?")
    .bind(updated.name, updated.redirect_urls, updated.client_secret_sha256, updated.updated_at_ms, app.id)
    .run();
  return { app: updated, clientSecret: secret?.clientSecret ?? null };
}

/** An app goes for good, with every player's yes to it and its codes not yet used. */
export async function deleteSignInApp(database: D1Database, id: string): Promise<void> {
  await database.batch([
    database.prepare("DELETE FROM sign_in_codes WHERE sign_in_app_id = ?").bind(id),
    database.prepare("DELETE FROM sign_in_grants WHERE sign_in_app_id = ?").bind(id),
    database.prepare("DELETE FROM sign_in_apps WHERE id = ?").bind(id),
  ]);
}

export async function isClientSecretRight(app: SignInApp, clientSecret: string): Promise<boolean> {
  if (!app.client_secret_sha256 || !clientSecret) return false;
  return (await sha256Hex(new TextEncoder().encode(clientSecret))) === app.client_secret_sha256;
}

// --- What players said yes to ---------------------------------------------------

export async function hasSignInGrant(database: D1Database, accountId: string, signInAppId: string): Promise<boolean> {
  return Boolean(await database.prepare("SELECT 1 AS found FROM sign_in_grants WHERE account_id = ? AND sign_in_app_id = ?").bind(accountId, signInAppId).first());
}

/** The player said yes, or signed in again: either way it's in use now. */
export async function useSignInGrant(database: D1Database, accountId: string, signInAppId: string): Promise<void> {
  const usedAtMs = now();
  await database
    .prepare("INSERT INTO sign_in_grants (account_id, sign_in_app_id, created_at_ms, last_used_at_ms) VALUES (?, ?, ?, ?) ON CONFLICT (account_id, sign_in_app_id) DO UPDATE SET last_used_at_ms = excluded.last_used_at_ms")
    .bind(accountId, signInAppId, usedAtMs, usedAtMs)
    .run();
}

export async function signInGrantsFor(database: D1Database, accountId: string): Promise<SignInGrant[]> {
  const { results } = await database
    .prepare("SELECT grants.sign_in_app_id, apps.name, apps.redirect_urls, grants.created_at_ms, grants.last_used_at_ms FROM sign_in_grants grants JOIN sign_in_apps apps ON apps.id = grants.sign_in_app_id WHERE grants.account_id = ? ORDER BY grants.last_used_at_ms DESC")
    .bind(accountId)
    .all<SignInGrant>();
  return results;
}

/** The player takes their yes back: the app asks again next time, and its codes not yet used stop working. */
export async function removeSignInGrant(database: D1Database, accountId: string, signInAppId: string): Promise<void> {
  await database.batch([
    database.prepare("DELETE FROM sign_in_codes WHERE account_id = ? AND sign_in_app_id = ?").bind(accountId, signInAppId),
    database.prepare("DELETE FROM sign_in_grants WHERE account_id = ? AND sign_in_app_id = ?").bind(accountId, signInAppId),
  ]);
}

// --- Codes ---------------------------------------------------------------------

/** A one-use code for the app to swap at the token call; only its SHA-256 is kept. */
export async function createSignInCode(database: D1Database, input: Omit<SignInCode, "expires_at_ms">): Promise<string> {
  const code = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await database
    .prepare("INSERT INTO sign_in_codes (code_sha256, sign_in_app_id, account_id, redirect_url, code_challenge, nonce, scope, signed_in_at_ms, expires_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(await sha256Hex(new TextEncoder().encode(code)), input.sign_in_app_id, input.account_id, input.redirect_url, input.code_challenge, input.nonce, input.scope, input.signed_in_at_ms, now() + SIGN_IN_CODE_DURATION_SEC * 1000)
    .run();
  return code;
}

/** Takes a code back, once: a second try with the same code finds nothing. Null when unknown or expired. */
export async function takeSignInCode(database: D1Database, code: string): Promise<SignInCode | null> {
  if (!code) return null;
  const taken = await database.prepare("DELETE FROM sign_in_codes WHERE code_sha256 = ? RETURNING *").bind(await sha256Hex(new TextEncoder().encode(code))).first<SignInCode>();
  return taken && taken.expires_at_ms > now() ? taken : null;
}

export async function deleteExpiredSignInCodes(database: D1Database, nowMs = now()): Promise<void> {
  await database.prepare("DELETE FROM sign_in_codes WHERE expires_at_ms <= ?").bind(nowMs).run();
}
