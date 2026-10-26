import { createExecutionContext, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WITHDRAWAL_LINE_TEXT, accountById, addPasskey, createAccount, createApiKey, gameBySlug, hashPurchasePin, personOwner } from "@zaisma/core";
import { TOOLS } from "../../apps/site/src/mcp.ts";
import { callerFor } from "../../apps/site/src/developer.ts";
import { stripeAccountRoute } from "../../apps/site/src/stripe-account-api.ts";
import { failStaleSales } from "../../apps/site/src/buy.ts";
import worker from "../../apps/site/src/index.ts";
import { connectUrl, isLocalPreview, stripeCall, stripeOrigins } from "../../apps/site/src/stripe.ts";
import { configuredRateLimit, countingRateLimiter } from "../rate-limits.ts";
import siteWranglerText from "../../apps/site/wrangler.jsonc?raw";
import { errorProblems, schemaProblems } from "../schema-check.ts";
import { letPublish } from "../helpers.ts";

// The buy sheet (apps/site/src/buy.ts, stripe-account-api.ts, sales.ts, stripe-connect-events.ts): a developer
// connects their own Stripe account, a signed-in player confirms and pays with a saved card on it, and Stripe's
// Connect events complete, refund and take back sales. Against a stand-in for Stripe: nothing real is reached.

const SITE = "https://zaisma.test";
const SUPABASE = "https://supabase.test";
const CONNECT_EVENTS_SECRET = "whsec_test_connect";
const ACCOUNT = "acct_test_farm";
const realFetch = globalThis.fetch;
let token = "";
let nextId = 1;
let signingKeys: CryptoKeyPair;
let publicKey: JsonWebKey;
let ownerId = "";
let playerId = "";

/** What reached the stand-in for Stripe, and what it answers next. */
let stripeCalls: { host: string; path: string; form: URLSearchParams; stripeAccount: string | null; idempotencyKey: string | null }[] = [];
let emails: { to: string; subject: string; text: string }[] = [];
let charge: { status: string; amount?: number; declined?: boolean } = { status: "succeeded" };
let connectedAccount: Record<string, unknown> = {};
/** What Stripe answers when the saved-card setup is read back, and the password Supabase's stand-in accepts. */
let setupAnswer: Record<string, unknown> = {};
const RIGHT_PASSWORD = "a good password";

const b64url = (given: ArrayBuffer | string) =>
  btoa(typeof given === "string" ? given : String.fromCharCode(...new Uint8Array(given)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** A signed-in session's cookie, as Supabase would sign it, with its own session ID. */
async function accessToken(accountId: string, sessionId: string, email = `${accountId}@example.com`, signedInAtMs: number | null = Date.now()): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "ES256", kid: "buy-test-key", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ sub: accountId, email, session_id: sessionId, aud: "authenticated", iss: `${SUPABASE}/auth/v1`, exp: nowSec + 3600, iat: nowSec, amr: signedInAtMs === null ? [] : [{ method: "password", timestamp: Math.floor(signedInAtMs / 1000) }] }));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKeys.privateKey, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(signature)}`;
}

/** A signed-in session's cookie. email "<id>@no-mail.zaisma.com" is an account that never added an email. */
async function sessionCookie(accountId: string, sessionId = `session-${accountId}`, email?: string, signedInAtMs: number | null = Date.now()): Promise<string> {
  return `__Host-zaisma=${await accessToken(accountId, sessionId, email, signedInAtMs)}~r-${accountId}`;
}

/**
 * A call to the site Worker. Miniflare's rate limits count in windows of the real clock across the whole file, which runs
 * far more calls in a minute than one player or developer would, so the limits the file's calls would meet are stood in for
 * with ones that never refuse; a test that checks a limit passes its own counting one (rate-limits.ts).
 */
const unlimited = { async limit(): Promise<{ success: boolean }> { return { success: true }; } };
const callSite = (request: Request, bindings: Record<string, unknown> = {}) =>
  worker.fetch(request as Request<unknown, IncomingRequestCfProperties>, { ...env, DEV_LIMIT: unlimited, PURCHASE_LIMIT: unlimited, PASSWORD_LIMIT: unlimited, SIGNIN_LIMIT: unlimited, ...bindings } as typeof env, createExecutionContext());

async function api(path: string, init: { method?: string; body?: unknown } = {}) {
  const response = await callSite(new Request(`${SITE}/api/dev${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  }));
  const answer = (await response.json()) as any;
  if (!response.ok) expect(errorProblems(answer, response.status)).toEqual([]);
  return { status: response.status, answer };
}

async function tool(name: string, toolArguments: Record<string, unknown>): Promise<any> {
  const response = await callSite(new Request(`${SITE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: toolArguments } }),
  }));
  const { result } = (await response.json()) as any;
  if (result.isError) {
    expect(errorProblems(result.structuredContent)).toEqual([]);
    return result.structuredContent.error;
  }
  expect(schemaProblems(TOOLS.find((candidate) => candidate.name === name)!.outputSchema!, result.structuredContent, name)).toEqual([]);
  return result.structuredContent;
}

/** A call from zaisma.com's own pages, signed in as accountId (or a guest with null). */
async function player(path: string, init: { method?: string; body?: unknown; accountId?: string | null; origin?: string; sessionId?: string; email?: string; country?: string | null; bindings?: Record<string, unknown>; cookie?: string; signedInAtMs?: number | null } = {}) {
  const accountId = init.accountId === undefined ? "player-1" : init.accountId;
  const method = init.method ?? (init.body ? "POST" : "GET");
  const country = init.country === undefined ? "DE" : init.country;
  const request = new Request(`${SITE}${path}`, {
    method,
    headers: {
      ...(accountId || init.cookie ? { cookie: [accountId ? await sessionCookie(accountId, init.sessionId, init.email, init.signedInAtMs) : "", init.cookie ?? ""].filter(Boolean).join("; ") } : {}),
      ...(method !== "GET" ? { origin: init.origin ?? SITE } : {}),
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(country ? { "cf-ipcountry": country } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const response = await callSite(request, init.bindings);
  const text = await response.text();
  return { status: response.status, answer: text ? (JSON.parse(text) as any) : null, headers: response.headers };
}

/** An event on a connected account as Stripe signs it. */
async function connectEvent(type: string, object: Record<string, unknown>, account = ACCOUNT, secret = CONNECT_EVENTS_SECRET): Promise<Response> {
  const body = JSON.stringify({ id: `evt_${nextId++}`, type, account, data: { object } });
  const signedAtSec = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${signedAtSec}.${body}`)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return SELF.fetch(`${SITE}/stripe/connect-events`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": `t=${signedAtSec},v1=${signature}` }, body });
}

const statusOf = async (purchaseId: string) => (await env.DB.prepare("SELECT purchase_status FROM purchases WHERE id = ?").bind(purchaseId).first<{ purchase_status: string }>())?.purchase_status;

beforeAll(async () => {
  signingKeys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  publicKey = (await crypto.subtle.exportKey("jwk", signingKeys.publicKey)) as JsonWebKey;
});

beforeEach(async () => {
  stripeCalls = [];
  emails = [];
  charge = { status: "succeeded" };
  setupAnswer = { status: "succeeded", customer: "cus_test_player", metadata: { receipt_email: "emma@example.com" }, payment_method: { id: "pm_test_new", card: { brand: "mastercard", last4: "4444" } } };
  connectedAccount = { id: ACCOUNT, charges_enabled: true, country: "de", default_currency: "eur", business_profile: { name: "Pixel Smith Games", support_email: "help@pixelsmith.example" } };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.href === `${SUPABASE}/auth/v1/.well-known/jwks.json`) return Response.json({ keys: [{ ...publicKey, kid: "buy-test-key", alg: "ES256" }] });
    if (url.hostname === "outbox.test") {
      const sent = JSON.parse(String(init?.body ?? "{}"));
      emails.push({ to: sent.to, subject: sent.subject, text: sent.text });
      return Response.json({});
    }
    if (url.href === `${SUPABASE}/auth/v1/token?grant_type=password`) {
      // Supabase's password check: the stand-in accepts one password, for the account whose stand-in address it's given.
      const { email, password } = JSON.parse(String(init?.body ?? "{}"));
      if (password !== RIGHT_PASSWORD) return Response.json({ error: "invalid_grant" }, { status: 400 });
      const accountId = String(email).split("@")[0]!;
      return Response.json({ access_token: await accessToken(accountId, "session-after-password", email), refresh_token: `r-${accountId}`, user: { id: accountId, email } });
    }
    // Stripe, and the stand-in Stripe the local preview points at (STRIPE_API_ORIGIN).
    if (!["api.stripe.com", "connect.stripe.com", "localhost", "127.0.0.1"].includes(url.hostname) && !url.hostname.endsWith(".ts.net")) return realFetch(input, init);
    const form = new URLSearchParams(typeof init?.body === "string" ? init.body : url.search);
    const headers = new Headers(init?.headers);
    stripeCalls.push({ host: url.hostname, path: url.pathname, form, stripeAccount: headers.get("stripe-account"), idempotencyKey: headers.get("idempotency-key") });
    const path = url.pathname;
    if (path === "/oauth/token") return Response.json({ stripe_user_id: ACCOUNT });
    if (path === "/oauth/deauthorize") return Response.json({ stripe_user_id: ACCOUNT });
    if (path === `/v1/accounts/${ACCOUNT}`) return Response.json(connectedAccount);
    if (path === "/v1/payment_method_domains") return Response.json({ id: "pmd_test" });
    if (path === "/v1/customers") return Response.json({ id: "cus_test_player" });
    if (path === "/v1/payment_methods") return Response.json({ id: "pm_test_clone" });
    if (path === "/v1/setup_intents") return Response.json({ id: "seti_test_new", client_secret: "seti_test_new_secret" });
    if (path.startsWith("/v1/setup_intents/")) return Response.json({ id: path.split("/")[3], ...setupAnswer });
    if (path.startsWith("/v1/payment_methods/") && path.endsWith("/detach")) return Response.json({ id: path.split("/")[3] });
    if (path === "/v1/payment_intents" && charge.declined) return Response.json({ error: { type: "card_error", code: "card_declined", decline_code: "insufficient_funds", message: "Your card has insufficient funds." } }, { status: 402 });
    if (path === "/v1/payment_intents") {
      return Response.json({ id: `pi_test_${headers.get("idempotency-key") ?? "sale"}`, status: charge.status, amount: charge.amount ?? Number(form.get("amount")), currency: form.get("currency"), client_secret: "pi_test_sale_secret" });
    }
    if (path.startsWith("/v1/payment_intents/") && path.endsWith("/cancel")) return Response.json({ id: path.split("/")[3], status: "canceled" });
    if (path.startsWith("/v1/payment_intents/")) return Response.json({ id: path.split("/").at(-1), status: charge.status, amount: charge.amount ?? 199, currency: "eur", latest_charge: { billing_details: { email: "wallet@example.com" } } });
    if (path === "/v1/refunds") return Response.json({ id: `re_test_${stripeCalls.length}`, status: "succeeded" });
    return Response.json({ error: { message: `No such call in the stand-in: ${path}` } }, { status: 400 });
  });
  await env.DB.exec(
    "DELETE FROM purchases; DELETE FROM purchase_confirmations; DELETE FROM saved_payment_methods; DELETE FROM stripe_connect_states; DELETE FROM game_items; DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM security_events; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM passkeys; DELETE FROM passkey_challenges; DELETE FROM wrong_passwords; DELETE FROM device_marks; DELETE FROM accounts;",
  );
  await createAccount(env.DB, { id: "dev-1", username: "Pixel_Smith", ageBand: "18+" });
  await createAccount(env.DB, { id: "player-1", username: "Emma_Clarke", ageBand: "18+" });
  playerId = (await accountById(env.DB, "player-1"))!.player_id;
  await letPublish(env.DB, "dev-1");
  token = (await createApiKey(env.DB, "dev-1", "claude")).token;
  ownerId = (await personOwner(env.DB, "dev-1")).id;
  expect((await api("/games", { body: { title: "Tiny Farm", slug: "tiny-farm" } })).status).toBe(201);
  await env.DB.prepare("UPDATE games SET visibility = 'listed', review_status = 'live', live_version_id = 'version_tinyfarmlive01' WHERE slug = 'tiny-farm'").run();
  await api("/games/tiny-farm/purchase-settings", { method: "PATCH", body: { refund_policy: "unused_within_14_days" } });
});

