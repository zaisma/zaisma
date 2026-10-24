import {
  ApiError,
  ITEM_LIMITS,
  PURCHASE_PIN_LIMITS,
  accountById,
  gameById,
  gameBySlug,
  hashPurchasePin,
  isPurchasePin,
  isWithdrawalLineShownFor,
  itemByName,
  owningPurchaseOf,
  passkeysFor,
  priceFor,
  priceText,
  purchasePinProblem,
  purchaseSettingsOf,
  refundPolicyWords,
  type Account,
} from "@zaisma/core";
import { tryPassword } from "./account.ts";
import { currentSession, realEmail, sessionCookies, type Session } from "./auth.ts";
import { isOpenHere } from "./game-links.ts";
import { purchaseJson, withReceipts } from "./items-api.ts";
import { checkPasskeyTap, usedChallengeCookie, type PasskeyTap } from "./passkeys.ts";
import { completePurchase, failPurchase, notePayment, recordPendingSale, saleById, staleSales, type Sale } from "./sales.ts";
import { stripeAccountRow } from "./stripe-account-api.ts";
import {
  StripeRefusal,
  cardOfSetup,
  cancelPaymentOnAccount,
  chargeOnAccount,
  clonePaymentMethod,
  paymentIntentOnAccount,
  playerCustomerFor,
  removeCard,
  setUpCard,
  taxCalculation,
  walletIntentOnAccount,
} from "./stripe.ts";
import type { Env } from "./env.ts";

/**
 * The player's side of the buy sheet on zaisma.com (docs/DECISIONS.md, "One Zaisma buy sheet; we own the buying
 * experience, not the money."): what the sheet shows, confirming a saved-card buy, paying, and the player's saved
 * card and purchase PIN. Signed-in players only, by the session cookie, from zaisma.com's own pages; never the
 * developer API. Every answer that refuses is { error: { code, message } }.
 *
 *   POST   /api/buy/:slug/start                           { item_name, quantity, game_account_id, tester_token } → the sheet
 *   POST   /api/buy/confirm                               { passkey_tap | purchase_pin | password }: 15 minutes of one-tap buys here
 *   POST   /api/buy/purchases/:purchase_id/pay-with-saved-card  → completed, or action_needed (3-D Secure)
 *   POST   /api/buy/purchases/:purchase_id/wallet-intent  → what Apple Pay or Google Pay pays
 *   GET    /api/buy/purchases/:purchase_id                the purchase, asking Stripe while it's pending
 *   POST   /api/payment-methods/setup                     { receipt_email } → a card setup
 *   POST   /api/payment-methods/saved                     { setup_intent_id }: keeps the card
 *   DELETE /api/payment-methods/saved                     forgets it
 *   PUT    /api/account/purchase-pin                      { purchase_pin, password }
 *   DELETE /api/account/purchase-pin
 *
 * The 15 minutes live on the session (purchase_confirmations), so they're per device and end at sign-out. Apple Pay
 * and Google Pay skip Zaisma's confirm: the wallet asks for Face ID or a fingerprint itself.
 */

const CONFIRMATION_DURATION_MS = PURCHASE_PIN_LIMITS.confirmationDurationMin * 60_000;
const MAXIMUM_BODY_SIZE_BYTES = 8192;

type Refusal = { httpStatus: number; code: string; message: string };
class BuyRefusal extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.message);
  }
}
const refuse = (httpStatus: number, code: string, message: string): never => {
  throw new BuyRefusal({ httpStatus, code, message });
};

interface Signed {
  session: Session & { cookies: string[] };
  account: Account;
}

const PATHS = /^\/api\/(buy\/[a-z0-9-]+\/start|buy\/confirm|buy\/purchases\/[A-Za-z0-9_-]+(\/pay-with-saved-card|\/wallet-intent)?|payment-methods\/(setup|saved)|account\/purchase-pin)$/;

