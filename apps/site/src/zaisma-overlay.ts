import { gallerySheet } from "./components/gallery-sheet.ts";
import { action, secondaryButton, primaryButton, textLink, visibilityButton } from "./components/actions.ts";
import { copyField } from "./components/inputs.ts";
import { cutField } from "./components/fields.ts";
import { listRows, stateNote } from "./components/data.ts";
import { icon } from "./components/icons.ts";
import { row, stack, stackOfOne, type LayoutItem, type LayoutMarkup } from "./components/layout.ts";
import { notice, sheet, type SheetStep } from "./components/panes.ts";
import { zaismaOverlay } from "./components/playing.ts";
import { html, NO_EMPTY_NOTE, type Raw } from "./markup.ts";
import { pageScript } from "./page-scripts.ts";
import { ROOM_CODE_TYPING } from "./rooms.ts";
import { NOTICE_STAY_MS } from "./components/layers.ts";

/** The hint a mouse gets when play starts. */
export const HINT_WORDS = "Shift Tab for Zaisma";

/** What went by waits in the Inbox for the page's life: in memory, at most this many. */
const MAXIMUM_INBOX_NOTICE_COUNT = 30;

/** The room's code with Copy, and Join by code, in Room: for a game on Zaisma's rooms. */
export const roomCodeItems = (): LayoutItem[] => [
  { kind: "block", id: "room-here", isHidden: true, markup: stack({ items: [
    { kind: "block", id: "room-code-shown", markup: copyField({ id: "room-code-text", label: "This room", copiedText: "", isCode: true }) },
    { kind: "control", markup: visibilityButton({ show: "Show the room code", hide: "Hide the room code" }, { id: "room-eye", type: "button", isContentHidden: false, isHidden: true }) },
    { kind: "words", id: "room-closed", isHidden: true, markup: html`<p>This room doesn't take new players.</p>` },
  ] }) },
  { kind: "block", markup: row({ widths: "fit", label: "Join a room", items: [
    { kind: "control", markup: cutField({ id: "bar-join-code", name: "room", label: "Join a room by its code", type: "text", icon: "hash", placeholder: "ABC234", isShort: true, autocomplete: "off", ...ROOM_CODE_TYPING }) },
    { kind: "control", markup: secondaryButton(action("join"), { id: "room-join", type: "submit" }) },
  ] }) },
];

export const leaveSheet = gallerySheet<{ title: string }>({
  name: "Leave sheet",
  slug: "leave-sheet",
  summary: "Leaving a running game from the overlay, on purpose: never by a stray press.",
  states: [{ stateValue: "asking", label: "Asking", options: { title: "Neon Drift" } }],
  make: (options, isShown) => sheet({ isShown, id: "leave-sheet", title: `Leave ${options.title}?`, placement: "middle", closeLabel: "Close", body: stackOfOne(html`<p>You'll go to its page. Your room carries on without you.</p>`, "words"), buttons: [secondaryButton("Keep playing", { id: "leave-stay", type: "submit", formMethod: "dialog" }), primaryButton(action("leave"), { id: "leave-confirm", type: "button", isAutofocused: true })] }),
});

// An iPhone gives a web page no full screen, only a page opened from its Home Screen the whole of it, so Full screen shows the way there.
export const fullScreenSheet = gallerySheet<Record<string, never>>({
  name: "Full screen sheet",
  slug: "full-screen-sheet",
  summary: "The way to the Home Screen, on an iPhone, where a page has no full screen of its own.",
  states: [{ stateValue: "steps", label: "Open", options: {} }],
  make: (sheetOptions, isShown) => sheet({
    isShown,
    id: "full-screen-sheet",
    title: "Full screen on iPhone",
    placement: "middle",
    closeLabel: "Close",
    isFillingSideways: true,
    body: stack({ items: [
      { kind: "words", markup: html`<p>An iPhone only gives Zaisma the whole screen from its Home Screen.</p>` },
      { kind: "block", markup: listRows({ whenEmpty: NO_EMPTY_NOTE, label: "The steps", isAcrossSideways: true, rows: [
        { title: "1. Tap Share in your browser", lead: icon("share") },
        { title: "2. Add to Home Screen", lead: icon("plus") },
        { title: "3. Open Zaisma from there", lead: icon("apps") },
      ] }) },
      { kind: "words", markup: html`<p>Sign in there to bring your account. Progress kept only in this browser stays here.</p>` },
    ] }),
  }),
});

