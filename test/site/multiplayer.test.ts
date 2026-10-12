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
    expect(page).toContain("Share the link while you");
    const bad = await (await SELF.fetch('https://zaisma.test/g/arena?room="><script>')).text();
    expect(bad).toContain('src="https://games.zaisma.test/arena/"');
  });

  it("marks games on our servers as online multiplayer until the developer says more", async () => {
    await addGame("arena", "relay");
    await addGame("solo");
    expect(await (await SELF.fetch("https://zaisma.test/g/arena")).text()).toContain("Online multiplayer");
    expect(await (await SELF.fetch("https://zaisma.test/g/solo")).text()).not.toContain("Online multiplayer");
  });

  it("saves the game server and own servers, lists them and logs the change", async () => {
    const id = await addGame("arena");
    expect((await saveMultiplayer(id, "relay", "wss://play.example.com/")).status).toBe(303);
    const game = await gameById(env.DB, id);
    expect(game).toMatchObject({ game_server: "relay", connect_hosts: "wss://play.example.com" });
    expect((await auditLog(env.DB, id))[0]).toMatchObject({ action: "multiplayer", actor: "dev@localhost" });
    expect(await (await SELF.fetch("https://zaisma.test/g/arena")).text()).toContain("connects to its own servers: play.example.com");
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

  it("offers Share, Full screen and a menu with Report, and nothing over the game by default", async () => {
    await addGame("solo");
    const page = await (await SELF.fetch("https://zaisma.test/g/solo")).text();
    expect(page).toContain('id="share"');
    expect(page).toContain('id="full"');
    expect(page).toContain('href="/g/solo/report" data-report');
    expect(page).toContain('<dialog id="menu-dialog"');
    expect(page).not.toContain("More games");
  });

  it("reports from a plate beside the game, with a player reason only for multiplayer games", async () => {
    await addGame("solo");
    await addGame("arena", "relay");
    const solo = await (await SELF.fetch("https://zaisma.test/g/solo")).text();
    expect(solo).toContain('<dialog id="report" class="sheet"');
    expect(solo).not.toContain('data-reason="player"');
    expect(solo).toContain('href="/legal/dmca" target="_blank"');
    const arena = await (await SELF.fetch("https://zaisma.test/g/arena")).text();
    expect(arena).toContain('data-reason="player"');
    // A game hands a player report to the plate, and only from its own origin.
    expect(arena).toContain('"gameOrigin":"https://games.zaisma.test"');
  });
});

describe("game details", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM games;");
  });

  it("shows details with a Play button and loads the game only on Play", async () => {
    await addGame("solo");
    const page = await (await SELF.fetch("https://zaisma.test/g/solo")).text();
    expect(page).toContain('id="play"');
    expect(page).toContain('<template id="game-frame"><iframe');
    expect(page).not.toMatch(/<\/template>[\s\S]*<iframe/);
    expect(page).not.toContain("\nplay();");
  });

  it("drops a room link straight into the match", async () => {
    await addGame("arena", "relay");
    const page = await (await SELF.fetch("https://zaisma.test/g/arena?room=ABCDEF")).text();
    expect(page).toContain("\nplay();");
  });
});
