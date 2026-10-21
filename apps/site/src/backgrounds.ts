import { backgroundsFor, imageById, shaderById, type BackgroundScreen, type BackgroundSource, type Game } from "@zaisma/core";
import { gameUrl, type Env } from "./env.ts";
import { html, type Raw } from "./html.ts";

/**
 * What Zaisma's pages show behind their glass for a game (Backgrounds in docs/DEVELOPER-API.md): the home while the game is in
 * focus, and the game's own page. The pages call backgroundOf and put backgroundMarkup in their .backdrop box; BACKDROP_SCRIPT
 * (components/foundations.ts) runs it. Zaisma's own background is BACKDROP_SCRIPT's shader on zaisma.com, as Zaisma's code; a
 * game's shader runs in a frame on the game's own site; a picture is an img. Glass over a game's background is measured from
 * its still or its picture, both served from zaisma.com, never from the frame.
 */

export type ShownBackground =
  | { source: "zaisma"; glassTintColor: string | null }
  | { source: "image"; imageUrl: string; stillUrl: string; glassTintColor: string | null }
  | { source: "shader"; frameUrl: string; stillUrl: string; glassTintColor: string | null };

/** What a screen shows for a game, phone following wide resolved; anything not approved shows Zaisma's own. */
export async function backgroundOf(env: Env, game: Game, screen: BackgroundScreen): Promise<ShownBackground> {
  const glassTintColor = game.glass_tint_color;
  const backgrounds = await backgroundsFor(env.DB, game.id);
  const background = screen === "phone" && backgrounds.phone.source === "wide" ? backgrounds.wide : backgrounds[screen];
  if (background.source === "image" && background.image_id) {
    const image = await imageById(env.DB, background.image_id);
    if (image?.review_status === "approved" && image.game_id === game.id) {
      const imageUrl = `${env.SITE_ORIGIN}/img/${image.id}`;
      return { source: "image", imageUrl, stillUrl: imageUrl, glassTintColor };
    }
  }
  if (background.source === "shader" && background.shader_id) {
    const shader = await shaderById(env.DB, background.shader_id);
    if (shader?.review_status === "approved" && shader.game_id === game.id) {
      // The runner's address carries the shader's ID, so a new choice is never served from a cache.
      return { source: "shader", frameUrl: `${gameUrl(env, game.slug)}_zaisma/background?screen=${background.screen}&shader=${shader.id}`, stillUrl: `${env.SITE_ORIGIN}/shaders/${shader.id}/still.png`, glassTintColor };
    }
  }
  return { source: "zaisma", glassTintColor };
}

/**
 * The backdrop for a shown background, to sit in a page's .backdrop box. A game's frame is sandboxed to scripts on its own site:
 * no forms, popups or navigation of the page. The glass tint, when the game set one, goes on the page with zaismaGlass.
 */
export function backgroundMarkup(background: ShownBackground): Raw {
  if (background.source === "image") return html`<img class="backdrop" data-backdrop="picture" data-adapts-glass src="${background.imageUrl}" alt="" decoding="async">`;
  if (background.source === "shader") {
    return html`<iframe class="backdrop" data-backdrop="frame" data-adapts-glass data-backdrop-still="${background.stillUrl}" src="${background.frameUrl}" sandbox="allow-scripts allow-same-origin" allow="" loading="eager" tabindex="-1" aria-hidden="true" title="Background"></iframe>`;
  }
  return html`<canvas class="backdrop" data-backdrop="shader" aria-hidden="true"></canvas>`;
}

/**
 * The backgrounds of every listed game that chose one, in one query, for a page that shows many games at once (the home sends
 * the whole shelf's). A game missing from the answer shows Zaisma's own on both screens; phones follow wide until a phone background is set.
 */
export async function backgroundsOfGames(env: Env, games: Pick<Game, "id" | "slug">[]): Promise<Map<string, Record<BackgroundScreen, ShownBackground>>> {
  const { results } = await env.DB
    .prepare(
      `SELECT game_backgrounds.game_id, game_backgrounds.screen, game_backgrounds.source, game_backgrounds.image_id, game_backgrounds.shader_id,
         EXISTS (SELECT 1 FROM game_images WHERE game_images.id = game_backgrounds.image_id AND game_images.game_id = game_backgrounds.game_id AND game_images.review_status = 'approved') AS is_image_approved,
         EXISTS (SELECT 1 FROM game_shaders WHERE game_shaders.id = game_backgrounds.shader_id AND game_shaders.game_id = game_backgrounds.game_id AND game_shaders.review_status = 'approved') AS is_shader_approved
       FROM game_backgrounds JOIN games ON games.id = game_backgrounds.game_id
       WHERE games.review_status = 'live' AND games.visibility = 'listed'`,
    )
    .all<{ game_id: string; screen: BackgroundScreen; source: BackgroundSource; image_id: string | null; shader_id: string | null; is_image_approved: number; is_shader_approved: number }>();
  const slugById = new Map(games.map((game) => [game.id, game.slug]));
  const chosen = new Map<string, Partial<Record<BackgroundScreen, ShownBackground>>>();
  for (const row of results) {
    const slug = slugById.get(row.game_id);
    if (!slug) continue;
    const shown: ShownBackground | null =
      row.source === "image" && row.image_id && row.is_image_approved
        ? { source: "image", imageUrl: `${env.SITE_ORIGIN}/img/${row.image_id}`, stillUrl: `${env.SITE_ORIGIN}/img/${row.image_id}`, glassTintColor: null }
        : row.source === "shader" && row.shader_id && row.is_shader_approved
          ? { source: "shader", frameUrl: `${gameUrl(env, slug)}_zaisma/background?screen=${row.screen}&shader=${row.shader_id}`, stillUrl: `${env.SITE_ORIGIN}/shaders/${row.shader_id}/still.png`, glassTintColor: null }
          : row.source === "zaisma"
            ? { source: "zaisma", glassTintColor: null }
            : null;
    if (shown) chosen.set(row.game_id, { ...chosen.get(row.game_id), [row.screen]: shown });
  }
  const own = new Map<string, Record<BackgroundScreen, ShownBackground>>();
  for (const [gameId, screens] of chosen) {
    // A phone with a background of its own shows it; otherwise phones follow wide (Zaisma's own, when only phone was set).
    const wide = screens.wide ?? { source: "zaisma" as const, glassTintColor: null };
    if (wide.source === "zaisma" && (screens.phone ?? wide).source === "zaisma") continue;
    own.set(gameId, { wide, phone: screens.phone ?? wide });
  }
  return own;
}
