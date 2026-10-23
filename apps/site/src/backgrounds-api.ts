import {
  ApiError,
  BACKGROUND_IMAGE_KINDS,
  BACKGROUND_SCREENS,
  BACKGROUND_SOURCES,
  SHADER_BUFFER_NAMES,
  SHADER_LIMITS,
  addShader,
  audit,
  backgroundsFor,
  checkIdKind,
  checkShaderManifest,
  dropChosenBackground,
  imageById,
  iso,
  newId,
  readQualityChecks,
  readReviewReason,
  reviewReasonAnswer,
  setBackground,
  shaderById,
  shaderKey,
  shaderKeys,
  shaderManifestKey,
  shaderPassesInDrawOrder,
  shaderReadsQuality,
  shaderTextureImageIds,
  shadersForGame,
  shaderFrameKey,
  shaderStillKey,
  type BackgroundScreen,
  type BackgroundSource,
  type ErrorCode,
  type Game,
  type GameBackground,
  type GameImage,
  type GameShader,
  type ShaderManifest,
} from "@zaisma/core";
import type { Caller, CheckedCall, NextStep } from "./developer.ts";
import type { Env } from "./env.ts";
import { logCallerEvent } from "./security-log.ts";
import { countShaderCheck, runShaderDraft, shaderCheckAllowance, shaderCheckDeps, shaderManifestOf } from "./shader-check.ts";

/**
 * A game's backgrounds through the developer API (Backgrounds in docs/DEVELOPER-API.md): what each screen shows behind
 * Zaisma's glass, and the shaders it can show. Pictures are images of kind background and phone_background, and a shader's
 * textures images of kind shader_texture (developer.ts).
 *
 *   POST   /api/dev/games/:slug/shaders            send a shader: { screen, image: { source, channels }, buffers }; it's checked, then can be chosen
 *   POST   /api/dev/games/:slug/shader-checks      the same check before sending, keeping nothing but its sheet picture for a day
 *   DELETE /api/dev/games/:slug/shaders/:shader_id remove one; a screen showing it goes back to its default
 *   PUT    /api/dev/games/:slug/backgrounds/:screen choose what wide or phone shows: { "source", "image_id", "shader_id" }
 *
 * A shader's sources, still and sampled frames are served at /shaders/:id/source.glsl (its image pass), /shaders/:id/buffer-<a…d>.glsl,
 * /shaders/:id/still.png and /shaders/:id/frame-<n>.png (serveShaderFile), and a check's sheet at /shader-checks/<name>.png.
 */

const CANDIDATES_FIX = "get_game lists the game's background images (kinds background and phone_background) and shaders, each with its review_status.";

/** Whether the check saved a still and frames: it drew the shader and image matching cleared them. */
const hasCheckPictures = (shader: GameShader) => shader.checked_at_ms !== null && (shader.review_status !== "rejected" || readReviewReason(shader.review_reason)?.code === "text_on_background");

/** A shader as the API answers it (schemas.ts, SHADER), with what its manifest says: its passes, channels and textures. */
export function shaderJson(env: Env, shader: GameShader, manifest: ShaderManifest | null) {
  const reason = readReviewReason(shader.review_reason);
  const hasPictures = hasCheckPictures(shader);
  const shaderUrl = `${env.SITE_ORIGIN}/shaders/${shader.id}`;
  const buffers = manifest ? shaderPassesInDrawOrder(manifest).filter((pass) => pass.bufferName !== null) : [];
  return {
    id: shader.id,
    screen: shader.screen,
    review_status: shader.review_status,
    review_reason: reason ? reviewReasonAnswer(reason) : null,
    quality_checks: readQualityChecks(shader.quality_checks),
    has_quality_levels: manifest ? shaderReadsQuality(manifest) : false,
    flash_count: shader.flash_count,
    still_url: hasPictures ? `${shaderUrl}/still.png` : null,
    frame_urls: hasPictures ? Array.from({ length: SHADER_LIMITS.sampledFrameCount }, (_, frameIndex) => `${shaderUrl}/frame-${frameIndex}.png`) : [],
    image: { source_url: `${shaderUrl}/source.glsl`, channels: manifest?.image.channels ?? [] },
    buffers: buffers.map((pass) => ({ buffer_name: pass.bufferName!, source_url: `${shaderUrl}/buffer-${pass.bufferName}.glsl`, channels: pass.channels })),
    buffer_count: shader.buffer_count,
    texture_count: shader.texture_count,
    texture_image_ids: manifest ? shaderTextureImageIds(manifest) : [],
    size_bytes: shader.size_bytes,
    created_at: iso(shader.created_at_ms),
  };
}

