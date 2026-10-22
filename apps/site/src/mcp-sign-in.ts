import {
  ACCESS_AREAS,
  ACCESS_LEVELS,
  AREA_ACCESS_CHOICES,
  MAXIMUM_CONNECTED_APP_COUNT,
  accountById,
  b64url,
  checkKeyScope,
  checkRedirectUrl,
  connectedAppsReplacedBy,
  createConnectedApp,
  gamesOwnedBy,
  isIdOf,
  issueConnectedAppTokens,
  liveConnectedAppCount,
  newId,
  passkeysFor,
  refreshConnectedApp,
  revokeApiKey,
  sha256Hex,
  type Account,
  type KeyScope,
  type Passkey,
} from "@zaisma/core";
import { AREA_LABELS, CHOICE_LABELS, LEVEL_LABELS, PASSKEY_TAP_FIELDS, ACCESS_CHOICES_SCRIPT, keyMakingState, keyScopeFromForm, passkeyTapFromForm, type PasskeyState } from "./account.ts";
import { glassPane } from "./components/foundations.ts";
import { row, stack, type LayoutItem } from "./components/layout.ts";
import { cutButton, runButton, textLink } from "./components/actions.ts";
import { checkField, choiceCards, selectField } from "./components/inputs.ts";
import { connectionAddressOf, currentSession } from "./auth.ts";
import { waitEndsText } from "./email-codes.ts";
import type { Env } from "./env.ts";
import { glassMessage, html, layout, raw, scriptTags, type Raw } from "./html.ts";
import { pageScript } from "./page-scripts.ts";
import { PASSKEY_SCRIPT, checkPasskeyTap, usedChallengeCookie } from "./passkeys.ts";
import { logAccountChange, logSecurityEvent, seedKeyPlace, whereOfPerson } from "./security-log.ts";
import { OPEN, authorizationServerMetadata, backUrl, clientCredentialsOf, redirect, tokenError, withCookies } from "./sign-in.ts";

/**
 * The MCP's side of Zaisma's OAuth server (docs/DECISIONS.md, "AI apps connect to the MCP by signing in."): claude.ai,
 * ChatGPT and other apps that can't send a key connect to zaisma.com/mcp by signing in, as the MCP authorization
 * spec says. The developer chooses on one page what the app may do (Full on all games by default, with a Change link
 * to a key's choices) and taps their passkey; the connection is an API key row of kind connected_app, listed with the
 * keys and never able to make one. Its tokens are opaque, stored by hash, and work only at the MCP.
 *
 *   GET  /.well-known/oauth-protected-resource[/mcp]   which server signs in to the MCP (RFC 9728)
 *   GET  /.well-known/oauth-authorization-server       where everything is (RFC 8414)
 *   POST /oauth/register                               an app registers itself (RFC 7591)
 *   GET  /oauth/authorize, POST /oauth/authorize       the connect page, for an MCP client_id (sign-in.ts hands it over)
 *   POST /oauth/token                                  a code or refresh token for tokens, for an MCP client_id
 *
 * An app is named by a registered mcp_client_… ID, or by the URL of its own metadata document, which ties its name to
 * a site it controls. Nothing here signs anything, so it works without Sign in with Zaisma's key.
 * Field names here are OAuth's own (docs/NAMING.md, Exceptions).
 */

const DAY_MS = 86400_000;
/** What a connection is granted, whatever the app asks for: what it may do is chosen on the page, not by scope. */
const MCP_SCOPE = "mcp";
/** Words some apps send because the server lists them: accepted and dropped. */
const ACCEPTED_SCOPES = ["mcp", "openid", "profile", "offline_access"];
const CODE_DURATION_MS = 2 * 60_000;
const MAXIMUM_STATE_CHARACTER_COUNT = 255;
const MAXIMUM_REDIRECT_URL_COUNT = 10;
const MAXIMUM_CLIENT_NAME_CHARACTER_COUNT = 40;
const MAXIMUM_METADATA_DOCUMENT_BYTES = 5120;
const METADATA_FETCH_TIMEOUT_MS = 5000;
const AUTH_METHODS = ["none", "client_secret_basic", "client_secret_post"] as const;
type AuthMethod = (typeof AUTH_METHODS)[number];
/** What the connect page's link takes, in the order its links are written. */
const AUTHORIZE_FIELDS = ["response_type", "client_id", "redirect_uri", "scope", "state", "code_challenge", "code_challenge_method", "resource", "prompt"] as const;
type AuthorizeField = (typeof AUTHORIZE_FIELDS)[number];
type AuthorizeParameters = Partial<Record<AuthorizeField, string>>;

