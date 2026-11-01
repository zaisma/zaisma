/** Where a measured rule runs (docs/DESIGN.md, Rules): on every page in each pull request, or in the sweep (each night, and the merge queue). */
export type LayoutRuleTier = "page" | "sweep";
export const LAYOUT_TIERS: readonly LayoutRuleTier[] = ["page", "sweep"];

/**
 * Every rule the measuring check measures, by the name it fails with (a report() below, or a check: in scripts/layout-check.mjs), and its
 * tier. The check fails a page only for what a player would notice:
 *   - see: nothing past the screen, covered or spilling out of its pane, and the main action and Home's first cover without scrolling;
 *   - read: no words cut off or over something with an edge, nothing lost at 200% text (the sweep's screens), no scrolling sideways;
 *   - reach: 44px touch targets on a touch screen, and on one without touch every control reached by Tab, its focus showing;
 *   - press: every press answers within 400 ms.
 * Style isn't measured: the components and their tokens hold it, which test/site/design.test.ts and test/node/materials.test.ts check (a
 * pane's margins and frame gap, its corners and bevels, a row's one line and widths, the page shapes and reading width, a pane kind's
 * size), and stack(), grid() and columns() can't be given an empty part or two bare controls side by side (layout.ts).
 *   - page: on every page and state on each pull request, on a phone and a laptop;
 *   - sweep: too slow for every pull request (pressing every button), each night (.github/workflows/nightly.yml) and in the merge queue on
 *     the pages its change reaches, on the measured screens and at 200% text, with every page rule too.
 * test/layout/layout-check.test.ts fails a rule that isn't here, and a name here no rule uses.
 */
export const LAYOUT_RULE_TIERS: Readonly<Record<string, LayoutRuleTier>> = {
  // See.
  "overlaps another thing": "page",
  "spills out of its pane": "page",
  "a pane past the screen": "page",
  // What's past its edge can't be read or reached.
  "a pane that overflows without scrolling": "page",
  "two panes overlapping": "page",
  "the runner below the fold": "page",
  "the first cover below the fold": "page",
  // Read.
  "words cut off": "page",
  "words over something with an edge": "page",
  "the page scrolls sideways": "page",
  // Reach.
  "a touch target under 44px": "page",
  "a control the keyboard doesn't reach": "page",
  "a focused control with no visible focus": "page",
  // Press.
  "no answer within 400 ms": "sweep",
  // The check's own: what it couldn't do is a failure too, never a pass.
  "the check couldn't send the page's form": "page",
  "the check couldn't open the page's hidden state": "page",
  "the check couldn't measure the page": "page",
  "the page isn't the state it's listed as": "page",
  "the page didn't settle in time": "page",
  "the check couldn't open the gallery's panes": "page",
  // The loading check (FIRST_PAINT_SNAPSHOT_SOURCE): a page shows whole while it loads ("A page shows whole while it loads", docs/DESIGN.md):
  // nothing moves or changes its words after the first paint, and every picture sits in a Picture's box, where its placeholder shows.
  "a picture without its placeholder": "page",
  "moved after the first paint": "page",
  "words changed after the first paint": "page",
  "the check couldn't press the page's buttons": "sweep",
};

/**
 * What Tab can focus on a page (the keyboard check, scripts/layout-check.mjs): every control it must reach, once it's shown and enabled,
 * outside the game's frame and outside a closed pane. One taken out of Tab's order on purpose (a negative tabindex: the scroll rail's marks,
 * there for a pointer beside the page's own links) isn't.
 */
export const FOCUSABLE_SELECTOR = ':is(button, a[href], input:not([type="hidden"]), select, textarea, summary, [tabindex]):not([tabindex^="-"])';

/**
 * The measuring check (docs/DESIGN.md, Layout), run in a page: what a player would notice on it, as failures, each { check, element, said }.
 * scripts/layout-check.mjs runs it on every page in Chrome, and Screens (screens.ts) on each page it shows, live. It's a function's
 * source, since it runs in the browser: (MEASURE_LAYOUT_SOURCE)({ isMainActionChecked, isCoverAboveFold, isTouch, tiers }), where tiers
 * are the LAYOUT_RULE_TIERS it measures (every tier when it's left out). Things with an edge of their own are framed:
 * cut by the edge rule (data-cut-line), glass of their own (data-glass), a cover, or a list's rows.
 */
