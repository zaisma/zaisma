import { html, raw, type Raw } from "../html.ts";
import { component } from "./component.ts";

/*
 * The foundations of Zaisma's look: the tokens every component takes its colours from, the glass and its
 * drawn rim, the cut shapes, the motion and the line icons. From the drafts Julius approved (ops
 * docs/drafts/look-and-voice/). "Zaisma is the glass, and the game is not"; orange only on what you act on.
 */

/** The glass's two kinds, as tokens: light glass with dark words, and smoked glass with light words. */
const LIGHT_GLASS = `color-scheme: light;
  --ink: #14171C; --ink-2: #3D444E; --muted: #59606A; --line: rgba(20, 23, 28, 0.14);
  --glass: rgba(255, 255, 255, 0.4); --glass-edge: rgba(255, 255, 255, 0.92); --field: rgba(255, 255, 255, 0.62);
  --glass-tint: rgba(250, 252, 255, 0.5); --glass-top: rgba(250, 252, 255, 0.56); --glass-menu: rgba(250, 252, 255, 0.62);
  --glass-sheen: radial-gradient(140% 90% at 0% 0%, rgba(255, 255, 255, 0.34), rgba(255, 255, 255, 0) 55%), linear-gradient(180deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0) 38%, rgba(30, 60, 110, 0) 70%, rgba(30, 60, 110, 0.05));
  --glass-saturate: 1.8; --edge-hair: rgba(40, 60, 100, 0.1);
  --well: rgba(255, 255, 255, 0.32); --well-shade: inset 0 1px 3px rgba(20, 23, 28, 0.08);
  --slab: linear-gradient(180deg, rgba(255, 255, 255, 0.88), rgba(255, 255, 255, 0.6)); --slab-shade: 0 4px 10px rgba(20, 23, 28, 0.12); --ghost: rgba(255, 255, 255, 0.45); --ghost-rest: rgba(255, 255, 255, 0); --wash-rest: rgba(20, 23, 28, 0); --wash: rgba(20, 23, 28, 0.08); --wash-press: rgba(20, 23, 28, 0.14);
  --btn: rgba(255, 255, 255, 0.6); --btn-hover: rgba(255, 255, 255, 0.82); --btn-press: rgba(226, 232, 240, 0.9);
  --press-shade: inset 0 2px 5px rgba(20, 30, 50, 0.16);
  --field-face: rgba(255, 255, 255, 0.5); --field-hover: rgba(255, 255, 255, 0.66); --field-focus: rgba(255, 255, 255, 0.94);
  --field-shade: inset 0 1px 3px rgba(20, 23, 28, 0.1); --field-outline: transparent;
  --show: rgba(255, 255, 255, 0.55); --show-on: #fff;
  --pick: rgba(255, 255, 255, 0.42); --pick-shade: inset 0 1px 3px rgba(20, 23, 28, 0.1), inset 0 0 0 1px rgba(255, 255, 255, 0.5);
  --done: rgba(255, 255, 255, 0.7); --done-line: inset 0 0 0 1px rgba(20, 23, 28, 0.1);
  --glass-btn-face: rgba(255, 255, 255, 0.36); --glass-btn-hover: rgba(255, 255, 255, 0.72); --glass-btn-press: rgba(255, 255, 255, 0.26); --pointer-glow: rgba(255, 255, 255, 1);
  --glass-btn-lift: inset 0 -12px 18px -12px rgba(30, 60, 110, 0.2), inset 0 1px 0 #fff; --glass-btn-hair: rgba(26, 44, 80, 0.1); --glass-btn-hair-rest: rgba(26, 44, 80, 0.12);
  --clear-hover: rgba(255, 255, 255, 0.45); --clear-press: rgba(255, 255, 255, 0.25);
  --chip-face: #DDF2E5; --chip-ink: #136238; --face-ring: rgba(255, 255, 255, 0.85); --presence-ring: #fff;
  --rail-line: rgba(20, 23, 28, 0.2); --rail-thumb: rgba(24, 28, 36, 0.55); --rail-edge: rgba(255, 255, 255, 0.55); --rail-mark: rgba(20, 23, 28, 0.45);
  --edge-inner: rgba(255, 255, 255, 0.9); --edge-bevel: 0.4; --edge-rim: 1; --edge-fringe: 0.25;
  --edge-lit: rgba(236, 240, 246, 1); --edge-shade: rgba(146, 154, 168, 0.6); --edge-corner: rgba(188, 196, 208, 0.75);
  --edge-spec: rgba(255, 255, 255, 1); --edge-dense: rgba(120, 130, 146, 0.03);
  --logo-halo: drop-shadow(0 0 10px rgba(255, 255, 255, 0.6)) drop-shadow(0 1px 1px rgba(255, 255, 255, 0.5));
  --link-hover: var(--run-lo); --marked: var(--run-lo);
  --glass-base: 255, 255, 255; --glass-kind: "Light glass, dark words."; --glass-hue-strength: 14%; --track: rgba(186, 198, 216, 0.28);
  --raise-top: rgba(255, 255, 255, 0.95); --raise-left: rgba(255, 255, 255, 0.6); --raise-right: rgba(96, 108, 128, 0.22); --raise-bottom: rgba(70, 82, 104, 0.34);
  --carve-top: rgba(60, 72, 94, 0.3); --carve-left: rgba(60, 72, 94, 0.2); --carve-right: rgba(255, 255, 255, 0.55); --carve-bottom: rgba(255, 255, 255, 0.9);
  --backdrop-base: #E6ECF4; --backdrop-a: #B9CBE6; --backdrop-b: #C0DCDB; --backdrop-c: #D2CBEA;`;

const SMOKED_GLASS = `color-scheme: dark;
  --ink: #F7F9FC; --ink-2: rgba(247, 249, 252, 0.86); --muted: rgba(247, 249, 252, 0.7); --line: rgba(255, 255, 255, 0.2);
  --glass-edge: rgba(255, 255, 255, 0.16); --field: rgba(255, 255, 255, 0.08);
  --glass-tint: rgba(14, 17, 24, 0.55); --glass-top: rgba(18, 21, 27, 0.5); --glass-menu: rgba(18, 21, 27, 0.62);
  --glass-sheen: radial-gradient(140% 90% at 0% 0%, rgba(190, 215, 255, 0.12), rgba(190, 215, 255, 0) 55%), linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0) 38%, rgba(0, 0, 0, 0) 70%, rgba(0, 0, 0, 0.12));
  --glass-saturate: 1.9; --edge-hair: rgba(0, 0, 0, 0.35);
  --well: rgba(255, 255, 255, 0.08); --well-shade: inset 0 1px 3px rgba(0, 0, 0, 0.3);
  --slab: rgba(255, 255, 255, 0.2); --slab-shade: 0 0 0 transparent; --ghost: rgba(255, 255, 255, 0.1); --ghost-rest: rgba(255, 255, 255, 0); --wash-rest: rgba(255, 255, 255, 0); --wash: rgba(255, 255, 255, 0.14); --wash-press: rgba(255, 255, 255, 0.22);
  --btn: rgba(255, 255, 255, 0.14); --btn-hover: rgba(255, 255, 255, 0.26); --btn-press: rgba(255, 255, 255, 0.07);
  --press-shade: inset 0 2px 5px rgba(0, 0, 0, 0.4);
  --field-face: rgba(255, 255, 255, 0.08); --field-hover: rgba(255, 255, 255, 0.12); --field-focus: rgba(255, 255, 255, 0.16);
  --field-shade: inset 0 1px 3px rgba(0, 0, 0, 0.25); --field-outline: transparent;
  --show: rgba(255, 255, 255, 0.1); --show-on: rgba(255, 255, 255, 0.22);
  --pick: rgba(255, 255, 255, 0.06); --pick-shade: inset 0 1px 3px rgba(0, 0, 0, 0.3), inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  --done: rgba(255, 255, 255, 0.12); --done-line: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  --glass-btn-face: rgba(255, 255, 255, 0.07); --glass-btn-hover: rgba(255, 255, 255, 0.15); --glass-btn-press: rgba(255, 255, 255, 0.04); --pointer-glow: rgba(255, 255, 255, 0.3);
  --glass-btn-lift: inset 0 -12px 18px -12px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.22); --glass-btn-hair: rgba(26, 44, 80, 0.16); --glass-btn-hair-rest: rgba(26, 44, 80, 0.28);
  --clear-hover: rgba(255, 255, 255, 0.08); --clear-press: rgba(255, 255, 255, 0.04);
  --chip-face: rgba(52, 211, 120, 0.22); --chip-ink: #A6F0C6; --face-ring: rgba(6, 8, 12, 0.55); --presence-ring: #1A1D24;
  --rail-line: rgba(255, 255, 255, 0.2); --rail-thumb: rgba(255, 255, 255, 0.55); --rail-edge: rgba(255, 255, 255, 0.35); --rail-mark: rgba(255, 255, 255, 0.5);
  --edge-inner: rgba(255, 255, 255, 0.4); --edge-bevel: 0.4; --edge-rim: 0.85; --edge-fringe: 0.4;
  --edge-lit: rgba(240, 244, 250, 0.95); --edge-shade: rgba(160, 172, 192, 0.4); --edge-corner: rgba(214, 222, 236, 0.6);
  --edge-spec: rgba(255, 255, 255, 0.95); --edge-dense: rgba(255, 255, 255, 0.04);
  --logo-halo: drop-shadow(0 0 12px rgba(4, 7, 14, 0.75)) drop-shadow(0 1px 2px rgba(4, 7, 14, 0.6));
  --link-hover: var(--run-hi); --marked: var(--run-hi);
  --glass-base: 14, 17, 24; --glass-kind: "Smoked glass, light words."; --glass-hue-strength: 22%; --track: rgba(255, 255, 255, 0.08);
  --raise-top: rgba(255, 255, 255, 0.42); --raise-left: rgba(255, 255, 255, 0.22); --raise-right: rgba(0, 0, 0, 0.3); --raise-bottom: rgba(0, 0, 0, 0.5);
  --carve-top: rgba(0, 0, 0, 0.5); --carve-left: rgba(0, 0, 0, 0.32); --carve-right: rgba(255, 255, 255, 0.1); --carve-bottom: rgba(255, 255, 255, 0.2);
  --backdrop-base: #0A0D13; --backdrop-a: #1C2C49; --backdrop-b: #0E2E34; --backdrop-c: #241E3F;`;

