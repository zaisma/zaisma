import { describe, expect, it } from "vitest";
import { FREE_HOSTING_CENTS_PER_MONTH, freeUsedPct, hostingCostCents, hostingShares, type HostingUse } from "../../packages/core/src/hosting.ts";

// The one hosting meter (packages/core/src/hosting.ts): everything a game runs on Zaisma's servers in cents, at
// twice Cloudflare's cost, against one free allowance a month. The examples are the decision's own.

const NOTHING: HostingUse = { roomPlayDurationSec: 0, relayedSizeBytes: 0, roomCpuDurationMs: 0, outsideRoomCpuDurationMs: 0, requestCount: 0, scheduledRunCount: 0, writtenRowCount: 0, readRowCount: 0, monthStoredSizeBytes: 0, databaseSizeBytes: 0, adultChatCheckCount: 0 };
const use = (part: Partial<HostingUse>): HostingUse => ({ ...NOTHING, ...part });
const HOUR_SEC = 3600;

describe("the hosting meter", () => {
  it("gives a rooms-only game about 2,500 player-hours free", () => {
    const month = hostingCostCents(use({ roomPlayDurationSec: 2500 * HOUR_SEC }));
    expect(month.totalCents).toBeCloseTo(FREE_HOSTING_CENTS_PER_MONTH, 6);
    expect(freeUsedPct(month.totalCents)).toBe(100);
    expect(freeUsedPct(hostingCostCents(use({ roomPlayDurationSec: 1550 * HOUR_SEC })).totalCents)).toBe(62);
  });

  it("charges game server CPU only past the 25 CPU-seconds each player-hour includes", () => {
    // A light 8-player arena at 30 ticks: about 160 CPU-seconds an hour, inside the 200 its 8 player-hours include.
    expect(hostingCostCents(use({ roomPlayDurationSec: 8 * HOUR_SEC, roomCpuDurationMs: 160_000 })).kinds.game_server_cpu).toBe(0);
    // A 100-player battle royale at 60 ticks: about 2,200 CPU-seconds, inside the 2,500 included.
    expect(hostingCostCents(use({ roomPlayDurationSec: 100 * HOUR_SEC, roomCpuDurationMs: 2_200_000 })).kinds.game_server_cpu).toBe(0);
    // A 4-player physics co-op at 60 ticks: 1,300 CPU-seconds, 1,200 past the 100 included, so about 28 player-hours' worth an hour instead of 4.
    const coOp = hostingCostCents(use({ roomPlayDurationSec: 4 * HOUR_SEC, roomCpuDurationMs: 1_300_000 }));
    expect(coOp.kinds.game_server_cpu).toBeCloseTo(4.8, 6);
    expect(coOp.totalCents / 0.2).toBeCloseTo(28, 6);
  });

  it("counts every 20 MB through the relay like a player-hour", () => {
    expect(hostingCostCents(use({ relayedSizeBytes: 20_000_000 })).kinds.relayed_data).toBeCloseTo(0.2, 9);
    // A relay-heavy game: 8 players all connected to each other, 2.5 TB a month, is the whole allowance on the relay alone.
    const relayHeavy = hostingCostCents(use({ roomPlayDurationSec: 0, relayedSizeBytes: 50_000_000_000 }));
    expect(freeUsedPct(relayHeavy.totalCents)).toBe(100);
    expect(hostingShares(relayHeavy.kinds)).toEqual([{ kind: "relayed_data", sharePct: 100 }]);
  });

  it("prices the database's rows and storage", () => {
    // A database-heavy game: a million rows written, a billion read, 1 GB kept all month.
    const month = hostingCostCents(use({ writtenRowCount: 1_000_000, readRowCount: 1_000_000_000, monthStoredSizeBytes: 1_000_000_000 }));
    expect(month.kinds.database).toBeCloseTo(200 + 0.2 * 1000 + 40, 6);
    expect(freeUsedPct(month.totalCents)).toBe(88);
  });

  it("counts a schedule's run as a request, so ten schedules every minute are about 14%", () => {
    const runs = 10 * 60 * 24 * 30;
    expect(freeUsedPct(hostingCostCents(use({ scheduledRunCount: runs })).totalCents)).toBe(13);
    expect(hostingCostCents(use({ scheduledRunCount: runs })).totalCents / FREE_HOSTING_CENTS_PER_MONTH).toBeCloseTo(0.138, 3);
  });

  it("charges a request that ran 210 ms for 200 ms of CPU, beside the request itself", () => {
    // The game server records what's past the first 10 ms of each call (apps/rooms/src/game-server.ts).
    const month = hostingCostCents(use({ requestCount: 1, outsideRoomCpuDurationMs: 200 }));
    expect(month.kinds.requests).toBeCloseTo(0.00016, 9);
    expect(month.kinds.game_server_cpu).toBeCloseTo(0.0008, 9);
  });

  it("shares what used it in whole percent adding to 100, biggest first", () => {
    const month = hostingCostCents(use({ roomPlayDurationSec: 1000 * HOUR_SEC, requestCount: 1_000_000, writtenRowCount: 100_000 }));
    const shares = hostingShares(month.kinds);
    expect(shares.reduce((sumPct, share) => sumPct + share.sharePct, 0)).toBe(100);
    expect(shares.map((share) => share.kind)).toEqual(["room_play", "requests", "database"]);
    expect(hostingShares(hostingCostCents(NOTHING).kinds)).toEqual([]);
  });

  it("puts the chat filter's checks between adults on the meter at $0.10 per 1,000, its own share", () => {
    // A Haiku check is about 0.0024 to 0.007 cents (Oct 26, 2026), so twice that is within half of 0.01.
    const month = hostingCostCents(use({ adultChatCheckCount: 50_000 }));
    expect(month.kinds.adult_chat_checks).toBeCloseTo(500, 6);
    expect(freeUsedPct(month.totalCents)).toBe(100);
    expect(hostingShares(hostingCostCents(use({ roomPlayDurationSec: 1000 * HOUR_SEC, adultChatCheckCount: 20_000 })).kinds)).toEqual([
      { kind: "room_play", sharePct: 50 },
      { kind: "adult_chat_checks", sharePct: 50 },
    ]);
  });
});
