import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { KEPT_VERSION_COUNT, ownedBlobKey, personOwner, blobKey, createAccount, createApiKey, gameBySlug, manifestKey, notConnected, sha256Hex, versionById, type ImageMatcher } from "@zaisma/core";
import { scanVersion, type ScanDeps } from "../../apps/site/src/scan.ts";
import { dailyCleanup, publishDue } from "../../apps/site/src/cleanup.ts";

const SITE = "https://zaisma.test";
const testEnv = { ...env, ANTHROPIC_API_KEY: "test-key" };
const connected: ImageMatcher = { check: async (imgs) => ({ provider: "test", isConnected: true, checkedMediaCount: imgs.length, findings: [] }) };
const pass: ScanDeps = {
  images: connected,
  ai: async () => ({ report: { model: "test", verdict: "pass", summary: "fine", input_token_count: 10, output_token_count: 1 }, findings: [], isChildSafety: false }),
};
const hold: ScanDeps = { ...pass, images: notConnected };

let token = "";
const enc = (s: string) => new TextEncoder().encode(s);

async function api(path: string, init: { method?: string; body?: unknown; raw?: Uint8Array; key?: string } = {}) {
  return SELF.fetch(`${SITE}/api/dev${path}`, {
    method: init.method ?? (init.body || init.raw ? "POST" : "GET"),
    headers: { authorization: `Bearer ${init.key ?? token}` },
    body: init.raw ?? (init.body ? JSON.stringify(init.body) : undefined),
  });
}

async function describeFiles(files: Record<string, string>) {
  return Promise.all(Object.entries(files).map(async ([path, text]) => ({ path, sha256: await sha256Hex(enc(text)), size_bytes: enc(text).byteLength, text })));
}

/** Scan with the checks this test wants. Tests run scans themselves; nothing reads the scan queue. */
async function scan(id: string, deps: ScanDeps) {
  return scanVersion(testEnv, id, deps);
}

/** What the upload command does: ask what's missing, send it, make the version. */
async function push(files: Record<string, string>, extra: Record<string, unknown> = {}) {
  const list = await describeFiles(files);
  const plan = (await (await api("/games/hop/uploads", { body: { files: list.map(({ text: _, ...f }) => f) } })).json()) as { missing_file_hashes: string[] };
  for (const f of list.filter((f) => plan.missing_file_hashes.includes(f.sha256))) {
    expect((await api(`/files/${f.sha256}`, { method: "PUT", raw: enc(f.text) })).status).toBe(200);
  }
  const res = await api("/games/hop/versions", { body: { files: list.map(({ text: _, ...f }) => f), ...extra } });
  expect(res.status).toBe(201);
  return { sent: plan.missing_file_hashes.length, version: ((await res.json()) as { version: { id: string } }).version };
}

beforeEach(async () => {
  await env.DB.exec(
    "DELETE FROM blobs; DELETE FROM owned_blobs; DELETE FROM game_images; DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;",
  );
  const all = await env.GAMES.list();
  if (all.objects.length) await env.GAMES.delete(all.objects.map((o) => o.key));
  await createAccount(env.DB, { id: "dev-1", name: "Pixel Smith", ageBand: "18+" });
  token = (await createApiKey(env.DB, "dev-1", "laptop")).token;
  await api("/games", { body: { title: "Hop" } });
});

const GAME = { "index.html": "<!doctype html><script src='game.js'></script>", "game.js": "let x = 1;", "art/sky.json": '{"blue":true}' };

