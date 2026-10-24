import { shaderManifestOf } from "./shader-check.ts";
import { ApiError, gameSaves, imagesForGame, iso, shaderKey, shadersForGame, versionsForGame, type Game, type GameImage, type GameShader, type Version } from "@zaisma/core";
import type { Caller } from "./developer.ts";
import type { Env } from "./env.ts";
import { databaseDumpPart } from "./game-database.ts";
import { exportedSave } from "./saves-api.ts";
import { versionFiles } from "./scan.ts";
import { logCallerEvent } from "./security-log.ts";
import { zipStream, type ZipSource } from "./zip-writer.ts";

/**
 * Export everything (docs/DECISIONS.md, "Export everything"): everything about a game as one .zip,
 * written while it downloads, so nothing is stored and there's nothing to wait for.
 *
 *   GET /api/dev/games/:slug/export            what's in it, and download_url: the link any AI hands the developer
 *   GET /api/dev/games/:slug/export/download   the .zip, for an API key (zaisma export)
 *   GET /dashboard/:slug/export.zip            the .zip, for the game's owner signed in (download_url)
 *
 * The JSON in it is what the API answers, made through the same calls, so the two never disagree. Only
 * versions and images that passed review carry their files; the rest are listed with none, so nothing
 * unscanned or held leaves through it. Secrets come by name, never by value.
 */

/** Makes a developer API call as the caller and answers its JSON (developer.ts, apiCall). */
export type ApiRead = (method: "GET", path: string) => Promise<Record<string, unknown>>;

/** Saves read from storage at once, a page at a time. */
const SAVE_PAGE_COUNT = 100;
/** Files fetched ahead of the one being sent, so the download doesn't wait on each. */
const FILES_AHEAD_COUNT = 4;

/** Whether a version's files go in the export: it passed review and no report is pausing it. */
const hasFiles = (version: Version) => version.scan_status === "approved" && !(version.report_held_at_ms && !version.cleared_at_ms);
const imageHasFile = (image: GameImage) => image.review_status === "approved";
const shaderHasFile = (shader: GameShader) => shader.review_status === "approved";
const shaderPath = (shader: GameShader) => `shaders/${shader.screen}-${shader.id}.glsl`;

/** GET /games/:slug/export: what the .zip holds, the link to it and the command that saves it as a folder. */
export async function exportSummary(env: Env, game: Game) {
  const [versions, images, shaders, saves] = await Promise.all([
    versionsForGame(env.DB, game.id),
    imagesForGame(env.DB, game.id),
    shadersForGame(env.DB, game.id),
    env.DB.prepare("SELECT COUNT(*) AS save_count FROM saves WHERE game_id = ?").bind(game.id).first<{ save_count: number }>(),
  ]);
  const withFiles = versions.filter(hasFiles);
  const shownImages = images.filter(imageHasFile);
  return {
    export: {
      download_url: `${env.SITE_ORIGIN}/dashboard/${game.slug}/export.zip`,
      command: `npx @zaisma/cli export ${game.slug}`,
      version_count: withFiles.length,
      withheld_version_count: versions.length - withFiles.length,
      image_count: shownImages.length,
      withheld_image_count: images.length - shownImages.length,
      shader_count: shaders.filter(shaderHasFile).length,
      save_count: saves?.save_count ?? 0,
      files_size_bytes: withFiles.reduce((total, version) => total + version.size_bytes, 0) + shownImages.reduce((total, image) => total + image.size_bytes, 0),
    },
  };
}

/** The .zip itself, streamed. Each export is a line in the game's history, and an account starts at most a couple a minute. */
export async function exportDownload(env: Env, game: Game, caller: Caller, read: ApiRead): Promise<Response> {
  if (env.EXPORT_LIMIT && !(await env.EXPORT_LIMIT.limit({ key: caller.accountId })).success) {
    throw new ApiError("slow_down", { message: "This account started two exports in the last minute.", fix: "Wait a minute, then download it again. The export is always of the game as it is right then." });
  }
  await logCallerEvent(env, caller, "game_exported", { gameId: game.id });
  const exportedAtMs = Date.now();
  const date = new Date(exportedAtMs).toISOString().slice(0, 10);
  return new Response(zipStream(exportSources(env, game, read, exportedAtMs)), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${game.slug}-${date}.zip"`,
      "cache-control": "no-store",
    },
  });
}

