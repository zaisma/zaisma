import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KNOWN_IMAGE_CODE, REVIEW_CODES, createAccount, createApiKey, sha256Hex, versionById, type Finding, type ImageMatcher, type MediaForMatching, type ScanReport } from "@zaisma/core";
import { scanVersion, type ScanDeps } from "../../apps/site/src/scan.ts";
import { adminForm } from "../../apps/site/src/admin.ts";
import { dailyCleanup } from "../../apps/site/src/cleanup.ts";
import { judgeSays, readsNothing, seesNothing } from "./scan-stubs.ts";
import { letPublish } from "../helpers.ts";
import { UNITY_FORMAT, rgbaPixels, serializedFile, texture2d, unityBundle, unityWebData } from "../engine-packs.ts";

const SITE = "https://zaisma.test";
const DAY_MS = 24 * 60 * 60 * 1000;
/** Arachnid Shield counts as connected, so files it cleared before aren't sent again. */
const testEnv = { ...env, ANTHROPIC_API_KEY: "test-key", ARACHNID_SHIELD_KEY: "user:password" };

/** A stand-in for Arachnid Shield that records what each scan sent, and matches the paths in `flagged`. */
let sentPaths: string[] = [];
let flaggedPaths: string[] = [];
const shield: ImageMatcher = {
  check: async (media: MediaForMatching[]) => {
    sentPaths.push(...media.map((item) => item.path));
    const findings: Finding[] = media.filter((item) => flaggedPaths.includes(item.path)).map((item) => ({ stage: "images", severity: "hold", code: KNOWN_IMAGE_CODE, message: "A match.", path: item.path }));
    return { provider: "arachnid-shield", isConnected: true, checkedMediaCount: media.length, findings };
  },
};
const deps: ScanDeps = { images: shield, readCode: readsNothing, readPictures: seesNothing, judge: judgeSays("pass") };

const enc = (text: string) => new TextEncoder().encode(text);
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** A picture's bytes: a PNG header and something to tell them apart. */
const picture = (name: string) => new Uint8Array([...PNG_HEAD, ...enc(name)]);

/** A whole PNG of about dataLength bytes, as an engine stores one inside its pack. */
const png = (dataLength: number) => {
  const chunk = (type: string, length: number) => [(length >>> 24) & 255, (length >>> 16) & 255, (length >>> 8) & 255, length & 255, ...enc(type), ...Array(length).fill(7), 0, 0, 0, 0];
  return new Uint8Array([...PNG_HEAD, ...chunk("IHDR", 13), ...chunk("IDAT", dataLength), ...chunk("IEND", 0)]);
};
/** A pack with a picture between other data. */
const packWith = (picture: Uint8Array) => new Uint8Array([...enc("GDPC"), ...Array(300).fill(1), ...picture, ...Array(300).fill(2)]);

const tokens = new Map<string, string>();
const emails: { to: string; subject: string; text: string }[] = [];
const authEmails = new Map<string, string>(); // account id -> email Supabase knows

async function api(token: string, path: string, init: { method?: string; body?: unknown; raw?: Uint8Array } = {}) {
  return SELF.fetch(`${SITE}/api/dev${path}`, {
    method: init.method ?? (init.body || init.raw ? "POST" : "GET"),
    headers: { authorization: `Bearer ${token}` },
    body: init.raw ?? (init.body ? JSON.stringify(init.body) : undefined),
  });
}

/** What the upload command does, as this developer, for this game: send what's missing and make the version. */
async function push(accountId: string, slug: string, files: Record<string, string | Uint8Array>) {
  const token = tokens.get(accountId)!;
  const list = await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      const bytes = typeof content === "string" ? enc(content) : content;
      return { path, sha256: await sha256Hex(bytes), size_bytes: bytes.byteLength, bytes };
    }),
  );
  const plan = (await (await api(token, `/games/${slug}/uploads`, { body: { files: list.map(({ bytes: _, ...file }) => file) } })).json()) as { missing_file_hashes: string[] };
  for (const file of list.filter((listed) => plan.missing_file_hashes.includes(listed.sha256))) {
    expect((await api(token, `/files/${file.sha256}`, { method: "PUT", raw: file.bytes })).status).toBe(200);
  }
  const response = await api(token, `/games/${slug}/versions`, { body: { files: list.map(({ bytes: _, ...file }) => file) } });
  expect(response.status).toBe(201);
  const versionId = ((await response.json()) as { version: { id: string } }).version.id;
  const report = await scanVersion(testEnv, versionId, deps);
  return { versionId, report };
}

