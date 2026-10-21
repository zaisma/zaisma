import type { Env } from "./index.ts";
import { GLASS_LIGHT_PASS, MOST_GLASS_PANE_COUNT, SHADER_HEAD, SHADER_LIMITS, backgroundsFor, gameHeaders, shaderById, shaderKey, shaderStillKey, type BackgroundScreen, type Game } from "@zaisma/core";

/**
 * A game's background shader, run on the game's own site like any of its files (Backgrounds in docs/DEVELOPER-API.md): Zaisma's
 * pages frame it behind their glass, so a shader is untrusted game content that never runs on zaisma.com.
 *
 *   _zaisma/background?screen=wide|phone             the runner, drawing the shader the game chose for that screen
 *   _zaisma/background.glsl?screen=…                  that shader's source
 *   _zaisma/background-still.png?screen=…             its still frame, shown under reduced motion and where WebGL can't run
 *   _zaisma/shader-preview                            the same runner, drawing a shader the dashboard posts to it
 *
 * The page round the frame can't be read from here, so it posts where its glass is: { panes: [{ rect: [left, bottom, right, top],
 * cuts: [top left, top right, bottom right, bottom left], isSmoked }] } in the frame's own CSS pixels from its bottom left, on
 * scroll, resize and when the glass changes, never every frame. The runner bends the light under each pane (GLASS_LIGHT_PASS).
 */

type BackgroundEnv = Pick<Env, "DB" | "GAMES" | "SITE_ORIGIN">;

const RUNNER_SCRIPT = `(function () {
  var config = window.__ZAISMA_BACKGROUND__, VERTEX = "attribute vec2 corner; void main() { gl_Position = vec4(corner, 0.0, 1.0); }";
  var canvas = document.querySelector("canvas"), still = document.querySelector("img"), reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  var gl = null, at = {}, scale = config.resolutionScale * Math.min(window.devicePixelRatio || 1, 1.5), slowS = 0, isHeld = false, lastMs = 0;
  var panes = { rects: new Float32Array(config.paneLimit * 4), cuts: new Float32Array(config.paneLimit * 4), count: 0, css: [] };
  function tell(message) { if (window.parent !== window) window.parent.postMessage(Object.assign({ zaismaBackground: true }, message), config.site); }
  function showStill() { canvas.hidden = true; if (still.getAttribute("data-src")) { still.src = still.getAttribute("data-src"); still.hidden = false; } }
  function size() {
    var width = Math.max(2, Math.round(window.innerWidth * scale)), height = Math.max(2, Math.round(window.innerHeight * scale));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; placePanes(); if (gl) draw(); }
  }
  function placePanes() {
    var k = canvas.width / Math.max(1, window.innerWidth);
    panes.rects.fill(0); panes.cuts.fill(0); panes.count = Math.min(panes.css.length, config.paneLimit);
    panes.css.slice(0, panes.count).forEach(function (pane, i) {
      panes.rects.set(pane.rect.map(function (v) { return v * k; }), i * 4);
      panes.cuts.set([pane.cuts[0] * k, pane.cuts[1] * k, pane.cuts[2] * k, pane.cuts[3] * k + (pane.isSmoked ? 4096 : 0)], i * 4);
    });
  }
  function start(source) {
    gl = gl || canvas.getContext("webgl", { antialias: false, depth: false, stencil: false, alpha: false, powerPreference: "low-power" });
    if (!gl) { showStill(); tell({ error: "no_webgl" }); return; }
    function compile(kind, text) { var shader = gl.createShader(kind); gl.shaderSource(shader, text); gl.compileShader(shader); return shader; }
    var fragment = compile(gl.FRAGMENT_SHADER, config.head + source + "\\n" + config.glassPass);
    if (!gl.getShaderParameter(fragment, gl.COMPILE_STATUS)) { tell({ compileError: (gl.getShaderInfoLog(fragment) || "").trim().split("\\n")[0] || "It didn't compile." }); return; }
    var program = gl.createProgram(); gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX)); gl.attachShader(program, fragment); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { tell({ compileError: (gl.getProgramInfoLog(program) || "It didn't link.").trim().split("\\n")[0] }); return; }
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var corner = gl.getAttribLocation(program, "corner"); gl.enableVertexAttribArray(corner); gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
    at = {}; ["iResolution", "iTime", "zaismaPanes", "zaismaPaneCuts", "zaismaPaneCount", "zaismaPixel", "zaismaViewOffset"].forEach(function (name) { at[name] = gl.getUniformLocation(program, name); });
    canvas.hidden = false; still.hidden = true; isHeld = false; slowS = 0;
    size(); draw(); tell({ isRunning: true });
  }
  function draw() {
    // The wall clock: moving from page to page, the background carries on where it was instead of starting over.
    var timeS = reduced.matches ? config.stillTimeSec : (Date.now() / 1000) % 3600;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform3f(at.iResolution, canvas.width, canvas.height, 1); gl.uniform1f(at.iTime, timeS);
    gl.uniform4fv(at.zaismaPanes, panes.rects); gl.uniform4fv(at.zaismaPaneCuts, panes.cuts); gl.uniform1f(at.zaismaPaneCount, panes.count);
    gl.uniform1f(at.zaismaPixel, canvas.width / Math.max(1, window.innerWidth)); gl.uniform2f(at.zaismaViewOffset, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function frame(nowMs) {
    requestAnimationFrame(frame);
    if (!gl || !at.iTime || document.hidden || isHeld || reduced.matches || nowMs - lastMs < 1000 / config.maximumFps - 1) return;
    var gapMs = nowMs - lastMs; lastMs = nowMs;
    // A device that can't keep up gets fewer pixels, then holds the frame it has.
    if (gapMs < 1000) {
      slowS = gapMs > 50 ? slowS + gapMs / 1000 : Math.max(0, slowS - gapMs / 2000);
      if (slowS > 1.5) { slowS = 0; if (scale > 0.26) { scale *= 0.75; size(); } else { isHeld = true; return; } }
    }
    draw();
  }
  window.addEventListener("message", function (event) {
    if (event.origin !== config.site || !event.data || typeof event.data !== "object") return;
    if (Array.isArray(event.data.panes)) {
      panes.css = event.data.panes.filter(function (pane) { return pane && Array.isArray(pane.rect) && pane.rect.length === 4 && Array.isArray(pane.cuts) && pane.cuts.length === 4; }).map(function (pane) {
        return { rect: pane.rect.map(Number), cuts: pane.cuts.map(Number), isSmoked: pane.isSmoked === true };
      });
      placePanes(); if (gl && at.iTime) draw();
    }
    if (config.isPreview && typeof event.data.source === "string") start(event.data.source);
  });
  window.addEventListener("resize", size);
  reduced.addEventListener("change", function () { if (gl && at.iTime) draw(); });
  requestAnimationFrame(frame);
  if (config.isPreview) { tell({ isReady: true }); return; }
  // Under reduced motion the still shows, and nothing runs.
  if (reduced.matches) { showStill(); return; }
  fetch(config.sourceUrl).then(function (response) { return response.ok ? response.text() : Promise.reject(); }).then(start, showStill);
})();`;

