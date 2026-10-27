import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error: a plain JavaScript script without types
import { memoryCap, nextTurn, placeText, sizeText, testRunSizeBytes, waitForTurn, waitingInOrder } from "../../scripts/preview/memory.mjs";

/**
 * The memory cap on every preview and test run on a machine and its line (scripts/preview/memory.mjs): where the cap comes from,
 * whose turn comes when and with how many test files at once, and the one lock holding when several processes change the line at once.
 */

const GB = 1024 ** 3;
const MB = 1024 ** 2;
let directory = "";
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "preview-memory-")); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

const entry = (pid: number, offset: number, kind = "start", askedAtMs = pid, turnGivenAtMs: number | null = null) => ({ pid, folder: `/checkouts/${pid}`, offset, kind, asked_at_ms: askedAtMs, turn_given_at_ms: turnGivenAtMs });

describe("the memory cap", () => {
  const mac = { platform: "darwin", totalMemoryBytes: 8 * GB };
  it("is 3/8 of the machine's memory by default: 3 GB on an 8 GB Mac", () => {
    expect(memoryCap({ ...mac, env: {}, directory })).toEqual({ capBytes: 3 * GB, source: "default" });
  });
  it("comes from the settings file, and the environment over it", () => {
    writeFileSync(join(directory, "settings.json"), JSON.stringify({ memory_cap_bytes: 2 * GB }));
    expect(memoryCap({ ...mac, env: {}, directory })).toEqual({ capBytes: 2 * GB, source: "settings_file" });
    expect(memoryCap({ ...mac, env: { PREVIEW_MEMORY_CAP_BYTES: String(4 * GB) }, directory })).toEqual({ capBytes: 4 * GB, source: "environment" });
    expect(memoryCap({ ...mac, env: { PREVIEW_MEMORY_CAP_BYTES: "0" }, directory })).toEqual({ capBytes: 0, source: "environment" });
  });
  it("refuses what isn't a whole number of bytes, saying what it takes", () => {
    expect(() => memoryCap({ ...mac, env: { PREVIEW_MEMORY_CAP_BYTES: "3GB" }, directory })).toThrow(/whole number of bytes, like 4294967296 for 4 GB/);
    writeFileSync(join(directory, "settings.json"), JSON.stringify({ memory_cap_bytes: -1 }));
    expect(() => memoryCap({ ...mac, env: {}, directory })).toThrow(/memory_cap_bytes in/);
  });
  it("is off away from macOS", () => {
    expect(memoryCap({ platform: "linux", env: { PREVIEW_MEMORY_CAP_BYTES: String(GB) }, directory })).toEqual({ capBytes: 0, source: "not_macos" });
  });
});

