import { html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { controlMarkup, type ControlMarkup } from "./control-markup.ts";
import { CUT_LINE, colorPicker, icon, tag, type ColorChoice, type IconName } from "./foundations.ts";
import { TINT_CHOICES, rowArrows } from "./actions.ts";

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
  /** The gallery's fixed states: the ghost under it as if pointed at, or the focus line round it. */
  state?: "is-pointed" | "is-focused";
}

/** The switch: a clear well, a white slab with the orange line under the one you're on, and a faint one under the one you point at. */
export function tabSwitch(options: {
  label: string;
  tabs: SwitchTab[];
  switchSize: "big" | "small";
  isFramed?: boolean;
  isVertical?: boolean;
  /** Framed only: the id of the row its tabs scroll in. With one, a mouse gets Row arrows after the frame to scroll it while its tabs don't fit. */
  rowId?: string;
}): ControlMarkup {
  const isSmall = options.switchSize === "small";
  const inside = (tab: SwitchTab) =>
    tab.icon || tab.badgeCount ? html`${tab.icon ? icon(tab.icon) : ""}<span>${tab.label}</span>${tab.badgeCount ? tag(tab.badgeCount, "count") : ""}` : html`${tab.label}`;
  const kind = `${options.switchSize}${options.isVertical ? " vertical" : ""}`;
  const classNames = (tab: SwitchTab) => [tab.isFoldable ? "foldable" : "", tab.isFoldable && tab.isFolded ? "folded" : "", tab.state ?? ""].filter(Boolean).join(" ");
  const folding = (tab: SwitchTab) =>
    html`${classNames(tab) ? html` class="${classNames(tab)}"` : ""}${tab.isFoldable && tab.isFolded ? raw(' tabindex="-1" aria-hidden="true"') : ""}`;
  // Framed: in a carved frame of its own that it scrolls inside, fading at its ends (the header's tabs, the gallery's groups on a phone), so
  // the switch has no well or cut of its own, and its slab's ends on the first and last tabs follow the frame's ends.
  const own = options.isFramed
    ? html`${options.rowId ? raw('<div class="switch-scroll">') : ""}<div class="switch-frame cut-carved ${options.switchSize}" data-cut-line="${isSmall ? 9 : 10}">${CUT_LINE}<div class="switch-frame-row"${options.rowId ? html` id="${options.rowId}"` : ""} data-fades-sideways><div class="tab-switch framed ${kind}" role="group" aria-label="${options.label}">`
    : html`<div class="tab-switch cut-carved ${kind}" role="group" aria-label="${options.label}" data-cut-line="${isSmall ? 9 : 10}">${CUT_LINE}`;
  return controlMarkup(html`${own}<span class="ghost" aria-hidden="true" data-cut-line="${isSmall ? 7 : 8}"></span><span class="slab cut-raised" aria-hidden="true" data-cut-line="${isSmall ? 7 : 8}">${CUT_LINE}</span><span class="focus-ring" aria-hidden="true" data-cut-line="${isSmall ? 7 : 8}">${CUT_LINE}</span>${options.tabs.map((tab) =>
    tab.href
      ? // A link that can't be followed now has no address, so nothing reaches it; it still says what it is.
        html`<a${tab.isDisabled ? raw(' aria-disabled="true"') : html` href="${tab.href}"`}${folding(tab)}${tab.extra ?? ""}${tab.isCurrent ? raw(' aria-current="page"') : ""}>${inside(tab)}</a>`
      : html`<button type="button"${folding(tab)}${tab.extra ?? ""}${tab.tabValue !== undefined ? html` value="${tab.tabValue}"` : ""} aria-pressed="${tab.isCurrent ? "true" : "false"}"${tab.isDisabled ? raw(" disabled") : ""}>${inside(tab)}</button>`,
  )}</div>${options.isFramed ? raw("</div></div>") : ""}${options.isFramed && options.rowId ? html`${rowArrows({ rowName: options.label, trackId: options.rowId })}</div>` : ""}`, isSmall ? "small" : "regular");
}

