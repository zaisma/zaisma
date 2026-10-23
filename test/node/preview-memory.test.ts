import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error: a plain JavaScript script without types
import { memoryCap, nextTurn, placeText, sizeText, waitingInOrder } from "../../scripts/preview/memory.mjs";

/**
 * The memory cap on every preview on a machine and its line (scripts/preview/memory.mjs): where the cap comes from, whose
 * turn comes when, and the one lock holding when several processes change the line at once.
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
