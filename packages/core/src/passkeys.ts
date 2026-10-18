/** An account's passkeys. The checks themselves are in webauthn.ts. */

export interface Passkey {
  id: string;
  account_id: string;
  public_key: string;
  algorithm_number: number;
  sign_count: number;
  name: string;
  created_at_ms: number;
  last_used_at_ms: number | null;
  /** From when it can make API keys and approve changes to how the account signs in: when it was added, or a day later when added without an older passkey's approval. */
  approves_from_at_ms: number;
}

/** How long a passkey added without an older passkey's approval waits before it can make keys or approve changes. */
export const PASSKEY_APPROVAL_WAIT_MS = 24 * 3600_000;

/** The passkeys that can make API keys and approve changes right now (not still waiting). */
export function approvingPasskeys(passkeys: Passkey[], nowMs = Date.now()): Passkey[] {
  return passkeys.filter((passkey) => passkey.approves_from_at_ms <= nowMs);
}

/** Plenty for a phone, a laptop and a password manager or two. */
export const MAXIMUM_PASSKEY_COUNT = 10;

export async function passkeysFor(database: D1Database, accountId: string): Promise<Passkey[]> {
  const { results } = await database.prepare("SELECT * FROM passkeys WHERE account_id = ? ORDER BY created_at_ms").bind(accountId).all<Passkey>();
  return results;
}

export async function passkeyById(database: D1Database, id: string): Promise<Passkey | null> {
  return database.prepare("SELECT * FROM passkeys WHERE id = ?").bind(id).first<Passkey>();
}

export async function addPasskey(database: D1Database, passkey: Omit<Passkey, "created_at_ms" | "last_used_at_ms" | "approves_from_at_ms">, approvesFromAtMs: number): Promise<boolean> {
  const [inserted] = await database.batch([
    database
      .prepare("INSERT INTO passkeys (id, account_id, public_key, algorithm_number, sign_count, name, created_at_ms, approves_from_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
      .bind(passkey.id, passkey.account_id, passkey.public_key, passkey.algorithm_number, passkey.sign_count, passkey.name, Date.now(), approvesFromAtMs),
    database.prepare("UPDATE accounts SET has_had_passkey = 1 WHERE id = ? AND EXISTS (SELECT 1 FROM passkeys WHERE id = ? AND account_id = ?)").bind(passkey.account_id, passkey.id, passkey.account_id),
  ]);
  return inserted!.meta.changes === 1;
}

export async function usedPasskey(database: D1Database, id: string, signCount: number): Promise<void> {
  await database.prepare("UPDATE passkeys SET sign_count = ?, last_used_at_ms = ? WHERE id = ?").bind(signCount, Date.now(), id).run();
}

export async function removePasskey(database: D1Database, accountId: string, id: string): Promise<void> {
  await database.prepare("DELETE FROM passkeys WHERE account_id = ? AND id = ?").bind(accountId, id).run();
}

/** A plain name for where a passkey was added, from the browser's description of itself. */
export function deviceName(userAgent: string): string {
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent)) return "iPad";
  if (/Android/.test(userAgent)) return /Mobile/.test(userAgent) ? "Android phone" : "Android tablet";
  if (/CrOS/.test(userAgent)) return "Chromebook";
  if (/Macintosh|Mac OS X/.test(userAgent)) return "Mac";
  if (/Windows/.test(userAgent)) return "Windows PC";
  if (/Linux/.test(userAgent)) return "Linux computer";
  return "a device";
}
