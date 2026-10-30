import { CREDIT_LIMITS, addCreditEntry, creditOf } from "@zaisma/core";
import { addTopUp, emailOwner } from "./hosting-job.ts";
import { addRefillToInvoice, invoicePaymentIntentId, isSignedByStripe, stopCreditPlan } from "./stripe.ts";
import type { Env } from "./env.ts";

/** Stripe's events are small; anything bigger isn't one. */
const MAXIMUM_EVENT_SIZE_BYTES = 256 * 1024;

export type StripeEvent = { id: string; type: string; data: { object: Record<string, unknown> & { id: string } } };

/**
 * POST /stripe/events: Stripe tells Zaisma a top-up was paid, a payment was refunded, a Zaisma Pro subscription started, renewed, changed or ended,
 * or a monthly credit plan started, renews, was paid, was declined or ended.
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
  }
  const eventAtMs = Number((event as unknown as Record<string, unknown>)["created"]) * 1000 || Date.now();
  // The subscription's own metadata says which it is: a credit plan's says credit_plan, Pro's pro, or nothing for Pro made before plans.
  const isCreditPlan = metadata.subscription_kind === "credit_plan";
  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") await (isCreditPlan ? saveCreditPlan(env, object, eventAtMs) : saveProSubscription(env, object, event.type, eventAtMs));
  if (event.type === "customer.subscription.deleted") await (isCreditPlan ? endCreditPlan(env, object, eventAtMs) : endProSubscription(env, object, eventAtMs));
  const plan = event.type.startsWith("invoice.") ? creditPlanOfInvoice(object) : null;
  if (plan && event.type === "invoice.created") await addMonthRefill(env, object, plan);
  if (plan && event.type === "invoice.paid") await addPlanPayment(env, object, plan);
  if (plan && event.type === "invoice.payment_failed" && Number(object.attempt_count) === 1) await emailOwner(env, plan.ownerId, "credit_plan_payment_failed", {});
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
}

/** A subscription that ended: Pro ends now (a period that already ended stays ended), and the subscription is let go. */
async function endProSubscription(env: Env, subscription: Record<string, unknown> & { id: string }, eventAtMs: number): Promise<void> {
  const ownerId = await proOwnerOf(env, subscription);
  if (!ownerId) return;
  await env.DB.prepare("UPDATE owners SET pro_until_ms = MIN(COALESCE(pro_until_ms, ?), ?), is_pro_cancelled = 0, stripe_subscription_id = NULL, pro_event_at_ms = ? WHERE id = ? AND stripe_subscription_id = ? AND (pro_event_at_ms IS NULL OR pro_event_at_ms <= ?)")
    .bind(Date.now(), Date.now(), eventAtMs, ownerId, subscription.id, eventAtMs)
    .run();
}

/* ---- The monthly credit plan ---- */

/**
 * A credit plan that started or changed: running while Stripe is paid, payment_failing while it retries a declined
 * renewal (past_due). The level comes from the subscription's metadata only when the plan is first saved; after that
 * it's Zaisma's own column (PATCH /credit/plan). Ordered by credit_plan_event_at_ms, as Pro is, and a second plan paid
 * while one runs is stopped at once: two would refill twice. Its first payment stays as credit, refundable as any top-up.
 */
async function saveCreditPlan(env: Env, subscription: Record<string, unknown> & { id: string }, eventAtMs: number): Promise<void> {
  const metadata = (subscription.metadata ?? {}) as Record<string, string>;
  const ownerId = metadata.owner_id;
  if (!ownerId) return;
  const status = String(subscription.status ?? "");
  if (["canceled", "unpaid", "incomplete_expired"].includes(status)) return endCreditPlan(env, subscription, eventAtMs);
  const planStatus = status === "past_due" ? "payment_failing" : status === "active" || status === "trialing" ? "running" : null;
  if (!planStatus) return;
  const levelCents = Number(metadata.refill_level_cents);
  if (!Number.isInteger(levelCents) || levelCents < CREDIT_LIMITS.minimumRefillLevelCents || levelCents > CREDIT_LIMITS.maximumRefillLevelCents) {
    console.error(`Credit plan ${subscription.id} has no level Zaisma takes in its metadata.`);
    return;
  }
  const startedAtMs = Number(subscription.created) * 1000 || eventAtMs;
  // SQLite reads every SET from the row as it was, so a plan already saved keeps its level and start.
  const saved = await env.DB.prepare(
    "UPDATE owners SET credit_plan_refill_level_cents = CASE WHEN credit_plan_subscription_id = ? THEN credit_plan_refill_level_cents ELSE ? END, credit_plan_started_at_ms = CASE WHEN credit_plan_subscription_id = ? THEN credit_plan_started_at_ms ELSE ? END, credit_plan_subscription_id = ?, credit_plan_status = ?, credit_plan_event_at_ms = ? WHERE id = ? AND (credit_plan_subscription_id IS NULL OR credit_plan_subscription_id = ?) AND (credit_plan_event_at_ms IS NULL OR credit_plan_event_at_ms <= ?)",
  )
    .bind(subscription.id, levelCents, subscription.id, startedAtMs, subscription.id, planStatus, eventAtMs, ownerId, subscription.id, eventAtMs)
    .run();
  if (saved.meta.changes) return;
  const running = await env.DB.prepare("SELECT credit_plan_subscription_id FROM owners WHERE id = ?").bind(ownerId).first<{ credit_plan_subscription_id: string | null }>();
  if (running?.credit_plan_subscription_id && running.credit_plan_subscription_id !== subscription.id) {
    console.error(`A second credit plan, ${subscription.id}, was paid while ${running.credit_plan_subscription_id} runs: it's stopped, and its first payment stays as credit.`);
    await stopCreditPlan(env, subscription.id);
  }
}

