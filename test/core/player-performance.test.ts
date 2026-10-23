import { describe, expect, it } from "vitest";
import { FRAME_RATE_BUCKETS, LOADING_BUCKETS_SEC, browserOf, countsWithin, frameRateAt, osOf, percentileOf, playerPerformanceRow, readPlayPerformanceReport, type PerformanceDay } from "@zaisma/core";

const USER_AGENTS = {
  chromeWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  edgeWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.2792.52",
  firefoxLinux: "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  safariIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  chromeIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1",
  samsungAndroid: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  chromeAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  chromeOs: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  operaWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 OPR/114.0.0.0",
};

describe("browser and system from a user agent", () => {
  it("reads real browsers", () => {
    expect(Object.fromEntries(Object.entries(USER_AGENTS).map(([name, userAgent]) => [name, [browserOf(userAgent), osOf(userAgent)]]))).toEqual({
      chromeWindows: ["chrome", "windows"],
      edgeWindows: ["edge", "windows"],
      firefoxLinux: ["firefox", "linux"],
      safariMac: ["safari", "macos"],
      safariIphone: ["safari", "ios"],
      chromeIphone: ["chrome", "ios"],
      samsungAndroid: ["samsung_internet", "android"],
      chromeAndroid: ["chrome", "android"],
      chromeOs: ["chrome", "chromeos"],
      operaWindows: ["other", "windows"],
    });
    expect([browserOf(""), osOf("")]).toEqual(["other", "other"]);
  });
});

describe("percentiles from buckets", () => {
  it("interpolates inside a bucket, and gives an open last bucket its lower edge", () => {
    // 10 loads under 2 s, 10 from 2 to 5 s: the median is the 2 s edge, the slow tenth 4.4 s.
    expect(percentileOf(LOADING_BUCKETS_SEC, [10, 10, 0, 0, 0, 0, 0], 0.5)).toBe(2);
    expect(percentileOf(LOADING_BUCKETS_SEC, [10, 10, 0, 0, 0, 0, 0], 0.9)).toBeCloseTo(4.4);
    expect(percentileOf(LOADING_BUCKETS_SEC, [0, 0, 0, 0, 0, 0, 4], 0.5)).toBe(80);
    expect(percentileOf(LOADING_BUCKETS_SEC, [0, 0, 0, 0, 0, 0, 0], 0.5)).toBeNull();
  });

  it("gives frame rates the band they're in, since they gather at refresh rates", () => {
    const steadySixty = FRAME_RATE_BUCKETS.map(() => 0).concat(0);
    steadySixty[5] = 600;
    expect(frameRateAt(steadySixty, 0.5)).toBe(60);
    expect(frameRateAt(steadySixty, 0.1)).toBe(60);
    // Mostly 30, a tenth below 15.
    expect(frameRateAt([10, 0, 0, 90, 0, 0, 0, 0], 0.5)).toBe(30);
    expect(frameRateAt([10, 0, 0, 90, 0, 0, 0, 0], 0.05)).toBe(7.5);
  });

  it("adds days up into a row", () => {
    const day = (fields: Partial<PerformanceDay>): PerformanceDay => ({
      version_id: "version_a", browser_name: "chrome", os_name: "windows", device_kind: "computer", graphics_family: "intel", play_count: 0,
      loading_counts: [], frame_rate_seconds: [], long_frame_count: 0, measured_duration_sec: 0, error_stop_count: 0, context_lost_count: 0, stopped_responding_count: 0, memory_counts: [], ...fields,
    });
    const row = playerPerformanceRow([
      day({ play_count: 10, loading_counts: [0, 0, 10, 0, 0, 0, 0], frame_rate_seconds: [0, 0, 0, 600, 0, 0, 0, 0], measured_duration_sec: 600, long_frame_count: 30, error_stop_count: 1 }),
      day({ play_count: 10, loading_counts: [0, 0, 0, 10, 0, 0, 0], memory_counts: [0, 20, 0, 0, 0, 0], context_lost_count: 1 }),
    ]);
    expect(row).toEqual({
      play_count: 20,
      median_loading_duration_sec: 10,
      slow_tenth_loading_duration_sec: 18,
      median_frames_per_sec: 30,
      low_tenth_frames_per_sec: 30,
      long_frames_per_min: 3,
      crashed_play_pct: 10,
      error_stop_count: 1,
      context_lost_count: 1,
      stopped_responding_count: 0,
      median_peak_memory_size_bytes: 384 * 1024 ** 2,
      is_measured: true,
    });
    expect(playerPerformanceRow([day({ play_count: 3 })])).toMatchObject({ median_frames_per_sec: null, long_frames_per_min: null, median_loading_duration_sec: null, is_measured: false });
  });
});

describe("a game page's report, as the server reads it", () => {
  it("folds unknown choices into other and clamps every number", () => {
    expect(
      readPlayPerformanceReport({
        device_kind: "phone",
        graphics_family: "voodoo",
        version_id: "version_abc",
        loading_duration_sec: 1e9,
        frame_rate_seconds: [5, -3, "x", 1e9],
        long_frame_count: -1,
        measured_duration_sec: 30.4,
        crash_kind_counts: { stopped_responding: 2, context_lost: 1, made_up: 4 },
        peak_memory_size_bytes: 1e15,
      }),
    ).toEqual({
      version_id: "version_abc",
      device_kind: "phone",
      graphics_family: "other",
      loading_duration_sec: 3600,
      frame_rate_seconds: [5, 0, 0, 10_000, 0, 0, 0, 0],
      long_frame_count: 0,
      measured_duration_sec: 30,
      crash_kind: "context_lost",
      peak_memory_size_bytes: 64 * 1024 ** 3,
    });
    expect(readPlayPerformanceReport({ device_kind: "computer", graphics_family: null })).toMatchObject({ graphics_family: "unknown", loading_duration_sec: null, crash_kind: null });
    expect(readPlayPerformanceReport({ device_kind: "toaster" })).toBeNull();
    expect(readPlayPerformanceReport("lots")).toBeNull();
  });

  it("scales counts down to a total", () => {
    expect(countsWithin([10, 30], 20)).toEqual([5, 15]);
    expect(countsWithin([10, 30], 50)).toEqual([10, 30]);
  });
});