/** The developer connected, as the return from Stripe leaves it. */
const connect = () => env.DB.prepare("UPDATE owners SET stripe_account_id = ?, can_take_stripe_payments = 1, stripe_country_code = 'DE', stripe_default_currency_code = 'eur', stripe_business_name = 'Pixel Smith Games', stripe_support_email = 'help@pixelsmith.example', stripe_connected_at_ms = ? WHERE id = ?").bind(ACCOUNT, Date.now(), ownerId).run();
const setItem = (itemName: string, fields: Record<string, unknown>) => api(`/games/tiny-farm/items/${itemName}`, { method: "PUT", body: { description: "", item_category: "gameplay", local_prices: [], ...fields } });
const revive = { title: "Revive", item_kind: "consumable", price_minor_units: 199, currency_code: "eur" };
const barn = { title: "Golden Barn", item_kind: "permanent", item_category: "cosmetic", price_minor_units: 999, currency_code: "eur" };
const saveCard = () => env.DB.prepare("INSERT INTO saved_payment_methods (account_id, stripe_payment_method_id, card_brand, card_last_digits, created_at_ms) VALUES ('player-1', 'pm_test_saved', 'visa', '4242', ?)").bind(Date.now()).run();
const setPin = async (pin = "482917") => env.DB.prepare("UPDATE accounts SET purchase_pin_hash = ? WHERE id = 'player-1'").bind(await hashPurchasePin(pin)).run();
const givePassword = () => env.DB.prepare("UPDATE accounts SET password_changed_at_ms = ? WHERE id = 'player-1'").bind(Date.now()).run();
/** The player's address as Supabase knows an account that never added an email. */
const NO_EMAIL = "player-1@no-mail.zaisma.com";
const confirmedAt = (confirmedAtMs: number, sessionId = "session-player-1") => env.DB.prepare("INSERT INTO purchase_confirmations (session_id, account_id, confirmation_method, confirmed_at_ms) VALUES (?, 'player-1', 'purchase_pin', ?) ON CONFLICT (session_id) DO UPDATE SET confirmed_at_ms = excluded.confirmed_at_ms").bind(sessionId, confirmedAtMs).run();
const pinState = () => env.DB.prepare("SELECT purchase_pin_hash, purchase_pin_failed_count FROM accounts WHERE id = 'player-1'").first<{ purchase_pin_hash: string | null; purchase_pin_failed_count: number }>();
const MINUTE_MS = 60_000;

// A software passkey: what a phone does when it signs a tap for the player (the same steps as accounts.test.ts).
const RELYING_PARTY = "zaisma.test";
const sha256 = async (bytes: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
const bytesB64url = (bytes: Uint8Array) => b64url(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
const joined = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => [...part]));
const derSignature = (raw: Uint8Array) => {
  const integer = (bytes: Uint8Array) => {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start++;
    const trimmed = bytes.slice(start);
    return trimmed[0]! & 0x80 ? joined(Uint8Array.of(2, trimmed.length + 1, 0), trimmed) : joined(Uint8Array.of(2, trimmed.length), trimmed);
  };
  const body = joined(integer(raw.slice(0, 32)), integer(raw.slice(32)));
  return joined(Uint8Array.of(0x30, body.length), body);
};
/** The player's own passkey, saved on their account, and a way to sign a challenge with it. */
async function passkeyOfPlayer() {
  const keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const credentialId = bytesB64url(crypto.getRandomValues(new Uint8Array(16)));
  await addPasskey(env.DB, { id: credentialId, account_id: "player-1", public_key: b64url((await crypto.subtle.exportKey("spki", keys.publicKey)) as ArrayBuffer), algorithm_number: -7, sign_count: 0, name: "Test phone" }, 0);
  return {
    async tap(challenge: string) {
      const authenticatorData = joined(await sha256(new TextEncoder().encode(RELYING_PARTY)), Uint8Array.of(0x05), Uint8Array.of(0, 0, 0, 1));
      const clientData = new TextEncoder().encode(JSON.stringify({ type: "webauthn.get", challenge, origin: SITE }));
      const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, joined(authenticatorData, await sha256(clientData))));
      return { id: credentialId, clientDataJSON: bytesB64url(clientData), authenticatorData: bytesB64url(authenticatorData), signature: bytesB64url(derSignature(signature)), userHandle: "" };
    },
  };
}

