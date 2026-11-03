import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { findChrome, openChrome } from "../../packages/cli/chrome.mjs";
import { CUT_LINE } from "../../apps/site/src/components/foundations.ts";
import { firstPaintScriptTags } from "../../apps/site/src/html.ts";

/**
 * The glass draws a page as it arrives (window.zaismaWatch.arriving), so it can meet a control the browser has only read part of. The
 * browser reads a page in runs: a run can end anywhere, at the end of what the network has brought or when its time is up. Here the
 * server ends one between the two tags of a cut line and holds the rest until the browser has read that far, which makes the rare
 * place certain.
 */
const ROOT = join(import.meta.dirname, "../..");
const chromePath = findChrome([join(ROOT, ".wrangler/chrome"), join(ROOT, "chrome")]);

const [CUT_LINE_START, CUT_LINE_REST] = ((text) => {
  const middle = text.indexOf("<polygon");
  return [text.slice(0, middle), text.slice(middle)];
})(String(CUT_LINE));
const SIZED = 'style="display: block; width: 200px; height: 48px;"';
/** A pane holding words the page's watcher hands over once they're whole and a control, read up to the middle of the control's cut line. */
const PAGE_START = `<div id="pane" data-glass data-glass-corners="pane" style="display: block; width: 400px; height: 300px;"><p id="words">Words</p><a id="control" data-cut-line="0" ${SIZED}>${CUT_LINE_START}`;
const PAGE_REST = `${CUT_LINE_REST}</a></div><p id="after">After</p>`;
const FIRST_PAINT = String(firstPaintScriptTags(PAGE_START + PAGE_REST));
const PAGE_HEAD = `<!doctype html><html><head><meta charset="utf-8"><title>Arriving</title></head><body>${FIRST_PAINT}`;
const WATCH_SCRIPT = `<script>window.wiredIds = []; window.zaismaWatch.each("#words", function (element) { window.wiredIds.push(element.id); });</script>`;

describe.skipIf(!chromePath || process.platform === "win32" || typeof WebSocket !== "function")("a cut line the browser has read only part of", () => {
  let chrome: Awaited<ReturnType<typeof openChrome>>;
  let server: Server;
  let heldResponse: ServerResponse | null = null;

  beforeAll(async () => {
    chrome = await openChrome(chromePath!, `zaisma-cut-line-test-${process.pid}-`, { isDrawingOnCpu: true });
    server = createServer((request, response) => {
      if (request.url !== "/page") { response.writeHead(404).end(); return; }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.write(PAGE_HEAD + WATCH_SCRIPT + PAGE_START);
      heldResponse = response;
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  }, 60_000);

  afterAll(async () => {
    await chrome?.close();
    await new Promise((resolve) => server?.close(resolve));
  });

  it("draws, throws nothing, and leaves the rest of what arrived with it working", async () => {
    expect(CUT_LINE_REST).toMatch(/^<polygon/);
    const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
    const thrown: string[] = [];
    const stopListening = chrome.listen(sessionId, (method: string, params: { exceptionDetails: { exception?: { description?: string }; text: string } }) => {
      if (method === "Runtime.exceptionThrown") thrown.push((params.exceptionDetails.exception?.description ?? params.exceptionDetails.text).split("\n")[0]!);
    });
    const read = async <Value>(expression: string): Promise<Value> => (await chrome.send("Runtime.evaluate", { expression, returnByValue: true }, sessionId)).result.value as Value;
    try {
      await chrome.send("Runtime.enable", {}, sessionId);
      await chrome.send("Page.navigate", { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/page` }, sessionId);
      // Read as far as the cut line's first tag, its polygon still to come: the watcher's delivery of it ran before this read can.
      await vi.waitFor(async () => expect(await read('document.querySelector("#control > .cut-line") !== null')).toBe(true), { timeout: 30_000, interval: 10 });
      expect(await read('document.readyState')).toBe("loading");
      heldResponse!.end(`${PAGE_REST}</body></html>`);
      await vi.waitFor(async () => expect(await read('document.readyState')).not.toBe("loading"), { timeout: 30_000, interval: 10 });

      expect(thrown).toEqual([]);
      // The control has its line, and its light round it, and follows its size from here on.
      expect(await read('document.querySelector("#control > .cut-line polygon").getAttribute("points")')).toMatch(/^[\d.]+,[\d.]+ /);
      expect(await read('document.querySelectorAll("#control > .cut-line .cut-band").length')).toBeGreaterThan(0);
      expect(await read('typeof document.querySelector("#control").redrawCut')).toBe("function");
      // What arrived with it isn't lost: the pane it sits in has its rim, and the page's watcher handed over the words beside it.
      expect(await read('document.querySelector("#pane > .edge") !== null')).toBe(true);
      expect(await read("window.wiredIds")).toEqual(["words"]);
    } finally {
      stopListening();
      await chrome.send("Target.closeTarget", { targetId });
    }
  }, 60_000);
});