/**
 * The tokens. Light or dark follows the system unless a choice is fixed with data-theme-choice, on <html>
 * or on any element (the gallery's stage fixes it for what's inside). Dark is smoked glass over a night-dark
 * page. Smoked glass on its own is the class smoke on any ancestor: a dark game's background smokes the
 * glass over it whatever the theme, since the theme changes only Zaisma's own backgrounds.
 */
export const TOKEN_STYLES = `
@font-face { font-family: Jost; src: url(/fonts/jost.woff2) format("woff2"); font-weight: 100 900; font-display: swap; }
@property --refl { syntax: "<percentage>"; inherits: false; initial-value: 50%; }
@property --tint-colour { syntax: "<color>"; inherits: false; initial-value: transparent; }
@property --tint-pct { syntax: "<percentage>"; inherits: false; initial-value: 0%; }
/* Registered, so a change of hue eases over half a second, like a change of theme, instead of cutting. */
@property --glass-hue { syntax: "<color>"; inherits: true; initial-value: transparent; }
/* The tint a piece of glass shows right now, faded towards its --glass-tint. A registered colour fades in the page itself, so the browser
   never lifts the glass onto a layer of its own for the fade and drops it at the end, which flashed blurred glass as a fade finished. */
@property --glass-shown-tint { syntax: "<color>"; inherits: false; initial-value: transparent; }
/* A control's face colour, the same way: every control that changes colour (a hover, a press, light to dark) sets --face-colour and
   fades it, never its background, so no control flashes as a fade ends. design.test.ts checks that nothing fades a background. */
@property --face-colour { syntax: "<color>"; inherits: false; initial-value: transparent; }
/* Scroll fades (navigation.ts's SCROLL_FADE_SCRIPT): a box that scrolls fades its words over an edge while there's more that way, easing in and out. */
@property --fade-top { syntax: "<length>"; inherits: false; initial-value: 0px; }
@property --fade-bottom { syntax: "<length>"; inherits: false; initial-value: 0px; }
.scroll-fades.is-fading { -webkit-mask-image: linear-gradient(to bottom, transparent, #000 var(--fade-top), #000 calc(100% - var(--fade-bottom)), transparent);
  mask-image: linear-gradient(to bottom, transparent, #000 var(--fade-top), #000 calc(100% - var(--fade-bottom)), transparent); transition: --fade-top 0.2s, --fade-bottom 0.2s; }
/* A row that scrolls sideways (data-fades-sideways: a header's tabs, the gallery's groups on a phone) fades out over a side with more past it,
   easing in and out, with no scrollbar; it starts scrolled to the one you're on. */
@property --fade-left { syntax: "<length>"; inherits: false; initial-value: 0px; }
@property --fade-right { syntax: "<length>"; inherits: false; initial-value: 0px; }
/* A box that scrolls keeps a swipe to itself: reaching its end never carries on into the page, so the page never nudges under it. */
.scroll-fades, [data-scroll-box] { overscroll-behavior: contain; }
[data-fades-sideways] { overscroll-behavior-x: contain; overflow-x: auto; scrollbar-width: none; transition: --fade-left 0.25s, --fade-right 0.25s; }
[data-fades-sideways]::-webkit-scrollbar { display: none; }
[data-fades-sideways].more-left, [data-fades-sideways].more-right {
  -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 var(--fade-left), #000 calc(100% - var(--fade-right)), transparent 100%);
  mask-image: linear-gradient(90deg, transparent 0, #000 var(--fade-left), #000 calc(100% - var(--fade-right)), transparent 100%); }
/* How far in it fades: 28px, or a row's own --fade-sideways-px (a row of covers fades further). */
[data-fades-sideways].more-left { --fade-left: var(--fade-sideways-px, 28px); }
[data-fades-sideways].more-right { --fade-right: var(--fade-sideways-px, 28px); }
.eases-settings { transition: --glass-hue 0.5s ease; }
@media (prefers-reduced-motion: reduce) { .eases-settings { transition: none; } }
/* Moving between Zaisma's pages crossfades, so a page change never flashes. */
@media (prefers-reduced-motion: no-preference) { @view-transition { navigation: auto; } }
:root {
  color-scheme: light dark;
  --run: #F7931A; --run-hi: #FFB24A; --run-lo: #A85A06;
  /* The only red: a delete's confirm step, never anything else. */
  --danger: #D93A2B; --danger-lo: #A82718;
  --page: #EEF2F7;
  --glass-blur: 24px;
  /* How every piece of glass changes (light to dark, a hover's tint): a component that adds its own transitions starts its list with this. */
  --glass-transition: --glass-shown-tint 0.5s ease, color 0.3s ease;
  /* The glass's hue (PageSettings' glass.hueColour): tints every piece of glass under where it's set. Glass tinted for a brand keeps its own colour. */
  --glass-hue: transparent;
  --display: "Jost", Futura, "Century Gothic", "Avenir Next", sans-serif;
  --body: -apple-system, "Segoe UI", system-ui, sans-serif;
  --spring: cubic-bezier(.3, 1.2, .4, 1);
}
:root, [data-theme-choice="light"] { ${LIGHT_GLASS} --page: #EEF2F7; }
@media (prefers-color-scheme: dark) { :root:not([data-theme-choice="light"]) { ${SMOKED_GLASS} --page: #0D1015; } }
[data-theme-choice="dark"] { ${SMOKED_GLASS} --page: #0D1015; }
.smoke { ${SMOKED_GLASS} }
*, *::before, *::after { box-sizing: border-box; }
/* Still under the pointer: what you point at or press never moves; only what's inside it does. A button is a still
   shell (the link or button itself, which takes the pointer) around its face (.face), which lifts, sinks, leans or
   shrinks. If the shell moved, a pointer near its edge would slip off as it moved, the button would move back under
   it, and it would flicker. The face takes no pointer of its own, so the shell's box alone decides what you're over.
   design.test.ts checks every component's CSS for this. */
.shell { position: relative; display: inline-flex; margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-decoration: none; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.shell > .face { pointer-events: none; }
[hidden] { display: none !important; }
/* Places: the sidebar's and a menu's, one look (placeMarkup). Words straight on the glass, quiet until you point at them, when they brighten.
   The place you're on is a raised slab under its words, outlined in orange; keyboard focus draws its outline in ink. Each is a control,
   so its shape is the edge rule's. A badge count sits at its end. */
.place { position: relative; isolation: isolate; display: flex; align-items: center; gap: 10px; width: 100%; height: 40px; padding: 0 14px; margin: 0; border: 0; background: none; cursor: pointer;
  font: 500 16px var(--display); color: var(--muted); text-align: left; text-decoration: none; transition: color 0.15s; }
.place > :not(.cut-line, .place-slab) { position: relative; z-index: 2; }
.place > svg:not(.cut-line) { width: 18px; height: 18px; flex: none; }
.place:hover, .place[aria-current="page"] { color: var(--ink); }
.place[aria-current="page"] { font-weight: 600; }
.place-slab { position: absolute; inset: 0; z-index: -1; pointer-events: none; }
.place-slab::before { content: ""; position: absolute; inset: 0; background: var(--slab); clip-path: var(--cut-shape); }
.place .cut-line polygon { stroke-width: 2; }
.place[aria-current="page"] .cut-line polygon { stroke: var(--run); }
.place:focus-visible { outline: none; }
.place:focus-visible .cut-line polygon { stroke: var(--ink); }
.place[aria-current="page"]:focus-visible .cut-line polygon { stroke: var(--run); stroke-width: 5; }
.place-form { margin: 0; }
.place-count { margin-left: auto; min-width: 22px; padding: 1px 7px; text-align: center; font: 600 12px var(--display); color: var(--ink-2); background: var(--btn);
  clip-path: polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%); }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* The glass: one look for every piece of it, at any size, defined here once. Anything made of glass has the class glass and
   nothing else paints it: it's a tint (--glass-tint, which a component may set to its own, like the header's --glass-top),
   a layer over the tint a component may set (--glass-layer, a glass button's brand colour), the page's hue (--glass-wash),
   the light on it (--glass-sheen: brightest at its top left, a little shade along its foot), the blur and colour of what's
   behind (--glass-blur, --glass-saturate), the way it changes (--glass-transition), and on a slab, cut corners with a drawn
   rim (data-glass: the svg.edge GLASS_SCRIPT draws, sizing its corners and bevel to the slab). design.test.ts checks that
   no other rule paints glass. */
/* Each piece of glass works the hue out from the --glass-hue it inherits, so setting it anywhere tints all the glass inside. */
.glass { --glass-wash: linear-gradient(color-mix(in srgb, var(--glass-hue) var(--glass-hue-strength), transparent), color-mix(in srgb, var(--glass-hue) var(--glass-hue-strength), transparent)); }
.glass { position: relative; color: var(--ink); --glass-shown-tint: var(--glass-tint); background-color: var(--glass-shown-tint); background-image: var(--glass-layer, linear-gradient(transparent, transparent)), var(--glass-wash), var(--glass-sheen);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate)); backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  transition: var(--glass-transition); }
.glass > :not(.edge) { position: relative; z-index: 3; }
.edge { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 2; overflow: visible; }
/* Light and smoked glass share one frame: a straight-cut glass edge whose every side is one flat tone between --edge-lit and --edge-shade
   (lit along the top, shaded along the bottom), so each turn of the cut steps in brightness; brightest at the outer rim, with no separate outline. Like real glass it's denser at
   the edge (--edge-dense), glints where the rim meets the lit corner (--edge-spec), and its inner facet line catches light from the far side (--edge-inner). */
.edge .gleam { stop-color: var(--edge-inner); } .edge .spec { stop-color: var(--edge-spec); }
.edge .dense { fill: var(--edge-dense); }
.edge .facet { stroke: var(--edge-corner); } .edge .facet.lit { stroke: var(--edge-lit); }
.edge .hair { stroke: var(--edge-hair); }
.edge .bevel { opacity: var(--edge-bevel); }
.edge .rim-band { opacity: var(--edge-rim); }
.edge .bevel polygon, .edge .rim-band polygon { fill: color-mix(in srgb, var(--edge-lit) var(--side-light), var(--edge-shade)); }
.edge .rim { stroke: none; }
.edge .fringe { opacity: var(--edge-fringe); }
/* A slanted outline drawn just inside a cut field or button, so its slanted ends are outlined like its top and bottom. */
.cut-line { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1; overflow: visible; }
.cut-line polygon { fill: none; stroke: transparent; stroke-width: 1; transition: stroke 0.3s; }
/* Raised and carved: the light that falls on the panes falls on what's on them. A raised control (a button, the slab under the tab you're on)
   is lit along its top and shaded along its bottom; a carved one (a field, a switch's track) the other way round. Each side is one flat tone,
   so every turn of the cut steps in brightness, like the panes' edges. The outline polygon is left for focus and marks. */
.cut-line .cut-band { fill: transparent; transition: fill 0.15s; }
.cut-raised > .cut-line { --band-top: var(--raise-top); --band-left: var(--raise-left); --band-right: var(--raise-right); --band-bottom: var(--raise-bottom); }
.cut-carved > .cut-line { --band-top: var(--carve-top); --band-left: var(--carve-left); --band-right: var(--carve-right); --band-bottom: var(--carve-bottom); }
/* Orange is always shown in full, so a slab's shade never falls on its orange underline. */
.slab.cut-raised > .cut-line { --band-bottom: transparent; }
.cut-line .cut-band.on-top { fill: var(--band-top, transparent); } .cut-line .cut-band.on-left { fill: var(--band-left, transparent); }
.cut-line .cut-band.on-right { fill: var(--band-right, transparent); } .cut-line .cut-band.on-bottom { fill: var(--band-bottom, transparent); }
/* A nested corner's cut faces two ways, so it takes half of each side's light. */
.cut-line .cut-band.on-top-right { fill: color-mix(in srgb, var(--band-top, transparent), var(--band-right, transparent)); }
.cut-line .cut-band.on-bottom-right { fill: color-mix(in srgb, var(--band-bottom, transparent), var(--band-right, transparent)); }
.cut-line .cut-band.on-bottom-left { fill: color-mix(in srgb, var(--band-bottom, transparent), var(--band-left, transparent)); }
.cut-line .cut-band.on-top-left { fill: color-mix(in srgb, var(--band-top, transparent), var(--band-left, transparent)); }
/* Line icons: drawn with the words' colour. */
.ico { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
`;

