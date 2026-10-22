import { html, type Raw } from "../markup.ts";
import { pageScript, type PageScript } from "../page-scripts.ts";
import { component } from "./component.ts";
import { glassPane } from "./foundations.ts";
import { runButton } from "./actions.ts";

/*
 * The city: Zaisma's own live 3D scene, from the sign-in draft. One city on land in an endless sea, seen on one slow cinematic loop,
 * with orange shapes (players and games) moving through it that break apart when tapped enough, and a sea that rings with foam where
 * it's tapped. Signing in and making an account sit on it (docs/DECISIONS.md, "Signing in happens in the city, on every device"),
 * and the developer front door can reuse it: nothing here is the sign-in's.
 *
 * cityStage() is the city's sky, a still of the same city (a tiny blurred placeholder until the full one is needed) and the canvas.
 * CITY_SCRIPT draws the city into the canvas as soon as the page has painted, hidden while its first frames compile and settle, then
 * sharpens it in out of the placeholder, so nothing half-made or stuttering ever shows. The canvas never
 * starts under reduced motion or without WebGL 2, and stops on a device that can't keep it smooth even at its lowest step: the still
 * stands in then, loaded only then and faded in once it has wholly loaded.
 *
 * The stills are renders of the city itself (brand/sign-in/, served at /sign-in/): its first live frame, the camera at
 * [430, 120, 300] looking at [0, 20, 0] with the city's seed 7274, unshifted, at midday for light and at night for dark. Wide ones
 * are 3900×1500 at the wide view's 0.72 rad height of view, phone ones 1500×1500 at the phone's 0.95, both wider than a screen,
 * so shown at the screen's height and moved as the camera's picture is shifted they match the first live frame. WebP, quality 0.82.
 */

/** One still of the city, day or night: its picture is the stage's CSS, so only the one showing (by theme, phone or wide) is loaded, at once. */
const still = (timeOfDay: "day" | "night") => html`<div class="city-still is-${timeOfDay}"></div>`;

export interface CityStageOptions {
  /** Fills its own box instead of the window: the gallery's example. */
  isFramed?: boolean;
}

/**
 * The city's stage: its sky, its still (only where the city can't run) and its canvas, under everything else on the page. A pane over it carries data-city-pane, so the city
 * keeps itself centred in the part of the screen the pane doesn't cover (and, on a phone, the pane starts low, below the city).
 */
export function cityStage(options: CityStageOptions = {}): Raw {
  return html`<div class="city-stage${options.isFramed ? " is-framed" : ""}" aria-hidden="true">${still("day")}${still("night")}<canvas class="city"></canvas></div>`;
}

/*
 * The city script. From the draft's "Small seeded random" to its end, unchanged in look. What's new:
 * - It finds its canvas and the pane over it on the page, and works in the canvas's own box (the gallery frames it).
 * - Phones (a coarse pointer, or narrower than 760px) start at 1 pixel per CSS pixel instead of 1.5, and any screen draws at most
 *   about 3.2 million pixels, sharpened lightly where that's fewer than the screen has. It steps back up after a slow spell passes.
 * - A tropical haze over everything, thick at the sea and thinning with height, warm toward the sun by day and dark blue at night.
 * - It's built once the page has loaded, so the still and the pane never wait for it.
 * - Below the draft's lowest resolution, two cheaper steps: bloom and depth of field off, then the god rays, the lens glint and
 *   half the flyers off. Slow even then, the still comes back and it stops.
 * - Taps work by touch as clicks do: a touch that didn't move is a tap; a drag scrolls the page.
 * - Night follows the theme the page shows where the canvas is (its color-scheme).
 */
