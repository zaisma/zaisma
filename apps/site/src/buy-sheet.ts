import { html, pageData, type Raw } from "./html.ts";
import { pageScript } from "./page-scripts.ts";
import type { Env } from "./env.ts";
import { cardRow, cutButton, runButton, textButton } from "./components/actions.ts";
import { doneState, loadingState, problemState } from "./components/data.ts";
import { cutField } from "./components/fields.ts";
import { row, stack } from "./components/layout.ts";
import { storeItem, storePanel } from "./components/panes.ts";
import { isLocalPreview } from "./stripe.ts";

/**
 * The buy sheet (docs/DECISIONS.md, "One Zaisma buy sheet; we own the buying experience, not the money."): a store panel that rises over the
 * running game when the game asks to buy an item (Zaisma.items.buy, a zaisma:buy message), and stands alone in a zaisma.com window for games
 * on their own sites (/buy/<slug>/<item_name>). The game's own cover is across its top; below it the item, its price and one quiet line on who
 * sells it; pinned at its foot the saved card and Buy, carrying the price. Pressing Buy is the confirmation: only when the start answer says
 * why (confirmation_reason) does the panel ask the player to confirm it's them first, in the same place. The script shows the parts by the
 * moment: the item, the saved card, confirming it's you, entering a card, Apple Pay or Google Pay, a guest's way to an account, and how it
 * ended. Nothing in it is about one player, so the page around it stays cacheable: everything personal comes from /api/buy (buy.ts) once the
 * sheet opens.
 */