/** The Zaisma overlay as a game's page has it, with Leave's sheet and what its script fills the Inbox from. */
export function gameOverlay(options: { title: string; people: { roomBody: LayoutMarkup; friendsBody: LayoutMarkup; playerStep: SheetStep }; gameBody: LayoutMarkup; reportStep: SheetStep; isPlayedAlone: boolean }): Raw {
  const menu = zaismaOverlay({
    title: options.title,
    isPlayedAlone: options.isPlayedAlone,
    roomBody: options.people.roomBody,
    friendsBody: options.people.friendsBody,
    gameBody: options.gameBody,
    inboxBody: stack({ items: [
      { kind: "block", markup: listRows({ whenEmpty: stateNote({ stateKind: "empty", text: "Notices you miss wait here.", textId: "inbox-note" }), isCompact: true, rows: [], id: "inbox-list", label: "What went by" }) },
      { kind: "block", id: "inbox-clear", isHidden: true, markup: row({ widths: "fit", alignment: "end", items: [{ kind: "control", markup: secondaryButton("Clear all", { id: "inbox-clear-button", type: "button", isSmall: true }) }] }) },
    ] }),
    tools: [
      secondaryButton(action("share"), { id: "share", type: "button", isLabelHidden: true, isSmall: true, controls: "share-dialog" }),
      secondaryButton(action("fullScreen"), { id: "full", type: "button", isLabelHidden: true, isSmall: true }),
    ],
    leave: secondaryButton(action("leave"), { id: "zaisma-leave", type: "button", isSmall: true, dataAttributes: { "zaisma-leave": "" } }),
    laterSteps: [
      options.people.playerStep,
      options.reportStep,
    ],
  });
  return html`${menu}
${leaveSheet({ title: options.title })}
${fullScreenSheet({})}
<template id="inbox-row">${listRows({ whenEmpty: NO_EMPTY_NOTE, isCompact: true, rows: [{ title: "?", detail: "?" }] })}</template>
<template id="inbox-press-row">${listRows({ whenEmpty: NO_EMPTY_NOTE, isCompact: true, rows: [{ title: "?", detail: "?", press: { hasChevron: true } }] })}</template>`;
}

interface AccountCardOptions {
  title: string;
  joinHref: string;
  signInHref: string;
  isShown?: boolean;
}

/** Keep your progress: a guest's saves are only in this browser. */
export const keepProgressCard = (options: AccountCardOptions): Raw =>
  notice({ placement: "over-game",
    id: "keep",
    title: "Keep your progress",
    isShown: options.isShown,
    strip: { words: "Keep your progress", action: primaryButton("Make an account", { href: options.joinHref, isSmall: true, dataAttributes: { keep: "/join" } }), closePresses: "keep-later", isFolding: true, isMarkedWhenClosed: true },
    body: stack({ items: [
      { kind: "words", id: "save-status", isHidden: true, markup: html`<p role="status"></p>` },
      { kind: "words", markup: html`<p>Your ${options.title} progress is only saved in this browser. Make a free account to keep it safe and play on any device.</p>` },
      { kind: "block", markup: row({ widths: "equal", items: [{ kind: "control", markup: primaryButton("Make an account", { href: options.joinHref, dataAttributes: { keep: "/join" } }) }, { kind: "control", markup: secondaryButton("Not now", { id: "keep-later", type: "button" }) }] }) },
      { kind: "words", markup: html`<p>Have an account? ${textLink("Sign in", options.signInHref, { dataAttributes: { keep: "/signin" } })}</p>` },
    ] }),
  });

/** A game asking a guest to sign in. */
export const signInAskCard = (options: AccountCardOptions): Raw =>
  notice({ placement: "over-game",
    id: "sign-in-ask",
    title: `${options.title} asks you to sign in`,
    isShown: options.isShown,
    strip: { words: `${options.title} asks you to sign in`, action: primaryButton(action("signIn"), { href: options.signInHref, isSmall: true, dataAttributes: { "sign-in": "/signin" } }), closePresses: "sign-in-later" },
    body: stack({ items: [
      { kind: "words", markup: html`<p id="sign-in-text">Make a free Zaisma account or sign in. The game keeps running here while you do.</p>` },
      { kind: "block", markup: row({ widths: "equal", items: [{ kind: "control", markup: primaryButton("Make an account", { href: options.joinHref, dataAttributes: { "sign-in": "/join" } }) }, { kind: "control", markup: secondaryButton("Not now", { id: "sign-in-later", type: "button" }) }] }) },
      { kind: "words", markup: html`<p>Have an account? ${textLink("Sign in", options.signInHref, { dataAttributes: { "sign-in": "/signin" } })}</p>` },
    ] }),
  });

/** Urgent: saving stopped because the account signed out. */
export const signedOutCard = (signInHref: string): Raw =>
  notice({ placement: "over-everything", id: "signed-out", title: "You've been signed out", text: "Sign in again to keep saving to your account.", buttons: [primaryButton(action("signIn"), { href: signInHref })], strip: { words: html`Signed out. <span class="notice-strip-note">Saving stopped</span>`, action: primaryButton(action("signIn"), { href: signInHref, isSmall: true }), isMarkedWhenClosed: true } });

