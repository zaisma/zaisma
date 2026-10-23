#!/usr/bin/env node
// The measuring check (docs/DESIGN.md, Layout): opens every page and state in LAYOUT_CHECK_PAGES in headless Chrome at 320 x 667 and
// 1440 x 900, light and dark, and measures it the way a person would look at it, failing on what's out of line:
//   - controls in one row of different heights, or not on one line;
//   - anything overlapping another thing with an edge, or spilling out of its pane;
//   - words closer to a pane's edge than its margin (--pad-pane, its tray's --pad-tray), and things with an edge of their own at other
//     than the frame gap (--pad-frame) from an edge they sit against;
//   - a control in a pane's corner (Pane parts) not in its corner, or anything cut to a bevel under 4px;
//   - the page's runner (its main action) below the fold, and the page scrolling sideways.
// Each failure says the page, the size, the theme, the thing (its component and label) and what was measured against what's expected.
//
//   npm run layout:check                     against this checkout's preview (started first when it isn't running: a few minutes)
//   npm run layout:check -- --json           the same, as JSON
//   npm run layout:check -- --only /signin   only the pages whose path has that in it
//   CHROME_PATH=/path/to/chrome npm run layout:check
//
// Chrome is the system's or one downloaded before (scripts/chrome.mjs); without either it fetches Chrome for Testing into
// .wrangler/chrome. test/layout/layout-check.test.ts runs it on GitHub's check.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fetchChrome, findChrome, openChrome } from "./chrome.mjs";
import { PASSWORD } from "./preview/sign-ins.mjs";
import { MEASURE_LAYOUT_SOURCE } from "../apps/site/src/components/layout-measure.ts";
import { CHECKED_PAGES, SCREEN_SIZES, SCREEN_THEMES } from "../apps/site/src/components/checked-pages.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The sizes every page is measured at, Julius's phone and a desktop, and the pages: the same Screens shows (checked-pages.ts). */
export const LAYOUT_CHECK_SIZES = SCREEN_SIZES.map((size) => ({ name: `${size.widthPx} x ${size.heightPx}`, widthPx: size.widthPx, heightPx: size.heightPx, isPhone: size.isPhone }));
export const LAYOUT_CHECK_THEMES = [...SCREEN_THEMES];
export const LAYOUT_CHECK_PAGES = CHECKED_PAGES;

/** Waits until the page has drawn: loaded, its fonts in, the gallery's skipped sections laid out, the edge rule's shapes drawn. */
const SETTLE = `(async () => {
  if (document.readyState !== "complete") await new Promise((done) => addEventListener("load", done, { once: true }));
  if (document.fonts) await document.fonts.ready;
  document.querySelectorAll(".component-section").forEach((section) => { section.style.contentVisibility = "visible"; });
  for (let frame = 0; frame < 4; frame++) await new Promise((done) => requestAnimationFrame(done));
  await new Promise((done) => setTimeout(done, 400));
  return true;
})()`;

/** One page at one size and theme in a fresh tab: its failures. */
async function checkPage(chrome, contextId, url, size, theme, options) {
  const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank", browserContextId: contextId });
  const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params = {}) => chrome.send(method, params, sessionId);
  try {
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: size.widthPx, height: size.heightPx, deviceScaleFactor: size.isPhone ? 2 : 1, mobile: size.isPhone });
    await send("Emulation.setTouchEmulationEnabled", size.isPhone ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "reduce" }] });
    const loaded = new Promise((done) => {
      const off = chrome.listen(sessionId, (method) => method === "Page.loadEventFired" && (off(), done()));
    });
    await send("Page.navigate", { url });
    await Promise.race([loaded, wait(30_000)]);
    if (options.markup) await send("Runtime.evaluate", { expression: `document.querySelector("main").innerHTML = ${JSON.stringify(options.markup)}; true`, returnByValue: true });
    await send("Runtime.evaluate", { expression: SETTLE, awaitPromise: true, returnByValue: true });
    const isMainActionChecked = options.mainActionShows === "everywhere" || (options.mainActionShows === "desktop" && !size.isPhone);
    const { result, exceptionDetails } = await send("Runtime.evaluate", { expression: `(${MEASURE_LAYOUT_SOURCE})(${JSON.stringify({ isMainActionChecked })})`, returnByValue: true });
    if (exceptionDetails) return [{ check: "the check couldn't measure the page", element: "", said: exceptionDetails.exception?.description ?? exceptionDetails.text }];
    return result.value;
  } finally {
    await chrome.send("Target.closeTarget", { targetId }).catch(() => {});
  }
}

/** Signs a test account in, in its own browser context, through the sign-in page as a player would. */
async function signIn(chrome, contextId, site, username) {
  const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank", browserContextId: contextId });
  const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params = {}) => chrome.send(method, params, sessionId);
  try {
    await send("Page.enable");
    const loaded = () => new Promise((done) => { const off = chrome.listen(sessionId, (method) => method === "Page.loadEventFired" && (off(), done())); });
    let next = loaded();
    await send("Page.navigate", { url: `${site}/signin` });
    await next;
    next = loaded();
    await send("Runtime.evaluate", { expression: `(() => { const form = document.getElementById("signin-form"); form.username.value = ${JSON.stringify(username)}; form.password.value = ${JSON.stringify(PASSWORD)}; form.requestSubmit(); return true; })()`, returnByValue: true });
    await Promise.race([next, wait(15_000)]);
  } finally {
    await chrome.send("Target.closeTarget", { targetId }).catch(() => {});
  }
}

