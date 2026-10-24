import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalSave, copiesToDrop, EMPTY_SAVE_TEXT, copyReason, indexeddbDatabasesProblem, parseSave, type SaveCopy, type SaveCopyReason } from "../../packages/core/src/saves.ts";

interface Format {
  encode: (v: unknown, pending: Promise<void>[], seen: unknown[]) => unknown;
  decode: (v: unknown) => unknown;
  saveText: (local: Record<string, string>, idbText: string) => string;
  putSave: (save: unknown, onBlocked?: () => void) => Promise<void>;
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
    expect(format.saveText(local, "")).toBe('{"save_format_version_number":1,"local_storage_items":{"a":"1","b":"2"},"indexeddb_databases":[]}');
    expect(format.saveText(local, "")).toBe(canonicalSave({ save_format_version_number: 1, local_storage_items: local, indexeddb_databases: [] }));
    expect(format.saveText({}, "")).toBe(EMPTY_SAVE_TEXT);
    const db = [{ name: "/idbfs", version: 21, stores: [{ name: "FILE_DATA", keyPath: null, autoIncrement: false, indexes: [], records: [["/idbfs/save", { timestamp: new Date(1), contents: new Uint8Array([7]) }]] }] }];
    const pending: Promise<void>[] = [];
    const idbText = JSON.stringify(format.encode(db, pending, []));
    const text = format.saveText(local, idbText);
    const parsed = parseSave(text);
    expect(parsed).not.toBeNull();
    expect(canonicalSave(parsed!)).toBe(text);
  });

  it("puts a v1 save's localStorage in place, and only a v1 save's", async () => {
    const items = new Map<string, string>([["old", "gone"]]);
    const standIn = { clear: () => items.clear(), setItem: (key: string, given: string) => items.set(key, given) };
    const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { value: standIn, configurable: true });
    try {
      await format.putSave({ save_format_version_number: 1, local_storage_items: { level: "3" }, indexeddb_databases: [] });
      expect(Object.fromEntries(items)).toEqual({ level: "3" });
      // A legacy bare save isn't read as localStorage.
      await expect(Promise.resolve().then(() => format.putSave({ level: "4" }))).rejects.toThrow();
      expect(Object.fromEntries(items)).toEqual({ level: "3" });
    } finally {
      if (before) Object.defineProperty(globalThis, "localStorage", before);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it("reads the v1 envelope and both shapes from before it, always answering the envelope", () => {
    const envelope = (local: Record<string, string>, databases: unknown[]) => ({ save_format_version_number: 1, local_storage_items: local, indexeddb_databases: databases });
    expect(parseSave('{"save_format_version_number":1,"local_storage_items":{"a":"1"},"indexeddb_databases":[{"name":"x"}]}')).toEqual(envelope({ a: "1" }, [{ name: "x" }]));
    // Before v1: a bare localStorage save, and one with databases.
    expect(parseSave('{"b":"2","a":"1"}')).toEqual(envelope({ b: "2", a: "1" }, []));
    expect(parseSave("{}")).toEqual(envelope({}, []));
    expect(parseSave('{"idb":[{"name":"x"}],"local":{"a":"1"}}')).toEqual(envelope({ a: "1" }, [{ name: "x" }]));
    expect(canonicalSave(parseSave('{"idb":[],"local":{"b":"2","a":"1"}}')!)).toBe('{"save_format_version_number":1,"local_storage_items":{"a":"1","b":"2"},"indexeddb_databases":[]}');
    // A later format is never half-read as v1.
    expect(parseSave('{"save_format_version_number":2,"local_storage_items":{},"indexeddb_databases":[]}')).toBeNull();
    expect(parseSave('{"save_format_version_number":1,"local_storage_items":{},"indexeddb_databases":[],"more":1}')).toBeNull();
    expect(parseSave('{"save_format_version_number":1,"local_storage_items":{"a":1},"indexeddb_databases":[]}')).toBeNull();
    // Text values make it a bare localStorage save, whatever its keys are called.
    expect(parseSave('{"idb":"a string","local":"too"}')).toEqual(envelope({ idb: "a string", local: "too" }, []));
    expect(parseSave('{"idb":[],"local":{"a":1}}')).toBeNull();
    expect(parseSave('{"idb":[],"local":{},"more":{}}')).toBeNull();
    expect(parseSave('{"a":1}')).toBeNull();
    expect(EMPTY_SAVE_TEXT).toBe('{"save_format_version_number":1,"local_storage_items":{},"indexeddb_databases":[]}');
  });
});

