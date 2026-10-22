// The pictures behind each preview feedback comment, taken in headless Chrome (scripts/chrome.mjs) at the comment's screen size,
// theme and scroll, as the same test account when Julius was signed in, with his box drawn on in orange:
//   seen  the page as he saw it: the overlay's snapshot of it (open menus, typed fields and readable canvases kept), drawn again
//   live  the page loaded again from its address, which also draws what the snapshot can't (a WebGL background), and after a fix
//         shows the change (npm run feedback -- retake <comment_id>)
// The overlay doesn't start in headless Chrome, so it's never in a picture.
import { fetchChrome, findChrome, openChrome } from "../chrome.mjs";
import { pictureFile, writePicture } from "./feedback-store.mjs";

const PAGE_READY_TIMEOUT_MS = 20_000;
const PAGE_LOAD_WAIT_MS = 10_000;
const SETTLE_MS = 1200;
const PHONE_WIDTH_PX = 768;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

/** Cookies from a request's Cookie header, for Chrome to send to the site. */
export function cookiesFromHeader(header, siteOrigin) {
  if (!header) return [];
  return header
    .split(";")
    .map((pair) => pair.trim())
    .filter((pair) => pair.includes("="))
    .map((pair) => {
      const at = pair.indexOf("=");
      const name = pair.slice(0, at);
      // __Host- cookies have to be secure with no domain; Chrome counts localhost as secure.
      return { name, value: pair.slice(at + 1), url: siteOrigin, path: "/", ...(name.startsWith("__Host-") || name.startsWith("__Secure-") ? { secure: true } : {}) };
    });
}

/** The page drawing his box: an orange outline over the spot, at its place in the viewport. */
const drawBox = (box) => `(() => {
  const outline = document.createElement("div");
  outline.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;border:3px solid #ff6a1f;border-radius:4px;box-shadow:0 0 0 2px rgba(0,0,0,.55),0 0 0 9999px rgba(0,0,0,.12)";
  Object.assign(outline.style, { left: "${box.left_px - 3}px", top: "${box.top_px - 3}px", width: "${box.width_px + 6}px", height: "${box.height_px + 6}px" });
  document.documentElement.appendChild(outline);
  return true;
})()`;

const SETTLE = `(async () => {
  await document.fonts?.ready;
  for (let frame = 0; frame < 4; frame++) await new Promise((done) => requestAnimationFrame(done));
  return true;
})()`;

/** One open Chrome for a run of pictures: picture(comment, kind, url) writes <comment_id>.<kind>.png. close() when done. */
export async function openPictureTaker({ siteOrigin, directory }) {
  const chromePath = (await findChrome()) ?? (await fetchChrome());
  if (!chromePath) throw new Error("No Chrome to take pictures with: set CHROME_PATH, or let it download Chrome for Testing.");
  const chrome = await openChrome(chromePath, "zaisma-feedback-");
  let queue = Promise.resolve();

  async function take(comment, kind, url) {
    const { browserContextId } = await chrome.send("Target.createBrowserContext");
    try {
      const cookies = cookiesFromHeader(comment.sign_in_cookie_header, siteOrigin);
      if (cookies.length) await chrome.send("Storage.setCookies", { cookies, browserContextId });
      const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank", browserContextId });
      const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
      const send = (method, params = {}) => chrome.send(method, params, sessionId);
      const isPhone = comment.viewport_width_px < PHONE_WIDTH_PX;
      await send("Page.enable");
      await send("Emulation.setDeviceMetricsOverride", { width: comment.viewport_width_px, height: comment.viewport_height_px, deviceScaleFactor: 2, mobile: isPhone });
      await send("Emulation.setTouchEmulationEnabled", isPhone ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: comment.theme }] });
      const fired = (event) => new Promise((done) => {
        const off = chrome.listen(sessionId, (method) => method === event && (off(), done()));
      });
      const ready = fired("Page.domContentEventFired"), loaded = fired("Page.loadEventFired");
      await send("Page.navigate", { url });
      await Promise.race([ready, wait(PAGE_READY_TIMEOUT_MS)]);
      // Pages that keep loading (the city streams its pieces) are pictured a moment after they're ready.
      await Promise.race([loaded, wait(PAGE_LOAD_WAIT_MS)]);
      await send("Runtime.evaluate", { expression: SETTLE, awaitPromise: true, returnByValue: true });
      await wait(SETTLE_MS);
      await send("Runtime.evaluate", { expression: `scrollTo(${comment.scroll_x_px}, ${comment.scroll_y_px}); true`, returnByValue: true });
      await wait(150);
      await send("Runtime.evaluate", { expression: drawBox(comment.box), returnByValue: true });
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      return Buffer.from(data, "base64");
    } finally {
      await chrome.send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
    }
  }

  return {
    chromePath,
    /** Takes one picture after the ones before it, and writes it; answers the file's path. */
    picture: (comment, kind, url) => {
      const done = queue.then(async () => {
        writePicture(comment.comment_id, kind, await take(comment, kind, url), directory);
        return pictureFile(directory, comment.comment_id, kind);
      });
      queue = done.catch(() => {});
      return done;
    },
    close: () => queue.then(() => chrome.close()),
  };
}

/** The live page's address for a comment. */
export const liveUrl = (comment, siteOrigin) => `${siteOrigin}${comment.page_url}`;
/** The snapshot's address: served by the feedback server through the site, so its styles and pictures load as they did. */
export const seenUrl = (comment, siteOrigin) => `${siteOrigin}/__preview/feedback/snapshots/${comment.comment_id}`;
