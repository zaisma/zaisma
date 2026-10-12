import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalSave, copiesToDrop, copyReason, parseSave, type SaveCopy, type SaveCopyReason } from "../../packages/core/src/saves.ts";

interface Format {
  encode: (v: unknown, pending: Promise<void>[], seen: unknown[]) => unknown;
  decode: (v: unknown) => unknown;
  saveText: (local: Record<string, string>, idbText: string) => string;
}

// The game domain script, with its save format handed to the test instead of running.
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../packages/sdk/saves.js"), "utf8");
let format!: Format;
new Function("__ZAISMA_SAVES__", "window", source)({ site: "https://zaisma.test", test: (f: Format) => (format = f) }, globalThis);

async function roundTrip(value: unknown) {
  const pending: Promise<void>[] = [];
  const encoded = format.encode(value, pending, []);
  await Promise.all(pending);
  return format.decode(JSON.parse(JSON.stringify(encoded)));
}

describe("cloud save format", () => {
  it("keeps what IndexedDB can hold that JSON can't", async () => {
    const value = {
      when: new Date(1760000000000),
      bad: new Date(NaN),
      bytes: new Uint8Array([0, 1, 254, 255]),
      floats: new Float32Array([1.5, -2]),
      buffer: new Uint8Array([9, 8]).buffer,
      map: new Map<unknown, unknown>([["a", 1], [2, new Set(["x"])]]),
      odd: [NaN, Infinity, -Infinity, -0, undefined, 10n],
      pattern: /ab+c/gi,
      nested: { $z: "not a tag", deep: [{ $z: ["num", "1"] }] },
    };
    const back = (await roundTrip(value)) as typeof value;
    expect(back.when).toEqual(value.when);
    expect(Number.isNaN((back.bad as Date).getTime())).toBe(true);
    expect(back.bytes).toEqual(value.bytes);
    expect(back.floats).toEqual(value.floats);
    expect(new Uint8Array(back.buffer)).toEqual(new Uint8Array([9, 8]));
    expect(back.map).toEqual(value.map);
    expect(Object.is(back.odd[3], -0)).toBe(true);
    expect(back.odd).toEqual(value.odd);
    expect(back.pattern).toEqual(/ab+c/gi);
    expect(back.nested).toEqual(value.nested);
  });

  it("keeps files and blobs", async () => {
    const back = (await roundTrip({ file: new File(["hello"], "save.dat", { type: "text/plain", lastModified: 5 }), blob: new Blob([new Uint8Array([1, 2])]) })) as { file: File; blob: Blob };
    expect(back.file.name).toBe("save.dat");
    expect(back.file.lastModified).toBe(5);
    expect(await back.file.text()).toBe("hello");
    expect(new Uint8Array(await back.blob.arrayBuffer())).toEqual(new Uint8Array([1, 2]));
  });

  it("refuses values that contain themselves, so a half save is never sent", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => format.encode(loop, [], [])).toThrow();
  });

  it("writes the same text as the server, so the same save always matches", async () => {
    const local = { b: "2", a: "1" };
    expect(format.saveText(local, "")).toBe(canonicalSave(local));
    const db = [{ name: "/idbfs", version: 21, stores: [{ name: "FILE_DATA", keyPath: null, autoIncrement: false, indexes: [], records: [["/idbfs/save", { timestamp: new Date(1), contents: new Uint8Array([7]) }]] }] }];
    const pending: Promise<void>[] = [];
    const idbText = JSON.stringify(format.encode(db, pending, []));
    const text = format.saveText(local, idbText);
    const parsed = parseSave(text);
    expect(parsed).not.toBeNull();
    expect(canonicalSave(parsed!)).toBe(text);
  });

  it("tells saves with databases from plain localStorage saves", () => {
    expect(parseSave('{"idb":"a string","local":"too"}')).toEqual({ idb: "a string", local: "too" });
    expect(parseSave('{"idb":[],"local":{"a":"1"}}')).toEqual({ idb: [], local: { a: "1" } });
    expect(parseSave('{"idb":[],"local":{"a":1}}')).toBeNull();
    expect(parseSave('{"idb":[],"local":{},"more":{}}')).toBeNull();
    expect(parseSave('{"a":1}')).toBeNull();
  });
});

describe("save history", () => {
  const H = 3600_000;
  const copy = (hoursAgo: number, reason: SaveCopyReason = "hourly"): SaveCopy => ({ id: `c${hoursAgo}`, account_id: "a", game_id: "g", at: 1e12 - hoursAgo * H, reason, hash: `h${hoursAgo}`, bytes: 10 });

  it("copies when progress is about to be lost, and otherwise once an hour", () => {
    const current = { bytes: 1000, updated_at: 1e12 };
    expect(copyReason(current, { bytes: 1000, replace: true }, 1e12)).toBe("replaced");
    expect(copyReason(current, { bytes: 400, replace: false }, 1e12)).toBe("smaller");
    expect(copyReason(current, { bytes: 900, replace: false }, null)).toBe("hourly");
    expect(copyReason(current, { bytes: 900, replace: false }, 1e12 - H)).toBe("hourly");
    expect(copyReason(current, { bytes: 900, replace: false }, 1e12 - H / 2)).toBeNull();
  });

  it("keeps five: the newest always, then routine copies go first, oldest first", () => {
    const list = [copy(0), copy(1), copy(2, "replaced"), copy(3), copy(4), copy(5, "smaller"), copy(6)];
    expect(copiesToDrop(list, 1e12).map((c) => c.id)).toEqual(["c6", "c4"]);
    expect(copiesToDrop(list.slice(0, 5), 1e12)).toEqual([]);
  });

  it("drops the oldest when every older copy is protected, and stops protecting after 30 days", () => {
    const protectedOnly = [copy(0), copy(1, "device"), copy(2, "replaced"), copy(3, "smaller"), copy(4, "restore"), copy(5, "replaced")];
    expect(copiesToDrop(protectedOnly, 1e12).map((c) => c.id)).toEqual(["c5"]);
    const old = [copy(0), copy(1), copy(2), copy(3), copy(4), copy(31 * 24, "replaced")];
    expect(copiesToDrop(old, 1e12).map((c) => c.id)).toEqual([`c${31 * 24}`]);
  });
});
