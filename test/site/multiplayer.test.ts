import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { auditLog, gameById, hasSpace, listRoomPage, listRooms, type Game } from "@zaisma/core";
import { codeBox } from "../../apps/site/src/rooms.ts";
import { dailyCleanup } from "../../apps/site/src/cleanup.ts";
import { pageDataOf } from "../strict-scripts.ts";
import { reportSheet } from "../../apps/site/src/report.ts";
import { pageProblems } from "./page-rules.ts";

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
    // Watch beside Join passes watch=1 on, for Zaisma.rooms.isLinkedAsSpectator; only beside a room, and only as 1.
    expect(await (await SELF.fetch("https://zaisma.test/g/arena?room=ABCDEF&watch=1")).text()).toContain('src="https://games.zaisma.test/arena/?room=ABCDEF&amp;watch=1"');
    expect(await (await SELF.fetch("https://zaisma.test/g/arena?room=ABCDEF&watch=yes")).text()).toContain('src="https://games.zaisma.test/arena/?room=ABCDEF"');
    expect(await (await SELF.fetch("https://zaisma.test/g/arena?watch=1")).text()).not.toContain("watch=1");
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
    expect(page).toMatch(/href="\/g\/solo\/report"[^>]*data-report/);
    expect(page).toContain('<div class="floating-pane placed-under dropdown glass" id="menu-dialog" role="menu"');
    // The ⋯ button opens it, and Report this game is one of its choices.
    expect(page).toMatch(/id="menu"[^>]*aria-controls="menu-dialog" aria-expanded="false"/);
    expect(page.match(/<div class="floating-pane placed-under dropdown glass" id="menu-dialog"[\s\S]*?All games/)![0]).toContain('href="/g/solo/report"');
    expect(page).not.toContain("More games");
    // Content rules open beside the game instead of replacing it.
    expect(page).toContain('href="/legal/content-rules" target="_blank"');
  });

  it("reports from a sheet over the game, with a player reason only for multiplayer games", async () => {
    await addGame("solo");
    await addGame("arena", "relay");
    const solo = await (await SELF.fetch("https://zaisma.test/g/solo")).text();
    expect(solo).toContain('<dialog class="sheet glass" id="report" aria-labelledby="report-title"');
    expect(solo).not.toContain('id="report-reason-game-player"');
    expect(solo).toContain('href="/legal/dmca" target="_blank" rel="noopener"');
    const arena = await (await SELF.fetch("https://zaisma.test/g/arena")).text();
    expect(arena).toContain('id="report-reason-game-player" value="player"');
    // A game hands a player report to the sheet, and only from its own origin.
    expect(pageDataOf(arena, "report-data")).toMatchObject({ slug: "arena", gameOrigin: "https://games.zaisma.test" });
  });

  it("builds the report sheet from gallery components alone", () => {
    for (const isMultiplayer of [false, true]) {
      const markup = String(reportSheet({ slug: "arena", title: "Arena" } as Game, { isMultiplayer, gameOrigin: "https://games.zaisma.test" }));
      expect(pageProblems(markup)).toEqual([]);
      // What the sheet's script finds it by.
      for (const id of ["report-title", "report-sub", "report-reasons-game", "report-reasons-player", "report-details", "report-pic", "report-pic-img", "report-picture", "report-hold", "report-context", "report-error", "report-notices", "report-tell", "report-sent", "report-done", "report-send", "report-data"]) expect(markup).toContain(`id="${id}"`);
    }
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
    // The buy sheet's Stripe frames have no source until a buy needs one; no other frame is on the page before Play.
    expect(page.replace(/<template id="game-frame">[\s\S]*?<\/template>/, "").replace(/<iframe class="stripe-frame"[^>]*><\/iframe>/g, "")).not.toMatch(/<iframe/);
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

  const room = (gameId: string, code: string, players: number, open = 1, at = Date.now(), where: [string, string] = ["DE", "EU"], max = 8) =>
    env.DB.prepare("INSERT INTO live_rooms (game_id, room_code, player_count, maximum_player_count, is_open, country, continent, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(gameId, code, players, max, open, where[0], where[1], at, at)
      .run();
  /** The Rooms section's list on its own, as the page's script refreshes it into #rooms-list. */
  const roomsList = async (query = "") => (await SELF.fetch(`https://zaisma.test/g/arena/rooms${query}`)).text();

  it("lists open rooms with how full they are and where they run, never who's in them", async () => {
    const id = await addGame("arena", "relay");
    await room(id, "BCDFGH", 3);
    await room(id, "JKMN3P", 8);
    await room(id, "QRSTVW", 2, 0);
    await room(id, "XYZ234", 5, 1, Date.now() - 3 * 3600_000);
    const page = await (await SELF.fetch("https://zaisma.test/g/arena")).text();
    expect(page).toContain('id="rooms-list"');
    // Codes stay in the links; a player with a code types it into the box.
    expect(page).toContain('<form method="get" action="/g/arena">');
    expect(page).toContain('id="room-code" name="room" type="text" placeholder="ABC234" autocomplete="off" pattern="[2-9A-HJ-NP-Z]{6}" data-characters="[2-9A-HJ-NP-Z]" maxlength="6" data-uppercase autocapitalize="characters" required');
    expect(page).not.toContain(">BCDFGH<");

    const fragment = await SELF.fetch("https://zaisma.test/g/arena/rooms");
    expect(fragment.headers.get("content-type")).toContain("text/html");
    const list = await fragment.text();
    // The number by Rooms counts the rooms listed, the full one too; playing now counts everyone in them.
    expect(list).toContain('data-count="2"');
    expect(list).toContain('data-playing="13"');
    expect(list).toContain('<a class="shell cut-btn small" href="/g/arena?room=BCDFGH">');
    expect(list).toMatch(/<span class="list-row-title">3 of 8 players<\/span><span class="list-row-detail"><span class="list-row-fact">Germany<\/span>/);
    expect(list).toMatch(/8 of 8 players<\/span>[\s\S]*?<span class="list-row-end">Full<\/span>/);
    expect(list).not.toContain("JKMN3P");
    // A match in progress is a row of its own, last: Join grayed and off with its reason, and no sentence about it. Rooms that stopped checking in aren't shown at all.
    expect(list).toMatch(/2 of 8 players<\/span>[\s\S]*?<span class="list-row-end">In a match<\/span><span class="list-row-action"><button class="shell cut-btn small" type="button" disabled>/);
    expect(list.indexOf("In a match")).toBeGreaterThan(list.indexOf(">Full<"));
    expect(list).not.toContain("room=QRSTVW");
    expect(list).not.toContain("in progress that");
    expect(list).not.toContain("XYZ234");
    // Glass: only gallery components, the list and the code box alike.
    expect(pageProblems(list)).toEqual([]);
    expect(pageProblems(String(codeBox("arena")))).toEqual([]);
  });

  it("shows how many watch, and Watch beside Join or Full for rooms that take spectators", async () => {
    const id = await addGame("arena", "own");
    await room(id, "BCDFGH", 3);
    await room(id, "JKMN3P", 8);
    await room(id, "QRSTVW", 2);
    const watching = (code: string, spectatorCount: number, maximumSpectatorCount: number) =>
      env.DB.prepare("UPDATE live_rooms SET spectator_count = ?, maximum_spectator_count = ? WHERE room_code = ?").bind(spectatorCount, maximumSpectatorCount, code).run();
    await watching("BCDFGH", 14, 20);
    await watching("JKMN3P", 2, 20);
    await watching("QRSTVW", 5, 5);
    // A match in progress isn't taking players, but can be watched.
    await room(id, "CDFGHJ", 2, 0);
    await watching("CDFGHJ", 1, 20);
    const list = await roomsList();
    expect(list).toMatch(/<span class="list-row-end">In a match<\/span><span class="list-row-action"><div[^>]*><div[^>]*><button class="shell cut-btn small" type="button" disabled>[\s\S]*?<a class="shell cut-btn small" href="\/g\/arena\?room=CDFGHJ&amp;watch=1">/);
    expect(list).toContain('<span class="list-row-title">3 of 8 players</span><span class="list-row-detail"><span class="list-row-fact">14\u00a0watching\u00a0·</span>');
    expect(list).toContain('href="/g/arena?room=BCDFGH&amp;watch=1"');
    // A full room can still be watched.
    expect(list).toMatch(/<span class="list-row-end">Full<\/span><span class="list-row-action"><a class="shell cut-btn small" href="\/g\/arena\?room=JKMN3P&amp;watch=1">/);
    // One whose audience is full shows how many watch, and no Watch.
    expect(list).toContain("5\u00a0watching");
    expect(list).not.toContain("room=QRSTVW&amp;watch=1");
    expect(pageProblems(list)).toEqual([]);
    // A game that doesn't take spectators shows neither.
    await env.DB.exec("UPDATE live_rooms SET spectator_count = 0, maximum_spectator_count = 0");
    const quiet = await roomsList();
    expect(quiet).not.toContain("watching");
    expect(quiet).not.toContain("<span>Watch</span>");
  });

  it("filters by region once rooms run in more than one, and shows the first six rooms", async () => {
    const id = await addGame("arena", "relay");
    const codes = "BCDFGHJKLMNPQRSTVWXYZ".split("");
    for (const [i, c] of codes.slice(0, 12).entries()) await room(id, c.repeat(6), 1 + (i % 3));
    await room(id, "ABC234", 31, 1, Date.now(), ["US", "NA"], 40);
    const list = await roomsList();
    expect(list).toContain('<button type="button" class="flush-row quiet" data-lights data-region="EU" aria-pressed="false"><span>Europe</span><span class="tag count">12</span></button>');
    expect(list).toContain('<span class="list-row-title">31 of 40 players</span>');
    // Only the first six rooms, the list scrolling inside itself past them, and Load more for the rest.
    expect(list).toContain('class="list-rows hairlines is-capped scrolls own-scroll" style="--shown-row-count:6"');
    expect(list.match(/<div class="list-row flush-row quiet">/g)).toHaveLength(6);
    expect(list).not.toContain("<li hidden>");
    expect(list).toContain('data-load-more="rooms-rows"');
    expect(list).toContain('href="/g/arena/rooms?cursor=6"');
    expect(list).toContain('data-count="13"');
    expect(pageProblems(list)).toEqual([]);

    const na = await roomsList("?region=NA");
    expect(na).toContain('<button type="button" class="flush-row quiet" data-lights data-region="NA" aria-pressed="true"><span>North America</span>');
    // The number by Rooms follows the region picked, like the rows.
    expect(na).toContain('data-count="1"');
    expect(na.match(/<div class="list-row flush-row quiet">/g)).toHaveLength(1);
    // Nothing more to load: no Load more.
    expect(na).not.toContain("data-load-more");
    const none = await roomsList("?region=AF");
    expect(none).toContain("No open rooms in that region right now.");
  });

  it("pages the rooms: six first, then twenty a press, best first with matches in progress last, never all at once", async () => {
    const id = await addGame("arena", "relay");
    const alphabet = "BCDFGHJKLMNPQRSTVWXYZ23456789".split("");
    const code = (index: number) => `${alphabet[Math.floor(index / alphabet.length)]}${alphabet[index % alphabet.length]}${"AAAA"}`;
    // 37 open rooms, the busiest first by their players, 3 full ones and 5 matches in progress (4 players each).
    for (let i = 0; i < 34; i++) await room(id, code(i), 1 + (i % 4));
    for (let i = 34; i < 37; i++) await room(id, code(i), 8);
    for (let i = 37; i < 42; i++) await room(id, code(i), 4, 0);
    const first = await roomsList();
    expect(first.match(/<div class="list-row flush-row quiet">/g)).toHaveLength(6);
    // Everyone in the game's rooms is still counted, and so are the rooms taking players.
    expect(first).toContain('data-count="37"');
    expect(first).toContain('href="/g/arena/rooms?cursor=6"');
    const rowCodes = (fragment: string) => [...fragment.matchAll(/href="\/g\/arena\?room=([A-Z0-9]{6})"/g)].map((found) => found[1]!);
    const firstCodes = rowCodes(first);
    expect(firstCodes).toHaveLength(6);

    // The second page is just rows in a list of the panel's id, 20 of them, and the Load more for the page after.
    const second = await roomsList("?cursor=6");
    expect(second).toMatch(/^<ul class="list-rows[^"]*" id="rooms-rows"/);
    expect(second.match(/<div class="list-row flush-row quiet">/g)).toHaveLength(20);
    expect(second).toContain('href="/g/arena/rooms?cursor=26"');
    expect(second).not.toContain("data-region");
    expect(rowCodes(second).some((roomCode) => firstCodes.includes(roomCode))).toBe(false);
    expect(pageProblems(second)).toEqual([]);

    // The last page: what's left (42 - 26 = 16 rooms), the full ones and the matches in progress at the end, and no Load more.
    const last = await roomsList("?cursor=26");
    expect(last.match(/<div class="list-row flush-row quiet">/g)).toHaveLength(16);
    expect(last).not.toContain("data-load-more");
    expect(last.match(/<span class="list-row-end">In a match<\/span>/g)).toHaveLength(5);
    expect(last.match(/<span class="list-row-end">Full<\/span>/g)).toHaveLength(3);
    expect(last.lastIndexOf(">Full<")).toBeLessThan(last.indexOf("In a match"));
    expect(pageProblems(last)).toEqual([]);
    // Past the end, an empty list; a cursor that isn't one starts at the first page.
    expect((await roomsList("?cursor=999")).match(/<div class="list-row flush-row quiet">/g)).toBeNull();
    expect((await roomsList("?cursor=nonsense")).match(/<div class="list-row flush-row quiet">/g)).toHaveLength(20);

    // A refresh keeps how many rows are loaded (shown_row_count), asking for fewer than six or more than allowed is held to the limits.
    const refreshed = await roomsList("?shown_row_count=26");
    expect(refreshed.match(/<div class="list-row flush-row quiet">/g)).toHaveLength(26);
    expect(refreshed).toContain('href="/g/arena/rooms?cursor=26"');
    expect((await roomsList("?shown_row_count=2")).match(/<div class="list-row flush-row quiet">/g)).toHaveLength(6);
    expect((await roomsList("?shown_row_count=nonsense")).match(/<div class="list-row flush-row quiet">/g)).toHaveLength(6);
    expect((await roomsList("?shown_row_count=100000")).match(/<div class="list-row flush-row quiet">/g)).toHaveLength(42);
    expect(await roomsList("?shown_row_count=100000")).not.toContain("data-load-more");

    // What the developer API and the SDK get from listRooms is as it was: one list in its own order (open rooms and matches in progress mixed by
    // the same sort as before the pages), up to 50, no cursor.
    const listed = await listRooms(env.DB, id);
    expect(listed.rooms).toHaveLength(42);
    expect(listed).not.toHaveProperty("nextCursor");
    expect(listed.moreOpenRoomCount).toBe(0);
    expect(listed.playing.closedRoomCount).toBe(5);
    // The page holds the same rooms, matches in progress last, and says where the next page starts.
    const everyone = await listRoomPage(env.DB, id, { pageRoomCount: 100 });
    expect([...everyone.rooms.map((listedRoom) => listedRoom.roomCode)].sort()).toEqual(listed.rooms.map((listedRoom) => listedRoom.roomCode).sort());
    expect(everyone.rooms.slice(-5).every((listedRoom) => !listedRoom.isOpen)).toBe(true);
    expect(everyone.nextCursor).toBeNull();
    expect((await listRoomPage(env.DB, id, { pageRoomCount: 10 })).nextCursor).toBe("10");
    expect((await listRoomPage(env.DB, id, { pageRoomCount: 10, cursor: "40" })).nextCursor).toBeNull();
  });

  it("orders the rooms by players and leaves full rooms out, on every page, with matches in progress always last", async () => {
    const id = await addGame("arena", "relay");
    const alphabet = "BCDFGHJKLMNPQRSTVWXYZ23456789".split("");
    const code = (index: number) => `${alphabet[index]}${"AAAAA"}`;
    // 12 open rooms of 8 seats (players 5, 1, 3, 8, 3, 6, 1, 8, 2, 4, 3, 7; two are full), the older ones listed later when players tie, and 3
    // matches in progress (7, 2 and 5 players) that no order may put before an open room.
    const players = [5, 1, 3, 8, 3, 6, 1, 8, 2, 4, 3, 7];
    const now = Date.now();
    for (const [index, count] of players.entries()) await room(id, code(index), count, 1, now - index * 1000);
    for (const [index, count] of [7, 2, 5].entries()) await room(id, code(12 + index), count, 0, now - (12 + index) * 1000);
    const pageOf = async (roomOrder: "best_to_join" | "most_players" | "fewest_players", isHidingFullRooms: boolean, cursor?: string, pageRoomCount = 6) =>
      listRoomPage(env.DB, id, { roomOrder, isHidingFullRooms, cursor, pageRoomCount });
    const everything = async (roomOrder: "best_to_join" | "most_players" | "fewest_players", isHidingFullRooms = false) => (await pageOf(roomOrder, isHidingFullRooms, undefined, 100)).rooms;

    const best = await everything("best_to_join");
    expect(best).toHaveLength(15);
    // The default is the order of the list before there were choices: rooms with space first, then the busiest, then full ones, then matches in progress.
    expect(best.slice(-3).every((listedRoom) => !listedRoom.isOpen)).toBe(true);
    expect((await pageOf("best_to_join", false)).roomOrder).toBe("best_to_join");

    // Most players: the open rooms from the fullest down, then the matches in progress from the busiest down; ties keep the best-to-join order.
    const most = await everything("most_players");
    expect(most.map((listedRoom) => listedRoom.playerCount)).toEqual([8, 8, 7, 6, 5, 4, 3, 3, 3, 2, 1, 1, 7, 5, 2]);
    expect(most.slice(-3).every((listedRoom) => !listedRoom.isOpen)).toBe(true);
    const tied = (roomOrdered: typeof most, playerCount: number) => roomOrdered.filter((listedRoom) => listedRoom.isOpen && listedRoom.playerCount === playerCount).map((listedRoom) => listedRoom.roomCode);
    for (const playerCount of [1, 3, 8]) expect(tied(most, playerCount)).toEqual(tied(best, playerCount));
    // Fewest players: the other way, matches in progress still last, from the quietest.
    const fewest = await everything("fewest_players");
    expect(fewest.map((listedRoom) => listedRoom.playerCount)).toEqual([1, 1, 2, 3, 3, 3, 4, 5, 6, 7, 8, 8, 2, 5, 7]);
    for (const playerCount of [1, 3, 8]) expect(tied(fewest, playerCount)).toEqual(tied(best, playerCount));

    // Page two continues the same order: the pages put end to end are the whole list, and the cursor follows.
    for (const roomOrder of ["most_players", "fewest_players"] as const) {
      const one = await pageOf(roomOrder, false);
      const two = await pageOf(roomOrder, false, one.nextCursor!);
      const three = await pageOf(roomOrder, false, two.nextCursor!);
      expect([...one.rooms, ...two.rooms, ...three.rooms].map((listedRoom) => listedRoom.roomCode)).toEqual((await everything(roomOrder)).map((listedRoom) => listedRoom.roomCode));
      expect([one.nextCursor, two.nextCursor, three.nextCursor]).toEqual(["6", "12", null]);
      expect(three.rooms).toHaveLength(3);
    }

    // Hide full rooms: open rooms with no space are gone, matches in progress stay (they aren't full rooms), the rest keep their order.
    for (const roomOrder of ["best_to_join", "most_players", "fewest_players"] as const) {
      const without = await everything(roomOrder, true);
      expect(without).toHaveLength(13);
      expect(without.filter((listedRoom) => listedRoom.isOpen && !hasSpace(listedRoom))).toEqual([]);
      expect(without.slice(-3).every((listedRoom) => !listedRoom.isOpen)).toBe(true);
      expect(without.map((listedRoom) => listedRoom.roomCode)).toEqual((await everything(roomOrder)).filter((listedRoom) => !listedRoom.isOpen || hasSpace(listedRoom)).map((listedRoom) => listedRoom.roomCode));
    }
    // Page two of the filtered list continues it, and its cursor counts the rooms that are left.
    const filteredOne = await pageOf("most_players", true, undefined, 10);
    expect(filteredOne.nextCursor).toBe("10");
    expect((await pageOf("most_players", true, "10", 10)).rooms).toHaveLength(3);
    // listRooms, which the developer API and the SDK read, knows neither, and its answer is as it was.
    const listed = await listRooms(env.DB, id);
    expect(listed.rooms).toHaveLength(15);
    expect(listed).not.toHaveProperty("roomOrder");

    // The page's route: the panel shows the pick, the Load more carries it, and the number by Rooms counts the full rooms too.
    const full = await roomsList();
    expect(full).toContain('name="room_order" value="best_to_join"');
    expect(full).toContain("Best to join");
    expect(full).toContain('name="is_hiding_full_rooms" value="true"');
    expect(full).not.toMatch(/name="is_hiding_full_rooms"[^>]* checked/);
    expect(full).toContain('data-shown="|[]|best_to_join|false"');
    expect(full).toContain('href="/g/arena/rooms?cursor=6"');
    const fewestPanel = await roomsList("?room_order=fewest_players&is_hiding_full_rooms=true");
    expect(fewestPanel).toContain('name="room_order" value="fewest_players"');
    expect(fewestPanel).toMatch(/name="is_hiding_full_rooms"[^>]* checked/);
    expect(fewestPanel).toContain('data-shown="|[]|fewest_players|true"');
    expect(fewestPanel).toContain("cursor=6&amp;room_order=fewest_players&amp;is_hiding_full_rooms=true");
    expect(fewestPanel).toContain('data-count="12"');
    expect(fewestPanel).not.toContain(">Full<");
    expect(fewestPanel.match(/<div class="list-row flush-row quiet">/g)).toHaveLength(6);
    const fewestNext = await roomsList("?cursor=6&room_order=fewest_players&is_hiding_full_rooms=true");
    expect(fewestNext.match(/<div class="list-row flush-row quiet">/g)).toHaveLength(7);
    expect(fewestNext.match(/<span class="list-row-end">In a match<\/span>/g)).toHaveLength(3);
    expect(fewestNext).not.toContain(">Full<");
    expect(fewestNext).not.toContain("data-load-more");
    expect(pageProblems(fewestPanel)).toEqual([]);
    // Full rooms shown, they are where the order puts them: the fullest first.
    const mostNext = await roomsList("?room_order=most_players&shown_row_count=15");
    expect(mostNext.match(/<span class="list-row-end">Full<\/span>/g)).toHaveLength(2);
    expect(mostNext.indexOf(">Full<")).toBeLessThan(mostNext.indexOf("In a match"));

    // Anything that isn't a known order, or isn't "true", is the default: the same list as no parameter at all.
    for (const query of ["?room_order=nonsense", "?room_order=", "?is_hiding_full_rooms=yes", "?is_hiding_full_rooms=1", "?room_order=MOST_PLAYERS"]) {
      expect(await roomsList(query)).toBe(full);
    }
    // Everything hidden: a say-so with the box still there to untick.
    await env.DB.exec("DELETE FROM live_rooms WHERE is_open = 0");
    await env.DB.exec("UPDATE live_rooms SET player_count = maximum_player_count");
    const none = await roomsList("?is_hiding_full_rooms=true");
    expect(none).toContain("No open rooms with space right now.");
    expect(none).toMatch(/name="is_hiding_full_rooms"[^>]* checked/);
  });

  it("carries the region and labels picked into the next page, and tells no sentences about rooms past the list", async () => {
    const id = await addGame("arena", "relay");
    const named = (roomCode: string, labels: Record<string, string>, where: [string, string]) =>
      env.DB.prepare("INSERT INTO live_rooms (game_id, room_code, player_count, maximum_player_count, is_open, labels, country, continent, created_at_ms, updated_at_ms) VALUES (?, ?, 2, 8, 1, ?, ?, ?, ?, ?)")
        .bind(id, roomCode, JSON.stringify(labels), where[0], where[1], Date.now(), Date.now())
        .run();
    const codes = "BCDFGHJKLMNPQRSTVWXYZ".split("");
    for (const [i, c] of codes.slice(0, 12).entries()) await named(c.repeat(6), { Mode: i % 4 === 0 ? "Hardcore" : "Classic" }, ["DE", "EU"]);
    for (const c of codes.slice(12, 15)) await named(c.repeat(6), { Mode: "Classic" }, ["US", "NA"]);
    const picked = encodeURIComponent(JSON.stringify({ Mode: "Classic" }));
    const first = await roomsList(`?region=EU&labels=${picked}`);
    expect(first.match(/<div class="list-row flush-row quiet">/g)).toHaveLength(6);
    expect(first).toContain("cursor=6&amp;region=EU&amp;labels=");
    // The next page holds the rest of the 9 Classic rooms in Europe: 3, and nothing after them.
    const next = await roomsList(`?cursor=6&region=EU&labels=${picked}`);
    expect(next.match(/<div class="list-row flush-row quiet">/g)).toHaveLength(3);
    expect(next).not.toContain("data-load-more");
    for (const text of [first, next, await roomsList()]) {
      expect(text).not.toContain("more rooms with fewer players");
      expect(text).not.toContain("Press Play and the game finds you one");
    }
  });

  it("shows a kept room waiting with nobody in it after rooms with players, and the daily cleanup keeps it", async () => {
    const id = await addGame("arena", "relay");
    await room(id, "BCDFGH", 3);
    // Asleep for days, so it hasn't checked in since: kept rooms with nobody in them never go stale.
    const longAgo = Date.now() - 3 * 24 * 3600_000;
    await env.DB.prepare("INSERT INTO live_rooms (game_id, room_code, player_count, maximum_player_count, is_open, name, is_kept, country, continent, created_at_ms, updated_at_ms) VALUES (?, 'NRTHWC', 0, 8, 1, 'Northwatch', 1, 'DE', 'EU', ?, ?)")
      .bind(id, longAgo, longAgo)
      .run();
    await room(id, "XYZ234", 5, 1, Date.now() - 3 * 3600_000);
    const list = await roomsList();
    // Its name, how full it is and Join, with no other mark, below the room with players.
    expect(list).toMatch(/\?room=BCDFGH[\s\S]*<span class="list-row-title">Northwatch<\/span><span class="list-row-detail"><span class="list-row-fact">0\u00a0of 8\u00a0players\u00a0·<\/span>[\s\S]*<a class="shell cut-btn small" href="\/g\/arena\?room=NRTHWC">/);
    expect(list).toContain('data-count="2"');
    // Nobody's playing in it: 3 playing now.
    expect(list).toContain('data-playing="3"');

    await dailyCleanup(env);
    const left = await env.DB.prepare("SELECT room_code FROM live_rooms WHERE game_id = ? ORDER BY room_code").bind(id).all<{ room_code: string }>();
    expect(left.results.map((row) => row.room_code)).toEqual(["BCDFGH", "NRTHWC"]);
  });

  it("shows who's playing now, hidden rooms included, once there are 3 or more", async () => {
    const id = await addGame("arena", "relay");
    const hidden = (code: string, players: number) =>
      env.DB.prepare("INSERT INTO live_rooms (game_id, room_code, player_count, maximum_player_count, is_listed, is_open, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 8, 0, 1, ?, ?)").bind(id, code, players, Date.now(), Date.now()).run();
    await hidden("BCDFGH", 2);
    expect(await roomsList()).toContain('data-playing="2"');
    await hidden("CDFGHJ", 3);
    const list = await roomsList();
    expect(list).toContain('data-playing="5"');
    // Hidden rooms are counted, never listed.
    expect(list).not.toContain("?room=BCDFGH");
    // A game that lists no rooms on its page still says who's playing, without a link.
    await env.DB.prepare("UPDATE games SET room_browsing = 'off' WHERE id = ?").bind(id).run();
    expect(await (await SELF.fetch("https://zaisma.test/g/arena")).text()).toMatch(/id="playing-now">[\s\S]*?<b>5<\/b> playing now/);
    // Single-player games have the line too, from the browsers playing them (plays.test.ts); hidden with nobody playing.
    await addGame("solo");
    expect(await (await SELF.fetch("https://zaisma.test/g/solo")).text()).toMatch(/id="playing-now" hidden>[\s\S]*?<b>0<\/b> playing now/);
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
    const list = await roomsList();
    expect(list).toContain('<span class="list-row-title">Ana&#39;s castle · Classic · Docks</span>');
    expect(list).toContain('data-report-room="BCDFGH" data-room-name="Ana&#39;s castle, Classic, Docks"');
    // A name that fails the filter isn't shown; its labels still are.
    expect(list).not.toContain("coolkid");
    expect(list).toMatch(/<span class="list-row-title">Hardcore<\/span><span class="list-row-detail"><span class="list-row-fact">2\u00a0of 8\u00a0players<\/span>/);
    // The filter: Any and each value; the page's script reads data-label on the field a pick changes.
    expect(list).toContain('<input type="hidden" name="room_label_0" value="" data-label="Mode">');
    expect(list).toMatch(/data-choice-value="Classic" aria-selected="false"[\s\S]*data-choice-value="Hardcore"/);
    expect(pageProblems(list)).toEqual([]);
    const classic = await roomsList(`?labels=${encodeURIComponent(JSON.stringify({ Mode: "Classic" }))}`);
    expect(classic.match(/<div class="list-row flush-row quiet">/g)).toHaveLength(2);
    expect(classic).toContain('value="Classic" data-label="Mode">');
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

  it("says when there's no room to join", async () => {
    await addGame("arena", "relay");
    expect(await roomsList()).toContain("Nobody&#39;s in an open room right now. Press Play to start.");
  });

  it("leaves rooms off the page for games that list them only in the game, or not at all, and for games without our rooms", async () => {
    const id = await addGame("lobby", "relay");
    await room(id, "BCDFGH", 3);
    for (const browsing of ["game", "off"]) {
      await env.DB.prepare("UPDATE games SET room_browsing = ? WHERE id = ?").bind(browsing, id).run();
      expect(await (await SELF.fetch("https://zaisma.test/g/lobby")).text()).not.toContain('id="rooms-list"');
      expect((await SELF.fetch("https://zaisma.test/g/lobby/rooms")).status).toBe(404);
    }
    await addGame("solo");
    expect(await (await SELF.fetch("https://zaisma.test/g/solo")).text()).not.toContain('id="rooms-list"');
  });
});
