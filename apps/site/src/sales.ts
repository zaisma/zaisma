import { gameById, newId, purchaseById, purchaseSettingsOf, priceText, takeBack, type GameItem, type Purchase } from "@zaisma/core";
import { deliverEmail, purchaseReceiptEmail } from "./email-codes.ts";
import { recordTaxTransaction, refundOnAccount, type StripeObject } from "./stripe.ts";
import { withReceipts } from "./items-api.ts";
import { tellPurchase } from "./webhooks.ts";
import type { Env } from "./env.ts";

/**
 * Sales through the buy sheet (docs/DECISIONS.md, "One Zaisma buy sheet"): a pending purchase made when the sheet
 * opens, completed once Stripe says the money was taken, failed when it wasn't, and taken back on a full refund or a
 * lost dispute. The sheet's poll (buy.ts) is the fast path and Stripe's events (stripe-connect-events.ts) the
 * backstop; both come here, and each step happens once whoever gets there first.
 *
 * A sale is always found by its PaymentIntent on the developer's connected account, never by the metadata on it:
 * a developer can write any metadata on their own account, but can't move a payment to another account.
 */

/** A sale as stored, with how it's being paid. */
export interface Sale extends Purchase {
  receipt_email: string | null;
  stripe_account_id: string | null;
  stripe_tax_calculation_id: string | null;
  is_eu_withdrawal_line_shown: number;
}

const SALE_COLUMNS =
  "id, game_id, item_name, item_kind, item_count, player_id, game_account_id, purchase_source, purchase_status, paid_minor_units, currency_code, refunded_minor_units, stripe_payment_intent_id, created_at_ms, purchased_at_ms, refunded_at_ms, receipt_email, stripe_account_id, stripe_tax_calculation_id, is_eu_withdrawal_line_shown";

/** How long a pending sale waits before it fails (the daily step): an abandoned sheet leaves nothing that could complete later. */
export const PENDING_SALE_DURATION_MS = 86_400_000;

export async function saleById(env: Env, purchaseId: string): Promise<Sale | null> {
  return env.DB.prepare(`SELECT ${SALE_COLUMNS} FROM purchases WHERE id = ? AND purchase_source = 'sale'`).bind(purchaseId).first<Sale>();
}

/** The sale a PaymentIntent on a connected account pays for. */
export async function saleOfPayment(env: Env, stripeAccountId: string, paymentIntentId: string): Promise<Sale | null> {
  return env.DB.prepare(`SELECT ${SALE_COLUMNS} FROM purchases WHERE stripe_payment_intent_id = ? AND stripe_account_id = ? AND purchase_source = 'sale'`).bind(paymentIntentId, stripeAccountId).first<Sale>();
}

/** Makes a pending sale at the price the sheet shows, on the developer's account. */
export async function recordPendingSale(
  env: Env,
  sale: { gameId: string; playerId: string; gameItem: Pick<GameItem, "item_name" | "item_kind">; itemCount: number; gameAccountId: string | null; priceMinorUnits: number; currencyCode: string; stripeAccountId: string; isEuWithdrawalLineShown: boolean },
  nowMs = Date.now(),
): Promise<string> {
  const id = newId("purchase");
  await env.DB.prepare(
    "INSERT INTO purchases (id, game_id, item_name, item_kind, item_count, player_id, game_account_id, purchase_source, purchase_status, paid_minor_units, currency_code, stripe_account_id, is_eu_withdrawal_line_shown, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, 'sale', 'pending', ?, ?, ?, ?, ?)",
  )
    .bind(id, sale.gameId, sale.gameItem.item_name, sale.gameItem.item_kind, sale.gameItem.item_kind === "permanent" ? 1 : sale.itemCount, sale.playerId, sale.gameAccountId, sale.priceMinorUnits * (sale.gameItem.item_kind === "permanent" ? 1 : sale.itemCount), sale.currencyCode, sale.stripeAccountId, sale.isEuWithdrawalLineShown ? 1 : 0, nowMs)
    .run();
  return id;
}

