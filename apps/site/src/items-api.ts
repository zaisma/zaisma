import {
  ApiError,
  ITEM_FIELDS,
  ITEM_LIMITS,
  PURCHASE_SOURCES,
  PURCHASE_STATUSES,
  cardFeeNote,
  checkIdKind,
  checkItem,
  checkItemName,
  checkPurchaseSettings,
  finishHandling,
  finishRefundHandling,
  iso,
  isIdOf,
  ownServerUrlsOf,
  itemByName,
  itemsOf,
  newGrant,
  ownedItemNames,
  owningPurchaseOf,
  purchaseById,
  purchaseLabelOf,
  purchaseSettingsOf,
  purchasesOf,
  receiptClaimsFor,
  recordGrant,
  takeBack,
  unhandledFor,
  type Game,
  type GameItem,
  type Purchase,
  type PurchaseSource,
  type PurchaseStatus,
} from "@zaisma/core";
import type { Caller, CheckedCall, NextStep } from "./developer.ts";
import { noteRefund, saleById } from "./sales.ts";
import { refundOnAccount } from "./stripe.ts";
import { stripeAccountRow } from "./stripe-account-api.ts";
import type { Env } from "./env.ts";
import { logCallerEvent } from "./security-log.ts";
import { tellPurchase } from "./webhooks.ts";

/**
 * A game's items and purchases through the developer API (packages/core/src/items.ts): what it sells or
 * grants, its refund policy, grants, and every purchase with its receipt. Grants and refunds of grants work
 * without Stripe, so owned items, receipts and the pass can be tried before anything is connected.
 *
 *   GET    /api/dev/games/:slug/items                       the items, purchase settings and the label they make
 *   PUT    /api/dev/games/:slug/items/:item_name            set one item, whole: { title, description, item_kind, item_category, price_minor_units, currency_code, local_prices }
 *   DELETE /api/dev/games/:slug/items/:item_name            remove one nobody bought or was granted
 *   PATCH  /api/dev/games/:slug/purchase-settings           refund_policy, refund_policy_text, own_payment_categories, purchase_delivery
 *   POST   /api/dev/games/:slug/purchases                   grant an item: { player_id, item_name, item_count, game_account_id }
 *   GET    /api/dev/games/:slug/purchases                   purchases and grants, newest first: ?player_id=&item_name=&purchase_source=&purchase_status=&cursor=
 *   GET    /api/dev/games/:slug/purchases/:purchase_id      one, with its receipt
 *   POST   /api/dev/games/:slug/purchases/:purchase_id/refund   take a grant back (a sale refunds through Stripe, with the buy sheet)
 *   POST   /api/dev/games/:slug/purchases/:purchase_id/handled  your own server took it: a completed one handled, a taken-back one's refund told
 *   GET    /api/dev/games/:slug/players/:player_id/items    the permanent items a player owns, and their purchases still to hand over
 *
 * Every grant and take-back also goes to the developer's webhooks (purchase_completed, purchase_refunded).
 */

const PURCHASE_PAGE_COUNT = 100;

export const itemJson = (gameItem: GameItem) => ({
  item_name: gameItem.item_name,
  title: gameItem.title,
  description: gameItem.description,
  item_kind: gameItem.item_kind,
  item_category: gameItem.item_category,
  price_minor_units: gameItem.price_minor_units,
  currency_code: gameItem.currency_code,
  local_prices: gameItem.local_prices,
  is_on_game_page: gameItem.is_on_game_page,
  card_fee_note: cardFeeNote(gameItem.currency_code, gameItem.price_minor_units),
  created_at: iso(gameItem.created_at_ms),
  updated_at: iso(gameItem.updated_at_ms),
});

export const purchaseJson = (purchase: Purchase, receipt: string | null) => ({
  id: purchase.id,
  item_name: purchase.item_name,
  item_kind: purchase.item_kind,
  item_count: purchase.item_count,
  purchase_source: purchase.purchase_source,
  purchase_status: purchase.purchase_status,
  player_id: purchase.player_id,
  game_account_id: purchase.game_account_id,
  paid_minor_units: purchase.paid_minor_units,
  currency_code: purchase.currency_code,
  refunded_minor_units: purchase.refunded_minor_units,
  purchased_at: purchase.purchased_at_ms === null ? null : iso(purchase.purchased_at_ms),
  refunded_at: purchase.refunded_at_ms === null ? null : iso(purchase.refunded_at_ms),
  handled_at: purchase.handled_at_ms === null ? null : iso(purchase.handled_at_ms),
  refund_handled_at: purchase.refund_handled_at_ms === null ? null : iso(purchase.refund_handled_at_ms),
  receipt,
});

