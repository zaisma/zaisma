import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { AREA_ACCESS_BY_LEVEL, AREA_ACCESS_CHOICES, ACCESS_AREAS, checkKeyScope, createAccount, createApiKey, keyAccess, type AreaAccess, type KeyScope } from "@zaisma/core";
import { API_ROUTES } from "../../apps/site/src/developer.ts";
import { TOOLS } from "../../apps/site/src/mcp.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";
import { letPublish } from "../helpers.ts";

/** Scoped API keys (docs/DECISIONS.md, "Developers hold the keys"): limited to some games, and to a level or a choice per area. */

const SITE = "https://zaisma.test";
let full = "";
let nextId = 1;

const keyFor = async (scope: KeyScope) => (await createApiKey(env.DB, "dev-1", "scoped", scope)).token;

/** Call the developer API; every refusal must have the error's shape, a listed code and that code's HTTP status. */
async function api(path: string, key: string, init: { method?: string; body?: unknown } = {}) {
  const res = await SELF.fetch(`${SITE}/api/dev${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { authorization: `Bearer ${key}`, ...(init.body ? { "content-type": "application/json", origin: SITE } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const answer = (await res.json()) as any;
  if (!res.ok) expect(errorProblems(answer, res.status)).toEqual([]);
  return { status: res.status, answer, code: answer.error?.code as string | undefined };
}

async function tool(name: string, args: Record<string, unknown>, key: string): Promise<any> {
  const response = await SELF.fetch(`${SITE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${key}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }),
  });
  const { result } = (await response.json()) as { result: { isError?: boolean; structuredContent?: any } };
  if (result.isError) {
    expect(errorProblems(result.structuredContent)).toEqual([]);
    return result.structuredContent;
  }
  expect(schemaProblems(TOOLS.find((candidate) => candidate.name === name)!.outputSchema!, result.structuredContent, name)).toEqual([]);
  return result.structuredContent;
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;");
  await createAccount(env.DB, { id: "dev-1", username: "Pixel_Smith", ageBand: "18+" });
  await letPublish(env.DB, "dev-1");
  full = (await createApiKey(env.DB, "dev-1", "laptop")).token;
  for (const slug of ["sky-hopper", "cave-run"]) expect((await api("/games", full, { body: { title: slug.replace("-", " "), slug } })).status).toBe(201);
});

describe("levels and areas", () => {
  it("give each level more than the one before, and read and upload keys can't post", () => {
    const levels = ["read", "upload", "publish", "full"] as const;
    for (const [i, level] of levels.entries()) {
      if (i === 0) continue;
      for (const area of ACCESS_AREAS) {
        const choices: readonly string[] = AREA_ACCESS_CHOICES[area];
        expect(choices.indexOf(AREA_ACCESS_BY_LEVEL[level][area])).toBeGreaterThanOrEqual(choices.indexOf(AREA_ACCESS_BY_LEVEL[levels[i - 1]!][area]));
      }
    }
    expect(AREA_ACCESS_BY_LEVEL.read.forum_access).toBe("read");
    expect(AREA_ACCESS_BY_LEVEL.upload.forum_access).toBe("read");
    expect(AREA_ACCESS_BY_LEVEL.publish.forum_access).toBe("write");
  });

  it("name an area and choice for every call, from that area's choices", () => {
    for (const apiRoute of API_ROUTES) {
      if (apiRoute.area === null) continue;
      expect(AREA_ACCESS_CHOICES[apiRoute.area] as readonly string[], `${apiRoute.method} ${apiRoute.path}`).toContain(apiRoute.choice);
    }
    // Only the key's own access, the account's activity (a full key, checked apart), the game check (it reads only what it's sent) and public profiles are open to any key.
    expect(API_ROUTES.filter((apiRoute) => apiRoute.area === null).map((apiRoute) => apiRoute.path)).toEqual(["/access", "/activity", "/api-keys", "/check", "/players/:player_id"]);
  });

  it("checks what a new key asks for", () => {
    const custom: AreaAccess = { ...AREA_ACCESS_BY_LEVEL.read, database_access: "none" };
    expect(checkKeyScope({ accessLevel: "upload", gameSlugs: null })).toBeNull();
    expect(checkKeyScope({ accessLevel: "custom", areaAccess: custom, gameSlugs: null })).toBeNull();
    expect(checkKeyScope({ accessLevel: "owner" as never, gameSlugs: null })).toMatch(/Choose/);
    expect(checkKeyScope({ accessLevel: "custom", gameSlugs: null })).toMatch(/each area/);
    expect(checkKeyScope({ accessLevel: "custom", areaAccess: { ...custom, version_access: "none" as never }, gameSlugs: null })).toMatch(/each area/);
    expect(checkKeyScope({ accessLevel: "read", gameSlugs: [] })).toMatch(/at least one game/);
    // Sign-in apps, webhooks and credit belong to the whole account.
    expect(checkKeyScope({ accessLevel: "custom", areaAccess: custom, gameSlugs: ["sky-hopper"] })).toMatch(/whole account/);
    expect(checkKeyScope({ accessLevel: "custom", areaAccess: { ...custom, sign_in_app_access: "none", webhook_access: "none" }, gameSlugs: ["sky-hopper"] })).toMatch(/whole account/);
    expect(checkKeyScope({ accessLevel: "custom", areaAccess: { ...custom, sign_in_app_access: "none", webhook_access: "none", credit_access: "none" }, gameSlugs: ["sky-hopper"] })).toBeNull();
  });

  it("read a custom key made before an area existed as that area's least", () => {
    const access = keyAccess({ id: "old", name: "old", access_level: "custom", area_access: JSON.stringify({ game_access: "write", forum_access: "read" }), game_slugs: null });
    expect(access.areaAccess).toEqual({ game_access: "write", version_access: "read", stats_access: "none", database_access: "none", save_access: "none", purchase_access: "none", forum_access: "read", sign_in_app_access: "none", webhook_access: "none", credit_access: "none" });
  });

  it("keep keys made before scopes doing everything", async () => {
    const { answer } = await api("/access", full);
    expect(answer).toEqual({ access: { api_key_name: "laptop", api_key_ends_at: null, access_level: "full", area_access: AREA_ACCESS_BY_LEVEL.full, game_slugs: null }, can_publish: true, credit_balance_cents: 0, plan: "free" });
  });
});

