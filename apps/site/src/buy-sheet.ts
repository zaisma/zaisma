import { STAND_IN_COVER_PICTURES } from "./generated/stand-in-placeholders.generated.ts";
import { gallerySheet } from "./components/gallery-sheet.ts";
import { html, pageData, type Raw } from "./html.ts";
import type { ShownPicture } from "./components/foundations.ts";
import { pageScript } from "./page-scripts.ts";
import type { Env } from "./env.ts";
import { action, cardRow, secondaryButton, primaryButton, tertiaryButton } from "./components/actions.ts";
import { cutField } from "./components/fields.ts";
import { stripeFrame } from "./components/stripe-frame.ts";
import { stateNote } from "./components/data.ts";
import { progress } from "./components/reading.ts";
import { confirmItsYouSheet } from "./components/confirm-its-you.ts";
import { row, stack, type LayoutItem } from "./components/layout.ts";
import { notice, storePanel } from "./components/panes.ts";
import { isLocalPreview } from "./stripe.ts";

/**
 * The buy sheet (docs/DECISIONS.md, "One Zaisma buy sheet; we own the buying experience, not the money."): a store panel that rises over the
 * running game when the game asks to buy an item (Zaisma.items.buy, a zaisma:buy message), and stands alone in a zaisma.com window for games
 * on their own sites (/buy/<slug>/<item_name>). Over the game it's short at the screen's bottom right, the cover small beside the item; on the
 * game's page and in the window it's centered, the cover large (components/panes.ts, Store panel). Pinned at its foot the saved card and Buy,
 * carrying the price, then who sells it. Pressing Buy is the confirmation, and it's pressed once: only when
 * the start answer says why (confirmation_reason) does a "Confirm it's you" dialog (components/confirm-its-you.ts) open over the panel, and a
 * right proof goes on to buy by itself; Cancel leaves Buy to press again. The script shows the parts by the moment: the item, the saved card,
 * entering a card, Apple Pay or Google Pay, a guest's way to an account, and how it ended. Nothing in it is about one player, so the page around it stays cacheable: everything personal comes from /api/buy (buy.ts) once the
 * sheet opens.
 */
