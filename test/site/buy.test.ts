import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { accountById, createAccount, createApiKey, gameBySlug, hashPurchasePin, personOwner } from "@zaisma/core";
import { TOOLS } from "../../apps/site/src/mcp.ts";
import { callerFor } from "../../apps/site/src/developer.ts";
import { stripeAccountRoute } from "../../apps/site/src/stripe-account-api.ts";
import { failStaleSales } from "../../apps/site/src/buy.ts";
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
let stripeCalls: { path: string; form: URLSearchParams; stripeAccount: string | null; idempotencyKey: string | null }[] = [];
let emails: { to: string; subject: string; text: string }[] = [];
let charge: { status: string; amount?: number; declined?: boolean } = { status: "succeeded" };
let connectedAccount: Record<string, unknown> = {};

const b64url = (given: ArrayBuffer | string) =>
  btoa(typeof given === "string" ? given : String.fromCharCode(...new Uint8Array(given)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** A signed-in session's cookie, as Supabase would sign it, with its own session ID. */
async function sessionCookie(accountId: string, sessionId = `session-${accountId}`): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "ES256", kid: "buy-test-key", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ sub: accountId, email: `${accountId}@example.com`, session_id: sessionId, aud: "authenticated", iss: `${SUPABASE}/auth/v1`, exp: nowSec + 3600, iat: nowSec, amr: [{ method: "password", timestamp: nowSec }] }));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKeys.privateKey, new TextEncoder().encode(`${header}.${claims}`));
  return `__Host-zaisma=${header}.${claims}.${b64url(signature)}~r-${accountId}`;
}

async function api(path: string, init: { method?: string; body?: unknown } = {}) {
  const response = await SELF.fetch(`${SITE}/api/dev${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const answer = (await response.json()) as any;
  if (!response.ok) expect(errorProblems(answer, response.status)).toEqual([]);
  return { status: response.status, answer };
}

async function tool(name: string, toolArguments: Record<string, unknown>): Promise<any> {
  const response = await SELF.fetch(`${SITE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: toolArguments } }),
  });
  const { result } = (await response.json()) as any;
  if (result.isError) {
    expect(errorProblems(result.structuredContent)).toEqual([]);
    return result.structuredContent.error;
  }
  expect(schemaProblems(TOOLS.find((candidate) => candidate.name === name)!.outputSchema!, result.structuredContent, name)).toEqual([]);
  return result.structuredContent;
}

