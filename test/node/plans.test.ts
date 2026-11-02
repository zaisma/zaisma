import { describe, expect, it } from "vitest";
import { FILE_LIMITS, PLAN_LIMITS, REVIEW_LIMITS, PRO_PRICE_CENTS_PER_MONTH, STORAGE_ALLOWANCES, STORAGE_PRICE_PER_GIGABYTE_MONTH_CENTS, boughtSizeBytes, checkUploadList, dailyReviewMeaning, planOf, storageDayCents, storageSizeText } from "@zaisma/core";

describe("a developer's plan", () => {
  it("is Pro until the end of the period Stripe said was paid, then free", () => {
    expect(planOf({ pro_until_ms: null }, 1000)).toBe("free");
    expect(planOf({ pro_until_ms: 2000 }, 1000)).toBe("pro");
    expect(planOf({ pro_until_ms: 2000 }, 2000)).toBe("free");
    expect(planOf({ pro_until_ms: 2000 }, 3000)).toBe("free");
  });

  it("says the same review numbers as review-evidence.ts, where every developer's limits are", () => {
    expect(dailyReviewMeaning("daily_large_reviews_used")).toContain(`${REVIEW_LIMITS.maximumLargeReviewsPerDay} large reviews`);
    expect(dailyReviewMeaning("daily_small_reviews_used")).toContain(`${REVIEW_LIMITS.maximumSmallReviewsPerDay} small reviews`);
    expect(dailyReviewMeaning("daily_small_reviews_used")).not.toContain("Pro");
  });

  it("sells what the calls say, at the price they say", () => {
    const gb = 1024 ** 3;
    expect(PRO_PRICE_CENTS_PER_MONTH).toBe(1000);
    expect(PLAN_LIMITS.free).toEqual({ maximumDailyCheckCount: 20 });
    expect(PLAN_LIMITS.pro).toEqual({ maximumDailyCheckCount: 60 });
    expect(FILE_LIMITS.maximumVersionsPerDay).toBe(100);
    expect(STORAGE_ALLOWANCES.new).toEqual({ includedSizeBytes: 10 * gb, maximumNewDataSizeBytes: 10 * gb });
    expect(STORAGE_ALLOWANCES.established).toEqual({ includedSizeBytes: 50 * gb, maximumNewDataSizeBytes: 25 * gb });
    expect(STORAGE_ALLOWANCES.paid_by_card).toEqual(STORAGE_ALLOWANCES.established);
    expect(STORAGE_ALLOWANCES.pro).toEqual({ includedSizeBytes: 500 * gb, maximumNewDataSizeBytes: 100 * gb });
  });

  it("never prices stored data under twice what it costs Zaisma, about 3 cents per GB a month", () => {
    expect(STORAGE_PRICE_PER_GIGABYTE_MONTH_CENTS).toBeGreaterThanOrEqual(2 * 3);
  });

  it("buys room with the smaller of the budget and the balance", () => {
    const gb = 1024 ** 3;
    expect(boughtSizeBytes(null, 5000)).toBe(0);
    expect(boughtSizeBytes(1200, 5000)).toBe(100 * gb);
    expect(boughtSizeBytes(5000, 120)).toBe(10 * gb);
    expect(boughtSizeBytes(5000, 0)).toBe(0);
  });

  it("shares a month's price over the month's days", () => {
    expect(storageDayCents(30 * 1024 ** 3, Date.UTC(2026, 10, 2))).toBeCloseTo(12); // 30 GB at 12 cents, a 30-day month, a day.
    expect(storageSizeText(1.5 * 1024 ** 3)).toBe("1.5 GB");
    expect(storageSizeText(640 * 1024 ** 2)).toBe("640 MB");
  });

  it("takes a game of any size: only a file's size and the file count have limits", () => {
    const hash = "a".repeat(64);
    const files = [{ path: "index.html", sha256: hash, size_bytes: 1 }, ...Array.from({ length: 200 }, (_, i) => ({ path: `data${i}.json`, sha256: hash, size_bytes: FILE_LIMITS.maximumFileSizeBytes }))];
    expect(checkUploadList(files)).toHaveLength(201);
  });
});
