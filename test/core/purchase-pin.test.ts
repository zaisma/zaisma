import { describe, expect, it } from "vitest";
import { PURCHASE_PIN_LIMITS, hashPurchasePin, isPurchasePin, purchasePinProblem } from "@zaisma/core";

// The purchase PIN (the Zaisma buy sheet): hashed like a password, exactly 6 digits.

describe("a purchase PIN", () => {
  it("hashes and checks, and a wrong PIN doesn't match", async () => {
    const stored = await hashPurchasePin("482913");
    expect(stored).toMatch(/^pbkdf2-sha256\$210000\$[\w-]+\$[\w-]+$/);
    expect(await isPurchasePin("482913", stored)).toBe(true);
    expect(await isPurchasePin("482914", stored)).toBe(false);
    expect(await hashPurchasePin("482913")).not.toBe(stored);
  });

  it("takes exactly 6 digits", () => {
    expect(purchasePinProblem("482913")).toBeNull();
    expect(purchasePinProblem("000000")).toBeNull();
    expect(PURCHASE_PIN_LIMITS.pinDigitCount).toBe(6);
  });

  it("refuses anything else with a plain sentence: a passphrase, 5 or 7 digits, letters among digits, spaces and a number", () => {
    for (const pin of ["correct horse battery", "48291", "4829137", "48291a", " 48291", "48 913", "", "٤٨٢٩١٣", 482913, null]) {
      expect(purchasePinProblem(pin)).toBe("A purchase PIN is 6 digits.");
    }
  });

  it("never matches a malformed stored hash", async () => {
    expect(await isPurchasePin("482913", "plain")).toBe(false);
    expect(await isPurchasePin("482913", "pbkdf2-sha256$0$aa$bb")).toBe(false);
  });
});
