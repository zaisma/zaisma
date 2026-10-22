import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FRAME_RATE_BUCKETS, GRAPHICS_FAMILY_PATTERNS, PLAYER_PERFORMANCE_LIMITS } from "../../packages/core/src/player-performance.ts";

// The measuring script Zaisma adds to game pages (packages/sdk/performance.js), run against a stand-in window
// whose clock, animation frames and timers the test drives.
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../packages/sdk/performance.js"), "utf8");
const SITE = "https://zaisma.test";

type Message = { type: string; [key: string]: unknown };

function gameFrame(options: { firstDrawAtMs?: number | null } = {}) {
  let nowMs = 0;
  const frameCallbacks: ((timestampMs: number) => unknown)[] = [];
  const intervals: (() => void)[] = [];
  const timeouts: { atMs: number; run: () => void }[] = [];
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  const posted: { message: Message; origin: string }[] = [];
  const document = { hidden: false, addEventListener: () => {} };
  const canvasListeners: Record<string, (() => void)[]> = {};
  class WebGLRenderingContext {
    canvas: unknown;
    RENDERER = 7937;
    VENDOR = 7936;
    lost = false;
    loseExtension = { loseContext: () => {} };
    constructor(canvas: unknown) {
      this.canvas = canvas;
    }
    getParameter(name: number) {
      return name === this.RENDERER ? "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11)" : "Google Inc.";
    }
    getExtension(name: string) {
      return name === "WEBGL_lose_context" ? this.loseExtension : null;
    }
    isContextLost() {
      return this.lost;
    }
  }
  // Each context's lose extension shares one prototype, as in a browser.
  const loseExtensionPrototype = {
    loseContext(this: { owner: { canvas: { lose: () => void } } }) {
      this.owner.canvas.lose();
    },
  };
  class HTMLCanvasElement {
    isConnected = true;
    width = 800;
    height = 600;
    addEventListener(kind: string, listener: () => void) {
      (canvasListeners[kind] ??= []).push(listener);
    }
    lose() {
      for (const listener of canvasListeners.webglcontextlost ?? []) listener();
    }
    getContext() {
      const context = new WebGLRenderingContext(this);
      const extension = Object.create(loseExtensionPrototype);
      extension.owner = context;
      context.loseExtension = extension;
      return context;
    }
  }
  const window: Record<string, unknown> = {
    parent: { postMessage: (message: Message, origin: string) => posted.push({ message, origin }) },
    requestAnimationFrame: (callback: (timestampMs: number) => unknown) => frameCallbacks.push(callback),
    addEventListener: (kind: string, listener: (event: unknown) => void) => (listeners[kind] ??= []).push(listener),
    __zaismaFirstDraw: { firstDrawAtMs: options.firstDrawAtMs ?? null, memories: new Set() },
    HTMLCanvasElement,
  };
  const performance = { timeOrigin: 1_000_000, now: () => nowMs };
  const config = { site: SITE, limits: PLAYER_PERFORMANCE_LIMITS, frameRateBuckets: FRAME_RATE_BUCKETS, graphicsFamilyPatterns: GRAPHICS_FAMILY_PATTERNS };
  new Function("window", "document", "performance", "location", "setInterval", "setTimeout", "HTMLCanvasElement", "WebGLRenderingContext", "__ZAISMA_PERFORMANCE__", source)(
    window,
    document,
    performance,
    { pathname: "/_zaisma/versions/version_abc123/index.html" },
    (run: () => void) => intervals.push(run),
    (run: () => void, durationMs: number) => timeouts.push({ atMs: nowMs + durationMs, run }),
    HTMLCanvasElement,
    WebGLRenderingContext,
    config,
  );
  const requestAnimationFrame = window.requestAnimationFrame as (callback: (timestampMs: number) => unknown) => unknown;
  return {
    window,
    document,
    posted,
    requestAnimationFrame,
    HTMLCanvasElement,
    /** The browser draws a frame: every callback asked for so far, with the frame's timestamp. */
    frame(timestampMs: number) {
      nowMs = timestampMs;
      for (const callback of frameCallbacks.splice(0)) callback(timestampMs);
    },
    /** Time passes by 5-second ticks of the script's timer, running timeouts due on the way. */
    tick(count = 1) {
      for (let i = 0; i < count; i++) {
        nowMs += PLAYER_PERFORMANCE_LIMITS.aliveIntervalSec * 1000;
        for (const timeout of timeouts.filter((due) => due.atMs <= nowMs)) {
          timeouts.splice(timeouts.indexOf(timeout), 1);
          timeout.run();
        }
        intervals.forEach((run) => run());
      }
    },
    error() {
      for (const listener of listeners.error ?? []) listener({});
    },
    setNow(timestampMs: number) {
      nowMs = timestampMs;
    },
  };
}

/** A game loop: asks for the next frame from each frame, as games do. */
function playAt(frame: ReturnType<typeof gameFrame>, framesPerSec: number, durationSec: number, startMs = 0) {
  const loop = () => frame.requestAnimationFrame(loop);
  loop();
  const frameCount = Math.round(framesPerSec * durationSec);
  for (let i = 1; i <= frameCount; i++) frame.frame(startMs + (i * 1000) / framesPerSec);
}