/** A game's shaders as the API answers them, each with its manifest read from the games bucket. */
export async function shadersAnswer(env: Env, shaders: GameShader[]) {
  return Promise.all(shaders.map(async (shader) => shaderJson(env, shader, await shaderManifestOf(env, shader))));
}

/** One screen's background as the API answers it, with the picture it shows (null for Zaisma's own, and for phone following wide). */
export function backgroundJson(env: Env, background: GameBackground) {
  const stillUrl = background.source === "image" ? `${env.SITE_ORIGIN}/img/${background.image_id}` : background.source === "shader" ? `${env.SITE_ORIGIN}/shaders/${background.shader_id}/still.png` : null;
  return { screen: background.screen, source: background.source, image_id: background.image_id, shader_id: background.shader_id, still_url: stillUrl };
}

/** Both screens' backgrounds, wide first. */
export async function backgroundsAnswer(env: Env, game: Game) {
  const backgrounds = await backgroundsFor(env.DB, game.id);
  return BACKGROUND_SCREENS.map((screen) => backgroundJson(env, backgrounds[screen]));
}

function readScreen(given: unknown, field: string): BackgroundScreen {
  if (!BACKGROUND_SCREENS.includes(given as BackgroundScreen)) {
    throw new ApiError(given === undefined ? "missing_field" : "bad_screen", { message: given === undefined ? `${field} is missing.` : `${field} ${JSON.stringify(given)} isn't wide or phone.`, field, fix: "Give wide (desktops and tablets) or phone (composed for a tall screen)." });
  }
  return given as BackgroundScreen;
}

/** One call, once the router (developer.ts, checkCall) has checked the key, the game, and that the query and body hold only the call's inputs. */
export async function backgroundsRoute(request: Request, env: Env, game: Game, routePath: string, caller: Caller, checked: CheckedCall): Promise<[unknown, number?]> {
  if (routePath === "/games/:slug/shaders") return addShaderRoute(env, game, caller, checked);
  if (routePath === "/games/:slug/shader-checks") return checkShaderRoute(env, game, caller, checked);
  if (routePath === "/games/:slug/shaders/:shader_id") return removeShaderRoute(env, game, checked.pathValues.shader_id!, caller);
  return chooseBackgroundRoute(env, game, checked.pathValues.screen!, caller, checked.body);
}

/**
 * A shader as add_shader and check_shader send it: its screen and its manifest, checked closed, every texture an approved
 * shader_texture of this game.
 */
async function readShaderBody(env: Env, game: Game, body: Record<string, unknown>): Promise<{ screen: BackgroundScreen; manifest: ShaderManifest; sizeBytes: number }> {
  const screen = readScreen(body.screen, "screen");
  const checked = checkShaderManifest({ image: body.image, buffers: body.buffers });
  if ("field" in checked) throw new ApiError((checked.code ?? "bad_shader_channel") as ErrorCode, { message: checked.message, field: checked.field, fix: checked.fix });
  const textures = new Map<string, GameImage | null>();
  const passes = [{ field: "image", pass: checked.image }, ...checked.buffers.map((buffer, bufferIndex) => ({ field: `buffers[${bufferIndex}]`, pass: buffer }))];
  for (const { field, pass } of passes) {
    for (const [channelIndex, channel] of pass.channels.entries()) {
      if (!channel.image_id) continue;
      if (!textures.has(channel.image_id)) textures.set(channel.image_id, await imageById(env.DB, channel.image_id));
      const image = textures.get(channel.image_id)!;
      if (image && image.game_id === game.id && image.kind === "shader_texture" && image.review_status === "approved") continue;
      const why = !image || image.game_id !== game.id ? `${game.slug} has no image with the ID ${channel.image_id}` : image.kind !== "shader_texture" ? `it's a ${image.kind} image, not a shader_texture` : `it's ${image.review_status}, not approved`;
      throw new ApiError("bad_shader_channel", {
        message: `${field}.channels[${channelIndex}] can't read that texture: ${why}.`,
        field: `${field}.channels[${channelIndex}].image_id`,
        fix: "Send the picture with add_image (kind shader_texture) and use its image_id once get_game shows it approved; get_game lists the game's images.",
      });
    }
  }
  const sizeBytes = passes.reduce((totalSizeBytes, { pass }) => totalSizeBytes + new TextEncoder().encode(pass.source).byteLength, 0);
  return { screen, manifest: checked, sizeBytes };
}

