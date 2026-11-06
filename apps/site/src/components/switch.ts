import { action, ICON_ROOM_WIDTH, primaryButton, type ListedIcon } from "./actions.ts";
import { html, raw, type Raw } from "../markup.ts";
import { component } from "./component.ts";
import { controlMarkup, type ControlMarkup } from "./control-markup.ts";
import { CUT_LINE, glassPane, icon, tag, well, type IconName } from "./foundations.ts";
import { stack } from "./layout.ts";
import { selectField } from "./choices.ts";
import { HEADER_RAIL_MEDIA, SCREEN_QUERIES, tokenValue } from "./tokens.ts";

/*
 * The switch, from the sign-in draft's Sign in / Make an account switch and the home draft's sort switch, and the three foundations
 * that sit with it because they show or use a real one: the color picker, page settings and motion. Split from inputs.ts.
 */

const VERTICAL_PLACES: SwitchTab[] = [
  { ...action("home"), isCurrent: true },
  { ...action("yourGames"), badgeCount: 3, isCurrent: false },
  { ...action("friends"), isCurrent: false },
  { ...action("forum"), badgeCount: 12, isCurrent: false },
  { ...action("settings"), isCurrent: false },
];

export interface SwitchTab {
  label: string;
  /** A link to another page; without one it's a button with aria-pressed. */
  href?: string;
  /** A button's value, for a page script to read. */
  tabValue?: string;
  isCurrent: boolean;
  /** Before its label (a vertical switch's places). */
  icon?: ListedIcon;
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
  /** Stacked only: its own places, so it's a folder that opens in place (its name a button, never a place), open to start with while it's current. */
  places?: SwitchTab[];
}

/** The switch: a carved well, a raised slab under the one you're on, and a faint one under the one you point at. */
export function tabSwitch(options: {
  label: string;
  tabs: SwitchTab[];
  /** Big: the well holds regular tabs inside its own room. Regular: the well is a regular control's height, as a header's or a pane head's beside other regular controls. Small: a sort. */
  switchSize: "big" | "regular" | "small";
  isVertical?: boolean;
  /** Across only: it fills the width it's in, its tabs sharing it (a pane's head: Sign in or Make an account), rather than its words' width. */
  isFull?: boolean;
  /**
   * Its tabs are links to parts of this page (href "#overview", "#rooms"), and only the chosen one's part shows: the others are hidden, and
   * the address's # opens the one it names, so a link to it lands there. The page hides all but the first itself, for the first paint.
   */
  isShowingOnePanel?: boolean;
  /**
   * A menu (a Select field) of the same choices, shown in the switch's place on a phone, upright or on its side, where a row of tabs
   * would run past the screen: the switch on wider screens, the menu on narrow ones, never both. The page's script hears either.
   */
  menuWhenNarrow?: ControlMarkup;
}): ControlMarkup {
  const isSmall = options.switchSize === "small";
  const inside = (tab: SwitchTab) =>
    tab.icon || tab.badgeCount ? html`${tab.icon ? icon(tab.icon) : ""}<span>${tab.label}</span>${tab.badgeCount ? tag(tab.badgeCount, "count") : ""}` : html`${tab.label}`;
  const kind = `${options.switchSize}${options.isVertical ? " vertical" : ""}`;
  // A folder's places stand in the switch itself, right after it, so the slab slides to them as to any place.
  const inFolder = new Set(options.tabs.flatMap((tab) => tab.places ?? []));
  const inShutFolder = new Set(options.tabs.flatMap((tab) => (tab.isCurrent ? [] : tab.places ?? [])));
  const classNames = (tab: SwitchTab) => [inFolder.has(tab) ? "is-in-folder" : "", tab.isFoldable ? "foldable" : "", tab.isFoldable && tab.isFolded ? "folded" : "", tab.state ?? ""].filter(Boolean).join(" ");
  const folding = (tab: SwitchTab) =>
    html`${tab.isFoldable && tab.isFolded ? raw(' tabindex="-1" aria-hidden="true"') : ""}${inShutFolder.has(tab) ? raw(" hidden") : ""}`;
  const folder = (tab: SwitchTab) =>
    html`<button type="button" class="flush-row quiet switch-folder" data-lights aria-expanded="${tab.isCurrent ? "true" : "false"}">${tab.icon ? icon(tab.icon) : ""}<span>${tab.label}</span><span class="switch-folder-arrow">${icon("chevron-right")}</span></button>`;
  const tabSwitch = html`<div class="tab-switch carving-parts ${kind}" role="group" aria-label="${options.label}"${options.isShowingOnePanel ? raw(" data-shows-one-panel") : ""}><span class="switch-slab slab-layer cut-raised" aria-hidden="true" data-cut-line="${isSmall ? 7 : 8}">${CUT_LINE}</span><span class="focus-ring" aria-hidden="true" data-cut-line="${isSmall ? 9 : 10}">${CUT_LINE}</span>${options.tabs.flatMap((tab) => [tab, ...(tab.places ?? [])]).map((tab) =>
    tab.places?.length ? folder(tab) : tab.href
      ? // A link that can't be followed now has no address, so nothing reaches it; it still says what it is.
        html`<a class="flush-row quiet${classNames(tab) ? ` ${classNames(tab)}` : ""}" data-lights${tab.isDisabled ? raw(' aria-disabled="true"') : html` href="${tab.href}"`}${folding(tab)}${tab.extra ?? ""}${tab.isCurrent ? raw(' aria-current="page"') : ""}>${inside(tab)}</a>`
      : html`<button type="button" class="flush-row quiet${classNames(tab) ? ` ${classNames(tab)}` : ""}" data-lights${folding(tab)}${tab.extra ?? ""}${tab.tabValue !== undefined ? html` value="${tab.tabValue}"` : ""} aria-pressed="${tab.isCurrent ? "true" : "false"}"${tab.isDisabled ? raw(" disabled") : ""}>${inside(tab)}</button>`,
  )}</div>`;
  // Its tabs sit in a Well, which stays put while they scroll inside it, fading at its ends: across, with the rail under the well;
  // stacked, with the rail beside its places.
  const switchMarkup = controlMarkup(
    well({
      kind: `switch-well ${kind}${options.isFull && !options.isVertical ? " is-full" : ""}`,
      scrollDirection: options.isVertical ? "down" : "across",
      cornerCutPx: isSmall ? 9 : 10,
      edgeLight: options.isVertical ? "left" : "bottom",
      body: tabSwitch,
    }),
    isSmall ? "small" : "regular",
  );
  return options.menuWhenNarrow ? controlMarkup(html`<span class="switch-or-menu"><span class="as-switch">${switchMarkup}</span><span class="as-menu">${options.menuWhenNarrow}</span></span>`, options.menuWhenNarrow.controlHeight, { hasOwnWords: true }) : switchMarkup;
}