const performanceMessages = (frame: ReturnType<typeof gameFrame>) => frame.posted.filter((sent) => sent.message.type === "zaisma:performance");

describe("the game frame's measuring script", () => {
  it("leaves the game's animation frames as they were: order, arguments and answers", () => {
    const frame = gameFrame();
    const calls: string[] = [];
    expect(frame.requestAnimationFrame((timestampMs) => calls.push(`first ${timestampMs}`))).toBe(1);
    expect(frame.requestAnimationFrame((timestampMs) => calls.push(`second ${timestampMs}`))).toBe(2);
    frame.frame(16);
    expect(calls).toEqual(["first 16", "second 16"]);
  });

  it("sends the Zaisma page a summary under 1 KB 10 seconds in and every 30 after, and says it's alive every 5", () => {
    const frame = gameFrame({ firstDrawAtMs: 1_000_000 + 4_200 });
    playAt(frame, 60, 30);
    frame.tick(6);
    expect(frame.posted.filter((sent) => sent.message.type === "zaisma:alive")).toHaveLength(6);
    expect(performanceMessages(frame)).toHaveLength(2);
    const [sent] = performanceMessages(frame);
    expect(sent!.origin).toBe(SITE);
    expect(JSON.stringify(sent!.message).length).toBeLessThan(1024);
    const message = sent!.message as Message & { frame_rate_seconds: number[]; measured_duration_sec: number };
    expect(message).toMatchObject({ version_id: "version_abc123", loading_duration_sec: 4.2, is_settled: true, long_frame_count: 0, crash_kind_counts: {} });
    // A steady 60 counts in the 60 band.
    expect(message.measured_duration_sec).toBeGreaterThanOrEqual(29);
    expect(message.frame_rate_seconds[5]).toBe(message.measured_duration_sec);
    // Only the graphics chip's family leaves the frame, never its name.
    expect(message.graphics_family).toBe("unknown");
    expect(JSON.stringify(message)).not.toContain("RTX");
  });

  it("counts stutter, reads the family from the game's WebGL context, and starts afresh each report", () => {
    const frame = gameFrame({ firstDrawAtMs: null });
    const canvas = new frame.HTMLCanvasElement();
    (canvas.getContext as (kind: string) => unknown).call(canvas, "webgl");
    const loop = () => frame.requestAnimationFrame(loop);
    loop();
    // 20 frames at 30 a second, then 5 of 100 ms.
    for (let i = 1; i <= 20; i++) frame.frame(i * 33.3);
    for (let i = 1; i <= 5; i++) frame.frame(666 + i * 100);
    frame.tick(6);
    expect(performanceMessages(frame)[0]!.message).toMatchObject({ graphics_family: "nvidia", long_frame_count: 5, loading_duration_sec: null, is_settled: false });
    frame.tick(6);
    expect(performanceMessages(frame)[1]!.message).toMatchObject({ long_frame_count: 0, measured_duration_sec: 0 });
  });

  it("counts an error the game doesn't come back from, once a play", () => {
    const frame = gameFrame({ firstDrawAtMs: 1_000_500 });
    playAt(frame, 60, 2);
    frame.error();
    frame.tick(6);
    expect(performanceMessages(frame)[0]!.message).toMatchObject({ crash_kind_counts: { error_stop: 1 }, is_settled: true });

    // A game that keeps drawing after an error didn't crash.
    const going = gameFrame({ firstDrawAtMs: 1_000_500 });
    playAt(going, 60, 2);
    going.error();
    playAt(going, 60, 6, 2000);
    going.tick(6);
    expect(performanceMessages(going)[0]!.message).toMatchObject({ crash_kind_counts: {} });
  });

  it("counts a lost WebGL context, unless the game lost it itself", () => {
    const frame = gameFrame();
    const canvas = new frame.HTMLCanvasElement();
    const context = (canvas.getContext as (kind: string) => { getExtension: (name: string) => { loseContext: () => void } }).call(canvas, "webgl2");
    context.getExtension("WEBGL_lose_context").loseContext();
    frame.tick(6);
    expect(performanceMessages(frame)[0]!.message).toMatchObject({ crash_kind_counts: {} });

    const lost = gameFrame();
    const lostCanvas = new lost.HTMLCanvasElement();
    (lostCanvas.getContext as (kind: string) => unknown).call(lostCanvas, "webgl");
    lostCanvas.lose();
    lost.tick(6);
    expect(performanceMessages(lost)[0]!.message).toMatchObject({ crash_kind_counts: { context_lost: 1 } });
  });

  it("does nothing outside a Zaisma game page", () => {
    const window: Record<string, unknown> = { requestAnimationFrame: () => 1 };
    window.parent = window;
    const original = window.requestAnimationFrame;
    new Function("window", "__ZAISMA_PERFORMANCE__", source)(window, { site: SITE, limits: PLAYER_PERFORMANCE_LIMITS, frameRateBuckets: FRAME_RATE_BUCKETS, graphicsFamilyPatterns: GRAPHICS_FAMILY_PATTERNS });
    expect(window.requestAnimationFrame).toBe(original);
  });
});
