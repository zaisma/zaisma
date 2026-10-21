import { html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";

/*
 * The foundations of Zaisma's look: the tokens every component takes its colors from, the glass and its
 * drawn rim, the cut shapes, the motion and the line icons. From the drafts Julius approved (ops
 * docs/drafts/look-and-voice/). "Zaisma is the glass, and the game is not"; orange only on what you act on.
 */

/** The glass's two kinds, as tokens: light glass with dark words, and smoked glass with light words. */
const LIGHT_GLASS = `color-scheme: light;
  --ink: #14171C; --ink-2: #3D444E; --muted: #59606A; --line: rgba(20, 23, 28, 0.14);
  --glass: rgba(255, 255, 255, 0.4); --glass-edge: rgba(255, 255, 255, 0.92); --field: rgba(255, 255, 255, 0.62);
  --glass-tint: rgba(250, 252, 255, 0.5); --glass-top: rgba(250, 252, 255, 0.56); --glass-dropdown: rgba(250, 252, 255, 0.62); --glass-tray: rgba(250, 252, 255, 0.14);
  --glass-sheen: radial-gradient(140% 90% at 0% 0%, rgba(255, 255, 255, 0.34), rgba(255, 255, 255, 0) 55%), linear-gradient(180deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0) 38%, rgba(30, 60, 110, 0) 70%, rgba(30, 60, 110, 0.05));
  /* A tray's light: the same sheen at a third of the strength, so the tray stays muted under its pane. */
  --glass-tray-sheen: radial-gradient(140% 90% at 0% 0%, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0) 55%), linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0) 38%, rgba(30, 60, 110, 0) 70%, rgba(30, 60, 110, 0.02));
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
  /* A one-color mark on clear glass (Discord's): unset on light glass, so it keeps its own color; white on smoked. */
  --clear-glass-mark: initial;
  /* What shows only on light glass, and only on smoked (the light-dark icon's sun and moon). */
  --on-light: inline; --on-smoked: none;
  /* The line between two parts of one pane (its head and its list, a list and the facts under it). Set with each kind of glass, not on :root,
     so it takes that glass's --line: a var() in a custom property is read where it's set. */
  --divider: 1px solid var(--line);
  --toggle-off: rgba(60, 72, 94, 0.2); --tag-new: rgba(34, 160, 90, 0.26); --tag-new-ink: #0A5A2C; --tag-warning: rgba(232, 150, 20, 0.26); --tag-warning-ink: #6A4300; --tag-plain: rgba(60, 72, 94, 0.1); --tag-carve: inset 0 1px 2px rgba(20, 30, 50, 0.22), inset 0 -1px 0 rgba(255, 255, 255, 0.75); --face-ring: rgba(255, 255, 255, 0.85); --presence-ring: #fff; --online: #3BB273; --picture-shadow: rgba(20, 23, 28, 0.3);
  --rail-line: rgba(20, 23, 28, 0.2); --rail-thumb: rgba(24, 28, 36, 0.55); --rail-edge: rgba(255, 255, 255, 0.55); --rail-mark: rgba(20, 23, 28, 0.45);
  --edge-inner: rgba(255, 255, 255, 0.9); --edge-bevel: 0.4; --edge-rim: 1; --edge-fringe: 0.25;
  --edge-lit: rgba(236, 240, 246, 1); --edge-shade: rgba(146, 154, 168, 0.6); --edge-corner: rgba(188, 196, 208, 0.75);
  --edge-spec: rgba(255, 255, 255, 1); --edge-dense: rgba(120, 130, 146, 0.03);
  --logo-halo: drop-shadow(0 0 10px rgba(255, 255, 255, 0.6)) drop-shadow(0 1px 1px rgba(255, 255, 255, 0.5));
  --link-hover: var(--run-lo); --marked: var(--run-lo);
  --glass-base: 255, 255, 255; --glass-kind: "Light glass, dark words."; --glass-hue-strength: 14%; --track: rgba(186, 198, 216, 0.28);
  --raise-top: rgba(255, 255, 255, 0.95); --raise-left: rgba(255, 255, 255, 0.6); --raise-right: rgba(96, 108, 128, 0.22); --raise-bottom: rgba(70, 82, 104, 0.34);
  --carve-rim: transparent; --carve-top: rgba(60, 72, 94, 0.3); --carve-left: rgba(60, 72, 94, 0.2); --carve-right: rgba(255, 255, 255, 0.55); --carve-bottom: rgba(255, 255, 255, 0.9);
  --backdrop-base: #E6ECF4; --backdrop-a: #B9CBE6; --backdrop-b: #C0DCDB; --backdrop-c: #D2CBEA;`;

const SMOKED_GLASS = `color-scheme: dark;
  --ink: #F7F9FC; --ink-2: rgba(247, 249, 252, 0.86); --muted: rgba(247, 249, 252, 0.7); --line: rgba(255, 255, 255, 0.2);
  --glass-edge: rgba(255, 255, 255, 0.16); --field: rgba(255, 255, 255, 0.08);
  --glass-tint: rgba(14, 17, 24, 0.55); --glass-top: rgba(18, 21, 27, 0.5); --glass-dropdown: rgba(18, 21, 27, 0.62); --glass-tray: rgba(14, 17, 24, 0.18);
  --glass-sheen: radial-gradient(140% 90% at 0% 0%, rgba(190, 215, 255, 0.12), rgba(190, 215, 255, 0) 55%), linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0) 38%, rgba(0, 0, 0, 0) 70%, rgba(0, 0, 0, 0.03));
  --glass-tray-sheen: radial-gradient(140% 90% at 0% 0%, rgba(190, 215, 255, 0.04), rgba(190, 215, 255, 0) 55%), linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0) 38%, rgba(0, 0, 0, 0) 70%, rgba(0, 0, 0, 0.04));
  --glass-saturate: 1.9; --edge-hair: rgba(0, 0, 0, 0.09);
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
  --clear-hover: rgba(255, 255, 255, 0.08); --clear-press: rgba(255, 255, 255, 0.04); --clear-glass-mark: #fff; --on-light: none; --on-smoked: inline; --divider: 1px solid var(--line);
  --toggle-off: rgba(0, 0, 0, 0.34); --tag-new: rgba(52, 211, 120, 0.2); --tag-new-ink: #A6F0C6; --tag-warning: rgba(245, 176, 40, 0.2); --tag-warning-ink: #F8D68C; --tag-plain: rgba(0, 0, 0, 0.22); --tag-carve: inset 0 1px 2px rgba(0, 0, 0, 0.55), inset 0 -1px 0 rgba(255, 255, 255, 0.14); --face-ring: rgba(6, 8, 12, 0.55); --presence-ring: #1A1D24; --online: #3BB273; --picture-shadow: rgba(0, 0, 0, 0.55);
  --rail-line: rgba(255, 255, 255, 0.2); --rail-thumb: rgba(255, 255, 255, 0.55); --rail-edge: rgba(255, 255, 255, 0.35); --rail-mark: rgba(255, 255, 255, 0.5);
  /* A light rim on dark glass stands out far more than on light glass, so smoked glass draws it fainter to look as tame. */
  --edge-inner: rgba(255, 255, 255, 0.16); --edge-bevel: 0.14; --edge-rim: 0.38; --edge-fringe: 0.12;
  --edge-lit: rgba(220, 228, 242, 0.55); --edge-shade: rgba(140, 152, 176, 0.05); --edge-corner: rgba(196, 206, 224, 0.26);
  --edge-spec: rgba(255, 255, 255, 0.4); --edge-dense: rgba(255, 255, 255, 0.015);
  --logo-halo: drop-shadow(0 0 12px rgba(4, 7, 14, 0.75)) drop-shadow(0 1px 2px rgba(4, 7, 14, 0.6));
  --link-hover: var(--run-hi); --marked: var(--run-hi);
  --glass-base: 14, 17, 24; --glass-kind: "Smoked glass, light words."; --glass-hue-strength: 22%; --track: rgba(255, 255, 255, 0.08);
  --raise-top: rgba(255, 255, 255, 0.42); --raise-left: rgba(255, 255, 255, 0.22); --raise-right: rgba(0, 0, 0, 0.3); --raise-bottom: rgba(0, 0, 0, 0.5);
  --carve-rim: rgba(255, 255, 255, 0.16); --carve-top: rgba(0, 0, 0, 0.5); --carve-left: rgba(0, 0, 0, 0.32); --carve-right: rgba(255, 255, 255, 0.1); --carve-bottom: rgba(255, 255, 255, 0.2);
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
@property --tint-color { syntax: "<color>"; inherits: false; initial-value: transparent; }
@property --tint-pct { syntax: "<percentage>"; inherits: false; initial-value: 0%; }
/* Registered, so a change of hue eases over half a second, like a change of theme, instead of cutting. */
@property --glass-hue { syntax: "<color>"; inherits: true; initial-value: transparent; }
/* The tint a piece of glass shows right now, faded towards its --glass-tint. A registered color fades in the page itself, so the browser
   never lifts the glass onto a layer of its own for the fade and drops it at the end, which flashed blurred glass as a fade finished. */
@property --glass-shown-tint { syntax: "<color>"; inherits: false; initial-value: transparent; }
/* A control's face color, the same way: every control that changes color (a hover, a press, light to dark) sets --face-color and
   fades it, never its background, so no control flashes as a fade ends. design.test.ts checks that nothing fades a background. */
@property --face-color { syntax: "<color>"; inherits: false; initial-value: transparent; }
/* Scroll fades (navigation.ts's SCROLL_FADE_SCRIPT): a box that scrolls fades its words over an edge while there's more that way, easing in and out. */
@property --fade-top { syntax: "<length>"; inherits: false; initial-value: 0px; }
@property --fade-bottom { syntax: "<length>"; inherits: false; initial-value: 0px; }
.scroll-fades.is-fading { -webkit-mask-image: linear-gradient(to bottom, transparent, #000 var(--fade-top), #000 calc(100% - var(--fade-bottom)), transparent);
  mask-image: linear-gradient(to bottom, transparent, #000 var(--fade-top), #000 calc(100% - var(--fade-bottom)), transparent); transition: --fade-top 0.2s, --fade-bottom 0.2s; }
/* A row that scrolls sideways (data-fades-sideways: a header's tabs, the gallery's groups on a phone) fades out over a side with more past it,
   easing in and out, with no scrollbar; it starts scrolled to the one you're on, and never scrolls up and down. */
@property --fade-left { syntax: "<length>"; inherits: false; initial-value: 0px; }
@property --fade-right { syntax: "<length>"; inherits: false; initial-value: 0px; }
/* A box that scrolls keeps a swipe to itself: reaching its end never carries on into the page, so the page never nudges under it. */
.scroll-fades, [data-scroll-box] { overscroll-behavior: contain; }
[data-fades-sideways] { overscroll-behavior-x: contain; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; transition: --fade-left 0.25s, --fade-right 0.25s; }
[data-fades-sideways]::-webkit-scrollbar { display: none; }
[data-fades-sideways].more-left, [data-fades-sideways].more-right {
  -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 var(--fade-left), #000 calc(100% - var(--fade-right)), transparent 100%);
  mask-image: linear-gradient(90deg, transparent 0, #000 var(--fade-left), #000 calc(100% - var(--fade-right)), transparent 100%); }
/* How far in it fades: 28px, or a row's own --fade-sideways-px (a row of covers fades further). */
[data-fades-sideways].more-left { --fade-left: var(--fade-sideways-px, 28px); }
[data-fades-sideways].more-right { --fade-right: var(--fade-sideways-px, 28px); }
/* A row of controls, slanting where they meet, their slants --gap-control-row apart. In a pane it fills the pane's width, its
   controls sharing it, so its ends fit the pane's edges (the edge rule) instead of stopping short with square corners. */
/* A gap can't be negative, so each control but the last reaches back over the next by a margin; a row that wraps starts each line flush. */
.control-row { display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--gap-control-stack) 0; }
.control-row > :not(:last-child) { margin-inline-end: var(--gap-control-row-boxes); }
[data-glass] .control-row > .shell { display: flex; flex: 1 1 0; min-width: 0; }
[data-glass] .control-row > .shell > .face { width: 100%; justify-content: center; }
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
  /* The glass's hue (PageSettings' glass.hueColor): tints every piece of glass under where it's set. Glass tinted for a brand keeps its own color. */
  --glass-hue: transparent;
  --display: "Jost", Futura, "Century Gothic", "Avenir Next", sans-serif;
  --body: -apple-system, "Segoe UI", system-ui, sans-serif;
  --spring: cubic-bezier(.3, 1.2, .4, 1);
  /* Keyboard focus, the same on everything: orange. A control's cut line is stroked --focus-stroke wide (half of it shows inside
     its cut, 2px), anything else gets a 2px outline. On an orange face (the runner) it's the deeper --focus-on-run. */
  --focus: var(--run); --focus-on-run: var(--run-lo); --focus-stroke: 4;
  /* Spacing (docs/DESIGN.md, Spacing): every gap, padding and margin is one of these, picked by what sits on each side.
     Side by side, controls slant toward each other by --control-slant, and --gap-control-row is the space between the slants: their
     boxes sit --gap-control-row-boxes apart, overlapping by the slant less that. That's also the edge rule's neighbor distance. */
  --control-slant: 10px;
  --gap-control-row: 4px;
  --gap-control-row-boxes: calc(var(--gap-control-row) - var(--control-slant));
  --gap-control-stack: 8px;
  --gap-words-control: 8px;
  --gap-words-words: 8px;
  --gap-block-block: 24px;
  --pad-pane: 24px;
  --pad-inner-pane: 12px;
  --pad-tray: 16px;
  /* Type (docs/DESIGN.md, Type): every word outside a control's own inside takes one of these whole fonts, picked by what the words are. */
  --type-title: 600 40px/1.04 var(--display);
  --type-heading: 600 30px/1.1 var(--display);
  --type-section: 600 22px/1.2 var(--display);
  --type-name: 600 17px/1.3 var(--display);
  --type-label: 600 15px/1.3 var(--display);
  --type-words: 500 15px/1.35 var(--display);
  --type-reading: 400 15px/1.5 var(--body);
  --type-note: 500 14px/1.4 var(--display);
  --type-facts: 500 13px/1.3 var(--display);
  --type-tag: 600 12px/1 var(--display);
  --type-code: 600 13px/1.3 ui-monospace, Menlo, monospace;
}
@media (max-width: 760px) { :root { --pad-pane: 18px; --type-title: 600 32px/1.04 var(--display); --type-heading: 600 26px/1.1 var(--display); --type-section: 600 20px/1.2 var(--display); } }
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
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* The glass: one look for every piece of it, at any size, defined here once. Anything made of glass has the class glass and
   nothing else paints it: it's a tint (--glass-tint, which a component may set to its own, like the header's --glass-top),
   a layer over the tint a component may set (--glass-layer, a glass button's brand color), the page's hue (--glass-wash),
   the light on it (--glass-sheen: brightest at its top left, a little shade along its foot), the blur and color of what's
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
/* On smoked glass a carving's shaded top and left are dark on dark, so a faint light line traces its outer edge all round: the cut reads at
   its edge on every side, not at what's inside it. Light glass needs none (--carve-rim is transparent there). Half the stroke is clipped away. */
.cut-carved > .cut-line polygon { stroke: var(--carve-rim); stroke-width: 2; }
/* Orange is always shown in full, so a slab's shade never falls on its orange underline. */
.slab.cut-raised > .cut-line { --band-bottom: transparent; }
.cut-line .cut-band.on-top { fill: var(--band-top, transparent); } .cut-line .cut-band.on-left { fill: var(--band-left, transparent); }
.cut-line .cut-band.on-right { fill: var(--band-right, transparent); } .cut-line .cut-band.on-bottom { fill: var(--band-bottom, transparent); }
/* A nested corner's cut faces two ways, so it takes half of each side's light. */
.cut-line .cut-band.on-top-right { fill: color-mix(in srgb, var(--band-top, transparent), var(--band-right, transparent)); }
.cut-line .cut-band.on-bottom-right { fill: color-mix(in srgb, var(--band-bottom, transparent), var(--band-right, transparent)); }
.cut-line .cut-band.on-bottom-left { fill: color-mix(in srgb, var(--band-bottom, transparent), var(--band-left, transparent)); }
.cut-line .cut-band.on-top-left { fill: color-mix(in srgb, var(--band-top, transparent), var(--band-left, transparent)); }
/* Line icons: drawn with the words' color. */
.ico { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.ico.solid { fill: currentColor; stroke: none; }
.ico .on-light { display: var(--on-light); }
.ico .on-smoked { display: var(--on-smoked); }
`;

const stroke = (viewBox: string, paths: string, extra = "") => `<svg class="ico" viewBox="${viewBox}" aria-hidden="true"${extra}>${paths}</svg>`;

/** Every line icon the drafts use. Each is drawn in the words' color (.ico). */
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
  // The sun on light glass, the moon on smoked (--on-light and --on-smoked): the theme a page is in.
  "light-dark": stroke(
    "0 0 20 20",
    '<g class="on-light"><circle cx="10" cy="10" r="3.6"/><path d="M10 1.8v2.4M10 15.8v2.4M1.8 10h2.4M15.8 10h2.4M4.2 4.2l1.7 1.7M14.1 14.1l1.7 1.7M4.2 15.8l1.7-1.7M14.1 5.9l1.7-1.7"/></g><g class="on-smoked"><path d="M15.5 12.6A6.6 6.6 0 0 1 7.4 4.5a6.6 6.6 0 1 0 8.1 8.1z"/></g>',
    ' stroke-width="1.8"',
  ),
  trash: stroke("0 0 20 20", '<path d="M3.5 5.5h13M8 5.5V3.5h4v2M5.2 5.5l.8 11h8l.8-11"/><path d="M8.5 8.6v5M11.5 8.6v5"/>'),
  close: stroke("0 0 20 20", '<path d="M5 5l10 10M15 5 5 15"/>', ' stroke-width="1.8"'),
  check: stroke("0 0 20 20", '<path d="M4.2 10.4l3.9 3.9 7.7-8.6"/>', ' stroke-width="2.2"'),
  copy: stroke("0 0 20 20", '<path d="M7 7h9.5v9.5H7z"/><path d="M13 7V3.5H3.5V13H7"/>'),
  warning: stroke("0 0 20 20", '<path d="M10 2.8 18.2 17H1.8z"/><path d="M10 8v4.2M10 14.6v.1"/>'),
  passkey: stroke("0 0 24 24", '<circle cx="8" cy="9" r="4"/><path d="M2 20c0-3.3 2.7-6 6-6 1.5 0 2.9.6 4 1.5"/><circle cx="17.5" cy="13.5" r="2.5"/><path d="M17.5 16v5M17.5 19h2"/>', ' stroke-width="1.7"'),
  // Filled arrows, for scrolling a row back and on.
  "arrow-back": '<svg class="ico solid" viewBox="0 0 12 16" aria-hidden="true"><path d="M12 0H7L0 8l7 8h5L5 8z"/></svg>',
  "arrow-on": '<svg class="ico solid" viewBox="0 0 12 16" aria-hidden="true"><path d="M0 0h5l7 8-7 8H0l7-8z"/></svg>',
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

/** Zaisma's wordmark and mark, drawn in the words' color (brand/zaisma-wordmark-black.svg, brand/zaisma-mark-black.svg). */
const MARK_PATHS = '<path d="M1884.08,3033.91c767.645,0 1535.29,0 2302.930,0c33.233,248.238 66.466,496.475 99.699,744.712l-4286.71,-0c627.367,-243.599 1255.990,-491.890 1884.080,-744.712Z"/><path d="M415.598,3484.54c777.297,-719.363 1475.76,-1400.24 2108.05,-2044.32c404.715,-158.588 821.55,-323.759 1248.51,-495.17c-547.607,610.584 -1151.51,1254.04 -1823.08,1932.14c-520.17,209.105 -1032.22,411.7 -1533.48,607.345Z"/><path d="M2575.7,1305.06l-1740.58,0c21.608,-194.559 43.215,-389.119 64.823,-583.678l3147.9,0c-485.752,195.366 -976.426,389.899 -1472.14,583.678Z"/>';
export const WORDMARK = raw(
  `<svg viewBox="-120 1080 9988 2820" role="img" aria-label="Zaisma"><g fill="currentColor"><g transform="translate(0 3779) scale(0.62132) translate(0 -3779)">${MARK_PATHS}</g><g transform="translate(-1953 0)"><path d="M4957,1879 L5877,1879 L6132,3779 L5212,3779 L4837,3449 L4765,2909 L5051,2579 L5601,2579 L5557,2249 L4677,2249 Z M5140,2949 L5650,2949 L5712,3409 L5202,3409 Z" fill-rule="evenodd"/><path d="M6077,1879 L6447,1879 L6702,3779 L6332,3779 Z M5991,1239 L6541,1239 L6412,1619 L6042,1619 Z" fill-rule="evenodd"/><path d="M6647,1879 L7847,1879 L7667,2249 L7067,2249 L7120,2644 L7950,2644 L8102,3779 L6902,3779 L7082,3409 L7682,3409 L7629,3014 L6799,3014 Z" fill-rule="evenodd"/><path d="M8091,2209 L8377,1879 L9997,1879 L10252,3779 L9882,3779 L9677,2249 L9257,2249 L9462,3779 L9092,3779 L8887,2249 L8467,2249 L8672,3779 L8302,3779 Z" fill-rule="evenodd"/><path d="M10527,1879 L11447,1879 L11702,3779 L10782,3779 L10407,3449 L10335,2909 L10621,2579 L11171,2579 L11127,2249 L10247,2249 Z M10710,2949 L11220,2949 L11282,3409 L10772,3409 Z" fill-rule="evenodd"/></g></g></svg>`,
);
export const MARK = raw(`<svg viewBox="-120 600 4527 3300" aria-hidden="true"><g fill="currentColor">${MARK_PATHS}</g></svg>`);

export const PANE_SIZES = { small: 320, medium: 480, large: 720 } as const;

export interface GlassPaneOptions {
  paneSize: "small" | "medium" | "large" | "full";
  body: Raw;
  /** Cut corners: top left, top right, bottom right, bottom left. Panes are 24 and 20. */
  corners?: [number, number, number, number];
  label?: string;
}

/** A pane of Zaisma's glass (panes.ts's Glass pane shows it): cut corners, a drawn rim, clear glass. Long content scrolls inside it, so nothing in it shrinks. */
export function glassPane(options: GlassPaneOptions): Raw {
  const corners = (options.corners ?? [24, 20, 24, 20]).join(" ");
  const pane = html`<section class="glass glass-pane ${options.paneSize}" data-glass data-glass-corners="${corners}"${options.label ? html` aria-label="${options.label}"` : ""}>${EDGE}<div class="pane-in">${options.body}</div></section>`;
  return pane;
}

/**
 * A tray: a thinner, clearer sheet of glass that a pane extends into, holding a whole area under it, so what's in the area reads as one
 * with its head (the gallery's sections: a head of words, then every example on the tray). The head's bottom corners and the tray's top
 * ones are square where they meet, and the tray has no rim along its top: it runs straight on from the pane (data-glass-open). It's the
 * same glass, light or smoked, only thinner: a clearer tint and a fainter rim, its bevel as wide. What sits on a tray fits it like
 * anything on a pane: square under its square top, cut at an even gap into its cut foot.
 * Its padding (--pad-tray) is closer than a pane's and its foot's cuts smaller (16 and 12), still clear of what sits in its corners.
 */
export function tray(options: { head: Raw; body: Raw; label?: string }): Raw {
  return html`<section class="tray-group"${options.label ? html` aria-label="${options.label}"` : ""}><div class="glass tray-head" data-glass data-glass-corners="24 20 0 0">${EDGE}${options.head}</div><div class="glass tray" data-glass data-glass-open="top" data-glass-corners="0 0 16 12">${EDGE}${options.body}</div></section>`;
}

/** Zaisma's logo, a link home: the wordmark (the header, the gallery's bar) or the mark alone (the footer). --logo-height sets its size. */
export const logo = (kind: "wordmark" | "mark"): Raw =>
  html`<a class="logo ${kind}" href="/" aria-label="Zaisma home">${kind === "wordmark" ? WORDMARK : MARK}</a>`;

/** The loader: the Z building itself, one loop a second (brand/loader/zaisma-loader.svg), in the words' color. Shown only once something was pressed. */
export const loader = (): Raw => raw('<span class="loader" aria-hidden="true"></span>');

/** Zaisma's own scrollbar (navigation.ts's rail, RAIL_SCRIPT): "box" for a box that scrolls (it goes just after it), "page" for the page. */
export const railMarkup = (scrollKind: "box" | "page"): Raw => raw(`<div class="rail" data-rail="${scrollKind}" aria-hidden="true"><div class="rail-line"></div><div class="rail-thumb glass"></div></div>`);

/** A tag: a few words or a number, slanted at both ends, on what it labels. "new" is green (Updated), "count" the buttons' face (unread topics, or plain words), "warning" amber (Held, Over the limit), "glass" a sliver of the menus' glass (the rail's labels). data.ts's Tag shows it. */
export type TagTone = "new" | "count" | "warning" | "glass";
export const tag = (words: string | number, tone: TagTone): Raw => html`<span class="tag ${tone}${tone === "glass" ? " glass" : ""}">${String(words)}</span>`;

export interface ColorChoice {
  /** What it's called, said by a screen reader and shown beside the picker when it's picked. */
  name: string;
  /** The value a page script reads (data-color-value). */
  colorValue: string;
  /** What the swatch shows: a color, or "clear" for a checker (see-through, or none). */
  swatch: string;
}

/** A color picker (inputs.ts's Color picker shows it): a row of cut swatches that slant toward each other, the picked one outlined in ink, its name beside them. */
export function colorPicker(options: { label: string; choices: ColorChoice[]; pickedValue: string; extra?: Raw }): Raw {
  const picked = options.choices.find((choice) => choice.colorValue === options.pickedValue);
  return html`<div class="color-picker" role="group" aria-label="${options.label}"${options.extra ?? ""}>${options.choices.map(
    (choice) =>
      html`<button type="button" class="color-pick" data-cut-line="6" data-color-value="${choice.colorValue}" aria-label="${choice.name}" aria-pressed="${choice === picked ? "true" : "false"}" style="--swatch:${choice.swatch === "clear" ? "var(--clear-swatch)" : choice.swatch}">${CUT_LINE}</button>`,
  )}<span class="color-picker-name" aria-live="polite">${picked?.name ?? ""}</span></div>`;
}

/** A pick moves the outline and the name; what the color changes is the page's own script's (it reads data-color-value). */
export const COLOR_PICKER_SCRIPT = `/* color pickers */(function () {
  document.addEventListener("click", function (event) {
    var pick = event.target.closest && event.target.closest(".color-pick"); if (!pick) return;
    var picker = pick.closest(".color-picker");
    picker.querySelectorAll(".color-pick").forEach(function (each) { each.setAttribute("aria-pressed", String(each === pick)); });
    picker.querySelector(".color-picker-name").textContent = pick.getAttribute("aria-label");
  });
})();
`;

export interface SheetMarkupOptions {
  /** Unique on the page: what opens it names it (aria-controls). */
  id: string;
  title: string;
  body: Raw;
  /** Its close button (actions.ts's cutButton, small and only its icon), in a form that closes the sheet without a script. */
  closeButton: Raw;
  /** Shown in place, not over the page: the gallery's still copies. */
  isShown?: boolean;
}

/**
 * A sheet (panes.ts's Sheet shows it): a <dialog> of the panes' glass over the dimmed page, with its title and a close button at its
 * top. Its buttons come from actions.ts, so the markup is shared here, where both actions.ts (a delete's confirm step) and panes.ts
 * can reach it. SHEET_SCRIPT opens it from any button that names it (aria-controls); Esc and its close button close it natively.
 */
export function sheetMarkup(options: SheetMarkupOptions): Raw {
  return html`<dialog class="sheet glass${options.isShown ? " in-place" : ""}" id="${options.id}" aria-labelledby="${options.id}-title" data-glass data-glass-corners="24 20 24 20"${options.isShown ? raw(" open") : ""}>${EDGE}<div class="sheet-in"><div class="sheet-head"><h2 class="sheet-title" id="${options.id}-title">${options.title}</h2><form class="sheet-close" method="dialog">${options.closeButton}</form></div>${options.body}</div></dialog>`;
}

/** An outline for a cut field or button (GLASS_SCRIPT draws it), and a slab's drawn rim. */
export const CUT_LINE = raw('<svg class="cut-line" aria-hidden="true"><polygon/></svg>');
export const EDGE = raw('<svg class="edge" aria-hidden="true"></svg>');

/**
 * glass(el, corners) and cutLine(el), from the header draft, as window.zaismaGlass and window.zaismaCutLine.
 * On load, and for elements added later, they're applied to every [data-glass] (corners from data-glass-corners,
 * like "20 14 20 14") and every [data-cut-line] (a control: its slant, where it has one, in its value).
 */
export const GLASS_SCRIPT = `/* glass */(function () {
  var SVG = "http://www.w3.org/2000/svg";
  /* The sign-in pane's glass, for any slab: cut corners and the drawn rim (dark hairline, polished edge, bevel band, faint rainbow fringe, bright cut facets). */
  function cutPoints(w, h, c, inset) {
    // A corner that isn't cut stays square all the way in, so its bands meet in a plain mitre, not a facet of their own.
    var i = inset, k = inset * 0.414, d = c.map(function (cut) { return cut > 0 ? cut + k : i; });
    return [[i, d[0]], [d[0], i], [w - d[1], i], [w - i, d[1]], [w - i, h - d[2]], [w - d[2], h - i], [d[3], h - i], [i, h - d[3]]];
  }
  function pointList(points) { return points.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" "); }
  // How lit each side of the cut is, from the top left corner's cut round to the left side. Neighbors always differ, so every turn of the edge shows as a step in brightness, like a cut facet.
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
        // A plain line on the rim, unseen until a tinted or focused slab colors it.
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
        var shape = distinct(controlOutline(el, w, h)), key = w + "x" + h + ":" + pointList(shape);
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
        // An open side (data-glass-open="top", a tray under its pane) draws its rim past the slab, where the clip hides it, so the glass runs straight on into what's above.
        var reach = el.getAttribute("data-glass-open") === "top" ? Math.ceil(band * 1.6) + 2 : 0;
        at = function (inset) { return cutPoints(w, h + reach, c, inset).map(function (p) { return [p[0], p[1] - reach]; }); };
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
      // Dispersion: a faint split of color along the facet's inner edge, where the light bends.
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
   *   side by side with their boxes --gap-control-row-boxes apart. Both slant by --control-slant, so the gap between the slants is
   *   parallel, --gap-control-row wide. Stacked, on no pane, they're --gap-control-stack apart.
   * - Every other corner fits what holds it (the glass pane, or a control it sits in): it takes the holder's outline moved
   *   in by the gap round it, so the gap stays even. Near a corner of the pane that's the pane's cut, less the gap; along a
   *   straight edge, or in the middle, it's square. A control alone in a pane fits it at its top and its bottom.
   * - A control on no pane is shaped as if it were in a pane, flush to it: a pane's corners at its own size, except where another
   *   control on no pane is stacked right above or below it (the pane would hold them both), where it's square.
   * The shape goes to CSS as --cut-shape, and el.cutCorners holds its corners for what sits inside it.
   */
  // Half a pixel over the token, for gaps a layout rounds.
  var rootCss = getComputedStyle(document.documentElement), token = function (name, fallback) { return parseFloat(rootCss.getPropertyValue(name)) || fallback; };
  var SLANT_PX = token("--control-slant", 10), ROW_GAP_PX = token("--gap-control-row", 4), STACK_GAP_PX = token("--gap-control-stack", 8);
  // Neighbors side by side overlap their boxes by the slant less the row's gap (half a pixel either way, for gaps a layout rounds).
  var BESIDE_MIN_PX = ROW_GAP_PX - SLANT_PX - 0.5, BESIDE_MAX_PX = ROW_GAP_PX - SLANT_PX + 0.5, LONE_CORNERS = [16, 8, 16, 8];
  function glassCorners(pane) {
    var cuts = (pane.getAttribute("data-glass-corners") || "20 14 20 14").trim().split(/ +/).map(Number), short = Math.min(pane.offsetWidth, pane.offsetHeight);
    return cuts.map(function (cut) { return Math.min(cut, Math.round(short * 0.3)); });
  }
  // What holds a control: the nearest pane, tray or control round it. data-on-no-pane stops the search (a gallery example's stage:
  // what's shown in it is shown on no pane, even when the stage sits on a tray).
  function holderOf(el) { var found = el.parentElement && el.parentElement.closest("[data-glass], [data-cut-line], [data-on-no-pane]"); return found && !found.hasAttribute("data-on-no-pane") ? found : null; }
  // The corner cuts each corner takes from what holds it: the holder's outline, moved in by the gap. data-cut-ends="start", "end"
  // or "start end": that end follows the holder's end wherever it sits along it, its gap there taken as its gap from the top and
  // bottom (a switch's slab on its first or last tab, as the tabs scroll).
  // data-cut-stack="first", "last", "first last" or "": a part of a vertical stack (a vertical switch's slab): its top follows the holder's top
  // only on the first, its bottom only on the last, at its gap from the sides, wherever it sits as it moves; between, it's square.
  // as: { beside, ends, stack } stands in for data-cut-beside, data-cut-ends and data-cut-stack, for the shape a part had before it moved (a glide).
  function fitCuts(el, w, h, as) {
    var holder = holderOf(el);
    if (!holder) {
      var stack = stacked(el);
      return LONE_CORNERS.map(function (cut, i) { return (i < 2 ? stack.above : stack.below) ? 0 : Math.min(cut, Math.round(Math.min(w, h) * 0.25)); });
    }
    var c = holder.hasAttribute("data-cut-line") ? holder.cutCorners || [0, 0, 0, 0] : glassCorners(holder);
    var r = el.getBoundingClientRect(), p = holder.getBoundingClientRect(), ends = as ? as.ends : el.getAttribute("data-cut-ends") || "";
    var top = r.top - p.top, bottom = p.bottom - r.bottom, stackAt = as ? as.stack : el.getAttribute("data-cut-stack");
    if (stackAt !== null && stackAt !== undefined) { var side = r.left - p.left; top = /first/.test(stackAt) ? side : 1e6; bottom = /last/.test(stackAt) ? side : 1e6; }
    var left = /start/.test(ends) ? (top + bottom) / 2 : r.left - p.left, right = /end/.test(ends) ? (top + bottom) / 2 : p.right - r.right;
    return [[left, top], [right, top], [right, bottom], [left, bottom]].map(function (gaps, i) {
      var sum = Math.max(0, gaps[0]) + Math.max(0, gaps[1]);
      return Math.max(0, (c[i] || 0) - sum + Math.SQRT2 * sum / 2);
    });
  }
  // Which ends have another control right beside them. data-cut-beside="start", "end", "start end" or "" says so instead (a switch's
  // slab: the tabs beside it aren't controls of their own).
  function besides(el, as) {
    var declared = as ? as.beside : el.getAttribute("data-cut-beside");
    if (declared !== null) return { start: /start/.test(declared), end: /end/.test(declared) };
    var holder = holderOf(el), r = el.getBoundingClientRect(), found = { start: false, end: false };
    (holder || document).querySelectorAll("[data-cut-line]").forEach(function (other) {
      if (other === el || other.contains(el) || el.contains(other) || holderOf(other) !== holder) return;
      var o = other.getBoundingClientRect(); if (!o.width || !o.height) return;
      if (Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top) < Math.min(r.height, o.height) / 2) return;
      var after = o.left - r.right, before = r.left - o.right;
      if (after >= BESIDE_MIN_PX && after <= BESIDE_MAX_PX) found.end = true;
      if (before >= BESIDE_MIN_PX && before <= BESIDE_MAX_PX) found.start = true;
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
      if (below >= -1 && below <= STACK_GAP_PX + 0.5) found.below = true;
      if (above >= -1 && above <= STACK_GAP_PX + 0.5) found.above = true;
    });
    return found;
  }
  // The outline, clockwise from the top left.
  function controlShape(w, h, slant, cuts, beside) {
    // Always two points a corner, the same one twice where it's square or slanted, so any two shapes blend point for point (a glide).
    var s = Math.min(slant, w / 3), c = cuts.map(function (cut) { return Math.min(cut, h / 2); });
    var corner = function (cut, a, b, sharp) { return cut > 0.5 ? [a, b] : [sharp, sharp]; };
    return [].concat(
      beside.start ? [[s, 0], [s, 0]] : corner(c[0], [0, c[0]], [c[0], 0], [0, 0]),
      beside.end ? [[w, 0], [w, 0]] : corner(c[1], [w - c[1], 0], [w, c[1]], [w, 0]),
      beside.end ? [[w - s, h], [w - s, h]] : corner(c[2], [w, h - c[2]], [w - c[2], h], [w, h]),
      beside.start ? [[0, h], [0, h]] : corner(c[3], [c[3], h], [0, h - c[3]], [0, h]));
  }
  function controlOutline(el, w, h, as) {
    var beside = besides(el, as), cuts = fitCuts(el, w, h, as);
    el.cutCorners = [beside.start ? 0 : cuts[0], beside.end ? 0 : cuts[1], beside.end ? 0 : cuts[2], beside.start ? 0 : cuts[3]].map(function (cut) { return Math.min(cut, h / 2); });
    // A control's own parts (a switch's slab, data-cut-beside) keep their own slant; controls beside each other share --control-slant.
    return controlShape(w, h, el.hasAttribute("data-cut-beside") ? Number(el.getAttribute("data-cut-line")) || SLANT_PX : SLANT_PX, cuts, beside);
  }
  // The shape drawn: repeated points dropped, so every side drawn has a length.
  function distinct(points) {
    return points.filter(function (p, i) { var q = points[(i + points.length - 1) % points.length]; return Math.abs(p[0] - q[0]) > 0.01 || Math.abs(p[1] - q[1]) > 0.01; });
  }
  function cssPolygon(points) { return "polygon(" + points.map(function (p) { return p[0].toFixed(2) + "px " + p[1].toFixed(2) + "px"; }).join(", ") + ")"; }
  // The same outline moved inward by d on every side: each side's line shifted along its inner normal, meeting its neighbors.
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
    // A glide: a part moving to another place (a switch's slab) blends from the shape it had there to its new one as it goes,
    // over the same time as its move, instead of taking the new shape before it has left.
    var glide = null;
    function draw() {
      var w = el.offsetWidth, h = el.offsetHeight; if (!w || !h) return;
      var shape = controlOutline(el, w, h);
      if (glide) {
        var t = Math.min(1, (performance.now() - glide.startMs) / glide.ms), eased = 1 - Math.pow(1 - t, 3), from = controlOutline(el, w, h, glide.from);
        shape = shape.map(function (p, i) { return [from[i][0] + (p[0] - from[i][0]) * eased, from[i][1] + (p[1] - from[i][1]) * eased]; });
        if (t < 1) requestAnimationFrame(draw); else glide = null;
      }
      shape = distinct(shape);
      var key = w + "x" + h + ":" + list(shape);
      if (key === last) return;
      last = key;
      el.style.setProperty("--cut-shape", cssPolygon(shape));
      svg.setAttribute("viewBox", "0 0 " + w + " " + h);
      poly.setAttribute("points", list(insetShape(shape, 1)));
      // The raised or carved light: a 1.5px band along each side. data-cut-inset moves it inward, inside an outline drawn round the edge.
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
    // redrawCut() draws it again; redrawCut({ from: { beside, ends }, ms }) glides there from the shape those attributes gave.
    el.redrawCut = function (move) {
      if (move && move.ms > 0 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) glide = { from: move.from, ms: move.ms, startMs: performance.now() };
      draw();
    };
    if (window.ResizeObserver) {
      var watch = new ResizeObserver(draw); watch.observe(el);
      var holder = el.parentElement && el.parentElement.closest("[data-glass], [data-on-no-pane]"); if (holder && holder.hasAttribute("data-glass")) watch.observe(holder);
    }
    window.addEventListener("resize", draw);
    // Where it sits can change without its size changing: once the fonts are in, the layout has settled.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
  }
  // The page's settings (PageSettings), changed in place for the whole page or under one element. Only what's given changes:
  // { theme: "light" | "dark" | null } and { glass: { hueColor: "#rrggbb" | null } }, null going back to the default.
  window.zaismaSettings = {
    set: function (settings, element) {
      var target = element || document.documentElement;
      target.classList.add("eases-settings");
      if (settings.theme !== undefined) { if (settings.theme === "light" || settings.theme === "dark") target.setAttribute("data-theme-choice", settings.theme); else target.removeAttribute("data-theme-choice"); }
      var glass = settings.glass;
      if (glass && glass.hueColor !== undefined) { if (typeof glass.hueColor === "string" && /^#[0-9a-fA-F]{6}$/.test(glass.hueColor)) target.style.setProperty("--glass-hue", glass.hueColor); else target.style.removeProperty("--glass-hue"); }
    },
    read: function (element) {
      var target = element || document.documentElement, hue = target.style.getPropertyValue("--glass-hue").trim();
      return { theme: target.getAttribute("data-theme-choice") || null, glass: { hueColor: hue || null } };
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
      var corners = (el.getAttribute("data-glass-corners") || "24 20 24 20").split(/\\s+/).map(Number);
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
 * Zaisma's own backdrop shader: three soft lights in the theme's backdrop colors drifting very slowly, crossed by wide
 * diagonal facets a step brighter or darker, the cut shape at the scale of the page. Any page's own fragment shader gets
 * the same uniforms: u_resolution (pixels), u_time (seconds), u_base, u_a, u_b, u_c (the theme's --backdrop-* colors) and u_dark (1 on dark).
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
  vec3 color = u_base;
  color = mix(color, u_a, 0.9 * light(p, vec2(aspect * (0.22 + 0.12 * sin(s * 1.3)), 0.72 + 0.12 * cos(s * 1.7)), 0.6));
  color = mix(color, u_b, 0.8 * light(p, vec2(aspect * (0.78 + 0.1 * cos(s * 1.1)), 0.32 + 0.15 * sin(s * 0.9)), 0.55));
  color = mix(color, u_c, 0.75 * light(p, vec2(aspect * (0.52 + 0.18 * sin(s * 0.7 + 2.0)), 0.95 + 0.1 * sin(s * 1.5)), 0.5));
  float facet = floor((p.x * 0.7 + p.y) * 1.4 + s * 0.5);
  color += (hash(vec2(facet, 3.0)) - 0.5) * mix(0.045, 0.03, u_dark);
  color += (hash(gl_FragCoord.xy + fract(u_time)) - 0.5) / 128.0;
  gl_FragColor = vec4(color, 1.0);
}`;

/**
 * Backdrops: every canvas[data-backdrop] on a page. "shader" draws a fragment shader (the page's own in data-backdrop-shader,
 * or Zaisma's), "scene" leaves the drawing to the page: each frame the canvas gets a backdrop-frame event whose detail is
 * { timeS, colors: { base, a, b, c, isDark }, widthPx, heightPx }, and the page draws its 3D scene into the canvas then.
 * Either way this keeps the canvas sized to its box, follows the theme, runs at most 30 frames a second, stops while the page
 * is hidden or the canvas is out of view, and under reduced motion draws one still frame. Without WebGL a shader backdrop
 * keeps its CSS gradient in the same colors.
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
  function readColors(el) {
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
    return function (timeS, colors) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(at.u_resolution, canvas.width, canvas.height); gl.uniform1f(at.u_time, timeS);
      gl.uniform3fv(at.u_base, colors.base); gl.uniform3fv(at.u_a, colors.a); gl.uniform3fv(at.u_b, colors.b); gl.uniform3fv(at.u_c, colors.c);
      gl.uniform1f(at.u_dark, colors.isDark ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
  }
  // A change of theme fades the backdrop's colors over the same half second as the glass's, so the two never part for a frame.
  var FADE_MS = 500;
  function mix(from, to, t) { return from.map(function (value, i) { return value + (to[i] - value) * t; }); }
  function shownColors(layer, nowMs) {
    var t = still.matches || !layer.from ? 1 : Math.min(1, (nowMs - layer.fadeStartMs) / FADE_MS);
    if (t >= 1) { layer.from = null; return layer.target; }
    var eased = t * t * (3 - 2 * t), from = layer.from, to = layer.target;
    return { base: mix(from.base, to.base, eased), a: mix(from.a, to.a, eased), b: mix(from.b, to.b, eased), c: mix(from.c, to.c, eased), isDark: eased < 0.5 ? from.isDark : to.isDark };
  }
  function draw(layer, nowMs) {
    // The wall clock, not the page's own: moving to another page, the backdrop carries on where it was instead of starting over.
    var timeS = still.matches ? 20 : (Date.now() / 1000) % 100000;
    layer.colors = shownColors(layer, nowMs);
    if (layer.drawShader) layer.drawShader(timeS, layer.colors);
    else layer.canvas.dispatchEvent(new CustomEvent("backdrop-frame", { detail: { timeS: timeS, colors: layer.colors, widthPx: layer.canvas.width, heightPx: layer.canvas.height } }));
    layer.isDrawn = !layer.from;
  }
  function frame(nowMs) {
    requestAnimationFrame(frame);
    if (document.hidden || nowMs - lastMs < 33) return;
    lastMs = nowMs;
    layers.forEach(function (layer) { if (layer.isInView && !(still.matches && layer.isDrawn)) draw(layer, nowMs); });
  }
  // The colors are read again whenever the theme might have changed; the fade starts at once, from what's showing, and only when they did change.
  function refresh() {
    var nowMs = performance.now();
    layers.forEach(function (layer) {
      var next = readColors(layer.canvas);
      if (JSON.stringify(next) === JSON.stringify(layer.target)) return;
      layer.from = layer.colors; layer.target = next; layer.fadeStartMs = nowMs; layer.isDrawn = false;
      if (layer.isInView) draw(layer, nowMs);
    });
  }
  function setUp(canvas) {
    if (canvas.backdropLayer) return;
    var isScene = canvas.getAttribute("data-backdrop") === "scene";
    // A shader is soft, so it's drawn at one pixel per CSS pixel; a scene gets the screen's sharpness, up to 2x.
    var layer = { canvas: canvas, isInView: true, isDrawn: false, target: readColors(canvas), from: null, scale: Math.min(window.devicePixelRatio || 1, isScene ? 2 : 1) };
    if (!isScene) { layer.drawShader = shaderDrawer(canvas); if (!layer.drawShader) return; canvas.classList.add("is-drawn"); }
    canvas.backdropLayer = layer;
    // Resizing a canvas clears it, so it's drawn again at once: it never shows a frame of the plain color under it.
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
  // The theme can change in place (a data-theme-choice switch, or the system's), and the colors follow it.
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
  { token: "--tag-new", note: "A new thing's tag" },
  { token: "--danger", note: "A delete's confirm step only" },
];

const swatches = () =>
  glassPane({ paneSize: "full", body: html`<ul class="swatches">${SWATCHES.map(({ token, note }) => html`<li><span class="chip-swatch" data-cut-line="10" style="background:var(${token})">${CUT_LINE}</span><code>${token}</code><span>${note}</span></li>`)}</ul>` });

component({
  name: "Color",
  slug: "color",
  group: "foundations",
  summary: "Every color comes from these tokens, so light, dark and smoked glass follow by themselves. Orange is only for what you act on, and it is always shown in full: never faded or at half opacity.",
  styles: `
/* Color: the gallery's swatches. */
.swatches { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--gap-block-block); }
.swatches li { display: grid; grid-template-columns: 36px 1fr; grid-template-rows: auto auto; column-gap: var(--gap-words-words); align-items: center; font: var(--type-facts); }
/* A swatch is cut by the edge rule like everything else: square in the pane's middle, following its corner where it sits in one. */
.swatches .chip-swatch { position: relative; grid-row: span 2; width: 36px; height: 36px; clip-path: var(--cut-shape); }
.swatches .chip-swatch > .cut-line polygon { stroke: var(--line); }
.swatches code { font: var(--type-code); }
.divider-sample { display: grid; }
.divider-sample strong { font: var(--type-name); }
.divider-sample span { font: var(--type-facts); color: var(--muted); }
.divider-sample p { margin: var(--gap-words-control) 0 0; padding-top: var(--gap-words-control); border-top: var(--divider); font: var(--type-words); color: var(--ink-2); }
.swatches span:last-child { color: var(--muted); }
`,
  examples: [
    { label: "Every token", markup: swatches(), isWide: true },
    {
      label: "The divider: a line between two parts of one pane",
      markup: glassPane({ paneSize: "small", body: html`<div class="divider-sample"><strong>emma_r</strong><span>Online</span><p>Your profile · Friends · Settings</p></div>` }),
    },
  ],
});

/** The type tokens, each with what it's for and a line set in it. */
const TYPE_TOKENS: { token: string; use: string; sample: string; isMuted?: boolean }[] = [
  { token: "--type-title", use: "a game's title", sample: "Ashen Crown" },
  { token: "--type-heading", use: "a pane's heading", sample: "Welcome back" },
  { token: "--type-section", use: "a row, a section", sample: "Continue playing" },
  { token: "--type-name", use: "a name in a pane, a menu's head", sample: "emma_r" },
  { token: "--type-label", use: "a field's label, a question", sample: "When's your birthday?" },
  { token: "--type-words", use: "a line of words, an error", sample: "Liam and Sofia are playing" },
  { token: "--type-reading", use: "a paragraph to read", sample: "A fallen knight climbs a burning kingdom to take its crown back. Hard, fair fights, and a world that folds back on itself." },
  { token: "--type-note", use: "a note under something, a footer", sample: "Zaisma is open source, under the MIT license.", isMuted: true },
  { token: "--type-facts", use: "facts under a cover, a caption, a small heading", sample: "2 hours ago · 1,204 playing", isMuted: true },
  { token: "--type-tag", use: "a Tag", sample: "Updated" },
  { token: "--type-code", use: "a token or a value", sample: "--gap-block-block" },
];

component({
  name: "Type",
  slug: "type",
  group: "foundations",
  summary: "Every word outside a control's own inside is set in one of these, picked by what the words are. Jost for display, the system's own face for reading; fields are 16px or more, so phones don't zoom in.",
  styles: `
