import {
  accountById,
  b64url,
  checkRedirectUrl,
  createSignInCode,
  hasSignInGrant,
  isClientSecretRight,
  isIdOf,
  redirectUrlsOf,
  signInAppById,
  takeSignInCode,
  useSignInGrant,
  type Account,
  type SignInApp,
} from "@zaisma/core";
import { authConfigured, currentSession, type Session } from "./auth.ts";
import type { Env } from "./env.ts";
import { html, layout, message, scriptTags } from "./html.ts";
import { authorizeMcp, handleMcpSignIn, isMcpClientId, tokenMcp } from "./mcp-sign-in.ts";
import { pageScript } from "./page-scripts.ts";

/**
 * Sign in with Zaisma: a standard OpenID Connect server (the authorization code flow, with PKCE), so
 * developers' own sites and servers, and games with their own accounts, let players sign in with
 * their Zaisma account (docs/DECISIONS.md, "Sign in with Zaisma ships with Zaisma accounts in games").
 * A site learns what a game does: the player ID, the same in every game and in player passes, and with
 * the profile scope the public username. Never the email, age or anything else on the account.
 *
 *   GET  /.well-known/openid-configuration   where everything is, for any OpenID Connect library
 *   GET  /.well-known/jwks.json              the public key that signs ID tokens
 *   GET  /oauth/authorize                    the consent page, once per app; then straight back with a code
 *   POST /oauth/authorize                    Continue or Cancel on the consent page
 *   POST /oauth/token                        a code for an ID token and an access token
 *   GET  /oauth/userinfo                     the player ID and name for an access token (POST too)
 *
 * AI apps that connect to the MCP sign in through the same endpoints (mcp-sign-in.ts): their client IDs are
 * mcp_client_… IDs or metadata document URLs, handed over before the signing key, since they need none.
 *
 * Developers make sign-in apps through the developer API and MCP (developer.ts). Tokens are JWTs
 * signed with RS256, the one algorithm every OpenID Connect library takes, by the site's own key
 * (SIGN_IN_SIGNING_KEY); without it, Sign in with Zaisma is off and everything else still works.
 * Field names here are OAuth's and OpenID Connect's own (docs/NAMING.md, Exceptions).
 */

const SCOPES = ["openid", "profile"];
const TOKEN_DURATION_SEC = 3600;
const MAXIMUM_STATE_CHARACTER_COUNT = 255;
/** What the authorize step takes, in the order its links are written. */
const AUTHORIZE_FIELDS = ["response_type", "client_id", "redirect_uri", "scope", "state", "nonce", "code_challenge", "code_challenge_method", "prompt"] as const;
type AuthorizeField = (typeof AUTHORIZE_FIELDS)[number];
type AuthorizeParameters = Partial<Record<AuthorizeField, string>>;

/** What an ID token says: OpenID Connect's claims. */
interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  auth_time: number;
  nonce?: string;
  name?: string;
  preferred_username?: string;
}

/** What an access token says: enough for userinfo to answer, and nothing for any other call. */
interface AccessTokenClaims {
  iss: string;
  sub: string;
  aud: string;
  client_id: string;
  scope: string;
  iat: number;
  exp: number;
}

// --- The signing key ---------------------------------------------------------------

const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

interface SignInKey {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicJwk: JsonWebKey & { kid: string };
}

let loaded: { secret: string; key: Promise<SignInKey> } | null = null;

/** The site's RS256 key, from SIGN_IN_SIGNING_KEY (a private RSA JWK), or null when it isn't set. */
function signInKey(env: Env): Promise<SignInKey> | null {
  const secret = env.SIGN_IN_SIGNING_KEY;
  if (!secret || !authConfigured(env)) return null;
  if (loaded?.secret !== secret) loaded = { secret, key: loadSignInKey(secret) };
  return loaded.key;
}

async function loadSignInKey(secret: string): Promise<SignInKey> {
  const jwk = JSON.parse(secret) as JsonWebKey;
  if (jwk.kty !== "RSA" || !jwk.n || !jwk.e || !jwk.d) throw new Error("SIGN_IN_SIGNING_KEY must be a private RSA JWK");
  // Only the key's own parts: a JWK's key_ops or ext could clash with how it's used here.
  const publicParts = { kty: jwk.kty, n: jwk.n, e: jwk.e };
  const privateKey = await crypto.subtle.importKey("jwk", { ...publicParts, d: jwk.d, p: jwk.p, q: jwk.q, dp: jwk.dp, dq: jwk.dq, qi: jwk.qi }, RS256, false, ["sign"]);
  const publicKey = await crypto.subtle.importKey("jwk", publicParts, RS256, false, ["verify"]);
  const keyId = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(jwk.n))).slice(0, 16);
  return { privateKey, publicKey, publicJwk: { ...publicParts, kid: keyId, alg: "RS256", use: "sig" } };
}

