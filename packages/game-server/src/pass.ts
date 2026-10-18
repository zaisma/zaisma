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
  /** Who an account lets chat with it: nobody, its friends, or anyone in its chat group. Guests' passes have none: guests don't chat. */
  who_can_chat?: WhoCanChat;
  /**
   * For accounts that chat with anyone, the group they can chat in (chat_group_…): two such players
   * chat when their groups match. Opaque and different in every game, so it never says an age.
   */
  chat_group?: string;
  /**
   * An account's own player tag in this game (player_tag_…): opaque, and different in every game, so
   * it says nothing outside it. Other passes list it to say they're friends (friend_tag_ids) or have a
   * block (block_tag_ids). Guests' passes have none.
   */
  player_tag?: string;
  /**
   * The player tags of an account's friends, up to 200, as they were when the pass was made: never
   * their player IDs, so a game learns only which of its own players are friends, by their passes
   * (areFriends). Friends are always two-way, so areFriends asks both passes. Guests' passes have none.
   */
  friend_tag_ids?: string[];
  /**
   * The player tags of the accounts this one has a block with, either way, newest first and up to 100,
   * as they were when the pass was made. Never says who made a block, and means nothing without the
   * other player's pass: two players have a block between them when either pass lists the other's
   * player_tag (hasBlockBetween).
   */
  block_tag_ids?: string[];
  iat: number;
  exp: number;
}

/** A signed-in Zaisma account, or a guest. */
export type PlayerKind = "guest" | "account";

/** No chat, friends only, or anyone in the same chat group: the player's "Who can chat with you" setting (docs/DECISIONS.md, "Social settings, with the social modes as presets"). */
export type WhoCanChat = "nobody" | "friends" | "anyone";

const WHO_CAN_CHAT_CHOICES: readonly string[] = ["nobody", "friends", "anyone"];

/**
 * Whether two players have a block between them, by the passes your server checked (verifyPass): either
 * one blocked the other, which neither pass says. A block is a wall both ways: deliver nothing from one
 * to the other (chat, voice, emotes) and don't match them together when you can help it, but never keep
 * either out of a room. A new block reaches your server with the blocker's next pass, and the blocker's
 * game also tells the room ({ type: "block", playerId }), which room.hasBlockBetween covers.
 */
export function hasBlockBetween(first: PassClaims, second: PassClaims): boolean {
  if (first.sub === second.sub) return false;
  const lists = (pass: PassClaims, other: PassClaims) => typeof other.player_tag === "string" && Array.isArray(pass.block_tag_ids) && pass.block_tag_ids.includes(other.player_tag);
  return lists(first, second) || lists(second, first);
}

/**
 * Whether two players are Zaisma friends, by the passes your server checked (verifyPass): both accounts,
 * each pass listing the other's player_tag, so removing a friend holds as soon as either side has a new
 * pass. It works across rooms too: any two passes for the game. Use it for friends-only chat (canChat
 * does), parties, or showing a player their friends; guests are never anyone's friend.
 */
export function areFriends(first: PassClaims, second: PassClaims): boolean {
  if (first.kind !== "account" || second.kind !== "account" || first.sub === second.sub) return false;
  const lists = (pass: PassClaims, other: PassClaims) => typeof other.player_tag === "string" && Array.isArray(pass.friend_tag_ids) && pass.friend_tag_ids.includes(other.player_tag);
  return lists(first, second) && lists(second, first);
}

/**
 * Whether two players may chat, by the passes your server checked (verifyPass): both accounts, no block
 * between them, neither letting nobody chat, and either friends or both letting anyone chat, in the same
 * chat group. Guests and accounts set to nobody never chat; accounts set to friends chat only with
 * friends (areFriends). Use it on every message your own server delivers, text or voice; Zaisma
 * rooms will do the same for you.
 */
export function canChat(first: PassClaims, second: PassClaims): boolean {
  if (first.kind !== "account" || second.kind !== "account" || first.sub === second.sub) return false;
  if (hasBlockBetween(first, second)) return false;
  if (!first.who_can_chat || !second.who_can_chat || first.who_can_chat === "nobody" || second.who_can_chat === "nobody") return false;
  if (areFriends(first, second)) return true;
  return first.who_can_chat === "anyone" && second.who_can_chat === "anyone" && typeof first.chat_group === "string" && first.chat_group === second.chat_group;
}

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
  if (claims.who_can_chat !== undefined && !WHO_CAN_CHAT_CHOICES.includes(claims.who_can_chat)) throw new PassError("malformed");
  if (claims.chat_group !== undefined && typeof claims.chat_group !== "string") throw new PassError("malformed");
  if (claims.player_tag !== undefined && typeof claims.player_tag !== "string") throw new PassError("malformed");
  if (claims.friend_tag_ids !== undefined && !(Array.isArray(claims.friend_tag_ids) && claims.friend_tag_ids.every((playerTag) => typeof playerTag === "string"))) throw new PassError("malformed");
  if (claims.block_tag_ids !== undefined && !(Array.isArray(claims.block_tag_ids) && claims.block_tag_ids.every((playerTag) => typeof playerTag === "string"))) throw new PassError("malformed");
  return claims;
}
