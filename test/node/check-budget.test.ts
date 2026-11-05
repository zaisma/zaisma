// scripts/check-budget.mjs: where a local run stands against its limits, when the Mac counts as busy, and the one run at a time.
import { describe, expect, it } from "vitest";
import { temporaryFolder } from "../temporary-folder";
// @ts-expect-error: a Node script with no types of its own.
import { BUSY_WAIT_LIMIT_SEC, CPU_AVERAGE_FROM_SEC, DURATION_HARD_SEC, MEMORY_HARD_SIZE_BYTES, addCpuReading, budgetLine, budgetVerdict, busyReason, cpuTimeSec, isRunWaiting, releaseRunTurn, startBudgetWatch, takeRunTurn, waitForRunTurn } from "../../scripts/check-budget.mjs";

const GIGABYTE_BYTES = 1024 ** 3;
const calm = { duration_sec: 100, cpu_average_core_count: 1, memory_peak_size_bytes: GIGABYTE_BYTES, heat_peak_status: "nominal", memory_pressure_peak_status: "normal" };
const namesOf = (limits: { metric_name: string }[]) => limits.map((limit) => limit.metric_name);

const folder = () => temporaryFolder("zaisma-check-budget-test-");

describe("budgetVerdict", () => {
  it("says nothing within every limit", () => {
    expect(budgetVerdict(calm)).toEqual({ warnings: [], hard_limits: [] });
  });

  it("warns past each warning line", () => {
    const verdict = budgetVerdict({ duration_sec: 241, cpu_average_core_count: 2.1, memory_peak_size_bytes: 2.1 * GIGABYTE_BYTES, heat_peak_status: "fair", memory_pressure_peak_status: "normal" });
    expect(namesOf(verdict.warnings)).toEqual(["duration_sec", "cpu_average_core_count", "memory_peak_size_bytes", "heat_level"]);
    expect(verdict.hard_limits).toEqual([]);
    expect(verdict.warnings[0].line).toBe("duration_sec at 4:01, past the warning line of 4:00");
  });

  it("stops past each hard limit", () => {
    const verdict = budgetVerdict({ duration_sec: DURATION_HARD_SEC + 1, cpu_average_core_count: 3.1, memory_peak_size_bytes: MEMORY_HARD_SIZE_BYTES + 1, heat_peak_status: "serious", memory_pressure_peak_status: "critical" });
    expect(namesOf(verdict.hard_limits)).toEqual(["duration_sec", "cpu_average_core_count", "memory_peak_size_bytes", "heat_level", "memory_pressure_level"]);
    expect(verdict.warnings).toEqual([]);
  });

  it("files nothing for memory pressure at warn, where this Mac sits with nothing running", () => {
    expect(budgetVerdict({ ...calm, memory_pressure_peak_status: "warn" })).toEqual({ warnings: [], hard_limits: [] });
  });

  it("leaves out what it couldn't read", () => {
    expect(budgetVerdict({ duration_sec: 1, cpu_average_core_count: null, memory_peak_size_bytes: null, heat_peak_status: null, memory_pressure_peak_status: null })).toEqual({ warnings: [], hard_limits: [] });
  });
});

it("says a run's numbers in one line", () => {
  expect(budgetLine(calm)).toBe("Budget: 1:40 of 5:00, 1.0 cores of 3, 1.0 GB of 3.0 GB, heat nominal, memory pressure normal.");
});

it("reads ps's CPU time", () => {
  expect(cpuTimeSec("0:01.50")).toBe(1.5);
  expect(cpuTimeSec("12:34.50")).toBe(754.5);
  expect(cpuTimeSec("1:02:03.00")).toBe(3723);
});

describe("busyReason", () => {
  const idle = { heat_status: "nominal", memory_pressure_status: "warn", other_core_count: 1 };
  it("lets a run start at memory pressure warn", () => expect(busyReason(idle)).toBeNull());
  it("holds one back at fair heat, critical pressure, or five cores in use", () => {
    expect(busyReason({ ...idle, heat_status: "fair" })).toBe("macOS calls the heat fair");
    expect(busyReason({ ...idle, memory_pressure_status: "critical" })).toBe("macOS calls the memory pressure critical");
    expect(busyReason({ ...idle, other_core_count: 5.5 })).toBe("everything else is using 5.5 cores");
  });
});