export const MEASURE_LAYOUT_SOURCE = String.raw`function measurePage(options) {
  var TIERS = ${JSON.stringify(LAYOUT_RULE_TIERS)};
  var tiers = options.tiers || ${JSON.stringify(LAYOUT_TIERS)};
  // Whether this run measures a rule (a rule missing from LAYOUT_RULE_TIERS is always measured).
  function isMeasured(check) { return !TIERS[check] || tiers.indexOf(TIERS[check]) >= 0; }
  var TOLERANCE_PX = 1.5;
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
  // What sits over the page, fixed to the window: a sheet, a menu, a popover, a notice, a card over the game. Measured as panes over the page.
  var OVER_PAGE = ".sheet:not(.in-place), .dropdown, [popover], .notice, .playing-card, .playing-bar, .playing-check";
  function isOnFixed(el) { for (var walk = el; walk && walk !== document.body; walk = walk.parentElement) { if (getComputedStyle(walk).position === "fixed") return true; } return false; }
  // A gallery example is a piece shown alone, not a page: the page's own rules (its titles, its headings' order) skip it.
  var EXAMPLE = ".example-stage";
  // ---- Panes over the page (docs/DESIGN.md, Pane sizes): one stays on the screen, and scrolls inside past its size, so nothing in it is lost. ----
  function measurePanes() {
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
      var r = pane.getBoundingClientRect();
      // A floating pane the gallery shows open in place (its open states) is a piece shown alone, not over a page.
      if (pane.closest(EXAMPLE) && (pane.matches(".in-place") || pane.closest(EXAMPLE + " .in-place"))) return;
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
  // The gallery's panes opened one by one (scripts/layout-check.mjs) are measured on their own.
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
  var panes = Array.prototype.filter.call(document.querySelectorAll("[data-glass]:not([data-cut-line])"), function (pane) { return isShown(pane) && !pane.classList.contains("frame"); });
  panes.forEach(function (pane) {
    // What holds a pane's content and pads it: its inner part (a sidebar's places scroll in .sidebar-scroll), or the pane itself.
    var holder = pane.querySelector(":scope > .pane-in, :scope > .sheet-in, :scope > .playing-card-in, :scope > .sidebar-scroll") || pane, p = pane.getBoundingClientRect();
    // A pane that scrolls inside itself: its top and bottom are its content's, wherever it's scrolled to.
    var isScrolling = holder.scrollHeight > holder.clientHeight + 1, contentTop = holder.getBoundingClientRect().top - holder.scrollTop;
    var box = { left: p.left, right: p.right, top: isScrolling ? contentTop : p.top, bottom: isScrolling ? contentTop + holder.scrollHeight : p.bottom };
    var distances = function (r) { return { left: r.left - box.left, right: box.right - r.right, top: r.top - box.top, bottom: box.bottom - r.bottom }; };
    // A floating pane the gallery shows open in place (a select's list over its field, a wheel field's wheels) is laid over the pane, not
    // set in it: it's measured as a pane of its own. So is a chart's tip, floating over the point it's about.
    var framed = Array.prototype.filter.call(pane.querySelectorAll(FRAMED), function (el) { return el !== pane && !el.matches(".floating-pane.in-place, .chart-tip") && !el.closest(".rail") && !framedIn(el, pane) && isShown(el); });
    // Nothing with an edge runs past its pane's edge. Inside what scrolls with its rail showing, the rail's room is past the end edge.
    framed.forEach(function (el) {
      if (isScrolledAway(el, pane)) return;
      var d = distances(el.getBoundingClientRect()), railed = el.closest(".shows-rail"), isRailed = Boolean(railed) && pane.contains(railed) && parseFloat(getComputedStyle(railed).paddingRight) > 0;
      // In a list that scrolls up and down inside the pane (a long menu's choices), what shows sits wherever it's scrolled to: only its sides are measured.
      var holdingScroller = scrollerIn(el, pane), isInScrolledList = holdingScroller && !holdingScroller.matches(".pane-in, .sheet-in") && holdingScroller.scrollHeight > holdingScroller.clientHeight + 1;
      (isInScrolledList || isScrolling ? ["left", "right"] : ["left", "right", "top", "bottom"]).forEach(function (side) {
        if (d[side] < -TOLERANCE_PX && !(side === "right" && isRailed)) report("spills out of its pane", el, side + " edge " + round(-d[side]) + "px past the pane's");
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
    // Words: no line of the pane's own words lies over something with an edge.
    var walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT), text, flagged = new Set();
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
        // What's scrolled out of its box (the buy sheet's body, scrolled to its confirm step) isn't under the words: it isn't shown there.
        var under = framed.find(function (f) { if (isScrolledAway(f, pane)) return false; var o = f.getBoundingClientRect(); return Math.min(r.right, o.right) - Math.max(r.left, o.left) > TOLERANCE_PX && Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top) > TOLERANCE_PX; });
        if (under) { flagged.add(el); report("words over something with an edge", el, "over " + describe(under)); return true; }
        return false;
      });
    }
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

  measurePanes();

  // Two panes on the page, side by side or one over the other, never overlap. Panes over the page (a sheet, a menu) and a pane inside
  // another are left out.
  var pagePanes = Array.prototype.filter.call(document.querySelectorAll(".glass-pane, .tray, .foot, header.top"), function (pane) { return isShown(pane) && !isOnFixed(pane) && !pane.closest(EXAMPLE + ", " + OVER_PAGE) && !(pane.parentElement && pane.parentElement.closest(".glass-pane, .tray")); });
  for (var p1 = 0; p1 < pagePanes.length; p1++) for (var p2 = p1 + 1; p2 < pagePanes.length; p2++) {
    var one = pagePanes[p1].getBoundingClientRect(), two = pagePanes[p2].getBoundingClientRect();
    var acrossPx = Math.min(one.right, two.right) - Math.max(one.left, two.left), downPx = Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top);
    if (acrossPx > TOLERANCE_PX && downPx > TOLERANCE_PX) report("two panes overlapping", pagePanes[p2], "over " + describe(pagePanes[p1]) + " by " + round(acrossPx) + " x " + round(downPx) + "px");
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
  // Pictures: each img in a Picture's box, or a backdrop with its placeholder layer under it. The box shows its placeholder where the picture
  // has one; one made before placeholders were (the daily job fills those in) shows what's under it, which is the data's, not the page's. A
  // QR code and the icon drawn in it are a drawn code, not a picture, and a file being chosen is the player's own.
  var bare = Array.prototype.filter.call(document.body.querySelectorAll("img"), function (img) {
    if (img.matches(".qr-picture, .qr-icon, .file-drop-view") || img.closest("[hidden], dialog:not([open])")) return false;
    var box = img.parentElement;
    if (box && box.classList.contains("picture")) return false;
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
