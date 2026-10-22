import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { audit, monthStartDateOf, createAccount, createApiKey, createReport, gameBySlug, notConnected, type ImageMatcher } from "@zaisma/core";
import { scanVersion, type ScanDeps } from "../../apps/site/src/scan.ts";
import { judgeSays, readsNothing, seesNothing } from "./scan-stubs.ts";
import { TOOLS } from "../../apps/site/src/mcp.ts";
import { adminForm } from "../../apps/site/src/admin.ts";
import { ERROR } from "../../apps/site/src/schemas.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";
import { letPublish } from "../helpers.ts";

const SITE = "https://zaisma.test";
const testEnv = { ...env, ANTHROPIC_API_KEY: "test-key" };
const connected: ImageMatcher = { check: async (imgs) => ({ provider: "test", isConnected: true, checkedMediaCount: imgs.length, findings: [] }) };
const pass: ScanDeps = {
  images: connected,
  readCode: readsNothing,
  readPictures: seesNothing,
  judge: judgeSays("pass"),
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

/**
 * Call a tool; returns its result as data, or { error: its text, code, message, field, fix, retry_after_sec }
 * when the tool said no. Every answer must match the tool's output schema exactly, and every error the error's shape.
 */
async function tool(name: string, args: Record<string, unknown> = {}, key = token): Promise<any> {
  const res = await rpc({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }, key);
  expect(res.status).toBe(200);
  const { result } = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean; structuredContent?: { error: Record<string, unknown> } } };
  if (result.isError) {
    expect(errorProblems(result.structuredContent)).toEqual([]);
    const { message, fix, code } = result.structuredContent!.error;
    expect(result.content[0]!.text).toBe(`${message} ${fix} (${code})`);
    return { error: result.content[0]!.text, ...result.structuredContent!.error };
  }
  const schema = TOOLS.find((t) => t.name === name)?.outputSchema;
  if (schema) expect(schemaProblems(schema, result.structuredContent, name)).toEqual([]);
  return result.structuredContent;
}

/** Scan with everything connected, so it passes. */
async function passScan(id: string) {
  return scanVersion(testEnv, id, pass);
}

beforeEach(async () => {
  await env.DB.exec(
    "DELETE FROM reports; DELETE FROM room_usage; DELETE FROM game_server_errors; DELETE FROM blobs; DELETE FROM game_backgrounds; DELETE FROM game_shaders; DELETE FROM game_images; DELETE FROM tester_links; DELETE FROM api_keys; DELETE FROM security_events; DELETE FROM security_places; DELETE FROM audit_log; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;",
  );
  await createAccount(env.DB, { id: "dev-1", username: "Pixel_Smith", ageBand: "18+" });
  await letPublish(env.DB, "dev-1");
  await createAccount(env.DB, { id: "dev-2", username: "Other_Dev", ageBand: "18+" });
  await letPublish(env.DB, "dev-2");
  token = (await createApiKey(env.DB, "dev-1", "claude")).token;
  other = (await createApiKey(env.DB, "dev-2", "claude")).token;
});

describe("get_activity", () => {
  it("lists the account's activity for a full key, with the AI's connection in it", async () => {
    await tool("get_access");
    const activity = await tool("get_activity");
    expect(activity.where_used_from_enabled).toBe(true);
    expect(activity.events).toContainEqual(expect.objectContaining({ kind: "ai_connected", done_by: "ai", api_key_name: "claude", device: null }));
    const readKey = (await createApiKey(env.DB, "dev-1", "reader", { accessLevel: "read", gameSlugs: null })).token;
    expect((await tool("get_activity", {}, readKey)).code).toBe("key_not_allowed");
  });
});

describe("the MCP protocol", () => {
  it("needs an API key", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, null);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Bearer");
    // The JSON-RPC error carries Zaisma's own error object.
    const refused = (await res.json()) as any;
    expect(refused.error.code).toBe(-32001);
    expect(refused.error.data.error).toMatchObject({ code: "no_key", field: "Authorization" });
    expect(errorProblems(refused.error.data, 401)).toEqual([]);
    const badKey = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, "zsk_nope");
    expect(badKey.status).toBe(401);
    expect(((await badKey.json()) as any).error.data.error.code).toBe("bad_key");
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
    expect(names).toEqual(expect.arrayContaining(["list_games", "create_game", "upload_files", "publish_version", "get_reports", "get_stats", "get_history", "get_logs", "add_tester_link", "remove_tester_link"]));
    for (const t of list.result.tools) expect(t.inputSchema.type).toBe("object");
    // Clients check an error's structuredContent against the output schema too, so each lists its answer or an error.
    for (const t of list.result.tools) {
      expect(t.outputSchema).toEqual({ type: "object", anyOf: [TOOLS.find((listed) => listed.name === t.name)!.outputSchema, ERROR] });
      expect(schemaProblems(t.outputSchema, { error: { code: "no_game", message: "x", field: "slug", fix: "y", retry_after_sec: null } })).toEqual([]);
    }

    const batch = (await (await rpc([{ jsonrpc: "2.0", id: 3, method: "ping" }, { jsonrpc: "2.0", id: 4, method: "nope" }])).json()) as any[];
    expect(batch[0].result).toEqual({});
    expect(batch[1].error.code).toBe(-32601);
  });
});