/** The gallery's pane with a full switch at its head, as the sign-in pane has it, on the tab named. */
const paneHeadSwitch = (current: "Sign in" | "Make an account"): Raw =>
  glassPane({
    paneWidth: "full",
    body: stack({
      items: [
        { kind: "control", markup: tabSwitch({ label: "Sign in or make an account", switchSize: "regular", isFull: true, tabs: [{ label: "Sign in", isCurrent: current === "Sign in" }, { label: "Make an account", isCurrent: current === "Make an account" }] }) },
        { kind: "words", markup: html`<h2>${current === "Sign in" ? "Welcome back" : "Make an account"}</h2>` },
      ],
    }),
  });

/** The switch's slab sits under the one you're on, sliding on the spring; a tab you point at only lights its words (CSS). */
export const SWITCH_SCRIPT = `/* switches */(function () {
  window.zaismaWatch.each(".tab-switch", function (sw) {
    var slab = sw.querySelector(".switch-slab"), tabs = sw.querySelectorAll(":scope > a, :scope > button:not(.switch-folder)"), isVertical = function () { return sw.classList.contains("vertical"); };
    function current() { return sw.querySelector('[aria-current="page"], [aria-pressed="true"]'); }
    // How far a part reaches past a tab's box on a side where another tab is beside it: its slant, less the gap a row of controls keeps.
    var rowGapPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--gap-control-row")) || 4;
    function besideReach(el) { return Math.max(0, ((Number(el.getAttribute("data-cut-line")) || 0) - rowGapPx) / 2); }
    // The slab slides as one piece of glass, its size easing with its place where its tabs differ in width. One clock moves it: each frame its
    // place and size are set and its cut shape and bevel (which blend between a tab at the switch's end and one beside another) drawn in the same step,
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
      if (isVertical()) { el.style.width = at.width ? Math.round(at.width) + "px" : ""; el.style.height = sizePx; el.style.transform = "translate(" + (at.across || 0) + "px, " + at.pos + "px)"; } else { el.style.height = ""; el.style.width = sizePx; el.style.transform = "translateX(" + at.pos + "px)"; }
    }
    // Where it's sliding to is el.slideTarget, read each frame, so a settle on the way (its room changing size as a page swaps what's under the
    // switch) moves where it lands without cutting the slide short.
    function slide(el, to, ms) {
      var carrier = el === slab ? pageGlide : null, ease = carrier ? carrier.ease : slideEase;
      // Its clock is the frames' own: it starts on the first frame after the press, so the time the press took to draw (a slow phone's first
      // frame) is never a jump at the start, and each step is the time between the frames shown, whatever else ran in them.
      var from = el.slideAt || to, startMs = null, id = (el.slideId || 0) + 1; el.slideId = id; el.slideTarget = to;
      // A move by script says how long it runs while it runs (the motion sheet reads it as it reads a transition).
      el.setAttribute("data-move-duration-ms", String(Math.round(ms)));
      (function frame(frameMs) {
        if (el.slideId !== id) return;
        var t = startMs === null || frameMs === undefined ? 0 : Math.min(1, (frameMs - startMs) / ms), e = ease(t); to = el.slideTarget;
        // Stopped on the way (a wheel, a touch), the page keeps where it is, and whatever follows the page says where the slab goes.
        if (carrier && carrier.isOn) window.scrollTo(window.scrollX, carrier.fromY + (carrier.toY - carrier.fromY) * e);
        // Its shape is drawn before it's moved: drawing reads its size, and reading after a move would lay the page out again mid-frame.
        if (el.redrawCut) el.redrawCut({ isFrame: true, progress: t });
        // Between pixels as it moves (its own layer moves it smoothly there; whole steps stuttered where it goes slowly), on one as it lands.
        // Its size eases with its place, so a slab moving between tabs of different widths (a full switch's) never takes the new width at once.
        var blend = function (start, end) { return t < 1 && start !== undefined ? start + (end - start) * e : end; };
        place(el, { pos: blend(from.pos, to.pos), size: blend(from.size, to.size), across: to.across === undefined ? undefined : blend(from.across || 0, to.across), width: to.width === undefined ? undefined : blend(from.width, to.width) });
        if (t < 1) { requestAnimationFrame(function (nowMs) { if (startMs === null) startMs = nowMs; frame(nowMs); }); return; }
        // Landed, it's cut again where it rests, so its corners are always the edge rule's for the place it's in.
        el.removeAttribute("data-move-duration-ms");
        el.slideTarget = null; if (el.redrawCut) el.redrawCut();
        if (carrier && carrier.isOn) carrier.land();
      })();
    }
    // How far a part reaches past its tab on each side.
    function reachPast(el, tab, isFirst, isLast) {
      // Beside another tab, it reaches into the slant between them, so only the row's gap is left between its place and the next one's.
      var reach = besideReach(el), start = isFirst ? 0 : reach, end = isLast ? 0 : reach;
      // Where the switch's own end slants (beside another control, as a header's switch toward its search), the slab on that end slants
      // with it (the edge rule), set back so its gap to the slant is the gap it keeps from the switch's top and bottom.
      var well = sw.closest("[data-cut-line]"), wellSlanted = well ? well.getAttribute("data-slanted") || "" : "";
      if (!el.classList.contains("focus-ring") && ((isFirst && /start/.test(wellSlanted)) || (isLast && /end/.test(wellSlanted)))) {
        var gapPx = tab.offsetTop, heightPx = sw.offsetHeight, wellSlantPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--control-slant")) || 10;
        var slabSlantPx = Math.min(Number(el.getAttribute("data-cut-line")) || 0, (tab.offsetWidth + start + end) / 3);
        // The two slants meet the middle of the slab's height that far apart across, which is the gap along the slant.
        var setBack = wellSlantPx / 2 - slabSlantPx / 2 + gapPx * Math.sqrt(1 + (wellSlantPx / heightPx) * (wellSlantPx / heightPx)) - gapPx;
        if (isFirst && /start/.test(wellSlanted)) start = -setBack;
        if (isLast && /end/.test(wellSlanted)) end = -setBack;
      }
      return { start: start, end: end };
    }
    // What's on a tab centers in what shows of the slab that lands on it, not in the tab: the slab reaches past it by different amounts at the row's
    // ends, and an end that slants gives up half its slant at mid-height. By place alone, so it never moves as the slab comes and goes.
    function centerOnSlab() {
      var well = sw.closest("[data-cut-line]"), wellSlanted = well ? well.getAttribute("data-slanted") || "" : "";
      var shown = Array.prototype.filter.call(tabs, function (each) { return !each.classList.contains("folded") && !each.hidden; });
      shown.forEach(function (tab, index) {
        if (isVertical()) { tab.style.removeProperty("--tab-shift"); return; }
        var isFirst = index === 0, isLast = index === shown.length - 1, past = reachPast(slab, tab, isFirst, isLast);
        var slantPx = Math.min(Number(slab.getAttribute("data-cut-line")) || 0, (tab.offsetWidth + past.start + past.end) / 3);
        var slantedEnds = (!isFirst || /start/.test(wellSlanted) ? 1 : 0) - (!isLast || /end/.test(wellSlanted) ? 1 : 0);
        tab.style.setProperty("--tab-shift", (Math.round(((past.end - past.start) / 2 + slantedEnds * slantPx / 4) * 10) / 10) + "px");
      });
    }
    // isGliding: the slab is moving there, so its shape blends from the old place's to the new one's over the move.
    function put(el, tab, isGliding) {
      // Put again on the tab it's sliding to (a settle), it lets the slide land there.
      var isOnItsWay = !isGliding && el.slideTarget && el.pickedTab === tab; el.pickedTab = tab;
      if (!tab) { el.style.width = "0px"; return; }
      var from = { beside: el.getAttribute("data-cut-beside"), ends: el.getAttribute("data-cut-ends") || "", stack: el.getAttribute("data-cut-stack") };
      // A folded tab takes no room, so the ends are the first and last tabs shown.
      // A folder isn't a tab, but it's a row: a tab above or below one is in the middle of the well.
      var shown = Array.prototype.filter.call(sw.querySelectorAll(":scope > a, :scope > button"), function (each) { return !each.classList.contains("folded") && !each.hidden; });
      var isFirst = tab === shown[0], isLast = tab === shown[shown.length - 1];
      // Vertical: the slab spans the well's width and moves down it; it never slants, and only on the first or last tab does it follow the well's top or bottom.
      if (isVertical()) {
        var toY = { pos: tab.offsetTop, size: tab.offsetHeight }, msY = isGliding && !reduce ? slideMs(el) : 0;
        // Lying in two columns (a sheet on a phone on its side), it takes the place's width and column too.
        var isInColumns = getComputedStyle(sw).display === "grid";
        if (isInColumns) { toY.across = tab.offsetLeft; toY.width = tab.offsetWidth; }
        // The focus line runs along the well's own edge: on the first or last place, out to the well's end.
        if (el.classList.contains("focus-ring")) {
          var topPx = isFirst ? 0 : tab.offsetTop, bottomPx = isLast ? sw.getBoundingClientRect().height : tab.offsetTop + tab.offsetHeight, heightPx = Math.round(bottomPx - topPx);
          toY = { pos: isLast ? bottomPx - heightPx : topPx, size: heightPx, across: toY.across, width: toY.width };
        }
        el.setAttribute("data-cut-beside", "");
        el.setAttribute("data-cut-stack", ((isFirst ? "first " : "") + (isLast ? "last" : "")).trim());
        moveTo(el, toY, msY, from.stack !== null ? from : null, isOnItsWay);
        return;
      }
      var past = reachPast(el, tab, isFirst, isLast), start = past.start, end = past.end;
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
      moveTo(el, to, ms, from.beside !== null ? from : null, isOnItsWay);
    }
    // Moves it to its tab: gliding, its new shape is worked out where it will land (the edge rule measures where it sits, so a shape worked
    // out where it starts would keep that end's corners), then it slides there from where it was; otherwise it's put and cut there at once.
    function moveTo(el, to, ms, from, isOnItsWay) {
      if (isOnItsWay) { el.slideTarget = to; return; }
      if (ms && el.redrawCut) {
        // A part never drawn before (from is null) takes its new shape with no blend.
        var was = el.slideAt; place(el, to); el.redrawCut(from ? { from: from, ms: ms, ease: el === slab && pageGlide ? pageGlide.ease : slideEase, isDriven: true } : undefined); if (was) place(el, was);
        slide(el, to, ms);
        return;
      }
      el.slideId = (el.slideId || 0) + 1; el.slideTarget = null; el.removeAttribute("data-move-duration-ms"); place(el, to); if (el.redrawCut) el.redrawCut();
    }
    function slideMs(el) { return el === slab && pageGlide ? pageGlide.ms : parseFloat(getComputedStyle(el).getPropertyValue("--slide-ms")) || 550; }
    // A stacked switch's place within this page: the page carries the move. Its distance sets the time, 400ms up to a screen and longer past that,
    // up to 800ms, on a curve that gathers and sheds speed from nothing, and the slab rides on it, the same time, curve and frames, so the two start
    // and land as one. While it runs,
    // <html data-page-gliding> tells what follows the page to hold still, and zaisma:page-glide-end says how it ended; a wheel, touch, press or key stops it.
    var pageGlide = null;
    function glidePage(tab, target, hash) {
      if (pageGlide) pageGlide.stop();
      var root = document.documentElement, fromY = window.scrollY, roomPx = parseFloat(getComputedStyle(root).scrollPaddingTop) || 0;
      var toY = Math.max(0, Math.min(root.scrollHeight - window.innerHeight, fromY + target.getBoundingClientRect().top - roomPx));
      var screens = Math.abs(toY - fromY) / window.innerHeight;
      var glide = pageGlide = { isOn: true, fromY: fromY, toY: toY, ms: Math.min(800, 400 + 130 * Math.max(0, screens - 1)), ease: function (t) { return t * t * t * (t * (6 * t - 15) + 10); } };
      var stops = ["wheel", "touchstart", "pointerdown", "keydown"];
      function end(hasLanded) {
        glide.isOn = false; stops.forEach(function (name) { window.removeEventListener(name, stopByHand); });
        if (pageGlide === glide) pageGlide = null;
        // What follows the page hears of the last frames a frame late, so it holds still for that long more.
        requestAnimationFrame(function () { requestAnimationFrame(function () {
          if (!pageGlide) root.removeAttribute("data-page-gliding");
          dispatchEvent(new CustomEvent("zaisma:page-glide-end", { detail: { hash: hash, hasLanded: hasLanded } }));
        }); });
      }
      function stopByHand() { end(false); }
      glide.stop = function () { if (glide.isOn) { glide.isOn = false; stops.forEach(function (name) { window.removeEventListener(name, stopByHand); }); } };
      // The address changes where the page lands, as a link's would: already there, nothing moves, and the place is the page's target and next focus.
      glide.land = function () { location.hash = hash; end(true); };
      root.setAttribute("data-page-gliding", "");
      stops.forEach(function (name) { window.addEventListener(name, stopByHand, { passive: true }); });
      sw.pickTab(tab);
    }
    // While a slide from the last page waits or plays, nothing moves the slab: a settle then (the fonts, a picture in the header loading)
    // would set the slab again under the slide, and a phone's browser can restart the slide from there, jumping it back.
    var isWaitingToSlide = false;
    // The gallery's fixed state: a tab marked is-focused has the focus line round it (one marked is-pointed is CSS's alone).
    function fixedStates() {
      var focused = sw.querySelector(":scope > .is-focused"), ring = sw.querySelector(".focus-ring");
      if (focused && ring) { put(ring, focused); sw.classList.add("is-focus-shown"); }
    }
    // Not shown (a row a script hides for a moment), it keeps its place: measured then, its tabs have no width, and shown again before the
    // next frame, its size never changes for the size watcher to set it again.
    function settle() { if (isWaitingToSlide || !sw.getClientRects().length) return; centerOnSlab(); var on = current(), focused = sw.querySelector(":scope > :focus-visible"), ring = sw.querySelector(".focus-ring"); slab.style.transition = "none"; put(slab, on); if (ring && focused) put(ring, focused); fixedStates(); slab.offsetWidth; slab.style.transition = ""; sw.classList.add("is-ready"); }
    // The page's header on a phone on its side is a rail, so its tabs stand up with it, and lie down again when the phone does.
    var railMedia = sw.closest("body > .top") && window.matchMedia(${JSON.stringify(HEADER_RAIL_MEDIA)});
    function fitRail() {
      var isRail = railMedia.matches, well = sw.closest(".switch-well"), scroller = sw.parentElement;
      sw.classList.toggle("vertical", isRail);
      if (well) { well.classList.toggle("vertical", isRail); well.classList.toggle("is-full", !isRail); well.setAttribute("data-edge-light", isRail ? "left" : "bottom"); }
      if (scroller) scroller.classList.toggle("across", !isRail);
    }
    if (railMedia) { fitRail(); railMedia.addEventListener("change", function () { fitRail(); settle(); }); }
    settle();
    // Past its room across, the one you're on is never what's cut off: it comes to the middle of what shows, or as near as the row's ends allow, so it's clear of the fades.
    function showChosen(isGliding) {
      var on = current(), scroller = sw.parentElement;
      if (!scroller) return;
      // Stood up in a box too short for it, the one you're on comes whole into view, clear of the box's fades; at either end, flush, with no fade left.
      if (isVertical()) {
        var most = scroller.scrollHeight - scroller.clientHeight;
        if (!on || most <= 1 || !on.getClientRects().length) return;
        var fade = window.zaismaScrollFadePx ? window.zaismaScrollFadePx() : 34, box = scroller.getBoundingClientRect(), place = on.getBoundingClientRect(), now = scroller.scrollTop, top = place.top - box.top + now, bottom = place.bottom - box.top + now, goal = now;
        if (top - fade < now) goal = top - fade; else if (bottom + fade > now + scroller.clientHeight) goal = bottom + fade - scroller.clientHeight;
        scroller.scrollTo({ top: Math.max(0, Math.min(most, goal)), behavior: isGliding ? "smooth" : "auto" });
        return;
      }
      sw.classList.remove("is-past-room");
      if (scroller.scrollWidth <= scroller.clientWidth + 1) return;
      sw.classList.add("is-past-room");
      if (!on) return;
      scroller.scrollTo({ left: on.offsetLeft + on.offsetWidth / 2 - scroller.clientWidth / 2, behavior: isGliding ? "smooth" : "auto" });
    }
    showChosen(false);
    // A switch of links that was on the last page too (the header's tabs; a stacked one has already slid, on the press): once this page shows, its slab slides from the last page's tab
    // to this one's. Only its position moves (and, sideways, its width as a stretch), as a compositor animation, like the old sidebar's glide:
    // nothing is laid out or redrawn while the new page is still starting, and the settles that follow (fonts, the first resize) can't cut it short.
    var came = window.navigation && navigation.activation && navigation.activation.from;
    if (came && came.url && slab.animate && !isVertical() && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // The tab whose page it came from: by its whole address, or by its path where only one tab has it (Browse's sorts are all /games, so
      // coming from a Browse address no tab has, none of them is the last page's and nothing slides).
      // A reload comes from this page itself, so nothing slides (a tab that links within it would otherwise count as the last page's).
      var cameFrom = new URL(came.url), lastPath = cameFrom.pathname, isReload = lastPath === location.pathname && cameFrom.search === location.search;
      var samePath = Array.prototype.filter.call(tabs, function (tab) { return tab.href && new URL(tab.href).pathname === lastPath; });
      var last = samePath.find(function (tab) { return new URL(tab.href).search === cameFrom.search; }) || (samePath.length === 1 ? samePath[0] : undefined);
      var on = current();
      if (last && on && last !== on && !isReload) {
        // Measured once the fonts are in (from the cache, on a page of the same site), when the tabs have their widths, so it lands where the slab is.
        var slideFromLastPage = function () {
          var from = isVertical() ? "translateY(" + last.offsetTop + "px)" : "translateX(" + last.offsetLeft + "px) scaleX(" + (last.offsetWidth / Math.max(1, on.offsetWidth)).toFixed(4) + ")";
          var to = isVertical() ? "translateY(" + on.offsetTop + "px)" : "translateX(" + on.offsetLeft + "px) scaleX(1)";
          return slab.animate([{ transform: from, transformOrigin: "0 0" }, { transform: to, transformOrigin: "0 0" }], { duration: slideMs(slab), easing: "cubic-bezier(.3, 1.2, .4, 1)" });
        };
        // Until then it waits on the last page's tab.
        slab.style.transition = "none"; put(slab, last); slab.offsetWidth; slab.style.transition = "";
        isWaitingToSlide = true;
        // It starts once the page shows, not before (a slow phone draws the new page late, and a slide started earlier would show up already
        // halfway there). Once it lands, the slab settles where its tab is by then.
        var start = function () {
          requestAnimationFrame(function () {
            isWaitingToSlide = false; settle(); isWaitingToSlide = true;
            var land = function () { isWaitingToSlide = false; settle(); };
            slideFromLastPage().finished.then(land, land);
          });
        };
        window.zaismaWatch.fontsIn(start);
      }
    }
    window.zaismaWatch.fontsIn(settle);
    window.zaismaWatch.size(sw, settle);
    // Its own size changing stood up is a folder opening, and whoever opened it stays where they scrolled.
    window.zaismaWatch.size(sw, function () { if (!isVertical()) showChosen(false); });
    // A switch as wide as its tabs doesn't change size when its room grows, so the room it has is watched too, to give its tabs back their room.
    if (sw.parentElement) { window.zaismaWatch.size(sw.parentElement, settle); window.zaismaWatch.size(sw.parentElement, function () { showChosen(false); }); }
    // An open foldable tab eases its padding, so it reaches its width after the switch has its size: the slab settles on it as it goes.
    Array.prototype.forEach.call(sw.querySelectorAll(":scope > .foldable"), function (tab) { window.zaismaWatch.size(tab, settle); });
    // A page script can pick a tab too (the gallery's Light or Dark, when the theme changes elsewhere).
    sw.pickTab = function (tab) {
      if (tab.tagName === "BUTTON") tabs.forEach(function (each) { each.setAttribute("aria-pressed", String(each === tab)); });
      // A link within this page (or one a page script shows) becomes the one you're on, so pressing it again stays put and the one you left slides back.
      else tabs.forEach(function (each) { if (each === tab) each.setAttribute("aria-current", "page"); else each.removeAttribute("aria-current"); });
      // Picked twice for one press (the switch's own click and a page script's), it keeps the slide it started: a second one would start
      // again from where it is, its shape already the new one, so the corners would jump ahead of it.
      if (slab.pickedTab !== tab) put(slab, tab, true);
      // In a row that scrolls, the picked tab comes whole into view, clear of the row's fades (SCROLL_FADE_SCRIPT's showWhole).
      var row = sw.closest("[data-fades-sideways]");
      if (row && row.showWhole && !isVertical()) row.showWhole(tab, true); else showChosen(true);
      holdCurrentOpen();
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
          var to = new URL(tab.href, location.href), isPlainPress = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && (!tab.target || tab.target === "_self");
          if (to.pathname !== location.pathname || to.search !== location.search) {
            // A stacked switch moves on the press, whole (the slab, and the folders as the next page has them), and the page follows: waiting
            // for the next page to show would hold it back as long as that page takes, with what's on it already in its new place.
            if (!isVertical() || reduce || !isPlainPress) return;
            event.preventDefault();
            leftFrom = leftFrom || current();
            sw.pickTab(tab);
            shutOtherFolders();
            clearTimeout(leaving);
            document.dispatchEvent(new Event("zaisma-leaving-page"));
            leaving = setTimeout(function () { location.assign(tab.href); }, slideMs(slab));
            return;
          }
          var target = isVertical() && !reduce && isPlainPress && to.hash && document.getElementById(decodeURIComponent(to.hash.slice(1)));
          if (target && target.getClientRects().length) { event.preventDefault(); glidePage(tab, target, to.hash); return; }
        }
        sw.pickTab(tab);
      });
    });
    // Showing one part at a time: a tab shows its part and hides the rest, with no jump down the page; the address's # says which, so
    // Back, a shared link and a link from elsewhere on the page open the same one.
    if (sw.hasAttribute("data-shows-one-panel")) {
      var panelOf = function (tab) { var id = tab.hash ? decodeURIComponent(tab.hash.slice(1)) : ""; return id ? document.getElementById(id) : null; };
      var showPanel = function (tab) { tabs.forEach(function (each) { var panel = panelOf(each); if (panel) panel.hidden = each !== tab; }); };
      var fromAddress = function () {
        var named = Array.prototype.filter.call(tabs, function (each) { return each.hash && each.hash === location.hash; })[0];
        if (!named) return;
        showPanel(named);
        if (named.getAttribute("aria-current") !== "page") sw.pickTab(named);
      };
      tabs.forEach(function (tab) {
        tab.addEventListener("click", function (event) {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !panelOf(tab)) return;
          event.preventDefault();
          history.replaceState(history.state, "", tab.hash);
          showPanel(tab);
          // The part comes in as its tab is picked, a short fade, never in one frame.
          var shown = panelOf(tab); if (shown && shown.animate && !reduce) shown.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" });
        });
      });
      window.addEventListener("hashchange", fromAddress);
      // Once the rest of this switch is set up (its folders), the address's part shows.
      queueMicrotask(fromAddress);
    }
    // A folder opens and shuts in place, its places growing from nothing or closing to it; the switch's changing height keeps the slab on its row.
    // The one you're in stays open, and opening another shuts the rest, so what's open never piles up.
    var folders = Array.prototype.slice.call(sw.querySelectorAll(":scope > .switch-folder"));
    function placesOf(folder) { var places = []; for (var next = folder.nextElementSibling; next && next.classList.contains("is-in-folder"); next = next.nextElementSibling) places.push(next); return places; }
    function holdCurrentOpen() {
      var here = current();
      folders.forEach(function (folder) {
        var isHeld = placesOf(folder).indexOf(here) >= 0;
        folder.classList.toggle("is-held", isHeld);
        if (isHeld) folder.removeAttribute("data-lights"); else folder.setAttribute("data-lights", "");
        if (isHeld && folder.getAttribute("aria-expanded") !== "true") setOpen(folder, true);
      });
    }
    function setOpen(folder, isOpen) { folder.setAttribute("aria-expanded", String(isOpen)); placesOf(folder).forEach(function (place) { fold(place, isOpen); }); }
    folders.forEach(function (folder) {
      folder.addEventListener("click", function () {
        if (folder.classList.contains("is-held")) return;
        var isOpen = folder.getAttribute("aria-expanded") !== "true";
        setOpen(folder, isOpen);
        if (isOpen) shutOtherFolders(folder);
      });
    });
    function shutOtherFolders(opened) { folders.forEach(function (other) { if (other !== opened && !other.classList.contains("is-held") && other.getAttribute("aria-expanded") === "true") setOpen(other, false); }); }
    holdCurrentOpen();
    // Come back to this page as it was left (the back button, from the browser's memory), it's as it was before the press.
    var leftFrom = null, leaving = null;
    window.addEventListener("pageshow", function (event) {
      if (!event.persisted || !leftFrom) return;
      clearTimeout(leaving); sw.pickTab(leftFrom); shutOtherFolders(); leftFrom = null;
    });
    function fold(place, isOpen) {
      // From where it is, if it's on its way the other way.
      var fromPx = place.hidden ? 0 : place.offsetHeight;
      place.getAnimations().forEach(function (each) { each.cancel(); });
      place.hidden = false;
      var fullPx = place.offsetHeight;
      if (reduce || !place.animate) { place.hidden = !isOpen; return; }
      place.classList.add("is-folding");
      var moving = place.animate([{ height: fromPx + "px", minHeight: "0px", opacity: fullPx ? fromPx / fullPx : 0 }, { height: (isOpen ? fullPx : 0) + "px", minHeight: "0px", opacity: isOpen ? 1 : 0 }], { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)" });
      moving.onfinish = function () { place.classList.remove("is-folding"); place.hidden = !isOpen; };
      moving.oncancel = function () { place.classList.remove("is-folding"); };
    }
    // Keyboard focus: the ring takes the focused tab's place and shape, so the focus line follows its cut.
    var ring = sw.querySelector(".focus-ring");
    sw.addEventListener("focusin", function (event) {
      var tab = event.target;
      if (!ring || tab.parentElement !== sw || !tab.matches(":focus-visible")) return;
      put(ring, tab); sw.classList.add("is-focus-shown");
    });
    sw.addEventListener("focusout", function () { sw.classList.remove("is-focus-shown"); });
  });
})();
`;

