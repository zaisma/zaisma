import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLOUDFLARE_WATCH_MAXIMUM_PUSH_COUNT,
  WATCH_REMINDER_INTERVAL_MIN,
  checkCloudflareAccount,
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
      // A game's page opens at its version's own address.
      if (url === "https://arena.zaismausercontent.com/") return new Response(null, { status: 302, headers: { location: "/_zaisma/versions/version_1/" } });
      if (url === "https://arena.zaismausercontent.com/_zaisma/versions/version_1/") return new Response("<html>");
      if (url === "https://rooms.zaisma.com/.well-known/jwks.json") return Response.json({ keys: [{ kid: "pass" }] });
      if (url === "https://rooms.zaisma.com/.well-known/receipt-jwks.json") return Response.json({ keys: [{ kid: "receipt" }] });
      if (url === "https://zaisma.com/mcp") return new Response('{"error":{"code":"no_key"}}', { status: 401 });
      if (url === "https://zaisma.com/signin") return new Response("Sign in", { status: 400 });
      throw new Error(`unexpected ${url}`);
    });
    return asked;
  };

  it("passes when the six answer as they do on a healthy site", async () => {
    const asked = answers();
    const results = await runWatchChecks();
    expect(results.map((result: { name: string; isPass: boolean }) => [result.name, result.isPass])).toEqual([["game page", true], ["game files", true], ["rooms", true], ["receipt keys", true], ["MCP", true], ["sign-in", true]]);
    expect(asked).toHaveLength(7);
  });

  it("fails receipt keys when rooms can't publish them, as without RECEIPT_SIGNING_KEY", async () => {
    vi.useFakeTimers();
    try {
      answers({ "https://rooms.zaisma.com/.well-known/receipt-jwks.json": Response.json({ error: { code: "receipts_unavailable" } }, { status: 503 }) });
      const running = runWatchChecks();
      await vi.advanceTimersByTimeAsync(10_000);
      expect((await running).find((result: { name: string }) => result.name === "receipt keys")).toMatchObject({ isPass: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails a check after a second try, naming it and its answer", async () => {
    vi.useFakeTimers();
    try {
      const asked = answers({ "https://rooms.zaisma.com/.well-known/jwks.json": new Response("bad gateway", { status: 502 }), "https://zaisma.com/signin": new Response("down", { status: 502 }) });
      const running = runWatchChecks();
      await vi.advanceTimersByTimeAsync(10_000);
      const results = await running;
      expect(results.filter((result: { isPass: boolean }) => !result.isPass).map((result: { note: string }) => result.note)).toEqual(["rooms 502 bad gateway", "sign-in 502 down"]);
      expect(asked.filter((line) => line.endsWith("/.well-known/jwks.json"))).toHaveLength(2);
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

describe("checkCloudflareAccount", () => {
  const API = "https://api.cloudflare.com/client/v4";
  const account = { accountId: "account-1", token: "outside-token" };
  type Lists = { members: object[]; accountTokens: object[]; userTokens: object[]; audit: object[]; failing?: string };
  const stubCloudflare = (lists: Lists) => {
    const asked: string[] = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      asked.push(url.pathname);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer outside-token");
      if (lists.failing && url.pathname.endsWith(lists.failing)) return new Response("no", { status: 403 });
      const result =
        url.pathname === "/client/v4/accounts/account-1/members" ? lists.members
        : url.pathname === "/client/v4/accounts/account-1/tokens" ? lists.accountTokens
        : url.pathname === "/client/v4/user/tokens" ? lists.userTokens
        : url.pathname === "/client/v4/accounts/account-1/logs/audit" ? lists.audit
        : null;
      if (!result) throw new Error(`unexpected fetch ${url}`);
      return Response.json({ success: true, result, result_info: { page: 1, total_pages: 1 } });
    };
    return { asked, fetchImpl };
  };
  const member = { id: "member-1", status: "accepted", user: { email: "julius@example.com" } };
  const known = { cloudflareItemIds: { member: ["member-1"], account_token: ["token-1"], user_token: [] }, cloudflareCheckedAtMs: NOW_MS - 5 * MINUTE_MS };

  it("takes the first read as the baseline and pushes nothing", async () => {
    const { asked, fetchImpl } = stubCloudflare({ members: [member], accountTokens: [{ id: "token-1", name: "ship" }], userTokens: [], audit: [] });
    const check = await checkCloudflareAccount(emptyWatchState(), account, NOW_MS, fetchImpl);
    expect(check).toEqual({ cloudflareItemIds: { member: ["member-1"], account_token: ["token-1"], user_token: [] }, checkedAtMs: NOW_MS, pushes: [], failedNotes: [] });
    expect(asked).not.toContain("/client/v4/accounts/account-1/logs/audit");
  });

  it("pushes a new account token at the emergency priority, with who made it and from where", async () => {
    const audit = [{ action: { type: "create" }, actor: { email: "stranger@example.com", ip_address: "203.0.113.9" }, resource: { id: "token-2", type: "token" } }];
    const { fetchImpl } = stubCloudflare({ members: [member], accountTokens: [{ id: "token-1", name: "ship" }, { id: "token-2", name: "backdoor", issued_on: "2026-10-19T11:58:00Z" }], userTokens: [], audit });
    const check = await checkCloudflareAccount(known, account, NOW_MS, fetchImpl);
    expect(check.pushes).toEqual([
      {
        title: "New on Cloudflare: backdoor",
        message: "A new API token on Zaisma's Cloudflare account: backdoor, made 2026-10-19 11:58 UTC. Made by stranger@example.com from 203.0.113.9. If this wasn't you or Gleb, remove it now: https://dash.cloudflare.com/account-1/api-tokens",
        priority: 2,
      },
    ]);
    expect(check.cloudflareItemIds.account_token).toEqual(["token-1", "token-2"]);
  });

  it("says so when the audit log doesn't show a new user token", async () => {
    const { fetchImpl } = stubCloudflare({ members: [member], accountTokens: [{ id: "token-1", name: "ship" }], userTokens: [{ id: "user-token-1", name: "laptop" }], audit: [] });
    const check = await checkCloudflareAccount(known, account, NOW_MS, fetchImpl);
    expect(check.pushes.map((push: { message: string }) => push.message)).toEqual([
      "A new API token on Julius's Cloudflare profile: laptop. The audit log doesn't show who made it. If this wasn't you or Gleb, remove it now: https://dash.cloudflare.com/profile/api-tokens",
    ]);
  });

  it("pushes nothing for a removed member", async () => {
    const { fetchImpl } = stubCloudflare({ members: [], accountTokens: [{ id: "token-1", name: "ship" }], userTokens: [], audit: [] });
    const check = await checkCloudflareAccount(known, account, NOW_MS, fetchImpl);
    expect(check.pushes).toEqual([]);
    expect(check.cloudflareItemIds.member).toEqual([]);
  });

  it("notes a list it can't read and keeps that list's ids", async () => {
    const { fetchImpl } = stubCloudflare({ members: [member], accountTokens: [], userTokens: [], audit: [], failing: "/accounts/account-1/tokens" });
    const check = await checkCloudflareAccount(known, account, NOW_MS, fetchImpl);
    expect(check.failedNotes).toEqual(["Cloudflare watch can't read account API tokens: answered 403"]);
    expect(check.cloudflareItemIds.account_token).toEqual(["token-1"]);
    expect(check.pushes).toEqual([]);
  });

  it("pushes 10 one by one and the rest in one more", async () => {
    const userTokens = Array.from({ length: 12 }, (_, index) => ({ id: `user-token-${index}`, name: `token ${index}` }));
    const { fetchImpl } = stubCloudflare({ members: [member], accountTokens: [{ id: "token-1", name: "ship" }], userTokens, audit: [] });
    const check = await checkCloudflareAccount(known, account, NOW_MS, fetchImpl);
    expect(check.pushes).toHaveLength(CLOUDFLARE_WATCH_MAXIMUM_PUSH_COUNT + 1);
    expect(check.pushes.at(-1)).toEqual({ title: "2 more new keys and members", message: "2 more new items on Cloudflare weren't sent one by one. If they weren't you or Gleb, look now: https://dash.cloudflare.com/profile/api-tokens", priority: 2 });
  });
});
