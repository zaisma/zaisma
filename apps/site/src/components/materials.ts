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
 *   - Floating pane (foundations.ts's floatingPane), a sheet, a notice, a playing card: thick glass, over what's under it.
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
   material is another; thin is there to try. */
.glass.thin { --glass-tint: var(--glass-thin); }
.glass.thick, .floating-pane, .sheet, .notice, .playing-card { --glass-tint: var(--glass-thick); }

/* Glass on glass: a browser blurs only what's inside the nearest blurred glass round it, so a second blur inside a pane would see nothing of
   the page and turn the inner glass flat white. Glass inside glass only tints: the pane round it has already blurred the page, which shows
   through both, as through two real sheets, and it costs one blur less. A floating pane, sheet or notice open over the page (the top layer)
   blurs the page itself; the gallery's strips of shapes blur the shapes they hold, to show what glass does. */
.glass .glass:not(:popover-open, :modal, .glass-strip .glass)::before { -webkit-backdrop-filter: none; backdrop-filter: none; }
/* Caps and scrolls: past its cap, what's in a material scrolls inside it (the part marked scrolls), on Zaisma's rail (RAIL_SCRIPT finds it)
   with fades at its ends, its head and foot staying put and the material itself still. Each caps at its own: a glass pane at what holds
   it, a sheet at the screen, a floating pane at a menu's height or the room in the window, a carving at its owner's cap (--well-height, a
   menu's height unless its owner says). Across, the rail runs under it (data-side-rail). A slab never scrolls. */
/* Only while it has something to scroll (is-scrollable) does it keep a swipe or a wheel to itself, so one that can't scroll never catches them. */
.scrolls { position: relative; min-height: 0; overflow-y: auto; }
.scrolls.is-scrollable { overscroll-behavior-y: contain; }
/* What's in it fits (MATERIAL_SCRIPT): it clips nothing, so a slab's shadow or glow near its edge falls past it. Only while it scrolls is it cut. */
.scrolls.fits { overflow: visible; }
.scrolls.own-scroll.shows-rail { padding-inline-end: calc(var(--scroll-inset, 0px) + 16px); }
.scrolls.across { min-height: auto; overflow: auto hidden; overscroll-behavior-x: contain; scrollbar-width: none; }
.scrolls.across::-webkit-scrollbar { display: none; }
.glass-pane > .scrolls { --scroll-inset: var(--pad-frame); }
.carving:has(> .scrolls:not(.across)) { align-items: stretch; max-height: var(--well-height, var(--size-menu-height)); }
.floating-pane { max-height: min(var(--size-menu-height), var(--floating-room, calc(100dvh - 2 * var(--pad-frame)))); padding: var(--pad-frame-compact); --pad-words: calc(var(--pad-tray) - var(--pad-frame-compact)); }
/* A carving with a control at its end (a well's Copy): what's in it stops short of the control. */
.carving:has(> .carving-end) > .carving-words { padding-inline-end: calc(var(--control-height-small) + var(--well-inset, 8px) + var(--gap-words-words)); }
/* Over everything (a sheet, a light box, a store panel): a pane of thick glass over the page, capped at the screen, with the page dimmed
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
  padding: var(--gap-words-control) var(--pad-words); margin: 0; border: 0; font: var(--type-words); color: var(--ink-2); text-align: start; text-decoration: none; cursor: pointer;
  --face-color: transparent; background: var(--face-color); clip-path: var(--cut-shape); transition: --face-color var(--motion-state), color var(--motion-state); -webkit-tap-highlight-color: transparent; }
.flush-row.compact { --row-height: var(--control-height-small); padding-block: 0; }
@media (pointer: coarse) { .flush-row.compact { --row-height: var(--control-height-regular); } }
/* The face of a button (a tertiary button): its button's height, its words a field's inset in wherever it is, its states its button's. */
.shell > .flush-row { --row-height: var(--control-height); padding: 0 var(--pad-inside-words); }
:is(.shell:hover, .shell.is-pointed, .shell:focus-visible, .shell.is-focused) > .flush-row:not(.quiet) { --face-color: var(--wash); color: var(--ink); }
:is(.shell:active, .shell.is-pressed) > .flush-row { --face-color: var(--wash-press); color: var(--ink); transition-duration: var(--motion-press); }
:is(.shell:focus-visible, .shell.is-focused) > .flush-row > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
/* What's in it sits over its face; zero specificity, so a part placed by its owner (a tertiary button's line) keeps its place. */
.flush-row > :where(:not(.cut-line)) { position: relative; z-index: 2; }
.flush-row:not(.quiet):is(:hover, .is-pointed, :focus-visible, .is-focused) { --face-color: var(--wash); color: var(--ink); }
.flush-row.quiet:is(:hover, .is-pointed) { color: var(--ink); }
.flush-row[aria-current="page"] { color: var(--ink); background: var(--slab-sheen), linear-gradient(var(--slab-wash), var(--slab-wash)), var(--slab-face); box-shadow: var(--slab-shade); }
.flush-row { --slab-wash: color-mix(in srgb, var(--glass-hue) var(--glass-hue-strength), transparent); }
.flush-row:focus-visible { outline: none; }
.flush-row:is(:focus-visible, .is-focused) > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }

