#!/usr/bin/env node
// Plays each engine sample (test/engines/<engine>/build) on this checkout's running preview, in headless
// Chrome, and checks it got there unchanged and works: the upload command sent it, the scan passed it on
// its own (scripts/preview/run.mjs seeds them with no hand approval), and on its game page the engine
// starts, draws moving frames, and throws nothing and is refused nothing (no blocked file or address); Zaisma's own run
// in Chrome found it starting, the files its page preloads are the ones the game then uses, and the game page got
// Zaisma's measuring of how it ran.
//
//   npm run engines:play                    against this checkout's preview (npm run preview:start first)
//   CHROME_PATH=/path/to/chrome npm run engines:play
//
// Chrome is driven over its DevTools protocol with Node's own WebSocket, so it needs no dependency. Each
// sample says it started by setting window.zaismaEngineSample = { engine, version, started: true }.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, openChrome } from "../chrome.mjs";
import { engineSamples } from "./samples.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const START_TIMEOUT_MS = 90_000;
const REPORT_TIMEOUT_MS = 45_000;
// The first Chrome with Document-Isolation-Policy, which games need for threads.
const MINIMUM_ISOLATING_CHROME_VERSION = 137;

const failures = [];
const fail = (line) => {
  failures.push(line);
  console.log(`  FAIL ${line}`);
};

const state = readJson(join(ROOT, ".wrangler/preview-run/state.json"));
if (!state) stop("No preview is running in this checkout: start it with npm run preview:start -- --reset.");
const site = `http://localhost:${8800 + state.offset}`;
const samples = readJson(join(ROOT, ".wrangler/preview/engines.json"));
if (!samples) stop("The preview has no engine samples: start it with fresh test data, npm run preview:start -- --reset.");

// Every sample in the repo is in the preview, uploaded and passed by the scan by itself.
// Or ENGINE_SAMPLE_SHARD's share of them, as the preview was seeded (scripts/engines/samples.mjs).
const engines = engineSamples();
for (const engine of engines) {
  const sample = samples.find((candidate) => candidate.engine === engine);
  if (!sample) fail(`${engine}: not in the preview's test data. Start it with fresh test data: npm run preview:start -- --reset.`);
  else if (sample.upload_exit_code !== 0) fail(`${engine}: the upload command exited with ${sample.upload_exit_code} (3 held, 4 rejected).`);
  else if (sample.scan_status !== "approved") fail(`${engine}: the scan left it ${sample.scan_status}: ${JSON.stringify(sample.findings)}`);
  // Zaisma's own run in Chrome (apps/site/src/performance-check.ts) started it too, and found it working.
  else if (sample.performance_check?.check_status !== "checked") fail(`${engine}: its run in Chrome is ${sample.performance_check?.check_status ?? "missing"}, not checked.`);
  // Local Browser Run is miniflare's pinned Chrome, older than the 137 a threaded build needs (Document-Isolation-Policy): its run can't start one.
  else if (engine.endsWith("-threads") && Number(/Chrome (\d+)/.exec(sample.performance_check.browser_description)?.[1] ?? 0) < MINIMUM_ISOLATING_CHROME_VERSION) {
    console.log(`  skip ${engine}: its run in Chrome is on ${sample.performance_check.browser_description}, which can't isolate a game frame (${MINIMUM_ISOLATING_CHROME_VERSION}+)`);
  } else {
    const { loading_duration_sec: loadingDurationSec, notes } = sample.performance_check;
    if (loadingDurationSec === null) fail(`${engine}: its run in Chrome saw no first frame.`);
    for (const note of notes.filter((note) => ["error_at_start", "missing_file_at_start", "no_frame_drawn"].includes(note.code))) fail(`${engine}: its run in Chrome says ${note.code}: ${note.message}`);
  }
}

