import { html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { controlMarkup, type ControlMarkup } from "./control-markup.ts";
import { CUT_LINE, icon, tag, well, type IconName } from "./foundations.ts";

/*
 * The switch, from the sign-in draft's Sign in / Make an account switch and the home draft's sort switch, and the three foundations
 * that sit with it because they show or use a real one: the color picker, page settings and motion. Split from inputs.ts.
 */

const VERTICAL_PLACES: SwitchTab[] = [
  { label: "Home", icon: "play", isCurrent: true },
  { label: "Your games", icon: "person", badgeCount: 3, isCurrent: false },
  { label: "Friends", icon: "friends", isCurrent: false },
  { label: "Forum", icon: "mail", badgeCount: 12, isCurrent: false },
  { label: "Settings", icon: "gear", isCurrent: false },
];

export interface SwitchTab {
  label: string;
  /** A link to another page; without one it's a button with aria-pressed. */
  href?: string;
  /** A button's value, for a page script to read. */
  tabValue?: string;
  isCurrent: boolean;
  /** Before its label (a vertical switch's places). */
  icon?: IconName;
  /** A small number at its end, like unread topics: a Tag. */
  badgeCount?: number;
  /** Attributes of its own, like a data attribute a script reads. */
  extra?: Raw;
  /** It can fold away into the end of the tabs (the header's Developer and Forum, off a developer page): folded, it takes no room and can't be reached. */
  isFoldable?: boolean;
  isFolded?: boolean;
  /** Can't be chosen now (a sort with nothing to sort by yet): it's faded and answers nothing. */
  isDisabled?: boolean;
  /** The gallery's fixed states: its words at full ink as if pointed at, or the focus line round it. */
  state?: "is-pointed" | "is-focused";
}

/** The switch: a carved well, a raised slab under the one you're on, and a faint one under the one you point at. */
export function tabSwitch(options: {
  label: string;
  tabs: SwitchTab[];
  switchSize: "big" | "small";
  isVertical?: boolean;
  /** Across only: it fills the width it's in, its tabs sharing it (a pane's head: Sign in or Make an account), rather than its words' width. */
  isFull?: boolean;
}): ControlMarkup {
  const isSmall = options.switchSize === "small";
  const inside = (tab: SwitchTab) =>
    tab.icon || tab.badgeCount ? html`${tab.icon ? icon(tab.icon) : ""}<span>${tab.label}</span>${tab.badgeCount ? tag(tab.badgeCount, "count") : ""}` : html`${tab.label}`;
  const kind = `${options.switchSize}${options.isVertical ? " vertical" : ""}`;
  const classNames = (tab: SwitchTab) => [tab.isFoldable ? "foldable" : "", tab.isFoldable && tab.isFolded ? "folded" : "", tab.state ?? ""].filter(Boolean).join(" ");
  const folding = (tab: SwitchTab) =>
    html`${classNames(tab) ? html` class="${classNames(tab)}"` : ""}${tab.isFoldable && tab.isFolded ? raw(' tabindex="-1" aria-hidden="true"') : ""}`;
  const tabSwitch = html`<div class="tab-switch ${kind}" role="group" aria-label="${options.label}"><span class="slab cut-raised" aria-hidden="true" data-cut-line="${isSmall ? 7 : 8}">${CUT_LINE}</span><span class="focus-ring" aria-hidden="true" data-cut-line="${isSmall ? 9 : 10}">${CUT_LINE}</span>${options.tabs.map((tab) =>
    tab.href
      ? // A link that can't be followed now has no address, so nothing reaches it; it still says what it is.
        html`<a data-lights${tab.isDisabled ? raw(' aria-disabled="true"') : html` href="${tab.href}"`}${folding(tab)}${tab.extra ?? ""}${tab.isCurrent ? raw(' aria-current="page"') : ""}>${inside(tab)}</a>`
      : html`<button type="button" data-lights${folding(tab)}${tab.extra ?? ""}${tab.tabValue !== undefined ? html` value="${tab.tabValue}"` : ""} aria-pressed="${tab.isCurrent ? "true" : "false"}"${tab.isDisabled ? raw(" disabled") : ""}>${inside(tab)}</button>`,
  )}</div>`;
  // Its tabs sit in a Well, which stays put while they scroll inside it, fading at its ends: across, with the rail under the well;
  // stacked, with the rail beside its places.
  return controlMarkup(
    well({
      kind: `switch-well ${kind}${options.isFull && !options.isVertical ? " is-full" : ""}`,
      scrollDirection: options.isVertical ? "down" : "across",
      cornerCutPx: isSmall ? 9 : 10,
      edgeLight: options.isVertical ? "left" : "bottom",
      body: tabSwitch,
    }),
    isSmall ? "small" : "regular",
  );
}

/** The switch's slab sits under the one you're on, sliding on the spring; a tab you point at only lights its words (CSS). */
export const SWITCH_SCRIPT = `/* switches */(function () {
  window.zaismaWatch.each(".tab-switch", function (sw) {
    var slab = sw.querySelector(".slab"), tabs = sw.querySelectorAll(":scope > a, :scope > button"), isVertical = sw.classList.contains("vertical");
    function current() { return sw.querySelector('[aria-current="page"], [aria-pressed="true"]'); }
    // How far a part reaches past a tab's box on a side where another tab is beside it: its slant, less the gap a row of controls keeps.
    var rowGapPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--gap-control-row")) || 4;
    function besideReach(el) { return Math.max(0, ((Number(el.getAttribute("data-cut-line")) || 0) - rowGapPx) / 2); }
    // The slab is one size on every tab (its tabs are one width), so it slides as a fixed piece of glass. One clock moves it: each frame its
    // place is set and its cut shape and bevel (which blend between a tab at the switch's end and one beside another) drawn in the same step,
    // so nothing trails it. It eases in and out to its tab with no overshoot (cubic-bezier(.4, 0, .2, 1)), landing on a whole device pixel,
    // so it never jumps as it starts, swings back past its place or snaps a pixel as it settles. --slide-ms long.
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    function onPixel(px) { var ratio = window.devicePixelRatio || 1; return Math.round(px * ratio) / ratio; }
    // A cubic-bezier(x1, y1, x2, y2) curve: x(u) solved for u by Newton's method, then y(u).
    function bezier(x1, y1, x2, y2) {
      return function (t) {
        var u = t;
        for (var i = 0; i < 8; i++) {
          var x = 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u - t, dx = 3 * (1 - u) * (1 - u) * x1 + 6 * (1 - u) * u * (x2 - x1) + 3 * u * u * (1 - x2);
          if (Math.abs(dx) < 1e-6) break; u = Math.min(1, Math.max(0, u - x / dx));
        }
        return 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u;
      };
    }
    // Pushed, it gathers speed, then settles into its tab: an ease in and out, never past its place.
    var slideEase = bezier(0.4, 0, 0.2, 1);
    // Its size in whole pixels, as its cut shape measures it (offsetWidth), so the shape is drawn for the size it has.
    function place(el, at) {
      el.slideAt = at; var sizePx = Math.round(at.size) + "px";
      if (isVertical) { el.style.height = sizePx; el.style.transform = "translateY(" + at.pos + "px)"; } else { el.style.width = sizePx; el.style.transform = "translateX(" + at.pos + "px)"; }
    }
    function slide(el, to, ms) {
      var from = el.slideAt || to, startMs = performance.now(), id = (el.slideId || 0) + 1; el.slideId = id;
      (function frame() {
        if (el.slideId !== id) return;
        var t = Math.min(1, (performance.now() - startMs) / ms), e = slideEase(t);
        // Its shape is drawn before it's moved: drawing reads its size, and reading after a move would lay the page out again mid-frame.
        if (el.redrawCut) el.redrawCut();
        // Between pixels as it moves (its own layer moves it smoothly there; whole steps stuttered where it goes slowly), on one as it lands.
        place(el, { pos: t < 1 ? from.pos + (to.pos - from.pos) * e : to.pos, size: to.size });
        if (t < 1) requestAnimationFrame(frame);
      })();
    }
    // isGliding: the slab is moving there, so its shape blends from the old place's to the new one's over the move.
    function put(el, tab, isGliding) {
      if (!tab) { el.style.width = "0px"; return; }
      var from = { beside: el.getAttribute("data-cut-beside"), ends: el.getAttribute("data-cut-ends") || "", stack: el.getAttribute("data-cut-stack") };
      // A folded tab takes no room, so the ends are the first and last tabs shown.
      var shown = Array.prototype.filter.call(tabs, function (each) { return !each.classList.contains("folded"); });
      var isFirst = tab === shown[0], isLast = tab === shown[shown.length - 1];
      // Vertical: the slab spans the well's width and moves down it; it never slants, and only on the first or last tab does it follow the well's top or bottom.
      if (isVertical) {
        var toY = { pos: tab.offsetTop, size: tab.offsetHeight }, msY = isGliding && !reduce ? slideMs(el) : 0;
        // The focus line runs along the well's own edge: on the first or last place, out to the well's end.
        if (el.classList.contains("focus-ring")) {
          var topPx = isFirst ? 0 : tab.offsetTop, bottomPx = isLast ? sw.getBoundingClientRect().height : tab.offsetTop + tab.offsetHeight, heightPx = Math.round(bottomPx - topPx);
          toY = { pos: isLast ? bottomPx - heightPx : topPx, size: heightPx };
        }
        el.setAttribute("data-cut-beside", "");
        el.setAttribute("data-cut-stack", ((isFirst ? "first " : "") + (isLast ? "last" : "")).trim());
        if (el.redrawCut) el.redrawCut(msY && from.stack !== null ? { from: from, ms: msY, ease: slideEase, isDriven: true } : undefined);
        if (msY) slide(el, toY, msY); else { el.slideId = (el.slideId || 0) + 1; place(el, toY); if (el.redrawCut) el.redrawCut(); }
        return;
      }
      // Beside another tab, it reaches into the slant between them, so only the row's gap is left between its place and the next one's.
      var reach = besideReach(el), start = isFirst ? 0 : reach, end = isLast ? 0 : reach;
      var to = { pos: onPixel(tab.offsetLeft - start), size: tab.offsetWidth + start + end }, ms = isGliding && !reduce ? slideMs(el) : 0;
      // The focus line runs along the well's own edge: on the first or last tab, out to the well's end.
      // Its size is whole pixels (place), so on the last tab it's set back from the well's end by what rounding adds, never past it, where the
      // well's cut would trim its line.
      if (el.classList.contains("focus-ring")) {
        var leftPx = isFirst ? 0 : tab.offsetLeft - start, rightPx = isLast ? sw.getBoundingClientRect().width : tab.offsetLeft + tab.offsetWidth + end, sizePx = Math.round(rightPx - leftPx);
        to = { pos: isLast ? rightPx - sizePx : leftPx, size: sizePx };
      }
      // The edge rule: the slab slants only where another tab is beside it, and its end on the first or last tab follows the switch's end.
      el.setAttribute("data-cut-beside", ((isFirst ? "" : "start ") + (isLast ? "" : "end")).trim());
      var ends = ((isFirst ? "start " : "") + (isLast ? "end" : "")).trim();
      if (ends) el.setAttribute("data-cut-ends", ends); else el.removeAttribute("data-cut-ends");
      if (el.redrawCut) el.redrawCut(ms && from.beside !== null ? { from: from, ms: ms, ease: slideEase, isDriven: true } : undefined);
      if (ms) slide(el, to, ms); else { el.slideId = (el.slideId || 0) + 1; place(el, to); if (el.redrawCut) el.redrawCut(); }
    }
    function slideMs(el) { return parseFloat(getComputedStyle(el).getPropertyValue("--slide-ms")) || 550; }
    // While a slide from the last page waits or plays, nothing moves the slab: a settle then (the fonts, a picture in the header loading)
    // would set the slab again under the slide, and a phone's browser can restart the slide from there, jumping it back.
    var isWaitingToSlide = false;
    // The gallery's fixed state: a tab marked is-focused has the focus line round it (one marked is-pointed is CSS's alone).
    function fixedStates() {
      var focused = sw.querySelector(":scope > .is-focused"), ring = sw.querySelector(".focus-ring");
      if (focused && ring) { put(ring, focused); sw.classList.add("is-focus-shown"); }
    }
    function settle() { if (isWaitingToSlide) return; var on = current(), focused = sw.querySelector(":scope > :focus-visible"), ring = sw.querySelector(".focus-ring"); slab.style.transition = "none"; put(slab, on); if (ring && focused) put(ring, focused); fixedStates(); slab.offsetWidth; slab.style.transition = ""; sw.classList.add("is-ready"); }
    settle();
    // A switch of links that was on the last page too (the gallery's groups): once this page shows, its slab slides from the last page's tab
    // to this one's. Only its position moves (and, sideways, its width as a stretch), as a compositor animation, like the old sidebar's glide:
    // nothing is laid out or redrawn while the new page is still starting, and the settles that follow (fonts, the first resize) can't cut it short.
    var came = window.navigation && navigation.activation && navigation.activation.from;
    if (came && came.url && slab.animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // The tab whose page it came from: by its whole address, or by its path where only one tab has it (Browse's sorts are all /games, so
      // coming from a Browse address no tab has, none of them is the last page's and nothing slides).
      var cameFrom = new URL(came.url), lastPath = cameFrom.pathname;
      var samePath = Array.prototype.filter.call(tabs, function (tab) { return tab.href && new URL(tab.href).pathname === lastPath; });
      var last = samePath.find(function (tab) { return new URL(tab.href).search === cameFrom.search; }) || (samePath.length === 1 ? samePath[0] : undefined);
      var on = current();
      if (last && on && last !== on) {
        // Measured once the fonts are in (from the cache, on a page of the same site), when the tabs have their widths, so it lands where the slab is.
        var slideFromLastPage = function () {
          var from = isVertical ? "translateY(" + last.offsetTop + "px)" : "translateX(" + last.offsetLeft + "px) scaleX(" + (last.offsetWidth / Math.max(1, on.offsetWidth)).toFixed(4) + ")";
          var to = isVertical ? "translateY(" + on.offsetTop + "px)" : "translateX(" + on.offsetLeft + "px) scaleX(1)";
          return slab.animate([{ transform: from, transformOrigin: "0 0" }, { transform: to, transformOrigin: "0 0" }], { duration: slideMs(slab), easing: "cubic-bezier(.3, 1.2, .4, 1)" });
        };
        // Until then it waits on the last page's tab; it starts with the page, as the view transition fades it in.
        slab.style.transition = "none"; put(slab, last); slab.offsetWidth; slab.style.transition = "";
        isWaitingToSlide = true;
        // It starts once the page shows, not before (a slow phone draws the new page late, and a slide started earlier would show up already
        // halfway there), and once the page's crossfade from the last one (its view transition) is over, so the slab moves on the page
        // itself and not inside the crossfade's picture of it. Once it lands, the slab settles where its tab is by then.
        var start = function () {
          requestAnimationFrame(function () {
            var fades = document.getAnimations ? document.getAnimations().filter(function (each) { return each.effect && /^::view-transition/.test(each.effect.pseudoElement || ""); }) : [];
            Promise.all(fades.map(function (each) { return each.finished.catch(function () {}); })).then(function () {
              isWaitingToSlide = false; settle(); isWaitingToSlide = true;
              var land = function () { isWaitingToSlide = false; settle(); };
              slideFromLastPage().finished.then(land, land);
            });
          });
        };
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(start); else start();
      }
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(settle);
    window.zaismaWatch.size(sw, settle);
    // A switch as wide as its tabs doesn't change size when its room grows, so the room it has is watched too, to give its tabs back their room.
    if (!isVertical && sw.parentElement) window.zaismaWatch.size(sw.parentElement, settle);
    // A page script can pick a tab too (the gallery's Light or Dark, when the theme changes elsewhere).
    sw.pickTab = function (tab) {
      if (tab.tagName === "BUTTON") tabs.forEach(function (each) { each.setAttribute("aria-pressed", String(each === tab)); });
      // A link within this page (or one a page script shows) becomes the one you're on, so pressing it again stays put and the one you left slides back.
      else tabs.forEach(function (each) { if (each === tab) each.setAttribute("aria-current", "page"); else each.removeAttribute("aria-current"); });
      put(slab, tab, true);
      // In a row that scrolls, the picked tab comes whole into view, clear of the row's fades (SCROLL_FADE_SCRIPT's showWhole).
      var row = sw.closest("[data-fades-sideways]");
      if (row && row.showWhole) row.showWhole(tab, true);
    };
    function isDisabled(tab) { return tab.disabled || tab.getAttribute("aria-disabled") === "true"; }
    tabs.forEach(function (tab) {
      // A link to another page doesn't slide here: the page changes at once, and the next page slides it in from this tab, so the slide
      // plays once. Only a link within this page (its address but for the #), or one a page script shows without leaving, slides here.
      tab.addEventListener("click", function (event) {
        if (isDisabled(tab)) return;
        // The tab you're on is where you are: pressing it again changes nothing (a new tab or window from it still opens).
        if (tab.href && tab.getAttribute("aria-current") === "page" && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); return; }
        if (tab.href && !event.defaultPrevented) {
          var to = new URL(tab.href, location.href);
          if (to.pathname !== location.pathname || to.search !== location.search) return;
        }
        sw.pickTab(tab);
      });
    });
    // Keyboard focus: the ring takes the focused tab's place and shape, so the focus line follows its cut.
    var ring = sw.querySelector(".focus-ring");
    sw.addEventListener("focusin", function (event) {
      var tab = event.target;
      if (!ring || tab.parentElement !== sw || !tab.matches(":focus-visible")) return;
      put(ring, tab); sw.classList.add("is-focus-shown");
    });
    sw.addEventListener("focusout", function () { sw.classList.remove("is-focus-shown"); });
  });
  // A page left with a view transition fades out as the next fades in. A switch with a tab for the next page leaves its slab out of this
  // page's last picture, so only the next page's slab shows, sliding over from this tab, and not a second one fading where it was.
  window.addEventListener("pageswap", function (event) {
    if (!event.viewTransition || !event.activation || !event.activation.entry || !event.activation.entry.url) return;
    var to = new URL(event.activation.entry.url);
    document.querySelectorAll(".tab-switch").forEach(function (sw) {
      var slab = sw.querySelector(":scope > .slab");
      var isGoing = Array.prototype.some.call(sw.querySelectorAll(":scope > a[href]"), function (tab) { return new URL(tab.href).pathname === to.pathname && tab.getAttribute("aria-current") !== "page"; });
      if (slab && isGoing) slab.style.visibility = "hidden";
    });
  });
  // A page kept to go back to gets its slabs back.
  window.addEventListener("pageshow", function () { document.querySelectorAll(".tab-switch > .slab").forEach(function (slab) { slab.style.visibility = ""; }); });
})();
`;

component({
  name: "Switch",
  slug: "switch",
  group: "inputs",
  subgroup: "choices",
  summary: "Choosing one of a few: Sign in or Make an account (big), Recently played or Recently updated (small). Of links, a page's own sections under its title (a game's dashboard, a profile); stacked, a page's own places down its side.",
  styles: `
/* The switch: the header's and the home's. A carved well, a raised slab under the one you're on, lit like any raised glass, and a faint one under the
   one you point at. No orange: it's a choice, not the thing to do, so orange is left for keyboard focus.
   It's as big as what's in it: its size is its words' (a small switch's are 14px, a big one's 16px) and the room round them, all round
   (--tab-room across, --tab-room-y up and down), never a height of its own. Past its room across it scrolls sideways (in its Well, with the
   rail under it), and stacked, past a menu's height it scrolls down (with the rail beside it). */
.tab-switch { --control-height: var(--control-height-regular); --tab-room: 20px; --tab-room-y: 9px; position: relative; display: flex; min-width: 0; padding: 4px; background: var(--well); box-shadow: var(--well-shade);
  clip-path: var(--cut-shape); }
/* It slides for --slide-ms (SWITCH_SCRIPT moves it frame by frame, its shape with it), never by a CSS transition, on a layer of its own so a
   frame that only moves it isn't painted again. */
.tab-switch .slab { --slide-ms: 450; position: absolute; top: 4px; bottom: 4px; left: 0; width: 0; pointer-events: none; clip-path: var(--cut-shape); transition: opacity 0.3s; will-change: transform; }
/* The slab is a raised piece of glass with the face and bevel of a raised button (--btn, the raise bands), so its edges catch the light, and it
   casts a soft shadow into the well under it (--slab-cast), which the well's cut keeps inside it. Its face is cut to its shape below its
   bevel, so the slab itself isn't clipped and its shadow shows. */
.tab-switch .slab { clip-path: none; filter: var(--slab-cast); }
.tab-switch .slab::before { content: ""; position: absolute; inset: 0; background: var(--btn); clip-path: var(--cut-shape); }
.tab-switch > a, .tab-switch > button { position: relative; z-index: 2; display: grid; place-content: center; min-height: calc(var(--control-height) - 2 * var(--switch-inset, 4px)); padding: var(--tab-room-y) var(--tab-room); border: 0; background: none; cursor: pointer;
  font: 500 1rem/1.1 var(--display); color: var(--ink-2); text-decoration: none; white-space: nowrap; }
/* Its tabs are at least its size's control height, less its inset, so it lines up with the controls beside it at any text size. */
/* Across, it's as wide as its tabs, one line each, and its tabs are all one width, the widest's, so the slab is one size on every tab and
   only slides: glass doesn't change size as it moves. Past the room it has, its Well stays put, a carving can't move or
   fade, and what's in it scrolls inside it, fading at its ends, with the rail under the well. */
.well.switch-well { align-items: stretch; width: max-content; max-width: 100%; min-height: 0; }
.well.switch-well > .well-body { min-width: 0; padding: 0; font: inherit; }
/* Full: it fills the width it's in, its tabs sharing it, past their words' width. */
.well.switch-well.is-full { width: 100%; }
.well.switch-well.is-full .tab-switch { width: auto; min-width: 100%; }
.tab-switch:not(.vertical) { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; width: max-content; background: none; box-shadow: none; clip-path: none; }
/* The one you're on is marked by its slab and full ink, at the same weight as the others, so its words never move as it's chosen. */
.tab-switch [aria-current="page"], .tab-switch [aria-pressed="true"] { color: var(--ink); }
/* Pointed at (a mouse's; a tap shows nothing), a tab you're not on takes full ink, and the well's edge light (Edge light, Panes › Glass)
   floods up beside it: its lower edge across, its edge beside the places stacked. The well itself never changes: only light. */
@media (hover: hover) { .tab-switch > :is(a, button):not(:disabled, [aria-disabled="true"], [aria-current="page"], [aria-pressed="true"]):hover { color: var(--ink); } }
.tab-switch > .is-pointed { color: var(--ink); }
/* One that can't be chosen now: faded, and it answers nothing (pointing at it lights nothing). */
.tab-switch > [aria-disabled="true"], .tab-switch > :disabled { cursor: default; opacity: 0.4; }
/* Before the script has measured, the one you're on carries its own slab. */
.tab-switch:not(.is-ready) [aria-current="page"], .tab-switch:not(.is-ready) [aria-pressed="true"] { background: var(--btn); box-shadow: var(--slab-shade); }
/* A tab that folds away into the end of the tabs and opens out of it again. */
.tab-switch > .foldable { max-width: 10rem; overflow: hidden; transition: max-width 0.45s cubic-bezier(.2,.8,.2,1), padding 0.45s cubic-bezier(.2,.8,.2,1), opacity 0.3s 0.08s; }
/* Its tabs share one width, so a folded tab takes no column at all: it goes, and comes back, at once. */
.tab-switch:not(.vertical) > .foldable.folded { display: none; }
/* Across, an open foldable tab keeps its words' width (its clip for folding would let it shrink), so a narrow row scrolls rather than cut it. */
.tab-switch:not(.vertical) > .foldable:not(.folded) { min-width: max-content; }
.tab-switch > .foldable.folded { max-width: 0; padding-left: 0; padding-right: 0; opacity: 0; pointer-events: none; transition: max-width 0.4s cubic-bezier(.4,0,.2,1), padding 0.4s cubic-bezier(.4,0,.2,1), opacity 0.16s; }
/* Keyboard focus: a line round the focused tab that follows its cut, like the slab's (the focus ring, set by SWITCH_SCRIPT). */
.tab-switch > :focus-visible { outline: none; }
/* It runs along the well's own edge, the switch's full height (its full width stacked), with the well's cuts at the switch's ends, so
   there's no gap between the line and the well. */
.tab-switch .focus-ring { position: absolute; top: 0; bottom: 0; left: 0; width: 0; z-index: 3; pointer-events: none; clip-path: var(--cut-shape); opacity: 0; }
.tab-switch.vertical .focus-ring { top: 0; bottom: auto; left: 0; right: 0; width: auto; height: 0; }
.tab-switch.is-focus-shown .focus-ring { opacity: 1; }
.tab-switch .focus-ring .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
/* Only its line: no bevel, so a focused tab never looks carved in or raised. */
.tab-switch .focus-ring > .cut-line { --band-top: transparent; --band-left: transparent; --band-right: transparent; --band-bottom: transparent; }
/* Small: a sort under a heading, the header's switch. */
.tab-switch.small { --control-height: var(--control-height-small); --switch-inset: 3px; --tab-room: 14px; --tab-room-y: 7px; padding: 3px; clip-path: var(--cut-shape); }
.tab-switch.small .slab { --slide-ms: 380; top: 3px; bottom: 3px; }
.tab-switch.small > a, .tab-switch.small > button { font-size: 0.875rem; }
/* Across, the well is its room's, so the tabs' box in its track has none of its own (after .small, which would cut it to the well's shape). */
.switch-well > .well-body > .tab-switch { background: none; box-shadow: none; clip-path: none; }
.well.switch-well.small { --control-height: var(--control-height-small); }
/* The tabs take their well's height, which a row sets to its tallest control's (layout.ts): a small sort beside a regular Filter is the Filter's height. */
.switch-well > .well-body > .tab-switch { --control-height: inherit; }
/* A tab's words sit in the middle of its slab as it's seen. A slab between two tabs slants on both sides, so its words are in the middle
   of the tab; on the first or last tab it slants only on its inner side, which pulls its seen middle a quarter of a slant toward the
   switch's end, so the words move that far with it (a fifth of a slant more room on the inner side). The room round the words clears the switch's corners. */
.tab-switch:not(.vertical) > :nth-child(1 of :not(.folded):not([aria-hidden])) { padding-inline-end: calc(var(--tab-room) + var(--control-slant) / 5); }
.tab-switch:not(.vertical) > :nth-last-child(1 of :not(.folded):not([aria-hidden])) { padding-inline-start: calc(var(--tab-room) + var(--control-slant) / 5); }
/* Vertical: the same switch stacked, its places down a carved well (a page's own places, the gallery's groups). Each place is a row of
   its icon, its words and a count at its end; the slab spans the well and moves down it, and a place you point at lights its words. */
.tab-switch.vertical { flex-direction: column; }
/* Stacked, the well is no taller than a menu; past that its places scroll inside it, the rail beside them. */
.well.switch-well.vertical { flex-direction: column; width: auto; }
.well.switch-well.vertical > .well-body { flex: 0 1 auto; min-height: 0; overflow-x: hidden; }
.tab-switch.vertical .slab { top: 0; bottom: auto; left: 4px; right: 4px; width: auto; height: 0; }
.tab-switch.vertical.small .slab { left: 3px; right: 3px; }
.tab-switch.vertical > a, .tab-switch.vertical > button { flex: none; display: flex; align-items: center; justify-content: flex-start; gap: 10px; padding: var(--tab-room-y) 14px; text-align: left; }
.tab-switch.vertical > a > .tag, .tab-switch.vertical > button > .tag { margin-left: auto; }
.tab-switch.vertical .ico { width: 18px; height: 18px; }
/* A count in a tab across sits just after its words. */
.tab-switch:not(.vertical) > :is(a, button):has(> .tag) { display: flex; align-items: center; gap: var(--gap-words-words); }
/* On a touch screen a switch is at least a regular control tall, and each tab's hit area takes in the well's inset above and below it, so a
   finger always has a regular control's height to land on (the clip round the well would cut off anything reaching further). */
@media (pointer: coarse) {
  .tab-switch:not(.vertical) { min-height: var(--control-height-regular); }
  .tab-switch > :not([aria-hidden])::before { content: ""; position: absolute; left: 0; right: 0; top: min(0px, calc((100% - var(--touch-target)) / 2)); bottom: min(0px, calc((100% - var(--touch-target)) / 2)); }
}
@media (prefers-reduced-motion: reduce) { .tab-switch .slab, .tab-switch > .foldable { transition: none; } }
`,
  render: tabSwitch,
  examples: [
    {
      label: "Big",
      markup: tabSwitch({ label: "Sign in or make an account", switchSize: "big", tabs: [{ label: "Sign in", isCurrent: true }, { label: "Make an account", isCurrent: false }] }),
    },
    {
      label: "Full: it fills its place, its tabs sharing the width (a pane's head)",
      markup: html`<div style="width:min(420px,100%)">${tabSwitch({ label: "Sign in or make an account", switchSize: "big", isFull: true, tabs: [{ label: "Sign in", isCurrent: true }, { label: "Make an account", isCurrent: false }] })}</div>`,
    },
    {
      label: "Small",
      markup: tabSwitch({ label: "Sort", switchSize: "small", tabs: [{ label: "Recently played", tabValue: "played", isCurrent: true }, { label: "Recently updated", tabValue: "updated", isCurrent: false }] }),
    },
    {
      label: "More tabs than fit across: it scrolls sideways, with the rail under it",
      markup: html`<div style="width:min(16rem,100%)">${tabSwitch({ label: "Sort", switchSize: "small", tabs: ["Recently played", "Recently updated", "Most played", "Newest"].map((label, tabIndex) => ({ label, tabValue: String(tabIndex), isCurrent: tabIndex === 0 })) })}</div>`,
    },
    {
      label: "Pointed: its words at full ink, the well's edge under it catching the light",
      markup: tabSwitch({ label: "Sort", switchSize: "small", tabs: [{ label: "Recently played", tabValue: "played", isCurrent: true }, { label: "Recently updated", tabValue: "updated", isCurrent: false, state: "is-pointed" }] }),
      isStill: true,
    },
    {
      label: "Keyboard focus",
      markup: tabSwitch({ label: "Sort", switchSize: "small", tabs: [{ label: "Recently played", tabValue: "played", isCurrent: true }, { label: "Recently updated", tabValue: "updated", isCurrent: false, state: "is-focused" }] }),
      isStill: true,
    },
    {
      label: "One that can't be chosen yet: Friends, before you've added any",
      markup: tabSwitch({ label: "Whose scores", switchSize: "small", tabs: [{ label: "Everyone", tabValue: "everyone", isCurrent: true }, { label: "Friends", tabValue: "friends", isCurrent: false, isDisabled: true }] }),
    },
    {
      label: "With counts, the one you're on too",
      markup: tabSwitch({ label: "Inbox", switchSize: "small", tabs: [{ label: "Replies", href: "#switch", badgeCount: 3, isCurrent: true }, { label: "Mentions", href: "#switch", badgeCount: 12, isCurrent: false }] }),
    },
    {
      label: "A page's sections: big, of links, with counts, scrolling sideways past its room (a game's dashboard)",
      markup: html`<div style="width:min(30rem,100%)">${tabSwitch({ label: "Game sections", switchSize: "big", tabs: ["Overview", "Versions", "Players", "Rooms", "Saves", "Reports", "Stats", "Settings"].map((label) => ({ label, href: "#switch", isCurrent: label === "Players", badgeCount: label === "Players" ? 4 : label === "Reports" ? 12 : undefined })) })}</div>`,
    },
    {
      label: "On a loop",
      markup: html`<div data-state-loop="switch">${tabSwitch({ label: "Sort", switchSize: "small", tabs: [{ label: "Recently played", tabValue: "played", isCurrent: true }, { label: "Recently updated", tabValue: "updated", isCurrent: false }] })}</div>`,
      isStill: true,
    },
    {
      label: "Vertical: a page's places, with icons and counts",
      markup: html`<div style="width:min(260px,100%)">${tabSwitch({ label: "Places", switchSize: "big", isVertical: true, tabs: VERTICAL_PLACES })}</div>`,
    },
    {
      label: "Vertical, more places than fit: it scrolls down, with the rail beside it",
      markup: html`<div style="width:min(240px,100%)">${tabSwitch({ label: "Groups", switchSize: "big", isVertical: true, tabs: ["Foundations", "Actions", "Inputs", "Navigation", "Panes", "Data", "Layout", "Words", "Pictures", "Backgrounds", "Cards", "Layers", "Menus"].map((label, tabIndex) => ({ label, isCurrent: tabIndex === 2 })) })}</div>`,
    },
    {
      label: "Vertical, plain",
      markup: html`<div style="width:min(220px,100%)">${tabSwitch({ label: "Groups", switchSize: "big", isVertical: true, tabs: ["Foundations", "Actions", "Inputs", "Navigation"].map((label, tabIndex) => ({ label, isCurrent: tabIndex === 1 })) })}</div>`,
    },
  ],
});


// Motion sits with the switch, whose slab shows it, so it can use the real one (foundations.ts can't import this file).
component({
  name: "Motion",
  slug: "motion",
  group: "foundations",
  subgroup: "look",
  summary: "Things move only when pointed at, pressed or chosen: a slab springs across on the spring curve (--spring) in 0.55s, 0.4s for a small one, and a change of size takes 0.45s. Reduced motion stops all of it.",
  styles: "",
  examples: [
    {
      label: "Choose a tab: the slab springs across",
      markup: html`<div style="width:min(380px,100%)">${tabSwitch({ label: "Motion", switchSize: "big", tabs: [{ label: "Spring 0.55s", isCurrent: true }, { label: "Choose me", isCurrent: false }] })}</div>`,
    },
  ],
});
