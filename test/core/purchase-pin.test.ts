import { describe, expect, it } from "vitest";
import { PURCHASE_PIN_LIMITS, hashPurchasePin, isPurchasePin, purchasePinProblem } from "@zaisma/core";

// The purchase PIN (the Zaisma buy sheet): hashed like a password, 6+ digits or a passphrase.

describe("a purchase PIN", () => {
  it("hashes and checks, and a wrong PIN doesn't match", async () => {
    const stored = await hashPurchasePin("482913");
    expect(stored).toMatch(/^pbkdf2-sha256\$210000\$[\w-]+\$[\w-]+$/);
    expect(await isPurchasePin("482913", stored)).toBe(true);
    expect(await isPurchasePin("482914", stored)).toBe(false);
    expect(await hashPurchasePin("482913")).not.toBe(stored);
  });

  it("takes a passphrase", async () => {
    expect(purchasePinProblem("correct horse battery")).toBeNull();
    expect(await isPurchasePin("correct horse battery", await hashPurchasePin("correct horse battery"))).toBe(true);
  });

  it("refuses a 5-character PIN, one that isn't text and one over 64 characters", () => {
    expect(purchasePinProblem("48291")).toMatch(/at least 6/);
    expect(purchasePinProblem(482913)).toMatch(/must be text/);
    expect(purchasePinProblem("x".repeat(PURCHASE_PIN_LIMITS.maximumPinLength + 1))).toMatch(/at most 64/);
    expect(purchasePinProblem("482913")).toBeNull();
  });

  it("never matches a malformed stored hash", async () => {
    expect(await isPurchasePin("482913", "plain")).toBe(false);
    expect(await isPurchasePin("482913", "pbkdf2-sha256$0$aa$bb")).toBe(false);
  });
});
