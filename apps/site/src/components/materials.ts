import { row, stack, stackOfOne } from "./layout.ts";
import { primaryButton, secondaryButton } from "./actions.ts";
import { html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { CUT_LINE, glassPane } from "./foundations.ts";

/*
 * The materials (docs/DESIGN.md, Materials): everything in the gallery is built of these, and nothing else paints, shades, rims or pads
 * itself. Each is defined here once, with its look, its edge, its thickness, the room it keeps inside it and its sizes, so changing one
 * changes it everywhere it's used. A component only puts them together and lays them out (layout.ts); design.test.ts fails a component
 * that gives itself a background, a shadow, a backdrop, a border or padding of its own.
 *
 *   - Glass pane (foundations.ts's glassPane, the header, bars, banners): flush glass of the regular thickness.
 *   - Tray (foundations.ts's tray): the thinnest glass, under the pane whose words it belongs to.
 *   - Floating pane (foundations.ts's floatingPane), a sheet, a notice, a playing card: thin glass, over what's under it, blurred.
 *   - Carving: the glass cut away, for what's held in it (a well, a field, a slot) and, deep, a groove.
 *   - Slab: a raised piece of the same glass, for what's pressed or moved (a button, a switch's tab, a thumb); lit, the orange one.
 *
 * Each comes regular or compact (a menu, a small button, a compact sheet): compact keeps less room inside it, the same look.
 */
export const MATERIAL_STYLES = `
/* The tint: a game's hue (--glass-hue, set on what holds the glass) reaches every material, each at its own strength: a pane and a slab
   as much as glass takes it, a carving half as much, so everything over a game reads as one tinted glass. */
.carving, .slab { --carving-wash: color-mix(in srgb, var(--glass-hue) calc(var(--glass-hue-strength) / 2), transparent); --slab-wash: color-mix(in srgb, var(--glass-hue) var(--glass-hue-strength), transparent); }
/* Thickness: one per material, wherever it's used (the tokens --glass-tray, -thin, -regular and -thick). Every glass is regular unless its
   material is another: what floats over the page (a floating pane, a sheet, a notice, a playing card) is thin, since the page under it is
   blurred; thick is there to try. */
.glass.thick { --glass-tint: var(--glass-thick); }
.glass.thin, .floating-pane, .sheet, .notice, .playing-card { --glass-tint: var(--glass-thin); }

/* Glass on glass: a browser blurs only what's inside the nearest blurred glass round it, so a second blur inside a pane would see nothing of
   the page and turn the inner glass flat white. Glass inside glass only tints: the pane round it has already blurred the page, which shows
   through both, as through two real sheets, and it costs one blur less. A floating pane, sheet or notice open over the page (the top layer)
   blurs the page itself; so does glass laid straight over a world of its own (a game's backdrop beside it, as the gallery's samples are),
   and the gallery's strips of shapes blur the shapes they hold, to show what glass does. */
.glass .glass:not(:popover-open, :modal, .glass-strip .glass, :has(> .backdrop) > .glass)::before { -webkit-backdrop-filter: none; backdrop-filter: none; }
/* Caps and scrolls: past its cap, what's in a material scrolls inside it (the part marked scrolls), on Zaisma's rail (RAIL_SCRIPT finds it)
   with fades at its ends, its head and foot staying put and the material itself still. Each caps at its own: a glass pane at what holds
   it, a sheet at the screen, a floating pane at a menu's height or the room in the window, a carving at its owner's cap (--well-height, a
   menu's height unless its owner says). Across, the rail runs under it (data-side-rail). A slab never scrolls. */
/* Only while it has something to scroll (is-scrollable) does it keep a swipe or a wheel to itself, so one that can't scroll never catches them. */
.scrolls { position: relative; min-height: 0; overflow: hidden auto; }
.scrolls.is-scrollable { overscroll-behavior-y: contain; }
/* What's in it fits (MATERIAL_SCRIPT): it clips nothing, so a slab's shadow or glow near its edge falls past it. Only while it scrolls is it cut. */
.scrolls.fits { overflow: visible; }
.scrolls.own-scroll.shows-rail { padding-inline-end: calc(var(--scroll-inset, 0px) + 16px); }
.scrolls.across { min-height: auto; overflow: auto hidden; overscroll-behavior-x: contain; scrollbar-width: none; }
.scrolls.across::-webkit-scrollbar { display: none; }
.glass-pane > .scrolls { --scroll-inset: var(--pad-frame); }
.carving:has(> .scrolls:not(.across)) { align-items: stretch; max-height: var(--well-height, var(--size-menu-height)); }
.floating-pane { max-height: min(var(--size-menu-height), var(--floating-room, calc(100dvh - 2 * var(--pad-frame)))); padding: var(--pad-frame-compact); --pad-words: calc(var(--pad-tray) - var(--pad-frame-compact)); }
/* Holding edged parts beside words (a color picker, wheels), it keeps the regular frame gap and a field's words margin. */
.floating-pane.regular { padding: var(--pad-frame); --pad-words: var(--pad-inside-words); }
/* Its glass is a layer of its own (.glass::before), so the browser's own face and scroll for a popover or a dialog never apply: the face would show square
   behind its cut corners, and a scroll (or a clip) on the pane itself leaves its glass nothing to blur but what's in it, so what's behind
   shows through sharp. Its inside scrolls (Caps and scrolls). */
.glass:is([popover], dialog) { background: none; overflow: visible; }
/* Pinned glass: a bar or a sidebar that stays put as the page moves under it. A browser blurs nothing behind the layer under what's on such
   glass, so the glass blurs its own box instead, cut to its shape; what stands on it is cut at its edge too. */
.glass.pinned { clip-path: var(--glass-clip, none); -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate)); backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate)); }
.glass.pinned::before { -webkit-backdrop-filter: none; backdrop-filter: none; }
/* A carving with a control at its end (a well's Copy): what's in it stops short of the control. */
.carving:has(> .carving-end) > .carving-words { padding-inline-end: calc(var(--control-height-small) + var(--well-inset, 8px) + var(--gap-words-words)); }
/* Over everything (a sheet, a light box, a store panel): a pane of thin glass over the page, capped at the screen, with the page dimmed
   behind it: a task's dim, a little for one hanging from its button, deep for one thing large, whose words turn light; a store panel and a
   buy sheet over a running game dim nothing. Past its cap what's in it scrolls, its head and buttons staying put. */
.sheet { max-height: calc(100dvh - 2 * var(--pad-pane)); }
.sheet::backdrop { background: var(--dim); }
.sheet.is-anchored:not(.in-place) { max-height: var(--sheet-max-height); }
.sheet.is-anchored:not(.in-place)::backdrop { background: var(--dim-light); }
.sheet.light-box::before { display: none; }
.sheet.light-box:not(.in-place) { height: 100%; padding: var(--pad-pane); --ink: var(--ink-on-dim); --ink-2: var(--ink-2-on-dim); }
.sheet.light-box::backdrop { background: var(--dim-deep); }
.sheet.placement-side:not(.in-place) { height: calc(100dvh - 2 * var(--pad-pane)); }
.sheet.placement-side:not(.in-place) > .sheet-in, .light-box-in { height: 100%; }
@media (max-width: 760px) { .sheet:not(.in-place) { max-height: 78dvh; } }
/* A scroller that runs to its material's edge keeps what's in it at the frame gap, its rail outside it. */
.scrolls.to-edge { margin-inline: calc(-1 * var(--pad-frame)); padding-inline: var(--pad-frame); --scroll-inset: var(--pad-frame); }
.sheet > .sheet-in.scrolls { max-height: inherit; --scroll-inset: var(--pad-frame); }

/* A flush row: words (an icon, a count) flush with the glass they're on, a control's height to press (compact: a small one's; on a touch
   screen a regular one's), its words the margin in (--pad-words: a pane's, a compact pane's), cut by the edge rule. Pointed at, it takes a
   faint wash of the words' own color; the current one is a slab; keyboard focus is the cut stroke. A quiet one (a fold's head) only darkens
   its words: it opens what's under it rather than taking you somewhere. A menu's choices, a fold's head and a list's rows are flush rows. */
.flush-row { position: relative; display: flex; align-items: center; gap: var(--gap-words-words); min-height: var(--row-height, var(--control-height-regular));
  padding: var(--row-block, var(--gap-words-control)) var(--row-end, var(--pad-words)) var(--row-block, var(--gap-words-control)) var(--row-start, var(--pad-words)); margin: 0; border: 0; font: var(--type-words); color: var(--ink-2); text-align: start; text-decoration: none; cursor: pointer;
  --face-color: transparent; background: var(--face-color); clip-path: var(--cut-shape); transition: --face-color var(--motion-state), color var(--motion-state); -webkit-tap-highlight-color: transparent; }
.flush-row.compact { --row-height: var(--control-height-small); padding-block: var(--pad-frame-compact); }
@media (pointer: coarse) { .flush-row.compact { --row-height: var(--control-height-regular); } }
/* The face of a button (a tertiary button): its button's height, its words a field's inset in wherever it is, its states its button's. */
.shell > .flush-row { --row-height: var(--control-height); padding: 0 var(--pad-inside-words); }
:is(.shell:hover, .shell.is-pointed, .shell:focus-visible, .shell.is-focused) > .flush-row:not(.quiet) { --face-color: var(--wash); color: var(--ink); }
/* Pressed outranks pointed: a press is always under the pointer too. */
:is(.shell:active, .shell.is-pressed) > .flush-row:not(.quiet), .flush-row:not(.quiet):is(:active, .is-pressed) { --face-color: var(--wash-press); color: var(--ink); box-shadow: var(--press-shade); transition-duration: var(--motion-press); }
/* Press spring-back, as on a slab: what's on it sinks a hair as it's pressed and springs back when let go. */
.flush-row > :where(:not(.cut-line)) { transition: transform var(--motion-glide) var(--ease-spring); }
:is(.shell:active, .shell.is-pressed) > .flush-row > :where(:not(.cut-line)), .flush-row:not(.quiet):is(:active, .is-pressed) > :where(:not(.cut-line)) { transform: translateY(1px); transition-duration: var(--motion-press); }
:is(.shell:focus-visible, .shell.is-focused) > .flush-row > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
/* What's in it sits over its face; zero specificity, so a part placed by its owner (a tertiary button's line) keeps its place. */
.flush-row > :where(:not(.cut-line)) { position: relative; z-index: 2; }
.flush-row:not(.quiet):is(:hover, .is-pointed, :focus-visible, .is-focused) { --face-color: var(--wash); color: var(--ink); }
.flush-row.quiet:is(:hover, .is-pointed) { color: var(--ink); }
/* Lit at its start (lights-start, a sidebar's place you're on): orange light inside the slab along its start edge, as a picked card's. */
.flush-row.lights-start[aria-current="page"]::after { content: ""; position: absolute; z-index: 1; inset: 0 auto 0 0; width: 18px; pointer-events: none; background: linear-gradient(to right, var(--run) 0, var(--run) 2.5px, var(--run-flood) 3.5px, transparent 100%); clip-path: var(--cut-shape); }
.flush-row:is([aria-current="page"], [aria-pressed="true"]) { color: var(--ink); background: var(--slab-sheen), linear-gradient(var(--slab-wash), var(--slab-wash)), var(--slab-face); box-shadow: var(--slab-shade); }
.flush-row { --slab-wash: color-mix(in srgb, var(--glass-hue) var(--glass-hue-strength), transparent); }
.flush-row:focus-visible { outline: none; }
.flush-row:is(:focus-visible, .is-focused) > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }

/* A hairline: the one line drawn on glass, between things (a menu's head and its choices, rows one under another, or either side of a word). */
hr.hairline { border: 0; border-top: var(--divider); margin: var(--gap-control-stack) 0; }
.hairline-below { border-bottom: var(--divider); }
.hairlines > * + * { border-top: var(--divider); }
/* A table's rows draw no line of their own, so the line between them is on their cells; the row you point at takes the rows' wash. */
.hairlines > tr + tr > * { border-top: var(--divider); }
tbody.hairlines > tr:hover > td:not(.table-placeholder) { background: var(--row-hover); }
tbody.hairlines > tr:hover > th { --glass-layer: linear-gradient(var(--row-hover), var(--row-hover)); }
/* Things a block apart (posts), the line in the middle of the gap between them. */
.hairlines.roomy > * + * { padding-top: var(--gap-block-block); }
/* What follows something else, a line and a part's gap over it (a game's facts under its name). */
* + .hairline-above { padding-top: var(--gap-words-words); border-top: var(--divider); }
span.hairline { flex: 1; border-top: var(--divider); }

/* Words on the glass keep its margin (--pad-words), however they sit; beside controls, they line up with the controls' center line. */
.words-margin { padding-inline: var(--pad-words); }
/* Words with a control on one side keep the margin only at the pane's edge: at their start (a toggle's words, before its slot), or their end
   (a check's words, after its box; a slider's number). */
.words-margin.at-start { padding-inline: var(--pad-words) 0; }
.words-margin.at-end { padding-inline: 0 var(--pad-words); }
/* Words at a floating pane's top (a menu's head) keep the margin there too. */
.words-margin.at-top { padding-block-start: var(--pad-words); }
.words-margin.beside-controls { padding-block: calc((var(--control-height-regular) - 1lh) / 2); }
.words-margin.beside-controls.compact { padding-block: calc((var(--control-height-small) - 1lh) / 2); }
/* With nothing beside them, they keep the margin all round. */
.words-margin.round { padding-block: var(--pad-words); }
/* Words that end in an ellipsis on one line rather than wrapping (a game's title under its cover, a menu's choice). */
.one-line { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* A carving that holds art (a game's cover, a store item's picture): the art fills it to its carved rim (2px), cut by the edge rule, and
   Zaisma's mark sits in the carving under it until the art has loaded, and stays where there's none. */
.carving.holds-art { overflow: hidden; background: var(--well-mark) var(--mark-at, center) / auto 50% no-repeat, linear-gradient(var(--carving-wash), var(--carving-wash)), var(--face-color); }
.carving-art { position: absolute; inset: 2px; display: block; overflow: hidden; clip-path: var(--cut-shape); }
.carving-art img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }

/* A bar (the header, the gallery's bar, the footer): a strip of the same glass, as tall as what's in it and the frame gap round it, the same
   on every side, so its controls sit as far from its top and foot as from its ends; compact, the compact frame gap. */
.glass-bar { padding: var(--pad-frame); --pad-words: var(--pad-inside-words); }
.glass-bar.compact { padding: var(--pad-frame-compact); }
/* A bar against the screen's own edge (the playing bar, over a game) keeps clear of a phone's notch at its top, or at its start when it
   runs down the screen's side. */
.glass-bar.at-screen-edge { padding-top: max(var(--pad-frame), env(safe-area-inset-top, 0px)); padding-left: max(var(--pad-frame), env(safe-area-inset-left, 0px)); }
/* A compact pane keeps edged things at the compact frame gap and its words at the tray's margin. */
.glass-pane.compact > .pane-in { padding: var(--pad-frame-compact); --pad-words: calc(var(--pad-tray) - var(--pad-frame-compact)); }
/* Holding a list of rows (a sidebar's places), its first and last rows' words would crowd its cut corners at the frame gap, so the list
   starts and ends at the tray's margin, its sides still at the frame gap: words keep the words margin from the cut too. */
.glass-pane.compact > .pane-in.holds-rows { padding-block: var(--pad-tray); }

/* A tag: the carving's smallest form, slanted at both ends, in --type-tag, carved into the glass it's on: shaded along its top, lit along its foot. Its tone says what it is:
   new or live (green), a count or plain words (the glass's own carving), a warning (amber), or glass (a sliver of the menus' glass, floating over the page). */
/* Its words and icon sit in its box's middle: Jost's capitals and figures fill its line evenly at a tag's size, so lifting them made them
   sit high, an icon beside them higher still. */
.tag { display: inline-flex; align-items: center; justify-content: center; height: 22px; min-width: 22px; padding: 0 10px 0 9px; flex: none; white-space: nowrap;
  font: var(--type-tag); clip-path: polygon(5px 0, 100% 0, calc(100% - 5px) 100%, 0 100%); }
.tag.new, .tag.count, .tag.plain, .tag.warning { box-shadow: var(--tag-carve); }
.tag.new { color: var(--tag-new-ink); background: var(--tag-new); }
.tag.count { padding: 0 8px; color: var(--ink-2); background: var(--tag-plain); font-variant-numeric: tabular-nums; }
.tag.plain { color: var(--ink-2); background: var(--tag-plain); }
.tag.warning { color: var(--tag-warning-ink); background: var(--tag-warning); }

/* A carving: the glass cut away, cut by the edge rule, its face a touch darker than the glass round it and shaded under its top edge; its
   edge lit along its foot and shaded along its top (the edge rule's bands, turned round from a slab's). What has words in it keeps them a
   field's inset from its edge. Pointed at, where it's something you use (a field), it catches the light. Deep, it's a groove or a slot. */
.carving { position: relative; --face-color: var(--carving-face); background: linear-gradient(var(--carving-wash), var(--carving-wash)), var(--face-color); box-shadow: var(--carving-shade); clip-path: var(--cut-shape);
  --pad-words: var(--pad-inside-words); transition: --face-color var(--motion-state); }
.carving.compact { --pad-words: calc(var(--pad-inside-words) - 4px); }
.carving > .cut-line { --band-top: var(--carve-top); --band-left: var(--carve-left); --band-right: var(--carve-right); --band-bottom: var(--carve-bottom); }
.carving > .cut-line polygon { stroke: var(--carve-rim); stroke-width: 2; }
:is(label, a, button, .shell):hover > .carving.is-used, .carving.is-used:hover, .carving.is-pointed { --face-color: var(--carving-face-pointed); }
.carving.deep { --face-color: var(--carving-deep-face); box-shadow: var(--carving-deep-shade); }
/* A deep carving that holds only light is a line: a groove, a step's line. */
.carving.deep.line { display: block; height: 8px; }
.carving:is(.is-focused, :has(:focus-visible)) > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
.carving-words { position: relative; z-index: 2; display: block; padding: 14px var(--pad-words); font: var(--type-words); }
/* A carving you type in or press (a field, a search, a select): a control's height (sized: a field's, unless its owner says), what's typed in
   it or written on it keeping its words inset, past an icon at its start or a control at its end (--text-start, --text-end). With focus, it
   clears (--carving-face-focus). A press carves it a little deeper. */
.carving.sized { height: var(--control-height, var(--control-height-field)); }
.carving > :is(input, textarea, .carving-control) { padding: var(--text-block, 0) var(--text-end, var(--pad-words)) var(--text-block, 0) var(--text-start, var(--pad-words)); background: transparent; border: 0; border-radius: 0; }
.carving.sized > :is(input, .carving-control) { height: 100%; }
/* A drop zone: a carving you drop files onto (a file drop), what's in it a pane's margin in, at least 168px tall so it's a place to aim for. */
.carving.drop-zone { padding: var(--pad-pane); min-height: 168px; }
/* A carving that is itself a button you press (a wheel field's) keeps its words inset the same way. */
.carving.is-button { padding: 0 var(--text-end, var(--pad-words)) 0 var(--text-start, var(--pad-words)); border: 0; }
/* A pointed place in a carving (a wheel's picked row): its face cleared as a pointed field's, its edges raised. */
.carving-pointed { background: var(--carving-face-pointed); clip-path: var(--cut-shape); }
.carving-pointed > .cut-line { --band-top: var(--raise-top); --band-left: var(--raise-left); --band-right: var(--raise-right); --band-bottom: var(--raise-bottom); }
.carving > textarea { --text-block: 14px; }
.carving > textarea.is-scrolling { padding-inline-end: calc(var(--pad-words) + 16px); }
.carving.is-used:is(:focus-visible, :has(:focus-visible), .is-focused) { --face-color: var(--carving-face-focus); }
.carving.is-used:is(:active, .is-pressed):not(:has(input, textarea)) { box-shadow: var(--press-shade); transition-duration: var(--motion-press); }
/* A socket: a small carving a piece seats in (a check field's box), 24px across. Its face is a layer of its own (.socket-face) cut to its
   shape, and its shade lies over whatever is in it, so a piece below the face sits in its shadow. The piece (.socket-piece) is orange, a
   glint ready on it; seated (a checked input in the socket), the shade lifts off it and its edges take the lit slab's light. Pressed, the
   socket deepens. Its ring can sit outside it, unclipped. */
.carving.socket { flex: none; width: 24px; height: 24px; background: none; box-shadow: none; clip-path: none; }
.socket-face { position: absolute; inset: 0; --face-color: var(--carving-face); background: linear-gradient(var(--carving-wash), var(--carving-wash)), var(--face-color); clip-path: var(--cut-shape); }
.socket-face::after { content: ""; position: absolute; inset: 0; z-index: 1; box-shadow: var(--carving-shade); pointer-events: none; transition: box-shadow var(--motion-press), opacity var(--motion-state); }
.socket-piece { position: absolute; inset: 0; display: grid; place-items: center; background: var(--piece-color, var(--run)); color: var(--on-run); overflow: hidden; }
.socket-piece::before { content: ""; position: absolute; inset: 0; background: linear-gradient(115deg, transparent 30%, var(--glint) 50%, transparent 70%); pointer-events: none; }
.carving.socket:has(:checked) > .cut-line { --band-top: rgba(255,240,214,0.85); --band-left: rgba(255,226,180,0.55); --band-right: rgba(150,72,0,0.32); --band-bottom: rgba(130,60,0,0.55); }
:is(label:not(.is-disabled):active, .is-pressed) > .carving.socket > .socket-face::after { box-shadow: var(--press-shade); }
/* A pick: a carving a slab rises in once it's picked (a choice card). Not picked, it's carved; picked (a checked input in it), the slab's
   face comes up over the carving (::before), with orange light inside the glass along the edge that leads (::after, its foot; its owner
   turns it to run down its start). Pressed, it sinks deep, picked or not, quickly, and eases back. Compact, it's flat in the carving that
   holds it, only the picked one a slab. */
.carving.pick { display: flex; align-items: flex-start; gap: var(--gap-words-words); padding: 14px var(--pad-words); --pick-light: var(--run); --pick-flood: var(--run-flood);
  transition: box-shadow var(--motion-state) var(--ease-standard), color var(--motion-state); }
.carving.pick.compact { padding: 10px var(--pad-words); --face-color: transparent; box-shadow: none; }
.carving.pick::before { content: ""; position: absolute; inset: 0; background: var(--slab-sheen), linear-gradient(var(--slab-wash), var(--slab-wash)), var(--slab-face); opacity: 0; pointer-events: none;
  transition: opacity var(--motion-arrive) var(--ease-standard), box-shadow var(--motion-state) var(--ease-standard); }
.carving.pick { --slab-wash: color-mix(in srgb, var(--glass-hue) var(--glass-hue-strength), transparent); }
.carving.pick::after { content: ""; position: absolute; z-index: 2; left: 0; right: 0; bottom: 0; height: 18px; pointer-events: none; opacity: 0; transition: opacity var(--motion-arrive) var(--ease-standard);
  --pick-light-run: to top; background: linear-gradient(var(--pick-light-run), var(--pick-light) 0, var(--pick-light) 2.5px, var(--pick-flood) 3.5px, transparent 100%); }
.carving.pick:has(:checked) { box-shadow: none; }
.carving.pick:has(:checked)::before, .carving.pick:has(:checked)::after { opacity: 1; }
.carving.pick:has(:checked) > .cut-line { --band-top: var(--raise-top); --band-left: var(--raise-left); --band-right: var(--raise-right); --band-bottom: var(--raise-bottom); }
.carving.pick:not(:has(:disabled)):is(:active, .is-pressed) { box-shadow: var(--press-deep); transition-duration: var(--motion-press); }
.carving.pick:not(:has(:disabled)):has(:checked):is(:active, .is-pressed)::before { box-shadow: var(--press-deep); transition-duration: var(--motion-press); }
/* A carving that holds parts close (a compact list of picks, a switch's tabs) keeps them the compact frame gap from its edge: on what's in
   it (holds-parts) or on the box of parts itself (carving-parts). */
.carving.holds-parts > .carving-words, .carving-parts { padding: var(--pad-frame-compact); --scroll-inset: var(--pad-frame-compact); }
/* Its parts stop short of its rail when they scroll, as words do. */
.carving.holds-parts > .carving-words.shows-rail { padding-inline-end: calc(var(--scroll-inset) + 16px); }
/* Slabs side by side in it are a row of controls: their boxes overlap, so the edge rule slants them toward each other (a row's arrows). */
.carving-parts > .cut-btn + .cut-btn { margin-inline-start: var(--gap-control-row-boxes); }
/* A slab layer: a slab whose face is a layer of its own (a switch's sliding slab), cut to its shape under its bevel, so the slab itself
   isn't clipped and the shadow it casts shows. */
.slab-layer { filter: var(--slab-cast); --slab-wash: color-mix(in srgb, var(--glass-hue) var(--glass-hue-strength), transparent); }
.slab-layer::before { content: ""; position: absolute; inset: 0; background: var(--slab-sheen), linear-gradient(var(--slab-wash), var(--slab-wash)), var(--slab-face); clip-path: var(--cut-shape); }
/* A slot: a deep carving a thumb runs along (a toggle's), 56 by 32, shaded deeper than a field; its owner fills it (--face-color). */
.carving.slot { flex: none; width: 56px; height: 32px; --face-color: var(--toggle-off); box-shadow: var(--carving-shade), inset 0 2px 4px rgba(10,16,28,0.18); transition: --face-color var(--motion-arrive); }
/* A thumb: the small solid slab you flip or drag (a toggle's, a slider's), square at its size (--thumb, 24px), white and lit from above on
   either glass so nothing behind it tints it. Its holder (.thumb) casts its shadow onto what it rests on, so the shadow follows its cut;
   pointed, it lifts a touch (its owner says when: --thumb-cast-pointed). Pressed (under a pressed label, its input pressed, or .is-pressed
   on its owner), it's pushed down in place, never smaller: its shadow drawn in close and its face shaded from above. */
.thumb { width: var(--thumb, 24px); height: var(--thumb, 24px); filter: var(--thumb-cast); transition: filter var(--motion-state); }
.thumb-slab { position: relative; display: grid; place-items: center; width: 100%; height: 100%; color: var(--ink-2); background: var(--thumb-face); clip-path: var(--cut-shape); transition: box-shadow var(--motion-state); }
.thumb-slab::after { content: ""; position: absolute; inset: 0; background: var(--thumb-press-face); opacity: 0; transition: opacity var(--motion-state); }
:is(label:not(.is-disabled):active, .is-pressed, .is-held) .thumb, input:active ~ .thumb { filter: var(--thumb-cast-pressed); transition-duration: var(--motion-press); }
:is(label:not(.is-disabled):active, .is-pressed, .is-held) .thumb > .thumb-slab, input:active ~ .thumb > .thumb-slab { box-shadow: var(--thumb-press-shade); }
:is(label:not(.is-disabled):active, .is-pressed, .is-held) .thumb > .thumb-slab::after, input:active ~ .thumb > .thumb-slab::after { opacity: 1; transition-duration: var(--motion-press); }
/* Layered: its face is a layer of its own under what's typed in it, so the words can fade at an end with more past it while the face stays
   whole (a field, a search, a long field). */
.carving.layered { background: none; box-shadow: none; }
.carving.layered::before { content: ""; position: absolute; inset: 0; z-index: 1; pointer-events: none; --face-color: var(--carving-face);
  background: linear-gradient(var(--carving-wash), var(--carving-wash)), var(--face-color); box-shadow: var(--carving-shade); clip-path: var(--cut-shape); transition: --face-color var(--motion-state); }
.carving.layered.is-used:not(:has(:disabled), .is-disabled):hover::before { --face-color: var(--carving-face-pointed); }
.carving.layered.is-used:is(:has(:focus-visible), .is-focused)::before { --face-color: var(--carving-face-focus); }
.carving.compact > .carving-words { padding-block: 8px; }

/* A slab: a raised piece of the same glass, clearer than the pane under it and lit from above (a sheen over its face), its edge lit along
   its top and shaded along its foot, casting its shadow onto the glass round it. Its words keep its own inset; compact keeps less, big more.
   Pointed at, it catches more light; pressed, it sinks into the glass, its light turned round like a carving's. It can't be pressed: carved
   flat into the glass, its words quieter. Lit, it's the orange one: the one thing to do. */
.slab { position: relative; display: flex; align-items: center; justify-content: center; gap: var(--gap-words-words); min-width: 0;
  height: var(--control-height, var(--control-height-regular));
  padding: 0 calc(var(--slab-words, 24px) - var(--slab-shift, 0px)) 0 calc(var(--slab-words, 24px) + var(--slab-shift, 0px));
  --face-color: var(--slab-face); background: var(--slab-sheen), linear-gradient(var(--slab-wash), var(--slab-wash)), var(--face-color); clip-path: var(--cut-shape);
  color: var(--ink); font: 600 0.9375rem var(--display); white-space: nowrap;
  transition: --face-color var(--motion-state), color var(--motion-state), box-shadow var(--motion-state); }
/* Its height is its holder's control height (a button's size, or a row that evens its controls out); compact and big set their room. */
.slab.compact { --slab-words: 14px; }
.slab-holder:has(> .slab.compact) { --control-height: var(--control-height-small); }
.slab-holder:has(> .slab.big) { --control-height: var(--control-height-big); }
.slab .loader { position: relative; z-index: 2; }
.slab.big { --slab-words: 28px; font-size: 1.0625rem; }
/* A deep tint (a delete's red) gives its own edge colors, a lighter and a darker shade of itself (--slab-edge-lit, -lit-soft, -shade-soft,
   -shade) and a deeper press (--slab-press-shade): the light glass's faint grey shading would vanish on it. */
/* Its edge light takes some of its tint (--way, --way-mix: a way in's color, a delete's red), so a tinted slab's lit edge is never a white
   rim round it, yet keeps the light that lands on it: resting, its top and leading edges still catch the highlight that makes it raised;
   pressed, its lit lip takes the whole tint, so a deep tint never shows a light rim along its foot. */
.slab > .cut-line { --band-top: var(--slab-edge-lit, color-mix(in srgb, var(--way, transparent) calc(var(--way-mix, 0%) * 0.4), var(--raise-top)));
  --band-left: var(--slab-edge-lit-soft, color-mix(in srgb, var(--way, transparent) calc(var(--way-mix, 0%) * 0.4), var(--raise-left)));
  --band-right: var(--slab-edge-shade-soft, color-mix(in srgb, var(--way, transparent) calc(var(--way-mix, 0%) * 0.4), var(--raise-right)));
  --band-bottom: var(--slab-edge-shade, color-mix(in srgb, var(--way, transparent) calc(var(--way-mix, 0%) * 0.4), var(--raise-bottom))); }
.slab > :where(:not(.cut-line)) { position: relative; z-index: 2; }
/* Its words end in an ellipsis on one line, never spilling out of it or growing it past its height. */
.slab > :is(span:not([class]), .label-idle, .label-busy) { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.slab-holder { display: inline-flex; max-width: 100%; }
/* Holds art: a slab whose face is a picture (your picture as the account button), square at its control height. Its bevel and focus line are
   drawn over the picture's edge; pointed, the picture catches the light; pressed, it takes the press shade and the slab sinks in place as
   a whole, so no strip of face shows past the picture. */
.slab.holds-art { width: var(--control-height, var(--control-height-regular)); padding: 0; }
.slab.holds-art > .cut-line { z-index: 3; }
.slab.holds-art > :where(:not(.cut-line)) { transition: filter var(--motion-state); }
:is(.shell:hover, .shell.is-pointed, .shell[aria-expanded="true"]) > .slab.holds-art > :where(:not(.cut-line)) { filter: brightness(1.14); }
:is(.shell:active, .shell.is-pressed) > .slab.holds-art > :where(:not(.cut-line)) { filter: brightness(0.9); transform: none; transition-duration: var(--motion-press); }
:is(.shell:active, .shell.is-pressed) > .slab.holds-art { transform: translateY(1px); transition: transform var(--motion-press); }
:where(.shell, .slab-holder):has(> .slab) { filter: var(--slab-cast); transition: filter var(--motion-state); }
:is(.shell:hover, .shell.is-pointed, .shell:focus-visible, .shell.is-focused) > .slab, .slab.is-pointed, .slab.is-focused { --face-color: var(--slab-face-pointed); }
:is(.shell:active, .shell.is-pressed) > .slab, .slab.is-pressed { --face-color: var(--slab-face-pressed); box-shadow: var(--slab-press-shade, var(--press-shade)); transition-duration: var(--motion-press); }
:is(.shell:active, .shell.is-pressed):has(> .slab), .slab-holder:has(> .slab.is-pressed) { filter: none; }
/* Pressed, its edge light turns round as fast as its face sinks, so a bright edge never lingers on a face that's already gone dark. */
:is(.shell:active, .shell.is-pressed) > .slab > .cut-line .cut-band, .slab.is-pressed > .cut-line .cut-band { transition-duration: var(--motion-press); }
/* Press spring-back: what's on a slab goes down with it, a hair, quickly, and springs back up when it's let go. The slab itself never
   moves out of its place. A lit slab floats, so it moves as a whole instead (its button lifts and lands it). */
.slab:not(.lit) > :where(:not(.cut-line)) { transition: transform var(--motion-glide) var(--ease-spring); }
:is(.shell:active, .shell.is-pressed) > .slab:not(.lit) > :where(:not(.cut-line)), .slab.is-pressed:not(.lit) > :where(:not(.cut-line)) { transform: translateY(1px); transition-duration: var(--motion-press); }
:is(.shell:active, .shell.is-pressed) > .slab > .cut-line, .slab.is-pressed > .cut-line { --band-top: var(--slab-edge-shade, color-mix(in srgb, var(--way, transparent) var(--way-mix, 0%), var(--carve-top)));
  --band-left: var(--slab-edge-shade-soft, color-mix(in srgb, var(--way, transparent) var(--way-mix, 0%), var(--carve-left)));
  --band-right: var(--slab-edge-lit-soft, color-mix(in srgb, var(--way, transparent) var(--way-mix, 0%), var(--carve-right)));
  --band-bottom: var(--slab-edge-lit, color-mix(in srgb, var(--way, transparent) var(--way-mix, 0%), var(--carve-bottom))); }
:is(.shell:focus-visible, .shell.is-focused) > .slab > .cut-line polygon, .slab.is-focused > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
:is(.shell:disabled:not([aria-busy="true"]), .shell[aria-disabled="true"]) > .slab, .slab.is-disabled { --face-color: var(--carving-face); background: var(--face-color); box-shadow: var(--carving-shade); color: var(--muted); }
:is(.shell:disabled:not([aria-busy="true"]), .shell[aria-disabled="true"]):has(> .slab), .slab-holder:has(> .slab.is-disabled) { filter: none; }
:is(.shell:disabled:not([aria-busy="true"]), .shell[aria-disabled="true"]) > .slab > .cut-line, .slab.is-disabled > .cut-line { --band-top: var(--carve-top); --band-left: var(--carve-left); --band-right: var(--carve-right); --band-bottom: var(--carve-bottom); }
/* Lit: the orange slab, lit from above and deepening toward its foot, its edge bright along its top and its own orange's shade along its
   foot; on smoked glass it glows onto what's round it, on light glass it casts a shadow (--run-cast). */
/* Its glint runs past its face's box as it sweeps (cut away by its shape); clipped to its box, it never counts as what's in a pane, so a
   pane holding it never scrolls for it. */
.slab.lit { overflow: clip; }
.slab.lit { --face-color: var(--run); background: radial-gradient(130% 110% at 50% -35%, rgba(255,255,255,0.3), rgba(255,255,255,0) 62%), linear-gradient(180deg, var(--run-hi), var(--run) 52%, #E57F0C);
  color: var(--on-run); text-shadow: 0 1px 0 rgba(255,226,180,0.45); font-size: 1rem; letter-spacing: 0.01em; }
.slab.lit > .cut-line, :is(.shell:active, .shell.is-pressed) > .slab.lit > .cut-line, .slab.lit.is-pressed > .cut-line { --band-top: rgba(255,240,214,0.85); --band-left: rgba(255,226,180,0.55); --band-right: rgba(150,72,0,0.32); --band-bottom: rgba(130,60,0,0.55); }
/* A lit slab floats: pressed, it lands flush on the glass, its light kept, never carved in (its button brings it down, RUNNER_SCRIPT). */
:is(.shell:active, .shell.is-pressed) > .slab.lit, .slab.lit.is-pressed { box-shadow: none; }
:where(.shell, .slab-holder):has(> .slab.lit) { filter: var(--run-cast); }
:is(.shell:hover, .shell.is-pointed):has(> .slab.lit), .slab-holder:has(> .slab.lit.is-pointed) { filter: var(--run-cast-up); }
:is(.shell:active, .shell.is-pressed):has(> .slab.lit), .slab-holder:has(> .slab.lit.is-pressed) { filter: var(--run-cast-down); }
/* A lit slab's light: the reflection of the one light, a soft band sliding the opposite way to the pointer (--refl, RUNNER_SCRIPT), and one
   glint sweeping it as the pointer arrives (glint). It can't be pressed: no light at all. */
.slab.lit::before { content: ""; position: absolute; inset: 0; background: linear-gradient(105deg, transparent calc(var(--refl, 50%) - 22%), rgba(255,255,255,0.2) var(--refl, 50%), transparent calc(var(--refl, 50%) + 22%)); opacity: 0; transition: opacity var(--motion-settle); }
:is(.shell.over, .shell.is-pointed) > .slab.lit::before { opacity: 1; }
.slab.lit::after { content: ""; position: absolute; top: -20%; bottom: -20%; width: 36%; left: -50%; background: linear-gradient(100deg, transparent, var(--glint), transparent); transform: skewX(-20deg); pointer-events: none; }
.slab.lit.glint::after { animation: slab-glint var(--motion-glide) var(--ease-glide) both; }
@keyframes slab-glint { from { left: -50%; } to { left: 120%; } }
:is(.shell:disabled:not([aria-busy="true"]), .shell[aria-disabled="true"]) > .slab.lit, .slab.lit.is-disabled { text-shadow: none; }
:is(.shell:disabled:not([aria-busy="true"]), .shell[aria-disabled="true"]) > .slab.lit:is(::before, ::after) { content: none; }
/* A lit slab's front: the orange face it shows below its top as it rises (a toggle on). */
.slab-front { background: linear-gradient(180deg, var(--run-hi), var(--run) 40%, var(--run-lo)); }
@media (prefers-reduced-motion: reduce) { .carving, .slab, .slab > *, .flush-row > * { transition: none; } .slab.lit.glint::after { animation: none; } }
`;

/**
 * Caps and scrolls: a material's part that scrolls is cut at its edge only while what's in it is longer than its cap. Otherwise it fits
 * (fits), clips nothing, and lets the wheel through; it's measured again whenever it or what's in it changes size.
 */
export const MATERIAL_SCRIPT = `/* materials */(function () {
  function fit(box) { box.classList.toggle("fits", box.scrollHeight <= box.clientHeight + 1 && box.scrollWidth <= box.clientWidth + 1); }
  // A floating pane measures its own at once once it's placed and capped, so what's longer than its room never spills for a frame.
  window.zaismaFit = fit;
  // A sheet (any dialog) measures what scrolls in it as it opens, whoever opens it, so a long one scrolls from its first frame too.
  if (window.MutationObserver) new MutationObserver(function (changes) {
    changes.forEach(function (change) { if (change.target.open) change.target.querySelectorAll(".scrolls").forEach(fit); });
  }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["open"] });
  window.zaismaWatch.each(".scrolls", function (box) {
    fit(box);
    window.zaismaWatch.size(box, function () { fit(box); });
    Array.prototype.forEach.call(box.children, function (child) { window.zaismaWatch.size(child, function () { fit(box); }); });
  });
})();
`;

export interface CarvingOptions {
  /** What's held in it: words (in .carving-words, at its inset), or controls laid out by the layout components. */
  body: Raw;
  /** A groove or a slot: darker, lit along its lower lip. */
  isDeep?: boolean;
  isCompact?: boolean;
  /** It's something you use (a field): pointed at, it catches the light. A well only holds things, so it doesn't. */
  isUsed?: boolean;
  /** The gallery's still states. */
  state?: "is-pointed" | "is-focused";
  /** How far the edge rule cuts its corners, in pixels: 10 unless its owner is smaller. */
  cornerCutPx?: number;
  /** Its owner's own classes, for the owner's layout and script: "well". */
  kind?: string;
}

/** A carving: the glass cut away, holding what's put in it. */
export function carving(options: CarvingOptions): Raw {
  const className = ["carving", options.isDeep ? "deep" : "", options.isCompact ? "compact" : "", options.isUsed ? "is-used" : "", options.state ?? "", options.kind ?? ""].filter(Boolean).join(" ");
  return html`<div class="${className}" data-cut-line="${options.cornerCutPx ?? 10}">${CUT_LINE}${options.body}</div>`;
}

export interface SlabOptions {
  /** Its words, an icon, or both. */
  body: Raw;
  /** The orange one: the one thing to do. */
  isLit?: boolean;
  slabSize?: "compact" | "regular" | "big";
  /** The gallery's still states; a real slab takes them from the button it's the face of. */
  state?: "is-pointed" | "is-pressed" | "is-focused" | "is-disabled";
}

/** A slab, on its own: the gallery's look at the material. A button's face is one (actions.ts), its states from the button. */
export function slab(options: SlabOptions): Raw {
  const className = ["slab", options.isLit ? "lit" : "", options.slabSize && options.slabSize !== "regular" ? options.slabSize : "", options.state ?? ""].filter(Boolean).join(" ");
  return html`<span class="slab-holder"><span class="${className}" data-cut-line="12">${CUT_LINE}<span>${options.body}</span></span></span>`;
}

/** The four thicknesses side by side over shapes, so what shows through each tells them apart. */
const thicknessStrip = (theme: "light" | "dark") =>
  html`<div class="glass-strip" data-theme-choice="${theme}"><i></i><i></i><i></i>${([["Tray", "tray", "Under a pane"], ["Thin", "thin", "Floating panes, sheets, notices, playing cards"], ["Regular", "regular", "Every glass pane, the header, banners"], ["Thick", "thick", "To try out"]] as const).map(
    ([name, thickness, use]) => html`<div class="glass" data-glass data-glass-corners="pane" style="--glass-tint:var(--glass-${thickness})"><strong>${name}</strong>${use}</div>`,
  )}</div>`;

/** Play and Details side by side, as a game's pane has them: a lit slab and a slab, sharing the row. */
const PLAY_AND_DETAILS = () => row({ widths: "equal", items: [{ kind: "control", markup: primaryButton("Play", { type: "button" }) }, { kind: "control", markup: secondaryButton("Details", { type: "button" }) }] });

/** Every material over a game's art, tinted with the game's hue, so the tint shows on each: a pane, a carving, a slab and a lit one. */
const tintedSample = (theme: "light" | "dark") =>
  html`<div class="glass-strip" data-theme-choice="${theme}" style="background: center / cover no-repeat url('/design/covers/neon-drift.webp'); --glass-hue: #9B4DFF; padding: var(--gap-block-block)">${glassPane({
    paneWidth: "fit",
    body: stack({ items: [
      { kind: "words", markup: html`<h2>Neon Drift</h2>` },
      { kind: "block", markup: carving({ body: html`<span class="carving-words">zaisma.com/g/neon-drift</span>` }) },
      { kind: "block", markup: PLAY_AND_DETAILS() },
    ] }),
  })}</div>`;

component({
  name: "Thickness",
  slug: "thickness",
  group: "panes",
  subgroup: "materials",
  summary:
    "Glass comes in four thicknesses, and each material is one of them wherever it's used: a tray the thinnest, a floating pane, a sheet, a notice and a playing card thin (what's under them is blurred), every glass pane regular. Thick is there to try. A component never picks its own.",
  // MATERIAL_STYLES come right after the tokens (index.ts's COMPONENT_STYLES), before every component's own.
  styles: "",
  examples: [
    { label: "Light glass", isWide: true, markup: thicknessStrip("light") },
    { label: "Smoked glass", isWide: true, markup: thicknessStrip("dark") },
    { label: "Over a game, light: its hue tints every material, a carving half as much", isWide: true, markup: tintedSample("light") },
    { label: "Over a game, smoked", isWide: true, markup: tintedSample("dark") },
  ],
});

const carvingSample = (markup: Raw) => glassPane({ paneWidth: "fit", body: stackOfOne(html`<div style="width:300px;max-width:100%">${markup}</div>`) });
const carvingWords = (words: string) => html`<span class="carving-words">${words}</span>`;

component({
  name: "Carving",
  slug: "carving",
  group: "panes",
  subgroup: "materials",
  summary:
    "The glass cut away: what holds things (a well, a switch's tabs) and what you put things in (a field), shaded under its top edge and lit along its foot. Deep, it's a groove or a toggle's slot. Every field, well, slot and groove is one; nothing else is carved.",
  styles: "",
  render: carving,
  examples: [
    { label: "Holding words", markup: carvingSample(carving({ body: carvingWords("zaisma.com/g/ashen-crown") })) },
    { label: "Something you use, pointed at", isStill: true, markup: carvingSample(carving({ body: carvingWords("emma_r"), isUsed: true, state: "is-pointed" })) },
    { label: "Keyboard focus", isStill: true, markup: carvingSample(carving({ body: carvingWords("emma_r"), isUsed: true, state: "is-focused" })) },
    { label: "Compact", markup: carvingSample(carving({ body: carvingWords("zaisma.com/g/ashen-crown"), isCompact: true })) },
    // On its own, a card's width, as a Groove sits: in a pane of its own it would squeeze the pane to a sliver.
    { label: "Deep: a groove", markup: html`<div style="width:var(--size-card);max-width:100%">${carving({ body: raw('<span style="display:block;height:8px"></span>'), isDeep: true, cornerCutPx: 3 })}</div>` },
  ],
});

component({
  name: "Slab",
  slug: "slab",
  group: "panes",
  subgroup: "materials",
  summary:
    "A raised piece of the same glass, clearer than the pane under it and casting its shadow on it: what you press or move (a button, a switch's tab, a thumb). Lit, it's the orange one, the one thing to do. Pointed at it catches the light; pressed, it sinks into the glass. Nothing else is raised.",
  styles: "",
  render: slab,
  examples: [
    { label: "Rest", markup: carvingSample(slab({ body: html`Details` })) },
    { label: "Pointed at", isStill: true, markup: carvingSample(slab({ body: html`Details`, state: "is-pointed" })) },
    { label: "Pressed", isStill: true, markup: carvingSample(slab({ body: html`Details`, state: "is-pressed" })) },
    { label: "Keyboard focus", isStill: true, markup: carvingSample(slab({ body: html`Details`, state: "is-focused" })) },
    { label: "Can't be pressed", isStill: true, markup: carvingSample(slab({ body: html`Details`, state: "is-disabled" })) },
    { label: "Compact", markup: carvingSample(slab({ body: html`Details`, slabSize: "compact" })) },
    {
      label: "Over what's behind it: the glass under it shows through, the shapes blurred",
      isWide: true,
      markup: html`<div class="glass-strip"><i></i><i></i><i></i>${glassPane({ paneWidth: "fit", body: stackOfOne(PLAY_AND_DETAILS()) })}</div>`,
    },
    { label: "Lit: the orange one", markup: carvingSample(slab({ body: html`Play`, isLit: true })) },
    { label: "Lit, pointed at", isStill: true, markup: carvingSample(slab({ body: html`Play`, isLit: true, state: "is-pointed" })) },
    { label: "Lit, pressed", isStill: true, markup: carvingSample(slab({ body: html`Play`, isLit: true, state: "is-pressed" })) },
  ],
});