describe("a developer's Stripe account", () => {
  it("starts unconnected, and connecting needs the developer's passkey on zaisma.com", async () => {
    expect((await tool("get_stripe_account", {})).stripe_account).toMatchObject({ is_connected: false, stripe_account_id: null, can_take_payments: false });
    const refused = await tool("connect_stripe_account", {});
    expect(refused).toMatchObject({ code: "confirmation_needed", confirm_url: `${SITE}/developer/settings#payments` });
    expect((await tool("update_stripe_account", { is_stripe_tax_used: true })).code).toBe("stripe_not_connected");
  });

  it("connects through Stripe's page with a link bound to the owner who asked, once", async () => {
    const caller = (await callerFor(env, new Request(SITE), "dev-1"))!;
    const [link, status] = (await stripeAccountRoute(env, "/stripe-account/connection-links", "POST", {}, { ...caller, isSpendingConfirmed: true })) as [any, number];
    expect(status).toBe(201);
    const connectUrl = new URL(link.connect_url);
    expect(connectUrl.origin + connectUrl.pathname).toBe("https://connect.stripe.com/oauth/authorize");
    expect(Object.fromEntries(connectUrl.searchParams)).toMatchObject({ client_id: "ca_test_zaisma", scope: "read_write", redirect_uri: `${SITE}/stripe/connect-return` });
    const state = connectUrl.searchParams.get("state")!;

    // Someone else signed in can't use it.
    await createAccount(env.DB, { id: "dev-2", username: "Other_Dev", ageBand: "18+" });
    await personOwner(env.DB, "dev-2");
    const elsewhere = await SELF.fetch(`${SITE}/stripe/connect-return?state=${state}&code=ac_test`, { headers: { cookie: await sessionCookie("dev-2") }, redirect: "manual" });
    expect(elsewhere.headers.get("location")).toBe(`${SITE}/developer/settings?stripe=link_expired#payments`);
    // And it worked once: the state is gone now.
    const again = await SELF.fetch(`${SITE}/stripe/connect-return?state=${state}&code=ac_test`, { headers: { cookie: await sessionCookie("dev-1") }, redirect: "manual" });
    expect(again.headers.get("location")).toContain("stripe=link_expired");

    const [fresh] = (await stripeAccountRoute(env, "/stripe-account/connection-links", "POST", {}, { ...caller, isSpendingConfirmed: true })) as [any];
    const freshState = new URL(fresh.connect_url).searchParams.get("state")!;
    const back = await SELF.fetch(`${SITE}/stripe/connect-return?state=${freshState}&code=ac_test`, { headers: { cookie: await sessionCookie("dev-1") }, redirect: "manual" });
    expect(back.headers.get("location")).toBe(`${SITE}/developer/settings?stripe=connected#payments`);
    expect(stripeCalls.find((call) => call.path === "/v1/payment_method_domains")).toMatchObject({ stripeAccount: ACCOUNT });
    expect((await tool("get_stripe_account", {})).stripe_account).toMatchObject({ is_connected: true, stripe_account_id: ACCOUNT, can_take_payments: true, country_code: "DE", default_currency_code: "eur", business_name: "Pixel Smith Games", support_email: "help@pixelsmith.example", is_stripe_tax_used: false });
    expect(await env.DB.prepare("SELECT kind FROM security_events WHERE account_id = 'dev-1' AND kind = 'stripe_account_connected'").first()).not.toBeNull();
  });

  it("turns away a link that ran out, without asking Stripe anything", async () => {
    const caller = (await callerFor(env, new Request(SITE), "dev-1"))!;
    const [link] = (await stripeAccountRoute(env, "/stripe-account/connection-links", "POST", {}, { ...caller, isSpendingConfirmed: true })) as [any];
    const state = new URL(link.connect_url).searchParams.get("state")!;
    await env.DB.prepare("UPDATE stripe_connect_states SET expires_at_ms = ? WHERE state = ?").bind(Date.now() - 1, state).run();
    const back = await SELF.fetch(`${SITE}/stripe/connect-return?state=${state}&code=ac_test`, { headers: { cookie: await sessionCookie("dev-1") }, redirect: "manual" });
    expect(back.headers.get("location")).toBe(`${SITE}/developer/settings?stripe=link_expired#payments`);
    expect(stripeCalls.filter((call) => call.path === "/oauth/token")).toEqual([]);
    expect((await tool("get_stripe_account", {})).stripe_account.is_connected).toBe(false);
    // The link is used up either way.
    expect(await env.DB.prepare("SELECT 1 FROM stripe_connect_states WHERE state = ?").bind(state).first()).toBeNull();
  });

  it("turns Stripe Tax on and off, follows Stripe's changes, and disconnects", async () => {
    await connect();
    expect((await tool("update_stripe_account", { is_stripe_tax_used: true })).stripe_account.is_stripe_tax_used).toBe(true);
    expect((await api("/stripe-account", { method: "PATCH", body: { is_stripe_tax_used: "yes" } })).answer.error).toMatchObject({ code: "bad_is_stripe_tax_used", field: "is_stripe_tax_used" });
    expect((await connectEvent("account.updated", { ...connectedAccount, charges_enabled: false, business_profile: { name: "Pixel Smith Studio" } })).status).toBe(200);
    expect((await tool("get_stripe_account", {})).stripe_account).toMatchObject({ can_take_payments: false, business_name: "Pixel Smith Studio" });
    expect((await tool("disconnect_stripe_account", {})).stripe_account.is_connected).toBe(false);
    expect(stripeCalls.find((call) => call.path === "/oauth/deauthorize")!.form.get("stripe_user_id")).toBe(ACCOUNT);
  });

  it("forgets the account when the developer removes Zaisma on Stripe's side", async () => {
    await connect();
    await connectEvent("account.application.deauthorized", { id: "ca_test_zaisma" });
    expect((await tool("get_stripe_account", {})).stripe_account.is_connected).toBe(false);
  });

  it("says to connect Stripe when the first priced item is set", async () => {
    expect((await setItem("revive", revive)).answer.next_steps).toEqual([expect.objectContaining({ tool: "get_stripe_account" })]);
    await connect();
    expect((await setItem("revive", revive)).answer.next_steps).toEqual([]);
  });
});

describe("opening the sheet", () => {
  it("refuses in the order a player meets it", async () => {
    await setItem("revive", revive);
    await setItem("free_hat", { title: "Free Hat", item_kind: "permanent", price_minor_units: null, currency_code: null });
    expect((await player("/api/buy/nowhere/start", { body: { item_name: "revive" } })).answer.error.code).toBe("no_game");
    expect((await player("/api/buy/tiny-farm/start", { body: { item_name: "sword" } })).answer.error.code).toBe("no_item");
    expect((await player("/api/buy/tiny-farm/start", { body: { item_name: "free_hat" } })).answer.error.code).toBe("not_for_sale");
    expect((await player("/api/buy/tiny-farm/start", { body: { item_name: "revive" } })).answer.error.code).toBe("stripe_not_connected");
    await connect();
    await env.DB.prepare("UPDATE owners SET can_take_stripe_payments = 0").run();
    expect((await player("/api/buy/tiny-farm/start", { body: { item_name: "revive" } })).answer.error.code).toBe("stripe_cannot_take_payments");
    await env.DB.prepare("UPDATE owners SET can_take_stripe_payments = 1").run();
    expect((await player("/api/buy/tiny-farm/start", { body: { item_name: "revive" }, accountId: null })).answer.error.code).toBe("account_needed");
    expect((await player("/api/buy/tiny-farm/start", { body: { item_name: "revive", item_count: 0 } })).answer.error.code).toBe("bad_item_count");
    // Another site can't buy with the player's cookie.
    expect((await player("/api/buy/tiny-farm/start", { body: { item_name: "revive" }, origin: "https://elsewhere.example" })).status).toBe(403);
  });

  it("makes a pending purchase at the player's price, and answers what the sheet shows", async () => {
    await connect();
    await setItem("revive", revive);
    const { status, answer } = await player("/api/buy/tiny-farm/start", { body: { item_name: "revive", item_count: 3, game_account_id: "farmer-42" } });
    expect(status).toBe(200);
    expect(answer).toMatchObject({
      item: { item_name: "revive", title: "Revive", item_kind: "consumable" },
      item_count: 3,
      price: { currency_code: "eur", price_minor_units: 597 },
      seller: { business_name: "Pixel Smith Games", support_email: "help@pixelsmith.example" },
      refund_policy: "unused_within_14_days",
      is_eu_withdrawal_line_shown: true,
      saved_card: null,
      is_confirmation_needed: false,
      confirmation_reason: null,
      wallet: { publishable_key: "pk_test_zaisma", stripe_account_id: ACCOUNT },
    });
    const sale = await env.DB.prepare("SELECT * FROM purchases WHERE id = ?").bind(answer.purchase_id).first<any>();
    expect(sale).toMatchObject({ purchase_source: "sale", purchase_status: "pending", item_count: 3, paid_minor_units: 597, currency_code: "eur", player_id: playerId, game_account_id: "farmer-42", stripe_account_id: ACCOUNT, is_eu_withdrawal_line_shown: 1 });
  });

  it("prices by the player's country: their currency when the game set one, else the main price", async () => {
    await connect();
    await setItem("revive", { ...revive, currency_code: "usd", local_prices: [{ currency_code: "brl", price_minor_units: 990 }] });
    const buy = (country: string | null) => player("/api/buy/tiny-farm/start", { body: { item_name: "revive", item_count: 2 }, country });
    const brazil = await buy("BR");
    expect(brazil.answer.price).toMatchObject({ currency_code: "brl", price_minor_units: 1980 });
    expect(await env.DB.prepare("SELECT currency_code, paid_minor_units FROM purchases WHERE id = ?").bind(brazil.answer.purchase_id).first()).toEqual({ currency_code: "brl", paid_minor_units: 1980 });
    // Germany pays in euros, which the game didn't price: the main price.
    const germany = await buy("DE");
    expect(germany.answer.price).toMatchObject({ currency_code: "usd", price_minor_units: 398 });
    expect(await env.DB.prepare("SELECT currency_code, paid_minor_units FROM purchases WHERE id = ?").bind(germany.answer.purchase_id).first()).toEqual({ currency_code: "usd", paid_minor_units: 398 });
    // No country at all is the main price too.
    expect((await buy(null)).answer.price).toMatchObject({ currency_code: "usd", price_minor_units: 398 });
    // And once the game prices euros, Germany pays that.
    await setItem("revive", { ...revive, currency_code: "usd", local_prices: [{ currency_code: "brl", price_minor_units: 990 }, { currency_code: "eur", price_minor_units: 179 }] });
    expect((await buy("DE")).answer.price).toMatchObject({ currency_code: "eur", price_minor_units: 358 });
    // The player's country is Cloudflare's, never a field they send (only the local preview takes preview_country_code).
    const sent = await player("/api/buy/tiny-farm/start", { body: { item_name: "revive", preview_country_code: "BR" }, country: "US" });
    expect(sent.answer.price).toMatchObject({ currency_code: "usd", price_minor_units: 199 });
  });

  it("shows the withdrawal line to players in the EU, EEA and UK, and keeps it in the stored purchase", async () => {
    await connect();
    await setItem("revive", revive);
    const line = async (country: string | null) => {
      const { answer } = await player("/api/buy/tiny-farm/start", { body: { item_name: "revive" }, country });
      const stored = await env.DB.prepare("SELECT is_eu_withdrawal_line_shown FROM purchases WHERE id = ?").bind(answer.purchase_id).first<{ is_eu_withdrawal_line_shown: number }>();
      return [answer.is_eu_withdrawal_line_shown, stored!.is_eu_withdrawal_line_shown];
    };
    expect(await line("FR")).toEqual([true, 1]);
    expect(await line("GB")).toEqual([true, 1]);
    expect(await line("US")).toEqual([false, 0]);
    expect(await line(null)).toEqual([false, 0]);
  });

  it("answers slow_down to the 21st buy an account opens in a minute", async () => {
    expect(configuredRateLimit(siteWranglerText, "PURCHASE_LIMIT")).toEqual({ limit: 20, period: 60 });
    await connect();
    await setItem("revive", revive);
    const purchaseLimit = countingRateLimiter(20);
    const statuses: number[] = [];
    for (let buyNumber = 1; buyNumber <= 21; buyNumber++) {
      const opened = await player("/api/buy/tiny-farm/start", { body: { item_name: "revive" }, bindings: { PURCHASE_LIMIT: purchaseLimit } });
      statuses.push(opened.status);
      if (buyNumber === 21) expect(opened.answer.error.code).toBe("slow_down");
    }
    expect(statuses).toEqual([...Array(20).fill(200), 429]);
    // Counted by the account, and a refused buy made no purchase.
    expect(new Set(purchaseLimit.keys)).toEqual(new Set(["player-1"]));
    expect((await env.DB.prepare("SELECT COUNT(*) AS purchase_count FROM purchases").first<{ purchase_count: number }>())!.purchase_count).toBe(20);
  });

  it("refuses a permanent item the player already owns", async () => {
    await connect();
    await setItem("golden_barn", barn);
    const game = (await gameBySlug(env.DB, "tiny-farm"))!;
    await env.DB.prepare("INSERT INTO purchases (id, game_id, item_name, item_kind, player_id, purchase_source, purchase_status, created_at_ms, purchased_at_ms) VALUES ('purchase_ownedbarn0001', ?, 'golden_barn', 'permanent', ?, 'grant', 'completed', ?, ?)").bind(game.id, playerId, Date.now(), Date.now()).run();
    expect((await player("/api/buy/tiny-farm/start", { body: { item_name: "golden_barn" } })).answer.error.code).toBe("already_owned");
  });
});

