import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error plain JavaScript runner without type declarations
import { localDatabase, startServer } from "../../packages/game-server/bin/node.js";
import { GameServerError, defineGameServer, generateSigningKey, loadSigningKey, nextRunAtMs, readCron, startSchedules, type ScheduledRun, type Server } from "../../packages/game-server/src/internal.ts";

// Schedules: the cron times both runtimes share, the checks on a game server's schedules, and the
// Node runner's timers. Zaisma's side is test/rooms/schedules.test.ts.

const at = (isoTime: string) => Date.parse(isoTime);
const next = (cron: string, afterIsoTime: string) => {
  const atMs = nextRunAtMs(cron, at(afterIsoTime));
  return atMs === null ? null : new Date(atMs).toISOString();
};

describe("cron times", () => {
  it("run at the next matching minute, in UTC", () => {
    expect(next("0 0 * * *", "2026-10-16T13:45:10Z")).toBe("2026-10-17T00:00:00.000Z");
    expect(next("*/15 * * * *", "2026-10-16T13:45:00Z")).toBe("2026-10-16T14:00:00.000Z");
    expect(next("* * * * *", "2026-10-16T13:45:59.999Z")).toBe("2026-10-16T13:46:00.000Z");
    expect(next("30 4 * * *", "2026-10-16T04:29:00Z")).toBe("2026-10-16T04:30:00.000Z");
    // Mondays at 04:00; Oct 16, 2026 is a Friday. 7 is Sunday, like 0.
    expect(next("0 4 * * 1", "2026-10-16T13:45:00Z")).toBe("2026-10-19T04:00:00.000Z");
    expect(next("0 12 * * 7", "2026-10-16T13:45:00Z")).toBe("2026-10-18T12:00:00.000Z");
    expect(next("0 0 1 * *", "2026-10-16T13:45:00Z")).toBe("2026-11-01T00:00:00.000Z");
    expect(next("0 9-17/4 * * 1-5", "2026-10-16T13:45:00Z")).toBe("2026-10-16T17:00:00.000Z");
    expect(next("5,35 * * * *", "2026-10-16T13:05:00Z")).toBe("2026-10-16T13:35:00.000Z");
    expect(next("10/20 * * * *", "2026-10-16T13:31:00Z")).toBe("2026-10-16T13:50:00.000Z");
    // Leap days come round.
    expect(next("0 0 29 2 *", "2026-10-16T13:45:00Z")).toBe("2028-02-29T00:00:00.000Z");
  });

  it("match either day when both day fields are given, as cron does", () => {
    // The 1st of the month or any Monday.
    expect(next("0 0 1 * 1", "2026-10-16T13:45:00Z")).toBe("2026-10-19T00:00:00.000Z");
    expect(next("0 0 1 * 1", "2026-10-27T00:00:00Z")).toBe("2026-11-01T00:00:00.000Z");
  });

  it("say what's wrong with a cron that doesn't read", () => {
    const mistake = (cron: unknown) => {
      const read = readCron(cron);
      return "mistake" in read ? read.mistake : null;
    };
    expect(mistake("0 0 * *")).toMatch(/has 4 fields, not 5/);
    expect(mistake("0 0 0 * * *")).toMatch(/no seconds field/);
    expect(mistake("0 4 * * MON")).toMatch(/"MON" as its day of the week.*no names like MON/);
    expect(mistake("60 * * * *")).toMatch(/"60" as its minute, which goes from 0 to 59/);
    expect(mistake("0 0 0 * *")).toMatch(/day of the month, which goes from 1 to 31/);
    expect(mistake("*/0 * * * *")).toMatch(/minute/);
    expect(mistake("0 0 31 2 *")).toMatch(/never runs/);
    expect(mistake(5)).toMatch(/not text/);
    expect(mistake("0 0 * * *")).toBeNull();
    expect(nextRunAtMs("0 0 * *", Date.now())).toBeNull();
  });
});

