import { createExecutionContext, env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { REVIEW_CODES, addImage, KEPT_VERSION_COUNT, ownedBlobKey, personOwner, blobKey, brotliKeyOf, createAccount, createApiKey, gameBySlug, manifestKey, notConnected, sha256Hex, versionById, type ImageMatcher } from "@zaisma/core";
import { scanVersion, type ScanDeps } from "../../apps/site/src/scan.ts";
import { judgeSays, readsNothing, seesNothing } from "./scan-stubs.ts";
import { adminForm } from "../../apps/site/src/admin.ts";
import { dailyCleanup, publishDue } from "../../apps/site/src/cleanup.ts";
import { letPublish } from "../helpers.ts";
import worker from "../../apps/site/src/index.ts";

const SITE = "https://zaisma.test";
const testEnv = { ...env, ANTHROPIC_API_KEY: "test-key" };
const connected: ImageMatcher = { check: async (imgs) => ({ provider: "test", isConnected: true, checkedMediaCount: imgs.length, findings: [] }) };
const pass: ScanDeps = {
  images: connected,
  readCode: readsNothing,
  readPictures: seesNothing,
  judge: judgeSays("pass"),
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
    "DELETE FROM compressed_blobs; DELETE FROM blobs; DELETE FROM blob_owners; DELETE FROM owned_blobs; DELETE FROM game_access_passes; DELETE FROM game_images; DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;",
  );
  const all = await env.GAMES.list();
  if (all.objects.length) await env.GAMES.delete(all.objects.map((o) => o.key));
  await createAccount(env.DB, { id: "dev-1", username: "Pixel_Smith", ageBand: "18+" });
  await letPublish(env.DB, "dev-1");
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
    expect(((await wrong.json()) as { error: { code: string } }).error.code).toBe("hash_mismatch");
    expect(await env.GAMES.head(blobKey(real))).toBeNull();
    // Storage failing isn't the file's fault: never hash_mismatch.
    const broken = { ...env, GAMES: { ...env.GAMES, put: async () => { throw new Error("put: We encountered an internal error. Please try again. (10001)"); } } as unknown as R2Bucket };
    const failed = await worker.fetch(new Request(`${SITE}/api/dev/files/${real}`, { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-length": "5" }, body: enc("hello") }), broken, createExecutionContext());
    expect(failed.status).toBe(500);
    expect(((await failed.json()) as { error: { code: string } }).error.code).toBe("internal_error");

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
    // A version with no file list at all is a bad list, not a crash.
    const listless = await api("/games/hop/versions", { body: { patch_notes: "Nothing?" } });
    expect(listless.status).toBe(400);
    expect(await listless.text()).toContain("bad_files");
  });

  it("makes a passed upload a draft with a private preview link, then publishes it", async () => {
    const { version } = await push(GAME);
    await scan(version.id, pass);
    const draft = (await (await api(`/games/hop/versions/${version.id}`)).json()) as { version: { scan_status: string; is_live: boolean; preview_url: string } };
    expect(draft.version).toMatchObject({ scan_status: "approved", is_live: false });
    // The link is on zaisma.com; the game domain's address never holds its key.
    expect(draft.version.preview_url).toMatch(new RegExp(`^https://zaisma\\.test/p/${version.id}\\.[a-z0-9]+\\.[0-9a-f]{32}$`));
    const opened = await SELF.fetch(draft.version.preview_url, { redirect: "manual" });
    expect(opened.status).toBe(302);
    expect(opened.headers.get("location")).toMatch(/^https:\/\/games\.zaisma\.test\/hop--preview\/_zaisma\/enter\?grant=[a-z0-9]{32}$/);
    expect((await gameBySlug(env.DB, "hop"))!.live_version_id).toBeNull();

    // Turning its preview links off ends every one handed out so far; a fresh one works.
    const ended = await api(`/games/hop/versions/${version.id}/preview-links`, { method: "DELETE" });
    expect(ended.status).toBe(200);
    const fresh = ((await ended.json()) as { version: { preview_url: string; preview_url_expires_at: string } }).version;
    expect(fresh.preview_url).not.toBe(draft.version.preview_url);
    expect(Date.parse(fresh.preview_url_expires_at) - Date.now()).toBeGreaterThan(24 * 3600_000 - 1000);
    expect((await SELF.fetch(draft.version.preview_url, { redirect: "manual" })).status).toBe(404);
    expect((await SELF.fetch(fresh.preview_url, { redirect: "manual" })).status).toBe(302);
    // A made-up or tampered link opens nothing.
    expect((await SELF.fetch(fresh.preview_url.replace(/.$/, (last) => (last === "0" ? "1" : "0")), { redirect: "manual" })).status).toBe(404);

    const res = await api(`/games/hop/versions/${version.id}/publish`, { method: "POST" });
    expect(res.status).toBe(200);
    expect((await gameBySlug(env.DB, "hop"))!).toMatchObject({ live_version_id: version.id, review_status: "live" });
  });

  it("uses only files a developer sent themselves, and never says what others sent", async () => {
    await push(GAME);
    await createAccount(env.DB, { id: "dev-2", username: "Other_Dev", ageBand: "18+" });
    await letPublish(env.DB, "dev-2");
    const theirs = (await createApiKey(env.DB, "dev-2", "laptop")).token;
    await api("/games", { body: { title: "Copycat" }, key: theirs });
    const list = (await describeFiles(GAME)).map(({ text: _, ...f }) => f);
    // Naming my files by their hashes: Zaisma says they're missing, as if it had never seen them.
    const plan = (await (await api("/games/copycat/uploads", { body: { files: list }, key: theirs })).json()) as { missing_file_hashes: string[] };
    expect(plan.missing_file_hashes.sort()).toEqual(list.map((f) => f.sha256).sort());
    const claimed = await api("/games/copycat/versions", { body: { files: list }, key: theirs });
    expect(claimed.status).toBe(409);
    expect(((await claimed.json()) as { error: { code: string } }).error.code).toBe("files_missing");
    // Sending one is read and checked like any new file, and answered the same way.
    const wrong = await api(`/files/${list[1]!.sha256}`, { method: "PUT", raw: enc("not the file"), key: theirs });
    expect(wrong.status).toBe(400);
    const sent = await api(`/files/${list[1]!.sha256}`, { method: "PUT", raw: enc(GAME["game.js"]), key: theirs });
    expect(await sent.json()).toEqual({ sha256: list[1]!.sha256, storage_status: "stored_now" });
    // Only once it's theirs: storage still keeps one copy.
    expect(await (await api(`/files/${list[1]!.sha256}`, { method: "PUT", raw: enc(GAME["game.js"]), key: theirs })).json()).toEqual({ sha256: list[1]!.sha256, storage_status: "already_stored" });
    expect((await env.DB.prepare("SELECT COUNT(*) AS blob_count FROM blobs WHERE sha256 = ?").bind(list[1]!.sha256).first<{ blob_count: number }>())!.blob_count).toBe(1);
  });

  it("explains why a version was held and won't publish it", async () => {
    const { version } = await push(GAME);
    await scan(version.id, hold);
    const held = (await (await api(`/games/hop/versions/${version.id}`)).json()) as { version: { scan_status: string; preview_url: null; review_reason: null; findings: unknown[] } };
    expect(held.version.scan_status).toBe("held");
    expect(held.version.preview_url).toBeNull();
    expect(held.version.review_reason).toBeNull();
    // The code's own words, never the scan's notes for Zaisma (which name its secrets and providers).
    expect(held.version.findings).toEqual([{ code: "image_matching_off", severity: "hold", message: REVIEW_CODES.image_matching_off.meaning, content_rule: null, path: null, fix: REVIEW_CODES.image_matching_off.fix }]);
    const refused = await api(`/games/hop/versions/${version.id}/publish`, { method: "POST" });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: unknown }).error).toMatchObject({
      code: "not_approved",
      message: `This version is held, so it can't be published (image_matching_off): ${REVIEW_CODES.image_matching_off.meaning}`,
      fix: `${REVIEW_CODES.image_matching_off.fix} get_version shows every finding.`,
    });
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
    await createAccount(env.DB, { id: "dev-2", username: "Other_Dev", ageBand: "18+" });
    await letPublish(env.DB, "dev-2");
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
    await createAccount(env.DB, { id: "dev-2", username: "Other_Dev", ageBand: "18+" });
    await letPublish(env.DB, "dev-2");
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
    // A file's Brotli copy goes with it.
    const lonelyKey = blobKey(await sha256Hex(lonely));
    await env.GAMES.put(brotliKeyOf(lonelyKey), "copy");
    await env.DB.prepare("INSERT INTO compressed_blobs (storage_key, brotli_size_bytes, compressed_at_ms) VALUES (?, 4, 0)").bind(lonelyKey).run();

    // A month and a day later.
    const later = Date.now() + 31 * 86400_000;
    const result = await dailyCleanup(env, later);
    expect(result.deletedDraftCount).toBe(1);
    expect(await versionById(env.DB, draft.version.id)).toBeNull();
    expect(await versionById(env.DB, live.version.id)).not.toBeNull();
    expect(await versionById(env.DB, held.version.id)).not.toBeNull();
    expect(await env.GAMES.head(blobKey(await sha256Hex(enc("let draft = 1;"))))).toBeNull();
    expect(await env.GAMES.head(blobKey(await sha256Hex(enc("never used"))))).toBeNull();
    expect(await env.GAMES.head(brotliKeyOf(lonelyKey))).toBeNull();
    expect(await env.DB.prepare("SELECT 1 FROM compressed_blobs WHERE storage_key = ?").bind(lonelyKey).first()).toBeNull();
    expect(await env.GAMES.head(blobKey(await sha256Hex(enc(GAME["index.html"]))))).not.toBeNull();
    expect(await env.GAMES.head(blobKey(await sha256Hex(enc("let held = 1;"))))).not.toBeNull();
  });
});

