/** Largest cloud save per game per player. */
export const SAVE_LIMIT_BYTES = 5 * 1024 * 1024;

/**
 * A browser save: the game's localStorage as { key: value }, or { idb, local } when the game
 * also keeps IndexedDB databases. idb is the databases as the game domain script writes them
 * (packages/sdk/saves.js); we only store it.
 */
export type SaveData = Record<string, string> | { idb: unknown[]; local: Record<string, string> };

const withIdb = (saveData: SaveData): saveData is { idb: unknown[]; local: Record<string, string> } => Array.isArray(saveData.idb);

/**
 * A save as one stable string: localStorage keys sorted, so the same save always gives the
 * same text and hash. The game page and the game domain script do the same, so all three
 * agree on what "the same save" means.
 */
export function canonicalSave(saveData: SaveData): string {
  return withIdb(saveData) ? JSON.stringify({ idb: saveData.idb, local: sorted(saveData.local) }) : JSON.stringify(sorted(saveData));
}

function sorted(localStorageItems: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(localStorageItems).sort()) Object.defineProperty(out, key, { value: localStorageItems[key]!, enumerable: true, writable: true, configurable: true });
  return out;
}

const strings = (candidate: unknown): candidate is Record<string, string> =>
  Boolean(candidate) && typeof candidate === "object" && !Array.isArray(candidate) && Object.values(candidate as object).every((entry) => typeof entry === "string");

/** A save from a client, or null if it isn't one. */
export function parseSave(text: string): SaveData | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (strings(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const { idb, local, ...rest } = parsed as Record<string, unknown>;
  return Array.isArray(idb) && strings(local) && !Object.keys(rest).length ? { idb, local } : null;
}

export async function saveHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface SaveRow {
  account_id: string;
  game_id: string;
  version_number: number;
  sha256: string;
  size_bytes: number;
  updated_at_ms: number;
}

export async function saveRow(database: D1Database, accountId: string, gameId: string): Promise<SaveRow | null> {
  return database.prepare("SELECT * FROM saves WHERE account_id = ? AND game_id = ?").bind(accountId, gameId).first<SaveRow>();
}

/**
 * Move a save from version `baseVersionNumber` to the next one, only if nobody else did first.
 * Returns the new version number, or null when another device saved in between.
 */
export async function bumpSave(database: D1Database, save: { accountId: string; gameId: string; baseVersionNumber: number; sha256: string; sizeBytes: number }): Promise<number | null> {
  const updatedAtMs = Date.now();
  const writeResult =
    save.baseVersionNumber === 0
      ? await database
          .prepare("INSERT INTO saves (account_id, game_id, version_number, sha256, size_bytes, updated_at_ms) VALUES (?, ?, 1, ?, ?, ?) ON CONFLICT DO NOTHING")
          .bind(save.accountId, save.gameId, save.sha256, save.sizeBytes, updatedAtMs)
          .run()
      : await database
          .prepare("UPDATE saves SET version_number = version_number + 1, sha256 = ?, size_bytes = ?, updated_at_ms = ? WHERE account_id = ? AND game_id = ? AND version_number = ?")
          .bind(save.sha256, save.sizeBytes, updatedAtMs, save.accountId, save.gameId, save.baseVersionNumber)
          .run();
  return writeResult.meta.changes === 1 ? save.baseVersionNumber + 1 : null;
}

/** The games a player has cloud saves for, most recently saved first. */
export async function savedGames(database: D1Database, accountId: string): Promise<{ slug: string; title: string; updated_at_ms: number; save_copy_count: number }[]> {
  const { results } = await database
    .prepare(
      "SELECT games.slug, games.title, saves.updated_at_ms, (SELECT COUNT(*) FROM save_history WHERE save_history.account_id = saves.account_id AND save_history.game_id = saves.game_id) AS save_copy_count FROM saves JOIN games ON games.id = saves.game_id WHERE saves.account_id = ? AND games.review_status = 'live' AND games.cloud_saves_enabled = 1 ORDER BY saves.updated_at_ms DESC",
    )
    .bind(accountId)
    .all<{ slug: string; title: string; updated_at_ms: number; save_copy_count: number }>();
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
 * the player picked another device's progress over it (replaced), the game's save shrank to
 * under half (smaller, usually a reset), the player went back to an earlier version (restore),
 * or the player picked the account's progress over this device's (device).
 */
export type SaveCopyReason = "hourly" | "replaced" | "smaller" | "restore" | "device";

export interface SaveCopy {
  id: string;
  account_id: string;
  game_id: string;
  saved_at_ms: number;
  reason: SaveCopyReason;
  sha256: string;
  size_bytes: number;
}

export const saveCopyKey = (accountId: string, gameId: string, id: string) => `${accountId}/${gameId}/${id}.json`;

/** A game's earlier versions, newest first. */
export async function saveHistory(database: D1Database, accountId: string, gameId: string): Promise<SaveCopy[]> {
  const { results } = await database.prepare("SELECT * FROM save_history WHERE account_id = ? AND game_id = ? ORDER BY saved_at_ms DESC, id").bind(accountId, gameId).all<SaveCopy>();
  return results;
}

/**
 * Whether to keep a copy of the current save before it's replaced, and why.
 * `isReplacing` is set when the player chose this device's progress over the account's.
 */
export function copyReason(current: { size_bytes: number; updated_at_ms: number }, next: { sizeBytes: number; isReplacing: boolean }, newestCopyAtMs: number | null): SaveCopyReason | null {
  if (next.isReplacing) return "replaced";
  if (next.sizeBytes * 2 < current.size_bytes) return "smaller";
  if (newestCopyAtMs === null || current.updated_at_ms - newestCopyAtMs >= SAVE_COPY_INTERVAL_MS) return "hourly";
  return null;
}

/**
 * Which copies to drop to stay at KEPT_SAVE_COPY_COUNT. The newest always stays. Past that, the
 * oldest routine copy goes first, so a copy from right before progress was lost outlives a day
 * of hourly copies; after 30 days it counts as routine.
 */
export function copiesToDrop(copies: SaveCopy[], nowMs: number): SaveCopy[] {
  const keep = [...copies].sort((first, second) => second.saved_at_ms - first.saved_at_ms);
  const drop: SaveCopy[] = [];
  while (keep.length > KEPT_SAVE_COPY_COUNT) {
    const routine = (copy: SaveCopy) => copy.reason === "hourly" || nowMs - copy.saved_at_ms > SAVE_COPY_PROTECTION_DURATION_MS;
    let i = keep.length - 1;
    while (i > 0 && !routine(keep[i]!)) i--;
    if (i === 0) i = keep.length - 1;
    drop.push(...keep.splice(i, 1));
  }
  return drop;
}

/** Record a copy (its data is already in R2) next to the game's `copies`, and return the ones to delete to make room. */
export async function addSaveCopy(database: D1Database, copy: SaveCopy, copies: SaveCopy[], nowMs = Date.now()): Promise<SaveCopy[]> {
  const dropped = copiesToDrop([copy, ...copies], nowMs);
  await database.batch([
    database.prepare("INSERT INTO save_history (id, account_id, game_id, saved_at_ms, reason, sha256, size_bytes) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(copy.id, copy.account_id, copy.game_id, copy.saved_at_ms, copy.reason, copy.sha256, copy.size_bytes),
    ...dropped.map((droppedCopy) => database.prepare("DELETE FROM save_history WHERE id = ?").bind(droppedCopy.id)),
  ]);
  return dropped;
}
