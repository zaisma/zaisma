import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FREE_HOSTING_CENTS_PER_MONTH, HOSTING_PRICES, HOSTING_USE_FACTS, OUTSIDE_CALL_CPU_DURATION_MS, freeUsedPct, hostingCostCents, hostingShares, noHostingUse, type HostingUse } from "../../packages/core/src/hosting.ts";
import { AWAKE_TAIL_MS, AwakeTime } from "../../apps/rooms/src/usage-counts.ts";

// The one hosting meter (packages/core/src/hosting.ts): every charge Cloudflare bills Zaisma for a game, in cents,
// against one free allowance a month. Each price keeps a margin over what Cloudflare charges for it
// (cloudflare-prices.json, with its source), and every count the meter keeps is priced, so nothing slips in free.

const use = (part: Partial<HostingUse>): HostingUse => ({ ...noHostingUse(), ...part });
const HOUR_SEC = 3600;
const CLOUDFLARE_PRICES = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "cloudflare-prices.json"), "utf8")) as Record<string, { cloudflare_cents: number; what: string; source_url: string }>;

/** An hour of an 8-player real-time room at 60 ticks: awake all hour, 20 messages a second a player, about 1 ms of CPU a tick, a check every 30 seconds. */
const realTimeRoomHour = (roomHourCount: number): Partial<HostingUse> => ({
  roomAwakeDurationSec: roomHourCount * HOUR_SEC,
  inboundMessageCount: roomHourCount * 8 * 20 * HOUR_SEC,
  roomCpuDurationMs: roomHourCount * 60 * HOUR_SEC,
  roomConnectionCount: roomHourCount * 8,
  objectRequestCount: roomHourCount * 120,
  gameServerSessionCount: roomHourCount,
  roomPlayDurationSec: roomHourCount * 8 * HOUR_SEC,
});

/** An hour of a 4-player turn-based room: a move every 20 seconds, awake two-thirds of the hour between moves and its checks. */
const turnBasedRoomHour = (roomHourCount: number): Partial<HostingUse> => ({
  roomAwakeDurationSec: roomHourCount * 2400,
  inboundMessageCount: roomHourCount * 180,
  roomCpuDurationMs: roomHourCount * 180 * 5,
  roomConnectionCount: roomHourCount * 4,
  objectRequestCount: roomHourCount * 120,
  gameServerSessionCount: roomHourCount,
  roomPlayDurationSec: roomHourCount * 4 * HOUR_SEC,
});