/* Type: each token, set in itself. */
.type-sample { width: 100%; list-style: none; margin: 0; padding: 0; display: grid; gap: var(--gap-block-block); color: var(--ink); }
.type-sample li { display: grid; gap: var(--gap-words-words); }
.type-sample code { font: var(--type-code); color: var(--muted); }
.type-sample .is-muted { color: var(--muted); }
.type-sample p { margin: 0; max-width: 60ch; }
`,
  examples: [
    {
      label: "Every token",
      isWide: true,
      markup: html`<ul class="type-sample">${TYPE_TOKENS.map(({ token, use, sample, isMuted }) => html`<li><code>${token}: ${use}</code><p${isMuted ? raw(' class="is-muted"') : ""} style="font:var(${token})">${sample}</p></li>`)}</ul>`,
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
    /** Tints every piece of glass, as a #rrggbb color (like a game's color on the home). Glass tinted for a brand keeps its own color. */
    hueColor?: string;
  };
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** The settings as attributes for <html>. Only a #rrggbb color is taken as a hue, so a game's color can't carry anything else into the page. */
export function pageSettingsAttributes(settings: PageSettings): Raw {
  const hueColor = settings.glass?.hueColor;
  return html`${settings.theme ? html` data-theme-choice="${settings.theme}"` : ""}${hueColor && HEX_COLOR.test(hueColor) ? html` style="--glass-hue:${hueColor}"` : ""}`;
}

const glassStrip = (body: Raw) => html`<div class="glass-strip"><i></i><i></i><i></i>${body}</div>`;

component({
  name: "Glass",
  slug: "glass",
  group: "foundations",
  summary: "Zaisma's interface is glass over the game or the page's backdrop, never over a plain color. It's as thin as the words allow: light with dark words, or smoked with light words.",
  styles: `
