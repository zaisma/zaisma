import { addCreditEntry, creditOf } from "@zaisma/core";
import { addTopUp } from "./hosting-job.ts";
import { recordPaidCard } from "./bans.ts";
import { isSignedByStripe } from "./stripe.ts";
import type { Env } from "./env.ts";

/** Stripe's events are small; anything bigger isn't one. */
const MAXIMUM_EVENT_SIZE_BYTES = 256 * 1024;

export type StripeEvent = { id: string; type: string; data: { object: Record<string, unknown> & { id: string } } };

/**
 * POST /stripe/events: Stripe tells Zaisma a top-up was paid, a payment was refunded, or a Zaisma Pro subscription started, renewed, changed or ended.
 * The signature is checked over the raw body before anything is read. Every handler is idempotent on the Stripe
 * object's ID, since Stripe sends an event again until it's answered 2xx. Events of other kinds are answered and
 * ignored.
 */
export async function handleStripeEvents(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
  if (Number(request.headers.get("content-length") ?? 0) > MAXIMUM_EVENT_SIZE_BYTES) return new Response("Payload too large", { status: 413 });
  const body = await request.text();
  if (body.length > MAXIMUM_EVENT_SIZE_BYTES) return new Response("Payload too large", { status: 413 });
  if (!(await isSignedByStripe(body, request.headers.get("stripe-signature"), env.STRIPE_EVENTS_SECRET))) return new Response("Bad signature", { status: 400 });
  let event: StripeEvent;
  try {
    event = JSON.parse(body) as StripeEvent;
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const object = event.data?.object;
  if (!object || typeof object.id !== "string") return Response.json({ received: true });
  const metadata = (object.metadata ?? {}) as Record<string, string>;
  const ownerId = metadata.owner_id;

  if (event.type === "checkout.session.completed" && ownerId && object.mode === "payment" && object.payment_status === "paid" && typeof object.payment_intent === "string") {
    await addTopUp(env, { ownerId, amountCents: Number(object.amount_subtotal ?? object.amount_total), paymentIntentId: object.payment_intent });
    // The card that paid, for bans (bans.ts): never in the payment's way.
    await recordPaidCard(env, ownerId, object.payment_intent).catch((error) => console.error(`Keeping the card of ${object.payment_intent} failed:`, error));
  }
  const eventAtMs = Number((event as unknown as Record<string, unknown>)["created"]) * 1000 || Date.now();
  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") await saveProSubscription(env, object, event.type, eventAtMs);
  if (event.type === "customer.subscription.deleted") await endProSubscription(env, object, eventAtMs);
  if (event.type === "charge.refunded" && typeof object.payment_intent === "string") await addRefund(env, object.payment_intent, Number(object.amount_refunded));
  return Response.json({ received: true });
}

/**
 * What Stripe refunded of a top-up's payment, past what Zaisma already took back (a refund from the API is counted
 * when it's made, so its event adds nothing): a refund entry for the rest, as when Zaisma refunds from Stripe's
 * dashboard. Never takes the balance below zero.
 */
export async function addRefund(env: Env, paymentIntentId: string, refundedTotalCents: number): Promise<void> {
  const topUp = await env.DB.prepare("SELECT id, owner_id, refunded_cents FROM credit_entries WHERE stripe_object_id = ? AND entry_kind = 'top_up'").bind(paymentIntentId).first<{ id: string; owner_id: string; refunded_cents: number }>();
  if (!topUp || !(refundedTotalCents > topUp.refunded_cents)) return;
  const credit = await creditOf(env.DB, topUp.owner_id);
  const newCents = refundedTotalCents - topUp.refunded_cents;
  const takenCents = Math.min(newCents, Math.max(0, credit.balanceCents));
  const marked = await env.DB.prepare("UPDATE credit_entries SET refunded_cents = ? WHERE id = ? AND refunded_cents = ?").bind(refundedTotalCents, topUp.id, topUp.refunded_cents).run();
  if (!marked.meta.changes || takenCents <= 0) return;
  await addCreditEntry(env.DB, { ownerId: topUp.owner_id, entryKind: "refund", amountCents: -takenCents, stripeObjectId: `${paymentIntentId}:refunded:${refundedTotalCents}` });
}

/** Statuses in which Stripe still means to be paid: past_due keeps Pro while Stripe retries the renewal. */
const PAYING_STATUSES = ["active", "trialing", "past_due"];

/** Whose Pro a subscription is: the owner in its metadata, else the owner of its Stripe customer. */
async function proOwnerOf(env: Env, subscription: Record<string, unknown>): Promise<string | null> {
  const metadataOwnerId = ((subscription.metadata ?? {}) as Record<string, string>).owner_id;
  if (metadataOwnerId) return metadataOwnerId;
  if (typeof subscription.customer !== "string") return null;
  const owner = await env.DB.prepare("SELECT id FROM owners WHERE stripe_customer_id = ?").bind(subscription.customer).first<{ id: string }>();
  return owner?.id ?? null;
}

/** The end of the period the subscription is paid for, in ms: on the subscription, or on its item in newer API versions. */
function periodEndMsOf(subscription: Record<string, unknown>): number | null {
  const firstItem = ((subscription.items as Record<string, unknown> | undefined)?.["data"] as Record<string, unknown>[] | undefined)?.[0];
  const endSec = Number(subscription["current_period_end"] ?? firstItem?.["current_period_end"]);
  return Number.isFinite(endSec) && endSec > 0 ? endSec * 1000 : null;
}

/**
 * A subscription that started or changed: Pro until the end of the period Stripe says is paid, never by Zaisma's own
 * clock, with whether it ends there. Sending the same event again sets the same values. One that Stripe has ended
 * (canceled, unpaid) ends Pro as a deleted one does.
 */
async function saveProSubscription(env: Env, subscription: Record<string, unknown> & { id: string }, eventType: string, eventAtMs: number): Promise<void> {
  const ownerId = await proOwnerOf(env, subscription);
  if (!ownerId) return;
  const status = String(subscription.status ?? "");
  if (["canceled", "unpaid", "incomplete_expired"].includes(status)) return endProSubscription(env, subscription, eventAtMs);
  if (!PAYING_STATUSES.includes(status)) return;
  const periodEndMs = periodEndMsOf(subscription);
  if (periodEndMs === null) {
    console.error(`${eventType} for ${subscription.id} has no period end.`);
    return;
  }
  const isCancelled = subscription.cancel_at_period_end === true || (subscription.cancel_at !== null && subscription.cancel_at !== undefined);
  // Stripe doesn't keep events in order: an event older than the last one applied is ignored, and so is a second
  // subscription while the first still runs (the first is the one cancel_pro reaches).
  const saved = await env.DB.prepare(
    "UPDATE owners SET stripe_subscription_id = ?, pro_until_ms = ?, is_pro_cancelled = ?, pro_event_at_ms = ? WHERE id = ? AND (pro_event_at_ms IS NULL OR pro_event_at_ms <= ?) AND (stripe_subscription_id IS NULL OR stripe_subscription_id = ? OR pro_until_ms <= ?)",
  )
    .bind(subscription.id, periodEndMs, isCancelled ? 1 : 0, eventAtMs, ownerId, eventAtMs, subscription.id, Date.now())
    .run();
  if (!saved.meta.changes) console.error(`${eventType} for ${subscription.id} was not applied: an older event, or the owner has another subscription running.`);
  // The card that pays for Pro, for bans (bans.ts): Checkout sets it as the subscription's default.
  if (status === "active" && typeof subscription.default_payment_method === "string") {
    await recordPaidCard(env, ownerId, subscription.default_payment_method).catch((error) => console.error(`Keeping the card of ${subscription.id} failed:`, error));
  }
}

/** A subscription that ended: Pro ends now (a period that already ended stays ended), and the subscription is let go. */
async function endProSubscription(env: Env, subscription: Record<string, unknown> & { id: string }, eventAtMs: number): Promise<void> {
  const ownerId = await proOwnerOf(env, subscription);
  if (!ownerId) return;
  await env.DB.prepare("UPDATE owners SET pro_until_ms = MIN(COALESCE(pro_until_ms, ?), ?), is_pro_cancelled = 0, stripe_subscription_id = NULL, pro_event_at_ms = ? WHERE id = ? AND stripe_subscription_id = ? AND (pro_event_at_ms IS NULL OR pro_event_at_ms <= ?)")
    .bind(Date.now(), Date.now(), eventAtMs, ownerId, subscription.id, eventAtMs)
    .run();
}