const stroke = (viewBox: string, paths: string, extra = "") => `<svg class="ico" viewBox="${viewBox}" aria-hidden="true"${extra}>${paths}</svg>`;

/** Every line icon the drafts use. Each is drawn in the words' colour (.ico). */
export const ICONS = {
  person: stroke("0 0 20 20", '<circle cx="10" cy="6.8" r="3.2"/><path d="M3.8 17.2c0-3.4 2.8-5.9 6.2-5.9s6.2 2.5 6.2 5.9"/>'),
  people: stroke("0 0 16 16", '<circle cx="6" cy="5.2" r="2.4"/><path d="M1.8 13.2c0-2.4 1.9-4.2 4.2-4.2s4.2 1.8 4.2 4.2"/><circle cx="11.6" cy="5.8" r="1.9"/><path d="M10.9 9c2 .2 3.4 1.9 3.4 4"/>', ' stroke-width="1.5"'),
  friends: stroke("0 0 20 20", '<circle cx="6.5" cy="7" r="2.5"/><circle cx="13.5" cy="7" r="2.5"/><path d="M2 16.5c0-2.5 2-4.5 4.5-4.5 1.3 0 2.5.5 3.3 1.4M18 16.5c0-2.5-2-4.5-4.5-4.5-1.3 0-2.5.5-3.3 1.4"/>'),
  clock: stroke("0 0 16 16", '<circle cx="8" cy="8" r="5.8"/><path d="M8 4.8V8l2.2 1.5"/>', ' stroke-width="1.5"'),
  calendar: stroke("0 0 20 20", '<path d="M3.5 5h13v11.5h-13z"/><path d="M3.5 8.6h13M7 3.2v3.4M13 3.2v3.4"/>'),
  lock: stroke("0 0 20 20", '<path d="M4.5 9h11v8.5h-11z"/><path d="M7 9V6.6a3 3 0 0 1 6 0V9"/><path d="M10 12.4v2"/>'),
  mail: stroke("0 0 20 20", '<path d="M3 5h14v10.5H3z"/><path d="M3.4 5.6 10 11l6.6-5.4"/>'),
  gear: stroke(
    "0 0 20 20",
    '<polygon points="15.99,8.40 18.59,8.64 18.59,11.36 15.99,11.60 15.37,13.10 17.04,15.11 15.11,17.04 13.10,15.37 11.60,15.99 11.36,18.59 8.64,18.59 8.40,15.99 6.90,15.37 4.89,17.04 2.96,15.11 4.63,13.10 4.01,11.60 1.41,11.36 1.41,8.64 4.01,8.40 4.63,6.90 2.96,4.89 4.89,2.96 6.90,4.63 8.40,4.01 8.64,1.41 11.36,1.41 11.60,4.01 13.10,4.63 15.11,2.96 17.04,4.89 15.37,6.90"/><polygon points="12.68,11.11 11.11,12.68 8.89,12.68 7.32,11.11 7.32,8.89 8.89,7.32 11.11,7.32 12.68,8.89"/>',
    ' stroke-width="1.4"',
  ),
  code: stroke("0 0 20 20", '<path d="M7 5.5L2.5 10 7 14.5M13 5.5l4.5 4.5-4.5 4.5"/>'),
  "sign-out": stroke("0 0 20 20", '<path d="M12 4H5v12h7M9 10h8M14 7l3 3-3 3"/>'),
  search: stroke("0 0 20 20", '<circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l4.5 4.5"/>', ' stroke-width="1.8"'),
  eye: stroke("0 0 20 20", '<path d="M1.8 10S5 4.5 10 4.5 18.2 10 18.2 10 15 15.5 10 15.5 1.8 10 1.8 10z"/><circle cx="10" cy="10" r="2.6"/>'),
  "chevron-down": stroke("0 0 20 12", '<path d="M2 2l8 8 8-8"/>', ' stroke-width="2.2"'),
  "chevron-right": stroke("0 0 12 20", '<path d="M2 2l8 8-8 8"/>', ' stroke-width="2.4"'),
  play: '<svg class="play" viewBox="0 0 16 18" width="14" height="16" aria-hidden="true"><path d="M2 1.5l12 7.5-12 7.5z" fill="currentColor"/></svg>',
} as const;
export type IconName = keyof typeof ICONS;
export const icon = (name: IconName): Raw => raw(ICONS[name]);

export const MINUTE_MS = 60_000;

/** "12 min ago", "3 h ago", "yesterday", "5 days ago": the home draft's way of saying when. */
export function ago(durationMs: number): string {
  const minuteCount = Math.max(1, Math.round(durationMs / MINUTE_MS));
  if (minuteCount < 60) return `${minuteCount} min ago`;
  if (minuteCount < 1440) return `${Math.round(minuteCount / 60)} h ago`;
  const dayCount = Math.round(minuteCount / 1440);
  return dayCount === 1 ? "yesterday" : `${dayCount} days ago`;
}

/** Zaisma's wordmark and mark, drawn in the words' colour (brand/zaisma-wordmark-black.svg, brand/zaisma-mark-black.svg). */
const MARK_PATHS = '<path d="M1884.08,3033.91c767.645,0 1535.29,0 2302.930,0c33.233,248.238 66.466,496.475 99.699,744.712l-4286.71,-0c627.367,-243.599 1255.990,-491.890 1884.080,-744.712Z"/><path d="M415.598,3484.54c777.297,-719.363 1475.76,-1400.24 2108.05,-2044.32c404.715,-158.588 821.55,-323.759 1248.51,-495.17c-547.607,610.584 -1151.51,1254.04 -1823.08,1932.14c-520.17,209.105 -1032.22,411.7 -1533.48,607.345Z"/><path d="M2575.7,1305.06l-1740.58,0c21.608,-194.559 43.215,-389.119 64.823,-583.678l3147.9,0c-485.752,195.366 -976.426,389.899 -1472.14,583.678Z"/>';
export const WORDMARK = raw(
  `<svg viewBox="-120 1080 9988 2820" role="img" aria-label="Zaisma"><g fill="currentColor"><g transform="translate(0 3779) scale(0.62132) translate(0 -3779)">${MARK_PATHS}</g><g transform="translate(-1953 0)"><path d="M4957,1879 L5877,1879 L6132,3779 L5212,3779 L4837,3449 L4765,2909 L5051,2579 L5601,2579 L5557,2249 L4677,2249 Z M5140,2949 L5650,2949 L5712,3409 L5202,3409 Z" fill-rule="evenodd"/><path d="M6077,1879 L6447,1879 L6702,3779 L6332,3779 Z M5991,1239 L6541,1239 L6412,1619 L6042,1619 Z" fill-rule="evenodd"/><path d="M6647,1879 L7847,1879 L7667,2249 L7067,2249 L7120,2644 L7950,2644 L8102,3779 L6902,3779 L7082,3409 L7682,3409 L7629,3014 L6799,3014 Z" fill-rule="evenodd"/><path d="M8091,2209 L8377,1879 L9997,1879 L10252,3779 L9882,3779 L9677,2249 L9257,2249 L9462,3779 L9092,3779 L8887,2249 L8467,2249 L8672,3779 L8302,3779 Z" fill-rule="evenodd"/><path d="M10527,1879 L11447,1879 L11702,3779 L10782,3779 L10407,3449 L10335,2909 L10621,2579 L11171,2579 L11127,2249 L10247,2249 Z M10710,2949 L11220,2949 L11282,3409 L10772,3409 Z" fill-rule="evenodd"/></g></g></svg>`,
);
export const MARK = raw(`<svg viewBox="-120 600 4527 3300" aria-hidden="true"><g fill="currentColor">${MARK_PATHS}</g></svg>`);

/** Zaisma's own scrollbar (navigation.ts's rail, RAIL_SCRIPT): "box" for a box that scrolls (it goes just after it), "page" for the page. */
export const railMarkup = (scrollKind: "box" | "page"): Raw => raw(`<div class="rail" data-rail="${scrollKind}" aria-hidden="true"><div class="rail-line"></div><div class="rail-thumb glass"></div></div>`);

/** A place in a sidebar or a menu: a link, or a button that posts a form (like Sign out). */
export interface PlaceItem {
  label: string;
  href?: string;
  /** Where a button posts, in place of a link. */
  action?: string;
  /** The page you're on: the raised slab with the orange outline. */
  isCurrent?: boolean;
  /** Before the label; the only thing a collapsed sidebar shows. */
  icon?: IconName;
  /** A small number at its end, like unread topics. */
  badgeCount?: number;
  /** Attributes of its own, like a data attribute a script reads. */
  extra?: Raw;
}

