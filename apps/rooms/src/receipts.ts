import { WorkerEntrypoint } from "cloudflare:workers";
import { signPass, type ReceiptClaims } from "@zaisma/game-server/internal";
import type { Env } from "./index.ts";
import { signingKey } from "./signing.ts";

/**
 * Signs purchases' receipts with the pass key, for the site (apps/site/src/items-api.ts) through a service
 * binding, so the private key stays in this Worker alone and every server that checks passes checks receipts
 * with the same public keys (verifyReceipt). Signs only claims whose kind is receipt, so nothing that reaches
 * it can make a pass.
 */
export class ReceiptSigningService extends WorkerEntrypoint<Env> {
  /** Signs receipts as this Worker's ISSUER, the passes' issuer, in the order given: a page of purchases in one call. */
  async signAll(claimsList: Omit<ReceiptClaims, "iss">[]): Promise<{ receipts: string[] } | { error: "not_a_receipt" }> {
    if (!Array.isArray(claimsList) || claimsList.some((claims) => !claims || claims.kind !== "receipt")) return { error: "not_a_receipt" };
    const signing = await signingKey(this.env);
    return { receipts: await Promise.all(claimsList.map((claims) => signPass(signing, { ...claims, iss: this.env.ISSUER }))) };
  }
}
