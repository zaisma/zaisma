import { env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccount, createApiKey, createSignInApp, personOwner } from "@zaisma/core";
import { dailyCleanup } from "../../apps/site/src/cleanup.ts";
import { TOOLS } from "../../apps/site/src/mcp.ts";
import { API_KEYS } from "../../apps/site/src/schemas.ts";
import { letPublish } from "../helpers.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";
import { pageScriptNames, strictScriptProblems } from "../strict-scripts.ts";
import { defaultScrollbarProblems } from "../own-scrollbars.ts";

/** AI apps connect to the MCP by signing in (docs/DECISIONS.md, "AI apps connect to the MCP by signing in."). */

const SITE = "https://zaisma.test";
const SUPABASE = "https://supabase.test";
const CALLBACK = "https://claude.test/api/mcp/auth_callback";
const METADATA_URL = "https://claude.test/oauth/mcp-client.json";
const VERIFIER = "a-verifier-that-is-long-enough-for-pkce-0123456789";

const b64url = (bytes: ArrayBuffer | Uint8Array | string) =>
  btoa(typeof bytes === "string" ? bytes : String.fromCharCode(...new Uint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const sha256 = async (bytes: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
const textBytes = (text: string) => new TextEncoder().encode(text);
let challenge = "";

// --- Supabase's signing key, so a test browser can hold a session, and a stand-in for apps' metadata documents ---

let supabaseKeys: CryptoKeyPair;
let supabaseJwk: JsonWebKey;
let realFetch: typeof fetch;
let metadataDocument: Record<string, unknown> | null = null;
const metadataFetches: string[] = [];

beforeAll(async () => {
  supabaseKeys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  supabaseJwk = (await crypto.subtle.exportKey("jwk", supabaseKeys.publicKey)) as JsonWebKey;
  realFetch = globalThis.fetch;
  challenge = b64url(await sha256(textBytes(VERIFIER)));
});

beforeEach(async () => {
  metadataDocument = null;
  metadataFetches.length = 0;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === SUPABASE) return Promise.resolve(url.pathname.endsWith("/.well-known/jwks.json") ? Response.json({ keys: [{ ...supabaseJwk, kid: "test-key", alg: "ES256" }] }) : Response.json({}));
    if (url.href === METADATA_URL) {
      metadataFetches.push(url.href);
      return Promise.resolve(metadataDocument ? Response.json(metadataDocument) : new Response("gone", { status: 404 }));
    }
    return realFetch(input, init);
  });
  await env.DB.exec(
    "DELETE FROM connected_app_codes; DELETE FROM connected_app_tokens; DELETE FROM mcp_clients; DELETE FROM sign_in_codes; DELETE FROM sign_in_apps; DELETE FROM security_events; DELETE FROM security_places; DELETE FROM api_keys; DELETE FROM passkeys; DELETE FROM session_proofs; DELETE FROM audit_log; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;",
  );
});

afterEach(() => vi.unstubAllGlobals());

