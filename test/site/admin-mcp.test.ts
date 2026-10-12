import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { ImageMatcher } from "@zaisma/core";
import { scanVersion } from "../../apps/site/src/scan.ts";
import { triageReports, type TriageDeps } from "../../apps/site/src/triage.ts";
import { CLEAN_GAME, makeZip } from "../helpers.ts";
import { queueScanDone } from "./queue.ts";

const LOCAL = "http://localhost";
const testEnv = { ...env, DEV_ADMIN: "1", ANTHROPIC_API_KEY: "test-key" };
const connected: ImageMatcher = { check: async (imgs) => ({ provider: "test", connected: true, checked: imgs.length, findings: [] }) };

async function liveGame() {
  const form = new FormData();
  form.set("title", "Test Game");
  form.set("slug", "test-game");
  form.set("description", "A test.");
  form.set("zip", new File([makeZip(CLEAN_GAME)], "game.zip", { type: "application/zip" }));
  const { versionId } = (await (await SELF.fetch(`${LOCAL}/admin/api/games`, { method: "POST", body: form })).json()) as { versionId: string };
  await queueScanDone(versionId);
  await scanVersion(testEnv, versionId, { images: connected, ai: async () => ({ report: { model: "t", verdict: "pass", summary: "fine", inputTokens: 1, outputTokens: 1 }, findings: [], childSafety: false }) });
  await env.DB.prepare("UPDATE versions SET published_at = ?").bind(Date.now() - 30 * 86400_000).run();
}

let address = 10;
const send = (body: Record<string, unknown>) =>
  SELF.fetch(`${LOCAL}/g/test-game/report`, { method: "POST", headers: { "Content-Type": "application/json", Origin: LOCAL, "CF-Connecting-IP": `198.51.100.${address++}` }, body: JSON.stringify(body) });

/** Sorts by what the report itself says (not the other reports shown with it). */
const sorted: TriageDeps = {
  random: () => 0.5,
  ai: async (_k, _m, input) => {
    const boring = input.text.split("<other_reports>")[0]!.includes("boring");
    return {
      severity: boring ? "low" : "high",
      category: "other",
      summary: boring ? "Doesn't like it." : "Says there's nudity.",
      recommendation: boring ? "dismiss" : "person",
      why: "Because.",
      same_as: "",
      precedent: "",
      fit: "none",
      draft: { title: "Boring games", applies_when: "The player finds it boring.", decision: "dismiss", why: "Taste." },
      inputTokens: 10,
      outputTokens: 10,
    };
  },
};

async function rpc(method: string, params: Record<string, unknown> = {}, url = `${LOCAL}/admin/mcp`) {
  return SELF.fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tool = async (name: string, args: Record<string, unknown> = {}): Promise<any> => ((await (await rpc("tools/call", { name, arguments: args })).json()) as { result: unknown }).result;
const data = async (name: string, args: Record<string, unknown> = {}) => (await tool(name, args)).structuredContent;

beforeEach(async () => {
  await env.DB.exec("DELETE FROM reports; DELETE FROM audit_log; DELETE FROM versions; DELETE FROM games; DELETE FROM ai_usage; UPDATE precedents SET status = 'proposed', ai_alone = 0; DELETE FROM precedents WHERE created_at > 0;");
  await liveGame();
  await send({ reason: "other", details: "so boring" });
  await send({ reason: "sexual", details: "nudity on level 2", picture: "data:image/jpeg;base64," + btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 1, 2)) });
  await send({ reason: "child_safety", details: "a secret only a person may read" });
  await triageReports(testEnv, sorted);
});

