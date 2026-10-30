import puppeteer from "@cloudflare/puppeteer";
import {
  KNOWN_IMAGE_CODE,
  SHADER_LIMITS,
  audit,
  gameById,
  heldImageKey,
  imageById,
  imageKey,
  iso,
  reviewReason,
  setBackgroundTone,
  settleShader,
  shaderById,
  shaderFrameKey,
  shaderKey,
  shaderManifestFromSource,
  shaderManifestKey,
  shaderStillKey,
  shaderTextureImageIds,
  type BackgroundScreen,
  type Game,
  type GameShader,
  type ImageMatcher,
  type ReviewReason,
  type ShaderCheckJob,
  type ShaderManifest,
  type ShaderQualityCheck,
} from "@zaisma/core";
import {
  SHADER_CHECK_PAGE,
  compileMessage,
  measureQualityLevels,
  mostFlashes,
  shaderCheckPageExpressions,
  shaderDraftAnswer,
  shaderRenderFromPage,
  shaderRenderInputOf,
  toneOfPng,
  type ShaderCheckAnswer,
  type ShaderPageDrawing,
  type ShaderRender,
  type ShaderRenderInput,
} from "../../../packages/cli/shader-check.mjs";
import { sendAlert } from "./email.ts";
import type { Env } from "./env.ts";
import { judgeShaderPictures } from "./listing-check.ts";
import type { ListingJudge } from "./listing-judge.ts";
import { KNOWN_IMAGE_ALERT, imageMatcher } from "./scan.ts";

/**
 * The shader check (Backgrounds in docs/DEVELOPER-API.md): every shader a game sends for its background is drawn before anyone
 * sees it, on Cloudflare Browser Rendering (headless Chromium, WebGL2 through SwiftShader), in a blank page that loads nothing.
 * Every pass must compile; its frames are drawn in order from iTime 0, buffers then the image pass each frame, and timed at each
 * quality level the shader reads (each median against that level's most) and their brightness read for flashes (WCAG 2.3.1: no more
 * than three in any one second); then a still frame and sampled frames are saved and go through the safety checks pictures get, image
 * matching and the listing check. Upload queues { shaderCheckId } on the scan queue. The same drawing, run before anything is sent
 * (runShaderDraft), answers with a sheet picture of the shader under Zaisma's glass and notes that never hold it.
 *
 * The drawing itself (the check's page, what it's given, and how its timings, flashes, glass and notes are read) is in
 * packages/cli/shader-check.mjs, which `zaisma check` runs in a local Chrome, so a shader checked at home is checked the same way.
 */
export {
  CHECK_REFERENCE_SHADER,
  SAMPLED_TIMES_SEC,
  SHIMMER_LIMITS,
  THICK_GLASS_TINT_PCT,
  checkSizes,
  frameShimmer,
  measureQualityLevels,
  mostFlashesInOneSecond,
  shaderCheckNotes,
  type ShaderCheckAnswer,
  type ShaderCheckNote,
  type ShaderLevelRender,
  type ShaderRender,
  type ShaderRenderInput,
} from "../../../packages/cli/shader-check.mjs";
import { recordRestoreEvent } from "./restore-events.ts";

export type ShaderRenderer = (input: ShaderRenderInput) => Promise<ShaderRender>;

/** The renderer on Cloudflare Browser Rendering (the BROWSER binding): one browser per shader, closed after. */
export function browserShaderRenderer(browserBinding: Fetcher): ShaderRenderer {
  return async (input) => {
    const browser = await puppeteer.launch(browserBinding);
    try {
      const page = await browser.newPage();
      // Nothing the check page asks for leaves it.
      await page.setRequestInterception(true);
      page.on("request", (request) => void request.abort());
      await page.setContent(SHADER_CHECK_PAGE);
      const { textureExpressions, checkExpression } = shaderCheckPageExpressions(input);
      for (const expression of textureExpressions) await page.evaluate(expression);
      const timeoutMs = SHADER_LIMITS.checkTimeoutSec * 1000;
      const drawn = (await Promise.race([page.evaluate(checkExpression), new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))])) as ShaderPageDrawing | null;
      return shaderRenderFromPage(drawn, input);
    } finally {
      await browser.close();
    }
  };
}

/** What the check says when it's too slow: with the level when the shader reads iQuality. */
const tooSlowMessage = (tooSlow: ShaderQualityCheck, levelCount: number) =>
  `${levelCount > 1 ? `At quality level ${tooSlow.quality_level} it` : "It"} took ${tooSlow.check_frame_ms} ms a frame in the check; the most is ${tooSlow.maximum_check_frame_ms}.`;

export interface ShaderCheckDeps {
  render: ShaderRenderer;
  /** Image matching: this Zaisma's own unless a test gives one. */
  images?: ImageMatcher;
  judge?: ListingJudge;
}

