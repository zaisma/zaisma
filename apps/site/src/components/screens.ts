import { html, type Raw } from "../markup.ts";
import { pageScript } from "../page-scripts.ts";
import { component } from "./component.ts";
import { tag } from "./foundations.ts";

/*
 * Screens: the bench's look. One page on a phone, the same phone turned and a laptop, side by side, as one live page: what's wrong on any of
 * them shows without flipping a phone or opening a link. It's where a page is reviewed, never made. The bench itself, its copying,
 * profiles and states, is the preview's (scripts/preview/bench/): only its look is here, and the gallery's one link to it shows only on a local site.
 */

export const SCREENS_PATH = "/design/screens";

/** The three screens: a common phone (an iPhone 15 or 16), the same phone turned and a laptop, with what the bench shows them at in a window of about 1440 x 790. */
export const BENCH_SCREENS = [
  { screenName: "phone", name: "Phone", widthPx: 393, heightPx: 852, statusBarPx: 59, scalePct: 82, isPhone: true },
  { screenName: "turned", name: "Turned", widthPx: 852, heightPx: 393, scalePct: 64, isPhone: true },
  { screenName: "laptop", name: "Laptop", widthPx: 1440, heightPx: 900, scalePct: 57, isPhone: false },
] as const;

export interface BenchScreenOptions {
  screenName: string;
  name: string;
  widthPx: number;
  heightPx: number;
  /** The status bar's height on a phone held upright: the page starts under it, as in a browser, and the Dynamic Island sits in it. */
  statusBarPx?: number;
  isPhone: boolean;
  scalePct: number;
  /** The page in it, only for the gallery: on the bench its script loads each. */
  framePath?: string;
}

/** One live screen: a frame at the screen's own size, so its media queries and layout are the screen's, scaled to fit. A phone's sits in a black body shaped like a real one, which shows where the screen ends. */
export function benchScreen(options: BenchScreenOptions): Raw {
  const scaleNumber = options.scalePct / 100;
  return html`<figure class="bench-screen is-${options.screenName}${options.isPhone ? " is-phone" : ""}" data-bench-screen="${options.screenName}" data-bench-name="${options.name}" data-width-px="${String(options.widthPx)}" data-height-px="${String(options.heightPx)}" data-scale-pct="${String(options.scalePct)}" style="--screen-scale: ${String(scaleNumber)}; --screen-width: ${String(options.widthPx * scaleNumber)}px; --screen-height: ${String(options.heightPx * scaleNumber)}px">
<div class="bench-body"><div class="bench-view" data-cut-line="0"><iframe title="${options.name}" width="${String(options.widthPx)}" height="${String(options.heightPx - (options.statusBarPx ?? 0))}" style="--status-bar: ${String(options.statusBarPx ?? 0)}px; transform: scale(${String(scaleNumber)})"${options.framePath ? html` src="${options.framePath}"` : ""}></iframe></div></div>
</figure>`;
}

/** A screen's name and percent, with "Didn't follow" beside it when a press had nothing to land on there. */
const screenLabel = (options: { screenName: string; name: string; scalePct: number }): Raw => html`<span class="bench-screen-label"><span class="bench-screen-name" data-bench-screen-name="${options.screenName}">${options.name}, ${String(options.scalePct)}%</span><span data-bench-follow-note="${options.screenName}" hidden>${tag("Didn't follow", "warning")}</span></span>`;

export interface BenchLayoutOptions {
  /** The left rail: everything that can grow. It never pushes the screens. */
  rail: Raw;
  /** Replay, Slow, Dark and On my phone, under the phone. */
  tools: Raw;
  /** The light box's tools, under the screen pressed. */
  bigTools: Raw;
  /** The phone, the turned phone and the laptop, in that order (benchScreen). */
  screens: Raw[];
}

