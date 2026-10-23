import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addCreditEntry, createAccount, createGame, creditOf, gameHostingMonth, monthStartDateOf, personOwner, type Game } from "@zaisma/core";
import { runHostingJob } from "../../apps/site/src/hosting-job.ts";
import { apiCall, callerFor } from "../../apps/site/src/developer.ts";
import { handleStripeEvents } from "../../apps/site/src/stripe-events.ts";

// The site's 5-minute hosting job (apps/site/src/hosting-job.ts): the one judge of every game's month on the meter.
// It charges what's past the free allowance to games with a budget, pauses at the allowance, the budget or an empty
// balance, writes off what's past them, runs automatic top-ups first, and tells the developer once by email.

const testEnv = { ...env, EMAIL_OUTBOX_URL: "https://outbox.test" } as typeof env;
const HOUR_SEC = 3600;
let emails: { to: string; subject: string; text: string }[] = [];
let stripeCalls: { path: string; form: URLSearchParams; idempotencyKey: string | null }[] = [];
let isCardDeclined = false;
let ownerId = "";
let game: Game;

beforeEach(async () => {
  await env.DB.exec("DELETE FROM credit_entries; DELETE FROM game_hosting_months; DELETE FROM alert_notices; DELETE FROM room_usage; DELETE FROM security_events; DELETE FROM audit_log; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;");
  emails = [];
  stripeCalls = [];
  isCardDeclined = false;
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
      stripeCalls.push({ path: url.pathname, form: new URLSearchParams(String(init?.body ?? "")), idempotencyKey: new Headers(init?.headers).get("idempotency-key") });
      if (isCardDeclined) return Response.json({ error: { message: "Your card was declined.", decline_code: "insufficient_funds" } }, { status: 402 });
      return Response.json({ id: `pi_auto_${stripeCalls.length}`, status: "succeeded" });
    }
    return realFetch(input, init);
  });
});
afterEach(() => vi.unstubAllGlobals());

/** This month's use, as one day's row: player-hours of a rooms-only game, at 0.2 cents each. */
const setPlayerHours = (hours: number) =>
  env.DB.prepare("INSERT INTO room_usage (game_id, date, room_play_duration_sec) VALUES (?, ?, ?) ON CONFLICT (game_id, date) DO UPDATE SET room_play_duration_sec = excluded.room_play_duration_sec")
    .bind(game.id, new Date().toISOString().slice(0, 10), hours * HOUR_SEC)
    .run();
const setBudget = (cents: number | null) => env.DB.prepare("UPDATE games SET monthly_budget_cents = ? WHERE id = ?").bind(cents, game.id).run();
const topUp = (cents: number) => addCreditEntry(env.DB, { ownerId, entryKind: "top_up", amountCents: cents, stripeObjectId: `pi_${crypto.randomUUID()}`, refundableUntilMs: Date.now() + 86_400_000 });
const month = () => gameHostingMonth(env.DB, game.id);
const balance = async () => (await creditOf(env.DB, ownerId)).balanceCents;
const notices = async () => (await env.DB.prepare("SELECT alert_kind FROM alert_notices WHERE game_id = ? ORDER BY noticed_at_ms, alert_kind").bind(game.id).all<{ alert_kind: string }>()).results.map((row) => row.alert_kind);
const entries = async (kind: string) => (await env.DB.prepare("SELECT amount_cents FROM credit_entries WHERE owner_id = ? AND entry_kind = ?").bind(ownerId, kind).all<{ amount_cents: number }>()).results.map((row) => row.amount_cents);

