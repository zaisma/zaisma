import { env, SELF } from "cloudflare:test";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addCreditEntry, addPasskey, createAccount, createApiKey, creditOf, deleteAccount, personOwner, refundableTopUps } from "@zaisma/core";
import { TOOLS } from "../../apps/site/src/mcp.ts";
import { callerFor } from "../../apps/site/src/developer.ts";
import { creditKeptOnDeletionCents, creditRoute, refundForDeletion, retryPendingRefunds } from "../../apps/site/src/credit-api.ts";
import { answerSpendingRequest, askForSpending } from "../../apps/site/src/spending-requests.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";
import { letPublish } from "../helpers.ts";

// Hosting credit through the developer API and MCP (apps/site/src/credit-api.ts) and Stripe's events
// (apps/site/src/stripe-events.ts), against a stand-in for Stripe's API: Zaisma's own Stripe account is never reached.

const SITE = "https://zaisma.test";
const EVENTS_SECRET = "whsec_test_zaisma";
const DAY_MS = 86_400_000;
let token = "";
let ownerId = "";
let nextId = 1;
const realFetch = globalThis.fetch;
/** What reached the stand-in for Stripe: each call's path and form. */
let stripeCalls: { path: string; form: URLSearchParams; idempotencyKey: string | null }[] = [];
/** The email Supabase knows the account by: a real one, or the stand-in an account without one is known by. */
let accountEmail = "emma@example.com";
/** Stripe can't be reached. */
let isStripeDown = false;

beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === "https://supabase.test" && url.pathname === "/auth/v1/admin/users/dev-1") return Response.json({ id: "dev-1", email: accountEmail });
    if (url.hostname !== "api.stripe.com") return realFetch(input, init);
    const form = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
    const headers = new Headers(init?.headers);
    stripeCalls.push({ path: url.pathname, form, idempotencyKey: headers.get("idempotency-key") });
    if (isStripeDown) throw new TypeError("fetch failed");
    if (url.pathname === "/v1/customers") return Response.json({ id: "cus_test_1" });
    if (url.pathname === "/v1/checkout/sessions") return Response.json({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1", expires_at: 1_900_000_000 });
    if (url.pathname === "/v1/refunds") return Response.json({ id: `re_test_${stripeCalls.length}` });
    return Response.json({ error: { message: "No such call in the stand-in." } }, { status: 400 });
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

async function api(path: string, init: { method?: string; body?: unknown; key?: string } = {}) {
  const res = await SELF.fetch(`${SITE}/api/dev${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { authorization: `Bearer ${init.key ?? token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const answer = (await res.json()) as any;
  if (!res.ok) expect(errorProblems(answer, res.status)).toEqual([]);
  return { status: res.status, answer };
}

async function tool(name: string, toolArguments: Record<string, unknown>): Promise<any> {
  const res = await SELF.fetch(`${SITE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: toolArguments } }),
  });
  const { result } = (await res.json()) as any;
  if (result.isError) {
    expect(errorProblems(result.structuredContent)).toEqual([]);
    return result.structuredContent.error;
  }
  expect(schemaProblems(TOOLS.find((candidate) => candidate.name === name)!.outputSchema!, result.structuredContent, name)).toEqual([]);
  return result.structuredContent;
}

/** An event as Stripe signs it: Stripe-Signature t=<seconds>,v1=<HMAC-SHA256 of "<t>.<body>">. */
async function stripeEvent(event: unknown, secret = EVENTS_SECRET, signedAtMs = Date.now()): Promise<Response> {
  const body = JSON.stringify(event);
  const signedAtSec = Math.floor(signedAtMs / 1000);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${signedAtSec}.${body}`)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return SELF.fetch(`${SITE}/stripe/events`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": `t=${signedAtSec},v1=${signature}` }, body });
}

const checkoutCompleted = (paymentIntentId: string, amountCents: number) => ({
  id: `evt_${paymentIntentId}`,
  type: "checkout.session.completed",
  data: { object: { id: `cs_${paymentIntentId}`, mode: "payment", payment_status: "paid", payment_intent: paymentIntentId, amount_subtotal: amountCents, amount_total: amountCents, metadata: { owner_id: ownerId } } },
});

beforeEach(async () => {
  await env.DB.exec("DELETE FROM passkeys; DELETE FROM credit_entries; DELETE FROM spending_requests; DELETE FROM game_hosting_months; DELETE FROM security_events; DELETE FROM api_keys; DELETE FROM audit_log; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;");
  stripeCalls = [];
  accountEmail = "emma@example.com";
  isStripeDown = false;
  await env.DB.exec("DELETE FROM pending_refunds;");
  await createAccount(env.DB, { id: "dev-1", username: "Pixel_Smith", ageBand: "18+" });
  await letPublish(env.DB, "dev-1");
  token = (await createApiKey(env.DB, "dev-1", "claude")).token;
  ownerId = (await personOwner(env.DB, "dev-1")).id;
});

describe("a top-up", () => {
  it("answers Stripe's page for whole cents from $10 to $1,000, with Managed Payments on and no card kept", async () => {
    const started = await tool("top_up_credit", { amount_cents: 2000 });
    expect(started).toMatchObject({ checkout_url: "https://checkout.stripe.com/c/pay/cs_test_1", next_steps: [expect.objectContaining({ tool: "get_credit" })] });
    const session = stripeCalls.find((call) => call.path === "/v1/checkout/sessions")!.form;
    expect(Object.fromEntries(session)).toMatchObject({
      mode: "payment",
      customer: "cus_test_1",
      "managed_payments[enabled]": "true",
      "line_items[0][price_data][unit_amount]": "2000",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][product_data][name]": "Zaisma hosting credit",
      "payment_intent_data[metadata][top_up_kind]": "checkout",
      "metadata[owner_id]": ownerId,
      success_url: `${SITE}/dashboard/settings#hosting`,
    });
    // Stripe is the seller of every top-up: no card is saved for a charge later.
    expect(session.has("payment_intent_data[setup_future_usage]")).toBe(false);
    // Nothing Managed Payments refuses (Stripe answers "You cannot use custom_text with Managed Payments").
    expect([...session.keys()].filter((name) => /^(custom_text|automatic_tax|tax_id_collection|payment_method_|saved_payment_method_options|shipping_)/.test(name))).toEqual([]);
    // One Stripe customer per owner, kept.
    expect((await creditOf(env.DB, ownerId)).stripeCustomerId).toBe("cus_test_1");

    for (const amountCents of [20, 999, 100_001, 10.5]) {
      const refused = await api("/credit/top-ups", { body: { amount_cents: amountCents } });
      expect(refused.answer.error).toMatchObject({ code: "bad_top_up_amount", field: "amount_cents" });
    }
  });

  it("is refused for an account with neither a passkey nor an email, which would leave the credit with no way back in", async () => {
    accountEmail = "dev-1@no-mail.zaisma.com";
    const refused = await api("/credit/top-ups", { body: { amount_cents: 2000 } });
    expect(refused.status).toBe(403);
    expect(refused.answer.error).toMatchObject({ code: "account_not_protected", field: null, fix: expect.stringContaining("/account") });
    expect(stripeCalls).toEqual([]);
    expect(await tool("top_up_credit", { amount_cents: 2000 })).toMatchObject({ code: "account_not_protected" });
    // A passkey, or an email, is enough.
    await addPasskey(env.DB, { id: "pk-1", account_id: "dev-1", public_key: "key", algorithm_number: -7, sign_count: 0, name: "Phone" }, 0);
    expect((await api("/credit/top-ups", { body: { amount_cents: 2000 } })).status).toBe(201);
  });

  it("adds credit once when Stripe says it's paid, even when the event comes twice, and reads its card once, for bans", async () => {
    expect((await stripeEvent(checkoutCompleted("pi_test_1", 2000))).status).toBe(200);
    expect((await stripeEvent(checkoutCompleted("pi_test_1", 2000))).status).toBe(200);
    const { credit } = await tool("get_credit", {});
    expect(credit.balance_cents).toBe(2000);
    expect(credit.top_ups).toEqual([{ id: expect.stringMatching(/^top_up_/), amount_cents: 2000, refundable_cents: 2000, refund_ends_at: expect.any(String), created_at: expect.any(String) }]);
    expect(Date.parse(credit.top_ups[0].refund_ends_at) - Date.parse(credit.top_ups[0].created_at)).toBe(30 * DAY_MS);
    expect(credit).not.toHaveProperty("automatic_top_up");
    // Only its card's fingerprint (bans.ts), once: nothing is saved at Stripe.
    expect(stripeCalls.filter((call) => call.path.startsWith("/v1/payment_intents")).map((call) => call.path)).toEqual(["/v1/payment_intents/pi_test_1"]);
    expect((await api("/access")).answer.credit_balance_cents).toBe(2000);
  });

  it("refuses an event with a bad signature, an old one, or none", async () => {
    expect((await stripeEvent(checkoutCompleted("pi_test_2", 2000), "whsec_not_ours")).status).toBe(400);
    expect((await stripeEvent(checkoutCompleted("pi_test_2", 2000), EVENTS_SECRET, Date.now() - 10 * 60_000)).status).toBe(400);
    expect((await SELF.fetch(`${SITE}/stripe/events`, { method: "POST", body: JSON.stringify(checkoutCompleted("pi_test_2", 2000)) })).status).toBe(400);
    expect((await creditOf(env.DB, ownerId)).balanceCents).toBe(0);
  });
});

describe("a refund", () => {
  it("gives back the unspent part of a top-up, newest first, and nothing past 30 days", async () => {
    const older = (await addCreditEntry(env.DB, { ownerId, entryKind: "top_up", amountCents: 2000, stripeObjectId: "pi_old", refundableUntilMs: Date.now() - DAY_MS, createdAtMs: Date.now() - 31 * DAY_MS }))!;
    const newer = (await addCreditEntry(env.DB, { ownerId, entryKind: "top_up", amountCents: 1000, stripeObjectId: "pi_new", refundableUntilMs: Date.now() + 20 * DAY_MS }))!;
    // $25 spent of $30: credit is spent oldest first, so $5 of the newer top-up is left.
    await addCreditEntry(env.DB, { ownerId, entryKind: "hosting_charge", amountCents: -2500 });

    expect(await tool("refund_top_up", { top_up_id: older })).toMatchObject({ code: "top_up_not_refundable" });
    const refunded = await tool("refund_top_up", { top_up_id: newer });
    expect(refunded.refunded_cents).toBe(500);
    expect(Object.fromEntries(stripeCalls.find((call) => call.path === "/v1/refunds")!.form)).toMatchObject({ payment_intent: "pi_new", amount: "500" });
    expect((await creditOf(env.DB, ownerId)).balanceCents).toBe(0);
    expect(await tool("refund_top_up", { top_up_id: newer })).toMatchObject({ code: "top_up_not_refundable" });
    // Stripe's charge.refunded for it adds nothing more.
    await stripeEvent({ id: "evt_refund", type: "charge.refunded", data: { object: { id: "ch_new", payment_intent: "pi_new", amount_refunded: 500 } } });
    const { credit } = await tool("get_credit", {});
    expect(credit.entries.filter((entry: { entry_kind: string }) => entry.entry_kind === "refund").map((entry: { amount_cents: number }) => entry.amount_cents)).toEqual([-500]);
    expect(await tool("refund_top_up", { top_up_id: "top_up_nobodyhasthis1" })).toMatchObject({ code: "no_top_up" });
  });

  it("counts a refund made on Stripe's dashboard", async () => {
    await stripeEvent(checkoutCompleted("pi_test_3", 3000));
    await stripeEvent({ id: "evt_refund_3", type: "charge.refunded", data: { object: { id: "ch_3", payment_intent: "pi_test_3", amount_refunded: 1000 } } });
    await stripeEvent({ id: "evt_refund_3", type: "charge.refunded", data: { object: { id: "ch_3", payment_intent: "pi_test_3", amount_refunded: 1000 } } });
    expect((await creditOf(env.DB, ownerId)).balanceCents).toBe(2000);
  });
});

describe("budgets", () => {
  it("have no automatic top-up beside them: its call is gone", async () => {
    const gone = await api("/credit/automatic-top-up", { method: "PATCH", body: { is_enabled: true } });
    expect(gone.status).toBe(404);
    expect(gone.answer.error.code).toBe("not_found");
  });

  it("give a game a budget only with the passkey, and take it off or down with a key", async () => {
    await api("/games", { body: { title: "Sky Hopper", slug: "sky-hopper" } });
    expect(await tool("update_game", { slug: "sky-hopper", monthly_budget_cents: 50 })).toMatchObject({ code: "bad_monthly_budget_cents", field: "monthly_budget_cents" });
    expect(await tool("update_game", { slug: "sky-hopper", monthly_budget_cents: 5000 })).toMatchObject({ code: "confirmation_needed" });
    await env.DB.prepare("UPDATE games SET monthly_budget_cents = 5000 WHERE slug = 'sky-hopper'").run();
    expect((await tool("update_game", { slug: "sky-hopper", monthly_budget_cents: 2000 })).game.monthly_budget_cents).toBe(2000);
    expect((await tool("update_game", { slug: "sky-hopper", monthly_budget_cents: 3000 })).code).toBe("confirmation_needed");
    expect((await tool("update_game", { slug: "sky-hopper", monthly_budget_cents: null })).game.monthly_budget_cents).toBeNull();
  });

  it("keep a raise as a spending request the AI can check, one a game, and never for a lowering", async () => {
    await api("/games", { body: { title: "Sky Hopper", slug: "sky-hopper" } });
    const first = await tool("update_game", { slug: "sky-hopper", monthly_budget_cents: 4000 });
    expect(first).toMatchObject({ code: "confirmation_needed", spending_request_id: expect.stringMatching(/^spending_request_/) });
    expect(first.confirm_url).toBe(`${SITE}/dashboard/settings?spending_request=${first.spending_request_id}`);
    const waiting = await tool("get_spending_request", { spending_request_id: first.spending_request_id });
    expect(waiting.spending_request).toMatchObject({ request_kind: "game_budget", game_slug: "sky-hopper", request_status: "waiting", requested_change: { monthly_budget_cents: 4000 } });
    const second = await tool("update_game", { slug: "sky-hopper", monthly_budget_cents: 6000 });
    expect((await tool("get_spending_request", { spending_request_id: first.spending_request_id })).code).toBe("no_spending_request");
    expect((await tool("get_spending_request", { spending_request_id: second.spending_request_id })).spending_request.requested_change.monthly_budget_cents).toBe(6000);
    // A lowering makes no request.
    await env.DB.prepare("UPDATE games SET monthly_budget_cents = 5000 WHERE slug = 'sky-hopper'").run();
    const before = (await env.DB.prepare("SELECT COUNT(*) AS request_count FROM spending_requests").first<{ request_count: number }>())!.request_count;
    expect((await tool("update_game", { slug: "sky-hopper", monthly_budget_cents: 2000 })).game.monthly_budget_cents).toBe(2000);
    expect((await env.DB.prepare("SELECT COUNT(*) AS request_count FROM spending_requests").first<{ request_count: number }>())!.request_count).toBe(before);
  });

  it("keep a budget raise as a request, approve it with a confirmed caller, and hold at most 20 waiting", async () => {
    await api("/games", { body: { title: "Sky Hopper", slug: "sky-hopper" } });
    const asked = await tool("update_game", { slug: "sky-hopper", monthly_budget_cents: 4000 });
    expect(asked).toMatchObject({ code: "confirmation_needed", spending_request_id: expect.stringMatching(/^spending_request_/) });
    const waiting = (await tool("get_spending_request", { spending_request_id: asked.spending_request_id })).spending_request;
    expect(waiting).toMatchObject({ request_kind: "game_budget", requested_change: { monthly_budget_cents: 4000 }, current_setting: { monthly_budget_cents: null } });
    expect(Object.keys(waiting.requested_change)).toEqual(["monthly_budget_cents"]);
    const caller = (await callerFor(env, new Request(SITE), "dev-1"))!;
    // An unconfirmed caller can't approve; a confirmed one makes the same change the confirmed call would.
    await expect(answerSpendingRequest(env, caller, asked.spending_request_id, "approved")).rejects.toMatchObject({ code: "confirmation_needed" });
    expect(await answerSpendingRequest(env, { ...caller, isSpendingConfirmed: true }, asked.spending_request_id, "approved")).toBe("answered");
    expect((await env.DB.prepare("SELECT monthly_budget_cents FROM games WHERE slug = 'sky-hopper'").first<{ monthly_budget_cents: number }>())!.monthly_budget_cents).toBe(4000);
    expect((await tool("get_spending_request", { spending_request_id: asked.spending_request_id })).spending_request.request_status).toBe("approved");
    // Another account's request can't be answered, and the 21st waiting one replaces the oldest.
    expect(await answerSpendingRequest(env, { ...caller, accountId: "someone-else", isSpendingConfirmed: true }, asked.spending_request_id, "declined")).toBe("not_waiting");
    const ids: string[] = [];
    for (let gameNumber = 0; gameNumber < 21; gameNumber++) ids.push(await askForSpending(env, "dev-1", { requestKind: "game_budget", gameId: `game_fake_${gameNumber}`, monthlyBudgetCents: 1000 }));
    expect((await env.DB.prepare("SELECT COUNT(*) AS waiting_count FROM spending_requests WHERE request_status = 'waiting'").first<{ waiting_count: number }>())!.waiting_count).toBe(20);
    expect(await env.DB.prepare("SELECT id FROM spending_requests WHERE id = ?").bind(ids[0]).first()).toBeNull();
  });

  it("say what last month's use past the free allowance would have cost, 0 inside it", async () => {
    await api("/games", { body: { title: "Sky Hopper", slug: "sky-hopper" } });
    await api("/games", { body: { title: "Quiet Game", slug: "quiet-game" } });
    const lastMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
    await env.DB.prepare("INSERT INTO game_hosting_months (game_id, month_start_date, used_cents) SELECT id, ?, 1440 FROM games WHERE slug = 'sky-hopper'").bind(lastMonth).run();
    await env.DB.prepare("INSERT INTO game_hosting_months (game_id, month_start_date, used_cents) SELECT id, ?, 600 FROM games WHERE slug = 'quiet-game'").bind(lastMonth).run();
    const { games } = (await tool("get_credit", {})).credit;
    expect(games).toEqual([expect.objectContaining({ slug: "sky-hopper", last_month_beyond_free_cents: 440 })]);
  });

  it("are out of reach of a key without credit_access", async () => {
    const readKey = (await createApiKey(env.DB, "dev-1", "ci", { accessLevel: "custom", areaAccess: { game_access: "write", version_access: "publish", stats_access: "read", database_access: "read", save_access: "none", purchase_access: "none", forum_access: "none", sign_in_app_access: "none", webhook_access: "none", credit_access: "none", stripe_account_access: "none" }, gameSlugs: null })).token;
    expect((await api("/credit", { key: readKey })).answer.error.code).toBe("key_not_allowed");
    expect((await api("/credit/top-ups", { key: readKey, body: { amount_cents: 2000 } })).answer.error.code).toBe("key_not_allowed");
    expect((await api("/access", { key: readKey })).answer.credit_balance_cents).toBeNull();
    expect(stripeCalls).toEqual([]);
  });
});

describe("credit that's low or left behind", () => {
  it("says whether it's low on GET /credit and get_credit: under 20% of the balance right after the last top-up", async () => {
    expect((await stripeEvent(checkoutCompleted("pi_low", 2000))).status).toBe(200);
    expect((await api("/credit")).answer.credit.is_credit_low).toBe(false);
    // $16.50 spent: $3.50 left, under the $4 line.
    await addCreditEntry(env.DB, { ownerId, entryKind: "hosting_charge", amountCents: -1650 });
    expect((await api("/credit")).answer.credit.is_credit_low).toBe(true);
    expect((await tool("get_credit", {})).credit.is_credit_low).toBe(true);
  });

  it("refunds a top-up on its 29th day and not on its 31st", async () => {
    expect((await stripeEvent(checkoutCompleted("pi_month", 2000))).status).toBe(200);
    const refundableOn = async (dayCount: number) => (await refundableTopUps(env.DB, ownerId, Date.now() + dayCount * DAY_MS))[0]!.refundableCents;
    expect(await refundableOn(29)).toBe(2000);
    expect(await refundableOn(31)).toBe(0);
  });

  it("refunds a deleted account's credit only inside its 30 days, and names the older credit first", async () => {
    await addCreditEntry(env.DB, { ownerId, entryKind: "top_up", amountCents: 1000, stripeObjectId: "pi_forty", refundableUntilMs: Date.now() - 10 * DAY_MS, createdAtMs: Date.now() - 40 * DAY_MS });
    await addCreditEntry(env.DB, { ownerId, entryKind: "top_up", amountCents: 2500, stripeObjectId: "pi_ten", refundableUntilMs: Date.now() + 20 * DAY_MS, createdAtMs: Date.now() - 10 * DAY_MS });
    // $5 spent of $35: oldest first, so $5 of the 40-day top-up is left, past its 30 days.
    await addCreditEntry(env.DB, { ownerId, entryKind: "hosting_charge", amountCents: -500 });
    expect(await creditKeptOnDeletionCents(env, "dev-1")).toBe(500);
    await refundForDeletion(env, "dev-1");
    expect(stripeCalls.filter((call) => call.path === "/v1/refunds").map((call) => [call.form.get("payment_intent"), call.form.get("amount")])).toEqual([["pi_ten", "2500"]]);
  });

  it("still gets a deleted account's unspent credit back when Stripe is down as it's deleted, once Stripe is back", async () => {
    expect((await stripeEvent(checkoutCompleted("pi_deleted", 2000))).status).toBe(200);
    const deletedAtMs = Date.now();
    isStripeDown = true;
    await refundForDeletion(env, "dev-1", deletedAtMs);
    const firstKey = stripeCalls.find((call) => call.path === "/v1/refunds")!.idempotencyKey;
    await deleteAccount(env.DB, "dev-1");
    const pending = async () => (await env.DB.prepare("SELECT * FROM pending_refunds").all<Record<string, unknown>>()).results;
    // Only the payment and the amount: nothing about the account that's gone.
    expect(await pending()).toEqual([{ id: expect.stringMatching(/^pending_refund_/), stripe_payment_intent_id: "pi_deleted", amount_cents: 2000, created_at_ms: deletedAtMs, last_tried_at_ms: null, try_count: 0 }]);

    isStripeDown = false;
    stripeCalls = [];
    await retryPendingRefunds(env, deletedAtMs + 60_000);
    expect(stripeCalls).toEqual([]);
    await retryPendingRefunds(env, deletedAtMs + 6 * 60_000);
    expect(stripeCalls.map((call) => [call.path, call.form.get("payment_intent"), call.form.get("amount")])).toEqual([["/v1/refunds", "pi_deleted", "2000"]]);
    // The same key as the first try, so a refund Stripe made without answering is never made twice.
    expect(stripeCalls[0]!.idempotencyKey).toBe(firstKey);
    expect(await pending()).toEqual([]);
  });
});