describe("save history", () => {
  const H = 3600_000;
  const copy = (hoursAgo: number, reason: SaveCopyReason = "hourly"): SaveCopy => ({ id: `c${hoursAgo}`, account_id: "a", game_id: "g", saved_at_ms: 1e12 - hoursAgo * H, copy_reason: reason, sha256: `h${hoursAgo}`, size_bytes: 10, version_id: null });

  it("copies when progress is about to be lost, and otherwise once an hour", () => {
    const current = { size_bytes: 1000, saved_at_ms: 1e12 };
    expect(copyReason(current, { sizeBytes: 1000, isReplacing: true }, 1e12)).toBe("account_lost");
    expect(copyReason(current, { sizeBytes: 400, isReplacing: false }, 1e12)).toBe("smaller");
    expect(copyReason(current, { sizeBytes: 900, isReplacing: false }, null)).toBe("hourly");
    expect(copyReason(current, { sizeBytes: 900, isReplacing: false }, 1e12 - H)).toBe("hourly");
    expect(copyReason(current, { sizeBytes: 900, isReplacing: false }, 1e12 - H / 2)).toBeNull();
  });

  it("keeps five: the newest always, then routine copies go first, oldest first", () => {
    const list = [copy(0), copy(1), copy(2, "account_lost"), copy(3), copy(4), copy(5, "smaller"), copy(6)];
    expect(copiesToDrop(list, 1e12).map((c) => c.id)).toEqual(["c6", "c4"]);
    expect(copiesToDrop(list.slice(0, 5), 1e12)).toEqual([]);
  });

  it("drops the oldest when every older copy is protected, and stops protecting after 30 days", () => {
    const protectedOnly = [copy(0), copy(1, "device_lost"), copy(2, "account_lost"), copy(3, "smaller"), copy(4, "restore"), copy(5, "account_lost")];
    expect(copiesToDrop(protectedOnly, 1e12).map((c) => c.id)).toEqual(["c5"]);
    const old = [copy(0), copy(1), copy(2), copy(3), copy(4), copy(31 * 24, "account_lost")];
    expect(copiesToDrop(old, 1e12).map((c) => c.id)).toEqual([`c${31 * 24}`]);
  });
});

