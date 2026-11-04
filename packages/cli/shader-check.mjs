// The shader check's drawing, shared by Zaisma's check (apps/site/src/shader-check.ts, on Cloudflare Browser Rendering) and `zaisma check` on
// a shader's folder (zaisma.mjs, in a local Chrome), so both draw, time and judge a shader the same way; and the GLSL every runner compiles
// round a shader's mainImage, which packages/core re-exports for Zaisma's own pages, the game domain and the dashboard. No dependencies: it
// runs in Workers and in Node 18 or newer. Types: shader-check.d.mts. Backgrounds in docs/DEVELOPER-API.md says what it checks.

/*
 * The glass pass every shader background runs inside (apps/site/src/components/foundations.ts, BACKDROP_SCRIPT, and the game
 * domain's background runner): a shader is one mainImage function, and this is the main round it. Kept here so Zaisma's own pages,
 * the game domain, the shader check and `zaisma check` all compile the same thing (wrapShader below). WebGL2's GLSL (GLSL ES 3.00):
 * it writes zaismaFragColor, and reads where the glass sits from iGlassPanes and iGlassPaneCount, which SHADER_HEAD declares so a
 * shader can read them too.
 */

/** How many pieces of glass the runner tells a shader about: the largest ones in view. */
export const MOST_GLASS_PANE_COUNT = 16;

/**
 * The runner's pass round any shader's mainImage (BACKDROP_SCRIPT): glass that bends the backdrop's light. Under each piece of glass
 * it draws what's behind a little magnified and bent inward along the cut edge, as through thick glass; fainter under smoked glass.
 * The light the glass gathers along its edge is the pane's own rim (GLASS_SCRIPT's caustics), so it moves with the pane as the page
 * scrolls; the backdrop sits still under the page and could only follow a frame late. Everything is in the canvas's own pixels, from
 * its bottom left. iGlassPanes (each pane's left, bottom, right and top) and iGlassPaneCount come from SHADER_HEAD.
 */
export const GLASS_LIGHT_PASS = `
uniform vec4 zaismaPaneCuts[${MOST_GLASS_PANE_COUNT}];  // each pane's cut corners: top left, top right, bottom right, bottom left; 4096 added to the last on smoked glass
uniform float zaismaPixel;      // canvas pixels per CSS pixel
uniform vec2 zaismaViewOffset;  // where the canvas sits in the scene it shows a part of (the gallery's framed examples), in its pixels
out vec4 zaismaFragColor;
// Signed distance to a pane's cut shape (negative inside), and the outward normal of its nearest side.
float zaismaPaneShape(vec2 f, vec4 r, vec4 c, out vec2 n) {
  vec2 h = (r.zw - r.xy) * 0.5, q = f - (r.xy + r.zw) * 0.5, a = abs(q) - h;
  float d = length(max(a, 0.0)) + min(max(a.x, a.y), 0.0), k = 0.70710678, e;
  n = a.x > a.y ? vec2(sign(q.x), 0.0) : vec2(0.0, sign(q.y));
  if (c.x > 0.0) { e = (dot(q, vec2(-1.0, 1.0)) - (h.x + h.y - c.x)) * k; if (e > d) { d = e; n = vec2(-k, k); } }
  if (c.y > 0.0) { e = (dot(q, vec2(1.0, 1.0)) - (h.x + h.y - c.y)) * k; if (e > d) { d = e; n = vec2(k, k); } }
  if (c.z > 0.0) { e = (dot(q, vec2(1.0, -1.0)) - (h.x + h.y - c.z)) * k; if (e > d) { d = e; n = vec2(k, -k); } }
  if (c.w > 0.0) { e = (dot(q, vec2(-1.0, -1.0)) - (h.x + h.y - c.w)) * k; if (e > d) { d = e; n = vec2(-k, -k); } }
  return d;
}
void main() {
  vec2 f = gl_FragCoord.xy, at = f;
  // The panes come smallest first, so a pane on a tray bends the light under it, not the tray.
  for (int i = 0; i < ${MOST_GLASS_PANE_COUNT}; i++) {
    if (i >= iGlassPaneCount) break;
    vec4 cuts = zaismaPaneCuts[i]; float smoke = step(4096.0, cuts.w); cuts.w = mod(cuts.w, 4096.0);
    vec2 n; float d = zaismaPaneShape(f, iGlassPanes[i], cuts, n);
    float strength = mix(1.0, 0.5, smoke), rim = 18.0 * zaismaPixel;
    if (d < 0.0) {
      float depth = -d, edge = 1.0 - smoothstep(0.0, rim, depth);
      vec2 center = (iGlassPanes[i].xy + iGlassPanes[i].zw) * 0.5;
      // Thick glass: what's behind is magnified a little and bent inward along the rim, most at the very edge.
      at = center + (f - center) * (1.0 - 0.018 * strength) - n * rim * 0.45 * strength * edge * edge;
      break;
    }
  }
  vec4 color = vec4(0.0); mainImage(color, at + zaismaViewOffset);
  zaismaFragColor = vec4(color.rgb, 1.0);
}`;

