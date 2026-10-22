import { html, raw, shownColor, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { ICONS, MARK, WORDMARK, icon, type IconName } from "./icons.ts";
import { CLOUDS_SHADER, DUSK_SHADER, EMBERFALL_SHADER, FROSTLINE_SHADER, NEON_DRIFT_SHADER, STARWARD_SHADER } from "./shaders.ts";

/*
 * The foundations of Zaisma's look: the tokens every component takes its colors from (tokens.ts), the glass and its
 * drawn rim (glass-script.ts), the backdrop (backdrop-script.ts), the cut shapes, the motion and the line icons (icons.ts).
 * From the drafts Julius approved (ops docs/drafts/look-and-voice/). "Zaisma is the glass, and the game is not"; orange
 * only on what you act on. Everything the other component files import from here is re-exported below.
 */
export { ICONS, MARK, WORDMARK, icon, type IconName } from "./icons.ts";
export { TOKEN_STYLES } from "./tokens.ts";
export { GLASS_SCRIPT, WATCH_SCRIPT } from "./glass-script.ts";
export { BACKDROP_SCRIPT } from "./backdrop-script.ts";


export const MINUTE_MS = 60_000;

/** "12 min ago", "3 h ago", "yesterday", "5 days ago": the home draft's way of saying when. */
export function ago(durationMs: number): string {
  const minuteCount = Math.max(1, Math.round(durationMs / MINUTE_MS));
  if (minuteCount < 60) return `${minuteCount} min ago`;
  if (minuteCount < 1440) return `${Math.round(minuteCount / 60)} h ago`;
  const dayCount = Math.round(minuteCount / 1440);
  return dayCount === 1 ? "yesterday" : `${dayCount} days ago`;
}

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
export const railMarkup = (scrollKind: "box" | "page" | "side"): Raw => raw(`<div class="rail${scrollKind === "side" ? " sideways" : ""}" data-rail="${scrollKind}" aria-hidden="true"><div class="rail-line"></div><div class="rail-thumb glass"></div></div>`);

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

/**
 * A color picker (inputs.ts's Color picker shows it): plain swatches in a carved well, like the switch's tabs, slanting toward each other.
 * The picked one keeps its whole color, with an orange bar under it that glides to the next pick (COLOR_PICKER_SCRIPT places it); its name sits beside the well.
 * focusedValue fixes keyboard focus on one, for the gallery.
 */
export function colorPicker(options: { label: string; choices: ColorChoice[]; pickedValue: string; focusedValue?: string; extra?: Raw }): Raw {
  const picked = options.choices.find((choice) => choice.colorValue === options.pickedValue);
  return html`<div class="color-picker" role="group" aria-label="${options.label}"${options.extra ?? ""}><div class="color-well cut-carved" data-cut-line="9">${CUT_LINE}${options.choices.map(
    (choice) =>
      html`<button type="button" class="color-pick${choice.colorValue === options.focusedValue ? " is-focused" : ""}" data-cut-line="6" data-color-value="${choice.colorValue}" aria-label="${choice.name}" aria-pressed="${choice === picked ? "true" : "false"}" style="--swatch:${choice.swatch === "clear" ? "var(--clear-swatch)" : choice.swatch}">${CUT_LINE}</button>`,
  )}<span class="color-mark" aria-hidden="true"${picked ? "" : raw(" hidden")}></span></div><span class="color-picker-name" aria-live="polite">${picked?.name ?? ""}</span></div>`;
}

/** A pick moves the bar and the name; what the color changes is the page's own script's (it reads data-color-value). */
export const COLOR_PICKER_SCRIPT = `/* color pickers */(function () {
  var root = getComputedStyle(document.documentElement);
  var SLANT_PX = parseFloat(root.getPropertyValue("--control-slant")) || 10, GAP_PX = parseFloat(root.getPropertyValue("--gap-control-row")) || 4;
  // The bar under the picked swatch: its sides carry on the swatch's own slants down to it, so between colors it slants with them;
  // under the first or last color, its outer end follows the well's cut corner instead, at the gap the swatches keep from it.
  function place(well, isGliding) {
    var mark = well.querySelector(".color-mark"), picks = Array.prototype.slice.call(well.querySelectorAll(".color-pick"));
    var pick = well.querySelector('.color-pick[aria-pressed="true"]');
    if (!mark || !pick) { if (mark) mark.hidden = true; return; }
    mark.hidden = false;
    var size = pick.offsetHeight, run = SLANT_PX / size, left = pick.offsetLeft, right = left + pick.offsetWidth;
    var top = mark.offsetTop, bottom = top + mark.offsetHeight, below = top - (pick.offsetTop + size), height = mark.offsetHeight;
    var wellWidth = well.offsetWidth, wellHeight = well.offsetHeight, cuts = well.cutCorners || [0, 0, 0, 0], reach = GAP_PX * Math.SQRT2;
    // x on the well's bottom left or right corner line, moved in by the gap, at height y.
    function startCorner(y) { return cuts[3] + reach - (wellHeight - y); }
    function endCorner(y) { return wellWidth - (cuts[2] + reach - (wellHeight - y)); }
    var isFirst = pick === picks[0], isLast = pick === picks[picks.length - 1];
    var x = isFirst ? [Math.max(left, startCorner(top)), Math.max(left, startCorner(bottom))] : [left - run * below, left - run * (below + height)];
    var endX = isLast ? [Math.min(right, endCorner(top)), Math.min(right, endCorner(bottom))] : [right - SLANT_PX - run * below, right - SLANT_PX - run * (below + height)];
    var from = Math.min(x[0], x[1]), to = Math.max(endX[0], endX[1]);
    var points = [[x[0] - from, 0], [endX[0] - from, 0], [endX[1] - from, height], [x[1] - from, height]];
    if (!isGliding) mark.style.transition = "none";
    mark.style.width = (to - from) + "px"; mark.style.transform = "translateX(" + from + "px)";
    mark.style.setProperty("--cut-shape", "polygon(" + points.map(function (p) { return p[0].toFixed(2) + "px " + p[1].toFixed(2) + "px"; }).join(", ") + ")");
    if (!isGliding) { mark.offsetWidth; mark.style.transition = ""; }
  }
  function placeAll() { document.querySelectorAll(".color-well").forEach(function (well) { place(well, false); }); }
  // After the edge rule has cut the wells (their corners), and again once the fonts have settled the layout.
  requestAnimationFrame(placeAll);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeAll);
  document.addEventListener("click", function (event) {
    var pick = event.target.closest && event.target.closest(".color-pick"); if (!pick) return;
    var picker = pick.closest(".color-picker");
    picker.querySelectorAll(".color-pick").forEach(function (each) { each.setAttribute("aria-pressed", String(each === pick)); });
    place(pick.parentElement, true);
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

/** The settings as attributes for <html>. Only a #rrggbb color is taken as a hue, so a game's color can't carry anything else into the page. */
export function pageSettingsAttributes(settings: PageSettings): Raw {
  const hueColor = shownColor(settings.glass?.hueColor);
  return html`${settings.theme ? html` data-theme-choice="${settings.theme}"` : ""}${hueColor ? html` style="--glass-hue:${hueColor}"` : ""}`;
}

/** A framed backdrop with glass over it, for the Glass foundation's light examples. theme fixes light or dark inside it. */
const lightFrame = (options: { shader?: string; theme?: "light" | "dark"; cards: [string, string][] }) =>
  html`<div class="backdrop-frame is-tall"${options.theme ? html` data-theme-choice="${options.theme}"` : ""}>${backdrop({ isFramed: true, fragmentShader: options.shader, isGlassAdaptive: Boolean(options.shader) })}${options.cards.map(([title, note]) => html`<div class="glass" data-glass data-glass-corners="24 20 24 20"><strong>${title}</strong><span>${note}</span></div>`)}</div>`;

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
    { label: "It bends the light behind it, light glass", isWide: true, markup: lightFrame({ theme: "light", cards: [["Glass", "What's behind it is magnified a little and bent along its cut edge, with light gathered on the lit facets."]] }) },
    { label: "Smoked glass: the same, fainter", isWide: true, markup: lightFrame({ theme: "dark", cards: [["Smoked glass", "Its edge light is fainter, as its rim is."]] }) },
    { label: "Over a busy shader: it picks light or smoked glass and a tint from what's behind, and the words keep their contrast", isWide: true, markup: lightFrame({ shader: NEON_DRIFT_SHADER, cards: [["Neon Drift", "A city in the rain behind thick glass: bent, lit along the edge, and the words as clear as ever."]] }) },
    {
      label: "Thin to thick",
      isWide: true,
      markup: glassStrip(html`${[35, 55, 72].map((glassOpacityPct) => html`<div class="glass" data-glass data-glass-corners="24 20 24 20" style="--glass-tint:rgba(var(--glass-base),${glassOpacityPct / 100})"><strong>${glassOpacityPct}%</strong><span class="glass-kind"></span></div>`)}`),
    },
  ],
});

export interface BackdropOptions {
  /** A page's own shader background: a mainImage function (shaders.ts). Left out, the page gets Zaisma's. */
  fragmentShader?: string;
  /** The glass over it takes light or smoked glass, and a tint, from what the shader draws behind it (a game's or a page's own background). */
  isGlassAdaptive?: boolean;
  /** The page draws its own 3D scene into the canvas on each backdrop-frame event, instead of a shader. */
  isScene?: boolean;
  /** Fills its own box (position: relative) instead of the window: for a backdrop shown inside something, like the gallery's examples. */
  isFramed?: boolean;
}

/** What's behind the glass on a page: the first thing in the page's body or stage, under everything else. */
export function backdrop(options: BackdropOptions = {}): Raw {
  return html`<canvas class="backdrop${options.isFramed ? " is-framed" : ""}" data-backdrop="${options.isScene ? "scene" : "shader"}"${options.fragmentShader ? html` data-backdrop-shader="${options.fragmentShader}"` : ""}${options.isGlassAdaptive ? raw(" data-adapts-glass") : ""} aria-hidden="true"></canvas>`;
}

const backdropFrame = (layer: Raw, title = "Glass", note = "Always over something.") =>
  html`<div class="backdrop-frame">${layer}<div class="glass" data-glass data-glass-corners="24 20 24 20"><strong>${title}</strong><span>${note}</span></div></div>`;

component({
  name: "Backdrop",
  slug: "backdrop",
  group: "foundations",
  summary: "Glass is never on a plain or solid color: there's always something behind it, still or moving. A game is its own backdrop; Zaisma's pages have Zaisma's own, glass facets with orange nodes wandering over them, or their own shader or 3D scene.",
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
/* Taller, holding a row of glass: the Glass foundation's light examples. */
.backdrop-frame.is-tall { height: 260px; gap: var(--gap-block-block); padding: var(--pad-pane); }
.backdrop-frame.is-tall .glass { flex: 1 1 0; width: auto; max-width: 320px; }

.backdrop-frame .glass strong { font: var(--type-name); color: var(--ink); }
`,
  render: backdrop,
  examples: [
    { label: "Zaisma's own: behind every page, pearl on light and graphite on dark", isWide: true, markup: backdropFrame(backdrop({ isFramed: true })) },
    { label: "A page's own shader", markup: backdropFrame(backdrop({ isFramed: true, fragmentShader: CLOUDS_SHADER, isGlassAdaptive: true })) },
    { label: "A 3D scene the page draws", markup: backdropFrame(html`${backdrop({ isFramed: true, isScene: true })}`) },
  ],
});

