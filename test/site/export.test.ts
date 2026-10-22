import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { accountById, addImage, bumpSave, canonicalSave, createAccount, createApiKey, gameBySlug, imageKey, newId, saveHash, saveKey, sha256Hex } from "@zaisma/core";
import { TOOLS } from "../../apps/site/src/mcp.ts";
import { scanVersion } from "../../apps/site/src/scan.ts";
import { GAME_EXPORT } from "../../apps/site/src/schemas.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";
import { letPublish } from "../helpers.ts";
import { passingScanDeps } from "./scan-stubs.ts";

// Export everything (apps/site/src/game-export.ts): everything about a game as one .zip, through the
// API and MCP, made as it downloads.

const SITE = "https://zaisma.test";
let token = "";
let nextId = 1;
let gameId = "";

async function api(path: string, init: { method?: string; body?: unknown; bytes?: string; key?: string } = {}) {
  const res = await SELF.fetch(`${SITE}/api/dev${path}`, {
    method: init.method ?? (init.body || init.bytes !== undefined ? "POST" : "GET"),
    headers: { authorization: `Bearer ${init.key ?? token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : init.bytes,
  });
  if (res.headers.get("content-type") === "application/zip") return { status: res.status, answer: null, zip: new Uint8Array(await res.arrayBuffer()) };
  const answer = (await res.json()) as any;
  if (!res.ok) expect(errorProblems(answer, res.status)).toEqual([]);
  return { status: res.status, answer, zip: null };
}

async function tool(name: string, toolArguments: Record<string, unknown>): Promise<any> {
  const res = await SELF.fetch(`${SITE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: toolArguments } }),
  });
  const { result } = (await res.json()) as any;
  expect(result.isError, JSON.stringify(result.structuredContent)).toBeFalsy();
  expect(schemaProblems(TOOLS.find((candidate) => candidate.name === name)!.outputSchema!, result.structuredContent, name)).toEqual([]);
  return result.structuredContent;
}

/** A version of these files, sent through the API; passed by the scan unless told not to. */
async function upload(files: Record<string, string>, isPassed: boolean): Promise<string> {
  const list = await Promise.all(Object.entries(files).map(async ([path, text]) => ({ path, sha256: await sha256Hex(new TextEncoder().encode(text)), size_bytes: new TextEncoder().encode(text).byteLength })));
  await api("/games/sky-hopper/uploads", { body: { files: list } });
  for (const [path, text] of Object.entries(files)) expect((await api(`/files/${list.find((file) => file.path === path)!.sha256}`, { method: "PUT", bytes: text })).status).toBe(200);
  const { answer } = await api("/games/sky-hopper/versions", { body: { files: list, patch_notes: isPassed ? "First level" : "Second level" } });
  if (isPassed) await scanVersion({ ...env, ANTHROPIC_API_KEY: "test-key" }, answer.version.id, passingScanDeps());
  return answer.version.id;
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM api_keys; DELETE FROM save_history; DELETE FROM saves; DELETE FROM security_events; DELETE FROM audit_log; DELETE FROM game_images; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;");
  await createAccount(env.DB, { id: "dev-1", username: "Pixel_Smith", ageBand: "18+" });
  await letPublish(env.DB, "dev-1");
  token = (await createApiKey(env.DB, "dev-1", "claude")).token;
  expect((await api("/games", { body: { title: "Sky Hopper" } })).status).toBe(201);
  gameId = (await gameBySlug(env.DB, "sky-hopper"))!.id;
});

