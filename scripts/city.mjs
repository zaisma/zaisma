#!/usr/bin/env node
// The sign-in city (apps/site/src/components/city.ts) in headless Chrome on this machine's GPU, against this checkout's preview:
//
//   node scripts/city.mjs shots   [--at 0,30,60] [--beam 2.7,3.4] [--sizes phone,desktop] [--themes light,dark] [--bare] [--out <folder>]
//       Screenshots of /signin with the camera held at those seconds of its loop, as PNGs (--bare hides the pane). The Relay's firing
//       is held where the page opens on it, or with --beam at those seconds of a firing (a negative one: at rest), one shot each.
//   node scripts/city.mjs frames  [--seconds 8] [--start 0] [--beam 3.4] [--sizes phone,desktop] [--themes light,dark] [--throttle 4] [--software] [--json <file>]
//       Time to the first shown frame, long tasks while it builds, frame intervals, and the city's JS and GPU time per frame (--start
//       starts the camera at that second of its loop; --beam holds the Relay's firing at that second of it, a negative one at rest).
//   node scripts/city.mjs stills
//       Renders the four stills (brand/sign-in/) as the live city's first frame, and writes their tiny placeholders into city.ts.
//   node scripts/city.mjs report  [--at 0] [--sizes phone,desktop] [--themes light,dark]
//       What the city says of itself once it shows (window.zaismaCityTool.report()): its phase and when it reached each, its tier,
//       its canvas, the screen's frame interval, the frames it drew, and its rows with their checksum. frames --json includes it too.
//   Every command takes --base <site> to run against another site (the live one: https://zaisma.com) with no preview here, and with it
//       --own-script, which puts this checkout's city script in place of the site's, to measure a change against what's live.
//
// Sizes: phone (320 x 667 at 2x, touch), phone3 (the same at 3x), desktop (1440 x 900), retina (1440 x 900 at 2x) and big (2560 x 1440). The city reads
// window.zaismaCityTool, set here before each page loads, to start or hold its camera, pin its Relay's firing and render a still.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openChrome } from "./chrome.mjs";
import { chromeToRun, previewSites } from "./layout-check.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SIZES = {
  phone: { widthPx: 320, heightPx: 667, pixelRatio: 2, isPhone: true },
  phone3: { widthPx: 320, heightPx: 667, pixelRatio: 3, isPhone: true },
  desktop: { widthPx: 1440, heightPx: 900, pixelRatio: 1, isPhone: false },
  retina: { widthPx: 1440, heightPx: 900, pixelRatio: 2, isPhone: false },
  big: { widthPx: 2560, heightPx: 1440, pixelRatio: 1, isPhone: false },
};
/** The stills: wide ones at the wide view's height of view, phone ones at the phone's, both wider than any screen they're shown on. */
const STILLS = [
  { name: "city-day", theme: "light", widthPx: 3900, heightPx: 1500, isPhoneView: false, tinyWidthPx: 72, tinyHeightPx: 28 },
  { name: "city-night", theme: "dark", widthPx: 3900, heightPx: 1500, isPhoneView: false, tinyWidthPx: 72, tinyHeightPx: 28 },
  { name: "city-day-phone", theme: "light", widthPx: 1500, heightPx: 1500, isPhoneView: true, tinyWidthPx: 36, tinyHeightPx: 36 },
  { name: "city-night-phone", theme: "dark", widthPx: 1500, heightPx: 1500, isPhoneView: true, tinyWidthPx: 36, tinyHeightPx: 36 },
];

