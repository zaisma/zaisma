// The pictures behind each preview feedback comment, taken in headless Chrome (scripts/chrome.mjs) at the comment's screen size,
// theme and scroll, as the same test account when Julius was signed in, with his box drawn on in orange:
//   seen  the page as he saw it: the overlay's snapshot of it (open menus, typed fields and readable canvases kept), drawn again
//   live  the page loaded again from its address, which also draws what the snapshot can't (a WebGL background), and after a fix
//         shows the change (npm run feedback -- retake <comment_id>)
//   replay  what he did on the page before commenting (pointing, clicks, touches, keys, scrolling), done again from a fresh load
//         with its timing, a picture after each step and two a moment after the last, for what a still can't show: a hover, an
//         animation, a jump, a click that does nothing
// The overlay doesn't start in headless Chrome, so it's never in a picture.
import { fetchChrome, findChrome, openChrome } from "../chrome.mjs";
import { pictureFile, replayPictureFile, writePicture, writeReplay, writeReplayPicture } from "./feedback-store.mjs";

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

/** The marker on a replay picture: a ring where the pointer is, and what just happened, in a corner. */
const drawStep = (label, point) => `(() => {
  document.getElementById("zaisma-feedback-step")?.remove();
  const step = document.createElement("div");
  step.id = "zaisma-feedback-step";
  step.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;font:600 12px/1.3 system-ui,sans-serif";
  step.innerHTML = '<div style="position:absolute;left:8px;bottom:8px;max-width:calc(100% - 16px);padding:4px 8px;border-radius:6px;background:rgba(0,0,0,.78);color:#fff"></div>';
  step.firstChild.textContent = ${JSON.stringify(label)};
  ${point ? `const ring = document.createElement("div");
  ring.style.cssText = "position:absolute;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;border:3px solid #ff6a1f;box-shadow:0 0 0 2px rgba(0,0,0,.6)";
  Object.assign(ring.style, { left: "${point.x_px}px", top: "${point.y_px}px" });
  step.appendChild(ring);` : ""}
  document.documentElement.appendChild(step);
  return true;
})()`;
const clearStep = `document.getElementById("zaisma-feedback-step")?.remove(); true`;

// Gaps between actions replay as they happened, up to these, so animations and timing show without a long wait.
const MAXIMUM_REPLAY_GAP_MS = 2000;
const MAXIMUM_KEY_GAP_MS = 120;
const MAXIMUM_REPLAY_PICTURE_COUNT = 12;
/** Pictures after the last action, for what moves or appears a moment later. */
const AFTER_LAST_ACTION_MS = [300, 1000];
const KEY_CODES = { Enter: 13, Backspace: 8, Tab: 9, Escape: 27, " ": 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46, Home: 36, End: 35, PageUp: 33, PageDown: 34 };

function actionLabel(action) {
  const on = action.element_label ? ` on ${action.element_label}` : "";
  if (action.kind === "key") return `pressed ${action.key === " " ? "Space" : action.key}`;
  if (action.kind === "scroll") return `scrolled to ${action.scroll_x_px}, ${action.scroll_y_px}`;
  const verb = action.pointer_type === "touch" ? { move: "slid", press: "touched", release: "let go" } : { move: "pointed", press: "pressed", release: "released" };
  return `${verb[action.kind]} at ${action.x_px}, ${action.y_px}${on}`;
}

/** Whether a picture waits for the next action: a run of keys, a move into a press, a press into its release. */
function isPartOfNext(action, next) {
  if (!next) return false;
  return (action.kind === "key" && next.kind === "key") || (action.kind === "move" && next.kind === "press") || (action.kind === "press" && next.kind === "release") || (action.kind === next.kind && action.kind === "scroll");
}

