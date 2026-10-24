import { detailsOf, isSignedByStripe, paymentIntentOnAccount, type StripeObject } from "./stripe.ts";
import { forgetStripeAccount, saveAccountDetails } from "./stripe-account-api.ts";
import { completePurchase, failPurchase, noteLostDispute, noteRefund, saleOfPayment } from "./sales.ts";
import type { StripeEvent } from "./stripe-events.ts";
import type { Env } from "./env.ts";

/** Stripe's events are small; anything bigger isn't one. */
const MAXIMUM_EVENT_SIZE_BYTES = 256 * 1024;

/** An event on a connected account: Stripe's event, with the account it happened on. */
type ConnectEvent = StripeEvent & { account?: string };

/**
 * POST /stripe/connect-events: Stripe tells Zaisma what happened on developers' connected accounts (the buy sheet's
 * Connect, apart from Zaisma's own account's /stripe/events): a sale was paid or failed, refunded or disputed, an
 * account changed or disconnected Zaisma. The signature is checked over the raw body before anything is read, and
 * every handler is idempotent on the Stripe object, since Stripe sends an event again until it's answered 2xx.
 * A sale is found by its PaymentIntent on the event's own account, never by metadata (sales.ts).
 */
export async function handleStripeConnectEvents(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
  if (Number(request.headers.get("content-length") ?? 0) > MAXIMUM_EVENT_SIZE_BYTES) return new Response("Payload too large", { status: 413 });
  const body = await request.text();
  if (body.length > MAXIMUM_EVENT_SIZE_BYTES) return new Response("Payload too large", { status: 413 });
  if (!(await isSignedByStripe(body, request.headers.get("stripe-signature"), env.STRIPE_CONNECT_EVENTS_SECRET))) return new Response("Bad signature", { status: 400 });
  let event: ConnectEvent;
  try {
    event = JSON.parse(body) as ConnectEvent;
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const object = event.data?.object;
  const stripeAccountId = event.account;
  if (!object || typeof object.id !== "string" || typeof stripeAccountId !== "string") return Response.json({ received: true });

  if (event.type === "payment_intent.succeeded" || event.type === "payment_intent.payment_failed") {
    const sale = await saleOfPayment(env, stripeAccountId, object.id);
    if (sale && event.type === "payment_intent.succeeded") await completePurchase(env, sale, await withCharge(env, stripeAccountId, object as StripeObject));
    if (sale && event.type === "payment_intent.payment_failed") await failPurchase(env, sale.id);
  }
  if ((event.type === "charge.refunded" || event.type === "charge.dispute.closed") && typeof object.payment_intent === "string") {
    const sale = await saleOfPayment(env, stripeAccountId, object.payment_intent);
    if (sale && event.type === "charge.refunded") await noteRefund(env, sale, Number(object.amount_refunded));
    if (sale && event.type === "charge.dispute.closed" && object.status === "lost") await noteLostDispute(env, sale);
  }
  if (event.type === "account.updated") await saveAccountDetails(env, stripeAccountId, detailsOf(object));
  if (event.type === "account.application.deauthorized") await forgetStripeAccount(env, stripeAccountId);
  return Response.json({ received: true });
}

/** The event's PaymentIntent with its charge, whose billing email is a wallet payment's receipt email. */
async function withCharge(env: Env, stripeAccountId: string, paymentIntent: StripeObject): Promise<StripeObject> {
  if (typeof paymentIntent.latest_charge === "object" && paymentIntent.latest_charge) return paymentIntent;
  return paymentIntentOnAccount(env, stripeAccountId, paymentIntent.id).catch(() => paymentIntent);
}
