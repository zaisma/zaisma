import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../apps/site/src/env.ts";
import { ACCOUNT_WATCH_LIMITS, compareWatchItems, watchAccounts } from "../../apps/site/src/account-watch.ts";

/** "Zaisma's own accounts are watched" (docs/DECISIONS.md in the ops repo): new members, keys, apps and tokens alert Julius. */

const MINUTE_MS = 60_000;
const NOW_MS = Date.UTC(2026, 9, 19, 12, 0, 0);
const baseEnv = { ...env, ALERT_EMAIL: undefined, PUSHOVER_USER_KEY: "user-key", PUSHOVER_APP_TOKEN: "app-token", PUSHOVER_URL: "https://pushover.test/push", GITHUB_WATCH_TOKEN: "github-token" } as unknown as Env;

type Sent = { title: string; message: string; priority: string };
let pushes: Sent[];
let alerts: string[];
let asked: string[];
let failingUrlPart: string | null;
let github: { members: object[]; outside_collaborators: object[]; invitations: object[]; installations: object[]; repos: object[]; keys: Record<string, object[]> };
let npmMaintainers: Record<string, object[]>;
let cloudflare: { members: object[]; tokens: object[]; userTokens: object[] };
let supabaseMembers: object[];

beforeEach(async () => {
  await env.DB.exec("DELETE FROM account_watch_items; DELETE FROM account_watch_kinds; DELETE FROM account_watch_failures;");
  pushes = [];
  alerts = [];
  asked = [];
  failingUrlPart = null;
  github = { members: [{ id: 1, login: "julius" }], outside_collaborators: [], invitations: [], installations: [], repos: [{ name: "zaisma" }], keys: { zaisma: [] } };
  npmMaintainers = { "@zaisma/cli": [{ name: "julius" }], "@zaisma/game-server": [{ name: "julius" }] };
  cloudflare = { members: [], tokens: [], userTokens: [] };
  supabaseMembers = [{ user_id: "user-1", user_name: "julius", role_name: "Owner" }];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    asked.push(url);
    if (url === "https://pushover.test/push") {
      const form = new URLSearchParams(String(init?.body));
      pushes.push({ title: form.get("title")!, message: form.get("message")!, priority: form.get("priority")! });
      return new Response("{}");
    }
    if (failingUrlPart && url.includes(failingUrlPart)) return new Response("nope", { status: 401 });
    const { origin, pathname } = new URL(url);
    if (origin === "https://api.github.com") {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer github-token");
      const keys = /^\/repos\/zaisma\/([^/]+)\/keys$/.exec(pathname);
      if (keys) return Response.json(github.keys[decodeURIComponent(keys[1]!)] ?? []);
      if (pathname === "/orgs/zaisma/installations") return Response.json({ total_count: github.installations.length, installations: github.installations });
      const list = { "/orgs/zaisma/members": github.members, "/orgs/zaisma/outside_collaborators": github.outside_collaborators, "/orgs/zaisma/invitations": github.invitations, "/orgs/zaisma/repos": github.repos }[pathname];
      if (list) return Response.json(list);
    }
    if (origin === "https://registry.npmjs.org") {
      if (pathname === "/-/org/zaisma/package") return Response.json(Object.fromEntries(Object.keys(npmMaintainers).map((packageName) => [packageName, "write"])));
      const packageName = decodeURIComponent(pathname.slice(1));
      if (npmMaintainers[packageName]) return Response.json({ name: packageName, maintainers: npmMaintainers[packageName] });
    }
    if (origin === "https://api.supabase.com" && pathname === "/v1/organizations/zaisma-org/members") return Response.json(supabaseMembers);
    if (origin === "https://api.cloudflare.com") {
      const result = { "/client/v4/accounts/account-1/members": cloudflare.members, "/client/v4/accounts/account-1/tokens": cloudflare.tokens, "/client/v4/user/tokens": cloudflare.userTokens }[pathname];
      if (result) return Response.json({ success: true, result, result_info: { page: 1, total_pages: 1 } });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    if (typeof line === "string" && line.startsWith("[alert] ")) alerts.push(line.slice("[alert] ".length));
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const itemIds = async (serviceName: string, itemKind: string) =>
  (await env.DB.prepare("SELECT item_id FROM account_watch_items WHERE service_name = ? AND item_kind = ? ORDER BY item_id").bind(serviceName, itemKind).all<{ item_id: string }>()).results.map((row) => row.item_id);

describe("compareWatchItems", () => {
  it("answers what's new and what's gone", () => {
    expect(compareWatchItems(["a", "b"], [{ itemId: "b" }, { itemId: "c" }])).toEqual({ newItems: [{ itemId: "c" }], goneItemIds: ["a"] });
    expect(compareWatchItems([], [{ itemId: "a" }])).toEqual({ newItems: [{ itemId: "a" }], goneItemIds: [] });
    expect(compareWatchItems(["a"], [])).toEqual({ newItems: [], goneItemIds: ["a"] });
  });
});

describe("watchAccounts", () => {
  it("takes the first read as the baseline: nothing alerts", async () => {
    await watchAccounts(baseEnv, NOW_MS);
    expect(pushes).toEqual([]);
    expect(alerts).toEqual([]);
    expect(await itemIds("github", "member")).toEqual(["1"]);
    expect(await itemIds("npm", "maintainer")).toEqual(["@zaisma/cli/julius", "@zaisma/game-server/julius"]);
  });

  it("alerts once on a new deploy key, even in a list that was empty, and not on the next run", async () => {
    await watchAccounts(baseEnv, NOW_MS);
    github.keys["zaisma"] = [{ id: 7, title: "laptop", read_only: false, created_at: "2026-10-19T11:57:00Z" }];
    await watchAccounts(baseEnv, NOW_MS + 5 * MINUTE_MS);
    expect(pushes).toEqual([
      {
        title: "New on GitHub: laptop (can write)",
        message: "A new deploy key on zaisma/zaisma: laptop (can write), made 2026-10-19 11:57 UTC. If this wasn't you or Gleb, remove it now: https://github.com/zaisma/zaisma/settings/keys",
        priority: "2",
      },
    ]);
    expect(alerts).toEqual(["New on GitHub: laptop (can write)"]);
    await watchAccounts(baseEnv, NOW_MS + 10 * MINUTE_MS);
    expect(pushes).toHaveLength(1);
    expect(alerts).toHaveLength(1);
  });

  it("deletes a removed member's row without alerting, and alerts again when they're added back", async () => {
    github.members.push({ id: 2, login: "gleb" });
    await watchAccounts(baseEnv, NOW_MS);
    github.members.pop();
    await watchAccounts(baseEnv, NOW_MS + 5 * MINUTE_MS);
    expect(await itemIds("github", "member")).toEqual(["1"]);
    expect(pushes).toEqual([]);
    github.members.push({ id: 2, login: "gleb" });
    await watchAccounts(baseEnv, NOW_MS + 10 * MINUTE_MS);
    expect(pushes.map((push) => push.title)).toEqual(["New on GitHub: gleb"]);
  });

  it("alerts on a new npm maintainer of any package in the scope", async () => {
    await watchAccounts(baseEnv, NOW_MS);
    npmMaintainers["@zaisma/game-server"]!.push({ name: "stranger" });
    await watchAccounts(baseEnv, NOW_MS + 5 * MINUTE_MS);
    expect(pushes.map((push) => push.message)).toEqual(["A new npm maintainer of @zaisma/game-server: stranger on @zaisma/game-server. If this wasn't you or Gleb, remove it now: https://www.npmjs.com/package/@zaisma/game-server/access"]);
  });

  it("sends 10 alerts one by one and the rest in one more", async () => {
    await watchAccounts(baseEnv, NOW_MS);
    github.invitations = Array.from({ length: 12 }, (_, index) => ({ id: 100 + index, login: `person${index}`, inviter: { login: "julius" } }));
    await watchAccounts(baseEnv, NOW_MS + 5 * MINUTE_MS);
    expect(pushes).toHaveLength(ACCOUNT_WATCH_LIMITS.maximumAlertCount + 1);
    expect(alerts).toHaveLength(ACCOUNT_WATCH_LIMITS.maximumAlertCount + 1);
    expect(pushes.at(-1)).toEqual({ title: "2 more new keys and members", message: "2 more new items on GitHub weren't sent one by one. If they weren't you or Gleb, look now: https://github.com/orgs/zaisma/people", priority: "2" });
    expect(await itemIds("github", "invitation")).toHaveLength(12);
  });

  it("keeps a failing list's rows, tells Julius after an hour, then not again for 24 hours, and clears on a good read", async () => {
    await watchAccounts(baseEnv, NOW_MS);
    failingUrlPart = "/orgs/zaisma/members";
    await watchAccounts(baseEnv, NOW_MS + 5 * MINUTE_MS);
    await watchAccounts(baseEnv, NOW_MS + 60 * MINUTE_MS);
    expect(pushes).toEqual([]);
    await watchAccounts(baseEnv, NOW_MS + 65 * MINUTE_MS);
    expect(pushes).toEqual([{ title: "Zaisma can't read GitHub's members", message: "Zaisma can't read GitHub's members: it answered 401, for 60 min. New ones there aren't caught until it reads again: check the watch's token.", priority: "1" }]);
    expect(alerts).toEqual(["Zaisma can't read GitHub's members"]);
    await watchAccounts(baseEnv, NOW_MS + 24 * 60 * MINUTE_MS);
    expect(pushes).toHaveLength(1);
    await watchAccounts(baseEnv, NOW_MS + (24 * 60 + 65) * MINUTE_MS);
    expect(pushes).toHaveLength(2);
    expect(await itemIds("github", "member")).toEqual(["1"]);

    failingUrlPart = null;
    await watchAccounts(baseEnv, NOW_MS + (24 * 60 + 70) * MINUTE_MS);
    expect(await env.DB.prepare("SELECT COUNT(*) AS row_count FROM account_watch_failures").first("row_count")).toBe(0);
    expect(pushes).toHaveLength(2);
  });

  it("emails a new Cloudflare token and never pushes it: the outside checker does", async () => {
    const cloudflareEnv = { ...baseEnv, CLOUDFLARE_WATCH_TOKEN: "cloudflare-token", CLOUDFLARE_ACCOUNT_ID: "account-1" } as Env;
    await watchAccounts(cloudflareEnv, NOW_MS);
    cloudflare.tokens.push({ id: "token-9", name: "backdoor", issued_on: "2026-10-19T12:01:00Z" });
    await watchAccounts(cloudflareEnv, NOW_MS + 5 * MINUTE_MS);
    expect(alerts).toEqual(["New on Cloudflare: backdoor"]);
    expect(pushes).toEqual([]);
  });

  it("watches Supabase's members with its token and slug", async () => {
    const supabaseEnv = { ...baseEnv, SUPABASE_WATCH_TOKEN: "supabase-token", SUPABASE_ORGANIZATION_SLUG: "zaisma-org" } as Env;
    await watchAccounts(supabaseEnv, NOW_MS);
    supabaseMembers.push({ user_id: "user-2", email: "stranger@example.com", role_name: "Administrator" });
    await watchAccounts(supabaseEnv, NOW_MS + 5 * MINUTE_MS);
    expect(pushes.map((push) => push.message)).toEqual(["A new member of Zaisma's Supabase organization: stranger@example.com (Administrator). If this wasn't you or Gleb, remove it now: https://supabase.com/dashboard/org/zaisma-org/team"]);
  });

  it("skips a service with no token: no request goes to it", async () => {
    await watchAccounts({ ...baseEnv, GITHUB_WATCH_TOKEN: undefined } as Env, NOW_MS);
    expect(asked.some((url) => url.startsWith("https://api.github.com"))).toBe(false);
    expect(asked.some((url) => url.startsWith("https://api.cloudflare.com") || url.startsWith("https://api.supabase.com"))).toBe(false);
    expect(await env.DB.prepare("SELECT COUNT(*) AS row_count FROM account_watch_failures").first("row_count")).toBe(0);
  });
});