/** A browser with a cookie jar, signed in to an account through a Supabase session. */
class Browser {
  jar = new Map<string, string>();
  ip = `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  async go(path: string, form?: Record<string, string> | URLSearchParams, init: { method?: string; body?: string; origin?: string } = {}): Promise<Response> {
    const response = await SELF.fetch(`${SITE}${path}`, {
      method: init.method ?? (form ? "POST" : "GET"),
      body: init.body ?? (form ? new URLSearchParams(form) : undefined),
      headers: { cookie: [...this.jar].map(([name, cookieValue]) => `${name}=${cookieValue}`).join("; "), "cf-connecting-ip": this.ip, ...(form || init.body ? { origin: init.origin ?? SITE } : {}) },
      redirect: "manual",
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair, ...attributes] = cookie.split("; ");
      const name = pair!.slice(0, pair!.indexOf("="));
      if (attributes.includes("Max-Age=0")) this.jar.delete(name);
      else this.jar.set(name, pair!.slice(pair!.indexOf("=") + 1));
    }
    if ((response.headers.get("content-type") ?? "").startsWith("text/html")) {
      const page = await response.clone().text();
      expect(strictScriptProblems(page, response.headers.get("content-security-policy")), path).toEqual([]);
      expect(defaultScrollbarProblems(page), path).toEqual([]);
    }
    return response;
  }
}

async function signedIn(accountId: string): Promise<Browser> {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "ES256", kid: "test-key", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ sub: accountId, email: "", aud: "authenticated", iss: `${SUPABASE}/auth/v1`, exp: nowSec + 3600, iat: nowSec, amr: [{ method: "password", timestamp: nowSec }], session_id: crypto.randomUUID() }));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, supabaseKeys.privateKey, textBytes(`${header}.${claims}`));
  const browser = new Browser();
  browser.jar.set("__Host-zaisma", `${header}.${claims}.${b64url(signature)}~r-test`);
  return browser;
}

// --- A software passkey: what a phone or laptop does when it signs a tap ---

const concatenated = (...parts: Uint8Array[]) => {
  const joined = new Uint8Array(parts.reduce((byteCount, part) => byteCount + part.length, 0));
  let offsetBytes = 0;
  for (const part of parts) (joined.set(part, offsetBytes), (offsetBytes += part.length));
  return joined;
};
// WebCrypto signs as r||s; WebAuthn sends DER.
const der = (rawSignature: Uint8Array) => {
  const integer = (bytes: Uint8Array) => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    const trimmed = bytes.slice(i);
    return trimmed[0]! & 0x80 ? concatenated(new Uint8Array([2, trimmed.length + 1, 0]), trimmed) : concatenated(new Uint8Array([2, trimmed.length]), trimmed);
  };
  const body = concatenated(integer(rawSignature.slice(0, 32)), integer(rawSignature.slice(32)));
  return concatenated(new Uint8Array([0x30, body.length]), body);
};

class Device {
  keys!: CryptoKeyPair;
  id = crypto.getRandomValues(new Uint8Array(16));
  signCount = 0;
  /** Add it to the account as if it had been made there, able to approve from approvesFromAtMs. */
  async addTo(accountId: string, approvesFromAtMs = 0) {
    this.keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    await env.DB.prepare("INSERT INTO passkeys (id, account_id, public_key, algorithm_number, sign_count, name, created_at_ms, last_used_at_ms, approves_from_at_ms) VALUES (?, ?, ?, -7, 0, 'Mac', ?, NULL, ?)")
      .bind(b64url(this.id), accountId, b64url((await crypto.subtle.exportKey("spki", this.keys.publicKey)) as ArrayBuffer), Date.now(), approvesFromAtMs)
      .run();
    return this;
  }
  async sign(challengeText: string) {
    this.signCount += 1;
    const authenticatorData = concatenated(await sha256(textBytes("zaisma.test")), new Uint8Array([0x05]), new Uint8Array([0, 0, 0, this.signCount]));
    const clientData = textBytes(JSON.stringify({ type: "webauthn.get", challenge: challengeText, origin: SITE }));
    const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, this.keys.privateKey, concatenated(authenticatorData, await sha256(clientData))));
    return { passkey_id: b64url(this.id), client_data_json: b64url(clientData), authenticator_data: b64url(authenticatorData), signature: b64url(der(signature)), user_handle: "" };
  }
}

/** A tap made for a key, as the connect page's script asks for it. */
async function tapFor(browser: Browser, device: Device): Promise<Record<string, string>> {
  const options = await browser.go("/api/passkeys/tap/options", undefined, { method: "POST", body: JSON.stringify({ purpose: "key" }) });
  expect(options.status).toBe(200);
  return device.sign(String(((await options.json()) as { challenge: string }).challenge));
}

// --- The OAuth calls an AI app makes ---

/** Register an app as claude.ai's servers would (RFC 7591). */
async function registerApp(body: Record<string, unknown> = { client_name: "Claude", redirect_uris: [CALLBACK] }, ip = `10.2.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`) {
  const response = await SELF.fetch(`${SITE}/oauth/register`, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify(body) });
  return { status: response.status, answer: (await response.json()) as Record<string, any> };
}

const authorizeFields = (clientId: string, extra: Record<string, string> = {}) => ({
  response_type: "code",
  client_id: clientId,
  redirect_uri: CALLBACK,
  scope: "mcp",
  state: "state-1",
  code_challenge: challenge,
  code_challenge_method: "S256",
  resource: `${SITE}/mcp`,
  ...extra,
});
const authorizeLink = (clientId: string, extra: Record<string, string> = {}) => `/oauth/authorize?${new URLSearchParams(authorizeFields(clientId, extra))}`;

/** Continue on the connect page with a tap, and the choices sent: the code it went back with, or the page. */
async function connect(browser: Browser, device: Device, clientId: string, choices: Record<string, string> | [string, string][] = { access_level: "full", game_scope: "all", ends_after_days: "" }) {
  const form = new URLSearchParams(Array.isArray(choices) ? choices : Object.entries(choices));
  for (const [name, fieldValue] of Object.entries({ ...authorizeFields(clientId), ...(await tapFor(browser, device)), decision: "allow" })) form.set(name, fieldValue);
  const response = await browser.go("/oauth/authorize", form);
  const location = response.headers.get("location");
  return { response, code: location ? new URL(location).searchParams.get("code") : null, location };
}

async function token(fields: Record<string, string>, headers: Record<string, string> = {}) {
  const response = await SELF.fetch(`${SITE}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(fields) });
  return { status: response.status, answer: (await response.json()) as Record<string, any>, headers: response.headers };
}

