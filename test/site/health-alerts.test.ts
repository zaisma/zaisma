import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGame, createVersion } from "@zaisma/core";
import type { Env } from "../../apps/site/src/env.ts";
import { watchHealth } from "../../apps/site/src/health-alerts.ts";

/** Half-broken alerts ("Julius hears within minutes when something is down", docs/DECISIONS.md in the ops repo): scans behind, errors spiking, the outside checker silent. */

const MINUTE_MS = 60_000;
// 12:00 UTC, so the checker's run list is asked (it's asked in the first 5 minutes of every 15).
const NOON_MS = Date.UTC(2026, 9, 19, 12, 0, 0);
const testEnv = { ...env, PUSHOVER_USER_KEY: "user-key", PUSHOVER_APP_TOKEN: "app-token", PUSHOVER_URL: "https://pushover.test/push", CLOUDFLARE_GRAPHQL_URL: "https://graphql.test/graphql", WATCH_RUNS_URL: "https://runs.test/runs" } as unknown as Env;
const analyticsEnv = { ...testEnv, CLOUDFLARE_ACCOUNT_ID: "account-1", ANALYTICS_API_TOKEN: "analytics-token" } as unknown as Env;

type Sent = { title: string; message: string; priority: string; retry: string | null; expire: string | null };
let pushes: Sent[];
let counts: Record<string, { requests: number; errors: number }>;
let lastRunAtMs: number | null;
let runsStatus: number;
let gameId: string;

beforeEach(async () => {
  await env.DB.exec("DELETE FROM health_alerts; DELETE FROM versions;");
  gameId = (await createGame(env.DB, { slug: `health-${crypto.randomUUID().slice(0, 8)}`, title: "Health", description: "" })).id;
  pushes = [];
  counts = {};
  lastRunAtMs = NOON_MS - MINUTE_MS;
  runsStatus = 200;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://pushover.test/push") {
      const form = new URLSearchParams(String(init?.body));
      pushes.push({ title: form.get("title")!, message: form.get("message")!, priority: form.get("priority")!, retry: form.get("retry"), expire: form.get("expire") });
      expect(form.get("token")).toBe("app-token");
      expect(form.get("user")).toBe("user-key");
      return new Response("{}", { status: 200 });
    }
    if (url === "https://graphql.test/graphql") {
      const { variables } = JSON.parse(String(init?.body)) as { variables: { scriptName: string } };
      const sum = counts[variables.scriptName];
      return Response.json({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: sum ? [{ sum }] : [] }] } }, errors: null });
    }
    if (url === "https://runs.test/runs") {
      if (runsStatus !== 200) return new Response("rate limited", { status: runsStatus });
      return Response.json({ workflow_runs: lastRunAtMs === null ? [] : [{ updated_at: new Date(lastRunAtMs).toISOString() }] });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function version(id: string, createdAtMs: number, scanQueuedAtMs: number | null, scanStatus = "scanning") {
  await createVersion(env.DB, { id, gameId, r2Prefix: id, fileCount: 1, sizeBytes: 1 });
  await env.DB.prepare("UPDATE versions SET created_at_ms = ?, scan_queued_at_ms = ?, scan_status = ? WHERE id = ?").bind(createdAtMs, scanQueuedAtMs, scanStatus, id).run();
}
const rowCount = async () => (await env.DB.prepare("SELECT COUNT(*) AS row_count FROM health_alerts").first<{ row_count: number }>())!.row_count;

describe("scans behind", () => {
  it("pushes once when a version has waited over 10 minutes, then once when it's over", async () => {
    await version("version_slow", NOON_MS - 30 * MINUTE_MS, NOON_MS - 30 * MINUTE_MS);
    await watchHealth(testEnv, NOON_MS);
    expect(pushes).toEqual([{ title: "Scans are behind", message: "1 version has been waiting to be scanned, the oldest for 30 min. Scans usually take under a minute.", priority: "0", retry: null, expire: null }]);

    await watchHealth(testEnv, NOON_MS + 5 * MINUTE_MS);
    expect(pushes).toHaveLength(1);

    await env.DB.exec("UPDATE versions SET scan_status = 'approved'");
    await watchHealth(testEnv, NOON_MS + 10 * MINUTE_MS);
    expect(pushes.map((push) => push.title)).toEqual(["Scans are behind", "Scans caught up"]);
    expect(pushes[1]!.message).toBe("It lasted 10 min.");
    expect(await rowCount()).toBe(0);
  });

  it("stays quiet for a fresh scan and for an old version put back to scanning a moment ago", async () => {
    await version("version_new", NOON_MS - 2 * MINUTE_MS, NOON_MS - 2 * MINUTE_MS);
    await version("version_rescanned", NOON_MS - 3 * 24 * 60 * MINUTE_MS, NOON_MS - MINUTE_MS);
    await watchHealth(testEnv, NOON_MS);
    expect(pushes).toEqual([]);
  });

  it("counts from creation for a version queued before the column existed", async () => {
    await version("version_old", NOON_MS - 20 * MINUTE_MS, null);
    await watchHealth(testEnv, NOON_MS);
    expect(pushes.map((push) => push.title)).toEqual(["Scans are behind"]);
  });

  it("reminds every 2 hours while it holds, not before", async () => {
    await version("version_stuck", NOON_MS - 30 * MINUTE_MS, NOON_MS - 30 * MINUTE_MS);
    // The checker keeps running throughout, so only the scans speak.
    lastRunAtMs = NOON_MS + 3 * 60 * MINUTE_MS;
    await watchHealth(testEnv, NOON_MS);
    await watchHealth(testEnv, NOON_MS + 119 * MINUTE_MS);
    expect(pushes).toHaveLength(1);
    await watchHealth(testEnv, NOON_MS + 120 * MINUTE_MS);
    expect(pushes.map((push) => push.title)).toEqual(["Scans are behind", "Still: Scans are behind"]);
    expect(pushes[1]!.message).toContain("It began 2 hours ago.");
  });

  it("tells once when two crons run at the same moment", async () => {
    await version("version_slow", NOON_MS - 30 * MINUTE_MS, NOON_MS - 30 * MINUTE_MS);
    await Promise.all([watchHealth(testEnv, NOON_MS), watchHealth(testEnv, NOON_MS)]);
    expect(pushes).toHaveLength(1);
  });
});

describe("errors spiking", () => {
  it("is off without the analytics token", async () => {
    counts = { "zaisma-site": { requests: 1000, errors: 900 } };
    await watchHealth(testEnv, NOON_MS);
    expect(pushes).toEqual([]);
  });

  it("pushes when over 5% of at least 20 requests failed, naming the Worker, and when it's over", async () => {
    counts = { "zaisma-site": { requests: 200, errors: 30 }, "zaisma-rooms": { requests: 500, errors: 2 } };
    await watchHealth(analyticsEnv, NOON_MS);
    expect(pushes).toEqual([{ title: "Errors are spiking", message: "In the last 5 minutes, zaisma-site: 30 of 200 requests failed (15%).", priority: "0", retry: null, expire: null }]);
    counts = {};
    await watchHealth(analyticsEnv, NOON_MS + 5 * MINUTE_MS);
    expect(pushes.map((push) => push.title)).toEqual(["Errors are spiking", "Errors are back to normal"]);
  });

  it("ignores a quiet Worker's one failure and a rate at or under 5%", async () => {
    counts = { "zaisma-site": { requests: 3, errors: 3 }, "zaisma-rooms": { requests: 100, errors: 5 } };
    await watchHealth(analyticsEnv, NOON_MS);
    expect(pushes).toEqual([]);
  });

  it("asks for the 5 minutes that ended 2 minutes ago", async () => {
    const asked: { start: string; end: string }[] = [];
    const inner = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "https://graphql.test/graphql") asked.push((JSON.parse(String(init?.body)) as { variables: { start: string; end: string } }).variables);
      return inner(input, init);
    });
    await watchHealth(analyticsEnv, NOON_MS);
    expect(asked[0]).toMatchObject({ start: "2026-10-19T11:53:00.000Z", end: "2026-10-19T11:58:00.000Z" });
    expect(asked).toHaveLength(3);
  });
});