export const CITY_SCRIPT: PageScript = pageScript("city", String.raw`(function () {
  var canvas = document.querySelector("canvas.city");
  if (!canvas) return;
  var stage = canvas.closest(".city-stage"), host = stage.parentElement, isFramed = stage.classList.contains("is-framed");
  var pane = host.querySelector("[data-city-pane]"), header = host.querySelector("header.top");
  function isNarrow() { return window.innerWidth <= 760; }

  /* On a phone the pane starts low, so the city has most of the screen and only the pane's top shows, down to its heading; it's measured
     again only when the width changes (not when the browser's bars come and go while scrolling). It's the pane's place whether or not
     the city runs. */
  var placedWidth = 0;
  function place() {
    if (!pane || isFramed || window.innerWidth === placedWidth) return;
    placedWidth = window.innerWidth;
    if (!isNarrow()) { pane.style.marginTop = ""; return; }
    // The first heading showing (a pane can hold views that take turns, like Sign in and Make an account).
    var heading = Array.prototype.find.call(pane.querySelectorAll("h1, h2"), function (el) { return el.getClientRects().length > 0; });
    pane.style.marginTop = "0px";
    var peek = (heading ? heading.getBoundingClientRect().bottom : pane.getBoundingClientRect().top + 120) - pane.getBoundingClientRect().top + 24;
    var below = header ? header.offsetTop + header.offsetHeight + 12 : 12;
    pane.style.marginTop = Math.round(Math.max(below, window.innerHeight - peek)) + "px";
  }

  // Keep the city centred in the part of the screen the glass doesn't cover: a shift of the camera's picture, in screen halves (as the
  // projection takes it), left by half the pane on a wide screen, up by the pane's part of the screen on a phone.
  function shiftFor() {
    if (!pane || isFramed) return [0, 0];
    var r = pane.getBoundingClientRect(), b = canvas.getBoundingClientRect();
    if (r.width === 0) return [0, 0];
    if (isNarrow()) { var clear = header ? header.getBoundingClientRect().bottom - b.top : 0, h = b.height; return [0, Math.min(0.74, Math.max(0, 1 - (clear + Math.min(r.top - b.top, h)) / h))]; }
    return [-r.width / b.width, 0];
  }
  /* The still is the live city's first frame, rendered at the camera's own height of view (vertical) and wider than any screen: shown at
     the screen's height, centred and moved as the camera's picture is shifted, it lines up with the first live frame on any screen. */
  function frameStill() {
    var s = shiftFor(), b = canvas.getBoundingClientRect();
    stage.style.setProperty("--still-x", (s[0] * b.width / 2).toFixed(1) + "px");
    stage.style.setProperty("--still-y", (-s[1] * b.height / 2).toFixed(1) + "px");
  }
  function settle() { place(); frameStill(); }
  settle();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { placedWidth = 0; settle(); });
  window.addEventListener("resize", settle);

  // Under reduced motion nothing moves: the still stays, with everything already in place.
  /* Where the city can't run, the still stands in for good: loaded only then, and swapped in for the placeholder once it has wholly
     loaded, so it never shows half-drawn; the placeholder's blur clears as it does. */
  function showStill() {
    var shown = Array.prototype.find.call(stage.querySelectorAll(".city-still"), function (el) { return getComputedStyle(el).display !== "none"; });
    var url = shown && (getComputedStyle(shown).getPropertyValue("--still-full").match(/url\("?([^")]+)"?\)/) || [])[1];
    function reveal() { stage.classList.add("is-still"); }
    if (!url) { reveal(); return; }
    var image = new Image(); image.src = url;
    (image.decode ? image.decode() : new Promise(function (done) { image.onload = image.onerror = done; })).then(reveal, reveal);
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { showStill(); return; }
  var gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, powerPreference: "high-performance" });
  if (!gl) { showStill(); return; }
  // The phone layout's city: fewer flyers, a smaller shadow map and a wider view (the still for phones is rendered the same way).
  var small = isNarrow();
  var coarse = window.matchMedia("(pointer: coarse)").matches;
  // The size of the city's box, in CSS pixels, and where it is on the screen.
  function box() { return canvas.getBoundingClientRect(); }
  // Night when the page shows dark where the canvas is.
  function isNight() { return /dark/.test(getComputedStyle(canvas).colorScheme || ""); }
  var running = false, stopped = false;
  // Too slow even at the lowest step: back to the still, for good.
  function giveUp() { stopped = true; running = false; canvas.classList.remove("on"); showStill(); }

  function run() {
    // Small seeded random, so the city is the same city on every visit.
    var seed = 7274;
    function rand() { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function smooth(a, b, x) { var t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

    // Matrices, column-major.
    function perspective(fovy, aspect, near, far) {
      var f = 1 / Math.tan(fovy / 2);
      return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0];
    }
    function ortho(l, r, b, t, n, f) {
      return [2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1];
    }
    function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
    function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
    function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
    function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
    function lookAt(eye, target, up) {
      var z = norm(sub(eye, target)), x = norm(cross(up, z)), yv = cross(z, x);
      return [x[0], yv[0], z[0], 0, x[1], yv[1], z[1], 0, x[2], yv[2], z[2], 0, -dot(x, eye), -dot(yv, eye), -dot(z, eye), 1];
    }
    function mul(a, b) {
      var o = new Array(16);
      for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
        var s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s;
      }
      return o;
    }
    function project(m, p) {
      var x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], yv = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      return [x / w, yv / w];
    }

    // A unit box: x and z from -0.5 to 0.5, y from 0 to 1, so a box stands on its offset.
    var faces = [
      [[1, 0, 0], [[.5, 0, -.5], [.5, 1, -.5], [.5, 1, .5], [.5, 0, .5]]],
      [[-1, 0, 0], [[-.5, 0, .5], [-.5, 1, .5], [-.5, 1, -.5], [-.5, 0, -.5]]],
      [[0, 1, 0], [[-.5, 1, -.5], [-.5, 1, .5], [.5, 1, .5], [.5, 1, -.5]]],
      [[0, -1, 0], [[-.5, 0, .5], [-.5, 0, -.5], [.5, 0, -.5], [.5, 0, .5]]],
      [[0, 0, 1], [[.5, 0, .5], [.5, 1, .5], [-.5, 1, .5], [-.5, 0, .5]]],
      [[0, 0, -1], [[-.5, 0, -.5], [-.5, 1, -.5], [.5, 1, -.5], [.5, 0, -.5]]]
    ];
    var cube = [];
    faces.forEach(function (f) {
      var n = f[0], q = f[1];
      [0, 1, 2, 0, 2, 3].forEach(function (i) { cube.push(q[i][0], q[i][1], q[i][2], n[0], n[1], n[2]); });
    });
    cube = new Float32Array(cube);

    function shader(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    function program(vs, fs) {
      var p = gl.createProgram();
      gl.attachShader(p, shader(gl.VERTEX_SHADER, vs)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    }
    function locations(p, names) { var o = {}; names.forEach(function (n) { o[n] = gl.getUniformLocation(p, n); }); return o; }

    // The air: a tropical haze, thick over the sea and thinning with height, so distance reads at a glance. How much of it lies
    // between the eye and a point is the integral of a density falling off with height (exact for an exponential), and toward
    // the sun it glows warm with the light it scatters. Thinner and dark blue at night.
    var FOG_GLSL = "uniform vec3 uFog; uniform float uFogDensity; uniform float uFogFalloff;\n" +
      "float hazeAt(vec3 cam, vec3 at){ vec3 ray = at - cam; float d = length(ray); float dy = ray.y / max(d, 1e-3) * uFogFalloff * d;\n" +
      " float along = abs(dy) < 1e-4 ? d : d * (1.0 - exp(-dy)) / dy;\n" +
      " return 1.0 - exp(-uFogDensity * exp(-max(cam.y, 0.0) * uFogFalloff) * along); }\n" +
      "vec3 hazeColor(vec3 cam, vec3 at, vec3 sun, float night){ vec3 dir = normalize(at - cam); float toward = pow(max(dot(dir, sun), 0.0), 6.0);\n" +
      " return mix(uFog, mix(vec3(1.0, 0.93, 0.8), vec3(0.3, 0.38, 0.6), night), toward * mix(0.5, 0.3, night)); }\n";
    var BOX_VS = "#version 300 es\n" +
      "layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor;\n" +
      "layout(location=2) in vec3 iOff; layout(location=3) in vec3 iScale; layout(location=4) in vec4 iCol; layout(location=5) in vec4 iFade; layout(location=6) in vec2 iRot;\n" +
      "uniform mat4 uViewProj; uniform mat4 uLightViewProj;\n" +
      "out vec3 vNor; out vec4 vCol; out vec3 vWorld; out vec4 vLight; out float vFade; out vec3 vLocal; out vec3 vSize; out vec3 vFace;\n" +
      "void main(){ vec3 c = vec3(0.0, iScale.y * 0.5, 0.0); vec3 q = aPos * iScale - c; vec3 nn = aNor;\n" +
      " float cp = cos(iRot.y), sp = sin(iRot.y), cy = cos(iRot.x), sy = sin(iRot.x);\n" +
      " q = vec3(q.x * cp - q.y * sp, q.x * sp + q.y * cp, q.z); nn = vec3(nn.x * cp - nn.y * sp, nn.x * sp + nn.y * cp, nn.z);\n" +
      " q = vec3(q.x * cy - q.z * sy, q.y, q.x * sy + q.z * cy); nn = vec3(nn.x * cy - nn.z * sy, nn.y, nn.x * sy + nn.z * cy);\n" +
      " vec3 w = iOff + q + c; vWorld = w; vNor = nn; vCol = iCol; vLocal = aPos; vSize = iScale; vFace = aNor;\n" +
      " vFade = iFade.w > 0.5 ? clamp(dot(aPos, iFade.xyz) + 0.5, 0.0, 1.0) : 1.0;\n" +
      " vLight = uLightViewProj * vec4(w + nn * 0.12, 1.0);\n" +
      " gl_Position = uViewProj * vec4(w, 1.0); }";
    // Matte low-poly light: sky light from above, a warm sun with crisp shadows, light bouncing off the white ground.
    var BOX_FS = "#version 300 es\nprecision highp float; precision highp sampler2DShadow;\n" +
      "in vec3 vNor; in vec4 vCol; in vec3 vWorld; in vec4 vLight; in float vFade; in vec3 vLocal; in vec3 vSize; in vec3 vFace;\n" +
      "uniform sampler2DShadow uShadow; uniform vec3 uSun; uniform vec3 uCam; uniform float uLit; uniform float uOpaque; uniform float uEdge; uniform float uNight;\n" +
      "out vec4 outColor;\n" + FOG_GLSL +
      "float shadowAt(){ vec3 p = vLight.xyz / vLight.w * 0.5 + 0.5; if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return 1.0;\n" +
      " return texture(uShadow, vec3(p.xy, p.z - 0.0004)); }\n" +
      "void main(){ vec3 n = normalize(vNor); vec3 base = vCol.rgb;\n" +
      " float diff = max(dot(n, uSun), 0.0); float sh = uLit > 0.5 ? shadowAt() : 1.0;\n" +
      " vec3 sky = mix(vec3(0.78, 0.87, 1.0), vec3(0.19, 0.25, 0.42), uNight); vec3 bounce = mix(vec3(0.84, 0.84, 0.85), vec3(0.1, 0.11, 0.15), uNight);\n" +
      " vec3 amb = mix(bounce, sky, n.y * 0.5 + 0.5) * mix(0.66, 0.36, uNight);\n" +
      // A weak fill from the side away from the sun, so the two shaded sides of a building never match.
      " float fill = max(dot(n, normalize(vec3(0.75, 0.25, -0.3))), 0.0) * 0.16;\n" +
      " float ao = mix(0.8, 1.0, clamp(vWorld.y / 7.0, 0.0, 1.0));\n" +
      " vec3 lit = base * ((amb + vec3(0.8, 0.88, 1.0) * fill * (1.0 - 0.75 * uNight)) * ao + mix(vec3(1.0, 0.95, 0.86) * 0.78, vec3(0.55, 0.66, 0.95) * 0.58, uNight) * diff * sh);\n" +
      // Walls get a little lighter toward the top, so a near building's base stands out against the one behind it.
      " if (abs(vFace.y) < 0.5) lit *= mix(0.93, 1.04, vLocal.y);\n" +
      " if (uNight > 0.01 && uLit > 0.5 && abs(vFace.y) < 0.5 && vSize.y > 6.0) {\n" +
      "  vec2 wc = vec2(abs(vFace.x) > 0.5 ? (vLocal.z + 0.5) * vSize.z : (vLocal.x + 0.5) * vSize.x, vLocal.y * vSize.y);\n" +
      "  vec2 cell = floor(wc / vec2(1.7, 2.4)); vec2 inCell = fract(wc / vec2(1.7, 2.4));\n" +
      "  float hw = fract(sin(dot(cell, vec2(12.9898, 78.233)) + dot(vSize, vec3(3.1, 1.7, 5.3)) + dot(vFace, vec3(7.0, 0.0, 13.0))) * 43758.5453);\n" +
      "  float pane = step(0.28, inCell.x) * step(inCell.x, 0.72) * step(0.3, inCell.y) * step(inCell.y, 0.74) * step(2.0, wc.y) * step(wc.y, vSize.y - 1.0);\n" +
      "  float near = 1.0 - smoothstep(260.0, 640.0, distance(vWorld, uCam));\n" +
      "  lit += mix(vec3(0.62, 0.72, 0.95), vec3(1.0, 0.8, 0.52), step(0.985, hw)) * pane * step(0.93, hw) * 0.42 * near * uNight; }\n" +
      // A crisp, one-pixel edge line along every box edge.
      " vec3 q = vec3(vLocal.x + 0.5, vLocal.y, vLocal.z + 0.5); vec3 toEdge = min(q, 1.0 - q) * vSize;\n" +
      " float e = abs(vFace.x) > 0.5 ? min(toEdge.y, toEdge.z) : (abs(vFace.y) > 0.5 ? min(toEdge.x, toEdge.z) : min(toEdge.x, toEdge.y));\n" +
      " float px = fwidth(e); float line = 1.0 - smoothstep(px * 0.5, px * 1.6, e);\n" +
      " lit *= 1.0 - line * 0.1 * (1.0 - smoothstep(220.0, 620.0, distance(vWorld, uCam)));\n" +
      " vec3 col = mix(base * (0.9 + 0.22 * diff) * (1.0 + 0.2 * uNight), lit, uLit);\n" +
      " if (uLit < 0.5) col += vec3(1.0, 0.86, 0.6) * line * 0.5 * uEdge + vec3(0.06, 0.035, 0.0);\n" +
      // The orange shapes keep more of their color through the haze, so they still read from afar.
      " col = mix(col, hazeColor(uCam, vWorld, uSun, uNight), hazeAt(uCam, vWorld) * mix(0.7, 1.0, uLit));\n" +
      " outColor = vec4(col, uOpaque > 0.5 ? 0.0 : vCol.a * vFade); }";
    var DEPTH_VS = "#version 300 es\nlayout(location=0) in vec3 aPos; layout(location=2) in vec3 iOff; layout(location=3) in vec3 iScale;\n" +
      "uniform mat4 uLightViewProj; void main(){ gl_Position = uLightViewProj * vec4(iOff + aPos * iScale, 1.0); }";
    var DEPTH_FS = "#version 300 es\nprecision mediump float; out vec4 o; void main(){ o = vec4(1.0); }";
    var FULL_VS = "#version 300 es\nout vec2 vUv; void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }";
    var SKY_FS = "#version 300 es\nprecision highp float; in vec2 vUv;\n" +
      "uniform vec3 uFwd; uniform vec3 uRight; uniform vec3 uUp; uniform vec2 uTan; uniform vec2 uShift; uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec3 uSun; uniform float uNight; out vec4 o;\n" +
      "void main(){ vec2 s = vUv * 2.0 - 1.0 - uShift; vec3 d = normalize(uFwd + uRight * s.x * uTan.x + uUp * s.y * uTan.y);\n" +
      " float h = clamp(d.y, 0.0, 1.0); vec3 c = mix(uHorizon, uZenith, pow(h, 0.45));\n" +
      // The sun: a small white disc in a warm glow. Alpha 1 marks open sky for the god rays and the glint.
      " float toSun = max(dot(d, uSun), 0.0); c += mix(vec3(1.0, 0.96, 0.88), vec3(0.84, 0.9, 1.0), uNight) * (smoothstep(0.99955, 0.99975, toSun) * mix(1.6, 1.2, uNight) + pow(toSun, 900.0) * 0.4 + pow(toSun, 80.0) * mix(0.1, 0.035, uNight));\n" +
      " vec2 sc = vec2(atan(d.z, d.x) * 150.0, d.y * 150.0); vec2 ci = floor(sc); float hs = fract(sin(dot(ci, vec2(127.1, 311.7))) * 43758.5453);\n" +
      " float star = step(0.982, hs) * smoothstep(0.32, 0.05, length(fract(sc) - 0.5)) * (0.35 + 0.65 * fract(hs * 91.7)) * smoothstep(0.03, 0.3, d.y);\n" +
      " c += vec3(0.85, 0.9, 1.0) * star * uNight;\n" +
      " o = vec4(c, 1.0); }";
    // The sea: an endless faceted surface, low-poly like the city, slowly rising and falling, aqua in the shallows by the coast, with rings of foam where it's tapped.
    var WATER_VS = "#version 300 es\nlayout(location=0) in vec2 aXZ; layout(location=1) in float aSeed; uniform mat4 uViewProj; uniform float uY; uniform float uTime; out vec3 vWorld; out float vShallow;\n" +
      "void main(){ vec2 p = aXZ; float r = length(p); float t = uTime; float a = atan(p.y, p.x);\n" +
      " float coast = 300.0 + 26.0 * sin(3.0 * a + 0.7) + 18.0 * sin(5.0 * a + 2.1) + 9.0 * sin(9.0 * a + 4.0);\n" +
      " float shore = mix(0.3, 1.0, smoothstep(coast - 5.0, coast + 30.0, r)); vShallow = 1.0 - smoothstep(coast, coast + 70.0, r);\n" +
      " float amp = 0.12 + smoothstep(310.0, 440.0, r) * r * 0.0016;\n" +
      // Every point of the sea bobs on its own, so each triangle tilts and catches the light differently.
      " float y = amp * (0.75 * sin(t * (0.2 + aSeed * 0.2) + aSeed * 6.2832) + 0.3 * sin(p.x * 0.008 + p.y * 0.006 + t * 0.18));\n" +
      " vWorld = vec3(p.x, uY + y * shore, p.y); gl_Position = uViewProj * vec4(vWorld, 1.0); }";
    var WATER_FS = "#version 300 es\nprecision highp float; in vec3 vWorld; in float vShallow;\n" +
      "uniform vec3 uCam; uniform vec3 uSun; uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec4 uRipples[12]; uniform int uRippleCount; uniform float uNight; out vec4 o;\n" + FOG_GLSL +
      "void main(){ vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld))); if (n.y < 0.0) n = -n;\n" +
      " float d = distance(vWorld, uCam); vec3 v = normalize(uCam - vWorld); vec3 r = reflect(-v, n);\n" +
      " float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);\n" +
      " vec3 skyRef = mix(uHorizon, uZenith, pow(clamp(r.y, 0.0, 1.0), 0.45));\n" +
      " float shallow = vShallow;\n" +
      " vec3 deep = mix(mix(vec3(0.16, 0.53, 0.88), vec3(0.16, 0.84, 0.82), shallow), mix(vec3(0.025, 0.05, 0.1), vec3(0.058, 0.21, 0.245), shallow), uNight); float facet = 0.82 + 0.3 * max(dot(n, uSun), 0.0);\n" +
      " vec3 c = mix(deep * facet, skyRef * (0.94 + 0.08 * facet), clamp(fres * 0.9 + 0.22, 0.0, 0.85) * (1.0 - mix(0.4, 0.68, uNight) * shallow));\n" +
      // A soft path of sunlight on the water toward the sun, broken up by the facets, never blinding.
      " vec2 toward = normalize(vWorld.xz - uCam.xz); float along = max(dot(toward, normalize(uSun.xz)), 0.0);\n" +
      " float glare = pow(along, 26.0) * smoothstep(150.0, 900.0, d) * (1.0 - smoothstep(2600.0, 6000.0, d));\n" +
      " float sparkle = 0.55 + 0.9 * pow(max(dot(n, normalize(uSun + v)), 0.0), 60.0);\n" +
      " c += mix(vec3(1.0, 0.97, 0.9), vec3(0.7, 0.8, 1.0), uNight) * min(glare * sparkle * mix(0.42, 0.34, uNight), 0.4);\n" +
      // A tap sends out two rings of foam and a burst of white in the middle, sized (w) by how far away it is, so it shows from anywhere.
      " for (int i = 0; i < 12; i++) { if (i >= uRippleCount) break; vec4 rp = uRipples[i]; if (rp.w > 0.5) { float age = rp.z, dd = distance(vWorld.xz, rp.xy) / rp.w;\n" +
      "   float w1 = 0.6 + age * 0.35, k1 = dd - age * 5.0, k2 = dd - max(0.0, age - 0.4) * 3.6;\n" +
      "   float foam = exp(-k1 * k1 / (w1 * w1)) * exp(-age * 1.1) + 0.6 * exp(-k2 * k2 / (w1 * w1 * 0.6)) * exp(-age * 1.4) * step(0.4, age)\n" +
      "     + 0.8 * exp(-dd * dd / (1.2 + age * 5.0)) * exp(-age * 3.5);\n" +
      "   c = mix(c, mix(vec3(1.08, 1.12, 1.14), vec3(0.5, 0.6, 0.75), uNight) * (0.88 + 0.16 * facet), clamp(foam * 0.6, 0.0, 0.6)); } }\n" +
      // The haze, and far out the sea meets the sky's horizon, so there's no edge to the world.
      " c = mix(c, hazeColor(uCam, vWorld, uSun, uNight), hazeAt(uCam, vWorld));\n" +
      " c = mix(c, uHorizon, smoothstep(2600.0, 7000.0, d));\n" +
      " o = vec4(c, 0.0); }";
    // Bright parts of the picture, for the bloom.
    var BRIGHT_FS = "#version 300 es\nprecision highp float; in vec2 vUv; uniform sampler2D uTex; uniform float uThreshold; out vec4 o;\n" +
      "void main(){ vec3 c = texture(uTex, vUv).rgb; float l = dot(c, vec3(0.2126, 0.7152, 0.0722));\n" +
      " float k = smoothstep(uThreshold, uThreshold + 0.12, l);\n" +
      " float orange = smoothstep(0.42, 0.68, c.r - c.b) * smoothstep(0.12, 0.26, c.r - c.g);\n" +
      " o = vec4(c * k + vec3(1.0, 0.55, 0.12) * orange * 2.6, 1.0); }";
    var RAYS_FS = "#version 300 es\nprecision highp float; in vec2 vUv; uniform sampler2D uTex; uniform vec2 uSunUv; uniform vec2 uAspect; out vec4 o;\n" +
      "float light(vec2 uv){ vec4 t = texture(uTex, uv); vec2 d = (uv - uSunUv) * uAspect; return t.a * pow(max(0.0, 1.0 - length(d) * 2.2), 3.0) * dot(t.rgb, vec3(0.4)); }\n" +
      "void main(){ vec2 delta = (vUv - uSunUv) / 40.0; float jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);\n" +
      " vec2 uv = vUv - delta * jit; float sum = 0.0, fall = 1.0;\n" +
      " for (int i = 0; i < 40; i++) { sum += light(uv) * fall; fall *= 0.951; uv -= delta; }\n" +
      " o = vec4(vec3(1.0, 0.93, 0.8) * sum / 18.7, 1.0); }";
    // How much of the sun is open sky, worked out once per frame into a single pixel: a ring of samples round it in the scene's sky mask.
    var SEEN_FS = "#version 300 es\nprecision highp float; uniform sampler2D uTex; uniform vec2 uSunUv; uniform vec2 uAspect; out vec4 o;\n" +
      "void main(){ float v = texture(uTex, uSunUv).a; for (int i = 0; i < 8; i++) { float a = float(i) * 0.7854; v += texture(uTex, uSunUv + vec2(cos(a), sin(a)) * 0.012 / uAspect).a; } o = vec4(v / 9.0); }";
    var COPY_FS = "#version 300 es\nprecision highp float; in vec2 vUv; uniform sampler2D uTex; out vec4 o; void main(){ o = texture(uTex, vUv); }";
    var BLUR_FS = "#version 300 es\nprecision highp float; in vec2 vUv; uniform sampler2D uTex; uniform vec2 uStep; out vec4 o;\n" +
      "void main(){ vec3 c = texture(uTex, vUv).rgb * 0.227027;\n" +
      " c += (texture(uTex, vUv + uStep * 1.3846).rgb + texture(uTex, vUv - uStep * 1.3846).rgb) * 0.316216;\n" +
      " c += (texture(uTex, vUv + uStep * 3.2308).rgb + texture(uTex, vUv - uStep * 3.2308).rgb) * 0.070270;\n" +
      " o = vec4(c, 1.0); }";
    // Final picture: depth of field toward the near and far edges, bloom, a gentle grade and vignette.
    var COMPOSITE_FS = "#version 300 es\nprecision highp float; in vec2 vUv;\n" +
      "uniform sampler2D uScene; uniform sampler2D uSoft; uniform sampler2D uBloom; uniform sampler2D uRays; uniform float uFocusY; uniform float uBloomStrength; uniform vec2 uAspect; uniform float uSharpen;\n" +
      "uniform vec2 uSunUv; uniform float uSunIn; uniform sampler2D uSeen; out vec4 o;\n" +
      "float hex(vec2 p, float r){ p = abs(p); return max(p.x * 0.866 + p.y * 0.5, p.y) - r; }\n" +
      // Where the picture is drawn with fewer pixels than the screen has, a light sharpen against its four neighbours brings the edges back.
      "void main(){ vec3 sharp = texture(uScene, vUv).rgb; vec3 soft = texture(uSoft, vUv).rgb;\n" +
      " if (uSharpen > 0.0) { ivec2 at = ivec2(gl_FragCoord.xy); vec3 around = texelFetch(uScene, at + ivec2(1, 0), 0).rgb + texelFetch(uScene, at - ivec2(1, 0), 0).rgb + texelFetch(uScene, at + ivec2(0, 1), 0).rgb + texelFetch(uScene, at - ivec2(0, 1), 0).rgb;\n" +
      "  sharp = clamp(sharp + (sharp - around * 0.25) * uSharpen, 0.0, 1.0); }\n" +
      " float coc = smoothstep(0.16, 0.62, abs(vUv.y - uFocusY));\n" +
      " vec3 c = mix(sharp, soft, coc * 0.9);\n" +
      " c += texture(uBloom, vUv).rgb * uBloomStrength;\n" +
      " if (uSunIn > 0.0) c += texture(uRays, vUv).rgb * 0.4 * uSunIn;\n" +
      // The glint: a six-point star from the aperture, a soft streak, a faint halo, and hexagonal ghosts along the line through the middle of the frame.
      " float seen = uSunIn > 0.0 ? texture(uSeen, vec2(0.5)).r * uSunIn : 0.0; if (seen > 0.001) { vec2 p = (vUv - uSunUv) * uAspect; float r = length(p), ang = atan(p.y, p.x);\n" +
      "  float star = pow(abs(cos(ang * 3.0)), 80.0) * exp(-r * 11.0) * 0.55 + exp(-r * 34.0) * 0.45;\n" +
      "  float streak = exp(-abs(p.y) * 180.0) * exp(-abs(p.x) * 3.5) * 0.25;\n" +
      "  float halo = smoothstep(0.03, 0.0, abs(r - 0.26)) * 0.06;\n" +
      "  vec3 g = vec3(1.0, 0.95, 0.85) * (star + streak) + vec3(0.7, 0.85, 1.0) * halo;\n" +
      "  vec2 axis = (vec2(0.5) - uSunUv) * uAspect;\n" +
      "  for (int k = 0; k < 5; k++) { float f = float(k); float at = 0.45 + f * 0.36; float size = 0.025 + mod(f * 0.037, 0.06);\n" +
      "   vec3 tint = k == 0 ? vec3(1.0, 0.6, 0.35) : k == 1 ? vec3(0.4, 0.8, 1.0) : k == 2 ? vec3(1.0, 0.45, 0.4) : k == 3 ? vec3(0.6, 1.0, 0.7) : vec3(0.8, 0.7, 1.0);\n" +
      "   float h = hex(p - axis * at * 2.0, size); g += tint * (smoothstep(0.006, -0.004, h) * 0.07 + smoothstep(0.003, 0.0, abs(h)) * 0.06); }\n" +
      "  c += g * seen; }\n" +
      " c = mix(c, c * vec3(0.97, 0.99, 1.04), 1.0 - smoothstep(0.2, 0.75, dot(c, vec3(0.333))));\n" +
      " c *= 1.04; vec2 v = (vUv - 0.5) * uAspect; c *= 1.0 - dot(v, v) * 0.07;\n" +
      " c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;\n" +
      " o = vec4(c, 1.0); }";

    var boxProgram = program(BOX_VS, BOX_FS), depthProgram = program(DEPTH_VS, DEPTH_FS), skyProgram = program(FULL_VS, SKY_FS);
    var brightProgram = program(FULL_VS, BRIGHT_FS), copyProgram = program(FULL_VS, COPY_FS), blurProgram = program(FULL_VS, BLUR_FS), compositeProgram = program(FULL_VS, COMPOSITE_FS);
    var U = locations(boxProgram, ["uViewProj", "uLightViewProj", "uShadow", "uSun", "uCam", "uFog", "uFogDensity", "uFogFalloff", "uLit", "uOpaque", "uEdge", "uNight"]);
    var UD = locations(depthProgram, ["uLightViewProj"]);
    var US = locations(skyProgram, ["uFwd", "uRight", "uUp", "uTan", "uShift", "uHorizon", "uZenith", "uSun", "uNight"]);
    var UB = locations(brightProgram, ["uTex", "uThreshold"]);
    var UC = locations(copyProgram, ["uTex"]);
    var UBL = locations(blurProgram, ["uTex", "uStep"]);
    var UX = locations(compositeProgram, ["uScene", "uSoft", "uBloom", "uRays", "uFocusY", "uBloomStrength", "uAspect", "uSunUv", "uSunIn", "uSeen", "uSharpen"]);
    var raysProgram = program(FULL_VS, RAYS_FS), UR = locations(raysProgram, ["uTex", "uSunUv", "uAspect"]);
    var seenProgram = program(FULL_VS, SEEN_FS), USN = locations(seenProgram, ["uTex", "uSunUv", "uAspect"]);
    var waterProgram = program(WATER_VS, WATER_FS);
    var UW = locations(waterProgram, ["uViewProj", "uY", "uCam", "uSun", "uHorizon", "uZenith", "uTime", "uRipples", "uRippleCount", "uNight", "uFog", "uFogDensity", "uFogFalloff"]);
    // The sea's facets: rings of triangles that grow with distance, so they look the same size on screen out to the horizon.
    var waterVao = gl.createVertexArray(); gl.bindVertexArray(waterVao);
    var waterVerts = [], RINGS = 34, SEGMENTS = 64, R0 = 200, GROW = Math.pow(9000 / R0, 1 / RINGS);
    function ringPoint(i, j) {
      var r = R0 * Math.pow(GROW, i), a = (j + 0.5 * (i % 2)) / SEGMENTS * Math.PI * 2, jj = j % SEGMENTS;
      var h = Math.sin(i * 127.1 + jj * 311.7) * 43758.5453;
      return [Math.cos(a) * r, Math.sin(a) * r, h - Math.floor(h)];
    }
    for (var ri = 0; ri < RINGS; ri++) for (var sj = 0; sj < SEGMENTS; sj++) {
      var pa = ringPoint(ri, sj), pb = ringPoint(ri, sj + 1), pc = ringPoint(ri + 1, sj), pd = ringPoint(ri + 1, sj + 1);
      var order = ri % 2 === 0 ? [pa, pc, pb, pb, pc, pd] : [pa, pc, pd, pa, pd, pb];
      order.forEach(function (q) { waterVerts.push(q[0], q[1], q[2]); });
    }
    var waterBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, waterBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(waterVerts), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 12, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 12, 8);
    gl.bindVertexArray(null);
    var WATER_COUNT = waterVerts.length / 3;

    var cubeBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, cube, gl.STATIC_DRAW);

    var STRIDE = 16; // offset 3, scale 3, color 4, fade 4, heading and climb 2
    function group(capacity, dynamic) {
      var vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuffer);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
      var buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      var data = new Float32Array(capacity * STRIDE);
      gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
      var sizes = [3, 3, 4, 4, 2], at = 0;
      for (var i = 0; i < 5; i++) {
        gl.enableVertexAttribArray(2 + i);
        gl.vertexAttribPointer(2 + i, sizes[i], gl.FLOAT, false, STRIDE * 4, at * 4);
        gl.vertexAttribDivisor(2 + i, 1);
        at += sizes[i];
      }
      gl.bindVertexArray(null);
      return { vao: vao, buffer: buffer, data: data, count: 0, capacity: capacity };
    }
    function put(g, x, y, z, sx, sy, sz, r, gg, b, a, fx, fy, fz, fw, yaw, pitch) {
      if (g.count >= g.capacity) return;
      var o = g.count * STRIDE, d = g.data;
      d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = sx; d[o + 4] = sy; d[o + 5] = sz;
      d[o + 6] = r; d[o + 7] = gg; d[o + 8] = b; d[o + 9] = a;
      d[o + 10] = fx || 0; d[o + 11] = fy || 0; d[o + 12] = fz || 0; d[o + 13] = fw || 0; d[o + 14] = yaw || 0; d[o + 15] = pitch || 0;
      g.count++;
    }
    function upload(g) { gl.bindBuffer(gl.ARRAY_BUFFER, g.buffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, g.data, 0, g.count * STRIDE); }

    /* Build the city: the one city, on land in an endless sea. A downtown of towers, then dense lower districts out to a ragged coast. Every level sits at its own height, so nothing flickers. */
    var CORE = 20, LAND = 54, C = 14, BLOCK = 10, HALF = CORE * C / 2, OUT_HALF = LAND * C / 2;
    var STREET_Y = 0, PAVE_H = 0.25, WATER_Y = -1.2;
    var city = group(18000, false);
    function white() { var v = 0.93 + rand() * 0.07; return [v, v + 0.003, v + 0.009]; }
    function coastAt(x, z) { var a = Math.atan2(z, x); return 300 + 26 * Math.sin(3 * a + 0.7) + 18 * Math.sin(5 * a + 2.1) + 9 * Math.sin(9 * a + 4); }
    var downtown = [], allBuildings = [];
    function building(x, z, w, d, h, roofy) {
      var col = white();
      put(city, x, PAVE_H, z, w, h, d, col[0], col[1], col[2], 1);
      var top = PAVE_H + h;
      if (h > 40 && roofy < 0.5) { // a stepped crown on some of the tallest
        var w2 = w * 0.7, d2 = d * 0.7, h2 = h * 0.14;
        put(city, x, top, z, w2, h2, d2, col[0], col[1], col[2], 1);
        top += h2;
      } else if (roofy < 0.06) { // the odd box on a roof
        put(city, x + (rand() - 0.5) * w * 0.4, top, z + (rand() - 0.5) * d * 0.4, 1.6 + rand(), 0.9 + rand() * 0.8, 1.6 + rand(), 0.88, 0.89, 0.9, 1);
      }
      var record = { x: x, z: z, w: w, d: d, top: top };
      allBuildings.push(record);
      if (Math.abs(x) < 152 && Math.abs(z) < 152) downtown.push(record);
      return top;
    }
    // Smaller centres in the districts, so the city rises in a few places beyond downtown.
    var DISTRICTS = [[190, 40], [-150, 160], [-60, -215], [200, -150], [-215, -30]];
    var landCells = [];
    for (var gx = 0; gx < LAND; gx++) {
      for (var gz = 0; gz < LAND; gz++) {
        var cx = (gx - LAND / 2 + 0.5) * C, cz = (gz - LAND / 2 + 0.5) * C;
        var dist = Math.hypot(cx, cz);
        if (dist > coastAt(cx, cz)) continue;
        landCells.push([cx, cz]);
        put(city, cx, -3, cz, C, 3, C, 0.85, 0.865, 0.885, 1); // the land under this block, with its streets on top
        put(city, cx, STREET_Y, cz, BLOCK + 0.8, PAVE_H, BLOCK + 0.8, 0.93, 0.935, 0.945, 1); // the block's pavement
        var inCore = Math.max(Math.abs(cx), Math.abs(cz)) < HALF;
        if (dist > 45 && rand() < 0.05) { // a park: a lawn of light stone with a few blocky trees
          put(city, cx, PAVE_H, cz, BLOCK - 1.5, 0.16, BLOCK - 1.5, 0.9, 0.915, 0.92, 1);
          for (var tree = 0; tree < 8; tree++) {
            var ts = 1.2 + rand() * 1.1;
            put(city, cx + (rand() - 0.5) * 6.5, PAVE_H + 0.16, cz + (rand() - 0.5) * 6.5, ts, ts * (1 + rand() * 0.6), ts, 0.86, 0.88, 0.89, 1);
          }
          continue;
        }
        var split = inCore ? (rand() < (dist < 50 ? 0.7 : 0.45) ? 1 : (rand() < 0.5 ? 2 : 4)) : (rand() < 0.3 ? 2 : 4);
        var lots = split === 1 ? [[0, 0, BLOCK, BLOCK]] : split === 2 ? [[-BLOCK / 4, 0, BLOCK / 2, BLOCK], [BLOCK / 4, 0, BLOCK / 2, BLOCK]] :
          [[-BLOCK / 4, -BLOCK / 4, BLOCK / 2, BLOCK / 2], [BLOCK / 4, -BLOCK / 4, BLOCK / 2, BLOCK / 2], [-BLOCK / 4, BLOCK / 4, BLOCK / 2, BLOCK / 2], [BLOCK / 4, BLOCK / 4, BLOCK / 2, BLOCK / 2]];
        lots.forEach(function (lot) {
          var w = lot[2] - 0.9 - rand() * 1.2, d = lot[3] - 0.9 - rand() * 1.2, h;
          if (inCore) {
            var core = smooth(150, 0, dist);
            h = lerp(7, 58, core * core) * (0.5 + rand() * 0.8) + rand() * 3;
            if (dist < 45 && rand() < 0.25) h += 25 + rand() * 45;
          } else {
            h = lerp(10, 3, smooth(HALF, 300, dist)) * (0.6 + rand() * 0.7);
            var lx = cx + lot[0], lz = cz + lot[1], lift = 0;
            DISTRICTS.forEach(function (c) { lift = Math.max(lift, smooth(46, 0, Math.hypot(lx - c[0], lz - c[1]))); });
            if (lift > 0) h += lift * (10 + rand() * 26);
            else if (rand() < 0.025) h = 14 + rand() * 16;
          }
          building(cx + lot[0], cz + lot[1], w, d, h, rand());
        });
      }
    }
    // Bays in the tall downtown towers: a dark mouth in a white frame, a platform out front and a canopy over it, where low flying cars dock.
    var bays = [];
    function tallestNear(x, z) {
      var top = 0;
      for (var i = 0; i < downtown.length; i++) {
        var b = downtown[i];
        if (Math.abs(x - b.x) < b.w / 2 + 1.5 && Math.abs(z - b.z) < b.d / 2 + 1.5 && b.top > top) top = b.top;
      }
      return top;
    }
    downtown.filter(function (b) { return b.top > 50 && Math.min(b.w, b.d) > 6.5; }).forEach(function (b) {
      var sides = [[1, 0], [-1, 0], [0, 1], [0, -1]], made = 0;
      for (var s = 0; s < 4 && made < 2; s++) {
        var side = sides[(s + Math.floor(rand() * 4)) % 4], nx = side[0], nz = side[1];
        var y = Math.round(b.top * (0.32 + rand() * 0.4)), along = (rand() - 0.5) * ((nx ? b.d : b.w) - 7.5);
        var wx = b.x + nx * b.w / 2 + (nx ? 0 : along), wz = b.z + nz * b.d / 2 + (nz ? 0 : along);
        var clear = true;
        for (var reach = 2.5; reach <= 18 && clear; reach += 1.5) {
          for (var spread = -4; spread <= 4 && clear; spread += 4) {
            if (tallestNear(wx + nx * reach + nz * spread, wz + nz * reach + nx * spread) > y - 5) clear = false;
          }
        }
        if (!clear || bays.some(function (o) { return Math.abs(o.top - y) < 8 && Math.hypot(o.x - wx, o.z - wz) < 12; })) continue;
        var across = nx ? [0.6, 6.4] : [6.4, 0.6], frame = nx ? [0.3, 7.4] : [7.4, 0.3];
        put(city, wx, y - 0.5, wz, frame[0], 5.9, frame[1], 0.95, 0.955, 0.965, 1);                       // the frame round the mouth
        put(city, wx + nx * 0.1, y, wz + nz * 0.1, across[0], 4.5, across[1], 0.33, 0.39, 0.5, 1);        // the dark mouth
        var deck = nx ? [5.4, 7.6] : [7.6, 5.4];
        put(city, wx + nx * 2.7, y - 0.6, wz + nz * 2.7, deck[0], 0.6, deck[1], 0.97, 0.975, 0.98, 1);    // the platform
        var lip = nx ? [2.2, 7.8] : [7.8, 2.2];
        put(city, wx + nx * 1.1, y + 5, wz + nz * 1.1, lip[0], 0.45, lip[1], 0.95, 0.955, 0.965, 1);    // the canopy
        bays.push({ x: wx + nx * 2.3, z: wz + nz * 2.3, top: y, out: [nx * 16, nz * 16], faceIn: Math.atan2(-nz, -nx), bay: true,
          w: Math.abs(deck[0]) + 0.4, d: Math.abs(deck[1]) + 0.4, cx: wx + nx * 2.1, cz: wz + nz * 2.1, roof: y + 5.5 });
        made++;
      }
    });
    upload(city);

    /* The orange shapes: players and games moving through the city. Plain cubes, seen from afar. */
    function streetAt(i) { return (i - CORE / 2) * C; }
    var flyers = [], walkers = [];
    // Flyers drift on smooth, slightly wobbling loops around the downtown towers, each loop high enough to clear every roof under it.
    // Roof heights on a one-unit grid over the whole city, each building widened by a small margin.
    var MAP = 720, MAP_HALF = 360, roofMap = new Float32Array(MAP * MAP);
    allBuildings.forEach(function (b) {
      var x0 = Math.max(0, Math.floor(b.x - b.w / 2 - 1.5 + MAP_HALF)), x1 = Math.min(MAP - 1, Math.ceil(b.x + b.w / 2 + 1.5 + MAP_HALF));
      var z0 = Math.max(0, Math.floor(b.z - b.d / 2 - 1.5 + MAP_HALF)), z1 = Math.min(MAP - 1, Math.ceil(b.z + b.d / 2 + 1.5 + MAP_HALF));
      for (var ix = x0; ix <= x1; ix++) for (var iz = z0; iz <= z1; iz++) { var i = iz * MAP + ix; if (b.top > roofMap[i]) roofMap[i] = b.top; }
    });
    bays.forEach(function (b) {
      for (var ix = Math.floor(b.cx - b.w / 2 - 1 + MAP_HALF); ix <= Math.ceil(b.cx + b.w / 2 + 1 + MAP_HALF); ix++)
        for (var iz = Math.floor(b.cz - b.d / 2 - 1 + MAP_HALF); iz <= Math.ceil(b.cz + b.d / 2 + 1 + MAP_HALF); iz++) {
          var i = iz * MAP + ix; if (i >= 0 && i < roofMap.length && b.roof > roofMap[i]) roofMap[i] = b.roof;
        }
    });
    var roofExact = new Float32Array(MAP * MAP);
    allBuildings.forEach(function (b) {
      for (var ix = Math.ceil(b.x - b.w / 2 + MAP_HALF); ix < b.x + b.w / 2 + MAP_HALF; ix++)
        for (var iz = Math.ceil(b.z - b.d / 2 + MAP_HALF); iz < b.z + b.d / 2 + MAP_HALF; iz++) {
          var i = iz * MAP + ix; if (i >= 0 && i < roofExact.length && b.top > roofExact[i]) roofExact[i] = b.top;
        }
    });
    function heightUnderExact(x, z) {
      var ix = Math.floor(x + MAP_HALF), iz = Math.floor(z + MAP_HALF);
      return ix < 0 || iz < 0 || ix >= MAP || iz >= MAP ? 0 : roofExact[iz * MAP + ix];
    }
    function heightUnder(x, z) {
      var ix = Math.floor(x + MAP_HALF), iz = Math.floor(z + MAP_HALF);
      if (ix < 0 || iz < 0 || ix >= MAP || iz >= MAP) return 0;
      return roofMap[iz * MAP + ix];
    }
    function loopPoint(m, theta) {
      var k = 1 + m.wob * Math.sin(3 * theta + m.phase);
      var lx = Math.cos(theta) * m.rx * k, lz = Math.sin(theta) * m.rz * k;
      var c = Math.cos(m.rot), s = Math.sin(m.rot);
      return [m.cx + lx * c - lz * s, m.y + m.bob * Math.sin(theta + m.phase), m.cz + lx * s + lz * c];
    }
    // Each loop flyer circles close around one downtown tower, at some height on it; a loop is kept only if nothing else is in its way.
    var towers = downtown.filter(function (b) { return b.top > 42; }).sort(function (a, b) { return b.top - a.top; });
    var towerCount = Math.min(towers.length, 12);
    function flyerKind(m, meanRadius) {
      var kind = rand();
      if (kind < 0.25) { m.size = 2.8; m.tail = 18; m.speed = 3 + rand() * 1.5; }
      else if (kind < 0.6) { m.size = 1.5; m.tail = 7; m.speed = 6 + rand() * 3; }
      else { m.size = 2.1; m.tail = 13; m.speed = 4 + rand() * 3; }
      m.off = [0, 0, 0]; m.vel = [0, 0, 0]; m.pop = 0; m.at = [0, 0, 0]; m.hits = 0; m.heat = 0; m.grow = 1;
      return m;
    }
    function makeLoop(tw) {
      for (var attempt = 0; attempt < 40; attempt++) {
        var rad = Math.hypot(tw.w, tw.d) / 2 + 2.5 + rand() * 5;
        var m = { loop: true, cx: tw.x, cz: tw.z, rx: rad, rz: rad * (1 + rand() * 0.3), rot: rand() * Math.PI, wob: 0.05,
          phase: rand() * 6.28, theta: rand() * 6.28, sign: rand() < 0.5 ? 1 : -1, y: tw.top * (0.3 + rand() * 0.6), bob: 1 + rand() * 3 };
        var ok = true;
        for (var sIndex = 0; sIndex < 64 && ok; sIndex++) {
          var pt = loopPoint(m, sIndex / 64 * Math.PI * 2);
          if (heightUnder(pt[0], pt[2]) > pt[1] - 2.5) ok = false;
        }
        if (!ok) continue;
        var meanRadius = (m.rx + m.rz) / 2;
        flyerKind(m);
        m.omega = m.speed / meanRadius; m.step = (m.size < 2 ? 1.2 : m.size < 2.5 ? 1.1 : 1.0) / meanRadius;
        return m;
      }
      return null;
    }
    // Lane flyers run the street canyons in both directions, weaving low between the towers. Each keeps near the buildings around it: never far above the skyline, never in the sky over the low districts, and always clear of what's right under it.
    var LANE_STEP = 4;
    function laneProfile(m) {
      var n = Math.ceil(m.limit * 2 / LANE_STEP) + 2, want = new Float32Array(n), floor = new Float32Array(n), blur = new Float32Array(n);
      function at(p, along, side) { return m.axis === "x" ? heightUnder(p + along, m.lane + side) : heightUnder(m.lane + side, p + along); }
      for (var i = 0; i < n; i++) {
        var p = -m.limit + i * LANE_STEP, sky = 0, under = 0;
        for (var a = -20; a <= 20; a += 4) for (var c = -28; c <= 28; c += 4) sky = Math.max(sky, at(p, a, c));
        for (var a2 = -4; a2 <= 4; a2 += 2) for (var c2 = -3; c2 <= 3; c2 += 1.5) under = Math.max(under, at(p, a2, c2));
        floor[i] = Math.max(6, under + 5);
        want[i] = Math.max(floor[i], Math.min(m.y, sky + 9));
      }
      for (var round = 0; round < 3; round++) {
        for (var j = 0; j < n; j++) { var sum = 0, count = 0; for (var o = -5; o <= 5; o++) if (j + o >= 0 && j + o < n) { sum += want[j + o]; count++; } blur[j] = sum / count; }
        for (var k = 0; k < n; k++) want[k] = Math.max(blur[k], floor[k]);
      }
      m.alt = want; m.over = Math.max.apply(null, floor) - m.y;
    }
    function lanePoint(m, p) {
      var f = Math.min(m.alt.length - 1.001, Math.max(0, (p + m.limit) / LANE_STEP)), i = Math.floor(f);
      var y = lerp(m.alt[i], m.alt[i + 1], f - i) + Math.sin(p * 0.02 + m.phase) * 1.5;
      return m.axis === "x" ? [p, y, m.lane] : [m.lane, y, p];
    }
    // A lane never passes through a bay's platform or canopy where they reach out over a street.
    function laneHitsBay(m) {
      return bays.some(function (b) {
        var across = m.axis === "x" ? Math.abs(m.lane - b.cz) - b.d / 2 : Math.abs(m.lane - b.cx) - b.w / 2;
        if (across > 2) return false;
        var y = lanePoint(m, m.axis === "x" ? b.cx : b.cz)[1];
        return y > b.top - 3.5 && y < b.roof + 3;
      });
    }
    function makeLane() {
      for (var attempt = 0; attempt < 30; attempt++) {
        var line = (Math.floor(rand() * 19) - 9) * C, sign = rand() < 0.5 ? 1 : -1;
        var m = { lane: line + sign * 0.7, axis: rand() < 0.5 ? "x" : "z", sign: sign, y: 9 + rand() * 34, phase: rand() * 6.28 };
        m.limit = Math.max(120, coastAt(m.axis === "x" ? 1 : 0, m.axis === "x" ? 0 : 1) - 20);
        laneProfile(m);
        // A lane whose street runs into a tower would have to climb right over it: pick another.
        if (m.over < 10 && !laneHitsBay(m)) break;
      }
      m.p = (rand() * 2 - 1) * m.limit;
      flyerKind(m);
      m.speed *= 2.6;
      return m;
    }
    for (var f = 0; f < 40 && flyers.length < 10 && towerCount; f++) {
      var loop = makeLoop(towers[f % towerCount]);
      if (loop) flyers.push(loop);
    }
    for (var laneCount = 0; laneCount < (small ? 14 : 20); laneCount++) flyers.push(makeLane());
    // Low flying cars all over the city: each rests on a roof or in a tower's bay, spools up, lifts off, flies a gentle curve, flares, hovers and touches down.
    var pads = allBuildings.filter(function (b) { return b.top > 4 && b.top < 32 && Math.min(b.w, b.d) > 3.5; });
    pads.forEach(function (p) { p.out = [0, 0]; });
    var hoppers = [];
    function bezier(a, c, b, t) { var u = 1 - t; return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]; }
    function pickPad(from) {
      var list = bays.length && rand() < 0.35 ? bays : pads, to = null;
      for (var tries = 0; tries < 40 && !to; tries++) {
        var c = list[Math.floor(rand() * list.length)], d = Math.hypot(c.x - from.x, c.z - from.z);
        if (c !== from && !c.taken && d > 35 && d < 170) to = c;
      }
      return to || pads[Math.floor(rand() * pads.length)];
    }
    function planFlight(h) {
      var from = h.pad, to = pickPad(from);
      from.taken = false; to.taken = true;
      h.a = [from.x + from.out[0], from.z + from.out[1]]; h.b = [to.x + to.out[0], to.z + to.out[1]];
      var dx = h.b[0] - h.a[0], dz = h.b[1] - h.a[1], len = Math.hypot(dx, dz) || 1, bend = (rand() - 0.5) * 0.7 * len;
      h.c = [(h.a[0] + h.b[0]) / 2 - dz / len * bend, (h.a[1] + h.b[1]) / 2 + dx / len * bend];
      var clear = Math.max(from.top, to.top), length = 0, prev = h.a;
      for (var i = 1; i <= 32; i++) { var q = bezier(h.a, h.c, h.b, i / 32); clear = Math.max(clear, heightUnder(q[0], q[1])); length += Math.hypot(q[0] - prev[0], q[1] - prev[1]); prev = q; }
      h.from = from; h.to = to; h.cruise = clear + 6 + rand() * 8;
      // The phases of one flight, in seconds.
      h.legs = [0.7, from.bay ? 1.5 : 0.45, Math.max(1.2, (h.cruise - from.top - 2.5) / 12), length / (13 + rand() * 4), Math.max(1.2, (h.cruise - to.top - 2.5) / 11), to.bay ? 1.7 : 0.9, 0.45];
      h.t = 0; h.flying = true; h.leg = 0; h.puffed = false;
    }
    for (var hIndex = 0; hIndex < 26 && pads.length > 2; hIndex++) {
      var startPad = hIndex < Math.min(6, bays.length) ? bays[hIndex] : pads[Math.floor(rand() * pads.length)];
      startPad.taken = true;
      var h = { pad: startPad, size: 2.0 + rand() * 0.4, wait: rand() * 6, flying: false, yaw: startPad.bay ? startPad.faceIn : rand() * 6.28,
        off: [0, 0, 0], vel: [0, 0, 0], pop: 0, at: [0, 0, 0], hist: [], histClock: 0, squash: 1, hits: 0, heat: 0, grow: 1 };
      hoppers.push(h);
    }
    // Where a hopper is, how it should face and how it's squashed, for this moment of its flight.
    function hopperPlace(h, dt) {
      h.aim = null; h.lean = 0; h.squash = 1;
      var pad = h.flying ? h.from : h.pad;
      if (!h.flying) {
        h.wait -= dt;
        if (h.wait > 0) return [pad.x, pad.top, pad.z];
        planFlight(h);
      }
      h.t += dt;
      var t = h.t, L = h.legs, k, leg = 0;
      while (leg < L.length && t > L[leg]) { t -= L[leg]; leg++; }
      if (leg !== h.leg) { h.leg = leg; h.legStart = true; } else h.legStart = false;
      k = leg < L.length ? t / L[leg] : 1;
      var from = h.from, to = h.to, a = h.a, b = h.b;
      switch (leg) {
        case 0: // spool up: crouch, then a little shiver as it lifts off the pad
          h.squash = 1 - 0.14 * Math.sin(Math.PI * Math.min(1, k * 1.4));
          if (k > 0.55 && !h.puffed) { h.puffed = true; h.wantPuff = [from.x, from.top + 0.2, from.z]; }
          return [from.x + Math.sin(k * 70) * 0.06 * k, from.top + smooth(0.5, 1, k) * 0.5, from.z + Math.cos(k * 63) * 0.06 * k];
        case 1: { // leave: straight up off a roof, or backing out of a bay and dropping a little
          var e = smooth(0, 1, k);
          h.squash = 1 + 0.12 * Math.sin(Math.PI * k);
          if (from.bay) { h.lean = -0.12 * Math.sin(Math.PI * k); return [lerp(from.x, a[0], e), from.top + 0.5 + Math.sin(Math.PI * k) * -1.2 + e * 2, lerp(from.z, a[1], e)]; }
          return [from.x, from.top + 0.5 + e * 2, from.z];
        }
        case 2: { // climb: speeds up, nose high, turning to face where it's going
          var e2 = k * k * (3 - 2 * k);
          h.aim = Math.atan2(h.c[1] - a[1], h.c[0] - a[0]); h.lean = 0.35 * Math.sin(Math.PI * Math.min(1, k * 1.2));
          h.squash = 1 + 0.08 * Math.sin(Math.PI * k);
          return [a[0], lerp(from.top + 2.5, h.cruise, e2), a[1]];
        }
        case 3: { // across: a gentle arc
          var q = bezier(a, h.c, b, smooth(0, 1, k));
          return [q[0], h.cruise + Math.sin(k * Math.PI) * 2.5, q[1]];
        }
        case 4: { // down: falls quickly then brakes, nose up to flare
          var e4 = 1 - Math.pow(1 - k, 2.4);
          h.lean = 0.3 * smooth(0.45, 1, k); if (to.bay) h.aim = to.faceIn;
          return [b[0], lerp(h.cruise, to.top + 2.5, e4), b[1]];
        }
        case 5: { // in: hovers down onto a roof, or glides into a bay
          var e5 = smooth(0, 1, k), bob = Math.sin(k * Math.PI * 3) * 0.25 * (1 - k);
          if (to.bay) { h.aim = to.faceIn; h.lean = 0.12 * (1 - k); return [lerp(b[0], to.x, e5), to.top + 0.6 + (1 - e5) * 1.9 + bob, lerp(b[1], to.z, e5)]; }
          return [to.x, to.top + 0.6 + (1 - e5) * 1.9 + bob, to.z];
        }
        case 6: { // touchdown: settles with a squash, and the air under it puffs out
          if (h.legStart) h.wantPuff = [to.x, to.top + 0.2, to.z];
          h.squash = 1 - 0.2 * Math.sin(Math.PI * k) * (1 - k * 0.4);
          if (to.bay) h.aim = to.faceIn;
          return [to.x, to.top + 0.6 * (1 - smooth(0, 0.6, k)), to.z];
        }
      }
      h.flying = false; h.pad = to; h.wait = 2 + rand() * 5;
      return [to.x, to.top, to.z];
    }
    // Many more orange blocks on the streets than in the air. Each keeps to a street that stays on land.
    function makeWalker() {
      for (var tries = 0; tries < 20; tries++) {
        var laneAt = (Math.floor(rand() * 34) - 17) * C, reach = Math.sqrt(Math.max(0, 255 * 255 - laneAt * laneAt));
        if (reach < 30) continue;
        return { axis: rand() < 0.5 ? "x" : "z", sign: rand() < 0.5 ? 1 : -1, lane: laneAt + (rand() < 0.5 ? -1.2 : 1.2),
          p: (rand() * 2 - 1) * reach, limit: reach, speed: 1.5 + rand() * 2.5, size: 2.0, hop: -1, at: [0, 0, 0], hits: 0, heat: 0, grow: 1 };
      }
      return null;
    }
    for (var k = 0; k < 620; k++) { var walker = makeWalker(); if (walker) walkers.push(walker); }
    var movers = group(1500, true), trails = group(2600, true);
    var ORANGE = [0.97, 0.56, 0.08], HOT = [1.0, 0.86, 0.56];
    function move(m, limit, dt) {
      m.p += m.speed * m.sign * dt;
      if (m.p > limit) m.p = -limit; else if (m.p < -limit) m.p = limit;
    }
    function position(m, y) { return m.axis === "x" ? [m.p, y, m.lane] : [m.lane, y, m.p]; }
    var sparks = [], shards = [], flashes = [], gathers = [];
    function turnToward(a, b, k) { var d = ((b - a) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI; return a + d * Math.min(1, k); }
    function headingOf(from, to) {
      var dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2], flat = Math.hypot(dx, dz);
      return { yaw: Math.atan2(dz, dx), pitch: Math.max(-0.5, Math.min(0.5, Math.atan2(dy, flat))), flat: flat, length: Math.hypot(flat, dy) };
    }
    // A trail is a ribbon of short blocks, each laid along the path from one point to the next and narrowing toward its end.
    // Up close a trail thins, softens and pales into a streak of light, so it never reads as a row of boxes.
    function ribbon(points, width, alpha) {
      var eye = seen && seen.eye;
      for (var j = 1; j < points.length; j++) {
        var a = points[j], b = points[j - 1], hd = headingOf(a, b), keep = 1 - j / points.length;
        if (hd.length < 0.01) continue;
        var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, mz = (a[2] + b[2]) / 2;
        var near = eye ? smooth(90, 14, Math.hypot(mx - eye[0], my - eye[1], mz - eye[2])) : 0;
        var t = width * (0.25 + 0.75 * keep) * (1 - 0.5 * near);
        put(trails, mx, my - t / 2, mz, hd.length * 1.15 + t * 0.2, t, t, lerp(0.98, 1, near), lerp(0.6, 0.86, near), lerp(0.15, 0.55, near), alpha * Math.sqrt(keep) * (1 - 0.5 * near), 0, 0, 0, 0, hd.yaw, hd.pitch);
      }
    }
    function burst(at, color, count, speed, up, gravity, life, grow) {
      for (var i = 0; i < count; i++) {
        var a = rand() * Math.PI * 2, s = speed * (0.5 + rand() * 0.7);
        sparks.push({ p: at.slice(), v: [Math.cos(a) * s, up * (0.6 + rand() * 0.8), Math.sin(a) * s], life: 1, size: (0.35 + rand() * 0.45) * (grow || 1), color: color,
          g: gravity === undefined ? 16 : gravity, span: life || 1.1 });
      }
      if (sparks.length > 260) sparks.splice(0, sparks.length - 260);
    }
    // The air under a lifting or landing car: a flat ring of pale puffs spreading out over the pad.
    function puff(at) {
      for (var i = 0; i < 14; i++) {
        var a = i / 14 * Math.PI * 2 + rand() * 0.2, s = 5 + rand() * 2.5;
        sparks.push({ p: [at[0] + Math.cos(a) * 1.2, at[1], at[2] + Math.sin(a) * 1.2], v: [Math.cos(a) * s, 0.4 + rand() * 0.6, Math.sin(a) * s], life: 1,
          size: 0.5 + rand() * 0.35, color: [0.97, 0.98, 1.0], g: 0, drag: 3.2, span: 0.8 });
      }
      flashes.push({ p: at.slice(), life: 1, span: 0.5, from: 1.5, to: 7, color: [1, 1, 1], flat: true, alpha: 0.35 });
    }

    /* Tap an orange shape enough times and it breaks apart; a while later another builds itself somewhere else. */
    var HITS_TO_BREAK = 4;
    function hit(m) {
      m.hits = (m.lastHit !== undefined && clock - m.lastHit < 5 ? m.hits : 0) + 1; m.lastHit = clock;
      m.heat = Math.min(1, m.hits / (HITS_TO_BREAK - 1)); m.shake = 1;
      if (m.hits >= HITS_TO_BREAK) shatter(m);
    }
    function shatter(m) {
      var size = m.size, at = m.at, yaw = m.drawYaw || 0, c = Math.cos(yaw), s = Math.sin(yaw);
      var dims = [size * 1.4, size * 0.8, size * 0.8];
      for (var ix = 0; ix < 3; ix++) for (var iy = 0; iy < 3; iy++) for (var iz = 0; iz < 3; iz++) {
        var lx = (ix - 1) / 3 * dims[0], ly = (iy - 1) / 3 * dims[1], lz = (iz - 1) / 3 * dims[2];
        var wx = lx * c - lz * s, wz = lx * s + lz * c, out = 7 + rand() * 9;
        var dir = norm([wx + (rand() - 0.5) * 0.4, ly + 0.6, wz + (rand() - 0.5) * 0.4]);
        shards.push({ p: [at[0] + wx, at[1] + ly, at[2] + wz], v: [dir[0] * out, dir[1] * out + 6 + rand() * 6, dir[2] * out],
          size: size * (0.32 + rand() * 0.2), turn: rand() * 6, spinRate: (rand() - 0.5) * 16, life: 1, span: 1.8 + rand() * 0.8, hot: rand() < 0.35 });
      }
      if (shards.length > 240) shards.splice(0, shards.length - 180);
      flashes.push({ p: at.slice(), life: 1, span: 0.28, from: size * 1.2, to: size * 4, color: [1, 0.68, 0.18], alpha: 0.95 });
      flashes.push({ p: [at[0], at[1] - size * 0.3, at[2]], life: 1, span: 0.7, from: size * 2, to: size * 12, color: [1, 0.74, 0.3], flat: true, alpha: 0.5 });
      burst(at, [1, 0.9, 0.6], 22, 16, 9, 10, 0.9);
      m.gone = true; m.respawn = 4 + rand() * 8; m.hits = 0; m.heat = 0; m.off = m.off && [0, 0, 0]; if (m.vel) m.vel = [0, 0, 0];
    }
    // Respawning: a new place for each kind, then a column of light, motes drawn in from all around, and the shape grows out of them.
    function respawn(m) {
      if (m.loop) { var fresh = null; for (var i = 0; i < 12 && !fresh; i++) fresh = makeLoop(towers[Math.floor(rand() * towerCount)]); if (fresh) Object.assign(m, fresh); }
      else if (m.axis && m.limit && !m.hasOwnProperty("hop")) Object.assign(m, makeLane());
      else if (m.hop !== undefined) Object.assign(m, makeWalker() || {});
      else if (m.pad) {
        if (m.flying && m.to) m.to.taken = false; else m.pad.taken = false;
        var pad = pickPad(m.pad); pad.taken = true;
        m.pad = pad; m.flying = false; m.wait = 3 + rand() * 4; m.yaw = pad.bay ? pad.faceIn : rand() * 6.28; m.hist = []; m.last = null;
      }
      m.gone = false; m.grow = 0; m.hits = 0; m.heat = 0; m.lastHit = undefined;
      gathers.push({ m: m, life: 1, span: 1.1, motes: Array.from({ length: 18 }, function () {
        var a = rand() * Math.PI * 2, r = 7 + rand() * 9; return [Math.cos(a) * r, (rand() - 0.2) * 9, Math.sin(a) * r, 0.3 + rand() * 0.4];
      }) });
    }
    // How big a shape is as it grows back: nothing while the motes gather, then out of them with a small overshoot.
    function growth(m, dt) {
      if (m.grow >= 1) return 1;
      m.grow = Math.min(1, m.grow + dt / 1.5);
      var k = smooth(0.45, 1, m.grow);
      return k <= 0 ? 0 : 1 + Math.sin(k * Math.PI * 1.25) * 0.28 * (1 - k) - Math.pow(1 - k, 3);
    }
    // A shape's colour: orange, glowing hotter with each tap until it breaks, and white hot for a moment as it grows back.
    function tint(m, dt) {
      if (m.lastHit !== undefined && clock - m.lastHit > 5) { m.heat = Math.max(0, m.heat - dt * 0.4); if (!m.heat) m.hits = 0; }
      m.shake = (m.shake || 0) * Math.exp(-dt * 6);
      var k = Math.max(m.heat * 0.75, m.grow < 1 ? 1 - smooth(0.5, 1, m.grow) : 0);
      return [lerp(ORANGE[0], HOT[0], k), lerp(ORANGE[1], HOT[1], k), lerp(ORANGE[2], HOT[2], k)];
    }
    function jitter(m) { var j = (m.shake || 0) * 0.35; return j < 0.01 ? [0, 0, 0] : [(rand() - 0.5) * j, (rand() - 0.5) * j, (rand() - 0.5) * j]; }
    function settleGone(m, dt) {
      if (!m.gone) return false;
      m.respawn -= dt; if (m.respawn <= 0) respawn(m);
      return m.gone;
    }

    function updateMovers(dt) {
      movers.count = 0; trails.count = 0;
      flyers.forEach(function (m) {
        if (settleGone(m, dt)) return;
        for (var a = 0; a < 3; a++) { m.vel[a] += (-9 * m.off[a] - 3.2 * m.vel[a]) * dt; m.off[a] += m.vel[a] * dt; }
        m.pop *= Math.exp(-dt * 4);
        var on, ahead, behind, ends = 1;
        if (m.loop) { m.theta += m.omega * m.sign * dt; on = loopPoint(m, m.theta); ahead = loopPoint(m, m.theta + m.sign * 0.03); behind = function (j) { return loopPoint(m, m.theta - m.sign * m.step * 0.7 * j); }; }
        else {
          m.p += m.speed * m.sign * dt;
          if (m.p * m.sign > m.limit) m.p = -m.sign * m.limit;
          on = lanePoint(m, m.p); ahead = lanePoint(m, m.p + m.sign * 0.6); ends = smooth(m.limit, m.limit - 30, Math.abs(m.p));
          behind = function (j) { return lanePoint(m, m.p - m.sign * 0.85 * j); };
        }
        var hd = headingOf(on, ahead);
        m.spin = (m.spin || 0) * Math.exp(-dt * 2.2);
        var size = m.size * (1 + m.pop * 0.5) * growth(m, dt) * ends, col = tint(m, dt), jt = jitter(m);
        var at = [on[0] + m.off[0] + jt[0], on[1] + m.off[1] + jt[1], on[2] + m.off[2] + jt[2]]; m.at = at; m.drawYaw = hd.yaw + m.spin;
        if (size < 0.02) return;
        put(movers, at[0], at[1] - size * 0.375, at[2], size * 1.5, size * 0.75, size * 0.75, col[0], col[1], col[2], 1, 0, 0, 0, 0, hd.yaw + m.spin, hd.pitch + m.spin * 0.4);
        if (m.grow < 1) return;
        var count = Math.round(m.tail * 1.4), points = [at];
        for (var j = 1; j <= count; j++) {
          var p = behind(j), keep = 1 - j / (count + 1);
          points.push([p[0] + m.off[0] * keep, p[1] + m.off[1] * keep, p[2] + m.off[2] * keep]);
        }
        ribbon(points, m.size * 0.62 * ends, 0.95);
      });
      hoppers.forEach(function (h) {
        if (h.gone) { if (h.flying) { h.t += dt; } if (settleGone(h, dt)) return; }
        for (var a = 0; a < 3; a++) { h.vel[a] += (-9 * h.off[a] - 3.2 * h.vel[a]) * dt; h.off[a] += h.vel[a] * dt; }
        h.pop *= Math.exp(-dt * 4);
        var base = hopperPlace(h, dt), g = growth(h, dt), size = h.size * (1 + h.pop * 0.5) * g, col = tint(h, dt), jt = jitter(h);
        if (h.wantPuff) { puff(h.wantPuff); h.wantPuff = null; }
        var at = [base[0] + h.off[0] + jt[0], base[1] + h.off[1] + jt[1], base[2] + h.off[2] + jt[2]];
        if (h.last && dt > 0) {
          var hd = headingOf(h.last, base), moving = hd.flat / dt > 1.5 && h.leg === 3;
          var want = h.aim !== null && h.aim !== undefined ? h.aim : (moving ? hd.yaw : h.yaw || 0);
          h.yaw = turnToward(h.yaw || 0, want, dt * (h.aim !== null && h.aim !== undefined ? 2.5 : 5));
          var pitchWant = (moving ? hd.pitch : 0) + (h.lean || 0);
          h.pitch = (h.pitch || 0) + (pitchWant - (h.pitch || 0)) * Math.min(1, dt * 4);
        }
        h.last = base;
        h.spin = (h.spin || 0) * Math.exp(-dt * 2.2);
        var sq = h.squash || 1;
        h.at = [at[0], at[1] + size * 0.4, at[2]]; h.drawYaw = (h.yaw || 0) + h.spin;
        if (size > 0.02) put(movers, at[0], at[1], at[2], size * 1.4 / Math.sqrt(sq), size * 0.8 * sq, size * 0.8 / Math.sqrt(sq), col[0], col[1], col[2], 1, 0, 0, 0, 0, h.drawYaw, (h.pitch || 0) + h.spin * 0.4);
        h.histClock += dt;
        if (h.histClock > 0.05) { h.histClock = 0; h.hist.unshift([at[0], at[1] + size * 0.4, at[2]]); if (h.hist.length > 14) h.hist.pop(); }
        if (!h.flying || h.leg < 2 || h.leg > 5) { if (h.hist.length > 1) h.hist.pop(); return; }
        ribbon([[at[0], at[1] + size * 0.4, at[2]]].concat(h.hist), h.size * 0.55, 0.95);
      });
      walkers.forEach(function (m) {
        move(m, m.limit, dt);
        if (settleGone(m, dt)) return;
        var lift = 0, squash = 1;
        if (m.hop >= 0) {
          m.hop += dt / 0.75;
          if (m.hop >= 1) m.hop = -1; else { lift = 6 * Math.sin(Math.PI * m.hop); squash = 1 + 0.25 * Math.sin(Math.PI * 2 * m.hop); }
        }
        var at = position(m, STREET_Y + 0.02 + lift), size = m.size * growth(m, dt), col = tint(m, dt), jt = jitter(m);
        var yaw = m.axis === "x" ? (m.sign > 0 ? 0 : Math.PI) : (m.sign > 0 ? Math.PI / 2 : -Math.PI / 2);
        var flip = m.hop >= 0 ? -Math.PI * 2 * smooth(0, 1, m.hop) : 0;
        m.at = [at[0], at[1] + size * 0.4, at[2]]; m.drawYaw = yaw;
        if (size > 0.02) put(movers, at[0] + jt[0], at[1] + Math.abs(jt[1]), at[2] + jt[2], size * 1.3 / Math.sqrt(squash), size * 0.8 * squash, size * 0.8 / Math.sqrt(squash), col[0], col[1], col[2], 1, 0, 0, 0, 0, yaw, flip);
      });
      // Pieces of a broken shape: they fly, tumble, bounce on whatever is under them, and shrink away.
      shards = shards.filter(function (k) { return k.life > 0; });
      shards.forEach(function (k) {
        k.v[1] -= 22 * dt; k.p[0] += k.v[0] * dt; k.p[1] += k.v[1] * dt; k.p[2] += k.v[2] * dt; k.life -= dt / k.span;
        var floor = Math.max(STREET_Y + PAVE_H, heightUnderExact(k.p[0], k.p[2]));
        if (k.p[1] < floor && k.v[1] < 0) {
          if (floor - k.p[1] < 1.5) { k.p[1] = floor; k.v[1] *= -0.38; k.v[0] *= 0.6; k.v[2] *= 0.6; k.spinRate *= 0.6; }
        }
        k.turn += k.spinRate * dt;
        var sz = k.size * Math.min(1, k.life * 3.5), c = k.hot ? HOT : ORANGE;
        if (sz > 0.02) put(movers, k.p[0], k.p[1], k.p[2], sz, sz, sz, c[0], c[1], c[2], 1, 0, 0, 0, 0, k.turn, k.turn * 0.6);
      });
      // Flashes: a bright box that swells and fades as a shape breaks, and flat rings of air.
      flashes = flashes.filter(function (f) { return f.life > 0; });
      flashes.forEach(function (f) {
        f.life -= dt / f.span;
        var k = 1 - Math.max(0, f.life), sz = lerp(f.from, f.to, 1 - Math.pow(1 - k, 3)), a = f.alpha * Math.max(0, f.life) * Math.max(0, f.life);
        if (f.flat) put(trails, f.p[0], f.p[1], f.p[2], sz, 0.08, sz, f.color[0], f.color[1], f.color[2], a, 0, 0, 0, 0, Math.PI / 4, 0);
        else put(trails, f.p[0], f.p[1] - sz / 2, f.p[2], sz, sz, sz, f.color[0], f.color[1], f.color[2], a, 0, 0, 0, 0, k * 1.5, k);
      });
      // Respawns: a thin column of light over the spot, and motes spiralling in to where the shape grows.
      gathers = gathers.filter(function (g) { return g.life > 0; });
      gathers.forEach(function (g) {
        g.life -= dt / g.span;
        var k = 1 - Math.max(0, g.life), at = g.m.at;
        if (!at || g.m.gone) return;
        var beam = Math.sin(Math.PI * Math.min(1, k * 1.1)) * 0.55;
        if (beam > 0.01) put(trails, at[0], at[1], at[2], 0.5 * (1 - k) + 0.12, 60 * (1 - k * 0.5), 0.5 * (1 - k) + 0.12, 1, 0.86, 0.6, beam, 0, 0, 0, 0, k * 3, 0);
        g.motes.forEach(function (o) {
          var e = smooth(0, 0.62, k) , turn = e * 2.4, c = Math.cos(turn), s = Math.sin(turn), r = 1 - e;
          var x = (o[0] * c - o[2] * s) * r, z = (o[0] * s + o[2] * c) * r, y = o[1] * r;
          var sz = o[3] * (0.4 + r) * (1 - smooth(0.55, 0.7, k));
          if (sz > 0.02) put(trails, at[0] + x, at[1] + y - sz / 2, at[2] + z, sz, sz, sz, 1, 0.74, 0.3, 0.95, 0, 0, 0, 0, turn * 3, turn);
        });
      });
      sparks = sparks.filter(function (k) { return k.life > 0; });
      sparks.forEach(function (k) {
        var drag = k.drag ? Math.exp(-k.drag * dt) : 1;
        k.v[0] *= drag; k.v[2] *= drag; k.v[1] -= k.g * dt; k.p[0] += k.v[0] * dt; k.p[1] += k.v[1] * dt; k.p[2] += k.v[2] * dt; k.life -= dt / k.span;
        var sz = k.size * Math.max(0, k.life);
        k.turn = (k.turn || rand() * 6) + dt * 7;
        put(trails, k.p[0], k.p[1] - sz / 2, k.p[2], sz, sz, sz, k.color[0], k.color[1], k.color[2], Math.max(0, k.life) * 0.9, 0, 0, 0, 0, k.turn, k.turn * 0.7);
      });
      upload(movers); upload(trails);
    }

    /* Light and its crisp shadow map, drawn once: the city doesn't move. */
    var SUN = norm([-0.45, 0.82, 0.36]);
    var SPAN = 360;
    var lightViewProj = mul(ortho(-SPAN, SPAN, -SPAN, SPAN, 1, 1600), lookAt([SUN[0] * 700, SUN[1] * 700, SUN[2] * 700], [0, 0, 0], [0, 1, 0]));
    var SHADOW = Math.min(small ? 2048 : 4096, gl.getParameter(gl.MAX_TEXTURE_SIZE));
    var shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, SHADOW, SHADOW);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    var shadowFb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
    gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
    gl.viewport(0, 0, SHADOW, SHADOW);
    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(depthProgram);
    gl.uniformMatrix4fv(UD.uLightViewProj, false, lightViewProj);
    gl.bindVertexArray(city.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, city.count);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    /* Render targets: the scene with 4x anti-aliasing, resolved into a texture, then half and quarter size copies for the soft focus and the bloom. */
    function colorTexture(w, h) {
      var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      var fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return { tex: t, fb: fb, w: w, h: h };
    }
    var targets = null;
    function freeTargets() {
      if (!targets) return;
      gl.deleteRenderbuffer(targets.msColor); gl.deleteRenderbuffer(targets.msDepth); gl.deleteFramebuffer(targets.msFb);
      ["scene", "halfA", "halfB", "quarterA", "quarterB", "rays", "seen"].forEach(function (key) { gl.deleteTexture(targets[key].tex); gl.deleteFramebuffer(targets[key].fb); });
    }
    function makeTargets(w, h) {
      freeTargets();
      var samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES));
      var msFb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, msFb);
      var msColor = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, msColor);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msColor);
      var msDepth = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, msDepth);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, msDepth);
      var hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1), qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2);
      targets = { msFb: msFb, msColor: msColor, msDepth: msDepth, scene: colorTexture(w, h),
        halfA: colorTexture(hw, hh), halfB: colorTexture(hw, hh), quarterA: colorTexture(qw, qh), quarterB: colorTexture(qw, qh), rays: colorTexture(Math.max(1, w >> 3), Math.max(1, h >> 3)), seen: colorTexture(1, 1) };
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    function pass(prog, target, setup) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
      gl.viewport(0, 0, target ? target.w : width, target ? target.h : height);
      gl.useProgram(prog); setup(); gl.bindVertexArray(null); gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function bindTex(unit, tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }
    function blur(prog, from, via, steps, spread) {
      var k = spread || 1;
      for (var i = 0; i < steps; i++) {
        pass(prog, via, function () { bindTex(0, from.tex); gl.uniform1i(UBL.uTex, 0); gl.uniform2f(UBL.uStep, k / from.w, 0); });
        pass(prog, from, function () { bindTex(0, via.tex); gl.uniform1i(UBL.uTex, 0); gl.uniform2f(UBL.uStep, 0, k / via.h); });
      }
    }

    // Sharp enough at 1.5 pixels per CSS pixel with the anti-aliasing and soft focus (1 on a phone, where the screen is small and the pixels
    // dense), within a budget of pixels a mid-range laptop draws smoothly: a big screen gets fewer per CSS pixel instead of more work.
    // A device that keeps missing frames steps down further, then turns the costliest light off (quality 1, then 2); once frames
    // come easily again it steps back up, twice at most, so it never keeps swinging between the two.
    var PIXEL_BUDGET = 3.2e6;
    var sharpen = 0, width = 0, height = 0, renderScale = 1, slowFor = 0, fastFor = 0, frameAvg = 1 / 60, quality = 0, upsLeft = 2, isSteppedDown = false;
    var sharpness = coarse || isNarrow() ? 1 : 1.5;
    function resize() {
      var ratio = Math.min(window.devicePixelRatio || 1, sharpness, Math.sqrt(PIXEL_BUDGET / Math.max(1, canvas.clientWidth * canvas.clientHeight))) * renderScale;
      width = Math.max(1, Math.floor(canvas.clientWidth * ratio)); height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
      canvas.width = width; canvas.height = height;
      // How much fewer pixels than the screen's: none sharpens nothing, half sharpens most.
      sharpen = Math.min(0.5, Math.max(0, 1 - ratio / Math.min(window.devicePixelRatio || 1, sharpness)) * 0.9);
      makeTargets(width, height);
    }
    window.addEventListener("resize", resize); resize();

    /* The camera: one seamless cinematic loop of shots, no cuts. In from the sea, over the districts, under the tallest tower looking up into the sun as it slips in and out behind the crown, up and out, low over the water, and a high sweep back round. */
    // The haze: how thick it is at the sea (per unit of distance), and how fast it thins with height (1 / its scale height).
    var FOG_DENSITY_DAY = 0.0015, FOG_DENSITY_NIGHT = 0.0009, FOG_FALLOFF = 1 / 70, fogDensity = FOG_DENSITY_DAY;
    var FOG_DAY = [0.66, 0.84, 0.98], ZENITH_DAY = [0.2, 0.53, 0.97], FOG_NIGHT = [0.055, 0.075, 0.14], ZENITH_NIGHT = [0.008, 0.014, 0.04];
    var FOG = FOG_DAY.slice(), ZENITH = ZENITH_DAY.slice();
    var nightTarget = isNight() ? 1 : 0, night = nightTarget;
    // The theme can change in place (a setting, or the system's), and the city eases to day or night with it.
    function followTheme() { nightTarget = isNight() ? 1 : 0; }
    new MutationObserver(followTheme).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["data-theme-choice", "data-theme"] });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", followTheme);
    var LOOP_SEC = 112;
    var T = towers[0] || { x: 0, z: 0, top: 80 };
    var sunFlat = norm([SUN[0], 0, SUN[2]]), across = [-sunFlat[2], 0, sunFlat[0]], UP_TILT = 0.72;
    var aim = [sunFlat[0] * Math.cos(UP_TILT), Math.sin(UP_TILT), sunFlat[2] * Math.cos(UP_TILT)];
    var sunRise = SUN[1] / Math.hypot(SUN[0], SUN[2]); // how far the sun's line climbs per unit across the ground
    function off(base, back, side, y) { return [base[0] - sunFlat[0] * back + across[0] * side, y, base[2] - sunFlat[2] * back + across[2] * side]; }
    function ahead(eye, d) { return [eye[0] + aim[0] * d, eye[1] + aim[1] * d, eye[2] + aim[2] * d]; }
    var tower = [T.x, 0, T.z], underY = Math.max(24, T.top - 6 - 45 * sunRise);
    var sunA = off(tower, 45, -22, underY), sunB = off(tower, 45, 22, underY + 6);
    var SHOTS = [ // [seconds, eye, looking at]
      [0, [430, 120, 300], [0, 20, 0]],
      [13, [250, 58, 175], [30, 24, 10]],
      [25, off(tower, 95, -40, 46), [T.x, T.top * 0.6, T.z]],
      [36, sunA, ahead(sunA, 100)],
      [47, sunB, ahead(sunB, 100)],
      [59, off(tower, 30, 60, T.top + 50), [0, 15, 0]],
      [73, [-380, 16, 140], [-120, 30, 20]],
      [87, [-120, 200, -400], [0, 10, 0]],
      [100, [300, 160, -320], [0, 15, 0]]
    ];
    function catmull(p0, p1, p2, p3, t) {
      var t2 = t * t, t3 = t2 * t;
      return [0, 1, 2].map(function (i) { return 0.5 * (2 * p1[i] + (p2[i] - p0[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (3 * p1[i] - p0[i] - 3 * p2[i] + p3[i]) * t3); });
    }
    function rawShot(time) {
      var t = ((time % LOOP_SEC) + LOOP_SEC) % LOOP_SEC, n = SHOTS.length, i = n - 1;
      for (var j = 0; j < n; j++) if (SHOTS[j][0] <= t) i = j;
      var end = i + 1 < n ? SHOTS[i + 1][0] : LOOP_SEC, k = (t - SHOTS[i][0]) / (end - SHOTS[i][0]);
      var at = function (o) { return SHOTS[((i + o) % n + n) % n]; };
      return { eye: catmull(at(-1)[1], at(0)[1], at(1)[1], at(2)[1], k), target: catmull(at(-1)[2], at(0)[2], at(1)[2], at(2)[2], k) };
    }
    // Keep clear of the city: wherever the path comes too close to a roof or a wall, the whole view lifts, early and smoothly.
    function clearance(x, z) {
      var top = 0;
      for (var dx = -8; dx <= 8; dx += 2) for (var dz = -8; dz <= 8; dz += 2) top = Math.max(top, heightUnder(x + dx, z + dz));
      return top;
    }
    var LIFT_STEPS = 1400, lift = new Float32Array(LIFT_STEPS);
    (function () {
      var need = new Float32Array(LIFT_STEPS), wide = new Float32Array(LIFT_STEPS);
      for (var i = 0; i < LIFT_STEPS; i++) { var e = rawShot(i / LIFT_STEPS * LOOP_SEC).eye; need[i] = Math.max(0, Math.max(clearance(e[0], e[2]) + 7, WATER_Y + 7) - e[1]); }
      for (var a = 0; a < LIFT_STEPS; a++) { var m = 0; for (var o = -30; o <= 30; o++) m = Math.max(m, need[(a + o + LIFT_STEPS) % LIFT_STEPS]); wide[a] = m; }
      for (var round = 0; round < 3; round++) {
        for (var b = 0; b < LIFT_STEPS; b++) { var sum = 0; for (var q = -14; q <= 14; q++) sum += wide[(b + q + LIFT_STEPS) % LIFT_STEPS]; lift[b] = sum / 29; }
        for (var c = 0; c < LIFT_STEPS; c++) wide[c] = Math.max(lift[c], need[c]);
      }
      lift.set(wide);
    })();
    // Close to the buildings the camera hurries on; out over the sea and high above the city it takes its time.
    var hurry = new Float32Array(LIFT_STEPS);
    (function () {
      var raw = new Float32Array(LIFT_STEPS);
      for (var i = 0; i < LIFT_STEPS; i++) {
        var e = rawShot(i / LIFT_STEPS * LOOP_SEC).eye, y = e[1] + lift[i], near = 1e9;
        for (var dx = -90; dx <= 90; dx += 10) for (var dz = -90; dz <= 90; dz += 10) {
          var h = heightUnder(e[0] + dx, e[2] + dz); if (h < STREET_Y + 3) continue;
          near = Math.min(near, Math.hypot(dx, dz, Math.max(0, y - h)));
        }
        raw[i] = 1 + 1.3 * smooth(100, 25, near);
      }
      for (var round = 0; round < 3; round++) {
        for (var b = 0; b < LIFT_STEPS; b++) { var sum = 0; for (var q = -25; q <= 25; q++) sum += raw[(b + q + LIFT_STEPS) % LIFT_STEPS]; hurry[b] = sum / 51; }
        raw.set(hurry);
      }
    })();
    function paceAt(time) {
      var f = ((time % LOOP_SEC + LOOP_SEC) % LOOP_SEC) / LOOP_SEC * LIFT_STEPS, i = Math.floor(f) % LIFT_STEPS;
      return lerp(hurry[i], hurry[(i + 1) % LIFT_STEPS], f - Math.floor(f));
    }
    function shot(time) {
      var view = rawShot(time), f = ((time % LOOP_SEC + LOOP_SEC) % LOOP_SEC) / LOOP_SEC * LIFT_STEPS;
      var i = Math.floor(f) % LIFT_STEPS, up = lerp(lift[i], lift[(i + 1) % LIFT_STEPS], f - Math.floor(f));
      view.eye[1] += up; view.target[1] += up;
      return view;
    }
    // It starts where the still is framed, so the live city takes over from it with nothing moving.
    // The framing is measured once and then held: page scroll, the browser's bars and resizes never move the camera's picture.
    var shiftHeld = shiftFor();
    function shiftTarget() { return shiftHeld; }
    var shift = shiftTarget();

    var clock = 40, camTime = 0, last = performance.now(), isShown = false, warmFrameCount = 0, shownAt = 0;
    running = true;
    var ripples = [], rippleData = new Float32Array(48), seen = null;
    function projectW(m, p) {
      var x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], yv = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      return [x / w, yv / w, w];
    }
    /* Small things to play with: tap a flying car to knock it off course, an orange block on the street to make it hop, the sea to send out a ripple. Tap any of them enough and it breaks. */
    function pick(clientX, clientY) {
      if (!seen) return null;
      var best = null, bestDistance = Infinity;
      function consider(m, radius) {
        var q = projectW(seen.viewProj, m.at);
        if (q[2] <= 0) return;
        var b = box(), sx = b.left + (q[0] * 0.5 + 0.5) * b.width, sy = b.top + (0.5 - q[1] * 0.5) * b.height;
        var d = Math.hypot(sx - clientX, sy - clientY);
        if (d < radius && d < bestDistance) { best = m; bestDistance = d; }
      }
      flyers.forEach(function (m) { if (!m.gone && m.grow >= 1) consider(m, 30); });
      hoppers.forEach(function (m) { if (!m.gone && m.grow >= 1) consider(m, 26); });
      walkers.forEach(function (m) { if (!m.gone && m.grow >= 1) consider(m, 18); });
      return best;
    }
    function seaPoint(clientX, clientY) {
      if (!seen) return null;
      var b = box(), nx = (clientX - b.left) / b.width * 2 - 1 - seen.shift[0], ny = 1 - (clientY - b.top) / b.height * 2 - seen.shift[1];
      var dir = norm([seen.fwd[0] + seen.right[0] * nx * seen.tan[0] + seen.up[0] * ny * seen.tan[1],
        seen.fwd[1] + seen.right[1] * nx * seen.tan[0] + seen.up[1] * ny * seen.tan[1],
        seen.fwd[2] + seen.right[2] * nx * seen.tan[0] + seen.up[2] * ny * seen.tan[1]]);
      if (dir[1] >= -0.01) return null;
      var t = (WATER_Y - seen.eye[1]) / dir[1];
      if (t > 4000) return null;
      var x = seen.eye[0] + dir[0] * t, z = seen.eye[2] + dir[2] * t;
      return Math.hypot(x, z) > coastAt(x, z) + 8 ? [x, z] : null;
    }
    // A mouse plays as it's pressed. A touch plays when it lifts without having moved, so a finger that drags scrolls the page instead.
    var touchStart = null;
    canvas.addEventListener("pointerdown", function (event) {
      if (event.pointerType === "mouse") play(event.clientX, event.clientY);
      else touchStart = { x: event.clientX, y: event.clientY, atMs: performance.now() };
    });
    canvas.addEventListener("pointerup", function (event) {
      var start = touchStart; touchStart = null;
      if (!start || event.pointerType === "mouse") return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 10 && performance.now() - start.atMs < 600) play(event.clientX, event.clientY);
    });
    canvas.addEventListener("pointercancel", function () { touchStart = null; });
    function play(clientX, clientY) {
      var thing = pick(clientX, clientY);
      if (thing && thing.off) {
        var a = rand() * Math.PI * 2;
        thing.vel[0] += Math.cos(a) * 22; thing.vel[1] += 10 + rand() * 6; thing.vel[2] += Math.sin(a) * 22; thing.pop = 1; thing.spin = (thing.spin || 0) + (rand() < 0.5 ? -1 : 1) * (3 + rand() * 2);
        burst(thing.at, [1, 0.66, 0.16], 14, 9, 7);
        hit(thing);
      } else if (thing) {
        if (thing.hop < 0) thing.hop = 0;
        burst(thing.at, [1, 0.66, 0.16], 8, 5, 6);
        hit(thing);
      } else {
        var at = seaPoint(clientX, clientY);
        if (at) {
          var scale = Math.max(1, Math.hypot(at[0] - seen.eye[0], WATER_Y - seen.eye[1], at[1] - seen.eye[2]) / 110);
          ripples.push({ x: at[0], z: at[1], start: clock, w: scale }); if (ripples.length > 12) ripples.shift();
          // A splash: a white puff, a flat flash across the water, and spray thrown up and falling back.
          flashes.push({ p: [at[0], WATER_Y + 0.4 * scale, at[1]], life: 1, span: 0.3, from: 0.4 * scale, to: 1.6 * scale, color: [0.96, 0.99, 1], alpha: 0.55 });
          flashes.push({ p: [at[0], WATER_Y + 0.15, at[1]], life: 1, span: 0.5, from: 0.6 * scale, to: 4 * scale, color: [0.94, 0.99, 1], flat: true, alpha: 0.4 });
          burst([at[0], WATER_Y + 0.3, at[1]], [0.94, 0.98, 1.0], 10, 1.6 * scale, 7 * scale, 16 * scale, 1, 0.55 * scale);
        }
      }
    }

    // It runs only while it can be seen: the page showing, and the canvas in view (the gallery's example can scroll away).
    var isInView = true;
    function wake() {
      var should = !stopped && !document.hidden && isInView;
      if (should === running) return;
      running = should; last = performance.now();
      if (running) requestAnimationFrame(frame);
    }
    document.addEventListener("visibilitychange", wake);
    if (window.IntersectionObserver) new IntersectionObserver(function (entries) { isInView = entries[entries.length - 1].isIntersecting; wake(); }).observe(canvas);

    // The steps below the lowest resolution: bloom and depth of field off, then the god rays, the glint and half the flyers.
    function stepDown() {
      isSteppedDown = true;
      if (renderScale > 0.55) { renderScale = Math.max(0.55, renderScale - 0.15); resize(); return; }
      if (quality === 2) { giveUp(); return; }
      quality++;
      if (quality === 2) flyers = flyers.filter(function (m, i) { return i % 2 === 0; });
    }
    function stepUp() {
      upsLeft--;
      if (quality > 0) quality--;
      else { renderScale = Math.min(1, renderScale + 0.15); resize(); }
      if (renderScale === 1 && quality === 0) isSteppedDown = false;
    }

    function frame(now) {
      if (!running) return;
      var raw = (now - last) / 1000, dt = Math.min(0.05, raw); last = now;
      // Hidden while it warms up, it stays on its first frame (the placeholder's), so it fades in from exactly what was showing.
      var warmDt = isShown ? dt : 0;
      // Only a steady slowdown (under about 42 frames a second for two seconds running) lowers the resolution; a one-off hitch never does.
      if (clock > 43 && raw < 0.25) {
        frameAvg = frameAvg * 0.95 + raw * 0.05;
        slowFor = frameAvg > 0.024 ? slowFor + raw : 0;
        fastFor = frameAvg < 0.0175 ? fastFor + raw : 0;
        if (slowFor > 2) { slowFor = 0; fastFor = 0; frameAvg = 1 / 60; stepDown(); if (stopped) return; }
        else if (fastFor > 5 && isSteppedDown && upsLeft > 0) { fastFor = 0; stepUp(); }
      }
      clock += warmDt;
      night += (nightTarget - night) * Math.min(1, dt * 1.6); if (Math.abs(nightTarget - night) < 0.002) night = nightTarget;
      for (var ci = 0; ci < 3; ci++) { FOG[ci] = lerp(FOG_DAY[ci], FOG_NIGHT[ci], night); ZENITH[ci] = lerp(ZENITH_DAY[ci], ZENITH_NIGHT[ci], night); }
      fogDensity = lerp(FOG_DENSITY_DAY, FOG_DENSITY_NIGHT, night);
      updateMovers(warmDt);
      // The camera sets off gently once it's shown, over the entrance's second and a half, rather than at full pace from a standstill.
      var setOff = isShown ? Math.min(1, (now - shownAt) / 1500) : 0;
      camTime += warmDt * paceAt(camTime) * setOff * setOff * (3 - 2 * setOff);
      var view = shot(camTime);
      var aim = shiftTarget();
      shift[0] += (aim[0] - shift[0]) * Math.min(1, dt * 2.5); shift[1] += (aim[1] - shift[1]) * Math.min(1, dt * 2.5);
      var aspect = width / height, fov = small ? 0.95 : 0.72;
      var proj = perspective(fov, aspect, 4, 9000);
      proj[8] -= shift[0]; proj[9] -= shift[1];
      var viewM = lookAt(view.eye, view.target, [0, 1, 0]);
      var viewProj = mul(proj, viewM);
      var fwd = norm(sub(view.target, view.eye)), right = norm(cross(fwd, [0, 1, 0])), up = cross(right, fwd);
      seen = { viewProj: viewProj, eye: view.eye, fwd: fwd, right: right, up: up, tan: [Math.tan(fov / 2) * aspect, Math.tan(fov / 2)], shift: shift.slice() };
      ripples = ripples.filter(function (r) { return clock - r.start < 5; });
      for (var ri = 0; ri < 12; ri++) {
        var rp = ripples[ri];
        rippleData[ri * 4] = rp ? rp.x : 0; rippleData[ri * 4 + 1] = rp ? rp.z : 0; rippleData[ri * 4 + 2] = rp ? clock - rp.start : 0; rippleData[ri * 4 + 3] = rp ? rp.w : 0;
      }

      // 1. The scene, anti-aliased.
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets.msFb);
      gl.viewport(0, 0, width, height);
      gl.clearColor(FOG[0], FOG[1], FOG[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
      gl.useProgram(skyProgram);
      gl.uniform3fv(US.uFwd, fwd); gl.uniform3fv(US.uRight, right); gl.uniform3fv(US.uUp, up);
      gl.uniform2f(US.uTan, Math.tan(fov / 2) * aspect, Math.tan(fov / 2));
      gl.uniform2f(US.uShift, shift[0], shift[1]);
      gl.uniform3fv(US.uHorizon, FOG); gl.uniform3fv(US.uZenith, ZENITH); gl.uniform3fv(US.uSun, SUN); gl.uniform1f(US.uNight, night);
      gl.bindVertexArray(null);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
      gl.useProgram(waterProgram);
      gl.uniformMatrix4fv(UW.uViewProj, false, viewProj); gl.uniform1f(UW.uY, WATER_Y);
      gl.uniform3fv(UW.uCam, view.eye); gl.uniform3fv(UW.uSun, SUN);
      gl.uniform3fv(UW.uHorizon, FOG); gl.uniform3fv(UW.uZenith, ZENITH); gl.uniform1f(UW.uTime, clock); gl.uniform4fv(UW.uRipples, rippleData); gl.uniform1i(UW.uRippleCount, ripples.length); gl.uniform1f(UW.uNight, night);
      gl.uniform3fv(UW.uFog, FOG); gl.uniform1f(UW.uFogDensity, fogDensity); gl.uniform1f(UW.uFogFalloff, FOG_FALLOFF);
      gl.bindVertexArray(waterVao); gl.drawArrays(gl.TRIANGLES, 0, WATER_COUNT);
      gl.useProgram(boxProgram);
      gl.uniformMatrix4fv(U.uViewProj, false, viewProj);
      gl.uniformMatrix4fv(U.uLightViewProj, false, lightViewProj);
      bindTex(0, shadowTex); gl.uniform1i(U.uShadow, 0);
      gl.uniform3fv(U.uSun, SUN); gl.uniform3fv(U.uCam, view.eye); gl.uniform3fv(U.uFog, FOG);
      gl.uniform1f(U.uFogDensity, fogDensity); gl.uniform1f(U.uFogFalloff, FOG_FALLOFF); gl.uniform1f(U.uNight, night);
      gl.uniform1f(U.uLit, 1); gl.uniform1f(U.uOpaque, 1); gl.uniform1f(U.uEdge, 1);
      gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
      gl.bindVertexArray(city.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, city.count);
      gl.uniform1f(U.uLit, 0);
      gl.bindVertexArray(movers.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, movers.count);
      gl.uniform1f(U.uOpaque, 0); gl.uniform1f(U.uEdge, 0);
      gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE); gl.depthMask(false); // see-through things leave the sky mask alone
      gl.bindVertexArray(trails.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, trails.count);
      gl.disable(gl.BLEND); gl.depthMask(true); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);

      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, targets.msFb);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, targets.scene.fb);
      gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

      // 2. A soft copy for the depth of field, and the bright parts for the bloom (both off from quality 1).
      var isSoft = quality < 1;
      if (isSoft) {
        pass(copyProgram, targets.halfA, function () { bindTex(0, targets.scene.tex); gl.uniform1i(UC.uTex, 0); });
        pass(brightProgram, targets.quarterA, function () { bindTex(0, targets.halfA.tex); gl.uniform1i(UB.uTex, 0); gl.uniform1f(UB.uThreshold, 0.97); });
        blur(blurProgram, targets.halfA, targets.halfB, 1, 1.5);
        blur(blurProgram, targets.quarterA, targets.quarterB, 2, 1.6);
      }

      // The sun on screen: where it is, and how much it's in view (fading out as it leaves the frame).
      var sunAt = projectW(viewProj, [view.eye[0] + SUN[0] * 4000, view.eye[1] + SUN[1] * 4000, view.eye[2] + SUN[2] * 4000]);
      var sunUv = [sunAt[0] * 0.5 + 0.5, sunAt[1] * 0.5 + 0.5], outside = Math.max(Math.abs(sunUv[0] - 0.5), Math.abs(sunUv[1] - 0.5)) - 0.5;
      // The god rays and the glint go at quality 2.
      var sunIn = quality < 2 ? (sunAt[2] > 0 ? 1 - smooth(0, 0.3, outside) : 0) * (1 - 0.8 * night) : 0;
      if (sunIn > 0) pass(seenProgram, targets.seen, function () {
        bindTex(0, targets.scene.tex); gl.uniform1i(USN.uTex, 0); gl.uniform2f(USN.uSunUv, sunUv[0], sunUv[1]); gl.uniform2f(USN.uAspect, Math.min(1, aspect), Math.min(1, 1 / aspect));
      });
      if (sunIn > 0) pass(raysProgram, targets.rays, function () {
        bindTex(0, targets.scene.tex); gl.uniform1i(UR.uTex, 0); gl.uniform2f(UR.uSunUv, sunUv[0], sunUv[1]); gl.uniform2f(UR.uAspect, Math.min(1, aspect), Math.min(1, 1 / aspect));
      });

      // 3. The final picture, focused where the camera looks.
      var focus = project(viewProj, view.target);
      pass(compositeProgram, null, function () {
        bindTex(0, targets.scene.tex); gl.uniform1i(UX.uScene, 0);
        // Without the soft copy, the sharp picture stands in for it (so nothing blurs), and no bloom is added.
        bindTex(1, isSoft ? targets.halfA.tex : targets.scene.tex); gl.uniform1i(UX.uSoft, 1);
        bindTex(2, targets.quarterA.tex); gl.uniform1i(UX.uBloom, 2);
        gl.uniform1f(UX.uFocusY, focus[1] * 0.5 + 0.5);
        gl.uniform1f(UX.uSharpen, sharpen);
        gl.uniform1f(UX.uBloomStrength, isSoft ? 0.16 + 0.14 * night : 0);
        gl.uniform2f(UX.uAspect, Math.min(1, aspect), Math.min(1, 1 / aspect));
        bindTex(3, targets.rays.tex); gl.uniform1i(UX.uRays, 3); gl.uniform2f(UX.uSunUv, sunUv[0], sunUv[1]); gl.uniform1f(UX.uSunIn, sunIn);
        bindTex(4, targets.seen.tex); gl.uniform1i(UX.uSeen, 4);
      });

      // It shows once it runs smoothly: its first frames compile shaders and fill caches, and would stutter. Then it fades in from the sky.
      if (!isShown) { warmFrameCount++; if ((warmFrameCount >= 12 && raw < 0.034) || warmFrameCount >= 120) { isShown = true; shownAt = now; canvas.classList.add("on"); } }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  function start() { try { run(); } catch (error) { giveUp(); } }
  // At once, not after the page's load (the bot check's frame alone can hold that back a second): once the page has painted its
  // placeholder, so building the city never delays the pane.
  requestAnimationFrame(function () { setTimeout(start, 0); });
})();
`);

