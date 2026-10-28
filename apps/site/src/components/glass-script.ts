

/**
 * The page's one watcher, which every component asks instead of watching by itself (window.zaismaWatch):
 * - page(callback): callback(changes) with every record of the page's one MutationObserver (children added or removed under the body, and
 *   a class, open or hidden attribute changing), in the order components asked. Drawings are left out (anything inside an svg: the edge
 *   rule's rims and cut lines, icons, charts), and so is an attribute that ends a delivery as it started it (a class added that was already
 *   there, or added and taken away again), so components hear only of what changed.
 * - size(element, callback, batch): callback() when the element's size changes (and once when it's first watched), from one ResizeObserver.
 *   A callback watching several elements runs once for the ones that changed together. batch(work), when given, wraps every callback of
 *   the same batch that is due together, so they can read the page once before any of them writes.
 * - resize(callback, batch) and scroll(callback): callback() on the window's resize, and on any scroll anywhere (captured, passive).
 * - each(selector, callback): callback(element) once for every element matching the selector, those on the page now and any added later
 *   (a pane whose content is swapped in place), so a component's wiring reaches new content as a page load's would.
 * - scrollBoxes(): the boxes on the page that scroll up and down (overflow-y auto or scroll), in the page's order, found once. Only what the
 *   page's stylesheets, the browser's own or an element's own style make scroll is asked for its style, never every element.
 * Where the browser has no ResizeObserver, size falls back to the window's resize.
 */
export const WATCH_SCRIPT = `/* watch */(function () {
  var pageCallbacks = [], sizeCallbacks = new Map(), resizeCallbacks = [], scrollCallbacks = [], sizes = null, hasResizeListener = false, hasScrollListener = false, scrollBoxes = null;
  function runPlain(work) { work(); }
  // Callbacks that share a batch (a function taking the work to do) run together inside it, each once: the edge rule measures a whole batch of controls before drawing any.
  function runBatched(entries) {
    var batches = new Map();
    entries.forEach(function (entry) {
      var batch = entry.batch || runPlain, due = batches.get(batch);
      if (!due) { due = new Set(); batches.set(batch, due); }
      due.add(entry.callback);
    });
    batches.forEach(function (due, batch) { batch(function () { due.forEach(function (callback) { callback(); }); }); });
  }
  function watchWindow(kind, entries, callback, batch) {
    entries.push({ callback: callback, batch: batch });
    if (kind === "resize" ? hasResizeListener : hasScrollListener) return;
    if (kind === "resize") { hasResizeListener = true; window.addEventListener("resize", function () { runBatched(resizeCallbacks.slice()); }); }
    else { hasScrollListener = true; window.addEventListener("scroll", function () { runBatched(scrollCallbacks.slice()); }, { passive: true, capture: true }); }
  }
  // The selectors of what scrolls: the browser's own sheet scrolls a text box, a list box, a popover and a modal dialog; the page's sheets and an element's style, the rest. Found once.
  var scrollSelectorList = null;
  function scrollSelectors() {
    if (scrollSelectorList) return scrollSelectorList;
    var selectors = ["textarea", "select", "[popover]", "dialog", "[style*='overflow']"];
    function visit(rules) {
      for (var i = 0; i < rules.length; i++) {
        var rule = rules[i], style = rule.style;
        if (style && rule.selectorText && /auto|scroll|var\\(/.test(style.overflowY + " " + style.getPropertyValue("overflow"))) selectors.push(rule.selectorText);
        if (rule.cssRules) visit(rule.cssRules);
      }
    }
    Array.prototype.forEach.call(document.styleSheets, function (sheet) { try { visit(sheet.cssRules); } catch (error) { /* a sheet from another site */ } });
    scrollSelectorList = selectors;
    return selectors;
  }
  // What a selector matches under a root. A rule for a pseudo-element (::before) can't be asked for: the element it's on is.
  function matching(root, selector) {
    var matched;
    try { matched = root.querySelectorAll(selector); } catch (error) { try { matched = root.querySelectorAll(selector.replace(/::[a-z-]+(\\([^)]*\\))?/g, "")); } catch (again) { return []; } }
    return Array.from(matched);
  }
  function isScrolling(box) { return box !== document.body && document.body.contains(box) && /^(auto|scroll)$/.test(getComputedStyle(box).overflowY); }
  window.zaismaWatch = {
    page: function (callback) { pageCallbacks.push(callback); },
    size: function (element, callback, batch) {
      if (!window.ResizeObserver) { watchWindow("resize", resizeCallbacks, callback, batch); return; }
      if (!sizes) {
        sizes = new ResizeObserver(function (changed) {
          var due = [];
          changed.forEach(function (entry) { (sizeCallbacks.get(entry.target) || []).forEach(function (each) { due.push(each); }); });
          runBatched(due);
        });
      }
      var entries = sizeCallbacks.get(element);
      // The border box, the size the edge rule draws to.
      if (!entries) { entries = []; sizeCallbacks.set(element, entries); sizes.observe(element, { box: "border-box" }); }
      entries.push({ callback: callback, batch: batch });
    },
    resize: function (callback, batch) { watchWindow("resize", resizeCallbacks, callback, batch); },
    scroll: function (callback) { watchWindow("scroll", scrollCallbacks, callback); },
    scrollBoxes: function () {
      if (scrollBoxes) return scrollBoxes;
      var found = new Set();
      scrollSelectors().forEach(function (selector) { matching(document, selector).forEach(function (box) { if (isScrolling(box)) found.add(box); }); });
      scrollBoxes = Array.from(found).sort(function (one, other) { return one.compareDocumentPosition(other) & 4 ? -1 : 1; });
      return scrollBoxes;
    },
    // The same for what was added to the page later (a list the page swaps in): the element and what's inside it that scrolls.
    scrollBoxesIn: function (root) {
      var found = new Set();
      scrollSelectors().forEach(function (selector) {
        var boxes = matching(root, selector);
        try { if (root.matches(selector)) boxes.unshift(root); } catch (error) { /* a selector for a pseudo-element */ }
        boxes.forEach(function (box) { if (isScrolling(box)) found.add(box); });
      });
      return Array.from(found);
    },
    each: function (selector, callback) {
      var wired = new WeakSet();
      function wire(element) { if (wired.has(element)) return; wired.add(element); callback(element); }
      document.querySelectorAll(selector).forEach(wire);
      pageCallbacks.push(function (changes) {
        changes.forEach(function (change) {
          change.addedNodes.forEach(function (node) {
            if (node.nodeType !== 1 || !node.isConnected) return;
            if (node.matches(selector)) wire(node);
            node.querySelectorAll(selector).forEach(wire);
          });
        });
      });
    }
  };
  function heard(changes) {
    var firstChanges = new Map();
    return changes.filter(function (change) {
      if (change.target instanceof SVGElement) return false;
      if (change.type !== "attributes") return true;
      var byName = firstChanges.get(change.target);
      if (!byName) { byName = {}; firstChanges.set(change.target, byName); }
      if (byName[change.attributeName]) return false;
      byName[change.attributeName] = true;
      return change.oldValue !== change.target.getAttribute(change.attributeName);
    });
  }
  new MutationObserver(function (changes) {
    var due = heard(changes);
    if (due.length) pageCallbacks.slice().forEach(function (callback) { callback(due); });
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ["class", "open", "hidden"] });
})();
`;