/** The switch's slab sits under the one you're on, the ghost follows the pointer across the others, both with the spring. */
export const SWITCH_SCRIPT = `/* switches */(function () {
  window.zaismaWatch.each(".tab-switch", function (sw) {
    var slab = sw.querySelector(".slab"), ghost = sw.querySelector(".ghost"), tabs = sw.querySelectorAll(":scope > a, :scope > button"), isVertical = sw.classList.contains("vertical");
    function current() { return sw.querySelector('[aria-current="page"], [aria-pressed="true"]'); }
    // How far a part reaches past a tab's box on a side where another tab is beside it: its slant, less the gap a row of controls keeps.
    var rowGapPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--gap-control-row")) || 4;
    function besideReach(el) { return Math.max(0, ((Number(el.getAttribute("data-cut-line")) || 0) - rowGapPx) / 2); }
    // isGliding: the slab is moving there, so its shape blends from the old place's to the new one's over the move.
    function put(el, tab, isGliding) {
      if (!tab) { el.style.width = "0px"; return; }
      var from = { beside: el.getAttribute("data-cut-beside"), ends: el.getAttribute("data-cut-ends") || "", stack: el.getAttribute("data-cut-stack") };
      // A folded tab takes no room, so the ends are the first and last tabs shown.
      var shown = Array.prototype.filter.call(tabs, function (each) { return !each.classList.contains("folded"); });
      var isFirst = tab === shown[0], isLast = tab === shown[shown.length - 1];
      // Vertical: the slab spans the well's width and moves down it; it never slants, and only on the first or last tab does it follow the well's top or bottom.
      if (isVertical) {
        el.style.height = tab.offsetHeight + "px"; el.style.transform = "translateY(" + tab.offsetTop + "px)";
        el.setAttribute("data-cut-beside", "");
        el.setAttribute("data-cut-stack", ((isFirst ? "first " : "") + (isLast ? "last" : "")).trim());
        if (el.redrawCut) el.redrawCut(isGliding && from.stack !== null ? { from: from, ms: parseFloat(getComputedStyle(el).transitionDuration) * 1000 } : undefined);
        return;
      }
      // Beside another tab, it reaches into the slant between them, so only the row's gap is left between its place and the next one's.
      var reach = besideReach(el), start = isFirst ? 0 : reach, end = isLast ? 0 : reach;
      el.style.width = tab.offsetWidth + start + end + "px"; el.style.transform = "translateX(" + (tab.offsetLeft - start) + "px)";
      // The edge rule: the slab slants only where another tab is beside it, and its end on the first or last tab follows the switch's end.
      el.setAttribute("data-cut-beside", ((isFirst ? "" : "start ") + (isLast ? "" : "end")).trim());
      var ends = ((isFirst ? "start " : "") + (isLast ? "end" : "")).trim();
      if (ends) el.setAttribute("data-cut-ends", ends); else el.removeAttribute("data-cut-ends");
      if (el.redrawCut) el.redrawCut(isGliding && from.beside !== null ? { from: from, ms: parseFloat(getComputedStyle(el).transitionDuration) * 1000 } : undefined);
    }
    // A switch on its own (not framed, so it can't scroll) is never wider than its room: where its tabs don't fit, each gives up the same
    // share of the room round its words (--tab-room), down to LEAST_ROOM_PX, so the tabs share the width instead of spilling out of it.
    var LEAST_ROOM_PX = 6;
    function fit() {
      if (isVertical || sw.classList.contains("framed")) return;
      sw.style.removeProperty("--tab-room");
      var overflowPx = sw.scrollWidth - sw.clientWidth, shown = Array.prototype.filter.call(tabs, function (tab) { return !tab.classList.contains("folded"); });
      if (overflowPx <= 0.5 || !shown.length) return;
      var roomPx = parseFloat(getComputedStyle(sw).getPropertyValue("--tab-room")) || LEAST_ROOM_PX;
      sw.style.setProperty("--tab-room", Math.max(LEAST_ROOM_PX, roomPx - overflowPx / (2 * shown.length)).toFixed(2) + "px");
    }
    // While a slide from the last page waits or plays, nothing moves the slab: a settle then (the fonts, a picture in the header loading)
    // would set the slab again under the slide, and a phone's browser can restart the slide from there, jumping it back.
    var isWaitingToSlide = false;
    // The gallery's fixed states: a tab marked is-pointed has the ghost under it, one marked is-focused the focus line round it.
    function fixedStates() {
      var pointed = sw.querySelector(":scope > .is-pointed"), focused = sw.querySelector(":scope > .is-focused"), ring = sw.querySelector(".focus-ring");
      if (pointed) { put(ghost, pointed); sw.classList.add("pointing"); }
      if (focused && ring) { put(ring, focused); sw.classList.add("is-focus-shown"); }
    }
    function settle() { if (isWaitingToSlide) return; fit(); var on = current(), focused = sw.querySelector(":scope > :focus-visible"), ring = sw.querySelector(".focus-ring"); slab.style.transition = "none"; put(slab, on); put(ghost, on); if (ring && focused) put(ring, focused); fixedStates(); slab.offsetWidth; slab.style.transition = ""; sw.classList.add("is-ready"); }
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
        var slide = function () {
          var from = isVertical ? "translateY(" + last.offsetTop + "px)" : "translateX(" + last.offsetLeft + "px) scaleX(" + (last.offsetWidth / Math.max(1, on.offsetWidth)).toFixed(4) + ")";
          var to = isVertical ? "translateY(" + on.offsetTop + "px)" : "translateX(" + on.offsetLeft + "px) scaleX(1)";
          return slab.animate([{ transform: from, transformOrigin: "0 0" }, { transform: to, transformOrigin: "0 0" }], { duration: parseFloat(getComputedStyle(slab).transitionDuration) * 1000 || 550, easing: "cubic-bezier(.3, 1.2, .4, 1)" });
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
              slide().finished.then(land, land);
            });
          });
        };
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(start); else start();
      }
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(settle);
    window.zaismaWatch.size(sw, settle);
    // A switch as wide as its tabs doesn't change size when its room grows, so the room it has is watched too, to give its tabs back their room.
    if (!isVertical && !sw.classList.contains("framed") && sw.parentElement) window.zaismaWatch.size(sw.parentElement, settle);
    // A page script can pick a tab too (the gallery's Light or Dark, when the theme changes elsewhere).
    sw.pickTab = function (tab) {
      sw.classList.remove("pointing");
      if (tab.tagName === "BUTTON") tabs.forEach(function (each) { each.setAttribute("aria-pressed", String(each === tab)); });
      put(slab, tab, true); put(ghost, tab, true);
      // In a row that scrolls, the picked tab comes whole into view, clear of the row's fades (SCROLL_FADE_SCRIPT's showWhole).
      var row = sw.closest("[data-fades-sideways]");
      if (row && row.showWhole) row.showWhole(tab, true);
    };
    function isDisabled(tab) { return tab.disabled || tab.getAttribute("aria-disabled") === "true"; }
    tabs.forEach(function (tab) {
      // Pointing is a mouse's: a tap fires it too, and on a link to another page the ghost would glide there before the next page slides the slab.
      tab.addEventListener("pointerenter", function (event) { if (isDisabled(tab) || (event.pointerType && event.pointerType !== "mouse")) return; if (tab !== current()) { put(ghost, tab); sw.classList.add("pointing"); } else sw.classList.remove("pointing"); });
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
    sw.addEventListener("pointerleave", function () { sw.classList.remove("pointing"); });
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
  summary: "Choosing one of a few: Sign in or Make an account (big), Recently played or Recently updated (small). Stacked, it's a page's own places down its side.",
  styles: `
