import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findChrome, openChrome } from "../../packages/cli/chrome.mjs";
import { benchPage } from "../../scripts/preview/bench/bench-page.ts";
import { BENCH_PLACES, readyStates } from "../../scripts/preview/bench/places.ts";

const ROOT = join(import.meta.dirname, "../..");
const chromePath = findChrome([join(ROOT, ".wrangler/chrome"), join(ROOT, "chrome")]);

/** Every screen has a page and every screen shows the state asked for, found by looking, never by waiting a fixed time. */
const OPENED = `new Promise((resolve) => {
  const key = new URLSearchParams(location.search).get("expect");
  const isOpen = () => [...document.querySelectorAll("iframe")].every((frame) => frame.src && frame.contentWindow?.location.href !== "about:blank" && frame.contentDocument?.readyState === "complete")
    && (!key || document.querySelector('[data-bench-state="' + key + '"]')?.getAttribute("aria-pressed") === "true");
  const check = () => (isOpen() ? resolve(true) : requestAnimationFrame(check));
  check();
})`;

describe.skipIf(!chromePath)("a Screens bench link opens the bench with its screens loaded", () => {
  let server: Server;
  let origin = "";
  let chrome: Awaited<ReturnType<typeof openChrome>>;
  beforeAll(async () => {
    const script = readFileSync(join(ROOT, "scripts/preview/bench/bench-script.js"), "utf8");
    server = createServer((request, response) => {
      const url = new URL(request.url!, origin);
      if (url.pathname === "/design/screens") {
        const page = benchPage({ SITE_ORIGIN: "http://localhost:8787" } as never, url, { prepared: [], test_accounts: [{ username: "Preview_Studio" }] }, origin);
        page.text().then((text) => { response.writeHead(200, { "content-type": "text/html" }); response.end(text); });
      } else if (url.pathname === "/__preview/bench/bench.js") { response.writeHead(200, { "content-type": "text/javascript" }); response.end(script); }
      else if (url.pathname === "/__preview/bench/seen") { response.writeHead(200, { "content-type": "application/json" }); response.end("{}"); }
      else { response.writeHead(200, { "content-type": "text/html" }); response.end("<!doctype html><title>stand-in</title><p>stand-in page"); }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    chrome = await openChrome(chromePath!, "zaisma-bench-links-test-");
  }, 60_000);
  afterAll(async () => { await chrome?.close(); server?.close(); });

  async function opened(search: string, expectKey = ""): Promise<boolean> {
    const { browserContextId } = await chrome.send("Target.createBrowserContext");
    const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank", browserContextId });
    const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
    try {
      await chrome.send("Page.navigate", { url: `${origin}/design/screens?${search}${expectKey ? `&expect=${encodeURIComponent(expectKey)}` : ""}` }, sessionId);
      const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 15_000));
      const open = chrome.send("Runtime.evaluate", { expression: `document.readyState === "complete" ? ${OPENED} : new Promise((r) => addEventListener("load", () => ${OPENED}.then(r)))`, awaitPromise: true, returnByValue: true }, sessionId).then((answer: { result: { value: boolean } }) => answer.result.value);
      return await Promise.race([open, timeout]);
    } finally { await chrome.send("Target.closeTarget", { targetId }); }
  }

  it("opens a plain link and a ?page= link", async () => {
    expect(await opened("place=home")).toBe(true);
    expect(await opened("page=/games")).toBe(true);
  }, 40_000);
  for (const place of BENCH_PLACES.filter((each) => readyStates().some((state) => state.placeValue === each.placeValue))) {
    const state = readyStates().find((each) => each.placeValue === place.placeValue)!;
    it(`opens ${place.placeValue} on a state: ${state.stateValue}`, async () => {
      const profile = place.profile ?? state.profile ?? "";
      expect(await opened(`place=${place.placeValue}&state=${state.stateValue}${profile ? `&profile=${profile}` : ""}`, `${place.placeValue}/${state.stateValue}`)).toBe(true);
    }, 40_000);
  }
});
