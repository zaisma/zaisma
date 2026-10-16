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
