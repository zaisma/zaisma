import { env } from "cloudflare:test";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError, HANDLING_LEASE_MS, PURCHASE_DELIVERIES, UNHANDLED_PAGE_COUNT, cardFeeNote, checkItem, checkPurchaseSettings, createGame, finishHandling, finishRefundHandling, priceFor, priceText, purchaseById, purchaseLabelOf, purchaseSettingsOf, releaseHandling, releaseRefundHandling, startHandling, startRefundHandling, takeBack, unhandledFor } from "@zaisma/core";

// Items' pure parts (packages/core/src/items.ts): checking one, the price a player pays, how it's written,
// the card fee note, and the label a game page shows from them.

const revive = { title: "Revive", description: "", item_kind: "consumable", item_category: "gameplay", price_minor_units: 199, currency_code: "usd", local_prices: [] as unknown[] };

/** The code and field an ApiError was thrown with, or null. */
function refusal(work: () => unknown): { code: string; field: string | null } | null {
  try {
    work();
    return null;
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return { code: error.code, field: error.field };
  }
}

describe("checkItem", () => {
  it("takes a good item and tidies its words", () => {
    expect(checkItem("revive", { ...revive, title: "  Revive  " })).toEqual({ item_name: "revive", ...revive, title: "Revive" });
  });

  it("refuses each bad one, naming the field", () => {
    expect(refusal(() => checkItem("Revive Potion", revive))).toEqual({ code: "bad_item", field: "item_name" });
    expect(refusal(() => checkItem("revive", { ...revive, price_minor_units: 1.99 }))).toEqual({ code: "bad_item", field: "price_minor_units" });
    expect(refusal(() => checkItem("revive", { ...revive, price_minor_units: 49 }))).toEqual({ code: "price_too_low", field: "price_minor_units" });
    expect(refusal(() => checkItem("revive", { ...revive, currency_code: "xyz" }))).toEqual({ code: "unsupported_currency", field: "currency_code" });
    expect(refusal(() => checkItem("revive", { ...revive, currency_code: "USD" }))).toEqual({ code: "bad_item", field: "currency_code" });
    expect(refusal(() => checkItem("revive", { ...revive, local_prices: [{ currency_code: "usd", price_minor_units: 299 }] }))).toEqual({ code: "bad_item", field: "local_prices[0].currency_code" });
    const tooMany = Array.from({ length: 41 }, () => ({ currency_code: "eur", price_minor_units: 199 }));
    expect(refusal(() => checkItem("revive", { ...revive, local_prices: tooMany }))).toEqual({ code: "bad_item", field: "local_prices" });
    expect(refusal(() => checkItem("revive", { ...revive, price_minor_units: null }))).toEqual({ code: "bad_item", field: "currency_code" });
    expect(refusal(() => checkItem("revive", { ...revive, item_kind: "forever" }))).toEqual({ code: "bad_item", field: "item_kind" });
  });
});