describe("IndexedDB databases a browser can restore", () => {
  type Store = { name: string; keyPath: unknown; autoIncrement: unknown; indexes: unknown[]; records: unknown[] };
  const store = (changes: Partial<Store> = {}): Store => ({ name: "saves", keyPath: null, autoIncrement: false, indexes: [], records: [["slot-1", { level: 3 }]], ...changes });
  const database = (stores: Store[], changes: Record<string, unknown> = {}) => ({ name: "/idbfs", version: 21, stores, ...changes });
  const fieldOf = (given: unknown) => indexeddbDatabasesProblem(given)?.field ?? null;

  it("takes what the game domain script reads, with every tag", async () => {
    const value = { when: new Date(5), bytes: new Uint8Array([1, 2]), floats: new Float64Array([1.5]), map: new Map([["a", 1n]]), set: new Set([undefined]), pattern: /a/g, odd: [NaN, -0], own: { $z: "kept" }, file: new File(["hi"], "a.txt", { lastModified: 1 }) };
    const pending: Promise<void>[] = [];
    const records = format.encode([[new Date(1), value], [[1, "a"], value], [new Uint8Array([3]).buffer, value]], pending, []);
    await Promise.all(pending);
    const unity = database([store({ records: JSON.parse(JSON.stringify(records)) })]);
    const localforage = database([store({ name: "keyvaluepairs", keyPath: "id", autoIncrement: true, indexes: [{ name: "by_owner", keyPath: "owner.name", unique: false, multiEntry: true }], records: [[1, { id: 1, owner: { name: "Mia" } }], [2, { note: "no id yet" }]] })], { name: "localforage" });
    const compound = database([store({ keyPath: ["team", "slot"], indexes: [{ name: "by_both", keyPath: ["team", "slot"], unique: true, multiEntry: false }], records: [[["a", 1], { team: "a", slot: 1 }]] })], { name: "compound" });
    expect(indexeddbDatabasesProblem([])).toBeNull();
    expect(indexeddbDatabasesProblem([unity, localforage, compound])).toBeNull();
  });

  it("says where each problem is", () => {
    expect(fieldOf({})).toBe("indexeddb_databases");
    expect(fieldOf([database([]), database([])])).toBe("indexeddb_databases[1].name");
    expect(fieldOf([database([], { name: "UnityCache" })])).toBe("indexeddb_databases[0].name");
    expect(fieldOf([database([], { version: 0 })])).toBe("indexeddb_databases[0].version");
    expect(fieldOf([database([], { owner: "me" })])).toBe("indexeddb_databases[0]");
    expect(fieldOf([database([store(), store()])])).toBe("indexeddb_databases[0].stores[1].name");
    expect(fieldOf([database([store({ keyPath: "player..id" })])])).toBe("indexeddb_databases[0].stores[0].keyPath");
    expect(fieldOf([database([store({ keyPath: ["a", "b"], autoIncrement: true, records: [] })])])).toBe("indexeddb_databases[0].stores[0].autoIncrement");
    expect(fieldOf([database([store({ keyPath: "", autoIncrement: true, records: [] })])])).toBe("indexeddb_databases[0].stores[0].autoIncrement");
    const index = (changes: Record<string, unknown>) => ({ name: "by_slot", keyPath: "slot", unique: false, multiEntry: false, ...changes });
    expect(fieldOf([database([store({ indexes: [index({}), index({})] })])])).toBe("indexeddb_databases[0].stores[0].indexes[1].name");
    expect(fieldOf([database([store({ indexes: [index({ keyPath: null })] })])])).toBe("indexeddb_databases[0].stores[0].indexes[0].keyPath");
    expect(fieldOf([database([store({ indexes: [index({ keyPath: ["a", "b"], multiEntry: true })] })])])).toBe("indexeddb_databases[0].stores[0].indexes[0].multiEntry");
    expect(fieldOf([database([store({ indexes: [index({ unique: "yes" })] })])])).toBe("indexeddb_databases[0].stores[0].indexes[0].unique");
    expect(fieldOf([database([store({ records: [["only a key"]] })])])).toBe("indexeddb_databases[0].stores[0].records[0]");
    expect(fieldOf([database([store({ records: [["slot-1", { saved: { $z: ["moment", 5] } }]] })])])).toBe("indexeddb_databases[0].stores[0].records[0][1].saved.$z[0]");
    expect(fieldOf([database([store({ records: [["slot-1", { $z: ["view", "Float32Array", "AAA="] }]] })])])).toBe("indexeddb_databases[0].stores[0].records[0][1].$z");
    // Out-of-line keys must be keys IndexedDB takes.
    expect(fieldOf([database([store({ records: [[{ $z: ["num", "NaN"] }, 1]] })])])).toBe("indexeddb_databases[0].stores[0].records[0][0]");
    expect(fieldOf([database([store({ records: [[true, 1]] })])])).toBe("indexeddb_databases[0].stores[0].records[0][0]");
    // In-line keys must be in the value, unless IndexedDB makes them.
    expect(fieldOf([database([store({ keyPath: "id", records: [[1, { note: "no id" }]] })])])).toBe("indexeddb_databases[0].stores[0].records[0][1]");
    expect(fieldOf([database([store({ keyPath: "id", autoIncrement: true, records: [[1, { note: "no id" }]] })])])).toBeNull();
    expect(fieldOf([database([store({ keyPath: "id", autoIncrement: true, records: [[1, { id: { $z: ["date", { $z: ["num", "NaN"] }] } }]] })])])).toBe("indexeddb_databases[0].stores[0].records[0][1]");
  });

  it("answers a message that says what's wrong at that field", () => {
    expect(indexeddbDatabasesProblem([database([store(), store()])])).toEqual({ field: "indexeddb_databases[0].stores[1].name", message: 'indexeddb_databases[0].stores[1].name "saves" is there twice in its database.' });
  });
});