/** Purchases with their receipts: one for each that was bought or granted (pending and failed sales have none), signed in the rooms Worker in one call. */
export async function withReceipts(env: Env, game: Game, purchases: Purchase[]) {
  const signed = purchases.filter((purchase) => purchase.purchase_status !== "pending" && purchase.purchase_status !== "failed");
  const receipts = new Map<string, string>();
  if (signed.length) {
    const unavailable = new ApiError("receipts_unavailable", { message: "Zaisma couldn't sign the receipts just now.", fix: "Try again in a moment; if it keeps happening, tell Zaisma with post_topic (kind bug, category api).", retryAfterSec: 10 });
    if (!env.RECEIPTS) throw new ApiError("receipts_unavailable", { message: "This Zaisma has no receipt signing connected.", fix: "On zaisma.com this doesn't happen; on your own Zaisma, bind the rooms Worker's ReceiptSigningService as RECEIPTS (apps/site/wrangler.jsonc)." });
    const answered = await env.RECEIPTS.signAll(signed.map((purchase) => receiptClaimsFor(purchase, game))).catch((error: unknown) => {
      console.error("Couldn't sign receipts:", error);
      throw unavailable;
    });
    if ("error" in answered) throw unavailable;
    signed.forEach((purchase, i) => receipts.set(purchase.id, answered.receipts[i]!));
  }
  return purchases.map((purchase) => purchaseJson(purchase, receipts.get(purchase.id) ?? null));
}

/** The game's items, settings and label, as GET /items answers them. */
async function itemsAnswer(env: Env, game: Game) {
  const items = await itemsOf(env.DB, game.id);
  const settings = purchaseSettingsOf(game);
  return { items: items.map(itemJson), ...settings, purchase_label: purchaseLabelOf(items, settings.own_payment_categories, game.full_game_item_name) };
}

/** The game's full game item stays permanent and content, and stays, while the game is sold by it (full_game_item_name). */
const fullGameItemInUse = (game: Game, itemName: string, field: string) =>
  new ApiError("full_game_item_in_use", {
    message: `${itemName} is ${game.slug}'s full game: players buy it to play, so it stays a permanent content item.`,
    field,
    fix: `update_game with full_game_item_name null first, to make ${game.slug} free to play; or keep item_kind permanent and item_category content.`,
  });

const noItem = (game: Game, itemName: string) => new ApiError("no_item", { message: `${game.slug} has no item named ${itemName}.`, field: "item_name", fix: "list_items names the game's items; make one with set_item." });