/**
 * A Switch whose tabs are their icons alone, wherever it's shown that way: its words kept for a screen reader, and every tab at least an icon's
 * room wide, so no slab on it ever crowds its icon however tight the row is. Past that its tabs scroll.
 */
export function tabIconsAlone(tabSwitch: string): string {
  return `${tabSwitch} .ico { display: block; }
${tabSwitch} > :is(a, button) { min-width: ${ICON_ROOM_WIDTH}; }
${tabSwitch} > :is(a, button) > span:not(.tag) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }`;
}

component({
  name: "Switch",
  slug: "switch",
  group: "inputs",
  subgroup: "choices",
  summary: "Choosing one of a few: Sign in or Make an account (big), Recently played or Recently updated (small). Of links, a page's own sections under its title (a game's dashboard, a profile); stacked, a page's own places down its side.",
  styles: `
/* A switch with a menu for narrow screens: the switch wider than a phone, the menu on a phone upright or on its side, never both. */
.switch-or-menu { display: block; min-width: 0; }
.switch-or-menu > .as-menu { display: none; }
@media ${SCREEN_QUERIES.phone} { .switch-or-menu > .as-switch { display: none; } .switch-or-menu > .as-menu { display: block; } }
/* The switch: the header's and the home's. A carved well, a raised slab under the one you're on, lit like any raised glass, and a faint one under the
   one you point at. No orange: it's a choice, not the thing to do, so orange is left for keyboard focus.
   It's as big as what's in it: its size is its words' (a small switch's are 14px, a big one's 16px) and the room round them, all round
   (--tab-room across, --tab-room-y up and down), never a height of its own. Past its room across it scrolls sideways (in its Well, with the
   rail under it), and stacked, past a menu's height it scrolls down (with the rail beside it). */
.tab-switch { --control-height: var(--control-height-regular); --tab-room: 20px; --tab-room-y: 9px; position: relative; display: flex; min-width: 0; }
/* It slides for --slide-ms (SWITCH_SCRIPT moves it frame by frame, its shape with it), never by a CSS transition, on a layer of its own so a
   frame that only moves it isn't painted again. */
.tab-switch .switch-slab { --slide-ms: 450; position: absolute; top: var(--pad-frame-compact); bottom: var(--pad-frame-compact); left: 0; width: 0; pointer-events: none; clip-path: var(--cut-shape); transition: opacity var(--motion-arrive); will-change: transform; }
/* The slab is a slab layer (materials.ts): a raised piece of glass with a raised button's face and bevel, so its edges catch the light, and
   it casts a soft shadow into the well under it, which the well's cut keeps inside it. */
.tab-switch .switch-slab { clip-path: none; }
/* Each tab is a quiet flush row, its words its room in from its sides (--tab-room across, --tab-room-y up and down). */
.tab-switch > a, .tab-switch > button { position: relative; z-index: 2; display: grid; place-content: center; --row-height: calc(var(--control-height) - 2 * var(--pad-frame-compact)); --row-block: var(--tab-room-y); --row-start: calc(var(--tab-room) + var(--tab-shift, 0px)); --row-end: calc(var(--tab-room) - var(--tab-shift, 0px)); cursor: pointer;
  clip-path: none; font: 500 1rem/1.1 var(--display); color: var(--ink-2); text-decoration: none; white-space: nowrap; }
/* Its tabs are at least its size's control height, less its inset, so it lines up with the controls beside it at any text size. */
/* Across, it's as wide as its tabs, one line each, and its tabs are all one width, the widest's, so the slab is one size on every tab and
   only slides: glass doesn't change size as it moves. A full switch in less room than that (the sign-in pane on a phone) gives its tabs
   their words' widths, and the slab's size eases with its slide (SWITCH_SCRIPT), never stepping in one frame. Past the room it has, its Well stays put, a carving can't move or
   fade, and what's in it scrolls inside it, fading at its ends, with the rail under the well. */
.well.switch-well { align-items: stretch; width: max-content; max-width: 100%; min-height: 0; }
.well.switch-well > .well-body { min-width: 0; padding: 0; font: inherit; }
/* Full: it fills the width it's in, its tabs sharing it, past their words' width. */
.well.switch-well.is-full { width: 100%; }
.well.switch-well.is-full .tab-switch { width: auto; min-width: 100%; }
/* Past its room (SWITCH_SCRIPT), it's as wide as its tabs again, one width each, so scrolled to its end the last keeps the inset the first has. */
.well.switch-well.is-full .tab-switch.is-past-room { width: max-content; }
.tab-switch:not(.vertical) { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; width: max-content; background: none; box-shadow: none; clip-path: none; }
/* The one you're on is marked by its slab and full ink, at the same weight as the others, so its words never move as it's chosen. */
.tab-switch [aria-current="page"], .tab-switch [aria-pressed="true"] { color: var(--ink); }
/* Pointed at (a mouse's; a tap shows nothing), a tab you're not on takes full ink, and the well's edge light (Edge light, Panes › Glass)
   floods up beside it: its lower edge across, its edge beside the places stacked. The well itself never changes: only light. */
@media (hover: hover) { .tab-switch > :is(a, button):not(:disabled, [aria-disabled="true"], [aria-current="page"], [aria-pressed="true"]):hover { color: var(--ink); } }
.tab-switch > .is-pointed { color: var(--ink); }
/* One that can't be chosen now: faded, and it answers nothing (pointing at it lights nothing). */
.tab-switch > [aria-disabled="true"], .tab-switch > :disabled { cursor: default; opacity: 0.4; }
/* Before the script has measured, the one you're on carries its own slab (a flush row's, when it's the one you're on); once it has, the
   sliding slab is the only one. */
.tab-switch.is-ready > :is([aria-current="page"], [aria-pressed="true"]) { background: none; box-shadow: none; }
/* A tab that folds away into the end of the tabs and opens out of it again. */
.tab-switch > .foldable { max-width: 10rem; overflow: hidden; transition: max-width var(--motion-glide) var(--ease-glide), padding var(--motion-glide) var(--ease-glide), opacity var(--motion-arrive) var(--motion-press); }
/* Its tabs share one width, so a folded tab takes no column at all: it goes, and comes back, at once. */
.tab-switch:not(.vertical) > .foldable.folded { display: none; }
/* Across, an open foldable tab keeps its words' width (its clip for folding would let it shrink), so a narrow row scrolls rather than cut it. */
.tab-switch:not(.vertical) > .foldable:not(.folded) { min-width: max-content; }
.tab-switch > .foldable.folded { max-width: 0; padding-left: 0; padding-right: 0; opacity: 0; pointer-events: none; transition: max-width var(--motion-arrive) var(--ease-standard), padding var(--motion-arrive) var(--ease-standard), opacity var(--motion-state); }
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
.tab-switch.small { --control-height: var(--control-height-small); --tab-room: 14px; --tab-room-y: 6px; }
.tab-switch.small .switch-slab { --slide-ms: 380; }
.tab-switch.small > a, .tab-switch.small > button { font-size: 0.875rem; }
.well.switch-well.small { --control-height: var(--control-height-small); }
.well.switch-well.regular { --control-height: var(--control-height-regular); }
/* The tabs take their well's height, which a row sets to its tallest control's (layout.ts): a small sort beside a regular Filter is the Filter's height. */
.switch-well > .well-body > .tab-switch { --control-height: inherit; }
/* A tab's words or icon sit in the middle of its slab as it's seen (--tab-shift, SWITCH_SCRIPT's centerOnSlab). The room round them clears the switch's corners. */
/* Vertical: the same switch stacked, its places down a carved well (a page's own places, the gallery's groups). Each place is a row of
   its icon, its words and a count at its end; the slab spans the well and moves down it, and a place you point at lights its words. */
.tab-switch.vertical { flex-direction: column; }
/* Stacked, the well is no taller than a menu; past that its places scroll inside it, the rail beside them. */
.well.switch-well.vertical { flex-direction: column; width: auto; }
.well.switch-well.vertical > .well-body { flex: 0 1 auto; min-height: 0; }
/* With its rail showing, the places and the slab keep clear of it. */
.well.switch-well.vertical > .well-body.shows-rail { padding-inline-end: var(--rail-room); }
.tab-switch.vertical .switch-slab { top: 0; bottom: auto; left: var(--pad-frame-compact); right: var(--pad-frame-compact); width: auto; height: 0; }
.tab-switch.vertical > a, .tab-switch.vertical > button { flex: none; display: flex; align-items: center; justify-content: flex-start; gap: 10px; --row-start: 14px; --row-end: 14px; text-align: left; }
.tab-switch.vertical > a > .tag, .tab-switch.vertical > button > .tag { margin-left: auto; }
.tab-switch.vertical .ico { width: 18px; height: 18px; }
.tab-switch.vertical > [hidden] { display: none; }
/* It moves as the folders do, on the press, and the next page waits for it, so it's quick. */
.tab-switch.vertical > .switch-slab { --slide-ms: 240; }
.tab-switch.vertical > :is(a, button) > span:not(.tag, .switch-folder-arrow) { flex: 1; min-width: 0; overflow-wrap: anywhere; }
/* A folder: its name at full ink while it's open, its arrow small and quiet, turned down. Its places are set in to the words of the places with icons. */
.switch-folder { width: 100%; margin: 0; border: 0; background: none; cursor: pointer; }
.switch-folder[aria-expanded="true"] { color: var(--ink); }
/* The folder you're in stays open, so pressing it does nothing. */
.switch-folder.is-held { cursor: default; }
.switch-folder-arrow { display: flex; flex: none; color: var(--muted); transition: transform var(--motion-state) var(--ease-glide); }
.tab-switch.vertical .switch-folder-arrow > .ico { width: 12px; height: 12px; }
.switch-folder[aria-expanded="true"] > .switch-folder-arrow { transform: rotate(90deg); }
@media (prefers-reduced-motion: reduce) { .switch-folder-arrow { transition: none; } }
.tab-switch.vertical > .is-in-folder { --row-start: calc(14px + 18px + 10px); }
.tab-switch.vertical > .is-in-folder.is-folding { overflow: hidden; padding-block: 0; }
/* A count in a tab across sits just after its words. */
.tab-switch:not(.vertical) > :is(a, button):has(> .tag) { display: flex; align-items: center; gap: var(--gap-words-words); }
/* On a touch screen a switch is at least a regular control tall, and each tab's hit area takes in the well's inset above and below it, so a
   finger always has a regular control's height to land on (the clip round the well would cut off anything reaching further). */
@media (pointer: coarse) {
  .tab-switch:not(.vertical) { --control-height: var(--control-height-regular); }
  /* Stood up, tabs sit one on another, so each is a touch target's height itself, its press reaching across the well's own inset. */
  .tab-switch.vertical:not(.big) { --control-height: calc(var(--touch-target) + 2 * var(--pad-frame-compact)); }
  .tab-switch.vertical > .foldable:not(.folded) { overflow: visible; }
  .tab-switch > :not([aria-hidden])::before { content: ""; position: absolute; left: min(0px, calc((100% - var(--touch-target)) / 2)); right: min(0px, calc((100% - var(--touch-target)) / 2)); top: min(0px, calc((100% - var(--touch-target)) / 2)); bottom: min(0px, calc((100% - var(--touch-target)) / 2)); }
}
@media (prefers-reduced-motion: reduce) { .tab-switch .switch-slab, .tab-switch > .foldable { transition: none; } }
`,
  render: tabSwitch,
  examples: [
    {
      label: "Big",
      markup: tabSwitch({ label: "Sign in or make an account", switchSize: "big", tabs: [{ label: "Sign in", isCurrent: true }, { label: "Make an account", isCurrent: false }] }),
    },
    {
      label: "Full: it fills its place, its tabs sharing the width (a pane's head)",
      markup: html`<div style="width:min(420px,100%)">${tabSwitch({ label: "Sign in or make an account", switchSize: "regular", isFull: true, tabs: [{ label: "Sign in", isCurrent: true }, { label: "Make an account", isCurrent: false }] })}</div>`,
    },
    // At a pane's head, as Sign in and Make an account are: wherever the slab comes to rest, it's cut for that end of the pane, so press the
    // other tab to see it recut as it lands.
    ...(["Sign in", "Make an account"] as const).map((current) => ({
      label: `Full, at a pane's head: on ${current}`,
      markup: html`<div style="width:min(420px,100%)">${paneHeadSwitch(current)}</div>`,
    })),
    {
      label: "Showing one part at a time: each tab shows its part under it and hides the rest (a game's page: Overview, Rooms, Updates)",
      markup: html`<div style="width:min(420px,100%)">${stack({ items: [
        { kind: "control", markup: tabSwitch({ label: "The example's parts", switchSize: "regular", isShowingOnePanel: true, tabs: [{ label: "Overview", href: "#example-part-overview", isCurrent: true }, { label: "Rooms", href: "#example-part-rooms", isCurrent: false }, { label: "Updates", href: "#example-part-updates", isCurrent: false }] }) },
        { kind: "words", id: "example-part-overview", markup: html`<p>What the game is, its details and what it sells.</p>` },
        { kind: "words", id: "example-part-rooms", isHidden: true, markup: html`<p>Join by code, friends' rooms, then every room.</p>` },
        { kind: "words", id: "example-part-updates", isHidden: true, markup: html`<p>The patch notes, newest first.</p>` },
      ] })}</div>`,
    },
    {
      label: "With a menu for narrow screens: the tabs here, a Select field of the same choices on a phone (a game's Rooms tab: its modes and maps)",
      markup: tabSwitch({ label: "Mode", switchSize: "small", tabs: [{ label: "Any mode", tabValue: "", isCurrent: true }, { label: "Survival", tabValue: "Survival", isCurrent: false }, { label: "Creative", tabValue: "Creative", isCurrent: false }], menuWhenNarrow: selectField({ id: "example-switch-menu", name: "example_mode", label: "Mode", isLabelHidden: true, choices: [{ label: "Any mode", choiceValue: "" }, { label: "Survival", choiceValue: "Survival" }, { label: "Creative", choiceValue: "Creative" }] }) }),
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
      markup: tabSwitch({ label: "Inbox", switchSize: "small", tabs: [{ ...action("replies"), href: "#switch", badgeCount: 3, isCurrent: true }, { ...action("mentions"), href: "#switch", badgeCount: 12, isCurrent: false }] }),
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
const MOTIONS: { token: string; use: string }[] = [
  { token: "--motion-press", use: "a press sinking" },
  { token: "--motion-state", use: "a state fading, and anything leaving" },
  { token: "--motion-page-switch", use: "moving to the next page" },
  { token: "--motion-arrive", use: "a layer arriving" },
  { token: "--motion-float", use: "a floating pane coming and going" },
  { token: "--motion-glide", use: "a slab gliding, a size changing" },
  { token: "--motion-settle", use: "a flare settling" },
  { token: "--motion-world", use: "a game's world fading in" },
  { token: "--motion-loop", use: "a light looping" },
  { token: "--motion-loop-slow", use: "a slower light looping" },
  { token: "--ease-standard", use: "easing in and out, with no overshoot" },
  { token: "--ease-glide", use: "starting fast and settling" },
  { token: "--ease-settle", use: "sliding across and settling a touch past its place" },
  { token: "--ease-leave", use: "gathering speed on the way out" },
  { token: "--ease-spring", use: "swinging a little past its place and back" },
  { token: "--spring", use: "the same spring, by its short name" },
];

component({
  name: "Motion",
  slug: "motion",
  group: "foundations",
  subgroup: "look",
  summary: "Things move only when pointed at, pressed or chosen, each at one of these times on one of these curves; nothing times itself. Anything leaving goes faster than it came. Reduced motion stops all of it.",
  styles: `
