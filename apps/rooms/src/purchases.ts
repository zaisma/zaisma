import { finishHandling, finishRefundHandling, iso, receiptClaimsFor, releaseHandling, releaseRefundHandling, signReceipt, startHandling, startRefundHandling, unhandledFor, type PurchaseDelivery, type Purchase as StoredPurchase } from "@zaisma/core";
import type { Purchase, PurchaseHandling } from "@zaisma/game-server";
import type { Env } from "./index.ts";
import { receiptIssuerOf } from "./receipts.ts";
import { receiptSigningKey } from "./signing.ts";

/**
 * Purchases on their way to games (packages/core/src/items.ts, "Getting purchases to games exactly once"),
 * from Zaisma rooms: the room's game server (onPurchase, onRefund) and the SDK (Zaisma.items.on("purchase")),
 * both straight from D1, each only for the game's own purchases and the player the pass or room says.
 */

type ReceiptEnv = Pick<Env, "ISSUER" | "RECEIPT_SIGNING_KEY">;

/** Purchases as games get them, each with its receipt, signed here in one go. */
export async function purchasesForGame(env: ReceiptEnv, game: { slug: string }, stored: StoredPurchase[]): Promise<Purchase[]> {
  if (!stored.length) return [];
  const signing = await receiptSigningKey(env);
  const issuedAtSec = Math.floor(Date.now() / 1000);
  return Promise.all(
    stored.map(async (purchase) => ({
      id: purchase.id,
      itemName: purchase.item_name,
      itemKind: purchase.item_kind,
      itemCount: purchase.item_count,
      purchaseSource: purchase.purchase_source,
      purchaseStatus: purchase.purchase_status as Purchase["purchaseStatus"],
      gameAccountId: purchase.game_account_id,
      paidMinorUnits: purchase.paid_minor_units,
      currencyCode: purchase.currency_code,
      purchasedAt: purchase.purchased_at_ms === null ? null : iso(purchase.purchased_at_ms),
      refundedAt: purchase.refunded_at_ms === null ? null : iso(purchase.refunded_at_ms),
      receipt: await signReceipt(signing, { ...receiptClaimsFor(purchase, game), iss: receiptIssuerOf(env), iat: issuedAtSec }),
    })),
  );
}

/** Where a game's purchases go, read fresh: a game that just switched to game_server hands the next join's over. */
export async function purchaseDeliveryOf(database: D1Database, gameId: string): Promise<PurchaseDelivery | null> {
  const game = await database.prepare("SELECT purchase_delivery FROM games WHERE id = ?").bind(gameId).first<{ purchase_delivery: PurchaseDelivery }>();
  return game?.purchase_delivery ?? null;
}

/**
 * A Zaisma room's purchase handling: only with purchase_delivery game_server, so a game whose own page takes
 * its purchases never races its rooms for them. A completed purchase goes to onPurchase, one taken back after
 * it was handed over to onRefund, each on its own lease.
 */
export function roomPurchaseHandling(env: Pick<Env, "DB" | "ISSUER" | "RECEIPT_SIGNING_KEY">, game: { id: string; slug: string }): PurchaseHandling {
  const isRefund = (purchase: Purchase) => purchase.purchaseStatus !== "completed";
  return {
    async unhandledFor(playerId) {
      if ((await purchaseDeliveryOf(env.DB, game.id)) !== "game_server") return [];
      return purchasesForGame(env, game, await unhandledFor(env.DB, game.id, playerId));
    },
    startHandling: (playerId, purchase) => (isRefund(purchase) ? startRefundHandling : startHandling)(env.DB, purchase.id, playerId, game.id, Date.now()),
    async finishHandling(playerId, purchase) {
      await (isRefund(purchase) ? finishRefundHandling : finishHandling)(env.DB, purchase.id, Date.now());
    },
    releaseHandling: (playerId, purchase) => (isRefund(purchase) ? releaseRefundHandling : releaseHandling)(env.DB, purchase.id),
  };
}
