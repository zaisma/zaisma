import {
  UploadError,
  audit,
  checkSlug,
  contentTypeFor,
  createGame,
  createVersion,
  gameBySlug,
  listGameFiles,
  newId,
  slugify,
  unpackGameFiles,
  updateGameInfo,
  type Game,
  isSlugRetired,
} from "@zaisma/core";
import type { Env } from "./env.ts";

export interface UploadResult {
  game: Game;
  versionId: string;
  fileCount: number;
  sizeBytes: number;
}

/**
 * Store a game zip as a new version and queue it for scanning. Uploading to an
 * existing slug adds a version; players keep the old one until the new one passes.
 * Shared by the admin form and POST /admin/api/games (the future publish skill).
 */
export async function uploadGame(env: Env, form: FormData, actor: string): Promise<UploadResult> {
  const title = String(form.get("title") ?? "").trim().slice(0, 80);
  const description = String(form.get("description") ?? "").trim().slice(0, 500);
  const slug = String(form.get("slug") ?? "").trim().toLowerCase() || slugify(title);
  const file = form.get("zip");

  if (!title) throw new UploadError("Give the game a title.");
  const slugError = checkSlug(slug);
  if (slugError) throw new UploadError(`Link name: ${slugError}`);
  if (!file || typeof file === "string") throw new UploadError("Attach the game as a .zip file.");

  const zip = new Uint8Array(await file.arrayBuffer());
  const entries = listGameFiles(zip);

  const existing = await gameBySlug(env.DB, slug);
  if (!existing && (await isSlugRetired(env.DB, slug))) throw new UploadError(`Link name: zaisma.com/g/${slug} was a game that was deleted; its link never goes to another game.`);
  const game = existing ?? (await createGame(env.DB, { slug, title, description }));
  if (existing) await updateGameInfo(env.DB, existing.id, { title, description });

  const versionId = newId("version");
  const prefix = `games/${game.id}/${versionId}`;
  let sizeBytes = 0;
  try {
    for (const batch of unpackGameFiles(zip, entries)) {
      await Promise.all(
        batch.map((file) => {
          sizeBytes += file.bytes.byteLength;
          return env.GAMES.put(`${prefix}/${file.path}`, file.bytes, { httpMetadata: { contentType: contentTypeFor(file.path) } });
        }),
      );
    }
  } catch (error) {
    await deletePrefix(env.GAMES, prefix);
    if (!existing) await env.DB.prepare("DELETE FROM games WHERE id = ?").bind(game.id).run();
    throw error;
  }

  await createVersion(env.DB, { id: versionId, gameId: game.id, r2Prefix: prefix, fileCount: entries.length, sizeBytes });
  await audit(env.DB, game.id, "upload", `${versionId}, ${entries.length} files`, actor);
  await env.SCAN_QUEUE.send({ versionId });
  return { game: { ...game, title, description }, versionId, fileCount: entries.length, sizeBytes };
}

export async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const list = await bucket.list({ prefix: `${prefix}/`, cursor });
    if (list.objects.length) await bucket.delete(list.objects.map((object) => object.key));
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
}
