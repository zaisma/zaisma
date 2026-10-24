import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { withScripts } from "../../apps/games/src/index.ts";

const G = "https://games.example";

async function addGame(slug: string, cloudSaves = 1) {
  const id = `g${slug.replace(/-/g, "")}`;
  const prefix = `games/${id}/v1`;
  await env.DB.prepare("INSERT INTO games (id, slug, title, review_status, live_version_id, cloud_saves_enabled, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 'live', 'v1', ?, 0, 0)")
    .bind(id, slug, slug, cloudSaves)
    .run();
  await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES ('v1', ?, ?, 1, 0, 'approved', 0)").bind(id, prefix).run();
  await env.GAMES.put(`${prefix}/index.html`, '<!doctype html><html><head><title>t</title><script src="game.js"></script></head><p>game</p>');
  await env.GAMES.put(`${prefix}/levels/two.html`, "<p>no head</p>");
}

describe("cloud saves on the game domain", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM versions; DELETE FROM domains; DELETE FROM games;");
  });

  // The saves script is told the version the page was served from.
  const OURS = '<script src="/saver/_zaisma/relay.js?v=7"></script><script src="/saver/_zaisma/saves.js?v=7&version_id=v1"></script><script src="/saver/_zaisma/picture.js?v=7"></script><script src="/saver/_zaisma/performance.js?v=7"></script>';

  it("adds the relay, saves, picture and performance scripts first in every page's head", async () => {
    await addGame("saver");
    const page = await (await SELF.fetch(`${G}/saver/`)).text();
    expect(page).toContain(`<head>${OURS}<title>`);
    expect(page.indexOf("_zaisma/picture.js")).toBeLessThan(page.indexOf("game.js"));
    expect(await (await SELF.fetch(`${G}/saver/levels/two.html`)).text()).toBe(`${OURS}<p>no head</p>`);
  });

  it("answers repeat visits with 304 using its own ETag", async () => {
    await addGame("saver");
    const first = await SELF.fetch(`${G}/saver/`);
    const etag = first.headers.get("etag")!;
    expect(etag).toMatch(/^W\/".*-v1-z7sm"$/);
    expect((await SELF.fetch(`${G}/saver/`, { headers: { "If-None-Match": etag } })).status).toBe(304);
  });

  it("gives two versions with the same page different ETags, since their saves script is told a different version", async () => {
    await addGame("saver");
    const first = (await SELF.fetch(`${G}/saver/`)).headers.get("etag")!;
    await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES ('v2', 'gsaver', 'games/gsaver/v2', 1, 0, 'approved', 0)").run();
    await env.GAMES.put("games/gsaver/v2/index.html", '<!doctype html><html><head><title>t</title><script src="game.js"></script></head><p>game</p>');
    await env.DB.prepare("UPDATE games SET live_version_id = 'v2' WHERE id = 'gsaver'").run();
    const second = await SELF.fetch(`${G}/saver/`);
    expect(await second.text()).toContain("_zaisma/saves.js?v=7&version_id=v2");
    expect(second.headers.get("etag")).not.toBe(first);
    expect(second.headers.get("etag")!.replace("-v2-", "-v1-")).toBe(first);
  });

  it("serves the script and the restore page, set up for zaisma.com", async () => {
    await addGame("saver");
    const script = await SELF.fetch(`${G}/saver/_zaisma/saves.js?v=7&version_id=version_abc123`);
    expect(script.headers.get("content-type")).toContain("javascript");
    const text = await script.text();
    // Its setup is a parameter, never a global the game can read.
    expect(text.startsWith("(function (__ZAISMA_SAVES__) {\n")).toBe(true);
    expect(text.endsWith('\n})({"site":"https://zaisma.test","saveLimitBytes":5242880,"versionId":"version_abc123"});\n')).toBe(true);
    expect(text).not.toContain("var __ZAISMA");
    expect(text).toContain("_zaisma\\/restore");
    const restore = await SELF.fetch(`${G}/saver/_zaisma/restore`);
    expect(await restore.text()).toContain('<script src="saves.js?v=7&version_id=v1"></script>');
    expect(restore.headers.get("content-security-policy")).toContain("frame-ancestors https://zaisma.test");
  });

  it("tells the saves script no version when the one it was given isn't a version ID", async () => {
    await addGame("saver");
    for (const query of ["?v=7&version_id=game_abc123", "?v=7&version_id=%3Cscript%3E", "?v=7"]) {
      const text = await (await SELF.fetch(`${G}/saver/_zaisma/saves.js${query}`)).text();
      expect(text.endsWith('\n})({"site":"https://zaisma.test","saveLimitBytes":5242880,"versionId":null});\n')).toBe(true);
    }
  });

  it("gives games with cloud saves off no saves script", async () => {
    await addGame("own-saves", 0);
    const page = await (await SELF.fetch(`${G}/own-saves/`)).text();
    expect(page).not.toContain("_zaisma/saves.js");
    expect(page).toContain('<head><script src="/own-saves/_zaisma/relay.js?v=7"></script><script src="/own-saves/_zaisma/picture.js?v=7"></script><script src="/own-saves/_zaisma/performance.js?v=7"></script><title>');
    const script = await (await SELF.fetch(`${G}/own-saves/_zaisma/picture.js`)).text();
    expect(script.startsWith("(function (__ZAISMA_PICTURE__) {\n")).toBe(true);
    expect(script.endsWith('\n})({"site":"https://zaisma.test"});\n')).toBe(true);
    expect(script).not.toContain("var __ZAISMA");
    expect((await SELF.fetch(`${G}/own-saves/_zaisma/saves.js`)).status).toBe(404);
    expect((await SELF.fetch(`${G}/own-saves/_zaisma/restore`)).status).toBe(404);
  });

  it("measures how the game runs unless the developer turned it off", async () => {
    await addGame("measured");
    const script = await (await SELF.fetch(`${G}/measured/_zaisma/performance.js`)).text();
    expect(script.startsWith("(function (__ZAISMA_PERFORMANCE__) {\n")).toBe(true);
    expect(script).toContain('})({"site":"https://zaisma.test","limits":{');
    expect(script).not.toContain("var __ZAISMA");
    // The first draw is watched the same way as in the Chrome check, before the measuring.
    expect(script.indexOf("__zaismaFirstDraw = state")).toBeLessThan(script.indexOf("zaisma:performance"));
    await env.DB.prepare("UPDATE games SET performance_measuring_enabled = 0 WHERE slug = 'measured'").run();
    const page = await SELF.fetch(`${G}/measured/`);
    expect(await page.text()).not.toContain("performance.js");
    expect(page.headers.get("etag")).toMatch(/-z7s"$/);
    expect((await SELF.fetch(`${G}/measured/_zaisma/performance.js`)).status).toBe(404);
  });

  it("puts the tag in the right place for odd pages", () => {
    const t = '<script src="/s.js"></script><script src="/p.js"></script>';
    const put = (page: string) => withScripts(page, ["/s.js", "/p.js"]);
    expect(put('<HTML lang="en"><HEAD class="x"><p>')).toBe(`<HTML lang="en"><HEAD class="x">${t}<p>`);
    expect(put("<html><body>hi")).toBe(`<html>${t}<body>hi`);
    expect(put("<!DOCTYPE html><p>hi")).toBe(`<!DOCTYPE html>${t}<p>hi`);
    expect(put("<header>not a head</header>")).toBe(`${t}<header>not a head</header>`);
  });
});
