import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { gameBySlug, notConnected, versionById, type ImageMatcher, type ScanReport } from "@zaisma/core";
import { scanVersion, type ScanDeps } from "../../apps/site/src/scan.ts";
import type { AiResult } from "../../apps/site/src/ai.ts";
import { CLEAN_GAME, makeZip } from "../helpers.ts";

const LOCAL = "http://localhost";
const testEnv = { ...env, DEV_ADMIN: "1", ANTHROPIC_API_KEY: "test-key" };

const connected: ImageMatcher = { check: async (imgs) => ({ provider: "test", connected: true, checked: imgs.length, findings: [] }) };
const aiSays = (verdict: "pass" | "hold" | "reject", childSafety = false): ScanDeps["ai"] => async () =>
  ({
    report: { model: "test", verdict, summary: `AI says ${verdict}`, inputTokens: 1000, outputTokens: 100 },
    findings: verdict === "pass" ? [] : [{ stage: "ai", severity: verdict, rule: "ai-test", detail: "test concern" }],
    childSafety,
  }) satisfies AiResult;

async function upload(files: Record<string, string | Uint8Array>, slug = "test-game", origin?: string) {
  const form = new FormData();
  form.set("title", "Test Game");
  form.set("slug", slug);
  form.set("description", "A test.");
  form.set("zip", new File([makeZip(files)], "game.zip", { type: "application/zip" }));
  return SELF.fetch(`${LOCAL}/admin/api/games`, { method: "POST", body: form, headers: origin ? { Origin: origin } : {} });
}

async function uploadAndScan(files: Record<string, string | Uint8Array>, deps: ScanDeps, slug = "test-game") {
  const res = await upload(files, slug);
  expect(res.status).toBe(201);
  const body = (await res.json()) as { versionId: string; gameId: string };
  const report = await scanVersion(testEnv, body.versionId, deps);
  return { ...body, report };
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM reports; DELETE FROM audit_log; DELETE FROM versions; DELETE FROM games; DELETE FROM ai_usage;");
  const all = await env.GAMES.list();
  if (all.objects.length) await env.GAMES.delete(all.objects.map((o) => o.key));
});

