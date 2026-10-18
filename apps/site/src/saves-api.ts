import {
  ApiError,
  SAVE_LIMIT_BYTES,
  canonicalSave,
  checkIdKind,
  gameSaves,
  iso,
  readStoredSave,
  saveContentsJson,
  saveCopyJson,
  saveCopyKey,
  saveFromParts,
  saveHistory,
  saveParts,
  saveRow,
  type Game,
  type SaveCopy,
  type SaveData,
  type SaveRow,
} from "@zaisma/core";
import type { CheckedCall, NextStep } from "./developer.ts";
import type { Env } from "./env.ts";
import { changeSaveAsDeveloper, readSave } from "./saves.ts";

/**
 * A game's cloud saves through the developer API (docs/DECISIONS.md, "Developers get their game's saves"),
 * by player ID. Saves stay apart from the game database, and each stays tied to its player.
 *
 *   GET    /api/dev/games/:slug/saves                                         the players with a save, by player ID, a page at a time
 *   GET    /api/dev/games/:slug/saves/:player_id                              one save: whole, or ?keys= for some localStorage keys
 *   PATCH  /api/dev/games/:slug/saves/:player_id                              change some localStorage keys: { "local_storage_items": { key: text or null } }
 *   PUT    /api/dev/games/:slug/saves/:player_id                              replace the whole save: { "local_storage_items", "indexeddb_databases" }
 *   DELETE /api/dev/games/:slug/saves/:player_id                              reset it: the save becomes empty
 *   GET    /api/dev/games/:slug/saves/:player_id/copies                       its earlier versions, newest first
 *   GET    /api/dev/games/:slug/saves/:player_id/copies/:save_copy_id         one earlier version, whole or ?keys=
 *   POST   /api/dev/games/:slug/saves/:player_id/copies/:save_copy_id/restore make it the save again
 *
 * Every change keeps a copy of the save it replaces first (changeSaveAsDeveloper), and an open game takes
 * the new save by reloading, with no question to the player (saves-client.ts).
 */

const PAGE_SAVE_COUNT = 100;
const MAXIMUM_KEY_COUNT = 100;
const MAXIMUM_KEY_CHARACTER_COUNT = 1000;

const PLAYER_FIX = "list_saves (GET /games/<slug>/saves) lists the players with a save in this game; a player ID comes from your game too (a room's players, or the sub of a player pass).";
const COPY_FIX = "list_save_copies (GET /games/<slug>/saves/<player_id>/copies) lists the player's earlier versions with their IDs.";
const ITEMS_FIX = 'Give local_storage_items as an object of localStorage keys and their text, like { "coins": "500", "level": "3" }. localStorage holds only text: send "500", not 500, and an object as JSON text.';

