import { spawn } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error: a plain JavaScript script without types
import { IDLE_WHILE_WAITED_FOR_MS, isTurnToSleep, memoryCap, memoryHoldersText, nextTurn, placeText, previewToSleep, sizeText, testRunSizeBytes, waitForTurn, waitingInOrder } from "../../scripts/preview/memory.mjs";
import { temporaryFolder } from "../temporary-folder.ts";

/**
 * The memory cap on every preview and test run on a machine and its line (scripts/preview/memory.mjs): where the cap comes from,
 * whose turn comes when and with how many test files at once, and the one lock holding when several processes change the line at once.
 */

const GB = 1024 ** 3;
const MB = 1024 ** 2;
let directory = "";
beforeEach(() => { directory = temporaryFolder("preview-memory-"); });
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
});

describe("a look at the line", () => {
  // This process stands in for the one asking: a Mac with a 3 GB cap, what's measured, and nothing of the real machine's.
  const mac = () => {
    writeFileSync(join(directory, "settings.json"), JSON.stringify({ memory_cap_bytes: 3 * GB }));
    return { directory, platform: "darwin", say: () => {} };
  };
  const measuring = (previews: { offset: number; sizeBytes: number; folder?: string }[]) => (entries: { pid: number }[]) => ({
    previews: previews.map((preview) => ({ folder: `/checkouts/${preview.offset}`, isAwake: true, isListening: false, ...preview })),
    testRuns: [],
    processes: new Map(entries.map((each) => [each.pid, { command: "scripts/preview/run.mjs vitest" }])),
  });
  const lineOnDisk = () => JSON.parse(readFileSync(join(directory, "line.json"), "utf8"));
  const waitingStart = (awakeSizeBytes: number) => writeFileSync(join(directory, "line.json"), JSON.stringify({ entries: [entry(process.ppid, 100, "start", 1)], awake_size_bytes: awakeSizeBytes }));

  it("ends a test run at once when not even one file fits, leaving nothing in line", async () => {
    const asked = waitForTurn({ ...mac(), kind: "test", folder: "/checkout", requestedWorkerCount: 2, isNodeOnly: true, measure: measuring([{ offset: 0, sizeBytes: 2800 * MB }]) });
    await expect(asked).rejects.toThrow(/^no_room_for_tests: .*2\.7 GB of the 3\.0 GB memory cap.*GitHub's check runs them/);
    expect(lineOnDisk().entries).toEqual([]);
  });
  it("ends a Workers run at once beside an awake preview, and says node tests may still fit", async () => {
    const asked = waitForTurn({ ...mac(), kind: "test", folder: "/checkout", requestedWorkerCount: 2, measure: measuring([{ offset: 0, sizeBytes: 1700 * MB }]) });
    await expect(asked).rejects.toThrow(/^no_room_for_tests: .*Node tests may still fit here/);
    expect(lineOnDisk().entries).toEqual([]);
  });
  it("runs as many test files as fit, and keeps the run in line while it goes", async () => {
    const turn = await waitForTurn({ ...mac(), kind: "test", folder: "/checkout", requestedWorkerCount: 4, isNodeOnly: true, measure: measuring([{ offset: 0, sizeBytes: 2 * GB }]) });
    expect(turn.workerCount).toBe(2);
    expect(lineOnDisk().entries).toMatchObject([{ pid: process.pid, kind: "test", worker_count: 2 }]);
  });
  it("never lets a test run past a preview waiting for memory, though it would fit", async () => {
    waitingStart(2 * GB);
    const asked = waitForTurn({ ...mac(), kind: "test", folder: "/checkout", isNodeOnly: true, measure: measuring([{ offset: 0, sizeBytes: 1500 * MB }]) });
    await expect(asked).rejects.toThrow(/no_room_for_tests/);
    expect(lineOnDisk().entries.map((each: { pid: number }) => each.pid)).toEqual([process.ppid]);
  });
  it("answers a test run from what's left when the preview ahead of it just got its turn", async () => {
    waitingStart(GB);
    const turn = await waitForTurn({ ...mac(), kind: "test", folder: "/checkout", isNodeOnly: true, measure: measuring([{ offset: 0, sizeBytes: GB / 2 }]) });
    expect(turn.workerCount).toBe(1);
    const entries = lineOnDisk().entries;
    expect(entries.every((each: { turn_given_at_ms: number | null }) => each.turn_given_at_ms !== null)).toBe(true);
  });
  it("has a start give up after its limit: no room, what holds the memory, the command, and nothing left in line", async () => {
    const answer = await waitForTurn({ ...mac(), kind: "start", offset: 100, folder: "/checkout", maxWaitMs: 0, measure: measuring([{ offset: 0, sizeBytes: 2 * GB }, { offset: 200, sizeBytes: GB }]) });
    expect(answer.noRoomText).toMatch(/^No room for it after \d+ s in line: .* Holding the memory: the preview in \/checkouts\/0 \(2\.0 GB\), the preview in \/checkouts\/200 \(1\.0 GB\)\. .*Try again: npm run preview:start$/);
    expect(lineOnDisk().entries).toEqual([]);
  });
  it("gives a start its turn when it fits, with its limit unused", async () => {
    const answer = await waitForTurn({ ...mac(), kind: "start", offset: 100, folder: "/checkout", maxWaitMs: 60_000, measure: measuring([{ offset: 0, sizeBytes: GB }]) });
    expect(answer.noRoomText).toBeUndefined();
  });
  it("says what holds the memory, biggest first, leaving out asleep previews and the one asking", () => {
    const previews = [{ offset: 0, folder: "/a", sizeBytes: GB, isAwake: true }, { offset: 100, folder: "/b", sizeBytes: 44 * MB, isAwake: false }, { offset: 200, folder: "/c", sizeBytes: 2 * GB, isAwake: true }, { offset: 300, folder: "/d", sizeBytes: 3 * GB, isAwake: true }];
    const testRuns = [{ folder: "/e", sizeBytes: 1536 * MB, isRunning: true }, { folder: "/f", sizeBytes: 9 * GB, isRunning: false }];
    expect(memoryHoldersText({ previews, testRuns, ownOffset: 300 })).toBe("the preview in /c (2.0 GB), the test run in /e (1.5 GB), the preview in /a (1.0 GB)");
    expect(memoryHoldersText({ previews: [], testRuns: [] })).toMatch(/^nothing right now/);
  });
});

describe("which preview sleeps to make room", () => {
  const NOW_MS = 100 * 60 * 60_000;
  const MINUTE_MS = 60_000;
  const awakeFor = (offset: number, idleMinutes: number, notedMinutesAgo = 0) => ({ offset, pid: offset + 1, last_visit_at_ms: NOW_MS - idleMinutes * MINUTE_MS, noted_at_ms: NOW_MS - notedMinutesAgo * MINUTE_MS });
  const asked = (kind = "start", minutesAgo = 5) => entry(11, 100, kind, NOW_MS - minutesAgo * MINUTE_MS);
  const pick = (entries: object[], awakePreviews: object[], roomAskedAtMs: number | null = null) => previewToSleep({ entries, awakePreviews, roomAskedAtMs, nowMs: NOW_MS });

  it("is none with nothing in line, however long nobody has looked: the 30 minutes stays", () => {
    expect(pick([], [awakeFor(0, 29)])).toBeNull();
    expect(pick([entry(11, 100, "start", NOW_MS, NOW_MS)], [awakeFor(0, 29)])).toBeNull();
  });
  it("is the one nobody has looked at for longest, once that's 10 minutes", () => {
    expect(IDLE_WHILE_WAITED_FOR_MS).toBe(10 * MINUTE_MS);
    expect(pick([asked()], [awakeFor(0, 12), awakeFor(100, 25), awakeFor(200, 3)])).toBe(100);
    expect(pick([asked()], [awakeFor(0, 9), awakeFor(200, 3)])).toBeNull();
    expect(pick([asked()], [awakeFor(0, 10)])).toBe(0);
  });
  it("counts a wake as waiting, and a test run never", () => {
    expect(pick([asked("wake")], [awakeFor(0, 12)])).toBe(0);
    expect(pick([{ ...asked("test") }], [awakeFor(0, 12)])).toBeNull();
  });
  it("waits until what's in line has had the time to get its turn if it fits", () => {
    expect(pick([entry(11, 100, "start", NOW_MS - 5000)], [awakeFor(0, 12)])).toBeNull();
    expect(pick([entry(11, 100, "start", NOW_MS - 30_000)], [awakeFor(0, 12)])).toBe(0);
  });
  it("skips a preview that has stopped noting, which is asleep or gone", () => {
    expect(pick([asked()], [awakeFor(0, 40, 2), awakeFor(100, 11)])).toBe(100);
  });
  it("tells one at a time, and the next only if the first wasn't enough", () => {
    expect(pick([asked()], [awakeFor(0, 12)], NOW_MS - 30_000)).toBeNull();
    expect(pick([asked()], [awakeFor(0, 12)], NOW_MS - 2 * MINUTE_MS)).toBe(0);
  });
  it("is agreed between previews through the line, and answers false without a cap", async () => {
    writeFileSync(join(directory, "settings.json"), JSON.stringify({ memory_cap_bytes: 3 * GB }));
    const nowMs = Date.now();
    const mac = { directory, platform: "darwin" };
    writeFileSync(join(directory, "line.json"), JSON.stringify({ entries: [entry(process.ppid, 100, "start", nowMs - 5 * MINUTE_MS)], awake_previews: [{ offset: 200, pid: process.pid, last_visit_at_ms: nowMs - 20 * MINUTE_MS, noted_at_ms: nowMs }] }));
    expect(await isTurnToSleep({ ...mac, offset: 0, lastVisitAtMs: nowMs - 12 * MINUTE_MS })).toBe(false);
    expect(await isTurnToSleep({ ...mac, offset: 200, lastVisitAtMs: nowMs - 20 * MINUTE_MS })).toBe(true);
    const line = JSON.parse(readFileSync(join(directory, "line.json"), "utf8"));
    expect(line.awake_previews.map((preview: { offset: number }) => preview.offset)).toEqual([0]);
    expect(line.room_asked_at_ms).toBeGreaterThanOrEqual(nowMs);
    expect(await isTurnToSleep({ ...mac, offset: 0, lastVisitAtMs: nowMs - 12 * MINUTE_MS })).toBe(false);
    expect(await isTurnToSleep({ directory, platform: "linux", offset: 0, lastVisitAtMs: 0 })).toBe(false);
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
