import { PURCHASE_PIN_LIMITS } from "@zaisma/core";
import { html, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { secondaryButton, primaryButton, tertiaryButton } from "./actions.ts";
import { cutField, pinField } from "./fields.ts";
import { largeIcon, sheetMarkup, type IconName } from "./foundations.ts";
import { paneParts, row, stack } from "./layout.ts";
import "./panes.ts";

/** The ways to prove it's you: a passkey, the purchase PIN (only for a purchase), the account's password. */
export type ConfirmMethod = "passkey" | "purchase_pin" | "password";

export interface ConfirmItsYouOptions {
  /** Unique on the page: the script opens it by this (zaismaConfirmItsYou(id, …)). */
  id: string;
  /** The way it shows first. On a page the script sets it from the methods it's opened with; here, for the still copies. */
  method?: ConfirmMethod;
  /** The other ways it offers, each a button at its foot (Password, Passkey). On a page the script sets them. */
  otherMethods?: ConfirmMethod[];
  /** Why it asks, in one sentence: "Your account asks for your purchase PIN for every buy." On a page the script sets it. */
  reasonText?: string;
  /** What went wrong, under the field (under the PIN's boxes, which it marks): "That PIN isn't right. 3 tries left." */
  errorText?: string;
  /** Its proof sent and waiting: the gallery's still copy (the script does it on a page). A PIN's boxes are carved in; the other ways' Confirm shows the loader. */
  isBusy?: boolean;
  /** Open in place rather than over the page: the gallery's still copy. */
  isShown?: boolean;
}

const PIN_DIGIT_COUNT = PURCHASE_PIN_LIMITS.pinDigitCount;
const METHODS: ConfirmMethod[] = ["purchase_pin", "password", "passkey"];
/** Each way's button at the foot, and the mark its face shows while it's the way asked for. */
const METHOD_WORDS: Record<ConfirmMethod, string> = { purchase_pin: "Purchase PIN", password: "Password", passkey: "Passkey" };
const METHOD_ICONS: Record<ConfirmMethod, IconName> = { purchase_pin: "key", password: "lock", passkey: "passkey" };

/**
 * Confirm it's you: a small glass dialog that opens over anything (the store panel's Buy, the account page's changes, a key's Make) and asks the player to prove it's
 * them, in a way that suits what they're doing: a passkey, their purchase PIN (for a purchase only) or their password. The page opens it with
 * its own methods, its reason and the function that sends the proof (zaismaConfirmItsYou, CONFIRM_ITS_YOU_SCRIPT); when the proof is right the
 * dialog closes itself and the page goes on at once, so the press that asked is the only press. A purchase PIN is six boxes (the PIN field), and
 * its sixth digit sends the proof at once: that way has no Confirm of its own. The middle of the screen on a wide screen, risen from the foot
 * on a phone.
 */
export function confirmItsYouSheet(options: ConfirmItsYouOptions): Raw {
  const method = options.method ?? "password";
  const id = options.id;
  const others = options.otherMethods ?? [];
  // Its face: the way's key icon, large, on the glass; the one for the way asked for shows (the CSS, by the face's data-method).
  const face = html`${METHODS.map((each) => html`<span class="confirm-face-mark" data-face-method="${each}">${largeIcon(METHOD_ICONS[each])}</span>`)}`;
  const body = stack({
    items: [
      { kind: "block", markup: html`<div class="confirm-face" id="${id}-face" data-method="${method}">${face}<h2 class="sheet-title" id="${id}-title">Confirm it's you</h2></div>` },
      { kind: "words", id: `${id}-reason`, markup: html`<p class="confirm-reason">${options.reasonText ?? ""}</p>` },
      { kind: "control", id: `${id}-pin`, isHidden: method !== "purchase_pin", markup: pinField({ name: "purchase_pin", id: `${id}-pin-field`, label: "Your purchase PIN", digits: options.isBusy ? "246810" : undefined, isDisabled: options.isBusy, error: method === "purchase_pin" ? options.errorText : undefined }) },
      // A password form names its account for password managers and screen readers; the field stays hidden.
      { kind: "words", id: `${id}-username`, isHidden: true, markup: html`<input type="text" name="username" autocomplete="username" tabindex="-1" aria-hidden="true">` },
      { kind: "control", id: `${id}-password`, isHidden: method !== "password", markup: cutField({ name: "password", id: `${id}-password-field`, label: "Password", type: "password", icon: "lock", autocomplete: "current-password" }) },
      { kind: "words", id: `${id}-problem`, isHidden: !options.errorText || method === "purchase_pin", markup: html`<p class="confirm-problem" role="alert">${options.errorText ?? ""}</p>` },
      // A purchase PIN needs no press: its sixth digit sends it.
      { kind: "control", id: `${id}-go-cell`, isHidden: method === "purchase_pin", markup: primaryButton(method === "passkey" ? "Use your passkey" : "Confirm", { id: `${id}-go`, type: "button", busyLabel: "Confirming", isBusy: options.isBusy && method !== "purchase_pin", isFullWidth: true }) },
    ],
  });
  // The other ways, side by side at its foot; only those it offers show.
  const ways = row({ widths: "equal", items: METHODS.map((each) => ({ kind: "control" as const, markup: secondaryButton(METHOD_WORDS[each], { id: `${id}-way-${each}`, type: "button", icon: METHOD_ICONS[each], isSmall: true, isHidden: !others.includes(each) || each === method }) })) });
  const close = tertiaryButton("Close", { type: "submit", formMethod: "dialog", icon: "close", isLabelHidden: true, isSmall: true });
  return sheetMarkup({
    id,
    title: "Confirm it's you",
    titleId: `${id}-title`,
    body: html``,
    parts: paneParts({ head: { words: html``, end: close }, body: html`<div class="sheet-scroll"><div class="sheet-body scrolls to-edge confirm-body">${body}</div></div>`, foot: { start: { kind: "block", markup: ways } } }),
    closeButton: close,
    placement: "middle",
    isConfirm: true,
    // A small sheet's width and closed-up gaps, in the middle of the screen still (a middle sheet never hangs from a button).
    isCompact: true,
    isShown: options.isShown,
  });
}

/**
 * zaismaConfirmItsYou(id, options) opens the dialog a page holds (confirmItsYouSheet) and answers true, or false when it has no way to ask
 * (no methods this browser can use):
 *   methods          the ways it offers, the one to show first leading: ["purchase_pin", "passkey", "password"]
 *   reason           one sentence on why it asks
 *   passkeyPurpose   what a passkey's tap is made for (zaismaPasskeyTap's purpose: "purchase", "confirm" or "key")
 *                    A purchase PIN needs no Confirm: its sixth digit (zaisma:pin-complete) sends it.
 *   send(proof)      sends the proof and answers { ok: true } or { ok: false, message, removed_methods? }; proof is
 *                    { method: "passkey", passkey_tap: { passkey_id, client_data_json, authenticator_data, signature, user_handle } },
 *                    { method: "purchase_pin", purchase_pin } or { method: "password", password }; removed_methods drops a way (a locked PIN)
 *   onConfirmed()    called as the dialog closes on a right proof, so the page goes on with no second press
 *   onCancelled()    called when it closes without one (Cancel, Esc, a press beside it)
 * Opened by a press with a passkey first, it asks the browser at once. The passkeys script (passkeys.ts) comes first on the page.
 */
export const CONFIRM_ITS_YOU_SCRIPT = String.raw`/* confirm it's you */(function () {
  var METHODS = ["purchase_pin", "password", "passkey"];
  var PIN_DIGIT_COUNT = ${PIN_DIGIT_COUNT};
  var EMPTY_WORDS = { purchase_pin: "Enter all " + PIN_DIGIT_COUNT + " digits of your purchase PIN.", password: "Enter your password." };
  var running = new WeakMap();
  function part(id, name) { return document.getElementById(id + "-" + name); }
  // What went wrong shows under what was typed: under a PIN's boxes (which it marks), else in the dialog's own line.
  function setProblem(id, words) {
    var onPin = document.getElementById(id).dataset.method === "purchase_pin";
    var cell = part(id, "problem");
    cell.hidden = onPin || !words;
    cell.querySelector("p").textContent = onPin ? "" : words || "";
    window.zaismaPinField.setError(part(id, "pin-field"), onPin ? words : "");
  }
  function draw(dialog, id, state) {
    var method = state.method;
    part(id, "reason").querySelector("p").textContent = state.options.reason || "";
    part(id, "pin").hidden = method !== "purchase_pin";
    part(id, "password").hidden = method !== "password";
    // The other ways it offers, each a button at its foot.
    METHODS.forEach(function (each) { var way = part(id, "way-" + each); way.hidden = each === method || state.methods.indexOf(each) === -1; way.disabled = state.isBusy; });
    part(id, "go-cell").hidden = method === "purchase_pin";
    var go = part(id, "go");
    go.querySelector(".label-idle").textContent = method === "passkey" ? "Use your passkey" : "Confirm";
    if (state.isBusy) go.setAttribute("aria-busy", "true"); else go.removeAttribute("aria-busy");
    // A purchase PIN has no Confirm: its sixth digit sends it, and its boxes are carved in while it's on its way.
    go.disabled = state.isBusy;
    window.zaismaPinField.setDisabled(part(id, "pin-field"), state.isBusy && method === "purchase_pin");
    dialog.dataset.method = method;
    part(id, "face").dataset.method = method;
  }
  function clearFields(id) { window.zaismaPinField.clear(part(id, "pin-field")); part(id, "password-field").value = ""; }
  function focusField(id, state) {
    if (state.method === "purchase_pin") window.zaismaPinField.focus(part(id, "pin-field"));
    else if (state.method === "password") part(id, "password-field").focus({ preventScroll: true });
  }
  async function submit(dialog, id, state) {
    if (state.isBusy || running.get(dialog) !== state) return;
    var method = state.method, proof;
    setProblem(id, "");
    if (method === "passkey") {
      state.isBusy = true; draw(dialog, id, state);
      var tapped = await window.zaismaPasskeyTap(state.options.passkeyPurpose);
      if (tapped.error) { state.isBusy = false; draw(dialog, id, state); return setProblem(id, tapped.error); }
      proof = { method: "passkey", passkey_tap: tapped.tap };
    } else {
      var typed = method === "purchase_pin" ? window.zaismaPinField.digits(part(id, "pin-field")) : part(id, "password-field").value;
      if (!typed || (method === "purchase_pin" && typed.length < PIN_DIGIT_COUNT)) return setProblem(id, EMPTY_WORDS[method]);
      proof = method === "purchase_pin" ? { method: method, purchase_pin: typed } : { method: method, password: typed };
      state.isBusy = true; draw(dialog, id, state);
    }
    var answer;
    try { answer = await state.options.send(proof); } catch (error) { answer = { ok: false, message: "Zaisma didn't answer. Check your connection and try again." }; }
    state.isBusy = false;
    if (answer && answer.ok) {
      state.isDone = true;
      clearFields(id);
      draw(dialog, id, state);
      dialog.close();
      state.options.onConfirmed();
      return;
    }
    var removed = (answer && answer.removed_methods) || [];
    state.methods = state.methods.filter(function (each) { return removed.indexOf(each) === -1; });
    if (state.methods.indexOf(state.method) === -1) state.method = state.methods[0] || state.method;
    clearFields(id);
    draw(dialog, id, state);
    setProblem(id, (answer && answer.message) || "That didn't work. Try again.");
    focusField(id, state);
  }
  function wire(dialog, id) {
    var stateOf = function () { return running.get(dialog); };
    part(id, "go").addEventListener("click", function () { var state = stateOf(); if (state) submit(dialog, id, state); });
    METHODS.forEach(function (each) {
      part(id, "way-" + each).addEventListener("click", function () {
        var state = stateOf();
        if (!state || state.isBusy || state.methods.indexOf(each) === -1) return;
        state.method = each;
        clearFields(id); setProblem(id, ""); draw(dialog, id, state); focusField(id, state);
      });
    });
    // A PIN's sixth digit sends it, with no press.
    dialog.addEventListener("zaisma:pin-complete", function () {
      var state = stateOf();
      if (state && state.method === "purchase_pin") submit(dialog, id, state);
    });
    // Enter sends the proof, never a way's button at the foot.
    dialog.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return;
      event.preventDefault();
      var state = stateOf();
      if (state) submit(dialog, id, state);
    });
    // Nothing closes it while a proof is on its way, so a right one is never left half done.
    dialog.addEventListener("cancel", function (event) { var state = stateOf(); if (state && state.isBusy) event.preventDefault(); });
    dialog.addEventListener("close", function () {
      var state = stateOf();
      running.delete(dialog);
      clearFields(id);
      if (state && !state.isDone && state.options.onCancelled) state.options.onCancelled();
    });
  }
  window.zaismaConfirmItsYou = function (id, options) {
    var dialog = document.getElementById(id);
    if (!dialog) return false;
    if (dialog.open) return true;
    var methods = options.methods.filter(function (method) { return method !== "passkey" || (window.PublicKeyCredential && window.zaismaPasskeyTap); });
    if (!methods.length) return false;
    var state = { options: options, methods: methods, method: methods[0], isBusy: false, isDone: false };
    if (!dialog.dataset.confirmWired) { dialog.dataset.confirmWired = "1"; wire(dialog, id); }
    running.set(dialog, state);
    clearFields(id); setProblem(id, "");
    draw(dialog, id, state);
    dialog.classList.remove("is-leaving");
    // A passkey leading and a press behind the opening: ask the browser at once.
    var isPressed = !navigator.userActivation || navigator.userActivation.isActive;
    dialog.showModal();
    if (state.method === "passkey" && isPressed) submit(dialog, id, state); else focusField(id, state);
    return true;
  };
})();
`;

const PIN_REASON = "Your account asks for your purchase PIN for every buy.";

component({
  name: "Confirm it's you",
  slug: "confirm-its-you",
  group: "panes",
  subgroup: "layers",
  summary: "A small dialog that opens over anything and asks the player to prove it's them, the way that suits what they're doing: a passkey, their purchase PIN (for a purchase only) or their password. The page says why in one sentence and gives it the function that sends the proof; a right proof closes it and the page goes on by itself, so the button that asked is pressed once. In the middle of a wide screen, risen from the foot on a phone.",
  styles: `
/* Confirm it's you: a small sheet that stays in the middle of a wide screen whatever opened it (LAYERS_SCRIPT), its title a section's size. */
.sheet.is-compact .confirm-face > .sheet-title { font: var(--type-section); }
/* Its face starts at a pane's margin from the top, beside Close rather than under its row: the head (Close alone) gives back its height and
   the gap under it. */
.pane-parts:has(> .pane-body .confirm-body) > .pane-head { margin-bottom: calc(var(--pad-pane) - var(--pad-frame) - var(--control-height-small) - var(--gap-block-block)); }
/* What it asks and why, apart from the way to answer it: a block's gap between them. */
.confirm-body [id$="-reason"] { margin-bottom: calc(var(--gap-block-block) - var(--gap-control-stack)); }
/* What went wrong is a warning, never the runner's orange. */
.confirm-problem { margin: 0; font: var(--type-words); color: var(--warning); }
/* Its face, title, words and PIN centered under one another, like a lock asking to be opened; a password field and the button keep the width. */
.confirm-body { text-align: center; }
.confirm-face { display: flex; flex-direction: column; align-items: center; gap: var(--gap-words-control); }
.confirm-face-mark { display: none; }
.confirm-face[data-method="purchase_pin"] [data-face-method="purchase_pin"], .confirm-face[data-method="password"] [data-face-method="password"], .confirm-face[data-method="passkey"] [data-face-method="passkey"] { display: flex; }
.confirm-body .pin-field { align-items: center; }
.confirm-body .cut-field { text-align: start; }
`,
  render: confirmItsYouSheet,
  examples: [
    {
      label: "Try it: the purchase PIN is 246810 and the password is password; anything else is wrong, and says the tries left",
      markup: html`${secondaryButton("Buy Revive", { type: "button", dataAttributes: { "confirm-example": "example-confirm-its-you-try" } })}${confirmItsYouSheet({ id: "example-confirm-its-you-try" })}`,
    },
    { label: "Purchase PIN: six marks, sent by the sixth digit, and the other ways at its foot", isStill: true, markup: confirmItsYouSheet({ id: "example-confirm-its-you-pin", method: "purchase_pin", otherMethods: ["password", "passkey"], reasonText: PIN_REASON, isShown: true }) },
    { label: "Password", isStill: true, markup: confirmItsYouSheet({ id: "example-confirm-its-you-password", method: "password", otherMethods: ["passkey"], reasonText: "It's been a while since you signed in here.", isShown: true }) },
    { label: "Passkey: one button, and the browser asks at once", isStill: true, markup: confirmItsYouSheet({ id: "example-confirm-its-you-passkey", method: "passkey", otherMethods: ["password"], reasonText: "That's a lot for one day.", isShown: true }) },
    { label: "A wrong PIN: the tries left", isStill: true, markup: confirmItsYouSheet({ id: "example-confirm-its-you-wrong", method: "purchase_pin", otherMethods: ["password"], reasonText: PIN_REASON, errorText: "That PIN isn't right. 3 tries left.", isShown: true }) },
    { label: "Purchase PIN sent, waiting", isStill: true, markup: confirmItsYouSheet({ id: "example-confirm-its-you-busy", method: "purchase_pin", otherMethods: ["password"], reasonText: PIN_REASON, isBusy: true, isShown: true }) },
    { label: "Password sent, waiting", isStill: true, markup: confirmItsYouSheet({ id: "example-confirm-its-you-password-busy", method: "password", otherMethods: ["passkey"], reasonText: "It's been a while since you signed in here.", isBusy: true, isShown: true }) },
  ],
});
