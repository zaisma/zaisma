/**
 * Passkeys (WebAuthn), checked with WebCrypto and no libraries.
 *
 * Adding a passkey: the browser hands over the public key (getPublicKey(), as SPKI) and the
 * authenticator data (getAuthenticatorData()), so no CBOR is needed. Attestation is "none":
 * we don't check what made the key, only that the player's own browser made it for us.
 * Signing in: we check the authenticator data and the signature over it with the stored key.
 */

/** The key types we accept: ES256 (almost everything) and RS256 (Windows Hello on older PCs). */
export const PASSKEY_ALGORITHM_NUMBERS = [-7, -257] as const;

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const byteArray = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of byteArray) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(encoded: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(encoded)) return null;
  try {
    return Uint8Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((encoded.length + 3) % 4)), (character) => character.charCodeAt(0));
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

const sha256 = async (bytes: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
const same = (first: Uint8Array, second: Uint8Array) => first.length === second.length && first.every((byte, i) => byte === second[i]);

/** WebAuthn's CollectedClientData, in the standard's own words. */
interface CollectedClientData {
  type?: string;
  challenge?: string;
  origin?: string;
  crossOrigin?: boolean;
}

function clientData(raw: Uint8Array, type: string, want: Expected): boolean {
  try {
    const collected = JSON.parse(new TextDecoder().decode(raw)) as CollectedClientData;
    return collected.type === type && collected.challenge === want.challenge && collected.origin === want.origin && collected.crossOrigin !== true;
  } catch {
    return false;
  }
}

/** The parts of WebAuthn's authenticator data we use, in the standard's own words. */
interface AuthenticatorData {
  flags: number;
  signCount: number;
}

/** Authenticator data: rpIdHash (32), flags (1), signCount (4), then attested credential data when adding. */
async function readAuthenticatorData(raw: Uint8Array, rpId: string): Promise<AuthenticatorData | null> {
  if (raw.length < 37 || !same(raw.slice(0, 32), await sha256(new TextEncoder().encode(rpId)))) return null;
  const flagsByte = raw[32]!;
  // The player was present (UP) and verified with Face ID, a fingerprint or a PIN (UV).
  if (!(flagsByte & 0x01) || !(flagsByte & 0x04)) return null;
  return { flags: flagsByte, signCount: new DataView(raw.buffer, raw.byteOffset + 33, 4).getUint32(0) };
}

function importParameters(algorithmNumber: number): { import: Parameters<typeof crypto.subtle.importKey>[2]; verify: Parameters<typeof crypto.subtle.verify>[0] } | null {
  if (algorithmNumber === -7) return { import: { name: "ECDSA", namedCurve: "P-256" }, verify: { name: "ECDSA", hash: "SHA-256" } };
  if (algorithmNumber === -257) return { import: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, verify: "RSASSA-PKCS1-v1_5" };
  return null;
}

export interface NewPasskey {
  id: string;
  clientDataJSON: string;
  authenticatorData: string;
  publicKey: string;
  algorithmNumber: number;
}

/** Check a passkey the browser just made. Returns its starting sign count, or null if anything is off. */
export async function checkNewPasskey(passkey: NewPasskey, want: Expected): Promise<{ signCount: number } | null> {
  const clientDataBytes = fromB64url(passkey.clientDataJSON);
  const authenticatorDataBytes = fromB64url(passkey.authenticatorData);
  const key = fromB64url(passkey.publicKey);
  const id = fromB64url(passkey.id);
  const algorithm = importParameters(passkey.algorithmNumber);
  if (!clientDataBytes || !authenticatorDataBytes || !key || !id || !id.length || !algorithm || !clientData(clientDataBytes, "webauthn.create", want)) return null;
  const authenticatorData = await readAuthenticatorData(authenticatorDataBytes, want.rpId);
  if (!authenticatorData || !(authenticatorData.flags & 0x40) || authenticatorDataBytes.length < 55) return null;
  // The attested credential data names the same credential the browser gave us.
  const idLengthBytes = (authenticatorDataBytes[53]! << 8) | authenticatorDataBytes[54]!;
  if (!same(authenticatorDataBytes.slice(55, 55 + idLengthBytes), id)) return null;
  try {
    await crypto.subtle.importKey("spki", key, algorithm.import, false, ["verify"]);
  } catch {
    return null;
  }
  return { signCount: authenticatorData.signCount };
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
export async function checkPasskeyUse(passkeyUse: PasskeyUse, key: { publicKey: string; algorithmNumber: number; signCount: number }, want: Expected): Promise<{ signCount: number } | null> {
  const clientDataBytes = fromB64url(passkeyUse.clientDataJSON);
  const authenticatorDataBytes = fromB64url(passkeyUse.authenticatorData);
  let signature = fromB64url(passkeyUse.signature);
  const spki = fromB64url(key.publicKey);
  const algorithm = importParameters(key.algorithmNumber);
  if (!clientDataBytes || !authenticatorDataBytes || !signature || !spki || !algorithm || !clientData(clientDataBytes, "webauthn.get", want)) return null;
  const authenticatorData = await readAuthenticatorData(authenticatorDataBytes, want.rpId);
  if (!authenticatorData) return null;
  if (authenticatorData.signCount !== 0 || key.signCount !== 0) {
    if (authenticatorData.signCount <= key.signCount) return null;
  }
  if (key.algorithmNumber === -7) signature = derToRaw(signature);
  if (!signature.length) return null;
  const signed = new Uint8Array(authenticatorDataBytes.length + 32);
  signed.set(authenticatorDataBytes);
  signed.set(await sha256(clientDataBytes), authenticatorDataBytes.length);
  try {
    const cryptoKey = await crypto.subtle.importKey("spki", spki, algorithm.import, false, ["verify"]);
    return (await crypto.subtle.verify(algorithm.verify, cryptoKey, signature, signed)) ? { signCount: authenticatorData.signCount } : null;
  } catch {
    return null;
  }
}

/** WebAuthn ES256 signatures are DER; WebCrypto wants the two 32-byte numbers side by side. */
function derToRaw(der: Uint8Array): Uint8Array {
  const out = new Uint8Array(64);
  if (der[0] !== 0x30) return new Uint8Array(0);
  let i = 2;
  for (const outIndex of [0, 32]) {
    if (der[i] !== 0x02) return new Uint8Array(0);
    let lengthBytes = der[i + 1]!;
    let startIndex = i + 2;
    i = startIndex + lengthBytes;
    while (lengthBytes > 32 && der[startIndex] === 0) {
      startIndex++;
      lengthBytes--;
    }
    if (lengthBytes > 32) return new Uint8Array(0);
    out.set(der.slice(startIndex, startIndex + lengthBytes), outIndex + 32 - lengthBytes);
  }
  return out;
}
