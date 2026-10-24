

/** The cut corners of a kind of slab (the cut tokens), as a clip-path, for a frame that isn't glass the edge rule cuts (a demo's box). */
export const cutPolygon = (kind: "pane" | "header" | "menu"): string => {
  const [large, small] = [`var(--${kind}-cut-large)`, `var(--${kind}-cut-small)`];
  return `polygon(0 ${large}, ${large} 0, calc(100% - ${small}) 0, 100% ${small}, 100% calc(100% - ${large}), calc(100% - ${large}) 100%, ${small} 100%, 0 calc(100% - ${small}))`;
};

/** The glass's two kinds, as tokens: light glass with dark words, and smoked glass with light words. */
export const LIGHT_GLASS = `color-scheme: light;
  --ink: #14171C; --ink-2: #3D444E; --muted: #59606A; --line: rgba(20, 23, 28, 0.14);
  --glass: rgba(255, 255, 255, 0.4); --glass-edge: rgba(255, 255, 255, 0.92); --field: rgba(255, 255, 255, 0.62);
  --glass-tint: rgba(250, 252, 255, 0.5); --glass-top: rgba(250, 252, 255, 0.56); --glass-dropdown: rgba(250, 252, 255, 0.62); --glass-tray: rgba(250, 252, 255, 0.14);
  --glass-sheen: radial-gradient(140% 90% at 0% 0%, rgba(255, 255, 255, 0.34), rgba(255, 255, 255, 0) 55%), linear-gradient(180deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0) 38%, rgba(30, 60, 110, 0) 70%, rgba(30, 60, 110, 0.05));
  /* A tray's light: the same sheen at a third of the strength, so the tray stays muted under its pane. */
  --glass-tray-sheen: radial-gradient(140% 90% at 0% 0%, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0) 55%), linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0) 38%, rgba(30, 60, 110, 0) 70%, rgba(30, 60, 110, 0.02));
  --glass-saturate: 1.8; --edge-hair: rgba(40, 60, 100, 0.1);
  /* A well is carved into the glass: a touch darker than it, so it reads on a pale backdrop too. */
  --well: rgba(70, 84, 108, 0.08); --well-shade: inset 0 1px 3px rgba(20, 23, 28, 0.1);
  --slab: linear-gradient(180deg, rgba(255, 255, 255, 0.88), rgba(255, 255, 255, 0.6)); --slab-shade: 0 4px 10px rgba(20, 23, 28, 0.12); --ghost: rgba(255, 255, 255, 0.45); --ghost-rest: rgba(255, 255, 255, 0); --wash-rest: rgba(20, 23, 28, 0); --wash: rgba(20, 23, 28, 0.08); --wash-press: rgba(20, 23, 28, 0.14);
  --btn: rgba(255, 255, 255, 0.6); --btn-hover: rgba(255, 255, 255, 0.82); --btn-press: rgba(226, 232, 240, 0.9);
  --press-shade: inset 0 2px 5px rgba(20, 30, 50, 0.16);
  /* The edge of something you press, at rest (a check's box, a toggle's slot, a choice card): 3:1 or more against the glass. */
  --press-rim: rgba(20, 23, 28, 0.5);
  /* A color swatch's rim against its well, so a color near the well's own (black in dark, white in light) still shows: 3:1 or more. */
  --swatch-rim: rgba(20, 23, 28, 0.5);
  /* What can't be pressed now: carved flat into the glass, unlike a field's or a button's face in either theme. */
  --off-face: rgba(70, 84, 108, 0.08);
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
  --toggle-off: rgba(60, 72, 94, 0.2); --check-press: rgba(60, 72, 94, 0.16); --row-hover: rgba(255, 255, 255, 0.24); --row-press: rgba(20, 23, 28, 0.05); --tag-new: rgba(34, 160, 90, 0.26); --tag-new-ink: #0A5A2C; --tag-warning: rgba(217, 165, 28, 0.3); --tag-warning-ink: var(--warning); --tag-plain: rgba(60, 72, 94, 0.1); --tag-carve: inset 0 1px 2px rgba(20, 30, 50, 0.22), inset 0 -1px 0 rgba(255, 255, 255, 0.75); --face-ring: rgba(255, 255, 255, 0.85); --presence-ring: #fff; --online: #3BB273; --picture-shadow: rgba(20, 23, 28, 0.3);
  /* Data: a table's header row over the rows scrolling under it, a chart's fill under its line, a meter's fill and its amber past 80%. */
  --table-head: rgba(250, 252, 255, 0.9); --table-row-head: rgba(244, 246, 250, 0.97); --chart-fill: rgba(20, 23, 28, 0.07); --chart-bar: rgba(60, 72, 94, 0.26); --chart-ring: rgba(250, 252, 255, 0.9); --chart-tip: rgba(250, 252, 255, 0.94); --meter-fill: rgba(60, 72, 94, 0.42); --meter-near: #D9A51C; --meter-full: #A87C0E; --meter-full-ink: var(--warning);
  /* A file drop's dashed outline, waiting for a file. */
  --drop-dash: rgba(20, 23, 28, 0.3);
  --rail-line: rgba(20, 23, 28, 0.2); --rail-thumb: rgba(24, 28, 36, 0.55); --rail-edge: rgba(255, 255, 255, 0.55); --rail-mark: rgba(20, 23, 28, 0.45);
  --edge-inner: rgba(255, 255, 255, 0.9); --edge-bevel: 0.4; --edge-rim: 1; --edge-fringe: 0.25;
  --edge-lit: rgba(236, 240, 246, 1); --edge-shade: rgba(146, 154, 168, 0.6); --edge-corner: rgba(188, 196, 208, 0.75);
  --edge-spec: rgba(255, 255, 255, 1); --edge-dense: rgba(120, 130, 146, 0.03); --edge-caustic: rgba(255, 252, 244, 0.95);
  /* A warning and a field marked wrong: amber, a yellower hue than the runner's orange, so it never reads as something to press or as focus. */
  --warning: #7D5C00; --link-hover: var(--run-lo); --marked: var(--warning);
  --glass-base: 255, 255, 255; --glass-kind: "Light glass, dark words."; --glass-hue-strength: 14%; --track: rgba(186, 198, 216, 0.28);
  --raise-top: rgba(255, 255, 255, 0.95); --raise-left: rgba(255, 255, 255, 0.6); --raise-right: rgba(96, 108, 128, 0.22); --raise-bottom: rgba(70, 82, 104, 0.34);
  --carve-rim: transparent; --carve-top: rgba(60, 72, 94, 0.3); --carve-left: rgba(60, 72, 94, 0.2); --carve-right: rgba(255, 255, 255, 0.55); --carve-bottom: rgba(255, 255, 255, 0.9);
  --backdrop-base: #E3E0DB; --backdrop-a: #F6F4F0; --backdrop-b: #CCC8C1; --backdrop-c: #ECE9E4;`;