/** The main round a buffer pass's mainImage: no glass, and the buffer keeps all four channels it writes, alpha too. */
export const BUFFER_PASS = `
out vec4 zaismaFragColor;
void main() {
  vec4 color = vec4(0.0); mainImage(color, gl_FragCoord.xy);
  zaismaFragColor = color;
}`;

/**
 * Shaders: Shadertoy's form, `void mainImage(out vec4 fragColor, in vec2 fragCoord)`, in WebGL2's GLSL (GLSL ES 3.00), so most
 * Shadertoy shaders paste in and run: an image pass, up to four buffers that keep their picture between frames (Shadertoy's Buffers A
 * to D) and up to four textures the developer sends, read through iChannel0 to iChannel3 (ShaderManifest). One shader serves every
 * device: it reads iQuality (0 for phones and slow devices, 1, 2 for desktops), and the check holds each level to its own time.
 * The check draws it before anyone sees it; players' browsers draw it at fewer pixels and at most 30 frames a second, stepping down a
 * level, then to fewer pixels, then holding a still frame, on a device that can't keep up.
 */
export const SHADER_LIMITS = {
  /** Each pass's source, the image pass's and each buffer's: storage costs nothing, and the check's time is what protects devices. */
  maximumPassSizeBytes: 65_536,
  /** Buffers A to D. */
  maximumBufferCount: 4,
  /** iChannel0 to iChannel3, on each pass. */
  maximumChannelCount: 4,
  /** Textures one shader's channels name, all its passes together. */
  maximumShaderTextureCount: 4,
  /** Pictures of kind shader_texture a game keeps. */
  maximumGameTextureCount: 16,
  /** A texture's size: PNG, JPEG or WebP. */
  maximumTextureSidePx: 4096,
  maximumTextureSizeBytes: 8 * 1024 * 1024,
  checkWidthPx: 640,
  checkHeightPx: 360,
  /** Frames the check draws and times at each quality level, in order from iTime 0 (buffers need their history), each frameStepSec on. */
  checkFrameCount: 90,
  checkFrameStepSec: 1 / 30,
  /**
   * Software rendering's speed varies up to twice over from one browser to the next, so the check first times Zaisma's own
   * background as it was when the levels were set (CHECK_REFERENCE_SHADER in shader-check.ts) in the same browser, and scales the
   * shader's median frame to it: check_frame_ms is what a frame takes on a renderer that draws that reference in referenceFrameMs.
   */
  referenceFrameMs: 25,
  /**
   * Each quality level's most check_frame_ms. A shader that never reads iQuality is timed once, against level 0's. Level 0 is phones'
   * and keeps the limit set Oct 21, 2026 on Cloudflare Browser Rendering (SwiftShader) at 640 × 360, scaled: the looks drafts' shaders
   * took 11–47 ms (frostline the slowest, 43–47) and a 256-step ray-march 90–109 ms; the slowest × 1.5, rounded up to 5 ms. Desktops are
   * four times and more faster than phones, so level 1 gets twice that and level 2 four times (Oct 23, 2026).
   */
  qualityLevels: [
    { qualityLevel: 0, maximumCheckFrameMs: 75 },
    { qualityLevel: 1, maximumCheckFrameMs: 150 },
    { qualityLevel: 2, maximumCheckFrameMs: 300 },
  ],
  /** The level each screen's still is drawn at: wide screens are desktops' and tablets', phone is phones'. */
  stillQualityLevelByScreen: { wide: 2, phone: 0 },
  /** WCAG 2.3.1: no more than three flashes in any one second. */
  maximumFlashCountPerSec: 3,
  /** When the still frame is drawn. */
  stillTimeSec: 2,
  /** The still's size, wide (phone turns it round): a single pass draws it at once at full size. */
  stillWidthPx: 1920,
  stillHeightPx: 1080,
  /** A shader with buffers draws its whole history again for the still and the sampled frames, so at this size. */
  bufferedStillWidthPx: 960,
  bufferedStillHeightPx: 540,
  /** After the still, a shader with buffers steps its history this far a frame to reach its sampled frames, so the check keeps to its time. */
  sampledHistoryStepSec: 0.5,
  /** Frames saved for the developer and the safety checks, spread over the first 30 seconds. */
  sampledFrameCount: 6,
  sampledFramesOverSec: 30,
  /** How long one shader may take on the renderer altogether before it's called too slow. */
  checkTimeoutSec: 240,
  /** Checks before sending (POST /games/:slug/shader-checks) a developer can run in a day; the upload command's local check has no limit. */
  maximumShaderChecksPerDay: 100,
  /** How long a check before sending keeps its sheet picture. */
  checkSheetKeptDurationSec: 24 * 3600,
  /** Shaders kept per screen besides the chosen one: older pending and unchosen ones go. */
  keptShaderCount: 4,
  runtimeMaximumFps: 30,
  runtimeResolutionScale: 0.5,
  /**
   * Upscaling (SHADER_UPSCALE_SOURCE in core): every pass draws at this share of runtimeResolutionScale (0.7 a side, half the pixels),
   * and the sharpening upscale writes the canvas at runtimeUpscaleNumber times that, so it's as sharp as before for half the work.
   */
  runtimeDrawShareNumber: 0.7,
  runtimeUpscaleNumber: 1.4,
  /** After this long with no input on the page, a background draws at runtimeIdleFramesPerSec, and at runtimeMaximumFps again on the first input. */
  runtimeIdleTimeoutSec: 60,
  runtimeIdleFramesPerSec: 15,
};

