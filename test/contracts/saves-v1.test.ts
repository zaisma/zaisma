import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { EVERY_ERROR_CODE } from "../../packages/core/src/errors.ts";
import {
  CHANGED_BY_KINDS,
  canonicalSave,
  KEPT_SAVE_COPY_COUNT,
  parseSave,
  SAVE_COPY_INTERVAL_MS,
  SAVE_COPY_PROTECTION_DURATION_MS,
  SAVE_COPY_REASONS,
  SAVE_FORMAT_VERSION_NUMBER,
  SAVE_LIMIT_BYTES,
  saveContentsJson,
  saveHash,
  type SaveData,
} from "../../packages/core/src/saves.ts";
// @ts-expect-error: a plain JavaScript script without types
import { loadSiteModule } from "../../scripts/security-map/load-site.mjs";
import { ROOT } from "./surface.ts";

/**
 * The v1 cloud save: the stored text every save Zaisma keeps is in, what the game domain script (packages/sdk/saves.js)
 * reads from and puts back into a game's localStorage and IndexedDB, and the saves API and MCP. Saves already kept
 * in R2 must keep reading the same, so the corpus in test/contracts/v1/saves/ never changes: a new format adds new
 * fixtures. npm run contracts:baseline writes only the fixtures that are missing, and the saves-api snapshot.
 */

const isWritingBaseline = Boolean(process.env.CONTRACTS_WRITE_BASELINE);
const FIXTURES = "test/contracts/v1/saves";
const API_SNAPSHOT = "test/contracts/v1/saves-api.json";
const SAVES_SCRIPT = readFileSync(join(ROOT, "packages/sdk/saves.js"), "utf8");

// --- A hand-made IndexedDB: enough of one for saves.js to read, restore and drop databases, in IndexedDB's key order ---

type KeyPath = string | string[] | null;
interface IndexData {
  keyPath: string | string[];
  unique: boolean;
  multiEntry: boolean;
}
interface StoreData {
  name: string;
  keyPath: KeyPath;
  autoIncrement: boolean;
  indexes: Map<string, IndexData>;
  records: [unknown, unknown][];
  nextKey: number;
}
interface DatabaseData {
  name: string;
  version: number;
  stores: Map<string, StoreData>;
}
interface StandInRequest {
  result?: unknown;
  error?: unknown;
  onsuccess?: (() => void) | null;
  onerror?: (() => void) | null;
  onupgradeneeded?: (() => void) | null;
  onblocked?: (() => void) | null;
}

/** Where a key sorts in IndexedDB: numbers, then dates, strings, binary and arrays. Throws for what isn't a key. */
function keyRank(key: unknown): number {
  if (typeof key === "number" && !Number.isNaN(key)) return 1;
  if (key instanceof Date && !Number.isNaN(key.getTime())) return 2;
  if (typeof key === "string") return 3;
  if (key instanceof ArrayBuffer || ArrayBuffer.isView(key)) return 4;
  if (Array.isArray(key)) return (key.forEach(keyRank), 5);
  throw new Error(`DataError: ${String(key)} isn't an IndexedDB key`);
}
const bytesOf = (key: ArrayBuffer | ArrayBufferView) => (key instanceof ArrayBuffer ? new Uint8Array(key) : new Uint8Array(key.buffer, key.byteOffset, key.byteLength));
function compareLists<Item>(first: ArrayLike<Item>, second: ArrayLike<Item>, compare: (a: Item, b: Item) => number): number {
  for (let i = 0; i < Math.min(first.length, second.length); i++) {
    const order = compare(first[i]!, second[i]!);
    if (order) return order;
  }
  return first.length - second.length;
}
function compareKeys(first: unknown, second: unknown): number {
  const rank = keyRank(first);
  if (rank !== keyRank(second)) return rank - keyRank(second);
  if (rank === 2) return (first as Date).getTime() - (second as Date).getTime();
  if (rank === 4) return compareLists(bytesOf(first as ArrayBuffer), bytesOf(second as ArrayBuffer), (a, b) => a - b);
  if (rank === 5) return compareLists(first as unknown[], second as unknown[], compareKeys);
  return (first as number) < (second as number) ? -1 : (first as number) > (second as number) ? 1 : 0;
}
function valueAt(value: unknown, path: string): unknown {
  if (path === "") return value;
  return path.split(".").reduce<unknown>((at, part) => (at && typeof at === "object" && Object.prototype.hasOwnProperty.call(at, part) ? (at as Record<string, unknown>)[part] : undefined), value);
}
function keyAt(value: unknown, keyPath: string | string[]): unknown {
  if (typeof keyPath === "string") return valueAt(value, keyPath);
  const parts = keyPath.map((path) => valueAt(value, path));
  return parts.includes(undefined) ? undefined : parts;
}
/** A put, as IndexedDB does it: the key beside the value or at the store's key path, made when the store makes keys. */
function putRecord(store: StoreData, value: unknown, outOfLineKey?: unknown) {
  let key = store.keyPath === null ? outOfLineKey : keyAt(value, store.keyPath);
  if (key === undefined) {
    if (!store.autoIncrement) throw new Error(`DataError: a record in ${store.name} has no key`);
    key = store.nextKey;
    if (typeof store.keyPath === "string") {
      const parts = store.keyPath.split(".");
      const holder = parts.slice(0, -1).reduce<Record<string, unknown>>((at, part) => (at[part] ??= {}) as Record<string, unknown>, value as Record<string, unknown>);
      holder[parts.at(-1)!] = key;
    }
  }
  keyRank(key);
  if (store.autoIncrement && typeof key === "number" && key >= store.nextKey) store.nextKey = Math.floor(key) + 1;
  const at = store.records.findIndex(([kept]) => compareKeys(kept, key) >= 0);
  if (at === -1) store.records.push([key, value]);
  else if (compareKeys(store.records[at]![0], key) === 0) store.records[at] = [key, value];
  else store.records.splice(at, 0, [key, value]);
}

