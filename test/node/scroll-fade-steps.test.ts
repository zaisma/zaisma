import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { findChrome, openChrome } from "../../packages/cli/chrome.mjs";
import { COMPONENT_STYLES } from "../../apps/site/src/components/index.ts";
import { firstPaintScriptTags } from "../../apps/site/src/html.ts";

/**
 * A box's scroll fade shows only while there's more to scroll to. A menu that steps into a group and back out (Browse's Filter: Genre,
 * Players, Price) keeps its own height while what's in it changes length: the fade has to follow what's in it, not only the box's size.
 */
const ROOT = join(import.meta.dirname, "../..");
const chromePath = findChrome([join(ROOT, ".wrangler/chrome"), join(ROOT, "chrome")]);
const BODY = `<div id="box" style="height: 200px; overflow-y: auto"><div id="groups" style="height: 120px">Genre, Players, Price</div><div id="group" style="height: 600px" hidden>A long group</div></div>`;
const PAGE = `<!doctype html><html data-theme-choice="light"><head><meta charset="utf-8"><style>${COMPONENT_STYLES()}</style></head><body>${BODY}<p>After</p>${firstPaintScriptTags(BODY)}</body></html>`;

describe.skipIf(!chromePath || process.platform === "win32" || typeof WebSocket !== "function")("a scroll fade as a menu steps", () => {
  let chrome: Awaited<ReturnType<typeof openChrome>>;
  let server: Server;

  beforeAll(async () => {
    chrome = await openChrome(chromePath!, `zaisma-fade-steps-test-${process.pid}-`, { isDrawingOnCpu: true });
    server = createServer((_request, response) => { response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  }, 60_000);

  afterAll(async () => {
    await chrome?.close();
    await new Promise((resolve) => server?.close(resolve));
  });

  it("fades while a step is longer than the box, and stops once it steps back to one that fits", async () => {
    const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
    const read = async <Value>(expression: string): Promise<Value> => (await chrome.send("Runtime.evaluate", { expression, returnByValue: true }, sessionId)).result.value as Value;
    const isFading = 'document.getElementById("box").classList.contains("is-fading")';
    try {
      await chrome.send("Page.enable", {}, sessionId);
      const loaded = new Promise<void>((resolve) => { const stop = chrome.listen(sessionId, (method: string) => { if (method === "Page.loadEventFired") { stop(); resolve(); } }); });
      await chrome.send("Page.navigate", { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` }, sessionId);
      await loaded;
      await vi.waitFor(async () => expect(await read('document.getElementById("box").classList.contains("scroll-fades")')).toBe(true), { timeout: 5_000, interval: 20 });
      expect(await read(isFading)).toBe(false);
      await read('document.getElementById("groups").hidden = true, document.getElementById("group").hidden = false, true');
      await vi.waitFor(async () => expect(await read(isFading)).toBe(true), { timeout: 5_000, interval: 20 });
      await read('document.getElementById("group").hidden = true, document.getElementById("groups").hidden = false, true');
      await vi.waitFor(async () => expect(await read(isFading)).toBe(false), { timeout: 5_000, interval: 20 });
    } finally {
      await chrome.send("Target.closeTarget", { targetId });
    }
  }, 60_000);
});
