import { html, type Raw } from "../markup.ts";
import { pageScript, type PageScript } from "../page-scripts.ts";
import { component } from "./component.ts";
import { glassPane } from "./foundations.ts";
import { runButton } from "./actions.ts";
import { rail } from "./navigation.ts";
import { stack } from "./layout.ts";
import { cutPolygon } from "./tokens.ts";

/*
 * The city: Zaisma's own live 3D scene, from the sign-in draft. One city on land in an endless sea, seen on one slow cinematic loop,
 * with orange shapes (players and games) moving through it that break apart when tapped enough, and a sea that sends a ring of light
 * along its grid where it's tapped. Signing in and making an account sit on it (docs/DECISIONS.md, "Signing in happens in the city, on every device"),
 * and the developer front door can reuse it: nothing here is the sign-in's.
 *
 * cityStage() is the city's sky, a still of the same city (a tiny blurred placeholder until the full one is needed) and the canvas.
 * CITY_SCRIPT draws the city into the canvas as soon as the page has painted, hidden while its first frames compile and settle, then
 * sharpens it in out of the placeholder, so nothing half-made or stuttering ever shows. The canvas never
 * starts under reduced motion or without WebGL 2, and stops on a device that can't keep it smooth even at its lowest step: the still
 * stands in then, loaded only then and faded in once it has wholly loaded.
 *
 * The stills are renders of the city itself (brand/sign-in/, served at /sign-in/): its first live frame, the camera at
 * [620, 140, 250] looking at [0, 100, 0] with the city's seed 7274, unshifted, at midday for light and at night for dark. Wide ones
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

export interface CityPaneOptions {
  /** The header over the city (Header, on sign-in: the logo alone). */
  header: Raw;
  /** What the pane is, for a screen reader: the step's title. */
  label: string;
  body: Raw;
  /** What goes after the pane on the page, like its scripts. */
  after?: Raw;
}

/**
 * The page over the city's stage (cityStage goes in the page's stage): the header, the one pane in front of the city, placed as the city
 * places it (on the right under the header on a wide screen, low and full width on a phone), and the page's rail.
 */
export function cityPane(options: CityPaneOptions): Raw {
  return html`<div class="city-page">${options.header}<div class="city-pane" data-city-pane>${glassPane({ paneWidth: "full", label: options.label, body: options.body })}</div>${rail("page")}
${options.after ?? ""}</div>`;
}

