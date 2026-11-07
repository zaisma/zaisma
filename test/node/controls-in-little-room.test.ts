import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findChrome, openChrome } from "../../packages/cli/chrome.mjs";
import { COMPONENT_STYLES } from "../../apps/site/src/components/index.ts";
import { tabSwitch } from "../../apps/site/src/components/switch.ts";
import { row } from "../../apps/site/src/components/layout.ts";
import { cutField } from "../../apps/site/src/components/fields.ts";
import { secondaryButton } from "../../apps/site/src/components/actions.ts";
import { firstPaintScriptTags } from "../../apps/site/src/html.ts";

/**
 * Controls given less room than they'd like, in a real Chrome. A Switch's tabs keep their words' width and scroll in their Well, never
 * running into each other ("This gamInbox", the in-game overlay's tabs at 200% text), with the one you're on brought whole into view. A short
 * field beside its button in a row meets it, so the two slant toward each other, never sitting apart (the overlay's Join a room by its code).
 */
const ROOT = join(import.meta.dirname, "../..");
const chromePath = findChrome([join(ROOT, ".wrangler/chrome"), join(ROOT, "chrome")]);

// In a pane's head beside its Close, as the in-game overlay's players sheet holds them.
const tabsBody = `<div class="pane-head" style="display: flex; width: 340px"><div class="pane-head-words" style="display: contents">${tabSwitch({ label: "Places", switchSize: "small", isFull: true, tabs: [
  { label: "Room", tabValue: "room", isCurrent: false }, { label: "Friends", tabValue: "friends", isCurrent: false },
  { label: "This game", tabValue: "game", isCurrent: true }, { label: "Inbox", tabValue: "inbox", isCurrent: false },
] })}</div><button type="button" style="flex: none; width: 40px">×</button></div>`;
const joinBody = (widths: "fit" | "lead-fills") => `<div class="glass" data-glass style="display: block; width: 300px; padding: 8px">${row({ widths, label: "Join a room", items: [
  { kind: "control", markup: cutField({ id: "code", name: "room", label: "Join a room by its code", type: "text", icon: "hash", placeholder: "ABC234", isShort: true }) },
  { kind: "control", markup: secondaryButton("Join", { id: "join", type: "submit" }) },
] }).html}</div>`;
const BODIES: Record<string, string> = { tabs: tabsBody, "join-fit": joinBody("fit"), "join-lead-fills": joinBody("lead-fills") };
const pageFor = (body: string) =>
  `<!doctype html><html data-theme-choice="light"><head><meta charset="utf-8"><style>${COMPONENT_STYLES()}</style></head><body style="margin: 16px">${body}<p>After</p>${firstPaintScriptTags(body)}</body></html>`;

describe.skipIf(!chromePath || process.platform === "win32" || typeof WebSocket !== "function")("controls in little room", () => {
  let chrome: Awaited<ReturnType<typeof openChrome>>;
  let server: Server;
  let origin = "";

  beforeAll(async () => {
    chrome = await openChrome(chromePath!, `zaisma-little-room-test-${process.pid}-`, { isDrawingOnCpu: true });
    server = createServer((request, response) => {
      const body = BODIES[new URL(request.url ?? "/", "http://localhost").searchParams.get("body") ?? ""];
      if (!body) { response.writeHead(404).end(); return; }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(pageFor(body));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    await chrome?.close();
    await new Promise((resolve) => server?.close(resolve));
  });

  async function evaluate<T>(bodyName: string, textPercent: number, expression: string): Promise<T> {
    const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
    try {
      await chrome.send("Page.enable", {}, sessionId);
      await chrome.send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false }, sessionId);
      await chrome.send("Page.setFontSizes", { fontSizes: { standard: Math.round((16 * textPercent) / 100), fixed: Math.round((13 * textPercent) / 100) } }, sessionId);
      const loaded = new Promise<void>((resolve) => { const stop = chrome.listen(sessionId, (method: string) => { if (method === "Page.loadEventFired") { stop(); resolve(); } }); });
      await chrome.send("Page.navigate", { url: `${origin}/?body=${bodyName}` }, sessionId);
      await loaded;
      const settled = `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(${expression}))))`;
      return (await chrome.send("Runtime.evaluate", { expression: settled, returnByValue: true, awaitPromise: true }, sessionId)).result.value as T;
    } finally {
      await chrome.send("Target.closeTarget", { targetId });
    }
  }

  it("keeps a Switch's tabs at their words' width at 200% text, scrolling them in the Well with the one you're on in view", async () => {
    const seen = await evaluate<{ squeezed: string[]; overlapping: number; isChosenWhole: boolean }>("tabs", 200, `(() => {
      const tabs = [...document.querySelectorAll(".tab-switch > button")], scroller = document.querySelector(".tab-switch").parentElement.getBoundingClientRect();
      const boxes = tabs.map((tab) => tab.getBoundingClientRect()), chosen = boxes[tabs.findIndex((tab) => tab.getAttribute("aria-pressed") === "true")];
      return {
        squeezed: tabs.filter((tab) => tab.scrollWidth > tab.clientWidth + 1).map((tab) => tab.textContent.trim()),
        overlapping: boxes.slice(1).filter((box, index) => box.left < boxes[index].right - 1).length,
        isChosenWhole: chosen.left >= scroller.left - 1 && chosen.right <= scroller.right + 1,
      };
    })()`);
    expect(seen).toEqual({ squeezed: [], overlapping: 0, isChosenWhole: true });
  }, 60_000);

  it("puts a short field and the button beside it together, slanted toward each other, in a row that fits them and one its field leads", async () => {
    for (const bodyName of ["join-fit", "join-lead-fills"]) {
      const seen = await evaluate<{ gapPx: number; fieldSlant: string | null; buttonSlant: string | null }>(bodyName, 100, `(() => {
        const field = document.querySelector(".cut-field > .field"), button = document.getElementById("join");
        return { gapPx: Math.round(button.getBoundingClientRect().left - field.getBoundingClientRect().right), fieldSlant: field.getAttribute("data-slanted"), buttonSlant: (button.querySelector("[data-slanted]") || button).getAttribute("data-slanted") };
      })()`);
      expect({ bodyName, isTogether: seen.gapPx <= 0, fieldSlant: seen.fieldSlant, buttonSlant: seen.buttonSlant }).toEqual({ bodyName, isTogether: true, fieldSlant: "end", buttonSlant: "start" });
    }
  }, 60_000);
});
