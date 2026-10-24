import { ApiError } from "@zaisma/core";
import type { Env } from "./env.ts";

/**
 * Zaisma's own Stripe account, for hosting credit (docs/DECISIONS.md, "Hosting is priced with a margin, with a free
 * tier, and prepaid above it"): Stripe sells credit as the merchant of record (Managed Payments), so it charges and
 * files sales tax and VAT. Called with fetch and form encoding, without Stripe's SDK: the calls are few. Zaisma Pro
 * reuses the customer and the calls (a subscription, apart from credit). Never connected to the buy sheet, which is the developer's own Stripe.
 */

const STRIPE_API_URL = "https://api.stripe.com/v1";
/** The API version every call is made with: Managed Payments needs 2025-03-31.basil or later. */
const STRIPE_VERSION = "2026-04-22.dahlia";
/** Platform as a service, business use: eligible for Managed Payments. */
const CREDIT_TAX_CODE = "txcd_10102000";
/** How old a signed event may be before it's refused, so a captured one can't be sent again later. */
const SIGNATURE_TOLERANCE_SEC = 5 * 60;

export type StripeObject = Record<string, unknown> & { id: string };

/** Stripe's form encoding: nested objects and lists as key[sub][0]=value. */
export function stripeForm(form: Record<string, unknown>, prefix = ""): URLSearchParams {
  const encoded = new URLSearchParams();
  const add = (key: string, fieldValue: unknown) => {
    if (fieldValue === undefined || fieldValue === null) return;
    if (Array.isArray(fieldValue)) fieldValue.forEach((each, i) => add(`${key}[${i}]`, each));
    else if (typeof fieldValue === "object") for (const [sub, each] of Object.entries(fieldValue as Record<string, unknown>)) add(`${key}[${sub}]`, each);
    else encoded.append(key, String(fieldValue));
  };
  for (const [key, fieldValue] of Object.entries(form)) add(prefix ? `${prefix}[${key}]` : key, fieldValue);
  return encoded;
}

function unavailable(detail: string): ApiError {
  return new ApiError("stripe_unavailable", { message: `Stripe didn't take it: ${detail}`, fix: "Try again in a minute; if it keeps happening, tell Zaisma with message_zaisma." });
}

/** One call to Stripe's API. idempotencyKey makes a retry the same call, never a second charge. */
export async function stripeCall(env: Env, method: "GET" | "POST", path: string, form: Record<string, unknown> = {}, idempotencyKey?: string): Promise<StripeObject> {
  if (!env.STRIPE_SECRET_KEY) throw unavailable("this Zaisma has no Stripe account set up.");
  const body = method === "POST" ? stripeForm(form).toString() : undefined;
  const query = method === "GET" && Object.keys(form).length ? `?${stripeForm(form)}` : "";
  let response: Response;
  try {
    response = await fetch(`${STRIPE_API_URL}${path}${query}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Stripe-Version": STRIPE_VERSION,
        ...(body !== undefined ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body,
    });
  } catch (error) {
    console.error("Stripe didn't answer:", error);
    throw unavailable("it didn't answer.");
  }
  const answer = (await response.json().catch(() => ({}))) as StripeObject & { error?: { message?: string; code?: string; decline_code?: string } };
  if (!response.ok) {
    console.error(`Stripe refused ${method} ${path}:`, answer.error);
    throw new StripeRefusal(answer.error?.message ?? `HTTP ${response.status}`, answer.error?.decline_code ?? answer.error?.code ?? null);
  }
  return answer;
}

/** Stripe said no: a declined card, or a call it won't take. message is Stripe's own words. */
export class StripeRefusal extends ApiError {
  constructor(
    readonly stripeMessage: string,
    readonly stripeCode: string | null,
  ) {
    super("stripe_unavailable", { message: `Stripe didn't take it: ${stripeMessage}`, fix: "Try again in a minute; if it keeps happening, tell Zaisma with message_zaisma." });
  }
}

/** The owner's Stripe customer, made the first time: one per owner, for credit and later Pro. */
export async function customerFor(env: Env, ownerId: string): Promise<string> {
  const saved = await env.DB.prepare("SELECT stripe_customer_id FROM owners WHERE id = ?").bind(ownerId).first<{ stripe_customer_id: string | null }>();
  if (saved?.stripe_customer_id) return saved.stripe_customer_id;
  const customer = await stripeCall(env, "POST", "/customers", { metadata: { owner_id: ownerId } }, `customer:${ownerId}`);
  // Two calls at once make one customer (the idempotency key), and the first to save it wins.
  await env.DB.prepare("UPDATE owners SET stripe_customer_id = COALESCE(stripe_customer_id, ?) WHERE id = ?").bind(customer.id, ownerId).run();
  return (await env.DB.prepare("SELECT stripe_customer_id FROM owners WHERE id = ?").bind(ownerId).first<{ stripe_customer_id: string }>())!.stripe_customer_id;
}

/**
 * Stripe's page for buying credit: one line, "Zaisma hosting credit", for amountCents, with Managed Payments on and
 * the card saved for automatic top-ups. Back to the credit settings either way.
 */
export async function topUpCheckout(env: Env, ownerId: string, amountCents: number): Promise<{ checkoutUrl: string; expiresAtMs: number }> {
  const customer = await customerFor(env, ownerId);
  const backUrl = `${env.SITE_ORIGIN}/developer/settings#credit`;
  const session = await stripeCall(env, "POST", "/checkout/sessions", {
    mode: "payment",
    customer,
    managed_payments: { enabled: true },
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: amountCents, product_data: { name: "Zaisma hosting credit", tax_code: CREDIT_TAX_CODE } } }],
    payment_intent_data: { setup_future_usage: "off_session", metadata: { owner_id: ownerId, top_up_kind: "checkout" } },
    metadata: { owner_id: ownerId },
    success_url: backUrl,
    cancel_url: backUrl,
  });
  return { checkoutUrl: String(session.url), expiresAtMs: Number(session.expires_at) * 1000 };
}

