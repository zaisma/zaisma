import { LIGHT_GLASS, SMOKED_GLASS } from "./components/tokens.ts";
import { pageStyle } from "./page-styles.ts";

/**
 * The game page's own placing (pages.ts, gamePage): the details over the game's background, with the pane where the home's is and the
 * sections beside it, then the bar over the game once it's playing, and where its plates, cards and sheets put what's in them. Every piece
 * is a gallery component; this only places them, picks the words' type, and sets what they offer (--table-height).
 */
export const GAME_PAGE_STYLE = pageStyle("game-page", () => `
/* A game with its own background opens on its color and glass (GAME_OPENING_SCRIPT), and Zaisma's own backdrop stays unseen until it's
   shown (game-background-script.ts), or after a few seconds should the scripts not run, so the first frame is never Zaisma's world. */
html[data-game-world] body { background: var(--game-still, none) center / cover no-repeat fixed, var(--game-tone, var(--page)); }
html[data-game-glass="light"] [data-glass]:not([data-cut-line]) { ${LIGHT_GLASS} --glass-tint: var(--game-glass-tint); }
html[data-game-glass="smoked"] [data-glass]:not([data-cut-line]) { ${SMOKED_GLASS} --glass-tint: var(--game-glass-tint); }
html[data-game-world] canvas.backdrop { opacity: 0; transition: opacity 500ms ease; animation: game-backdrop-late 0s 4s forwards; }
html[data-game-world] canvas.backdrop.is-shown { opacity: 1; }
@keyframes game-backdrop-late { to { opacity: 1; } }
/* Two states on one page: the details over the game's background, then the game filling the screen with the bar above it. */
.game { display: grid; grid-template-columns: 390px minmax(0, 1fr); column-gap: var(--gap-block-block); align-items: start; padding: 0 var(--pad-pane); }
/* The window: the game's world, clear, above the pane and the sections, which come up over it as the page scrolls. */
.game-window { grid-column: 1 / -1; grid-row: 1; height: max(260px, calc(100svh - var(--header-room) - 460px)); }
.game-pane { grid-column: 1; grid-row: 2; position: sticky; top: var(--header-room); z-index: 5; margin-bottom: var(--gap-block-block); }
.game-pane > .glass-pane { width: 100%; max-height: calc(100svh - var(--header-room) - var(--pad-pane)); }
/* The pane: the game's title, who made it, who's playing, Play and Details, then Share and Report as words under them, then its facts. */
.game-head { display: grid; gap: var(--gap-words-words); }
.game-pane .game-head h1 { font: var(--type-title); overflow-wrap: anywhere; }
.game-by { font: var(--type-words); }
.game-note { font: var(--type-note); color: var(--ink-2); }
.game-act { display: flex; flex-direction: column; gap: var(--gap-control-stack); }
.game-more-actions { display: flex; flex-wrap: wrap; gap: 0 var(--gap-block-block); }
.game-closed { display: grid; gap: var(--gap-words-control); }
.game-closed p { font: var(--type-words); color: var(--ink); }
/* Friends playing it, under the title: their pictures, who they are, and Join; why Join won't work, under them. */
.friends-here { display: flex; align-items: center; flex-wrap: wrap; gap: var(--gap-words-words) var(--gap-words-control); font: var(--type-words); color: var(--ink-2); }
.friends-said { flex: 1; min-width: 0; }
.friends-why { flex-basis: 100%; font: var(--type-note); color: var(--muted); }

/* The sections: one scroll of glass beside the pane, rooms first when the game lists them. A link to one stops below the header. */
.game-sections { grid-column: 2; grid-row: 2; min-width: 0; display: flex; flex-direction: column; gap: var(--gap-block-block); margin-bottom: var(--gap-block-block); }
.game-sections > section { scroll-margin-top: var(--header-room); }
.game-sections .glass-pane { width: 100%; }
.game-sections .glass-pane h2 { font: var(--type-section); }
.game-description { font: var(--type-reading); white-space: pre-line; max-width: 68ch; }
.game-description.is-empty { color: var(--muted); }
/* Who made it, and their links, under the description and a line from it. */
.game-maker { display: flex; flex-direction: column; gap: var(--gap-block-block); padding-top: var(--gap-block-block); border-top: var(--divider); }
/* Updates keep the pane's height to about a screen; older ones scroll inside it, on its rail. */
#updates > .glass-pane { max-height: min(640px, 80svh); }
.game-more { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: var(--gap-block-block); }

/* Rooms: the heading with who's playing under it, beside the code box in the pane's top corner; then the pickers and the rooms. */
.rooms-top { display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--gap-words-control) var(--gap-block-block); }
.rooms-title { flex: 1 1 200px; display: grid; gap: var(--gap-words-words); min-width: 0; }
.rooms-playing { font: var(--type-words); }
.rooms-playing b { font-weight: 600; color: var(--ink); }
.rooms-top > .code-join { flex: 0 1 320px; min-width: 240px; }
.rooms-in { display: flex; flex-direction: column; gap: var(--gap-block-block); }
/* The region switch and the small label pickers share one row while they fit. */
.rooms-pick { display: flex; flex-wrap: wrap; align-items: center; gap: var(--gap-words-control); }
/* The label pickers stay together: beside the switch while they fit, or all on the next line. */
.rooms-filters { flex: 1 1 360px; display: flex; flex-wrap: wrap; gap: var(--gap-words-control); min-width: 0; }
/* Each picker keeps room for its name, its pick and its chevron; on a narrow phone they wrap two to a row. */
.rooms-filter { flex: 1 1 128px; min-width: 0; max-width: 200px; }
/* The region's picker has its globe to fit beside its words too. */
.rooms-filter[data-region-filter] { flex: 1.4 1 160px; max-width: 240px; }
/* Refresh at the row's end. */
#rooms-refresh { margin-left: auto; }
/* The rooms table keeps to about five rooms' height, so the rest of the page stays near; more scroll inside it under its header. */
#rooms-list { --table-height: 340px; }
.rooms-more { font: var(--type-note); color: var(--muted); }
/* Just back from a match: the room list waits a moment for a copy without the player in it. */
.just-left #rooms-list, .just-left #playing-now, .just-left #rooms-playing { visibility: hidden; }
/* Cloudflare's check is invisible; if it ever needs a tap, it sits at the bottom, above the game. */
.play-check { position: fixed; left: 50%; bottom: var(--pad-pane); transform: translateX(-50%); z-index: 50; }
/* A tester link that can't open: Zaisma's own glass, in the middle. */
.game-problem { display: flex; justify-content: center; padding: var(--gap-block-block) var(--pad-pane); }

/* Playing: the game is the whole screen. The details fade away over it (they're out of the way at once), then stop drawing. */
.game-bar { display: none; }
body.playing { height: 100vh; height: 100dvh; padding: 0; overflow: hidden; background: #000; flex-direction: column; }
body.playing > header.top, body.playing > .dropdown:not(#game-menu), body.playing > .foot, body.playing > .rail, body.playing > .ambient { display: none; }
body.playing > .game { position: fixed; inset: 0; z-index: 25; opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 0.3s, visibility 0s 0.3s; }
body.playing > .backdrop { opacity: 0; transition: opacity 0.3s; }
body.played > .game, body.played > .backdrop { display: none; }
body.playing > .game-bar { display: block; flex: none; position: relative; z-index: 20; }
.game-bar > .glass-pane > .pane-in { flex-direction: row; align-items: center; gap: var(--gap-words-words); padding: var(--gap-words-words) var(--pad-inner-pane); overflow: visible; }
.game-bar-home { --logo-height: 22px; display: inline-flex; color: var(--ink); }
.game-bar-title { margin: 0; min-width: 0; font: var(--type-name); color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.game-bar-space { flex: 1; }
/* How many are in the room: a count Tag on the Players button's corner. */
.game-bar-players { position: relative; display: inline-flex; }
.game-bar-count { position: absolute; z-index: 3; top: -8px; right: -8px; pointer-events: none; }
#room-open.is-code .face > span:not([class]) { font-variant-numeric: tabular-nums; letter-spacing: 0.12em; }
body.playing > iframe#game { flex: 1; display: block; width: 100%; min-height: 0; border: 0; background: #000; }
iframe#game:focus-visible { outline: none; }
/* Notices over the game sit just under the bar. */
body.playing > .notice { --under-header: 64px; }
/* Phones: the bar's buttons are their icons, big enough to tap; the menu names the game. */
@media (max-width: 760px) {
  .game-bar .cut-btn:not(.icon-only) .face > span:not([class]) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  #room-open.is-code .face > span:not([class]) { position: static; width: auto; height: auto; clip: auto; }
  .game-bar-title { display: none; }
}
/* Landscape phones: the bar becomes a slim strip down the left edge, so the game keeps its full height. */
@media (orientation: landscape) and (max-height: 500px) {
  body.playing { flex-direction: row; }
  .game-bar > .glass-pane { height: 100%; }
  .game-bar > .glass-pane > .pane-in { flex-direction: column; padding: var(--gap-words-words); }
  .game-bar .cut-btn:not(.icon-only) .face > span:not([class]), #room-open.is-code .face > span:not([class]) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .game-bar-title { display: none; }
}
/* The room plate: a small pane hanging from its button, over the game; nothing dims it. */
dialog.game-plate { position: fixed; z-index: 40; inset: auto; margin: 0; padding: 0; border: 0; background: none; width: min(320px, calc(100vw - 16px)); max-height: calc(100dvh - 70px); overflow: visible; color: var(--ink); }
dialog.game-plate > .glass-pane { width: 100%; }
.room-here { display: grid; gap: var(--gap-words-control); }
.room-title { font: var(--type-label); color: var(--ink); }
.room-line { display: flex; align-items: center; gap: var(--gap-words-words); }
.room-line b { flex: 1; min-width: 0; overflow: hidden; font: var(--type-heading); letter-spacing: 0.16em; color: var(--ink); }
.room-join { display: grid; gap: var(--gap-words-control); }
/* The connection, only when it isn't fine (amber when weak, the marked color when lost, turning while it reconnects), and Update beside it. */
#conn.weak .face { color: var(--meter-near); }
#conn.lost .face { color: var(--marked); }
#conn.retrying .face > .ico { animation: conn-turn 1.2s linear infinite; }
@keyframes conn-turn { to { transform: rotate(360deg); } }
#update.updating { cursor: default; }
.conn-title { font: var(--type-name); }
.conn-line { font: var(--type-words); font-variant-numeric: tabular-nums; }
/* Cards over the game's top corner: Keep your progress, a game's sign-in ask, a link leaving Zaisma. */
.game-card { position: fixed; z-index: 30; top: 64px; right: var(--pad-inner-pane); width: min(360px, calc(100vw - 2 * var(--pad-inner-pane))); }
.game-card > .glass-pane { width: 100%; }
.game-card h2 { font: var(--type-name); }
.link-part { display: flex; flex-direction: column; gap: var(--gap-block-block); }
@media (orientation: landscape) and (max-height: 500px) { .game-card { top: var(--pad-inner-pane); } }
/* Share: the QR code on white, so any phone's camera reads it, then the link. */
.share-secret { position: relative; display: grid; gap: var(--gap-words-control); }
.share-qr { margin: 0; display: grid; justify-items: center; gap: var(--gap-words-words); }
.share-qr img { display: block; width: min(220px, 100%); height: auto; aspect-ratio: 1; background: #fff; }
.share-qr figcaption { font: var(--type-label); color: var(--ink); }
.share-room { text-align: center; font: var(--type-words); }
.share-room b { margin-left: var(--gap-words-words); font: var(--type-name); letter-spacing: 0.14em; color: var(--ink); }
/* The room code is hidden (for streamers): the code, link and QR code blur until Show; Copy still works. */
.share-reveal { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 3; }
#share-dialog.masked .share-qr img, #share-dialog.masked .code-text, #share-dialog.masked .share-room b { filter: blur(7px); }
/* Report: the reasons lead on; what's sent with it is said under the form. */
.report-sub, .block-sub { margin: 0; font: var(--type-note); color: var(--muted); }
.report-step { display: flex; flex-direction: column; gap: var(--gap-block-block); }
.report-foot, .report-fine, .block-fine { margin: 0; font: var(--type-note); color: var(--muted); }
.report-pic { margin: 0; display: grid; gap: var(--gap-words-control); }
.report-pic img { display: block; width: 100%; max-height: 190px; object-fit: contain; background: #000; }
.report-pic:has(.check-input:not(:checked)) img { opacity: 0.3; filter: grayscale(1); }
.report-sent h3 { display: flex; align-items: center; gap: var(--gap-words-words); margin: 0; font: var(--type-section); }
.report-sent h3 > .ico { color: var(--online); }
/* Block: who it's about, and what it does. */
.block-who { display: flex; align-items: center; gap: var(--gap-words-control); }
.block-who strong { font: var(--type-section); overflow-wrap: anywhere; }
/* Players: who's in the room, each with Mute and more. */
.players-part { display: flex; flex-direction: column; gap: var(--gap-words-control); }
.players-heading { margin: 0; font: var(--type-label); color: var(--ink-2); }
#players-count { color: var(--muted); }
.players-row { flex-wrap: wrap; }
.players-face { display: inline-flex; }
.players-name { text-decoration: none; }
.players-actions { flex-basis: 100%; }
.players-note { margin: 0; font: var(--type-note); color: var(--muted); }
@media (max-width: 1100px) { .game { grid-template-columns: 340px minmax(0, 1fr); } }
@media (max-width: 760px) {
  .game { display: block; padding: 0 var(--gap-control-stack); }
  .game-window { height: max(200px, calc(100svh - var(--header-room) - 480px)); }
  .game-pane { position: relative; top: auto; }
  .rooms-top > .code-join { flex: 1 1 100%; min-width: 0; }
}
@media (prefers-reduced-motion: reduce) { body.playing > .game, body.playing > .backdrop { transition: none; } #conn.retrying .face > .ico { animation: none; } }
`);
