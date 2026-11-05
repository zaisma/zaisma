#!/usr/bin/env node
// Presses every button on the Screens bench in headless Chrome, as the wrong person where one's needed, and sees each arrive on the phone
// screen: the page says the screen it's named for, at its address, as its person, with what it opens open. Heavy, so it runs on GitHub each night
// (.github/workflows/nightly.yml, "Bench presses"), not in a pull request; test/node/screens-bench.test.ts holds in every pull request that
// each named screen has a button or a written reason.
//
// What it can't catch: a screen only the data makes (an alert some games have, a hold on a version), since nothing names it, and a branch
// inside one page that names one screen (a form's error, a friend invite's several answers). A button that arrives proves that button.
//
//   npm run bench:check                 every button, against this checkout's preview (started first when it isn't running)
//   npm run bench:check -- --only home  only the buttons of the places whose value is this, comma-separated (places.ts)
//   CHROME_PATH=/path/to/chrome npm run bench:check
import { pathToFileURL } from "node:url";
import { openChrome } from "./chrome.mjs";
import { MEASURE_ONLY, chromeToRun, previewSites } from "./layout-check.mjs";
import { BENCH_PLACES, readyStates } from "./preview/bench/places.ts";

/** How long a press may take to arrive, all three screens loading. A form's steps and a first sign-in take the longest. */
const ARRIVAL_TIME_LIMIT_MS = 45_000;
const SETTLE_TIME_LIMIT_MS = 45_000;
const POLL_INTERVAL_MS = 250;
const SETTLED_FOR_MS = 1000;
const WINDOW = { width: 1600, height: 1000 };
/** Who a press is made as when it needs someone else, so it has to switch. */
const SIGNED_IN_STAND_IN = "Moss_Runner";

/** Who to be before pressing a state, so that the press has to switch: someone it doesn't need. Null when anyone will do. */
export function personBeforePress(state) {
  if (state.profile === "guest") return SIGNED_IN_STAND_IN;
  return state.profile || state.signedInProfile ? "guest" : null;
}

/** An address as a comparable text: no bench marks, however a browser writes its query (?play becomes ?play=). */
export function comparableAddress(address) {
  const url = new URL(address, "http://localhost");
  url.searchParams.delete("bench_screen");
  url.searchParams.delete("bench_state");
  url.searchParams.sort();
  return `${url.pathname}?${url.searchParams}`;
}

/**
 * What's wrong with a state's arrival, from what the phone screen and the rail show (SEEN, below): an empty list once it's there.
 * Each says what was asked and what was seen.
 */
export function arrivalProblems(state, seen) {
  const problems = [];
  if (!seen.isButtonShown) problems.push("its button left the rail: the address isn't in its place's pathPattern");
  if (!seen.isPressed) problems.push("its button came back up: the screen couldn't enter it");
  if (state.shownPageName && seen.pageName !== state.shownPageName) problems.push(`the page says it's "${seen.pageName}", not "${state.shownPageName}"`);
  if (!state.stepsToTake && comparableAddress(seen.address) !== comparableAddress(state.path)) problems.push(`it's at ${seen.address}, not ${state.path}`);
  if (state.profile && seen.markedProfile !== state.profile) problems.push(`the screen is ${seen.markedProfile}'s, not ${state.profile}'s`);
  // A way through a sign-in on the steps leaves a new player with no account yet signed in (Pick a username): the page's name says it arrived.
  if (state.profile === "guest" && !state.stepsToTake && seen.isSignedIn) problems.push("the screen is signed in, for a state a guest sees");
  if (state.profile && state.profile !== "guest" && !seen.isSignedIn) problems.push(`${state.profile} isn't signed in`);
  if (state.signedInProfile && !seen.isSignedIn) problems.push("the screen is a guest's, for a state someone signed in sees");
  if (state.opens && !seen.isOpen) problems.push(`#${state.opens} isn't open`);
  if (state.presses && !seen.isControlThere) problems.push(`there's no ${state.presses} to press`);
  if (state.setUpName && !seen.isAnyLayerOpen) problems.push("nothing opened over the page");
  return problems;
}

