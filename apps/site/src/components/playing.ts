import { html, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import type { ControlMarkup } from "./control-markup.ts";
import { secondaryButton } from "./actions.ts";
import { CUT_LINE, EDGE, logo, picture, type ShownPicture } from "./foundations.ts";
import { STAND_IN_COVER_PICTURES } from "../generated/stand-in-placeholders.generated.ts";
import { row, stackOfOne } from "./layout.ts";
import { sheet } from "./panes.ts";

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
  /** The gallery's phone layouts, shown on any screen: upright ("phone"), or on its side, down the left edge ("phone-sideways"). */
  shownAs?: "phone" | "phone-sideways";
}

/** The bar beside a running game: Zaisma's mark (back to every game), the game's name, and the game's buttons. */
export function playingBar(options: PlayingBarOptions): Raw {
  return html`<div class="playing-bar glass glass-bar at-screen-edge${options.isShown ? " in-place" : ""}${options.shownAs ? ` on-${options.shownAs}` : ""}" data-glass data-glass-corners="0 0 0 0">${EDGE}<span class="playing-mark words-margin at-start">${logo("mark")}</span><strong class="playing-title words-margin one-line">${options.title}</strong><div class="playing-controls">${row({ widths: "fit", label: "The game's buttons", items: options.controls.map((control) => ({ kind: "control" as const, markup: control })) })}</div></div>`;
}

export interface ScreenshotOptions {
  picture: ShownPicture;
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
  html`<button class="screenshot carving holds-art" type="button" data-cut-line="0" aria-controls="${options.sheetId}" aria-label="${options.label}">${CUT_LINE}<span class="carving-art" data-cut-line="0">${picture(options.picture, { shownSizes: "(max-width: 760px) 100vw, 480px", largestPx: 1440 })}</span></button>`;


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
export const screenshotLarge = (shown: ShownPicture, label: string): Raw => picture(shown, { label, holdsShape: true, className: "screenshot-large", shownSizes: "(max-width: 760px) 100vw, 960px", largestPx: 1920 });

/** Where Cloudflare's check sits on a game's page: unseen, unless it ever needs a tap, when it shows at the screen's foot, over the game too. */
export const playingCheck = (id: string): Raw => html`<div class="playing-check" id="${id}"></div>`;

/** The bar on a phone held upright, for the bar a selector picks: the window's width picks it while playing, and the gallery's shownAs. */
const onPhone = (bar: string) => `${bar} .playing-title { display: none; }
${bar} { overflow-x: auto; scrollbar-width: none; }
${bar}::-webkit-scrollbar { display: none; }
${bar} .playing-controls { margin-left: auto; }`;
/** The bar on a phone on its side, down the left edge; one control wide, so its row of buttons wraps into a column, --gap-control-stack apart. */
const onPhoneSideways = (bar: string) => `${bar} { flex-direction: column; width: auto; overflow-y: auto; scrollbar-width: none; }
${bar} .playing-title { display: none; }
${bar} .playing-mark { padding-inline: 0; }
${bar} .playing-controls { margin-top: auto; width: var(--control-height-small); }`;

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

/* The bar: one slim slab of glass above the game, Zaisma's mark at its start and the game's buttons at its end. The mark and the name are
   words, so each keeps the bar's words margin (materials.ts): the mark from the bar's edge, the name from the mark and the buttons. Shown in
   place (the gallery's), it's as wide as what holds it, as it's as wide as the screen beside a game. */
.playing-bar { display: none; position: relative; z-index: 2; flex: none; align-items: center; --glass-tint: var(--glass-top); }
.playing-bar.in-place, html.is-playing .playing-bar { display: flex; }
.playing-bar.in-place { width: 100%; }
.playing-bar > :not(.edge) { position: relative; z-index: 1; }
.playing-mark { flex: none; display: flex; align-items: center; }
.playing-mark > .logo { display: flex; height: var(--control-height-small); }
.playing-mark > .logo svg { height: 100%; width: auto; }
.playing-title { flex: 1; font: var(--type-name); color: var(--ink); }
.playing-controls { flex: none; min-width: 0; }
/* Phones: the buttons have the bar; the ⋯ menu names the game. They scroll sideways if there are more than fit, Zaisma's mark staying put. */
@media (max-width: 640px) { ${onPhone(".playing-bar")} }
${onPhone(".playing-bar.on-phone")}
/* Landscape phones: the bar is a slim strip down the left edge, so the game keeps the screen's whole height. */
@media (orientation: landscape) and (max-height: 500px) { html.is-playing body { flex-direction: row; } ${onPhoneSideways(".playing-bar")} }
${onPhoneSideways(".playing-bar.on-phone-sideways")}

@media (prefers-reduced-motion: reduce) { html.is-playing .game-frame { animation: none; } }

/* Screenshots: a carved well like a game card's, the picture filling it up to its rim (2px); pointed at, the picture comes a little closer.
   Large, it's whole, as big as the screen allows. */
/* A carving that holds art (materials.ts), the screenshot its art. */
.screenshot { display: block; width: 100%; aspect-ratio: 16 / 9; padding: 0; border: 0; cursor: zoom-in; }
.screenshot img { transition: transform var(--motion-arrive) var(--ease-glide); }
.screenshot:hover img { transform: scale(1.03); }
.screenshot:focus-visible { outline: none; }
.screenshot:focus-visible > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
/* As wide as a picture's sheet goes, less its frame: up to --size-sheet-picture, and the screen less its margins. */
/* Large, at its own shape, as wide as the sheet lets it be without growing taller than 70% of the window. */
.screenshot-large { width: min(calc(var(--size-sheet-picture) - 2 * var(--pad-frame)), calc(100vw - 2 * var(--pad-pane) - 2 * var(--pad-frame)), calc(70dvh * var(--picture-shape))); }
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
    { label: "In a row: press it to open it large", markup: html`<div style="width:280px">${screenshot({ picture: STAND_IN_COVER_PICTURES["neon-drift"]!, label: "Screenshot 1 of 3", sheetId: "example-screenshot" })}</div>${sheet({ id: "example-screenshot", title: "Neon Drift, screenshot 1 of 3", body: stackOfOne(screenshotLarge(STAND_IN_COVER_PICTURES["neon-drift"]!, "Neon Drift, screenshot 1")), closeLabel: "Close", isPicture: true })}` },
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
    { label: "On a phone: the buttons have the bar, and the More menu names the game", markup: html`<div class="game-stand-in">${playingBar({ title: "Neon Drift", controls: STAND_IN_CONTROLS(), isShown: true, shownAs: "phone" })}<img src="/design/covers/neon-drift.webp" alt="" width="1280" height="720"></div>`, isStill: true },
    { label: "On a phone on its side: a strip down the left edge, so the game keeps the whole height", markup: html`<div class="game-stand-in sideways">${playingBar({ title: "Neon Drift", controls: STAND_IN_CONTROLS(), isShown: true, shownAs: "phone-sideways" })}<img src="/design/covers/neon-drift.webp" alt="" width="1280" height="720"></div>`, isWide: true, isStill: true },
  ],
});