const textToB64url = (text: string) => b64url(new TextEncoder().encode(text));

function b64urlToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function signToken(key: SignInKey, claims: IdTokenClaims | AccessTokenClaims, tokenType: "JWT" | "at+jwt"): Promise<string> {
  const signed = `${textToB64url(JSON.stringify({ alg: "RS256", typ: tokenType, kid: key.publicJwk.kid }))}.${textToB64url(JSON.stringify(claims))}`;
  return `${signed}.${b64url(await crypto.subtle.sign(RS256, key.privateKey, new TextEncoder().encode(signed)))}`;
}

/** An access token's claims when Zaisma signed it for userinfo and it hasn't expired; null otherwise. */
async function readAccessToken(env: Env, key: SignInKey, token: string): Promise<AccessTokenClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0]!))) as { alg?: string; typ?: string; kid?: string };
    if (header.alg !== "RS256" || header.typ !== "at+jwt" || header.kid !== key.publicJwk.kid) return null;
    if (!(await crypto.subtle.verify(RS256, key.publicKey, b64urlToBytes(parts[2]!), new TextEncoder().encode(`${parts[0]}.${parts[1]}`)))) return null;
    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]!))) as AccessTokenClaims;
    const nowSec = Math.floor(Date.now() / 1000);
    return claims.iss === env.SITE_ORIGIN && claims.aud === userinfoUrl(env) && typeof claims.exp === "number" && claims.exp > nowSec ? claims : null;
  } catch {
    return null;
  }
}

const userinfoUrl = (env: Env) => `${env.SITE_ORIGIN}/oauth/userinfo`;

// --- Routes --------------------------------------------------------------------------

/** Answers for other sites' servers and pages: open to any origin, never cached. */
export const OPEN = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };

export async function handleSignIn(request: Request, env: Env, path: string): Promise<Response | null> {
  // The MCP's own discovery and registration, and AI apps signing in to it: none of it signs anything.
  const mcpSignIn = await handleMcpSignIn(request, env, path);
  if (mcpSignIn) return mcpSignIn;
  const isWellKnown = path === "/.well-known/openid-configuration" || path === "/.well-known/jwks.json";
  if (!isWellKnown && !["/oauth/authorize", "/oauth/token", "/oauth/userinfo"].includes(path)) return null;
  const method = request.method;
  if (method === "OPTIONS" && path !== "/oauth/authorize") return new Response(null, { status: 204, headers: { ...OPEN, "Access-Control-Max-Age": "86400" } });
  if ((path === "/oauth/authorize" || path === "/oauth/token") && isMcpClientId(await clientIdOf(request, path))) {
    return path === "/oauth/authorize" ? authorizeMcp(request, env) : tokenMcp(request, env);
  }
  const keyLoading = signInKey(env);
  if (!keyLoading) {
    if (path === "/oauth/authorize") return message(env, "Sign in with Zaisma isn't on yet", "This site asked you to sign in with Zaisma, which isn't switched on yet. Try again later.", 404);
    return Response.json({ error: "temporarily_unavailable", error_description: "Sign in with Zaisma isn't switched on yet." }, { status: 404, headers: OPEN });
  }
  const key = await keyLoading;

  if (isWellKnown) {
    if (method !== "GET" && method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: OPEN });
    const cached = { ...OPEN, "Cache-Control": "public, max-age=3600" };
    if (path === "/.well-known/jwks.json") return Response.json({ keys: [key.publicJwk] }, { headers: cached });
    return Response.json(authorizationServerMetadata(env, false), { headers: cached });
  }
  if (path === "/oauth/authorize") return authorize(request, env);
  if (path === "/oauth/token") return token(request, env, key);
  return userinfo(request, env, key);
}

/**
 * Where everything is: the OpenID Connect document (forMcp false) and the OAuth one AI apps read before signing in to
 * the MCP (RFC 8414, forMcp true), from one place so they never drift. Without the signing key, the MCP's leaves out
 * what only Sign in with Zaisma's ID tokens need.
 */
