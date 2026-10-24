import { RECEIPT_TOKEN_TYPE, type ReceiptClaims, type SigningKey } from "@zaisma/game-server";
import type { Purchase } from "./items.ts";

/**
 * A purchase's receipt: a JWT signed in the rooms Worker (ReceiptSigningService) with the receipt key, which
 * /.well-known/receipt-jwks.json publishes for good, apart from the pass key, so a receipt never expires
 * (verifyReceipt in @zaisma/game-server).
 * Its own issuer and typ keep it from standing in for a pass. It carries the purchase's status, so one fetched
 * after a refund says so; only its purchase_id is stable, never its bytes.
 */
/** A receipt's claims but its issuer and signing time, which the rooms Worker that signs it adds. */
export type ReceiptClaimsInput = Omit<ReceiptClaims, "iss" | "iat">;

/** The claims a purchase's receipt carries. */
export function receiptClaimsFor(purchase: Purchase, game: { slug: string }): ReceiptClaimsInput {
  const purchasedAtMs = purchase.purchased_at_ms ?? purchase.created_at_ms;
  return {
    aud: game.slug,
    sub: purchase.player_id,
    jti: purchase.id,
    receipt_version_number: 1,
    purchase_id: purchase.id,
    purchased_at: new Date(purchasedAtMs).toISOString(),
    purchase_status: purchase.purchase_status,
    item_name: purchase.item_name,
    item_kind: purchase.item_kind,
    item_count: purchase.item_count,
    purchase_source: purchase.purchase_source,
    paid_minor_units: purchase.paid_minor_units,
    currency_code: purchase.currency_code,
    game_account_id: purchase.game_account_id,
  };
}

const encoder = new TextEncoder();
const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A receipt: typ receipt+jwt, signed with the receipt key (in the rooms Worker alone), so no JWT library takes it for a pass. */
export async function signReceipt(signing: SigningKey, claims: ReceiptClaims): Promise<string> {
  const header = toBase64Url(encoder.encode(JSON.stringify({ alg: "EdDSA", typ: RECEIPT_TOKEN_TYPE, kid: signing.publicKey.kid })));
  const body = toBase64Url(encoder.encode(JSON.stringify(claims)));
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, signing.key, encoder.encode(`${header}.${body}`)));
  return `${header}.${body}.${toBase64Url(signature)}`;
}