/** A row of mcp_clients. */
interface McpClient {
  id: string;
  client_name: string;
  /** JSON list. */
  redirect_urls: string;
  registration_kind: "registration" | "metadata_document";
  token_endpoint_auth_method: AuthMethod;
  client_secret_sha256: string | null;
  fetched_at_ms: number | null;
  created_at_ms: number;
}

const mcpUrl = (env: Env) => `${env.SITE_ORIGIN}/mcp`;
// Functions, since sign-in.ts and this file import each other and OPEN isn't there yet while this one loads.
const cached = () => ({ ...OPEN, "Cache-Control": "public, max-age=3600" });
const notCached = () => ({ ...OPEN, "Cache-Control": "no-store" });

export async function handleMcpSignIn(request: Request, env: Env, path: string): Promise<Response | null> {
  const isProtectedResource = path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp";
  const isServerMetadata = path === "/.well-known/oauth-authorization-server";
  if (!isProtectedResource && !isServerMetadata && path !== "/oauth/register") return null;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...OPEN, "Access-Control-Max-Age": "86400" } });
  if (path === "/oauth/register") return register(request, env);
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: OPEN });
  if (isServerMetadata) return Response.json(authorizationServerMetadata(env, true), { headers: cached() });
  return Response.json(
    {
      resource: mcpUrl(env),
      authorization_servers: [env.SITE_ORIGIN],
      scopes_supported: [MCP_SCOPE],
      bearer_methods_supported: ["header"],
      resource_name: "Zaisma",
      resource_documentation: "https://github.com/zaisma/zaisma/blob/main/docs/DEVELOPER-API.md#the-mcp",
    },
    { headers: cached() },
  );
}

/** Whether a client_id is an AI app's: a registered mcp_client_… ID, or a metadata document's https URL with a path. */
export function isMcpClientId(clientId: string): boolean {
  if (isIdOf("mcp_client", clientId)) return true;
  try {
    const url = new URL(clientId);
    return url.protocol === "https:" && url.pathname !== "/" && url.href === clientId;
  } catch {
    return false;
  }
}

/** Redirect URLs as given: 1 to 10, each https (or http on this computer) with no fragment. The tidied list, or why not. */
function checkRedirectUrls(given: unknown): { redirectUrls: string[] } | { error: string } {
  if (!Array.isArray(given) || given.length === 0 || given.length > MAXIMUM_REDIRECT_URL_COUNT) return { error: `redirect_uris must be a list of 1 to ${MAXIMUM_REDIRECT_URL_COUNT} URLs.` };
  const redirectUrls: string[] = [];
  for (const redirectUri of given) {
    const checked = checkRedirectUrl(redirectUri);
    if ("error" in checked) return checked;
    redirectUrls.push(checked.redirectUrl);
  }
  return { redirectUrls: [...new Set(redirectUrls)] };
}

/** The app's own name, 1 to 40 characters, or null. */
function clientNameOf(given: unknown): string | null {
  const name = typeof given === "string" ? given.trim().replace(/\s+/g, " ") : "";
  return name && name.length <= MAXIMUM_CLIENT_NAME_CHARACTER_COUNT ? name : null;
}

const redirectUrlsOf = (client: McpClient) => JSON.parse(client.redirect_urls) as string[];

// --- Registration (RFC 7591) -----------------------------------------------------------

