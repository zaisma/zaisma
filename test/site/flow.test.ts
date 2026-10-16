import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { KNOWN_IMAGE_CODE, arachnidShield, gameBySlug, notConnected, versionById, type ImageMatcher, type ScanJob, type ScanReport } from "@zaisma/core";
import { handleScanBatch, imageMatcher, queueImageChecks, recheckImages, scanVersion, type ScanDeps } from "../../apps/site/src/scan.ts";
import { dailyCleanup } from "../../apps/site/src/cleanup.ts";
import type { AiResult } from "../../apps/site/src/ai.ts";
import { CLEAN_GAME, makeZip } from "../helpers.ts";

const LOCAL = "http://localhost";
const testEnv = { ...env, DEV_ADMIN: "1", ANTHROPIC_API_KEY: "test-key" };

const connected: ImageMatcher = { check: async (imgs) => ({ provider: "test", isConnected: true, checkedMediaCount: imgs.length, findings: [] }) };

const bytes = (...parts: (number[] | string)[]) => new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
const picture = (tail: string) => bytes([0x89], "PNG\r\n\x1a\n", tail);
// A stand-in for Arachnid Shield: files whose bytes end in "BAD" match. It records what it was sent.
let sent: { type: string; body: string }[] = [];
const shield = arachnidShield("user:pass", {
  baseUrl: "https://shield.test",
  fetch: (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = await new Response(init!.body).text();
    sent.push({ type: new Headers(init!.headers).get("content-type")!, body });
    const bad = body.endsWith("BAD");
    return new Response(JSON.stringify({ classification: bad ? "csam" : "no-known-match", match_type: bad ? "exact" : null }));
  }) as typeof fetch,
});
const aiSays = (verdict: "pass" | "hold" | "reject", isChildSafety = false): ScanDeps["ai"] => async () =>
  ({
    report: { model: "test", verdict, summary: `AI says ${verdict}`, input_token_count: 1000, output_token_count: 100 },
    findings: verdict === "pass" ? [] : [{ stage: "ai", severity: verdict, code: "ai_other", message: "test concern" }],
    isChildSafety,
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
  sent = [];
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
    expect((await gameBySlug(env.DB, "test-game"))?.review_status).toBe("pending");
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
    expect(report.findings.map((f) => f.code)).toContain("image_matching_off");
    expect((await gameBySlug(env.DB, "test-game"))?.review_status).toBe("pending");
  });

  it("publishes a clean game automatically once every check is connected", async () => {
    const { report } = await uploadAndScan(CLEAN_GAME, { images: connected, ai: aiSays("pass") });
    expect(report.decision).toBe("approved");
    const game = await gameBySlug(env.DB, "test-game");
    expect(game?.review_status).toBe("live");

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
    expect(report.is_child_safety).toBe(true);
    expect((await versionById(env.DB, versionId))?.scan_status).toBe("held");
  });

  it("holds games without calling the AI once the monthly budget is used", async () => {
    await env.DB.prepare("INSERT INTO ai_usage (month, input_token_count, output_token_count, scan_call_count) VALUES (?, 99999999999, 0, 1)").bind(new Date().toISOString().slice(0, 7)).run();
    let called = false;
    const { report } = await uploadAndScan(CLEAN_GAME, { images: connected, ai: async (...a) => ((called = true), aiSays("pass")(...a)) });
    expect(called).toBe(false);
    expect(report.decision).toBe("held");
    expect(report.findings.map((f) => f.code)).toContain("ai_review_budget_used");
  });

  it("lets the admin approve a held game", async () => {
    const { versionId, gameId } = await uploadAndScan(CLEAN_GAME, { images: notConnected, ai: aiSays("pass") });
    const res = await SELF.fetch(`${LOCAL}/admin/versions/${versionId}/approve`, { method: "POST", body: new FormData(), redirect: "manual" });
    expect(res.status).toBe(303);
    expect((await gameBySlug(env.DB, "test-game"))?.review_status).toBe("live");
    const detail = await (await SELF.fetch(`${LOCAL}/admin/games/${gameId}`)).text();
    expect(detail).toContain("approved");
    expect(detail).toContain("dev@localhost");
  });

  it("connects Arachnid Shield only when its key is set", () => {
    expect(imageMatcher(env)).toBe(notConnected);
    expect(imageMatcher({ ...env, ARACHNID_SHIELD_KEY: "user:pass" })).not.toBe(notConnected);
  });

  it("holds known abuse images, keeps them from the AI and never lets them be approved", async () => {
    let aiCalled = false;
    const files = { ...CLEAN_GAME, "art/hero.png": picture("fine"), "art/other.png": picture("BAD") };
    const { report, versionId, gameId } = await uploadAndScan(files, { images: shield, ai: async (...a) => ((aiCalled = true), aiSays("pass")(...a)) });
    expect(sent.map((s) => s.type)).toEqual(["image/png", "image/png"]);
    expect(report.decision).toBe("held");
    expect(report.is_child_safety).toBe(true);
    expect(report.images).toEqual({ provider: "arachnid-shield", is_connected: true, checked_media_count: 2 });
    expect(report.findings.filter((f) => f.code === KNOWN_IMAGE_CODE).map((f) => f.path)).toEqual(["art/other.png"]);
    expect(aiCalled).toBe(false);
    expect(report.ai?.verdict).toBe("skipped");

    // Nothing is deleted, and a person can't approve it, only keep it off.
    expect(await env.GAMES.head(`games/${gameId}/${versionId}/art/other.png`)).not.toBeNull();
    const detail = await (await SELF.fetch(`${LOCAL}/admin/games/${gameId}`)).text();
    expect(detail).toContain("Known abuse images");
    expect(detail).not.toContain(`/admin/versions/${versionId}/approve`);
    expect(detail).toContain(`/admin/versions/${versionId}/reject`);
    const approve = await SELF.fetch(`${LOCAL}/admin/versions/${versionId}/approve`, { method: "POST", body: new FormData(), redirect: "manual" });
    expect(approve.status).toBe(409);
    expect((await versionById(env.DB, versionId))?.scan_status).toBe("held");
    expect((await gameBySlug(env.DB, "test-game"))?.review_status).toBe("pending");
  });

  it("finds pictures and videos under other names, inside code, and in videos, but not in sound", async () => {
    const webm = (codec: string, tail = "") => bytes([0x1a, 0x45, 0xdf, 0xa3], "webm", [0x86, codec.length + 0x80], codec, tail);
    const files = {
      ...CLEAN_GAME,
      "index.html": `<!doctype html><img src="data:image/png;base64,${btoa(String.fromCharCode(...picture("x".repeat(60) + "BAD")))}"><script src="game.js"></script>`,
      "data/level.dat": picture("BAD"),
      "assets/data.json": picture("fine"),
      "audio/theme.mp3": bytes("ID3", [4, 0, 0, 0], "music"),
      "audio/theme.webm": webm("A_OPUS"),
      "video/intro.webm": webm("V_VP9"),
      "video/outro.mp4": bytes([0, 0, 0, 0x18], "ftypisom", [0, 0, 2, 0], "BAD"),
    };
    const { report } = await uploadAndScan(files, { images: shield, ai: aiSays("pass") });
    expect(sent.map((s) => `${s.type}`).sort()).toEqual(["image/png", "image/png", "image/png", "video/mp4", "video/webm"]);
    expect(report.findings.filter((f) => f.code === KNOWN_IMAGE_CODE).map((f) => f.path).sort()).toEqual(["data/level.dat", "index.html (picture 1 in the code)", "video/outro.mp4"]);
    expect(report.decision).toBe("held");
  });

  it("matches games that passed before matching was connected, once, and hides a live one that matches", async () => {
    // Approved by a person while matching wasn't connected, and live.
    const clean = await uploadAndScan(CLEAN_GAME, { images: notConnected, ai: aiSays("pass") }, "clean-game");
    const bad = await uploadAndScan({ ...CLEAN_GAME, "art/pic.bin": picture("BAD") }, { images: notConnected, ai: aiSays("pass") }, "bad-game");
    for (const v of [clean, bad]) await SELF.fetch(`${LOCAL}/admin/versions/${v.versionId}/approve`, { method: "POST", body: new FormData(), redirect: "manual" });
    expect((await gameBySlug(env.DB, "bad-game"))?.review_status).toBe("live");

    expect(await queueImageChecks(env, notConnected)).toBe(0);
    expect(await queueImageChecks(env, shield)).toBe(2);
    const deps = { images: shield, ai: aiSays("pass") };
    await recheckImages(testEnv, clean.versionId, deps);
    await recheckImages(testEnv, bad.versionId, deps);

    // The clean one is noted as checked and stays up; it isn't queued again.
    expect((await gameBySlug(env.DB, "clean-game"))?.review_status).toBe("live");
    expect(JSON.parse((await versionById(env.DB, clean.versionId))!.scan_report!).images).toMatchObject({ provider: "arachnid-shield", is_connected: true });
    expect(await queueImageChecks(env, shield)).toBe(0);

    // The matching one comes off at once, keeps its files, and can't be put back.
    const v = (await versionById(env.DB, bad.versionId))!;
    expect(v.scan_status).toBe("held");
    expect(v.preview_token).toBeNull();
    expect((JSON.parse(v.scan_report!) as ScanReport).is_child_safety).toBe(true);
    expect((await gameBySlug(env.DB, "bad-game"))?.review_status).toBe("held");
    expect(await env.GAMES.head(`games/${bad.gameId}/${bad.versionId}/art/pic.bin`)).not.toBeNull();
    const restore = await (await SELF.fetch(`${LOCAL}/admin/games/${bad.gameId}/restore`, { method: "POST", body: new FormData() })).text();
    expect(restore).toContain("matched known abuse material");
    expect((await gameBySlug(env.DB, "bad-game"))?.review_status).toBe("held");
    const game = await SELF.fetch(`${LOCAL}/g/bad-game`);
    expect(game.status).not.toBe(200);
  });

  it("runs an image check queued before migration 0034 as an image check, never as a full scan", async () => {
    const clean = await uploadAndScan(CLEAN_GAME, { images: notConnected, ai: aiSays("pass") }, "clean-game");
    await SELF.fetch(`${LOCAL}/admin/versions/${clean.versionId}/approve`, { method: "POST", body: new FormData(), redirect: "manual" });
    let aiCallCount = 0;
    const settled: string[] = [];
    const message = { body: { versionId: clean.versionId, images: true }, attempts: 1, ack: () => settled.push("ack"), retry: () => settled.push("retry") };
    await handleScanBatch({ messages: [message] } as unknown as MessageBatch<ScanJob>, testEnv, { images: shield, ai: async (...input) => ((aiCallCount++), aiSays("pass")(...input)) });
    expect(settled).toEqual(["ack"]);
    expect(aiCallCount).toBe(0);
    expect(JSON.parse((await versionById(env.DB, clean.versionId))!.scan_report!).images).toMatchObject({ provider: "arachnid-shield", is_connected: true });
  });

  it("publishes a clean game with pictures once Arachnid Shield passes them", async () => {
    const shield = arachnidShield("user:pass", { fetch: (async () => new Response(JSON.stringify({ classification: "no-known-match" }))) as typeof fetch });
    const { report } = await uploadAndScan({ ...CLEAN_GAME, "a.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) }, { images: shield, ai: aiSays("pass") });
    expect(report.decision).toBe("approved");
    expect(report.images.checked_media_count).toBe(1);
  });

  it("keeps players on the old version while a new one is held", async () => {
    const first = await uploadAndScan(CLEAN_GAME, { images: connected, ai: aiSays("pass") });
    await uploadAndScan({ ...CLEAN_GAME, "index.html": "<p>v2</p>" }, { images: connected, ai: aiSays("hold") });
    const game = await gameBySlug(env.DB, "test-game");
    expect(game?.review_status).toBe("live");
    expect(game?.live_version_id).toBe(first.versionId);
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
    expect(row?.player_text).toBe("won't load");
    expect(JSON.stringify(row)).not.toContain("203.0.113.9");
    const cols = (await env.DB.prepare("PRAGMA table_info(reports)").all<{ name: string }>()).results.map((c) => c.name);
    expect(cols.sort()).toEqual(["bug_report_at_ms", "closed_at_ms", "game_id", "has_picture", "id", "is_bug_report", "player_id", "player_name", "player_reason", "player_text", "precedent_id", "reason", "report_group_id", "report_status", "reported_at_ms", "room_code", "room_name", "severity_index", "triage", "triage_attempt_count", "triaged_at_ms", "version_id"]);
    expect((await gameBySlug(env.DB, "test-game"))?.review_status).toBe("live");
  });

  it("hides a game straight away on a child-safety report", async () => {
    await liveGame();
    await report("child_safety");
    expect((await gameBySlug(env.DB, "test-game"))?.review_status).toBe("held");
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
    expect(await res.json()).toEqual({ has_reported: true, is_game_hidden: false, is_update_paused: false });
    const row = await env.DB.prepare("SELECT * FROM reports").first<Record<string, unknown>>();
    expect(row).toMatchObject({ reason: "broken", player_text: "stuck on level 2", version_id: versionId, room_code: "ABCDEF", player_id: "" });
    expect(JSON.stringify(row)).not.toContain("203.0.113.");
  });

  it("takes a report about a player, with their temporary ID, and leaves the game up", async () => {
    await liveGame();
    const res = await fromPlate({ reason: "sexual", details: "", room: "ABCDEF", player: { id: "player_0123456789abcdef", name: "Swift Fox 42" } });
    expect(await res.json()).toEqual({ has_reported: true, is_game_hidden: false, is_update_paused: false });
    const row = await env.DB.prepare("SELECT * FROM reports").first<Record<string, unknown>>();
    expect(row).toMatchObject({ reason: "player", player_reason: "sexual", player_id: "player_0123456789abcdef", player_name: "Swift Fox 42", room_code: "ABCDEF" });
    expect((await gameBySlug(env.DB, "test-game"))?.review_status).toBe("live");
    expect((await fromPlate({ reason: "cheating", player: { id: "<script>", name: "x" } })).status).toBe(400);
  });

  it("says when a report hid the game", async () => {
    await liveGame();
    expect(await (await fromPlate({ reason: "child_safety" })).json()).toEqual({ has_reported: true, is_game_hidden: true, is_update_paused: false });
    expect((await gameBySlug(env.DB, "test-game"))?.review_status).toBe("held");
  });

  const DAY = 86400_000;
  const live = async () => (await gameBySlug(env.DB, "test-game"))!;

  it("pauses a recent update instead of hiding an established game, once", async () => {
    const first = await liveGame();
    await env.DB.prepare("UPDATE versions SET published_at_ms = ? WHERE id = ?").bind(Date.now() - 30 * DAY, first.versionId).run();
    const update = await uploadAndScan({ ...CLEAN_GAME, "index.html": "<p>v2</p>" }, { images: connected, ai: aiSays("pass") });
    expect((await live()).live_version_id).toBe(update.versionId);

    expect(await (await fromPlate({ reason: "child_safety" })).json()).toEqual({ has_reported: true, is_game_hidden: false, is_update_paused: true });
    expect(await live()).toMatchObject({ review_status: "live", live_version_id: first.versionId });
    expect((await versionById(env.DB, update.versionId))?.scan_status).toBe("held");

    // The version players went back to can't be paused again by reports.
    expect(await (await fromPlate({ reason: "illegal" })).json()).toEqual({ has_reported: true, is_game_hidden: false, is_update_paused: false });
    expect(await live()).toMatchObject({ review_status: "live", live_version_id: first.versionId });

    // A person puts the update back in one click, and then reports can't pause it either.
    await SELF.fetch(`${LOCAL}/admin/versions/${update.versionId}/approve`, { method: "POST", body: new FormData(), redirect: "manual" });
    expect((await live()).live_version_id).toBe(update.versionId);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE report_status = 'open'").first("n")).toBe(0);
    expect(await (await fromPlate({ reason: "child_safety" })).json()).toEqual({ has_reported: true, is_game_hidden: false, is_update_paused: false });
    expect((await live()).live_version_id).toBe(update.versionId);
  });

  it("leaves an established game up when its version is more than a week old", async () => {
    const { versionId } = await liveGame();
    await env.DB.prepare("UPDATE versions SET published_at_ms = ? WHERE id = ?").bind(Date.now() - 8 * DAY, versionId).run();
    expect(await (await fromPlate({ reason: "child_safety" })).json()).toEqual({ has_reported: true, is_game_hidden: false, is_update_paused: false });
    expect((await live()).review_status).toBe("live");
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM reports").first("n")).toBe(1);
  });

  it("hides a brand-new game only until a person clears it", async () => {
    const { gameId } = await liveGame();
    expect(await (await fromPlate({ reason: "illegal" })).json()).toEqual({ has_reported: true, is_game_hidden: true, is_update_paused: false });
    await SELF.fetch(`${LOCAL}/admin/games/${gameId}/restore`, { method: "POST", body: new FormData(), redirect: "manual" });
    expect((await live()).review_status).toBe("live");
    expect(await (await fromPlate({ reason: "child_safety" })).json()).toEqual({ has_reported: true, is_game_hidden: false, is_update_paused: false });
    expect((await live()).review_status).toBe("live");
  });

  it("refuses plate reports sent from other sites", async () => {
    await liveGame();
    expect((await fromPlate({ reason: "broken" }, "test-game", "https://evil.example")).status).toBe(403);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM reports").first("n")).toBe(0);
  });

  it("takes reports on private games, and answers the same for games that don't exist", async () => {
    await liveGame();
    await env.DB.exec("UPDATE games SET visibility = 'private'");
    expect(await (await fromPlate({ reason: "broken" })).json()).toEqual({ has_reported: true, is_game_hidden: false, is_update_paused: false });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM reports").first("n")).toBe(1);
    expect(await (await fromPlate({ reason: "broken" }, "no-such-game")).json()).toEqual({ has_reported: true, is_game_hidden: false, is_update_paused: false });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM reports").first("n")).toBe(1);
    // The plain form never shows a private game's name.
    expect(await (await SELF.fetch(`${LOCAL}/g/test-game/report`)).text()).not.toContain("Test Game");
  });

  // The start of a JPEG is enough for the server's check.
  const JPEG = "data:image/jpeg;base64," + btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4));

  it("keeps a picture of the game when the player includes one, and shows it only in admin", async () => {
    const { gameId } = await liveGame();
    await fromPlate({ reason: "sexual", details: "on level 5", picture: JPEG });
    const row = await env.DB.prepare("SELECT id, has_picture FROM reports").first<{ id: string; has_picture: number }>();
    expect(row?.has_picture).toBe(1);
    expect(await env.GAMES.head(`report-pictures/${row!.id}.jpg`)).not.toBeNull();
    const pic = await SELF.fetch(`${LOCAL}/admin/reports/${row!.id}/picture`);
    expect(pic.headers.get("content-type")).toBe("image/jpeg");
    expect(await (await SELF.fetch(`${LOCAL}/admin/games/${gameId}`)).text()).toContain(`/admin/reports/${row!.id}/picture`);
  });

  it("never keeps a picture with a child-safety report, or anything that isn't a JPEG", async () => {
    await liveGame();
    await fromPlate({ reason: "child_safety", picture: JPEG });
    await fromPlate({ reason: "broken", picture: "data:image/png;base64,iVBORw0KGgo=" });
    expect((await env.DB.prepare("SELECT has_picture FROM reports").all<{ has_picture: number }>()).results).toEqual([{ has_picture: 0 }, { has_picture: 0 }]);
    expect((await env.GAMES.list({ prefix: "report-pictures/" })).objects).toHaveLength(0);
  });

  it("deletes pictures 30 days after the report is closed", async () => {
    const { gameId } = await liveGame();
    await fromPlate({ reason: "broken", picture: JPEG });
    await dailyCleanup(env, Date.now() + 60 * 86400_000);
    expect((await env.GAMES.list({ prefix: "report-pictures/" })).objects).toHaveLength(1); // Still open.
    await SELF.fetch(`${LOCAL}/admin/games/${gameId}/dismiss`, { method: "POST", body: new FormData(), redirect: "manual" });
    expect((await dailyCleanup(env, Date.now() + 29 * 86400_000)).deletedPictureCount).toBe(0);
    expect((await dailyCleanup(env, Date.now() + 31 * 86400_000)).deletedPictureCount).toBe(1);
    expect((await env.GAMES.list({ prefix: "report-pictures/" })).objects).toHaveLength(0);
    expect(await env.DB.prepare("SELECT has_picture FROM reports").first("has_picture")).toBe(0);
  });

  it("refuses an unknown reason", async () => {
    await liveGame();
    await report("lol");
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM reports").first("n")).toBe(0);
  });

  it("takes a game down in one step, with the rule it broke and a reason in the audit log", async () => {
    const { gameId } = await liveGame();
    const noReason = await SELF.fetch(`${LOCAL}/admin/games/${gameId}/takedown`, { method: "POST", body: new FormData() });
    expect(await noReason.text()).toContain("Pick the rule it broke and say why");
    const noRule = new FormData();
    noRule.set("reason", "DMCA notice from the artist");
    expect(await (await SELF.fetch(`${LOCAL}/admin/games/${gameId}/takedown`, { method: "POST", body: noRule })).text()).toContain("Pick the rule it broke");
    expect((await SELF.fetch(`${LOCAL}/g/test-game`)).status).toBe(200);

    const form = new FormData();
    form.set("reason", "DMCA notice from the artist");
    form.set("content_rule", "copyright_notice");
    await SELF.fetch(`${LOCAL}/admin/games/${gameId}/takedown`, { method: "POST", body: form, redirect: "manual" });
    expect((await SELF.fetch(`${LOCAL}/g/test-game`)).status).toBe(410);
    expect(await (await SELF.fetch(`${LOCAL}/`)).text()).not.toContain("/g/test-game");
    const log = await env.DB.prepare("SELECT action, reason, actor FROM audit_log WHERE action = 'takedown'").first();
    expect(log).toEqual({ action: "takedown", reason: "DMCA notice from the artist", actor: "dev@localhost" });
    const removed = await env.DB.prepare("SELECT review_status, review_reason FROM games WHERE id = ?").bind(gameId).first<{ review_status: string; review_reason: string }>();
    expect(removed!.review_status).toBe("removed");
    expect(JSON.parse(removed!.review_reason)).toEqual({ code: "copyright_notice", message: "DMCA notice from the artist", content_rule: "copyright" });

    await SELF.fetch(`${LOCAL}/admin/games/${gameId}/restore`, { method: "POST", body: new FormData(), redirect: "manual" });
    expect((await SELF.fetch(`${LOCAL}/g/test-game`)).status).toBe(200);
    expect(await env.DB.prepare("SELECT review_reason FROM games WHERE id = ?").bind(gameId).first("review_reason")).toBeNull();
  });
});

describe("pages", () => {
  it("escapes game text", async () => {
    await env.DB.prepare("INSERT INTO games (id, slug, title, description, review_status, live_version_id, created_at_ms, updated_at_ms) VALUES ('x1', 'xss-game', '<script>alert(1)</script>', '\"><img onerror=1>', 'live', 'v1', 0, 0)").run();
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
