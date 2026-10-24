import { describe, expect, it } from "vitest";
import { PLAN_LIMITS, REVIEW_LIMITS, PRO_PRICE_CENTS_PER_MONTH, checkUploadList, dailyReviewMeaning, planOf, withProSize } from "@zaisma/core";

describe("a developer's plan", () => {
  it("is Pro until the end of the period Stripe said was paid, then free", () => {
    expect(planOf({ pro_until_ms: null }, 1000)).toBe("free");
    expect(planOf({ pro_until_ms: 2000 }, 1000)).toBe("pro");
    expect(planOf({ pro_until_ms: 2000 }, 2000)).toBe("free");
    expect(planOf({ pro_until_ms: 2000 }, 3000)).toBe("free");
  });

  it("keeps the free daily review limits in review-evidence.ts the same as PLAN_LIMITS.free (that file can't change without a paid review-set run, and nothing reads them)", () => {
    expect(REVIEW_LIMITS.maximumLargeReviewsPerDay).toBe(PLAN_LIMITS.free.maximumLargeReviewsPerDay);
    expect(REVIEW_LIMITS.maximumSmallReviewsPerDay).toBe(PLAN_LIMITS.free.maximumSmallReviewsPerDay);
  });

  it("has the limits Pro was priced with", () => {
    expect(PRO_PRICE_CENTS_PER_MONTH).toBe(1000);
    expect(PLAN_LIMITS.free).toEqual({ maximumLargeReviewsPerDay: 5, maximumSmallReviewsPerDay: 30, maximumDailyCheckCount: 20, maximumVersionsPerDay: 20, maximumGameSizeBytes: 2 * 1024 ** 3 });
    expect(PLAN_LIMITS.pro).toEqual({ maximumLargeReviewsPerDay: 20, maximumSmallReviewsPerDay: 100, maximumDailyCheckCount: 60, maximumVersionsPerDay: 100, maximumGameSizeBytes: 10 * 1024 ** 3 });
  });

  it("mentions Pro once, only to a developer who doesn't have it", () => {
    expect(dailyReviewMeaning("daily_large_reviews_used", "free")).toContain("5 large reviews");
    expect(dailyReviewMeaning("daily_large_reviews_used", "free")).toContain("Zaisma Pro has 20 large reviews a day.");
    expect(dailyReviewMeaning("daily_small_reviews_used", "pro")).toContain("100 small reviews");
    expect(dailyReviewMeaning("daily_small_reviews_used", "pro")).not.toContain("Zaisma Pro");
    expect(withProSize("free")).toBe("2 GB (10 GB with Zaisma Pro)");
    expect(withProSize("pro")).toBe("10 GB");
  });

  it("checks a game's size against the plan, saying Pro's size on the free plan", () => {
    const hash = "a".repeat(64);
    const filesOf = (count: number) => [{ path: "index.html", sha256: hash, size_bytes: 1 }, ...Array.from({ length: count }, (_, i) => ({ path: `data${i}.json`, sha256: hash, size_bytes: 450 * 1024 ** 2 }))];
    expect(() => checkUploadList(filesOf(7))).toThrow(/the limit is 2 GB \(10 GB with Zaisma Pro\)/);
    expect(checkUploadList(filesOf(7), "pro")).toHaveLength(8);
    expect(checkUploadList(filesOf(22), "pro")).toHaveLength(23);
    expect(() => checkUploadList(filesOf(25), "pro")).toThrow(/the limit is 10 GB\./);
  });
});