async function register(request: Request, env: Env): Promise<Response> {
  const refuse = (error: "invalid_client_metadata" | "invalid_redirect_uri", description: string, httpStatus = 400) => Response.json({ error, error_description: description }, { status: httpStatus, headers: notCached() });
  if (request.method !== "POST") return refuse("invalid_client_metadata", "Register with a POST of JSON.", 405);
  if (env.REGISTER_LIMIT && !(await env.REGISTER_LIMIT.limit({ key: connectionAddressOf(request) ?? "unknown" })).success) {
    return Response.json({ error: "slow_down", error_description: "Too many registrations from this address in the last minute. Wait a minute." }, { status: 429, headers: { ...notCached(), "Retry-After": "60" } });
  }
  let given: Record<string, unknown>;
  try {
    given = (await request.json()) as Record<string, unknown>;
  } catch {
    return refuse("invalid_client_metadata", "The body isn't JSON.");
  }
  if (!given || typeof given !== "object" || Array.isArray(given)) return refuse("invalid_client_metadata", "The body isn't a JSON object.");
  const checkedUrls = checkRedirectUrls(given.redirect_uris);
  if ("error" in checkedUrls) return refuse("invalid_redirect_uri", checkedUrls.error);
  const authMethod = given.token_endpoint_auth_method ?? "none";
  if (!AUTH_METHODS.includes(authMethod as AuthMethod)) return refuse("invalid_client_metadata", `token_endpoint_auth_method must be one of ${AUTH_METHODS.join(", ")}.`);
  // Fields it doesn't know are dropped, as RFC 7591 says: this is OAuth's door, not the developer API.
  const clientName = clientNameOf(given.client_name) ?? new URL(checkedUrls.redirectUrls[0]!).host;
  const id = newId("mcp_client");
  const clientSecret = authMethod === "none" ? null : b64url(crypto.getRandomValues(new Uint8Array(32)));
  const createdAtMs = Date.now();
  await env.DB.prepare("INSERT INTO mcp_clients (id, client_name, redirect_urls, registration_kind, token_endpoint_auth_method, client_secret_sha256, fetched_at_ms, created_at_ms) VALUES (?, ?, ?, 'registration', ?, ?, NULL, ?)")
    .bind(id, clientName, JSON.stringify(checkedUrls.redirectUrls), authMethod, clientSecret ? await sha256Hex(new TextEncoder().encode(clientSecret)) : null, createdAtMs)
    .run();
  return Response.json(
    {
      client_id: id,
      client_name: clientName,
      redirect_uris: checkedUrls.redirectUrls,
      token_endpoint_auth_method: authMethod,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_id_issued_at: Math.floor(createdAtMs / 1000),
      ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
    },
    { status: 201, headers: notCached() },
  );
}

// --- Finding the app ---------------------------------------------------------------------

/** The app a client_id names: a registered one, or one read from its metadata document (fetched again after a day). Null otherwise. */
async function mcpClientFor(env: Env, clientId: string): Promise<McpClient | null> {
  if (!isMcpClientId(clientId)) return null;
  const stored = await env.DB.prepare("SELECT * FROM mcp_clients WHERE id = ?").bind(clientId).first<McpClient>();
  if (isIdOf("mcp_client", clientId)) return stored;
  if (stored?.fetched_at_ms && Date.now() - stored.fetched_at_ms < DAY_MS) return stored;
  const document = await fetchMetadataDocument(clientId);
  if (!document) return null;
  const nowMs = Date.now();
  await env.DB.prepare(
    `INSERT INTO mcp_clients (id, client_name, redirect_urls, registration_kind, token_endpoint_auth_method, client_secret_sha256, fetched_at_ms, created_at_ms) VALUES (?, ?, ?, 'metadata_document', 'none', NULL, ?, ?)
     ON CONFLICT (id) DO UPDATE SET client_name = excluded.client_name, redirect_urls = excluded.redirect_urls, fetched_at_ms = excluded.fetched_at_ms`,
  )
    .bind(clientId, document.clientName, JSON.stringify(document.redirectUrls), nowMs, nowMs)
    .run();
  return { id: clientId, client_name: document.clientName, redirect_urls: JSON.stringify(document.redirectUrls), registration_kind: "metadata_document", token_endpoint_auth_method: "none", client_secret_sha256: null, fetched_at_ms: nowMs, created_at_ms: stored?.created_at_ms ?? nowMs };
}

/** An app's metadata document: https, no redirects, 5 seconds and 5,120 bytes at most, naming itself by its own URL. */
async function fetchMetadataDocument(url: string): Promise<{ clientName: string; redirectUrls: string[] } | null> {
  try {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(METADATA_FETCH_TIMEOUT_MS), headers: { accept: "application/json", "user-agent": "zaisma.com" } });
    if (response.status !== 200 || !response.body) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let readBytes = 0;
    for (;;) {
      const { done: isDone, value: chunk } = await reader.read();
      if (isDone) break;
      readBytes += chunk.byteLength;
      if (readBytes > MAXIMUM_METADATA_DOCUMENT_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(chunk);
    }
    const bytes = new Uint8Array(readBytes);
    let offsetBytes = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offsetBytes);
      offsetBytes += chunk.byteLength;
    }
    const document = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    if (!document || typeof document !== "object" || document.client_id !== url) return null;
    // A metadata document's app has no secret with Zaisma, so it signs in as a public app.
    if ((document.token_endpoint_auth_method ?? "none") !== "none") return null;
    const checkedUrls = checkRedirectUrls(document.redirect_uris);
    if ("error" in checkedUrls) return null;
    return { clientName: clientNameOf(document.client_name) ?? new URL(url).host, redirectUrls: checkedUrls.redirectUrls };
  } catch {
    return null;
  }
}

