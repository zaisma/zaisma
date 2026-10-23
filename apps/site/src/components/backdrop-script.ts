import { SHADER_HEAD, SHADER_LIMITS, SHADER_UPSCALE_SOURCE, SHADER_VERTEX_SOURCE } from "@zaisma/core";
import { BACKDROP_CANDIDATES, GLASS_LIGHT_PASS, MOST_GLASS_PANE_COUNT, SHADER_HELPERS, ZAISMA_SHADER } from "./shaders.ts";

/**
 * Backdrops: every [data-backdrop] on a page. On a canvas, "shader" draws a shader background (shaders.ts: a mainImage function, the page's own in
 * data-backdrop-shader, or Zaisma's), "scene" leaves the drawing to the page: each frame the canvas gets a backdrop-frame event whose detail is
 * { timeS, colors: { base, a, b, c, isDark }, widthPx, heightPx }, and the page draws its 3D scene into the canvas then. A game's own background
 * (backgrounds.ts) is "frame", an iframe of its shader runner on the game's site, which is told where the glass over it is and whether the
 * page is idle ({ panes, isIdle }), or "picture", an img; either measures its glass (data-adapts-glass) from the still in data-backdrop-still
 * (or the picture), never the frame. Either way this keeps the canvas sized to its box, follows the theme (a shader's iDark eases from one to
 * the other), runs at most 30 frames a second (15 after a minute with no input on the page, 30 again on the first), stops while the page is
 * hidden or the canvas is out of view, and under reduced motion draws one still frame. A shader is drawn in WebGL2 as a game's is (SHADER_HEAD
 * and the glass pass round its mainImage, with iDark and SHADER_HELPERS besides), at fewer pixels (about a quarter of the screen's, less on
 * a phone), then sharpened as it's scaled up to its canvas (SHADER_UPSCALE_SOURCE); it gets fewer pixels, then a still frame, on a device that
 * can't keep up. Without WebGL2 a shader backdrop keeps its CSS gradient in the theme's colors.
 */
