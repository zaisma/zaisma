#!/usr/bin/env node
// A quick look at one page in headless Chrome: opens it, reads or snaps it, and closes Chrome, so a session needs no Chrome script of
// its own. A path (/design/example) is this checkout's preview (npm run preview:start first); an address is opened as it is.
//
//   npm run page:probe -- /design/example                     the page's title, address and console errors
//   npm run page:probe -- /design/example --text              and its words (document.body.innerText)
//   npm run page:probe -- /design/example --picture page.png  and a picture of what's on screen
//   npm run page:probe -- /design/example --evaluate "document.querySelectorAll('button').length"
//   npm run page:probe -- /account --account <test account>   signed in as one of the preview's test accounts (scripts/preview/sign-ins.mjs)
//   npm run page:probe -- /design/example --size 320x667 --dark --json
//
// Chrome is the one scripts/chrome.mjs finds or fetches, and openChrome ends it with this process however that ends.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openChrome } from "./chrome.mjs";
import { chromeToRun, previewSites, signIn } from "./layout-check.mjs";

const VALUED = ["--size", "--picture", "--evaluate", "--account"];
const FLAGS = ["--text", "--dark", "--json"];
const OPTIONS_WORDS = "The options are --text, --picture <file.png>, --evaluate <expression>, --account <test account>, --size <width>x<height>, --dark and --json.";
/** How long a page has to load before it's read as it is. */
const LOAD_TIME_LIMIT_MS = 30_000;

/** One page: { url, title, console_errors, text, evaluated, picture_path }, text, evaluated and picture_path null unless asked for. */
export async function probePage({ chromePath, url, signInSite = null, account = null, widthPx = 1280, heightPx = 800, theme = "light", isText = false, expression = null, picturePath = null }) {
  const chrome = await openChrome(chromePath, "zaisma-page-probe-");
  try {
    const { browserContextId } = await chrome.send("Target.createBrowserContext");
    if (account) await signIn(chrome, browserContextId, signInSite ?? new URL(url).origin, account);
    const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank", browserContextId });
    const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
    const send = (method, params = {}) => chrome.send(method, params, sessionId);
    const consoleErrors = [];
    chrome.listen(sessionId, (method, params) => {
      if (method === "Runtime.exceptionThrown") consoleErrors.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
      else if (method === "Runtime.consoleAPICalled" && params.type === "error") consoleErrors.push(params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
    });
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: widthPx, height: heightPx, deviceScaleFactor: 1, mobile: widthPx < 768 });
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    const loaded = new Promise((done) => {
      const off = chrome.listen(sessionId, (method) => method === "Page.loadEventFired" && (off(), done()));
    });
    await send("Page.navigate", { url });
    let timer;
    await Promise.race([loaded, new Promise((done) => (timer = setTimeout(done, LOAD_TIME_LIMIT_MS)))]);
    clearTimeout(timer);
    // Fonts, then two frames, so what's read or snapped is what a person sees.
    await send("Runtime.evaluate", { expression: "document.fonts.ready.then(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))", awaitPromise: true });
    const value = async (source) => {
      const { result, exceptionDetails } = await send("Runtime.evaluate", { expression: source, awaitPromise: true, returnByValue: true });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
      return result.value ?? null;
    };
    const answer = { url: await value("location.href"), title: await value("document.title"), console_errors: consoleErrors, text: isText ? await value("document.body.innerText") : null, evaluated: expression ? await value(expression) : null, picture_path: null };
    if (picturePath) {
      writeFileSync(picturePath, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
      answer.picture_path = picturePath;
    }
    return answer;
  } finally {
    await chrome.close();
  }
}

function stop(message, isJson) {
  console.log(isJson ? JSON.stringify({ error: "stopped", message }) : `PROBE FAIL: ${message}`);
  process.exit(2);
}

async function main() {
  const args = process.argv.slice(2);
  const valueOf = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
  const isJson = args.includes("--json");
  const loose = args.filter((arg, i) => !VALUED.includes(args[i - 1]) && !VALUED.includes(arg) && !FLAGS.includes(arg));
  const unknown = loose.filter((arg) => arg.startsWith("--"));
  if (unknown.length) stop(`Unknown option ${unknown.join(" ")}. ${OPTIONS_WORDS}`, isJson);
  if (loose.length !== 1) stop(`Give one page: a path on this checkout's preview (/design/example) or an address. ${OPTIONS_WORDS}`, isJson);
  for (const flag of VALUED) if (args.includes(flag) && (!valueOf(flag) || valueOf(flag).startsWith("--"))) stop(`${flag} takes a value. ${OPTIONS_WORDS}`, isJson);
  const size = valueOf("--size") ?? "1280x800";
  const [widthPx, heightPx] = size.split("x").map(Number);
  if (!/^\d+x\d+$/.test(size) || widthPx < 200 || heightPx < 200) stop("--size takes a width and height in pixels, at least 200 each, like --size 320x667.", isJson);
  let url = loose[0];
  let signInSite = null;
  if (url.startsWith("/")) {
    const sites = previewSites({ isStarting: false });
    if (!sites) stop("This checkout's preview isn't running: npm run preview:start starts it, or give a whole address.", isJson);
    url = `${sites.site}${url}`;
    signInSite = sites.signInSite;
  } else if (!/^https?:\/\//.test(url)) stop(`${url} is neither a path (/design/example) nor an address (http://localhost:8800/design/example).`, isJson);
  const chromePath = await chromeToRun();
  if (!chromePath) stop("No Chrome here, and Chrome for Testing couldn't be fetched: set CHROME_PATH to a Chrome.", isJson);
  const picturePath = valueOf("--picture") ? resolve(valueOf("--picture")) : null;
  const answer = await probePage({ chromePath, url, signInSite, account: valueOf("--account"), widthPx, heightPx, theme: args.includes("--dark") ? "dark" : "light", isText: args.includes("--text"), expression: valueOf("--evaluate"), picturePath });
  if (isJson) console.log(JSON.stringify(answer, null, 2));
  else {
    console.log(`${answer.title || "(no title)"}\n${answer.url}`);
    console.log(answer.console_errors.length ? `Console errors:\n${answer.console_errors.map((error) => `  ${error}`).join("\n")}` : "No console errors.");
    if (answer.evaluated !== null) console.log(`Evaluated: ${typeof answer.evaluated === "string" ? answer.evaluated : JSON.stringify(answer.evaluated, null, 2)}`);
    if (answer.picture_path) console.log(`Picture: ${answer.picture_path}`);
    if (answer.text !== null) console.log(`\n${answer.text}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