/** Items: list, set one whole, remove one. The router (developer.ts, checkCall) has checked the key, the game and that the body holds only the item's fields. */
export async function itemsRoute(request: Request, env: Env, game: Game, itemName: string | undefined, caller: Caller, checked: CheckedCall): Promise<[unknown, number?]> {
  const method = request.method;
  if (itemName === undefined) return [await itemsAnswer(env, game)];
  checkItemName(itemName);
  const nowMs = Date.now();

  if (method === "PUT") {
    const checkedItem = checkItem(itemName, checked.body);
    if (itemName === game.full_game_item_name && (checkedItem.item_kind !== "permanent" || checkedItem.item_category !== "content")) throw fullGameItemInUse(game, itemName, checkedItem.item_kind !== "permanent" ? "item_kind" : "item_category");
    const existing = await itemByName(env.DB, game.id, itemName);
    const tooManyItems = () => new ApiError("too_many_items", { message: `${game.slug} has ${ITEM_LIMITS.maximumItemCount} items, the most a game can have.`, field: "item_name", fix: "Remove items nobody owns with remove_item, or reuse one: an item is replaced whole by set_item with its name." });
    const refundPolicyNeeded = () =>
      new ApiError("refund_policy_needed", {
        message: `${game.slug} has no refund policy, and a game states one before anything goes on sale.`,
        field: "price_minor_units",
        fix: "Set it with set_purchase_settings (refund_policy no_refunds, unused_within_14_days, within_14_days, or own_words with refund_policy_text), then set the item again. An item with price_minor_units null can be granted without one.",
      });
    if (!existing) {
      const counted = await env.DB.prepare("SELECT COUNT(*) AS item_count FROM game_items WHERE game_id = ?").bind(game.id).first<{ item_count: number }>();
      if ((counted?.item_count ?? 0) >= ITEM_LIMITS.maximumItemCount) throw tooManyItems();
    }
    if (checkedItem.price_minor_units !== null && game.refund_policy === null) throw refundPolicyNeeded();
    // The limit and the refund policy are checked again in the write itself, so items set, or a policy cleared, at the same moment can't get past them.
    const saved = await env.DB.prepare(
      "INSERT INTO game_items (game_id, item_name, title, description, item_kind, item_category, price_minor_units, currency_code, local_prices, is_on_game_page, created_at_ms, updated_at_ms) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?12, ?10, ?10 WHERE (EXISTS (SELECT 1 FROM game_items WHERE game_id = ?1 AND item_name = ?2) OR (SELECT COUNT(*) FROM game_items WHERE game_id = ?1) < ?11) AND (?7 IS NULL OR EXISTS (SELECT 1 FROM games WHERE id = ?1 AND refund_policy IS NOT NULL)) ON CONFLICT (game_id, item_name) DO UPDATE SET title = excluded.title, description = excluded.description, item_kind = excluded.item_kind, item_category = excluded.item_category, price_minor_units = excluded.price_minor_units, currency_code = excluded.currency_code, local_prices = excluded.local_prices, is_on_game_page = excluded.is_on_game_page, updated_at_ms = excluded.updated_at_ms",
    )
      .bind(game.id, itemName, checkedItem.title, checkedItem.description, checkedItem.item_kind, checkedItem.item_category, checkedItem.price_minor_units, checkedItem.currency_code, JSON.stringify(checkedItem.local_prices), nowMs, ITEM_LIMITS.maximumItemCount, checkedItem.is_on_game_page ? 1 : 0)
      .run();
    if (!saved.meta.changes) {
      const policy = await env.DB.prepare("SELECT refund_policy FROM games WHERE id = ?").bind(game.id).first<{ refund_policy: string | null }>();
      throw checkedItem.price_minor_units !== null && !policy?.refund_policy ? refundPolicyNeeded() : tooManyItems();
    }
    await logCallerEvent(env, caller, "item_changed", { gameId: game.id, subjectName: itemName });
    const answered = (await itemByName(env.DB, game.id, itemName))!;
    const nextSteps: NextStep[] = [];
    if (answered.price_minor_units !== null) {
      const seller = game.owner_id ? await stripeAccountRow(env, game.owner_id) : null;
      if (!seller?.stripe_account_id) {
        nextSteps.push({ tool: "get_stripe_account", arguments: {}, after_sec: null, reason: "Players can buy priced items only once the developer connects their Stripe account; until then the buy sheet answers stripe_not_connected. connect_stripe_account gives the link." });
      } else if (seller.can_take_stripe_payments !== 1) {
        nextSteps.push({ tool: "get_stripe_account", arguments: {}, after_sec: null, reason: "The Stripe account is connected, but Stripe hasn't turned on payments for it yet, so the buy sheet answers stripe_cannot_take_payments. Finish setting it up on Stripe's dashboard; get_stripe_account shows can_take_payments true once it's ready." });
      }
    }
    return [{ item: itemJson(answered), next_steps: nextSteps }, existing ? 200 : 201];
  }

  if (method === "DELETE") {
    if (!(await itemByName(env.DB, game.id, itemName))) throw noItem(game, itemName);
    if (itemName === game.full_game_item_name) throw fullGameItemInUse(game, itemName, "item_name");
    const owned = await env.DB.prepare("SELECT COUNT(*) AS purchase_count FROM purchases WHERE game_id = ? AND item_name = ? AND purchase_status = 'completed'").bind(game.id, itemName).first<{ purchase_count: number }>();
    if (owned?.purchase_count) {
      throw new ApiError("item_has_owners", {
        message: `${owned.purchase_count} completed purchases or grants are of ${itemName}, so it stays: players keep what they bought.`,
        field: "item_name",
        fix: "To stop selling it, set_item with price_minor_units and currency_code null and local_prices [].",
      });
    }
    await env.DB.prepare("DELETE FROM game_items WHERE game_id = ? AND item_name = ?").bind(game.id, itemName).run();
    await logCallerEvent(env, caller, "item_removed", { gameId: game.id, subjectName: itemName });
    return [{ removed_item_name: itemName, next_steps: [] satisfies NextStep[] }];
  }

  throw new ApiError("bad_method", { message: `${method} isn't a call at /games/${game.slug}/items/${itemName}.`, fix: `PUT sets the item, whole: { ${ITEM_FIELDS.join(", ")} }; DELETE removes it.` });
}

