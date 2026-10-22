/**
 * The measuring check (docs/DESIGN.md, Layout), run in a page: what's out of line on it, as failures, each { check, element, said }.
 * scripts/layout-check.mjs runs it on every page in Chrome, and the layout playground on what's built in it, live. It's a function's
 * source, since it runs in the browser: (MEASURE_LAYOUT_SOURCE)({ isMainActionChecked }). Things with an edge of their own are framed:
 * cut by the edge rule (data-cut-line), glass of their own (data-glass), a cover, or a list's rows.
 */
export const MEASURE_LAYOUT_SOURCE = String.raw`function measurePage(options) {
  var TOLERANCE_PX = 1.5, LEAST_BEVEL_PX = 4;
  var failures = [];
  var root = getComputedStyle(document.documentElement);
  var slantOverlapPx = Math.abs(parseFloat(root.getPropertyValue("--control-slant")) - parseFloat(root.getPropertyValue("--gap-control-row"))) || 6;
  var FRAMED = "[data-cut-line], [data-glass], .cover, .list-rows";
  // Pieces made to lie over each other: a row of pictures, each over the next.
  var OVERLAPPING = ".picture-row";
  var SKIPPED = "script, style, template, .sr, [aria-hidden='true'], .loader, .rail, .edge, .cut-line";
  var COMPONENTS = ["run-wrap", "cut-btn", "glass-btn", "guest-btn", "text-btn", "cut-field", "field", "find", "tab-switch", "switch-frame", "steps", "cover", "banner", "glass-pane", "tray", "tray-head", "sheet", "dropdown", "notice", "table", "list-rows", "choice-card", "toggle", "check", "top", "foot", "layout-row", "layout-stack", "layout-grid", "layout-track", "pane-head", "pane-foot"];
  function isShown(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    var css = getComputedStyle(el);
    return css.visibility !== "hidden" && Number(css.opacity) > 0.01 && !el.closest("[hidden], dialog:not([open])");
  }
  function describe(el) {
    var named = el.closest("[class]"), component = "", walk = el;
    while (walk && !component) { component = COMPONENTS.find(function (name) { return walk.classList && walk.classList.contains(name); }) || ""; walk = walk.parentElement; }
    var label = (el.getAttribute("aria-label") || el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 48);
    return (component || (named ? named.className.split(" ")[0] : el.tagName.toLowerCase())) + (label ? ' "' + label + '"' : "");
  }
  function report(check, el, said) { failures.push({ check: check, element: describe(el), said: said }); }
  var round = function (n) { return Math.round(n * 10) / 10; };
  // The box that scrolls sideways round an element, up to the pane (a track of covers): only what shows in it is measured.
  function scrollerIn(el, pane) {
    for (var walk = el.parentElement; walk && walk !== pane; walk = walk.parentElement) { var x = getComputedStyle(walk).overflowX; if (x === "auto" || x === "scroll" || x === "hidden") return walk; }
    return null;
  }
  function isScrolledAway(el, pane) {
    var scroller = scrollerIn(el, pane); if (!scroller) return false;
    var r = el.getBoundingClientRect(), s = scroller.getBoundingClientRect();
    return r.left < s.left - TOLERANCE_PX || r.right > s.right + TOLERANCE_PX;
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
  var panes = Array.prototype.filter.call(document.querySelectorAll("[data-glass]:not([data-cut-line])"), function (pane) { return isShown(pane) && !pane.classList.contains("frame"); });
  panes.forEach(function (pane) {
    var holder = pane.querySelector(":scope > .pane-in, :scope > .sheet-in") || pane, css = getComputedStyle(holder), p = pane.getBoundingClientRect();
    var gap = { left: parseFloat(css.paddingLeft), right: parseFloat(css.paddingRight), top: parseFloat(css.paddingTop), bottom: parseFloat(css.paddingBottom) };
    var words = parseFloat(css.getPropertyValue("--pad-words")) || 0;
    // A pane that scrolls inside itself: its top and bottom are its content's, wherever it's scrolled to.
    var isScrolling = holder.scrollHeight > holder.clientHeight + 1, contentTop = holder.getBoundingClientRect().top - holder.scrollTop;
    var box = { left: p.left, right: p.right, top: isScrolling ? contentTop : p.top, bottom: isScrolling ? contentTop + holder.scrollHeight : p.bottom };
    var distances = function (r) { return { left: r.left - box.left, right: box.right - r.right, top: r.top - box.top, bottom: box.bottom - r.bottom }; };
    var framed = Array.prototype.filter.call(pane.querySelectorAll(FRAMED), function (el) { return el !== pane && !framedIn(el, pane) && isShown(el); });
    var paneCuts = window.zaismaCorners ? window.zaismaCorners(pane, "pane") : [1, 1, 1, 1];
    framed.forEach(function (el) {
      if (isScrolledAway(el, pane)) return;
      var r = el.getBoundingClientRect(), d = distances(r);
      ["left", "right", "top", "bottom"].forEach(function (side) {
        if (d[side] < gap[side] - TOLERANCE_PX) {
          if (d[side] < -TOLERANCE_PX && (side === "left" || side === "right" || !isScrolling)) report("spills out of its pane", el, side + " edge " + round(-d[side]) + "px past the pane's");
          else report("closer to the pane's edge than the frame gap", el, round(d[side]) + "px from the " + side + " edge, expected " + round(gap[side]) + "px");
        } else if (d[side] > gap[side] + TOLERANCE_PX && d[side] < gap[side] + words - TOLERANCE_PX) {
          report("off the frame gap", el, round(d[side]) + "px from the " + side + " edge, expected the frame gap " + round(gap[side]) + "px");
        }
      });
      // In a corner of the pane (at the frame gap from both its sides), it keeps a bevel there.
      var atGap = function (side) { return Math.abs(d[side] - gap[side]) <= TOLERANCE_PX; };
      [["top", "left"], ["top", "right"], ["bottom", "right"], ["bottom", "left"]].forEach(function (corner, i) {
        var cut = (el.cutCorners || [])[i];
        if (cut !== undefined && paneCuts[i] > 0 && atGap(corner[0]) && atGap(corner[1]) && cut < LEAST_BEVEL_PX - 0.01) report("bevel under 4px", el, "in the pane's " + corner.join(" ") + " corner its bevel is " + round(cut) + "px");
      });
    });
    // Two things with an edge overlap only as far as two controls side by side do, slanting toward each other.
    for (var i = 0; i < framed.length; i++) for (var j = i + 1; j < framed.length; j++) {
      if (framed[i].closest(OVERLAPPING) && framed[i].closest(OVERLAPPING) === framed[j].closest(OVERLAPPING)) continue;
      if (isScrolledAway(framed[i], pane) || isScrolledAway(framed[j], pane)) continue;
      var a = framed[i].getBoundingClientRect(), b = framed[j].getBoundingClientRect();
      var across = Math.min(a.right, b.right) - Math.max(a.left, b.left), down = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (across > slantOverlapPx + TOLERANCE_PX && down > TOLERANCE_PX) report("overlaps another thing", framed[i], "overlaps " + describe(framed[j]) + " by " + round(across) + " x " + round(down) + "px");
    }
    // Words: every line of the pane's own words keeps its margin, and lies over nothing with an edge.
    var walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT), text, flagged = new Set();
    while ((text = walker.nextNode())) {
      var el = text.parentElement;
      if (!text.textContent.trim() || !el || el.closest(SKIPPED) || framedIn(el, pane) || !isShown(el) || flagged.has(el)) continue;
      var range = document.createRange(); range.selectNodeContents(text);
      if (isScrolledAway(el, pane)) continue;
      Array.prototype.some.call(range.getClientRects(), function (glyphs) {
        if (glyphs.width < 1 || glyphs.height < 1) return false;
        var r = lineBox(glyphs, el), scroller = scrollerIn(el, pane);
        // Words running on past what scrolls sideways round them are measured where they show.
        if (scroller) { var s = scroller.getBoundingClientRect(); if (r.left < s.left - TOLERANCE_PX || r.right > s.right + TOLERANCE_PX) return false; }
        var d = distances(r), wordsAt = { left: gap.left + words, right: gap.right + words, top: gap.top + words, bottom: gap.bottom + words };
        var side = ["left", "right", "top", "bottom"].find(function (each) { return d[each] < wordsAt[each] - TOLERANCE_PX; });
        if (side) { flagged.add(el); report("words closer to the pane's edge than its margin", el, round(d[side]) + "px from the " + side + " edge, expected " + round(wordsAt[side]) + "px"); return true; }
        var under = framed.find(function (f) { var o = f.getBoundingClientRect(); return Math.min(r.right, o.right) - Math.max(r.left, o.left) > TOLERANCE_PX && Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top) > TOLERANCE_PX; });
        if (under) { flagged.add(el); report("words over something with an edge", el, "over " + describe(under)); return true; }
        return false;
      });
    }
  });
  // Rows: every control one height, on one line.
  document.querySelectorAll(".layout-row").forEach(function (row) {
    if (!isShown(row)) return;
    var boxes = Array.prototype.flatMap.call(row.querySelectorAll(":scope > .row-cell.is-control"), function (cell) {
      var control = [cell].concat(Array.prototype.slice.call(cell.querySelectorAll("[data-cut-line]"))).find(function (each) { return each.hasAttribute("data-cut-line") && isShown(each); });
      return control ? [control] : [];
    });
    boxes.forEach(function (control, i) {
      var a = control.getBoundingClientRect();
      boxes.slice(i + 1).forEach(function (other) {
        var b = other.getBoundingClientRect(), isSameLine = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0;
        if (!isSameLine) return;
        if (Math.abs(a.height - b.height) > 1) report("controls in one row of different heights", control, round(a.height) + "px beside " + describe(other) + " at " + round(b.height) + "px");
        else if (Math.abs(a.top - b.top) > 1) report("controls in one row not on one line", control, round(a.top - b.top) + "px off " + describe(other));
      });
    });
  });
  // A control in a pane's corner (Pane parts): in it, at the frame gap, with the corner's cut.
  [[".pane-head-end", "top", 1], [".pane-foot-end", "bottom", 2]].forEach(function (place) {
    document.querySelectorAll(place[0]).forEach(function (end) {
      var control = end.querySelector("[data-cut-line]"), pane = end.closest("[data-glass]:not([data-cut-line])");
      if (!control || !pane || !isShown(control)) return;
      var holder = pane.querySelector(":scope > .pane-in, :scope > .sheet-in") || pane, css = getComputedStyle(holder), r = control.getBoundingClientRect(), p = pane.getBoundingClientRect();
      var away = place[1] === "top" ? r.top - p.top : p.bottom - r.bottom, side = p.right - r.right;
      var expected = { top: parseFloat(css.paddingTop), bottom: parseFloat(css.paddingBottom), right: parseFloat(css.paddingRight) };
      if (Math.abs(away - expected[place[1]]) > TOLERANCE_PX || Math.abs(side - expected.right) > TOLERANCE_PX) report("a corner control not in its corner", control, round(away) + "px from the " + place[1] + " and " + round(side) + "px from the end, expected " + round(expected[place[1]]) + "px and " + round(expected.right) + "px");
      var cut = (control.cutCorners || [])[place[2]] || 0;
      if (cut < LEAST_BEVEL_PX - 0.01) report("a corner control without its corner's bevel", control, "its bevel is " + round(cut) + "px, at least " + LEAST_BEVEL_PX + "px");
    });
  });
  if (options.isMainActionChecked) {
    var runner = Array.prototype.find.call(document.querySelectorAll(".run-wrap"), isShown);
    if (runner && runner.getBoundingClientRect().bottom > innerHeight + 0.5) report("the runner below the fold", runner, "its foot at " + round(runner.getBoundingClientRect().bottom + scrollY) + "px, the window " + innerHeight + "px tall");
  }
  var pageWidthPx = document.scrollingElement.scrollWidth;
  if (pageWidthPx > innerWidth + 1) report("the page scrolls sideways", document.body, pageWidthPx + "px wide in a " + innerWidth + "px window");
  return failures;
}`;