export const SMOKED_GLASS = `color-scheme: dark;
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
  --press-rim: rgba(255, 255, 255, 0.45);
  --swatch-rim: rgba(255, 255, 255, 0.45);
  --off-face: rgba(0, 0, 0, 0.22);
  --field-face: rgba(255, 255, 255, 0.08); --field-hover: rgba(255, 255, 255, 0.12); --field-focus: rgba(255, 255, 255, 0.16);
  --field-shade: inset 0 1px 3px rgba(0, 0, 0, 0.25); --field-outline: transparent;
  --show: rgba(255, 255, 255, 0.1); --show-on: rgba(255, 255, 255, 0.22);
  --pick: rgba(255, 255, 255, 0.06); --pick-shade: inset 0 1px 3px rgba(0, 0, 0, 0.3), inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  --done: rgba(255, 255, 255, 0.12); --done-line: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  --glass-btn-face: rgba(255, 255, 255, 0.07); --glass-btn-hover: rgba(255, 255, 255, 0.15); --glass-btn-press: rgba(255, 255, 255, 0.04); --pointer-glow: rgba(255, 255, 255, 0.3);
  --glass-btn-lift: inset 0 -12px 18px -12px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.22); --glass-btn-hair: rgba(26, 44, 80, 0.16); --glass-btn-hair-rest: rgba(26, 44, 80, 0.28);
  --clear-hover: rgba(255, 255, 255, 0.08); --clear-press: rgba(255, 255, 255, 0.04); --clear-glass-mark: #fff; --on-light: none; --on-smoked: inline; --divider: 1px solid var(--line);
  --toggle-off: rgba(0, 0, 0, 0.34); --check-press: rgba(0, 0, 0, 0.3); --row-hover: rgba(255, 255, 255, 0.1); --row-press: rgba(255, 255, 255, 0.22); --tag-new: rgba(30, 150, 80, 0.32); --tag-new-ink: #A6F0C6; --tag-warning: rgba(230, 181, 58, 0.24); --tag-warning-ink: var(--warning); --tag-plain: rgba(0, 0, 0, 0.34); --tag-carve: inset 0 1.5px 3px rgba(0, 0, 0, 0.8), inset 0 -1px 0 rgba(255, 255, 255, 0.24); --face-ring: rgba(6, 8, 12, 0.55); --presence-ring: #1A1D24; --online: #3BB273; --picture-shadow: rgba(0, 0, 0, 0.55);
  --table-head: rgba(14, 17, 24, 0.9); --table-row-head: rgba(24, 28, 36, 0.97); --chart-fill: rgba(255, 255, 255, 0.08); --chart-bar: rgba(255, 255, 255, 0.3); --chart-ring: rgba(20, 23, 30, 0.9); --chart-tip: rgba(28, 32, 40, 0.94); --meter-fill: rgba(255, 255, 255, 0.6); --meter-near: #E6B53A; --meter-full: #A9811C; --meter-full-ink: var(--warning); --drop-dash: rgba(255, 255, 255, 0.34);
  --rail-line: rgba(255, 255, 255, 0.2); --rail-thumb: rgba(255, 255, 255, 0.55); --rail-edge: rgba(255, 255, 255, 0.35); --rail-mark: rgba(255, 255, 255, 0.5);
  /* A light rim on dark glass stands out far more than on light glass, so smoked glass draws it fainter than light glass's. It has no caustics:
     on light glass they're light on light and only round the edge off, but on dark glass they read as a glow fanning in from the rim, which
     blurs the pane's edge against what sits near it. Smoked glass keeps to the edge, as narrow and clean as light glass's. */
  --edge-inner: rgba(255, 255, 255, 0.22); --edge-bevel: 0.18; --edge-rim: 0.5; --edge-fringe: 0.15;
  --edge-lit: rgba(220, 228, 242, 0.68); --edge-shade: rgba(140, 152, 176, 0.12); --edge-corner: rgba(196, 206, 224, 0.34);
  --edge-spec: rgba(255, 255, 255, 0.52); --edge-dense: rgba(255, 255, 255, 0.015); --edge-caustic: transparent;
  --warning: #F2C94C; --link-hover: var(--run-hi); --marked: var(--warning);
  --glass-base: 14, 17, 24; --glass-kind: "Smoked glass, light words."; --glass-hue-strength: 22%; --track: rgba(255, 255, 255, 0.08);
  --raise-top: rgba(255, 255, 255, 0.42); --raise-left: rgba(255, 255, 255, 0.22); --raise-right: rgba(0, 0, 0, 0.3); --raise-bottom: rgba(0, 0, 0, 0.5);
  --carve-rim: rgba(255, 255, 255, 0.16); --carve-top: rgba(0, 0, 0, 0.5); --carve-left: rgba(0, 0, 0, 0.32); --carve-right: rgba(255, 255, 255, 0.1); --carve-bottom: rgba(255, 255, 255, 0.2);
  --backdrop-base: #121110; --backdrop-a: #2A2724; --backdrop-b: #0A0909; --backdrop-c: #1D1B19;`;

