import { BARE_GROUPS, LEAST_SCROLL_PX } from "./tokens.ts";

/** Where a measured rule runs (docs/DESIGN.md, Rules): once per component on the gallery's pages, on every page, or in the nightly sweep. */
export type LayoutRuleTier = "gallery" | "page" | "sweep";
export const LAYOUT_TIERS: readonly LayoutRuleTier[] = ["gallery", "page", "sweep"];

/**
 * Every rule the measuring check still measures, by the name it fails with (a report() below, or a check: in scripts/layout-check.mjs), and
 * its tier. A rule made impossible in code (a type, or a scan of the rendered page in test/site/design.test.ts) isn't measured at all:
 * a control is its size class's height (test/node/materials.test.ts refuses any other height, in styles or markup), and the controls in
 * a row are one height (row() sets each to its tallest's size class).
 *   - gallery: how one component is built (its sizes, margins, cuts), proven once on the gallery's pages, on every screen and at 200% text;
 *   - page: how a page arranges what its content decides (overlaps, spills, words cut off, scrolling sideways, the fold), on every page and
 *     state on each pull request, on a phone and a laptop; an arrangement a layout component makes (pane gaps, the page's column, a row's
 *     line, a stack's gaps) is gallery, since a page can't make it any other way;
 *   - sweep: what's too slow to measure on every pull request, and every rule on every page on the other screens, in dark, at 200% text
 *     and on the stress accounts, each night (.github/workflows/nightly.yml).
 * test/layout/layout-check.test.ts fails a rule that isn't here, and a name here no rule uses.
 */
export const LAYOUT_RULE_TIERS: Readonly<Record<string, LayoutRuleTier>> = {
  "a touch target under 44px": "gallery",
  "bevel under 4px": "gallery",
  "square in a cut corner": "gallery",
  "a corner control without its corner's bevel": "gallery",
  "a corner control not in its corner": "gallery",
  "an equal row's cells of different widths": "gallery",
  "words beside a control off its center line": "gallery",
  "a bare group's parts off each other": "gallery",
  "a bare group closer to the pane's edge than the words margin": "gallery",
  "closer to the pane's edge than the frame gap": "gallery",
  "off the frame gap": "gallery",
  "words off the pane's margin": "gallery",
  "words closer to the pane's edge than its margin": "gallery",
  "words inside it off the pane's words": "gallery",
  "a pane wider than its kind allows": "gallery",
  "a pane taller than its kind allows": "gallery",
  "a pane past the screen": "gallery",
  "a pane that overflows without scrolling": "gallery",
  "a box that scrolls up and down by a sliver": "gallery",
  "a line of words longer than the reading width": "gallery",
  "a reading column off the middle": "gallery",
  "wider than its page's shape": "gallery",
  "one kind at different sizes": "gallery",
  "the check couldn't open the gallery's panes": "gallery",
  // Arrangements a layout component makes, proven on the gallery's Layout pages: a page can't arrange them any other way.
  // Panes on a page sit only in a stack, columns or a grid, whose gaps are the block gap (a page is only gallery components, test/site/design.test.ts).
  "two panes closer than a block's gap": "gallery",
  "two panes overlapping": "gallery",
  // A page's column is its page shape's (html[data-page-shape], layout.ts's PAGE_SHAPES), a fixed set.
  "out of line with the header": "gallery",
  // row() sets every cell to its tallest control's size class.
  "controls in one row not on one line": "gallery",
  // stack() picks each gap from what's on each side, never one passed.
  "words nearer the block before than their own": "gallery",
  "one group on two surfaces": "gallery",
  "overlaps another thing": "page",
  "spills out of its pane": "page",
  "words cut off": "page",
  "the page scrolls sideways": "page",
  "the runner below the fold": "page",
  "the first cover below the fold": "page",
  "an empty thing taking a gap": "page",
  "a control alone on a row's line, short of its end": "page",
  "words over something with an edge": "page",
  // Two controls a page sets side by side outside a row: only a page's arrangement (columns, a grid's cells) can, so it's measured there.
  "two controls side by side outside a row": "page",
  "the check couldn't send the page's form": "page",
  "the check couldn't open the page's hidden state": "page",
  "the check couldn't measure the page": "page",
  "the page isn't the state it's listed as": "page",
  "the page didn't settle in time": "page",
  // The loading check (FIRST_PAINT_SNAPSHOT_SOURCE): a page shows whole while it loads ("A page shows whole while it loads", docs/DESIGN.md).
  // Every picture comes as a ShownPicture with its placeholder (impossible otherwise in code), proven on the gallery's pictures.
  "a picture without its placeholder": "gallery",
  "moved after the first paint": "page",
  "words changed after the first paint": "page",
  "no answer within 400 ms": "sweep",
  "the check couldn't press the page's buttons": "sweep",
};

/**
 * The measuring check (docs/DESIGN.md, Layout), run in a page: what's out of line on it, as failures, each { check, element, said }.
 * scripts/layout-check.mjs runs it on every page in Chrome, and Screens (screens.ts) on each page it shows, live. It's a function's
 * source, since it runs in the browser: (MEASURE_LAYOUT_SOURCE)({ isMainActionChecked, isCoverAboveFold, isTouch, tiers }), where tiers
 * are the LAYOUT_RULE_TIERS it measures (every tier when it's left out). Things with an edge of their own are framed:
 * cut by the edge rule (data-cut-line), glass of their own (data-glass), a cover, or a list's rows.
 */