describe("file-by-file uploads", () => {
  it("stores each file once and only sends what changed", async () => {
    const first = await push(GAME, { patch_notes: "First version." });
    expect(first.sent).toBe(3);
    const v = (await versionById(env.DB, first.version.id))!;
    expect(v).toMatchObject({ kind: "files", file_count: 3, patch_notes: "First version.", publish_when_approved_enabled: 0 });
    const manifest = (await (await env.GAMES.get(manifestKey(v.id)))!.json()) as { files: Record<string, { sha256: string }> };
    expect(Object.keys(manifest.files).sort()).toEqual(["art/sky.json", "game.js", "index.html"]);
    expect(await env.GAMES.head(blobKey(manifest.files["game.js"]!.sha256))).not.toBeNull();

    const second = await push({ ...GAME, "game.js": "let x = 2;" });
    expect(second.sent).toBe(1);
  });

  it("refuses files that don't match their hash, programs, and bad file lists", async () => {
    const real = await sha256Hex(enc("hello"));
    const wrong = await api(`/files/${real}`, { method: "PUT", raw: enc("not hello") });
    expect(wrong.status).toBe(400);
    expect(await env.GAMES.head(blobKey(real))).toBeNull();

    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff, 0, 0]);
    const res = await api(`/files/${await sha256Hex(exe)}`, { method: "PUT", raw: exe });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Windows program");

    const files = await describeFiles({ "game.js": "x" });
    expect((await api("/games/hop/uploads", { body: { files } })).status).toBe(400); // no index.html
    const sneaky = await describeFiles({ "index.html": "x", "../escape.js": "y" });
    expect((await api("/games/hop/uploads", { body: { files: sneaky } })).status).toBe(400);
    const unsent = await describeFiles({ "index.html": "never sent" });
    expect((await api("/games/hop/versions", { body: { files: unsent.map(({ text: _, ...f }) => f) } })).status).toBe(409);
  });

  it("makes a passed upload a draft with a private preview link, then publishes it", async () => {
    const { version } = await push(GAME);
    await scan(version.id, pass);
    const draft = (await (await api(`/games/hop/versions/${version.id}`)).json()) as { version: { scan_status: string; is_live: boolean; preview_url: string } };
    expect(draft.version).toMatchObject({ scan_status: "approved", is_live: false });
    expect(draft.version.preview_url).toMatch(/^https:\/\/games\.zaisma\.test\/hop--[a-z0-9]{20}\/$/);
    expect((await gameBySlug(env.DB, "hop"))!.live_version_id).toBeNull();

    const res = await api(`/games/hop/versions/${version.id}/publish`, { method: "POST" });
    expect(res.status).toBe(200);
    expect((await gameBySlug(env.DB, "hop"))!).toMatchObject({ live_version_id: version.id, review_status: "live" });
  });

  it("explains why a version was held and won't publish it", async () => {
    const { version } = await push(GAME);
    await scan(version.id, hold);
    const held = (await (await api(`/games/hop/versions/${version.id}`)).json()) as { version: { scan_status: string; preview_url: null; findings: { rule: string }[] } };
    expect(held.version.scan_status).toBe("held");
    expect(held.version.preview_url).toBeNull();
    expect(held.version.findings.map((f) => f.rule)).toContain("image-matching-not-connected");
    expect((await api(`/games/hop/versions/${version.id}/publish`, { method: "POST" })).status).toBe(409);
  });

  it("can go live by itself when asked to", async () => {
    const { version } = await push(GAME, { publish_when_approved: true });
    await scan(version.id, pass);
    expect((await gameBySlug(env.DB, "hop"))!.live_version_id).toBe(version.id);
  });

  it("rolls back, and keeps the live version plus the last five", async () => {
    const ids: string[] = [];
    for (let i = 0; i < KEPT_VERSION_COUNT + 2; i++) {
      const { version } = await push({ ...GAME, "game.js": `let x = ${i};` }, { publish_when_approved: true });
      await scan(version.id, pass);
      ids.push(version.id);
    }
    // Back to an older one.
    expect((await api(`/games/hop/versions/${ids[2]}/publish`, { method: "POST" })).status).toBe(200);
    expect((await gameBySlug(env.DB, "hop"))!.live_version_id).toBe(ids[2]);
    const { results } = await env.DB.prepare("SELECT id FROM versions WHERE game_id = (SELECT id FROM games WHERE slug = 'hop')").all<{ id: string }>();
    expect(results.length).toBeLessThanOrEqual(KEPT_VERSION_COUNT + 1);
    expect(results.map((r) => r.id)).toContain(ids[2]);
    expect(results.map((r) => r.id)).not.toContain(ids[0]);
    expect(await env.GAMES.head(manifestKey(ids[0]!))).toBeNull();
  });

  it("keeps other developers out", async () => {
    await createAccount(env.DB, { id: "dev-2", name: "Other Dev", ageBand: "18+" });
    const other = (await createApiKey(env.DB, "dev-2", "x")).token;
    const files = (await describeFiles(GAME)).map(({ text: _, ...f }) => f);
    expect((await api("/games/hop/uploads", { body: { files }, key: other })).status).toBe(404);
    expect((await api("/games/hop/versions", { body: { files }, key: other })).status).toBe(404);
  });
});

describe("publish later", () => {
  it("publishes a draft at its time, and can be called off", async () => {
    const { version } = await push(GAME);
    await scan(version.id, pass);
    const at = Date.now() + 3600_000;
    const res = await api(`/games/hop/versions/${version.id}/publish`, { body: { scheduled_publish_at: new Date(at).toISOString() } });
    expect(((await res.json()) as { version: { scheduled_publish_at: string } }).version.scheduled_publish_at).toBe(new Date(at).toISOString());
    expect(await publishDue(env, Date.now())).toBe(0);
    expect((await gameBySlug(env.DB, "hop"))!.live_version_id).toBeNull();

    await api(`/games/hop/versions/${version.id}/publish`, { method: "DELETE" });
    expect(await publishDue(env, at + 1)).toBe(0);
    await api(`/games/hop/versions/${version.id}/publish`, { body: { scheduled_publish_at: new Date(at).toISOString() } });
    expect(await publishDue(env, at + 1)).toBe(1);
    expect((await gameBySlug(env.DB, "hop"))!.live_version_id).toBe(version.id);
    expect((await versionById(env.DB, version.id))!.scheduled_publish_at_ms).toBeNull();
  });

  it("refuses times in the past, and drops versions that don't pass", async () => {
    const { version } = await push(GAME);
    expect((await api(`/games/hop/versions/${version.id}/publish`, { body: { scheduled_publish_at: new Date(Date.now() - 1000).toISOString() } })).status).toBe(400);
    expect((await api(`/games/hop/versions/${version.id}/publish`, { body: { scheduled_publish_at: "soon" } })).status).toBe(400);
    await scan(version.id, hold);
    await env.DB.prepare("UPDATE versions SET scheduled_publish_at_ms = ? WHERE id = ?").bind(Date.now() - 1, version.id).run();
    expect(await publishDue(env)).toBe(0);
    expect((await versionById(env.DB, version.id))!.scheduled_publish_at_ms).toBeNull();
  });
});