/**
 * glass(el, corners) and cutLine(el), from the header draft, as window.zaismaGlass and window.zaismaCutLine.
 * On load, and for elements added later, they're applied to every [data-glass] (corners from data-glass-corners) and every
 * [data-cut-line] (a control: its slant, where it has one, in its value).
 * data-glass-corners names a slab's four cuts, top left, top right, bottom right, bottom left: "pane", "header" or "menu" for that
 * kind's large and small cuts round it (the tokens --pane-cut-large and the rest), or four of a kind's "pane-large", "pane-small"
 * and so on, or numbers ("pane-large pane-small 0 0": a tray's head). window.zaismaCorners(el) reads them as numbers.
 */
export const GLASS_SCRIPT = `/* glass */(function () {
  var SVG = "http://www.w3.org/2000/svg";
  // The cut tokens, read from the page's root once, as the script starts and before anything is drawn: they're the same on every screen,
  // so reading them later, between a pass's writes, would only make the browser work its styles out again.
  var cutTokens = {};
  function cutToken(name) {
    if (!(name in cutTokens)) cutTokens[name] = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--" + name.replace(/-(large|small)$/, "-cut-$1"))) || 0;
    return cutTokens[name];
  }
  ["pane", "header", "menu"].forEach(function (kind) { cutToken(kind + "-large"); cutToken(kind + "-small"); });
  function corners(el, fallback) {
    var words = (el.getAttribute("data-glass-corners") || fallback).trim().split(/\\s+/);
    if (words.length === 1 && /^[a-z]+$/.test(words[0])) words = [words[0] + "-large", words[0] + "-small", words[0] + "-large", words[0] + "-small"];
    return words.map(function (word) { return /^[a-z]+-(large|small)$/.test(word) ? cutToken(word) : Number(word) || 0; });
  }
  window.zaismaCorners = corners;
  /* The sign-in pane's glass, for any slab: cut corners and the drawn rim (dark hairline, polished edge, bevel band, faint rainbow fringe, bright cut facets). */
  function cutPoints(w, h, c, inset) {
    // A corner that isn't cut stays square all the way in, so its bands meet in a plain mitre, not a facet of their own.
    var i = inset, k = inset * 0.414, d = c.map(function (cut) { return cut > 0 ? cut + k : i; });
    return [[i, d[0]], [d[0], i], [w - d[1], i], [w - i, d[1]], [w - i, h - d[2]], [w - d[2], h - i], [d[3], h - i], [i, h - d[3]]];
  }
  function pointList(points) { return points.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" "); }
  // How lit each side of the cut is, from the top left corner's cut round to the left side. Neighbors always differ, so every turn of the edge shows as a step in brightness, like a cut facet.
  var SIDE_LIGHT = [80, 100, 70, 28, 12, 0, 40, 62];
  // A control made of glass takes its sides' light from the way each faces (the same steps, round the same way).
  var FACING_LIGHT = { "top-left": 80, top: 100, "top-right": 70, right: 28, "bottom-right": 12, bottom: 0, "bottom-left": 40, left: 62 };
  // One flat quad per side, between two insets of the shape; kept while the number of sides stays, so nothing is rebuilt mid-animation.
  function placeBands(group, quads, outer, inner, lights) {
    while (quads.length < outer.length) { var quad = document.createElementNS(SVG, "polygon"); group.appendChild(quad); quads.push(quad); }
    while (quads.length > outer.length) group.removeChild(quads.pop());
    quads.forEach(function (quad, i) { var j = (i + 1) % outer.length; quad.style.setProperty("--side-light", lights[i] + "%"); quad.setAttribute("points", pointList([outer[i], outer[j], inner[j], inner[i]])); });
  }
  /*
   * A pass: the controls drawn together measure the page once, before any of them writes. A batch (the controls the observers hand over
   * together, the whole page's first draw, a resize) starts by measuring every control and pane (rectangles and sizes) and grouping the
   * controls by what holds them, so a control compares itself only with the ones in its own holder, and nothing is measured again after
   * another control's drawing. A single control redrawn on its own measures only what it reads.
   */
  var pass = null;
  function runPass(work, isBatch) {
    if (pass) { work(); return; }
    pass = { rects: new Map(), sizes: new Map(), groups: new Map(), scrollers: new Map(), isBatch: Boolean(isBatch), isMeasured: false };
    try { work(); } finally { pass = null; }
  }
  function runBatch(work) { runPass(work, true); }
  // In a batch, the first thing drawn measures everything at once; a pass that draws nothing measures nothing.
  function measureAll() {
    pass.isMeasured = true;
    document.querySelectorAll("[data-cut-line], [data-glass]").forEach(function (el) { pass.rects.set(el, el.getBoundingClientRect()); pass.sizes.set(el, [el.offsetWidth, el.offsetHeight]); });
    document.querySelectorAll("[data-cut-line]").forEach(function (el) { groupIn(holderOf(el)).push(el); });
    // Boxes that scroll inside a pane, down (.own-scroll) or sideways (a track), for the controls in them (contentRectOf), read with
    // everything else, before anything is drawn.
    document.querySelectorAll("body .own-scroll, body .layout-track").forEach(function (el) { pass.scrollers.set(el, readScroll(el)); });
  }
  function readScroll(el) { return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollLeft: el.scrollLeft, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }; }
  function scrollOf(el) {
    var read = pass.scrollers.get(el);
    if (!read) { read = readScroll(el); pass.scrollers.set(el, read); }
    return read;
  }
  function groupIn(holder) {
    var group = pass.groups.get(holder);
    if (!group) { group = []; pass.groups.set(holder, group); }
    return group;
  }
  function rectOf(el) { if (pass.isBatch && !pass.isMeasured) measureAll(); var r = pass.rects.get(el); if (!r) { r = el.getBoundingClientRect(); pass.rects.set(el, r); } return r; }
  function sizeOf(el) { if (pass.isBatch && !pass.isMeasured) measureAll(); var size = pass.sizes.get(el); if (!size) { size = [el.offsetWidth, el.offsetHeight]; pass.sizes.set(el, size); } return size; }
  function controlsIn(holder) {
    if (pass.isBatch && !pass.isMeasured) measureAll();
    if (pass.isMeasured) return pass.groups.get(holder) || [];
    var group = pass.groups.get(holder);
    if (!group) {
      group = Array.prototype.filter.call((holder || document).querySelectorAll("[data-cut-line]"), function (other) { return holderOf(other) === holder; });
      pass.groups.set(holder, group);
    }
    return group;
  }
  // Every control drawn by the edge rule, to draw again together when the window's width changes or a font arrives.
  var edgeDraws = new Map(), isWaitingForFonts = false;
  function redrawEdges() {
    runBatch(function () { edgeDraws.forEach(function (draw, el) { if (el.isConnected) draw(); else edgeDraws.delete(el); }); });
  }
  // A font that finishes loading can move every control, so all are drawn again then; a control drawn once the fonts are in has nothing
  // to wait for. Where the browser can't say when a font loads, the fonts' ready promise stands in, once while they're loading.
  var hasFontEvents = Boolean(document.fonts && document.fonts.addEventListener);
  if (hasFontEvents) document.fonts.addEventListener("loadingdone", function () { redrawEdges(); findEdgedSoon(); });
  function drawEdgeAfterFonts() {
    if (hasFontEvents || isWaitingForFonts || !document.fonts || !document.fonts.ready || document.fonts.status !== "loading") return;
    isWaitingForFonts = true;
    document.fonts.ready.then(function () { isWaitingForFonts = false; redrawEdges(); });
  }
  // A change of the window's width can move every control (a row wrapping, a column folding), so all are drawn again together, after
  // layout, in the same delivery as the panes it resized. A change of its height alone (a phone's toolbar hiding as the page scrolls) moves
  // nothing whose own box and holder stayed the same size, and anything that did change size draws itself again.
  var shownWidth = -1;
  window.zaismaWatch.size(document.documentElement, function () {
    var width = document.documentElement.clientWidth, isFirst = shownWidth < 0;
    if (width === shownWidth) return;
    shownWidth = width;
    if (!isFirst) { redrawEdges(); findEdgedSoon(); }
  }, runBatch);
  var made = 0;
  // The rim is built once; while the slab changes size only its points move, so nothing is rebuilt mid-animation (rebuilding it each frame made the edges flicker).
  // A pane's cut corners are a clip-path in CSS terms (calc with 100%), so it follows the slab's size by itself and is only set again when the corners change.
  // A control made of glass ([data-cut-line] too) takes its shape from the edge rule instead, like every other control.
  function glass(el, cornersOf) {
    var edge = el.querySelector(":scope > .edge"), id = "zg" + (made++), parts = null, lastCorners = "", lastPane = "", isControl = el.hasAttribute("data-cut-line");
    if (!edge) { edge = document.createElementNS(SVG, "svg"); edge.setAttribute("class", "edge"); edge.setAttribute("aria-hidden", "true"); el.appendChild(edge); }
    function node(tag, attributes) { var n = document.createElementNS(SVG, tag); for (var name in attributes) n.setAttribute(name, attributes[name]); edge.appendChild(n); return n; }
    function build() {
      edge.innerHTML =
        '<defs>' +
        '<linearGradient id="' + id + 'fr" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7fd8ff" stop-opacity="0.5"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#ffc58a" stop-opacity="0.5"/></linearGradient>' +
        // Refraction: the facet's inner line catches the light from the other side, so it runs the opposite way to the rim.
        '<linearGradient id="' + id + 'in" x1="1" y1="1" x2="0" y2="0"><stop class="gleam" offset="0"/><stop class="gleam" offset="0.4" stop-opacity="0"/><stop class="gleam" offset="0.75" stop-opacity="0"/><stop class="gleam" offset="1" stop-opacity="0.35"/></linearGradient>' +
        // Reflection: a bright glint where the rim meets the lit corner, fading along both edges.
        '<linearGradient id="' + id + 'sp" x1="0" y1="0" x2="1" y2="1"><stop class="spec" offset="0"/><stop class="spec" offset="0.08"/><stop class="spec" offset="0.3" stop-opacity="0"/></linearGradient>' +
        '</defs>';
      parts = {
        dense: node("path", { "class": "dense", "fill-rule": "evenodd" }),
        bevel: node("g", { "class": "bevel" }), bevelQuads: [],
        hair: node("polygon", { "class": "hair", fill: "none", "stroke-width": "1.2" }),
        rimBand: node("g", { "class": "rim-band" }), rimQuads: [],
        // A plain line on the rim, unseen until a tinted or focused slab colors it.
        rim: node("polygon", { "class": "rim", fill: "none", "stroke-width": "1.6" }),
        spec: node("polygon", { "class": "spec-line", fill: "none", stroke: "url(#" + id + "sp)", "stroke-width": "1.4" }),
        fringe: node("polygon", { "class": "fringe", fill: "none", stroke: "url(#" + id + "fr)", "stroke-width": "0.8" }),
        inner: node("polygon", { "class": "inner", fill: "none", stroke: "url(#" + id + "in)", "stroke-width": "1" }),
        // Caustics, on a pane (not a control): the light the thick glass gathers just inside its edge, brightest on the lit facets,
        // fading inward in a few soft steps. It's part of the pane's own rim, so it moves with the pane, never a frame behind it.
        caustics: isControl ? [] : [1, 2, 3, 4].map(function (step) { return { group: node("g", { "class": "caustic step-" + step }), quads: [] }; }),
        facets: []
      };
    }
    function draw() { runPass(drawEdge); }
    function drawEdge() {
      var size = sizeOf(el), w = size[0], h = size[1];
      if (!w || !h) return;
      // Any size: a small slab gets smaller cuts and a narrower bevel, so the rim never crowds what's in it.
      var short = Math.min(w, h), band = Number(el.getAttribute("data-glass-band")) || Math.max(2, Math.min(4, short * 0.04)), at, lights;
      if (!parts) build();
      if (isControl) {
        var shape = distinct(controlOutline(el, w, h)), key = w + "x" + h + ":" + pointList(shape);
        if (key === lastCorners) return;
        lastCorners = key;
        el.style.setProperty("--cut-shape", cssPolygon(shape)); el.style.clipPath = cssPolygon(shape);
        at = function (inset) { return insetShape(shape, inset); };
        lights = shape.map(function (p, i) { return FACING_LIGHT[facing(p, shape[(i + 1) % shape.length])]; });
      } else {
        var c = cornersOf().map(function (cut) { return Math.min(cut, Math.round(short * 0.3)); }), cornerKey = c.join(",");
        if (cornerKey !== lastCorners) {
          lastCorners = cornerKey;
          el.style.clipPath = "polygon(0 " + c[0] + "px, " + c[0] + "px 0, calc(100% - " + c[1] + "px) 0, 100% " + c[1] + "px, 100% calc(100% - " + c[2] + "px), calc(100% - " + c[2] + "px) 100%, " + c[3] + "px 100%, 0 calc(100% - " + c[3] + "px))";
        }
        // An open side (data-glass-open="top", a tray under its pane) draws its rim past the slab, where the clip hides it, so the glass runs straight on into what's above.
        var reach = el.getAttribute("data-glass-open") === "top" ? Math.ceil(band * 1.6) + 2 : 0;
        // A pane whose glass in front isn't its whole box (a sheet whose chosen tab rises from it, el.zaismaEdgeShape) draws its rim along that
        // outline instead, with the same layers and light; what lies outside it in the box is behind (the clip stays the box's).
        var outlined = el.zaismaEdgeShape ? el.zaismaEdgeShape(w, h, c) : null;
        if (outlined) outlined = distinct(outlined);
        // A rim drawn at this size, with these cuts, is already there: nothing is written again.
        var paneKey = w + "x" + h + ":" + band + ":" + reach + ":" + cornerKey + (outlined ? ":" + pointList(outlined) : "");
        if (paneKey === lastPane) return;
        if (lastPane) paneResized(el);
        lastPane = paneKey;
        if (outlined) {
          at = function (inset) { return insetShape(outlined, inset); };
          lights = outlined.map(function (p, i) { return FACING_LIGHT[facing(p, outlined[(i + 1) % outlined.length])]; });
        } else {
          at = function (inset) { return cutPoints(w, h + reach, c, inset).map(function (p) { return [p[0], p[1] - reach]; }); };
          lights = SIDE_LIGHT;
        }
      }
      // No viewBox: the rim is drawn in CSS pixels, so a frame where the slab has grown before its points move never stretches it.
      edge.removeAttribute("viewBox");
      // Density: glass is thicker at its edge, so a second, wider band tints the panel just inside the bevel.
      parts.dense.setAttribute("d", "M" + pointList(at(0)) + "Z M" + pointList(at(band * 1.6)) + "Z");
      placeBands(parts.bevel, parts.bevelQuads, at(0), at(band), lights);
      placeBands(parts.rimBand, parts.rimQuads, at(0), at(1.6), lights);
      parts.hair.setAttribute("points", pointList(at(0.6)));
      parts.rim.setAttribute("points", pointList(at(1.6)));
      parts.spec.setAttribute("points", pointList(at(1.6)));
      // Dispersion: a faint split of color along the facet's inner edge, where the light bends.
      parts.fringe.setAttribute("points", pointList(at(Math.max(2.4, band - 0.8))));
      parts.inner.setAttribute("points", pointList(at(band)));
      var causticInsets = [band, band + 2, band + 5, band + 9, band + 14];
      parts.caustics.forEach(function (caustic, i) { placeBands(caustic.group, caustic.quads, at(causticInsets[i]), at(causticInsets[i + 1]), lights); });
      // The cut facets: a bright line on each side cut across a corner, the one facing the light brightest.
      var outline = at(0), facetSides = [];
      outline.forEach(function (p, i) {
        var q = outline[(i + 1) % outline.length], way = facing(p, q);
        if (way.indexOf("-") > 0 && Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.5) facetSides.push([p, q, way]);
      });
      while (parts.facets.length < facetSides.length) parts.facets.push(node("line", {}));
      parts.facets.forEach(function (line, i) {
        var side = facetSides[i];
        line.style.display = side ? "" : "none"; if (!side) return;
        var isLit = side[2] === "top-left";
        line.setAttribute("class", isLit ? "facet lit" : "facet"); line.setAttribute("stroke-width", isLit ? "4.5" : "3");
        line.setAttribute("x1", side[0][0]); line.setAttribute("y1", side[0][1]); line.setAttribute("x2", side[1][0]); line.setAttribute("y2", side[1][1]);
      });
    }
    draw();
    // A page's script that changes the outline (a sheet's chosen tab) draws the rim again at once.
    el.redrawGlass = function () { draw(); };
    window.zaismaWatch.size(el, draw, runBatch);
    if (isControl) { edgeDraws.set(el, draw); drawEdgeAfterFonts(); }
    return draw;
  }
  /*
   * The edge rule, one for every action and input (cutLine draws it, and glass for a control made of glass):
   * - An end slants only where another control sits right beside it in a row (tabs in a switch, Play and its details):
   *   side by side with their boxes --gap-control-row-boxes apart. Both slant by --control-slant, so the gap between the slants is
   *   parallel, --gap-control-row wide. Stacked, on no pane, they're --gap-control-stack apart.
   * - Every other corner fits what holds it (the glass pane, or a control it sits in): it takes the holder's outline moved
   *   in by the gap round it, so the gap stays even. Near a corner of the pane that's the pane's cut, less the gap; along a
   *   straight edge, or in the middle, it's square. A control alone in a pane fits it at its top and its bottom.
   * - A control on no pane is shaped as if it were in a pane, flush to it: a pane's corners at its own size, except where another
   *   control on no pane is stacked right above or below it (the pane would hold them both), where it's square.
   * The shape goes to CSS as --cut-shape, and el.cutCorners holds its corners for what sits inside it.
   */
  // Half a pixel over the token, for gaps a layout rounds.
  var rootCss = getComputedStyle(document.documentElement), token = function (name, fallback) { return parseFloat(rootCss.getPropertyValue(name)) || fallback; };
  var SLANT_PX = token("--control-slant", 10), ROW_GAP_PX = token("--gap-control-row", 4), STACK_GAP_PX = token("--gap-control-stack", 8);
  // Neighbors side by side overlap their boxes by the slant less the row's gap (half a pixel either way, for gaps a layout rounds).
  var BESIDE_MIN_PX = ROW_GAP_PX - SLANT_PX - 0.5, BESIDE_MAX_PX = ROW_GAP_PX - SLANT_PX + 0.5, LONE_CORNERS = [16, 8, 16, 8];
  // A corner's cut shorter than this is square: what's left of a pane's cut just past its reach can't be seen, and an outline or band drawn
  // inside a cut that small turns it inside out, which a wide line (keyboard focus) draws as a spike.
  var LEAST_CUT_PX = 2;
  function glassCorners(pane) {
    var cuts = corners(pane, "header"), size = sizeOf(pane), short = Math.min(size[0], size[1]);
    return cuts.map(function (cut) { return Math.min(cut, Math.round(short * 0.3)); });
  }
  // What holds a control: the nearest pane, tray or control round it. data-on-no-pane stops the search (a gallery example's stage:
  // what's shown in it is shown on no pane, even when the stage sits on a tray).
  function holderOf(el) { var found = el.parentElement && el.parentElement.closest("[data-glass], [data-cut-line], [data-on-no-pane]"); return found && !found.hasAttribute("data-on-no-pane") ? found : null; }
  // What a control measures its gaps against: its holder's box, or, where the holder scrolls inside itself (a tall pane's .own-scroll),
  // the whole scrolled content, so a control below the fold is square in the middle and cut at the foot wherever it's scrolled to.
  function contentRectOf(el, holder) {
    // The box that scrolls round it, never itself: a box that scrolls inside (a table capped in height) is measured where it sits.
    var p = rectOf(holder), scroller = el.parentElement && el.parentElement.closest(".own-scroll"), track = el.parentElement && el.parentElement.closest(".layout-track");
    // A track (a row that scrolls sideways) runs the holder on by what's scrolled out of view to either side, so the first in it takes the
    // pane's corner at the start, the last the one at the end, and every one between is square, wherever the row is scrolled to.
    if (track && track !== holder && holder.contains(track)) {
      var along = scrollOf(track);
      if (along.scrollWidth > along.clientWidth + 1) p = { top: p.top, bottom: p.bottom, left: p.left - along.scrollLeft, right: p.right + along.scrollWidth - along.clientWidth - along.scrollLeft };
    }
    if (!scroller || scroller === holder || !holder.contains(scroller)) return p;
    var scrolled = scrollOf(scroller);
    if (scrolled.scrollHeight <= scrolled.clientHeight + 1) return p;
    // The holder's own box, run on by what's scrolled out of view above and below it, so a scroller that's only part of it (a sheet's body,
    // under its head) measures as one that fills it.
    return { top: p.top - scrolled.scrollTop, bottom: p.bottom + scrolled.scrollHeight - scrolled.clientHeight - scrolled.scrollTop, left: p.left, right: p.right };
  }
  // The corner cuts each corner takes from what holds it: the holder's outline, moved in by the gap. data-cut-ends="start", "end"
  // or "start end": that end follows the holder's end wherever it sits along it, its gap there taken as its gap from the top and
  // bottom (a switch's slab on its first or last tab, as the tabs scroll).
  // data-cut-stack="first", "last", "first last" or "": a part of a vertical stack (a vertical switch's slab): its top follows the holder's top
  // only on the first, its bottom only on the last, at its gap from the sides, wherever it sits as it moves; between, it's square.
  // as: { beside, ends, stack } stands in for data-cut-beside, data-cut-ends and data-cut-stack, for the shape a part had before it moved (a glide).
  function fitCuts(el, w, h, as) {
    var holder = holderOf(el);
    if (!holder) {
      var stack = stacked(el);
      return LONE_CORNERS.map(function (cut, i) { return (i < 2 ? stack.above : stack.below) ? 0 : Math.min(cut, Math.round(Math.min(w, h) * 0.25)); });
    }
    var c = holder.hasAttribute("data-cut-line") ? holder.cutCorners || [0, 0, 0, 0] : glassCorners(holder);
    var r = rectOf(el), p = contentRectOf(el, holder), ends = as ? as.ends : el.getAttribute("data-cut-ends") || "";
    var top = r.top - p.top, bottom = p.bottom - r.bottom, stackAt = as ? as.stack : el.getAttribute("data-cut-stack");
    if (stackAt !== null && stackAt !== undefined) { var side = r.left - p.left; top = /first/.test(stackAt) ? side : 1e6; bottom = /last/.test(stackAt) ? side : 1e6; }
    var left = /start/.test(ends) ? (top + bottom) / 2 : r.left - p.left, right = /end/.test(ends) ? (top + bottom) / 2 : p.right - r.right;
    // Its cut keeps the same gap to the pane's cut as its sides keep to the pane's sides, however small the box (a swatch, a check's box),
    // up to half its short side, where two cuts on one side would meet. A thin bar (a scrollbar along a pane's foot) follows the corner
    // across its whole height instead.
    var most = Math.max(w, h) < 3 * Math.min(w, h) ? Math.min(w, h) * 0.5 : Infinity;
    return [[left, top], [right, top], [right, bottom], [left, bottom]].map(function (gaps, i) {
      var sum = Math.max(0, gaps[0]) + Math.max(0, gaps[1]);
      return Math.min(most, Math.max(0, (c[i] || 0) - sum + Math.SQRT2 * sum / 2));
    });
  }
  // Which ends have another control right beside them. data-cut-beside="start", "end", "start end" or "" says so instead (a switch's
  // slab: the tabs beside it aren't controls of their own).
  function besides(el, as) {
    var declared = as ? as.beside : el.getAttribute("data-cut-beside");
    if (declared !== null) return { start: /start/.test(declared), end: /end/.test(declared) };
    var holder = holderOf(el), r = rectOf(el), found = { start: false, end: false };
    controlsIn(holder).forEach(function (other) {
      if (other === el) return;
      var o = rectOf(other); if (!o.width || !o.height) return;
      if (Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top) < Math.min(r.height, o.height) / 2) return;
      var after = o.left - r.right, before = r.left - o.right, isAfter = after >= BESIDE_MIN_PX && after <= BESIDE_MAX_PX, isBefore = before >= BESIDE_MIN_PX && before <= BESIDE_MAX_PX;
      if ((isAfter || isBefore) && !other.contains(el) && !el.contains(other)) { if (isAfter) found.end = true; if (isBefore) found.start = true; }
    });
    return found;
  }
  // For a control on no pane: whether another one sits right above or below it, overlapping it across.
  function stacked(el) {
    var r = rectOf(el), found = { above: false, below: false };
    controlsIn(null).forEach(function (other) {
      if (other === el) return;
      var o = rectOf(other); if (!o.width || !o.height) return;
      if (Math.min(r.right, o.right) - Math.max(r.left, o.left) < Math.min(r.width, o.width) / 2) return;
      var below = o.top - r.bottom, above = r.top - o.bottom, isBelow = below >= -1 && below <= STACK_GAP_PX + 0.5, isAbove = above >= -1 && above <= STACK_GAP_PX + 0.5;
      if ((isBelow || isAbove) && !other.contains(el) && !el.contains(other)) { if (isBelow) found.below = true; if (isAbove) found.above = true; }
    });
    return found;
  }
  // The outline, clockwise from the top left.
  function controlShape(w, h, slant, cuts, beside) {
    // Always two points a corner, the same one twice where it's square or slanted, so any two shapes blend point for point (a glide).
    // A corner's cut takes at most its side's height, shared with the corner above or below it when both are cut.
    var s = Math.min(slant, w / 3), c = cuts.map(function (cut) { return Math.min(cut, h); });
    [[0, 3], [1, 2]].forEach(function (pair) { var sum = c[pair[0]] + c[pair[1]]; if (sum > h) { c[pair[0]] *= h / sum; c[pair[1]] *= h / sum; } });
    var corner = function (cut, a, b, sharp) { return cut >= LEAST_CUT_PX ? [a, b] : [sharp, sharp]; };
    return [].concat(
      beside.start ? [[s, 0], [s, 0]] : corner(c[0], [0, c[0]], [c[0], 0], [0, 0]),
      beside.end ? [[w, 0], [w, 0]] : corner(c[1], [w - c[1], 0], [w, c[1]], [w, 0]),
      beside.end ? [[w - s, h], [w - s, h]] : corner(c[2], [w, h - c[2]], [w - c[2], h], [w, h]),
      beside.start ? [[0, h], [0, h]] : corner(c[3], [c[3], h], [0, h - c[3]], [0, h]));
  }
  function controlOutline(el, w, h, as) {
    var beside = besides(el, as), cuts = fitCuts(el, w, h, as);
    var corners = [beside.start ? 0 : cuts[0], beside.end ? 0 : cuts[1], beside.end ? 0 : cuts[2], beside.start ? 0 : cuts[3]].map(function (cut) { return Math.min(cut, h); });
    [[0, 3], [1, 2]].forEach(function (pair) { var sum = corners[pair[0]] + corners[pair[1]]; if (sum > h) { corners[pair[0]] *= h / sum; corners[pair[1]] *= h / sum; } });
    el.cutCorners = corners;
    // Which ends slant, for CSS (data-slanted): an icon alone in a control centers in what shows of it, clear of a slant. Not for a glide's step.
    if (!as) { var slanted = ((beside.start ? "start " : "") + (beside.end ? "end" : "")).trim(); if ((el.getAttribute("data-slanted") || "") !== slanted) { if (slanted) el.setAttribute("data-slanted", slanted); else el.removeAttribute("data-slanted"); } }
    // A control's own parts (a switch's slab, data-cut-beside) keep their own slant; controls beside each other share --control-slant.
    return controlShape(w, h, el.hasAttribute("data-cut-beside") ? Number(el.getAttribute("data-cut-line")) || SLANT_PX : SLANT_PX, cuts, beside);
  }
  // The shape drawn: repeated points dropped, so every side drawn has a length.
  // An outline with no point on the one before it (within leastPx, 0.01 by default).
  function distinct(points, leastPx) {
    var least = leastPx || 0.01;
    return points.filter(function (p, i) { var q = points[(i + points.length - 1) % points.length]; return Math.abs(p[0] - q[0]) > least || Math.abs(p[1] - q[1]) > least; });
  }
  function cssPolygon(points) { return "polygon(" + points.map(function (p) { return p[0].toFixed(2) + "px " + p[1].toFixed(2) + "px"; }).join(", ") + ")"; }
  // The same outline moved inward by d on every side: each side's line shifted along its inner normal, meeting its neighbors.
  function insetShape(points, d) {
    if (!d) return points;
    var n = points.length, lines = points.map(function (p, i) {
      var q = points[(i + 1) % n], dx = q[0] - p[0], dy = q[1] - p[1], length = Math.hypot(dx, dy) || 1, nx = -dy / length, ny = dx / length;
      return { x: p[0] + nx * d, y: p[1] + ny * d, dx: dx, dy: dy, nx: nx, ny: ny };
    });
    return lines.map(function (line, i) {
      var before = lines[(i + n - 1) % n], cross = before.dx * line.dy - before.dy * line.dx;
      if (Math.abs(cross) < 1e-6) return [line.x, line.y];
      var t = ((line.x - before.x) * line.dy - (line.y - before.y) * line.dx) / cross;
      return [before.x + before.dx * t, before.y + before.dy * t];
    });
  }
  // Which way a side faces, of eight, so its band takes that side's light.
  var FACING = ["right", "top-right", "top", "top-left", "left", "bottom-left", "bottom", "bottom-right"];
  function facing(p, q) { var dx = q[0] - p[0], dy = q[1] - p[1], degrees = Math.atan2(dx, dy) * 180 / Math.PI; return FACING[((Math.round(degrees / 45) % 8) + 8) % 8]; }
  function cutLine(el) {
    var svg = el.querySelector(":scope > .cut-line");
    if (!svg) { svg = document.createElementNS(SVG, "svg"); svg.setAttribute("class", "cut-line"); svg.setAttribute("aria-hidden", "true"); svg.appendChild(document.createElementNS(SVG, "polygon")); el.insertBefore(svg, el.firstChild); }
    var poly = svg.querySelector("polygon"), bands = [], last = "";
    function list(points) { return points.map(function (p) { return p[0].toFixed(2) + "," + p[1].toFixed(2); }).join(" "); }
    // A glide: a part moving to another place (a switch's slab) blends from the shape it had there to its new one as it goes,
    // over the same time as its move, instead of taking the new shape before it has left.
    var glide = null;
    function draw() { runPass(drawLine); }
    function drawLine() {
      var size = sizeOf(el), w = size[0], h = size[1]; if (!w || !h) return;
      // Gliding, its two outlines (where it was, where it's going) are worked out once, at its size, not again each frame: they read the
      // page's layout, and only the blend between them changes.
      var sizeKey = w + "x" + h;
      if (glide && glide.sizeKey !== sizeKey) { glide.sizeKey = sizeKey; glide.toShape = controlOutline(el, w, h); glide.fromShape = controlOutline(el, w, h, glide.from); }
      var shape = glide ? glide.toShape : controlOutline(el, w, h);
      if (glide) {
        var t = Math.min(1, (performance.now() - glide.startMs) / glide.ms), eased = glide.ease ? glide.ease(t) : 1 - Math.pow(1 - t, 3), from = glide.fromShape;
        shape = shape.map(function (p, i) { return [from[i][0] + (p[0] - from[i][0]) * eased, from[i][1] + (p[1] - from[i][1]) * eased]; });
        // A mover that draws it each frame itself (isDriven: a switch's slab) has it drawn once a frame, not twice.
        if (t >= 1) glide = null; else if (!glide.isDriven) requestAnimationFrame(draw);
      }
      shape = distinct(shape);
      var key = w + "x" + h + ":" + list(shape);
      if (key === last) return;
      last = key;
      el.style.setProperty("--cut-shape", cssPolygon(shape));
      svg.setAttribute("viewBox", "0 0 " + w + " " + h);
      // Kept a moment past its last frame, so the light it lands with doesn't fade in either.
      if (glide) { svg.classList.add("is-gliding"); clearTimeout(svg.glideEnd); svg.glideEnd = setTimeout(function () { svg.classList.remove("is-gliding"); }, glide.ms + 200); }
      // Its line and light are drawn round the outline with no side under a pixel: a side shrinking away as it glides (a slant becoming a
      // corner) would turn its neighbors' light every which way in its last frames, then snap as it went.
      shape = distinct(shape, 1);
      poly.setAttribute("points", list(insetShape(shape, 1)));
      // data-cut-ring: a second outline set out around the shape by that many pixels, for a ring that mustn't touch what's inside (a check field's
      // keyboard focus, clear of its orange piece). It's drawn in the control's own shape, whatever its corners.
      var ringPx = Number(el.getAttribute("data-cut-ring")) || 0;
      if (ringPx) {
        var ring = svg.querySelector(".cut-ring");
        if (!ring) { ring = document.createElementNS(SVG, "polygon"); ring.setAttribute("class", "cut-ring"); svg.appendChild(ring); }
        ring.setAttribute("points", list(insetShape(shape, -ringPx)));
      }
      // The raised or carved light: a 1.5px band along each side. data-cut-inset moves it inward, inside an outline drawn round the edge.
      var from = Number(el.getAttribute("data-cut-inset")) || 0, outer = insetShape(shape, from), inner = insetShape(shape, from + 1.5);
      while (bands.length < shape.length) { var band = document.createElementNS(SVG, "path"); svg.insertBefore(band, poly); bands.push(band); }
      while (bands.length > shape.length) svg.removeChild(bands.pop());
      bands.forEach(function (band, i) {
        var j = (i + 1) % shape.length;
        band.setAttribute("class", "cut-band on-" + facing(shape[i], shape[j]));
        band.setAttribute("d", "M" + list([outer[i], outer[j], inner[j], inner[i]]) + "Z");
      });
    }
    draw();
    // redrawCut() draws it again; redrawCut({ from: { beside, ends }, ms, ease }) glides there from the shape those attributes gave, on its
    // mover's ease (a cubic ease-out by default), so its shape lands as it does.
    el.redrawCut = function (move) {
      if (move && move.ms > 0 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) glide = { from: move.from, ms: move.ms, ease: move.ease, isDriven: Boolean(move.isDriven), startMs: performance.now() };
      draw();
    };
    window.zaismaWatch.size(el, draw, runBatch);
    var holder = el.parentElement && el.parentElement.closest("[data-glass], [data-on-no-pane]"); if (holder && holder.hasAttribute("data-glass")) window.zaismaWatch.size(holder, draw, runBatch);
    // Where it sits can change without its size changing: once the fonts are in, the layout has settled.
    edgeDraws.set(el, draw); drawEdgeAfterFonts();
  }
  /*
   * Everything with an edge of its own follows the edge rule too, not only what's marked [data-cut-line]: a picture, a filled box,
   * anything bordered or shadowed, in a pane's corner takes the corner's cut at its gap, with no component asking for it. What has no
   * edge (words, a bare icon, a line or a mark thinner than EDGE_MIN_PX) is left alone, and so is anything already cut: a control
   * (its own shape), a pane (its own corners), what's inside either (clipped with it), and a shape of its own (a tag's clip-path).
   */
  var EDGE_MIN_PX = 6, edgedCuts = new Map();
  function isShadowSeen(shadow) {
    return shadow !== "none" && (shadow.match(/rgba?\\([^)]*\\)/g) || [""]).some(function (color) { var parts = color.match(/[\\d.]+/g); return !parts || parts.length < 4 || Number(parts[3]) > 0.04; });
  }
  function hasEdge(el, css) {
    if (/^(IMG|VIDEO|CANVAS|IFRAME)$/.test(el.tagName)) return true;
    // A shadow all in a clear color (a focus ring at rest, waiting to show) draws nothing, so it's no edge.
    if (css.backgroundImage !== "none" || isShadowSeen(css.boxShadow)) return true;
    var fill = css.backgroundColor.match(/[\\d.]+/g);
    if (fill && (fill.length < 4 || Number(fill[3]) > 0.04)) return true;
    return ["Top", "Right", "Bottom", "Left"].some(function (side) { return parseFloat(css["border" + side + "Width"]) > 0 && !/rgba\\(.*, 0\\)|transparent/.test(css["border" + side + "Color"]); });
  }
  // Edged things in a pane's corners, walking only into what reaches a corner: past the gaps where a corner's cut runs out, nothing is cut.
  function edgedIn(pane) {
    var found = [], p = rectOf(pane), reach = Math.max.apply(null, glassCorners(pane)) / (1 - Math.SQRT2 / 2);
    function nearCorner(r) {
      return [[r.left - p.left, r.top - p.top], [p.right - r.right, r.top - p.top], [p.right - r.right, p.bottom - r.bottom], [r.left - p.left, p.bottom - r.bottom]]
        .some(function (gaps) { return Math.max(0, gaps[0]) + Math.max(0, gaps[1]) < reach; });
    }
    function walk(el) {
      Array.prototype.forEach.call(el.children, function (child) {
        // A dialog (a sheet, a light box) opens over everything, out of the pane it's written in, so nothing in it takes that pane's corners.
        if (child instanceof SVGElement || child.matches("[data-glass], [data-cut-line], .edge, .cut-line, dialog")) return;
        var r = child.getBoundingClientRect();
        if (!r.width || !r.height || !nearCorner(r)) return;
        if (edgedCuts.has(child)) { found.push(child); return; }
        var css = getComputedStyle(child);
        // Words inline (a link, code in a sentence) are never cut: a link that wraps isn't one box for a shape to follow, and Safari lays a
        // clip-path on an inline box from another box than the one measured here, cutting the words themselves (a tray head's name, its
        // link in the pane's corner, lost its lower half).
        if (css.display === "contents" || css.display === "inline" || css.position === "fixed") return walk(child);
        if (css.clipPath === "none" && Math.min(r.width, r.height) >= EDGE_MIN_PX && hasEdge(child, css)) found.push(child);
        else walk(child);
      });
    }
    walk(pane);
    return found;
  }
  function cutEdged(el) {
    if (edgedCuts.has(el)) return;
    var last = null;
    function draw() { runPass(drawCut); }
    function drawCut() {
      var size = sizeOf(el), w = size[0], h = size[1];
      if (!w || !h || !el.isConnected) return;
      var shape = distinct(controlShape(w, h, 0, fitCuts(el, w, h), { start: false, end: false })), cut = shape.length > 4 ? cssPolygon(shape) : "";
      if (cut === last) return;
      last = cut;
      if (cut) { el.style.setProperty("--cut-shape", cut); el.style.clipPath = cut; }
      else { el.style.removeProperty("--cut-shape"); el.style.removeProperty("clip-path"); }
    }
    edgedCuts.set(el, draw); edgeDraws.set(el, draw);
    window.zaismaWatch.size(el, draw, runBatch);
    draw();
  }
  var PANE = "[data-glass]:not([data-cut-line])";
  function cutEdgedOnPage() {
    var panes = isEveryPaneDue ? Array.prototype.slice.call(document.querySelectorAll(PANE)) : Array.from(edgedPanes);
    isEveryPaneDue = false; edgedPanes.clear();
    runBatch(function () { panes.forEach(function (pane) { if (pane.isConnected) edgedIn(pane).forEach(cutEdged); }); });
  }
  // The page's settings (PageSettings), changed in place for the whole page or under one element. Only what's given changes:
  // { theme: "light" | "dark" | null } and { glass: { hueColor: "#rrggbb" | null } }, null going back to the default.
  window.zaismaSettings = {
    set: function (settings, element) {
      var target = element || document.documentElement;
      target.classList.add("eases-settings");
      if (settings.theme !== undefined) { if (settings.theme === "light" || settings.theme === "dark") target.setAttribute("data-theme-choice", settings.theme); else target.removeAttribute("data-theme-choice"); }
      var glass = settings.glass;
      if (glass && glass.hueColor !== undefined) { if (typeof glass.hueColor === "string" && /^#[0-9a-fA-F]{6}$/.test(glass.hueColor)) target.style.setProperty("--glass-hue", glass.hueColor); else target.style.removeProperty("--glass-hue"); }
    },
    read: function (element) {
      var target = element || document.documentElement, hue = target.style.getPropertyValue("--glass-hue").trim();
      return { theme: target.getAttribute("data-theme-choice") || null, glass: { hueColor: hue || null } };
    }
  };
  window.zaismaGlass = glass;
  window.zaismaCutLine = cutLine;
  // How the page was last used, keyboard or pointer (a mouse, a touch, a pen): a ring only ever shows for the keyboard (:focus-visible), so a sheet
  // opened by a press focuses itself, not its first button, and only one opened from the keyboard focuses its first control (LAYERS_SCRIPT).
  window.zaismaInput = (function () {
    var isKeyboard = false;
    document.addEventListener("keydown", function (event) { if (!/^(Shift|Control|Alt|Meta|AltGraph|CapsLock)$/.test(event.key)) isKeyboard = true; }, true);
    ["pointerdown", "mousedown", "touchstart"].forEach(function (name) { document.addEventListener(name, function () { isKeyboard = false; }, true); });
    return { isKeyboard: function () { return isKeyboard; } };
  })();
  var done = typeof WeakSet === "function" ? new WeakSet() : { has: function () { return false; }, add: function () {} };
  function apply(root) {
    if (!root.querySelectorAll) return;
    var slabs = Array.prototype.slice.call(root.querySelectorAll("[data-glass]")), lines = Array.prototype.slice.call(root.querySelectorAll("[data-cut-line]"));
    if (root.matches && root.matches("[data-glass]")) slabs.push(root);
    if (root.matches && root.matches("[data-cut-line]")) lines.push(root);
    slabs.forEach(function (el) {
      if (done.has(el)) return; done.add(el);
      // Read as it's drawn, so a pane whose corners change (the home's pane, a tray's head only while its tray shows) is cut anew when it next changes size.
      // A slab with no corners of its own (all 0: a picture's frame) inside a pane follows the edge rule like anything else with an edge.
      var draw = glass(el, function () {
        var own = corners(el, "pane");
        if (own.some(function (cut) { return cut > 0; }) || !holderOf(el)) return own;
        var size = sizeOf(el);
        return fitCuts(el, size[0], size[1]);
      });
      if (/^[0\\s]+$/.test(el.getAttribute("data-glass-corners") || "")) { edgeDraws.set(el, draw); drawEdgeAfterFonts(); }
    });
    // A control made of glass is drawn by glass, from the same edge rule.
    lines.forEach(function (el) {
      if (done.has(el) || el.hasAttribute("data-glass")) return; done.add(el);
      cutLine(el);
    });
  }
  runBatch(function () { apply(document); });
  window.zaismaWatch.page(function (changes) { runBatch(function () { changes.forEach(function (change) { change.addedNodes.forEach(apply); }); }); });
  // Edged things are found once the page has laid out, and again whenever something may have moved them into a corner: in the panes round
  // a change and in it, in a pane that changed size, and in every pane once the window's width changes or a font arrives.
  var edgedTimer = 0, edgedPanes = new Set(), isEveryPaneDue = false;
  function walkSoon() { clearTimeout(edgedTimer); edgedTimer = setTimeout(cutEdgedOnPage, 50); }
  function findEdgedSoon(changes) {
    if (Array.isArray(changes)) changes.forEach(function (change) { panesAround(change.target).forEach(function (pane) { edgedPanes.add(pane); }); });
    else isEveryPaneDue = true;
    walkSoon();
  }
  function paneResized(pane) { edgedPanes.add(pane); walkSoon(); }
  function panesAround(target) {
    if (target.nodeType !== 1) return [];
    var found = Array.prototype.slice.call(target.querySelectorAll(PANE)), holder = target.closest(PANE);
    while (holder) { found.push(holder); holder = holder.parentElement && holder.parentElement.closest(PANE); }
    return found;
  }
  findEdgedSoon();
  window.zaismaWatch.page(findEdgedSoon);
})();
`;
