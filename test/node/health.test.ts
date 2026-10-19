import { describe, expect, it } from "vitest";
import { HEALTH_ALERT_LIMITS, isErrorSpike, nextHealthAlertAction } from "@zaisma/core";

/** packages/core/src/health.ts: when Julius is told about a half-broken condition. */

const MINUTE_MS = 60_000;
const state = { startedAtMs: 0, lastToldAtMs: 0 };

describe("nextHealthAlertAction", () => {
  it("starts when it holds with no row, and does nothing when it doesn't", () => {
    expect(nextHealthAlertAction(null, true, 0)).toBe("start");
    expect(nextHealthAlertAction(null, false, 0)).toBe("none");
  });
  it("reminds only after the reminder interval since Julius was last told", () => {
    const intervalMs = HEALTH_ALERT_LIMITS.reminderIntervalMin * MINUTE_MS;
    expect(nextHealthAlertAction(state, true, intervalMs - 1)).toBe("none");
    expect(nextHealthAlertAction(state, true, intervalMs)).toBe("remind");
  });
  it("clears when the row exists and the condition is gone", () => {
    expect(nextHealthAlertAction(state, false, 5 * MINUTE_MS)).toBe("clear");
  });
});

describe("isErrorSpike", () => {
  it("needs both enough requests and over 5% failing", () => {
    expect(isErrorSpike(19, 19)).toBe(false);
    expect(isErrorSpike(20, 20)).toBe(true);
    expect(isErrorSpike(100, 5)).toBe(false);
    expect(isErrorSpike(100, 6)).toBe(true);
    expect(isErrorSpike(0, 0)).toBe(false);
  });
});