async function addShaderRoute(env: Env, game: Game, caller: Caller, checked: CheckedCall): Promise<[unknown, number?]> {
  const { screen, manifest, sizeBytes } = await readShaderBody(env, game, checked.body);
  const id = newId("shader");
  // The image pass's source alone too, the shader's source_url as it always was; the manifest holds the whole shader.
  await env.GAMES.put(shaderKey(game.id, id), manifest.image.source, { httpMetadata: { contentType: "text/plain; charset=utf-8" } });
  await env.GAMES.put(shaderManifestKey(game.id, id), JSON.stringify(manifest), { httpMetadata: { contentType: "application/json" } });
  const shader = await addShader(env.DB, { id, game_id: game.id, screen, size_bytes: sizeBytes, buffer_count: manifest.buffers.length, texture_count: shaderTextureImageIds(manifest).length });
  // A developer trying shader after shader keeps the newest few on each screen, besides the one it shows.
  const backgrounds = await backgroundsFor(env.DB, game.id);
  const unchosen = (await shadersForGame(env.DB, game.id)).filter((candidate) => candidate.screen === screen && candidate.id !== backgrounds.wide.shader_id && candidate.id !== backgrounds.phone.shader_id);
  for (const old of unchosen.slice(SHADER_LIMITS.keptShaderCount)) await deleteShader(env, old);
  await env.SCAN_QUEUE.send({ shaderCheckId: shader.id });
  await audit(env.DB, game.id, "shader-added", `${screen} ${id}${manifest.buffers.length ? `, buffers ${manifest.buffers.map((buffer) => buffer.buffer_name).join(", ")}` : ""}`, caller.actor);
  await logCallerEvent(env, caller, "shader_added", { gameId: game.id, subjectName: screen });
  return [
    {
      shader: shaderJson(env, shader, manifest),
      review_message: "It's drawn and checked in a minute or two: every pass must compile, a frame must draw quickly enough at each quality level it reads, and it mustn't flash, and its frames go through the same safety checks as pictures. Then set_background shows it.",
      next_steps: [{ tool: "get_game", arguments: { slug: game.slug }, after_sec: 60, reason: "The check takes a minute or two: get_game's shaders show whether it passed, with its still, sampled frames and quality_checks. Show the developer the still before choosing it with set_background." }] satisfies NextStep[],
    },
    201,
  ];
}

/** A check before sending: counted against the developer's day before it runs, so one that fails counts too. */
async function checkShaderRoute(env: Env, game: Game, caller: Caller, checked: CheckedCall): Promise<[unknown, number?]> {
  const { screen, manifest } = await readShaderBody(env, game, checked.body);
  const allowance = await shaderCheckAllowance(env, caller.ownerId);
  if (allowance.remainingShaderCheckCount <= 0) {
    throw new ApiError("daily_shader_checks_used", {
      message: `You've run ${SHADER_LIMITS.maximumShaderChecksPerDay} shader checks in the last day, the most an account can.`,
      fix: "Run npx @zaisma/cli check on the shader's folder, which draws it in your own Chrome with no limit; or send it with add_shader, which checks it anyway; or wait until the oldest check is a day old.",
      retryAfterSec: allowance.oldestAtMs === null ? null : Math.max(1, Math.ceil((allowance.oldestAtMs + 24 * 3600_000 - Date.now()) / 1000)),
    });
  }
  const deps = shaderCheckDeps(env);
  if (!deps) throw new ApiError("shader_check_unavailable", { message: "Zaisma can't draw shaders here right now.", fix: "Run npx @zaisma/cli check on the shader's folder, which draws it in your own Chrome; or send it with add_shader, which waits for its check." });
  await countShaderCheck(env, caller.ownerId);
  const shaderCheck = await runShaderDraft(env, game, screen, manifest, deps);
  const isPassing = !shaderCheck.compile_error && shaderCheck.quality_checks.length > 0 && shaderCheck.quality_checks.every((qualityCheck) => qualityCheck.check_frame_ms <= qualityCheck.maximum_check_frame_ms) && (shaderCheck.flash_count ?? 0) <= SHADER_LIMITS.maximumFlashCountPerSec;
  return [
    {
      shader_check: shaderCheck,
      remaining_shader_check_count: allowance.remainingShaderCheckCount - 1,
      next_steps: (isPassing
        ? [{ tool: "add_shader", arguments: { slug: game.slug, screen }, after_sec: null, reason: "It compiled, keeps to every limit and doesn't flash: once the sheet looks right (and its notes are dealt with or don't matter), send the same image and buffers with add_shader." }]
        : []) satisfies NextStep[],
    },
  ];
}

