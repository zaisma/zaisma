import { DATABASE_RESTORE_LIMITS } from "./game-database.ts";

/**
 * Restoring a kept room's world to a time (docs/DEVELOPER-API.md, "Kept rooms"): a world's storage keeps the same 30 days of
 * history as a game's database, so a restore reaches back that far, and each restore's undo lasts that long after it.
 * A deleted world comes back from its nightly copy, which Backblaze keeps for 28 days (apps/site/src/backups.ts).
 */
export const KEPT_ROOM_RESTORE_LIMITS = {
  restorableDurationDays: DATABASE_RESTORE_LIMITS.restorableDurationDays,
  marginMs: DATABASE_RESTORE_LIMITS.marginMs,
  listedRestoreCount: 50,
  /** Worlds a batch asks for per queue message, and how many of them at once. */
  batchPageRoomCount: 200,
  restoredAtOnceCount: 50,
  /** Failed room codes a batch names. */
  listedFailedRoomCount: 100,
  /** How long a world's last copy lasts after it's deleted: the bucket's lock. */
  copyKeptDurationDays: 28,
  listedDeletedRoomCount: 200,
  /** What a game brings back from the copies in a day: Backblaze charges about a cent a GB to read, on nobody's meter. */
  maximumBroughtBackSizeBytesPerDay: 100 * 1024 ** 3,
} as const;

const DAY_MS = 86_400_000;

/** One restore of a kept room's world, or the undo of one, with Cloudflare's bookmark for the moment just before it. */
export interface KeptRoomRestore {
  id: string;
  game_id: string;
  room_code: string;
  restore_to_at_ms: number;
  undo_bookmark: string;
  undoes_kept_room_restore_id: string | null;
  kept_room_restore_batch_id: string | null;
  restored_at_ms: number;
}

/** Every world of a game going back to one moment, or the undo of that. */
export interface KeptRoomRestoreBatch {
  id: string;
  game_id: string;
  restore_to_at_ms: number;
  undoes_kept_room_restore_batch_id: string | null;
  started_at_ms: number;
  finished_at_ms: number | null;
  kept_room_count: number;
  restored_room_count: number;
  skipped_room_count: number;
  failed_room_count: number;
}

/** A world erased after its developer deleted it, which its last copy can still bring back. */
export interface DeletedKeptRoom {
  game_id: string;
  room_code: string;
  name: string | null;
  saved_size_bytes: number;
  deleted_at_ms: number;
  bring_back_started_at_ms: number | null;
  bring_back_failed_at_ms: number | null;
  brought_back_at_ms: number | null;
}

/** The earliest moment a restore, or a restore's undo, can reach now. */
export function earliestKeptRoomRestorableAtMs(nowMs = Date.now()): number {
  return nowMs - KEPT_ROOM_RESTORE_LIMITS.restorableDurationDays * DAY_MS + KEPT_ROOM_RESTORE_LIMITS.marginMs;
}

/** The last moment a deleted world's copy is there to bring it back. */
export const keptRoomCopyEndsAtMs = (deletedAtMs: number) => deletedAtMs + KEPT_ROOM_RESTORE_LIMITS.copyKeptDurationDays * DAY_MS;