export async function handleBuy(request: Request, env: Env, path: string, nowMs = Date.now()): Promise<Response | null> {
  if (!PATHS.test(path)) return null;
  const method = request.method;
  let cookies: string[] = [];
  try {
    // Only zaisma.com's own pages ask: another site can't buy, or learn what a player owns, with their cookie.
    if (method !== "GET" && request.headers.get("origin") !== new URL(env.SITE_ORIGIN).origin) return new Response(null, { status: 403 });
    const body = method === "GET" || method === "DELETE" ? {} : await readBody(request);
    const session = await currentSession(request, env).catch(() => null);
    const account = session ? await accountById(env.DB, session.userId) : null;
    if (session) cookies = session.cookies;
    const signed: Signed | null = session && account ? { session, account } : null;

    const start = path.match(/^\/api\/buy\/([a-z0-9-]+)\/start$/);
    if (start && method === "POST") return answer(await startBuying(request, env, start[1]!, body, signed, nowMs), cookies);

    if (!signed) refuse(403, "account_needed", "Make a free account (or sign in) to buy.");
    const { session: signedSession, account: signedAccount } = signed!;
    if (path === "/api/buy/confirm" && method === "POST") {
      const confirmed = await confirmBuying(request, env, signedSession, signedAccount, body, nowMs);
      return answer({ is_confirmed: true }, [...cookies, ...confirmed]);
    }
    const purchase = path.match(/^\/api\/buy\/purchases\/([A-Za-z0-9_-]+)(\/pay-with-saved-card|\/wallet-intent)?$/);
    if (purchase) {
      const sale = await saleById(env, purchase[1]!);
      if (!sale || sale.player_id !== signedAccount.player_id) refuse(404, "no_purchase", "You have no purchase with that ID.");
      if (purchase[2] === "/pay-with-saved-card" && method === "POST") return answer(await payWithSavedCard(request, env, signedSession, signedAccount, sale!, nowMs), cookies);
      if (purchase[2] === "/wallet-intent" && method === "POST") return answer(await walletIntent(env, sale!), cookies);
      if (!purchase[2] && method === "GET") return answer({ purchase: await purchaseAnswer(env, await settle(env, sale!)) }, cookies);
    }
    if (path === "/api/payment-methods/setup" && method === "POST") return answer(await startSavingCard(env, signedSession, signedAccount, body), cookies);
    if (path === "/api/payment-methods/saved" && method === "POST") return answer(await keepCard(env, signedAccount, body, nowMs), cookies);
    if (path === "/api/payment-methods/saved" && method === "DELETE") return answer(await forgetCard(env, signedAccount), cookies);
    if (path === "/api/account/purchase-pin" && method === "PUT") return answer(await setPurchasePin(request, env, signedSession, signedAccount, body), cookies);
    if (path === "/api/account/purchase-pin" && method === "DELETE") {
      await env.DB.prepare("UPDATE accounts SET purchase_pin_hash = NULL, purchase_pin_failed_count = 0 WHERE id = ?").bind(signedAccount.id).run();
      return answer({ has_purchase_pin: false }, cookies);
    }
    return new Response(null, { status: 405 });
  } catch (error) {
    if (error instanceof BuyRefusal) return answer({ error: { code: error.refusal.code, message: error.refusal.message } }, cookies, error.refusal.httpStatus);
    if (error instanceof ApiError) return answer({ error: { code: error.code, message: error.message } }, cookies, error.httpStatus);
    throw error;
  }
}

function answer(body: unknown, cookies: string[], httpStatus = 200): Response {
  const response = Response.json(body, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
  for (const cookie of cookies) response.headers.append("Set-Cookie", cookie);
  return response;
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > MAXIMUM_BODY_SIZE_BYTES) refuse(413, "too_big", "That's more than the sheet ever sends.");
  try {
    const parsed = JSON.parse(text || "{}") as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Answered below.
  }
  return refuse(400, "bad_request", "Send a JSON object.");
}

/** The player's country, from Cloudflare; in the local preview only, preview_country_code stands in for it. */
function countryOf(request: Request, env: Env, body: Record<string, unknown>): string | null {
  const isPreview = new URL(env.SITE_ORIGIN).hostname === "localhost";
  if (isPreview && typeof body.preview_country_code === "string" && /^[A-Z]{2}$/.test(body.preview_country_code)) return body.preview_country_code;
  return request.headers.get("cf-ipcountry");
}

/** Whether this session confirmed a buy in the last 15 minutes. */
async function isConfirmedHere(env: Env, session: Session, accountId: string, nowMs: number): Promise<boolean> {
  if (!session.sessionId) return false;
  const row = await env.DB.prepare("SELECT confirmed_at_ms FROM purchase_confirmations WHERE session_id = ? AND account_id = ?").bind(session.sessionId, accountId).first<{ confirmed_at_ms: number }>();
  return Boolean(row && nowMs - row.confirmed_at_ms < CONFIRMATION_DURATION_MS);
}