/* The switch: the header's and the home's. A clear well, a white slab with the orange line under the one you're on, and a faint one under the one you point at.
   It's never wider than its room: where its tabs don't fit, they keep less room round their words (--tab-room, SWITCH_SCRIPT) and share it. */
.tab-switch { --control-height: var(--control-height-regular); --tab-room: 18px; position: relative; display: flex; min-width: 0; max-width: 100%; height: var(--control-height); padding: 4px; background: var(--well); box-shadow: var(--well-shade);
  clip-path: var(--cut-shape); }
.tab-switch .slab, .tab-switch .ghost { position: absolute; top: 4px; bottom: 4px; left: 0; width: 0; pointer-events: none; clip-path: var(--cut-shape);
  transition: transform 0.55s var(--spring), width 0.55s var(--spring), opacity 0.3s; }
.tab-switch .slab { clip-path: var(--cut-shape); background: var(--slab); box-shadow: var(--slab-shade), inset 0 -3px 0 var(--run); }
.tab-switch .ghost { background: var(--ghost); opacity: 0; }
.tab-switch.pointing .ghost { opacity: 1; }
.tab-switch > a, .tab-switch > button { position: relative; z-index: 2; display: grid; place-content: center; padding: 0 var(--tab-room); border: 0; background: none; cursor: pointer;
  font: 500 0.9375rem var(--display); color: var(--ink-2); text-decoration: none; white-space: nowrap; }