/** One place, the same in a sidebar and a menu (the .place styles). isMenuItem gives it the menu's role; isCollapsed moves its label to its title. */
export function placeMarkup(place: PlaceItem, options: { isMenuItem?: boolean; isCollapsed?: boolean } = {}): Raw {
  const words = place.icon ? html`${icon(place.icon)}<span class="place-label">${place.label}</span>` : html`<span class="place-label">${place.label}</span>`;
  const shape = place.isCurrent ? raw(' aria-current="page"') : raw(' data-cut-line="8"');
  const role = options.isMenuItem ? raw(' role="menuitem" tabindex="-1"') : "";
  const titled = options.isCollapsed ? html` title="${place.label}" aria-label="${place.label}"` : "";
  const inside = html`${place.isCurrent ? html`<span class="place-slab cut-raised" data-cut-line="8" data-cut-inset="2">${CUT_LINE}</span>` : CUT_LINE}${words}${place.badgeCount ? html`<span class="place-count">${place.badgeCount}</span>` : ""}`;
  return place.action !== undefined
    ? html`<form class="place-form" method="post" action="${place.action}"><button type="submit"${shape}${role}${titled} class="place">${inside}</button></form>`
    : html`<a href="${place.href ?? "#"}"${place.extra ?? ""}${shape}${role}${titled} class="place">${inside}</a>`;
}

/** An outline for a cut field or button (GLASS_SCRIPT draws it), and a slab's drawn rim. */
export const CUT_LINE = raw('<svg class="cut-line" aria-hidden="true"><polygon/></svg>');
export const EDGE = raw('<svg class="edge" aria-hidden="true"></svg>');

/**
 * glass(el, corners) and cutLine(el), from the header draft, as window.zaismaGlass and window.zaismaCutLine.
 * On load, and for elements added later, they're applied to every [data-glass] (corners from data-glass-corners,
 * like "16 6 16 6") and every [data-cut-line] (a control: its slant, where it has one, in its value).
 */
