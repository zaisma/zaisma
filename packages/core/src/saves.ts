import { iso } from "./time.ts";

/** Largest cloud save per game per player. */
export const SAVE_LIMIT_BYTES = 5 * 1024 * 1024;

/** The stored save format's version: the first key of every save Zaisma writes, so later formats can be told apart. */
export const SAVE_FORMAT_VERSION_NUMBER = 1;

/**
 * A browser save as Zaisma stores it: the game's localStorage as { key: text }, and its IndexedDB
 * databases as the game domain script reads them (packages/sdk/saves.js), [] when it keeps none; we
 * only store those. The keys keep their snake_case: they are the stored text and the API's names.
 */
export interface SaveData {
  save_format_version_number: typeof SAVE_FORMAT_VERSION_NUMBER;
  local_storage_items: Record<string, string>;
  indexeddb_databases: unknown[];
}

/**
 * A save as one stable string: always all three keys in this order, localStorage keys sorted, so the
 * same save always gives the same text and hash. The game page and the game domain script write the
 * same text, so all three agree on what "the same save" means.
 */
export function canonicalSave(save: SaveData): string {
  return JSON.stringify({ save_format_version_number: SAVE_FORMAT_VERSION_NUMBER, local_storage_items: sorted(save.local_storage_items), indexeddb_databases: save.indexeddb_databases });
}

/** A save with nothing in it: what a reset writes, and what "is it empty" compares with. */
export const EMPTY_SAVE_TEXT = canonicalSave({ save_format_version_number: SAVE_FORMAT_VERSION_NUMBER, local_storage_items: {}, indexeddb_databases: [] });

function sorted(localStorageItems: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(localStorageItems).sort()) Object.defineProperty(out, key, { value: localStorageItems[key]!, enumerable: true, writable: true, configurable: true });
  return out;
}

/** A save from its two parts. */
export function saveFromParts(localStorageItems: Record<string, string>, indexeddbDatabases: unknown[]): SaveData {
  return { save_format_version_number: SAVE_FORMAT_VERSION_NUMBER, local_storage_items: localStorageItems, indexeddb_databases: indexeddbDatabases };
}

const strings = (candidate: unknown): candidate is Record<string, string> =>
  Boolean(candidate) && typeof candidate === "object" && !Array.isArray(candidate) && Object.values(candidate as object).every((entry) => typeof entry === "string");

const hasExactKeys = (candidate: object, keys: string[]) => Object.keys(candidate).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(candidate, key));

/**
 * A save from a client or storage, or null if it isn't one. Takes the v1 envelope, and the two shapes
 * from before it: a bare { key: text } (localStorage only) and { idb, local }. Always answers the envelope.
 * An envelope with another save_format_version_number is null, so a later format is never misread.
 */
export function parseSave(text: string): SaveData | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (strings(parsed)) return saveFromParts(parsed, []);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const given = parsed as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(given, "save_format_version_number")) {
    const isV1 = hasExactKeys(given, ["save_format_version_number", "local_storage_items", "indexeddb_databases"]) && given.save_format_version_number === SAVE_FORMAT_VERSION_NUMBER;
    return isV1 && strings(given.local_storage_items) && Array.isArray(given.indexeddb_databases) ? saveFromParts(given.local_storage_items, given.indexeddb_databases) : null;
  }
  return hasExactKeys(given, ["idb", "local"]) && Array.isArray(given.idb) && strings(given.local) ? saveFromParts(given.local, given.idb) : null;
}

export async function saveHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Who made a save's current version: the player's game (saved from one of their devices, or the player
 * going back to an earlier version) or the game's developer, through the API or MCP.
 */
export const CHANGED_BY_KINDS = ["player", "developer"] as const;
export type ChangedByKind = (typeof CHANGED_BY_KINDS)[number];

export interface SaveRow {
  account_id: string;
  game_id: string;
  version_number: number;
  sha256: string;
  size_bytes: number;
  saved_at_ms: number;
  changed_by_kind: ChangedByKind;
  /** The game version that saved it, as the page reported it; null for a save the developer changed, replaced or reset, and for one from before Zaisma kept it; a restored save has the restored copy's. */
  version_id: string | null;
}