describe("a read key", () => {
  it("reads games, versions, stats and the forum, and changes nothing", async () => {
    const key = await keyFor({ accessLevel: "read", gameSlugs: null });
    expect((await api("/games", key)).answer.games).toHaveLength(2);
    expect((await api("/games/sky-hopper", key)).status).toBe(200);
    expect((await api("/games/sky-hopper/stats", key)).status).toBe(200);
    expect((await api("/forum", key)).status).toBe(200);
    expect((await api("/webhooks", key)).status).toBe(200);

    const refused = await api("/games/sky-hopper", key, { method: "PATCH", body: { title: "Sky Hopper 2" } });
    expect(refused.status).toBe(403);
    expect(refused.answer.error).toMatchObject({ code: "key_not_allowed", message: expect.stringContaining("game_access write"), fix: expect.stringContaining("get_access") });
    expect((await api("/games/sky-hopper/uploads", key, { body: { files: [] } })).code).toBe("key_not_allowed");
    expect((await api("/forum", key, { body: { kind: "question", title: "How do rooms work?", text_markdown: "?" } })).code).toBe("key_not_allowed");
    expect((await api("/games", key, { body: { title: "New one" } })).code).toBe("key_not_allowed");
    // Nothing changed.
    expect((await api("/games/sky-hopper", full)).answer.game.title).toBe("sky hopper");
  });
});

