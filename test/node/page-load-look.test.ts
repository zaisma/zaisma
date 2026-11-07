import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findChrome, openChrome } from "../../packages/cli/chrome.mjs";
import { SITE_STYLE } from "../../apps/site/src/html.ts";
import { pageStyleText } from "../../apps/site/src/page-styles.ts";
import { footer } from "../../apps/site/src/components/navigation.ts";

/**
 * How a page looks as it loads, in a real Chrome on the site's own sheet.
 *
 * A page's own color, behind Zaisma's backdrop, is the backdrop's base color: a page's top arrives before its body, and its backdrop's still
 * is decoded after that, so the first frames show the page's color alone. A light page painted beige there, between white and the blue
 * backdrop. Measured in a real Chrome on the site's own sheet, before any body has arrived.
 */
const ROOT = join(import.meta.dirname, "../..");
const chromePath = findChrome([join(ROOT, ".wrangler/chrome"), join(ROOT, "chrome")]);
const PAGE = `<!doctype html><html data-theme-choice="system"><head><meta charset="utf-8"><style>${pageStyleText(SITE_STYLE)}</style></head><body></body></html>`;
/** A page opened fresh (a reload, another site): its panes and its footer come in together. */
const FRESH_PAGE = `<!doctype html><html data-theme-choice="system" class="is-page-arriving is-page-arriving-fresh"><head><meta charset="utf-8"><style>${pageStyleText(SITE_STYLE)}</style></head><body><main><div class="glass" data-glass><p>A pane</p></div></main>${footer()}</body></html>`;

describe.skipIf(!chromePath || process.platform === "win32" || typeof WebSocket !== "function")("a page as it loads", () => {
  let chrome: Awaited<ReturnType<typeof openChrome>>;
  let server: Server;
  let origin = "";

  beforeAll(async () => {
    chrome = await openChrome(chromePath!, `zaisma-page-color-test-${process.pid}-`, { isDrawingOnCpu: true });
    server = createServer((request, response) => { response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(request.url === "/fresh" ? FRESH_PAGE : PAGE); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    await chrome?.close();
    await new Promise((resolve) => server?.close(resolve));
  });

  async function evaluateOn<T>(path: string, theme: "light" | "dark", expression: string): Promise<T> {
    const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
    try {
      await chrome.send("Page.enable", {}, sessionId);
      await chrome.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] }, sessionId);
      const loaded = new Promise<void>((resolve) => { const stop = chrome.listen(sessionId, (method: string) => { if (method === "Page.loadEventFired") { stop(); resolve(); } }); });
      await chrome.send("Page.navigate", { url: origin + path }, sessionId);
      await loaded;
      return (await chrome.send("Runtime.evaluate", { expression, returnByValue: true }, sessionId)).result.value as T;
    } finally {
      await chrome.send("Target.closeTarget", { targetId });
    }
  }

  async function colors(theme: "light" | "dark"): Promise<{ page: string; body: string; backdropBase: string }> {
    const expression = `(() => { const probe = document.createElement("i"); probe.style.color = "var(--backdrop-base)"; document.documentElement.append(probe);
        const backdropBase = getComputedStyle(probe).color; probe.remove();
        return { page: getComputedStyle(document.documentElement).backgroundColor, body: getComputedStyle(document.body).backgroundColor, backdropBase }; })()`;
    return evaluateOn("/", theme, expression);
  }

  it("brings the footer in with the panes on a page opened fresh, at their pace, never standing there before them", async () => {
    const arrivals = await evaluateOn<{ pane: string[]; footer: string[] }>("/fresh", "light", `(() => {
      const arrival = (element) => element.getAnimations().map((animation) => animation.animationName + " " + animation.effect.getTiming().duration);
      return { pane: arrival(document.querySelector("main .glass > p")), footer: arrival(document.querySelector("body > .foot > .foot-in")) };
    })()`);
    expect(arrivals.pane.length).toBe(1);
    expect(arrivals.footer).toEqual(arrivals.pane);
  }, 60_000);

  it("colors the page with the backdrop's base color, in light and in dark", async () => {
    const light = await colors("light"), dark = await colors("dark");
    expect(light).toEqual({ page: "rgb(186, 206, 230)", body: "rgb(186, 206, 230)", backdropBase: "rgb(186, 206, 230)" });
    expect(dark).toEqual({ page: dark.backdropBase, body: dark.backdropBase, backdropBase: "rgb(13, 22, 34)" });
  }, 60_000);
});
