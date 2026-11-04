import { MAXIMUM_DATABASE_SIZE_BYTES } from "./game-database.ts";

/**
 * A game's storage on Zaisma: its database and the saved worlds of its kept rooms (room.setKept), which
 * count together on the hosting meter, up to MAXIMUM_GAME_STORAGE_SIZE_BYTES. Kept rooms write their size to
 * kept_rooms as they empty, and at most hourly while players are in them, so the sum is close, not exact.
 */

/** How long a world deleted through the API waits before it's erased, for its developer to bring it back. */
export const KEPT_ROOM_ERASE_WAIT_DURATION_DAYS = 7;

/** The saved size of a game's kept rooms that count towards its storage, from kept_rooms. */
export async function keptRoomsSizeBytes(database: D1Database, gameId: string): Promise<number> {
  const row = await database.prepare("SELECT COALESCE(SUM(saved_size_bytes), 0) AS size_bytes FROM kept_rooms WHERE game_id = ? AND erases_at_ms IS NULL").bind(gameId).first<{ size_bytes: number }>();
  return row?.size_bytes ?? 0;
}

/** The saved size of a game's kept rooms waiting to be erased: on the hosting meter, since they're still stored, but off the limit, so deleting a world makes room at once. */
export async function waitingKeptRoomsSizeBytes(database: D1Database, gameId: string): Promise<number> {
  const row = await database.prepare("SELECT COALESCE(SUM(saved_size_bytes), 0) AS size_bytes FROM kept_rooms WHERE game_id = ? AND erases_at_ms IS NOT NULL").bind(gameId).first<{ size_bytes: number }>();
  return row?.size_bytes ?? 0;
}

/** A game's storage: its database's size (the database object's own number) and its kept rooms'. */
export async function gameStorageSizeBytes(database: D1Database, databaseSizeBytes: number, gameId: string): Promise<number> {
  return databaseSizeBytes + (await keptRoomsSizeBytes(database, gameId));
}

/** The most storage a game can have, its database and kept rooms together. */
export const MAXIMUM_GAME_STORAGE_SIZE_BYTES = MAXIMUM_DATABASE_SIZE_BYTES;
