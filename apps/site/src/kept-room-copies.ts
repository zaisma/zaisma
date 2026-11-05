import { ApiError, KEPT_ROOM_RESTORE_LIMITS, MAXIMUM_GAME_STORAGE_SIZE_BYTES, audit, broughtBackSizeBytesToday, deletedKeptRoomOf, iso, keptRoomCopyEndsAtMs, type Game } from "@zaisma/core";
import { BackupStorage, type BackupObjectVersion, type BackupWait } from "./backup-storage.ts";
import { BACKUP_LIMITS, backupStorageSettings, copyKeptRoom, keptRoomKey } from "./backups.ts";
import type { Caller, NextStep } from "./developer.ts";
import type { Env } from "./env.ts";
import { logCallerEvent } from "./security-log.ts";

/**
 * A deleted kept room's world back from its last copy at Backblaze, for about 28 days after it was deleted. Deleting a world
 * takes a fresh copy, since a world that sleeps is only copied every 24 days and the bucket lets a copy go after 28 (backups.ts).
 * The read key can read only kept-rooms/ and can't delete. Reading costs Zaisma about a cent a GB, on nobody's meter, so a game
 * brings back up to KEPT_ROOM_RESTORE_LIMITS.maximumBroughtBackSizeBytesPerDay a day. The work runs on the zaisma-backup queue,
 * since a world can be 10 GB.
 */

/** The world's copy taken as its deletion starts, as a message on the zaisma-backup queue. */
export interface KeptRoomLastCopyPart {
  part_kind: "kept_room_last_copy";
  game_id: string;
  slug: string;
  room_code: string;
}

/** A deleted world coming back from a version of its copy, as a message on the zaisma-backup queue. */
export interface KeptRoomBringBackPart {
  part_kind: "kept_room_bring_back";
  game_id: string;
  slug: string;
  room_code: string;
  deleted_at_ms: number;
  version_id: string;
  copy_saved_at_ms: number;
}

const copyStorage = (env: Env, wait?: BackupWait) => new BackupStorage({ ...backupStorageSettings(env), keyId: env.KEPT_ROOM_COPY_KEY_ID!, keySecret: env.KEPT_ROOM_COPY_KEY_SECRET! }, wait);

/** Queues the copy taken as a world's deletion starts; it's still all there to read for its week. A failure here costs only an older copy. */
export async function queueLastCopy(env: Env, game: Game, code: string): Promise<void> {
  if (!env.BACKUP_QUEUE || !env.BACKUP_KEY_ID) return;
  await env.BACKUP_QUEUE.send({ part_kind: "kept_room_last_copy", game_id: game.id, slug: game.slug, room_code: code }).catch((error) => console.error("A deleted world's last copy wasn't queued:", code, error));
}

/** The same copy for a world about to be erased at once, whose game nobody else played. A failure here costs only an older copy. */
export async function copyBeforeErasing(env: Env, game: Game, code: string): Promise<void> {
  if (!env.BACKUP_KEY_ID || !env.BACKUP_ENDPOINT) return;
  await copyKeptRoom(env, new BackupStorage(backupStorageSettings(env)), { game_id: game.id, room_code: code, slug: game.slug }).catch((error) => console.error("A deleted world's last copy failed:", code, error));
}

