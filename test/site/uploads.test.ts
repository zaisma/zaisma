import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { KEEP_VERSIONS, blobKey, createAccount, createApiKey, gameBySlug, manifestKey, notConnected, sha256Hex, versionById, type ImageMatcher } from "@zaisma/core";
import { scanVersion, type ScanDeps } from "../../apps/site/src/scan.ts";

const SITE = "https://zaisma.test";
const testEnv = { ...env, ANTHROPIC_API_KEY: "test-key" };
const connected: ImageMatcher = { check: async (imgs) => ({ provider: "test", connected: true, checked: imgs.length, findings: [] }) };
const pass: ScanDeps = {
  images: connected,
  ai: async () => ({ report: { model: "test", verdict: "pass", summary: "fine", inputTokens: 10, outputTokens: 1 }, findings: [], childSafety: false }),
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
  return Promise.all(Object.entries(files).map(async ([path, text]) => ({ path, sha256: await sha256Hex(enc(text)), bytes: enc(text).byteLength, text })));
}

/**
 * The test Worker's own queue consumer scans each new version straight away (and holds it,
 * with nothing connected). Wait for that, then scan again with the checks this test wants.
 */
async function scan(id: string, deps: ScanDeps) {
  for (let i = 0; i < 60; i++) {
    if ((await versionById(env.DB, id))?.scan_status !== "scanning") break;
    await new Promise((r) => setTimeout(r, 50));
  }
  return scanVersion(testEnv, id, deps);
}

/** What the upload command does: ask what's missing, send it, make the version. */
async function push(files: Record<string, string>, extra: Record<string, unknown> = {}) {
  const list = await describeFiles(files);
  const plan = (await (await api("/games/hop/uploads", { body: { files: list.map(({ text: _, ...f }) => f) } })).json()) as { missing: string[] };
  for (const f of list.filter((f) => plan.missing.includes(f.sha256))) {
    expect((await api(`/files/${f.sha256}`, { method: "PUT", raw: enc(f.text) })).status).toBe(200);
  }
  const res = await api("/games/hop/versions", { body: { files: list.map(({ text: _, ...f }) => f), ...extra } });
  expect(res.status).toBe(201);
  return { sent: plan.missing.length, version: ((await res.json()) as { version: { id: string } }).version };
}

beforeEach(async () => {
  await env.DB.exec(
    "DELETE FROM blobs; DELETE FROM game_images; DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;",
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
    const first = await push(GAME, { notes: "First version." });
    expect(first.sent).toBe(3);
    const v = (await versionById(env.DB, first.version.id))!;
    expect(v).toMatchObject({ kind: "files", file_count: 3, notes: "First version.", publish_when_approved: 0 });
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
    const draft = (await (await api(`/games/hop/versions/${version.id}`)).json()) as { version: { scan: string; live: boolean; preview_url: string } };
    expect(draft.version).toMatchObject({ scan: "approved", live: false });
    expect(draft.version.preview_url).toMatch(/^https:\/\/games\.zaisma\.test\/hop--[a-z0-9]{20}\/$/);
    expect((await gameBySlug(env.DB, "hop"))!.current_version_id).toBeNull();

    const res = await api(`/games/hop/versions/${version.id}/publish`, { method: "POST" });
    expect(res.status).toBe(200);
    expect((await gameBySlug(env.DB, "hop"))!).toMatchObject({ current_version_id: version.id, status: "live" });
  });

  it("explains why a version was held and won't publish it", async () => {
    const { version } = await push(GAME);
    await scan(version.id, hold);
    const held = (await (await api(`/games/hop/versions/${version.id}`)).json()) as { version: { scan: string; preview_url: null; findings: { rule: string }[] } };
    expect(held.version.scan).toBe("held");
    expect(held.version.preview_url).toBeNull();
    expect(held.version.findings.map((f) => f.rule)).toContain("image-matching-not-connected");
    expect((await api(`/games/hop/versions/${version.id}/publish`, { method: "POST" })).status).toBe(409);
  });

  it("can go live by itself when asked to", async () => {
    const { version } = await push(GAME, { publish: "when-approved" });
    await scan(version.id, pass);
    expect((await gameBySlug(env.DB, "hop"))!.current_version_id).toBe(version.id);
  });

  it("rolls back, and keeps the live version plus the last five", async () => {
    const ids: string[] = [];
    for (let i = 0; i < KEEP_VERSIONS + 2; i++) {
      const { version } = await push({ ...GAME, "game.js": `let x = ${i};` }, { publish: "when-approved" });
      await scan(version.id, pass);
      ids.push(version.id);
    }
    // Back to an older one.
    expect((await api(`/games/hop/versions/${ids[2]}/publish`, { method: "POST" })).status).toBe(200);
    expect((await gameBySlug(env.DB, "hop"))!.current_version_id).toBe(ids[2]);
    const { results } = await env.DB.prepare("SELECT id FROM versions WHERE game_id = (SELECT id FROM games WHERE slug = 'hop')").all<{ id: string }>();
    expect(results.length).toBeLessThanOrEqual(KEEP_VERSIONS + 1);
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