describe("an upload key", () => {
  it("uploads versions but can't publish them, change games or post", async () => {
    const key = await keyFor({ accessLevel: "upload", gameSlugs: null });
    const upload = await tool("upload_files", { slug: "sky-hopper", files: [{ path: "index.html", content_text: "<!doctype html><p>hi</p>" }] }, key);
    expect(upload.version.id).toMatch(/^version_/);
    const publish = await tool("publish_version", { slug: "sky-hopper", version_id: upload.version.id }, key);
    expect(publish.error.code).toBe("key_not_allowed");
    expect((await tool("update_game", { slug: "sky-hopper", visibility: "listed" }, key)).error.code).toBe("key_not_allowed");
    expect((await tool("post_topic", { kind: "question", title: "Upload question", text_markdown: "How big can a game be?", category: "servers" }, key)).error.code).toBe("key_not_allowed");
    // A publish key gets past the key check (the version is still being scanned, so the publish waits for that instead).
    const publishKey = await keyFor({ accessLevel: "publish", gameSlugs: null });
    expect((await tool("publish_version", { slug: "sky-hopper", version_id: upload.version.id }, publishKey)).error?.code).not.toBe("key_not_allowed");
  });

  it("can't make a version that goes live by itself, which a publish key can", async () => {
    const files = [{ path: "index.html", content_text: "<!doctype html><p>hi</p>" }];
    const versionCount = async () => (await env.DB.prepare("SELECT COUNT(*) AS version_count FROM versions").first<{ version_count: number }>())!.version_count;
    const key = await keyFor({ accessLevel: "upload", gameSlugs: null });
    const refused = await tool("upload_files", { slug: "sky-hopper", files, publish_when_approved: true }, key);
    expect(refused.error).toMatchObject({ code: "key_not_allowed", field: "publish_when_approved", message: expect.stringContaining("version_access publish"), fix: expect.stringContaining("Leave publish_when_approved out") });
    // The upload command's --publish-when-approved sends the same call.
    const listed = await api("/games/sky-hopper/uploads", key, { body: { files: [{ path: "index.html", sha256: "0".repeat(64), size_bytes: 1 }] } });
    expect(listed.status).toBe(200);
    expect((await api("/games/sky-hopper/versions", key, { body: { files: [{ path: "index.html", sha256: "0".repeat(64), size_bytes: 1 }], publish_when_approved: true } })).answer.error).toMatchObject({ code: "key_not_allowed", field: "publish_when_approved" });
    expect(await versionCount()).toBe(0);
    // Left out, it's a draft as before.
    expect((await tool("upload_files", { slug: "sky-hopper", files, publish_when_approved: false }, key)).version.id).toMatch(/^version_/);

    const publishKey = await keyFor({ accessLevel: "publish", gameSlugs: null });
    const live = await tool("upload_files", { slug: "sky-hopper", files, publish_when_approved: true }, publishKey);
    const row = await env.DB.prepare("SELECT publish_when_approved_enabled FROM versions WHERE id = ?").bind(live.version.id).first<{ publish_when_approved_enabled: number }>();
    expect(row!.publish_when_approved_enabled).toBe(1);
    expect(await versionCount()).toBe(2);
  });
});

describe("a key for some games", () => {
  it("sees and changes only those, and can't make games or reach the account's areas", async () => {
    const key = await keyFor({ accessLevel: "full", gameSlugs: ["sky-hopper"] });
    expect((await api("/games", key)).answer.games.map((game: { slug: string }) => game.slug)).toEqual(["sky-hopper"]);
    expect((await api("/games/sky-hopper", key, { method: "PATCH", body: { description: "Hop!" } })).status).toBe(200);

    const other = await api("/games/cave-run", key);
    expect(other.status).toBe(403);
    expect(other.answer.error).toMatchObject({ code: "key_not_allowed", field: "slug" });
    expect((await api("/games", key, { body: { title: "New one" } })).code).toBe("key_not_allowed");
    expect((await api("/webhooks", key)).code).toBe("key_not_allowed");
    expect((await api("/sign-in-apps", key)).code).toBe("key_not_allowed");

    const access = await tool("get_access", {}, key);
    expect(access.access).toEqual({
      api_key_name: "scoped",
      api_key_ends_at: null,
      access_level: "full",
      area_access: { ...AREA_ACCESS_BY_LEVEL.full, sign_in_app_access: "none", webhook_access: "none", credit_access: "none" },
      game_slugs: ["sky-hopper"],
    });
  });
});

describe("a custom key", () => {
  it("does what each area allows", async () => {
    const key = await keyFor({ accessLevel: "custom", areaAccess: { game_access: "read", version_access: "read", stats_access: "read", database_access: "none", save_access: "none", purchase_access: "none", forum_access: "none", sign_in_app_access: "none", webhook_access: "none", credit_access: "none" }, gameSlugs: null });
    expect((await api("/games/sky-hopper/stats", key)).status).toBe(200);
    expect((await api("/games/sky-hopper/database", key)).code).toBe("key_not_allowed");
    expect((await api("/games/sky-hopper/saves", key)).code).toBe("key_not_allowed");
    expect((await api("/games/sky-hopper/saves", full)).status).toBe(200);
    // A publish key reads saves but can't change them.
    const publishKey = await keyFor({ accessLevel: "publish", gameSlugs: null });
    expect((await api("/games/sky-hopper/saves/player_nobody", publishKey, { method: "DELETE" })).code).toBe("key_not_allowed");
    expect((await api("/forum", key)).code).toBe("key_not_allowed");
    expect((await tool("get_access", {}, key)).access.access_level).toBe("custom");
    // Public profiles are open to any key.
    expect((await api("/players/player_nobody", key)).code).toBe("no_player");
  });
});
