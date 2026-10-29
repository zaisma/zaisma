import { env, SELF } from "cloudflare:test";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAccount, createApiKey, limitsFor, personOwner, planFor, sha256Hex } from "@zaisma/core";
import { TOOLS } from "../../apps/site/src/mcp.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";
import { letPublish } from "../helpers.ts";

// Zaisma Pro through the developer API and MCP (apps/site/src/pro-api.ts) and Stripe's subscription events
// (apps/site/src/stripe-events.ts), against a stand-in for Stripe's API: Zaisma's own Stripe account is never reached.

const SITE = "https://zaisma.test";
const EVENTS_SECRET = "whsec_test_zaisma";
const DAY_MS = 86_400_000;
let token = "";
let ownerId = "";
let nextId = 1;
const realFetch = globalThis.fetch;
let stripeCalls: { method: string; path: string; form: URLSearchParams; idempotencyKey: string | null }[] = [];
/** The customer's paid invoices, as the stand-in answers them. */
let paidInvoices: Record<string, unknown>[] = [];

beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "api.stripe.com") return realFetch(input, init);
    stripeCalls.push({ method: init?.method ?? "GET", path: url.pathname, form: new URLSearchParams(typeof init?.body === "string" ? init.body : url.search), idempotencyKey: new Headers(init?.headers).get("idempotency-key") });
    if (url.pathname === "/v1/invoices") return Response.json({ data: paidInvoices });
    if (url.pathname === "/v1/refunds") return Response.json({ id: "re_test_1" });
    if (url.pathname === "/v1/customers") return Response.json({ id: "cus_test_1" });
    if (url.pathname === "/v1/checkout/sessions") return Response.json({ id: "cs_test_pro", url: "https://checkout.stripe.com/c/pay/cs_test_pro", expires_at: 1_900_000_000 });
    if (url.pathname.startsWith("/v1/subscriptions/")) return Response.json({ id: url.pathname.split("/").at(-1) });
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

