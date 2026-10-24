import { ApiError, accountById, iso, randomKey } from "@zaisma/core";
import { currentSession } from "./auth.ts";
import { logAccountChange, logCallerEvent } from "./security-log.ts";
import { accountDetails, connectUrl, disconnect, finishConnect, registerPaymentDomain, type ConnectedAccountDetails } from "./stripe.ts";
import type { Caller, NextStep } from "./developer.ts";
import type { Env } from "./env.ts";

/**
 * A developer's own Stripe account for the buy sheet (docs/DECISIONS.md, "One Zaisma buy sheet; we own the buying
 * experience, not the money."): Connect Standard, so the developer is the seller, every sale is a direct charge on
 * their account and Zaisma takes no fee. Their AI reads the connection, asks for the link a person opens to connect,
 * turns Stripe Tax on or off and disconnects. Connecting needs the developer's passkey on zaisma.com, since it decides
 * where players' money goes; disconnecting doesn't, since it only stops sales.
 *
 *   GET    /api/dev/stripe-account                   the connection
 *   POST   /api/dev/stripe-account/connection-links  → Stripe's page to connect on (the signed-in page, with a passkey)
 *   PATCH  /api/dev/stripe-account                   { is_stripe_tax_used }
 *   DELETE /api/dev/stripe-account                   disconnects; sales stop
 *   GET    /stripe/connect-return                    where Stripe comes back to (a page route, not the API)
 */

/** How long a connection link works. */
const CONNECT_STATE_DURATION_MS = 10 * 60_000;

interface StripeAccountRow {
  stripe_account_id: string | null;
  can_take_stripe_payments: number;
  stripe_country_code: string | null;
  stripe_default_currency_code: string | null;
  stripe_business_name: string | null;
  stripe_support_email: string | null;
  is_stripe_tax_used: number;
  stripe_connected_at_ms: number | null;
}

const STRIPE_ACCOUNT_COLUMNS = "stripe_account_id, can_take_stripe_payments, stripe_country_code, stripe_default_currency_code, stripe_business_name, stripe_support_email, is_stripe_tax_used, stripe_connected_at_ms";

/** The owner's connection, as the columns hold it. */
export async function stripeAccountRow(env: Env, ownerId: string): Promise<StripeAccountRow | null> {
  return env.DB.prepare(`SELECT ${STRIPE_ACCOUNT_COLUMNS} FROM owners WHERE id = ?`).bind(ownerId).first<StripeAccountRow>();
}

/** The stripe_account answer. */
export function stripeAccountJson(row: StripeAccountRow | null) {
  const isConnected = Boolean(row?.stripe_account_id);
  return {
    is_connected: isConnected,
    stripe_account_id: isConnected ? row!.stripe_account_id : null,
    can_take_payments: isConnected && row!.can_take_stripe_payments === 1,
    country_code: isConnected ? row!.stripe_country_code : null,
    default_currency_code: isConnected ? row!.stripe_default_currency_code : null,
    business_name: isConnected ? row!.stripe_business_name : null,
    support_email: isConnected ? row!.stripe_support_email : null,
    is_stripe_tax_used: isConnected && row!.is_stripe_tax_used === 1,
    connected_at: isConnected && row!.stripe_connected_at_ms !== null ? iso(row!.stripe_connected_at_ms) : null,
  };
}

/** Saves what Stripe says about a connected account, wherever it's connected (the return, or account.updated). */
export async function saveAccountDetails(env: Env, stripeAccountId: string, details: ConnectedAccountDetails): Promise<void> {
  await env.DB.prepare("UPDATE owners SET can_take_stripe_payments = ?, stripe_country_code = ?, stripe_default_currency_code = ?, stripe_business_name = ?, stripe_support_email = ? WHERE stripe_account_id = ?")
    .bind(details.canTakePayments ? 1 : 0, details.countryCode, details.defaultCurrencyCode, details.businessName, details.supportEmail, stripeAccountId)
    .run();
}

/** Forgets a connection (disconnected here, or deauthorized on Stripe's side). The account's sales stay as they were. */
export async function forgetStripeAccount(env: Env, stripeAccountId: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE owners SET stripe_account_id = NULL, can_take_stripe_payments = 0, stripe_country_code = NULL, stripe_default_currency_code = NULL, stripe_business_name = NULL, stripe_support_email = NULL, is_stripe_tax_used = 0, stripe_connected_at_ms = NULL WHERE stripe_account_id = ?",
  )
    .bind(stripeAccountId)
    .run();
}

/** Where the developer connects Stripe with their passkey: the payments settings on zaisma.com. */
const confirmUrlOf = (env: Env) => `${env.SITE_ORIGIN}/developer/settings#payments`;