describe("big files", () => {
  it("are sent in parts and kept for their owner's versions only", async () => {
    const big = enc("x".repeat(3000));
    const sha = await sha256Hex(big);
    const start = (await (await api(`/files/${sha}/parts`, { body: { size_bytes: big.byteLength } })).json()) as { upload_id: string; part_count: number };
    expect(start.part_count).toBe(1);
    const part = (await (await api(`/files/${sha}/parts/1?upload_id=${encodeURIComponent(start.upload_id)}`, { method: "PUT", raw: big })).json()) as { part_number: number; etag: string };
    const done = await api(`/files/${sha}/parts/done`, { body: { upload_id: start.upload_id, parts: [part] } });
    expect(done.status).toBe(200);
    const owner = await personOwner(env.DB, "dev-1");
    expect(await env.GAMES.head(ownedBlobKey(owner.id, sha))).not.toBeNull();
    expect(await env.GAMES.head(blobKey(sha))).toBeNull();

    const files = [...(await describeFiles({ "index.html": "<p>big</p>" })), { path: "data.bin", sha256: sha, size_bytes: big.byteLength, text: "" }];
    const plan = (await (await api("/games/hop/uploads", { body: { files: files.map(({ text: _, ...f }) => f) } })).json()) as { missing_file_hashes: string[] };
    expect(plan.missing_file_hashes).not.toContain(sha);

    // Another developer listing the same hash still has to send the file themselves.
    await createAccount(env.DB, { id: "dev-2", name: "Other Dev", ageBand: "18+" });
    const other = (await createApiKey(env.DB, "dev-2", "x")).token;
    await api("/games", { body: { title: "Copy", slug: "copy" }, key: other });
    const theirs = (await (await api("/games/copy/uploads", { body: { files: files.map(({ text: _, ...f }) => f) }, key: other })).json()) as { missing_file_hashes: string[] };
    expect(theirs.missing_file_hashes).toContain(sha);
  });

  it("refuses programs sent in parts", async () => {
    const exe = new Uint8Array(64);
    exe.set([0x4d, 0x5a]);
    const sha = await sha256Hex(exe);
    const start = (await (await api(`/files/${sha}/parts`, { body: { size_bytes: 64 } })).json()) as { upload_id: string };
    const part = await (await api(`/files/${sha}/parts/1?upload_id=${encodeURIComponent(start.upload_id)}`, { method: "PUT", raw: exe })).json();
    const done = await api(`/files/${sha}/parts/done`, { body: { upload_id: start.upload_id, parts: [part] } });
    expect(done.status).toBe(400);
  });
});

describe("daily cleanup", () => {
  it("deletes month-old drafts and files nothing uses, and keeps the rest", async () => {
    const live = await push(GAME, { publish_when_approved: true });
    await scan(live.version.id, pass);
    const draft = await push({ ...GAME, "game.js": "let draft = 1;" });
    await scan(draft.version.id, pass);
    const held = await push({ ...GAME, "game.js": "let held = 1;" });
    await scan(held.version.id, hold);
    const lonely = enc("never used");
    await api(`/files/${await sha256Hex(lonely)}`, { method: "PUT", raw: lonely });

    // A month and a day later.
    const later = Date.now() + 31 * 86400_000;
    const result = await dailyCleanup(env, later);
    expect(result.deletedDraftCount).toBe(1);
    expect(await versionById(env.DB, draft.version.id)).toBeNull();
    expect(await versionById(env.DB, live.version.id)).not.toBeNull();
    expect(await versionById(env.DB, held.version.id)).not.toBeNull();
    expect(await env.GAMES.head(blobKey(await sha256Hex(enc("let draft = 1;"))))).toBeNull();
    expect(await env.GAMES.head(blobKey(await sha256Hex(enc("never used"))))).toBeNull();
    expect(await env.GAMES.head(blobKey(await sha256Hex(enc(GAME["index.html"]))))).not.toBeNull();
    expect(await env.GAMES.head(blobKey(await sha256Hex(enc("let held = 1;"))))).not.toBeNull();
  });
});
