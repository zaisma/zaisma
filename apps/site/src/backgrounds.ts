import { backgroundsFor, imageById, shaderById, type BackgroundScreen, type BackgroundSource, type BackgroundTone, type Game } from "@zaisma/core";
import { shownTone, type ShownTone } from "./background-tone.ts";
import { gameUrl, type Env } from "./env.ts";
import { html, type Raw } from "./html.ts";
import { backdropPlaceholder } from "./components/foundations.ts";

/**
 * What Zaisma's pages show behind their glass for a game (Backgrounds in docs/DEVELOPER-API.md): the home while the game is in
 * focus, and the game's own page. The pages call backgroundOf and put backgroundMarkup in their .backdrop box; BACKDROP_SCRIPT
 * (components/foundations.ts) runs it. Zaisma's own background is BACKDROP_SCRIPT's shader on zaisma.com, as Zaisma's code; a
 * game's shader runs in a frame on the game's own site; a picture is an img. Glass over a game's background is measured from
 * its still or its picture, both served from zaisma.com, never from the frame; a background whose tone was measured (background-tone.ts)
 * carries it, and its glass is taken from that instead.
 */

export type ShownBackground =
  | { source: "zaisma"; glassTintColor: string | null }
  | { source: "image"; imageUrl: string; stillUrl: string; placeholderDataUrl: string | null; tone: ShownTone | null; glassTintColor: string | null }
  | { source: "shader"; frameUrl: string; stillUrl: string; placeholderDataUrl: string | null; tone: ShownTone | null; glassTintColor: string | null };

/** What a screen shows for a game, phone following wide resolved; anything not approved shows Zaisma's own. */
export async function backgroundOf(env: Env, game: Game, screen: BackgroundScreen): Promise<ShownBackground> {
  const glassTintColor = game.glass_tint_color;
  const backgrounds = await backgroundsFor(env.DB, game.id);
  const background = screen === "phone" && backgrounds.phone.source === "wide" ? backgrounds.wide : backgrounds[screen];
  if (background.source === "image" && background.image_id) {
    const image = await imageById(env.DB, background.image_id);
    if (image?.review_status === "approved" && image.game_id === game.id) {
      const imageUrl = `${env.SITE_ORIGIN}/img/${image.id}`;
      return { source: "image", imageUrl, stillUrl: imageUrl, placeholderDataUrl: image.placeholder_data_url, tone: shownTone(image), glassTintColor };
    }
  }
  if (background.source === "shader" && background.shader_id) {
    const shader = await shaderById(env.DB, background.shader_id);
    if (shader?.review_status === "approved" && shader.game_id === game.id) {
      // The runner's address carries the shader's ID, so a new choice is never served from a cache.
      return { source: "shader", frameUrl: `${gameUrl(env, game.slug)}_zaisma/background?screen=${background.screen}&shader=${shader.id}`, stillUrl: `${env.SITE_ORIGIN}/shaders/${shader.id}/still.png`, placeholderDataUrl: shader.placeholder_data_url, tone: shownTone(shader), glassTintColor };
    }
  }
  return { source: "zaisma", glassTintColor };
}

/**
 * The backdrop for a shown background, to sit in a page's .backdrop box. A game's frame is sandboxed to scripts on its own site:
 * no forms, popups or navigation of the page. The glass tint, when the game set one, goes on the page with zaismaGlass.
 */