export const GLASS_SCRIPT = `/* glass */(function () {
  var SVG = "http://www.w3.org/2000/svg";
  /* The sign-in pane's glass, for any slab: cut corners and the drawn rim (dark hairline, polished edge, bevel band, faint rainbow fringe, bright cut facets). */
  function cutPoints(w, h, c, inset) {
    var i = inset, k = inset * 0.414;
    return [[i, c[0] + k], [c[0] + k, i], [w - c[1] - k, i], [w - i, c[1] + k], [w - i, h - c[2] - k], [w - c[2] - k, h - i], [c[3] + k, h - i], [i, h - c[3] - k]];
  }
  function pointList(points) { return points.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" "); }
  // How lit each side of the cut is, from the top left corner's cut round to the left side. Neighbours always differ, so every turn of the edge shows as a step in brightness, like a cut facet.
  var SIDE_LIGHT = [80, 100, 70, 28, 12, 0, 40, 62];
  // A control made of glass takes its sides' light from the way each faces (the same steps, round the same way).
  var FACING_LIGHT = { "top-left": 80, top: 100, "top-right": 70, right: 28, "bottom-right": 12, bottom: 0, "bottom-left": 40, left: 62 };
  // One flat quad per side, between two insets of the shape; kept while the number of sides stays, so nothing is rebuilt mid-animation.
  function placeBands(group, quads, outer, inner, lights) {
    while (quads.length < outer.length) { var quad = document.createElementNS(SVG, "polygon"); group.appendChild(quad); quads.push(quad); }
    while (quads.length > outer.length) group.removeChild(quads.pop());
    quads.forEach(function (quad, i) { var j = (i + 1) % outer.length; quad.style.setProperty("--side-light", lights[i] + "%"); quad.setAttribute("points", pointList([outer[i], outer[j], inner[j], inner[i]])); });
  }
  var made = 0;
  // The rim is built once; while the slab changes size only its points move, so nothing is rebuilt mid-animation (rebuilding it each frame made the edges flicker).
  // A pane's cut corners are a clip-path in CSS terms (calc with 100%), so it follows the slab's size by itself and is only set again when the corners change.
  // A control made of glass ([data-cut-line] too, a glass button's face) takes its shape from the edge rule instead, like every other control.
  function glass(el, corners) {
    var edge = el.querySelector(":scope > .edge"), id = "zg" + (made++), parts = null, lastCorners = "", isControl = el.hasAttribute("data-cut-line");
    if (!edge) { edge = document.createElementNS(SVG, "svg"); edge.setAttribute("class", "edge"); edge.setAttribute("aria-hidden", "true"); el.appendChild(edge); }
    function node(tag, attributes) { var n = document.createElementNS(SVG, tag); for (var name in attributes) n.setAttribute(name, attributes[name]); edge.appendChild(n); return n; }
    function build() {
      edge.innerHTML =
        '<defs>' +
        '<linearGradient id="' + id + 'fr" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7fd8ff" stop-opacity="0.5"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#ffc58a" stop-opacity="0.5"/></linearGradient>' +
        // Refraction: the facet's inner line catches the light from the other side, so it runs the opposite way to the rim.
        '<linearGradient id="' + id + 'in" x1="1" y1="1" x2="0" y2="0"><stop class="gleam" offset="0"/><stop class="gleam" offset="0.4" stop-opacity="0"/><stop class="gleam" offset="0.75" stop-opacity="0"/><stop class="gleam" offset="1" stop-opacity="0.35"/></linearGradient>' +
        // Reflection: a bright glint where the rim meets the lit corner, fading along both edges.
        '<linearGradient id="' + id + 'sp" x1="0" y1="0" x2="1" y2="1"><stop class="spec" offset="0"/><stop class="spec" offset="0.08"/><stop class="spec" offset="0.3" stop-opacity="0"/></linearGradient>' +
        '</defs>';
      parts = {
        dense: node("path", { "class": "dense", "fill-rule": "evenodd" }),
        bevel: node("g", { "class": "bevel" }), bevelQuads: [],
        hair: node("polygon", { "class": "hair", fill: "none", "stroke-width": "1.2" }),
        rimBand: node("g", { "class": "rim-band" }), rimQuads: [],
        // A plain line on the rim, unseen until a tinted or focused slab colours it.
        rim: node("polygon", { "class": "rim", fill: "none", "stroke-width": "1.6" }),
        spec: node("polygon", { "class": "spec-line", fill: "none", stroke: "url(#" + id + "sp)", "stroke-width": "1.4" }),
        fringe: node("polygon", { "class": "fringe", fill: "none", stroke: "url(#" + id + "fr)", "stroke-width": "0.8" }),
        inner: node("polygon", { "class": "inner", fill: "none", stroke: "url(#" + id + "in)", "stroke-width": "1" }),
        facets: []
      };
    }
    function draw() {
      var w = el.offsetWidth, h = el.offsetHeight;
      if (!w || !h) return;
      // Any size: a small slab gets smaller cuts and a narrower bevel, so the rim never crowds what's in it.
      var short = Math.min(w, h), band = Number(el.getAttribute("data-glass-band")) || Math.max(2, Math.min(4, short * 0.04)), at, lights;
      if (!parts) build();
      if (isControl) {
        var shape = controlOutline(el, w, h), key = w + "x" + h + ":" + pointList(shape);
        if (key === lastCorners) return;
        lastCorners = key;
        el.style.setProperty("--cut-shape", cssPolygon(shape)); el.style.clipPath = cssPolygon(shape);
        at = function (inset) { return insetShape(shape, inset); };
        lights = shape.map(function (p, i) { return FACING_LIGHT[facing(p, shape[(i + 1) % shape.length])]; });
      } else {
        var c = corners().map(function (cut) { return Math.min(cut, Math.round(short * 0.3)); }), cornerKey = c.join(",");
        if (cornerKey !== lastCorners) {
          lastCorners = cornerKey;
          el.style.clipPath = "polygon(0 " + c[0] + "px, " + c[0] + "px 0, calc(100% - " + c[1] + "px) 0, 100% " + c[1] + "px, 100% calc(100% - " + c[2] + "px), calc(100% - " + c[2] + "px) 100%, " + c[3] + "px 100%, 0 calc(100% - " + c[3] + "px))";
        }
        at = function (inset) { return cutPoints(w, h, c, inset); };
        lights = SIDE_LIGHT;
      }
      // No viewBox: the rim is drawn in CSS pixels, so a frame where the slab has grown before its points move never stretches it.
      edge.removeAttribute("viewBox");
      // Density: glass is thicker at its edge, so a second, wider band tints the panel just inside the bevel.
      parts.dense.setAttribute("d", "M" + pointList(at(0)) + "Z M" + pointList(at(band * 1.6)) + "Z");
      placeBands(parts.bevel, parts.bevelQuads, at(0), at(band), lights);
      placeBands(parts.rimBand, parts.rimQuads, at(0), at(1.6), lights);
      parts.hair.setAttribute("points", pointList(at(0.6)));
      parts.rim.setAttribute("points", pointList(at(1.6)));
      parts.spec.setAttribute("points", pointList(at(1.6)));
      // Dispersion: a faint split of colour along the facet's inner edge, where the light bends.
      parts.fringe.setAttribute("points", pointList(at(Math.max(2.4, band - 0.8))));
      parts.inner.setAttribute("points", pointList(at(band)));
      // The cut facets: a bright line on each side cut across a corner, the one facing the light brightest.
      var outline = at(0), facetSides = [];
      outline.forEach(function (p, i) {
        var q = outline[(i + 1) % outline.length], way = facing(p, q);
        if (way.indexOf("-") > 0 && Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.5) facetSides.push([p, q, way]);
      });
      while (parts.facets.length < facetSides.length) parts.facets.push(node("line", {}));
      parts.facets.forEach(function (line, i) {
        var side = facetSides[i];
        line.style.display = side ? "" : "none"; if (!side) return;
        var isLit = side[2] === "top-left";
        line.setAttribute("class", isLit ? "facet lit" : "facet"); line.setAttribute("stroke-width", isLit ? "4.5" : "3");
        line.setAttribute("x1", side[0][0]); line.setAttribute("y1", side[0][1]); line.setAttribute("x2", side[1][0]); line.setAttribute("y2", side[1][1]);
      });
    }
    draw();
    if (window.ResizeObserver) new ResizeObserver(draw).observe(el); else window.addEventListener("resize", draw);
    if (isControl && document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
    return draw;
  }
  /*
   * The edge rule, one for every action and input (cutLine draws it, and glass for a control made of glass):
   * - An end slants only where another control sits right beside it in a row (tabs in a switch, Play and its details):
   *   within BESIDE_GAP_PX, side by side. Both share the slant, so the gap between them runs parallel.
   * - Every other corner fits what holds it (the glass pane, or a control it sits in): it takes the holder's outline moved
   *   in by the gap round it, so the gap stays even. Near a corner of the pane that's the pane's cut, less the gap; along a
   *   straight edge, or in the middle, it's square. A control alone in a pane fits it at its top and its bottom.
   * - A control on no pane is shaped as if it were in a pane, flush to it: a pane's corners at its own size, except where another
   *   control on no pane is stacked right above or below it (the pane would hold them both), where it's square.
   * The shape goes to CSS as --cut-shape, and el.cutCorners holds its corners for what sits inside it.
   */
  var BESIDE_GAP_PX = 16, LONE_CORNERS = [18, 9, 18, 9];
  function glassCorners(pane) {
    var cuts = (pane.getAttribute("data-glass-corners") || "16 6 16 6").trim().split(/ +/).map(Number), short = Math.min(pane.offsetWidth, pane.offsetHeight);
    return cuts.map(function (cut) { return Math.min(cut, Math.round(short * 0.3)); });
  }
  function holderOf(el) { return el.parentElement && el.parentElement.closest("[data-glass], [data-cut-line]"); }
  // The corner cuts each corner takes from what holds it: the holder's outline, moved in by the gap. data-cut-ends="start", "end"
  // or "start end": that end follows the holder's end wherever it sits along it, its gap there taken as its gap from the top and
  // bottom (a switch's slab on its first or last tab, as the tabs scroll).
  function fitCuts(el, w, h) {
    var holder = holderOf(el);
    if (!holder) {
      var stack = stacked(el);
      return LONE_CORNERS.map(function (cut, i) { return (i < 2 ? stack.above : stack.below) ? 0 : Math.min(cut, Math.round(Math.min(w, h) * 0.3)); });
    }
    var c = holder.hasAttribute("data-cut-line") ? holder.cutCorners || [0, 0, 0, 0] : glassCorners(holder);
    var r = el.getBoundingClientRect(), p = holder.getBoundingClientRect(), ends = el.getAttribute("data-cut-ends") || "";
    var top = r.top - p.top, bottom = p.bottom - r.bottom;
    var left = /start/.test(ends) ? (top + bottom) / 2 : r.left - p.left, right = /end/.test(ends) ? (top + bottom) / 2 : p.right - r.right;
    return [[left, top], [right, top], [right, bottom], [left, bottom]].map(function (gaps, i) {
      var sum = Math.max(0, gaps[0]) + Math.max(0, gaps[1]);
      return Math.max(0, (c[i] || 0) - sum + Math.SQRT2 * sum / 2);
    });
  }
  // Which ends have another control right beside them. data-cut-beside="start", "end", "start end" or "" says so instead (a switch's
  // slab: the tabs beside it aren't controls of their own).
  function besides(el) {
    var declared = el.getAttribute("data-cut-beside");
    if (declared !== null) return { start: /start/.test(declared), end: /end/.test(declared) };
    var holder = holderOf(el), r = el.getBoundingClientRect(), found = { start: false, end: false };
    (holder || document).querySelectorAll("[data-cut-line]").forEach(function (other) {
      if (other === el || other.contains(el) || el.contains(other) || holderOf(other) !== holder) return;
      var o = other.getBoundingClientRect(); if (!o.width || !o.height) return;
      if (Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top) < Math.min(r.height, o.height) / 2) return;
      var after = o.left - r.right, before = r.left - o.right;
      if (after >= -1 && after <= BESIDE_GAP_PX) found.end = true;
      if (before >= -1 && before <= BESIDE_GAP_PX) found.start = true;
    });
    return found;
  }
  // For a control on no pane: whether another one sits right above or below it, overlapping it across.
  function stacked(el) {
    var r = el.getBoundingClientRect(), found = { above: false, below: false };
    document.querySelectorAll("[data-cut-line]").forEach(function (other) {
      if (other === el || other.contains(el) || el.contains(other) || holderOf(other)) return;
      var o = other.getBoundingClientRect(); if (!o.width || !o.height) return;
      if (Math.min(r.right, o.right) - Math.max(r.left, o.left) < Math.min(r.width, o.width) / 2) return;
      var below = o.top - r.bottom, above = r.top - o.bottom;
      if (below >= -1 && below <= BESIDE_GAP_PX) found.below = true;
      if (above >= -1 && above <= BESIDE_GAP_PX) found.above = true;
    });
    return found;
  }
  // The outline, clockwise from the top left.
  function controlShape(w, h, slant, cuts, beside) {
    var s = Math.min(slant, w / 3), c = cuts.map(function (cut) { return Math.min(cut, h / 2); }), points = [];
    if (beside.start) points.push([s, 0]); else if (c[0] > 0.5) points.push([0, c[0]], [c[0], 0]); else points.push([0, 0]);
    if (beside.end) points.push([w, 0], [w - s, h]);
    else {
      if (c[1] > 0.5) points.push([w - c[1], 0], [w, c[1]]); else points.push([w, 0]);
      if (c[2] > 0.5) points.push([w, h - c[2]], [w - c[2], h]); else points.push([w, h]);
    }
    if (beside.start) points.push([0, h]); else if (c[3] > 0.5) points.push([c[3], h], [0, h - c[3]]); else points.push([0, h]);
    return points;
  }
  function controlOutline(el, w, h) {
    var beside = besides(el), cuts = fitCuts(el, w, h);
    el.cutCorners = [beside.start ? 0 : cuts[0], beside.end ? 0 : cuts[1], beside.end ? 0 : cuts[2], beside.start ? 0 : cuts[3]].map(function (cut) { return Math.min(cut, h / 2); });
    return controlShape(w, h, Number(el.getAttribute("data-cut-line")) || 10, cuts, beside);
  }
  function cssPolygon(points) { return "polygon(" + points.map(function (p) { return p[0].toFixed(2) + "px " + p[1].toFixed(2) + "px"; }).join(", ") + ")"; }
  // The same outline moved inward by d on every side: each side's line shifted along its inner normal, meeting its neighbours.
  function insetShape(points, d) {
    if (!d) return points;
    var n = points.length, lines = points.map(function (p, i) {
      var q = points[(i + 1) % n], dx = q[0] - p[0], dy = q[1] - p[1], length = Math.hypot(dx, dy) || 1, nx = -dy / length, ny = dx / length;
      return { x: p[0] + nx * d, y: p[1] + ny * d, dx: dx, dy: dy, nx: nx, ny: ny };
    });
    return lines.map(function (line, i) {
      var before = lines[(i + n - 1) % n], cross = before.dx * line.dy - before.dy * line.dx;
      if (Math.abs(cross) < 1e-6) return [line.x, line.y];
      var t = ((line.x - before.x) * line.dy - (line.y - before.y) * line.dx) / cross;
      return [before.x + before.dx * t, before.y + before.dy * t];
    });
  }
  // Which way a side faces, of eight, so its band takes that side's light.
  var FACING = ["right", "top-right", "top", "top-left", "left", "bottom-left", "bottom", "bottom-right"];
  function facing(p, q) { var dx = q[0] - p[0], dy = q[1] - p[1], degrees = Math.atan2(dx, dy) * 180 / Math.PI; return FACING[((Math.round(degrees / 45) % 8) + 8) % 8]; }
  function cutLine(el) {
    var svg = el.querySelector(":scope > .cut-line");
    if (!svg) { svg = document.createElementNS(SVG, "svg"); svg.setAttribute("class", "cut-line"); svg.setAttribute("aria-hidden", "true"); svg.appendChild(document.createElementNS(SVG, "polygon")); el.insertBefore(svg, el.firstChild); }
    var poly = svg.querySelector("polygon"), bands = [], last = "";
    function list(points) { return points.map(function (p) { return p[0].toFixed(2) + "," + p[1].toFixed(2); }).join(" "); }
    function draw() {
      var w = el.offsetWidth, h = el.offsetHeight; if (!w || !h) return;
      var shape = controlOutline(el, w, h), key = w + "x" + h + ":" + list(shape);
      if (key === last) return;
      last = key;
      el.style.setProperty("--cut-shape", cssPolygon(shape));
      svg.setAttribute("viewBox", "0 0 " + w + " " + h);
      poly.setAttribute("points", list(insetShape(shape, 1)));
      // The raised or carved light: a 1.5px band along each side. data-cut-inset moves it inward, inside an outline drawn round the edge (the sidebar's current place).
      var from = Number(el.getAttribute("data-cut-inset")) || 0, outer = insetShape(shape, from), inner = insetShape(shape, from + 1.5);
      while (bands.length < shape.length) { var band = document.createElementNS(SVG, "path"); svg.insertBefore(band, poly); bands.push(band); }
      while (bands.length > shape.length) svg.removeChild(bands.pop());
      bands.forEach(function (band, i) {
        var j = (i + 1) % shape.length;
        band.setAttribute("class", "cut-band on-" + facing(shape[i], shape[j]));
        band.setAttribute("d", "M" + list([outer[i], outer[j], inner[j], inner[i]]) + "Z");
      });
    }
    draw();
    el.redrawCut = draw;
    if (window.ResizeObserver) {
      var watch = new ResizeObserver(draw); watch.observe(el);
      var holder = el.parentElement && el.parentElement.closest("[data-glass]"); if (holder) watch.observe(holder);
    }
    window.addEventListener("resize", draw);
    // Where it sits can change without its size changing: once the fonts are in, the layout has settled.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
  }
  // The page's settings (PageSettings), changed in place for the whole page or under one element. Only what's given changes:
  // { theme: "light" | "dark" | null } and { glass: { hueColour: "#rrggbb" | null } }, null going back to the default.
  window.zaismaSettings = {
    set: function (settings, element) {
      var target = element || document.documentElement;
      target.classList.add("eases-settings");
      if (settings.theme !== undefined) { if (settings.theme === "light" || settings.theme === "dark") target.setAttribute("data-theme-choice", settings.theme); else target.removeAttribute("data-theme-choice"); }
      var glass = settings.glass;
      if (glass && glass.hueColour !== undefined) { if (typeof glass.hueColour === "string" && /^#[0-9a-fA-F]{6}$/.test(glass.hueColour)) target.style.setProperty("--glass-hue", glass.hueColour); else target.style.removeProperty("--glass-hue"); }
    },
    read: function (element) {
      var target = element || document.documentElement, hue = target.style.getPropertyValue("--glass-hue").trim();
      return { theme: target.getAttribute("data-theme-choice") || null, glass: { hueColour: hue || null } };
    }
  };
  window.zaismaGlass = glass;
  window.zaismaCutLine = cutLine;
  var done = typeof WeakSet === "function" ? new WeakSet() : { has: function () { return false; }, add: function () {} };
  function apply(root) {
    if (!root.querySelectorAll) return;
    var slabs = Array.prototype.slice.call(root.querySelectorAll("[data-glass]")), lines = Array.prototype.slice.call(root.querySelectorAll("[data-cut-line]"));
    if (root.matches && root.matches("[data-glass]")) slabs.push(root);
    if (root.matches && root.matches("[data-cut-line]")) lines.push(root);
    slabs.forEach(function (el) {
      if (done.has(el)) return; done.add(el);
      var corners = (el.getAttribute("data-glass-corners") || "18 9 18 9").split(/\\s+/).map(Number);
      glass(el, function () { return corners; });
    });
    // A control made of glass is drawn by glass, from the same edge rule.
    lines.forEach(function (el) {
      if (done.has(el) || el.hasAttribute("data-glass")) return; done.add(el);
      cutLine(el);
    });
  }
  apply(document);
  new MutationObserver(function (changes) { changes.forEach(function (change) { change.addedNodes.forEach(apply); }); }).observe(document.body, { subtree: true, childList: true });
})();
`;