function standInIndexedDB() {
  const databases = new Map<string, DatabaseData>();
  const deleted: string[] = [];
  const answered = (result: unknown): StandInRequest => {
    const request: StandInRequest = { result };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  };
  const storeHandle = (store: StoreData, mode: "readonly" | "readwrite" | "versionchange") => {
    const writing = () => {
      if (mode === "readonly") throw new Error("ReadOnlyError");
    };
    return {
      name: store.name,
      keyPath: store.keyPath,
      autoIncrement: store.autoIncrement,
      get indexNames() {
        return [...store.indexes.keys()].sort();
      },
      index(name: string) {
        const index = store.indexes.get(name);
        if (!index) throw new Error(`NotFoundError: no index ${name}`);
        return { name, ...index };
      },
      createIndex(name: string, keyPath: string | string[], options: { unique?: boolean; multiEntry?: boolean } = {}) {
        if (mode !== "versionchange") throw new Error("InvalidStateError");
        store.indexes.set(name, { keyPath, unique: Boolean(options.unique), multiEntry: Boolean(options.multiEntry) });
      },
      getAll: () => answered(store.records.map(([, value]) => value)),
      getAllKeys: () => answered(store.records.map(([key]) => key)),
      clear() {
        writing();
        store.records = [];
        return answered(undefined);
      },
      put(value: unknown, key?: unknown) {
        writing();
        putRecord(store, value, key);
        return answered(key);
      },
    };
  };
  const connection = (database: DatabaseData, isUpgrading: () => boolean) => ({
    name: database.name,
    get version() {
      return database.version;
    },
    get objectStoreNames() {
      return [...database.stores.keys()].sort();
    },
    onversionchange: null as unknown,
    close() {},
    createObjectStore(name: string, options: { keyPath?: KeyPath; autoIncrement?: boolean } = {}) {
      if (!isUpgrading()) throw new Error("InvalidStateError");
      const store: StoreData = { name, keyPath: options.keyPath ?? null, autoIncrement: Boolean(options.autoIncrement), indexes: new Map(), records: [], nextKey: 1 };
      database.stores.set(name, store);
      return storeHandle(store, "versionchange");
    },
    transaction(names: string | string[], mode: "readonly" | "readwrite" = "readonly") {
      const scope = [names].flat();
      const before = new Map(scope.map((name) => [name, [...database.stores.get(name)!.records]]));
      let isAborted = false;
      const transaction = {
        error: null as unknown,
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
        objectStore(name: string) {
          if (!scope.includes(name)) throw new Error(`NotFoundError: ${name} isn't in the transaction`);
          return storeHandle(database.stores.get(name)!, mode);
        },
        abort() {
          isAborted = true;
          for (const [name, records] of before) database.stores.get(name)!.records = records;
          setTimeout(() => transaction.onabort?.(), 0);
        },
      };
      // After every request's success: they answer in microtasks.
      setTimeout(() => isAborted || transaction.oncomplete?.(), 0);
      return transaction;
    },
  });
  const indexedDB = {
    databases: () => Promise.resolve([...databases.values()].map(({ name, version }) => ({ name, version }))),
    open(name: string, version?: number) {
      const request: StandInRequest = {};
      queueMicrotask(() => {
        let database = databases.get(name);
        const wanted = version ?? database?.version ?? 1;
        if (database && wanted < database.version) {
          request.error = new Error("VersionError");
          return request.onerror?.();
        }
        const isUpgrade = !database || wanted > database.version;
        if (!database) databases.set(name, (database = { name, version: wanted, stores: new Map() }));
        database.version = wanted;
        let isUpgrading = isUpgrade;
        request.result = connection(database, () => isUpgrading);
        if (isUpgrade) request.onupgradeneeded?.();
        isUpgrading = false;
        request.onsuccess?.();
      });
      return request;
    },
    deleteDatabase(name: string) {
      databases.delete(name);
      deleted.push(name);
      return answered(undefined);
    },
  };
  const IDBKeyRange = { lowerBound: (lower: unknown, lowerOpen: boolean) => ({ lower, lowerOpen }) };
  return { indexedDB, IDBKeyRange, databases, deleted };
}