export async function saveRow(database: D1Database, accountId: string, gameId: string): Promise<SaveRow | null> {
  return database.prepare("SELECT * FROM saves WHERE account_id = ? AND game_id = ?").bind(accountId, gameId).first<SaveRow>();
}

/**
 * Move a save from version `baseVersionNumber` to the next one, only if nobody else did first.
 * `versionId` is the game version that saved it (null for the developer's writes). Returns the new
 * version number, or null when another device saved in between.
 */
export async function bumpSave(
  database: D1Database,
  save: { accountId: string; gameId: string; baseVersionNumber: number; sha256: string; sizeBytes: number; changedByKind: ChangedByKind; versionId: string | null },
): Promise<number | null> {
  const savedAtMs = Date.now();
  const writeResult =
    save.baseVersionNumber === 0
      ? await database
          .prepare("INSERT INTO saves (account_id, game_id, version_number, sha256, size_bytes, saved_at_ms, changed_by_kind, version_id) VALUES (?, ?, 1, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
          .bind(save.accountId, save.gameId, save.sha256, save.sizeBytes, savedAtMs, save.changedByKind, save.versionId)
          .run()
      : await database
          .prepare("UPDATE saves SET version_number = version_number + 1, sha256 = ?, size_bytes = ?, saved_at_ms = ?, changed_by_kind = ?, version_id = ? WHERE account_id = ? AND game_id = ? AND version_number = ?")
          .bind(save.sha256, save.sizeBytes, savedAtMs, save.changedByKind, save.versionId, save.accountId, save.gameId, save.baseVersionNumber)
          .run();
  return writeResult.meta.changes === 1 ? save.baseVersionNumber + 1 : null;
}

/** One player's save in a game, as the developer API lists them. */
export interface GameSaveRow extends SaveRow {
  player_id: string;
  save_copy_count: number;
}

/**
 * A game's saves by player ID, in player ID order (stable while saves change), `pageSaveCount` at a time,
 * after `afterPlayerId` when given. Answers one more than a page when there is more.
 */
export async function gameSaves(database: D1Database, gameId: string, afterPlayerId: string | null, pageSaveCount: number): Promise<GameSaveRow[]> {
  const { results } = await database
    .prepare(
      "SELECT saves.*, accounts.player_id, (SELECT COUNT(*) FROM save_history WHERE save_history.account_id = saves.account_id AND save_history.game_id = saves.game_id) AS save_copy_count FROM saves JOIN accounts ON accounts.id = saves.account_id WHERE saves.game_id = ? AND accounts.player_id > ? ORDER BY accounts.player_id LIMIT ?",
    )
    .bind(gameId, afterPlayerId ?? "", pageSaveCount + 1)
    .all<GameSaveRow>();
  return results;
}

/** Where a save's data lives in the saves bucket. Listing <account>/ finds all of a player's saves. */
export const saveKey = (accountId: string, gameId: string) => `${accountId}/${gameId}.json`;

// --- Save history: earlier versions, so "my progress is gone" can be undone ---

/** Earlier versions kept per player per game. */
export const KEPT_SAVE_COPY_COUNT = 5;
/** While playing, at most one routine copy an hour. */
export const SAVE_COPY_INTERVAL_MS = 3600_000;
/** Copies made because progress was about to be lost are kept over routine ones for this long. */
export const SAVE_COPY_PROTECTION_DURATION_MS = 30 * 24 * 3600_000;

/**
 * Why a copy was kept: a routine hourly copy, or because progress was about to be lost:
 * the account's progress was replaced by another device's, played more recently (account_lost), the game's
 * save shrank to under half (smaller, usually a reset), the player went back to an earlier version in the
 * game (restore, through Zaisma.saves.restoreCopy), a device's progress was older than the account's
 * (device_lost), or the game's developer changed, reset or restored the save through the API (developer).
 */
export const SAVE_COPY_REASONS = ["hourly", "account_lost", "smaller", "restore", "device_lost", "developer"] as const;
export type SaveCopyReason = (typeof SAVE_COPY_REASONS)[number];

export interface SaveCopy {
  id: string;
  account_id: string;
  game_id: string;
  saved_at_ms: number;
  copy_reason: SaveCopyReason;
  sha256: string;
  size_bytes: number;
  /** The game version that saved this progress; null when the developer wrote it, or Zaisma didn't know. */
  version_id: string | null;
}

export const saveCopyKey = (accountId: string, gameId: string, id: string) => `${accountId}/${gameId}/${id}.json`;

/** A game's earlier versions, newest first. */
export async function saveHistory(database: D1Database, accountId: string, gameId: string): Promise<SaveCopy[]> {
  const { results } = await database.prepare("SELECT * FROM save_history WHERE account_id = ? AND game_id = ? ORDER BY saved_at_ms DESC, id").bind(accountId, gameId).all<SaveCopy>();
  return results;
}

/**
 * Whether to keep a copy of the current save before it's replaced, and why.
 * `isReplacing` is set when this device's progress was played more recently than the account's and replaces it.
 */
export function copyReason(current: { size_bytes: number; saved_at_ms: number }, next: { sizeBytes: number; isReplacing: boolean }, newestCopyAtMs: number | null): SaveCopyReason | null {
  if (next.isReplacing) return "account_lost";
  if (next.sizeBytes * 2 < current.size_bytes) return "smaller";
  if (newestCopyAtMs === null || current.saved_at_ms - newestCopyAtMs >= SAVE_COPY_INTERVAL_MS) return "hourly";
  return null;
}

/**
 * Which copies to drop to stay at KEPT_SAVE_COPY_COUNT. The newest always stays. Past that, the
 * oldest routine copy goes first, so a copy from right before progress was lost outlives a day
 * of hourly copies; after 30 days it counts as routine. The copy being added (`addedCopyId`) never goes,
 * even when it's dated to a device's last play long ago.
 */
export function copiesToDrop(copies: SaveCopy[], nowMs: number, addedCopyId: string | null = null): SaveCopy[] {
  const keep = [...copies].sort((first, second) => second.saved_at_ms - first.saved_at_ms);
  const drop: SaveCopy[] = [];
  const droppable = (copy: SaveCopy) => copy.id !== addedCopyId;
  const routine = (copy: SaveCopy) => droppable(copy) && (copy.copy_reason === "hourly" || nowMs - copy.saved_at_ms > SAVE_COPY_PROTECTION_DURATION_MS);
  while (keep.length > KEPT_SAVE_COPY_COUNT) {
    let i = keep.length - 1;
    while (i > 0 && !routine(keep[i]!)) i--;
    if (i === 0) {
      i = keep.length - 1;
      while (i > 0 && !droppable(keep[i]!)) i--;
    }
    drop.push(...keep.splice(i, 1));
  }
  return drop;
}

/** Record a copy (its data is already in R2) next to the game's `copies`, and return the ones to delete to make room. */
export async function addSaveCopy(database: D1Database, copy: SaveCopy, copies: SaveCopy[], nowMs = Date.now()): Promise<SaveCopy[]> {
  const dropped = copiesToDrop([copy, ...copies], nowMs, copy.id);
  await database.batch([
    database
      .prepare("INSERT INTO save_history (id, account_id, game_id, saved_at_ms, copy_reason, sha256, size_bytes, version_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(copy.id, copy.account_id, copy.game_id, copy.saved_at_ms, copy.copy_reason, copy.sha256, copy.size_bytes, copy.version_id),
    ...dropped.map((droppedCopy) => database.prepare("DELETE FROM save_history WHERE id = ?").bind(droppedCopy.id)),
  ]);
  return dropped;
}

/** An earlier version as the player's game page and the developer API list it (the API adds its sha256). */
export function saveCopyJson(copy: SaveCopy, row: SaveRow | null) {
  return { id: copy.id, saved_at: iso(copy.saved_at_ms), copy_reason: copy.copy_reason, size_bytes: copy.size_bytes, is_current_save: row?.sha256 === copy.sha256, version_id: copy.version_id };
}

/** What a save holds; with keys, only those localStorage keys (and no databases, which can be big). */
export function saveContentsJson(save: SaveData, keys: string[] | null) {
  if (!keys) return { local_storage_items: save.local_storage_items, missing_keys: [], indexeddb_databases: save.indexeddb_databases };
  const has = (key: string) => Object.prototype.hasOwnProperty.call(save.local_storage_items, key);
  return {
    local_storage_items: Object.fromEntries(keys.filter(has).map((key) => [key, save.local_storage_items[key]!])),
    missing_keys: keys.filter((key) => !has(key)),
    indexeddb_databases: null,
  };
}

/** A save as stored: always one parseSave takes, since only canonicalSave writes them (older ones in a shape from before v1). */
export function readStoredSave(text: string): SaveData {
  return parseSave(text) ?? saveFromParts({}, []);
}

// --- IndexedDB databases a browser can restore (replace_save) ---

/** Every typed array and DataView the game domain script tags as "view", with each one's item size in bytes. */
const VIEW_ITEM_SIZES_BYTES: Record<string, number> = {
  Int8Array: 1, Uint8Array: 1, Uint8ClampedArray: 1, Int16Array: 2, Uint16Array: 2, Int32Array: 4, Uint32Array: 4,
  Float32Array: 4, Float64Array: 8, BigInt64Array: 8, BigUint64Array: 8, DataView: 1,
};
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const KEY_PATH_IDENTIFIER = /^[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*$/u;

/** How deep a record's value or key may nest: far past anything IndexedDB holds, and well short of the call stack. */
const MAXIMUM_NESTING_LEVEL_COUNT = 1000;

/** A problem with one field, thrown while checking and answered by indexeddbDatabasesProblem. */
class DatabasesProblem {
  constructor(
    readonly field: string,
    readonly message: string,
  ) {}
}

/** What a decoded value is, as far as IndexedDB keys and key paths care. */
class BinaryValue {}
class BlobValue {
  constructor(
    readonly sizeBytes: number,
    readonly type: string,
    readonly fileName: string | null,
    readonly lastModifiedMs: number | null,
  ) {}
}
class OtherValue {}

/**
 * What's wrong with `given` as a save's indexeddb_databases, or null when a browser can restore it: the shape the
 * game domain script reads and restores (packages/sdk/saves.js), its tagged values ({ "$z": [kind, …] }) and keys
 * IndexedDB takes. `field` is where, like indexeddb_databases[0].stores[1].keyPath. The developer API's replace_save
 * checks with it, so a bad save is refused at the call instead of breaking the player's game.
 */
export function indexeddbDatabasesProblem(given: unknown): { field: string; message: string } | null {
  try {
    checkDatabases(given);
    return null;
  } catch (error) {
    if (error instanceof DatabasesProblem) return { field: error.field, message: error.message };
    throw error;
  }
}

function refuse(field: string, message: string): never {
  throw new DatabasesProblem(field, `${field} ${message}`);
}

const isPlainObject = (candidate: unknown): candidate is Record<string, unknown> => Boolean(candidate) && typeof candidate === "object" && !Array.isArray(candidate);
const describeValue = (candidate: unknown) => (candidate === null ? "null" : Array.isArray(candidate) ? "a list" : typeof candidate === "object" ? "an object" : `a ${typeof candidate}`);

function checkKeys(candidate: unknown, keys: string[], field: string, what: string): asserts candidate is Record<string, unknown> {
  if (!isPlainObject(candidate)) refuse(field, `is ${describeValue(candidate)}, not ${what} { ${keys.join(", ")} }.`);
  const extra = Object.keys(candidate).find((key) => !keys.includes(key));
  if (extra !== undefined) refuse(field, `has ${JSON.stringify(extra)}, which ${what} doesn't have: only ${keys.join(", ")}.`);
  const missing = keys.find((key) => !Object.prototype.hasOwnProperty.call(candidate, key));
  if (missing !== undefined) refuse(field, `has no ${missing}: ${what} has ${keys.join(", ")}.`);
}

function checkBoolean(candidate: unknown, field: string): void {
  if (typeof candidate !== "boolean") refuse(field, `is ${describeValue(candidate)}, not true or false.`);
}

function checkUniqueName(name: unknown, field: string, names: Set<string>, within: string): void {
  if (typeof name !== "string") refuse(field, `is ${describeValue(name)}, not text.`);
  if (names.has(name)) refuse(field, `${JSON.stringify(name)} is there twice in ${within}.`);
  names.add(name);
}

const isKeyPathText = (candidate: unknown): candidate is string => typeof candidate === "string" && (candidate === "" || candidate.split(".").every((identifier) => KEY_PATH_IDENTIFIER.test(identifier)));

/** A key path: text ("" or names joined by dots), or a non-empty list of those. */
function checkKeyPath(candidate: unknown, field: string): void {
  if (isKeyPathText(candidate)) return;
  if (Array.isArray(candidate) && candidate.length && candidate.every(isKeyPathText)) return;
  refuse(field, `is ${typeof candidate === "string" ? JSON.stringify(candidate) : describeValue(candidate)}, not a key path: "" or names joined by dots, like "player.id", or a non-empty list of those.`);
}

function checkDatabases(given: unknown): void {
  const field = "indexeddb_databases";
  if (!Array.isArray(given)) refuse(field, `is ${describeValue(given)}, not a list of databases.`);
  const databaseNames = new Set<string>();
  given.forEach((database, databaseIndex) => {
    const databaseField = `${field}[${databaseIndex}]`;
    checkKeys(database, ["name", "version", "stores"], databaseField, "a database");
    checkUniqueName(database.name, `${databaseField}.name`, databaseNames, field);
    const name = database.name as string;
    if (!name) refuse(`${databaseField}.name`, "is empty: a database needs a name.");
    if (/cache/i.test(name)) refuse(`${databaseField}.name`, `${JSON.stringify(name)} has "cache" in it: saves leave out databases named so (like Unity's UnityCache), since they hold downloaded game files, not progress.`);
    if (!Number.isSafeInteger(database.version) || (database.version as number) < 1) refuse(`${databaseField}.version`, `is ${JSON.stringify(database.version)}, not a whole number from 1 to 9007199254740991.`);
    if (!Array.isArray(database.stores)) refuse(`${databaseField}.stores`, `is ${describeValue(database.stores)}, not a list of stores.`);
    const storeNames = new Set<string>();
    database.stores.forEach((store, storeIndex) => checkStore(store, `${databaseField}.stores[${storeIndex}]`, storeNames));
  });
}

function checkStore(store: unknown, field: string, storeNames: Set<string>): void {
  checkKeys(store, ["name", "keyPath", "autoIncrement", "indexes", "records"], field, "a store");
  checkUniqueName(store.name, `${field}.name`, storeNames, "its database");
  const keyPath = store.keyPath;
  if (keyPath !== null) checkKeyPath(keyPath, `${field}.keyPath`);
  checkBoolean(store.autoIncrement, `${field}.autoIncrement`);
  if (store.autoIncrement && (Array.isArray(keyPath) || keyPath === "")) {
    refuse(`${field}.autoIncrement`, `is true with keyPath ${JSON.stringify(keyPath)}: IndexedDB makes keys only for a store with no key path or a key path of names, so make it false.`);
  }
  if (!Array.isArray(store.indexes)) refuse(`${field}.indexes`, `is ${describeValue(store.indexes)}, not a list of indexes.`);
  const indexNames = new Set<string>();
  store.indexes.forEach((index, indexIndex) => {
    const indexField = `${field}.indexes[${indexIndex}]`;
    checkKeys(index, ["name", "keyPath", "unique", "multiEntry"], indexField, "an index");
    checkUniqueName(index.name, `${indexField}.name`, indexNames, "its store");
    checkKeyPath(index.keyPath, `${indexField}.keyPath`);
    checkBoolean(index.unique, `${indexField}.unique`);
    checkBoolean(index.multiEntry, `${indexField}.multiEntry`);
    if (index.multiEntry && Array.isArray(index.keyPath)) refuse(`${indexField}.multiEntry`, "is true with a list as keyPath: IndexedDB takes multiEntry only with a single key path, so make it false.");
  });
  if (!Array.isArray(store.records)) refuse(`${field}.records`, `is ${describeValue(store.records)}, not a list of [key, value] records.`);
  store.records.forEach((record, recordIndex) => {
    const recordField = `${field}.records[${recordIndex}]`;
    if (!Array.isArray(record) || record.length !== 2) refuse(recordField, `is ${describeValue(record)}${Array.isArray(record) ? ` of ${record.length}` : ""}, not a [key, value] pair.`);
    const key = decodeValue(record[0], `${recordField}[0]`);
    const recordValue = decodeValue(record[1], `${recordField}[1]`);
    if (keyPath === null) {
      if (!isValidKey(key)) refuse(`${recordField}[0]`, "isn't a key IndexedDB takes: text, a number (not NaN), a valid date, binary data, or a list of those.");
      return;
    }
    const inLineKey = evaluateKeyPath(recordValue, keyPath as string | string[]);
    if (inLineKey === MISSING && store.autoIncrement) return;
    if (inLineKey === MISSING || !isValidKey(inLineKey)) {
      refuse(`${recordField}[1]`, `has no key IndexedDB takes at keyPath ${JSON.stringify(keyPath)}: the value there must be text, a number (not NaN), a valid date, binary data, or a list of those.`);
    }
  });
}

const MISSING = Symbol("missing");

/** IndexedDB's own rule for a key path on a value: names into objects' own properties, and a few properties of text, lists, blobs and files. */
function evaluateKeyPath(source: unknown, keyPath: string | string[]): unknown {
  if (Array.isArray(keyPath)) {
    const keys = keyPath.map((path) => evaluateKeyPath(source, path));
    return keys.includes(MISSING) ? MISSING : keys;
  }
  if (keyPath === "") return source;
  let current = source;
  for (const identifier of keyPath.split(".")) {
    if (typeof current === "string" && identifier === "length") current = current.length;
    else if (Array.isArray(current) && identifier === "length") current = current.length;
    else if (current instanceof BlobValue) {
      // A Blob's size and type, and a File's name and lastModified, as the browser's key path evaluation reads them.
      if (identifier === "size") current = current.sizeBytes;
      else if (identifier === "type") current = current.type;
      else if (identifier === "name" && current.fileName !== null) current = current.fileName;
      else if (identifier === "lastModified" && current.lastModifiedMs !== null) current = current.lastModifiedMs;
      else return MISSING;
    } else if (current !== null && typeof current === "object" && Object.prototype.hasOwnProperty.call(current, identifier)) {
      current = (current as Record<string, unknown>)[identifier];
    } else return MISSING;
  }
  return current;
}

function isValidKey(candidate: unknown): boolean {
  if (typeof candidate === "string") return true;
  if (typeof candidate === "number") return !Number.isNaN(candidate);
  if (candidate instanceof Date) return !Number.isNaN(candidate.getTime());
  if (candidate instanceof BinaryValue) return true;
  return Array.isArray(candidate) && candidate.every(isValidKey);
}

const fieldOf = (field: string, key: string) => (/^[A-Za-z_$][\w$]*$/.test(key) ? `${field}.${key}` : `${field}[${JSON.stringify(key)}]`);
const base64ByteCount = (text: string) => (text.length / 4) * 3 - (text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0);

/**
 * A record's key or value as the game domain script's decode would give it back (the same table of tags), as far
 * as keys and key paths care: refused when a tag is unknown or its fields aren't that tag's.
 */
function decodeValue(encoded: unknown, field: string, depth = 0): unknown {
  if (depth > MAXIMUM_NESTING_LEVEL_COUNT) refuse(field, `is nested more than ${MAXIMUM_NESTING_LEVEL_COUNT} levels deep, more than a browser restores.`);
  if (encoded === null || typeof encoded !== "object") return encoded;
  if (Array.isArray(encoded)) return encoded.map((encodedItem, itemIndex) => decodeValue(encodedItem, `${field}[${itemIndex}]`, depth + 1));
  const record = encoded as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(record, "$z")) return decodePlain(record, field, depth);
  const tagField = `${field}.$z`;
  const tag = record.$z;
  if (Object.keys(record).length !== 1) refuse(field, 'has more keys than "$z": a tagged value is { "$z": [kind, …] } alone (an object with its own "$z" key is tagged "obj").');
  if (!Array.isArray(tag) || typeof tag[0] !== "string") refuse(tagField, 'isn\'t a tag: a tagged value is { "$z": [kind, …] }.');
  const fields = (fieldCount: number, rule: string, isRight: boolean) => {
    if (tag.length !== fieldCount || !isRight) refuse(tagField, `isn't a "${tag[0]}" tag: that's ${rule}.`);
  };
  const isBase64 = (candidate: unknown): candidate is string => typeof candidate === "string" && BASE64.test(candidate);
  switch (tag[0]) {
    case "num":
      fields(2, '["num", text like "NaN", "-0" or "Infinity"]', typeof tag[1] === "string");
      return Number(tag[1]);
    case "undef":
      fields(1, '["undef"]', true);
      return undefined;
    case "bigint":
      fields(2, '["bigint", whole number as text]', typeof tag[1] === "string" && /^-?\d+$/.test(tag[1]));
      return new OtherValue();
    case "date": {
      fields(2, '["date", its time in ms, a number or a "num" tag]', true);
      const timeMs = decodeValue(tag[1], `${tagField}[1]`, depth + 1);
      if (typeof timeMs !== "number") refuse(`${tagField}[1]`, "isn't a time in ms: a number, or a \"num\" tag.");
      return new Date(timeMs);
    }
    case "regexp": {
      fields(3, '["regexp", source, flags]', typeof tag[1] === "string" && typeof tag[2] === "string");
      try {
        new RegExp(tag[1] as string, tag[2] as string);
      } catch {
        refuse(tagField, "isn't a regular expression a browser makes.");
      }
      return new OtherValue();
    }
    case "bytes":
      fields(2, '["bytes", base64]', isBase64(tag[1]));
      return new BinaryValue();
    case "view": {
      fields(3, `["view", ${Object.keys(VIEW_ITEM_SIZES_BYTES).join(" or ")}, base64]`, typeof tag[1] === "string" && Object.prototype.hasOwnProperty.call(VIEW_ITEM_SIZES_BYTES, tag[1]) && isBase64(tag[2]));
      if (base64ByteCount(tag[2] as string) % VIEW_ITEM_SIZES_BYTES[tag[1] as string]! !== 0) refuse(tagField, `has bytes that don't fill whole ${tag[1]} items.`);
      return new BinaryValue();
    }
    case "blob":
      fields(3, '["blob", type, base64]', typeof tag[1] === "string" && isBase64(tag[2]));
      return new BlobValue(base64ByteCount(tag[2] as string), tag[1] as string, null, null);
    case "file":
      fields(5, '["file", type, base64, name, lastModified in ms]', typeof tag[1] === "string" && isBase64(tag[2]) && typeof tag[3] === "string" && typeof tag[4] === "number");
      return new BlobValue(base64ByteCount(tag[2] as string), tag[1] as string, tag[3] as string, tag[4] as number);
    case "map":
      fields(2, '["map", [[key, value], …]]', Array.isArray(tag[1]));
      (tag[1] as unknown[]).forEach((entry, entryIndex) => {
        if (!Array.isArray(entry) || entry.length !== 2) refuse(`${tagField}[1][${entryIndex}]`, "isn't a [key, value] pair.");
        decodeValue(entry[0], `${tagField}[1][${entryIndex}][0]`, depth + 1);
        decodeValue(entry[1], `${tagField}[1][${entryIndex}][1]`, depth + 1);
      });
      return new OtherValue();
    case "set":
      fields(2, '["set", [item, …]]', Array.isArray(tag[1]));
      (tag[1] as unknown[]).forEach((setItem, itemIndex) => decodeValue(setItem, `${tagField}[1][${itemIndex}]`, depth + 1));
      return new OtherValue();
    case "obj":
      fields(2, '["obj", an object]', isPlainObject(tag[1]));
      return decodePlain(tag[1] as Record<string, unknown>, `${tagField}[1]`, depth);
  }
  refuse(`${tagField}[0]`, `is ${JSON.stringify(tag[0])}, not a tag the game domain script knows: num, undef, bigint, date, regexp, bytes, view, blob, file, map, set or obj.`);
}

/** A plain object's own keys, each decoded (an "obj" tag's object too, whose own "$z" key is just a key). */
function decodePlain(record: Record<string, unknown>, field: string, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record)) Object.defineProperty(out, key, { value: decodeValue(record[key], fieldOf(field, key), depth + 1), enumerable: true, writable: true, configurable: true });
  return out;
}