describe("prices", () => {
  const expansion = { price_minor_units: 1999, currency_code: "usd", local_prices: [{ currency_code: "brl", price_minor_units: 5990 }] };

  it("are the local price in the player's country's currency, else the main one", () => {
    expect(priceFor(expansion, "BR")).toEqual({ currencyCode: "brl", priceMinorUnits: 5990 });
    expect(priceFor(expansion, "DE")).toEqual({ currencyCode: "usd", priceMinorUnits: 1999 });
    expect(priceFor(expansion, null)).toEqual({ currencyCode: "usd", priceMinorUnits: 1999 });
    expect(priceFor({ price_minor_units: null, currency_code: null, local_prices: [] }, "US")).toBeNull();
  });

  it("are in the player's own currency where Cloudflare names a place apart from its country, and in Bulgaria's euro", () => {
    const everywhere = { price_minor_units: 1999, currency_code: "gbp", local_prices: [{ currency_code: "eur", price_minor_units: 2299 }, { currency_code: "usd", price_minor_units: 2499 }] };
    for (const countryCode of ["BG", "RE", "GP", "MQ", "GF", "YT", "AX"]) expect(priceFor(everywhere, countryCode), countryCode).toEqual({ currencyCode: "eur", priceMinorUnits: 2299 });
    for (const countryCode of ["PR", "GU", "VI", "AS", "MP", "EC", "SV"]) expect(priceFor(everywhere, countryCode), countryCode).toEqual({ currencyCode: "usd", priceMinorUnits: 2499 });
  });

  it("are written as people read them, yen whole", () => {
    expect(priceText("usd", 199)).toBe("$1.99");
    expect(priceText("jpy", 300)).toBe("¥300");
    expect(priceText("brl", 5990, "pt-BR")).toMatch(/^R\$\s59,90$/);
  });

  it("under 2 dollars say about what reaches the developer after card fees", () => {
    expect(cardFeeNote("usd", 99)).toBe("Of $0.99, about $0.66 reaches you after card fees.");
    expect(cardFeeNote("usd", 499)).toBeNull();
    expect(cardFeeNote("brl", 99)).toBeNull();
    expect(cardFeeNote(null, null)).toBeNull();
  });
});

describe("the purchase label", () => {
  it("counts sold items and the game's own payments, not items that are only granted", () => {
    const label = purchaseLabelOf([{ item_category: "cosmetic", price_minor_units: 299 }, { item_category: "gameplay", price_minor_units: null }], ["content"]);
    expect(label).toEqual({ categories: ["cosmetic", "content"], has_own_payments: true });
    expect(purchaseLabelOf([], [])).toEqual({ categories: [], has_own_payments: false });
  });

  it("needs a refund policy whenever the game sells anything", () => {
    const none = { refund_policy: null, refund_policy_text: null, own_payment_categories: [], purchase_delivery: "game" as const };
    expect(refusal(() => checkPurchaseSettings({ own_payment_categories: ["currency"] }, none, false))).toEqual({ code: "refund_policy_needed", field: "refund_policy" });
    expect(checkPurchaseSettings({ refund_policy: "no_refunds", own_payment_categories: ["currency", "cosmetic"] }, none, false)).toEqual({ refund_policy: "no_refunds", refund_policy_text: null, own_payment_categories: ["cosmetic", "currency"], purchase_delivery: "game" });
  });
});

describe("purchase delivery", () => {
  const none = { refund_policy: null, refund_policy_text: null, own_payment_categories: [], purchase_delivery: "game" as const };

  it("is one of game, game_server or own_server, and game until the developer says otherwise", () => {
    expect([...PURCHASE_DELIVERIES]).toEqual(["game", "game_server", "own_server"]);
    expect(purchaseSettingsOf({ refund_policy: null, refund_policy_text: null, own_payment_categories: "[]" }).purchase_delivery).toBe("game");
    expect(checkPurchaseSettings({ purchase_delivery: "own_server" }, none, false).purchase_delivery).toBe("own_server");
    expect(checkPurchaseSettings({ refund_policy: "no_refunds" }, { ...none, purchase_delivery: "game_server" }, false).purchase_delivery).toBe("game_server");
    expect(refusal(() => checkPurchaseSettings({ purchase_delivery: "my_server" }, none, false))).toEqual({ code: "bad_purchase_delivery", field: "purchase_delivery" });
    expect(refusal(() => checkPurchaseSettings({ purchase_delivery: null }, none, false))).toEqual({ code: "bad_purchase_delivery", field: "purchase_delivery" });
  });
});