describe("publishing a game through the MCP", () => {
  it("makes, uploads, previews, publishes and rolls back", async () => {
    const { game } = await tool("create_game", { title: "Tiny Jump", description: "Jump.", devices: ["phone"] });
    expect(game).toMatchObject({ slug: "tiny-jump", visibility: "draft", devices: ["phone"] });

    const first = await tool("upload_files", { slug: "tiny-jump", files: [{ path: "index.html", content_text: "<!doctype html><p>v1</p>" }, { path: "pic.png", content_base64: btoa("not really a png") }], patch_notes: "First." });
    expect(first.sent_file_count).toBe(2);
    expect(first.version).toMatchObject({ file_count: 2, patch_notes: "First.", scan_status: "scanning", has_threads: false, is_live: false });
    expect(first.next_steps).toEqual([{ tool: "get_version", arguments: { slug: "tiny-jump", version_id: first.version.id }, after_sec: 30, reason: expect.any(String) }]);
    // Held first (image matching isn't connected), so its history shows what Zaisma did; then it passes.
    await scanVersion(testEnv, first.version.id, { ...pass, images: notConnected });
    await passScan(first.version.id);
    const checked = await tool("get_version", { slug: "tiny-jump", version_id: first.version.id });
    expect(checked.version.scan_status).toBe("approved");
    expect(checked.version.has_threads).toBe(false);
    expect(checked.version.preview_url).toContain(`/p/${first.version.id}.`);

    await tool("publish_version", { slug: "tiny-jump", version_id: first.version.id });
    const second = await tool("upload_files", { slug: "tiny-jump", files: [{ path: "index.html", content_text: "<!doctype html><p>v2</p>" }, { path: "pic.png", content_base64: btoa("not really a png") }] });
    expect(second.sent_file_count).toBe(1);
    await passScan(second.version.id);

    await tool("publish_version", { slug: "tiny-jump", version_id: second.version.id });
    const back = await tool("publish_version", { slug: "tiny-jump", version_id: first.version.id });
    expect(back.version.is_live).toBe(true);
    expect(back.game.review_status).toBe("live");
    expect((await gameBySlug(env.DB, "tiny-jump"))!.live_version_id).toBe(first.version.id);

    const { events } = await tool("get_history", { slug: "tiny-jump" });
    expect(events[0]).toMatchObject({ description: "Rolled back to an earlier version", version_id: first.version.id, done_by: "ai", api_key_name: "claude" });
    expect(events).toContainEqual(expect.objectContaining({ description: expect.stringContaining("held"), version_id: first.version.id, done_by: "zaisma" }));

    const { game: shown, versions, images, testers, playing_now_player_count: playingNow } = await tool("get_game", { slug: "tiny-jump" });
    expect(playingNow).toBe(0);
    expect(shown).toMatchObject({ slug: "tiny-jump", page_url: expect.stringContaining("/g/tiny-jump"), play_modes: null, screen_orientation: null, multiplayer_mode: "none" });
    expect(versions).toHaveLength(2);
    expect(images).toEqual([]);
    expect(testers).toEqual([]);
  });

  it("schedules a publish with an ISO time only", async () => {
    await tool("create_game", { title: "Hop" });
    const up = await tool("upload_files", { slug: "hop", files: [{ path: "index.html", content_text: "<p>hop</p>" }] });
    await passScan(up.version.id);
    const at = new Date(Date.now() + 3 * 3600_000).toISOString();
    const later = await tool("publish_version", { slug: "hop", version_id: up.version.id, scheduled_publish_at: at });
    expect(later.version.scheduled_publish_at).toBe(at);
    expect(later.version.is_live).toBe(false);
    const numeric = await tool("publish_version", { slug: "hop", version_id: up.version.id, scheduled_publish_at: Date.now() + 3 * 3600_000 });
    expect(numeric).toMatchObject({ code: "bad_time", field: "scheduled_publish_at", retry_after_sec: null });
    expect(numeric.fix).toMatch(/like "\d{4}-\d{2}-\d{2}T\d{2}:00:00Z"/);
    expect((await tool("cancel_scheduled_publish", { slug: "hop", version_id: up.version.id })).version.scheduled_publish_at).toBeNull();
  });

  it("takes play modes as a list", async () => {
    const { game } = await tool("create_game", {
      title: "Party Hop",
      play_modes: [{ mode: "single" }, { mode: "online", minimum_player_count: 2, maximum_player_count: 4, play_style: "co-op" }],
      screen_orientation: "landscape",
      controls: ["keyboard_mouse"],
    });
    expect(game.play_modes).toEqual([
      { mode: "single", minimum_player_count: null, maximum_player_count: null, play_style: null },
      { mode: "online", minimum_player_count: 2, maximum_player_count: 4, play_style: "co-op" },
    ]);
    expect(game).toMatchObject({ screen_orientation: "landscape", controls: ["keyboard_mouse"] });
    expect(await tool("update_game", { slug: "party-hop", play_modes: [{ mode: "single", minimum_player_count: 2 }] })).toMatchObject({ code: "bad_play_modes", field: "play_modes[0]", fix: expect.stringContaining(`{ "mode": "single" }`) });
    expect(await tool("update_game", { slug: "party-hop", play_modes: [{ mode: "single" }, { mode: "online", minimum_player_count: 2 }] })).toMatchObject({ code: "bad_play_modes", field: "play_modes[1].play_style" });
    expect((await tool("update_game", { slug: "party-hop", play_modes: null, screen_orientation: null })).game).toMatchObject({ play_modes: null, screen_orientation: null });
  });

  it("turns friends' Join off for a whole game", async () => {
    expect((await tool("create_game", { title: "Quiet Rooms" })).game.friend_joins_enabled).toBe(true);
    expect(await tool("update_game", { slug: "quiet-rooms", friend_joins_enabled: "no" })).toMatchObject({ code: "bad_friend_joins_enabled", field: "friend_joins_enabled" });
    expect((await tool("update_game", { slug: "quiet-rooms", friend_joins_enabled: false })).game.friend_joins_enabled).toBe(false);
  });

  it("says how the game runs on players' devices, folding small device groups into other, and turns measuring off", async () => {
    // An account of its own, so its calls don't count against the file's shared minute of calls.
    await createAccount(env.DB, { id: "dev-performance", username: "Frame_Counter", ageBand: "18+" });
    await letPublish(env.DB, "dev-performance");
    const key = (await createApiKey(env.DB, "dev-performance", "claude")).token;
    await tool("create_game", { title: "Hop" }, key);
    const game = (await gameBySlug(env.DB, "hop"))!;
    const today = new Date().toISOString().slice(0, 10);
    await env.DB.exec("DELETE FROM performance_days;");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES ('version_old', ?, 'p', 1, 0, 'approved', 1), ('version_new', ?, 'p', 1, 0, 'approved', 2)").bind(game.id, game.id),
      ...[
        ["version_old", "chrome", "windows", "computer", "intel", 30],
        ["version_new", "chrome", "windows", "computer", "nvidia", 25],
        ["version_new", "safari", "ios", "phone", "apple", 19],
        ["version_new", "firefox", "linux", "computer", "amd", 1],
      ].map(([versionId, browserName, osName, deviceKind, graphicsFamily, playCount]) =>
        env.DB.prepare(
          "INSERT INTO performance_days (game_id, date, version_id, browser_name, os_name, device_kind, graphics_family, play_count, loading_counts, frame_rate_seconds, long_frame_count, measured_duration_sec, error_stop_count, memory_counts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[0,0,0,0,0,600,0,0]', 12, 600, 1, '[]')",
        ).bind(game.id, today, versionId, browserName, osName, deviceKind, graphicsFamily, playCount, JSON.stringify([0, playCount, 0, 0, 0, 0, 0])),
      ),
    ]);
    const { performance } = await tool("get_stats", { slug: "hop", period_duration_days: 7 }, key);
    expect(performance.version_totals.map((row: { version_id: string; play_count: number }) => [row.version_id, row.play_count])).toEqual([["version_new", 45], ["version_old", 30]]);
    // A group of 19 plays shows only inside other.
    expect(performance.device_totals).toEqual([
      expect.objectContaining({ version_id: "version_new", browser_name: "chrome", os_name: "windows", device_kind: "computer", graphics_family: "nvidia", play_count: 25, median_frames_per_sec: 60, long_frames_per_min: 1.2, error_stop_count: 1, context_lost_count: 0, stopped_responding_count: 0, crashed_play_pct: 4, median_peak_memory_size_bytes: null, is_measured: true }),
      expect.objectContaining({ version_id: "version_new", browser_name: "other", os_name: "other", device_kind: "other", graphics_family: "other", play_count: 20 }),
    ]);
    expect(await tool("update_game", { slug: "hop", performance_measuring_enabled: "off" }, key)).toMatchObject({ code: "bad_performance_measuring_enabled", field: "performance_measuring_enabled" });
    expect((await tool("update_game", { slug: "hop", performance_measuring_enabled: false }, key)).game.performance_measuring_enabled).toBe(false);
    expect((await tool("get_stats", { slug: "hop" }, key)).performance).toBeNull();
    await env.DB.exec("DELETE FROM performance_days;");
  });

  /** A screenshot, which a listed game needs: a PNG header is all the image check reads. */
  const addScreenshot = async (slug: string) => {
    const bytes = new Uint8Array(64);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(bytes.buffer).setUint32(16, 1280);
    new DataView(bytes.buffer).setUint32(20, 720);
    expect((await tool("add_image", { slug, kind: "screenshot", image_base64: btoa(String.fromCharCode(...bytes)) })).image.kind).toBe("screenshot");
  };

  it("asks before hiding a game players can play", async () => {
    await tool("create_game", { title: "Hop" });
    const up = await tool("upload_files", { slug: "hop", files: [{ path: "index.html", content_text: "<p>hop</p>" }] });
    await passScan(up.version.id);
    await tool("publish_version", { slug: "hop", version_id: up.version.id });
    await addScreenshot("hop");
    await tool("update_game", { slug: "hop", visibility: "listed" });

    const asked = await tool("update_game", { slug: "hop", visibility: "private" });
    expect(asked).toMatchObject({ code: "needs_confirm", field: "confirm" });
    expect((await gameBySlug(env.DB, "hop"))!.visibility).toBe("listed");
    expect((await tool("update_game", { slug: "hop", visibility: "private", confirm: true })).game.visibility).toBe("private");
  });

  it("answers every change with the calls that usually follow", async () => {
    const made = await tool("create_game", { title: "Hop" });
    expect(made.next_steps).toEqual([{ tool: "upload_files", arguments: { slug: "hop" }, after_sec: null, reason: expect.stringContaining("npx @zaisma/cli upload") }]);
    const up = await tool("upload_files", { slug: "hop", files: [{ path: "index.html", content_text: "<p>hop</p>" }] });
    // Publishing while it's still scanning says to wait, and how long.
    expect(await tool("publish_version", { slug: "hop", version_id: up.version.id })).toMatchObject({ code: "still_scanning", retry_after_sec: 30 });
    await passScan(up.version.id);
    await addScreenshot("hop");
    // Listed with nothing live: publish the version that passed.
    const listed = await tool("update_game", { slug: "hop", visibility: "listed" });
    expect(listed.next_steps).toEqual([{ tool: "publish_version", arguments: { slug: "hop", version_id: up.version.id }, after_sec: null, reason: expect.any(String) }]);
    await tool("update_game", { slug: "hop", visibility: "draft" });
    // Live but still a draft: players can't see it until it's listed or unlisted.
    const published = await tool("publish_version", { slug: "hop", version_id: up.version.id });
    expect(published.next_steps).toEqual([{ tool: "update_game", arguments: { slug: "hop", visibility: "listed" }, after_sec: null, reason: expect.stringContaining("draft") }]);
    expect((await tool("update_game", { slug: "hop", visibility: "unlisted" })).next_steps).toEqual([]);
    expect((await tool("add_tester_link", { slug: "hop", name: "Playtesters" })).next_steps).toEqual([]);
    // Every next step names a tool the MCP has.
    for (const step of [...made.next_steps, ...listed.next_steps, ...published.next_steps]) expect(TOOLS.map((listedTool) => listedTool.name)).toContain(step.tool);
  });

  it("refuses arguments it doesn't take, and says which it does", async () => {
    expect(await tool("search_forum", { q: "too_big" })).toMatchObject({ code: "unknown_field", field: "q", fix: expect.stringContaining("Did you mean search_text?") });
    expect(await tool("update_game", { slug: "hop", players: "2-4" })).toMatchObject({ code: "unknown_field", field: "players", fix: expect.stringContaining("Did you mean play_modes?") });
    expect(await tool("get_game", {})).toMatchObject({ code: "missing_field", field: "slug" });
    expect(await tool("search_forum", { category: "multiplayer" })).toMatchObject({ code: "bad_category", field: "category", fix: expect.stringContaining("multiplayer is a section") });
    expect(await tool("search_forum", { tab: "known_issues" })).toMatchObject({ code: "bad_tab", field: "tab" });
  });

  it("explains what's wrong with an upload, file by file", async () => {
    await tool("create_game", { title: "Hop" });
    const page = { path: "index.html", content_text: "<p>hop</p>" };
    expect(await tool("upload_files", { slug: "hop", files: [page, { path: "hero.png", content_text: "iVBORw0KGgo" }] })).toMatchObject({ code: "bad_files", field: "files[1].content_text" });
    expect(await tool("upload_files", { slug: "hop", files: [{ ...page, path: "/index.html" }] })).toMatchObject({ code: "bad_path", field: "files[0].path" });
    expect(await tool("upload_files", { slug: "hop", files: [{ ...page, path: "my-game/index.html" }] })).toMatchObject({ code: "no_index_html", fix: expect.stringContaining("not game/index.html") });
    expect(await tool("upload_files", { slug: "hop", files: [page, { path: "build.js.gz", content_base64: "H4sI" }] })).toMatchObject({ code: "precompressed_file", field: "files[1].path" });
    expect(await tool("upload_files", { slug: "hop", files: [page, { path: "tool.exe", content_base64: "TVo=" }] })).toMatchObject({ code: "file_type_not_allowed", field: "files[1].path" });
    expect(await tool("upload_files", { slug: "hop", files: [page, { path: "a.png", content_base64: "not base64!" }] })).toMatchObject({ code: "bad_base64", field: "files[1].content_base64" });
    expect(await tool("upload_files", { slug: "hop", files: { "index.html": "<p>hop</p>" } })).toMatchObject({ code: "bad_files", field: "files" });
  });

  it("explains what it can't do", async () => {
    await tool("create_game", { title: "Hop" });
    expect((await tool("upload_files", { slug: "hop", files: [{ path: "game.js", content_text: "1" }] })).error).toContain("index.html");
    expect((await tool("upload_files", { slug: "hop", files: [{ path: "index.html", text: "<p>old name</p>" }] })).error).toContain("content_text");
    expect((await tool("upload_files", { slug: "hop", files: [{ path: "index.html", content_text: "x".repeat(5 * 1024 * 1024 + 1) }] })).error).toContain("npx @zaisma/cli upload");
    expect(await tool("get_game", { slug: "hop" }, other)).toMatchObject({ code: "no_game", field: "slug", message: expect.stringContaining("You don't have a game"), fix: expect.stringContaining("list_games") });
    // A slug or ID of the wrong form says which game or version it didn't find, not that the path is unknown.
    expect(await tool("get_game", { slug: "Hop Game" })).toMatchObject({ code: "no_game" });
    expect(await tool("get_version", { slug: "hop", version_id: "version_8f3k2m" })).toMatchObject({ code: "no_version", field: "version_id" });
    // IDs say their kind, so one of another kind says what it is and where the right one comes from.
    const { version } = await tool("upload_files", { slug: "hop", files: [{ path: "index.html", content_text: "<p>hi</p>" }] });
    expect(version.id).toMatch(/^version_[a-z0-9]{20}$/);
    expect(await tool("get_version", { slug: "hop", version_id: "image_8f3k2m9q1x7c4v6b0n5z" })).toMatchObject({
      code: "wrong_id_kind",
      field: "version_id",
      message: "That's an image ID; version_id takes a version ID.",
      fix: expect.stringContaining("get_game"),
    });
    expect(await tool("publish_version", { slug: "hop", version_id: "tester_8f3k2m9q1x7c4v6b0n5z" })).toMatchObject({ code: "wrong_id_kind", field: "version_id" });
    expect(await tool("remove_image", { slug: "hop", image_id: version.id })).toMatchObject({ code: "wrong_id_kind", field: "image_id", message: "That's a version ID; image_id takes an image ID." });
    expect(await tool("remove_tester_link", { slug: "hop", tester_id: version.id })).toMatchObject({ code: "wrong_id_kind", field: "tester_id" });
  });
});

