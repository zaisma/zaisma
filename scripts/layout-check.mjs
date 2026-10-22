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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The sizes every page is measured at: Julius's phone, and a desktop. */
export const LAYOUT_CHECK_SIZES = [
  { name: "320 x 667", widthPx: 320, heightPx: 667, isPhone: true },
  { name: "1440 x 900", widthPx: 1440, heightPx: 900, isPhone: false },
];
export const LAYOUT_CHECK_THEMES = ["light", "dark"];

const GALLERY_GROUPS = ["", "/layout", "/actions", "/inputs", "/navigation", "/panes", "/data"];

/**
 * Every page and state the check opens. path is on the site, or on the stand-in site of a developer using Sign in with Zaisma
 * (onSignInSite), which sends the player on to Zaisma's own page; account signs in as that test account first. mainActionShows: where
 * the page's runner (its one main action) must show without scrolling: at every size, only on a desktop (the city's pane starts low on
 * a phone, showing down to its heading, so the city has the screen: docs/DECISIONS.md, "Signing in happens in the city"), or nowhere
 * (the page has none, or many, like the gallery).
 */
const CITY = { mainActionShows: "desktop" };
export const LAYOUT_CHECK_PAGES = [
  { name: "Home", path: "/", mainActionShows: "nowhere" },
  { name: "Sign in", path: "/signin", ...CITY },
  { name: "Make an account", path: "/join", ...CITY },
  { name: "Forgot your password", path: "/signin/email", ...CITY },
  { name: "Example page", path: "/design/example", mainActionShows: "everywhere" },
  { name: "Connect an app", path: "/mcp-start", onSignInSite: true, account: "Preview_Studio", mainActionShows: "everywhere" },
  { name: "Sign in with Zaisma", path: "/start", onSignInSite: true, account: "Moss_Runner", mainActionShows: "everywhere" },
  ...GALLERY_GROUPS.map((group) => ({ name: `Gallery${group || " foundations"}`, path: `/design${group}`, mainActionShows: "nowhere", isGallery: true })),
];

/**
 * What the check measures, run in the page: the failures, each { check, element, said }. Things with an edge of their own are framed:
 * cut by the edge rule (data-cut-line), glass of their own (data-glass), a cover, or a table's box.
 */