/** One call, once the router (developer.ts, checkCall) has checked the key, the game, and that the query and body hold only the call's inputs. */
export async function savesRoute(request: Request, env: Env, game: Game, playerId: string | undefined, isCopies: boolean, saveCopyId: string | undefined, isRestore: boolean, checked: CheckedCall): Promise<[unknown, number?]> {
  const method = request.method;
  const { query, body } = checked;

  if (!playerId) {
    const afterPlayerId = readSaveCursor(query.get("cursor"));
    const rows = await gameSaves(env.DB, game.id, afterPlayerId, PAGE_SAVE_COUNT);
    const page = rows.slice(0, PAGE_SAVE_COUNT);
    const last = page.at(-1);
    return [{ saves: page.map((row) => summaryJson(row, row.player_id, row.save_copy_count)), next_cursor: rows.length > PAGE_SAVE_COUNT && last ? `cursor_${last.player_id.slice("player_".length)}` : null }];
  }

  const accountId = await accountOf(env, playerId);

  if (isCopies) {
    if (!saveCopyId) {
      const [row, copies] = await Promise.all([saveRow(env.DB, accountId, game.id), saveHistory(env.DB, accountId, game.id)]);
      return [{ save_copies: copies.map((copy) => copyJson(copy, row)) }];
    }
    checkIdKind("save_copy", saveCopyId, "save_copy_id", COPY_FIX);
    const copies = await saveHistory(env.DB, accountId, game.id);
    const copy = copies.find((savedCopy) => savedCopy.id === saveCopyId);
    const text = copy ? await (await env.SAVES.get(saveCopyKey(accountId, game.id, copy.id)))?.text() : null;
    if (!copy || !text) throw new ApiError("no_save_copy", { message: `${playerId} has no earlier version ${saveCopyId} in ${game.slug}.`, field: "save_copy_id", fix: COPY_FIX });
    if (!isRestore) {
      const row = await saveRow(env.DB, accountId, game.id);
      return [{ save_copy: { ...copyJson(copy, row), ...saveContentsJson(readStoredSave(text), readKeys(query)) } }];
    }
    checkCloudSaves(game);
    return changed(env, game, accountId, playerId, text);
  }

  if (method === "GET") {
    const row = await existingSave(env, game, accountId, playerId);
    const text = await readSave(env, accountId, game.id);
    if (text === null) throw noSave(game, playerId);
    const copyCount = (await saveHistory(env.DB, accountId, game.id)).length;
    return [{ save: { ...summaryJson(row, playerId, copyCount), ...saveContentsJson(readStoredSave(text), readKeys(query)) } }];
  }

  if (method === "DELETE") {
    await existingSave(env, game, accountId, playerId);
    checkCloudSaves(game);
    return changed(env, game, accountId, playerId, canonicalSave({}));
  }

  if (method === "PATCH") {
    const changes = readItems(body.local_storage_items, true);
    if (!Object.keys(changes).length) throw new ApiError("bad_local_storage_items", { message: "local_storage_items has no keys, so nothing would change.", field: "local_storage_items", fix: ITEMS_FIX });
    checkCloudSaves(game);
    const current = (await saveRow(env.DB, accountId, game.id)) ? await readSave(env, accountId, game.id) : null;
    const { localStorageItems, indexeddbDatabases } = saveParts(current === null ? {} : readStoredSave(current));
    const items: Record<string, string> = { ...localStorageItems };
    for (const [key, itemText] of Object.entries(changes)) {
      if (itemText === null) delete items[key];
      else items[key] = itemText;
    }
    return changed(env, game, accountId, playerId, checkedText(saveFromParts(items, indexeddbDatabases)));
  }

  // PUT: the whole save.
  if (body.local_storage_items === undefined) throw new ApiError("missing_field", { message: "local_storage_items wasn't sent.", field: "local_storage_items", fix: `${ITEMS_FIX} To change only some keys, use change_save (PATCH) instead.` });
  if (body.indexeddb_databases === undefined) {
    throw new ApiError("missing_field", {
      message: "indexeddb_databases wasn't sent.",
      field: "indexeddb_databases",
      fix: "replace_save replaces the whole save: give [] for a game that keeps nothing in IndexedDB, or the databases as get_save answered them. To change only some localStorage keys, use change_save (PATCH) instead.",
    });
  }
  const items = readItems(body.local_storage_items, false) as Record<string, string>;
  const databases = readDatabases(body.indexeddb_databases);
  checkCloudSaves(game);
  return changed(env, game, accountId, playerId, checkedText(saveFromParts(items, databases)));
}

/** Make the change, and answer the save as it is now with the copy that keeps what it replaced. */
async function changed(env: Env, game: Game, accountId: string, playerId: string, text: string): Promise<[unknown]> {
  const change = await changeSaveAsDeveloper(env, accountId, game.id, text);
  if (!change) {
    throw new ApiError("save_busy", { message: `${playerId}'s game kept saving at the same moment, so the change didn't go through.`, fix: "Call again in a few seconds.", retryAfterSec: 5 });
  }
  const copyCount = (await saveHistory(env.DB, accountId, game.id)).length;
  return [{ save: summaryJson(change.row, playerId, copyCount), kept_save_copy_id: change.keptSaveCopyId, next_steps: [] satisfies NextStep[] }];
}

/** The account behind a player ID. Guests have no saves on Zaisma: their progress stays in their browser. */
async function accountOf(env: Env, playerId: string): Promise<string> {
  checkIdKind("player", playerId, "player_id", PLAYER_FIX);
  const account = await env.DB.prepare("SELECT id FROM accounts WHERE player_id = ?").bind(playerId).first<{ id: string }>();
  if (!account) throw new ApiError("no_player", { message: `No account has the player ID ${playerId}. Guests' progress stays in their browser, and a deleted account's saves are gone.`, field: "player_id", fix: PLAYER_FIX });
  return account.id;
}

async function existingSave(env: Env, game: Game, accountId: string, playerId: string): Promise<SaveRow> {
  const row = await saveRow(env.DB, accountId, game.id);
  if (!row) throw noSave(game, playerId);
  return row;
}

const noSave = (game: Game, playerId: string) =>
  new ApiError("no_save", {
    message: `${playerId} has no save in ${game.slug}: they haven't played it signed in with cloud saves on.`,
    field: "player_id",
    fix: "list_saves lists the players with a save. change_save or replace_save makes one for a player who has none.",
  });

/** A save for a game whose cloud saves are off would never reach it. */
function checkCloudSaves(game: Game): void {
  if (game.cloud_saves_enabled) return;
  throw new ApiError("cloud_saves_off", {
    message: `${game.slug} has cloud saves off, so it doesn't read saves from players' accounts.`,
    field: "slug",
    fix: "Turn them on with update_game (cloud_saves_enabled: true), or change the progress in the game's own saves.",
  });
}

