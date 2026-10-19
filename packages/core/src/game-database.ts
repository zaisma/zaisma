/**
 * Until Hosting billing exists, each game's database on Zaisma stops at its free use (docs/DECISIONS.md):
 * past the rows written, writes stop; at the storage, it can change and delete rows but not grow;
 * reads keep working. Past the rows read, both stop. Read and written rows count per calendar month
 * (UTC), the way Cloudflare bills them. About
 * $1.10 a game a month at Cloudflare's prices if all of it is used (Julius, Oct 16, 2026).
 */
export const GAME_DATABASE_FREE_LIMITS = {
  writtenRowCountPerMonth: 500_000,
  readRowCountPerMonth: 500_000_000,
  storageSizeBytes: 500 * 1024 * 1024,
} as const;

/** The month usage counts in, like "2026-10" (UTC). */
export function usageMonth(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 7);
}

/** When the next month starts, as an ISO date like "2026-11-01" (UTC): when the monthly limits reset. */
export function nextMonthStartDate(nowMs = Date.now()): string {
  const now = new Date(nowMs);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

/**
 * Restoring a game's database to a time (docs/DECISIONS.md, "Every game gets a real database"): Cloudflare
 * keeps 30 days of each database's history, so a restore reaches back that far, and each restore's undo
 * lasts that long after it. The margin keeps a time or an undo at the very edge from being refused.
 */
export const DATABASE_RESTORE_LIMITS = {
  restorableDurationDays: 30,
  marginMs: 60_000,
  listedRestoreCount: 50,
} as const;

/** One restore of a game's database, or the undo of one, with Cloudflare's bookmark for the moment just before it. */
export interface DatabaseRestore {
  id: string;
  game_id: string;
  restore_to_at_ms: number;
  undo_bookmark: string;
  undoes_database_restore_id: string | null;
  restored_at_ms: number;
}

/** The earliest moment a restore, or a restore's undo, can reach now. */
export function earliestRestorableAtMs(nowMs = Date.now()): number {
  return nowMs - DATABASE_RESTORE_LIMITS.restorableDurationDays * 86_400_000 + DATABASE_RESTORE_LIMITS.marginMs;
}

export async function addDatabaseRestore(database: D1Database, restore: DatabaseRestore): Promise<void> {
  await database
    .prepare("INSERT INTO database_restores (id, game_id, restore_to_at_ms, undo_bookmark, undoes_database_restore_id, restored_at_ms) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(restore.id, restore.game_id, restore.restore_to_at_ms, restore.undo_bookmark, restore.undoes_database_restore_id, restore.restored_at_ms)
    .run();
}

/** A restore of this game that can still be undone, or null. */
export async function databaseRestoreById(database: D1Database, gameId: string, databaseRestoreId: string, nowMs = Date.now()): Promise<DatabaseRestore | null> {
  return database.prepare("SELECT * FROM database_restores WHERE id = ? AND game_id = ? AND restored_at_ms >= ?").bind(databaseRestoreId, gameId, earliestRestorableAtMs(nowMs)).first<DatabaseRestore>();
}

/** The game's restores that can still be undone, newest first. */
export async function recentDatabaseRestores(database: D1Database, gameId: string, nowMs = Date.now()): Promise<DatabaseRestore[]> {
  const { results } = await database
    .prepare("SELECT * FROM database_restores WHERE game_id = ? AND restored_at_ms >= ? ORDER BY restored_at_ms DESC LIMIT ?")
    .bind(gameId, earliestRestorableAtMs(nowMs), DATABASE_RESTORE_LIMITS.listedRestoreCount)
    .all<DatabaseRestore>();
  return results;
}

/** Restores whose undo Cloudflare no longer keeps. */
export async function deleteOldDatabaseRestores(database: D1Database, nowMs = Date.now()): Promise<void> {
  await database.prepare("DELETE FROM database_restores WHERE restored_at_ms < ?").bind(earliestRestorableAtMs(nowMs)).run();
}
