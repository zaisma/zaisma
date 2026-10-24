import { loadSigningKey, type PublicKey, type SigningKey } from "@zaisma/game-server/internal";

/** A signing key, loaded once per secret. */
function cached(): (secret: string) => Promise<SigningKey> {
  let loaded: { secret: string; key: Promise<SigningKey> } | null = null;
  return (secret) => {
    if (loaded?.secret !== secret) loaded = { secret, key: loadSigningKey(secret) };
    return loaded.key;
  };
}

const passKey = cached();
const receiptKey = cached();

/** The pass signing key (PASS_SIGNING_KEY): it signs passes, and rotates freely, since passes last a day. */
export function signingKey(env: { PASS_SIGNING_KEY: string }): Promise<SigningKey> {
  return passKey(env.PASS_SIGNING_KEY);
}

/** The receipt signing key (RECEIPT_SIGNING_KEY): it signs receipts only, and stays published once retired (RETIRED_RECEIPT_PUBLIC_KEYS). */
export function receiptSigningKey(env: { RECEIPT_SIGNING_KEY?: string }): Promise<SigningKey> {
  if (!env.RECEIPT_SIGNING_KEY) return Promise.reject(new Error("RECEIPT_SIGNING_KEY isn't set"));
  return receiptKey(env.RECEIPT_SIGNING_KEY);
}

/**
 * The retired receipt keys (RETIRED_RECEIPT_PUBLIC_KEYS, a JSON list of public JWKs), each cut down to its public
 * fields, so a private key pasted in by mistake never gets published. Throws when the setting isn't such a list.
 */
function retiredReceiptKeys(setting: string | undefined): PublicKey[] {
  const listed: unknown = JSON.parse(setting || "[]");
  if (!Array.isArray(listed)) throw new Error("RETIRED_RECEIPT_PUBLIC_KEYS must be a JSON list of public JWKs");
  return listed.map((key: Partial<PublicKey> | null) => {
    if (key?.kty !== "OKP" || key.crv !== "Ed25519" || typeof key.x !== "string" || typeof key.kid !== "string") throw new Error("RETIRED_RECEIPT_PUBLIC_KEYS holds a key that isn't an Ed25519 public JWK with a kid");
    return { kty: "OKP", crv: "Ed25519", x: key.x, kid: key.kid, alg: "EdDSA", use: "sig" } as PublicKey;
  });
}

/**
 * Every key a receipt may be signed with: the current receipt key and each retired one, which stay published
 * for good so a receipt never expires.
 */
export async function receiptPublicKeys(env: { RECEIPT_SIGNING_KEY?: string; RETIRED_RECEIPT_PUBLIC_KEYS?: string }): Promise<PublicKey[]> {
  const retired = retiredReceiptKeys(env.RETIRED_RECEIPT_PUBLIC_KEYS);
  return env.RECEIPT_SIGNING_KEY ? [(await receiptSigningKey(env)).publicKey, ...retired] : retired;
}

/**
 * What /.well-known/receipt-jwks.json publishes: the current receipt key and every retired one. Apart from the
 * pass key's /.well-known/jwks.json, so no server that checks passes against that list ever takes a receipt key's
 * signature for a pass. Throws when the current key isn't set or the setting doesn't load, so the route fails
 * and ship's check of it says so, rather than publishing the retired keys alone.
 */
export async function publishedReceiptKeys(env: { RECEIPT_SIGNING_KEY?: string; RETIRED_RECEIPT_PUBLIC_KEYS?: string }): Promise<PublicKey[]> {
  return [(await receiptSigningKey(env)).publicKey, ...retiredReceiptKeys(env.RETIRED_RECEIPT_PUBLIC_KEYS)];
}