describe("the outside checker gone silent", () => {
  it("pushes at the high priority when its newest run is over 45 minutes old, and when it runs again", async () => {
    lastRunAtMs = NOON_MS - 50 * MINUTE_MS;
    await watchHealth(testEnv, NOON_MS);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({ title: "The outside checker has gone quiet", priority: "1" });
    expect(pushes[0]!.message).toContain("50 min ago");
    lastRunAtMs = NOON_MS + 14 * MINUTE_MS;
    await watchHealth(testEnv, NOON_MS + 15 * MINUTE_MS);
    expect(pushes.map((push) => push.title)).toEqual(["The outside checker has gone quiet", "The outside checker is running again"]);
  });

  it("stays quiet when GitHub can't say, when no run exists yet, and between its 15-minute looks", async () => {
    runsStatus = 403;
    lastRunAtMs = NOON_MS - 90 * MINUTE_MS;
    await watchHealth(testEnv, NOON_MS);
    runsStatus = 200;
    lastRunAtMs = null;
    await watchHealth(testEnv, NOON_MS + 15 * MINUTE_MS);
    lastRunAtMs = NOON_MS - 90 * MINUTE_MS;
    await watchHealth(testEnv, NOON_MS + 30 * MINUTE_MS + 7 * MINUTE_MS);
    expect(pushes).toEqual([]);
  });
});

describe("without Pushover keys", () => {
  it("logs the alert and breaks nothing", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => void lines.push(String(line)));
    await version("version_slow", NOON_MS - 30 * MINUTE_MS, NOON_MS - 30 * MINUTE_MS);
    await watchHealth({ ...testEnv, PUSHOVER_USER_KEY: undefined, PUSHOVER_APP_TOKEN: undefined } as unknown as Env, NOON_MS);
    expect(lines).toEqual(["[push] Scans are behind"]);
  });
});
