import { loadSigningKey, type SigningKey } from "@zaisma/game-server";

/** The pass signing key (PASS_SIGNING_KEY), loaded once per secret: it signs passes and receipts. */
let signing: { secret: string; key: Promise<SigningKey> } | null = null;
export function signingKey(env: { PASS_SIGNING_KEY: string }): Promise<SigningKey> {
  if (signing?.secret !== env.PASS_SIGNING_KEY) signing = { secret: env.PASS_SIGNING_KEY, key: loadSigningKey(env.PASS_SIGNING_KEY) };
  return signing.key;
}
