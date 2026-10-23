import { addCreditEntry, creditOf } from "@zaisma/core";
import { addTopUp, turnOffAutomaticTopUp } from "./hosting-job.ts";
import { isSignedByStripe, stripeCall } from "./stripe.ts";
import type { Env } from "./env.ts";

/** Stripe's events are small; anything bigger isn't one. */
const MAXIMUM_EVENT_SIZE_BYTES = 256 * 1024;

type StripeEvent = { id: string; type: string; data: { object: Record<string, unknown> & { id: string } } };

/**
 * POST /stripe/events: Stripe tells Zaisma a top-up was paid, an automatic one failed, or a payment was refunded.
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
    await addTopUp(env, { ownerId, amountCents: Number(object.amount_subtotal ?? object.amount_total), paymentIntentId: object.payment_intent, isAutomatic: false });
    await savePaymentMethod(env, ownerId, object.payment_intent);
  }
  // A Checkout payment's own payment_intent.succeeded is the checkout's above (the same ID counts once either way).
  if (event.type === "payment_intent.succeeded" && ownerId && metadata.top_up_kind === "automatic") {
    await addTopUp(env, { ownerId, amountCents: Number(object.amount_received ?? object.amount), paymentIntentId: object.id, isAutomatic: true });
  }
  if (event.type === "payment_intent.payment_failed" && ownerId && metadata.top_up_kind === "automatic") {
    const lastError = object.last_payment_error as { message?: string } | null;
    await turnOffAutomaticTopUp(env, ownerId, lastError?.message ?? null);
  }
  if (event.type === "charge.refunded" && typeof object.payment_intent === "string") await addRefund(env, object.payment_intent, Number(object.amount_refunded));
  return Response.json({ received: true });
}

/** The card a Checkout top-up was paid with, saved for automatic top-ups. */
async function savePaymentMethod(env: Env, ownerId: string, paymentIntentId: string): Promise<void> {
  try {
    const paymentIntent = await stripeCall(env, "GET", `/payment_intents/${encodeURIComponent(paymentIntentId)}`);
    if (typeof paymentIntent.payment_method === "string") await env.DB.prepare("UPDATE owners SET stripe_payment_method_id = ? WHERE id = ?").bind(paymentIntent.payment_method, ownerId).run();
  } catch (error) {
    console.error("Couldn't save the top-up's card:", error);
  }
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
