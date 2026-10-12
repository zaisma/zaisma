/**
 * Passkeys (WebAuthn), checked with WebCrypto and no libraries.
 *
 * Adding a passkey: the browser hands over the public key (getPublicKey(), as SPKI) and the
 * authenticator data (getAuthenticatorData()), so no CBOR is needed. Attestation is "none":
 * we don't check what made the key, only that the player's own browser made it for us.
 * Signing in: we check the authenticator data and the signature over it with the stored key.
 */

/** The key types we accept: ES256 (almost everything) and RS256 (Windows Hello on older PCs). */
export const PASSKEY_ALGS = [-7, -257] as const;

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export const newChallenge = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

interface Expected {
  challenge: string;
  origin: string;
  rpId: string;
}

const sha256 = async (data: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", data));
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

function clientData(raw: Uint8Array, type: string, want: Expected): boolean {
  try {
    const c = JSON.parse(new TextDecoder().decode(raw)) as { type?: string; challenge?: string; origin?: string; crossOrigin?: boolean };
    return c.type === type && c.challenge === want.challenge && c.origin === want.origin && c.crossOrigin !== true;
  } catch {
    return false;
  }
}

/** Authenticator data: rpIdHash (32), flags (1), signCount (4), then attested credential data when adding. */
async function authData(raw: Uint8Array, rpId: string): Promise<{ flags: number; signCount: number } | null> {
  if (raw.length < 37 || !same(raw.slice(0, 32), await sha256(new TextEncoder().encode(rpId)))) return null;
  const flags = raw[32]!;
  // The player was present (UP) and verified with Face ID, a fingerprint or a PIN (UV).
  if (!(flags & 0x01) || !(flags & 0x04)) return null;
  return { flags, signCount: new DataView(raw.buffer, raw.byteOffset + 33, 4).getUint32(0) };
}

function importParams(alg: number): { import: Parameters<typeof crypto.subtle.importKey>[2]; verify: Parameters<typeof crypto.subtle.verify>[0] } | null {
  if (alg === -7) return { import: { name: "ECDSA", namedCurve: "P-256" }, verify: { name: "ECDSA", hash: "SHA-256" } };
  if (alg === -257) return { import: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, verify: "RSASSA-PKCS1-v1_5" };
  return null;
}

export interface NewPasskey {
  id: string;
  clientDataJSON: string;
  authenticatorData: string;
  publicKey: string;
  alg: number;
}

/** Check a passkey the browser just made. Returns its starting sign count, or null if anything is off. */
export async function checkNewPasskey(p: NewPasskey, want: Expected): Promise<{ signCount: number } | null> {
  const cd = fromB64url(p.clientDataJSON);
  const ad = fromB64url(p.authenticatorData);
  const key = fromB64url(p.publicKey);
  const id = fromB64url(p.id);
  const params = importParams(p.alg);
  if (!cd || !ad || !key || !id || !id.length || !params || !clientData(cd, "webauthn.create", want)) return null;
  const data = await authData(ad, want.rpId);
  if (!data || !(data.flags & 0x40) || ad.length < 55) return null;
  // The attested credential data names the same credential the browser gave us.
  const idLength = (ad[53]! << 8) | ad[54]!;
  if (!same(ad.slice(55, 55 + idLength), id)) return null;
  try {
    await crypto.subtle.importKey("spki", key, params.import, false, ["verify"]);
  } catch {
    return null;
  }
  return { signCount: data.signCount };
}

export interface PasskeyUse {
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
}

/**
 * Check a sign-in with a stored passkey. Returns the new sign count, or null. A count that
 * goes backwards means the key was copied, so it's refused (passkeys that sync always send 0).
 */
export async function checkPasskeyUse(p: PasskeyUse, key: { publicKey: string; alg: number; signCount: number }, want: Expected): Promise<{ signCount: number } | null> {
  const cd = fromB64url(p.clientDataJSON);
  const ad = fromB64url(p.authenticatorData);
  let sig = fromB64url(p.signature);
  const spki = fromB64url(key.publicKey);
  const params = importParams(key.alg);
  if (!cd || !ad || !sig || !spki || !params || !clientData(cd, "webauthn.get", want)) return null;
  const data = await authData(ad, want.rpId);
  if (!data) return null;
  if (data.signCount !== 0 || key.signCount !== 0) {
    if (data.signCount <= key.signCount) return null;
  }
  if (key.alg === -7) sig = derToRaw(sig);
  if (!sig.length) return null;
  const signed = new Uint8Array(ad.length + 32);
  signed.set(ad);
  signed.set(await sha256(cd), ad.length);
  try {
    const k = await crypto.subtle.importKey("spki", spki, params.import, false, ["verify"]);
    return (await crypto.subtle.verify(params.verify, k, sig, signed)) ? { signCount: data.signCount } : null;
  } catch {
    return null;
  }
}

/** WebAuthn ES256 signatures are DER; WebCrypto wants the two 32-byte numbers side by side. */
function derToRaw(der: Uint8Array): Uint8Array {
  const out = new Uint8Array(64);
  if (der[0] !== 0x30) return new Uint8Array(0);
  let i = 2;
  for (const at of [0, 32]) {
    if (der[i] !== 0x02) return new Uint8Array(0);
    let len = der[i + 1]!;
    let start = i + 2;
    i = start + len;
    while (len > 32 && der[start] === 0) {
      start++;
      len--;
    }
    if (len > 32) return new Uint8Array(0);
    out.set(der.slice(start, start + len), at + 32 - len);
  }
  return out;
}