function runnerPage(config: Record<string, unknown>, stillUrl: string | null): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Background</title>
<style>html, body { margin: 0; height: 100%; overflow: hidden; background: #000; } canvas, img { position: fixed; inset: 0; width: 100%; height: 100%; display: block; object-fit: cover; } [hidden] { display: none; }</style></head>
<body><canvas hidden></canvas><img alt="" hidden${stillUrl ? ` data-src="${stillUrl}"` : ""}>
<script>var __ZAISMA_BACKGROUND__ = ${JSON.stringify(config).replace(/</g, "\\u003c")};\n${RUNNER_SCRIPT}</script></body></html>`;
}

const runnerConfig = (env: BackgroundEnv) => ({
  site: env.SITE_ORIGIN,
  head: SHADER_HEAD,
  glassPass: GLASS_LIGHT_PASS,
  paneLimit: MOST_GLASS_PANE_COUNT,
  resolutionScale: SHADER_LIMITS.runtimeResolutionScale,
  maximumFps: SHADER_LIMITS.runtimeMaximumFps,
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
  const kind = path === "_zaisma/background" ? "page" : path === "_zaisma/background.glsl" ? "source" : path === "_zaisma/background-still.png" ? "still" : null;
  if (!kind) return null;
  const isShown = game.review_status === "live" && Boolean(game.live_version_id) && (game.visibility === "listed" || game.visibility === "unlisted");
  const screen = new URL(request.url).searchParams.get("screen");
  if (!isShown || (screen !== "wide" && screen !== "phone")) return notFound();
  const shader = await chosenShader(env, game, screen);
  if (!shader) return notFound();
  if (kind === "page") {
    const headers = gameHeaders("text/html; charset=utf-8", env.SITE_ORIGIN);
    headers.set("Cache-Control", "no-cache");
    const page = runnerPage({ ...runnerConfig(env), isPreview: false, sourceUrl: `${base}_zaisma/background.glsl?screen=${screen}&shader=${shader.id}` }, `${base}_zaisma/background-still.png?screen=${screen}&shader=${shader.id}`);
    return new Response(request.method === "HEAD" ? null : page, { headers });
  }
  const object = await env.GAMES.get(kind === "source" ? shaderKey(game.id, shader.id) : shaderStillKey(game.id, shader.id));
  if (!object) return notFound();
  const headers = gameHeaders(kind === "source" ? "text/plain; charset=utf-8" : "image/png", env.SITE_ORIGIN);
  // A chosen shader's files never change: a new choice is a new shader ID in the runner's links.
  headers.set("Cache-Control", "public, max-age=300");
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}
