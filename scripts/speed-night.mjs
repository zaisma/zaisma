// The nightly Slow 3G run (.github/workflows/speed.yml): the live site's main pages, each opened 3 times with nothing cached, in Chrome
// (DevTools' own Slow 3G, as npm run page:probe -- <path> --slow measures) and in Safari (safaridriver, through
// scripts/slow-connection-proxy.mjs, the same line), keeping each page's median time to its first paint. The last NIGHTS_KEPT nights
// live in SPEED_STATE_FILE (the workflow caches its folder between runs, as watch.yml does). A page whose median is past its last week's
// by SLOWER_SHARE and SLOWER_MS pushes Julius through Pushover (PUSHOVER_USER_KEY, PUSHOVER_APP_TOKEN), once until it's back.
// Each browser is compared only with itself. Exits 1 only when it couldn't push.
//
//   node scripts/speed-night.mjs [--site https://zaisma.com] [--browsers chrome,safari] [--system-proxy]
//
// --system-proxy points macOS's secure web proxy at the slow line for Safari and back after (networksetup, with sudo: the runner's).

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { findChrome } from "./chrome.mjs";
import { probePage } from "./page-probe.mjs";
import { startSlowProxy } from "./slow-connection-proxy.mjs";
import { sendPushover } from "./watch-checks.mjs";

export const PAGE_PATHS = ["/", "/games", "/signin", "/legal/privacy"];
export const OPEN_COUNT = 3;
export const NIGHTS_KEPT = 14;
/** Nights a page's usual time is the median of. */
export const BASELINE_NIGHT_COUNT = 7;
/** Slower is past the usual by both: a fifth more, and 300 ms. */
export const SLOWER_SHARE = 0.2;
export const SLOWER_MS = 300;
const SAFARI_DRIVER_PORT = 4445;

export const median = (values) => {
  const sorted = values.filter((value) => typeof value === "number").sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
};

/**
 * Which pages got slower tonight: for each "<browser> <path>" in tonight, its median over the last BASELINE_NIGHT_COUNT nights before,
 * and slower when tonight is past it by SLOWER_SHARE and SLOWER_MS. A page with no history yet is never slower.
 */
export function slowerPages(nights, tonight) {
  const before = nights.slice(-BASELINE_NIGHT_COUNT);
  return Object.entries(tonight).flatMap(([key, firstPaintMs]) => {
    const usualMs = median(before.map((night) => night.first_paint_ms_by_page[key]));
    if (usualMs === null || firstPaintMs === null) return [];
    return firstPaintMs > usualMs * (1 + SLOWER_SHARE) && firstPaintMs - usualMs > SLOWER_MS ? [{ key, first_paint_ms: firstPaintMs, usual_ms: usualMs }] : [];
  });
}

/** The first listed game's page, from the live sitemap: a game page with a real game's world behind it. */
async function gamePagePath(site) {
  const sitemap = await (await fetch(`${site}/sitemap.xml`, { signal: AbortSignal.timeout(20_000) })).text();
  const found = sitemap.match(/<loc>[^<]*?(\/g\/[a-z0-9-]+)<\/loc>/);
  return found ? found[1] : null;
}

async function chromeFirstPaintMs(chromePath, url) {
  const answer = await probePage({ chromePath, url, widthPx: 390, heightPx: 844, isSlow: true });
  return answer.timing?.first_paint_ms ?? null;
}

