import { GLASS_LIGHT_PASS, MOST_GLASS_PANE_COUNT, SHADER_HELPERS, ZAISMA_SHADER } from "./shaders.ts";

/**
 * Backdrops: every canvas[data-backdrop] on a page. "shader" draws a shader background (shaders.ts: a mainImage function, the page's own in
 * data-backdrop-shader, or Zaisma's), "scene" leaves the drawing to the page: each frame the canvas gets a backdrop-frame event whose detail is
 * { timeS, colors: { base, a, b, c, isDark }, widthPx, heightPx }, and the page draws its 3D scene into the canvas then.
 * Either way this keeps the canvas sized to its box, follows the theme (a shader's iDark eases from one to the other), runs at most 30
 * frames a second, stops while the page is hidden or the canvas is out of view, and under reduced motion draws one still frame. A shader
 * is drawn small (about half the screen's pixels, less on a phone) and gets fewer pixels, then a still frame, on a device that can't keep
 * up. Without WebGL a shader backdrop keeps its CSS gradient in the theme's colors.
 */
export const BACKDROP_SCRIPT = `/* backdrop */(function () {
  var HELPERS = ${JSON.stringify(SHADER_HELPERS)}, ZAISMA = ${JSON.stringify(ZAISMA_SHADER)}, GLASS_LIGHT = ${JSON.stringify(GLASS_LIGHT_PASS)}, PANE_LIMIT = ${MOST_GLASS_PANE_COUNT};
  var VERTEX = "attribute vec2 corner; void main() { gl_Position = vec4(corner, 0.0, 1.0); }";
  var still = window.matchMedia("(prefers-reduced-motion: reduce)");
  var layers = [], lastMs = 0, running = false;
  function rgb(value) {
    var digits = value.trim().replace("#", "");
    if (digits.length === 3) digits = digits.split("").map(function (d) { return d + d; }).join("");
    var n = parseInt(digits, 16) || 0;
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }
  function readColors(el) {
    var css = getComputedStyle(el);
    return { base: rgb(css.getPropertyValue("--backdrop-base")), a: rgb(css.getPropertyValue("--backdrop-a")), b: rgb(css.getPropertyValue("--backdrop-b")),
      c: rgb(css.getPropertyValue("--backdrop-c")), isDark: /dark/.test(css.colorScheme || "") };
  }
  /*
   * Where the glass is. Each backdrop knows the pieces of glass over it (data-glass, not a control's), the largest PANE_LIMIT in view:
   * the list is read again when the page changes (elements come or go, open or shut, the theme turns), their rectangles when it scrolls,
   * resizes or a piece of glass changes size; never every frame. A piece of glass is over the backdrop of the nearest box holding one.
   */
  var isListStale = true, isPlaceStale = true, candidates = [], watched = typeof WeakSet === "function" ? new WeakSet() : null;
  function markPlaceStale() { isPlaceStale = true; }
  function hostOf(el) { return el.closest(":has(> .backdrop)"); }
  function readList() {
    isListStale = false; isPlaceStale = true;
    candidates = Array.prototype.filter.call(document.querySelectorAll("[data-glass]:not([data-cut-line])"), function (el) {
      var css = getComputedStyle(el);
      el.glassIsSmoked = /dark/.test(css.colorScheme || "");
      return css.visibility !== "hidden" && css.display !== "none" && Number(css.opacity) > 0.05;
    });
    candidates.forEach(function (el) { el.glassHost = hostOf(el); if (watched && !watched.has(el)) { watched.add(el); window.zaismaWatch.size(el, markPlaceStale); } });
  }
  function glassCuts(el, width, height) {
    var short = Math.min(width, height);
    var isNarrow = window.matchMedia("(max-width: 760px)").matches;
    return (el.getAttribute("data-glass-corners") || "24 20 24 20").trim().split(/ +/).map(function (cut) { return Math.min(isNarrow ? Math.round((Number(cut) || 0) * 0.8) : Number(cut) || 0, Math.round(short * 0.3)); });
  }
  // Each layer's panes, in its canvas's pixels from its bottom left, smallest first (a pane over a tray bends the light under it).
  function placeGlass(layer) {
    var box = layer.canvas.getBoundingClientRect(), host = layer.canvas.parentElement, scale = layer.canvas.width / Math.max(1, box.width), found = [];
    candidates.forEach(function (el) {
      if (el.glassHost !== host) return;
      var r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 24 || r.right < box.left || r.left > box.right || r.bottom < box.top || r.top > box.bottom) return;
      found.push({ el: el, r: r, area: r.width * r.height });
    });
    found.sort(function (a, b) { return b.area - a.area; });
    found = found.slice(0, PANE_LIMIT).sort(function (a, b) { return a.area - b.area; });
    var rects = new Float32Array(PANE_LIMIT * 4), cuts = new Float32Array(PANE_LIMIT * 4);
    found.forEach(function (pane, i) {
      var r = pane.r, c = glassCuts(pane.el, r.width, r.height);
      rects.set([(r.left - box.left) * scale, (box.bottom - r.bottom) * scale, (r.right - box.left) * scale, (box.bottom - r.top) * scale], i * 4);
      cuts.set([c[0] * scale, c[1] * scale, c[2] * scale, c[3] * scale + (pane.el.glassIsSmoked ? 4096 : 0)], i * 4);
    });
    layer.glass = { rects: rects, cuts: cuts, count: found.length, scale: scale, box: box, els: found.map(function (pane) { return pane.el; }) };
    layer.isDrawn = false;
  }
  /*
   * Glass that adapts to a page's own shader (data-adapts-glass): after the shader's first frame, the colors behind each pane are read,
   * and the pane takes light glass (dark words) or smoked glass (light words), whichever can be thinner while every word keeps its
   * contrast (4.5:1 for the quietest, 6:1 for the main ones) against the harsh side of what's behind (its darker quarter under light glass,
   * its brighter quarter under smoked), tinted a little with what's behind. Read again when the canvas changes size or the theme turns.
   */
  function luminance(c) { var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); }
  function contrast(a, b) { var la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
  function blend(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function thinnest(kind, colors) {
    var sorted = colors.slice().sort(function (a, b) { return luminance(a) - luminance(b); });
    var harsh = kind.isSmoked ? sorted[Math.floor(sorted.length * 0.75)] : sorted[Math.floor(sorted.length * 0.25)];
    for (var share = 0.3; share <= 0.95; share += 0.02) {
      var seen = blend(harsh, kind.base, share), ink = kind.isSmoked ? [247, 249, 252] : [20, 23, 28], quiet = kind.isSmoked ? blend(seen, ink, 0.7) : [89, 96, 106];
      if (contrast(seen, quiet) >= 4.5 && contrast(seen, ink) >= 6) return share;
    }
    return 0.95;
  }
  function adaptGlass(gl, layer) {
    var glass = layer.glass; if (!glass) return;
    glass.els.forEach(function (el, i) {
      var x = Math.max(0, Math.round(glass.rects[i * 4])), y = Math.max(0, Math.round(glass.rects[i * 4 + 1]));
      var w = Math.min(gl.drawingBufferWidth - x, Math.round(glass.rects[i * 4 + 2]) - x), h = Math.min(gl.drawingBufferHeight - y, Math.round(glass.rects[i * 4 + 3]) - y);
      if (w < 2 || h < 2) return;
      var pixels = new Uint8Array(w * h * 4), colors = [], step = 4 * Math.max(1, Math.floor(w * h / 600));
      gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      for (var p = 0; p < pixels.length; p += step) colors.push([pixels[p], pixels[p + 1], pixels[p + 2]]);
      var sum = colors.reduce(function (s, c) { return [s[0] + c[0], s[1] + c[1], s[2] + c[2]]; }, [0, 0, 0]), average = sum.map(function (v) { return v / colors.length; });
      var light = { isSmoked: false, base: blend([255, 255, 255], average, 0.1) }, smoked = { isSmoked: true, base: blend([12, 15, 20], average, 0.3) };
      var lightShare = thinnest(light, colors), smokedShare = thinnest(smoked, colors), pick = lightShare <= smokedShare ? light : smoked;
      // Its own kind of glass, whatever the page's theme: smoked, or fixed light.
      el.classList.toggle("smoke", pick.isSmoked);
      if (pick.isSmoked) el.removeAttribute("data-theme-choice"); else el.setAttribute("data-theme-choice", "light");
      el.style.setProperty("--glass-tint", "rgba(" + pick.base.map(Math.round).join(", ") + ", " + Math.min(lightShare, smokedShare).toFixed(2) + ")");
    });
  }
  function shaderDrawer(canvas) {
    var gl = canvas.getContext("webgl", { antialias: false, depth: false, stencil: false, alpha: false, powerPreference: "low-power" });
    if (!gl) return null;
    function compile(kind, source) {
      var shader = gl.createShader(kind); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { console.warn("Backdrop shader:", gl.getShaderInfoLog(shader)); return null; }
      return shader;
    }
    var precision = "#ifdef GL_FRAGMENT_PRECISION_HIGH\\nprecision highp float;\\n#else\\nprecision mediump float;\\n#endif\\n";
    var head = precision + "uniform vec3 iResolution;\\nuniform float iTime;\\nuniform float iDark;\\n" + HELPERS + (canvas.getAttribute("data-backdrop-shader") || ZAISMA);
    // Every shader gets the glass pass round its mainImage; a device that can't build it gets the shader alone.
    function build(withPass) {
      var vertex = compile(gl.VERTEX_SHADER, VERTEX), fragment = compile(gl.FRAGMENT_SHADER, head + (withPass ? GLASS_LIGHT : "\\nuniform vec2 zaismaViewOffset;\\nvoid main() { vec4 color; mainImage(color, gl_FragCoord.xy + zaismaViewOffset); gl_FragColor = vec4(color.rgb, 1.0); }"));
      if (!vertex || !fragment) return null;
      var made = gl.createProgram(); gl.attachShader(made, vertex); gl.attachShader(made, fragment); gl.linkProgram(made);
      return gl.getProgramParameter(made, gl.LINK_STATUS) ? made : null;
    }
    var program = build(true), hasPass = Boolean(program);
    if (!program) program = build(false);
    if (!program) return null;
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var corner = gl.getAttribLocation(program, "corner"); gl.enableVertexAttribArray(corner); gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
    var at = {}; ["iResolution", "iTime", "iDark", "zaismaPanes", "zaismaPaneCuts", "zaismaPaneCount", "zaismaPixel", "zaismaViewOffset"].forEach(function (name) { at[name] = gl.getUniformLocation(program, name); });
    return function (timeS, colors, layer) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      // A framed backdrop is a window onto a scene 1.8 times its size, centered on it: a shader sizes everything to its screen, so in a
      // small box its finest details (snowflakes, stars, rain) would shrink to a pixel and shimmer. Most of the picture still shows.
      var isWindow = canvas.classList.contains("is-framed"), sceneShare = isWindow ? 1.8 : 1;
      var sceneWidth = canvas.width * sceneShare, sceneHeight = canvas.height * sceneShare;
      gl.uniform3f(at.iResolution, sceneWidth, sceneHeight, 1); gl.uniform1f(at.iTime, timeS); gl.uniform1f(at.iDark, colors.darkShare);
      gl.uniform2f(at.zaismaViewOffset, (sceneWidth - canvas.width) / 2, (sceneHeight - canvas.height) / 2);
      if (!hasPass) { gl.drawArrays(gl.TRIANGLES, 0, 3); return; }
      var glass = layer.glass || { rects: new Float32Array(PANE_LIMIT * 4), cuts: new Float32Array(PANE_LIMIT * 4), count: 0, scale: 1, box: canvas.getBoundingClientRect() };
      gl.uniform4fv(at.zaismaPanes, glass.rects);
      var isFirstWithGlass = canvas.hasAttribute("data-adapts-glass") && !layer.isGlassAdapted && glass.count > 0; gl.uniform4fv(at.zaismaPaneCuts, glass.cuts); gl.uniform1f(at.zaismaPaneCount, glass.count); gl.uniform1f(at.zaismaPixel, glass.scale);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // Read straight after the frame is drawn, while it's still in the buffer.
      if (isFirstWithGlass) { layer.isGlassAdapted = true; adaptGlass(gl, layer); }
    };
  }
  // A change of theme fades the backdrop over the same half second as the glass's, so the two never part for a frame.
  var FADE_MS = 500;
  function mix(from, to, t) { return from.map(function (value, i) { return value + (to[i] - value) * t; }); }
  function shownColors(layer, nowMs) {
    var t = still.matches || !layer.from ? 1 : Math.min(1, (nowMs - layer.fadeStartMs) / FADE_MS);
    if (t >= 1) { layer.from = null; return Object.assign({}, layer.target, { darkShare: layer.target.isDark ? 1 : 0 }); }
    var eased = t * t * (3 - 2 * t), from = layer.from, to = layer.target;
    return { base: mix(from.base, to.base, eased), a: mix(from.a, to.a, eased), b: mix(from.b, to.b, eased), c: mix(from.c, to.c, eased), isDark: eased < 0.5 ? from.isDark : to.isDark,
      darkShare: (from.darkShare !== undefined ? from.darkShare : from.isDark ? 1 : 0) + ((to.isDark ? 1 : 0) - (from.darkShare !== undefined ? from.darkShare : from.isDark ? 1 : 0)) * eased };
  }
  function draw(layer, nowMs) {
    // The wall clock, not the page's own: moving to another page, the backdrop carries on where it was instead of starting over.
    var timeS = still.matches ? 20 : (Date.now() / 1000) % 3600;
    layer.colors = shownColors(layer, nowMs);
    if (layer.drawShader) layer.drawShader(timeS, layer.colors, layer);
    else layer.canvas.dispatchEvent(new CustomEvent("backdrop-frame", { detail: { timeS: timeS, colors: layer.colors, widthPx: layer.canvas.width, heightPx: layer.canvas.height } }));
    layer.isDrawn = !layer.from;
  }
  function frame(nowMs) {
    requestAnimationFrame(frame);
    // At most 30 frames a second, but at once when the glass over it has moved (a scroll), so what's under a pane never trails it.
    if (document.hidden || (nowMs - lastMs < 33 && !isPlaceStale)) return;
    var gapMs = nowMs - lastMs; lastMs = nowMs;
    if (isListStale) readList();
    var isMoved = isPlaceStale; isPlaceStale = false;
    layers.forEach(function (layer) {
      if (!layer.isInView) return;
      if (layer.drawShader && (isMoved || !layer.glass)) placeGlass(layer);
      // Still (reduced motion, or held on a slow device), it's drawn again only when the glass over it moves.
      if ((layer.isHeld || still.matches) && layer.isDrawn) return;
      // A shader on a device that can't keep up gets fewer pixels, then holds a still frame.
      if (layer.drawShader && gapMs < 1000) {
        layer.slowS = gapMs > 50 ? layer.slowS + gapMs / 1000 : Math.max(0, layer.slowS - gapMs / 2000);
        if (layer.slowS > 1.5) { layer.slowS = 0; if (layer.scale > 0.26) { layer.scale *= 0.75; layer.size(); } else layer.isHeld = true; }
      }
      draw(layer, nowMs);
    });
  }
  // The colors are read again whenever the theme might have changed; the fade starts at once, from what's showing, and only when they did change.
  function refresh() {
    var nowMs = performance.now(); isListStale = true;
    layers.forEach(function (layer) {
      var next = readColors(layer.canvas);
      if (JSON.stringify(next) === JSON.stringify(layer.target)) return;
      layer.from = layer.colors; layer.target = next; layer.fadeStartMs = nowMs; layer.isDrawn = false; layer.isGlassAdapted = false;
      if (layer.isInView) draw(layer, nowMs);
    });
  }
  function setUp(canvas) {
    if (canvas.backdropLayer) return;
    var isScene = canvas.getAttribute("data-backdrop") === "scene", isPhone = window.matchMedia("(max-width: 760px)").matches, sharpness = Math.min(window.devicePixelRatio || 1, isScene ? 2 : 1.5);
    // A shader filling the window is soft, so it's drawn at about half the screen's pixels (less on a phone). One framed in a small box
    // (the gallery's examples) gets the screen's sharpness: at half, its finest details (snowflakes, stars) would be a pixel or two
    // and shimmer as they move. A scene gets the screen's sharpness, up to 2x.
    var isFramed = canvas.classList.contains("is-framed");
    var layer = { canvas: canvas, isInView: true, isDrawn: false, isHeld: false, slowS: 0, target: readColors(canvas), from: null, scale: isScene || isFramed ? sharpness : (isPhone ? 0.4 : 0.55) * sharpness };
    if (!isScene) { layer.drawShader = shaderDrawer(canvas); if (!layer.drawShader) return; canvas.classList.add("is-drawn"); }
    canvas.backdropLayer = layer;
    // Resizing a canvas clears it, so it's drawn again at once: it never shows a frame of the plain color under it.
    layer.size = function () {
      var width = Math.max(2, Math.round(canvas.clientWidth * layer.scale)), height = Math.max(2, Math.round(canvas.clientHeight * layer.scale));
      if (width === canvas.width && height === canvas.height) return;
      canvas.width = width; canvas.height = height; layer.isDrawn = false; layer.glass = null; layer.isGlassAdapted = false;
      if (canvas.backdropLayer) draw(layer, performance.now());
    };
    layer.size();
    window.zaismaWatch.size(canvas, layer.size);
    if (window.IntersectionObserver) new IntersectionObserver(function (entries) { layer.isInView = entries[entries.length - 1].isIntersecting; }).observe(canvas);
    layers.push(layer);
    // The first frame is drawn at once, so the canvas never shows empty while it waits for the next animation frame.
    draw(layer, performance.now());
    if (!running) { running = true; requestAnimationFrame(frame); }
  }
  document.querySelectorAll("canvas[data-backdrop]").forEach(setUp);
  // The glass's places: a scroll or resize moves them, and the page's own changes may add, remove, open or shut a piece of glass.
  window.zaismaWatch.scroll(markPlaceStale);
  window.zaismaWatch.resize(markPlaceStale);
  // Only changes to glass itself count: a class on a tab or the rail changing as you point doesn't make the list stale.
  function hasGlass(node) { return node.nodeType === 1 && (node.hasAttribute("data-glass") || Boolean(node.querySelector("[data-glass]"))); }
  window.zaismaWatch.page(function (changes) {
    if (isListStale) return;
    isListStale = changes.some(function (change) {
      return change.type === "attributes" ? change.target.hasAttribute("data-glass") : Array.prototype.some.call(change.addedNodes, hasGlass) || Array.prototype.some.call(change.removedNodes, hasGlass);
    });
  });
  document.addEventListener("toggle", function () { isListStale = true; }, true);
  // The theme can change in place (a data-theme-choice switch, or the system's), and the colors follow it.
  new MutationObserver(refresh).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["data-theme-choice"] });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", refresh);
  still.addEventListener("change", refresh);
})();
`;