const phoneFrame = `document.querySelector('[data-bench-screen="phone"] iframe')`;
/** What the bench's page shows for a state: arrivalProblems' `seen`. */
const SEEN = (state) => `(() => {
  const state = ${JSON.stringify(state)};
  const button = document.querySelector('[data-bench-state="' + state.placeValue + "/" + state.stateValue + '"]');
  const frame = ${phoneFrame};
  let doc = null, location = null;
  try { doc = frame.contentDocument; location = frame.contentWindow.location; } catch {}
  if (!doc) return { isButtonShown: !button.hidden, isPressed: button.getAttribute("aria-pressed") === "true", isComplete: false, address: "/", pageName: null };
  const script = doc.querySelector('script[src*="frame.js"]');
  const opened = state.opens ? doc.getElementById(state.opens) : null;
  const isOpen = (element) => element.matches("dialog[open], [popover]:popover-open") || (!element.matches("dialog, [popover]") && !element.hidden);
  return {
    isButtonShown: !button.hidden,
    isPressed: button.getAttribute("aria-pressed") === "true",
    isComplete: doc.readyState === "complete",
    address: location.pathname + location.search,
    pageName: doc.querySelector('meta[name="checked-page"]')?.getAttribute("content") ?? null,
    markedProfile: new URLSearchParams(location.search).get("bench_screen")?.split(".")[2] ?? null,
    isSignedIn: script ? new URL(script.src).searchParams.get("signed_in") === "1" : false,
    isOpen: opened ? isOpen(opened) : false,
    isControlThere: state.presses ? Boolean(doc.querySelector(state.presses)) : false,
    isAnyLayerOpen: Boolean(doc.querySelector("dialog[open], [popover]:popover-open, .playing-card:not([hidden]):not([popover])")),
  };
})()`;
/** Where each screen stands, or null while one's still loading or its page's script isn't there. */
const SCREENS_STAND = `(() => {
  const addresses = [];
  if (document.querySelector("[data-bench-loading]")) return null;
  for (const frame of document.querySelectorAll("[data-bench-screen] iframe")) {
    try {
      if (frame.contentDocument?.readyState !== "complete" || !frame.contentWindow.zaismaBenchScreen) return null;
      addresses.push(frame.contentWindow.location.href);
    } catch { return null; }
  }
  return addresses.join(" ");
})()`;
const clickOn = (selector) => `document.querySelector(${JSON.stringify(selector)}).click()`;

