import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccount, createGame, monthStartDateOf, personOwner, roomHostingOf, gameHosting, isHostingPaused, addCreditEntry, type Game } from "@zaisma/core";
import { runSpendingJob } from "../../apps/site/src/spending-job.ts";
import { runHostingJob } from "../../apps/site/src/hosting-job.ts";
import { countTicket, issueTicket } from "../../apps/site/src/plays.ts";

// The spending job (apps/site/src/spending-job.ts): Zaisma's own month against its limit, what Julius hears, and the
// stop on free rooms it writes for the doors of rooms and the relay (roomHostingOf).

// Made-up amounts: the real ones are the site Worker's secrets.
const SECRETS = { MONTHLY_SPENDING_LIMIT_CENTS: "20000", FIXED_COST_CENTS_PER_MONTH: "6000", STORAGE_AND_CHECKS_COST_CENTS_PER_MONTH: "2000", METER_COST_SHARE_PCT: "50", UNPLAYED_GAMES_COST_CENTS_PER_MONTH: "700", PAST_LIMIT_CEILING_CENTS: "900" };
const testEnv = { ...env, ...SECRETS, ALERT_EMAIL: undefined, EMAIL_OUTBOX_URL: "https://outbox.test", PUSHOVER_USER_KEY: "user-key", PUSHOVER_APP_TOKEN: "app-token", PUSHOVER_URL: "https://pushover.test/messages.json" } as unknown as typeof env;
const NOW_MS = Date.now();
const MONTH_START_DATE = monthStartDateOf(NOW_MS);
const LAST_MONTH_MS = Date.parse(`${MONTH_START_DATE}T00:00:00Z`) - 86_400_000;

let pushes: { title: string; message: string }[] = [];
let emails: { to: string; subject: string }[] = [];
let ownerId = "";
let game: Game;

/** This month's meter, in the meter's cents, which cost half that at these secrets' share. */
const setUnpaidMeterCents = (cents: number, chargedCents = 0) =>
  env.DB.prepare("INSERT INTO game_hosting_months (game_id, month_start_date, used_cents, charged_cents) VALUES (?, ?, ?, ?) ON CONFLICT (game_id, month_start_date) DO UPDATE SET used_cents = excluded.used_cents, charged_cents = excluded.charged_cents").bind(game.id, MONTH_START_DATE, cents + chargedCents, chargedCents).run();
const row = () => env.DB.prepare("SELECT * FROM spending_months WHERE month_start_date = ?").bind(MONTH_START_DATE).first<Record<string, number | null>>();
const useRooms = () => env.DB.prepare("INSERT OR REPLACE INTO room_usage (game_id, date, room_awake_duration_sec) VALUES (?, ?, 100)").bind(game.id, new Date(NOW_MS).toISOString().slice(0, 10)).run();
const giveBudgetAndCredit = async () => {
  await env.DB.prepare("UPDATE games SET monthly_budget_cents = 5000 WHERE id = ?").bind(game.id).run();
  await addCreditEntry(env.DB, { ownerId, entryKind: "top_up", amountCents: 1000, stripeObjectId: `pi_${crypto.randomUUID()}`, refundableUntilMs: NOW_MS + 86_400_000 });
};