/**
 * A credit plan that ended on Stripe's side: Stripe gave up on a declined renewal, or the developer cancelled it on
 * Link. The developer hears it; a plan they stopped on Zaisma is gone from the row already, so this finds nothing.
 */
async function endCreditPlan(env: Env, subscription: Record<string, unknown> & { id: string }, eventAtMs: number): Promise<void> {
  const ownerId = ((subscription.metadata ?? {}) as Record<string, string>).owner_id;
  if (!ownerId) return;
  const running = await env.DB.prepare("SELECT credit_plan_status FROM owners WHERE id = ? AND credit_plan_subscription_id = ?").bind(ownerId, subscription.id).first<{ credit_plan_status: string }>();
  if (!running) return;
  const ended = await env.DB.prepare(
    "UPDATE owners SET credit_plan_subscription_id = NULL, credit_plan_refill_level_cents = NULL, credit_plan_status = NULL, credit_plan_started_at_ms = NULL, credit_plan_event_at_ms = ? WHERE id = ? AND credit_plan_subscription_id = ? AND (credit_plan_event_at_ms IS NULL OR credit_plan_event_at_ms <= ?)",
  )
    .bind(eventAtMs, ownerId, subscription.id, eventAtMs)
    .run();
  if (ended.meta.changes) await emailOwner(env, ownerId, "credit_plan_stopped", { hasPaymentFailed: running.credit_plan_status === "payment_failing" });
}

/** The owner and subscription of a credit plan's invoice, from the subscription's metadata Stripe copies onto it; null for any other invoice. */
function creditPlanOfInvoice(invoice: Record<string, unknown>): { ownerId: string; subscriptionId: string } | null {
  const details = ((invoice.parent as Record<string, unknown> | undefined)?.["subscription_details"] ?? invoice.subscription_details) as { metadata?: Record<string, string>; subscription?: unknown } | undefined;
  const subscriptionId = typeof details?.subscription === "string" ? details.subscription : typeof invoice.subscription === "string" ? invoice.subscription : null;
  if (details?.metadata?.subscription_kind !== "credit_plan" || !details.metadata.owner_id || !subscriptionId) return null;
  return { ownerId: details.metadata.owner_id, subscriptionId };
}

/**
 * The 1st's renewal, still a draft: what brings the balance back to the level goes on it, nothing under
 * minimumRefillCents or for a balance at or over the level. Stripe holds the draft until this answers, so the balance
 * read here is the one the payment is for. A plan that isn't the owner's running one adds nothing.
 */
async function addMonthRefill(env: Env, invoice: Record<string, unknown> & { id: string }, plan: { ownerId: string; subscriptionId: string }): Promise<void> {
  if (invoice.billing_reason !== "subscription_cycle" || invoice.status !== "draft" || typeof invoice.customer !== "string") return;
  const owner = await env.DB.prepare("SELECT credit_balance_cents, credit_plan_refill_level_cents FROM owners WHERE id = ? AND credit_plan_subscription_id = ?").bind(plan.ownerId, plan.subscriptionId).first<{ credit_balance_cents: number; credit_plan_refill_level_cents: number }>();
  if (!owner) return;
  const refillCents = owner.credit_plan_refill_level_cents - Math.max(0, owner.credit_balance_cents);
  if (refillCents < CREDIT_LIMITS.minimumRefillCents) return;
  await addRefillToInvoice(env, invoice.id, invoice.customer, refillCents);
}

/**
 * A plan's payment went through, the first fill or a month's refill: its credit comes in as a top-up, refundable for 30
 * days like any other and once however many times the event comes (the payment intent keys it). What's credited is
 * the invoice before tax: Stripe adds sales tax or VAT on top, and keeps it.
 */
async function addPlanPayment(env: Env, invoice: Record<string, unknown> & { id: string }, plan: { ownerId: string; subscriptionId: string }): Promise<void> {
  const amountCents = Number(invoice.total_excluding_tax ?? invoice.subtotal);
  if (!(amountCents > 0)) return;
  if (invoice.currency !== "usd") {
    console.error(`Credit plan invoice ${invoice.id} is in ${String(invoice.currency)}, not usd: no credit added.`);
    return;
  }
  const paymentIntentId = await invoicePaymentIntentId(env, invoice.id);
  // Stripe sends the event again until it's answered, so a payment it can't name yet is tried again then.
  if (!paymentIntentId) throw new Error(`Credit plan invoice ${invoice.id} is paid, but Stripe names no payment for it.`);
  await addTopUp(env, { ownerId: plan.ownerId, amountCents, paymentIntentId });
}