/* Motion: one small moment on a stage, played by its button (GALLERY_SCRIPT), saying each motion as it happens. */
.motion-stage { display: grid; gap: var(--gap-block-block); width: 100%; }
.motion-now { margin: 0; font: var(--type-label); color: var(--ink); }
.motion-tag { display: block; opacity: 0; transform: translateY(-8px); transition: opacity var(--motion-state) var(--ease-leave), transform var(--motion-state) var(--ease-leave); }
.motion-tag.is-arrived { opacity: 1; transform: none; transition: opacity var(--motion-arrive) var(--ease-glide), transform var(--motion-arrive) var(--ease-glide); }
@media (prefers-reduced-motion: reduce) { .motion-tag { transition: none; transform: none; } }
`,
  examples: [
    {
      label: "One moment, each motion named as it happens",
      isWide: true,
      markup: html`<div class="motion-stage" data-motion-stage>${glassPane({ paneWidth: "full", body: stack({ items: [
        { kind: "words", markup: html`<p class="motion-now" data-motion-now>Press Play.</p>` },
        { kind: "control", markup: tabSwitch({ label: "Motion", switchSize: "big", tabs: [{ label: "Here", isCurrent: true }, { label: "There", isCurrent: false }] }) },
        { kind: "block", markup: html`<span class="motion-tag" data-motion-tag>${tag("Saved", "new")}</span>` },
        { kind: "control", markup: primaryButton("Play", { type: "button", dataAttributes: { "motion-play": "" } }) },
      ] }) })}</div>`,
    },
    {
      label: "Every time and every curve",
      isWide: true,
      markup: html`<ul class="type-sample">${MOTIONS.map(({ token, use }) => html`<li><code class="words-margin">${token}: ${tokenValue(token.slice(2))}</code><p class="is-muted" style="font:var(--type-note)">${use}</p></li>`)}</ul>`,
    },
  ],
});