/** Buffers A to D, as a shader names them. */
export const SHADER_BUFFER_NAMES = ["a", "b", "c", "d"];

/** The passes a runner draws each frame, in order: the buffers, a to d, then the image pass (bufferName null), drawn last onto the canvas. */
export function shaderPassesInDrawOrder(manifest) {
  const buffers = [...manifest.buffers].sort((first, second) => SHADER_BUFFER_NAMES.indexOf(first.buffer_name) - SHADER_BUFFER_NAMES.indexOf(second.buffer_name));
  return [...buffers.map((buffer) => ({ bufferName: buffer.buffer_name, source: buffer.source, channels: buffer.channels })), { bufferName: null, source: manifest.image.source, channels: manifest.image.channels }];
}

/** A shader's text without its comments, so what a comment says is never taken for code. */
export const shaderWithoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");

/** Whether a shader reads iQuality, so the check times each level and runners pick one; one that doesn't is timed once. */
export const shaderReadsQuality = (manifest) => shaderPassesInDrawOrder(manifest).some((pass) => /\biQuality\b/.test(shaderWithoutComments(pass.source)));

/**
 * How a runner samples a channel, in WebGL2's names (gl[name]): a texture has mipmaps, so linear is trilinear; a buffer has none.
 * The check and every runner sample the same way, so a shader looks the same wherever it runs.
 */
export function shaderChannelSampling(channel) {
  const hasMipmaps = channel.input_kind === "texture";
  const minificationFilterName = channel.filter === "nearest" ? "NEAREST" : hasMipmaps ? "LINEAR_MIPMAP_LINEAR" : "LINEAR";
  return { minificationFilterName, magnificationFilterName: channel.filter === "nearest" ? "NEAREST" : "LINEAR", wrapName: channel.wrap === "repeat" ? "REPEAT" : "CLAMP_TO_EDGE", hasMipmaps };
}

/**
 * What runners pass to createImageBitmap for a texture: flipped, so it's upright with fragCoord's bottom left (Shadertoy's way), and
 * its colors as they are, unpremultiplied, since shaders read textures as data too.
 */
export const SHADER_TEXTURE_BITMAP_OPTIONS = { imageOrientation: "flipY", premultiplyAlpha: "none", colorSpaceConversion: "none" };

/**
 * What comes before every pass's own source: WebGL2's GLSL, full precision (buffers often keep positions and speeds, not colors), and
 * every input a pass reads. Shadertoy's names (docs/NAMING.md, shader): iResolution (pixels), iTime and iTimeDelta (seconds), iFrame
 * (frames since the runner started), iChannel0 to iChannel3 with each one's iChannelResolution. Zaisma's own: iQuality (0 for phones and
 * slow devices, 1, 2 for desktops), and where Zaisma's glass sits, iGlassPanes (left, bottom, right, top, in the shader's pixels from its
 * bottom left, smallest first) and iGlassPaneCount (none in the check). `#line 1` makes a compiler's line numbers the developer's own.
 */
