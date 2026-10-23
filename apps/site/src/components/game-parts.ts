import { html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { controlMarkup, type ControlMarkup } from "./control-markup.ts";
import { EDGE, glassPane, icon, logo, tag, type IconName } from "./foundations.ts";
import { cutButton, runButton } from "./actions.ts";
import { checkField } from "./choices.ts";
import { cutField } from "./fields.ts";
import { row, stack } from "./layout.ts";
import { LIGHT_GLASS, SMOKED_GLASS } from "./tokens.ts";

/**
 * The pieces a game's page is made of that no other page had yet: its words' types, the pane beside its sections (Split), the window onto
 * the game's world above them, the bar over a game while it plays, the plates that hang from the bar's buttons, the cards over the game's
 * corner, and the small things in its sheets (a room code box, a QR code, something hidden until shown, a picture with a check). Each is a
 * gallery component like any other, so the game page has no styles of its own (docs/DECISIONS.md, "A page is only gallery components").
 */

/* ---- Words: a page's title, a heading in a pane, and lines in each of the type tokens ---- */

export interface WordsOptions {
  id?: string;
  /** Not shown for now: a page script shows it. */
  isHidden?: boolean;
}

/** A page's own title (a game's), in --type-title: the one h1. */
export function pageTitle(text: string | Raw, options: WordsOptions = {}): Raw {
  return html`<h1 class="page-title"${options.id ? html` id="${options.id}"` : ""}${options.isHidden ? raw(" hidden") : ""}>${text}</h1>`;
}

/** A heading in a pane or a sheet, under its title: --type-section ("Rooms", "Thanks for the report"), with an icon before it if it has one. */
export function sectionHeading(text: string | Raw, options: WordsOptions & { level?: 2 | 3; icon?: IconName } = {}): Raw {
  const level = options.level ?? 2;
  return html`${raw(`<h${level} class="section-heading"`)}${options.id ? html` id="${options.id}"` : ""}${options.isHidden ? raw(" hidden") : ""}>${options.icon ? icon(options.icon) : ""}${text}${raw(`</h${level}>`)}`;
}

export interface ParagraphOptions extends WordsOptions {
  /**
   * Its type: "words" a line of words (who made it, who's playing), "reading" a paragraph to read that keeps its line breaks (a game's
   * description), "note" a note under something, "name" a name in a card's head, "code" a room code to read out.
   */
  type: "words" | "reading" | "note" | "name" | "code";
  /** Quieter: nothing written yet, or a note that only explains. */
  isMuted?: boolean;
  /** A mark before the words: a warning when the game can't start here. */
  icon?: IconName;
  /** Read out when it changes (a page script fills it in). */
  isLive?: boolean;
}

/** A line or paragraph of words in one of the type tokens. A <b> in it is the line's own value ("3 playing now"). */
export function paragraph(markup: string | Raw, options: ParagraphOptions): Raw {
  const className = ["words", `type-${options.type}`, options.isMuted ? "is-muted" : "", options.icon ? "has-icon" : ""].filter(Boolean).join(" ");
  return html`<p class="${className}"${options.id ? html` id="${options.id}"` : ""}${options.isLive ? raw(' role="status"') : ""}${options.isHidden ? raw(" hidden") : ""}>${options.icon ? icon(options.icon) : ""}${options.icon ? html`<span>${markup}</span>` : markup}</p>`;
}

component({
  name: "Words",
  slug: "words",
  group: "foundations",
  summary: "A page's title, a heading in a pane, and lines in each type token: words, a paragraph to read, a note, a name, a code. Words never carry a size of their own; pick what they are.",
  styles: `
/* Words: one of the type tokens each, set by what they are (Type). In a pane they keep its margin like any heading or paragraph. */
.glass-pane h1.page-title, h1.page-title { margin: 0; font: var(--type-title); color: var(--ink); overflow-wrap: anywhere; text-wrap: balance; }
.glass-pane .section-heading, .section-heading { display: flex; align-items: center; gap: var(--gap-words-words); margin: 0; font: var(--type-section); color: var(--ink); }
.section-heading > .ico { flex: none; color: var(--online); }
.glass-pane p.words, p.words { margin: 0; color: var(--ink-2); }
.words.type-words { font: var(--type-words); }
.words.type-reading { font: var(--type-reading); white-space: pre-line; max-width: var(--size-reading); }
.words.type-note { font: var(--type-note); }
.words.type-name { font: var(--type-name); color: var(--ink); }
.words.type-code { font: var(--type-heading); letter-spacing: 0.16em; color: var(--ink); font-variant-numeric: tabular-nums; overflow: hidden; }
.words.is-muted { color: var(--muted); }
.words b { font-weight: 600; color: var(--ink); }
/* A mark before the words, on their first line. */
.words.has-icon:not([hidden]) { display: flex; align-items: center; gap: var(--gap-words-words); }
.words.has-icon > .ico { flex: none; width: 16px; height: 16px; color: var(--tag-warning-ink); }
`,
  render: paragraph,
  examples: [
    { label: "A page's title", markup: glassPane({ paneWidth: "fit", body: stack({ items: [{ kind: "words", markup: pageTitle("Ashen Crown") }] }) }) },
    {
      label: "A heading, a line with its value, a paragraph to read, a note",
      markup: glassPane({
        paneWidth: "fit",
        body: stack({
          items: [
            { kind: "words", markup: sectionHeading("Rooms") },
            { kind: "words", markup: paragraph(html`<b>267</b> playing now in 78 rooms`, { type: "words" }) },
            { kind: "words", markup: paragraph("A fallen knight climbs a burning kingdom to take its crown back.\nHard, fair fights, and a map you learn by heart.", { type: "reading" }) },
            { kind: "words", markup: paragraph("Needs a Zaisma account", { type: "note" }) },
          ],
        }),
      }),
    },
    { label: "A warning note, and nothing written yet", markup: glassPane({ paneWidth: "fit", body: stack({ items: [{ kind: "words", markup: paragraph("This game needs Chrome or Edge on a computer or Android.", { type: "note", icon: "warning" }) }, { kind: "words", markup: paragraph("The developer hasn't written about this game yet.", { type: "reading", isMuted: true }) }] }) }) },
    { label: "A room code to read out", markup: glassPane({ paneWidth: "fit", body: stack({ items: [{ kind: "words", markup: paragraph("BCDFGH", { type: "code" }) }] }) }) },
  ],
});

/* ---- Split: a pane beside what scrolls past it ---- */

export interface SplitOptions {
  /** The pane at the start: a game's details. It stays in view under the header while the rest scrolls, while they're side by side. */
  side: Raw;
  /** What fills the rest of the width: a game's sections. */
  main: Raw;
}

/** The side's width beside the rest, and below what width of its own the split goes one over the other. */
const SPLIT_STACKS_BELOW_PX = 760;

/**
 * A pane at the start, a details pane's width, beside the rest of the width, one over the other where the split hasn't the room for both
 * (by its own width). The side stays in view under the header as the rest scrolls, and long content scrolls inside it.
 */
export function split(options: SplitOptions): Raw {
  return html`<div class="layout-split"><div class="split-in"><div class="split-side">${options.side}</div><div class="split-main">${options.main}</div></div></div>`;
}

component({
  name: "Split",
  slug: "split",
  group: "layout",
  summary: "A details pane at the start beside the rest of the width: a game's pane beside its sections. The pane stays in view while the rest scrolls; they go one over the other when there isn't room for both.",
  styles: `
/* A split: the side a details pane's width (--size-side, narrower when the split is), beside the rest; one over the other below
   ${SPLIT_STACKS_BELOW_PX}px of its own width. The side stays in view under the header, no taller than the screen. */
.layout-split { container-type: inline-size; width: 100%; min-width: 0; }
.split-in { display: grid; grid-template-columns: var(--size-side) minmax(0, 1fr); gap: var(--gap-block-block); align-items: start; }
.split-side { position: sticky; top: var(--header-room, var(--pad-pane)); z-index: 5; min-width: 0; display: flex; flex-direction: column; }
.split-side > .glass-pane { width: 100%; max-height: calc(100svh - var(--header-room, 0px) - var(--pad-pane)); }
.split-main { min-width: 0; display: flex; flex-direction: column; gap: var(--gap-block-block); }
.split-main > * { scroll-margin-top: var(--header-room, 0px); }
@container (max-width: 1060px) { .split-in { grid-template-columns: var(--size-side-narrow) minmax(0, 1fr); } }
@container (max-width: ${SPLIT_STACKS_BELOW_PX - 1}px) {
  .split-in { grid-template-columns: minmax(0, 1fr); }
  .split-side { position: static; }
  .split-side > .glass-pane { max-height: none; }
}
`,
  render: split,
  examples: [
    {
      label: "A game's pane beside its sections",
      isWide: true,
      markup: split({
        side: glassPane({ paneWidth: "full", body: stack({ items: [{ kind: "words", markup: pageTitle("Ashen Crown") }, { kind: "block", markup: row({ widths: "lead-fills", items: [{ kind: "control", markup: runButton("Play", { type: "button", icon: "play", isBig: true }) }, { kind: "control", markup: cutButton("Details", { type: "button", isBig: true }) }] }) }] }) }),
        main: html`${glassPane({ paneWidth: "full", body: stack({ items: [{ kind: "words", markup: sectionHeading("About") }, { kind: "words", markup: paragraph("A fallen knight climbs a burning kingdom to take its crown back.", { type: "reading" }) }] }) })}${glassPane({ paneWidth: "full", body: stack({ items: [{ kind: "words", markup: sectionHeading("Updates") }, { kind: "words", markup: paragraph("Two new caves, and a lantern that lasts the whole night.", { type: "reading" }) }] }) })}`,
      }),
    },
  ],
});

/* ---- World window: the game's world, clear, above the page's glass ---- */

/**
 * A clear opening onto the page's background, above the glass, which comes up over it as the page scrolls: a game's world, before you
 * play. Its height leaves the top of what's under it in view.
 */
export function worldWindow(): Raw {
  return raw('<div class="world-window" aria-hidden="true"></div>');
}

component({
  name: "World window",
  slug: "world-window",
  group: "foundations",
  summary: "A clear opening onto the background above a page's glass, so a game's world shows before you play. Only a game's page has one.",
  styles: `
/* The window: the world, clear, about a screen less what's under it, so the glass under it starts in view. */
.world-window { height: max(260px, calc(100svh - var(--header-room, 0px) - 460px)); }
@media (max-width: 760px) { .world-window { height: max(200px, calc(100svh - var(--header-room, 0px) - 480px)); } }
/* A game with its own background opens on its color and glass (the game page's opening script), and Zaisma's own backdrop stays unseen
   until it's shown (game-background-script.ts), or after a few seconds should the scripts not run, so the first frame is never Zaisma's
   world when the game has one of its own. */
html[data-game-glass="light"] [data-glass]:not([data-cut-line]) { ${LIGHT_GLASS} --glass-tint: var(--game-glass-tint); }
html[data-game-glass="smoked"] [data-glass]:not([data-cut-line]) { ${SMOKED_GLASS} --glass-tint: var(--game-glass-tint); }
html[data-game-world] body { background: var(--game-still, none) center / cover no-repeat fixed, var(--game-tone, var(--page)); }
html[data-game-world] canvas.backdrop { opacity: 0; transition: opacity 500ms ease; animation: world-backdrop-late 0s 4s forwards; }
html[data-game-world] canvas.backdrop.is-shown { opacity: 1; }
@keyframes world-backdrop-late { to { opacity: 1; } }
`,
  render: worldWindow,
  examples: [{ label: "Above a pane: the world shows through the opening", isWide: true, markup: html`${worldWindow()}${glassPane({ paneWidth: "fit", body: stack({ items: [{ kind: "words", markup: pageTitle("Ashen Crown") }] }) })}` }],
});

/* ---- Code join: a room code and Join, as one control ---- */

export interface CodeJoinOptions {
  /** Unique on the page: the field's id. */
  id: string;
  /** Where the code goes: the game's page, which opens the room (?room=). */
  action: string;
  /** Its label, said to screen readers; the placeholder says it on screen. */
  label: string;
  /** Shows its label over it, and Join under the field the box's whole width (the bar's room plate). */
  isStacked?: boolean;
}

/** A box for a room code a friend shared, and Join: one control, a field and its button, that opens the same room link an invite does. */
export function codeJoin(options: CodeJoinOptions): ControlMarkup {
  const field = cutField({ id: options.id, name: "room", label: options.label, type: "text", icon: "hash", placeholder: options.isStacked ? "ABC234" : "Room code", autocomplete: "off", isRequired: true, isLabelHidden: !options.isStacked });
  const join = cutButton("Join", { type: "submit", isFullWidth: options.isStacked });
  // Side by side, the field fills and Join fits its words (a Row); stacked, Join goes under the field, its whole width (a Stack).
  const inside = options.isStacked ? stack({ items: [{ kind: "control", markup: field }, { kind: "control", markup: join }] }) : row({ widths: "lead-fills", items: [{ kind: "control", markup: field }, { kind: "control", markup: join }] });
  return controlMarkup(html`<form class="code-join${options.isStacked ? " is-stacked" : ""}" method="get" action="${options.action}">${inside}</form>`, "regular", { hasOwnWords: options.isStacked });
}

component({
  name: "Code join",
  slug: "code-join",
  group: "inputs",
  summary: "A room code a friend shared, and Join, as one control: in a Rooms pane's corner, or stacked in the bar's room plate.",
  styles: `
/* Code join: as wide as a room code needs and no wider than its place; its Row or Stack places the field and Join. */
.code-join { display: block; width: 320px; max-width: 100%; min-width: 0; }
.code-join.is-stacked { width: 100%; }
`,
  render: codeJoin,
  examples: [
    { label: "In a pane's corner", markup: glassPane({ paneWidth: "fit", body: codeJoin({ id: "code-join-example", action: "#code-join", label: "Join a room by its code" }) }) },
    { label: "Stacked, in a plate", markup: glassPane({ paneWidth: "fit", body: codeJoin({ id: "code-join-stacked", action: "#code-join", label: "Join a room by its code", isStacked: true }) }) },
  ],
});

/* ---- Game bar: over a game while it plays ---- */

export interface GameBarOptions {
  title: string;
  /** Players, with how many are in the room on its corner (#players-count-badge), when the game is online. */
  players?: ControlMarkup;
  /** The rest, start to end: small cut buttons (Keep progress, Join, the connection, Share, Full screen, More). */
  controls: (Raw | string)[];
  /** Shown outside a game, as the gallery shows it. */
  isShown?: boolean;
}

/**
 * The bar over a game while it plays: Zaisma's mark back to all games, the game's title, then its buttons. While it plays (body.playing),
 * the page's main and its header give way to the game under this bar. On a phone its buttons are their icons; on a landscape phone it's
 * a strip down the left edge, so the game keeps its height.
 */
export function gameBar(options: GameBarOptions): Raw {
  const players = options.players ? html`<span class="game-bar-players">${options.players}<span class="game-bar-count" id="players-count-badge" hidden>${tag("", "count")}</span></span>` : "";
  return html`<div class="game-bar${options.isShown ? " is-shown" : ""}"${options.isShown ? "" : raw(' id="game-bar"')}><div class="glass game-bar-in" data-glass data-glass-corners="0 0 header-large header-small" role="group" aria-label="Game controls">${EDGE}<a class="game-bar-home" href="/" aria-label="All games">${logo("mark")}</a><p class="game-bar-title">${options.title}</p><span class="game-bar-space"></span>${players}${options.controls}</div></div>`;
}

component({
  name: "Game bar",
  slug: "game-bar",
  group: "navigation",
  summary: "The bar over a game while it plays: back to all games, the game's title, and its buttons. The page gives way to the game under it.",
  styles: `
/* The bar shows only while a game plays: the page's main, header and footer give way to the game, under the bar. */
.game-bar { display: none; }
.game-bar.is-shown { display: block; }
body.playing { height: 100vh; height: 100dvh; padding: 0; overflow: hidden; background: #000; flex-direction: column; }
body.playing > header.top, body.playing > .dropdown:not(#game-menu), body.playing > .foot, body.playing > .rail, body.playing > .ambient { display: none; }
body.playing > main { position: fixed; inset: 0; z-index: 25; opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 0.3s, visibility 0s 0.3s; }
body.playing > .backdrop { opacity: 0; transition: opacity 0.3s; }
body.played > main, body.played > .backdrop { display: none; }
body.playing > .game-bar { display: block; flex: none; position: relative; z-index: 20; }
body.playing > iframe { flex: 1; display: block; width: 100%; min-height: 0; border: 0; background: #000; }
body.playing > iframe:focus-visible { outline: none; }
/* Notices over the game sit just under the bar. */
body.playing > .notice { --under-header: 64px; }
.game-bar-in { display: flex; align-items: center; gap: var(--gap-words-words); padding: var(--gap-words-words) var(--pad-inner-pane); }
.game-bar-home { --logo-height: 22px; display: inline-flex; color: var(--ink); }
.game-bar-title { margin: 0; min-width: 0; font: var(--type-name); color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.game-bar-space { flex: 1; }
/* How many are in the room: a count Tag on the Players button's corner. */
.game-bar-players { position: relative; display: inline-flex; }
.game-bar-count { position: absolute; z-index: 3; top: -8px; right: -8px; pointer-events: none; }
/* Join turns into the room's code while in a room; the connection's button shows only when it isn't fine: amber when weak, the marked
   color when lost, turning while it reconnects. */
.game-bar .cut-btn.is-code .face > span:not([class]) { font-variant-numeric: tabular-nums; letter-spacing: 0.12em; }
.game-bar .cut-btn.weak .face { color: var(--meter-near); }
.game-bar .cut-btn.lost .face { color: var(--marked); }
.game-bar .cut-btn.retrying .face > .ico { animation: game-bar-turn 1.2s linear infinite; }
.game-bar .cut-btn.updating { cursor: default; }
@keyframes game-bar-turn { to { transform: rotate(360deg); } }
/* Phones: the bar's buttons are their icons, big enough to tap; the menu names the game. */
@media (max-width: 760px) {
  .game-bar .cut-btn:not(.icon-only, .is-code) .face > span:not([class]) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .game-bar-title { display: none; }
}
/* Landscape phones: the bar becomes a slim strip down the left edge, so the game keeps its full height. */
@media (orientation: landscape) and (max-height: 500px) {
  body.playing { flex-direction: row; }
  .game-bar-in { height: 100%; flex-direction: column; padding: var(--gap-words-words); }
  .game-bar .cut-btn:not(.icon-only) .face > span:not([class]) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .game-bar-title { display: none; }
}
@media (prefers-reduced-motion: reduce) { body.playing > main, body.playing > .backdrop { transition: none; } .game-bar .cut-btn.retrying .face > .ico { animation: none; } }
`,
  render: gameBar,
  examples: [
    {
      label: "Over a game online, in a room",
      isWide: true,
      markup: gameBar({
          title: "Ashen Crown",
          players: cutButton("Players", { type: "button", icon: "people", isSmall: true }),
          controls: [cutButton("Join", { type: "button", icon: "hash", isSmall: true }), cutButton("Share", { type: "button", icon: "share", isSmall: true }), cutButton("Full screen", { type: "button", icon: "full-screen", isSmall: true }), cutButton("More", { type: "button", icon: "more", isSmall: true, isLabelHidden: true })],
        isShown: true,
      }),
    },
  ],
});

/* ---- Plate: a small pane hanging from its button ---- */

export interface PlateOptions {
  /** Unique on the page: its button's aria-controls. */
  id: string;
  /** What it is, for a screen reader. */
  label: string;
  body: Raw;
  /** Shown in place, as the gallery shows it. */
  isShown?: boolean;
}

/** A small pane that hangs from the button that opens it, over the game, with nothing dimmed behind it: the room's, the connection's. */
export function plate(options: PlateOptions): Raw {
  return html`<dialog class="plate${options.isShown ? " is-shown" : ""}" id="${options.id}" aria-label="${options.label}"${options.isShown ? raw(" open") : ""}>${glassPane({ paneWidth: "fit", body: options.body })}</dialog>`;
}

component({
  name: "Plate",
  slug: "plate",
  group: "panes",
  summary: "A small pane hanging from the bar's button that opens it, over the game, nothing dimmed: the room you're in and a code to join, the connection.",
  styles: `
/* A plate: placed under its button by the page's script, as wide as a small pane, no taller than the screen under the bar. */
dialog.plate { position: fixed; z-index: 40; inset: auto; margin: 0; padding: 0; border: 0; background: none; width: min(320px, calc(100vw - 16px)); max-height: calc(100dvh - 70px); overflow: visible; color: var(--ink); }
dialog.plate > .glass-pane { width: 100%; }
dialog.plate.is-shown { position: relative; z-index: auto; display: block; }
`,
  render: plate,
  examples: [
    {
      label: "The room's plate",
      markup: plate({
          id: "plate-example",
          label: "Room",
          body: stack({
            items: [
              { kind: "words", markup: paragraph("This room", { type: "note" }) },
              { kind: "block", markup: row({ widths: "lead-fills", items: [{ kind: "words", markup: paragraph("BCDFGH", { type: "code" }) }, { kind: "control", markup: cutButton("Copy", { type: "button", isSmall: true }) }] }) },
              { kind: "control", markup: codeJoin({ id: "plate-example-code", action: "#plate", label: "Join a room by its code", isStacked: true }) },
            ],
          }),
          isShown: true,
        }),
    },
  ],
});

/* ---- Corner card: over the game's top corner ---- */

export interface CornerCardOptions {
  id: string;
  /** Its heading's id. */
  titleId: string;
  body: Raw;
  /** Shown in place, as the gallery shows it. */
  isShown?: boolean;
}

/** A card over the game's top corner that asks one thing and waits: keep your progress, the game asks you to sign in, a link leaving Zaisma. */
export function cornerCard(options: CornerCardOptions): Raw {
  return html`<aside class="corner-card${options.isShown ? " is-shown" : ""}" id="${options.id}" role="dialog" aria-labelledby="${options.titleId}"${options.isShown ? "" : raw(" hidden")}>${glassPane({ paneWidth: "fit", body: options.body })}</aside>`;
}

component({
  name: "Corner card",
  slug: "corner-card",
  group: "panes",
  summary: "A card over the game's top corner that asks one thing while the game keeps running: keep your progress, sign in, open a link.",
  styles: `
.corner-card { position: fixed; z-index: 30; top: 64px; right: var(--pad-inner-pane); width: min(360px, calc(100vw - 2 * var(--pad-inner-pane))); }
.corner-card > .glass-pane { width: 100%; }
.corner-card.is-shown { position: relative; top: auto; right: auto; }
@media (orientation: landscape) and (max-height: 500px) { .corner-card { top: var(--pad-inner-pane); } }
`,
  render: cornerCard,
  examples: [
    {
      label: "Keep your progress",
      markup: cornerCard({
          id: "corner-card-example",
          titleId: "corner-card-example-title",
          body: stack({
            items: [
              { kind: "words", markup: html`<h2 id="corner-card-example-title">Keep your progress</h2>` },
              { kind: "words", markup: paragraph("Your Ashen Crown progress is only saved in this browser. Make a free account to keep it safe and play on any device.", { type: "words" }) },
              { kind: "block", markup: row({ widths: "lead-fills", items: [{ kind: "control", markup: runButton("Make an account", { type: "button" }) }, { kind: "control", markup: cutButton("Not now", { type: "button" }) }] }) },
            ],
          }),
          isShown: true,
        }),
    },
  ],
});

/* ---- QR code, and something hidden until shown ---- */

/** A QR code on white, so any phone's camera reads it, with what to do under it. A page script draws it (its img's src). */
export function qrCode(options: { id: string; alt: string; caption: string; captionId: string }): Raw {
  return html`<figure class="qr-code"><img id="${options.id}" alt="${options.alt}" width="220" height="220"><figcaption id="${options.captionId}">${options.caption}</figcaption></figure>`;
}

component({
  name: "QR code",
  slug: "qr-code",
  group: "data",
  summary: "A link as a QR code, on white so any phone's camera reads it, with what to do under it: Scan to play.",
  styles: `
.qr-code { margin: 0; display: grid; justify-items: center; gap: var(--gap-words-words); }
.qr-code img { display: block; width: min(220px, 100%); height: auto; aspect-ratio: 1; background: #fff; }
.qr-code figcaption { font: var(--type-label); color: var(--ink); }
`,
  render: qrCode,
  examples: [{ label: "Scan to play", markup: glassPane({ paneWidth: "fit", body: qrCode({ id: "qr-code-example", alt: "QR code for this link", caption: "Scan to play", captionId: "qr-code-example-caption" }) }) }],
});

/** Words and codes hidden until shown (a streamer's room code): blurred while .is-masked, with Show over them; Copy still works. */
export function secretBox(options: { id: string; body: Raw; revealId: string; isMasked?: boolean }): Raw {
  return html`<div class="secret-box${options.isMasked ? " is-masked" : ""}" id="${options.id}">${options.body}<span class="secret-reveal" id="${options.revealId}"${options.isMasked ? "" : raw(" hidden")}>${cutButton("Show", { type: "button", icon: "eye" })}</span></div>`;
}

component({
  name: "Secret box",
  slug: "secret-box",
  group: "panes",
  summary: "What a streamer keeps off screen, like a room code, its link and its QR code: blurred until Show, while Copy still works.",
  styles: `
.secret-box { position: relative; display: flex; flex-direction: column; gap: var(--gap-block-block); }
.secret-reveal { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 3; }
.secret-box.is-masked :is(img, .code-text, .words b) { filter: blur(7px); }
`,
  render: secretBox,
  examples: [
    {
      label: "Hidden until shown",
      markup: glassPane({ paneWidth: "fit", body: secretBox({ id: "secret-box-example", revealId: "secret-box-example-show", isMasked: true, body: paragraph(html`Room code <b>BCDFGH</b>`, { type: "words" }) }) }),
    },
  ],
});

/* ---- Picture check: a picture to send along, or not ---- */

/** A picture with a check under it: sent along when ticked, grayed when not (a report's picture of the game). */
export function pictureCheck(options: { id: string; imageId: string; alt: string; checkId: string; checkName: string; checkLabel: string; isHidden?: boolean }): Raw {
  return html`<figure class="picture-check" id="${options.id}"${options.isHidden ? raw(" hidden") : ""}><img id="${options.imageId}" alt="${options.alt}">${checkField({ id: options.checkId, name: options.checkName, label: options.checkLabel, isChecked: true })}</figure>`;
}

component({
  name: "Picture check",
  slug: "picture-check",
  group: "data",
  summary: "A picture to send along with a form, and a check to leave it out: a report's picture of the game. Unticked, it grays.",
  styles: `
.picture-check { margin: 0; display: grid; gap: var(--gap-words-control); }
.picture-check img { display: block; width: 100%; max-height: 190px; object-fit: contain; background: #000; }
.picture-check:has(.check-input:not(:checked)) img { opacity: 0.3; filter: grayscale(1); }
`,
  render: pictureCheck,
  examples: [{ label: "Ticked", markup: glassPane({ paneWidth: "fit", body: pictureCheck({ id: "picture-check-example", imageId: "picture-check-example-img", alt: "The game", checkId: "picture-check-example-check", checkName: "picture", checkLabel: "Include this picture of the game" }) }) }],
});

/* ---- Check spot: where Cloudflare's check asks for a tap, if it ever does ---- */

/** Where Cloudflare's invisible check sits should it ever need a tap: at the bottom, over everything. */
export function checkSpot(id: string): Raw {
  return html`<div class="check-spot" id="${id}"></div>`;
}

component({
  name: "Check spot",
  slug: "check-spot",
  group: "panes",
  summary: "Where Cloudflare's invisible check shows, if it ever needs a tap: at the bottom of the screen, over the game.",
  styles: `
.check-spot { position: fixed; left: 50%; bottom: var(--pad-pane); transform: translateX(-50%); z-index: 50; }
`,
  render: checkSpot,
  examples: [{ label: "Empty until the check needs a tap: nothing shows", markup: paragraph("Cloudflare's check would show at the bottom of the screen here.", { type: "note", isMuted: true }) }],
});
