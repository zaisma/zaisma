/** An account's passkeys. The checks themselves are in webauthn.ts. */

export interface Passkey {
  id: string;
  account_id: string;
  public_key: string;
  alg: number;
  sign_count: number;
  name: string;
  created_at: number;
  last_used_at: number | null;
}

/** Plenty for a phone, a laptop and a password manager or two. */
export const MAX_PASSKEYS = 10;

export async function passkeysFor(db: D1Database, accountId: string): Promise<Passkey[]> {
  const { results } = await db.prepare("SELECT * FROM passkeys WHERE account_id = ? ORDER BY created_at").bind(accountId).all<Passkey>();
  return results;
}

export async function passkeyById(db: D1Database, id: string): Promise<Passkey | null> {
  return db.prepare("SELECT * FROM passkeys WHERE id = ?").bind(id).first<Passkey>();
}

export async function addPasskey(db: D1Database, p: Omit<Passkey, "created_at" | "last_used_at">): Promise<boolean> {
  const r = await db
    .prepare("INSERT INTO passkeys (id, account_id, public_key, alg, sign_count, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
    .bind(p.id, p.account_id, p.public_key, p.alg, p.sign_count, p.name, Date.now())
    .run();
  return r.meta.changes === 1;
}

export async function usedPasskey(db: D1Database, id: string, signCount: number): Promise<void> {
  await db.prepare("UPDATE passkeys SET sign_count = ?, last_used_at = ? WHERE id = ?").bind(signCount, Date.now(), id).run();
}

export async function removePasskey(db: D1Database, accountId: string, id: string): Promise<void> {
  await db.prepare("DELETE FROM passkeys WHERE account_id = ? AND id = ?").bind(accountId, id).run();
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