async function tool(name: string, toolArguments: Record<string, unknown> = {}): Promise<any> {
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

async function stripeEvent(event: unknown, secret = EVENTS_SECRET): Promise<Response> {
  const body = JSON.stringify(event);
  const signedAtSec = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${signedAtSec}.${body}`)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return SELF.fetch(`${SITE}/stripe/events`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": `t=${signedAtSec},v1=${signature}` }, body });
}

const subscription = (type: string, fields: Record<string, unknown> = {}) => ({
  id: `evt_${type}_${JSON.stringify(fields).length}`,
  type,
  data: { object: { id: "sub_test_1", status: "active", customer: "cus_test_1", metadata: { owner_id: ownerId }, cancel_at_period_end: false, current_period_end: Math.floor((Date.now() + 30 * DAY_MS) / 1000), ...fields } },
});

/** An event Stripe made at a given second, as its created field says. */
const madeAt = (event: ReturnType<typeof subscription>, createdSec: number) => ({ ...event, created: createdSec });

const proRow = () => env.DB.prepare("SELECT pro_until_ms, is_pro_cancelled, stripe_subscription_id FROM owners WHERE id = ?").bind(ownerId).first<{ pro_until_ms: number | null; is_pro_cancelled: number; stripe_subscription_id: string | null }>();

beforeEach(async () => {
  await env.DB.exec("DELETE FROM security_events; DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;");
  stripeCalls = [];
  paidInvoices = [];
  await createAccount(env.DB, { id: "dev-1", username: "Pixel_Smith", ageBand: "18+" });
  await letPublish(env.DB, "dev-1");
  token = (await createApiKey(env.DB, "dev-1", "claude")).token;
  ownerId = (await personOwner(env.DB, "dev-1")).id;
});

describe("Zaisma Pro", () => {
  it("starts free, and start_pro answers Stripe's page for the monthly price", async () => {
    const read = await tool("get_pro");
    expect(read.pro).toMatchObject({ plan: "free", pro_ends_at: null, is_pro_cancelled: false, monthly_price_cents: 1000 });
    expect(read.pro.limits.free).toEqual({ maximum_large_review_count: 5, maximum_small_review_count: 30, maximum_performance_check_count: 20, maximum_version_count: 20, maximum_game_size_bytes: 2 * 1024 ** 3 });
    expect(read.pro.limits.pro).toMatchObject({ maximum_large_review_count: 20, maximum_small_review_count: 100, maximum_performance_check_count: 60, maximum_version_count: 100, maximum_game_size_bytes: 10 * 1024 ** 3 });
    expect(read.pro.used_today).toEqual({ large_review_count: 0, small_review_count: 0, performance_check_count: 0 });
    expect((await tool("get_access")).plan).toBe("free");

    const started = await tool("start_pro");
    expect(started).toMatchObject({ checkout_url: "https://checkout.stripe.com/c/pay/cs_test_pro", next_steps: [expect.objectContaining({ tool: "get_pro" })] });
    const session = Object.fromEntries(stripeCalls.find((call) => call.path === "/v1/checkout/sessions")!.form);
    expect(session).toMatchObject({ mode: "subscription", customer: "cus_test_1", "line_items[0][price]": "price_test_pro", "line_items[0][quantity]": "1", "subscription_data[metadata][owner_id]": ownerId, "managed_payments[enabled]": "true" });
    // Nothing Managed Payments refuses (Stripe answers "You cannot use custom_text with Managed Payments").
    expect(Object.keys(session).filter((name) => /^(custom_text|automatic_tax|tax_id_collection|payment_method_|saved_payment_method_options|shipping_)/.test(name))).toEqual([]);
    expect((await env.DB.prepare("SELECT kind FROM security_events WHERE kind = 'pro_checkout_started'").first())).not.toBeNull();
  });

  it("starts when Stripe says it was paid, and once however many times the event comes", async () => {
    expect((await stripeEvent(subscription("customer.subscription.created"))).status).toBe(200);
    expect((await stripeEvent(subscription("customer.subscription.created"))).status).toBe(200);
    const row = (await proRow())!;
    expect(row).toMatchObject({ is_pro_cancelled: 0, stripe_subscription_id: "sub_test_1" });
    expect(row.pro_until_ms!).toBeGreaterThan(Date.now() + 29 * DAY_MS);
    expect(await planFor(env.DB, ownerId)).toBe("pro");
    expect((await tool("get_pro")).pro).toMatchObject({ plan: "pro", is_pro_cancelled: false, pro_ends_at: expect.any(String) });
    expect((await tool("get_access")).plan).toBe("pro");
    expect((await tool("start_pro")).code).toBe("already_pro");
    expect((await limitsFor(env.DB, ownerId)).maximumVersionsPerDay).toBe(100);
  });

  it("refuses an event that Stripe didn't sign, and one about nobody", async () => {
    expect((await stripeEvent(subscription("customer.subscription.created"), "whsec_not_ours")).status).toBe(400);
    expect((await stripeEvent(subscription("customer.subscription.created", { metadata: {}, customer: "cus_nobody" }))).status).toBe(200);
    expect((await proRow())!.pro_until_ms).toBeNull();
  });

  it("cancels at the end of the paid month, takes that back, and ends when Stripe says so", async () => {
    await stripeEvent(subscription("customer.subscription.created"));
    const cancelled = await tool("cancel_pro");
    expect(cancelled.pro).toMatchObject({ plan: "pro", is_pro_cancelled: true });
    expect(Object.fromEntries(stripeCalls.find((call) => call.path === "/v1/subscriptions/sub_test_1")!.form)).toEqual({ cancel_at_period_end: "true" });
    expect((await tool("cancel_pro")).code).toBe("not_pro");
    expect((await tool("start_pro")).code).toBe("already_pro");

    const resumed = await tool("resume_pro");
    expect(resumed.pro).toMatchObject({ plan: "pro", is_pro_cancelled: false });
    expect(Object.fromEntries(stripeCalls.filter((call) => call.path === "/v1/subscriptions/sub_test_1").at(-1)!.form)).toEqual({ cancel_at_period_end: "false" });
    expect((await tool("resume_pro")).code).toBe("not_pro");

    // Stripe's update about the cancelling is the same as what was set.
    await stripeEvent(subscription("customer.subscription.updated", { cancel_at_period_end: true }));
    expect((await proRow())!.is_pro_cancelled).toBe(1);

    expect((await stripeEvent(subscription("customer.subscription.deleted"))).status).toBe(200);
    expect((await stripeEvent(subscription("customer.subscription.deleted"))).status).toBe(200);
    expect(await planFor(env.DB, ownerId)).toBe("free");
    expect(await proRow()).toMatchObject({ is_pro_cancelled: 0, stripe_subscription_id: null });
    expect((await tool("get_pro")).pro).toMatchObject({ plan: "free", pro_ends_at: null });
    expect((await tool("cancel_pro")).code).toBe("not_pro");
    expect((await tool("resume_pro")).code).toBe("not_pro");
  });

  it("keeps Pro while Stripe retries a renewal, and ends it when the subscription is canceled", async () => {
    await stripeEvent(subscription("customer.subscription.created"));
    await stripeEvent(subscription("customer.subscription.updated", { status: "past_due" }));
    expect(await planFor(env.DB, ownerId)).toBe("pro");
    await stripeEvent(subscription("customer.subscription.updated", { status: "canceled" }));
    expect(await planFor(env.DB, ownerId)).toBe("free");
  });

  it("ignores a Stripe event that arrives after a newer one", async () => {
    const at = (offsetSec: number) => Math.floor(Date.now() / 1000) + offsetSec;
    await stripeEvent(madeAt(subscription("customer.subscription.created"), at(0)));
    // A renewal, then an older update that comes late: the renewal's period stays.
    const renewedEndSec = Math.floor((Date.now() + 60 * DAY_MS) / 1000);
    await stripeEvent(madeAt(subscription("customer.subscription.updated", { current_period_end: renewedEndSec }), at(20)));
    await stripeEvent(madeAt(subscription("customer.subscription.updated", { cancel_at_period_end: true }), at(10)));
    expect(await proRow()).toMatchObject({ pro_until_ms: renewedEndSec * 1000, is_pro_cancelled: 0 });
    // The subscription ends, then an older update comes late: it stays ended.
    await stripeEvent(madeAt(subscription("customer.subscription.deleted"), at(30)));
    await stripeEvent(madeAt(subscription("customer.subscription.updated"), at(25)));
    expect(await planFor(env.DB, ownerId)).toBe("free");
    expect((await proRow())!.stripe_subscription_id).toBeNull();
  });

  it("keeps the first subscription when a second is paid beside it, and refuses a second start while Stripe holds one", async () => {
    await stripeEvent(subscription("customer.subscription.created"));
    const first = (await proRow())!.pro_until_ms;
    await stripeEvent(subscription("customer.subscription.created", { id: "sub_test_2", current_period_end: Math.floor((Date.now() + 90 * DAY_MS) / 1000) }));
    expect(await proRow()).toMatchObject({ pro_until_ms: first, stripe_subscription_id: "sub_test_1" });
    // A renewal Stripe is retrying after the paid month passed: plan free, subscription still there.
    await env.DB.prepare("UPDATE owners SET pro_until_ms = ? WHERE id = ?").bind(Date.now() - 1000, ownerId).run();
    expect(await planFor(env.DB, ownerId)).toBe("free");
    expect((await tool("start_pro")).code).toBe("already_pro");
  });

  it("reads the period's end from the subscription's item, as newer Stripe versions send it", async () => {
    const endSec = Math.floor((Date.now() + 10 * DAY_MS) / 1000);
    await stripeEvent(subscription("customer.subscription.created", { current_period_end: undefined, items: { data: [{ current_period_end: endSec }] } }));
    expect((await proRow())!.pro_until_ms).toBe(endSec * 1000);
  });

  it("is out of reach of a key without credit_access write", async () => {
    const area = (credit: string) => ({ game_access: "write", version_access: "publish", stats_access: "read", database_access: "read", save_access: "none", purchase_access: "none", forum_access: "none", sign_in_app_access: "none", webhook_access: "none", credit_access: credit });
    const readKey = (await createApiKey(env.DB, "dev-1", "reader", { accessLevel: "custom", areaAccess: area("read") as never, gameSlugs: null })).token;
    const noKey = (await createApiKey(env.DB, "dev-1", "none", { accessLevel: "custom", areaAccess: area("none") as never, gameSlugs: null })).token;
    expect((await api("/pro", { key: readKey })).status).toBe(200);
    expect((await api("/pro/checkout", { key: readKey, body: {} })).answer.error.code).toBe("key_not_allowed");
    expect((await api("/pro/cancel", { key: readKey, body: {} })).answer.error.code).toBe("key_not_allowed");
    expect((await api("/pro/refund", { key: readKey, body: {} })).answer.error.code).toBe("key_not_allowed");
    expect((await api("/pro", { key: noKey })).answer.error.code).toBe("key_not_allowed");
    expect(stripeCalls).toEqual([]);
  });
});

describe("Pro's refund", () => {
  /** A paid invoice of a subscription, paid some days ago. */
  const invoice = (id: string, paidDaysAgo: number, subscriptionId = "sub_test_1") => ({
    id,
    amount_paid: 1000,
    status_transitions: { paid_at: Math.floor((Date.now() - paidDaysAgo * DAY_MS) / 1000) },
    parent: { type: "subscription_details", subscription_details: { subscription: subscriptionId } },
    payments: { data: [{ status: "paid", payment: { type: "payment_intent", payment_intent: `pi_${id}` } }] },
  });

  beforeEach(async () => {
    await env.DB.prepare("UPDATE owners SET stripe_customer_id = 'cus_test_1' WHERE id = ?").bind(ownerId).run();
    await stripeEvent(madeAt(subscription("customer.subscription.created"), Math.floor((Date.now() - 3 * DAY_MS) / 1000)));
    stripeCalls = [];
  });

  it("refunds the only payment within 14 days in full, and ends Pro at once", async () => {
    paidInvoices = [invoice("in_first", 3)];
    const read = await tool("get_pro");
    expect(Date.parse(read.pro.refund_ends_at)).toBe((paidInvoices[0] as any).status_transitions.paid_at * 1000 + 14 * DAY_MS);
    const refunded = await tool("refund_pro");
    expect(refunded).toEqual({ refunded_cents: 1000, next_steps: [expect.objectContaining({ tool: "get_pro" })] });
    const refund = stripeCalls.find((call) => call.path === "/v1/refunds")!;
    expect(refund.form.get("payment_intent")).toBe("pi_in_first");
    expect(refund.form.get("amount")).toBeNull();
    expect(refund.idempotencyKey).toBe("pro-refund:in_first");
    expect(stripeCalls.find((call) => call.path === "/v1/subscriptions/sub_test_1")!.method).toBe("DELETE");
    expect((await tool("get_pro")).pro).toMatchObject({ plan: "free", refund_ends_at: null });
    expect((await proRow())!.stripe_subscription_id).toBeNull();
    // Stripe's events for it change nothing: the ended subscription's, and an older one arriving late.
    await stripeEvent(subscription("customer.subscription.deleted", { status: "canceled" }));
    await stripeEvent(madeAt(subscription("customer.subscription.updated", { cancel_at_period_end: false }), Math.floor((Date.now() - DAY_MS) / 1000)));
    expect((await tool("get_pro")).pro.plan).toBe("free");
  });

  it("refuses past 14 days, a second payment, and no Pro, without refunding", async () => {
    paidInvoices = [invoice("in_old", 15)];
    expect((await tool("get_pro")).pro.refund_ends_at).toBeNull();
    expect((await tool("refund_pro")).code).toBe("pro_not_refundable");
    // A refunded subscription's invoice stays paid, so starting Pro again after a refund doesn't refund again.
    paidInvoices = [invoice("in_again", 2), invoice("in_before", 20, "sub_test_0")];
    expect((await tool("get_pro")).pro.refund_ends_at).toBeNull();
    expect((await tool("refund_pro")).code).toBe("pro_not_refundable");
    expect(stripeCalls.filter((call) => call.path !== "/v1/invoices")).toEqual([]);
    await env.DB.prepare("UPDATE owners SET pro_until_ms = NULL, stripe_subscription_id = NULL WHERE id = ?").bind(ownerId).run();
    expect((await api("/pro/refund", { body: {} })).answer.error.code).toBe("pro_not_refundable");
  });

  it("doesn't ask Stripe once Pro's paid period ends within 14 days, nor when Stripe is down", async () => {
    await env.DB.prepare("UPDATE owners SET pro_until_ms = ? WHERE id = ?").bind(Date.now() + 10 * DAY_MS, ownerId).run();
    expect((await tool("get_pro")).pro.refund_ends_at).toBeNull();
    expect(stripeCalls).toEqual([]);
    await env.DB.prepare("UPDATE owners SET pro_until_ms = ? WHERE id = ?").bind(Date.now() + 27 * DAY_MS, ownerId).run();
    paidInvoices = [invoice("in_first", 3)];
    const realStripe = globalThis.fetch;
    globalThis.fetch = (async () => Response.json({ error: { message: "Stripe is down." } }, { status: 500 })) as typeof fetch;
    try {
      expect((await tool("get_pro")).pro).toMatchObject({ plan: "pro", refund_ends_at: null });
    } finally {
      globalThis.fetch = realStripe;
    }
  });
});

describe("what Pro raises", () => {
  const makePro = () => env.DB.prepare("UPDATE owners SET pro_until_ms = ? WHERE id = ?").bind(Date.now() + 5 * DAY_MS, ownerId).run();
  const enc = (text: string) => new TextEncoder().encode(text);

  async function pushOne(): Promise<Response> {
    const bytes = enc("<!doctype html><canvas></canvas>");
    const sha256 = await sha256Hex(bytes);
    await SELF.fetch(`${SITE}/api/dev/files/${sha256}`, { method: "PUT", headers: { authorization: `Bearer ${token}` }, body: bytes });
    return SELF.fetch(`${SITE}/api/dev/games/hop/versions`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ files: [{ path: "index.html", sha256, size_bytes: bytes.byteLength }] }),
    });
  }

  async function fillVersions(count: number, prefix = "fill") {
    const gameId = (await env.DB.prepare("SELECT id FROM games WHERE slug = 'hop'").first<{ id: string }>())!.id;
    for (let index = 0; index < count; index++) {
      await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES (?, ?, 'none', 0, 0, 'rejected', ?)").bind(`version_${prefix}${index}`, gameId, Date.now() - 1000).run();
    }
  }

  beforeEach(async () => {
    expect((await api("/games", { body: { title: "Hop", slug: "hop" } })).status).toBe(201);
  });

  it("lets a game have 100 versions a day instead of 20, naming Pro on the free plan", async () => {
    await fillVersions(20);
    const refused = await pushOne();
    expect(refused.status).toBe(429);
    expect(((await refused.json()) as any).error.message).toContain("20 versions in the last day, the most a game can (100 with Zaisma Pro).");
    await makePro();
    expect((await pushOne()).status).toBe(201);
    await fillVersions(79, "more");
    const overHundred = await pushOne();
    expect(overHundred.status).toBe(429);
    expect(((await overHundred.json()) as any).error.message).toContain("100 versions in the last day, the most a game can.");
  });

  it("lets a game be 10 GB instead of 2, naming Pro on the free plan", async () => {
    const hash = "b".repeat(64);
    const files = (count: number) => [{ path: "index.html", sha256: hash, size_bytes: 1 }, ...Array.from({ length: count }, (_, i) => ({ path: `data${i}.json`, sha256: hash, size_bytes: 450 * 1024 ** 2 }))];
    const free = await api("/games/hop/uploads", { body: { files: files(7) } });
    expect(free.status).toBe(413);
    expect(free.answer.error).toMatchObject({ code: "game_too_big", message: expect.stringContaining("2 GB (10 GB with Zaisma Pro)") });
    await makePro();
    expect((await api("/games/hop/uploads", { body: { files: files(7) } })).status).toBe(200);
    expect((await api("/games/hop/uploads", { body: { files: files(25) } })).answer.error.code).toBe("game_too_big");
  });
});