async function* exportSources(env: Env, game: Game, read: ApiRead, exportedAtMs: number): AsyncGenerator<ZipSource> {
  const slug = game.slug;
  const file = (path: string, bytes: Uint8Array | ReadableStream<Uint8Array>, modifiedAtMs = exportedAtMs): ZipSource => ({ path, bytes, modifiedAtMs });
  const jsonFile = (path: string, contents: unknown) => file(path, new TextEncoder().encode(`${JSON.stringify(contents, null, 2)}\n`));

  const [gameAnswer, secretsAnswer, versions, images, shaders] = await Promise.all([read("GET", `/games/${slug}`), read("GET", `/games/${slug}/secrets`), versionsForGame(env.DB, game.id), imagesForGame(env.DB, game.id), shadersForGame(env.DB, game.id)]);
  const shadersWithFiles = new Map(shaders.filter(shaderHasFile).map((shader) => [shader.id, shader]));
  const versionsWithFiles = new Set(versions.filter(hasFiles).map((version) => version.id));
  const imagesWithFiles = new Map(images.filter(imageHasFile).map((image) => [image.id, image]));

  yield file("README.txt", new TextEncoder().encode(readme(game, exportedAtMs)));
  yield jsonFile("game.json", {
    exported_at: iso(exportedAtMs),
    game: gameAnswer.game,
    images: (gameAnswer.images as { id: string }[]).map((image) => ({ ...image, file_path: imagesWithFiles.has(image.id) ? imagePath(imagesWithFiles.get(image.id)!) : null })),
    backgrounds: gameAnswer.backgrounds,
    shaders: (gameAnswer.shaders as { id: string }[]).map((shader) => ({ ...shader, file_path: shadersWithFiles.has(shader.id) ? shaderPath(shadersWithFiles.get(shader.id)!) : null })),
    testers: gameAnswer.testers,
    secrets: secretsAnswer.secrets,
  });
  // A preview link is the developer's own for a day: it stays out of a file they may share.
  yield jsonFile("versions.json", {
    versions: (gameAnswer.versions as Record<string, unknown>[]).map((version) => {
      const shown: Record<string, unknown> = { ...version, folder_path: versionsWithFiles.has(version.id as string) ? `versions/${version.id}/` : null };
      delete shown.preview_url;
      delete shown.preview_url_expires_at;
      return shown;
    }),
  });

  // A file storage can't find is listed at the end instead of breaking the whole download.
  const missingPaths: string[] = [];
  for (const version of versions) {
    if (!versionsWithFiles.has(version.id)) continue;
    const stored = await versionFiles(env, version);
    const ahead: Promise<R2ObjectBody | null>[] = [];
    for (let i = 0; i < stored.length; i++) {
      while (ahead.length < FILES_AHEAD_COUNT && i + ahead.length < stored.length) ahead.push(env.GAMES.get(stored[i + ahead.length]!.key));
      const object = await ahead.shift()!;
      if (!object) {
        missingPaths.push(`versions/${version.id}/${stored[i]!.path}`);
        continue;
      }
      yield file(`versions/${version.id}/${stored[i]!.path}`, object.body, version.created_at_ms);
    }
  }

  for (const image of imagesWithFiles.values()) {
    const object = await env.GAMES.get(`images/${image.game_id}/${image.id}`);
    if (object) yield file(imagePath(image), object.body, image.created_at_ms);
    else missingPaths.push(imagePath(image));
  }

  for (const shader of shadersWithFiles.values()) {
    const object = await env.GAMES.get(shaderKey(shader.game_id, shader.id));
    if (object) yield file(shaderPath(shader), object.body, shader.created_at_ms);
    else missingPaths.push(shaderPath(shader));
    // Its buffers, each a file beside it; what every pass's channels read is in game.json.
    if (!shader.buffer_count) continue;
    for (const buffer of (await shaderManifestOf(env, shader))?.buffers ?? []) yield file(shaderPath(shader).replace(/\.glsl$/, `.buffer-${buffer.buffer_name}.glsl`), new TextEncoder().encode(buffer.source), shader.created_at_ms);
  }

  yield file("database.sql", databaseDump(env, game));
  yield file("saves.jsonl", savesLines(env, game));
  yield jsonFile("stats.json", await read("GET", `/games/${slug}/stats?period_duration_days=90`));
  yield jsonFile("reports.json", await read("GET", `/games/${slug}/reports`));
  yield jsonFile("history.json", await read("GET", `/games/${slug}/history`));
  if (missingPaths.length) {
    const text = `These files couldn't be read from Zaisma's storage, so they aren't in this export. Tell Zaisma (message_zaisma, or zaisma forum message) with this list:\n\n${missingPaths.join("\n")}\n`;
    yield file("MISSING.txt", new TextEncoder().encode(text));
  }
}

