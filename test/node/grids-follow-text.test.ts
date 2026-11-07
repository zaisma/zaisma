import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findChrome, openChrome } from "../../packages/cli/chrome.mjs";
import { COMPONENT_STYLES } from "../../apps/site/src/components/index.ts";
import { grid, track, type GridItem } from "../../apps/site/src/components/layout.ts";
import { html } from "../../apps/site/src/html.ts";

/**
 * A grid or track of game covers holds fewer across as the browser's text grows, so a cover's title has the room its words take and is never
 * cut to a few letters. A cover's least width is in rem (--size-cover, 11.25rem: 180px at the browser's own 16px), a card's too (--size-card,
 * 17.5rem), and so is a cover's cell in a track. Measured in a real Chrome with its text at 100% and at 200%, as a person sets it in the
 * browser's settings (layout-check.mjs's --text 200 does the same).
 */
const ROOT = join(import.meta.dirname, "../..");
const chromePath = findChrome([join(ROOT, ".wrangler/chrome"), join(ROOT, "chrome")]);

const cell = (index: number): GridItem => ({ kind: "block", markup: html`<div style="height: 40px">Cover ${index}</div>` });
const cells = (count: number) => Array.from({ length: count }, (_, index) => cell(index));
const whenEmpty = html`<p>Nothing yet</p>`;

/** Each case: what holds the list, how wide, and the least a cell may be in the browser's own px (times the text size). */
interface Case { name: string; holderWidthPx: number; markup: string; leastAtBrowserTextPx: number }
const CASES: Case[] = [
  { name: "a grid of covers", holderWidthPx: 1400, markup: grid({ itemSize: "cover", whenEmpty: whenEmpty as never, items: cells(14) }).html, leastAtBrowserTextPx: 180 },
  { name: "a grid of cards", holderWidthPx: 1400, markup: grid({ itemSize: "card", whenEmpty: whenEmpty as never, items: cells(10) }).html, leastAtBrowserTextPx: 280 },
  { name: "covers on one line", holderWidthPx: 1000, markup: grid({ itemSize: "cover", isAllOnOneLine: true, whenEmpty: whenEmpty as never, items: cells(6) }).html, leastAtBrowserTextPx: 180 },
  { name: "a track of covers", holderWidthPx: 1400, markup: track({ id: "track", itemSize: "cover", whenEmpty: whenEmpty as never, items: cells(10) }).html, leastAtBrowserTextPx: 200 },
];
const pageFor = (each: Case) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${COMPONENT_STYLES()}</style></head><body style="margin: 0"><div id="holder" style="width: ${each.holderWidthPx}px">${each.markup}</div></body></html>`;

describe.skipIf(!chromePath || process.platform === "win32" || typeof WebSocket !== "function")("grids and tracks of covers fold as the text grows", () => {
  let chrome: Awaited<ReturnType<typeof openChrome>>;
  let server: Server;
  let origin = "";

  beforeAll(async () => {
    chrome = await openChrome(chromePath!, `zaisma-grids-follow-text-test-${process.pid}-`, { isDrawingOnCpu: true });
    server = createServer((request, response) => {
      const each = CASES[Number(new URL(request.url ?? "/", "http://localhost").searchParams.get("case"))];
      if (!each) { response.writeHead(404).end(); return; }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(pageFor(each));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    await chrome?.close();
    await new Promise((resolve) => server?.close(resolve));
  });

  /** How many cells share the first line, and the narrowest cell's width, with the browser's text at that percent. */
  async function measure(each: Case, textPercent: number): Promise<{ acrossCount: number; narrowestPx: number }> {
    const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
    try {
      await chrome.send("Page.enable", {}, sessionId);
      await chrome.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
      await chrome.send("Page.setFontSizes", { fontSizes: { standard: Math.round((16 * textPercent) / 100), fixed: Math.round((13 * textPercent) / 100) } }, sessionId);
      const loaded = new Promise<void>((resolve) => { const stop = chrome.listen(sessionId, (method: string) => { if (method === "Page.loadEventFired") { stop(); resolve(); } }); });
      await chrome.send("Page.navigate", { url: `${origin}/?case=${CASES.indexOf(each)}` }, sessionId);
      await loaded;
      const expression = `(() => {
        const boxes = [...document.querySelectorAll(".layout-grid > .grid-cell, .layout-track > *")].map((each) => each.getBoundingClientRect());
        const firstTop = boxes[0].top;
        return { acrossCount: boxes.filter((box) => Math.abs(box.top - firstTop) < 1).length, narrowestPx: Math.round(Math.min(...boxes.map((box) => box.width))) };
      })()`;
      return (await chrome.send("Runtime.evaluate", { expression, returnByValue: true }, sessionId)).result.value;
    } finally {
      await chrome.send("Target.closeTarget", { targetId });
    }
  }

  it("keeps every cell at its least width times the text size, holding fewer across at 200% text than at 100%", async () => {
    for (const each of CASES) {
      const [atBrowserText, atDoubleText] = [await measure(each, 100), await measure(each, 200)];
      expect({ name: each.name, isAtLeast: atBrowserText.narrowestPx >= each.leastAtBrowserTextPx }).toEqual({ name: each.name, isAtLeast: true });
      expect({ name: each.name, narrowestPx: atDoubleText.narrowestPx, isAtLeast: atDoubleText.narrowestPx >= 2 * each.leastAtBrowserTextPx }).toMatchObject({ name: each.name, isAtLeast: true });
      if (!each.markup.includes("layout-track")) expect({ name: each.name, isFewerAcross: atDoubleText.acrossCount < atBrowserText.acrossCount }).toEqual({ name: each.name, isFewerAcross: true });
    }
  }, 60_000);
});