describe("whose turn it is", () => {
  const awake = (offset: number, sizeBytes: number) => ({ offset, sizeBytes, isAwake: true });
  it("gives the first in line its turn when it fits under the cap", () => {
    const turn = nextTurn({ entries: [entry(11, 100), entry(12, 200)], previews: [awake(0, GB)], capBytes: 3 * GB, awakeSizeBytes: GB, nowMs: 1000 });
    expect(turn).toMatchObject({ turnPid: 11, usedBytes: GB, keptBytes: 0, neededBytes: GB });
  });
  it("holds it back when it doesn't, counting memory kept for a preview still starting", () => {
    const entries = [entry(10, 100, "start", 1, 900), entry(11, 200)];
    // 1 GB awake, 0.2 GB of the starting one so far and 0.8 GB kept for it: 2 GB, and another 1 GB is over 2.5 GB.
    const turn = nextTurn({ entries, previews: [awake(0, GB), { offset: 100, sizeBytes: 200 * MB, isAwake: false }], capBytes: 2.5 * GB, awakeSizeBytes: GB, nowMs: 1000 });
    expect(turn).toMatchObject({ turnPid: null, keptBytes: 824 * MB, neededBytes: GB });
  });
  it("stops keeping memory for a start ten minutes after its turn came", () => {
    const entries = [entry(10, 100, "start", 1, 0), entry(11, 200)];
    const turn = nextTurn({ entries, previews: [awake(0, GB)], capBytes: 2 * GB, awakeSizeBytes: GB, nowMs: 10 * 60_000 });
    expect(turn).toMatchObject({ turnPid: 11, keptBytes: 0 });
  });
  it("lets one preview run on its own even over the cap", () => {
    const turn = nextTurn({ entries: [entry(11, 0)], previews: [{ offset: 100, sizeBytes: 44 * MB, isAwake: false }], capBytes: 512 * MB, awakeSizeBytes: GB, nowMs: 1000 });
    expect(turn).toMatchObject({ turnPid: 11, isAlone: true });
  });
  it("counts what a waking preview already holds asleep", () => {
    const turn = nextTurn({ entries: [entry(11, 100, "wake")], previews: [awake(0, GB), { offset: 100, sizeBytes: 44 * MB, isAwake: false }], capBytes: 2 * GB, awakeSizeBytes: GB, nowMs: 1000 });
    expect(turn).toMatchObject({ turnPid: 11, neededBytes: GB - 44 * MB });
  });
  it("puts wakes first, then starts, each in the order they asked", () => {
    const order = waitingInOrder([entry(1, 0, "start", 5), entry(2, 100, "wake", 9), entry(3, 200, "start", 2), entry(4, 300, "wake", 3), entry(5, 400, "start", 1, 7)]);
    expect(order.map((each: { pid: number }) => each.pid)).toEqual([4, 2, 3, 1]);
  });
  it("has no cap at 0", () => {
    const turn = nextTurn({ entries: [entry(11, 100)], previews: [awake(0, 9 * GB)], capBytes: 0, awakeSizeBytes: GB, nowMs: 1000 });
    expect(turn.turnPid).toBe(11);
  });
});