/** A record's key in the stand-in: a number or a string. */
type Key = number | string;

/**
 * A stand-in IndexedDB with what the saves script reads: databases(), open, transactions and getAll/getAllKeys
 * with a range and a count. Keys are numbers or strings. getAllCount counts the batched reads, per store.
 */
function standInIndexedDB(databases: Record<string, { version: number; stores: Record<string, [Key, unknown][]> }>) {
  const getAllCount: Record<string, number> = {};
  const compare = (a: Key, b: Key) => (typeof a === typeof b ? (a < b ? -1 : a > b ? 1 : 0) : typeof a === "number" ? -1 : 1);
  const request = () => ({ onsuccess: null as null | (() => void), onerror: null, onupgradeneeded: null as null | (() => void), result: null as unknown });
  const indexedDB = {
    databases: async () => Object.entries(databases).map(([name, database]) => ({ name, version: database.version })),
    deleteDatabase(name: string) {
      delete databases[name];
      const deleting = request();
      queueMicrotask(() => deleting.onsuccess?.());
      return deleting;
    },
    open(name: string) {
      const opening = request();
      const isCreated = !databases[name];
      if (isCreated) databases[name] = { version: 1, stores: {} };
      const database = databases[name]!;
      opening.result = {
        version: database.version,
        objectStoreNames: Object.keys(database.stores),
        close() {},
        transaction(storeNames: string[]) {
          let pendingCount = 0;
          let isEnded = false;
          const transaction = { oncomplete: null as null | (() => void), onerror: null, onabort: null as null | (() => void), error: null, abort() {}, objectStore: (storeName: string) => store(storeName) };
          transaction.abort = () => {
            isEnded = true;
            queueMicrotask(() => transaction.onabort?.());
          };
          const settle = () => {
            if (--pendingCount === 0) queueMicrotask(() => { if (pendingCount === 0 && !isEnded) { isEnded = true; transaction.oncomplete?.(); } });
          };
          const store = (storeName: string) => {
            if (!storeNames.includes(storeName)) throw new Error("not in this transaction");
            const records = () => database.stores[storeName]!.slice().sort((a, b) => compare(a[0], b[0]));
            const inRange = (range: { lower: Key; lowerOpen: boolean } | null, count: number) =>
              records().filter(([key]) => !range || compare(key, range.lower) > (range.lowerOpen ? 0 : -1)).slice(0, count);
            const answer = (result: () => unknown) => {
              const reading = request();
              pendingCount++;
              queueMicrotask(() => {
                if (isEnded) return;
                reading.result = result();
                reading.onsuccess?.();
                settle();
              });
              return reading;
            };
            return {
              name: storeName,
              keyPath: null,
              autoIncrement: false,
              indexNames: [],
              getAllKeys: (range: { lower: Key; lowerOpen: boolean } | null, count: number) => answer(() => inRange(range, count).map(([key]) => key)),
              getAll: (range: { lower: Key; lowerOpen: boolean } | null, count: number) => {
                // Only the batched reads count, not the whole reads the test compares with.
                if (count !== undefined) getAllCount[storeName] = (getAllCount[storeName] ?? 0) + 1;
                return answer(() => inRange(range, count).map(([, value]) => value));
              },
            };
          };
          return transaction;
        },
      };
      queueMicrotask(() => {
        if (isCreated) opening.onupgradeneeded?.();
        opening.onsuccess?.();
      });
      return opening;
    },
  };
  const IDBKeyRange = { lowerBound: (lower: Key, lowerOpen: boolean) => ({ lower, lowerOpen }) };
  return { indexedDB, IDBKeyRange, getAllCount };
}

