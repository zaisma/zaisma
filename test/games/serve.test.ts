import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { blobKey, manifestKey, sha256Hex } from "@zaisma/core";
import { resolveGame } from "../../apps/games/src/index.ts";

const G = "https://games.example";

async function addGame(slug: string, status: string, withVersion = true) {
  const id = `g${slug.replace(/-/g, "")}`;
  const versionId = `v${id}`;
  const prefix = `games/${id}/${versionId}`;
  await env.DB.prepare("INSERT INTO games (id, slug, title, status, current_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0)")
    .bind(id, slug, slug, status, withVersion ? versionId : null)
    .run();
  if (withVersion) {
    await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, bytes, scan_status, created_at) VALUES (?, ?, ?, 2, 0, 'approved', 0)").bind(versionId, id, prefix).run();
    await env.GAMES.put(`${prefix}/index.html`, "<!doctype html><p>game</p>");
    await env.GAMES.put(`${prefix}/sfx/beep.mp3`, new Uint8Array(1000).fill(7));
  }
  return id;
}

describe("game server", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM versions; DELETE FROM domains; DELETE FROM games;");
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
    expect(res.headers.get("permissions-policy")).toContain("camera=()");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("content-type")).toContain("text/html");
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
    await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, bytes, scan_status, kind, created_at) VALUES ('vhop2', ?, 'manifests/vhop2', 2, 0, 'approved', 'files', 0)").bind(id).run();
    await env.DB.prepare("UPDATE games SET current_version_id = 'vhop2' WHERE id = ?").bind(id).run();
    expect(await (await SELF.fetch(`${G}/hop/`)).text()).toContain("hop v2");
    expect(await (await SELF.fetch(`${G}/hop/js/game.js`)).text()).toBe("let x = 2;");
    expect((await SELF.fetch(`${G}/hop/js/other.js`)).status).toBe(404);
  });

  it("opens a draft only through its preview link", async () => {
    const id = await addGame("drafty", "pending", false);
    await env.DB.prepare("UPDATE games SET visibility = 'draft' WHERE id = ?").bind(id).run();
    await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, bytes, scan_status, preview_token, created_at) VALUES ('vd', ?, 'games/d/vd', 1, 0, 'approved', 'abcdefghij0123456789', 0)").bind(id).run();
    await env.GAMES.put("games/d/vd/index.html", "<!doctype html><p>draft</p>");
    expect((await SELF.fetch(`${G}/drafty/`)).status).toBe(404);
    const res = await SELF.fetch(`${G}/drafty--abcdefghij0123456789/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<p>draft</p>");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect((await SELF.fetch(`${G}/drafty--abcdefghij0123456780/`)).status).toBe(404);
    // A takedown closes previews too.
    await env.DB.prepare("UPDATE games SET status = 'removed' WHERE id = ?").bind(id).run();
    expect((await SELF.fetch(`${G}/drafty--abcdefghij0123456789/`)).status).toBe(410);
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