export const SHADER_HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform int iFrame;
uniform float iQuality;
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform sampler2D iChannel2;
uniform sampler2D iChannel3;
uniform vec3 iChannelResolution[4];
uniform vec4 iGlassPanes[${MOST_GLASS_PANE_COUNT}];
uniform int iGlassPaneCount;
#line 1
`;


/**
 * The whole fragment shader an image pass compiles: the head, the developer's mainImage, and the glass pass round it
 * (GLASS_LIGHT_PASS). The check, the game domain's runner and the dashboard's preview all compile this, so a shader that passed the
 * check runs the same everywhere.
 */
export function wrapShader(source) {
  return SHADER_HEAD + source + "\n" + GLASS_LIGHT_PASS;
}
/** The whole fragment shader a buffer pass compiles: the head and the developer's mainImage, drawn to the buffer with no glass. */
export function wrapShaderBuffer(source) {
  return SHADER_HEAD + source + "\n" + BUFFER_PASS;
}
/** The whole fragment shader a pass compiles: the image pass with the glass round it, a buffer pass without. */
export const wrapShaderPass = (pass) => (pass.bufferName === null ? wrapShader(pass.source) : wrapShaderBuffer(pass.source));
/** The vertex shader every pass draws with: one triangle over the whole canvas, from the corners [-1, -1, 3, -1, -1, 3]. */
export const SHADER_VERTEX_SOURCE = "#version 300 es\nin vec2 corner;\nvoid main() { gl_Position = vec4(corner, 0.0, 1.0); }";

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
export const SHADER_CHECK_PAGE = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; img-src data: blob:"><body style="margin:0"><script>
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
export function checkSizes(screen, isBuffered = false) {
  const { checkWidthPx, checkHeightPx } = SHADER_LIMITS;
  const [stillWidthPx, stillHeightPx] = isBuffered ? [SHADER_LIMITS.bufferedStillWidthPx, SHADER_LIMITS.bufferedStillHeightPx] : [SHADER_LIMITS.stillWidthPx, SHADER_LIMITS.stillHeightPx];
  return screen === "wide" ? { checkWidthPx, checkHeightPx, stillWidthPx, stillHeightPx } : { checkWidthPx: checkHeightPx, checkHeightPx: checkWidthPx, stillWidthPx: stillHeightPx, stillHeightPx: stillWidthPx };
}

/** When the sampled frames are drawn: spread evenly over the first sampledFramesOverSec seconds. */
export const SAMPLED_TIMES_SEC = Array.from({ length: SHADER_LIMITS.sampledFrameCount }, (_, frameIndex) => (frameIndex * SHADER_LIMITS.sampledFramesOverSec) / (SHADER_LIMITS.sampledFrameCount - 1));

/** Base64 parts a texture goes to the page in, so no one message to the browser is big. */
const TEXTURE_PART_SIZE_BYTES = 768 * 1024;

function toBase64(bytes) {
  let binary = "";
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += 0x8000) binary += String.fromCharCode(...bytes.subarray(byteIndex, byteIndex + 0x8000));
  return btoa(binary);
}
function fromDataUrl(dataUrl) {
  if (!dataUrl) return null;
  const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/**
 * What the renderer draws for a shader: its passes wrapped in draw order, the textures its channels read (each { imageId, bytes }, by the
 * image_id its channels name; a missing one reads black), the screen, the reference timed first, and the quality levels to time: all three
 * for a shader that reads iQuality, else level 0 alone.
 */
export function shaderRenderInputOf(manifest, screen, textures, isSheetWanted) {
  return {
    passes: shaderPassesInDrawOrder(manifest).map((pass) => ({ bufferName: pass.bufferName, fragmentSource: wrapShaderPass(pass), channels: pass.channels })),
    textures,
    screen,
    referenceSource: CHECK_REFERENCE_SHADER,
    qualityLevels: shaderReadsQuality(manifest) ? SHADER_LIMITS.qualityLevels.map((level) => level.qualityLevel) : [SHADER_LIMITS.qualityLevels[0].qualityLevel],
    isSheetWanted,
  };
}

/** What the page is given: the passes with each channel resolved to the pass or texture it reads and how it samples it. */
export function shaderCheckPageInput(input) {
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

/**
 * What a browser evaluates on SHADER_CHECK_PAGE, in order: each texture's base64 parts, then the check, which answers the page's drawing.
 * Expressions, not functions: a bundled function's text can carry helpers the page doesn't have.
 */
export function shaderCheckPageExpressions(input) {
  const textureExpressions = [];
  for (const [textureIndex, texture] of input.textures.entries()) {
    const encoded = toBase64(texture.bytes);
    for (let partStartIndex = 0; partStartIndex < encoded.length; partStartIndex += TEXTURE_PART_SIZE_BYTES) textureExpressions.push(`window.zaismaTexturePart(${textureIndex}, ${JSON.stringify(encoded.slice(partStartIndex, partStartIndex + TEXTURE_PART_SIZE_BYTES))})`);
  }
  return { textureExpressions, checkExpression: `window.zaismaCheck(${JSON.stringify(shaderCheckPageInput(input))})` };
}

/** The page's drawing as the check reads it, its pictures as PNG bytes; null (out of time) counts as too slow at the first level, with the time it had. */
export function shaderRenderFromPage(drawn, input) {
  if (!drawn) {
    return { compileError: null, referenceFrameTimesMs: [], levels: [{ qualityLevel: input.qualityLevels[0], frameTimesMs: [SHADER_LIMITS.checkTimeoutSec * 1000], frameLuminances: [] }], stillPng: null, smallStillPng: null, framePngs: [], shimmerPngs: [], sheetPng: null };
  }
  return {
    compileError: drawn.compileError,
    referenceFrameTimesMs: drawn.referenceFrameTimesMs,
    levels: drawn.levels,
    stillPng: fromDataUrl(drawn.stillDataUrl),
    smallStillPng: fromDataUrl(drawn.smallStillDataUrl),
    framePngs: drawn.frameDataUrls.map((dataUrl) => fromDataUrl(dataUrl)),
    shimmerPngs: drawn.shimmerDataUrls.map((dataUrl) => fromDataUrl(dataUrl)),
    sheetPng: fromDataUrl(drawn.sheetDataUrl),
  };
}

/**
 * The most flashes in any one second of frames (WCAG 2.3.1's general flash): a flash is a pair of opposing changes in mean
 * relative luminance of at least 0.1, the second within 3 frames of the first, while the darker side is under 0.8.
 */
export function mostFlashesInOneSecond(frameLuminances, frameStepSec = SHADER_LIMITS.checkFrameStepSec) {
  const MINIMUM_CHANGE_NUMBER = 0.1;
  const MOST_FRAMES_BETWEEN_COUNT = 3;
  // Each change of at least 0.1 from the last extreme, in turn: up, down, up…
  const changes = [];
  let direction = null;
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
  const flashFrameIndexes = [];
  for (let changeIndex = 1; changeIndex < changes.length; changeIndex++) {
    const earlier = changes[changeIndex - 1];
    const later = changes[changeIndex];
    if (later.frameIndex - earlier.frameIndex > MOST_FRAMES_BETWEEN_COUNT || Math.min(earlier.darkerLuminanceNumber, later.darkerLuminanceNumber) >= 0.8) continue;
    flashFrameIndexes.push(later.frameIndex);
    changeIndex++;
  }
  const frameCountPerSec = Math.round(1 / frameStepSec);
  let mostFlashCount = 0;
  for (const startIndex of flashFrameIndexes) mostFlashCount = Math.max(mostFlashCount, flashFrameIndexes.filter((frameIndex) => frameIndex >= startIndex && frameIndex < startIndex + frameCountPerSec).length);
  return mostFlashCount;
}

const median = (values) => {
  const sorted = [...values].sort((firstNumber, secondNumber) => firstNumber - secondNumber);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};
const roundedMs = (ms) => Math.round(ms * 10) / 10;

/** Each level the renderer timed, scaled to its speed on the reference, and the first that's too slow (cut short, or over its most). */
export function measureQualityLevels(drawn) {
  const speedScaleNumber = drawn.referenceFrameTimesMs.length ? SHADER_LIMITS.referenceFrameMs / Math.max(0.1, median(drawn.referenceFrameTimesMs)) : 1;
  const qualityChecks = [];
  let tooSlow = null;
  for (const level of drawn.levels) {
    const maximumCheckFrameMs = SHADER_LIMITS.qualityLevels.find((each) => each.qualityLevel === level.qualityLevel).maximumCheckFrameMs;
    const isCut = level.frameTimesMs.length < SHADER_LIMITS.checkFrameCount;
    // Cut short, the frames it drew past the first (which compiles) say how slow; a renderer that ran out of time gave only its time.
    const cutFrameTimesMs = level.frameTimesMs.length > 1 ? level.frameTimesMs.slice(1) : level.frameTimesMs;
    const qualityCheck = { quality_level: level.qualityLevel, check_frame_ms: roundedMs(median(isCut ? cutFrameTimesMs : level.frameTimesMs) * speedScaleNumber), maximum_check_frame_ms: maximumCheckFrameMs };
    qualityChecks.push(qualityCheck);
    if (!tooSlow && (isCut || qualityCheck.check_frame_ms > maximumCheckFrameMs)) tooSlow = qualityCheck;
  }
  return { qualityChecks, tooSlow };
}

/** The most flashes at any level it drew. */
export const mostFlashes = (drawn) => Math.max(0, ...drawn.levels.map((level) => mostFlashesInOneSecond(level.frameLuminances)));

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
export function frameShimmer(first, second, widthPx, heightPx) {
  const change = new Float32Array(widthPx * heightPx);
  let changeSumNumber = 0;
  for (let pixelIndex = 0; pixelIndex < widthPx * heightPx; pixelIndex++) {
    const byteIndex = pixelIndex * 4;
    change[pixelIndex] = (Math.abs(first[byteIndex] - second[byteIndex]) + Math.abs(first[byteIndex + 1] - second[byteIndex + 1]) + Math.abs(first[byteIndex + 2] - second[byteIndex + 2])) / 3;
    changeSumNumber += change[pixelIndex];
  }
  const { acrossTileCount, downTileCount } = SHIMMER_LIMITS;
  const sums = new Float64Array(acrossTileCount * downTileCount), counts = new Float64Array(acrossTileCount * downTileCount);
  for (let rowIndex = 1; rowIndex < heightPx - 1; rowIndex++) {
    for (let columnIndex = 1; columnIndex < widthPx - 1; columnIndex++) {
      const pixelIndex = rowIndex * widthPx + columnIndex;
      const neighbourNumber = (change[pixelIndex - 1] + change[pixelIndex + 1] + change[pixelIndex - widthPx] + change[pixelIndex + widthPx]) / 4;
      const tileIndex = Math.min(downTileCount - 1, Math.floor((rowIndex * downTileCount) / heightPx)) * acrossTileCount + Math.min(acrossTileCount - 1, Math.floor((columnIndex * acrossTileCount) / widthPx));
      sums[tileIndex] += Math.abs(change[pixelIndex] - neighbourNumber);
      counts[tileIndex] += 1;
    }
  }
  const tileSpeckleNumbers = Array.from(sums, (sumNumber, tileIndex) => sumNumber / Math.max(1, counts[tileIndex]));
  const speckledTileCount = tileSpeckleNumbers.filter((speckleNumber) => speckleNumber > SHIMMER_LIMITS.speckledTileNumber).length;
  return { meanChangeNumber: changeSumNumber / Math.max(1, widthPx * heightPx), speckledTilePct: (speckledTileCount * 100) / tileSpeckleNumbers.length, tileSpeckleNumbers };
}

/*
 * A background's tone: its average color and the glass Zaisma puts over it, measured once from the whole picture (a background
 * picture, when it's added) or the still (a shader, when the check draws it) and kept on its row (apps/site/src/background-tone.ts).
 * The rule is the backdrop script's pickGlass (apps/site/src/components/backdrop-script.ts), which measures backgrounds kept before
 * tones were, and the sheet's pickGlass on SHADER_CHECK_PAGE; keep the three in step: light glass (dark words) or smoked glass (light
 * words), whichever can be thinner while every word keeps its contrast against the harsh side of what's behind.
 */

function luminance(color) {
  const linear = (channelNumber) => { const shareNumber = channelNumber / 255; return shareNumber <= 0.03928 ? shareNumber / 12.92 : Math.pow((shareNumber + 0.055) / 1.055, 2.4); };
  return 0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2]);
}
function contrast(first, second) {
  const firstNumber = luminance(first), secondNumber = luminance(second);
  return (Math.max(firstNumber, secondNumber) + 0.05) / (Math.min(firstNumber, secondNumber) + 0.05);
}
function blend(from, to, shareNumber) {
  return [from[0] + (to[0] - from[0]) * shareNumber, from[1] + (to[1] - from[1]) * shareNumber, from[2] + (to[2] - from[2]) * shareNumber];
}
const LIGHT_GLASS_BASE = [255, 255, 255], SMOKED_GLASS_BASE = [12, 15, 20];
/** How much of the average a kind of glass takes into its tint. */
const AVERAGE_SHARE = { light: 0.1, smoked: 0.3 };

function thinnestShare(isSmoked, base, sorted) {
  const harsh = isSmoked ? sorted[Math.floor(sorted.length * 0.75)] : sorted[Math.floor(sorted.length * 0.25)];
  for (let shareNumber = 0.3; shareNumber <= 0.95; shareNumber += 0.02) {
    const seen = blend(harsh, base, shareNumber), ink = isSmoked ? [247, 249, 252] : [20, 23, 28], quiet = isSmoked ? blend(seen, ink, 0.7) : [89, 96, 106];
    if (contrast(seen, quiet) >= 4.5 && contrast(seen, ink) >= 6) return shareNumber;
  }
  return 0.95;
}

const hex = (color) => "#" + color.map((channelNumber) => Math.round(channelNumber).toString(16).padStart(2, "0")).join("").toUpperCase();
const fromHex = (hexColor) => [parseInt(hexColor.slice(1, 3), 16), parseInt(hexColor.slice(3, 5), 16), parseInt(hexColor.slice(5, 7), 16)];

/** The tone of a picture's pixels (RGBA, 8 bits each), sampled evenly. */
export function toneOfPixels(rgba) {
  const pixelCount = Math.floor(rgba.length / 4);
  if (!pixelCount) return null;
  const skippedPixelCount = Math.max(1, Math.floor(pixelCount / 2400)), colors = [];
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += skippedPixelCount) colors.push([rgba[pixelIndex * 4], rgba[pixelIndex * 4 + 1], rgba[pixelIndex * 4 + 2]]);
  const sum = colors.reduce((total, color) => [total[0] + color[0], total[1] + color[1], total[2] + color[2]], [0, 0, 0]);
  const average = [sum[0] / colors.length, sum[1] / colors.length, sum[2] / colors.length];
  const sorted = colors.slice().sort((first, second) => luminance(first) - luminance(second));
  const lightShareNumber = thinnestShare(false, blend(LIGHT_GLASS_BASE, average, AVERAGE_SHARE.light), sorted);
  const smokedShareNumber = thinnestShare(true, blend(SMOKED_GLASS_BASE, average, AVERAGE_SHARE.smoked), sorted);
  const isSmoked = lightShareNumber > smokedShareNumber;
  return { average_color: hex(average), is_glass_smoked: isSmoked ? 1 : 0, glass_tint_pct: Math.round(Math.min(lightShareNumber, smokedShareNumber) * 100) };
}

/** The tint the glass over it takes, as the backdrop script sets --glass-tint. */
export function glassTint(tone) {
  const isSmoked = tone.is_glass_smoked === 1;
  const base = blend(isSmoked ? SMOKED_GLASS_BASE : LIGHT_GLASS_BASE, fromHex(tone.average_color), isSmoked ? AVERAGE_SHARE.smoked : AVERAGE_SHARE.light);
  return `rgba(${base.map(Math.round).join(", ")}, ${(tone.glass_tint_pct / 100).toFixed(2)})`;
}

/** A PNG's pixels as RGBA: 8 bits a channel, gray, RGB or RGBA, not interlaced. Anything else answers null. */
export async function pngPixels(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 33 || view.getUint32(0) !== 0x89504e47) return null;
  let chunkIndex = 8, widthPx = 0, heightPx = 0, colorTypeNumber = -1;
  const compressed = [];
  while (chunkIndex + 8 <= bytes.length) {
    const chunkSizeBytes = view.getUint32(chunkIndex), chunkType = String.fromCharCode(...bytes.subarray(chunkIndex + 4, chunkIndex + 8));
    const chunkBytes = bytes.subarray(chunkIndex + 8, chunkIndex + 8 + chunkSizeBytes);
    if (chunkType === "IHDR") {
      widthPx = view.getUint32(chunkIndex + 8); heightPx = view.getUint32(chunkIndex + 12); colorTypeNumber = chunkBytes[9];
      if (chunkBytes[8] !== 8 || chunkBytes[12] !== 0 || ![0, 2, 4, 6].includes(colorTypeNumber)) return null;
    } else if (chunkType === "IDAT") compressed.push(chunkBytes);
    else if (chunkType === "IEND") break;
    chunkIndex += 12 + chunkSizeBytes;
  }
  if (!widthPx || !heightPx || !compressed.length) return null;
  const channelCount = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorTypeNumber], rowSizeBytes = widthPx * channelCount;
  const filtered = new Uint8Array(await new Response(new Blob(compressed).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
  if (filtered.length < (rowSizeBytes + 1) * heightPx) return null;
  // Each row starts with its filter: none, sub (from the left), up, average or Paeth.
  const rows = new Uint8Array(rowSizeBytes * heightPx);
  for (let rowIndex = 0; rowIndex < heightPx; rowIndex++) {
    const filterNumber = filtered[rowIndex * (rowSizeBytes + 1)], source = filtered.subarray(rowIndex * (rowSizeBytes + 1) + 1, (rowIndex + 1) * (rowSizeBytes + 1)), rowStartIndex = rowIndex * rowSizeBytes;
    for (let byteIndex = 0; byteIndex < rowSizeBytes; byteIndex++) {
      const leftNumber = byteIndex >= channelCount ? rows[rowStartIndex + byteIndex - channelCount] : 0;
      const upNumber = rowIndex ? rows[rowStartIndex - rowSizeBytes + byteIndex] : 0;
      const upLeftNumber = rowIndex && byteIndex >= channelCount ? rows[rowStartIndex - rowSizeBytes + byteIndex - channelCount] : 0;
      const predictedNumber = filterNumber === 1 ? leftNumber : filterNumber === 2 ? upNumber : filterNumber === 3 ? (leftNumber + upNumber) >> 1 : filterNumber === 4 ? paeth(leftNumber, upNumber, upLeftNumber) : 0;
      rows[rowStartIndex + byteIndex] = (source[byteIndex] + predictedNumber) & 255;
    }
  }
  const rgba = new Uint8Array(widthPx * heightPx * 4), isGray = channelCount <= 2;
  for (let pixelIndex = 0; pixelIndex < widthPx * heightPx; pixelIndex++) {
    const sourceIndex = pixelIndex * channelCount;
    rgba[pixelIndex * 4] = rows[sourceIndex];
    rgba[pixelIndex * 4 + 1] = isGray ? rows[sourceIndex] : rows[sourceIndex + 1];
    rgba[pixelIndex * 4 + 2] = isGray ? rows[sourceIndex] : rows[sourceIndex + 2];
    rgba[pixelIndex * 4 + 3] = 255;
  }
  return rgba;
}
function paeth(leftNumber, upNumber, upLeftNumber) {
  const estimateNumber = leftNumber + upNumber - upLeftNumber;
  const leftDistanceNumber = Math.abs(estimateNumber - leftNumber), upDistanceNumber = Math.abs(estimateNumber - upNumber), upLeftDistanceNumber = Math.abs(estimateNumber - upLeftNumber);
  return leftDistanceNumber <= upDistanceNumber && leftDistanceNumber <= upLeftDistanceNumber ? leftNumber : upDistanceNumber <= upLeftDistanceNumber ? upNumber : upLeftNumber;
}

export async function toneOfPng(bytes) {
  const rgba = await pngPixels(bytes);
  return rgba ? toneOfPixels(rgba) : null;
}

/** The glass tint, in percent, at which a background forces thick glass over it. */
export const THICK_GLASS_TINT_PCT = 70;

/** The notes for what the check drew: its shimmer, from two frames at the check's size, and the glass its still needs. */
export async function shaderCheckNotes(shimmerPngs, tone, checkWidthPx, checkHeightPx) {
  const notes = [];
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

/** A compiler's first line as the check says it. */
export const compileMessage = (compileError) => `It didn't compile: ${compileError.replace(/[.\s]+$/, "")}.`;