describe("the one run at a time", () => {
  const noBusy = () => ({ heat_status: "nominal", memory_pressure_status: "normal", other_core_count: 0 });

  it("gives the turn once, until it's released", () => {
    const directory = folder();
    expect(takeRunTurn({ directory })).toBe(true);
    expect(takeRunTurn({ directory })).toBe(true);
    releaseRunTurn({ directory });
    expect(takeRunTurn({ directory, processId: process.ppid })).toBe(true);
    expect(takeRunTurn({ directory })).toBe(false);
    releaseRunTurn({ directory, processId: process.ppid });
  });

  it("takes the turn of a run whose process died", () => {
    const directory = folder();
    expect(takeRunTurn({ directory, processId: 2 ** 30 })).toBe(true);
    expect(takeRunTurn({ directory })).toBe(true);
    releaseRunTurn({ directory });
  });

  it("waits while the Mac is busy, then takes its turn, with no waiting left behind", async () => {
    const directory = folder();
    let nowMs = 0;
    let lookCount = 0;
    const said: string[] = [];
    const answer = await waitForRunTurn({
      directory,
      say: (line: string) => said.push(line),
      nowMs: () => nowMs,
      pause: async (durationMs: number) => {
        expect(isRunWaiting({ directory })).toBe(true);
        nowMs += durationMs;
      },
      readState: () => (++lookCount < 3 ? { ...noBusy(), heat_status: "fair" } : noBusy()),
    });
    expect(answer).toEqual({ is_turn_taken: true, wait_duration_sec: 10, busy_reason: null });
    expect(said).toEqual([`Waiting up to ${BUSY_WAIT_LIMIT_SEC} seconds: macOS calls the heat fair.`]);
    expect(isRunWaiting({ directory })).toBe(false);
    releaseRunTurn({ directory });
  });

  it("hands to GitHub after two minutes, holding no turn", async () => {
    const directory = folder();
    let nowMs = 0;
    const answer = await waitForRunTurn({ directory, nowMs: () => nowMs, pause: async (durationMs: number) => void (nowMs += durationMs), readState: () => ({ ...noBusy(), other_core_count: 7 }) });
    expect(answer).toEqual({ is_turn_taken: false, wait_duration_sec: BUSY_WAIT_LIMIT_SEC, busy_reason: "everything else is using 7.0 cores" });
    expect(takeRunTurn({ directory, processId: process.ppid })).toBe(true);
    releaseRunTurn({ directory, processId: process.ppid });
  });

  it("waits for another local check the same way", async () => {
    const directory = folder();
    expect(takeRunTurn({ directory, processId: process.ppid })).toBe(true);
    let nowMs = 0;
    const answer = await waitForRunTurn({ directory, nowMs: () => nowMs, pause: async (durationMs: number) => void (nowMs += durationMs), readState: noBusy });
    expect(answer.busy_reason).toBe("another local check is running");
    releaseRunTurn({ directory, processId: process.ppid });
  });
});

describe("the watch", () => {
  it("counts a process's CPU after it has ended, and only the run's groups", () => {
    const cpuSecByProcess = new Map();
    const groups = new Set([10]);
    addCpuReading(cpuSecByProcess, [{ process_id: 11, process_group_id: 10, cpu_time_sec: 5 }, { process_id: 99, process_group_id: 98, cpu_time_sec: 500 }], groups);
    addCpuReading(cpuSecByProcess, [{ process_id: 12, process_group_id: 10, cpu_time_sec: 2 }], groups);
    expect([...cpuSecByProcess.entries()]).toEqual([[11, 5], [12, 2]]);
  });

  const watchOf = (options: object) => {
    let nowMs = 0;
    const calls: { metric_name: string }[][] = [];
    const watch = startBudgetWatch({ intervalMs: 1, nowMs: () => nowMs, readMemory: () => 0, readRows: async () => [], readState: () => ({ heat_status: "nominal", memory_pressure_status: "normal", other_core_count: 0 }), onHardLimit: (limits: { metric_name: string }[]) => calls.push(limits), ...options });
    return { watch, calls, setNowMs: (value: number) => (nowMs = value) };
  };
  const untilCalled = async (calls: unknown[]) => {
    for (let look = 0; look < 200 && !calls.length; look++) await new Promise((resolve) => setImmediate(resolve));
  };

  it("calls once at the time limit", async () => {
    const { watch, calls, setNowMs } = watchOf({});
    setNowMs((DURATION_HARD_SEC + 1) * 1000);
    await untilCalled(calls);
    await new Promise((resolve) => setImmediate(resolve));
    watch.stop();
    expect(calls.map(namesOf)).toEqual([["duration_sec"]]);
  });

  it("calls at serious heat", async () => {
    const { watch, calls } = watchOf({ readState: () => ({ heat_status: "serious", memory_pressure_status: "normal", other_core_count: 0 }) });
    await untilCalled(calls);
    expect(watch.stop().heat_peak_status).toBe("serious");
    expect(calls.map(namesOf)).toEqual([["heat_level"]]);
  });

  it("calls at the memory limit, measuring the run's own processes", async () => {
    const { watch, calls } = watchOf({ readRows: async () => [{ process_id: 11, process_group_id: 10, cpu_time_sec: 0 }], readMemory: (processIds: number[]) => processIds.length * (MEMORY_HARD_SIZE_BYTES + 1) });
    watch.addProcessGroup(10);
    await untilCalled(calls);
    watch.stop();
    expect(calls.map(namesOf)).toEqual([["memory_peak_size_bytes"]]);
  });

  it("gives the CPU's average no say in a run's first minute", async () => {
    const { watch, calls, setNowMs } = watchOf({ readRows: async () => [{ process_id: 11, process_group_id: 10, cpu_time_sec: 40 }] });
    watch.addProcessGroup(10);
    setNowMs(10_000);
    for (let look = 0; look < 20; look++) await new Promise((resolve) => setImmediate(resolve));
    expect(calls).toEqual([]);
    expect(watch.numbers().cpu_average_core_count).toBe(4);
    setNowMs((CPU_AVERAGE_FROM_SEC + 1) * 1000);
    expect(watch.numbers().duration_sec).toBe(61);
    watch.stop();
  });
});