describe("paying with the saved card", () => {
  const started = async (itemName = "revive") => (await player("/api/buy/tiny-farm/start", { body: { item_name: itemName } })).answer.purchase_id as string;
  beforeEach(async () => {
    await connect();
    await setItem("revive", revive);
    await setItem("golden_barn", barn);
    await saveCard();
  });

  it("needs a confirm on this device first, and a wrong PIN counts to 5", async () => {
    await setPin();
    const purchaseId = await started();
    expect((await player(`/api/buy/purchases/${purchaseId}/pay-with-saved-card`, { method: "POST" })).answer.error.code).toBe("purchase_confirmation_needed");
    for (let tryNumber = 1; tryNumber < 5; tryNumber++) expect((await player("/api/buy/confirm", { body: { purchase_pin: "000000" } })).answer.error.code).toBe("wrong_purchase_pin");
    expect((await player("/api/buy/confirm", { body: { purchase_pin: "000000" } })).answer.error.code).toBe("purchase_pin_locked");
    // Locked: even the right PIN waits for the password.
    expect((await player("/api/buy/confirm", { body: { purchase_pin: "482917" } })).answer.error.code).toBe("purchase_pin_locked");
    expect(stripeCalls.filter((call) => call.path === "/v1/payment_intents")).toEqual([]);
  });

  it("charges once on the developer's account, completes, and sends one receipt", async () => {
    await setPin();
    const purchaseId = await started();
    expect((await player("/api/buy/confirm", { body: { purchase_pin: "482917" } })).answer).toEqual({ is_confirmed: true });
    // The 15 minutes are this session's, not another device's.
    expect((await player(`/api/buy/purchases/${purchaseId}/pay-with-saved-card`, { method: "POST", sessionId: "other-device" })).answer.error.code).toBe("purchase_confirmation_needed");
    const paid = await player(`/api/buy/purchases/${purchaseId}/pay-with-saved-card`, { method: "POST" });
    expect(paid.answer).toMatchObject({ status: "completed", purchase: { id: purchaseId, purchase_status: "completed", paid_minor_units: 199 } });
    expect(paid.answer.purchase.receipt).toEqual(expect.any(String));
    const clone = stripeCalls.find((call) => call.path === "/v1/payment_methods")!;
    expect(clone).toMatchObject({ stripeAccount: ACCOUNT });
    expect(Object.fromEntries(clone.form)).toMatchObject({ customer: "cus_test_player", payment_method: "pm_test_saved" });
    const intent = stripeCalls.find((call) => call.path === "/v1/payment_intents")!;
    expect(intent).toMatchObject({ stripeAccount: ACCOUNT, idempotencyKey: `purchase:${purchaseId}` });
    expect(Object.fromEntries(intent.form)).toMatchObject({ amount: "199", currency: "eur", payment_method: "pm_test_clone", confirm: "true" });
    // No fee for Zaisma, and no receipt of Stripe's own: the player gets Zaisma's one.
    expect(intent.form.has("application_fee_amount")).toBe(false);
    expect(intent.form.has("receipt_email")).toBe(false);
    expect(emails.filter((email) => email.to === "player-1@example.com")).toHaveLength(1);
    expect(emails[0]!.text).toContain("Pixel Smith Games");
    expect((await player(`/api/buy/purchases/${purchaseId}/pay-with-saved-card`, { method: "POST" })).answer.error.code).toBe("already_paid");
  });

  const DAY_MS = 86_400_000;
  const payUrl = (purchaseId: string) => `/api/buy/purchases/${purchaseId}/pay-with-saved-card`;
  const paymentCount = () => stripeCalls.filter((call) => call.path === "/v1/payment_intents").length;
  const confirmationCount = async () => (await env.DB.prepare("SELECT COUNT(*) AS confirmation_count FROM purchase_confirmations").first<{ confirmation_count: number }>())!.confirmation_count;
  /** A sale of this player's in the money the sheet counts, made some time ago. */
  const earlierSale = (id: string, status: string, paidMinorUnits: number, ageMs: number, extra: { currencyCode?: string; paymentIntentId?: string | null; source?: string } = {}) =>
    env.DB.prepare("INSERT INTO purchases (id, game_id, item_name, item_kind, item_count, player_id, purchase_source, purchase_status, paid_minor_units, currency_code, stripe_account_id, stripe_payment_intent_id, created_at_ms, is_eu_withdrawal_line_shown) SELECT ?, id, 'revive', 'consumable', 1, ?, ?, ?, ?, ?, ?, ?, ?, 0 FROM games WHERE slug = 'tiny-farm'")
      .bind(`purchase_${id}`, playerId, extra.source ?? "sale", status, paidMinorUnits, extra.currencyCode ?? "eur", ACCOUNT, extra.paymentIntentId ?? null, Date.now() - ageMs)
      .run();
  const startRevive = (init: Parameters<typeof player>[1] = {}, itemCount = 1) => player("/api/buy/tiny-farm/start", { ...init, body: { item_name: "revive", item_count: itemCount } });

  it("buys with one press when there's no PIN, the sign-in is recent and the spending is small", async () => {
    const opened = await startRevive();
    expect(opened.answer).toMatchObject({ is_confirmation_needed: false, confirmation_reason: null });
    const paid = await player(payUrl(opened.answer.purchase_id), { method: "POST" });
    expect(paid.answer).toMatchObject({ status: "completed" });
    expect(await confirmationCount()).toBe(0);
    // A second buy right after is the same, and 29 days since the sign-in is still recent.
    const second = await startRevive({ signedInAtMs: Date.now() - 29 * DAY_MS });
    expect(second.answer).toMatchObject({ is_confirmation_needed: false, confirmation_reason: null });
    expect((await player(payUrl(second.answer.purchase_id), { method: "POST", signedInAtMs: Date.now() - 29 * DAY_MS })).answer.status).toBe("completed");
    expect(paymentCount()).toBe(2);
  });

  it("asks for the PIN on every buy with a PIN set, and a confirm covers exactly one buy", async () => {
    await setPin();
    const first = await startRevive();
    expect(first.answer).toMatchObject({ is_confirmation_needed: true, confirmation_reason: "purchase_pin" });
    const refused = await player(payUrl(first.answer.purchase_id), { method: "POST" });
    expect(refused).toMatchObject({ status: 403, answer: { error: { code: "purchase_confirmation_needed" } } });
    expect(refused.answer.error.message).toContain("purchase PIN");
    expect(paymentCount()).toBe(0);

    expect((await player("/api/buy/confirm", { body: { purchase_pin: "482917" } })).answer).toEqual({ is_confirmed: true });
    expect((await player(payUrl(first.answer.purchase_id), { method: "POST" })).answer.status).toBe("completed");
    // Used up by that buy.
    expect(await confirmationCount()).toBe(0);
    const second = await startRevive();
    expect(second.answer).toMatchObject({ is_confirmation_needed: true, confirmation_reason: "purchase_pin" });
    expect((await player(payUrl(second.answer.purchase_id), { method: "POST" })).answer.error.code).toBe("purchase_confirmation_needed");
    expect(paymentCount()).toBe(1);
    // A fresh confirm buys the next one.
    await player("/api/buy/confirm", { body: { purchase_pin: "482917" } });
    expect((await player(payUrl(second.answer.purchase_id), { method: "POST" })).answer.status).toBe("completed");
    expect(paymentCount()).toBe(2);
  });

  it("doesn't let one PIN confirm pay two buys opened together, or one left for over 15 minutes pay at all", async () => {
    await setPin();
    const [one, two] = [await started(), await started()];
    await confirmedAt(Date.now());
    const answers = await Promise.all([player(payUrl(one), { method: "POST" }), player(payUrl(two), { method: "POST" })]);
    expect(answers.map((answer) => answer.answer.status ?? answer.answer.error.code).sort()).toEqual(["completed", "purchase_confirmation_needed"]);
    expect(paymentCount()).toBe(1);
    await confirmedAt(Date.now() - 16 * MINUTE_MS);
    const late = await startRevive();
    expect(late.answer).toMatchObject({ is_confirmation_needed: true, confirmation_reason: "purchase_pin" });
    expect((await player(payUrl(late.answer.purchase_id), { method: "POST" })).answer.error.code).toBe("purchase_confirmation_needed");
    expect(paymentCount()).toBe(1);
  });

  it("asks to confirm after a sign-in over 30 days old or unknown, and then not again for 15 minutes", async () => {
    const old = { signedInAtMs: Date.now() - 31 * DAY_MS };
    const opened = await startRevive(old);
    expect(opened.answer).toMatchObject({ is_confirmation_needed: true, confirmation_reason: "old_sign_in" });
    const refused = await player(payUrl(opened.answer.purchase_id), { method: "POST", ...old });
    expect(refused).toMatchObject({ status: 403, answer: { error: { code: "purchase_confirmation_needed" } } });
    expect(refused.answer.error.message).toContain("30 days");
    expect(paymentCount()).toBe(0);
    // A sign-in Supabase didn't date counts as old.
    expect((await startRevive({ signedInAtMs: null })).answer).toMatchObject({ is_confirmation_needed: true, confirmation_reason: "old_sign_in" });

    await confirmedAt(Date.now() - 14 * MINUTE_MS);
    expect((await player(payUrl(opened.answer.purchase_id), { method: "POST", ...old })).answer.status).toBe("completed");
    // The confirm stays: the second buy within the 15 minutes asks for nothing.
    const second = await startRevive(old);
    expect(second.answer).toMatchObject({ is_confirmation_needed: false, confirmation_reason: null });
    expect((await player(payUrl(second.answer.purchase_id), { method: "POST", ...old })).answer.status).toBe("completed");
    expect(paymentCount()).toBe(2);
    // At 16 minutes it asks again.
    await confirmedAt(Date.now() - 16 * MINUTE_MS);
    const late = await startRevive(old);
    expect(late.answer).toMatchObject({ is_confirmation_needed: true, confirmation_reason: "old_sign_in" });
    expect((await player(payUrl(late.answer.purchase_id), { method: "POST", ...old })).answer.error.code).toBe("purchase_confirmation_needed");
    expect(paymentCount()).toBe(2);
    expect(await statusOf(late.answer.purchase_id)).toBe("pending");
  });

  it("asks to confirm when a day's buying would pass USD 100.00, then not again for 15 minutes", async () => {
    // 40 Revive is EUR 79.60, about USD 91.54: under. A second 40 would be about USD 183.
    const first = await startRevive({}, 40);
    expect(first.answer).toMatchObject({ price: { price_minor_units: 7960 }, is_confirmation_needed: false, confirmation_reason: null });
    expect((await player(payUrl(first.answer.purchase_id), { method: "POST" })).answer.status).toBe("completed");

    const second = await startRevive({}, 40);
    expect(second.answer).toMatchObject({ is_confirmation_needed: true, confirmation_reason: "big_spend" });
    const refused = await player(payUrl(second.answer.purchase_id), { method: "POST" });
    expect(refused).toMatchObject({ status: 403, answer: { error: { code: "purchase_confirmation_needed" } } });
    expect(refused.answer.error.message).toContain("USD 100.00");
    expect(paymentCount()).toBe(1);

    await confirmedAt(Date.now() - 5 * MINUTE_MS);
    expect((await player(payUrl(second.answer.purchase_id), { method: "POST" })).answer.status).toBe("completed");
    const third = await startRevive({}, 40);
    expect(third.answer).toMatchObject({ is_confirmation_needed: false, confirmation_reason: null });
    expect((await player(payUrl(third.answer.purchase_id), { method: "POST" })).answer.status).toBe("completed");
    expect(paymentCount()).toBe(3);
  });

  it("counts only sales that are paid or being paid, in the last 24 hours, in their own currencies", async () => {
    // None of these is spending: an abandoned sheet, a failed or refunded sale, a grant, a sale over a day old.
    await earlierSale("abandoned1", "pending", 9000, 5 * MINUTE_MS);
    await earlierSale("failed1", "failed", 9000, 5 * MINUTE_MS);
    await earlierSale("refunded1", "refunded", 9000, 5 * MINUTE_MS);
    await earlierSale("granted1", "completed", 9000, 5 * MINUTE_MS, { source: "grant" });
    await earlierSale("yesterday1", "completed", 9000, 25 * 60 * MINUTE_MS);
    expect((await startRevive({}, 40)).answer).toMatchObject({ is_confirmation_needed: false, confirmation_reason: null });
    // A paid one and one being paid count: EUR 40.00 (about USD 46) twice, so 1 Revive still fits and 5 take it past USD 100.
    await earlierSale("paid1", "completed", 4000, 5 * MINUTE_MS);
    await earlierSale("paying1", "pending", 4000, 5 * MINUTE_MS, { paymentIntentId: "pi_test_paying" });
    expect((await startRevive({}, 1)).answer.is_confirmation_needed).toBe(false);
    expect((await startRevive({}, 5)).answer).toMatchObject({ is_confirmation_needed: true, confirmation_reason: "big_spend" });
  });

  it("counts every currency at about its dollar worth", async () => {
    // ¥12,000 is about USD 84; with Revive at EUR 1.99 (about USD 2.29) it's under, and with 20 of them (about USD 46) over.
    await earlierSale("yen1", "completed", 12_000, MINUTE_MS, { currencyCode: "jpy" });
    expect((await startRevive({}, 1)).answer.is_confirmation_needed).toBe(false);
    expect((await startRevive({}, 20)).answer).toMatchObject({ is_confirmation_needed: true, confirmation_reason: "big_spend" });
  });

  it("asks for the PIN before any other reason, and a PIN confirm doesn't cover an old sign-in's extra buys", async () => {
    await setPin();
    const old = { signedInAtMs: Date.now() - 40 * DAY_MS };
    expect((await startRevive(old, 40)).answer.confirmation_reason).toBe("purchase_pin");
    const opened = await startRevive(old);
    await confirmedAt(Date.now());
    expect((await player(payUrl(opened.answer.purchase_id), { method: "POST", ...old })).answer.status).toBe("completed");
    expect((await startRevive(old)).answer.confirmation_reason).toBe("purchase_pin");
  });

  it("unlocks a locked PIN with the password, and the count goes back to 0", async () => {
    await setPin();
    // No password on the account yet: it can't unlock anything.
    expect((await player("/api/buy/confirm", { body: { password: RIGHT_PASSWORD } })).answer.error.code).toBe("wrong_password");
    await givePassword();
    for (let tryNumber = 1; tryNumber <= 5; tryNumber++) await player("/api/buy/confirm", { body: { purchase_pin: "000000" } });
    expect((await pinState())!.purchase_pin_failed_count).toBe(5);
    expect((await player("/api/buy/confirm", { body: { purchase_pin: "482917" } })).answer.error.code).toBe("purchase_pin_locked");
    const asked = () => player("/api/buy/tiny-farm/start", { body: { item_name: "revive" } });
    expect((await asked()).answer.confirmation_methods).toMatchObject({ has_purchase_pin: true, has_password: true, is_purchase_pin_locked: true });

    // A wrong password changes nothing.
    expect((await player("/api/buy/confirm", { body: { password: "not the password" } })).answer.error.code).toBe("wrong_password");
    expect((await pinState())!.purchase_pin_failed_count).toBe(5);

    const unlocked = await player("/api/buy/confirm", { body: { password: RIGHT_PASSWORD } });
    expect(unlocked.answer).toEqual({ is_confirmed: true });
    // The password signs in again: its session carries the 15 minutes, and its cookie replaces this one's.
    expect(unlocked.headers.getSetCookie().join("\n")).toContain("zaisma=");
    expect(await env.DB.prepare("SELECT account_id, confirmation_method FROM purchase_confirmations WHERE session_id = 'session-after-password'").first()).toEqual({ account_id: "player-1", confirmation_method: "password" });
    expect((await pinState())!.purchase_pin_failed_count).toBe(0);
    expect((await asked()).answer.confirmation_methods.is_purchase_pin_locked).toBe(false);
    expect((await player("/api/buy/confirm", { body: { purchase_pin: "482917" } })).answer).toEqual({ is_confirmed: true });
    expect((await player("/api/buy/confirm", { body: { purchase_pin: "000000" } })).answer.error.message).toContain("4 tries left");
  });

  it("confirms with a passkey tap made for buying, once, and turns away any other", async () => {
    const device = await passkeyOfPlayer();
    const noTap = { id: "nope", clientDataJSON: "", authenticatorData: "", signature: "", userHandle: "" };
    expect(await player("/api/buy/confirm", { body: { passkey_tap: noTap } })).toMatchObject({ status: 403, answer: { error: { code: "wrong_passkey" } } });

    /** A challenge for the purpose, with the cookie that ties it to this browser. */
    const challengeFor = async (purpose: string) => {
      const options = await player("/api/passkeys/tap/options", { body: { purpose } });
      expect(options.status).toBe(200);
      const cookie = options.headers.getSetCookie().find((setCookie) => setCookie.includes("zaisma_pk="))!.split(";")[0]!;
      return { challenge: options.answer.challenge as string, cookie };
    };
    // A tap made for confirming the account isn't one for buying.
    const forConfirm = await challengeFor("confirm");
    expect((await player("/api/buy/confirm", { body: { passkey_tap: await device.tap(forConfirm.challenge) }, cookie: forConfirm.cookie })).answer.error.code).toBe("wrong_passkey");

    const forBuying = await challengeFor("purchase");
    const tap = await device.tap(forBuying.challenge);
    expect((await player("/api/buy/confirm", { body: { passkey_tap: tap }, cookie: forBuying.cookie })).answer).toEqual({ is_confirmed: true });
    expect(await env.DB.prepare("SELECT confirmation_method FROM purchase_confirmations WHERE session_id = 'session-player-1'").first()).toEqual({ confirmation_method: "passkey" });
    expect((await player("/api/buy/tiny-farm/start", { body: { item_name: "revive" } })).answer.is_confirmation_needed).toBe(false);
    // The same tap sent again is refused: its challenge is used up.
    await env.DB.prepare("DELETE FROM purchase_confirmations").run();
    expect((await player("/api/buy/confirm", { body: { passkey_tap: tap }, cookie: forBuying.cookie })).answer.error.code).toBe("wrong_passkey");
  });

  /** Buys revive from a country with a confirm on this device, and answers the receipt email that follows. */
  async function receiptFrom(country: string) {
    await confirmedAt(Date.now());
    const opened = await player("/api/buy/tiny-farm/start", { body: { item_name: "revive" }, country });
    const paid = await player(`/api/buy/purchases/${opened.answer.purchase_id}/pay-with-saved-card`, { method: "POST" });
    expect(paid.answer.status).toBe("completed");
    const sent = emails.filter((email) => email.to === "player-1@example.com");
    expect(sent).toHaveLength(1);
    return { purchaseId: opened.answer.purchase_id as string, refundWords: opened.answer.refund_policy_words as string, receipt: sent[0]! };
  }

  it("repeats the purchase ID, the seller's support email, the refund words and the EU line in the receipt", async () => {
    const { purchaseId, refundWords, receipt } = await receiptFrom("DE");
    expect(refundWords).toContain("within 14 days");
    expect(receipt.subject).toBe("Your receipt from Tiny Farm");
    expect(receipt.text).toContain(`Purchase ID: ${purchaseId}`);
    expect(receipt.text).toContain("Sold by: Pixel Smith Games (help@pixelsmith.example)");
    expect(receipt.text).toContain(`Refund policy: ${refundWords}`);
    expect(receipt.text).toContain("Questions or a refund: write to help@pixelsmith.example with your purchase ID.");
    expect(receipt.text).toContain("You get it now, so you can't cancel it in the next 14 days.");
    expect(receipt.text).toContain(WITHDRAWAL_LINE_TEXT);
  });

  it("leaves the EU line out of a receipt for a player elsewhere", async () => {
    const { purchaseId, receipt } = await receiptFrom("US");
    expect(receipt.text).toContain(`Purchase ID: ${purchaseId}`);
    expect(receipt.text).toContain("Refund policy:");
    expect(receipt.text).not.toContain("can't cancel it");
  });

  it("fails the purchase when the card is declined", async () => {
    await setPin();
    const purchaseId = await started();
    await player("/api/buy/confirm", { body: { purchase_pin: "482917" } });
    charge = { status: "requires_payment_method", declined: true };
    const declined = await player(`/api/buy/purchases/${purchaseId}/pay-with-saved-card`, { method: "POST" });
    expect(declined).toMatchObject({ status: 402, answer: { error: { code: "payment_declined" } } });
    expect(await statusOf(purchaseId)).toBe("failed");
  });

  it("hands 3-D Secure back to the sheet, and its poll completes the sale", async () => {
    await setPin();
    const purchaseId = await started();
    await player("/api/buy/confirm", { body: { purchase_pin: "482917" } });
    charge = { status: "requires_action" };
    expect((await player(`/api/buy/purchases/${purchaseId}/pay-with-saved-card`, { method: "POST" })).answer).toMatchObject({ status: "action_needed", client_secret: "pi_test_sale_secret", stripe_account_id: ACCOUNT });
    charge = { status: "succeeded", amount: 199 };
    expect((await player(`/api/buy/purchases/${purchaseId}`)).answer.purchase.purchase_status).toBe("completed");
    // Someone else can't read it.
    await createAccount(env.DB, { id: "player-2", username: "Liam_Walker", ageBand: "18+" });
    expect((await player(`/api/buy/purchases/${purchaseId}`, { accountId: "player-2" })).answer.error.code).toBe("no_purchase");
  });

  it("refunds a second payment for a permanent item at once", async () => {
    const first = await started("golden_barn");
    const second = await started("golden_barn");
    for (const [purchaseId, paymentIntentId] of [[first, "pi_test_first"], [second, "pi_test_second"]] as const) {
      await env.DB.prepare("UPDATE purchases SET stripe_payment_intent_id = ? WHERE id = ?").bind(paymentIntentId, purchaseId).run();
      await connectEvent("payment_intent.succeeded", { id: paymentIntentId, status: "succeeded", amount: 999, currency: "eur", latest_charge: { billing_details: { email: "emma@example.com" } } });
    }
    expect(await statusOf(first)).toBe("completed");
    expect(await statusOf(second)).toBe("refunded");
    expect(stripeCalls.find((call) => call.path === "/v1/refunds")).toMatchObject({ stripeAccount: ACCOUNT, idempotencyKey: `duplicate:${second}` });
  });
});

