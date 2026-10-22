import { env, SELF } from "cloudflare:test";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addTesterLink, blobKey, brotliKeyOf, createAccessGrant, createEntryGrant, endPreviewPasses, gameBySlug, manifestKey, revokeTesterLink, sha256Hex } from "@zaisma/core";
import { isPlainHttpGameAddress, resolveGame } from "../../apps/games/src/index.ts";

const G = "https://games.example";

async function addGame(slug: string, status: string, withVersion = true) {
  const id = `g${slug.replace(/-/g, "")}`;
  const versionId = `v${id}`;
  const prefix = `games/${id}/${versionId}`;
  await env.DB.prepare("INSERT INTO games (id, slug, title, review_status, live_version_id, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, 0, 0)")
    .bind(id, slug, slug, status, withVersion ? versionId : null)
    .run();
  if (withVersion) {
    await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES (?, ?, ?, 2, 0, 'approved', 0)").bind(versionId, id, prefix).run();
    await env.GAMES.put(`${prefix}/index.html`, "<!doctype html><p>game</p>");
    await env.GAMES.put(`${prefix}/sfx/beep.mp3`, new Uint8Array(1000).fill(7));
  }
  return id;
}

describe("game server", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM game_access_passes; DELETE FROM tester_links; DELETE FROM performance_checks; DELETE FROM live_rooms; DELETE FROM versions; DELETE FROM domains; DELETE FROM games;");
  });
  afterAll(async () => {
    await env.DB.exec("DELETE FROM tester_links;");
  });

  it("serves a live game with the sandbox headers", async () => {
    await addGame("live-one", "live");
    const res = await SELF.fetch(`${G}/live-one/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<p>game</p>");
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors https://zaisma.test");
    expect(csp).toContain("form-action 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
    expect(res.headers.get("permissions-policy")).toContain("camera=()");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("sends Strict-Transport-Security on a missing game's 404 too", async () => {
    const res = await SELF.fetch(`${G}/no-such-game/`);
    expect(res.status).toBe(404);
    expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
  });

  it("knows which plain http addresses are a game's own", () => {
    const production = { GAME_HOST_MODE: "subdomain", GAME_DOMAIN: "zaismausercontent.com", SITE_ORIGIN: "https://zaisma.com" } as const;
    expect(isPlainHttpGameAddress(new URL("http://arena.zaismausercontent.com/"), production)).toBe(true);
    expect(isPlainHttpGameAddress(new URL("https://arena.zaismausercontent.com/"), production)).toBe(false);
    expect(isPlainHttpGameAddress(new URL("http://arena.zaismausercontent.com/"), { ...production, GAME_HOST_MODE: "path", GAME_DOMAIN: "" })).toBe(false);
    expect(isPlainHttpGameAddress(new URL("http://arena.zaismausercontent.com/"), { ...production, SITE_ORIGIN: "http://localhost:8800" })).toBe(false);
  });

  it("never serves a game's own game server to players", async () => {
    await addGame("live-one", "live");
    await env.GAMES.put("games/gliveone/vgliveone/zaisma-server.js", "export default {}");
    expect((await SELF.fetch(`${G}/live-one/zaisma-server.js`)).status).toBe(404);
    await env.GAMES.put("games/gliveone/vgliveone/zaisma-server/index.js", "export default {}");
    expect((await SELF.fetch(`${G}/live-one/zaisma-server/index.js`)).status).toBe(404);
  });

  it("adds the trailing slash so relative paths work", async () => {
    await addGame("live-one", "live");
    const res = await SELF.fetch(`${G}/live-one`, { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`${G}/live-one/`);
  });

  it("supports range requests for audio and video", async () => {
    await addGame("live-one", "live");
    const res = await SELF.fetch(`${G}/live-one/sfx/beep.mp3`, { headers: { Range: "bytes=0-99" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 0-99/1000");
    expect((await res.arrayBuffer()).byteLength).toBe(100);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
  });

  it("shows removed games as gone straight away", async () => {
    await addGame("gone", "removed");
    const res = await SELF.fetch(`${G}/gone/`);
    expect(res.status).toBe(410);
    expect(await res.text()).toContain("removed");
    expect((await SELF.fetch(`${G}/gone/sfx/beep.mp3`)).status).toBe(410);
  });

  it("hides held, pending and unknown games", async () => {
    await addGame("held-one", "held");
    await addGame("pending-one", "pending", false);
    expect((await SELF.fetch(`${G}/held-one/`)).status).toBe(404);
    expect((await SELF.fetch(`${G}/pending-one/`)).status).toBe(404);
    expect((await SELF.fetch(`${G}/nope/`)).status).toBe(404);
  });

  it("refuses path tricks", async () => {
    await addGame("live-one", "live");
    expect((await SELF.fetch(`${G}/live-one/%2e%2e/%2e%2e/x`)).status).toBe(404);
    expect((await SELF.fetch(`${G}/live-one/missing.js`)).status).toBe(404);
  });

  it("serves versions uploaded file by file from shared files", async () => {
    const id = await addGame("hop", "live", false);
    const enc = (t: string) => new TextEncoder().encode(t);
    const files = { "index.html": "<!doctype html><p>hop v2</p>", "js/game.js": "let x = 2;" };
    const manifest: Record<string, { sha256: string; bytes: number }> = {};
    for (const [path, text] of Object.entries(files)) {
      const sha = await sha256Hex(enc(text));
      await env.GAMES.put(blobKey(sha), text);
      manifest[path] = { sha256: sha, bytes: enc(text).byteLength };
    }
    await env.GAMES.put(manifestKey("vhop2"), JSON.stringify({ files: manifest }));
    await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, kind, created_at_ms) VALUES ('vhop2', ?, 'manifests/vhop2', 2, 0, 'approved', 'files', 0)").bind(id).run();
    await env.DB.prepare("UPDATE games SET live_version_id = 'vhop2' WHERE id = ?").bind(id).run();
    expect(await (await SELF.fetch(`${G}/hop/`)).text()).toContain("hop v2");
    expect(await (await SELF.fetch(`${G}/hop/js/game.js`)).text()).toBe("let x = 2;");
    expect((await SELF.fetch(`${G}/hop/js/other.js`)).status).toBe(404);
  });

  /** Open a game's tester or preview address the way the zaisma.com page does: a grant, swapped for the access cookie. */
  async function enter(slug: string, addressKind: "tester" | "preview", grantKey: string, then = "") {
    const entered = await SELF.fetch(`${G}/${slug}--${addressKind}/_zaisma/enter?grant=${grantKey}${then ? `&then=${encodeURIComponent(then)}` : ""}`, { redirect: "manual" });
    const setCookie = entered.headers.get("set-cookie") ?? "";
    return { entered, setCookie, cookie: setCookie.split(";")[0]! };
  }

  it("opens a draft only through its preview link, with the key never in the address", async () => {
    const id = await addGame("drafty", "pending", false);
    await env.DB.prepare("UPDATE games SET visibility = 'draft' WHERE id = ?").bind(id).run();
    await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, preview_link_key, created_at_ms) VALUES ('version_vd', ?, 'games/d/vd', 1, 0, 'approved', 'k', 0)").bind(id).run();
    await env.GAMES.put("games/d/vd/index.html", "<!doctype html><p>draft</p>");
    expect((await SELF.fetch(`${G}/drafty/`)).status).toBe(404);
    // Without the cookie, the preview address shows nothing.
    const bare = await SELF.fetch(`${G}/drafty--preview/`);
    expect(bare.status).toBe(404);
    expect(await bare.text()).toContain("Open this game through its link");

    const grantKey = await createAccessGrant(env.DB, { gameId: id, addressKind: "preview", versionId: "version_vd", expiresAtMs: Date.now() + 3600_000 });
    const { entered, setCookie, cookie } = await enter("drafty", "preview", grantKey);
    expect(entered.status).toBe(302);
    expect(entered.headers.get("location")).toBe("/drafty--preview/_zaisma/entered");
    expect(setCookie).toMatch(/^__Host-zaisma_access_drafty--preview=[a-z0-9]{32}; Path=\/; Max-Age=\d+; Secure; HttpOnly; SameSite=None; Partitioned$/);
    // A grant works once.
    expect((await enter("drafty", "preview", grantKey)).entered.status).toBe(404);

    const inside = await SELF.fetch(`${G}/drafty--preview/_zaisma/entered`, { headers: { cookie }, redirect: "manual" });
    expect(inside.headers.get("location")).toBe("/drafty--preview/");
    const res = await SELF.fetch(`${G}/drafty--preview/`, { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<p>draft</p>");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    // Every game is cross-origin isolated in its own frame (Chrome and Edge), with no COEP that would need zaisma.com's page isolated too.
    expect(res.headers.get("document-isolation-policy")).toBe("isolate-and-credentialless");
    expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(res.headers.get("cross-origin-embedder-policy")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    // The cookie is for this game's preview address only.
    expect((await SELF.fetch(`${G}/drafty--tester/`, { headers: { cookie } })).status).toBe(404);
    // A browser that didn't keep the cookie hears why.
    const dropped = await SELF.fetch(`${G}/drafty--preview/_zaisma/entered`, { redirect: "manual" });
    expect(dropped.status).toBe(403);
    expect(await dropped.text()).toContain("Safari 26.2");
    // Turning the version's preview links off (a new key and no passes) ends it at once.
    await endPreviewPasses(env.DB, "version_vd");
    expect((await SELF.fetch(`${G}/drafty--preview/`, { headers: { cookie } })).status).toBe(404);
    // A takedown closes previews too.
    await env.DB.prepare("UPDATE games SET review_status = 'removed' WHERE id = ?").bind(id).run();
    expect((await SELF.fetch(`${G}/drafty--preview/`, { headers: { cookie } })).status).toBe(410);
  });

  it("sends a stale or another game's grant nowhere, and keeps then inside the game", async () => {
    const id = await addGame("live-one", "live");
    const other = await addGame("other-one", "live");
    const link = await addTesterLink(env.DB, id, "Team");
    const theirs = await createAccessGrant(env.DB, { gameId: other, addressKind: "tester", testerId: link.id, expiresAtMs: Date.now() + 3600_000 });
    expect((await enter("live-one", "tester", theirs)).entered.status).toBe(404);
    const old = await createAccessGrant(env.DB, { gameId: id, addressKind: "tester", testerId: link.id, expiresAtMs: Date.now() + 3600_000 }, Date.now() - 61_000);
    expect((await enter("live-one", "tester", old)).entered.status).toBe(404);
    const grantKey = await createAccessGrant(env.DB, { gameId: id, addressKind: "tester", testerId: link.id, expiresAtMs: Date.now() + 3600_000 });
    const { entered, cookie } = await enter("live-one", "tester", grantKey, "/evil.example/");
    expect(entered.headers.get("location")).toBe("/live-one--tester/_zaisma/entered");
    const room = await createAccessGrant(env.DB, { gameId: id, addressKind: "tester", testerId: link.id, expiresAtMs: Date.now() + 3600_000 });
    const roomed = await enter("live-one", "tester", room, "?room=ABCDEF");
    expect(roomed.entered.headers.get("location")).toBe("/live-one--tester/_zaisma/entered?then=%3Froom%3DABCDEF");
    const inside = await SELF.fetch(`${G}/live-one--tester/_zaisma/entered?then=%3Froom%3DABCDEF`, { headers: { cookie: roomed.cookie }, redirect: "manual" });
    expect(inside.headers.get("location")).toBe("/live-one--tester/?room=ABCDEF");
    const testerPage = await SELF.fetch(`${G}/live-one--tester/`, { headers: { cookie } });
    expect(testerPage.status).toBe(200);
    // Tester plays aren't counted, so nothing measures how the game runs there.
    const testerText = await testerPage.text();
    expect(testerText).toContain("_zaisma/relay.js");
    expect(testerText).not.toContain("performance.js");
    // The old addresses with a key in them open nothing.
    expect((await SELF.fetch(`${G}/live-one--${link.token}/`)).status).toBe(404);
  });

  it("opens what a tester link chooses, whatever the visibility, until it's turned off or ends", async () => {
    const id = await addGame("secret-game", "live");
    await env.DB.prepare("UPDATE games SET visibility = 'private', cloud_saves_enabled = 1 WHERE id = ?").bind(id).run();
    const link = await addTesterLink(env.DB, id, "Playtesters");
    const open = async (testerId: string, gameId = id, slug = "secret-game") => (await enter(slug, "tester", await createAccessGrant(env.DB, { gameId, addressKind: "tester", testerId, expiresAtMs: Date.now() + 3600_000 }))).cookie;
    expect((await SELF.fetch(`${G}/secret-game/`)).status).toBe(404);
    const cookie = await open(link.id);
    const res = await SELF.fetch(`${G}/secret-game--tester/`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toContain("<p>game</p>");
    // Testers' saves stay in their browser, like previews.
    expect(page).not.toContain("saves.js");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    // Room links from the game go back through the tester link, and rooms hear which link it is.
    const sdkText = await (await SELF.fetch(`${G}/secret-game--tester/_zaisma/v1.js`, { headers: { cookie } })).text();
    expect(sdkText).toContain(`"page":"/t/${link.token}","tester":"${link.id}"`);
    expect(await (await SELF.fetch(`${G}/secret-game/_zaisma/v1.js`)).text()).not.toContain('"page"');

    // The newest version that passed, published or not, or one the developer picks.
    await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES ('version_next', ?, 'games/s/next', 1, 0, 'approved', 5)").bind(id).run();
    await env.GAMES.put("games/s/next/index.html", "<!doctype html><p>next</p>");
    await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES ('version_held', ?, 'games/s/held', 1, 0, 'held', 9)").bind(id).run();
    await env.DB.prepare("UPDATE tester_links SET version_choice = 'newest_passed' WHERE id = ?").bind(link.id).run();
    expect(await (await SELF.fetch(`${G}/secret-game--tester/`, { headers: { cookie } })).text()).toContain("<p>next</p>");
    await env.DB.prepare("UPDATE tester_links SET version_choice = 'picked', picked_version_id = 'vgsecretgame' WHERE id = ?").bind(link.id).run();
    expect(await (await SELF.fetch(`${G}/secret-game--tester/`, { headers: { cookie } })).text()).toContain("<p>game</p>");
    await env.DB.prepare("UPDATE tester_links SET picked_version_id = 'version_gone' WHERE id = ?").bind(link.id).run();
    expect(await (await SELF.fetch(`${G}/secret-game--tester/`, { headers: { cookie } })).text()).toContain("Nothing to play yet");
    await env.DB.prepare("UPDATE tester_links SET version_choice = 'live', picked_version_id = NULL WHERE id = ?").bind(link.id).run();

    // Another game's link doesn't open this one.
    const other = await addGame("other-game", "live");
    const theirs = await addTesterLink(env.DB, other, "Team");
    expect((await SELF.fetch(`${G}/secret-game--tester/`, { headers: { cookie: await open(theirs.id) } })).status).toBe(404);

    // Past its end date, it stops.
    await env.DB.prepare("UPDATE tester_links SET ends_at_ms = ? WHERE id = ?").bind(Date.now() - 1000, link.id).run();
    expect((await SELF.fetch(`${G}/secret-game--tester/`, { headers: { cookie } })).status).toBe(404);
    await env.DB.prepare("UPDATE tester_links SET ends_at_ms = NULL WHERE id = ?").bind(link.id).run();
    expect((await SELF.fetch(`${G}/secret-game--tester/`, { headers: { cookie } })).status).toBe(200);

    // Turned off: it stops at once.
    await revokeTesterLink(env.DB, id, link.id);
    expect((await SELF.fetch(`${G}/secret-game--tester/`, { headers: { cookie } })).status).toBe(404);

    // Nothing published yet: nothing to play.
    const none = await addGame("not-yet", "pending", false);
    const early = await addTesterLink(env.DB, none, "Early");
    const empty = await SELF.fetch(`${G}/not-yet--tester/`, { headers: { cookie: await open(early.id, none, "not-yet") } });
    expect(empty.status).toBe(404);
    expect(await empty.text()).toContain("Nothing to play yet");
  });

  it("serves an accounts-only game's public address only through the entry its page hands out", async () => {
    await addGame("members-only", "live");
    await env.DB.prepare("UPDATE games SET visibility = 'listed', account_requirement = 'whole_game', minimum_player_age_years = 16, entry_signing_key = 'keyone' WHERE slug = 'members-only'").run();
    const game = (await gameBySlug(env.DB, "members-only"))!;

    // Without the cookie, the game's files and the SDK are closed: someone skipping the page gets nothing.
    for (const path of ["", "sfx/beep.mp3", "_zaisma/v1.js"]) expect((await SELF.fetch(`${G}/members-only/${path}`)).status).toBe(404);

    // A grant swaps for the cookie, then the game opens at then, privately.
    const entered = await SELF.fetch(`${G}/members-only/_zaisma/enter?grant=${await createEntryGrant(game)}&then=${encodeURIComponent("?room=ABCDEF")}`, { redirect: "manual" });
    expect(entered.status).toBe(302);
    const setCookie = entered.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/^__Host-zaisma_access_members-only=\d+\.[0-9a-f]{64}; Path=\/; Max-Age=\d+; Secure; HttpOnly; SameSite=None; Partitioned$/);
    expect(entered.headers.get("location")).toBe("/members-only/_zaisma/entered?then=%3Froom%3DABCDEF");
    const cookie = setCookie.split(";")[0]!;
    const inside = await SELF.fetch(`${G}/members-only/_zaisma/entered?then=%3Froom%3DABCDEF`, { headers: { cookie }, redirect: "manual" });
    expect(inside.headers.get("location")).toBe("/members-only/?room=ABCDEF");
    const page = await SELF.fetch(`${G}/members-only/`, { headers: { cookie } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<p>game</p>");
    expect(page.headers.get("cache-control")).toBe("private, no-cache");
    expect(page.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    // A browser that didn't keep the cookie is told why.
    expect((await SELF.fetch(`${G}/members-only/_zaisma/entered`, { redirect: "manual" })).status).toBe(403);

    // An old grant, another game's, or one from before the key changed opens nothing.
    expect((await SELF.fetch(`${G}/members-only/_zaisma/enter?grant=${await createEntryGrant(game, Date.now() - 61_000)}`, { redirect: "manual" })).status).toBe(404);
    expect((await SELF.fetch(`${G}/members-only/_zaisma/enter?grant=${await createEntryGrant({ id: "gother", entry_signing_key: "keyone" })}`, { redirect: "manual" })).status).toBe(404);
    // A cookie is never a grant.
    expect((await SELF.fetch(`${G}/members-only/_zaisma/enter?grant=${cookie.split("=")[1]}`, { redirect: "manual" })).status).toBe(404);
    const beforeRotation = await createEntryGrant(game);
    await env.DB.prepare("UPDATE games SET entry_signing_key = 'keytwo' WHERE slug = 'members-only'").run();
    expect((await SELF.fetch(`${G}/members-only/_zaisma/enter?grant=${beforeRotation}`, { redirect: "manual" })).status).toBe(404);
    // A new key ends the cookies handed out too.
    expect((await SELF.fetch(`${G}/members-only/`, { headers: { cookie } })).status).toBe(404);

    // A game guests can play is served as before.
    await addGame("open-one", "live");
    await env.DB.prepare("UPDATE games SET visibility = 'listed' WHERE slug = 'open-one'").run();
    expect((await SELF.fetch(`${G}/open-one/`)).status).toBe(200);
  });

  describe("files uploaded one by one", () => {
    const enc = (text: string) => new TextEncoder().encode(text);
    // "let level = 1;\n" 200 times, and its Brotli copy, made with Node's zlib.
    const LEVEL = "let level = 1;\n".repeat(200);
    const LEVEL_BROTLI = Uint8Array.from(atob("G7cL+B0HdmPXQnjjspm1a7YeOrupELNTIGXxYAjQ2ACA45MG"), (character) => character.charCodeAt(0));

    /** A live game whose version is a file list, with what each file holds and, optionally, its Brotli copy. */
    async function addFilesGame(slug: string, files: Record<string, { text: string; brotli?: Uint8Array }>) {
      const id = await addGame(slug, "live", false);
      const manifest: Record<string, { sha256: string }> = {};
      const shas: Record<string, string> = {};
      for (const [path, file] of Object.entries(files)) {
        const sha = await sha256Hex(enc(file.text));
        await env.GAMES.put(blobKey(sha), file.text);
        if (file.brotli) await env.GAMES.put(brotliKeyOf(blobKey(sha)), file.brotli);
        manifest[path] = { sha256: sha };
        shas[path] = sha;
      }
      const versionId = `v${id}files`;
      await env.GAMES.put(manifestKey(versionId), JSON.stringify({ files: manifest }));
      await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, kind, created_at_ms) VALUES (?, ?, ?, 1, 0, 'approved', 'files', 0)").bind(versionId, id, `manifests/${versionId}`).run();
      await env.DB.prepare("UPDATE games SET live_version_id = ? WHERE id = ?").bind(versionId, id).run();
      return { id, shas };
    }

    /** Wait for the cache near players to have this file: it's kept after the answer goes out. */
    async function untilCached(storageKey: string, isCopy: boolean) {
      for (let i = 0; i < 100; i++) {
        if (await caches.default.match(`${G}/_zaisma/files/${storageKey}${isCopy ? ".br" : ""}`)) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`${storageKey} never reached the cache`);
    }

    it("sends a file's Brotli copy to browsers that take it, and the original to the rest", async () => {
      const { shas } = await addFilesGame("brotli-one", { "index.html": { text: "<!doctype html><p>b</p>" }, "Build/game.data": { text: LEVEL, brotli: LEVEL_BROTLI } });
      const sha = shas["Build/game.data"]!;
      const copy = await SELF.fetch(`${G}/brotli-one/Build/game.data`, { headers: { "Accept-Encoding": "gzip, br" } });
      expect(copy.status).toBe(200);
      expect(copy.headers.get("content-encoding")).toBe("br");
      expect(copy.headers.get("vary")).toBe("Accept-Encoding");
      expect(copy.headers.get("etag")).toBe(`"${sha}-br"`);
      expect(copy.headers.get("cache-control")).toBe("no-cache");
      expect(copy.headers.get("content-type")).toBe("application/octet-stream");
      // Sent as it is: the browser's decoding gives back the original, so nothing compressed it twice.
      expect(await copy.text()).toBe(LEVEL);

      const original = await SELF.fetch(`${G}/brotli-one/Build/game.data`, { headers: { "Accept-Encoding": "gzip" } });
      expect(original.headers.get("content-encoding")).toBeNull();
      expect(original.headers.get("etag")).toBe(`"${sha}"`);
      expect(await original.text()).toBe(LEVEL);
      expect((await SELF.fetch(`${G}/brotli-one/Build/game.data`, { headers: { "Accept-Encoding": "br;q=0" } })).headers.get("content-encoding")).toBeNull();

      // A file with no copy yet is the original, even for Brotli.
      const { shas: plain } = await addFilesGame("brotli-two", { "index.html": { text: "<!doctype html><p>c</p>" }, "level.json": { text: `{"level":"${"two".repeat(400)}"}` } });
      const uncopied = await SELF.fetch(`${G}/brotli-two/level.json`, { headers: { "Accept-Encoding": "br" } });
      expect(uncopied.headers.get("content-encoding")).toBeNull();
      expect(uncopied.headers.get("etag")).toBe(`"${plain["level.json"]}"`);
      expect(await uncopied.text()).toContain("twotwo");
    });

    it("answers a returning player's check by fingerprint without reading storage", async () => {
      const { shas } = await addFilesGame("revisit", { "index.html": { text: "<!doctype html><p>r</p>" }, "game.wasm": { text: `${LEVEL}revisit`, brotli: LEVEL_BROTLI } });
      const sha = shas["game.wasm"]!;
      // Nothing is stored any more, so a read would answer 404.
      await env.GAMES.delete([blobKey(sha), brotliKeyOf(blobKey(sha))]);
      for (const etag of [`"${sha}"`, `"${sha}-br"`, `W/"${sha}-br"`]) {
        const checked = await SELF.fetch(`${G}/revisit/game.wasm`, { headers: { "If-None-Match": etag, "Accept-Encoding": "br" } });
        expect(checked.status, etag).toBe(304);
        expect(checked.headers.get("cache-control")).toBe("no-cache");
      }
      expect((await SELF.fetch(`${G}/revisit/game.wasm`, { headers: { "If-None-Match": '"another"' } })).status).toBe(404);
    });

    it("sends part of a file from the original", async () => {
      const { shas } = await addFilesGame("ranged", { "index.html": { text: "<!doctype html><p>x</p>" }, "music.wav": { text: `${LEVEL}ranged`, brotli: LEVEL_BROTLI } });
      const part = await SELF.fetch(`${G}/ranged/music.wav`, { headers: { Range: "bytes=0-13", "Accept-Encoding": "br" } });
      expect(part.status).toBe(206);
      expect(part.headers.get("content-encoding")).toBeNull();
      expect(part.headers.get("content-range")).toBe(`bytes 0-13/${LEVEL.length + 6}`);
      expect(part.headers.get("etag")).toBe(`"${shas["music.wav"]}"`);
      expect(await part.text()).toBe("let level = 1;");
    });

    it("keeps files in the cache near players, read only after every access check", async () => {
      const { id, shas } = await addFilesGame("cached", { "index.html": { text: "<!doctype html><p>cached</p>" }, "Build/cached.data": { text: `${LEVEL}cached`, brotli: LEVEL_BROTLI } });
      const storageKey = blobKey(shas["Build/cached.data"]!);
      await (await SELF.fetch(`${G}/cached/Build/cached.data`, { headers: { "Accept-Encoding": "br" } })).arrayBuffer();
      await untilCached(storageKey, true);
      // Gone from storage, it's still sent from the cache.
      await env.GAMES.delete([storageKey, brotliKeyOf(storageKey)]);
      const fromCache = await SELF.fetch(`${G}/cached/Build/cached.data`, { headers: { "Accept-Encoding": "br" } });
      expect(fromCache.status).toBe(200);
      expect(fromCache.headers.get("content-encoding")).toBe("br");
      expect(fromCache.headers.get("etag")).toBe(`"${shas["Build/cached.data"]}-br"`);
      expect(await fromCache.text()).toBe(LEVEL);

      // A tester link's file needs the access cookie, cached or not.
      await env.DB.prepare("UPDATE games SET visibility = 'private' WHERE id = ?").bind(id).run();
      expect((await SELF.fetch(`${G}/cached/Build/cached.data`, { headers: { "Accept-Encoding": "br" } })).status).toBe(404);
      expect((await SELF.fetch(`${G}/cached--tester/Build/cached.data`, { headers: { "Accept-Encoding": "br" } })).status).toBe(404);
      // And a takedown applies at once.
      await env.DB.prepare("UPDATE games SET visibility = 'listed', review_status = 'removed' WHERE id = ?").bind(id).run();
      expect((await SELF.fetch(`${G}/cached/Build/cached.data`, { headers: { "Accept-Encoding": "br" } })).status).toBe(410);
    });

    it("leaves pages as they were: scripts added, checked each time", async () => {
      await addFilesGame("pages", { "index.html": { text: "<!doctype html><head></head><p>page</p>" } });
      const res = await SELF.fetch(`${G}/pages/`, { headers: { "Accept-Encoding": "br" } });
      expect(await res.text()).toContain("_zaisma/relay.js");
      expect(res.headers.get("cache-control")).toBe("no-cache");
      expect(res.headers.get("etag")).toMatch(/^W\/"/);
      expect(res.headers.get("content-encoding")).toBeNull();
    });
  });

  describe("each version's own address, so returning players skip file checks", () => {
    const enc = (text: string) => new TextEncoder().encode(text);
    const IMMUTABLE = "public, max-age=31536000, immutable";

    /** A file-by-file version of a game: approved, and published when isPublished. */
    async function addFilesVersion(gameId: string, versionId: string, files: Record<string, string>, isPublished: boolean) {
      const manifest: Record<string, { sha256: string }> = {};
      for (const [path, text] of Object.entries(files)) {
        const sha = await sha256Hex(enc(text));
        await env.GAMES.put(blobKey(sha), text);
        manifest[path] = { sha256: sha };
      }
      await env.GAMES.put(manifestKey(versionId), JSON.stringify({ files: manifest }));
      await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, kind, published_at_ms, created_at_ms) VALUES (?, ?, ?, 1, 0, 'approved', 'files', ?, 0)")
        .bind(versionId, gameId, `manifests/${versionId}`, isPublished ? 1 : null)
        .run();
    }

    it("opens pages at their version's address, keeping the query, and keeps what they load for good", async () => {
      const id = await addGame("kept", "live", false);
      await addFilesVersion(id, "vkept1", { "index.html": "<!doctype html><head></head><p>one</p>", "Build/game.wasm": "wasm one" }, true);
      await env.DB.prepare("UPDATE games SET live_version_id = 'vkept1' WHERE id = ?").bind(id).run();

      const opened = await SELF.fetch(`${G}/kept/?room=ABC234`, { redirect: "manual" });
      expect(opened.status).toBe(302);
      expect(opened.headers.get("location")).toBe("/kept/_zaisma/versions/vkept1/?room=ABC234");
      expect(opened.headers.get("cache-control")).toBe("no-store");
      expect((await SELF.fetch(`${G}/kept/menu.html`, { redirect: "manual" })).headers.get("location")).toBe("/kept/_zaisma/versions/vkept1/menu.html");

      const page = await SELF.fetch(`${G}/kept/_zaisma/versions/vkept1/`);
      expect(page.headers.get("cache-control")).toBe("no-cache");
      const text = await page.text();
      expect(text).toContain("<p>one</p>");
      expect(text).toContain('src="/kept/_zaisma/relay.js');

      const file = await SELF.fetch(`${G}/kept/_zaisma/versions/vkept1/Build/game.wasm`);
      expect(file.headers.get("cache-control")).toBe(IMMUTABLE);
      expect(await file.text()).toBe("wasm one");
      // At the game's own address (a file named by its full path), it's checked each time as before.
      expect((await SELF.fetch(`${G}/kept/Build/game.wasm`)).headers.get("cache-control")).toBe("no-cache");
      // The SDK, named by a relative path from a page at the version's address.
      expect((await SELF.fetch(`${G}/kept/_zaisma/versions/vkept1/_zaisma/v1.js`)).status).toBe(200);
    });

    it("sends an earlier version's page back to the live one, keeps its released files, and applies a takedown at once", async () => {
      const id = await addGame("updated", "live", false);
      await addFilesVersion(id, "vupdated1", { "index.html": "<!doctype html><p>one</p>", "level.json": "one" }, true);
      await addFilesVersion(id, "vupdated2", { "index.html": "<!doctype html><p>two</p>", "level.json": "two" }, true);
      await addFilesVersion(id, "vupdated3", { "index.html": "<!doctype html><p>three</p>", "level.json": "three" }, false);
      await env.DB.prepare("UPDATE games SET live_version_id = 'vupdated2' WHERE id = ?").bind(id).run();

      // A reload after the update: the old page goes back to the game's address, which opens the new version.
      const reloaded = await SELF.fetch(`${G}/updated/_zaisma/versions/vupdated1/?room=ABC234`, { redirect: "manual" });
      expect(reloaded.status).toBe(302);
      expect(reloaded.headers.get("location")).toBe("/updated/?room=ABC234");
      // A game still running the released version 1 finishes loading its own files.
      const earlier = await SELF.fetch(`${G}/updated/_zaisma/versions/vupdated1/level.json`);
      expect(earlier.headers.get("cache-control")).toBe(IMMUTABLE);
      expect(await earlier.text()).toBe("one");
      // A version never released isn't opened through the public address.
      const unreleased = await SELF.fetch(`${G}/updated/_zaisma/versions/vupdated3/level.json`, { redirect: "manual" });
      expect(unreleased.status).toBe(302);
      expect(unreleased.headers.get("location")).toBe("/updated/level.json");
      expect((await SELF.fetch(`${G}/updated/_zaisma/versions/nothing/level.json`, { redirect: "manual" })).headers.get("location")).toBe("/updated/level.json");

      await env.DB.prepare("UPDATE games SET review_status = 'removed' WHERE id = ?").bind(id).run();
      expect((await SELF.fetch(`${G}/updated/_zaisma/versions/vupdated2/level.json`)).status).toBe(410);
      expect((await SELF.fetch(`${G}/updated/_zaisma/versions/vupdated2/`)).status).toBe(410);
    });

    // A player always plays the version their room runs (docs/DEVELOPER-API.md, "Updates").
    it("serves a room's players the version it runs while it runs it, and only one the game could roll back to", async () => {
      const id = await addGame("rooms-on", "live", false);
      await addFilesVersion(id, "vroomson1", { "index.html": "<!doctype html><head></head><p>one</p>", "level.json": "one" }, true);
      await addFilesVersion(id, "vroomson2", { "index.html": "<!doctype html><head></head><p>two</p>", "level.json": "two" }, true);
      await addFilesVersion(id, "vroomson3", { "index.html": "<!doctype html><head></head><p>three</p>", "level.json": "three" }, false);
      await env.DB.prepare("UPDATE games SET live_version_id = 'vroomson2' WHERE id = ?").bind(id).run();
      const addRoom = (roomCode: string, versionId: string | null) =>
        env.DB.prepare("INSERT INTO live_rooms (game_id, room_code, player_count, maximum_player_count, version_id, created_at_ms, updated_at_ms) VALUES (?, ?, 2, 8, ?, ?, ?)").bind(id, roomCode, versionId, Date.now(), Date.now()).run();
      await addRoom("PRVRMA", "vroomson1");
      await addRoom("NEWRMA", "vroomson2");
      await addRoom("BLTNRM", null);
      await addRoom("UNRLSD", "vroomson3");
      const NAME = "__Host-zaisma_room_version_rooms-on";
      const cookie = `${NAME}=vroomson1.PRVRMA`;
      const get = (path: string, cookieHeader?: string) => SELF.fetch(`${G}/rooms-on/${path}`, { redirect: "manual", headers: cookieHeader ? { cookie: cookieHeader } : {} });
      const versionOfSdk = async (cookieHeader?: string) => (await (await get("_zaisma/v1.js", cookieHeader)).text()).match(/"version":"(\w+)"/)?.[1];

      // Opened into the room: its version's page, and the cookie that carries it to the page's other files.
      const opened = await get("?room=prvrma");
      expect(opened.headers.get("location")).toBe("/rooms-on/_zaisma/versions/vroomson1/?room=prvrma");
      expect(opened.headers.get("set-cookie")).toBe(`${cookie}; Path=/; Secure; HttpOnly; SameSite=None; Partitioned`);
      const page = await get("_zaisma/versions/vroomson1/?room=PRVRMA");
      expect(await page.text()).toContain("<p>one</p>");
      // Only this browser's: no shared cache keeps it, and nothing indexes it.
      expect(page.headers.get("cache-control")).toBe("private, no-cache");
      expect(page.headers.get("x-robots-tag")).toBe("noindex");
      const file = await get("level.json", cookie);
      expect(await file.text()).toBe("one");
      expect(file.headers.get("cache-control")).toBe("private, no-cache");
      expect(file.headers.get("set-cookie")).toBeNull();
      expect(await versionOfSdk(cookie)).toBe("vroomson1");
      expect(await (await get("_zaisma/versions/vroomson1/index.html", cookie)).text()).toContain("<p>one</p>");

      // Everyone else, and a page opened outside a room, plays the live version; the cookie goes.
      expect(await (await get("level.json")).text()).toBe("two");
      expect(await versionOfSdk()).toBe("vroomson2");
      const outside = await get("", cookie);
      expect(outside.headers.get("location")).toBe("/rooms-on/_zaisma/versions/vroomson2/");
      expect(outside.headers.get("set-cookie")).toBe(`${NAME}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=None; Partitioned`);
      // A room on the live version, or with a built-in game server, or on a version never released: the live one.
      for (const roomCode of ["NEWRMA", "BLTNRM", "UNRLSD", "NXRMZZ"]) {
        const elsewhere = await get(`?room=${roomCode}`);
        expect(elsewhere.headers.get("location")).toBe(`/rooms-on/_zaisma/versions/vroomson2/?room=${roomCode}`);
        expect(elsewhere.headers.get("set-cookie")).toBeNull();
      }
      // The version comes from the room, never the browser: a cookie naming another room's version, or another version, gets the live one.
      for (const named of [`${NAME}=vroomson1.NEWRMA`, `${NAME}=vroomson3.UNRLSD`, `${NAME}=vroomson2.PRVRMA`, `${NAME}=nonsense`]) {
        const forged = await get("level.json", named);
        expect(await forged.text()).toBe("two");
        expect(forged.headers.get("set-cookie")).toContain("Max-Age=0");
      }

      // Held, pruned or a room that stopped checking in: the live one at once.
      await env.DB.prepare("UPDATE versions SET report_held_at_ms = 1 WHERE id = 'vroomson1'").run();
      expect(await (await get("level.json", cookie)).text()).toBe("two");
      expect((await get("?room=PRVRMA")).headers.get("location")).toBe("/rooms-on/_zaisma/versions/vroomson2/?room=PRVRMA");
      await env.DB.prepare("UPDATE versions SET report_held_at_ms = NULL WHERE id = 'vroomson1'").run();
      await env.DB.prepare("UPDATE live_rooms SET updated_at_ms = 0 WHERE room_code = 'PRVRMA'").run();
      expect(await (await get("level.json", cookie)).text()).toBe("two");
      await env.DB.prepare("UPDATE live_rooms SET updated_at_ms = ? WHERE room_code = 'PRVRMA'").bind(Date.now()).run();
      expect(await (await get("level.json", cookie)).text()).toBe("one");
      await env.DB.prepare("DELETE FROM versions WHERE id = 'vroomson1'").run();
      expect(await (await get("level.json", cookie)).text()).toBe("two");
      // A takedown applies to it too.
      await env.DB.prepare("UPDATE games SET review_status = 'removed' WHERE id = ?").bind(id).run();
      expect((await get("level.json", cookie)).status).toBe(410);
    });

    it("leaves tester links to their own version, whatever room they open into", async () => {
      const id = await addGame("testers-room", "live");
      await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, published_at_ms, created_at_ms) VALUES ('vtestersold', ?, 'games/t/old', 1, 0, 'approved', 1, 0)").bind(id).run();
      await env.GAMES.put("games/t/old/index.html", "<!doctype html><p>old</p>");
      await env.DB.prepare("INSERT INTO live_rooms (game_id, room_code, player_count, maximum_player_count, version_id, created_at_ms, updated_at_ms) VALUES (?, 'TSTRRM', 2, 8, 'vtestersold', ?, ?)").bind(id, Date.now(), Date.now()).run();
      const link = await addTesterLink(env.DB, id, "Playtesters");
      const { cookie } = await enter("testers-room", "tester", await createAccessGrant(env.DB, { gameId: id, addressKind: "tester", testerId: link.id, expiresAtMs: Date.now() + 3600_000 }));
      const page = await SELF.fetch(`${G}/testers-room--tester/?room=TSTRRM`, { headers: { cookie: `${cookie}; __Host-zaisma_room_version_testers-room=vtestersold.TSTRRM` } });
      expect(await page.text()).toContain("<p>game</p>");
      expect(page.headers.get("set-cookie")).toBeNull();
    });

    it("keeps a zip version's files for good at its address", async () => {
      await addGame("zipped", "live");
      expect((await SELF.fetch(`${G}/zipped/`, { redirect: "manual" })).headers.get("location")).toBe("/zipped/_zaisma/versions/vgzipped/");
      const file = await SELF.fetch(`${G}/zipped/_zaisma/versions/vgzipped/sfx/beep.mp3`);
      expect(file.status).toBe(200);
      expect(file.headers.get("cache-control")).toBe(IMMUTABLE);
      expect((await SELF.fetch(`${G}/zipped/sfx/beep.mp3`)).headers.get("cache-control")).toBe("public, max-age=60");
    });
  });

  it("preloads the files its run in Chrome needed first, besides the ones the page names, up to 20", async () => {
    await addGame("live-one", "live");
    await env.GAMES.put("games/gliveone/vgliveone/index.html", '<!doctype html><script src="Build/loader.js"></script><p>game</p>');
    const before = await SELF.fetch(`${G}/live-one/`);
    expect(before.headers.get("link")).toBeNull();
    const startFiles = [
      { path: "Build/loader.js", destination: "script", is_cors_request: false, downloaded_size_bytes: 30_000 },
      { path: "Build/framework.js", destination: "script", is_cors_request: false, downloaded_size_bytes: 600_000 },
      { path: "Build/game data.data", destination: "fetch", is_cors_request: true, downloaded_size_bytes: 9_000_000 },
      ...Array.from({ length: 25 }, (_, i) => ({ path: `chunks/${i}.js`, destination: "script", is_cors_request: true, downloaded_size_bytes: 1000 })),
    ];
    await env.DB.prepare("INSERT INTO performance_checks (version_id, owner_id, check_status, start_files, queued_at_ms) VALUES ('vgliveone', 'owner', 'checked', ?, 0)").bind(JSON.stringify(startFiles)).run();
    const after = await SELF.fetch(`${G}/live-one/`);
    const links = after.headers.get("link")!.split(", ");
    // The loader the page names itself is found by the browser on its own.
    expect(links.slice(0, 2)).toEqual(["</live-one/_zaisma/versions/vgliveone/Build/framework.js>; rel=preload; as=script", "</live-one/_zaisma/versions/vgliveone/Build/game%20data.data>; rel=preload; as=fetch; crossorigin"]);
    expect(links).toHaveLength(20);
    expect(links[2]).toBe("</live-one/_zaisma/versions/vgliveone/chunks/0.js>; rel=preload; as=script; crossorigin");
    // A page cached before the run gets fetched again.
    expect(after.headers.get("etag")).not.toBe(before.headers.get("etag"));
    expect((await SELF.fetch(`${G}/live-one/_zaisma/versions/vgliveone/`, { headers: { "if-none-match": after.headers.get("etag")! } })).status).toBe(304);
  });

  it("warms up the live version's first files, up to 100 MB, only on the game's public address", async () => {
    const id = await addGame("live-one", "live");
    const startFiles = [
      { path: "Build/framework.js", destination: "script", is_cors_request: false, downloaded_size_bytes: 600_000 },
      { path: "Build/game.data", destination: "fetch", is_cors_request: true, downloaded_size_bytes: 90 * 1024 * 1024 },
      { path: "Build/game.wasm", destination: "fetch", is_cors_request: true, downloaded_size_bytes: 20 * 1024 * 1024 },
    ];
    expect(await (await SELF.fetch(`${G}/live-one/_zaisma/warm.json`)).json()).toEqual([]);
    await env.DB.prepare("INSERT INTO performance_checks (version_id, owner_id, check_status, start_files, queued_at_ms) VALUES ('vgliveone', 'owner', 'checked', ?, 0)").bind(JSON.stringify(startFiles)).run();
    expect(await (await SELF.fetch(`${G}/live-one/_zaisma/warm.json`)).json()).toEqual(["/live-one/_zaisma/versions/vgliveone/Build/framework.js", "/live-one/_zaisma/versions/vgliveone/Build/game.data"]);
    const page = await SELF.fetch(`${G}/live-one/_zaisma/warm`);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain('src="warm.js?v=1"');
    expect(await (await SELF.fetch(`${G}/live-one/_zaisma/warm.js`)).text()).toContain('fetch("warm.json"');
    // Tester and preview addresses, and accounts-only games, need a cookie before Play: no warm-up.
    expect((await SELF.fetch(`${G}/live-one--tester/_zaisma/warm.json`)).status).toBe(404);
    await env.DB.prepare("UPDATE games SET account_requirement = 'whole_game' WHERE id = ?").bind(id).run();
    expect((await SELF.fetch(`${G}/live-one/_zaisma/warm.json`)).status).toBe(404);
  });

  it("only allows reading", async () => {
    expect((await SELF.fetch(`${G}/live-one/`, { method: "POST" })).status).toBe(405);
  });
});

describe("resolveGame", () => {
  const sub = { GAME_HOST_MODE: "subdomain" as const, GAME_DOMAIN: "zaismausercontent.com" };
  it("reads the slug from the path on workers.dev", () => {
    expect(resolveGame(new URL("https://x.workers.dev/shard-dodge/js/a.js"), { GAME_HOST_MODE: "path", GAME_DOMAIN: "" })).toEqual({ by: { slug: "shard-dodge" }, path: "js/a.js", base: "/shard-dodge/" });
  });
  it("reads the slug from the subdomain on the game domain", () => {
    expect(resolveGame(new URL("https://shard-dodge.zaismausercontent.com/js/a.js"), sub)).toEqual({ by: { slug: "shard-dodge" }, path: "js/a.js", base: "/" });
    expect(resolveGame(new URL("https://a.b.zaismausercontent.com/"), sub)).toBeNull();
  });
  it("never serves games from the bare game domain", () => {
    expect(resolveGame(new URL("https://zaismausercontent.com/shard-dodge/"), sub)).toBeNull();
  });
  it("treats any other host as a developer's own domain", () => {
    expect(resolveGame(new URL("https://play.mygame.com/"), sub)).toEqual({ by: { hostname: "play.mygame.com" }, path: "", base: "/" });
  });
});

describe("a game's background", () => {
  const SOURCE = "void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(fragCoord / iResolution.xy, 0.5, 1.0); }";
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM game_backgrounds; DELETE FROM game_shaders; DELETE FROM game_access_passes; DELETE FROM tester_links; DELETE FROM versions; DELETE FROM domains; DELETE FROM games;");
  });

  /** A live game showing an approved shader on wide screens. */
  async function gameWithShader(slug: string, status = "live") {
    const id = await addGame(slug, status);
    const shaderId = `shader_${slug.replace(/-/g, "")}`;
    await env.DB.prepare("INSERT INTO game_shaders (id, game_id, screen, size_bytes, review_status, created_at_ms) VALUES (?, ?, 'wide', 100, 'approved', 0)").bind(shaderId, id).run();
    await env.DB.prepare("INSERT INTO game_backgrounds (game_id, screen, source, shader_id, updated_at_ms) VALUES (?, 'wide', 'shader', ?, 0)").bind(id, shaderId).run();
    await env.GAMES.put(`shaders/${id}/${shaderId}.glsl`, SOURCE);
    await env.GAMES.put(`shaders/${id}/${shaderId}.still.png`, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    return id;
  }

  it("serves the runner on the game's own site, with its headers and none of the game's scripts", async () => {
    await gameWithShader("sky");
    const runner = await SELF.fetch(`${G}/sky/_zaisma/background?screen=wide`);
    expect(runner.status).toBe(200);
    expect(runner.headers.get("content-security-policy")).toContain("frame-ancestors https://zaisma.test");
    const page = await runner.text();
    expect(page).toContain("_zaisma/background.glsl?screen=wide&shader=shader_sky");
    expect(page).not.toContain("relay.js");
    expect(page).not.toContain("picture.js");
    const source = await SELF.fetch(`${G}/sky/_zaisma/background.glsl?screen=wide`);
    expect(await source.text()).toBe(SOURCE);
    expect(source.headers.get("content-type")).toContain("text/plain");
    const still = await SELF.fetch(`${G}/sky/_zaisma/background-still.png?screen=wide`);
    expect(still.headers.get("content-type")).toBe("image/png");
    await still.arrayBuffer();
  });

  it("follows wide on phones, and has nothing for a screen with no shader or a game players can't see", async () => {
    const id = await gameWithShader("sky");
    expect((await SELF.fetch(`${G}/sky/_zaisma/background.glsl?screen=phone`)).status).toBe(200);
    await env.DB.prepare("INSERT INTO game_backgrounds (game_id, screen, source, updated_at_ms) VALUES (?, 'phone', 'zaisma', 0)").bind(id).run();
    expect((await SELF.fetch(`${G}/sky/_zaisma/background?screen=phone`)).status).toBe(404);
    expect((await SELF.fetch(`${G}/sky/_zaisma/background?screen=sideways`)).status).toBe(404);
    await addGame("plain", "live");
    expect((await SELF.fetch(`${G}/plain/_zaisma/background?screen=wide`)).status).toBe(404);
    await gameWithShader("held-one", "held");
    expect((await SELF.fetch(`${G}/held-one/_zaisma/background?screen=wide`)).status).toBe(404);
    await env.DB.prepare("UPDATE game_shaders SET review_status = 'pending' WHERE game_id = ?").bind(id).run();
    expect((await SELF.fetch(`${G}/sky/_zaisma/background.glsl?screen=wide`)).status).toBe(404);
  });

  it("serves the preview runner, which draws only what the site posts it", async () => {
    await addGame("sky", "live");
    const preview = await SELF.fetch(`${G}/sky/_zaisma/shader-preview`);
    expect(preview.status).toBe(200);
    const page = await preview.text();
    expect(page).toContain('"isPreview":true');
    expect(page).toContain('"site":"https://zaisma.test"');
    expect(page).toContain("event.origin !== config.site");
    expect(preview.headers.get("content-security-policy")).toContain("frame-ancestors https://zaisma.test");
  });
});
