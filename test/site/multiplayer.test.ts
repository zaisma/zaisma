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
    expect(page).toContain('<dialog id="menu-dialog" class="quick plate"');
    expect(page).not.toContain("More games");
    // Content rules open beside the game instead of replacing it.
    expect(page).toContain('href="/legal/content-rules" target="_blank"');
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

describe("room browsing on the game page", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM open_rooms; DELETE FROM games;");
  });

  const room = (gameId: string, code: string, players: number, open = 1, at = Date.now(), where: [string, string] = ["DE", "EU"], max = 8) =>
    env.DB.prepare("INSERT INTO open_rooms (game_id, code, players, max_players, open, country, continent, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(gameId, code, players, max, open, where[0], where[1], at, at)
      .run();

  it("lists open rooms with how full they are and where they run, never who's in them", async () => {
    const id = await addGame("arena", "relay");
    await room(id, "BCDFGH", 3);
    await room(id, "JKLMNP", 8);
    await room(id, "QRSTVW", 2, 0);
    await room(id, "XYZ234", 5, 1, Date.now() - 3 * 3600_000);
    const page = await (await SELF.fetch("https://zaisma.test/g/arena")).text();
    expect(page).toContain('aria-controls="rooms"');
    expect(page).toContain('id="rooms-count">1</span>');
    expect(page).toContain("13 players on now");
    expect(page).toContain('<a class="btn" href="/g/arena?room=BCDFGH" aria-label="Join room BCDFGH">Join</a>');
    expect(page).toContain("3 of 8 players");
    expect(page).toContain('<img class="flag" src="/flags/de.png" alt="" width="20" height="15" loading="lazy"><abbr title="Germany">DE</abbr>');
    expect(page).toMatch(/JKLMNP[\s\S]*?<span class="full">Full<\/span>/);
    // Closed rooms are only counted; rooms that stopped checking in aren't shown at all.
    expect(page).not.toContain("QRSTVW");
    expect(page).toContain("Plus 1 match in progress that isn&#39;t taking new players.");
    expect(page).not.toContain("XYZ234");

    const fragment = await SELF.fetch("https://zaisma.test/g/arena/rooms");
    expect(fragment.headers.get("content-type")).toContain("text/html");
    expect(await fragment.text()).toContain('data-joinable="1"');
  });

  it("filters by region once rooms run in more than one, shows big rooms as a gauge, and the best ten first", async () => {
    const id = await addGame("arena", "relay");
    const codes = "BCDFGHJKLMNPQRSTVWXYZ".split("");
    for (const [i, c] of codes.slice(0, 12).entries()) await room(id, c.repeat(6), 1 + (i % 3));
    await room(id, "ABC234", 31, 1, Date.now(), ["US", "NA"], 40);
    const page = await (await SELF.fetch("https://zaisma.test/g/arena")).text();
    expect(page).toContain('<button type="button" data-region="EU" title="Europe" aria-pressed="false">EU<small>12</small></button>');
    expect(page).toContain('<span class="gauge" aria-hidden="true"><i style="width:78%"></i></span><span>31 of 40 players</span>');
    expect(page.match(/class="room plate later"/g)).toHaveLength(3);
    expect(page).toContain("Show 3 more rooms");
    expect(page).toContain('id="rooms-count">13</span>');

    const na = await (await SELF.fetch("https://zaisma.test/g/arena/rooms?region=NA")).text();
    expect(na).toContain('data-region="NA" title="North America" aria-pressed="true"');
    expect(na.match(/class="room plate/g)).toHaveLength(1);
    const none = await (await SELF.fetch("https://zaisma.test/g/arena/rooms?region=AF")).text();
    expect(none).toContain("No open rooms in that region right now.");
  });

  it("says when there's no room to join", async () => {
    await addGame("arena", "relay");
    expect(await (await SELF.fetch("https://zaisma.test/g/arena")).text()).toContain("Nobody&#39;s in an open room right now. Press Play to start.");
  });

  it("leaves rooms off the page for games that list them only in the game, or not at all, and for games without our rooms", async () => {
    const id = await addGame("lobby", "relay");
    await room(id, "BCDFGH", 3);
    for (const browsing of ["game", "off"]) {
      await env.DB.prepare("UPDATE games SET room_browsing = ? WHERE id = ?").bind(browsing, id).run();
      expect(await (await SELF.fetch("https://zaisma.test/g/lobby")).text()).not.toContain('aria-controls="rooms"');
      expect((await SELF.fetch("https://zaisma.test/g/lobby/rooms")).status).toBe(404);
    }
    await addGame("solo");
    expect(await (await SELF.fetch("https://zaisma.test/g/solo")).text()).not.toContain('aria-controls="rooms"');
  });
});
