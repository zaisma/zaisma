import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createAccount, createApiKey, createVersion, gameBySlug, needsLifelikeGoreAge, notConnected, versionById, addTesterLink, type ImageMatcher, type ScanReport } from "@zaisma/core";
import { scanVersion, type ScanDeps } from "../../apps/site/src/scan.ts";
import { publishDue } from "../../apps/site/src/cleanup.ts";
import { letPublish } from "../helpers.ts";
import { judgeSays, passingScanDeps } from "./scan-stubs.ts";

const SITE = "https://zaisma.test";
const testEnv = { ...env, ANTHROPIC_API_KEY: "test-key" };
const connected: ImageMatcher = { check: async (images) => ({ provider: "test", isConnected: true, checkedMediaCount: images.length, findings: [] }) };

const GORE = { stage: "ai", severity: "hold", code: "ai_lifelike_gore", message: "The boss fight shows a photo-real severed arm up close.", path: "boss.png" } as const;
const OTHER_HOLD = { stage: "ai", severity: "hold", code: "ai_private_details_or_threats", message: "A home address.", path: "index.html" } as const;
const aiFinds = (...findings: unknown[]): ScanDeps =>
  passingScanDeps({ images: connected, judge: async (...input) => judgeSays("hold", structuredClone(findings) as never)(...input) });

let token = "";

async function api(path: string, init: { method?: string; body?: unknown } = {}) {
  return SELF.fetch(`${SITE}/api/dev${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
}
const refusal = async (res: Response) => ((await res.json()) as { error: { code: string; field: string | null; message: string; fix: string } }).error;

async function mcp(name: string, toolArguments: Record<string, unknown>) {
  const res = await SELF.fetch(`${SITE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: toolArguments } }),
  });
  return ((await res.json()) as { result: { isError?: boolean; structuredContent: Record<string, any> } }).result;
}

const reportOf = (decision: "approved" | "held", ...findings: unknown[]): ScanReport => ({
  finished_at_ms: Date.now(),
  decision,
  findings: structuredClone(findings) as never,
  outside_hosts: [],
  images: { provider: "test", is_connected: true, checked_media_count: 0 },
  ai: null,
  is_child_safety: false,
});

let counter = 0;
/** A version of the hop game with the status and scan report given; a held one has no person's decision. */
async function makeVersion(status: "held" | "approved" | "scanning", report: ScanReport | null, extra: { reviewReason?: string; scheduledAtMs?: number } = {}) {
  const game = (await gameBySlug(env.DB, "hop"))!;
  const id = `version_gore${String(++counter).padStart(10, "0")}`;
  await createVersion(env.DB, { id, gameId: game.id, r2Prefix: `games/${id}`, fileCount: 1, sizeBytes: 10, publishWhenApprovedEnabled: false });
  await env.GAMES.put(`games/${id}/index.html`, "<!doctype html><title>Hop</title>");
  await env.DB.prepare("UPDATE versions SET scan_status = ?, scan_report = ?, review_reason = ?, scheduled_publish_at_ms = ?, created_at_ms = ? WHERE id = ?")
    .bind(status, report ? JSON.stringify(report) : null, extra.reviewReason ?? null, extra.scheduledAtMs ?? null, Date.now() + counter, id)
    .run();
  return id;
}
const setAge = (years: number) => env.DB.prepare("UPDATE games SET minimum_player_age_years = ?, account_requirement = ? WHERE slug = 'hop'").bind(years, years > 13 ? "whole_game" : "none").run();
const statusOf = async (id: string) => (await versionById(env.DB, id))!.scan_status;

beforeEach(async () => {
  await env.DB.exec(
    "DELETE FROM tester_links; DELETE FROM game_images; DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;",
  );
  const all = await env.GAMES.list();
  if (all.objects.length) await env.GAMES.delete(all.objects.map((object) => object.key));
  await createAccount(env.DB, { id: "dev-gore", username: "Gore_Maker", ageBand: "18+" });
  await letPublish(env.DB, "dev-gore");
  token = (await createApiKey(env.DB, "dev-gore", "laptop")).token;
  expect((await api("/games", { body: { title: "Hop" } })).status).toBe(201);
});