function standInLocalStorage(items: Record<string, string> = {}) {
  const kept = new Map(Object.entries(items));
  return {
    kept,
    get length() {
      return kept.size;
    },
    key: (index: number) => [...kept.keys()][index] ?? null,
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, String(value)),
    removeItem: (key: string) => void kept.delete(key),
    clear: () => kept.clear(),
  };
}

// --- A device: a game's localStorage and IndexedDB, as the game left them ---

interface StoreSpec {
  name: string;
  keyPath: KeyPath;
  autoIncrement: boolean;
  indexes: ({ name: string } & IndexData)[];
  /** [key, value]; the key is undefined where the store keeps it in the value or makes it. */
  records: [unknown, unknown][];
}
interface DatabaseSpec {
  name: string;
  version: number;
  stores: StoreSpec[];
}
interface Device {
  localStorageItems: Record<string, string>;
  databases: DatabaseSpec[];
}

interface SavesFormat {
  encode(given: unknown, pending: Promise<void>[], seen: unknown[]): unknown;
  saveText(local: Record<string, string>, idbText: string): string;
  putSave(save: SaveData, onBlocked?: () => void): Promise<void>;
  readDatabases(): Promise<unknown[]>;
}

/** The device's storage, and saves.js running on it through its .test hook. */
function onDevice(device: Device) {
  const standIn = standInIndexedDB();
  for (const spec of device.databases) {
    const stores = new Map<string, StoreData>();
    for (const store of spec.stores) {
      const data: StoreData = { name: store.name, keyPath: store.keyPath, autoIncrement: store.autoIncrement, indexes: new Map(store.indexes.map(({ name, ...index }) => [name, index])), records: [], nextKey: 1 };
      for (const [key, value] of store.records) putRecord(data, value, key);
      stores.set(store.name, data);
    }
    standIn.databases.set(spec.name, { name: spec.name, version: spec.version, stores });
  }
  const localStorage = standInLocalStorage(device.localStorageItems);
  let format!: SavesFormat;
  new Function("__ZAISMA_SAVES__", "window", "indexedDB", "IDBKeyRange", "localStorage", SAVES_SCRIPT)(
    { site: "https://zaisma.test", test: (given: SavesFormat) => (format = given) },
    { indexedDB: standIn.indexedDB },
    standIn.indexedDB,
    standIn.IDBKeyRange,
    localStorage,
  );
  /** The save text the game page sends for this device: what the script reads, encoded, in the envelope. */
  const saveText = async () => {
    const databases = await format.readDatabases();
    let idbText = "";
    if (databases.length) {
      const pending: Promise<void>[] = [];
      const encoded = format.encode(databases, pending, []);
      await Promise.all(pending);
      idbText = JSON.stringify(encoded);
    }
    return format.saveText(Object.fromEntries(localStorage.kept), idbText);
  };
  return { standIn, localStorage, format, saveText };
}

