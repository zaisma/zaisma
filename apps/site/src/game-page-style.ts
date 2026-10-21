import { DEVELOPER_LINK_STYLES } from "./game-links.ts";
import { pageStyle } from "./page-styles.ts";

/**
 * The game page's own placing (pages.ts, gamePage): the details over the game's background, with the pane where the home's is and the
 * sections beside it, then the bar over the game once it's playing, the rooms, and the insides of its sheets and cards. Every piece in
 * them is a component; this only places them and sets what they offer.
 */
export const GAME_PAGE_STYLE = pageStyle("game-page", () => `
/* Two states on one page: the details over the game's background, then the game filling the screen with the bar above it. */
.game { display: grid; grid-template-columns: 390px minmax(0, 1fr); column-gap: var(--gap-block-block); align-items: start; padding: 0 var(--pad-pane); }
/* The window: the game's world, clear, above the pane and the sections, which come up over it as the page scrolls. */
.game-window { grid-column: 1 / -1; grid-row: 1; height: max(260px, calc(100svh - var(--header-room) - 420px)); }
.game-pane { grid-column: 1; grid-row: 2; position: sticky; top: var(--header-room); z-index: 5; margin-bottom: var(--gap-block-block); }
.game-pane > .glass-pane { width: 100%; max-height: calc(100svh - var(--header-room) - var(--pad-pane)); }
.game-head h1 { margin: 0; font: var(--type-title); text-wrap: balance; }
.game-by { margin: var(--gap-words-words) 0 0; font: var(--type-words); }
.game-note { margin: 0; font: var(--type-note); color: var(--ink-2); }
.game-actions > .cut-btn.icon-only { flex: 0 0 56px; }
.game-closed { display: grid; gap: var(--gap-words-control); }
.game-closed p { font: var(--type-words); color: var(--ink); }
/* Friends playing it, under the title: their pictures, who they are, and Join. */
.friends-here { display: flex; align-items: center; flex-wrap: wrap; gap: var(--gap-words-words) var(--gap-words-control); font: var(--type-words); color: var(--ink-2); }
.friends-said { flex: 1; min-width: 0; }
.join-off { position: relative; display: inline-flex; cursor: not-allowed; outline: none; }
.join-off > .cut-btn { pointer-events: none; }
.join-off:hover::after, .join-off:focus::after { content: attr(data-reason); position: absolute; right: 0; bottom: calc(100% + var(--gap-words-words)); z-index: 5; white-space: nowrap;
  padding: var(--gap-words-words) var(--pad-inner-pane); font: var(--type-facts); color: var(--ink); background: var(--chart-tip); box-shadow: 0 6px 16px var(--picture-shadow); }
/* The sections: one scroll of glass beside the pane, rooms first when the game lists them. A link to one stops below the header. */
.game-sections { grid-column: 2; grid-row: 2; min-width: 0; display: flex; flex-direction: column; gap: var(--gap-block-block); margin-bottom: var(--gap-block-block); }
.game-sections > section { scroll-margin-top: var(--header-room); }
.game-sections .glass-pane { width: 100%; }
.game-section-head { display: flex; align-items: center; flex-wrap: wrap; gap: var(--gap-words-control) var(--gap-block-block); }
.game-section-head h2 { flex: 1; }
.game-sections h2 { font: var(--type-section); }
.game-description { font: var(--type-reading); white-space: pre-line; max-width: 68ch; }
.game-description.is-empty { color: var(--muted); }
.game-updates { list-style: none; margin: 0; padding: 0; display: grid; }
.game-updates > li { padding: var(--gap-block-block) 0; }
.game-updates > li:first-child { padding-top: 0; }
.game-updates > li + li { border-top: var(--divider); }
.game-updates h3 { margin: 0 0 var(--gap-words-words); font: var(--type-name); }
.game-updates p { font: var(--type-reading); white-space: pre-line; }
.game-more { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: var(--gap-block-block); }
/* Screenshots: a row of the developer's pictures, bare, that scrolls sideways; one opens large in its sheet. */
.game-pictures { --fade-sideways-px: 48px; display: flex; gap: var(--gap-block-block); overflow-x: auto; scrollbar-width: none; padding-bottom: var(--gap-words-words); }
.game-pictures::-webkit-scrollbar { display: none; }
.game-picture { flex: 0 0 clamp(220px, 30%, 360px); aspect-ratio: 16 / 9; margin: 0; padding: 0; border: 0; background: var(--well); cursor: zoom-in; box-shadow: 0 4px 10px var(--picture-shadow); }
.game-picture img { display: block; width: 100%; height: 100%; object-fit: cover; }
.game-picture:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
#picture-sheet { width: min(1100px, calc(100% - 2 * var(--pad-pane))); }
.game-picture-large { display: block; width: 100%; height: auto; max-height: calc(100dvh - 160px); object-fit: contain; }
/* Rooms: the code box, who's playing, the region and label pickers, then one row per room with its seats, where it runs and Join. */
.code-join { display: flex; align-items: flex-end; gap: var(--gap-words-control); }
.code-join > .cut-field { width: 220px; }
.rooms-in { display: flex; flex-direction: column; gap: var(--gap-block-block); }
.rooms-head { font: var(--type-words); }
.rooms-head b { font-weight: 600; color: var(--ink); }
.rooms-pick { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--gap-block-block); }
.rooms-regions { max-width: 100%; overflow-x: auto; scrollbar-width: none; }
.rooms-filters { display: flex; flex-wrap: wrap; gap: var(--gap-words-control) var(--gap-block-block); }
.rooms-filter { width: 200px; }
.rooms .list-row { gap: var(--gap-block-block); }
/* Join lines up down the list, whether a room has a name to report or not. */
.rooms .list-row-end { width: 112px; justify-content: flex-start; }
.room .title { display: flex; flex-direction: column; gap: var(--gap-words-words); min-width: 0; }
.room .name, .room .count { font: var(--type-label); color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.room .labels, .room .small-count { font: var(--type-facts); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.room .fill { display: flex; align-items: center; gap: var(--gap-words-control); flex: 0 1 230px; min-width: 0; }
.room .where { display: flex; align-items: center; gap: var(--gap-words-words); min-width: 52px; font: var(--type-facts); color: var(--ink-2); }
.room .where abbr { text-decoration: none; }
.room .flag { width: 20px; height: 15px; flex: none; box-shadow: 0 0 0 1px var(--line); }
.room .full { font: var(--type-note); color: var(--muted); min-width: 64px; text-align: center; }
.room.later { display: none; }
#rooms.all .room.later { display: list-item; }
#rooms.all .rooms-all { display: none; }
.rooms-more { font: var(--type-note); color: var(--muted); }
/* A room's seats: a carved notch for each place (up to 16), filled in for each player. */
.seats { display: flex; gap: 3px; min-width: 0; }
.seats i { flex: 0 1 7px; min-width: 3px; height: 18px; background: var(--well); box-shadow: var(--well-shade); }
.seats i.on { background: var(--meter-fill); }
/* Just back from a match: the room list waits a moment for a copy without the player in it. */
.just-left #rooms-list, .just-left #playing-now { visibility: hidden; }
${DEVELOPER_LINK_STYLES}
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
.game-bar-players { position: relative; display: inline-flex; }
.game-bar-count { position: absolute; z-index: 3; top: -4px; right: -4px; pointer-events: none; min-width: 18px; padding: 0 var(--gap-words-words); font: var(--type-tag); line-height: 18px; text-align: center; color: var(--ink); background: var(--slab); box-shadow: var(--slab-shade); }
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
/* The menu's save line: green when progress is reaching the account, amber when it isn't. */
.save-line::before { content: ""; display: inline-block; width: 7px; height: 7px; margin-right: var(--gap-words-words); background: var(--meter-near); }
.save-line.ok::before { background: var(--online); }
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
@media (max-width: 1100px) { .game { grid-template-columns: 340px minmax(0, 1fr); } .game-head h1 { font: var(--type-heading); } }
@media (max-width: 760px) {
  .game { display: block; padding: 0 var(--gap-control-stack); }
  .game-window { height: max(200px, calc(100svh - var(--header-room) - 480px)); }
  .game-pane { position: relative; top: auto; }
  .game-sections { margin-top: 0; }
  .room .fill { display: none; }
  .code-join > .cut-field { width: auto; flex: 1; }
}
@media (prefers-reduced-motion: reduce) { body.playing > .game, body.playing > .backdrop { transition: none; } #conn.retrying .face > .ico { animation: none; } }
`);