/**
 * The pane's steps happen in place, so the city never starts over: a form sent or a link followed inside a pane on the city (and back
 * and forward between them) fetches the next page and swaps its pane's content into this one, with its title, address and scripts.
 * Only the content of .pane-in changes; the city, the header and the pane's glass stay. Anything that isn't a step of signing in
 * (home, a game, the account page, a provider's sign-in) loads as a page does, and so does anything the fetch can't reach.
 * Scripts call window.zaismaPaneGo(href) where they would set location.href, so a step they take stays in place too.
 * The scripts that came with the new content run again; the city's own (and this one) never do.
 */
export const CITY_PANE_SCRIPT: PageScript = pageScript("city-pane", `(function () {
  var pane = document.querySelector("[data-city-pane]");
  if (!pane || !window.fetch || !window.DOMParser || !window.AbortController || !window.URLSearchParams) return;
  // The steps of signing in, a pane on the city each: Sign in and Make an account and every step after them, and You're in.
  var STEPS = /^\\/(signin|join)(\\/|$)|^\\/account\\/kept$/, AWAY = /^\\/signin\\/with\\//, OWN_SCRIPTS = /\\/js\\/city(-pane)?\\./;
  var waiting = null, shownPath = location.pathname + location.search;
  function isStep(url) { return url.origin === location.origin && STEPS.test(url.pathname) && !AWAY.test(url.pathname); }
  // Sign in and Make an account swap between themselves (ENTRY_SWITCH_SCRIPT) while the pane holds both.
  function isSwitchOwn(url) { return /^\\/(signin|join)$/.test(url.pathname) && Boolean(pane.querySelector("[data-entry-view]")); }

  function go(url, request, history, fallback) {
    if (waiting) waiting.abort();
    var controller = (waiting = new AbortController());
    fetch(url, Object.assign({ credentials: "same-origin", signal: controller.signal }, request))
      .then(function (response) {
        return response.text().then(function (text) {
          if (waiting !== controller) return;
          waiting = null;
          var page = (response.headers.get("content-type") || "").indexOf("text/html") === 0 ? new DOMParser().parseFromString(text, "text/html") : null;
          var next = page && page.querySelector("[data-city-pane] .pane-in");
          if (!next) return away(response, text, request.method);
          // A form answered in place (a problem to fix, or the next step of the same address) keeps the address it was sent from.
          swap(page, next, response.url, request.method === "POST" && !response.redirected ? "none" : history);
        });
      })
      .catch(function (error) { if (waiting === controller) waiting = null; if (!error || error.name !== "AbortError") fallback(); });
  }
  // Not a step: a page reached by a redirect, or by a link, opens as a page; one a form's send answered with directly takes this one's place.
  function away(response, text, method) {
    if (response.redirected || method === "GET") { location.assign(response.url); return; }
    document.open(); document.write(text); document.close();
  }
  function swap(page, next, url, history) {
    var holder = pane.querySelector(".pane-in"), glass = pane.querySelector(".glass-pane"), label = page.querySelector("[data-city-pane] .glass-pane");
    var scripts = Array.prototype.filter.call(page.querySelectorAll(".city-page script[src]"), function (script) { return !OWN_SCRIPTS.test(script.getAttribute("src")); });
    scripts.forEach(function (script) { script.remove(); });
    if (label && glass) glass.setAttribute("aria-label", label.getAttribute("aria-label") || "");
    holder.replaceChildren.apply(holder, Array.prototype.slice.call(next.childNodes));
    holder.scrollTop = 0;
    document.title = page.title;
    var path = new URL(url).pathname + new URL(url).search;
    if (history === "push" && path !== shownPath) window.history.pushState({ cityPane: true }, "", url);
    else if (history === "push") window.history.replaceState({ cityPane: true }, "", url);
    shownPath = location.pathname + location.search;
    runAll(scripts.map(function (script) { return script.getAttribute("src"); }));
    // Where the step begins: its first field with a problem, or its heading, read out as a new page's would be.
    var problem = holder.querySelector('[aria-invalid="true"]'), heading = holder.querySelector("h1, h2");
    if (problem) problem.focus({ preventScroll: true });
    else if (heading) { heading.setAttribute("tabindex", "-1"); heading.focus({ preventScroll: true }); }
    // On a phone the page scrolls: a step that starts above the screen comes back into view, under the header.
    var top = pane.getBoundingClientRect().top, header = document.querySelector("header.top"), clear = header ? header.getBoundingClientRect().bottom + 12 : 12;
    if (top < clear) window.scrollBy({ top: top - clear, behavior: "smooth" });
  }
  // In order, one after another, as they would on a page.
  function runAll(sources) {
    if (!sources.length) return;
    var script = document.createElement("script");
    script.src = sources[0];
    script.onload = script.onerror = function () { script.remove(); runAll(sources.slice(1)); };
    document.body.appendChild(script);
  }

  window.zaismaPaneGo = function (href) {
    var url = new URL(href, location.href);
    if (!isStep(url)) { location.assign(url.href); return; }
    go(url.href, { method: "GET" }, "push", function () { location.assign(url.href); });
  };
  document.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest("a[href]");
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!pane.contains(link) || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
    var url = new URL(link.href);
    if (!isStep(url) || (url.hash && url.pathname === location.pathname && url.search === location.search)) return;
    event.preventDefault();
    go(url.href, { method: "GET" }, "push", function () { location.assign(url.href); });
  });
  // After every other submit listener (the bot check holds a form until it's answered, a field may stop one).
  window.addEventListener("submit", function (event) {
    var form = event.target, submitter = event.submitter;
    if (event.defaultPrevented || !pane.contains(form)) return;
    var url = new URL((submitter && submitter.getAttribute("formaction")) || form.action, location.href);
    var method = ((submitter && submitter.getAttribute("formmethod")) || form.method || "get").toUpperCase();
    if (!isStep(url) || (form.target && form.target !== "_self")) return;
    var data = new FormData(form);
    if (submitter && submitter.name && !data.has(submitter.name)) data.append(submitter.name, submitter.value);
    var fields = new URLSearchParams();
    data.forEach(function (value, name) { if (typeof value === "string") fields.append(name, value); });
    event.preventDefault();
    var send = function () { HTMLFormElement.prototype.submit.call(form); };
    if (method === "GET") { url.search = fields.toString(); go(url.href, { method: "GET" }, "push", send); }
    else go(url.href, { method: "POST", body: fields, headers: { "content-type": "application/x-www-form-urlencoded" } }, "push", send);
  });
  window.addEventListener("popstate", function () {
    var url = new URL(location.href), path = url.pathname + url.search;
    if (path === shownPath) return;
    if (isSwitchOwn(url)) { shownPath = path; return; }
    if (!isStep(url)) { location.reload(); return; }
    go(url.href, { method: "GET" }, "none", function () { location.reload(); });
  });
})();
`);