describe("handing purchases over", () => {
  const NOW_MS = 1_800_000_000_000;
  let gameId = "";
  let otherGameId = "";

  /** A purchase straight in the database; purchaseStatus and the handled columns say where it stands. */
  async function addPurchase(id: string, details: { gameId?: string; playerId?: string; purchaseStatus?: string; createdAtMs?: number; handledAtMs?: number | null; refundHandledAtMs?: number | null } = {}) {
    await env.DB.prepare("INSERT INTO purchases (id, game_id, item_name, item_kind, player_id, purchase_source, purchase_status, created_at_ms, handled_at_ms, refund_handled_at_ms) VALUES (?, ?, 'revive', 'consumable', ?, 'grant', ?, ?, ?, ?)")
      .bind(id, details.gameId ?? gameId, details.playerId ?? "player_ann", details.purchaseStatus ?? "completed", details.createdAtMs ?? NOW_MS, details.handledAtMs ?? null, details.refundHandledAtMs ?? null)
      .run();
  }

  beforeEach(async () => {
    await env.DB.exec("DELETE FROM purchases; DELETE FROM games;");
    gameId = (await createGame(env.DB, { slug: "sky-hopper", title: "Sky Hopper", description: "", visibility: "draft" })).id;
    otherGameId = (await createGame(env.DB, { slug: "moon-base", title: "Moon Base", description: "", visibility: "draft" })).id;
  });

  afterAll(async () => {
    await env.DB.exec("DELETE FROM purchases; DELETE FROM games;");
  });

  it("is won once: of two callers at the same moment, one wins and the other doesn't", async () => {
    await addPurchase("purchase_one");
    const won = await Promise.all([startHandling(env.DB, "purchase_one", "player_ann", gameId, NOW_MS), startHandling(env.DB, "purchase_one", "player_ann", gameId, NOW_MS)]);
    expect(won.filter(Boolean)).toHaveLength(1);
    // Still held a moment later, up to the end of the lease.
    expect(await startHandling(env.DB, "purchase_one", "player_ann", gameId, NOW_MS + HANDLING_LEASE_MS - 1)).toBe(false);
    expect((await env.DB.prepare("SELECT handling_until_ms FROM purchases WHERE id = 'purchase_one'").first<{ handling_until_ms: number }>())!.handling_until_ms).toBe(NOW_MS + HANDLING_LEASE_MS);
  });

  it("is won again once the lease ran out, and when the winner let go", async () => {
    await addPurchase("purchase_one");
    expect(await startHandling(env.DB, "purchase_one", "player_ann", gameId, NOW_MS)).toBe(true);
    expect(await startHandling(env.DB, "purchase_one", "player_ann", gameId, NOW_MS + HANDLING_LEASE_MS)).toBe(true);
    expect(await startHandling(env.DB, "purchase_one", "player_ann", gameId, NOW_MS + HANDLING_LEASE_MS + 1)).toBe(false);
    await releaseHandling(env.DB, "purchase_one");
    expect(await startHandling(env.DB, "purchase_one", "player_ann", gameId, NOW_MS + HANDLING_LEASE_MS + 2)).toBe(true);
  });

  it("is never won by another player or for another game, nor for a purchase that isn't completed or was handled", async () => {
    await addPurchase("purchase_one");
    expect(await startHandling(env.DB, "purchase_one", "player_bo", gameId, NOW_MS)).toBe(false);
    expect(await startHandling(env.DB, "purchase_one", "player_ann", otherGameId, NOW_MS)).toBe(false);
    expect(await startHandling(env.DB, "purchase_nothing", "player_ann", gameId, NOW_MS)).toBe(false);
    for (const purchaseStatus of ["pending", "failed", "refunded", "charged_back"]) {
      await addPurchase(`purchase_${purchaseStatus}`, { purchaseStatus });
      expect(await startHandling(env.DB, `purchase_${purchaseStatus}`, "player_ann", gameId, NOW_MS), purchaseStatus).toBe(false);
    }
    await addPurchase("purchase_done", { handledAtMs: NOW_MS - 1 });
    expect(await startHandling(env.DB, "purchase_done", "player_ann", gameId, NOW_MS)).toBe(false);
    // None of that took the lease from the right caller.
    expect(await startHandling(env.DB, "purchase_one", "player_ann", gameId, NOW_MS)).toBe(true);
  });

  it("is finished once: the second finish is false, and the purchase is never won again", async () => {
    await addPurchase("purchase_one");
    expect(await startHandling(env.DB, "purchase_one", "player_ann", gameId, NOW_MS)).toBe(true);
    expect(await finishHandling(env.DB, "purchase_one", NOW_MS + 5)).toBe(true);
    expect(await finishHandling(env.DB, "purchase_one", NOW_MS + 6)).toBe(false);
    const handled = (await purchaseById(env.DB, gameId, "purchase_one"))!;
    expect(handled).toMatchObject({ handled_at_ms: NOW_MS + 5, refund_handled_at_ms: null });
    expect((await env.DB.prepare("SELECT handling_until_ms FROM purchases WHERE id = 'purchase_one'").first<{ handling_until_ms: number | null }>())!.handling_until_ms).toBeNull();
    expect(await startHandling(env.DB, "purchase_one", "player_ann", gameId, NOW_MS + 10 * HANDLING_LEASE_MS)).toBe(false);
    // Letting go of a handled purchase changes nothing.
    await releaseHandling(env.DB, "purchase_one");
    expect((await purchaseById(env.DB, gameId, "purchase_one"))!.handled_at_ms).toBe(NOW_MS + 5);
  });

  it("tells a refund only for a purchase that was handed over before it was taken back", async () => {
    await addPurchase("purchase_handled", { handledAtMs: NOW_MS - 100 });
    await addPurchase("purchase_never", {});
    // Neither is taken back yet: nothing to tell.
    expect(await startRefundHandling(env.DB, "purchase_handled", "player_ann", gameId, NOW_MS)).toBe(false);
    expect(await takeBack(env.DB, "purchase_handled", "refunded", NOW_MS)).toBe(true);
    expect(await takeBack(env.DB, "purchase_never", "charged_back", NOW_MS)).toBe(true);

    // Taken back before it was ever handed over: the game never had it, so there's nothing to take back there.
    expect(await startRefundHandling(env.DB, "purchase_never", "player_ann", gameId, NOW_MS)).toBe(false);

    expect(await startRefundHandling(env.DB, "purchase_handled", "player_bo", gameId, NOW_MS)).toBe(false);
    expect(await startRefundHandling(env.DB, "purchase_handled", "player_ann", otherGameId, NOW_MS)).toBe(false);
    expect(await startRefundHandling(env.DB, "purchase_handled", "player_ann", gameId, NOW_MS)).toBe(true);
    expect(await startRefundHandling(env.DB, "purchase_handled", "player_ann", gameId, NOW_MS + HANDLING_LEASE_MS - 1)).toBe(false);
    // Its own lease: the purchase's first one is long done and doesn't count.
    expect(await startRefundHandling(env.DB, "purchase_handled", "player_ann", gameId, NOW_MS + HANDLING_LEASE_MS)).toBe(true);
    await releaseRefundHandling(env.DB, "purchase_handled");
    expect(await startRefundHandling(env.DB, "purchase_handled", "player_ann", gameId, NOW_MS + 1)).toBe(true);
    expect(await finishRefundHandling(env.DB, "purchase_handled", NOW_MS + 2)).toBe(true);
    expect(await finishRefundHandling(env.DB, "purchase_handled", NOW_MS + 3)).toBe(false);
    expect(await startRefundHandling(env.DB, "purchase_handled", "player_ann", gameId, NOW_MS + 10 * HANDLING_LEASE_MS)).toBe(false);
    expect(await purchaseById(env.DB, gameId, "purchase_handled")).toMatchObject({ purchase_status: "refunded", handled_at_ms: NOW_MS - 100, refund_handled_at_ms: NOW_MS + 2 });
  });

  it("doesn't tell a refund of a purchase that is still completed", async () => {
    await addPurchase("purchase_one", { handledAtMs: NOW_MS - 1 });
    expect(await finishRefundHandling(env.DB, "purchase_one", NOW_MS)).toBe(false);
    expect((await purchaseById(env.DB, gameId, "purchase_one"))!.refund_handled_at_ms).toBeNull();
  });

  it("lists a player's purchases to hand over, oldest first and ties by ID: completed ones not handled, and taken-back ones handled but not told", async () => {
    await addPurchase("purchase_c", { createdAtMs: NOW_MS + 30 });
    await addPurchase("purchase_b", { createdAtMs: NOW_MS + 20 });
    await addPurchase("purchase_a", { createdAtMs: NOW_MS + 20 });
    await addPurchase("purchase_refund_due", { purchaseStatus: "refunded", handledAtMs: NOW_MS, createdAtMs: NOW_MS + 10 });
    await addPurchase("purchase_chargeback_due", { purchaseStatus: "charged_back", handledAtMs: NOW_MS, createdAtMs: NOW_MS + 40 });
    // Not to hand over.
    await addPurchase("purchase_handled", { handledAtMs: NOW_MS, createdAtMs: NOW_MS });
    await addPurchase("purchase_told", { purchaseStatus: "refunded", handledAtMs: NOW_MS, refundHandledAtMs: NOW_MS + 1, createdAtMs: NOW_MS });
    await addPurchase("purchase_never_handed", { purchaseStatus: "refunded", createdAtMs: NOW_MS });
    await addPurchase("purchase_paying", { purchaseStatus: "pending", createdAtMs: NOW_MS });
    await addPurchase("purchase_failed", { purchaseStatus: "failed", createdAtMs: NOW_MS });
    await addPurchase("purchase_bo", { playerId: "player_bo" });
    await addPurchase("purchase_other_game", { gameId: otherGameId });
    expect((await unhandledFor(env.DB, gameId, "player_ann")).map((purchase) => purchase.id)).toEqual(["purchase_refund_due", "purchase_a", "purchase_b", "purchase_c", "purchase_chargeback_due"]);
    expect((await unhandledFor(env.DB, gameId, "player_bo")).map((purchase) => purchase.id)).toEqual(["purchase_bo"]);
    expect(await unhandledFor(env.DB, gameId, "player_cy")).toEqual([]);
    // A held lease doesn't hide one: startHandling decides that.
    await startHandling(env.DB, "purchase_a", "player_ann", gameId, NOW_MS);
    expect((await unhandledFor(env.DB, gameId, "player_ann")).map((purchase) => purchase.id)).toContain("purchase_a");
    // Handed over, it's gone from the list.
    await finishHandling(env.DB, "purchase_a", NOW_MS + 1);
    expect((await unhandledFor(env.DB, gameId, "player_ann")).map((purchase) => purchase.id)).not.toContain("purchase_a");
  });

  it("lists at most 50 at a time, the oldest, and the rest come once those are handled", async () => {
    expect(UNHANDLED_PAGE_COUNT).toBe(50);
    await env.DB.batch(Array.from({ length: 60 }, (_, i) => env.DB.prepare("INSERT INTO purchases (id, game_id, item_name, item_kind, player_id, purchase_source, purchase_status, created_at_ms) VALUES (?, ?, 'revive', 'consumable', 'player_ann', 'grant', 'completed', ?)").bind(`purchase_${String(i).padStart(2, "0")}`, gameId, NOW_MS + i)));
    const first = await unhandledFor(env.DB, gameId, "player_ann");
    expect(first).toHaveLength(50);
    expect(first[0]!.id).toBe("purchase_00");
    expect(first[49]!.id).toBe("purchase_49");
    for (const purchase of first) expect(await finishHandling(env.DB, purchase.id, NOW_MS + 100)).toBe(true);
    expect((await unhandledFor(env.DB, gameId, "player_ann")).map((purchase) => purchase.id)).toEqual(Array.from({ length: 10 }, (_, i) => `purchase_${50 + i}`));
  });
});