export function authorizationServerMetadata(env: Env, forMcp: boolean): Record<string, unknown> {
  const origin = env.SITE_ORIGIN;
  const hasIdTokens = !forMcp || signInKey(env) !== null;
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    ...(hasIdTokens ? { userinfo_endpoint: userinfoUrl(env), jwks_uri: `${origin}/.well-known/jwks.json` } : {}),
    scopes_supported: [...SCOPES, "mcp"],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    ...(hasIdTokens ? { subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"] } : {}),
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
    code_challenge_methods_supported: ["S256"],
    ...(hasIdTokens ? { claims_supported: ["iss", "sub", "aud", "iat", "exp", "auth_time", "nonce", "name", "preferred_username"] } : {}),
    prompt_values_supported: ["none", "consent"],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
    service_documentation: "https://github.com/zaisma/zaisma/blob/main/docs/DEVELOPER-API.md#sign-in-with-zaisma",
  };
}

/** The client_id a sign-in names, read without using up the request: from the link, the form, or HTTP Basic. */
async function clientIdOf(request: Request, path: string): Promise<string> {
  if (request.method !== "POST") return new URL(request.url).searchParams.get("client_id") ?? "";
  try {
    const credentials = clientCredentialsOf(request, await request.clone().formData());
    return "clientId" in credentials ? credentials.clientId : "";
  } catch {
    return path === "/oauth/authorize" ? (new URL(request.url).searchParams.get("client_id") ?? "") : "";
  }
}

/** The app's ID and secret: by HTTP Basic (client_secret_basic), or client_id and client_secret in the form. */
export function clientCredentialsOf(request: Request, form: FormData): { clientId: string; clientSecret: string; isBasic: boolean } | { error: Response } {
  const basic = request.headers.get("authorization")?.match(/^Basic\s+(\S+)$/i)?.[1];
  if (!basic) return { clientId: String(form.get("client_id") ?? ""), clientSecret: String(form.get("client_secret") ?? ""), isBasic: false };
  try {
    const [basicId = "", ...rest] = atob(basic).split(":");
    const formDecode = (text: string) => decodeURIComponent(text.replace(/\+/g, " "));
    return { clientId: formDecode(basicId), clientSecret: formDecode(rest.join(":")), isBasic: true };
  } catch {
    return { error: tokenError("invalid_client", "The Authorization header isn't Basic client_id:client_secret.", 401, { "WWW-Authenticate": 'Basic realm="Zaisma"' }) };
  }
}

// --- Authorize: the consent page -----------------------------------------------------

type Checked =
  /** The link itself is broken (an unknown app, a redirect URL it didn't register): say so here, never send anyone on. */
  | { brokenLinkReason: string }
  /** The app and where it goes back are right, but something else isn't: tell the app. */
  | { app: SignInApp; redirectUrl: string; state: string | null; error: string; description: string }
  | { app: SignInApp; redirectUrl: string; state: string | null; scopes: string[]; codeChallenge: string | null; nonce: string | null; prompt: string | null; parameters: AuthorizeParameters };

async function checkAuthorize(env: Env, given: (name: string) => string | null): Promise<Checked> {
  const parameters: AuthorizeParameters = {};
  for (const name of AUTHORIZE_FIELDS) {
    const fieldValue = given(name);
    if (fieldValue) parameters[name] = fieldValue;
  }
  const clientId = parameters.client_id ?? "";
  const app = isIdOf("sign_in_app", clientId) ? await signInAppById(env.DB, clientId) : null;
  if (!app) return { brokenLinkReason: "the site it came from isn't set up for Sign in with Zaisma (its client_id is unknown)" };
  const checkedUrl = checkRedirectUrl(parameters.redirect_uri ?? "");
  const redirectUrl = "redirectUrl" in checkedUrl ? checkedUrl.redirectUrl : null;
  if (!redirectUrl || !redirectUrlsOf(app).includes(redirectUrl)) return { brokenLinkReason: `it would send you back to an address ${app.name} didn't register (redirect_uri)` };
  const state = parameters.state ?? null;
  const back = { app, redirectUrl, state: state && state.length <= MAXIMUM_STATE_CHARACTER_COUNT ? state : null };
  const refuse = (error: string, description: string): Checked => ({ ...back, error, description });
  if (state && state.length > MAXIMUM_STATE_CHARACTER_COUNT) return refuse("invalid_request", `state is over ${MAXIMUM_STATE_CHARACTER_COUNT} characters.`);
  if (parameters.response_type !== "code") return refuse("unsupported_response_type", "Zaisma only does the authorization code flow: send response_type=code.");
  const scopes = (parameters.scope ?? "").split(" ").filter(Boolean);
  if (!scopes.includes("openid")) return refuse("invalid_scope", 'scope needs openid: send scope "openid profile".');
  const unknownScope = scopes.find((scope) => !SCOPES.includes(scope));
  if (unknownScope) return refuse("invalid_scope", `Zaisma doesn't share ${unknownScope}: only openid (the player ID) and profile (the player's username). Never an email.`);
  const codeChallenge = parameters.code_challenge ?? null;
  if (codeChallenge && (parameters.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge))) return refuse("invalid_request", "PKCE takes code_challenge_method=S256 and a 43-character code_challenge.");
  if (!codeChallenge && app.kind === "public") return refuse("invalid_request", "A public app needs PKCE: send code_challenge and code_challenge_method=S256.");
  const nonce = parameters.nonce ?? null;
  if (nonce && nonce.length > MAXIMUM_STATE_CHARACTER_COUNT) return refuse("invalid_request", `nonce is over ${MAXIMUM_STATE_CHARACTER_COUNT} characters.`);
  return { ...back, scopes: [...new Set(scopes)], codeChallenge, nonce, prompt: parameters.prompt ?? null, parameters };
}