export function buySheet(options: { joinHref: string; signInHref: string; coverUrl?: string | null }): Raw {
  const body = stack({
    items: [
      { kind: "block", markup: storeItem({ id: "buy-item", imageUrl: options.coverUrl ?? null, name: "", priceText: "" }) },
      { kind: "block", id: "buy-loading", markup: loadingState({ label: "Getting the price" }) },
      {
        kind: "block",
        id: "buy-card",
        isHidden: true,
        markup: stack({
          items: [
            { kind: "control", markup: cutField({ name: "receipt_email", id: "buy-receipt-email", label: "Email for receipts", type: "email", autocomplete: "email", hint: "Leave it empty for your account's email." }) },
            // Stripe's card form goes here; the local preview's stand-in Stripe has no form, so a test card stands in for it.
            { kind: "block", id: "buy-card-form", markup: html`<div id="buy-card-element"></div>` },
            { kind: "control", id: "buy-test-card", isHidden: true, markup: cutButton("Test card", { type: "button", isFullWidth: true }) },
          ],
        }),
      },
      {
        kind: "block",
        id: "buy-confirm",
        isHidden: true,
        markup: stack({
          items: [
            { kind: "words", markup: html`<p id="buy-confirm-text"></p>` },
            { kind: "control", id: "buy-pin", isHidden: true, markup: cutField({ name: "purchase_pin", id: "buy-pin-field", label: "Purchase PIN", type: "password", icon: "lock", autocomplete: "off" }) },
            { kind: "control", id: "buy-password", isHidden: true, markup: cutField({ name: "password", id: "buy-password-field", label: "Password", type: "password", icon: "lock", autocomplete: "current-password" }) },
            { kind: "words", id: "buy-confirm-problem", isHidden: true, markup: html`<p></p>` },
            { kind: "words", id: "buy-switch", isHidden: true, markup: textButton("Use your password instead", { type: "button" }) },
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
      { kind: "block", id: "buy-problem", isHidden: true, markup: problemState({ title: "", text: "" }) },
      { kind: "block", id: "buy-done", isHidden: true, markup: doneState({ title: "Bought", text: "" }) },
    ],
  });
  // The foot stays in view while the body scrolls: Apple Pay or Google Pay when offered, the saved card, the line the EU's law asks for, and Buy.
  const foot = stack({
    items: [
      { kind: "block", id: "buy-wallet", isHidden: true, markup: html`<div id="buy-wallet-element"></div>` },
      { kind: "control", id: "buy-wallet-stand-in", isHidden: true, markup: cutButton("Apple Pay", { type: "button", isFullWidth: true }) },
      { kind: "control", id: "buy-other-card", isHidden: true, markup: cardRow("", { type: "button", hiddenText: "Use another card" }) },
      // Digital content delivered at once loses the 14-day withdrawal right only with the buyer's acknowledgement, said before they buy.
      { kind: "words", id: "buy-eu", isHidden: true, markup: html`<p>You get it now, so you can't cancel it in the next 14 days.</p>` },
      { kind: "control", markup: runButton("Buy", { id: "buy-go", type: "button", busyLabel: "Buying", isFullWidth: true, trailingText: "", isHidden: true }) },
      { kind: "block", id: "buy-guest-buttons", isHidden: true, markup: row({ widths: "equal", items: [{ kind: "control", markup: cutButton("Sign in", { id: "buy-sign-in", href: options.signInHref, dataAttributes: { "buy-sign-in": "/signin" } }) }, { kind: "control", markup: runButton("Make an account", { id: "buy-join", href: options.joinHref, dataAttributes: { "buy-sign-in": "/join" } }) }] }) },
      { kind: "control", markup: cutButton("Back to the game", { id: "buy-back", type: "submit", formMethod: "dialog", isFullWidth: true, isHidden: true }) },
    ],
  });
  return storePanel({ id: "buy-sheet", title: "Buy", closeLabel: "Close", body, foot });
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
const itemWords = byId("buy-item-words");
// The body's moments and the foot's parts, each shown or hidden by showCells.
const CELLS = ["buy-loading", "buy-card", "buy-confirm", "buy-guest", "buy-message", "buy-problem", "buy-done", "buy-wallet", "buy-wallet-stand-in", "buy-other-card", "buy-eu", "buy-guest-buttons"];
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
let confirmMethod = null;
// Whether pressing Buy has opened the confirm step (only when the start answer gave a confirmation_reason).
let isAsking = false;
let cardForm = null;
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
  // The cover stays across the top in every moment; the item's words show once the price is known and there is something to buy.
  itemWords.hidden = !isItemShown;
}
function showButtons(buttons) {
  const wasGoHidden = go.hidden;
  back.hidden = !buttons.includes("back");
  go.hidden = !buttons.includes("go");
  if (buttons.includes("go") && wasGoHidden) holdBuy();
  syncGo();
}
// Whether Buy can be pressed: not while paying, not in its first moments on screen, and not once the confirm step is open with no way to confirm.
function syncGo() { go.disabled = isBusy || isHeld || (moment === "confirm" && !confirmMethod); }
// Whether this buy must be confirmed first. The start answer's confirmation_reason says why, or is null when pressing Buy is enough; an older
// answer without one, or the pay call asking again, still needs it when is_confirmation_needed says so.
const needsConfirm = () => sale.is_confirmation_needed && sale.confirmation_reason !== null;
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

// Stripe.js comes from js.stripe.com only when the sheet needs it (a card to enter, a wallet, 3-D Secure), never with the page.
let stripeScript = null;
const stripes = {};
function stripeFor(stripeAccountId) {
  stripeScript = stripeScript || new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://js.stripe.com/v3/";
    script.onload = () => resolve(window.Stripe);
    script.onerror = () => { stripeScript = null; reject(new Error("Stripe didn't load")); };
    document.head.appendChild(script);
  });
  return stripeScript.then((Stripe) => stripes[stripeAccountId || ""] || (stripes[stripeAccountId || ""] = Stripe(buyData.stripe_publishable_key, stripeAccountId ? { stripeAccount: stripeAccountId } : undefined)));
}
const stripeLook = () => ({ theme: matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "stripe", variables: { fontFamily: getComputedStyle(document.body).fontFamily, borderRadius: "10px" } });

function open(asked) {
  if (asking) finish();
  asking = asked;
  ended = { status: "cancelled", purchase: null, error: null };
  latestPurchase = null;
  tell(asked, "open");
  const keep = byId("keep");
  if (keep) keep.hidden = true;
  if (!buySheet.open) buySheet.showModal();
  start();
}

async function start() {
  const asked = asking;
  sale = null;
  ended = { status: "cancelled", purchase: null, error: null };
  latestPurchase = null;
  moment = "loading";
  isAsking = false;
  title.textContent = "Buy";
  busy(false);
  showCells(["buy-loading"], false);
  showButtons([]);
  const body = { item_name: asked.itemName, item_count: asked.itemCount, game_account_id: asked.gameAccountId };
  if (buyData.tester_token) body.tester_token = buyData.tester_token;
  if (buyData.is_preview && /^[A-Z]{2}$/.test(query.get("preview_country") || "")) body.preview_country_code = query.get("preview_country");
  const answer = await call("/api/buy/" + buyData.slug + "/start", body);
  if (asking !== asked) return;
  if (answer.error) return refused(answer.error);
  sale = answer;
  byId("buy-item-name").textContent = sale.item.title + (sale.item_count > 1 ? " × " + sale.item_count : "");
  byId("buy-item-price").textContent = sale.price.price_text;
  byId("buy-item-description").textContent = sale.item.description || "";
  byId("buy-item-note").textContent = ["Sold by " + sale.seller.business_name + ".", sale.refund_policy_words].filter(Boolean).join(" ");
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
  byId("buy-guest-text").textContent = "Your game keeps running while you make one or sign in, and you come back to this.";
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

// The saved card and Buy: pressing Buy is the confirmation, so the confirm step opens (isAsking) only once Buy is pressed and the start
// answer said why. Wallets and EU wording sit with it in the foot.
function ready(confirmProblem) {
  moment = isAsking ? "confirm" : "ready";
  busy(false);
  byId("buy-other-card").querySelector(".face > span").textContent = cardWords(sale.saved_card);
  const shown = ["buy-other-card"];
  if (isAsking) {
    shown.push("buy-confirm");
    pickConfirm(confirmMethod);
    const problemCell = byId("buy-confirm-problem");
    problemCell.hidden = !confirmProblem;
    problemCell.querySelector("p").textContent = confirmProblem || "";
  }
  showWallet(shown);
  if (sale.is_eu_withdrawal_line_shown) shown.push("buy-eu");
  showCells(shown, true);
  goLabel.textContent = "Buy";
  showButtons(["go"]);
  if (isAsking) revealConfirm();
}
// The confirm step opens under the item, below the fold on a short screen: bring it into view, and the field into reach.
function revealConfirm() {
  byId("buy-confirm").scrollIntoView({ block: "nearest" });
  const field = confirmMethod === "purchase_pin" ? byId("buy-pin-field") : confirmMethod === "password" ? byId("buy-password-field") : null;
  if (field) field.focus({ preventScroll: true });
}

// Why the player is asked to confirm it's them, in the start answer's words (an older answer, or the pay call asking, has no reason).
const REASON_WORDS = {
  purchase_pin: "Your account asks for your purchase PIN for every buy.",
  old_sign_in: "It's been a while since you signed in here. Confirm it's you to buy.",
  big_spend: "That's a lot for one day. Confirm it's you to buy.",
};
// How Buy confirms it's you: a passkey, then the purchase PIN, then the password; the player can switch to the password.
function pickConfirm(method) {
  const methods = sale.confirmation_methods;
  const can = { passkey: methods.has_passkey, purchase_pin: methods.has_purchase_pin && !methods.is_purchase_pin_locked, password: methods.has_password };
  confirmMethod = method && can[method] ? method : ["passkey", "purchase_pin", "password"].find((each) => can[each]) || null;
  const reason = sale.confirmation_reason;
  // A purchase PIN's sentence is about the PIN; confirming another way, the account only asks to confirm.
  const why = reason === "purchase_pin" && confirmMethod !== "purchase_pin" ? "Your account asks you to confirm every buy." : REASON_WORDS[reason] || "Confirm it's you to buy.";
  byId("buy-confirm-text").textContent = confirmMethod ? why + (confirmMethod === "passkey" ? " Use your passkey." : "") : "To buy with your saved card, add a passkey or a purchase PIN in your account first. Apple Pay and Google Pay work without one.";
  byId("buy-pin").hidden = confirmMethod !== "purchase_pin";
  byId("buy-password").hidden = confirmMethod !== "password";
  const other = confirmMethod !== "password" && can.password ? "password" : confirmMethod === "password" && can.purchase_pin ? "purchase_pin" : confirmMethod === "password" && can.passkey ? "passkey" : null;
  byId("buy-switch").hidden = !other;
  byId("buy-switch").dataset.method = other || "";
  byId("buy-switch").querySelector(".text-label").textContent = other === "password" ? "Use your password instead" : other === "purchase_pin" ? "Use your purchase PIN instead" : "Use your passkey instead";
}
byId("buy-switch").querySelector("button").addEventListener("click", () => { confirmMethod = byId("buy-switch").dataset.method; ready(); });
byId("buy-other-card").querySelector("button").addEventListener("click", () => enterCard());

async function confirmIt() {
  let body;
  if (confirmMethod === "passkey") {
    // The passkeys script's tap (passkeys.ts), made for a purchase.
    const tapped = await zaismaPasskeyTap("purchase");
    if (tapped.error) return tapped.error;
    const tap = tapped.tap;
    body = { passkey_tap: { id: tap.passkey_id, clientDataJSON: tap.client_data_json, authenticatorData: tap.authenticator_data, signature: tap.signature, userHandle: tap.user_handle } };
  } else if (confirmMethod === "purchase_pin") {
    body = { purchase_pin: byId("buy-pin-field").value };
  } else {
    body = { password: byId("buy-password-field").value };
  }
  const answer = await call("/api/buy/confirm", body);
  if (!answer.error) { sale.is_confirmation_needed = false; return null; }
  if (answer.error.code === "purchase_pin_locked") { sale.confirmation_methods.is_purchase_pin_locked = true; confirmMethod = "password"; }
  return answer.error.message;
}

async function buyWithSavedCard() {
  // Pressing Buy asks first only when the start answer said why; the next press confirms and pays.
  if (needsConfirm() && !isAsking) { isAsking = true; return ready(); }
  busy(true);
  if (needsConfirm()) {
    const confirmProblem = await confirmIt();
    if (confirmProblem) return ready(confirmProblem);
  }
  paid(await call("/api/buy/purchases/" + sale.purchase_id + "/pay-with-saved-card"));
}

async function paid(answer) {
  if (answer.error) {
    if (answer.error.code === "purchase_confirmation_needed") { sale.is_confirmation_needed = true; isAsking = true; return ready(answer.error.message); }
    if (answer.error.code === "payment_declined") return declined(answer.error.message);
    return problem("Couldn't buy it", answer.error.message);
  }
  if (answer.purchase) latestPurchase = answer.purchase;
  if (answer.status === "completed") return bought(answer.purchase);
  if (answer.status === "action_needed") {
    waiting("Your bank asks you to confirm");
    try {
      const stripe = await stripeFor(answer.stripe_account_id);
      const result = await stripe.handleNextAction({ clientSecret: answer.client_secret });
      if (result.error) return declined(result.error.message);
    } catch {
      return problem("Couldn't reach your bank", "Nothing was charged. Try again.");
    }
    return settle();
  }
  problem("Couldn't buy it", "Zaisma didn't answer. Check your connection and try again.");
}

function waiting(words) {
  moment = "waiting";
  byId("buy-loading").querySelector(".loading-label").textContent = words;
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
  byId("buy-done").querySelector(".state-text").textContent = sale.item.title + " is yours. The receipt is on its way by email.";
  showCells(["buy-done"], false);
  showButtons(["back"]);
  setTimeout(() => { if (moment === "bought" && buySheet.open) buySheet.close(); }, BOUGHT_SHOWN_MS);
}

// No saved card: the email for receipts and Stripe's card form; the card is saved to the player's Zaisma account (Stripe keeps it), then
// paid with like any saved card.
function enterCard() {
  moment = "card";
  isAsking = false;
  busy(false);
  const shown = ["buy-card"];
  byId("buy-card-form").hidden = buyData.stripe_mode !== "stripe";
  byId("buy-test-card").hidden = buyData.stripe_mode !== "stand_in";
  showWallet(shown);
  if (sale.is_eu_withdrawal_line_shown) shown.push("buy-eu");
  showCells(shown, true);
  goLabel.textContent = "Buy";
  // The stand-in has no form: its test card button saves a card, and Buy is the saved card's.
  showButtons(buyData.stripe_mode === "stripe" ? ["go"] : []);
  if (buyData.stripe_mode === "stripe" && !cardForm) {
    cardForm = stripeFor(null).then((stripe) => {
      const elements = stripe.elements({ mode: "setup", currency: sale.price.currency_code, paymentMethodTypes: ["card"], appearance: stripeLook() });
      const element = elements.create("payment", { wallets: { applePay: "never", googlePay: "never" } });
      element.mount("#buy-card-element");
      return { stripe: stripe, elements: elements };
    }).catch(() => { cardForm = null; problem("Couldn't load the card form", "Check your connection and try again."); return null; });
  }
}

async function saveCard() {
  busy(true);
  const receiptEmail = byId("buy-receipt-email").value.trim();
  let form = null;
  if (buyData.stripe_mode === "stripe") {
    form = await cardForm;
    if (!form) return;
    const submitted = await form.elements.submit();
    if (submitted.error) return busy(false);
  }
  const setup = await call("/api/payment-methods/setup", receiptEmail ? { receipt_email: receiptEmail } : {});
  if (setup.error) return problem("Couldn't save your card", setup.error.message);
  if (form) {
    const confirmed = await form.stripe.confirmSetup({ elements: form.elements, clientSecret: setup.client_secret, confirmParams: { return_url: location.href }, redirect: "if_required" });
    if (confirmed.error) { busy(false); return; }
  }
  const saved = await call("/api/payment-methods/saved", { setup_intent_id: setup.setup_intent_id });
  if (saved.error) return problem("Couldn't save your card", saved.error.message);
  sale.saved_card = saved.saved_card;
  // Saved: Buy was pressed for it, so it takes it from here, asking first only when the start answer said why.
  if (needsConfirm()) { isAsking = true; return ready(); }
  buyWithSavedCard();
}
byId("buy-test-card").querySelector("button").addEventListener("click", () => saveCard());

// Apple Pay and Google Pay, on the developer's account: the wallet asks for Face ID or a fingerprint itself, so Zaisma doesn't, and its
// email gets the receipt. The local preview can't show them, so ?preview_wallet=1 draws their place.
function showWallet(shown) {
  if (buyData.is_preview && query.get("preview_wallet") === "1") return shown.push("buy-wallet-stand-in");
  if (buyData.stripe_mode !== "stripe" || !sale.wallet) return;
  if (wallet && wallet.purchaseId === sale.purchase_id) { if (wallet.isAvailable) shown.push("buy-wallet"); return; }
  const forSale = sale;
  wallet = { purchaseId: forSale.purchase_id, isAvailable: false };
  stripeFor(forSale.wallet.stripe_account_id).then((stripe) => {
    const elements = stripe.elements({ mode: "payment", amount: forSale.price.price_minor_units, currency: forSale.price.currency_code, appearance: stripeLook() });
    const element = elements.create("expressCheckout", { emailRequired: true, paymentMethods: { applePay: "always", googlePay: "always", link: "never", paypal: "never", amazonPay: "never" } });
    element.on("ready", (event) => {
      if (!event.availablePaymentMethods || sale !== forSale) return;
      wallet.isAvailable = true;
      if (moment === "ready" || moment === "confirm" || moment === "card") byId("buy-wallet").hidden = false;
    });
    element.on("confirm", async () => {
      waiting("Paying");
      const intent = await call("/api/buy/purchases/" + forSale.purchase_id + "/wallet-intent");
      if (intent.error) return problem("Couldn't buy it", intent.error.message);
      const result = await stripe.confirmPayment({ elements: elements, clientSecret: intent.client_secret, confirmParams: { return_url: location.href }, redirect: "if_required" });
      if (result.error) return declined(result.error.message);
      settle();
    });
    element.mount("#buy-wallet-element");
  }).catch(() => {});
}
byId("buy-wallet-stand-in").querySelector("button").addEventListener("click", () => {
  setText("buy-message", "Apple Pay and Google Pay show here on zaisma.com. The preview can't run them.");
  byId("buy-message").hidden = false;
});

go.addEventListener("click", () => {
  if (isBusy || isHeld) return;
  if (moment === "ready" || moment === "confirm") return buyWithSavedCard();
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
    const request = { requestNumber: asked.requestNumber, itemName: asked.itemName, itemCount: typeof asked.itemCount === "number" ? asked.itemCount : 1, gameAccountId: typeof asked.gameAccountId === "string" ? asked.gameAccountId : null, tell: reply };
    if (!hasPlayerTap()) return tell(request, "error", { code: "needs_player_tap", message: "The buy sheet opens only right after the player taps or presses a key in the game: call Zaisma.items.buy from that tap's handler." });
    open(request);
  };
} else {
  // The window answers only the game's own site the server named (opener_origin); any other opener hears nothing, and the game sees the
  // purchase in its next pass.
  const asked = buyData.asked;
  const opener = window.opener;
  const reply = (message) => { if (opener && buyData.opener_origin) opener.postMessage(message, buyData.opener_origin); };
  open({ requestNumber: asked.request_number, itemName: asked.item_name, itemCount: asked.item_count, gameAccountId: asked.game_account_id, tell: reply });
}

// The local preview opens the sheet with no tap in a game, and draws the moments it can't reach (a decline, 3-D Secure), for the layout
// check and Screens.
if (buyData.is_preview) {
  window.showBuyMoment = (name, itemName) => {
    if (name === "open") return open({ requestNumber: 0, itemName: itemName, itemCount: 1, gameAccountId: null, tell: () => {} });
    if (name === "declined") return declined("Your card was declined.");
    if (name === "three_d_secure") return waiting("Your bank asks you to confirm");
    // Buy pressed once, as a player would: it opens the confirm step where the account asks for one (and charges at once where it doesn't, so
    // the check only presses it for an account that asks). A first card is saved with the stand-in's test card first.
    if (name === "press_buy") { isHeld = false; syncGo(); return go.click(); }
    if (name === "save_test_card") return byId("buy-test-card").querySelector("button").click();
  };
}
})();`);

/** Which Stripe the sheet uses here: the preview's stand-in only on a local site (stripe.ts refuses it anywhere else too). */
export function buySheetStripe(env: Env): Pick<BuySheetData, "stripe_mode" | "stripe_publishable_key" | "is_preview"> {
  const isPreview = isLocalPreview(env);
  const stripeMode = env.STRIPE_API_ORIGIN && isPreview ? "stand_in" : env.STRIPE_PUBLISHABLE_KEY ? "stripe" : "off";
  return { stripe_mode: stripeMode, stripe_publishable_key: stripeMode === "stripe" ? env.STRIPE_PUBLISHABLE_KEY ?? null : null, is_preview: isPreview };
}

/** The sheet's data, typed: the page puts it beside the sheet. */
export const buySheetData = (sheetData: BuySheetData): Raw => pageData("buy-sheet-data", sheetData);
