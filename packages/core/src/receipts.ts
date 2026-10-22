import type { Purchase } from "./items.ts";

/**
 * A purchase's receipt: a JWT signed with the player pass key (in the rooms Worker, ReceiptSigningService),
 * so every server that checks passes checks receipts with the same public keys (verifyReceipt in
 * @zaisma/game-server). kind "receipt" keeps it from standing in for a pass, and verifyPass refuses it. It
 * never expires: it's a record of what was bought or granted, and a refund is told apart (the pass's
 * owned_item_names, the purchase's status).
 */
/** A receipt's claims but its issuer, which the rooms Worker that signs it adds (its ISSUER, the passes' too). */
export interface ReceiptClaimsInput {
  /** The game's slug. */
  aud: string;
  /** The player's ID. */
  sub: string;
  kind: "receipt";
  /** The purchase's ID. */
  jti: string;
  item_name: string;
  item_kind: Purchase["item_kind"];
  item_count: number;
  purchase_source: Purchase["purchase_source"];
  /** null for a grant. */
  price_minor_units: number | null;
  currency_code: string | null;
  /** The game's own ID for the player's account in its own system, as the game gave it; null when it gave none. */
  game_account_id: string | null;
  iat: number;
}

/**
 * The claims a purchase's receipt carries. iat is when it was bought or granted, so the same purchase always
 * signs to the same receipt (Ed25519 signatures are deterministic).
 */
export function receiptClaimsFor(purchase: Purchase, game: { slug: string }): ReceiptClaimsInput {
  return {
    aud: game.slug,
    sub: purchase.player_id,
    kind: "receipt",
    jti: purchase.id,
    item_name: purchase.item_name,
    item_kind: purchase.item_kind,
    item_count: purchase.item_count,
    purchase_source: purchase.purchase_source,
    price_minor_units: purchase.price_minor_units,
    currency_code: purchase.currency_code,
    game_account_id: purchase.game_account_id,
    iat: Math.floor((purchase.purchased_at_ms ?? purchase.created_at_ms) / 1000),
  };
}
