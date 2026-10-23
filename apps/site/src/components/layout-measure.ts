/**
 * The measuring check (docs/DESIGN.md, Layout), run in a page: what's out of line on it, as failures, each { check, element, said }.
 * scripts/layout-check.mjs runs it on every page in Chrome, and Screens (screens.ts) on each page it shows, live. It's a function's
 * source, since it runs in the browser: (MEASURE_LAYOUT_SOURCE)({ isMainActionChecked, isCoverAboveFold, isTouch }). Things with an edge of their own are framed:
 * cut by the edge rule (data-cut-line), glass of their own (data-glass), a cover, or a list's rows.
 */
export const MEASURE_LAYOUT_SOURCE = String.raw`function measurePage(options) {
  var TOLERANCE_PX = 1.5, LEAST_BEVEL_PX = 4;
  var failures = [];
  var root = getComputedStyle(document.documentElement);
  var slantOverlapPx = Math.abs(parseFloat(root.getPropertyValue("--control-slant")) - parseFloat(root.getPropertyValue("--gap-control-row"))) || 6;
  // A person is framed by their picture, and code in reading text by its well.
  var FRAMED = "[data-cut-line], [data-glass], .cover, .list-rows, .person, .reading pre";
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
  var INNER_WORDS = ".cut-field > .field, .field.select, .field.code, .field.long, .find, .bday-field, .choice-cards > .choice-card, .table, .list-rows";
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
      if (!text.textContent.trim() || !el || el.closest(SKIPPED) || el.matches(FRAMED) || framedIn(el, pane) || !isShown(el) || flagged.has(el)) continue;
      var range = document.createRange(); range.selectNodeContents(text);
      if (isScrolledAway(el, pane)) continue;
      Array.prototype.some.call(range.getClientRects(), function (glyphs) {
        if (glyphs.width < 1 || glyphs.height < 1) return false;
        var r = lineBox(glyphs, el), scroller = scrollerIn(el, pane);
        // Words running on past what scrolls sideways round them are measured where they show.
        if (scroller) { var s = scroller.getBoundingClientRect(); if (r.left < s.left - TOLERANCE_PX || r.right > s.right + TOLERANCE_PX) return false; }
        var d = distances(r), wordsAt = { left: gap.left + words, right: gap.right + words, top: gap.top + words, bottom: gap.bottom + words };
        // Words beside a control sit on its center line rather than at the margin above or below them (checked below), and words beside
        // anything else with an edge (a swatch, a box) line up with it the same way.
        var isBesideFramed = framed.some(function (f) { var o = f.getBoundingClientRect(); return (o.right <= r.left + TOLERANCE_PX || o.left >= r.right - TOLERANCE_PX) && Math.min(o.bottom, r.bottom) - Math.max(o.top, r.top) > TOLERANCE_PX; });
        var sides = el.closest(BESIDE_CONTROLS_WORDS) || isBesideFramed ? ["left", "right"] : ["left", "right", "top", "bottom"];
        var side = sides.find(function (each) { return d[each] < wordsAt[each] - TOLERANCE_PX; });
        if (side) { flagged.add(el); report("words closer to the pane's edge than its margin", el, round(d[side]) + "px from the " + side + " edge, expected " + round(wordsAt[side]) + "px"); return true; }
        var under = framed.find(function (f) { var o = f.getBoundingClientRect(); return Math.min(r.right, o.right) - Math.max(r.left, o.left) > TOLERANCE_PX && Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top) > TOLERANCE_PX; });
        if (under) { flagged.add(el); report("words over something with an edge", el, "over " + describe(under)); return true; }
        lines.push({ r: r, el: el });
        return false;
      });
    }
    // A line of words at the pane's start with nothing before it starts at the margin, never a little further in (words inset twice).
    var marks = framed.concat(Array.prototype.filter.call(pane.querySelectorAll("svg.ico, img, canvas, .loader"), isShown));
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
      // A text button in a corner is words: it keeps the pane's margin, which the words' check measures.
      if (!control || !pane || !isShown(control) || end.classList.contains("is-words")) return;
      var holder = pane.querySelector(":scope > .pane-in, :scope > .sheet-in") || pane, css = getComputedStyle(holder), r = control.getBoundingClientRect(), p = pane.getBoundingClientRect();
      var away = place[1] === "top" ? r.top - p.top : p.bottom - r.bottom, side = p.right - r.right;
      var expected = { top: parseFloat(css.paddingTop), bottom: parseFloat(css.paddingBottom), right: parseFloat(css.paddingRight) };
      if (Math.abs(away - expected[place[1]]) > TOLERANCE_PX || Math.abs(side - expected.right) > TOLERANCE_PX) report("a corner control not in its corner", control, round(away) + "px from the " + place[1] + " and " + round(side) + "px from the end, expected " + round(expected[place[1]]) + "px and " + round(expected.right) + "px");
      var cut = (control.cutCorners || [])[place[2]] || 0;
      if (cut < LEAST_BEVEL_PX - 0.01) report("a corner control without its corner's bevel", control, "its bevel is " + round(cut) + "px, at least " + LEAST_BEVEL_PX + "px");
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
  // Every control is its size class's height (--control-height: small, regular, field or big), never a number of its own.
  document.querySelectorAll(".run-wrap > .run, .cut-btn:not(.in-well) > .face, .glass-btn > .face, .guest-btn > .face, .danger, .cut-field > .field:not(.long, .code), .find, .bday-field").forEach(function (el) {
    if (!isShown(el)) return;
    var expectedPx = parseFloat(getComputedStyle(el).getPropertyValue("--control-height")), foundPx = el.getBoundingClientRect().height;
    if (expectedPx && Math.abs(foundPx - expectedPx) > 1) report("a control off its size class's height", el, round(foundPx) + "px tall, its size class " + round(expectedPx) + "px");
  });
  // Words: never in capitals for show (no ALL CAPS), never cut off, and never orange unless they're something you act on.
  var orange = ["--run", "--run-hi", "--run-lo"].map(function (name) { var probe = document.createElement("i"); probe.style.color = root.getPropertyValue(name).trim(); document.body.appendChild(probe); var color = getComputedStyle(probe).color; probe.remove(); return color; });
  var wordsWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), wordsNode, seen = new Set();
  while ((wordsNode = wordsWalker.nextNode())) {
    var holder = wordsNode.parentElement;
    if (!wordsNode.textContent.trim() || !holder || seen.has(holder) || holder.closest(SKIPPED + ", input, textarea, code, kbd, pre, .code") || !isShown(holder)) continue;
    seen.add(holder);
    var holderCss = getComputedStyle(holder);
    if (holderCss.textTransform === "uppercase" || /^(all-)?small-caps$/.test(holderCss.fontVariantCaps)) report("words in capitals", holder, "text-transform " + holderCss.textTransform + ", font-variant-caps " + holderCss.fontVariantCaps);
    else if (/\b[A-Z]{3,}\s+[A-Z]{3,}\b/.test(wordsNode.textContent)) report("words in capitals", holder, "\"" + wordsNode.textContent.trim().slice(0, 40) + "\"");
    if (/--[a-z]/.test(wordsNode.textContent)) report("a token's name outside code", holder, "Jost draws its two hyphens as one dash: set it in code");
    if (orange.indexOf(holderCss.color) >= 0 && !holder.closest("a, button, label, summary, [role='tab'], [role='button'], [tabindex]")) report("orange words on what you don't act on", holder, "its color is " + holderCss.color);
    if (/^(hidden|clip)$/.test(holderCss.overflowX) && holderCss.textOverflow !== "ellipsis" && holder.clientWidth > 1 && holder.scrollWidth > holder.clientWidth + 1) report("words cut off", holder, round(holder.scrollWidth) + "px of words in " + round(holder.clientWidth) + "px");
  }
  // The page's runner (its one main action, never the header's Sign in) shows without scrolling, and no two runners are ever in view at once.
  var runners = Array.prototype.filter.call(document.querySelectorAll(".run-wrap"), function (each) { return isShown(each) && !each.closest("[data-on-no-pane] , .example-stage"); });
  var pageRunner = runners.find(function (each) { return !each.closest("header.top"); });
  if (options.isMainActionChecked && pageRunner && pageRunner.getBoundingClientRect().bottom > innerHeight + 0.5) report("the runner below the fold", pageRunner, "its foot at " + round(pageRunner.getBoundingClientRect().bottom + scrollY) + "px, the window " + innerHeight + "px tall");
  var inView = runners.filter(function (each) { var r = each.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
  if (inView.length > 1) report("two runners in view", inView[1], "beside " + describe(inView[0]));
  // The page's first cover shows whole without scrolling, where the page is for finding a game (the home).
  if (options.isCoverAboveFold) {
    var cover = Array.prototype.find.call(document.querySelectorAll("main .cover"), isShown);
    if (cover && cover.getBoundingClientRect().bottom > innerHeight + 0.5) report("the first cover below the fold", cover, "its foot at " + round(cover.getBoundingClientRect().bottom + scrollY) + "px, the window " + innerHeight + "px tall");
  }
  // On a touch screen, everything you press has a hit area at least 44px tall (its box, and any hit area its ::before or ::after adds), apart
  // from links inside a line of words.
  if (options.isTouch) document.querySelectorAll("a[href], button, [role='button'], [role='tab'], input:not([type='hidden']), select, textarea, summary").forEach(function (el) {
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
  document.querySelectorAll("body *").forEach(function (box) {
    var css = getComputedStyle(box), extraPx = box.scrollHeight - box.clientHeight;
    if (/^(auto|scroll)$/.test(css.overflowY) && extraPx > 1 && extraPx < 12 && isShown(box)) report("a box that scrolls up and down by a sliver", box, round(extraPx) + "px to scroll");
  });
  // Nothing empty takes a place in a stack: a thing with no height still gets a gap on each side.
  document.querySelectorAll(".pane-in, .sheet-in, .tray, form, .layout-stack, .pane-stack, .stack-cell").forEach(function (holder) {
    var css = getComputedStyle(holder);
    if (!isShown(holder) || !/flex|grid/.test(css.display) || !(parseFloat(css.rowGap) > 0) || (css.display.indexOf("flex") >= 0 && css.flexDirection.indexOf("column") < 0)) return;
    Array.prototype.forEach.call(holder.children, function (child) {
      var childCss = getComputedStyle(child);
      if (childCss.display === "none" || /absolute|fixed/.test(childCss.position) || child.matches("script, style, template, .edge, .rail")) return;
      // One that gives back the gaps round it (a bot check until it's needed) takes no room.
      var givenBackPx = -(parseFloat(childCss.marginTop) + parseFloat(childCss.marginBottom));
      if (child.getBoundingClientRect().height < 0.5 && givenBackPx < parseFloat(css.rowGap) - 0.5) report("an empty thing taking a gap", child, "0px tall in a stack whose gap is " + css.rowGap);
    });
  });
  // Two controls side by side are a row (Row, layout.ts), so they slant toward each other and share one height.
  var CONTROL_ROOTS = ".run-wrap, .cut-btn, .glass-btn, .guest-btn, .cut-field > .field, .field.select, .find, .bday-field";
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
  if (header && isShown(header)) {
    var h = header.getBoundingClientRect();
    Array.prototype.forEach.call(document.querySelectorAll(".glass-pane, .foot"), function (el) {
      if (!isShown(el) || (el.parentElement && el.parentElement.closest("[data-glass], [data-on-no-pane], .example-stage"))) return;
      var r = el.getBoundingClientRect();
      [["left", r.left - h.left], ["right", r.right - h.right]].forEach(function (pair) {
        if (Math.abs(pair[1]) > TOLERANCE_PX && Math.abs(pair[1]) < 16) report("out of line with the header", el, "its " + pair[0] + " edge " + round(pair[1]) + "px off the header's");
      });
    });
  }
  var pageWidthPx = document.scrollingElement.scrollWidth;
  if (pageWidthPx > innerWidth + 1) report("the page scrolls sideways", document.body, pageWidthPx + "px wide in a " + innerWidth + "px window");
  return failures;
}`;