/** The renderer this Zaisma has: Browser Rendering, or none (the shader waits, and the queue tries again). */
export function shaderCheckDeps(env: Env): ShaderCheckDeps | null {
  return env.BROWSER ? { render: browserShaderRenderer(env.BROWSER) } : null;
}

/** A shader's manifest from the games bucket; one sent before buffers and textures has only its source, its one pass. */
export async function shaderManifestOf(env: Env, shader: Pick<GameShader, "id" | "game_id">): Promise<ShaderManifest | null> {
  const stored = await env.GAMES.get(shaderManifestKey(shader.game_id, shader.id));
  if (stored) return (await stored.json()) as ShaderManifest;
  const source = await env.GAMES.get(shaderKey(shader.game_id, shader.id));
  return source ? shaderManifestFromSource(await source.text()) : null;
}

/** What to draw for a shader: its passes wrapped in order, and its textures' bytes (one gone or rejected reads black). */
export async function shaderRenderInput(env: Env, gameId: string, screen: BackgroundScreen, manifest: ShaderManifest, isSheetWanted: boolean): Promise<ShaderRenderInput> {
  const textures: ShaderRenderInput["textures"] = [];
  for (const imageId of shaderTextureImageIds(manifest)) {
    const image = await imageById(env.DB, imageId);
    if (!image || image.game_id !== gameId || image.kind !== "shader_texture" || image.review_status === "rejected") continue;
    const stored = await env.GAMES.get(imageKey(image));
    if (stored) textures.push({ imageId, bytes: new Uint8Array(await stored.arrayBuffer()) });
  }
  return shaderRenderInputOf(manifest, screen, textures, isSheetWanted);
}

/** Check one shader, if it's still waiting for its check. */
export async function runShaderCheck(env: Env, shaderId: string, deps: ShaderCheckDeps): Promise<void> {
  const shader = await shaderById(env.DB, shaderId);
  if (!shader || shader.review_status !== "pending" || shader.checked_at_ms !== null) return;
  const game = await gameById(env.DB, shader.game_id);
  if (!game || game.review_status === "removed") return;
  const manifest = await shaderManifestOf(env, shader);
  if (!manifest) return;
  const reject = async (reason: ReviewReason, qualityChecks: ShaderQualityCheck[] | null = null, flashCount: number | null = null) => {
    await settleShader(env.DB, shader, reason, qualityChecks, flashCount);
    await recordRestoreEvent(env, { event_kind: "shader_rejected", at_ms: Date.now(), shader_id: shader.id, review_reason: reason });
    await audit(env.DB, game.id, "shader-rejected", `${shader.screen} ${shader.id}: ${reason.message}`, "shader check", reason);
  };

  const drawn = await deps.render(await shaderRenderInput(env, shader.game_id, shader.screen, manifest, false));
  if (drawn.compileError) return reject(reviewReason("shader_does_not_compile", compileMessage(drawn.compileError)));
  // Scaled to the renderer's speed, measured on the reference in the same browser.
  const { qualityChecks, tooSlow } = measureQualityLevels(drawn);
  if (tooSlow) return reject(reviewReason("shader_too_slow", tooSlowMessage(tooSlow, qualityChecks.length)), qualityChecks);
  const flashCount = mostFlashes(drawn);
  if (flashCount > SHADER_LIMITS.maximumFlashCountPerSec) return reject(reviewReason("shader_flashes", "It flashes more than 3 times a second, which can cause seizures."), qualityChecks, flashCount);
  if (!drawn.stillPng || !drawn.smallStillPng) throw new Error(`The renderer drew ${shader.id} but gave no still`);

  // Matched against known abuse material before anyone sees a frame. A match is kept for reporting, never shown.
  const pictures = [{ id: "still", pngBytes: drawn.smallStillPng }, ...drawn.framePngs.map((pngBytes, frameIndex) => ({ id: `frame-${frameIndex}`, pngBytes }))];
  const matched = await (deps.images ?? imageMatcher(env)).check([{ id: "still-full", pngBytes: drawn.stillPng }, ...pictures].map((picture) => ({ path: `shader ${shader.id} ${picture.id}`, type: "image/png", id: picture.id, body: async () => picture.pngBytes })));
  if (matched.findings.some((finding) => finding.code === KNOWN_IMAGE_CODE)) return holdKnownImage(env, game.slug, shader, drawn);

  // Its tone, from the still the glass would be measured from, so pages can open on its color with its glass right.
  const tone = await toneOfPng(drawn.smallStillPng);
  if (tone) await setBackgroundTone(env.DB, "game_shaders", shader.id, tone);
  await Promise.all([
    env.GAMES.put(shaderStillKey(shader.game_id, shader.id), drawn.stillPng, { httpMetadata: { contentType: "image/png" } }),
    ...drawn.framePngs.map((pngBytes, frameIndex) => env.GAMES.put(shaderFrameKey(shader.game_id, shader.id, frameIndex), pngBytes, { httpMetadata: { contentType: "image/png" } })),
  ]);
  const judged = await judgeShaderPictures(env, game, pictures, deps.judge);
  if (judged.outcome === "rejected" || judged.outcome === "off_lists") return reject(judged.reason, qualityChecks, flashCount);
  const waitsForPerson = judged.outcome !== "fine";
  await settleShader(env.DB, shader, null, qualityChecks, flashCount, waitsForPerson);
  const timings = qualityChecks.map((qualityCheck) => `${qualityCheck.check_frame_ms} ms`).join(", ");
  await audit(env.DB, game.id, waitsForPerson ? "shader-checked" : "shader-approved", `${shader.screen} ${shader.id}: ${timings} a frame${waitsForPerson ? ", waits for a person" : ""}`, "shader check");
}