const NO_DEVICE: Device = { localStorageItems: {}, databases: [] };
const at = Date.UTC(2026, 9, 1, 12, 0, 0);
const bytes = (...values: number[]) => Uint8Array.from(values);
// Emscripten's IDBFS, which Unity and Godot builds keep their files in: paths to { timestamp, mode, contents }.
const fileSystem = (name: string, files: [string, Uint8Array | null][]): DatabaseSpec => ({
  name,
  version: 21,
  stores: [
    {
      name: "FILE_DATA",
      keyPath: null,
      autoIncrement: false,
      indexes: [{ name: "timestamp", keyPath: "timestamp", unique: false, multiEntry: false }],
      records: files.map(([path, contents]) => [path, contents ? { timestamp: new Date(at), mode: 33206, contents } : { timestamp: new Date(at), mode: 16893 }]),
    },
  ],
});
const unityCache = (): DatabaseSpec => ({
  name: "UnityCache",
  version: 4,
  stores: [{ name: "RequestStore", keyPath: "url", autoIncrement: false, indexes: [], records: [[undefined, { url: "https://example-game.games.zaisma.test/Build/game.data", response: bytes(1, 2, 3, 4) }]] }],
});
const unity = (): Device => ({
  localStorageItems: {},
  databases: [fileSystem("/idbfs", [["/idbfs/0c5c2a3f9e", null], ["/idbfs/0c5c2a3f9e/PlayerPrefs", bytes(80, 82, 69, 70, 83, 1, 0, 0)], ["/idbfs/0c5c2a3f9e/slot1.sav", bytes(0, 255, 16, 32)]]), unityCache()],
});
const localForage = (): Device => ({
  localStorageItems: { "game-settings": '{"volume":0.8}' },
  databases: [
    {
      name: "localforage",
      version: 2,
      stores: [
        { name: "keyvaluepairs", keyPath: null, autoIncrement: false, indexes: [], records: [["player", { name: "Ada", level: 12, position: { x: 1.5, y: -2 } }], ["inventory", ["sword", "shield"]], ["portrait", new Blob([bytes(137, 80, 78, 71)], { type: "image/png" })]] },
        { name: "local-forage-detect-blob-support", keyPath: null, autoIncrement: false, indexes: [], records: [] },
      ],
    },
  ],
});
const everyKind = (): Device => {
  const shared = Uint8Array.from([10, 20, 30, 40, 50, 60]).buffer;
  return {
    localStorageItems: {},
    databases: [
      {
        name: "game-data",
        version: 3,
        stores: [
          {
            name: "values",
            keyPath: null,
            autoIncrement: false,
            indexes: [],
            records: [
              ["negative-zero", -0],
              ["not-a-number", NaN],
              ["infinity", Infinity],
              ["negative-infinity", -Infinity],
              ["undefined", undefined],
              ["bigint", 12345678901234567890n],
              ["date", new Date(at)],
              ["invalid-date", new Date(NaN)],
              ["regexp", /^z(a|i)+sma$/dgimsuy],
              ["array-buffer", bytes(0, 1, 2, 254, 255).buffer],
              ["Int8Array", new Int8Array([-128, 0, 127])],
              ["Uint8Array", new Uint8Array([0, 255])],
              ["Uint8ClampedArray", new Uint8ClampedArray([0, 255])],
              ["Int16Array", new Int16Array([-32768, 32767])],
              ["Uint16Array", new Uint16Array([65535])],
              ["Int32Array", new Int32Array([-1, 2147483647])],
              ["Uint32Array", new Uint32Array([4294967295])],
              ["Float32Array", new Float32Array([1.5, -0])],
              ["Float64Array", new Float64Array([Math.PI, -Infinity])],
              ["BigInt64Array", new BigInt64Array([-1n, 2n ** 62n])],
              ["BigUint64Array", new BigUint64Array([2n ** 64n - 1n])],
              ["DataView", new DataView(bytes(9, 8, 7).buffer)],
              ["view-at-an-offset", new Uint8Array(shared, 2, 3)],
              ["blob", new Blob([bytes(1, 2, 3)], { type: "application/octet-stream" })],
              ["file", new File(["hello"], "notes.txt", { type: "text/plain", lastModified: at })],
              ["map", new Map<unknown, unknown>([["level", 3], [1, { deep: -0 }], [new Date(0), "epoch"]])],
              ["set", new Set(["sword", 7, null])],
              ["own-z-key", { $z: "the game's own field", nested: { $z: ["num", "1"] } }],
              ["nested", { list: [1, -0, undefined, "x"], isOn: true, nothing: null }],
            ],
          },
          {
            name: "keys",
            keyPath: null,
            autoIncrement: false,
            indexes: [],
            records: [["beta", "string"], [["a"], "array"], [3, "number"], [bytes(1, 2).buffer, "binary"], [new Date(at), "date"], [-1.5, "negative number"], ["alpha", "string"], [[1, "a"], "array of a number"]],
          },
          {
            name: "players",
            keyPath: "id",
            autoIncrement: true,
            indexes: [
              { name: "byName", keyPath: "name", unique: true, multiEntry: false },
              { name: "byTag", keyPath: "tags", unique: false, multiEntry: true },
            ],
            records: [[undefined, { id: 2, name: "Ben", tags: ["b"] }], [undefined, { id: 1, name: "Ada", tags: ["a", "b"] }], [undefined, { name: "Cleo", tags: [] }]],
          },
          {
            name: "slots",
            keyPath: ["world", "slot"],
            autoIncrement: false,
            indexes: [{ name: "byWorld", keyPath: ["world"], unique: false, multiEntry: false }],
            records: [[undefined, { world: "forest", slot: 2, hp: 10 }], [undefined, { world: "cave", slot: 1, hp: 4 }]],
          },
          { name: "settings", keyPath: "meta.id", autoIncrement: false, indexes: [], records: [[undefined, { meta: { id: "audio" }, volume: 0.5 }]] },
        ],
      },
    ],
  };
};

