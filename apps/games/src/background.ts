import type { Env } from "./index.ts";
import {
  BUFFER_PASS,
  GLASS_LIGHT_PASS,
  MOST_GLASS_PANE_COUNT,
  PICTURE_PLACEHOLDER,
  SHADER_BUFFER_FORMATS,
  SHADER_CHANNEL_FILTERS,
  SHADER_CHANNEL_INPUT_KINDS,
  SHADER_CHANNEL_WRAPS,
  SHADER_HEAD,
  SHADER_LIMITS,
  SHADER_TEXTURE_BITMAP_OPTIONS,
  SHADER_UPSCALE_SOURCE,
  SHADER_VERTEX_SOURCE,
  backgroundsFor,
  gameHeaders,
  imageById,
  imageKey,
  shaderById,
  shaderChannelSampling,
  shaderKey,
  shaderManifestFromSource,
  shaderManifestKey,
  shaderStillKey,
  type BackgroundScreen,
  type Game,
} from "@zaisma/core";

/**
 * A game's background shader, run on the game's own site like any of its files (Backgrounds in docs/DEVELOPER-API.md): Zaisma's
 * pages frame it behind their glass, so a shader is untrusted game content that never runs on zaisma.com.
 *
 *   _zaisma/background?screen=wide|phone             the runner, drawing the shader the game chose for that screen
 *   _zaisma/background.json?screen=…                  that shader's manifest: its image pass and buffers with their channels
 *   _zaisma/background.glsl?screen=…                  its image pass's source
 *   _zaisma/background-still.png?screen=…             its still frame, shown under reduced motion and where WebGL2 can't run
 *   _zaisma/background-texture?image=<image_id>       one of the game's approved shader textures, which a chosen shader reads
 *   _zaisma/shader-preview                            the same runner, drawing a shader the dashboard posts to it
 *
 * The runner draws in WebGL2, as the check does (shader-check.ts in the site): each frame the buffers a to d, each onto the next of
 * its two pictures (ping-pong), then the image pass, all at fewer pixels, then the sharpening upscale (SHADER_UPSCALE_SOURCE) onto
 * the canvas. It starts at quality level 2 on a wide screen with a fine pointer, 1 on a tablet and 0 on a phone; a device that can't
 * keep up steps down a level (when the shader reads iQuality), then to fewer pixels, then holds the frame it has.
 *
 * The page round the frame can't be read from here, so it posts what the runner can't see: { panes } (the glass over it:
 * [{ rect: [left, bottom, right, top], cuts: [top left, top right, bottom right, bottom left], isSmoked }] in the frame's own CSS pixels
 * from its bottom left; iGlassPanes and the glass pass, GLASS_LIGHT_PASS), which Zaisma's pages leave empty: a frame can't redraw a bend
 * in the frame the page scrolls in, so it would trail each pane; and whether
 * nobody has touched the page for a while, { isIdle }, since the frame never sees the page's input: idle, it draws 15 frames a
 * second instead of 30; and { isPaused } while the page keeps it out of sight, ready to show again at once, when it draws nothing. Every
 * pass builds in the background where the browser can (KHR_parallel_shader_compile), so a big shader never stops the page round the frame,
 * and the page hears { isRunning } once the first frame is drawn. The preview runner is posted { manifest, textures: [{ imageId, bytes } or { imageId, url }] } (or
 * { source } for a single pass) and { qualityLevel: 0, 1, 2 or null for the device's own }.
 */

type BackgroundEnv = Pick<Env, "DB" | "GAMES" | "SITE_ORIGIN">;

