import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { findChrome, openChrome } from "../../packages/cli/chrome.mjs";
import { COMPONENT_STYLES } from "../../apps/site/src/components/index.ts";
import { header, rail } from "../../apps/site/src/components/navigation.ts";
import { firstPaintScriptTags } from "../../apps/site/src/html.ts";

/**
 * The page's rail shows with the header, not once the whole page is read: a slow page's header showed whole while its rail came hundreds of
 * milliseconds later. The server holds the page's end, so the browser is still reading it, and the parts the rail marks join it as they arrive.
 */
const ROOT = join(import.meta.dirname, "../..");
const chromePath = findChrome([join(ROOT, ".wrangler/chrome"), join(ROOT, "chrome")]);

const part = (name: string) => `<section data-rail-mark="${name}" style="height: 1200px"><p>${name}</p></section>`;
const PAGE_START = `${rail("page")}${header({ current: "home", isOnDeveloperPage: false })}<main>${part("First")}`;
const PAGE_REST = `${part("Second")}</main>`;
const HEAD = `<!doctype html><html data-theme-choice="light"><head><meta charset="utf-8"><style>${COMPONENT_STYLES()}</style></head><body>${firstPaintScriptTags(PAGE_START + PAGE_REST)}`;

describe.skipIf(!chromePath || process.platform === "win32" || typeof WebSocket !== "function")("the page's rail while the page arrives", () => {
  let chrome: Awaited<ReturnType<typeof openChrome>>;
  let server: Server;
  let heldResponse: ServerResponse | null = null;

  beforeAll(async () => {
    chrome = await openChrome(chromePath!, `zaisma-page-rail-test-${process.pid}-`, { isDrawingOnCpu: true });
    server = createServer((request, response) => {
      if (request.url !== "/page") { response.writeHead(404).end(); return; }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.write(HEAD + PAGE_START + " ".repeat(4096));
      heldResponse = response;
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  }, 60_000);

  afterAll(async () => {
    await chrome?.close();
    await new Promise((resolve) => server?.close(resolve));
  });

  it("is on while the page is still being read, and marks each part as it arrives", async () => {
    const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
    const read = async <Value>(expression: string): Promise<Value> => (await chrome.send("Runtime.evaluate", { expression, returnByValue: true }, sessionId)).result.value as Value;
    try {
      await chrome.send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false }, sessionId);
      await chrome.send("Page.navigate", { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/page` }, sessionId);
      await vi.waitFor(async () => expect(await read('document.querySelector("main section") !== null')).toBe(true), { timeout: 30_000, interval: 10 });
      await vi.waitFor(async () => expect(await read('document.querySelector("[data-rail=page]").classList.contains("is-on")')).toBe(true), { timeout: 5_000, interval: 20 });
      expect(await read("document.readyState")).toBe("loading");
      expect(await read('document.querySelectorAll("[data-rail=page] .rail-mark").length')).toBe(1);
      heldResponse!.end(`${PAGE_REST}</body></html>`);
      await vi.waitFor(async () => expect(await read('document.querySelectorAll("[data-rail=page] .rail-mark").length')).toBe(2), { timeout: 10_000, interval: 20 });
    } finally {
      await chrome.send("Target.closeTarget", { targetId });
    }
  }, 60_000);
});