/**
 * Zaisma's own backdrop shader: three soft lights in the theme's backdrop colours drifting very slowly, crossed by wide
 * diagonal facets a step brighter or darker, the cut shape at the scale of the page. Any page's own fragment shader gets
 * the same uniforms: u_resolution (pixels), u_time (seconds), u_base, u_a, u_b, u_c (the theme's --backdrop-* colours) and u_dark (1 on dark).
 */
export const BACKDROP_SHADER = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_resolution; uniform float u_time; uniform vec3 u_base; uniform vec3 u_a; uniform vec3 u_b; uniform vec3 u_c; uniform float u_dark;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float light(vec2 p, vec2 at, float size) { vec2 d = p - at; return exp(-dot(d, d) / (size * size)); }
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float s = u_time * 0.04;
  vec3 colour = u_base;
  colour = mix(colour, u_a, 0.9 * light(p, vec2(aspect * (0.22 + 0.12 * sin(s * 1.3)), 0.72 + 0.12 * cos(s * 1.7)), 0.6));
  colour = mix(colour, u_b, 0.8 * light(p, vec2(aspect * (0.78 + 0.1 * cos(s * 1.1)), 0.32 + 0.15 * sin(s * 0.9)), 0.55));
  colour = mix(colour, u_c, 0.75 * light(p, vec2(aspect * (0.52 + 0.18 * sin(s * 0.7 + 2.0)), 0.95 + 0.1 * sin(s * 1.5)), 0.5));
  float facet = floor((p.x * 0.7 + p.y) * 1.4 + s * 0.5);
  colour += (hash(vec2(facet, 3.0)) - 0.5) * mix(0.045, 0.03, u_dark);
  colour += (hash(gl_FragCoord.xy + fract(u_time)) - 0.5) / 128.0;
  gl_FragColor = vec4(colour, 1.0);
}`;

/**
 * Backdrops: every canvas[data-backdrop] on a page. "shader" draws a fragment shader (the page's own in data-backdrop-shader,
 * or Zaisma's), "scene" leaves the drawing to the page: each frame the canvas gets a backdrop-frame event whose detail is
 * { timeS, colours: { base, a, b, c, isDark }, widthPx, heightPx }, and the page draws its 3D scene into the canvas then.
 * Either way this keeps the canvas sized to its box, follows the theme, runs at most 30 frames a second, stops while the page
 * is hidden or the canvas is out of view, and under reduced motion draws one still frame. Without WebGL a shader backdrop
 * keeps its CSS gradient in the same colours.
 */
export const BACKDROP_SCRIPT = `/* backdrop */(function () {
  var ZAISMA_SHADER = ${JSON.stringify(BACKDROP_SHADER)};
  var VERTEX = "attribute vec2 corner; void main() { gl_Position = vec4(corner, 0.0, 1.0); }";
  var still = window.matchMedia("(prefers-reduced-motion: reduce)");
  var layers = [], lastMs = 0, running = false;
  function rgb(value) {
    var digits = value.trim().replace("#", "");
    if (digits.length === 3) digits = digits.split("").map(function (d) { return d + d; }).join("");
    var n = parseInt(digits, 16) || 0;
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }
  function readColours(el) {
    var css = getComputedStyle(el);
    return { base: rgb(css.getPropertyValue("--backdrop-base")), a: rgb(css.getPropertyValue("--backdrop-a")), b: rgb(css.getPropertyValue("--backdrop-b")),
      c: rgb(css.getPropertyValue("--backdrop-c")), isDark: /dark/.test(css.colorScheme || "") };
  }
  function shaderDrawer(canvas) {
    var gl = canvas.getContext("webgl", { antialias: false, alpha: true, powerPreference: "low-power" });
    if (!gl) return null;
    function compile(kind, source) {
      var shader = gl.createShader(kind); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { console.warn("Backdrop shader:", gl.getShaderInfoLog(shader)); return null; }
      return shader;
    }
    var vertex = compile(gl.VERTEX_SHADER, VERTEX), fragment = compile(gl.FRAGMENT_SHADER, canvas.getAttribute("data-backdrop-shader") || ZAISMA_SHADER);
    if (!vertex || !fragment) return null;
    var program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    var corner = gl.getAttribLocation(program, "corner"); gl.enableVertexAttribArray(corner); gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
    var at = {}; ["u_resolution", "u_time", "u_base", "u_a", "u_b", "u_c", "u_dark"].forEach(function (name) { at[name] = gl.getUniformLocation(program, name); });
    return function (timeS, colours) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(at.u_resolution, canvas.width, canvas.height); gl.uniform1f(at.u_time, timeS);
      gl.uniform3fv(at.u_base, colours.base); gl.uniform3fv(at.u_a, colours.a); gl.uniform3fv(at.u_b, colours.b); gl.uniform3fv(at.u_c, colours.c);
      gl.uniform1f(at.u_dark, colours.isDark ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
  }
  // A change of theme fades the backdrop's colours over the same half second as the glass's, so the two never part for a frame.
  var FADE_MS = 500;
  function mix(from, to, t) { return from.map(function (value, i) { return value + (to[i] - value) * t; }); }
  function shownColours(layer, nowMs) {
    var t = still.matches || !layer.from ? 1 : Math.min(1, (nowMs - layer.fadeStartMs) / FADE_MS);
    if (t >= 1) { layer.from = null; return layer.target; }
    var eased = t * t * (3 - 2 * t), from = layer.from, to = layer.target;
    return { base: mix(from.base, to.base, eased), a: mix(from.a, to.a, eased), b: mix(from.b, to.b, eased), c: mix(from.c, to.c, eased), isDark: eased < 0.5 ? from.isDark : to.isDark };
  }
  function draw(layer, nowMs) {
    // The wall clock, not the page's own: moving to another page, the backdrop carries on where it was instead of starting over.
    var timeS = still.matches ? 20 : (Date.now() / 1000) % 100000;
    layer.colours = shownColours(layer, nowMs);
    if (layer.drawShader) layer.drawShader(timeS, layer.colours);
    else layer.canvas.dispatchEvent(new CustomEvent("backdrop-frame", { detail: { timeS: timeS, colours: layer.colours, widthPx: layer.canvas.width, heightPx: layer.canvas.height } }));
    layer.isDrawn = !layer.from;
  }
  function frame(nowMs) {
    requestAnimationFrame(frame);
    if (document.hidden || nowMs - lastMs < 33) return;
    lastMs = nowMs;
    layers.forEach(function (layer) { if (layer.isInView && !(still.matches && layer.isDrawn)) draw(layer, nowMs); });
  }
  // The colours are read again whenever the theme might have changed; the fade starts at once, from what's showing, and only when they did change.
  function refresh() {
    var nowMs = performance.now();
    layers.forEach(function (layer) {
      var next = readColours(layer.canvas);
      if (JSON.stringify(next) === JSON.stringify(layer.target)) return;
      layer.from = layer.colours; layer.target = next; layer.fadeStartMs = nowMs; layer.isDrawn = false;
      if (layer.isInView) draw(layer, nowMs);
    });
  }
  function setUp(canvas) {
    if (canvas.backdropLayer) return;
    var isScene = canvas.getAttribute("data-backdrop") === "scene";
    // A shader is soft, so it's drawn at one pixel per CSS pixel; a scene gets the screen's sharpness, up to 2x.
    var layer = { canvas: canvas, isInView: true, isDrawn: false, target: readColours(canvas), from: null, scale: Math.min(window.devicePixelRatio || 1, isScene ? 2 : 1) };
    if (!isScene) { layer.drawShader = shaderDrawer(canvas); if (!layer.drawShader) return; canvas.classList.add("is-drawn"); }
    canvas.backdropLayer = layer;
    // Resizing a canvas clears it, so it's drawn again at once: it never shows a frame of the plain colour under it.
    function size() {
      var width = Math.max(1, Math.round(canvas.clientWidth * layer.scale)), height = Math.max(1, Math.round(canvas.clientHeight * layer.scale));
      if (width === canvas.width && height === canvas.height) return;
      canvas.width = width; canvas.height = height; layer.isDrawn = false;
      if (canvas.backdropLayer) draw(layer, performance.now());
    }
    size();
    if (window.ResizeObserver) new ResizeObserver(size).observe(canvas); else window.addEventListener("resize", size);
    if (window.IntersectionObserver) new IntersectionObserver(function (entries) { layer.isInView = entries[entries.length - 1].isIntersecting; }).observe(canvas);
    layers.push(layer);
    // The first frame is drawn at once, so the canvas never shows empty while it waits for the next animation frame.
    draw(layer, performance.now());
    if (!running) { running = true; requestAnimationFrame(frame); }
  }
  document.querySelectorAll("canvas[data-backdrop]").forEach(setUp);
  // The theme can change in place (a data-theme-choice switch, or the system's), and the colours follow it.
  new MutationObserver(refresh).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["data-theme-choice"] });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", refresh);
  still.addEventListener("change", refresh);
})();
`;

/* ---- The foundations in the gallery: tokens, type, glass, backdrop, cut shapes, motion and icons. ---- */

const SWATCHES: { token: string; note: string }[] = [
  { token: "--ink", note: "Words" },
  { token: "--ink-2", note: "Second words" },
  { token: "--muted", note: "Quiet words" },
  { token: "--line", note: "Lines" },
  { token: "--page", note: "Zaisma's own page" },
  { token: "--glass-tint", note: "A pane's glass" },
  { token: "--run", note: "What you act on" },
  { token: "--run-hi", note: "Its light" },
  { token: "--run-lo", note: "Its shade" },
  { token: "--chip-face", note: "Updated tag" },
  { token: "--danger", note: "A delete's confirm step only" },
];

const swatches = () =>
  html`<div class="glass swatch-pane" data-glass data-glass-corners="18 9 18 9">${EDGE}<ul class="swatches">${SWATCHES.map(({ token, note }) => html`<li><span class="chip-swatch" style="background:var(${token})"></span><code>${token}</code><span>${note}</span></li>`)}</ul></div>`;

component({
  name: "Colour",
  slug: "colour",
  group: "foundations",
  summary: "Every colour comes from these tokens, so light, dark and smoked glass follow by themselves. Orange is only for what you act on, and it is always shown in full: never faded or at half opacity.",
  styles: `
