import { html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import type { ControlMarkup } from "./control-markup.ts";
import { cutButton, runButton, textLink } from "./actions.ts";
import { EDGE, logo } from "./foundations.ts";
import { row, stack } from "./layout.ts";

/*
 * A game's page: its screenshots, and playing it. Playing is the page once Play is pressed. The game fills the screen; Zaisma keeps one slim bar of glass beside it (above it, or down
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

/** A screenshot in a game's row of them: the picture, cut like a pane's corner, which opens large in a sheet. */
export const screenshot = (options: ScreenshotOptions): Raw =>
  html`<button class="screenshot" type="button" data-cut-line="0" aria-controls="${options.sheetId}" aria-label="${options.label}"><img src="${options.imageUrl}" alt="" loading="lazy" decoding="async"></button>`;

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
html.is-leaving body > main > :not(.playing-bar, .playing-card, .playing-check, .dropdown, dialog), html.is-leaving body > :is(.top, .backdrop, .foot, .rail) { opacity: 0; transition: opacity 0.25s ease; }
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

/* A card over the game's top corner, under the bar: glass the game shows through, as wide as a phone allows. */
.playing-card { position: fixed; z-index: 20; top: calc(var(--control-height-small) + 3 * var(--pad-frame)); right: var(--pad-frame); width: min(360px, calc(100vw - 2 * var(--pad-frame))); margin: 0; padding: var(--pad-inner-pane); color: var(--ink); --glass-tint: var(--glass-dropdown); animation: playing-card-in 0.26s cubic-bezier(.2,.8,.2,1); }
.playing-card[hidden] { display: none; }
.playing-card > :not(.edge) { position: relative; z-index: 1; }
.playing-card.in-place { position: relative; top: auto; right: auto; animation: none; }
.playing-card-in { display: flex; flex-direction: column; gap: var(--gap-words-control); font: var(--type-words); }
.playing-card-in p { margin: 0; }
.playing-card-title { margin: 0; font: var(--type-heading); }
@keyframes playing-card-in { from { opacity: 0; transform: translateY(-8px); } }
@media (orientation: landscape) and (max-height: 500px) { .playing-card { top: var(--pad-frame); } }
@media (prefers-reduced-motion: reduce) { .playing-card, html.is-playing .game-frame { animation: none; } }

/* Screenshots: the picture fills a cut slab; pointed at, it comes a little closer. Large, it's whole, as big as the screen allows. */
.screenshot { display: block; width: 100%; aspect-ratio: 16 / 9; padding: 0; border: 0; overflow: hidden; background: var(--well); cursor: zoom-in; clip-path: var(--cut-shape); }
.screenshot img { display: block; width: 100%; height: 100%; object-fit: cover; transition: transform 0.3s cubic-bezier(.2,.8,.2,1); }
.screenshot:hover img { transform: scale(1.03); }
.screenshot:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.screenshot-large { display: block; width: min(1280px, calc(100vw - 6 * var(--pad-pane))); max-height: 70dvh; object-fit: contain; }
@media (prefers-reduced-motion: reduce) { .screenshot img { transition: none; } }

/* Cloudflare's check: unseen; if it ever needs a tap, at the foot of the screen, over the page or the game. */
.playing-check { position: fixed; z-index: 30; left: 50%; bottom: var(--pad-pane); transform: translateX(-50%); }
`;

const STAND_IN_CONTROLS = (): ControlMarkup[] => [
  cutButton("Players", { type: "button", icon: "people", isLabelHidden: true, isSmall: true }),
  cutButton("Join", { type: "button", icon: "hash", isSmall: true }),
  cutButton("Share", { type: "button", icon: "share", isLabelHidden: true, isSmall: true }),
  cutButton("Full screen", { type: "button", icon: "full-screen", isLabelHidden: true, isSmall: true }),
  cutButton("More", { type: "button", icon: "more", isLabelHidden: true, isSmall: true, isExpanded: false }),
];

component({
  name: "Screenshot",
  slug: "screenshot",
  group: "data",
  summary: "A game's screenshot in its row of them, cut like a pane's corner; it opens large in a sheet, whole, as big as the screen allows.",
  styles: "",
  render: screenshot,
  examples: [
    { label: "In a row", markup: html`<div style="width:280px">${screenshot({ imageUrl: "/design/covers/neon-drift.webp", label: "Screenshot 1 of 3", sheetId: "example-screenshot" })}</div>` },
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
  summary: "A card over a running game's top corner, for what needs the player now (keep your progress, a game asking them to sign in) or what just happened (Saved). The game keeps running and stays in view.",
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