function summaryJson(row: SaveRow, playerId: string, saveCopyCount: number) {
  return { player_id: playerId, sha256: row.sha256, size_bytes: row.size_bytes, updated_at: iso(row.updated_at_ms), changed_by_kind: row.changed_by_kind, save_copy_count: saveCopyCount };
}

function copyJson(copy: SaveCopy, row: SaveRow | null) {
  return { ...saveCopyJson(copy, row), sha256: copy.sha256 };
}

function checkedText(saveData: SaveData): string {
  const text = canonicalSave(saveData);
  const sizeBytes = new TextEncoder().encode(text).length;
  if (sizeBytes > SAVE_LIMIT_BYTES) {
    throw new ApiError("save_too_big", { message: `The save would be ${(sizeBytes / 1048576).toFixed(1)} MB; a save is up to 5 MB.`, fix: "Make it smaller: remove keys the game no longer needs (null in change_save removes one)." });
  }
  return text;
}

/** ?keys=coins&keys=level: some localStorage keys, each as its own keys parameter, since keys can hold commas. */
function readKeys(query: URLSearchParams): string[] | null {
  const keys = query.getAll("keys");
  if (!keys.length) return null;
  if (keys.length > MAXIMUM_KEY_COUNT || keys.some((key) => !key || key.length > MAXIMUM_KEY_CHARACTER_COUNT)) {
    throw new ApiError("bad_keys", { message: `keys isn't a list of 1 to ${MAXIMUM_KEY_COUNT} localStorage keys of up to ${MAXIMUM_KEY_CHARACTER_COUNT} characters.`, field: "keys", fix: "Give each key as its own parameter, like ?keys=coins&keys=level, or leave keys out for the whole save." });
  }
  return [...new Set(keys)];
}

function readItems(given: unknown, canRemove: boolean): Record<string, string | null> {
  const fix = canRemove ? `${ITEMS_FIX} null removes a key.` : ITEMS_FIX;
  if (given === undefined) throw new ApiError("missing_field", { message: "local_storage_items wasn't sent.", field: "local_storage_items", fix });
  if (!given || typeof given !== "object" || Array.isArray(given)) throw new ApiError("bad_local_storage_items", { message: "local_storage_items isn't an object of keys and their text.", field: "local_storage_items", fix });
  for (const [key, itemText] of Object.entries(given)) {
    if (!key || key.length > MAXIMUM_KEY_CHARACTER_COUNT) throw new ApiError("bad_local_storage_items", { message: `local_storage_items has a key that's empty or over ${MAXIMUM_KEY_CHARACTER_COUNT} characters.`, field: "local_storage_items", fix });
    if (typeof itemText === "string" || (canRemove && itemText === null)) continue;
    throw new ApiError("bad_local_storage_items", { message: `local_storage_items.${key} is ${itemText === null ? "null" : `a ${Array.isArray(itemText) ? "list" : typeof itemText}`}, not text.`, field: `local_storage_items.${key}`, fix });
  }
  return given as Record<string, string | null>;
}

/** IndexedDB databases as get_save answers them (the game domain script's encoding, packages/sdk/saves.js): checked for their shape, kept as they are. */
function readDatabases(given: unknown): unknown[] {
  const isDatabase = (database: unknown) => {
    const candidate = database as { name?: unknown; version?: unknown; stores?: unknown } | null;
    return Boolean(candidate) && typeof candidate === "object" && typeof candidate!.name === "string" && typeof candidate!.version === "number" && Array.isArray(candidate!.stores);
  };
  if (Array.isArray(given) && given.every(isDatabase)) return given;
  throw new ApiError("bad_indexeddb_databases", {
    message: "indexeddb_databases isn't a list of databases, each { name, version, stores } as get_save answers them.",
    field: "indexeddb_databases",
    fix: "Give [] for a game that keeps nothing in IndexedDB, or the databases from get_save, changed only inside their records.",
  });
}

/** cursor_<the random part of the last player ID on the page>. */
function readSaveCursor(cursor: string | null): string | null {
  if (!cursor) return null;
  if (!/^cursor_[a-z0-9]{1,40}$/.test(cursor)) {
    throw new ApiError("bad_cursor", { message: `cursor ${JSON.stringify(cursor.slice(0, 40))} isn't a next_cursor Zaisma gave.`, field: "cursor", fix: "Pass the next_cursor from your last answer as it came, or leave cursor out to start from the beginning." });
  }
  return `player_${cursor.slice("cursor_".length)}`;
}
