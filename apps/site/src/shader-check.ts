import puppeteer from "@cloudflare/puppeteer";
import {
  KNOWN_IMAGE_CODE,
  SHADER_LIMITS,
  SHADER_TEXTURE_BITMAP_OPTIONS,
  SHADER_VERTEX_SOURCE,
  audit,
  gameById,
  heldImageKey,
  imageById,
  imageKey,
  iso,
  reviewReason,
  setBackgroundTone,
  settleShader,
  shaderById,
  shaderChannelSampling,
  shaderFrameKey,
  shaderKey,
  shaderManifestFromSource,
  shaderManifestKey,
  shaderPassesInDrawOrder,
  shaderReadsQuality,
  shaderStillKey,
  shaderTextureImageIds,
  wrapShader,
  wrapShaderPass,
  type BackgroundScreen,
  type BackgroundTone,
  type Game,
  type GameShader,
  type ImageMatcher,
  type ReviewReason,
  type ShaderBufferName,
  type ShaderChannel,
  type ShaderCheckJob,
  type ShaderManifest,
  type ShaderQualityCheck,
} from "@zaisma/core";
import { pngPixels, toneOfPng } from "./background-tone.ts";
import { sendAlert } from "./email.ts";
import type { Env } from "./env.ts";
import { judgeShaderPictures } from "./listing-check.ts";
import type { ListingJudge } from "./listing-judge.ts";
import { KNOWN_IMAGE_ALERT, imageMatcher } from "./scan.ts";

/**
 * The shader check (Backgrounds in docs/DEVELOPER-API.md): every shader a game sends for its background is drawn before anyone
 * sees it, on Cloudflare Browser Rendering (headless Chromium, WebGL2 through SwiftShader), in a blank page that loads nothing.
 * Every pass must compile; its frames are drawn in order from iTime 0, buffers then the image pass each frame, and timed at each
 * quality level the shader reads (each median against that level's most) and their brightness read for flashes (WCAG 2.3.1: no more
 * than three in any one second); then a still frame and sampled frames are saved and go through the safety checks pictures get, image
 * matching and the listing check. Upload queues { shaderCheckId } on the scan queue. The same drawing, run before anything is sent
 * (runShaderDraft), answers with a sheet picture of the shader under Zaisma's glass and notes that never hold it.
 */

/** One quality level's timed frames. */
export interface ShaderLevelRender {
  qualityLevel: number;
  /** Each timed frame's draw, in milliseconds. Fewer than checkFrameCount when it stopped early for being slow. */
  frameTimesMs: number[];
  /** Each timed frame's mean relative luminance, 0 to 1. */
  frameLuminances: number[];
}

/** One shader on the check's renderer: what it drew, or the first compiler error. */
export interface ShaderRender {
  /** The compiler's first error line, a buffer's starting with its name; null when every pass compiled. */
  compileError: string | null;
  /** The reference shader's frames, timed in the same browser first; empty when none was given. */
  referenceFrameTimesMs: number[];
  /** Each quality level timed, in order; a level after one far too slow isn't drawn. */
  levels: ShaderLevelRender[];
  /** The still at stillTimeSec, at its full size (checkSizes), as PNG. */
  stillPng: Uint8Array | null;
  /** The still again at the check's size, for the listing check and its tone (the full one can be over its size limit). */
  smallStillPng: Uint8Array | null;
  /** sampledFrameCount frames over the first sampledFramesOverSec seconds, as PNG: at the check's size, or the still's for a shader with buffers. */
  framePngs: Uint8Array[];
  /** Two frames drawn 1/30 s apart at the check's size, for the shimmer note; only when the sheet was asked for. */
  shimmerPngs: Uint8Array[];
  /** The sheet picture a check before sending answers with; only when it was asked for. */
  sheetPng: Uint8Array | null;
}

/** What the renderer draws: the passes in draw order, each its whole fragment shader (wrapShaderPass), and the textures they read. */
export interface ShaderRenderInput {
  passes: { bufferName: ShaderBufferName | null; fragmentSource: string; channels: ShaderChannel[] }[];
  /** Each texture a channel names, by its image_id: a missing one reads black. */
  textures: { imageId: string; bytes: Uint8Array }[];
  screen: BackgroundScreen;
  /** Timed first, to measure the renderer's speed. */
  referenceSource: string;
  /** The levels to time, each from iTime 0: all three for a shader that reads iQuality, else level 0 alone. */
  qualityLevels: number[];
  /** Whether to draw the sheet and the frames for the shimmer note too: a check before sending. */
  isSheetWanted: boolean;
}

export type ShaderRenderer = (input: ShaderRenderInput) => Promise<ShaderRender>;

/*
 * What the check times first, to measure the renderer's speed: Zaisma's own background, light, as it was when the quality levels' limits
 * were set (Oct 21 and 23, 2026), copied here and never changed, so a new Zaisma's own never moves every game's limit.
 */
const CHECK_REFERENCE_HELPERS = `
float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 h22(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), u.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), u.x), u.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 1.7; a *= 0.5; } return v; }
// Soft particles in a grid of cells: each cell holds at most one, at a random spot, drifting with the grid.
float motes(vec2 p, float size, float chance, float seed) {
  vec2 id = floor(p), f = fract(p) - 0.5; vec2 r = h22(id + seed) - 0.5;
  float on = step(1.0 - chance, h2(id + seed * 1.3));
  float d = length(f - r * 0.7);
  return on * smoothstep(size, 0.0, d);
}
`;
const CHECK_REFERENCE_ZAISMA = `
void mainImage(out vec4 o, in vec2 f) {
  vec2 uv = f / iResolution.xy; float ar = iResolution.x / iResolution.y; float t = iTime;
  vec2 p = vec2(uv.x * ar, uv.y) * 3.6;
  vec2 g = floor(p), fr = fract(p); float d1 = 8.0, d2 = 8.0; vec2 cid = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o2 = vec2(float(i), float(j)); vec2 h = h22(g + o2);
    vec2 pt = o2 + 0.5 + 0.36 * sin(t * 0.11 + 6.2831 * h);
    vec2 r = pt - fr; float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; cid = g + o2; } else if (d < d2) d2 = d;
  }
  vec2 tilt = h22(cid * 1.7) - 0.5;
  vec2 sun = vec2(cos(t * 0.04), sin(t * 0.04));
  float shade = 0.5 + 0.5 * dot(normalize(tilt + 0.001), sun) * length(tilt) * 1.6;
  float sweep = exp(-pow(uv.x * 0.8 + uv.y * 0.5 - (fract(t * 0.025) * 2.4 - 0.4), 2.0) * 24.0);
  float edge = sqrt(d2) - sqrt(d1);
  vec3 orange = vec3(0.969, 0.576, 0.102);
  vec2 P = vec2(uv.x * ar, uv.y); float core = 0.0, glow = 0.0, near = 0.0;
  for (int k = 0; k < 7; k++) {
    float fk = float(k); vec2 hk = h22(vec2(fk * 7.13 + 1.0, fk * 3.71 + 2.0)); float sp = 0.05 + 0.06 * hk.x;
    vec2 c = vec2(ar * (0.5 + 0.38 * sin(t * sp + 6.2831 * hk.y) + 0.1 * sin(t * sp * 2.3 + fk * 1.7)),
                  0.5 + 0.34 * cos(t * sp * 0.83 + 6.2831 * hk.x) + 0.1 * sin(t * sp * 1.9 + fk * 2.9));
    vec2 q = P - c; float dia = abs(q.x) + abs(q.y); float br = 0.6 + 0.4 * sin(t * 0.9 + fk * 1.3);
    core = max(core, smoothstep(0.015, 0.0105, dia));
    glow += exp(-dia * 36.0) * br;
    near += exp(-length(q) * 7.0) * br;
  }
  float seam = 1.0 - smoothstep(0.0, 0.024, edge);
  // Light: pearl-white facets.
  vec3 light = mix(vec3(0.885, 0.905, 0.94), vec3(1.0), shade);
  light += vec3(1.0, 0.97, 0.92) * sweep * 0.05;
  light = mix(light, vec3(1.0), (1.0 - smoothstep(0.0, 0.04, edge)) * 0.75);
  light -= (1.0 - smoothstep(0.0, 0.012, edge)) * 0.045;
  light = mix(light, orange, seam * min(near, 1.0) * 0.4);
  light += orange * glow * 0.28;
  light = mix(light, orange, core);
  light *= 0.975 + 0.04 * uv.y;
  // Dark: graphite facets under a cool sweep, the nodes glowing onto them.
  vec3 dark = mix(vec3(0.062, 0.072, 0.092), vec3(0.135, 0.152, 0.188), shade);
  dark += vec3(0.55, 0.66, 0.9) * sweep * 0.045;
  dark = mix(dark, vec3(0.27, 0.3, 0.36), (1.0 - smoothstep(0.0, 0.03, edge)) * 0.55);
  dark -= (1.0 - smoothstep(0.0, 0.01, edge)) * 0.03;
  dark += orange * min(near, 1.5) * 0.07;
  dark += orange * seam * min(near, 1.0) * 0.85;
  dark += orange * glow * 0.7;
  dark = mix(dark, vec3(1.0, 0.74, 0.34), core);
  dark *= 0.88 + 0.16 * uv.y;
  o = vec4(mix(light, dark, iDark), 1.0);
}`;
export const CHECK_REFERENCE_SHADER = wrapShader(`uniform float iDark;\n${CHECK_REFERENCE_HELPERS}${CHECK_REFERENCE_ZAISMA}`);