/** Counts the city's frames, its JS and GPU time per frame, long tasks, and when it showed or fell back to its still. */
const INSTRUMENT = `(() => {
  const S = window.__city = { frames: [], cpu: [], gpu: [], longTasks: [], shownAt: null, stillAt: null, contextAt: null, measuring: false };
  const raf = window.requestAnimationFrame.bind(window), pending = [];
  // A query from before a lost context is no query any more: it's dropped, so the ones after it are still read.
  function poll() { const gl = S.gl, ext = S.timer; while (pending.length && (!gl.isQuery(pending[0]) || gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE))) { const q = pending.shift(); if (!gl.isQuery(q)) continue; if (!gl.getParameter(ext.GPU_DISJOINT_EXT) && S.measuring) S.gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); } }
  window.requestAnimationFrame = (callback) => raf((time) => {
    const gl = S.gl, ext = S.timer; let query = null;
    if (gl && ext && S.measuring && !gl.isContextLost()) { poll(); query = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, query); }
    const start = performance.now();
    try { callback(time); } finally { if (query) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(query); } if (S.measuring) S.cpu.push(performance.now() - start); }
  });
  (function tick(time) { if (S.measuring) S.frames.push(time); raf(tick); })();
  try { new PerformanceObserver((list) => list.getEntries().forEach((e) => S.longTasks.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: "longtask", buffered: true }); } catch {}
  // The city's context, and again whenever a new canvas.city gets one (the city swaps in a fresh canvas after a lost context), so it stays measured.
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, options) {
    const gl = getContext.call(this, kind, options);
    if (gl && this.classList.contains("city") && S.gl !== gl) { if (!S.gl) S.contextAt = performance.now(); S.gl = gl; pending.length = 0; S.timer = null; try { S.timer = gl.getExtension("EXT_disjoint_timer_query_webgl2"); } catch {} }
    return gl;
  };
  new MutationObserver(() => {
    const canvas = document.querySelector("canvas.city"), stage = document.querySelector(".city-stage");
    if (canvas && canvas.classList.contains("on") && !S.shownAt) S.shownAt = performance.now();
    if (stage && stage.classList.contains("is-still") && !S.stillAt) S.stillAt = performance.now();
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ["class"] });
})();`;

const HIDE_PANE = `document.addEventListener("DOMContentLoaded", () => { const style = document.createElement("style"); style.textContent = ".city-page { visibility: hidden !important; } #feedback-root, [data-feedback] { display: none !important; }"; document.head.appendChild(style); });`;

function option(args, name, fallback) {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
}
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
function stats(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), at = (q) => +sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].toFixed(2);
  return { count: values.length, median: at(0.5), p95: at(0.95), max: +sorted.at(-1).toFixed(2) };
}