describe("upload", () => {
  it("stores the files and queues a scan", async () => {
    const res = await upload(CLEAN_GAME);
    expect(res.status).toBe(201);
    const { versionId, gameId } = (await res.json()) as { versionId: string; gameId: string };
    const v = await versionById(env.DB, versionId);
    expect(v?.scan_status).toBe("scanning");
    expect(v?.file_count).toBe(3);
    expect(await env.GAMES.head(`games/${gameId}/${versionId}/index.html`)).not.toBeNull();
    expect((await gameBySlug(env.DB, "test-game"))?.status).toBe("pending");
  });

  it("explains bad zips and leaves nothing behind", async () => {
    const res = await upload({ ...CLEAN_GAME, "a.png": new Uint8Array([0x4d, 0x5a, 0, 0]) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/Windows program/);
    expect(await gameBySlug(env.DB, "test-game")).toBeNull();
    expect((await env.GAMES.list({ prefix: "games/" })).objects).toHaveLength(0);
  });

  it("refuses reserved link names", async () => {
    const res = await upload(CLEAN_GAME, "admin");
    expect(res.status).toBe(400);
  });

  it("refuses admin posts from other sites", async () => {
    expect((await upload(CLEAN_GAME, "test-game", "https://evil.example")).status).toBe(403);
  });
});

describe("admin lock", () => {
  it("refuses admin pages without a Cloudflare Access login", async () => {
    expect((await SELF.fetch("https://zaisma.test/admin")).status).toBe(403);
    expect((await SELF.fetch("https://zaisma.test/admin/api/games", { method: "POST" })).status).toBe(403);
    expect((await SELF.fetch("https://zaisma.test/admin", { headers: { "Cf-Access-Jwt-Assertion": "a.b.c" } })).status).toBe(403);
  });

  it("opens on localhost in dev", async () => {
    expect((await SELF.fetch(`${LOCAL}/admin`)).status).toBe(200);
  });
});

describe("scan and publish", () => {
  it("holds every game while image matching isn't connected", async () => {
    const { report } = await uploadAndScan(CLEAN_GAME, { images: notConnected, ai: aiSays("pass") });
    expect(report.decision).toBe("held");
    expect(report.findings.map((f) => f.rule)).toContain("image-matching-not-connected");
    expect((await gameBySlug(env.DB, "test-game"))?.status).toBe("pending");
  });

  it("publishes a clean game automatically once every check is connected", async () => {
    const { report } = await uploadAndScan(CLEAN_GAME, { images: connected, ai: aiSays("pass") });
    expect(report.decision).toBe("approved");
    const game = await gameBySlug(env.DB, "test-game");
    expect(game?.status).toBe("live");

    const home = await (await SELF.fetch(`${LOCAL}/`)).text();
    expect(home).toContain("/g/test-game");
    const page = await SELF.fetch(`${LOCAL}/g/test-game`);
    const html = await page.text();
    expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-pointer-lock"');
    expect(html).not.toContain("allow-top-navigation");
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("rejects a crypto miner", async () => {
    const { report } = await uploadAndScan({ ...CLEAN_GAME, "game.js": "new CoinHive.Anonymous('k').start()" }, { images: connected, ai: aiSays("pass") });
    expect(report.decision).toBe("rejected");
  });

  it("holds what the AI holds", async () => {
    const { report } = await uploadAndScan(CLEAN_GAME, { images: connected, ai: aiSays("hold") });
    expect(report.decision).toBe("held");
  });

  it("holds (never rejects) child-safety flags so they can be reported", async () => {
    const { report, versionId } = await uploadAndScan(CLEAN_GAME, { images: connected, ai: aiSays("reject", true) });
    expect(report.decision).toBe("held");
    expect(report.childSafety).toBe(true);
    expect((await versionById(env.DB, versionId))?.scan_status).toBe("held");
  });

  it("holds games without calling the AI once the monthly budget is used", async () => {
    await env.DB.prepare("INSERT INTO ai_usage (month, input_tokens, output_tokens, scans) VALUES (?, 99999999999, 0, 1)").bind(new Date().toISOString().slice(0, 7)).run();
    let called = false;
    const { report } = await uploadAndScan(CLEAN_GAME, { images: connected, ai: async (...a) => ((called = true), aiSays("pass")(...a)) });
    expect(called).toBe(false);
    expect(report.decision).toBe("held");
    expect(report.findings.map((f) => f.rule)).toContain("ai-budget");
  });

  it("lets the admin approve a held game", async () => {
    const { versionId, gameId } = await uploadAndScan(CLEAN_GAME, { images: notConnected, ai: aiSays("pass") });
    const res = await SELF.fetch(`${LOCAL}/admin/versions/${versionId}/approve`, { method: "POST", body: new FormData(), redirect: "manual" });
    expect(res.status).toBe(303);
    expect((await gameBySlug(env.DB, "test-game"))?.status).toBe("live");
    const detail = await (await SELF.fetch(`${LOCAL}/admin/games/${gameId}`)).text();
    expect(detail).toContain("approved");
    expect(detail).toContain("dev@localhost");
  });

  it("keeps players on the old version while a new one is held", async () => {
    const first = await uploadAndScan(CLEAN_GAME, { images: connected, ai: aiSays("pass") });
    await uploadAndScan({ ...CLEAN_GAME, "index.html": "<p>v2</p>" }, { images: connected, ai: aiSays("hold") });
    const game = await gameBySlug(env.DB, "test-game");
    expect(game?.status).toBe("live");
    expect(game?.current_version_id).toBe(first.versionId);
  });
});

describe("reports and takedowns", () => {
  async function liveGame() {
    return uploadAndScan(CLEAN_GAME, { images: connected, ai: aiSays("pass") });
  }
  const report = (reason: string, details = "") => {
    const form = new FormData();
    form.set("reason", reason);
    form.set("details", details);
    return SELF.fetch(`${LOCAL}/g/test-game/report`, { method: "POST", body: form, headers: { "CF-Connecting-IP": "203.0.113.9" } });
  };

  it("stores a report with no reporter data", async () => {
    await liveGame();
    expect((await report("broken", "won't load")).status).toBe(200);
    const row = await env.DB.prepare("SELECT * FROM reports").first<Record<string, unknown>>();
    expect(row?.details).toBe("won't load");
    expect(JSON.stringify(row)).not.toContain("203.0.113.9");
    const cols = (await env.DB.prepare("PRAGMA table_info(reports)").all<{ name: string }>()).results.map((c) => c.name);
    expect(cols.sort()).toEqual(["created_at", "details", "game_id", "id", "player_id", "player_name", "player_reason", "reason", "room_code", "status", "version_id"]);
    expect((await gameBySlug(env.DB, "test-game"))?.status).toBe("live");
  });

  it("hides a game straight away on a child-safety report", async () => {
    await liveGame();
    await report("child_safety");
    expect((await gameBySlug(env.DB, "test-game"))?.status).toBe("held");
    expect((await SELF.fetch(`${LOCAL}/g/test-game`)).status).toBe(404);
  });

  // The plate beside the game sends JSON from zaisma.com itself.
  // Each report comes from its own address, so the rate limit stays out of the way.
  let address = 10;
  const fromPlate = (body: Record<string, unknown>, slug = "test-game", origin = LOCAL) =>
    SELF.fetch(`${LOCAL}/g/${slug}/report`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, "CF-Connecting-IP": `203.0.113.${address++}` }, body: JSON.stringify(body) });

  it("takes a report from the plate with the version and room, and nothing about the reporter", async () => {
    const { versionId } = await liveGame();
    const res = await fromPlate({ reason: "broken", details: "stuck on level 2", room: "abcdef" });
    expect(await res.json()).toEqual({ ok: true, hidden: false });
    const row = await env.DB.prepare("SELECT * FROM reports").first<Record<string, unknown>>();
    expect(row).toMatchObject({ reason: "broken", details: "stuck on level 2", version_id: versionId, room_code: "ABCDEF", player_id: "" });
    expect(JSON.stringify(row)).not.toContain("203.0.113.");
  });

  it("takes a report about a player, with their temporary ID, and leaves the game up", async () => {
    await liveGame();
    const res = await fromPlate({ reason: "sexual", details: "", room: "ABCDEF", player: { id: "g_0123456789abcdef", name: "Swift Fox 42" } });
    expect(await res.json()).toEqual({ ok: true, hidden: false });
    const row = await env.DB.prepare("SELECT * FROM reports").first<Record<string, unknown>>();
    expect(row).toMatchObject({ reason: "player", player_reason: "sexual", player_id: "g_0123456789abcdef", player_name: "Swift Fox 42", room_code: "ABCDEF" });
    expect((await gameBySlug(env.DB, "test-game"))?.status).toBe("live");
    expect((await fromPlate({ reason: "cheating", player: { id: "<script>", name: "x" } })).status).toBe(400);
  });

  it("says when a report hid the game", async () => {
    await liveGame();
    expect(await (await fromPlate({ reason: "child_safety" })).json()).toEqual({ ok: true, hidden: true });
    expect((await gameBySlug(env.DB, "test-game"))?.status).toBe("held");
  });

  it("refuses plate reports sent from other sites", async () => {
    await liveGame();
    expect((await fromPlate({ reason: "broken" }, "test-game", "https://evil.example")).status).toBe(403);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM reports").first("n")).toBe(0);
  });

  it("takes reports on private games, and answers the same for games that don't exist", async () => {
    await liveGame();
    await env.DB.exec("UPDATE games SET visibility = 'private'");
    expect(await (await fromPlate({ reason: "broken" })).json()).toEqual({ ok: true, hidden: false });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM reports").first("n")).toBe(1);
    expect(await (await fromPlate({ reason: "broken" }, "no-such-game")).json()).toEqual({ ok: true, hidden: false });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM reports").first("n")).toBe(1);
    // The plain form never shows a private game's name.
    expect(await (await SELF.fetch(`${LOCAL}/g/test-game/report`)).text()).not.toContain("Test Game");
  });

  it("refuses an unknown reason", async () => {
    await liveGame();
    await report("lol");
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM reports").first("n")).toBe(0);
  });

  it("takes a game down in one step, with a reason in the audit log", async () => {
    const { gameId } = await liveGame();
    const noReason = await SELF.fetch(`${LOCAL}/admin/games/${gameId}/takedown`, { method: "POST", body: new FormData() });
    expect(await noReason.text()).toContain("Give a reason");

    const form = new FormData();
    form.set("reason", "DMCA notice from the artist");
    await SELF.fetch(`${LOCAL}/admin/games/${gameId}/takedown`, { method: "POST", body: form, redirect: "manual" });
    expect((await SELF.fetch(`${LOCAL}/g/test-game`)).status).toBe(410);
    expect(await (await SELF.fetch(`${LOCAL}/`)).text()).not.toContain("/g/test-game");
    const log = await env.DB.prepare("SELECT action, reason, actor FROM audit_log WHERE action = 'takedown'").first();
    expect(log).toEqual({ action: "takedown", reason: "DMCA notice from the artist", actor: "dev@localhost" });

    await SELF.fetch(`${LOCAL}/admin/games/${gameId}/restore`, { method: "POST", body: new FormData(), redirect: "manual" });
    expect((await SELF.fetch(`${LOCAL}/g/test-game`)).status).toBe(200);
  });
});

describe("pages", () => {
  it("escapes game text", async () => {
    await env.DB.prepare("INSERT INTO games (id, slug, title, description, status, current_version_id, created_at, updated_at) VALUES ('x1', 'xss-game', '<script>alert(1)</script>', '\"><img onerror=1>', 'live', 'v1', 0, 0)").run();
    const home = await (await SELF.fetch(`${LOCAL}/`)).text();
    expect(home).not.toContain("<script>alert(1)");
    expect(home).toContain("&lt;script&gt;");
    expect(home).not.toContain('<img onerror');
  });

  it("serves the legal pages and the logo", async () => {
    expect((await SELF.fetch(`${LOCAL}/legal/dmca`)).status).toBe(200);
    expect((await SELF.fetch(`${LOCAL}/legal/content-rules`)).status).toBe(200);
    expect((await SELF.fetch(`${LOCAL}/nope`)).status).toBe(404);
  });
});
