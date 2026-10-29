import { html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import type { ControlMarkup } from "./control-markup.ts";
import { secondaryButton, primaryButton, tertiaryButton, textLink } from "./actions.ts";
import { CUT_LINE, EDGE, logo } from "./foundations.ts";
import { grid, row, stack } from "./layout.ts";
import { gameCover, sheet, type GameCoverOptions } from "./panes.ts";

/*
 * A game's page: its screenshots, the game cards of every list of games (Browse, More from a developer), and playing it. Playing is the page once Play is pressed. The game fills the screen; Zaisma keeps one slim bar of glass beside it (above it, or down
 * the left edge of a landscape phone) and a card over its corner when something needs the player (keep your progress, sign in). Everything
 * else on the page steps aside: the header, the background, the page's panes and the footer. The page's script turns it on by putting
 * is-playing on <html> and adding the game's frame (class game-frame) to the body.
 */

export interface PlayingBarOptions {
  /** The game's name, beside Zaisma's mark (wide screens only: a phone needs the room for the buttons). */
  title: string;
  /** Its buttons, small and icon-only, in order: Players, Keep progress, Room, the connection, Share, Full screen, More. */
  controls: ControlMarkup[];
  /** Shown where it is rather than only while playing: the gallery's still copy. */
  isShown?: boolean;
}

/** The bar beside a running game: Zaisma's mark (back to every game), the game's name, and the game's buttons. */
export function playingBar(options: PlayingBarOptions): Raw {
  return html`<div class="playing-bar glass glass-bar at-screen-edge${options.isShown ? " in-place" : ""}" data-glass data-glass-corners="0 0 0 0">${EDGE}${logo("mark")}<strong class="playing-title one-line">${options.title}</strong><div class="playing-controls">${row({ widths: "fit", label: "The game's buttons", items: options.controls.map((control) => ({ kind: "control" as const, markup: control })) })}</div></div>`;
}

export interface PlayingCardOptions {
  /** Unique on the page: the script shows and hides it by its id. */
  id: string;
  /** What it's about: its heading, and its name for a screen reader. Left out, it's one line of news (role status), like Saved. */
  title?: string;
  /** Its words and buttons, laid out with the layout components. */
  body: Raw;
  /**
   * How it waits its turn over the game (zaismaLayers): "information" leaves by itself and waits behind asks, "ask" stays until it's
   * answered. Left out, a card with nothing to press is information and any other an ask.
   */
  noticeUrgency?: "information" | "ask";
  /** Open in place, as the gallery's still copies are; over a game the page's script shows it through zaismaLayers.show, never by itself. */
  isShown?: boolean;
  /** Where it is in the gallery, rather than over the game's corner. */
  isInPlace?: boolean;
}

/** A card of glass over a running game's top corner, for what needs the player now (keep your progress, a game asking them to sign in) or what just happened (Saved). */
export function playingCard(options: PlayingCardOptions): Raw {
  const named = options.title ? html` aria-labelledby="${options.id}-title"` : raw(' role="status"');
  const urgency = options.noticeUrgency ? html` data-notice-urgency="${options.noticeUrgency}"` : "";
  return html`<aside class="playing-card glass${options.isInPlace ? " in-place" : ""}" id="${options.id}"${named}${urgency} data-glass data-glass-corners="pane"${options.isShown ? "" : raw(" hidden")}>${EDGE}<div class="playing-card-in">${options.title ? html`<h2 class="playing-card-title" id="${options.id}-title">${options.title}</h2>` : ""}${options.body}</div></aside>`;
}

export interface UrgentCardOptions {
  /** Unique on the page: a page's script says it by its id (zaismaLayers.say({ cardId })). */
  id: string;
  /** What happened: "You've been signed out". */
  title: string;
  /** What it means now, in one or two sentences: "Nothing was charged. Sign in again to buy." */
  text: string;
  /** What the player can do about it (Sign in); Close is always there. */
  buttons?: ControlMarkup[];
  /** The sheets that can't go on under it (the buy sheet and its Confirm it's you after a sign-out): they close as it shows. */
  sheetsToClose?: string[];
  /** Where it is in the gallery: shown in place rather than over everything. */
  isInPlace?: boolean;
}

/**
 * An urgent card: news that goes over anything, sheets and full screen included (signed out, the connection lost while paying), as a playing
 * card with an edge in the marked color. It's a popover the queue shows after everything else, so the top layer puts it on top. In the
 * corner on a wide screen, across the top on a phone; it stays until the player closes it or presses what's in it.
 */
export function urgentCard(options: UrgentCardOptions): Raw {
  const close = tertiaryButton("Close", { type: "button", icon: "close", isLabelHidden: true, isSmall: true, dataAttributes: { "layer-close": "" } });
  const buttons = options.buttons?.length ? row({ widths: "equal", items: options.buttons.map((button) => ({ kind: "control" as const, markup: button })) }) : "";
  const sheetsToClose = options.sheetsToClose?.length ? html` data-sheets-to-close="${options.sheetsToClose.join(" ")}"` : "";
  return html`<aside class="playing-card glass urgent-card${options.isInPlace ? " in-place" : ""}" id="${options.id}" role="alert" data-notice-urgency="urgent"${sheetsToClose}${options.isInPlace ? "" : raw(' popover="manual"')} data-glass data-glass-corners="pane">${EDGE}<div class="playing-card-in"><div class="urgent-card-head"><h2 class="playing-card-title">${options.title}</h2>${close}</div><p class="urgent-card-text">${options.text}</p>${buttons}</div></aside>`;
}

export interface ScreenshotOptions {
  imageUrl: string;
  /** What a screen reader says for it: "Screenshot 2 of 5". */
  label: string;
  /** The sheet that shows it large (a Sheet holding screenshotLarge), which it opens. */
  sheetId: string;
}

/**
 * A screenshot in a game's row of them: the picture set in a carved well, cut like a game card's, which opens large in a sheet. The well and
 * the picture both follow the edge rule, so the one at the start of the row takes the pane's corner there, the one at its end the pane's
 * other corner, and every one between is square, wherever the row is scrolled to.
 */
export const screenshot = (options: ScreenshotOptions): Raw =>
  html`<button class="screenshot carving holds-art" type="button" data-cut-line="0" aria-controls="${options.sheetId}" aria-label="${options.label}">${CUT_LINE}<span class="screenshot-picture carving-art" data-cut-line="0"><img src="${options.imageUrl}" alt="" loading="lazy" decoding="async"></span></button>`;

/** A game card's options: a game cover's, less what only a cover alone takes (its title is always shown; no list keeps one in focus). */
export type GameCardOptions = Omit<GameCoverOptions, "isTitleShown" | "isCurrent">;

/**
 * A game in a list of games (Browse, More from a developer): its cover, the orange line under it, its title beneath at the start of the row
 * with players now, and what else concerns you under that, kept at the words margin. Every list of games uses it, so they all look the same.
 */
export const gameCard = (options: GameCardOptions): Raw => gameCover({ ...options, isTitleShown: true });

/**
 * A card with nothing to press in it (a notification) dismisses on a tap or a click, or a swipe sideways or up past a threshold. While it's
 * swiped it follows the finger and fades (the card's --swipe-x, --swipe-y and --swipe-opacity), and it leaves with the card's own exit,
 * carrying on the way it was going. A press on a button or link in a card does nothing here; Escape dismisses too. Under reduced motion it
 * doesn't follow: it only fades out. It leaves through the queue (zaismaLayers.leave), which then shows the next.
 */
export const PLAYING_CARD_SCRIPT = `/* playing cards */(function () {
  var SIDEWAYS_PX = 56, UP_PX = 32, TAP_PX = 8, drag = null;
  var isReduced = function () { return matchMedia("(prefers-reduced-motion: reduce)").matches; };
  var isNotice = function (card) { return !card.classList.contains("in-place") && !card.classList.contains("urgent-card") && !card.querySelector("a, button, input, select, textarea"); };
  function reset(card) {
    card.classList.remove("is-swiping");
    ["--swipe-x", "--swipe-y", "--swipe-opacity"].forEach(function (name) { card.style.removeProperty(name); });
  }
  function dismiss(card, axis, sign) {
    card.classList.remove("is-swiping");
    if (!isReduced() && axis === "x") card.style.setProperty("--swipe-x", sign * card.offsetWidth + "px");
    if (!isReduced() && axis === "y") card.style.setProperty("--swipe-y", -card.offsetHeight + "px");
    if (window.zaismaLayers) window.zaismaLayers.leave(card);
    card.hidden = true;
  }
  // When the page shows a card again, it starts from where it belongs, not where it was swiped to.
  var seen = new WeakSet();
  function watch(card) {
    if (seen.has(card)) return;
    seen.add(card);
    new MutationObserver(function () { if (!card.hidden) reset(card); }).observe(card, { attributes: true, attributeFilter: ["hidden"] });
  }
  document.querySelectorAll(".playing-card").forEach(watch);
  document.addEventListener("pointerdown", function (event) {
    var card = event.target.closest && event.target.closest(".playing-card");
    if (!card || card.hidden || !isNotice(card) || (event.pointerType === "mouse" && event.button !== 0)) return;
    watch(card);
    drag = { card: card, id: event.pointerId, x: event.clientX, y: event.clientY, axis: "", dx: 0, dy: 0 };
  });
  document.addEventListener("pointermove", function (event) {
    if (!drag || event.pointerId !== drag.id) return;
    var dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < TAP_PX) return;
      // Down is nothing; sideways either way, or up, is a swipe.
      drag.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : dy < 0 ? "y" : "none";
      if (drag.axis === "none") { drag = null; return; }
      try { drag.card.setPointerCapture(event.pointerId); } catch (error) { /* the swipe still counts without it */ }
      if (!isReduced()) drag.card.classList.add("is-swiping");
    }
    drag.dx = dx; drag.dy = Math.min(0, dy);
    if (isReduced()) return;
    var far = drag.axis === "x" ? Math.abs(drag.dx) / drag.card.offsetWidth : -drag.dy / drag.card.offsetHeight;
    drag.card.style.setProperty(drag.axis === "x" ? "--swipe-x" : "--swipe-y", (drag.axis === "x" ? drag.dx : drag.dy) + "px");
    drag.card.style.setProperty("--swipe-opacity", String(Math.max(0, 1 - far)));
  });
  document.addEventListener("pointerup", function (event) {
    if (!drag || event.pointerId !== drag.id) return;
    var card = drag.card, axis = drag.axis, dx = drag.dx, dy = drag.dy;
    drag = null;
    if (!axis || (axis === "x" && Math.abs(dx) >= SIDEWAYS_PX) || (axis === "y" && -dy >= UP_PX)) dismiss(card, axis, dx < 0 ? -1 : 1);
    else reset(card);
  });
  document.addEventListener("pointercancel", function (event) {
    if (!drag || event.pointerId !== drag.id) return;
    reset(drag.card);
    drag = null;
  });
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    document.querySelectorAll(".playing-card:not([hidden])").forEach(function (card) { if (isNotice(card)) dismiss(card, "", 1); });
  });
})();
`;

/** A screenshot large, as a sheet's body: as big as the screen allows, whole. */
export const screenshotLarge = (imageUrl: string, label: string): Raw => html`<img class="screenshot-large" src="${imageUrl}" alt="${label}" loading="lazy" decoding="async">`;

/** Where Cloudflare's check sits on a game's page: unseen, unless it ever needs a tap, when it shows at the screen's foot, over the game too. */
export const playingCheck = (id: string): Raw => html`<div class="playing-check" id="${id}"></div>`;

const PLAYING_STYLES = `
/* Playing: the game's frame fills the screen beside the bar; the header, background, panes and footer step aside. */
html.is-playing body { height: 100vh; height: 100dvh; min-height: 0; overflow: hidden; padding: 0; flex-direction: column; background: #000; }
html.is-playing body > :is(.top, .dropdown, .backdrop, .foot, .rail) { display: none; }
html.is-playing body > main { display: contents; }
html.is-playing body > main > :not(.playing-bar, .playing-card, .playing-check, .dropdown, dialog) { display: none; }
.game-frame { display: none; flex: 1; width: 100%; min-width: 0; min-height: 0; border: 0; background: #000; }
html.is-playing .game-frame { display: block; animation: playing-in var(--motion-arrive) var(--ease-glide); }
/* The game takes the keys while it's played: no focus ring around it. */
.game-frame:focus-visible { outline: none; }
@keyframes playing-in { from { opacity: 0; } }
/* Going in: the panes and the background fade first (is-leaving), then the page turns into the game. */
html.is-leaving body > main > :not(.playing-bar, .playing-card, .playing-check, .dropdown, dialog), html.is-leaving body > :is(.top, .backdrop, .foot, .rail) { opacity: 0; transition: var(--glass-transition), opacity var(--motion-state) ease; }
@media (prefers-reduced-motion: reduce) { html.is-leaving body > * { transition: none; } }

/* The bar: one slim slab of glass above the game, Zaisma's mark at its start and the game's buttons at its end. */
.playing-bar { display: none; position: relative; z-index: 2; flex: none; align-items: center; gap: var(--gap-control-row-boxes); --glass-tint: var(--glass-top); }
.playing-bar.in-place, html.is-playing .playing-bar { display: flex; }
.playing-bar > :not(.edge) { position: relative; z-index: 1; }
.playing-bar > .logo { flex: none; display: flex; align-items: center; height: var(--control-height-small); }
.playing-bar > .logo svg { height: 100%; width: auto; }
.playing-title { flex: 1; font: var(--type-name); color: var(--ink); }
.playing-controls { flex: none; min-width: 0; }
/* Phones: the buttons have the bar; the ⋯ menu names the game. They scroll sideways if there are more than fit, Zaisma's mark staying put. */
@media (max-width: 640px) {
  .playing-title { display: none; }
  .playing-bar { overflow-x: auto; scrollbar-width: none; }
  .playing-bar::-webkit-scrollbar { display: none; }
  .playing-controls { margin-left: auto; }
}
/* Landscape phones: the bar is a slim strip down the left edge, so the game keeps the screen's whole height. */
@media (orientation: landscape) and (max-height: 500px) {
  html.is-playing body { flex-direction: row; }
  .playing-bar { flex-direction: column; overflow-y: auto; scrollbar-width: none; }
  .playing-title { display: none; }
  /* One control wide, so the row wraps into a column, --gap-control-stack apart. */
  .playing-controls { margin-top: auto; width: var(--control-height-small); }
}

/* A card over the game's top corner, under the bar: glass the game shows through, as wide as a phone allows. What's in it is a pane's content
   (tokens.ts sets its padding and its words' margin, once), so its words keep the pane's margin from the card's edge like any pane's.
   It comes in with a short fade and a rise and leaves with the same, shown or hidden by the page (hidden): display changes at the ends of
   the fade, so it's still there while it leaves. Under reduced motion it only fades. */
.playing-card { position: fixed; z-index: 20; top: calc(var(--control-height-small) + 3 * var(--pad-frame)); right: var(--pad-frame); width: min(360px, calc(100vw - 2 * var(--pad-frame))); margin: 0; color: var(--ink); --glass-tint: var(--glass-dropdown);
  transition: var(--glass-transition), opacity var(--motion-state) ease, transform var(--motion-arrive) var(--ease-glide), display var(--motion-arrive) allow-discrete; }
.playing-card { transform: translate(var(--swipe-x, 0px), var(--swipe-y, 0px)); opacity: var(--swipe-opacity, 1); }
.playing-card[hidden] { display: none; opacity: 0; transform: translate(var(--swipe-x, 0px), calc(var(--swipe-y, 0px) - 8px)); pointer-events: none; }
@starting-style { .playing-card { opacity: 0; transform: translateY(-8px); } }
/* A card with nothing to press in it (a notification: Saved, a save that didn't go through) goes on a tap or a click, or a swipe sideways
   or up (PLAYING_CARD_SCRIPT): it follows the finger (is-swiping, no transition then) and leaves with the exit above. A card with a button or
   a link in it stays until its own button answers, and the gallery's copy stays where it is. */
.playing-card:not(.in-place):not(:has(a, button, input, select, textarea)) { cursor: pointer; touch-action: none; user-select: none; -webkit-user-select: none; }
.playing-card.is-swiping { transition: var(--glass-transition); }
.playing-card > :not(.edge) { position: relative; z-index: 1; }
.playing-card.in-place { position: relative; top: auto; right: auto; }
.playing-card-in { display: flex; flex-direction: column; gap: var(--gap-words-control); font: var(--type-words); }
.playing-card-in p { margin: 0; }
.playing-card-title { margin: 0; font: var(--type-heading); }
@media (orientation: landscape) and (max-height: 500px) { .playing-card { top: var(--pad-frame); } }
/* An urgent card: a playing card with its edge in the marked color, a popover over everything (zaismaLayers shows it last). The browser's own
   popover look is put back to the card's; it comes and goes as a card does, kept in the top layer while it leaves. Across the top on a phone. */
.playing-card.urgent-card { inset: auto; top: calc(var(--control-height-small) + 3 * var(--pad-frame)); right: var(--pad-frame); height: auto; padding: 0; border: 0; overflow: visible;
  transition: var(--glass-transition), opacity var(--motion-state) ease, transform var(--motion-arrive) var(--ease-glide), display var(--motion-arrive) allow-discrete, overlay var(--motion-arrive) allow-discrete; }
.playing-card.urgent-card:not(.in-place):not(:popover-open) { opacity: 0; transform: translateY(-8px); }
.urgent-card > .edge :is(.rim, .hair) { stroke: var(--marked); }
.playing-card.urgent-card.in-place { position: relative; inset: auto; }
.urgent-card-head { display: flex; align-items: flex-start; gap: var(--gap-control-row-boxes); }
.urgent-card-head > .playing-card-title { flex: 1; min-width: 0; }
.urgent-card-text { color: var(--ink); }
@media (max-width: 640px) { .playing-card.urgent-card:not(.in-place) { left: var(--pad-frame); right: var(--pad-frame); width: auto; margin: 0 auto; max-width: 360px; } }
@media (prefers-reduced-motion: reduce) {
  .playing-card { transition: var(--glass-transition), opacity var(--motion-state) ease, display var(--motion-state) allow-discrete; }
  .playing-card, .playing-card[hidden] { transform: none; }
  @starting-style { .playing-card { transform: none; } }
  html.is-playing .game-frame { animation: none; }
}

/* Screenshots: a carved well like a game card's, the picture filling it up to its rim (2px); pointed at, the picture comes a little closer.
   Large, it's whole, as big as the screen allows. */
/* A carving that holds art (materials.ts), the screenshot its art. */
.screenshot { display: block; width: 100%; aspect-ratio: 16 / 9; padding: 0; border: 0; cursor: zoom-in; }
.screenshot img { transition: transform var(--motion-arrive) var(--ease-glide); }
.screenshot:hover img { transform: scale(1.03); }
.screenshot:focus-visible { outline: none; }
.screenshot:focus-visible > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
/* As wide as a picture's sheet goes, less its frame: up to --size-sheet-picture, and the screen less its margins. */
.screenshot-large { display: block; width: min(calc(var(--size-sheet-picture) - 2 * var(--pad-frame)), calc(100vw - 2 * var(--pad-pane) - 2 * var(--pad-frame))); max-height: 70dvh; object-fit: contain; }
@media (prefers-reduced-motion: reduce) { .screenshot img { transition: none; } }

/* Cloudflare's check: unseen; if it ever needs a tap, at the foot of the screen, over the page or the game. */
.playing-check { position: fixed; z-index: 30; left: 50%; bottom: var(--pad-pane); transform: translateX(-50%); }
`;

const STAND_IN_CONTROLS = (): ControlMarkup[] => [
  secondaryButton("Players", { type: "button", icon: "people", isLabelHidden: true, isSmall: true }),
  secondaryButton("Join", { type: "button", icon: "hash", isSmall: true }),
  secondaryButton("Share", { type: "button", icon: "share", isLabelHidden: true, isSmall: true }),
  secondaryButton("More", { type: "button", icon: "more", isLabelHidden: true, isSmall: true, isExpanded: false }),
];

component({
  name: "Screenshot",
  slug: "screenshot",
  group: "data",
  subgroup: "pictures",
  summary: "A game's screenshot in its row of them, in a carved well cut like a game card's; it opens large in a sheet, whole, as big as the screen allows.",
  styles: "",
  render: screenshot,
  examples: [
    { label: "In a row: press it to open it large", markup: html`<div style="width:280px">${screenshot({ imageUrl: "/design/covers/neon-drift.webp", label: "Screenshot 1 of 3", sheetId: "example-screenshot" })}</div>${sheet({ id: "example-screenshot", title: "Neon Drift, screenshot 1 of 3", body: screenshotLarge("/design/covers/neon-drift.webp", "Neon Drift, screenshot 1"), closeLabel: "Close", isPicture: true })}` },
  ],
});

component({
  name: "Game card",
  slug: "game-card",
  group: "panes",
  subgroup: "cards",
  summary: "A game in a list of games, like Browse or More from a developer: its cover, its title beneath with players now, and what else concerns you under that. On a shelf of games the player knows (Continue playing), a Game cover, bare.",
  styles: "",
  render: gameCard,
  examples: [
    {
      label: "In a list",
      markup: grid({ whenEmpty: html`<p>No games here yet.</p>`,
        itemSize: "cover",
        items: [
          { kind: "block", markup: gameCard({ title: "Kestrel", imageUrl: "/design/covers/kestrel.webp", href: "#kestrel", facts: { playerCount: 12480 } }) },
          { kind: "block", markup: gameCard({ title: "Verdant", imageUrl: "/design/covers/verdant.webp", href: "#verdant", facts: { playerCount: 96 } }) },
          { kind: "block", markup: gameCard({ title: "Neon Drift", imageUrl: "/design/covers/neon-drift.webp", href: "#neon-drift", facts: {} }) },
        ],
      }),
      isWide: true,
    },
    { label: "Made for another device", markup: html`<div style="width:280px">${gameCard({ title: "Hollow Tide", imageUrl: "/design/covers/hollow-tide.webp", href: "#hollow-tide", facts: { playerCount: 38, deviceNote: "Needs a keyboard" } })}</div>` },
    { label: "No cover yet", markup: html`<div style="width:280px">${gameCard({ title: "The Last Lighthouse Keeper", imageUrl: null, href: "#game-card", facts: { playerCount: 38 } })}</div>` },
    { label: "A long title: it ends in an ellipsis on one line", markup: html`<div style="width:280px">${gameCard({ title: "Ashen Crown: The Long Night of the Iron Vigil", imageUrl: "/design/covers/ashen-crown.webp", href: "#game-card", facts: { playerCount: 1204 } })}</div>` },
  ],
});

component({
  name: "Playing bar",
  slug: "playing-bar",
  group: "navigation",
  subgroup: "bars",
  summary: "The one slim bar beside a running game: Zaisma's mark back to every game, the game's name, and its small buttons. Everything else on the page steps aside while a game plays; on a landscape phone the bar runs down the left edge.",
  styles: PLAYING_STYLES,
  render: playingBar,
  examples: [
    { label: "A multiplayer game", markup: playingBar({ title: "Neon Drift", controls: STAND_IN_CONTROLS(), isShown: true }), isWide: true },
    { label: "Played alone", markup: playingBar({ title: "Verdant", controls: [secondaryButton("Share", { type: "button", icon: "share", isLabelHidden: true, isSmall: true }), secondaryButton("More", { type: "button", icon: "more", isLabelHidden: true, isSmall: true, isExpanded: false })], isShown: true }), isWide: true },
  ],
});

component({
  name: "Playing card",
  slug: "playing-card",
  group: "panes",
  subgroup: "cards",
  summary: "A card over a running game's top corner, for what needs the player now (keep your progress, a game asking them to sign in) or what just happened (Saved). The game keeps running and stays in view. One at a time over a game, asks before information, nothing but urgent while a sheet is open; one with nothing to press in it goes on a tap or a swipe. Urgent news (signed out) is an urgent card, over anything.",
  styles: "",
  render: playingCard,
  examples: [
    {
      label: "Keep your progress",
      markup: playingCard({
        id: "example-keep",
        title: "Keep your progress",
        isShown: true,
        isInPlace: true,
        body: stack({
          items: [
            { kind: "words", markup: html`<p>Your Verdant progress is only saved in this browser. Make a free account to keep it safe and play on any device.</p>` },
            { kind: "block", markup: row({ widths: "equal", items: [{ kind: "control", markup: primaryButton("Make an account", { href: "#join" }) }, { kind: "control", markup: secondaryButton("Not now", { type: "button" }) }] }) },
            { kind: "words", markup: html`<p>Have an account? ${textLink("Sign in", "#signin")}</p>` },
          ],
        }),
      }),
    },
    { label: "Saved", markup: playingCard({ id: "example-saved", isShown: true, isInPlace: true, body: html`<p>Saved to your account.</p>` }) },
    { label: "Signed out while buying: urgent, over anything, the sheets it makes useless closed under it", markup: urgentCard({ id: "example-urgent", title: "You've been signed out", text: "Nothing was charged. Sign in again to buy.", buttons: [primaryButton("Sign in", { href: "#signin" })], isInPlace: true }) },
    {
      label: "Try it: urgent over a sheet, which closes under it",
      markup: html`${secondaryButton("Buy Revive", { type: "button", controls: "example-urgent-sheet" })}${sheet({
        id: "example-urgent-sheet",
        title: "Revive",
        body: stack({ items: [{ kind: "words", markup: html`<p>Bring your character back with half its health.</p>` }, { kind: "control", markup: secondaryButton("Sign out in another tab", { type: "button", isFullWidth: true, dataAttributes: { "layer-show": "example-urgent-over" } }) }] }),
        closeLabel: "Close",
        placement: "foot",
      })}${urgentCard({ id: "example-urgent-over", title: "You've been signed out", text: "Nothing was charged. Sign in again to buy.", buttons: [primaryButton("Sign in", { href: "#signin" })], sheetsToClose: ["example-urgent-sheet"] })}`,
    },
  ],
});