/* A switch across that has less room than its words (a narrow place, a large text size) stays inside it: its tabs' words wrap onto a second line in
   the same height rather than run past its end. One that scrolls sideways (framed) keeps them on one line. */
.tab-switch:not(.vertical, .framed) { max-width: 100%; }
.tab-switch:not(.vertical, .framed) > :is(a, button) { min-width: 0; white-space: normal; line-height: 1.1; text-align: center; }
.tab-switch.big > a, .tab-switch.big > button { flex: 1 1 0; }
/* The one you're on is marked by its slab and full ink, at the same weight as the others, so its words never move as it's chosen. */
.tab-switch [aria-current="page"], .tab-switch [aria-pressed="true"] { color: var(--ink); }
/* One that can't be chosen now: faded, and it answers nothing (SWITCH_SCRIPT gives it no ghost). */
.tab-switch > [aria-disabled="true"], .tab-switch > :disabled { cursor: default; opacity: 0.4; }
/* Before the script has measured, the one you're on carries its own slab. */
.tab-switch:not(.is-ready) [aria-current="page"], .tab-switch:not(.is-ready) [aria-pressed="true"] { background: var(--slab); box-shadow: inset 0 -3px 0 var(--run); }
/* Framed: the carved frame is its own (.switch-frame), --switch-height tall (a size class's height), and the tabs scroll inside it. */
.switch-frame { position: relative; display: flex; flex: none; min-width: 0; height: var(--switch-height, var(--control-height-regular)); background: var(--well); box-shadow: var(--well-shade); clip-path: var(--cut-shape);
  transition: height 0.45s cubic-bezier(.2,.8,.2,1); }
.switch-frame.small { height: var(--switch-height, var(--control-height-small)); }
/* With Row arrows (rowId): the frame, then the arrows a mouse scrolls it with, which show only while its tabs don't fit. */
.switch-scroll { display: flex; align-items: center; gap: var(--gap-control-row); min-width: 0; max-width: 100%; }
.switch-scroll > .switch-frame { flex: 0 1 auto; }
/* At rest a row of tabs that scrolls shows them whole at its start: it snaps a tab's start to just past the fade there (SCROLL_FADE_SCRIPT
   starts it where the one you're on shows whole). That fade is as wide as a tab's room round its words, so the words of the tab before
   are wholly out of view, never cut, and the slab of the one you're on is never faded; the fade at its end stays the usual one
   (--fade-sideways-px), over whatever runs on past it. */
