import {
  ApiError,
  BACKGROUND_IMAGE_KINDS,
  BACKGROUND_SCREENS,
  BACKGROUND_SOURCES,
  SHADER_LIMITS,
  addShader,
  audit,
  backgroundsFor,
  checkIdKind,
  dropChosenBackground,
  imageById,
  iso,
  newId,
  readReviewReason,
  reviewReasonAnswer,
  setBackground,
  shaderById,
  shaderKey,
  shaderKeys,
  shadersForGame,
  shaderSourceProblem,
  shaderFrameKey,
  shaderStillKey,
  type BackgroundScreen,
  type BackgroundSource,
  type Game,
  type GameBackground,
  type GameShader,
} from "@zaisma/core";
import type { Caller, CheckedCall, NextStep } from "./developer.ts";
import type { Env } from "./env.ts";
import { logCallerEvent } from "./security-log.ts";

/**
 * A game's backgrounds through the developer API (Backgrounds in docs/DEVELOPER-API.md): what each screen shows behind
 * Zaisma's glass, and the shaders it can show. Pictures are images of kind background and phone_background (developer.ts).
 *
 *   POST   /api/dev/games/:slug/shaders?screen=        send a shader (the GLSL text as the body); it's checked, then can be chosen
 *   DELETE /api/dev/games/:slug/shaders/:shader_id     remove one; a screen showing it goes back to its default
 *   PUT    /api/dev/games/:slug/backgrounds/:screen    choose what wide or phone shows: { "source", "image_id", "shader_id" }
 *
 * A shader's source, still and sampled frames are served at /shaders/:id/source.glsl, /shaders/:id/still.png and
 * /shaders/:id/frame-<n>.png (serveShaderFile).
 */

const CANDIDATES_FIX = "get_game lists the game's background images (kinds background and phone_background) and shaders, each with its review_status.";

/** Whether the check saved a still and frames: it drew the shader and image matching cleared them. */
const hasCheckPictures = (shader: GameShader) => shader.checked_at_ms !== null && (shader.review_status !== "rejected" || readReviewReason(shader.review_reason)?.code === "text_on_background");

export function shaderJson(env: Env, shader: GameShader) {
  const reason = readReviewReason(shader.review_reason);
  const hasPictures = hasCheckPictures(shader);
  return {
    id: shader.id,
    screen: shader.screen,
    review_status: shader.review_status,
    review_reason: reason ? reviewReasonAnswer(reason) : null,
    check_frame_ms: shader.check_frame_ms,
    flash_count: shader.flash_count,
    still_url: hasPictures ? `${env.SITE_ORIGIN}/shaders/${shader.id}/still.png` : null,
    frame_urls: hasPictures ? Array.from({ length: SHADER_LIMITS.sampledFrameCount }, (_, frameIndex) => `${env.SITE_ORIGIN}/shaders/${shader.id}/frame-${frameIndex}.png`) : [],
    source_url: `${env.SITE_ORIGIN}/shaders/${shader.id}/source.glsl`,
    size_bytes: shader.size_bytes,
    created_at: iso(shader.created_at_ms),
  };
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
    throw new ApiError("bad_screen", { message: `${field} ${JSON.stringify(given ?? null)} isn't wide or phone.`, field, fix: "Give wide (desktops and tablets) or phone (composed for a tall screen)." });
  }
  return given as BackgroundScreen;
}

/** One call, once the router (developer.ts, checkCall) has checked the key, the game, and that the query and body hold only the call's inputs. */
export async function backgroundsRoute(request: Request, env: Env, game: Game, routePath: string, caller: Caller, checked: CheckedCall): Promise<[unknown, number?]> {
  if (routePath === "/games/:slug/shaders") return addShaderRoute(request, env, game, caller, checked);
  if (routePath === "/games/:slug/shaders/:shader_id") return removeShaderRoute(env, game, checked.pathValues.shader_id!, caller);
  return chooseBackgroundRoute(env, game, checked.pathValues.screen!, caller, checked.body);
}

