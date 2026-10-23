/*
 * How the game runs for its players. Zaisma adds this to every game page at its public address unless the
 * developer turned the measuring off (performance_measuring_enabled), after the first-draw watch it shares with
 * Zaisma's Chrome check. It measures, and sends the Zaisma game page only, 10 seconds in and then every 30 seconds:
 *   - load time: from the page opening to its first draw on a visible canvas;
 *   - frame rate: seconds of visible play at each frame rate, counted from the game's own animation frames
 *     (requestAnimationFrame, wrapped: one timestamp check and a counter a frame, nothing else), and frames of
 *     50 ms or longer (stutter);
 *   - crashes: an uncaught error after which the game asks for no frame for 5 seconds while visible, and a
 *     WebGL context lost on a canvas in the page that the game didn't lose itself;
 *   - the graphics chip's family (nvidia, intel, apple...), never the chip's own name, and peak memory where
 *     the browser tells it.
 * The Zaisma page adds it to its play reports as totals per game; nothing says who played. Every 5 seconds it
 * also says it's still answering, so the page can tell a frozen game. Plain JavaScript, no dependencies, MIT licensed.
 */
(function () {
  "use strict";
  var config = typeof __ZAISMA_PERFORMANCE__ === "object" && __ZAISMA_PERFORMANCE__ ? __ZAISMA_PERFORMANCE__ : null;
  if (!config || !config.site || window.parent === window || typeof window.requestAnimationFrame !== "function") return;
  var limits = config.limits;
  var buckets = config.frameRateBuckets;
  var drawn = window.__zaismaFirstDraw || { firstDrawAtMs: null, memories: null };
  var versionMatch = /\/_zaisma\/versions\/([a-z0-9_]+)\//.exec(location.pathname);

  // What's measured since the last report.
  var frameRateSeconds = [];
  var longFrameCount = 0;
  var measuredDurationMs = 0;
  var crashKindCounts = {};
  var hasCrashed = false;
  var peakMemorySizeBytes = 0;
  var graphicsFamily = null;
  var firstContext = null;

  function resetCounts() {
    frameRateSeconds = [];
    for (var i = 0; i <= buckets.length; i++) frameRateSeconds.push(0);
    longFrameCount = 0;
    measuredDurationMs = 0;
    crashKindCounts = {};
  }
  resetCounts();

  // A frame rate's bucket. Screens refresh at the buckets' edges (30, 60, 120), so a frame a second of leeway
  // keeps a steady 60 measured as 59.8 in the 60 bucket.
  function bucketOf(framesPerSec) {
    var index = 0;
    while (index < buckets.length && framesPerSec >= buckets[index] - 1) index++;
    return index;
  }

  // Frames: several callbacks in one frame share its timestamp, so a frame counts once.
  var lastFrameTimestampMs = null;
  var windowStartTimestampMs = 0;
  var windowFrameCount = 0;
  var lastFrameSeenAtMs = 0;
  function onFrame(timestampMs) {
    if (typeof timestampMs !== "number") timestampMs = performance.now();
    if (timestampMs === lastFrameTimestampMs) return;
    lastFrameSeenAtMs = timestampMs;
    if (lastFrameTimestampMs === null || document.hidden) {
      windowStartTimestampMs = timestampMs;
      windowFrameCount = 0;
    } else {
      var gapMs = timestampMs - lastFrameTimestampMs;
      if (gapMs >= limits.longFrameDurationMs) longFrameCount++;
      if (gapMs > 1000) {
        // A pause: the game stopped asking for frames for a while. Measuring starts again from here.
        windowStartTimestampMs = timestampMs;
        windowFrameCount = 0;
      } else {
        windowFrameCount++;
        var spanMs = timestampMs - windowStartTimestampMs;
        if (spanMs >= 1000) {
          frameRateSeconds[bucketOf((windowFrameCount * 1000) / spanMs)] += spanMs / 1000;
          measuredDurationMs += spanMs;
          windowStartTimestampMs = timestampMs;
          windowFrameCount = 0;
        }
      }
    }
    lastFrameTimestampMs = timestampMs;
  }
  var originalRequestAnimationFrame = window.requestAnimationFrame;
  window.requestAnimationFrame = function requestAnimationFrame(callback) {
    if (typeof callback !== "function") return originalRequestAnimationFrame.call(window, callback);
    return originalRequestAnimationFrame.call(window, function (timestampMs) {
      onFrame(timestampMs);
      return callback(timestampMs);
    });
  };
  // Hidden time isn't play: the next frame after it starts measuring afresh.
  document.addEventListener("visibilitychange", function () {
    lastFrameTimestampMs = null;
  });

  function crash(kind) {
    if (hasCrashed) return;
    hasCrashed = true;
    crashKindCounts[kind] = 1;
  }

  // An uncaught error the game doesn't come back from: no frame for 5 seconds after it, while visible.
  var isErrorWatched = false;
  function onError() {
    if (isErrorWatched || lastFrameTimestampMs === null) return;
    isErrorWatched = true;
    var errorAtMs = performance.now();
    setTimeout(function () {
      isErrorWatched = false;
      if (!document.hidden && lastFrameSeenAtMs <= errorAtMs) crash("error_stop");
    }, limits.errorStopAfterSec * 1000);
  }
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onError);

  // WebGL contexts: a lost one on a canvas in the page counts, unless the game lost it itself (WEBGL_lose_context,
  // as engines do when they clean up) or the page is hidden (phones drop contexts of pages in the background).
  var watchedCanvases = new WeakSet();
  var deliberateCanvases = new WeakSet();
  var loseExtensionCanvases = new WeakMap();
  var isLoseContextWrapped = false;
  var originalGetContext = window.HTMLCanvasElement && HTMLCanvasElement.prototype.getContext;
  if (originalGetContext) {
    HTMLCanvasElement.prototype.getContext = function getContext(contextKind) {
      var webglContext = originalGetContext.apply(this, arguments);
      if (webglContext && !watchedCanvases.has(this) && /^(webgl|webgl2|experimental-webgl)$/.test(String(contextKind))) {
        watchedCanvases.add(this);
        watchContext(this, webglContext);
      }
      return webglContext;
    };
  }
  function watchContext(canvas, webglContext) {
    if (!firstContext) firstContext = webglContext;
    try {
      var loseExtension = WebGLRenderingContext.prototype.getExtension.call(webglContext, "WEBGL_lose_context");
      if (loseExtension) {
        loseExtensionCanvases.set(loseExtension, canvas);
        var prototype = Object.getPrototypeOf(loseExtension);
        if (!isLoseContextWrapped && typeof prototype.loseContext === "function") {
          isLoseContextWrapped = true;
          var originalLoseContext = prototype.loseContext;
          prototype.loseContext = function loseContext() {
            var lost = loseExtensionCanvases.get(this);
            if (lost) deliberateCanvases.add(lost);
            return originalLoseContext.apply(this, arguments);
          };
        }
      }
    } catch (error) {}
    canvas.addEventListener("webglcontextlost", function () {
      if (canvas.isConnected && !document.hidden && !deliberateCanvases.has(canvas)) crash("context_lost");
    });
  }

  // The graphics chip's family, matched here so its full name never leaves the frame. From the game's own WebGL
  // context when it has one, otherwise a tiny one of ours, made once and let go.
  function familyOf(rendererText) {
    var text = String(rendererText || "").toLowerCase();
    for (var i = 0; i < config.graphicsFamilyPatterns.length; i++) {
      if (new RegExp(config.graphicsFamilyPatterns[i][1]).test(text)) return config.graphicsFamilyPatterns[i][0];
    }
    return null;
  }
  function readGraphicsFamily() {
    var webglContext = firstContext;
    var ownCanvas = null;
    try {
      if (!webglContext || webglContext.isContextLost()) {
        ownCanvas = document.createElement("canvas");
        ownCanvas.width = ownCanvas.height = 1;
        webglContext = originalGetContext && originalGetContext.call(ownCanvas, "webgl");
      }
      if (!webglContext) return "unknown";
      var family = familyOf(webglContext.getParameter(webglContext.RENDERER)) || familyOf(webglContext.getParameter(webglContext.VENDOR));
      if (!family) {
        var debugRendererInfo = webglContext.getExtension("WEBGL_debug_renderer_info");
        if (debugRendererInfo) family = familyOf(webglContext.getParameter(debugRendererInfo.UNMASKED_RENDERER_WEBGL)) || familyOf(webglContext.getParameter(debugRendererInfo.UNMASKED_VENDOR_WEBGL)) || "other";
      }
      if (ownCanvas) {
        var lose = webglContext.getExtension("WEBGL_lose_context");
        if (lose) lose.loseContext();
      }
      return family || "unknown";
    } catch (error) {
      return "unknown";
    }
  }

  function readMemory() {
    var sizeBytes = performance.memory && performance.memory.usedJSHeapSize ? performance.memory.usedJSHeapSize : 0;
    if (drawn.memories) drawn.memories.forEach(function (memory) { sizeBytes += memory.buffer.byteLength; });
    if (sizeBytes > peakMemorySizeBytes) peakMemorySizeBytes = sizeBytes;
  }

  function loadingDurationSec() {
    return drawn.firstDrawAtMs === null ? null : Math.round(Math.max(0, drawn.firstDrawAtMs - performance.timeOrigin) / 100) / 10;
  }

  function send(message) {
    try {
      if (JSON.stringify(message).length <= limits.maximumReportSizeBytes) window.parent.postMessage(message, config.site);
    } catch (error) {}
  }

  var tickCount = 0;
  setInterval(function () {
    tickCount++;
    readMemory();
    send({ type: "zaisma:alive" });
    // The first report 10 seconds in, so a short play still sends one; then every 30 seconds.
    if (tickCount !== 2 && tickCount % Math.round(limits.reportIntervalSec / limits.aliveIntervalSec)) return;
    if (graphicsFamily === null) graphicsFamily = readGraphicsFamily();
    var loadingSec = loadingDurationSec();
    send({
      type: "zaisma:performance",
      version_id: versionMatch ? versionMatch[1] : null,
      graphics_family: graphicsFamily,
      loading_duration_sec: loadingSec,
      // Final once it drew, crashed, or waited as long as the Chrome check does: the page reports the play then.
      is_settled: loadingSec !== null || hasCrashed || performance.now() >= limits.loadingGivenUpAfterSec * 1000,
      frame_rate_seconds: frameRateSeconds.map(function (seconds) { return Math.round(seconds); }),
      long_frame_count: longFrameCount,
      measured_duration_sec: Math.round(measuredDurationMs / 1000),
      crash_kind_counts: crashKindCounts,
      peak_memory_size_bytes: peakMemorySizeBytes,
    });
    resetCounts();
  }, limits.aliveIntervalSec * 1000);
})();