const exchange = (clientId: string, code: string, extra: Record<string, string> = {}) =>
  token({ grant_type: "authorization_code", client_id: clientId, code, redirect_uri: CALLBACK, code_verifier: VERIFIER, resource: `${SITE}/mcp`, ...extra });

let nextId = 1;
async function mcpCall(name: string, toolArguments: Record<string, unknown>, bearer: string): Promise<{ status: number; result?: any; error?: any; headers: Headers }> {
  const response = await SELF.fetch(`${SITE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: toolArguments } }),
  });
  const answer = (await response.json()) as { result?: { isError?: boolean; structuredContent?: any }; error?: { data?: any } };
  if (answer.error) {
    expect(errorProblems(answer.error.data, response.status)).toEqual([]);
    return { status: response.status, error: answer.error.data.error, headers: response.headers };
  }
  const result = answer.result!;
  if (result.isError) return { status: response.status, error: result.structuredContent.error, headers: response.headers };
  const outputSchema = TOOLS.find((tool) => tool.name === name)!.outputSchema;
  if (outputSchema) expect(schemaProblems(outputSchema, result.structuredContent, name)).toEqual([]);
  return { status: response.status, result: result.structuredContent, headers: response.headers };
}

/** A developer with two games and a passkey, signed in, and Claude registered. */
async function setUp() {
  await createAccount(env.DB, { id: "dev-1", username: "Pixel_Smith", ageBand: "18+" });
  await letPublish(env.DB, "dev-1");
  const { token: fullKey } = await createApiKey(env.DB, "dev-1", "laptop");
  for (const slug of ["sky-hopper", "cave-run"]) {
    const made = await SELF.fetch(`${SITE}/api/dev/games`, { method: "POST", headers: { authorization: `Bearer ${fullKey}`, "content-type": "application/json", origin: SITE }, body: JSON.stringify({ title: slug.replace("-", " "), slug }) });
    expect(made.status).toBe(201);
  }
  const device = await new Device().addTo("dev-1");
  const browser = await signedIn("dev-1");
  const { answer } = await registerApp();
  return { device, browser, clientId: answer.client_id as string, fullKey };
}

/** Connect Claude with these choices and swap the code: its tokens. */
async function connectedTokens(choices?: Record<string, string> | [string, string][]) {
  const world = await setUp();
  const { code } = await connect(world.browser, world.device, world.clientId, choices);
  expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const { status, answer } = await exchange(world.clientId, code!);
  expect(status).toBe(200);
  return { ...world, accessToken: answer.access_token as string, refreshToken: answer.refresh_token as string };
}

describe("discovery", () => {
  it("names the MCP's sign-in server and where everything is", async () => {
    const resource = (await (await SELF.fetch(`${SITE}/.well-known/oauth-protected-resource/mcp`)).json()) as Record<string, unknown>;
    expect(resource).toMatchObject({ resource: `${SITE}/mcp`, authorization_servers: [SITE], scopes_supported: ["mcp"], bearer_methods_supported: ["header"] });
    expect(await (await SELF.fetch(`${SITE}/.well-known/oauth-protected-resource`)).json()).toEqual(resource);
    const server = (await (await SELF.fetch(`${SITE}/.well-known/oauth-authorization-server`)).json()) as Record<string, any>;
    expect(server).toMatchObject({ issuer: SITE, registration_endpoint: `${SITE}/oauth/register`, client_id_metadata_document_supported: true, code_challenge_methods_supported: ["S256"] });
    expect(server.grant_types_supported).toContain("refresh_token");
    expect(server.token_endpoint_auth_methods_supported).toContain("none");
    // Sign in with Zaisma's document is built from the same place.
    const openId = (await (await SELF.fetch(`${SITE}/.well-known/openid-configuration`)).json()) as Record<string, any>;
    expect(openId.registration_endpoint).toBe(`${SITE}/oauth/register`);
    expect(openId.scopes_supported).toEqual(["openid", "profile", "mcp"]);
  });

  it("answers the MCP without a token with where to sign in", async () => {
    const response = await SELF.fetch(`${SITE}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${SITE}/.well-known/oauth-protected-resource/mcp", scope="mcp"`);
    const answer = (await response.json()) as { error: { data: any } };
    expect(answer.error.data.error.code).toBe("no_key");
  });
});

