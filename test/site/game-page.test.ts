import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { pageDataOf } from "../strict-scripts.ts";

/**
 * The game page's details (pages.ts, gamePage): one pane with Play, Details and the icon buttons, then the sections in one scroll, rooms
 * first. How rooms, tester links, reports and saves behave is in their own tests; these check how the page holds them.
 */

const SITE = "https://zaisma.test";
const page = async (path: string) => (await SELF.fetch(`${SITE}${path}`)).text();

async function addGame(slug: string, multiplayerMode: "none" | "relay" = "none", visibility = "listed") {
  const id = `g-page-${slug}`;
  await env.DB.prepare("INSERT INTO games (id, slug, title, review_status, visibility, live_version_id, multiplayer_mode, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 'live', ?, 'v-page', ?, 0, 0)")
    .bind(id, slug, slug, visibility, multiplayerMode)
    .run();
  return id;
}

/** Where each of the page's parts starts, so their order can be compared. */
const placeOf = (text: string, part: string) => text.indexOf(part);

beforeEach(async () => {
  await env.DB.exec("DELETE FROM live_rooms; DELETE FROM tester_links; DELETE FROM game_backgrounds; DELETE FROM game_shaders; DELETE FROM versions WHERE id = 'v-page'; DELETE FROM games WHERE id LIKE 'g-page-%';");
});

describe("the game page's details", () => {
  it("hold Play and a Details link to About side by side, with Share and Report as words under them, and no tabs", async () => {
    await addGame("solo");
    const text = await page("/g/solo");
    // Play fills the row and Details fits its words (Row, lead-fills); Share and Report are text buttons in a row under them.
    expect(text).toMatch(/<div class="row-cell is-control fills[^"]*"><button class="shell run-wrap" type="button" id="play">[\s\S]*?<div class="row-cell is-control[^"]*"><a class="shell cut-btn big" href="#about">/);
    expect(text).toMatch(/<button class="shell text-btn" type="button" id="share-page" aria-controls="share-dialog">[\s\S]*?<a class="shell text-btn" href="\/g\/solo\/report" data-report="">/);
    expect(placeOf(text, 'id="play"')).toBeLessThan(placeOf(text, 'id="share-page"'));
    expect(text).not.toContain('role="tablist"');
    expect(text).toContain('<section id="about">');
  });

  it("put the rooms first when the game lists them, and About first when it has nothing else", async () => {
    const id = await addGame("arena", "relay");
    await env.DB.prepare("INSERT INTO live_rooms (game_id, room_code, player_count, maximum_player_count, is_open, created_at_ms, updated_at_ms) VALUES (?, 'BCDFGH', 3, 8, 1, ?, ?)").bind(id, Date.now(), Date.now()).run();
    const arena = await page("/g/arena");
    const sections = arena.slice(placeOf(arena, '<div class="split-main">'));
    expect(sections.match(/<section id="([a-z]+)">/)![1]).toBe("rooms");
    expect(placeOf(arena, '<section id="rooms">')).toBeLessThan(placeOf(arena, '<section id="about">'));
    await addGame("solo");
    const solo = await page("/g/solo");
    expect(solo.slice(placeOf(solo, '<div class="split-main">')).match(/<section id="([a-z]+)">/)![1]).toBe("about");
  });

  it("show a tester link's note inside the pane just above Play, and no rooms", async () => {
    const id = await addGame("hidden-arena", "relay", "private");
    await env.DB.prepare("INSERT INTO live_rooms (game_id, room_code, player_count, maximum_player_count, is_open, created_at_ms, updated_at_ms) VALUES (?, 'BCDFGH', 3, 8, 1, ?, ?)").bind(id, Date.now(), Date.now()).run();
    await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES ('v-page', ?, 'games/page/v', 1, 0, 'approved', 0) ON CONFLICT (id) DO UPDATE SET game_id = excluded.game_id").bind(id).run();
    await env.DB.prepare("INSERT INTO tester_links (id, game_id, name, token, created_at_ms) VALUES ('t-page', ?, 'Team', 'pagetester0123456789', ?)").bind(id, Date.now()).run();
    const text = await page("/t/pagetester0123456789");
    const pane = text.slice(placeOf(text, '<div class="split-side">'), placeOf(text, '<div class="split-main">'));
    expect(pane).toMatch(/<div class="banner glass amber"[\s\S]*?You&#39;re testing this game with a link from its developer\./);
    expect(placeOf(pane, "You&#39;re testing this game")).toBeLessThan(placeOf(pane, 'id="play"'));
    expect(text).not.toContain('<section id="rooms">');
  });

  it("tell a tester link that can't open what's wrong, on Zaisma's own glass", async () => {
    const missing = await SELF.fetch(`${SITE}/t/nosuchtest0123456789`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toMatch(/<div class="state-note problem">[\s\S]*This link doesn&#39;t work/);
  });

  it("show a shader background from the game's own site, and none when the game starts at once", async () => {
    const id = await addGame("shaded");
    await env.DB.prepare("INSERT INTO game_shaders (id, game_id, screen, size_bytes, review_status, created_at_ms) VALUES ('shader-page', ?, 'wide', 10, 'approved', 0)").bind(id).run();
    await env.DB.prepare("INSERT INTO game_backgrounds (game_id, screen, source, shader_id, updated_at_ms) VALUES (?, 'wide', 'shader', 'shader-page', 0)").bind(id).run();
    const background = pageDataOf(await page("/g/shaded"), "game-page-data").background as { wide: { frameUrl: string }; phone: unknown };
    expect(new URL(background.wide.frameUrl).origin).toBe("https://games.zaisma.test");
    // Phones follow wide until the game sets its own.
    expect(background.phone).toEqual(background.wide);
    expect(pageDataOf(await page("/g/shaded?play"), "game-page-data").background).toBeNull();
  });
});