.switch-frame-row { --fade-sideways-px: 28px; --tab-fade: 18px; position: relative; display: flex; flex: 1; min-width: 0; height: 100%; scroll-snap-type: x mandatory; scroll-padding-inline-start: var(--tab-fade); }
.switch-frame.small > .switch-frame-row { --tab-fade: 14px; }
.switch-frame > .switch-frame-row.more-left { --fade-left: var(--tab-fade); }
.tab-switch.framed > :not([aria-hidden]) { scroll-snap-align: start; }
.tab-switch.framed, .tab-switch.framed.small { height: 100%; width: max-content; min-width: 100%; max-width: none; background: none; box-shadow: none; clip-path: none; }
/* When they fit, the tabs share out the frame's width; when they don't, they keep their own and scroll. */
.tab-switch.framed > a, .tab-switch.framed > button { flex: 1 0 auto; }
/* A tab that folds away into the end of the tabs and opens out of it again. */
.tab-switch > .foldable { max-width: 10rem; overflow: hidden; transition: max-width 0.45s cubic-bezier(.2,.8,.2,1), padding 0.45s cubic-bezier(.2,.8,.2,1), opacity 0.3s 0.08s; }
.tab-switch > .foldable.folded { max-width: 0; padding-left: 0; padding-right: 0; opacity: 0; pointer-events: none; transition: max-width 0.4s cubic-bezier(.4,0,.2,1), padding 0.4s cubic-bezier(.4,0,.2,1), opacity 0.16s; }
/* Keyboard focus: a line round the focused tab that follows its cut, like the slab's (the focus ring, set by SWITCH_SCRIPT). */
.tab-switch > :focus-visible { outline: none; }
.tab-switch .focus-ring { position: absolute; top: 4px; bottom: 4px; left: 0; width: 0; z-index: 3; pointer-events: none; clip-path: var(--cut-shape); opacity: 0; }
.tab-switch.small .focus-ring { top: 3px; bottom: 3px; }
.tab-switch.vertical .focus-ring { top: 0; bottom: auto; left: 4px; right: 4px; width: auto; height: 0; }
.tab-switch.vertical.small .focus-ring { left: 3px; right: 3px; }
.tab-switch.is-focus-shown .focus-ring { opacity: 1; }
.tab-switch .focus-ring .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
/* The sort switch: the header's switch, smaller. */
.tab-switch.small { --control-height: var(--control-height-small); --tab-room: 14px; padding: 3px; clip-path: var(--cut-shape); }
.tab-switch.small .slab, .tab-switch.small .ghost { top: 3px; bottom: 3px; transition-duration: 0.4s, 0.4s, 0.3s; }
/* Its tabs keep their own widths, and share out any room past them evenly (a sort filling its line under a heading on a phone). */
.tab-switch.small > a, .tab-switch.small > button { flex: 1 1 auto; font-size: 0.875rem; }
/* The first and last tabs shown sit against the switch's cut corners, which eat into them at its ends: they take a slant's more room there.
   A folded tab isn't shown, so the ends are the first and last tabs that aren't folded (the cut line, slab, ghost and ring are hidden from readers, so they never count). */
.tab-switch:not(.vertical) > :nth-child(1 of :not(.folded):not([aria-hidden])) { padding-inline-start: calc(var(--tab-room) + var(--control-slant) / 2); }
.tab-switch:not(.vertical) > :nth-last-child(1 of :not(.folded):not([aria-hidden])) { padding-inline-end: calc(var(--tab-room) + var(--control-slant) / 2); }
/* Vertical: the same switch stacked, its places down a carved well (a page's own places, the gallery's groups). Each place is a row of
   its icon, its words and a count at its end; the slab spans the well and moves down it, and the ghost follows the pointer between them. */
