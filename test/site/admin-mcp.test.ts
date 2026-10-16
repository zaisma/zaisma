import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { ImageMatcher } from "@zaisma/core";
import { scanVersion } from "../../apps/site/src/scan.ts";
import { triageReports, type TriageDeps } from "../../apps/site/src/triage.ts";
import { ADMIN_TOOLS } from "../../apps/site/src/admin-mcp.ts";
import { CLEAN_GAME, makeZip } from "../helpers.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";

const LOCAL = "http://localhost";
const testEnv = { ...env, DEV_ADMIN: "1", ANTHROPIC_API_KEY: "test-key" };
const connected: ImageMatcher = { check: async (imgs) => ({ provider: "test", isConnected: true, checkedMediaCount: imgs.length, findings: [] }) };

async function liveGame() {
  const form = new FormData();
  form.set("title", "Test Game");
  form.set("slug", "test-game");
  form.set("description", "A test.");
  form.set("zip", new File([makeZip(CLEAN_GAME)], "game.zip", { type: "application/zip" }));
  const { versionId } = (await (await SELF.fetch(`${LOCAL}/admin/api/games`, { method: "POST", body: form })).json()) as { versionId: string };
  await scanVersion(testEnv, versionId, { images: connected, ai: async () => ({ report: { model: "t", verdict: "pass", summary: "fine", input_token_count: 1, output_token_count: 1 }, findings: [], isChildSafety: false }) });
  await env.DB.prepare("UPDATE versions SET published_at_ms = ?").bind(Date.now() - 30 * 86400_000).run();
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
      input_token_count: 10,
      output_token_count: 10,
    };
  },
};

async function rpc(method: string, params: Record<string, unknown> = {}, url = `${LOCAL}/admin/mcp`) {
  return SELF.fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
}
/**
 * Call a tool and get its whole result. Every answer must match the tool's output schema exactly,
 * and every error the error's shape, with its message, fix and code as its text.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tool(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const { result } = (await (await rpc("tools/call", { name, arguments: args })).json()) as { result: { content: { text: string }[]; isError?: boolean; structuredContent: { error: { message: string; fix: string; code: string } } } };
  if (result.isError) {
    expect(errorProblems(result.structuredContent)).toEqual([]);
    const { message, fix, code } = result.structuredContent.error;
    expect(result.content[0]!.text).toBe(`${message} ${fix} (${code})`);
  } else {
    expect(schemaProblems(ADMIN_TOOLS.find((candidate) => candidate.name === name)!.outputSchema, result.structuredContent, name)).toEqual([]);
  }
  return result;
}
const data = async (name: string, args: Record<string, unknown> = {}) => (await tool(name, args)).structuredContent;
/** A refused call's error object. */
const refusal = async (name: string, args: Record<string, unknown> = {}) => {
  const result = await tool(name, args);
  expect(result.isError).toBe(true);
  return result.structuredContent.error;
};