/** The refund policy and what the game sells through its own payments. */
export async function purchaseSettingsRoute(env: Env, game: Game, caller: Caller, checked: CheckedCall): Promise<[unknown, number?]> {
  const sold = await env.DB.prepare("SELECT 1 AS is_sold FROM game_items WHERE game_id = ? AND price_minor_units IS NOT NULL LIMIT 1").bind(game.id).first();
  const settings = checkPurchaseSettings(checked.body, purchaseSettingsOf(game), sold !== null);
  // game_server needs one to run onPurchase: the sandbox or a built-in one on Zaisma, or the Node runner on the developer's own servers. The relay runs no game code.
  if ("purchase_delivery" in checked.body && settings.purchase_delivery === "game_server" && game.multiplayer_mode !== "own" && game.multiplayer_mode !== "built-in" && !ownServerUrlsOf(game).length) {
    throw new ApiError("no_game_server", {
      message: `${game.slug} has no game server to run onPurchase.`,
      field: "purchase_delivery",
      fix: "Add a game server first (zaisma-server.js with multiplayer_mode own, or your own server's address in own_server_urls), or use game: the game hears Zaisma.items.on(\"purchase\") itself.",
    });
  }
  // A game left with no policy must still sell nothing when it's written, so an item put on sale at the same moment can't get past it.
  const changed = await env.DB.prepare(
    "UPDATE games SET refund_policy = ?1, refund_policy_text = ?2, own_payment_categories = ?3, purchase_delivery = ?6, updated_at_ms = ?4 WHERE id = ?5 AND (?1 IS NOT NULL OR NOT EXISTS (SELECT 1 FROM game_items WHERE game_id = ?5 AND price_minor_units IS NOT NULL))",
  )
    .bind(settings.refund_policy, settings.refund_policy_text, JSON.stringify(settings.own_payment_categories), Date.now(), game.id, settings.purchase_delivery)
    .run();
  // An item went on sale since: checked again as a game that sells, it answers refund_policy_needed.
  if (!changed.meta.changes) checkPurchaseSettings(checked.body, purchaseSettingsOf(game), true);
  await logCallerEvent(env, caller, "purchase_settings_changed", { gameId: game.id });
  const items = await itemsOf(env.DB, game.id);
  return [{ ...settings, purchase_label: purchaseLabelOf(items, settings.own_payment_categories, game.full_game_item_name), next_steps: [] satisfies NextStep[] }];
}

/** An opaque point in the newest-first list of purchases: where the last page ended. */
const purchaseCursorFor = (purchase: Purchase) => `cursor_${purchase.created_at_ms.toString(36)}_${purchase.id.slice("purchase_".length)}`;
function readPurchaseCursor(cursor: string | null): { createdAtMs: number; id: string } | undefined {
  if (cursor === null) return undefined;
  const found = /^cursor_([0-9a-z]{1,12})_([a-z0-9]{1,40})$/.exec(cursor);
  if (!found) throw new ApiError("bad_cursor", { message: `cursor ${JSON.stringify(cursor.slice(0, 60))} isn't a next_cursor Zaisma gave.`, field: "cursor", fix: "Pass the next_cursor from your last answer as it came, or leave cursor out to start from the newest." });
  return { createdAtMs: parseInt(found[1]!, 36), id: `purchase_${found[2]}` };
}

const PLAYER_ID_FIX = "Take player IDs from your game: a room's players, or the sub of a player pass your server checked.";

/** A player ID that's an account's: guests' IDs last only for their pass, and a deleted account has none. */
async function accountPlayerId(env: Env, given: unknown, field: string): Promise<string> {
  checkIdKind("player", given, field, PLAYER_ID_FIX);
  if (!isIdOf("player", given)) throw new ApiError("bad_player_id", { message: `${field} ${JSON.stringify(String(given).slice(0, 50))} isn't a player ID.`, field, fix: PLAYER_ID_FIX });
  const account = await env.DB.prepare("SELECT 1 AS is_account FROM accounts WHERE player_id = ?").bind(given).first();
  if (!account) throw new ApiError("no_player", { message: `No account has the player ID ${given}. Guests can't own items, and a deleted account's are gone.`, field, fix: PLAYER_ID_FIX });
  return given;
}

