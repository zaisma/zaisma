import { backgroundsFor, imageById, shaderById, type BackgroundScreen, type Game } from "@zaisma/core";
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