describe("Stripe's Connect events", () => {
  let purchaseId = "";
  beforeEach(async () => {
    await connect();
    await setItem("golden_barn", barn);
    purchaseId = (await player("/api/buy/tiny-farm/start", { body: { item_name: "golden_barn" } })).answer.purchase_id;
    await env.DB.prepare("UPDATE purchases SET stripe_payment_intent_id = 'pi_test_barn' WHERE id = ?").bind(purchaseId).run();
  });
  const paid = (fields: Record<string, unknown> = {}, account = ACCOUNT) => connectEvent("payment_intent.succeeded", { id: "pi_test_barn", status: "succeeded", amount: 999, currency: "eur", latest_charge: { billing_details: { email: "wallet@example.com" } }, ...fields }, account);

  it("complete a sale only on its own account and at its price, never by metadata", async () => {
    expect((await connectEvent("payment_intent.succeeded", { id: "pi_test_barn" }, ACCOUNT, "whsec_wrong")).status).toBe(400);
    await paid({}, "acct_test_other");
    await paid({ amount: 1 });
    await paid({ id: "pi_test_unrelated", metadata: { purchase_id: purchaseId } });
    expect(await statusOf(purchaseId)).toBe("pending");
    await paid();
    await paid();
    expect(await statusOf(purchaseId)).toBe("completed");
    // A wallet payment's receipt goes to the wallet's email, once.
    expect(emails.filter((email) => email.to === "wallet@example.com")).toHaveLength(1);
  });

  it("take the item back on a full refund or a lost dispute, and keep it on a partial refund", async () => {
    await paid();
    await connectEvent("charge.refunded", { id: "ch_test", payment_intent: "pi_test_barn", amount_refunded: 300 });
    expect(await env.DB.prepare("SELECT purchase_status, refunded_minor_units FROM purchases WHERE id = ?").bind(purchaseId).first()).toEqual({ purchase_status: "completed", refunded_minor_units: 300 });
    await connectEvent("charge.dispute.closed", { id: "dp_test", payment_intent: "pi_test_barn", status: "won" });
    expect(await statusOf(purchaseId)).toBe("completed");
    await connectEvent("charge.dispute.closed", { id: "dp_test", payment_intent: "pi_test_barn", status: "lost" });
    expect(await statusOf(purchaseId)).toBe("charged_back");
  });

  it("take the item back when a refund adds up to the price, and handle a repeated event once", async () => {
    await paid();
    const row = () => env.DB.prepare("SELECT purchase_status, refunded_minor_units, refunded_at_ms FROM purchases WHERE id = ?").bind(purchaseId).first<{ purchase_status: string; refunded_minor_units: number; refunded_at_ms: number | null }>();
    // 300 back first, then the charge's whole refunded amount so far is the price: 999.
    await connectEvent("charge.refunded", { id: "ch_test", payment_intent: "pi_test_barn", amount_refunded: 300 });
    expect((await row())!.purchase_status).toBe("completed");
    expect((await connectEvent("charge.refunded", { id: "ch_test", payment_intent: "pi_test_barn", amount_refunded: 999 })).status).toBe(200);
    const refunded = await row();
    expect(refunded).toMatchObject({ purchase_status: "refunded", refunded_minor_units: 999 });
    // Stripe sends an event again until it's answered: the second one changes nothing.
    await connectEvent("charge.refunded", { id: "ch_test", payment_intent: "pi_test_barn", amount_refunded: 999 });
    expect(await row()).toEqual(refunded);
  });

  it("do not take the item back for a full refund on another account", async () => {
    await paid();
    await connectEvent("charge.refunded", { id: "ch_test", payment_intent: "pi_test_barn", amount_refunded: 999 }, "acct_test_other");
    expect(await statusOf(purchaseId)).toBe("completed");
  });

  it("fail a declined payment, and the daily step fails sheets nobody finished", async () => {
    await connectEvent("payment_intent.payment_failed", { id: "pi_test_barn" });
    expect(await statusOf(purchaseId)).toBe("failed");
    const abandoned = (await player("/api/buy/tiny-farm/start", { body: { item_name: "golden_barn" } })).answer.purchase_id;
    await env.DB.prepare("UPDATE purchases SET stripe_payment_intent_id = 'pi_test_abandoned', created_at_ms = ? WHERE id = ?").bind(Date.now() - 2 * 86_400_000, abandoned).run();
    charge = { status: "requires_payment_method" };
    await failStaleSales(env);
    expect(await statusOf(abandoned)).toBe("failed");
    expect(stripeCalls.find((call) => call.path === "/v1/payment_intents/pi_test_abandoned/cancel")).toMatchObject({ stripeAccount: ACCOUNT });
  });
});