/** Purchases and grants: list, get one, grant, refund. */
export async function purchasesRoute(request: Request, env: Env, game: Game, purchaseId: string | undefined, purchaseAction: "refund" | "handled" | null, caller: Caller, checked: CheckedCall): Promise<[unknown, number?]> {
  const method = request.method;
  const nowMs = Date.now();

  if (purchaseId === undefined && method === "GET") {
    const query = checked.query;
    const purchaseSource = query.get("purchase_source");
    if (purchaseSource !== null && !(PURCHASE_SOURCES as readonly string[]).includes(purchaseSource)) {
      throw new ApiError("bad_purchase_source", { message: `purchase_source ${JSON.stringify(purchaseSource.slice(0, 20))} isn't sale or grant.`, field: "purchase_source", fix: "sale: bought through the buy sheet. grant: given by you. Leave it out for both." });
    }
    const purchaseStatus = query.get("purchase_status");
    if (purchaseStatus !== null && !(PURCHASE_STATUSES as readonly string[]).includes(purchaseStatus)) {
      throw new ApiError("bad_purchase_status", { message: `purchase_status ${JSON.stringify(purchaseStatus.slice(0, 20))} isn't one of ${PURCHASE_STATUSES.join(", ")}.`, field: "purchase_status", fix: "Leave it out for every status." });
    }
    const playerId = query.get("player_id");
    if (playerId !== null && !isIdOf("player", playerId)) throw new ApiError("bad_player_id", { message: `player_id ${JSON.stringify(String(playerId).slice(0, 50))} isn't a player ID.`, field: "player_id", fix: PLAYER_ID_FIX });
    const itemName = query.get("item_name");
    if (itemName !== null) checkItemName(itemName);
    const purchases = await purchasesOf(
      env.DB,
      game.id,
      { playerId: playerId ?? undefined, itemName: itemName ?? undefined, purchaseSource: (purchaseSource as PurchaseSource | null) ?? undefined, purchaseStatus: (purchaseStatus as PurchaseStatus | null) ?? undefined, before: readPurchaseCursor(query.get("cursor")) },
      PURCHASE_PAGE_COUNT,
    );
    return [{ purchases: await withReceipts(env, game, purchases), next_cursor: purchases.length === PURCHASE_PAGE_COUNT ? purchaseCursorFor(purchases.at(-1)!) : null }];
  }

  if (purchaseId === undefined && method === "POST") {
    const body = checked.body;
    const playerId = await accountPlayerId(env, body.player_id, "player_id");
    const itemName = checkItemName(body.item_name);
    const gameItem = await itemByName(env.DB, game.id, itemName);
    if (!gameItem) throw noItem(game, itemName);
    const itemCount = body.item_count ?? 1;
    if (typeof itemCount !== "number" || !Number.isInteger(itemCount) || itemCount < 1 || itemCount > ITEM_LIMITS.maximumGrantItemCount || (gameItem.item_kind === "permanent" && itemCount !== 1)) {
      throw new ApiError("bad_item_count", {
        message: gameItem.item_kind === "permanent" ? `${itemName} is permanent: a player owns it once.` : `item_count ${JSON.stringify(itemCount)} isn't a whole number from 1 to ${ITEM_LIMITS.maximumGrantItemCount}.`,
        field: "item_count",
        fix: gameItem.item_kind === "permanent" ? "Leave item_count out, or send 1." : `Send how many ${itemName} to give, from 1 to ${ITEM_LIMITS.maximumGrantItemCount}; leave it out for 1.`,
      });
    }
    const gameAccountId = body.game_account_id ?? null;
    if (gameAccountId !== null && (typeof gameAccountId !== "string" || !gameAccountId || gameAccountId.length > ITEM_LIMITS.maximumGameAccountIdCharacterCount)) {
      throw new ApiError("bad_game_account_id", { message: "game_account_id isn't text of up to 200 characters.", field: "game_account_id", fix: "Send your game's own ID for the player's account in your system, as it is, or leave it out." });
    }
    const alreadyOwned = async (owning: Purchase): Promise<[unknown, number?]> => {
      const [purchase] = await withReceipts(env, game, [owning]);
      return [{ purchase, is_already_owned: true, next_steps: [] satisfies NextStep[] }, 200];
    };
    const owning = gameItem.item_kind === "permanent" ? await owningPurchaseOf(env.DB, game.id, playerId, itemName) : null;
    if (owning) return alreadyOwned(owning);
    const grant = newGrant(game, { playerId, gameItem, itemCount, gameAccountId, nowMs });
    // Its receipt is signed before it's recorded: a grant whose receipt can't be signed is never recorded, so trying again can't give the item twice.
    const [purchase] = await withReceipts(env, game, [grant]);
    const granted = await recordGrant(env.DB, grant);
    // Another grant of this permanent item was recorded first: it's the one that owns it.
    if (granted.isAlreadyOwned) return alreadyOwned(granted.purchase);
    await logCallerEvent(env, caller, "purchase_granted", { gameId: game.id, subjectName: itemName });
    await tellPurchase(env, game, purchase!, "purchase_completed", caller.waitUntil);
    return [{ purchase, is_already_owned: false, next_steps: [] satisfies NextStep[] }, 201];
  }

  const purchaseFix = "list_purchases lists the game's purchases and grants with their IDs.";
  checkIdKind("purchase", purchaseId, "purchase_id", purchaseFix);
  const purchase = isIdOf("purchase", purchaseId) ? await purchaseById(env.DB, game.id, purchaseId) : null;
  if (!purchase) throw new ApiError("no_purchase", { message: `${game.slug} has no purchase with the ID ${purchaseId}.`, field: "purchase_id", fix: purchaseFix });

  if (purchaseAction === null && method === "GET") {
    const [answered] = await withReceipts(env, game, [purchase]);
    return [{ purchase: answered }];
  }

  if (purchaseAction === "refund" && method === "POST") {
    const alreadyRefunded = (takenBack: Purchase) =>
      new ApiError("already_refunded", { message: `${takenBack.id} was ${takenBack.purchase_status === "charged_back" ? "charged back" : "refunded"} already.`, field: "purchase_id", fix: "Nothing to do: the player no longer owns it." });
    if (purchase.purchase_status === "refunded" || purchase.purchase_status === "charged_back") throw alreadyRefunded(purchase);
    if (purchase.purchase_source === "sale") return refundSale(env, game, purchase, caller, checked.body.amount_minor_units, nowMs);
    if (checked.body.amount_minor_units !== undefined) {
      throw new ApiError("bad_amount_minor_units", { message: "A grant was free, so it has no amount to refund.", field: "amount_minor_units", fix: "Leave amount_minor_units out to take the grant back." });
    }
    // Another refund took it back since it was read: this one changed nothing.
    if (!(await takeBack(env.DB, purchase.id, "refunded", nowMs))) throw alreadyRefunded((await purchaseById(env.DB, game.id, purchase.id))!);
    await logCallerEvent(env, caller, "purchase_refunded", { gameId: game.id, subjectName: purchase.item_name });
    const [answered] = await withReceipts(env, game, [(await purchaseById(env.DB, game.id, purchase.id))!]);
    await tellPurchase(env, game, answered!, "purchase_refunded", caller.waitUntil);
    return [{ purchase: answered, next_steps: [] satisfies NextStep[] }];
  }

  // Your own server or script took it: a completed purchase is handled, a taken-back one's refund told. Not the lease rooms use: it marks at once.
  if (purchaseAction === "handled" && method === "POST") {
    if (purchase.purchase_status === "pending" || purchase.purchase_status === "failed") {
      throw new ApiError("no_purchase", { message: `${purchase.id} wasn't bought: it's ${purchase.purchase_status}, so there's nothing to hand over.`, field: "purchase_id", fix: "Only completed, refunded and charged-back purchases are handled: list_purchases with purchase_status completed lists them." });
    }
    const isRefund = purchase.purchase_status !== "completed";
    if (!(await (isRefund ? finishRefundHandling : finishHandling)(env.DB, purchase.id, nowMs))) {
      throw new ApiError("already_handled", { message: `${purchase.id} was ${isRefund ? "told it was refunded" : "marked handled"} already.`, field: "purchase_id", fix: "Nothing to do: deliver once per purchase_id, so skip one you've had." });
    }
    const [answered] = await withReceipts(env, game, [(await purchaseById(env.DB, game.id, purchase.id))!]);
    return [{ purchase: answered, next_steps: [] satisfies NextStep[] }];
  }

  throw new ApiError("bad_method", { message: `${method} isn't a call at /games/${game.slug}/purchases/${purchaseId}${purchaseAction ? `/${purchaseAction}` : ""}.`, fix: "GET gets a purchase; POST …/refund refunds a sale or takes a grant back; POST …/handled marks it handled." });
}