/**
 * The corpus. A device case is a save the game domain script reads off a device; a stored case is a text R2 already
 * keeps (from before v1, or a later format). Each fixture's v1 text is what Zaisma reads it as, for good.
 */
const CASES: { name: string; device?: () => Device; storedText?: () => Promise<string> }[] = [
  { name: "local-storage-only", device: () => ({ localStorageItems: { best_score: "4200", "settings.v2": '{"music":false}', ["__proto__"]: "a key named __proto__", "名前": "Ada ✨" }, databases: [] }) },
  { name: "every-z-kind", device: everyKind },
  { name: "unity-idbfs-and-skipped-unitycache", device: unity },
  { name: "godot-userfs", device: () => ({ localStorageItems: {}, databases: [fileSystem("/userfs", [["/userfs/godot", null], ["/userfs/godot/app_userdata/Game/save.cfg", bytes(91, 115, 97, 118, 101, 93)]])] }) },
  { name: "localforage", device: localForage },
  { name: "legacy-bare-local-storage", storedText: async () => JSON.stringify({ best_score: "4200", name: "Ada", settings: '{"music":false}' }) },
  {
    // Before v1 a save with databases was {"idb":…,"local":…}, in that order.
    name: "legacy-idb-and-local",
    storedText: async () => {
      const v1 = parseSave(await onDevice(localForage()).saveText())!;
      return `{"idb":${JSON.stringify(v1.indexeddb_databases)},"local":${JSON.stringify(v1.local_storage_items)}}`;
    },
  },
  { name: "format-version-2-refused", storedText: async () => JSON.stringify({ save_format_version_number: 2, local_storage_items: { best_score: "4200" }, indexeddb_databases: [] }) },
];

interface Fixture {
  name: string;
  stored_text: string;
  /** null when Zaisma refuses the stored text (a later format). */
  v1_text: string | null;
  sha256: string | null;
  size_bytes: number | null;
  projection: unknown;
}

