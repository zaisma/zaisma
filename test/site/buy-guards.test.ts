import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { accountById, createAccount, createApiKey, deleteAccount, gameBySlug, hashPurchasePin, personOwner } from "@zaisma/core";
import { failStaleSales, handleBuy } from "../../apps/site/src/buy.ts";
import { errorProblems } from "../schema-check.ts";
import { letPublish } from "../helpers.ts";

// The guards around the buy sheet that review found missing (apps/site/src/buy.ts, sales.ts, stripe.ts, items-api.ts,
// account.ts, packages/core/src/accounts.ts): who a receipt can go to, who may buy, tax on wallet payments, the
// total's cap, stale sales, the PIN's lock, rate limits, and what is kept or cleared when money or accounts go.
// Against a stand-in for Stripe: nothing real is reached. Its setup copies test/site/buy.test.ts.

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
let stripeCalls: { path: string; method: string; form: URLSearchParams; stripeAccount: string | null; idempotencyKey: string | null }[] = [];
let charge: { status: string; failure: "card" | "stripe" | null } = { status: "succeeded", failure: null };
let setupMetadata: Record<string, string> = {};
let isTaxCalculationFailing = false;
let intentLookupErrorCode: string | null = null;
let isDeauthorizeFailing = false;

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

/** A call from zaisma.com's own pages, signed in as accountId (or a guest with null). */
async function player(path: string, init: { method?: string; body?: unknown; accountId?: string | null; origin?: string } = {}) {
  const accountId = init.accountId === undefined ? "player-1" : init.accountId;
  const method = init.method ?? (init.body ? "POST" : "GET");
  const response = await SELF.fetch(`${SITE}${path}`, {
    method,
    headers: {
      ...(accountId ? { cookie: await sessionCookie(accountId) } : {}),
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
async function connectEvent(type: string, object: Record<string, unknown>, account = ACCOUNT): Promise<Response> {
  const body = JSON.stringify({ id: `evt_${nextId++}`, type, account, data: { object } });
  const signedAtSec = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(CONNECT_EVENTS_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
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
  charge = { status: "succeeded", failure: null };
  setupMetadata = {};
  isTaxCalculationFailing = false;
  intentLookupErrorCode = null;
  isDeauthorizeFailing = false;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.href === `${SUPABASE}/auth/v1/.well-known/jwks.json`) return Response.json({ keys: [{ ...publicKey, kid: "buy-test-key", alg: "ES256" }] });
    if (url.hostname === "supabase.test" && init?.method === "DELETE") return Response.json({});
    if (url.hostname === "outbox.test") return Response.json({});
    if (url.hostname !== "api.stripe.com" && url.hostname !== "connect.stripe.com") return realFetch(input, init);
    const form = new URLSearchParams(typeof init?.body === "string" ? init.body : url.search);
    const headers = new Headers(init?.headers);
    const method = init?.method ?? "GET";
    stripeCalls.push({ path: url.pathname, method, form, stripeAccount: headers.get("stripe-account"), idempotencyKey: headers.get("idempotency-key") });
    const path = url.pathname;
    if (path === "/oauth/token") return Response.json({ stripe_user_id: ACCOUNT });
    if (path === "/oauth/deauthorize") return isDeauthorizeFailing ? Response.json({ error: "server_error", error_description: "Stripe is having trouble." }, { status: 500 }) : Response.json({ stripe_user_id: ACCOUNT });
    if (path === "/v1/payment_method_domains") return Response.json({ id: "pmd_test" });
    if (path === "/v1/customers") return Response.json({ id: "cus_test_player" });
    if (path === "/v1/payment_methods") return Response.json({ id: "pm_test_clone" });
    if (path === "/v1/setup_intents" && method === "POST") {
      setupMetadata = Object.fromEntries([...form].filter(([key]) => key.startsWith("metadata[")).map(([key, value]) => [key.slice("metadata[".length, -1), value]));
      return Response.json({ id: "seti_test", client_secret: "seti_test_secret" });
    }
    if (path === "/v1/setup_intents/seti_test") {
      return Response.json({ id: "seti_test", status: "succeeded", customer: "cus_test_player", metadata: setupMetadata, payment_method: { id: "pm_test_new_card", card: { brand: "visa", last4: "4242" } } });
    }
    if (path === "/v1/tax/calculations") return isTaxCalculationFailing ? Response.json({ error: { message: "No tax here." } }, { status: 400 }) : Response.json({ id: "taxcalc_test" });
    if (path === "/v1/tax/transactions/create_from_calculation") return Response.json({ id: "taxtxn_test" });
    if (path === "/v1/payment_intents" && charge.failure === "card") return Response.json({ error: { type: "card_error", code: "card_declined", decline_code: "insufficient_funds", message: "Your card has insufficient funds." } }, { status: 402 });
    if (path === "/v1/payment_intents" && charge.failure === "stripe") return Response.json({ error: { type: "api_error", message: "Stripe is having trouble." } }, { status: 500 });
    if (path === "/v1/payment_intents") return Response.json({ id: "pi_test_sale", status: charge.status, amount: Number(form.get("amount")), currency: form.get("currency"), client_secret: "pi_test_sale_secret" });
    if (path.startsWith("/v1/payment_intents/") && path.endsWith("/cancel")) return Response.json({ id: path.split("/")[3], status: "canceled" });
    if (path.startsWith("/v1/payment_intents/") && intentLookupErrorCode) return Response.json({ error: { type: "invalid_request_error", code: intentLookupErrorCode, message: "No access to that account." } }, { status: 403 });
    if (path.startsWith("/v1/payment_intents/")) return Response.json({ id: path.split("/").at(-1), status: charge.status, amount: 199, currency: "eur", latest_charge: { billing_details: { email: "wallet@example.com" } } });
    if (path === "/v1/refunds") return Response.json({ id: `re_test_${stripeCalls.length}`, status: "succeeded" });
    return Response.json({ error: { message: `No such call in the stand-in: ${path}` } }, { status: 400 });
  });
  await env.DB.exec(
    "DELETE FROM purchases; DELETE FROM purchase_confirmations; DELETE FROM saved_payment_methods; DELETE FROM stripe_connect_states; DELETE FROM game_items; DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM security_events; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM retired_game_slugs; DELETE FROM accounts;",
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
  await connect();
});

/** The developer connected, as the return from Stripe leaves it. */
const connect = () => env.DB.prepare("UPDATE owners SET stripe_account_id = ?, can_take_stripe_payments = 1, stripe_country_code = 'DE', stripe_default_currency_code = 'eur', stripe_business_name = 'Pixel Smith Games', stripe_support_email = 'help@pixelsmith.example', stripe_connected_at_ms = ? WHERE id = ?").bind(ACCOUNT, Date.now(), ownerId).run();
const setItem = (itemName: string, fields: Record<string, unknown>) => api(`/games/tiny-farm/items/${itemName}`, { method: "PUT", body: { description: "", item_category: "gameplay", is_on_game_page: false, local_prices: [], ...fields } });
const revive = { title: "Revive", item_kind: "consumable", price_minor_units: 199, currency_code: "eur" };
const barn = { title: "Golden Barn", item_kind: "permanent", item_category: "cosmetic", price_minor_units: 999, currency_code: "eur" };
const saveCard = () => env.DB.prepare("INSERT INTO saved_payment_methods (account_id, stripe_payment_method_id, card_brand, card_last_digits, created_at_ms) VALUES ('player-1', 'pm_test_saved', 'visa', '4242', ?)").bind(Date.now()).run();
const setPin = async (pin = "482917") => env.DB.prepare("UPDATE accounts SET purchase_pin_hash = ? WHERE id = 'player-1'").bind(await hashPurchasePin(pin)).run();
const started = async (itemName = "revive") => (await player("/api/buy/tiny-farm/start", { body: { item_name: itemName } })).answer.purchase_id as string;
const confirmed = async () => {
  await setPin();
  expect((await player("/api/buy/confirm", { body: { purchase_pin: "482917" } })).answer).toEqual({ is_confirmed: true });
};

describe("a saved card's receipts (review 14 and 21)", () => {
  it("never takes a receipt address from the browser: a saved card's receipts go to the account's email", async () => {
    const setup = await player("/api/payment-methods/setup", { body: { receipt_email: "victim@example.com" } });
    expect(setup.answer).toEqual({ setup_intent_id: "seti_test", client_secret: expect.any(String) });
    expect(setupMetadata.receipt_email).toBeUndefined();
    const kept = await player("/api/payment-methods/saved", { body: { setup_intent_id: "seti_test", receipt_email: "victim@example.com" } });
    expect(kept.answer).toEqual({ saved_card: { card_brand: "visa", card_last_digits: "4242" } });
  });
});

describe("a game's minimum player age (review 15)", () => {
  beforeEach(async () => {
    await setItem("revive", revive);
    await env.DB.prepare("UPDATE games SET minimum_player_age_years = 16 WHERE slug = 'tiny-farm'").run();
    await createAccount(env.DB, { id: "player-teen", username: "Noah_Young", ageBand: "13-15" });
  });

  it("turns a younger account away from the sheet, with nothing recorded", async () => {
    const turned = await player("/api/buy/tiny-farm/start", { body: { item_name: "revive" }, accountId: "player-teen" });
    expect(turned).toMatchObject({ status: 403, answer: { error: { code: "game_not_open_to_player" } } });
    expect(await env.DB.prepare("SELECT 1 FROM purchases").first()).toBeNull();
    expect((await player("/api/buy/tiny-farm/start", { body: { item_name: "revive" } })).status).toBe(200);
  });

  it("turns them away from the buy window too, and lets an old enough account in", async () => {
    const window = async (accountId: string) => SELF.fetch(`${SITE}/buy/tiny-farm/revive`, { headers: { cookie: `${await sessionCookie(accountId)}; __Host-zaisma_in=1` } });
    const teen = await window("player-teen");
    expect(teen.status).toBe(403);
    expect(await teen.text()).toContain("isn&#39;t open to your account");
    expect((await window("player-1")).status).toBe(200);
  });
});

describe("Stripe Tax on wallet payments (review 16)", () => {
  beforeEach(async () => {
    await env.DB.prepare("UPDATE owners SET is_stripe_tax_used = 1 WHERE id = ?").bind(ownerId).run();
    await setItem("revive", revive);
  });

  it("calculates the tax inside the price for Apple Pay and Google Pay, carries it on the payment, and records it once when paid", async () => {
    const purchaseId = await started();
    const intent = await player(`/api/buy/purchases/${purchaseId}/wallet-intent`, { method: "POST" });
    expect(intent.answer).toEqual({ client_secret: "pi_test_sale_secret", stripe_account_id: ACCOUNT });
    const calculation = stripeCalls.find((call) => call.path === "/v1/tax/calculations")!;
    expect(calculation).toMatchObject({ stripeAccount: ACCOUNT });
    expect(Object.fromEntries(calculation.form)).toMatchObject({ currency: "eur", "line_items[0][amount]": "199", "line_items[0][tax_behavior]": "inclusive" });
    const paymentIntent = stripeCalls.find((call) => call.path === "/v1/payment_intents")!;
    expect(Object.fromEntries(paymentIntent.form)).toMatchObject({ amount: "199", "metadata[tax_calculation]": "taxcalc_test" });
    expect(await env.DB.prepare("SELECT stripe_tax_calculation_id FROM purchases WHERE id = ?").bind(purchaseId).first()).toEqual({ stripe_tax_calculation_id: "taxcalc_test" });

    const paid = { id: "pi_test_sale", status: "succeeded", amount: 199, currency: "eur", latest_charge: { billing_details: { email: "wallet@example.com" } } };
    await connectEvent("payment_intent.succeeded", paid);
    await connectEvent("payment_intent.succeeded", paid);
    expect(await statusOf(purchaseId)).toBe("completed");
    expect(stripeCalls.filter((call) => call.path === "/v1/tax/transactions/create_from_calculation")).toHaveLength(1);
  });

  it("still completes the wallet payment when Stripe can't calculate the tax", async () => {
    isTaxCalculationFailing = true;
    const purchaseId = await started();
    expect((await player(`/api/buy/purchases/${purchaseId}/wallet-intent`, { method: "POST" })).answer.client_secret).toBe("pi_test_sale_secret");
    const paymentIntent = stripeCalls.find((call) => call.path === "/v1/payment_intents")!;
    expect(paymentIntent.form.has("metadata[tax_calculation]")).toBe(false);
    await connectEvent("payment_intent.succeeded", { id: "pi_test_sale", status: "succeeded", amount: 199, currency: "eur" });
    expect(await statusOf(purchaseId)).toBe("completed");
    expect(stripeCalls.filter((call) => call.path === "/v1/tax/transactions/create_from_calculation")).toEqual([]);
  });

  it("calculates nothing when the developer doesn't use Stripe Tax", async () => {
    await env.DB.prepare("UPDATE owners SET is_stripe_tax_used = 0 WHERE id = ?").bind(ownerId).run();
    await player(`/api/buy/purchases/${await started()}/wallet-intent`, { method: "POST" });
    expect(stripeCalls.filter((call) => call.path === "/v1/tax/calculations")).toEqual([]);
  });
});

describe("the total and Stripe's answers (review 17)", () => {
  it("refuses a total over what Stripe takes before anything is recorded", async () => {
    await setItem("revive", { ...revive, price_minor_units: 60_000_000 });
    const refused = await player("/api/buy/tiny-farm/start", { body: { item_name: "revive", item_count: 2 } });
    expect(refused).toMatchObject({ status: 400, answer: { error: { code: "bad_item_count" } } });
    expect(await env.DB.prepare("SELECT 1 FROM purchases").first()).toBeNull();
    expect((await player("/api/buy/tiny-farm/start", { body: { item_name: "revive", item_count: 1 } })).answer.price.price_minor_units).toBe(60_000_000);
  });

  it("fails the sale on a really declined card, but not when Stripe itself is in trouble: that can be tried again", async () => {
    await setItem("revive", revive);
    await saveCard();
    const purchaseId = await started();
    charge = { status: "succeeded", failure: "stripe" };
    const trouble = await player(`/api/buy/purchases/${purchaseId}/pay-with-saved-card`, { method: "POST" });
    expect(trouble.answer.error.code).toBe("stripe_unavailable");
    expect(trouble.status).toBeGreaterThanOrEqual(500);
    expect(await statusOf(purchaseId)).toBe("pending");
    charge = { status: "succeeded", failure: null };
    expect((await player(`/api/buy/purchases/${purchaseId}/pay-with-saved-card`, { method: "POST" })).answer.status).toBe("completed");

    const declinedId = await started();
    charge = { status: "requires_payment_method", failure: "card" };
    expect((await player(`/api/buy/purchases/${declinedId}/pay-with-saved-card`, { method: "POST" })).answer.error.code).toBe("payment_declined");
    expect(await statusOf(declinedId)).toBe("failed");
  });
});

describe("the daily step for old pending sales (review 18)", () => {
  /** Pending sales made two days ago, with or without a payment at Stripe. */
  async function stale(count: number, paymentPrefix: string | null, stripeAccountId = ACCOUNT) {
    const gameId = (await gameBySlug(env.DB, "tiny-farm"))!.id;
    const createdAtMs = Date.now() - 2 * 86_400_000;
    for (let from = 0; from < count; from += 50) {
      await env.DB.batch(
        Array.from({ length: Math.min(50, count - from) }, (_, offset) => {
          const index = from + offset;
          return env.DB.prepare(
            "INSERT INTO purchases (id, game_id, item_name, item_kind, item_count, player_id, purchase_source, purchase_status, paid_minor_units, currency_code, stripe_account_id, stripe_payment_intent_id, created_at_ms, is_eu_withdrawal_line_shown) VALUES (?, ?, 'revive', 'consumable', 1, ?, 'sale', 'pending', 199, 'eur', ?, ?, ?, 0)",
          ).bind(`purchase_${paymentPrefix ?? "bare"}${String(index).padStart(5, "0")}`, gameId, playerId, stripeAccountId, paymentPrefix ? `pi_${paymentPrefix}${index}` : null, createdAtMs + index);
        }),
      );
    }
  }
  const countOf = async (status: string) => (await env.DB.prepare("SELECT COUNT(*) AS n FROM purchases WHERE purchase_status = ?").bind(status).first<{ n: number }>())!.n;

  it("fails every sheet nobody paid on with one statement, however many there are, without calling Stripe", async () => {
    await stale(620, null);
    await failStaleSales(env);
    expect(await countOf("failed")).toBe(620);
    expect(stripeCalls).toEqual([]);
  });

  it("works through more paid-at-Stripe sales than one batch holds, cancelling each", async () => {
    await stale(230, "abandoned");
    charge = { status: "requires_payment_method", failure: null };
    await failStaleSales(env);
    expect(await countOf("failed")).toBe(230);
    expect(stripeCalls.filter((call) => call.path.endsWith("/cancel"))).toHaveLength(230);
  });

  it("fails sales of an account that is gone, without asking Stripe, and when Stripe says it has no access", async () => {
    await stale(3, "gone", "acct_test_disconnected");
    await failStaleSales(env);
    expect(await countOf("failed")).toBe(3);
    expect(stripeCalls).toEqual([]);

    await stale(2, "revoked");
    intentLookupErrorCode = "account_invalid";
    await failStaleSales(env);
    expect(await countOf("failed")).toBe(5);
  });
});

describe("deleting an account (review 19 and 23)", () => {
  /** Deleting needs a proof from the last 10 minutes ("Confirm it's you"): a password one, as a fresh sign-in leaves. */
  const deleteBy = async (accountId: string) => {
    await env.DB.prepare("INSERT INTO session_proofs (session_id, account_id, proof_kind, passkey_id, proved_at_ms) VALUES (?, ?, 'password', NULL, ?)").bind(`session-${accountId}`, accountId, Date.now()).run();
    return SELF.fetch(`${SITE}/account/delete`, { method: "POST", headers: { cookie: await sessionCookie(accountId), origin: SITE, "content-type": "application/x-www-form-urlencoded" }, body: "confirm=delete", redirect: "manual" });
  };

  it("ends Zaisma's access to a developer's Stripe account", async () => {
    const response = await deleteBy("dev-1");
    expect(response.headers.get("location")).toBeNull();
    expect(response.status).toBe(200);
    expect(await accountById(env.DB, "dev-1")).toBeNull();
    expect(stripeCalls.find((call) => call.path === "/oauth/deauthorize")!.form.get("stripe_user_id")).toBe(ACCOUNT);
  });

  it("deletes the account anyway when Stripe can't be reached", async () => {
    isDeauthorizeFailing = true;
    expect((await deleteBy("dev-1")).status).toBe(200);
    expect(await accountById(env.DB, "dev-1")).toBeNull();
    expect(stripeCalls.filter((call) => call.path === "/oauth/deauthorize")).toHaveLength(1);
  });

  it("takes a player's receipt email off their purchases and keeps the sales", async () => {
    await setItem("revive", revive);
    const purchaseId = await started();
    await env.DB.prepare("UPDATE purchases SET purchase_status = 'completed', purchased_at_ms = ?, receipt_email = 'emma@example.com' WHERE id = ?").bind(Date.now(), purchaseId).run();
    await deleteAccount(env.DB, "player-1");
    expect(await env.DB.prepare("SELECT purchase_status, paid_minor_units, receipt_email FROM purchases WHERE id = ?").bind(purchaseId).first()).toEqual({ purchase_status: "completed", paid_minor_units: 199, receipt_email: null });
  });
});

describe("the purchase PIN's lock (review 20)", () => {
  it("counts a try before the PIN is checked, so parallel guesses can't beat the 5 tries", async () => {
    await setPin();
    const answers = await Promise.all(Array.from({ length: 14 }, (_, guess) => player("/api/buy/confirm", { body: { purchase_pin: String(guess).padStart(6, "0") } })));
    expect(answers.filter((answer) => answer.answer.error.code === "wrong_purchase_pin")).toHaveLength(4);
    expect(answers.filter((answer) => answer.answer.error.code === "purchase_pin_locked")).toHaveLength(10);
    // Only five tries were ever taken; the count doesn't climb past the lock.
    expect(await env.DB.prepare("SELECT purchase_pin_failed_count FROM accounts WHERE id = 'player-1'").first()).toEqual({ purchase_pin_failed_count: 5 });
    expect((await player("/api/buy/confirm", { body: { purchase_pin: "482917" } })).answer.error.code).toBe("purchase_pin_locked");
  });

  it("starts the count over after a right PIN", async () => {
    await setPin();
    await player("/api/buy/confirm", { body: { purchase_pin: "000000" } });
    expect((await player("/api/buy/confirm", { body: { purchase_pin: "482917" } })).answer).toEqual({ is_confirmed: true });
    expect(await env.DB.prepare("SELECT purchase_pin_failed_count FROM accounts WHERE id = 'player-1'").first()).toEqual({ purchase_pin_failed_count: 0 });
  });
});

describe("the rate limit on every call that reaches Stripe (review 24)", () => {
  /** zaisma.com's own call to the handler, with a PURCHASE_LIMIT that is used up (and the keys it was asked about). */
  async function limited(path: string, method: string, body?: unknown) {
    const keys: string[] = [];
    const used = { ...env, PURCHASE_LIMIT: { limit: async ({ key }: { key: string }) => (keys.push(key), { success: false }) } } as unknown as typeof env;
    const request = new Request(`${SITE}${path}`, { method, headers: { cookie: await sessionCookie("player-1"), ...(method !== "GET" ? { origin: SITE, "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const response = (await handleBuy(request as never, used as never, path))!;
    return { status: response.status, answer: (await response.json()) as any, keys };
  }

  it("answers slow_down for the card setup, keeping the card, a purchase's poll and a wallet payment, keyed by account", async () => {
    await setItem("revive", revive);
    const purchaseId = await started();
    stripeCalls = [];
    const calls: [string, string, unknown?][] = [
      ["/api/payment-methods/setup", "POST", {}],
      ["/api/payment-methods/saved", "POST", { setup_intent_id: "seti_test" }],
      [`/api/buy/purchases/${purchaseId}`, "GET"],
      [`/api/buy/purchases/${purchaseId}/wallet-intent`, "POST"],
    ];
    for (const [path, method, body] of calls) {
      const answered = await limited(path, method, body);
      expect(answered).toMatchObject({ status: 429, answer: { error: { code: "slow_down" } } });
      expect(answered.keys).toHaveLength(1);
      expect(answered.keys[0]).toContain("player-1");
    }
    expect(stripeCalls).toEqual([]);
    expect(await statusOf(purchaseId)).toBe("pending");
  });

  it("still lets calls through while the limit has room", async () => {
    await setItem("revive", revive);
    const purchaseId = await started();
    expect((await player(`/api/buy/purchases/${purchaseId}`)).status).toBe(200);
    expect((await player("/api/payment-methods/setup", { body: {} })).status).toBe(200);
  });
});

describe("refunding after Stripe was disconnected (review 26) and a partial refund (review 30)", () => {
  let purchaseId = "";
  beforeEach(async () => {
    await setItem("golden_barn", barn);
    purchaseId = await started("golden_barn");
    await env.DB.prepare("UPDATE purchases SET stripe_payment_intent_id = 'pi_test_barn' WHERE id = ?").bind(purchaseId).run();
    await connectEvent("payment_intent.succeeded", { id: "pi_test_barn", status: "succeeded", amount: 999, currency: "eur", latest_charge: { billing_details: { email: "emma@example.com" } } });
    expect(await statusOf(purchaseId)).toBe("completed");
  });

  it("answers stripe_not_connected with the Stripe dashboard as the fix, and calls nothing", async () => {
    await api("/stripe-account", { method: "DELETE" });
    stripeCalls = [];
    const refused = await api(`/games/tiny-farm/purchases/${purchaseId}/refund`, { method: "POST", body: {} });
    expect(refused.status).toBe(409);
    expect(refused.answer.error).toMatchObject({ code: "stripe_not_connected", field: "purchase_id" });
    expect(refused.answer.error.fix).toContain("Stripe dashboard");
    expect(stripeCalls).toEqual([]);
    expect(await statusOf(purchaseId)).toBe("completed");
  });

  it("sets refunded_at only when the item is taken back, not for a partial refund", async () => {
    const partial = await api(`/games/tiny-farm/purchases/${purchaseId}/refund`, { method: "POST", body: { amount_minor_units: 250 } });
    expect(partial.answer.purchase).toMatchObject({ purchase_status: "completed", refunded_minor_units: 250, refunded_at: null });
    await connectEvent("charge.refunded", { id: "ch_test", payment_intent: "pi_test_barn", amount_refunded: 400 });
    expect(await env.DB.prepare("SELECT refunded_minor_units, refunded_at_ms FROM purchases WHERE id = ?").bind(purchaseId).first()).toEqual({ refunded_minor_units: 400, refunded_at_ms: null });
    const rest = await api(`/games/tiny-farm/purchases/${purchaseId}/refund`, { method: "POST", body: {} });
    expect(rest.answer.purchase).toMatchObject({ purchase_status: "refunded", refunded_minor_units: 999, refunded_at: expect.any(String) });
  });
});

describe("a game blocked in the player's country (review 31)", () => {
  const blockDe = () => env.DB.prepare("UPDATE games SET country_blocks = ? WHERE slug = 'tiny-farm'").bind(JSON.stringify([{ country_code: "DE", review_reason: { code: "country_law_notice", content_rule: null, message: "A notice.", fix: "None." }, blocked_at_ms: Date.now() }])).run();

  it("refuses the sheet with a 451 and records nothing, and refuses the buy window the same way", async () => {
    await setItem("revive", revive);
    await blockDe();
    const turned = await player("/api/buy/tiny-farm/start", { body: { item_name: "revive" } });
    expect(turned).toMatchObject({ status: 451, answer: { error: { code: "game_unavailable" } } });
    expect(turned.answer.error.message).toContain("Germany");
    expect(await env.DB.prepare("SELECT 1 FROM purchases").first()).toBeNull();
    const window = await SELF.fetch(`${SITE}/buy/tiny-farm/revive`, { headers: { cookie: `${await sessionCookie("player-1")}; __Host-zaisma_in=1`, "cf-ipcountry": "DE" } });
    expect(window.status).toBe(451);
    expect(await window.text()).toContain("isn&#39;t available in your country");
  });

  it("refuses to pay a sale left pending before the block, by saved card and by wallet, and calls nothing at Stripe", async () => {
    await setItem("revive", revive);
    await saveCard();
    await confirmed();
    const purchaseId = await started();
    await blockDe();
    stripeCalls = [];
    expect(await player(`/api/buy/purchases/${purchaseId}/pay-with-saved-card`, { method: "POST" })).toMatchObject({ status: 451, answer: { error: { code: "game_unavailable" } } });
    expect(await player(`/api/buy/purchases/${purchaseId}/wallet-intent`, { method: "POST" })).toMatchObject({ status: 451, answer: { error: { code: "game_unavailable" } } });
    expect(stripeCalls).toEqual([]);
    expect(await statusOf(purchaseId)).toBe("pending");
  });
});

describe("the rate limit on paying and forgetting the card (review 32)", () => {
  async function limited(path: string, method: string) {
    const keys: string[] = [];
    const used = { ...env, PURCHASE_LIMIT: { limit: async ({ key }: { key: string }) => (keys.push(key), { success: false }) } } as unknown as typeof env;
    const request = new Request(`${SITE}${path}`, { method, headers: { cookie: await sessionCookie("player-1"), origin: SITE, "content-type": "application/json" }, body: method === "DELETE" ? undefined : "{}" });
    const response = (await handleBuy(request as never, used as never, path))!;
    return { status: response.status, answer: (await response.json()) as any, keys };
  }

  it("answers slow_down for pay-with-saved-card (key pay:) and forgetting the card (key card:), calling nothing at Stripe", async () => {
    await setItem("revive", revive);
    await saveCard();
    const purchaseId = await started();
    stripeCalls = [];
    const paid = await limited(`/api/buy/purchases/${purchaseId}/pay-with-saved-card`, "POST");
    expect(paid).toMatchObject({ status: 429, answer: { error: { code: "slow_down" } }, keys: ["pay:player-1"] });
    const forgotten = await limited("/api/payment-methods/saved", "DELETE");
    expect(forgotten).toMatchObject({ status: 429, answer: { error: { code: "slow_down" } }, keys: ["card:player-1"] });
    expect(stripeCalls).toEqual([]);
    expect(await env.DB.prepare("SELECT 1 FROM saved_payment_methods").first()).not.toBeNull();
  });
});

describe("set_item's next steps when Stripe can't take payments yet (review 33)", () => {
  it("points at get_stripe_account to finish setting up on Stripe, and at nothing once payments are on", async () => {
    await env.DB.prepare("UPDATE owners SET can_take_stripe_payments = 0 WHERE id = ?").bind(ownerId).run();
    const waiting = await setItem("revive", revive);
    expect(waiting.answer.next_steps).toEqual([expect.objectContaining({ tool: "get_stripe_account", reason: expect.stringContaining("Stripe's dashboard") })]);
    await connect();
    expect((await setItem("revive", revive)).answer.next_steps).toEqual([]);
  });
});

describe("a developer's mistake names its fix (review 34)", () => {
  it("answers the sheet with the developer's message and fix, from /start", async () => {
    await setItem("revive", revive);
    await env.DB.prepare("UPDATE owners SET can_take_stripe_payments = 0 WHERE id = ?").bind(ownerId).run();
    const cannot = await player("/api/buy/tiny-farm/start", { body: { item_name: "revive" } });
    expect(cannot).toMatchObject({ status: 409, answer: { error: { code: "stripe_cannot_take_payments", message: expect.stringContaining("hasn't turned on payments"), fix: expect.stringContaining("Stripe's dashboard") } } });
    await env.DB.prepare("UPDATE owners SET stripe_account_id = NULL WHERE id = ?").bind(ownerId).run();
    const unconnected = await player("/api/buy/tiny-farm/start", { body: { item_name: "revive" } });
    expect(unconnected.answer.error).toMatchObject({ code: "stripe_not_connected", fix: expect.stringContaining("connect_stripe_account") });
  });
});