/**
 * What a check before sending answers from what the renderer drew (the shader_check, schemas.ts SHADER_CHECK), without its sheet:
 * the compiler's first error, each level's time against its most, flashes, the glass its still needs and the notes. The API keeps the
 * sheet and links it; `zaisma check` saves it beside the folder.
 */
export async function shaderDraftAnswer(drawn, screen) {
  const answer = { compile_error: null, quality_checks: [], flash_count: null, is_glass_smoked: null, glass_tint_pct: null, notes: [], sheet_url: null, sheet_expires_at: null };
  if (drawn.compileError) return { ...answer, compile_error: compileMessage(drawn.compileError) };
  const { qualityChecks } = measureQualityLevels(drawn);
  const tone = drawn.smallStillPng ? await toneOfPng(drawn.smallStillPng) : null;
  const sizes = checkSizes(screen);
  return {
    ...answer,
    quality_checks: qualityChecks,
    flash_count: drawn.levels.some((level) => level.frameLuminances.length) ? mostFlashes(drawn) : null,
    is_glass_smoked: tone ? tone.is_glass_smoked === 1 : null,
    glass_tint_pct: tone ? tone.glass_tint_pct : null,
    notes: await shaderCheckNotes(drawn.shimmerPngs, tone, sizes.checkWidthPx, sizes.checkHeightPx),
  };
}

/** Whether a check before sending would pass the check when sent, as far as drawing goes: it compiled, keeps to every level's most and doesn't flash. */
export const isShaderCheckPassing = (shaderCheck) =>
  !shaderCheck.compile_error &&
  shaderCheck.quality_checks.length > 0 &&
  shaderCheck.quality_checks.every((qualityCheck) => qualityCheck.check_frame_ms <= qualityCheck.maximum_check_frame_ms) &&
  (shaderCheck.flash_count ?? 0) <= SHADER_LIMITS.maximumFlashCountPerSec;