/** The authorize link again, written by us: what sign-in sends players back to once they're in. */
const authorizePath = (parameters: AuthorizeParameters) => `/oauth/authorize?${new URLSearchParams(AUTHORIZE_FIELDS.filter((name) => parameters[name]).map((name) => [name, parameters[name]!])).toString()}`;

/** Back to the app with the code or the error, and the issuer, so it knows the answer is Zaisma's (RFC 9207). */
export function backUrl(env: Env, redirectUrl: string, state: string | null, answer: Record<string, string>): string {
  const url = new URL(redirectUrl);
  for (const [name, answerValue] of Object.entries(answer)) url.searchParams.set(name, answerValue);
  if (state) url.searchParams.set("state", state);
  url.searchParams.set("iss", env.SITE_ORIGIN);
  return url.href;
}

export function redirect(to: string, cookies: string[] = []): Response {
  const response = new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store" } });
  for (const cookie of cookies) response.headers.append("Set-Cookie", cookie);
  return response;
}

async function authorize(request: Request, env: Env): Promise<Response> {
  const isPost = request.method === "POST";
  if (!isPost && request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  if (isPost) {
    // Continue only from our own consent page.
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return new Response("Bad origin", { status: 403 });
  }
  const form = isPost ? await request.formData() : null;
  const query = new URL(request.url).searchParams;
  const checked = await checkAuthorize(env, (name) => (form ? (form.get(name) as string | null) : query.get(name)));
  if ("brokenLinkReason" in checked) return message(env, "This sign-in link doesn't work", `It can't be used because ${checked.brokenLinkReason}. Tell whoever runs the site you came from.`, 400);
  if ("error" in checked) return redirect(backUrl(env, checked.redirectUrl, checked.state, { error: checked.error, error_description: checked.description }));

  const session = await currentSession(request, env);
  const account = session ? await accountById(env.DB, session.userId) : null;
  const cookies = session?.cookies ?? [];
  if (!session || !account) {
    if (checked.prompt === "none") return redirect(backUrl(env, checked.redirectUrl, checked.state, { error: "login_required", error_description: "The player isn't signed in to Zaisma." }));
    // Signed in but never finished making the account: finish it first, then come back here.
    return redirect(`${session ? "/join" : "/signin"}?next=${encodeURIComponent(authorizePath(checked.parameters))}`, cookies);
  }

  if (isPost) {
    if (form?.get("decision") !== "allow") return redirect(backUrl(env, checked.redirectUrl, checked.state, { error: "access_denied", error_description: "The player chose Cancel." }), cookies);
    return redirect(await sendCode(env, checked, account, session), cookies);
  }

  const isAllowed = checked.prompt !== "consent" && (await hasSignInGrant(env.DB, account.id, checked.app.id));
  if (isAllowed) {
    const back = await sendCode(env, checked, account, session);
    // Straight from the app's own page: back at once. From our own sign-in pages, a form led here, and
    // browsers hold a form's whole chain of redirects to its page's form-action: so a page that moves on.
    if (request.headers.get("sec-fetch-site") !== "same-origin") return redirect(back, cookies);
    return withCookies(continuePage(env, checked.app, back), cookies);
  }
  if (checked.prompt === "none") return redirect(backUrl(env, checked.redirectUrl, checked.state, { error: "consent_required", error_description: "The player hasn't said yes to this app yet." }), cookies);
  return withCookies(await consentPage(env, checked, account), cookies);
}

type Allowed = Extract<Checked, { scopes: string[] }>;

/** The player said yes (now or before): a one-use code, and the address that takes it back to the app. */
async function sendCode(env: Env, checked: Allowed, account: Account, session: Session): Promise<string> {
  await useSignInGrant(env.DB, account.id, checked.app.id);
  const code = await createSignInCode(env.DB, {
    sign_in_app_id: checked.app.id,
    account_id: account.id,
    redirect_url: checked.redirectUrl,
    code_challenge: checked.codeChallenge,
    nonce: checked.nonce,
    scope: checked.scopes.join(" "),
    signed_in_at_ms: session.signedInAtMs,
  });
  return backUrl(env, checked.redirectUrl, checked.state, { code });
}

export function withCookies(response: Response, cookies: string[]): Response {
  for (const cookie of cookies) response.headers.append("Set-Cookie", cookie);
  return response;
}

async function consentPage(env: Env, checked: Allowed, account: Account): Promise<Response> {
  const { app } = checked;
  const developer = await env.DB.prepare("SELECT accounts.username AS name FROM owners JOIN accounts ON accounts.id = owners.account_id WHERE owners.id = ?").bind(app.owner_id).first<{ name: string }>();
  const backTo = new URL(checked.redirectUrl);
  const sharesName = checked.scopes.includes("profile");
  const response = layout(env, {
    title: `Sign in to ${app.name} · Zaisma`,
    isPrivate: true,
    // The Continue button's answer goes on to the app, which a page's form-action has to allow.
    formTargets: [backTo.origin],
    body: html`<div class="narrow">
<h1>Sign in to ${app.name}</h1>
<p class="lead">with your Zaisma account, ${account.username}.</p>
<p>${app.name} gets your player ID${sharesName ? " and your username" : ""}, the same as games on Zaisma see. Never your email, your age or anything else on your account.</p>
<p class="muted">${app.name} is run by ${developer ? `${developer.name}, a developer on Zaisma` : "a developer on Zaisma"}, not by Zaisma. After this you go back to <strong>${backTo.host}</strong>.</p>
<form class="row" method="post" action="/oauth/authorize">
${AUTHORIZE_FIELDS.filter((name) => checked.parameters[name]).map((name) => html`<input type="hidden" name="${name}" value="${checked.parameters[name]!}">`)}
<button class="btn" type="submit" name="decision" value="allow" autofocus>Continue</button>
<button class="btn ghost" type="submit" name="decision" value="cancel">Cancel</button>
</form>
<p class="muted small">You can remove ${app.name} any time from <a href="/account#sign-ins">your account</a>.</p>
</div>`,
  });
  return response;
}

const BACK_TO_APP_SCRIPT = pageScript("back-to-app", `location.replace(document.getElementById("back").href);`);

/** Signed in on our own pages: move on to the app from a page, since a redirect would be held to the sign-in form. */
function continuePage(env: Env, app: SignInApp, back: string): Response {
  const response = layout(env, {
    title: `Back to ${app.name} · Zaisma`,
    isPrivate: true,
    body: html`<div class="narrow">
<h1>Back to ${app.name}</h1>
<p class="lead">You're signed in. Taking you back now.</p>
<a class="btn" id="back" href="${back}">Back to ${app.name}</a>
${scriptTags(BACK_TO_APP_SCRIPT)}
</div>`,
  });
  return response;
}

// --- Token -------------------------------------------------------------------------------

export function tokenError(error: string, description: string, httpStatus = 400, headers: Record<string, string> = {}): Response {
  return Response.json({ error, error_description: description }, { status: httpStatus, headers: { ...OPEN, "Cache-Control": "no-store", ...headers } });
}

async function token(request: Request, env: Env, key: SignInKey): Promise<Response> {
  if (request.method !== "POST") return tokenError("invalid_request", "The token call is a POST.", 405);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return tokenError("invalid_request", "Send the token call as application/x-www-form-urlencoded.");
  }
  const field = (name: string) => String(form.get(name) ?? "");
  const credentials = clientCredentialsOf(request, form);
  if ("error" in credentials) return credentials.error;
  const { clientId, clientSecret, isBasic: basic } = credentials;
  const app = isIdOf("sign_in_app", clientId) ? await signInAppById(env.DB, clientId) : null;
  if (!app) return tokenError("invalid_client", "client_id isn't a sign-in app's ID. list_sign_in_apps has them.", 401);
  if (app.kind === "confidential" && !(await isClientSecretRight(app, clientSecret))) {
    return tokenError("invalid_client", "The client secret is wrong or missing. Make a new one with update_sign_in_app (replace_client_secret: true) if it's lost.", 401, basic ? { "WWW-Authenticate": 'Basic realm="Zaisma"' } : {});
  }
  if (field("grant_type") !== "authorization_code") return tokenError("unsupported_grant_type", "Zaisma only takes grant_type=authorization_code.");

  const code = await takeSignInCode(env.DB, field("code"));
  if (!code || code.sign_in_app_id !== app.id) return tokenError("invalid_grant", "The code is unknown, used or expired: each works once, for 2 minutes, for the app it was made for.");
  const checkedUrl = checkRedirectUrl(field("redirect_uri"));
  if (!("redirectUrl" in checkedUrl) || checkedUrl.redirectUrl !== code.redirect_url) return tokenError("invalid_grant", "redirect_uri isn't the one the sign-in was sent to.");
  const verifier = field("code_verifier");
  if (code.code_challenge) {
    const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    if (!verifier || challenge !== code.code_challenge) return tokenError("invalid_grant", "code_verifier doesn't match the code_challenge the sign-in started with.");
  } else if (verifier) {
    return tokenError("invalid_grant", "code_verifier was sent, but the sign-in started without a code_challenge.");
  }
  const account = await accountById(env.DB, code.account_id);
  if (!account?.player_id) return tokenError("invalid_grant", "The player's account is gone.");

  const scopes = code.scope.split(" ");
  const issuedAtSec = Math.floor(Date.now() / 1000);
  const idClaims: IdTokenClaims = {
    iss: env.SITE_ORIGIN,
    sub: account.player_id,
    aud: app.id,
    iat: issuedAtSec,
    exp: issuedAtSec + TOKEN_DURATION_SEC,
    auth_time: Math.floor(code.signed_in_at_ms / 1000),
    ...(code.nonce ? { nonce: code.nonce } : {}),
    ...(scopes.includes("profile") ? { name: account.username, preferred_username: account.username } : {}),
  };
  const accessClaims: AccessTokenClaims = { iss: env.SITE_ORIGIN, sub: account.player_id, aud: userinfoUrl(env), client_id: app.id, scope: code.scope, iat: issuedAtSec, exp: issuedAtSec + TOKEN_DURATION_SEC };
  return Response.json(
    { access_token: await signToken(key, accessClaims, "at+jwt"), token_type: "Bearer", expires_in: TOKEN_DURATION_SEC, id_token: await signToken(key, idClaims, "JWT"), scope: code.scope },
    { headers: { ...OPEN, "Cache-Control": "no-store" } },
  );
}

// --- Userinfo -----------------------------------------------------------------------------

async function userinfo(request: Request, env: Env, key: SignInKey): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: OPEN });
  const refuse = (description: string) =>
    Response.json({ error: "invalid_token", error_description: description }, { status: 401, headers: { ...OPEN, "Cache-Control": "no-store", "WWW-Authenticate": `Bearer error="invalid_token", error_description="${description}"` } });
  const accessToken = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? "";
  const claims = accessToken ? await readAccessToken(env, key, accessToken) : null;
  if (!claims) return refuse("The access token is missing, expired or not from Zaisma.");
  const account = await env.DB.prepare("SELECT id, username FROM accounts WHERE player_id = ?").bind(claims.sub).first<{ id: string; username: string }>();
  // A player who removed the app, or deleted their account, is no longer shared.
  if (!account || !(await hasSignInGrant(env.DB, account.id, claims.client_id))) return refuse("The player removed this app, or their account is gone.");
  return Response.json({ sub: claims.sub, ...(claims.scope.split(" ").includes("profile") ? { name: account.username, preferred_username: account.username } : {}) }, { headers: { ...OPEN, "Cache-Control": "no-store" } });
}
