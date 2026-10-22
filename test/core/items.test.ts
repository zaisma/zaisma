import { describe, expect, it } from "vitest";
import { ApiError, cardFeeNote, checkItem, checkPurchaseSettings, priceFor, priceText, purchaseLabelOf } from "@zaisma/core";

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
    const none = { refund_policy: null, refund_policy_text: null, own_payment_categories: [] };
    expect(refusal(() => checkPurchaseSettings({ own_payment_categories: ["currency"] }, none, false))).toEqual({ code: "refund_policy_needed", field: "refund_policy" });
    expect(checkPurchaseSettings({ refund_policy: "no_refunds", own_payment_categories: ["currency", "cosmetic"] }, none, false)).toEqual({ refund_policy: "no_refunds", refund_policy_text: null, own_payment_categories: ["cosmetic", "currency"] });
  });
});