async function pressEveryButton({ site, chromePath, states }) {
  const chrome = await openChrome(chromePath, "zaisma-bench-press-", { isDrawingOnCpu: true });
  const failures = [];
  try {
    const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank", newWindow: true });
    const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
    const send = (method, params = {}) => chrome.send(method, params, sessionId);
    const read = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true })).result.value;
    const pause = (durationMs) => new Promise((done) => setTimeout(done, durationMs));
    // Settled once no screen has moved for a moment: a press's page can answer with a redirect, and a press after it would race it.
    const settle = async () => {
      const startedMs = Date.now();
      let last = null, sameSinceMs = startedMs;
      while (Date.now() - startedMs < SETTLE_TIME_LIMIT_MS) {
        const stand = await read(SCREENS_STAND);
        if (stand !== last) { last = stand; sameSinceMs = Date.now(); }
        if (stand !== null && Date.now() - sameSinceMs >= SETTLED_FOR_MS) return true;
        await pause(POLL_INTERVAL_MS);
      }
      return false;
    };
    await send("Page.enable");
    await send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await send("Emulation.setDeviceMetricsOverride", { ...WINDOW, deviceScaleFactor: 1, mobile: false });
    // No screen draws its live world: the press is what's checked, and three of them on a CPU would take most of the time.
    await send("Page.addScriptToEvaluateOnNewDocument", { source: MEASURE_ONLY });
    await send("Page.navigate", { url: `${site}/design/screens` });
    await pause(POLL_INTERVAL_MS);
    await settle();

    for (const state of states) {
      const key = `${state.placeValue}/${state.stateValue}`;
      const name = `${BENCH_PLACES.find((place) => place.placeValue === state.placeValue).name}, ${state.label}`;
      const buttonSelector = `[data-bench-state="${key}"]`;
      const before = personBeforePress(state);
      if (before) {
        await read(clickOn(`[data-bench-profile="${before}"]`));
        await pause(POLL_INTERVAL_MS);
        await settle();
      }
      // A press before may have taken the rail elsewhere, and a place's own buttons show only there.
      if (await read(`document.querySelector(${JSON.stringify(buttonSelector)}).hidden`)) {
        await read(clickOn(`[data-bench-place="${state.placeValue}"]`));
        await pause(POLL_INTERVAL_MS);
        await settle();
      }
      if (await read(`document.querySelector(${JSON.stringify(buttonSelector)}).hidden`)) {
        console.log(`FAIL ${name}: it isn't listed${before ? ` for ${before}, or the place sent them elsewhere` : ""}`);
        failures.push({ name, problems: ["it isn't listed"] });
        continue;
      }
      await read(clickOn(buttonSelector));
      const startedMs = Date.now();
      let problems = ["nothing happened"], seen = null;
      while (Date.now() - startedMs < ARRIVAL_TIME_LIMIT_MS) {
        await pause(POLL_INTERVAL_MS);
        seen = await read(SEEN(state));
        if (!seen?.isComplete) continue;
        problems = arrivalProblems(state, seen);
        if (problems.length === 0) break;
      }
      console.log(problems.length ? `FAIL ${name}: ${problems.join("; ")}; the screen shows "${seen?.pageName}" as ${seen?.markedProfile}, signed in: ${seen?.isSignedIn}` : `ok ${name}`);
      if (problems.length) failures.push({ name, problems });
      // Up again, so what it opened is gone. A page of its own goes with the next press.
      if (!state.isOwnPage && (await read(`document.querySelector(${JSON.stringify(buttonSelector)}).getAttribute("aria-pressed")`)) === "true") await read(clickOn(buttonSelector));
      await pause(POLL_INTERVAL_MS);
      await settle();
    }
  } finally {
    await chrome.close();
  }
  return failures;
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1]?.split(",") : null;
  const unknown = args.filter((arg, index) => arg !== "--only" && args[index - 1] !== "--only");
  const placeValues = BENCH_PLACES.map((place) => place.placeValue);
  const unknownPlaces = (only ?? []).filter((value) => !placeValues.includes(value));
  if (unknown.length || unknownPlaces.length) {
    console.error(`The only option is --only <places>, comma-separated, from ${placeValues.join(", ")}.`);
    process.exit(2);
  }
  const sites = previewSites();
  if (!sites) {
    console.error("BENCH PRESS FAIL: the preview didn't start: npm run preview:start says why.");
    process.exit(1);
  }
  const states = readyStates().filter((state) => !only || only.includes(state.placeValue));
  const failures = await pressEveryButton({ site: sites.site, chromePath: await chromeToRun(), states });
  const line = failures.length ? `${failures.length} of ${states.length} buttons didn't arrive: ${failures.map((failure) => failure.name).join(", ")}` : `all ${states.length} buttons arrived`;
  console.log(`BENCH PRESS ${failures.length ? "FAIL" : "PASS"}: ${line}`);
  // On GitHub, at night, nobody's reading: a failure pushes Julius.
  if (failures.length && process.env.PUSHOVER_USER_KEY && process.env.PUSHOVER_APP_TOKEN) {
    const { sendPushover } = await import("./watch-checks.mjs");
    await sendPushover({ userKey: process.env.PUSHOVER_USER_KEY, appToken: process.env.PUSHOVER_APP_TOKEN }, { title: "A Screens bench button broke", message: `${line} ${process.env.RUN_URL ?? ""}`.slice(0, 1024), priority: 0 });
  }
  process.exit(failures.length ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
