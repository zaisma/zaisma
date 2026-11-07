import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findChrome, openChrome } from "../../packages/cli/chrome.mjs";
import { COMPONENT_STYLES } from "../../apps/site/src/components/index.ts";
import { header } from "../../apps/site/src/components/navigation.ts";
import { firstPaintScriptTags } from "../../apps/site/src/html.ts";

/**
 * The header gives way a step at a time as its room runs out (HEADER_FIT_SCRIPT), the tabs last becoming their icons. A signed-in developer
 * on a 320 px phone has four tabs beside their picture: every tab sits whole inside the switch's well, so none is cut at its edge or dimmed
 * by its fade, and none scrolls out of sight as the switch shows the page you're on.
 */
const ROOT = join(import.meta.dirname, "../..");
const chromePath = findChrome([join(ROOT, ".wrangler/chrome"), join(ROOT, "chrome")]);

const HEADERS = {
  developer: String(header({ current: "developer", account: { username: "Many_Things" }, isOnDeveloperPage: true, isSearchOnComputerOnly: true })),
  player: String(header({ current: "your-games", account: { username: "Many_Things" }, isOnDeveloperPage: false, yourGamesHref: "/your-games" })),
};
const pageFor = (markup: string) => {
  const body = `${markup}<main><p>The page</p></main>`;
  return `<!doctype html><html data-theme-choice="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${COMPONENT_STYLES()}</style></head><body>${body}${firstPaintScriptTags(body)}</body></html>`;
};

describe.skipIf(!chromePath || process.platform === "win32" || typeof WebSocket !== "function")("the header's tabs on a 320 px phone", () => {
  let chrome: Awaited<ReturnType<typeof openChrome>>;
  let server: Server;
  let origin = "";

  beforeAll(async () => {
    chrome = await openChrome(chromePath!, `zaisma-header-tabs-test-${process.pid}-`, { isDrawingOnCpu: true });
    server = createServer((request, response) => {
      const markup = HEADERS[new URL(request.url ?? "/", "http://localhost").searchParams.get("header") as keyof typeof HEADERS];
      if (!markup) { response.writeHead(404).end(); return; }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(pageFor(markup));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    await chrome?.close();
    await new Promise((resolve) => server?.close(resolve));
  });

  /** Each shown tab's box against its well's, once the header has fitted itself. */
  async function measure(headerName: keyof typeof HEADERS): Promise<{ tabCount: number; cutTabs: string[]; scrolledPx: number }> {
    const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
    try {
      await chrome.send("Page.enable", {}, sessionId);
      await chrome.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 667, deviceScaleFactor: 2, mobile: true }, sessionId);
      await chrome.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, sessionId);
      const loaded = new Promise<void>((resolve) => { const stop = chrome.listen(sessionId, (method: string) => { if (method === "Page.loadEventFired") { stop(); resolve(); } }); });
      await chrome.send("Page.navigate", { url: `${origin}/?header=${headerName}` }, sessionId);
      await loaded;
      const expression = `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
        const tabs = document.querySelector("header.top .tab-switch"), well = tabs.closest(".switch-well").getBoundingClientRect();
        const shown = [...tabs.querySelectorAll(":scope > a, :scope > button")].filter((tab) => tab.getBoundingClientRect().width > 0);
        const cutTabs = shown.filter((tab) => { const box = tab.getBoundingClientRect(); return box.left < well.left - 0.5 || box.right > well.right + 0.5; }).map((tab) => tab.textContent.trim());
        resolve({ tabCount: shown.length, cutTabs, scrolledPx: Math.max(tabs.scrollLeft, tabs.closest(".switch-well").scrollLeft) });
      })))`;
      return (await chrome.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId)).result.value;
    } finally {
      await chrome.send("Target.closeTarget", { targetId });
    }
  }

  it("fits a developer's four tabs and a player's three whole inside the well, scrolled nowhere", async () => {
    expect(await measure("developer")).toEqual({ tabCount: 4, cutTabs: [], scrolledPx: 0 });
    expect(await measure("player")).toEqual({ tabCount: 3, cutTabs: [], scrolledPx: 0 });
  }, 60_000);
});