describe("export everything", () => {
  it("answers what's in it and the link, and the .zip holds everything as the API answers it", async () => {
    const passedId = await upload({ "index.html": "<!doctype html><p>hop</p>", "assets/level.json": '{"level":1}' }, true);
    const scanningId = await upload({ "index.html": "<!doctype html><p>hop two</p>" }, false);

    const cover = await addImage(env.DB, { id: newId("image"), game_id: gameId, kind: "cover", content_type: "image/png", width_px: 1280, height_px: 720, size_bytes: 9 });
    await env.DB.prepare("UPDATE game_images SET review_status = 'approved' WHERE id = ?").bind(cover.id).run();
    await env.GAMES.put(imageKey(cover), "png bytes");
    const screenshot = await addImage(env.DB, { id: newId("image"), game_id: gameId, kind: "screenshot", content_type: "image/jpeg", width_px: 1280, height_px: 720, size_bytes: 9 });
    await env.GAMES.put(imageKey(screenshot), "jpg bytes");

    expect((await api("/games/sky-hopper/secrets/STRIPE_KEY", { method: "PUT", body: { secret_value: "sk_test_never_exported" } })).status).toBe(200);
    expect((await api("/games/sky-hopper/database/query", { body: { sql: "CREATE TABLE scores (player_id TEXT PRIMARY KEY, best_score INTEGER)" } })).status).toBe(200);
    expect((await api("/games/sky-hopper/database/query", { body: { sql: "INSERT INTO scores VALUES (?, ?)", values: ["player_a", 1200] } })).status).toBe(200);

    await createAccount(env.DB, { id: "player-fox", username: "Fox", ageBand: "18+" });
    const fox = (await accountById(env.DB, "player-fox"))!;
    const saveText = canonicalSave({ coins: "120" });
    await bumpSave(env.DB, { accountId: fox.id, gameId, baseVersionNumber: 0, sha256: await saveHash(saveText), sizeBytes: saveText.length, changedByKind: "player" });
    await env.SAVES.put(saveKey(fox.id, gameId), saveText);

    const answered = await tool("export_game", { slug: "sky-hopper" });
    expect(schemaProblems(GAME_EXPORT, answered)).toEqual([]);
    expect(answered.export).toEqual({
      download_url: `${env.SITE_ORIGIN}/dashboard/sky-hopper/export.zip`,
      command: "npx @zaisma/cli export sky-hopper",
      version_count: 1,
      withheld_version_count: 1,
      image_count: 1,
      withheld_image_count: 1,
      shader_count: 0,
      save_count: 1,
      files_size_bytes: 25 + 11 + 9,
    });

    const { status, zip } = await api("/games/sky-hopper/export/download");
    expect(status).toBe(200);
    const files = unzipSync(zip!);
    const text = (path: string) => new TextDecoder().decode(files[path]!);
    expect(Object.keys(files).sort()).toEqual(
      ["README.txt", "database.sql", "game.json", "history.json", `images/cover-${cover.id}.png`, "reports.json", "saves.jsonl", "stats.json", `versions/${passedId}/assets/level.json`, `versions/${passedId}/index.html`, "versions.json"].sort(),
    );
    expect(text(`versions/${passedId}/index.html`)).toBe("<!doctype html><p>hop</p>");
    expect(text(`images/cover-${cover.id}.png`)).toBe("png bytes");

    const game = JSON.parse(text("game.json"));
    expect(game.game.slug).toBe("sky-hopper");
    expect(game.secrets.map((secret: { name: string }) => secret.name)).toEqual(["STRIPE_KEY"]);
    expect(Object.values(files).some((bytes) => new TextDecoder().decode(bytes).includes("sk_test_never_exported"))).toBe(false);
    expect(game.images.find((image: { id: string }) => image.id === screenshot.id).file_path).toBeNull();

    const versions = JSON.parse(text("versions.json")).versions;
    expect(versions.find((version: { id: string }) => version.id === passedId)).toMatchObject({ folder_path: `versions/${passedId}/`, patch_notes: "First level", scan_status: "approved" });
    expect(versions.find((version: { id: string }) => version.id === scanningId)).toMatchObject({ folder_path: null, scan_status: "scanning" });
    expect(versions[0]).not.toHaveProperty("preview_url");

    expect(text("database.sql")).toContain("INSERT INTO \"scores\" VALUES('player_a',1200);");
    const saves = text("saves.jsonl").trim().split("\n").map((line) => JSON.parse(line));
    expect(saves).toEqual([expect.objectContaining({ player_id: fox.player_id, changed_by_kind: "player", local_storage_items: { coins: "120" } })]);
    expect(JSON.parse(text("stats.json"))).toHaveProperty("play_stats");
    expect(JSON.parse(text("reports.json"))).toHaveProperty("bug_reports");
    // The export is a line in the game's history, with nothing else logged for its reads.
    expect(JSON.parse(text("history.json")).events[0].description).toBe("Exported everything about the game");
    const kinds = (await env.DB.prepare("SELECT kind FROM security_events WHERE game_id = ? AND kind IN ('game_exported', 'database_exported', 'saves_read')").bind(gameId).all<{ kind: string }>()).results;
    expect(kinds.map((row) => row.kind)).toEqual(["game_exported"]);
  });

  it("lists a file storage can't find instead of breaking the download", async () => {
    const versionId = await upload({ "index.html": "<!doctype html><p>hop</p>" }, true);
    await env.GAMES.delete(`blobs/${await sha256Hex(new TextEncoder().encode("<!doctype html><p>hop</p>"))}`);
    const { zip } = await api("/games/sky-hopper/export/download");
    const files = unzipSync(zip!);
    expect(files[`versions/${versionId}/index.html`]).toBeUndefined();
    expect(new TextDecoder().decode(files["MISSING.txt"]!)).toContain(`versions/${versionId}/index.html`);
  });

  it("needs read access to everything it covers, and an account starts two a minute", async () => {
    const noSaves = (await createApiKey(env.DB, "dev-1", "ci", { accessLevel: "custom", areaAccess: { game_access: "read", version_access: "read", stats_access: "read", database_access: "read", save_access: "none", purchase_access: "none", forum_access: "none", sign_in_app_access: "none", webhook_access: "none", credit_access: "none" }, gameSlugs: null })).token;
    const refused = await api("/games/sky-hopper/export", { key: noSaves });
    expect(refused.status).toBe(403);
    expect(refused.answer.error.code).toBe("key_not_allowed");
    expect(refused.answer.error.message).toContain("save_access read");

    // Its own account, so the other tests' downloads don't count.
    await createAccount(env.DB, { id: "dev-limit", username: "Busy_Dev", ageBand: "18+" });
    await letPublish(env.DB, "dev-limit");
    const busy = (await createApiKey(env.DB, "dev-limit", "claude")).token;
    expect((await api("/games", { body: { title: "Busy Game" }, key: busy })).status).toBe(201);
    expect((await api("/games/busy-game/export/download", { key: busy })).status).toBe(200);
    expect((await api("/games/busy-game/export/download", { key: busy })).status).toBe(200);
    const third = await api("/games/busy-game/export/download", { key: busy });
    expect(third.status).toBe(429);
    expect(third.answer.error.code).toBe("slow_down");
  });
});
