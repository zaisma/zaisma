import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { withScripts } from "../../apps/games/src/index.ts";

const G = "https://games.example";

async function addGame(slug: string, cloudSaves = 1) {
  const id = `g${slug.replace(/-/g, "")}`;
  const prefix = `games/${id}/v1`;
  await env.DB.prepare("INSERT INTO games (id, slug, title, status, current_version_id, cloud_saves, created_at, updated_at) VALUES (?, ?, ?, 'live', 'v1', ?, 0, 0)")
    .bind(id, slug, slug, cloudSaves)
    .run();
  await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, bytes, scan_status, created_at) VALUES ('v1', ?, ?, 1, 0, 'approved', 0)").bind(id, prefix).run();
  await env.GAMES.put(`${prefix}/index.html`, '<!doctype html><html><head><title>t</title><script src="game.js"></script></head><p>game</p>');
  await env.GAMES.put(`${prefix}/levels/two.html`, "<p>no head</p>");
}

describe("cloud saves on the game domain", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM versions; DELETE FROM domains; DELETE FROM games;");
  });

  const OURS = '<script src="/saver/_zaisma/saves.js?v=3"></script><script src="/saver/_zaisma/picture.js?v=3"></script>';

  it("adds the saves and picture scripts first in every page's head", async () => {
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
    expect(etag).toMatch(/^W\/".*-z3s"$/);
    expect((await SELF.fetch(`${G}/saver/`, { headers: { "If-None-Match": etag } })).status).toBe(304);
  });

  it("serves the script and the restore page, set up for zaisma.com", async () => {
    await addGame("saver");
    const script = await SELF.fetch(`${G}/saver/_zaisma/saves.js`);
    expect(script.headers.get("content-type")).toContain("javascript");
    const text = await script.text();
    expect(text).toContain('var __ZAISMA_SAVES__ = {"site":"https://zaisma.test"}');
    expect(text).toContain("_zaisma\\/restore");
    const restore = await SELF.fetch(`${G}/saver/_zaisma/restore`);
    expect(await restore.text()).toContain('<script src="saves.js?v=3"></script>');
    expect(restore.headers.get("content-security-policy")).toContain("frame-ancestors https://zaisma.test");
  });

  it("gives games with cloud saves off only the picture script", async () => {
    await addGame("own-saves", 0);
    const page = await (await SELF.fetch(`${G}/own-saves/`)).text();
    expect(page).not.toContain("_zaisma/saves.js");
    expect(page).toContain('<head><script src="/own-saves/_zaisma/picture.js?v=3"></script><title>');
    const script = await (await SELF.fetch(`${G}/own-saves/_zaisma/picture.js`)).text();
    expect(script).toContain('var __ZAISMA_PICTURE__ = {"site":"https://zaisma.test"}');
    expect((await SELF.fetch(`${G}/own-saves/_zaisma/saves.js`)).status).toBe(404);
    expect((await SELF.fetch(`${G}/own-saves/_zaisma/restore`)).status).toBe(404);
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