/** One open Chrome for a run of pictures: picture(comment, kind, url) writes <comment_id>.<kind>.png, replay(comment, url) the replay's. close() when done. */
export async function openPictureTaker({ siteOrigin, directory }) {
  const chromePath = (await findChrome()) ?? (await fetchChrome());
  if (!chromePath) throw new Error("No Chrome to take pictures with: set CHROME_PATH, or let it download Chrome for Testing.");
  const chrome = await openChrome(chromePath, "zaisma-feedback-");
  let queue = Promise.resolve();

  /** The page at the comment's size, theme and sign-in, loaded and settled: run(send) gets the tab. */
  async function onPage(comment, url, run) {
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
      return await run(send);
    } finally {
      await chrome.send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
    }
  }

  const shot = async (send) => Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64");

  async function take(comment, url) {
    return onPage(comment, url, async (send) => {
      await send("Runtime.evaluate", { expression: `scrollTo(${comment.scroll_x_px}, ${comment.scroll_y_px}); true`, returnByValue: true });
      await wait(150);
      // A comment on the whole page has no spot to draw.
      if (!comment.is_page_comment) await send("Runtime.evaluate", { expression: drawBox(comment.box), returnByValue: true });
      return shot(send);
    });
  }

  /** Does what he did, with its timing, and pictures each step: [{ step_number, label, picture }]. */
  async function replay(comment, url) {
    return onPage(comment, url, async (send) => {
      const steps = [];
      const picture = async (label, point) => {
        await send("Runtime.evaluate", { expression: drawStep(label, point), returnByValue: true });
        steps.push({ label, picture: await shot(send) });
        await send("Runtime.evaluate", { expression: clearStep, returnByValue: true });
      };
      await picture("The page as it loads");
      const actions = comment.recent_actions;
      let pressedButtons = 0, touching = false, labels = [];
      for (const [index, action] of actions.entries()) {
        const gapMs = index ? action.at_ms - actions[index - 1].at_ms : 0;
        await wait(Math.max(0, Math.min(gapMs, action.kind === "key" ? MAXIMUM_KEY_GAP_MS : MAXIMUM_REPLAY_GAP_MS)));
        if (action.kind === "scroll") {
          await send("Runtime.evaluate", { expression: `scrollTo(${action.scroll_x_px}, ${action.scroll_y_px}); true`, returnByValue: true });
        } else if (action.kind === "key") {
          const code = KEY_CODES[action.key];
          const text = action.key.length === 1 ? action.key : action.key === "Enter" ? "\r" : undefined;
          await send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key: action.key, ...(text ? { text } : {}), ...(code ? { windowsVirtualKeyCode: code } : {}) });
          await send("Input.dispatchKeyEvent", { type: "keyUp", key: action.key, ...(code ? { windowsVirtualKeyCode: code } : {}) });
        } else if (action.pointer_type === "touch") {
          if (action.kind === "press") touching = true;
          if (action.kind === "release") touching = false;
          if (action.kind !== "move" || touching) {
            const type = { press: "touchStart", move: "touchMove", release: "touchEnd" }[action.kind];
            await send("Input.dispatchTouchEvent", { type, touchPoints: action.kind === "release" ? [] : [{ x: action.x_px, y: action.y_px }] });
          }
        } else {
          if (action.kind === "press") pressedButtons = 1;
          const type = { press: "mousePressed", move: "mouseMoved", release: "mouseReleased" }[action.kind];
          await send("Input.dispatchMouseEvent", { type, x: action.x_px, y: action.y_px, button: action.kind === "move" && !pressedButtons ? "none" : "left", buttons: pressedButtons, clickCount: action.kind === "move" ? 0 : 1 });
          if (action.kind === "release") pressedButtons = 0;
        }
        // A press and its release at about the same spot read as one click or tap.
        const previous = actions[index - 1];
        const isClick = action.kind === "release" && previous?.kind === "press" && Math.hypot(action.x_px - previous.x_px, action.y_px - previous.y_px) < 6;
        if (isClick) labels.splice(-1, 1, `${action.pointer_type === "touch" ? "tapped" : "clicked"} at ${action.x_px}, ${action.y_px}${previous.element_label ? ` on ${previous.element_label}` : ""}`);
        else labels.push(actionLabel(action));
        if (isPartOfNext(action, actions[index + 1])) continue;
        await wait(120);
        const point = action.kind === "key" || action.kind === "scroll" ? null : action;
        const label = labels.length > 3 ? `${labels[0]} … ${labels.at(-1)} (${labels.length} actions)` : labels.join(", then ");
        labels = [];
        await picture(`${index + 1}/${actions.length}: ${label}`, point);
      }
      // What moves or appears a moment after, with his box on.
      let waitedMs = 0;
      for (const afterMs of AFTER_LAST_ACTION_MS) {
        await wait(afterMs - waitedMs);
        waitedMs = afterMs;
        if (!comment.is_page_comment) await send("Runtime.evaluate", { expression: drawBox(comment.box), returnByValue: true });
        await picture(`${afterMs} ms after the last action`);
      }
      // The first picture and the latest ones, when there are more than fit.
      return steps.length > MAXIMUM_REPLAY_PICTURE_COUNT ? [steps[0], ...steps.slice(-(MAXIMUM_REPLAY_PICTURE_COUNT - 1))] : steps;
    });
  }

  const queued = (work) => {
    const done = queue.then(work);
    queue = done.catch(() => {});
    return done;
  };

  return {
    chromePath,
    /** Takes one picture after the ones before it, and writes it; answers the file's path. */
    picture: (comment, kind, url) =>
      queued(async () => {
        writePicture(comment.comment_id, kind, await take(comment, url), directory);
        return pictureFile(directory, comment.comment_id, kind);
      }),
    /** Replays what he did before the comment, and writes its pictures and their list; answers the list. Nothing when he did nothing. */
    replay: (comment, url) =>
      queued(async () => {
        if (!comment.recent_actions?.length) return [];
        const steps = (await replay(comment, url)).map((step, index) => {
          writeReplayPicture(comment.comment_id, index + 1, step.picture, directory);
          return { step_number: index + 1, label: step.label, picture_path: replayPictureFile(directory, comment.comment_id, index + 1) };
        });
        writeReplay(comment.comment_id, steps, directory);
        return steps;
      }),
    close: () => queue.then(() => chrome.close()),
  };
}

/** The live page's address for a comment. */
export const liveUrl = (comment, siteOrigin) => `${siteOrigin}${comment.page_url}`;
/** The snapshot's address: served by the feedback server through the site, so its styles and pictures load as they did. */
export const seenUrl = (comment, siteOrigin) => `${siteOrigin}/__preview/feedback/snapshots/${comment.comment_id}`;