/* A hairline: the one line drawn on glass, between things (a menu's head and its choices, rows one under another, or either side of a word). */
hr.hairline { border: 0; border-top: var(--divider); margin: var(--gap-control-stack) 0; }
.hairline-below { border-bottom: var(--divider); }
.hairlines > * + * { border-top: var(--divider); }
span.hairline { flex: 1; border-top: var(--divider); }

/* Words on the glass keep its margin (--pad-words), however they sit; beside controls, they line up with the controls' center line. */
.words-margin { padding-inline: var(--pad-words); }
.words-margin.beside-controls { padding-block: calc((var(--control-height-regular) - 1lh) / 2); }
.words-margin.beside-controls.compact { padding-block: calc((var(--control-height-small) - 1lh) / 2); }
/* With nothing beside them, they keep the margin all round. */
.words-margin.round { padding-block: var(--pad-words); }
/* Words that end in an ellipsis on one line rather than wrapping (a game's title under its cover, a menu's choice). */
.one-line { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* A carving that holds art (a game's cover, a store item's picture): the art fills it to its carved rim (2px), cut by the edge rule, and
   Zaisma's mark sits in the carving under it until the art has loaded, and stays where there's none. */
.carving.holds-art { overflow: hidden; background: url("/zaisma-mark-metal.svg") var(--mark-at, center) / auto 50% no-repeat, linear-gradient(var(--carving-wash), var(--carving-wash)), var(--face-color); }
.carving-art { position: absolute; inset: 2px; display: block; overflow: hidden; clip-path: var(--cut-shape); }
.carving-art img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }

/* A bar (the header, the gallery's bar, the footer): a strip of the same glass, as tall as what's in it and the frame gap round it, the same
   on every side, so its controls sit as far from its top and foot as from its ends; compact, the compact frame gap. */
.glass-bar { padding: var(--pad-frame); --pad-words: var(--pad-inside-words); }
.glass-bar.compact { padding: var(--pad-frame-compact); }
/* A compact pane keeps edged things at the compact frame gap and its words at the tray's margin. */
.glass-pane.compact > .pane-in { padding: var(--pad-frame-compact); --pad-words: calc(var(--pad-tray) - var(--pad-frame-compact)); }

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
/* Its edge light takes some of its tint (--way, --way-mix: a way in's color, a delete's red), so a tinted slab's lit edge is never a white
   rim round it, yet keeps the light that lands on it: resting, its top and leading edges still catch the highlight that makes it raised. */
.slab > .cut-line { --band-top: color-mix(in srgb, var(--way, transparent) calc(var(--way-mix, 0%) * 0.4), var(--raise-top)); --band-left: color-mix(in srgb, var(--way, transparent) calc(var(--way-mix, 0%) * 0.4), var(--raise-left));
  --band-right: color-mix(in srgb, var(--way, transparent) calc(var(--way-mix, 0%) * 0.4), var(--raise-right)); --band-bottom: color-mix(in srgb, var(--way, transparent) calc(var(--way-mix, 0%) * 0.4), var(--raise-bottom)); }
