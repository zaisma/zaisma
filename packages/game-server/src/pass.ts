/**
 * Player passes: standard JWTs signed with Ed25519 (EdDSA). Our rooms check them,
 * and so can any developer's own server, using the keys published at
 * /.well-known/jwks.json. Any JWT library that supports EdDSA works.
 */

/**
 * What a pass proves: who the player is, for which game, until when. Nothing more; anything else
 * about an account (its name) comes from its public profile, <issuer>/v1/players/<id>.
 */
export interface PassClaims {
  /** Player ID. An account's is the same in every game; a guest's is random and only valid for this pass. */
  sub: string;
  /** A guest's generated name. Account passes carry none. */
  name?: string;
  /** The game's slug: a pass only works for the game it was issued for. */
  aud: string;
  iss: string;
  kind: PlayerKind;
  iat: number;
  exp: number;
}

/** A signed-in Zaisma account, or a guest. */
export type PlayerKind = "guest" | "account";

export type PublicKey = JsonWebKey & { kid: string };

export type PassErrorCode = "malformed" | "unknown_key" | "bad_signature" | "expired" | "wrong_game" | "wrong_issuer";

// Plain class fields (no TypeScript-only syntax) so Node can run this file directly.
export class PassError extends Error {
  readonly code: PassErrorCode;
  constructor(code: PassErrorCode) {
    super(`Player pass rejected: ${code}`);
    this.code = code;
  }
}

const ED25519 = { name: "Ed25519" } as const;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function keyId(publicKeyBase64Url: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(publicKeyBase64Url)));
  return toBase64Url(digest).slice(0, 16);
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
  const header = toBase64Url(encoder.encode(JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: signing.publicKey.kid })));
  const body = toBase64Url(encoder.encode(JSON.stringify(claims)));
  const signature = new Uint8Array(await crypto.subtle.sign(ED25519, signing.key, encoder.encode(`${header}.${body}`)));
  return `${header}.${body}.${toBase64Url(signature)}`;
}

export function jwks(keys: PublicKey[]): { keys: PublicKey[] } {
  return { keys };
}

/** Check a pass. Throws PassError if it's forged, expired or for another game. */
export async function verifyPass(
  token: string,
  keys: PublicKey[],
  expect: { game: string; issuer: string; nowMs?: number },
): Promise<PassClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new PassError("malformed");
  let header: { alg?: string; kid?: string };
  let claims: PassClaims;
  try {
    header = JSON.parse(decoder.decode(fromBase64Url(parts[0]!)));
    claims = JSON.parse(decoder.decode(fromBase64Url(parts[1]!)));
  } catch {
    throw new PassError("malformed");
  }
  if (header.alg !== "EdDSA") throw new PassError("malformed");
  const jwk = keys.find((publicKey) => publicKey.kid === header.kid);
  if (!jwk) throw new PassError("unknown_key");
  const key = await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: jwk.x }, ED25519, false, ["verify"]);
  let signature: Uint8Array;
  try {
    signature = fromBase64Url(parts[2]!);
  } catch {
    throw new PassError("malformed");
  }
  if (!(await crypto.subtle.verify(ED25519, key, signature, encoder.encode(`${parts[0]}.${parts[1]}`)))) throw new PassError("bad_signature");
  const nowSec = Math.floor((expect.nowMs ?? Date.now()) / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= nowSec) throw new PassError("expired");
  if (claims.iss !== expect.issuer) throw new PassError("wrong_issuer");
  if (claims.aud !== expect.game) throw new PassError("wrong_game");
  if (typeof claims.sub !== "string") throw new PassError("malformed");
  if (claims.kind !== "account" && !(claims.kind === "guest" && typeof claims.name === "string")) throw new PassError("malformed");
  return claims;
}
