// Prints a new signing key for Sign in with Zaisma (apps/site/src/sign-in.ts): a private RSA JWK for
// RS256, the algorithm every OpenID Connect library takes. Put it straight into the site's secret,
// without it ever being shown:
//
//   node scripts/sign-in-key.mjs | npx wrangler secret put SIGN_IN_SIGNING_KEY --config apps/site/wrangler.jsonc
//
// A new key signs out nothing, but sites holding ID tokens signed by the old one must fetch the new
// public key (/.well-known/jwks.json), which libraries do by themselves when the key ID changes.

const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const { kty, n, e, d, p, q, dp, dq, qi } = await crypto.subtle.exportKey("jwk", pair.privateKey);
process.stdout.write(JSON.stringify({ kty, n, e, d, p, q, dp, dq, qi }));