describe("holds and takedowns say why", () => {
  const ai = (findings: unknown[], isChildSafety = false): ScanDeps => ({
    images: connected,
    readCode: readsNothing,
    readPictures: seesNothing,
    judge: judgeSays("hold", findings as never, isChildSafety),
  });
  const getVersion = async (id: string) => ((await (await api(`/games/hop/versions/${id}`)).json()) as { version: { scan_status: string; review_reason: unknown; findings: unknown[] } }).version;
  const getGame = async () => (await (await api("/games/hop")).json()) as { game: { review_status: string; review_reason: unknown }; images: { review_reason: unknown }[] };
  const history = async () => ((await (await api("/games/hop/history")).json()) as { events: { description: string; review_reason: unknown }[] }).events;
  const decide = (path: string, fields: Record<string, string>) => {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.set(name, value);
    return adminForm(testEnv, path, form, "julius@zaisma.test");
  };

  it("gives the AI review's own words, with the rule they're about", async () => {
    const { version } = await push(GAME);
    await scan(version.id, ai([{ stage: "ai", severity: "hold", code: "ai_sexual_content", message: "The hero is drawn nude.", path: "art/hero.png" }]));
    expect((await getVersion(version.id)).findings).toEqual([
      { code: "ai_sexual_content", severity: "hold", message: "The hero is drawn nude.", content_rule: "sexual", path: "art/hero.png", fix: REVIEW_CODES.ai_sexual_content.fix },
    ]);
  });

  it("never describes a child-safety hold", async () => {
    const { version } = await push(GAME);
    await scan(version.id, ai([{ stage: "ai", severity: "reject", code: "ai_minors_sexualized", message: "Never shown.", path: "index.html" }], true));
    const held = await getVersion(version.id);
    expect(held.scan_status).toBe("held");
    expect(held.findings).toEqual([{ code: "needs_review", severity: "hold", message: REVIEW_CODES.needs_review.meaning, content_rule: null, path: null, fix: REVIEW_CODES.needs_review.fix }]);
  });

  it("says why a person rejected a version, in the version and the history", async () => {
    const { version } = await push(GAME);
    await scan(version.id, hold);
    await decide(`/admin/versions/${version.id}/reject`, { content_rule: "copyright", reason: "The music is from Zelda." });
    const rejected = await getVersion(version.id);
    const reason = { code: "rejected_by_zaisma", message: "The music is from Zelda.", content_rule: "copyright", fix: REVIEW_CODES.rejected_by_zaisma.fix };
    expect(rejected).toMatchObject({ scan_status: "rejected", review_reason: reason });
    expect(rejected.findings).toHaveLength(1);
    expect((await history())[0]).toMatchObject({ description: "A version was rejected after review", review_reason: reason });

    // Approved after all: the reason goes.
    await decide(`/admin/versions/${version.id}/approve`, {});
    expect(await getVersion(version.id)).toMatchObject({ scan_status: "approved", review_reason: null });
  });

  it("says a report paused an update", async () => {
    const { version } = await push(GAME);
    await scan(version.id, pass);
    await env.DB.prepare("UPDATE versions SET scan_status = 'held', report_held_at_ms = 1 WHERE id = ?").bind(version.id).run();
    expect((await getVersion(version.id)).review_reason).toEqual({ code: "report_paused_update", message: REVIEW_CODES.report_paused_update.meaning, content_rule: null, fix: REVIEW_CODES.report_paused_update.fix });
  });

  it("says why a game was taken down, everywhere it can't change", async () => {
    const { version } = await push(GAME, { publish_when_approved: true });
    await scan(version.id, pass);
    const game = (await gameBySlug(env.DB, "hop"))!;
    await decide(`/admin/games/${game.id}/takedown`, { content_rule: "malware", reason: "The login screen asks players for their Steam password." });
    const reason = { code: "taken_down", message: "The login screen asks players for their Steam password.", content_rule: "malware", fix: REVIEW_CODES.taken_down.fix };
    expect((await getGame()).game).toMatchObject({ review_status: "removed", review_reason: reason });
    expect((await history())[0]).toMatchObject({ description: "Zaisma took the game down", review_reason: reason });

    const refused = await api("/games/hop", { method: "PATCH", body: { visibility: "unlisted" } });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: unknown }).error).toMatchObject({
      code: "game_removed",
      message: "Zaisma took this game down, so its visibility can't change (taken_down): The login screen asks players for their Steam password.",
      field: "visibility",
      fix: REVIEW_CODES.taken_down.fix,
    });

    await decide(`/admin/games/${game.id}/restore`, {});
    expect((await getGame()).game).toMatchObject({ review_status: "live", review_reason: null });
  });

  it("never tells the developer why a child-safety takedown happened", async () => {
    const game = (await gameBySlug(env.DB, "hop"))!;
    await decide(`/admin/games/${game.id}/takedown`, { content_rule: "child_safety", reason: "Matches a reported image; filed with NCMEC." });
    expect((await getGame()).game.review_reason).toEqual({ code: "taken_down", message: REVIEW_CODES.taken_down.meaning, content_rule: null, fix: REVIEW_CODES.taken_down.fix });
    expect(JSON.stringify(await history())).not.toContain("NCMEC");
  });

  it("says why an image wasn't approved", async () => {
    const game = (await gameBySlug(env.DB, "hop"))!;
    const image = await addImage(env.DB, { id: "image_cover1", game_id: game.id, kind: "cover", content_type: "image/png", width_px: 1920, height_px: 1080, size_bytes: 10 });
    await decide(`/admin/images/${image.id}/reject`, { reason: "The cover promises free Robux." });
    expect((await getGame()).images[0]!.review_reason).toEqual({ code: "image_rejected", message: "The cover promises free Robux.", content_rule: null, fix: REVIEW_CODES.image_rejected.fix });
  });
});