/* Glass: shown over a few shapes, so the blur has something to show. */
.glass-strip { width: 100%; position: relative; display: flex; flex-wrap: wrap; gap: var(--gap-block-block); padding: var(--pad-pane); overflow: hidden; }
.glass-strip > i { position: absolute; width: 140px; height: 140px; border-radius: 50%; }
.glass-strip > i:nth-child(1) { left: 6%; top: -30px; background: #F7931A; }
.glass-strip > i:nth-child(2) { left: 38%; top: 40px; width: 220px; height: 90px; border-radius: 0; transform: rotate(-12deg); background: #3B6FD0; }
.glass-strip > i:nth-child(3) { right: 8%; top: 10px; background: #1E9C8E; }
.glass-strip .glass { flex: 1 1 180px; min-height: 110px; padding: var(--pad-pane); font: var(--type-words); }
.glass-strip .glass strong { display: block; font: var(--type-name); }
.glass-strip .glass-kind::after { content: var(--glass-kind); }
/* Any size: one glass window over drifting shapes, to drag about and pull to any size (the gallery's script moves it).
   What's in it gives way as it shrinks, through a container query, so the glass itself never changes. */
.glass-play { position: relative; width: 100%; height: 360px; overflow: hidden; touch-action: none; background: var(--well); box-shadow: var(--well-shade);
  clip-path: polygon(0 24px, 24px 0, calc(100% - 20px) 0, 100% 20px, 100% calc(100% - 24px), calc(100% - 24px) 100%, 20px 100%, 0 calc(100% - 20px)); }
.glass-play > i { position: absolute; display: block; }
.glass-play .sun { left: 8%; top: 40px; width: 150px; height: 150px; border-radius: 50%; background: #F7931A; animation: glass-drift-a 14s ease-in-out infinite alternate; }
.glass-play .bar { left: 34%; top: 150px; width: 260px; height: 70px; background: #3B6FD0; transform: rotate(-14deg); animation: glass-drift-b 18s ease-in-out infinite alternate; }
.glass-play .sea { right: 10%; top: 30px; width: 190px; height: 190px; border-radius: 50%; background: #1E9C8E; animation: glass-drift-c 16s ease-in-out infinite alternate; }
.glass-play .cut { right: 30%; bottom: -30px; width: 160px; height: 120px; background: #E0457B; clip-path: polygon(0 30px, 30px 0, 100% 0, 100% calc(100% - 30px), calc(100% - 30px) 100%, 0 100%); animation: glass-drift-b 20s ease-in-out infinite alternate-reverse; }
.glass-play .dot { left: 22%; bottom: 20px; width: 70px; height: 70px; border-radius: 50%; background: #F4C430; animation: glass-drift-c 12s ease-in-out infinite alternate-reverse; }
@keyframes glass-drift-a { to { transform: translate(90px, 50px); } }
@keyframes glass-drift-b { to { transform: translate(-70px, -40px) rotate(8deg); } }
@keyframes glass-drift-c { to { transform: translate(-60px, 70px); } }
.glass-window { position: absolute; left: 6%; top: 36px; width: min(320px, 80%); height: 200px; container-type: size; padding: var(--pad-pane);
  display: flex; flex-direction: column; gap: var(--gap-words-words); overflow: hidden; cursor: grab; user-select: none; -webkit-user-select: none; touch-action: none; }
.glass-window.is-moving { cursor: grabbing; }
.glass-window:focus-visible { outline: none; }
.glass-window:focus-visible .edge .hair, .glass-window:focus-visible .edge .rim { stroke: var(--focus); stroke-width: 2; }
.glass-window strong { font: var(--type-name); }
.glass-window .glass-note { font: var(--type-note); color: var(--ink-2); }
.glass-window .glass-size { margin-top: auto; font: var(--type-code); color: var(--muted); }
.glass-window .glass-grip { position: absolute; z-index: 4; right: 0; bottom: 0; width: 30px; height: 30px; cursor: nwse-resize; color: var(--muted); }
.glass-window .glass-grip svg { position: absolute; right: 0; bottom: 0; width: 30px; height: 30px; }
@container (max-height: 120px) { .glass-window .glass-note { display: none; } }
@container (max-height: 76px) { .glass-window .glass-size { display: none; } }
@container (max-width: 150px) { .glass-window .glass-note { display: none; } .glass-window strong { font: var(--type-label); } }
@media (prefers-reduced-motion: reduce) { .glass-play > i { animation: none; } }
`,
  examples: [
    {
      label: "Any size: drag it, pull its corner, or use the arrow keys (Shift to resize)",
      isWide: true,
      markup: html`<div class="glass-play" data-glass-play><i class="sun"></i><i class="bar"></i><i class="sea"></i><i class="cut"></i><i class="dot"></i><div class="glass glass-window" data-glass data-glass-corners="24 20 24 20" tabindex="0" role="group" aria-label="A glass window. Arrow keys move it; Shift and the arrow keys resize it."><strong>Glass, any size</strong><span class="glass-note">The same glass from a button to a whole window: its cuts and rim fit themselves to it.</span><span class="glass-size" aria-hidden="true"></span><span class="glass-grip" aria-hidden="true"><svg viewBox="0 0 30 30"><path d="M24 14L14 24M24 8L8 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span></div></div>`,
    },
    {
      label: "Thin to thick",
      isWide: true,
      markup: glassStrip(html`${[35, 55, 72].map((glassOpacityPct) => html`<div class="glass" data-glass data-glass-corners="24 20 24 20" style="--glass-tint:rgba(var(--glass-base),${glassOpacityPct / 100})"><strong>${glassOpacityPct}%</strong><span class="glass-kind"></span></div>`)}`),
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

/** A page's own shader, for the gallery: slow light rippling out from the lower left in the same colors. */
const RIPPLE_SHADER = `precision mediump float;
uniform vec2 u_resolution; uniform float u_time; uniform vec3 u_base; uniform vec3 u_a; uniform vec3 u_b; uniform vec3 u_c;
void main() {
  vec2 p = gl_FragCoord.xy / u_resolution.y;
  float ring = 0.5 + 0.5 * sin(length(p) * 9.0 - u_time * 0.4);
  float band = 0.5 + 0.5 * sin(p.x * 3.0 + u_time * 0.15);
  gl_FragColor = vec4(mix(mix(u_base, u_a, ring * 0.7), u_c, band * 0.35), 1.0);
}`;

const backdropFrame = (layer: Raw) => html`<div class="backdrop-frame">${layer}<div class="glass" data-glass data-glass-corners="24 20 24 20"><strong>Glass</strong><span>Always over something.</span></div></div>`;

component({
  name: "Backdrop",
  slug: "backdrop",
  group: "foundations",
  summary: "Glass is never on a plain or solid color: there's always something behind it, still or moving. A game is its own backdrop; Zaisma's pages have this one, or their own shader or 3D scene.",
  styles: `
/* The backdrop: a canvas under everything on the page. Its parent is isolated, so the canvas sits above the page's own color and below the rest.
   Until the shader draws (and wherever WebGL is missing) it shows a still gradient in the same colors. */
.backdrop { position: fixed; inset: 0; z-index: -1; display: block; width: 100%; height: 100%; pointer-events: none;
  background: radial-gradient(60% 55% at 22% 28%, var(--backdrop-a), transparent 70%), radial-gradient(55% 55% at 78% 68%, var(--backdrop-b), transparent 70%),
    radial-gradient(45% 40% at 52% 4%, var(--backdrop-c), transparent 70%), var(--backdrop-base); }
.backdrop.is-framed { position: absolute; }
:has(> .backdrop) { isolation: isolate; }
.backdrop-frame { position: relative; width: 100%; height: 220px; display: flex; align-items: center; justify-content: center; overflow: hidden;
  clip-path: polygon(0 24px, 24px 0, calc(100% - 20px) 0, 100% 20px, 100% calc(100% - 24px), calc(100% - 24px) 100%, 20px 100%, 0 calc(100% - 20px)); }
.backdrop-frame .glass { width: min(260px, 80%); padding: var(--pad-pane); display: flex; flex-direction: column; gap: var(--gap-words-words); font: var(--type-note); color: var(--ink-2); }
.backdrop-frame .glass strong { font: var(--type-name); color: var(--ink); }
`,
  examples: [
    { label: "Zaisma's own: behind every page", isWide: true, markup: backdropFrame(backdrop({ isFramed: true })) },
    { label: "A page's own shader", markup: backdropFrame(backdrop({ isFramed: true, fragmentShader: RIPPLE_SHADER })) },
    { label: "A 3D scene the page draws", markup: backdropFrame(html`${backdrop({ isFramed: true, isScene: true })}`) },
  ],
});

component({
  name: "Icons",
  slug: "icons",
  group: "foundations",
  summary: "Thin line icons in the words' color, so a kind of fact can be found without reading. Never decoration.",
  styles: `
/* Icons: the set, with names. */
.icon-set { width: 100%; list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: var(--gap-block-block); color: var(--ink); }
.icon-set li { display: flex; align-items: center; gap: var(--gap-words-words); font: var(--type-facts); color: var(--ink-2); }
.icon-set .ico { width: 20px; height: 20px; color: var(--ink); }
.icon-set .play { color: var(--ink); }
`,
  examples: [{ label: "Every icon", isWide: true, markup: html`<ul class="icon-set">${Object.keys(ICONS).map((name) => html`<li>${icon(name as IconName)}<span>${name}</span></li>`)}</ul>` }],
});

component({
  name: "Logo",
  slug: "logo",
  group: "foundations",
  summary: "Zaisma's logo, always a link home: the wordmark at the top of a page, the mark alone in the footer. Drawn in the words' color, never restyled.",
  styles: `
/* The logo: drawn in the words' color, at --logo-height (a bar sets it as it slims). */
.logo { display: flex; align-items: center; flex: none; padding: 6px 2px; color: var(--ink); }
.logo.wordmark { --logo-height: 26px; }
.logo.mark { --logo-height: 17px; padding: 0; opacity: 0.8; }
.logo svg { height: var(--logo-height); width: auto; display: block; transition: height 0.45s cubic-bezier(.2,.8,.2,1), color 0.3s; }
.logo:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .logo svg { transition: none; } }
`,
  examples: [
    { label: "The wordmark", markup: logo("wordmark") },
    { label: "The mark", markup: logo("mark") },
  ],
});

component({
  name: "Loader",
  slug: "loader",
  group: "foundations",
  summary: "The Z building itself: what a button shows once it's pressed and waiting, a form sent or a page opening. Only ever after you press something.",
  styles: `
/* The loader: the brand's Z, masked so it takes the words' color, --loader-width wide (19px). Under reduced motion, the still mark breathing slowly instead. */
.loader { display: inline-block; width: var(--loader-width, 19px); height: calc(var(--loader-width, 19px) * 0.737); flex: none; background: currentColor;
  -webkit-mask: url(/loader/zaisma-loader.svg) center / contain no-repeat; mask: url(/loader/zaisma-loader.svg) center / contain no-repeat; }
@keyframes loader-calm { 50% { opacity: 0.4; } }
@media (prefers-reduced-motion: reduce) { .loader { -webkit-mask-image: url(/zaisma-mark-small-white.svg); mask-image: url(/zaisma-mark-small-white.svg); animation: loader-calm 2.4s ease-in-out infinite; } }
`,
  examples: [
    { label: "On its own", markup: loader() },
    { label: "Bigger, for a page that's loading", markup: html`<span style="--loader-width:40px;color:var(--ink)">${loader()}</span>` },
  ],
});
