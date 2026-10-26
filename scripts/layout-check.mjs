#!/usr/bin/env node
// The measuring check (docs/DESIGN.md, Layout): opens every page and state in LAYOUT_CHECK_PAGES in headless Chrome on the screens players
// bring (checked-pages.ts's SCREEN_SIZES: a phone and a laptop unless told otherwise), light and dark, and measures it the way a person would
// look at it, failing on what's out of line:
//   - controls in one row of different heights, or not on one line;
//   - anything overlapping another thing with an edge, or spilling out of its pane;
//   - words closer to a pane's edge than its margin (--pad-pane, its tray's --pad-tray), and things with an edge of their own at other
//     than the frame gap (--pad-frame) from an edge they sit against;
//   - a control in a pane's corner (Pane parts) not in its corner, or anything cut to a bevel under 4px;
//   - the page's runner (its main action) below the fold, and the page scrolling sideways;
//   - a page without its shape, or anything wider than it; a pane over the page past its kind's size or the screen, or overflowing unscrolled;
//   - the Laws of UX a check can measure (proximity, common region, similarity, connectedness, hierarchy, choice counts, chunking), and a
//     press that answers nothing within 400 ms (the Doherty threshold), on a laptop.
// Each failure says the page, the size, the theme, the thing (its component and label) and what was measured against what's expected.
//
//   npm run layout:check                     against this checkout's preview (started first when it isn't running: a few minutes)
//   npm run layout:check -- --json           the same, as JSON
//   npm run layout:check -- --only /signin   only the pages whose path has that in it
//   npm run layout:check -- --tabs 2         how many pages it opens at once (DEFAULT_TAB_COUNT: one fewer than the cores, at most 4)
//   npm run layout:check -- --screens all    every screen, and 200% text (or --screens Phone,Tablet: screens by name; LOCAL_SCREEN_NAMES by default)
//   npm run layout:check -- --text 200       the browser's text at 200% too, on a laptop and an iPad (TEXT_SCREEN_NAMES)
//   npm run layout:check -- --shard 2/4      the second of four shares of the pages, as GitHub's check splits them
//   npm run layout:check -- --pictures <dir> one contact sheet per page and state, <dir>/<state>.png: its screens side by side, light over dark
//   CHROME_PATH=/path/to/chrome npm run layout:check
//
// Chrome is the system's or one downloaded before (scripts/chrome.mjs); without either it fetches Chrome for Testing into
// .wrangler/chrome. test/layout/layout-check.test.ts runs it on GitHub's check.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fetchChrome, findChrome, openChrome } from "./chrome.mjs";
import { PASSWORD } from "./preview/sign-ins.mjs";
import { MEASURE_LAYOUT_SOURCE } from "../apps/site/src/components/layout-measure.ts";
import { CHECKED_PAGES, LOCAL_SCREEN_NAMES, SCREEN_SIZES, SCREEN_THEMES, STRESS_ACCOUNTS, TEXT_SCREEN_NAMES, UNIQUE_WORD, stressBaseName } from "../apps/site/src/components/checked-pages.ts";
import { mkdirSync, writeFileSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The browser's text size as a share of its own 16px, for the runs at larger text (--text 200). */
const TEXT_PERCENTS = [200];

/**
 * The screens a run measures, by name (checked-pages.ts's SCREEN_SIZES), each { name, widthPx, heightPx, isPhone, hasTouch, isRunnerChecked,
 * textPercent }; "all" is every screen and 200% text on TEXT_SCREEN_NAMES. textPercent adds those screens at that text size.
 */
export function layoutCheckScreens(names = LOCAL_SCREEN_NAMES, textPercent = null) {
  const isAll = names === "all";
  const picked = isAll ? SCREEN_SIZES : names.map((name) => SCREEN_SIZES.find((size) => size.name === name) ?? (() => { throw new Error(`No screen is called ${name}. The screens are ${SCREEN_SIZES.map((size) => size.name).join(", ")}.`); })());
  const atText = isAll || textPercent ? TEXT_SCREEN_NAMES.map((name) => SCREEN_SIZES.find((size) => size.name === name)) : [];
  const percent = textPercent ?? TEXT_PERCENTS[0];
  // At larger text the runner may fall below the fold: what's held there is that nothing is lost or cut, not the first view.
  return [...picked.map((size) => ({ ...size, textPercent: 100 })), ...atText.map((size) => ({ ...size, name: `${size.name} at ${percent}% text`, textPercent: percent, isRunnerChecked: false }))];
}
/** The screens every page is measured at unless told otherwise, and the pages: the same Screens shows (checked-pages.ts). */
export const LAYOUT_CHECK_SIZES = layoutCheckScreens();
export const LAYOUT_CHECK_THEMES = [...SCREEN_THEMES];
export const LAYOUT_CHECK_PAGES = CHECKED_PAGES;
/** Pages open at once, each in its own window (tabs that share one aren't drawn): one fewer than the cores, so the preview keeps one. */
/** How long one page at one size and theme may take, loading and settling included, before it fails. */
const RUN_TIME_LIMIT_MS = 90_000;
export const DEFAULT_TAB_COUNT = Math.max(1, Math.min(4, availableParallelism() - 1));

// Each page's time in a tab on GitHub's runners, all its sizes and themes, in seconds (measured Oct 23, 2026, on a preview started from
// a snapshot, its images not yet made; the Layout check jobs print it as secondsByPage), by name: GitHub's check deals the pages to its runners by it (layoutCheckShard). A page that isn't
// here costs UNLISTED_PAGE_COST_SEC.
const PAGE_COSTS_SEC = {
  Screens: 51.8,
  "Gallery: inputs": 36.6,
  "Gallery: foundations": 33.5,
  "Gallery: navigation": 32.6,
  "Home, signed in": 29.7,
  Home: 26.5,
  "Gallery: data": 24.1,
  "Gallery: panes": 18,
  "Gallery: actions": 17.6,
  "Forgot your password": 17.3,
  "Sign in": 17,
  "Gallery: layout": 14.2,
  "Sign in with Zaisma": 10.9,
  "Make an account": 10.9,
  "Example page": 9.8,
  "Connect an app": 9.8,
};
const UNLISTED_PAGE_COST_SEC = 20;

/**
 * The pages in one share ("index/count", from 1) of GitHub's Layout check runners: dealt by cost, the dearest first, each to the share
 * with the least so far, so the runners finish together. Every page is in exactly one share.
 */
export function layoutCheckShard(pages, shard) {
  const [index, count] = shard.split("/").map(Number);
  if (!Number.isInteger(index) || !Number.isInteger(count) || index < 1 || index > count) throw new Error(`LAYOUT_CHECK_SHARD is "${shard}": it takes a share and a count, like 2/3.`);
  const costOf = (page) => PAGE_COSTS_SEC[page.name] ?? UNLISTED_PAGE_COST_SEC;
  const shares = Array.from({ length: count }, () => ({ costSec: 0, pages: [] }));
  for (const page of [...pages].sort((a, b) => costOf(b) - costOf(a) || (a.name < b.name ? -1 : 1))) {
    const least = shares.reduce((lightest, share) => (share.costSec < lightest.costSec ? share : lightest));
    least.costSec += costOf(page);
    least.pages.push(page);
  }
  return pages.filter((page) => shares[index - 1].pages.includes(page));
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

/** Which state the page says it is (html.ts, checkedPageTag), or null for a page that says none. */
const SAID_STATE = `document.querySelector('meta[name="checked-page"]')?.getAttribute("content") ?? null`;

/** Fills in and sends a form as a browser without the page's scripts would (checked-pages.ts, FormToSend): whether it found it. */
const sendForm = (form) => `(() => {
  const found = [...document.querySelectorAll("form")].find((each) => each.getAttribute("action") === ${JSON.stringify(form.formAction)});
  if (!found) return false;
  const word = Math.random().toString(36).slice(2, 10);
  for (const [name, value] of Object.entries(${JSON.stringify(form.fieldValues)})) {
    const field = found.elements.namedItem(name) ?? found.appendChild(Object.assign(document.createElement("input"), { type: "hidden", name }));
    field.value = value.replaceAll(${JSON.stringify(UNIQUE_WORD)}, word);
  }
  HTMLFormElement.prototype.submit.call(found);
  return true;
})()`;

/** The longest a press in the page may take to show it was heard: the Doherty threshold (lawsofux.com/doherty-threshold). */
const MAXIMUM_ANSWER_MS = 400;

/**
 * Presses every button that answers in the page rather than going somewhere (what opens a sheet, a menu, a select's list or a popover, a
 * switch's tab, a folded part, a field's own button), one at a time, and fails one that changes nothing on the page (its markup, its
 * attributes, a running animation, a popover or dialog shown) within MAXIMUM_ANSWER_MS. What it opened is closed before the next.
 */
const PRESS_EVERY_ANSWER = `(async () => {
  const pressed = [...document.querySelectorAll("[aria-controls]:not(a[href]:not([href^='#'])), [popovertarget], .tab-switch > button, details > summary")]
    .filter((el) => el.getClientRects().length && !el.closest(".steps, [inert], [hidden], dialog:not([open]), .dropdown.shut, template") && !el.disabled);
  const failures = [];
  const describe = (el) => (el.getAttribute("aria-label") || el.textContent || el.className || el.tagName).trim().replace(/\\s+/g, " ").slice(0, 48);
  for (const el of pressed) {
    if (!el.isConnected || !el.getClientRects().length) continue;
    const startedMs = performance.now();
    // What the press is about: the button's own state, what it names (aria-controls, popovertarget), the folded part it opens, and any sheet
    // or popover opening. The page's other scripts change other things on a press (the pointer's light, focus marks), which aren't an answer.
    const named = document.getElementById(el.getAttribute("aria-controls") || el.getAttribute("popovertarget") || "");
    const layered = () => document.querySelectorAll("dialog[open], :popover-open").length;
    const layeredBefore = layered();
    const answeredMs = await new Promise((done) => {
      let timer = 0;
      const answer = () => { observer.disconnect(); clearInterval(timer); done(performance.now() - startedMs); };
      // The glass's drawn edges and cut lines redraw on a press (the light follows the pointer): not an answer.
      const observer = new MutationObserver((records) => { if (records.some((record) => !(record.target.closest ? record.target : record.target.parentElement)?.closest("svg.edge, .cut-line, svg.cut-line"))) answer(); });
      // The press's own component, up to two levels round it (a field's Copy says Copied beside it), never the pane or layout cell it sits in.
      const OUTSIDE = "[data-glass], .pane-in, .sheet-in, .stack-cell, .row-cell, .grid-cell, .example-stage, main, body";
      const around = [el.parentElement?.parentElement, el.parentElement].find((each) => each && !each.matches(OUTSIDE)) ?? el;
      observer.observe(around, { attributes: true, childList: true, subtree: true, characterData: true });
      if (named) observer.observe(named, { attributes: true, childList: true, subtree: true, characterData: true });
      if (el.closest("details")) observer.observe(el.closest("details"), { attributes: true });
      const group = el.closest(".tab-switch");
      if (group) observer.observe(group, { attributes: true, subtree: true });
      timer = setInterval(() => { if (layered() !== layeredBefore) answer(); }, 20);
      el.click();
      setTimeout(() => { observer.disconnect(); clearInterval(timer); done(null); }, ${MAXIMUM_ANSWER_MS});
    });
    if (answeredMs === null) failures.push({ check: "no answer within 400 ms", element: describe(el), said: "pressed, nothing on the page changed within ${MAXIMUM_ANSWER_MS} ms" });
    document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
    document.querySelectorAll(":popover-open").forEach((popover) => popover.hidePopover());
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await new Promise((done) => setTimeout(done, 450));
  }
  return failures;
})()`;

/** Opens each pane a button in the gallery opens (a dropdown, a sheet, a popover), measures its size alone, and closes it: its failures, each naming the button. */
const openEveryPane = () => `(async () => {
  const measure = ${MEASURE_LAYOUT_SOURCE};
  const openers = [...document.querySelectorAll("main [aria-controls], main [popovertarget]")].filter((el) => {
    const pane = document.getElementById(el.getAttribute("aria-controls") || el.getAttribute("popovertarget"));
    return pane && pane.matches(".dropdown, dialog.sheet, [popover]") && el.getClientRects().length && !el.closest("[inert], dialog, .dropdown");
  });
  const failures = [];
  for (const opener of openers) {
    opener.scrollIntoView({ block: "center" });
    await new Promise((done) => setTimeout(done, 100));
    opener.click();
    await new Promise((done) => setTimeout(done, 450));
    const label = (opener.getAttribute("aria-label") || opener.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 40);
    failures.push(...measure({ isPanesOnly: true }).map((failure) => ({ ...failure, element: failure.element + ", opened from " + JSON.stringify(label) })));
    document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
    document.querySelectorAll(":popover-open").forEach((popover) => popover.hidePopover());
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await new Promise((done) => setTimeout(done, 450));
  }
  return failures;
})()`;

/** One page in a fresh tab, in a window of its own so it's drawn while others are open, at each size and theme in looks: their failures, one list each. */
async function checkPage(chrome, contextId, url, looks, options) {
  const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank", browserContextId: contextId, newWindow: true });
  const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params = {}) => chrome.send(method, params, sessionId);
  const look = async ({ size, theme }) => {
    await send("Emulation.setDeviceMetricsOverride", { width: size.widthPx, height: size.heightPx, deviceScaleFactor: size.isPhone ? 2 : 1, mobile: size.isPhone });
    await send("Emulation.setTouchEmulationEnabled", size.hasTouch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    // The browser's text size (its default font size, which rem follows): 16px is 100%.
    const textPx = Math.round((16 * (size.textPercent ?? 100)) / 100);
    await send("Page.setFontSizes", { fontSizes: { standard: textPx, fixed: Math.round((13 * (size.textPercent ?? 100)) / 100) } });
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "reduce" }] });
  };
  const said = async () => (await send("Runtime.evaluate", { expression: SAID_STATE, returnByValue: true }).catch(() => null))?.result?.value ?? null;
  try {
    await send("Page.enable");
    await look(looks[0]);
    const loaded = () => new Promise((done) => {
      const off = chrome.listen(sessionId, (method) => method === "Page.loadEventFired" && (off(), done()));
    });
    let next = loaded();
    await send("Page.navigate", { url });
    await Promise.race([next, wait(30_000)]);
    // A state only forms and links reach: each step is taken once, and its answer is the page that takes the next. It's taken once for
    // every size and theme, so the sign-in's limits on tries aren't reached.
    for (const step of options.stepsToTake ?? []) {
      next = loaded();
      if ("path" in step) await send("Page.navigate", { url: `${new URL(url).origin}${step.path}` });
      else if (!(await send("Runtime.evaluate", { expression: sendForm(step), returnByValue: true })).result?.value) {
        return looks.map(() => [{ check: "the check couldn't send the page's form", element: `form ${step.formAction}`, said: "no form there is sent there" }]);
      }
      await Promise.race([next, wait(30_000)]);
    }
    if (options.markup) await send("Runtime.evaluate", { expression: `document.querySelector("main").innerHTML = ${JSON.stringify(options.markup)}; true`, returnByValue: true });
    // What the page starts hidden (a sheet, a card over the game) is opened first, and settled in each look below.
    if (options.setUp) {
      await send("Runtime.evaluate", { expression: SETTLE, awaitPromise: true, returnByValue: true });
      const opened = await send("Runtime.evaluate", { expression: options.setUp, awaitPromise: true, returnByValue: true });
      if (opened.exceptionDetails) return looks.map(() => [{ check: "the check couldn't open the page's hidden state", element: "", said: opened.exceptionDetails.exception?.description ?? opened.exceptionDetails.text }]);
    }
    const foundByLook = [];
    for (const [lookIndex, { size, theme }] of looks.entries()) {
      if (lookIndex > 0) await look({ size, theme });
      await send("Runtime.evaluate", { expression: SETTLE, awaitPromise: true, returnByValue: true });
      const isMainActionChecked = size.isRunnerChecked !== false && (options.mainActionShows === "everywhere" || (options.mainActionShows === "desktop" && !size.isPhone));
      const measured = { isMainActionChecked, isCoverAboveFold: Boolean(options.isCoverAboveFold) && size.isRunnerChecked !== false, isTouch: Boolean(size.hasTouch) };
      const { result, exceptionDetails } = await send("Runtime.evaluate", { expression: `(${MEASURE_LAYOUT_SOURCE})(${JSON.stringify(measured)})`, returnByValue: true });
      const found = exceptionDetails ? [{ check: "the check couldn't measure the page", element: "", said: exceptionDetails.exception?.description ?? exceptionDetails.text }] : result.value;
      // The entry's address must show the state it's named for (checked-pages.ts), so a list that drifts from the pages fails here.
      const state = await said();
      // A page that lists what depends on who's looking is listed as each stress account too (Long and empty and full states).
      const isStressed = options.account && !options.isGallery && !options.setUp && !options.stepsToTake && !STRESS_ACCOUNTS.some((stress) => stress.account === options.account);
      if (isStressed && lookIndex === 0 && (await send("Runtime.evaluate", { expression: "Boolean(document.querySelector('main .when-empty'))", returnByValue: true })).result?.value) {
        const missing = STRESS_ACCOUNTS.map((stress) => `${stressBaseName(options.name)}, ${stress.nameEnding}`).filter((name) => !LAYOUT_CHECK_PAGES.some((page) => page.name === name));
        if (missing.length) found.push({ check: "a list without its long, empty and full states", element: "", said: `it lists things that depend on who's looking, and CHECKED_PAGES has no ${missing.map((name) => `"${name}"`).join(", ")} (checked-pages.ts, STRESS_ACCOUNTS)` });
      }
      if (!options.markup && state !== (options.stateBeforeSetUp ?? options.shownStateName ?? options.name)) {
        const address = (await send("Runtime.evaluate", { expression: "location.pathname + location.search", returnByValue: true })).result?.value;
        found.push({ check: "the page isn't the state it's listed as", element: "", said: `${state === null ? "it names no state (a page built in Zaisma's look names one: html.ts, checkedPage)" : `it says it's "${state}"`}, at ${address}` });
      }
      // The gallery's panes, each opened from its button, measured for their size, and closed (docs/DESIGN.md, Pane sizes).
      if (options.isGallery) {
        const panes = await send("Runtime.evaluate", { expression: openEveryPane(), awaitPromise: true, returnByValue: true });
        found.push(...(panes.exceptionDetails ? [{ check: "the check couldn't open the gallery's panes", element: "", said: panes.exceptionDetails.exception?.description ?? panes.exceptionDetails.text }] : panes.result.value));
      }
      // Every press that answers in the page answers within 400 ms (the Doherty threshold), on a laptop, once: a press changes the page.
      if (size.name === "Laptop" && theme === "light" && !options.stepsToTake && !options.setUp) {
        const answers = await send("Runtime.evaluate", { expression: PRESS_EVERY_ANSWER, awaitPromise: true, returnByValue: true });
        found.push(...(answers.exceptionDetails ? [{ check: "the check couldn't press the page's buttons", element: "", said: answers.exceptionDetails.exception?.description ?? answers.exceptionDetails.text }] : answers.result.value));
      }
      if (options.pictureOf) options.pictureOf(size, theme, (await send("Page.captureScreenshot", { format: "jpeg", quality: 70 })).data);
      foundByLook.push(found);
    }
    return foundByLook;
  } finally {
    await chrome.send("Target.closeTarget", { targetId }).catch(() => {});
  }
}

/** The widest a contact sheet is, so one read takes it whole. */
const CONTACT_SHEET_WIDEST_PX = 2400;
/** How tall each screen is drawn on it, before it's scaled to fit that width. */
const CONTACT_SHEET_SCREEN_HEIGHT_PX = 420;

/**
 * One picture of a page and state on every screen it was measured on, side by side in the screens' order, light over dark, each labeled: a
 * page Chrome draws from the pictures, and saves as a PNG at most CONTACT_SHEET_WIDEST_PX wide.
 */
async function contactSheet(chrome, path, name, pictures, sizes, themes) {
  const widthOf = (size) => Math.round((size.widthPx / size.heightPx) * CONTACT_SHEET_SCREEN_HEIGHT_PX);
  const rowWidthPx = sizes.reduce((sum, size) => sum + widthOf(size) + 12, 12);
  const scale = Math.min(1, CONTACT_SHEET_WIDEST_PX / rowWidthPx);
  const cells = themes.map((theme) => `<div class="row">${sizes.map((size) => {
    const picture = pictures.find((each) => each.size.name === size.name && each.theme === theme);
    return `<figure style="width:${Math.round(widthOf(size) * scale)}px"><div class="shot" style="height:${Math.round(CONTACT_SHEET_SCREEN_HEIGHT_PX * scale)}px">${picture ? `<img src="data:image/jpeg;base64,${picture.jpegBase64}">` : ""}</div><figcaption>${size.name}, ${theme}</figcaption></figure>`;
  }).join("")}</div>`).join("");
  const markup = `<!doctype html><style>body{margin:0;padding:12px;background:#222;color:#eee;font:14px system-ui;width:max-content}h1{font-size:16px;margin:0 0 8px}.row{display:flex;gap:12px;margin-bottom:12px}figure{margin:0}.shot{background:#000;display:flex}.shot img{width:100%;height:100%;object-fit:contain}figcaption{margin-top:4px}</style><h1>${name.replace(/</g, "&lt;")}</h1>${cells}`;
  const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params = {}) => chrome.send(method, params, sessionId);
  try {
    await send("Page.enable");
    const { frameTree } = await send("Page.getFrameTree");
    await send("Page.setDocumentContent", { frameId: frameTree.frame.id, html: markup });
    await wait(300);
    const { result } = await send("Runtime.evaluate", { expression: "JSON.stringify([document.body.scrollWidth, document.body.scrollHeight])", returnByValue: true });
    const [widthPx, heightPx] = JSON.parse(result.value);
    await send("Emulation.setDeviceMetricsOverride", { width: widthPx, height: heightPx, deviceScaleFactor: 1, mobile: false });
    const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    writeFileSync(path, Buffer.from(data, "base64"));
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
 * Measures pages, every size and theme, tabCount at once: { checkedCount, failures, secondsByPage }, each failure { page, size, theme,
 * check, element, said }, in the order of pages, sizes and themes, and secondsByPage each page's time in a tab, all its sizes and themes. markup puts that markup in place of a page's own (test/layout/layout-check.test.ts's
 * fixture), on the example page.
 */
export async function checkPages({ site, signInSite, pages = LAYOUT_CHECK_PAGES, sizes = LAYOUT_CHECK_SIZES, themes = LAYOUT_CHECK_THEMES, chromePath, tabCount = DEFAULT_TAB_COUNT, onPage = () => {}, picturesFolder = null }) {
  // Each page's pictures, by its name: one per screen and theme, for its contact sheet.
  const picturesByPage = new Map();
  const chrome = await openChrome(chromePath, "zaisma-layout-");
  const looks = sizes.flatMap((size) => themes.map((theme) => ({ size, theme })));
  // A page is opened once for each size and theme; one that sends forms is opened once, its answer measured at each.
  const runs = pages.flatMap((page) => (page.stepsToTake ? [{ page, looks }] : looks.map((one) => ({ page, looks: [one] }))));
  const foundByRun = [];
  const secondsByPage = {};
  try {
    const contexts = new Map();
    const newContext = async (account) => {
      const { browserContextId } = await chrome.send("Target.createBrowserContext");
      // A Copy button answers once the clipboard takes the words, which headless Chrome holds behind a permission a person grants.
      await chrome.send("Browser.grantPermissions", { permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"], browserContextId }).catch(() => {});
      if (account) await signIn(chrome, browserContextId, site, account);
      return browserContextId;
    };
    const contextFor = async (account) => {
      if (!contexts.has(account ?? "")) contexts.set(account ?? "", await newContext(account));
      return contexts.get(account ?? "");
    };
    // Every account signs in first, one at a time, so the runs that share it don't each sign it in.
    for (const page of pages) await contextFor(page.account);
    let nextRun = 0;
    const checkRuns = async () => {
      while (nextRun < runs.length) {
        const runIndex = nextRun++;
        const { page, looks: runLooks } = runs[runIndex];
        const base = page.isOnSignInSite ? signInSite : site;
        // The gallery takes light or dark from its address.
        const theme = runLooks[0].theme;
        const url = `${base}${page.path}${page.isGallery && theme === "dark" ? `${page.path.includes("?") ? "&" : "?"}theme=dark` : ""}`;
        // A page that never settles (a load or a frame that doesn't come) fails by name instead of holding up the rest.
        const tooSlow = runLooks.map(() => [{ check: "the page didn't settle in time", element: "", said: `nothing measured within ${(RUN_TIME_LIMIT_MS * runLooks.length) / 1000}s` }]);
        const startedMs = Date.now();
        // A page that sends forms gets a browser of its own, so what its answers leave (a cookie that says too young) reaches no other page.
        const isOwnContext = Boolean(page.stepsToTake);
        const contextId = isOwnContext ? await newContext(page.account) : await contextFor(page.account);
        const pictureOf = picturesFolder ? (size, theme, jpegBase64) => { if (!picturesByPage.has(page.name)) picturesByPage.set(page.name, []); picturesByPage.get(page.name).push({ size, theme, jpegBase64 }); } : null;
        const foundByLook = await Promise.race([checkPage(chrome, contextId, url, runLooks, { ...page, pictureOf }), wait(RUN_TIME_LIMIT_MS * runLooks.length).then(() => tooSlow)]);
        if (isOwnContext) await chrome.send("Target.disposeBrowserContext", { browserContextId: contextId }).catch(() => {});
        secondsByPage[page.name] = Math.round(((secondsByPage[page.name] ?? 0) + (Date.now() - startedMs) / 1000) * 10) / 10;
        foundByRun[runIndex] = runLooks.flatMap(({ size, theme: lookTheme }, lookIndex) => foundByLook[lookIndex].map((failure) => ({ page: page.name, path: page.path, size: size.name, theme: lookTheme, ...failure })));
        for (const [lookIndex, { size, theme: lookTheme }] of runLooks.entries()) onPage(page, size, lookTheme, foundByLook[lookIndex]);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(tabCount, runs.length)) }, checkRuns));
    if (picturesFolder) for (const [name, pictures] of picturesByPage) await contactSheet(chrome, join(picturesFolder, `${name.replace(/[^A-Za-z0-9 ,'-]+/g, "")}.png`), name, pictures, sizes, themes);
  } finally {
    await chrome.close();
  }
  return { checkedCount: runs.reduce((count, run, runIndex) => count + (foundByRun[runIndex] ? run.looks.length : 0), 0), failures: foundByRun.flat(), secondsByPage };
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
  const VALUED = ["--only", "--tabs", "--screens", "--text", "--shard", "--pictures"];
  const valueOf = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
  const isJson = args.includes("--json");
  const only = valueOf("--only");
  const tabCount = args.includes("--tabs") ? Number(valueOf("--tabs")) : DEFAULT_TAB_COUNT;
  const unknown = args.filter((arg, i) => !["--json", ...VALUED].includes(arg) && !VALUED.includes(args[i - 1]));
  const OPTIONS_WORDS = "The options are --json, --only <part of a page's path>, --tabs <pages at once>, --screens all or <name>,<name>, --text 200, --shard <n>/<count> and --pictures <folder>.";
  if (unknown.length) stop(`Unknown option ${unknown.join(" ")}. ${OPTIONS_WORDS}`, isJson);
  if (!Number.isInteger(tabCount) || tabCount < 1 || tabCount > 16) stop("--tabs takes a whole number from 1 to 16, like --tabs 2.", isJson);
  const screensAsked = valueOf("--screens"), textAsked = valueOf("--text"), shard = valueOf("--shard"), picturesFolder = valueOf("--pictures");
  if (textAsked !== null && !TEXT_PERCENTS.includes(Number(textAsked))) stop(`--text takes ${TEXT_PERCENTS.join(" or ")}, like --text 200.`, isJson);
  let sizes;
  try {
    sizes = layoutCheckScreens(screensAsked === "all" ? "all" : screensAsked ? screensAsked.split(",").map((name) => name.trim()) : LOCAL_SCREEN_NAMES, textAsked === null ? null : Number(textAsked));
  } catch (error) {
    stop(error.message, isJson);
  }
  const chromePath = await chromeToRun();
  if (!chromePath) stop("No Chrome: set CHROME_PATH, or let it download Chrome for Testing (it couldn't).", isJson, "no_chrome");
  const sites = previewSites();
  if (!sites) stop("The preview didn't start: see .wrangler/preview-run/preview.log.", isJson, "no_preview");
  const allPages = LAYOUT_CHECK_PAGES;
  let pages = only ? allPages.filter((page) => page.path.includes(only)) : allPages;
  if (shard) {
    try {
      pages = layoutCheckShard(pages, shard);
    } catch (error) {
      stop(error.message.replace("LAYOUT_CHECK_SHARD is", "--shard is"), isJson);
    }
  }
  if (!pages.length) stop(`No page's path has ${only} in it.`, isJson);
  if (picturesFolder) mkdirSync(picturesFolder, { recursive: true });
  const startedMs = Date.now();
  const { checkedCount, failures } = await checkPages({
    ...sites,
    pages,
    sizes,
    chromePath,
    tabCount,
    picturesFolder,
    onPage: (page, size, theme, found) => !isJson && console.log(`${found.length ? "FAIL" : "  ok"} ${page.name}${page.path.length < 40 ? ` (${page.path})` : ""} ${size.name} ${theme}${found.length ? `: ${found.length}` : ""}`),
  });
  if (isJson) console.log(JSON.stringify({ checked_page_count: checkedCount, failures }, null, 2));
  else {
    for (const failure of failures) console.log(`  ${failure.page} ${failure.size} ${failure.theme}: ${failure.check}: ${failure.element}: ${failure.said}`);
    if (picturesFolder) console.log(`Contact sheets: ${picturesFolder}`);
    console.log(failures.length ? `LAYOUT FAIL: ${failures.length} problem(s) on ${new Set(failures.map((failure) => `${failure.page} ${failure.size} ${failure.theme}`)).size} of ${checkedCount} pages.` : `LAYOUT PASS: ${checkedCount} pages, ${sizes.map((size) => size.name).join(", ")}, light and dark, in ${Math.round((Date.now() - startedMs) / 1000)}s with ${tabCount} at once.`);
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
