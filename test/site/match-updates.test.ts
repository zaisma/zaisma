import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createAccount, createApiKey, createVersion, gameBySlug, manifestKey, versionById } from "@zaisma/core";
import { publishDue } from "../../apps/site/src/cleanup.ts";
import { VERSION } from "../../apps/site/src/schemas.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";
import { letPublish } from "../helpers.ts";

// A version published "now" reaches live matches (docs/DEVELOPER-API.md, "Updates"): the publish's match_update_mode.

const SITE = "https://zaisma.test";
let token = "";
const rooms = () => env.GAME_ROOMS as unknown as { takeMatchUpdates(): Promise<{ gameId: string; slug: string; versionId: string; hasGameFileChanges: boolean }[]> };

async function api(path: string, init: { method?: string; body?: unknown } = {}) {
  return SELF.fetch(`${SITE}/api/dev${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
}

async function mcp(name: string, toolArguments: Record<string, unknown>) {
  const response = await SELF.fetch(`${SITE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: toolArguments } }),
  });
  return ((await response.json()) as { result: { isError?: boolean; structuredContent: Record<string, any> } }).result;
}

let counter = 0;
/** An approved version of the arena game, uploaded file by file with these files (path to content), so its changes can be told. */
async function approvedVersion(files: Record<string, string>) {
  const game = (await gameBySlug(env.DB, "arena"))!;
  const id = `version_match${String(++counter).padStart(10, "0")}`;
  await createVersion(env.DB, { id, gameId: game.id, r2Prefix: `manifests/${id}`, fileCount: Object.keys(files).length, sizeBytes: 10, kind: "files", publishWhenApprovedEnabled: false });
  const manifest = { files: Object.fromEntries(Object.entries(files).map(([path, content]) => [path, { sha256: content.padEnd(64, "0").slice(0, 64) }])) };
  await env.GAMES.put(manifestKey(id), JSON.stringify(manifest));
  await env.DB.prepare("UPDATE versions SET scan_status = 'approved', created_at_ms = ? WHERE id = ?").bind(Date.now() + counter, id).run();
  return id;
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;");
  await createAccount(env.DB, { id: "dev-match", username: "Lucas_Dev", ageBand: "18+" });
  await letPublish(env.DB, "dev-match");
  token = (await createApiKey(env.DB, "dev-match", "laptop")).token;
  expect((await api("/games", { body: { title: "Arena", slug: "arena" } })).status).toBe(201);
  await rooms().takeMatchUpdates();
});