/** The name the page and the key list show: the app's own, unless it says Zaisma, when it's the host it sends you back to. */
function connectedAppNameOf(client: McpClient, redirectUrl: string): string {
  return /zaisma/i.test(client.client_name) ? new URL(redirectUrl).host : client.client_name;
}

// --- Authorize: the connect page -------------------------------------------------------

type Checked =
  /** The link itself is broken (an unknown app, a redirect URL it didn't register): say so here, never send anyone on. */
  | { brokenLinkReason: string }
  /** The app and where it goes back are right, but something else isn't: tell the app. */
  | { client: McpClient; redirectUrl: string; state: string | null; error: string; description: string }
  | { client: McpClient; redirectUrl: string; state: string | null; codeChallenge: string; resourceUrl: string; prompt: string | null; parameters: AuthorizeParameters };
type Allowed = Extract<Checked, { codeChallenge: string }>;

async function checkAuthorize(env: Env, given: (name: string) => string | null): Promise<Checked> {
  const parameters: AuthorizeParameters = {};
  for (const name of AUTHORIZE_FIELDS) {
    const fieldValue = given(name);
    if (fieldValue) parameters[name] = fieldValue;
  }
  const client = await mcpClientFor(env, parameters.client_id ?? "");
  if (!client) return { brokenLinkReason: "the AI app it came from isn't known to Zaisma, or its details couldn't be read (its client_id)" };
  const checkedUrl = checkRedirectUrl(parameters.redirect_uri ?? "");
  const redirectUrl = "redirectUrl" in checkedUrl ? checkedUrl.redirectUrl : null;
  if (!redirectUrl || !redirectUrlsOf(client).includes(redirectUrl)) return { brokenLinkReason: `it would send you back to an address ${client.client_name} didn't register (redirect_uri)` };
  const state = parameters.state ?? null;
  const back = { client, redirectUrl, state: state && state.length <= MAXIMUM_STATE_CHARACTER_COUNT ? state : null };
  const refuse = (error: string, description: string): Checked => ({ ...back, error, description });
  if (state && state.length > MAXIMUM_STATE_CHARACTER_COUNT) return refuse("invalid_request", `state is over ${MAXIMUM_STATE_CHARACTER_COUNT} characters.`);
  if (parameters.response_type !== "code") return refuse("unsupported_response_type", "Zaisma only does the authorization code flow: send response_type=code.");
  const unknownScope = (parameters.scope ?? "").split(" ").find((scope) => scope && !ACCEPTED_SCOPES.includes(scope));
  if (unknownScope) return refuse("invalid_scope", `Zaisma's MCP has one scope, mcp; ${unknownScope} isn't one. What the app may do is chosen on the connect page.`);
  const codeChallenge = parameters.code_challenge ?? "";
  if (parameters.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) return refuse("invalid_request", "PKCE is required: send code_challenge_method=S256 and a 43-character code_challenge.");
  const resourceUrl = parameters.resource ?? mcpUrl(env);
  if (resourceUrl !== mcpUrl(env) && resourceUrl !== `${mcpUrl(env)}/`) return refuse("invalid_target", `Zaisma signs in only to its MCP: send resource=${mcpUrl(env)}.`);
  return { ...back, codeChallenge, resourceUrl: mcpUrl(env), prompt: parameters.prompt ?? null, parameters };
}

/** The connect page's link again, written by us: where sign-in sends developers back to once they're in. */
const authorizePath = (parameters: AuthorizeParameters) => `/oauth/authorize?${new URLSearchParams(AUTHORIZE_FIELDS.filter((name) => parameters[name]).map((name) => [name, parameters[name]!])).toString()}`;

