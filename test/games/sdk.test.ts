import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { checkOwnServerUrls, connectSources } from "@zaisma/core";

const G = "https://games.example";

async function addGame(slug: string, ownServerUrls: string[] = []) {
  const id = `g${slug.replace(/-/g, "")}`;
  await env.DB.prepare("INSERT INTO games (id, slug, title, review_status, live_version_id, multiplayer_mode, own_server_urls, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 'live', ?, 'relay', ?, 0, 0)")
    .bind(id, slug, slug, `v${id}`, JSON.stringify(ownServerUrls))
    .run();
  await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES (?, ?, ?, 1, 0, 'approved', 0)").bind(`v${id}`, id, `games/${id}`).run();
  await env.GAMES.put(`games/${id}/index.html`, "<!doctype html><p>game</p>");
}

describe("multiplayer on the game domain", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM versions; DELETE FROM games;");
  });

  it("lets games connect to Zaisma rooms and their own servers, nothing else", async () => {
    await addGame("arena", ["wss://play.example.com"]);
    const csp = (await SELF.fetch(`${G}/arena/`)).headers.get("content-security-policy")!;
    const connect = csp.split("; ").find((d) => d.startsWith("connect-src"))!;
    expect(connect).toBe("connect-src 'self' data: blob: https://rooms.zaisma.test wss://rooms.zaisma.test https://play.example.com wss://play.example.com");
  });

  it("serves the SDK from the game's own site, set up for that game", async () => {
    await addGame("arena");
    const res = await SELF.fetch(`${G}/arena/_zaisma/v1.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    const body = await res.text();
    // It names the version it was served with, so it's checked on every load.
    expect(body).toContain('var __ZAISMA__ = {"rooms":"https://rooms.zaisma.test","game":"arena","site":"https://zaisma.test","version":"vgarena"}');
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(body).toContain("window.Zaisma");
  });

  it("serves the relay script set up for the game: its own relay hosts, and early credentials when it plays online", async () => {
    await addGame("arena", ["wss://play.example.com", "https://turn.example.com:5349"]);
    const res = await SELF.fetch(`${G}/arena/_zaisma/relay.js`);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(await res.text()).toContain('var __ZAISMA_RELAY__ = {"rooms":"https://rooms.zaisma.test","game":"arena","site":"https://zaisma.test","ownRelayHosts":["play.example.com","turn.example.com"],"fetchEarly":true};');
    // Every page gets it before anything else, and frames only of the game's own pages, which carry it too.
    const page = await SELF.fetch(`${G}/arena/`);
    expect(await page.text()).toMatch(/^<!doctype html><script src="\/arena\/_zaisma\/relay\.js\?v=\d+"><\/script>/);
    expect(page.headers.get("content-security-policy")).toContain("frame-src 'self'");
  });

  it("serves the SDK's types beside it", async () => {
    await addGame("arena");
    const res = await SELF.fetch(`${G}/arena/_zaisma/v1.d.ts`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toContain("declare namespace Zaisma");
  });

  it("only accepts plain server origins as a game's own servers", () => {
    expect(checkOwnServerUrls(["wss://a.example.com", " https://b.example.com:8443/ "])).toEqual({ ownServerUrls: ["wss://a.example.com", "https://b.example.com:8443"] });
    for (const bad of ["http://a.example.com", "wss://a.example.com/path", "javascript:alert(1)", "wss://a.example.com; script-src *", "wss://a.example.com?x=1"]) {
      expect(checkOwnServerUrls([bad])).toMatchObject({ problem: { field: "own_server_urls" } });
    }
    expect(checkOwnServerUrls(Array.from({ length: 6 }, (_, i) => `wss://s${i}.example.com`))).toMatchObject({ problem: { field: "own_server_urls" } });
    expect(connectSources("http://localhost:8789", [])).toEqual(["http://localhost:8789", "ws://localhost:8789"]);
  });
});
