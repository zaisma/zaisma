import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAccount, createApiKey, createGame, createVersion, NOT_BLOCKED_IN_COUNTRY_SQL, personOwner, type ImageMatcher } from "@zaisma/core";
import { scanVersion } from "../../apps/site/src/scan.ts";
import { passingScanDeps } from "./scan-stubs.ts";
import { triageReports, type TriageDeps } from "../../apps/site/src/triage.ts";
import { ADMIN_TOOLS } from "../../apps/site/src/admin-mcp.ts";
import { CLEAN_GAME, makeZip } from "../helpers.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";
import { GAME } from "../../apps/site/src/schemas.ts";

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
  await scanVersion(testEnv, versionId, passingScanDeps({ images: connected }));
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
      "list_review_precedents",
      "approve_review_precedent",
      "retire_review_precedent",
      "get_review_counts",
      "list_chat_reviews",
      "decide_chat_review",
      "decide_notice",
      "decide_country_block",
      "list_publishing_accounts",
      "set_can_publish",
      "set_zaisma_account",
      "ban_account",
      "unban_account",
      "list_ban_matches",
      "decide_ban_match",
      "list_security_spikes",
      "list_blocked_scripts",
      "get_page_speed",
      "get_game",
      "list_announcements",
      "post_announcement",
      "end_announcement",
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

  it("counts how the review's scans came out, by the scan's own decision", async () => {
    // Other tests' versions are in the database too: count what these add.
    type Counts = Record<"passed_count" | "rejected_count" | "held_for_person_count" | "waiting_count", number>;
    const before: Counts = await data("get_review_counts");
    const beforeLong: Counts = await data("get_review_counts", { period_duration_days: 90 });
    const added = (after: Counts, from: Counts) => Object.fromEntries((Object.keys(from) as (keyof Counts)[]).filter((key) => key.endsWith("_count")).map((key) => [key, after[key] - from[key]]));
    const game = await createGame(env.DB, { slug: "counted-game", title: "Counted", description: "A test." });
    const finding = (code: string, severity: string) => ({ stage: "ai", severity, code, message: "x" });
    const scanned = [
      { decision: "approved", findings: [], finished_at_ms: Date.now() },
      { decision: "rejected", findings: [finding("ai_free_text_chat", "reject")], finished_at_ms: Date.now() },
      { decision: "held", findings: [finding("ai_lifelike_gore", "hold")], finished_at_ms: Date.now() },
      { decision: "held", findings: [finding("daily_large_reviews_used", "hold"), finding("unlisted_address", "info")], finished_at_ms: Date.now() },
      { decision: "approved", findings: [], finished_at_ms: Date.now() - 40 * 24 * 60 * 60 * 1000 },
    ];
    for (const [index, report] of scanned.entries()) {
      const versionId = `version_counted${index}`;
      await createVersion(env.DB, { id: versionId, gameId: game.id, r2Prefix: `manifests/${versionId}`, fileCount: 1, sizeBytes: 1, kind: "files" });
      await env.DB.prepare("UPDATE versions SET scan_status = ?, scan_report = ? WHERE id = ?").bind(report.decision, JSON.stringify({ ...report, outside_hosts: [], images: { provider: "none", is_connected: false, checked_media_count: 0 }, ai: null }), versionId).run();
    }
    // A person approving the held one later doesn't change how the scan decided.
    await env.DB.prepare("UPDATE versions SET scan_status = 'approved' WHERE id = 'version_counted2'").run();
    const after = await data("get_review_counts");
    expect(after.period_duration_days).toBe(30);
    expect(added(after, before)).toEqual({ passed_count: 1, rejected_count: 1, held_for_person_count: 1, waiting_count: 1 });
    expect(added(await data("get_review_counts", { period_duration_days: 90 }), beforeLong)).toMatchObject({ passed_count: 2 });
    expect(await refusal("get_review_counts", { period_duration_days: 91 })).toMatchObject({ code: "bad_period_duration_days", field: "period_duration_days" });
  });

  it("lists, tests and retires review precedents", async () => {
    await env.DB.exec("DELETE FROM review_precedents;");
    const insert = (id: string, status: string, caseHtml: string) =>
      env.DB
        .prepare("INSERT INTO review_precedents (id, title, applies_when, decision, content_rule, why, review_precedent_status, case_title, case_description, case_index_html, test_result, created_by, created_at_ms, updated_at_ms) VALUES (?, 'Phrase menu', 'A menu of fixed phrases.', 'pass', 'chat', 'Fixed phrases.', ?, 'Phrase menu', 'A tiny game.', ?, ?, 'ai', 1000, 1000)")
        .bind(id, status, caseHtml, status === "failed" ? JSON.stringify({ is_passing: false, cases: [], summary: "Didn't hold." }) : null)
        .run();
    await insert("review_precedent_drafted0001", "proposed", "<p>stand-in</p>");
    await insert("review_precedent_nogame00001", "proposed", "");
    await insert("review_precedent_failed00001", "failed", "<p>stand-in</p>");
    await insert("review_precedent_active00001", "active", "<p>stand-in</p>");
    const listed = (await data("list_review_precedents")).review_precedents;
    expect(listed.map((precedent: { id: string }) => precedent.id)).toHaveLength(4);
    expect(listed[0]).toMatchObject({ review_precedent_status: "proposed", decision: "pass", content_rule: "chat", test_game: { title: "Phrase menu", index_html: "<p>stand-in</p>" }, test_summary: null });
    expect(listed.find((precedent: { id: string }) => precedent.id === "review_precedent_nogame00001").test_game).toBeNull();
    expect(listed.find((precedent: { id: string }) => precedent.id === "review_precedent_failed00001").test_summary).toBe("Didn't hold.");
    expect((await data("list_review_precedents", { review_precedent_status: "active" })).review_precedents).toHaveLength(1);
    expect(await refusal("list_review_precedents", { review_precedent_status: "live" })).toMatchObject({ code: "bad_review_precedent_status" });

    const tested = await data("approve_review_precedent", { review_precedent_id: "review_precedent_drafted0001" });
    expect(tested.review_precedent).toMatchObject({ id: "review_precedent_drafted0001", review_precedent_status: "testing" });
    expect(tested.next_steps[0]).toMatchObject({ tool: "list_review_precedents", arguments: { review_precedent_status: "testing" } });
    expect((await data("approve_review_precedent", { review_precedent_id: "review_precedent_failed00001" })).review_precedent.review_precedent_status).toBe("testing");
    expect(await refusal("approve_review_precedent", { review_precedent_id: "review_precedent_active00001" })).toMatchObject({ code: "not_approvable" });
    expect(await refusal("approve_review_precedent", { review_precedent_id: "review_precedent_nogame00001" })).toMatchObject({ code: "incomplete_review_precedent" });
    expect(await refusal("approve_review_precedent", { review_precedent_id: "review_precedent_nothere0001" })).toMatchObject({ code: "no_review_precedent", field: "review_precedent_id" });
    expect(await refusal("approve_review_precedent", { review_precedent_id: "precedent_hard-or-boring" })).toMatchObject({ code: "wrong_id_kind" });
    expect((await data("retire_review_precedent", { review_precedent_id: "review_precedent_active00001" })).review_precedent.review_precedent_status).toBe("retired");
  });

  it("lists chat the filter kept and decides it", async () => {
    await env.DB.exec("DELETE FROM chat_reviews;");
    const game = (await env.DB.prepare("SELECT id FROM games WHERE slug = 'test-game'").first<{ id: string }>())!;
    const sender = await createAccount(env.DB, { id: "admin-mcp-chat-sender", username: "admin_mcp_chat_sender", ageBand: "18+" });
    const keep = (id: string, status: string, source = "rooms") =>
      env.DB.prepare("INSERT INTO chat_reviews (id, sender_account_id, game_id, source, text, recent_texts_json, chat_review_status, ai_reason, created_at_ms) VALUES (?, ?, ?, ?, 'u alone?', '[\"hey\"]', ?, 'Unsure.', ?)").bind(id, sender.id, game.id, source, status, Date.now()).run();
    await keep("chat_review_unsure1", "needs_person");
    await keep("chat_review_pending1", "pending");
    await env.DB.prepare("UPDATE accounts SET chat_stopped_reason = 'in_review' WHERE id = ?").bind(sender.id).run();

    const waiting = await data("list_chat_reviews");
    expect(waiting.chat_reviews).toEqual([
      expect.objectContaining({ id: "chat_review_unsure1", game: { id: game.id, slug: "test-game" }, sender_username: "admin_mcp_chat_sender", source: "rooms", chat_review_status: "needs_person", state: "The AI was unsure", text: "u alone?", recent_texts: ["hey"], kept_until_at: null }),
    ]);
    expect((await data("list_chat_reviews", { chat_review_status: "all" })).chat_reviews).toHaveLength(2);
    expect(await refusal("list_chat_reviews", { chat_review_status: "open" })).toMatchObject({ code: "bad_chat_review_status", field: "chat_review_status" });

    const removed = await data("decide_chat_review", { chat_review_id: "chat_review_unsure1", decision: "remove_chat" });
    expect(removed).toMatchObject({ chat_review_id: "chat_review_unsure1", decision: "remove_chat", chat_review: { chat_review_status: "confirmed", reported_at: null }, next_steps: [] });
    expect((await env.DB.prepare("SELECT chat_stopped_reason FROM accounts WHERE id = ?").bind(sender.id).first())!.chat_stopped_reason).toBe("removed");
    expect((await data("decide_chat_review", { chat_review_id: "chat_review_unsure1", decision: "reported" })).chat_review.reported_at).not.toBeNull();
    expect((await data("decide_chat_review", { chat_review_id: "chat_review_pending1", decision: "false_alarm" })).chat_review).toBeNull();

    expect(await refusal("decide_chat_review", { chat_review_id: "chat_review_nothere1", decision: "false_alarm" })).toMatchObject({ code: "no_chat_review", field: "chat_review_id" });
    expect(await refusal("decide_chat_review", { chat_review_id: "topic_abc", decision: "false_alarm" })).toMatchObject({ code: "wrong_id_kind", field: "chat_review_id" });
    expect(await refusal("decide_chat_review", { chat_review_id: "chat_review_unsure1", decision: "ban" })).toMatchObject({ code: "bad_decision", field: "decision" });
  });

  it("lets accounts publish before the beta, or stops them, like the admin page", async () => {
    await env.DB.exec("DELETE FROM api_keys WHERE account_id = 'admin-mcp-publisher';");
    const account = await createAccount(env.DB, { id: "admin-mcp-publisher", username: "Admin_Mcp_Publisher", ageBand: "18+" });
    const { token } = await createApiKey(env.DB, account.id, "laptop");
    const canPublish = async () => ((await (await SELF.fetch(`${LOCAL}/api/dev/access`, { headers: { authorization: `Bearer ${token}` } })).json()) as { can_publish: boolean }).can_publish;
    const listed = async () => ((await data("list_publishing_accounts")).publishing_accounts as { username: string }[]).some((each) => each.username === "Admin_Mcp_Publisher");
    expect(await canPublish()).toBe(false);
    expect(await listed()).toBe(false);

    // The username is matched ignoring case, with or without the @.
    const allowed = await data("set_can_publish", { username: "@admin_mcp_publisher", can_publish: true });
    expect(allowed).toMatchObject({ username: "Admin_Mcp_Publisher", can_publish: true, next_steps: [] });
    expect(allowed.publishing_accounts).toContainEqual({ username: "Admin_Mcp_Publisher", player_id: account.player_id, game_count: 0 });
    expect(await canPublish()).toBe(true);
    expect((await data("set_can_publish", { username: "Admin_Mcp_Publisher", can_publish: false })).can_publish).toBe(false);
    expect(await canPublish()).toBe(false);
    expect(await refusal("set_can_publish", { username: "Nobody_Here", can_publish: true })).toMatchObject({ code: "unknown_username", field: "username" });

    // The page's buttons do the same, and both are in the audit log.
    const post = (path: string, fields: Record<string, string> = {}) => SELF.fetch(`${LOCAL}${path}`, { method: "POST", body: new URLSearchParams(fields), redirect: "manual" });
    expect((await post("/admin/publishing/add", { username: "Admin_Mcp_Publisher" })).headers.get("location")).toBe("/admin/publishing");
    expect(await canPublish()).toBe(true);
    const page = await (await SELF.fetch(`${LOCAL}/admin/publishing`)).text();
    expect(page).toContain("@Admin_Mcp_Publisher");
    await post(`/admin/publishing/${account.id}/remove`);
    expect(await canPublish()).toBe(false);
    const missing = await post("/admin/publishing/add", { username: "Nobody_Here" });
    expect(await (await SELF.fetch(`${LOCAL}${missing.headers.get("location")}`)).text()).toContain("No account has the username Nobody_Here.");
    const { results } = await env.DB.prepare("SELECT action, reason FROM audit_log WHERE game_id IS NULL AND reason = '@Admin_Mcp_Publisher' ORDER BY id").all<{ action: string }>();
    expect(results.map((row) => row.action)).toEqual(["publishing-allowed", "publishing-stopped", "publishing-allowed", "publishing-stopped"]);
  });

  it("holds a game on a notice and shows it again", async () => {
    expect(await refusal("decide_notice", { slug: "test-game", decision: "hold", why: "x" })).toMatchObject({ code: "missing_field", field: "notice_kind" });
    expect(await refusal("decide_notice", { slug: "test-game", decision: "hold", notice_kind: "libel", why: "x" })).toMatchObject({ code: "bad_notice_kind", field: "notice_kind" });
    expect(await refusal("decide_notice", { slug: "test-game", decision: "show_again", why: "x" })).toMatchObject({ code: "cant_decide", field: "decision" });
    expect(await refusal("decide_notice", { slug: "nothere", decision: "hold", notice_kind: "defamation", why: "x" })).toMatchObject({ code: "no_game", field: "slug" });

    const held = await data("decide_notice", { slug: "test-game", decision: "hold", notice_kind: "defamation", why: "The ending calls Emma Clarke the town's thief." });
    expect(held).toMatchObject({ decision: "hold", game: { review_status: "held", review_reason: { code: "defamation_notice", content_rule: "defamation", message: "A defamation notice names this: The ending calls Emma Clarke the town's thief." } } });
    expect(await refusal("decide_notice", { slug: "test-game", decision: "show_again", notice_kind: "defamation", why: "x" })).toMatchObject({ code: "unknown_field", field: "notice_kind" });
    const shown = await data("decide_notice", { slug: "test-game", decision: "show_again", why: "Version 2 no longer names her." });
    expect(shown.game).toMatchObject({ review_status: "live", review_reason: null });

    expect(await refusal("decide_report_group", { report_group_id: "report_8f3k2m9q1x7c4v6b0n5z", decision: "take_down", why: "x", is_copyright_notice: true })).toMatchObject({ code: "unknown_field" });
  });

  it("blocks a game in one country only, and lifts it", async () => {
    const from = (countryCode: string | null, path = "/g/test-game") => SELF.fetch(`${LOCAL}${path}`, countryCode ? ({ cf: { country: countryCode } } as RequestInit) : {});
    expect(await refusal("decide_country_block", { slug: "test-game", decision: "block", country_code: "UK", why: "x" })).toMatchObject({ code: "bad_country_code", field: "country_code" });
    expect(await refusal("decide_country_block", { slug: "test-game", decision: "block", country_code: "gb", why: "x" })).toMatchObject({ code: "bad_country_code", field: "country_code" });
    expect(await refusal("decide_country_block", { slug: "test-game", decision: "lift", country_code: "GB", why: "x" })).toMatchObject({ code: "cant_decide", field: "country_code" });
    expect(await refusal("decide_country_block", { slug: "nothere", decision: "block", country_code: "GB", why: "x" })).toMatchObject({ code: "no_game", field: "slug" });

    const blocked = await data("decide_country_block", { slug: "test-game", decision: "block", country_code: "GB", why: "Ofcom says the poster in level 3 stirs up racial hatred under the Public Order Act 1986." });
    expect(blocked).toMatchObject({ decision: "block", game: { review_status: "live", review_reason: null, country_blocks: [{ country_code: "GB", country_name: "United Kingdom", review_reason: { code: "country_law_notice", content_rule: null, message: "A notice under GB law names this: Ofcom says the poster in level 3 stirs up racial hatred under the Public Order Act 1986." } }] } });

    // Players there get 451 and lists leave it out; everyone else, and an unknown country, plays it as before.
    const there = await from("GB");
    expect(there.status).toBe(451);
    expect(await there.text()).toContain("(United Kingdom) blocks it here");
    expect((await from("DE")).status).toBe(200);
    expect((await from("T1")).status).toBe(200);
    expect((await from(null)).status).toBe(200);
    const { results } = await env.DB.prepare(`SELECT slug FROM games WHERE ${NOT_BLOCKED_IN_COUNTRY_SQL}`).bind("GB").all<{ slug: string }>();
    expect(results).toEqual([]);
    expect((await env.DB.prepare(`SELECT slug FROM games WHERE ${NOT_BLOCKED_IN_COUNTRY_SQL}`).bind("DE").all<{ slug: string }>()).results).toEqual([{ slug: "test-game" }]);

    // The developer sees it in get_game, its alert and its history.
    await createAccount(env.DB, { id: "blocked-dev", username: "Border_Dev", ageBand: "18+" });
    const owner = await personOwner(env.DB, "blocked-dev");
    await env.DB.prepare("UPDATE games SET owner_id = ? WHERE slug = 'test-game'").bind(owner.id).run();
    const { token } = await createApiKey(env.DB, "blocked-dev", "Test");
    const game = (await (await SELF.fetch("https://zaisma.test/api/dev/games/test-game", { headers: { authorization: `Bearer ${token}` } })).json()) as { game: { country_blocks: unknown[] }; alerts: { kind: string; message: string }[] };
    expect(schemaProblems(GAME, game.game)).toEqual([]);
    expect(game.game.country_blocks).toMatchObject([{ country_code: "GB", review_reason: { code: "country_law_notice" } }]);
    expect(game.alerts.find((alert) => alert.kind === "game_blocked_in_country")?.message).toContain("Players in GB (United Kingdom) can't open this game");
    const history = (await (await SELF.fetch("https://zaisma.test/api/dev/games/test-game/history", { headers: { authorization: `Bearer ${token}` } })).json()) as { events: { description: string; review_reason: { code: string } | null }[] };
    expect(history.events[0]).toMatchObject({ review_reason: { code: "country_law_notice" } });

    // Blocking it again replaces the reason; lifting it opens it there again.
    const again = await data("decide_country_block", { slug: "test-game", decision: "block", country_code: "GB", why: "The poster and the chant in level 4." });
    expect(again.game.country_blocks).toHaveLength(1);
    const lifted = await data("decide_country_block", { slug: "test-game", decision: "lift", country_code: "GB", why: "Version 6 has neither." });
    expect(lifted).toMatchObject({ decision: "lift", game: { country_blocks: [] } });
    expect((await from("GB")).status).toBe(200);
  });

  it("shows a game as admin sees it", async () => {
    const out = await data("get_game", { slug: "test-game" });
    expect(out.game).toMatchObject({ slug: "test-game", review_status: "live", multiplayer_mode: "none", game_server_name: null });
    expect(out.report_groups).toHaveLength(3);
    expect(out.versions[0].is_live).toBe(true);
    expect(out.versions[0]).toMatchObject({ replaced_by_version_id: null, changes_since: null });

    // A held version says what changed since the hold it answers; zip uploads have no file lists.
    const game = (await env.DB.prepare("SELECT id FROM games WHERE slug = 'test-game'").first<{ id: string }>())!;
    const report = (code: string) => JSON.stringify({ finished_at_ms: 1, decision: "held", findings: [{ stage: "ai", severity: "hold", code, message: "x" }], outside_hosts: [], images: { provider: "none", is_connected: false, checked_media_count: 0 }, ai: null, is_child_safety: false });
    const insert = "INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, scan_report, created_at_ms, judged_at_ms) VALUES (?, ?, 'none', 0, 0, 'held', ?, ?, ?)";
    await env.DB.batch([
      env.DB.prepare(insert).bind("version_heldforgore01", game.id, report("ai_lifelike_gore"), Date.now() + 1000, Date.now()),
      env.DB.prepare(insert).bind("version_thefixheld001", game.id, report("ai_other"), Date.now() + 2000, Date.now()),
    ]);
    const held = await data("get_game", { slug: "test-game" });
    expect(held.versions[0]).toMatchObject({ id: "version_thefixheld001", changes_since: { version_id: "version_heldforgore01", added_paths: [], added_path_count: 0 } });
    expect(await refusal("get_game", { slug: "nothere" })).toMatchObject({ code: "no_game", field: "slug" });
    expect(await refusal("get_game", { game: "test-game" })).toMatchObject({ code: "unknown_field", fix: expect.stringContaining("Did you mean slug?") });
  });
});