interface SavedCard {
  stripe_payment_method_id: string;
  card_brand: string;
  card_last_digits: string;
  receipt_email: string;
}

const savedCardOf = (env: Env, accountId: string) =>
  env.DB.prepare("SELECT stripe_payment_method_id, card_brand, card_last_digits, receipt_email FROM saved_payment_methods WHERE account_id = ?").bind(accountId).first<SavedCard>();

/**
 * Opens the sheet: checks the item can be bought by this player, makes a pending purchase at the price for their
 * country, and answers everything the sheet shows. The checks go in the order a player meets them: a game they can't
 * play, an item with no price, a developer who can't sell yet, then a guest, an owned item and too many buys.
 */
async function startBuying(request: Request, env: Env, slug: string, body: Record<string, unknown>, signed: Signed | null, nowMs: number) {
  const game = await gameBySlug(env.DB, slug);
  if (!game || !(await isOpenHere(env, game, body.tester_token))) return refuse(404, "no_game", "There's no game here by that name.");
  const itemName = body.item_name;
  const gameItem = typeof itemName === "string" ? await itemByName(env.DB, game.id, itemName) : null;
  if (!gameItem) return refuse(404, "no_item", `${game.title} has no item named ${JSON.stringify(itemName)}.`);
  const quantity = body.quantity ?? 1;
  if (!Number.isInteger(quantity) || (quantity as number) < 1 || (quantity as number) > ITEM_LIMITS.maximumGrantItemCount || (gameItem.item_kind === "permanent" && quantity !== 1)) {
    return refuse(400, "bad_item_count", `quantity is a whole number from 1 to ${ITEM_LIMITS.maximumGrantItemCount}, and 1 for a permanent item.`);
  }
  const gameAccountId = body.game_account_id ?? null;
  if (gameAccountId !== null && (typeof gameAccountId !== "string" || gameAccountId.length > 200)) return refuse(400, "bad_game_account_id", "game_account_id is text of up to 200 characters, or null.");
  const countryCode = countryOf(request, env, body);
  const price = priceFor(gameItem, countryCode);
  if (!price) return refuse(409, "not_for_sale", `${gameItem.title} can't be bought: it has no price.`);
  const seller = game.owner_id ? await stripeAccountRow(env, game.owner_id) : null;
  if (!seller?.stripe_account_id) return refuse(409, "stripe_not_connected", "This item can't be bought right now.");
  if (!seller.can_take_stripe_payments) return refuse(409, "stripe_cannot_take_payments", "This item can't be bought right now.");
  if (!signed) return refuse(403, "account_needed", "Make a free account (or sign in) to buy.");
  const { session, account } = signed;
  if (gameItem.item_kind === "permanent" && (await owningPurchaseOf(env.DB, game.id, account.player_id, gameItem.item_name))) return refuse(409, "already_owned", `You already own ${gameItem.title}.`);
  if (env.PURCHASE_LIMIT && !(await env.PURCHASE_LIMIT.limit({ key: account.id })).success) return refuse(429, "slow_down", "That's a lot of buying in a minute. Try again in a minute.");

  const isEuWithdrawalLineShown = isWithdrawalLineShownFor(countryCode);
  const itemCount = quantity as number;
  const purchaseId = await recordPendingSale(
    env,
    { gameId: game.id, playerId: account.player_id, gameItem, itemCount, gameAccountId: gameAccountId as string | null, priceMinorUnits: price.priceMinorUnits, currencyCode: price.currencyCode, stripeAccountId: seller.stripe_account_id, isEuWithdrawalLineShown },
    nowMs,
  );
  const [card, passkeys] = await Promise.all([savedCardOf(env, account.id), passkeysFor(env.DB, account.id)]);
  const totalMinorUnits = price.priceMinorUnits * itemCount;
  return {
    purchase_id: purchaseId,
    item: { item_name: gameItem.item_name, title: gameItem.title, description: gameItem.description, item_kind: gameItem.item_kind, item_category: gameItem.item_category },
    quantity: itemCount,
    price: { currency_code: price.currencyCode, price_minor_units: totalMinorUnits, price_text: priceText(price.currencyCode, totalMinorUnits) },
    seller: { business_name: seller.stripe_business_name ?? game.title, support_email: seller.stripe_support_email },
    refund_policy: purchaseSettingsOf(game).refund_policy,
    refund_policy_words: refundPolicyWords(purchaseSettingsOf(game)),
    is_eu_withdrawal_line_shown: isEuWithdrawalLineShown,
    saved_card: card ? { card_brand: card.card_brand, card_last_digits: card.card_last_digits } : null,
    is_confirmation_needed: !(await isConfirmedHere(env, session, account.id, nowMs)),
    confirmation_methods: {
      has_passkey: passkeys.length > 0,
      has_purchase_pin: Boolean((account as Account & { purchase_pin_hash?: string | null }).purchase_pin_hash),
      has_password: account.password_changed_at_ms !== null,
      is_purchase_pin_locked: ((account as Account & { purchase_pin_failed_count?: number }).purchase_pin_failed_count ?? 0) >= PURCHASE_PIN_LIMITS.maximumFailedTryCount,
    },
    wallet: env.STRIPE_PUBLISHABLE_KEY ? { publishable_key: env.STRIPE_PUBLISHABLE_KEY, stripe_account_id: seller.stripe_account_id } : null,
  };
}