/** A world erased after its developer deleted it, coming back: checks it can, then queues the work. */
export async function bringBackFromCopy(env: Env, game: Game, code: string, caller: Caller, nowMs: number): Promise<[unknown, number?] | null> {
  const deleted = await deletedKeptRoomOf(env.DB, game.id, code, nowMs);
  if (!deleted) return null;
  const list: NextStep = { tool: "list_kept_rooms", arguments: { slug: game.slug }, after_sec: 30, reason: "It's back when kept_rooms has it; deleted_kept_rooms says how it's going until then." };
  // Asked again while it's on its way: the same answer.
  if (deleted.bring_back_started_at_ms !== null && deleted.bring_back_failed_at_ms === null) return [{ is_brought_back: false, is_bringing_back: true, copy_saved_at: null, next_steps: [list] }];
  if (game.review_status === "removed") throw new ApiError("game_removed", { message: "Zaisma took this game down, so its worlds can't come back.", field: "room_code", fix: "Message Zaisma with message_zaisma to ask why." });
  if (!env.KEPT_ROOM_COPY_KEY_ID || !env.KEPT_ROOM_COPY_KEY_SECRET || !env.BACKUP_ENDPOINT || !env.BACKUP_QUEUE || !env.GAME_STORAGE) {
    throw new ApiError("kept_room_copies_unavailable", { message: "This Zaisma can't read its worlds' copies, so an erased world can't come back here.", fix: "On zaisma.com it works. Bring a world back within its week instead, while erases_at says it waits." });
  }
  const inUse = await env.DB.prepare("SELECT 1 AS is_in_use FROM live_rooms WHERE game_id = ?1 AND room_code = ?2 UNION ALL SELECT 1 FROM kept_rooms WHERE game_id = ?1 AND room_code = ?2 LIMIT 1").bind(game.id, code).first();
  if (inUse) throw new ApiError("room_code_in_use", { message: `Another room of ${game.slug} has the code ${code} now.`, field: "room_code", fix: "End that room or delete its world first, then bring this one back." });
  const storageRow = await env.DB.prepare("SELECT COALESCE(SUM(saved_size_bytes), 0) AS size_bytes FROM kept_rooms WHERE game_id = ? AND erases_at_ms IS NULL").bind(game.id).first<{ size_bytes: number }>();
  const databaseAnswer = env.GAME_DATABASES ? await env.GAME_DATABASES.usage(game.id) : null;
  const databaseSizeBytes = databaseAnswer && !("error" in databaseAnswer) ? databaseAnswer.queryResult.storageSizeBytes : 0;
  if ((storageRow?.size_bytes ?? 0) + databaseSizeBytes + deleted.saved_size_bytes > MAXIMUM_GAME_STORAGE_SIZE_BYTES) {
    throw new ApiError("game_storage_full", { message: `${code}'s world doesn't fit in ${game.slug}'s storage now: a game keeps ${MAXIMUM_GAME_STORAGE_SIZE_BYTES / 1024 ** 3} GB.`, field: "room_code", fix: "Delete kept rooms or rows until it fits, then bring it back. list_kept_rooms says what takes the room." });
  }
  if ((await broughtBackSizeBytesToday(env.DB, game.id, nowMs)) + deleted.saved_size_bytes > KEPT_ROOM_RESTORE_LIMITS.maximumBroughtBackSizeBytesPerDay) {
    throw new ApiError("slow_down", { message: `${game.slug} brought back ${KEPT_ROOM_RESTORE_LIMITS.maximumBroughtBackSizeBytesPerDay / 1024 ** 3} GB of worlds from their copies today, the most a game can in a day.`, fix: "Try again tomorrow.", retryAfterSec: 3600 });
  }
  const versions: BackupObjectVersion[] = await copyStorage(env).listObjectVersions(keptRoomKey({ game_id: game.id, room_code: code }), 100);
  const copy = versions.filter((version) => version.key === keptRoomKey({ game_id: game.id, room_code: code })).sort((first, second) => second.lastModifiedAtMs - first.lastModifiedAtMs)[0];
  if (!copy || copy.isHidden) throw new ApiError("no_kept_room_copy", { message: `There's no copy of ${code}'s world left to bring back.`, field: "room_code", fix: `A copy lasts about ${KEPT_ROOM_RESTORE_LIMITS.copyKeptDurationDays} days after a world is deleted, and a world erased before its first night has none.` });
  await env.DB.prepare("UPDATE deleted_kept_rooms SET bring_back_started_at_ms = ?, bring_back_failed_at_ms = NULL WHERE game_id = ? AND room_code = ? AND deleted_at_ms = ?").bind(nowMs, game.id, code, deleted.deleted_at_ms).run();
  await env.BACKUP_QUEUE.send({ part_kind: "kept_room_bring_back", game_id: game.id, slug: game.slug, room_code: code, deleted_at_ms: deleted.deleted_at_ms, version_id: copy.versionId, copy_saved_at_ms: copy.lastModifiedAtMs });
  await audit(env.DB, game.id, "kept-room-brought-back", code, caller.actor);
  await logCallerEvent(env, caller, "kept_room_brought_back", { gameId: game.id, subjectName: code });
  return [{ is_brought_back: false, is_bringing_back: true, copy_saved_at: iso(copy.lastModifiedAtMs), next_steps: [list] }, 202];
}