/** A frame matched known abuse material: the frames are kept for reporting, never shown, and the shader is refused. */
async function holdKnownImage(env: Env, slug: string, shader: GameShader, drawn: ShaderRender): Promise<void> {
  const keptKey = (name: string) => heldImageKey(shader.game_id, `${shader.id}.${name}.png`);
  await Promise.all([drawn.stillPng!, ...drawn.framePngs].map((pngBytes, index) => env.GAMES.put(keptKey(index === 0 ? "still" : `frame-${index - 1}`), pngBytes, { httpMetadata: { contentType: "image/png" } })));
  const reason = reviewReason("image_rejected", "This shader can't be used.");
  await settleShader(env.DB, shader, reason, null, null);
  await recordRestoreEvent(env, { event_kind: "shader_rejected", at_ms: Date.now(), shader_id: shader.id, review_reason: reason });
  await audit(env.DB, shader.game_id, "image-held", `A ${shader.screen} shader's frames matched known abuse material. Kept at ${keptKey("still")} and beside it; never shown.`, "shader check");
  await sendAlert(env, `URGENT: known abuse image in a shader on ${slug}`, `${KNOWN_IMAGE_ALERT}\n\nShader ${shader.id}'s frames, kept at ${keptKey("still")} and beside it in the games bucket.\n\nGame: ${env.SITE_ORIGIN}/admin/games/${shader.game_id}`);
}

// --- Checks before sending ----------------------------------------------------------

/** Where a check before sending keeps its sheet for a day, by a random name its link carries, and where a developer's checks are counted. */
export const shaderCheckSheetKey = (sheetName: string) => `shader-checks/${sheetName}.png`;
const shaderCheckRunPrefix = (ownerId: string) => `shader-check-runs/${ownerId}/`;

/** How many checks before sending a developer has left in the last day, and when the oldest of those was. */
export async function shaderCheckAllowance(env: Env, ownerId: string, nowMs = Date.now()): Promise<{ remainingShaderCheckCount: number; oldestAtMs: number | null }> {
  const listed = await env.GAMES.list({ prefix: shaderCheckRunPrefix(ownerId), limit: 1000 });
  const recentAtMs = listed.objects.map((object) => object.uploaded.getTime()).filter((uploadedAtMs) => uploadedAtMs > nowMs - 24 * 3600_000);
  return { remainingShaderCheckCount: Math.max(0, SHADER_LIMITS.maximumShaderChecksPerDay - recentAtMs.length), oldestAtMs: recentAtMs.length ? Math.min(...recentAtMs) : null };
}

/** Counts one check before sending, before it runs, so one that fails counts too. */
export async function countShaderCheck(env: Env, ownerId: string): Promise<void> {
  await env.GAMES.put(`${shaderCheckRunPrefix(ownerId)}${Date.now()}-${crypto.randomUUID()}`, new Uint8Array());
}

/**
 * A check before sending: the same drawing as the check, keeping nothing but a sheet picture for a day. It answers what the check
 * would measure (the compiler's first error, each level's time, flashes, the glass), notes that never hold a shader, and the sheet,
 * which image matching clears first like every picture. Safety's other half, the listing check, runs when the shader is sent.
 */