.tab-switch.vertical { flex-direction: column; height: auto; }
.tab-switch.vertical .slab, .tab-switch.vertical .ghost { top: 0; bottom: auto; left: 4px; right: 4px; width: auto; height: 0; transition: transform 0.55s var(--spring), height 0.55s var(--spring), opacity 0.3s; }
.tab-switch.vertical.small .slab, .tab-switch.vertical.small .ghost { left: 3px; right: 3px; transition-duration: 0.4s, 0.4s, 0.3s; }
.tab-switch.vertical > a, .tab-switch.vertical > button { flex: none; display: flex; align-items: center; justify-content: flex-start; gap: 10px; height: 2.5rem; padding: 0 14px; text-align: left; }
.tab-switch.vertical > a > .tag, .tab-switch.vertical > button > .tag { margin-left: auto; }
.tab-switch.vertical .ico { width: 18px; height: 18px; }
/* A count in a tab across sits just after its words. */
.tab-switch:not(.vertical) > :is(a, button):has(> .tag) { display: flex; align-items: center; gap: var(--gap-words-words); }
/* On a touch screen a switch is at least a regular control tall, and each tab's hit area takes in the well's inset above and below it, so a
   finger always has a regular control's height to land on (the clip round the well would cut off anything reaching further). */
@media (pointer: coarse) {
  .tab-switch:not(.vertical, .framed) { height: max(var(--control-height), var(--control-height-regular)); }
  .switch-frame, .switch-frame.small { height: max(var(--switch-height, var(--control-height-small)), var(--control-height-regular)); }
  .tab-switch > :not([aria-hidden])::before { content: ""; position: absolute; left: 0; right: 0; top: min(0px, calc((100% - var(--touch-target)) / 2)); bottom: min(0px, calc((100% - var(--touch-target)) / 2)); }
}
@media (prefers-reduced-motion: reduce) { .tab-switch .slab, .tab-switch .ghost, .tab-switch > .foldable { transition: none; } }
`,
  render: tabSwitch,
  examples: [
    {
      label: "Big",
      markup: html`<div style="width:min(380px,100%)">${tabSwitch({ label: "Sign in or make an account", switchSize: "big", tabs: [{ label: "Sign in", isCurrent: true }, { label: "Make an account", isCurrent: false }] })}</div>`,
    },
    {
      label: "Small",
      markup: tabSwitch({ label: "Sort", switchSize: "small", tabs: [{ label: "Recently played", tabValue: "played", isCurrent: true }, { label: "Recently updated", tabValue: "updated", isCurrent: false }] }),
    },
    {
      label: "Long words in a narrow place: the tabs keep less room round them",
      markup: html`<div style="width:min(15.5rem,100%)">${tabSwitch({ label: "Sort", switchSize: "small", tabs: [{ label: "Recently played", tabValue: "played", isCurrent: true }, { label: "Recently updated", tabValue: "updated", isCurrent: false }] })}</div>`,
    },
    {
      label: "Pointed: the faint slab under it",
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
      label: "On a loop",
      markup: html`<div data-state-loop="switch">${tabSwitch({ label: "Sort", switchSize: "small", tabs: [{ label: "Recently played", tabValue: "played", isCurrent: true }, { label: "Recently updated", tabValue: "updated", isCurrent: false }] })}</div>`,
      isStill: true,
    },
    {
      label: "Vertical: a page's places, with icons and counts",
      markup: html`<div style="width:min(260px,100%)">${tabSwitch({ label: "Places", switchSize: "big", isVertical: true, tabs: VERTICAL_PLACES })}</div>`,
    },
    {
      label: "Vertical, plain",
      markup: html`<div style="width:min(220px,100%)">${tabSwitch({ label: "Groups", switchSize: "big", isVertical: true, tabs: ["Foundations", "Actions", "Inputs", "Navigation"].map((label, tabIndex) => ({ label, isCurrent: tabIndex === 1 })) })}</div>`,
    },
    {
      label: "Framed: more tabs than fit scroll inside the frame, fading at its ends",
      markup: html`<div style="width:min(300px,100%)">${tabSwitch({ label: "Groups", switchSize: "small", isFramed: true, tabs: ["Foundations", "Actions", "Inputs", "Navigation", "Panes", "Data"].map((label, tabIndex) => ({ label, href: "#switch", isCurrent: tabIndex === 2 })) })}</div>`,
    },
    {
      label: "Framed, with Row arrows: a mouse scrolls the tabs that don't fit (a touch screen swipes and shows none)",
      markup: html`<div style="width:min(360px,100%)">${tabSwitch({ label: "Genres", switchSize: "small", isFramed: true, rowId: "example-switch-arrows-row", tabs: ["Action", "Adventure", "Role-playing", "Shooter", "Strategy", "Simulation", "Racing", "Sports"].map((label, tabIndex) => ({ label, href: "#switch", isCurrent: tabIndex === 0 })) })}</div>`,
    },
    {
      label: "Framed, with tabs folded away (the header off a developer page)",
      markup: tabSwitch({ label: "Main", switchSize: "big", isFramed: true, tabs: [{ label: "Home", href: "#switch", isCurrent: true }, { label: "Your games", href: "#switch", isCurrent: false }, { label: "Developer", href: "#switch", isCurrent: false, isFoldable: true, isFolded: true }, { label: "Forum", href: "#switch", isCurrent: false, isFoldable: true, isFolded: true }] }),
    },
    {
      label: "Links to pages",
      markup: tabSwitch({ label: "Your games", switchSize: "small", tabs: [{ label: "Played", href: "#switch", isCurrent: false }, { label: "Saved", href: "#switch", isCurrent: true }, { label: "Bought", href: "#switch", isCurrent: false }] }),
    },
  ],
});


component({
  name: "Color picker",
  slug: "color-picker",
  group: "inputs",
  summary: "Pick one color from a few: a glass button's tint, the glass's hue. Plain swatches in a carved well, like the switch's tabs; the picked one keeps its whole color, with an orange bar under it, and is named beside them.",
  styles: `