export async function authorizeMcp(request: Request, env: Env): Promise<Response> {
  const isPost = request.method === "POST";
  if (!isPost && request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  if (isPost) {
    // Continue only from our own connect page.
    const origin = request.headers.get("origin");
    if (origin !== new URL(request.url).origin) return new Response("Bad origin", { status: 403 });
  }
  const form = isPost ? await request.formData() : null;
  const query = new URL(request.url).searchParams;
  const checked = await checkAuthorize(env, (name) => (form ? (form.get(name) as string | null) : query.get(name)));
  if ("brokenLinkReason" in checked) return glassMessage(env, "This sign-in link doesn't work", `It can't be used because ${checked.brokenLinkReason}. Remove Zaisma from the app's connectors and add it again.`, 400);
  if ("error" in checked) return redirect(backUrl(env, checked.redirectUrl, checked.state, { error: checked.error, error_description: checked.description }));
  // Every connection asks, with a passkey tap: there's no remembered yes to answer without a page.
  if (checked.prompt === "none") return redirect(backUrl(env, checked.redirectUrl, checked.state, { error: "consent_required", error_description: "Connecting to Zaisma always asks the developer." }));

  const session = await currentSession(request, env);
  const account = session ? await accountById(env.DB, session.userId) : null;
  const cookies = session?.cookies ?? [];
  // Signed in but never finished making the account: finish it first, then come back here.
  if (!session || !account) return redirect(`${session ? "/join" : "/signin"}?next=${encodeURIComponent(authorizePath(checked.parameters))}`, cookies);

  if (!isPost || !form) return withCookies(await connectPage(env, checked, account), cookies);
  if (form.get("decision") !== "allow") return redirect(backUrl(env, checked.redirectUrl, checked.state, { error: "access_denied", error_description: "The developer chose Cancel." }), cookies);

  const ownSlugs = new Set((await gamesOwnedBy(env.DB, account.id)).map((game) => game.slug));
  const scope = keyScopeFromForm(form, ownSlugs);
  const problem = checkKeyScope(scope);
  if (problem) return withCookies(await connectPage(env, checked, account, problem), cookies);
  const name = connectedAppNameOf(checked.client, checked.redirectUrl);
  const app = { name, mcpClientId: checked.client.id, connectedAppHost: new URL(checked.redirectUrl).host };
  if ((await liveConnectedAppCount(env.DB, account.id)) >= MAXIMUM_CONNECTED_APP_COUNT && !(await connectedAppsReplacedBy(env.DB, account.id, app)).length) {
    return withCookies(await connectPage(env, checked, account, `You can have up to ${MAXIMUM_CONNECTED_APP_COUNT} connected apps. Remove one on your account page first.`), cookies);
  }
  // A connection lasts, so it needs a tap on a passkey made for it, as a key does (an honest page asks for it; this is the backstop).
  const passkey = await checkPasskeyTap(request, env, account.id, "key", passkeyTapFromForm(form));
  if (!passkey) return withCookies(await connectPage(env, checked, account, connectRefusal(await passkeysFor(env.DB, account.id))), [...cookies, usedChallengeCookie(env)]);
  const code = await createCode(env, checked, account, name, scope);
  return redirect(backUrl(env, checked.redirectUrl, checked.state, { code }), [...cookies, usedChallengeCookie(env)]);
}

/** Why the tap didn't connect the app: no passkey, only waiting ones, or the tap didn't work. */
function connectRefusal(passkeys: Passkey[], nowMs = Date.now()): string {
  if (!passkeys.length) return "Add a passkey first: connecting an app needs one.";
  const waiting = passkeys.filter((passkey) => passkey.approves_from_at_ms > nowMs);
  if (waiting.length === passkeys.length) return `Your new passkey can connect apps from ${waitEndsText(Math.min(...waiting.map((passkey) => passkey.approves_from_at_ms)))}.`;
  return "Connecting an app needs a tap on your passkey. Try again.";
}

/** The developer said yes: a one-use code for 2 minutes, holding what the app may do. */
async function createCode(env: Env, checked: Allowed, account: Account, name: string, scope: KeyScope): Promise<string> {
  const code = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const nowMs = Date.now();
  await env.DB.prepare(
    "INSERT INTO connected_app_codes (code_sha256, mcp_client_id, account_id, redirect_url, code_challenge, resource_url, connected_app_name, access_level, area_access, game_slugs, ends_at_ms, expires_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      await sha256Hex(new TextEncoder().encode(code)),
      checked.client.id,
      account.id,
      checked.redirectUrl,
      checked.codeChallenge,
      checked.resourceUrl,
      name,
      scope.accessLevel,
      scope.accessLevel === "custom" && scope.areaAccess ? JSON.stringify(scope.areaAccess) : null,
      scope.gameSlugs ? JSON.stringify(scope.gameSlugs) : null,
      scope.endsAfterDays ? nowMs + scope.endsAfterDays * DAY_MS : null,
      nowMs + CODE_DURATION_MS,
    )
    .run();
  return code;
}

/**
 * "Connect Claude to your games": what the app may do is already Full, on all games, never ending, and Change opens
 * a key's choices in place. Continue taps the passkey (adding one first when there's none), and the app can never
 * make keys. Where it goes back to is named, since that's the real check of who's asking. Plain glass over Zaisma's
 * own background, built from the gallery's components.
 */
async function connectPage(env: Env, checked: Allowed, account: Account, error?: string): Promise<Response> {
  const { games, passkeyState, approvesFromAtMs } = await keyMakingState(env, account.id);
  const name = connectedAppNameOf(checked.client, checked.redirectUrl);
  const backTo = new URL(checked.redirectUrl);
  return layout(env, {
    title: `Connect ${name} to your games · Zaisma`,
    isPrivate: true,
    isRebuilt: true,
    viewer: { account },
    // The answer goes on to the app, which a page's form-action has to allow.
    formTargets: [backTo.origin],
    body: glassPane({
      paneSize: "medium",
      label: `Connect ${name}`,
      body: html`${stack({
        items: [
          { kind: "words", markup: html`<h1>Connect ${name} to your games</h1>` },
          { kind: "words", markup: html`<p>as ${account.username}</p>` },
          {
            kind: "block",
            markup: html`<form method="post" action="/oauth/authorize" id="connect-form" data-passkey-state="${passkeyState}" data-again="${authorizePath(checked.parameters)}">
${AUTHORIZE_FIELDS.filter((field) => checked.parameters[field]).map((field) => html`<input type="hidden" name="${field}" value="${checked.parameters[field]!}">`)}
${PASSKEY_TAP_FIELDS}
${stack({
  items: [
    { kind: "words", markup: html`<p><strong id="connect-summary">Full, all my games, never ends</strong> · <span id="connect-change">${textLink("Change", "#connect-choices")}</span></p>` },
    { kind: "block", id: "connect-choices", isHidden: true, markup: accessChoiceCards(games) },
    { kind: "block", markup: html`<p>It can't make API keys. After this you go back to <strong>${backTo.host}</strong>.</p>` },
    ...connectButtons(passkeyState, approvesFromAtMs),
    { kind: "words", markup: html`<p class="field-error" id="connect-error" role="alert"${error ? "" : raw(" hidden")}>${error ?? ""}</p>` },
  ],
})}
</form>`,
          },
          { kind: "words", markup: html`<p>You can remove it any time from ${textLink("your account", "/account#developer")}, with your API keys.</p>` },
        ],
      })}${scriptTags(PASSKEY_SCRIPT, ACCESS_CHOICES_SCRIPT, CONNECT_APP_SCRIPT)}`,
    }),
  });
}

const ENDS_CHOICES = [
  { label: "Never", choiceValue: "" },
  { label: "In 7 days", choiceValue: "7" },
  { label: "In 30 days", choiceValue: "30" },
  { label: "In 90 days", choiceValue: "90" },
  { label: "In a year", choiceValue: "365" },
];

/**
 * A key's choices, as the gallery's components, with the same fields the account page's key sends (keyScopeFromForm reads both):
 * when it ends, what it can do, which games, and for Custom each area. ACCESS_CHOICES_SCRIPT keeps them in step.
 */
function accessChoiceCards(games: { slug: string; title: string }[]): Raw {
  return html`<section class="pane-stack" data-step="what">
${selectField({ id: "connect-ends", name: "ends_after_days", label: "Ends", choices: ENDS_CHOICES, pickedValue: "" })}
${choiceCards({ id: "connect-level", name: "access_level", label: "What it can do", pickedValue: "full", choices: ACCESS_LEVELS.map((level) => ({ label: LEVEL_LABELS[level][0], choiceValue: level, text: LEVEL_LABELS[level][1] })) })}
</section>
<section class="pane-stack" data-step="games" hidden>
${choiceCards({
    id: "connect-games",
    name: "game_scope",
    label: "Which games",
    pickedValue: "all",
    choices: [{ label: "All my games", choiceValue: "all", text: "And games you make later." }, ...(games.length ? [{ label: "Only these games", choiceValue: "some", text: "It can't make games, sign-in apps or webhooks." }] : [])],
  })}
${games.length ? html`<div class="pane-stack" data-access-games>${games.map((game) => checkField({ id: `connect-game-${game.slug}`, name: "game_slugs", checkValue: game.slug, label: game.title }))}</div>` : ""}
</section>
<section class="pane-stack" data-step="areas" hidden>
${ACCESS_AREAS.map((area) =>
    choiceCards({
      id: `connect-${area}`,
      name: area,
      label: AREA_LABELS[area][0],
      pickedValue: "read",
      isCompact: true,
      choices: (AREA_ACCESS_CHOICES[area] as readonly string[]).map((choice) => ({ label: CHOICE_LABELS[choice]!, choiceValue: choice })),
    }),
  )}
</section>`;
}

/** Connect and Cancel, and the step that adds a first passkey before connecting, as the connect form's stack holds them. */
function connectButtons(passkeyState: PasskeyState, approvesFromAtMs: number | null): LayoutItem[] {
  const cancel = cutButton("Cancel", { type: "submit", name: "decision", buttonValue: "cancel" });
  if (passkeyState === "waiting" && approvesFromAtMs !== null) {
    return [{ kind: "block", markup: html`<p>Your new passkey can connect apps from ${waitEndsText(approvesFromAtMs)}.</p>` }, { kind: "block", markup: row({ widths: "fit", items: [{ kind: "control", markup: cancel }] }) }];
  }
  const firstPasskey: LayoutItem[] =
    passkeyState === "ready"
      ? []
      : [{ kind: "block", markup: html`<section class="pane-stack" data-step="passkey" hidden><h2>First, add a passkey</h2><p>Connecting an app needs your passkey, so someone who learns your password can't connect one.</p>${passkeyState === "waiting" && approvesFromAtMs !== null ? html`<p>Your new passkey can connect apps from ${waitEndsText(approvesFromAtMs)}.</p>` : html`<div id="passkey-first">${cutButton("Add a passkey", { type: "button", isFullWidth: true })}</div>`}</section>` }];
  return [...firstPasskey, { kind: "block", markup: row({ widths: "equal", items: [{ kind: "control", markup: runButton("Connect", { type: "button", name: "connect_step", buttonValue: "connect" }) }, { kind: "control", markup: cancel }] }) }];
}

// The summary follows the choices; Continue adds a passkey first when there's none, then taps it for this connection.
const CONNECT_APP_SCRIPT = pageScript("connect-app", `(() => {
  const form = document.getElementById("connect-form");
  const $ = (id) => document.getElementById(id);
  const choices = zaismaAccessChoices(form);
  const state = form.dataset.passkeyState;
  const stop = (said) => { $("connect-error").textContent = said; $("connect-error").hidden = false; };
  const passkeyStep = form.querySelector('[data-step="passkey"]');
  function show() {
    choices.sync();
    form.querySelector('[data-step="games"]').hidden = false;
    form.querySelector('[data-step="areas"]').hidden = !choices.isCustom();
    const level = form.querySelector('input[name="access_level"]:checked');
    const levelWords = level ? level.closest(".choice-card").querySelector(".choice-label").textContent.trim() : "";
    const picked = [...form.querySelectorAll('input[name="game_slugs"]:checked')];
    const gameWords = !choices.isSome() ? "all my games" : picked.length === 1 ? "only " + picked[0].closest(".check").querySelector(".check-label").textContent.trim() : picked.length + " games";
    const ends = form.querySelector('input[name="ends_after_days"]');
    const endWords = ends.value ? "ends " + document.querySelector("#connect-ends .select-value").textContent.trim().replace(/^In/, "in") : "never ends";
    $("connect-summary").textContent = levelWords + ", " + gameWords + ", " + endWords;
  }
  $("connect-change").onclick = (event) => { event.preventDefault(); $("connect-choices").hidden = false; $("connect-change").hidden = true; show(); };
  form.addEventListener("change", show);
  // The select field's pick is a hidden field, which sends no change of its own.
  form.addEventListener("click", () => setTimeout(show, 0));
  zaismaPasskeyFirst({ added: form.dataset.again, waiting: form.dataset.again }, stop);
  // Connect taps the passkey first, so it only sends the form once that's done; it's never a submit button.
  const go = form.querySelector('button[name="connect_step"]');
  if (go) go.onclick = async () => {
    $("connect-error").hidden = true;
    const said = choices.gamesProblem();
    if (said) return stop(said);
    if (state !== "ready") { if (passkeyStep) passkeyStep.hidden = false; go.hidden = true; return; }
    const tapped = await zaismaPasskeyTap("key");
    if (tapped.error) return stop(tapped.error);
    zaismaFillTap(form, tapped.tap);
    const decision = document.createElement("input");
    decision.type = "hidden";
    decision.name = "decision";
    decision.value = "allow";
    form.append(decision);
    form.submit();
  };
  show();
})();`);

// --- Token ---------------------------------------------------------------------------------

/** Whether two hex hashes are the same, in constant time. */
function isSameHash(given: string, stored: string): boolean {
  let mismatchNumber = given.length ^ stored.length;
  for (let i = 0; i < given.length; i++) mismatchNumber |= given.charCodeAt(i) ^ stored.charCodeAt(i % stored.length);
  return mismatchNumber === 0;
}

interface CodeRow {
  code_sha256: string;
  mcp_client_id: string;
  account_id: string;
  redirect_url: string;
  code_challenge: string;
  resource_url: string;
  connected_app_name: string;
  access_level: KeyScope["accessLevel"];
  area_access: string | null;
  game_slugs: string | null;
  ends_at_ms: number | null;
  expires_at_ms: number;
}

const tokensAnswer = (tokens: { accessToken: string; refreshToken: string; expiresInSec: number }) =>
  Response.json({ access_token: tokens.accessToken, token_type: "Bearer", expires_in: tokens.expiresInSec, refresh_token: tokens.refreshToken, scope: MCP_SCOPE }, { headers: notCached() });

export async function tokenMcp(request: Request, env: Env): Promise<Response> {
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
  const client = await mcpClientFor(env, credentials.clientId);
  if (!client) return tokenError("invalid_client", "client_id isn't an AI app Zaisma knows: register it at /oauth/register, or use a metadata document's URL.", 401);
  if (client.token_endpoint_auth_method !== "none") {
    const isRight = client.client_secret_sha256 !== null && credentials.clientSecret !== "" && isSameHash(await sha256Hex(new TextEncoder().encode(credentials.clientSecret)), client.client_secret_sha256);
    if (!isRight) return tokenError("invalid_client", "The client secret is wrong or missing.", 401, credentials.isBasic ? { "WWW-Authenticate": 'Basic realm="Zaisma"' } : {});
  }

  const grantType = field("grant_type");
  if (grantType === "authorization_code") {
    // Each code works once: taken as it's read, so a second try finds nothing.
    const code = await env.DB.prepare("DELETE FROM connected_app_codes WHERE code_sha256 = ? RETURNING *").bind(await sha256Hex(new TextEncoder().encode(field("code")))).first<CodeRow>();
    if (!code || code.expires_at_ms <= Date.now() || code.mcp_client_id !== client.id) return tokenError("invalid_grant", "The code is unknown, used or expired: each works once, for 2 minutes, for the app it was made for.");
    const checkedUrl = checkRedirectUrl(field("redirect_uri"));
    if (!("redirectUrl" in checkedUrl) || checkedUrl.redirectUrl !== code.redirect_url) return tokenError("invalid_grant", "redirect_uri isn't the one the sign-in was sent to.");
    const verifier = field("code_verifier");
    const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    if (!verifier || challenge !== code.code_challenge) return tokenError("invalid_grant", "code_verifier doesn't match the code_challenge the sign-in started with.");
    const resource = field("resource");
    if (resource && resource !== code.resource_url && resource !== `${code.resource_url}/`) return tokenError("invalid_target", `resource isn't the one the sign-in asked for: ${code.resource_url}.`);
    const account = await accountById(env.DB, code.account_id);
    if (!account) return tokenError("invalid_grant", "The developer's account is gone.");
    // The tap was checked on the connect page; the code is its proof.
    const key = await createConnectedApp(env.DB, account.id, {
      name: code.connected_app_name,
      mcpClientId: client.id,
      connectedAppHost: new URL(code.redirect_url).host,
      scope: { accessLevel: code.access_level, ...(code.area_access ? { areaAccess: JSON.parse(code.area_access) } : {}), gameSlugs: code.game_slugs ? (JSON.parse(code.game_slugs) as string[]) : null },
      endsAtMs: code.ends_at_ms,
    });
    await logAccountChange(request, env, account, "connected_app_added", { subjectName: key.name });
    // The app calls from its own servers: where it swapped the code counts as its own place.
    await seedKeyPlace(request, env, account.id, key.id);
    return tokensAnswer(await issueConnectedAppTokens(env.DB, key.id));
  }
  if (grantType === "refresh_token") {
    const refreshed = await refreshConnectedApp(env.DB, field("refresh_token"), client.id);
    if ("tokens" in refreshed) return tokensAnswer(refreshed.tokens);
    if (refreshed.refusal === "reused") {
      // A refresh token is used once; one used again after the grace is a stolen copy, so the connection goes.
      const { key } = refreshed;
      if (await revokeApiKey(env.DB, key.account_id, key.id)) {
        const account = await accountById(env.DB, key.account_id);
        await logSecurityEvent(env, {
          accountId: key.account_id,
          gameId: null,
          kind: "connected_app_removed",
          doneBy: "zaisma",
          apiKeyId: key.id,
          apiKeyName: key.name,
          signInKind: null,
          versionId: null,
          subjectName: key.name,
          where: whereOfPerson(request),
          isWhereKept: account?.where_used_from_enabled === 1,
          isNewPlace: false,
        });
      }
      return tokenError("invalid_grant", "This refresh token was already used, so Zaisma removed the connection. Sign in again.");
    }
    return tokenError("invalid_grant", "The refresh token is unknown, already used or its connection was removed. Sign in again if it keeps failing.");
  }
  return tokenError("unsupported_grant_type", "Zaisma takes grant_type=authorization_code or refresh_token.");
}