/** W3C WebDriver against safaridriver: a fresh session for each open, so nothing is cached. */
async function safariFirstPaintMs(url) {
  const call = async (method, path, body) => {
    const response = await fetch(`http://127.0.0.1:${SAFARI_DRIVER_PORT}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000) });
    return (await response.json()).value;
  };
  const { sessionId } = await call("POST", "/session", { capabilities: { alwaysMatch: { browserName: "safari" } } });
  try {
    await call("POST", `/session/${sessionId}/url`, { url });
    for (let waitedMs = 0; waitedMs < 60_000; waitedMs += 500) {
      const paintMs = await call("POST", `/session/${sessionId}/execute/sync`, { script: 'var paint = performance.getEntriesByName("first-contentful-paint")[0]; return document.readyState === "complete" && paint ? Math.round(paint.startTime) : null;', args: [] });
      if (typeof paintMs === "number") return paintMs;
      await new Promise((done) => setTimeout(done, 500));
    }
    return null;
  } finally {
    await call("DELETE", `/session/${sessionId}`).catch(() => {});
  }
}

/** macOS's network services that are on, to point at the proxy and back. */
const networkServices = () => execFileSync("networksetup", ["-listallnetworkservices"], { encoding: "utf8" }).split("\n").slice(1).filter((line) => line && !line.startsWith("*"));
function setSystemProxy(port) {
  for (const service of networkServices()) {
    if (port) execFileSync("sudo", ["-n", "networksetup", "-setsecurewebproxy", service, "127.0.0.1", String(port)]);
    else execFileSync("sudo", ["-n", "networksetup", "-setsecurewebproxystate", service, "off"]);
  }
}

function readState(stateFile) {
  try { return JSON.parse(readFileSync(stateFile, "utf8")); } catch { return { nights: [], slower_keys: [] }; }
}

if (process.argv[1] === import.meta.filename) {
  const valueOf = (flag, fallback) => { const at = process.argv.indexOf(flag); return at > 0 ? process.argv[at + 1] : fallback; };
  const site = valueOf("--site", "https://zaisma.com");
  const browsers = valueOf("--browsers", "chrome,safari").split(",");
  const stateFile = process.env.SPEED_STATE_FILE ?? ".speed-state/state.json";
  const state = readState(stateFile);
  const paths = [...PAGE_PATHS, ...[await gamePagePath(site).catch(() => null)].filter(Boolean)];
  const tonight = {};
  if (browsers.includes("chrome")) {
    const chromePath = await findChrome();
    for (const path of paths) {
      const times = [];
      for (let open = 0; open < OPEN_COUNT; open++) times.push(await chromeFirstPaintMs(chromePath, `${site}${path}`).catch(() => null));
      tonight[`chrome ${path}`] = median(times);
    }
  }
  if (browsers.includes("safari")) {
    const proxy = await startSlowProxy();
    const driver = (await import("node:child_process")).spawn("safaridriver", ["--port", String(SAFARI_DRIVER_PORT)], { stdio: "ignore" });
    try {
      if (process.argv.includes("--system-proxy")) setSystemProxy(proxy.port);
      await new Promise((done) => setTimeout(done, 2000));
      for (const path of paths) {
        const times = [];
        for (let open = 0; open < OPEN_COUNT; open++) times.push(await safariFirstPaintMs(`${site}${path}`).catch((error) => (console.log(`  Safari ${path}: ${error.message}`), null)));
        tonight[`safari ${path}`] = median(times);
      }
    } finally {
      if (process.argv.includes("--system-proxy")) setSystemProxy(null);
      driver.kill();
      await proxy.close();
    }
  }
  for (const [key, firstPaintMs] of Object.entries(tonight)) console.log(`${key.padEnd(32)} ${firstPaintMs === null ? "-" : `${firstPaintMs} ms`}`);
  const slower = slowerPages(state.nights, tonight);
  const newlySlower = slower.filter((page) => !state.slower_keys.includes(page.key));
  let isPushFailed = false;
  if (newlySlower.length && process.env.PUSHOVER_USER_KEY && process.env.PUSHOVER_APP_TOKEN) {
    const message = newlySlower.map((page) => `${page.key}: first paint ${(page.first_paint_ms / 1000).toFixed(1)} s on Slow 3G, usually ${(page.usual_ms / 1000).toFixed(1)} s`).join("\n");
    try {
      await sendPushover({ userKey: process.env.PUSHOVER_USER_KEY, appToken: process.env.PUSHOVER_APP_TOKEN }, { title: newlySlower.length === 1 ? "A page got slower" : `${newlySlower.length} pages got slower`, message, priority: 0 });
    } catch (error) {
      console.log(`Couldn't push: ${error.message}`);
      isPushFailed = true;
    }
  }
  for (const page of slower) console.log(`SLOWER ${page.key}: ${page.first_paint_ms} ms, usually ${page.usual_ms} ms`);
  const nextState = {
    nights: [...state.nights, { date: new Date().toISOString().slice(0, 10), first_paint_ms_by_page: tonight }].slice(-NIGHTS_KEPT),
    // A page told about stays told until it's back to its usual; one that couldn't be pushed is told again tomorrow.
    slower_keys: isPushFailed ? state.slower_keys.filter((key) => slower.some((page) => page.key === key)) : slower.map((page) => page.key),
  };
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(nextState, null, 2));
  process.exit(isPushFailed ? 1 : 0);
}
