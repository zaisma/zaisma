import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { auditLog, gameById } from "@zaisma/core";

const LOCAL = "http://localhost";

async function addGame(slug: string, gameServer: string | null = null) {
  const id = `g${slug.replace(/-/g, "")}`;
  await env.DB.prepare("INSERT INTO games (id, slug, title, status, current_version_id, game_server, created_at, updated_at) VALUES (?, ?, ?, 'live', 'v1', ?, 0, 0)")
    .bind(id, slug, slug, gameServer)
    .run();
  return id;
}

async function saveMultiplayer(id: string, gameServer: string, connectHosts: string) {
  const form = new FormData();
  form.set("game_server", gameServer);
  form.set("connect_hosts", connectHosts);
  return SELF.fetch(`${LOCAL}/admin/games/${id}/multiplayer`, { method: "POST", body: form, redirect: "manual" });
}

describe("multiplayer on the site", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM audit_log; DELETE FROM games;");
  });

  it("passes a room link's code to the game, and only a valid one", async () => {
    await addGame("arena", "relay");
    const page = await (await SELF.fetch("https://zaisma.test/g/arena?room=abcdef")).text();
    expect(page).toContain('src="https://games.zaisma.test/arena/?room=ABCDEF"');
    expect(page).toContain(">Invite<");
    const bad = await (await SELF.fetch('https://zaisma.test/g/arena?room="><script>')).text();
    expect(bad).toContain('src="https://games.zaisma.test/arena/"');
  });

  it("marks multiplayer games in the directory", async () => {
    await addGame("arena", "relay");
    await addGame("solo");
    const home = await (await SELF.fetch("https://zaisma.test/")).text();
    expect(home.match(/Multiplayer/g)).toHaveLength(1);
  });

  it("saves the game server and own servers, lists them and logs the change", async () => {
    const id = await addGame("arena");
    expect((await saveMultiplayer(id, "relay", "wss://play.example.com/")).status).toBe(303);
    const game = await gameById(env.DB, id);
    expect(game).toMatchObject({ game_server: "relay", connect_hosts: "wss://play.example.com" });
    expect((await auditLog(env.DB, id))[0]).toMatchObject({ action: "multiplayer", actor: "dev@localhost" });
    expect(await (await SELF.fetch("https://zaisma.test/g/arena")).text()).toContain("Connects to play.example.com");
  });

  it("refuses unknown game servers and bad server addresses", async () => {
    const id = await addGame("arena");
    expect(await (await saveMultiplayer(id, "my-evil-server", "")).text()).toContain("Pick a game server");
    expect(await (await saveMultiplayer(id, "", "http://insecure.example")).text()).toContain("a server address like wss://play.example.com");
    expect((await gameById(env.DB, id))?.game_server).toBeNull();
  });
});

describe("game page controls", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM games;");
  });

  it("lists other live games beside the game, not this one or hidden ones", async () => {
    await addGame("arena", "relay");
    await addGame("solo");
    await env.DB.prepare("INSERT INTO games (id, slug, title, status, current_version_id, created_at, updated_at) VALUES ('gheld', 'held-game', 'Held Game', 'held', 'v1', 0, 0)").run();
    const page = await (await SELF.fetch("https://zaisma.test/g/arena")).text();
    const panel = page.slice(page.indexOf('<aside class="more"'), page.indexOf("</aside>"));
    expect(panel).toContain('href="/g/solo"');
    expect(panel).not.toContain('href="/g/arena"');
    expect(panel).not.toContain("held-game");
    expect(page).toContain("Report");
  });
});
