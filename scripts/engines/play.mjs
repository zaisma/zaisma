#!/usr/bin/env node
// Plays each engine sample (test/engines/<engine>/build) on this checkout's running preview, in headless
// Chrome, and checks it got there unchanged and works: the upload command sent it, the scan passed it on
// its own (scripts/preview/run.mjs seeds them with no hand approval), and on its game page the engine
// starts, draws moving frames, and throws nothing and is refused nothing (no blocked file or address); Zaisma's own run
// in Chrome found it starting, and the files its page preloads are the ones the game then uses.
//
//   npm run engines:play                    against this checkout's preview (npm run preview:start first)
//   CHROME_PATH=/path/to/chrome npm run engines:play
//
// Chrome is driven over its DevTools protocol with Node's own WebSocket, so it needs no dependency. Each
// sample says it started by setting window.zaismaEngineSample = { engine, version, started: true }.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const START_TIMEOUT_MS = 90_000;
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
const engines = readdirSync(join(ROOT, "test/engines"), { withFileTypes: true }).filter((entry) => entry.isDirectory() && existsSync(join(ROOT, "test/engines", entry.name, "build/index.html"))).map((entry) => entry.name);
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

const chrome = await openChrome();
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
    }
    for (const problem of new Set(problems)) fail(`${sample.engine}: ${problem}`);
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

/** Headless Chrome with WebGL in software (CI runners have no GPU), and a DevTools connection to it. */
async function openChrome() {
  const path = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ...playwrightChromes(),
  ].find((candidate) => candidate && existsSync(candidate));
  if (!path) stop("No Chrome found: set CHROME_PATH to a Chrome or Chromium.");
  const profile = mkdtempSync(join(tmpdir(), "zaisma-engines-"));
  const child = spawn(path, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const address = await new Promise((resolve, reject) => {
    let output = "";
    child.stderr.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) resolve(match[1]);
    });
    child.on("exit", (code) => reject(new Error(`Chrome stopped (${code}): ${output.slice(-500)}`)));
  });
  const socket = new WebSocket(address);
  await new Promise((resolve, reject) => ((socket.onopen = resolve), (socket.onerror = reject)));
  let nextId = 1;
  const waiting = new Map();
  const listeners = new Set();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && waiting.has(message.id)) {
      const { resolve, reject } = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    } else if (message.method) for (const listener of listeners) listener(message);
  };
  return {
    send: (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        waiting.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      }),
    listen: (sessionId, onEvent) => {
      const listener = (message) => message.sessionId === sessionId && onEvent(message.method, message.params);
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // Chrome writes to its profile until it has exited, so it goes after.
    close: async () => {
      socket.close();
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await exited;
      rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}

/** Chromium that Playwright downloaded, newest first, for machines without Chrome. */
function playwrightChromes() {
  const cache = join(homedir(), process.platform === "darwin" ? "Library/Caches/ms-playwright" : ".cache/ms-playwright");
  if (!existsSync(cache)) return [];
  return readdirSync(cache)
    .filter((name) => name.startsWith("chromium-"))
    .sort()
    .reverse()
    .flatMap((name) => ["chrome-mac-arm64", "chrome-mac", "chrome-mac-x64"].map((folder) => join(cache, name, folder, "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")).concat(join(cache, name, "chrome-linux64/chrome"), join(cache, name, "chrome-linux/chrome")));
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