/** What the gallery shows it selling; a page's script fills in the real item and moves it through its moments. */
interface BuySheetSample { name: string; priceText: string; description: string; sellerName: string }
interface BuySheetOptions { joinHref: string; signInHref: string; cover?: ShownPicture | null; soldItem?: BuySheetSample; cardWords?: string; problem?: { title: string; text: string }; doneText?: string; goWords?: string; isOnPage?: boolean }
const BUY_SAMPLE: BuySheetOptions = { joinHref: "#", signInHref: "#", cover: STAND_IN_COVER_PICTURES["hollow-tide"]!, soldItem: { name: "Revive", priceText: "$1.99", description: "Back with half your health.", sellerName: "Preview Studio" }, cardWords: "Visa ending 4242" };
const GONE_FROM_BUYING = ["buy-go"];
export const buySheet = gallerySheet<BuySheetOptions>({
  name: "Buy sheet",
  slug: "buy-sheet",
  summary: "Buying over a game or in Zaisma's window, on a store panel. Its script fills in the item, the card and each moment.",
  states: [
    { stateValue: "one-press", label: "One press: the saved card, and Buy carrying the price", options: BUY_SAMPLE, shownIds: ["buy-other-card"] },
    { stateValue: "getting-the-price", label: "Getting the price", options: { joinHref: "#", signInHref: "#", cover: BUY_SAMPLE.cover } },
    { stateValue: "wallet", label: "With Apple Pay or Google Pay, and the line the EU's law asks for", options: BUY_SAMPLE, shownIds: ["buy-wallet-stand-in", "buy-other-card", "buy-eu"] },
    { stateValue: "first-card", label: "A first card", options: BUY_SAMPLE, shownIds: ["buy-card", "buy-test-card"], words: { "buy-card-words": "Add a card to pay with. It's saved to your account, so your next buy is one press." } },
    { stateValue: "new-card", label: "A new card, over a saved one", options: BUY_SAMPLE, shownIds: ["buy-card", "buy-test-card", "buy-keep-card"], words: { "buy-card-words": "A new card for this buy. It takes the place of Visa ending 4242 for your next buys too." } },
    { stateValue: "guest", label: "As a guest", options: BUY_SAMPLE, shownIds: ["buy-guest", "buy-guest-buttons"], hiddenIds: GONE_FROM_BUYING, words: { "buy-sheet-title": "Make a free account to buy" } },
    { stateValue: "cant-be-bought", label: "Can't be bought", options: BUY_SAMPLE, shownIds: ["buy-message", "buy-back"], hiddenIds: GONE_FROM_BUYING, words: { "buy-sheet-title": "This item can't be bought right now.", "buy-message": "Nothing was charged." } },
    { stateValue: "already-owned", label: "Already owned", options: BUY_SAMPLE, shownIds: ["buy-message", "buy-back"], hiddenIds: GONE_FROM_BUYING, words: { "buy-sheet-title": "Already yours", "buy-message": "You already own Revive. Nothing was charged." } },
    { stateValue: "declined", label: "Declined", options: { ...BUY_SAMPLE, problem: { title: "The payment didn't go through", text: "Your card was declined. Nothing was charged." }, goWords: "Try again" }, shownIds: ["buy-problem"] },
    { stateValue: "bought", label: "Bought", options: { ...BUY_SAMPLE, doneText: "Revive is yours. The receipt is on its way to your account's email." }, shownIds: ["buy-done", "buy-back"], hiddenIds: GONE_FROM_BUYING },
    { stateValue: "on-a-page", label: "In Zaisma's window, for a game on its own site: the cover large and the full terms", options: { ...BUY_SAMPLE, isOnPage: true }, shownIds: ["buy-other-card"] },
  ],
  partsOnlyLive: { "buy-wallet": "Stripe's own frame; Apple Pay's stand-in shows its place", "buy-wallet-frame": "Stripe's own frame", "buy-card-frame": "Stripe's own frame; the test card shows its place" },
  make: (options, isShown) => {
  const momentItems: LayoutItem[] = [
      { kind: "block", id: "buy-loading", isHidden: Boolean(options.soldItem), markup: progress({ label: "Getting the price" }) },
      {
        kind: "block",
        id: "buy-card",
        isHidden: true,
        markup: stack({
          items: [
            // What this step is: a new card, saved for the next buys too (it takes the saved card's place when there is one).
            { kind: "words", id: "buy-card-words", markup: html`<p></p>` },
            // Stripe's card form goes here; the local preview's stand-in Stripe has no form, so its test card's number stands in for it.
            { kind: "block", id: "buy-card-form", markup: stripeFrame({ id: "buy-card-frame", title: "Card details" }) },
            { kind: "control", id: "buy-test-card", isHidden: true, markup: cutField({ name: "test_card_number", id: "buy-test-card-field", label: "Card number", type: "text", text: "4242 4242 4242 4242", isReadOnly: true, autocomplete: "off", hint: "The preview's test card. On zaisma.com, Stripe's card form is here." }) },
            { kind: "control", id: "buy-keep-card", isHidden: true, markup: tertiaryButton("Keep your saved card", { type: "button" }) },
          ],
        }),
      },
      {
        kind: "block",
        id: "buy-guest",
        isHidden: true,
        markup: stack({
          items: [
            { kind: "words", markup: html`<p id="buy-guest-text">Your game keeps running while you make one or sign in, and you come back to this.</p>` },
          ],
        }),
      },
      { kind: "words", id: "buy-message", isHidden: true, markup: html`<p></p>` },
      { kind: "block", id: "buy-problem", isHidden: true, markup: stateNote({ stateKind: "problem", title: options.problem?.title ?? "", text: options.problem?.text ?? "" }) },
      { kind: "block", id: "buy-done", isHidden: true, markup: stateNote({ stateKind: "done", title: "Bought", text: options.doneText ?? "" }) },
  ];
  // The foot stays in view while the body scrolls: Apple Pay or Google Pay when offered, the saved card, the line the EU's law asks for, and Buy.
  const footItems: LayoutItem[] = [
      { kind: "block", id: "buy-wallet", isHidden: true, markup: stripeFrame({ id: "buy-wallet-frame", title: "Apple Pay or Google Pay" }) },
      { kind: "control", id: "buy-wallet-stand-in", isHidden: true, markup: secondaryButton("Apple Pay", { type: "button", wayIn: "apple_pay", isFullWidth: true }) },
      { kind: "control", id: "buy-other-card", isHidden: true, markup: cardRow(options.cardWords ?? "", { type: "button", hiddenText: "Use another card", changeText: "Change" }) },
      // Digital content delivered at once loses the 14-day withdrawal right only with the buyer's acknowledgement, said before they buy.
      { kind: "words", id: "buy-eu", isHidden: true, markup: html`<p>You get it now, so you can't cancel it in the next 14 days.</p>` },
      { kind: "control", markup: primaryButton(options.goWords ?? action("buy"), { id: "buy-go", type: "button", busyLabel: "Buying", isFullWidth: true, trailingText: options.soldItem?.priceText ?? "", isHidden: !options.soldItem }) },
      { kind: "block", id: "buy-guest-buttons", isHidden: true, markup: row({ widths: "equal", items: [{ kind: "control", markup: secondaryButton(action("signIn"), { id: "buy-sign-in", href: options.signInHref, dataAttributes: { "buy-sign-in": "/signin" } }) }, { kind: "control", markup: primaryButton("Make an account", { id: "buy-join", href: options.joinHref, dataAttributes: { "buy-sign-in": "/join" } }) }] }) },
      { kind: "control", markup: secondaryButton("Back to the game", { id: "buy-back", type: "submit", formMethod: "dialog", isFullWidth: true, isHidden: true }) },
  ];
  return storePanel({ id: "buy-sheet", closeLabel: "Close", isOverGame: !options.isOnPage, isShown, soldItem: { picture: options.cover ?? null, name: options.soldItem?.name ?? "Buy", priceText: options.soldItem?.priceText ?? "", description: options.soldItem?.description, sellerName: options.soldItem?.sellerName }, momentItems, footItems });
  },
});

/** The buy sheet as a page has it: Confirm it's you, the bank's check, and urgent news while buying. */
export function buySheetParts(options: { joinHref: string; signInHref: string; cover?: ShownPicture | null }): Raw {
  // Urgent news while buying, over the sheet and full screen (zaismaLayers): a sign-out ends the purchase, so the sheet and its Confirm it's
  // you close under it; a connection lost while paying keeps the sheet, which says what it knows.
  const signedOut = notice({ placement: "over-everything", id: "buy-signed-out", title: "You've been signed out", text: "Nothing was charged. Sign in again to buy.", buttons: [primaryButton(action("signIn"), { href: options.signInHref })], sheetsToClose: ["buy-sheet", "buy-confirm-you"] });
  const unreachable = notice({ placement: "over-everything", id: "buy-unreachable", title: "Couldn't reach Zaisma", text: "If you were charged, the item arrives when you're back." });
  return html`${buySheet(options)}${confirmItsYouSheet({ id: "buy-confirm-you" })}${stripeFrame({ id: "buy-check-frame", title: "Your bank's check" })}${signedOut}${unreachable}`;
}

/** What the sheet's script needs from the page that holds it (pageData "buy-sheet-data"). */
export interface BuySheetData {
  slug: string;
  tester_token: string | null;
  /** On the game page, over the game; or alone in a window for a game on its own site. */
  place: "game_page" | "window";
  /** Stripe.js on the page; the local preview's stand-in Stripe (a test card, no Stripe.js); or neither (no keys: saved cards only). */
  stripe_mode: "stripe" | "stand_in" | "off";
  stripe_publishable_key: string | null;
  /** The local preview: ?preview_country= stands in for the player's country, ?preview_wallet=1 draws Apple Pay. */
  is_preview: boolean;
  /** The window only: who asked, from the game's own site (the SDK's query), and where the answer may go. */
  asked: { item_name: string; item_count: number; game_account_id: string | null; request_number: number } | null;
  opener_origin: string | null;
  /** The game page only: the item whose sheet opens with the page (a paid game's ?buy), or null. */
  opened_item_name: string | null;
}