describe("reports, stats and history", () => {
  it("shows reports by reason, never child-safety ones", async () => {
    await tool("create_game", { title: "Hop" });
    const game = (await gameBySlug(env.DB, "hop"))!;
    await createReport(env.DB, { gameId: game.id, reason: "broken", playerText: "Stuck on level 2" });
    await createReport(env.DB, { gameId: game.id, reason: "real_people", playerText: "shows my address" });
    await createReport(env.DB, { gameId: game.id, reason: "child_safety", playerText: "secret" });
    // Bug reports reach the developer once report triage sorts them as bugs. One sorted as child safety never does.
    await createReport(env.DB, { gameId: game.id, reason: "other", playerText: "a secret found by triage" });
    await env.DB.exec(`UPDATE reports SET is_bug_report = 1, bug_report_at_ms = ${Date.now()} WHERE reason = 'broken'; UPDATE reports SET severity_index = 0, is_bug_report = 1, bug_report_at_ms = ${Date.now()} WHERE reason = 'other'`);
    const out = await tool("get_reports", { slug: "hop" });
    const reason = (r: string) => out.reasons.find((x: { reason: string }) => x.reason === r);
    expect(reason("broken")).toMatchObject({ open_count: 1, closed_count: 0 });
    expect(reason("real_people").open_count).toBe(1);
    expect(reason("child_safety")).toBeUndefined();
    expect(out.bug_reports).toEqual([expect.objectContaining({ player_text: "Stuck on level 2" })]);
    expect(JSON.stringify(out)).not.toContain("secret");
    expect(JSON.stringify(out)).not.toContain("slur");
    // Asking again with next_cursor gives only bug reports that arrived since.
    expect(out.next_cursor).toMatch(/^cursor_/);
    expect((await tool("get_reports", { slug: "hop", cursor: out.next_cursor })).bug_reports).toEqual([]);
    expect((await tool("get_reports", { slug: "hop", cursor: "1792012345678" })).error).toContain("next_cursor");
  });

  it("shows room use per day", async () => {
    await tool("create_game", { title: "Hop" });
    const game = (await gameBySlug(env.DB, "hop"))!;
    const today = new Date().toISOString().slice(0, 10);
    await env.DB.prepare("INSERT INTO room_usage (game_id, date, room_count, room_play_duration_sec, message_count) VALUES (?, ?, 3, 600, 42)").bind(game.id, today).run();
    const stats = await tool("get_stats", { slug: "hop", period_duration_days: 7 });
    expect(stats.period_duration_days).toBe(7);
    expect(stats.multiplayer_days).toEqual([
      { date: today, room_count: 3, room_play_duration_min: 10, message_count: 42, inbound_messages_per_player_sec: 0.1, inbound_size_bytes_per_player_sec: 0, outbound_messages_per_player_sec: 0, outbound_size_bytes_per_player_sec: 0, game_server_cpu_duration_sec: 0, game_server: null },
    ]);
    expect(stats.hosting_use_this_month).toMatchObject({ free_used_pct: 0, shares: [{ kind: "room_play", share_pct: 100 }], is_paused: false, paused_reason: null, monthly_budget_cents: null, spent_from_credit_cents: 0, room_play_duration_hours: 0.2, relayed_size_bytes: 0, game_server_cpu_duration_sec: 0 });
    expect(stats.room_traffic).toEqual({ inbound_messages_per_player_sec: 0.1, inbound_size_bytes_per_player_sec: 0, outbound_messages_per_player_sec: 0, outbound_size_bytes_per_player_sec: 0, message_types: [], traffic_hints: [] });
    expect(stats.game_server_errors).toEqual([]);
    expect(stats.play_stats).toMatchObject({ play_count: 0, average_play_duration_min: null, came_back: { after_7_days: { returned_pct: null } } });
  });

  it("prices game server CPU past what player-hours include, and says what to change in room traffic", async () => {
    await tool("create_game", { title: "Hop" });
    const game = (await gameBySlug(env.DB, "hop"))!;
    await env.DB.prepare("UPDATE games SET multiplayer_mode = 'own' WHERE id = ?").bind(game.id).run();
    const today = new Date().toISOString().slice(0, 10);
    // 4 player-hours include 100 CPU-seconds; 1,300 is 1,200 past them: 4.8 cents of CPU beside 0.8 of room time.
    const playSec = 4 * 3600;
    await env.DB.prepare("INSERT INTO room_usage (game_id, date, room_count, room_play_duration_sec, message_count, inbound_size_bytes, outbound_message_count, outbound_size_bytes, game_server_cpu_duration_ms) VALUES (?, ?, 1, ?, ?, ?, ?, ?, 1300000)")
      .bind(game.id, today, playSec, 30 * playSec, 60 * playSec, 10 * playSec, 900 * 10 * playSec)
      .run();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO room_message_types (game_id, date, message_type, direction, message_count, size_bytes, largest_size_bytes) VALUES (?, ?, 'move', 'outbound', ?, ?, 1200)").bind(game.id, today, 10 * playSec, 900 * 10 * playSec),
      env.DB.prepare("INSERT INTO room_message_types (game_id, date, message_type, direction, message_count, size_bytes, largest_size_bytes) VALUES (?, ?, 'chat', 'inbound', 40, 20000, 13000)").bind(game.id, today),
    ]);
    const stats = await tool("get_stats", { slug: "hop", period_duration_days: 7 });
    expect(stats.hosting_use_this_month).toMatchObject({ room_play_duration_hours: 4, game_server_cpu_duration_sec: 1300, shares: [{ kind: "game_server_cpu", share_pct: 86 }, { kind: "room_play", share_pct: 14 }] });
    expect(stats.multiplayer_days[0]).toMatchObject({ inbound_messages_per_player_sec: 30, inbound_size_bytes_per_player_sec: 60, outbound_messages_per_player_sec: 10, outbound_size_bytes_per_player_sec: 9000, game_server_cpu_duration_sec: 1300 });
    expect(stats.room_traffic.message_types).toEqual([
      { message_type: "move", direction: "outbound", message_count: 10 * playSec, size_bytes: 900 * 10 * playSec, largest_size_bytes: 1200, average_size_bytes: 900 },
      { message_type: "chat", direction: "inbound", message_count: 40, size_bytes: 20000, largest_size_bytes: 13000, average_size_bytes: 500 },
    ]);
    expect(stats.room_traffic.traffic_hints).toEqual([
      { code: "json_messages_large", message: '"move" messages average 900 bytes as JSON. Sending them with room.sendBytes and room.broadcastBytes in a compact form usually cuts them to a third.' },
      { code: "message_near_limit", message: 'The largest "chat" message is 12.7 KB, close to the 16 KB limit. Split it or send it as bytes.' },
    ]);
  });

  it("says to send a type latest-only when much of it went to players whose connection was backed up, and points heavy games at state sync", async () => {
    await tool("create_game", { title: "Hop" });
    const game = (await gameBySlug(env.DB, "hop"))!;
    const today = new Date().toISOString().slice(0, 10);
    const playSec = 3600;
    await env.DB.prepare("INSERT INTO room_usage (game_id, date, room_count, room_play_duration_sec, outbound_message_count, outbound_size_bytes) VALUES (?, ?, 1, ?, ?, ?)").bind(game.id, today, playSec, 32 * playSec, 40 * 1024 * playSec).run();
    await env.DB.batch([
      // 20 a player-second, a fifth of them to backed-up players: worth sending latest-only.
      env.DB.prepare("INSERT INTO room_message_types (game_id, date, message_type, direction, message_count, size_bytes, largest_size_bytes, backed_up_message_count) VALUES (?, ?, 'position', 'outbound', ?, ?, 200, ?)").bind(game.id, today, 20 * playSec, 200 * 20 * playSec, 4 * playSec),
      // As often, but hardly ever to a backed-up player: fine as it is.
      env.DB.prepare("INSERT INTO room_message_types (game_id, date, message_type, direction, message_count, size_bytes, largest_size_bytes, backed_up_message_count) VALUES (?, ?, 'tick', 'outbound', ?, ?, 100, ?)").bind(game.id, today, 12 * playSec, 100 * 12 * playSec, playSec / 100),
      // State sync's own updates never get the hint.
      env.DB.prepare("INSERT INTO room_message_types (game_id, date, message_type, direction, message_count, size_bytes, largest_size_bytes, backed_up_message_count) VALUES (?, ?, '(state)', 'outbound', ?, ?, 900, ?)").bind(game.id, today, 20 * playSec, 900 * 20 * playSec, 10 * playSec),
    ]);
    const stats = await tool("get_stats", { slug: "hop", period_duration_days: 7 });
    expect(stats.room_traffic.traffic_hints).toEqual([
      { code: "latest_only_available", message: '"position" messages go out 20 a second to each player, and 20% of them went to a player whose connection was backed up. Send them with delivery: "latest_only" so a slow player gets only the newest.' },
      { code: "outbound_heavy", message: "Each player gets 40 KB a second. Send each player only what changed and only what they can see: the game server's stateSyncEnabled does the first, and its stateView the second." },
    ]);
  });

  it("shows how a game's own game server is doing, with its recent errors", async () => {
    await tool("create_game", { title: "Hop" });
    const game = (await gameBySlug(env.DB, "hop"))!;
    await env.DB.prepare("UPDATE games SET multiplayer_mode = 'own' WHERE id = ?").bind(game.id).run();
    const today = new Date().toISOString().slice(0, 10);
    await env.DB.prepare("INSERT INTO room_usage (game_id, date, room_count, room_play_duration_sec, message_count, game_server_call_count, game_server_crash_count, game_server_stopped_count, game_server_ended_match_count) VALUES (?, ?, 2, 600, 42, 900, 5, 2, 1)").bind(game.id, today).run();
    await env.DB.prepare("INSERT INTO game_server_errors (game_id, version_id, kind, message, occurrence_count, first_at_ms, last_at_ms) VALUES (?, 'version_8f3k2m9q1x7c4v6b0n5z', 'crash', 'oops (zaisma-server.js:3:9)', 5, 1792000000000, 1792003600000)").bind(game.id).run();
    const stats = await tool("get_stats", { slug: "hop", period_duration_days: 7 });
    expect(stats.multiplayer_days[0].game_server).toEqual({ call_count: 900, request_count: 0, scheduled_run_count: 0, crash_count: 5, stopped_count: 2, ended_match_count: 1 });
    expect(stats.game_server_errors).toEqual([
      { kind: "crash", message: "oops (zaisma-server.js:3:9)", occurrence_count: 5, version_id: "version_8f3k2m9q1x7c4v6b0n5z", first_at: "2026-10-14T17:46:40.000Z", last_at: "2026-10-14T18:46:40.000Z" },
    ]);
    expect(stats.hosting_use_this_month).toMatchObject({ request_count: 0 });
  });

  it("shows requests to a single-player game's own game server, on the hosting meter", async () => {
    await tool("create_game", { title: "Hop" });
    const game = (await gameBySlug(env.DB, "hop"))!;
    const today = new Date().toISOString().slice(0, 10);
    await env.DB.prepare("INSERT INTO room_usage (game_id, date, game_server_request_count, game_server_crash_count) VALUES (?, ?, 1000000, 1)").bind(game.id, today).run();
    const stats = await tool("get_stats", { slug: "hop", period_duration_days: 7 });
    expect(stats.multiplayer_days).toEqual([
      { date: today, room_count: 0, room_play_duration_min: 0, message_count: 0, inbound_messages_per_player_sec: 0, inbound_size_bytes_per_player_sec: 0, outbound_messages_per_player_sec: 0, outbound_size_bytes_per_player_sec: 0, game_server_cpu_duration_sec: 0, game_server: { call_count: 0, request_count: 1_000_000, scheduled_run_count: 0, crash_count: 1, stopped_count: 0, ended_match_count: 0 } },
    ]);
    // No room play: no traffic, types or hints.
    expect(stats.room_traffic).toEqual({ inbound_messages_per_player_sec: 0, inbound_size_bytes_per_player_sec: 0, outbound_messages_per_player_sec: 0, outbound_size_bytes_per_player_sec: 0, message_types: [], traffic_hints: [] });
    // A million requests are $1.60 at Zaisma's prices: 32% of the free allowance.
    expect(stats.hosting_use_this_month).toMatchObject({ request_count: 1_000_000, free_used_pct: 32, shares: [{ kind: "requests", share_pct: 100 }] });
    expect(stats.schedules).toEqual([]);
  });

  it("shows the live version's schedules and their runs", async () => {
    await tool("create_game", { title: "Hop" });
    const game = (await gameBySlug(env.DB, "hop"))!;
    await env.DB.prepare("UPDATE games SET live_version_id = 'version_8f3k2m9q1x7c4v6b0n5z' WHERE id = ?").bind(game.id).run();
    const today = new Date().toISOString().slice(0, 10);
    await env.DB.prepare("INSERT INTO room_usage (game_id, date, game_server_scheduled_run_count, game_server_crash_count) VALUES (?, ?, 24, 1)").bind(game.id, today).run();
    // As the game's object in the rooms Worker writes them; an older version's are left out.
    await env.DB.batch([
      env.DB.prepare("INSERT INTO game_server_schedules (game_id, schedule_name, cron, version_id, next_run_at_ms, last_run_at_ms) VALUES (?, 'daily-reset', '0 0 * * *', 'version_8f3k2m9q1x7c4v6b0n5z', 1792022400000, NULL)").bind(game.id),
      env.DB.prepare("INSERT INTO game_server_schedules (game_id, schedule_name, cron, version_id, next_run_at_ms, last_run_at_ms) VALUES (?, 'world-turn', '*/15 * * * *', 'version_8f3k2m9q1x7c4v6b0n5z', 1792003500000, 1792002600000)").bind(game.id),
      env.DB.prepare("INSERT INTO game_server_schedules (game_id, schedule_name, cron, version_id, next_run_at_ms, last_run_at_ms) VALUES (?, 'old-job', '0 * * * *', 'version_0000000000000000000a', 1792003500000, NULL)").bind(game.id),
    ]);
    const stats = await tool("get_stats", { slug: "hop", period_duration_days: 7 });
    expect(stats.schedules).toEqual([
      { schedule_name: "daily-reset", cron: "0 0 * * *", version_id: "version_8f3k2m9q1x7c4v6b0n5z", next_run_at: "2026-10-15T00:00:00.000Z", last_run_at: null },
      { schedule_name: "world-turn", cron: "*/15 * * * *", version_id: "version_8f3k2m9q1x7c4v6b0n5z", next_run_at: "2026-10-14T18:45:00.000Z", last_run_at: "2026-10-14T18:30:00.000Z" },
    ]);
    expect(stats.multiplayer_days[0].game_server).toEqual({ call_count: 0, request_count: 0, scheduled_run_count: 24, crash_count: 1, stopped_count: 0, ended_match_count: 0 });
  });

  it("keeps scan details and admin notes out of the history", async () => {
    await tool("create_game", { title: "Hop" });
    const game = (await gameBySlug(env.DB, "hop"))!;
    await audit(env.DB, game.id, "scan-held", "child-safety: something only admins see", "system");
    await audit(env.DB, game.id, "takedown", "private admin note", "admin:julius@example.com");
    await audit(env.DB, game.id, "owner", "Owner: Pixel_Smith", "admin:julius@example.com");
    const { events } = await tool("get_history", { slug: "hop" });
    const text = JSON.stringify(events);
    expect(text).not.toContain("admins see");
    expect(text).not.toContain("admin note");
    expect(text).not.toContain("julius");
    expect(events.map((e: { description: string }) => e.description)).toContain("Zaisma took the game down");
  });

  it("says why a version is held and a game was taken down, in its output schemas", async () => {
    await tool("create_game", { title: "Hop" });
    const { version } = await tool("upload_files", { slug: "hop", files: [{ path: "index.html", content_text: "<!doctype html><p>hi</p>" }] });
    await scanVersion(testEnv, version.id, { ...pass, images: notConnected });
    const held = await tool("get_version", { slug: "hop", version_id: version.id });
    expect(held.version).toMatchObject({ scan_status: "held", review_reason: null, findings: [{ code: "image_matching_off", severity: "hold", content_rule: null, path: null }] });

    const game = (await gameBySlug(env.DB, "hop"))!;
    const form = new FormData();
    form.set("content_rule", "personal_details");
    form.set("reason", "The sign-up screen asks players for their home address.");
    await adminForm(testEnv, `/admin/games/${game.id}/takedown`, form, "admin:julius@example.com");
    const taken = { code: "taken_down", message: "The sign-up screen asks players for their home address.", content_rule: "personal_details", fix: expect.stringContaining("message_zaisma") };
    expect((await tool("get_game", { slug: "hop" })).game).toMatchObject({ review_status: "removed", review_reason: taken });
    expect((await tool("get_history", { slug: "hop" })).events[0]).toMatchObject({ description: "Zaisma took the game down", review_reason: taken });
    expect(await tool("add_tester_link", { slug: "hop", name: "Team" })).toMatchObject({ code: "game_removed", message: expect.stringContaining("home address"), fix: expect.stringContaining("message_zaisma") });
  });

  it("lists what needs attention in each game, most urgent first, the same in list_games and get_game", async () => {
    await tool("create_game", { title: "Hop" });
    await tool("create_game", { title: "Calm" });
    const kinds = (answer: { alerts: { kind: string }[] }) => answer.alerts.map((alert) => alert.kind);
    const listed = async (slug: string) => (await tool("list_games")).games.find((game: { slug: string }) => game.slug === slug);
    expect(kinds(await listed("hop"))).toEqual([]);

    // A version waiting for a person, then a newer one rejected.
    const { version: heldVersion } = await tool("upload_files", { slug: "hop", files: [{ path: "index.html", content_text: "<!doctype html><p>hi</p>" }] });
    await scanVersion(testEnv, heldVersion.id, { ...pass, images: notConnected });
    const { version: rejectedVersion } = await tool("upload_files", { slug: "hop", files: [{ path: "index.html", content_text: "<!doctype html><p>hi again</p>" }] });
    await env.DB.prepare("UPDATE versions SET scan_status = 'rejected', created_at_ms = created_at_ms + 1000 WHERE id = ?").bind(rejectedVersion.id).run();
    // The newer upload replaced the waiting version, so it steps aside with no alert; one a report paused is never replaced.
    expect(kinds(await listed("hop"))).toEqual(["version_rejected"]);
    await env.DB.prepare("UPDATE versions SET replaced_by_version_id = NULL, report_held_at_ms = ? WHERE id = ?").bind(Date.now(), heldVersion.id).run();
    const game = (await gameBySlug(env.DB, "hop"))!;
    // Hosting paused at the month's free allowance (as the hosting job writes it), and a report waiting for Zaisma (child safety never counts).
    await env.DB.prepare("INSERT INTO game_hosting_months (game_id, month_start_date, used_cents, paused_at_ms, paused_reason) VALUES (?, ?, 500, ?, 'free_used')").bind(game.id, monthStartDateOf(), Date.now()).run();
    await createReport(env.DB, { gameId: game.id, reason: "broken", playerText: "Stuck" });
    await createReport(env.DB, { gameId: game.id, reason: "child_safety", playerText: "secret" });

    const hop = await listed("hop");
    expect(kinds(hop)).toEqual(["version_rejected", "version_held", "hosting_paused", "reports_open"]);
    expect(hop.alerts[0]).toEqual({ kind: "version_rejected", message: expect.stringContaining("rejected"), fix: expect.stringContaining("get_version"), version_id: rejectedVersion.id });
    expect(hop.alerts[1].version_id).toBe(heldVersion.id);
    expect(hop.alerts[3].message).toBe("A player report is waiting for Zaisma.");
    expect(JSON.stringify(hop.alerts)).not.toContain("secret");
    expect(kinds(await listed("calm"))).toEqual([]);
    expect((await tool("get_game", { slug: "hop" })).alerts).toEqual(hop.alerts);

    // A takedown comes first, with its reason, and acts on the open reports; a rejected version stops counting once a newer one is uploaded.
    const form = new FormData();
    form.set("content_rule", "personal_details");
    form.set("reason", "The sign-up screen asks players for their home address.");
    await adminForm(testEnv, `/admin/games/${game.id}/takedown`, form, "admin:julius@example.com");
    await env.DB.prepare("UPDATE versions SET created_at_ms = created_at_ms + 5000 WHERE id = ?").bind(heldVersion.id).run();
    const removed = (await tool("get_game", { slug: "hop" })).alerts;
    expect(removed.map((alert: { kind: string }) => alert.kind)).toEqual(["game_removed", "version_held", "hosting_paused"]);
    expect(removed[0]).toMatchObject({ message: expect.stringContaining("home address"), fix: expect.stringContaining("message_zaisma"), version_id: null });
  });

  it("gives a heads-up at 80% of the free hosting, and only the pause once it's used", async () => {
    await tool("create_game", { title: "Hop" });
    const game = (await gameBySlug(env.DB, "hop"))!;
    const hostingKinds = async () => (await tool("get_game", { slug: "hop" })).alerts.map((alert: { kind: string }) => alert.kind).filter((kind: string) => kind.startsWith("hosting_"));
    // As the hosting job writes the month (apps/site/src/hosting-job.ts).
    await env.DB.prepare("INSERT INTO game_hosting_months (game_id, month_start_date, used_cents) VALUES (?, ?, 399)").bind(game.id, monthStartDateOf()).run();
    expect(await hostingKinds()).toEqual([]);

    await env.DB.prepare("UPDATE game_hosting_months SET used_cents = 425 WHERE game_id = ?").bind(game.id).run();
    expect(await hostingKinds()).toEqual(["hosting_nearly_paused"]);
    const listed = (await tool("list_games")).games.find((each: { slug: string }) => each.slug === "hop");
    expect(listed.alerts).toEqual([{ kind: "hosting_nearly_paused", message: expect.stringContaining("85%"), fix: expect.stringContaining("get_stats"), version_id: null }]);

    await env.DB.prepare("UPDATE game_hosting_months SET used_cents = 500, paused_at_ms = ?, paused_reason = 'free_used' WHERE game_id = ?").bind(Date.now(), game.id).run();
    expect(await hostingKinds()).toEqual(["hosting_paused"]);
  });

  it("gives a game with a budget a heads-up at 80% of it, and says why it paused", async () => {
    // An account of its own, so its calls don't count against the file's shared minute of calls.
    await createAccount(env.DB, { id: "dev-budget", username: "Budget_Keeper", ageBand: "18+" });
    await letPublish(env.DB, "dev-budget");
    const key = (await createApiKey(env.DB, "dev-budget", "claude")).token;
    await tool("create_game", { title: "Budget Hop" }, key);
    const game = (await gameBySlug(env.DB, "budget-hop"))!;
    await env.DB.prepare("UPDATE games SET monthly_budget_cents = 5000 WHERE id = ?").bind(game.id).run();
    await env.DB.prepare("INSERT INTO game_hosting_months (game_id, month_start_date, used_cents, charged_cents) VALUES (?, ?, 4500, 4000)").bind(game.id, monthStartDateOf()).run();
    const alerts = (await tool("get_game", { slug: "budget-hop" }, key)).alerts;
    expect(alerts).toEqual([{ kind: "hosting_budget_nearly_used", message: expect.stringContaining("$40 of its $50 budget"), fix: expect.stringContaining("monthly_budget_cents"), version_id: null }]);
    await env.DB.prepare("UPDATE game_hosting_months SET charged_cents = 5000, paused_at_ms = ?, paused_reason = 'budget_used' WHERE game_id = ?").bind(Date.now(), game.id).run();
    expect((await tool("get_game", { slug: "budget-hop" }, key)).alerts).toEqual([{ kind: "hosting_paused", message: expect.stringContaining("$50 budget"), fix: expect.stringContaining("Raise its budget"), version_id: null }]);
  });
});