describe("a game server's schedules", () => {
  const onSchedule = () => {};
  const problem = (server: object) => {
    try {
      defineGameServer(server as never);
      return null;
    } catch (error) {
      if (!(error instanceof GameServerError)) throw error;
      return { field: error.field, message: error.message };
    }
  };

  it("are enough for a game server, with no rooms or requests", () => {
    expect(problem({ schedules: [{ name: "daily-reset", cron: "0 0 * * *" }], onSchedule })).toBeNull();
  });

  it("are checked when it's defined, saying what to do", () => {
    expect(problem({ schedules: [{ name: "daily-reset", cron: "0 0 * * *" }], onRequest: () => 1 })).toEqual({ field: "schedules", message: expect.stringMatching(/onSchedule isn't, so nothing would run/) });
    expect(problem({ onSchedule, onRequest: () => 1 })).toEqual({ field: "schedules", message: expect.stringMatching(/schedules isn't, so it would never run/) });
    expect(problem({ schedules: { name: "daily-reset", cron: "0 0 * * *" }, onSchedule })?.message).toMatch(/not a list/);
    expect(problem({ schedules: [{ name: "Daily Reset", cron: "0 0 * * *" }], onSchedule })?.message).toMatch(/lowercase letters, digits and hyphens/);
    expect(problem({ schedules: [{ name: "reset", cron: "0 0 * * *" }, { name: "reset", cron: "0 12 * * *" }], onSchedule })?.message).toMatch(/Two schedules are named "reset"/);
    expect(problem({ schedules: [{ name: "reset", cron: "0 0 * * *", timezone: "Europe/Paris" }], onSchedule })?.message).toMatch(/has timezone, which schedules don't take/);
    expect(problem({ schedules: [{ name: "reset", cron: "every day" }], onSchedule })?.message).toMatch(/Schedule "reset": The cron "every day" has 2 fields/);
    const eleven = Array.from({ length: 11 }, (_, index) => ({ name: `job-${index}`, cron: "0 0 * * *" }));
    expect(problem({ schedules: eleven, onSchedule })?.message).toMatch(/11 schedules; a game server has up to 10/);
    expect(problem({ onRequest: () => 1, onSchedule: "soon", schedules: [{ name: "reset", cron: "0 0 * * *" }] })).toEqual({ field: "onSchedule", message: expect.stringMatching(/isn't a function/) });
  });
});

describe("schedules on the developer's own server", () => {
  afterEach(() => vi.useRealTimers());

  it("run at their minutes with the database, and say when a run fails", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: at("2026-10-16T23:58:30Z") });
    const runs: ScheduledRun[] = [];
    const failures: [string, string][] = [];
    const handler = {
      schedules: [
        { name: "tick", cron: "* * * * *" },
        { name: "daily-reset", cron: "0 0 * * *" },
      ],
      async onSchedule(run: ScheduledRun, server: Server) {
        runs.push(run);
        if (run.name === "daily-reset") throw new Error("the reset broke");
        await server.database.query("SELECT 1");
      },
    };
    const queries: string[] = [];
    const server = { database: { query: async (sql: string) => (queries.push(sql), []), batch: async () => [] } };
    const running = startSchedules(handler, server as unknown as Server, (run, failure) => failures.push([run.name, failure]));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(runs).toEqual([{ name: "tick", cron: "* * * * *", scheduledAt: "2026-10-16T23:59:00.000Z" }]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runs.map((run) => [run.name, run.scheduledAt]).sort()).toEqual([
      ["daily-reset", "2026-10-17T00:00:00.000Z"],
      ["tick", "2026-10-16T23:59:00.000Z"],
      ["tick", "2026-10-17T00:00:00.000Z"],
    ]);
    expect(queries).toEqual(["SELECT 1", "SELECT 1"]);
    expect(failures).toEqual([["daily-reset", expect.stringMatching(/the reset broke/)]]);
    running.stop();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(runs).toHaveLength(3);
  });

  it("give up on a run after 30 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: at("2026-10-16T12:00:30Z") });
    const failures: string[] = [];
    const running = startSchedules({ schedules: [{ name: "stuck", cron: "* * * * *" }], onSchedule: () => new Promise(() => {}) }, {} as Server, (_, failure) => failures.push(failure));
    await vi.advanceTimersByTimeAsync(30_000 + 30_000);
    expect(failures).toEqual([expect.stringMatching(/onSchedule \("stuck"\) didn't finish within 30 seconds/)]);
    running.stop();
  });

  it("run in the Node runner, from the game server it's given", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: at("2026-10-16T12:00:30Z") });
    const signing = await loadSigningKey(await generateSigningKey());
    const database = localDatabase(":memory:");
    const own = startServer({
      server: {
        schedules: [{ name: "world-turn", cron: "* * * * *" }],
        async onSchedule(run: ScheduledRun, server: Server) {
          await server.database.query("CREATE TABLE IF NOT EXISTS turns (scheduled_at TEXT PRIMARY KEY)");
          await server.database.query("INSERT INTO turns VALUES (?)", [run.scheduledAt]);
        },
      },
      game: "world",
      port: 0,
      origins: [],
      issuer: "https://rooms.zaisma.test",
      keys: async () => [signing.publicKey],
      database,
    });
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(await database.query("SELECT scheduled_at FROM turns ORDER BY scheduled_at", [])).toEqual([{ scheduled_at: "2026-10-16T12:01:00.000Z" }, { scheduled_at: "2026-10-16T12:02:00.000Z" }]);
    vi.useRealTimers();
    await own.close();
  });
});