/**
 * The sheet's script. On the game page it needs the page's gamePage, frame and gameOrigin (pages.ts), whose script comes first, and the
 * page's listener calls askBuy for a zaisma:buy message. In the window it opens at once, for what the query asked. The game hears "open"
 * at once, then bought (with the purchase and its receipt), cancelled, failed, or an error for the developer's mistakes.
 */
export const BUY_SHEET_SCRIPT = pageScript("buy-sheet", String.raw`(function () {
const buyData = JSON.parse(document.getElementById("buy-sheet-data").textContent);
const buySheet = document.getElementById("buy-sheet");
const byId = (id) => document.getElementById(id);
const title = byId("buy-sheet-title");
const go = byId("buy-go");
const goLabel = go.querySelector(".label-idle");
const goPrice = go.querySelector(".run-trailing");
const back = byId("buy-back");
const itemWords = byId("buy-sheet-item-words");
// The body's moments and the foot's parts, each shown or hidden by showCells.
const CELLS = ["buy-loading", "buy-card", "buy-guest", "buy-message", "buy-problem", "buy-done", "buy-wallet", "buy-wallet-stand-in", "buy-other-card", "buy-eu", "buy-guest-buttons"];
// The developer's mistakes, which the game hears as an error once the player closes the sheet; the player only sees it can't be bought.
const DEVELOPER_MISTAKES = ["no_game", "bad_item_name", "no_item", "not_for_sale", "stripe_not_connected", "stripe_cannot_take_payments", "bad_item_count", "bad_game_account_id"];
const BOUGHT_SHOWN_MS = 1800;
// Buy stays unpressable this long after the sheet draws it, so the tap that was meant for the game can't land on it.
const BUY_HOLD_MS = 700;
const SETTLE_TRY_COUNT = 20;
const SETTLE_WAIT_MS = 1500;
const isSignedIn = () => /(^|; )(__Host-)?zaisma_in=1/.test(document.cookie);
const query = new URLSearchParams(location.search);

let asking = null;
let sale = null;
let moment = "closed";
let cardForm = null;
// Whether this buy was paid with Apple Pay or Google Pay, whose receipt goes to the wallet's email rather than the account's.
let isWalletPayment = false;
let wallet = null;
let isBusy = false;
let isHeld = false;
let holdTimer = null;
let latestPurchase = null;
let ended = { status: "cancelled", purchase: null, error: null };

function tell(asked, status, extra) {
  asked.tell(Object.assign({ type: "zaisma:buy", requestNumber: asked.requestNumber, status: status }, extra || {}));
}
function setText(id, text) { byId(id).querySelector("p").textContent = text; }
function showCells(shown, isItemShown) {
  for (const id of CELLS) byId(id).hidden = !shown.includes(id);
  // The cover stays in the head in every moment; on a page, the large cover and what it is show once the price is known and there is something to buy.
  itemWords.hidden = !isItemShown || asking.isOverGame;
}
function showButtons(buttons) {
  const wasGoHidden = go.hidden;
  back.hidden = !buttons.includes("back");
  go.hidden = !buttons.includes("go");
  if (buttons.includes("go") && wasGoHidden) holdBuy();
  syncGo();
}
// Whether Buy can be pressed: not while paying (it shows it's working), and not in its first moments on screen.
function syncGo() { go.disabled = isBusy || isHeld; }
// Whether this buy must be confirmed first: the start answer says so (is_confirmation_needed, with confirmation_reason on why), or the pay call
// asked again.
const needsConfirm = () => sale.is_confirmation_needed;
function holdBuy() {
  isHeld = true;
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => { isHeld = false; syncGo(); }, BUY_HOLD_MS);
}
function busy(isOn) {
  isBusy = isOn;
  syncGo();
  if (isOn) go.setAttribute("aria-busy", "true"); else go.removeAttribute("aria-busy");
}
async function call(path, body, method) {
  try {
    const response = await fetch(path, { method: method || "POST", headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body || {}) });
    const answer = await response.json();
    return answer && typeof answer === "object" ? answer : { error: { code: "request_failed", message: "Zaisma didn't answer. Check your connection and try again." } };
  } catch {
    return { error: { code: "request_failed", message: "Zaisma didn't answer. Check your connection and try again." } };
  }
}

// This browser's buying key (buy.ts, at the top): an ECDSA P-256 pair made once and kept in IndexedDB, its private half
// unreadable even to this script. A confirm here keeps its public half on the account, and the sheet signs each saved-card
// buy with it, so the next ones are one press. A browser that can't keep one (no IndexedDB, say) sends none and confirms each buy.
const toBase64 = (buffer) => btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(buffer)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
let buyingKeyLoad = null;
function buyingKey() {
  buyingKeyLoad = buyingKeyLoad || (async () => {
    try {
      const store = await new Promise((resolve, reject) => {
        const opening = indexedDB.open("zaisma-buying", 1);
        opening.onupgradeneeded = () => opening.result.createObjectStore("keys");
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => reject(opening.error);
      });
      const ask = (mode, act) => new Promise((resolve, reject) => {
        const asked = act(store.transaction("keys", mode).objectStore("keys"));
        asked.onsuccess = () => resolve(asked.result);
        asked.onerror = () => reject(asked.error);
      });
      let pair = await ask("readonly", (keys) => keys.get("buying"));
      if (!pair) {
        // Two tabs making one at once keep whichever was stored last, and both use that one.
        const made = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
        await ask("readwrite", (keys) => keys.add(made, "buying")).catch(() => {});
        pair = await ask("readonly", (keys) => keys.get("buying"));
      }
      if (!pair) return null;
      return { pair: pair, publicKey: toBase64(await crypto.subtle.exportKey("raw", pair.publicKey)) };
    } catch {
      return null;
    }
  })();
  return buyingKeyLoad;
}
async function buyingSignature(purchaseId) {
  const key = await buyingKey();
  if (!key) return {};
  try {
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key.pair.privateKey, new TextEncoder().encode("zaisma-buy:" + purchaseId));
    return { buying_public_key_base64: key.publicKey, buying_signature_base64: toBase64(signature) };
  } catch {
    return {};
  }
}

// Stripe.js runs only in Zaisma's Stripe frames (/buy/stripe-frame), never on this page: a frame gets its source when the sheet first
// needs it (a card to enter, a wallet, a bank's check), then is asked by postMessage, at this origin only, and answers the same way.
const frameLoads = {};
function stripeFrameReady(id) {
  frameLoads[id] = frameLoads[id] || new Promise((resolve) => {
    const frame = byId(id);
    frame.addEventListener("load", () => resolve(frame), { once: true });
    frame.src = "/buy/stripe-frame";
  });
  return frameLoads[id];
}
function askFrame(id, message) {
  return stripeFrameReady(id).then((frame) => frame.contentWindow.postMessage(Object.assign({ zaisma_stripe: true }, message), location.origin));
}
// What the frames say, by frame: each job's answer waits here, and the wallet's moments come as they happen.
const frameWaiters = {};
const waitForFrame = (id, kinds) => new Promise((resolve) => { frameWaiters[id] = { kinds: kinds, resolve: resolve }; });
window.addEventListener("message", (event) => {
  const message = event.data;
  if (event.origin !== location.origin || !message || message.zaisma_stripe !== true) return;
  const frame = [byId("buy-card-frame"), byId("buy-wallet-frame"), byId("buy-check-frame")].find((each) => each.contentWindow === event.source);
  if (!frame) return;
  if (message.kind === "height") return frame.style.setProperty("--stripe-frame-height", message.height + "px");
  if (message.kind === "cover") { frame.hidden = !message.is_covering; frame.classList.toggle("is-covering", message.is_covering); return; }
  if (frame.id === "buy-wallet-frame") return walletSaid(message);
  const waiter = frameWaiters[frame.id];
  if (waiter && waiter.kinds.includes(message.kind)) { delete frameWaiters[frame.id]; waiter.resolve(message); }
});
const stripeLook = () => ({ theme: matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "stripe", variables: { fontFamily: getComputedStyle(document.body).fontFamily, borderRadius: "10px" } });

function open(asked) {
  if (asking) finish();
  asking = asked;
  ended = { status: "cancelled", purchase: null, error: null };
  latestPurchase = null;
  tell(asked, "open");
  const keep = byId("keep");
  if (keep) zaismaLayers.leave(keep);
  // Full screen is the game's alone: it ends first, so the sheet shows over the page.
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  // Over the game it's short at the screen's bottom right; for the page's own buttons and in the window, centered.
  if (!buySheet.open) buySheet.classList.toggle("placement-corner", asked.isOverGame);
  if (!buySheet.open) buySheet.showModal();
  start();
}

async function start() {
  const asked = asking;
  sale = null;
  ended = { status: "cancelled", purchase: null, error: null };
  latestPurchase = null;
  moment = "loading";
  title.textContent = "Buy";
  busy(false);
  showCells(["buy-loading"], false);
  showButtons([]);
  const body = { item_name: asked.itemName, item_count: asked.itemCount, game_account_id: asked.gameAccountId };
  if (buyData.tester_token) body.tester_token = buyData.tester_token;
  if (buyData.is_preview && /^[A-Z]{2}$/.test(query.get("preview_country") || "")) body.preview_country_code = query.get("preview_country");
  const key = await buyingKey();
  if (key) body.buying_public_key_base64 = key.publicKey;
  const answer = await call("/api/buy/" + buyData.slug + "/start", body);
  if (asking !== asked) return;
  if (answer.error) return refused(answer.error);
  sale = answer;
  title.textContent = sale.item.title + (sale.item_count > 1 ? " × " + sale.item_count : "");
  byId("buy-sheet-item-price").textContent = sale.price.price_text;
  byId("buy-sheet-item-blurb").textContent = sale.item.description || "";
  byId("buy-sheet-item-description").textContent = sale.item.description || "";
  byId("buy-sheet-item-seller").textContent = "Sold by " + sale.seller.business_name + ".";
  byId("buy-sheet-item-refunds").textContent = sale.refund_policy_words ? " " + sale.refund_policy_words : "";
  goPrice.textContent = sale.price.price_text;
  sale.saved_card ? ready() : enterCard();
}

function refused(error) {
  moment = "refused";
  if (error.code === "account_needed") return guest();
  if (DEVELOPER_MISTAKES.includes(error.code)) {
    ended.error = { code: error.code, message: error.message, fix: error.fix || null };
    title.textContent = "This item can't be bought right now.";
    setText("buy-message", "Nothing was charged.");
    showCells(["buy-message"], false);
    return showButtons(["back"]);
  }
  if (error.code === "game_unavailable") {
    title.textContent = "This game isn't available in your country";
    setText("buy-message", error.message + " Nothing was charged.");
    showCells(["buy-message"], false);
    return showButtons(["back"]);
  }
  if (error.code === "already_owned") {
    title.textContent = "Already yours";
    setText("buy-message", error.message + " Nothing was charged.");
    showCells(["buy-message"], false);
    return showButtons(["back"]);
  }
  problem("Couldn't open the purchase", error.message);
}

function problem(problemTitle, problemText) {
  moment = "problem";
  busy(false);
  byId("buy-problem").querySelector(".state-title").textContent = problemTitle;
  byId("buy-problem").querySelector(".state-text").textContent = problemText;
  showCells(["buy-problem"], false);
  goLabel.textContent = "Try again";
  goPrice.textContent = sale ? sale.price.price_text : "";
  showButtons(["go"]);
}

// A guest makes a free account or signs in, in a new tab on the game page (the game keeps running, as Zaisma.player.signIn does), and
// comes back to this same item; in the window, in the window itself, which comes back here.
function guest() {
  moment = "guest";
  title.textContent = "Make a free account to buy";
  byId("buy-guest-text").textContent = asking.isOverGame ? "Your game keeps running while you make one or sign in, and you come back to this." : "Make one or sign in, and you come back to this.";
  showCells(["buy-guest", "buy-guest-buttons"], false);
  showButtons([]);
}
document.querySelectorAll("[data-buy-sign-in]").forEach((link) => link.addEventListener("click", (event) => {
  if (buyData.place !== "game_page") return;
  if (!window.open(link.dataset.buySignIn + "?next=" + encodeURIComponent("/account/kept?game=" + buyData.slug), "_blank")) return;
  event.preventDefault();
  byId("buy-guest-text").textContent = "Finish in the new tab, then come back here.";
}));
function checkSignedIn() { if (moment === "guest" && asking && isSignedIn()) start(); }
addEventListener("focus", checkSignedIn);
document.addEventListener("visibilitychange", checkSignedIn);
try { new BroadcastChannel("zaisma").addEventListener("message", (event) => event.data === "signed-in" && checkSignedIn()); } catch {}

const BRANDS = { visa: "Visa", mastercard: "Mastercard", amex: "American Express", discover: "Discover", jcb: "JCB", diners: "Diners Club", unionpay: "UnionPay", cartes_bancaires: "Cartes Bancaires" };
const cardWords = (card) => (BRANDS[card.card_brand] || "Card") + " ending " + card.card_last_digits;

// The saved card and Buy: pressing Buy is the confirmation, and it's pressed once. Wallets and EU wording sit with it in the foot.
function ready() {
  moment = "ready";
  busy(false);
  byId("buy-other-card").querySelector(".face > span:not([class])").textContent = cardWords(sale.saved_card);
  byId("buy-other-card").querySelector("button").dataset.cardBrand = sale.saved_card.card_brand;
  const shown = ["buy-other-card"];
  showWallet(shown);
  if (sale.is_eu_withdrawal_line_shown) shown.push("buy-eu");
  showCells(shown, true);
  goLabel.textContent = "Buy";
  showButtons(["go"]);
}
byId("buy-other-card").querySelector("button").addEventListener("click", () => enterCard());

// Why the player is asked to confirm it's them, in the start answer's words (the pay call asking again has none).
const REASON_WORDS = {
  purchase_pin: "Your account asks for your purchase PIN for every buy.",
  new_device: "This is the first buy with your saved card on this device.",
  old_sign_in: "It's been a while since you signed in here.",
  big_spend: "That's a lot for one day.",
};
// The ways to confirm, the one to ask first leading: the purchase PIN when the account has one and it isn't locked (it was set as the lock), else a passkey, else the password.
function confirmMethods() {
  const methods = sale.confirmation_methods;
  const ways = [];
  if (methods.has_purchase_pin && !methods.is_purchase_pin_locked) ways.push("purchase_pin");
  if (methods.has_passkey) ways.push("passkey");
  if (methods.has_password) ways.push("password");
  return ways;
}
// Sends the dialog's proof (components/confirm-its-you.ts) to the server; a right one makes this buy confirmed.
async function sendProof(proof) {
  let body;
  if (proof.method === "passkey") {
    const tap = proof.passkey_tap;
    body = { passkey_tap: { id: tap.passkey_id, clientDataJSON: tap.client_data_json, authenticatorData: tap.authenticator_data, signature: tap.signature, userHandle: tap.user_handle } };
  } else if (proof.method === "purchase_pin") {
    body = { purchase_pin: proof.purchase_pin };
  } else {
    body = { password: proof.password };
  }
  const key = await buyingKey();
  if (key) body.buying_public_key_base64 = key.publicKey;
  const answer = await call("/api/buy/confirm", body);
  if (!answer.error) { sale.is_confirmation_needed = false; return { ok: true }; }
  if (answer.error.code === "purchase_pin_locked") { sale.confirmation_methods.is_purchase_pin_locked = true; return { ok: false, message: answer.error.message, removed_methods: ["purchase_pin"] }; }
  return { ok: false, message: answer.error.message };
}

// Buy was pressed and the account must confirm it's them first: the dialog opens over the panel, and a right proof goes on to buy with no second press.
// Cancelling it leaves the panel as it was, Buy ready to press again.
function askToConfirm() {
  const asked = asking;
  ready();
  const ways = confirmMethods();
  const reason = sale.confirmation_reason;
  if (!ways.length) {
    setText("buy-message", "To buy with your saved card, add a passkey or a purchase PIN in your account first. Apple Pay and Google Pay work without one.");
    byId("buy-message").hidden = false;
    return;
  }
  byId("buy-message").hidden = true;
  // The dialog's Confirm is the one runner in view while it's open: the panel keeps only its item, and its foot comes back if it's cancelled.
  showCells([], true);
  showButtons([]);
  // A purchase PIN's sentence is about the PIN; confirming another way, the account only asks to confirm.
  const why = reason === "purchase_pin" && ways[0] !== "purchase_pin" ? "Your account asks you to confirm every buy." : REASON_WORDS[reason] || "Confirm it's you to buy.";
  window.zaismaConfirmItsYou("buy-confirm-you", {
    methods: ways,
    reason: why,
    passkeyPurpose: "purchase",
    send: sendProof,
    onConfirmed: () => { if (asking === asked) pay(); },
    onCancelled: () => { if (asking === asked) ready(); },
  });
}

// Buy is pressed: confirmed first when the account asks, then paid, and a purchase in flight can't be pressed again.
function buyWithSavedCard() {
  if (isBusy) return;
  isWalletPayment = false;
  if (needsConfirm()) return askToConfirm();
  pay();
}
async function pay() {
  busy(true);
  paid(await call("/api/buy/purchases/" + sale.purchase_id + "/pay-with-saved-card", await buyingSignature(sale.purchase_id)));
}

async function paid(answer) {
  if (answer.error) {
    // The confirmation ran out or was used up while paying: ask again, the dialog saying why.
    if (answer.error.code === "purchase_confirmation_needed") { sale.is_confirmation_needed = true; return askToConfirm(); }
    // Signed out while buying (another tab, another device): nothing was charged, and the sheet can't go on.
    if (answer.error.code === "account_needed") { busy(false); zaismaLayers.say({ cardId: "buy-signed-out" }); return; }
    // The connection went while paying: whether it went through isn't known here, so the sheet stays and says so too.
    if (answer.error.code === "request_failed") zaismaLayers.say({ cardId: "buy-unreachable" });
    if (answer.error.code === "payment_declined") return declined(answer.error.message);
    return problem("Couldn't buy it", answer.error.message);
  }
  if (answer.purchase) latestPurchase = answer.purchase;
  if (answer.status === "completed") return bought(answer.purchase);
  if (answer.status === "action_needed") {
    waiting("Your bank asks you to confirm");
    const checked = waitForFrame("buy-check-frame", ["next_action_done"]);
    askFrame("buy-check-frame", { kind: "next_action", stripe_account_id: answer.stripe_account_id, client_secret: answer.client_secret });
    const result = await checked;
    if (result.is_unreachable) return problem("Couldn't reach your bank", "Nothing was charged. Try again.");
    if (result.error_message) return declined(result.error_message);
    return settle();
  }
  problem("Couldn't buy it", "Zaisma didn't answer. Check your connection and try again.");
}

function waiting(words) {
  moment = "waiting";
  const shown = byId("buy-loading").querySelector(".progress");
  shown.querySelector(".progress-label").textContent = words;
  shown.setAttribute("aria-label", words);
  showCells(["buy-loading"], true);
  showButtons(["go"]);
  busy(true);
}

// After 3-D Secure or a wallet: the purchase as Stripe has it, asked again until it's bought or failed.
async function settle() {
  const asked = asking;
  for (let tryIndex = 0; tryIndex < SETTLE_TRY_COUNT; tryIndex += 1) {
    const answer = await call("/api/buy/purchases/" + sale.purchase_id, null, "GET");
    if (asking !== asked) return;
    const purchase = answer.purchase;
    if (purchase) latestPurchase = purchase;
    if (purchase && purchase.purchase_status === "completed") return bought(purchase);
    if (purchase && purchase.purchase_status === "failed") return declined("The payment didn't go through.");
    await new Promise((resolve) => setTimeout(resolve, SETTLE_WAIT_MS));
  }
  // Still settling: it can complete later, so the game hears failed with the purchase and gets the purchase event if it does.
  ended.status = "failed";
  ended.purchase = latestPurchase;
  problem("Still waiting on the payment", "If it goes through, the game gets it on its own. You'll get a receipt by email.");
}

function declined(message) {
  const asked = asking;
  ended.status = "failed";
  ended.purchase = latestPurchase;
  problem("The payment didn't go through", (message || "") + " Nothing was charged.");
  // The game hears failed with the purchase, so ask for it when the answer that declined didn't carry it.
  if (!ended.purchase && sale) call("/api/buy/purchases/" + sale.purchase_id, null, "GET").then((answer) => { if (asking === asked && answer.purchase) ended.purchase = answer.purchase; });
}

function bought(purchase) {
  moment = "bought";
  busy(false);
  ended = { status: "bought", purchase: purchase || null, error: null };
  const receiptWords = isWalletPayment ? "The receipt is on its way by email." : sale.has_account_email ? "The receipt is on its way to your account's email." : "Add an email to your account to get receipts.";
  byId("buy-done").querySelector(".state-text").textContent = sale.item.title + " is yours. " + receiptWords;
  showCells(["buy-done"], false);
  showButtons(["back"]);
  setTimeout(() => { if (moment === "bought" && buySheet.open) buySheet.close(); }, BOUGHT_SHOWN_MS);
}

// No saved card: the email for receipts and Stripe's card form; the card is saved to the player's Zaisma account (Stripe keeps it), then
// paid with like any saved card.
function enterCard() {
  moment = "card";
  busy(false);
  const shown = ["buy-card"];
  byId("buy-card-form").hidden = buyData.stripe_mode !== "stripe";
  byId("buy-test-card").hidden = buyData.stripe_mode !== "stand_in";
  setText("buy-card-words", sale.saved_card ? "A new card for this buy. It takes the place of " + cardWords(sale.saved_card) + " for your next buys too." : "Add a card to pay with. It's saved to your account, so your next buy is one press.");
  byId("buy-keep-card").hidden = !sale.saved_card;
  if (sale.saved_card) byId("buy-keep-card").querySelector(".tertiary-label").textContent = "Keep " + cardWords(sale.saved_card);
  showWallet(shown);
  if (sale.is_eu_withdrawal_line_shown) shown.push("buy-eu");
  showCells(shown, true);
  goLabel.textContent = "Buy";
  // Buy saves the card and pays: Stripe's form, or the stand-in's test card, filled in already.
  showButtons(["go"]);
  if (buyData.stripe_mode === "stripe" && !cardForm) {
    byId("buy-card-frame").hidden = false;
    cardForm = askFrame("buy-card-frame", { kind: "card", currency_code: sale.price.currency_code, appearance: stripeLook() }).then(() => true);
  }
}

async function saveCard() {
  busy(true);
  let setupIntentId;
  if (buyData.stripe_mode === "stripe") {
    // The frame checks the form, makes the setup and confirms it with Stripe; Stripe's form says itself what's missing or wrong.
    await cardForm;
    const answered = waitForFrame("buy-card-frame", ["card_set_up", "card_incomplete", "card_problem", "card_not_ready"]);
    askFrame("buy-card-frame", { kind: "save_card", return_url: location.href });
    const said = await answered;
    if (said.kind === "card_problem") return problem("Couldn't save your card", said.message);
    if (said.kind !== "card_set_up") return busy(false);
    setupIntentId = said.setup_intent_id;
  } else {
    const setup = await call("/api/payment-methods/setup", {});
    if (setup.error) return problem("Couldn't save your card", setup.error.message);
    setupIntentId = setup.setup_intent_id;
  }
  const saved = await call("/api/payment-methods/saved", { setup_intent_id: setupIntentId });
  if (saved.error) return problem("Couldn't save your card", saved.error.message);
  sale.saved_card = saved.saved_card;
  // Saved: Buy was pressed for it, so it takes it from here, asking first only when the start answer said why. Saving is done, so the
  // sheet isn't busy any more: buyWithSavedCard turns away a press while it is.
  busy(false);
  buyWithSavedCard();
}
byId("buy-keep-card").querySelector("button").addEventListener("click", () => ready());

// Apple Pay and Google Pay, on the developer's account: the wallet asks for Face ID or a fingerprint itself, so Zaisma doesn't, and its
// email gets the receipt. The local preview can't show them, so ?preview_wallet=1 draws their place.
function showWallet(shown) {
  if (buyData.is_preview && query.get("preview_wallet") === "1") return shown.push("buy-wallet-stand-in");
  if (buyData.stripe_mode !== "stripe" || !sale.wallet) return;
  if (wallet && wallet.purchaseId === sale.purchase_id) { if (wallet.isAvailable) shown.push("buy-wallet"); return; }
  const forSale = sale;
  wallet = { purchaseId: forSale.purchase_id, isAvailable: false };
  // A fresh frame for each purchase, so its button pays for this one.
  const frame = byId("buy-wallet-frame");
  delete frameLoads["buy-wallet-frame"];
  frame.hidden = false;
  askFrame("buy-wallet-frame", { kind: "wallet", purchase_id: forSale.purchase_id, stripe_account_id: forSale.wallet.stripe_account_id, price_minor_units: forSale.price.price_minor_units, currency_code: forSale.price.currency_code, appearance: stripeLook(), return_url: location.href });
}
// The wallet frame's moments: its button showed, the player chose it, and how the payment went.
function walletSaid(message) {
  if (!wallet || !sale || wallet.purchaseId !== sale.purchase_id) return;
  if (message.kind === "wallet_ready") { wallet.isAvailable = true; if (moment === "ready" || moment === "card") byId("buy-wallet").hidden = false; return; }
  if (message.kind === "wallet_paying") { isWalletPayment = true; return waiting("Paying"); }
  if (message.kind === "wallet_problem") return problem("Couldn't buy it", message.message);
  if (message.kind === "wallet_declined") return declined(message.message);
  if (message.kind === "wallet_paid") return settle();
}
byId("buy-wallet-stand-in").querySelector("button").addEventListener("click", () => {
  setText("buy-message", "Apple Pay and Google Pay show here on zaisma.com. The preview can't run them.");
  byId("buy-message").hidden = false;
});

go.addEventListener("click", () => {
  if (isBusy || isHeld) return;
  if (moment === "ready") return buyWithSavedCard();
  if (moment === "card") return saveCard();
  if (moment === "problem") return start();
});
// Enter in a field is Buy, never the sheet's first button (Cancel).
buySheet.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return;
  event.preventDefault();
  if (!go.hidden && !go.disabled && !isHeld) go.click();
});
// Nothing closes the sheet while it's paying, so the player sees how it ended.
buySheet.addEventListener("cancel", (event) => { if (isBusy) event.preventDefault(); });
buySheet.addEventListener("close", finish);

// The game hears how it ended once the sheet is gone: bought with the purchase; failed (declined, or still settling) with the purchase when there is one; cancelled when nothing was charged; or the developer's mistake.
function finish() {
  if (!asking) return;
  const asked = asking;
  asking = null;
  // Closed while a payment was settling (a bank's confirmation, a wallet): it can still complete, so it isn't a cancel.
  if (moment === "waiting" && ended.status === "cancelled") { ended.status = "failed"; ended.purchase = latestPurchase; }
  moment = "closed";
  busy(false);
  if (buySheet.open) buySheet.close();
  if (ended.error) tell(asked, "error", ended.error);
  else tell(asked, ended.status, ended.purchase ? { purchase: ended.purchase } : {});
  if (buyData.place === "window") return setTimeout(() => window.close(), 50);
  if (typeof frame !== "undefined" && frame) frame.focus();
}

if (buyData.place === "game_page") {
  // Right after the player tapped or pressed a key in the game (the browser counts it for this page too), so a sheet never opens by itself.
  const hasPlayerTap = () => !navigator.userActivation || navigator.userActivation.isActive;
  window.askBuy = (asked) => {
    const reply = (message) => frame && frame.contentWindow.postMessage(message, gameOrigin);
    const request = { requestNumber: asked.requestNumber, itemName: asked.itemName, itemCount: typeof asked.itemCount === "number" ? asked.itemCount : 1, gameAccountId: typeof asked.gameAccountId === "string" ? asked.gameAccountId : null, isOverGame: true, tell: reply };
    if (!hasPlayerTap()) return tell(request, "error", { code: "needs_player_tap", message: "The buy sheet opens only right after the player taps or presses a key in the game: call Zaisma.items.buy from that tap's handler." });
    open(request);
  };
  // The page's own buttons (a paid game's Buy, each add-on's price) open the sheet for their item. Once it's bought the page is drawn
  // again, since the server draws what the viewer owns: Buy turns into Play, an add-on into Owned.
  const pageTell = (message) => { if (message.status === "bought") location.reload(); };
  const openForPage = (itemName) => open({ requestNumber: 0, itemName: itemName, itemCount: 1, gameAccountId: null, isOverGame: false, tell: pageTell });
  document.addEventListener("click", (event) => {
    const button = event.target.closest && event.target.closest("[data-buy-item]");
    if (button && !button.disabled) openForPage(button.dataset.buyItem);
  });
  if (buyData.opened_item_name) openForPage(buyData.opened_item_name);
} else {
  // The window answers only the game's own site the server named (opener_origin); any other opener hears nothing, and the game sees the
  // purchase in its next pass.
  const asked = buyData.asked;
  const opener = window.opener;
  const reply = (message) => { if (opener && buyData.opener_origin) opener.postMessage(message, buyData.opener_origin); };
  open({ requestNumber: asked.request_number, itemName: asked.item_name, itemCount: asked.item_count, gameAccountId: asked.game_account_id, isOverGame: false, tell: reply });
}

// The local preview opens the sheet with no tap in a game, and draws the moments it can't reach (a decline, 3-D Secure), for the layout
// check and Screens.
if (buyData.is_preview) {
  window.showBuyMoment = (name, itemName) => {
    if (name === "open") return open({ requestNumber: 0, itemName: itemName, itemCount: 1, gameAccountId: null, isOverGame: true, tell: () => {} });
    if (name === "declined") return declined("Your card was declined.");
    if (name === "three_d_secure") return waiting("Your bank asks you to confirm");
    // Buy pressed once, as a player would: it opens the Confirm it's you dialog where the account asks for one (and charges at once where it
    // doesn't, so the check only presses it for an account that asks). A first card is saved with the stand-in's test card first.
    if (name === "press_buy") { isHeld = false; syncGo(); return go.click(); }
  };
}
})();`);

