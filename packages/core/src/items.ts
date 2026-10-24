import { ApiError } from "./errors.ts";
import { newId } from "./ids.ts";
import { checkShownText } from "./shown-text.ts";
import { checkText } from "./text-filter.ts";

/**
 * What a game sells or grants, and players' purchases and grants of it (docs/DECISIONS.md, "One Zaisma buy
 * sheet; we own the buying experience, not the money"). A game's items are its own, by name (game_items),
 * never Stripe Products: a grant-only item, a game with no Stripe yet and a self-hosted check all need them.
 * Each is permanent (owned for good, on every device) or consumable (delivered once, then the game keeps
 * count), and says what kind of thing it is, so the game page's label comes from the items and can't drift.
 * Ownership is read from purchases, never stored apart, so a refund or chargeback can't leave a stale
 * "owned" row. Every purchase and grant has a receipt, signed like a player pass (receipts.ts).
 */

export const ITEM_KINDS = ["permanent", "consumable"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** What an item is, which the game page's label shows: looks only, help playing, more of the game, or in-game money. */
export const ITEM_CATEGORIES = ["cosmetic", "gameplay", "content", "currency"] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

/** A game's refund policy, stated before anything goes on sale ("Every game that sells something states its refund policy"). */
export const REFUND_POLICIES = ["no_refunds", "unused_within_14_days", "within_14_days", "own_words"] as const;
export type RefundPolicy = (typeof REFUND_POLICIES)[number];

/** A sale is paid through the buy sheet; a grant is the developer giving the item, with no money. */
export const PURCHASE_SOURCES = ["sale", "grant"] as const;
export type PurchaseSource = (typeof PURCHASE_SOURCES)[number];

export const PURCHASE_STATUSES = ["pending", "completed", "failed", "refunded", "charged_back"] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export const ITEM_LIMITS = {
  /** A cosmetics-heavy PC game has hundreds of skins; a pass owning them all fits REQUEST_LIMITS.maximumPassSizeBytes. */
  maximumItemCount: 1000,
  maximumItemNameCharacterCount: 40,
  maximumTitleCharacterCount: 60,
  maximumDescriptionCharacterCount: 300,
  maximumLocalPriceCount: 40,
  maximumRefundPolicyTextCharacterCount: 600,
  maximumGameAccountIdCharacterCount: 200,
  /** How many of a consumable one grant gives. */
  maximumGrantItemCount: 1000,
  /** Stripe takes up to 8 digits of minor units for most payment methods. */
  maximumPriceMinorUnits: 99_999_999,
} as const;

/** The name a game knows an item by, like "revive" or "skin_red-dragon": lowercase letters, digits, underscores and hyphens. */
export const ITEM_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/**
 * Stripe's minimum charge per currency, in minor units (docs.stripe.com/currencies, "Minimum and maximum
 * charge amounts", read Oct 22, 2026). The currencies Zaisma prices in: one not here is unsupported_currency.
 */
export const CURRENCY_MINIMUM_PRICES: Readonly<Record<string, number>> = {
  usd: 50,
  aed: 200,
  ars: 50,
  aud: 50,
  brl: 50,
  cad: 50,
  chf: 50,
  cop: 50,
  czk: 1500,
  dkk: 250,
  eur: 50,
  gbp: 30,
  hkd: 400,
  huf: 17500,
  idr: 50,
  ils: 50,
  inr: 50,
  jpy: 50,
  krw: 50,
  mxn: 1000,
  myr: 200,
  nok: 300,
  nzd: 50,
  php: 50,
  pln: 200,
  ron: 200,
  rub: 50,
  sek: 300,
  sgd: 50,
  thb: 1000,
  zar: 50,
};

/** Currencies Stripe counts in whole units (500 is ¥500), from the same page; every other one here has two decimals. */
export const ZERO_DECIMAL_CURRENCIES: readonly string[] = ["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "vnd", "vuv", "xaf", "xof", "xpf"];

/** The currency a player in each country pays in, for the countries whose currency Zaisma prices in (ISO 3166 codes, as Cloudflare's CF-IPCountry gives them). */
export const COUNTRY_CURRENCIES: Readonly<Record<string, string>> = {
  US: "usd",
  // Places Cloudflare names apart from the United States, and countries that use the US dollar.
  PR: "usd",
  GU: "usd",
  VI: "usd",
  AS: "usd",
  MP: "usd",
  UM: "usd",
  EC: "usd",
  SV: "usd",
  PA: "usd",
  TL: "usd",
  FM: "usd",
  MH: "usd",
  PW: "usd",
  BQ: "usd",
  TC: "usd",
  VG: "usd",
  AE: "aed",
  AR: "ars",
  AU: "aud",
  CX: "aud",
  CC: "aud",
  NF: "aud",
  KI: "aud",
  NR: "aud",
  TV: "aud",
  BR: "brl",
  CA: "cad",
  CH: "chf",
  LI: "chf",
  CO: "cop",
  CZ: "czk",
  DK: "dkk",
  FO: "dkk",
  GL: "dkk",
  GB: "gbp",
  IM: "gbp",
  JE: "gbp",
  GG: "gbp",
  HK: "hkd",
  HU: "huf",
  ID: "idr",
  IL: "ils",
  IN: "inr",
  JP: "jpy",
  KR: "krw",
  MX: "mxn",
  MY: "myr",
  NO: "nok",
  SJ: "nok",
  NZ: "nzd",
  CK: "nzd",
  NU: "nzd",
  PN: "nzd",
  TK: "nzd",
  PH: "php",
  PL: "pln",
  RO: "ron",
  RU: "rub",
  SE: "sek",
  SG: "sgd",
  TH: "thb",
  ZA: "zar",
  // The euro area (Bulgaria since January 1, 2026), the regions of its countries Cloudflare names apart, and the small states that use the euro.
  AT: "eur",
  BE: "eur",
  BG: "eur",
  HR: "eur",
  CY: "eur",
  EE: "eur",
  FI: "eur",
  FR: "eur",
  DE: "eur",
  GR: "eur",
  IE: "eur",
  IT: "eur",
  LV: "eur",
  LT: "eur",
  LU: "eur",
  MT: "eur",
  NL: "eur",
  PT: "eur",
  SK: "eur",
  SI: "eur",
  ES: "eur",
  AX: "eur",
  GF: "eur",
  GP: "eur",
  MQ: "eur",
  RE: "eur",
  YT: "eur",
  PM: "eur",
  BL: "eur",
  MF: "eur",
  AD: "eur",
  MC: "eur",
  SM: "eur",
  VA: "eur",
  ME: "eur",
  XK: "eur",
};

/** The currency a player in this country pays in, or null when Zaisma has none for it. */
export function currencyForCountry(countryCode: string | null | undefined): string | null {
  return countryCode ? (COUNTRY_CURRENCIES[countryCode.toUpperCase()] ?? null) : null;
}

/** A price in another currency than the item's main one. */
export interface LocalPrice {
  currency_code: string;
  price_minor_units: number;
}

/** One item, as the API answers it (but card_fee_note) and game_items stores it (local_prices as JSON). */
export interface GameItem {
  item_name: string;
  title: string;
  description: string;
  item_kind: ItemKind;
  item_category: ItemCategory;
  /** null: only granted, or no longer sold; currency_code is null then too, and local_prices []. */
  price_minor_units: number | null;
  currency_code: string | null;
  local_prices: LocalPrice[];
  created_at_ms: number;
  updated_at_ms: number;
}

type ItemRow = Omit<GameItem, "local_prices"> & { local_prices: string };

const itemOf = (row: ItemRow): GameItem => ({ ...row, local_prices: JSON.parse(row.local_prices || "[]") as LocalPrice[] });

/** A game's items, by name. */
export async function itemsOf(database: D1Database, gameId: string): Promise<GameItem[]> {
  const { results } = await database
    .prepare("SELECT item_name, title, description, item_kind, item_category, price_minor_units, currency_code, local_prices, created_at_ms, updated_at_ms FROM game_items WHERE game_id = ? ORDER BY item_name")
    .bind(gameId)
    .all<ItemRow>();
  return results.map(itemOf);
}

export async function itemByName(database: D1Database, gameId: string, itemName: string): Promise<GameItem | null> {
  const row = await database
    .prepare("SELECT item_name, title, description, item_kind, item_category, price_minor_units, currency_code, local_prices, created_at_ms, updated_at_ms FROM game_items WHERE game_id = ? AND item_name = ?")
    .bind(gameId, itemName)
    .first<ItemRow>();
  return row ? itemOf(row) : null;
}

/**
 * The price a player in this country pays: the item's price in the country's currency when the developer set
 * one, else its main price. Picked by country (CF-IPCountry), never by browser language, so it can't be
 * changed in a setting to shop cheaper. null for an item that isn't sold.
 */
export function priceFor(gameItem: Pick<GameItem, "price_minor_units" | "currency_code" | "local_prices">, countryCode: string | null | undefined): { currencyCode: string; priceMinorUnits: number } | null {
  if (gameItem.price_minor_units === null || gameItem.currency_code === null) return null;
  const currencyCode = currencyForCountry(countryCode);
  const local = currencyCode ? gameItem.local_prices.find((price) => price.currency_code === currencyCode) : undefined;
  return local ? { currencyCode: local.currency_code, priceMinorUnits: local.price_minor_units } : { currencyCode: gameItem.currency_code, priceMinorUnits: gameItem.price_minor_units };
}

/** How many minor units make one of the currency: 1 for zero-decimal currencies, else 100. */
const minorUnitCountPerUnit = (currencyCode: string) => (ZERO_DECIMAL_CURRENCIES.includes(currencyCode) ? 1 : 100);

/** A price as people read it, like "$1.99", "¥300" or "R$ 59,90", in the locale given. */
export function priceText(currencyCode: string, priceMinorUnits: number, locale = "en-US"): string {
  const minorUnitCount = minorUnitCountPerUnit(currencyCode);
  const fractionDigitCount = minorUnitCount === 1 ? 0 : 2;
  return new Intl.NumberFormat(locale, { style: "currency", currency: currencyCode.toUpperCase(), minimumFractionDigits: fractionDigitCount, maximumFractionDigits: fractionDigitCount }).format(priceMinorUnits / minorUnitCount);
}

/** Currencies whose card fee Stripe states as 2.9% + 30 minor units, for the note under cheap prices. */
const CARD_FEE_NOTE_CURRENCIES = ["usd", "eur", "gbp", "cad", "aud"];

/**
 * For a main price under 2 units of a currency with Stripe's 2.9% + 30 card fee, what reaches the developer
 * after it, as a nudge, never a floor: "Of $0.99, about $0.66 reaches you after card fees." null otherwise.
 */
export function cardFeeNote(currencyCode: string | null, priceMinorUnits: number | null): string | null {
  if (currencyCode === null || priceMinorUnits === null || !CARD_FEE_NOTE_CURRENCIES.includes(currencyCode) || priceMinorUnits >= 200) return null;
  const reachingMinorUnits = Math.max(0, Math.round(priceMinorUnits - priceMinorUnits * 0.029 - 30));
  return `Of ${priceText(currencyCode, priceMinorUnits)}, about ${priceText(currencyCode, reachingMinorUnits)} reaches you after card fees.`;
}

/** The fields a whole item takes, besides its name (the path's). */
export const ITEM_FIELDS = ["title", "description", "item_kind", "item_category", "price_minor_units", "currency_code", "local_prices"] as const;

/** An item's fields, checked: everything game_items stores but its times. */
export type CheckedItem = Omit<GameItem, "created_at_ms" | "updated_at_ms">;

const ITEM_FIX = "set_item takes the whole item: { item_name, title, description, item_kind, item_category, price_minor_units, currency_code, local_prices }.";

function badItem(field: string, message: string, fix: string): ApiError {
  return new ApiError("bad_item", { message, field, fix });
}

/** Checks an item's name, as a path part or an input. */
export function checkItemName(itemName: unknown, field = "item_name"): string {
  if (typeof itemName !== "string" || !ITEM_NAME_PATTERN.test(itemName)) {
    throw badItem(field, `${JSON.stringify(typeof itemName === "string" ? itemName.slice(0, 50) : itemName)} isn't an item name.`, 'An item name is 1 to 40 lowercase letters, digits, underscores and hyphens, starting with a letter or digit, like "revive" or "skin_red-dragon". The game uses it in Zaisma.items.owns.');
  }
  return itemName;
}

/** A price in minor units for one currency: a whole number from the currency's minimum to 99,999,999. */
function checkPrice(priceMinorUnits: unknown, currencyCode: unknown, field: string): LocalPrice {
  if (typeof currencyCode !== "string" || !/^[a-z]{3}$/.test(currencyCode)) {
    throw badItem(`${field}currency_code`, `currency_code ${JSON.stringify(currencyCode)} isn't a currency code.`, 'Give the currency as its three-letter ISO 4217 code in lowercase, as Stripe writes it: "usd", "eur", "brl".');
  }
  const minimumMinorUnits = CURRENCY_MINIMUM_PRICES[currencyCode];
  if (minimumMinorUnits === undefined) {
    throw new ApiError("unsupported_currency", { message: `Zaisma doesn't price in ${currencyCode}.`, field: `${field}currency_code`, fix: `Price in one of: ${Object.keys(CURRENCY_MINIMUM_PRICES).join(", ")}.` });
  }
  if (typeof priceMinorUnits !== "number" || !Number.isInteger(priceMinorUnits) || priceMinorUnits < 0 || priceMinorUnits > ITEM_LIMITS.maximumPriceMinorUnits) {
    throw badItem(`${field}price_minor_units`, `price_minor_units ${JSON.stringify(priceMinorUnits)} isn't a whole number of minor units.`, "Give the price in the currency's smallest unit, as a whole number: 199 for $1.99, 5990 for R$59.90, 300 for ¥300.");
  }
  if (priceMinorUnits < minimumMinorUnits) {
    throw new ApiError("price_too_low", { message: `${priceText(currencyCode, priceMinorUnits)} is under ${priceText(currencyCode, minimumMinorUnits)}, the least Stripe charges in ${currencyCode}.`, field: `${field}price_minor_units`, fix: `Price it at ${minimumMinorUnits} minor units or more.` });
  }
  return { currency_code: currencyCode, price_minor_units: priceMinorUnits };
}

/** Checks one whole item, its name from the path, every field given: what set_item stores. */
export function checkItem(itemName: string, input: Record<string, unknown>): CheckedItem {
  checkItemName(itemName);
  for (const field of ITEM_FIELDS) {
    if (!(field in input)) throw new ApiError("missing_field", { message: `${field} wasn't sent.`, field, fix: `${ITEM_FIX} Send null for a price, currency or description you don't set.` });
  }
  const title = checkShownText(input.title, { field: "title", maximumCharacterCount: ITEM_LIMITS.maximumTitleCharacterCount, isRequired: true });
  if ("problem" in title) throw badItem("title", title.problem.message, title.problem.fix);
  const description = checkShownText(input.description ?? "", { field: "description", maximumCharacterCount: ITEM_LIMITS.maximumDescriptionCharacterCount });
  if ("problem" in description) throw badItem("description", description.problem.message, description.problem.fix);
  if (!(ITEM_KINDS as readonly unknown[]).includes(input.item_kind)) {
    throw badItem("item_kind", `item_kind ${JSON.stringify(input.item_kind)} isn't permanent or consumable.`, "permanent: owned for good, on every device (a skin, an expansion). consumable: delivered once, then the game keeps count (a revive, coins).");
  }
  if (!(ITEM_CATEGORIES as readonly unknown[]).includes(input.item_category)) {
    throw badItem("item_category", `item_category ${JSON.stringify(input.item_category)} isn't one of ${ITEM_CATEGORIES.join(", ")}.`, "cosmetic: changes only how things look. gameplay: helps you play (a revive, a boost). content: more of the game (levels, an expansion). currency: in-game money.");
  }
  if (!Array.isArray(input.local_prices) || input.local_prices.length > ITEM_LIMITS.maximumLocalPriceCount) {
    throw badItem("local_prices", "local_prices isn't a list of up to 40 { currency_code, price_minor_units }.", "Send [] for none, or a price for each currency you set one in, like [{ \"currency_code\": \"brl\", \"price_minor_units\": 5990 }].");
  }
  let main: LocalPrice | null = null;
  if (input.price_minor_units === null || input.currency_code === null) {
    if (input.price_minor_units !== null || input.currency_code !== null) {
      throw badItem(input.price_minor_units === null ? "currency_code" : "price_minor_units", "price_minor_units and currency_code go together: both set, or both null.", "Set both for an item that's sold, or both null for one that's only granted or no longer sold.");
    }
    if (input.local_prices.length) throw badItem("local_prices", "An item with no main price has no local prices.", "Set price_minor_units and currency_code first, or send local_prices [].");
  } else {
    main = checkPrice(input.price_minor_units, input.currency_code, "");
  }
  const localPrices: LocalPrice[] = [];
  for (const [i, given] of (input.local_prices as unknown[]).entries()) {
    const field = `local_prices[${i}].`;
    if (!given || typeof given !== "object" || Array.isArray(given) || Object.keys(given).some((key) => key !== "currency_code" && key !== "price_minor_units")) {
      throw badItem(`local_prices[${i}]`, `local_prices[${i}] isn't { currency_code, price_minor_units }.`, "Each local price is { \"currency_code\": \"brl\", \"price_minor_units\": 5990 }, with nothing else.");
    }
    const price = checkPrice((given as LocalPrice).price_minor_units, (given as LocalPrice).currency_code, field);
    if (price.currency_code === main?.currency_code) throw badItem(`${field}currency_code`, `${price.currency_code} is the item's main currency.`, "price_minor_units is the price in currency_code; local_prices are for other currencies only.");
    if (localPrices.some((other) => other.currency_code === price.currency_code)) throw badItem(`${field}currency_code`, `local_prices has ${price.currency_code} twice.`, "Give one price per currency.");
    localPrices.push(price);
  }
  return {
    item_name: itemName,
    title: title.text,
    description: description.text,
    item_kind: input.item_kind as ItemKind,
    item_category: input.item_category as ItemCategory,
    price_minor_units: main?.price_minor_units ?? null,
    currency_code: main?.currency_code ?? null,
    local_prices: localPrices,
  };
}

/** What a game says about what it sells: its refund policy, and what it sells through its own payments. */
export interface PurchaseSettings {
  refund_policy: RefundPolicy | null;
  /** The policy in the developer's own words, with own_words only. */
  refund_policy_text: string | null;
  own_payment_categories: ItemCategory[];
}

export const purchaseSettingsOf = (game: { refund_policy: string | null; refund_policy_text: string | null; own_payment_categories: string }): PurchaseSettings => ({
  refund_policy: game.refund_policy as RefundPolicy | null,
  refund_policy_text: game.refund_policy_text,
  own_payment_categories: JSON.parse(game.own_payment_categories || "[]") as ItemCategory[],
});

/**
 * Checks a change to a game's purchase settings and answers the settings it makes: what's left out stays.
 * refund_policy_text goes with own_words and nothing else, through the filter room names go through. A game
 * that sells anything (an item with a price, or its own payments) keeps a refund policy.
 */
export function checkPurchaseSettings(input: Record<string, unknown>, current: PurchaseSettings, isSelling: boolean): PurchaseSettings {
  const next: PurchaseSettings = { ...current };
  if ("refund_policy" in input) {
    if (input.refund_policy !== null && !(REFUND_POLICIES as readonly unknown[]).includes(input.refund_policy)) {
      throw new ApiError("bad_refund_policy", {
        message: `refund_policy ${JSON.stringify(input.refund_policy)} isn't one of ${REFUND_POLICIES.join(", ")}.`,
        field: "refund_policy",
        fix: "no_refunds, unused_within_14_days (refunds for items not used yet, within 14 days), within_14_days, or own_words with refund_policy_text.",
      });
    }
    next.refund_policy = input.refund_policy as RefundPolicy | null;
    if (next.refund_policy !== "own_words" && !("refund_policy_text" in input)) next.refund_policy_text = null;
  }
  if ("refund_policy_text" in input) {
    if (input.refund_policy_text === null) next.refund_policy_text = null;
    else {
      const checked = checkShownText(input.refund_policy_text, { field: "refund_policy_text", maximumCharacterCount: ITEM_LIMITS.maximumRefundPolicyTextCharacterCount, isRequired: true, isMultiline: true });
      if ("problem" in checked) throw new ApiError("bad_refund_policy_text", { message: checked.problem.message, field: "refund_policy_text", fix: checked.problem.fix });
      if (!checkText(checked.text).isAllowed) {
        throw new ApiError("bad_refund_policy_text", { message: "refund_policy_text has a link, a way to contact someone, or words Zaisma's filter doesn't allow.", field: "refund_policy_text", fix: "Say the policy in plain words; players reach you through the game's registered links." });
      }
      next.refund_policy_text = checked.text;
    }
  }
  if ("own_payment_categories" in input) {
    const given = input.own_payment_categories;
    if (!Array.isArray(given) || given.some((category) => !(ITEM_CATEGORIES as readonly unknown[]).includes(category))) {
      throw new ApiError("bad_own_payment_categories", { message: "own_payment_categories isn't a list of item categories.", field: "own_payment_categories", fix: `Send [] when the game sells nothing through its own payments, or a list of ${ITEM_CATEGORIES.join(", ")}.` });
    }
    next.own_payment_categories = ITEM_CATEGORIES.filter((category) => given.includes(category));
  }
  if (next.refund_policy === "own_words" && !next.refund_policy_text) {
    throw new ApiError("bad_refund_policy_text", { message: "own_words needs the policy in refund_policy_text.", field: "refund_policy_text", fix: "Send refund_policy_text with the policy in your own words, up to 600 characters." });
  }
  if (next.refund_policy !== "own_words" && next.refund_policy_text) {
    throw new ApiError("bad_refund_policy_text", { message: "refund_policy_text goes only with refund_policy own_words.", field: "refund_policy_text", fix: "Leave refund_policy_text out, or set refund_policy own_words." });
  }
  if (next.refund_policy === null && (isSelling || next.own_payment_categories.length)) {
    throw new ApiError("refund_policy_needed", {
      message: "A game that sells anything states its refund policy.",
      field: "refund_policy",
      fix: "Set refund_policy (no_refunds, unused_within_14_days, within_14_days, or own_words with refund_policy_text); to stop selling, take the prices off first (set_item with price_minor_units null) and send own_payment_categories [].",
    });
  }
  return next;
}

/** What a game page says the game sells: the categories of the items it sells (not grant-only ones), plus its own payments', in ITEM_CATEGORIES order. */
export interface PurchaseLabel {
  categories: ItemCategory[];
  has_own_payments: boolean;
}

export function purchaseLabelOf(items: readonly Pick<GameItem, "item_category" | "price_minor_units">[], ownPaymentCategories: readonly ItemCategory[]): PurchaseLabel {
  const sold = new Set<ItemCategory>([...items.filter((gameItem) => gameItem.price_minor_units !== null).map((gameItem) => gameItem.item_category), ...ownPaymentCategories]);
  return { categories: ITEM_CATEGORIES.filter((category) => sold.has(category)), has_own_payments: ownPaymentCategories.length > 0 };
}

/** A game's purchase label from the database: one query for its sold items' categories. */
export async function purchaseLabelFor(database: D1Database, game: { id: string; own_payment_categories: string }): Promise<PurchaseLabel> {
  const { results } = await database.prepare("SELECT DISTINCT item_category, 1 AS price_minor_units FROM game_items WHERE game_id = ? AND price_minor_units IS NOT NULL").bind(game.id).all<{ item_category: ItemCategory; price_minor_units: number }>();
  return purchaseLabelOf(results, purchaseSettingsOf({ refund_policy: null, refund_policy_text: null, own_payment_categories: game.own_payment_categories }).own_payment_categories);
}

/** One purchase or grant, as stored. */
export interface Purchase {
  id: string;
  game_id: string;
  item_name: string;
  item_kind: ItemKind;
  item_count: number;
  player_id: string;
  game_account_id: string | null;
  purchase_source: PurchaseSource;
  purchase_status: PurchaseStatus;
  /** What the purchase paid, in the currency's minor units: null for a grant. An item's own price is its price_minor_units. */
  paid_minor_units: number | null;
  currency_code: string | null;
  refunded_minor_units: number;
  stripe_payment_intent_id: string | null;
  created_at_ms: number;
  purchased_at_ms: number | null;
  refunded_at_ms: number | null;
}

const PURCHASE_COLUMNS = "id, game_id, item_name, item_kind, item_count, player_id, game_account_id, purchase_source, purchase_status, paid_minor_units, currency_code, refunded_minor_units, stripe_payment_intent_id, created_at_ms, purchased_at_ms, refunded_at_ms";

export async function purchaseById(database: D1Database, gameId: string, purchaseId: string): Promise<Purchase | null> {
  return database.prepare(`SELECT ${PURCHASE_COLUMNS} FROM purchases WHERE id = ? AND game_id = ?`).bind(purchaseId, gameId).first<Purchase>();
}

/** A game's purchases, newest first, filtered; a page at a time from before a (created_at_ms, id) point. */
export async function purchasesOf(
  database: D1Database,
  gameId: string,
  filters: { playerId?: string; itemName?: string; purchaseSource?: PurchaseSource; purchaseStatus?: PurchaseStatus; before?: { createdAtMs: number; id: string } },
  pageCount: number,
): Promise<Purchase[]> {
  const where = ["game_id = ?"];
  const values: unknown[] = [gameId];
  if (filters.playerId) (where.push("player_id = ?"), values.push(filters.playerId));
  if (filters.itemName) (where.push("item_name = ?"), values.push(filters.itemName));
  if (filters.purchaseSource) (where.push("purchase_source = ?"), values.push(filters.purchaseSource));
  if (filters.purchaseStatus) (where.push("purchase_status = ?"), values.push(filters.purchaseStatus));
  if (filters.before) (where.push("(created_at_ms < ? OR (created_at_ms = ? AND id < ?))"), values.push(filters.before.createdAtMs, filters.before.createdAtMs, filters.before.id));
  const { results } = await database
    .prepare(`SELECT ${PURCHASE_COLUMNS} FROM purchases WHERE ${where.join(" AND ")} ORDER BY created_at_ms DESC, id DESC LIMIT ?`)
    .bind(...values, pageCount)
    .all<Purchase>();
  return results;
}

/** The permanent items a player owns in a game: a completed sale or grant, not refunded or charged back. */
export async function ownedItemNames(database: D1Database, gameId: string, playerId: string): Promise<string[]> {
  const { results } = await database
    .prepare("SELECT DISTINCT item_name FROM purchases WHERE game_id = ? AND player_id = ? AND item_kind = 'permanent' AND purchase_status = 'completed' ORDER BY item_name")
    .bind(gameId, playerId)
    .all<{ item_name: string }>();
  return results.map((row) => row.item_name);
}

/** The completed purchase or grant through which a player owns a permanent item, or null when they don't own it. */
export async function owningPurchaseOf(database: D1Database, gameId: string, playerId: string, itemName: string): Promise<Purchase | null> {
  return database
    .prepare(`SELECT ${PURCHASE_COLUMNS} FROM purchases WHERE game_id = ? AND player_id = ? AND item_name = ? AND item_kind = 'permanent' AND purchase_status = 'completed' ORDER BY created_at_ms LIMIT 1`)
    .bind(gameId, playerId, itemName)
    .first<Purchase>();
}

/**
 * The developer gives a player an item: a purchase with no money, completed at once, with the same receipt.
 * Not recorded yet: its receipt is signed first, so a grant whose receipt can't be signed is never recorded,
 * and trying again can't give the item twice. recordGrant records it.
 */
export function newGrant(
  game: { id: string },
  grant: { playerId: string; gameItem: Pick<GameItem, "item_name" | "item_kind">; itemCount: number; gameAccountId: string | null; nowMs: number },
): Purchase {
  return {
    id: newId("purchase"),
    game_id: game.id,
    item_name: grant.gameItem.item_name,
    item_kind: grant.gameItem.item_kind,
    item_count: grant.gameItem.item_kind === "permanent" ? 1 : grant.itemCount,
    player_id: grant.playerId,
    game_account_id: grant.gameAccountId,
    purchase_source: "grant",
    purchase_status: "completed",
    paid_minor_units: null,
    currency_code: null,
    refunded_minor_units: 0,
    stripe_payment_intent_id: null,
    created_at_ms: grant.nowMs,
    purchased_at_ms: grant.nowMs,
    refunded_at_ms: null,
  };
}

/**
 * Records a grant (newGrant). A player owns a permanent item through one completed purchase
 * (purchases_one_owner), so when they already own it, nothing is recorded and the purchase that owns it
 * answers, with isAlreadyOwned: of two grants of it at once, the one recorded second finds the first.
 */
export async function recordGrant(database: D1Database, grant: Purchase): Promise<{ purchase: Purchase; isAlreadyOwned: boolean }> {
  const recorded = await database
    .prepare("INSERT INTO purchases (id, game_id, item_name, item_kind, item_count, player_id, game_account_id, purchase_source, purchase_status, created_at_ms, purchased_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, 'grant', 'completed', ?, ?) ON CONFLICT DO NOTHING")
    .bind(grant.id, grant.game_id, grant.item_name, grant.item_kind, grant.item_count, grant.player_id, grant.game_account_id, grant.created_at_ms, grant.purchased_at_ms)
    .run();
  if (recorded.meta.changes > 0) return { purchase: grant, isAlreadyOwned: false };
  const owning = await owningPurchaseOf(database, grant.game_id, grant.player_id, grant.item_name);
  if (!owning) throw new Error(`The grant ${grant.id} of ${grant.item_name} wasn't recorded, and no purchase owns it.`);
  return { purchase: owning, isAlreadyOwned: true };
}

/** Takes a completed purchase or grant back: refunded (the developer's call) or charged_back (the card's). False when it wasn't completed. */
export async function takeBack(database: D1Database, purchaseId: string, purchaseStatus: "refunded" | "charged_back", nowMs: number): Promise<boolean> {
  const changed = await database
    .prepare("UPDATE purchases SET purchase_status = ?, refunded_minor_units = COALESCE(paid_minor_units, 0), refunded_at_ms = ? WHERE id = ? AND purchase_status = 'completed'")
    .bind(purchaseStatus, nowMs, purchaseId)
    .run();
  return changed.meta.changes > 0;
}

/** A game's refund policy in players' words, for the buy sheet, the game page and receipts. Null when it states none. */
export function refundPolicyWords(game: { refund_policy: RefundPolicy | null; refund_policy_text: string | null }): string | null {
  if (game.refund_policy === "no_refunds") return "No refunds.";
  if (game.refund_policy === "unused_within_14_days") return "Refunds for items you haven't used yet, within 14 days.";
  if (game.refund_policy === "within_14_days") return "Refunds within 14 days.";
  if (game.refund_policy === "own_words") return game.refund_policy_text;
  return null;
}

/**
 * Where a player gives up the 14-day right to cancel digital content only by agreeing to get it at once: the EU,
 * the rest of the EEA and the UK. The buy sheet shows them the line above Buy, and the receipt repeats it.
 */
export const WITHDRAWAL_LINE_COUNTRY_CODES: readonly string[] = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "IS", "LI", "NO", "GB",
];

/** The line, in the sheet and on the receipt. */
export const WITHDRAWAL_LINE_TEXT = "You get it now, so you can't cancel it in the next 14 days.";

/** Whether a player in this country sees the withdrawal line. Unknown countries don't. */
export function isWithdrawalLineShownFor(countryCode: string | null | undefined): boolean {
  return Boolean(countryCode && WITHDRAWAL_LINE_COUNTRY_CODES.includes(countryCode.toUpperCase()));
}