export async function runShaderDraft(env: Env, game: Game, screen: BackgroundScreen, manifest: ShaderManifest, deps: ShaderCheckDeps): Promise<ShaderCheckAnswer> {
  const drawn = await deps.render(await shaderRenderInput(env, game.id, screen, manifest, true));
  const answer = await shaderDraftAnswer(drawn, screen);
  if (answer.compile_error || !drawn.sheetPng) return answer;
  // The sheet is a picture Zaisma keeps and serves, so image matching clears it first; when matching can't answer, it isn't kept.
  const sheetPng = drawn.sheetPng;
  const matched = await (deps.images ?? imageMatcher(env)).check([{ path: `shader check on ${game.slug}`, type: "image/png", id: "sheet", body: async () => sheetPng }]);
  if (matched.findings.some((finding) => finding.code === KNOWN_IMAGE_CODE)) {
    const keptKey = heldImageKey(game.id, `shader-check-${crypto.randomUUID()}.png`);
    await env.GAMES.put(keptKey, sheetPng, { httpMetadata: { contentType: "image/png" } });
    await audit(env.DB, game.id, "image-held", `A shader check's sheet matched known abuse material. Kept at ${keptKey}; never shown.`, "shader check");
    await sendAlert(env, `URGENT: known abuse image in a shader check on ${game.slug}`, `${KNOWN_IMAGE_ALERT}\n\nA shader check's sheet, kept at ${keptKey} in the games bucket.\n\nGame: ${env.SITE_ORIGIN}/admin/games/${game.id}`);
    return { ...answer, notes: [], sheet_url: null };
  }
  if (!matched.isConnected) return answer;
  const sheetName = crypto.randomUUID().replace(/-/g, "");
  await env.GAMES.put(shaderCheckSheetKey(sheetName), sheetPng, { httpMetadata: { contentType: "image/png" } });
  return { ...answer, sheet_url: `${env.SITE_ORIGIN}/shader-checks/${sheetName}.png`, sheet_expires_at: iso(Date.now() + SHADER_LIMITS.checkSheetKeptDurationSec * 1000) };
}

/**
 * A check's sheet (/shader-checks/<name>.png): anyone with its link, for a day, like a preview link, so the developer's AI can look at it.
 * Its name is random and long, it's never cached in public, and search engines are asked to leave it alone.
 */
export async function serveShaderCheckSheet(request: Request, env: Env, filePath: string, nowMs = Date.now()): Promise<Response> {
  const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const match = filePath.match(/^([a-f0-9]{32})\.png$/);
  if (!match || (request.method !== "GET" && request.method !== "HEAD")) return notFound();
  const stored = await env.GAMES.get(shaderCheckSheetKey(match[1]!));
  if (!stored || stored.uploaded.getTime() < nowMs - SHADER_LIMITS.checkSheetKeptDurationSec * 1000) return notFound();
  return new Response(request.method === "HEAD" ? null : stored.body, {
    headers: { "Content-Type": "image/png", "Content-Length": String(stored.size), "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex", "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Disposition": "inline" },
  });
}

/** Once a day: sheets past their day, and the counts of checks older than a day. */
export async function deleteOldShaderChecks(env: Env, nowMs = Date.now()): Promise<number> {
  let deletedCount = 0;
  for (const prefix of ["shader-checks/", "shader-check-runs/"]) {
    let cursor: string | undefined;
    do {
      const listed = await env.GAMES.list({ prefix, limit: 1000, cursor });
      const old = listed.objects.filter((object) => object.uploaded.getTime() < nowMs - SHADER_LIMITS.checkSheetKeptDurationSec * 1000).map((object) => object.key);
      if (old.length) await env.GAMES.delete(old);
      deletedCount += old.length;
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
  }
  return deletedCount;
}

/** A shader check from the scan queue: tried again a little later when the renderer fails (Browser Rendering's limits, say). */
export async function checkShaderFromQueue(env: Env, message: Message<ShaderCheckJob>): Promise<void> {
  const deps = shaderCheckDeps(env);
  // Without a renderer the shader waits, and a person can approve it on /admin.
  if (!deps) return message.ack();
  try {
    await runShaderCheck(env, message.body.shaderCheckId, deps);
    message.ack();
  } catch (error) {
    console.error("shader check failed", message.body.shaderCheckId, error);
    if (message.attempts >= 3) message.ack();
    else message.retry({ delaySeconds: 60 * message.attempts });
  }
}

/** Every 5 minutes: shaders sent over 10 minutes ago and never checked (a lost message, or the renderer failing three times), queued again. */
export async function queueShaderChecks(env: Env, nowMs = Date.now()): Promise<number> {
  if (!env.BROWSER) return 0;
  const { results } = await env.DB.prepare("SELECT id FROM game_shaders WHERE review_status = 'pending' AND checked_at_ms IS NULL AND created_at_ms < ? AND created_at_ms > ? ORDER BY created_at_ms LIMIT 20")
    .bind(nowMs - 10 * 60_000, nowMs - 2 * 24 * 3600_000)
    .all<{ id: string }>();
  if (results.length) await env.SCAN_QUEUE.sendBatch(results.map((shader) => ({ body: { shaderCheckId: shader.id } })));
  return results.length;
}