describe("refunding a sale", () => {
  let purchaseId = "";
  beforeEach(async () => {
    await connect();
    await setItem("golden_barn", barn);
    purchaseId = (await player("/api/buy/tiny-farm/start", { body: { item_name: "golden_barn" } })).answer.purchase_id;
    await env.DB.prepare("UPDATE purchases SET stripe_payment_intent_id = 'pi_test_barn' WHERE id = ?").bind(purchaseId).run();
    await connectEvent("payment_intent.succeeded", { id: "pi_test_barn", status: "succeeded", amount: 999, currency: "eur", latest_charge: { billing_details: { email: "emma@example.com" } } });
  });

  it("gives some back as goodwill, then the rest, through the developer's Stripe", async () => {
    expect((await tool("refund_purchase", { slug: "tiny-farm", purchase_id: purchaseId, amount_minor_units: 2000 })).code).toBe("bad_amount_minor_units");
    const partial = await tool("refund_purchase", { slug: "tiny-farm", purchase_id: purchaseId, amount_minor_units: 250 });
    expect(partial.purchase).toMatchObject({ purchase_status: "completed", refunded_minor_units: 250 });
    const rest = await tool("refund_purchase", { slug: "tiny-farm", purchase_id: purchaseId });
    expect(rest.purchase).toMatchObject({ purchase_status: "refunded", refunded_minor_units: 999 });
    const refunds = stripeCalls.filter((call) => call.path === "/v1/refunds");
    expect(refunds.map((call) => [call.stripeAccount, call.form.get("amount"), call.form.get("payment_intent")])).toEqual([
      [ACCOUNT, "250", "pi_test_barn"],
      [ACCOUNT, "749", "pi_test_barn"],
    ]);
    expect((await tool("refund_purchase", { slug: "tiny-farm", purchase_id: purchaseId })).code).toBe("already_refunded");
  });
});