async function deleteShader(env: Env, shader: GameShader): Promise<void> {
  await env.GAMES.delete(shaderKeys(shader.game_id, shader.id));
  await dropChosenBackground(env.DB, shader.game_id, { shaderId: shader.id });
  await env.DB.prepare("DELETE FROM game_shaders WHERE id = ?").bind(shader.id).run();
}

async function removeShaderRoute(env: Env, game: Game, shaderId: string, caller: Caller): Promise<[unknown, number?]> {
  const fix = "get_game lists the game's shaders with their IDs.";
  checkIdKind("shader", shaderId, "shader_id", fix);
  const shader = await shaderById(env.DB, shaderId);
  if (!shader || shader.game_id !== game.id) throw new ApiError("no_shader", { message: `${game.slug} has no shader with the ID ${shaderId}.`, field: "shader_id", fix });
  await deleteShader(env, shader);
  await audit(env.DB, game.id, "shader-removed", `${shader.screen} ${shader.id}`, caller.actor);
  await logCallerEvent(env, caller, "shader_removed", { gameId: game.id, subjectName: shader.screen });
  return [{ removed_shader_id: shader.id, backgrounds: await backgroundsAnswer(env, game), next_steps: [] satisfies NextStep[] }];
}

/** The shaders the game keeps that read a texture: it can't be removed while one does, or they'd draw it black. */
export async function shadersReadingTexture(env: Env, gameId: string, imageId: string): Promise<GameShader[]> {
  const reading: GameShader[] = [];
  for (const shader of await shadersForGame(env.DB, gameId)) {
    if (shader.texture_count === 0 || shader.review_status === "rejected") continue;
    const manifest = await shaderManifestOf(env, shader);
    if (manifest && shaderTextureImageIds(manifest).includes(imageId)) reading.push(shader);
  }
  return reading;
}

async function chooseBackgroundRoute(env: Env, game: Game, screenGiven: string, caller: Caller, body: Record<string, unknown>): Promise<[unknown, number?]> {
  const screen = readScreen(screenGiven, "screen");
  const source = body.source as BackgroundSource;
  if (!BACKGROUND_SOURCES.includes(source) || (source === "wide" && screen !== "phone")) {
    throw new ApiError("bad_background_source", {
      message: source === "wide" ? "source wide means phones show the wide background, so only phone takes it." : `source ${JSON.stringify(body.source ?? null)} isn't zaisma, image or shader${screen === "phone" ? ", or wide" : ""}.`,
      field: "source",
      fix: `Give image with an image_id, shader with a shader_id, or zaisma for Zaisma's own${screen === "phone" ? "; or wide, to show the wide background on phones too" : ""}.`,
    });
  }
  for (const [name, belongsTo] of [["image_id", "image"], ["shader_id", "shader"]] as const) {
    const given = body[name];
    if (source === belongsTo && (typeof given !== "string" || !given)) {
      throw new ApiError("background_not_ready", { message: `source ${source} needs ${name}.`, field: name, fix: CANDIDATES_FIX });
    }
    if (source !== belongsTo && given !== undefined && given !== null) {
      throw new ApiError("bad_background_source", { message: `${name} goes only with source ${belongsTo}, and source is ${source}.`, field: name, fix: `Leave ${name} out, or give source ${belongsTo}.` });
    }
  }
  const imageId = source === "image" ? (body.image_id as string) : null;
  const shaderId = source === "shader" ? (body.shader_id as string) : null;
  if (imageId) {
    checkIdKind("image", imageId, "image_id", CANDIDATES_FIX);
    const image = await imageById(env.DB, imageId);
    const kind = BACKGROUND_IMAGE_KINDS[screen];
    if (!image || image.game_id !== game.id || image.kind !== kind || image.review_status !== "approved") {
      const why = !image || image.game_id !== game.id ? `${game.slug} has no image with the ID ${imageId}` : image.kind !== kind ? `it's a ${image.kind} image, and ${screen} shows ${kind} images` : `it's ${image.review_status}, not approved`;
      throw new ApiError("background_not_ready", { message: `That image can't be the ${screen} background: ${why}.`, field: "image_id", fix: `${CANDIDATES_FIX} Add one with add_image (kind ${kind}) and wait for it to pass.` });
    }
  }
  if (shaderId) {
    checkIdKind("shader", shaderId, "shader_id", CANDIDATES_FIX);
    const shader = await shaderById(env.DB, shaderId);
    if (!shader || shader.game_id !== game.id || shader.screen !== screen || shader.review_status !== "approved") {
      const why = !shader || shader.game_id !== game.id ? `${game.slug} has no shader with the ID ${shaderId}` : shader.screen !== screen ? `it was sent for ${shader.screen}` : `it's ${shader.review_status}, not approved`;
      throw new ApiError("background_not_ready", { message: `That shader can't be the ${screen} background: ${why}.`, field: "shader_id", fix: `${CANDIDATES_FIX} Send one for ${screen} with add_shader and wait for it to pass.` });
    }
  }
  const background = await setBackground(env.DB, game.id, screen, source, imageId, shaderId);
  await audit(env.DB, game.id, "background-chosen", `${screen}: ${source}${imageId ? ` ${imageId}` : ""}${shaderId ? ` ${shaderId}` : ""}`, caller.actor);
  await logCallerEvent(env, caller, "background_chosen", { gameId: game.id, subjectName: `${screen} ${source}` });
  return [{ background: backgroundJson(env, background), next_steps: [] satisfies NextStep[] }];
}