/**
 * Measures pages, every size and theme: { checked, failures }, each failure { page, size, theme, check, element, said }. markup puts that
 * markup in place of a page's own (test/layout/layout-check.test.ts's fixture), on the example page.
 */
export async function checkPages({ site, signInSite, pages = LAYOUT_CHECK_PAGES, sizes = LAYOUT_CHECK_SIZES, themes = LAYOUT_CHECK_THEMES, chromePath, onPage = () => {} }) {
  const chrome = await openChrome(chromePath, "zaisma-layout-");
  const failures = [];
  let checkedCount = 0;
  try {
    const contexts = new Map();
    const contextFor = async (account) => {
      if (!contexts.has(account ?? "")) {
        const { browserContextId } = await chrome.send("Target.createBrowserContext");
        if (account) await signIn(chrome, browserContextId, site, account);
        contexts.set(account ?? "", browserContextId);
      }
      return contexts.get(account ?? "");
    };
    for (const page of pages) {
      const contextId = await contextFor(page.account);
      for (const size of sizes) {
        for (const theme of themes) {
          const base = page.isOnSignInSite ? signInSite : site;
          // The gallery takes light or dark from its address.
          const url = `${base}${page.path}${page.isGallery && theme === "dark" ? `${page.path.includes("?") ? "&" : "?"}theme=dark` : ""}`;
          const found = await checkPage(chrome, contextId, url, size, theme, page);
          checkedCount++;
          for (const failure of found) failures.push({ page: page.name, path: page.path, size: size.name, theme, ...failure });
          onPage(page, size, theme, found);
        }
      }
    }
  } finally {
    await chrome.close();
  }
  return { checkedCount, failures };
}

/** This checkout's preview's addresses, starting it first when it isn't running. */
export function previewSites({ isStarting = true } = {}) {
  const read = () => {
    try {
      return JSON.parse(readFileSync(join(ROOT, ".wrangler/preview-run/state.json"), "utf8"));
    } catch {
      return null;
    }
  };
  let state = read();
  const isUp = (offset) => spawnSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", `http://localhost:${8800 + offset}/design/example`], { encoding: "utf8" }).stdout === "200";
  if (!state || !isUp(state.offset)) {
    if (!isStarting) return null;
    console.log("Starting this checkout's preview (a few minutes)…");
    const started = spawnSync(process.execPath, [join(ROOT, "scripts/preview/background.mjs"), "start"], { stdio: "inherit" });
    if (started.status !== 0) return null;
    state = read();
  }
  if (!state) return null;
  return { site: `http://localhost:${8800 + state.offset}`, signInSite: `http://localhost:${8793 + state.offset}` };
}

/** Chrome to run: one here, or one fetched. */
export async function chromeToRun() {
  return (await findChrome()) ?? (await fetchChrome());
}

async function main() {
  const args = process.argv.slice(2);
  const isJson = args.includes("--json");
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  const unknown = args.filter((arg, i) => !["--json", "--only"].includes(arg) && args[i - 1] !== "--only");
  if (unknown.length) stop(`Unknown option ${unknown.join(" ")}. The options are --json and --only <part of a page's path>.`, isJson);
  const chromePath = await chromeToRun();
  if (!chromePath) stop("No Chrome: set CHROME_PATH, or let it download Chrome for Testing (it couldn't).", isJson, "no_chrome");
  const sites = previewSites();
  if (!sites) stop("The preview didn't start: see .wrangler/preview-run/preview.log.", isJson, "no_preview");
  const allPages = LAYOUT_CHECK_PAGES;
  const pages = only ? allPages.filter((page) => page.path.includes(only)) : allPages;
  if (!pages.length) stop(`No page's path has ${only} in it.`, isJson);
  const { checkedCount, failures } = await checkPages({
    ...sites,
    pages,
    chromePath,
    onPage: (page, size, theme, found) => !isJson && console.log(`${found.length ? "FAIL" : "  ok"} ${page.name}${page.path.length < 40 ? ` (${page.path})` : ""} ${size.name} ${theme}${found.length ? `: ${found.length}` : ""}`),
  });
  if (isJson) console.log(JSON.stringify({ checked_page_count: checkedCount, failures }, null, 2));
  else {
    for (const failure of failures) console.log(`  ${failure.page} ${failure.size} ${failure.theme}: ${failure.check}: ${failure.element}: ${failure.said}`);
    console.log(failures.length ? `LAYOUT FAIL: ${failures.length} problem(s) on ${new Set(failures.map((failure) => `${failure.page} ${failure.size} ${failure.theme}`)).size} of ${checkedCount} pages.` : `LAYOUT PASS: ${checkedCount} pages, every size and theme.`);
  }
  process.exit(failures.length ? 1 : 0);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stop(message, isJson, code = "stopped") {
  console.log(isJson ? JSON.stringify({ error: code, message }) : `LAYOUT FAIL: ${message}`);
  process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