/** The bench: a rail and the screens, always in view, the page never scrolling. A light box dims the screens behind the one pressed, and leaves the rail working. */
export function benchLayout(options: BenchLayoutOptions): Raw {
  const [phone, turned, laptop] = options.screens;
  const [phoneScreen, turnedScreen, laptopScreen] = BENCH_SCREENS;
  return html`<div class="bench" data-bench>
<aside class="bench-rail glass" aria-label="What to show">${options.rail}</aside>
<div class="bench-stage">
<div class="bench-phone-column">${phone}<div class="bench-under-phone">${screenLabel(phoneScreen)}<div class="bench-tools">${options.tools}</div></div></div>
<div class="bench-wide-column"><div class="bench-turned-row">${turned}<div class="bench-screen-labels">${screenLabel(turnedScreen)}${screenLabel(laptopScreen)}</div></div>${laptop}</div>
<div class="bench-dim"></div>
<div class="bench-big-tools" hidden>${options.bigTools}</div>
</div>
</div>`;
}

/**
 * What placed a thing, as a script any page can load (Screens puts it in each screen's page, and the preview's feedback overlay calls
 * it): window.zaismaInspect(element) answers { component, label, layoutRule, element } for the component under it (null for words of a
 * page's own), its words, what placed it (its size class, its layout's gap and why, its pane's width and margins), and the element to
 * outline. Any /js/layout-inspect.<hash>.js address serves it.
 */
export const LAYOUT_INSPECT_SCRIPT = pageScript("layout-inspect", String.raw`(function () {
  var COMPONENTS = { "run-wrap": "Primary button", "cut-btn": "Secondary button", "tertiary-btn": "Tertiary button", "cut-field": "Field", "field": "Field", "find": "Search", "switch-well": "Switch", "tab-switch": "Switch", "steps": "Row arrows", "cover": "Cover", "banner": "Banner", "table": "Table", "list-rows": "List rows", "choice-card": "Choice card", "toggle": "Toggle", "check": "Check", "shelf": "Shelf", "tag": "Tag", "link": "Text link", "glass-pane": "Glass pane", "tray": "Tray", "sheet": "Sheet", "top": "Header", "foot": "Footer" };
  var GAPS = { "words-words": "words next to words", "words-control": "words next to a control", "control-stack": "two controls, one over the other", "control-row-boxes": "two controls side by side, their slants overlapping", "block-block": "a block next to anything" };
  function componentOf(el, cell) {
    for (var walk = el; walk && walk !== cell && walk.classList; walk = walk.parentElement) {
      for (var name in COMPONENTS) if (walk.classList.contains(name)) return { el: walk, name: COMPONENTS[name] };
    }
    return null;
  }
  // A token's length, worked out: a probe in the page takes it as its margin for a moment.
  function lengthPx(token) {
    var probe = document.createElement("div"); probe.style.cssText = "position:absolute;visibility:hidden;margin-left:var(" + token + ")"; document.body.append(probe);
    var found = parseFloat(getComputedStyle(probe).marginLeft); probe.remove(); return Math.round(found * 10) / 10;
  }
  function px(token) { var found = lengthPx(token); return found < 0 ? -found + "px overlap" : found + "px"; }
  var SIZES = ["small", "regular", "field", "big"];
  function sizeOf(el) {
    var face = (el.matches(".run-wrap, .cut-btn") ? el.querySelector(".face") : el.querySelector(".field")) || el, height = parseFloat(getComputedStyle(face).height);
    var named = SIZES.find(function (name) { return Math.abs(lengthPx("--control-height-" + name) - height) < 1; });
    return height ? Math.round(height) + "px tall" + (named ? " (" + named + ")" : "") : "";
  }
  function gapOf(cell, prefix) { var found = Array.prototype.find.call(cell.classList, function (name) { return name.indexOf(prefix) === 0; }); return found ? found.slice(prefix.length) : ""; }
  window.zaismaInspect = function (target) {
    var cell = target.closest(".stack-cell, .row-cell, .grid-cell"), thing = componentOf(target, cell ? cell.parentElement : null), said = [];
    var el = thing ? thing.el : cell || target;
    var label = (el.getAttribute("aria-label") || el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 32);
    var kind = cell ? (cell.classList.contains("is-words") ? "words" : cell.classList.contains("is-control") ? "a control" : "a block") : "";
    var sizeWords = thing && kind === "a control" ? sizeOf(thing.el) : "";
    if (sizeWords) said.push(sizeWords);
    if (cell && cell.classList.contains("stack-cell")) {
      var above = gapOf(cell, "gap-top-");
      said.push(above ? "Stack: " + px("--gap-" + above) + " above it, " + GAPS[above] + " (--gap-" + above + ")" : "Stack: first, at the top");
    } else if (cell && cell.classList.contains("row-cell")) {
      var after = cell.nextElementSibling ? gapOf(cell, "gap-end-") : "";
      said.push("Row, " + (cell.classList.contains("fills") ? "filling" : "fitting its words") + (after ? ": " + px("--gap-" + after) + " after it, " + GAPS[after] + " (--gap-" + after + ")" : ""));
    } else if (cell) said.push("Grid: a cell of " + (Array.prototype.find.call(cell.parentElement.classList, function (name) { return name.indexOf("item-") === 0; }) || "item-").slice(5) + "s");
    var pane = el.closest(".glass-pane, .tray, .sheet");
    if (pane && pane !== el) {
      said.push((pane.classList.contains("fit") ? "In a pane that fits what's in it" : pane.classList.contains("glass-pane") ? "In a full-width pane" : "On a " + (pane.classList.contains("tray") ? "tray" : "sheet")) +
        (kind === "words" ? ": keeps the words' margin, " + px("--pad-pane") + " (--pad-frame and --pad-words)" : ": at the frame gap, " + px("--pad-frame") + " (--pad-frame)"));
    }
    return { component: thing ? thing.name : null, label: label, layoutRule: said.length ? said.join(" · ") : null, element: el };
  };
})();
`);