interface Reader {
  readDatabases: () => Promise<unknown[]>;
  databasesReader: () => (changed: { isAll: boolean; databases: string[]; stores: string[] }, maximumCharacterCount: number) => Promise<{ text?: string; isOverLimit?: boolean }>;
  encode: Format["encode"];
}
function loadReader(databases: Parameters<typeof standInIndexedDB>[0]) {
  const standIn = standInIndexedDB(databases);
  let reader!: Reader;
  new Function("__ZAISMA_SAVES__", "window", "indexedDB", "IDBKeyRange", source)({ site: "https://zaisma.test", test: (f: Reader) => (reader = f) }, globalThis, standIn.indexedDB, standIn.IDBKeyRange);
  /** readIdbText's text: every database read whole. */
  const wholeText = async () => {
    const read = await reader.readDatabases();
    if (!read.length) return "";
    const pending: Promise<void>[] = [];
    const encoded = reader.encode(read, pending, []);
    await Promise.all(pending);
    return JSON.stringify(encoded);
  };
  return { ...standIn, read: reader.databasesReader(), wholeText };
}

const everything = { isAll: true, databases: [], stores: [] };
const nothingChanged = { isAll: false, databases: [], stores: [] };

describe("cloud saves while the game plays", () => {
  const manyRecords = () => Array.from({ length: 600 }, (_, i): [Key, unknown] => [`/idbfs/file-${String(i).padStart(4, "0")}`, { contents: new Uint8Array([i % 256]), when: new Date(i) }]);

  it("writes exactly the text a whole read gives, a batch of records at a time", async () => {
    const reader = loadReader({
      "/idbfs": { version: 21, stores: { FILE_DATA: manyRecords(), EMPTY: [] } },
      localforage: { version: 2, stores: { keyvaluepairs: [["level", 3], [7, { blob: new Blob([new Uint8Array([1, 2, 3])]) }]] } },
      empty: { version: 1, stores: { nothing: [] } },
      UnityCache: { version: 1, stores: { RESOURCES: [["big", new Uint8Array(10)]] } },
    });
    expect((await reader.read(everything, Infinity)).text).toBe(await reader.wholeText());
    // 600 small records in batches of 16, 32, 64, 128, 256 and the last 104: six reads.
    expect(reader.getAllCount.FILE_DATA).toBe(6);
  });

  it("reads again only the stores the game changed", async () => {
    const databases = { "/idbfs": { version: 21, stores: { FILE_DATA: manyRecords(), OTHER: [["a", 1]] as [Key, unknown][] } } };
    const reader = loadReader(databases);
    await reader.read(everything, Infinity);
    expect(reader.getAllCount).toEqual({ FILE_DATA: 6, OTHER: 1 });
    databases["/idbfs"].stores.OTHER.push(["b", 2]);
    const changed = await reader.read({ isAll: false, databases: [], stores: ["/idbfs\nOTHER"] }, Infinity);
    expect(reader.getAllCount).toEqual({ FILE_DATA: 6, OTHER: 2 });
    expect(changed.text).toBe(await reader.wholeText());
    expect((await reader.read(nothingChanged, Infinity)).text).toBe(changed.text);
    // Nothing changed: nothing read.
    expect(reader.getAllCount).toEqual({ FILE_DATA: 6, OTHER: 2 });
  });

  it("drops a database the game deleted", async () => {
    const databases: Parameters<typeof standInIndexedDB>[0] = { first: { version: 1, stores: { s: [["a", 1]] } }, second: { version: 1, stores: { s: [["b", 2]] } } };
    const reader = loadReader(databases);
    await reader.read(everything, Infinity);
    delete databases.second;
    const after = await reader.read({ isAll: false, databases: ["second"], stores: [] }, Infinity);
    expect(after.text).toBe(await reader.wholeText());
    expect(after.text).not.toContain('"second"');
  });

  it("stops reading once the save is past the limit", async () => {
    const reader = loadReader({ "/idbfs": { version: 21, stores: { FILE_DATA: manyRecords() } } });
    expect(await reader.read(everything, 1000)).toEqual({ isOverLimit: true });
    // The first batch already passed the limit: the rest were never read.
    expect(reader.getAllCount.FILE_DATA).toBe(1);
    const whole = await reader.read(everything, Infinity);
    expect(await reader.read(everything, whole.text!.length)).toEqual({ text: whole.text });
  });
});
