// Prints a new signing key for the rooms Worker: a private Ed25519 JWK, for PASS_SIGNING_KEY (player passes)
// or RECEIPT_SIGNING_KEY (purchases' receipts), the same shape generateSigningKey in @zaisma/game-server makes.
// Put it straight into the secret, without it ever being shown:
//
//   node scripts/rooms-key.mjs | npx wrangler secret put RECEIPT_SIGNING_KEY --config apps/rooms/wrangler.jsonc
//
// A new receipt key leaves the old one's receipts checking only once its public JWK is in
// RETIRED_RECEIPT_PUBLIC_KEYS (apps/rooms/wrangler.jsonc), so add it there in the same change.

const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const { kty, crv, x, d } = await crypto.subtle.exportKey("jwk", pair.privateKey);
process.stdout.write(JSON.stringify({ kty, crv, x, d }));