/** The account's PIN columns, which Account leaves out. */
const pinOf = (env: Env, accountId: string) =>
  env.DB.prepare("SELECT purchase_pin_hash, purchase_pin_failed_count FROM accounts WHERE id = ?").bind(accountId).first<{ purchase_pin_hash: string | null; purchase_pin_failed_count: number }>();

/**
 * Confirms saved-card buys on this device for 15 minutes, with a passkey, the purchase PIN or the password. A wrong
 * PIN counts toward 5; at 5 the PIN is refused until a password confirm resets the count. Answers cookies to set.
 */
async function confirmBuying(request: Request, env: Env, session: Session, account: Account, body: Record<string, unknown>, nowMs: number): Promise<string[]> {
  const given = ["passkey_tap", "purchase_pin", "password"].filter((name) => body[name] !== undefined);
  if (given.length !== 1) return refuse(400, "bad_request", "Send one of passkey_tap, purchase_pin or password.");
  let confirmedSession = session;
  let cookies: string[] = [];
  let method: "passkey" | "purchase_pin" | "password";

  if (body.passkey_tap !== undefined) {
    const passkey = await checkPasskeyTap(request, env, account.id, "purchase", body.passkey_tap as PasskeyTap, nowMs);
    cookies = [usedChallengeCookie(env)];
    if (!passkey) return refuse(403, "wrong_passkey", "That passkey didn't work here. Try again, or use your purchase PIN or password.");
    method = "passkey";
  } else if (body.purchase_pin !== undefined) {
    const pin = await pinOf(env, account.id);
    if (!pin?.purchase_pin_hash) return refuse(409, "no_purchase_pin", "You haven't set a purchase PIN. Use your passkey or password.");
    if (pin.purchase_pin_failed_count >= PURCHASE_PIN_LIMITS.maximumFailedTryCount) return refuse(403, "purchase_pin_locked", "Too many wrong PINs. Use your password once, and the PIN works again.");
    if (typeof body.purchase_pin !== "string" || !(await isPurchasePin(body.purchase_pin, pin.purchase_pin_hash))) {
      const counted = await env.DB.prepare("UPDATE accounts SET purchase_pin_failed_count = purchase_pin_failed_count + 1 WHERE id = ? RETURNING purchase_pin_failed_count").bind(account.id).first<{ purchase_pin_failed_count: number }>();
      const left = PURCHASE_PIN_LIMITS.maximumFailedTryCount - (counted?.purchase_pin_failed_count ?? PURCHASE_PIN_LIMITS.maximumFailedTryCount);
      return left > 0 ? refuse(403, "wrong_purchase_pin", `That PIN isn't right. ${left} ${left === 1 ? "try" : "tries"} left.`) : refuse(403, "purchase_pin_locked", "Too many wrong PINs. Use your password once, and the PIN works again.");
    }
    await env.DB.prepare("UPDATE accounts SET purchase_pin_failed_count = 0 WHERE id = ?").bind(account.id).run();
    method = "purchase_pin";
  } else {
    const signedIn = await tryPassword(request, env, account, typeof body.password === "string" ? body.password : "", { turnstileToken: null, knownEmail: null });
    if (signedIn === "wrong" || signedIn === "no-password") return refuse(403, "wrong_password", "That password isn't right.");
    if (signedIn === "locked" || signedIn === "too-many" || signedIn === "bot-check-failed") return refuse(429, "slow_down", "Too many tries. Wait a minute, or use your passkey.");
    if (signedIn === "failed") return refuse(502, "password_check_failed", "Couldn't check your password just now. Try again in a minute.");
    // The password signs in again: the 15 minutes go on that session, whose cookies replace this one's.
    confirmedSession = signedIn;
    cookies = sessionCookies(env, signedIn);
    await env.DB.prepare("UPDATE accounts SET purchase_pin_failed_count = 0 WHERE id = ?").bind(account.id).run();
    method = "password";
  }
  if (!confirmedSession.sessionId) return refuse(409, "session_needed", "Sign in again to buy here.");
  await env.DB.prepare(
    "INSERT INTO purchase_confirmations (session_id, account_id, confirmation_method, confirmed_at_ms) VALUES (?, ?, ?, ?) ON CONFLICT (session_id) DO UPDATE SET account_id = excluded.account_id, confirmation_method = excluded.confirmation_method, confirmed_at_ms = excluded.confirmed_at_ms",
  )
    .bind(confirmedSession.sessionId, account.id, method, nowMs)
    .run();
  return cookies;
}