describe("the sheet's pages", () => {
  const page = (path: string, headers: Record<string, string> = {}) => SELF.fetch(`${SITE}${path}`, { headers });
  const sheetData = async (response: Response | string) => JSON.parse((typeof response === "string" ? response : await response.text()).match(/<script type="application\/json" id="buy-sheet-data">(.*?)<\/script>/)![1]!) as Record<string, any>;

  it("puts the sheet on the game page, with Stripe allowed only there", async () => {
    const gamePage = await page("/g/tiny-farm");
    const policy = gamePage.headers.get("content-security-policy")!;
    expect(policy).toMatch(/script-src 'self'[^;]* https:\/\/js\.stripe\.com/);
    expect(policy).toMatch(/frame-src [^;]*https:\/\/js\.stripe\.com https:\/\/hooks\.stripe\.com/);
    expect(policy).toContain("connect-src 'self' https://api.stripe.com");
    expect(gamePage.headers.get("permissions-policy")).toContain('payment=(self "https://js.stripe.com")');
    expect(await sheetData(gamePage)).toMatchObject({ slug: "tiny-farm", place: "game_page", stripe_mode: "stripe", stripe_publishable_key: env.STRIPE_PUBLISHABLE_KEY, is_preview: false, asked: null });
    const games = await page("/games");
    expect(games.headers.get("content-security-policy")).not.toContain("stripe");
    expect(games.headers.get("permissions-policy")).toContain("payment=()");
  });

  it("says on the game page what the game sells and its refund policy", async () => {
    expect(await (await page("/g/tiny-farm")).text()).toContain("No in-game purchases");
    await setItem("revive", revive);
    await setItem("barn", barn);
    const text = await (await page("/g/tiny-farm")).text();
    expect(text).toContain("Cosmetic items, items that help you play");
    expect(text).toContain("Refunds for items you haven&#39;t used yet, within 14 days.");
    await api("/games/tiny-farm/purchase-settings", { method: "PATCH", body: { own_payment_categories: ["currency"] } });
    expect(await (await page("/g/tiny-farm")).text()).toContain("Cosmetic items, items that help you play, in-game currency; some handled by the developer, not Zaisma");
  });

  it("opens the window for a game on its own site, answering only an origin the developer registered", async () => {
    await env.DB.prepare(`UPDATE games SET own_server_urls = '["wss://play.tinyfarm.test"]' WHERE slug = 'tiny-farm'`).run();
    const registered = await page("/buy/tiny-farm/revive?item_count=2&request_number=7&game_account_id=farmer-9", { referer: "https://play.tinyfarm.test/play" });
    expect(registered.status).toBe(200);
    expect(registered.headers.get("content-security-policy")).toContain("https://js.stripe.com");
    const registeredText = await registered.text();
    const data = await sheetData(registeredText);
    expect(data).toMatchObject({ place: "window", asked: { item_name: "revive", item_count: 2, game_account_id: "farmer-9", request_number: 7 }, opener_origin: "https://play.tinyfarm.test" });
    // A guest's way to an account comes back to the same window, still answering the game's site.
    expect(registeredText).toContain(encodeURIComponent("opener_origin=https%3A%2F%2Fplay.tinyfarm.test"));
    expect((await sheetData(await page("/buy/tiny-farm/revive", { referer: "https://evil.test/" }))).opener_origin).toBeNull();
    expect((await sheetData(await page("/buy/tiny-farm/revive?opener_origin=https%3A%2F%2Fevil.test"))).opener_origin).toBeNull();
    expect((await sheetData(await page("/buy/tiny-farm/revive?opener_origin=https%3A%2F%2Fplay.tinyfarm.test"))).opener_origin).toBe("https://play.tinyfarm.test");
    expect((await page("/buy/no-such-game/revive")).status).toBe(404);
  });
});

