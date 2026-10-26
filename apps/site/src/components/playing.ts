import { html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import type { ControlMarkup } from "./control-markup.ts";
import { cutButton, runButton, textLink } from "./actions.ts";
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
  return html`<div class="playing-bar glass${options.isShown ? " in-place" : ""}" data-glass data-glass-corners="0 0 0 0">${EDGE}${logo("mark")}<strong class="playing-title">${options.title}</strong><div class="playing-controls">${row({ widths: "fit", label: "The game's buttons", items: options.controls.map((control) => ({ kind: "control" as const, markup: control })) })}</div></div>`;
}

export interface PlayingCardOptions {
  /** Unique on the page: the script shows and hides it by its id. */
  id: string;
  /** What it's about: its heading, and its name for a screen reader. Left out, it's one line of news (role status), like Saved. */
  title?: string;
  /** Its words and buttons, laid out with the layout components. */
  body: Raw;
  /** Shown as the page opens; otherwise hidden until the page's script shows it. */
  isShown?: boolean;
  /** Where it is in the gallery, rather than over the game's corner. */
  isInPlace?: boolean;
}

/** A card of glass over a running game's top corner, for what needs the player now (keep your progress, a game asking them to sign in) or what just happened (Saved). */
export function playingCard(options: PlayingCardOptions): Raw {
  const named = options.title ? html` aria-labelledby="${options.id}-title"` : raw(' role="status"');
  return html`<aside class="playing-card glass${options.isInPlace ? " in-place" : ""}" id="${options.id}"${named} data-glass data-glass-corners="pane"${options.isShown ? "" : raw(" hidden")}>${EDGE}<div class="playing-card-in">${options.title ? html`<h2 class="playing-card-title" id="${options.id}-title">${options.title}</h2>` : ""}${options.body}</div></aside>`;
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
  html`<button class="screenshot cut-carved" type="button" data-cut-line="0" aria-controls="${options.sheetId}" aria-label="${options.label}">${CUT_LINE}<span class="screenshot-picture" data-cut-line="0"><img src="${options.imageUrl}" alt="" loading="lazy" decoding="async"></span></button>`;

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
 * doesn't follow: it only fades out. The page's own timed hide stays: it sets the card's hidden as this does.
 */
export const PLAYING_CARD_SCRIPT = `/* playing cards */(function () {
  var SIDEWAYS_PX = 56, UP_PX = 32, TAP_PX = 8, drag = null;
  var isReduced = function () { return matchMedia("(prefers-reduced-motion: reduce)").matches; };
  var isNotice = function (card) { return !card.classList.contains("in-place") && !card.querySelector("a, button, input, select, textarea"); };
  function reset(card) {
    card.classList.remove("is-swiping");
    ["--swipe-x", "--swipe-y", "--swipe-opacity"].forEach(function (name) { card.style.removeProperty(name); });
  }
  function dismiss(card, axis, sign) {
    card.classList.remove("is-swiping");
    if (!isReduced() && axis === "x") card.style.setProperty("--swipe-x", sign * card.offsetWidth + "px");
    if (!isReduced() && axis === "y") card.style.setProperty("--swipe-y", -card.offsetHeight + "px");
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
html.is-playing .game-frame { display: block; animation: playing-in 0.4s cubic-bezier(.2,.8,.2,1); }
/* The game takes the keys while it's played: no focus ring around it. */
.game-frame:focus-visible { outline: none; }
@keyframes playing-in { from { opacity: 0; } }
/* Going in: the panes and the background fade first (is-leaving), then the page turns into the game. */
html.is-leaving body > main > :not(.playing-bar, .playing-card, .playing-check, .dropdown, dialog), html.is-leaving body > :is(.top, .backdrop, .foot, .rail) { opacity: 0; transition: var(--glass-transition), opacity 0.25s ease; }
@media (prefers-reduced-motion: reduce) { html.is-leaving body > * { transition: none; } }

/* The bar: one slim slab of glass above the game, Zaisma's mark at its start and the game's buttons at its end. */
.playing-bar { display: none; position: relative; z-index: 2; flex: none; align-items: center; gap: var(--gap-control-row-boxes); padding: var(--pad-frame) var(--pad-inner-pane); padding-top: max(var(--pad-frame), env(safe-area-inset-top, 0)); --glass-tint: var(--glass-top); }
.playing-bar.in-place, html.is-playing .playing-bar { display: flex; }
.playing-bar > :not(.edge) { position: relative; z-index: 1; }
.playing-bar > .logo { flex: none; display: flex; align-items: center; height: var(--control-height-small); }
.playing-bar > .logo svg { height: 100%; width: auto; }
.playing-title { flex: 1; min-width: 0; font: var(--type-name); color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
  .playing-bar { flex-direction: column; padding: var(--pad-frame); padding-left: max(var(--pad-frame), env(safe-area-inset-left, 0)); overflow-y: auto; scrollbar-width: none; }
  .playing-title { display: none; }
  /* One control wide, so the row wraps into a column, --gap-control-stack apart. */
  .playing-controls { margin-top: auto; width: var(--control-height-small); }
}

/* A card over the game's top corner, under the bar: glass the game shows through, as wide as a phone allows. What's in it is a pane's content
   (tokens.ts sets its padding and its words' margin, once), so its words keep the pane's margin from the card's edge like any pane's.
   It comes in with a short fade and a rise and leaves with the same, shown or hidden by the page (hidden): display changes at the ends of
   the fade, so it's still there while it leaves. Under reduced motion it only fades. */
.playing-card { position: fixed; z-index: 20; top: calc(var(--control-height-small) + 3 * var(--pad-frame)); right: var(--pad-frame); width: min(360px, calc(100vw - 2 * var(--pad-frame))); margin: 0; color: var(--ink); --glass-tint: var(--glass-dropdown);
  transition: var(--glass-transition), opacity 0.25s ease, transform 0.3s cubic-bezier(.2,.8,.2,1), display 0.3s allow-discrete; }
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
@media (prefers-reduced-motion: reduce) {
  .playing-card { transition: var(--glass-transition), opacity 0.2s ease, display 0.2s allow-discrete; }
  .playing-card, .playing-card[hidden] { transform: none; }
  @starting-style { .playing-card { transform: none; } }
  html.is-playing .game-frame { animation: none; }
}

/* Screenshots: a carved well like a game card's, the picture filling it up to its rim (2px); pointed at, the picture comes a little closer.
   Large, it's whole, as big as the screen allows. */
.screenshot { position: relative; display: block; width: 100%; aspect-ratio: 16 / 9; padding: 0; border: 0; overflow: hidden; background: var(--well); box-shadow: var(--well-shade); cursor: zoom-in; clip-path: var(--cut-shape); }
.screenshot-picture { position: absolute; inset: 2px; display: block; overflow: hidden; clip-path: var(--cut-shape); }
.screenshot img { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: cover; transition: transform 0.3s cubic-bezier(.2,.8,.2,1); }
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
  cutButton("Players", { type: "button", icon: "people", isLabelHidden: true, isSmall: true }),
  cutButton("Join", { type: "button", icon: "hash", isSmall: true }),
  cutButton("Share", { type: "button", icon: "share", isLabelHidden: true, isSmall: true }),
  cutButton("More", { type: "button", icon: "more", isLabelHidden: true, isSmall: true, isExpanded: false }),
];

component({
  name: "Screenshot",
  slug: "screenshot",
  group: "data",
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
  summary: "A game in a list of games, like Browse or More from a developer: its cover, its title beneath with players now, and what else concerns you under that.",
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
  ],
});

component({
  name: "Playing bar",
  slug: "playing-bar",
  group: "navigation",
  summary: "The one slim bar beside a running game: Zaisma's mark back to every game, the game's name, and its small buttons. Everything else on the page steps aside while a game plays; on a landscape phone the bar runs down the left edge.",
  styles: PLAYING_STYLES,
  render: playingBar,
  examples: [
    { label: "A multiplayer game", markup: playingBar({ title: "Neon Drift", controls: STAND_IN_CONTROLS(), isShown: true }), isWide: true },
    { label: "Played alone", markup: playingBar({ title: "Verdant", controls: [cutButton("Share", { type: "button", icon: "share", isLabelHidden: true, isSmall: true }), cutButton("More", { type: "button", icon: "more", isLabelHidden: true, isSmall: true, isExpanded: false })], isShown: true }), isWide: true },
  ],
});

component({
  name: "Playing card",
  slug: "playing-card",
  group: "panes",
  summary: "A card over a running game's top corner, for what needs the player now (keep your progress, a game asking them to sign in) or what just happened (Saved). The game keeps running and stays in view. One with nothing to press in it goes on a tap or a swipe.",
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
            { kind: "block", markup: row({ widths: "equal", items: [{ kind: "control", markup: runButton("Make an account", { href: "#join" }) }, { kind: "control", markup: cutButton("Not now", { type: "button" }) }] }) },
            { kind: "words", markup: html`<p>Have an account? ${textLink("Sign in", "#signin")}</p>` },
          ],
        }),
      }),
    },
    { label: "Saved", markup: playingCard({ id: "example-saved", isShown: true, isInPlace: true, body: html`<p>Saved to your account.</p>` }) },
  ],
});