async function pendingCheck(sale: Sale): Promise<void> {
  if (sale.purchase_status === "completed") refuse(409, "already_paid", "This purchase is paid already.");
  if (sale.purchase_status !== "pending") refuse(409, "purchase_closed", "This purchase is over. Start again from the game.");
  if (sale.stripe_payment_intent_id) refuse(409, "already_paying", "This purchase is being paid already.");
}

/**
 * Pays with the saved card: needs a confirm on this device in the last 15 minutes. The card is cloned onto the
 * developer's account for this purchase only, and charged once (its idempotency key is the purchase's ID).
 */
async function payWithSavedCard(request: Request, env: Env, session: Session, account: Account, sale: Sale, nowMs: number) {
  await pendingCheck(sale);
  if (!(await isConfirmedHere(env, session, account.id, nowMs))) return refuse(403, "purchase_confirmation_needed", "Confirm it's you first, with your passkey, purchase PIN or password.");
  const card = await savedCardOf(env, account.id);
  if (!card) return refuse(409, "no_saved_card", "You have no saved card. Add one, or pay with Apple Pay or Google Pay.");
  const customer = await playerCustomerFor(env, account.id);
  const stripeAccountId = sale.stripe_account_id!;
  const clone = await clonePaymentMethod(env, card.stripe_payment_method_id, customer, stripeAccountId, sale.id);
  const taxCalculationId = await taxCalculationFor(request, env, sale);
  let paymentIntent;
  try {
    paymentIntent = await chargeOnAccount(env, {
      stripeAccountId,
      amountMinorUnits: sale.paid_minor_units!,
      currencyCode: sale.currency_code!,
      purchaseId: sale.id,
      gameSlug: (await env.DB.prepare("SELECT slug FROM games WHERE id = ?").bind(sale.game_id).first<{ slug: string }>())?.slug ?? "",
      playerId: sale.player_id,
      description: sale.item_name,
      taxCalculationId,
      paymentMethodId: clone,
    });
  } catch (error) {
    // A refused charge can't be tried again on this purchase (its idempotency key gives the same answer), so it fails.
    if (!(error instanceof StripeRefusal)) throw error;
    await failPurchase(env, sale.id);
    return refuse(402, "payment_declined", `The card didn't go through: ${error.stripeMessage} Try another card, or Apple Pay or Google Pay.`);
  }
  await notePayment(env, sale.id, { paymentIntentId: paymentIntent.id, receiptEmail: card.receipt_email, taxCalculationId });
  const noted: Sale = { ...sale, stripe_payment_intent_id: paymentIntent.id, receipt_email: card.receipt_email, stripe_tax_calculation_id: taxCalculationId };
  if (paymentIntent.status === "succeeded") return { status: "completed", purchase: await purchaseAnswer(env, await completePurchase(env, noted, paymentIntent, nowMs)) };
  if (paymentIntent.status === "requires_action") return { status: "action_needed", client_secret: paymentIntent.client_secret, stripe_account_id: stripeAccountId, purchase: purchaseJson(noted, null) };
  await failPurchase(env, sale.id);
  return refuse(402, "payment_declined", "The card was declined. Try another card, or Apple Pay or Google Pay.");
}