describe("needsLifelikeGoreAge", () => {
  it("is true for the finding at any severity", () => {
    expect(needsLifelikeGoreAge(null)).toBe(false);
    expect(needsLifelikeGoreAge(reportOf("approved"))).toBe(false);
    expect(needsLifelikeGoreAge(reportOf("held", GORE))).toBe(true);
    expect(needsLifelikeGoreAge(reportOf("approved", { ...GORE, severity: "info" }))).toBe(true);
  });
});

describe("the scan", () => {
  it("holds lifelike gore on a game for everyone 13 and up, with both fixes", async () => {
    const id = await makeVersion("scanning", null);
    const report = await scanVersion(testEnv, id, aiFinds(GORE));
    expect(report.decision).toBe("held");
    expect(await statusOf(id)).toBe("held");
    const version = ((await (await api(`/games/hop/versions/${id}`)).json()) as { version: { findings: { code: string; fix: string }[] } }).version;
    expect(version.findings[0]).toMatchObject({ code: "ai_lifelike_gore" });
    expect(version.findings[0]!.fix).toContain("minimum_player_age_years 16");
    expect(version.findings[0]!.fix).toContain("stylized");
  });

  it("passes it on a game for 16 and up, keeping the finding as info", async () => {
    await setAge(16);
    const id = await makeVersion("scanning", null);
    const report = await scanVersion(testEnv, id, aiFinds(GORE));
    expect(report.decision).toBe("approved");
    expect(await statusOf(id)).toBe("approved");
    expect(report.findings).toMatchObject([{ code: "ai_lifelike_gore", severity: "info" }]);
  });

  it("still holds a game for 16 and up that has another hold finding", async () => {
    await setAge(16);
    const id = await makeVersion("scanning", null);
    const report = await scanVersion(testEnv, id, aiFinds(GORE, OTHER_HOLD));
    expect(report.decision).toBe("held");
    expect(await statusOf(id)).toBe("held");
  });
});

describe("setting the game for 16 and up", () => {
  it("passes a version held only for lifelike gore, and points at it", async () => {
    const id = await makeVersion("held", reportOf("held", GORE));
    const res = await api("/games/hop", { method: "PATCH", body: { minimum_player_age_years: 16 } });
    expect(res.status).toBe(200);
    const answer = (await res.json()) as { next_steps: { tool: string; arguments: { version_id?: string } }[] };
    expect(answer.next_steps[0]).toMatchObject({ tool: "get_version", arguments: { slug: "hop", version_id: id } });
    expect(await statusOf(id)).toBe("approved");
    const report = JSON.parse((await versionById(env.DB, id))!.scan_report!) as ScanReport;
    expect(report).toMatchObject({ decision: "approved", findings: [{ code: "ai_lifelike_gore", severity: "info" }] });
  });

  it("leaves a version held for gore and something else", async () => {
    const id = await makeVersion("held", reportOf("held", GORE, OTHER_HOLD));
    await api("/games/hop", { method: "PATCH", body: { minimum_player_age_years: 16 } });
    expect(await statusOf(id)).toBe("held");
  });

  it("leaves a version a person decided", async () => {
    const id = await makeVersion("held", reportOf("held", GORE), { reviewReason: JSON.stringify({ code: "ai_other", message: "Looked at.", content_rule: null }) });
    await api("/games/hop", { method: "PATCH", body: { minimum_player_age_years: 16 } });
    expect(await statusOf(id)).toBe("held");
  });
});

