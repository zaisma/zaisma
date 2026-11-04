import { sha256Hex } from "./ids.ts";

/**
 * Secrets kept in the database, unreadable to anyone holding only the database: its dump, a backup, a leaked
 * query. Each is sealed with AES-256-GCM under a key derived from STORED_SECRETS_KEY, which only the Workers
 * hold, and bound to its place (table, column and row), so a write to the database can't move one to another row.
 *
 * Two slots, so the key can be replaced: a sealed value names the slot that sealed it and either opens it, new
 * ones use the slot in use, and sealStoredSecrets moves the rest across (scripts/replace-key.mjs, "swap").
 */

export interface StoredSecretsKeys {
  /** 32 random bytes, base64. */
  STORED_SECRETS_KEY: string;
  SECOND_STORED_SECRETS_KEY?: string;
  /** "true" while the second slot seals new values; any other value or none is the first. */
  IS_SECOND_STORED_SECRETS_KEY_IN_USE?: string;
}

type KeySlot = "first" | "second";

const SEALED_VALUE_PATTERN = /^(first|second)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;
const IV_BYTE_COUNT = 12;
const encoder = new TextEncoder();

const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (character) => character.charCodeAt(0));

const slotInUse = (keys: StoredSecretsKeys): KeySlot => (keys.IS_SECOND_STORED_SECRETS_KEY_IN_USE === "true" ? "second" : "first");

function slotSecret(keys: StoredSecretsKeys, slot: KeySlot): string {
  const secret = slot === "first" ? keys.STORED_SECRETS_KEY : keys.SECOND_STORED_SECRETS_KEY;
  if (!secret) throw new Error(`${slot === "first" ? "STORED_SECRETS_KEY" : "SECOND_STORED_SECRETS_KEY"} isn't set: node scripts/replace-key.mjs setup`);
  return secret;
}

function secretBytes(secret: string): Uint8Array<ArrayBuffer> {
  const bytes = Uint8Array.from(atob(secret), (character) => character.charCodeAt(0));
  if (bytes.length < 32) throw new Error("A stored secrets key must be 32 random bytes, base64 (openssl rand -base64 32)");
  return bytes;
}

/**
 * The key's bytes in every slot that holds one, the one in use first: for a secret kept as a salt instead of
 * sealed (a game's entry_signing_key, a version's preview_link_key), whose real key is an HMAC of it under these,
 * so the database alone can't sign with it, and a swap leaves what was signed before still checking.
 */
export function storedSecretsKeyBytes(keys: StoredSecretsKeys): Uint8Array<ArrayBuffer>[] {
  const inUse = slotInUse(keys);
  const other: KeySlot = inUse === "first" ? "second" : "first";
  const otherSecret = other === "first" ? keys.STORED_SECRETS_KEY : keys.SECOND_STORED_SECRETS_KEY;
  return [secretBytes(slotSecret(keys, inUse)), ...(otherSecret ? [secretBytes(otherSecret)] : [])];
}

const sealingKeys = new Map<string, Promise<CryptoKey>>();

/** The AES key of a stored secrets key, kept per instance: deriving it costs nothing to speak of, but neither does keeping it. */
function sealingKey(secret: string): Promise<CryptoKey> {
  let key = sealingKeys.get(secret);
  if (!key) {
    key = crypto.subtle
      .importKey("raw", secretBytes(secret), "HKDF", false, ["deriveKey"])
      .then((material) => crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: encoder.encode("sealed_secret") }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]));
    sealingKeys.set(secret, key);
  }
  return key;
}

/** Seal a secret for its place, like "webhooks.signing_secret:webhook_abc". */
export async function sealSecret(keys: StoredSecretsKeys, secretValue: string, place: string): Promise<string> {
  const slot = slotInUse(keys);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTE_COUNT));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(place) }, await sealingKey(slotSecret(keys, slot)), encoder.encode(secretValue));
  return `${slot}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(sealed))}`;
}

/** Open a sealed value. Throws when it's been changed, is from another place, or its slot's key is gone. */
export async function openSecret(keys: StoredSecretsKeys, sealedValue: string, place: string): Promise<string> {
  const match = SEALED_VALUE_PATTERN.exec(sealedValue);
  if (!match) throw new Error(`The sealed value at ${place} isn't one`);
  const opened = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(match[2]!), additionalData: encoder.encode(place) }, await sealingKey(slotSecret(keys, match[1] as KeySlot)), fromBase64Url(match[3]!));
  return new TextDecoder().decode(opened);
}

/** Where each sealed secret lives. The plain column empties as the cron seals it; lookup is the SHA-256 a row is found by, if any. */
const SEALED_COLUMNS = [
  { tableName: "webhooks", plainColumn: "signing_secret", sealedColumn: "sealed_signing_secret", lookupColumn: null },
  { tableName: "tester_links", plainColumn: "token", sealedColumn: "sealed_token", lookupColumn: "token_sha256" },
] as const;

/** Rows looked at per table and kind each run, well inside a cron run's time. */
const SEAL_BATCH_ROW_COUNT = 500;

/**
 * Every 5 minutes: seals secrets still kept plain, and moves values sealed with the slot not in use onto the one in
 * use, so that slot's key can be replaced. Each update names the value it read, so a secret replaced meanwhile
 * stays as it was replaced. A value that won't open is logged and left: it fails where it's used, and the rest go on.
 */
export async function sealStoredSecrets(database: D1Database, keys: StoredSecretsKeys): Promise<void> {
  const slotPrefix = `${slotInUse(keys)}.%`;
  for (const { tableName, plainColumn, sealedColumn, lookupColumn } of SEALED_COLUMNS) {
    const { results: plainRows } = await database.prepare(`SELECT id, ${plainColumn} AS plain_value FROM ${tableName} WHERE ${plainColumn} IS NOT NULL LIMIT ?`).bind(SEAL_BATCH_ROW_COUNT).all<{ id: string; plain_value: string }>();
    const { results: otherSlotRows } = await database.prepare(`SELECT id, ${sealedColumn} AS sealed_value FROM ${tableName} WHERE ${sealedColumn} IS NOT NULL AND ${sealedColumn} NOT LIKE ? LIMIT ?`).bind(slotPrefix, SEAL_BATCH_ROW_COUNT).all<{ id: string; sealed_value: string }>();
    const updates: D1PreparedStatement[] = [];
    for (const row of plainRows) {
      const sealedValue = await sealSecret(keys, row.plain_value, `${tableName}.${plainColumn}:${row.id}`);
      if (lookupColumn) updates.push(database.prepare(`UPDATE ${tableName} SET ${sealedColumn} = ?, ${lookupColumn} = ?, ${plainColumn} = NULL WHERE id = ? AND ${plainColumn} = ?`).bind(sealedValue, await sha256Hex(encoder.encode(row.plain_value)), row.id, row.plain_value));
      else updates.push(database.prepare(`UPDATE ${tableName} SET ${sealedColumn} = ?, ${plainColumn} = NULL WHERE id = ? AND ${plainColumn} = ?`).bind(sealedValue, row.id, row.plain_value));
    }
    for (const row of otherSlotRows) {
      const place = `${tableName}.${plainColumn}:${row.id}`;
      try {
        const sealedValue = await sealSecret(keys, await openSecret(keys, row.sealed_value, place), place);
        updates.push(database.prepare(`UPDATE ${tableName} SET ${sealedColumn} = ? WHERE id = ? AND ${sealedColumn} = ?`).bind(sealedValue, row.id, row.sealed_value));
      } catch (error) {
        console.error(`${place} won't open: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (updates.length) await database.batch(updates);
  }
}
