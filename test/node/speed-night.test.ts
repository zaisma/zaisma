import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain JavaScript script without types
import { SLOWER_MS, median, slowerPages } from "../../scripts/speed-night.mjs";
// @ts-expect-error: a plain JavaScript script without types
import { SLOW_3G_LINE, SlowLine } from "../../scripts/slow-connection-proxy.mjs";

const night = (firstPaintMs: number | null) => ({ date: "2026-10-30", first_paint_ms_by_page: { "chrome /": firstPaintMs } });

describe("the nightly Slow 3G run", () => {
  it("flags a page past its last week's median by a fifth and by 300 ms, and never one with no history", () => {
    const week = [3000, 3100, 2900, 3050, 3000, 2950, 3020].map(night);
    expect(slowerPages(week, { "chrome /": 3700 })).toEqual([{ key: "chrome /", first_paint_ms: 3700, usual_ms: 3000 }]);
    // A fifth more but under 300 ms is noise on a fast page.
    expect(slowerPages([1000, 1000, 1000].map(night), { "chrome /": 1250 })).toEqual([]);
    expect(slowerPages([1000, 1000, 1000].map(night), { "chrome /": 1000 + SLOWER_MS + 1 })).toHaveLength(1);
    expect(slowerPages([], { "chrome /": 9000 })).toEqual([]);
    expect(slowerPages(week, { "chrome /": null })).toEqual([]);
  });

  it("takes the middle time of three opens, leaving out one that didn't paint", () => {
    expect(median([4100, null, 3900, 9000])).toBe(4100);
    expect(median([null])).toBeNull();
  });
});

describe("the slow line", () => {
  it("delivers a chunk a second after the bytes before it have gone at 50 KB a second, shared and in order", () => {
    let nowMs = 0;
    const delivered: [string, number][] = [];
    const pending: [() => void, number][] = [];
    const line = new SlowLine(SLOW_3G_LINE, { nowMs: () => nowMs, wait: (work: () => void, delayMs: number) => pending.push([work, nowMs + delayMs]) });
    line.send(Buffer.alloc(51_200), () => delivered.push(["first", nowMs]));
    line.send(Buffer.alloc(51_200), () => delivered.push(["second", nowMs]));
    for (const [work, atMs] of pending.sort((a, b) => a[1] - b[1])) { nowMs = atMs; work(); }
    expect(delivered).toEqual([["first", 2000], ["second", 3000]]);
  });
});
