#!/usr/bin/env node
// The measuring check (docs/DESIGN.md, Layout): opens every page and state in LAYOUT_CHECK_PAGES in headless Chrome on the screens players
// bring (checked-pages.ts's SCREEN_SIZES), and measures it the way a player would meet it, failing only on what they'd notice. Each rule
// has a tier (layout-measure.ts, LAYOUT_RULE_TIERS), and a run measures the tiers it's for (LAYOUT_CHECK_RUNS):
//   - a pull request's run (the default): every page and state on a phone and a laptop, in light (page), skipping each page that passed
//     before as it is (the test's own file);
//   - --sweep: every page and state, the stress accounts too, on the measured screens, in light, at 200% text, every tier, each night, and
//     in the merge queue on the pages its change reaches (--measured with --changed-only).
// No run measures dark: it changes only colours, which design.test.ts holds ("changes only colours in dark"). Pictures aren't loaded and
// Chrome draws on the CPU, since the check measures boxes, not pixels, and every picture's box is sized before it loads (design.test.ts).
// The rules, as a player meets the page:
//   - see: nothing past the screen, overlapping another thing with an edge or spilling out of its pane, a pane over the page that keeps
//     what's in it inside it, and the page's runner (its main action) and Home's first cover without scrolling;
//   - read: no words cut off or over something with an edge, nothing lost at 200% text (the sweep's screens), the page not scrolling sideways;
//   - reach: on a touch screen everything pressed at least 44px tall, and on one without touch every control reached by Tab, its focus
//     showing (checkKeyboardReach);
//   - load: nothing moving or changing its words after the first paint (the page alone, every file it names held back), the page within
//     its first paint's size (FIRST_PAINT_SIZE_LIMIT_BYTES), and
//     every picture in a Picture's box, its placeholder in its place (docs/DESIGN.md, "A page shows whole while it loads");
//   - press: every press answers within 400 ms (the Doherty threshold), on a laptop, in the sweep.
// Style isn't measured: the components hold it, and test/site/design.test.ts and test/node/materials.test.ts check them.
// Each failure says the page, the size, the theme, the thing (its component and label) and what was measured against what's expected.
//
//   npm run layout:check                     against this checkout's preview (started first when it isn't running: a few minutes)
//   npm run layout:check -- --sweep          every page and state on the measured screens, in light, at 200% text, every rule (as each night)
//   npm run layout:check -- --json           the same, as JSON
//   npm run layout:check -- --only /signin   only the pages whose path has that in it
//   npm run layout:check -- --tabs 2         how many pages it opens at once (DEFAULT_TAB_COUNT: one fewer than the cores, at most 4)
//   npm run layout:check -- --screens all    the measured screens, and 200% text (--screens every: all seven; or --screens Phone,Tablet: screens
//                                            by name), in place of the run's
//   npm run layout:check -- --text 200       the browser's text at 200% too, on a laptop and an iPad (TEXT_SCREEN_NAMES)
//   npm run layout:check -- --shard 2/4      the second of four shares of the pages, as the nightly sweep splits them
//   npm run layout:check -- --pages '["Home", "Sign in"]'  only the pages with these names (a JSON list), as npm run ship re-checks a
//                                            failed sweep's pages
//   npm run layout:check -- --measured <file>  writes each measured page's fingerprint (pageFingerprint) and whether it passed to <file>,
//                                            keeping what's there; with --changed-only, it skips each page whose fingerprint is in
//                                            <file> already: its markup, the check and the run are as they were when it was measured.
//                                            The merge queue runs the sweep this way on the pages its change reaches (check.yml)
//   npm run layout:check -- --pictures <dir> one contact sheet per page and state, <dir>/<state>.png: its screens side by side, light over dark,
//                                            with its pictures and drawing
//   CHROME_PATH=/path/to/chrome npm run layout:check
//
// Chrome is the system's or one downloaded before (scripts/chrome.mjs); without either it fetches Chrome for Testing into
// .wrangler/chrome. test/layout/layout-check.test.ts runs it on GitHub's check.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fetchChrome, findChrome, openChrome } from "./chrome.mjs";
import { mergeMeasured, readMeasured } from "./merge-measured.mjs";
import { PASSWORD } from "./preview/sign-ins.mjs";
import { FIRST_PAINT_BROTLI_LEVEL, FIRST_PAINT_COMPARE_SOURCE, FIRST_PAINT_SIZE_LIMIT_BYTES, FIRST_PAINT_SNAPSHOT_SOURCE, FOCUSABLE_SELECTOR, LAYOUT_TIERS, MEASURE_LAYOUT_SOURCE } from "../apps/site/src/components/layout-measure.ts";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { BLOCKED_PICTURE_PATTERNS, CHECKED_PAGES, LOCAL_SCREEN_NAMES, MEASURED_SCREEN_NAMES, SCREEN_SIZES, SCREEN_THEMES, STRESS_ACCOUNTS, TEXT_SCREEN_NAMES, UNIQUE_WORD } from "../apps/site/src/components/checked-pages.ts";
import { mkdirSync, writeFileSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The browser's text size as a share of its own 16px, for the runs at larger text (--text 200). */
const TEXT_PERCENTS = [200];

/**
 * The screens a run measures, by name (checked-pages.ts's SCREEN_SIZES), each { name, widthPx, heightPx, isPhone, hasTouch, isRunnerChecked,
 * textPercent }; "all" is the measured screens (MEASURED_SCREEN_NAMES) and "every" all seven, each with 200% text on TEXT_SCREEN_NAMES.
 * textPercent adds those screens at that text size.
 */
export function layoutCheckScreens(names = LOCAL_SCREEN_NAMES, textPercent = null) {
  const isAll = names === "all" || names === "every";
  const picked = names === "every" ? SCREEN_SIZES : (names === "all" ? MEASURED_SCREEN_NAMES : names).map((name) => SCREEN_SIZES.find((size) => size.name === name) ?? (() => { throw new Error(`No screen is called ${name}. The screens are ${SCREEN_SIZES.map((size) => size.name).join(", ")}.`); })());
  const atText = isAll || textPercent ? TEXT_SCREEN_NAMES.map((name) => SCREEN_SIZES.find((size) => size.name === name)) : [];
  const percent = textPercent ?? TEXT_PERCENTS[0];
  // At larger text the runner may fall below the fold: what's held there is that nothing is lost or cut, not the first view.
  return [...picked.map((size) => ({ ...size, textPercent: 100 })), ...atText.map((size) => ({ ...size, name: `${size.name} at ${percent}% text`, textPercent: percent, isRunnerChecked: false }))];
}
/** The screens every page is measured at unless told otherwise, and the pages: the same Screens shows (checked-pages.ts). */
export const LAYOUT_CHECK_SIZES = layoutCheckScreens();
export const LAYOUT_CHECK_THEMES = [...SCREEN_THEMES];
export const LAYOUT_CHECK_PAGES = CHECKED_PAGES;
const isStressPage = (page) => STRESS_ACCOUNTS.some((stress) => stress.account === page.account);

/**
 * What each run measures: its pages, screens and themes, and the tiers it measures on each page (layout-measure.ts, LAYOUT_RULE_TIERS).
 * pull_request is npm run layout:check without --sweep, as each pull request's Layout check runs it; sweep is --sweep, each night and in
 * the merge queue. Only light: dark changes only colours (design.test.ts holds it).
 */
export const LAYOUT_CHECK_RUNS = {
  pull_request: { pages: CHECKED_PAGES.filter((page) => !isStressPage(page)), sizes: LAYOUT_CHECK_SIZES, themes: ["light"], tiersOf: () => ["page"] },
  sweep: { pages: CHECKED_PAGES, sizes: layoutCheckScreens("all"), themes: ["light"], tiersOf: () => [...LAYOUT_TIERS] },
};
/** Pages open at once, each in its own window (tabs that share one aren't drawn): one fewer than the cores, so the preview keeps one. */
/** How long one page at one size and theme may take, loading and settling included, before it fails. */
const RUN_TIME_LIMIT_MS = 90_000;
// On GitHub's runners four; on a laptop two, so a local run stays cool (Julius, Oct 29, 2026).
export const DEFAULT_TAB_COUNT = Math.max(1, Math.min(process.env.CI ? 4 : 2, availableParallelism() - 1));

// Each page's time in a tab on GitHub's runners, in seconds, from a pull request's run (a phone and a laptop, in light; measured Oct 26,
// 2026: the Layout check job prints it as secondsByPage), by name: the nightly sweep deals the pages to its four runners by it
// (layoutCheckShard), each page's share of the whole being about the same at every screen. A page that isn't here (under 10s) costs
// UNLISTED_PAGE_COST_SEC.
const PAGE_COSTS_SEC = {
  "Gallery: layout": 28.6,
  Screens: 43.8,
  Home: 16.7,
  "Buying, confirm with a PIN": 14.1,
  "Buying, declined": 13.1,
  "Home, signed in": 12.2,
  "Games, signed in": 11.7,
  "Buying, can't be bought": 11.6,
  "Developer settings, a spending request": 11.2,
  "Game page": 11.1,
  "Buying, one press": 11.1,
  "Buying, a first card": 10.2,
  "Playing a game, asked to sign in": 10,
  // The gallery's pages, on every screen (measured Oct 29, 2026 on a Mac, scaled to two runs).
  "Gallery: the sidebar over the page": 33.0,
  "Gallery: inputs fields": 27.0,
  "Gallery: panes menus": 24.1,
  "Gallery: panes layers": 22.8,
  "Gallery: navigation bars": 21.5,
  "Gallery: actions buttons": 18.5,
  "Gallery: inputs pickers": 16.7,
  "Gallery: foundations look": 14.7,
  "Gallery: inputs choices": 12.7,
  "Gallery: panes cards": 12.4,
  "Gallery: panes buying": 12.0,
  "Gallery: navigation scrolling": 11.5,
  "Gallery: data pictures": 11.4,
};
const UNLISTED_PAGE_COST_SEC = 6;

// The check itself: a change to how it opens, settles or measures a page measures every page again.
const CHECK_SOURCE = readFileSync(fileURLToPath(import.meta.url), "utf8");

/**
 * A page's fingerprint for a run, as a hex string: its HTML as the server sends it, with what changes on every load taken out (nonce
 * values, hidden inputs' values, attributes ending in -ms), and everything else that decides what's measured: the page's entry, the run's
 * screens, themes and tiers, the measuring code and the check. Its CSS and scripts are content-addressed, so their addresses in the HTML
 * carry their change. The same fingerprint measures the same.
 */
export function pageFingerprint(html, page, looks, tiers) {
  const steady = html
    .replace(/\snonce="[^"]*"/g, ' nonce=""')
    .replace(/<input\b[^>]*\btype="hidden"[^>]*>/g, (input) => input.replace(/\svalue="[^"]*"/, ' value=""'))
    .replace(/\s([\w-]+-ms)="[^"]*"/g, ' $1=""');
  const hash = createHash("sha256");
  for (const part of [steady, JSON.stringify(page), JSON.stringify(looks.map((look) => [look.size.name, look.theme])), JSON.stringify(tiers), MEASURE_LAYOUT_SOURCE, FIRST_PAINT_SNAPSHOT_SOURCE, FIRST_PAINT_COMPARE_SOURCE, CHECK_SOURCE]) hash.update(part).update("\0");
  return hash.digest("hex");
}

/**
 * Only the pages of a run with these names, and the names no page has: a re-check of a failed sweep's pages runs on a later commit,
 * where a page may be renamed or gone, so those are said and skipped, not refused.
 */
export function pagesNamed(pages, names) {
  if (!Array.isArray(names) || !names.length || names.some((name) => typeof name !== "string")) throw new Error(`--pages takes a JSON list of page names, like '["Home", "Sign in"]'.`);
  return { pages: pages.filter((page) => names.includes(page.name)), unknownNames: names.filter((name) => !pages.some((page) => page.name === name)) };
}

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

/**
 * Glass without its blur, over a backdrop that isn't drawn: where things sit is the same, and a frame takes milliseconds instead of the
 * seconds a large screen's blurred panes take to draw without a graphics card (Desktop's layout gallery took over a second a frame). A run
 * that takes pictures (--pictures) keeps the real look.
 */
const PLAIN_GLASS = `(() => {
  if (!document.querySelector("style[data-layout-check-plain]")) {
    const style = document.createElement("style");
    style.setAttribute("data-layout-check-plain", "");
    // And every gallery section laid out, whatever its script does after a resize (it skips the ones off screen again 150 ms after one).
    style.textContent = "*, *::before, *::after { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; } .component-section { content-visibility: visible !important; }";
    document.head.append(style);
  }
  document.querySelectorAll("canvas").forEach((canvas) => canvas.setAttribute("data-backdrop-paused", ""));
  return true;
})()`;

/**
 * What measuring doesn't draw, from before the page's scripts run: its WebGL is gone (getContext answers null for "webgl" and "webgl2",
 * as a browser without it does), and every canvas is paused as it's added, so the backdrop never starts.
 */
const MEASURE_ONLY = `(() => {
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, ...rest) { return /^webgl2?$/.test(kind) ? null : getContext.call(this, kind, ...rest); };
  const pause = (node) => { if (node.nodeType !== 1) return; if (node.tagName === "CANVAS") node.setAttribute("data-backdrop-paused", ""); node.querySelectorAll?.("canvas").forEach((canvas) => canvas.setAttribute("data-backdrop-paused", "")); };
  new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach(pause))).observe(document, { childList: true, subtree: true });
})();`;

/** Waits until the page has drawn: loaded, its fonts in, the gallery's skipped sections laid out, the edge rule's shapes drawn. */
const SETTLE = `(async () => {
  // The page's load, or 15 seconds: a game's frame on a busy machine may never finish loading, and the page is measured all the same.
  if (document.readyState !== "complete") await Promise.race([new Promise((done) => addEventListener("load", done, { once: true })), new Promise((done) => setTimeout(done, 15000))]);
  if (document.fonts) await document.fonts.ready;
  document.querySelectorAll(".component-section").forEach((section) => { section.style.contentVisibility = "visible"; });
  // The edge rule draws on demand (zaismaWatch.drawAll) instead of waiting on the frames' ResizeObserver, a few times over so a part fits a
  // holder drawn in the same pass; scripts that answer a change (a page's own MutationObservers) get a timer's turn between.
  const turn = () => new Promise((done) => setTimeout(done, 0));
  // What a page's scripts do on a frame (a sheet opened as it loads, a card placed) still gets two frames, cheap with nothing drawn.
  if (window.zaismaWatch?.drawAll) for (let pass = 0; pass < 3; pass++) { await turn(); window.zaismaWatch.drawAll(); }
  for (let frame = 0; frame < 2; frame++) await new Promise((done) => requestAnimationFrame(done));
  // What's still moving in (a sheet's entrance), up to 400 ms: nothing to wait for when nothing moves.
  const moving = document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity && animation.playState === "running");
  await Promise.race([Promise.all(moving.map((animation) => animation.finished.catch(() => {}))), new Promise((done) => setTimeout(done, 400))]);
  window.zaismaWatch?.drawAll?.();
  // Freshly loaded, a page's own timers (a sheet shown as it loads) get 400 ms; a screen switched in place, 50.
  await new Promise((done) => setTimeout(done, window.__zaismaLayoutSettled ? 50 : 400));
  window.__zaismaLayoutSettled = true;
  return true;
})()`;

/** What a phone's and a tablet's browser call themselves (their user agent), for a page that guesses the device from it. */
const PHONE_BROWSER_NAME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const TABLET_BROWSER_NAME = "Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/**
 * Waits for the page's first paint as a slow connection shows it: the page alone read and the first-paint script it carries run (every
 * file it names held back: its stylesheet, its script files, its pictures), and what that script draws drawn. The gallery holds its first
 * paint for its files, so its own are let through.
 */
const FIRST_PAINT_READY = `(async () => {
  const turn = () => new Promise((done) => setTimeout(done, 0));
  for (let waitedMs = 0; waitedMs < 15000 && (document.readyState === "loading" || (document.querySelector('script[src*="/js/first-paint."]') && !window.zaismaWatch)); waitedMs += 50) await new Promise((done) => setTimeout(done, 50));
  // Its fonts in, as they are when it's compared: Jost's fallback takes its room, so their arrival is no part of what's measured.
  if (document.fonts) await Promise.race([document.fonts.ready, new Promise((done) => setTimeout(done, 5000))]);
  if (window.zaismaWatch?.drawAll) for (let pass = 0; pass < 3; pass++) { await turn(); window.zaismaWatch.drawAll(); }
  // The frames a browser takes to its first paint, its ResizeObservers' answers in them.
  for (let frame = 0; frame < 2; frame++) await new Promise((done) => requestAnimationFrame(done));
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
    .filter((el) => el.getClientRects().length && !el.closest(".steps, [inert], [hidden], dialog:not([open]), .dropdown.shut, template") && !el.disabled)
    // A gallery still shows what a button opens laid in place (a menu, a wheel field's wheels, a search's list), open for good: pressing it
    // changes nothing, by design. A field typed into (a search with its list) answers its typing, not a press: a press only puts the caret in it.
    .filter((el) => !el.matches("input:not([type=button], [type=submit], [type=checkbox], [type=radio]), textarea"))
    .filter((el) => !document.getElementById(el.getAttribute("aria-controls") || el.getAttribute("popovertarget") || "")?.closest(".in-place"));
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
      // The press's own component, up to three levels round it (a copy field's Copy, in its Well's end slot, says Copied on the field's
      // label line), never the pane or layout cell it sits in.
      const OUTSIDE = "[data-glass], .pane-in, .sheet-in, .stack-cell, .row-cell, .grid-cell, .example-stage, main, body";
      let around = el;
      for (let level = 0; level < 3 && around.parentElement && !around.parentElement.matches(OUTSIDE); level++) around = around.parentElement;
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

/**
 * The keyboard check (layout-measure.ts, reach), on a screen without touch: Tab, round the whole page from wherever focus is, reaches every
 * control (FOCUSABLE_SELECTOR) and shows where it is. Glass shows focus on a control's component, not always on the focused element (a cut
 * button's face and cut line, a field's box round its input), so what's compared is the component, as at rest and as focused: the element
 * and up to three levels round it, inside the cell or pane it sits in, with everything in it. Frames are made inert for it, so Tab never
 * walks a game's pages or Screens', and the page is left as it was for the next screen: its scrolling, what was open, nothing focused.
 */
const KEYBOARD_START = `(() => {
  const OUTSIDE = "[data-glass], .pane-in, .sheet-in, .stack-cell, .row-cell, .grid-cell, .example-stage, main, body";
  const LOOKS = ["outline-style", "outline-width", "outline-color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "box-shadow", "background-color", "background-image", "color", "filter", "stroke", "stroke-width", "fill", "opacity", "text-decoration-line"];
  const componentOf = (el) => {
    let around = el;
    for (let level = 0; level < 3 && around.parentElement && !around.parentElement.matches(OUTSIDE); level++) around = around.parentElement;
    return around;
  };
  const lookOf = (el) => {
    const around = componentOf(el), lookOfPart = (css) => LOOKS.map((name) => css.getPropertyValue(name)).join("|");
    const parts = [around, ...around.querySelectorAll("*")].map((part) => lookOfPart(getComputedStyle(part)));
    for (const each of new Set([el, around])) for (const pseudo of ["::before", "::after"]) { const css = getComputedStyle(each, pseudo); parts.push(css.content === "none" ? "" : lookOfPart(css)); }
    return parts.join("\\n");
  };
  // A focus look that eases in reads as it ends, never as it starts: the page's styles worked out first, so its transitions have begun.
  const settle = () => {
    document.documentElement.getBoundingClientRect();
    document.getAnimations().forEach((animation) => { if (animation instanceof CSSTransition) animation.finish(); });
  };
  // The browser Tabs to one radio of a group: reaching it reaches the group.
  const groupOf = (el) => (el.matches("input[type=radio][name]") ? [...document.forms].indexOf(el.form) + ":" + el.name : null);
  const frames = [...document.querySelectorAll("iframe:not([inert])")];
  frames.forEach((frame) => frame.setAttribute("inert", ""));
  document.activeElement?.blur?.();
  const scrollers = [document.scrollingElement, ...document.querySelectorAll("body *")].filter((el) => el === document.scrollingElement || ((el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) && /auto|scroll/.test(getComputedStyle(el).overflow)));
  // While a sheet is open over the page (a modal dialog), the page under it is out of Tab's reach by design: only the top one's controls count.
  const modal = [...document.querySelectorAll(":modal")].pop();
  const controls = [...(modal ?? document).querySelectorAll(${JSON.stringify(FOCUSABLE_SELECTOR)})].filter((el) => !el.matches(":disabled") && el.checkVisibility({ visibilityProperty: true }) && !el.closest("[inert], [hidden], template, dialog:not([open]), details:not([open]) > :not(summary), .dropdown.shut"));
  settle();
  // One shown open (a picker in place) already wears its focus look as it rests: being open marks it.
  const opened = new Set(controls.filter((el) => el.getAttribute("aria-expanded") === "true"));
  window.zaismaKeyboard = { controls, rest: controls.map(lookOf), reached: new Set(), reachedGroups: new Set(), unseen: new Set(), shownOpen: opened, first: null, frames, scrollerPlaces: scrollers.map((el) => [el, el.scrollTop, el.scrollLeft]), opened: new Set(document.querySelectorAll("dialog[open], :popover-open")), lookOf, settle, groupOf };
  return { controlCount: controls.length, scrollerCount: scrollers.length };
})()`;

/** After a Tab: whether focus is back on the first control it reached (round the page, or held where it is), so the presses stop. */
const KEYBOARD_STEP = `(() => {
  const state = window.zaismaKeyboard;
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  const index = state.controls.indexOf(el);
  if (index < 0) return false;
  if (state.first === el) return true;
  state.first ??= el;
  state.reached.add(el);
  if (state.groupOf(el)) state.reachedGroups.add(state.groupOf(el));
  state.settle();
  if (!state.shownOpen.has(el) && state.lookOf(el) === state.rest[index]) state.unseen.add(el);
  return false;
})()`;

/** What Tab never reached or reached unseen, after pressCount presses, with the page put back as it was. */
const keyboardEnd = (pressCount) => `(() => {
  const state = window.zaismaKeyboard;
  delete window.zaismaKeyboard;
  const describe = (el) => el.tagName.toLowerCase() + ' "' + (el.getAttribute("aria-label") || el.textContent || el.getAttribute("name") || el.className || "").trim().replace(/\\s+/g, " ").slice(0, 48) + '"';
  const failures = [];
  for (const el of state.controls) {
    if (!state.reached.has(el) && !state.reachedGroups.has(state.groupOf(el))) failures.push({ check: "a control the keyboard doesn't reach", element: describe(el), said: "Tab never focused it in ${pressCount} presses" });
    else if (state.unseen.has(el)) failures.push({ check: "a focused control with no visible focus", element: describe(el), said: "focused, nothing about it changed: outline, border, shadow and background as at rest" });
  }
  document.activeElement?.blur?.();
  document.querySelectorAll("dialog[open], :popover-open").forEach((layer) => { if (!state.opened.has(layer)) { if (layer.matches("dialog")) layer.close(); else layer.hidePopover(); } });
  state.frames.forEach((frame) => frame.removeAttribute("inert"));
  state.scrollerPlaces.forEach(([el, top, left]) => { el.scrollTop = top; el.scrollLeft = left; });
  state.settle();
  return failures;
})()`;

/**
 * Presses past one for each control and each box that scrolls (Chrome lets Tab focus a box that scrolls with no control in it): the page's
 * end and its start again.
 */
const EXTRA_TAB_PRESS_COUNT = 5;
const TAB_KEY = { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 };

/** Tabs round the page (KEYBOARD_START, KEYBOARD_STEP, keyboardEnd): its failures. */
async function checkKeyboardReach(send) {
  const failed = (details) => [{ check: "the check couldn't measure the page", element: "", said: details.exception?.description ?? details.text }];
  const started = await send("Runtime.evaluate", { expression: KEYBOARD_START, returnByValue: true });
  if (started.exceptionDetails) return failed(started.exceptionDetails);
  const maximumPressCount = started.result.value.controlCount + started.result.value.scrollerCount + EXTRA_TAB_PRESS_COUNT;
  let pressCount = 0;
  while (pressCount < maximumPressCount) {
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...TAB_KEY });
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...TAB_KEY });
    pressCount++;
    const step = await send("Runtime.evaluate", { expression: KEYBOARD_STEP, returnByValue: true });
    if (step.exceptionDetails) return failed(step.exceptionDetails);
    if (step.result.value) break;
  }
  const ended = await send("Runtime.evaluate", { expression: keyboardEnd(pressCount), returnByValue: true });
  return ended.exceptionDetails ? failed(ended.exceptionDetails) : ended.result.value;
}

/** Opens each pane a button in the gallery opens (a dropdown, a sheet, a popover), measures its size alone, and closes it: its failures, each naming the button. */
const openEveryPane = () => `(async () => {
  const measure = ${MEASURE_LAYOUT_SOURCE};
  const openers = [...document.querySelectorAll("main [aria-controls], main [popovertarget]")].filter((el) => {
    const pane = document.getElementById(el.getAttribute("aria-controls") || el.getAttribute("popovertarget"));
    return pane && pane.matches(".dropdown, dialog.sheet, [popover]") && el.getClientRects().length && !el.closest("[inert], dialog, .dropdown");
  });
  const failures = [];
  // A pane is measured once it's done moving: its opening (or closing) animations finished, never more than 450 ms (a press's most), and
  // never a fixed wait, so a page of many panes takes as long as its panes take to open. Where things sit is worked out before a frame is
  // drawn, so it waits on the page's scripts (a timer's turn), never on drawing, which a large screen takes long over without a graphics card.
  const frame = () => new Promise((done) => setTimeout(done, 16));
  const settled = async (pane) => {
    await frame(); await frame();
    const moving = pane.getAnimations({ subtree: true }).filter((animation) => animation.effect?.getTiming().iterations !== Infinity);
    await Promise.race([Promise.all(moving.map((animation) => animation.finished.catch(() => {}))), new Promise((done) => setTimeout(done, 450))]);
  };
  for (const opener of openers) {
    const pane = document.getElementById(opener.getAttribute("aria-controls") || opener.getAttribute("popovertarget"));
    opener.scrollIntoView({ block: "center" });
    await frame();
    opener.click();
    await settled(pane);
    const label = (opener.getAttribute("aria-label") || opener.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 40);
    failures.push(...measure({ isPanesOnly: true }).map((failure) => ({ ...failure, element: failure.element + ", opened from " + JSON.stringify(label) })));
    document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
    document.querySelectorAll(":popover-open").forEach((popover) => popover.hidePopover());
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await settled(pane);
  }
  return failures;
})()`;

/** One page in a fresh tab, in a window of its own so it's drawn while others are open, at each size and theme in looks: their failures, one list each. */
async function checkPage(chrome, contextId, url, looks, options) {
  const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank", browserContextId: contextId, newWindow: true });
  const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params = {}) => chrome.send(method, params, sessionId);
  // A phone and a tablet send their kind of browser's name, which a first visit's page is laid out for (device-kind.ts), as a real one would.
  const look = async ({ size, theme }) => {
    await send("Emulation.setDeviceMetricsOverride", { width: size.widthPx, height: size.heightPx, deviceScaleFactor: size.isPhone ? 2 : 1, mobile: size.isPhone });
    // Sent with its requests only (the page's scripts see Chrome as it is, as the check has always measured them).
    await send("Network.setExtraHTTPHeaders", { headers: size.isPhone || size.hasTouch ? { "User-Agent": size.isPhone ? PHONE_BROWSER_NAME : TABLET_BROWSER_NAME } : {} });
    await send("Emulation.setTouchEmulationEnabled", size.hasTouch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    // The browser's text size (its default font size, which rem follows): 16px is 100%.
    const textPx = Math.round((16 * (size.textPercent ?? 100)) / 100);
    await send("Page.setFontSizes", { fontSizes: { standard: textPx, fixed: Math.round((13 * (size.textPercent ?? 100)) / 100) } });
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }, { name: "prefers-reduced-motion", value: "reduce" }] });
  };
  const said = async () => (await send("Runtime.evaluate", { expression: SAID_STATE, returnByValue: true }).catch(() => null))?.result?.value ?? null;
  try {
    await send("Page.enable");
    // Each tab is its own window, and only one has the system's focus: every one acts focused, so Tab moves focus in each (checkKeyboardReach).
    await send("Emulation.setFocusEmulationEnabled", { enabled: true });
    // Measuring needs no WebGL drawing: a page asks for a context and is told there's none (as on a machine without it), which skips the
    // seconds a first context and its shaders take with no graphics card. A run that takes pictures draws everything.
    if (!options.pictureOf) await send("Page.addScriptToEvaluateOnNewDocument", { source: MEASURE_ONLY });
    // Nor its pictures: loading them is most of a page's time, and each one's box is sized before it loads (BLOCKED_PICTURE_PATTERNS).
    if (!options.pictureOf) {
      await send("Network.enable");
      await send("Network.setBlockedURLs", { urls: [...BLOCKED_PICTURE_PATTERNS] });
    }
    await look(looks[0]);
    const loaded = () => new Promise((done) => {
      const off = chrome.listen(sessionId, (method) => method === "Page.loadEventFired" && (off(), done()));
    });
    let next = loaded();
    // The loading check (layout-measure.ts, FIRST_PAINT_SNAPSHOT_SOURCE): the page as it first paints, the page alone with the first-paint
    // script it carries, every file it names held back (its stylesheet, script files and pictures), as a slow connection shows it, kept to be
    // compared once it has loaded. Fonts aren't held, and it waits for them: Jost's fallback is Arial set to take its room, and a runner
    // without Arial would measure a fallback no player sees.
    const isFirstPaintChecked = !options.pictureOf && !options.stepsToTake?.length && !options.markup && !options.setUp;
    const held = [];
    const offPaused = isFirstPaintChecked ? chrome.listen(sessionId, (method, params) => {
      if (method !== "Fetch.requestPaused") return;
      // The preview's own tools, which no player gets, pass; so do the gallery's files, which its first paint waits for (design-page.ts).
      const isGalleryFile = options.isGallery && params.resourceType !== "Image";
      if (isGalleryFile || /\/js\/layout-inspect\.|\/__preview\//.test(params.request.url)) send("Fetch.continueRequest", { requestId: params.requestId }).catch(() => {});
      else held.push(params.requestId);
    }) : null;
    if (isFirstPaintChecked) await send("Fetch.enable", { patterns: ["Script", "Stylesheet", "Image"].map((resourceType) => ({ urlPattern: "*", resourceType, requestStage: "Request" })) });
    // A device's kind kept from another screen's page in this run (device-kind.ts's cookie) would lay this one out for that screen: the page
    // guesses it from the browser's name, as on a first visit.
    await send("Network.deleteCookies", { name: "zaisma_device_kind", url }).catch(() => {});
    // The page as sent, for its first paint's size: the document's own answer, read once it's loaded.
    let documentRequestId = null;
    const offDocument = isFirstPaintChecked ? chrome.listen(sessionId, (method, params) => {
      if (method === "Network.responseReceived" && params.type === "Document" && documentRequestId === null) documentRequestId = params.requestId;
    }) : null;
    await send("Page.navigate", { url });
    if (isFirstPaintChecked) {
      await send("Runtime.evaluate", { expression: FIRST_PAINT_READY, awaitPromise: true, returnByValue: true });
      await send("Runtime.evaluate", { expression: FIRST_PAINT_SNAPSHOT_SOURCE, returnByValue: true });
      offPaused();
      for (const requestId of held) await send("Fetch.continueRequest", { requestId }).catch(() => {});
      await send("Fetch.disable");
    }
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
    const plain = async () => { if (!options.pictureOf) await send("Runtime.evaluate", { expression: PLAIN_GLASS, returnByValue: true }); };
    if (options.setUp) {
      await plain();
      await send("Runtime.evaluate", { expression: SETTLE, awaitPromise: true, returnByValue: true });
      const opened = await send("Runtime.evaluate", { expression: options.setUp, awaitPromise: true, returnByValue: true });
      if (opened.exceptionDetails) return looks.map(() => [{ check: "the check couldn't open the page's hidden state", element: "", said: opened.exceptionDetails.exception?.description ?? opened.exceptionDetails.text }]);
    }
    const foundByLook = [];
    for (const [lookIndex, { size, theme }] of looks.entries()) {
      if (lookIndex > 0) await look({ size, theme });
      await plain();
      await send("Runtime.evaluate", { expression: SETTLE, awaitPromise: true, returnByValue: true });
      const isMainActionChecked = size.isRunnerChecked !== false && (options.mainActionShows === "everywhere" || (options.mainActionShows === "desktop" && !size.isPhone));
      const measured = { isMainActionChecked, isCoverAboveFold: Boolean(options.isCoverAboveFold) && size.isRunnerChecked !== false, isTouch: Boolean(size.hasTouch), tiers: options.tiers };
      const { result, exceptionDetails } = await send("Runtime.evaluate", { expression: `(${MEASURE_LAYOUT_SOURCE})(${JSON.stringify(measured)})`, returnByValue: true });
      const found = exceptionDetails ? [{ check: "the check couldn't measure the page", element: "", said: exceptionDetails.exception?.description ?? exceptionDetails.text }] : result.value;
      // What moved or changed its words since the first paint, measured once, on the screen the page first painted on.
      if (isFirstPaintChecked && lookIndex === 0) {
        // The gallery is a tool, not a page players see: its first paint waits for all its scripts (design-page.ts), so on it only its
        // pictures are measured (each with its placeholder); what its examples' harness does after (a loop, a frame fitted to its menu) isn't a load.
        const firstPaintTiers = options.isGallery ? options.tiers.filter((tier) => tier !== "page") : options.tiers;
        const compared = await send("Runtime.evaluate", { expression: `(${FIRST_PAINT_COMPARE_SOURCE})(${JSON.stringify({ tiers: firstPaintTiers })})`, returnByValue: true });
        found.push(...(compared.exceptionDetails ? [{ check: "moved after the first paint", element: "", said: compared.exceptionDetails.exception?.description ?? compared.exceptionDetails.text }] : compared.result.value));
        offDocument?.();
        const sent = documentRequestId === null ? null : await send("Network.getResponseBody", { requestId: documentRequestId }).catch(() => null);
        if (sent) {
          const sizeBytes = brotliCompressSync(Buffer.from(sent.body, sent.base64Encoded ? "base64" : "utf8"), { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: FIRST_PAINT_BROTLI_LEVEL } }).length;
          if (sizeBytes > FIRST_PAINT_SIZE_LIMIT_BYTES) found.push({ check: "first paint over its size", element: "", said: `the page is ${(sizeBytes / 1000).toFixed(1)} KB compressed, past ${FIRST_PAINT_SIZE_LIMIT_BYTES / 1000} KB: what's in it, and the styles and first-paint script it carries for that, come to more than a first paint on a slow connection can take` });
        }
      }
      // The entry's address must show the state it's named for (checked-pages.ts), so a list that drifts from the pages fails here.
      const state = await said();
      if (!options.markup && state !== (options.stateBeforeSetUp ?? options.shownStateName ?? options.name)) {
        const address = (await send("Runtime.evaluate", { expression: "location.pathname + location.search", returnByValue: true })).result?.value;
        found.push({ check: "the page isn't the state it's listed as", element: "", said: `${state === null ? "it names no state (a page built in Zaisma's look names one: html.ts, checkedPage)" : `it says it's "${state}"`}, at ${address}` });
      }
      // Tab round the page, on a screen without touch: before the gallery's panes and the presses, which move focus.
      if (!size.hasTouch) found.push(...(await checkKeyboardReach(send)));
      // The gallery's panes, each opened from its button, measured on their own, and closed (docs/DESIGN.md, Pane sizes).
      if (options.isGallery) {
        const panes = await send("Runtime.evaluate", { expression: openEveryPane(), awaitPromise: true, returnByValue: true });
        found.push(...(panes.exceptionDetails ? [{ check: "the check couldn't open the gallery's panes", element: "", said: panes.exceptionDetails.exception?.description ?? panes.exceptionDetails.text }] : panes.result.value));
      }
      // Every press that answers in the page answers within 400 ms (the Doherty threshold), on a laptop, once (a press changes the page),
      // in the sweep: pressing every button is most of a page's time.
      if (options.tiers.includes("sweep") && size.name === "Laptop" && theme === "light" && !options.stepsToTake && !options.setUp) {
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
export async function signIn(chrome, contextId, site, username) {
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
 * fixture), on the example page. tiersOf gives the tiers measured on each page (every tier unless told otherwise).
 */
/**
 * Measures each page at each size and theme. With `measured` (a --measured file's fingerprints), it answers each measured page's
 * fingerprint and whether it passed, as measuredFingerprints; with isChangedOnly too, it skips the pages whose fingerprint is in
 * `measured`, as skippedPageNames. A page that sends forms or opens a hidden state reaches it only in a browser, so it's always measured.
 */
export async function checkPages({ site, signInSite, pages = LAYOUT_CHECK_PAGES, sizes = LAYOUT_CHECK_SIZES, themes = LAYOUT_CHECK_THEMES, tiersOf = () => [...LAYOUT_TIERS], chromePath, tabCount = DEFAULT_TAB_COUNT, onPage = () => {}, picturesFolder = null, measured = null, isChangedOnly = false }) {
  // Each page's pictures, by its name: one per screen and theme, for its contact sheet.
  const picturesByPage = new Map();
  // Measuring draws nothing a GPU would (no WebGL, no pictures), so Chrome keeps off the machine's GPU; a run that takes pictures draws.
  const chrome = await openChrome(chromePath, "zaisma-layout-", { isDrawingOnCpu: !picturesFolder });
  const looks = sizes.flatMap((size) => themes.map((theme) => ({ size, theme })));
  // A page is opened once for each theme (the gallery takes it from its address) and measured at each size in place, the screen switched
  // without a reload; one that sends forms is opened once, its answer measured at each size and theme.
  let runs = pages.flatMap((page) => (page.stepsToTake ? [{ page, looks }] : themes.map((theme) => ({ page, looks: looks.filter((one) => one.theme === theme) }))));
  const foundByRun = [];
  const fingerprintByPage = new Map();
  const skippedPageNames = [];
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
    // Each page's fingerprint, from its HTML fetched with its account's cookies: no tab opens for one that's skipped.
    if (measured) {
      for (const page of pages) {
        if (page.stepsToTake || page.setUp) continue;
        const base = page.isOnSignInSite ? signInSite : site;
        const { cookies } = await chrome.send("Storage.getCookies", { browserContextId: await contextFor(page.account) });
        const response = await fetch(`${base}${page.path}`, { headers: { cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ") } }).catch(() => null);
        if (!response?.ok) continue;
        const fingerprint = pageFingerprint(await response.text(), page, looks, tiersOf(page));
        fingerprintByPage.set(page.name, fingerprint);
        if (isChangedOnly && fingerprint in measured) skippedPageNames.push(page.name);
      }
      runs = runs.filter((run) => !skippedPageNames.includes(run.page.name));
    }
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
        const foundByLook = await Promise.race([checkPage(chrome, contextId, url, runLooks, { ...page, pictureOf, tiers: tiersOf(page) }), wait(RUN_TIME_LIMIT_MS * runLooks.length).then(() => tooSlow)]);
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
  const failures = foundByRun.flat();
  const measuredFingerprints = Object.fromEntries([...fingerprintByPage].filter(([name]) => !skippedPageNames.includes(name) && runs.some((run, runIndex) => run.page.name === name && foundByRun[runIndex])).map(([name, fingerprint]) => [fingerprint, failures.some((failure) => failure.page === name) ? "failed" : "passed"]));
  return { checkedCount: runs.reduce((count, run, runIndex) => count + (foundByRun[runIndex] ? run.looks.length : 0), 0), failures, secondsByPage, measuredFingerprints, skippedPageNames };
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
  const VALUED = ["--only", "--tabs", "--screens", "--text", "--shard", "--pictures", "--pages", "--measured"];
  const valueOf = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
  const isJson = args.includes("--json");
  const runName = args.includes("--sweep") ? "sweep" : "pull_request";
  const layoutRun = LAYOUT_CHECK_RUNS[runName];
  const only = valueOf("--only");
  const tabCount = args.includes("--tabs") ? Number(valueOf("--tabs")) : DEFAULT_TAB_COUNT;
  const unknown = args.filter((arg, i) => !["--json", "--sweep", "--changed-only", ...VALUED].includes(arg) && !VALUED.includes(args[i - 1]));
  const OPTIONS_WORDS = "The options are --sweep, --json, --only <part of a page's path>, --pages <JSON list of page names>, --tabs <pages at once>, --screens all, every or <name>,<name>, --text 200, --shard <n>/<count>, --pictures <folder>, and --measured <file> with --changed-only.";
  if (unknown.length) stop(`Unknown option ${unknown.join(" ")}. ${OPTIONS_WORDS}`, isJson);
  if (!Number.isInteger(tabCount) || tabCount < 1 || tabCount > 16) stop("--tabs takes a whole number from 1 to 16, like --tabs 2.", isJson);
  const screensAsked = valueOf("--screens"), textAsked = valueOf("--text"), shard = valueOf("--shard"), picturesFolder = valueOf("--pictures"), pagesAsked = valueOf("--pages"), measuredPath = valueOf("--measured");
  const isChangedOnly = args.includes("--changed-only");
  if (isChangedOnly && !measuredPath) stop("--changed-only skips the pages a --measured file has: give --measured <file> too.", isJson);
  if (textAsked !== null && !TEXT_PERCENTS.includes(Number(textAsked))) stop(`--text takes ${TEXT_PERCENTS.join(" or ")}, like --text 200.`, isJson);
  let sizes = layoutRun.sizes;
  try {
    if (screensAsked !== null || textAsked !== null) sizes = layoutCheckScreens(screensAsked === "all" || screensAsked === "every" ? screensAsked : screensAsked ? screensAsked.split(",").map((name) => name.trim()) : LOCAL_SCREEN_NAMES, textAsked === null ? null : Number(textAsked));
  } catch (error) {
    stop(error.message, isJson);
  }
  const chromePath = await chromeToRun();
  if (!chromePath) stop("No Chrome: set CHROME_PATH, or let it download Chrome for Testing (it couldn't).", isJson, "no_chrome");
  const sites = previewSites();
  if (!sites) stop("The preview didn't start: see .wrangler/preview-run/preview.log.", isJson, "no_preview");
  const allPages = layoutRun.pages;
  let pages = only ? allPages.filter((page) => page.path.includes(only)) : allPages;
  if (pagesAsked !== null) {
    try {
      const named = pagesNamed(pages, (() => { try { return JSON.parse(pagesAsked); } catch { return null; } })());
      if (named.unknownNames.length && !isJson) console.log(`No page in this run is called ${named.unknownNames.join(", ")} (renamed or gone): skipped. The pages are ${allPages.map((page) => page.name).join(", ")}.`);
      if (!named.pages.length) {
        console.log(isJson ? JSON.stringify({ checked_page_count: 0, failures: [], failed_page_names: [], skipped_page_names: named.unknownNames, seconds_by_page: {} }) : "LAYOUT PASS: none of the pages asked for is in this run.");
        process.exit(0);
      }
      pages = named.pages;
    } catch (error) {
      stop(error.message, isJson);
    }
  }
  if (shard) {
    try {
      pages = layoutCheckShard(pages, shard);
    } catch (error) {
      stop(error.message.replace("LAYOUT_CHECK_SHARD is", "--shard is"), isJson);
    }
  }
  // A share can be empty when only a few pages are asked for (--pages, as npm run ship re-checks a sweep's): nothing in it fails.
  if (!pages.length && shard && !only) {
    console.log(isJson ? JSON.stringify({ checked_page_count: 0, failures: [], failed_page_names: [], skipped_page_names: [], seconds_by_page: {} }) : `LAYOUT PASS: no page in share ${shard}.`);
    process.exit(0);
  }
  if (!pages.length) stop(`No page's path has ${only} in it.`, isJson);
  if (picturesFolder) mkdirSync(picturesFolder, { recursive: true });
  const startedMs = Date.now();
  // A contact sheet shows light over dark.
  const themes = picturesFolder ? LAYOUT_CHECK_THEMES : layoutRun.themes;
  let measured = null;
  if (measuredPath) {
    try {
      measured = readMeasured(measuredPath);
    } catch (error) {
      stop(`--measured ${measuredPath} can't be read: ${error.message}`, isJson);
    }
  }
  const { checkedCount, failures, secondsByPage, measuredFingerprints, skippedPageNames } = await checkPages({
    ...sites,
    pages,
    sizes,
    themes,
    tiersOf: layoutRun.tiersOf,
    chromePath,
    tabCount,
    picturesFolder,
    measured,
    isChangedOnly,
    onPage: (page, size, theme, found) => !isJson && console.log(`${found.length ? "FAIL" : "  ok"} ${page.name}${page.path.length < 40 ? ` (${page.path})` : ""} ${size.name} ${theme}${found.length ? `: ${found.length}` : ""}`),
  });
  if (measuredPath) writeFileSync(measuredPath, `${JSON.stringify(mergeMeasured(measured, measuredFingerprints))}\n`);
  const failedPageNames = [...new Set(failures.map((failure) => failure.page))];
  if (isJson) console.log(JSON.stringify({ checked_page_count: checkedCount, failures, failed_page_names: failedPageNames, skipped_page_names: skippedPageNames, seconds_by_page: secondsByPage }, null, 2));
  else {
    for (const failure of failures) console.log(`  ${failure.page} ${failure.size} ${failure.theme}: ${failure.check}: ${failure.element}: ${failure.said}`);
    if (picturesFolder) console.log(`Contact sheets: ${picturesFolder}`);
    if (skippedPageNames.length) console.log(`Skipped ${skippedPageNames.length} page(s) measured before as they are: ${skippedPageNames.join(", ")}.`);
    // One line npm run ship reads from a failed sweep's log, to measure those pages again (sweepFailedPages, scripts/ship-github-check.mjs).
    if (failedPageNames.length) console.log(`LAYOUT FAILED PAGES ${JSON.stringify(failedPageNames)}`);
    console.log(failures.length ? `LAYOUT FAIL: ${failures.length} problem(s) on ${new Set(failures.map((failure) => `${failure.page} ${failure.size} ${failure.theme}`)).size} of ${checkedCount} pages.` : `LAYOUT PASS: ${checkedCount} pages, ${sizes.map((size) => size.name).join(", ")}, ${themes.join(" and ")}, measuring ${[...new Set(allPages.flatMap(layoutRun.tiersOf))].join(", ")}, in ${Math.round((Date.now() - startedMs) / 1000)}s with ${tabCount} at once.`);
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
