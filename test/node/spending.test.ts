import { describe, expect, it } from "vitest";
import { STORED_PER_BYTE_MONTH_CENTS, earnedAfterCardFeeCents, newSpendingAlertPcts, spendingMonthOf, spendingSettingsOf, type SpendingFacts } from "../../packages/core/src/spending.ts";
import { FREE_HOSTING_CENTS_PER_MONTH, freeAllowanceCents, freeHostingEndCents, freeUsedPct } from "../../packages/core/src/hosting.ts";

// Zaisma's own month (packages/core/src/spending.ts) and the one-time grace on the free allowance (hosting.ts).

// Made-up amounts: the real ones are the site Worker's secrets.
const SETTINGS = { monthlyLimitCents: 20000, fixedCostCents: 6000, storageAndChecksCostCents: 2000, meterCostSharePct: 50 };
const NO_FACTS: SpendingFacts = { reviewCostCents: 0, aiInputTokenCount: 0, aiOutputTokenCount: 0, aiModel: "claude-haiku-5-5", storedSizeBytes: 0, performanceCheckCount: 0, unpaidMeterCents: 0, lastMonthHostingChargedCents: 0, lastMonthStorageChargedCents: 0, lastMonthEarningsCents: 0 };
const month = (facts: Partial<SpendingFacts>) => spendingMonthOf(SETTINGS, { ...NO_FACTS, ...facts });

describe("what a month spends and may", () => {
  it("counts fixed costs and the storage line whole from the 1st", () => {
    expect(month({})).toMatchObject({ spentCents: 8000, limitCents: 20000, earnedLastMonthCents: 0 });
  });

  it("counts the storage line as measured only when that's higher", () => {
    expect(month({ storedSizeBytes: 100 * 1024 ** 3 }).storageAndChecksCostCents).toBe(2000);
    const big = Math.floor(4000 / STORED_PER_BYTE_MONTH_CENTS);
    expect(month({ storedSizeBytes: big }).storageAndChecksCostCents).toBe(4000);
    expect(month({ storedSizeBytes: big, performanceCheckCount: 100 }).storageAndChecksCostCents).toBe(4015);
  });

  it("counts the meter's unpaid part at what it costs, and reviews and tokens as AI", () => {
    expect(month({ unpaidMeterCents: 1000 }).freeHostingCostCents).toBe(500);
    expect(month({ reviewCostCents: 1234.5 }).aiCostCents).toBe(1235);
    expect(month({ aiInputTokenCount: 1_000_000, aiOutputTokenCount: 1_000_000 }).aiCostCents).toBe(60);
  });

  it("grows the limit by what's left after costs: credit less what it cost to serve, storage charges and earnings whole", () => {
    const grown = month({ lastMonthHostingChargedCents: 10000, lastMonthStorageChargedCents: 500, lastMonthEarningsCents: 941 });
    expect(grown.earnedLastMonthCents).toBe(5000 + 500 + 941);
    expect(grown.limitCents).toBe(20000 + 6441);
  });

  it("never lets refunds shrink the limit below the month's own", () => {
    expect(month({ lastMonthEarningsCents: -941 }).limitCents).toBe(20000);
  });

  it("takes the card fee off a payment", () => {
    expect(earnedAfterCardFeeCents(1000)).toBe(941);
    expect(earnedAfterCardFeeCents(10)).toBe(0);
  });

  it("names the alerts passed since the last one told", () => {
    expect(newSpendingAlertPcts({ spentCents: 27999, limitCents: 40000 }, 0)).toEqual([]);
    expect(newSpendingAlertPcts({ spentCents: 28000, limitCents: 40000 }, 0)).toEqual([70]);
    expect(newSpendingAlertPcts({ spentCents: 28000, limitCents: 40000 }, 70)).toEqual([]);
    expect(newSpendingAlertPcts({ spentCents: 34400, limitCents: 40000 }, 0)).toEqual([70, 85]);
    expect(newSpendingAlertPcts({ spentCents: 40000, limitCents: 40000 }, 85)).toEqual([100]);
    // The shares follow the limit as it grows with earnings.
    expect(newSpendingAlertPcts({ spentCents: 28000, limitCents: 80000 }, 0)).toEqual([]);
  });

  it("has no settings until all four are numbers above zero", () => {
    const secrets = { MONTHLY_SPENDING_LIMIT_CENTS: "20000", FIXED_COST_CENTS_PER_MONTH: "6000", STORAGE_AND_CHECKS_COST_CENTS_PER_MONTH: "2000", METER_COST_SHARE_PCT: "50" };
    expect(spendingSettingsOf(secrets)).toEqual(SETTINGS);
    expect(spendingSettingsOf({ ...secrets, METER_COST_SHARE_PCT: undefined })).toBeNull();
    expect(spendingSettingsOf({ ...secrets, MONTHLY_SPENDING_LIMIT_CENTS: "lots" })).toBeNull();
    expect(spendingSettingsOf({ ...secrets, FIXED_COST_CENTS_PER_MONTH: "0" })).toBeNull();
  });
});

describe("the one-time grace", () => {
  const THIS_MONTH = "2026-11-01";
  it("doubles the allowance only in the month it was given", () => {
    expect(freeAllowanceCents(null, THIS_MONTH)).toBe(FREE_HOSTING_CENTS_PER_MONTH);
    expect(freeAllowanceCents(THIS_MONTH, THIS_MONTH)).toBe(2 * FREE_HOSTING_CENTS_PER_MONTH);
    expect(freeAllowanceCents("2026-10-01", THIS_MONTH)).toBe(FREE_HOSTING_CENTS_PER_MONTH);
  });

  it("ends free hosting past the second allowance while it's still to come", () => {
    expect(freeHostingEndCents(null, THIS_MONTH)).toBe(2 * FREE_HOSTING_CENTS_PER_MONTH);
    expect(freeHostingEndCents(THIS_MONTH, THIS_MONTH)).toBe(2 * FREE_HOSTING_CENTS_PER_MONTH);
    expect(freeHostingEndCents("2026-10-01", THIS_MONTH)).toBe(FREE_HOSTING_CENTS_PER_MONTH);
  });

  it("measures the percentage against the month's allowance", () => {
    expect(freeUsedPct(1000)).toBe(100);
    expect(freeUsedPct(1000, 2000)).toBe(50);
  });
});