const IMAGE_EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const imagePath = (image: GameImage) => `images/${image.kind}-${image.id}.${IMAGE_EXTENSIONS[image.content_type] ?? "bin"}`;

/** The game's database as SQLite's SQL dump, part after part, the same text export_database answers. */
function databaseDump(env: Env, game: Game): ReadableStream<Uint8Array> {
  let cursor: string | null = null;
  let isDone = false;
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (isDone) return controller.close();
      const part = await databaseDumpPart(env, game, cursor);
      cursor = part.nextCursor;
      isDone = !cursor;
      controller.enqueue(encoder.encode(part.dumpSql));
    },
  });
}

/** Every player's save, one JSON line each, as get_save answers it. */
function savesLines(env: Env, game: Game): ReadableStream<Uint8Array> {
  let afterPlayerId: string | null = null;
  let isDone = false;
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (isDone) return controller.close();
      const rows = await gameSaves(env.DB, game.id, afterPlayerId, SAVE_PAGE_COUNT);
      const page = rows.slice(0, SAVE_PAGE_COUNT);
      isDone = rows.length <= SAVE_PAGE_COUNT;
      afterPlayerId = page.at(-1)?.player_id ?? null;
      const saves = await Promise.all(page.map((row) => exportedSave(env, game, row)));
      const lines = saves.filter((save) => save !== null).map((save) => `${JSON.stringify(save)}\n`);
      controller.enqueue(encoder.encode(lines.join("")));
    },
  });
}

function readme(game: Game, exportedAtMs: number): string {
  return `${game.title}: everything about it on Zaisma, exported ${iso(exportedAtMs)}.

game.json        The game's details, its images, backgrounds, tester links and the names of its secrets
                 (never their values: set them again wherever the game server runs).
versions.json    Every version Zaisma keeps, with its patch notes and review status. folder_path
                 is where its files are, or null for a version that hasn't passed review.
versions/        Each version's files, by version ID, as they were uploaded.
images/          The cover, screenshots, background pictures and shader textures that passed review.
shaders/         The background shaders that passed their check: each image pass as a .glsl file, and its
                 buffers beside it (.buffer-a.glsl to .buffer-d.glsl). game.json says what each pass's
                 channels read; their textures are in images/.
database.sql     The game's own database, as SQLite's SQL dump. Make it a database file with
                 sqlite3 database.sqlite < database.sql (zaisma export does this for you).
saves.jsonl      Every player's cloud save, one JSON line each, as get_save answers it.
stats.json       Plays and players over the last 90 days.
reports.json     Player reports and bug reports, as get_reports answers them.
history.json     What happened to the game, as get_history answers it.

To run it on your own server: serve the live version's folder (versions.json says which is live),
and start its game server with @zaisma/game-server's Node runner and --database-file database.sqlite
(Zaisma's README, "Run your game server yourself", says how).
docs/DEVELOPER-API.md, "Export everything", has the details.
`;
}
