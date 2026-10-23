// Headless Chrome, for `zaisma check` on a shader's folder and Zaisma's own scripts that look at pages in a real browser
// (scripts/chrome.mjs), driven over its DevTools protocol with Node's own WebSocket (Node 22 or newer), so it needs no dependency and
// never downloads a browser. Chrome is the one in CHROME_PATH, the system's, or one Playwright or @puppeteer/browsers downloaded.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
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
 * Headless Chrome at path with WebGL in software (SwiftShader, as on Zaisma's check and on machines without a GPU), and a DevTools
 * connection to it: send(method, parameters, sessionId), listen(sessionId, onEvent) and close().
 */
export async function openChrome(path, profilePrefix) {
  const profile = mkdtempSync(join(tmpdir(), profilePrefix));
  const child = spawn(path, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required", "--hide-scrollbars", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const address = await new Promise((resolve, reject) => {
    let output = "";
    child.stderr.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) resolve(match[1]);
    });
    child.on("error", (error) => reject(error));
    child.on("exit", (code) => reject(new Error(`Chrome stopped (${code}): ${output.slice(-500)}`)));
  });
  const socket = new WebSocket(address);
  await new Promise((resolve, reject) => ((socket.onopen = resolve), (socket.onerror = reject)));
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
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await exited;
      rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}