/* A color picker: plain swatches in a carved well, like the switch's tabs. A swatch is a control like any other, cut by the edge rule,
   so swatches side by side slant toward each other and the end ones follow the well's corners. */
.color-picker { display: flex; align-items: center; gap: 0; font: var(--type-facts); color: var(--ink-2); --clear-swatch: repeating-conic-gradient(var(--line) 0 25%, transparent 0 50%) 0 0 / 8px 8px; }
.color-well { position: relative; display: flex; flex: none; padding: 4px 4px 13px; background: var(--well); box-shadow: var(--well-shade); clip-path: var(--cut-shape);
  --swatch-size: 32px; }
.color-well .color-pick:not(:last-of-type) { margin-inline-end: var(--gap-control-row-boxes); }
.color-picker-name { margin-left: var(--gap-words-control); }
.color-pick { position: relative; flex: none; width: var(--swatch-size); height: var(--swatch-size); padding: 0; border: 0; cursor: pointer; background: none; }
/* Its color is painted inside its cut, and so is its line; the button itself isn't clipped, so on a touch screen its hit area can reach
   past its color (below). */
.color-pick::after { content: ""; position: absolute; inset: 0; background: var(--swatch); clip-path: var(--cut-shape); }
.color-pick > .cut-line { clip-path: var(--cut-shape); }
/* Its rim: a line inside its cut that stands out from the well by 3:1 at least in either theme, so a swatch of the well's own color (white
   on light glass, black on smoked) still shows its shape. */
.color-pick .cut-line polygon { stroke: var(--swatch-rim, var(--muted)); stroke-width: 2; }
/* Pointed at: a light rim inside its cut. */
.color-pick:hover .cut-line polygon { stroke: var(--raise-top); stroke-width: 4; }
/* Picked: the swatch keeps its whole color, and an orange bar floats under it in the well's bottom: slanting with the swatches between
   colors, carved like the well's corner under the first or last. COLOR_PICKER_SCRIPT places it and gives it its shape; it glides to the next pick. */