component({
  name: "Shader background",
  slug: "shader-background",
  group: "foundations",
  summary: "A background written as a shader: one small function that paints each pixel from the time and the screen's size, in the form AI writes well. From a few lines for a sky to a whole city in the rain. Zaisma's runner draws it small, at most 30 frames a second, holds a still frame on a device that can't keep up, and bends the light under the glass for any shader: what's behind each pane magnified and bent as through thick glass, with light gathered along its cut edge.",
  styles: `
/* Shader background: each example a framed backdrop with its glass over it, and the simplest one's whole source beside it. */
.shader-code { margin: 0; width: 100%; padding: var(--pad-inner-pane); overflow-x: auto; white-space: pre; font: var(--type-code); color: var(--ink-2);
  background: var(--well); box-shadow: var(--well-shade); }
`,
  examples: [
    { label: "Simple: a dusk sky whose horizon breathes", markup: backdropFrame(backdrop({ isFramed: true, fragmentShader: DUSK_SHADER, isGlassAdaptive: true }), "Dusk", "Four lines.") },
    { label: "Simple, with noise: clouds drifting", markup: backdropFrame(backdrop({ isFramed: true, fragmentShader: CLOUDS_SHADER, isGlassAdaptive: true }), "Clouds", "fbm, from the helpers.") },
    { label: "The dusk sky's whole source", markup: html`<pre class="shader-code">${DUSK_SHADER.trim()}</pre>`, isWide: true },
    { label: "Complex: a city at night in the rain", markup: backdropFrame(backdrop({ isFramed: true, fragmentShader: NEON_DRIFT_SHADER, isGlassAdaptive: true }), "Neon Drift", "Skyline, neon windows, rain.") },
    { label: "Complex: an aurora over snowy peaks", markup: backdropFrame(backdrop({ isFramed: true, fragmentShader: FROSTLINE_SHADER, isGlassAdaptive: true }), "Frostline", "Aurora, stars, falling snow.") },
    { label: "Complex: a nebula and a ringed planet", markup: backdropFrame(backdrop({ isFramed: true, fragmentShader: STARWARD_SHADER, isGlassAdaptive: true }), "Starward", "Nebula, twinkling stars, a planet.") },
    { label: "Complex: embers rising from a volcano", markup: backdropFrame(backdrop({ isFramed: true, fragmentShader: EMBERFALL_SHADER, isGlassAdaptive: true }), "Emberfall", "Lava, a lit ridge, embers.") },
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
  render: icon,
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
  render: logo,
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
  render: loader,
  examples: [
    { label: "On its own", markup: loader() },
    { label: "Bigger, for a page that's loading", markup: html`<span style="--loader-width:40px;color:var(--ink)">${loader()}</span>` },
  ],
});