.slab > :where(:not(.cut-line)) { position: relative; z-index: 2; }
/* Its words end in an ellipsis on one line, never spilling out of it or growing it past its height. */
.slab > :is(span:not([class]), .label-idle, .label-busy) { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.slab-holder { display: inline-flex; max-width: 100%; }
:where(.shell, .slab-holder):has(> .slab) { filter: var(--slab-cast); transition: filter var(--motion-state); }
:is(.shell:hover, .shell.is-pointed, .shell:focus-visible, .shell.is-focused) > .slab, .slab.is-pointed, .slab.is-focused { --face-color: var(--slab-face-pointed); }
:is(.shell:active, .shell.is-pressed) > .slab, .slab.is-pressed { --face-color: var(--slab-face-pressed); box-shadow: var(--press-shade); transition-duration: var(--motion-press); }
:is(.shell:active, .shell.is-pressed):has(> .slab), .slab-holder:has(> .slab.is-pressed) { filter: none; }
:is(.shell:active, .shell.is-pressed) > .slab > .cut-line, .slab.is-pressed > .cut-line { --band-top: color-mix(in srgb, var(--way, transparent) calc(var(--way-mix, 0%) * 0.4), var(--carve-top)); --band-left: color-mix(in srgb, var(--way, transparent) calc(var(--way-mix, 0%) * 0.4), var(--carve-left));
  --band-right: color-mix(in srgb, var(--way, transparent) calc(var(--way-mix, 0%) * 0.4), var(--carve-right)); --band-bottom: color-mix(in srgb, var(--way, transparent) calc(var(--way-mix, 0%) * 0.4), var(--carve-bottom)); }
:is(.shell:focus-visible, .shell.is-focused) > .slab > .cut-line polygon, .slab.is-focused > .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
:is(.shell:disabled:not([aria-busy="true"]), .shell[aria-disabled="true"]) > .slab, .slab.is-disabled { --face-color: var(--carving-face); background: var(--face-color); box-shadow: var(--carving-shade); color: var(--muted); }
:is(.shell:disabled:not([aria-busy="true"]), .shell[aria-disabled="true"]):has(> .slab), .slab-holder:has(> .slab.is-disabled) { filter: none; }
:is(.shell:disabled:not([aria-busy="true"]), .shell[aria-disabled="true"]) > .slab > .cut-line, .slab.is-disabled > .cut-line { --band-top: var(--carve-top); --band-left: var(--carve-left); --band-right: var(--carve-right); --band-bottom: var(--carve-bottom); }
/* Lit: the orange slab, lit from above and deepening toward its foot, its edge bright along its top and its own orange's shade along its
   foot; on smoked glass it glows onto what's round it, on light glass it casts a shadow (--run-cast). */
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
@media (prefers-reduced-motion: reduce) { .carving, .slab { transition: none; } .slab.lit.glint::after { animation: none; } }
`;

/**
 * Caps and scrolls: a material's part that scrolls is cut at its edge only while what's in it is longer than its cap. Otherwise it fits
 * (fits), clips nothing, and lets the wheel through; it's measured again whenever it or what's in it changes size.
 */
export const MATERIAL_SCRIPT = `/* materials */(function () {
  function fit(box) { box.classList.toggle("fits", box.scrollHeight <= box.clientHeight + 1 && box.scrollWidth <= box.clientWidth + 1); }
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
  html`<div class="glass-strip" data-theme-choice="${theme}"><i></i><i></i><i></i>${([["Tray", "tray", "Under a pane"], ["Thin", "thin", "To try out"], ["Regular", "regular", "Every glass pane, the header, banners"], ["Thick", "thick", "Floating panes, sheets, notices, playing cards"]] as const).map(
    ([name, thickness, use]) => html`<div class="glass" data-glass data-glass-corners="pane" style="--glass-tint:var(--glass-${thickness})"><strong>${name}</strong>${use}</div>`,
  )}</div>`;

/** Every material over a game's art, tinted with the game's hue, so the tint shows on each: a pane, a carving, a slab and a lit one. */
const tintedSample = (theme: "light" | "dark") =>
  html`<div class="glass-strip" data-theme-choice="${theme}" style="background: center / cover no-repeat url('/design/covers/neon-drift.webp'); --glass-hue: #9B4DFF; padding: var(--gap-block-block)">${glassPane({
    paneWidth: "fit",
    body: html`<h2>Neon Drift</h2>${carving({ body: html`<span class="carving-words">zaisma.com/g/neon-drift</span>` })}<div style="display:flex;gap:var(--gap-control-stack)">${slab({ body: html`Details` })}${slab({ body: html`Play`, isLit: true })}</div>`,
  })}</div>`;

component({
  name: "Thickness",
  slug: "thickness",
  group: "panes",
  subgroup: "materials",
  summary:
    "Glass comes in four thicknesses, and each material is one of them wherever it's used: a tray the thinnest, every glass pane regular, a floating pane, a sheet, a notice and a playing card thick. Thin is there to try. A component never picks its own.",
  // MATERIAL_STYLES come right after the tokens (index.ts's COMPONENT_STYLES), before every component's own.
  styles: "",
  examples: [
    { label: "Light glass", isWide: true, markup: thicknessStrip("light") },
    { label: "Smoked glass", isWide: true, markup: thicknessStrip("dark") },
    { label: "Over a game, light: its hue tints every material, a carving half as much", isWide: true, markup: tintedSample("light") },
    { label: "Over a game, smoked", isWide: true, markup: tintedSample("dark") },
  ],
});

const carvingSample = (markup: Raw) => glassPane({ paneWidth: "fit", body: html`<div style="width:300px;max-width:100%">${markup}</div>` });
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
      markup: html`<div class="glass-strip"><i></i><i></i><i></i>${glassPane({ paneWidth: "fit", body: html`<div style="display:flex;gap:var(--gap-control-stack)">${slab({ body: html`Details` })}${slab({ body: html`Play`, isLit: true })}</div>` })}</div>`,
    },
    { label: "Lit: the orange one", markup: carvingSample(slab({ body: html`Play`, isLit: true })) },
    { label: "Lit, pointed at", isStill: true, markup: carvingSample(slab({ body: html`Play`, isLit: true, state: "is-pointed" })) },
    { label: "Lit, pressed", isStill: true, markup: carvingSample(slab({ body: html`Play`, isLit: true, state: "is-pressed" })) },
  ],
});

