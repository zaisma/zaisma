// Headless Chrome, for `zaisma check` on a shader's folder and Zaisma's own scripts that look at pages in a real browser
// (scripts/chrome.mjs), driven over its DevTools protocol with Node's own WebSocket (Node 22 or newer), so it needs no dependency and
// never downloads a browser. Chrome is the one in CHROME_PATH, the system's, or one Playwright or @puppeteer/browsers downloaded.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/** Where Chrome is on each system, when it's installed. */
const SYSTEM_CHROMES = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ...[process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean).map((folder) => join(folder, "Google/Chrome/Application/chrome.exe")),
];

/** A Chrome on this machine, or null: CHROME_PATH, the system's, then one downloaded into downloadFolders (as @puppeteer/browsers lays them out), puppeteer's own cache, or Playwright's. */
export function findChrome(downloadFolders = []) {
  const downloaded = [...downloadFolders, join(homedir(), ".cache/puppeteer")].flatMap((folder) => downloadedChromes(folder));
  return [process.env.CHROME_PATH, ...SYSTEM_CHROMES, ...downloaded, ...playwrightChromes()].find((candidate) => candidate && existsSync(candidate)) ?? null;
}

const newestFirst = (names) => names.sort((first, second) => second.localeCompare(first, "en", { numeric: true }));
const listed = (folder) => (existsSync(folder) ? readdirSync(folder) : []);

/** Chrome for Testing that @puppeteer/browsers installed in a folder (<folder>/chrome/<platform>-<build>/chrome-<platform>/…), newest first. */
function downloadedChromes(folder) {
  return newestFirst(listed(join(folder, "chrome"))).flatMap((build) =>
    listed(join(folder, "chrome", build))
      .filter((name) => name.startsWith("chrome-"))
      .flatMap((name) => {
        const inside = join(folder, "chrome", build, name);
        return [join(inside, "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"), join(inside, "chrome"), join(inside, "chrome.exe")];
      }),
  );
}

/** Chromium that Playwright downloaded, newest first. */
function playwrightChromes() {
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), process.platform === "darwin" ? "Library/Caches/ms-playwright" : process.platform === "win32" ? "AppData/Local/ms-playwright" : ".cache/ms-playwright");
  return newestFirst(listed(cache).filter((name) => name.startsWith("chromium-"))).flatMap((name) =>
    ["chrome-mac-arm64", "chrome-mac", "chrome-mac-x64"]
      .map((folder) => join(cache, name, folder, "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"))
      .concat(join(cache, name, "chrome-mac/Chromium.app/Contents/MacOS/Chromium"), join(cache, name, "chrome-linux64/chrome"), join(cache, name, "chrome-linux/chrome"), join(cache, name, "chrome-win/chrome.exe"), join(cache, name, "chrome-win64/chrome.exe")),
  );
}

/**
 * Headless Chrome at path with WebGL in software (SwiftShader, as on Zaisma's check and on machines without a GPU), or on the machine's
 * own GPU with isGpu (scripts/city.mjs times and renders the city on it), or with no GPU and no WebGL at all with isDrawingOnCpu (the
 * layout check measures boxes, not pixels), and a DevTools connection to it: send(method, parameters,
 * sessionId), listen(sessionId, onEvent) and close().
 */
export async function openChrome(path, profilePrefix, { isGpu = false, isDrawingOnCpu = false } = {}) {
  await sweepOrphans();
  // A folder for each Chrome: OWNER_FILE, which says whose it is, and Chrome's profile inside, removed before the folder so a profile
  // that can't be removed yet keeps its owner for the next sweep.
  const folder = mkdtempSync(join(tmpdir(), profilePrefix));
  const profile = join(folder, "profile");
  mkdirSync(profile);
  const webgl = isDrawingOnCpu ? ["--disable-gpu"] : isGpu ? ["--enable-gpu", "--ignore-gpu-blocklist", ...(process.platform === "darwin" ? ["--use-angle=metal"] : [])] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
  let child;
  try {
    child = spawn(path, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", ...webgl, "--autoplay-policy=no-user-gesture-required", "--hide-scrollbars", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (error) {
    rmSync(folder, { recursive: true, force: true });
    throw error;
  }
  const running = { child, folder, profile };
  if (child.pid) {
    writeFileSync(join(folder, OWNER_FILE), JSON.stringify({ owner_process_id: process.pid, chrome_process_id: child.pid }));
    keepUntilExit(running);
  }
  const giveUp = (error) => {
    child.kill("SIGKILL");
    removeFolder(running);
    letGo(running);
    throw error;
  };
  const address = await new Promise((resolve, reject) => {
    let output = "";
    child.stderr.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) resolve(match[1]);
    });
    child.on("error", (error) => reject(error));
    child.on("exit", (code) => reject(new Error(`Chrome stopped (${code}): ${output.slice(-500)}`)));
  }).catch(giveUp);
  const socket = new WebSocket(address);
  await new Promise((resolve, reject) => ((socket.onopen = resolve), (socket.onerror = reject))).catch(giveUp);
  let nextMessageNumber = 1;
  const waiting = new Map();
  const listeners = new Set();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && waiting.has(message.id)) {
      const { resolve, reject } = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    } else if (message.method) for (const listener of listeners) listener(message);
  };
  return {
    send: (method, parameters = {}, sessionId) =>
      new Promise((resolve, reject) => {
        const id = nextMessageNumber++;
        waiting.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params: parameters, ...(sessionId ? { sessionId } : {}) }));
      }),
    listen: (sessionId, onEvent) => {
      const listener = (message) => message.sessionId === sessionId && onEvent(message.method, message.params);
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // Chrome writes to its profile until it has exited, so it goes after.
    close: async () => {
      socket.close();
      const exited = new Promise((resolve) => (child.exitCode !== null || child.signalCode !== null ? resolve() : child.once("exit", resolve)));
      child.kill();
      await exited;
      await endAndRemove([running]);
      letGo(running);
    },
  };
}