const CITY_STYLES = `
/* The city's stage: under everything on the page, filling the window. It shows the city at once, as a placeholder: its first frame,
   tiny and blurred, in the page itself so it needs no download. Nothing half-made shows over it: the live city comes in once it runs
   smoothly, sharpening out of the placeholder from that same first frame (a focus pull: it fades in as it settles from a touch larger),
   then the camera sets off. Where it can't run (reduced motion, no WebGL, a device that can't keep up) the full still takes the
   placeholder's place instead, once it has wholly loaded, and its blur clears. The still is loaded only then. */
/* Its height is the largest the window gets (lvh), not the visible one: a phone's address bar showing or hiding crops the stage's bottom
   instead of resizing it, so the city never scales with the bar. */
.city-stage { position: fixed; inset: 0 0 auto 0; height: 100vh; height: 100lvh; z-index: -1; overflow: hidden; background: linear-gradient(180deg, #2E78DE 0%, #6FA6EC 45%, #A6CBF4 100%); }
.city-stage.is-framed { position: absolute; inset: 0; height: auto; z-index: 0; }
.city-stage .city { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
/* The placeholder and the still: the live city's first frame, at the screen's height and centred, moved as the camera's picture is
   (CITY_SCRIPT sets --still-x and --still-y; until then, half the pane's width to the left). Its box reaches past the screen, so moving
   it leaves no edge. */
.city-stage .city-still { position: absolute; inset: -50%; display: block; background: var(--still-tiny) center / auto 50% no-repeat;
  transform: translate(var(--still-x, calc(min(440px, 100vw - 2 * var(--pad-inner-pane)) / -2)), var(--still-y, 0px));
  filter: blur(18px) saturate(1.1); transition: filter 0.9s ease; }
.city-stage .city-still.is-day { --still-tiny: url(data:image/webp;base64,UklGRhoBAABXRUJQVlA4IA4BAADwBwCdASpIABwAPrVOn0snJCKisBZoAOAWiWQAnTmN175sfiOO6aSA49N8S7tEwnNRBnH3uayYzHgEh78vfLz7kMBomq1YV8AA/tMDxfpJhn+a3HQXlB9YpiUQaGwZNdX6SW9k4Ld0jmhMFDLRrLAibnisyiB+2r8djigCsyr/MD+WFq5ju6pA9SL374CHdFGxA+W7bnJfxHrfOQ2ax8d1Byfi/wolz+fdtSbzeQKDtaer6RcnaEAtRnDbYjpcUS+cwSmru0ypFSFMQnhNiEJMsyZ2Mqc4GYy55ic40KrT7fks0najlcCECg8rGRJ19kQqBwQyZLNtv3L/qPi1xCIET5dDpTx3yycJwOPQ0AA=); --still-full: url(/sign-in/city-day.webp); }
.city-stage .city-still.is-night { --still-tiny: url(data:image/webp;base64,UklGRpoAAABXRUJQVlA4II4AAACQBgCdASpIABwAPqVCnkmmJCMhNnbdUMAUiWcA0bwZwHio1w1SP5jrVuFisu1eXXMBPBp2PobndLw0XfyAAP71YFzvnwrphWIz6VyaMsdkNl7tj1QIeBISMUWGK15Ll/lipZ36RiTW7DbAcbDZtb+Y/e+FiQa0qrIUvD2bmh0B5qsVxT+UhV2Uw9WrQcAA); --still-full: url(/sign-in/city-night.webp); }
@media (max-width: 760px) {
  .city-stage .city-still { transform: translate(var(--still-x, 0px), var(--still-y, -18vh)); }
  .city-stage .city-still.is-day { --still-tiny: url(data:image/webp;base64,UklGRtQAAABXRUJQVlA4IMgAAACQBwCdASokACQAPrVMm0qnJCIhrjgMyOAWiWIAuzQAhx/yZ5aEbn/wDW/DkLNzcXlBy0uNKnZ2sgcejPdgYqj+xKFIGwAA/osHqD3Mp/anU8Yx/9CpUyty792u7qt0g78wd5Z+o9hlwwOzyMdCICDD1BJnLqbTNt242W5Z4Q+ul5Jc0KvU7J5+WqgVwgC3ZREbJ+xjZmeI4Wlpka7O09TB8tNvP3LIrTeINltCKw/LT1R2WlWL9TT/2tIB0jwZvLfAGVIyE8AAAA==); --still-full: url(/sign-in/city-day-phone.webp); }
  .city-stage .city-still.is-night { --still-tiny: url(data:image/webp;base64,UklGRn4AAABXRUJQVlA4IHIAAABwBQCdASokACQAPrVSokynJKMiKrVZWOAWiWcAzcAjp7YWpt/jON8xi4L2T6DuXHg5oU0AAP71kNmW+4FX2EXbiySQuDZV82Ta/XPnibU0yShSDm6e/BAPSxEcGwlB/10iiIzIPwk2QtLnr/Od8T9mAAA=); --still-full: url(/sign-in/city-night-phone.webp); }
}
.city-stage.is-still .city-still { background-image: var(--still-full); filter: none; }
.city-stage .city { opacity: 0; transform: scale(1.035); transition: opacity 1.1s ease, transform 1.6s cubic-bezier(.2,.8,.2,1); touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
.city-stage .city.on { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce) { .city-stage .city-still, .city-stage .city { transition: none; } }
/* Day for light, night for dark: only the one showing is ever loaded. */
.city-stage .city-still.is-night { display: none; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme-choice="light"]) .city-stage { background: linear-gradient(180deg, #050812 0%, #0B1226 55%, #142040 100%); }
  :root:not([data-theme-choice="light"]) .city-stage .city-still.is-day { display: none; }
  :root:not([data-theme-choice="light"]) .city-stage .city-still.is-night { display: block; }
}
[data-theme-choice="dark"] .city-stage { background: linear-gradient(180deg, #050812 0%, #0B1226 55%, #142040 100%); }
[data-theme-choice="dark"] .city-stage .city-still.is-day { display: none; }
[data-theme-choice="dark"] .city-stage .city-still.is-night { display: block; }
[data-theme-choice="light"] .city-stage { background: linear-gradient(180deg, #2E78DE 0%, #6FA6EC 45%, #A6CBF4 100%); }
[data-theme-choice="light"] .city-stage .city-still.is-day { display: block; }
[data-theme-choice="light"] .city-stage .city-still.is-night { display: none; }

/* A pane on the city: glass in front, never resting in the scene. On a wide screen it stands on the right under the header, its edge in line
   with the header's, down to the same inset from the bottom; on a phone it's full width at the bottom, starting low (CITY_SCRIPT places it) and scrolling up with the page. */
.city-page { min-height: 100vh; }
/* The city is there to play with: a press anywhere but on the pane, the header or the rail goes through the page (and the body it
   lies behind) to it. */
body:has(> .city-page), .city-page { pointer-events: none; }
.city-page > *, .city-stage { pointer-events: auto; }
/* The pane places itself under the header, so the page keeps no room for it. */
body:has(> .city-page) { padding-top: 0; }
html:has(.city-page) { height: 100%; }
.city-page .city-pane { position: fixed; z-index: 1; top: calc(var(--pad-pane) + 68px + var(--pad-inner-pane)); bottom: var(--pad-pane); right: max(var(--pad-pane), calc((100% - 1240px) / 2)); width: min(440px, calc(100% - 2 * var(--pad-pane))); display: flex; }
.city-page .city-pane > .glass-pane { flex: 1; min-height: 0; }
/* The other ways in: stacked, cut only at the stack's ends. */
.city-pane .ways { display: grid; gap: var(--gap-control-stack); }
/* Or, between the ways in: a word on a hairline. */
.city-pane .or { display: flex; align-items: center; gap: var(--gap-words-words); font: var(--type-facts); color: var(--muted); }
.city-pane .or::before, .city-pane .or::after { content: ""; flex: 1; height: 1px; background: var(--line); }
.city-pane .note { font: var(--type-note); color: var(--muted); }
/* How do you play?: the pane's heading is the question, so the choices' own legend is for screen readers only. */
.city-pane .is-play-step .choices > legend { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
/* Its cards sit two to a row where the pane has room: an odd one out on the last row is centred under the two above it, one column wide. */
.city-pane .is-play-step .choice-cards { container-type: inline-size; }
@container (min-width: 368px) {
  .city-pane .is-play-step .choice-card:last-child:nth-child(odd) { grid-column: 1 / -1; justify-self: center; width: calc(50% - var(--gap-control-stack) / 2); }
}
@media (max-width: 760px) {
  html:has(.city-page) { height: auto; }
  .city-page { display: flow-root; min-height: 0; padding-bottom: calc(var(--pad-inner-pane) + env(safe-area-inset-bottom)); }
  .city-page .city-pane { position: relative; top: auto; bottom: auto; right: auto; width: auto; margin: 60vh var(--pad-inner-pane) 0; }
  .city-page .city-pane > .glass-pane > .pane-in { overflow: visible; }
  /* The page's rail runs down the gutter beside the pane. */
  .city-page .rail[data-rail="page"] { right: 1px; }
}
/* The gallery's example: the stage in its own box, with a pane on its right. */
.city-frame { position: relative; width: 100%; height: 420px; overflow: hidden; display: flex; justify-content: flex-end; padding: var(--pad-inner-pane); }
.city-frame > .glass-pane { position: relative; z-index: 1; }
`;

component({
  name: "City",
  slug: "city",
  group: "foundations",
  summary: "Zaisma's own live 3D scene, where signing in and making an account happen: one city in an endless sea on a slow cinematic loop, its orange shapes and sea there to tap. Under reduced motion, without WebGL or on a device that can't keep it smooth, a still of the same city stands in, with everything in place.",
  styles: CITY_STYLES,
  render: cityStage,
  examples: [
    {
      label: "A pane on the city",
      isWide: true,
      markup: html`<div class="city-frame">${cityStage({ isFramed: true })}${glassPane({ paneSize: "small", label: "Sign in", body: html`<h2>Welcome back</h2>${runButton("Sign in", { type: "button", isFullWidth: true })}` })}</div>`,
    },
  ],
});

