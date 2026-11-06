import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findChrome, openChrome } from "../../packages/cli/chrome.mjs";
import { COMPONENT_STYLES } from "../../apps/site/src/components/index.ts";
import { backdrop } from "../../apps/site/src/components/foundations.ts";

/**
 * Zaisma's own backdrop shows its still (the placeholder under its canvas) wherever its shader doesn't draw: no WebGL, a slow device, or the
 * Screens bench with still backgrounds. The still follows the nearest theme, as the glass over it does, so a box that fixes its own theme
 * (the gallery's stage, light, inside a page in dark) shows the still of that theme: light glass over the dark still was the bench's
 * gallery pages in dark. The shader reads its colors from the same box, so the page with WebGL showed the light one all along.
 */
const ROOT = join(import.meta.dirname, "../..");
const chromePath = findChrome([join(ROOT, ".wrangler/chrome"), join(ROOT, "chrome")]);

type ThemeChoice = "system" | "light" | "dark";
interface Case { name: string; media: "light" | "dark"; rootChoice: ThemeChoice; stageChoice: ThemeChoice | null }

const pageFor = (rootChoice: ThemeChoice, stageChoice: ThemeChoice | null) => {
  const inside = `${backdrop()}<div class="glass" data-glass id="glass">Glass</div>`;
  const stage = stageChoice ? `<div id="stage" data-theme-choice="${stageChoice}" style="position: relative">${inside}</div>` : inside;
  return `<!doctype html><html data-theme-choice="${rootChoice}"><head><meta charset="utf-8"><style>${COMPONENT_STYLES()}</style></head><body>${stage}</body></html>`;
};

describe.skipIf(!chromePath || process.platform === "win32" || typeof WebSocket !== "function")("Zaisma's own still follows the nearest theme", () => {
  let chrome: Awaited<ReturnType<typeof openChrome>>;
  let server: Server;
  let origin = "";

  beforeAll(async () => {
    chrome = await openChrome(chromePath!, `zaisma-backdrop-still-test-${process.pid}-`, { isDrawingOnCpu: true });
    server = createServer((request, response) => {
      const asked = new URL(request.url ?? "/", "http://localhost");
      const rootChoice = (asked.searchParams.get("root") ?? "system") as ThemeChoice;
      const stageChoice = asked.searchParams.get("stage") as ThemeChoice | null;
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(pageFor(rootChoice, stageChoice));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    await chrome?.close();
    await new Promise((resolve) => server?.close(resolve));
  });

  /** The still's picture and the glass's color scheme, on a page in that theme. */
  async function look(each: Case): Promise<{ still: string; glassScheme: string }> {
    const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
    try {
      await chrome.send("Page.enable", {}, sessionId);
      await chrome.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: each.media }] }, sessionId);
      const loaded = new Promise<void>((resolve) => { const stop = chrome.listen(sessionId, (method: string) => { if (method === "Page.loadEventFired") { stop(); resolve(); } }); });
      await chrome.send("Page.navigate", { url: `${origin}/?root=${each.rootChoice}${each.stageChoice ? `&stage=${each.stageChoice}` : ""}` }, sessionId);
      await loaded;
      const expression = `({ still: getComputedStyle(document.querySelector(".backdrop-placeholder.is-own")).getPropertyValue("--placeholder").trim(), glassScheme: getComputedStyle(document.getElementById("glass")).colorScheme })`;
      return (await chrome.send("Runtime.evaluate", { expression, returnByValue: true }, sessionId)).result.value;
    } finally {
      await chrome.send("Target.closeTarget", { targetId });
    }
  }

  it("shows the still of the theme its glass shows, whatever the root and the device say", async () => {
    const light = await look({ name: "light page", media: "light", rootChoice: "system", stageChoice: null });
    const dark = await look({ name: "dark page", media: "dark", rootChoice: "system", stageChoice: null });
    expect(light.still).toMatch(/^url\(/);
    expect(dark.still).toMatch(/^url\(/);
    expect(dark.still).not.toBe(light.still);
    expect([light.glassScheme, dark.glassScheme]).toEqual(["light", "dark"]);

    const cases: (Case & { expected: "light" | "dark" })[] = [
      // The gallery's stage on the bench in dark: fixed light inside a page that follows the device's dark.
      { name: "light stage, device dark", media: "dark", rootChoice: "system", stageChoice: "light", expected: "light" },
      { name: "light stage, page chose dark", media: "light", rootChoice: "dark", stageChoice: "light", expected: "light" },
      { name: "dark stage, page chose light", media: "light", rootChoice: "light", stageChoice: "dark", expected: "dark" },
      { name: "dark stage, device light", media: "light", rootChoice: "system", stageChoice: "dark", expected: "dark" },
      { name: "page chose light, device dark", media: "dark", rootChoice: "light", stageChoice: null, expected: "light" },
      { name: "page chose dark, device light", media: "light", rootChoice: "dark", stageChoice: null, expected: "dark" },
    ];
    for (const each of cases) {
      const seen = await look(each);
      expect({ name: each.name, glassScheme: seen.glassScheme, still: seen.still }).toEqual({ name: each.name, glassScheme: each.expected, still: (each.expected === "light" ? light : dark).still });
    }
  }, 60_000);
});