describe("the hosting meter", () => {
  it("keeps a margin of at least twice Cloudflare's price on every line", () => {
    expect(Object.keys(CLOUDFLARE_PRICES).sort()).toEqual(Object.keys(HOSTING_PRICES).sort());
    for (const [name, priceCents] of Object.entries(HOSTING_PRICES)) {
      const cloudflare = CLOUDFLARE_PRICES[name]!;
      expect(cloudflare.source_url, name).toMatch(/^https:\/\/developers\.cloudflare\.com\//);
      expect(priceCents, `${name}: ${cloudflare.what}`).toBeGreaterThanOrEqual(2 * cloudflare.cloudflare_cents - 1e-15);
    }
  });

  it("prices every count it keeps, so a new one can't slip in free", () => {
    for (const key of Object.keys(noHostingUse()) as (keyof HostingUse)[]) {
      const cents = hostingCostCents(use({ [key]: 1_000_000 })).totalCents;
      if ((HOSTING_USE_FACTS as readonly string[]).includes(key)) expect(cents, key).toBe(0);
      else expect(cents, key).toBeGreaterThan(0);
    }
  });

  it("prices each count at its price, in its kind", () => {
    const prices = HOSTING_PRICES;
    expect(hostingCostCents(use({ roomAwakeDurationSec: HOUR_SEC })).kinds.rooms).toBeCloseTo(HOUR_SEC * prices.awakeCentsPerSec, 9);
    expect(hostingCostCents(use({ inboundMessageCount: 1_000_000 })).kinds.rooms).toBeCloseTo(1_000_000 * prices.inboundMessageCentsPerMessage, 9);
    expect(hostingCostCents(use({ roomConnectionCount: 1000, objectRequestCount: 1000, bookkeepingWrittenRowCount: 1000 })).kinds.rooms).toBeCloseTo(1000 * (prices.roomConnectionCentsPerConnection + prices.objectRequestCentsPerRequest + prices.writtenRowCentsPerRow), 9);
    // CPU wherever it runs, starting up included, and 1 ms for each outside call.
    expect(hostingCostCents(use({ roomCpuDurationMs: 1000, outsideRoomCpuDurationMs: 1000, startupCpuDurationMs: 1000, outsideCallCount: 1000 })).kinds.game_server).toBeCloseTo((3 + OUTSIDE_CALL_CPU_DURATION_MS) * prices.gameServerCpuCentsPerSec, 9);
    expect(hostingCostCents(use({ gameServerSessionCount: 1000, loadedVersionCount: 2, logFileCount: 1000 })).kinds.game_server).toBeCloseTo(1000 * prices.gameServerSessionCentsPerSession + 2 * prices.loadedVersionCentsPerDay + 1000 * prices.logFileCentsPerFile, 9);
    expect(hostingCostCents(use({ relayedSizeBytes: 1e9 })).kinds.relayed_data).toBeCloseTo(1e9 * prices.relayedCentsPerByte, 9);
    expect(hostingCostCents(use({ writtenRowCount: 1e6, readRowCount: 1e9, monthStoredSizeBytes: 1e9, databaseCallCount: 1e6, databaseAwakeDurationSec: HOUR_SEC })).kinds.database).toBeCloseTo(
      1e6 * prices.writtenRowCentsPerRow + 1e9 * prices.readRowCentsPerRow + 1e9 * prices.storedCentsPerByteMonth + 1e6 * prices.databaseCallCentsPerCall + HOUR_SEC * prices.awakeCentsPerSec,
      6,
    );
    // A schedule's run and a webhook event are requests; the object's awake time goes with them.
    expect(hostingCostCents(use({ requestCount: 1000, scheduledRunCount: 1000, objectAwakeDurationSec: HOUR_SEC })).kinds.requests).toBeCloseTo(2000 * prices.requestCentsPerRequest + HOUR_SEC * prices.awakeCentsPerSec, 9);
    // Player time is a fact, never priced.
    expect(hostingCostCents(use({ roomPlayDurationSec: 1000 * HOUR_SEC })).totalCents).toBe(0);
  });

  it("covers the free examples the docs give", () => {
    // 8 friends playing a real-time game 2 hours every night: about a third.
    expect(freeUsedPct(hostingCostCents(use(realTimeRoomHour(2 * 30))).totalCents)).toBeGreaterThanOrEqual(30);
    expect(freeUsedPct(hostingCostCents(use(realTimeRoomHour(2 * 30))).totalCents)).toBeLessThan(40);
    // About 1,300 player-hours of an 8-player real-time game at 60 ticks.
    expect(hostingCostCents(use(realTimeRoomHour(1300 / 8))).totalCents).toBeLessThanOrEqual(FREE_HOSTING_CENTS_PER_MONTH);
    // About 2,500 player-hours of a 4-player turn-based game.
    expect(hostingCostCents(use(turnBasedRoomHour(2500 / 4))).totalCents).toBeLessThanOrEqual(FREE_HOSTING_CENTS_PER_MONTH);
  });

  it("shares what used it in whole percent adding to 100, biggest first", () => {
    const month = hostingCostCents(use({ roomAwakeDurationSec: 100 * HOUR_SEC, requestCount: 1_000_000, writtenRowCount: 100_000 }));
    const shares = hostingShares(month.kinds);
    expect(shares.reduce((sumPct, share) => sumPct + share.sharePct, 0)).toBe(100);
    expect(shares.map((share) => share.kind)).toEqual(["rooms", "requests", "database"]);
    expect(hostingShares(hostingCostCents(noHostingUse()).kinds)).toEqual([]);
    // A relay-heavy game is all relay.
    expect(hostingShares(hostingCostCents(use({ relayedSizeBytes: 50_000_000_000 })).kinds)).toEqual([{ kind: "relayed_data", sharePct: 100 }]);
  });
});

describe("an object's awake time", () => {
  it("counts each event and the 10 seconds after it, once where they overlap", () => {
    const awake = new AwakeTime();
    // A ticking room: an event every 16 ms for a minute is the minute, plus the tail after the last tick.
    let addedMs = 0;
    for (let atMs = 0; atMs <= 60_000; atMs += 16) addedMs += awake.note(atMs);
    expect(addedMs).toBe(60_000 - (60_000 % 16) + AWAKE_TAIL_MS);
    // A turn-based room asleep between moves a minute apart: 10 seconds each.
    const sleepy = new AwakeTime();
    expect([0, 60_000, 120_000].map((atMs) => sleepy.note(atMs))).toEqual([AWAKE_TAIL_MS, AWAKE_TAIL_MS, AWAKE_TAIL_MS]);
    // Two moves 4 seconds apart: 14 seconds.
    const close = new AwakeTime();
    expect(close.note(0) + close.note(4000)).toBe(14_000);
    // A call in flight for 30 seconds: all of it and the tail, even noted only at its end.
    expect(new AwakeTime().note(0, 30_000)).toBe(40_000);
  });
});
