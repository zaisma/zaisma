import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { QUICK_JOIN_KEPT_MS, auditLog, gameById, noteQuickJoin } from "@zaisma/core";
import { pageDataOf } from "../strict-scripts.ts";

const LOCAL = "http://localhost";

async function addGame(slug: string, multiplayerMode: "none" | "relay" | "own" = "none") {
  const id = `g${slug.replace(/-/g, "")}`;
  await env.DB.prepare("INSERT INTO games (id, slug, title, review_status, live_version_id, multiplayer_mode, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 'live', 'v1', ?, 0, 0)")
    .bind(id, slug, slug, multiplayerMode)
    .run();
  return id;
}

async function saveMultiplayer(id: string, gameServer: string) {
  const form = new FormData();
  form.set("game_server", gameServer);
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

  it("saves the game server and logs the change, leaving the game's own servers to its developer", async () => {
    const id = await addGame("arena");
    await env.DB.prepare(`UPDATE games SET own_server_urls = '["wss://play.example.com"]' WHERE id = ?`).bind(id).run();
    expect((await saveMultiplayer(id, "relay")).status).toBe(303);
    expect(await gameById(env.DB, id)).toMatchObject({ multiplayer_mode: "relay", own_server_urls: '["wss://play.example.com"]' });
    expect((await auditLog(env.DB, id))[0]).toMatchObject({ action: "multiplayer", actor: "dev@localhost", reason: "Game server: relay" });
  });

  it("can set a game to run its own game server in a sandbox", async () => {
    const id = await addGame("arena");
    expect((await saveMultiplayer(id, "sandbox")).status).toBe(303);
    expect((await gameById(env.DB, id))?.multiplayer_mode).toBe("own");
  });

  it("refuses unknown game servers", async () => {
    const id = await addGame("arena");
    expect(await (await saveMultiplayer(id, "my-evil-server")).text()).toContain("Pick a game server");
    expect((await gameById(env.DB, id))?.multiplayer_mode).toBe("none");
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
    expect(page).toMatch(/<div class="dropdown glass shut" id="game-menu" role="menu"/);
    expect(page).not.toContain("More games");
    // Content rules open beside the game instead of replacing it.
    expect(page).toContain('href="/legal/content-rules" target="_blank"');
  });

  it("reports from a plate beside the game, with a player reason only for multiplayer games", async () => {
    await addGame("solo");
    await addGame("arena", "relay");
    const solo = await (await SELF.fetch("https://zaisma.test/g/solo")).text();
    expect(solo).toMatch(/<dialog class="sheet glass" id="report"/);
    expect(solo).not.toContain('data-reason="player"');
    expect(solo).toContain('href="/legal/dmca" target="_blank"');
    const arena = await (await SELF.fetch("https://zaisma.test/g/arena")).text();
    expect(arena).toContain('data-reason="player"');
    // A game hands a player report to the plate, and only from its own origin.
    const config = pageDataOf(arena, "report-config");
    expect(config).toMatchObject({ slug: "arena", gameOrigin: "https://games.zaisma.test" });
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
    expect(pageDataOf(page, "game-page-data").autoplay).toBe("never");
  });

  it("drops a room link straight into the match", async () => {
    await addGame("arena", "relay");
    const page = await (await SELF.fetch("https://zaisma.test/g/arena?room=ABCDEF")).text();
    expect(pageDataOf(page, "game-page-data")).toMatchObject({ room_code: "ABCDEF", autoplay: "always" });
  });
});

