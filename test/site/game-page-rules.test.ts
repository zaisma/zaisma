import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { pageProblems } from "./page-rules.ts";

// The game page holds to the pages' rule like any other (test/site/design.test.ts, "pages"): only gallery components, layout included.

async function addGame(slug: string, multiplayerMode: "none" | "relay") {
  const id = `g${slug.replace(/-/g, "")}`;
  await env.DB.prepare("INSERT INTO games (id, slug, title, description, review_status, live_version_id, multiplayer_mode, cloud_saves_enabled, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 'Hold the line.', 'live', 'v1', ?, 1, 0, 0)")
    .bind(id, slug, slug, multiplayerMode)
    .run();
  return id;
}

describe("the game page", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM live_rooms; DELETE FROM games;");
  });

  it("is only gallery components: no style, class or stylesheet of its own", async () => {
    const id = await addGame("arena", "relay");
    await addGame("solo", "none");
    for (const [code, playerCount] of [["BCDFGH", 3], ["JKMN3P", 8]] as const) {
      await env.DB.prepare("INSERT INTO live_rooms (game_id, room_code, player_count, maximum_player_count, is_open, name, country, continent, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 8, 1, 'North gate', 'DE', 'EU', ?, ?)")
        .bind(id, code, playerCount, Date.now(), Date.now())
        .run();
    }
    for (const path of ["/g/arena", "/g/arena?room=BCDFGH", "/g/solo"]) {
      const response = await SELF.fetch(`https://zaisma.test${path}`);
      expect(response.status, path).toBe(200);
      expect(pageProblems(await response.text()), path).toEqual([]);
    }
  });
});