/**
 * Inside the Stripe frame (/buy/stripe-frame): Stripe.js and Stripe's parts, run for the buy sheet on the page around it, which asks by
 * postMessage and hears back the same way, both only at zaisma.com's own origin. The frame calls Zaisma itself where Stripe needs a secret
 * (saving a card, a wallet payment), so the page never handles one.
 */
export const STRIPE_FRAME_SCRIPT = pageScript("stripe-frame", String.raw`(function () {
const frameData = JSON.parse(document.getElementById("stripe-frame-data").textContent);
const here = location.origin;
const stripes = {};
const stripeFor = (stripeAccountId) => stripes[stripeAccountId || ""] || (stripes[stripeAccountId || ""] = window.Stripe(frameData.stripe_publishable_key, stripeAccountId ? { stripeAccount: stripeAccountId } : undefined));
const tell = (message) => parent.postMessage(Object.assign({ zaisma_stripe: true }, message), here);
const mount = document.getElementById("stripe-mount");
new ResizeObserver(() => tell({ kind: "height", height: Math.ceil(mount.getBoundingClientRect().height) })).observe(mount);
async function call(path, body) {
  try {
    const answer = await (await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })).json();
    return answer && typeof answer === "object" ? answer : { error: { message: "Zaisma didn't answer. Check your connection and try again." } };
  } catch {
    return { error: { message: "Zaisma didn't answer. Check your connection and try again." } };
  }
}
let card = null;
const jobs = {
  // The card form, on Zaisma's platform: saving it makes the setup, confirms it with Stripe (a bank may check), and says which setup it was.
  card(message) {
    const elements = stripeFor(null).elements({ mode: "setup", currency: message.currency_code, paymentMethodTypes: ["card"], appearance: message.appearance });
    elements.create("payment", { wallets: { applePay: "never", googlePay: "never" } }).mount(mount);
    card = elements;
  },
  async save_card(message) {
    if (!card) return tell({ kind: "card_not_ready" });
    const submitted = await card.submit();
    if (submitted.error) return tell({ kind: "card_incomplete" });
    const setup = await call("/api/payment-methods/setup", {});
    if (setup.error) return tell({ kind: "card_problem", message: setup.error.message });
    const confirmed = await stripeFor(null).confirmSetup({ elements: card, clientSecret: setup.client_secret, confirmParams: { return_url: message.return_url }, redirect: "if_required" });
    if (confirmed.error) return tell({ kind: "card_incomplete" });
    tell({ kind: "card_set_up", setup_intent_id: setup.setup_intent_id });
  },
  // Apple Pay and Google Pay, on the developer's account: the wallet asks for Face ID or a fingerprint, and pays.
  wallet(message) {
    const stripe = stripeFor(message.stripe_account_id);
    const elements = stripe.elements({ mode: "payment", amount: message.price_minor_units, currency: message.currency_code, appearance: message.appearance });
    const element = elements.create("expressCheckout", { emailRequired: true, paymentMethods: { applePay: "always", googlePay: "always", link: "never", paypal: "never", amazonPay: "never" } });
    element.on("ready", (event) => { if (event.availablePaymentMethods) tell({ kind: "wallet_ready" }); });
    element.on("confirm", async () => {
      tell({ kind: "wallet_paying" });
      const intent = await call("/api/buy/purchases/" + message.purchase_id + "/wallet-intent", {});
      if (intent.error) return tell({ kind: "wallet_problem", message: intent.error.message });
      const result = await stripe.confirmPayment({ elements: elements, clientSecret: intent.client_secret, confirmParams: { return_url: message.return_url }, redirect: "if_required" });
      tell(result.error ? { kind: "wallet_declined", message: result.error.message } : { kind: "wallet_paid" });
    });
    element.mount(mount);
  },
  // A bank's 3-D Secure check for a saved card's payment: the frame covers the window while it's open.
  async next_action(message) {
    tell({ kind: "cover", is_covering: true });
    try {
      const result = await stripeFor(message.stripe_account_id).handleNextAction({ clientSecret: message.client_secret });
      tell({ kind: "next_action_done", error_message: result.error ? result.error.message : null });
    } catch {
      tell({ kind: "next_action_done", error_message: null, is_unreachable: true });
    }
    tell({ kind: "cover", is_covering: false });
  },
};
window.addEventListener("message", (event) => {
  const message = event.data;
  if (event.origin !== here || event.source !== parent || !message || message.zaisma_stripe !== true || !Object.prototype.hasOwnProperty.call(jobs, message.kind)) return;
  jobs[message.kind](message);
});
})();`);

/** Which Stripe the sheet uses here: the preview's stand-in only on a local site (stripe.ts refuses it anywhere else too). */
export function buySheetStripe(env: Env): Pick<BuySheetData, "stripe_mode" | "stripe_publishable_key" | "is_preview"> {
  const isPreview = isLocalPreview(env);
  const stripeMode = env.STRIPE_API_ORIGIN && isPreview ? "stand_in" : env.STRIPE_PUBLISHABLE_KEY ? "stripe" : "off";
  return { stripe_mode: stripeMode, stripe_publishable_key: stripeMode === "stripe" ? env.STRIPE_PUBLISHABLE_KEY ?? null : null, is_preview: isPreview };
}

/** The sheet's data, typed: the page puts it beside the sheet. */
export const buySheetData = (sheetData: BuySheetData): Raw => pageData("buy-sheet-data", sheetData);