/**
 * A shader's sources, still or a sampled frame (/shaders/:id/source.glsl, /shaders/:id/buffer-<a…d>.glsl, /shaders/:id/still.png,
 * /shaders/:id/frame-<n>.png): owner-only and never cached until it's approved. The sources are for the dashboard's live preview;
 * players' browsers get the shader from the game's site.
 */
export async function serveShaderFile(request: Request, env: Env, filePath: string, isOwner: (gameOwnerId: string | null) => Promise<boolean>): Promise<Response> {
  const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const match = filePath.match(/^(shader_[a-z0-9]+)\/(?:(source|buffer-[a-d])\.glsl|(still|frame-(\d))\.png)$/);
  if (!match || (request.method !== "GET" && request.method !== "HEAD")) return notFound();
  const shader = await shaderById(env.DB, match[1]!);
  const sourceName = match[2];
  if (!shader || (!sourceName && !hasCheckPictures(shader))) return notFound();
  const frameIndex = match[4] === undefined ? null : Number(match[4]);
  if (frameIndex !== null && frameIndex >= SHADER_LIMITS.sampledFrameCount) return notFound();
  const game = await env.DB.prepare("SELECT review_status, owner_id FROM games WHERE id = ?").bind(shader.game_id).first<{ review_status: string; owner_id: string | null }>();
  if (!game) return notFound();
  let cacheControl = "public, max-age=3600";
  if (shader.review_status !== "approved" || game.review_status === "removed") {
    if (!(await isOwner(game.owner_id))) return notFound();
    cacheControl = "private, no-store";
  }
  const headers = (contentType: string, sizeBytes: number) => ({ "Content-Type": contentType, "Content-Length": String(sizeBytes), "Cache-Control": cacheControl, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Disposition": "inline" });
  // A buffer's source is in the manifest.
  if (sourceName?.startsWith("buffer-")) {
    const bufferName = sourceName.slice("buffer-".length);
    const buffer = SHADER_BUFFER_NAMES.includes(bufferName as (typeof SHADER_BUFFER_NAMES)[number]) ? (await shaderManifestOf(env, shader))?.buffers.find((each) => each.buffer_name === bufferName) : undefined;
    if (!buffer) return notFound();
    const bytes = new TextEncoder().encode(buffer.source);
    return new Response(request.method === "HEAD" ? null : bytes, { headers: headers("text/plain; charset=utf-8", bytes.byteLength) });
  }
  const stored = await env.GAMES.get(sourceName ? shaderKey(shader.game_id, shader.id) : frameIndex === null ? shaderStillKey(shader.game_id, shader.id) : shaderFrameKey(shader.game_id, shader.id, frameIndex));
  if (!stored) return notFound();
  return new Response(request.method === "HEAD" ? null : stored.body, { headers: headers(sourceName ? "text/plain; charset=utf-8" : "image/png", stored.size) });
}