describe("players", () => {
  it("looks up an account's public profile by its player ID, and nothing else", async () => {
    const account = await createAccount(env.DB, { id: "player-1", username: "Night_Owl", ageBand: "16-17" });
    // What a stranger sees: the name, never the email, age or the sign-in's own ID. A 16-year-old's profile starts private.
    expect(await tool("get_player", { player_id: account.player_id })).toEqual({ player: { id: account.player_id, name: "Night_Owl", username: "Night_Owl", display_name: null, bio: null, link_urls: [], profile_url: "https://zaisma.test/@Night_Owl", is_profile_private: true, published_games: [], played_games: [], playing_now: null } });
    expect(await tool("get_player", { player_id: "player_nobodyhasthis1" })).toMatchObject({ code: "no_player", field: "player_id" });
    expect(await tool("get_player", { player_id: "version_8f3k2m9q1x7c4v6b0n5z" })).toMatchObject({ code: "wrong_id_kind", field: "player_id" });
  });
});


describe("background tools", () => {
  it("send a shader, choose it once it passed, and remove it, each answering its output schema", async () => {
    await tool("create_game", { title: "Worlds" });
    const source = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n  fragColor = vec4(fragCoord / iResolution.xy, 0.5, 1.0);\n}";
    const { shader, next_steps: nextSteps } = await tool("add_shader", { slug: "worlds", screen: "wide", source });
    expect(shader).toMatchObject({ screen: "wide", review_status: "pending", size_bytes: source.length });
    expect(nextSteps[0].tool).toBe("get_game");
    expect(await tool("set_background", { slug: "worlds", screen: "wide", source: "shader", shader_id: shader.id })).toMatchObject({ code: "background_not_ready" });
    await env.DB.prepare("UPDATE game_shaders SET review_status = 'approved', checked_at_ms = 1 WHERE id = ?").bind(shader.id).run();
    expect((await tool("set_background", { slug: "worlds", screen: "wide", source: "shader", shader_id: shader.id })).background).toMatchObject({ source: "shader", shader_id: shader.id });
    expect((await tool("set_background", { slug: "worlds", screen: "phone", source: "wide" })).background).toMatchObject({ screen: "phone", source: "wide" });
    const game = await tool("get_game", { slug: "worlds" });
    expect(game.backgrounds.map((background: { source: string }) => background.source)).toEqual(["shader", "wide"]);
    expect(game.shaders.map((each: { id: string }) => each.id)).toEqual([shader.id]);
    expect((await tool("remove_shader", { slug: "worlds", shader_id: shader.id })).backgrounds[0].source).toBe("zaisma");
  });

  it("point a misnamed argument at the tool that does it", async () => {
    await tool("create_game", { title: "Worlds" });
    expect(await tool("update_game", { slug: "worlds", background_video: "intro.mp4" })).toMatchObject({ code: "unknown_field", field: "background_video", fix: expect.stringContaining("That's what add_shader does.") });
  });
});
