import { ApiError, CREDIT_LIMITS, PRO_REFUND_LIMITS } from "@zaisma/core";
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
const STRIPE_CHECKOUT_ORIGIN = "https://checkout.stripe.com";
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
/**
 * Where a form on the settings page goes on to, for its form-action: Stripe's Checkout (credit and Pro) and its
 * Connect sign-in. A browser holds every redirect a form makes to that list, so without them the page just waits.
 */
export function stripeFormTargets(env: Env): string[] {
  return [STRIPE_CHECKOUT_ORIGIN, stripeOrigins(env).connectOrigin];
}

export function stripeOrigins(env: Env): { apiOrigin: string; connectOrigin: string } {
  if (!env.STRIPE_API_ORIGIN) return { apiOrigin: STRIPE_API_ORIGIN, connectOrigin: STRIPE_CONNECT_ORIGIN };
  if (!isLocalPreview(env)) throw unavailable("STRIPE_API_ORIGIN only works in the local preview.");
  return { apiOrigin: env.STRIPE_API_ORIGIN, connectOrigin: env.STRIPE_API_ORIGIN };
}

/**
 * One call to Stripe's API. idempotencyKey makes a retry the same call, never a second charge. stripeAccountId makes
 * it on a developer's connected account (the Stripe-Account header), as every buy sheet sale is.
 */
export async function stripeCall(env: Env, method: "GET" | "POST" | "DELETE", path: string, form: Record<string, unknown> = {}, idempotencyKey?: string, stripeAccountId?: string): Promise<StripeObject> {
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
    throw new StripeRefusal(answer.error?.message ?? `HTTP ${response.status}`, answer.error?.decline_code ?? answer.error?.code ?? null, answer.error?.type ?? null, response.status);
  }
  return answer;
}

/** Stripe said no: a declined card, or a call it won't take. message is Stripe's own words; stripeErrorKind is Stripe's error type ("card_error" for a card that was really refused, "api_error" for Stripe's own trouble). */
export class StripeRefusal extends ApiError {
  constructor(
    readonly stripeMessage: string,
    readonly stripeCode: string | null,
    readonly stripeErrorKind: string | null = null,
    readonly stripeHttpStatusNumber: number | null = null,
  ) {
    super("stripe_unavailable", { message: `Stripe didn't take it: ${stripeMessage}`, fix: "Try again in a minute; if it keeps happening, tell Zaisma with message_zaisma." });
  }

