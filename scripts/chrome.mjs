// Headless Chrome for the scripts that look at pages in a real browser (scripts/engines/play.mjs, scripts/layout-check.mjs), driven over
// its DevTools protocol with Node's own WebSocket, so it needs no dependency. Chrome is the one in CHROME_PATH, the system's, one
// Playwright or @puppeteer/browsers downloaded, or, with fetch, Chrome for Testing downloaded by @puppeteer/browsers (already a
// devDependency) into .wrangler/chrome.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** Where Chrome is downloaded: .wrangler/chrome here, or ./chrome where `npx @puppeteer/browsers install chrome@stable` put it (GitHub's check). */
const CHROME_CACHES = [join(ROOT, ".wrangler/chrome"), join(ROOT, "chrome")];

/** A Chrome on this machine, or null. */
export async function findChrome() {
  const downloaded = await downloadedChromes();
  return [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ...downloaded, ...playwrightChromes()].find((candidate) => candidate && existsSync(candidate)) ?? null;
}

/** Downloads Chrome for Testing's stable build into .wrangler/chrome, once, and gives its path; null when it can't be fetched. */
export async function fetchChrome() {
  try {
    const { Browser, detectBrowserPlatform, install, resolveBuildId } = await import("@puppeteer/browsers");
    const platform = detectBrowserPlatform();
    const buildId = await resolveBuildId(Browser.CHROME, platform, "stable");
    const installed = await install({ browser: Browser.CHROME, buildId, cacheDir: CHROME_CACHES[0] });
    return installed.executablePath;
  } catch (error) {
    console.log(`  Couldn't fetch Chrome: ${error.message}`);
    return null;
  }
}

async function downloadedChromes() {
  try {
    const { getInstalledBrowsers } = await import("@puppeteer/browsers");
    const found = [];
    for (const cacheDir of CHROME_CACHES.filter((directory) => existsSync(directory))) {
      for (const browser of await getInstalledBrowsers({ cacheDir })) if (browser.browser === "chrome") found.push(browser.executablePath);
    }
    return found.reverse();
  } catch {
    return [];
  }
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

/**
 * Headless Chrome at path with WebGL in software (CI runners have no GPU), or on the machine's own GPU with isGpu (scripts/city.mjs
 * times and renders the city on it), and a DevTools connection to it: send(method, params, sessionId), listen(sessionId, onEvent) and close().
 */
export async function openChrome(path, profilePrefix, { isGpu = false } = {}) {
  const profile = mkdtempSync(join(tmpdir(), profilePrefix));
  const webgl = isGpu ? ["--enable-gpu", "--ignore-gpu-blocklist", ...(process.platform === "darwin" ? ["--use-angle=metal"] : [])] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
  const child = spawn(path, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", ...webgl, "--autoplay-policy=no-user-gesture-required", "--hide-scrollbars", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
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
