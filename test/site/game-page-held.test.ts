import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { cookieName } from "../../apps/site/src/auth.ts";
import { PLAYED_COOKIE } from "../../apps/site/src/home-script.ts";

// A game page's Last played, on a guest's device that played it: its slot is held from the first frame, so Play and the panes under it
// never move when the page's script says when.

const SITE = "https://zaisma.test";

beforeEach(async () => {
  await env.DB.exec("DELETE FROM games WHERE id = 'g-held';");
  const now = Date.now();
  await env.DB.prepare("INSERT INTO games (id, slug, title, review_status, visibility, created_at_ms, updated_at_ms) VALUES ('g-held', 'held-game', 'Held Game', 'live', 'listed', ?, ?)").bind(now, now).run();
});

const page = async (cookie?: string) => (await SELF.fetch(`${SITE}/g/held-game`, cookie ? { headers: { cookie } } : {})).text();
const opening = (markup: string, id: string) => markup.match(new RegExp(`<[^>]* id="${id}"[^>]*>`))?.[0] ?? "";

describe("a game page's Last played", () => {
  it("holds its slot from the first frame on a device that played the game", async () => {
    const markup = await page(`${cookieName(env, PLAYED_COOKIE)}=other-game,held-game`);
    expect(opening(markup, "live-line")).not.toMatch(/\shidden/);
    expect(opening(markup, "last-played")).toMatch(/class="key-detail is-held"/);
    expect(opening(markup, "last-played")).not.toMatch(/\shidden/);
  });

  it("takes no room on a device that never played it", async () => {
    const markup = await page(`${cookieName(env, PLAYED_COOKIE)}=other-game`);
    expect(opening(markup, "live-line")).toMatch(/\shidden/);
    expect(opening(markup, "last-played")).not.toMatch(/is-held/);
  });
});