const chrome = await startChrome();
try {
  for (const sample of samples.filter((candidate) => engines.includes(candidate.engine) && candidate.scan_status === "approved")) {
    console.log(`${sample.engine}: ${site}/g/${sample.slug}?play`);
    await play(chrome, sample);
  }
} finally {
  await chrome.close();
}
if (failures.length) stop(`${failures.length} engine check(s) failed.`);
console.log(`ENGINES PASS: ${engines.join(", ")} uploaded, passed the scan and played.`);

/** Opens the sample's game page in a fresh tab and checks the engine starts, draws, and throws and is refused nothing. */
async function play(chrome, sample) {
  const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params = {}) => chrome.send(method, params, sessionId);
  // Every frame's scripts, by "<session> <context id>": the game's frame has its own process and DevTools
  // session (an out-of-process frame), since Document-Isolation-Policy isolates it.
  const contexts = new Map();
  const problems = [];
  const offs = [];
  const watch = (frameSessionId) => offs.push(chrome.listen(frameSessionId, (method, params) => onEvent(frameSessionId, method, params)));
  const onEvent = (frameSessionId, method, params) => {
    // Runtime.enable reports the contexts a frame already has, so nothing waits for it.
    if (method === "Target.attachedToTarget" && params.targetInfo.type === "iframe") {
      const childSessionId = params.sessionId;
      watch(childSessionId);
      for (const [childMethod, childParams] of [["Runtime.enable", {}], ["Log.enable", {}], ["Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }]]) chrome.send(childMethod, childParams, childSessionId).catch(() => {});
    }
    if (method === "Runtime.executionContextCreated") contexts.set(`${frameSessionId} ${params.context.id}`, { frameSessionId, contextId: params.context.id });
    if (method === "Runtime.executionContextDestroyed") contexts.delete(`${frameSessionId} ${params.executionContextId}`);
    if (method === "Runtime.exceptionThrown") problems.push(`threw: ${params.exceptionDetails.exception?.description ?? params.exceptionDetails.text}`.split("\n")[0]);
    // Engines report their own errors with console.error (Unity, Godot), and the game page's own count too.
    if (method === "Runtime.consoleAPICalled" && params.type === "error") problems.push(`console.error: ${params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ")}`.split("\n")[0]);
    // Refusals: a file or address the security policy blocked, a file that wasn't there.
    if (method === "Log.entryAdded" && params.entry.level === "error") problems.push(`${params.entry.source}: ${params.entry.text}${params.entry.url ? ` (${params.entry.url})` : ""}`);
    // A preload its page sent that the game's own request didn't use (First files preloaded) downloads twice.
    const unusedPreload = /preloaded using link preload but not used|preload for .* is found, but is not used/i;
    if ((method === "Log.entryAdded" && unusedPreload.test(params.entry.text)) || (method === "Runtime.consoleAPICalled" && params.type === "warning" && unusedPreload.test(params.args.map((arg) => arg.value ?? "").join(" ")))) {
      problems.push(`preload not used: ${method === "Log.entryAdded" ? params.entry.text : params.args.map((arg) => arg.value ?? "").join(" ")}`.split("\n")[0]);
    }
  };
  watch(sessionId);
  try {
    await send("Runtime.enable");
    await send("Log.enable");
    await send("Page.enable");
    await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    // What the game frame's measuring (packages/sdk/performance.js) sends the game page, kept for the check below.
    await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.zaismaPerformanceReports = []; addEventListener('message', (e) => { if (e.data && e.data.type === 'zaisma:performance') window.zaismaPerformanceReports.push(e.data); });" });
    await send("Page.navigate", { url: `${site}/g/${sample.slug}?play` });

    let started = null;
    let gameContext = null;
    for (const startedAt = Date.now(); !started && Date.now() - startedAt < START_TIMEOUT_MS; await wait(500)) {
      for (const context of contexts.values()) {
        const { result } = await chrome.send("Runtime.evaluate", { contextId: context.contextId, expression: "JSON.stringify(window.zaismaEngineSample ?? null)", returnByValue: true }, context.frameSessionId).catch(() => ({ result: {} }));
        const said = result.value ? JSON.parse(result.value) : null;
        if (said?.started) {
          started = said;
          gameContext = context;
        }
      }
    }
    if (!started) fail(`${sample.engine}: didn't start within ${START_TIMEOUT_MS / 1000} s.`);
    // A sample of one engine's other set-up (unity-fill) says its engine (unity).
    else if (started.engine !== sample.engine.split("-")[0]) fail(`${sample.engine}: the page says it's ${started.engine}.`);
    else {
      console.log(`  started: ${started.engine} ${started.version}`);
      // A threaded build (a folder ending in -threads) runs only in a game frame isolated by Document-Isolation-Policy.
      if (sample.engine.endsWith("-threads")) {
        const { result } = await chrome.send("Runtime.evaluate", { contextId: gameContext.contextId, expression: `crossOriginIsolated === true && typeof SharedArrayBuffer === "function"`, returnByValue: true }, gameContext.frameSessionId);
        if (result.value !== true) fail(`${sample.engine}: the game frame isn't cross-origin isolated`);
      }
      // Two pictures of the game a second apart: every sample moves, so a frozen or blank game shows as the same picture.
      await wait(2000);
      const first = await screenshot(send);
      await wait(1000);
      const second = await screenshot(send);
      if (first === second) fail(`${sample.engine}: the game didn't draw anything new in a second.`);
      // Chrome says a preload wasn't used a few seconds after the page loaded.
      await wait(3000);
      // Zaisma measured how it ran: a report with its load time and seconds of frames, its first 10 seconds in. It's waited for up to
      // REPORT_TIMEOUT_MS: on a busy runner a big build's first frames come slowly (the preview may still be making its Brotli copies).
      let measured = null;
      for (const waitedAt = Date.now(); !measured && Date.now() - waitedAt < REPORT_TIMEOUT_MS; await wait(1000)) {
        const { result } = await send("Runtime.evaluate", { expression: "JSON.stringify((window.zaismaPerformanceReports || []).find((report) => report.loading_duration_sec !== null && report.measured_duration_sec > 0) || null)", returnByValue: true });
        measured = JSON.parse(result.value ?? "null");
      }
      if (!measured) fail(`${sample.engine}: the game page got no performance report with a load time and frame seconds.`);
      else console.log(`  measured: drew in ${measured.loading_duration_sec} s, ${measured.measured_duration_sec} s of frames`);
    }
    // Emscripten's pthreads warn on every threaded build that waits on the main thread (Godot's does): a warning, not a failure.
    const isThreadsWarning = (problem) => sample.engine.endsWith("-threads") && problem.startsWith("console.error: Blocking on the main thread is very dangerous");
    for (const problem of new Set(problems)) if (!isThreadsWarning(problem)) fail(`${sample.engine}: ${problem}`);
  } finally {
    for (const off of offs) off();
    await chrome.send("Target.closeTarget", { targetId }).catch(() => {});
  }
}

/** The game's frame, as a picture. */
async function screenshot(send) {
  const { result } = await send("Runtime.evaluate", { expression: `JSON.stringify((document.querySelector("iframe") ?? document.body).getBoundingClientRect())`, returnByValue: true });
  const { x, y, width, height } = JSON.parse(result.value);
  const { data } = await send("Page.captureScreenshot", { format: "png", clip: { x, y, width: Math.max(1, width), height: Math.max(1, height), scale: 0.5 } });
  return data;
}

/** Headless Chrome (scripts/chrome.mjs): CHROME_PATH, the system's, or one downloaded. */
async function startChrome() {
  const path = await findChrome();
  if (!path) stop("No Chrome found: set CHROME_PATH to a Chrome or Chromium.");
  return openChrome(path, "zaisma-engines-");
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stop(message) {
  console.log(`ENGINES FAIL: ${message}`);
  process.exit(1);
}