describe("lowering the age", () => {
  it("is refused while the live version shows lifelike gore, and allowed with a stylized one", async () => {
    await setAge(16);
    const gore = await makeVersion("approved", reportOf("approved", { ...GORE, severity: "info" }));
    const game = (await gameBySlug(env.DB, "hop"))!;
    await env.DB.prepare("UPDATE games SET review_status = 'live', live_version_id = ? WHERE id = ?").bind(gore, game.id).run();
    const refused = await api("/games/hop", { method: "PATCH", body: { minimum_player_age_years: 13 } });
    expect(refused.status).toBe(409);
    expect(await refusal(refused)).toMatchObject({ code: "content_needs_minimum_age", field: "minimum_player_age_years" });
    expect((await gameBySlug(env.DB, "hop"))!.minimum_player_age_years).toBe(16);

    const stylized = await makeVersion("approved", reportOf("approved"));
    await env.DB.prepare("UPDATE games SET live_version_id = ? WHERE id = ?").bind(stylized, game.id).run();
    expect((await api("/games/hop", { method: "PATCH", body: { minimum_player_age_years: 13 } })).status).toBe(200);
  });

  it("is refused while a scheduled version or a tester link's version shows it", async () => {
    await setAge(16);
    const scheduled = await makeVersion("approved", reportOf("approved", { ...GORE, severity: "info" }), { scheduledAtMs: Date.now() + 3600_000 });
    expect((await api("/games/hop", { method: "PATCH", body: { minimum_player_age_years: 13 } })).status).toBe(409);
    await env.DB.prepare("UPDATE versions SET scheduled_publish_at_ms = NULL WHERE id = ?").bind(scheduled).run();
    // A draft kept for rollback doesn't block it, a tester link opening it does.
    expect((await api("/games/hop", { method: "PATCH", body: { minimum_player_age_years: 13 } })).status).toBe(200);
    await setAge(16);
    const game = (await gameBySlug(env.DB, "hop"))!;
    await addTesterLink(env.DB, game.id, "Team", { versionChoice: "picked", pickedVersionId: scheduled, endsAtMs: null });
    const refused = await api("/games/hop", { method: "PATCH", body: { minimum_player_age_years: 13 } });
    expect(refused.status).toBe(409);
    expect((await refusal(refused)).message).toContain(scheduled);
  });
});

describe("a version with lifelike gore on a game for everyone 13 and up", () => {
  let gore = "";
  beforeEach(async () => {
    gore = await makeVersion("approved", reportOf("approved", { ...GORE, severity: "info" }));
  });

  it("can't be published, scheduled or picked for a tester link", async () => {
    const publish = await api(`/games/hop/versions/${gore}/publish`, { method: "POST" });
    expect(publish.status).toBe(409);
    expect(await refusal(publish)).toMatchObject({ code: "content_needs_minimum_age", field: "version_id" });
    const scheduled = await api(`/games/hop/versions/${gore}/publish`, { body: { scheduled_publish_at: new Date(Date.now() + 3600_000).toISOString() } });
    expect(scheduled.status).toBe(409);
    expect((await versionById(env.DB, gore))!.scheduled_publish_at_ms).toBeNull();
    const tester = await api("/games/hop/testers", { body: { name: "Team", version_choice: "picked", picked_version_id: gore } });
    expect(tester.status).toBe(409);
    expect(await refusal(tester)).toMatchObject({ code: "content_needs_minimum_age", field: "picked_version_id" });
    expect((await gameBySlug(env.DB, "hop"))!.live_version_id).toBeNull();
  });

  it("answers the same through the MCP", async () => {
    const publish = await mcp("publish_version", { slug: "hop", version_id: gore });
    expect(publish.isError).toBe(true);
    expect(publish.structuredContent.error).toMatchObject({ code: "content_needs_minimum_age" });
  });

  it("publishes once the game is for 16 and up", async () => {
    await setAge(16);
    expect((await api(`/games/hop/versions/${gore}/publish`, { method: "POST" })).status).toBe(200);
    expect((await gameBySlug(env.DB, "hop"))!.live_version_id).toBe(gore);
  });

  it("isn't published at its scheduled time after the age is lowered", async () => {
    await setAge(16);
    const at = Date.now() + 3600_000;
    expect((await api(`/games/hop/versions/${gore}/publish`, { body: { scheduled_publish_at: new Date(at).toISOString() } })).status).toBe(200);
    // The race the call can't catch: the age drops after the schedule was made.
    await setAge(13);
    expect(await publishDue(env, at + 1)).toBe(0);
    expect((await versionById(env.DB, gore))!.scheduled_publish_at_ms).toBeNull();
    expect((await gameBySlug(env.DB, "hop"))!.live_version_id).toBeNull();
  });
});