function measurePage(options) {
  var TOLERANCE_PX = 1.5, LEAST_BEVEL_PX = 4;
  var failures = [];
  var root = getComputedStyle(document.documentElement);
  var slantOverlapPx = Math.abs(parseFloat(root.getPropertyValue("--control-slant")) - parseFloat(root.getPropertyValue("--gap-control-row"))) || 6;
  var FRAMED = "[data-cut-line], [data-glass], .cover, .list-rows";
  // Pieces made to lie over each other: a row of pictures, each over the next.
  var OVERLAPPING = ".picture-row";
  var SKIPPED = "script, style, template, .sr, [aria-hidden='true'], .loader, .rail, .edge, .cut-line";
  var COMPONENTS = ["run-wrap", "cut-btn", "glass-btn", "guest-btn", "text-btn", "cut-field", "field", "find", "tab-switch", "switch-frame", "steps", "cover", "banner", "glass-pane", "tray", "tray-head", "sheet", "dropdown", "notice", "table", "list-rows", "choice-card", "toggle", "check", "top", "foot", "layout-row", "layout-stack", "layout-grid", "layout-track", "pane-head", "pane-foot"];
  function isShown(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    var css = getComputedStyle(el);
    return css.visibility !== "hidden" && Number(css.opacity) > 0.01 && !el.closest("[hidden], dialog:not([open])");
  }
  function describe(el) {
    var named = el.closest("[class]"), component = "", walk = el;
    while (walk && !component) { component = COMPONENTS.find(function (name) { return walk.classList && walk.classList.contains(name); }) || ""; walk = walk.parentElement; }
    var label = (el.getAttribute("aria-label") || el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 48);
    return (component || (named ? named.className.split(" ")[0] : el.tagName.toLowerCase())) + (label ? ' "' + label + '"' : "");
  }
  function report(check, el, said) { failures.push({ check: check, element: describe(el), said: said }); }
  var round = function (n) { return Math.round(n * 10) / 10; };
  // The box that scrolls sideways round an element, up to the pane (a track of covers): only what shows in it is measured.
  function scrollerIn(el, pane) {
    for (var walk = el.parentElement; walk && walk !== pane; walk = walk.parentElement) { var x = getComputedStyle(walk).overflowX; if (x === "auto" || x === "scroll" || x === "hidden") return walk; }
    return null;
  }
  function isScrolledAway(el, pane) {
    var scroller = scrollerIn(el, pane); if (!scroller) return false;
    var r = el.getBoundingClientRect(), s = scroller.getBoundingClientRect();
    return r.left < s.left - TOLERANCE_PX || r.right > s.right + TOLERANCE_PX;
  }
  // A line of words as it's set: its line box, not the taller box its letters' accents and descenders reach.
  function lineBox(r, el) {
    var lineHeightPx = parseFloat(getComputedStyle(el).lineHeight);
    if (!lineHeightPx || r.height <= lineHeightPx) return r;
    var trim = (r.height - lineHeightPx) / 2;
    return { left: r.left, right: r.right, top: r.top + trim, bottom: r.bottom - trim, width: r.width, height: lineHeightPx };
  }
  // The framed thing an element is part of, up to the pane: null when it's the pane's own.
  function framedIn(el, pane) {
    for (var walk = el.parentElement; walk && walk !== pane; walk = walk.parentElement) {
      if (walk.hasAttribute("data-on-no-pane")) return walk;
      if (walk.matches(FRAMED)) return walk;
    }
    return null;
  }
  var panes = Array.prototype.filter.call(document.querySelectorAll("[data-glass]:not([data-cut-line])"), function (pane) { return isShown(pane) && !pane.classList.contains("frame"); });
  panes.forEach(function (pane) {
    var holder = pane.querySelector(":scope > .pane-in, :scope > .sheet-in") || pane, css = getComputedStyle(holder), p = pane.getBoundingClientRect();
    var gap = { left: parseFloat(css.paddingLeft), right: parseFloat(css.paddingRight), top: parseFloat(css.paddingTop), bottom: parseFloat(css.paddingBottom) };
    var words = parseFloat(css.getPropertyValue("--pad-words")) || 0;
    // A pane that scrolls inside itself: its top and bottom are its content's, wherever it's scrolled to.
    var isScrolling = holder.scrollHeight > holder.clientHeight + 1, contentTop = holder.getBoundingClientRect().top - holder.scrollTop;
    var box = { left: p.left, right: p.right, top: isScrolling ? contentTop : p.top, bottom: isScrolling ? contentTop + holder.scrollHeight : p.bottom };
    var distances = function (r) { return { left: r.left - box.left, right: box.right - r.right, top: r.top - box.top, bottom: box.bottom - r.bottom }; };
    var framed = Array.prototype.filter.call(pane.querySelectorAll(FRAMED), function (el) { return el !== pane && !framedIn(el, pane) && isShown(el); });
    var paneCuts = window.zaismaCorners ? window.zaismaCorners(pane, "pane") : [1, 1, 1, 1];
    framed.forEach(function (el) {
      if (isScrolledAway(el, pane)) return;
      var r = el.getBoundingClientRect(), d = distances(r);
      ["left", "right", "top", "bottom"].forEach(function (side) {
        if (d[side] < gap[side] - TOLERANCE_PX) {
          if (d[side] < -TOLERANCE_PX && (side === "left" || side === "right" || !isScrolling)) report("spills out of its pane", el, side + " edge " + round(-d[side]) + "px past the pane's");
          else report("closer to the pane's edge than the frame gap", el, round(d[side]) + "px from the " + side + " edge, expected " + round(gap[side]) + "px");
        } else if (d[side] > gap[side] + TOLERANCE_PX && d[side] < gap[side] + words - TOLERANCE_PX) {
          report("off the frame gap", el, round(d[side]) + "px from the " + side + " edge, expected the frame gap " + round(gap[side]) + "px");
        }
      });
      // In a corner of the pane (at the frame gap from both its sides), it keeps a bevel there.
      var atGap = function (side) { return Math.abs(d[side] - gap[side]) <= TOLERANCE_PX; };
      [["top", "left"], ["top", "right"], ["bottom", "right"], ["bottom", "left"]].forEach(function (corner, i) {
        var cut = (el.cutCorners || [])[i];
        if (cut !== undefined && paneCuts[i] > 0 && atGap(corner[0]) && atGap(corner[1]) && cut < LEAST_BEVEL_PX - 0.01) report("bevel under 4px", el, "in the pane's " + corner.join(" ") + " corner its bevel is " + round(cut) + "px");
      });
    });
    // Two things with an edge overlap only as far as two controls side by side do, slanting toward each other.
    for (var i = 0; i < framed.length; i++) for (var j = i + 1; j < framed.length; j++) {
      if (framed[i].closest(OVERLAPPING) && framed[i].closest(OVERLAPPING) === framed[j].closest(OVERLAPPING)) continue;
      if (isScrolledAway(framed[i], pane) || isScrolledAway(framed[j], pane)) continue;
      var a = framed[i].getBoundingClientRect(), b = framed[j].getBoundingClientRect();
      var across = Math.min(a.right, b.right) - Math.max(a.left, b.left), down = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (across > slantOverlapPx + TOLERANCE_PX && down > TOLERANCE_PX) report("overlaps another thing", framed[i], "overlaps " + describe(framed[j]) + " by " + round(across) + " x " + round(down) + "px");
    }
    // Words: every line of the pane's own words keeps its margin, and lies over nothing with an edge.
    var walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT), text, flagged = new Set();
    while ((text = walker.nextNode())) {
      var el = text.parentElement;
      if (!text.textContent.trim() || !el || el.closest(SKIPPED) || framedIn(el, pane) || !isShown(el) || flagged.has(el)) continue;
      var range = document.createRange(); range.selectNodeContents(text);
      if (isScrolledAway(el, pane)) continue;
      Array.prototype.some.call(range.getClientRects(), function (glyphs) {
        if (glyphs.width < 1 || glyphs.height < 1) return false;
        var r = lineBox(glyphs, el), scroller = scrollerIn(el, pane);
        // Words running on past what scrolls sideways round them are measured where they show.
        if (scroller) { var s = scroller.getBoundingClientRect(); if (r.left < s.left - TOLERANCE_PX || r.right > s.right + TOLERANCE_PX) return false; }
        var d = distances(r), wordsAt = { left: gap.left + words, right: gap.right + words, top: gap.top + words, bottom: gap.bottom + words };
        var side = ["left", "right", "top", "bottom"].find(function (each) { return d[each] < wordsAt[each] - TOLERANCE_PX; });
        if (side) { flagged.add(el); report("words closer to the pane's edge than its margin", el, round(d[side]) + "px from the " + side + " edge, expected " + round(wordsAt[side]) + "px"); return true; }
        var under = framed.find(function (f) { var o = f.getBoundingClientRect(); return Math.min(r.right, o.right) - Math.max(r.left, o.left) > TOLERANCE_PX && Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top) > TOLERANCE_PX; });
        if (under) { flagged.add(el); report("words over something with an edge", el, "over " + describe(under)); return true; }
        return false;
      });
    }
  });
  // Rows: every control one height, on one line.
  document.querySelectorAll(".layout-row").forEach(function (row) {
    if (!isShown(row)) return;
    var boxes = Array.prototype.flatMap.call(row.querySelectorAll(":scope > .row-cell.is-control"), function (cell) {
      var control = [cell].concat(Array.prototype.slice.call(cell.querySelectorAll("[data-cut-line]"))).find(function (each) { return each.hasAttribute("data-cut-line") && isShown(each); });
      return control ? [control] : [];
    });
    boxes.forEach(function (control, i) {
      var a = control.getBoundingClientRect();
      boxes.slice(i + 1).forEach(function (other) {
        var b = other.getBoundingClientRect(), isSameLine = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0;
        if (!isSameLine) return;
        if (Math.abs(a.height - b.height) > 1) report("controls in one row of different heights", control, round(a.height) + "px beside " + describe(other) + " at " + round(b.height) + "px");
        else if (Math.abs(a.top - b.top) > 1) report("controls in one row not on one line", control, round(a.top - b.top) + "px off " + describe(other));
      });
    });
  });
  // A control in a pane's corner (Pane parts): in it, at the frame gap, with the corner's cut.
  [[".pane-head-end", "top", 1], [".pane-foot-end", "bottom", 2]].forEach(function (place) {
    document.querySelectorAll(place[0]).forEach(function (end) {
      var control = end.querySelector("[data-cut-line]"), pane = end.closest("[data-glass]:not([data-cut-line])");
      if (!control || !pane || !isShown(control)) return;
      var holder = pane.querySelector(":scope > .pane-in, :scope > .sheet-in") || pane, css = getComputedStyle(holder), r = control.getBoundingClientRect(), p = pane.getBoundingClientRect();
      var away = place[1] === "top" ? r.top - p.top : p.bottom - r.bottom, side = p.right - r.right;
      var expected = { top: parseFloat(css.paddingTop), bottom: parseFloat(css.paddingBottom), right: parseFloat(css.paddingRight) };
      if (Math.abs(away - expected[place[1]]) > TOLERANCE_PX || Math.abs(side - expected.right) > TOLERANCE_PX) report("a corner control not in its corner", control, round(away) + "px from the " + place[1] + " and " + round(side) + "px from the end, expected " + round(expected[place[1]]) + "px and " + round(expected.right) + "px");
      var cut = (control.cutCorners || [])[place[2]] || 0;
      if (cut < LEAST_BEVEL_PX - 0.01) report("a corner control without its corner's bevel", control, "its bevel is " + round(cut) + "px, at least " + LEAST_BEVEL_PX + "px");
    });
  });
  if (options.isMainActionChecked) {
    var runner = Array.prototype.find.call(document.querySelectorAll(".run-wrap"), isShown);
    if (runner && runner.getBoundingClientRect().bottom > innerHeight + 0.5) report("the runner below the fold", runner, "its foot at " + round(runner.getBoundingClientRect().bottom + scrollY) + "px, the window " + innerHeight + "px tall");
  }
  var pageWidthPx = document.scrollingElement.scrollWidth;
  if (pageWidthPx > innerWidth + 1) report("the page scrolls sideways", document.body, pageWidthPx + "px wide in a " + innerWidth + "px window");
  return failures;
}

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
    const { result, exceptionDetails } = await send("Runtime.evaluate", { expression: `(${measurePage.toString()})(${JSON.stringify({ isMainActionChecked })})`, returnByValue: true });
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
          const base = page.onSignInSite ? signInSite : site;
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
  if ((!state || !isUp(state.offset)) && isStarting) {
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
  const pages = only ? LAYOUT_CHECK_PAGES.filter((page) => page.path.includes(only)) : LAYOUT_CHECK_PAGES;
  if (!pages.length) stop(`No page's path has ${only} in it.`, isJson);
  const { checkedCount, failures } = await checkPages({
    ...sites,
    pages,
    chromePath,
    onPage: (page, size, theme, found) => !isJson && console.log(`${found.length ? "FAIL" : "  ok"} ${page.name} (${page.path}) ${size.name} ${theme}${found.length ? `: ${found.length}` : ""}`),
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