export const MEASURE_LAYOUT_SOURCE = String.raw`function measurePage(options) {
  // The bare groups (tokens.ts): a unit whose words sit bare, measured whole.
  var BARE_GROUPS = ${JSON.stringify(BARE_GROUPS.join(", "))};
  var TIERS = ${JSON.stringify(LAYOUT_RULE_TIERS)};
  var tiers = options.tiers || ${JSON.stringify(LAYOUT_TIERS)};
  // Whether this run measures a rule (a rule missing from LAYOUT_RULE_TIERS is always measured).
  function isMeasured(check) { return !TIERS[check] || tiers.indexOf(TIERS[check]) >= 0; }
  var TOLERANCE_PX = 1.5, LEAST_BEVEL_PX = 4;
  // How far a pane's corner cut reaches into what sits in that corner, by its gaps to the corner's two sides added up: the one line the edge
  // rule cuts everything in a corner along (glass-script.ts's fitCuts), the pane's cut moved in by the frame gap. Past it, a corner is square.
  var cutReaching = function (paneCutPx, gapsPx, frameGapPx) { return paneCutPx - gapsPx + Math.SQRT2 * Math.min(gapsPx / 2, frameGapPx); };
  var failures = [];
  var root = getComputedStyle(document.documentElement);
  var slantOverlapPx = Math.abs(parseFloat(root.getPropertyValue("--control-slant")) - parseFloat(root.getPropertyValue("--gap-control-row"))) || 6;
  // A person is framed by their picture, and code in reading text by its well.
  // A PIN's row of marks is one control, measured as a whole: its marks are its inside.
  var FRAMED = "[data-cut-line], [data-glass], .cover, .list-rows, .person, .reading pre, .slider-track, .pin-marks";
  // Pieces made to lie over each other: a row of pictures, each over the next.
  var OVERLAPPING = ".picture-row";
  var SKIPPED = "script, style, template, .sr, [aria-hidden='true'], .loader, .rail, .edge, .cut-line";
  // Words people see are measured even where a screen reader skips them (a chart's drawn scale and axis, read as a table instead).
  var WORDS_SKIPPED = "script, style, template, .sr, .loader, .rail, .edge, .cut-line";
  var COMPONENTS = ["run-wrap", "cut-btn", "tertiary-btn", "cut-field", "field", "find", "switch-well", "tab-switch", "steps", "cover", "banner", "glass-pane", "tray", "tray-head", "sheet", "dropdown", "notice", "table", "list-rows", "choice-card", "toggle", "check", "top", "foot", "layout-row", "layout-stack", "layout-grid", "layout-track", "pane-head", "pane-foot"];
  // Asked of the same element again and again, and nothing measuring changes what shows: worked out once each.
  var shownByElement = new Map();
  function isShown(el) {
    if (!shownByElement.has(el)) shownByElement.set(el, isShownNow(el));
    return shownByElement.get(el);
  }
  function isShownNow(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    var css = getComputedStyle(el);
    // What a closed details folds away is laid out but never drawn.
    return css.visibility !== "hidden" && Number(css.opacity) > 0.01 && !el.closest("[hidden], dialog:not([open]), details:not([open]) > :not(summary)");
  }
  function describe(el) {
    var named = el.closest("[class]"), component = "", walk = el;
    while (walk && !component) { component = COMPONENTS.find(function (name) { return walk.classList && walk.classList.contains(name); }) || ""; walk = walk.parentElement; }
    var label = (el.getAttribute("aria-label") || el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 48);
    return (component || (named ? named.className.split(" ")[0] : el.tagName.toLowerCase())) + (label ? ' "' + label + '"' : "");
  }
  function report(check, el, said) { if (isMeasured(check)) failures.push({ check: check, element: describe(el), said: said }); }
  var round = function (n) { return Math.round(n * 10) / 10; };
  // A length as the page works it out (a token in rem, a calc), in px: a probe takes it as its width for a moment, inside what sets it.
  // Each probe changes the page, so the next read lays it all out again: a length is worked out once for what decides it (the tokens it
  // names, as they are where it's measured, and that place's font), and remembered.
  var lengthsByKey = new Map();
  function lengthPx(expression, inside) {
    var place = inside || document.body, css = getComputedStyle(place), names = expression.match(/--[\w-]+/g) || [];
    var key = expression + "|" + css.fontFamily + "|" + css.fontSize + "|" + css.fontWeight + "|" + names.map(function (name) { return css.getPropertyValue(name).trim(); }).join("|");
    if (lengthsByKey.has(key)) return lengthsByKey.get(key);
    var probe = document.createElement("i"); probe.style.cssText = "position:absolute;visibility:hidden;display:block;height:0;width:" + expression;
    place.appendChild(probe); var found = probe.getBoundingClientRect().width; probe.remove();
    lengthsByKey.set(key, found);
    return found;
  }
  // What sits over the page, fixed to the window: a sheet, a menu, a popover, a notice, a card over the game. Measured as panes over the page.
  var OVER_PAGE = ".sheet:not(.in-place), .dropdown, [popover], .notice, .playing-card, .playing-bar, .playing-check";
  function isOnFixed(el) { for (var walk = el; walk && walk !== document.body; walk = walk.parentElement) { if (getComputedStyle(walk).position === "fixed") return true; } return false; }
  // A gallery example is a piece shown alone, not a page: the page's own rules (its titles, its headings' order) skip it.
  var EXAMPLE = ".example-stage";
  // ---- Pane sizes (docs/DESIGN.md, Pane sizes): a pane over the page stops at its kind's size and the screen, and scrolls inside past it. ----
  function measurePanes() {
    var isPhoneWide = innerWidth <= 760;
    function paneKind(pane) {
      if (pane.matches(".dropdown")) return { name: "a menu", widthPx: lengthPx("var(--size-menu)"), heightPx: lengthPx("var(--size-menu-height)") };
      if (pane.matches(".select-list")) { var field = document.querySelector('[popovertarget="' + pane.id + '"]'); var holder = field && (field.closest(".cut-field") || field); return { name: "a select's list", widthPx: holder ? holder.getBoundingClientRect().width : Infinity, heightPx: lengthPx("var(--size-menu-height)") }; }
      // A light box fills the window by design: what it holds keeps its own size.
      if (pane.matches(".light-box")) return null;
      if (pane.matches(".sheet")) {
        var token = pane.matches(".is-compact") ? "--size-sheet-compact" : pane.matches(".store-panel") ? "--size-store-panel" : pane.matches(".is-picture") ? "--size-sheet-picture" : "--size-sheet";
        return { name: { "--size-sheet": "a sheet", "--size-store-panel": "a store panel", "--size-sheet-picture": "a picture's sheet", "--size-sheet-compact": "a compact sheet" }[token], widthPx: isPhoneWide && !pane.matches(".in-place") ? innerWidth : lengthPx("var(" + token + ")"), heightPx: Infinity };
      }
      return null;
    }
    function roomOf(pane) {
      // In the browser's top layer (a sheet opened over the page, a popover), the window is its room, whatever holds it.
      if (pane.matches(":modal, :popover-open")) return { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
      for (var walk = pane.parentElement; walk && walk !== document.documentElement; walk = walk.parentElement) {
        var css = getComputedStyle(walk);
        if (css.transform !== "none" || css.filter !== "none" || (css.backdropFilter || "none") !== "none" || (css.containerType || "normal") !== "normal" || /transform|filter/.test(css.willChange || "") || /paint|layout|strict|content/.test(css.contain || "")) return walk.getBoundingClientRect();
      }
      return { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    }
    var overPanes = Array.prototype.filter.call(document.querySelectorAll(".floating-pane.in-place, dialog.sheet[open], .sheet.in-place, :popover-open, .notice, .playing-card"), function (pane) { return isShown(pane); });
    overPanes.forEach(function (pane) {
      var r = pane.getBoundingClientRect(), kind = paneKind(pane), isInPlace = pane.matches(".in-place");
      if (kind && r.width > kind.widthPx + TOLERANCE_PX) report("a pane wider than its kind allows", pane, round(r.width) + "px wide, " + kind.name + " at most " + round(kind.widthPx) + "px");
      // A floating pane the gallery shows open in place (its open states) keeps its height too, so its open state shows it scrolling. On a
      // page, one shown open is measured as any pane over the page is.
      var isStill = Boolean(pane.closest(EXAMPLE)) && (isInPlace || Boolean(pane.closest(EXAMPLE + " .in-place")));
      if (isStill && !pane.matches(".floating-pane")) return;
      if (kind && r.height > kind.heightPx + TOLERANCE_PX) report("a pane taller than its kind allows", pane, round(r.height) + "px tall, " + kind.name + " at most " + round(kind.heightPx) + "px");
      if (isStill) return;
      var room = roomOf(pane), past = [["left", room.left - r.left], ["right", r.right - room.right], ["top", room.top - r.top], ["bottom", r.bottom - room.bottom]].find(function (side) { return side[1] > TOLERANCE_PX; });
      if (past) report("a pane past the screen", pane, "its " + past[0] + " edge " + round(past[1]) + "px past the " + (room.width === undefined ? "window's" : "frame's it opens in"));
      // Everything in it shows inside it, or inside something in it that scrolls.
      var spill = 0;
      Array.prototype.forEach.call(pane.querySelectorAll("*"), function (el) {
        if (el.matches(SKIPPED) || el.closest(SKIPPED) || !isShown(el)) return;
        for (var walk = el.parentElement; walk && walk !== pane; walk = walk.parentElement) if (/^(auto|scroll|hidden|clip)$/.test(getComputedStyle(walk).overflowY)) return;
        var o = el.getBoundingClientRect(); spill = Math.max(spill, o.bottom - r.bottom, r.top - o.top);
      });
      if (spill > TOLERANCE_PX) report("a pane that overflows without scrolling", pane, round(spill) + "px of what's in it outside it, and nothing in it scrolls");
    });
  }
  // The gallery's panes opened one by one (scripts/layout-check.mjs) are measured for their size alone.
  if (options.isPanesOnly) { measurePanes(); return failures; }
  // The box that scrolls sideways round an element, up to the pane (a track of covers): only what shows in it is measured.
  function scrollerIn(el, pane) {
    for (var walk = el.parentElement; walk && walk !== pane; walk = walk.parentElement) { var x = getComputedStyle(walk).overflowX; if (x === "auto" || x === "scroll" || x === "hidden") return walk; }
    return null;
  }
  // Up and down too, in anything but the pane's own content (which is measured whole, wherever it's scrolled): a select's list.
  function isScrolledAway(el, pane) {
    var scroller = scrollerIn(el, pane); if (!scroller) return false;
    var r = el.getBoundingClientRect(), s = scroller.getBoundingClientRect(), isPaneContent = scroller.parentElement === pane && scroller.matches(".pane-in, .sheet-in");
    return r.left < s.left - TOLERANCE_PX || r.right > s.right + TOLERANCE_PX || (!isPaneContent && (r.top < s.top - TOLERANCE_PX || r.bottom > s.bottom + TOLERANCE_PX));
  }
  // A line of words as it's set: its line box, not the taller box its letters' accents and descenders reach.
  function lineBox(r, el) {
    var lineHeightPx = parseFloat(getComputedStyle(el).lineHeight);
    if (!lineHeightPx || r.height <= lineHeightPx) return r;
    var trim = (r.height - lineHeightPx) / 2;
    return { left: r.left, right: r.right, top: r.top + trim, bottom: r.bottom - trim, width: r.width, height: lineHeightPx };
  }
  // The framed thing an element is part of, up to the pane: null when it's the pane's own.
  function framedIn(el, pane) {
    for (var walk = el.parentElement; walk && walk !== pane; walk = walk.parentElement) {
      if (walk.hasAttribute("data-on-no-pane")) return walk;
      if (walk.matches(FRAMED)) return walk;
    }
    return null;
  }
  // What has words inside it that line up with the pane's (a field's icon or text, a table's cells, a list's rows), and where they start.
  // A color field's button leads with its chip, a carving at the field's inner edge, not with words.
  var INNER_WORDS = ".cut-field > .field, .field.select, .field.code, .field.long, .find, .wheel-button:not(.color-button), .choice-cards > .choice-card, .table, .list-rows";
  function innerStart(el) {
    var start = null, walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim() || !text.parentElement || text.parentElement.closest(SKIPPED) || !isShown(text.parentElement)) continue;
      var range = document.createRange(); range.selectNodeContents(text);
      Array.prototype.forEach.call(range.getClientRects(), function (glyphs) { if (glyphs.width >= 1 && (start === null || glyphs.left < start)) start = glyphs.left; });
    }
    Array.prototype.forEach.call(el.querySelectorAll("svg.ico, input, textarea, .frame, img"), function (each) {
      if (!isShown(each)) return;
      var r = each.getBoundingClientRect(), padPx = each.matches("input, textarea") ? parseFloat(getComputedStyle(each).paddingLeft) || 0 : 0;
      if (each.matches("input, textarea") && !each.value && !each.placeholder) return;
      if (start === null || r.left + padPx < start) start = r.left + padPx;
    });
    return start;
  }
  // Words beside controls: in a row on one line, beside a pane's corner control. Their first line (their last on a field's boxes and at a
  // pane's foot) sits on the controls' center line.
  var BESIDE_CONTROLS = ".layout-row[data-control-height]:not(.is-wrapped), .pane-head[data-control-height], .pane-foot[data-control-height]";
  var BESIDE_CONTROLS_WORDS = ".layout-row[data-control-height]:not(.is-wrapped) > .row-cell.is-words, .pane-head[data-control-height] > .pane-head-words, .pane-foot[data-control-height] > .pane-foot-start.is-words";
  function lineOf(el, isLast) {
    var found = null, walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), text;
    while ((text = walker.nextNode())) {
      if (!text.textContent.trim() || !text.parentElement || text.parentElement.closest(SKIPPED) || !isShown(text.parentElement)) continue;
      var range = document.createRange(); range.selectNodeContents(text);
      var rects = Array.prototype.filter.call(range.getClientRects(), function (glyphs) { return glyphs.width >= 1; });
      if (!rects.length) continue;
      var line = lineBox(isLast ? rects[rects.length - 1] : rects[0], text.parentElement);
      if (!isLast) return line;
      found = line;
    }
    return found;
  }
  var panes = Array.prototype.filter.call(document.querySelectorAll("[data-glass]:not([data-cut-line])"), function (pane) { return isShown(pane) && !pane.classList.contains("frame"); });
  panes.forEach(function (pane) {
    // What holds a pane's content and pads it: its inner part (a sidebar's places scroll in .sidebar-scroll), or the pane itself.
    var holder = pane.querySelector(":scope > .pane-in, :scope > .sheet-in, :scope > .playing-card-in, :scope > .sidebar-scroll") || pane, css = getComputedStyle(holder), p = pane.getBoundingClientRect();
    var gap = { left: parseFloat(css.paddingLeft), right: parseFloat(css.paddingRight), top: parseFloat(css.paddingTop), bottom: parseFloat(css.paddingBottom) };
    var words = parseFloat(css.getPropertyValue("--pad-words")) || 0;
    // The words margin, one rule for every surface of glass (tokens.ts): words are never closer to its edge than --pad-pane (a tray's, --pad-tray),
    // whatever the surface pads itself. Only what has an edge of its own may sit closer, at the frame gap.
    // A compact material (a tray, a floating pane, a compact pane) keeps the compact margin, --pad-tray.
    var marginPx = parseFloat(root.getPropertyValue(pane.matches(".tray, .tray-group, .floating-pane, .compact") ? "--pad-tray" : "--pad-pane")) || 0;
    // A pane that scrolls inside itself: its top and bottom are its content's, wherever it's scrolled to.
    var isScrolling = holder.scrollHeight > holder.clientHeight + 1, contentTop = holder.getBoundingClientRect().top - holder.scrollTop;
    var box = { left: p.left, right: p.right, top: isScrolling ? contentTop : p.top, bottom: isScrolling ? contentTop + holder.scrollHeight : p.bottom };
    var distances = function (r) { return { left: r.left - box.left, right: box.right - r.right, top: r.top - box.top, bottom: box.bottom - r.bottom }; };
    // A floating pane the gallery shows open in place (a select's list over its field, a wheel field's wheels) is laid over the pane, not
    // set in it: it's measured as a pane of its own, never at the frame gap of the pane under it.
    var framed = Array.prototype.filter.call(pane.querySelectorAll(FRAMED), function (el) { return el !== pane && !el.matches(".floating-pane.in-place") && !el.closest(".rail") && !framedIn(el, pane) && isShown(el); });
    var paneCuts = window.zaismaCorners ? window.zaismaCorners(pane, "pane") : [1, 1, 1, 1];
    framed.forEach(function (el) {
      if (isScrolledAway(el, pane)) return;
      var r = el.getBoundingClientRect(), d = distances(r), whereItIs = d;
      // Inside what scrolls with its rail showing, the rail's room at the right is part of the gap there.
      // What scrolls pads nothing of its own but the rail's room, unless it's what holds the pane's content, which pads the frame gap too.
      var railed = el.closest(".shows-rail"), railPx = railed && pane.contains(railed) ? Math.max(0, parseFloat(getComputedStyle(railed).paddingRight) - (railed === holder ? gap.right : 0)) : 0;
      if (railPx) d = { left: d.left, right: Math.max(gap.right, d.right - railPx), top: d.top, bottom: d.bottom };
      // In a task sheet's dropped head (--head-drop), its Close sits that much further in from the top and the end, at the words margin's line.
      // What its words hold (a store's cover beside its title) sits on that line itself, at the words margin, and is measured where it is.
      var droppedHead = el.closest(".pane-head"), headEnd = el.closest(".pane-head-end");
      if (droppedHead && pane.contains(droppedHead) && !el.closest(".pane-head-words")) d = { left: d.left, right: d.right - (headEnd ? parseFloat(getComputedStyle(headEnd).marginInlineEnd) || 0 : 0), top: d.top - (parseFloat(getComputedStyle(droppedHead).marginTop) || 0), bottom: d.bottom };
      // In a list that scrolls up and down inside the pane (a long menu's choices), what shows sits wherever it's scrolled to: only its sides are measured.
      var holdingScroller = scrollerIn(el, pane), isInScrolledList = holdingScroller && !holdingScroller.matches(".pane-in, .sheet-in") && holdingScroller.scrollHeight > holdingScroller.clientHeight + 1;
      (isInScrolledList ? ["left", "right"] : ["left", "right", "top", "bottom"]).forEach(function (side) {
        if (d[side] < gap[side] - TOLERANCE_PX) {
          if (d[side] < -TOLERANCE_PX && (side === "left" || side === "right" || !isScrolling)) report("spills out of its pane", el, side + " edge " + round(-d[side]) + "px past the pane's");
          else report("closer to the pane's edge than the frame gap", el, round(d[side]) + "px from the " + side + " edge, expected " + round(gap[side]) + "px");
        } else if (d[side] > gap[side] + TOLERANCE_PX && d[side] < gap[side] + words - TOLERANCE_PX) {
          report("off the frame gap", el, round(d[side]) + "px from the " + side + " edge, expected the frame gap " + round(gap[side]) + "px");
        }
      });
      // Where the pane's corner cut reaches it (measured where it is, a rail's room or a dropped head's further in included), it keeps a bevel there.
      [["top", "left"], ["top", "right"], ["bottom", "right"], ["bottom", "left"]].forEach(function (corner, i) {
        var cut = (el.cutCorners || [])[i];
        if (cut !== undefined && !isInScrolledList && cutReaching(paneCuts[i], whereItIs[corner[0]] + whereItIs[corner[1]], Math.min(gap[corner[0]], gap[corner[1]])) > 0.5 && cut < LEAST_BEVEL_PX - 0.01) report("bevel under 4px", el, "in the pane's " + corner.join(" ") + " corner its bevel is " + round(cut) + "px");
      });
    });
    // Anything with an edge of its own (a picture, a filled, bordered or shadowed box) at the frame gap in a cut corner of the pane is cut
    // there too, by itself or by what holds it: nothing square sits against a cut corner. Words, bare icons and thin lines have no edge, and
    // neither has a shadow all in a clear color (a focus ring at rest). Words inline (a link) are never cut, as the edge rule leaves them.
    function isShadowSeen(shadow) {
      return shadow !== "none" && (shadow.match(/rgba?\([^)]*\)/g) || [""]).some(function (color) { var parts = color.match(/[\d.]+/g); return !parts || parts.length < 4 || Number(parts[3]) > 0.04; });
    }
    if (!pane.closest(".frame")) (function walk(el) {
      Array.prototype.forEach.call(el.children, function (child) {
        if (child instanceof SVGElement || child.matches("[data-glass]:not(.frame), .edge, .cut-line") || !isShown(child) || isScrolledAway(child, pane)) return;
        var r = child.getBoundingClientRect(), d = distances(r), css = getComputedStyle(child);
        if (!r.width || !r.height || css.clipPath !== "none") return;
        if (css.display === "inline" || css.display === "contents") return walk(child);
        var corner = [["top", "left"], ["top", "right"], ["bottom", "right"], ["bottom", "left"]].findIndex(function (sides, i) {
          return paneCuts[i] > 0 && d[sides[0]] <= gap[sides[0]] + TOLERANCE_PX && d[sides[1]] <= gap[sides[1]] + TOLERANCE_PX;
        });
        var isEdged = /^(IMG|VIDEO|CANVAS|IFRAME)$/.test(child.tagName) || css.backgroundImage !== "none" || isShadowSeen(css.boxShadow) ||
          (function (fill) { return fill && (fill.length < 4 || Number(fill[3]) > 0.04); })(css.backgroundColor.match(/[\d.]+/g)) ||
          ["Top", "Right", "Bottom", "Left"].some(function (side) { return parseFloat(css["border" + side + "Width"]) > 0 && !/rgba\(.*, 0\)|transparent/.test(css["border" + side + "Color"]); });
        if (corner >= 0 && isEdged && Math.min(r.width, r.height) >= 6) report("square in a cut corner", child, "an edge in the pane's " + ["top left", "top right", "bottom right", "bottom left"][corner] + " corner with no cut");
        else if (corner >= 0) walk(child);
      });
    })(pane);
    // Two things with an edge overlap only as far as two controls side by side do, slanting toward each other.
    for (var i = 0; i < framed.length; i++) for (var j = i + 1; j < framed.length; j++) {
      if (framed[i].closest(OVERLAPPING) && framed[i].closest(OVERLAPPING) === framed[j].closest(OVERLAPPING)) continue;
      if (isScrolledAway(framed[i], pane) || isScrolledAway(framed[j], pane)) continue;
      var a = framed[i].getBoundingClientRect(), b = framed[j].getBoundingClientRect();
      var across = Math.min(a.right, b.right) - Math.max(a.left, b.left), down = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (across > slantOverlapPx + TOLERANCE_PX && down > TOLERANCE_PX) report("overlaps another thing", framed[i], "overlaps " + describe(framed[j]) + " by " + round(across) + " x " + round(down) + "px");
    }
    // Inside what has an edge and sits at the pane's start edge (a field, a table, a list), its words start where the pane's words do, so
    // a heading over a field lines up with the field's words, not its box.
    // Not in a bar (the header, a menu): its words have no margin of their own to line up with.
    if (words > 0) framed.forEach(function (el) {
      if (!el.matches(INNER_WORDS) || isScrolledAway(el, pane)) return;
      var r = el.getBoundingClientRect();
      if (Math.abs(r.left - box.left - gap.left) > TOLERANCE_PX) return;
      var start = innerStart(el);
      if (start === null) return;
      var expectedPx = gap.left + words, foundPx = start - box.left;
      if (Math.abs(foundPx - expectedPx) > TOLERANCE_PX) report("words inside it off the pane's words", el, "they start " + round(foundPx) + "px from the pane's edge, its words " + round(expectedPx) + "px");
    });
    // Words: every line of the pane's own words keeps its margin, and lies over nothing with an edge.
    var walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT), text, flagged = new Set(), lines = [];
    while ((text = walker.nextNode())) {
      var el = text.parentElement;
      if (!text.textContent.trim() || !el || el.closest(WORDS_SKIPPED) || el.matches(FRAMED) || framedIn(el, pane) || !isShown(el) || flagged.has(el)) continue;
      var range = document.createRange(); range.selectNodeContents(text);
      if (isScrolledAway(el, pane)) continue;
      Array.prototype.some.call(range.getClientRects(), function (glyphs) {
        if (glyphs.width < 1 || glyphs.height < 1) return false;
        var r = lineBox(glyphs, el), scroller = scrollerIn(el, pane);
        // Words running on past what scrolls sideways round them are measured where they show.
        if (scroller) { var s = scroller.getBoundingClientRect(); if (r.left < s.left - TOLERANCE_PX || r.right > s.right + TOLERANCE_PX) return false; }
        // Words that end in an ellipsis (a long name) are measured where they show, up to the ellipsis.
        if (getComputedStyle(el).textOverflow === "ellipsis") { var shown = el.getBoundingClientRect(); r = { left: Math.max(r.left, shown.left), right: Math.min(r.right, shown.right), top: r.top, bottom: r.bottom, width: Math.min(r.right, shown.right) - Math.max(r.left, shown.left), height: r.height }; }
        var d = distances(r), wordsAt = { left: Math.max(gap.left + words, marginPx), right: Math.max(gap.right + words, marginPx), top: Math.max(gap.top + words, marginPx), bottom: Math.max(gap.bottom + words, marginPx) };
        // Words beside a control sit on its center line rather than at the margin above or below them (checked below), and words beside
        // anything else with an edge (a swatch, a box) line up with it the same way.
        // Only while the line sits inside that thing's height with room to spare: a line that reaches its top or foot, or runs past it (a note
        // beside a swatch that stretches to it), keeps the margin there too.
        var besideFramed = framed.find(function (f) { var o = f.getBoundingClientRect(); return (o.right <= r.left + TOLERANCE_PX || o.left >= r.right - TOLERANCE_PX) && Math.min(o.bottom, r.bottom) - Math.max(o.top, r.top) > TOLERANCE_PX; });
        var besideBox = besideFramed && besideFramed.getBoundingClientRect(), isBesideFramed = Boolean(besideBox) && r.top > besideBox.top + TOLERANCE_PX && r.bottom < besideBox.bottom - TOLERANCE_PX;
        // A notice is one centered line, as tall as a small control and its room: its words keep the margin at the sides only. Words in what
        // scrolls sideways run under its fading edge, so only their top and bottom are measured there.
        var sides = el.closest(BESIDE_CONTROLS_WORDS) || el.closest(".words-margin.beside-controls") || isBesideFramed || pane.matches(".notice") ? ["left", "right"] : scroller && scroller.scrollWidth > scroller.clientWidth + 1 ? ["top", "bottom"] : ["left", "right", "top", "bottom"];
        var side = sides.find(function (each) { return d[each] < wordsAt[each] - TOLERANCE_PX; });
        if (side) { flagged.add(el); report("words closer to the pane's edge than its margin", el, round(d[side]) + "px from the " + side + " edge of " + describe(pane) + ", the words margin is " + round(wordsAt[side]) + "px"); return true; }
        // What's scrolled out of its box (the buy sheet's body, scrolled to its confirm step) isn't under the words: it isn't shown there.
        var under = framed.find(function (f) { if (isScrolledAway(f, pane)) return false; var o = f.getBoundingClientRect(); return Math.min(r.right, o.right) - Math.max(r.left, o.left) > TOLERANCE_PX && Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top) > TOLERANCE_PX; });
        if (under) { flagged.add(el); report("words over something with an edge", el, "over " + describe(under)); return true; }
        lines.push({ r: r, el: el });
        return false;
      });
    }
    // A line of words at the pane's start with nothing before it starts at the margin, never a little further in (words inset twice).
    // A key's color swatch leads its words as an icon does.
    var marks = framed.concat(Array.prototype.filter.call(pane.querySelectorAll("svg.ico, img, canvas, .loader, .usage-swatch, .ring-swatch"), isShown));
    // Something on the line before it (a box, an icon, other words), or words lined up with words that have (a check's hint under its label).
    var hasBefore = function (line) {
      var isBefore = function (o) { return o.right <= line.r.left + TOLERANCE_PX && o.right > box.left + gap.left && Math.min(o.bottom, line.r.bottom) - Math.max(o.top, line.r.top) > TOLERANCE_PX; };
      return marks.some(function (each) { return isBefore(each.getBoundingClientRect()); }) || lines.some(function (other) { return other !== line && isBefore(other.r); });
    };
    lines.forEach(function (line) {
      // A tag's words are inside its own carving, a code word in its own well, and a list's lines are set in from the bullet before them.
      // A quote is set in from its hairline.
      var listLine = line.el.closest("li");
      if (flagged.has(line.el) || line.el.closest(".tag, blockquote, code") || (listLine && getComputedStyle(listLine).listStyleType !== "none")) return;
      var d = distances(line.r), marginPx = gap.left + words;
      if (d.left <= marginPx + TOLERANCE_PX || d.left >= 2 * marginPx - TOLERANCE_PX) return;
      if (["center", "right", "end"].indexOf(getComputedStyle(line.el).textAlign) >= 0) return;
      if (hasBefore(line) || lines.some(function (other) { return Math.abs(other.r.left - line.r.left) <= TOLERANCE_PX && hasBefore(other); })) return;
      flagged.add(line.el);
      report("words off the pane's margin", line.el, round(d.left) + "px from the start edge, its margin " + round(marginPx) + "px");
    });
    // Bare groups (tokens.ts's BARE_GROUPS: a game card with its title and players now, a person): one unit, whose parts line up with each
    // other and whose box, as a whole, keeps the words margin from the pane's edge on every side it meets it, top and bottom included. A row
    // that scrolls sideways counts its whole length.
    Array.prototype.forEach.call(pane.querySelectorAll(BARE_GROUPS), function (group) {
      if (!isShown(group) || isScrolledAway(group, pane) || framedIn(group, pane)) return;
      var parts = Array.prototype.filter.call(group.children, function (part) { var o = part.getBoundingClientRect(); return o.width >= 1 && o.height >= 1 && !part.matches(SKIPPED); });
      if (!parts.length) return;
      var unit = parts.reduce(function (all, part) { var o = part.getBoundingClientRect(); return { left: Math.min(all.left, o.left), right: Math.max(all.right, o.right), top: Math.min(all.top, o.top), bottom: Math.max(all.bottom, o.bottom) }; }, { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
      var d = distances(unit), track = group.closest(".layout-track");
      if (track && pane.contains(track)) { d = { left: d.left + track.scrollLeft, right: d.right + track.scrollWidth - track.clientWidth - track.scrollLeft, top: d.top, bottom: d.bottom }; }
      var tooClose = ["left", "right", "top", "bottom"].find(function (each) { return d[each] < marginPx - TOLERANCE_PX; });
      if (tooClose) report("a bare group closer to the pane's edge than the words margin", group, round(d[tooClose]) + "px from the " + tooClose + " edge of " + describe(pane) + ", the words margin is " + round(marginPx) + "px: the whole unit keeps it, not its words alone");
      var art = group.querySelector(":scope > .cover-art"), meta = group.querySelector(":scope > .cover-meta");
      if (art && meta && isShown(art) && isShown(meta)) {
        var a = art.getBoundingClientRect(), m = meta.getBoundingClientRect();
        if (Math.abs(m.left - a.left) > TOLERANCE_PX || Math.abs(m.right - a.right) > TOLERANCE_PX) report("a bare group's parts off each other", group, "its words span " + round(m.left - a.left) + "px and " + round(m.right - a.right) + "px off the cover's start and end: they line up with it");
      }
    });
  });
  // Rows: every control on one line (row() gives them one height). Where the row puts it is its cell's place: a control's own state may
  // move its face (an on toggle button lifts), which isn't where it sits.
  document.querySelectorAll(".layout-row").forEach(function (row) {
    if (!isShown(row)) return;
    var cells = Array.prototype.filter.call(row.querySelectorAll(":scope > .row-cell.is-control"), function (cell) { return isShown(cell) && cell.querySelector("[data-cut-line]"); });
    // A field's place is its box: its label stands above it, and a row on field boxes lines the boxes up (layout.ts).
    var placeOf = function (cell) { return (cell.querySelector(":scope > .cut-field > .field") || cell).getBoundingClientRect(); };
    cells.forEach(function (cell, i) {
      var a = placeOf(cell), control = cell.querySelector("[data-cut-line]");
      cells.slice(i + 1).forEach(function (other) {
        var b = placeOf(other), isSameLine = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0;
        if (!isSameLine) return;
        if (Math.abs(a.top - b.top) > 1) report("controls in one row not on one line", control, round(a.top - b.top) + "px off " + describe(other.querySelector("[data-cut-line]")));
      });
    });
  });
  // A control in a pane's corner (Pane parts): in it, at the frame gap, with the corner's cut.
  [[".pane-head-end", "top", 1], [".pane-foot-end", "bottom", 2]].forEach(function (place) {
    document.querySelectorAll(place[0]).forEach(function (end) {
      var control = end.querySelector("[data-cut-line]"), pane = end.closest("[data-glass]:not([data-cut-line])");
      // A tertiary button in a corner is words: it keeps the pane's margin, which the words' check measures.
      if (!control || !pane || !isShown(control) || end.classList.contains("is-words")) return;
      var holder = pane.querySelector(":scope > .pane-in, :scope > .sheet-in, :scope > .playing-card-in, :scope > .sidebar-scroll") || pane, css = getComputedStyle(holder), r = control.getBoundingClientRect(), p = pane.getBoundingClientRect();
      var away = place[1] === "top" ? r.top - p.top : p.bottom - r.bottom, side = p.right - r.right;
      var expected = { top: parseFloat(css.paddingTop), bottom: parseFloat(css.paddingBottom), right: parseFloat(css.paddingRight) };
      // A task sheet's head drops its title and Close to the pane's words margin (--head-drop): its corner is that far further in.
      if (place[1] === "top") { expected.top += parseFloat(getComputedStyle(end.parentElement).marginTop) || 0; expected.right += parseFloat(getComputedStyle(end).marginInlineEnd) || 0; }
      if (Math.abs(away - expected[place[1]]) > TOLERANCE_PX || Math.abs(side - expected.right) > TOLERANCE_PX) report("a corner control not in its corner", control, round(away) + "px from the " + place[1] + " and " + round(side) + "px from the end, expected " + round(expected[place[1]]) + "px and " + round(expected.right) + "px");
      // Where the pane's corner cut reaches it: a dropped head's Close, at the words margin, is past it and square.
      var cut = (control.cutCorners || [])[place[2]] || 0, paneCut = (window.zaismaCorners ? window.zaismaCorners(pane, "pane") : [1, 1, 1, 1])[place[2]];
      if (cutReaching(paneCut, away + side, parseFloat(css.paddingRight)) > 0.5 && cut < LEAST_BEVEL_PX - 0.01) report("a corner control without its corner's bevel", control, "its bevel is " + round(cut) + "px, at least " + LEAST_BEVEL_PX + "px");
    });
  });
  document.querySelectorAll(BESIDE_CONTROLS).forEach(function (row) {
    if (!isShown(row)) return;
    var control = Array.prototype.find.call(row.querySelectorAll(":scope > .row-cell.is-control [data-cut-line], :scope > :is(.pane-head-end, .pane-foot-end) [data-cut-line]"), isShown);
    if (!control) return;
    var c = control.getBoundingClientRect(), isLast = row.classList.contains("is-on-field-boxes") || row.classList.contains("pane-foot") || getComputedStyle(row).alignItems === "flex-end";
    Array.prototype.forEach.call(row.querySelectorAll(":scope > .row-cell.is-words, :scope > .pane-head-words, :scope > .pane-foot-start.is-words"), function (cell) {
      // A head's words are laid out in its own grid: its heading is what sits beside the control.
      if (cell.matches(".pane-head-words")) cell = cell.firstElementChild;
      var line = cell && isShown(cell) && lineOf(cell, isLast);
      if (!line || Math.min(line.bottom, c.bottom) - Math.max(line.top, c.top) <= 0) return;
      var offPx = (line.top + line.bottom) / 2 - (c.top + c.bottom) / 2;
      if (Math.abs(offPx) > TOLERANCE_PX) report("words beside a control off its center line", cell, "their " + (isLast ? "last" : "first") + " line's center is " + round(offPx) + "px off " + describe(control) + "'s");
    });
  });
  // An equal row's cells are one width; a control alone on a row's line (the row didn't fit on one) fills it, as in a stack.
  document.querySelectorAll(".layout-row").forEach(function (row) {
    if (!isShown(row)) return;
    var cells = Array.prototype.filter.call(row.children, isShown), rowBox = row.getBoundingClientRect();
    var onLine = function (cell) { var a = cell.getBoundingClientRect(); return cells.filter(function (other) { var b = other.getBoundingClientRect(); return Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0; }); };
    cells.forEach(function (cell) {
      var line = onLine(cell), a = cell.getBoundingClientRect();
      if (row.classList.contains("widths-equal") && cell.classList.contains("fills")) line.forEach(function (other) {
        var b = other.getBoundingClientRect();
        if (other !== cell && other.classList.contains("fills") && a.left < b.left && Math.abs(a.width - b.width) > 1) report("an equal row's cells of different widths", cell, round(a.width) + "px beside " + describe(other) + " at " + round(b.width) + "px");
      });
      var reachPx = Math.max(0, -parseFloat(getComputedStyle(cell).marginInlineEnd) || 0);
      if (cells.length > 1 && line.length === 1 && cell.classList.contains("is-control") && a.width + reachPx < rowBox.width - TOLERANCE_PX) report("a control alone on a row's line, short of its end", cell, round(a.width) + "px on a line " + round(rowBox.width) + "px wide");
    });
  });
  // Words are never cut off. (Capitals, orange words and a token's name are scanned on the rendered page: test/site/design.test.ts.)
  var wordsWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), wordsNode, seen = new Set();
  while ((wordsNode = wordsWalker.nextNode())) {
    var holder = wordsNode.parentElement;
    if (!wordsNode.textContent.trim() || !holder || seen.has(holder) || holder.closest(SKIPPED + ", input, textarea, code, kbd, pre, .code") || !isShown(holder)) continue;
    seen.add(holder);
    var holderCss = getComputedStyle(holder);
    if (/^(hidden|clip)$/.test(holderCss.overflowX) && holderCss.textOverflow !== "ellipsis" && holder.clientWidth > 1 && holder.scrollWidth > holder.clientWidth + 1) report("words cut off", holder, round(holder.scrollWidth) + "px of words in " + round(holder.clientWidth) + "px");
  }
  // The page's runner (its one main action, never the header's Sign in) shows without scrolling. (One runner a state: scanned, design.test.ts.)
  var runners = Array.prototype.filter.call(document.querySelectorAll(".run-wrap"), function (each) { return isShown(each) && !each.closest("[data-on-no-pane] , .example-stage"); });
  var pageRunner = runners.find(function (each) { return !each.closest("header.top"); });
  if (options.isMainActionChecked && pageRunner && pageRunner.getBoundingClientRect().bottom > innerHeight + 0.5) report("the runner below the fold", pageRunner, "its foot at " + round(pageRunner.getBoundingClientRect().bottom + scrollY) + "px, the window " + innerHeight + "px tall");
  // The page's first cover shows whole without scrolling, where the page is for finding a game (the home).
  if (options.isCoverAboveFold) {
    var cover = Array.prototype.find.call(document.querySelectorAll("main .cover"), isShown);
    if (cover && cover.getBoundingClientRect().bottom > innerHeight + 0.5) report("the first cover below the fold", cover, "its foot at " + round(cover.getBoundingClientRect().bottom + scrollY) + "px, the window " + innerHeight + "px tall");
  }
  // On a touch screen, everything you press has a hit area at least 44px tall (its box, and any hit area its ::before or ::after adds), apart
  // from links inside a line of words.
  if (options.isTouch && isMeasured("a touch target under 44px")) document.querySelectorAll("a[href], button, [role='button'], [role='tab'], input:not([type='hidden']), select, textarea, summary").forEach(function (el) {
    if (!isShown(el) || el.closest(SKIPPED) || getComputedStyle(el).display === "inline" || Number(getComputedStyle(el).opacity) < 0.01) return;
    if (el.matches("input, textarea") && el.closest("label, .field, .find, .check, .toggle, .slider")) return;
    var r = el.getBoundingClientRect(), extendPx = 0;
    ["::before", "::after"].forEach(function (pseudo) {
      var css = getComputedStyle(el, pseudo);
      if (css.content === "none" || css.position !== "absolute") return;
      extendPx = Math.max(extendPx, Math.max(0, -parseFloat(css.top) || 0) + Math.max(0, -parseFloat(css.bottom) || 0) + Math.max(0, (parseFloat(css.height) || 0) - r.height));
    });
    if (r.height + extendPx < 44 - 0.5) report("a touch target under 44px", el, round(r.height + extendPx) + "px tall");
  });
  // A box that scrolls up and down scrolls by more than a few pixels: one that scrolls by a sliver (a row of covers made a little taller by
  // what lifts in it) only bounces under a finger.
  // Only what the page's styles let scroll can (the materials' .scrolls, and the few a component names in test/node/materials.test.ts):
  // the rules that say so, found in its stylesheets, what sets it in its own style, and a text box.
  if (isMeasured("a box that scrolls up and down by a sliver")) (function () {
    var boxes = new Set(), selectors = ["textarea", "select", "[style*='overflow']"];
    (function walk(rules) {
      Array.prototype.forEach.call(rules, function (rule) { if (rule.cssRules) walk(rule.cssRules); if (rule.selectorText && rule.style && /auto|scroll/.test(rule.style.overflowY)) selectors.push(rule.selectorText); });
    })(Array.prototype.flatMap.call(document.styleSheets, function (sheet) { try { return Array.prototype.slice.call(sheet.cssRules); } catch (error) { return []; } }));
    selectors.forEach(function (selector) { try { document.body.querySelectorAll(selector).forEach(function (box) { boxes.add(box); }); } catch (error) { /* a selector only a stylesheet takes (a scrollbar's) */ } });
    return Array.from(boxes);
  })().forEach(function (box) {
    var extraPx = box.scrollHeight - box.clientHeight;
    if (extraPx > 1 && extraPx < ${LEAST_SCROLL_PX} && /^(auto|scroll)$/.test(getComputedStyle(box).overflowY) && isShown(box)) report("a box that scrolls up and down by a sliver", box, round(extraPx) + "px to scroll");
  });
  // Nothing empty takes a place in a stack: a thing with no height still gets a gap on each side.
  document.querySelectorAll(".pane-in, .sheet-in, .tray, form, .layout-stack, .pane-stack, .stack-cell").forEach(function (holder) {
    var css = getComputedStyle(holder);
    if (!isShown(holder) || !/flex|grid/.test(css.display) || !(parseFloat(css.rowGap) > 0) || (css.display.indexOf("flex") >= 0 && css.flexDirection.indexOf("column") < 0)) return;
    Array.prototype.forEach.call(holder.children, function (child) {
      var childCss = getComputedStyle(child);
      // What has no box of its own (display: contents) is no thing in the stack: its children are.
      if (childCss.display === "none" || childCss.display === "contents" || /absolute|fixed/.test(childCss.position) || child.matches("script, style, template, .edge, .rail")) return;
      // One that gives back the gaps round it (a bot check until it's needed) takes no room.
      var givenBackPx = -(parseFloat(childCss.marginTop) + parseFloat(childCss.marginBottom));
      if (child.getBoundingClientRect().height < 0.5 && givenBackPx < parseFloat(css.rowGap) - 0.5) report("an empty thing taking a gap", child, "0px tall in a stack whose gap is " + css.rowGap);
    });
  });
  // Two controls side by side are a row (Row, layout.ts), so they slant toward each other and share one height.
  var CONTROL_ROOTS = ".run-wrap, .cut-btn, .cut-field > .field, .field.select, .find, .wheel-button";
  var controlRoots = Array.prototype.filter.call(document.querySelectorAll(CONTROL_ROOTS), function (el) { return isShown(el) && !el.parentElement.closest(CONTROL_ROOTS + ", .tab-switch, .steps, .dropdown, header.top"); });
  // Only two in one pane: the gallery's stage lays its examples side by side itself.
  var paneOf = function (el) { return el.closest("[data-glass]:not([data-cut-line]), .example-stage"); };
  for (var a = 0; a < controlRoots.length; a++) for (var b = a + 1; b < controlRoots.length; b++) {
    var first = controlRoots[a], second = controlRoots[b];
    if (paneOf(first) !== paneOf(second) || !paneOf(first) || paneOf(first).matches(".example-stage")) continue;
    if (first.closest(".layout-row") && first.closest(".layout-row") === second.closest(".layout-row")) continue;
    var ra = first.getBoundingClientRect(), rb = second.getBoundingClientRect(), down = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    var apart = Math.max(rb.left - ra.right, ra.left - rb.right);
    // Two that already slant toward each other (a legacy control row, the edge rule's neighbor distance) are a row.
    var isSlanting = Math.abs(apart + slantOverlapPx) <= TOLERANCE_PX;
    if (down > Math.min(ra.height, rb.height) / 2 && apart >= -slantOverlapPx - TOLERANCE_PX && apart < 24 && !isSlanting) report("two controls side by side outside a row", second, round(apart) + "px from " + describe(first));
  }
  // The page's own panes, the header and the footer share one left and right edge: a pane a few pixels out of line with them is off.
  var header = document.querySelector("header.top");
  var pageShape = document.documentElement.getAttribute("data-page-shape");
  if (header && isShown(header)) {
    var h = header.getBoundingClientRect();
    Array.prototype.forEach.call(document.querySelectorAll(".glass-pane, .foot"), function (el) {
      if (!isShown(el) || (el.parentElement && el.parentElement.closest("[data-glass], [data-on-no-pane], .example-stage"))) return;
      // A reading page's column is centered under the header instead (below); its panes line up with the column.
      if (pageShape === "reading" && !el.matches(".foot")) return;
      var r = el.getBoundingClientRect();
      [["left", r.left - h.left], ["right", r.right - h.right]].forEach(function (pair) {
        if (Math.abs(pair[1]) > TOLERANCE_PX && Math.abs(pair[1]) < 16) report("out of line with the header", el, "its " + pair[0] + " edge " + round(pair[1]) + "px off the header's");
      });
    });
  }

  // ---- Page shapes (docs/DESIGN.md, Page shapes): nothing on a page runs wider than its shape lets it (a rebuilt page without one doesn't compile). ----
  var padPanePx = parseFloat(root.getPropertyValue("--pad-pane")) || 24;
  if (pageShape) {
    var screenWidthPx = document.documentElement.clientWidth;
    var wideWidthPx = Math.min(lengthPx("var(--size-page-wide)"), screenWidthPx - 2 * padPanePx), readingWidthPx = Math.min(lengthPx("var(--size-page-reading)"), screenWidthPx - 2 * padPanePx);
    var frameOf = function (widthPx) { return { left: (screenWidthPx - widthPx) / 2, right: (screenWidthPx + widthPx) / 2, widthPx: widthPx }; };
    var sidePlaces = document.querySelector("main .sidebar-main");
    // The shape's box: the wide frame, or a reading page's column (the body beside its places, where it has them).
    var column = pageShape === "reading" ? (sidePlaces && isShown(sidePlaces) ? { left: sidePlaces.getBoundingClientRect().left, right: sidePlaces.getBoundingClientRect().left + readingWidthPx, widthPx: readingWidthPx } : frameOf(readingWidthPx)) : frameOf(wideWidthPx);
    var wide = frameOf(wideWidthPx);
    Array.prototype.forEach.call(document.querySelectorAll("main .glass-pane, main .table, main .layout-grid, main .tray"), function (el) {
      if (!isShown(el) || isOnFixed(el) || el.closest(EXAMPLE + ", " + OVER_PAGE) || scrollerIn(el, document.body)) return;
      var r = el.getBoundingClientRect(), box = el.closest(".sidebar") ? wide : column;
      if (r.left < box.left - TOLERANCE_PX || r.right > box.right + TOLERANCE_PX) report("wider than its page's shape", el, round(r.width) + "px from " + round(r.left) + "px, the " + pageShape + " shape runs " + round(box.widthPx) + "px from " + round(box.left) + "px");
    });
    // A reading page's column sits in the middle, under the header's.
    if (pageShape === "reading" && header && isShown(header)) {
      var held = sidePlaces && isShown(sidePlaces) ? document.querySelector("main .sidebar-layout-in") : document.querySelector("body > main");
      if (held && isShown(held)) {
        var hr = header.getBoundingClientRect(), cr = held.getBoundingClientRect(), offPx = (cr.left + cr.right) / 2 - (hr.left + hr.right) / 2;
        if (Math.abs(offPx) > TOLERANCE_PX && cr.width < hr.width - TOLERANCE_PX) report("a reading column off the middle", held, "its middle " + round(offPx) + "px off the header's");
      }
    }
  }
  // A line of words runs at most 75 characters of its font (a "0" in it): --size-reading is 60ch, and 75 leaves room for a wide pane's short lines.
  var LONGEST_LINE_CHARACTER_COUNT = 75;
  // 75ch in the words' own font, as the browser works ch out: a probe inside the element takes its width.
  Array.prototype.forEach.call(document.querySelectorAll("main p, main li, dialog p"), function (el) {
    if (!isShown(el) || el.closest(SKIPPED + ", pre, code, table, .list-rows, .dropdown, .tab-switch, .steps, .step-line, nav") || el.querySelector("p, li")) return;
    // One line that's cut off at its end (a note in a row, ending in an ellipsis) isn't read as a line of a paragraph.
    if (/^(nowrap|pre)$/.test(getComputedStyle(el).whiteSpace) || getComputedStyle(el).textOverflow === "ellipsis") return;
    var range = document.createRange(); range.selectNodeContents(el);
    var longestPx = Array.prototype.reduce.call(range.getClientRects(), function (most, glyphs) { return Math.max(most, glyphs.width); }, 0), mostPx = lengthPx(LONGEST_LINE_CHARACTER_COUNT + "ch", el);
    // Half a character's room for a glyph that reaches past its advance at a line's end.
    if (longestPx > mostPx + Math.max(TOLERANCE_PX, mostPx / LONGEST_LINE_CHARACTER_COUNT / 2)) report("a line of words longer than the reading width", el, "a line " + round(longestPx) + "px long, at most " + round(mostPx) + "px (" + LONGEST_LINE_CHARACTER_COUNT + " characters)");
  });

  measurePanes();

  // ---- The Laws of UX a check can measure (lawsofux.com; docs/DESIGN.md, Laws of UX). Gallery examples are pieces shown alone: skipped.
  // Connectedness, hierarchy, choice counts and chunking are scanned on the rendered page instead (test/site/design.test.ts). ----
  var isOwn = function (el) { return isShown(el) && !el.closest(EXAMPLE + ", " + SKIPPED); };
  var surfaceOf = function (el) { return el.closest("[data-glass]:not([data-cut-line])"); };
  // Proximity: a heading is nearer what it names (what follows it) than the block before it.
  Array.prototype.forEach.call(document.querySelectorAll("h2, h3, h4"), function (heading) {
    if (!isOwn(heading)) return;
    // A heading that's a cell of a stack, beside the cells it sits between (one inside a pane's head or a component places itself).
    var cell = heading.parentElement;
    if (!cell || !cell.matches(".stack-cell") || cell.children.length !== 1) return;
    var before = cell.previousElementSibling, after = cell.nextElementSibling;
    while (before && !isShown(before)) before = before.previousElementSibling;
    while (after && !isShown(after)) after = after.nextElementSibling;
    if (!before || !after) return;
    var h = heading.getBoundingClientRect(), aboveGapPx = h.top - before.getBoundingClientRect().bottom, belowGapPx = after.getBoundingClientRect().top - h.bottom;
    if (aboveGapPx + TOLERANCE_PX < belowGapPx) report("words nearer the block before than their own", heading, round(aboveGapPx) + "px under what's before it, " + round(belowGapPx) + "px over what it names");
  });
  // Common region: a heading's group is on its own surface: a heading with nothing after it on its surface has left its group on another.
  Array.prototype.forEach.call(document.querySelectorAll("h2, h3"), function (heading) {
    var surface = surfaceOf(heading);
    if (!isOwn(heading) || !surface || heading.closest(".pane-head, .dropdown-head, .sheet, .playing-card")) return;
    var walker = document.createTreeWalker(surface, NodeFilter.SHOW_ELEMENT), el, isAfter = false, hasMore = false;
    while ((el = walker.nextNode())) { if (el === heading) { isAfter = true; continue; } if (isAfter && !heading.contains(el) && isShown(el) && !el.matches(SKIPPED) && el.getBoundingClientRect().height > 0 && (el.textContent.trim() || el.matches("input, button, a, img, canvas, svg"))) { hasMore = true; break; } }
    if (!hasMore) report("one group on two surfaces", heading, "it's the last thing on " + describe(surface) + ": what it names is on another surface");
  });
  // Similarity: the cells of one grid or track are one kind at one width.
  Array.prototype.forEach.call(document.querySelectorAll(".layout-grid, .layout-track"), function (list) {
    if (!isOwn(list)) return;
    var cells = Array.prototype.filter.call(list.children, isShown);
    var kindOf = function (cell) { var inner = cell.matches(".grid-cell") ? cell.firstElementChild : cell; return inner ? (inner.className.split(" ")[0] || inner.tagName) : ""; };
    for (var i = 1; i < cells.length; i++) {
      var a = cells[0].getBoundingClientRect(), b = cells[i].getBoundingClientRect();
      if (Math.abs(a.width - b.width) > 1 || kindOf(cells[0]) !== kindOf(cells[i])) { report("one kind at different sizes", cells[i], round(b.width) + "px " + kindOf(cells[i]) + " beside " + round(a.width) + "px " + kindOf(cells[0])); break; }
    }
  });
  // Two panes side by side or one over the other keep a block's gap between them (a layout component puts it there): never touching, never
  // overlapping. Panes over the page (a sheet, a menu) and a pane inside another are left out.
  var blockGapPx = lengthPx("var(--gap-block-block)");
  var pagePanes = Array.prototype.filter.call(document.querySelectorAll(".glass-pane, .tray, .foot, header.top"), function (pane) { return isShown(pane) && !isOnFixed(pane) && !pane.closest(EXAMPLE + ", " + OVER_PAGE) && !(pane.parentElement && pane.parentElement.closest(".glass-pane, .tray")); });
  for (var p1 = 0; p1 < pagePanes.length; p1++) for (var p2 = p1 + 1; p2 < pagePanes.length; p2++) {
    var one = pagePanes[p1].getBoundingClientRect(), two = pagePanes[p2].getBoundingClientRect();
    var acrossPx = Math.min(one.right, two.right) - Math.max(one.left, two.left), downPx = Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top);
    // Beside each other in one direction, the space between them in the other.
    var apartPx = acrossPx > TOLERANCE_PX ? -downPx : downPx > TOLERANCE_PX ? -acrossPx : Infinity;
    if (apartPx < -TOLERANCE_PX) report("two panes overlapping", pagePanes[p2], "over " + describe(pagePanes[p1]) + " by " + round(-apartPx) + "px");
    else if (apartPx < blockGapPx - TOLERANCE_PX) report("two panes closer than a block's gap", pagePanes[p2], (apartPx < 0 ? "over " : round(apartPx) + "px from ") + describe(pagePanes[p1]) + ", a block's gap is " + round(blockGapPx) + "px");
  }
  var pageWidthPx = document.scrollingElement.scrollWidth;
  if (pageWidthPx > innerWidth + 1) report("the page scrolls sideways", document.body, pageWidthPx + "px wide in a " + innerWidth + "px window");
  return failures;
}`;