describe("a test run's turn", () => {
  const awake = (offset: number, sizeBytes: number) => ({ offset, sizeBytes, isAwake: true });
  const testEntry = (pid: number, requestedWorkerCount: number, { askedAtMs = pid, turnGivenAtMs = null as number | null, workerCount = null as number | null, isNodeOnly = false } = {}) => ({ pid, folder: `/checkouts/${pid}`, offset: null, kind: "test", asked_at_ms: askedAtMs, turn_given_at_ms: turnGivenAtMs, requested_worker_count: requestedWorkerCount, is_node_only: isNodeOnly, worker_count: workerCount });
  const turnFor = (entries: unknown[], previews: unknown[], capBytes = 3 * GB, testRuns: unknown[] = []) => nextTurn({ entries, previews, testRuns, capBytes, awakeSizeBytes: GB, nowMs: 1000 });

  it("runs as many files at once as fit, up to what it asked for", () => {
    // 0.6 GB for vitest, 0.9 GB for each Workers file: 3 GB left takes 2, beside a 1 GB preview 1.
    expect(turnFor([testEntry(21, 4)], [])).toMatchObject({ turnPid: 21, turnWorkerCount: 2 });
    expect(turnFor([testEntry(21, 4)], [awake(0, GB)])).toMatchObject({ turnPid: 21, turnWorkerCount: 1 });
    expect(turnFor([testEntry(21, 1)], [])).toMatchObject({ turnPid: 21, turnWorkerCount: 1 });
    expect(testRunSizeBytes(2)).toBe(2400 * MB);
  });
  it("waits when not even one file fits, saying what one needs", () => {
    const turn = turnFor([testEntry(21, 4)], [awake(0, GB), awake(100, GB)]);
    expect(turn).toMatchObject({ turnPid: null, turnWorkerCount: null, neededBytes: testRunSizeBytes(1) });
  });
  it("counts node files as lighter", () => {
    expect(turnFor([testEntry(21, 4, { isNodeOnly: true })], [awake(0, GB), awake(100, GB)])).toMatchObject({ turnPid: 21, turnWorkerCount: 2 });
  });
  it("runs alone over the cap, one file at a time", () => {
    expect(turnFor([testEntry(21, 4)], [], GB)).toMatchObject({ turnPid: 21, turnWorkerCount: 1, isAlone: true });
  });
  it("keeps memory for a run that's still growing until its vitest ends, and holds a start back for it", () => {
    // A run of 2 Workers files (2.4 GB) measured at 0.8 GB so far: 1.6 GB kept, so a 1 GB preview doesn't fit in 3 GB.
    const running = testEntry(21, 2, { turnGivenAtMs: 0, workerCount: 2 });
    const turn = nextTurn({ entries: [running, entry(22, 100)], previews: [], testRuns: [{ pid: 21, sizeBytes: 800 * MB }], capBytes: 3 * GB, awakeSizeBytes: GB, nowMs: 60 * 60_000 });
    expect(turn).toMatchObject({ turnPid: null, usedBytes: 800 * MB, keptBytes: testRunSizeBytes(2) - 800 * MB });
  });
  it("waits its turn behind wakes, and with starts by when each asked", () => {
    const order = waitingInOrder([testEntry(31, 2, { askedAtMs: 1 }), entry(32, 100, "start", 2), entry(33, 200, "wake", 5), testEntry(34, 2, { askedAtMs: 3 })]);
    expect(order.map((each: { pid: number }) => each.pid)).toEqual([33, 31, 32, 34]);
  });
  it("gets every file it asked for with no cap", () => {
    expect(turnFor([testEntry(21, 4)], [awake(0, 9 * GB)], 0)).toMatchObject({ turnPid: 21, turnWorkerCount: 4 });
  });
  it("counts a waiting run as nothing, however many wait with their processes alive", () => {
    // 14 waiting runs of ~115 MB each beside a 1.7 GB preview: 3.3 GB measured, yet a node run (0.8 GB) fits in 3 GB.
    const waiting = Array.from({ length: 14 }, (_, i) => testEntry(100 + i, 2, { isNodeOnly: true, askedAtMs: 10 + i }));
    const measured = waiting.map((each) => ({ pid: each.pid, sizeBytes: 115 * MB }));
    const turn = nextTurn({ entries: waiting, previews: [awake(0, 1700 * MB)], testRuns: measured, capBytes: 3 * GB, awakeSizeBytes: GB, nowMs: 1000 });
    expect(turn).toMatchObject({ turnPid: 100, usedBytes: 1700 * MB });
  });
  it("runs one Workers run at a time on the machine, and lets node runs behind a waiting one go", () => {
    const running = testEntry(21, 1, { turnGivenAtMs: 0, workerCount: 1 });
    const waitingWorkers = testEntry(22, 2, { askedAtMs: 1 });
    const nodeRun = testEntry(23, 2, { askedAtMs: 2, isNodeOnly: true });
    const turn = nextTurn({ entries: [running, waitingWorkers, nodeRun], previews: [], testRuns: [{ pid: 21, sizeBytes: testRunSizeBytes(1) }], capBytes: 8 * GB, awakeSizeBytes: GB, nowMs: 1000 });
    expect(turn).toMatchObject({ turnPid: 23 });
    expect(nextTurn({ entries: [running, waitingWorkers], previews: [], testRuns: [{ pid: 21, sizeBytes: testRunSizeBytes(1) }], capBytes: 8 * GB, awakeSizeBytes: GB, nowMs: 1000 })).toMatchObject({ turnPid: null });
    expect(nextTurn({ entries: [waitingWorkers], previews: [], capBytes: 8 * GB, awakeSizeBytes: GB, nowMs: 1000 })).toMatchObject({ turnPid: 22 });
  });
  it("passes over a Workers run that can never fit beside the awake previews, and keeps order for the rest", () => {
    const workers = testEntry(21, 4, { askedAtMs: 1 });
    const nodeRun = testEntry(22, 2, { askedAtMs: 2, isNodeOnly: true });
    const turn = turnFor([workers, nodeRun], [awake(0, 1700 * MB)], 3 * GB, [{ pid: 21, sizeBytes: 100 * MB }, { pid: 22, sizeBytes: 100 * MB }]);
    expect(turn).toMatchObject({ turnPid: 22, turnWorkerCount: 2 });
    // One that only has to wait for a run to end holds its place: the node run behind it doesn't jump the line.
    const running = testEntry(30, 2, { turnGivenAtMs: 0, workerCount: 2 });
    const held = nextTurn({ entries: [running, testEntry(31, 1, { askedAtMs: 1 }), testEntry(32, 1, { askedAtMs: 2, isNodeOnly: true })], previews: [], testRuns: [{ pid: 30, sizeBytes: testRunSizeBytes(2) }], capBytes: 3 * GB, awakeSizeBytes: GB, nowMs: 1000 });
    expect(held.turnPid).toBeNull();
  });
  it.skipIf(process.platform !== "darwin")("answers a Workers run at once while a preview is awake, and leaves the line", async () => {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(directory, { recursive: true });
    const savedCap = process.env.PREVIEW_MEMORY_CAP_BYTES;
    process.env.PREVIEW_MEMORY_CAP_BYTES = String(3 * GB);
    const measurement = { measured_at_ms: Date.now(), cap_bytes: 3 * GB, used_bytes: 1700 * MB, kept_bytes: 0, needed_bytes: 0, is_alone: false, previews: [{ offset: 0, size_bytes: 1700 * MB, is_awake: true }], test_runs: [] };
    writeFileSync(join(directory, "line.json"), JSON.stringify({ entries: [], measurement, awake_size_bytes: null }));
    const say = () => {};
    try {
      await expect(waitForTurn({ kind: "test", folder: "/checkout", requestedWorkerCount: 2, isNodeOnly: false, say, directory })).rejects.toThrow(/workers_tests_while_preview_awake.*Workers tests go to GitHub/);
    } finally {
      if (savedCap === undefined) delete process.env.PREVIEW_MEMORY_CAP_BYTES;
      else process.env.PREVIEW_MEMORY_CAP_BYTES = savedCap;
    }
    expect(JSON.parse(readFileSync(join(directory, "line.json"), "utf8")).entries).toEqual([]);
  });
});