/** The file in each Chrome's folder that says whose it is: { owner_process_id, chrome_process_id }. */
const OWNER_FILE = "zaisma-chrome-owner.json";
const STOP_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];
/** The Chromes this process started and hasn't closed. */
const runningChromes = new Set();

// Chrome outlives the node process that started it unless something stops it: a script that exits without close(), or is stopped by a
// signal that skips its finally, would leave Chrome and its helpers running. So each one is killed when this process exits, and on
// SIGINT, SIGTERM and SIGHUP, which then end the process as they would have (a script with a handler of its own keeps its say).
function stopAll() {
  const runnings = [...runningChromes];
  runningChromes.clear();
  // Nothing can be awaited on exit, so this waits in place, only as long as Chrome's processes take to end.
  const deadlineMs = Date.now() + EXIT_TIME_LIMIT_MS;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  while (killAll(runnings) && Date.now() < deadlineMs) Atomics.wait(pause, 0, 0, 50);
  for (const running of runnings) removeFolder(running);
}
async function onSignal(signal) {
  if (process.listenerCount(signal) > 1) return;
  removeHandlers();
  const runnings = [...runningChromes];
  runningChromes.clear();
  await endAndRemove(runnings);
  process.kill(process.pid, signal);
}
function addHandlers() {
  process.on("exit", stopAll);
  for (const signal of STOP_SIGNALS) process.on(signal, onSignal);
}
function removeHandlers() {
  process.off("exit", stopAll);
  for (const signal of STOP_SIGNALS) process.off(signal, onSignal);
}
function keepUntilExit(running) {
  if (!runningChromes.size) addHandlers();
  runningChromes.add(running);
}
function letGo(running) {
  if (runningChromes.delete(running) && !runningChromes.size) removeHandlers();
}

/** How long Chrome's processes get to end after SIGKILL before their folders are removed anyway: on exit, which holds the process up, and otherwise. */
const EXIT_TIME_LIMIT_MS = 2_000;
const END_TIME_LIMIT_MS = 5_000;

/**
 * Sends SIGKILL to every process of these Chromes still running (the one started here, and each whose command line names its profile:
 * the helpers, or a dead owner's Chrome), and says whether there were any. Chrome's helpers write to the profile until they've exited,
 * so a folder is removed only once this finds none.
 */
function killAll(runnings) {
  const children = runnings.flatMap(({ child }) => (child && child.exitCode === null && child.signalCode === null ? [child] : []));
  const processNumbers = profileProcessNumbers(runnings.map(({ profile }) => profile));
  for (const child of children) child.kill("SIGKILL");
  for (const processNumber of processNumbers) {
    try {
      process.kill(processNumber, "SIGKILL");
    } catch {}
  }
  return children.length > 0 || processNumbers.length > 0;
}

/** Kills these Chromes and removes their folders once their processes have ended. */
async function endAndRemove(runnings) {
  const deadlineMs = Date.now() + END_TIME_LIMIT_MS;
  while (killAll(runnings) && Date.now() < deadlineMs) await new Promise((resolve) => setTimeout(resolve, 50));
  for (const running of runnings) removeFolder(running);
}

/** The processes whose command line names one of these profiles; Windows has no ps, so none there. */
function profileProcessNumbers(profiles) {
  if (process.platform === "win32" || !profiles.length) return [];
  const listed = spawnSync("ps", ["-A", "-o", "pid=,command="], { encoding: "utf8" }).stdout ?? "";
  return listed.split("\n").flatMap((line) => {
    const [, processNumber, command] = line.match(/^\s*(\d+)\s+(.*)$/) ?? [];
    return processNumber && profiles.some((profile) => command.includes(`--user-data-dir=${profile}`)) ? [Number(processNumber)] : [];
  });
}

/** Removes a Chrome's profile, then its folder; one that can't be removed yet stays, with its owner, for the next sweep. */
function removeFolder({ folder, profile }) {
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
    rmSync(folder, { recursive: true, force: true });
  } catch {}
}

const isAlive = (processNumber) => {
  try {
    process.kill(processNumber, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};

/**
 * Kills the Chromes, and removes the folders, of owners that died without closing them (SIGKILL, a crash), so the next openChrome
 * cleans up after them; another run's Chrome, whose owner is alive, is left alone. A process is only killed when its command line names
 * the dead owner's profile, so a reused process id is never hit; on Windows only the folder is removed.
 */
async function sweepOrphans() {
  let names;
  try {
    names = readdirSync(tmpdir());
  } catch {
    return;
  }
  const orphans = names.flatMap((name) => {
    const folder = join(tmpdir(), name);
    try {
      const owner = JSON.parse(readFileSync(join(folder, OWNER_FILE), "utf8"));
      return isAlive(owner.owner_process_id) ? [] : [{ child: null, folder, profile: join(folder, "profile") }];
    } catch {
      return [];
    }
  });
  if (orphans.length) await endAndRemove(orphans);
}
