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

/** Where a save's data lives in the saves bucket. Listing <account>/ finds all of a player's saves. */
export const saveKey = (accountId: string, gameId: string) => `${accountId}/${gameId}.json`;