export function backgroundMarkup(background: ShownBackground): Raw {
  if (background.source === "zaisma") return html`<canvas class="backdrop" data-backdrop="shader" aria-hidden="true"></canvas>`;
  const tone = background.tone ? html` data-glass-kind="${background.tone.isGlassSmoked ? "smoked" : "light"}" data-glass-tint="${background.tone.glassTint}" data-backdrop-color="${background.tone.averageColor}"` : "";
  // Its placeholder lies under it until it arrives (backdropPlaceholder): a picture fades in over it once decoded, a shader's frame shows the same until it draws.
  if (background.source === "image") return html`${backdropPlaceholder(background.placeholderDataUrl)}<img class="backdrop reveals" data-backdrop="picture" data-adapts-glass${tone} src="${background.imageUrl}" alt="" decoding="async" fetchpriority="high">`;
  return html`${backdropPlaceholder(background.placeholderDataUrl)}<iframe class="backdrop" data-backdrop="frame" data-adapts-glass${tone} data-backdrop-still="${background.stillUrl}" src="${background.frameUrl}" sandbox="allow-scripts allow-same-origin" allow="" loading="eager" tabindex="-1" aria-hidden="true" title="Background"></iframe>`;
}

/**
 * The backgrounds of every listed game that chose one, in one query, for a page that shows many games at once (the home sends
 * the whole shelf's). A game missing from the answer shows Zaisma's own on both screens; phones follow wide until a phone background is set.
 * The games may still be on their way: the query doesn't need them, only matching its rows after, so the home starts both at once.
 */
export async function backgroundsOfGames(env: Env, games: Pick<Game, "id" | "slug">[] | Promise<Pick<Game, "id" | "slug">[]>): Promise<Map<string, Record<BackgroundScreen, ShownBackground>>> {
  const [{ results }, listedGames] = await Promise.all([env.DB
    .prepare(
      `SELECT game_backgrounds.game_id, game_backgrounds.screen, game_backgrounds.source, game_backgrounds.image_id, game_backgrounds.shader_id,
         game_images.id IS NOT NULL AS is_image_approved, game_shaders.id IS NOT NULL AS is_shader_approved,
         COALESCE(game_images.average_color, game_shaders.average_color) AS average_color,
         COALESCE(game_images.is_glass_smoked, game_shaders.is_glass_smoked) AS is_glass_smoked,
         COALESCE(game_images.glass_tint_pct, game_shaders.glass_tint_pct) AS glass_tint_pct,
         COALESCE(game_images.placeholder_data_url, game_shaders.placeholder_data_url) AS placeholder_data_url
       FROM game_backgrounds JOIN games ON games.id = game_backgrounds.game_id
       LEFT JOIN game_images ON game_images.id = game_backgrounds.image_id AND game_images.game_id = game_backgrounds.game_id AND game_images.review_status = 'approved'
       LEFT JOIN game_shaders ON game_shaders.id = game_backgrounds.shader_id AND game_shaders.game_id = game_backgrounds.game_id AND game_shaders.review_status = 'approved'
       WHERE games.review_status = 'live' AND games.visibility = 'listed'`,
    )
    .all<{ game_id: string; screen: BackgroundScreen; source: BackgroundSource; image_id: string | null; shader_id: string | null; is_image_approved: number; is_shader_approved: number; placeholder_data_url: string | null } & { [Name in keyof BackgroundTone]: BackgroundTone[Name] | null }>(), games]);
  const slugById = new Map(listedGames.map((game) => [game.id, game.slug]));
  const chosen = new Map<string, Partial<Record<BackgroundScreen, ShownBackground>>>();
  for (const row of results) {
    const slug = slugById.get(row.game_id);
    if (!slug) continue;
    const shown: ShownBackground | null =
      row.source === "image" && row.image_id && row.is_image_approved
        ? { source: "image", imageUrl: `${env.SITE_ORIGIN}/img/${row.image_id}`, stillUrl: `${env.SITE_ORIGIN}/img/${row.image_id}`, placeholderDataUrl: row.placeholder_data_url, tone: shownTone(row), glassTintColor: null }
        : row.source === "shader" && row.shader_id && row.is_shader_approved
          ? { source: "shader", frameUrl: `${gameUrl(env, slug)}_zaisma/background?screen=${row.screen}&shader=${row.shader_id}`, stillUrl: `${env.SITE_ORIGIN}/shaders/${row.shader_id}/still.png`, placeholderDataUrl: row.placeholder_data_url, tone: shownTone(row), glassTintColor: null }
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