export const BACKDROP_SCRIPT = `/* backdrop */(function () {
  var HELPERS = ${JSON.stringify(SHADER_HELPERS)}, ZAISMA = ${JSON.stringify(ZAISMA_SHADER)}, GLASS_LIGHT = ${JSON.stringify(GLASS_LIGHT_PASS)}, PANE_LIMIT = ${MOST_GLASS_PANE_COUNT};
  // Round only: ?backdrop=shade|satin (or =current) picks a candidate for Zaisma's own on the local preview, remembered while browsing.
  (function () { try { if (!/^(localhost|127\\.0\\.0\\.1)$/.test(location.hostname)) return; var CANDIDATES = ${JSON.stringify(BACKDROP_CANDIDATES)};
    var picked = new URLSearchParams(location.search).get("backdrop"); if (picked) sessionStorage.setItem("backdrop", picked); picked = sessionStorage.getItem("backdrop");
    if (picked && CANDIDATES[picked]) ZAISMA = CANDIDATES[picked]; } catch (error) {} })();
  var HEAD = ${JSON.stringify(SHADER_HEAD)}, VERTEX = ${JSON.stringify(SHADER_VERTEX_SOURCE)}, UPSCALE = ${JSON.stringify(SHADER_UPSCALE_SOURCE)};
  var DRAW_SHARE = ${SHADER_LIMITS.runtimeDrawShareNumber}, UPSCALE_NUMBER = ${SHADER_LIMITS.runtimeUpscaleNumber}, IDLE_AFTER_MS = ${SHADER_LIMITS.runtimeIdleTimeoutSec * 1000};
  var FRAME_GAP_MS = ${Math.round(1000 / SHADER_LIMITS.runtimeMaximumFps)}, IDLE_FRAME_GAP_MS = ${Math.round(1000 / SHADER_LIMITS.runtimeIdleFramesPerSec)};
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
      el.glassHost = hostOf(el);
      if (el.glassHost && el.glassHost.shownGlass) setGlass(el, el.glassHost.shownGlass);
      var css = getComputedStyle(el);
      el.glassIsSmoked = /dark/.test(css.colorScheme || "");
      return css.visibility !== "hidden" && css.display !== "none" && Number(css.opacity) > 0.05;
    });
    candidates.forEach(function (el) { if (watched && !watched.has(el)) { watched.add(el); window.zaismaWatch.size(el, markPlaceStale); } });
  }
  // The pane's cuts as the edge rule reads them (GLASS_SCRIPT's window.zaismaCorners, from data-glass-corners), each at most 30% of its short side.
  function glassCuts(el, width, height) {
    var short = Math.min(width, height);
    return window.zaismaCorners(el, "pane").map(function (cut) { return Math.min(cut, Math.round(short * 0.3)); });
  }
  // Each layer's panes, in its shader's pixels from its bottom left (a frame's in CSS pixels), smallest first (a pane over a tray bends the light under it).
  function placeGlass(layer) {
    var box = layer.canvas.getBoundingClientRect(), host = layer.canvas.parentElement, scale = layer.isOuter ? 1 : (layer.drawnWidth || layer.canvas.width) / Math.max(1, box.width), found = [];
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
   * Glass that adapts to its backdrop (data-adapts-glass): the colors of the whole backdrop are read once (a page's own shader after its
   * first frame, a game's frame or picture from its still), and every piece of glass over that backdrop takes the same glass: light (dark
   * words) or smoked (light words), whichever can be thinner while every word keeps its contrast (4.5:1 for the quietest, 6:1 for the
   * main ones) against the harsh side of the backdrop (its darker quarter under light glass, its brighter quarter under smoked), tinted a
   * little with it. One choice for all the glass over a backdrop (the whole page, over a page's), never a pane's own from what happens to
   * be under it, so a game's glass stays the same whatever its shader shows in a frame. Read again only when the theme turns or the still
   * changes; glass that appears later gets it too.
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
  // The glass from the backdrop's colors.
  function pickGlass(colors) {
    var sum = colors.reduce(function (s, c) { return [s[0] + c[0], s[1] + c[1], s[2] + c[2]]; }, [0, 0, 0]), average = sum.map(function (v) { return v / colors.length; });
    var light = { isSmoked: false, base: blend([255, 255, 255], average, 0.1) }, smoked = { isSmoked: true, base: blend([12, 15, 20], average, 0.3) };
    var lightShare = thinnest(light, colors), smokedShare = thinnest(smoked, colors), pick = lightShare <= smokedShare ? light : smoked;
    return { isSmoked: pick.isSmoked, tint: "rgba(" + pick.base.map(Math.round).join(", ") + ", " + Math.min(lightShare, smokedShare).toFixed(2) + ")" };
  }
  // A piece of glass takes the page's glass, whatever the page's theme: smoked, or fixed light.
  function setGlass(el, pick) {
    if (el.glassPick === pick) return;
    el.glassPick = pick;
    el.classList.toggle("smoke", pick.isSmoked);
    if (pick.isSmoked) el.removeAttribute("data-theme-choice"); else el.setAttribute("data-theme-choice", "light");
    el.style.setProperty("--glass-tint", pick.tint);
  }
  function showGlass(layer, colors) { if (colors.length) showPick(layer, pickGlass(colors)); }
  function showPick(layer, pick) {
    var host = layer.canvas.parentElement; if (!host) return;
    host.shownGlass = pick; isListStale = true;
    host.querySelectorAll("[data-glass]:not([data-cut-line])").forEach(function (el) { if (hostOf(el) === host) setGlass(el, host.shownGlass); });
  }
  function sample(pixels) {
    var colors = [], step = 4 * Math.max(1, Math.floor(pixels.length / 4 / 2400));
    for (var p = 0; p < pixels.length; p += step) colors.push([pixels[p], pixels[p + 1], pixels[p + 2]]);
    return colors;
  }
  function adaptGlass(gl, layer, w, h) {
    var pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    showGlass(layer, sample(pixels));
  }
  // A game's frame or picture: its glass is measured from the whole still, the same at every size of window.
  function adaptGlassFromStill(layer) {
    var picture = layer.still; if (!picture || !picture.naturalWidth) return;
    var board = document.createElement("canvas"), share = Math.min(1, 160 / Math.max(picture.naturalWidth, picture.naturalHeight));
    board.width = Math.max(2, Math.round(picture.naturalWidth * share)); board.height = Math.max(2, Math.round(picture.naturalHeight * share));
    var context = board.getContext("2d", { willReadFrequently: true });
    context.drawImage(picture, 0, 0, board.width, board.height);
    layer.isGlassAdapted = true;
    try { showGlass(layer, sample(context.getImageData(0, 0, board.width, board.height).data)); } catch (error) { /* a still from a site that doesn't allow reading it */ }
  }
  // A game's frame is told where the glass over it is, in its own CSS pixels from its bottom left, and whether the page is idle, since it
  // never sees the page's input (apps/games/src/background.ts).
  function tellFrame(layer) {
    var glass = layer.glass, frameWindow = layer.canvas.contentWindow; if (!glass || !frameWindow) return;
    var panes = [];
    for (var i = 0; i < glass.count; i++) {
      var cutWord = glass.cuts[i * 4 + 3], isSmoked = cutWord >= 4096;
      panes.push({ rect: Array.prototype.slice.call(glass.rects, i * 4, i * 4 + 4), cuts: [glass.cuts[i * 4], glass.cuts[i * 4 + 1], glass.cuts[i * 4 + 2], isSmoked ? cutWord - 4096 : cutWord], isSmoked: isSmoked });
    }
    try { frameWindow.postMessage({ panes: panes, isIdle: isIdle }, new URL(layer.canvas.src).origin); } catch (error) { /* a frame without its page yet */ }
  }
  /*
   * Idle: after a minute with no input on the page, backdrops draw 15 frames a second instead of 30, and a game's frame is told so; the
   * first input brings 30 back at once.
   */
  var isIdle = false, lastInputMs = Date.now();
  function noteInput() {
    lastInputMs = Date.now();
    if (!isIdle) return;
    isIdle = false; tellFramesIdle();
  }
  function tellFramesIdle() { layers.forEach(function (layer) { if (layer.kind === "frame") tellFrame(layer); }); }
  ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "scroll"].forEach(function (name) { window.addEventListener(name, noteInput, { passive: true, capture: true }); });
  /*
   * Every shader on the page draws in one WebGL2 context, off screen, and each frame is copied into its own canvas. A browser keeps only
   * about 16 contexts at once (across the site's tabs and frames) and takes the oldest away past that, which a page of many backdrops (the
   * gallery) would reach, taking the page's own backdrop and its 3D scene with it. One context never does; a shader out of view just isn't
   * drawn, and if the context is lost anyway every canvas keeps its last frame until it's back. A shader draws into one shared picture at
   * fewer pixels (in its bottom left), and the upscale draws that onto the board at its canvas's size.
   */
  var shared = null;
  function sharedContext() {
    if (shared) return shared.isLost ? null : shared;
    var board = document.createElement("canvas"); board.width = 2; board.height = 2;
    var gl = board.getContext("webgl2", { antialias: false, depth: false, stencil: false, alpha: false, powerPreference: "low-power" });
    if (!gl) return null;
    // Shaders compile in the background where the browser can (KHR_parallel_shader_compile): a backdrop draws once its program is ready.
    shared = { board: board, gl: gl, programs: {}, isLost: false, parallel: gl.getExtension("KHR_parallel_shader_compile") };
    function prepare() {
      gl.bindVertexArray(gl.createVertexArray());
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      shared.vertex = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(shared.vertex, VERTEX); gl.compileShader(shared.vertex);
      shared.upscale = { status: "compiling", names: ["zaismaDrawn", "zaismaDrawnSize", "zaismaCanvasSize"] }; startBuild(shared.upscale, UPSCALE);
      shared.drawn = { texture: gl.createTexture(), framebuffer: gl.createFramebuffer(), widthPx: 0, heightPx: 0 };
    }
    prepare();
    board.addEventListener("webglcontextlost", function (event) { event.preventDefault(); shared.isLost = true; });
    board.addEventListener("webglcontextrestored", function () { shared.programs = {}; shared.isLost = false; prepare(); layers.forEach(function (layer) { layer.isDrawn = false; }); });
    return shared;
  }
  // A program set compiling and linking; settle() reads how it went once it's done, without waiting on it where the browser can.
  function startBuild(built, fragmentSource) {
    var gl = shared.gl, fragment = gl.createShader(gl.FRAGMENT_SHADER), program = gl.createProgram();
    gl.shaderSource(fragment, fragmentSource); gl.compileShader(fragment);
    gl.attachShader(program, shared.vertex); gl.attachShader(program, fragment); gl.bindAttribLocation(program, 0, "corner"); gl.linkProgram(program);
    built.pending = { program: program, fragment: fragment };
  }
  function settle(built) {
    if (built.status !== "compiling") return built.status === "ready";
    var gl = shared.gl, pending = built.pending;
    if (shared.parallel && !gl.getProgramParameter(pending.program, shared.parallel.COMPLETION_STATUS_KHR)) return false;
    if (gl.getProgramParameter(pending.program, gl.LINK_STATUS)) {
      built.program = pending.program; built.status = "ready"; built.at = {};
      built.names.forEach(function (name) { built.at[name] = gl.getUniformLocation(pending.program, name); });
    } else {
      console.warn("Backdrop shader:", gl.getShaderInfoLog(pending.fragment) || gl.getProgramInfoLog(pending.program));
      gl.deleteProgram(pending.program);
      built.status = "failed";
      // The glass pass didn't build here: the shader alone instead.
      if (built.plainSource) { var plainSource = built.plainSource; built.plainSource = null; built.status = "compiling"; built.hasPass = false; startBuild(built, plainSource); }
    }
    gl.deleteShader(pending.fragment);
    if (built.status !== "compiling") built.pending = null;
    return built.status === "ready";
  }
  // A shader's program in the shared context, built once per source: the glass pass round its mainImage, or the shader alone on a device that can't build it.
  function programFor(context, source) {
    if (context.programs[source]) return context.programs[source];
    var body = HEAD + "uniform float iDark;\\n" + HELPERS + source + "\\n";
    var built = { status: "compiling", hasPass: true, names: ["iResolution", "iTime", "iDark", "iGlassPanes", "iGlassPaneCount", "zaismaPaneCuts", "zaismaPixel", "zaismaViewOffset"],
      plainSource: body + "uniform vec2 zaismaViewOffset;\\nout vec4 zaismaFragColor;\\nvoid main() { vec4 color = vec4(0.0); mainImage(color, gl_FragCoord.xy + zaismaViewOffset); zaismaFragColor = vec4(color.rgb, 1.0); }" };
    startBuild(built, body + GLASS_LIGHT);
    context.programs[source] = built;
    return built;
  }
  // The shared picture shaders draw into, grown to the largest a canvas needs.
  function drawnTarget(context, widthPx, heightPx) {
    var gl = context.gl, drawn = context.drawn;
    if (drawn.widthPx < widthPx || drawn.heightPx < heightPx) {
      drawn.widthPx = Math.max(drawn.widthPx, widthPx); drawn.heightPx = Math.max(drawn.heightPx, heightPx);
      gl.bindTexture(gl.TEXTURE_2D, drawn.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, drawn.widthPx, drawn.heightPx, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, drawn.framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, drawn.texture, 0);
    }
    return drawn;
  }
  // Draws the layer's frame and answers whether it did: not while its program is still compiling.
  function shaderDrawer(canvas) {
    var source = canvas.getAttribute("data-backdrop-shader") || ZAISMA, context = sharedContext(), picture = null;
    if (!context) return null;
    programFor(context, source);
    return function (timeS, colors, layer) {
      var context = sharedContext(), built = context && programFor(context, source);
      if (!built || !settle(built) || !settle(context.upscale)) return false;
      // The canvas's own picture is taken only now: taken before its first frame, it would show black over the gradient under it.
      picture = picture || canvas.getContext("2d", { alpha: false });
      if (!picture) return false;
      var gl = context.gl, board = context.board, width = canvas.width, height = canvas.height, drawnWidth = layer.drawnWidth, drawnHeight = layer.drawnHeight, at = built.at;
      // The board grows to the largest canvas; each draws in its bottom left and is copied from there.
      if (board.width < width || board.height < height) { board.width = Math.max(board.width, width); board.height = Math.max(board.height, height); }
      var drawn = drawnTarget(context, drawnWidth, drawnHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, drawn.framebuffer); gl.useProgram(built.program); gl.viewport(0, 0, drawnWidth, drawnHeight);
      // A framed backdrop is a window onto a scene 1.8 times its size, centered on it: a shader sizes everything to its screen, so in a
      // small box its finest details (snowflakes, stars, rain) would shrink to a pixel and shimmer. Most of the picture still shows.
      var isWindow = canvas.classList.contains("is-framed"), sceneShare = isWindow ? 1.8 : 1;
      var sceneWidth = drawnWidth * sceneShare, sceneHeight = drawnHeight * sceneShare;
      gl.uniform3f(at.iResolution, sceneWidth, sceneHeight, 1); gl.uniform1f(at.iTime, timeS); gl.uniform1f(at.iDark, colors.darkShare);
      gl.uniform2f(at.zaismaViewOffset, (sceneWidth - drawnWidth) / 2, (sceneHeight - drawnHeight) / 2);
      var isFirstWithGlass = false;
      if (built.hasPass) {
        var glass = layer.glass || { rects: new Float32Array(PANE_LIMIT * 4), cuts: new Float32Array(PANE_LIMIT * 4), count: 0, scale: 1, box: canvas.getBoundingClientRect() };
        gl.uniform4fv(at.iGlassPanes, glass.rects); gl.uniform4fv(at.zaismaPaneCuts, glass.cuts); gl.uniform1i(at.iGlassPaneCount, glass.count); gl.uniform1f(at.zaismaPixel, glass.scale);
        isFirstWithGlass = canvas.hasAttribute("data-adapts-glass") && !layer.isGlassAdapted && glass.count > 0;
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // Sharpened as it's scaled up to the canvas's size, onto the board.
      var upscale = context.upscale;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.useProgram(upscale.program); gl.viewport(0, 0, width, height);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, drawn.texture);
      gl.uniform1i(upscale.at.zaismaDrawn, 0); gl.uniform2f(upscale.at.zaismaDrawnSize, drawnWidth, drawnHeight); gl.uniform2f(upscale.at.zaismaCanvasSize, width, height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // Read straight after the frame is drawn, while it's still in the buffer, then copied out before the next canvas draws over it.
      if (isFirstWithGlass) { layer.isGlassAdapted = true; adaptGlass(gl, layer, width, height); }
      picture.drawImage(board, 0, board.height - height, width, height, 0, 0, width, height);
      canvas.classList.add("is-drawn");
      return true;
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
    if (layer.isOuter) return;
    // The wall clock, not the page's own: moving to another page, the backdrop carries on where it was instead of starting over.
    var timeS = still.matches ? 20 : (Date.now() / 1000) % 3600;
    layer.colors = shownColors(layer, nowMs);
    var isDrawnNow = true;
    if (layer.drawShader) isDrawnNow = layer.drawShader(timeS, layer.colors, layer);
    else layer.canvas.dispatchEvent(new CustomEvent("backdrop-frame", { detail: { timeS: timeS, colors: layer.colors, widthPx: layer.canvas.width, heightPx: layer.canvas.height } }));
    layer.isDrawn = isDrawnNow && !layer.from;
  }
  function frame(nowMs) {
    requestAnimationFrame(frame);
    if (!isIdle && Date.now() - lastInputMs > IDLE_AFTER_MS) { isIdle = true; tellFramesIdle(); }
    // At most 30 frames a second (15 when idle), but at once when the glass over it has moved (a scroll), so what's under a pane never trails it.
    var gapGoalMs = isIdle ? IDLE_FRAME_GAP_MS : FRAME_GAP_MS;
    if (document.hidden || (nowMs - lastMs < gapGoalMs && !isPlaceStale)) return;
    var gapMs = nowMs - lastMs; lastMs = nowMs;
    if (isListStale) readList();
    var isMoved = isPlaceStale; isPlaceStale = false;
    layers.forEach(function (layer) {
      if (!layer.isInView || layer.canvas.hasAttribute("data-backdrop-paused")) return;
      if (layer.isOuter) {
        if (!isMoved && layer.glass && layer.isTold) return;
        placeGlass(layer); layer.isTold = true;
        if (layer.kind === "frame") tellFrame(layer);
        if (layer.canvas.hasAttribute("data-adapts-glass") && !layer.isGlassAdapted) adaptGlassFromStill(layer);
        return;
      }
      if (layer.drawShader && (isMoved || !layer.glass)) placeGlass(layer);
      // Still (reduced motion, or held on a slow device), it's drawn again only when the glass over it moves.
      if ((layer.isHeld || still.matches) && layer.isDrawn) return;
      // A shader on a device that can't keep up gets fewer pixels, then holds a still frame.
      if (layer.drawShader && gapMs < 1000) {
        layer.slowS = gapMs > gapGoalMs * 1.5 ? layer.slowS + gapMs / 1000 : Math.max(0, layer.slowS - gapMs / 2000);
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
  // A game's own frame or picture: nothing to draw here, only the glass over it to place, tell and measure.
  function setUpOuter(el, kind) {
    var layer = { canvas: el, kind: kind, isOuter: true, isInView: true, isTold: false, isGlassAdapted: false, target: readColors(el), from: null };
    el.backdropLayer = layer; layers.push(layer);
    // The frame says when it's running (and after it reloads): it's told where the glass is again.
    if (kind === "frame") { layer.onMessage = function (event) { if (event.source === el.contentWindow && event.data && event.data.zaismaBackground) { layer.isTold = false; isPlaceStale = true; } }; window.addEventListener("message", layer.onMessage); }
    // The still the glass is measured from: read again whenever the page points it at another (the dashboard's preview does).
    function loadStill() {
      // A background whose tone was measured when it was added says its glass (background-tone.ts): nothing to measure here.
      var glassKind = el.getAttribute("data-glass-kind");
      if (el.hasAttribute("data-adapts-glass") && glassKind) { layer.isGlassAdapted = true; showPick(layer, { isSmoked: glassKind === "smoked", tint: el.getAttribute("data-glass-tint") || "" }); return; }
      var stillUrl = el.getAttribute("data-backdrop-still") || (kind === "picture" ? el.currentSrc || el.src : "");
      if (!el.hasAttribute("data-adapts-glass") || !stillUrl) return;
      var picture = new Image();
      picture.onload = function () { if (el.getAttribute("data-backdrop-still") !== stillUrl && kind !== "picture") return; layer.still = picture; layer.isGlassAdapted = false; isPlaceStale = true; };
      picture.src = stillUrl;
    }
    loadStill();
    new MutationObserver(loadStill).observe(el, { attributes: true, attributeFilter: ["data-backdrop-still", "src", "data-glass-kind"] });
    if (window.IntersectionObserver) new IntersectionObserver(function (entries) { layer.isInView = entries[entries.length - 1].isIntersecting; }).observe(el);
    if (!running) { running = true; requestAnimationFrame(frame); }
  }
  function setUp(canvas) {
    if (canvas.backdropLayer) return;
    // A stand-in game's background waits for its shader (STAND_IN_BACKGROUNDS_SCRIPT writes it on, then adds the canvas).
    if (canvas.hasAttribute("data-backdrop-stand-in") && !canvas.hasAttribute("data-backdrop-shader")) return;
    var outerKind = canvas.getAttribute("data-backdrop");
    if (outerKind === "frame" || outerKind === "picture") return setUpOuter(canvas, outerKind);
    var isScene = canvas.getAttribute("data-backdrop") === "scene", isPhone = window.matchMedia("(max-width: 760px)").matches, sharpness = Math.min(window.devicePixelRatio || 1, isScene ? 2 : 1.5);
    // A shader filling the window is soft, so its canvas is about half the screen's pixels (less on a phone), and the shader draws at
    // DRAW_SHARE of that a side and is sharpened up to it. One framed in a small box (the gallery's examples) gets the screen's sharpness:
    // at half, its finest details (snowflakes, stars) would be a pixel or two and shimmer as they move. A scene gets the screen's
    // sharpness, up to 2x, and draws itself at its canvas's size.
    var isFramed = canvas.classList.contains("is-framed");
    var layer = { canvas: canvas, isInView: true, isDrawn: false, isHeld: false, slowS: 0, target: readColors(canvas), from: null, scale: isScene || isFramed ? sharpness : (isPhone ? 0.4 : 0.55) * sharpness };
    if (!isScene) { layer.drawShader = shaderDrawer(canvas); if (!layer.drawShader) return; }
    canvas.backdropLayer = layer;
    // Resizing a canvas clears it, so it's drawn again at once: it never shows a frame of the plain color under it.
    layer.size = function () {
      var width = Math.max(2, Math.round(canvas.clientWidth * layer.scale)), height = Math.max(2, Math.round(canvas.clientHeight * layer.scale));
      if (!isScene) {
        layer.drawnWidth = Math.max(2, Math.round(canvas.clientWidth * layer.scale * DRAW_SHARE)); layer.drawnHeight = Math.max(2, Math.round(canvas.clientHeight * layer.scale * DRAW_SHARE));
        width = Math.round(layer.drawnWidth * UPSCALE_NUMBER); height = Math.round(layer.drawnHeight * UPSCALE_NUMBER);
      }
      if (width === canvas.width && height === canvas.height) return;
      canvas.width = width; canvas.height = height; layer.isDrawn = false; layer.glass = null;
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
  document.querySelectorAll("canvas[data-backdrop], iframe[data-backdrop='frame'], img[data-backdrop='picture']").forEach(setUp);
  /*
   * A page that changes its backdrop (the home, as the game in focus changes) adds and removes layers itself: add(el) sets a new frame or
   * picture up (its glass is measured once its still has loaded), remove(el) forgets one the page took out, and forgetGlass() lets every piece of
   * glass go back to the theme's own, for a page that returns to Zaisma's backdrop from a game's. A layer with data-backdrop-paused is not drawn.
   */
  window.zaismaBackdrop = {
    add: function (el) { isListStale = true; setUp(el); },
    remove: function (el) {
      var layer = el.backdropLayer; if (!layer) return;
      layers = layers.filter(function (each) { return each !== layer; });
      if (layer.onMessage) window.removeEventListener("message", layer.onMessage);
      el.backdropLayer = null; isPlaceStale = true;
    },
    forgetGlass: function () {
      document.querySelectorAll(":has(> .backdrop)").forEach(function (host) { host.shownGlass = null; });
      document.querySelectorAll("[data-glass]").forEach(function (el) { el.glassPick = null; el.classList.remove("smoke"); el.removeAttribute("data-theme-choice"); el.style.removeProperty("--glass-tint"); });
    }
  };
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