/** Frames the reference is timed over. */
const REFERENCE_FRAME_COUNT = 30;
/** The frame of level 0's timed run, and the next, whose change the shimmer note reads. */
const SHIMMER_FRAME_INDEX = 60;

/**
 * The sheet a check before sending answers with, as Zaisma's pages would show the shader: wide (a 1440 × 900 window, drawn at about the
 * pixels a desktop draws) and phone (320 × 667), each under a pane of glass picked as the pages pick it; small; what changes between
 * two frames 1/30 s apart, magnified 6 times, where speckle is shimmer; and the small view's middle pixel for pixel.
 */
const SHEET_VIEWS = {
  wide: { widthPx: 720, heightPx: 450, cssWidthPx: 1440, cssHeightPx: 900, qualityLevel: 2, pane: [96, 300, 460, 300] },
  phone: { widthPx: 168, heightPx: 350, cssWidthPx: 320, cssHeightPx: 667, qualityLevel: 0, pane: [16, 430, 288, 210] },
  small: { widthPx: 400, heightPx: 225, cssWidthPx: 400, cssHeightPx: 225, qualityLevel: 0, pane: null },
};

/** The check's page: no network, nothing but a canvas and the script that draws on it. Textures come in as base64 parts first. */
const CHECK_PAGE = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; img-src data: blob:"><body style="margin:0"><script>
window.zaismaTextureParts = [];
window.zaismaTexturePart = function (index, part) { (window.zaismaTextureParts[index] = window.zaismaTextureParts[index] || []).push(part); };
window.zaismaCheck = async function (input) {
  var canvas = document.createElement("canvas"); canvas.width = input.checkWidthPx; canvas.height = input.checkHeightPx; document.body.appendChild(canvas);
  var gl = canvas.getContext("webgl2", { antialias: false, depth: false, stencil: false, alpha: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error("No WebGL2 on the renderer");
  var canDrawFloat = !!gl.getExtension("EXT_color_buffer_float");
  var step = input.checkFrameStepSec;
  var drawn = { compileError: null, referenceFrameTimesMs: [], levels: [], stillDataUrl: null, smallStillDataUrl: null, frameDataUrls: [], shimmerDataUrls: [], sheetDataUrl: null };
  function compile(kind, source) { var shader = gl.createShader(kind); gl.shaderSource(shader, source); gl.compileShader(shader); return shader; }
  function firstLine(log, fallback) { return (log || "").split("\\n").map(function (line) { return line.trim(); }).filter(Boolean)[0] || fallback; }
  var vertex = compile(gl.VERTEX_SHADER, input.vertexSource);
  gl.bindVertexArray(gl.createVertexArray());
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  var UNIFORMS = ["iResolution", "iTime", "iTimeDelta", "iFrame", "iQuality", "iChannel0", "iChannel1", "iChannel2", "iChannel3", "iChannelResolution", "iGlassPanes", "iGlassPaneCount", "zaismaPaneCuts", "zaismaPixel", "zaismaViewOffset"];
  // A fragment shader built into a program, or its first compiler error.
  function build(fragmentSource) {
    var fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
    if (!gl.getShaderParameter(fragment, gl.COMPILE_STATUS)) return { error: firstLine(gl.getShaderInfoLog(fragment), "It didn't compile.") };
    var program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.bindAttribLocation(program, 0, "corner"); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return { error: firstLine(gl.getProgramInfoLog(program), "It didn't link.") };
    var at = {}; UNIFORMS.forEach(function (name) { at[name] = gl.getUniformLocation(program, name); });
    return { program: program, at: at };
  }
  // Textures: decoded from their bytes, upright as on Shadertoy, with mipmaps.
  var textures = [];
  for (var t = 0; t < input.textureCount; t++) {
    var binary = atob((window.zaismaTextureParts[t] || []).join("")), bytes = new Uint8Array(binary.length);
    for (var b = 0; b < binary.length; b++) bytes[b] = binary.charCodeAt(b);
    var bitmap = await createImageBitmap(new Blob([bytes]), input.bitmapOptions);
    var texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap); gl.generateMipmap(gl.TEXTURE_2D);
    textures.push({ texture: texture, widthPx: bitmap.width, heightPx: bitmap.height });
  }
  var black = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, black);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  var samplers = {};
  function samplerFor(channel) {
    var key = channel.minificationFilterName + " " + channel.magnificationFilterName + " " + channel.wrapName;
    if (!samplers[key]) {
      var sampler = gl.createSampler();
      gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, gl[channel.minificationFilterName]); gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, gl[channel.magnificationFilterName]);
      gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, gl[channel.wrapName]); gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, gl[channel.wrapName]);
      samplers[key] = sampler;
    }
    return samplers[key];
  }
  var passes = [];
  for (var p = 0; p < input.passes.length; p++) {
    var built = build(input.passes[p].fragmentSource);
    if (built.error) { drawn.compileError = (input.passes[p].bufferName ? "buffer " + input.passes[p].bufferName + ": " : "") + built.error; return drawn; }
    passes.push({ spec: input.passes[p], program: built.program, at: built.at, targets: null, front: 0 });
  }
  var size = { widthPx: 0, heightPx: 0 };
  // A buffer's two pictures, drawn in turn: half floats where the browser can draw to them, else 8 bits a channel; each starts empty.
  function target(widthPx, heightPx) {
    var texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
    if (canDrawFloat) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, widthPx, heightPx, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, widthPx, heightPx, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    var framebuffer = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    return { texture: texture, framebuffer: framebuffer };
  }
  // A new size starts every buffer empty, as a runner's resize does.
  function setSize(widthPx, heightPx) {
    canvas.width = widthPx; canvas.height = heightPx; size.widthPx = widthPx; size.heightPx = heightPx;
    passes.forEach(function (pass) {
      if (!pass.spec.bufferName) return;
      if (pass.targets) pass.targets.forEach(function (old) { gl.deleteTexture(old.texture); gl.deleteFramebuffer(old.framebuffer); });
      pass.targets = [target(widthPx, heightPx), target(widthPx, heightPx)]; pass.front = 0;
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  // One frame: each buffer a to d onto its next picture, reading the newest picture of each buffer it names (its own last frame for
  // itself), then the image pass onto the canvas. imageOnly draws the image pass again over the same buffers, under glass.
  function drawFrame(list, frame) {
    for (var index = 0; index < list.length; index++) {
      var pass = list[index];
      if (frame.imageOnly && pass.spec.bufferName) continue;
      var into = pass.spec.bufferName ? pass.targets[1 - pass.front] : null, at = pass.at;
      gl.bindFramebuffer(gl.FRAMEBUFFER, into ? into.framebuffer : null);
      gl.viewport(0, 0, size.widthPx, size.heightPx);
      gl.useProgram(pass.program);
      gl.uniform3f(at.iResolution, size.widthPx, size.heightPx, 1); gl.uniform1f(at.iTime, frame.timeSec); gl.uniform1f(at.iTimeDelta, frame.deltaSec);
      gl.uniform1i(at.iFrame, frame.frameIndex); gl.uniform1f(at.iQuality, frame.qualityLevel);
      var resolutions = new Float32Array(12);
      for (var unit = 0; unit < 4; unit++) {
        var channel = null;
        for (var c = 0; c < pass.spec.channels.length; c++) if (pass.spec.channels[c].channelIndex === unit) channel = pass.spec.channels[c];
        gl.activeTexture(gl.TEXTURE0 + unit);
        if (channel && channel.bufferPassIndex >= 0) {
          var source = passes[channel.bufferPassIndex];
          gl.bindTexture(gl.TEXTURE_2D, source.targets[source.front].texture); gl.bindSampler(unit, samplerFor(channel));
          resolutions[unit * 3] = size.widthPx; resolutions[unit * 3 + 1] = size.heightPx; resolutions[unit * 3 + 2] = 1;
        } else if (channel && channel.textureIndex >= 0) {
          var read = textures[channel.textureIndex];
          gl.bindTexture(gl.TEXTURE_2D, read.texture); gl.bindSampler(unit, samplerFor(channel));
          resolutions[unit * 3] = read.widthPx; resolutions[unit * 3 + 1] = read.heightPx; resolutions[unit * 3 + 2] = 1;
        } else { gl.bindTexture(gl.TEXTURE_2D, black); gl.bindSampler(unit, null); }
        gl.uniform1i(at["iChannel" + unit], unit);
      }
      gl.uniform3fv(at.iChannelResolution, resolutions);
      var panes = frame.panes || [], rects = new Float32Array(64), cuts = new Float32Array(64);
      for (var i = 0; i < panes.length; i++) { rects.set(panes[i].rect, i * 4); cuts.set(panes[i].cuts, i * 4); }
      gl.uniform4fv(at.iGlassPanes, rects); gl.uniform1i(at.iGlassPaneCount, panes.length);
      gl.uniform4fv(at.zaismaPaneCuts, cuts); gl.uniform1f(at.zaismaPixel, frame.pixelScale || 1); gl.uniform2f(at.zaismaViewOffset, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (into) pass.front = 1 - pass.front;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  var onePixel = new Uint8Array(4);
  // Reading a pixel waits until the frame is really drawn.
  function finish() { gl.finish(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, onePixel); }
  function pixels() { var read = new Uint8Array(size.widthPx * size.heightPx * 4); gl.readPixels(0, 0, size.widthPx, size.heightPx, gl.RGBA, gl.UNSIGNED_BYTE, read); return read; }
  function linear(value) { value /= 255; return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4); }
  function luminance(read) { var sum = 0, count = 0; for (var q = 0; q < read.length; q += 4 * 7) { sum += 0.2126 * linear(read[q]) + 0.7152 * linear(read[q + 1]) + 0.0722 * linear(read[q + 2]); count++; } return sum / count; }

  // The renderer's speed varies from browser to browser, so a known shader is timed first, in the same browser, to measure against.
  var reference = build(input.referenceSource);
  if (reference.error) throw new Error("The reference shader didn't compile: " + reference.error);
  var referenceList = [{ spec: { bufferName: null, channels: [] }, program: reference.program, at: reference.at }];
  setSize(input.checkWidthPx, input.checkHeightPx);
  for (var r = 0; r < input.referenceFrameCount; r++) {
    var referenceStartedMs = performance.now();
    drawFrame(referenceList, { timeSec: r * step, deltaSec: step, frameIndex: r, qualityLevel: 0 }); finish();
    drawn.referenceFrameTimesMs.push(performance.now() - referenceStartedMs);
  }
  var sortedReference = drawn.referenceFrameTimesMs.slice().sort(function (first, second) { return first - second; });
  var speedNumber = sortedReference[Math.floor(sortedReference.length / 2)] / input.referenceFrameMs;
  var shimmerPixels = [];
  for (var l = 0; l < input.qualityLevels.length; l++) {
    var qualityLevel = input.qualityLevels[l], slowFrameMs = input.maximumCheckFrameMsByLevel[qualityLevel] * speedNumber;
    var level = { qualityLevel: qualityLevel, frameTimesMs: [], frameLuminances: [] };
    drawn.levels.push(level);
    setSize(input.checkWidthPx, input.checkHeightPx);
    for (var n = 0; n < input.checkFrameCount; n++) {
      var startedMs = performance.now();
      drawFrame(passes, { timeSec: n * step, deltaSec: step, frameIndex: n, qualityLevel: qualityLevel }); finish();
      level.frameTimesMs.push(performance.now() - startedMs);
      var read = pixels();
      level.frameLuminances.push(luminance(read));
      if (input.isSheetWanted && l === 0 && (n === input.shimmerFrameIndex || n === input.shimmerFrameIndex + 1)) { drawn.shimmerDataUrls.push(canvas.toDataURL("image/png")); shimmerPixels.push(read); }
      // Far over the limit: no need to draw the rest, or the other levels. The frames so far, past the first (which compiles),
      // must be, not one frame: a browser can stall a frame now and then, and on a fast GPU that alone is many times the limit.
      if (n >= 4) {
        var sortedSoFar = level.frameTimesMs.slice(1).sort(function (first, second) { return first - second; });
        if (sortedSoFar[Math.floor(sortedSoFar.length / 2)] > slowFrameMs * 4) return drawn;
      }
    }
  }

  // The still and the sampled frames, at the level the screen runs. A single pass draws each moment at once; a shader with buffers runs
  // its history again from iTime 0 at the still's size, each frameStepSec to the still, then sampledHistoryStepSec on.
  var stillLevel = input.stillQualityLevel, stillFrameIndex = Math.round(input.stillTimeSec / step);
  function snapshot(widthPx, heightPx) { var copy = document.createElement("canvas"); copy.width = widthPx || canvas.width; copy.height = heightPx || canvas.height; copy.getContext("2d").drawImage(canvas, 0, 0, copy.width, copy.height); return copy; }
  if (!input.isBuffered) {
    setSize(input.checkWidthPx, input.checkHeightPx);
    drawFrame(passes, { timeSec: input.stillTimeSec, deltaSec: step, frameIndex: stillFrameIndex, qualityLevel: stillLevel });
    drawn.smallStillDataUrl = canvas.toDataURL("image/png");
    drawn.frameDataUrls = input.sampledTimesSec.map(function (timeSec) { drawFrame(passes, { timeSec: timeSec, deltaSec: step, frameIndex: Math.round(timeSec / step), qualityLevel: stillLevel }); return canvas.toDataURL("image/png"); });
    setSize(input.stillWidthPx, input.stillHeightPx);
    drawFrame(passes, { timeSec: input.stillTimeSec, deltaSec: step, frameIndex: stillFrameIndex, qualityLevel: stillLevel });
    drawn.stillDataUrl = canvas.toDataURL("image/png");
  } else {
    setSize(input.stillWidthPx, input.stillHeightPx);
    var lastTimeSec = input.sampledTimesSec[input.sampledTimesSec.length - 1], sampleIndex = 0;
    var frameCount = stillFrameIndex + Math.ceil((lastTimeSec - input.stillTimeSec) / input.sampledHistoryStepSec - 1e-6);
    for (var k = 0; k <= frameCount; k++) {
      var isBeforeStill = k <= stillFrameIndex, timeSec = isBeforeStill ? k * step : input.stillTimeSec + (k - stillFrameIndex) * input.sampledHistoryStepSec;
      drawFrame(passes, { timeSec: timeSec, deltaSec: isBeforeStill ? step : input.sampledHistoryStepSec, frameIndex: k, qualityLevel: stillLevel });
      if (k === stillFrameIndex) { drawn.stillDataUrl = canvas.toDataURL("image/png"); drawn.smallStillDataUrl = snapshot(input.checkWidthPx, input.checkHeightPx).toDataURL("image/png"); }
      while (sampleIndex < input.sampledTimesSec.length && timeSec >= input.sampledTimesSec[sampleIndex] - 1e-6) { drawn.frameDataUrls.push(canvas.toDataURL("image/png")); sampleIndex++; }
    }
  }
  if (!input.isSheetWanted) return drawn;

  // The sheet. The glass over each view is picked as Zaisma's pages pick it (background-tone.ts): light or smoked, as thin as words allow.
  function shade(color) { return 0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2]); }
  function contrast(first, second) { var a = shade(first), z = shade(second); return (Math.max(a, z) + 0.05) / (Math.min(a, z) + 0.05); }
  function blend(from, to, share) { return [from[0] + (to[0] - from[0]) * share, from[1] + (to[1] - from[1]) * share, from[2] + (to[2] - from[2]) * share]; }
  function thinnest(isSmoked, base, sorted) {
    var harsh = isSmoked ? sorted[Math.floor(sorted.length * 0.75)] : sorted[Math.floor(sorted.length * 0.25)];
    for (var share = 0.3; share <= 0.95; share += 0.02) {
      var seen = blend(harsh, base, share), ink = isSmoked ? [247, 249, 252] : [20, 23, 28], quiet = isSmoked ? blend(seen, ink, 0.7) : [89, 96, 106];
      if (contrast(seen, quiet) >= 4.5 && contrast(seen, ink) >= 6) return share;
    }
    return 0.95;
  }
  function pickGlass(read) {
    var colors = [], skip = 4 * Math.max(1, Math.floor(read.length / 4 / 2400));
    for (var q = 0; q < read.length; q += skip) colors.push([read[q], read[q + 1], read[q + 2]]);
    var sum = colors.reduce(function (total, color) { return [total[0] + color[0], total[1] + color[1], total[2] + color[2]]; }, [0, 0, 0]), average = sum.map(function (value) { return value / colors.length; });
    var sorted = colors.slice().sort(function (first, second) { return shade(first) - shade(second); });
    var light = blend([255, 255, 255], average, 0.1), smoked = blend([12, 15, 20], average, 0.3), lightShare = thinnest(false, light, sorted), smokedShare = thinnest(true, smoked, sorted);
    var isSmoked = lightShare > smokedShare;
    return { isSmoked: isSmoked, base: (isSmoked ? smoked : light).map(Math.round), share: Math.min(lightShare, smokedShare) };
  }
  function drawView(view) {
    setSize(view.widthPx, view.heightPx);
    var scale = view.widthPx / view.cssWidthPx;
    for (var k = input.isBuffered ? 0 : stillFrameIndex; k <= stillFrameIndex; k++) drawFrame(passes, { timeSec: k * step, deltaSec: step, frameIndex: k, qualityLevel: view.qualityLevel });
    var pick = pickGlass(pixels()), plain = snapshot();
    if (!view.pane) return { plain: plain, glassed: plain, pick: pick };
    var r = view.pane, rect = [r[0] * scale, (view.cssHeightPx - r[1] - r[3]) * scale, (r[0] + r[2]) * scale, (view.cssHeightPx - r[1]) * scale];
    drawFrame(passes, { timeSec: stillFrameIndex * step, deltaSec: step, frameIndex: stillFrameIndex, qualityLevel: view.qualityLevel, imageOnly: true, pixelScale: scale, panes: [{ rect: rect, cuts: [18 * scale, 0, 18 * scale, 14 * scale + (pick.isSmoked ? 4096 : 0)] }] });
    return { plain: plain, glassed: snapshot(), pick: pick };
  }
  function cutPath(context, x, y, w, h, a, z) { context.beginPath(); context.moveTo(x + a, y); context.lineTo(x + w, y); context.lineTo(x + w, y + h - a); context.lineTo(x + w - a, y + h); context.lineTo(x + z, y + h); context.lineTo(x, y + h - z); context.lineTo(x, y + a); context.closePath(); }
  function glassOver(context, image, dx, dy, dw, dh, view, pick) {
    var sx = dw / view.cssWidthPx, sy = dh / view.cssHeightPx, x = dx + view.pane[0] * sx, y = dy + view.pane[1] * sy, w = view.pane[2] * sx, h = view.pane[3] * sy;
    context.save(); cutPath(context, x, y, w, h, 18 * sx, 14 * sx); context.clip();
    context.filter = "blur(" + Math.round(18 * sx) + "px) saturate(1.4)"; context.drawImage(image, dx, dy, dw, dh); context.filter = "none";
    context.fillStyle = "rgba(" + pick.base.join(",") + "," + pick.share.toFixed(2) + ")"; context.fillRect(x, y, w, h);
    context.restore();
    context.save(); cutPath(context, x + 0.5, y + 0.5, w - 1, h - 1, 18 * sx, 14 * sx); context.strokeStyle = pick.isSmoked ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.7)"; context.lineWidth = 1; context.stroke(); context.restore();
    context.fillStyle = pick.isSmoked ? "#F7F9FC" : "#14171C"; context.font = "600 " + Math.round(20 * sx) + "px sans-serif"; context.fillText("Your game", x + 20 * sx, y + 38 * sy);
    context.fillStyle = pick.isSmoked ? "rgba(247,249,252,0.72)" : "#59606A"; context.font = "500 " + Math.round(13 * sx) + "px sans-serif"; context.fillText("Words on Zaisma's glass", x + 20 * sx, y + 62 * sy);
  }
  function label(context, text, x, y) { context.font = "500 12px monospace"; context.fillStyle = "rgba(0,0,0,0.65)"; context.fillRect(x, y, context.measureText(text).width + 10, 18); context.fillStyle = "#fff"; context.fillText(text, x + 5, y + 13); }
  var sheet = document.createElement("canvas"); sheet.width = 1280; sheet.height = 745;
  var context = sheet.getContext("2d"); context.fillStyle = "#1a1d22"; context.fillRect(0, 0, sheet.width, sheet.height);
  var views = input.sheetViews, wide = drawView(views.wide), phone = drawView(views.phone), small = drawView(views.small);
  context.drawImage(wide.glassed, 0, 0, 800, 500); glassOver(context, wide.glassed, 0, 0, 800, 500, views.wide, wide.pick);
  label(context, "wide, quality " + views.wide.qualityLevel + ", " + (wide.pick.isSmoked ? "smoked" : "light") + " glass " + wide.pick.share.toFixed(2), 6, 6);
  context.drawImage(phone.glassed, 810, 0, 240, 500); glassOver(context, phone.glassed, 810, 0, 240, 500, views.phone, phone.pick);
  label(context, "phone, quality " + views.phone.qualityLevel, 814, 6);
  context.imageSmoothingEnabled = false; context.drawImage(small.plain, 163, 57, 73, 111, 1060, 0, 220, 334); context.imageSmoothingEnabled = true;
  label(context, "small, pixels x3", 1064, 6);
  context.drawImage(small.plain, 0, 510, 400, 225); label(context, "small, " + views.small.widthPx + " by " + views.small.heightPx, 4, 514);
  if (shimmerPixels.length === 2) {
    var widthPx = input.checkWidthPx, heightPx = input.checkHeightPx, change = context.createImageData(widthPx, heightPx), first = shimmerPixels[0], second = shimmerPixels[1];
    for (var y = 0; y < heightPx; y++) for (var x = 0; x < widthPx; x++) {
      var from = ((heightPx - 1 - y) * widthPx + x) * 4, to = (y * widthPx + x) * 4;
      for (var channelIndex = 0; channelIndex < 3; channelIndex++) change.data[to + channelIndex] = Math.min(255, Math.abs(first[from + channelIndex] - second[from + channelIndex]) * 6);
      change.data[to + 3] = 255;
    }
    var changeCanvas = document.createElement("canvas"); changeCanvas.width = widthPx; changeCanvas.height = heightPx; changeCanvas.getContext("2d").putImageData(change, 0, 0);
    context.drawImage(changeCanvas, 410, 510, 400, 225); label(context, "change in 1/30 s, x6", 414, 514);
  }
  context.font = "500 13px monospace"; context.fillStyle = "#d8dce3";
  drawn.levels.forEach(function (timed, index) {
    var sorted = timed.frameTimesMs.slice().sort(function (first, second) { return first - second; }), frameMs = sorted[Math.floor(sorted.length / 2)] / speedNumber;
    context.fillText("quality " + timed.qualityLevel + ": " + frameMs.toFixed(1) + " ms a frame, the most " + input.maximumCheckFrameMsByLevel[timed.qualityLevel], 830, 540 + index * 22);
  });
  drawn.sheetDataUrl = sheet.toDataURL("image/png");
  return drawn;
};</script>`;

/** The sizes a screen is checked and stilled at: landscape for wide, portrait for phones; a shader with buffers stills smaller. */
export function checkSizes(screen: BackgroundScreen, isBuffered = false): { checkWidthPx: number; checkHeightPx: number; stillWidthPx: number; stillHeightPx: number } {
  const { checkWidthPx, checkHeightPx } = SHADER_LIMITS;
  const [stillWidthPx, stillHeightPx] = isBuffered ? [SHADER_LIMITS.bufferedStillWidthPx, SHADER_LIMITS.bufferedStillHeightPx] : [SHADER_LIMITS.stillWidthPx, SHADER_LIMITS.stillHeightPx];
  return screen === "wide" ? { checkWidthPx, checkHeightPx, stillWidthPx, stillHeightPx } : { checkWidthPx: checkHeightPx, checkHeightPx: checkWidthPx, stillWidthPx: stillHeightPx, stillHeightPx: stillWidthPx };
}

/** When the sampled frames are drawn: spread evenly over the first sampledFramesOverSec seconds. */
export const SAMPLED_TIMES_SEC = Array.from({ length: SHADER_LIMITS.sampledFrameCount }, (_, frameIndex) => (frameIndex * SHADER_LIMITS.sampledFramesOverSec) / (SHADER_LIMITS.sampledFrameCount - 1));

/** Base64 parts a texture goes to the page in, so no one message to the browser is big. */
const TEXTURE_PART_SIZE_BYTES = 768 * 1024;

function fromDataUrl(dataUrl: string | null): Uint8Array | null {
  if (!dataUrl) return null;
  const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += 0x8000) binary += String.fromCharCode(...bytes.subarray(byteIndex, byteIndex + 0x8000));
  return btoa(binary);
}

/** What the page is given: the passes with each channel resolved to the pass or texture it reads and how it samples it. */
function pageInput(input: ShaderRenderInput) {
  const isBuffered = input.passes.some((pass) => pass.bufferName !== null);
  return {
    vertexSource: SHADER_VERTEX_SOURCE,
    bitmapOptions: SHADER_TEXTURE_BITMAP_OPTIONS,
    passes: input.passes.map((pass) => ({
      bufferName: pass.bufferName,
      fragmentSource: pass.fragmentSource,
      channels: pass.channels.map((channel) => ({
        channelIndex: channel.channel_index,
        bufferPassIndex: channel.input_kind === "buffer" ? input.passes.findIndex((other) => other.bufferName === channel.buffer_name) : -1,
        textureIndex: channel.input_kind === "texture" ? input.textures.findIndex((texture) => texture.imageId === channel.image_id) : -1,
        ...shaderChannelSampling(channel),
      })),
    })),
    textureCount: input.textures.length,
    referenceSource: input.referenceSource,
    referenceFrameCount: REFERENCE_FRAME_COUNT,
    referenceFrameMs: SHADER_LIMITS.referenceFrameMs,
    ...checkSizes(input.screen, isBuffered),
    isBuffered,
    qualityLevels: input.qualityLevels,
    maximumCheckFrameMsByLevel: Object.fromEntries(SHADER_LIMITS.qualityLevels.map((level) => [level.qualityLevel, level.maximumCheckFrameMs])),
    stillQualityLevel: input.qualityLevels.length > 1 ? SHADER_LIMITS.stillQualityLevelByScreen[input.screen] : input.qualityLevels[0],
    checkFrameCount: SHADER_LIMITS.checkFrameCount,
    checkFrameStepSec: SHADER_LIMITS.checkFrameStepSec,
    stillTimeSec: SHADER_LIMITS.stillTimeSec,
    sampledTimesSec: SAMPLED_TIMES_SEC,
    sampledHistoryStepSec: SHADER_LIMITS.sampledHistoryStepSec,
    isSheetWanted: input.isSheetWanted,
    shimmerFrameIndex: SHIMMER_FRAME_INDEX,
    sheetViews: SHEET_VIEWS,
  };
}

interface PageDrawing {
  compileError: string | null;
  referenceFrameTimesMs: number[];
  levels: ShaderLevelRender[];
  stillDataUrl: string | null;
  smallStillDataUrl: string | null;
  frameDataUrls: string[];
  shimmerDataUrls: string[];
  sheetDataUrl: string | null;
}

/** The renderer on Cloudflare Browser Rendering (the BROWSER binding): one browser per shader, closed after. */
export function browserShaderRenderer(browserBinding: Fetcher): ShaderRenderer {
  return async (input) => {
    const browser = await puppeteer.launch(browserBinding);
    try {
      const page = await browser.newPage();
      // Nothing the check page asks for leaves it.
      await page.setRequestInterception(true);
      page.on("request", (request) => void request.abort());
      await page.setContent(CHECK_PAGE);
      for (const [textureIndex, texture] of input.textures.entries()) {
        const encoded = toBase64(texture.bytes);
        for (let partStartIndex = 0; partStartIndex < encoded.length; partStartIndex += TEXTURE_PART_SIZE_BYTES) await page.evaluate(`window.zaismaTexturePart(${textureIndex}, ${JSON.stringify(encoded.slice(partStartIndex, partStartIndex + TEXTURE_PART_SIZE_BYTES))})`);
      }
      // An expression, not a function: a bundled function's text can carry helpers the page doesn't have.
      const timeoutMs = SHADER_LIMITS.checkTimeoutSec * 1000;
      const drawn = (await Promise.race([page.evaluate(`window.zaismaCheck(${JSON.stringify(pageInput(input))})`), new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))])) as PageDrawing | null;
      // Out of time: it counts as too slow at the first level, with the time it had.
      if (!drawn) return { compileError: null, referenceFrameTimesMs: [], levels: [{ qualityLevel: input.qualityLevels[0]!, frameTimesMs: [timeoutMs], frameLuminances: [] }], stillPng: null, smallStillPng: null, framePngs: [], shimmerPngs: [], sheetPng: null };
      return {
        compileError: drawn.compileError,
        referenceFrameTimesMs: drawn.referenceFrameTimesMs,
        levels: drawn.levels,
        stillPng: fromDataUrl(drawn.stillDataUrl),
        smallStillPng: fromDataUrl(drawn.smallStillDataUrl),
        framePngs: drawn.frameDataUrls.map((dataUrl) => fromDataUrl(dataUrl)!),
        shimmerPngs: drawn.shimmerDataUrls.map((dataUrl) => fromDataUrl(dataUrl)!),
        sheetPng: fromDataUrl(drawn.sheetDataUrl),
      };
    } finally {
      await browser.close();
    }
  };
}

/**
 * The most flashes in any one second of frames (WCAG 2.3.1's general flash): a flash is a pair of opposing changes in mean
 * relative luminance of at least 0.1, the second within 3 frames of the first, while the darker side is under 0.8.
 */
export function mostFlashesInOneSecond(frameLuminances: number[], frameStepSec: number = SHADER_LIMITS.checkFrameStepSec): number {
  const MINIMUM_CHANGE_NUMBER = 0.1;
  const MOST_FRAMES_BETWEEN_COUNT = 3;
  // Each change of at least 0.1 from the last extreme, in turn: up, down, up…
  const changes: { frameIndex: number; direction: "up" | "down"; darkerLuminanceNumber: number }[] = [];
  let direction: "up" | "down" | null = null;
  let extremeLuminanceNumber = frameLuminances[0] ?? 0;
  let lowestLuminanceNumber = extremeLuminanceNumber;
  let highestLuminanceNumber = extremeLuminanceNumber;
  frameLuminances.forEach((luminanceNumber, frameIndex) => {
    if (direction === null) {
      lowestLuminanceNumber = Math.min(lowestLuminanceNumber, luminanceNumber);
      highestLuminanceNumber = Math.max(highestLuminanceNumber, luminanceNumber);
      if (luminanceNumber - lowestLuminanceNumber >= MINIMUM_CHANGE_NUMBER) changes.push({ frameIndex, direction: (direction = "up"), darkerLuminanceNumber: lowestLuminanceNumber });
      else if (highestLuminanceNumber - luminanceNumber >= MINIMUM_CHANGE_NUMBER) changes.push({ frameIndex, direction: (direction = "down"), darkerLuminanceNumber: luminanceNumber });
      if (direction !== null) extremeLuminanceNumber = luminanceNumber;
      return;
    }
    const isFurther = direction === "up" ? luminanceNumber > extremeLuminanceNumber : luminanceNumber < extremeLuminanceNumber;
    if (isFurther) {
      extremeLuminanceNumber = luminanceNumber;
      return;
    }
    if (Math.abs(luminanceNumber - extremeLuminanceNumber) < MINIMUM_CHANGE_NUMBER) return;
    changes.push({ frameIndex, direction: (direction = direction === "up" ? "down" : "up"), darkerLuminanceNumber: Math.min(luminanceNumber, extremeLuminanceNumber) });
    extremeLuminanceNumber = luminanceNumber;
  });
  // A flash: two changes back to back, close together, from a dark enough side. Each change counts in one flash.
  const flashFrameIndexes: number[] = [];
  for (let changeIndex = 1; changeIndex < changes.length; changeIndex++) {
    const earlier = changes[changeIndex - 1]!;
    const later = changes[changeIndex]!;
    if (later.frameIndex - earlier.frameIndex > MOST_FRAMES_BETWEEN_COUNT || Math.min(earlier.darkerLuminanceNumber, later.darkerLuminanceNumber) >= 0.8) continue;
    flashFrameIndexes.push(later.frameIndex);
    changeIndex++;
  }
  const frameCountPerSec = Math.round(1 / frameStepSec);
  let mostFlashCount = 0;
  for (const startIndex of flashFrameIndexes) mostFlashCount = Math.max(mostFlashCount, flashFrameIndexes.filter((frameIndex) => frameIndex >= startIndex && frameIndex < startIndex + frameCountPerSec).length);
  return mostFlashCount;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((firstNumber, secondNumber) => firstNumber - secondNumber);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
};
const roundedMs = (ms: number) => Math.round(ms * 10) / 10;

/** Each level the renderer timed, scaled to its speed on the reference, and the first that's too slow (cut short, or over its most). */
export function measureQualityLevels(drawn: Pick<ShaderRender, "referenceFrameTimesMs" | "levels">): { qualityChecks: ShaderQualityCheck[]; tooSlow: ShaderQualityCheck | null } {
  const speedScaleNumber = drawn.referenceFrameTimesMs.length ? SHADER_LIMITS.referenceFrameMs / Math.max(0.1, median(drawn.referenceFrameTimesMs)) : 1;
  const qualityChecks: ShaderQualityCheck[] = [];
  let tooSlow: ShaderQualityCheck | null = null;
  for (const level of drawn.levels) {
    const maximumCheckFrameMs = SHADER_LIMITS.qualityLevels.find((each) => each.qualityLevel === level.qualityLevel)!.maximumCheckFrameMs;
    const isCut = level.frameTimesMs.length < SHADER_LIMITS.checkFrameCount;
    // Cut short, the frames it drew past the first (which compiles) say how slow; a renderer that ran out of time gave only its time.
    const cutFrameTimesMs = level.frameTimesMs.length > 1 ? level.frameTimesMs.slice(1) : level.frameTimesMs;
    const qualityCheck = { quality_level: level.qualityLevel, check_frame_ms: roundedMs(median(isCut ? cutFrameTimesMs : level.frameTimesMs) * speedScaleNumber), maximum_check_frame_ms: maximumCheckFrameMs };
    qualityChecks.push(qualityCheck);
    if (!tooSlow && (isCut || qualityCheck.check_frame_ms > maximumCheckFrameMs)) tooSlow = qualityCheck;
  }
  return { qualityChecks, tooSlow };
}

/** What the check says when it's too slow: with the level when the shader reads iQuality. */
const tooSlowMessage = (tooSlow: ShaderQualityCheck, levelCount: number) =>
  `${levelCount > 1 ? `At quality level ${tooSlow.quality_level} it` : "It"} took ${tooSlow.check_frame_ms} ms a frame in the check; the most is ${tooSlow.maximum_check_frame_ms}.`;

/** The most flashes at any level it drew. */
const mostFlashes = (drawn: Pick<ShaderRender, "levels">) => Math.max(0, ...drawn.levels.map((level) => mostFlashesInOneSecond(level.frameLuminances)));

/**
 * Shimmer: fine detail that flickers from frame to frame when it's drawn small, as speckle in the change between two frames rather than
 * smooth motion. Each pixel's change is compared with its neighbours'; a tile is speckled when that difference is high across it, and a
 * shader shimmers when speckled tiles cover most of the frame. Set Oct 23, 2026 in Chromium at 640 × 360 and 360 × 640: the ten stand-in
 * worlds (STAND_IN_BACKGROUNDS) and Zaisma's own reach at most 1.7 in any tile and none may trip it; a twinkling starfield of 2-pixel
 * stars reaches 4, stripes finer than a pixel 33 to 75, and noise picked anew each frame 55 in every tile.
 */
export const SHIMMER_LIMITS = {
  acrossTileCount: 16,
  downTileCount: 9,
  /** A tile's mean speckle, in 0 to 255 steps of a channel, above which it's speckled. */
  speckledTileNumber: 4,
  /** The share of tiles speckled from which the frame shimmers: most of it. */
  shimmeringTilePct: 50,
};

/** How much two frames (RGBA, the same size) speckle: each tile's mean speckle, and the share of tiles over SHIMMER_LIMITS.speckledTileNumber. */
export function frameShimmer(first: Uint8Array, second: Uint8Array, widthPx: number, heightPx: number): { meanChangeNumber: number; speckledTilePct: number; tileSpeckleNumbers: number[] } {
  const change = new Float32Array(widthPx * heightPx);
  let changeSumNumber = 0;
  for (let pixelIndex = 0; pixelIndex < widthPx * heightPx; pixelIndex++) {
    const byteIndex = pixelIndex * 4;
    change[pixelIndex] = (Math.abs(first[byteIndex]! - second[byteIndex]!) + Math.abs(first[byteIndex + 1]! - second[byteIndex + 1]!) + Math.abs(first[byteIndex + 2]! - second[byteIndex + 2]!)) / 3;
    changeSumNumber += change[pixelIndex]!;
  }
  const { acrossTileCount, downTileCount } = SHIMMER_LIMITS;
  const sums = new Float64Array(acrossTileCount * downTileCount), counts = new Float64Array(acrossTileCount * downTileCount);
  for (let rowIndex = 1; rowIndex < heightPx - 1; rowIndex++) {
    for (let columnIndex = 1; columnIndex < widthPx - 1; columnIndex++) {
      const pixelIndex = rowIndex * widthPx + columnIndex;
      const neighbourNumber = (change[pixelIndex - 1]! + change[pixelIndex + 1]! + change[pixelIndex - widthPx]! + change[pixelIndex + widthPx]!) / 4;
      const tileIndex = Math.min(downTileCount - 1, Math.floor((rowIndex * downTileCount) / heightPx)) * acrossTileCount + Math.min(acrossTileCount - 1, Math.floor((columnIndex * acrossTileCount) / widthPx));
      sums[tileIndex]! += Math.abs(change[pixelIndex]! - neighbourNumber);
      counts[tileIndex]! += 1;
    }
  }
  const tileSpeckleNumbers = Array.from(sums, (sumNumber, tileIndex) => sumNumber / Math.max(1, counts[tileIndex]!));
  const speckledTileCount = tileSpeckleNumbers.filter((speckleNumber) => speckleNumber > SHIMMER_LIMITS.speckledTileNumber).length;
  return { meanChangeNumber: changeSumNumber / Math.max(1, widthPx * heightPx), speckledTilePct: (speckledTileCount * 100) / tileSpeckleNumbers.length, tileSpeckleNumbers };
}

/** A note a check before sending answers with: something worth fixing that never holds a shader. */
export interface ShaderCheckNote {
  code: "shimmers_when_small" | "forces_thick_glass";
  message: string;
  fix: string;
}

/** The glass tint, in percent, at which a background forces thick glass over it. */
export const THICK_GLASS_TINT_PCT = 70;

/** The notes for what the check drew: its shimmer, from two frames at the check's size, and the glass its still needs. */
export async function shaderCheckNotes(shimmerPngs: Uint8Array[], tone: BackgroundTone | null, checkWidthPx: number, checkHeightPx: number): Promise<ShaderCheckNote[]> {
  const notes: ShaderCheckNote[] = [];
  if (shimmerPngs.length === 2) {
    const [first, second] = await Promise.all(shimmerPngs.map((pngBytes) => pngPixels(pngBytes)));
    if (first && second && first.length === second.length && first.length === checkWidthPx * checkHeightPx * 4) {
      const shimmer = frameShimmer(first, second, checkWidthPx, checkHeightPx);
      if (shimmer.speckledTilePct >= SHIMMER_LIMITS.shimmeringTilePct) {
        notes.push({
          code: "shimmers_when_small",
          message: `Fine detail flickers from frame to frame across ${Math.round(shimmer.speckledTilePct)}% of it at ${checkWidthPx} by ${checkHeightPx}, as it will on phones and small windows.`,
          fix: "Blur or fade detail finer than a few pixels (fade it with the pixel size, fwidth, or with iQuality), and move noise smoothly with iTime instead of picking new noise every frame.",
        });
      }
    }
  }
  if (tone && tone.glass_tint_pct >= THICK_GLASS_TINT_PCT) {
    notes.push({
      code: "forces_thick_glass",
      message: `Words over it need ${tone.is_glass_smoked ? "smoked" : "light"} glass tinted ${tone.glass_tint_pct}%, so the glass hides most of it.`,
      fix: "Keep its contrast gentler where Zaisma's glass sits (the left of a wide screen, the bottom half of a phone): fewer bright highlights against deep shadows there, or read iGlassPanes and soften what's under them.",
    });
  }
  return notes;
}

export interface ShaderCheckDeps {
  render: ShaderRenderer;
  /** Image matching: this Zaisma's own unless a test gives one. */
  images?: ImageMatcher;
  judge?: ListingJudge;
}

/** The renderer this Zaisma has: Browser Rendering, or none (the shader waits, and the queue tries again). */
export function shaderCheckDeps(env: Env): ShaderCheckDeps | null {
  return env.BROWSER ? { render: browserShaderRenderer(env.BROWSER) } : null;
}

/** A shader's manifest from the games bucket; one sent before buffers and textures has only its source, its one pass. */
export async function shaderManifestOf(env: Env, shader: Pick<GameShader, "id" | "game_id">): Promise<ShaderManifest | null> {
  const stored = await env.GAMES.get(shaderManifestKey(shader.game_id, shader.id));
  if (stored) return (await stored.json()) as ShaderManifest;
  const source = await env.GAMES.get(shaderKey(shader.game_id, shader.id));
  return source ? shaderManifestFromSource(await source.text()) : null;
}

/** What to draw for a shader: its passes wrapped in order, and its textures' bytes (one gone or rejected reads black). */
export async function shaderRenderInput(env: Env, gameId: string, screen: BackgroundScreen, manifest: ShaderManifest, isSheetWanted: boolean): Promise<ShaderRenderInput> {
  const textures: ShaderRenderInput["textures"] = [];
  for (const imageId of shaderTextureImageIds(manifest)) {
    const image = await imageById(env.DB, imageId);
    if (!image || image.game_id !== gameId || image.kind !== "shader_texture" || image.review_status === "rejected") continue;
    const stored = await env.GAMES.get(imageKey(image));
    if (stored) textures.push({ imageId, bytes: new Uint8Array(await stored.arrayBuffer()) });
  }
  return {
    passes: shaderPassesInDrawOrder(manifest).map((pass) => ({ bufferName: pass.bufferName, fragmentSource: wrapShaderPass(pass), channels: pass.channels })),
    textures,
    screen,
    referenceSource: CHECK_REFERENCE_SHADER,
    qualityLevels: shaderReadsQuality(manifest) ? SHADER_LIMITS.qualityLevels.map((level) => level.qualityLevel) : [SHADER_LIMITS.qualityLevels[0]!.qualityLevel],
    isSheetWanted,
  };
}

/** A compiler's first line as the check says it. */
const compileMessage = (compileError: string) => `It didn't compile: ${compileError.replace(/[.\s]+$/, "")}.`;

/** Check one shader, if it's still waiting for its check. */
export async function runShaderCheck(env: Env, shaderId: string, deps: ShaderCheckDeps): Promise<void> {
  const shader = await shaderById(env.DB, shaderId);
  if (!shader || shader.review_status !== "pending" || shader.checked_at_ms !== null) return;
  const game = await gameById(env.DB, shader.game_id);
  if (!game || game.review_status === "removed") return;
  const manifest = await shaderManifestOf(env, shader);
  if (!manifest) return;
  const reject = async (reason: ReviewReason, qualityChecks: ShaderQualityCheck[] | null = null, flashCount: number | null = null) => {
    await settleShader(env.DB, shader, reason, qualityChecks, flashCount);
    await audit(env.DB, game.id, "shader-rejected", `${shader.screen} ${shader.id}: ${reason.message}`, "shader check", reason);
  };

  const drawn = await deps.render(await shaderRenderInput(env, shader.game_id, shader.screen, manifest, false));
  if (drawn.compileError) return reject(reviewReason("shader_does_not_compile", compileMessage(drawn.compileError)));
  // Scaled to the renderer's speed, measured on the reference in the same browser.
  const { qualityChecks, tooSlow } = measureQualityLevels(drawn);
  if (tooSlow) return reject(reviewReason("shader_too_slow", tooSlowMessage(tooSlow, qualityChecks.length)), qualityChecks);
  const flashCount = mostFlashes(drawn);
  if (flashCount > SHADER_LIMITS.maximumFlashCountPerSec) return reject(reviewReason("shader_flashes", "It flashes more than 3 times a second, which can cause seizures."), qualityChecks, flashCount);
  if (!drawn.stillPng || !drawn.smallStillPng) throw new Error(`The renderer drew ${shader.id} but gave no still`);

  // Matched against known abuse material before anyone sees a frame. A match is kept for reporting, never shown.
  const pictures = [{ id: "still", pngBytes: drawn.smallStillPng }, ...drawn.framePngs.map((pngBytes, frameIndex) => ({ id: `frame-${frameIndex}`, pngBytes }))];
  const matched = await (deps.images ?? imageMatcher(env)).check([{ id: "still-full", pngBytes: drawn.stillPng }, ...pictures].map((picture) => ({ path: `shader ${shader.id} ${picture.id}`, type: "image/png", id: picture.id, body: async () => picture.pngBytes })));
  if (matched.findings.some((finding) => finding.code === KNOWN_IMAGE_CODE)) return holdKnownImage(env, game.slug, shader, drawn);

  // Its tone, from the still the glass would be measured from, so pages can open on its color with its glass right.
  const tone = await toneOfPng(drawn.smallStillPng);
  if (tone) await setBackgroundTone(env.DB, "game_shaders", shader.id, tone);
  await Promise.all([
    env.GAMES.put(shaderStillKey(shader.game_id, shader.id), drawn.stillPng, { httpMetadata: { contentType: "image/png" } }),
    ...drawn.framePngs.map((pngBytes, frameIndex) => env.GAMES.put(shaderFrameKey(shader.game_id, shader.id, frameIndex), pngBytes, { httpMetadata: { contentType: "image/png" } })),
  ]);
  const judged = await judgeShaderPictures(env, game, pictures, deps.judge);
  if (judged.outcome === "rejected" || judged.outcome === "off_lists") return reject(judged.reason, qualityChecks, flashCount);
  const waitsForPerson = judged.outcome !== "fine";
  await settleShader(env.DB, shader, null, qualityChecks, flashCount, waitsForPerson);
  const timings = qualityChecks.map((qualityCheck) => `${qualityCheck.check_frame_ms} ms`).join(", ");
  await audit(env.DB, game.id, waitsForPerson ? "shader-checked" : "shader-approved", `${shader.screen} ${shader.id}: ${timings} a frame${waitsForPerson ? ", waits for a person" : ""}`, "shader check");
}

/** A frame matched known abuse material: the frames are kept for reporting, never shown, and the shader is refused. */
async function holdKnownImage(env: Env, slug: string, shader: GameShader, drawn: ShaderRender): Promise<void> {
  const keptKey = (name: string) => heldImageKey(shader.game_id, `${shader.id}.${name}.png`);
  await Promise.all([drawn.stillPng!, ...drawn.framePngs].map((pngBytes, index) => env.GAMES.put(keptKey(index === 0 ? "still" : `frame-${index - 1}`), pngBytes, { httpMetadata: { contentType: "image/png" } })));
  const reason = reviewReason("image_rejected", "This shader can't be used.");
  await settleShader(env.DB, shader, reason, null, null);
  await audit(env.DB, shader.game_id, "image-held", `A ${shader.screen} shader's frames matched known abuse material. Kept at ${keptKey("still")} and beside it; never shown.`, "shader check");
  await sendAlert(env, `URGENT: known abuse image in a shader on ${slug}`, `${KNOWN_IMAGE_ALERT}\n\nShader ${shader.id}'s frames, kept at ${keptKey("still")} and beside it in the games bucket.\n\nGame: ${env.SITE_ORIGIN}/admin/games/${shader.game_id}`);
}

// --- Checks before sending ----------------------------------------------------------

/** Where a check before sending keeps its sheet for a day, by a random name its link carries, and where a developer's checks are counted. */
export const shaderCheckSheetKey = (sheetName: string) => `shader-checks/${sheetName}.png`;
const shaderCheckRunPrefix = (ownerId: string) => `shader-check-runs/${ownerId}/`;

/** The shader_check answer (schemas.ts, SHADER_CHECK). */
export interface ShaderCheckAnswer {
  compile_error: string | null;
  quality_checks: ShaderQualityCheck[];
  flash_count: number | null;
  is_glass_smoked: boolean | null;
  glass_tint_pct: number | null;
  notes: ShaderCheckNote[];
  sheet_url: string | null;
  sheet_expires_at: string | null;
}

/** How many checks before sending a developer has left in the last day, and when the oldest of those was. */
export async function shaderCheckAllowance(env: Env, ownerId: string, nowMs = Date.now()): Promise<{ remainingShaderCheckCount: number; oldestAtMs: number | null }> {
  const listed = await env.GAMES.list({ prefix: shaderCheckRunPrefix(ownerId), limit: 1000 });
  const recentAtMs = listed.objects.map((object) => object.uploaded.getTime()).filter((uploadedAtMs) => uploadedAtMs > nowMs - 24 * 3600_000);
  return { remainingShaderCheckCount: Math.max(0, SHADER_LIMITS.maximumShaderChecksPerDay - recentAtMs.length), oldestAtMs: recentAtMs.length ? Math.min(...recentAtMs) : null };
}

/** Counts one check before sending, before it runs, so one that fails counts too. */
export async function countShaderCheck(env: Env, ownerId: string): Promise<void> {
  await env.GAMES.put(`${shaderCheckRunPrefix(ownerId)}${Date.now()}-${crypto.randomUUID()}`, new Uint8Array());
}

/**
 * A check before sending: the same drawing as the check, keeping nothing but a sheet picture for a day. It answers what the check
 * would measure (the compiler's first error, each level's time, flashes, the glass), notes that never hold a shader, and the sheet,
 * which image matching clears first like every picture. Safety's other half, the listing check, runs when the shader is sent.
 */
export async function runShaderDraft(env: Env, game: Game, screen: BackgroundScreen, manifest: ShaderManifest, deps: ShaderCheckDeps): Promise<ShaderCheckAnswer> {
  const answer: ShaderCheckAnswer = { compile_error: null, quality_checks: [], flash_count: null, is_glass_smoked: null, glass_tint_pct: null, notes: [], sheet_url: null, sheet_expires_at: null };
  const drawn = await deps.render(await shaderRenderInput(env, game.id, screen, manifest, true));
  if (drawn.compileError) return { ...answer, compile_error: compileMessage(drawn.compileError) };
  const { qualityChecks } = measureQualityLevels(drawn);
  const tone = drawn.smallStillPng ? await toneOfPng(drawn.smallStillPng) : null;
  const sizes = checkSizes(screen);
  Object.assign(answer, {
    quality_checks: qualityChecks,
    flash_count: drawn.levels.some((level) => level.frameLuminances.length) ? mostFlashes(drawn) : null,
    is_glass_smoked: tone ? tone.is_glass_smoked === 1 : null,
    glass_tint_pct: tone ? tone.glass_tint_pct : null,
    notes: await shaderCheckNotes(drawn.shimmerPngs, tone, sizes.checkWidthPx, sizes.checkHeightPx),
  });
  if (!drawn.sheetPng) return answer;
  // The sheet is a picture Zaisma keeps and serves, so image matching clears it first; when matching can't answer, it isn't kept.
  const sheetPng = drawn.sheetPng;
  const matched = await (deps.images ?? imageMatcher(env)).check([{ path: `shader check on ${game.slug}`, type: "image/png", id: "sheet", body: async () => sheetPng }]);
  if (matched.findings.some((finding) => finding.code === KNOWN_IMAGE_CODE)) {
    const keptKey = heldImageKey(game.id, `shader-check-${crypto.randomUUID()}.png`);
    await env.GAMES.put(keptKey, sheetPng, { httpMetadata: { contentType: "image/png" } });
    await audit(env.DB, game.id, "image-held", `A shader check's sheet matched known abuse material. Kept at ${keptKey}; never shown.`, "shader check");
    await sendAlert(env, `URGENT: known abuse image in a shader check on ${game.slug}`, `${KNOWN_IMAGE_ALERT}\n\nA shader check's sheet, kept at ${keptKey} in the games bucket.\n\nGame: ${env.SITE_ORIGIN}/admin/games/${game.id}`);
    return { ...answer, notes: [], sheet_url: null };
  }
  if (!matched.isConnected) return answer;
  const sheetName = crypto.randomUUID().replace(/-/g, "");
  await env.GAMES.put(shaderCheckSheetKey(sheetName), sheetPng, { httpMetadata: { contentType: "image/png" } });
  return { ...answer, sheet_url: `${env.SITE_ORIGIN}/shader-checks/${sheetName}.png`, sheet_expires_at: iso(Date.now() + SHADER_LIMITS.checkSheetKeptDurationSec * 1000) };
}

/**
 * A check's sheet (/shader-checks/<name>.png): anyone with its link, for a day, like a preview link, so the developer's AI can look at it.
 * Its name is random and long, it's never cached in public, and search engines are asked to leave it alone.
 */
export async function serveShaderCheckSheet(request: Request, env: Env, filePath: string, nowMs = Date.now()): Promise<Response> {
  const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const match = filePath.match(/^([a-f0-9]{32})\.png$/);
  if (!match || (request.method !== "GET" && request.method !== "HEAD")) return notFound();
  const stored = await env.GAMES.get(shaderCheckSheetKey(match[1]!));
  if (!stored || stored.uploaded.getTime() < nowMs - SHADER_LIMITS.checkSheetKeptDurationSec * 1000) return notFound();
  return new Response(request.method === "HEAD" ? null : stored.body, {
    headers: { "Content-Type": "image/png", "Content-Length": String(stored.size), "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex", "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Disposition": "inline" },
  });
}

/** Once a day: sheets past their day, and the counts of checks older than a day. */
export async function deleteOldShaderChecks(env: Env, nowMs = Date.now()): Promise<number> {
  let deletedCount = 0;
  for (const prefix of ["shader-checks/", "shader-check-runs/"]) {
    let cursor: string | undefined;
    do {
      const listed = await env.GAMES.list({ prefix, limit: 1000, cursor });
      const old = listed.objects.filter((object) => object.uploaded.getTime() < nowMs - SHADER_LIMITS.checkSheetKeptDurationSec * 1000).map((object) => object.key);
      if (old.length) await env.GAMES.delete(old);
      deletedCount += old.length;
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
  }
  return deletedCount;
}

/** A shader check from the scan queue: tried again a little later when the renderer fails (Browser Rendering's limits, say). */
export async function checkShaderFromQueue(env: Env, message: Message<ShaderCheckJob>): Promise<void> {
  const deps = shaderCheckDeps(env);
  // Without a renderer the shader waits, and a person can approve it on /admin.
  if (!deps) return message.ack();
  try {
    await runShaderCheck(env, message.body.shaderCheckId, deps);
    message.ack();
  } catch (error) {
    console.error("shader check failed", message.body.shaderCheckId, error);
    if (message.attempts >= 3) message.ack();
    else message.retry({ delaySeconds: 60 * message.attempts });
  }
}

/** Every 5 minutes: shaders sent over 10 minutes ago and never checked (a lost message, or the renderer failing three times), queued again. */
export async function queueShaderChecks(env: Env, nowMs = Date.now()): Promise<number> {
  if (!env.BROWSER) return 0;
  const { results } = await env.DB.prepare("SELECT id FROM game_shaders WHERE review_status = 'pending' AND checked_at_ms IS NULL AND created_at_ms < ? AND created_at_ms > ? ORDER BY created_at_ms LIMIT 20")
    .bind(nowMs - 10 * 60_000, nowMs - 2 * 24 * 3600_000)
    .all<{ id: string }>();
  if (results.length) await env.SCAN_QUEUE.sendBatch(results.map((shader) => ({ body: { shaderCheckId: shader.id } })));
  return results.length;
}
