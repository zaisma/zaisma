import {
  SAVE_LIMIT_BYTES,
  accountById,
  addSaveCopy,
  bumpSave,
  canonicalSave,
  copyReason,
  gameBySlug,
  iso,
  isIdOf,
  newId,
  parseSave,
  readStoredSave,
  saveContentsJson,
  saveCopyJson,
  saveCopyKey,
  saveHash,
  saveHistory,
  saveKey,
  saveRow,
  unversionedSaveKey,
  type ChangedByKind,
  type SaveCopy,
  type SaveCopyReason,
  type SaveRow,
} from "@zaisma/core";
import { currentSession } from "./auth.ts";
import type { Env } from "./env.ts";

/**
 * Cloud saves: /api/saves/<game>, called by the game page on zaisma.com with the player's
 * session cookie. The game itself never talks to this; it hands its browser save to the game
 * page (see packages/sdk/saves.js), and asks the page for its earlier versions (Zaisma.saves).
 *
 *   GET  answers { tag, version_number, sha256, saved_at, changed_by_kind, save_data }, or { tag, version_number: 0 } with no save yet;
 *        save_data is the stored save (core's SaveData), rewritten as v1 first when it was stored before v1 (readUpgradedSave)
 *   GET  ?version answers only { version_number, saved_at, changed_by_kind }, from the database alone, for an open game to check cheaply
 *   PUT  { tag, base_version_number, save_json, version_id?, replace? } answers { version_number, sha256, saved_at, kept_save_copy_id },
 *        or 409 { error, version_number, sha256, saved_at, changed_by_kind } when another device (or the developer) saved first;
 *        a save that's exactly the account's current one (a retry whose first answer was lost) answers 200 with that version;
 *        version_id is the game version that saved it, as the game domain script was told (checkedVersionId);
 *        replace: true says this device's progress was played more recently than another device's and replaces it;
 *        kept_save_copy_id is the earlier version now holding the save it replaced (null when none was kept)
 *   PUT  { tag, keep: true, save_json, version_id?, played_at } keeps this device's progress as an earlier version, dated when the
 *        device last played it (an ISO time; now when null): { is_kept: true, save_copy_id }, or { is_kept: false, save_copy_id: null }
 *        when it's exactly the account's current save
 *   GET  /copies answers { save_copies: [{ id, saved_at, copy_reason, size_bytes, is_current_save, version_id }] }, newest first
 *   GET  /copies/<save_copy_id> answers { save_copy: { ...those, local_storage_items, indexeddb_databases } }
 *   POST /copies/<save_copy_id>/restore { tag } makes it the save again, the player's own change, keeping the save it
 *        replaces as a "restore" copy: { version_number, sha256, saved_at, kept_save_copy_id }
 *   An unknown copy, or no save at all, answers 404 { error: "no_save_copy" }.
 *   tag is the one the page's GET answered: every change carries it, and one made while another account is signed in
 *   answers 409 { error: "account_changed" }, so a page loaded for one account never saves into the next one's.
 *
 * There's no "which progress?" question: the progress played most recently wins, and the other is kept as
 * an earlier version (saves-client.ts decides). changed_by_kind "developer" means the game's developer changed
 * the save through the API (saves-api.ts): the game page takes it, keeping this device's progress as an earlier version.
 */