describe("registration", () => {
  it("registers an app with https or this computer's redirect URLs, and refuses others", async () => {
    const good = await registerApp({ client_name: "Claude", redirect_uris: [CALLBACK, "http://localhost:33418/callback"], made_up_field: true });
    expect(good.status).toBe(201);
    expect(good.answer).toMatchObject({ client_name: "Claude", redirect_uris: [CALLBACK, "http://localhost:33418/callback"], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] });
    expect(good.answer.client_id).toMatch(/^mcp_client_[a-z0-9]+$/);
    expect(good.answer).not.toHaveProperty("client_secret");
    for (const redirectUri of ["javascript:alert(1)", "http://example.com/callback", `${CALLBACK}#fragment`]) {
      expect((await registerApp({ client_name: "Bad", redirect_uris: [redirectUri] })).answer.error, redirectUri).toBe("invalid_redirect_uri");
    }
    expect((await registerApp({ client_name: "Bad", redirect_uris: [CALLBACK], token_endpoint_auth_method: "private_key_jwt" })).answer.error).toBe("invalid_client_metadata");
    const confidential = await registerApp({ client_name: "Server", redirect_uris: [CALLBACK], token_endpoint_auth_method: "client_secret_post" });
    expect(confidential.answer.client_secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("allows 10 registrations a minute from one address", async () => {
    const ip = "10.3.3.3";
    for (let i = 0; i < 10; i++) expect((await registerApp(undefined, ip)).status).toBe(201);
    expect((await registerApp(undefined, ip)).status).toBe(429);
  });
});

describe("metadata documents", () => {
  it("refuses a document that names another URL, and shows a good one's name on the page", async () => {
    await createAccount(env.DB, { id: "dev-1", username: "Pixel_Smith", ageBand: "18+" });
    const browser = await signedIn("dev-1");
    metadataDocument = { client_id: "https://evil.test/client.json", client_name: "Claude", redirect_uris: [CALLBACK] };
    expect((await browser.go(authorizeLink(METADATA_URL))).status).toBe(400);
    metadataDocument = { client_id: METADATA_URL, client_name: "Claude", redirect_uris: [CALLBACK] };
    const page = await browser.go(authorizeLink(METADATA_URL));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Connect Claude to your games");
    expect(await env.DB.prepare("SELECT registration_kind FROM mcp_clients WHERE id = ?").bind(METADATA_URL).first()).toEqual({ registration_kind: "metadata_document" });
    // Read again only after a day.
    await browser.go(authorizeLink(METADATA_URL));
    expect(metadataFetches).toHaveLength(2);
  });
});

describe("the connect page", () => {
  it("refuses a link without PKCE, for another resource, or back to an address the app didn't register", async () => {
    const { browser, clientId } = await setUp();
    const noPkce = await browser.go(authorizeLink(clientId, { code_challenge: "" }));
    expect(new URL(noPkce.headers.get("location")!).searchParams.get("error")).toBe("invalid_request");
    const otherResource = await browser.go(authorizeLink(clientId, { resource: "https://elsewhere.test/mcp" }));
    expect(new URL(otherResource.headers.get("location")!).searchParams.get("error")).toBe("invalid_target");
    const otherScope = await browser.go(authorizeLink(clientId, { scope: "mcp admin" }));
    expect(new URL(otherScope.headers.get("location")!).searchParams.get("error")).toBe("invalid_scope");
    const elsewhere = await browser.go(authorizeLink(clientId, { redirect_uri: "https://evil.test/callback" }));
    expect(elsewhere.status).toBe(400);
    expect(elsewhere.headers.get("location")).toBeNull();
    expect(await elsewhere.text()).toContain("doesn&#39;t work");
  });

  it("sends a signed-out developer to sign in first, and never answers prompt=none with a code", async () => {
    const { clientId, browser } = await setUp();
    const signedOut = await new Browser().go(authorizeLink(clientId));
    const signinUrl = new URL(signedOut.headers.get("location")!, SITE);
    expect(signinUrl.pathname).toBe("/signin");
    expect(signinUrl.searchParams.get("next")).toBe(authorizeLink(clientId));
    const silent = await browser.go(authorizeLink(clientId, { prompt: "none" }));
    expect(new URL(silent.headers.get("location")!).searchParams.get("error")).toBe("consent_required");
  });

  it("offers Full on all games with a Change link, names where it goes back, and runs only Zaisma's scripts", async () => {
    const { browser, clientId } = await setUp();
    const page = await browser.go(authorizeLink(clientId));
    const text = await page.text();
    expect(text).toContain("Connect Claude to your games");
    expect(text).toContain("as Pixel_Smith");
    expect(text).toContain("Full, all my games, never ends");
    expect(text).toContain("It can't make API keys. After this you go back to <strong>claude.test</strong>.");
    expect(text).toContain('name="connect_step" value="connect"');
    // Plain glass in Zaisma's look: a pane, the runner, and a key's choices as the gallery's choice cards, Full picked.
    expect(text).toContain('<section class="glass glass-pane medium"');
    expect(text).not.toContain('class="steel"');
    expect(text).toMatch(/<input class="choice-input" type="radio" name="access_level" id="connect-level-full" value="full" checked>/);
    expect(text).toContain('<input type="hidden" name="ends_after_days" value="">');
    expect(pageScriptNames(text)).toEqual(expect.arrayContaining(["passkeys", "access-choices", "connect-app"]));
    expect(page.headers.get("content-security-policy")).toContain("https://claude.test");
  });

  it("shows the host as the name of an app that calls itself Zaisma", async () => {
    const { browser } = await setUp();
    const { answer } = await registerApp({ client_name: "Zaisma Official", redirect_uris: [CALLBACK] });
    expect(await (await browser.go(authorizeLink(answer.client_id))).text()).toContain("Connect claude.test to your games");
  });

  it("adds a passkey first when there's none, and says when a new one can connect apps", async () => {
    await createAccount(env.DB, { id: "dev-2", username: "No_Passkey", ageBand: "18+" });
    const { answer } = await registerApp();
    const none = await (await (await signedIn("dev-2")).go(authorizeLink(answer.client_id))).text();
    expect(none).toContain('id="passkey-first"');
    await new Device().addTo("dev-2", Date.now() + 86400_000);
    const waiting = await (await (await signedIn("dev-2")).go(authorizeLink(answer.client_id))).text();
    expect(waiting).toContain("Your new passkey can connect apps from");
    expect(waiting).not.toContain('name="connect_step"');
  });
});

describe("connecting", () => {
  it("needs a passkey tap, and only from Zaisma's own page", async () => {
    const { browser, clientId, device } = await setUp();
    const form = new URLSearchParams({ ...authorizeFields(clientId), access_level: "full", game_scope: "all", decision: "allow" });
    const untapped = await browser.go("/oauth/authorize", form);
    expect(untapped.status).toBe(200);
    expect(await untapped.text()).toContain("Connecting an app needs a tap on your passkey");
    const tapped = new URLSearchParams(form);
    for (const [name, fieldValue] of Object.entries(await tapFor(browser, device))) tapped.set(name, fieldValue);
    expect((await browser.go("/oauth/authorize", tapped, { origin: "https://evil.test" })).status).toBe(403);
    expect(await env.DB.prepare("SELECT COUNT(*) AS code_count FROM connected_app_codes").first()).toEqual({ code_count: 0 });
  });

  it("makes a connection limited to what was chosen", async () => {
    const { accessToken } = await connectedTokens([["access_level", "read"], ["game_scope", "some"], ["game_slugs", "cave-run"], ["game_slugs", "not-mine"], ["ends_after_days", ""]]);
    const { result } = await mcpCall("get_access", {}, accessToken);
    expect(result.access).toMatchObject({ api_key_name: "Claude", access_level: "read" });
    expect(result.access.area_access.version_access).toBe("read");
    expect(result.access.area_access.webhook_access).toBe("none");
    expect((await mcpCall("get_game", { slug: "sky-hopper" }, accessToken)).error.code).toBe("key_not_allowed");
    expect((await mcpCall("publish_version", { slug: "cave-run", version_id: "version_abc" }, accessToken)).error.code).toBe("key_not_allowed");
  });

  it("allows 10 connected apps besides 10 keys, and the same app's reconnect replaces its old one", async () => {
    const { browser, device, clientId } = await setUp();
    for (let i = 0; i < 9; i++) {
      await env.DB.prepare("INSERT INTO api_keys (id, account_id, name, secret_hash, access_level, created_at_ms, kind, mcp_client_id, connected_app_host) VALUES (?, 'dev-1', ?, 'x', 'full', ?, 'connected_app', ?, 'other.test')")
        .bind(`connection${String(i).padStart(10, "0")}`, `App ${i}`, Date.now(), `mcp_client_other${i}`)
        .run();
    }
    const first = await connect(browser, device, clientId);
    expect((await exchange(clientId, first.code!)).status).toBe(200);
    // Ten now: another app is refused, but Claude connecting again replaces its own.
    const { answer: other } = await registerApp({ client_name: "Other", redirect_uris: [CALLBACK] });
    const refused = await connect(browser, device, other.client_id);
    expect(refused.code).toBeNull();
    expect(await refused.response.text()).toContain("You can have up to 10 connected apps. Remove one on your account page first.");
    const again = await connect(browser, device, clientId);
    expect((await exchange(clientId, again.code!)).status).toBe(200);
    expect(await env.DB.prepare("SELECT COUNT(*) AS connection_count FROM api_keys WHERE kind = 'connected_app' AND name = 'Claude'").first()).toEqual({ connection_count: 1 });
    // Keys are counted apart: one key exists, so the page still makes keys.
    const keysPage = await (await browser.go("/account")).text();
    expect(keysPage).toContain('id="key-new"');
  });
});

describe("tokens", () => {
  it("refuses a wrong verifier, a reused code and another app's code", async () => {
    const { browser, device, clientId } = await setUp();
    const wrongVerifier = await connect(browser, device, clientId);
    expect((await exchange(clientId, wrongVerifier.code!, { code_verifier: "not-the-verifier-that-started-the-sign-in-000000" })).answer.error).toBe("invalid_grant");
    const good = await connect(browser, device, clientId);
    expect((await exchange(clientId, good.code!)).status).toBe(200);
    expect((await exchange(clientId, good.code!)).answer.error).toBe("invalid_grant");
    const { answer: other } = await registerApp({ client_name: "Other", redirect_uris: [CALLBACK] });
    const stolen = await connect(browser, device, clientId);
    expect((await exchange(other.client_id, stolen.code!)).answer.error).toBe("invalid_grant");
  });

  it("answer both tokens; the access token works at the MCP and nowhere else", async () => {
    const { accessToken, refreshToken } = await connectedTokens();
    expect(accessToken).toMatch(/^zat_[a-z0-9]{20}_[A-Za-z0-9_-]{43}$/);
    expect(refreshToken).toMatch(/^zrt_[a-z0-9]{20}_[A-Za-z0-9_-]{43}$/);
    const { result } = await mcpCall("list_games", {}, accessToken);
    expect(result.games).toHaveLength(2);
    const rest = await SELF.fetch(`${SITE}/api/dev/games`, { headers: { authorization: `Bearer ${accessToken}` } });
    expect(rest.status).toBe(401);
    const restAnswer = await rest.json();
    expect(errorProblems(restAnswer, 401)).toEqual([]);
    expect(restAnswer).toMatchObject({ error: { code: "token_not_for_api", field: "Authorization" } });
    // A refresh token is no way in at all.
    expect((await mcpCall("list_games", {}, refreshToken)).error.code).toBe("bad_key");
  });

  it("stop after the hour, saying so", async () => {
    const { accessToken } = await connectedTokens();
    await env.DB.prepare("UPDATE connected_app_tokens SET expires_at_ms = ? WHERE token_kind = 'access'").bind(Date.now() - 1).run();
    const ended = await mcpCall("list_games", {}, accessToken);
    expect(ended.status).toBe(401);
    expect(ended.error.code).toBe("access_token_ended");
    expect(ended.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("refresh into new ones once, and a refresh token used again later removes the connection", async () => {
    const { accessToken, refreshToken, clientId } = await connectedTokens();
    const refreshed = await token({ grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.headers.get("cache-control")).toBe("no-store");
    expect((await mcpCall("list_games", {}, accessToken)).error.code).toBe("bad_key");
    expect((await mcpCall("list_games", {}, refreshed.answer.access_token)).result.games).toHaveLength(2);
    // Another app can't use it.
    const { answer: other } = await registerApp({ client_name: "Other", redirect_uris: [CALLBACK] });
    expect((await token({ grant_type: "refresh_token", client_id: other.client_id, refresh_token: refreshed.answer.refresh_token })).answer.error).toBe("invalid_grant");
    // Within a minute: a retry race, refused, and the connection stays.
    expect((await token({ grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken })).answer.error).toBe("invalid_grant");
    expect((await mcpCall("list_games", {}, refreshed.answer.access_token)).result.games).toHaveLength(2);
    // Later: only a stolen copy does that, so the connection goes.
    await env.DB.prepare("UPDATE connected_app_tokens SET rotated_at_ms = ? WHERE rotated_at_ms IS NOT NULL").bind(Date.now() - 61_000).run();
    expect((await token({ grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken })).answer.error).toBe("invalid_grant");
    expect((await mcpCall("list_games", {}, refreshed.answer.access_token)).error.code).toBe("bad_key");
    const { fullKey } = { fullKey: (await createApiKey(env.DB, "dev-1", "after")).token };
    const { result } = await mcpCall("get_activity", {}, fullKey);
    expect(result.events.find((event: { kind: string }) => event.kind === "connected_app_removed")).toMatchObject({ done_by: "zaisma", subject_name: "Claude" });
    expect(result.events.map((event: { kind: string }) => event.kind)).toContain("connected_app_added");
  });

  it("stop at once when the connection is removed on the account page", async () => {
    const { accessToken, refreshToken, clientId, browser } = await connectedTokens();
    const connection = await env.DB.prepare("SELECT id FROM api_keys WHERE kind = 'connected_app'").first<{ id: string }>();
    await browser.go(`/account/keys/${connection!.id}/revoke`, {});
    expect((await mcpCall("list_games", {}, accessToken)).error.code).toBe("bad_key");
    expect((await token({ grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken })).answer.error).toBe("invalid_grant");
    expect(await env.DB.prepare("SELECT COUNT(*) AS token_count FROM connected_app_tokens").first()).toEqual({ token_count: 0 });
  });

  it("stop at a connection's end date", async () => {
    const dated = await connectedTokens({ access_level: "full", game_scope: "all", ends_after_days: "7" });
    await env.DB.prepare("UPDATE api_keys SET ends_at_ms = ? WHERE kind = 'connected_app'").bind(Date.now() - 1).run();
    expect((await mcpCall("list_games", {}, dated.accessToken)).error.code).toBe("key_ended");
  });

  it("never let a connected app make a key or approve another connection", async () => {
    const { accessToken, clientId } = await connectedTokens();
    const keys = await SELF.fetch(`${SITE}/account/keys`, { method: "POST", headers: { authorization: `Bearer ${accessToken}`, origin: SITE, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ name: "sneaky", access_level: "full", game_scope: "all" }), redirect: "manual" });
    expect(keys.status).toBe(303);
    expect(keys.headers.get("location")).toContain("/signin");
    const approve = await SELF.fetch(`${SITE}/oauth/authorize`, { method: "POST", headers: { authorization: `Bearer ${accessToken}`, origin: SITE, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...authorizeFields(clientId), decision: "allow" }), redirect: "manual" });
    expect(new URL(approve.headers.get("location")!, SITE).pathname).toBe("/signin");
    expect(await env.DB.prepare("SELECT COUNT(*) AS key_count FROM api_keys").first()).toEqual({ key_count: 2 });
  });

  it("leave sign-in apps' scopes as they were", async () => {
    await createAccount(env.DB, { id: "dev-1", username: "Pixel_Smith", ageBand: "18+" });
    const owner = await personOwner(env.DB, "dev-1");
    const { app } = await createSignInApp(env.DB, { ownerId: owner.id, name: "My site", kind: "public", redirectUrls: [CALLBACK] });
    const browser = await signedIn("dev-1");
    const asked = await browser.go(`/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: app.id, redirect_uri: CALLBACK, scope: "openid mcp", code_challenge: challenge, code_challenge_method: "S256" })}`);
    expect(new URL(asked.headers.get("location")!).searchParams.get("error")).toBe("invalid_scope");
  });
});

describe("the keys list", () => {
  it("lists a connection beside the keys, in list_api_keys and on the account page", async () => {
    const { fullKey, browser } = await connectedTokens();
    const { result } = await mcpCall("list_api_keys", {}, fullKey);
    expect(schemaProblems(API_KEYS, result)).toEqual([]);
    expect(result.api_keys.map((key: { api_key_name: string; kind: string; connected_app_host: string | null }) => [key.api_key_name, key.kind, key.connected_app_host])).toEqual([
      ["Claude", "connected_app", "claude.test"],
      ["laptop", "api_key", null],
    ]);
    const page = await (await browser.go("/account")).text();
    expect(page).toContain("connected app · claude.test");
  });

  it("never lets an API key's shape reach a connection's row", async () => {
    const { accessToken } = await connectedTokens();
    const connectionId = accessToken.split("_")[1]!;
    const response = await SELF.fetch(`${SITE}/api/dev/games`, { headers: { authorization: `Bearer zsk_${connectionId}_${"A".repeat(43)}` } });
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("bad_key");
  });

  it("cleans up codes, ended tokens and apps nobody connected", async () => {
    const { browser, device, clientId } = await setUp();
    await connect(browser, device, clientId);
    await env.DB.exec("UPDATE connected_app_codes SET expires_at_ms = 1; UPDATE mcp_clients SET created_at_ms = 1;");
    await dailyCleanup(env);
    expect(await env.DB.prepare("SELECT COUNT(*) AS code_count FROM connected_app_codes").first()).toEqual({ code_count: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS client_count FROM mcp_clients").first()).toEqual({ client_count: 0 });
  });
});