  /** The card itself was refused (HTTP 402, card_error), not Stripe's own trouble, a rate limit or a key in use: trying again won't help. */
  get isCardRefused(): boolean {
    return this.stripeHttpStatusNumber === 402 || this.stripeErrorKind === "card_error";
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
 * the card saved for automatic top-ups. Back to the credit settings either way. Managed Payments refuses custom_text,
 * so the refund terms are on the settings page above the button instead.
 */
export async function topUpCheckout(env: Env, ownerId: string, amountCents: number): Promise<{ checkoutUrl: string; expiresAtMs: number }> {
  const customer = await customerFor(env, ownerId);
  const backUrl = `${env.SITE_ORIGIN}/dashboard/settings#hosting`;
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
  const backUrl = `${env.SITE_ORIGIN}/dashboard/settings#pro`;
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
const PRO_INVOICES_TIMEOUT_MS = 3000;

/** A paid invoice of a Zaisma Pro subscription: what was paid, when, and the payment to refund. */
interface ProInvoice {
  id: string;
  subscriptionId: string;
  amountPaidCents: number;
  paidAtMs: number;
  paymentIntentId: string | null;
}

/**
 * The customer's paid Zaisma Pro invoices, newest first, every subscription's: a refunded one stays paid, so a
 * developer who refunded Pro and started it again has two. Credit's top-ups make no invoices.
 */
async function paidProInvoices(env: Env, customerId: string): Promise<ProInvoice[]> {
  const answer = await stripeCall(env, "GET", "/invoices", { customer: customerId, status: "paid", limit: 10, expand: ["data.payments"] });
  const invoices = Array.isArray(answer.data) ? (answer.data as Record<string, any>[]) : [];
  return invoices.flatMap((invoice): ProInvoice[] => {
    const subscriptionId = invoice.parent?.subscription_details?.subscription ?? invoice.subscription;
    const paidAtSec = invoice.status_transitions?.paid_at;
    if (typeof subscriptionId !== "string" || typeof paidAtSec !== "number" || !(Number(invoice.amount_paid) > 0)) return [];
    const payment = (Array.isArray(invoice.payments?.data) ? invoice.payments.data : []).find((each: any) => each?.status === "paid" && typeof each?.payment?.payment_intent === "string");
    return [{ id: String(invoice.id), subscriptionId, amountPaidCents: Number(invoice.amount_paid), paidAtMs: paidAtSec * 1000, paymentIntentId: payment?.payment.payment_intent ?? (typeof invoice.payment_intent === "string" ? invoice.payment_intent : null) }];
  });
}

/** The account's first Zaisma Pro payment while it's still its only one and inside its 14 days, else null. */
function refundableFirstPayment(invoices: ProInvoice[], subscriptionId: string, nowMs: number): ProInvoice | null {
  const [first] = invoices;
  if (invoices.length !== 1 || !first || first.subscriptionId !== subscriptionId) return null;
  return nowMs < first.paidAtMs + PRO_REFUND_LIMITS.refundableDurationDays * 86_400_000 ? first : null;
}

/**
 * Until when Zaisma Pro's first payment refunds, read live from Stripe: null once it can't, and when Stripe doesn't
 * answer within 3 seconds, so a slow Stripe never holds get_pro or the settings page. Only asked while Pro's paid
 * period still runs past 14 days from now, since a monthly period that started inside the last 14 days does.
 */
export async function proRefundEndsAtMs(env: Env, customerId: string, subscriptionId: string, proUntilMs: number, nowMs = Date.now()): Promise<number | null> {
  if (proUntilMs <= nowMs + PRO_REFUND_LIMITS.refundableDurationDays * 86_400_000) return null;
  try {
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Stripe's invoices took more than 3 seconds.")), PRO_INVOICES_TIMEOUT_MS));
    const first = refundableFirstPayment(await Promise.race([paidProInvoices(env, customerId), timeout]), subscriptionId, nowMs);
    return first ? first.paidAtMs + PRO_REFUND_LIMITS.refundableDurationDays * 86_400_000 : null;
  } catch (error) {
    console.error("Couldn't read Zaisma Pro's invoices:", error);
    return null;
  }
}

/**
 * Refunds Zaisma Pro's first payment in full and ends the subscription at once (docs/DECISIONS.md, "Zaisma Pro
 * refunds"): only while it's the account's only Pro payment and inside its 14 days. Answers the cents refunded, or
 * null when it doesn't refund. The invoice's ID keys the refund, so a retry after the cancel failed refunds once.
 */
export async function refundFirstProPayment(env: Env, customerId: string, subscriptionId: string, nowMs = Date.now()): Promise<number | null> {
  const first = refundableFirstPayment(await paidProInvoices(env, customerId), subscriptionId, nowMs);
  if (!first?.paymentIntentId) return null;
  await stripeCall(env, "POST", "/refunds", { payment_intent: first.paymentIntentId, metadata: { reason_text: "Zaisma Pro's first payment" } }, `pro-refund:${first.id}`);
  await stripeCall(env, "DELETE", `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  return first.amountPaidCents;
}

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

/** A connected account's money as Stripe reports it, never a sum of Zaisma's. */
export interface StripeBalance {
  currencyCode: string | null;
  availableMinorUnits: number;
  pendingMinorUnits: number;
  otherCurrencyBalances: { currencyCode: string; availableMinorUnits: number; pendingMinorUnits: number }[];
  /** The soonest payout on its way, or null when none is scheduled (manual payouts). */
  nextPayout: { amountMinorUnits: number; currencyCode: string; arrivesAtMs: number } | null;
}

const BALANCE_TIMEOUT_MS = 3000;

/**
 * The connected account's balance and its next payout, read live from its Stripe (the Stripe-Account header). Null when Stripe
 * doesn't answer within 3 seconds or refuses, so a slow Stripe never holds the page or the rest of an answer.
 */
export async function getStripeBalance(env: Env, stripeAccountId: string, defaultCurrencyCode: string | null): Promise<StripeBalance | null> {
  try {
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Stripe's balance took more than 3 seconds.")), BALANCE_TIMEOUT_MS));
    const [balance, payouts] = await Promise.race([Promise.all([stripeCall(env, "GET", "/balance", {}, undefined, stripeAccountId), stripeCall(env, "GET", "/payouts", { limit: 10 }, undefined, stripeAccountId)]), timeout]);
    const listOf = (listValue: unknown): Record<string, unknown>[] => (Array.isArray(listValue) ? (listValue as Record<string, unknown>[]) : []);
    const sums = new Map<string, { availableMinorUnits: number; pendingMinorUnits: number }>();
    for (const [field, list] of [["availableMinorUnits", balance.available], ["pendingMinorUnits", balance.pending]] as const) {
      for (const each of listOf(list)) {
        const minorUnits = each["amount"];
        const currencyCode = each["currency"];
        if (typeof minorUnits !== "number" || typeof currencyCode !== "string") continue;
        const sum = sums.get(currencyCode) ?? { availableMinorUnits: 0, pendingMinorUnits: 0 };
        sum[field] += minorUnits;
        sums.set(currencyCode, sum);
      }
    }
    const mainCurrency = defaultCurrencyCode && sums.has(defaultCurrencyCode) ? defaultCurrencyCode : defaultCurrencyCode ?? [...sums.keys()][0] ?? null;
    const coming = listOf(payouts.data)
      .filter((payout) => (payout["status"] === "pending" || payout["status"] === "in_transit") && typeof payout["amount"] === "number" && typeof payout["currency"] === "string" && typeof payout["arrival_date"] === "number")
      .sort((first, second) => (first["arrival_date"] as number) - (second["arrival_date"] as number))[0];
    return {
      currencyCode: mainCurrency,
      availableMinorUnits: mainCurrency ? sums.get(mainCurrency)?.availableMinorUnits ?? 0 : 0,
      pendingMinorUnits: mainCurrency ? sums.get(mainCurrency)?.pendingMinorUnits ?? 0 : 0,
      otherCurrencyBalances: [...sums].filter(([currencyCode, sum]) => currencyCode !== mainCurrency && (sum.availableMinorUnits !== 0 || sum.pendingMinorUnits !== 0)).map(([currencyCode, sum]) => ({ currencyCode, ...sum })),
      nextPayout: coming ? { amountMinorUnits: coming["amount"] as number, currencyCode: coming["currency"] as string, arrivesAtMs: (coming["arrival_date"] as number) * 1000 } : null,
    };
  } catch (error) {
    console.error("Couldn't read a connected account's balance:", error);
    return null;
  }
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

/** Starts saving a card on the platform, for buys while the player is there (never charged while they're away). */
export async function setUpCard(env: Env, accountId: string): Promise<{ setupIntentId: string; clientSecret: string }> {
  const customer = await playerCustomerFor(env, accountId);
  const intent = await stripeCall(env, "POST", "/setup_intents", { customer, usage: "on_session", payment_method_types: ["card"], metadata: { account_id: accountId } });
  return { setupIntentId: intent.id, clientSecret: String(intent.client_secret) };
}

/** The card a finished setup saved, when it's this customer's and it succeeded, with the receipt email setUpCard kept in the setup (null when it holds none). */
export async function cardOfSetup(env: Env, setupIntentId: string, customerId: string): Promise<{ paymentMethodId: string; cardBrand: string; cardLastDigits: string } | null> {
  const intent = await stripeCall(env, "GET", `/setup_intents/${encodeURIComponent(setupIntentId)}`, { expand: ["payment_method"] });
  const method = intent.payment_method as { id?: string; card?: { brand?: string; last4?: string } } | null;
  if (intent.status !== "succeeded" || intent.customer !== customerId || !method?.id || !method.card?.last4) return null;
  return { paymentMethodId: method.id, cardBrand: method.card.brand ?? "card", cardLastDigits: method.card.last4 };
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