export async function addKeptRoomRestore(database: D1Database, restore: KeptRoomRestore): Promise<void> {
  await database
    .prepare("INSERT INTO kept_room_restores (id, game_id, room_code, restore_to_at_ms, undo_bookmark, undoes_kept_room_restore_id, kept_room_restore_batch_id, restored_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(restore.id, restore.game_id, restore.room_code, restore.restore_to_at_ms, restore.undo_bookmark, restore.undoes_kept_room_restore_id, restore.kept_room_restore_batch_id, restore.restored_at_ms)
    .run();
}

/** A restore of this world that can still be undone, or null. */
export async function keptRoomRestoreById(database: D1Database, gameId: string, roomCode: string, keptRoomRestoreId: string, nowMs = Date.now()): Promise<KeptRoomRestore | null> {
  return database.prepare("SELECT * FROM kept_room_restores WHERE id = ? AND game_id = ? AND room_code = ? AND restored_at_ms >= ?").bind(keptRoomRestoreId, gameId, roomCode, earliestKeptRoomRestorableAtMs(nowMs)).first<KeptRoomRestore>();
}

/** The world's restores that can still be undone, newest first. */
export async function recentKeptRoomRestores(database: D1Database, gameId: string, roomCode: string, nowMs = Date.now()): Promise<KeptRoomRestore[]> {
  const { results } = await database
    .prepare("SELECT * FROM kept_room_restores WHERE game_id = ? AND room_code = ? AND restored_at_ms >= ? ORDER BY restored_at_ms DESC LIMIT ?")
    .bind(gameId, roomCode, earliestKeptRoomRestorableAtMs(nowMs), KEPT_ROOM_RESTORE_LIMITS.listedRestoreCount)
    .all<KeptRoomRestore>();
  return results;
}

/** A batch of this game that can still be read or undone, or null. */
export async function keptRoomRestoreBatchById(database: D1Database, gameId: string, batchId: string, nowMs = Date.now()): Promise<KeptRoomRestoreBatch | null> {
  return database.prepare("SELECT * FROM kept_room_restore_batches WHERE id = ? AND game_id = ? AND started_at_ms >= ?").bind(batchId, gameId, earliestKeptRoomRestorableAtMs(nowMs)).first<KeptRoomRestoreBatch>();
}

/** The game's batch still running, or null: one at a time. */
export async function runningKeptRoomRestoreBatch(database: D1Database, gameId: string): Promise<KeptRoomRestoreBatch | null> {
  return database.prepare("SELECT * FROM kept_room_restore_batches WHERE game_id = ? AND finished_at_ms IS NULL ORDER BY started_at_ms DESC LIMIT 1").bind(gameId).first<KeptRoomRestoreBatch>();
}

/** The latest deleted row of a world that can still come back, or null: a world can be deleted more than once. */
export async function deletedKeptRoomOf(database: D1Database, gameId: string, roomCode: string, nowMs = Date.now()): Promise<DeletedKeptRoom | null> {
  return database
    .prepare("SELECT * FROM deleted_kept_rooms WHERE game_id = ? AND room_code = ? AND brought_back_at_ms IS NULL AND deleted_at_ms > ? ORDER BY deleted_at_ms DESC LIMIT 1")
    .bind(gameId, roomCode, nowMs - KEPT_ROOM_RESTORE_LIMITS.copyKeptDurationDays * DAY_MS)
    .first<DeletedKeptRoom>();
}

/** The game's deleted worlds that can still come back, newest first, and how many there are. */
export async function recentDeletedKeptRooms(database: D1Database, gameId: string, nowMs = Date.now()): Promise<{ deletedKeptRooms: DeletedKeptRoom[]; deletedKeptRoomCount: number }> {
  const sinceMs = nowMs - KEPT_ROOM_RESTORE_LIMITS.copyKeptDurationDays * DAY_MS;
  const [listed, counted] = await database.batch<DeletedKeptRoom & { found_count: number }>([
    database.prepare("SELECT * FROM deleted_kept_rooms WHERE game_id = ? AND brought_back_at_ms IS NULL AND deleted_at_ms > ? ORDER BY deleted_at_ms DESC LIMIT ?").bind(gameId, sinceMs, KEPT_ROOM_RESTORE_LIMITS.listedDeletedRoomCount),
    database.prepare("SELECT COUNT(*) AS found_count FROM deleted_kept_rooms WHERE game_id = ? AND brought_back_at_ms IS NULL AND deleted_at_ms > ?").bind(gameId, sinceMs),
  ]);
  return { deletedKeptRooms: listed!.results, deletedKeptRoomCount: counted!.results[0]?.found_count ?? 0 };
}

/** What the game brought back from the copies in the last day, in bytes, those on their way included. */
export async function broughtBackSizeBytesToday(database: D1Database, gameId: string, nowMs = Date.now()): Promise<number> {
  const row = await database
    .prepare("SELECT COALESCE(SUM(saved_size_bytes), 0) AS size_bytes FROM deleted_kept_rooms WHERE game_id = ? AND bring_back_started_at_ms > ?")
    .bind(gameId, nowMs - DAY_MS)
    .first<{ size_bytes: number }>();
  return row?.size_bytes ?? 0;
}

/** A world erased after its developer deleted it: what bring_back_kept_room needs, read from its kept_rooms row before the row goes. */
export function rememberDeletedKeptRoom(database: D1Database, gameId: string, roomCode: string, nowMs = Date.now()): D1PreparedStatement {
  return database
    .prepare(
      "INSERT OR IGNORE INTO deleted_kept_rooms (game_id, room_code, name, saved_size_bytes, deleted_at_ms) SELECT game_id, room_code, name, saved_size_bytes, COALESCE(deleted_at_ms, ?) FROM kept_rooms WHERE game_id = ? AND room_code = ?",
    )
    .bind(nowMs, gameId, roomCode);
}

/** Restores whose undo Cloudflare no longer keeps, and deleted worlds whose copy is gone. */
export async function deleteOldKeptRoomRestores(database: D1Database, nowMs = Date.now()): Promise<void> {
  const earliestAtMs = earliestKeptRoomRestorableAtMs(nowMs);
  await database.batch([
    database.prepare("DELETE FROM kept_room_restores WHERE restored_at_ms < ?").bind(earliestAtMs),
    database.prepare("DELETE FROM kept_room_restore_failures WHERE kept_room_restore_batch_id IN (SELECT id FROM kept_room_restore_batches WHERE started_at_ms < ?)").bind(earliestAtMs),
    database.prepare("DELETE FROM kept_room_restore_batches WHERE started_at_ms < ?").bind(earliestAtMs),
    database.prepare("DELETE FROM deleted_kept_rooms WHERE deleted_at_ms < ?").bind(nowMs - KEPT_ROOM_RESTORE_LIMITS.copyKeptDurationDays * DAY_MS),
  ]);
}