/** Ties a pending sale to the PaymentIntent that pays it, with where its receipt goes and its tax calculation. */
export async function notePayment(env: Env, purchaseId: string, payment: { paymentIntentId: string; receiptEmail: string | null; taxCalculationId: string | null }): Promise<void> {
  await env.DB.prepare("UPDATE purchases SET stripe_payment_intent_id = ?, receipt_email = COALESCE(?, receipt_email), stripe_tax_calculation_id = COALESCE(?, stripe_tax_calculation_id) WHERE id = ? AND purchase_status = 'pending'")
    .bind(payment.paymentIntentId, payment.receiptEmail, payment.taxCalculationId, purchaseId)
    .run();
}

/** The email a wallet payment's charge carries (Apple Pay or Google Pay), for its receipt. */
function walletEmailOf(paymentIntent: StripeObject): string | null {
  const charge = paymentIntent.latest_charge as { billing_details?: { email?: string | null } } | string | null;
  return typeof charge === "object" && charge?.billing_details?.email ? charge.billing_details.email : null;
}

/**
 * Stripe took the money: the sale completes, Stripe Tax records its tax, and whoever paid gets one receipt email.
 * A PaymentIntent that doesn't match the sale (another amount or currency) completes nothing. A player who already
 * owns a permanent item (two sheets paid at once) gets the second payment back at once, since they can't own it twice.
 * Answers the sale as it now is.
 */
export async function completePurchase(env: Env, sale: Sale, paymentIntent: StripeObject, nowMs = Date.now()): Promise<Sale> {
  if (sale.purchase_status !== "pending" && sale.purchase_status !== "failed") return sale;
  if (paymentIntent.status !== "succeeded" || Number(paymentIntent.amount) !== sale.paid_minor_units || String(paymentIntent.currency).toLowerCase() !== sale.currency_code) {
    console.error(`PaymentIntent ${paymentIntent.id} doesn't pay for ${sale.id} as it was priced.`);
    return sale;
  }
  const receiptEmail = sale.receipt_email ?? walletEmailOf(paymentIntent);
  try {
    const changed = await env.DB.prepare(
      "UPDATE purchases SET purchase_status = 'completed', stripe_payment_intent_id = ?, purchased_at_ms = ?, receipt_email = ? WHERE id = ? AND purchase_status IN ('pending', 'failed')",
    )
      .bind(paymentIntent.id, nowMs, receiptEmail, sale.id)
      .run();
    if (!changed.meta.changes) return (await saleById(env, sale.id)) ?? sale;
  } catch (error) {
    if (!String(error).includes("UNIQUE")) throw error;
    return refundDuplicate(env, sale, paymentIntent.id, nowMs);
  }
  const completed: Sale = { ...sale, purchase_status: "completed", stripe_payment_intent_id: paymentIntent.id, purchased_at_ms: nowMs, receipt_email: receiptEmail };
  if (sale.stripe_tax_calculation_id) {
    await recordTaxTransaction(env, sale.stripe_account_id!, sale.stripe_tax_calculation_id, sale.id).catch((error) => console.error(`Stripe Tax didn't record ${sale.id}:`, error));
  }
  if (receiptEmail) await sendReceipt(env, completed, receiptEmail);
  await tellSale(env, completed, "purchase_completed");
  return completed;
}

/** A second payment for a permanent item the player already owns goes straight back. */
async function refundDuplicate(env: Env, sale: Sale, paymentIntentId: string, nowMs: number): Promise<Sale> {
  await refundOnAccount(env, sale.stripe_account_id!, paymentIntentId, sale.paid_minor_units!, `duplicate:${sale.id}`);
  await env.DB.prepare("UPDATE purchases SET purchase_status = 'refunded', stripe_payment_intent_id = ?, refunded_minor_units = paid_minor_units, refunded_at_ms = ? WHERE id = ?").bind(paymentIntentId, nowMs, sale.id).run();
  return (await saleById(env, sale.id))!;
}