describe("match_update_mode", () => {
  it("is next_match by default: running matches aren't told", async () => {
    const first = await approvedVersion({ "index.html": "a1", "zaisma-server.js": "s1" });
    const response = await api(`/games/arena/versions/${first}/publish`, { method: "POST" });
    expect(response.status).toBe(200);
    const answer = (await response.json()) as { version: unknown };
    expect(schemaProblems(VERSION, answer.version)).toEqual([]);
    expect((await gameBySlug(env.DB, "arena"))!.live_version_match_update_mode).toBe("next_match");
    expect(await rooms().takeMatchUpdates()).toEqual([]);
  });

  it("now tells the game's rooms, saying whether the game's own files changed or only its game server", async () => {
    const first = await approvedVersion({ "index.html": "a1", "zaisma-server.js": "s1" });
    expect((await api(`/games/arena/versions/${first}/publish`, { method: "POST" })).status).toBe(200);
    const serverFix = await approvedVersion({ "index.html": "a1", "zaisma-server.js": "s2" });
    expect((await api(`/games/arena/versions/${serverFix}/publish`, { body: { match_update_mode: "now" } })).status).toBe(200);
    const game = (await gameBySlug(env.DB, "arena"))!;
    expect(game.live_version_match_update_mode).toBe("now");
    expect(game.has_live_version_game_file_changes).toBe(0);
    expect(await rooms().takeMatchUpdates()).toEqual([{ gameId: game.id, slug: "arena", versionId: serverFix, hasGameFileChanges: false }]);

    // Through the MCP, with a change players' browsers load: they reload.
    const clientFix = await approvedVersion({ "index.html": "a2", "zaisma-server.js": "s2" });
    const published = await mcp("publish_version", { slug: "arena", version_id: clientFix, match_update_mode: "now" });
    expect(published.isError).toBeFalsy();
    expect(await rooms().takeMatchUpdates()).toEqual([{ gameId: game.id, slug: "arena", versionId: clientFix, hasGameFileChanges: true }]);
    // A rollback "now" moves matches back too.
    expect((await api(`/games/arena/versions/${first}/publish`, { body: { match_update_mode: "now" } })).status).toBe(200);
    expect((await rooms().takeMatchUpdates()).map((update) => [update.versionId, update.hasGameFileChanges])).toEqual([[first, true]]);
  });

  it("refuses anything but next_match or now, and a mode on an upload that doesn't publish itself", async () => {
    const version = await approvedVersion({ "index.html": "a1" });
    for (const given of [true, "immediately", 1]) {
      const response = await api(`/games/arena/versions/${version}/publish`, { body: { match_update_mode: given } });
      const refusal = (await response.json()) as { error: { code: string; field: string; fix: string } };
      expect(errorProblems(refusal, response.status)).toEqual([]);
      expect(refusal.error).toMatchObject({ code: "bad_match_update_mode", field: "match_update_mode" });
      expect(refusal.error.fix).toContain('"now"');
    }
    expect((await gameBySlug(env.DB, "arena"))!.live_version_id).toBeNull();
    const upload = await mcp("upload_files", { slug: "arena", files: [{ path: "index.html", content_text: "<!doctype html><p>hi</p>" }], match_update_mode: "now" });
    expect(upload.isError).toBe(true);
    expect(JSON.stringify(upload.structuredContent)).toContain("bad_match_update_mode");
  });

  it("keeps a publish-later's mode, and uses it when the version goes live by itself", async () => {
    const first = await approvedVersion({ "index.html": "a1" });
    expect((await api(`/games/arena/versions/${first}/publish`, { method: "POST" })).status).toBe(200);
    const later = await approvedVersion({ "index.html": "a2" });
    const scheduled = await api(`/games/arena/versions/${later}/publish`, { body: { scheduled_publish_at: new Date(Date.now() + 3600_000).toISOString(), match_update_mode: "now" } });
    expect(((await scheduled.json()) as { version: { match_update_mode: string } }).version.match_update_mode).toBe("now");
    await env.DB.prepare("UPDATE versions SET scheduled_publish_at_ms = ? WHERE id = ?").bind(Date.now() - 1000, later).run();
    expect(await publishDue(env)).toBe(1);
    const game = (await gameBySlug(env.DB, "arena"))!;
    expect([game.live_version_id, game.live_version_match_update_mode]).toEqual([later, "now"]);
    expect((await rooms().takeMatchUpdates()).map((update) => update.versionId)).toEqual([later]);
    // Once live, the version's own choice is spent: a later rollback to it picks again.
    expect((await versionById(env.DB, later))!.match_update_mode).toBe("next_match");
  });
});

describe("/g/:slug/live-version", () => {
  it("says which version players get and how it came, for a game players can open", async () => {
    const version = await approvedVersion({ "index.html": "a1" });
    expect((await (await SELF.fetch(`${SITE}/g/arena/live-version`)).status)).toBe(404);
    expect((await api(`/games/arena/versions/${version}/publish`, { body: { match_update_mode: "now" } })).status).toBe(200);
    expect((await api("/games/arena", { method: "PATCH", body: { visibility: "unlisted" } })).status).toBe(200);
    const response = await SELF.fetch(`${SITE}/g/arena/live-version`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ live_version_id: version, live_version_match_update_mode: "now" });
    expect(response.headers.get("cache-control")).toBe("public, max-age=30");
  });
});
