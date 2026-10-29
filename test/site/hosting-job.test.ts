import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOSTING_PRICES, addCreditEntry, createAccount, createGame, creditOf, gameHostingMonth, personOwner, type Game } from "@zaisma/core";
import { addTopUp, runHostingJob } from "../../apps/site/src/hosting-job.ts";
import { apiCall, callerFor } from "../../apps/site/src/developer.ts";
import { handleStripeEvents } from "../../apps/site/src/stripe-events.ts";

// The site's 5-minute hosting job (apps/site/src/hosting-job.ts): the one judge of every game's month on the meter.
// It charges what's past the free allowance to games with a budget, pauses at the allowance, the budget or an empty
// balance, writes off what's past them, never charges a card, and tells the developer once by email.

const testEnv = { ...env, EMAIL_OUTBOX_URL: "https://outbox.test" } as typeof env;
const HOUR_SEC = 3600;
let emails: { to: string; subject: string; text: string }[] = [];
let stripeCalls: { path: string; form: URLSearchParams; idempotencyKey: string | null }[] = [];
let ownerId = "";
let game: Game;

beforeEach(async () => {
  await env.DB.exec("DELETE FROM credit_entries; DELETE FROM game_hosting_months; DELETE FROM alert_notices; DELETE FROM room_usage; DELETE FROM security_events; DELETE FROM audit_log; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;");
  emails = [];
  stripeCalls = [];
  await createAccount(env.DB, { id: "dev-1", username: "Emma_Builds", ageBand: "18+" });
  ownerId = (await personOwner(env.DB, "dev-1")).id;
  game = await createGame(env.DB, { slug: "arena", title: "Arena", description: "", ownerId, visibility: "listed" });
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === "https://outbox.test") {
      const sent = JSON.parse(String(init?.body)) as { to: string; subject: string; text: string };
      emails.push({ to: sent.to, subject: sent.subject, text: sent.text });
      return new Response("ok");
    }
    if (url.origin === "https://supabase.test" && url.pathname.startsWith("/auth/v1/admin/users/")) return Response.json({ id: "dev-1", email: "emma@example.com" });
    if (url.hostname === "api.stripe.com") {
      // The job never charges a card: any call to Stripe is counted, and the tests expect none.
      stripeCalls.push({ path: url.pathname, form: new URLSearchParams(String(init?.body ?? "")), idempotencyKey: new Headers(init?.headers).get("idempotency-key") });
      return Response.json({ error: { message: "The hosting job has no call to Stripe." } }, { status: 400 });
    }
    return realFetch(input, init);
  });
});
afterEach(() => vi.unstubAllGlobals());

/** Rooms awake for this many cents of use (the free allowance is 1,000), as one day's row. */
const awakeSecFor = (cents: number) => Math.round(cents / HOSTING_PRICES.awakeCentsPerSec);
const setUseCents = (cents: number) =>
  env.DB.prepare("INSERT INTO room_usage (game_id, date, room_awake_duration_sec) VALUES (?, ?, ?) ON CONFLICT (game_id, date) DO UPDATE SET room_awake_duration_sec = excluded.room_awake_duration_sec")
    .bind(game.id, new Date().toISOString().slice(0, 10), awakeSecFor(cents))
    .run();
/** One day's use, in cents, on a given date. */
const setDayCents = (date: string, cents: number) =>
  env.DB.prepare("INSERT INTO room_usage (game_id, date, room_awake_duration_sec) VALUES (?, ?, ?) ON CONFLICT (game_id, date) DO UPDATE SET room_awake_duration_sec = excluded.room_awake_duration_sec").bind(game.id, date, awakeSecFor(cents)).run();
const setBudget = (cents: number | null) => env.DB.prepare("UPDATE games SET monthly_budget_cents = ? WHERE id = ?").bind(cents, game.id).run();
const topUp = (cents: number) => addCreditEntry(env.DB, { ownerId, entryKind: "top_up", amountCents: cents, stripeObjectId: `pi_${crypto.randomUUID()}`, refundableUntilMs: Date.now() + 86_400_000 });
const month = () => gameHostingMonth(env.DB, game.id);
const balance = async () => (await creditOf(env.DB, ownerId)).balanceCents;
const notices = async () => (await env.DB.prepare("SELECT alert_kind FROM alert_notices WHERE game_id = ? ORDER BY noticed_at_ms, alert_kind").bind(game.id).all<{ alert_kind: string }>()).results.map((row) => row.alert_kind);
const entries = async (kind: string) => (await env.DB.prepare("SELECT amount_cents FROM credit_entries WHERE owner_id = ? AND entry_kind = ?").bind(ownerId, kind).all<{ amount_cents: number }>()).results.map((row) => row.amount_cents);