beforeEach(async () => {
  await env.DB.exec(
    "DELETE FROM reports; DELETE FROM audit_log; DELETE FROM versions; DELETE FROM games; DELETE FROM ai_usage; UPDATE precedents SET precedent_status = 'proposed', can_ai_apply_alone = 0; DELETE FROM precedents WHERE created_at_ms > 0;",
  );
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
    const list = (await (await rpc("tools/list")).json()) as { result: { tools: { name: string; outputSchema: { anyOf: unknown[] } }[] } };
    expect(list.result.tools.map((listed) => listed.name)).toEqual([
      "list_report_groups",
      "list_handled_reports",
      "get_report_group",
      "decide_report_group",
      "list_precedents",
      "set_precedent",
      "approve_precedent",
      "retire_precedent",
      "list_topics",
      "get_topic",
      "decide_topic",
      "decide_post",
      "get_game",
    ]);
    // Each lists its answer or the error, as the developer MCP's do.
    for (const listed of list.result.tools) expect(listed.outputSchema.anyOf).toHaveLength(2);
  });

  it("lists report groups most serious first, child safety at the top", async () => {
    const out = await data("list_report_groups");
    expect(out.report_groups.map((group: { severity: string }) => group.severity)).toEqual(["child_safety", "high", "low"]);
    expect(out.report_groups.slice(1).map((group: { summary: string }) => group.summary)).toEqual(["Says there's nudity.", "Doesn't like it."]);
    expect(out.more_group_count).toBe(0);
    expect((await data("list_report_groups", { maximum_group_count: 1 })).more_group_count).toBe(2);
    expect(await refusal("list_report_groups", { maximum_group_count: 0 })).toMatchObject({ code: "bad_maximum_group_count", field: "maximum_group_count" });
    expect(await refusal("list_report_groups", { limit: 5 })).toMatchObject({ code: "unknown_field", field: "limit" });
  });

  it("shows a group in full, with its picture", async () => {
    const [, nudity] = (await data("list_report_groups")).report_groups;
    const full = await tool("get_report_group", { report_group_id: nudity.id });
    expect(full.structuredContent.report_group.reports[0]).toMatchObject({ reason: "sexual", player_text: "nudity on level 2", picture_status: "shown" });
    expect(full.structuredContent.report_group.possible_decisions).toEqual(["dismiss", "bug", "take_down"]);
    expect(full.structuredContent.report_group.game).toMatchObject({ slug: "test-game", review_status: "live" });
    expect(full.content[1]).toMatchObject({ type: "image", mimeType: "image/jpeg" });
    // The old name says where the ID goes; an ID of another kind, or one that isn't there, says so.
    expect(await refusal("get_report_group", { group: nudity.id })).toMatchObject({ code: "unknown_field", fix: expect.stringContaining("Did you mean report_group_id?") });
    expect(await refusal("get_report_group", { report_group_id: "precedent_broken" })).toMatchObject({ code: "wrong_id_kind", field: "report_group_id" });
    expect(await refusal("get_report_group", { report_group_id: "report_nothere" })).toMatchObject({ code: "no_report_group" });
  });

  it("opens a child-safety report for the admin, but never its picture, and never passes it to the developer", async () => {
    // A report sent as something else, that triage found to be about child safety, can carry a picture.
    await send({ reason: "other", details: "a grown-up character asks kids for photos", picture: "data:image/jpeg;base64," + btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 3, 4)) });
    const escalated = await env.DB.prepare("SELECT id FROM reports WHERE player_text LIKE 'a grown-up%'").first<{ id: string }>();
    await env.DB.prepare("UPDATE reports SET severity_index = 0 WHERE id = ?").bind(escalated!.id).run();
    const full = await tool("get_report_group", { report_group_id: escalated!.id });
    expect(full.content).toHaveLength(1); // No image.
    expect(full.structuredContent.report_group.child_safety_note).toContain("NCMEC");
    expect(full.structuredContent.report_group.reports[0].picture_status).toBe("admin_page_only");
    expect(full.structuredContent.report_group.possible_decisions).toEqual(["dismiss", "take_down"]);
    expect(await refusal("decide_report_group", { report_group_id: escalated!.id, decision: "bug", why: "x" })).toMatchObject({ code: "cant_decide", field: "decision" });

    const filed = await env.DB.prepare("SELECT id FROM reports WHERE reason = 'child_safety'").first<{ id: string }>();
    expect((await data("get_report_group", { report_group_id: filed!.id })).report_group.reports[0].player_text).toBe("a secret only a person may read");
    // The queue's own route refuses it too.
    const form = new FormData();
    await SELF.fetch(`${LOCAL}/admin/report-groups/${filed!.id}/bug`, { method: "POST", body: form, redirect: "manual" });
    expect(await env.DB.prepare("SELECT report_status, is_bug_report FROM reports WHERE id = ?").bind(filed!.id).first()).toEqual({ report_status: "open", is_bug_report: 0 });
  });

  it("decides a group like the queue does, and can set a precedent with it", async () => {
    const boring = (await data("list_report_groups")).report_groups[2];
    const precedent = { title: "Boring games", applies_when: "The player finds it boring.", why: "Taste.", can_ai_apply_alone: true };
    expect(await refusal("decide_report_group", { report_group_id: boring.id, decision: "dismiss", why: "   " })).toMatchObject({ code: "bad_why", field: "why" });
    expect(await refusal("decide_report_group", { report_group_id: boring.id, decision: "dismiss", why: "Taste", precedent: { ...precedent, ai_alone: true } })).toMatchObject({ code: "bad_precedent", field: "precedent.ai_alone" });
    expect(await refusal("decide_report_group", { report_group_id: boring.id, decision: "bug", why: "Taste", precedent })).toMatchObject({ code: "bad_can_ai_apply_alone", field: "precedent.can_ai_apply_alone" });
    const done = await data("decide_report_group", { report_group_id: boring.id, decision: "dismiss", why: "Taste", precedent });
    expect(done).toMatchObject({ report_group_id: boring.id, decision: "dismiss", report_count: 1, precedent: { title: "Boring games", decision: "dismiss", can_ai_apply_alone: true, precedent_status: "active", from_report_group_id: boring.id }, message: null });
    expect(done.next_steps).toEqual([{ tool: "list_report_groups", arguments: {}, after_sec: null, reason: expect.any(String) }]);
    expect(await env.DB.prepare("SELECT report_status FROM reports WHERE id = ?").bind(boring.id).first("report_status")).toBe("dismissed");
    expect(await env.DB.prepare("SELECT actor FROM audit_log WHERE action = 'reports-dismissed'").first("actor")).toBe("dev@localhost");
    // Decided once; the history keeps it.
    expect(await refusal("decide_report_group", { report_group_id: boring.id, decision: "dismiss", why: "Again" })).toMatchObject({ code: "report_group_closed" });
    expect((await data("get_report_group", { report_group_id: boring.id })).report_group).toMatchObject({ is_open: false, reports: [{ report_status: "dismissed" }] });

    const nudity = (await data("list_report_groups")).report_groups[1];
    expect(await refusal("decide_report_group", { report_group_id: nudity.id, decision: "restore", why: "x" })).toMatchObject({ code: "cant_decide", fix: "Give one of: dismiss, bug, take_down." });
    expect(await refusal("decide_report_group", { report_group_id: nudity.id, decision: "approve", why: "x" })).toMatchObject({ code: "bad_decision", field: "decision" });
    expect(await refusal("decide_report_group", { report_group_id: nudity.id, decision: "dismiss" })).toMatchObject({ code: "missing_field", field: "why" });

    // A takedown names the rule it broke, and the developer reads why; other decisions name no rule.
    expect(await refusal("decide_report_group", { report_group_id: nudity.id, decision: "take_down", why: "Nudity on level 2." })).toMatchObject({ code: "missing_field", field: "content_rule" });
    expect(await refusal("decide_report_group", { report_group_id: nudity.id, decision: "dismiss", why: "x", content_rule: "sexual" })).toMatchObject({ code: "unknown_field", field: "content_rule" });
    await data("decide_report_group", { report_group_id: nudity.id, decision: "take_down", content_rule: "sexual", why: "Level 2 shows a naked character." });
    expect((await data("get_report_group", { report_group_id: nudity.id })).report_group.game).toMatchObject({
      review_status: "removed",
      review_reason: { code: "taken_down", message: "Level 2 shows a naked character.", content_rule: "sexual", fix: expect.stringContaining("message_zaisma") },
    });
  });

  it("lists what triage handled alone", async () => {
    await env.DB.prepare("UPDATE reports SET report_status = 'dismissed', closed_at_ms = ?, triaged_at_ms = ? WHERE player_text = 'so boring'").bind(Date.now(), Date.now()).run();
    await env.DB.prepare("UPDATE reports SET closed_at_ms = triaged_at_ms WHERE player_text = 'so boring'").run();
    expect(await data("list_handled_reports")).toMatchObject({ period_duration_days: 7, reports: [{ game_slug: "test-game", summary: "Doesn't like it.", player_text: "so boring" }] });
  });

  it("lists, approves, sets and retires precedents", async () => {
    expect((await data("list_precedents")).precedents).toHaveLength(10);
    const approved = await data("approve_precedent", { precedent_id: "precedent_hard-or-boring", can_ai_apply_alone: true });
    expect(approved.precedent).toMatchObject({ id: "precedent_hard-or-boring", precedent_status: "active", can_ai_apply_alone: true, followed_count: 0, created_at: null });
    expect(approved.next_steps).toEqual([{ tool: "list_precedents", arguments: { precedent_status: "proposed" }, after_sec: null, reason: "9 more waiting for the admin." }]);
    expect(await refusal("approve_precedent", { precedent_id: "precedent_hard-or-boring" })).toMatchObject({ code: "not_proposed" });
    expect(await refusal("approve_precedent", { precedent_id: "precedent_nothere" })).toMatchObject({ code: "no_precedent", field: "precedent_id" });
    expect(await refusal("approve_precedent", { precedent_id: "precedent_broken", can_ai_apply_alone: true })).toMatchObject({ code: "bad_can_ai_apply_alone" });

    // Only a dismissal can be applied by the AI alone, so asking for it on a takedown is refused, not ignored.
    const fakeStores = { title: "Fake stores", applies_when: "Copies a store's login.", decision: "take_down", why: "Phishing." };
    expect(await refusal("set_precedent", { ...fakeStores, can_ai_apply_alone: true })).toMatchObject({ code: "bad_can_ai_apply_alone" });
    expect(await refusal("set_precedent", { ...fakeStores, title: " " })).toMatchObject({ code: "bad_title", field: "title" });
    const set = await data("set_precedent", fakeStores);
    expect(set.precedent).toMatchObject({ precedent_status: "active", can_ai_apply_alone: false, created_by: "dev@localhost" });
    expect(set.precedent.created_at).toMatch(/Z$/);
    const active = (await data("list_precedents", { precedent_status: "active" })).precedents;
    expect(active.map((listed: { id: string; can_ai_apply_alone: boolean }) => [listed.id === "precedent_hard-or-boring" ? listed.id : "new", listed.can_ai_apply_alone])).toEqual([
      ["precedent_hard-or-boring", true],
      ["new", false],
    ]);

    // A change replaces the precedent in force, and retiring takes it out.
    const changed = await data("set_precedent", { ...fakeStores, title: "Fake stores and logins", replaces_precedent_id: set.precedent.id });
    expect(changed.precedent.replaces_precedent_id).toBe(set.precedent.id);
    expect((await data("list_precedents", { precedent_status: "retired" })).precedents.map((listed: { id: string }) => listed.id)).toEqual([set.precedent.id]);
    expect((await data("retire_precedent", { precedent_id: changed.precedent.id })).precedent.precedent_status).toBe("retired");
    expect(await refusal("list_precedents", { precedent_status: "in_force" })).toMatchObject({ code: "bad_precedent_status" });
  });

  it("shows a game as admin sees it", async () => {
    const out = await data("get_game", { slug: "test-game" });
    expect(out.game).toMatchObject({ slug: "test-game", review_status: "live", multiplayer_mode: "none", game_server_name: null });
    expect(out.report_groups).toHaveLength(3);
    expect(out.versions[0].is_live).toBe(true);
    expect(await refusal("get_game", { slug: "nothere" })).toMatchObject({ code: "no_game", field: "slug" });
    expect(await refusal("get_game", { game: "test-game" })).toMatchObject({ code: "unknown_field", fix: expect.stringContaining("Did you mean slug?") });
  });
});