/*
 * The city script. From the draft's "Small seeded random" to its end, unchanged in look. What's new:
 * - It finds its canvas and the pane over it on the page, and works in the canvas's own box (the gallery frames it).
 * - Quality tiers (TIERS): a wide screen starts at 1.5 pixels per CSS pixel and at most about 3.2 million pixels, sharpened lightly
 *   where that's fewer than the screen has; a phone (a coarse pointer, or narrower than 760px) at its screen's own pixels up to 2 per
 *   CSS pixel and 1.4 million, then the wide screen's tiers down to 1. Below them, 30 frames a second, then 2x anti-aliasing, then no
 *   bloom or depth of field and half the flyers. It settles on a tier while it's
 *   hidden, steps down when it can't keep pace and back up when it can. Slow even at the lowest, the still comes back and it stops.
 * - A tropical haze over everything, thick at the sea and thinning with height, warm toward the sun by day and dark blue at night.
 * - It starts once the page has painted, so the still and the pane never wait for it, and it's built in small steps between frames
 *   while the driver compiles its programs in the background, so nothing holds the page up.
 * - Out of sight for a while (scrolled away, or the page hidden for a minute), it gives its drawing context back and leaves a snapshot
 *   of its moment; a context the browser takes shows the still at once, never a blank canvas. Either way it's made again in sight and
 *   carries on from the same moment. Three taken within a minute leave the still for good.
 * - Taps work by touch as clicks do: a touch that didn't move is a tap; a drag scrolls the page.
 * - Night follows the theme the page shows where the canvas is (its color-scheme).
 *
 * It's in four parts, in this order:
 * - The page: the pane's place, the camera's shift into the part of the screen the pane leaves clear, and the still, none of which
 *   needs WebGL.
 * - The world: the city and everything moving in it, worked out on the CPU from the city's seed. It's built once and outlives the
 *   drawing context, so a context that's lost and made again draws the same city at the same moment.
 * - The drawing: programs, buffers, textures and targets, made from the world and dropped with their context.
 * - The run: one frame callback that does what the city's phase says (data-city-phase on the canvas): waiting, building, warming
 *   (hidden while its programs and pipelines get ready), shown; released (its context given back while out of sight) or lost (taken
 *   by the browser), both made again once it's in sight; frozen (failed once shown) or still.
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
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !window.WebGL2RenderingContext) { showStill(); return; }
  /* For tools only (scripts/city.mjs), set before the page loads: startSec starts the camera at that moment of its loop and isHeld holds
     it there, and the Relay's firing where the page opens on it, for screenshots; beamSec pins the firing at that second of it instead
     (a negative one: at rest); isStill renders a still (brand/sign-in/): unshifted, at the canvas's full size, the phone's view with
     isPhoneView. The city answers report() there, for the tool to print. */
  var tool = window.zaismaCityTool || {};
  // The phone layout's city: fewer flyers, a smaller shadow map and a wider view (the still for phones is rendered the same way).
  var small = tool.isStill ? Boolean(tool.isPhoneView) : isNarrow();
  var coarse = window.matchMedia("(pointer: coarse)").matches;
  // The size of the city's box, in CSS pixels, and where it is on the screen.
  function box() { return canvas.getBoundingClientRect(); }
  // Night when the page shows dark where the canvas is.
  function isNight() { return /dark/.test(getComputedStyle(canvas).colorScheme || ""); }
  // It starts where the still is framed, so the live city takes over from it with nothing moving.
  // The framing is measured once and then held: page scroll, the browser's bars and resizes never move the camera's picture. It's
  // taken again once the city is built, before anything of it shows, in case the pane moved while the page's fonts came in.
  var shiftHeld = shiftFor();
  if (tool.isStill) shiftHeld = [0, 0];
  function shiftTarget() { return shiftHeld; }
  var shift = [shiftHeld[0], shiftHeld[1]];
  function holdFraming() { shiftHeld = tool.isStill ? [0, 0] : shiftFor(); shift[0] = shiftHeld[0]; shift[1] = shiftHeld[1]; measureClear(); }
  // The part of the canvas the pane and the header leave clear, in shares of its box (for when the Relay fires), held with the framing.
  var clearShare = { left: 0.04, right: 0.96, top: 0, bottom: 1 };
  function measureClear() {
    var b = canvas.getBoundingClientRect();
    if (!b.width || !b.height || tool.isStill) return;
    clearShare.top = header ? Math.max(0, (header.getBoundingClientRect().bottom - b.top) / b.height) : 0;
    var r = pane && !isFramed ? pane.getBoundingClientRect() : null, isPaneSeen = Boolean(r && r.width);
    clearShare.right = isPaneSeen && !isNarrow() ? (r.left - b.left) / b.width - 0.04 : 0.96;
    clearShare.bottom = isPaneSeen && isNarrow() ? Math.min(1, (r.top - b.top) / b.height) : 1;
  }

  /* The world: the city and everything moving in it, on the CPU. */
  // Small seeded random, so the city is the same city on every visit.
  var seed = 7274;
  function rand() { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(a, b, x) { var t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

  // Matrices, column-major. What a frame works out goes into arrays made once (the ...Into functions), so a frame leaves nothing to collect.
  function perspectiveInto(out, fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2);
    out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0; out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = (far + near) / (near - far); out[11] = -1; out[12] = 0; out[13] = 0; out[14] = 2 * far * near / (near - far); out[15] = 0;
    return out;
  }
  function ortho(l, r, b, t, n, f) {
    return [2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1];
  }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function subInto(out, a, b) { out[0] = a[0] - b[0]; out[1] = a[1] - b[1]; out[2] = a[2] - b[2]; return out; }
  function crossInto(out, a, b) { var x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0]; out[0] = x; out[1] = y; out[2] = z; return out; }
  function normInto(out, a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; out[0] = a[0] / l; out[1] = a[1] / l; out[2] = a[2] / l; return out; }
  function lookAt(eye, target, up) {
    var z = norm(sub(eye, target)), x = norm(cross(up, z)), yv = cross(z, x);
    return [x[0], yv[0], z[0], 0, x[1], yv[1], z[1], 0, x[2], yv[2], z[2], 0, -dot(x, eye), -dot(yv, eye), -dot(z, eye), 1];
  }
  var UP = [0, 1, 0], lookZ = [0, 0, 0], lookX = [0, 0, 0], lookY = [0, 0, 0];
  function lookAtInto(out, eye, target) {
    var z = normInto(lookZ, subInto(lookZ, eye, target)), x = normInto(lookX, crossInto(lookX, UP, z)), yv = crossInto(lookY, z, x);
    out[0] = x[0]; out[1] = yv[0]; out[2] = z[0]; out[3] = 0; out[4] = x[1]; out[5] = yv[1]; out[6] = z[1]; out[7] = 0;
    out[8] = x[2]; out[9] = yv[2]; out[10] = z[2]; out[11] = 0; out[12] = -dot(x, eye); out[13] = -dot(yv, eye); out[14] = -dot(z, eye); out[15] = 1;
    return out;
  }
  function mul(a, b) { return mulInto(new Array(16), a, b); }
  function mulInto(out, a, b) {
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      var s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; out[c * 4 + r] = s;
    }
    return out;
  }
  // A point on the screen, in its -1 to 1 square, and how far ahead of the eye it is (w).
  function projectInto(out, m, p) {
    var x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], yv = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    out[0] = x / w; out[1] = yv / w; out[2] = w;
    return out;
  }

  // A unit box: x and z from -0.5 to 0.5, y from 0 to 1, so a box stands on its offset.
  // Its bottom face comes last, so the city's rows, never seen from below, draw only the first 30 corners (BOX_TOP_COUNT).
  var faces = [
    [[1, 0, 0], [[.5, 0, -.5], [.5, 1, -.5], [.5, 1, .5], [.5, 0, .5]]],
    [[-1, 0, 0], [[-.5, 0, .5], [-.5, 1, .5], [-.5, 1, -.5], [-.5, 0, -.5]]],
    [[0, 1, 0], [[-.5, 1, -.5], [-.5, 1, .5], [.5, 1, .5], [.5, 1, -.5]]],
    [[0, 0, 1], [[.5, 0, .5], [.5, 1, .5], [-.5, 1, .5], [-.5, 0, .5]]],
    [[0, 0, -1], [[-.5, 0, -.5], [-.5, 1, -.5], [.5, 1, -.5], [.5, 0, -.5]]],
    [[0, -1, 0], [[-.5, 0, .5], [-.5, 0, -.5], [.5, 0, -.5], [.5, 0, .5]]]
  ];
  var BOX_COUNT = 36, BOX_TOP_COUNT = 30;
  var cube = [];
  faces.forEach(function (f) {
    var n = f[0], q = f[1];
    [0, 1, 2, 0, 2, 3].forEach(function (i) { cube.push(q[i][0], q[i][1], q[i][2], n[0], n[1], n[2]); });
  });
  cube = new Float32Array(cube);

  // The Relay's heights, read by the shaders below as well as by its build: its feet, its tips, its floating capstone and the core.
  var CORE_Y = 12, RELAY_FOOT_Y = 9.25, RELAY_TIP_Y = 168, CAPSTONE_BOTTOM_Y = 180, CAPSTONE_TOP_Y = 193, CAPSTONE_LIFT_UNITS = 8;
  // The air: a pale haze, thick over the sea and thinning with height, so distance reads at a glance. How much of it lies between
  // the eye and a point is the integral of a density falling off with height (exact for an exponential), and toward the sun it's a
  // little brighter. Thinner and dark blue at night.
  var FOG_GLSL = "uniform vec3 uFog; uniform float uFogDensity; uniform float uFogFalloff;\n" +
    "float hazeAt(vec3 cam, vec3 at){ vec3 ray = at - cam; float d = length(ray); float dy = ray.y / max(d, 1e-3) * uFogFalloff * d;\n" +
    " float along = abs(dy) < 1e-4 ? d : d * (1.0 - exp(-dy)) / dy;\n" +
    " return 1.0 - exp(-uFogDensity * exp(-max(cam.y, 0.0) * uFogFalloff) * along); }\n" +
    "vec3 hazeColor(vec3 cam, vec3 at, vec3 sun, float night){ vec3 dir = normalize(at - cam); float toward = pow(max(dot(dir, sun), 0.0), 6.0);\n" +
    " return mix(uFog, mix(vec3(0.97, 0.99, 1.0), vec3(0.2, 0.26, 0.45), night), toward * mix(0.35, 0.3, night)); }\n";
  // Where a row's corner goes: its top narrowed by the row's taper (across and deep, 0 for none, 1 to an edge), which slants the faces
  // and their normals, then climbed and turned. A positive taper narrows from both sides (a needle, a craft's nose); a negative one
  // from one side only, so one face leans in and the top is a single slanted cut. The same for the picture and the shadow map.
  // How far the Relay's wave has to run to reach a point: square in the city, so it runs the street grid as a square front, and round at sea.
  var WAVE_GLSL = "float waveDistance(vec2 p){ float r = length(p); return mix(max(abs(p.x), abs(p.y)), r, smoothstep(280.0, 650.0, r)); }\n";
  // A line of half-width hw at e from its middle, where a pixel is px: never drawn thinner than most of a pixel (it fades instead of
  // thinning), so a fine seam or grid line never shimmers.
  var LINE_GLSL = "float lineAt(float e, float hw, float px){ float w = max(hw, 0.7 * px); return (1.0 - smoothstep(w - 0.5 * px, w + 0.5 * px, abs(e))) * hw / w; }\n";
  var PLACE_GLSL = "vec3 placeCorner(vec3 corner, vec3 size, vec4 material, vec2 turn, inout vec3 normal){ vec3 a = corner; vec2 taper = material.zw;\n" +
    " if (taper.x != 0.0 || taper.y != 0.0) { vec2 t = abs(taper);\n" +
    "  if (taper.x >= 0.0) a.x *= 1.0 - t.x * a.y; else a.x += t.x * a.y * (0.5 - a.x);\n" +
    "  if (taper.y >= 0.0) a.z *= 1.0 - t.y * a.y; else a.z += t.y * a.y * (0.5 - a.z);\n" +
    "  if (abs(normal.x) > 0.5) normal = normalize(vec3(normal.x * size.y, (taper.x >= 0.0 ? 0.5 * t.x : (normal.x < 0.0 ? t.x : 0.0)) * size.x, 0.0));\n" +
    "  else if (abs(normal.z) > 0.5) normal = normalize(vec3(0.0, (taper.y >= 0.0 ? 0.5 * t.y : (normal.z < 0.0 ? t.y : 0.0)) * size.z, normal.z * size.y)); }\n" +
    " vec3 c = vec3(0.0, size.y * 0.5, 0.0); vec3 q = a * size - c;\n" +
    " float cp = cos(turn.y), sp = sin(turn.y), cy = cos(turn.x), sy = sin(turn.x);\n" +
    " q = vec3(q.x * cp - q.y * sp, q.x * sp + q.y * cp, q.z); normal = vec3(normal.x * cp - normal.y * sp, normal.x * sp + normal.y * cp, normal.z);\n" +
    " q = vec3(q.x * cy - q.z * sy, q.y, q.x * sy + q.z * cy); normal = vec3(normal.x * cy - normal.z * sy, normal.y, normal.x * sy + normal.z * cy);\n" +
    " return q + c; }\n";
  var BOX_VS = "#version 300 es\n" +
    "layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor;\n" +
    "layout(location=2) in vec3 iOff; layout(location=3) in vec3 iScale; layout(location=4) in vec4 iCol; layout(location=5) in vec4 iMaterial; layout(location=6) in vec2 iRot;\n" +
    "uniform mat4 uViewProj; uniform mat4 uLightViewProj;\n" +
    "out vec3 vNor; out vec4 vCol; out vec3 vWorld; out vec4 vLight; flat out vec4 vMaterial; out vec3 vLocal; flat out vec3 vSize; flat out vec3 vFace; flat out vec2 vOrigin;\n" + PLACE_GLSL +
    "void main(){ vec3 nn = aNor; vec3 w = iOff + placeCorner(aPos, iScale, iMaterial, iRot, nn);\n" +
    " vWorld = w; vNor = nn; vCol = iCol; vLocal = aPos; vSize = iScale; vFace = aNor; vMaterial = iMaterial; vOrigin = iOff.xz;\n" +
    " vLight = uLightViewProj * vec4(w + nn * 0.12, 1.0);\n" +
    " gl_Position = uViewProj * vec4(w, 1.0); }";
  // What each row is made of (its material's kind, in the row's material slot), so one program draws the whole city.
  // What each row is (the kind in its material slot): plain, carved with glowing grooves and a band at its top, a band only, or a beacon at
  // its tip; the Relay's graphite (seams up its slit, rungs, a spine and a burning foot), a light (glowing on every face; seed 0 the
  // Relay's own, seed 1 the pylons'), and a pylon's shaft (the Relay's seam, and a band under its top). Below 8 a row is built.
  var KIND_PLAIN = 0, KIND_CARVED = 1, KIND_BANDED = 2, KIND_BEACON = 3, KIND_PAVEMENT = 4, KIND_RELAY = 5, KIND_LIGHT = 6, KIND_PYLON = 7, KIND_STREET = 8, KIND_SHORE = 9;
  // The city's light on its pale boxes: a warm afternoon sun with crisp shadows, sky light from above and bounce from below, streets
  // darker at the bottom of their canyons, a weak fill from the side away from the sun so a building's two shaded sides never match, and walls a little lighter toward the top. At
  // night a cool moon lights the same shapes, softer.
  var BOX_FS = "#version 300 es\nprecision highp float; precision highp sampler2DShadow;\n" +
    "in vec3 vNor; in vec4 vCol; in vec3 vWorld; in vec4 vLight; flat in vec4 vMaterial; in vec3 vLocal; flat in vec3 vSize; flat in vec3 vFace; flat in vec2 vOrigin;\n" +
    "uniform sampler2DShadow uShadow; uniform vec3 uSun; uniform vec3 uCam; uniform float uLit; uniform float uOpaque; uniform float uEdge; uniform float uNight; uniform float uPulse;\n" +
    "uniform vec4 uRelay; uniform vec4 uRelayGlow; uniform vec4 uWave; uniform vec4 uBeamLight;\n" +
    "out vec4 outColor;\n" + FOG_GLSL + WAVE_GLSL +
    "float shadowAt(){ vec3 p = vLight.xyz / vLight.w * 0.5 + 0.5; if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return 1.0;\n" +
    " return texture(uShadow, vec3(p.xy, p.z - 0.0004)); }\n" +
    LINE_GLSL +
    "void main(){ vec3 n = normalize(vNor); vec3 base = vCol.rgb; int kind = int(vMaterial.x + 0.5);\n" +
    " vec3 toEye = uCam - vWorld; vec3 v = normalize(toEye); vec3 col; vec3 glow = vec3(0.0);\n" +
    " if (uLit > 0.5) {\n" +
    "  bool isWall = abs(vFace.y) < 0.5; bool isBuilt = kind < 8;\n" +
    // A tapered row's faces narrow toward its top: across x and deep in z, how wide it is at this height (vLocal is the corner before the taper).
    "  float widthX = vSize.x * (1.0 - abs(vMaterial.z) * vLocal.y), depthZ = vSize.z * (1.0 - abs(vMaterial.w) * vLocal.y);\n" +
    // A bevel along every upright edge and round the top of the walls: the face turns halfway to its neighbour within a third of a unit
    // of the edge, so edges catch the light (or fall into shade) the way a cut edge would, with no line drawn.
    "  if (isWall && isBuilt) { float across = abs(vFace.x) > 0.5 ? vLocal.z : vLocal.x, width = abs(vFace.x) > 0.5 ? depthZ : widthX;\n" +
    "   float toSide = (0.5 - abs(across)) * width, toTop = (1.0 - vLocal.y) * vSize.y, bevel = min(0.32, width * 0.06);\n" +
    "   vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), n)) * sign(across) * (abs(vFace.x) > 0.5 ? -vFace.x : vFace.z);\n" +
    "   float atSide = 1.0 - smoothstep(bevel - fwidth(toSide), bevel + fwidth(toSide), toSide), atTop = 1.0 - smoothstep(bevel - fwidth(toTop), bevel + fwidth(toTop), toTop);\n" +
    "   n = normalize(mix(n, normalize(n + side), atSide)); n = normalize(mix(n, normalize(n + vec3(0.0, 1.0, 0.0)), atTop)); }\n" +
    "  float sh = shadowAt(); float diff = max(dot(n, uSun), 0.0) * sh;\n" +
    "  vec3 sunLight = mix(vec3(1.0, 0.92, 0.8) * 1.12, vec3(0.6, 0.7, 1.0) * 0.36, uNight);\n" +
    "  vec3 skyLight = mix(vec3(0.4, 0.49, 0.68), vec3(0.2, 0.25, 0.42), uNight); vec3 bounce = mix(vec3(0.42, 0.4, 0.37), vec3(0.07, 0.08, 0.12), uNight);\n" +
    "  float canyon = isWall ? mix(0.45, 1.0, smoothstep(0.0, 22.0, vWorld.y)) : (kind == 4 || kind == 8 ? 0.8 : 1.0);\n" +
    "  vec3 ambient = mix(bounce, skyLight, n.y * 0.5 + 0.5) * canyon;\n" +
    "  float fill = max(dot(n, normalize(vec3(0.75, 0.25, -0.3))), 0.0) * mix(0.14, 0.08, uNight);\n" +
    "  col = base * (ambient + skyLight * fill + sunLight * diff);\n" +
    "  if (isWall && isBuilt) col *= mix(0.9, 1.06, vLocal.y);\n" +
    // By day the city melts into the pale void as it melts into the dark at night: its light and shade held to a soft hint round the
    // void's own tone (uFog), so only the orange carvings and the players draw it.
    "  col = mix(uFog, col, mix(0.26, 1.0, uNight));\n" +
    // The foundation's tiers: a thin line of cool light along the top edge of each, faint by day and glowing at night: the island's edge.
    "  if (isWall && kind == 9) { float fromTop = (1.0 - vLocal.y) * vSize.y, edgeLine = lineAt(fromTop, 0.12, max(fwidth(fromTop), 1e-4));\n" +
    "   vec3 edgeTone = mix(vec3(0.85, 0.97, 1.0), vec3(0.35, 0.7, 1.0), uNight); col = mix(col, edgeTone, edgeLine * 0.25 * (1.0 - uNight)); glow += edgeTone * edgeLine * 0.4 * uNight; }\n" +
    // When the Relay fires: how long ago its wave passed this row's origin (each point, on the ground's own mesh), so a row lights whole,
    // like a pixel: hit flashes and fades fast, hold lingers, pass is the moment it goes by.
    "  float since = -1.0, hit = 0.0, hold = 0.0, pass = 0.0, carvedMask = 0.0; vec3 carve = vec3(1.0, 0.5, 0.1);\n" +
    "  if (uWave.y > 0.0) { since = uWave.x - waveDistance(kind >= 8 ? vWorld.xz : vOrigin);\n" +
    "   if (since >= 0.0) { hit = exp(-since / 50.0) * uWave.y; hold = exp(-since / 600.0) * uWave.y; pass = exp(-since / 40.0) * uWave.y; } }\n" +
    // Before it fires, a front runs in along the arms to the dais (uWave.z, uWave.w): armPass is the moment it passes this row's origin.
    "  float armSince = max(abs(vOrigin.x), abs(vOrigin.y)) - uWave.z, armPass = uWave.w > 0.0 && armSince >= 0.0 ? exp(-armSince / 40.0) * uWave.w : 0.0;\n" +
    // The carvings: thin grooves up the middle of two opposite faces, and a band round the top, a faint warm line by day that glows at night.
    // Drawn with lineAt, so where they're thinner than a pixel they fade instead of blinking.
    "  if (isWall && kind >= 1 && kind <= 3) {\n" +
    "   float upUnits = vLocal.y * vSize.y, fromTop = vSize.y - upUnits, across = abs(abs(vFace.x) > 0.5 ? vLocal.z : vLocal.x) * (abs(vFace.x) > 0.5 ? vSize.z : vSize.x);\n" +
    "   float groove = kind == 1 && abs(vFace.x) > 0.5 ? lineAt(across, 0.16, max(fwidth(across), 1e-4)) : 0.0;\n" +
    "   float band = kind <= 2 && vMaterial.y < 0.5 ? lineAt(fromTop - 0.8, 0.2, max(fwidth(fromTop), 1e-4)) : 0.0;\n" +
    "   float tip = kind == 3 ? smoothstep(0.88, 0.94, vLocal.y) * (0.6 + 0.4 * uPulse) : 0.0;\n" +
    "   float carved = max(max(groove, band), tip); carvedMask = carved;\n" +
    "   col = mix(col, carve * mix(0.85, 0.3, uNight), carved * mix(0.75, 1.0, uNight)); glow += carve * carved * uNight * 1.5; }\n" +
    // The Relay and its circuit. By day a line is orange paint that glows a little; at night it glows. A light glows on every face. The
    // Relay's seams run up the slit's edges on its front and back, its rungs cross the slit faces every 12 units, a spine runs down each
    // outer face and its foot burns over the light it floats on; rungs and spines light up to the charge's height, and the slit faces
    // flood between uRelay.y and uRelay.z. A pylon has the same seam on its ends and a band under its top. At the release the Relay's own
    // lines go white-hot (uRelayGlow.x) and its slit faces take the flare; the circuit's lights and the pylons flare as the wave passes.
    "  if (kind >= 5 && kind <= 7) {\n" +
    "   float up = vLocal.y * vSize.y, upPx = fwidth(up), paint = 0.0, light = 0.0; bool isOwn = kind == 5 || (kind == 6 && vMaterial.y < 0.5);\n" +
    "   vec3 tone = isOwn ? mix(carve, vec3(1.0, 0.86, 0.56), uRelayGlow.x) : carve;\n" +
    "   if (kind == 6) { paint = 0.7; light = (isOwn ? 0.5 + 0.2 * uPulse + 2.0 * uRelay.w : 1.0 + 2.0 * max(pass, armPass)) * mix(0.3, 1.6, uNight); }\n" +
    "   else if (isWall) {\n" +
    "    float seamAt = (0.5 - vLocal.x) * widthX - 1.0, seam = abs(vFace.z) > 0.5 ? lineAt(seamAt, 0.35, fwidth(seamAt)) : 0.0;\n" +
    "    paint += seam * 0.85; light += seam * mix(0.5, 1.6, uNight);\n" +
    "    if (kind == 5) {\n" +
    "     float sideAt = vLocal.z * depthZ, isSlit = step(0.5, vFace.x), isOuter = step(vFace.x, -0.5);\n" +
    "     float ribs = isSlit * lineAt(mod(up, 12.0) - 6.0, 0.2, upPx) * step(1.5, 0.5 * depthZ - abs(sideAt)) + isOuter * lineAt(sideAt, 0.2, fwidth(sideAt));\n" +
    "     float charged = 1.0 - smoothstep(uRelay.x - 3.0, uRelay.x, vWorld.y), ribLight = mix(mix(0.15, 0.3, uNight), mix(1.2, 2.2, uNight), charged);\n" +
    "     float foot = vSize.y > 100.0 ? 1.0 - smoothstep(0.5 - upPx, 0.5 + upPx, up) : 0.0, flood = isSlit * step(uRelay.y, vWorld.y) * step(vWorld.y, uRelay.z);\n" +
    // The flare on the slit faces drains upward with the flood as the column lets go. By day the flood and the flare are mostly paint,
    // since more light than a little over orange paint turns it yellow.
    "     float flared = isSlit * uBeamLight.z * step(uRelay.y, vWorld.y);\n" +
    "     paint += ribs * 0.75 * min(1.0, ribLight) + foot * 0.4 + flood + min(1.0, 2.0 * flared);\n" +
    "     light += ribs * ribLight + foot * mix(0.5, 1.0, uNight) + flood * mix(0.25, 2.5, uNight) + flared * mix(0.25, 2.0, uNight);\n" +
    "    } else { float band = lineAt(vSize.y - up - 3.0, 0.2, upPx); paint += band * 0.75; light = (light + band * mix(0.35, 1.6, uNight)) * (1.0 + 1.5 * pass); }\n" +
    "   }\n" +
    "   carvedMask = clamp(paint, 0.0, 1.0); col = mix(col, tone * 0.9, carvedMask * (1.0 - uNight)); glow += tone * light; }\n" +
    // The arms: the circuit's lines down the two middle streets, from the dais out to the coast, faint orange paint by day and glowing at
    // night. Before a firing a bright front runs in along them from beyond the coast to the dais, with a lit trail behind it.
    "  if ((kind == 4 || kind == 8) && vFace.y > 0.5) { float off = min(abs(vWorld.x), abs(vWorld.z)), reach = max(abs(vWorld.x), abs(vWorld.z));\n" +
    "   float arm = lineAt(off, 0.3, fwidth(off)) * step(0.0, max(abs(vWorld.x) - 27.0, abs(vWorld.z) - 41.0));\n" +
    "   if (arm > 0.0) { float ahead = reach - uWave.z, gather = uWave.w * (3.0 * exp(-ahead * ahead / 100.0) + 0.6 * step(0.0, ahead) * exp(-ahead / 80.0));\n" +
    "    col = mix(col, carve * 0.9, min(1.0, arm * (0.35 + gather)) * (1.0 - uNight)); glow += carve * arm * (1.2 * uNight + gather * mix(0.3, 1.0, uNight)); carvedMask = max(carvedMask, arm); } }\n" +
    // The roofs and plates along the arms light whole as the front passes them, so the charge running in shows from a low view too,
    // where the buildings beside an arm hide its line.
    "  if (armPass > 0.0 && vFace.y > 0.5 && isBuilt && min(abs(vOrigin.x), abs(vOrigin.y)) < 10.0) { col = mix(col, carve * mix(0.95, 1.15, uNight), armPass * mix(0.85, 0.75, uNight)); glow += carve * armPass * 0.6 * uNight; }\n" +
    // The wave: roofs and plates light whole as it passes (walls never flash, so silhouettes stay clean), the ground's mesh shows a thin
    // line at its front, and the carvings flare and keep a warm glow behind it (orange paint by day, so the answer reads in daylight).
    // Roofs and the line turn orange rather than take orange light, which would turn white roofs peach and navy ones pink; the band of
    // lit roofs is narrower by day, where it's paint.
    "  if (uWave.y > 0.0) { vec3 ember = vec3(1.0, 0.45, 0.12); float calm = mix(uRelayGlow.y, 1.0, uNight);\n" +
    "   if (vFace.y > 0.5 && isBuilt && since >= 0.0) col = mix(col, ember * mix(0.95, 1.15, uNight), mix(1.0 - smoothstep(14.0, 18.0, since), exp(-since / 40.0), uNight) * uWave.y * mix(0.85, 0.75, uNight) * calm);\n" +
    "   if (kind >= 8) col = mix(col, ember * mix(0.95, 1.3, uNight), exp(-since * since / 36.0) * uWave.y * 0.85 * calm);\n" +
    "   glow += ember * carvedMask * (2.5 * hit + 1.2 * hold) * mix(0.3, 1.0, uNight); col = mix(col, ember, carvedMask * hold * 0.5 * (1.0 - uNight)); }\n" +
    // The beam's light: a line light down the column on every built face that looks toward it (faces low in the streets get less).
    "  if (uBeamLight.y > 0.0 && isBuilt) { vec3 toAxis = vec3(-vWorld.x, max(uBeamLight.x, vWorld.y + 40.0) - vWorld.y, -vWorld.z);\n" +
    "   float lit = max(dot(n, normalize(toAxis)), 0.0) / (1.0 + dot(toAxis.xz, toAxis.xz) / 40000.0) * smoothstep(5.0, 60.0, vWorld.y + 40.0 * step(0.5, vFace.y));\n" +
    "   col += base * vec3(1.0, 0.55, 0.2) * lit * uBeamLight.y; }\n" +
    " }\n" +
    " else { float diff = max(dot(n, uSun), 0.0);\n" +
    "  float rim = pow(1.0 - max(dot(n, v), 0.0), 2.5);\n" +
    "  col = base * (0.82 + 0.3 * diff) * (1.0 + mix(0.2, 0.25, uNight)) + base * rim * 0.35; }\n" +
    " vec3 q = vec3(vLocal.x + 0.5, vLocal.y, vLocal.z + 0.5); vec3 toEdge = min(q, 1.0 - q) * vSize;\n" +
    " float e = abs(vFace.x) > 0.5 ? min(toEdge.y, toEdge.z) : (abs(vFace.y) > 0.5 ? min(toEdge.x, toEdge.z) : min(toEdge.x, toEdge.y));\n" +
    " float px = fwidth(e); float line = 1.0 - smoothstep(px * 0.5, px * 1.6, e);\n" +
    " if (uLit < 0.5) col += vec3(1.0, 0.86, 0.6) * line * 0.3 * uEdge + vec3(0.06, 0.035, 0.0);\n" +
    // The orange shapes keep more of their color through the haze, so they still read from afar.
    // By day the orange (carvings, players, their trails) is a deep rust, so it stands out on the pale void as bright orange does on the dark.
    " float orangeShare = smoothstep(0.12, 0.35, col.r - col.b) * smoothstep(0.08, 0.25, col.r - col.g); col = mix(col, col * vec3(0.58, 0.34, 0.18), orangeShare * (1.0 - uNight));\n" +
    " float fog = hazeAt(uCam, vWorld) * mix(mix(0.45, 0.7, uNight), 1.0, uLit);\n" +
    " col = mix(col, hazeColor(uCam, vWorld, uSun, uNight), fog) + glow * (1.0 - 0.5 * fog);\n" +
    " outColor = vec4(col, uOpaque > 0.5 ? 0.0 : vCol.a); }";
  var DEPTH_VS = "#version 300 es\nlayout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in vec3 iOff; layout(location=3) in vec3 iScale; layout(location=5) in vec4 iMaterial; layout(location=6) in vec2 iRot;\n" +
    "uniform mat4 uLightViewProj;\n" + PLACE_GLSL +
    "void main(){ vec3 nn = aNor; gl_Position = uLightViewProj * vec4(iOff + placeCorner(aPos, iScale, iMaterial, iRot, nn), 1.0); }";
  var DEPTH_FS = "#version 300 es\nprecision mediump float; out vec4 o; void main(){ o = vec4(1.0); }";
  var FULL_VS = "#version 300 es\nout vec2 vUv; void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }";
  var NOISE_GLSL = "float hash1(float x){ return fract(sin(x * 127.1) * 43758.5453); }\n";
  // The sky's ceiling, where the Relay's ring runs out at a firing, and the spacing of the lattice it lights there.
  var SKY_CEILING_Y = 600, LATTICE_SPACING = 220;
  var SKY_FS = "#version 300 es\nprecision highp float; in vec2 vUv;\n" +
    "uniform vec3 uFwd; uniform vec3 uRight; uniform vec3 uUp; uniform vec2 uTan; uniform vec2 uShift; uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec3 uSun; uniform float uNight; uniform float uTime;\n" +
    "uniform vec3 uEye; uniform vec4 uBeamSky; uniform vec4 uSkyRing; out vec4 o;\n" +
    NOISE_GLSL + LINE_GLSL +
    // A dome, not weather: pale cyan to white at the horizon and a deeper clean blue up high by day, deep navy to near-black at night.
    "void main(){ vec2 s = vUv * 2.0 - 1.0 - uShift; vec3 d = normalize(uFwd + uRight * s.x * uTan.x + uUp * s.y * uTan.y);\n" +
    " float h = max(d.y, 0.0); float toSun = dot(d, uSun);\n" +
    " vec3 c = mix(uHorizon, uZenith, 1.0 - exp(-h * 3.2));\n" +
    " c += uHorizon * 0.12 * exp(-h * 16.0) * 0.4 * uNight;\n" +
    // The sun, a digital one: a crisp disc ringed by three thin circles, the outer two broken into dashes turning slowly opposite ways.
    // No glare and no rays. At night the same, cooler and dimmer.
    " if (toSun > 0.99) { vec3 across = normalize(cross(uSun, vec3(0.0, 1.0, 0.0))), upward = cross(across, uSun); vec2 q = vec2(dot(d, across), dot(d, upward));\n" +
    "  float rho = length(q), px = max(fwidth(rho), 1e-5), turn = atan(q.y, q.x);\n" +
    "  float disc = 1.0 - smoothstep(0.011 - px, 0.011 + px, rho);\n" +
    "  float rings = lineAt(rho - 0.017, 0.0005, px) + lineAt(rho - 0.023, 0.0005, px) * step(0.5, fract(turn * 2.546 + uTime * 0.03))\n" +
    "   + 0.7 * lineAt(rho - 0.03, 0.0004, px) * step(0.3, fract(turn * 5.093 - uTime * 0.02));\n" +
    "  c = mix(c, mix(vec3(1.0, 1.0, 0.98), vec3(0.8, 0.88, 1.0), uNight), clamp(disc + 0.85 * rings, 0.0, 1.0) * mix(0.18, 0.6, uNight)); }\n" +
    // While the Relay fires: a warm glow round the column above the capstone, so what stands in front of it reads as a silhouette; and the
    // sky shows it's a grid: a square ring runs out over a ceiling at SKY_CEILING_Y, lighting a lattice behind it that fades away.
    " if (uBeamSky.z + uSkyRing.y > 0.0) { float warm = 0.0, flatShare = max(dot(d.xz, d.xz), 1e-6), t = -dot(uEye.xz, d.xz) / flatShare;\n" +
    "  if (t > 0.0) { float off = length(uEye.xz + d.xz * t), y = uEye.y + d.y * t;\n" +
    "   warm = uBeamSky.z * 0.3 * exp(-off * off / 1600.0) * smoothstep(" + CAPSTONE_TOP_Y.toFixed(1) + ", " + (CAPSTONE_TOP_Y + 60).toFixed(1) + ", y) * (1.0 - smoothstep(uBeamSky.y - 40.0, uBeamSky.y, y)); }\n" +
    "  vec2 p = uEye.xz + d.xz * (" + SKY_CEILING_Y.toFixed(1) + " - uEye.y) / max(d.y, 0.02); vec2 cell = abs(fract(p / " + LATTICE_SPACING.toFixed(1) + " + 0.5) - 0.5) * " + LATTICE_SPACING.toFixed(1) + ", latticePx = max(fwidth(p), vec2(1e-3));\n" +
    "  float lattice = max(1.0 - smoothstep(2.0, 2.0 + 1.5 * latticePx.x, cell.x), 1.0 - smoothstep(2.0, 2.0 + 1.5 * latticePx.y, cell.y)) * clamp(1.0 - max(latticePx.x, latticePx.y) / 40.0, 0.0, 1.0);\n" +
    "  float r = max(abs(p.x), abs(p.y)), ringAt = (r - uSkyRing.x) / (60.0 + 0.04 * uSkyRing.x);\n" +
    "  warm += uSkyRing.y * step(0.02, d.y) * exp(-length(p - uEye.xz) / 3500.0) * (exp(-ringAt * ringAt) + 0.6 * lattice * step(r, uSkyRing.x) * exp(-max(uSkyRing.x - r, 0.0) / 500.0));\n" +
    "  vec3 ember = vec3(1.0, 0.5, 0.15); c = mix(mix(c, ember, clamp(warm * 1.3, 0.0, 1.0) * 0.85), c + ember * warm, uNight); }\n" +
    " o = vec4(c, 1.0); }";
  /* The sea: a data sea. An endless faceted surface, low-poly like the city, slowly rising and falling: glassy pale cyan by day under a
     soft white horizon, near-black navy at night. On it a faint grid every SEA_GRID_UNITS, lined up with the city's streets so the arms
     run on out as grid lines; small orange packets running in along it to the island; a bright line where the island's ledge meets it;
     and where it's tapped, a square ring of light running out along the grid. */
  var SEA_GRID_UNITS = 28;
  var WATER_VS = "#version 300 es\nlayout(location=0) in vec2 aXZ; layout(location=1) in float aSeed; uniform mat4 uViewProj; uniform float uY; uniform float uTime; uniform vec4 uWave; out vec3 vWorld; out float vShallow;\n" + WAVE_GLSL +
    "void main(){ vec2 p = aXZ; float r = length(p); float t = uTime; float a = atan(p.y, p.x);\n" +
    " float coast = 300.0 + 26.0 * sin(3.0 * a + 0.7) + 18.0 * sin(5.0 * a + 2.1) + 9.0 * sin(9.0 * a + 4.0);\n" +
    " float shore = mix(0.3, 1.0, smoothstep(coast - 5.0, coast + 30.0, r)); vShallow = 1.0 - smoothstep(coast, coast + 70.0, r);\n" +
    " float amp = 0.12 + smoothstep(310.0, 440.0, r) * r * 0.0016;\n" +
    // Every point of the sea bobs on its own, so each triangle tilts and catches the light differently.
    " float y = amp * (0.75 * sin(t * (0.2 + aSeed * 0.2) + aSeed * 6.2832) + 0.3 * sin(p.x * 0.008 + p.y * 0.006 + t * 0.18));\n" +
    // The Relay's wave lifts the facets it's crossing beyond the coast, a low flare of facets running out to sea.
    " if (uWave.z > 0.0) { float k = (uWave.x - waveDistance(p)) / max(24.0, 0.12 * r); y += 2.5 * uWave.z * exp(-k * k) * step(coast, r); }\n" +
    " vWorld = vec3(p.x, uY + y * shore, p.y); gl_Position = uViewProj * vec4(vWorld, 1.0); }";
  var WATER_FS = "#version 300 es\nprecision highp float; in vec3 vWorld; in float vShallow;\n" +
    "uniform vec3 uCam; uniform vec3 uSun; uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec4 uRipples[12]; uniform int uRippleCount; uniform float uNight; uniform float uTime;\n" +
    "uniform vec4 uWave; uniform vec4 uBeamReflect; out vec4 o;\n" + FOG_GLSL + WAVE_GLSL + LINE_GLSL + NOISE_GLSL +
    "void main(){ vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld))); if (n.y < 0.0) n = -n;\n" +
    " float d = distance(vWorld, uCam); vec3 v = normalize(uCam - vWorld); vec3 r = reflect(-v, n);\n" +
    " float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);\n" +
    " vec3 skyRef = mix(uHorizon, uZenith, pow(clamp(r.y, 0.0, 1.0), 0.45));\n" +
    " float shallow = vShallow, facet = 0.85 + 0.25 * max(dot(n, uSun), 0.0);\n" +
    " vec3 deep = mix(mix(vec3(0.78, 0.82, 0.87), vec3(0.8, 0.84, 0.89), shallow), mix(vec3(0.006, 0.014, 0.036), vec3(0.01, 0.04, 0.066), shallow), uNight);\n" +
    " vec3 c = mix(deep * facet, skyRef * (0.94 + 0.08 * facet), clamp(fres * 0.9 + 0.18, 0.0, 0.8) * (1.0 - 0.4 * shallow));\n" +
    // The grid: its lines never thinner than most of a pixel, each set fading out before its cells crowd into a moire; every fourth line
    // carries on further out.
    " vec2 g = vWorld.xz / " + SEA_GRID_UNITS.toFixed(1) + ", cellPx = max(fwidth(g), vec2(1e-4)), e = abs(fract(g + 0.5) - 0.5), wideE = abs(fract(g / 4.0 + 0.5) - 0.5);\n" +
    " vec2 fine = vec2(lineAt(e.x, 0.03, cellPx.x), lineAt(e.y, 0.03, cellPx.y)) * (1.0 - smoothstep(vec2(0.07), vec2(0.16), cellPx));\n" +
    " vec2 wide = vec2(lineAt(wideE.x, 0.01, cellPx.x / 4.0), lineAt(wideE.y, 0.01, cellPx.y / 4.0)) * (1.0 - smoothstep(vec2(0.07), vec2(0.16), cellPx / 4.0));\n" +
    " float grid = max(max(fine.x, fine.y), 0.8 * max(wide.x, wide.y)) * exp(-d / 5000.0);\n" +
    // The island's edge, where its ledge meets the sea: a thin bright line with a little glow outward.
    " float radius = length(vWorld.xz), angle = atan(vWorld.z, vWorld.x), coast = 300.0 + 26.0 * sin(3.0 * angle + 0.7) + 18.0 * sin(5.0 * angle + 2.1) + 9.0 * sin(9.0 * angle + 4.0), outside = radius - coast - 12.45;\n" +
    " float edge = 0.0;\n" +
    // Packets: on a few of the lines that reach the island, a short run of light heading in along it, gone as it reaches the edge.
    " vec2 lineIndex = floor(g + 0.5); float packet = 0.0;\n" +
    " for (int k = 0; k < 2; k++) { float index = k == 0 ? lineIndex.x : lineIndex.y, along = k == 0 ? vWorld.z : vWorld.x, offLine = k == 0 ? e.x : e.y, px = k == 0 ? cellPx.x : cellPx.y;\n" +
    "  float pick = hash1(index * 3.17 + sign(along) * 0.71 + float(k) * 5.3);\n" +
    "  if (pick < 0.22 && abs(index) * " + SEA_GRID_UNITS.toFixed(1) + " < 280.0) { float speed = 30.0 + 50.0 * hash1(pick * 91.3), head = 1600.0 - mod(uTime * speed + pick * 7919.0, 1400.0), behind = abs(along) - head;\n" +
    "   packet += step(0.0, behind) * exp(-max(behind, 0.0) / 14.0) * lineAt(offLine, 0.05, px); } }\n" +
    " packet *= step(0.0, outside);\n" +
    // A tap: a square ring of light running out along the grid's lines (a faint fill where the lines have faded), and the cell it hit lit.
    " float tap = 0.0; for (int i = 0; i < 12; i++) { if (i >= uRippleCount) break; vec4 rp = uRipples[i]; if (rp.w > 0.5) { float age = rp.z; vec2 off = abs(vWorld.xz - rp.xy);\n" +
    "   float k = (max(off.x, off.y) - rp.w * (3.0 + 14.0 * age)) / (rp.w * (1.6 + 0.6 * age)), k2 = (max(off.x, off.y) - rp.w * (3.0 + 10.0 * max(age - 0.35, 0.0))) / (rp.w * (1.4 + 0.6 * age)), onLine = max(lineAt(e.x, 0.06, cellPx.x), lineAt(e.y, 0.06, cellPx.y));\n" +
    "   vec2 tapCell = abs(floor(g) - floor(rp.xy / " + SEA_GRID_UNITS.toFixed(1) + "));\n" +
    "   tap = max(tap, (exp(-k * k) * (0.6 + 0.5 * onLine) + 0.3 * exp(-k2 * k2) * step(0.35, age) * (0.5 + 0.5 * onLine)) * exp(-age * 1.2) + 0.45 * exp(-age * 3.0) * step(max(tapCell.x, tapCell.y), 0.5)); } }\n" +
    // The Relay's wave turns the grid orange behind its front as it runs out over the sea.
    " float since = uWave.x - waveDistance(vWorld.xz), flare = uWave.y > 0.0 && since >= 0.0 ? uWave.y * exp(-since / 220.0) : 0.0;\n" +
    // By day the lines are a pale cyan-white over the glassy sea, low in contrast, and the orange is mixed in (orange added to blue turns
    // white); at night they glow a soft cyan-blue and the orange adds.
    " vec3 lineTone = mix(vec3(0.9, 0.98, 1.0), vec3(0.3, 0.6, 1.0), uNight), ember = vec3(1.0, 0.5, 0.15);\n" +
    " float cool = grid * (1.0 - flare) * mix(0.05, 0.26, uNight) + edge * mix(0.7, 0.9, uNight), warmth = packet * mix(0.22, 1.3, uNight) + grid * flare * mix(1.5, 1.6, uNight);\n" +
    " c = mix(mix(c, lineTone, clamp(cool, 0.0, 1.0)), c + lineTone * cool, uNight);\n" +
    // A tap's rings in a saturated cyan-blue, so they read on the pale sea by day as clearly as they glow at night.
    " vec3 tapTone = mix(vec3(0.2, 0.55, 0.95), vec3(0.35, 0.75, 1.0), uNight); c = mix(mix(c, tapTone, clamp(tap, 0.0, 1.0) * 0.6), c + tapTone * tap * 0.8, uNight);\n" +
    " c = mix(mix(c, ember, clamp(warmth, 0.0, 1.0)), c + ember * warmth, uNight);\n" +
    // While the Relay fires: a crisp line where its wave is, with a faint wake, and the column's reflection, broken by the facets into a
    // run of orange toward the eye. Mixed in by day, added at night.
    " if (uWave.y + uBeamReflect.z > 0.0) { float width = 4.0 + 0.012 * radius;\n" +
    "  float warm = uWave.y * (exp(-since * since / (width * width)) + 0.25 * step(0.0, since) * exp(-max(since, 0.0) / 80.0));\n" +
    "  float flatShare = max(dot(r.xz, r.xz), 1e-6), t = -dot(vWorld.xz, r.xz) / flatShare, off = length(vWorld.xz + r.xz * t), y = vWorld.y + r.y * t;\n" +
    "  warm += uBeamReflect.z * step(0.0, t) * exp(-off * off / 400.0) * step(uBeamReflect.x, y) * step(y, uBeamReflect.y);\n" +
    "  c = mix(mix(c, ember, clamp(warm * 1.5, 0.0, 1.0)), c + ember * warm, uNight); }\n" +
    // The haze, and far out the sea meets the sky's horizon, so there's no edge to the world.
    " c = mix(c, hazeColor(uCam, vWorld, uSun, uNight), hazeAt(uCam, vWorld));\n" +
    " c = mix(c, uHorizon, smoothstep(2600.0, 7000.0, d));\n" +
    " o = vec4(c, 0.0); }";
  // Bright parts of the picture, for the bloom.
  // While the Relay fires its column carries its own glow, so the orange boost eases off and the column doesn't flood the frame.
  var BRIGHT_FS = "#version 300 es\nprecision highp float; in vec2 vUv; uniform sampler2D uTex; uniform float uThreshold; uniform float uOrangeBoost; out vec4 o;\n" +
    "void main(){ vec3 c = texture(uTex, vUv).rgb; float l = dot(c, vec3(0.2126, 0.7152, 0.0722));\n" +
    " float k = smoothstep(uThreshold, uThreshold + 0.12, l);\n" +
    " float orange = smoothstep(0.1, 0.35, c.r - c.b) * smoothstep(0.05, 0.18, c.r - c.g);\n" +
    " o = vec4(c * k, clamp(orange * uOrangeBoost * 0.4, 0.0, 1.0)); }";
  var COPY_FS = "#version 300 es\nprecision highp float; in vec2 vUv; uniform sampler2D uTex; out vec4 o; void main(){ o = texture(uTex, vUv); }";
  var BLUR_FS = "#version 300 es\nprecision highp float; in vec2 vUv; uniform sampler2D uTex; uniform vec2 uStep; out vec4 o;\n" +
    "void main(){ vec4 c = texture(uTex, vUv) * 0.227027;\n" +
    " c += (texture(uTex, vUv + uStep * 1.3846) + texture(uTex, vUv - uStep * 1.3846)) * 0.316216;\n" +
    " c += (texture(uTex, vUv + uStep * 3.2308) + texture(uTex, vUv - uStep * 3.2308)) * 0.070270;\n" +
    " o = c; }";
  // The final picture: sharp across the frame, the bloom, a gentle filmic contrast and a vignette.
  var COMPOSITE_FS = "#version 300 es\nprecision highp float; in vec2 vUv;\n" +
    "uniform sampler2D uScene; uniform sampler2D uSoft; uniform sampler2D uBloom; uniform float uFocusY; uniform float uBloomStrength; uniform vec2 uAspect; uniform float uSharpen;\n" +
    "uniform float uFlash; uniform vec2 uFlareUv; uniform float uFlareStrength; uniform float uGradeNight; out vec4 o;\n" +
    // Where the picture is drawn with fewer pixels than the screen has, a light sharpen against its four neighbours brings the edges back.
    "void main(){ vec3 c = texture(uScene, vUv).rgb;\n" +
    " if (uSharpen > 0.0) { ivec2 at = ivec2(gl_FragCoord.xy); vec3 around = texelFetch(uScene, at + ivec2(1, 0), 0).rgb + texelFetch(uScene, at - ivec2(1, 0), 0).rgb + texelFetch(uScene, at + ivec2(0, 1), 0).rgb + texelFetch(uScene, at - ivec2(0, 1), 0).rgb;\n" +
    "  c = clamp(c + (c - around * 0.25) * uSharpen, 0.0, 1.0); }\n" +
    // The bloom: bright light adds (the beam blinds by day as at night); the orange's own bloom glows at night and by day is a soft rust
    // halo that deepens the pale void round the carvings and the players, as the glow lifts the dark round them at night.
    " vec4 bloom = texture(uBloom, vUv); c += bloom.rgb * uBloomStrength;\n" +
    " vec3 orangeGlow = vec3(1.0, 0.55, 0.15) * bloom.a * 2.5 * uBloomStrength, rustHalo = vec3(0.25, 0.62, 0.85) * bloom.a * 1.5 * uBloomStrength;\n" +
    " c = mix(c * (1.0 - rustHalo), c + orangeGlow, uGradeNight);\n" +
    // The Relay's release: a brief warm brightening of the whole frame, kept far under a harmful flash.
    " c += vec3(1.0, 0.6, 0.25) * uFlash;\n" +
    // The lens flare while the Relay fires, from the capstone's slot (uFlareUv): a long thin horizontal streak through it, a small star,
    // and square ghosts running through the frame's middle, from warm by the source to cool across the frame, as a lens would.
    " if (uFlareStrength > 0.0) { vec2 p = (vUv - uFlareUv) * uAspect, axis = (vec2(0.5) - uFlareUv) * uAspect;\n" +
    "  float streak = exp(-abs(p.y) * 320.0) * exp(-abs(p.x) * 1.6), star = exp(-length(p) * 22.0) + 0.5 * exp(-abs(p.x) * 70.0) * exp(-abs(p.y) * 900.0);\n" +
    "  vec3 flare = vec3(1.0, 0.72, 0.42) * streak * 0.55 + vec3(1.0, 0.92, 0.8) * star * 0.7;\n" +
    "  for (int k = 0; k < 4; k++) { float f = float(k), size = 0.018 + 0.014 * f; vec2 q = p - axis * (0.55 + 0.42 * f) * 2.0; float box = max(abs(q.x), abs(q.y));\n" +
    "   flare += mix(vec3(1.0, 0.55, 0.2), vec3(0.45, 0.75, 1.0), f / 3.0) * ((1.0 - smoothstep(size * 0.8, size, box)) * 0.05 + (1.0 - smoothstep(0.0, 0.0025, abs(box - size))) * 0.06); }\n" +
    "  c += flare * uFlareStrength; }\n" +
    // Clamped first: the curve turns values over 1 (the flare's heart, the beam's core) negative, and white went blue.
    // The grade. By day the picture is lifted out of its haze: more saturation and contrast, cooler shadows, warmer highlights, and
    // orange (the carvings, the players) pushed to its full strength; at night it's barely touched.
    " float luma = dot(c, vec3(0.2126, 0.7152, 0.0722)), day = 1.0 - uGradeNight, orangeShare = smoothstep(0.12, 0.35, c.r - c.b) * smoothstep(0.08, 0.25, c.r - c.g);\n" +
    " c = mix(vec3(luma), c, mix(1.06, 1.2, day) + 0.25 * orangeShare * day);\n" +
    " c *= mix(vec3(1.0), mix(vec3(0.96, 1.0, 1.04), vec3(1.03, 1.0, 0.96), smoothstep(0.25, 0.85, luma)), day);\n" +
    " c = (c - 0.45) * mix(1.0, 1.1, day) + 0.45;\n" +
    " c = clamp(c, 0.0, 1.0); c = mix(c, c * c * (3.0 - 2.0 * c), 0.22);\n" +
    " vec2 v = (vUv - 0.5) * uAspect; c *= 1.0 - dot(v, v) * 0.12;\n" +
    " c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;\n" +
    " o = vec4(c, 1.0); }";
  /* The Relay's light: one quad standing on its axis (x = z = 0), turned round the vertical to face the eye, with no buffer (its corners
     come from the vertex's number). Every pixel works out where its view ray passes closest to the axis, how far off it, at what height
     and how slanted, and draws the light there in closed form. The quad sits at the axis's depth, so the blades' near halves hide it and
     it shows only through the slit and above the tips. At rest it's a thin thread rising from the capstone; firing, it's the column. It's
     drawn premultiplied over the scene, so by day it covers the sky (orange stays orange on blue) and at night it nearly adds, leaving
     the sky mask alone. */
  var BEAM_VS = "#version 300 es\nuniform mat4 uViewProj; uniform vec3 uCam; uniform vec4 uBeamQuad; out vec3 vWorld; out float vAcross;\n" +
    "void main(){ vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)); vec2 toEye = normalize(uCam.xz + vec2(1e-3, 0.0)); vec2 side = vec2(-toEye.y, toEye.x);\n" +
    " vAcross = corner.x * 2.0 - 1.0; float across = vAcross * uBeamQuad.z; vWorld = vec3(side.x * across, mix(uBeamQuad.x, uBeamQuad.y, corner.y), side.y * across);\n" +
    " gl_Position = uViewProj * vec4(vWorld, 1.0); }";
  var BEAM_FS = "#version 300 es\nprecision highp float; in vec3 vWorld; in float vAcross;\n" +
    "uniform vec3 uCam; uniform float uNight; uniform vec4 uBeamColumn; uniform vec4 uBeamLook; uniform vec4 uThread; out vec4 o;\n" + FOG_GLSL + NOISE_GLSL +
    "void main(){ vec3 dir = normalize(vWorld - uCam); float flatShare = max(dot(dir.xz, dir.xz), 1e-6), t = -dot(uCam.xz, dir.xz) / flatShare;\n" +
    " float d = length(uCam.xz + dir.xz * t), y = uCam.y + dir.y * t, slant = min(inversesqrt(flatShare), 1.6), px = max(fwidth(d), 1e-3);\n" +
    " float sec = uBeamLook.x, intensity = uBeamLook.z, fade = exp(-max(y - " + CAPSTONE_TOP_Y.toFixed(1) + ", 0.0) / 2600.0), body = 0.0, core = 0.0, halo = 0.0;\n" +
    " vec3 orange = vec3(1.0, 0.5, 0.1), coreTone = mix(mix(vec3(1.0, 0.97, 0.9), vec3(1.0, 0.95, 0.85), uNight), vec3(1.0, 0.6, 0.2), smoothstep(" + RELAY_TIP_Y.toFixed(1) + ", " + (RELAY_TIP_Y + 90).toFixed(1) + ", y));\n" +
    // The column, between its foot (uBeamColumn.x) and its head (.y): a straight beam of light with crisp edges, narrower inside the slit,
    // and a brighter core down its middle. Its edges are held to a pixel so they never shimmer.
    " if (intensity > 0.0) {\n" +
    "  float w = uBeamColumn.z * mix(3.6, 6.0, smoothstep(" + (RELAY_TIP_Y - 12).toFixed(1) + ", " + (RELAY_TIP_Y + 12).toFixed(1) + ", y)), soft = max(px, 0.05);\n" +
    "  float head = uBeamColumn.y < 5900.0 ? 1.0 - smoothstep(0.0, 6.0, y - uBeamColumn.y) : 0.0;\n" +
    "  float along = smoothstep(uBeamColumn.x, uBeamColumn.x + 4.0, y) * (uBeamColumn.y < 5900.0 ? head : 1.0) * fade * intensity;\n" +
    "  body = (1.0 - smoothstep(w - soft, w + soft, d)) * along;\n" +
    "  float coreWidth = mix(0.55, 0.38, uNight) * w; core = (1.0 - smoothstep(coreWidth - soft, coreWidth + soft, d)) * along * mix(1.6, 1.0, uNight);\n" +
    "  halo = exp(-max(d - w, 0.0) / (0.5 * w)) * (1.0 - body) * 0.1 * uNight * along; }\n" +
    // The flare: a point of light in the capstone's slot (uThread.w high), while it charges and as it fires.
    " vec3 toSlot = vec3(0.0, uThread.w, 0.0) - uCam; vec3 offSlot = toSlot - dir * dot(toSlot, dir); float slotOff = dot(offSlot, offSlot);\n" +
    " float flare = uBeamLook.w * exp(-slotOff / 64.0);\n" +
    // The thread: a core-only line from the capstone up, never thinner than most of a pixel (it fades instead).
    " float sigma = max(uThread.z, 0.7 * px), thread = uThread.x * uThread.z / sigma * exp(-d * d / (sigma * sigma)) * slant * smoothstep(uThread.y, uThread.y + 3.0, y) * fade;\n" +
    " vec3 threadTone = mix(vec3(1.0, 0.62, 0.2), vec3(1.0, 0.74, 0.42), uNight);\n" +
    // Its light, held to one hue as it brightens (by day no brighter than orange can stay orange), and how much of what's behind it it hides.
    " vec3 light = orange * (body + halo) + coreTone * core + mix(orange, coreTone, 0.6) * flare + threadTone * thread;\n" +
    " light *= min(1.0, mix(1.7, mix(1.6, 1.1, smoothstep(" + RELAY_TIP_Y.toFixed(1) + ", " + (RELAY_TIP_Y + 60).toFixed(1) + ", y)), uNight) / max(max(light.r, light.g), max(light.b, 1e-4)));\n" +
    // Everything fades out before the quad's sides, so its edges never show.
    " float haze = hazeAt(uCam, vec3(0.0, y, 0.0)), edge = 1.0 - smoothstep(0.5, 1.0, abs(vAcross));\n" +
    " float cover = clamp(core + 0.95 * body + 0.6 * halo + 0.5 * flare + thread, 0.0, 1.0) * mix(0.9, 0.12, uNight);\n" +
    " o = vec4(light * (1.0 - 0.5 * haze), cover * (1.0 - 0.6 * haze)) * edge; }";

  // The sea's facets: rings of triangles that grow with distance, so they look the same size on screen out to the horizon.
  var RINGS = 34, SEGMENTS = 64, R0 = 200, GROW = Math.pow(9000 / R0, 1 / RINGS), WATER_COUNT = RINGS * SEGMENTS * 6, seaVertices = new Float32Array(WATER_COUNT * 3);
  function ringPoint(i, j) {
    var r = R0 * Math.pow(GROW, i), a = (j + 0.5 * (i % 2)) / SEGMENTS * Math.PI * 2, jj = j % SEGMENTS;
    var h = Math.sin(i * 127.1 + jj * 311.7) * 43758.5453;
    return [Math.cos(a) * r, Math.sin(a) * r, h - Math.floor(h)];
  }
  function buildSea() {
    var at = 0;
    for (var ri = 0; ri < RINGS; ri++) for (var sj = 0; sj < SEGMENTS; sj++) {
      var pa = ringPoint(ri, sj), pb = ringPoint(ri, sj + 1), pc = ringPoint(ri + 1, sj), pd = ringPoint(ri + 1, sj + 1);
      var order = ri % 2 === 0 ? [pa, pc, pb, pb, pc, pd] : [pa, pc, pd, pa, pd, pb];
      for (var v = 0; v < 6; v++) { seaVertices[at++] = order[v][0]; seaVertices[at++] = order[v][1]; seaVertices[at++] = order[v][2]; }
    }
  }

  // Rows of boxes: the city's (drawn the same every frame) and the movers' and trails' (written again each frame).
  var STRIDE = 16; // offset 3, scale 3, color 4, material 4 (kind, seed, taper across, taper deep), heading and climb 2
  function group(capacity) { return { data: new Float32Array(capacity * STRIDE), count: 0, capacity: capacity }; }
  function put(g, x, y, z, sx, sy, sz, r, gg, b, a, kind, seed, taperAcross, taperDeep, yaw, pitch) {
    if (g.count >= g.capacity) return;
    var o = g.count * STRIDE, d = g.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = sx; d[o + 4] = sy; d[o + 5] = sz;
    d[o + 6] = r; d[o + 7] = gg; d[o + 8] = b; d[o + 9] = a;
    d[o + 10] = kind || 0; d[o + 11] = seed || 0; d[o + 12] = taperAcross || 0; d[o + 13] = taperDeep || 0; d[o + 14] = yaw || 0; d[o + 15] = pitch || 0;
    g.count++;
  }

  /* Build the city: the one city, on land in an endless sea, every building turned to the Relay at its middle. Round the Relay's court
     a low inner terrace, then a crown of the tallest towers, terraces stepping down from it, a calm low field out to the edge, and a
     valley of low plinths opening from the first view to the Relay's feet. Every level sits at its own height, so nothing flickers. */
  var LAND = 54, C = 14, BLOCK = 10;
  var STREET_Y = 0, PAVE_H = 0.25, WATER_Y = -4.2;
  var city = group(18000);
  // A steady number from 0 to 1 for a place, so details can vary from building to building without drawing on the seeded random.
  function hashAt(x, z, salt) { var h = Math.sin(x * 127.1 + z * 311.7 + salt * 74.7) * 43758.5453; return h - Math.floor(h); }
  function coastAt(x, z) { var a = Math.atan2(z, x); return 300 + 26 * Math.sin(3 * a + 0.7) + 18 * Math.sin(5 * a + 2.1) + 9 * Math.sin(9 * a + 4); }
  var downtown = [], allBuildings = [];
  // What the roof maps, loops, pads and bays know of a building: one record per stacked column, with its tone for the bays.
  function addRecord(x, z, w, d, top, tone) {
    var record = { x: x, z: z, w: w, d: d, top: top, tone: tone };
    allBuildings.push(record);
    if (Math.abs(x) < 152 && Math.abs(z) < 152) downtown.push(record);
    return record;
  }
  function putBox(x, y, z, w, h, d, tone, kind, taperDeep, yawRad) { put(city, x, y, z, w, h, d, tone[0], tone[1], tone[2], 1, kind || KIND_PLAIN, 0, 0, taperDeep || 0, yawRad || 0); }
  function toneOf(value) { return [value, value + 0.004, value + 0.012]; }
  function floorTo4(value) { return Math.floor(value / 4) * 4; }
  /* The Relay, on its court at the middle of the city: a stepped dais, and on it two graphite blades leaning in over a slit, each floating
     on a band of light over its socket. Their slit faces are straight and their outer faces lean in, so the slit narrows from 28 at the
     feet to 10 at the flat tips; over the tips floats a capstone, and in the slit's foot a glowing core (both move, so they're rows of
     their own: relayParts). Local +x of a blade is its slit face. Its record is as tall as the beam's capstone rises, so the camera and
     the loops keep clear of it. */
  var RELAY_TONE = [0.6, 0.615, 0.65], COURT_HALF_X = 28, COURT_HALF_Z = 42;
  var LIGHT_TONE = [1.0, 0.5, 0.1];
  function buildRelay() {
    var t = RELAY_TONE, k = 0.92;
    put(city, 0, STREET_Y, 0, COURT_HALF_X * 2 + 0.8, PAVE_H, COURT_HALF_Z * 2 + 0.8, 0.95, 0.955, 0.965, 1, KIND_PAVEMENT);
    put(city, 0, PAVE_H, 0, 54, 1.6, 82, 0.9, 0.905, 0.915, 1, KIND_BANDED, 0, 0.03, 0.02);
    put(city, 0, 1.85, 0, 42, 2.4, 74, 0.93, 0.935, 0.945, 1, KIND_BANDED, 0, 0.06, 0.035);
    put(city, 0, 4.25, 0, 39, 0.14, 3.2, LIGHT_TONE[0], LIGHT_TONE[1], LIGHT_TONE[2], 1, KIND_LIGHT, 0); // the channel under the slit
    for (var side = -1; side <= 1; side += 2) {
      put(city, 0, 4.25, side * 24, 30, 3, 22, t[0] * k, t[1] * k, t[2] * k, 1, KIND_PLAIN, 0, 0.1, 0.1); // the socket
      put(city, 0, 7.25, side * 23, 24, 2, 16, LIGHT_TONE[0], LIGHT_TONE[1], LIGHT_TONE[2], 1, KIND_LIGHT, 0); // the light it floats on
      // The blade: its outer face leans in (a one-sided taper) and the whole blade leans 2.5 degrees into the slit.
      put(city, 0, RELAY_FOOT_Y, side * 19.5, 20, RELAY_TIP_Y - RELAY_FOOT_Y, 26, t[0], t[1], t[2], 1, KIND_RELAY, 0, -0.85, 0.6, -side * Math.PI / 2, -0.044);
    }
    var record = { x: 0, z: 0, w: 28, d: 70, top: CAPSTONE_TOP_Y + CAPSTONE_LIFT_UNITS, isLandmark: true }; // no bays in the landmarks
    allBuildings.push(record); downtown.push(record);
  }
  // The Relay's moving rows, written again each frame: the capstone's two halves (lifted and parted while it fires) and the core.
  var relayParts = group(3), coreTurnRad = 0;
  function updateRelayParts(liftUnits, partUnits) {
    var t = RELAY_TONE;
    relayParts.count = 0;
    for (var side = -1; side <= 1; side += 2) put(relayParts, 0, CAPSTONE_BOTTOM_Y + liftUnits, side * (4.75 + partUnits), 4.5, CAPSTONE_TOP_Y - CAPSTONE_BOTTOM_Y, 9, t[0], t[1], t[2], 1, KIND_RELAY, 0, -0.5, 0.4, -side * Math.PI / 2);
    put(relayParts, 0, CORE_Y + 0.6 * Math.sin(0.8 * clock), 0, 3.2, 16, 3.2, LIGHT_TONE[0], LIGHT_TONE[1], LIGHT_TONE[2], 1, KIND_LIGHT, 0, 0, 0, coreTurnRad);
  }
  /* The pylons: the Relay's children, white, round it in the crown of the city. Each is two shafts either side of a slit of light, with
     the Relay's seam up their ends and a band under their tops, cut together to one slanted top that falls toward the Relay. [x, z,
     height to the top of the cut] */
  var PYLONS = [[7, 91, 112], [63, -63, 100], [-77, 35, 88]];
  // The yaw that turns a row's local -z toward the Relay, along whichever axis is longer (x on a tie).
  function bowYawRad(x, z) { return Math.abs(x) >= Math.abs(z) ? (x > 0 ? -Math.PI / 2 : Math.PI / 2) : (z > 0 ? 0 : Math.PI); }
  function pylonAt(x, z) { for (var i = 0; i < PYLONS.length; i++) if (PYLONS[i][0] === x && PYLONS[i][1] === z) return PYLONS[i]; return null; }
  function buildPylon(p) {
    var x = p[0], z = p[1], h = p[2], yaw = bowYawRad(x, z), tx = Math.cos(yaw), tz = Math.sin(yaw), tone = [0.94, 0.944, 0.952];
    put(city, x, PAVE_H, z, BLOCK + 0.8, 1.5, BLOCK + 0.8, tone[0], tone[1], tone[2], 1, KIND_BANDED);
    for (var side = -1; side <= 1; side += 2) {
      // Each shaft turned so its local +x, where its seam runs, faces the slit; both cuts share one yaw, so the top is one plane.
      put(city, x + side * 2.85 * tx, 1.75, z + side * 2.85 * tz, 4.3, h - 10, 10, tone[0], tone[1], tone[2], 1, KIND_PYLON, 0, 0, 0, side > 0 ? yaw + Math.PI : yaw);
      put(city, x + side * 2.85 * tx, h - 8.25, z + side * 2.85 * tz, 4.3, 10, 10, tone[0], tone[1], tone[2], 1, KIND_PLAIN, 0, 0, -0.95, yaw);
    }
    put(city, x, 1.75, z, 0.5, h - 11.5, 9.6, LIGHT_TONE[0], LIGHT_TONE[1], LIGHT_TONE[2], 1, KIND_LIGHT, 1, 0, 0, yaw);
    var record = { x: x, z: z, w: BLOCK + 0.8, d: BLOCK + 0.8, top: h + 1.75, isLandmark: true };
    allBuildings.push(record); downtown.push(record);
  }
  /* The gates: one astride each arm in the terraces, where it crosses the ring at GATE_RING_UNITS. Two blades whose faces toward the
     Relay lean, a lintel over the arm with the dais' band, and a strip of light up each blade's inner face, so with the band they draw a
     Pi of light; a low plinth beside each blade. The arm runs through between the blades. */
  var GATE_RING_UNITS = 119, GATE_TONE = toneOf(0.92);
  function isGateBlock(x, z) { return (Math.abs(x) === GATE_RING_UNITS && Math.abs(z) === 7) || (Math.abs(z) === GATE_RING_UNITS && Math.abs(x) === 7); }
  function buildGates() {
    var arms = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var k = 0; k < 4; k++) {
      // Along the arm (out from the Relay) and across it.
      var ax = arms[k][0], az = arms[k][1], bx = Math.abs(az), bz = Math.abs(ax), yaw = bowYawRad(ax * GATE_RING_UNITS, az * GATE_RING_UNITS);
      var x0 = ax * GATE_RING_UNITS, z0 = az * GATE_RING_UNITS, x1 = ax * (GATE_RING_UNITS + 1.5), z1 = az * (GATE_RING_UNITS + 1.5);
      for (var side = -1; side <= 1; side += 2) {
        putBox(x0 + side * 3.5 * bx, PAVE_H, z0 + side * 3.5 * bz, 3, 44, 9, GATE_TONE, KIND_PLAIN, -0.3, yaw); // the blade
        put(city, x1 + side * 1.95 * bx, PAVE_H, z1 + side * 1.95 * bz, ax ? 0.5 : 0.3, 32, ax ? 0.3 : 0.5, LIGHT_TONE[0], LIGHT_TONE[1], LIGHT_TONE[2], 1, KIND_LIGHT, 1); // its strip of light
        var plinthX = x0 + side * 8.4 * bx, plinthZ = z0 + side * 8.4 * bz, plinthW = ax ? 9 : 6, plinthD = ax ? 6 : 9;
        putBox(plinthX, PAVE_H, plinthZ, plinthW, 2, plinthD, GATE_TONE);
        addRecord(plinthX, plinthZ, plinthW, plinthD, PAVE_H + 2, GATE_TONE);
      }
      putBox(ax * (GATE_RING_UNITS + 1.3), 32.25, az * (GATE_RING_UNITS + 1.3), ax ? 5.6 : 9.6, 3, ax ? 9.6 : 5.6, GATE_TONE, KIND_BANDED); // the lintel, just inside the leaning blades, sharing no face with them
      addRecord(x0, z0, ax ? 9 : 10, ax ? 10 : 9, 44.25, GATE_TONE).isLandmark = true;
    }
  }
  /* The zones, in square rings round the Relay (d, from its middle to a block's, along the longer axis): the inner terrace of low plinths
     round the court, the crown of the tallest towers, the terraces stepping down, the field and the edge along the coast. The valley runs
     in from the first view along its bearing to the Relay, low plinths walled by a shoulder held under 20, so the first frame sees the
     Relay's feet. In the crown and the terraces a block's height is its ring's envelope, or 0.8 or 0.6 of it, so the steps read. */
  var FIRST_BEARING_RAD = Math.atan2(250, 620), CROWN_ENVELOPES = [72, 64, 58], TERRACE_ENVELOPES = [50, 44, 38, 32], SHOULDER_TOP_UNITS = 28;
  function offFirstBearingRad(x, z) { var off = Math.atan2(z, x) - FIRST_BEARING_RAD; return Math.abs(Math.atan2(Math.sin(off), Math.cos(off))); }
  // A height of the envelope: all of it half the time, 0.8 or 0.6 of it otherwise, in steps of 4.
  function stepHeight(envelope) { var pick = rand(); return floorTo4(envelope * (pick < 0.5 ? 1 : pick < 0.8 ? 0.8 : 0.6)); }
  function pickOf(values, shares) { var pick = rand(), sum = 0; for (var i = 0; i < values.length; i++) { sum += shares[i]; if (pick < sum) return values[i]; } return values[values.length - 1]; }
  /* A plinth: one low box over the block, or two lots (long across the way to the Relay) or four, each its own height (heightOf picks
     one). One whole-block plinth in five has a small step at its corner toward the Relay. */
  function buildPlinth(cx, cz, tone, heightOf, lotCount) {
    var inX = cx > 0 ? -1 : 1, inZ = cz > 0 ? -1 : 1, isRadialX = Math.abs(cx) >= Math.abs(cz);
    if (lotCount === 1) {
      var h = heightOf();
      putBox(cx, PAVE_H, cz, 9, h, 9, tone); addRecord(cx, cz, 9, 9, PAVE_H + h, tone);
      if (rand() < 0.2) { putBox(cx + 2 * inX, PAVE_H + h, cz + 2 * inZ, 5, 2, 5, tone); addRecord(cx + 2 * inX, cz + 2 * inZ, 5, 5, PAVE_H + h + 2, tone); }
      return;
    }
    for (var lot = 0; lot < lotCount; lot++) {
      var lotH = heightOf(), first = lot % 2 ? 2.5 : -2.5, second = lot < 2 ? -2.5 : 2.5, isPair = lotCount === 2;
      var x = isPair ? (isRadialX ? cx + first : cx) : cx + first, z = isPair ? (isRadialX ? cz : cz + first) : cz + second;
      var w = isPair && !isRadialX ? 9 : 4, d = isPair && isRadialX ? 9 : 4;
      putBox(x, PAVE_H, z, w, lotH, d, tone); addRecord(x, z, w, d, PAVE_H + lotH, tone);
    }
  }
  /* A stepped tower: a podium, then up to three sections, each narrower, all flush with the podium's faces toward the Relay, so the tower
     is sheer toward it and steps down away from it. Some end in a wedge whose slope faces the Relay. Its records: the podium, and the
     column of sections at section 1's place and size, as tall as the whole tower (sheerTopUnits: where section 1 ends, for the bays). */
  var SECTION_WIDTHS = [7.2, 5.6, 4.0];
  function buildStepped(cx, cz, envelopeH, podiumH, tone) {
    var inX = cx > 0 ? -1 : 1, inZ = cz > 0 ? -1 : 1, count = envelopeH >= 40 ? 3 : envelopeH >= 24 ? 2 : 1;
    var shares = count === 3 ? [0.55, 0.3, 0.15] : count === 2 ? [0.65, 0.35] : [1];
    putBox(cx, PAVE_H, cz, 9, podiumH, 9, tone); addRecord(cx, cz, 9, 9, PAVE_H + podiumH, tone);
    var y = PAVE_H + podiumH, x = cx, z = cz, size = 9, firstX = cx, firstZ = cz, firstTop = y;
    for (var i = 0; i < count; i++) {
      size = SECTION_WIDTHS[i]; x = cx + inX * (4.5 - size / 2); z = cz + inZ * (4.5 - size / 2);
      var h = Math.max(2, Math.round((envelopeH - podiumH) * shares[i] / 2) * 2);
      putBox(x, y, z, size, h, size, tone); y += h;
      if (i === 0) { firstX = x; firstZ = z; firstTop = y; }
    }
    if (rand() < 0.35) { putBox(x, y, z, size, 0.8 * size, size, tone, KIND_PLAIN, -0.95, bowYawRad(cx, cz)); y += 0.8 * size; }
    addRecord(firstX, firstZ, SECTION_WIDTHS[0], SECTION_WIDTHS[0], y, tone).sheerTopUnits = firstTop;
  }
  // A blade pair: two thin slabs end on to the Relay, one three quarters of the other's height; half are fins, their faces toward the Relay sloped.
  function buildBladePair(cx, cz, envelopeH, tone) {
    var yaw = bowYawRad(cx, cz), tx = Math.cos(yaw), tz = Math.sin(yaw), taperDeep = rand() < 0.5 ? -0.5 : 0, isFirstTall = hashAt(cx, cz, 3) < 0.5;
    var isAcrossZ = Math.abs(tz) > 0.5;
    for (var side = -1; side <= 1; side += 2) {
      var h = (side < 0) === isFirstTall ? envelopeH : floorTo4(0.75 * envelopeH), x = cx + side * 2.5 * tx, z = cz + side * 2.5 * tz;
      putBox(x, PAVE_H, z, 3, h, 9, tone, KIND_PLAIN, taperDeep, yaw);
      addRecord(x, z, isAcrossZ ? 9 : 3, isAcrossZ ? 3 : 9, PAVE_H + h, tone);
    }
  }
  var PLATE_TONE = toneOf(0.9);
  // One column of the land's blocks, from one end of the city to the other.
  function buildLandColumn(gx) {
    for (var gz = 0; gz < LAND; gz++) {
      var cx = (gx - LAND / 2 + 0.5) * C, cz = (gz - LAND / 2 + 0.5) * C;
      var r = Math.hypot(cx, cz), coast = coastAt(cx, cz), d = Math.max(Math.abs(cx), Math.abs(cz));
      if (r > coast) continue;
      landCells.push(gx * LAND + gz);
      put(city, cx, -2.4, cz, C, 2.4, C, STREET_TONE[0], STREET_TONE[1], STREET_TONE[2], 1, KIND_STREET); // the land under the block, its streets on top
      // The court round the Relay is one slab of its own; the pylons and the gates stand alone on their blocks.
      if (Math.abs(cx) < COURT_HALF_X && Math.abs(cz) < COURT_HALF_Z) continue;
      put(city, cx, STREET_Y, cz, BLOCK + 0.8, PAVE_H, BLOCK + 0.8, PLATE_TONE[0], PLATE_TONE[1], PLATE_TONE[2], 1, KIND_PAVEMENT); // the block's plate
      var pylon = pylonAt(cx, cz);
      if (pylon) { buildPylon(pylon); continue; }
      if (isGateBlock(cx, cz)) continue;
      var off = offFirstBearingRad(cx, cz), isValley = r >= 28 && r < 170 && off < 0.14 + 12 / r, isShoulder = !isValley && r < 170 && off < 0.14 + 26 / r;
      var jitter = hashAt(cx, cz, 11) * 2 - 1, lotCount = pickOf([1, 2, 4], [0.55, 0.35, 0.1]);
      if (isValley) {
        var valleyH = r < 70 ? 2 : r < 120 ? 4 : 6;
        buildPlinth(cx, cz, toneOf(d < 56 ? 0.9 : d < 98 ? 0.88 : 0.85), function () { return valleyH; }, lotCount);
      } else if (d < 56) {
        if (rand() < 0.3) continue; // a bare plate
        buildPlinth(cx, cz, toneOf(0.9), function () { return rand() < 0.6 ? 2 : 4; }, lotCount);
      } else if (d < 154) {
        var isCrown = d < 98, envelope = isCrown ? CROWN_ENVELOPES[Math.round((d - 63) / 14)] : TERRACE_ENVELOPES[Math.round((d - 105) / 14)];
        var h = stepHeight(envelope), type = rand(), tone = toneOf((isCrown ? 0.88 : 0.85) + 0.01 * jitter);
        if (isShoulder) h = Math.min(h, SHOULDER_TOP_UNITS);
        if (type < (isCrown ? 0.65 : 0.6)) buildStepped(cx, cz, h, isCrown ? 6 : 4, tone);
        else if (type < (isCrown ? 1 : 0.8)) buildBladePair(cx, cz, h, tone);
        else buildPlinth(cx, cz, tone, function () { return pickOf([2, 4, 6, 8], [0.3, 0.35, 0.25, 0.1]); }, lotCount);
      } else if (coast - r >= 24) {
        buildPlinth(cx, cz, toneOf(0.82 + 0.015 * jitter), function () { return pickOf([2, 4, 6, 8], [0.3, 0.35, 0.25, 0.1]); }, lotCount);
      } else {
        buildPlinth(cx, cz, toneOf(0.84), function () { return rand() < 0.5 ? 2 : 4; }, 2); // the edge: two lots, long along the coast
      }
    }
  }
  /* Bays in the crown's tallest stepped towers (at most BAY_TOWER_LIMIT of them, spread round it): a dark mouth in a white frame, a
     platform out front and a canopy over it, where low flying cars dock. They sit on section 1, under sheerTopUnits, where every face
     goes straight up. */
  var bays = [], bayTowers = [], BAY_TOWER_LIMIT = 10;
  function pickBayTowers() {
    var tall = downtown.filter(function (b) { return b.sheerTopUnits && b.top >= 44; }), every = Math.max(1, Math.ceil(tall.length / BAY_TOWER_LIMIT));
    return tall.filter(function (b, i) { return i % every === 0; }).slice(0, BAY_TOWER_LIMIT);
  }
  function tallestNear(x, z) {
    var top = 0;
    for (var i = 0; i < downtown.length; i++) {
      var b = downtown[i];
      if (Math.abs(x - b.x) < b.w / 2 + 1.5 && Math.abs(z - b.z) < b.d / 2 + 1.5 && b.top > top) top = b.top;
    }
    return top;
  }
  function buildBays(b) {
    var sides = [[1, 0], [-1, 0], [0, 1], [0, -1]], made = 0;
    for (var s = 0; s < 4 && made < 2; s++) {
      var side = sides[(s + Math.floor(rand() * 4)) % 4], nx = side[0], nz = side[1];
      var y = Math.round(b.sheerTopUnits * (0.32 + rand() * 0.4)), along = (rand() - 0.5) * Math.max(0, (nx ? b.d : b.w) - 7.5);
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
      put(city, wx + nx * 0.1, y, wz + nz * 0.1, across[0], 4.5, across[1], b.tone[0] * 0.55, b.tone[1] * 0.55, b.tone[2] * 0.55, 1); // the dark mouth
      var deck = nx ? [5.4, 7.6] : [7.6, 5.4];
      put(city, wx + nx * 2.7, y - 0.6, wz + nz * 2.7, deck[0], 0.6, deck[1], 0.97, 0.975, 0.98, 1);    // the platform
      var lip = nx ? [2.2, 7.8] : [7.8, 2.2];
      put(city, wx + nx * 1.1, y + 5, wz + nz * 1.1, lip[0], 0.45, lip[1], 0.95, 0.955, 0.965, 1);    // the canopy
      bays.push({ x: wx + nx * 2.3, z: wz + nz * 2.3, top: y, out: [nx * 16, nz * 16], faceIn: Math.atan2(-nz, -nx), bay: true,
        w: Math.abs(deck[0]) + 0.4, d: Math.abs(deck[1]) + 0.4, cx: wx + nx * 2.1, cz: wz + nz * 2.1, roof: y + 5.5 });
      made++;
    }
  }
  /* The island's foundation: under every block a slab of land with its streets on top, then two tiers stepping down and out a block at
     a time into the sea, each a ring of blocks round the one above, with a thin line of light along its top edge where it meets the next. */
  var STREET_TONE = [0.74, 0.754, 0.775], TIER_TONES = [[0.86, 0.87, 0.89], [0.8, 0.815, 0.84]], TIER_TOPS = [-1.4, -2.8], landCells = [];
  // Whether a point is on the island or its tiers (block cells of the land and the two rings round it).
  var foundationCells = new Uint8Array(LAND * LAND);
  function isFoundationAt(x, z) { var gx = Math.floor(x / C + LAND / 2), gz = Math.floor(z / C + LAND / 2); return gx >= 0 && gz >= 0 && gx < LAND && gz < LAND && foundationCells[gx * LAND + gz] > 0; }
  function buildFoundation() {
    var taken = new Uint8Array(LAND * LAND), ring = [];
    landCells.forEach(function (cell) { taken[cell] = 1; });
    for (var tier = 0; tier < TIER_TOPS.length; tier++) {
      ring.length = 0;
      for (var gx = 0; gx < LAND; gx++) for (var gz = 0; gz < LAND; gz++) {
        if (taken[gx * LAND + gz]) continue;
        var isNext = false;
        for (var dx = -1; dx <= 1 && !isNext; dx++) for (var dz = -1; dz <= 1 && !isNext; dz++) {
          var nx = gx + dx, nz = gz + dz;
          if (nx >= 0 && nz >= 0 && nx < LAND && nz < LAND && taken[nx * LAND + nz] === tier + 1) isNext = true;
        }
        if (isNext) ring.push(gx * LAND + gz);
      }
      for (var i = 0; i < ring.length; i++) {
        var cell = ring[i], cx = (Math.floor(cell / LAND) - LAND / 2 + 0.5) * C, cz = (cell % LAND - LAND / 2 + 0.5) * C, tone = TIER_TONES[tier];
        taken[cell] = tier + 2;
        put(city, cx, -7, cz, C, 7 + TIER_TOPS[tier], C, tone[0], tone[1], tone[2], 1, KIND_SHORE);
      }
    }
    foundationCells.set(taken);
  }

  /* The city's rows sorted into a 6 by 6 grid of tiles, each with the box round everything in it, so a frame skips the tiles outside
     the camera's view and draws the rest nearest first (what's behind a near tower then costs little). */
  var TILE_COUNT_ACROSS = 6, TILE_WIDTH = 128, TILE_ORIGIN = -384, tiles = [];
  function tileOf(x, z) { var i = Math.floor((x - TILE_ORIGIN) / TILE_WIDTH), j = Math.floor((z - TILE_ORIGIN) / TILE_WIDTH); return Math.max(0, Math.min(TILE_COUNT_ACROSS - 1, i)) * TILE_COUNT_ACROSS + Math.max(0, Math.min(TILE_COUNT_ACROSS - 1, j)); }
  function sortCityIntoTiles() {
    var count = TILE_COUNT_ACROSS * TILE_COUNT_ACROSS, sizes = new Int32Array(count), d = city.data, sorted = new Float32Array(d.length);
    tiles = [];
    for (var t = 0; t < count; t++) tiles.push({ first: 0, count: 0, low: [Infinity, Infinity, Infinity], high: [-Infinity, -Infinity, -Infinity], vao: null });
    for (var row = 0; row < city.count; row++) sizes[tileOf(d[row * STRIDE], d[row * STRIDE + 2])]++;
    for (var first = 0, i = 0; i < count; i++) { tiles[i].first = first; first += sizes[i]; }
    for (var r = 0; r < city.count; r++) {
      var o = r * STRIDE, tile = tiles[tileOf(d[o], d[o + 2])], at = (tile.first + tile.count++) * STRIDE, reach = Math.max(d[o + 3], d[o + 5]) * 0.72;
      sorted.set(d.subarray(o, o + STRIDE), at);
      tile.low[0] = Math.min(tile.low[0], d[o] - reach); tile.low[1] = Math.min(tile.low[1], d[o + 1]); tile.low[2] = Math.min(tile.low[2], d[o + 2] - reach);
      tile.high[0] = Math.max(tile.high[0], d[o] + reach); tile.high[1] = Math.max(tile.high[1], d[o + 1] + d[o + 4]); tile.high[2] = Math.max(tile.high[2], d[o + 2] + reach);
    }
    city.data.set(sorted);
    tiles = tiles.filter(function (tile) { return tile.count > 0; });
  }
  // The camera's six planes from its view and projection (column-major), and whether a box is at least partly inside all of them.
  var viewPlanes = new Float32Array(24);
  function viewPlanesInto(out, m) {
    for (var k = 0; k < 6; k++) { var row = k >> 1, sign = k & 1 ? -1 : 1;
      for (var c = 0; c < 4; c++) out[k * 4 + c] = m[c * 4 + 3] + sign * m[c * 4 + row]; }
    return out;
  }
  function isBoxSeen(low, high, planes) {
    for (var k = 0; k < 6; k++) { var a = planes[k * 4], b = planes[k * 4 + 1], c = planes[k * 4 + 2], e = planes[k * 4 + 3];
      if (a * (a > 0 ? high[0] : low[0]) + b * (b > 0 ? high[1] : low[1]) + c * (c > 0 ? high[2] : low[2]) + e < 0) return false; }
    return true;
  }

  // The city's rows, summed so their order doesn't matter: the same city gives the same number however its rows are sorted.
  function cityChecksum() { var words = new Uint32Array(city.data.buffer), sum = 0;
    for (var row = 0; row < city.count; row++) { var hash = 2166136261; for (var i = 0; i < 10; i++) hash = Math.imul(hash ^ words[row * STRIDE + i], 16777619); sum = (sum + hash) >>> 0; }
    return sum; }

  /* The orange shapes: players and games moving through the city. Plain cubes, seen from afar. */
  var flyers = [], walkers = [];
  // Flyers drift on smooth, slightly wobbling loops around the downtown towers, each loop high enough to clear every roof under it.
  // Roof heights on a one-unit grid over the whole city, each building widened by a small margin.
  var MAP = 720, MAP_HALF = 360, roofMap = new Float32Array(MAP * MAP), roofExact = new Float32Array(MAP * MAP);
  function markRoof(b) {
    var x0 = Math.max(0, Math.floor(b.x - b.w / 2 - 1.5 + MAP_HALF)), x1 = Math.min(MAP - 1, Math.ceil(b.x + b.w / 2 + 1.5 + MAP_HALF));
    var z0 = Math.max(0, Math.floor(b.z - b.d / 2 - 1.5 + MAP_HALF)), z1 = Math.min(MAP - 1, Math.ceil(b.z + b.d / 2 + 1.5 + MAP_HALF));
    for (var ix = x0; ix <= x1; ix++) for (var iz = z0; iz <= z1; iz++) { var i = iz * MAP + ix; if (b.top > roofMap[i]) roofMap[i] = b.top; }
  }
  function markBayRoof(b) {
    for (var ix = Math.floor(b.cx - b.w / 2 - 1 + MAP_HALF); ix <= Math.ceil(b.cx + b.w / 2 + 1 + MAP_HALF); ix++)
      for (var iz = Math.floor(b.cz - b.d / 2 - 1 + MAP_HALF); iz <= Math.ceil(b.cz + b.d / 2 + 1 + MAP_HALF); iz++) {
        var i = iz * MAP + ix; if (i >= 0 && i < roofMap.length && b.roof > roofMap[i]) roofMap[i] = b.roof;
      }
  }
  function markRoofExact(b) {
    for (var ix = Math.ceil(b.x - b.w / 2 + MAP_HALF); ix < b.x + b.w / 2 + MAP_HALF; ix++)
      for (var iz = Math.ceil(b.z - b.d / 2 + MAP_HALF); iz < b.z + b.d / 2 + MAP_HALF; iz++) {
        var i = iz * MAP + ix; if (i >= 0 && i < roofExact.length && b.top > roofExact[i]) roofExact[i] = b.top;
      }
  }
  function heightUnderExact(x, z) {
    var ix = Math.floor(x + MAP_HALF), iz = Math.floor(z + MAP_HALF);
    return ix < 0 || iz < 0 || ix >= MAP || iz >= MAP ? 0 : roofExact[iz * MAP + ix];
  }
  function heightUnder(x, z) {
    var ix = Math.floor(x + MAP_HALF), iz = Math.floor(z + MAP_HALF);
    if (ix < 0 || iz < 0 || ix >= MAP || iz >= MAP) return 0;
    return roofMap[iz * MAP + ix];
  }
  function setInto(out, x, y, z) { out[0] = x; out[1] = y; out[2] = z; return out; }
  function loopPointInto(out, m, theta) {
    var k = 1 + m.wob * Math.sin(3 * theta + m.phase);
    var lx = Math.cos(theta) * m.rx * k, lz = Math.sin(theta) * m.rz * k;
    var c = Math.cos(m.rot), s = Math.sin(m.rot);
    return setInto(out, m.cx + lx * c - lz * s, m.y + m.bob * Math.sin(theta + m.phase) + m.rise * Math.sin(theta * m.riseRate + m.risePhase), m.cz + lx * s + lz * c);
  }
  // Each loop flyer circles close around one downtown tower, at some height on it; a loop is kept only if nothing else is in its way.
  // Half of them spiral, up round the tower over a turn or two and back down; the rest fly rings tipped up on one side, down on the other.
  var towers = [], towerCount = 0, loopCheck = [0, 0, 0];
  function flyerKind(m) {
    var kind = rand();
    if (kind < 0.25) { m.size = 2.8; m.tail = 18; m.speed = 3 + rand() * 1.5; }
    else if (kind < 0.6) { m.size = 1.5; m.tail = 7; m.speed = 6 + rand() * 3; }
    else { m.size = 2.1; m.tail = 13; m.speed = 4 + rand() * 3; }
    m.off = [0, 0, 0]; m.vel = [0, 0, 0]; m.pop = 0; m.at = [0, 0, 0]; m.hits = 0; m.heat = 0; m.grow = 1;
    return m;
  }
  function makeLoop(tw, isSpiral) {
    for (var attempt = 0; attempt < 40; attempt++) {
      var rad = Math.hypot(tw.w, tw.d) / 2 + 2.5 + rand() * 5;
      var m = { loop: true, cx: tw.x, cz: tw.z, rx: rad, rz: rad * (1 + rand() * 0.3), rot: rand() * Math.PI, wob: 0.05,
        phase: rand() * 6.28, theta: rand() * 6.28, sign: rand() < 0.5 ? 1 : -1, y: tw.top * (0.3 + rand() * 0.6),
        bob: isSpiral ? 1 + rand() * 2 : rad * (0.18 + rand() * 0.18), rise: isSpiral ? Math.min(24, tw.top * (0.12 + rand() * 0.14)) : 0,
        riseRate: rand() < 0.5 ? 1 / 2 : 1 / 3, risePhase: rand() * 6.28 };
      // Every turn of it before it repeats: clear of the roofs under it, and never far over its own tower's top.
      var ok = true, sampleCount = Math.round(64 / m.riseRate);
      for (var sIndex = 0; sIndex < sampleCount && ok; sIndex++) {
        var pt = loopPointInto(loopCheck, m, sIndex / 64 * Math.PI * 2);
        if (heightUnder(pt[0], pt[2]) > pt[1] - 2.5 || pt[1] > tw.top + 6) ok = false;
      }
      if (!ok) continue;
      var meanRadius = (m.rx + m.rz) / 2;
      flyerKind(m);
      m.omega = m.speed / meanRadius; m.step = (m.size < 2 ? 1.2 : m.size < 2.5 ? 1.1 : 1.0) / meanRadius;
      return m;
    }
    return null;
  }
  function buildLoops() {
    towers = downtown.filter(function (b) { return b.top > 42; }).sort(function (a, b) { return b.top - a.top; });
    towerCount = Math.min(towers.length, 12);
    for (var f = 0; f < 40 && flyers.length < 10 && towerCount; f++) {
      var loop = makeLoop(towers[f % towerCount], flyers.length % 2 === 1);
      if (loop) flyers.push(loop);
    }
  }
  // Lane flyers run the street canyons in both directions, weaving low between the towers. Each keeps near the buildings around it: never far above the skyline, never in the sky over the low districts, and always clear of what's in the street under it.
  // It swoops, a long slow dive and climb where there's room, and never climbs or falls steeper than LANE_CLIMB_SLOPE: it starts up early
  // where a roof rises ahead.
  var LANE_STEP = 4, LANE_CLIMB_SLOPE = 0.35, laneCheck = [0, 0, 0];
  function laneProfile(m) {
    var n = Math.ceil(m.limit * 2 / LANE_STEP) + 2, want = new Float32Array(n), floor = new Float32Array(n), blur = new Float32Array(n);
    function at(p, along, side) { return m.axis === "x" ? heightUnder(p + along, m.lane + side) : heightUnder(m.lane + side, p + along); }
    function exactAt(p, along, side) { return m.axis === "x" ? heightUnderExact(p + along, m.lane + side) : heightUnderExact(m.lane + side, p + along); }
    for (var i = 0; i < n; i++) {
      var p = -m.limit + i * LANE_STEP, sky = 0, under = 0;
      for (var a = -20; a <= 20; a += 4) for (var c = -28; c <= 28; c += 4) sky = Math.max(sky, at(p, a, c));
      for (var a2 = -4; a2 <= 4; a2 += 2) for (var c2 = -1; c2 <= 1; c2 += 1) under = Math.max(under, exactAt(p, a2, c2));
      floor[i] = Math.max(6, under + 5);
      want[i] = Math.max(floor[i], Math.min(m.y, sky + 9));
    }
    for (var round = 0; round < 3; round++) {
      for (var j = 0; j < n; j++) { var sum = 0, count = 0; for (var o = -5; o <= 5; o++) if (j + o >= 0 && j + o < n) { sum += want[j + o]; count++; } blur[j] = sum / count; }
      for (var k = 0; k < n; k++) want[k] = Math.max(blur[k], floor[k]);
    }
    for (var sw = 0; sw < n; sw++) want[sw] = Math.max(floor[sw], want[sw] + m.swoop * Math.sin((sw * LANE_STEP - m.limit) * m.swoopRate + m.swoopPhase));
    // Each point at least as high as its neighbours less the slope allows, both ways along; then the corners rounded.
    var fall = LANE_CLIMB_SLOPE * LANE_STEP;
    for (var up = 1; up < n; up++) want[up] = Math.max(want[up], want[up - 1] - fall);
    for (var back = n - 2; back >= 0; back--) want[back] = Math.max(want[back], want[back + 1] - fall);
    for (var pass = 0; pass < 2; pass++) {
      for (var r = 0; r < n; r++) blur[r] = (want[Math.max(0, r - 1)] + 2 * want[r] + want[Math.min(n - 1, r + 1)]) / 4;
      for (var q = 0; q < n; q++) want[q] = Math.max(blur[q], floor[q]);
    }
    m.alt = want; m.over = Math.max.apply(null, floor) - m.y;
  }
  function lanePointInto(out, m, p) {
    var f = Math.min(m.alt.length - 1.001, Math.max(0, (p + m.limit) / LANE_STEP)), i = Math.floor(f);
    var y = lerp(m.alt[i], m.alt[i + 1], f - i) + Math.sin(p * 0.02 + m.phase) * 1.5;
    return m.axis === "x" ? setInto(out, p, y, m.lane) : setInto(out, m.lane, y, p);
  }
  // A lane never passes through a bay's platform or canopy where they reach out over a street.
  function laneHitsBay(m) {
    return bays.some(function (b) {
      var across = m.axis === "x" ? Math.abs(m.lane - b.cz) - b.d / 2 : Math.abs(m.lane - b.cx) - b.w / 2;
      if (across > 2) return false;
      var y = lanePointInto(laneCheck, m, m.axis === "x" ? b.cx : b.cz)[1];
      return y > b.top - 3.5 && y < b.roof + 3;
    });
  }
  // One try at a lane: a street, a side and a height, with the profile it would fly. A lane whose street runs into a tower would have
  // to climb right over it, so another is tried, up to thirty times.
  function laneTry() {
    var line = (Math.floor(rand() * 19) - 9) * C, sign = rand() < 0.5 ? 1 : -1;
    var m = { lane: line + sign * 0.7, axis: rand() < 0.5 ? "x" : "z", sign: sign, y: 9 + rand() * 34, phase: rand() * 6.28,
      swoop: 5 + rand() * 7, swoopRate: Math.PI * 2 / (160 + rand() * 100), swoopPhase: rand() * 6.28 };
    m.limit = Math.max(120, coastAt(m.axis === "x" ? 1 : 0, m.axis === "x" ? 0 : 1) - 20);
    laneProfile(m);
    return m;
  }
  function isLaneClear(m) { return m.over < 10 && !laneHitsBay(m); }
  function laneDone(m) {
    m.p = (rand() * 2 - 1) * m.limit;
    flyerKind(m);
    m.speed *= 2.6;
    return m;
  }
  // Only ever a clear lane: with none in thirty tries there's none, and a flyer that broke apart keeps its own.
  function makeLane() { for (var attempt = 0; attempt < 30; attempt++) { var m = laneTry(); if (isLaneClear(m)) return laneDone(m); } return null; }
  var LANE_COUNT = small ? 14 : 20, lanesMade = 0, laneAttempt = 0;
  // One try at the next lane a build step; done once all of them are made or given up on.
  function buildLaneTry() {
    if (lanesMade < LANE_COUNT) {
      var m = laneTry();
      if (isLaneClear(m)) { flyers.push(laneDone(m)); lanesMade++; laneAttempt = 0; } else if (++laneAttempt === 30) { lanesMade++; laneAttempt = 0; }
    }
    return lanesMade >= LANE_COUNT;
  }
  // Low flying cars all over the city: each rests on a roof or in a tower's bay, spools up, lifts off, flies a gentle curve that arcs up
  // over the roofs and down again, flares, hovers and touches down.
  var pads = [], hoppers = [], HISTORY_LENGTH = 14, FLIGHT_SAMPLES = 32, FLIGHT_CLIMB_SLOPE = 0.7, FLIGHT_OVER_UNITS = 16, FLIGHT_LIFT_UNITS = 8;
  function bezierInto(out, a, c, b, t) { var u = 1 - t; out[0] = u * u * a[0] + 2 * u * t * c[0] + t * t * b[0]; out[1] = u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]; return out; }
  function pickPad(from) {
    var list = bays.length && rand() < 0.35 ? bays : pads, to = null;
    for (var tries = 0; tries < 40 && !to; tries++) {
      var c = list[Math.floor(rand() * list.length)], d = Math.hypot(c.x - from.x, c.z - from.z);
      if (c !== from && !c.taken && d > 35 && d < 170) to = c;
    }
    return to || pads[Math.floor(rand() * pads.length)];
  }
  var flightPoint = [0, 0], flightFloor = new Float32Array(FLIGHT_SAMPLES + 1), flightRound = new Float32Array(FLIGHT_SAMPLES + 1);
  function highestUnder(a, c, b) {
    var top = 0;
    for (var i = 0; i <= FLIGHT_SAMPLES; i++) { var q = bezierInto(flightPoint, a, c, b, i / FLIGHT_SAMPLES); top = Math.max(top, heightUnder(q[0], q[1])); }
    return top;
  }
  // A flight's heights along its curve, into alt: an arc from pad to pad, raised where a roof under it needs, never climbing or falling
  // steeper than FLIGHT_CLIMB_SLOPE, its corners rounded. Answers the curve's length.
  function flightHeightsInto(alt, a, c, b, y0, y1) {
    var length = 0, prevX = a[0], prevZ = a[1];
    for (var i = 1; i <= FLIGHT_SAMPLES; i++) { var q = bezierInto(flightPoint, a, c, b, i / FLIGHT_SAMPLES); length += Math.hypot(q[0] - prevX, q[1] - prevZ); prevX = q[0]; prevZ = q[1]; }
    var arc = 3 + 0.08 * length + rand() * 4, fall = FLIGHT_CLIMB_SLOPE * length / FLIGHT_SAMPLES;
    for (var j = 0; j <= FLIGHT_SAMPLES; j++) {
      var u = j / FLIGHT_SAMPLES, p = bezierInto(flightPoint, a, c, b, u);
      flightFloor[j] = heightUnder(p[0], p[1]) + 4;
      alt[j] = Math.max(lerp(y0, y1, u) + arc * Math.sin(Math.PI * u), flightFloor[j]);
    }
    for (var up = 1; up <= FLIGHT_SAMPLES; up++) alt[up] = Math.max(alt[up], alt[up - 1] - fall);
    for (var back = FLIGHT_SAMPLES - 1; back >= 0; back--) alt[back] = Math.max(alt[back], alt[back + 1] - fall);
    for (var r = 1; r < FLIGHT_SAMPLES; r++) flightRound[r] = (alt[r - 1] + 2 * alt[r] + alt[r + 1]) / 4;
    for (var k = 1; k < FLIGHT_SAMPLES; k++) alt[k] = Math.max(flightRound[k], flightFloor[k]);
    return length;
  }
  // A flight: where to, by which curve, and how high along it. The first of up to sixteen whose curve passes no roof more than
  // FLIGHT_OVER_UNITS over its pads, and that lifts off and sets down no more than FLIGHT_LIFT_UNITS straight up or down; with none, the
  // car waits on its pad a little longer. So it never climbs over a tower in its way, nor rises like a lift beside one.
  function planFlight(h) {
    var from = h.pad, alt = h.alt || (h.alt = new Float32Array(FLIGHT_SAMPLES + 1));
    for (var tries = 0; tries < 16; tries++) {
      var to = pickPad(from), a = [from.x + from.out[0], from.z + from.out[1]], b = [to.x + to.out[0], to.z + to.out[1]];
      var dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1, bend = (rand() - 0.5) * 0.7 * len;
      var c = [(a[0] + b[0]) / 2 - dz / len * bend, (a[1] + b[1]) / 2 + dx / len * bend];
      if (highestUnder(a, c, b) - Math.max(from.top, to.top) > FLIGHT_OVER_UNITS) continue;
      var y0 = from.top + 2.5, y1 = to.top + 2.5, length = flightHeightsInto(alt, a, c, b, y0, y1);
      if (alt[0] - y0 > FLIGHT_LIFT_UNITS || alt[FLIGHT_SAMPLES] - y1 > FLIGHT_LIFT_UNITS) continue;
      from.taken = false; to.taken = true;
      h.a = a; h.b = b; h.c = c; h.from = from; h.to = to;
      // The phases of one flight, in seconds.
      h.legs = [0.7, from.bay ? 1.5 : 0.45, Math.max(0.6, (alt[0] - y0) / 12), length / (13 + rand() * 4), Math.max(0.6, (alt[FLIGHT_SAMPLES] - y1) / 11), to.bay ? 1.7 : 0.9, 0.45];
      h.t = 0; h.flying = true; h.leg = 0; h.puffed = false;
      return true;
    }
    return false;
  }
  function flightHeightAt(h, u) { var f = u * FLIGHT_SAMPLES, i = Math.min(FLIGHT_SAMPLES - 1, Math.floor(f)); return lerp(h.alt[i], h.alt[i + 1], f - i); }
  function makeHistory() { var list = []; for (var i = 0; i < HISTORY_LENGTH; i++) list.push([0, 0, 0]); return list; }
  function buildHoppers() {
    pads = allBuildings.filter(function (b) { return b.top > 4 && b.top < 32 && Math.min(b.w, b.d) > 3.5; });
    pads.forEach(function (p) { p.out = [0, 0]; });
    for (var hIndex = 0; hIndex < 26 && pads.length > 2; hIndex++) {
      var startPad = hIndex < Math.min(6, bays.length) ? bays[hIndex] : pads[Math.floor(rand() * pads.length)];
      startPad.taken = true;
      var h = { pad: startPad, size: 2.0 + rand() * 0.4, wait: rand() * 6, flying: false, yaw: startPad.bay ? startPad.faceIn : rand() * 6.28,
        off: [0, 0, 0], vel: [0, 0, 0], pop: 0, at: [0, 0, 0], history: makeHistory(), historyStart: 0, historyCount: 0, historyClock: 0,
        last: [0, 0, 0], hasLast: false, squash: 1, hits: 0, heat: 0, grow: 1 };
      hoppers.push(h);
    }
  }
  // Where a hopper is, how it should face and how it's squashed, for this moment of its flight.
  function hopperPlaceInto(out, h, dt) {
    h.aim = null; h.lean = 0; h.squash = 1;
    var pad = h.flying ? h.from : h.pad;
    if (!h.flying) {
      h.wait -= dt;
      if (h.wait > 0 || !planFlight(h)) { if (h.wait <= 0) h.wait = 1 + rand() * 2; return setInto(out, pad.x, pad.top, pad.z); }
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
        return setInto(out, from.x + Math.sin(k * 70) * 0.06 * k, from.top + smooth(0.5, 1, k) * 0.5, from.z + Math.cos(k * 63) * 0.06 * k);
      case 1: { // leave: straight up off a roof, or backing out of a bay and dropping a little
        var e = smooth(0, 1, k);
        h.squash = 1 + 0.12 * Math.sin(Math.PI * k);
        if (from.bay) { h.lean = -0.12 * Math.sin(Math.PI * k); return setInto(out, lerp(from.x, a[0], e), from.top + 0.5 + Math.sin(Math.PI * k) * -1.2 + e * 2, lerp(from.z, a[1], e)); }
        return setInto(out, from.x, from.top + 0.5 + e * 2, from.z);
      }
      case 2: { // climb: nose high, turning to face where it's going, up to where its arc starts if a roof beside the pad needs it
        var e2 = k * k * (3 - 2 * k);
        h.aim = Math.atan2(h.c[1] - a[1], h.c[0] - a[0]); h.lean = 0.35 * Math.sin(Math.PI * Math.min(1, k * 1.2));
        h.squash = 1 + 0.08 * Math.sin(Math.PI * k);
        return setInto(out, a[0], lerp(from.top + 2.5, h.alt[0], e2), a[1]);
      }
      case 3: { // across: an arc, curving up over the roofs and down again
        var u3 = smooth(0, 1, k), q = bezierInto(flightPoint, a, h.c, b, u3);
        return setInto(out, q[0], flightHeightAt(h, u3), q[1]);
      }
      case 4: { // down: falls quickly then brakes, nose up to flare
        var e4 = 1 - Math.pow(1 - k, 2.4);
        h.lean = 0.3 * smooth(0.45, 1, k); if (to.bay) h.aim = to.faceIn;
        return setInto(out, b[0], lerp(h.alt[FLIGHT_SAMPLES], to.top + 2.5, e4), b[1]);
      }
      case 5: { // in: hovers down onto a roof, or glides into a bay
        var e5 = smooth(0, 1, k), bob = Math.sin(k * Math.PI * 3) * 0.25 * (1 - k);
        if (to.bay) { h.aim = to.faceIn; h.lean = 0.12 * (1 - k); return setInto(out, lerp(b[0], to.x, e5), to.top + 0.6 + (1 - e5) * 1.9 + bob, lerp(b[1], to.z, e5)); }
        return setInto(out, to.x, to.top + 0.6 + (1 - e5) * 1.9 + bob, to.z);
      }
      case 6: { // touchdown: settles with a squash, and the air under it puffs out
        if (h.legStart) h.wantPuff = [to.x, to.top + 0.2, to.z];
        h.squash = 1 - 0.2 * Math.sin(Math.PI * k) * (1 - k * 0.4);
        if (to.bay) h.aim = to.faceIn;
        return setInto(out, to.x, to.top + 0.6 * (1 - smooth(0, 0.6, k)), to.z);
      }
    }
    h.flying = false; h.pad = to; h.wait = 2 + rand() * 5;
    return setInto(out, to.x, to.top, to.z);
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
  function buildWalkers() { for (var k = 0; k < 620; k++) { var walker = makeWalker(); if (walker) walkers.push(walker); } }
  var movers = group(1500), trails = group(2600);
  var ORANGE = [0.97, 0.56, 0.08], HOT = [1.0, 0.86, 0.56];
  function move(m, limit, dt) {
    m.p += m.speed * m.sign * dt;
    if (m.p > limit) m.p = -limit; else if (m.p < -limit) m.p = limit;
  }
  function positionInto(out, m, y) { return m.axis === "x" ? setInto(out, m.p, y, m.lane) : setInto(out, m.lane, y, m.p); }
  var sparks = [], shards = [], flashes = [], gathers = [];
  function turnToward(a, b, k) { var d = ((b - a) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI; return a + d * Math.min(1, k); }
  function headingInto(out, from, to) {
    var dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2], flat = Math.hypot(dx, dz);
    out.yaw = Math.atan2(dz, dx); out.pitch = Math.max(-0.5, Math.min(0.5, Math.atan2(dy, flat))); out.flat = flat; out.length = Math.hypot(flat, dy);
    return out;
  }
  // What a frame works out for the movers goes into these, made once.
  var onPoint = [0, 0, 0], aheadPoint = [0, 0, 0], colour = [0, 0, 0], shake = [0, 0, 0], basePoint = [0, 0, 0];
  var heading = { yaw: 0, pitch: 0, flat: 0, length: 0 }, ribbonHeading = { yaw: 0, pitch: 0, flat: 0, length: 0 }, trailPoints = [];
  for (var trailIndex = 0; trailIndex < 32; trailIndex++) trailPoints.push([0, 0, 0]);
  // A trail is a ribbon of short blocks, each laid along the path from one point to the next and narrowing toward its end.
  // Up close a trail thins, softens and pales into a streak of light, so it never reads as a row of boxes.
  function ribbon(points, count, width, alpha) {
    var eye = seen.isSet ? seen.eye : null;
    for (var j = 1; j < count; j++) {
      var a = points[j], b = points[j - 1], hd = headingInto(ribbonHeading, a, b), keep = 1 - j / count;
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
    if (m.loop) { var fresh = null; for (var i = 0; i < 12 && !fresh; i++) fresh = makeLoop(towers[Math.floor(rand() * towerCount)], m.rise > 0); if (fresh) Object.assign(m, fresh); }
    else if (m.axis && m.limit && !m.hasOwnProperty("hop")) { var lane = makeLane(); if (lane) Object.assign(m, lane); else m.p = (rand() * 2 - 1) * m.limit; }
    else if (m.hop !== undefined) Object.assign(m, makeWalker() || {});
    else if (m.pad) {
      if (m.flying && m.to) m.to.taken = false; else m.pad.taken = false;
      var pad = pickPad(m.pad); pad.taken = true;
      m.pad = pad; m.flying = false; m.wait = 3 + rand() * 4; m.yaw = pad.bay ? pad.faceIn : rand() * 6.28; m.historyCount = 0; m.hasLast = false;
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
  function tintInto(out, m, dt) {
    if (m.lastHit !== undefined && clock - m.lastHit > 5) { m.heat = Math.max(0, m.heat - dt * 0.4); if (!m.heat) m.hits = 0; }
    m.shake = (m.shake || 0) * Math.exp(-dt * 6);
    // The Relay's wave reaching a shape: it flashes hot as the front passes, so the players receive the signal.
    if (relay.waveStrength > 0 && dt > 0 && Math.abs(waveDistanceAt(m.at[0], m.at[2]) - relay.waveFrontUnits) < 6 + 150 * dt) m.signal = 1;
    else if (m.signal) m.signal = Math.max(0, m.signal - dt / 0.4);
    var k = Math.max(m.heat * 0.75, m.grow < 1 ? 1 - smooth(0.5, 1, m.grow) : 0, m.isHovered ? 0.45 : 0, 0.8 * (m.signal || 0));
    return setInto(out, lerp(ORANGE[0], HOT[0], k), lerp(ORANGE[1], HOT[1], k), lerp(ORANGE[2], HOT[2], k));
  }
  function jitterInto(out, m) { var j = (m.shake || 0) * 0.35; return j < 0.01 ? setInto(out, 0, 0, 0) : setInto(out, (rand() - 0.5) * j, (rand() - 0.5) * j, (rand() - 0.5) * j); }
  function settleGone(m, dt) {
    if (!m.gone) return false;
    m.respawn -= dt; if (m.respawn <= 0) respawn(m);
    return m.gone;
  }
  // Where a flyer's trail was, j steps back along its loop or lane.
  function behindInto(out, m, j) { return m.loop ? loopPointInto(out, m, m.theta - m.sign * m.step * 0.7 * j) : lanePointInto(out, m, m.p - m.sign * 0.85 * j); }
  // A hidden flyer (the lowest tier shows half of them) neither moves nor shows.
  // A shape close to the camera draws smaller, so it never fills the screen as a block.
  function nearScale(at) { return seen.isSet ? 0.35 + 0.65 * smooth(14, 70, Math.hypot(at[0] - seen.eye[0], at[1] - seen.eye[1], at[2] - seen.eye[2])) : 1; }
  // Pointed at with a mouse, a shape swells a little and warms.
  function hoverScale(m) { return m.isHovered ? 1.18 : 1; }
  function updateFlyer(m, dt) {
    if (m.isHidden || settleGone(m, dt)) return;
    for (var a = 0; a < 3; a++) { m.vel[a] += (-9 * m.off[a] - 3.2 * m.vel[a]) * dt; m.off[a] += m.vel[a] * dt; }
    m.pop *= Math.exp(-dt * 4);
    var ends = 1;
    if (m.loop) { m.theta += m.omega * m.sign * dt; loopPointInto(onPoint, m, m.theta); loopPointInto(aheadPoint, m, m.theta + m.sign * 0.03); }
    else {
      m.p += m.speed * m.sign * dt;
      if (m.p * m.sign > m.limit) m.p = -m.sign * m.limit;
      lanePointInto(onPoint, m, m.p); lanePointInto(aheadPoint, m, m.p + m.sign * 0.6); ends = smooth(m.limit, m.limit - 30, Math.abs(m.p));
    }
    var hd = headingInto(heading, onPoint, aheadPoint);
    m.spin = (m.spin || 0) * Math.exp(-dt * 2.2);
    var size = m.size * (1 + m.pop * 0.5) * growth(m, dt) * ends, col = tintInto(colour, m, dt), jt = jitterInto(shake, m);
    var at = setInto(m.at, onPoint[0] + m.off[0] + jt[0], onPoint[1] + m.off[1] + jt[1], onPoint[2] + m.off[2] + jt[2]); m.drawYaw = hd.yaw + m.spin;
    if (size < 0.02) return;
    size *= nearScale(at) * hoverScale(m);
    put(movers, at[0], at[1] - size * 0.21, at[2], size * 2.1, size * 0.42, size * 0.72, col[0], col[1], col[2], 1, 0, 0, 0.55, 0.6, hd.yaw + m.spin, hd.pitch + m.spin * 0.4);
    if (m.grow < 1) return;
    var count = Math.round(m.tail * 1.4);
    setInto(trailPoints[0], at[0], at[1], at[2]);
    for (var j = 1; j <= count; j++) {
      var p = behindInto(trailPoints[j], m, j), keep = 1 - j / (count + 1);
      p[0] += m.off[0] * keep; p[1] += m.off[1] * keep; p[2] += m.off[2] * keep;
    }
    ribbon(trailPoints, count + 1, m.size * 0.36 * ends, 0.95);
  }
  function updateHopper(h, dt) {
    if (h.gone) { if (h.flying) { h.t += dt; } if (settleGone(h, dt)) return; }
    for (var a = 0; a < 3; a++) { h.vel[a] += (-9 * h.off[a] - 3.2 * h.vel[a]) * dt; h.off[a] += h.vel[a] * dt; }
    h.pop *= Math.exp(-dt * 4);
    var base = hopperPlaceInto(basePoint, h, dt), g = growth(h, dt), size = h.size * (1 + h.pop * 0.5) * g, col = tintInto(colour, h, dt), jt = jitterInto(shake, h);
    if (h.wantPuff) { puff(h.wantPuff); h.wantPuff = null; }
    var atX = base[0] + h.off[0] + jt[0], atY = base[1] + h.off[1] + jt[1], atZ = base[2] + h.off[2] + jt[2];
    if (h.hasLast && dt > 0) {
      var hd = headingInto(heading, h.last, base), moving = hd.flat / dt > 1.5 && h.leg === 3;
      var want = h.aim !== null && h.aim !== undefined ? h.aim : (moving ? hd.yaw : h.yaw || 0);
      h.yaw = turnToward(h.yaw || 0, want, dt * (h.aim !== null && h.aim !== undefined ? 2.5 : 5));
      var pitchWant = (moving ? hd.pitch : 0) + (h.lean || 0);
      h.pitch = (h.pitch || 0) + (pitchWant - (h.pitch || 0)) * Math.min(1, dt * 4);
    }
    setInto(h.last, base[0], base[1], base[2]); h.hasLast = true;
    h.spin = (h.spin || 0) * Math.exp(-dt * 2.2);
    var sq = h.squash || 1;
    setInto(h.at, atX, atY + size * 0.4, atZ); h.drawYaw = (h.yaw || 0) + h.spin;
    var shown = size * nearScale(h.at) * hoverScale(h);
    if (shown > 0.02) put(movers, atX, atY, atZ, shown * 1.9 / Math.sqrt(sq), shown * 0.5 * sq, shown * 0.8 / Math.sqrt(sq), col[0], col[1], col[2], 1, 0, 0, 0.5, 0.55, h.drawYaw, (h.pitch || 0) + h.spin * 0.4);
    // Where it was, a point every twentieth of a second, newest first: its trail while it flies, shrinking away once it lands.
    h.historyClock += dt;
    if (h.historyClock > 0.05) { h.historyClock = 0; h.historyStart = (h.historyStart + HISTORY_LENGTH - 1) % HISTORY_LENGTH; setInto(h.history[h.historyStart], atX, atY + size * 0.4, atZ); h.historyCount = Math.min(HISTORY_LENGTH, h.historyCount + 1); }
    if (!h.flying || h.leg < 2 || h.leg > 5) { if (h.historyCount > 1) h.historyCount--; return; }
    setInto(trailPoints[0], atX, atY + size * 0.4, atZ);
    for (var i = 0; i < h.historyCount; i++) { var was = h.history[(h.historyStart + i) % HISTORY_LENGTH]; setInto(trailPoints[i + 1], was[0], was[1], was[2]); }
    ribbon(trailPoints, h.historyCount + 1, h.size * 0.34, 0.95);
  }
  function updateWalker(m, dt) {
    move(m, m.limit, dt);
    if (settleGone(m, dt)) return;
    var lift = 0, squash = 1;
    if (m.hop >= 0) {
      m.hop += dt / 0.75;
      if (m.hop >= 1) m.hop = -1; else { lift = 6 * Math.sin(Math.PI * m.hop); squash = 1 + 0.25 * Math.sin(Math.PI * 2 * m.hop); }
    }
    var at = positionInto(onPoint, m, STREET_Y + 0.02 + lift), size = m.size * growth(m, dt), col = tintInto(colour, m, dt), jt = jitterInto(shake, m);
    var yaw = m.axis === "x" ? (m.sign > 0 ? 0 : Math.PI) : (m.sign > 0 ? Math.PI / 2 : -Math.PI / 2);
    var flip = m.hop >= 0 ? -Math.PI * 2 * smooth(0, 1, m.hop) : 0;
    setInto(m.at, at[0], at[1] + size * 0.4, at[2]); m.drawYaw = yaw;
    // The court is the Relay's alone: a walker crossing it goes out of sight until it's across.
    m.isInCourt = Math.abs(at[0]) < COURT_HALF_X + 1 && Math.abs(at[2]) < COURT_HALF_Z + 1;
    size *= nearScale(at) * hoverScale(m);
    if (size > 0.02 && !m.isInCourt) put(movers, at[0] + jt[0], at[1] + Math.abs(jt[1]), at[2] + jt[2], size * 1.15 / Math.sqrt(squash), size * 0.5 * squash, size * 0.7 / Math.sqrt(squash), col[0], col[1], col[2], 1, 0, 0, 0.4, 0.5, yaw, flip);
  }
  // A list of short-lived things with the finished ones taken out, in place.
  function keepLiving(list) { var kept = 0; for (var i = 0; i < list.length; i++) if (list[i].life > 0) list[kept++] = list[i]; list.length = kept; }
  function updateMovers(dt) {
    movers.count = 0; trails.count = 0;
    for (var fi = 0; fi < flyers.length; fi++) updateFlyer(flyers[fi], dt);
    for (var hi = 0; hi < hoppers.length; hi++) updateHopper(hoppers[hi], dt);
    for (var wi = 0; wi < walkers.length; wi++) updateWalker(walkers[wi], dt);
    // Pieces of a broken shape: they fly, tumble, bounce on whatever is under them, and shrink away.
    keepLiving(shards);
    for (var si = 0; si < shards.length; si++) {
      var k = shards[si];
      k.v[1] -= 22 * dt; k.p[0] += k.v[0] * dt; k.p[1] += k.v[1] * dt; k.p[2] += k.v[2] * dt; k.life -= dt / k.span;
      var floor = Math.max(STREET_Y + PAVE_H, heightUnderExact(k.p[0], k.p[2]));
      if (k.p[1] < floor && k.v[1] < 0) {
        if (floor - k.p[1] < 1.5) { k.p[1] = floor; k.v[1] *= -0.38; k.v[0] *= 0.6; k.v[2] *= 0.6; k.spinRate *= 0.6; }
      }
      k.turn += k.spinRate * dt;
      var sz = k.size * Math.min(1, k.life * 3.5), c = k.hot ? HOT : ORANGE;
      if (sz > 0.02) put(movers, k.p[0], k.p[1], k.p[2], sz, sz, sz, c[0], c[1], c[2], 1, 0, 0, 0, 0, k.turn, k.turn * 0.6);
    }
    // Flashes: a bright box that swells and fades as a shape breaks, and flat rings of air.
    keepLiving(flashes);
    for (var xi = 0; xi < flashes.length; xi++) {
      var f = flashes[xi];
      f.life -= dt / f.span;
      var fk = 1 - Math.max(0, f.life), fs = lerp(f.from, f.to, 1 - Math.pow(1 - fk, 3)), fa = f.alpha * Math.max(0, f.life) * Math.max(0, f.life);
      if (f.flat) put(trails, f.p[0], f.p[1], f.p[2], fs, 0.08, fs, f.color[0], f.color[1], f.color[2], fa, 0, 0, 0, 0, Math.PI / 4, 0);
      else put(trails, f.p[0], f.p[1] - fs / 2, f.p[2], fs, fs, fs, f.color[0], f.color[1], f.color[2], fa, 0, 0, 0, 0, fk * 1.5, fk);
    }
    // Respawns: a thin column of light over the spot, and motes spiralling in to where the shape grows.
    keepLiving(gathers);
    for (var gi = 0; gi < gathers.length; gi++) {
      var g = gathers[gi];
      g.life -= dt / g.span;
      var gk = 1 - Math.max(0, g.life), at = g.m.at;
      if (!at || g.m.gone) continue;
      var beam = Math.sin(Math.PI * Math.min(1, gk * 1.1)) * 0.55;
      if (beam > 0.01) put(trails, at[0], at[1], at[2], 0.5 * (1 - gk) + 0.12, 60 * (1 - gk * 0.5), 0.5 * (1 - gk) + 0.12, 1, 0.86, 0.6, beam, 0, 0, 0, 0, gk * 3, 0);
      for (var mi = 0; mi < g.motes.length; mi++) {
        var o = g.motes[mi], e = smooth(0, 0.62, gk), turn = e * 2.4, tc = Math.cos(turn), ts = Math.sin(turn), r = 1 - e;
        var x = (o[0] * tc - o[2] * ts) * r, z = (o[0] * ts + o[2] * tc) * r, y = o[1] * r;
        var ms = o[3] * (0.4 + r) * (1 - smooth(0.55, 0.7, gk));
        if (ms > 0.02) put(trails, at[0] + x, at[1] + y - ms / 2, at[2] + z, ms, ms, ms, 1, 0.74, 0.3, 0.95, 0, 0, 0, 0, turn * 3, turn);
      }
    }
    keepLiving(sparks);
    for (var pi = 0; pi < sparks.length; pi++) {
      var spark = sparks[pi];
      var drag = spark.drag ? Math.exp(-spark.drag * dt) : 1;
      spark.v[0] *= drag; spark.v[2] *= drag; spark.v[1] -= spark.g * dt; spark.p[0] += spark.v[0] * dt; spark.p[1] += spark.v[1] * dt; spark.p[2] += spark.v[2] * dt; spark.life -= dt / spark.span;
      var ps = spark.size * Math.max(0, spark.life);
      spark.turn = (spark.turn || rand() * 6) + dt * 7;
      put(trails, spark.p[0], spark.p[1] - ps / 2, spark.p[2], ps, ps, ps, spark.color[0], spark.color[1], spark.color[2], Math.max(0, spark.life) * 0.9, 0, 0, 0, 0, spark.turn, spark.turn * 0.7);
    }
  }

  /* The Relay fires: an event of EVENT_SEC on the world clock. Light gathers, the blades charge from the dais to the tips, the slit
     floods, a needle leaves the capstone's slot and the column snaps to full width; the release flashes, rings leave the capstone, a
     wave runs out over the city in square steps and on over the sea, and a ring sweeps the sky's ceiling; then the column lets go
     upward and the city settles: a pulse of light sent, about a second at full, never a sustained beam. Starts are FIRE_GAPS_SEC apart
     (cycled), each held for up to FIRE_FRAMING_WAIT_SEC until the capstone will be in the clear part of the frame at its release, and
     never while the camera is on a close pass; a tap on the Relay fires it early. The page opens at rest (OPENING_EVENT_SEC -1) and the
     first firing comes about 2 s after the city shows; a value of 0 or more would open part way into one. relayStateInto() is the
     whole event as a pure function of its seconds. */
  var GATHER_SEC = 2.0, CHARGE_FROM_SEC = 1.2, NEEDLE_AT_SEC = 2.6, BOOM_AT_SEC = 2.8, LET_GO_AT_SEC = 3.9, LET_GO_SEC = 0.8, EVENT_SEC = 8;
  var OPENING_EVENT_SEC = -1, FIRST_FIRE_GAP_SEC = 11, FIRE_GAPS_SEC = [19, 14, 23, 16, 21], FIRE_FRAMING_WAIT_SEC = 4, FIRE_TAP_GAP_SEC = 8, HEAVY_EVENT_SEC = 3.1;
  var eventSec = OPENING_EVENT_SEC >= 0 ? OPENING_EVENT_SEC : -2, isOpeningEvent = OPENING_EVENT_SEC >= 0, nextFireGapSec = OPENING_EVENT_SEC >= 0 ? FIRST_FIRE_GAP_SEC : 0, fireGapIndex = 0;
  // Where the running event started (a tap starts it at its charge, so its gather runs in from there).
  var eventFromSec = 0;
  // The event's seconds held for the tool (beamSec pins them; a held camera holds them where they started), or for the hidden heavy frames.
  var heldEventSec = -1;
  function relayStateInto(out, sec, isOpening) {
    var isOn = sec >= 0 && sec < EVENT_SEC, needle = sec - NEEDLE_AT_SEC, boom = sec - BOOM_AT_SEC, letGo = sec - LET_GO_AT_SEC;
    var held = 1 - smooth(LET_GO_AT_SEC, LET_GO_AT_SEC + LET_GO_SEC, sec), charge = Math.min(1, Math.max(0, (sec - CHARGE_FROM_SEC) / 1.4));
    out.armFrontUnits = lerp(340, 27, smooth(eventFromSec, Math.max(GATHER_SEC, eventFromSec + 1.2), sec));
    out.armStrength = isOn && !isOpening ? smooth(eventFromSec, eventFromSec + 0.3, sec) * (1 - smooth(BOOM_AT_SEC, BOOM_AT_SEC + 0.6, sec)) : 0;
    out.chargeShare = isOn ? smooth(CHARGE_FROM_SEC, NEEDLE_AT_SEC, sec) * held : 0;
    out.chargeHeightUnits = isOn ? RELAY_FOOT_Y + (RELAY_TIP_Y - RELAY_FOOT_Y) * charge * charge : 0;
    out.floodTopUnits = isOn && needle >= 0 ? RELAY_FOOT_Y + (RELAY_TIP_Y - RELAY_FOOT_Y) * Math.min(1, needle / 0.12) : 0;
    out.floodBottomUnits = letGo < 0 ? 0 : RELAY_FOOT_Y + 1800 * letGo * letGo;
    out.capstoneLiftUnits = isOn ? CAPSTONE_LIFT_UNITS * smooth(1.8, NEEDLE_AT_SEC, sec) * held : 0;
    out.capstonePartUnits = 0.3 * out.capstoneLiftUnits;
    out.coreSpinRadPerSec = lerp(0.2, 6, out.chargeShare);
    out.headY = needle < 0 ? CAPSTONE_TOP_Y + out.capstoneLiftUnits : CAPSTONE_TOP_Y + CAPSTONE_LIFT_UNITS + 250 * needle + 2600 * needle * needle;
    out.bottomY = letGo < 0 ? CORE_Y : CORE_Y + 1800 * letGo * letGo;
    out.widthScale = !isOn || needle < 0 ? 0 : boom < 0 ? 0.35 : (0.35 + 0.65 * smooth(0, 0.12, boom)) * (1 + 0.4 * Math.exp(-4 * boom)) *
      (letGo < 0 ? 1 : lerp(1, 0.7, smooth(0, LET_GO_SEC, letGo)));
    out.intensity = !isOn || needle < 0 ? 0 : 1 - smooth(LET_GO_SEC - 1, LET_GO_SEC, letGo);
    out.flash = !isOn || boom < 0 || isOpening ? 0 : Math.exp(-3.2 * boom);
    out.hot = !isOn || boom < 0 || isOpening ? 0 : 1 - smooth(0.1, 0.3, boom);
    out.flare = 0.6 * out.chargeShare + 1.6 * out.flash + 0.35 * out.intensity;
    out.waveFrontUnits = boom < 0 ? -1 : 40 + 260 * boom + 40 * boom * boom;
    out.waveStrength = !isOn || boom < 0 || isOpening ? 0 : Math.exp(-boom / 2.5) * (1 - smooth(EVENT_SEC - 3, EVENT_SEC, sec));
    out.skyRingUnits = boom < 0.3 ? -1 : 1500 * (boom - 0.3);
    out.skyRingStrength = !isOn || boom < 0.3 || isOpening ? 0 : Math.exp(-(boom - 0.3) / 1.5);
    out.threadShare = (1 - out.intensity) * 2 * out.chargeShare; // only while it charges: nothing at rest, gone once the column holds
    out.boomSec = isOn && !isOpening ? boom : -1;
    return out;
  }
  var relay = relayStateInto({ threadStrength: 0 }, -1, false);
  function startEvent(fromSec) { eventSec = fromSec; eventFromSec = fromSec; isOpeningEvent = false; nextFireGapSec = FIRE_GAPS_SEC[fireGapIndex++ % FIRE_GAPS_SEC.length]; }
  // The event's clock: on with the world's, and a start once its gap is up and the shot frames it (or it has waited long enough).
  function advanceEvent(stepSec) {
    if (typeof tool.beamSec === "number" || tool.isHeld) return;
    eventSec += stepSec;
    // Never on the close pass round the crown: from there the column fills the screen and floods the header and the pane.
    if (eventSec >= nextFireGapSec && !isCloseAtFire() && (eventSec >= nextFireGapSec + FIRE_FRAMING_WAIT_SEC || isFramedForFire())) startEvent(0);
  }
  function relayEventSec() { return heldEventSec >= 0 ? heldEventSec : typeof tool.beamSec === "number" ? tool.beamSec : eventSec; }
  function updateRelayState() {
    var isPinned = heldEventSec >= 0 || typeof tool.beamSec === "number";
    relayStateInto(relay, relayEventSec(), !isPinned && isOpeningEvent);
  }
  // Where the capstone will be at the release, against the part of the frame the pane and the header leave clear (clearShare, held
  // with the framing): in it, under the header and in the upper four fifths of it, with the column above it in it too.
  var fireEye = [0, 0, 0], fireTarget = [0, 0, 0], fireView = new Array(16), fireViewProj = new Array(16), fireCapstone = [0, 0, 0], fireAbove = [0, 0, 0];
  var CAPSTONE_POINT = [0, CAPSTONE_TOP_Y, 0], COLUMN_POINT = [0, 400, 0];
  // Whether the camera will be within FIRE_CLOSE_UNITS of the Relay's axis at the release.
  var FIRE_CLOSE_UNITS = 300;
  function isCloseAtFire() { shotInto(fireEye, fireTarget, camTime + BOOM_AT_SEC * paceAt(camTime)); return Math.hypot(fireEye[0], fireEye[2]) < FIRE_CLOSE_UNITS; }
  function isFramedForFire() {
    if (!seen.isSet) return true;
    shotInto(fireEye, fireTarget, camTime + BOOM_AT_SEC * paceAt(camTime));
    lookAtInto(fireView, fireEye, fireTarget); mulInto(fireViewProj, projection, fireView);
    var c = projectInto(fireCapstone, fireViewProj, CAPSTONE_POINT), a = projectInto(fireAbove, fireViewProj, COLUMN_POINT);
    if (c[2] <= 0 || a[2] <= 0) return false;
    var cx = c[0] * 0.5 + 0.5, ax = a[0] * 0.5 + 0.5, cy = 0.5 - c[1] * 0.5, room = clearShare.bottom - clearShare.top;
    return cx > clearShare.left && cx < clearShare.right && ax > clearShare.left && ax < clearShare.right &&
      cy > clearShare.top + 16 / Math.max(1, cssHeight) && cy < clearShare.top + 0.8 * room;
  }
  // The Relay on the screen, for a tap: the line from its foot to its capstone, within reach of it.
  var relayFoot = [0, RELAY_FOOT_Y, 0], footOnScreen = [0, 0, 0], capstoneOnScreen = [0, 0, 0];
  function isRelayAt(clientX, clientY) {
    if (!seen.isSet) return false;
    var b = box(), f = projectInto(footOnScreen, seen.viewProj, relayFoot), t = projectInto(capstoneOnScreen, seen.viewProj, CAPSTONE_POINT);
    if (f[2] <= 0 || t[2] <= 0) return false;
    var fx = b.left + (f[0] * 0.5 + 0.5) * b.width, fy = b.top + (0.5 - f[1] * 0.5) * b.height, dx = (t[0] - f[0]) * 0.5 * b.width, dy = (f[1] - t[1]) * 0.5 * b.height;
    var k = Math.max(0, Math.min(1, ((clientX - fx) * dx + (clientY - fy) * dy) / Math.max(1, dx * dx + dy * dy)));
    return Math.hypot(clientX - fx - dx * k, clientY - fy - dy * k) < 30 * (coarse ? 1.5 : 1);
  }
  // A tap on the Relay with no event running, long enough after the last release, fires it from its charge.
  function tapRelay() { if (typeof tool.beamSec !== "number" && !tool.isHeld && eventSec >= BOOM_AT_SEC + FIRE_TAP_GAP_SEC) startEvent(CHARGE_FROM_SEC); }
  // How far the wave runs to reach a point, as the shaders work it out (WAVE_GLSL).
  function waveDistanceAt(x, z) { var r = Math.hypot(x, z); return lerp(Math.max(Math.abs(x), Math.abs(z)), r, smooth(280, 650, r)); }
  /* The Relay's moving rows for the frame: the capstone lifted and parted, the core turning (fast as it charges), and the square halo
     ring that leaves the capstone at the release, in the trails. */
  function updateRelay(stepSec) {
    var tone = lerp(0.9, 0.5, night) * (1 + 0.2 * Math.sin(2 * Math.PI * clock / 4)) * (1 + 0.15 * Math.sin(2 * Math.PI * 8 * clock) * relay.chargeShare);
    // By day the thread covers the sky almost wholly, or orange over blue would read grey.
    relay.threadStrength = tone * relay.threadShare;
    coreTurnRad = (coreTurnRad + relay.coreSpinRadPerSec * stepSec) % (Math.PI * 2);
    updateRelayParts(relay.capstoneLiftUnits, relay.capstonePartUnits);
    // The wave across the city and the ring in the sky carry the release; there's no ring of its own round the capstone.
  }

  /* Light and its crisp shadow map, drawn once: the city doesn't move. */
  var SUN_AZIMUTH_RAD = Math.atan2(0.36, -0.45), SUN_ELEVATION_RAD = 40 * Math.PI / 180;
  var SUN = [Math.cos(SUN_AZIMUTH_RAD) * Math.cos(SUN_ELEVATION_RAD), Math.sin(SUN_ELEVATION_RAD), Math.sin(SUN_AZIMUTH_RAD) * Math.cos(SUN_ELEVATION_RAD)];
  var SPAN = 360;
  var lightViewProj = mul(ortho(-SPAN, SPAN, -SPAN, SPAN, 1, 1600), lookAt([SUN[0] * 700, SUN[1] * 700, SUN[2] * 700], [0, 0, 0], [0, 1, 0]));

  /* The camera: one seamless cinematic loop of shots, no cuts. In from the sea toward the Relay, under its tips and round it, out low over the water, and a high sweep back round. */
  // The haze: how thick it is at the sea (per unit of distance), and how fast it thins with height (1 / its scale height).
  var FOG_DENSITY_DAY = 0.0015, FOG_DENSITY_NIGHT = 0.0009, FOG_FALLOFF = 1 / 70, fogDensity = FOG_DENSITY_DAY;
  var FOG_DAY = [0.8, 0.84, 0.89], ZENITH_DAY = [0.73, 0.78, 0.85], FOG_NIGHT = [0.07, 0.095, 0.19], ZENITH_NIGHT = [0.012, 0.02, 0.055];
  var FOG = FOG_DAY.slice(), ZENITH = ZENITH_DAY.slice(), FIRE_HAZE_DAY = [1.0, 0.8, 0.62], FIRE_HAZE_NIGHT = [0.42, 0.2, 0.1];
  var nightTarget = isNight() ? 1 : 0, night = nightTarget;
  // The theme can change in place (a setting, or the system's), and the city eases to day or night with it.
  function followTheme() { nightTarget = isNight() ? 1 : 0; }
  new MutationObserver(followTheme).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["data-theme-choice", "data-theme"] });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", followTheme);
  var LOOP_SEC = 112;
  /* [seconds, eye, looking at]: in from the sea 22 degrees off the slit's plane (the slit open, only the Relay over the horizon), in over
     the approach looking up, under the tips (the gap and the floating capstone), round its side, a close pass, the look up low over the
     water, face on through the slit, and a high sweep home. */
  var SHOTS = [];
  function frameShots() {
    SHOTS = [
      [0, [620, 140, 250], [0, 70, 0]],
      [14, [470, 120, 400], [0, 60, 0]],
      [28, [190, 170, 440], [0, 80, 0]],
      [42, [-250, 200, 380], [0, 70, 0]],
      [56, [-470, 90, 110], [0, 60, 0]],
      [70, [-420, 55, -280], [-30, 45, 0]],
      [84, [-120, 270, -500], [0, 30, 0]],
      [98, [380, 190, -360], [0, 55, 0]]
    ];
  }
  function catmullInto(out, p0, p1, p2, p3, t) {
    var t2 = t * t, t3 = t2 * t;
    for (var i = 0; i < 3; i++) out[i] = 0.5 * (2 * p1[i] + (p2[i] - p0[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (3 * p1[i] - p0[i] - 3 * p2[i] + p3[i]) * t3);
    return out;
  }
  function rawShotInto(eye, target, time) {
    var t = ((time % LOOP_SEC) + LOOP_SEC) % LOOP_SEC, n = SHOTS.length, i = n - 1;
    for (var j = 0; j < n; j++) if (SHOTS[j][0] <= t) i = j;
    var end = i + 1 < n ? SHOTS[i + 1][0] : LOOP_SEC, k = (t - SHOTS[i][0]) / (end - SHOTS[i][0]);
    var before = SHOTS[((i - 1) % n + n) % n], from = SHOTS[i % n], to = SHOTS[(i + 1) % n], after = SHOTS[(i + 2) % n];
    catmullInto(eye, before[1], from[1], to[1], after[1], k);
    catmullInto(target, before[2], from[2], to[2], after[2], k);
  }
  // Keep clear of the city: wherever the path comes too close to a roof or a wall, the whole view lifts, early and smoothly.
  function clearance(x, z) {
    var top = 0;
    for (var dx = -8; dx <= 8; dx += 2) for (var dz = -8; dz <= 8; dz += 2) top = Math.max(top, heightUnder(x + dx, z + dz));
    return top;
  }
  var LIFT_STEPS = 1400, PATH_ITEM = 50, lift = new Float32Array(LIFT_STEPS), liftNeed = new Float32Array(LIFT_STEPS), liftWide = new Float32Array(LIFT_STEPS);
  var pathEye = [0, 0, 0], pathTarget = [0, 0, 0];
  function buildLiftNeed(item) {
    for (var i = item * PATH_ITEM; i < Math.min(LIFT_STEPS, (item + 1) * PATH_ITEM); i++) { rawShotInto(pathEye, pathTarget, i / LIFT_STEPS * LOOP_SEC); var e = pathEye; liftNeed[i] = Math.max(0, Math.max(clearance(e[0], e[2]) + 7, WATER_Y + 7) - e[1]); }
  }
  function buildLiftWide(half) {
    for (var a = half * LIFT_STEPS / 2; a < (half + 1) * LIFT_STEPS / 2; a++) { var m = 0; for (var o = -30; o <= 30; o++) m = Math.max(m, liftNeed[(a + o + LIFT_STEPS) % LIFT_STEPS]); liftWide[a] = m; }
  }
  function buildLiftRound() {
    for (var b = 0; b < LIFT_STEPS; b++) { var sum = 0; for (var q = -14; q <= 14; q++) sum += liftWide[(b + q + LIFT_STEPS) % LIFT_STEPS]; lift[b] = sum / 29; }
    for (var c = 0; c < LIFT_STEPS; c++) liftWide[c] = Math.max(lift[c], liftNeed[c]);
  }
  // Close to the buildings the camera hurries on; out over the sea and high above the city it takes its time.
  var hurry = new Float32Array(LIFT_STEPS), hurryRaw = new Float32Array(LIFT_STEPS);
  function buildHurry(item) {
    for (var i = item * PATH_ITEM; i < Math.min(LIFT_STEPS, (item + 1) * PATH_ITEM); i++) {
      rawShotInto(pathEye, pathTarget, i / LIFT_STEPS * LOOP_SEC);
      var e = pathEye, y = e[1] + lift[i], near = 1e9;
      for (var dx = -90; dx <= 90; dx += 10) for (var dz = -90; dz <= 90; dz += 10) {
        var h = heightUnder(e[0] + dx, e[2] + dz); if (h < STREET_Y + 3) continue;
        near = Math.min(near, Math.hypot(dx, dz, Math.max(0, y - h)));
      }
      hurryRaw[i] = 1 + 1.3 * smooth(100, 25, near);
    }
  }
  function buildHurryRound() {
    for (var b = 0; b < LIFT_STEPS; b++) { var sum = 0; for (var q = -25; q <= 25; q++) sum += hurryRaw[(b + q + LIFT_STEPS) % LIFT_STEPS]; hurry[b] = sum / 51; }
    hurryRaw.set(hurry);
  }
  function paceAt(time) {
    var f = ((time % LOOP_SEC + LOOP_SEC) % LOOP_SEC) / LOOP_SEC * LIFT_STEPS, i = Math.floor(f) % LIFT_STEPS;
    return lerp(hurry[i], hurry[(i + 1) % LIFT_STEPS], f - Math.floor(f));
  }
  function shotInto(eye, target, time) {
    rawShotInto(eye, target, time);
    var f = ((time % LOOP_SEC + LOOP_SEC) % LOOP_SEC) / LOOP_SEC * LIFT_STEPS;
    var i = Math.floor(f) % LIFT_STEPS, up = lerp(lift[i], lift[(i + 1) % LIFT_STEPS], f - Math.floor(f));
    eye[1] += up; target[1] += up;
  }

  // Whether the live city is showing now, whether it ever has, and when it first did (the camera sets off from then).
  var clock = 40, camTime = tool.startSec || 0, isShown = false, hasShown = false, shownAt = 0;
  var ripples = [], rippleData = new Float32Array(48);
  // The camera of the frame last drawn: where it is and how it looks, for the taps and the trails to use. Made once, written each frame.
  var seen = { isSet: false, viewProj: new Array(16), eye: [0, 0, 0], fwd: [0, 0, 0], right: [0, 0, 0], up: [0, 0, 0], tan: [0, 0], shift: [0, 0] };
  var viewEye = [0, 0, 0], viewTarget = [0, 0, 0], projection = new Array(16), viewMatrix = new Array(16), pickPoint = [0, 0, 0];
  /* Small things to play with: tap a flying car to knock it off course, an orange block on the street to make it hop, the sea to send out a ripple. Tap any of them enough and it breaks. */
  function pick(clientX, clientY) {
    if (!seen.isSet) return null;
    var best = null, bestDistance = Infinity, b = box();
    function consider(m, radius) {
      var q = projectInto(pickPoint, seen.viewProj, m.at);
      if (q[2] <= 0) return;
      var sx = b.left + (q[0] * 0.5 + 0.5) * b.width, sy = b.top + (0.5 - q[1] * 0.5) * b.height;
      var d = Math.hypot(sx - clientX, sy - clientY);
      if (d < radius && d < bestDistance) { best = m; bestDistance = d; }
    }
    var reach = coarse ? 1.5 : 1;
    flyers.forEach(function (m) { if (!m.gone && !m.isHidden && m.grow >= 1) consider(m, 30 * reach); });
    hoppers.forEach(function (m) { if (!m.gone && m.grow >= 1) consider(m, 26 * reach); });
    walkers.forEach(function (m) { if (!m.gone && m.grow >= 1 && !m.isInCourt) consider(m, 18 * reach); });
    return best;
  }
  function seaPoint(clientX, clientY) {
    if (!seen.isSet) return null;
    var b = box(), nx = (clientX - b.left) / b.width * 2 - 1 - seen.shift[0], ny = 1 - (clientY - b.top) / b.height * 2 - seen.shift[1];
    var dir = norm([seen.fwd[0] + seen.right[0] * nx * seen.tan[0] + seen.up[0] * ny * seen.tan[1],
      seen.fwd[1] + seen.right[1] * nx * seen.tan[0] + seen.up[1] * ny * seen.tan[1],
      seen.fwd[2] + seen.right[2] * nx * seen.tan[0] + seen.up[2] * ny * seen.tan[1]]);
    if (dir[1] >= -0.01) return null;
    var t = (WATER_Y - seen.eye[1]) / dir[1];
    if (t > 4000) return null;
    var x = seen.eye[0] + dir[0] * t, z = seen.eye[2] + dir[2] * t;
    return isFoundationAt(x, z) ? null : [x, z]; // the sea, not the foundation's tiers
  }
  function play(clientX, clientY) {
    if (!isShown) return;
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
    } else if (isRelayAt(clientX, clientY)) {
      tapRelay();
    } else {
      var at = seaPoint(clientX, clientY);
      if (at) {
        var scale = Math.max(1, Math.hypot(at[0] - seen.eye[0], WATER_Y - seen.eye[1], at[1] - seen.eye[2]) / 110);
        ripples.push({ x: at[0], z: at[1], start: clock, w: scale }); if (ripples.length > 4) ripples.shift(); // at most four at once
        // A flat square flash of light on the water where it landed; the sea's own ring runs out along the grid from it.
        flashes.push({ p: [at[0], WATER_Y + 0.15, at[1]], life: 1, span: 0.5, from: 0.6 * scale, to: 4 * scale, color: [0.86, 0.97, 1], flat: true, alpha: 0.4 });
      }
    }
  }

  // The world's build, in its exact order (the seeded random is drawn in that order, so the city comes out the same): the sea, the land
  // and its buildings, the towers' bays, the roof maps, the loops, the lanes, the pads and their cars, the walkers, and the camera's path.
  // Each step is called until it says it's done, doing one small item a call.
  function once(work) { return function () { work(); return true; }; }
  function each(count, work) {
    var done = 0, total = -1;
    return function () { if (total < 0) total = typeof count === "function" ? count() : count; if (done < total) work(done++); return done >= total; };
  }
  var BUILD_STEPS = [
    once(buildSea),
    each(LAND, buildLandColumn),
    once(buildRelay),
    once(buildFoundation),
    once(buildGates),
    each(function () { bayTowers = pickBayTowers(); return bayTowers.length; }, function (i) { buildBays(bayTowers[i]); }),
    once(sortCityIntoTiles),
    each(function () { return Math.ceil(allBuildings.length / 400); }, function (item) { for (var i = item * 400; i < Math.min(allBuildings.length, (item + 1) * 400); i++) markRoof(allBuildings[i]); }),
    once(function () { bays.forEach(markBayRoof); }),
    each(function () { return Math.ceil(allBuildings.length / 400); }, function (item) { for (var i = item * 400; i < Math.min(allBuildings.length, (item + 1) * 400); i++) markRoofExact(allBuildings[i]); }),
    once(buildLoops),
    buildLaneTry,
    once(buildHoppers),
    once(buildWalkers),
    once(frameShots),
    each(Math.ceil(LIFT_STEPS / PATH_ITEM), buildLiftNeed),
    each(2, buildLiftWide),
    each(3, buildLiftRound),
    once(function () { lift.set(liftWide); }),
    each(Math.ceil(LIFT_STEPS / PATH_ITEM), buildHurry),
    each(3, buildHurryRound)
  ];
  // Small slices between frames: an idle callback's own time where there is one, otherwise SLICE_MS at a time.
  var SLICE_MS = 8;
  function later(work) { if (window.requestIdleCallback) requestIdleCallback(guarded(work), { timeout: 300 }); else setTimeout(guarded(work), 0); }
  function buildWorld(done) {
    var stepIndex = 0;
    function work(deadline) {
      var startMs = performance.now(), isIdle = deadline && !deadline.didTimeout;
      while (stepIndex < BUILD_STEPS.length) {
        if (BUILD_STEPS[stepIndex]()) stepIndex++;
        if (isIdle ? deadline.timeRemaining() < 1 : performance.now() - startMs >= SLICE_MS) break;
      }
      if (stepIndex < BUILD_STEPS.length) later(work); else done();
    }
    later(work);
  }
  // Several cities on one page (Screens shows four) build one after another, under one lock, instead of all at once.
  var releaseBuildLock = null;
  function whenFree(build, done) {
    function run(release) { releaseBuildLock = release; build(function () { freeBuildLock(); done(); }); }
    try {
      if (navigator.locks && navigator.locks.request) {
        navigator.locks.request("zaisma-city-build", function () { return new Promise(function (release) { guarded(run)(release); }); }).catch(function () {});
        return;
      }
    } catch (error) {}
    run(null);
  }
  function freeBuildLock() { var release = releaseBuildLock; releaseBuildLock = null; if (release) release(); }

  // The world's step: its clock, the theme's ease, everything that moves, the camera along its loop and the sea's rings.
  function advance(stepSec, easeSec, now) {
    clock += stepSec;
    night += (nightTarget - night) * Math.min(1, easeSec * 1.6); if (Math.abs(nightTarget - night) < 0.002) night = nightTarget;
    advanceEvent(stepSec); updateRelayState();
    // The Relay's release warms the haze for a moment, and its column a little while it holds (less while typing on a touch screen).
    var fireTint = (0.6 * relay.flash + 0.15 * relay.intensity) * lerp(0.35, 0.5, night) * calmShare();
    for (var ci = 0; ci < 3; ci++) {
      var warm = lerp(FIRE_HAZE_DAY[ci], FIRE_HAZE_NIGHT[ci], night);
      FOG[ci] = lerp(lerp(FOG_DAY[ci], FOG_NIGHT[ci], night), warm, fireTint); ZENITH[ci] = lerp(lerp(ZENITH_DAY[ci], ZENITH_NIGHT[ci], night), warm, 0.3 * fireTint);
    }
    fogDensity = lerp(FOG_DENSITY_DAY, FOG_DENSITY_NIGHT, night);
    updateMovers(stepSec);
    updateRelay(stepSec);
    // The camera sets off gently once it's shown, over the entrance's second and a half, rather than at full pace from a standstill.
    var setOff = isShown ? Math.min(1, (now - shownAt) / 1500) : 0;
    if (!tool.isHeld) camTime += stepSec * paceAt(camTime) * setOff * setOff * (3 - 2 * setOff);
    var kept = 0;
    for (var i = 0; i < ripples.length; i++) if (clock - ripples[i].start < 3.5) ripples[kept++] = ripples[i];
    ripples.length = kept;
    for (var ri = 0; ri < 12; ri++) {
      var rp = ri < ripples.length ? ripples[ri] : null;
      rippleData[ri * 4] = rp ? rp.x : 0; rippleData[ri * 4 + 1] = rp ? rp.z : 0; rippleData[ri * 4 + 2] = rp ? clock - rp.start : 0; rippleData[ri * 4 + 3] = rp ? rp.w : 0;
    }
  }
  // The camera for a frame drawn width by height at camera time: the view, and what the taps and trails need of it.
  function aimCamera(time, easeSec) {
    shotInto(viewEye, viewTarget, time);
    var shiftAim = shiftTarget();
    shift[0] += (shiftAim[0] - shift[0]) * Math.min(1, easeSec * 2.5); shift[1] += (shiftAim[1] - shift[1]) * Math.min(1, easeSec * 2.5);
    var aspect = width / height, fov = small ? 0.95 : 0.72;
    perspectiveInto(projection, fov, aspect, 4, 9000);
    projection[8] -= shift[0]; projection[9] -= shift[1];
    lookAtInto(viewMatrix, viewEye, viewTarget);
    mulInto(seen.viewProj, projection, viewMatrix);
    normInto(seen.fwd, subInto(seen.fwd, viewTarget, viewEye)); normInto(seen.right, crossInto(seen.right, seen.fwd, UP)); crossInto(seen.up, seen.right, seen.fwd);
    setInto(seen.eye, viewEye[0], viewEye[1], viewEye[2]);
    seen.tan[0] = Math.tan(fov / 2) * aspect; seen.tan[1] = Math.tan(fov / 2); seen.shift[0] = shift[0]; seen.shift[1] = shift[1]; seen.aspect = aspect;
    seen.isSet = true;
  }
  /* The drawing: the programs and everything the GPU holds, made from the world and dropped with their context. */
  var gl = null, gpu = null, targets = null, SHADOW_UNIT = 5;
  // The canvas's box in CSS pixels, the canvas and its targets in pixels (the top tier's), and the part of them the tier draws.
  var cssWidth = 0, cssHeight = 0, width = 0, height = 0, drawWidth = 0, drawHeight = 0, sharpen = 0;
  function compileShader(type, source) { var s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s); return s; }
  // A program handed to the driver to link with nothing asked of it yet, so a driver that compiles in the background
  // (KHR_parallel_shader_compile) does it while the city is built; it's finished (its link checked, its uniforms found) once it's ready.
  function program(vertex, fragment, uniformNames, samplerUnits) {
    var p = gl.createProgram(); gl.attachShader(p, vertex); gl.attachShader(p, fragment); gl.linkProgram(p);
    var made = { program: p, vertex: vertex, fragment: fragment, uniformNames: uniformNames, samplerUnits: samplerUnits || {}, at: {}, isFinished: false };
    gpu.programs.push(made);
    return made;
  }
  function finishProgram(made) {
    if (!gl.getProgramParameter(made.program, gl.LINK_STATUS)) {
      console.warn("The city's program didn't link: " + gl.getProgramInfoLog(made.program) + " " + gl.getShaderInfoLog(made.vertex) + " " + gl.getShaderInfoLog(made.fragment));
      throw new Error("The city's program didn't link.");
    }
    gl.useProgram(made.program);
    for (var i = 0; i < made.uniformNames.length; i++) made.at[made.uniformNames[i]] = gl.getUniformLocation(made.program, made.uniformNames[i]);
    // Each sampler reads one texture unit for good: the shadow map's own, and the first five for the passes after the scene.
    for (var name in made.samplerUnits) gl.uniform1i(made.at[name], made.samplerUnits[name]);
    made.isFinished = true;
  }
  // With the extension, every program the driver has ready; without it, one a tick once the world is built (asking blocks until it's linked).
  function finishPrograms() {
    for (var i = 0; i < gpu.programs.length; i++) {
      var made = gpu.programs[i];
      if (made.isFinished) continue;
      if (!gpu.parallel) { if (!isWorldBuilt) return false; finishProgram(made); return true; }
      if (gl.getProgramParameter(made.program, gpu.parallel.COMPLETION_STATUS_KHR)) finishProgram(made);
    }
    return false;
  }
  function areProgramsFinished() { for (var i = 0; i < gpu.programs.length; i++) if (!gpu.programs[i].isFinished) return false; return true; }
  function instanceBuffer(capacity, usage) { var buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, capacity * STRIDE * 4, usage); return buffer; }
  function instanceVao(buffer, firstRow) {
    var vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.cubeBuffer);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    var sizes = [3, 3, 4, 4, 2], at = 0;
    for (var i = 0; i < 5; i++) {
      gl.enableVertexAttribArray(2 + i);
      gl.vertexAttribPointer(2 + i, sizes[i], gl.FLOAT, false, STRIDE * 4, ((firstRow || 0) * STRIDE + at) * 4);
      gl.vertexAttribDivisor(2 + i, 1);
      at += sizes[i];
    }
    gl.bindVertexArray(null);
    return vao;
  }
  // A group written each frame takes turns among three buffers, so a frame never writes into one the GPU may still be reading.
  function ring(capacity) {
    var made = { buffers: [], vaos: [], at: 0 };
    for (var i = 0; i < 3; i++) { made.buffers.push(instanceBuffer(capacity, gl.DYNAMIC_DRAW)); made.vaos.push(instanceVao(made.buffers[i])); }
    return made;
  }
  function uploadRing(made, rows) {
    made.at = (made.at + 1) % made.buffers.length;
    if (!rows.count) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, made.buffers[made.at]); gl.bufferSubData(gl.ARRAY_BUFFER, 0, rows.data, 0, rows.count * STRIDE);
  }
  function makeGpu() {
    gpu = { programs: [], parallel: gl.getExtension("KHR_parallel_shader_compile"), warmed: [], warmedCount: 0, warmFence: null, isFilled: false,
      maxSampleCount: gl.getParameter(gl.MAX_SAMPLES), timer: window.__city ? null : gl.getExtension("EXT_disjoint_timer_query_webgl2"), timings: [] };
    var vs = gl.VERTEX_SHADER, fs = gl.FRAGMENT_SHADER, full = compileShader(vs, FULL_VS);
    gpu.box = program(compileShader(vs, BOX_VS), compileShader(fs, BOX_FS), ["uViewProj", "uLightViewProj", "uShadow", "uSun", "uCam", "uFog", "uFogDensity", "uFogFalloff", "uLit", "uOpaque", "uEdge", "uNight", "uPulse", "uRelay", "uRelayGlow", "uWave", "uBeamLight"], { uShadow: SHADOW_UNIT });
    gpu.depth = program(compileShader(vs, DEPTH_VS), compileShader(fs, DEPTH_FS), ["uLightViewProj"]);
    gpu.sky = program(full, compileShader(fs, SKY_FS), ["uFwd", "uRight", "uUp", "uTan", "uShift", "uHorizon", "uZenith", "uSun", "uNight", "uTime", "uEye", "uBeamSky", "uSkyRing"]);
    gpu.water = program(compileShader(vs, WATER_VS), compileShader(fs, WATER_FS), ["uViewProj", "uY", "uCam", "uSun", "uHorizon", "uZenith", "uTime", "uRipples", "uRippleCount", "uNight", "uFog", "uFogDensity", "uFogFalloff", "uWave", "uBeamReflect"]);
    gpu.beam = program(compileShader(vs, BEAM_VS), compileShader(fs, BEAM_FS), ["uViewProj", "uCam", "uNight", "uFog", "uFogDensity", "uFogFalloff", "uBeamQuad", "uBeamColumn", "uBeamLook", "uThread"]);
    gpu.copy = program(full, compileShader(fs, COPY_FS), ["uTex"], { uTex: 0 });
    gpu.bright = program(full, compileShader(fs, BRIGHT_FS), ["uTex", "uThreshold", "uOrangeBoost"], { uTex: 0 });
    gpu.blur = program(full, compileShader(fs, BLUR_FS), ["uTex", "uStep"], { uTex: 0 });
    gpu.composite = program(full, compileShader(fs, COMPOSITE_FS), ["uScene", "uSoft", "uBloom", "uFocusY", "uBloomStrength", "uAspect", "uSharpen", "uFlash", "uFlareUv", "uFlareStrength", "uGradeNight"], { uScene: 0, uSoft: 1, uBloom: 2 });
    gpu.cubeBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, gpu.cubeBuffer); gl.bufferData(gl.ARRAY_BUFFER, cube, gl.STATIC_DRAW);
    gpu.waterVao = gl.createVertexArray(); gl.bindVertexArray(gpu.waterVao);
    gpu.waterBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, gpu.waterBuffer); gl.bufferData(gl.ARRAY_BUFFER, seaVertices.byteLength, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 12, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 12, 8);
    gl.bindVertexArray(null);
    gpu.cityBuffer = instanceBuffer(city.capacity, gl.STATIC_DRAW); gpu.cityVao = instanceVao(gpu.cityBuffer);
    gpu.movers = ring(movers.capacity); gpu.trails = ring(trails.capacity); gpu.relay = ring(relayParts.capacity);
    // The shadow map, on its own texture unit for the context's life: smaller on a phone and where the city is shown small (Screens).
    gpu.shadowSize = Math.min(small || shownScale < 0.6 ? 2048 : 4096, gl.getParameter(gl.MAX_TEXTURE_SIZE));
    gl.activeTexture(gl.TEXTURE0 + SHADOW_UNIT);
    gpu.shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, gpu.shadowTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT16, gpu.shadowSize, gpu.shadowSize);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    gl.activeTexture(gl.TEXTURE0);
    gpu.shadowFb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, gpu.shadowFb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, gpu.shadowTex, 0);
    gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (gpu.timer) for (var i = 0; i < 4; i++) gpu.timings.push({ query: gl.createQuery(), tierIndex: 0, heavyIndex: -1, isPending: false });
    targets = null; cssWidth = 0; cssHeight = 0;
    resize();
  }
  // The built world into the GPU: the sea, the city's rows and its shadow map (whose framebuffer is then let go), then a fence, so the
  // hidden frames that follow time only themselves.
  function fillGpu() {
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.waterBuffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, seaVertices);
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.cityBuffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, city.data, 0, city.count * STRIDE);
    gpu.tileVaos = tiles.map(function (tile) { return instanceVao(gpu.cityBuffer, tile.first); });
    gl.bindFramebuffer(gl.FRAMEBUFFER, gpu.shadowFb);
    gl.viewport(0, 0, gpu.shadowSize, gpu.shadowSize);
    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(gpu.depth.program);
    gl.uniformMatrix4fv(gpu.depth.at.uLightViewProj, false, lightViewProj);
    gl.bindVertexArray(gpu.cityVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, BOX_TOP_COUNT, city.count);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.DEPTH_TEST);
    gl.deleteFramebuffer(gpu.shadowFb); gpu.shadowFb = null;
    gpu.isFilled = true; markReady("filled");
    gpu.warmFence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
  }

  /* Render targets, sized for this screen's top tier: the scene with anti-aliasing (4 samples, or 2 on the plainer tiers, each set made
     when it's first needed), resolved into a texture, then half and quarter size copies for the soft focus and the bloom. A lower tier
     draws into the bottom-left of them and is stretched back to the full size before the passes after the scene, so a change of tier
     makes nothing new (bar a sample count's first use) and the canvas keeps its size. */
  function colorTexture(w, h) {
    gl.activeTexture(gl.TEXTURE0);
    var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex: t, fb: fb, w: w, h: h };
  }
  function freeColor(made) { gl.deleteTexture(made.tex); gl.deleteFramebuffer(made.fb); }
  function freeMultisample(made) { gl.deleteRenderbuffer(made.color); gl.deleteRenderbuffer(made.depth); gl.deleteFramebuffer(made.fb); }
  function freeTargets() {
    if (!targets) return;
    for (var count in targets.multisampled) freeMultisample(targets.multisampled[count]);
    [targets.scene, targets.halfA, targets.halfB, targets.quarterA, targets.quarterB].forEach(freeColor);
    if (targets.upscaled) freeColor(targets.upscaled);
    targets = null;
  }
  function makeTargets(w, h) {
    freeTargets();
    var hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1), qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2);
    targets = { w: w, h: h, multisampled: {}, upscaled: null, scene: colorTexture(w, h),
      halfA: colorTexture(hw, hh), halfB: colorTexture(hw, hh), quarterA: colorTexture(qw, qh), quarterB: colorTexture(qw, qh) };
    multisampleFor(TIERS[tierIndex].sampleCount);
  }
  function multisampleFor(sampleCount) {
    var count = Math.min(sampleCount, gpu.maxSampleCount), made = targets.multisampled[count];
    if (made) return made;
    made = { fb: gl.createFramebuffer(), color: gl.createRenderbuffer(), depth: gl.createRenderbuffer() };
    gl.bindFramebuffer(gl.FRAMEBUFFER, made.fb);
    gl.bindRenderbuffer(gl.RENDERBUFFER, made.color); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, count, gl.RGBA8, targets.w, targets.h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, made.color);
    gl.bindRenderbuffer(gl.RENDERBUFFER, made.depth); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, count, gl.DEPTH_COMPONENT24, targets.w, targets.h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, made.depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    targets.multisampled[count] = made;
    return made;
  }
  function upscaledTarget() { if (!targets.upscaled) targets.upscaled = colorTexture(targets.w, targets.h); return targets.upscaled; }

  /* The quality tiers, best first: how many pixels each draws per CSS pixel and at most in all, its anti-aliasing samples, its bloom
     levels (none: no bloom and no soft focus), the share of the flyers shown, its frames a
     second, its GPU cost per pixel against tier 0's (to jump straight to one that fits), and whether the Relay's firing has its extras
     (the sea's reflection and lift, the sky's glow, ring and lattice, and the beam's light on faces). A phone starts at the top, at its
     screen's own pixels: at one per CSS pixel on a screen with two or three, every edge is stepped and a fine glowing line a rendered
     pixel wide blinks as it slides between them. Two samples do there: its GPU time goes on its pixels, not on its samples. A wide screen starts at WIDE_TOP_TIER, a device with little memory two lower; the city never goes above where it started. Hidden while it warms
     up, it settles on a tier that keeps pace; shown, govern() steps down when it stops keeping pace and back up when there's room again. */
  var TIERS = [
    { pixelsPerCssPixel: 2, maximumPixelCount: 1.4e6, sampleCount: 2, bloomLevelCount: 3, shownFlyerPct: 100, framesPerSec: 60, costPct: 100, hasBeamExtras: true },
    { pixelsPerCssPixel: 1.5, maximumPixelCount: 3.2e6, sampleCount: 4, bloomLevelCount: 4, shownFlyerPct: 100, framesPerSec: 60, costPct: 100, hasBeamExtras: true },
    { pixelsPerCssPixel: 1.25, maximumPixelCount: 2.2e6, sampleCount: 4, bloomLevelCount: 3, shownFlyerPct: 100, framesPerSec: 60, costPct: 100, hasBeamExtras: true },
    { pixelsPerCssPixel: 1, maximumPixelCount: 1.4e6, sampleCount: 4, bloomLevelCount: 3, shownFlyerPct: 100, framesPerSec: 60, costPct: 100, hasBeamExtras: true },
    { pixelsPerCssPixel: 1, maximumPixelCount: 1.4e6, sampleCount: 4, bloomLevelCount: 3, shownFlyerPct: 100, framesPerSec: 30, costPct: 100, hasBeamExtras: true },
    { pixelsPerCssPixel: 1, maximumPixelCount: 1.4e6, sampleCount: 2, bloomLevelCount: 3, shownFlyerPct: 100, framesPerSec: 30, costPct: 85, hasBeamExtras: true },
    { pixelsPerCssPixel: 0.8, maximumPixelCount: 1.0e6, sampleCount: 2, bloomLevelCount: 0, shownFlyerPct: 50, framesPerSec: 30, costPct: 70, hasBeamExtras: false }
  ];
  var PHONE_TOP_TIER = 0, WIDE_TOP_TIER = 1, LOWEST_TIER = TIERS.length - 1, topTier = WIDE_TOP_TIER, tierIndex = WIDE_TOP_TIER, tierLeftCounts = [0, 0, 0, 0, 0, 0, 0], tierSinceMs = 0, fewerSamplesSinceMs = 0;
  // How small the page is shown (Screens shows it scaled down in a frame): it needs no more pixels than that.
  var shownScale = 1;
  function pixelRatioFor(index) {
    if (tool.isStill) return 1;
    var tier = TIERS[index];
    return Math.min((window.devicePixelRatio || 1) * shownScale, tier.pixelsPerCssPixel, Math.sqrt(tier.maximumPixelCount / Math.max(1, cssWidth * cssHeight)));
  }
  // The canvas and its targets at the top tier's size, measured only when the stage's size changes.
  function resize() {
    if (!gpu || gl.isContextLost()) return;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (targets && w === cssWidth && h === cssHeight) return;
    cssWidth = w; cssHeight = h;
    var ratio = pixelRatioFor(topTier);
    width = Math.max(1, Math.floor(cssWidth * ratio)); height = Math.max(1, Math.floor(cssHeight * ratio));
    canvas.width = width; canvas.height = height;
    makeTargets(width, height);
    // The phone's bloom was made at a pixel per CSS pixel: at k times that it blurs k times as far (in more passes, as blurs add in
    // squares), so it glows as wide on the screen.
    var k = topTier === PHONE_TOP_TIER ? Math.max(1, ratio) : 1;
    bloomBlur = { steps: Math.round(2 * k), spread: 1.6 * Math.sqrt(k) };
    fitTier();
  }
  var bloomBlur = { steps: 2, spread: 1.6 };
  // The tier's part of the targets, and how much to sharpen it: none where it has as many pixels as the screen wants, more the fewer it has.
  function fitTier() {
    // A phone that steps down is sharpened only below a pixel per CSS pixel, as before it had more: sharpening a stretched picture makes fine lines blink.
    var ratio = pixelRatioFor(tierIndex), wanted = Math.min((window.devicePixelRatio || 1) * shownScale, topTier === PHONE_TOP_TIER ? 1 : TIERS[topTier].pixelsPerCssPixel);
    drawWidth = Math.min(width, Math.max(1, Math.floor(cssWidth * ratio))); drawHeight = Math.min(height, Math.max(1, Math.floor(cssHeight * ratio)));
    sharpen = tool.isStill ? 0 : Math.min(0.5, Math.max(0, 1 - ratio / wanted) * 0.9);
  }
  function showFlyerShare() { for (var i = 0; i < flyers.length; i++) flyers[i].isHidden = TIERS[tierIndex].shownFlyerPct < 100 && i % 2 === 1; }
  function tierTo(index, now) {
    if (index === tierIndex) return;
    if (index > tierIndex) tierLeftCounts[tierIndex]++;
    if (TIERS[index].sampleCount < TIERS[tierIndex].sampleCount) fewerSamplesSinceMs = now;
    tierIndex = index; tierSinceMs = now;
    fitTier(); showFlyerShare(); multisampleFor(TIERS[index].sampleCount);
    slowSinceMs = 0; fastSinceMs = 0; resetIntervals(); gpuTimeCount = 0; gpuTimeNext = 0; warmIntervalCount = 0;
  }

  // Pacing: a frame is drawn once its interval has come (never more than 60 a second), half as often on a 30 frames a second tier, while
  // the pane covers most of the screen, or while a field in the pane has the focus on a touch screen. Under the tool every frame is
  // drawn, so its timings stay comparable.
  var isBehindPane = false, isFieldFocused = false;
  // While a field in the pane has the focus on a touch screen the Relay's firing is calmer (its flash, bloom, haze and the wave's day
  // tint at 0.4), so typing is never strobed.
  function calmShare() { return coarse && isFieldFocused ? 0.4 : 1; }
  function frameDivider() { return window.__city ? 1 : TIERS[tierIndex].framesPerSec < 60 || isBehindPane || (coarse && isFieldFocused) ? 2 : 1; }
  function targetIntervalMs() { return Math.max(vsyncMs, 1000 / 60 * frameDivider()); }
  function isAtPace(intervalMs) { return intervalMs <= targetIntervalMs() + vsyncMs / 2; }
  /* The GPU time a frame may take: most of its interval, the rest left to the browser (the glass's blur over the city among it, which
     no timer here sees: frames that keep missing their interval step down whatever the timer says). Today's passes take about 13 ms
     at 1440 x 900 drawn at 1.5 on an Apple M3, which keeps 60 frames a second there, so the share is wide enough to keep it. */
  var GPU_BUDGET_SHARE = 0.9;
  function frameBudgetMs() { return targetIntervalMs() * GPU_BUDGET_SHARE; }
  function tierBudgetMs(index) { return Math.max(vsyncMs, 1000 / TIERS[index].framesPerSec) * GPU_BUDGET_SHARE; }

  /* The city's own GPU timer, where the browser has one and not under the tool (which times the city itself): a ring of four queries,
     each over one whole frame (before the scene to after the composite, never inside a pass), read once ready, and kept only when
     taken at the tier it's at now and between 0.1 ms and three frame intervals (a hidden heavy frame's however long). */
  var GPU_TIME_CAPACITY = 512, gpuTimes = new Float64Array(GPU_TIME_CAPACITY), gpuTimesAtMs = new Float64Array(GPU_TIME_CAPACITY), gpuTimeCount = 0, gpuTimeNext = 0;
  // The hidden heavy frames' times, by heavy moment.
  var heavyTimesMs = [[], []], heavyGpuCount = 0, gpuTimeBins = new Int32Array(201);
  function beginTimer(heavyIndex) {
    for (var i = 0; i < gpu.timings.length; i++) {
      var timing = gpu.timings[i];
      if (timing.isPending) continue;
      gl.beginQuery(gpu.timer.TIME_ELAPSED_EXT, timing.query); timing.tierIndex = tierIndex; timing.heavyIndex = heavyIndex;
      return timing;
    }
    return null;
  }
  function endTimer(timing) { if (timing) { gl.endQuery(gpu.timer.TIME_ELAPSED_EXT); timing.isPending = true; } }
  function readTimings(now) {
    var isDisjoint = gl.getParameter(gpu.timer.GPU_DISJOINT_EXT);
    for (var i = 0; i < gpu.timings.length; i++) {
      var timing = gpu.timings[i];
      if (!timing.isPending) continue;
      if (isDisjoint) { timing.isPending = false; continue; }
      if (!gl.getQueryParameter(timing.query, gl.QUERY_RESULT_AVAILABLE)) continue;
      timing.isPending = false;
      var ms = gl.getQueryParameter(timing.query, gl.QUERY_RESULT) / 1e6;
      if (timing.tierIndex !== tierIndex || ms < 0.1) continue;
      // A heavy frame's time counts however long it is: it's the worst case a tier is settled on.
      if (timing.heavyIndex >= 0) { heavyTimesMs[timing.heavyIndex].push(ms); heavyGpuCount++; }
      if (ms > 3 * targetIntervalMs()) continue;
      gpuTimes[gpuTimeNext] = ms; gpuTimesAtMs[gpuTimeNext] = now; gpuTimeNext = (gpuTimeNext + 1) % GPU_TIME_CAPACITY; gpuTimeCount = Math.min(GPU_TIME_CAPACITY, gpuTimeCount + 1);
    }
  }
  function dropTimings() { for (var i = 0; i < gpu.timings.length; i++) gpu.timings[i].isPending = false; gpuTimeCount = 0; gpuTimeNext = 0; }
  // The 95th percentile of the GPU times of the last 8 seconds, in quarter milliseconds; 0 until there are enough of them.
  function gpuTimeP95(now) {
    var total = 0;
    gpuTimeBins.fill(0);
    for (var i = 0; i < gpuTimeCount; i++) if (now - gpuTimesAtMs[i] <= 8000) { gpuTimeBins[Math.min(200, Math.floor(gpuTimes[i] * 4))]++; total++; }
    if (total < 10) return 0;
    for (var bin = 0, counted = 0; bin <= 200; bin++) { counted += gpuTimeBins[bin]; if (counted >= total * 0.95) return (bin + 1) / 4; }
    return 50;
  }

  /* The governor, once it's shown: down a tier after a second of frames over the GPU budget (two seconds without the timer), or of
     missing their interval even when the timer says they fit (the glass's blur over the city is in no GPU time it can read); back up
     after four seconds (six without the timer) with half the budget free; too slow at the lowest tier, it stops on a snapshot of its
     moment. It pays no mind to the first two seconds after it shows, the ease between day and night, or the second after typing, a
     focus or the pane's steps changing (one thing at a time is new then). */
  var INTERVAL_CAPACITY = 256, intervals = new Float64Array(INTERVAL_CAPACITY), intervalsAtMs = new Float64Array(INTERVAL_CAPACITY), intervalCount = 0, intervalNext = 0;
  var slowSinceMs = 0, fastSinceMs = 0, quietUntilMs = 0, governFromMs = 0;
  function resetIntervals() { intervalCount = 0; intervalNext = 0; }
  // The share of the frames of the last windowMs that missed their interval, or -1 with too few to say.
  function missedPct(now, windowMs) {
    var total = 0, missed = 0;
    for (var i = 0; i < intervalCount; i++) if (now - intervalsAtMs[i] <= windowMs) { total++; if (!isAtPace(intervals[i])) missed++; }
    return total < 10 ? -1 : 100 * missed / total;
  }
  function govern(now, intervalMs) {
    intervals[intervalNext] = intervalMs; intervalsAtMs[intervalNext] = now; intervalNext = (intervalNext + 1) % INTERVAL_CAPACITY; intervalCount = Math.min(INTERVAL_CAPACITY, intervalCount + 1);
    // Twenty seconds on fewer samples, and the 4-sample set is let go.
    if (targets.multisampled[4] && TIERS[tierIndex].sampleCount < 4 && now - fewerSamplesSinceMs > 20000) { freeMultisample(targets.multisampled[4]); delete targets.multisampled[4]; }
    if (tool.isStill || now < governFromMs || (night > 0.02 && night < 0.98) || now < quietUntilMs || now - tierSinceMs < 1000) { slowSinceMs = 0; fastSinceMs = 0; return; }
    var isTimed = Boolean(gpu.timer), gpuMs = isTimed ? gpuTimeP95(now) : 0, budgetMs = frameBudgetMs(), missed = missedPct(now, 1000);
    var isSlow = missed >= 25 || gpuMs > budgetMs, isFast = missed === 0 && (!isTimed || (gpuMs > 0 && gpuMs < budgetMs / 2));
    if (isSlow) {
      fastSinceMs = 0;
      if (!slowSinceMs) slowSinceMs = now;
      if (now - slowSinceMs >= (isTimed ? 1000 : 2000)) { if (tierIndex === LOWEST_TIER) stopOnSnapshot(); else tierTo(tierIndex + 1, now); }
    } else if (isFast) {
      slowSinceMs = 0;
      if (!fastSinceMs) fastSinceMs = now;
      // Back up a tier, but never above where it started, and never into one it has had to leave twice.
      if (now - fastSinceMs >= (isTimed ? 4000 : 6000)) { fastSinceMs = 0; if (tierIndex > topTier && tierLeftCounts[tierIndex - 1] < 2) tierTo(tierIndex - 1, now); }
    } else { slowSinceMs = 0; fastSinceMs = 0; }
  }

  // One combination of program, target and state at a time, drawn into a single pixel while the city is hidden, so the driver makes
  // each pipeline now, a few a frame at most, and never in the middle of a shown frame. A draw of nothing would be dropped before its
  // pipeline is made, so each draws one instance or one triangle. The sun's passes are warmed as if it were in view. The shadow map's
  // program needs none: its one draw, filling the shadow map, is its warm-up.
  function warmAt(fb, made) { gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, 1, 1); gl.enable(gl.SCISSOR_TEST); gl.scissor(0, 0, 1, 1); gl.useProgram(made.program); }
  function warmFull() { gl.bindVertexArray(null); gl.drawArrays(gl.TRIANGLES, 0, 3); }
  function sceneFb() { return multisampleFor(TIERS[tierIndex].sampleCount).fb; }
  var WARMS = [
    ["sky", function () { warmAt(sceneFb(), gpu.sky); gl.depthMask(false); warmFull(); }],
    ["water", function () { warmAt(sceneFb(), gpu.water); gl.enable(gl.DEPTH_TEST); gl.bindVertexArray(gpu.waterVao); gl.drawArrays(gl.TRIANGLES, 0, 3); }],
    ["box", function () { warmAt(sceneFb(), gpu.box); gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.bindVertexArray(gpu.cityVao); gl.drawArraysInstanced(gl.TRIANGLES, 0, BOX_TOP_COUNT, 1); }],
    ["box", function () {
      warmAt(sceneFb(), gpu.box); gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
      gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE); gl.depthMask(false);
      gl.bindVertexArray(gpu.trails.vaos[0]); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, 1);
    }],
    ["beam", function () {
      warmAt(sceneFb(), gpu.beam); gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE); gl.depthMask(false);
      gl.uniform4f(gpu.beam.at.uBeamQuad, 0, 1, 1, 0); gl.bindVertexArray(null); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }],
    ["copy", function () { bindTex(0, targets.scene.tex); warmAt(targets.halfA.fb, gpu.copy); warmFull(); }],
    ["bright", function () { bindTex(0, targets.halfA.tex); warmAt(targets.quarterA.fb, gpu.bright); warmFull(); }],
    ["blur", function () { bindTex(0, targets.halfA.tex); warmAt(targets.halfB.fb, gpu.blur); warmFull(); }],
    ["composite", function () { bindTex(0, targets.scene.tex); bindTex(1, targets.halfA.tex); bindTex(2, targets.quarterA.tex); warmAt(null, gpu.composite); warmFull(); }]
  ];
  function warmNext() {
    for (var i = 0; i < WARMS.length; i++) {
      if (gpu.warmed[i] || !gpu[WARMS[i][0]].isFinished) continue;
      gpu.warmed[i] = true; gpu.warmedCount++;
      WARMS[i][1]();
      gl.disable(gl.SCISSOR_TEST); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND); gl.depthMask(true);
      gl.bindVertexArray(null); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return true;
    }
    return false;
  }

  function bindTex(unit, tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }
  function drawTo(target) { gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null); gl.viewport(0, 0, target ? target.w : width, target ? target.h : height); }
  function drawFull() { gl.bindVertexArray(null); gl.drawArrays(gl.TRIANGLES, 0, 3); }
  function blurPasses(from, via, steps, spread) {
    var made = gpu.blur;
    for (var i = 0; i < steps; i++) {
      drawTo(via); gl.useProgram(made.program); bindTex(0, from.tex); gl.uniform2f(made.at.uStep, spread / from.w, 0); drawFull();
      drawTo(from); gl.useProgram(made.program); bindTex(0, via.tex); gl.uniform2f(made.at.uStep, 0, spread / via.h); drawFull();
    }
  }
  var focusAt = [0, 0, 0], seenTiles = [];
  function byDistance(a, b) { return a.distance - b.distance; }
  // One frame of the world as the camera last aimed it (seen), at the tier's size.
  function drawFrame() {
    var tier = TIERS[tierIndex], multisampled = multisampleFor(tier.sampleCount), vp = seen.viewProj, eye = seen.eye, aspect = width / height, u;
    // The Relay's firing: what the tier draws of it, and how calm it is (typing on a touch screen).
    var extras = tier.hasBeamExtras ? 1 : 0, calm = calmShare(), headY = Math.min(relay.headY, 6000);
    // 1. The scene, anti-aliased.
    gl.bindFramebuffer(gl.FRAMEBUFFER, multisampled.fb);
    gl.viewport(0, 0, drawWidth, drawHeight);
    gl.clearColor(FOG[0], FOG[1], FOG[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    gl.useProgram(gpu.sky.program); u = gpu.sky.at;
    gl.uniform3fv(u.uFwd, seen.fwd); gl.uniform3fv(u.uRight, seen.right); gl.uniform3fv(u.uUp, seen.up);
    gl.uniform2f(u.uTan, seen.tan[0], seen.tan[1]);
    gl.uniform2f(u.uShift, shift[0], shift[1]);
    gl.uniform3fv(u.uHorizon, FOG); gl.uniform3fv(u.uZenith, ZENITH); gl.uniform3fv(u.uSun, SUN); gl.uniform1f(u.uNight, night); gl.uniform1f(u.uTime, clock % 3600);
    gl.uniform3fv(u.uEye, eye); gl.uniform4f(u.uBeamSky, relay.bottomY, headY, extras * relay.intensity * lerp(0.5, 0.6, night), 0);
    gl.uniform4f(u.uSkyRing, relay.skyRingUnits, extras * relay.skyRingStrength, 0, 0);
    gl.bindVertexArray(null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
    gl.useProgram(gpu.water.program); u = gpu.water.at;
    gl.uniformMatrix4fv(u.uViewProj, false, vp); gl.uniform1f(u.uY, WATER_Y);
    gl.uniform3fv(u.uCam, eye); gl.uniform3fv(u.uSun, SUN);
    gl.uniform3fv(u.uHorizon, FOG); gl.uniform3fv(u.uZenith, ZENITH); gl.uniform1f(u.uTime, clock % 3600); gl.uniform4fv(u.uRipples, rippleData); gl.uniform1i(u.uRippleCount, ripples.length); gl.uniform1f(u.uNight, night);
    gl.uniform3fv(u.uFog, FOG); gl.uniform1f(u.uFogDensity, fogDensity); gl.uniform1f(u.uFogFalloff, FOG_FALLOFF);
    gl.uniform4f(u.uWave, relay.waveFrontUnits, relay.waveStrength, extras * relay.waveStrength, 0);
    gl.uniform4f(u.uBeamReflect, relay.bottomY, headY, extras * relay.intensity * lerp(0.2, 0.7, night), 0); // by day only a hint of the beam in the sea
    gl.bindVertexArray(gpu.waterVao); gl.drawArrays(gl.TRIANGLES, 0, WATER_COUNT);
    gl.useProgram(gpu.box.program); u = gpu.box.at;
    gl.uniformMatrix4fv(u.uViewProj, false, vp);
    gl.uniformMatrix4fv(u.uLightViewProj, false, lightViewProj);
    gl.uniform3fv(u.uSun, SUN); gl.uniform3fv(u.uCam, eye); gl.uniform3fv(u.uFog, FOG);
    gl.uniform1f(u.uFogDensity, fogDensity); gl.uniform1f(u.uFogFalloff, FOG_FALLOFF); gl.uniform1f(u.uNight, night);
    gl.uniform1f(u.uLit, 1); gl.uniform1f(u.uOpaque, 1); gl.uniform1f(u.uEdge, 1); gl.uniform1f(u.uPulse, 0.5 + 0.5 * Math.sin(clock * 2.4));
    gl.uniform4f(u.uRelay, relay.chargeHeightUnits, relay.floodBottomUnits, relay.floodTopUnits, relay.chargeShare);
    gl.uniform4f(u.uRelayGlow, relay.hot, calm, 0, 0);
    gl.uniform4f(u.uWave, relay.waveFrontUnits, relay.waveStrength, relay.armFrontUnits, relay.armStrength);
    gl.uniform4f(u.uBeamLight, relay.bottomY, extras * relay.intensity * lerp(0.25, 1, night), relay.flare, 0);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    // The tiles the camera sees, nearest first.
    viewPlanesInto(viewPlanes, vp); seenTiles.length = 0;
    for (var ti = 0; ti < tiles.length; ti++) { var tile = tiles[ti]; if (!isBoxSeen(tile.low, tile.high, viewPlanes)) continue;
      tile.distance = Math.hypot((tile.low[0] + tile.high[0]) / 2 - eye[0], (tile.low[2] + tile.high[2]) / 2 - eye[2]); tile.index = ti; seenTiles.push(tile); }
    seenTiles.sort(byDistance);
    for (var si = 0; si < seenTiles.length; si++) { gl.bindVertexArray(gpu.tileVaos[seenTiles[si].index]); gl.drawArraysInstanced(gl.TRIANGLES, 0, BOX_TOP_COUNT, seenTiles[si].count); }
    // The Relay's capstone and core, every face (the capstone is seen from below).
    gl.bindVertexArray(gpu.relay.vaos[gpu.relay.at]); gl.drawArraysInstanced(gl.TRIANGLES, 0, BOX_COUNT, relayParts.count);
    gl.uniform1f(u.uLit, 0);
    gl.bindVertexArray(gpu.movers.vaos[gpu.movers.at]); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, movers.count);
    gl.uniform1f(u.uOpaque, 0); gl.uniform1f(u.uEdge, 0);
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE); gl.depthMask(false); // see-through things leave the sky mask alone
    gl.bindVertexArray(gpu.trails.vaos[gpu.trails.at]); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, trails.count);
    // The Relay's light, premultiplied over what's drawn, both sides: the thread at rest, the flare in the slot and the column firing
    // (wider on a phone, where the picture is smaller).
    if (relay.threadStrength + relay.flare + relay.intensity > 0) {
      gl.disable(gl.CULL_FACE); gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      gl.useProgram(gpu.beam.program); u = gpu.beam.at;
      gl.uniformMatrix4fv(u.uViewProj, false, vp); gl.uniform3fv(u.uCam, eye); gl.uniform1f(u.uNight, night);
      gl.uniform3fv(u.uFog, FOG); gl.uniform1f(u.uFogDensity, fogDensity); gl.uniform1f(u.uFogFalloff, FOG_FALLOFF);
      var threadBottomY = CAPSTONE_TOP_Y + relay.capstoneLiftUnits, slotY = (CAPSTONE_BOTTOM_Y + CAPSTONE_TOP_Y) / 2 + relay.capstoneLiftUnits, widthScale = relay.widthScale * (small ? 1.25 : 1);
      var isLit = relay.intensity + relay.flare > 0, quadBottomY = Math.min(threadBottomY, isLit ? Math.min(relay.bottomY, slotY - 100) : Infinity) - 30;
      gl.uniform4f(u.uBeamQuad, quadBottomY, 6000, isLit ? 90 * Math.max(widthScale, 1) : 12, 0);
      gl.uniform4f(u.uBeamColumn, relay.bottomY, headY, widthScale, 0);
      gl.uniform4f(u.uBeamLook, relay.boomSec >= 0 ? relay.boomSec : relayEventSec(), clock * 0.5 % (Math.PI * 2), relay.intensity, relay.flare);
      gl.uniform4f(u.uThread, relay.threadStrength, threadBottomY, 1.2 * (1 + relay.chargeShare), slotY);
      gl.bindVertexArray(null); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.disable(gl.BLEND); gl.depthMask(true); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, multisampled.fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, targets.scene.fb);
    gl.blitFramebuffer(0, 0, drawWidth, drawHeight, 0, 0, drawWidth, drawHeight, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    // A lower tier's smaller picture, stretched back to the full size for the passes after the scene.
    var source = targets.scene;
    if (drawWidth < width || drawHeight < height) {
      source = upscaledTarget();
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, targets.scene.fb);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, source.fb);
      gl.blitFramebuffer(0, 0, drawWidth, drawHeight, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

    // 2. A soft copy for the depth of field, and the bright parts for the bloom (both off on a tier with no bloom).
    var isSoft = tier.bloomLevelCount > 0;
    if (isSoft) {
      drawTo(targets.halfA); gl.useProgram(gpu.copy.program); bindTex(0, source.tex); drawFull();
      drawTo(targets.quarterA); gl.useProgram(gpu.bright.program); bindTex(0, targets.halfA.tex); gl.uniform1f(gpu.bright.at.uThreshold, 0.97);
      gl.uniform1f(gpu.bright.at.uOrangeBoost, 2.6 * (1 - 0.5 * relay.intensity)); drawFull();
      blurPasses(targets.quarterA, targets.quarterB, bloomBlur.steps, bloomBlur.spread);
    }


    // 3. The final picture, focused where the camera looks.
    projectInto(focusAt, vp, viewTarget);
    drawTo(null); gl.useProgram(gpu.composite.program); u = gpu.composite.at;
    bindTex(0, source.tex);
    // Without the soft copy, the sharp picture stands in for it (so nothing blurs), and no bloom is added.
    bindTex(1, isSoft ? targets.halfA.tex : source.tex);
    bindTex(2, targets.quarterA.tex);
    gl.uniform1f(u.uFocusY, focusAt[1] * 0.5 + 0.5);
    gl.uniform1f(u.uSharpen, sharpen);
    gl.uniform1f(u.uBloomStrength, isSoft ? lerp(0.26, 0.38, night) + (lerp(0.12, 0.32, night) * relay.flash + lerp(0.08, 0.06, night) * relay.intensity) * calm : 0);
    gl.uniform1f(u.uFlash, lerp(0.035, 0.07, night) * relay.flash * calm);
    gl.uniform2f(u.uAspect, Math.min(1, aspect), Math.min(1, 1 / aspect));
    // The lens flare's source: the capstone's slot on the screen, fading as it nears the frame's edges or goes behind the eye.
    projectInto(flareAt, vp, setInto(flarePoint, 0, (CAPSTONE_BOTTOM_Y + CAPSTONE_TOP_Y) / 2 + relay.capstoneLiftUnits, 0));
    var flareU = flareAt[0] * 0.5 + 0.5, flareV = flareAt[1] * 0.5 + 0.5, flareIn = flareAt[2] > 0 ? 1 - smooth(0.42, 0.6, Math.max(Math.abs(flareU - 0.5), Math.abs(flareV - 0.5))) : 0;
    gl.uniform2f(u.uFlareUv, flareU, flareV); gl.uniform1f(u.uGradeNight, night);
    gl.uniform1f(u.uFlareStrength, flareIn * (0.5 * relay.flare + 0.9 * relay.flash + 0.35 * relay.intensity) * lerp(0.3, 1, night) * calm); // by day a third: on the pale void it would read as a blast
    drawFull();
  }
  var flarePoint = [0, 0, 0], flareAt = [0, 0, 0];

  /* The run: the city's phase, and one frame callback that does what it says. */
  var phase = "", phaseTimesMs = {}, isRunning = false, isTickPending = false, isInView = true, isWorldBuilt = false;
  var drawnFrameCount = 0, lastDrawMs = 0, lastTickMs = 0, tickIntervalsMs = [], vsyncMs = 1000 / 60;
  // When the drawing got ready, for the tool: every program linked, the world in the GPU, and its fence passed.
  var readyTimesMs = {};
  function markReady(name) { if (!(name in readyTimesMs)) readyTimesMs[name] = Math.round(performance.now()); }
  function setPhase(name) {
    phase = name;
    if (!(name in phaseTimesMs)) phaseTimesMs[name] = Math.round(performance.now());
    canvas.setAttribute("data-city-phase", name);
  }
  setPhase("waiting");
  // A drawing context it has and may draw with: not given back, not taken, not stopped.
  function hasContext() { return Boolean(gl) && !gl.isContextLost() && (phase === "building" || phase === "warming" || phase === "shown"); }
  /* Every callback goes through guarded. A context the browser has taken is noticed first, before anything draws with it (the event
     saying so can come a frame later, and a program asked about on a lost context reads as one that failed). Anything that fails
     sends the city to its still before it has shown, or stops it where it is after. */
  function guarded(work) {
    return function (value) {
      if (phase === "still" || phase === "frozen") return;
      if (gl && gl.isContextLost()) lose();
      try { work(value); } catch (error) {
        if (gl && gl.isContextLost()) { lose(); return; }
        console.warn("The city stopped: " + (error && error.message));
        if (isShown) freezeAndGiveUp(); else giveUp();
      }
    };
  }
  /* The context's life. Out of sight for RELEASE_OUT_OF_VIEW_MS (scrolled away, as on Screens), or RELEASE_HIDDEN_MS while the page is
     hidden (long, so someone fetching an email code comes back to a live city), the context is given back to the browser; a city that
     had shown leaves a snapshot of its moment behind, the world waits at that moment, and back in sight it's made again and comes back
     over the snapshot. A context the browser takes shows the still at once, never a blank canvas, and comes back the same way, on a
     fresh canvas when no restore comes within RESTORE_WAIT_MS; LOSS_LIMIT losses within LOSS_WINDOW_MS leave the still for good. */
  var RELEASE_OUT_OF_VIEW_MS = 5000, RELEASE_HIDDEN_MS = 60000, RESTORE_WAIT_MS = 2000, LOSS_LIMIT = 3, LOSS_WINDOW_MS = 60000;
  var loseExtension = null, lossTimesMs = [], lossCount = 0, remakeCount = 0, releaseTimer = 0, freshTimer = 0, liveTimer = 0, snapshot = null;
  var CONTEXT_OPTIONS = { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "default", failIfMajorPerformanceCaveat: !window.zaismaCityTool };
  function isSeen() { return !document.hidden && isInView; }
  function stopTimers() { clearTimeout(releaseTimer); clearTimeout(freshTimer); clearTimeout(liveTimer); releaseTimer = 0; freshTimer = 0; liveTimer = 0; }
  // The canvas out of sight at once (a lost context's canvas is blank), with whatever is behind it (the still, or a snapshot) back.
  function hideCanvas() { stage.classList.remove("is-live"); canvas.classList.remove("is-warming", "is-back"); canvas.classList.add("is-away"); }
  // The canvas's picture as it is now, at scale, into a plain canvas behind it. Taken in the task that drew it, while it's still there.
  function takeSnapshot(scale) {
    if (!snapshot) { snapshot = document.createElement("canvas"); snapshot.className = "city-snapshot"; }
    if (snapshot.nextSibling !== canvas) stage.insertBefore(snapshot, canvas);
    snapshot.width = Math.max(1, Math.round(canvas.width * scale)); snapshot.height = Math.max(1, Math.round(canvas.height * scale));
    var context = snapshot.getContext("2d", { alpha: false });
    if (!context) return;
    context.drawImage(canvas, 0, 0, snapshot.width, snapshot.height);
    stage.classList.add("has-snapshot");
  }
  function freeSnapshot() { stage.classList.remove("has-snapshot"); if (snapshot) { snapshot.width = 1; snapshot.height = 1; } }
  // Once the city's fade in is over, nothing behind it is composited any more.
  function markLiveAfter(delayMs) { clearTimeout(liveTimer); liveTimer = setTimeout(guarded(function () { if (phase === "shown") { stage.classList.add("is-live"); freeSnapshot(); } }), delayMs); }
  // The moment as it is, drawn at once, with nothing moved.
  function drawNow() { aimCamera(camTime, 0); uploadRings(); drawFrame(); }
  function uploadRings() { uploadRing(gpu.movers, movers); uploadRing(gpu.trails, trails); uploadRing(gpu.relay, relayParts); }
  // Before it has shown, failed or too slow even at the lowest tier: back to the still, for good, and the context given back.
  function giveUp() {
    if (phase === "still") return;
    var isLive = Boolean(gl) && !gl.isContextLost();
    setPhase("still"); isRunning = false; isShown = false; freeBuildLock(); stopTimers();
    hideCanvas(); stage.classList.remove("has-snapshot"); canvas.classList.remove("on"); showStill();
    if (isLive && loseExtension) loseExtension.loseContext();
  }
  // Failed once shown: it stops where it is, its last frame left on the canvas (nothing more is drawn, so nothing can fail again).
  function freezeAndGiveUp() {
    if (phase === "still" || phase === "frozen") return;
    setPhase("frozen"); isRunning = false; isShown = false; freeBuildLock(); stopTimers();
  }
  // Too slow even at the lowest tier once shown: it stops on a snapshot of its moment, and the context is given back.
  function stopOnSnapshot() {
    drawNow(); takeSnapshot(1);
    setPhase("still"); isRunning = false; isShown = false; freeBuildLock(); stopTimers(); hideCanvas();
    if (loseExtension) loseExtension.loseContext();
  }
  // Out of sight long enough: the context given back, a shown city's moment kept as a snapshot first.
  function release() {
    if (!hasContext() || isSeen() || !loseExtension) return;
    if (isShown) { drawNow(); takeSnapshot(0.5); }
    setPhase("released"); isRunning = false; isShown = false; stopTimers(); hideCanvas();
    loseExtension.loseContext();
  }
  // Taken by the browser (a GPU reset, memory pressure, too many contexts on the page): out of sight at once, and made again once in
  // sight, unless it's been taken too often lately.
  function lose() {
    if (phase === "released" || phase === "lost" || phase === "still" || phase === "waiting") return;
    if (phase === "frozen") { giveUp(); return; }
    setPhase("lost"); isRunning = false; isShown = false; stopTimers(); hideCanvas();
    var lostAtMs = performance.now();
    lossCount++; lossTimesMs.push(lostAtMs);
    while (lossTimesMs[0] < lostAtMs - LOSS_WINDOW_MS) lossTimesMs.shift();
    if (lossTimesMs.length >= LOSS_LIMIT) { giveUp(); return; }
    wake();
  }
  // Back in sight: the context asked back (given back) or waited for (taken), and a fresh canvas if it hasn't come within the wait.
  function comeBack() {
    if (freshTimer) return;
    if (phase === "released") { try { loseExtension.restoreContext(); } catch (error) {} }
    freshTimer = setTimeout(guarded(function () { freshTimer = 0; if ((phase === "released" || phase === "lost") && isSeen()) freshCanvas(); }), RESTORE_WAIT_MS);
  }
  // A fresh canvas in the old one's place, with its classes, so it stays out of sight until it's ready.
  function freshCanvas() {
    var fresh = canvas.cloneNode(false);
    canvas.parentNode.replaceChild(fresh, canvas);
    canvas = fresh; gl = null; gpu = null; targets = null;
    remake();
  }
  /* The context back, restored or new: everything the GPU holds is made again from the world, which waited at its moment. A city that
     had shown warms quickly, keeping its tier, and comes back over its snapshot; one that hadn't warms as at first. */
  function remake() {
    clearTimeout(freshTimer); freshTimer = 0;
    if (phase !== "released" && phase !== "lost") return;
    gl = canvas.getContext("webgl2", CONTEXT_OPTIONS);
    if (!gl || gl.isContextLost()) { giveUp(); return; }
    loseExtension = gl.getExtension("WEBGL_lose_context");
    remakeCount++;
    makeGpu();
    beginWarm(hasShown);
    setPhase(isWorldBuilt ? "warming" : "building");
    wake();
  }
  var nextTick = guarded(tick);
  function requestTick() { if (!isTickPending) { isTickPending = true; requestAnimationFrame(nextTick); } }
  // The screen's frame interval: the tenth percentile of the frame callbacks' intervals while it built, snapped to the usual rates.
  function readVsync() {
    if (tickIntervalsMs.length < 8) return;
    var sorted = tickIntervalsMs.slice().sort(function (a, b) { return a - b; }), low = sorted[Math.floor(sorted.length * 0.1)];
    var rates = [1000 / 120, 1000 / 90, 1000 / 60, 1000 / 30], best = rates[0];
    for (var i = 1; i < rates.length; i++) if (Math.abs(rates[i] - low) < Math.abs(best - low)) best = rates[i];
    vsyncMs = best;
  }
  /* While hidden and getting ready: programs finished as the driver readies them; the world into the GPU, on a tick of its own, as soon
     as it's built and the shadow map's program is ready; the warm draws, one on a tick, then one more on each tick that followed one on
     time (up to WARM_DRAWS_PER_TICK_MAX), so a driver that makes pipelines quickly is done in a few ticks and one that makes them slowly
     never holds more than one in a tick; then the fence. True once frames can be drawn, hidden (at the faintest opacity, or out of
     sight over its snapshot when it's made again) until the city has settled. */
  var WARM_DRAWS_PER_TICK_MAX = 3, warmDrawsPerTick = 0;
  function warmUp(now) {
    var tickIntervalMs = lastTickMs ? now - lastTickMs : 0;
    if (tickIntervalMs && tickIntervalsMs.length < 120) tickIntervalsMs.push(tickIntervalMs);
    lastTickMs = now;
    if (finishPrograms()) return false;
    var isLinked = areProgramsFinished();
    if (isLinked) markReady("linked");
    if (isWorldBuilt && !gpu.isFilled && gpu.depth.isFinished) { fillGpu(); return false; }
    warmDrawsPerTick = tickIntervalMs > 0 && tickIntervalMs < 21 ? Math.min(WARM_DRAWS_PER_TICK_MAX, warmDrawsPerTick + 1) : 1;
    for (var drawn = 0; drawn < warmDrawsPerTick && warmNext(); drawn++) {}
    if (drawn || !isLinked || !gpu.isFilled) return false;
    if (gpu.warmFence) {
      if (gl.getSyncParameter(gpu.warmFence, gl.SYNC_STATUS) !== gl.SIGNALED) return false;
      gl.deleteSync(gpu.warmFence); gpu.warmFence = null; lastDrawMs = 0; markReady("fenced");
      if (!hasShown) { readVsync(); canvas.classList.remove("is-away"); canvas.classList.add("is-warming"); }
    }
    return true;
  }
  /* The hidden frames: the loop's two heaviest moments for a few frames each (the costliest pipelines and caches are ready before it
     shows, and the timer has the worst case to settle a tier on), then the moment it shows from. It shows once SMOOTH_FRAME_COUNT
     frames in a row kept pace and its tier is settled (QUICK_SMOOTH_FRAME_COUNT of its own moment, its tier kept, when it's made
     again), or gives up for the still when even the lowest tier can't keep pace, or after WARM_LIMIT_MS hidden (never under the
     tool). Without the timer, the median of the last frames' intervals settles the tier: two tiers down when it's twice the frame
     interval, one otherwise. */
  var HEAVY_MOMENTS_SEC = [25, 36], HEAVY_FRAME_COUNT = 4, SMOOTH_FRAME_COUNT = 8, QUICK_SMOOTH_FRAME_COUNT = 3, WARM_LIMIT_MS = 4000;
  var isQuickWarm = false, warmFrameCount = 0, momentFrameCount = 0, smoothCount = 0, warmElapsedMs = 0, framesSinceHeavy = 0, isTierSettled = false;
  var warmIntervals = new Float64Array(SMOOTH_FRAME_COUNT), sortedIntervals = new Float64Array(SMOOTH_FRAME_COUNT), warmIntervalCount = 0;
  function beginWarm(isQuick) {
    isQuickWarm = isQuick; isTierSettled = isQuick;
    warmFrameCount = 0; momentFrameCount = 0; smoothCount = 0; warmElapsedMs = 0; framesSinceHeavy = 0; warmIntervalCount = 0; warmDrawsPerTick = 0;
    heavyTimesMs = [[], []]; heavyGpuCount = 0; gpuTimeCount = 0; gpuTimeNext = 0;
  }
  // The heavy moment a hidden frame shows, or -1 for the moment it will show from (a still for the tool, and a quick warm, draw only their own).
  function heavyMomentIndex() { var heavy = Math.floor(warmFrameCount / HEAVY_FRAME_COUNT); return heavy < HEAVY_MOMENTS_SEC.length && !tool.isStill && !isQuickWarm ? heavy : -1; }
  // The heavier moment's GPU time: the median of its frames (one frame can be slow while the GPU wakes up), the larger of the two.
  function heavyGpuMs() {
    var worst = 0;
    for (var i = 0; i < heavyTimesMs.length; i++) {
      var times = heavyTimesMs[i].slice().sort(function (a, b) { return a - b; });
      if (times.length) worst = Math.max(worst, times[Math.floor(times.length / 2)]);
    }
    return worst;
  }
  function settleWarm(now, intervalMs, isHeavy) {
    warmFrameCount++;
    if (!isHeavy) momentFrameCount++;
    if (warmFrameCount === 1) return; // its interval is the wait for the fence
    warmElapsedMs += Math.min(intervalMs, 100);
    smoothCount = isAtPace(intervalMs) ? smoothCount + 1 : 0;
    // With the timer: once the heavy frames' times are in, straight to the best tier whose cost fits its budget.
    if (gpu.timer && !isTierSettled && momentFrameCount > 0) {
      framesSinceHeavy++;
      if (heavyGpuCount >= 3 || framesSinceHeavy > 12) { isTierSettled = true; if (heavyGpuCount) settleTier(now); }
    }
    // Without it, or where frames still miss their interval on the tier the timer chose (the glass's blur over the city is in no time
    // it reads): down a tier when the median of the last frames' intervals misses, two when it's twice the interval.
    if (!tool.isStill && (!gpu.timer || isTierSettled)) {
      warmIntervals[warmIntervalCount % SMOOTH_FRAME_COUNT] = intervalMs; warmIntervalCount++;
      if (warmIntervalCount >= SMOOTH_FRAME_COUNT) {
        sortedIntervals.set(warmIntervals); sortedIntervals.sort();
        var medianMs = (sortedIntervals[SMOOTH_FRAME_COUNT / 2 - 1] + sortedIntervals[SMOOTH_FRAME_COUNT / 2]) / 2;
        if (!isAtPace(medianMs)) {
          if (tierIndex === LOWEST_TIER) { giveUp(); return; }
          tierTo(Math.min(LOWEST_TIER, tierIndex + (medianMs >= 2 * targetIntervalMs() ? 2 : 1)), now);
          smoothCount = 0;
        }
      }
    }
    if (!window.zaismaCityTool && warmElapsedMs > WARM_LIMIT_MS) { giveUp(); return; }
    // A still for the tool shows as soon as it has drawn its moment: it's never timed, and may be bigger than any screen.
    var smoothNeeded = isQuickWarm ? QUICK_SMOOTH_FRAME_COUNT : SMOOTH_FRAME_COUNT;
    if (momentFrameCount >= 2 && (tool.isStill || smoothCount >= smoothNeeded && (isTierSettled || !gpu.timer))) show(now);
  }
  function pixelCountAt(index) { var ratio = pixelRatioFor(index); return Math.min(width, Math.floor(cssWidth * ratio)) * Math.min(height, Math.floor(cssHeight * ratio)); }
  function settleTier(now) {
    var heavyMs = heavyGpuMs(), here = pixelCountAt(tierIndex) * TIERS[tierIndex].costPct, best = LOWEST_TIER;
    for (var i = topTier; i < TIERS.length; i++) {
      if (tierLeftCounts[i] >= 2) continue;
      if (heavyMs * pixelCountAt(i) * TIERS[i].costPct / here <= tierBudgetMs(i)) { best = i; break; }
    }
    if (best !== tierIndex) { tierTo(best, now); smoothCount = 0; }
  }
  /* It shows: the first time sharpening in out of the placeholder, made again fading in quickly over its snapshot (at the same moment,
     so it barely changes), a still for the tool at once. Once the fade is over, what's behind it is no longer composited. */
  function show(now) {
    var isBack = hasShown;
    isShown = true; setPhase("shown"); governFromMs = now + 2000;
    if (!hasShown) { hasShown = true; shownAt = now; }
    if (tool.isStill) canvas.style.transition = "none";
    canvas.classList.remove("is-warming", "is-away"); canvas.classList.add(isBack ? "is-back" : "on");
    markLiveAfter(tool.isStill ? 0 : isBack ? 400 : 1700);
    slowSinceMs = 0; fastSinceMs = 0; resetIntervals();
  }
  function tick(now) {
    isTickPending = false;
    if (!isRunning) return;
    requestTick();
    if (gpu.timer) readTimings(now);
    if (!isShown && !warmUp(now)) return;
    var intervalMs = now - lastDrawMs;
    if (lastDrawMs && intervalMs < targetIntervalMs() - vsyncMs / 2) return;
    var dt = Math.min(0.05, intervalMs / 1000); lastDrawMs = now;
    if (isShown) { govern(now, intervalMs); if (phase !== "shown") return; }
    var heavyIndex = isShown ? -1 : heavyMomentIndex(), heavySec = heavyIndex >= 0 ? HEAVY_MOMENTS_SEC[heavyIndex] : -1;
    // The heavy frames draw the Relay firing too (column, wave, rings and the sky's ring at once), so the tier holds through a release.
    heldEventSec = heavySec >= 0 ? HEAVY_EVENT_SEC : -1;
    // Hidden, the world holds still on its first moment (the placeholder's), so it fades in from exactly what was showing; so does a still.
    advance(isShown && !tool.isStill ? dt : 0, dt, now);
    aimCamera(heavySec >= 0 ? heavySec : camTime, dt);
    uploadRings();
    var timing = gpu.timer ? beginTimer(heavyIndex) : null;
    drawFrame();
    if (timing) endTimer(timing);
    drawnFrameCount++;
    if (!isShown) settleWarm(now, intervalMs, heavySec >= 0);
  }
  /* It runs only while it can be seen: the page showing, and the city in view (the gallery's example and Screens' frames can scroll
     away). Out of sight, the context is given back after a while; back in sight, it's made again. */
  function wake() {
    var isSeenNow = isSeen();
    if (gpu && gpu.timer && document.hidden) dropTimings();
    clearTimeout(releaseTimer); releaseTimer = 0;
    if (!isSeenNow && hasContext() && loseExtension && !tool.isStill) releaseTimer = setTimeout(guarded(release), document.hidden ? RELEASE_HIDDEN_MS : RELEASE_OUT_OF_VIEW_MS);
    if (isSeenNow && (phase === "released" || phase === "lost")) comeBack();
    var should = (phase === "building" || phase === "warming" || phase === "shown") && isSeenNow;
    if (should === isRunning) return;
    isRunning = should; lastTickMs = 0; lastDrawMs = performance.now();
    if (isRunning) requestTick();
  }
  document.addEventListener("visibilitychange", guarded(wake));
  // The stage, not the canvas, is watched and listened to, so a fresh canvas needs nothing bound again. A context's events don't bubble,
  // so they're caught on their way down.
  if (window.IntersectionObserver) new IntersectionObserver(guarded(function (entries) { isInView = entries[entries.length - 1].isIntersecting; wake(); })).observe(stage);
  if (window.ResizeObserver) new ResizeObserver(guarded(resize)).observe(stage); else window.addEventListener("resize", guarded(resize));
  stage.addEventListener("webglcontextlost", function (event) {
    if (event.target !== canvas) return;
    event.preventDefault();
    if (phase !== "still") lose();
  }, true);
  stage.addEventListener("webglcontextrestored", guarded(function (event) { if (event.target === canvas) remake(); }), true);
  // What the governor pays no mind to for a second: typing, a focus moving, and the pane's steps swapping in.
  function quiet() { quietUntilMs = performance.now() + 1000; }
  ["input", "focusin", "keydown"].forEach(function (name) { document.addEventListener(name, quiet, true); });
  document.addEventListener("focusin", function (event) { var el = event.target; isFieldFocused = Boolean(pane && pane.contains(el) && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)); });
  document.addEventListener("focusout", function () { isFieldFocused = false; });
  var paneIn = pane && pane.querySelector(".pane-in");
  if (paneIn && window.MutationObserver) new MutationObserver(quiet).observe(paneIn, { childList: true });
  // Whether the pane covers most of the screen (a phone's pane scrolled up): the city behind it goes at half the rate.
  if (pane && window.IntersectionObserver) {
    var paneSteps = []; for (var step = 0; step <= 20; step++) paneSteps.push(step / 20);
    new IntersectionObserver(function (entries) {
      var entry = entries[entries.length - 1], root = entry.rootBounds, area = root ? root.width * root.height : window.innerWidth * window.innerHeight;
      isBehindPane = area > 0 && entry.intersectionRect.width * entry.intersectionRect.height / area > 0.7;
    }, { threshold: paneSteps }).observe(pane);
  }
  // A mouse plays as it's pressed. A touch plays when it lifts without having moved, so a finger that drags scrolls the page instead.
  var touchStart = null;
  stage.addEventListener("pointerdown", guarded(function (event) {
    if (event.pointerType === "mouse") play(event.clientX, event.clientY);
    else touchStart = { x: event.clientX, y: event.clientY, atMs: performance.now() };
  }));
  stage.addEventListener("pointerup", guarded(function (event) {
    var start = touchStart; touchStart = null;
    if (!start || event.pointerType === "mouse") return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 10 && performance.now() - start.atMs < 600) play(event.clientX, event.clientY);
  }));
  stage.addEventListener("pointercancel", function () { touchStart = null; });
  // A mouse over a shape: the shape swells and warms while it's there (the pointer stays as it is, so the play is found, not announced).
  // Checked at most every 80 ms as the mouse moves.
  var hovered = null, hoverCheckedAtMs = 0;
  function hover(thing) { if (thing === hovered) return; if (hovered) hovered.isHovered = false; hovered = thing; if (thing) thing.isHovered = true; }
  stage.addEventListener("pointermove", guarded(function (event) {
    if (event.pointerType !== "mouse" || !isShown) return;
    var now = performance.now(); if (now - hoverCheckedAtMs < 80) return; hoverCheckedAtMs = now;
    var thing = pick(event.clientX, event.clientY);
    hover(thing && !thing.gone ? thing : null);
  }));
  stage.addEventListener("pointerleave", function () { hover(null); });
  if (window.zaismaCityTool) tool.report = function () {
    return { phase: phase, phaseTimesMs: phaseTimesMs, tierIndex: tierIndex, canvasPx: [canvas.width, canvas.height], vsyncMs: Math.round(vsyncMs * 10) / 10,
      isTimed: Boolean(gpu && gpu.timer), heavyGpuMs: Math.round(heavyGpuMs() * 10) / 10, gpuP95Ms: gpu && gpu.timer ? gpuTimeP95(performance.now()) : null,
      drawnFrameCount: drawnFrameCount, readyTimesMs: readyTimesMs, cameraSec: Math.round(camTime * 1000) / 1000, worldSec: Math.round(clock * 100) / 100,
      relayEventSec: Math.round(relayEventSec() * 100) / 100, lossCount: lossCount, remakeCount: remakeCount, cityRowCount: city.count, cityChecksum: cityChecksum() };
  };

  // At once, not after the page's load (the bot check's frame alone can hold that back a second): once the page has painted its
  // placeholder, so building the city never delays the pane. The context, then the programs handed to the driver, then the world built
  // in slices while they compile (it goes on through a lost context: it needs none).
  function start() {
    gl = canvas.getContext("webgl2", CONTEXT_OPTIONS);
    if (!gl) { giveUp(); return; }
    loseExtension = gl.getExtension("WEBGL_lose_context");
    setPhase("building");
    try { var frame = window.frameElement; if (frame && frame.offsetWidth) shownScale = Math.min(1, frame.getBoundingClientRect().width / frame.offsetWidth); } catch (error) {}
    topTier = tool.isStill ? WIDE_TOP_TIER : small || coarse ? PHONE_TOP_TIER : WIDE_TOP_TIER;
    if (!tool.isStill && navigator.deviceMemory && navigator.deviceMemory <= 2) topTier = Math.min(LOWEST_TIER, topTier + 2);
    tierIndex = topTier;
    makeGpu();
    beginWarm(false);
    wake();
    whenFree(buildWorld, function () { isWorldBuilt = true; holdFraming(); showFlyerShare(); if (phase === "building") setPhase("warming"); });
  }
  requestAnimationFrame(function () { later(start); });
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
   instead of resizing it, so the city never scales with the bar. Its parent is isolated like the backdrop's: the page sets the color behind it
   on html (html.ts), so the body's own would otherwise paint over it. */