beforeEach(async () => {
  await env.DB.exec("DELETE FROM spending_months; DELETE FROM earnings; DELETE FROM credit_entries; DELETE FROM game_hosting_months; DELETE FROM alert_notices; DELETE FROM room_usage; DELETE FROM ai_usage; UPDATE owners SET stored_size_bytes = 0, credit_balance_cents = 0;");
  pushes = [];
  emails = [];
  await createAccount(env.DB, { id: "dev-1", username: "Emma_Builds", ageBand: "18+" });
  ownerId = (await personOwner(env.DB, "dev-1")).id;
  game = await createGame(env.DB, { slug: `arena-${crypto.randomUUID().slice(0, 8)}`, title: "Arena", description: "", ownerId, visibility: "listed" });
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === "https://pushover.test") {
      const form = new URLSearchParams(String(init?.body));
      pushes.push({ title: form.get("title")!, message: form.get("message")! });
      return new Response("ok");
    }
    if (url.origin === "https://outbox.test") {
      const sent = JSON.parse(String(init?.body)) as { to: string; subject: string };
      emails.push({ to: sent.to, subject: sent.subject });
      return new Response("ok");
    }
    if (url.origin === "https://supabase.test" && url.pathname.startsWith("/auth/v1/admin/users/")) return Response.json({ id: "dev-1", email: "emma@example.com" });
    return realFetch(input, init);
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("measuring the month", () => {
  it("writes each line, with a paying game's charged part left out", async () => {
    await env.DB.prepare("INSERT INTO ai_usage (month, review_cost_cents, review_call_count) VALUES (?, 700, 1)").bind(MONTH_START_DATE.slice(0, 7)).run();
    await setUnpaidMeterCents(4000, 8000);
    await runSpendingJob(testEnv, NOW_MS);
    expect(await row()).toMatchObject({ fixed_cost_cents: 6000, ai_cost_cents: 700, storage_and_checks_cost_cents: 2000, free_hosting_cost_cents: 2000, spent_cents: 10700, limit_cents: 20000, free_rooms_stopped_at_ms: null });
  });

  it("grows the limit by last month's charges and earnings, after costs, and no other month's", async () => {
    await env.DB.prepare("INSERT INTO earnings (stripe_object_id, earning_kind, amount_cents, earned_at_ms) VALUES ('in_1', 'pro', 941, ?), ('in_old', 'pro', 941, 1000), ('in_now', 'pro', 941, ?)").bind(LAST_MONTH_MS, NOW_MS).run();
    await addCreditEntry(env.DB, { ownerId, entryKind: "top_up", amountCents: 20000, stripeObjectId: "pi_big", createdAtMs: LAST_MONTH_MS });
    await env.DB.prepare("INSERT INTO credit_entries (id, owner_id, entry_kind, amount_cents, game_id, created_at_ms) VALUES ('c1', ?, 'hosting_charge', -10000, ?, ?), ('c2', ?, 'storage_charge', -500, NULL, ?)").bind(ownerId, game.id, LAST_MONTH_MS, ownerId, LAST_MONTH_MS).run();
    await runSpendingJob(testEnv, NOW_MS);
    expect(await row()).toMatchObject({ earned_last_month_cents: 5000 + 500 + 941, limit_cents: 20000 + 6441 });
  });
});

describe("what Julius hears", () => {
  it("is pushed once at each share of the limit", async () => {
    await setUnpaidMeterCents(8000); // $120 spent, under the first.
    await runSpendingJob(testEnv, NOW_MS);
    expect(pushes).toEqual([]);

    await setUnpaidMeterCents(12000); // $140: 70%.
    await runSpendingJob(testEnv, NOW_MS);
    await runSpendingJob(testEnv, NOW_MS);
    expect(pushes.map((push) => push.title)).toEqual(["Spending at 70% of the limit"]);
    expect(pushes[0]!.message).toContain("$140.00 of $200.00");

    await setUnpaidMeterCents(18000); // $170: 85%.
    await runSpendingJob(testEnv, NOW_MS);
    expect(pushes.at(-1)!.title).toBe("Spending at 85% of the limit");
    expect(pushes).toHaveLength(2);
  });

  it("names both when one run goes past two", async () => {
    await setUnpaidMeterCents(18000);
    await runSpendingJob(testEnv, NOW_MS);
    expect(pushes.map((push) => push.title)).toEqual(["Spending at 70% and 85% of the limit"]);
    expect((await row())?.told_pct).toBe(85);
  });

  it("is pushed once a month when the secrets aren't set, and nothing else happens", async () => {
    const bare = { ...testEnv, METER_COST_SHARE_PCT: undefined } as unknown as typeof env;
    await setUnpaidMeterCents(1_000_000);
    await runSpendingJob(bare, NOW_MS);
    await runSpendingJob(bare, NOW_MS);
    expect(pushes.map((push) => push.title)).toEqual(["The monthly spending limit isn't set"]);
    expect((await row())?.free_rooms_stopped_at_ms).toBeNull();
    expect((await roomHostingOf(env.DB, game.id, NOW_MS)).isPaused).toBe(false);
  });
});

describe("games with no real players", () => {
  const setPlayed = (hasPlayers: number) => env.DB.prepare("UPDATE game_hosting_months SET has_real_players = ? WHERE game_id = ?").bind(hasPlayers, game.id).run();

  it("stop everything when their share is gone, and only they do, until they have real players", async () => {
    const played = await createGame(env.DB, { slug: `played-${crypto.randomUUID().slice(0, 8)}`, title: "Played", description: "", ownerId, visibility: "listed" });
    await env.DB.prepare("INSERT INTO game_hosting_months (game_id, month_start_date, used_cents, has_real_players) VALUES (?, ?, 4000, 1)").bind(played.id, MONTH_START_DATE).run();
    await setUnpaidMeterCents(1398); // Costs 699 at the secrets' share, under the 700.
    await setPlayed(0);
    await runSpendingJob(testEnv, NOW_MS);
    expect((await isHostingPaused(env.DB, game.id, NOW_MS)).isPaused).toBe(false);

    await setUnpaidMeterCents(1400);
    await runSpendingJob(testEnv, NOW_MS);
    expect((await row())?.unplayed_games_stopped_at_ms).toBe(NOW_MS);
    expect(pushes.map((push) => push.title)).toEqual(["Games with no real players stopped"]);
    expect(await gameHosting(env.DB, game.id, NOW_MS)).toEqual({ pausedAtMs: NOW_MS, pausedReason: "no_real_players", freeRoomsStoppedAtMs: null, rentedShareStoppedAtMs: null });
    // The game people play goes on, and a game with a budget and credit isn't touched.
    expect((await isHostingPaused(env.DB, played.id, NOW_MS)).isPaused).toBe(false);
    await setPlayed(1);
    expect((await isHostingPaused(env.DB, game.id, NOW_MS)).isPaused).toBe(false);
    await setPlayed(0);
    await giveBudgetAndCredit();
    expect((await isHostingPaused(env.DB, game.id, NOW_MS)).isPaused).toBe(false);
  });

  it("covers a new game with no meter row", async () => {
    await setUnpaidMeterCents(1400);
    await setPlayed(0);
    await runSpendingJob(testEnv, NOW_MS);
    const empty = await createGame(env.DB, { slug: `empty-${crypto.randomUUID().slice(0, 8)}`, title: "Empty", description: "", ownerId, visibility: "listed" });
    expect((await isHostingPaused(env.DB, empty.id, NOW_MS)).pausedReason).toBe("no_real_players");
  });

  it("are paused on the meter by the hosting job, and start again with real players", async () => {
    await env.DB.prepare("INSERT OR REPLACE INTO spending_months (month_start_date, unplayed_games_stopped_at_ms) VALUES (?, ?)").bind(MONTH_START_DATE, NOW_MS).run();
    await env.DB.prepare("INSERT INTO room_usage (game_id, date, room_awake_duration_sec) VALUES (?, ?, 100)").bind(game.id, new Date(NOW_MS).toISOString().slice(0, 10)).run();
    await runHostingJob(testEnv, NOW_MS);
    const paused = (await env.DB.prepare("SELECT paused_reason, has_real_players FROM game_hosting_months WHERE game_id = ?").bind(game.id).first<{ paused_reason: string | null; has_real_players: number }>())!;
    expect(paused).toEqual({ paused_reason: "no_real_players", has_real_players: 0 });

    await env.DB.prepare("UPDATE game_hosting_months SET real_player_count = 2 WHERE game_id = ?").bind(game.id).run();
    await runHostingJob(testEnv, NOW_MS);
    expect((await isHostingPaused(env.DB, game.id, NOW_MS)).isPaused).toBe(false);
  });

  it("get no second allowance yet, and keep it for when they have real players", async () => {
    const setUse = (sec: number) => env.DB.prepare("INSERT OR REPLACE INTO room_usage (game_id, date, room_awake_duration_sec) VALUES (?, ?, ?)").bind(game.id, new Date(NOW_MS).toISOString().slice(0, 10), sec).run();
    const grantedMonth = async () => (await env.DB.prepare("SELECT second_free_allowance_month_start_date AS month_start_date FROM games WHERE id = ?").bind(game.id).first<{ month_start_date: string | null }>())?.month_start_date;
    await setUse(1_600_000); // 1,024 cents: past one allowance.
    await runHostingJob(testEnv, NOW_MS);
    expect(await grantedMonth()).toBeNull();
    expect((await gameHosting(env.DB, game.id, NOW_MS)).pausedReason).toBe("free_used");

    await env.DB.prepare("UPDATE game_hosting_months SET real_player_count = 40 WHERE game_id = ?").bind(game.id).run();
    await runHostingJob(testEnv, NOW_MS);
    expect(await grantedMonth()).toBe(MONTH_START_DATE);
    expect((await gameHosting(env.DB, game.id, NOW_MS)).pausedAtMs).toBeNull();
  });
});

describe("real players", () => {
  const FACTS = { first: null, last: null, cfirst: null, clast: null };
  const count = async () => (await env.DB.prepare("SELECT real_player_count FROM game_hosting_months WHERE game_id = ?").bind(game.id).first<{ real_player_count: number }>())?.real_player_count ?? 0;
  const countedPlay = async (facts: typeof FACTS | { first: string; last: string; cfirst: string; clast: string }, network: number) => {
    const ticket = await issueTicket(env.DB, game.id, facts, NOW_MS);
    expect(await countTicket(env.DB, game.id, ticket, network, NOW_MS + 60_000)).toBe(true);
  };

  it("count a browser's first counted play of the month, off cloud networks", async () => {
    await countedPlay(FACTS, 7922);
    expect(await count()).toBe(1);
    // Amazon's network: counted in the game's stats, not here.
    await countedPlay(FACTS, 16509);
    expect(await count()).toBe(1);
    // A browser that played this month already.
    const today = new Date(NOW_MS).toISOString().slice(0, 10);
    await countedPlay({ first: today, last: today, cfirst: today, clast: today }, 7922);
    expect(await count()).toBe(1);
  });
});

describe("the ceiling past the limit", () => {
  it("stops free games' requests and schedules too, and not paying games", async () => {
    await setUnpaidMeterCents(24000); // The limit: only rooms stop.
    await runSpendingJob(testEnv, NOW_MS);
    expect((await isHostingPaused(env.DB, game.id, NOW_MS)).isPaused).toBe(false);
    expect((await roomHostingOf(env.DB, game.id, NOW_MS)).isPaused).toBe(true);

    await setUnpaidMeterCents(25800); // Past it by the ceiling.
    await runSpendingJob(testEnv, NOW_MS + 300_000);
    expect(await gameHosting(env.DB, game.id, NOW_MS + 300_000)).toEqual({ pausedAtMs: NOW_MS + 300_000, pausedReason: "free_hosting_ended", freeRoomsStoppedAtMs: null, rentedShareStoppedAtMs: null });
    expect(pushes.at(-1)!.title).toBe("Free hosting ended: past the ceiling");
    await giveBudgetAndCredit();
    expect((await isHostingPaused(env.DB, game.id, NOW_MS + 300_000)).isPaused).toBe(false);
  });
});

describe("the stop", () => {
  it("reaches a free game at the limit, with one moment for all its rooms, and tells its developer once", async () => {
    await useRooms();
    await setUnpaidMeterCents(24000); // $200: the limit.
    await runSpendingJob(testEnv, NOW_MS);
    expect((await row())?.free_rooms_stopped_at_ms).toBe(NOW_MS);
    expect(pushes.at(-1)!.title).toBe("Free rooms stopped: spending limit reached");
    expect(await roomHostingOf(env.DB, game.id, NOW_MS)).toEqual({ isPaused: true, pausedAtMs: NOW_MS });

    await runSpendingJob(testEnv, NOW_MS + 300_000);
    expect((await roomHostingOf(env.DB, game.id, NOW_MS + 300_000)).pausedAtMs).toBe(NOW_MS);
    const { results } = await env.DB.prepare("SELECT alert_kind FROM alert_notices WHERE game_id = ?").bind(game.id).all<{ alert_kind: string }>();
    expect(results).toEqual([{ alert_kind: "free_rooms_stopped" }]);
    expect(emails.filter((email) => email.subject.includes("can't start new matches"))).toHaveLength(1);
  });

  it("covers a free game with no meter row yet, and never tells a game that used no rooms", async () => {
    const other = await createGame(env.DB, { slug: `quiet-${crypto.randomUUID().slice(0, 8)}`, title: "Quiet", description: "", ownerId, visibility: "listed" });
    await setUnpaidMeterCents(24000);
    await runSpendingJob(testEnv, NOW_MS);
    expect((await roomHostingOf(env.DB, other.id, NOW_MS)).isPaused).toBe(true);
    expect(emails).toEqual([]);
  });

  it("never reaches a game with a budget and credit, and lifts for one that gets them", async () => {
    await setUnpaidMeterCents(24000);
    await runSpendingJob(testEnv, NOW_MS);
    expect((await gameHosting(env.DB, game.id, NOW_MS)).freeRoomsStoppedAtMs).toBe(NOW_MS);
    await giveBudgetAndCredit();
    expect((await roomHostingOf(env.DB, game.id, NOW_MS)).isPaused).toBe(false);
    expect((await gameHosting(env.DB, game.id, NOW_MS)).freeRoomsStoppedAtMs).toBeNull();
  });

  it("still reaches a game with a budget and no credit", async () => {
    await env.DB.prepare("UPDATE games SET monthly_budget_cents = 5000 WHERE id = ?").bind(game.id).run();
    await setUnpaidMeterCents(24000);
    await runSpendingJob(testEnv, NOW_MS);
    expect((await roomHostingOf(env.DB, game.id, NOW_MS)).isPaused).toBe(true);
  });

  it("clears when the limit rises above what's spent", async () => {
    await setUnpaidMeterCents(24000);
    await runSpendingJob(testEnv, NOW_MS);
    expect((await roomHostingOf(env.DB, game.id, NOW_MS)).isPaused).toBe(true);
    await env.DB.prepare("INSERT INTO earnings (stripe_object_id, earning_kind, amount_cents, earned_at_ms) VALUES ('in_late', 'pro', 941, ?)").bind(LAST_MONTH_MS).run();
    await runSpendingJob(testEnv, NOW_MS + 300_000);
    expect((await row())?.free_rooms_stopped_at_ms).toBeNull();
    expect((await roomHostingOf(env.DB, game.id, NOW_MS + 300_000)).isPaused).toBe(false);
  });

  it("ends with the month: a new month has no row", async () => {
    await setUnpaidMeterCents(24000);
    await runSpendingJob(testEnv, NOW_MS);
    const nextMonthMs = Date.parse(`${MONTH_START_DATE}T00:00:00Z`) + 32 * 86_400_000;
    expect((await roomHostingOf(env.DB, game.id, nextMonthMs)).isPaused).toBe(false);
  });
});