describe("room browsing on the game page", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM reports; DELETE FROM audit_log; DELETE FROM live_rooms; DELETE FROM games;");
  });

  /** The rooms listed: the rows of the rooms table. */
  const rowsOf = (panel: string) => (panel.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1]?.match(/<tr>/g) ?? []).length;

  const room = (gameId: string, code: string, players: number, open = 1, at = Date.now(), where: [string, string] = ["DE", "EU"], max = 8) =>
    env.DB.prepare("INSERT INTO live_rooms (game_id, room_code, player_count, maximum_player_count, is_open, country, continent, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(gameId, code, players, max, open, where[0], where[1], at, at)
      .run();

  it("lists open rooms with how full they are and where they run, never who's in them", async () => {
    const id = await addGame("arena", "relay");
    await room(id, "BCDFGH", 3);
    await room(id, "JKMN3P", 8);
    await room(id, "QRSTVW", 2, 0);
    await room(id, "XYZ234", 5, 1, Date.now() - 3 * 3600_000);
    const page = await (await SELF.fetch("https://zaisma.test/g/arena")).text();
    expect(page).toContain('<section id="rooms">');
    // The panel counts the rooms listed, the full one too.
    expect(page).toContain('data-count="2"');
    expect(page).toMatch(/<div class="game-glance" id="playing-now"><ul class="glance"><li>[\s\S]*?<b>13<\/b> playing now/);
    expect(page).toMatch(/aria-label="Join a room with 3 of 8 players in Germany"><a class="shell cut-btn small" href="\/g\/arena\?room=BCDFGH">/);
    // A player with a code from a friend types it into the box.
    expect(page).toContain('<form class="control-row code-join" method="get" action="/g/arena">');
    // Each room shows its code, for telling a friend which room.
    expect(page).toContain('<td><code>BCDFGH</code></td>');
    // Each room is a row of the gallery's Table: the country it runs in, how full it is, then Join, or Full.
    // The country is its flag alone; its name is for screen readers and under the pointer.
    expect(page).toMatch(/<td><span class="country" title="Germany"><span class="country-flag" aria-hidden="true"><img src="\/flags\/de.png"[^>]*><\/span><span class="sr">Germany<\/span><\/span><\/td><td class="num">3 of 8<\/td>/);
    expect(page).toContain('<td class="num">8 of 8</td></tr>');
    expect(page).toContain('<td>Full</td>');
    expect(page).toContain('<td><code>JKMN3P</code></td>');
    // Closed rooms are only counted; rooms that stopped checking in aren't shown at all.
    expect(page).not.toContain("QRSTVW");
    expect(page).toContain("Plus 1 match in progress that isn&#39;t taking new players.");
    expect(page).not.toContain("XYZ234");

    const fragment = await SELF.fetch("https://zaisma.test/g/arena/rooms");
    expect(fragment.headers.get("content-type")).toContain("text/html");
    expect(await fragment.text()).toContain('data-count="2"');
  });

  it("filters by region once rooms run in more than one, and lists every open room in a table that scrolls inside its own height", async () => {
    const id = await addGame("arena", "relay");
    const codes = "BCDFGHJKLMNPQRSTVWXYZ".split("");
    for (const [i, c] of codes.slice(0, 12).entries()) await room(id, c.repeat(6), 1 + (i % 3));
    await room(id, "ABC234", 31, 1, Date.now(), ["US", "NA"], 40);
    const page = await (await SELF.fetch("https://zaisma.test/g/arena")).text();
    // Each region in the picker: its continent's globe, its name and its rooms.
    expect(page).toMatch(/data-choice-value="EU" aria-selected="false" data-cut-line="8">[\s\S]*?<span class="select-mark"><svg[\s\S]*?<\/svg><\/span><span class="select-words">Europe<\/span><span class="tag count">12<\/span>/);
    expect(page).toContain('<span class="sr">United States</span></span></td><td class="num">31 of 40</td>');
    expect(rowsOf(page)).toBe(13);
    expect(page).not.toContain("more rooms</span>");
    expect(page).toContain('data-count="13"');

    const na = await (await SELF.fetch("https://zaisma.test/g/arena/rooms?region=NA")).text();
    expect(na).toContain('data-choice-value="NA" aria-selected="true"');
    expect(na).toContain('<input type="hidden" name="region" value="NA">');
    // The tab's number follows the region picked, like the rows.
    expect(na).toContain('data-count="1"');
    expect(rowsOf(na)).toBe(1);
    const none = await (await SELF.fetch("https://zaisma.test/g/arena/rooms?region=AF")).text();
    expect(none).toContain("No open rooms in that region right now.");
  });

  it("shows who's playing now, hidden rooms included, once there are 3 or more", async () => {
    const id = await addGame("arena", "relay");
    const hidden = (code: string, players: number) =>
      env.DB.prepare("INSERT INTO live_rooms (game_id, room_code, player_count, maximum_player_count, is_listed, is_open, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 8, 0, 1, ?, ?)").bind(id, code, players, Date.now(), Date.now()).run();
    await hidden("BCDFGH", 2);
    const few = await (await SELF.fetch("https://zaisma.test/g/arena")).text();
    expect(few).toMatch(/id="playing-now" hidden><ul class="glance"><li>[\s\S]*?<b>2<\/b> playing now/);
    await hidden("CDFGHJ", 3);
    const page = await (await SELF.fetch("https://zaisma.test/g/arena")).text();
    expect(page).toMatch(/id="playing-now"><ul class="glance"><li>[\s\S]*?<b>5<\/b> playing now/);
    // Hidden rooms are counted, never listed.
    expect(page).not.toContain("?room=BCDFGH");
    // A game that lists no rooms on its page still says who's playing, without a link.
    await env.DB.prepare("UPDATE games SET room_browsing = 'off' WHERE id = ?").bind(id).run();
    const unlisted = await (await SELF.fetch("https://zaisma.test/g/arena")).text();
    expect(unlisted).toMatch(/id="playing-now"><ul class="glance"><li>[\s\S]*?<b>5<\/b> playing now/);
    expect(unlisted).not.toContain('<section id="rooms">');
    // Single-player games have the line too, from the browsers playing them (plays.test.ts); hidden with nobody playing.
    await addGame("solo");
    expect(await (await SELF.fetch("https://zaisma.test/g/solo")).text()).toMatch(/id="playing-now" hidden><ul class="glance"><li>[\s\S]*?<b>0<\/b> playing now/);
  });

  it("shows names and labels that pass the text filter, with a Report button, and filters by labels", async () => {
    const id = await addGame("arena", "relay");
    const named = (code: string, name: string | null, labels: Record<string, string>) =>
      env.DB.prepare("INSERT INTO live_rooms (game_id, room_code, player_count, maximum_player_count, is_open, name, labels, created_at_ms, updated_at_ms) VALUES (?, ?, 2, 8, 1, ?, ?, ?, ?)")
        .bind(id, code, name, JSON.stringify(labels), Date.now(), Date.now())
        .run();
    await named("BCDFGH", "Ana's castle", { Mode: "Classic", Map: "Docks" });
    await named("CDFGHJ", "add me on snap coolkid", { Mode: "Hardcore" });
    await named("DFGHJK", null, { Mode: "Classic" });
    const page = await (await SELF.fetch("https://zaisma.test/g/arena")).text();
    // A column for the name and one for each label, in the order rooms carry them.
    expect(page).toMatch(/<thead><tr><th><span aria-hidden="true">Code<\/span><\/th><th><span aria-hidden="true">Room<\/span><\/th><th><span aria-hidden="true">Mode<\/span><\/th><th><span aria-hidden="true">Map<\/span><\/th><th class="num" aria-sort="none"><button type="button" class="table-sort">Players/);
    expect(page).toContain('<td><code>BCDFGH</code></td><td>Ana&#39;s castle</td><td>Classic</td><td>Docks</td><td class="num">2 of 8</td>');
    expect(page).toContain('data-report-room="BCDFGH" data-room-name="Ana&#39;s castle, Classic, Docks"');
    // A name that fails the filter isn't shown; its labels still are.
    expect(page).not.toContain("coolkid");
    expect(page).toContain('<td><code>CDFGHJ</code></td><td></td><td>Hardcore</td><td></td><td class="num">2 of 8</td>');
    const modeFilter = page.match(/<div class="rooms-filter" data-label-filter="Mode">[\s\S]*?<input type="hidden"[^>]*>/)![0];
    expect([...modeFilter.matchAll(/data-choice-value="([^"]*)"/g)].map((choice) => choice[1])).toEqual(["", "Classic", "Hardcore"]);
    const classic = await (await SELF.fetch(`https://zaisma.test/g/arena/rooms?labels=${encodeURIComponent(JSON.stringify({ Mode: "Classic" }))}`)).text();
    expect(rowsOf(classic)).toBe(2);
    expect(classic).toContain('data-choice-value="Classic" aria-selected="true"');
  });

  it("reports a room's name with the name as it was, without pausing the game, and a person can hide it", async () => {
    const id = await addGame("arena", "relay");
    await env.DB.exec("DELETE FROM reports;");
    await env.DB.prepare("INSERT INTO live_rooms (game_id, room_code, player_count, maximum_player_count, is_open, name, labels, created_at_ms, updated_at_ms) VALUES (?, 'BCDFGH', 2, 8, 1, 'Bad name', '{\"Mode\":\"Classic\"}', ?, ?)")
      .bind(id, Date.now(), Date.now())
      .run();
    const res = await SELF.fetch("https://zaisma.test/g/arena/report", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://zaisma.test", "cf-connecting-ip": "192.0.2.77" },
      body: JSON.stringify({ reason: "child_safety", room: "BCDFGH", about: "room", details: "the room name" }),
    });
    expect(await res.json()).toMatchObject({ is_game_hidden: false, is_update_paused: false });
    expect((await gameById(env.DB, id))?.review_status).toBe("live");
    const report = await env.DB.prepare("SELECT id, room_code, room_name FROM reports WHERE game_id = ?").bind(id).first<{ id: string; room_code: string; room_name: string }>();
    expect(report).toMatchObject({ room_code: "BCDFGH", room_name: "Bad name (Mode: Classic)" });

    const queue = await (await SELF.fetch("http://localhost/admin/reports")).text();
    expect(queue).toContain("Hide the room&#39;s name");
    const form = new FormData();
    form.set("reason", "Name broke the rules");
    await SELF.fetch(`http://localhost/admin/report-groups/${report!.id}/hide-name`, { method: "POST", body: form, redirect: "manual" });
    expect(await env.DB.prepare("SELECT is_name_hidden FROM live_rooms WHERE room_code = 'BCDFGH'").first("is_name_hidden")).toBe(1);
    expect(await env.DB.prepare("SELECT report_status FROM reports WHERE id = ?").bind(report!.id).first("report_status")).toBe("actioned");
    expect(await (await SELF.fetch("https://zaisma.test/g/arena")).text()).not.toContain("Bad name");
  });

  it("pages through every open room, a page from the server at a time", async () => {
    const id = await addGame("arena", "relay");
    const codes = "BCDFGHJKLMNPQRSTVWXYZ".split("");
    for (let i = 0; i < 52; i++) await room(id, `${codes[i % codes.length]!.repeat(4)}${codes[Math.floor(i / codes.length)]}2`, 1);
    const first = await (await SELF.fetch("https://zaisma.test/g/arena/rooms")).text();
    expect(first).toContain('data-first-row-number="1" data-total-row-count="52"');
    expect(rowsOf(first)).toBe(50);
    const second = await (await SELF.fetch("https://zaisma.test/g/arena/rooms?page=2")).text();
    expect(second).toContain('data-first-row-number="51" data-total-row-count="52"');
    expect(rowsOf(second)).toBe(2);
  });

  it("says Play finds you a room only for a game that joins players by itself", async () => {
    const id = await addGame("arena", "relay");
    await room(id, "BCDFGH", 1);
    const hint = async () => (await (await SELF.fetch("https://zaisma.test/g/arena/rooms")).text()).includes("Or press Play and the game finds you one.");
    expect(await hint()).toBe(false);
    await noteQuickJoin(env.DB, id);
    expect(await hint()).toBe(true);
    // A quick join more than 30 days ago no longer counts.
    await env.DB.prepare("UPDATE games SET quick_joined_at_ms = ? WHERE id = ?").bind(Date.now() - QUICK_JOIN_KEPT_MS - 1, id).run();
    expect(await hint()).toBe(false);
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
      expect(await (await SELF.fetch("https://zaisma.test/g/lobby")).text()).not.toContain('<section id="rooms">');
      expect((await SELF.fetch("https://zaisma.test/g/lobby/rooms")).status).toBe(404);
    }
    await addGame("solo");
    expect(await (await SELF.fetch("https://zaisma.test/g/solo")).text()).not.toContain('<section id="rooms">');
  });
});
