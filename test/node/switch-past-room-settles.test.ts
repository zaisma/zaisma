import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { findChrome, openChrome } from "../../packages/cli/chrome.mjs";
import { COMPONENT_STYLES } from "../../apps/site/src/components/index.ts";
import { tabSwitch } from "../../apps/site/src/components/switch.ts";
import { firstPaintScriptTags } from "../../apps/site/src/html.ts";

/**
 * A Switch's tabs scroll in their Well only while they're past its room. What puts them past it while a page arrives (a pane's scrollbar
 * coming and going on /signin after Make an account and back, a slab stretched mid-slide) can end with nothing changing size, which left them
 * marked past their room, with a rail and a fade, where they fit. Once the page has settled, they're asked again.
 */
const ROOT = join(import.meta.dirname, "../..");
const chromePath = findChrome([join(ROOT, ".wrangler/chrome"), join(ROOT, "chrome")]);
const BODY = `<div data-holder style="width: 440px">${tabSwitch({ label: "Sign in or make an account", switchSize: "regular", isFull: true, tabs: [{ label: "Sign in", isCurrent: true }, { label: "Make an account", isCurrent: false }] })}</div>`;
// Its holder exactly as wide as its tabs at their widest's width, so being past its room or not changes no size (as /signin's well with the
// pane's scrollbar took it), then marked past its room as the page arrives, as a transient overflow leaves it, before the page has settled.
const MARK = `<script>window.zaismaWatch.arriving(function () { var sw = document.querySelector(".tab-switch"); if (sw && !sw.isMarked) { sw.isMarked = true; sw.classList.add("is-past-room"); var exact = sw.offsetWidth; sw.classList.remove("is-past-room"); sw.closest("[data-holder]").style.width = exact + "px"; requestAnimationFrame(function () { requestAnimationFrame(function () { requestAnimationFrame(function () { sw.classList.add("is-past-room"); sw.parentElement.classList.add("more-right"); sw.isMarked = "done"; }); }); }); } });</script>`;
const PAGE = `<!doctype html><html data-theme-choice="light"><head><meta charset="utf-8"><style>${COMPONENT_STYLES()}</style></head><body>${firstPaintScriptTags(BODY)}${MARK}${BODY}<p>After</p><link rel="preload" as="script" href="/page-files.js" data-page-script></body></html>`;

describe.skipIf(!chromePath || process.platform === "win32" || typeof WebSocket !== "function")("a Switch past its room for a moment", () => {
  let chrome: Awaited<ReturnType<typeof openChrome>>;
  let server: Server;

  beforeAll(async () => {
    chrome = await openChrome(chromePath!, `zaisma-switch-settles-test-${process.pid}-`, { isDrawingOnCpu: true });
    // The page's own files come a moment later, so the page settles after it's marked, as a real page's do.
    server = createServer((request, response) => {
      if (request.url === "/page-files.js") { setTimeout(() => response.writeHead(200, { "content-type": "text/javascript" }).end("/* the page's work */"), 1500); return; }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  }, 60_000);

  afterAll(async () => {
    await chrome?.close();
    await new Promise((resolve) => server?.close(resolve));
  });

  it("is no longer past its room, with no fade, once the page has settled and its tabs fit", async () => {
    const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
    const read = async <Value>(expression: string): Promise<Value> => (await chrome.send("Runtime.evaluate", { expression, returnByValue: true }, sessionId)).result.value as Value;
    try {
      await chrome.send("Page.enable", {}, sessionId);
      await chrome.send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false }, sessionId);
      await chrome.send("Page.navigate", { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` }, sessionId);
      await vi.waitFor(async () => expect(await read('Boolean(document.querySelector(".tab-switch") && document.querySelector(".tab-switch").isMarked === "done")')).toBe(true), { timeout: 10_000, interval: 20 });
      const fits = await read<boolean>('(() => { const box = document.querySelector(".tab-switch").parentElement; return box.scrollWidth <= box.clientWidth + 1; })()');
      expect(fits).toBe(true);
      await vi.waitFor(async () => expect(await read('[document.querySelector(".tab-switch").classList.contains("is-past-room"), document.querySelector(".tab-switch").parentElement.classList.contains("more-right")]')).toEqual([false, false]), { timeout: 10_000, interval: 50 });
    } finally {
      await chrome.send("Target.closeTarget", { targetId });
    }
  }, 60_000);
});