/**
 * The loading check, run in a page in two steps (scripts/layout-check.mjs): FIRST_PAINT_SNAPSHOT_SOURCE as the page first paints with only
 * its first-paint script run (the rest held back, and its pictures never loaded), then, once the page has loaded and settled,
 * (FIRST_PAINT_COMPARE_SOURCE)({ tiers }): what moved more than a pixel or changed its words since, and, at the first paint, any picture
 * shown without its placeholder. Each failure names the outermost thing that moved, not everything inside it.
 */
// What's behind the glass (a backdrop, the city) is a scene, not the page: it settles behind it as it likes.
const FIRST_PAINT_SKIPPED = "script, style, template, svg, svg *, .sr, .rail, .rail *, .edge, .cut-line, .backdrop, .city-stage, .city-stage *, dialog:not([open]), dialog:not([open]) *, [hidden], [hidden] *";
export const FIRST_PAINT_SNAPSHOT_SOURCE = String.raw`(function () {
  var shown = [], scrollX = window.scrollX, scrollY = window.scrollY;
  document.body.querySelectorAll("*").forEach(function (el) {
    if (el.matches(${JSON.stringify(FIRST_PAINT_SKIPPED)})) return;
    var r = el.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) return;
    var words = Array.prototype.filter.call(el.childNodes, function (node) { return node.nodeType === 3; }).map(function (node) { return node.textContent; }).join("").replace(/\s+/g, " ").trim();
    shown.push({ el: el, left: r.left + scrollX, top: r.top + scrollY, width: r.width, height: r.height, words: words });
  });
  // Pictures: each img in a Picture's box with its placeholder, or a backdrop with its placeholder layer under it. A QR code and the icon
  // drawn in it are a drawn code, not a picture, and a file being chosen is the player's own.
  var bare = Array.prototype.filter.call(document.body.querySelectorAll("img"), function (img) {
    if (img.matches(".qr-picture, .qr-icon, .file-drop-view") || img.closest("[hidden], dialog:not([open])")) return false;
    var box = img.parentElement;
    if (box && box.classList.contains("picture") && /--placeholder\s*:/.test(box.getAttribute("style") || "")) return false;
    if (img.matches(".backdrop") && img.previousElementSibling && img.previousElementSibling.matches(".backdrop-placeholder")) return false;
    return img.getBoundingClientRect().width >= 1;
  });
  window.__zaismaFirstPaint = { shown: shown, bare: bare };
  return shown.length;
})()`;
export const FIRST_PAINT_COMPARE_SOURCE = String.raw`function compareFirstPaint(options) {
  var TIERS = ${JSON.stringify(LAYOUT_RULE_TIERS)};
  var tiers = options.tiers || ${JSON.stringify(LAYOUT_TIERS)};
  function isMeasured(check) { return !TIERS[check] || tiers.indexOf(TIERS[check]) >= 0; }
  var first = window.__zaismaFirstPaint, failures = [], moved = [], MOST_FAILURES = 8;
  if (!first) return [{ check: "moved after the first paint", element: "", said: "the check didn't see the page's first paint" }];
  function describe(el) {
    var classes = (el.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(0, 2).join(".");
    var words = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 30);
    return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (classes ? "." + classes : "") + (words ? " " + JSON.stringify(words) : "");
  }
  var px = function (n) { return Math.round(n) + "px"; };
  // What changed size is named where the change starts: the innermost that grew or shrank (its holders only follow it). What only moved
  // is named where the move starts: the outermost (what's inside moves with it).
  var changes = [];
  first.shown.forEach(function (was) {
    var el = was.el;
    if (!el.isConnected) return;
    var r = el.getBoundingClientRect(), now = { left: r.left + window.scrollX, top: r.top + window.scrollY, width: r.width, height: r.height };
    var off = ["left", "top", "width", "height"].filter(function (side) { return Math.abs(now[side] - was[side]) > 1; });
    if (off.length) changes.push({ el: el, was: was, now: now, off: off, isResized: off.indexOf("width") >= 0 || off.indexOf("height") >= 0 });
    var words = Array.prototype.filter.call(el.childNodes, function (node) { return node.nodeType === 3; }).map(function (node) { return node.textContent; }).join("").replace(/\s+/g, " ").trim();
    if (words !== was.words && isMeasured("words changed after the first paint") && failures.length < MOST_FAILURES) {
      failures.push({ check: "words changed after the first paint", element: describe(el), said: JSON.stringify(was.words.slice(0, 60)) + " then " + JSON.stringify(words.slice(0, 60)) });
    }
  });
  var resized = changes.filter(function (change) { return change.isResized; });
  changes.forEach(function (change) {
    if (!isMeasured("moved after the first paint") || failures.length >= MOST_FAILURES) return;
    var isNamed = change.isResized
      ? !resized.some(function (other) { return other !== change && change.el.contains(other.el); })
      : !changes.some(function (other) { return other !== change && other.el.contains(change.el); });
    if (!isNamed) return;
    moved.push(change.el);
    failures.push({ check: "moved after the first paint", element: describe(change.el), said: change.off.map(function (side) { return side + " " + px(change.was[side]) + " then " + px(change.now[side]); }).join(", ") });
  });
  // What wasn't there at the first paint and now takes room in the page's flow pushes what's after it: the outermost of it is named.
  var wasShown = new Set(first.shown.map(function (was) { return was.el; })), appeared = new Set();
  if (isMeasured("moved after the first paint")) document.body.querySelectorAll("*").forEach(function (el) {
    if (failures.length >= MOST_FAILURES || wasShown.has(el) || !el.parentElement || Array.from(appeared).some(function (outer) { return outer.contains(el); }) || el.closest("svg, .rail, .edge") || el.matches(${JSON.stringify(FIRST_PAINT_SKIPPED)})) return;
    var r = el.getBoundingClientRect(), position = getComputedStyle(el).position;
    if (r.width < 1 || r.height < 1) return;
    appeared.add(el);
    if (position === "absolute" || position === "fixed") return;
    failures.push({ check: "moved after the first paint", element: describe(el), said: "it appeared after the first paint, " + px(r.width) + " by " + px(r.height) + ", in the page's flow" });
  });
  if (isMeasured("a picture without its placeholder")) first.bare.slice(0, MOST_FAILURES).forEach(function (img) {
    failures.push({ check: "a picture without its placeholder", element: describe(img) + " " + (img.getAttribute("src") || "").slice(0, 60), said: "an img outside a Picture's box (foundations.ts, picture), so its place is empty until it loads" });
  });
  return failures;
}`;