/* Colour: the gallery's swatches. */
.swatch-pane { width: 100%; }
.swatches { list-style: none; margin: 0; padding: 18px; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px 18px; }
.swatches li { display: grid; grid-template-columns: 36px 1fr; grid-template-rows: auto auto; column-gap: 10px; align-items: center; font: 500 13px var(--display); }
.swatches .chip-swatch { grid-row: span 2; width: 36px; height: 36px; box-shadow: inset 0 0 0 1px var(--line); clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px); }
.swatches code { font: 600 13px ui-monospace, Menlo, monospace; }
.swatches span:last-child { color: var(--muted); }
`,
  examples: [
    { label: "Every token", markup: swatches(), isWide: true },
  ],
});

component({
  name: "Type",
  slug: "type",
  group: "foundations",
  summary: "Jost for headings, names and controls; the system's own face for reading. Words are 16px in fields, so phones don't zoom in.",
  styles: `
/* Type: Jost for display, the system face for body text. */
.type-sample { width: 100%; display: grid; gap: 10px; color: var(--ink); }
.type-sample .d40 { font: 600 40px/1.04 var(--display); letter-spacing: -0.01em; }
.type-sample .d30 { font: 600 30px/1.1 var(--display); }
.type-sample .d22 { font: 600 22px var(--display); }
.type-sample .d17 { font: 500 17px var(--display); }
.type-sample .d15 { font: 500 15px var(--display); }
.type-sample .b15 { font: 15px/1.5 var(--body); color: var(--ink-2); max-width: 60ch; }
.type-sample .b13 { font: 500 13px/1.3 var(--display); color: var(--muted); }
.type-sample small { font: 500 12px ui-monospace, Menlo, monospace; color: var(--muted); margin-left: 10px; }
@media (max-width: 760px) { .type-sample small { display: block; margin: 2px 0 0; } .type-sample .d40 { font-size: 32px; } }
`,
  examples: [
    {
      label: "Sizes",
      isWide: true,
      markup: html`<div class="type-sample">
  <div class="d40">Ashen Crown<small>Jost 600, 40px: a game's title</small></div>
  <div class="d30">Welcome back<small>Jost 600, 30px: a pane's heading</small></div>
  <div class="d22">Continue playing<small>Jost 600, 22px: a row</small></div>
  <div class="d17">Your profile<small>Jost 500, 17px: a menu, a wheel</small></div>
  <div class="d15">Home · Your games<small>Jost 500, 15px: tabs, buttons</small></div>
  <p class="b15">A fallen knight climbs a burning kingdom to take its crown back. Hard, fair fights, and a world that folds back on itself as you open shortcuts.<small>System, 15px: reading</small></p>
  <div class="b13">2 hours ago · 1,204 playing<small>Jost 500, 13px: facts under a cover</small></div>
</div>`,
    },
  ],
});

/**
 * The settings every page has, in one place: what all its components follow, so one change covers every instance at once.
 * Each component's own settings sit under its name, and a page leaves out what it doesn't use. pageSettingsAttributes puts them
 * on <html> (or any element, for what's inside it, like the gallery's stage); window.zaismaSettings.set changes them in place.
 */
export interface PageSettings {
  /** Light or dark. Left out, the system's. */
  theme?: "light" | "dark";
  glass?: {
    /** Tints every piece of glass, as a #rrggbb colour (like a game's colour on the home). Glass tinted for a brand keeps its own colour. */
    hueColour?: string;
  };
}

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

/** The settings as attributes for <html>. Only a #rrggbb colour is taken as a hue, so a game's colour can't carry anything else into the page. */
export function pageSettingsAttributes(settings: PageSettings): Raw {
  const hueColour = settings.glass?.hueColour;
  return html`${settings.theme ? html` data-theme-choice="${settings.theme}"` : ""}${hueColour && HEX_COLOUR.test(hueColour) ? html` style="--glass-hue:${hueColour}"` : ""}`;
}

/** Game-like colours for the gallery's hue example. */
const HUE_EXAMPLES: { label: string; hexColour: string }[] = [
  { label: "Crimson", hexColour: "#C8384A" },
  { label: "Emerald", hexColour: "#2E9E6B" },
  { label: "Violet", hexColour: "#7A4FD8" },
  { label: "Gold", hexColour: "#D9A520" },
];

const glassStrip = (body: Raw) => html`<div class="glass-strip"><i></i><i></i><i></i>${body}</div>`;

component({
  name: "Page settings",
  slug: "page-settings",
  group: "foundations",
  summary: "Every page has one set of settings that all its components follow: light or dark, and each component's own, like the glass's hue. One change covers every instance at once, and a page only carries the ones its components use.",
  styles: `
.setting-picks { display: flex; flex-wrap: wrap; gap: 10px; }
.setting-picks .hue-dot { position: relative; z-index: 2; width: 12px; height: 12px; border-radius: 50%; }
.setting-picks [aria-pressed="true"] > .face { background: var(--btn-hover); box-shadow: inset 0 -3px 0 var(--run); }
`,
  examples: [
    {
      label: "Light or dark: the whole gallery follows",
      isWide: true,
      markup: html`<div class="setting-picks" role="group" aria-label="Light or dark">${(["light", "dark"] as const).map((theme) => html`<button type="button" class="cut-btn shell" data-setting-theme="${theme}" aria-pressed="false"><span class="face cut-raised" data-cut-line="10">${CUT_LINE}<span>${theme === "light" ? "Light" : "Dark"}</span></span></button>`)}</div>`,
    },
    {
      label: "Glass: its hue, on every piece of glass in the gallery at once",
      isWide: true,
      markup: html`<div class="setting-picks" role="group" aria-label="The glass's hue"><button type="button" class="cut-btn shell" data-setting-hue="" aria-pressed="true"><span class="face cut-raised" data-cut-line="10">${CUT_LINE}<span>None</span></span></button>${HUE_EXAMPLES.map((hue) => html`<button type="button" class="cut-btn shell" data-setting-hue="${hue.hexColour}" aria-pressed="false"><span class="face cut-raised" data-cut-line="10">${CUT_LINE}<i class="hue-dot" style="background:${hue.hexColour}"></i><span>${hue.label}</span></span></button>`)}</div>`,
    },
  ],
});

component({
  name: "Glass",
  slug: "glass",
  group: "foundations",
  summary: "Zaisma's interface is glass over the game or the page's backdrop, never over a plain colour. It's as thin as the words allow: light with dark words, or smoked with light words.",
  styles: `