describe("words", () => {
  it("says sizes and places", () => {
    expect([sizeText(44 * MB), sizeText(1.15 * GB)]).toEqual(["44 MB", "1.1 GB"]);
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(placeText)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
  });
});

describe("the line's lock", () => {
  it("lets one process at a time change the line, with six at once", async () => {
    const memory = resolve("scripts/preview/memory.mjs");
    // Each adds itself to a list in the line, 20 times over, reading and writing it whole: a lost write would lose an entry.
    const script = `
      import { readLine, withLock, writeLine } from ${JSON.stringify(memory)};
      const directory = process.argv[1];
      for (let i = 0; i < 20; i++) await withLock(async () => {
        const line = readLine({ directory });
        await new Promise((r) => setTimeout(r, 2));
        writeLine({ ...line, entries: [...line.entries, { pid: process.pid, i }] }, { directory });
      }, { directory });`;
    await Promise.all(Array.from({ length: 6 }, () => new Promise<void>((done, fail) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script, directory], { stdio: "inherit" });
      child.on("exit", (code) => (code === 0 ? done() : fail(new Error(`exit ${code}`))));
    })));
    const { entries } = JSON.parse(readFileSync(join(directory, "line.json"), "utf8"));
    expect(entries).toHaveLength(120);
  }, 30_000);
  it("takes over a lock left by a process that died holding it", async () => {
    // @ts-expect-error: a plain JavaScript script without types
    const { withLock } = await import("../../scripts/preview/memory.mjs");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(directory, "lock"));
    writeFileSync(join(directory, "lock", "owner.json"), JSON.stringify({ pid: 999_999_999, locked_at_ms: Date.now() }));
    expect(await withLock(() => "held", { directory })).toBe("held");
  });
});