describe("a game without a budget", () => {
  it("hears once at 80% of its free hosting, and pauses at all of it", async () => {
    await setUseCents(760);
    await runHostingJob(testEnv);
    expect(await notices()).toEqual([]);

    await setUseCents(840);
    await runHostingJob(testEnv);
    await runHostingJob(testEnv);
    expect(await notices()).toEqual(["hosting_nearly_paused"]);
    expect(emails.map((email) => [email.to, email.subject])).toEqual([["emma@example.com", "Arena has used most of its free hosting"]]);
    expect((await month()).paused_at_ms).toBeNull();

    await setUseCents(1000);
    await runHostingJob(testEnv);
    expect(await month()).toMatchObject({ paused_reason: "free_used", paused_at_ms: expect.any(Number), charged_cents: 0 });
    expect(await notices()).toEqual(["hosting_nearly_paused", "hosting_paused"]);
    expect(emails.at(-1)!.subject).toBe("Arena's hosting is paused");
    // Its first moment stays, so every room ends an hour after it, together.
    const pausedAtMs = (await month()).paused_at_ms;
    await runHostingJob(testEnv, Date.now() + 60_000);
    expect((await month()).paused_at_ms).toBe(pausedAtMs);
    expect(await entries("written_off")).toEqual([]);
  });
});