const fixturePath = (name: string) => join(ROOT, FIXTURES, `${name}.json`);
const readFixture = (name: string) => JSON.parse(readFileSync(fixturePath(name), "utf8")) as Fixture;
const projectionOf = (v1Text: string) => JSON.parse(JSON.stringify(saveContentsJson(parseSave(v1Text)!, null)));
function onMain(path: string): string | null {
  try {
    return execFileSync("git", ["show", `origin/main:${path}`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}
function fixtureNamesOnMain(): string[] {
  try {
    return execFileSync("git", ["ls-tree", "--name-only", "origin/main", `${FIXTURES}/`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n")
      .filter((path) => path.endsWith(".json"))
      .map((path) => basename(path, ".json"));
  } catch {
    return [];
  }
}

describe("the v1 save corpus", () => {
  if (isWritingBaseline) {
    for (const saveCase of CASES) {
      it(`writes the ${saveCase.name} fixture when it's missing`, async () => {
        if (existsSync(fixturePath(saveCase.name))) return;
        const storedText = saveCase.device ? await onDevice(saveCase.device()).saveText() : await saveCase.storedText!();
        const parsed = parseSave(storedText);
        const v1Text = parsed ? canonicalSave(parsed) : null;
        const fixture: Fixture = { name: saveCase.name, stored_text: storedText, v1_text: v1Text, sha256: v1Text && (await saveHash(v1Text)), size_bytes: v1Text && Buffer.byteLength(v1Text), projection: v1Text && projectionOf(v1Text) };
        mkdirSync(join(ROOT, FIXTURES), { recursive: true });
        writeFileSync(fixturePath(saveCase.name), `${JSON.stringify(fixture, null, 2)}\n`);
      });
    }
    return;
  }

  for (const saveCase of CASES) {
    describe(saveCase.name, () => {
      const exists = existsSync(fixturePath(saveCase.name));
      it("has its fixture", () => expect(exists, `No fixture yet: npm run contracts:baseline writes ${fixturePath(saveCase.name)}`).toBe(true));
      if (!exists) return;
      const fixture = readFixture(saveCase.name);

      if (saveCase.device) {
        it("reads off the device as the same stored text", async () => {
          expect(await onDevice(saveCase.device!()).saveText()).toBe(fixture.stored_text);
        });
      }

      if (fixture.v1_text === null) {
        it("stays refused", () => expect(parseSave(fixture.stored_text)).toBeNull());
        return;
      }
      const v1Text = fixture.v1_text;
      it("reads as its v1 text, which reads as itself", () => {
        expect(canonicalSave(parseSave(fixture.stored_text)!)).toBe(v1Text);
        expect(canonicalSave(parseSave(v1Text)!)).toBe(v1Text);
        expect(JSON.parse(v1Text).save_format_version_number).toBe(1);
      });
      it("keeps its hash, size and API projection", async () => {
        expect(await saveHash(v1Text)).toBe(fixture.sha256);
        expect(Buffer.byteLength(v1Text)).toBe(fixture.size_bytes);
        expect(projectionOf(v1Text)).toEqual(fixture.projection);
      });
      it("goes onto a device and reads back byte for byte", async () => {
        const device = onDevice(NO_DEVICE);
        await device.format.putSave(parseSave(v1Text)!);
        expect(await device.saveText()).toBe(v1Text);
      });
    });
  }

  it("keeps every fixture GitHub's main has, unchanged", () => {
    for (const name of fixtureNamesOnMain()) {
      const path = `${FIXTURES}/${name}.json`;
      expect(existsSync(join(ROOT, path)), `${path} is on main: fixtures never go`).toBe(true);
      expect(readFileSync(join(ROOT, path), "utf8"), `${path} is on main: fixtures never change, a new format adds new ones`).toBe(onMain(path));
    }
  });
});

describe("putting a save in place", () => {
  it("clears localStorage, empties databases the save hasn't, recreates a changed shape and leaves caches alone", async () => {
    const save = parseSave(await onDevice(unity()).saveText())!;
    const device = onDevice({
      localStorageItems: { stale_key: "1" },
      databases: [
        { name: "old-progress", version: 1, stores: [{ name: "slots", keyPath: null, autoIncrement: false, indexes: [], records: [[1, "an old run"]] }] },
        // The same database in an older shape: no timestamp index, and another version.
        { name: "/idbfs", version: 20, stores: [{ name: "FILE_DATA", keyPath: null, autoIncrement: false, indexes: [], records: [["/idbfs/old", { mode: 1 }]] }] },
        unityCache(),
      ],
    });
    const cacheBefore = device.standIn.databases.get("UnityCache")!.stores.get("RequestStore")!.records;
    await device.format.putSave(save);

    expect(Object.fromEntries(device.localStorage.kept)).toEqual(save.local_storage_items);
    const oldProgress = device.standIn.databases.get("old-progress")!;
    expect([...oldProgress.stores.values()].map((store) => store.records)).toEqual([[]]);
    const idbfs = device.standIn.databases.get("/idbfs")!;
    expect(device.standIn.deleted).toEqual(["/idbfs"]);
    expect(idbfs.version).toBe(21);
    expect([...idbfs.stores.get("FILE_DATA")!.indexes.keys()]).toEqual(["timestamp"]);
    expect(device.standIn.databases.get("UnityCache")!.stores.get("RequestStore")!.records).toBe(cacheBefore);
    expect(await device.saveText()).toBe(canonicalSave(save));
  });
});

describe("the save limits", () => {
  const skipSource = /\bvar SKIP = (\/.+\/[a-z]*);/.exec(SAVES_SCRIPT)?.[1];
  const LIMITS: { name: string; value: number | string; now: number | string | undefined; rule: "grows only" | "exact" }[] = [
    { name: "SAVE_LIMIT_BYTES", value: 5242880, now: SAVE_LIMIT_BYTES, rule: "grows only" },
    { name: "KEPT_SAVE_COPY_COUNT", value: 5, now: KEPT_SAVE_COPY_COUNT, rule: "grows only" },
    { name: "SAVE_COPY_INTERVAL_MS", value: 3600000, now: SAVE_COPY_INTERVAL_MS, rule: "exact" },
    { name: "SAVE_COPY_PROTECTION_DURATION_MS", value: 2592000000, now: SAVE_COPY_PROTECTION_DURATION_MS, rule: "grows only" },
    { name: "SAVE_FORMAT_VERSION_NUMBER", value: 1, now: SAVE_FORMAT_VERSION_NUMBER, rule: "exact" },
    { name: "SKIP in packages/sdk/saves.js", value: "/cache/i", now: skipSource, rule: "exact" },
  ];
  for (const limit of LIMITS) {
    it(`${limit.name} ${limit.rule === "exact" ? `stays ${limit.value}` : `stays at least ${limit.value}`}`, () => {
      if (limit.rule === "exact") expect(limit.now).toBe(limit.value);
      else expect(limit.now).toBeGreaterThanOrEqual(limit.value as number);
    });
  }
  it("keeps every copy reason and changed-by kind", () => {
    expect(SAVE_COPY_REASONS).toEqual(expect.arrayContaining(["hourly", "account_lost", "smaller", "restore", "device_lost", "developer"]));
    expect(CHANGED_BY_KINDS).toEqual(expect.arrayContaining(["player", "developer"]));
  });
});

// --- The saves API and MCP ---

const SAVES_TOOLS = ["list_saves", "get_save", "change_save", "replace_save", "reset_save", "list_save_copies", "get_save_copy", "restore_save_copy"];
type Schema = Record<string, unknown>;
interface ApiSnapshot {
  tools: Record<string, { input: Schema; output: Schema }>;
  error_codes: Record<string, number>;
}

/** A schema without its words (descriptions, titles, examples), which may change freely. */
function bare(schema: unknown): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
  const out: Schema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "description" || key === "title" || key === "examples") continue;
    if (key === "properties") out[key] = Object.fromEntries(Object.entries(value as Schema).map(([name, property]) => [name, bare(property)]));
    else if (key === "items" || key === "additionalProperties" || key === "not") out[key] = bare(value);
    else if (key === "anyOf" || key === "oneOf" || key === "allOf") out[key] = (value as unknown[]).map(bare);
    else out[key] = value;
  }
  return out;
}

/** The save error codes: the Cloud saves ones in ERROR_CODES, and bad_cursor from list_saves. */
function saveErrorCodes(): Record<string, number> {
  const section = readFileSync(join(ROOT, "packages/core/src/errors.ts"), "utf8").split("// Cloud saves\n")[1]!.split("\n\n")[0]!;
  const codes = [...[...section.matchAll(/^\s+([a-z_]+): \{/gm)].map((match) => match[1]!), "bad_cursor"];
  return Object.fromEntries(codes.map((code) => [code, EVERY_ERROR_CODE[code as keyof typeof EVERY_ERROR_CODE].httpStatus]));
}

const typesOf = (schema: Schema) => JSON.stringify([schema.type ?? []].flat().sort());
const childSchemas = (was: Schema, now: Schema, path: string): [Schema, Schema, string][] => {
  const pairs: [Schema, Schema, string][] = [];
  for (const key of ["items", "additionalProperties"] as const) {
    if (was[key] && now[key] && typeof was[key] === "object" && typeof now[key] === "object") pairs.push([was[key] as Schema, now[key] as Schema, `${path}${key === "items" ? "[]" : "{}"}`]);
  }
  const wasAnyOf = (was.anyOf ?? []) as Schema[];
  const nowAnyOf = (now.anyOf ?? []) as Schema[];
  for (let i = 0; i < Math.min(wasAnyOf.length, nowAnyOf.length); i++) pairs.push([wasAnyOf[i]!, nowAnyOf[i]!, `${path}|${i}`]);
  return pairs;
};

/** What an answer lost: a property gone, a type changed, a property no longer required. Additions pass. */
function outputLost(was: Schema, now: Schema, path: string): string[] {
  const lost: string[] = [];
  if (typesOf(was) !== typesOf(now)) lost.push(`${path} was ${typesOf(was)}, now ${typesOf(now)}`);
  if (((was.anyOf ?? []) as unknown[]).length !== ((now.anyOf ?? []) as unknown[]).length) lost.push(`${path} changed its anyOf`);
  const wasProperties = (was.properties ?? {}) as Record<string, Schema>;
  const nowProperties = (now.properties ?? {}) as Record<string, Schema>;
  const nowRequired = (now.required ?? []) as string[];
  for (const [name, property] of Object.entries(wasProperties)) {
    if (!nowProperties[name]) lost.push(`${path}.${name} is gone`);
    else lost.push(...outputLost(property, nowProperties[name], `${path}.${name}`));
    if (((was.required ?? []) as string[]).includes(name) && !nowRequired.includes(name)) lost.push(`${path}.${name} stopped being required`);
  }
  for (const [wasChild, nowChild, childPath] of childSchemas(was, now, path)) lost.push(...outputLost(wasChild, nowChild, childPath));
  return lost;
}

/** What an input tightened: a property gone, a type taken away, a new required property, an enum value gone, a pattern added or changed, a lower maxLength or maxItems. */
function inputTightened(was: Schema, now: Schema, path: string): string[] {
  const tightened: string[] = [];
  const nowTypes = [now.type ?? []].flat();
  if (nowTypes.length) for (const type of [was.type ?? []].flat()) if (!nowTypes.includes(type)) tightened.push(`${path} no longer takes ${String(type)}`);
  for (const name of Object.keys((was.properties ?? {}) as Record<string, Schema>)) if (!((now.properties ?? {}) as Record<string, Schema>)[name]) tightened.push(`${path}.${name} is gone`);
  const wasRequired = (was.required ?? []) as string[];
  for (const name of (now.required ?? []) as string[]) if (!wasRequired.includes(name)) tightened.push(`${path}.${name} became required`);
  if (Array.isArray(now.enum) && Array.isArray(was.enum)) for (const value of was.enum) if (!now.enum.includes(value)) tightened.push(`${path} lost the enum value ${JSON.stringify(value)}`);
  if (now.pattern !== undefined && now.pattern !== was.pattern) tightened.push(`${path} pattern was ${String(was.pattern)}, now ${String(now.pattern)}`);
  for (const limit of ["maxLength", "maxItems"] as const) {
    if (now[limit] !== undefined && (was[limit] === undefined || (now[limit] as number) < (was[limit] as number))) tightened.push(`${path} ${limit} was ${String(was[limit])}, now ${String(now[limit])}`);
  }
  const wasProperties = (was.properties ?? {}) as Record<string, Schema>;
  const nowProperties = (now.properties ?? {}) as Record<string, Schema>;
  for (const [name, property] of Object.entries(wasProperties)) if (nowProperties[name]) tightened.push(...inputTightened(property, nowProperties[name], `${path}.${name}`));
  for (const [wasChild, nowChild, childPath] of childSchemas(was, now, path)) tightened.push(...inputTightened(wasChild, nowChild, childPath));
  return tightened;
}

/** What the API and MCP lost since a snapshot. Error codes are exact. */
function apiLostSince(snapshot: ApiSnapshot, current: ApiSnapshot): string[] {
  const lost: string[] = [];
  for (const [name, was] of Object.entries(snapshot.tools)) {
    const now = current.tools[name];
    if (!now) lost.push(`${name} is gone`);
    else lost.push(...outputLost(was.output, now.output, `${name} output`), ...inputTightened(was.input, now.input, `${name} input`));
  }
  for (const [code, status] of Object.entries(snapshot.error_codes)) if (current.error_codes[code] !== status) lost.push(`${code} was ${status}, now ${String(current.error_codes[code])}`);
  return lost;
}

describe("the saves API and MCP", async () => {
  const site = (await loadSiteModule(ROOT)) as { TOOLS: { name: string; inputSchema: unknown; outputSchema: unknown }[] };
  const current: ApiSnapshot = {
    tools: Object.fromEntries(
      SAVES_TOOLS.map((name) => {
        const tool = site.TOOLS.find((candidate) => candidate.name === name);
        if (!tool) throw new Error(`The MCP has no ${name}`);
        return [name, { input: bare(tool.inputSchema) as Schema, output: bare(tool.outputSchema) as Schema }];
      }),
    ),
    error_codes: saveErrorCodes(),
  };
  const path = join(ROOT, API_SNAPSHOT);

  if (isWritingBaseline) {
    it("writes the saves-api snapshot", () => writeFileSync(path, `${JSON.stringify(current, null, 2)}\n`));
    return;
  }
  it("keeps everything the v1 saves-api snapshot has", () => {
    expect(existsSync(path), `No snapshot yet: npm run contracts:baseline writes ${path}`).toBe(true);
    const snapshot = JSON.parse(readFileSync(path, "utf8")) as ApiSnapshot;
    expect(apiLostSince(snapshot, current), "v1 only gains things. A deliberate change: npm run contracts:baseline").toEqual([]);
    expect(Object.keys(current.error_codes).filter((code) => !(code in snapshot.error_codes)), "New save error codes: npm run contracts:baseline").toEqual([]);
  });
  it("keeps everything the v1 saves-api snapshot has on GitHub's main", () => {
    const onMainText = onMain(API_SNAPSHOT);
    if (onMainText) expect(apiLostSince(JSON.parse(onMainText) as ApiSnapshot, current), "v1 only gains things, and main's snapshot is v1 as it shipped").toEqual([]);
  });
});