:has(> .city-stage) { isolation: isolate; }
.city-stage { position: fixed; inset: 0 0 auto 0; height: 100vh; height: 100lvh; z-index: -1; overflow: hidden; background: linear-gradient(180deg, #D1DBE3 0%, #DCE2E7 37%, #DCE2E7 44%, #DCE2E9 47%, #D7DFE5 100%); }
.city-stage.is-framed { position: absolute; inset: 0; height: auto; z-index: 0; }
.city-stage .city { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
/* The placeholder and the still: the live city's first frame, at the screen's height and centred, moved as the camera's picture is
   (CITY_SCRIPT sets --still-x and --still-y; until then, half the pane's width to the left). Its box reaches past the screen, so moving
   it leaves no edge. */
.city-stage .city-still { position: absolute; inset: -50%; display: block; background: var(--still-tiny) center / auto 50% no-repeat;
  transform: translate(var(--still-x, calc(min(460px, 100vw - 2 * var(--pad-pane)) / -2)), var(--still-y, 0px));
  filter: blur(18px) saturate(1.1); transition: filter 0.9s ease; }
.city-stage .city-still.is-day { --still-tiny: url(data:image/webp;base64,UklGRk4CAABXRUJQVlA4WAoAAAAgAAAARwAAGwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggYAAAADAEAJ0BKkgAHAA+tVSiTSckoyImeAsA4BaJaQDRvAlVQGb2k1iulxuCgAD+8KxL4g83GHwqdKwDWcI0G0QR3EbzSqMkYChdDilcGmclvT+ARy/9PhC2mtWHH0ms6AAAAA==); --still-full: url(/sign-in/city-day.webp); }
.city-stage .city-still.is-night { --still-tiny: url(data:image/webp;base64,UklGRoQCAABXRUJQVlA4WAoAAAAgAAAARwAAGwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDgglgAAADAFAJ0BKkgAHAA+tVCiTCckoyKs1AlY4BaJZwDJTCpQXKANC0Ey5OogHQu2/wybTgIoAP71YFjNk70qZzGhaJvsoXP9hmMHJFtqdVRuMaPsEsw2KtyI+6ec/kkAzZEmSsQApEjnaB06n5sV8/eNIxuuco6S6/6wOdFhjMjmKynij73KY7K/utj7TGdtClZ/JH1JHEwAAA==); --still-full: url(/sign-in/city-night.webp); }
@media (max-width: 760px) {
  .city-stage .city-still { transform: translate(var(--still-x, 0px), var(--still-y, -18vh)); }
  .city-stage .city-still.is-day { --still-tiny: url(data:image/webp;base64,UklGRkgCAABXRUJQVlA4WAoAAAAgAAAAIwAAIwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggWgAAAFAEAJ0BKiQAJAA+tVSnTacko6IjigDgFolpAMzQCm4NWkoePj3Zn8YQWTgA/vCAhENdA/uOfjvHrEjxAA2saJjNSAy+/KKB0rJcxrLtVIWeWT++2NE4QAAAAA==); --still-full: url(/sign-in/city-day-phone.webp); }
  .city-stage .city-still.is-night { --still-tiny: url(data:image/webp;base64,UklGRnYCAABXRUJQVlA4WAoAAAAgAAAAIwAAIwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggiAAAAJAEAJ0BKiQAJAA+tU6fSqckoqIuKADgFolnAMM0J9dsL/7P3Kl/ivMZ2LyE4AD+9CHRns/G7/kygB9Gl13jM12iIlNP6EeopjSLQnE36e4rBA6RjLHUrCuBHzzGoRN8z+3INyi7+a6y1u9vFcWHABZ5yBBAoWb/z3DoCQHVBjqp+S90mvoKAAA=); --still-full: url(/sign-in/city-night-phone.webp); }
}
.city-stage.is-still .city-still { background-image: var(--still-full); filter: none; }
.city-stage .city { opacity: 0; transform: scale(1.035); transition: opacity 1.1s ease, transform 1.6s cubic-bezier(.2,.8,.2,1); touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
.city-stage .city.on { opacity: 1; transform: none; }
/* While it settles, hidden, it draws at the faintest opacity rather than none, so the browser composites it, and the glass over it,
   as it will once it shows. */
.city-stage .city.is-warming { opacity: 0.01; transition: none; }
/* Its context given back while out of sight, or taken by the browser: out of sight at once (its canvas is blank), over the still or a
   snapshot of its moment (a plain canvas CITY_SCRIPT puts behind it). Made again, it fades back in quickly over that snapshot. */
.city-stage .city.is-back { transform: none; transition: opacity .35s ease; }
.city-stage .city.is-away { opacity: 0; transition: none; }
.city-stage .city-snapshot { position: absolute; inset: 0; width: 100%; height: 100%; display: none; }
.city-stage.has-snapshot .city-snapshot { display: block; }
/* Once the live city has faded in, nothing behind it is composited. */
.city-stage.is-live .city-still, .city-stage.is-live .city-snapshot { visibility: hidden; }
@media (prefers-reduced-motion: reduce) { .city-stage .city-still, .city-stage .city { transition: none; } }
/* Day for light, night for dark: only the one showing is ever loaded. The stage's gradient is the live city's sky, horizon and sea
   in its first frame, so the stage, the still and the city agree. */
.city-stage .city-still.is-night { display: none; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme-choice="light"]) .city-stage { background: linear-gradient(180deg, #0B0D1C 0%, #131426 37%, #15172C 44%, #131427 47%, #0B0E1B 100%); }
  :root:not([data-theme-choice="light"]) .city-stage .city-still.is-day { display: none; }
  :root:not([data-theme-choice="light"]) .city-stage .city-still.is-night { display: block; }
}
[data-theme-choice="dark"] .city-stage { background: linear-gradient(180deg, #0B0D1C 0%, #131426 37%, #15172C 44%, #131427 47%, #0B0E1B 100%); }
[data-theme-choice="dark"] .city-stage .city-still.is-day { display: none; }
[data-theme-choice="dark"] .city-stage .city-still.is-night { display: block; }
[data-theme-choice="light"] .city-stage { background: linear-gradient(180deg, #D1DBE3 0%, #DCE2E7 37%, #DCE2E7 44%, #DCE2E9 47%, #D7DFE5 100%); }
[data-theme-choice="light"] .city-stage .city-still.is-day { display: block; }
[data-theme-choice="light"] .city-stage .city-still.is-night { display: none; }

/* A pane on the city: glass in front, never resting in the scene. On a wide screen it's a form's width (460px) on the right,
   standing a block's gap under the header (--header-room), its edge in line with the header's, as tall as what's in it and at most down
   to the same inset from the bottom, where what's in it scrolls; the city has the rest. On a phone it's full width at the
   bottom, its edges in line with the header's, starting low (CITY_SCRIPT places it) and scrolling up with the page. */
.city-page { min-height: 100vh; }
/* The city is there to play with: a press anywhere but on the pane, the header or the rail goes through the page (and the body it
   lies behind) to it. */
body:has(> .city-page), .city-page { pointer-events: none; }
.city-page > *, .city-stage { pointer-events: auto; }
/* The pane places itself under the header, so the page keeps no room for it. */
body:has(> .city-page) { padding-top: 0; }
html:has(.city-page) { height: 100%; }
.city-page .city-pane { position: fixed; z-index: 1; top: var(--header-room); max-height: calc(100vh - var(--header-room) - var(--pad-pane)); right: max(var(--pad-pane), calc((100% - 1240px) / 2)); width: min(460px, calc(100% - 2 * var(--pad-pane))); display: flex; }
.city-page .city-pane > .glass-pane { flex: 1; min-height: 0; }
/* The other ways in: stacked, cut only at the stack's ends. */
.city-pane .ways { display: grid; gap: var(--gap-control-stack); }
/* Or, between the ways in: a word on a hairline. */
.city-pane .or { display: flex; align-items: center; gap: var(--gap-words-words); font: var(--type-facts); color: var(--muted); }
.city-pane .or::before, .city-pane .or::after { content: ""; flex: 1; height: 1px; background: var(--line); }
.city-pane .note { font: var(--type-note); color: var(--muted); }
/* Its cards sit two to a row where the pane has room: an odd one out on the last row is centred under the two above it, one column wide. */
.city-pane .is-play-step .choice-cards { container-type: inline-size; }
@container (min-width: 368px) {
  .city-pane .is-play-step .choice-card:last-child:nth-child(odd) { grid-column: 1 / -1; justify-self: center; width: calc(50% - var(--gap-control-stack) / 2); }
}
@media (max-width: 760px) {
  html:has(.city-page) { height: auto; }
  .city-page { display: flow-root; min-height: 0; padding-bottom: calc(var(--pad-inner-pane) + env(safe-area-inset-bottom)); }
  .city-page .city-pane { position: relative; top: auto; bottom: auto; right: auto; width: auto; max-height: none; margin: 60vh var(--pad-pane) 0; }
  .city-page .city-pane > .glass-pane > .pane-in { overflow: visible; }
  /* The page's rail runs down the gutter beside the pane. */
  .city-page .rail[data-rail="page"] { right: 1px; }
}
/* The gallery's example: the stage in its own box, cut like a pane, with a pane on its right as tall as what's in it; where the box is a
   phone's width, the pane is full width at its foot, as on a phone. */
.city-frame { position: relative; width: 100%; height: 420px; overflow: hidden; display: flex; align-items: flex-start; justify-content: flex-end; padding: var(--pad-inner-pane);
  container-type: inline-size; clip-path: ${cutPolygon("pane")}; }
.city-frame > .glass-pane { position: relative; z-index: 1; }
@container (max-width: 560px) { .city-frame > .glass-pane:is(.fit, .full) { width: 100%; align-self: flex-end; } }
`;

component({
  name: "City",
  slug: "city",
  group: "foundations",
  subgroup: "backgrounds",
  summary: "Zaisma's own live 3D scene, where signing in and making an account happen: one city in an endless sea on a slow cinematic loop, its orange shapes and sea there to tap. Under reduced motion, without WebGL or on a device that can't keep it smooth, a still of the same city stands in, with everything in place.",
  styles: CITY_STYLES,
  render: cityStage,
  examples: [
    {
      label: "A pane on the city",
      isWide: true,
      markup: html`<div class="city-frame">${cityStage({ isFramed: true })}${glassPane({ paneWidth: "fit", label: "Sign in", body: stack({ items: [{ kind: "words", markup: html`<h2>Welcome back</h2>` }, { kind: "control", markup: runButton("Sign in", { type: "button", isFullWidth: true }) }] }) })}</div>`,
    },
  ],
});