/** The copy taken as a deletion starts: tried on the queue's tries, and a world erased since has nothing to copy. */
export async function handleLastCopy(env: Env, message: Message<KeptRoomLastCopyPart>, wait?: BackupWait): Promise<void> {
  const part = message.body;
  try {
    await copyKeptRoom(env, new BackupStorage(backupStorageSettings(env), wait), { game_id: part.game_id, room_code: part.room_code, slug: part.slug });
  } catch (error) {
    console.error("A deleted world's last copy failed:", part.room_code, error);
    if (message.attempts < BACKUP_LIMITS.partTryCount) return message.retry({ delaySeconds: 60 * message.attempts });
  }
  message.ack();
}

/** The world comes back from its copy, tells its game server what it went back to, and has its row again. */
export async function handleBringBack(env: Env, message: Message<KeptRoomBringBackPart>, wait?: BackupWait): Promise<void> {
  const part = message.body;
  const fail = async (error: unknown) => {
    console.error("A deleted world didn't come back:", part.room_code, error);
    if (message.attempts < BACKUP_LIMITS.partTryCount) return message.retry({ delaySeconds: 60 * message.attempts });
    await env.DB.prepare("UPDATE deleted_kept_rooms SET bring_back_failed_at_ms = ? WHERE game_id = ? AND room_code = ? AND deleted_at_ms = ?").bind(Date.now(), part.game_id, part.room_code, part.deleted_at_ms).run();
    message.ack();
  };
  try {
    const object = await copyStorage(env, wait).getObject(keptRoomKey({ game_id: part.game_id, room_code: part.room_code }), part.version_id);
    const { isInUse } = await env.GAME_STORAGE!.bringBackKeptRoom(part.game_id, part.slug, part.room_code, object.body, part.copy_saved_at_ms, message.attempts > 1);
    if (isInUse) return fail(new Error("the code is in use"));
    const nowMs = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO kept_rooms (game_id, room_code, name, saved_size_bytes, saved_at_ms, last_played_at_ms, created_at_ms) SELECT game_id, room_code, name, saved_size_bytes, ?, ?, ? FROM deleted_kept_rooms WHERE game_id = ? AND room_code = ? AND deleted_at_ms = ? " +
          "ON CONFLICT (game_id, room_code) DO UPDATE SET erases_at_ms = NULL, deleted_at_ms = NULL",
      ).bind(part.copy_saved_at_ms, part.copy_saved_at_ms, nowMs, part.game_id, part.room_code, part.deleted_at_ms),
      env.DB.prepare("UPDATE deleted_kept_rooms SET brought_back_at_ms = ? WHERE game_id = ? AND room_code = ? AND deleted_at_ms = ?").bind(nowMs, part.game_id, part.room_code, part.deleted_at_ms),
    ]);
    message.ack();
  } catch (error) {
    await fail(error);
  }
}

/** The game's deleted worlds as list_kept_rooms answers them. */
export const deletedKeptRoomJson = (deleted: { room_code: string; name: string | null; saved_size_bytes: number; deleted_at_ms: number; bring_back_started_at_ms: number | null; bring_back_failed_at_ms: number | null }) => ({
  room_code: deleted.room_code,
  name: deleted.name,
  saved_size_bytes: deleted.saved_size_bytes,
  deleted_at: iso(deleted.deleted_at_ms)!,
  bring_back_ends_at: iso(keptRoomCopyEndsAtMs(deleted.deleted_at_ms))!,
  bring_back_started_at: iso(deleted.bring_back_started_at_ms),
  bring_back_failed_at: iso(deleted.bring_back_failed_at_ms),
});
