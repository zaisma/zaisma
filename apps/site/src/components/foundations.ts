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
  --glass-tint: rgba(255, 255, 255, 0.5); --glass-top: rgba(255, 255, 255, 0.55); --glass-menu: rgba(255, 255, 255, 0.6);
  --glass-sheen: linear-gradient(170deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0) 55%);
  --well: rgba(255, 255, 255, 0.32); --well-shade: inset 0 1px 3px rgba(20, 23, 28, 0.08);
  --slab: linear-gradient(180deg, #fff, #EEF1F4); --slab-shade: 0 4px 10px rgba(20, 23, 28, 0.12); --ghost: rgba(255, 255, 255, 0.45);
  --btn: rgba(255, 255, 255, 0.6); --btn-hover: rgba(255, 255, 255, 0.95);
  --field-face: rgba(255, 255, 255, 0.5); --field-hover: rgba(255, 255, 255, 0.66); --field-focus: rgba(255, 255, 255, 0.94);
  --field-shade: inset 0 1px 3px rgba(20, 23, 28, 0.1); --field-outline: rgba(20, 23, 28, 0.16);
  --show: rgba(255, 255, 255, 0.55); --show-on: #fff;
  --pick: rgba(255, 255, 255, 0.42); --pick-shade: inset 0 1px 3px rgba(20, 23, 28, 0.1), inset 0 0 0 1px rgba(255, 255, 255, 0.5);
  --done: rgba(255, 255, 255, 0.7); --done-line: inset 0 0 0 1px rgba(20, 23, 28, 0.1);
  --glass-btn: linear-gradient(180deg, rgba(255, 255, 255, 0.78), rgba(255, 255, 255, 0.45)); --glass-btn-edge: rgba(255, 255, 255, 0.92);
  --glass-btn-shade: 0 6px 16px rgba(30, 60, 110, 0.1), inset 0 -1px 0 rgba(20, 23, 28, 0.06);
  --glass-btn-lift: 0 10px 22px rgba(30, 60, 110, 0.16), inset 0 -1px 0 rgba(20, 23, 28, 0.06);
  --outline: rgba(20, 23, 28, 0.28); --clear-hover: rgba(255, 255, 255, 0.4);
  --chip-face: #DDF2E5; --chip-ink: #136238; --face-ring: rgba(255, 255, 255, 0.85); --presence-ring: #fff;
  --rail-line: rgba(20, 23, 28, 0.2); --rail-thumb: rgba(24, 28, 36, 0.55); --rail-edge: rgba(255, 255, 255, 0.55); --rail-mark: rgba(20, 23, 28, 0.45);
  --edge-inner: rgba(255, 255, 255, 0.7); --edge-bevel: 1; --edge-rim: 1; --edge-fringe: 1;
  --logo-halo: drop-shadow(0 0 10px rgba(255, 255, 255, 0.6)) drop-shadow(0 1px 1px rgba(255, 255, 255, 0.5));
  --link-hover: var(--run-lo); --marked: var(--run-lo);
  --glass-base: 255, 255, 255; --glass-kind: "Light glass, dark words.";`;

const SMOKED_GLASS = `color-scheme: dark;
  --ink: #F7F9FC; --ink-2: rgba(247, 249, 252, 0.86); --muted: rgba(247, 249, 252, 0.7); --line: rgba(255, 255, 255, 0.2);
  --glass-edge: rgba(255, 255, 255, 0.16); --field: rgba(255, 255, 255, 0.08);
  --glass-tint: rgba(14, 17, 24, 0.55); --glass-top: rgba(18, 21, 27, 0.5); --glass-menu: rgba(18, 21, 27, 0.62);
  --glass-sheen: linear-gradient(170deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0) 55%);
  --well: rgba(255, 255, 255, 0.08); --well-shade: inset 0 1px 3px rgba(0, 0, 0, 0.3);
  --slab: rgba(255, 255, 255, 0.2); --slab-shade: 0 0 0 transparent; --ghost: rgba(255, 255, 255, 0.1);
  --btn: rgba(255, 255, 255, 0.14); --btn-hover: rgba(255, 255, 255, 0.26);
  --field-face: rgba(255, 255, 255, 0.08); --field-hover: rgba(255, 255, 255, 0.12); --field-focus: rgba(255, 255, 255, 0.16);
  --field-shade: inset 0 1px 3px rgba(0, 0, 0, 0.25); --field-outline: rgba(255, 255, 255, 0.18);
  --show: rgba(255, 255, 255, 0.1); --show-on: rgba(255, 255, 255, 0.22);
  --pick: rgba(255, 255, 255, 0.06); --pick-shade: inset 0 1px 3px rgba(0, 0, 0, 0.3), inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  --done: rgba(255, 255, 255, 0.12); --done-line: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  --glass-btn: linear-gradient(180deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.06)); --glass-btn-edge: rgba(255, 255, 255, 0.16);
  --glass-btn-shade: 0 6px 16px rgba(0, 0, 0, 0.25), inset 0 -1px 0 rgba(255, 255, 255, 0.04);
  --glass-btn-lift: 0 10px 22px rgba(0, 0, 0, 0.32), inset 0 -1px 0 rgba(255, 255, 255, 0.06);
  --outline: rgba(255, 255, 255, 0.3); --clear-hover: rgba(255, 255, 255, 0.08);
  --chip-face: rgba(52, 211, 120, 0.22); --chip-ink: #A6F0C6; --face-ring: rgba(6, 8, 12, 0.55); --presence-ring: #1A1D24;
  --rail-line: rgba(255, 255, 255, 0.2); --rail-thumb: rgba(255, 255, 255, 0.55); --rail-edge: rgba(255, 255, 255, 0.35); --rail-mark: rgba(255, 255, 255, 0.5);
  /* On smoked glass the rim's inner lines and bevel are softened, so the frame reads as an edge, not as lines across it. */
  --edge-inner: rgba(255, 255, 255, 0.12); --edge-bevel: 0.35; --edge-rim: 0.7; --edge-fringe: 0.5;
  --logo-halo: drop-shadow(0 0 12px rgba(4, 7, 14, 0.75)) drop-shadow(0 1px 2px rgba(4, 7, 14, 0.6));
  --link-hover: var(--run-hi); --marked: var(--run-hi);
  --glass-base: 14, 17, 24; --glass-kind: "Smoked glass, light words.";`;

/**
 * The tokens. Light or dark follows the system unless a choice is fixed with data-theme-choice, on <html>
 * or on any element (the gallery's stage fixes it for what's inside). Dark is smoked glass over a night-dark
 * page. Smoked glass on its own is the class smoke on any ancestor: a dark game's background smokes the
 * glass over it whatever the theme, since the theme changes only Zaisma's own backgrounds.
 */
export const TOKEN_STYLES = `
@font-face { font-family: Jost; src: url(/fonts/jost.woff2) format("woff2"); font-weight: 100 900; font-display: swap; }
@property --refl { syntax: "<percentage>"; inherits: false; initial-value: 50%; }
:root {
  color-scheme: light dark;
  --run: #F7931A; --run-hi: #FFB24A; --run-lo: #A85A06;
  /* The only red: a delete's confirm step, never anything else. */
  --danger: #D93A2B; --danger-lo: #A82718;
  --page: #EEF2F7;
  --display: "Jost", Futura, "Century Gothic", "Avenir Next", sans-serif;
  --body: -apple-system, "Segoe UI", system-ui, sans-serif;
  --spring: cubic-bezier(.3, 1.2, .4, 1);
}
:root, [data-theme-choice="light"] { ${LIGHT_GLASS} --page: #EEF2F7; }
@media (prefers-color-scheme: dark) { :root:not([data-theme-choice="light"]) { ${SMOKED_GLASS} --page: #0D1015; } }
[data-theme-choice="dark"] { ${SMOKED_GLASS} --page: #0D1015; }
.smoke { ${SMOKED_GLASS} }
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* The glass: clear, no sheen. A slab of it has cut corners and a drawn rim (the svg.edge GLASS_SCRIPT draws). */
.glass { position: relative; color: var(--ink); background-color: var(--glass-tint); background-image: var(--glass-sheen);
  -webkit-backdrop-filter: blur(26px) saturate(1.7); backdrop-filter: blur(26px) saturate(1.7); transition: background-color 0.5s ease, color 0.3s ease; }
.glass > :not(.edge) { position: relative; z-index: 3; }
.edge { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 2; overflow: visible; }
.edge .inner { stroke: var(--edge-inner); }
.edge .bevel { opacity: var(--edge-bevel); }
.edge .rim { opacity: var(--edge-rim); }
.edge .fringe { opacity: var(--edge-fringe); }
/* A slanted outline drawn just inside a cut field or button, so its slanted ends are outlined like its top and bottom. */
.cut-line { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1; overflow: visible; }
.cut-line polygon { fill: none; stroke: var(--line); stroke-width: 1; transition: stroke 0.3s; }
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
export const railMarkup = (scrollKind: "box" | "page"): Raw => raw(`<div class="rail" data-rail="${scrollKind}" aria-hidden="true"><div class="rail-line"></div><div class="rail-thumb"></div></div>`);

/** An outline for a cut field or button (GLASS_SCRIPT draws it), and a slab's drawn rim. */
export const CUT_LINE = raw('<svg class="cut-line" aria-hidden="true"><polygon/></svg>');
export const EDGE = raw('<svg class="edge" aria-hidden="true"></svg>');

/**
 * glass(el, corners) and cutLine(el, slant), from the header draft, as window.zaismaGlass and window.zaismaCutLine.
 * On load, and for elements added later, they're applied to every [data-glass] (corners from data-glass-corners,
 * like "16 6 16 6") and every [data-cut-line] (the slant in its value).
 */
export const GLASS_SCRIPT = `/* glass */(function () {
  var SVG = "http://www.w3.org/2000/svg";
  /* The sign-in pane's glass, for any slab: cut corners and the drawn rim (dark hairline, polished edge, bevel band, faint rainbow fringe, bright cut facets). */
  function cutShape(w, h, c, inset) {
    var i = inset, k = inset * 0.414;
    return [[i, c[0] + k], [c[0] + k, i], [w - c[1] - k, i], [w - i, c[1] + k], [w - i, h - c[2] - k], [w - c[2] - k, h - i], [c[3] + k, h - i], [i, h - c[3] - k]]
      .map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ");
  }
  var made = 0;
  // The rim is built once; while the slab changes size only its points move, so nothing is rebuilt mid-animation (rebuilding it each frame made the edges flicker).
  // The cut corners are a clip-path in CSS terms (calc with 100%), so it follows the slab's size by itself and is only set again when the corners change.
  function glass(el, corners) {
    var edge = el.querySelector(":scope > .edge"), id = "zg" + (made++), parts = null, lastCorners = "";
    if (!edge) { edge = document.createElementNS(SVG, "svg"); edge.setAttribute("class", "edge"); edge.setAttribute("aria-hidden", "true"); el.appendChild(edge); }
    function node(tag, attributes) { var n = document.createElementNS(SVG, tag); for (var name in attributes) n.setAttribute(name, attributes[name]); edge.appendChild(n); return n; }
    function build() {
      edge.innerHTML =
        '<defs>' +
        '<linearGradient id="' + id + 'rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="0.45" stop-color="#fff" stop-opacity="0.7"/><stop offset="1" stop-color="#dfe9f7" stop-opacity="0.9"/></linearGradient>' +
        '<linearGradient id="' + id + 'bev" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.5"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.12"/><stop offset="1" stop-color="#b9cde8" stop-opacity="0.28"/></linearGradient>' +
        '<linearGradient id="' + id + 'fr" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7fd8ff" stop-opacity="0.5"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#ffc58a" stop-opacity="0.5"/></linearGradient>' +
        '</defs>';
      parts = {
        bevel: node("path", { "class": "bevel", fill: "url(#" + id + "bev)", "fill-rule": "evenodd" }),
        hair: node("polygon", { "class": "hair", fill: "none", stroke: "rgba(26,44,80,0.28)", "stroke-width": "1.2" }),
        rim: node("polygon", { "class": "rim", fill: "none", stroke: "url(#" + id + "rim)", "stroke-width": "1.6" }),
        fringe: node("polygon", { "class": "fringe", fill: "none", stroke: "url(#" + id + "fr)", "stroke-width": "1" }),
        inner: node("polygon", { "class": "inner", fill: "none", "stroke-width": "1" }),
        facets: [0, 1, 2, 3].map(function (i) { return node("line", { "class": "facet", stroke: i === 0 ? "#fff" : "rgba(255,255,255,0.8)", "stroke-width": i === 0 ? "4.5" : "3" }); })
      };
    }
    function draw() {
      var w = el.offsetWidth, h = el.offsetHeight, c = corners(), band = 6;
      if (!w || !h) return;
      if (!parts) build();
      var key = c.join(",");
      if (key !== lastCorners) {
        lastCorners = key;
        el.style.clipPath = "polygon(0 " + c[0] + "px, " + c[0] + "px 0, calc(100% - " + c[1] + "px) 0, 100% " + c[1] + "px, 100% calc(100% - " + c[2] + "px), calc(100% - " + c[2] + "px) 100%, " + c[3] + "px 100%, 0 calc(100% - " + c[3] + "px))";
      }
      // No viewBox: the rim is drawn in CSS pixels, so a frame where the slab has grown before its points move never stretches it.
      edge.removeAttribute("viewBox");
      parts.bevel.setAttribute("d", "M" + cutShape(w, h, c, 0) + "Z M" + cutShape(w, h, c, band) + "Z");
      parts.hair.setAttribute("points", cutShape(w, h, c, 0.6));
      parts.rim.setAttribute("points", cutShape(w, h, c, 1.6));
      parts.fringe.setAttribute("points", cutShape(w, h, c, 3.2));
      parts.inner.setAttribute("points", cutShape(w, h, c, band));
      [[[0, c[0]], [c[0], 0]], [[w - c[1], 0], [w, c[1]]], [[w, h - c[2]], [w - c[2], h]], [[c[3], h], [0, h - c[3]]]].forEach(function (f, i) {
        var line = parts.facets[i];
        line.style.display = c[i] ? "" : "none";
        line.setAttribute("x1", f[0][0]); line.setAttribute("y1", f[0][1]); line.setAttribute("x2", f[1][0]); line.setAttribute("y2", f[1][1]);
      });
    }
    draw();
    if (window.ResizeObserver) new ResizeObserver(draw).observe(el); else window.addEventListener("resize", draw);
    return draw;
  }
  // A slanted outline drawn just inside a cut field, so its slanted ends are outlined like its top and bottom.
  function cutLine(el, slant) {
    var svg = el.querySelector(":scope > .cut-line");
    if (!svg) { svg = document.createElementNS(SVG, "svg"); svg.setAttribute("class", "cut-line"); svg.setAttribute("aria-hidden", "true"); svg.appendChild(document.createElementNS(SVG, "polygon")); el.insertBefore(svg, el.firstChild); }
    var poly = svg.querySelector("polygon");
    function draw() {
      var w = el.offsetWidth, h = el.offsetHeight, i = 1; if (!w || !h) return; var side = i * Math.hypot(slant, h) / h;
      svg.setAttribute("viewBox", "0 0 " + w + " " + h);
      var at = function (y) { return slant * (1 - y / h); };
      poly.setAttribute("points", [[at(i) + side, i], [w - slant * (i / h) - side, i], [w - slant * ((h - i) / h) - side, h - i], [at(h - i) + side, h - i]].map(function (p) { return p[0].toFixed(2) + "," + p[1].toFixed(2); }).join(" "));
    }
    draw();
    if (window.ResizeObserver) new ResizeObserver(draw).observe(el); else window.addEventListener("resize", draw);
  }
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
    lines.forEach(function (el) {
      if (done.has(el)) return; done.add(el);
      cutLine(el, Number(el.getAttribute("data-cut-line")) || 10);
    });
  }
  apply(document);
  new MutationObserver(function (changes) { changes.forEach(function (change) { change.addedNodes.forEach(apply); }); }).observe(document.body, { subtree: true, childList: true });
})();
`;

/* ---- The foundations in the gallery: tokens, type, glass, cut shapes, motion and icons. ---- */

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
  html`<ul class="swatches">${SWATCHES.map(({ token, note }) => html`<li><span class="chip-swatch" style="background:var(${token})"></span><code>${token}</code><span>${note}</span></li>`)}</ul>`;

component({
  name: "Colour",
  slug: "colour",
  group: "foundations",
  summary: "Every colour comes from these tokens, so light, dark and smoked glass follow by themselves. Orange is only for what you act on.",
  styles: `
/* Colour: the gallery's swatches. */
.swatches { width: 100%; list-style: none; margin: 0; padding: 14px; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px 18px; color: var(--ink); background: var(--glass-tint); -webkit-backdrop-filter: blur(26px) saturate(1.7); backdrop-filter: blur(26px) saturate(1.7); }
.swatches li { display: grid; grid-template-columns: 36px 1fr; grid-template-rows: auto auto; column-gap: 10px; align-items: center; font: 500 13px var(--display); }
.swatches .chip-swatch { grid-row: span 2; width: 36px; height: 36px; box-shadow: inset 0 0 0 1px var(--line); clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px); }
.swatches code { font: 600 13px ui-monospace, Menlo, monospace; }
.swatches span:last-child { color: var(--muted); }
`,
  examples: [
    { label: "Every token, in the theme you chose", markup: swatches(), isWide: true },
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

const glassStrip = (body: Raw) => html`<div class="glass-strip"><i></i><i></i><i></i>${body}</div>`;

component({
  name: "Glass",
  slug: "glass",
  group: "foundations",
  summary: "Zaisma's interface is glass over the page or the game. It's as thin as the words allow: light with dark words, or smoked with light words.",
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
`,
  examples: [
    {
      label: "Thin to thick, in the theme you chose",
      isWide: true,
      markup: glassStrip(html`${[35, 55, 72].map((glassOpacityPct) => html`<div class="glass" data-glass data-glass-corners="18 9 18 9" style="--glass-tint:rgba(var(--glass-base),${glassOpacityPct / 100})"><strong>${glassOpacityPct}%</strong><span class="glass-kind"></span></div>`)}`),
    },
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
      label: "Header 16/6, pane 18/9, slant 10",
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
.motion-demo { position: relative; display: grid; grid-template-columns: 1fr 1fr; width: 320px; height: 44px; padding: 4px; background: var(--well); box-shadow: var(--well-shade);
  clip-path: polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%); }
.motion-demo .slab { position: absolute; top: 4px; bottom: 4px; left: 4px; width: calc(50% - 4px); background: var(--slab); box-shadow: var(--slab-shade), inset 0 -3px 0 var(--run);
  clip-path: polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%); transition: transform 0.55s var(--spring); }
.motion-demo span:not(.slab) { position: relative; display: grid; place-items: center; font: 500 15px var(--display); color: var(--ink-2); cursor: default; }
.motion-demo span.second:hover ~ .slab, .motion-demo:has(.second:hover) .slab { transform: translateX(100%); }
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