const RUNNER_SCRIPT = `(function () {
  var config = window.__ZAISMA_BACKGROUND__;
  var canvas = document.querySelector("canvas"), still = document.querySelector("img"), reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  var UNIFORMS = ["iResolution", "iTime", "iTimeDelta", "iFrame", "iQuality", "iChannel0", "iChannel1", "iChannel2", "iChannel3", "iChannelResolution", "iGlassPanes", "iGlassPaneCount", "zaismaPaneCuts", "zaismaPixel", "zaismaViewOffset"];
  var gl = null, kit = null, shown = null, startNumber = 0, lastStart = null;
  var scale = config.resolutionScale * config.drawShareNumber * Math.min(window.devicePixelRatio || 1, 1.5), drawn = { widthPx: 0, heightPx: 0 };
  var chosenLevel = null, qualityLevel = startingLevel(), slowSec = 0, isHeld = false, lastMs = 0, frameIndex = 0, lastTimeSec = null, isIdle = false, isPaused = false, stillWantedAtMs = 0;
  var panes = { rects: new Float32Array(config.paneLimit * 4), cuts: new Float32Array(config.paneLimit * 4), count: 0, css: [] };
  function tell(message) { if (window.parent !== window) window.parent.postMessage(Object.assign({ zaismaBackground: true }, message), config.site); }
  function showStill() { canvas.hidden = true; if (still.getAttribute("data-src")) { still.src = still.getAttribute("data-src"); still.hidden = false; } }
  // 2 on a wide screen with a fine pointer, 1 on a tablet, 0 on a phone: the screen's, not the frame's, since a frame can be small.
  function startingLevel() {
    if (Math.min(window.screen.width, window.screen.height) < 600) return 0;
    return window.matchMedia("(pointer: fine)").matches ? 2 : 1;
  }
  function withoutComments(source) { return source.replace(/\\/\\*[\\s\\S]*?\\*\\//g, " ").replace(/\\/\\/[^\\n]*/g, ""); }

  // The context and what every shader shares in it: the triangle, the vertex shader, the upscale, a black texture for empty channels.
  function setUpContext() {
    kit = { samplers: {}, canDrawFloat: Boolean(gl.getExtension("EXT_color_buffer_float")), parallel: gl.getExtension("KHR_parallel_shader_compile") };
    gl.bindVertexArray(gl.createVertexArray());
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    kit.vertex = compile(gl.VERTEX_SHADER, config.vertexSource);
    kit.upscale = startBuild(config.upscaleSource);
    kit.black = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, kit.black);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  }
  function context() {
    if (gl) return kit && !kit.isLost ? gl : null;
    gl = canvas.getContext("webgl2", { antialias: false, depth: false, stencil: false, alpha: false, powerPreference: "low-power" });
    if (!gl) return null;
    setUpContext();
    canvas.addEventListener("webglcontextlost", function (event) { event.preventDefault(); kit.isLost = true; shown = null; });
    canvas.addEventListener("webglcontextrestored", function () { setUpContext(); drawn = { widthPx: 0, heightPx: 0 }; if (lastStart) start(lastStart.manifest, lastStart.textureSources); });
    return gl;
  }
  function compile(kind, source) { var shader = gl.createShader(kind); gl.shaderSource(shader, source); gl.compileShader(shader); return shader; }
  function firstLine(log, fallback) { return (log || "").split("\\n").map(function (line) { return line.trim(); }).filter(Boolean)[0] || fallback; }
  /*
   * A fragment shader set compiling and linking into a program. Where the browser can (KHR_parallel_shader_compile) the driver builds it
   * on threads of its own, and nothing asks how it went until it says it's done (whenBuilt), so a big shader never stops the page: asking
   * any sooner would wait for the whole compile then and there, and the page round the frame with it where they share a process.
   */
  function startBuild(fragmentSource) {
    var fragment = compile(gl.FRAGMENT_SHADER, fragmentSource), program = gl.createProgram();
    gl.attachShader(program, kit.vertex); gl.attachShader(program, fragment); gl.bindAttribLocation(program, 0, "corner"); gl.linkProgram(program);
    return { program: program, fragment: fragment };
  }
  // Calls done once every program in the list has built, checking again every frame's time meanwhile; at once without the extension.
  function whenBuilt(list, done) {
    if (!kit.parallel || list.every(function (pending) { return pending.at || gl.getProgramParameter(pending.program, kit.parallel.COMPLETION_STATUS_KHR); })) done();
    else setTimeout(function () { whenBuilt(list, done); }, 16);
  }
  // A built program with its uniforms' places, or its first compiler error; asked only once it's done.
  function finishBuild(pending, names) {
    if (pending.at || pending.error) return pending;
    if (!gl.getProgramParameter(pending.program, gl.LINK_STATUS)) {
      pending.error = gl.getShaderParameter(pending.fragment, gl.COMPILE_STATUS) ? firstLine(gl.getProgramInfoLog(pending.program), "It didn't link.") : firstLine(gl.getShaderInfoLog(pending.fragment), "It didn't compile.");
      gl.deleteShader(pending.fragment); return pending;
    }
    gl.deleteShader(pending.fragment);
    pending.at = {}; names.forEach(function (name) { pending.at[name] = gl.getUniformLocation(pending.program, name); });
    return pending;
  }
  // How a channel samples (shaderChannelSampling in core, worked out for each kind, filter and wrap): one sampler each.
  function samplerFor(channel) {
    var sampling = config.samplings[channel.input_kind + " " + channel.filter + " " + channel.wrap] || config.samplings["buffer linear clamp"];
    var key = sampling.minificationFilterName + " " + sampling.magnificationFilterName + " " + sampling.wrapName;
    if (!kit.samplers[key]) {
      var sampler = gl.createSampler();
      gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, gl[sampling.minificationFilterName]); gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, gl[sampling.magnificationFilterName]);
      gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, gl[sampling.wrapName]); gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, gl[sampling.wrapName]);
      kit.samplers[key] = sampler;
    }
    return kit.samplers[key];
  }
  // A picture passes draw into: a buffer's in half floats where the browser can draw to them, the image pass's in 8 bits; each starts empty.
  function target(widthPx, heightPx, isBuffer) {
    var texture = gl.createTexture(), format = isBuffer && kit.canDrawFloat ? config.bufferFormats.float : config.bufferFormats.fallback;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl[format.internalFormatName], widthPx, heightPx, 0, gl[format.formatName], gl[format.typeName], null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var framebuffer = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { texture: texture, framebuffer: framebuffer };
  }
  function dropTarget(old) { if (old) { gl.deleteTexture(old.texture); gl.deleteFramebuffer(old.framebuffer); } }
  function dropShown() {
    if (!shown) return;
    shown.passes.forEach(function (pass) { gl.deleteProgram(pass.program); (pass.targets || []).forEach(dropTarget); });
    shown.textures.forEach(function (texture) { if (texture) gl.deleteTexture(texture.texture); });
    dropTarget(shown.imageTarget); shown = null;
  }
  // A texture from its bytes or its address on this site, upright as on Shadertoy, with mipmaps; one that can't be read reads black.
  function loadTexture(source) {
    var blob = source.bytes ? Promise.resolve(new Blob([source.bytes])) : typeof source.url === "string" ? fetch(source.url).then(function (response) { return response.ok ? response.blob() : Promise.reject(); }) : Promise.reject();
    return blob.then(function (picture) { return createImageBitmap(picture, config.bitmapOptions); }).then(function (bitmap) {
      if (!context()) return null;
      var texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap); gl.generateMipmap(gl.TEXTURE_2D);
      return { imageId: source.imageId, texture: texture, widthPx: bitmap.width, heightPx: bitmap.height };
    }).catch(function () { return null; });
  }
  // The passes in draw order, buffers a to d then the image pass (shaderPassesInDrawOrder in core).
  function passesOf(manifest) {
    var buffers = (Array.isArray(manifest.buffers) ? manifest.buffers : []).filter(function (buffer) { return buffer && typeof buffer.source === "string" && "abcd".indexOf(buffer.buffer_name) >= 0; });
    buffers.sort(function (first, second) { return "abcd".indexOf(first.buffer_name) - "abcd".indexOf(second.buffer_name); });
    var image = manifest.image || {};
    return buffers.map(function (buffer) { return { bufferName: buffer.buffer_name, source: buffer.source, channels: Array.isArray(buffer.channels) ? buffer.channels : [] }; })
      .concat([{ bufferName: null, source: String(image.source || ""), channels: Array.isArray(image.channels) ? image.channels : [] }]);
  }

  function start(manifest, textureSources) {
    var number = ++startNumber;
    if (!context()) { showStill(); tell({ error: "no_webgl" }); return; }
    var list = passesOf(manifest), pendings = list.map(function (pass) { return startBuild(config.head + pass.source + "\\n" + (pass.bufferName ? config.bufferPass : config.glassPass)); });
    // The textures load while the passes build.
    var texturesLoaded = Promise.all(textureSources.map(loadTexture));
    whenBuilt(pendings.concat([kit.upscale]), function () {
      var built = [];
      // A newer shader was posted while these built: it's the one that runs.
      if (number !== startNumber || !context()) {
        pendings.forEach(function (pending) { gl.deleteProgram(pending.program); });
        texturesLoaded.then(function (textures) { textures.forEach(function (texture) { if (texture) gl.deleteTexture(texture.texture); }); });
        return;
      }
      finishBuild(kit.upscale, ["zaismaDrawn", "zaismaDrawnSize", "zaismaCanvasSize"]);
      for (var p = 0; p < list.length; p++) {
        var made = finishBuild(pendings[p], UNIFORMS);
        if (made.error) {
          pendings.forEach(function (pending) { gl.deleteProgram(pending.program); });
          tell({ compileError: (list[p].bufferName ? "buffer " + list[p].bufferName + ": " : "") + made.error });
          if (!config.isPreview) showStill();
          return;
        }
        built.push({ bufferName: list[p].bufferName, channels: list[p].channels, program: made.program, at: made.at, targets: null, front: 0 });
      }
      texturesLoaded.then(function (textures) {
        // A newer shader was posted while these loaded: it's the one that runs.
        if (number !== startNumber || !context()) { built.forEach(function (pass) { gl.deleteProgram(pass.program); }); textures.forEach(function (texture) { if (texture) gl.deleteTexture(texture.texture); }); return; }
        dropShown();
        lastStart = { manifest: manifest, textureSources: textureSources };
        built.forEach(function (pass) {
          pass.channels = pass.channels.map(function (channel) {
            var bufferPassIndex = -1, textureIndex = -1;
            if (channel.input_kind === "buffer") built.forEach(function (other, index) { if (other.bufferName === channel.buffer_name) bufferPassIndex = index; });
            if (channel.input_kind === "texture") textures.forEach(function (texture, index) { if (texture && texture.imageId === channel.image_id) textureIndex = index; });
            return { channelIndex: channel.channel_index, bufferPassIndex: bufferPassIndex, textureIndex: textureIndex, sampler: samplerFor(channel) };
          });
        });
        shown = { passes: built, textures: textures, imageTarget: null, hasBuffers: built.length > 1, readsQuality: list.some(function (pass) { return /\\biQuality\\b/.test(withoutComments(pass.source)); }) };
        drawn = { widthPx: 0, heightPx: 0 }; frameIndex = 0; lastTimeSec = null; isHeld = false; slowSec = 0;
        // Its first frame eases in over the placeholder, never cutting from the blur to the sharp world.
        if (canvas.hidden) { canvas.classList.add("is-arriving"); requestAnimationFrame(function () { requestAnimationFrame(function () { canvas.classList.remove("is-arriving"); }); }); }
        canvas.hidden = false; still.hidden = true;
        size(); tell({ isRunning: true });
        // The developer's own preview has no saved still yet, so it's handed one to measure its glass from: a single pass's frame at the
        // still's time at once, a shader with buffers its frame once it has run that long.
        if (config.isPreview) {
          if (!shown.hasBuffers) { draw({ atTimeSec: config.stillTimeSec }); tell({ stillDataUrl: canvas.toDataURL("image/jpeg", 0.8) }); draw(); }
          else stillWantedAtMs = performance.now() + config.stillTimeSec * 1000;
        }
      });
    });
  }
  // Sized to the window: the passes at drawn's size, the canvas runtimeUpscaleNumber times it. A new size starts every buffer empty.
  function size() {
    var widthPx = Math.max(2, Math.round(window.innerWidth * scale)), heightPx = Math.max(2, Math.round(window.innerHeight * scale));
    if (!shown || (widthPx === drawn.widthPx && heightPx === drawn.heightPx)) return;
    drawn = { widthPx: widthPx, heightPx: heightPx };
    canvas.width = Math.round(widthPx * config.upscaleNumber); canvas.height = Math.round(heightPx * config.upscaleNumber);
    shown.passes.forEach(function (pass) {
      if (!pass.bufferName) return;
      (pass.targets || []).forEach(dropTarget);
      pass.targets = [target(widthPx, heightPx, true), target(widthPx, heightPx, true)]; pass.front = 0;
    });
    dropTarget(shown.imageTarget); shown.imageTarget = target(widthPx, heightPx, false);
    frameIndex = 0; lastTimeSec = null;
    placePanes(); draw();
  }
  // Where the glass is, in the passes' own pixels from their bottom left.
  function placePanes() {
    var k = drawn.widthPx / Math.max(1, window.innerWidth);
    panes.rects.fill(0); panes.cuts.fill(0); panes.count = Math.min(panes.css.length, config.paneLimit);
    panes.css.slice(0, panes.count).forEach(function (pane, i) {
      panes.rects.set(pane.rect.map(function (v) { return v * k; }), i * 4);
      panes.cuts.set([pane.cuts[0] * k, pane.cuts[1] * k, pane.cuts[2] * k, pane.cuts[3] * k + (pane.isSmoked ? 4096 : 0)], i * 4);
    });
  }
  // One frame: each buffer onto its next picture, reading the newest picture of each buffer it names (its own last frame for itself),
  // then the image pass onto its picture, then the upscale onto the canvas. imageOnly draws the image pass again over the same buffers.
  function drawFrame(timeSec, deltaSec, index, imageOnly) {
    var resolutions = new Float32Array(12), widthPx = drawn.widthPx, heightPx = drawn.heightPx;
    for (var p = 0; p < shown.passes.length; p++) {
      var pass = shown.passes[p], at = pass.at;
      if (imageOnly && pass.bufferName) continue;
      var into = pass.bufferName ? pass.targets[1 - pass.front] : shown.imageTarget;
      gl.bindFramebuffer(gl.FRAMEBUFFER, into.framebuffer); gl.viewport(0, 0, widthPx, heightPx); gl.useProgram(pass.program);
      gl.uniform3f(at.iResolution, widthPx, heightPx, 1); gl.uniform1f(at.iTime, timeSec); gl.uniform1f(at.iTimeDelta, deltaSec);
      gl.uniform1i(at.iFrame, index); gl.uniform1f(at.iQuality, qualityLevel);
      resolutions.fill(0);
      for (var unit = 0; unit < 4; unit++) {
        var channel = null;
        for (var c = 0; c < pass.channels.length; c++) if (pass.channels[c].channelIndex === unit) channel = pass.channels[c];
        gl.activeTexture(gl.TEXTURE0 + unit);
        if (channel && channel.bufferPassIndex >= 0) {
          var source = shown.passes[channel.bufferPassIndex];
          gl.bindTexture(gl.TEXTURE_2D, source.targets[source.front].texture); gl.bindSampler(unit, channel.sampler);
          resolutions[unit * 3] = widthPx; resolutions[unit * 3 + 1] = heightPx; resolutions[unit * 3 + 2] = 1;
        } else if (channel && channel.textureIndex >= 0) {
          var read = shown.textures[channel.textureIndex];
          gl.bindTexture(gl.TEXTURE_2D, read.texture); gl.bindSampler(unit, channel.sampler);
          resolutions[unit * 3] = read.widthPx; resolutions[unit * 3 + 1] = read.heightPx; resolutions[unit * 3 + 2] = 1;
        } else { gl.bindTexture(gl.TEXTURE_2D, kit.black); gl.bindSampler(unit, null); }
        gl.uniform1i(at["iChannel" + unit], unit);
      }
      gl.uniform3fv(at.iChannelResolution, resolutions);
      gl.uniform4fv(at.iGlassPanes, panes.rects); gl.uniform1i(at.iGlassPaneCount, panes.count);
      gl.uniform4fv(at.zaismaPaneCuts, panes.cuts); gl.uniform1f(at.zaismaPixel, drawn.widthPx / Math.max(1, window.innerWidth)); gl.uniform2f(at.zaismaViewOffset, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (pass.bufferName) pass.front = 1 - pass.front;
    }
    var upscale = kit.upscale;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height); gl.useProgram(upscale.program);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, shown.imageTarget.texture); gl.bindSampler(0, null);
    gl.uniform1i(upscale.at.zaismaDrawn, 0); gl.uniform2f(upscale.at.zaismaDrawnSize, widthPx, heightPx); gl.uniform2f(upscale.at.zaismaCanvasSize, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function draw(options) {
    if (!shown || !shown.imageTarget || !context()) return;
    var atTimeSec = options && options.atTimeSec, imageOnly = Boolean(options && options.imageOnly && shown.hasBuffers && frameIndex > 0);
    // The wall clock: moving from page to page, the background carries on where it was instead of starting over.
    var timeSec = atTimeSec !== undefined ? atTimeSec : imageOnly && lastTimeSec !== null ? lastTimeSec : reduced.matches ? config.stillTimeSec : (Date.now() / 1000) % 3600;
    var deltaSec = lastTimeSec === null || timeSec < lastTimeSec ? 1 / config.maximumFps : Math.min(1, timeSec - lastTimeSec);
    drawFrame(timeSec, deltaSec, imageOnly ? frameIndex - 1 : frameIndex, imageOnly);
    if (!imageOnly) { lastTimeSec = timeSec; frameIndex++; }
  }
  // A device that can't keep up: a level down (for a shader that reads iQuality), then fewer pixels, then the frame it has, held.
  function stepDown() {
    if (shown.readsQuality && chosenLevel === null && qualityLevel > 0) { qualityLevel--; return; }
    if (scale > config.minimumDrawScaleNumber) { scale *= 0.75; size(); return; }
    isHeld = true;
  }
  function frame(nowMs) {
    requestAnimationFrame(frame);
    var gapGoalMs = 1000 / (isIdle ? config.idleFramesPerSec : config.maximumFps);
    if (!shown || document.hidden || isHeld || isPaused || reduced.matches || nowMs - lastMs < gapGoalMs - 1) return;
    var gapMs = nowMs - lastMs; lastMs = nowMs;
    if (gapMs < 1000) {
      slowSec = gapMs > gapGoalMs * 1.5 ? slowSec + gapMs / 1000 : Math.max(0, slowSec - gapMs / 2000);
      if (slowSec > 1.5) { slowSec = 0; stepDown(); if (isHeld) return; }
    }
    draw();
    if (stillWantedAtMs && nowMs >= stillWantedAtMs) { stillWantedAtMs = 0; tell({ stillDataUrl: canvas.toDataURL("image/jpeg", 0.8) }); }
  }
  window.addEventListener("message", function (event) {
    if (event.origin !== config.site || !event.data || typeof event.data !== "object") return;
    var message = event.data;
    if (Array.isArray(message.panes)) {
      panes.css = message.panes.filter(function (pane) { return pane && Array.isArray(pane.rect) && pane.rect.length === 4 && Array.isArray(pane.cuts) && pane.cuts.length === 4; }).map(function (pane) {
        return { rect: pane.rect.map(Number), cuts: pane.cuts.map(Number), isSmoked: pane.isSmoked === true };
      });
      placePanes(); draw({ imageOnly: true });
    }
    // Idle: nobody has touched the page for a minute, so fewer frames; back at once on the first input.
    if (typeof message.isIdle === "boolean") isIdle = message.isIdle;
    // Paused: the page keeps this frame out of sight, ready to show again at once (the home's recent games), so it draws nothing till then.
    if (typeof message.isPaused === "boolean" && message.isPaused !== isPaused) { isPaused = message.isPaused; if (!isPaused) { lastMs = 0; draw(); } }
    if (!config.isPreview) return;
    if ("qualityLevel" in message) {
      chosenLevel = message.qualityLevel === 0 || message.qualityLevel === 1 || message.qualityLevel === 2 ? message.qualityLevel : null;
      qualityLevel = chosenLevel !== null ? chosenLevel : startingLevel(); isHeld = false; slowSec = 0; draw();
    }
    if (message.manifest && typeof message.manifest === "object") start(message.manifest, Array.isArray(message.textures) ? message.textures.filter(function (texture) { return texture && typeof texture.imageId === "string"; }) : []);
    else if (typeof message.source === "string") start({ image: { source: message.source, channels: [] }, buffers: [] }, []);
  });
  window.addEventListener("resize", size);
  reduced.addEventListener("change", function () { draw(); });
  // Opened on its own, not framed by a page, it watches its own input for idle.
  if (window.parent === window) {
    var lastInputMs = Date.now();
    ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"].forEach(function (name) { window.addEventListener(name, function () { lastInputMs = Date.now(); isIdle = false; }, { passive: true }); });
    setInterval(function () { isIdle = Date.now() - lastInputMs > config.idleTimeoutSec * 1000; }, 1000);
  }
  requestAnimationFrame(frame);
  if (config.isPreview) { tell({ isReady: true }); return; }
  // Under reduced motion the still shows, and nothing runs.
  if (reduced.matches) { showStill(); return; }
  fetch(config.manifestUrl).then(function (response) { return response.ok ? response.json() : Promise.reject(); }).then(function (manifest) {
    var ids = [];
    passesOf(manifest).forEach(function (pass) { pass.channels.forEach(function (channel) { if (channel && channel.input_kind === "texture" && typeof channel.image_id === "string" && ids.indexOf(channel.image_id) < 0) ids.push(channel.image_id); }); });
    start(manifest, ids.map(function (id) { return { imageId: id, url: config.textureUrl + encodeURIComponent(id) }; }));
  }, showStill);
})();`;

