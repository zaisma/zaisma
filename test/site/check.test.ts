import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createAccount, createApiKey } from "@zaisma/core";
import { TOOLS } from "../../apps/site/src/mcp.ts";
import { GAME_CHECK } from "../../apps/site/src/schemas.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";
import { letPublish } from "../helpers.ts";

// The game check through the developer API and MCP (apps/site/src/check-api.ts): the same check as
// zaisma check (packages/cli/check.mjs), on files sent as text and sizes, keeping nothing.

const SITE = "https://zaisma.test";
let token = "";
let nextId = 1;

async function api(path: string, init: { method?: string; body?: unknown; key?: string } = {}) {
  const res = await SELF.fetch(`${SITE}/api/dev${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { authorization: `Bearer ${init.key ?? token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const answer = (await res.json()) as any;
  if (!res.ok) expect(errorProblems(answer, res.status)).toEqual([]);
  return { status: res.status, answer };
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

const html = '<!doctype html><script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script><script>new WebSocket("wss://play.example.com/room"); alert("Game over")</script>';

beforeEach(async () => {
  await env.DB.exec("DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;");
  await createAccount(env.DB, { id: "dev-1", username: "Pixel_Smith", ageBand: "18+" });
  await createAccount(env.DB, { id: "dev-2", username: "Other_Dev", ageBand: "18+" });
  await letPublish(env.DB, "dev-1");
  token = (await createApiKey(env.DB, "dev-1", "claude")).token;
  expect((await api("/games", { body: { title: "Sky Hopper", slug: "sky-hopper" } })).status).toBe(201);
});

describe("the game check", () => {
  it("answers what Zaisma would refuse and what won't work, for any key, before publishing opens", async () => {
    const readToken = (await createApiKey(env.DB, "dev-2", "read", { accessLevel: "read", gameSlugs: null })).token;
    const { status, answer } = await api("/check", { key: readToken, body: { files: [{ path: "index.html", size_bytes: html.length, content_text: html }, { path: "Build/game.wasm.gz", size_bytes: 1000 }] } });
    expect(status).toBe(200);
    expect(schemaProblems(GAME_CHECK, answer)).toEqual([]);
    expect(answer).toMatchObject({ file_count: 2, size_bytes: html.length + 1000, omitted_problem_count: 0 });
    expect(answer.problems.map((problem: { code: string }) => problem.code)).toEqual(["precompressed_file", "outside_file", "outside_address", "browser_dialog"]);
    expect(answer.problems[2].message).toContain("which works only if it's one of the game's own servers");
  });

  it("counts a game's own servers when it names one of the developer's games, and refuses another's", async () => {
    expect((await api("/games/sky-hopper", { method: "PATCH", body: { own_server_urls: ["wss://play.example.com"] } })).status).toBe(200);
    const { answer } = await api("/check", { body: { files: [{ path: "index.html", size_bytes: html.length, content_text: html }], slug: "sky-hopper" } });
    expect(answer.problems.map((problem: { code: string }) => problem.code)).toEqual(["outside_file", "browser_dialog"]);
    const otherToken = (await createApiKey(env.DB, "dev-2", "other")).token;
    const refused = await api("/check", { key: otherToken, body: { files: [{ path: "index.html", size_bytes: 15, content_text: "<!doctype html>" }], slug: "sky-hopper" } });
    expect(refused.answer.error).toMatchObject({ code: "no_game", field: "slug" });
  });

  it("refuses files in a shape it doesn't take", async () => {
    const send = async (files: unknown) => (await api("/check", { body: { files } })).answer.error;
    expect(await send([])).toMatchObject({ code: "bad_files", field: "files" });
    expect(await send([{ path: "index.html", size_bytes: 10 }])).toMatchObject({ code: "bad_files", field: "files[0].content_text" });
    expect(await send([{ path: "hero.png", size_bytes: 10, content_text: "x" }])).toMatchObject({ code: "bad_files", field: "files[0].content_text" });
    expect(await send([{ path: "index.html", size_bytes: 10, content_text: "x", sha256: "abc" }])).toMatchObject({ code: "unknown_field", field: "files[0].sha256" });
    expect(await send([{ path: "index.html", content_text: "x" }])).toMatchObject({ code: "bad_files", field: "files[0]" });
  });

  it("is the MCP's check_game, with upload_files' files", async () => {
    const answer = await tool("check_game", { files: [{ path: "index.html", content_text: html }, { path: "assets/hero.png", content_base64: "iVBORw0KGgoAAAANSUhEUg==" }, { path: "setup.exe", content_base64: "TVo=" }] });
    expect(answer).toMatchObject({ file_count: 3, size_bytes: html.length + 16 + 2 });
    expect(answer.problems.map((problem: { code: string }) => problem.code)).toEqual(["file_type_not_allowed", "outside_file", "outside_address", "browser_dialog"]);
    const slugged = await tool("check_game", { slug: "sky-hopper", files: [{ path: "index.html", content_text: '<a href="https://example.com">Site</a>' }] });
    expect(slugged.problems[0].fix).toContain("zaisma links set sky-hopper");
    const tooBig = await tool("check_game", { files: [{ path: "index.html", content_text: "x".repeat(5 * 1024 * 1024 + 1) }] });
    expect(tooBig.error).toMatchObject({ code: "too_big_for_mcp", field: "files" });
    expect(tooBig.error.fix).toContain("npx @zaisma/cli check <folder>");
  });
});