describe("admin MCP, reports about a player", () => {
  const personAsks = (severity: "high" | "child_safety"): TriageDeps => ({
    random: () => 0.5,
    ai: async () => ({ severity, category: "player", summary: "Posts where someone lives.", recommendation: "person", why: "Personal details.", same_as: "", precedent: "", fit: "none", draft: { title: "", applies_when: "", decision: "", why: "" }, input_token_count: 10, output_token_count: 10 }),
  });
  async function reportedAccount(severity: "high" | "child_safety") {
    await env.DB.exec("DELETE FROM reports; DELETE FROM friendships; DELETE FROM friend_invites; DELETE FROM accounts WHERE id LIKE 'reported-%';");
    const account = await createAccount(env.DB, { id: `reported-${severity}`, username: `Loud_Lynx_${severity === "high" ? 1 : 2}`, ageBand: "18+" });
    await env.DB.prepare("UPDATE accounts SET bio = 'lives at 12 Elm St' WHERE id = ?").bind(account.id).run();
    await send({ reason: "personal_details", details: "keeps posting her address", room: "ABCDEF", player: { id: account.player_id, name: account.username } });
    await triageReports(testEnv, personAsks(severity));
    const groups = (await data("list_report_groups")).report_groups;
    return { account, groupId: groups[0].id as string };
  }

  it("offers what fits a player, and turns an account's social side off only with what the report found", async () => {
    const { account, groupId } = await reportedAccount("high");
    const group = (await data("get_report_group", { report_group_id: groupId })).report_group;
    expect(group.possible_decisions).toEqual(["dismiss", "pass_to_developer", "stop_social", "clear_profile"]);
    expect(group.reports[0]).toMatchObject({ reported_player: { id: account.player_id, username: account.username, is_social_stopped: false }, has_block_between: false });

    expect(await refusal("decide_report_group", { report_group_id: groupId, decision: "stop_social", why: "Posted her address." })).toMatchObject({ code: "missing_field", field: "social_stopped_reason" });
    expect(await refusal("decide_report_group", { report_group_id: groupId, decision: "dismiss", why: "Nothing.", social_stopped_reason: "sexual" })).toMatchObject({ code: "unknown_field", field: "social_stopped_reason" });
    await data("decide_report_group", { report_group_id: groupId, decision: "stop_social", why: "Posted her address.", social_stopped_reason: "personal_details" });
    expect(await env.DB.prepare("SELECT who_can_chat, chat_stopped_reason, social_stopped_reason FROM accounts WHERE id = ?").bind(account.id).first()).toEqual({ who_can_chat: "nobody", chat_stopped_reason: "removed", social_stopped_reason: "personal_details" });
    expect(await env.DB.prepare("SELECT report_status FROM reports").first("report_status")).toBe("actioned");
  });

  it("clears a profile, and never passes child safety to the developer", async () => {
    const first = await reportedAccount("high");
    await data("decide_report_group", { report_group_id: first.groupId, decision: "clear_profile", why: "Address in the bio." });
    expect(await env.DB.prepare("SELECT bio FROM accounts WHERE id = ?").bind(first.account.id).first("bio")).toBeNull();

    const { groupId } = await reportedAccount("child_safety");
    const group = (await data("get_report_group", { report_group_id: groupId })).report_group;
    expect(group.possible_decisions).not.toContain("pass_to_developer");
    expect(await refusal("decide_report_group", { report_group_id: groupId, decision: "pass_to_developer", why: "No." })).toMatchObject({ code: "cant_decide" });
    // Confirmed: Julius hears to report it to NCMEC.
    const alerts: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => void alerts.push(String(line)));
    await data("decide_report_group", { report_group_id: groupId, decision: "stop_social", why: "Confirmed.", social_stopped_reason: "sexual" });
    spy.mockRestore();
    expect(alerts).toContain("[alert] URGENT: report to NCMEC: @Loud_Lynx_2");
  });
});
