import {
  SAVE_LIMIT_BYTES,
  accountById,
  addSaveCopy,
  bumpSave,
  canonicalSave,
  copyReason,
  gameBySlug,
  iso,
  newId,
  parseSave,
  saveCopyKey,
  saveHash,
  saveHistory,
  saveKey,
  saveRow,
  type SaveCopy,
  type SaveCopyReason,
  type SaveRow,
} from "@zaisma/core";
import { currentSession } from "./auth.ts";
import type { Env } from "./env.ts";

/**
 * Cloud saves: GET and PUT /api/saves/<game>, called by the game page on zaisma.com
 * with the player's session cookie. The game itself never talks to this; it only
 * hands its browser save to the game page (see packages/sdk/saves.js).
 *
 *   GET  answers { tag, version_number, sha256, updated_at, changed_by_kind, save_data }, or { tag, version_number: 0 } with no save yet
 *   GET  ?version answers only { version_number, updated_at, changed_by_kind }, from the database alone, for an open game to check cheaply
 *   PUT  { base_version_number, save_json, replace? } answers { version_number, sha256, updated_at },
 *        or 409 { error, version_number, updated_at, changed_by_kind } when another device (or the developer) saved first;
 *        replace: true says this device's progress was played more recently than another device's and replaces it
 *   PUT  { keep: true, save_json } keeps this device's progress as an earlier version: { is_kept: true }
 *
 * There's no "which progress?" question: the progress played most recently wins, and the other is kept as
 * an earlier version (saves-client.ts decides). changed_by_kind "developer" means the game's developer changed
 * the save through the API (saves-api.ts): the game page takes it, keeping this device's progress as an earlier version.
 */