component({
  name: "Screens",
  slug: "screens",
  group: "layout",
  summary: "The bench: one page on a phone, the same phone turned and a laptop, side by side, as one live page, with a rail of everything that can be pressed. It's where a page is reviewed, never made: only on a local preview, which adds what copies a press across the screens. A press on a screen, anywhere but a control in its page, opens it large, the others dimmed behind it.",
  styles: `
/* The bench fills the window and never scrolls: the rail holds what can grow, so nothing pushes the screens. */
html:has(.bench), html:has(.bench) body { height: 100%; overflow: hidden; }
.bench { --bench-bezel: 6px; position: fixed; inset: 0; display: grid; grid-template-columns: 16.25rem minmax(0, 1fr); gap: var(--pad-frame-compact); padding: var(--pad-frame-compact); box-sizing: border-box; background: var(--page); color: var(--ink); }
.bench-rail > * { flex: none; }
.bench-rail > .find { flex: none; --control-height: var(--control-height-small); }
.bench-rail { --control-height: var(--control-height-small); display: flex; flex-direction: column; gap: var(--gap-words-words); min-height: 0; overflow-y: auto; padding: var(--pad-frame); scrollbar-width: none; }
.bench-menus, .bench-buttons { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--pad-frame-compact); }
.bench-menus > *, .bench-buttons > * { min-width: 0; }
.bench-menus .cut-btn, .bench-buttons .cut-btn { display: flex; width: 100%; }
.bench-group-name { margin: 0; padding-inline: var(--pad-words); font: var(--type-note); color: var(--ink-2); }
.bench-seen { display: flex; align-items: center; justify-content: space-between; gap: var(--pad-frame-compact); }
.bench-group { display: flex; flex-direction: column; gap: var(--pad-frame-compact); }
.bench-rail-foot { margin-top: auto; display: flex; flex-direction: column; align-items: flex-start; gap: var(--gap-words-words); }
.bench-note { margin: 0; padding-inline: var(--pad-words); font: var(--type-note); color: var(--ink-2); }
.bench-stage { position: relative; display: flex; gap: var(--pad-frame-compact); min-width: 0; min-height: 0; }
.bench-phone-column { display: flex; flex-direction: column; gap: var(--gap-words-words); flex: none; width: min-content; }
.bench-under-phone { display: flex; flex-direction: column; gap: var(--pad-frame-compact); }
.bench-tools, .bench-screen-label, .bench-screen-labels { display: flex; flex-wrap: wrap; gap: var(--pad-frame-compact); align-items: center; }
.bench-screen-labels { flex-direction: column; align-items: flex-start; justify-content: flex-end; min-width: 0; }
.bench-screen-name { padding-inline: var(--pad-words); font: var(--type-note); color: var(--ink-2); cursor: zoom-in; }
.bench-wide-column { display: flex; flex-direction: column; gap: var(--pad-frame-compact); min-width: 0; }
.bench-turned-row { display: flex; gap: var(--gap-words-words); }
.bench-screen { margin: 0; width: var(--screen-width); height: var(--screen-height); flex: none; }
.bench-body { width: 100%; height: 100%; box-sizing: border-box; }
.bench-view { position: relative; width: 100%; height: 100%; overflow: hidden; background: var(--well); box-shadow: var(--well-shade); }
.bench-view > iframe { position: absolute; left: 0; top: calc(var(--status-bar) * var(--screen-scale)); border: 0; transform-origin: 0 0; background: var(--page); }
/* A phone: a black body round the screen, shaped like an iPhone 15 or 16, so the screen's edges show against any page: its 55pt corners and its Dynamic Island, about 126 by 37pt and 11pt from the edge, all at the screen's scale. A page upright starts under the status bar, as in a browser, so nothing reaches behind the island, and the bar takes the color the browser would (the screen's script says which); turned, the screen's script gives it a phone's safe areas. */
.bench-screen.is-phone { --phone-corner: calc(55px * var(--screen-scale)); --phone-island-long: calc(126px * var(--screen-scale)); --phone-island-short: calc(37px * var(--screen-scale)); --phone-island-inset: calc(11px * var(--screen-scale)); width: calc(var(--screen-width) + 2 * var(--bench-bezel)); height: calc(var(--screen-height) + 2 * var(--bench-bezel)); }
.bench-screen.is-phone > .bench-body { padding: var(--bench-bezel); background: #000; border-radius: calc(var(--phone-corner) + var(--bench-bezel)); box-shadow: 0 0 0 1px color-mix(in srgb, white 16%, transparent); cursor: zoom-in; }
.bench-screen.is-phone .bench-view { border-radius: var(--phone-corner); background: var(--status-bar-color, var(--well)); }
.bench-screen.is-phone .bench-view::after { content: ""; position: absolute; z-index: 1; background: #000; border-radius: var(--phone-island-short); pointer-events: none; }
.bench-screen.is-phone:not(.is-turned) .bench-view::after { top: var(--phone-island-inset); left: 50%; width: var(--phone-island-long); height: var(--phone-island-short); transform: translateX(-50%); }
.bench-screen.is-turned .bench-view::after { left: var(--phone-island-inset); top: 50%; height: var(--phone-island-long); width: var(--phone-island-short); transform: translateY(-50%); }
/* The light box: the others dimmed behind the one pressed, the rail still working. */
.bench-dim { display: none; position: absolute; inset: 0; z-index: 3; background: var(--page); opacity: 0.88; }
.bench-is-big .bench-dim { display: block; }
.bench-screen.is-big > .bench-body { position: fixed; z-index: 4; cursor: auto; }
.bench-big-tools { position: absolute; left: 0; right: 0; bottom: 0; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: var(--gap-words-control); }
.bench-big-tools[hidden] { display: none; }
.bench-big-tools .slider { flex: 0 1 18rem; }
`,
  render: benchLayout,
  examples: [{ label: "A phone screen showing the example page", isWide: true, markup: benchScreen({ screenName: "phone", name: "Phone", widthPx: 393, heightPx: 852, statusBarPx: 59, isPhone: true, scalePct: 40, framePath: "/design/example" }) }],
});