/** A call from zaisma.com's own pages, signed in as accountId (or a guest with null). */
async function player(path: string, init: { method?: string; body?: unknown; accountId?: string | null; origin?: string; sessionId?: string } = {}) {
  const accountId = init.accountId === undefined ? "player-1" : init.accountId;
  const method = init.method ?? (init.body ? "POST" : "GET");
  const response = await SELF.fetch(`${SITE}${path}`, {
    method,
    headers: {
      ...(accountId ? { cookie: await sessionCookie(accountId, init.sessionId) } : {}),
      ...(method !== "GET" ? { origin: init.origin ?? SITE } : {}),
      ...(init.body ? { "content-type": "application/json" } : {}),
      "cf-ipcountry": "DE",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, answer: text ? (JSON.parse(text) as any) : null };
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
  connectedAccount = { id: ACCOUNT, charges_enabled: true, country: "de", default_currency: "eur", business_profile: { name: "Pixel Smith Games", support_email: "help@pixelsmith.example" } };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.href === `${SUPABASE}/auth/v1/.well-known/jwks.json`) return Response.json({ keys: [{ ...publicKey, kid: "buy-test-key", alg: "ES256" }] });
    if (url.hostname === "outbox.test") {
      const sent = JSON.parse(String(init?.body ?? "{}"));
      emails.push({ to: sent.to, subject: sent.subject, text: sent.text });
      return Response.json({});
    }
    if (url.hostname !== "api.stripe.com" && url.hostname !== "connect.stripe.com") return realFetch(input, init);
    const form = new URLSearchParams(typeof init?.body === "string" ? init.body : url.search);
    const headers = new Headers(init?.headers);
    stripeCalls.push({ path: url.pathname, form, stripeAccount: headers.get("stripe-account"), idempotencyKey: headers.get("idempotency-key") });
    const path = url.pathname;
    if (path === "/oauth/token") return Response.json({ stripe_user_id: ACCOUNT });
    if (path === "/oauth/deauthorize") return Response.json({ stripe_user_id: ACCOUNT });
    if (path === `/v1/accounts/${ACCOUNT}`) return Response.json(connectedAccount);
    if (path === "/v1/payment_method_domains") return Response.json({ id: "pmd_test" });
    if (path === "/v1/customers") return Response.json({ id: "cus_test_player" });
    if (path === "/v1/payment_methods") return Response.json({ id: "pm_test_clone" });
    if (path === "/v1/payment_intents" && charge.declined) return Response.json({ error: { type: "card_error", code: "card_declined", decline_code: "insufficient_funds", message: "Your card has insufficient funds." } }, { status: 402 });
    if (path === "/v1/payment_intents") {
      return Response.json({ id: "pi_test_sale", status: charge.status, amount: charge.amount ?? Number(form.get("amount")), currency: form.get("currency"), client_secret: "pi_test_sale_secret" });
    }
    if (path.startsWith("/v1/payment_intents/") && path.endsWith("/cancel")) return Response.json({ id: path.split("/")[3], status: "canceled" });
    if (path.startsWith("/v1/payment_intents/")) return Response.json({ id: path.split("/").at(-1), status: charge.status, amount: charge.amount ?? 199, currency: "eur", latest_charge: { billing_details: { email: "wallet@example.com" } } });
    if (path === "/v1/refunds") return Response.json({ id: `re_test_${stripeCalls.length}`, status: "succeeded" });
    return Response.json({ error: { message: `No such call in the stand-in: ${path}` } }, { status: 400 });
  });
  await env.DB.exec(
    "DELETE FROM purchases; DELETE FROM purchase_confirmations; DELETE FROM saved_payment_methods; DELETE FROM stripe_connect_states; DELETE FROM game_items; DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM security_events; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;",
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
const saveCard = () => env.DB.prepare("INSERT INTO saved_payment_methods (account_id, stripe_payment_method_id, card_brand, card_last_digits, receipt_email, created_at_ms) VALUES ('player-1', 'pm_test_saved', 'visa', '4242', 'emma@example.com', ?)").bind(Date.now()).run();
const setPin = async (pin = "482917") => env.DB.prepare("UPDATE accounts SET purchase_pin_hash = ? WHERE id = 'player-1'").bind(await hashPurchasePin(pin)).run();

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
    expect(await env.DB.prepare("SELECT event_kind FROM security_events WHERE account_id = 'dev-1' AND event_kind = 'stripe_account_connected'").first()).not.toBeNull();
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
      is_confirmation_needed: true,
      wallet: { publishable_key: "pk_test_zaisma", stripe_account_id: ACCOUNT },
    });
    const sale = await env.DB.prepare("SELECT * FROM purchases WHERE id = ?").bind(answer.purchase_id).first<any>();
    expect(sale).toMatchObject({ purchase_source: "sale", purchase_status: "pending", item_count: 3, paid_minor_units: 597, currency_code: "eur", player_id: playerId, game_account_id: "farmer-42", stripe_account_id: ACCOUNT, is_eu_withdrawal_line_shown: 1 });
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
    expect(emails.filter((email) => email.to === "emma@example.com")).toHaveLength(1);
    expect(emails[0]!.text).toContain("Pixel Smith Games");
    expect((await player(`/api/buy/purchases/${purchaseId}/pay-with-saved-card`, { method: "POST" })).answer.error.code).toBe("already_paid");
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
    await connectEvent("payment_intent.succeeded", { id: "pi_test_barn", status: "succeeded", amount: 999, currency: "eur" });
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