/** With Stripe Tax on, the tax inside the price; a calculation Stripe can't make never stops the sale (the price doesn't change). */
async function taxCalculationFor(request: Request, env: Env, sale: Sale): Promise<string | null> {
  const owner = await env.DB.prepare("SELECT is_stripe_tax_used FROM owners WHERE stripe_account_id = ?").bind(sale.stripe_account_id).first<{ is_stripe_tax_used: number }>();
  if (!owner?.is_stripe_tax_used) return null;
  try {
    return await taxCalculation(env, { stripeAccountId: sale.stripe_account_id!, amountMinorUnits: sale.paid_minor_units!, currencyCode: sale.currency_code!, itemName: sale.item_name, ipAddress: request.headers.get("cf-connecting-ip") ?? "" });
  } catch (error) {
    console.error(`Stripe Tax couldn't calculate ${sale.id}:`, error);
    return null;
  }
}

/** A payment for Apple Pay or Google Pay to finish on the developer's account. */
async function walletIntent(env: Env, sale: Sale) {
  await pendingCheck(sale);
  const gameSlug = (await env.DB.prepare("SELECT slug FROM games WHERE id = ?").bind(sale.game_id).first<{ slug: string }>())?.slug ?? "";
  const paymentIntent = await walletIntentOnAccount(env, { stripeAccountId: sale.stripe_account_id!, amountMinorUnits: sale.paid_minor_units!, currencyCode: sale.currency_code!, purchaseId: sale.id, gameSlug, playerId: sale.player_id, description: sale.item_name, taxCalculationId: null });
  await notePayment(env, sale.id, { paymentIntentId: paymentIntent.id, receiptEmail: null, taxCalculationId: null });
  return { client_secret: paymentIntent.client_secret, stripe_account_id: sale.stripe_account_id };
}

/** A pending sale as Stripe has it now: the sheet's fast path, so it never waits on Stripe's event. */
async function settle(env: Env, sale: Sale): Promise<Sale> {
  if (sale.purchase_status !== "pending" || !sale.stripe_payment_intent_id) return sale;
  const paymentIntent = await paymentIntentOnAccount(env, sale.stripe_account_id!, sale.stripe_payment_intent_id);
  if (paymentIntent.status === "succeeded") return completePurchase(env, sale, paymentIntent);
  if (paymentIntent.status === "canceled" || (paymentIntent.status === "requires_payment_method" && paymentIntent.last_payment_error)) {
    await failPurchase(env, sale.id);
    return { ...sale, purchase_status: "failed" };
  }
  return sale;
}

/** What the sheet hears about a purchase, as the developer API says it: a bought one with its receipt, for the game to pass to its server. */
async function purchaseAnswer(env: Env, sale: Sale) {
  const game = await gameById(env.DB, sale.game_id);
  if (game) {
    try {
      return (await withReceipts(env, game, [sale]))[0]!;
    } catch (error) {
      // The purchase stands without one: the game's next pass owns it, and get_purchase signs it later.
      console.error(`Couldn't sign the receipt for ${sale.id}:`, error);
    }
  }
  return purchaseJson(sale, null);
}

/** Saving a card asks for the email its receipts go to; an account with neither a passkey nor an email must protect itself first. */
async function startSavingCard(env: Env, session: Session, account: Account, body: Record<string, unknown>) {
  const email = realEmail(session.email);
  const passkeys = await passkeysFor(env.DB, account.id);
  if (!email && !passkeys.length) return refuse(409, "account_protection_needed", "Add a passkey or an email to your account first, so nobody else can spend with your card.");
  const receiptEmail = body.receipt_email ?? email;
  if (typeof receiptEmail !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(receiptEmail) || receiptEmail.length > 254) return refuse(400, "bad_receipt_email", "receipt_email is the email your receipts go to, like alex@example.com.");
  const setup = await setUpCard(env, account.id);
  return { setup_intent_id: setup.setupIntentId, client_secret: setup.clientSecret, receipt_email: receiptEmail };
}