describe("a game without a budget", () => {
  it("hears once at 80% of its free hosting, and pauses at all of it", async () => {
    await setPlayerHours(1900);
    await runHostingJob(testEnv);
    expect(await notices()).toEqual([]);

    await setPlayerHours(2100);
    await runHostingJob(testEnv);
    await runHostingJob(testEnv);
    expect(await notices()).toEqual(["hosting_nearly_paused"]);
    expect(emails.map((email) => [email.to, email.subject])).toEqual([["emma@example.com", "Arena has used most of its free hosting"]]);
    expect((await month()).paused_at_ms).toBeNull();

    await setPlayerHours(2500);
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
    // 3,500 player-hours: 700 cents, 200 past the free 500.
    await setPlayerHours(3500);
    await runHostingJob(testEnv);
    expect(await balance()).toBe(800);
    expect(await month()).toMatchObject({ charged_cents: 200, paused_at_ms: null });

    await setPlayerHours(4500);
    await runHostingJob(testEnv);
    expect(await month()).toMatchObject({ charged_cents: 400, paused_at_ms: null });
    expect(await notices()).toEqual(["hosting_budget_nearly_used"]);
    expect(emails.map((email) => email.text)).toEqual([expect.stringContaining("Arena has used $4 of its $5 budget")]);

    // 1,100 cents: 600 past free, 100 past the budget. It stops at the budget, and the rest is Zaisma's.
    await setPlayerHours(5500);
    await runHostingJob(testEnv);
    expect(await month()).toMatchObject({ charged_cents: 500, written_off_cents: 100, paused_reason: "budget_used" });
    expect(await balance()).toBe(500);
    expect(await entries("hosting_charge")).toEqual([-500]);
    expect(await entries("written_off")).toEqual([100]);
  });

  it("pauses when the balance is used, never takes it below 0, and writes off the rest", async () => {
    await topUp(100);
    await setBudget(5000);
    await setPlayerHours(3500);
    await runHostingJob(testEnv);
    expect(await balance()).toBe(0);
    expect(await month()).toMatchObject({ charged_cents: 100, written_off_cents: 100, paused_reason: "credit_used" });
    expect(emails.map((email) => email.subject)).toEqual(["Your Zaisma credit is used up", "Arena's hosting is paused"]);
    // The finishing hour's use is written off too, never charged later.
    await setPlayerHours(3600);
    await runHostingJob(testEnv);
    expect(await balance()).toBe(0);
    expect(await month()).toMatchObject({ charged_cents: 100, written_off_cents: 120 });
  });

  it("starts again when credit comes in", async () => {
    await topUp(100);
    await setBudget(5000);
    await setPlayerHours(3500);
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
    await setPlayerHours(3600);
    await runHostingJob(testEnv);
    expect(await month()).toMatchObject({ charged_cents: 120, written_off_cents: 100, paused_at_ms: null });
    expect(await balance()).toBe(1980);
  });

  it("pauses at once when its budget is lowered below this month's charges, and starts when it's raised", async () => {
    await topUp(2000);
    await setBudget(5000);
    await setPlayerHours(4000);
    await runHostingJob(testEnv);
    expect((await month()).charged_cents).toBe(300);
    const caller = (await callerFor(testEnv, new Request("https://zaisma.test"), "dev-1"))!;

    await apiCall(testEnv, caller, "PATCH", "/games/arena", { monthly_budget_cents: 200 });
    expect(await month()).toMatchObject({ paused_reason: "budget_used", paused_at_ms: expect.any(Number) });
    await apiCall(testEnv, { ...caller, isSpendingConfirmed: true }, "PATCH", "/games/arena", { monthly_budget_cents: 1000 });
    expect((await month()).paused_at_ms).toBeNull();
  });
});

describe("automatic top-up", () => {
  async function turnOn(limitCents: number) {
    await env.DB.prepare("UPDATE owners SET stripe_customer_id = 'cus_1', stripe_payment_method_id = 'pm_1', automatic_top_up_enabled = 1, top_up_below_cents = 500, top_up_amount_cents = 1000, monthly_top_up_limit_cents = ? WHERE id = ?").bind(limitCents, ownerId).run();
  }

  it("charges the saved card before a game would pause, within the month's limit, and says so", async () => {
    await turnOn(1000);
    await setBudget(5000);
    await setPlayerHours(3500);
    await runHostingJob(testEnv);
    expect(stripeCalls.map((call) => [call.path, call.form.get("amount"), call.form.get("off_session"), call.idempotencyKey])).toEqual([["/v1/payment_intents", "1000", "true", `automatic-top-up:${ownerId}:${monthStartDateOf().slice(0, 7)}:1`]]);
    expect(await balance()).toBe(800);
    expect((await month()).paused_at_ms).toBeNull();
    expect(emails.map((email) => email.text)).toEqual([expect.stringContaining("Zaisma added $10 of credit. $0 of your $10 for")]);

    // The month's limit is used: no second top-up, so the game pauses when the balance runs out.
    await setPlayerHours(8000);
    await runHostingJob(testEnv);
    expect(stripeCalls).toHaveLength(1);
    expect(await month()).toMatchObject({ charged_cents: 1000, paused_reason: "credit_used" });
  });

  it("turns off and says why when the card is declined", async () => {
    await turnOn(5000);
    await setBudget(5000);
    isCardDeclined = true;
    await setPlayerHours(3500);
    await runHostingJob(testEnv);
    expect((await creditOf(env.DB, ownerId)).automaticTopUp.isEnabled).toBe(false);
    expect(emails.map((email) => email.subject)).toEqual(["Your automatic top-up didn't go through", "Arena's hosting is paused"]);
    expect(emails[0]!.text).toContain("Your card was declined.");
  });
});
