import { MAXIMUM_DATABASE_SIZE_BYTES } from "./game-database.ts";

/**
 * A game's storage on Zaisma: its database and the saved worlds of its kept rooms (room.setKept), which
 * count together on the hosting meter, up to MAXIMUM_GAME_STORAGE_SIZE_BYTES. Kept rooms write their size to
 * kept_rooms as they empty, and at most hourly while players are in them, so the sum is close, not exact.
 */

/** How long a world deleted through the API waits before it's erased, for its developer to bring it back. */
export const KEPT_ROOM_ERASE_WAIT_DURATION_DAYS = 7;

/**
 * The saved size of a game's kept rooms, from kept_rooms: those counting towards its storage, and those waiting to be
 * erased, which stay on the hosting meter (they're still stored) but off the limit, so deleting a world makes room at once.
 */
export async function keptRoomsSizes(database: D1Database, gameId: string): Promise<{ keptSizeBytes: number; waitingSizeBytes: number }> {
  const row = await database
    .prepare("SELECT COALESCE(SUM(CASE WHEN erases_at_ms IS NULL THEN saved_size_bytes END), 0) AS kept_size_bytes, COALESCE(SUM(CASE WHEN erases_at_ms IS NOT NULL THEN saved_size_bytes END), 0) AS waiting_size_bytes FROM kept_rooms WHERE game_id = ?")
    .bind(gameId)
    .first<{ kept_size_bytes: number; waiting_size_bytes: number }>();
  return { keptSizeBytes: row?.kept_size_bytes ?? 0, waitingSizeBytes: row?.waiting_size_bytes ?? 0 };
}

/** A game's storage: its database's size (the database object's own number) and its kept rooms'. */
export async function gameStorageSizeBytes(database: D1Database, databaseSizeBytes: number, gameId: string): Promise<number> {
  return databaseSizeBytes + (await keptRoomsSizes(database, gameId)).keptSizeBytes;
}

/** The most storage a game can have, its database and kept rooms together. */
export const MAXIMUM_GAME_STORAGE_SIZE_BYTES = MAXIMUM_DATABASE_SIZE_BYTES;