/** Keeps the card a finished setup saved, replacing any card before it. */
async function keepCard(env: Env, account: Account, body: Record<string, unknown>, nowMs: number) {
  if (typeof body.setup_intent_id !== "string" || typeof body.receipt_email !== "string") return refuse(400, "bad_request", "Send setup_intent_id and receipt_email.");
  const customer = await playerCustomerFor(env, account.id);
  const card = await cardOfSetup(env, body.setup_intent_id, customer);
  if (!card) return refuse(409, "card_not_saved", "Stripe didn't save that card. Try again.");
  const before = await savedCardOf(env, account.id);
  await env.DB.prepare(
    "INSERT INTO saved_payment_methods (account_id, stripe_payment_method_id, card_brand, card_last_digits, receipt_email, created_at_ms) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (account_id) DO UPDATE SET stripe_payment_method_id = excluded.stripe_payment_method_id, card_brand = excluded.card_brand, card_last_digits = excluded.card_last_digits, receipt_email = excluded.receipt_email, created_at_ms = excluded.created_at_ms",
  )
    .bind(account.id, card.paymentMethodId, card.cardBrand, card.cardLastDigits, body.receipt_email, nowMs)
    .run();
  if (before && before.stripe_payment_method_id !== card.paymentMethodId) await removeCard(env, before.stripe_payment_method_id);
  return { saved_card: { card_brand: card.cardBrand, card_last_digits: card.cardLastDigits, receipt_email: body.receipt_email } };
}

async function forgetCard(env: Env, account: Account) {
  const card = await savedCardOf(env, account.id);
  if (card) {
    await removeCard(env, card.stripe_payment_method_id);
    await env.DB.prepare("DELETE FROM saved_payment_methods WHERE account_id = ?").bind(account.id).run();
  }
  return { saved_card: null };
}

/** A deleted account's saved card goes from Stripe too (deleteAccount deletes the row); a Stripe that can't be reached doesn't stop the deletion. */
export async function forgetCardForDeletion(env: Env, accountId: string): Promise<void> {
  const card = await savedCardOf(env, accountId);
  if (card) await removeCard(env, card.stripe_payment_method_id).catch((error) => console.error(`Couldn't remove ${accountId}'s card at Stripe:`, error));
}

/** Sets the purchase PIN: needs the password, and a passkey or email on the account, so someone with only the session can't set one and spend. */
async function setPurchasePin(request: Request, env: Env, session: Session, account: Account, body: Record<string, unknown>) {
  const problem = purchasePinProblem(body.purchase_pin);
  if (problem) return refuse(400, "bad_purchase_pin", problem);
  if (!realEmail(session.email) && !(await passkeysFor(env.DB, account.id)).length) return refuse(409, "account_protection_needed", "Add a passkey or an email to your account first.");
  const signedIn = await tryPassword(request, env, account, typeof body.password === "string" ? body.password : "", { turnstileToken: null, knownEmail: null });
  if (signedIn === "no-password") return refuse(409, "password_needed", "Add a password to your account first: a PIN is set with it.");
  if (signedIn === "wrong") return refuse(403, "wrong_password", "That password isn't right.");
  if (typeof signedIn === "string") return refuse(429, "slow_down", "Too many tries. Wait a minute.");
  await env.DB.prepare("UPDATE accounts SET purchase_pin_hash = ?, purchase_pin_failed_count = 0 WHERE id = ?").bind(await hashPurchasePin(body.purchase_pin as string), account.id).run();
  return { has_purchase_pin: true };
}

/**
 * The daily step: pending sales older than a day fail, so an abandoned sheet leaves nothing that could complete
 * later by surprise. A payment Stripe did take completes instead; any other is cancelled at Stripe first. Buy
 * confirms older than a day and connection links past their time go too.
 */
export async function failStaleSales(env: Env, nowMs = Date.now()): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM purchase_confirmations WHERE confirmed_at_ms <= ?").bind(nowMs - 86_400_000),
    env.DB.prepare("DELETE FROM stripe_connect_states WHERE expires_at_ms <= ?").bind(nowMs),
  ]);
  for (const sale of await staleSales(env, nowMs)) {
    try {
      if (sale.stripe_payment_intent_id) {
        const paymentIntent = await paymentIntentOnAccount(env, sale.stripe_account_id!, sale.stripe_payment_intent_id);
        if (paymentIntent.status === "succeeded") {
          await completePurchase(env, sale, paymentIntent, nowMs);
          continue;
        }
        await cancelPaymentOnAccount(env, sale.stripe_account_id!, sale.stripe_payment_intent_id);
      }
      await failPurchase(env, sale.id);
    } catch (error) {
      console.error(`Couldn't close the pending sale ${sale.id}:`, error);
    }
  }
}