/**
 * The runner's page. Under its canvas lies the shader's placeholder, blurred as Zaisma's page blurs it under the frame (PICTURE_PLACEHOLDER), so
 * the frame shows the same picture as the page until the shader's first frame eases in over it; under both, the shader's measured color,
 * so the frame is never black or white while its placeholder decodes.
 */
function runnerPage(config: Record<string, unknown>, stillUrl: string | null, placeholderDataUrl: string | null = null, averageColor: string | null = null): string {
  const color = averageColor && /^#[0-9a-fA-F]{6}$/.test(averageColor) ? averageColor : "#000";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Background</title>
<style>html, body { margin: 0; height: 100%; overflow: hidden; background: ${color}; } canvas { transition: opacity 1.2s ease-out; } canvas.is-arriving { opacity: 0; } canvas, img { position: fixed; inset: 0; width: 100%; height: 100%; display: block; object-fit: cover; } [hidden] { display: none; } .placeholder { position: fixed; inset: -${PICTURE_PLACEHOLDER.backgroundBlurPx * 2}px; box-sizing: border-box; padding: ${PICTURE_PLACEHOLDER.backgroundBlurPx * 2}px; background: center / cover no-repeat content-box; filter: blur(${PICTURE_PLACEHOLDER.backgroundBlurPx}px); }</style></head>
<body>${placeholderDataUrl ? `<div class="placeholder" style="background-image: url(${placeholderDataUrl})"></div>` : ""}<canvas hidden></canvas><img alt="" hidden${stillUrl ? ` data-src="${stillUrl}"` : ""}>
<script>var __ZAISMA_BACKGROUND__ = ${JSON.stringify(config).replace(/</g, "\\u003c")};\n${RUNNER_SCRIPT}</script></body></html>`;
}

/** How each kind of channel samples, by "input_kind filter wrap", so the runner samples as the check does. */
const SAMPLINGS = Object.fromEntries(
  SHADER_CHANNEL_INPUT_KINDS.flatMap((inputKind) => SHADER_CHANNEL_FILTERS.flatMap((filter) => SHADER_CHANNEL_WRAPS.map((wrap) => [`${inputKind} ${filter} ${wrap}`, shaderChannelSampling({ input_kind: inputKind, filter, wrap })]))),
);

const runnerConfig = (env: BackgroundEnv) => ({
  site: env.SITE_ORIGIN,
  head: SHADER_HEAD,
  glassPass: GLASS_LIGHT_PASS,
  bufferPass: BUFFER_PASS,
  vertexSource: SHADER_VERTEX_SOURCE,
  upscaleSource: SHADER_UPSCALE_SOURCE,
  samplings: SAMPLINGS,
  bitmapOptions: SHADER_TEXTURE_BITMAP_OPTIONS,
  bufferFormats: SHADER_BUFFER_FORMATS,
  paneLimit: MOST_GLASS_PANE_COUNT,
  resolutionScale: SHADER_LIMITS.runtimeResolutionScale,
  drawShareNumber: SHADER_LIMITS.runtimeDrawShareNumber,
  upscaleNumber: SHADER_LIMITS.runtimeUpscaleNumber,
  // Fewer pixels stop at half the scale a pass starts at on a plain screen: below it, the frame is held instead.
  minimumDrawScaleNumber: (SHADER_LIMITS.runtimeResolutionScale * SHADER_LIMITS.runtimeDrawShareNumber) / 2,
  maximumFps: SHADER_LIMITS.runtimeMaximumFps,
  idleFramesPerSec: SHADER_LIMITS.runtimeIdleFramesPerSec,
  idleTimeoutSec: SHADER_LIMITS.runtimeIdleTimeoutSec,
  stillTimeSec: SHADER_LIMITS.stillTimeSec,
});

/** The shader a screen shows, when it shows one: phone following wide shows wide's. */
async function chosenShader(env: BackgroundEnv, game: Game, screen: BackgroundScreen) {
  const backgrounds = await backgroundsFor(env.DB, game.id);
  const background = screen === "phone" && backgrounds.phone.source === "wide" ? backgrounds.wide : backgrounds[screen];
  if (background.source !== "shader" || !background.shader_id) return null;
  const shader = await shaderById(env.DB, background.shader_id);
  return shader && shader.game_id === game.id && shader.review_status === "approved" ? shader : null;
}

const BACKGROUND_FILE_KINDS: Record<string, "page" | "manifest" | "source" | "still" | "texture"> = {
  "_zaisma/background": "page",
  "_zaisma/background.json": "manifest",
  "_zaisma/background.glsl": "source",
  "_zaisma/background-still.png": "still",
  "_zaisma/background-texture": "texture",
};

/**
 * The background files, or null for a path that isn't one. Only for a game players can see on its own address (live, listed
 * or unlisted); the preview runner serves for any game that isn't held or taken down, since it draws only what the
 * developer's own dashboard posts to it.
 */
export async function serveBackground(request: Request, env: BackgroundEnv, game: Game, path: string, base: string): Promise<Response | null> {
  const notFound = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  if (path === "_zaisma/shader-preview") {
    const headers = gameHeaders("text/html; charset=utf-8", env.SITE_ORIGIN);
    headers.set("Cache-Control", "no-cache");
    return new Response(request.method === "HEAD" ? null : runnerPage({ ...runnerConfig(env), isPreview: true }, null), { headers });
  }
  const kind = BACKGROUND_FILE_KINDS[path];
  if (!kind) return null;
  const isShown = game.review_status === "live" && Boolean(game.live_version_id) && (game.visibility === "listed" || game.visibility === "unlisted");
  if (!isShown) return notFound();
  const query = new URL(request.url).searchParams;
  // A chosen shader's files never change: a new choice is a new shader ID in the runner's links, and a texture is a new image ID.
  const served = (body: ReadableStream | string | null, contentType: string) => {
    const headers = gameHeaders(contentType, env.SITE_ORIGIN);
    headers.set("Cache-Control", "public, max-age=300");
    return new Response(request.method === "HEAD" ? null : body, { headers });
  };
  if (kind === "texture") {
    // Only an approved shader texture of this game: what a shader reads, never another picture of it or another game's.
    const image = await imageById(env.DB, query.get("image") ?? "");
    if (!image || image.game_id !== game.id || image.kind !== "shader_texture" || image.review_status !== "approved") return notFound();
    const object = await env.GAMES.get(imageKey(image));
    return object ? served(object.body, image.content_type) : notFound();
  }
  const screen = query.get("screen");
  if (screen !== "wide" && screen !== "phone") return notFound();
  const shader = await chosenShader(env, game, screen);
  if (!shader) return notFound();
  if (kind === "page") {
    const headers = gameHeaders("text/html; charset=utf-8", env.SITE_ORIGIN);
    headers.set("Cache-Control", "no-cache");
    const page = runnerPage(
      { ...runnerConfig(env), isPreview: false, manifestUrl: `${base}_zaisma/background.json?screen=${screen}&shader=${shader.id}`, textureUrl: `${base}_zaisma/background-texture?image=` },
      `${base}_zaisma/background-still.png?screen=${screen}&shader=${shader.id}`,
      shader.placeholder_data_url,
      shader.average_color,
    );
    return new Response(request.method === "HEAD" ? null : page, { headers });
  }
  if (kind === "manifest") {
    // A shader sent before buffers (0134) has no manifest: its source alone is its image pass.
    const stored = await env.GAMES.get(shaderManifestKey(game.id, shader.id));
    if (stored) return served(stored.body, "application/json; charset=utf-8");
    const source = await env.GAMES.get(shaderKey(game.id, shader.id));
    return source ? served(JSON.stringify(shaderManifestFromSource(await source.text())), "application/json; charset=utf-8") : notFound();
  }
  const object = await env.GAMES.get(kind === "source" ? shaderKey(game.id, shader.id) : shaderStillKey(game.id, shader.id));
  return object ? served(object.body, kind === "source" ? "text/plain; charset=utf-8" : "image/png") : notFound();
}