/**
 * Stripe's page for starting Zaisma Pro: a subscription to the monthly price (STRIPE_PRO_PRICE_ID), with Managed
 * Payments on, on the owner's one customer. The owner is in the subscription's metadata, so every event about it
 * says whose Pro it is. Back to the Pro settings either way.
 */
export async function proCheckout(env: Env, ownerId: string): Promise<{ checkoutUrl: string; expiresAtMs: number }> {
  if (!env.STRIPE_PRO_PRICE_ID) throw unavailable("this Zaisma has no Zaisma Pro price set up.");
  const customer = await customerFor(env, ownerId);
  const backUrl = `${env.SITE_ORIGIN}/developer/settings#pro`;
  const session = await stripeCall(env, "POST", "/checkout/sessions", {
    mode: "subscription",
    customer,
    managed_payments: { enabled: true },
    line_items: [{ price: env.STRIPE_PRO_PRICE_ID, quantity: 1 }],
    subscription_data: { metadata: { owner_id: ownerId } },
    metadata: { owner_id: ownerId },
    success_url: backUrl,
    cancel_url: backUrl,
  });
  return { checkoutUrl: String(session.url), expiresAtMs: Number(session.expires_at) * 1000 };
}

/** Cancels Zaisma Pro at the end of the paid month (isCancelled), or takes the cancelling back. */
export async function setProCancelled(env: Env, subscriptionId: string, isCancelled: boolean): Promise<StripeObject> {
  return stripeCall(env, "POST", `/subscriptions/${encodeURIComponent(subscriptionId)}`, { cancel_at_period_end: isCancelled });
}

/** Charges the owner's saved card, off-session, for an automatic top-up. The key makes a retry the same charge. */
export async function chargeSavedCard(env: Env, charge: { ownerId: string; customerId: string; paymentMethodId: string; amountCents: number; idempotencyKey: string }): Promise<StripeObject> {
  return stripeCall(
    env,
    "POST",
    "/payment_intents",
    {
      amount: charge.amountCents,
      currency: "usd",
      customer: charge.customerId,
      payment_method: charge.paymentMethodId,
      off_session: true,
      confirm: true,
      description: "Zaisma hosting credit (automatic top-up)",
      metadata: { owner_id: charge.ownerId, top_up_kind: "automatic" },
    },
    charge.idempotencyKey,
  );
}

/** Gives amountCents of a payment back to the card it came from. */
export async function refundCharge(env: Env, paymentIntentId: string, amountCents: number, idempotencyKey: string): Promise<StripeObject> {
  return stripeCall(env, "POST", "/refunds", { payment_intent: paymentIntentId, amount: amountCents, metadata: { reason_text: "Unused Zaisma hosting credit" } }, idempotencyKey);
}

/**
 * Whether an event came from Stripe: its Stripe-Signature header (t=<seconds>,v1=<hex>) is an HMAC-SHA256 of
 * "<t>.<body>" with the endpoint's signing secret, made within SIGNATURE_TOLERANCE_SEC.
 */
export async function isSignedByStripe(body: string, header: string | null, secret: string | undefined, nowMs = Date.now()): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = header.split(",").map((part) => part.trim().split("="));
  const signedAtSec = Number(parts.find(([name]) => name === "t")?.[1]);
  const signatures = parts.filter(([name]) => name === "v1").map(([, signature]) => signature ?? "");
  if (!Number.isFinite(signedAtSec) || !signatures.length || Math.abs(nowMs / 1000 - signedAtSec) > SIGNATURE_TOLERANCE_SEC) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${signedAtSec}.${body}`)));
  return signatures.some((signature) => isSameBytes(expected, hexBytes(signature)));
}

function hexBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]*$/i.test(hex) || hex.length % 2) return new Uint8Array();
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));
}

/** Compared in the same time whatever they hold, so timing says nothing about the secret. */
function isSameBytes(first: Uint8Array, second: Uint8Array): boolean {
  if (first.length !== second.length) return false;
  let differentBitsNumber = 0;
  for (let i = 0; i < first.length; i++) differentBitsNumber |= first[i]! ^ second[i]!;
  return differentBitsNumber === 0;
}
