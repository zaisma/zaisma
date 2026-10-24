import { ApiError } from "@zaisma/core";
import type { Env } from "./env.ts";

/**
 * Zaisma's own Stripe account, for hosting credit (docs/DECISIONS.md, "Hosting is priced with a margin, with a free
 * tier, and prepaid above it"): Stripe sells credit as the merchant of record (Managed Payments), so it charges and
 * files sales tax and VAT. Called with fetch and form encoding, without Stripe's SDK: the calls are few. Zaisma Pro
 * reuses the customer and the calls (a subscription, apart from credit).
 *
 * The same account is the platform of the buy sheet's Connect (docs/DECISIONS.md, "One Zaisma buy sheet"): developers
 * connect their own Stripe (Standard), and every sale is a direct charge on their account with no platform fee, so
 * Zaisma is never the seller. A player's saved card lives on the platform and is cloned onto the developer's account
 * once per purchase, never attached there, so no developer holds a card they can charge again.
 */

const STRIPE_API_ORIGIN = "https://api.stripe.com";
const STRIPE_CONNECT_ORIGIN = "https://connect.stripe.com";
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

/** Whether the site runs as the local preview: on this machine, or opened from a phone on its tailnet (a .ts.net name only its own devices reach). */
export function isLocalPreview(env: Env): boolean {
  const siteHost = new URL(env.SITE_ORIGIN).hostname;
  return siteHost === "localhost" || siteHost === "127.0.0.1" || siteHost.endsWith(".ts.net");
}

/**
 * Where Stripe's API and its Connect sign-in are. Only the local preview points them at a stand-in
 * (STRIPE_API_ORIGIN, scripts/preview/fake-stripe.mjs), and only while the site itself is the local preview, so a
 * deployed Zaisma can never talk to anything but Stripe.
 */
export function stripeOrigins(env: Env): { apiOrigin: string; connectOrigin: string } {
  if (!env.STRIPE_API_ORIGIN) return { apiOrigin: STRIPE_API_ORIGIN, connectOrigin: STRIPE_CONNECT_ORIGIN };
  if (!isLocalPreview(env)) throw unavailable("STRIPE_API_ORIGIN only works in the local preview.");
  return { apiOrigin: env.STRIPE_API_ORIGIN, connectOrigin: env.STRIPE_API_ORIGIN };
}

/**
 * One call to Stripe's API. idempotencyKey makes a retry the same call, never a second charge. stripeAccountId makes
 * it on a developer's connected account (the Stripe-Account header), as every buy sheet sale is.
 */
