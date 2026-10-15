import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { connectSources, parseConnectHosts } from "@zaisma/core";

const G = "https://games.example";

async function addGame(slug: string, connectHosts = "") {
  const id = `g${slug.replace(/-/g, "")}`;
  await env.DB.prepare("INSERT INTO games (id, slug, title, review_status, live_version_id, multiplayer_mode, connect_hosts, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 'live', ?, 'relay', ?, 0, 0)")
    .bind(id, slug, slug, `v${id}`, connectHosts)
    .run();
  await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES (?, ?, ?, 1, 0, 'approved', 0)").bind(`v${id}`, id, `games/${id}`).run();
  await env.GAMES.put(`games/${id}/index.html`, "<!doctype html><p>game</p>");
}

describe("multiplayer on the game domain", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM versions; DELETE FROM games;");
  });

  it("lets games connect to Zaisma rooms and their own listed servers, nothing else", async () => {
    await addGame("arena", "wss://play.example.com");
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
    expect(body).toContain('var __ZAISMA__ = {"rooms":"https://rooms.zaisma.test","game":"arena","site":"https://zaisma.test"}');
    expect(body).toContain("window.Zaisma");
  });

  it("only accepts plain server origins as a game's own servers", () => {
    expect(parseConnectHosts("wss://a.example\nhttps://b.example:8443/\n")).toEqual(["wss://a.example", "https://b.example:8443"]);
    expect(() => parseConnectHosts("http://a.example")).toThrow();
    expect(() => parseConnectHosts("wss://a.example/path")).toThrow();
    expect(() => parseConnectHosts("javascript:alert(1)")).toThrow();
    expect(() => parseConnectHosts("wss://a.example; script-src *")).toThrow();
    expect(() => parseConnectHosts(Array(6).fill("wss://a.example").join("\n"))).toThrow();
    expect(connectSources("http://localhost:8789", "")).toEqual(["http://localhost:8789", "ws://localhost:8789"]);
  });
});
