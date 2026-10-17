import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createAccount, createApiKey, gameBySlug, SECRET_LIMITS } from "@zaisma/core";
import { TOOLS } from "../../apps/site/src/mcp.ts";
import { GAME, SECRET } from "../../apps/site/src/schemas.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";

// Game server reach and secrets through the developer API and MCP: the hosts a game's server can call
// (game_server_allowed_hosts on the game) and its secrets (apps/site/src/secrets-api.ts), kept in the
// rooms Worker's secrets object (reached here through the GAME_SECRETS service binding) and never answered again.

const SITE = "https://zaisma.test";
let token = "";
let nextId = 1;

async function api(path: string, init: { method?: string; body?: unknown; key?: string } = {}) {
  const res = await SELF.fetch(`${SITE}/api/dev${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { authorization: `Bearer ${init.key ?? token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const answer = JSON.parse(text) as any;
  if (!res.ok) expect(errorProblems(answer, res.status)).toEqual([]);
  return { status: res.status, answer, text };
}

async function tool(name: string, toolArguments: Record<string, unknown>): Promise<any> {
  const res = await SELF.fetch(`${SITE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: toolArguments } }),
  });
  const { result } = (await res.json()) as any;
  if (result.isError) {
    expect(errorProblems(result.structuredContent)).toEqual([]);
    return result.structuredContent;
  }
  expect(schemaProblems(TOOLS.find((candidate) => candidate.name === name)!.outputSchema!, result.structuredContent, name)).toEqual([]);
  return result.structuredContent;
}

const history = async () => (await api("/games/sky-hopper/history")).answer.events.map((event: { description: string }) => event.description);

beforeEach(async () => {
  await env.DB.exec("DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;");
  await createAccount(env.DB, { id: "dev-1", username: "Pixel_Smith", ageBand: "18+" });
  token = (await createApiKey(env.DB, "dev-1", "claude")).token;
  // A new game each time: its secrets object starts empty.
  expect((await api("/games", { body: { title: "Sky Hopper", slug: "sky-hopper" } })).status).toBe(201);
  const game = (await gameBySlug(env.DB, "sky-hopper"))!;
  const fresh = `game_${crypto.randomUUID().replace(/-/g, "")}`;
  await env.DB.prepare("UPDATE games SET id = ? WHERE id = ?").bind(fresh, game.id).run();
  await env.DB.prepare("UPDATE audit_log SET game_id = ? WHERE game_id = ?").bind(fresh, game.id).run();
});

describe("the hosts a game's server can call", () => {
  it("are a game setting, tidied, in the game's history, and none at first", async () => {
    expect((await tool("get_game", { slug: "sky-hopper" })).game.game_server_allowed_hosts).toEqual([]);
    const changed = await tool("update_game", { slug: "sky-hopper", game_server_allowed_hosts: ["Discord.com", "api.github.com", "discord.com", "*.cdn.skyhopper.io"] });
    expect(schemaProblems(GAME, changed.game)).toEqual([]);
    expect(changed.game.game_server_allowed_hosts).toEqual(["discord.com", "api.github.com", "*.cdn.skyhopper.io"]);
    expect((await gameBySlug(env.DB, "sky-hopper"))!.game_server_allowed_hosts).toBe('["discord.com","api.github.com","*.cdn.skyhopper.io"]');
    expect(await history()).toContain("Changed which other servers the game server can call");
    expect((await tool("update_game", { slug: "sky-hopper", game_server_allowed_hosts: [] })).game.game_server_allowed_hosts).toEqual([]);
  });

  it("refuses addresses, IP addresses, Zaisma's own domains and too many, saying what to give", async () => {
    for (const hosts of [["https://discord.com/api"], ["discord.com:443"], ["203.0.113.9"], ["localhost"], ["zaisma.com"], ["rooms.zaisma.com"], ["*.zaismausercontent.com"], ["*"], ["*.com"], ["not a host"], "discord.com", Array.from({ length: 21 }, (_, i) => `api${i}.example.com`)]) {
      const refused = await api("/games/sky-hopper", { method: "PATCH", body: { game_server_allowed_hosts: hosts } });
      expect(refused.status, JSON.stringify(hosts)).toBe(400);
      expect(refused.answer.error).toMatchObject({ code: "bad_game_server_allowed_hosts", field: "game_server_allowed_hosts" });
    }
    expect((await gameBySlug(env.DB, "sky-hopper"))!.game_server_allowed_hosts).toBe("[]");
  });
});

describe("a game's secrets", () => {
  it("are set, listed by name and deleted, and their values are never answered", async () => {
    expect(await tool("list_secrets", { slug: "sky-hopper" })).toEqual({ secrets: [] });
    const set = await tool("set_secret", { slug: "sky-hopper", secret_name: "DISCORD_WEBHOOK_URL", secret_value: "https://discord.com/api/webhooks/1/very-secret" });
    expect(schemaProblems(SECRET, set.secret)).toEqual([]);
    expect(set.secret.name).toBe("DISCORD_WEBHOOK_URL");
    // The game server calls nothing yet, so the next step lists a host.
    expect(set.next_steps).toMatchObject([{ tool: "update_game", arguments: { slug: "sky-hopper" } }]);
    await tool("set_secret", { slug: "sky-hopper", secret_name: "API_TOKEN", secret_value: "first" });
    await tool("set_secret", { slug: "sky-hopper", secret_name: "API_TOKEN", secret_value: "second" });

    const listed = await api("/games/sky-hopper/secrets");
    expect(listed.answer.secrets.map((secret: { name: string }) => secret.name)).toEqual(["API_TOKEN", "DISCORD_WEBHOOK_URL"]);
    for (const answered of [listed.text, (await api("/games/sky-hopper")).text, (await api("/games/sky-hopper/history")).text]) {
      expect(answered).not.toContain("very-secret");
      expect(answered).not.toContain("second");
    }
    expect(await history()).toEqual(expect.arrayContaining(["Set a secret"]));
    // Running rooms read them again when this changes.
    expect((await gameBySlug(env.DB, "sky-hopper"))!.secrets_changed_at_ms).toBeGreaterThan(0);

    expect(await tool("delete_secret", { slug: "sky-hopper", secret_name: "API_TOKEN" })).toEqual({ deleted_secret_name: "API_TOKEN", next_steps: [] });
    expect((await tool("list_secrets", { slug: "sky-hopper" })).secrets.map((secret: { name: string }) => secret.name)).toEqual(["DISCORD_WEBHOOK_URL"]);
    expect((await tool("delete_secret", { slug: "sky-hopper", secret_name: "API_TOKEN" })).error).toMatchObject({ code: "no_secret", field: "secret_name" });
    expect(await history()).toContain("Deleted a secret");
  });

  it("refuses a name that isn't like an environment variable's, a value that isn't text, and more than the limit", async () => {
    expect((await api("/games/sky-hopper/secrets/discord-token", { method: "PUT", body: { secret_value: "x" } })).answer.error).toMatchObject({ code: "bad_secret_name", field: "secret_name" });
    expect((await api("/games/sky-hopper/secrets/API_TOKEN", { method: "PUT", body: { secret_value: { token: "x" } } })).answer.error).toMatchObject({ code: "bad_secret_value", field: "secret_value" });
    expect((await api("/games/sky-hopper/secrets/API_TOKEN", { method: "PUT", body: { secret_value: "" } })).answer.error).toMatchObject({ code: "bad_secret_value" });
    expect((await api("/games/sky-hopper/secrets/API_TOKEN", { method: "PUT", body: { secret_value: "x".repeat(SECRET_LIMITS.maximumValueSizeBytes + 1) } })).answer.error).toMatchObject({ code: "bad_secret_value" });
    expect((await api("/games/sky-hopper/secrets/API_TOKEN", { method: "PUT", body: { secret_value: "x", note: "y" } })).answer.error).toMatchObject({ code: "unknown_field" });

    for (let i = 0; i < SECRET_LIMITS.maximumSecretCount; i++) expect((await api(`/games/sky-hopper/secrets/SECRET_${i}`, { method: "PUT", body: { secret_value: "x" } })).status).toBe(200);
    expect((await api("/games/sky-hopper/secrets/ONE_MORE", { method: "PUT", body: { secret_value: "x" } })).answer.error).toMatchObject({ code: "too_many_secrets" });
    // Replacing one is still fine.
    expect((await api("/games/sky-hopper/secrets/SECRET_0", { method: "PUT", body: { secret_value: "y" } })).status).toBe(200);
  });

  it("are read with game read access and changed only with write", async () => {
    const readKey = (await createApiKey(env.DB, "dev-1", "ci", { accessLevel: "read", gameSlugs: null })).token;
    await tool("set_secret", { slug: "sky-hopper", secret_name: "API_TOKEN", secret_value: "x" });
    expect((await api("/games/sky-hopper/secrets", { key: readKey })).status).toBe(200);
    expect((await api("/games/sky-hopper/secrets/API_TOKEN", { method: "PUT", body: { secret_value: "y" }, key: readKey })).answer.error).toMatchObject({ code: "key_not_allowed" });
    expect((await api("/games/sky-hopper/secrets/API_TOKEN", { method: "DELETE", key: readKey })).answer.error).toMatchObject({ code: "key_not_allowed" });
    expect((await api("/games/sky-hopper", { method: "PATCH", body: { game_server_allowed_hosts: ["discord.com"] }, key: readKey })).answer.error).toMatchObject({ code: "key_not_allowed" });
  });
});
