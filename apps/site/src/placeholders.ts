import { PICTURE_PLACEHOLDER, imageKey, shaderStillKey, type GameImage, type GameShader, type ImageKind } from "@zaisma/core";
import type { Env } from "./env.ts";
import type { ShownPicture } from "./components/foundations.ts";

/**
 * Placeholders: every picture a page shows starts as a tiny blurred copy of itself, sent inside the page, that sharpens in as the real one
 * lands ("A page shows whole while it loads" in docs/DESIGN.md; ShownPicture in components/foundations.ts). The copy is the picture
 * PICTURE_PLACEHOLDER.widthPx wide as a WebP data: URL, made once with Cloudflare Images, the binding sizedImage uses, and kept on the
 * picture's row (placeholder_data_url): when a picture is approved, when a shader's check draws its still, and by the daily job for any
 * approved before then. A page never makes one. Without the Images binding (a self-hosted copy without it) it stays null and the page
 * shows the picture's place as it would without one.
 */

/** The kinds of picture a page shows, so the only ones given a placeholder: a shader's texture is only read by its shader. */
const SHOWN_IMAGE_KINDS: readonly ImageKind[] = ["cover", "square", "share", "screenshot", "background", "phone_background"];

/** The most placeholders the daily job makes in one run. */
const DAILY_PLACEHOLDER_COUNT = 50;

/** A picture's placeholder, from its bytes: null without the Images binding, when making it fails, or when it comes out too long. */
export async function placeholderDataUrl(env: Env, picture: ReadableStream | ArrayBuffer): Promise<string | null> {
  if (!env.IMAGES) return null;
  try {
    const body = picture instanceof ArrayBuffer ? new Response(picture).body! : picture;
    const made = await env.IMAGES.input(body).transform({ width: PICTURE_PLACEHOLDER.widthPx, fit: "scale-down" }).output({ format: PICTURE_PLACEHOLDER.format, quality: PICTURE_PLACEHOLDER.quality });
    const bytes = new Uint8Array(await new Response(made.image()).arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const dataUrl = `data:${PICTURE_PLACEHOLDER.format};base64,${btoa(binary)}`;
    return dataUrl.length <= PICTURE_PLACEHOLDER.maximumLength ? dataUrl : null;
  } catch (error) {
    console.error("placeholder failed", error);
    return null;
  }
}

/** Makes and keeps an approved picture's placeholder, unless it has one or isn't a kind pages show. */
export async function keepImagePlaceholder(env: Env, image: Pick<GameImage, "id" | "game_id" | "kind" | "placeholder_data_url">): Promise<void> {
  if (image.placeholder_data_url || !SHOWN_IMAGE_KINDS.includes(image.kind)) return;
  const original = await env.GAMES.get(imageKey(image));
  const dataUrl = original ? await placeholderDataUrl(env, original.body) : null;
  if (dataUrl) await env.DB.prepare("UPDATE game_images SET placeholder_data_url = ? WHERE id = ? AND placeholder_data_url IS NULL").bind(dataUrl, image.id).run();
}

/** Makes and keeps a shader's placeholder from its still, as its check draws it. */
export async function keepShaderPlaceholder(env: Env, shader: Pick<GameShader, "id">, stillPng: ArrayBuffer | Uint8Array): Promise<void> {
  const bytes = stillPng instanceof Uint8Array ? stillPng.slice().buffer : stillPng;
  const dataUrl = await placeholderDataUrl(env, bytes);
  if (dataUrl) await env.DB.prepare("UPDATE game_shaders SET placeholder_data_url = ? WHERE id = ?").bind(dataUrl, shader.id).run();
}

/** The daily job: placeholders for the approved pictures and shaders without one, DAILY_PLACEHOLDER_COUNT a run. */
export async function fillMissingPlaceholders(env: Env): Promise<void> {
  if (!env.IMAGES) return;
  const kinds = SHOWN_IMAGE_KINDS.map(() => "?").join(", ");
  const [{ results: images }, { results: shaders }] = await Promise.all([
    env.DB.prepare(`SELECT id, game_id, kind, placeholder_data_url FROM game_images WHERE review_status = 'approved' AND placeholder_data_url IS NULL AND kind IN (${kinds}) LIMIT ?`)
      .bind(...SHOWN_IMAGE_KINDS, DAILY_PLACEHOLDER_COUNT)
      .all<Pick<GameImage, "id" | "game_id" | "kind" | "placeholder_data_url">>(),
    env.DB.prepare("SELECT id, game_id FROM game_shaders WHERE review_status = 'approved' AND placeholder_data_url IS NULL LIMIT ?").bind(DAILY_PLACEHOLDER_COUNT).all<Pick<GameShader, "id" | "game_id">>(),
  ]);
  for (const image of images) await keepImagePlaceholder(env, image);
  for (const shader of shaders.slice(0, Math.max(0, DAILY_PLACEHOLDER_COUNT - images.length))) {
    const still = await env.GAMES.get(shaderStillKey(shader.game_id, shader.id));
    if (still) await keepShaderPlaceholder(env, shader, await still.arrayBuffer());
  }
}

/** What a page needs of a picture's row to show it (ShownPicture): its id, size and placeholder. */
export type PictureRow = Pick<GameImage, "id" | "width_px" | "height_px" | "placeholder_data_url">;

/** The columns of game_images a page reads to show a picture, for a SELECT. */
export const PICTURE_COLUMNS_SQL = "id, width_px, height_px, placeholder_data_url";

/**
 * The newest approved picture of one kind of a game, as one JSON column (read it with pictureFromJson), for a query that lists games:
 * gameIdSql is the SQL naming the game's id (games.id).
 */
export const newestPictureJsonSql = (kind: "cover" | "square", gameIdSql: string) =>
  `(SELECT json_object('id', id, 'width_px', width_px, 'height_px', height_px, 'placeholder_data_url', placeholder_data_url) FROM game_images WHERE game_id = ${gameIdSql} AND kind = '${kind}' AND review_status = 'approved' ORDER BY created_at_ms DESC LIMIT 1)`;

/** A picture's row as a page shows it, at /img/<id> on this site (origin "") or another. */
export const shownPictureOf = (row: PictureRow, origin = ""): ShownPicture => ({
  imageUrl: `${origin}/img/${row.id}`,
  widthPx: row.width_px,
  heightPx: row.height_px,
  placeholderDataUrl: row.placeholder_data_url,
});

/** A picture read with newestPictureJsonSql, or null for none. */
export const pictureFromJson = (json: string | null): ShownPicture | null => (json ? shownPictureOf(JSON.parse(json) as PictureRow) : null);