export async function handleSaves(request: Request, env: Env, slug: string, copies: { saveCopyId: string | null; isRestore: boolean } | null = null): Promise<Response> {
  const json = (body: unknown, httpStatus = 200) => Response.json(body, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
  // The save changes with PUT, and a restore with POST; everything else only reads.
  const changeMethod = copies ? (copies.isRestore ? "POST" : null) : "PUT";
  if (request.method === changeMethod) {
    // Only our own game page writes saves.
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin) return json({ error: "Not allowed from here." }, 403);
  } else if (request.method !== "GET" || changeMethod === "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const session = await currentSession(request, env);
  const account = session ? await accountById(env.DB, session.userId) : null;
  if (!session || !account) return json({ error: "Sign in to save to your account." }, 401);
  const game = await gameBySlug(env.DB, slug);
  if (!game || game.review_status !== "live" || !game.cloud_saves_enabled) return json({ error: "This game doesn't save to accounts." }, 404);
  const withCookies = (response: Response) => {
    for (const cookie of session.cookies) response.headers.append("Set-Cookie", cookie);
    return response;
  };

  // A per-account, per-game tag the game page uses to remember which save this device last had.
  const tag = (await saveHash(`${account.id}:${game.id}`)).slice(0, 16);

  if (copies) return withCookies(await copiesAnswer(request, env, account.id, game.id, tag, copies.saveCopyId, copies.isRestore));

  if (request.method === "GET") {
    const row = await saveRow(env.DB, account.id, game.id);
    if (new URL(request.url).searchParams.has("version")) return withCookies(json({ version_number: row?.version_number ?? 0, saved_at: row ? iso(row.saved_at_ms) : null, changed_by_kind: row?.changed_by_kind ?? null }));
    const text = row ? await readSave(env, row) : null;
    if (!row || text === null) return withCookies(json({ tag, version_number: row?.version_number ?? 0 }));
    return withCookies(json({ tag, version_number: row.version_number, sha256: row.sha256, saved_at: iso(row.saved_at_ms), changed_by_kind: row.changed_by_kind, save_data: JSON.parse(text) }));
  }

  if (env.SAVE_LIMIT && !(await env.SAVE_LIMIT.limit({ key: account.id })).success) return tooOften();
  const contentLengthBytes = Number(request.headers.get("content-length") ?? 0);
  if (contentLengthBytes > SAVE_LIMIT_BYTES * 2 + 1024) return json({ error: "This save is too big." }, 413);
  let body: { tag?: unknown; base_version_number?: unknown; save_json?: unknown; version_id?: unknown; replace?: unknown; keep?: unknown; played_at?: unknown };
  try {
    body = JSON.parse(await request.text());
  } catch {
    return json({ error: "Bad save." }, 400);
  }
  if (typeof body.tag !== "string") return json({ error: "Bad save." }, 400);
  if (body.tag !== tag) return withCookies(accountChanged());
  const saveData = typeof body.save_json === "string" ? parseSave(body.save_json) : null;
  if (!saveData) return json({ error: "Bad save." }, 400);
  const text = canonicalSave(saveData);
  const sizeBytes = new TextEncoder().encode(text).length;
  if (sizeBytes > SAVE_LIMIT_BYTES) return json({ error: "This save is too big." }, 413);
  const sha256 = await saveHash(text);
  const versionId = await checkedVersionId(env, game.id, body.version_id);

  // The account's progress was played more recently than this device's: keep this device's as an earlier version,
  // dated when the device last played it (never later than now), so the copies list in the order they were played.
  if (body.keep === true) {
    // The account's save is exactly this progress already: nothing to keep.
    if ((await saveRow(env.DB, account.id, game.id))?.sha256 === sha256) return withCookies(json({ is_kept: false, save_copy_id: null }));
    const nowMs = Date.now();
    const playedAtMs = typeof body.played_at === "string" ? Date.parse(body.played_at) : NaN;
    const savedAtMs = playedAtMs > 0 ? Math.min(playedAtMs, nowMs) : nowMs;
    const saveCopyId = await keepCopy(env, { account_id: account.id, game_id: game.id, saved_at_ms: savedAtMs, copy_reason: "device_lost", sha256, size_bytes: sizeBytes, version_id: versionId }, async () => text);
    return withCookies(json({ is_kept: true, save_copy_id: saveCopyId }));
  }

  const baseVersionNumber = Number(body.base_version_number);
  if (!Number.isInteger(baseVersionNumber) || baseVersionNumber < 0) return json({ error: "Bad save." }, 400);
  const current = await saveRow(env.DB, account.id, game.id);
  const saved = (row: SaveRow) => withCookies(json({ version_number: row.version_number, sha256: row.sha256, saved_at: iso(row.saved_at_ms), kept_save_copy_id: null }));
  // Another device (or the developer) saved since this one loaded: the game page decides which progress wins and saves again.
  const lost = (row: SaveRow | null) =>
    withCookies(json({ error: "Played on another device.", version_number: row?.version_number ?? 0, sha256: row?.sha256 ?? null, saved_at: iso(row?.saved_at_ms), changed_by_kind: row?.changed_by_kind ?? null }, 409));
  // The account has exactly this save already (a save sent again after its answer was lost): it's saved.
  if (current?.sha256 === sha256) return saved(current);
  if ((current?.version_number ?? 0) !== baseVersionNumber) return lost(current);
  const versionNumber = await storeSave(env, account.id, game.id, current, { text, sha256, sizeBytes, changedByKind: "player", versionId });
  if (versionNumber === null) {
    const row = await saveRow(env.DB, account.id, game.id);
    return row?.sha256 === sha256 ? saved(row) : lost(row);
  }
  // Once the save moved on, keep a copy of the one it replaced now and then, and whenever progress looks about to be lost.
  let keptSaveCopyId: string | null = null;
  if (current) {
    const copy = { account_id: account.id, game_id: game.id, saved_at_ms: current.saved_at_ms, sha256: current.sha256, size_bytes: current.size_bytes, version_id: current.version_id };
    keptSaveCopyId = await keepCopy(env, copy, () => storedSaveText(env, current), (newestCopyAtMs) => copyReason(current, { sizeBytes, isReplacing: body.replace === true }, newestCopyAtMs));
    await forgetSave(env, current);
  }
  // The time the save was stored, exactly as a retry of it would answer.
  const stored = await saveRow(env.DB, account.id, game.id);
  return withCookies(json({ version_number: versionNumber, sha256, saved_at: iso(stored?.version_number === versionNumber ? stored.saved_at_ms : Date.now()), kept_save_copy_id: keptSaveCopyId }));
}

const tooOften = () => Response.json({ error: "Saving too often." }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
const accountChanged = () => Response.json({ error: "account_changed", message: "Another account is signed in now." }, { status: 409, headers: { "Cache-Control": "no-store" } });

/**
 * The game version a save came from, as the page reported it: kept only when it's a version of this game, else null.
 * A label, never a check: a save is never refused over it.
 */
async function checkedVersionId(env: Env, gameId: string, given: unknown): Promise<string | null> {
  if (!isIdOf("version", given)) return null;
  return (await env.DB.prepare("SELECT 1 FROM versions WHERE id = ? AND game_id = ?").bind(given, gameId).first()) ? given : null;
}

/** The player's earlier versions in the game, one of them, or going back to one (the game's Zaisma.saves). */
async function copiesAnswer(request: Request, env: Env, accountId: string, gameId: string, tag: string, saveCopyId: string | null, isRestore: boolean): Promise<Response> {
  const json = (body: unknown, httpStatus = 200) => Response.json(body, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
  const [row, copies] = await Promise.all([saveRow(env.DB, accountId, gameId), saveHistory(env.DB, accountId, gameId)]);
  if (saveCopyId === null) return json({ save_copies: copies.map((copy) => saveCopyJson(copy, row)) });
  const copy = isIdOf("save_copy", saveCopyId) ? copies.find((savedCopy) => savedCopy.id === saveCopyId) : undefined;
  const text = row && copy ? await readCopy(env, copy) : null;
  if (!row || !copy || text === null) return json({ error: "no_save_copy" }, 404);
  if (!isRestore) return json({ save_copy: { ...saveCopyJson(copy, row), ...saveContentsJson(readStoredSave(text), null) } });
  const body = (await request.json().catch(() => null)) as { tag?: unknown } | null;
  if (typeof body?.tag !== "string") return json({ error: "Bad restore." }, 400);
  if (body.tag !== tag) return accountChanged();
  if (env.SAVE_LIMIT && !(await env.SAVE_LIMIT.limit({ key: accountId })).success) return tooOften();
  const restored = await restoreSaveAsPlayer(env, accountId, gameId, text, copy.version_id);
  if (!restored) return json({ error: "Played on another device at the same moment." }, 409);
  return json({ version_number: restored.row.version_number, sha256: restored.row.sha256, saved_at: iso(restored.row.saved_at_ms), kept_save_copy_id: restored.keptSaveCopyId });
}

/**
 * A save's or copy's text at `key` in the saves bucket, always as v1, or null when it's gone. One stored in a shape
 * from before v1 is rewritten first, only if nothing wrote it since it was read (etagMatches), and then `update`
 * moves its database row to the new hash, only if the row still has the old one: a save that lands in between is
 * never overwritten or mislabelled. When another write got there first, it reads the object again, once.
 */
export async function readUpgradedSave(env: Env, key: string, update: (sha256: string, sizeBytes: number, oldSha256: string) => Promise<void>): Promise<string | null> {
  let text: string | null = null;
  for (let attemptIndex = 0; attemptIndex < 2; attemptIndex++) {
    const object = await env.SAVES.get(key);
    if (!object) return null;
    const stored = await object.text();
    text = canonicalSave(readStoredSave(stored));
    if (text === stored) return text;
    const written = await env.SAVES.put(key, text, { onlyIf: { etagMatches: object.etag }, httpMetadata: object.httpMetadata, customMetadata: object.customMetadata });
    if (written) {
      await update(await saveHash(text), new TextEncoder().encode(text).length, await saveHash(stored));
      return text;
    }
  }
  return text;
}

/**
 * The player's save as v1 (readUpgradedSave); a rewrite also brings `row`'s sha256 and size_bytes up to date. Null when its data is gone.
 * A save stored before each version had its own file is read from where it was. When another save moved the row on and
 * deleted this version's file meanwhile, `row` becomes the save as it is now, read once more, so its fields and text always match.
 * A save that needed the rewrite was stored before v1, and so were likely its copies, which keep their old hash until they're read
 * (so is_current_save and keepCopy's dedupe would miss them): they're read, and upgraded, right then.
 */
export async function readSave(env: Env, row: SaveRow): Promise<string | null> {
  let isRewritten = false;
  const update = async (sha256: string, sizeBytes: number, oldSha256: string) => {
    isRewritten = true;
    const { meta } = await env.DB.prepare("UPDATE saves SET sha256 = ?, size_bytes = ? WHERE account_id = ? AND game_id = ? AND version_number = ? AND sha256 = ?")
      .bind(sha256, sizeBytes, row.account_id, row.game_id, row.version_number, oldSha256)
      .run();
    if (meta.changes === 1) Object.assign(row, { sha256, size_bytes: sizeBytes });
  };
  for (let attemptIndex = 0; attemptIndex < 2; attemptIndex++) {
    const text =
      (await readUpgradedSave(env, saveKey(row.account_id, row.game_id, row.version_number, row.sha256), update)) ?? (await readUpgradedSave(env, unversionedSaveKey(row.account_id, row.game_id), update));
    if (text !== null) {
      if (isRewritten) for (const copy of await saveHistory(env.DB, row.account_id, row.game_id)) await readCopy(env, copy);
      return text;
    }
    const now = await saveRow(env.DB, row.account_id, row.game_id);
    if (!now || now.version_number === row.version_number) return null;
    Object.assign(row, now);
  }
  return null;
}

/** An earlier version as v1 (readUpgradedSave); a rewrite also brings `copy`'s sha256 and size_bytes up to date. Null when its data is gone. */
export function readCopy(env: Env, copy: SaveCopy): Promise<string | null> {
  return readUpgradedSave(env, saveCopyKey(copy.account_id, copy.game_id, copy.id), async (sha256, sizeBytes, oldSha256) => {
    const { meta } = await env.DB.prepare("UPDATE save_history SET sha256 = ?, size_bytes = ? WHERE id = ? AND sha256 = ?").bind(sha256, sizeBytes, copy.id, oldSha256).run();
    if (meta.changes === 1) Object.assign(copy, { sha256, size_bytes: sizeBytes });
  });
}

type SaveVersion = Pick<SaveRow, "account_id" | "game_id" | "version_number" | "sha256">;

/** A save's text exactly as stored (for a copy kept with the hash its row already has, and the account's export), or null when it's gone. */
export async function storedSaveText(env: Env, row: SaveVersion): Promise<string | null> {
  const object = (await env.SAVES.get(saveKey(row.account_id, row.game_id, row.version_number, row.sha256))) ?? (await env.SAVES.get(unversionedSaveKey(row.account_id, row.game_id)));
  return object ? object.text() : null;
}

/** Delete the files of a save version the row has moved on from (and the file from before versions had their own). */
const forgetSave = (env: Env, row: SaveVersion) => env.SAVES.delete([saveKey(row.account_id, row.game_id, row.version_number, row.sha256), unversionedSaveKey(row.account_id, row.game_id)]);

/**
 * Store `save.text` as the version after `current` (null: the first): its file first, then the row, moved only if no other
 * save moved it meanwhile, so a row never names data that isn't stored and a read during another device's save gets one
 * version whole. Answers the new version number, or null when another save got there first: the file written is deleted
 * then, unless that save was this exact one. The caller deletes `current`'s file once it no longer needs it (forgetSave).
 */
async function storeSave(
  env: Env,
  accountId: string,
  gameId: string,
  current: SaveRow | null,
  save: { text: string; sha256: string; sizeBytes: number; changedByKind: ChangedByKind; versionId: string | null },
): Promise<number | null> {
  const baseVersionNumber = current?.version_number ?? 0;
  const key = saveKey(accountId, gameId, baseVersionNumber + 1, save.sha256);
  await env.SAVES.put(key, save.text, { httpMetadata: { contentType: "application/json" } });
  const versionNumber = await bumpSave(env.DB, { accountId, gameId, baseVersionNumber, sha256: save.sha256, sizeBytes: save.sizeBytes, changedByKind: save.changedByKind, versionId: save.versionId });
  if (versionNumber !== null) return versionNumber;
  const row = await saveRow(env.DB, accountId, gameId);
  if (!(row?.version_number === baseVersionNumber + 1 && row.sha256 === save.sha256)) await env.SAVES.delete(key);
  return null;
}

/**
 * Keep a copy of some progress in the game's history, unless it already has this exact progress.
 * `copy_reason` is fixed, or worked out from when the newest copy was made (null: no copy needed).
 * Answers the ID of the copy that holds this progress (the new one, or the one it already had), or null when none was kept.
 */
async function keepCopy(
  env: Env,
  copy: Omit<SaveCopy, "id" | "copy_reason" | "kept_at_ms"> & { copy_reason?: SaveCopyReason },
  text: () => Promise<string | null>,
  why?: (newestCopyAtMs: number | null) => SaveCopyReason | null,
): Promise<string | null> {
  const copies = await saveHistory(env.DB, copy.account_id, copy.game_id);
  const existing = copies.find((savedCopy) => savedCopy.sha256 === copy.sha256);
  if (existing) return existing.id;
  const copyReason = copy.copy_reason ?? why?.(copies[0]?.saved_at_ms ?? null) ?? null;
  const copyText = copyReason ? await text() : null;
  if (!copyReason || copyText === null) return null;
  const full: SaveCopy = { ...copy, id: newId("save_copy"), copy_reason: copyReason, kept_at_ms: Date.now() };
  await env.SAVES.put(saveCopyKey(full.account_id, full.game_id, full.id), copyText, { httpMetadata: { contentType: "application/json" } });
  const { dropped, heldById } = await addSaveCopy(env.DB, full);
  // Another keep at the same moment held this progress first: this copy's file isn't needed.
  const unneeded = heldById === full.id ? dropped : [...dropped, full];
  if (unneeded.length) await env.SAVES.delete(unneeded.map((droppedCopy) => saveCopyKey(droppedCopy.account_id, droppedCopy.game_id, droppedCopy.id)));
  return heldById;
}

/**
 * The game's developer changes the player's save: a change, a reset or a restore through the API. `change` makes the
 * new save (a canonical text) from the save as it is (null: none), and runs again on each try, so a change to some keys
 * is made to the save as it is when it lands: changes and the player's own saves at the same moment are never reverted.
 * A copy of the save it replaces is kept first, unless that save was the developer's own last change, so a script
 * changing a save again and again can't push the player's own copies out. `versionId` is null for a change, a replace
 * or a reset, and a restored copy's own. Open games take it on their next check (saves-client.ts). Tries again when the
 * save moves at the same moment; null when it kept losing that race.
 */
export async function changeSaveAsDeveloper(env: Env, accountId: string, gameId: string, change: (currentText: string | null) => string, versionId: string | null): Promise<{ row: SaveRow; keptSaveCopyId: string | null } | null> {
  for (let attemptIndex = 0; attemptIndex < 3; attemptIndex++) {
    const row = await saveRow(env.DB, accountId, gameId);
    // The current save, read as v1 first, so its copy's hash is the v1 text's.
    const currentText = row ? await readSave(env, row) : null;
    const text = change(currentText);
    const sha256 = await saveHash(text);
    if (row?.sha256 === sha256) return { row, keptSaveCopyId: null };
    const keptSaveCopyId =
      row && currentText !== null && row.changed_by_kind !== "developer"
        ? await keepCopy(env, { account_id: accountId, game_id: gameId, saved_at_ms: row.saved_at_ms, copy_reason: "developer", sha256: row.sha256, size_bytes: row.size_bytes, version_id: row.version_id }, async () => currentText)
        : null;
    const versionNumber = await storeSave(env, accountId, gameId, row, { text, sha256, sizeBytes: new TextEncoder().encode(text).length, changedByKind: "developer", versionId });
    if (versionNumber === null) continue;
    if (row) await forgetSave(env, row);
    return { row: (await saveRow(env.DB, accountId, gameId))!, keptSaveCopyId };
  }
  return null;
}

/**
 * The player goes back to an earlier version in the game (Zaisma.saves.restoreCopy): `copyText` (a stored copy, from
 * game version `versionId`) becomes the save, as the player's own change. The save it replaces is kept first as a
 * "restore" copy. Tries again when the player's game saves on another device at the same moment; null when it kept losing that race.
 */
export async function restoreSaveAsPlayer(env: Env, accountId: string, gameId: string, copyText: string, versionId: string | null): Promise<{ row: SaveRow; keptSaveCopyId: string | null } | null> {
  const text = canonicalSave(readStoredSave(copyText));
  const sha256 = await saveHash(text);
  const sizeBytes = new TextEncoder().encode(text).length;
  for (let attemptIndex = 0; attemptIndex < 3; attemptIndex++) {
    const row = await saveRow(env.DB, accountId, gameId);
    if (row?.sha256 === sha256) return { row, keptSaveCopyId: null };
    const keptSaveCopyId = row
      ? await keepCopy(env, { account_id: accountId, game_id: gameId, saved_at_ms: row.saved_at_ms, copy_reason: "restore", sha256: row.sha256, size_bytes: row.size_bytes, version_id: row.version_id }, () => storedSaveText(env, row))
      : null;
    const versionNumber = await storeSave(env, accountId, gameId, row, { text, sha256, sizeBytes, changedByKind: "player", versionId });
    if (versionNumber === null) continue;
    if (row) await forgetSave(env, row);
    return { row: (await saveRow(env.DB, accountId, gameId))!, keptSaveCopyId };
  }
  return null;
}

/** Delete every save file for an account (with the account). */
export async function deleteSaveFiles(env: Env, accountId: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const list = await env.SAVES.list({ prefix: `${accountId}/`, cursor });
    if (list.objects.length) await env.SAVES.delete(list.objects.map((object) => object.key));
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
}
