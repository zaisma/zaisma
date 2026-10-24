import { WorkerEntrypoint } from "cloudflare:workers";
import { ReceiptError, verifyReceipt, type ReceiptClaims, type ReceiptErrorCode } from "@zaisma/game-server";
import { signReceipt, type ReceiptClaimsInput } from "@zaisma/core";
import type { Env } from "./index.ts";
import { receiptPublicKeys, receiptSigningKey } from "./signing.ts";

/** Receipts' issuer: the passes' issuer with /receipts, so a check for a pass's issuer refuses a receipt. */
export const receiptIssuerOf = (env: { ISSUER: string }) => `${env.ISSUER}/receipts`;

/**
 * Signs purchases' receipts with the receipt key, for the site (apps/site/src/items-api.ts) through a service
 * binding, so the private key stays in this Worker alone. Signs only receipt claims of the version it knows, so
 * nothing that reaches it can make a pass.
 */
export class ReceiptSigningService extends WorkerEntrypoint<Env> {
  /** Signs receipts as this Worker's receipt issuer, now, in the order given: a page of purchases in one call. */
  async signAll(claimsList: ReceiptClaimsInput[]): Promise<{ receipts: string[] } | { error: "not_a_receipt" }> {
    if (!Array.isArray(claimsList) || claimsList.some((claims) => !claims || claims.receipt_version_number !== 1 || "kind" in claims || "exp" in claims)) return { error: "not_a_receipt" };
    const signing = await receiptSigningKey(this.env);
    const nowSec = Math.floor(Date.now() / 1000);
    return { receipts: await Promise.all(claimsList.map((claims) => signReceipt(signing, { ...claims, iss: receiptIssuerOf(this.env), iat: nowSec }))) };
  }
}

/**
 * room.verifyReceipt and server.verifyReceipt for a game server in its sandbox: checks a receipt against every
 * published receipt key, for the game fixed by props it can't see, so a rooms game server never holds keys.
 */
export class ReceiptCheckBinding extends WorkerEntrypoint<Env, { gameId: string }> {
  async verify(receipt: unknown): Promise<{ claims: ReceiptClaims } | { errorCode: ReceiptErrorCode }> {
    const game = await this.env.DB.prepare("SELECT slug FROM games WHERE id = ?").bind(this.ctx.props.gameId).first<{ slug: string }>();
    try {
      if (!game) throw new ReceiptError("wrong_game");
      return { claims: await verifyReceipt(receipt as string, await receiptPublicKeys(this.env), { gameSlug: game.slug, issuerUrl: receiptIssuerOf(this.env) }) };
    } catch (error) {
      if (error instanceof ReceiptError) return { errorCode: error.code };
      throw error;
    }
  }
}