/* Glass: shown over a few shapes, so the blur has something to show. */
.glass-strip { width: 100%; position: relative; display: flex; flex-wrap: wrap; gap: 18px; padding: 26px; overflow: hidden; }
.glass-strip > i { position: absolute; width: 140px; height: 140px; border-radius: 50%; }
.glass-strip > i:nth-child(1) { left: 6%; top: -30px; background: #F7931A; }
.glass-strip > i:nth-child(2) { left: 38%; top: 40px; width: 220px; height: 90px; border-radius: 0; transform: rotate(-12deg); background: #3B6FD0; }
.glass-strip > i:nth-child(3) { right: 8%; top: 10px; background: #1E9C8E; }
.glass-strip .glass { flex: 1 1 180px; min-height: 110px; padding: 18px 20px; font: 500 15px/1.4 var(--display); }
.glass-strip .glass strong { display: block; font: 600 17px var(--display); }
.glass-strip .glass-kind::after { content: var(--glass-kind); }
/* Any size: one glass window over drifting shapes, to drag about and pull to any size (the gallery's script moves it).
   What's in it gives way as it shrinks, through a container query, so the glass itself never changes. */
.glass-play { position: relative; width: 100%; height: 360px; overflow: hidden; touch-action: none; background: var(--well); box-shadow: var(--well-shade);
  clip-path: polygon(0 18px, 18px 0, calc(100% - 9px) 0, 100% 9px, 100% calc(100% - 18px), calc(100% - 18px) 100%, 9px 100%, 0 calc(100% - 9px)); }
.glass-play > i { position: absolute; display: block; }
.glass-play .sun { left: 8%; top: 40px; width: 150px; height: 150px; border-radius: 50%; background: #F7931A; animation: glass-drift-a 14s ease-in-out infinite alternate; }
.glass-play .bar { left: 34%; top: 150px; width: 260px; height: 70px; background: #3B6FD0; transform: rotate(-14deg); animation: glass-drift-b 18s ease-in-out infinite alternate; }
.glass-play .sea { right: 10%; top: 30px; width: 190px; height: 190px; border-radius: 50%; background: #1E9C8E; animation: glass-drift-c 16s ease-in-out infinite alternate; }
.glass-play .cut { right: 30%; bottom: -30px; width: 160px; height: 120px; background: #E0457B; clip-path: polygon(0 30px, 30px 0, 100% 0, 100% calc(100% - 30px), calc(100% - 30px) 100%, 0 100%); animation: glass-drift-b 20s ease-in-out infinite alternate-reverse; }
.glass-play .dot { left: 22%; bottom: 20px; width: 70px; height: 70px; border-radius: 50%; background: #F4C430; animation: glass-drift-c 12s ease-in-out infinite alternate-reverse; }
@keyframes glass-drift-a { to { transform: translate(90px, 50px); } }
@keyframes glass-drift-b { to { transform: translate(-70px, -40px) rotate(8deg); } }
@keyframes glass-drift-c { to { transform: translate(-60px, 70px); } }
.glass-window { position: absolute; left: 6%; top: 36px; width: min(320px, 80%); height: 200px; container-type: size; padding: 18px 20px;
  display: flex; flex-direction: column; gap: 6px; overflow: hidden; cursor: grab; user-select: none; -webkit-user-select: none; touch-action: none; }
.glass-window.is-moving { cursor: grabbing; }
.glass-window:focus-visible { outline: none; }
.glass-window:focus-visible .edge .hair, .glass-window:focus-visible .edge .rim { stroke: var(--ink); stroke-width: 2; }
.glass-window strong { font: 600 17px var(--display); }
.glass-window .glass-note { font: 500 14px/1.4 var(--display); color: var(--ink-2); }
.glass-window .glass-size { margin-top: auto; font: 600 12px ui-monospace, Menlo, monospace; color: var(--muted); }
.glass-window .glass-grip { position: absolute; z-index: 4; right: 0; bottom: 0; width: 30px; height: 30px; cursor: nwse-resize; color: var(--muted); }
.glass-window .glass-grip svg { position: absolute; right: 0; bottom: 0; width: 30px; height: 30px; }
@container (max-height: 120px) { .glass-window .glass-note { display: none; } }
@container (max-height: 76px) { .glass-window .glass-size { display: none; } }
@container (max-width: 150px) { .glass-window .glass-note { display: none; } .glass-window strong { font-size: 14px; } }
@media (prefers-reduced-motion: reduce) { .glass-play > i { animation: none; } }
`,
  examples: [
    {
      label: "Any size: drag it, pull its corner, or use the arrow keys (Shift to resize)",
      isWide: true,
      markup: html`<div class="glass-play" data-glass-play><i class="sun"></i><i class="bar"></i><i class="sea"></i><i class="cut"></i><i class="dot"></i><div class="glass glass-window" data-glass data-glass-corners="18 9 18 9" tabindex="0" role="group" aria-label="A glass window. Arrow keys move it; Shift and the arrow keys resize it."><strong>Glass, any size</strong><span class="glass-note">The same glass from a button to a whole window: its cuts and rim fit themselves to it.</span><span class="glass-size" aria-hidden="true"></span><span class="glass-grip" aria-hidden="true"><svg viewBox="0 0 30 30"><path d="M24 14L14 24M24 8L8 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span></div></div>`,
    },
    {
      label: "Thin to thick",
      isWide: true,
      markup: glassStrip(html`${[35, 55, 72].map((glassOpacityPct) => html`<div class="glass" data-glass data-glass-corners="18 9 18 9" style="--glass-tint:rgba(var(--glass-base),${glassOpacityPct / 100})"><strong>${glassOpacityPct}%</strong><span class="glass-kind"></span></div>`)}`),
    },
  ],
});

export interface BackdropOptions {
  /** A page's own fragment shader, given the same uniforms as Zaisma's (BACKDROP_SHADER). Left out, the page gets Zaisma's. */
  fragmentShader?: string;
  /** The page draws its own 3D scene into the canvas on each backdrop-frame event, instead of a shader. */
  isScene?: boolean;
  /** Fills its own box (position: relative) instead of the window: for a backdrop shown inside something, like the gallery's examples. */
  isFramed?: boolean;
}

/** What's behind the glass on a page: the first thing in the page's body or stage, under everything else. */
export function backdrop(options: BackdropOptions = {}): Raw {
  return html`<canvas class="backdrop${options.isFramed ? " is-framed" : ""}" data-backdrop="${options.isScene ? "scene" : "shader"}"${options.fragmentShader ? html` data-backdrop-shader="${options.fragmentShader}"` : ""} aria-hidden="true"></canvas>`;
}

/** A page's own shader, for the gallery: slow light rippling out from the lower left in the same colours. */
const RIPPLE_SHADER = `precision mediump float;
uniform vec2 u_resolution; uniform float u_time; uniform vec3 u_base; uniform vec3 u_a; uniform vec3 u_b; uniform vec3 u_c;
void main() {
  vec2 p = gl_FragCoord.xy / u_resolution.y;
  float ring = 0.5 + 0.5 * sin(length(p) * 9.0 - u_time * 0.4);
  float band = 0.5 + 0.5 * sin(p.x * 3.0 + u_time * 0.15);
  gl_FragColor = vec4(mix(mix(u_base, u_a, ring * 0.7), u_c, band * 0.35), 1.0);
}`;

const backdropFrame = (layer: Raw) => html`<div class="backdrop-frame">${layer}<div class="glass" data-glass data-glass-corners="18 9 18 9"><strong>Glass</strong><span>Always over something.</span></div></div>`;

component({
  name: "Backdrop",
  slug: "backdrop",
  group: "foundations",
  summary: "Glass is never on a plain or solid colour: there's always something behind it, still or moving. A game is its own backdrop; Zaisma's pages have this one, or their own shader or 3D scene.",
  styles: `
/* The backdrop: a canvas under everything on the page. Its parent is isolated, so the canvas sits above the page's own colour and below the rest.
   Until the shader draws (and wherever WebGL is missing) it shows a still gradient in the same colours. */
.backdrop { position: fixed; inset: 0; z-index: -1; display: block; width: 100%; height: 100%; pointer-events: none;
  background: radial-gradient(60% 55% at 22% 28%, var(--backdrop-a), transparent 70%), radial-gradient(55% 55% at 78% 68%, var(--backdrop-b), transparent 70%),
    radial-gradient(45% 40% at 52% 4%, var(--backdrop-c), transparent 70%), var(--backdrop-base); }
.backdrop.is-framed { position: absolute; }
:has(> .backdrop) { isolation: isolate; }
.backdrop-frame { position: relative; width: 100%; height: 220px; display: flex; align-items: center; justify-content: center; overflow: hidden;
  clip-path: polygon(0 18px, 18px 0, calc(100% - 9px) 0, 100% 9px, 100% calc(100% - 18px), calc(100% - 18px) 100%, 9px 100%, 0 calc(100% - 9px)); }
.backdrop-frame .glass { width: min(260px, 80%); padding: 16px 20px; display: flex; flex-direction: column; gap: 2px; font: 500 14px/1.4 var(--display); color: var(--ink-2); }
.backdrop-frame .glass strong { font: 600 17px var(--display); color: var(--ink); }
`,
  examples: [
    { label: "Zaisma's own: behind every page", isWide: true, markup: backdropFrame(backdrop({ isFramed: true })) },
    { label: "A page's own shader", markup: backdropFrame(backdrop({ isFramed: true, fragmentShader: RIPPLE_SHADER })) },
    { label: "A 3D scene the page draws", markup: backdropFrame(html`${backdrop({ isFramed: true, isScene: true })}`) },
  ],
});

component({
  name: "Cut shapes",
  slug: "cut-shapes",
  group: "foundations",
  summary: "Corners are cut, never rounded: 16 and 6 on the header, 18 and 9 on panes, and a 10px slant on buttons and fields.",
  styles: `
/* Cut shapes: the three cuts. */
.cuts { display: flex; flex-wrap: wrap; gap: 22px; align-items: flex-end; }
.cuts figure { margin: 0; display: grid; gap: 8px; font: 500 13px var(--display); color: var(--muted); }
.cuts .shape { background: var(--ink); opacity: 0.85; }
.cuts .header-cut { width: 260px; height: 68px; clip-path: polygon(0 16px, 16px 0, calc(100% - 6px) 0, 100% 6px, 100% calc(100% - 16px), calc(100% - 16px) 100%, 6px 100%, 0 calc(100% - 6px)); }
.cuts .pane-cut { width: 200px; height: 140px; clip-path: polygon(0 18px, 18px 0, calc(100% - 9px) 0, 100% 9px, 100% calc(100% - 18px), calc(100% - 18px) 100%, 9px 100%, 0 calc(100% - 9px)); }
.cuts .slant { width: 160px; height: 44px; clip-path: polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%); }
`,
  examples: [
    {
      label: "The three cuts",
      isWide: true,
      markup: html`<div class="cuts"><figure><span class="shape header-cut"></span><figcaption>Header: 16 and 6</figcaption></figure><figure><span class="shape pane-cut"></span><figcaption>Pane: 18 and 9</figcaption></figure><figure><span class="shape slant"></span><figcaption>Buttons and fields: 10px slants</figcaption></figure></div>`,
    },
  ],
});

component({
  name: "Motion",
  slug: "motion",
  group: "foundations",
  summary: "Things move only when pointed at or pressed: a spring of 0.55s for slabs, 0.45s for a change of size. Reduced motion stops all of it.",
  styles: `
/* Motion: a slab sliding between two tabs on point, with the spring. */
.motion-demo { position: relative; display: grid; grid-template-columns: 1fr 1fr; width: min(320px, 100%); height: 44px; padding: 4px; background: var(--well); box-shadow: var(--well-shade);
  clip-path: polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%); }
/* The slab never takes the pointer, so moving under it doesn't end the point that moved it. */
.motion-demo .slab { position: absolute; z-index: 0; pointer-events: none; top: 4px; bottom: 4px; left: 4px; width: calc(50% - 4px); background: var(--slab); box-shadow: var(--slab-shade), inset 0 -3px 0 var(--run);
  clip-path: polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%); transition: transform 0.55s var(--spring); }
.motion-demo span:not(.slab) { position: relative; z-index: 1; display: grid; place-items: center; font: 500 15px var(--display); color: var(--ink-2); cursor: default; }
.motion-demo:has(.second:hover) .slab { transform: translateX(100%); }
.motion-note { margin: 10px 0 0; font: 500 13px var(--display); color: var(--muted); }
@media (prefers-reduced-motion: reduce) { .motion-demo .slab { transition: none; } }
`,
  examples: [
    {
      label: "Point at the second tab",
      markup: html`<div class="motion-demo"><span>Spring 0.55s</span><span class="second">Point here</span><span class="slab" aria-hidden="true"></span></div><p class="motion-note">cubic-bezier(.3, 1.2, .4, 1)</p>`,
    },
  ],
});

component({
  name: "Icons",
  slug: "icons",
  group: "foundations",
  summary: "Thin line icons in the words' colour, so a kind of fact can be found without reading. Never decoration.",
  styles: `
/* Icons: the set, with names. */
.icon-set { width: 100%; list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 14px; color: var(--ink); }
.icon-set li { display: flex; align-items: center; gap: 10px; font: 500 13px var(--display); color: var(--ink-2); }
.icon-set .ico { width: 20px; height: 20px; color: var(--ink); }
.icon-set .play { color: var(--ink); }
`,
  examples: [{ label: "Every icon", isWide: true, markup: html`<ul class="icon-set">${Object.keys(ICONS).map((name) => html`<li>${icon(name as IconName)}<span>${name}</span></li>`)}</ul>` }],
});