/**
 * The tokens. Light or dark follows the system unless a choice is fixed with data-theme-choice, on <html>
 * or on any element (the gallery's stage fixes it for what's inside). Dark is smoked glass over a night-dark
 * page. Smoked glass on its own is the class smoke on any ancestor: a dark game's background smokes the
 * glass over it whatever the theme, since the theme changes only Zaisma's own backgrounds.
 */
export const TOKEN_STYLES = `
@font-face { font-family: Jost; src: url(/fonts/jost.7726a5cd.woff2) format("woff2"); font-weight: 100 900; font-display: swap; }
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
/* The words' inset in a pane (layout.ts), registered so it's worked out to a length where it's set, and reads as one. */
@property --pad-words { syntax: "<length>"; inherits: true; initial-value: 0px; }
@property --fade-bottom { syntax: "<length>"; inherits: false; initial-value: 0px; }
.scroll-fades.is-fading { -webkit-mask-image: linear-gradient(to bottom, transparent, #000 var(--fade-top), #000 calc(100% - var(--fade-bottom)), transparent);
  mask-image: linear-gradient(to bottom, transparent, #000 var(--fade-top), #000 calc(100% - var(--fade-bottom)), transparent); transition: --fade-top 0.2s, --fade-bottom 0.2s; }
/* A row that scrolls sideways (data-fades-sideways: a header's tabs, the gallery's groups on a phone) fades out over a side with more past it,
   easing in and out, with no scrollbar; it starts scrolled to the one you're on, and never scrolls up and down. */
@property --fade-left { syntax: "<length>"; inherits: false; initial-value: 0px; }
@property --fade-right { syntax: "<length>"; inherits: false; initial-value: 0px; }
/* A box that scrolls keeps a swipe to itself: reaching its end never carries on into the page, so the page never nudges under it. */
/* Only while it has something to scroll (is-scrollable, SCROLL_FADE_SCRIPT): a box that can't scroll never catches a swipe or a wheel. */
.is-scrollable { overscroll-behavior-y: contain; }
/* The page never rubber-bands, sideways or past its top or bottom: its backdrop stays put behind the glass, so a page pulled past its end
   would leave the glass's light on the backdrop behind. A tap shows itself on what was tapped, never as the browser's grey box. */
html, body { overscroll-behavior: none; }
html { -webkit-tap-highlight-color: transparent; }
.is-scrollable-sideways { overscroll-behavior-x: contain; }
[data-fades-sideways] { overflow-x: auto; overflow-y: hidden; scrollbar-width: none; transition: --fade-left 0.25s, --fade-right 0.25s; }
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
/* They share the row, but never shrink below their words: when two don't fit side by side (a narrow phone), the second wraps under the first. */
[data-glass] .control-row > .shell { display: flex; flex: 1 1 0; }
[data-glass] .control-row > .shell > .face { width: 100%; justify-content: center; }
.eases-settings { transition: --glass-hue 0.5s ease; }
@media (prefers-reduced-motion: reduce) { .eases-settings { transition: none; } }
/* Moving between Zaisma's pages crossfades, so a page change never flashes. It's quick: a switch's slab slides over from the last page's
   tab only once the crossfade is over (SWITCH_SCRIPT), so a long one would hold the slab still. */
@media (prefers-reduced-motion: no-preference) { @view-transition { navigation: auto; } ::view-transition-group(root) { animation-duration: 0.12s; } }
:root {
  color-scheme: light dark;
  --run: #F7931A; --run-hi: #FFB24A; --run-lo: #A85A06;
  /* Words and marks on an orange face (the runner, a ticked box): dark ink in both themes, 7.8:1 against it (white is 2.3:1). */
  --on-run: #14171C;
  /* The only red: a delete's confirm step, never anything else. */
  --danger: #D93A2B; --danger-lo: #A82718;
  --page: #E7E4DF;
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
  --focus: var(--run); --focus-on-run: #7A4100; --focus-stroke: 4;
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
  /* Two margins in a pane (docs/DESIGN.md, Layout): words keep the pane's margin, --pad-pane, and anything with an edge of its own (a control,
     a field, a table, a cover, an inner pane) sits closer, at the frame gap, --pad-frame, the gap it keeps from a cut corner too. A pane pads
     at the frame gap and sets --pad-words, the words' extra inset, for its words; outside a pane it's nothing. */
  --pad-pane: 24px;
  --pad-frame: 8px;
  --pad-words: 0px;
  /* What has an edge and words inside it (a field, a list's rows, a table's cells, a choice card) keeps its words this far in from its edge,
     so where it sits at the frame gap its words line up with the pane's words: --pad-pane less --pad-frame. */
  --pad-inside-words: calc(var(--pad-pane) - var(--pad-frame));
  --pad-inner-pane: 12px;
  --pad-tray: 16px;
  /* Cut corners (docs/DESIGN.md, Shapes): a pane's, the header's and a bar's, a menu's, large and small, read by the edge rule (GLASS_SCRIPT)
     from data-glass-corners, so everything inside fits them. A framed thing in a corner keeps a bevel of at least 4px at the frame gap. */
  --pane-cut-large: 18px; --pane-cut-small: 14px;
  --header-cut-large: 16px; --header-cut-small: 12px;
  --menu-cut-large: 14px; --menu-cut-small: 12px;
  /* A control's height by its size class: each control sets --control-height from one of these, and a row sets every control in it to its
     tallest's (layout.ts). */
  --control-height-small: 36px; --control-height-regular: 44px; --control-height-field: 52px; --control-height-big: 56px;
  /* The named sizes, the only widths a layout takes (layout.ts): a cell's least width in a grid, by what it holds; and the widest a
     paragraph runs in a pane that fits what's in it, for reading. */
  --size-cover: 180px; --size-card: 280px; --size-figure: 150px; --size-reading: 60ch;
  /* A figure's least width in Numbers: two side by side on a phone. */
  --size-number: 96px;
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
@media (max-width: 760px) { :root { --pad-pane: 20px; --pad-frame: 8px; --control-height-big: 48px; --type-title: 600 32px/1.04 var(--display); --type-heading: 600 26px/1.1 var(--display); --type-section: 600 20px/1.2 var(--display); } }
:root, [data-theme-choice="light"] { ${LIGHT_GLASS} --page: #E7E4DF; }
@media (prefers-color-scheme: dark) { :root:not([data-theme-choice="light"]) { ${SMOKED_GLASS} --page: #121110; } }
[data-theme-choice="dark"] { ${SMOKED_GLASS} --page: #121110; }
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
/* Words never leave one word alone on their last line: paragraphs and lines wrap evenly at their end, headings evenly throughout. */
:where(p, li, dd, dt, figcaption, legend, label, blockquote, td, th) { text-wrap: pretty; }
:where(h1, h2, h3, h4) { text-wrap: balance; }
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
/* A slab's words keep no inset of their own unless it's a pane that sets one (layout.ts): none comes in from the pane round it. */
.glass { --pad-words: 0px; }
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
/* Caustics: soft steps of gathered light just inside a pane's bevel, each side as bright as it's lit, fading inward. */
.edge .caustic polygon { fill: var(--edge-caustic); opacity: calc(var(--side-light) * var(--caustic-step)); }
.edge .caustic.step-1 { --caustic-step: 0.32; } .edge .caustic.step-2 { --caustic-step: 0.18; } .edge .caustic.step-3 { --caustic-step: 0.09; } .edge .caustic.step-4 { --caustic-step: 0.035; }
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
