import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { audit, createAccount, createApiKey, createReport, gameBySlug, notConnected, type ImageMatcher } from "@zaisma/core";
import { scanVersion, type ScanDeps } from "../../apps/site/src/scan.ts";

const SITE = "https://zaisma.test";
const testEnv = { ...env, ANTHROPIC_API_KEY: "test-key" };
const connected: ImageMatcher = { check: async (imgs) => ({ provider: "test", connected: true, checked: imgs.length, findings: [] }) };
const pass: ScanDeps = {
  images: connected,
  ai: async () => ({ report: { model: "test", verdict: "pass", summary: "fine", inputTokens: 10, outputTokens: 1 }, findings: [], childSafety: false }),
};

let token = "";
let other = "";
let nextId = 1;

async function rpc(body: unknown, key: string | null = token) {
  return SELF.fetch(`${SITE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  });
}

/** Call a tool; returns its result as data, or { error } when the tool said no. */
async function tool(name: string, args: Record<string, unknown> = {}, key = token): Promise<any> {
  const res = await rpc({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }, key);
  expect(res.status).toBe(200);
  const { result } = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean; structuredContent?: unknown } };
  return result.isError ? { error: result.content[0]!.text } : result.structuredContent;
}

/** Scan with everything connected, so it passes. */
async function passScan(id: string) {
  return scanVersion(testEnv, id, pass);
}

beforeEach(async () => {
  await env.DB.exec(
    "DELETE FROM reports; DELETE FROM room_usage; DELETE FROM blobs; DELETE FROM game_images; DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;",
  );
  await createAccount(env.DB, { id: "dev-1", name: "Pixel Smith", ageBand: "18+" });
  await createAccount(env.DB, { id: "dev-2", name: "Other Dev", ageBand: "18+" });
  token = (await createApiKey(env.DB, "dev-1", "claude")).token;
  other = (await createApiKey(env.DB, "dev-2", "claude")).token;
});

describe("the MCP protocol", () => {
  it("needs an API key", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, null);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Bearer");
    expect((await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, "zsk_nope")).status).toBe(401);
    expect((await SELF.fetch(`${SITE}/mcp`)).status).toBe(405);
  });

  it("starts up and lists its tools", async () => {
    const init = (await (await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } })).json()) as any;
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.serverInfo.name).toBe("zaisma");
    expect(init.result.instructions).toContain("npx @zaisma/cli upload");
    expect((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);

    const list = (await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json()) as any;
    const names = list.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(["list_games", "create_game", "upload_files", "publish_version", "get_reports", "get_stats", "get_history"]));
    for (const t of list.result.tools) expect(t.inputSchema.type).toBe("object");

    const batch = (await (await rpc([{ jsonrpc: "2.0", id: 3, method: "ping" }, { jsonrpc: "2.0", id: 4, method: "nope" }])).json()) as any[];
    expect(batch[0].result).toEqual({});
    expect(batch[1].error.code).toBe(-32601);
  });
});

describe("publishing a game through the MCP", () => {
  it("makes, uploads, previews, publishes and rolls back", async () => {
    const { game } = await tool("create_game", { title: "Tiny Jump", description: "Jump.", devices: ["phone"] });
    expect(game).toMatchObject({ slug: "tiny-jump", visibility: "draft", devices: ["phone"] });

    const first = await tool("upload_files", { slug: "tiny-jump", files: [{ path: "index.html", text: "<!doctype html><p>v1</p>" }, { path: "pic.png", base64: btoa("not really a png") }], notes: "First." });
    expect(first.sent).toBe(2);
    // Held first (image matching isn't connected), so its history shows what Zaisma did; then it passes.
    await scanVersion(testEnv, first.version.id, { ...pass, images: notConnected });
    await passScan(first.version.id);
    const checked = await tool("get_version", { slug: "tiny-jump", version_id: first.version.id });
    expect(checked.version.scan).toBe("approved");
    expect(checked.version.preview_url).toContain("tiny-jump--");

    await tool("publish_version", { slug: "tiny-jump", version_id: first.version.id });
    const second = await tool("upload_files", { slug: "tiny-jump", files: [{ path: "index.html", text: "<!doctype html><p>v2</p>" }, { path: "pic.png", base64: btoa("not really a png") }] });
    expect(second.sent).toBe(1);
    await passScan(second.version.id);

    await tool("publish_version", { slug: "tiny-jump", version_id: second.version.id });
    const back = await tool("publish_version", { slug: "tiny-jump", version_id: first.version.id });
    expect(back.version.live).toBe(true);
    expect((await gameBySlug(env.DB, "tiny-jump"))!.current_version_id).toBe(first.version.id);

    const { history } = await tool("get_history", { slug: "tiny-jump" });
    expect(history[0]).toMatchObject({ what: "Rolled back to an earlier version", version: first.version.id, by: "you" });
    expect(history).toContainEqual(expect.objectContaining({ what: expect.stringContaining("held"), version: first.version.id, by: "Zaisma" }));
  });

  it("asks before hiding a game players can play", async () => {
    await tool("create_game", { title: "Hop" });
    const up = await tool("upload_files", { slug: "hop", files: [{ path: "index.html", text: "<p>hop</p>" }] });
    await passScan(up.version.id);
    await tool("publish_version", { slug: "hop", version_id: up.version.id });
    await tool("update_game", { slug: "hop", visibility: "listed" });

    const asked = await tool("update_game", { slug: "hop", visibility: "private" });
    expect(asked.error).toContain("confirm");
    expect((await gameBySlug(env.DB, "hop"))!.visibility).toBe("listed");
    expect((await tool("update_game", { slug: "hop", visibility: "private", confirm: true })).game.visibility).toBe("private");
  });

  it("explains what it can't do", async () => {
    await tool("create_game", { title: "Hop" });
    expect((await tool("upload_files", { slug: "hop", files: [{ path: "game.js", text: "1" }] })).error).toContain("index.html");
    expect((await tool("upload_files", { slug: "hop", files: [{ path: "index.html", text: "x".repeat(5 * 1024 * 1024 + 1) }] })).error).toContain("npx @zaisma/cli upload");
    expect((await tool("get_game", { slug: "hop" }, other)).error).toContain("You don't have a game");
  });
});

describe("reports, stats and history", () => {
  it("shows reports by reason, never child-safety ones", async () => {
    await tool("create_game", { title: "Hop" });
    const game = (await gameBySlug(env.DB, "hop"))!;
    await createReport(env.DB, { gameId: game.id, reason: "broken", details: "Stuck on level 2" });
    await createReport(env.DB, { gameId: game.id, reason: "hate", details: "slur in the chat" });
    await createReport(env.DB, { gameId: game.id, reason: "child_safety", details: "secret" });
    // Bug reports reach the developer once report triage sorts them as bugs. One sorted as child safety never does.
    await createReport(env.DB, { gameId: game.id, reason: "other", details: "a secret found by triage" });
    await env.DB.exec(`UPDATE reports SET bug = 1, bug_at = ${Date.now()} WHERE reason = 'broken'; UPDATE reports SET severity = 0, bug = 1, bug_at = ${Date.now()} WHERE reason = 'other'`);
    const out = await tool("get_reports", { slug: "hop" });
    expect(out.reasons.broken).toMatchObject({ open: 1, closed: 0 });
    expect(out.reasons.hate.open).toBe(1);
    expect(out.reasons.child_safety).toBeUndefined();
    expect(out.bug_reports).toEqual([expect.objectContaining({ said: "Stuck on level 2" })]);
    expect(JSON.stringify(out)).not.toContain("secret");
    expect(JSON.stringify(out)).not.toContain("slur");
    // Asking again with next_since gives only bug reports that arrived since.
    expect((await tool("get_reports", { slug: "hop", since: out.next_since })).bug_reports).toEqual([]);
  });

  it("shows room use per day", async () => {
    await tool("create_game", { title: "Hop" });
    const game = (await gameBySlug(env.DB, "hop"))!;
    const today = new Date().toISOString().slice(0, 10);
    await env.DB.prepare("INSERT INTO room_usage (game_id, day, rooms, player_seconds, messages) VALUES (?, ?, 3, 600, 42)").bind(game.id, today).run();
    const stats = await tool("get_stats", { slug: "hop", days: 7 });
    expect(stats.multiplayer).toEqual([{ day: today, rooms: 3, player_minutes: 10, messages: 42 }]);
  });

  it("keeps scan details and admin notes out of the history", async () => {
    await tool("create_game", { title: "Hop" });
    const game = (await gameBySlug(env.DB, "hop"))!;
    await audit(env.DB, game.id, "scan-held", "child-safety: something only admins see", "system");
    await audit(env.DB, game.id, "takedown", "private admin note", "admin:julius@example.com");
    await audit(env.DB, game.id, "owner", "Owner: Pixel Smith", "admin:julius@example.com");
    const { history } = await tool("get_history", { slug: "hop" });
    const text = JSON.stringify(history);
    expect(text).not.toContain("admins see");
    expect(text).not.toContain("admin note");
    expect(text).not.toContain("julius");
    expect(history.map((h: { what: string }) => h.what)).toContain("Zaisma took the game down");
  });
});

