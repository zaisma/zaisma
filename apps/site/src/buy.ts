import {
  ApiError,
  ITEM_LIMITS,
  PURCHASE_PIN_LIMITS,
  accountById,
  approximateUsdMinorUnits,
  countryName,
  gameById,
  gameBySlug,
  hashPurchasePin,
  isBlockedInCountry,
  isPurchasePin,
  isWithdrawalLineShownFor,
  isOldEnoughFor,
  itemByName,
  ownServerUrlsOf,
  owningPurchaseOf,
  passkeysFor,
  priceFor,
  priceText,
  purchasePinProblem,
  purchaseSettingsOf,
  redirectUrlsOf,
  refundPolicyWords,
  signInAppsFor,
  type Account,
} from "@zaisma/core";
import { tryPassword } from "./account.ts";
import { currentSession, realEmail, sessionCookies, type Session } from "./auth.ts";
import { BUY_SHEET_SCRIPT, STRIPE_FRAME_SCRIPT, buySheet, buySheetData, buySheetStripe } from "./buy-sheet.ts";
import { isOpenHere } from "./game-links.ts";
import { glassMessage, html, layout, pageData, scriptTags, securityHeaders, STRIPE_SCRIPT_TAG } from "./html.ts";
import { viewerOf } from "./viewer.ts";
import { PASSKEY_SCRIPT } from "./passkeys.ts";
import { purchaseJson, withReceipts } from "./items-api.ts";
import { checkPasskeyTap, usedChallengeCookie, type PasskeyTap } from "./passkeys.ts";
import { completePurchase, failPurchase, failStaleSalesWithoutPayment, notePayment, recordPendingSale, saleById, STALE_SALE_COUNT, staleSales, type Sale } from "./sales.ts";
import { stripeAccountRow } from "./stripe-account-api.ts";
import {
  StripeRefusal,
  cardOfSetup,
  cancelPaymentOnAccount,
  chargeOnAccount,
  clonePaymentMethod,
  isLocalPreview,
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
 *   POST   /api/buy/:slug/start                           { item_name, item_count, game_account_id, tester_token } → the sheet
 *   POST   /api/buy/confirm                               { passkey_tap | purchase_pin | password }: confirms it's them, when the sheet asked
 *   POST   /api/buy/purchases/:purchase_id/pay-with-saved-card  → completed, or action_needed (3-D Secure)
 *   POST   /api/buy/purchases/:purchase_id/wallet-intent  → what Apple Pay or Google Pay pays
 *   GET    /api/buy/purchases/:purchase_id                the purchase, asking Stripe while it's pending
 *   POST   /api/payment-methods/setup                     → a card setup (receipts go to the account's email)
 *   POST   /api/payment-methods/saved                     { setup_intent_id }: keeps the card
 *   DELETE /api/payment-methods/saved                     forgets it
 *   PUT    /api/account/purchase-pin                      { purchase_pin, password }
 *   DELETE /api/account/purchase-pin
 *
 * Pressing Buy is the confirmation. A saved-card buy asks the player to confirm it's them (confirmation_reason on the
 * sheet's answer) only when:
 *   purchase_pin  the account has a purchase PIN: every buy asks, like a lock on a shared computer. The confirm covers
 *                 one buy: the pay call uses it up. It is good for 15 minutes unused, so none is left lying about.
 *   old_sign_in   they last signed in over 30 days ago on this session (signedInAtMs; 0 when unknown).
 *   big_spend     this buy would take the last 24 hours of buying past USD 100.00 (about: purchases are priced in
 *                 their currency, counted at APPROXIMATE_USD_PER_CURRENCY_UNIT). Abandoned sheets don't count: a
 *                 pending sale counts once its payment has started.
 * The last two last 15 minutes (purchase_confirmations, on the session), so they're per device, end at sign-out, and
 * the player isn't asked twice in a row. The pay call applies the same rule: the sheet is never trusted. Apple Pay
 * and Google Pay skip Zaisma's confirm (the wallet asks for Face ID or a fingerprint itself), and so does a new card
 * typed into Stripe's form.
 */

const CONFIRMATION_DURATION_MS = PURCHASE_PIN_LIMITS.confirmationDurationMin * 60_000;
const SIGN_IN_MAXIMUM_AGE_MS = PURCHASE_PIN_LIMITS.signInMaximumAgeDays * 86_400_000;
const SPEND_PERIOD_MS = 86_400_000;
const MAXIMUM_BODY_SIZE_BYTES = 8192;

type Refusal = { httpStatus: number; code: string; message: string; fix?: string };
class BuyRefusal extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.message);
  }
}
const refuse = (httpStatus: number, code: string, message: string, fix?: string): never => {
  throw new BuyRefusal({ httpStatus, code, message, ...(fix ? { fix } : {}) });
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
      if (purchase[2] === "/pay-with-saved-card" && method === "POST") {
        await checkPurchaseLimit(env, `pay:${signedAccount.id}`);
        return answer(await payWithSavedCard(request, env, signedSession, signedAccount, sale!, body, nowMs), cookies);
      }
      if (purchase[2] === "/wallet-intent" && method === "POST") {
        await checkPurchaseLimit(env, `wallet:${signedAccount.id}`);
        return answer(await walletIntent(request, env, sale!, body), cookies);
      }
      if (!purchase[2] && method === "GET") {
        await checkPurchaseLimit(env, `poll:${signedAccount.id}`);
        return answer({ purchase: await purchaseAnswer(env, await settle(env, sale!)) }, cookies);
      }
    }
    if (path === "/api/payment-methods/setup" && method === "POST") {
      await checkPurchaseLimit(env, `card:${signedAccount.id}`);
      return answer(await startSavingCard(env, signedSession, signedAccount), cookies);
    }
    if (path === "/api/payment-methods/saved" && method === "POST") {
      await checkPurchaseLimit(env, `card:${signedAccount.id}`);
      return answer(await keepCard(env, signedAccount, body, nowMs), cookies);
    }
    if (path === "/api/payment-methods/saved" && method === "DELETE") {
      await checkPurchaseLimit(env, `card:${signedAccount.id}`);
      return answer(await forgetCard(env, signedAccount), cookies);
    }
    if (path === "/api/account/purchase-pin" && method === "PUT") return answer(await setPurchasePin(request, env, signedSession, signedAccount, body), cookies);
    if (path === "/api/account/purchase-pin" && method === "DELETE") {
      await env.DB.prepare("UPDATE accounts SET purchase_pin_hash = NULL, purchase_pin_failed_count = 0 WHERE id = ?").bind(signedAccount.id).run();
      return answer({ has_purchase_pin: false }, cookies);
    }
    return new Response(null, { status: 405 });
  } catch (error) {
    if (error instanceof BuyRefusal) return answer({ error: { code: error.refusal.code, message: error.refusal.message, ...(error.refusal.fix ? { fix: error.refusal.fix } : {}) } }, cookies, error.refusal.httpStatus);
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

/** Refuses with slow_down when this key has used its 20 calls a minute (PURCHASE_LIMIT): every call that reaches Stripe counts, each kind apart, so a loop of any one can't use up the platform key's Stripe rate limit. */
async function checkPurchaseLimit(env: Env, key: string): Promise<void> {
  if (env.PURCHASE_LIMIT && !(await env.PURCHASE_LIMIT.limit({ key })).success) refuse(429, "slow_down", "That's a lot of buying in a minute. Try again in a minute.");
}

/** The player's country, from Cloudflare; in the local preview only, preview_country_code stands in for it. */
function countryOf(request: Request, env: Env, body: Record<string, unknown>): string | null {
  if (isLocalPreview(env) && typeof body.preview_country_code === "string" && /^[A-Z]{2}$/.test(body.preview_country_code)) return body.preview_country_code;
  return request.headers.get("cf-ipcountry");
}

/** Refuses, as the game's page does (451), when the game is blocked in the player's country: a sale left pending is checked again before it is paid. */
function refuseIfBlocked(game: Parameters<typeof isBlockedInCountry>[0], countryCode: string | null): void {
  if (isBlockedInCountry(game, countryCode)) refuse(451, "game_unavailable", `A legal notice under your country's law (${countryName(countryCode!)}) blocks this game here. It's still available everywhere else.`);
}

/** Whether this session confirmed a buy in the last 15 minutes (and, for a purchase PIN account, hasn't spent it on a buy yet). */
async function isConfirmedHere(env: Env, session: Session, accountId: string, nowMs: number): Promise<boolean> {
  if (!session.sessionId) return false;
  const row = await env.DB.prepare("SELECT confirmed_at_ms FROM purchase_confirmations WHERE session_id = ? AND account_id = ?").bind(session.sessionId, accountId).first<{ confirmed_at_ms: number }>();
  return Boolean(row && nowMs - row.confirmed_at_ms < CONFIRMATION_DURATION_MS);
}

/** Why a saved-card buy asks the player to confirm it's them: the sheet's confirmation_reason. */
type ConfirmationReason = "purchase_pin" | "old_sign_in" | "big_spend";

/**
 * About how much the player's buying in the last 24 hours comes to, in US cents, with the sale being bought now:
 * completed sales, and pending ones whose payment has started (an abandoned sheet is not spending). Other sales of this
 * one aren't counted twice. A currency Zaisma has no rate for counts as past any limit.
 */
async function spendInLastDayUsdMinorUnits(env: Env, playerId: string, sale: { id: string; currencyCode: string; paidMinorUnits: number }, nowMs: number): Promise<number> {
  const { results } = await env.DB.prepare(
    "SELECT currency_code, SUM(paid_minor_units) AS paid_minor_units FROM purchases WHERE player_id = ? AND purchase_source = 'sale' AND id != ? AND created_at_ms > ? AND (purchase_status = 'completed' OR (purchase_status = 'pending' AND stripe_payment_intent_id IS NOT NULL)) GROUP BY currency_code",
  )
    .bind(playerId, sale.id, nowMs - SPEND_PERIOD_MS)
    .all<{ currency_code: string | null; paid_minor_units: number | null }>();
  let spendUsdMinorUnits = approximateUsdMinorUnits(sale.currencyCode, sale.paidMinorUnits) ?? Infinity;
  for (const row of results) spendUsdMinorUnits += row.currency_code === null ? 0 : (approximateUsdMinorUnits(row.currency_code, row.paid_minor_units ?? 0) ?? Infinity);
  return spendUsdMinorUnits;
}

/**
 * The one rule for a saved-card buy, for the sheet's answer and for the pay call alike: why the player must confirm
 * it's them first (a purchase PIN on the account, then a sign-in over 30 days old, then a day's buying past USD 100.00),
 * or null when pressing Buy is enough, or when they already confirmed here (see the comment at the top).
 */
async function confirmationReasonFor(env: Env, session: Session, account: Account, hasPurchasePin: boolean, sale: { id: string; currencyCode: string; paidMinorUnits: number }, nowMs: number): Promise<ConfirmationReason | null> {
  let reason: ConfirmationReason | null = null;
  if (hasPurchasePin) reason = "purchase_pin";
  else if (session.signedInAtMs === 0 || nowMs - session.signedInAtMs > SIGN_IN_MAXIMUM_AGE_MS) reason = "old_sign_in";
  else if ((await spendInLastDayUsdMinorUnits(env, account.player_id, sale, nowMs)) > PURCHASE_PIN_LIMITS.dailySpendLimitUsdMinorUnits) reason = "big_spend";
  if (reason && (await isConfirmedHere(env, session, account.id, nowMs))) return null;
  return reason;
}

/** What the pay call says when it refuses for a missing confirm: why, and how to confirm. */
function confirmationNeededMessage(reason: ConfirmationReason): string {
  if (reason === "purchase_pin") return "Your account has a purchase PIN, so every buy needs it. Confirm it's you first, with your purchase PIN, passkey or password.";
  if (reason === "old_sign_in") return `You last signed in more than ${PURCHASE_PIN_LIMITS.signInMaximumAgeDays} days ago. Confirm it's you first, with your passkey or password.`;
  return `This buy would take your buying in the last 24 hours past USD ${(PURCHASE_PIN_LIMITS.dailySpendLimitUsdMinorUnits / 100).toFixed(2)}. Confirm it's you first, with your passkey or password.`;
}

interface SavedCard {
  stripe_payment_method_id: string;
  card_brand: string;
  card_last_digits: string;
}

const savedCardOf = (env: Env, accountId: string) =>
  env.DB.prepare("SELECT stripe_payment_method_id, card_brand, card_last_digits FROM saved_payment_methods WHERE account_id = ?").bind(accountId).first<SavedCard>();

/**
 * Opens the sheet: checks the item can be bought by this player, makes a pending purchase at the price for their
 * country, and answers everything the sheet shows. The checks go in the order a player meets them: a game they can't
 * play, an item with no price, a developer who can't sell yet, then a guest, an owned item and too many buys.
 */
async function startBuying(request: Request, env: Env, slug: string, body: Record<string, unknown>, signed: Signed | null, nowMs: number) {
  const game = await gameBySlug(env.DB, slug);
  if (!game || !(await isOpenHere(env, game, body.tester_token))) return refuse(404, "no_game", "There's no game here by that name.", "Check the slug: list_games shows the developer's games.");
  const countryCode = countryOf(request, env, body);
  refuseIfBlocked(game, countryCode);
  // A game for older players turns younger accounts away from buying too, as it does from playing (plays.ts, ageRefusal).
  if (signed && !isOldEnoughFor(signed.account.age_band, game.minimum_player_age_years)) return refuse(403, "game_not_open_to_player", "This game isn't open to your account.");
  const itemName = body.item_name;
  const gameItem = typeof itemName === "string" ? await itemByName(env.DB, game.id, itemName) : null;
  if (!gameItem) return refuse(404, "no_item", `${game.title} has no item named ${JSON.stringify(itemName)}.`, "list_items names the game's items; set_item adds one.");
  const requestedItemCount = body.item_count ?? 1;
  if (!Number.isInteger(requestedItemCount) || (requestedItemCount as number) < 1 || (requestedItemCount as number) > ITEM_LIMITS.maximumGrantItemCount || (gameItem.item_kind === "permanent" && requestedItemCount !== 1)) {
    return refuse(400, "bad_item_count", `item_count is a whole number from 1 to ${ITEM_LIMITS.maximumGrantItemCount}, and 1 for a permanent item.`);
  }
  const gameAccountId = body.game_account_id ?? null;
  if (gameAccountId !== null && (typeof gameAccountId !== "string" || gameAccountId.length > 200)) return refuse(400, "bad_game_account_id", "game_account_id is text of up to 200 characters, or null.");
  const price = priceFor(gameItem, countryCode);
  if (!price) return refuse(409, "not_for_sale", `${gameItem.title} can't be bought: it has no price.`, "set_item with price_minor_units and currency_code puts it on sale.");
  const seller = game.owner_id ? await stripeAccountRow(env, game.owner_id) : null;
  if (!seller?.stripe_account_id) return refuse(409, "stripe_not_connected", "The developer hasn't connected a Stripe account, so nothing can be sold yet.", "get_stripe_account shows where the account stands; connect_stripe_account gives the link the developer connects on.");
  if (!seller.can_take_stripe_payments) return refuse(409, "stripe_cannot_take_payments", "The developer's Stripe account is connected, but Stripe hasn't turned on payments for it yet.", "Finish setting up the account on Stripe's dashboard; get_stripe_account shows can_take_payments true once it's ready.");
  if (!signed) return refuse(403, "account_needed", "Make a free account (or sign in) to buy.");
  const { session, account } = signed;
  if (gameItem.item_kind === "permanent" && (await owningPurchaseOf(env.DB, game.id, account.player_id, gameItem.item_name))) return refuse(409, "already_owned", `You already own ${gameItem.title}.`);
  if (env.PURCHASE_LIMIT && !(await env.PURCHASE_LIMIT.limit({ key: account.id })).success) return refuse(429, "slow_down", "That's a lot of buying in a minute. Try again in a minute.");

  const itemCount = requestedItemCount as number;
  const totalMinorUnits = price.priceMinorUnits * itemCount;
  if (totalMinorUnits > ITEM_LIMITS.maximumPriceMinorUnits) {
    return refuse(400, "bad_item_count", `${itemCount} of ${gameItem.title} come to more than Stripe takes in one payment. Buy fewer at a time.`);
  }
  const isEuWithdrawalLineShown = isWithdrawalLineShownFor(countryCode);
  const purchaseId = await recordPendingSale(
    env,
    { gameId: game.id, playerId: account.player_id, gameItem, itemCount, gameAccountId: gameAccountId as string | null, priceMinorUnits: price.priceMinorUnits, currencyCode: price.currencyCode, stripeAccountId: seller.stripe_account_id, isEuWithdrawalLineShown },
    nowMs,
  );
  const [card, passkeys, pin] = await Promise.all([savedCardOf(env, account.id), passkeysFor(env.DB, account.id), pinOf(env, account.id)]);
  const confirmationReason = await confirmationReasonFor(env, session, account, Boolean(pin?.purchase_pin_hash), { id: purchaseId, currencyCode: price.currencyCode, paidMinorUnits: totalMinorUnits }, nowMs);
  return {
    purchase_id: purchaseId,
    item: { item_name: gameItem.item_name, title: gameItem.title, description: gameItem.description, item_kind: gameItem.item_kind, item_category: gameItem.item_category },
    item_count: itemCount,
    price: { currency_code: price.currencyCode, price_minor_units: totalMinorUnits, price_text: priceText(price.currencyCode, totalMinorUnits) },
    seller: { business_name: seller.stripe_business_name ?? game.title, support_email: seller.stripe_support_email },
    refund_policy: purchaseSettingsOf(game).refund_policy,
    refund_policy_words: refundPolicyWords(purchaseSettingsOf(game)),
    is_eu_withdrawal_line_shown: isEuWithdrawalLineShown,
    saved_card: card ? { card_brand: card.card_brand, card_last_digits: card.card_last_digits } : null,
    // A saved card's receipt goes to the account's email; the sheet says where, or that there's none to send it to.
    has_account_email: realEmail(session.email) !== null,
    is_confirmation_needed: confirmationReason !== null,
    confirmation_reason: confirmationReason,
    confirmation_methods: {
      has_passkey: passkeys.length > 0,
      has_purchase_pin: Boolean(pin?.purchase_pin_hash),
      has_password: account.password_changed_at_ms !== null,
      is_purchase_pin_locked: (pin?.purchase_pin_failed_count ?? 0) >= PURCHASE_PIN_LIMITS.maximumFailedTryCount,
    },
    wallet: env.STRIPE_PUBLISHABLE_KEY ? { publishable_key: env.STRIPE_PUBLISHABLE_KEY, stripe_account_id: seller.stripe_account_id } : null,
  };
}

/** The account's PIN columns, which Account leaves out. */
const pinOf = (env: Env, accountId: string) =>
  env.DB.prepare("SELECT purchase_pin_hash, purchase_pin_failed_count FROM accounts WHERE id = ?").bind(accountId).first<{ purchase_pin_hash: string | null; purchase_pin_failed_count: number }>();

/**
 * Confirms it's the player, with a passkey, the purchase PIN or the password, when the sheet's confirmation_reason asked
 * (confirmationReasonFor). The confirm is kept on this device for 15 minutes: it covers every buy in them for an old
 * sign-in or a big spend, and exactly one buy for a purchase PIN account (the pay call uses it up). A wrong PIN counts
 * toward 5; at 5 the PIN is refused until a password confirm resets the count. Answers cookies to set.
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
    // The try is taken before the PIN is checked, in one statement: the slow check can't let a hundred parallel guesses all pass a lock that only counts misses afterwards.
    const taken = await env.DB.prepare("UPDATE accounts SET purchase_pin_failed_count = purchase_pin_failed_count + 1 WHERE id = ? AND purchase_pin_failed_count < ? RETURNING purchase_pin_failed_count")
      .bind(account.id, PURCHASE_PIN_LIMITS.maximumFailedTryCount)
      .first<{ purchase_pin_failed_count: number }>();
    if (!taken) return refuse(403, "purchase_pin_locked", "Too many wrong PINs. Use your password once, and the PIN works again.");
    if (typeof body.purchase_pin !== "string" || !(await isPurchasePin(body.purchase_pin, pin.purchase_pin_hash))) {
      const triesLeftCount = PURCHASE_PIN_LIMITS.maximumFailedTryCount - taken.purchase_pin_failed_count;
      return triesLeftCount > 0 ? refuse(403, "wrong_purchase_pin", `That PIN isn't right. ${triesLeftCount} ${triesLeftCount === 1 ? "try" : "tries"} left.`) : refuse(403, "purchase_pin_locked", "Too many wrong PINs. Use your password once, and the PIN works again.");
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
 * Pays with the saved card. Applies the sheet's rule itself (confirmationReasonFor): a purchase PIN account needs a
 * confirm on this device for this buy, which is used up here; an old sign-in or a big spend needs one in the last 15
 * minutes; otherwise pressing Buy is enough. The card is cloned onto the developer's account for this purchase only,
 * and charged once (its idempotency key is the purchase's ID).
 */
async function payWithSavedCard(request: Request, env: Env, session: Session, account: Account, sale: Sale, body: Record<string, unknown>, nowMs: number) {
  await pendingCheck(sale);
  await refuseIfSaleBlocked(env, request, body, sale);
  const hasPurchasePin = Boolean((await pinOf(env, account.id))?.purchase_pin_hash);
  const confirmationReason = await confirmationReasonFor(env, session, account, hasPurchasePin, { id: sale.id, currencyCode: sale.currency_code!, paidMinorUnits: sale.paid_minor_units! }, nowMs);
  if (confirmationReason) return refuse(403, "purchase_confirmation_needed", confirmationNeededMessage(confirmationReason));
  const card = await savedCardOf(env, account.id);
  if (!card) return refuse(409, "no_saved_card", "You have no saved card. Add one, or pay with Apple Pay or Google Pay.");
  if (hasPurchasePin) {
    // One confirm, one buy: taken in one statement, so two pay calls at once can't both spend it.
    const taken = await env.DB.prepare("DELETE FROM purchase_confirmations WHERE session_id = ? AND account_id = ? AND confirmed_at_ms > ?").bind(session.sessionId, account.id, nowMs - CONFIRMATION_DURATION_MS).run();
    if (!taken.meta.changes) return refuse(403, "purchase_confirmation_needed", confirmationNeededMessage("purchase_pin"));
  }
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
    // A card Stripe refused can't be tried again on this purchase (its idempotency key gives the same answer), so it fails.
    // Anything else (Stripe down, a rate limit, a bad call) says stripe_unavailable and leaves the sale pending, so trying again is safe.
    if (!(error instanceof StripeRefusal) || error.stripeErrorKind !== "card_error") throw error;
    await failPurchase(env, sale.id);
    return refuse(402, "payment_declined", `The card didn't go through: ${error.stripeMessage} Try another card, or Apple Pay or Google Pay.`);
  }
  // The receipt goes to the account's email as it is now; an account with none gets no receipt email.
  const receiptEmail = realEmail(session.email);
  await notePayment(env, sale.id, { paymentIntentId: paymentIntent.id, receiptEmail, taxCalculationId });
  const noted: Sale = { ...sale, stripe_payment_intent_id: paymentIntent.id, receipt_email: receiptEmail, stripe_tax_calculation_id: taxCalculationId };
  if (paymentIntent.status === "succeeded") return { status: "completed", purchase: await purchaseAnswer(env, await completePurchase(env, noted, paymentIntent, nowMs)) };
  if (paymentIntent.status === "requires_action") return { status: "action_needed", client_secret: paymentIntent.client_secret, stripe_account_id: stripeAccountId, purchase: purchaseJson(noted, null) };
  await failPurchase(env, sale.id);
  return refuse(402, "payment_declined", "The card was declined. Try another card, or Apple Pay or Google Pay.");
}