/** One call, once the router (developer.ts, checkCall) has checked the key. */
export async function stripeAccountRoute(env: Env, path: string, method: string, body: Record<string, unknown>, caller: Caller, nowMs = Date.now()): Promise<[unknown, number?]> {
  const ownerId = caller.ownerId;
  const row = await stripeAccountRow(env, ownerId);
  const answered = (nextSteps: NextStep[] = []) => ({ stripe_account: stripeAccountJson(row), next_steps: nextSteps });

  if (path === "/stripe-account" && method === "GET") return [{ stripe_account: stripeAccountJson(row) }];

  if (path === "/stripe-account/connection-links" && method === "POST") {
    if (!caller.isSpendingConfirmed) {
      throw new ApiError("confirmation_needed", {
        message: "Connecting a Stripe account decides where players' money goes, so it needs the developer's passkey on zaisma.com.",
        fix: "Send the developer to confirm_url to connect Stripe there with their passkey.",
        confirmUrl: confirmUrlOf(env),
      });
    }
    const state = randomKey(32);
    const expiresAtMs = nowMs + CONNECT_STATE_DURATION_MS;
    const url = connectUrl(env, state);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM stripe_connect_states WHERE owner_id = ? OR expires_at_ms <= ?").bind(ownerId, nowMs),
      env.DB.prepare("INSERT INTO stripe_connect_states (state, owner_id, expires_at_ms) VALUES (?, ?, ?)").bind(state, ownerId, expiresAtMs),
    ]);
    const nextSteps: NextStep[] = [{ tool: "get_stripe_account", arguments: {}, after_sec: null, reason: "Ask the developer to open connect_url and connect (or make) their Stripe account there; once they have, get_stripe_account shows it connected." }];
    return [{ connect_url: url, expires_at: iso(expiresAtMs), next_steps: nextSteps }, 201];
  }

  if (!row?.stripe_account_id) {
    throw new ApiError("stripe_not_connected", { message: "The developer hasn't connected a Stripe account.", fix: "connect_stripe_account gives the link the developer connects on." });
  }

  if (path === "/stripe-account" && method === "PATCH") {
    const isUsed = body.is_stripe_tax_used;
    if (typeof isUsed !== "boolean") throw new ApiError("bad_is_stripe_tax_used", { message: "is_stripe_tax_used isn't true or false.", field: "is_stripe_tax_used", fix: "Send is_stripe_tax_used: true to calculate and record tax with Stripe Tax inside each price, or false." });
    await env.DB.prepare("UPDATE owners SET is_stripe_tax_used = ? WHERE id = ?").bind(isUsed ? 1 : 0, ownerId).run();
    row.is_stripe_tax_used = isUsed ? 1 : 0;
    await logCallerEvent(env, caller, "stripe_account_changed");
    return [answered()];
  }

  if (path === "/stripe-account" && method === "DELETE") {
    await disconnect(env, row.stripe_account_id);
    await forgetStripeAccount(env, row.stripe_account_id);
    await logCallerEvent(env, caller, "stripe_account_disconnected");
    return [{ stripe_account: stripeAccountJson(null), next_steps: [] satisfies NextStep[] }];
  }

  throw new ApiError("bad_method", { message: `${method} isn't a call at ${path}.`, fix: "docs/DEVELOPER-API.md, Selling with the buy sheet, lists the Stripe account calls." });
}

/**
 * Where Stripe comes back to once a developer connected (or didn't). The state must be one this owner asked for in
 * the last 10 minutes, from the same signed-in account: a link someone else made can't connect their Stripe to you.
 */
export async function handleConnectReturn(request: Request, env: Env, nowMs = Date.now()): Promise<Response> {
  const url = new URL(request.url);
  const back = (outcome: string) => Response.redirect(`${env.SITE_ORIGIN}/developer/settings?stripe=${outcome}#payments`, 303);
  const session = await currentSession(request, env);
  if (!session) return back("signed_out");
  const state = url.searchParams.get("state") ?? "";
  const saved = await env.DB.prepare("DELETE FROM stripe_connect_states WHERE state = ? RETURNING owner_id, expires_at_ms").bind(state).first<{ owner_id: string; expires_at_ms: number }>();
  const owner = await env.DB.prepare("SELECT id FROM owners WHERE account_id = ?").bind(session.userId).first<{ id: string }>();
  const account = await accountById(env.DB, session.userId);
  if (!saved || !owner || !account || saved.owner_id !== owner.id || saved.expires_at_ms <= nowMs) return back("link_expired");
  const code = url.searchParams.get("code");
  if (!code) return back("cancelled");

  const stripeAccountId = await finishConnect(env, code);
  const taken = await env.DB.prepare("SELECT id FROM owners WHERE stripe_account_id = ?").bind(stripeAccountId).first<{ id: string }>();
  if (taken && taken.id !== owner.id) return back("account_taken");
  const details = await accountDetails(env, stripeAccountId);
  await env.DB.prepare("UPDATE owners SET stripe_account_id = ?, is_stripe_tax_used = 0, stripe_connected_at_ms = ? WHERE id = ?").bind(stripeAccountId, nowMs, owner.id).run();
  await saveAccountDetails(env, stripeAccountId, details);
  await registerPaymentDomain(env, stripeAccountId);
  await logAccountChange(request, env, account, "stripe_account_connected", { subjectName: details.businessName ?? stripeAccountId });
  return back("connected");
}