/**
 * Refunds a sale through Stripe, on the developer's own account: the rest of it by default, or amount_minor_units of
 * it. A full refund takes the item back now (Stripe's charge.refunded event does the same, once); a partial one is
 * goodwill and leaves it. Two of the same call at once refund once: the idempotency key is the purchase, the amount
 * and what was refunded before.
 */
async function refundSale(env: Env, game: Game, purchase: Purchase, caller: Caller, amount: unknown, nowMs: number): Promise<[unknown, number?]> {
  const sale = (await saleById(env, purchase.id))!;
  if (sale.purchase_status !== "completed" || !sale.stripe_payment_intent_id || !sale.stripe_account_id) {
    throw new ApiError("purchase_not_paid", { message: `${sale.id} wasn't paid, so there's nothing to refund.`, field: "purchase_id", fix: "Only completed sales can be refunded; list_purchases shows each one's purchase_status." });
  }
  // After the developer disconnected Stripe (or removed Zaisma on Stripe's side) Zaisma can't refund for them: Stripe would only say no.
  const seller = game.owner_id ? await stripeAccountRow(env, game.owner_id) : null;
  if (!seller?.stripe_account_id || seller.stripe_account_id !== sale.stripe_account_id) {
    throw new ApiError("stripe_not_connected", {
      message: `${sale.id} was paid to Stripe account ${sale.stripe_account_id}, which isn't connected to Zaisma now, so Zaisma can't refund it.`,
      field: "purchase_id",
      fix: "Refund it in the Stripe dashboard (Payments, then Refund). The player keeps the item here until Stripe's refund event reaches Zaisma, which only happens while the account is connected: connect_stripe_account connects it again.",
    });
  }
  const leftMinorUnits = sale.paid_minor_units! - sale.refunded_minor_units;
  const refundMinorUnits = amount ?? leftMinorUnits;
  if (!Number.isInteger(refundMinorUnits) || (refundMinorUnits as number) < 1 || (refundMinorUnits as number) > leftMinorUnits) {
    throw new ApiError("bad_amount_minor_units", { message: `amount_minor_units is a whole number from 1 to ${leftMinorUnits}, what's left of this sale in ${sale.currency_code!.toUpperCase()} minor units.`, field: "amount_minor_units", fix: `Leave it out to refund all ${leftMinorUnits}, or send less for a partial refund (the player keeps the item).` });
  }
  await refundOnAccount(env, sale.stripe_account_id, sale.stripe_payment_intent_id, refundMinorUnits as number, `refund:${sale.id}:${sale.refunded_minor_units}:${refundMinorUnits}`);
  await noteRefund(env, sale, sale.refunded_minor_units + (refundMinorUnits as number), nowMs);
  await logCallerEvent(env, caller, "purchase_refunded", { gameId: game.id, subjectName: purchase.item_name });
  const [answered] = await withReceipts(env, game, [(await purchaseById(env.DB, game.id, purchase.id))!]);
  return [{ purchase: answered, next_steps: [] satisfies NextStep[] }];
}

/** The permanent items a player owns in the game, as their next pass will list them, and their purchases and refunds still to hand over, oldest first, at most 50. */
export async function playerItemsRoute(env: Env, game: Game, playerId: string): Promise<[unknown, number?]> {
  checkIdKind("player", playerId, "player_id", PLAYER_ID_FIX);
  if (!isIdOf("player", playerId)) throw new ApiError("bad_player_id", { message: `player_id ${JSON.stringify(String(playerId).slice(0, 50))} isn't a player ID.`, field: "player_id", fix: PLAYER_ID_FIX });
  return [{ player_id: playerId, owned_item_names: await ownedItemNames(env.DB, game.id, playerId), unhandled_purchases: await withReceipts(env, game, await unhandledFor(env.DB, game.id, playerId)) }];
}