/** A sale can sit pending while a notice blocks its game in the player's country: it isn't paid there. */
async function refuseIfSaleBlocked(env: Env, request: Request, body: Record<string, unknown>, sale: Sale): Promise<void> {
  const game = await gameById(env.DB, sale.game_id);
  if (game) refuseIfBlocked(game, countryOf(request, env, body));
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
async function walletIntent(request: Request, env: Env, sale: Sale, body: Record<string, unknown>) {
  await pendingCheck(sale);
  await refuseIfSaleBlocked(env, request, body, sale);
  const gameSlug = (await env.DB.prepare("SELECT slug FROM games WHERE id = ?").bind(sale.game_id).first<{ slug: string }>())?.slug ?? "";
  const taxCalculationId = await taxCalculationFor(request, env, sale);
  const paymentIntent = await walletIntentOnAccount(env, { stripeAccountId: sale.stripe_account_id!, amountMinorUnits: sale.paid_minor_units!, currencyCode: sale.currency_code!, purchaseId: sale.id, gameSlug, playerId: sale.player_id, description: sale.item_name, taxCalculationId });
  await notePayment(env, sale.id, { paymentIntentId: paymentIntent.id, receiptEmail: null, taxCalculationId });
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

/** Saving a card: an account with neither a passkey nor an email must protect itself first. Its receipts go to the account's email. */
async function startSavingCard(env: Env, session: Session, account: Account) {
  const passkeys = await passkeysFor(env.DB, account.id);
  if (!realEmail(session.email) && !passkeys.length) return refuse(409, "account_protection_needed", "Add a passkey or an email to your account first, so nobody else can spend with your card.");
  const setup = await setUpCard(env, account.id);
  return { setup_intent_id: setup.setupIntentId, client_secret: setup.clientSecret };
}

/** Keeps the card a finished setup saved, replacing any card before it. */
async function keepCard(env: Env, account: Account, body: Record<string, unknown>, nowMs: number) {
  if (typeof body.setup_intent_id !== "string") return refuse(400, "bad_request", "Send setup_intent_id.");
  const customer = await playerCustomerFor(env, account.id);
  const card = await cardOfSetup(env, body.setup_intent_id, customer);
  if (!card) return refuse(409, "card_not_saved", "Stripe didn't save that card. Try again.");
  const before = await savedCardOf(env, account.id);
  await env.DB.prepare(
    "INSERT INTO saved_payment_methods (account_id, stripe_payment_method_id, card_brand, card_last_digits, created_at_ms) VALUES (?, ?, ?, ?, ?) ON CONFLICT (account_id) DO UPDATE SET stripe_payment_method_id = excluded.stripe_payment_method_id, card_brand = excluded.card_brand, card_last_digits = excluded.card_last_digits, created_at_ms = excluded.created_at_ms",
  )
    .bind(account.id, card.paymentMethodId, card.cardBrand, card.cardLastDigits, nowMs)
    .run();
  if (before && before.stripe_payment_method_id !== card.paymentMethodId) await removeCard(env, before.stripe_payment_method_id);
  return { saved_card: { card_brand: card.cardBrand, card_last_digits: card.cardLastDigits } };
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
  // Sheets opened and never paid have no PaymentIntent at Stripe: one statement fails them all, however many.
  await failStaleSalesWithoutPayment(env, nowMs);
  // The rest are asked about at most 10 batches of STALE_SALE_COUNT a run, oldest first, each batch after the last; a sale that stays pending (Stripe down) is left for tomorrow and never asked twice today.
  let after: { createdAtMs: number; id: string } | null = null;
  for (let batchIndex = 0; batchIndex < 10; batchIndex++) {
    const sales = await staleSales(env, nowMs, after);
    for (const sale of sales) {
      try {
        if (!(await isStripeAccountConnected(env, sale.stripe_account_id!))) {
          // The developer disconnected: Stripe can't be asked about it any more, and a sale nobody can finish must not stay pending for ever.
          await failPurchase(env, sale.id);
          continue;
        }
        const paymentIntent = await paymentIntentOnAccount(env, sale.stripe_account_id!, sale.stripe_payment_intent_id!);
        if (paymentIntent.status === "succeeded") {
          await completePurchase(env, sale, paymentIntent, nowMs);
          continue;
        }
        await cancelPaymentOnAccount(env, sale.stripe_account_id!, sale.stripe_payment_intent_id!);
        await failPurchase(env, sale.id);
      } catch (error) {
        // Access Stripe took away, or a payment it no longer has, can't be cancelled ever: the sale fails anyway.
        if (error instanceof StripeRefusal && (error.stripeCode === "account_invalid" || error.stripeCode === "resource_missing")) await failPurchase(env, sale.id).catch(() => undefined);
        console.error(`Couldn't close the pending sale ${sale.id}:`, error);
      }
    }
    if (sales.length < STALE_SALE_COUNT) return;
    const last = sales[sales.length - 1]!;
    after = { createdAtMs: last.created_at_ms, id: last.id };
  }
}

/** Whether some developer still has this Stripe account connected. */
async function isStripeAccountConnected(env: Env, stripeAccountId: string): Promise<boolean> {
  return (await env.DB.prepare("SELECT 1 AS is_connected FROM owners WHERE stripe_account_id = ?").bind(stripeAccountId).first()) !== null;
}

/**
 * zaisma.com/buy/<slug>/<item_name>: the buy sheet alone in a window, for a game on its own site (the SDK opens it with item_count,
 * request_number and game_account_id). It answers the page that opened it only at an origin the developer already registered: one of the
 * game's own servers (https) or a redirect address of one of their sign-in apps. That origin comes from the opener's address (Referer) and
 * rides along as opener_origin through a guest's sign-in; postMessage delivers only to a window at that origin, so no other site hears it.
 * With none, the purchase still completes and the game sees it in its next pass.
 */
export async function buyWindowPage(env: Env, request: Request, slug: string, itemName: string): Promise<Response> {
  const url = new URL(request.url);
  const game = await gameBySlug(env.DB, slug);
  if (!game || !(await isOpenHere(env, game, undefined))) return glassMessage(env, "Game not found", "Check the link and try again.", 404);
  // Blocked in the player's country on a notice under its law, as the game's page is (pages.ts): no sheet there either.
  const countryCode = countryOf(request, env, { preview_country_code: url.searchParams.get("preview_country") });
  if (isBlockedInCountry(game, countryCode)) return glassMessage(env, "This game isn't available in your country", `A legal notice under your country's law (${countryName(countryCode!)}) blocks it here. It's still available everywhere else.`, 451);
  // The same turning away as startBuying: a signed-in account too young for the game doesn't get its sheet.
  const viewer = game.minimum_player_age_years > 13 ? await viewerOf(request, env) : null;
  if (viewer?.account && !isOldEnoughFor(viewer.account.age_band, game.minimum_player_age_years)) return glassMessage(env, "Not open to your account", "This game isn't open to your account.", 403);
  const wholeNumber = (text: string | null) => (text !== null && /^\d{1,9}$/.test(text) ? Number(text) : 0);
  const itemCount = url.searchParams.has("item_count") ? wholeNumber(url.searchParams.get("item_count")) : 1;
  const given = url.searchParams.get("opener_origin") ?? originOf(request.headers.get("referer"));
  const openerOrigin = given && (await openerOriginsOf(env, game)).includes(given) ? given : null;
  const query = new URLSearchParams(url.searchParams);
  if (openerOrigin) query.set("opener_origin", openerOrigin);
  const here = `/buy/${game.slug}/${encodeURIComponent(itemName)}?${query}`;
  // The game's own cover across the sheet's top, as on its page.
  const cover = await env.DB.prepare("SELECT id FROM game_images WHERE game_id = ? AND kind = 'cover' AND review_status = 'approved' ORDER BY created_at_ms DESC LIMIT 1").bind(game.id).first<{ id: string }>();
  return layout(env, {
    title: `Buy from ${game.title} · Zaisma`,
    checkedPage: "Buy window",
    pageShape: "reading",
    isBare: true,
    isPrivate: true,
    hasStripeFrame: true,
    body: html`${buySheet({ joinHref: `/join?next=${encodeURIComponent(here)}`, signInHref: `/signin?next=${encodeURIComponent(here)}`, coverUrl: cover ? `/img/${cover.id}` : null })}
${buySheetData({
      slug: game.slug,
      tester_token: null,
      place: "window",
      ...buySheetStripe(env),
      asked: { item_name: itemName, item_count: itemCount, game_account_id: url.searchParams.get("game_account_id"), request_number: wholeNumber(url.searchParams.get("request_number")) },
      opener_origin: openerOrigin,
      opened_item_name: null,
    })}
${scriptTags(PASSKEY_SCRIPT, BUY_SHEET_SCRIPT)}`,
  });
}

/**
 * zaisma.com/buy/stripe-frame: the one place Stripe.js loads, inside the buy sheet's Stripe frames (components/stripe-frame.ts), so the
 * pages around the sheet keep a script-src of their own. Only zaisma.com may frame it; it holds nothing but Stripe's parts, see-through
 * over the sheet's glass, and nothing about the player until the sheet asks.
 */
export function stripeFramePage(env: Env): Response {
  const stripePublishableKey = buySheetStripe(env).stripe_publishable_key;
  const body = html`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Stripe</title></head>
<body style="margin:0;background:transparent;overflow:hidden"><div id="stripe-mount"></div>
${pageData("stripe-frame-data", { stripe_publishable_key: stripePublishableKey })}
${STRIPE_SCRIPT_TAG}
${scriptTags(STRIPE_FRAME_SCRIPT)}
</body>
</html>`;
  return new Response(body.html, { headers: securityHeaders(env, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }, false, [], [], "'self'", true) });
}

function originOf(address: string | null): string | null {
  try {
    return address ? new URL(address).origin : null;
  } catch {
    return null;
  }
}

/** The origins the buy window may answer: the game's own servers' hosts on https (wss://play.example.com is https://play.example.com), and its developer's sign-in apps' redirect addresses. */
async function openerOriginsOf(env: Env, game: { owner_id: string | null; own_server_urls: string }): Promise<string[]> {
  const servers = ownServerUrlsOf(game).filter((server) => /^(https|wss):\/\//.test(server)).map((server) => server.replace(/^wss:/, "https:"));
  const apps = game.owner_id ? await signInAppsFor(env.DB, game.owner_id) : [];
  return [...servers, ...apps.flatMap(redirectUrlsOf)].map(originOf).filter((origin): origin is string => origin !== null && origin !== "null");
}