async function addShaderRoute(request: Request, env: Env, game: Game, caller: Caller, checked: CheckedCall): Promise<[unknown, number?]> {
  const screen = readScreen(checked.query.get("screen") ?? undefined, "screen");
  const tooBig = () => new ApiError("shader_too_big", { message: `The shader is over ${SHADER_LIMITS.maximumSizeBytes / 1024} KB.`, field: "source", fix: "A background shader is one mainImage function: take out unused functions and long comments, or do less in it." });
  if (Number(request.headers.get("content-length") ?? 0) > SHADER_LIMITS.maximumSizeBytes) throw tooBig();
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > SHADER_LIMITS.maximumSizeBytes) throw tooBig();
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    source = "";
  }
  const problem = source ? shaderSourceProblem(source) : "It isn't UTF-8 text.";
  if (problem) {
    throw new ApiError("not_a_shader", {
      message: `That isn't a background shader: ${problem}`,
      field: "source",
      fix: "Send Shadertoy's form: void mainImage(out vec4 fragColor, in vec2 fragCoord), reading iResolution (pixels) and iTime (seconds) only, with no main(), textures, #version or #extension lines.",
    });
  }

  const id = newId("shader");
  await env.GAMES.put(shaderKey(game.id, id), bytes, { httpMetadata: { contentType: "text/plain; charset=utf-8" } });
  const shader = await addShader(env.DB, { id, game_id: game.id, screen, size_bytes: bytes.byteLength });
  // A developer trying shader after shader keeps the newest few on each screen, besides the one it shows.
  const backgrounds = await backgroundsFor(env.DB, game.id);
  const unchosen = (await shadersForGame(env.DB, game.id)).filter((candidate) => candidate.screen === screen && candidate.id !== backgrounds.wide.shader_id && candidate.id !== backgrounds.phone.shader_id);
  for (const old of unchosen.slice(SHADER_LIMITS.keptShaderCount)) await deleteShader(env, old);
  await env.SCAN_QUEUE.send({ shaderCheckId: shader.id });
  await audit(env.DB, game.id, "shader-added", `${screen} ${id}`, caller.actor);
  await logCallerEvent(env, caller, "shader_added", { gameId: game.id, subjectName: screen });
  return [
    {
      shader: shaderJson(env, shader),
      review_message: "It's drawn and checked in about a minute: it must compile, draw a frame quickly enough and not flash, and its frames go through the same safety checks as pictures. Then set_background shows it.",
      next_steps: [{ tool: "get_game", arguments: { slug: game.slug }, after_sec: 60, reason: "The check takes about a minute: get_game's shaders show whether it passed, with its still, sampled frames and check_frame_ms. Show the developer the still before choosing it with set_background." }] satisfies NextStep[],
    },
    201,
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
 * A shader's source, still or a sampled frame (/shaders/:id/source.glsl, /shaders/:id/still.png, /shaders/:id/frame-<n>.png): owner-only
 * and never cached until it's approved. The source is for the dashboard's live preview; players' browsers get it from the game's site.
 */
export async function serveShaderFile(request: Request, env: Env, filePath: string, isOwner: (gameOwnerId: string | null) => Promise<boolean>): Promise<Response> {
  const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const match = filePath.match(/^(shader_[a-z0-9]+)\/(?:(source)\.glsl|(still|frame-(\d))\.png)$/);
  if (!match || (request.method !== "GET" && request.method !== "HEAD")) return notFound();
  const shader = await shaderById(env.DB, match[1]!);
  const isSource = match[2] === "source";
  if (!shader || (!isSource && !hasCheckPictures(shader))) return notFound();
  const frameIndex = match[4] === undefined ? null : Number(match[4]);
  if (frameIndex !== null && frameIndex >= SHADER_LIMITS.sampledFrameCount) return notFound();
  const game = await env.DB.prepare("SELECT review_status, owner_id FROM games WHERE id = ?").bind(shader.game_id).first<{ review_status: string; owner_id: string | null }>();
  if (!game) return notFound();
  let cacheControl = "public, max-age=3600";
  if (shader.review_status !== "approved" || game.review_status === "removed") {
    if (!(await isOwner(game.owner_id))) return notFound();
    cacheControl = "private, no-store";
  }
  const stored = await env.GAMES.get(isSource ? shaderKey(shader.game_id, shader.id) : frameIndex === null ? shaderStillKey(shader.game_id, shader.id) : shaderFrameKey(shader.game_id, shader.id, frameIndex));
  if (!stored) return notFound();
  return new Response(request.method === "HEAD" ? null : stored.body, {
    headers: { "Content-Type": isSource ? "text/plain; charset=utf-8" : "image/png", "Content-Length": String(stored.size), "Cache-Control": cacheControl, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Disposition": "inline" },
  });
}