export async function handleSaves(request: Request, env: Env, slug: string): Promise<Response> {
  const json = (body: unknown, httpStatus = 200) => Response.json(body, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
  if (request.method === "PUT") {
    // Only our own game page writes saves.
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin) return json({ error: "Not allowed from here." }, 403);
  } else if (request.method !== "GET") {
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

  if (request.method === "GET") {
    const row = await saveRow(env.DB, account.id, game.id);
    if (new URL(request.url).searchParams.has("version")) return withCookies(json({ version_number: row?.version_number ?? 0, updated_at: row ? iso(row.updated_at_ms) : null, changed_by_kind: row?.changed_by_kind ?? null }));
    const object = row ? await env.SAVES.get(saveKey(account.id, game.id)) : null;
    if (!row || !object) return withCookies(json({ tag, version_number: row?.version_number ?? 0 }));
    return withCookies(
      json({ tag, version_number: row.version_number, sha256: row.sha256, updated_at: iso(row.updated_at_ms), changed_by_kind: row.changed_by_kind, save_data: JSON.parse(await object.text()) }),
    );
  }

  if (env.SAVE_LIMIT && !(await env.SAVE_LIMIT.limit({ key: account.id })).success) return json({ error: "Saving too often." }, 429);
  const contentLengthBytes = Number(request.headers.get("content-length") ?? 0);
  if (contentLengthBytes > SAVE_LIMIT_BYTES * 2 + 1024) return json({ error: "This save is too big." }, 413);
  let body: { base_version_number?: unknown; save_json?: unknown; replace?: unknown; keep?: unknown };
  try {
    body = JSON.parse(await request.text());
  } catch {
    return json({ error: "Bad save." }, 400);
  }
  const saveData = typeof body.save_json === "string" ? parseSave(body.save_json) : null;
  if (!saveData) return json({ error: "Bad save." }, 400);
  const text = canonicalSave(saveData);
  const sizeBytes = new TextEncoder().encode(text).length;
  if (sizeBytes > SAVE_LIMIT_BYTES) return json({ error: "This save is too big." }, 413);
  const sha256 = await saveHash(text);

  // The account's progress was played more recently than this device's: keep this device's as an earlier version.
  if (body.keep === true) {
    await keepCopy(env, { account_id: account.id, game_id: game.id, saved_at_ms: Date.now(), copy_reason: "device", sha256, size_bytes: sizeBytes }, async () => text);
    return withCookies(json({ is_kept: true }));
  }

  const baseVersionNumber = Number(body.base_version_number);
  if (!Number.isInteger(baseVersionNumber) || baseVersionNumber < 0) return json({ error: "Bad save." }, 400);
  const current = baseVersionNumber ? await saveRow(env.DB, account.id, game.id) : null;
  const versionNumber = await bumpSave(env.DB, { accountId: account.id, gameId: game.id, baseVersionNumber, sha256, sizeBytes, changedByKind: "player" });
  if (versionNumber === null) {
    // Another device (or the developer) saved since this one loaded: the game page decides which progress wins and saves again.
    const row = await saveRow(env.DB, account.id, game.id);
    return withCookies(json({ error: "Played on another device.", version_number: row?.version_number ?? 0, updated_at: iso(row?.updated_at_ms), changed_by_kind: row?.changed_by_kind ?? null }, 409));
  }
  // Before replacing the save, keep a copy now and then, and whenever progress looks about to be lost.
  if (current && current.version_number === baseVersionNumber && current.sha256 !== sha256) {
    const copy = { account_id: account.id, game_id: game.id, saved_at_ms: current.updated_at_ms, sha256: current.sha256, size_bytes: current.size_bytes };
    await keepCopy(env, copy, () => readSave(env, account.id, game.id), (newestCopyAtMs) => copyReason(current, { sizeBytes, isReplacing: body.replace === true }, newestCopyAtMs));
  }
  await env.SAVES.put(saveKey(account.id, game.id), text, { httpMetadata: { contentType: "application/json" }, customMetadata: { version_number: String(versionNumber) } });
  return withCookies(json({ version_number: versionNumber, sha256, updated_at: iso(Date.now()) }));
}

export const readSave = async (env: Env, accountId: string, gameId: string) => (await env.SAVES.get(saveKey(accountId, gameId)))?.text() ?? null;

/**
 * Keep a copy of some progress in the game's history, unless it already has this exact progress.
 * `copy_reason` is fixed, or worked out from when the newest copy was made (null: no copy needed).
 * Answers the ID of the copy that holds this progress (the new one, or the one it already had), or null when none was kept.
 */
async function keepCopy(
  env: Env,
  copy: Omit<SaveCopy, "id" | "copy_reason"> & { copy_reason?: SaveCopyReason },
  text: () => Promise<string | null>,
  why?: (newestCopyAtMs: number | null) => SaveCopyReason | null,
): Promise<string | null> {
  const copies = await saveHistory(env.DB, copy.account_id, copy.game_id);
  const existing = copies.find((savedCopy) => savedCopy.sha256 === copy.sha256);
  if (existing) return existing.id;
  const copyReason = copy.copy_reason ?? why?.(copies[0]?.saved_at_ms ?? null) ?? null;
  const copyText = copyReason ? await text() : null;
  if (!copyReason || copyText === null) return null;
  const full: SaveCopy = { ...copy, id: newId("save_copy"), copy_reason: copyReason };
  await env.SAVES.put(saveCopyKey(full.account_id, full.game_id, full.id), copyText, { httpMetadata: { contentType: "application/json" } });
  const dropped = await addSaveCopy(env.DB, full, copies);
  if (dropped.length) await env.SAVES.delete(dropped.map((droppedCopy) => saveCopyKey(droppedCopy.account_id, droppedCopy.game_id, droppedCopy.id)));
  return full.id;
}

/**
 * The game's developer makes `text` (a canonical save) the player's save: a change, a reset or a restore
 * through the API. A copy of the save it replaces is kept first, unless that save was the developer's own
 * last change, so a script changing a save again and again can't push the player's own copies out.
 * Open games take it on their next check (saves-client.ts). Tries again when the player's game saves at
 * the same moment; null when it kept losing that race.
 */
export async function changeSaveAsDeveloper(env: Env, accountId: string, gameId: string, text: string): Promise<{ row: SaveRow; keptSaveCopyId: string | null } | null> {
  const sha256 = await saveHash(text);
  const sizeBytes = new TextEncoder().encode(text).length;
  for (let attemptIndex = 0; attemptIndex < 3; attemptIndex++) {
    const row = await saveRow(env.DB, accountId, gameId);
    if (row?.sha256 === sha256) return { row, keptSaveCopyId: null };
    const keptSaveCopyId =
      row && row.changed_by_kind !== "developer"
        ? await keepCopy(env, { account_id: accountId, game_id: gameId, saved_at_ms: row.updated_at_ms, copy_reason: "developer", sha256: row.sha256, size_bytes: row.size_bytes }, () => readSave(env, accountId, gameId))
        : null;
    const versionNumber = await bumpSave(env.DB, { accountId, gameId, baseVersionNumber: row?.version_number ?? 0, sha256, sizeBytes, changedByKind: "developer" });
    if (versionNumber === null) continue;
    await env.SAVES.put(saveKey(accountId, gameId), text, { httpMetadata: { contentType: "application/json" }, customMetadata: { version_number: String(versionNumber) } });
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