async function sendReceipt(env: Env, sale: Sale, receiptEmail: string): Promise<void> {
  const game = await gameById(env.DB, sale.game_id);
  if (!game) return;
  const [gameItem, seller] = await Promise.all([
    env.DB.prepare("SELECT title FROM game_items WHERE game_id = ? AND item_name = ?").bind(sale.game_id, sale.item_name).first<{ title: string }>(),
    env.DB.prepare("SELECT stripe_business_name, stripe_support_email FROM owners WHERE stripe_account_id = ?").bind(sale.stripe_account_id).first<{ stripe_business_name: string | null; stripe_support_email: string | null }>(),
  ]);
  await deliverEmail(
    env,
    receiptEmail,
    purchaseReceiptEmail(env, {
      purchaseId: sale.id,
      gameTitle: game.title,
      itemTitle: gameItem?.title ?? sale.item_name,
      itemCount: sale.item_count,
      paidText: priceText(sale.currency_code!, sale.paid_minor_units!),
      purchasedAtMs: sale.purchased_at_ms!,
      sellerName: seller?.stripe_business_name ?? null,
      sellerSupportEmail: seller?.stripe_support_email ?? null,
      game: purchaseSettingsOf(game),
      isEuWithdrawalLineShown: sale.is_eu_withdrawal_line_shown === 1,
    }),
  );
}

/** Stripe couldn't take the money (declined, or abandoned): the sale fails. A failed sale can still complete if Stripe later says it was paid. */
export async function failPurchase(env: Env, purchaseId: string): Promise<void> {
  await env.DB.prepare("UPDATE purchases SET purchase_status = 'failed' WHERE id = ? AND purchase_status = 'pending'").bind(purchaseId).run();
}

/**
 * Stripe refunded some or all of a sale (charge.refunded, with the charge's whole refunded amount so far). A full
 * refund takes the item back; a partial one is the developer's goodwill and leaves it.
 */
export async function noteRefund(env: Env, sale: Sale, refundedMinorUnits: number, nowMs = Date.now()): Promise<void> {
  if (sale.purchase_status !== "completed") return;
  if (refundedMinorUnits >= sale.paid_minor_units!) {
    if (await takeBack(env.DB, sale.id, "refunded", nowMs)) await tellSale(env, sale, "purchase_refunded");
    return;
  }
  await env.DB.prepare("UPDATE purchases SET refunded_minor_units = MAX(refunded_minor_units, ?), refunded_at_ms = ? WHERE id = ? AND purchase_status = 'completed'").bind(refundedMinorUnits, nowMs, sale.id).run();
}

/** A dispute the developer lost takes the item back. An open or won one changes nothing. */
export async function noteLostDispute(env: Env, sale: Sale, nowMs = Date.now()): Promise<void> {
  if (await takeBack(env.DB, sale.id, "charged_back", nowMs)) await tellSale(env, sale, "purchase_refunded");
}

/** The game's webhooks hear a sale completed or was taken back, with the purchase as the API answers it. Never fails the sale. */
async function tellSale(env: Env, sale: Sale, kind: "purchase_completed" | "purchase_refunded"): Promise<void> {
  try {
    const game = await gameById(env.DB, sale.game_id);
    const purchase = game && (await purchaseById(env.DB, game.id, sale.id));
    if (!game || !purchase) return;
    const [answered] = await withReceipts(env, game, [purchase]);
    await tellPurchase(env, game, answered!, kind);
  } catch (error) {
    console.error(`The webhooks didn't hear ${kind} for ${sale.id}:`, error);
  }
}

/** The pending sales older than a day, to fail (the daily step in index.ts). */
export async function staleSales(env: Env, nowMs = Date.now()): Promise<Sale[]> {
  const { results } = await env.DB.prepare(`SELECT ${SALE_COLUMNS} FROM purchases WHERE purchase_status = 'pending' AND created_at_ms < ? LIMIT 500`).bind(nowMs - PENDING_SALE_DURATION_MS).all<Sale>();
  return results;
}
