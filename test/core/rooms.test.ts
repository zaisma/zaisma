import { describe, expect, it } from "vitest";
import { countedPlayDurationSec } from "@zaisma/core";

// The player-hour meter (packages/core/src/rooms.ts): room time, relayed data and game server CPU.

const HOUR_SEC = 3600;

describe("counted player-hours", () => {
  it("include 25 CPU-seconds each, and count every 50 past them as one more", () => {
    // 8 player-hours include 200 CPU-seconds: 160 adds nothing.
    expect(countedPlayDurationSec(8 * HOUR_SEC, 0, 160_000) / HOUR_SEC).toBe(8);
    // 4 player-hours include 100: 1,300 is 1,200 past them, 24 more.
    expect(countedPlayDurationSec(4 * HOUR_SEC, 0, 1_300_000) / HOUR_SEC).toBe(28);
    // Relayed data still adds on top: 20 MB is one.
    expect(countedPlayDurationSec(4 * HOUR_SEC, 40_000_000, 1_300_000) / HOUR_SEC).toBe(30);
    // CPU with no player time at all (a room nobody stayed in) counts from the first CPU-second.
    expect(countedPlayDurationSec(0, 0, 50_000) / HOUR_SEC).toBe(1);
  });
});
