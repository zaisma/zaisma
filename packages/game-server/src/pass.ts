/**
 * Player passes: standard JWTs signed with Ed25519 (EdDSA). Our rooms check them,
 * and so can any developer's own server, using the keys published at
 * /.well-known/jwks.json. Any JWT library that supports EdDSA works.
 */

export interface PassClaims {
  /** Player ID. For guests, random and only valid for this pass. */
  sub: string;
  /** Display name. Guests get a generated one. */
  name: string;
  /** The game's slug: a pass only works for the game it was issued for. */
  aud: string;
  iss: string;
  kind: "guest";
  iat: number;
  exp: number;
}

export type PublicKey = JsonWebKey & { kid: string };

export class PassError extends Error {
  constructor(readonly code: "malformed" | "unknown-key" | "bad-signature" | "expired" | "wrong-game" | "wrong-issuer") {
    super(`Player pass rejected: ${code}`);
  }
}

const ED25519 = { name: "Ed25519" } as const;
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function keyId(x: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(x)));
  return b64url(digest).slice(0, 16);
}

/** Make a new signing key, as a JWK string for the PASS_SIGNING_KEY secret. */
export async function generateSigningKey(): Promise<string> {
  const pair = (await crypto.subtle.generateKey(ED25519, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  return JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, d: jwk.d });
}

export interface SigningKey {
  key: CryptoKey;
  publicKey: PublicKey;
}

export async function loadSigningKey(secret: string): Promise<SigningKey> {
  const jwk = JSON.parse(secret) as JsonWebKey;
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.x || !jwk.d) throw new Error("PASS_SIGNING_KEY must be an Ed25519 private JWK");
  const key = await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: jwk.x, d: jwk.d }, ED25519, false, ["sign"]);
  const publicKey: PublicKey = { kty: "OKP", crv: "Ed25519", x: jwk.x, kid: await keyId(jwk.x), alg: "EdDSA", use: "sig" } as PublicKey;
  return { key, publicKey };
}

export async function signPass(signing: SigningKey, claims: PassClaims): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: signing.publicKey.kid })));
  const body = b64url(enc.encode(JSON.stringify(claims)));
  const sig = new Uint8Array(await crypto.subtle.sign(ED25519, signing.key, enc.encode(`${header}.${body}`)));
  return `${header}.${body}.${b64url(sig)}`;
}

export function jwks(keys: PublicKey[]): { keys: PublicKey[] } {
  return { keys };
}

/** Check a pass. Throws PassError if it's forged, expired or for another game. */
export async function verifyPass(
  token: string,
  keys: PublicKey[],
  expect: { game: string; issuer: string; now?: number },
): Promise<PassClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new PassError("malformed");
  let header: { alg?: string; kid?: string };
  let claims: PassClaims;
  try {
    header = JSON.parse(dec.decode(unb64url(parts[0]!)));
    claims = JSON.parse(dec.decode(unb64url(parts[1]!)));
  } catch {
    throw new PassError("malformed");
  }
  if (header.alg !== "EdDSA") throw new PassError("malformed");
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new PassError("unknown-key");
  const key = await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: jwk.x }, ED25519, false, ["verify"]);
  let sig: Uint8Array;
  try {
    sig = unb64url(parts[2]!);
  } catch {
    throw new PassError("malformed");
  }
  if (!(await crypto.subtle.verify(ED25519, key, sig, enc.encode(`${parts[0]}.${parts[1]}`)))) throw new PassError("bad-signature");
  const now = Math.floor((expect.now ?? Date.now()) / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= now) throw new PassError("expired");
  if (claims.iss !== expect.issuer) throw new PassError("wrong-issuer");
  if (claims.aud !== expect.game) throw new PassError("wrong-game");
  if (typeof claims.sub !== "string" || typeof claims.name !== "string") throw new PassError("malformed");
  return claims;
}