/**
 * The Zaisma overlay's script (docs/DECISIONS.md, "The Zaisma overlay"; playing.ts draws it): the Zaisma button, the Inbox, a phone on its side, and Leave.
 * Nothing a game sends reaches any of it: only the player's own press or key opens the menu (docs/principles/whose-game-is-it.md).
 */
export const ZAISMA_OVERLAY_SCRIPT = pageScript(
  "zaisma-overlay",
  String.raw`(() => {
  const $ = (id) => document.getElementById(id);
  const sheet = $("players"), corner = $("zaisma-button"), opener = $("zaisma-open");
  // The Zaisma button is down once its slide has ended; left before that, it turns straight back (playing.ts).
  let arrival;
  if (corner && opener) {
    opener.addEventListener("pointerenter", (event) => { if (event.pointerType !== "mouse") return; clearTimeout(arrival); arrival = setTimeout(() => corner.classList.add("has-arrived"), 240); });
    opener.addEventListener("pointerleave", () => { clearTimeout(arrival); arrival = setTimeout(() => corner.classList.remove("has-arrived"), 800); });
  }
  if (!sheet || !corner || !opener) return;
  const frame = () => $("game");
  const isPlaying = () => document.documentElement.classList.contains("is-playing");
  const SIDEWAYS = matchMedia("(orientation: landscape) and (max-height: 500px)");
  const POINTER = matchMedia("(hover: hover) and (pointer: fine)");
  const HINT_WORDS = ${JSON.stringify(HINT_WORDS)};
  // With a mouse the Zaisma button is out of the screen, so when play starts it comes down for as long as the hint stays, to show where it lives.
  const showButtonOnce = () => {
    corner.classList.add("is-shown", "has-arrived");
    setTimeout(() => {
      corner.classList.remove("is-shown");
      arrival = setTimeout(() => { if (!opener.matches(":hover")) corner.classList.remove("has-arrived"); }, 800);
    }, ${NOTICE_STAY_MS});
  };
  // The Z shows once the game does, with the hint for a mouse. A game's own full screen is new in the top layer, so it's raised over it.
  const raise = () => { if (corner.matches(":popover-open")) corner.hidePopover(); corner.showPopover(); };
  new MutationObserver(() => {
    if (!isPlaying() || corner.matches(":popover-open")) return;
    raise();
    if (POINTER.matches && window.zaismaLayers) { zaismaLayers.say({ text: HINT_WORDS }); showButtonOnce(); }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  document.addEventListener("fullscreenchange", () => { if (!isPlaying()) return; raise(); if (window.zaismaLayers) zaismaLayers.raiseOpenSheets(); });
  const openMenu = () => { if (!sheet.open) opener.click(); };
  // Shift+Tab: with the game holding the focus it moves to the Z, which comes before the game on the page; only a real key press gets there, so no game can
  // fake it, and a game that holds Tab for itself keeps it. Anywhere else on the page it opens the menu directly.
  let isFocusInGame = false;
  addEventListener("blur", () => setTimeout(() => { isFocusInGame = document.activeElement === frame(); }));
  opener.addEventListener("focus", () => { if (isPlaying() && isFocusInGame) { isFocusInGame = false; openMenu(); } });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Tab" && event.shiftKey && isPlaying() && !document.querySelector("dialog.sheet[open]")) { event.preventDefault(); openMenu(); }
  });
  // A strip's words open the rest of what it says: closed, it's in the Inbox.
  document.addEventListener("click", (event) => {
    const words = event.target.closest && event.target.closest(".notice-strip-words"), card = words && words.closest(".playing-card");
    if (!card || !STAYS_OPEN.has(card.id)) return;
    const close = card.querySelector("[data-notice-close]");
    if (close) close.click();
    openMenu();
    const inboxTab = sheet.querySelector('[data-sheet-tab-to="inbox"]');
    if (inboxTab) inboxTab.click();
  });
  addEventListener("zaisma:notice-folded", () => corner.classList.add("has-folded"));
  opener.addEventListener("click", () => corner.classList.remove("has-folded"));
  let missed = [];
  // The Inbox: a card that went by. Words only, unless it asks something that's still open (keep your progress), when pressing it brings the card back whole.
  const NEVER_KEPT = new Set(["friend-request-card"]);
  const STAYS_OPEN = new Set(["keep", "signed-out"]);
  addEventListener("zaisma:card-left", (event) => {
    const card = event.detail && event.detail.card;
    if (!card || NEVER_KEPT.has(card.id) || !isPlaying() || card.textContent.trim() === HINT_WORDS) return;
    const asks = Boolean(card.querySelector("a, button"));
    if (asks && !STAYS_OPEN.has(card.id)) return;
    const title = card.querySelector(".playing-card-title"), words = card.querySelector(".playing-card-in p:not(:empty)");
    missed = missed.filter((each) => each.cardId !== card.id || !card.id);
    missed.unshift({ title: title ? title.textContent.trim() : words ? words.textContent.trim() : "", words: title && words ? words.textContent.trim() : "", cardId: asks ? card.id : "", atMs: Date.now() });
    missed = missed.slice(0, ${MAXIMUM_INBOX_NOTICE_COUNT});
    if (sheet.open) showInbox();
  });
  const ago = (atMs) => { const minutes = Math.round((Date.now() - atMs) / 60000); return minutes < 1 ? "Just now" : minutes === 1 ? "1 min ago" : minutes < 60 ? minutes + " min ago" : Math.round(minutes / 60) + " h ago"; };
  function showInbox() {
    const list = $("inbox-list");
    list.textContent = "";
    list.hidden = !missed.length;
    $("inbox-note").hidden = Boolean(missed.length);
    $("inbox-clear").hidden = !missed.length;
    missed.forEach((each) => {
      const item = $(each.cardId ? "inbox-press-row" : "inbox-row").content.querySelector("li").cloneNode(true);
      item.querySelector(".list-row-title").textContent = each.title;
      item.querySelector(".list-row-detail").textContent = (each.words ? each.words + " · " : "") + ago(each.atMs);
      if (each.cardId) item.querySelector("button").addEventListener("click", () => {
        missed = missed.filter((other) => other !== each);
        sheet.close();
        zaismaLayers.show($(each.cardId));
      });
      list.appendChild(item);
    });
  }
  $("inbox-clear-button").addEventListener("click", () => { missed = []; showInbox(); });
  // A phone on its side: the tabs stand up as a rail.
  function fitTabs() {
    const well = sheet.querySelector(".switch-well"), tabs = sheet.querySelector(".tab-switch");
    if (!well || !tabs) return;
    well.classList.toggle("vertical", SIDEWAYS.matches);
    well.classList.toggle("is-full", !SIDEWAYS.matches);
    well.setAttribute("data-edge-light", SIDEWAYS.matches ? "left" : "bottom");
    // Stood up, it's the sideways header's Switch: regular, and it never scrolls across.
    well.classList.toggle("scrolls-across", !SIDEWAYS.matches);
    const scroller = well.querySelector(".well-body");
    if (scroller) scroller.classList.toggle("across", !SIDEWAYS.matches);
    [well, tabs].forEach((part) => { part.classList.toggle("small", !SIDEWAYS.matches); part.classList.toggle("regular", SIDEWAYS.matches); });
    tabs.classList.toggle("vertical", SIDEWAYS.matches);
    const current = tabs.querySelector('[aria-pressed="true"]');
    if (current && tabs.pickTab) tabs.pickTab(current);
  }
  SIDEWAYS.addEventListener("change", fitTabs);
  // On a phone on its side the tabs are icons alone, so the head says which one you're on.
  const placeTabs = sheet.querySelector(".tab-switch");
  if (placeTabs) {
    const nameThePlace = () => { const current = placeTabs.querySelector('[aria-pressed="true"] > span:not(.tag)'); if (current) placeTabs.closest(".pane-parts").setAttribute("data-place-name", current.textContent.trim()); };
    new MutationObserver(nameThePlace).observe(placeTabs, { subtree: true, attributes: true, attributeFilter: ["aria-pressed"] });
    nameThePlace();
  }
  opener.addEventListener("click", () => { fitTabs(); showInbox(); });
  // Opened, focus goes to the pane itself, so no tab shows the keyboard's ring until the player presses Tab.
  sheet.setAttribute("data-takes-own-focus", "");
  const full = $("full");
  // An iPhone has no full screen for a web page, so it shows the way to the Home Screen instead. Opened from there, it's already the whole screen, and with neither there's nothing to offer.
  const isOnHomeScreen = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const isIphone = /iPhone|iPod/.test(navigator.userAgent);
  if (isOnHomeScreen || (!document.fullscreenEnabled && !isIphone)) full.hidden = true;
  // The whole page, so the Z and what it opens stay over the game.
  full.onclick = () => {
    if (!document.fullscreenEnabled) { $("full-screen-sheet").showModal(); return; }
    (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
  };
  // Leave lands on the game's page, in place of this one in the tab's history, so Back from there goes where the player was browsing.
  const leaveNow = () => location.replace(location.pathname);
  const leaveSheet = $("leave-sheet");
  $("zaisma-leave").addEventListener("click", () => leaveSheet.showModal());
  $("leave-confirm").addEventListener("click", leaveNow);
  // Keep playing goes back to the game; closing the sheet any other way only closes the sheet.
  $("leave-stay").addEventListener("click", () => sheet.close());
  sheet.addEventListener("close", () => { const f = frame(); if (f) f.focus(); });
})();`,
);
