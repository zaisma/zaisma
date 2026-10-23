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
  /**
   * The permanent items an account owns in this game (bought or granted, not refunded), by item_name, as
   * they were when the pass was made. Absent for guests and when the player owns nothing here. Consumables
   * are never listed: they're delivered once and then they're the game's to count.
   */
  owned_item_names?: string[];
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

export type PassErrorCode = "malformed" | "unknown_key" | "bad_signature" | "expired" | "wrong_game" | "wrong_issuer" | "wrong_kind";

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

export async function signPass(signing: SigningKey, claims: PassClaims | ReceiptClaims): Promise<string> {
  const header = toBase64Url(encoder.encode(JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: signing.publicKey.kid })));
  const body = toBase64Url(encoder.encode(JSON.stringify(claims)));
  const signature = new Uint8Array(await crypto.subtle.sign(ED25519, signing.key, encoder.encode(`${header}.${body}`)));
  return `${header}.${body}.${toBase64Url(signature)}`;
}

export function jwks(keys: PublicKey[]): { keys: PublicKey[] } {
  return { keys };
}

/** A token's claims once its signature checks out against one of the keys, for verifyPass and verifyReceipt. */
async function signedClaims(token: string, keys: PublicKey[]): Promise<Record<string, unknown>> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new PassError("malformed");
  let header: { alg?: string; kid?: string };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(decoder.decode(fromBase64Url(parts[0]!)));
    claims = JSON.parse(decoder.decode(fromBase64Url(parts[1]!)));
  } catch {
    throw new PassError("malformed");
  }
  if (header.alg !== "EdDSA" || !claims || typeof claims !== "object") throw new PassError("malformed");
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
  return claims;
}

const isStringList = (given: unknown) => Array.isArray(given) && given.every((entry) => typeof entry === "string");

/** Check a pass. Throws PassError if it's forged, expired, for another game, or a receipt. */
export async function verifyPass(
  token: string,
  keys: PublicKey[],
  expect: { game: string; issuer: string; nowMs?: number },
): Promise<PassClaims> {
  const claims = (await signedClaims(token, keys)) as unknown as PassClaims;
  // A receipt is signed with the same key, and never stands in for a pass.
  if ((claims.kind as string) === "receipt") throw new PassError("wrong_kind");
  const nowSec = Math.floor((expect.nowMs ?? Date.now()) / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= nowSec) throw new PassError("expired");
  if (claims.iss !== expect.issuer) throw new PassError("wrong_issuer");
  if (claims.aud !== expect.game) throw new PassError("wrong_game");
  if (typeof claims.sub !== "string") throw new PassError("malformed");
  if (claims.kind !== "account" && !(claims.kind === "guest" && typeof claims.name === "string")) throw new PassError("malformed");
  if (claims.who_can_chat !== undefined && !WHO_CAN_CHAT_CHOICES.includes(claims.who_can_chat)) throw new PassError("malformed");
  if (claims.chat_group !== undefined && typeof claims.chat_group !== "string") throw new PassError("malformed");
  if (claims.player_tag !== undefined && typeof claims.player_tag !== "string") throw new PassError("malformed");
  if (claims.friend_tag_ids !== undefined && !isStringList(claims.friend_tag_ids)) throw new PassError("malformed");
  if (claims.block_tag_ids !== undefined && !isStringList(claims.block_tag_ids)) throw new PassError("malformed");
  if (claims.owned_item_names !== undefined && !isStringList(claims.owned_item_names)) throw new PassError("malformed");
  return claims;
}

/**
 * What a receipt proves: that this player bought or was granted this item in this game. Signed with the pass
 * key, so it's checked against the same public keys (/.well-known/jwks.json). It never expires: a refund is
 * told apart (the next pass's owned_item_names, the purchase's status through the developer API).
 */
export interface ReceiptClaims {
  /** The player's ID. */
  sub: string;
  /** The game's slug: a receipt is for the game it was issued for. */
  aud: string;
  iss: string;
  kind: "receipt";
  /** The purchase's ID (purchase_…): one receipt per purchase, so keep it to deliver a consumable once. */
  jti: string;
  item_name: string;
  item_kind: "permanent" | "consumable";
  /** How many of the item: 1 for a permanent item. */
  item_count: number;
  /** sale: paid through the buy sheet. grant: the developer gave it, with no money. */
  purchase_source: "sale" | "grant";
  /** The price paid, in the currency's minor units; null for a grant. */
  price_minor_units: number | null;
  currency_code: string | null;
  /** The game's own ID for the player's account in its own system, as the game gave it; null when it gave none. */
  game_account_id: string | null;
  iat: number;
}

/** Check a receipt. Throws PassError if it's forged, for another game, or a pass (wrong_kind). */
export async function verifyReceipt(token: string, keys: PublicKey[], expect: { game: string; issuer: string }): Promise<ReceiptClaims> {
  const claims = (await signedClaims(token, keys)) as unknown as ReceiptClaims;
  if (claims.kind !== "receipt") throw new PassError("wrong_kind");
  if (claims.iss !== expect.issuer) throw new PassError("wrong_issuer");
  if (claims.aud !== expect.game) throw new PassError("wrong_game");
  const isNullOr = (given: unknown, type: string) => given === null || typeof given === type;
  if (
    typeof claims.sub !== "string" ||
    typeof claims.jti !== "string" ||
    typeof claims.item_name !== "string" ||
    (claims.item_kind !== "permanent" && claims.item_kind !== "consumable") ||
    !Number.isInteger(claims.item_count) ||
    (claims.purchase_source !== "sale" && claims.purchase_source !== "grant") ||
    !isNullOr(claims.price_minor_units, "number") ||
    !isNullOr(claims.currency_code, "string") ||
    !isNullOr(claims.game_account_id, "string") ||
    typeof claims.iat !== "number"
  ) {
    throw new PassError("malformed");
  }
  return claims;
}