/** A fresh tab at size and theme with the instrument and the tool settings in, at url once the city shows (or its still does). */
async function openCity(chrome, url, { size, theme, tool = {}, throttle = 1, isBare = false }) {
  const { browserContextId } = await chrome.send("Target.createBrowserContext");
  const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params = {}) => chrome.send(method, params, sessionId);
  const errors = [];
  chrome.listen(sessionId, (method, params) => {
    if (method === "Runtime.exceptionThrown") errors.push(params.exceptionDetails.exception?.description || params.exceptionDetails.text);
    if (method === "Runtime.consoleAPICalled" && (params.type === "error" || params.type === "warning")) errors.push(params.args.map((arg) => arg.value ?? arg.description).join(" "));
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: size.widthPx, height: size.heightPx, deviceScaleFactor: size.pixelRatio, mobile: size.isPhone });
  await send("Emulation.setTouchEmulationEnabled", size.isPhone ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "no-preference" }] });
  if (throttle > 1) await send("Emulation.setCPUThrottlingRate", { rate: throttle });
  // --base with --own-script: the site's pages with this checkout's city script in place of the site's, to compare against it.
  if (ownScript) {
    await send("Fetch.enable", { patterns: [{ urlPattern: "*/js/city.*.js" }] });
    chrome.listen(sessionId, (method, params) => {
      if (method === "Fetch.requestPaused") send("Fetch.fulfillRequest", { requestId: params.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "text/javascript" }], body: Buffer.from(ownScript).toString("base64") });
    });
  }
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.zaismaCityTool = ${JSON.stringify(tool)};${INSTRUMENT}${isBare ? HIDE_PANE : ""}` });
  const loaded = new Promise((done) => {
    const off = chrome.listen(sessionId, (method) => method === "Page.loadEventFired" && (off(), done()));
  });
  await send("Page.navigate", { url });
  await Promise.race([loaded, wait(30_000)]);
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
  for (let i = 0; i < 600; i++) {
    const [shownAt, stillAt] = await evaluate("[window.__city.shownAt, window.__city.stillAt]");
    if (shownAt || stillAt) break;
    await wait(100);
  }
  const close = async () => {
    await chrome.send("Target.closeTarget", { targetId });
    await chrome.send("Target.disposeBrowserContext", { browserContextId });
  };
  return { send, evaluate, errors, close };
}

async function shots(chrome, site, args) {
  const at = option(args, "at", "0,20,40,60,80,100").split(",").map(Number);
  const out = option(args, "out", join(ROOT, ".wrangler/city-shots"));
  const path = option(args, "path", "/signin");
  const beams = option(args, "beam", null)?.split(",").map(Number) ?? [null];
  mkdirSync(out, { recursive: true });
  for (const sizeName of option(args, "sizes", "phone,desktop").split(",")) for (const theme of option(args, "themes", "light,dark").split(",")) for (const second of at) for (const beamSec of beams) {
    const tool = beamSec === null ? { startSec: second, isHeld: true } : { startSec: second, isHeld: true, beamSec };
    const page = await openCity(chrome, site + path, { size: SIZES[sizeName], theme, tool, isBare: args.includes("--bare") });
    await wait(Number(option(args, "settle", "2200")));
    const { data } = await page.send("Page.captureScreenshot", { format: "png" });
    const file = join(out, `${sizeName}-${theme}-${String(second).padStart(3, "0")}${beamSec === null ? "" : `-beam${beamSec}`}.png`);
    writeFileSync(file, Buffer.from(data, "base64"));
    console.log(`${file}${page.errors.length ? `  errors: ${page.errors.join(" / ")}` : ""}`);
    await page.close();
  }
}

/** What the city says of itself (window.zaismaCityTool.report()), or null where it has no report. */
const REPORT = "(() => { const tool = window.zaismaCityTool; try { return tool && tool.report ? tool.report() : null; } catch (error) { return { error: String(error) }; } })()";

async function report(chrome, site, args) {
  const second = Number(option(args, "at", "0")), path = option(args, "path", "/signin");
  for (const sizeName of option(args, "sizes", "phone,desktop").split(",")) for (const theme of option(args, "themes", "light,dark").split(",")) {
    const page = await openCity(chrome, site + path, { size: SIZES[sizeName], theme, tool: { startSec: second, isHeld: true } });
    await wait(Number(option(args, "settle", "1000")));
    console.log(`${sizeName.padEnd(7)} ${theme.padEnd(5)} ${JSON.stringify(await page.evaluate(REPORT))}${page.errors.length ? `  errors: ${page.errors.join(" / ")}` : ""}`);
    await page.close();
  }
}

async function frames(chrome, site, args) {
  const seconds = Number(option(args, "seconds", "8")), throttle = Number(option(args, "throttle", "1")), path = option(args, "path", "/signin");
  const results = [];
  for (const sizeName of option(args, "sizes", "phone,desktop").split(",")) for (const theme of option(args, "themes", "light,dark").split(",")) {
    const tool = option(args, "start", null) === null ? {} : { startSec: Number(option(args, "start", "0")) };
    if (option(args, "beam", null) !== null) tool.beamSec = Number(option(args, "beam", "0"));
    const page = await openCity(chrome, site + path, { size: SIZES[sizeName], theme, throttle, tool });
    await page.evaluate("window.__city.measuring = true");
    await wait(seconds * 1000);
    const data = await page.evaluate(`(() => { const S = window.__city; S.measuring = false; const canvas = document.querySelector("canvas.city"); let renderer = null;
      try { const info = S.gl && S.gl.getExtension("WEBGL_debug_renderer_info"); renderer = info ? S.gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null; } catch {}
      return { shownAt: S.shownAt, stillAt: S.stillAt, contextAt: S.contextAt, longTasks: S.longTasks, frames: S.frames, cpu: S.cpu, gpu: S.gpu, canvas: canvas && [canvas.width, canvas.height], renderer }; })()`);
    const intervals = data.frames.slice(1).map((time, i) => time - data.frames[i]);
    const shown = data.shownAt || data.stillAt || 0;
    const result = {
      size: sizeName, theme, throttle, renderer: data.renderer, canvasPx: data.canvas,
      contextAtMs: data.contextAt && Math.round(data.contextAt), firstShownMs: data.shownAt && Math.round(data.shownAt), stillAtMs: data.stillAt && Math.round(data.stillAt),
      longTasksBeforeShownMs: data.longTasks.filter(([start]) => start < shown + 50).map(([, duration]) => duration), longTasksAfterShownMs: data.longTasks.filter(([start]) => start >= shown + 50).map(([, duration]) => duration),
      longTasksAtMs: data.longTasks,
      frameIntervalMs: stats(intervals), framesOver20MsPercent: intervals.length ? +((100 * intervals.filter((value) => value > 20).length) / intervals.length).toFixed(1) : null,
      cityJsMs: stats(data.cpu), cityGpuMs: stats(data.gpu), errors: page.errors, report: await page.evaluate(REPORT),
    };
    results.push(result);
    console.log(`${sizeName.padEnd(7)} ${theme.padEnd(5)} shown ${String(result.firstShownMs ?? "-").padStart(5)} ms${result.stillAtMs ? ` still at ${result.stillAtMs} ms` : ""} | long tasks before ${result.longTasksBeforeShownMs.join(",") || "none"}, after ${result.longTasksAfterShownMs.join(",") || "none"} | frames median ${result.frameIntervalMs?.median} p95 ${result.frameIntervalMs?.p95} max ${result.frameIntervalMs?.max}, ${result.framesOver20MsPercent}% over 20 ms | js median ${result.cityJsMs?.median} p95 ${result.cityJsMs?.p95} | gpu median ${result.cityGpuMs?.median} p95 ${result.cityGpuMs?.p95} max ${result.cityGpuMs?.max} | ${data.canvas}${page.errors.length ? ` | errors: ${page.errors.join(" / ")}` : ""}`);
    await page.close();
  }
  const json = option(args, "json", null);
  if (json) writeFileSync(json, JSON.stringify(results, null, 2));
}

async function stills(chrome, site) {
  const cityPath = join(ROOT, "apps/site/src/components/city.ts");
  let source = readFileSync(cityPath, "utf8");
  for (const still of STILLS) {
    const page = await openCity(chrome, `${site}/signin`, { size: { widthPx: still.widthPx, heightPx: still.heightPx, pixelRatio: 1, isPhone: false }, theme: still.theme, tool: { isStill: true, isPhoneView: still.isPhoneView, isHeld: true }, isBare: true });
    await wait(2500);
    const { data } = await page.send("Page.captureScreenshot", { format: "webp", quality: 82 });
    writeFileSync(join(ROOT, "brand/sign-in", `${still.name}.webp`), Buffer.from(data, "base64"));
    const tiny = await page.evaluate(`(async () => { const image = new Image(); image.src = "data:image/webp;base64,${data}"; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = ${still.tinyWidthPx}; canvas.height = ${still.tinyHeightPx};
      const context = canvas.getContext("2d"); context.imageSmoothingQuality = "high"; context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/webp", 0.6); })()`);
    // The placeholder's line in CITY_STYLES: the wide ones first, then the phone ones inside the phone's media query.
    const selector = `.city-stage .city-still.is-${still.theme === "light" ? "day" : "night"} { --still-tiny: url(`;
    const fullUrl = `--still-full: url(/sign-in/${still.name}.webp);`;
    const lineStart = source.split("\n").findIndex((line) => line.includes(selector) && line.includes(fullUrl));
    if (lineStart === -1) throw new Error(`No placeholder line for ${still.name} in city.ts`);
    const lines = source.split("\n");
    lines[lineStart] = lines[lineStart].replace(/--still-tiny: url\([^)]*\);/, `--still-tiny: url(${tiny});`);
    source = lines.join("\n");
    console.log(`brand/sign-in/${still.name}.webp (${Math.round(Buffer.from(data, "base64").length / 1024)} KB), placeholder ${tiny.length} characters${page.errors.length ? `  errors: ${page.errors.join(" / ")}` : ""}`);
    await page.close();
  }
  writeFileSync(cityPath, source);
}