describe("admin MCP", () => {
  it("is behind the admin login", async () => {
    expect((await rpc("tools/list", {}, "https://zaisma.test/admin/mcp")).status).toBe(403);
  });

  it("introduces itself and its tools", async () => {
    const init = (await (await rpc("initialize", { protocolVersion: "2025-06-18" })).json()) as { result: { serverInfo: { name: string }; instructions: string } };
    expect(init.result.serverInfo.name).toBe("zaisma-admin");
    expect(init.result.instructions).toContain("untrusted");
    const list = (await (await rpc("tools/list")).json()) as { result: { tools: { name: string }[] } };
    expect(list.result.tools.map((t) => t.name)).toEqual(["list_reports", "get_report", "decide_report", "list_precedents", "set_precedent", "approve_precedent", "get_game"]);
  });

  it("lists reports most serious first, and child-safety ones only as a count", async () => {
    const out = await data("list_reports");
    expect(out.open.map((g: { summary: string }) => g.summary)).toEqual(["Says there's nudity.", "Doesn't like it."]);
    expect(out.child_safety.groups).toBe(1);
    expect(JSON.stringify(out)).not.toContain("a secret only a person may read");
  });

  it("shows a group in full, with its picture, but never a child-safety one", async () => {
    const [nudity] = (await data("list_reports")).open;
    const full = await tool("get_report", { group: nudity.group });
    expect(full.structuredContent.reports[0]).toMatchObject({ player_wrote: "nudity on level 2", picture: true });
    expect(full.structuredContent.can_decide).toEqual(["dismiss", "bug", "take_down"]);
    expect(full.content[1]).toMatchObject({ type: "image", mimeType: "image/jpeg" });

    const secret = await env.DB.prepare("SELECT id FROM reports WHERE reason = 'child_safety'").first<{ id: string }>();
    const refused = await tool("get_report", { group: secret!.id });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused)).not.toContain("a secret");
    expect((await tool("decide_report", { group: secret!.id, decision: "dismiss", reason: "x" })).isError).toBe(true);
  });

  it("decides a group like the queue does, and can set a precedent with it", async () => {
    const boring = (await data("list_reports")).open[1];
    const done = await data("decide_report", { group: boring.group, decision: "dismiss", reason: "Taste", precedent: { title: "Boring games", applies_when: "The player finds it boring.", why: "Taste.", ai_alone: true } });
    expect(done.precedent_set).toMatchObject({ title: "Boring games", decision: "dismiss", ai_alone: 1 });
    expect(await env.DB.prepare("SELECT status FROM reports WHERE id = ?").bind(boring.group).first("status")).toBe("dismissed");
    expect(await env.DB.prepare("SELECT actor FROM audit_log WHERE action = 'reports-dismissed'").first("actor")).toBe("dev@localhost");

    const nudity = (await data("list_reports")).open[0];
    const wrong = await tool("decide_report", { group: nudity.group, decision: "restore", reason: "x" });
    expect(wrong.isError).toBe(true);
    expect(wrong.content[0].text).toContain("dismiss, bug, take_down");
  });

  it("lists, approves and sets precedents", async () => {
    expect((await data("list_precedents")).precedents).toHaveLength(10);
    await data("approve_precedent", { id: "hard-or-boring", action: "approve", ai_alone: true });
    const set = await data("set_precedent", { title: "Fake stores", applies_when: "Copies a store's login.", decision: "take_down", why: "Phishing.", ai_alone: true });
    expect(set.precedent).toMatchObject({ status: "active", ai_alone: 0 });
    const active = (await data("list_precedents", { status: "active" })).precedents;
    expect(active.map((p: { id: string; ai_alone: boolean }) => [p.id === "hard-or-boring" ? p.id : "new", p.ai_alone])).toEqual([
      ["hard-or-boring", true],
      ["new", false],
    ]);
  });

  it("shows a game as admin sees it", async () => {
    const out = await data("get_game", { game: "test-game" });
    expect(out.game.status).toBe("live");
    expect(out.open_reports).toHaveLength(2);
    expect(out.child_safety_reports).toBe(1);
    expect(out.versions[0].players_get_it).toBe(true);
  });
});
