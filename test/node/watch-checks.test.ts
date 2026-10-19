import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WATCH_REMINDER_INTERVAL_MIN,
  emptyWatchState,
  nextWatchStep,
  runWatchChecks,
  sendPushover,
  // @ts-expect-error: a plain JavaScript script without types
} from "../../scripts/watch-checks.mjs";

/** scripts/watch-checks.mjs: the checker outside Cloudflare ("Julius hears within minutes when something is down" in docs/DECISIONS.md, the ops repo). */

const MINUTE_MS = 60_000;
const NOW_MS = Date.UTC(2026, 9, 19, 12, 0, 0);
afterEach(() => vi.unstubAllGlobals());

describe("nextWatchStep", () => {
  it("says nothing for a first failure, an emergency on the second in a row, then nothing", () => {
    let step = nextWatchStep(emptyWatchState(), ["rooms 503"], NOW_MS);
    expect(step.push).toBeNull();
    expect(step.state).toEqual({ failedRunCount: 1, failingSinceMs: NOW_MS, lastToldAtMs: 0 });

    step = nextWatchStep(step.state, ["rooms 503", "MCP 502"], NOW_MS + 5 * MINUTE_MS);
    expect(step.push).toEqual({ title: "Zaisma is down", message: "Failing for 2 checks in a row: rooms 503; MCP 502", priority: 2 });
    expect(step.state).toEqual({ failedRunCount: 2, failingSinceMs: NOW_MS, lastToldAtMs: NOW_MS + 5 * MINUTE_MS });

    step = nextWatchStep(step.state, ["rooms 503"], NOW_MS + 10 * MINUTE_MS);
    expect(step.push).toBeNull();
    expect(step.state.lastToldAtMs).toBe(NOW_MS + 5 * MINUTE_MS);
  });

  it("reminds after 2 hours at the high priority, saying how long it's been down", () => {
    const state = { failedRunCount: 5, failingSinceMs: NOW_MS, lastToldAtMs: NOW_MS + 5 * MINUTE_MS };
    expect(nextWatchStep(state, ["rooms 503"], NOW_MS + (WATCH_REMINDER_INTERVAL_MIN + 4) * MINUTE_MS).push).toBeNull();
    const step = nextWatchStep(state, ["rooms 503"], NOW_MS + (WATCH_REMINDER_INTERVAL_MIN + 5) * MINUTE_MS);
    expect(step.push).toEqual({ title: "Still down", message: "Down for 2 hours: rooms 503", priority: 1 });
    expect(step.state.lastToldAtMs).toBe(NOW_MS + (WATCH_REMINDER_INTERVAL_MIN + 5) * MINUTE_MS);
  });

  it("says back up once, only when Julius had been told", () => {
    const told = { failedRunCount: 3, failingSinceMs: NOW_MS, lastToldAtMs: NOW_MS + 5 * MINUTE_MS };
    const step = nextWatchStep(told, [], NOW_MS + 25 * MINUTE_MS);
    expect(step.push).toEqual({ title: "Zaisma is back up", message: "Every check passes again. It was down 25 min.", priority: 0 });
    expect(step.state).toEqual(emptyWatchState());
    expect(nextWatchStep({ failedRunCount: 1, failingSinceMs: NOW_MS, lastToldAtMs: 0 }, [], NOW_MS + 5 * MINUTE_MS).push).toBeNull();
    expect(nextWatchStep(emptyWatchState(), [], NOW_MS).push).toBeNull();
  });
});

describe("runWatchChecks", () => {
  const answers = (overrides: Record<string, Response> = {}) => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      asked.push(`${init?.method ?? "GET"} ${url}`);
      if (overrides[url]) return overrides[url]!.clone();
      if (url === "https://zaisma.com/g/arena") return new Response('<iframe src="x"></iframe>');
      if (url === "https://arena.zaismausercontent.com/") return new Response("<html>");
      if (url === "https://rooms.zaisma.com/.well-known/jwks.json") return Response.json({ keys: [] });
      if (url === "https://zaisma.com/mcp") return new Response('{"error":{"code":"no_key"}}', { status: 401 });
      if (url === "https://zaisma.com/signin") return new Response("Sign in", { status: 400 });
      throw new Error(`unexpected ${url}`);
    });
    return asked;
  };

  it("passes when the five answer as they do on a healthy site", async () => {
    const asked = answers();
    const results = await runWatchChecks();
    expect(results.map((result: { name: string; isPass: boolean }) => [result.name, result.isPass])).toEqual([["game page", true], ["game files", true], ["rooms", true], ["MCP", true], ["sign-in", true]]);
    expect(asked).toHaveLength(5);
  });

  it("fails a check after a second try, naming it and its answer", async () => {
    vi.useFakeTimers();
    try {
      const asked = answers({ "https://rooms.zaisma.com/.well-known/jwks.json": new Response("bad gateway", { status: 502 }), "https://zaisma.com/signin": new Response("down", { status: 502 }) });
      const running = runWatchChecks();
      await vi.advanceTimersByTimeAsync(10_000);
      const results = await running;
      expect(results.filter((result: { isPass: boolean }) => !result.isPass).map((result: { note: string }) => result.note)).toEqual(["rooms 502 bad gateway", "sign-in 502 down"]);
      expect(asked.filter((line) => line.endsWith("jwks.json"))).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails sign-in unless it answers 400, the bot check that follows the account lookup", async () => {
    vi.useFakeTimers();
    try {
      answers({ "https://zaisma.com/signin": new Response("Signed in", { status: 200 }) });
      const running = runWatchChecks();
      await vi.advanceTimersByTimeAsync(10_000);
      const signIn = (await running).find((result: { name: string }) => result.name === "sign-in");
      expect(signIn.isPass).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("sendPushover", () => {
  it("sends an emergency with its repeat, and a normal push without", async () => {
    const bodies: URLSearchParams[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => (bodies.push(new URLSearchParams(String(init.body))), new Response("{}")));
    await sendPushover({ userKey: "u", appToken: "t" }, { title: "Zaisma is down", message: "rooms", priority: 2 }, "https://pushover.test/push");
    await sendPushover({ userKey: "u", appToken: "t" }, { title: "Zaisma is back up", message: "ok", priority: 0 }, "https://pushover.test/push");
    expect(Object.fromEntries(bodies[0]!)).toEqual({ token: "t", user: "u", title: "Zaisma is down", message: "rooms", priority: "2", retry: "60", expire: "3600" });
    expect(bodies[1]!.get("retry")).toBeNull();
  });

  it("throws when Pushover refuses, so the run fails loudly", async () => {
    vi.stubGlobal("fetch", async () => new Response('{"errors":["application token is invalid"]}', { status: 400 }));
    await expect(sendPushover({ userKey: "u", appToken: "bad" }, { title: "x", message: "y", priority: 0 }, "https://pushover.test/push")).rejects.toThrow("Pushover answered 400");
  });
});