async function developer(accountId: string, username: string, slug: string, title: string) {
  await createAccount(env.DB, { id: accountId, username, ageBand: "18+" });
  await letPublish(env.DB, accountId);
  tokens.set(accountId, (await createApiKey(env.DB, accountId, "laptop")).token);
  expect((await api(tokens.get(accountId)!, "/games", { body: { title, slug } })).status).toBe(201);
}

/** Sends the files a developer already sent once more a moment later, so who sent first is clear. */
async function later() {
  await env.DB.prepare("UPDATE blob_owners SET created_at_ms = created_at_ms - 60000").run();
  await env.DB.prepare("UPDATE owned_blobs SET created_at_ms = created_at_ms - 60000").run();
}

const decide = (path: string) => adminForm(testEnv, path, new FormData(), "julius@zaisma.test");
const findingsOf = async (accountId: string, slug: string, versionId: string) =>
  ((await (await api(tokens.get(accountId)!, `/games/${slug}/versions/${versionId}`)).json()) as { version: { scan_status: string; findings: { code: string; message: string; content_rule: string | null; fix: string }[] } }).version;

let realFetch: typeof fetch;
beforeEach(async () => {
  await env.DB.exec(
    "DELETE FROM checked_files; DELETE FROM blobs; DELETE FROM blob_owners; DELETE FROM owned_blobs; DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM security_events; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;",
  );
  const all = await env.GAMES.list();
  if (all.objects.length) await env.GAMES.delete(all.objects.map((object) => object.key));
  sentPaths = [];
  flaggedPaths = [];
  emails.length = 0;
  authEmails.clear();
  tokens.clear();
  realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === "https://outbox.test") {
      const sent = JSON.parse(String(init?.body)) as { to: string; subject: string; text: string };
      emails.push({ to: sent.to, subject: sent.subject, text: sent.text });
      return new Response("ok");
    }
    const user = url.origin === "https://supabase.test" ? url.pathname.match(/^\/auth\/v1\/admin\/users\/(.+)$/) : null;
    if (user) return Response.json({ id: decodeURIComponent(user[1]!), email: authEmails.get(decodeURIComponent(user[1]!)) });
    return realFetch(input, init);
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("an update scans only what changed", () => {
  beforeEach(() => developer("dev-1", "Emma_Builds", "hop", "Hop"));

  it("sends only new pictures to image matching, and says how many it reused", async () => {
    const first = await push("dev-1", "hop", { "index.html": "<!doctype html>", "art/sky.png": picture("sky"), "art/sun.png": picture("sun") });
    expect(sentPaths.sort()).toEqual(["art/sky.png", "art/sun.png"]);
    expect(first.report.images).toMatchObject({ provider: "arachnid-shield", checked_media_count: 2, reused_media_count: 0 });

    sentPaths = [];
    const second = await push("dev-1", "hop", { "index.html": "<!doctype html>", "art/sky.png": picture("sky"), "art/sun.png": picture("sun 2"), "art/moon.png": picture("sky") });
    expect(sentPaths.sort()).toEqual(["art/sun.png"]);
    expect(second.report.images).toMatchObject({ checked_media_count: 1, reused_media_count: 2 });
    expect(second.report.decision).toBe("approved");
  });

  it("finds hidden pictures once, and doesn't read files again that aren't pictures", async () => {
    await push("dev-1", "hop", { "index.html": "<!doctype html>", "data/level.hdr": enc("level one"), "data/hidden.bin": picture("hidden") });
    expect(sentPaths).toEqual(["data/hidden.bin"]);
    const notMedia = await env.DB.prepare("SELECT is_media, provider FROM checked_files WHERE sha256 = ?").bind(await sha256Hex(enc("level one"))).first();
    expect(notMedia).toEqual({ is_media: 0, provider: null });

    sentPaths = [];
    const second = await push("dev-1", "hop", { "index.html": "<!doctype html>", "data/level.hdr": enc("level one"), "data/hidden.bin": picture("hidden") });
    expect(sentPaths).toEqual([]);
    expect(second.report.images.reused_media_count).toBe(1);
  });

  it("matches pictures stored inside a pack, and doesn't search a cleared pack again", async () => {
    const pack = packWith(png(1500));
    await push("dev-1", "hop", { "index.html": "<!doctype html>", "index.pck": pack });
    expect(sentPaths).toEqual(["index.pck (picture 1 inside)"]);

    sentPaths = [];
    const second = await push("dev-1", "hop", { "index.html": "<!doctype html>", "index.pck": pack });
    expect(sentPaths).toEqual([]);
    expect(second.report.images.reused_media_count).toBe(1);
  });

  it("holds a version whose pack holds a known picture", async () => {
    flaggedPaths = ["game.data (picture 1 inside)"];
    const held = await push("dev-1", "hop", { "index.html": "<!doctype html>", "game.data": packWith(png(2000)) });
    expect(held.report.decision).toBe("held");
    expect(held.report.findings.some((finding) => finding.code === KNOWN_IMAGE_CODE)).toBe(true);
  });

  it("matches the textures inside a Unity build and an asset bundle, holds one that matches, and doesn't decode cleared ones again", async () => {
    const heroBundle = (name: string) => unityBundle([{ name: "CAB-1", bytes: serializedFile([{ classId: 28, pathId: 1, bytes: texture2d(name, 64, 64, UNITY_FORMAT.rgba32, rgbaPixels(64, 64, (x, y) => [x, y, 0, 255])) }]) }]);
    const build = unityWebData([{ name: "data.unity3d", bytes: heroBundle("Hero") }]);
    const first = await push("dev-1", "hop", { "index.html": "<!doctype html>", "Build/game.data": build, "StreamingAssets/extras.dat": heroBundle("Hero copy") });
    expect(sentPaths).toEqual(['Build/game.data (texture "Hero" inside)']);
    expect(first.report.decision).toBe("approved");

    sentPaths = [];
    const changedBuild = unityWebData([{ name: "boot.config", bytes: enc("changed") }, { name: "data.unity3d", bytes: heroBundle("Hero") }]);
    const second = await push("dev-1", "hop", { "index.html": "<!doctype html>", "Build/game.data": changedBuild });
    expect(sentPaths).toEqual([]);
    expect(second.report.images.reused_media_count).toBe(1);

    flaggedPaths = ['StreamingAssets/other.bin (texture "Villain" inside)'];
    const held = await push("dev-1", "hop", { "index.html": "<!doctype html>", "StreamingAssets/other.bin": unityBundle([{ name: "CAB-2", bytes: serializedFile([{ classId: 28, pathId: 1, bytes: texture2d("Villain", 64, 64, UNITY_FORMAT.rgba32, rgbaPixels(64, 64, () => [200, 0, 0, 255])) }]) }]) });
    expect(held.report.decision).toBe("held");
    expect(held.report.findings.some((finding) => finding.code === KNOWN_IMAGE_CODE)).toBe(true);
  });

  it("never remembers a match, so it's found again", async () => {
    flaggedPaths = ["art/bad.png"];
    const first = await push("dev-1", "hop", { "index.html": "<!doctype html>", "art/bad.png": picture("bad"), "art/ok.png": picture("ok") });
    expect(first.report.decision).toBe("held");
    sentPaths = [];
    const second = await push("dev-1", "hop", { "index.html": "<!doctype html>", "art/bad.png": picture("bad"), "art/ok.png": picture("ok") });
    expect(sentPaths).toEqual(["art/bad.png"]);
    expect(second.report.findings.some((finding) => finding.code === KNOWN_IMAGE_CODE)).toBe(true);
  });

  it("matches a file again after 30 days, and when a new matcher is connected", async () => {
    await push("dev-1", "hop", { "index.html": "<!doctype html>", "art/sky.png": picture("sky") });
    await env.DB.prepare("UPDATE checked_files SET checked_at_ms = ?").bind(Date.now() - 31 * DAY_MS).run();
    sentPaths = [];
    await push("dev-1", "hop", { "index.html": "<!doctype html>", "art/sky.png": picture("sky") });
    expect(sentPaths).toEqual(["art/sky.png"]);

    // PhotoDNA connected since: what only Arachnid Shield cleared is sent again.
    sentPaths = [];
    const withPhotoDna = { ...testEnv, PHOTODNA_KEY: "key", PHOTODNA: {} as never };
    const response = await api(tokens.get("dev-1")!, "/games/hop/versions", { body: { files: [{ path: "index.html", sha256: await sha256Hex(enc("<!doctype html>")), size_bytes: 15 }, { path: "art/sky.png", sha256: await sha256Hex(picture("sky")), size_bytes: picture("sky").byteLength }] } });
    await scanVersion(withPhotoDna, ((await response.json()) as { version: { id: string } }).version.id, deps);
    expect(sentPaths).toEqual(["art/sky.png"]);
  });

  it("forgets cleared files after 30 days in the daily cleanup", async () => {
    await push("dev-1", "hop", { "index.html": "<!doctype html>", "art/sky.png": picture("sky"), "art/sun.png": picture("sun") });
    await env.DB.prepare("UPDATE checked_files SET checked_at_ms = ? WHERE sha256 = ?").bind(Date.now() - 31 * DAY_MS, await sha256Hex(picture("sky"))).run();
    await dailyCleanup(testEnv);
    const { results } = await env.DB.prepare("SELECT sha256 FROM checked_files").all<{ sha256: string }>();
    expect(results.map((row) => row.sha256)).toEqual([await sha256Hex(picture("sun"))]);
  });

  it("matches everything with a matcher Zaisma didn't connect itself", async () => {
    const selfHosted = { ...testEnv, ARACHNID_SHIELD_KEY: undefined };
    await push("dev-1", "hop", { "index.html": "<!doctype html>", "art/sky.png": picture("sky") });
    sentPaths = [];
    const response = await api(tokens.get("dev-1")!, "/games/hop/versions", { body: { files: [{ path: "index.html", sha256: await sha256Hex(enc("<!doctype html>")), size_bytes: 15 }, { path: "art/sky.png", sha256: await sha256Hex(picture("sky")), size_bytes: picture("sky").byteLength }] } });
    await scanVersion(selfHosted, ((await response.json()) as { version: { id: string } }).version.id, deps);
    expect(sentPaths).toEqual(["art/sky.png"]);
  });
});

const SHARD_DODGE = { "index.html": "<!doctype html><script src=game.js></script>", "game.js": "let shards = 12;", "art/ship.png": picture("ship"), "art/rock.png": picture("rock"), "levels.json": '{"levels":3}' };

describe("a re-upload of another developer's game", () => {
  beforeEach(async () => {
    await developer("dev-1", "Emma_Builds", "shard-dodge", "Shard Dodge");
    await developer("dev-2", "dashking", "shard-dash", "Shard Dash");
    authEmails.set("dev-1", "emma@example.com");
  });

  it("is held for a person, without telling the uploader which game", async () => {
    await push("dev-1", "shard-dodge", SHARD_DODGE);
    await later();
    const { versionId, report } = await push("dev-2", "shard-dash", { ...SHARD_DODGE, "index.html": "<!doctype html><title>Shard Dash</title><script src=game.js></script>" });
    expect(report.decision).toBe("held");
    const original = await env.DB.prepare("SELECT id FROM games WHERE slug = 'shard-dodge'").first<{ id: string }>();
    expect(report.matched_game).toEqual({ game_id: original!.id, matched_file_count: 4, compared_file_count: 5 });
    const version = await findingsOf("dev-2", "shard-dash", versionId);
    expect(version.findings).toEqual([expect.objectContaining({ code: "matches_another_developers_game", content_rule: "copyright", message: REVIEW_CODES.matches_another_developers_game.meaning, fix: REVIEW_CODES.matches_another_developers_game.fix, message_for_people: REVIEW_CODES.matches_another_developers_game.messageForPeople })]);
    expect(JSON.stringify(version)).not.toContain("shard-dodge");
    expect(emails).toEqual([]);
  });

  it("isn't a game that changed more than a fifth of the files", async () => {
    await push("dev-1", "shard-dodge", SHARD_DODGE);
    await later();
    expect((await push("dev-2", "shard-dash", { ...SHARD_DODGE, "game.js": "let shards = 99;", "levels.json": "{}" })).report.decision).toBe("approved");
  });

  it("never holds the original's own update, or the developer's own other game", async () => {
    await push("dev-1", "shard-dodge", SHARD_DODGE);
    await later();
    await push("dev-2", "shard-dash", SHARD_DODGE);
    expect((await push("dev-1", "shard-dodge", { ...SHARD_DODGE, "levels.json": '{"levels":4}' })).report.decision).toBe("approved");
    expect((await api(tokens.get("dev-1")!, "/games", { body: { title: "Shard Dodge 2", slug: "shard-dodge-2" } })).status).toBe(201);
    expect((await push("dev-1", "shard-dodge-2", SHARD_DODGE)).report.decision).toBe("approved");
  });

  it("isn't a game that shares only an engine or libraries", async () => {
    // Two Godot-style games: the same engine and loader, their own pack, page and icon.
    await push("dev-1", "shard-dodge", { "index.html": "<!doctype html>Shard Dodge", "index.js": "godot loader", "index.wasm": enc("godot engine 4.3"), "index.pck": enc("shard dodge pack"), "icon.png": picture("dodge icon") });
    await later();
    const engine = await push("dev-2", "shard-dash", { "index.html": "<!doctype html>Space Farm", "index.js": "godot loader", "index.wasm": enc("godot engine 4.3"), "index.pck": enc("space farm pack"), "icon.png": picture("farm icon") });
    expect(engine.report.decision).toBe("approved");
    expect(engine.report.matched_game).toBeUndefined();

    // A library three developers sent doesn't count at all, so a page and the library aren't a copy.
    await developer("dev-3", "Lucas_Games", "tiny-farm", "Tiny Farm");
    await push("dev-3", "tiny-farm", { "index.html": "<!doctype html>Tiny Farm", "phaser.min.js": "phaser 3.80" });
    await push("dev-1", "shard-dodge", { "index.html": "<!doctype html>Shard Dodge", "phaser.min.js": "phaser 3.80" });
    await later();
    expect((await push("dev-2", "shard-dash", { "index.html": "<!doctype html>Space Farm", "phaser.min.js": "phaser 3.80" })).report.decision).toBe("approved");
  });

  it("tells the original developer once a person rejects it as a copy, with the uploader's name", async () => {
    await push("dev-1", "shard-dodge", SHARD_DODGE);
    await later();
    const { versionId } = await push("dev-2", "shard-dash", SHARD_DODGE);
    expect((await decide(`/admin/versions/${versionId}/reject-copy`)).status).toBe(303);

    const copy = await findingsOf("dev-2", "shard-dash", versionId);
    expect(copy.scan_status).toBe("rejected");
    expect((await versionById(env.DB, versionId))!.review_reason).toContain('"content_rule":"copyright"');

    const history = ((await (await api(tokens.get("dev-1")!, "/games/shard-dodge/history")).json()) as { events: { description: string; subject_name: string | null; version_id: string | null; done_by: string }[] }).events;
    expect(history[0]).toMatchObject({ description: "Zaisma stopped a re-upload of this game by another developer; it never reached players", subject_name: "dashking", version_id: null, done_by: "zaisma" });
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ to: "emma@example.com", subject: "We stopped a re-upload of Shard Dodge" });
    expect(emails[0]!.text).toContain("by dashking");

    // Once only.
    expect((await decide(`/admin/versions/${versionId}/reject-copy`)).status).toBe(409);
    expect(emails).toHaveLength(1);
  });

  it("tells nobody when a person approves it or rejects it for something else", async () => {
    await push("dev-1", "shard-dodge", SHARD_DODGE);
    await later();
    const approved = await push("dev-2", "shard-dash", SHARD_DODGE);
    await decide(`/admin/versions/${approved.versionId}/approve`);
    const rejected = await push("dev-2", "shard-dash", { ...SHARD_DODGE, "game.js": "let shards = 13;" });
    expect(rejected.report.decision).toBe("held");
    await decide(`/admin/versions/${rejected.versionId}/reject`);
    expect(emails).toEqual([]);
    const { results } = await env.DB.prepare("SELECT action FROM audit_log WHERE action = 'copy-stopped'").all();
    expect(results).toEqual([]);
  });

  it("can't be rejected as a copy when it matched nothing", async () => {
    const { versionId } = await push("dev-2", "shard-dash", SHARD_DODGE);
    expect((await decide(`/admin/versions/${versionId}/reject-copy`)).status).toBe(409);
  });

  it("shows the person which game and developer it matched", async () => {
    await push("dev-1", "shard-dodge", SHARD_DODGE);
    await later();
    const { versionId } = await push("dev-2", "shard-dash", SHARD_DODGE);
    const copyGameId = (await versionById(env.DB, versionId))!.game_id;
    const page = await (await SELF.fetch(`http://localhost/admin/games/${copyGameId}`)).text();
    expect(page).toContain("Shard Dodge</a> by Emma_Builds");
    expect(page).toContain(`/admin/versions/${versionId}/reject-copy`);
    const report = JSON.parse((await versionById(env.DB, versionId))!.scan_report!) as ScanReport;
    expect(report.findings.find((finding) => finding.code === "matches_another_developers_game")!.message).toContain("shard-dodge");
  });
});