.color-mark { position: absolute; left: 0; bottom: 4px; width: 0; height: 4px; background: var(--run); pointer-events: none; clip-path: var(--cut-shape);
  transition: transform 0.45s var(--spring), width 0.45s var(--spring), clip-path 0.45s var(--spring); }
/* Keyboard focus: the orange line round its cut, like every control's. */
.color-pick:focus-visible { outline: none; }
.color-pick:focus-visible .cut-line polygon, .color-pick.is-focused .cut-line polygon { stroke: var(--focus); stroke-width: var(--focus-stroke); }
/* On a touch screen a swatch's hit area is a regular control tall: from the well's top (4px above it) down over the bar's room under it,
   all inside the well, whose clip would cut off anything reaching further. */
@media (pointer: coarse) { .color-pick::before { content: ""; position: absolute; left: 0; right: 0; top: -4px; height: var(--touch-target); } }
@media (prefers-reduced-motion: reduce) { .color-mark { transition: none; } }
`,
  render: colorPicker,
  examples: [
    { label: "Picked", markup: colorPicker({ label: "Tint", choices: TINT_CHOICES, pickedValue: "indigo" }) },
    { label: "Clear picked: a checker, the usual sign for see-through", markup: colorPicker({ label: "Tint", choices: TINT_CHOICES, pickedValue: "clear" }) },
    { label: "Keyboard focus", markup: colorPicker({ label: "Tint", choices: TINT_CHOICES, pickedValue: "indigo", focusedValue: "blue" }) },
  ],
});

// Page settings sits with the switch and the color picker, which it uses (foundations.ts can't import this file).
/** Game-like colors for the gallery's hue example. */
const HUE_CHOICES: ColorChoice[] = [
  { name: "None", colorValue: "", swatch: "clear" },
  { name: "Crimson", colorValue: "#C8384A", swatch: "#C8384A" },
  { name: "Emerald", colorValue: "#2E9E6B", swatch: "#2E9E6B" },
  { name: "Violet", colorValue: "#7A4FD8", swatch: "#7A4FD8" },
  { name: "Gold", colorValue: "#D9A520", swatch: "#D9A520" },
];


component({
  name: "Page settings",
  slug: "page-settings",
  group: "foundations",
  summary: "Every page has one set of settings that all its components follow: light or dark, and each component's own, like the glass's hue. One change covers every instance at once, and a page only carries the ones its components use.",
  styles: "",
  examples: [
    {
      label: "Light or dark: the whole gallery follows",
      isWide: true,
      markup: html`<div data-setting-theme>${tabSwitch({ label: "Light or dark", switchSize: "small", tabs: [{ label: "Light", tabValue: "light", isCurrent: true }, { label: "Dark", tabValue: "dark", isCurrent: false }] })}</div>`,
    },
    {
      label: "Glass: its hue, on every piece of glass in the gallery at once",
      isWide: true,
      markup: html`<div data-setting-hue>${colorPicker({ label: "The glass's hue", choices: HUE_CHOICES, pickedValue: "" })}</div>`,
    },
  ],
});

// Motion sits with the switch, whose slab shows it, so it can use the real one (foundations.ts can't import this file).
component({
  name: "Motion",
  slug: "motion",
  group: "foundations",
  summary: "Things move only when pointed at, pressed or chosen: a slab springs across on the spring curve (--spring) in 0.55s, 0.4s for a small one, and a change of size takes 0.45s. Reduced motion stops all of it.",
  styles: "",
  examples: [
    {
      label: "Choose a tab: the slab springs across",
      markup: html`<div style="width:min(380px,100%)">${tabSwitch({ label: "Motion", switchSize: "big", tabs: [{ label: "Spring 0.55s", isCurrent: true }, { label: "Choose me", isCurrent: false }] })}</div>`,
    },
  ],
});