export async function stripeCall(env: Env, method: "GET" | "POST", path: string, form: Record<string, unknown> = {}, idempotencyKey?: string, stripeAccountId?: string): Promise<StripeObject> {
  if (!env.STRIPE_SECRET_KEY) throw unavailable("this Zaisma has no Stripe account set up.");
  const body = method === "POST" ? stripeForm(form).toString() : undefined;
  const query = method === "GET" && Object.keys(form).length ? `?${stripeForm(form)}` : "";
  let response: Response;
  try {
    response = await fetch(`${stripeOrigins(env).apiOrigin}/v1${path}${query}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Stripe-Version": STRIPE_VERSION,
        ...(body !== undefined ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        ...(stripeAccountId ? { "Stripe-Account": stripeAccountId } : {}),
      },
      body,
    });
  } catch (error) {
    console.error("Stripe didn't answer:", error);
    throw unavailable("it didn't answer.");
  }
  const answer = (await response.json().catch(() => ({}))) as StripeObject & { error?: { message?: string; code?: string; decline_code?: string; type?: string } };
  if (!response.ok) {
    console.error(`Stripe refused ${method} ${path}:`, answer.error);
    throw new StripeRefusal(answer.error?.message ?? `HTTP ${response.status}`, answer.error?.decline_code ?? answer.error?.code ?? null, answer.error?.type ?? null);
  }
  return answer;
}

/** Stripe said no: a declined card, or a call it won't take. message is Stripe's own words; stripeErrorKind is Stripe's error type ("card_error" for a card that was really refused, "api_error" for Stripe's own trouble). */
export class StripeRefusal extends ApiError {
  constructor(
    readonly stripeMessage: string,
    readonly stripeCode: string | null,
    readonly stripeErrorKind: string | null = null,
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

// The buy sheet's Connect: developers' own Stripe accounts, and sales on them.

/** What Zaisma keeps about a developer's connected Stripe account. */
export interface ConnectedAccountDetails {
  canTakePayments: boolean;
  countryCode: string | null;
  defaultCurrencyCode: string | null;
  businessName: string | null;
  supportEmail: string | null;
}

/** Stripe's page where a developer connects their Stripe account (or makes one) to Zaisma, coming back with state. */
export function connectUrl(env: Env, state: string): string {
  if (!env.STRIPE_CONNECT_CLIENT_ID) throw unavailable("this Zaisma has no Stripe Connect set up.");
  const query = new URLSearchParams({ response_type: "code", client_id: env.STRIPE_CONNECT_CLIENT_ID, scope: "read_write", state, redirect_uri: `${env.SITE_ORIGIN}/stripe/connect-return` });
  return `${stripeOrigins(env).connectOrigin}/oauth/authorize?${query}`;
}

/** One call to Stripe's Connect sign-in, which answers errors as { error, error_description }. */
async function connectCall(env: Env, path: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  if (!env.STRIPE_SECRET_KEY) throw unavailable("this Zaisma has no Stripe account set up.");
  let response: Response;
  try {
    response = await fetch(`${stripeOrigins(env).connectOrigin}${path}`, { method: "POST", headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString() });
  } catch (error) {
    console.error("Stripe Connect didn't answer:", error);
    throw unavailable("it didn't answer.");
  }
  const answer = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    console.error(`Stripe Connect refused ${path}:`, answer.error, answer.error_description);
    throw new StripeRefusal(String(answer.error_description ?? answer.error ?? `HTTP ${response.status}`), typeof answer.error === "string" ? answer.error : null);
  }
  return answer;
}

/** Swaps the code Stripe came back with for the connected account's ID. */
export async function finishConnect(env: Env, code: string): Promise<string> {
  const answer = await connectCall(env, "/oauth/token", { grant_type: "authorization_code", code });
  if (typeof answer.stripe_user_id !== "string") throw unavailable("it answered without an account.");
  return answer.stripe_user_id;
}

/** Ends Zaisma's access to a developer's Stripe account. Already ended counts as done. */
export async function disconnect(env: Env, stripeAccountId: string): Promise<void> {
  if (!env.STRIPE_CONNECT_CLIENT_ID) throw unavailable("this Zaisma has no Stripe Connect set up.");
  try {
    await connectCall(env, "/oauth/deauthorize", { client_id: env.STRIPE_CONNECT_CLIENT_ID, stripe_user_id: stripeAccountId });
  } catch (error) {
    if (!(error instanceof StripeRefusal) || error.stripeCode !== "invalid_client") throw error;
  }
}

/** The connected account as Stripe has it: whether it can take payments, where it is, and who players see as the seller. */
export async function accountDetails(env: Env, stripeAccountId: string): Promise<ConnectedAccountDetails> {
  return detailsOf(await stripeCall(env, "GET", `/accounts/${encodeURIComponent(stripeAccountId)}`));
}

/** The details in an account object, from a call or an account.updated event. */
export function detailsOf(account: Record<string, unknown>): ConnectedAccountDetails {
  const profile = (account.business_profile ?? {}) as { name?: string | null; support_email?: string | null };
  const dashboard = ((account.settings as { dashboard?: { display_name?: string | null } } | undefined)?.dashboard ?? {}) as { display_name?: string | null };
  return {
    canTakePayments: account.charges_enabled === true,
    countryCode: typeof account.country === "string" ? account.country.toUpperCase() : null,
    defaultCurrencyCode: typeof account.default_currency === "string" ? account.default_currency.toLowerCase() : null,
    businessName: profile.name || dashboard.display_name || null,
    supportEmail: profile.support_email || (typeof account.email === "string" ? account.email : null),
  };
}

/** Lets Apple Pay and Google Pay show on zaisma.com for payments on the connected account. Already there counts as done. */
export async function registerPaymentDomain(env: Env, stripeAccountId: string): Promise<void> {
  try {
    await stripeCall(env, "POST", "/payment_method_domains", { domain_name: new URL(env.SITE_ORIGIN).hostname }, `payment-domain:${stripeAccountId}`, stripeAccountId);
  } catch (error) {
    if (!(error instanceof StripeRefusal)) throw error;
    console.error(`Couldn't register ${env.SITE_ORIGIN} for wallets on ${stripeAccountId}:`, error.stripeMessage);
  }
}

/** A player's customer on the platform, made the first time: their saved card lives there. */
export async function playerCustomerFor(env: Env, accountId: string): Promise<string> {
  const saved = await env.DB.prepare("SELECT stripe_customer_id FROM accounts WHERE id = ?").bind(accountId).first<{ stripe_customer_id: string | null }>();
  if (saved?.stripe_customer_id) return saved.stripe_customer_id;
  const customer = await stripeCall(env, "POST", "/customers", { metadata: { account_id: accountId } }, `player-customer:${accountId}`);
  await env.DB.prepare("UPDATE accounts SET stripe_customer_id = COALESCE(stripe_customer_id, ?) WHERE id = ?").bind(customer.id, accountId).run();
  return (await env.DB.prepare("SELECT stripe_customer_id FROM accounts WHERE id = ?").bind(accountId).first<{ stripe_customer_id: string }>())!.stripe_customer_id;
}

/** Starts saving a card on the platform, for buys while the player is there (never charged while they're away). receiptEmail is the checked address the card's receipts go to; it stays in the setup's metadata, where only Zaisma writes it, so keeping the card never trusts the browser's copy. */
export async function setUpCard(env: Env, accountId: string, receiptEmail: string): Promise<{ setupIntentId: string; clientSecret: string }> {
  const customer = await playerCustomerFor(env, accountId);
  const intent = await stripeCall(env, "POST", "/setup_intents", { customer, usage: "on_session", payment_method_types: ["card"], metadata: { account_id: accountId, receipt_email: receiptEmail } });
  return { setupIntentId: intent.id, clientSecret: String(intent.client_secret) };
}

/** The card a finished setup saved, when it's this customer's and it succeeded, with the receipt email setUpCard kept in the setup (null when it holds none). */
export async function cardOfSetup(env: Env, setupIntentId: string, customerId: string): Promise<{ paymentMethodId: string; cardBrand: string; cardLastDigits: string; receiptEmail: string | null } | null> {
  const intent = await stripeCall(env, "GET", `/setup_intents/${encodeURIComponent(setupIntentId)}`, { expand: ["payment_method"] });
  const method = intent.payment_method as { id?: string; card?: { brand?: string; last4?: string } } | null;
  if (intent.status !== "succeeded" || intent.customer !== customerId || !method?.id || !method.card?.last4) return null;
  const receiptEmail = (intent.metadata as { receipt_email?: unknown } | undefined)?.receipt_email;
  return { paymentMethodId: method.id, cardBrand: method.card.brand ?? "card", cardLastDigits: method.card.last4, receiptEmail: typeof receiptEmail === "string" ? receiptEmail : null };
}

/** Takes a saved card off the platform customer. Already gone counts as done. */
export async function removeCard(env: Env, paymentMethodId: string): Promise<void> {
  try {
    await stripeCall(env, "POST", `/payment_methods/${encodeURIComponent(paymentMethodId)}/detach`);
  } catch (error) {
    if (!(error instanceof StripeRefusal)) throw error;
  }
}

/** A one-off copy of the player's saved card on the developer's account, for one purchase. Never attached to a customer there. */
export async function clonePaymentMethod(env: Env, platformPaymentMethodId: string, platformCustomerId: string, stripeAccountId: string, purchaseId: string): Promise<string> {
  const clone = await stripeCall(env, "POST", "/payment_methods", { customer: platformCustomerId, payment_method: platformPaymentMethodId }, `clone:${purchaseId}`, stripeAccountId);
  return clone.id;
}

/** What every sale's PaymentIntent carries: on the developer's account, with no application fee and no Stripe receipt (Zaisma sends its own). */
interface SaleCharge {
  stripeAccountId: string;
  amountMinorUnits: number;
  currencyCode: string;
  purchaseId: string;
  gameSlug: string;
  playerId: string;
  description: string;
  taxCalculationId: string | null;
}

function saleForm(sale: SaleCharge): Record<string, unknown> {
  return {
    amount: sale.amountMinorUnits,
    currency: sale.currencyCode,
    description: sale.description,
    metadata: { purchase_id: sale.purchaseId, game_slug: sale.gameSlug, player_id: sale.playerId, ...(sale.taxCalculationId ? { tax_calculation: sale.taxCalculationId } : {}) },
  };
}

/** Charges a cloned card on the developer's account at once. The purchase's ID is the idempotency key, so it's charged once whatever happens. */
export async function chargeOnAccount(env: Env, sale: SaleCharge & { paymentMethodId: string }): Promise<StripeObject> {
  return stripeCall(env, "POST", "/payment_intents", { ...saleForm(sale), payment_method: sale.paymentMethodId, confirm: true, automatic_payment_methods: { enabled: true, allow_redirects: "never" } }, `purchase:${sale.purchaseId}`, sale.stripeAccountId);
}

/** A payment the sheet finishes with Apple Pay or Google Pay (Stripe's Express Checkout Element), on the developer's account. */
export async function walletIntentOnAccount(env: Env, sale: SaleCharge): Promise<StripeObject> {
  return stripeCall(env, "POST", "/payment_intents", { ...saleForm(sale), automatic_payment_methods: { enabled: true } }, `wallet:${sale.purchaseId}`, sale.stripeAccountId);
}

/** A sale's PaymentIntent as Stripe has it now. */
export async function paymentIntentOnAccount(env: Env, stripeAccountId: string, paymentIntentId: string): Promise<StripeObject> {
  return stripeCall(env, "GET", `/payment_intents/${encodeURIComponent(paymentIntentId)}`, { expand: ["latest_charge"] }, undefined, stripeAccountId);
}

/**
 * The tax inside a sale's price, with Stripe Tax on the developer's account: the price is tax inclusive, so the
 * charged amount never changes; the player's place is their connection address.
 */
export async function taxCalculation(env: Env, calculation: { stripeAccountId: string; amountMinorUnits: number; currencyCode: string; itemName: string; ipAddress: string }): Promise<string> {
  const answer = await stripeCall(
    env,
    "POST",
    "/tax/calculations",
    { currency: calculation.currencyCode, line_items: [{ amount: calculation.amountMinorUnits, reference: calculation.itemName, tax_behavior: "inclusive" }], customer_details: { ip_address: calculation.ipAddress } },
    undefined,
    calculation.stripeAccountId,
  );
  return answer.id;
}

/** Records a paid sale's tax on the developer's account, so Stripe Tax reports it. */
export async function recordTaxTransaction(env: Env, stripeAccountId: string, taxCalculationId: string, purchaseId: string): Promise<void> {
  await stripeCall(env, "POST", "/tax/transactions/create_from_calculation", { calculation: taxCalculationId, reference: purchaseId }, `tax:${purchaseId}`, stripeAccountId);
}

/** Gives amountMinorUnits of a sale back to the player, from the developer's account. */
export async function refundOnAccount(env: Env, stripeAccountId: string, paymentIntentId: string, amountMinorUnits: number, idempotencyKey: string): Promise<StripeObject> {
  return stripeCall(env, "POST", "/refunds", { payment_intent: paymentIntentId, amount: amountMinorUnits }, idempotencyKey, stripeAccountId);
}

/** Cancels a payment nobody finished, so it can't be paid later (the daily step for abandoned sheets). */
export async function cancelPaymentOnAccount(env: Env, stripeAccountId: string, paymentIntentId: string): Promise<void> {
  await stripeCall(env, "POST", `/payment_intents/${encodeURIComponent(paymentIntentId)}/cancel`, {}, `cancel:${paymentIntentId}`, stripeAccountId);
}