describe("a game with a budget", () => {
  it("draws from credit past its free hosting, hears at 80% of its budget, and pauses at it with credit left", async () => {
    await topUp(1000);
    await setBudget(500);
    // 1,200 cents: 200 past the free 1,000.
    await setUseCents(1200);
    await runHostingJob(testEnv);
    expect(await balance()).toBe(800);
    expect(await month()).toMatchObject({ charged_cents: 200, paused_at_ms: null });

    await setUseCents(1400);
    await runHostingJob(testEnv);
    expect(await month()).toMatchObject({ charged_cents: 400, paused_at_ms: null });
    expect(await notices()).toEqual(["hosting_budget_nearly_used"]);
    expect(emails.map((email) => email.text)).toEqual([expect.stringContaining("Arena has used $4 of its $5 budget")]);

    // 1,600 cents: 600 past free, 100 past the budget. It stops at the budget, and the rest is Zaisma's.
    await setUseCents(1600);
    await runHostingJob(testEnv);
    expect(await month()).toMatchObject({ charged_cents: 500, written_off_cents: 100, paused_reason: "budget_used" });
    expect(await balance()).toBe(500);
    expect(await entries("hosting_charge")).toEqual([-500]);
    expect(await entries("written_off")).toEqual([100]);
  });

  it("pauses when the balance is used, never takes it below 0, and writes off the rest", async () => {
    await topUp(100);
    await setBudget(5000);
    await setUseCents(1200);
    await runHostingJob(testEnv);
    expect(await balance()).toBe(0);
    expect(await month()).toMatchObject({ charged_cents: 100, written_off_cents: 100, paused_reason: "credit_used" });
    expect(emails.map((email) => email.subject)).toEqual(["Your Zaisma credit is used up", "Arena's hosting is paused"]);
    // The finishing hour's use is written off too, never charged later.
    await setUseCents(1220);
    await runHostingJob(testEnv);
    expect(await balance()).toBe(0);
    expect(await month()).toMatchObject({ charged_cents: 100, written_off_cents: 120 });
  });

  it("starts again when credit comes in", async () => {
    await topUp(100);
    await setBudget(5000);
    await setUseCents(1200);
    await runHostingJob(testEnv);
    expect((await month()).paused_reason).toBe("credit_used");
    const event = { id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1", mode: "payment", payment_status: "paid", payment_intent: "pi_paid_1", amount_subtotal: 2000, metadata: { owner_id: ownerId } } } };
    const body = JSON.stringify(event);
    const signedAtSec = Math.floor(Date.now() / 1000);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("whsec_test_zaisma"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${signedAtSec}.${body}`)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    expect((await handleStripeEvents(new Request("https://zaisma.test/stripe/events", { method: "POST", headers: { "stripe-signature": `t=${signedAtSec},v1=${signature}` }, body }), testEnv)).status).toBe(200);
    expect((await month()).paused_at_ms).toBeNull();
    // What was written off stays Zaisma's: the next charge is only what's new.
    await setUseCents(1220);
    await runHostingJob(testEnv);
    expect(await month()).toMatchObject({ charged_cents: 120, written_off_cents: 100, paused_at_ms: null });
    expect(await balance()).toBe(1980);
  });

  it("pauses at once when its budget is lowered below this month's charges, and starts when it's raised", async () => {
    await topUp(2000);
    await setBudget(5000);
    await setUseCents(1300);
    await runHostingJob(testEnv);
    expect((await month()).charged_cents).toBe(300);
    const caller = (await callerFor(testEnv, new Request("https://zaisma.test"), "dev-1"))!;

    await apiCall(testEnv, caller, "PATCH", "/games/arena", { monthly_budget_cents: 200 });
    expect(await month()).toMatchObject({ paused_reason: "budget_used", paused_at_ms: expect.any(Number) });
    await apiCall(testEnv, { ...caller, isSpendingConfirmed: true }, "PATCH", "/games/arena", { monthly_budget_cents: 1000 });
    expect((await month()).paused_at_ms).toBeNull();
  });

  it("charges a month once when two runs of the job judge it at the same moment", async () => {
    await topUp(2000);
    // A $2 budget and 1,200 cents: 200 past the free hosting, so the budget is just used.
    await setBudget(200);
    await setUseCents(1200);
    const nowMs = Date.now();
    await Promise.all([runHostingJob(testEnv, nowMs), runHostingJob(testEnv, nowMs)]);
    expect({ balanceCents: await balance(), charges: await entries("hosting_charge"), monthChargedCents: (await month()).charged_cents }).toEqual({ balanceCents: 1800, charges: [-200], monthChargedCents: 200 });
  });

  it("charges what a month's rooms reported after its last run, on the 1st of the next", async () => {
    await topUp(5000);
    await setBudget(5000);
    const setDay = (date: string, cents: number) =>
      env.DB.prepare("INSERT INTO room_usage (game_id, date, room_awake_duration_sec) VALUES (?, ?, ?) ON CONFLICT (game_id, date) DO UPDATE SET room_awake_duration_sec = excluded.room_awake_duration_sec").bind(game.id, date, awakeSecFor(cents)).run();
    // January's last run: 1,100 cents, 100 past the free 1,000.
    await setDay("2031-01-31", 1100);
    await runHostingJob(testEnv, Date.parse("2031-01-31T23:55:00Z"));
    // A room checks in at 23:58 with its last hour: 200 past free in all. February's use is February's own.
    await setDay("2031-01-31", 1200);
    await setDay("2031-02-01", 4);
    await runHostingJob(testEnv, Date.parse("2031-02-01T00:00:00Z"));
    await runHostingJob(testEnv, Date.parse("2031-02-01T00:05:00Z"));
    await runHostingJob(testEnv, Date.parse("2031-02-02T12:00:00Z"));
    expect((await gameHostingMonth(env.DB, game.id, Date.parse("2031-01-15T00:00:00Z"))).charged_cents).toBe(200);
    expect(-(await entries("hosting_charge")).reduce((total, cents) => total + cents, 0)).toBe(200);
  });
});

describe("credit", () => {
  it("pauses a game with a budget and no balance once its free hosting is used, and charges no card", async () => {
    await env.DB.prepare("UPDATE owners SET stripe_customer_id = 'cus_1' WHERE id = ?").bind(ownerId).run();
    await setBudget(5000);
    await setUseCents(1200);
    await runHostingJob(testEnv);
    expect(await month()).toMatchObject({ charged_cents: 0, paused_reason: "credit_used" });
    expect(stripeCalls).toEqual([]);
  });

  it("lets a game with a budget and a balance go past its free hosting", async () => {
    await topUp(2000);
    await setBudget(5000);
    await setUseCents(1200);
    await runHostingJob(testEnv);
    expect(await month()).toMatchObject({ charged_cents: 200, paused_at_ms: null });
    expect(await balance()).toBe(1800);
    expect(stripeCalls).toEqual([]);
  });
});

// The promises the Oct 23 hunt found broken, each on a set clock.
describe("the meter keeps its promises", () => {
  const START_MS = Date.parse("2031-03-10T12:00:00Z");
  const subjects = () => emails.map((email) => email.subject);
  const caller = async () => (await callerFor(testEnv, new Request("https://zaisma.test"), "dev-1"))!;
  /** A top-up as Stripe's event adds it, which sets the credit-low line. */
  const paidTopUp = (cents: number) => addTopUp(testEnv, { ownerId, amountCents: cents, paymentIntentId: `pi_${crypto.randomUUID()}` });
  const later = (minutes: number) => vi.setSystemTime(START_MS + minutes * 60_000);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(START_MS);
  });
  afterEach(() => vi.useRealTimers());

  it("charges a game's use once when the month's record fails after the charge, and the next run tries again", async () => {
    await topUp(2000);
    await setBudget(5000);
    await setUseCents(1200);
    const failingDatabase = new Proxy(env.DB, {
      get(target, property) {
        if (property === "prepare") {
          return (sql: string) => {
            if (sql.startsWith("INSERT INTO game_hosting_months (game_id, month_start_date, used_cents")) throw new Error("D1 is busy");
            return target.prepare(sql);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await runHostingJob({ ...testEnv, DB: failingDatabase } as typeof env);
    later(5);
    await runHostingJob(testEnv);
    expect({ balanceCents: await balance(), charges: await entries("hosting_charge"), monthChargedCents: (await month()).charged_cents }).toEqual({ balanceCents: 1800, charges: [-200], monthChargedCents: 200 });
  });

  it("pauses a game without a budget within 5 minutes of crossing its free hosting, even when the crossing lands in the day's last flush", async () => {
    vi.setSystemTime(Date.parse("2031-03-10T00:03:00Z"));
    await setDayCents("2031-03-09", 1000);
    await runHostingJob(testEnv);
    expect((await month()).paused_reason).toBe("free_used");
  });

  it("gives a game without a budget its heads-up before the pause, even when one run takes it from 70% to 100%", async () => {
    await setUseCents(700);
    await runHostingJob(testEnv);
    later(5);
    await setUseCents(1000);
    await runHostingJob(testEnv);
    expect(subjects()).toEqual(["Arena has used most of its free hosting", "Arena's hosting is paused"]);
  });

  it("tells the developer when a raised budget is used too", async () => {
    await topUp(2000);
    await setBudget(200);
    await setUseCents(1200);
    await runHostingJob(testEnv);
    expect((await month()).paused_reason).toBe("budget_used");
    await apiCall(testEnv, { ...(await caller()), isSpendingConfirmed: true }, "PATCH", "/games/arena", { monthly_budget_cents: 500 });
    expect((await month()).paused_at_ms).toBeNull();
    later(10);
    await setUseCents(1600);
    await runHostingJob(testEnv);
    expect(await month()).toMatchObject({ charged_cents: 500, paused_reason: "budget_used" });
    expect(subjects()).toEqual(["Arena has used most of its budget", "Arena's hosting is paused", "Arena has used most of its budget", "Arena's hosting is paused"]);
  });

  it("never charges what a game used while it had no budget once the developer gives it one", async () => {
    await setUseCents(1100);
    await runHostingJob(testEnv);
    expect(await month()).toMatchObject({ paused_reason: "free_used", written_off_cents: 100 });
    await topUp(2000);
    await apiCall(testEnv, { ...(await caller()), isSpendingConfirmed: true }, "PATCH", "/games/arena", { monthly_budget_cents: 5000 });
    expect((await month()).paused_at_ms).toBeNull();
    later(5);
    await setUseCents(1150);
    await runHostingJob(testEnv);
    expect({ balanceCents: await balance(), monthChargedCents: (await month()).charged_cents }).toEqual({ balanceCents: 1950, monthChargedCents: 50 });
  });

  it("warns a game with a budget but no credit before it pauses at the end of its free hosting", async () => {
    await setBudget(5000);
    await setUseCents(850);
    await runHostingJob(testEnv);
    expect(await notices()).toEqual(["hosting_nearly_paused"]);
    expect(emails.map((email) => email.text)).toEqual([expect.stringContaining("Arena has a budget, but there's no credit for it to spend")]);
    const answer = (await apiCall(testEnv, await caller(), "GET", "/games/arena")) as { alerts: { kind: string }[] };
    expect(answer.alerts.map((alert) => alert.kind)).toContain("hosting_nearly_paused");
  });

  it("warns that credit is low before it runs out, even when one run takes it from 30% to 0", async () => {
    await paidTopUp(1000);
    await setBudget(5000);
    await setUseCents(2000);
    await runHostingJob(testEnv);
    expect(subjects()).toEqual(["Your Zaisma credit is low", "Your Zaisma credit is used up", "Arena's hosting is paused"]);
  });

  it("warns at 20% of the credit left after the last top-up, also when that top-up was a small one, and shows it in the dashboard and MCP until the next", async () => {
    await paidTopUp(5000);
    await paidTopUp(1000);
    await setBudget(10_000);
    // 4,900 past free: $11 left of the $60 after the last top-up, under its $12 line.
    await setUseCents(5900);
    await runHostingJob(testEnv);
    expect(await balance()).toBe(1100);
    expect(subjects()).toEqual(["Your Zaisma credit is low"]);
    expect(await notices()).toContain("credit_low");
    const credit = async () => ((await apiCall(testEnv, await caller(), "GET", "/credit")) as { credit: { is_credit_low: boolean } }).credit.is_credit_low;
    const alertKinds = async () => ((await apiCall(testEnv, await caller(), "GET", "/games/arena")) as { alerts: { kind: string }[] }).alerts.map((alert) => alert.kind);
    expect(await credit()).toBe(true);
    expect(await alertKinds()).toContain("credit_low");
    // Told once: the next run's charge doesn't tell it again.
    later(5);
    await setUseCents(5950);
    await runHostingJob(testEnv);
    expect(subjects()).toEqual(["Your Zaisma credit is low"]);

    await paidTopUp(2000);
    expect(await credit()).toBe(false);
    expect(await alertKinds()).not.toContain("credit_low");
  });
});
