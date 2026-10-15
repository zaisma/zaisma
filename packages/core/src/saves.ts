/** Largest cloud save per game per player. */
export const SAVE_LIMIT_BYTES = 5 * 1024 * 1024;

/**
 * A browser save: the game's localStorage as { key: value }, or { idb, local } when the game
 * also keeps IndexedDB databases. idb is the databases as the game domain script writes them
 * (packages/sdk/saves.js); we only store it.
 */
export type SaveData = Record<string, string> | { idb: unknown[]; local: Record<string, string> };

const withIdb = (data: SaveData): data is { idb: unknown[]; local: Record<string, string> } => Array.isArray(data.idb);

/**
 * A save as one stable string: localStorage keys sorted, so the same save always gives the
 * same text and hash. The game page and the game domain script do the same, so all three
 * agree on what "the same save" means.
 */
export function canonicalSave(data: SaveData): string {
  return withIdb(data) ? JSON.stringify({ idb: data.idb, local: sorted(data.local) }) : JSON.stringify(sorted(data));
}

function sorted(data: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(data).sort()) Object.defineProperty(out, k, { value: data[k]!, enumerable: true, writable: true, configurable: true });
  return out;
}

const strings = (v: unknown): v is Record<string, string> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v) && Object.values(v as object).every((x) => typeof x === "string");

/** A save from a client, or null if it isn't one. */
export function parseSave(text: string): SaveData | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (strings(data)) return data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const { idb, local, ...rest } = data as Record<string, unknown>;
  return Array.isArray(idb) && strings(local) && !Object.keys(rest).length ? { idb, local } : null;
}

export async function saveHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface SaveRow {
  account_id: string;
  game_id: string;
  version: number;
  hash: string;
  bytes: number;
  updated_at: number;
}

export async function saveRow(db: D1Database, accountId: string, gameId: string): Promise<SaveRow | null> {
  return db.prepare("SELECT * FROM saves WHERE account_id = ? AND game_id = ?").bind(accountId, gameId).first<SaveRow>();
}

/**
 * Move a save from version `base` to the next one, only if nobody else did first.
 * Returns the new version, or null when another device saved in between.
 */
export async function bumpSave(db: D1Database, s: { accountId: string; gameId: string; base: number; hash: string; bytes: number }): Promise<number | null> {
  const at = Date.now();
  const result =
    s.base === 0
      ? await db
          .prepare("INSERT INTO saves (account_id, game_id, version, hash, bytes, updated_at) VALUES (?, ?, 1, ?, ?, ?) ON CONFLICT DO NOTHING")
          .bind(s.accountId, s.gameId, s.hash, s.bytes, at)
          .run()
      : await db
          .prepare("UPDATE saves SET version = version + 1, hash = ?, bytes = ?, updated_at = ? WHERE account_id = ? AND game_id = ? AND version = ?")
          .bind(s.hash, s.bytes, at, s.accountId, s.gameId, s.base)
          .run();
  return result.meta.changes === 1 ? s.base + 1 : null;
}

/** The games a player has cloud saves for, most recently saved first. */
export async function savedGames(db: D1Database, accountId: string): Promise<{ slug: string; title: string; updated_at: number; copies: number }[]> {
  const { results } = await db
    .prepare(
      "SELECT g.slug, g.title, s.updated_at, (SELECT COUNT(*) FROM save_history h WHERE h.account_id = s.account_id AND h.game_id = s.game_id) AS copies FROM saves s JOIN games g ON g.id = s.game_id WHERE s.account_id = ? AND g.review_status = 'live' AND g.cloud_saves_enabled = 1 ORDER BY s.updated_at DESC",
    )
    .bind(accountId)
    .all<{ slug: string; title: string; updated_at: number; copies: number }>();
  return results;
}

/** Where a save's data lives in the saves bucket. Listing <account>/ finds all of a player's saves. */
export const saveKey = (accountId: string, gameId: string) => `${accountId}/${gameId}.json`;

// --- Save history: earlier versions, so "my progress is gone" can be undone ---

/** Earlier versions kept per player per game. */
export const SAVE_HISTORY_MAX = 5;
/** While playing, at most one routine copy an hour. */
export const SAVE_HISTORY_EVERY = 3600_000;
/** Copies made because progress was about to be lost are kept over routine ones for this long. */
export const SAVE_HISTORY_PROTECT = 30 * 24 * 3600_000;

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
  at: number;
  reason: SaveCopyReason;
  hash: string;
  bytes: number;
}

export const saveCopyKey = (accountId: string, gameId: string, id: string) => `${accountId}/${gameId}/${id}.json`;

/** A game's earlier versions, newest first. */
export async function saveHistory(db: D1Database, accountId: string, gameId: string): Promise<SaveCopy[]> {
  const { results } = await db.prepare("SELECT * FROM save_history WHERE account_id = ? AND game_id = ? ORDER BY at DESC, id").bind(accountId, gameId).all<SaveCopy>();
  return results;
}

/**
 * Whether to keep a copy of the current save before it's replaced, and why.
 * `replace` is set when the player chose this device's progress over the account's.
 */
export function copyReason(current: { bytes: number; updated_at: number }, next: { bytes: number; replace: boolean }, newestCopyAt: number | null): SaveCopyReason | null {
  if (next.replace) return "replaced";
  if (next.bytes * 2 < current.bytes) return "smaller";
  if (newestCopyAt === null || current.updated_at - newestCopyAt >= SAVE_HISTORY_EVERY) return "hourly";
  return null;
}

/**
 * Which copies to drop to stay at SAVE_HISTORY_MAX. The newest always stays. Past that, the
 * oldest routine copy goes first, so a copy from right before progress was lost outlives a day
 * of hourly copies; after 30 days it counts as routine.
 */
export function copiesToDrop(copies: SaveCopy[], now: number): SaveCopy[] {
  const keep = [...copies].sort((a, b) => b.at - a.at);
  const drop: SaveCopy[] = [];
  while (keep.length > SAVE_HISTORY_MAX) {
    const routine = (c: SaveCopy) => c.reason === "hourly" || now - c.at > SAVE_HISTORY_PROTECT;
    let i = keep.length - 1;
    while (i > 0 && !routine(keep[i]!)) i--;
    if (i === 0) i = keep.length - 1;
    drop.push(...keep.splice(i, 1));
  }
  return drop;
}

/** Record a copy (its data is already in R2) next to the game's `copies`, and return the ones to delete to make room. */
export async function addSaveCopy(db: D1Database, copy: SaveCopy, copies: SaveCopy[], now = Date.now()): Promise<SaveCopy[]> {
  const dropped = copiesToDrop([copy, ...copies], now);
  await db.batch([
    db.prepare("INSERT INTO save_history (id, account_id, game_id, at, reason, hash, bytes) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(copy.id, copy.account_id, copy.game_id, copy.at, copy.reason, copy.hash, copy.bytes),
    ...dropped.map((c) => db.prepare("DELETE FROM save_history WHERE id = ?").bind(c.id)),
  ]);
  return dropped;
}