describe("the player's saved card and purchase PIN", () => {
  const sheetCall = (path: string, init: Parameters<typeof player>[1] = {}) => player(path, init);

  it("asks a guest to sign in first", async () => {
    for (const [method, path] of [["POST", "/api/payment-methods/setup"], ["POST", "/api/payment-methods/saved"], ["DELETE", "/api/payment-methods/saved"], ["PUT", "/api/account/purchase-pin"], ["DELETE", "/api/account/purchase-pin"]] as const) {
      expect(await sheetCall(path, { method, body: method === "DELETE" ? undefined : {}, accountId: null })).toMatchObject({ status: 403, answer: { error: { code: "account_needed" } } });
    }
  });

  it("starts saving a card only for an account with a passkey or an email", async () => {
    const noEmail = await sheetCall("/api/payment-methods/setup", { body: {}, email: NO_EMAIL });
    expect(noEmail).toMatchObject({ status: 409, answer: { error: { code: "account_protection_needed" } } });
    expect(stripeCalls.filter((call) => call.path === "/v1/setup_intents")).toEqual([]);

    // With an email: the card's receipts go to the account's email.
    expect((await sheetCall("/api/payment-methods/setup", { body: {} })).answer).toEqual({ setup_intent_id: "seti_test_new", client_secret: "seti_test_new_secret" });
    const setup = stripeCalls.find((call) => call.path === "/v1/setup_intents")!;
    expect(Object.fromEntries(setup.form)).toMatchObject({ customer: "cus_test_player", usage: "on_session", "payment_method_types[0]": "card", "metadata[account_id]": "player-1" });

    // A passkey is protection too: the card saves, and with no email its buys send no receipt email.
    await passkeyOfPlayer();
    expect((await sheetCall("/api/payment-methods/setup", { body: {}, email: NO_EMAIL })).answer.setup_intent_id).toBe("seti_test_new");
  });

  it("keeps the card a finished setup saved, replaces an older one, and forgets it on request", async () => {
    const keep = (body: unknown = { setup_intent_id: "seti_test_new" }) => sheetCall("/api/payment-methods/saved", { body });
    const stored = () => env.DB.prepare("SELECT stripe_payment_method_id, card_brand, card_last_digits FROM saved_payment_methods WHERE account_id = 'player-1'").first();
    expect((await keep({})).answer.error.code).toBe("bad_request");

    // Stripe says it isn't this player's customer, or it didn't finish: no card.
    setupAnswer = { ...setupAnswer, customer: "cus_someone_else" };
    expect((await keep()).answer.error.code).toBe("card_not_saved");
    setupAnswer = { ...setupAnswer, customer: "cus_test_player", status: "requires_payment_method" };
    expect((await keep()).answer.error.code).toBe("card_not_saved");
    expect(await stored()).toBeNull();

    setupAnswer = { status: "succeeded", customer: "cus_test_player", metadata: { receipt_email: "emma@example.com" }, payment_method: { id: "pm_test_new", card: { brand: "mastercard", last4: "4444" } } };
    await saveCard();
    expect((await keep()).answer).toEqual({ saved_card: { card_brand: "mastercard", card_last_digits: "4444" } });
    expect(await stored()).toEqual({ stripe_payment_method_id: "pm_test_new", card_brand: "mastercard", card_last_digits: "4444" });
    // The card it replaced is taken off the player's Stripe customer.
    expect(stripeCalls.filter((call) => call.path.endsWith("/detach")).map((call) => call.path)).toEqual(["/v1/payment_methods/pm_test_saved/detach"]);

    expect((await sheetCall("/api/payment-methods/saved", { method: "DELETE" })).answer).toEqual({ saved_card: null });
    expect(await stored()).toBeNull();
    expect(stripeCalls.filter((call) => call.path.endsWith("/detach")).map((call) => call.path)).toEqual(["/v1/payment_methods/pm_test_saved/detach", "/v1/payment_methods/pm_test_new/detach"]);
    // Nothing saved: forgetting it again is still done.
    expect((await sheetCall("/api/payment-methods/saved", { method: "DELETE" })).answer).toEqual({ saved_card: null });
  });

  it("sets a purchase PIN only with the password, on an account that protects itself", async () => {
    const set = (body: unknown, init: Parameters<typeof player>[1] = {}) => sheetCall("/api/account/purchase-pin", { method: "PUT", body, ...init });
    expect((await set({ purchase_pin: "12345", password: RIGHT_PASSWORD })).answer.error.code).toBe("bad_purchase_pin");
    expect((await set({ purchase_pin: "482917", password: RIGHT_PASSWORD }, { email: NO_EMAIL }))).toMatchObject({ status: 409, answer: { error: { code: "account_protection_needed" } } });
    // No password on the account to check against.
    expect((await set({ purchase_pin: "482917", password: RIGHT_PASSWORD })).answer.error.code).toBe("password_needed");
    await givePassword();
    expect((await set({ purchase_pin: "482917" })).answer.error.code).toBe("wrong_password");
    expect((await set({ purchase_pin: "482917", password: "not the password" })).answer.error.code).toBe("wrong_password");
    expect((await pinState())!.purchase_pin_hash).toBeNull();

    await env.DB.prepare("UPDATE accounts SET purchase_pin_failed_count = 3 WHERE id = 'player-1'").run();
    expect((await set({ purchase_pin: "482917", password: RIGHT_PASSWORD })).answer).toEqual({ has_purchase_pin: true });
    const kept = (await pinState())!;
    expect(kept.purchase_pin_hash).toMatch(/^pbkdf2-sha256\$/);
    expect(kept.purchase_pin_hash).not.toContain("482917");
    expect(kept.purchase_pin_failed_count).toBe(0);
    expect((await player("/api/buy/confirm", { body: { purchase_pin: "482917" } })).answer).toEqual({ is_confirmed: true });

    expect((await sheetCall("/api/account/purchase-pin", { method: "DELETE" })).answer).toEqual({ has_purchase_pin: false });
    expect(await pinState()).toEqual({ purchase_pin_hash: null, purchase_pin_failed_count: 0 });
    expect((await player("/api/buy/confirm", { body: { purchase_pin: "482917" } })).answer.error.code).toBe("no_purchase_pin");
  });
});

describe("the stand-in for Stripe", () => {
  const withOrigins = (siteOrigin: string, apiOrigin: string | undefined) => ({ ...env, SITE_ORIGIN: siteOrigin, STRIPE_API_ORIGIN: apiOrigin }) as typeof env;
  const deployed = ["https://zaisma.com", "https://www.zaisma.com", "https://localhost.zaisma.com", "https://phone.ts.net.zaisma.com", "https://zaisma.test"];
  const preview = [["http://localhost:8800", "localhost"], ["http://127.0.0.1:8801", "127.0.0.1"], ["https://laptop.tail1a2b3.ts.net:8800", "laptop.tail1a2b3.ts.net"]] as const;

  it("is refused on a deployed site, for calls and for Connect's sign-in", async () => {
    for (const siteOrigin of deployed) {
      const deployedEnv = withOrigins(siteOrigin, "http://localhost:8800");
      expect(isLocalPreview(deployedEnv), siteOrigin).toBe(false);
      await expect(stripeCall(deployedEnv, "POST", "/customers", {}), siteOrigin).rejects.toMatchObject({ code: "stripe_unavailable" });
      expect(() => connectUrl(deployedEnv, "state_test"), siteOrigin).toThrow(expect.objectContaining({ code: "stripe_unavailable" }));
      expect(() => stripeOrigins(deployedEnv), siteOrigin).toThrow(/local preview/);
    }
    // Nothing, not even the secret key, left for the stand-in.
    expect(stripeCalls).toEqual([]);
  });

  it("is used by the local preview, on this machine or over its tailnet name", async () => {
    for (const [siteOrigin, host] of preview) {
      const previewEnv = withOrigins(siteOrigin, `http://${host}:9100`);
      expect(isLocalPreview(previewEnv), siteOrigin).toBe(true);
      expect((await stripeCall(previewEnv, "POST", "/customers", {})).id).toBe("cus_test_player");
      expect(stripeCalls.at(-1)).toMatchObject({ host, path: "/v1/customers" });
      expect(connectUrl(previewEnv, "state_test")).toMatch(new RegExp(`^http://${host.replace(/\./g, "\\.")}:9100/oauth/authorize\\?`));
    }
  });

  it("is Stripe itself wherever no stand-in is set", async () => {
    for (const siteOrigin of [...deployed, ...preview.map(([origin]) => origin)]) {
      expect(stripeOrigins(withOrigins(siteOrigin, undefined))).toEqual({ apiOrigin: "https://api.stripe.com", connectOrigin: "https://connect.stripe.com" });
    }
    await stripeCall(withOrigins("https://zaisma.com", undefined), "POST", "/customers", {});
    expect(stripeCalls.at(-1)!.host).toBe("api.stripe.com");
  });
});
