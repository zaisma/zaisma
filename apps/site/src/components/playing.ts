import { html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import type { ControlMarkup } from "./control-markup.ts";
import { action, textLink } from "./actions.ts";
import { tabIconsAlone } from "./switch.ts";
import { STAND_IN_GAME_VIEWS } from "../generated/stand-in-placeholders.generated.ts";
import { MARK } from "./icons.ts";
import { PAINT_PICTURE } from "./data.ts";
import { EDGE, EDGE_LIGHT, glassPane, picture, tray } from "./foundations.ts";
import { row, stackOfOne, type LayoutMarkup } from "./layout.ts";
import { sheet, type SheetStep } from "./panes.ts";

/** The menu's sheet, which the Z names and scripts find it by; its first step's name. */
export const ZAISMA_OVERLAY_ID = "players";
export const ZAISMA_OVERLAY_FIRST_STEP = "players";

/*
 * A game's page: the game cards of every list of games (Browse, More from a developer), and playing it. Playing is the page once Play is pressed. The game fills the screen; Zaisma keeps only
 * the Z in its top right (see-through with a mouse until pointed at) and a card under it when something needs the player (keep your progress, sign in). Everything
 * else on the page steps aside: the header, the background, the page's panes and the footer. The page's script turns it on by putting
 * is-playing on <html> and adding the game's frame (class game-frame) to the body.
 */

/** How far the Z's outer edge leans, across per down: from the end of its top bar to the foot of its bottom bar. The Zaisma button's slant, and the way it slides. */
const MARK_LEAN_NUMBER = 0.294;
/** The hand-off: the overlay sliding in and the Zaisma button leaving together, soft at both ends. Shorter than the 400 ms a closing sheet is given (LAYERS_SCRIPT). */
const HAND_OFF = "380ms cubic-bezier(.65, 0, .35, 1)";

export interface ZaismaButtonOptions {
  /** Shown where it is rather than over a running game, at full ink: the gallery's still copy. */
  isShown?: boolean;
}

/**
 * The Zaisma button: a shard of glass in the screen's top right corner holding Zaisma's logo, its slant the Z's own outer lean, the same size and the same look whatever the game's
 * glass, with nothing beside it and no count on it. Zaisma's one way in while a game runs. On a popover of its own, so nothing in the game's frame can cover it, full screen included (zaisma-overlay.ts raises it again when a game goes full screen itself), and
 * the browser sends a press on it here, never to the game. On a touch screen it's always there; with a mouse it's up out of the screen until pointed at, so the game has the screen and the corner still brings
 * it down. The button itself stays still while its glass slides, so the glass can't slip out from under the pointer. It comes before the game's frame on the page, so Shift+Tab out of the game lands on it.
 */
export function zaismaButton(options: ZaismaButtonOptions = {}): Raw {
  const open = html`<button class="zaisma-press" type="button"${options.isShown ? "" : raw(' id="zaisma-open"')} aria-label="${action("zaisma").label}" aria-controls="${ZAISMA_OVERLAY_ID}"></button><span class="zaisma-shard glass docked pinned" data-glass data-glass-corners="0 0 0 0" data-glass-lean="${String(MARK_LEAN_NUMBER)}" data-edge-light="left">${EDGE}${EDGE_LIGHT}<span class="logo mark">${MARK}</span><i class="zaisma-mark"></i></span>`;
  return html`<div class="zaisma-button${options.isShown ? " in-place" : ""}"${options.isShown ? "" : raw(' id="zaisma-button" popover="manual"')}>${open}</div>`;
}

export interface ZaismaOverlayOptions {
  /** The game's name, which names the menu to a screen reader. */
  title: string;
  /** Who's in the room, and the room itself. */
  roomBody: LayoutMarkup;
  /** Friends online and friend requests. */
  friendsBody: LayoutMarkup;
  /** The game itself: progress, what's owned, updates, its developer's links, Report. */
  gameBody: LayoutMarkup;
  /** What went by: notices that left unanswered. */
  inboxBody: LayoutMarkup;
  /** The foot's tools, at its start: Share, Full screen. */
  tools: ControlMarkup[];
  /** The way out, apart at the foot's end. */
  leave: ControlMarkup;
  /** What moves forward inside it: a player's choices, Report. */
  laterSteps?: SheetStep[];
  /** A game played alone: no Room until the game says who's playing, and it opens on This game. */
  isPlayedAlone?: boolean;
}

/** The Zaisma overlay: Zaisma's own interface over a running game, on Docked glass. Every part keeps its place on every screen, so it's found without reading; at most five tabs, ever. Only the player's own press opens it. */
export function zaismaOverlay(options: ZaismaOverlayOptions): Raw {
  return sheet({
    id: ZAISMA_OVERLAY_ID,
    closeLabel: "Close",
    placement: "docked",
    steps: [
      {
        stepName: ZAISMA_OVERLAY_FIRST_STEP,
        title: options.title,
        isCompact: true,
        body: options.roomBody,
        tabs: [
          { ...action("room"), tabValue: "room", body: options.roomBody, isHidden: options.isPlayedAlone },
          { ...action("friends"), tabValue: "friends", body: options.friendsBody },
          { ...action("thisGame"), tabValue: "game", body: options.gameBody, isOpening: options.isPlayedAlone },
          { ...action("inbox"), tabValue: "inbox", body: options.inboxBody },
        ],
        foot: row({ widths: "fit", alignment: "between", label: "The menu's tools", items: [{ kind: "block", markup: row({ widths: "fit", items: options.tools.map((control) => ({ kind: "control" as const, markup: control })) }) }, { kind: "control", markup: options.leave }] }),
      },
      ...(options.laterSteps ?? []),
    ],
  });
}

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
  ${PAINT_PICTURE}
  // A strip's words follow the card's, which pages fill by id, and its controls press the card's own, so a page has one of each to answer.
  document.querySelectorAll("[data-notice-copies]").forEach(function (copy) {
    var source = document.getElementById(copy.getAttribute("data-notice-copies"));
    if (!source) return;
    var strip = copy.closest(".notice-strip"), picture = strip && strip.querySelector(".av");
    var follow = function () { copy.textContent = source.textContent; if (picture) paint(picture, source.textContent.trim() || "?"); };
    follow();
    new MutationObserver(follow).observe(source, { childList: true, characterData: true, subtree: true });
  });
  document.addEventListener("click", function (event) {
    var pressed = event.target.closest && event.target.closest("[data-notice-presses], [data-notice-close]");
    if (!pressed) return;
    var own = document.getElementById(pressed.getAttribute("data-notice-presses") || pressed.getAttribute("data-notice-close") || "");
    if (pressed.hasAttribute("data-notice-close") && pressed.closest("[data-notice-marks]")) window.dispatchEvent(new Event("zaisma:notice-folded"));
    if (own) own.click();
  });
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

/** Where Cloudflare's check sits on a game's page: unseen, unless it ever needs a tap, when it shows at the screen's foot, over the game too. */
export const playingCheck = (id: string): Raw => html`<div class="playing-check" id="${id}"></div>`;

/**
 * Docked glass: a material for what sits against the screen's own edge rather than floating over the page. It doesn't float, and it has no edge where it meets the screen, since a screen's corners may
 * be straight or curved and a cut would fit neither (Julius, Nov 1, 2026). It's the same glass, blur and rim as a pane, with its rim carried past the screen on those sides, so only its one visible edge shows
 * the bevel, drawn by the same code as every pane's. What's on it keeps clear of the screen's own notch and home bar.
 */
export function dockedGlass(options: { dockedAt: "end" | "foot"; body: Raw; label: string }): Raw {
  return html`<section class="glass docked in-place dock-${options.dockedAt}" aria-label="${options.label}" data-glass data-glass-corners="0 0 0 0">${EDGE}<div class="docked-in">${options.body}</div></section>`;
}

const OVER_GAME_STYLES = `
/* The stand-in game: a game's own view filling the screen, its own interface in its corners: a bright one in light, a dark one in dark, to show the glass over both. */
.stand-in-game { position: relative; overflow: hidden; }
.stand-in-game > .picture { position: absolute; inset: 0; width: 100%; height: 100%; }
.stand-in-game > .picture.on-light { display: var(--on-light); }
.stand-in-game > .picture.on-smoked { display: var(--on-smoked); }
/* A state's screens: real frames at half size, a quarter on a phone, and never wider than what holds them. A frame is scaled to its view's width (a length over a length, which only atan2 can divide). */
.game-screens { container-type: inline-size; display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--gap-block-block); }
.game-screen { --screen-scale: 0.5; display: grid; gap: var(--gap-words-control); margin: 0; min-width: 0; font: var(--type-note); }
@media (max-width: 760px) { .game-screen { --screen-scale: 0.25; } }
.game-screen-view { container-type: inline-size; position: relative; overflow: hidden; width: min(calc(var(--screen-width) * var(--screen-scale) * 1px), 100cqw); aspect-ratio: var(--screen-width) / var(--screen-height); box-shadow: var(--well-shade); }
.game-screen-view > iframe { position: absolute; top: 0; left: 0; border: 0; pointer-events: none; transform: scale(tan(atan2(100cqw, calc(var(--screen-width) * 1px)))); transform-origin: 0 0; }
`;

const DOCKED_STYLES = `
/* Docked glass: glass with no gap to the screen's edge and no rim on it. --dock-overhang carries it just past the edge, rim and all, so the rim shows only on the side you can see. */
/* It's the thick glass: what's under it is a game of any color, and its words have to read over all of them. */
/* --dock-bevel: how wide its one bevel is drawn. What's on it starts past that, so its margin reads the same from the bevel as from the screen's edges, which have none. */
.glass.docked { --dock-overhang: 12px; --dock-bevel: 6px; --glass-tint: var(--glass-thick); margin: 0; max-width: none; max-height: none; }
.docked-frame .glass.docked.in-place { position: absolute; }
.glass.docked.dock-end { inset: calc(-1 * var(--dock-overhang)) calc(-1 * var(--dock-overhang)) calc(-1 * var(--dock-overhang)) auto; width: 46%; }
.glass.docked.dock-foot { inset: auto calc(-1 * var(--dock-overhang)) calc(-1 * var(--dock-overhang)); height: 62%; }
.docked-in { position: relative; z-index: 1; padding: calc(var(--dock-overhang) + var(--dock-bevel) + var(--pad-frame)); }
.docked-frame { position: relative; overflow: hidden; width: min(100%, 560px); height: 280px; }
.docked-frame.is-narrow { width: min(100%, 240px); height: 420px; }
`;

/** What stands in for a running game on the gallery's Over a game page: a still picture, with a game's own interface in all four corners, to show what Zaisma's covers. */
export function standInGame(): Raw {
  return html`<div class="game-frame stand-in-game" id="game">${picture(STAND_IN_GAME_VIEWS["forest-by-day"]!, { isEager: true, className: "on-light" })}${picture(STAND_IN_GAME_VIEWS["racing-at-night"]!, { isEager: true, className: "on-smoked" })}</div>`;
}

/** The screens a state shows on, by their real sizes, in order. */
const GAME_SCREENS = [
  { screenName: "computer", label: "Computer", widthPx: 1280, heightPx: 800 },
  { screenName: "phone", label: "Phone", widthPx: 320, heightPx: 667 },
  { screenName: "phone-sideways", label: "Phone, sideways", widthPx: 667, heightPx: 320 },
  { screenName: "ipad-sideways", label: "iPad, sideways", widthPx: 1180, heightPx: 820 },
] as const;

/** One state over the stand-in game on each screen: real frames of those sizes, shown at half size, since the overlay's shape follows the screen it's on. Each loads as it's scrolled to. */
export function gameScreens(options: { title: string; framePath: string; screenNames?: string[] }): Raw {
  return tray({
    head: html`<h3 class="component-name">${options.title}</h3>`,
    body: stackOfOne(html`<div class="game-screens">${GAME_SCREENS.filter((each) => !options.screenNames || options.screenNames.includes(each.screenName)).map((each) => {
      const path = `${options.framePath}&screen=${each.screenName}`;
      return html`<figure class="game-screen" style="--screen-width:${String(each.widthPx)};--screen-height:${String(each.heightPx)}"><div class="game-screen-view"><iframe data-frame-src="${path}" title="${options.title}: ${each.label}" width="${String(each.widthPx)}" height="${String(each.heightPx)}" tabindex="-1"></iframe></div><figcaption>${textLink(each.label, path, { isNewTab: true })}</figcaption></figure>`;
    })}</div>`),
    label: options.title,
  });
}

const PHONE_SIDEWAYS_MEDIA = "(orientation: landscape) and (max-height: 500px)";

const PLAYING_STYLES = `
/* Playing: the game's frame fills the screen; the header, background, panes and footer step aside. */
html.is-playing body { height: 100vh; height: 100dvh; min-height: 0; overflow: hidden; padding: 0; flex-direction: column; background: #000; }
html.is-playing body > :is(.top, .dropdown, .backdrop, .foot, .rail) { display: none; }
html.is-playing body > main { display: contents; }
html.is-playing body > main > :not(.zaisma-button, .playing-card, .playing-check, .dropdown, dialog) { display: none; }
.game-frame { display: none; flex: 1; width: 100%; min-width: 0; min-height: 0; border: 0; background: #000; }
html.is-playing .game-frame { display: block; animation: playing-in var(--motion-arrive) var(--ease-glide); }
/* The game takes the keys while it's played: no focus ring around it. */
.game-frame:focus-visible { outline: none; }
@keyframes playing-in { from { opacity: 0; } }
/* Going in: the panes and the background fade first (is-leaving), then the page turns into the game. */
html.is-leaving body > main > :not(.zaisma-button, .playing-card, .playing-check, .dropdown, dialog), html.is-leaving body > :is(.top, .backdrop, .foot, .rail) { opacity: 0; transition: var(--glass-transition), opacity var(--motion-state) ease; }
@media (prefers-reduced-motion: reduce) { html.is-leaving body > * { transition: none; } }

/* The Zaisma button: in the top right corner, a popover over everything, its glass running past the screen's edges as Docked glass does. Only the shard's shape takes a press; the rest of the box is the game's. */
@property --shard-sink { syntax: "<color>"; inherits: true; initial-value: transparent; }
.zaisma-button { --shard-overhang: 12px; --shard-height: calc(var(--zaisma-button-height) + var(--shard-overhang) + env(safe-area-inset-top, 0px)); --shard-width: calc(var(--zaisma-button-width) + var(--shard-overhang) + var(--safe-right) + var(--corner-room));
  /* Up out of the screen along its own slant, so that edge stays on one line as it goes. */
  --shard-out: translate(calc(var(--shard-height) * ${MARK_LEAN_NUMBER}), -100%); --shard-out-ink: 1;
  display: none; width: var(--shard-width); height: var(--shard-height); margin: 0; padding: 0; border: 0; background: none; overflow: visible; pointer-events: none; }
.zaisma-button:popover-open { display: block; position: fixed; inset: calc(-1 * var(--shard-overhang)) calc(-1 * var(--shard-overhang)) auto auto; }
.zaisma-button.in-place { display: block; position: absolute; top: calc(-1 * var(--shard-overhang)); right: calc(-1 * var(--shard-overhang)); }
.zaisma-press { position: absolute; inset: 0; display: block; margin: 0; padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; pointer-events: auto; -webkit-tap-highlight-color: transparent;
  clip-path: polygon(calc(var(--shard-height) * ${MARK_LEAN_NUMBER}) 0, 100% 0, 100% 100%, 0 100%); }
.zaisma-press:focus-visible { outline: none; }
/* A notice that folded away unanswered: the light on the button until the overlay opens. */
.zaisma-button .zaisma-shard > .zaisma-mark { display: none; position: absolute; top: calc(var(--shard-overhang) + env(safe-area-inset-top, 0px) + 6px); right: calc(var(--shard-overhang) + var(--safe-right) + var(--corner-room) + 6px); width: 8px; height: 8px; border-radius: 50%; background: var(--run); }
.zaisma-button.has-folded .zaisma-shard > .zaisma-mark { display: block; }
.zaisma-button .zaisma-shard { position: absolute; inset: 0; display: flex; justify-content: flex-end; align-items: flex-start; box-sizing: border-box; padding: calc(var(--shard-overhang) + env(safe-area-inset-top, 0px) + 14px) calc(var(--shard-overhang) + var(--safe-right) + var(--corner-room) + 8px) 0 0;
  --glass-layer: linear-gradient(var(--shard-sink), var(--shard-sink)); --shard-glass: var(--glass-transition), --shard-sink var(--motion-arrive) ease;
  transition: var(--shard-glass), transform 240ms var(--ease-glide), opacity var(--motion-state); }
.zaisma-button .logo.mark { --logo-height: 22px; transition: transform var(--motion-arrive) var(--ease-spring); }
/* The press holds the shape and the glass only lies under it: glass inside anything clipped can't see through to the game, so it wouldn't blur.
   Its Edge light lies along its slant and answers the press beside it: pointed at, the light comes down the slant and stays. It keeps Edge light's whole flood and only slides, from above the shard to below it, so it's never squeezed; its only moves are transitions, which pick up from wherever it has got to.
   A press sinks the glass in place and dims the light. Let go, the light goes back up the way the shard is leaving. The keyboard's line runs along its rim. */
.zaisma-shard.glass > .edge-light { --edge-light: var(--thick-edge-light); --edge-flood: var(--thick-edge-flood); --edge-flood-far: var(--thick-edge-flood-far); --edge-wake: var(--thick-edge-wake); position: absolute; inset: 0; z-index: auto; clip-path: var(--glass-clip); --light-at: calc(var(--shard-height) * -1); --light-span: var(--shard-height); transition: --light-at 240ms var(--ease-standard), opacity var(--motion-state); }
/* Each leans from the shard's top, wherever its own box starts (the flood's moves along the edge), so its bright side stays on the slant. */
/* The light travels, so nothing comes or goes by fading until it's gone: the wake along the slant only reaches as far as the flood. */
.zaisma-shard > .edge-light::before { transform-origin: 0 0; --wake-from: calc(var(--light-at) - var(--light-span)); --wake-to: calc(var(--light-at) + var(--light-span));
  -webkit-mask-image: linear-gradient(transparent calc(var(--wake-from) - 16px), #000 var(--wake-from), #000 var(--wake-to), transparent calc(var(--wake-to) + 16px)); mask-image: linear-gradient(transparent calc(var(--wake-from) - 16px), #000 var(--wake-from), #000 var(--wake-to), transparent calc(var(--wake-to) + 16px)); }
.zaisma-shard > .edge-light::before, .zaisma-shard > .edge-light::after { transition: opacity 120ms linear 300ms; }
.zaisma-shard > .edge-light::after { transform-origin: 0 calc(var(--light-span) - var(--light-at)); }
.zaisma-shard > .edge-light::before, .zaisma-shard > .edge-light::after { transform: translateX(calc(var(--shard-height) * ${MARK_LEAN_NUMBER})) skewX(calc(-1 * atan(${MARK_LEAN_NUMBER}))); }
.zaisma-press:active ~ .zaisma-shard { --shard-sink: rgba(0, 0, 0, 0.14); transition: var(--glass-transition), --shard-sink var(--motion-press) ease, transform 240ms var(--ease-glide), opacity var(--motion-state); }
.zaisma-press:active ~ .zaisma-shard .logo.mark { transform: translateY(1px) scale(0.95); transition: transform var(--motion-press) ease; }
.zaisma-press:focus-visible ~ .zaisma-shard .edge .rim { stroke: var(--run); }
/* With a mouse it's out of the screen until pointed at, or while the keyboard is on it. A finger can't point, so a touch screen always shows it. */
@media (hover: hover) and (pointer: fine) {
  .zaisma-button:not(.in-place, .is-shown, :hover, :has(:focus-visible)) .zaisma-shard { transform: var(--shard-out); opacity: var(--shard-out-ink); transition: var(--shard-glass), transform 160ms var(--ease-glide), opacity var(--motion-state); }
  /* Left before it's down, it turns straight back and carries its light up with it where it had got to. Once it's down (has-arrived, the page's script) it waits half a second
     for a pointer that slipped off: its light stays a moment, runs off the foot, and the shard goes as it does. */
  .zaisma-button.has-arrived:not(.in-place, .is-shown, :hover, :has(:focus-visible)) .zaisma-shard { transition: var(--shard-glass), transform 200ms var(--ease-leave) 500ms, opacity var(--motion-state) 500ms; }
  .zaisma-button.has-arrived:not(.in-place, .is-shown, :hover, :has(:focus-visible)) .edge-light { --light-at: calc(var(--shard-height) * 2); transition: --light-at 400ms var(--ease-standard) 200ms, opacity var(--motion-state); }
  .zaisma-button.has-arrived:not(.in-place, .is-shown, :hover, :has(:focus-visible)) .edge-light::before, .zaisma-button.has-arrived:not(.in-place, .is-shown, :hover, :has(:focus-visible)) .edge-light::after { transition: opacity 100ms linear 600ms; }
  .zaisma-press:hover ~ .zaisma-shard > .edge-light, .zaisma-button.is-pointed .edge-light { --light-at: calc(var(--shard-height) / 2); transition: --light-at var(--motion-glide) var(--ease-standard), opacity var(--motion-state); }
  .zaisma-press:hover ~ .zaisma-shard > .edge-light::before, .zaisma-press:hover ~ .zaisma-shard > .edge-light::after, .zaisma-button.is-pointed .edge-light::before, .zaisma-button.is-pointed .edge-light::after { opacity: 1; transition: opacity 60ms linear; }
}
.zaisma-press:active ~ .zaisma-shard > .edge-light { --light-at: calc(var(--shard-height) / 2); opacity: 0.3; transition: --light-at var(--motion-glide) var(--ease-standard), opacity var(--motion-press); }
.zaisma-press:active ~ .zaisma-shard > .edge-light::before, .zaisma-press:active ~ .zaisma-shard > .edge-light::after { opacity: 1; transition-duration: 0s; }
/* The hand-off: pressed, it goes up its slant as the overlay slides in. */
html:has(.sheet.placement-docked:not(.in-place)[open]:not(.is-leaving)) .zaisma-button:not(.in-place) .zaisma-shard { transform: var(--shard-out); opacity: var(--shard-out-ink); transition: var(--shard-glass), transform ${HAND_OFF}, opacity var(--motion-state); }
html:has(.sheet.placement-docked:not(.in-place)[open]:not(.is-leaving)) .zaisma-button:not(.in-place) .edge-light { --light-at: calc(var(--shard-height) * -1); transition: --light-at 240ms var(--ease-leave); }
html:has(.sheet.placement-docked:not(.in-place)[open]:not(.is-leaving)) .zaisma-button:not(.in-place) .edge-light::before, html:has(.sheet.placement-docked:not(.in-place)[open]:not(.is-leaving)) .zaisma-button:not(.in-place) .edge-light::after { opacity: 1; transition: none; }
@media (prefers-reduced-motion: reduce) {
  .zaisma-button { --shard-out: none; --shard-out-ink: 0; } .zaisma-button .zaisma-shard { transition: var(--shard-glass), opacity var(--motion-state); }
  .zaisma-shard.glass > .edge-light { --light-at: calc(var(--shard-height) / 2); }
  .zaisma-shard > .edge-light::before, .zaisma-shard > .edge-light::after { transition: opacity var(--motion-glide) var(--ease-standard); }
  .zaisma-button.has-arrived:not(.in-place, .is-shown, :hover, :has(:focus-visible)) .edge-light, html:has(.sheet.placement-docked:not(.in-place)[open]:not(.is-leaving)) .zaisma-button:not(.in-place) .edge-light { --light-at: calc(var(--shard-height) / 2); }
}

.sheet.placement-docked:focus { outline: none; }

/* What Zaisma says over a running game is read over whatever the game draws, which Zaisma can't see, so its glass is thick enough for every word whatever's behind it. */
html.is-playing :is(.zaisma-shard, .sheet, .notice, .playing-card, .dropdown).glass { --glass-shown-tint: var(--glass-over-game); }

/* The overlay: a sheet on Docked glass, the game in view and undimmed beside it, and every step this one pane. At the end of a wide screen; at the foot of a narrow one, where a thumb reaches it. */
.sheet.placement-docked::backdrop { background: transparent; }
.sheet.placement-docked > .sheet-in { height: 100%; }
/* Every tab's content starts the same step under the tabs. */
.sheet.placement-docked [data-sheet-step="players"] > .pane-parts { gap: var(--pad-inside-words); }
.sheet.placement-docked .sheet-step { height: 100%; }
.sheet.placement-docked:not(.in-place) { margin: 0; max-width: none; max-height: none; height: calc(100dvh + 2 * var(--dock-overhang)); inset: calc(-1 * var(--dock-overhang)) calc(-1 * var(--dock-overhang)) calc(-1 * var(--dock-overhang)) auto; }
.sheet.placement-docked.placement-docked.placement-docked:not(.in-place) { width: calc(420px + var(--dock-overhang)); }
/* Its tabs fill the head beside Close, on one line. */
.sheet.placement-docked [data-sheet-step="players"] > .pane-parts > .pane-head { display: flex; align-items: center; gap: var(--gap-control-row); }
.sheet.placement-docked [data-sheet-step="players"] > .pane-parts > .pane-head > :not(.pane-head-end) { flex: 1 1 0; min-width: 0; }
.sheet.placement-docked [data-sheet-step="players"] > .pane-parts > .pane-head > .pane-head-words > * { margin-top: 0; }
/* The glass runs to the screen's edges; what's on it keeps the frame gap inside them, and off a phone's notch and home bar. */
.sheet.placement-docked:not(.in-place) > .sheet-in { --dock-foot-room: calc(var(--pad-frame) + env(safe-area-inset-bottom, 0px)); padding: calc(var(--dock-overhang) + var(--pad-frame) + env(safe-area-inset-top, 0px)) calc(var(--dock-overhang) + var(--pad-frame) + var(--safe-right) + var(--corner-room)) var(--dock-overhang) calc(var(--dock-bevel) + var(--pad-frame)); }
/* What scrolls keeps room at its end for its rail, so the rail stands clear of the screen's edge as everything else does. */
.sheet.placement-docked:not(.in-place) .pane-body { margin-inline-end: var(--rail-width); }
/* What scrolls runs down to the screen's edge, under its own last words' room; a foot of controls keeps clear of the edge. */
.sheet.placement-docked:not(.in-place) .sheet-body { padding-bottom: var(--dock-foot-room); }
.sheet.placement-docked:not(.in-place) .pane-foot { margin-bottom: var(--dock-foot-room); }
/* It slides in whole, with nothing fading, from the edge it docks against (the hand-off, above). */
.sheet.placement-docked:is(:not([open]), .is-leaving, .is-arriving) { transform: translateX(100%); }
@starting-style { .sheet.placement-docked[open] { transform: translateX(100%); } }
@media (prefers-reduced-motion: no-preference) {
  .sheet.placement-docked:not(.in-place) { transition: var(--glass-transition), transform ${HAND_OFF}, overlay ${HAND_OFF} allow-discrete, display ${HAND_OFF} allow-discrete; }
  .sheet.placement-docked:is(:not([open]), .is-leaving, .is-arriving)::before, .sheet.placement-docked:is(:not([open]), .is-leaving, .is-arriving) > * { opacity: 1; }
  @starting-style { .sheet.placement-docked[open]::before, .sheet.placement-docked[open] > * { opacity: 1; } }
}
@media (max-width: 760px) and (min-height: 501px) {
  .sheet.placement-docked:not(.in-place) { height: calc(66dvh + var(--dock-overhang)); inset: auto calc(-1 * var(--dock-overhang)) calc(-1 * var(--dock-overhang)); }
  .sheet.placement-docked.placement-docked.placement-docked:not(.in-place) { width: calc(100% + 2 * var(--dock-overhang)); }
  .sheet.placement-docked:not(.in-place) > .sheet-in { padding: calc(var(--dock-bevel) + var(--pad-frame)) calc(var(--dock-overhang) + var(--pad-frame) + var(--safe-right) + var(--corner-room)) var(--dock-overhang) calc(var(--dock-overhang) + var(--pad-frame) + var(--safe-left)); }
  .sheet.placement-docked:is(:not([open]), .is-leaving, .is-arriving) { transform: translateY(100%); }
  @starting-style { .sheet.placement-docked[open] { transform: translateY(100%); } }
}
/* With room for words, its tabs are their words alone; where there's none, their icons alone. */
@media (min-width: 761px) and (min-height: 501px) { .sheet.placement-docked .tab-switch .ico { display: none; } }
@media (max-width: 760px), ${PHONE_SIDEWAYS_MEDIA} {
${tabIconsAlone(".sheet.placement-docked .tab-switch")}
}
/* A phone on its side: the whole height at the top right. Down its start the tabs' icons, sized as the sideways header's, their well a whole column (zaisma-overlay.ts stacks the Switch). Past its line, over the content, a head naming the tab, then Leave and the tools, square, then Close at its end: each kind of action has its own place. */
@media ${PHONE_SIDEWAYS_MEDIA} {
  /* A step with a lot in it (Report) has the whole screen while it shows. */
  .sheet.placement-docked.placement-docked.placement-docked:not(.in-place):has([data-sheet-step-fills]:not([hidden])) { width: calc(100% + 2 * var(--dock-overhang)); }
  .sheet.placement-docked:not(.in-place):has([data-sheet-step-fills]:not([hidden])) > .sheet-in { padding-inline-start: calc(var(--dock-overhang) + max(var(--pad-frame), var(--safe-left), var(--corner-room))); }
  .sheet.placement-docked.placement-docked.placement-docked:not(.in-place) { width: clamp(calc(380px + var(--dock-overhang)), 64vw, calc(440px + var(--dock-overhang))); }
  .sheet.placement-docked [data-sheet-step="players"] > .pane-parts { display: grid; grid-template: "head place foot close" var(--control-height-regular) "head body body body" minmax(0, 1fr) / var(--control-height-regular) minmax(0, 1fr) auto auto; gap: var(--pad-inside-words) var(--pad-frame); height: 100%; }
  .sheet.placement-docked [data-sheet-step="players"] > .pane-parts::before { content: ""; grid-column: 2 / -1; grid-row: 1 / -1; border-inline-start: 1px solid var(--edge-hair); pointer-events: none; }
  .sheet.placement-docked [data-sheet-step="players"] > .pane-parts::after { content: attr(data-place-name); grid-area: place; align-self: center; padding-inline-start: var(--pad-frame); font: var(--type-label); }
  .sheet.placement-docked [data-sheet-step="players"] > .pane-parts > .pane-head { display: contents; }
  .sheet.placement-docked [data-sheet-step="players"] > .pane-parts > .pane-head > :not(.pane-head-end) { grid-area: head; display: flex; flex-direction: column; align-items: stretch; min-height: 0; margin-bottom: var(--pad-frame); }
  .sheet.placement-docked [data-sheet-step="players"] > .pane-parts > .pane-head > .pane-head-end { grid-area: close; align-self: center; margin: 0 0 0 calc(var(--gap-control-row) - var(--pad-frame)); }
  .sheet.placement-docked [data-sheet-step="players"] > .pane-parts > .pane-body { grid-area: body; min-height: 0; margin-inline: var(--pad-frame) var(--rail-width); }
  .sheet.placement-docked [data-sheet-step="players"] > .pane-parts > .pane-foot { grid-area: foot; align-self: center; margin: 0; }
  .sheet.placement-docked [data-sheet-step="players"] > .pane-parts > .pane-foot .layout-row { flex-flow: row nowrap; align-items: center; }
  /* All one row of controls, Leave first, so they share their slants as any row's do; the one gap is before Close. */
  .sheet.placement-docked [data-sheet-step="players"] > .pane-parts > .pane-foot .pane-foot-start > .layout-row { flex-direction: row-reverse; gap: 0; margin-inline-end: 0; }
  .sheet.placement-docked [data-sheet-step="players"] > .pane-parts > .pane-foot .pane-foot-start > .layout-row > .row-cell { margin-inline: 0; }
  .sheet.placement-docked [data-sheet-step="players"] > .pane-parts > .pane-foot .pane-foot-start > .layout-row > .row-cell:has(#zaisma-leave) { margin-inline-end: var(--gap-control-row-boxes); }
  .sheet.placement-docked [data-sheet-step="players"] > .pane-parts > .pane-foot, .sheet.placement-docked [data-sheet-step="players"] > .pane-parts > .pane-foot :is(.pane-foot-start, .layout-row, .row-cell) { width: auto; min-width: 0; }
  .sheet.placement-docked:not(.in-place) > .sheet-in { padding-inline-start: var(--pad-frame); }
  /* A rail's tabs scroll down when the screen's too short for them, fading as any box that scrolls does, with no rail of their own in so narrow a space (the sideways header's the same). */
  .sheet.placement-docked .switch-well.vertical { flex: 1 1 auto; width: 100%; height: auto; min-height: 0; max-height: 100%; }
  .sheet.placement-docked .switch-well.vertical > .well-body { overflow-y: auto; padding-inline-end: 0; }
  .sheet.placement-docked .switch-well.vertical > .rail { display: none; }
  .sheet.placement-docked .tab-switch.vertical > :is(a, button) { min-width: 0; justify-content: center; --row-start: 0px; --row-end: 0px; }
  .sheet.placement-docked [data-sheet-step="players"] > .pane-parts > .pane-foot .cut-btn { --control-height: var(--control-height-regular); }
  .sheet.placement-docked [data-sheet-step="players"] > .pane-parts > .pane-foot .cut-btn:not([data-zaisma-leave]) { width: var(--control-height-regular); }
  /* What scrolls runs to the screen's foot here, with no foot of controls under it; its rail stops where the rail's Leave does. */
  .sheet.placement-docked [data-sheet-step="players"] .sheet-scroll > .rail > .rail-line { bottom: var(--dock-foot-room); }
}
@media (prefers-reduced-motion: reduce) { html.is-playing .game-frame { animation: none; } .sheet.placement-docked:is(:not([open]), .is-leaving, .is-arriving) { transform: none; } @starting-style { .sheet.placement-docked[open] { transform: none; } } }

/* Cloudflare's check: unseen; if it ever needs a tap, at the foot of the screen, over the page or the game. */
.playing-check { position: fixed; z-index: 30; left: 50%; bottom: var(--pad-pane); transform: translateX(-50%); }
`;

component({
  name: "Stand-in game",
  slug: "stand-in-game",
  group: "over-a-game",
  subgroup: "zaisma-button",
  after: "zaisma-button",
  summary: "What stands in for a running game on the gallery's Over a game pages: a still of a game, bright in light and dark in dark, with its own interface in its corners, so it shows what Zaisma's button, overlay and notices cover. Only for the gallery.",
  styles: OVER_GAME_STYLES,
  render: standInGame,
  examples: [],
});

component({
  name: "Docked glass",
  slug: "docked-glass",
  group: "panes",
  subgroup: "materials",
  after: "tray",
  summary: "Glass against the screen's own edge, for what takes as much room as it can: it doesn't float, and it has no edge where it meets the screen, so it fits a straight or curved corner alike. Only the side you can see has the bevel. The Zaisma overlay is made of it.",
  styles: DOCKED_STYLES,
  render: dockedGlass,
  examples: [
    { label: "Against a wide screen's end", isWide: true, isStill: true, markup: html`<div class="docked-frame header-frame"><div class="backdrop is-framed" aria-hidden="true"></div>${dockedGlass({ dockedAt: "end", label: "Docked at the end", body: stackOfOne(html`<p>Only this side has an edge.</p>`, "words") })}</div>` },
    { label: "Against a narrow screen's foot", isStill: true, markup: html`<div class="docked-frame is-narrow header-frame"><div class="backdrop is-framed" aria-hidden="true"></div>${dockedGlass({ dockedAt: "foot", label: "Docked at the foot", body: stackOfOne(html`<p>Only this side has an edge.</p>`, "words") })}</div>` },
  ],
});

component({
  name: "Zaisma button",
  slug: "zaisma-button",
  group: "over-a-game",
  subgroup: "zaisma-button",
  summary: "A shard of glass with Zaisma's logo in the screen's top right corner while a game runs, its slant the Z's own lean: Zaisma's one way in. Always the same size and shape, the same glass as the overlay it opens, with nothing beside it and no count on it. On a touch screen it's always there; with a mouse it comes down its slant when pointed at and goes back up once left. Pointed at, its Edge light comes down its slant. Pressed, its glass sinks in place. Let go, the light goes back up as it goes up its slant and the Zaisma overlay slides in.",
  styles: PLAYING_STYLES,
  render: zaismaButton,
  examples: [
    { label: "In a screen's corner", isStill: true, markup: html`<div class="docked-frame"><div class="backdrop is-framed" aria-hidden="true"></div>${zaismaButton({ isShown: true })}</div>` },
  ],
});

component({
  name: "Zaisma overlay",
  slug: "zaisma-overlay",
  group: "over-a-game",
  subgroup: "zaisma-overlay",
  summary: "Zaisma's own interface over a running game, on Docked glass with the game in view, at a wide screen's end or a narrow one's foot: Room, Friends, This game and Inbox across its head, Share and Full screen at its foot's start (on an iPhone, Full screen shows the way to the Home Screen), and Leave apart at its end. Every part keeps its place on every screen. Only the player's own press opens it; a game can't. At most five tabs: anything new is a section in one.",
  styles: "",
  render: zaismaOverlay,
  examples: [],
});