const [command, ...args] = process.argv.slice(2);
/** This checkout's city script (CITY_SCRIPT's text in city.ts), for --own-script. */
const ownScript = args.includes("--own-script") ? (() => {
  const source = readFileSync(join(ROOT, "apps/site/src/components/city.ts"), "utf8"), start = source.indexOf('pageScript("city", String.raw`') + 'pageScript("city", String.raw`'.length;
  return source.slice(start, source.indexOf("`);", start));
})() : null;
if (!["shots", "frames", "stills", "report"].includes(command)) {
  console.log("Usage: node scripts/city.mjs shots|frames|stills|report [options] (see the top of scripts/city.mjs)");
  process.exit(1);
}
// --base points it at another site (the live one), which needs no preview here.
const sites = option(args, "base", null) ? {} : previewSites();
if (!sites) throw new Error("The preview didn't start: see .wrangler/preview-run/preview.log.");
const chrome = await openChrome(await chromeToRun(), "zaisma-city-", { isGpu: !args.includes("--software") });
try {
  if (command === "shots") await shots(chrome, option(args, "base", sites.site), args);
  else if (command === "frames") await frames(chrome, option(args, "base", sites.site), args);
  else if (command === "report") await report(chrome, option(args, "base", sites.site), args);
  else await stills(chrome, option(args, "base", sites.site));
} finally {
  await chrome.close();
}
