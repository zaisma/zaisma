import puppeteer from "@cloudflare/puppeteer";
import {
  KNOWN_IMAGE_CODE,
  SHADER_LIMITS,
  audit,
  gameById,
  heldImageKey,
  reviewReason,
  settleShader,
  shaderById,
  shaderFrameKey,
  shaderKey,
  shaderStillKey,
  wrapShader,
  type BackgroundScreen,
  type GameShader,
  type ImageMatcher,
  type ReviewReason,
  type ShaderCheckJob,
} from "@zaisma/core";
import { sendAlert } from "./email.ts";
import type { Env } from "./env.ts";
import { SHADER_HELPERS, ZAISMA_SHADER } from "./components/shaders.ts";
import { judgeShaderPictures } from "./listing-check.ts";
import type { ListingJudge } from "./listing-judge.ts";
import { KNOWN_IMAGE_ALERT, imageMatcher } from "./scan.ts";

/**
 * The shader check (Backgrounds in docs/DEVELOPER-API.md): every shader a game sends for its background is drawn before anyone
 * sees it, on Cloudflare Browser Rendering (headless Chromium, WebGL through SwiftShader), in a blank page that loads nothing.
 * It must compile; its frames are timed (the median against SHADER_LIMITS.maximumCheckFrameMs) and their brightness read for
 * flashes (WCAG 2.3.1: no more than three in any one second); then a still frame and sampled frames are saved and go through
 * the safety checks pictures get, image matching and the listing check. Upload queues { shaderCheckId } on the scan queue.
 */

/** One shader on the check's renderer: what it drew, or the first compiler error. */
export interface ShaderRender {
  /** The compiler's first error line; null when it compiled. */
  compileError: string | null;
  /** The reference shader's frames, timed in the same browser first; empty when none was given. */
  referenceFrameTimesMs: number[];
  /** Each timed frame's draw, in milliseconds. Fewer than checkFrameCount when it stopped early for being slow. */
  frameTimesMs: number[];
  /** Each timed frame's mean relative luminance, 0 to 1. */
  frameLuminances: number[];
  /** The still at stillTimeSec, full size (1920 × 1080 wide, 1080 × 1920 phone), as PNG. */
  stillPng: Uint8Array | null;
  /** The still again at the check's size, for the listing check (the full one can be over its size limit). */
  smallStillPng: Uint8Array | null;
  /** sampledFrameCount frames over the first sampledFramesOverSec seconds, at the check's size, as PNG. */
  framePngs: Uint8Array[];
}

export type ShaderRenderer = (fragmentSource: string, screen: BackgroundScreen, referenceSource?: string) => Promise<ShaderRender>;

/** What the check times first, to measure the renderer's speed: Zaisma's own background, light. */
export const REFERENCE_SHADER = wrapShader(`uniform float iDark;\n${SHADER_HELPERS}${ZAISMA_SHADER}`);

/** How long one shader may take on the renderer altogether before it's called too slow. */
const RENDER_TIMEOUT_MS = 90_000;

/** The check's page: no network, nothing but a canvas and the script that draws on it. */
const CHECK_PAGE = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; img-src data:"><body><script>
window.zaismaCheck = function (input) {
  var canvas = document.createElement("canvas"); canvas.width = input.checkWidthPx; canvas.height = input.checkHeightPx; document.body.appendChild(canvas);
  var gl = canvas.getContext("webgl", { antialias: false, depth: false, stencil: false, alpha: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error("No WebGL on the renderer");
  function compile(kind, source) { var shader = gl.createShader(kind); gl.shaderSource(shader, source); gl.compileShader(shader); return shader; }
  var vertex = compile(gl.VERTEX_SHADER, "attribute vec2 corner; void main() { gl_Position = vec4(corner, 0.0, 1.0); }");
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var at = {};
  // Builds a fragment shader and draws with it from then on; answers its first compiler error, or null.
  function use(fragmentSource) {
    var fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
    if (!gl.getShaderParameter(fragment, gl.COMPILE_STATUS)) return (gl.getShaderInfoLog(fragment) || "").split("\\n").map(function (line) { return line.trim(); }).filter(Boolean)[0] || "The shader didn't compile.";
    var program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return (gl.getProgramInfoLog(program) || "It didn't link.").split("\\n")[0].trim();
    gl.useProgram(program);
    var corner = gl.getAttribLocation(program, "corner"); gl.enableVertexAttribArray(corner); gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
    at = {}; ["iResolution", "iTime", "zaismaPaneCount", "zaismaPixel", "zaismaViewOffset"].forEach(function (name) { at[name] = gl.getUniformLocation(program, name); });
    return null;
  }
  var onePixel = new Uint8Array(4);
  function draw(timeS) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform3f(at.iResolution, canvas.width, canvas.height, 1); gl.uniform1f(at.iTime, timeS);
    gl.uniform1f(at.zaismaPaneCount, 0); gl.uniform1f(at.zaismaPixel, 1); gl.uniform2f(at.zaismaViewOffset, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.finish();
    // Reading a pixel waits until the frame is really drawn.
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, onePixel);
  }
  function linear(value) { value /= 255; return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4); }
  var pixels = new Uint8Array(canvas.width * canvas.height * 4);
  function luminance() {
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    var sum = 0, count = 0;
    for (var p = 0; p < pixels.length; p += 4 * 7) { sum += 0.2126 * linear(pixels[p]) + 0.7152 * linear(pixels[p + 1]) + 0.0722 * linear(pixels[p + 2]); count++; }
    return sum / count;
  }
  // The renderer's speed varies from browser to browser, so a known shader is timed first, in the same browser, to measure against.
  var referenceFrameTimesMs = [];
  if (input.referenceSource) {
    var referenceError = use(input.referenceSource);
    if (referenceError) throw new Error("The reference shader didn't compile: " + referenceError);
    for (var r = 0; r < input.referenceFrameCount; r++) { var referenceStartedMs = performance.now(); draw(r * input.checkFrameStepSec); referenceFrameTimesMs.push(performance.now() - referenceStartedMs); }
  }
  var sortedReference = referenceFrameTimesMs.slice().sort(function (a, b) { return a - b; });
  var slowFrameMs = input.maximumCheckFrameMs * (sortedReference.length ? sortedReference[Math.floor(sortedReference.length / 2)] / input.referenceFrameMs : 1);
  var drawn = { compileError: use(input.fragmentSource), referenceFrameTimesMs: referenceFrameTimesMs, frameTimesMs: [], frameLuminances: [], stillDataUrl: null, smallStillDataUrl: null, frameDataUrls: [] };
  if (drawn.compileError) return drawn;
  for (var n = 0; n < input.checkFrameCount; n++) {
    var startedMs = performance.now();
    draw(n * input.checkFrameStepSec);
    drawn.frameTimesMs.push(performance.now() - startedMs);
    drawn.frameLuminances.push(luminance());
    // Far over the limit: no need to draw the rest.
    if (drawn.frameTimesMs[n] > slowFrameMs * 4 && n >= 2) return drawn;
  }
  draw(input.stillTimeSec);
  drawn.smallStillDataUrl = canvas.toDataURL("image/png");
  drawn.frameDataUrls = input.sampledTimesSec.map(function (timeS) { draw(timeS); return canvas.toDataURL("image/png"); });
  canvas.width = input.stillWidthPx; canvas.height = input.stillHeightPx;
  draw(input.stillTimeSec);
  drawn.stillDataUrl = canvas.toDataURL("image/png");
  return drawn;
};</script>`;

/** The sizes a screen is checked and stilled at: landscape for wide, portrait for phones. */
export function checkSizes(screen: BackgroundScreen): { checkWidthPx: number; checkHeightPx: number; stillWidthPx: number; stillHeightPx: number } {
  const { checkWidthPx, checkHeightPx } = SHADER_LIMITS;
  return screen === "wide" ? { checkWidthPx, checkHeightPx, stillWidthPx: 1920, stillHeightPx: 1080 } : { checkWidthPx: checkHeightPx, checkHeightPx: checkWidthPx, stillWidthPx: 1080, stillHeightPx: 1920 };
}

/** When the sampled frames are drawn: spread evenly over the first sampledFramesOverSec seconds. */
export const SAMPLED_TIMES_SEC = Array.from({ length: SHADER_LIMITS.sampledFrameCount }, (_, frameIndex) => (frameIndex * SHADER_LIMITS.sampledFramesOverSec) / (SHADER_LIMITS.sampledFrameCount - 1));

function fromDataUrl(dataUrl: string | null): Uint8Array | null {
  if (!dataUrl) return null;
  const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** The renderer on Cloudflare Browser Rendering (the BROWSER binding): one browser per shader, closed after. */
export function browserShaderRenderer(browserBinding: Fetcher): ShaderRenderer {
  return async (fragmentSource, screen, referenceSource) => {
    const browser = await puppeteer.launch(browserBinding);
    try {
      const page = await browser.newPage();
      // Nothing the check page asks for leaves it.
      await page.setRequestInterception(true);
      page.on("request", (request) => void request.abort());
      await page.setContent(CHECK_PAGE);
      const input = { fragmentSource, referenceSource: referenceSource ?? null, referenceFrameCount: 30, ...checkSizes(screen), checkFrameCount: SHADER_LIMITS.checkFrameCount, checkFrameStepSec: SHADER_LIMITS.checkFrameStepSec, stillTimeSec: SHADER_LIMITS.stillTimeSec, sampledTimesSec: SAMPLED_TIMES_SEC, maximumCheckFrameMs: SHADER_LIMITS.maximumCheckFrameMs, referenceFrameMs: SHADER_LIMITS.referenceFrameMs };
      // An expression, not a function: a bundled function's text can carry helpers the page doesn't have.
      const drawn = (await Promise.race([
        page.evaluate(`window.zaismaCheck(${JSON.stringify(input)})`),
        new Promise((resolve) => setTimeout(() => resolve(null), RENDER_TIMEOUT_MS)),
      ])) as { compileError: string | null; referenceFrameTimesMs: number[]; frameTimesMs: number[]; frameLuminances: number[]; stillDataUrl: string | null; smallStillDataUrl: string | null; frameDataUrls: string[] } | null;
      // Out of time: it counts as too slow, with the time it had.
      if (!drawn) return { compileError: null, referenceFrameTimesMs: [], frameTimesMs: [RENDER_TIMEOUT_MS], frameLuminances: [], stillPng: null, smallStillPng: null, framePngs: [] };
      return {
        compileError: drawn.compileError,
        referenceFrameTimesMs: drawn.referenceFrameTimesMs,
        frameTimesMs: drawn.frameTimesMs,
        frameLuminances: drawn.frameLuminances,
        stillPng: fromDataUrl(drawn.stillDataUrl),
        smallStillPng: fromDataUrl(drawn.smallStillDataUrl),
        framePngs: drawn.frameDataUrls.map((dataUrl) => fromDataUrl(dataUrl)!),
      };
    } finally {
      await browser.close();
    }
  };
}

/**
 * The most flashes in any one second of frames (WCAG 2.3.1's general flash): a flash is a pair of opposing changes in mean
 * relative luminance of at least 0.1, the second within 3 frames of the first, while the darker side is under 0.8.
 */
export function mostFlashesInOneSecond(frameLuminances: number[], frameStepSec: number = SHADER_LIMITS.checkFrameStepSec): number {
  const MINIMUM_CHANGE_NUMBER = 0.1;
  const MOST_FRAMES_BETWEEN_COUNT = 3;
  // Each change of at least 0.1 from the last extreme, in turn: up, down, up…
  const changes: { frameIndex: number; direction: "up" | "down"; darkerLuminanceNumber: number }[] = [];
  let direction: "up" | "down" | null = null;
  let extremeLuminanceNumber = frameLuminances[0] ?? 0;
  let lowestLuminanceNumber = extremeLuminanceNumber;
  let highestLuminanceNumber = extremeLuminanceNumber;
  frameLuminances.forEach((luminanceNumber, frameIndex) => {
    if (direction === null) {
      lowestLuminanceNumber = Math.min(lowestLuminanceNumber, luminanceNumber);
      highestLuminanceNumber = Math.max(highestLuminanceNumber, luminanceNumber);
      if (luminanceNumber - lowestLuminanceNumber >= MINIMUM_CHANGE_NUMBER) changes.push({ frameIndex, direction: (direction = "up"), darkerLuminanceNumber: lowestLuminanceNumber });
      else if (highestLuminanceNumber - luminanceNumber >= MINIMUM_CHANGE_NUMBER) changes.push({ frameIndex, direction: (direction = "down"), darkerLuminanceNumber: luminanceNumber });
      if (direction !== null) extremeLuminanceNumber = luminanceNumber;
      return;
    }
    const isFurther = direction === "up" ? luminanceNumber > extremeLuminanceNumber : luminanceNumber < extremeLuminanceNumber;
    if (isFurther) {
      extremeLuminanceNumber = luminanceNumber;
      return;
    }
    if (Math.abs(luminanceNumber - extremeLuminanceNumber) < MINIMUM_CHANGE_NUMBER) return;
    changes.push({ frameIndex, direction: (direction = direction === "up" ? "down" : "up"), darkerLuminanceNumber: Math.min(luminanceNumber, extremeLuminanceNumber) });
    extremeLuminanceNumber = luminanceNumber;
  });
  // A flash: two changes back to back, close together, from a dark enough side. Each change counts in one flash.
  const flashFrameIndexes: number[] = [];
  for (let changeIndex = 1; changeIndex < changes.length; changeIndex++) {
    const earlier = changes[changeIndex - 1]!;
    const later = changes[changeIndex]!;
    if (later.frameIndex - earlier.frameIndex > MOST_FRAMES_BETWEEN_COUNT || Math.min(earlier.darkerLuminanceNumber, later.darkerLuminanceNumber) >= 0.8) continue;
    flashFrameIndexes.push(later.frameIndex);
    changeIndex++;
  }
  const frameCountPerSec = Math.round(1 / frameStepSec);
  let mostFlashCount = 0;
  for (const startIndex of flashFrameIndexes) mostFlashCount = Math.max(mostFlashCount, flashFrameIndexes.filter((frameIndex) => frameIndex >= startIndex && frameIndex < startIndex + frameCountPerSec).length);
  return mostFlashCount;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((firstNumber, secondNumber) => firstNumber - secondNumber);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
};
const roundedMs = (ms: number) => Math.round(ms * 10) / 10;

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

/** Check one shader, if it's still waiting for its check. */
export async function runShaderCheck(env: Env, shaderId: string, deps: ShaderCheckDeps): Promise<void> {
  const shader = await shaderById(env.DB, shaderId);
  if (!shader || shader.review_status !== "pending" || shader.checked_at_ms !== null) return;
  const game = await gameById(env.DB, shader.game_id);
  if (!game || game.review_status === "removed") return;
  const sourceObject = await env.GAMES.get(shaderKey(shader.game_id, shader.id));
  if (!sourceObject) return;
  const reject = async (reason: ReviewReason, checkFrameMs: number | null = null, flashCount: number | null = null) => {
    await settleShader(env.DB, shader, reason, checkFrameMs, flashCount);
    await audit(env.DB, game.id, "shader-rejected", `${shader.screen} ${shader.id}: ${reason.message}`, "shader check", reason);
  };

  const drawn = await deps.render(wrapShader(await sourceObject.text()), shader.screen, REFERENCE_SHADER);
  if (drawn.compileError) return reject(reviewReason("shader_does_not_compile", `It didn't compile: ${drawn.compileError.replace(/[.\s]+$/, "")}.`));
  // Scaled to the renderer's speed, measured on Zaisma's own background in the same browser.
  const speedScaleNumber = drawn.referenceFrameTimesMs.length ? SHADER_LIMITS.referenceFrameMs / Math.max(0.1, median(drawn.referenceFrameTimesMs)) : 1;
  const checkFrameMs = roundedMs(median(drawn.frameTimesMs) * speedScaleNumber);
  const isCut = drawn.frameTimesMs.length < SHADER_LIMITS.checkFrameCount;
  if (isCut || checkFrameMs > SHADER_LIMITS.maximumCheckFrameMs) {
    const shownMs = isCut ? roundedMs(Math.max(...drawn.frameTimesMs) * speedScaleNumber) : checkFrameMs;
    return reject(reviewReason("shader_too_slow", `It took ${shownMs} ms a frame in the check; the most is ${SHADER_LIMITS.maximumCheckFrameMs}.`), shownMs);
  }
  const flashCount = mostFlashesInOneSecond(drawn.frameLuminances);
  if (flashCount > SHADER_LIMITS.maximumFlashCountPerSec) return reject(reviewReason("shader_flashes", "It flashes more than 3 times a second, which can cause seizures."), checkFrameMs, flashCount);
  if (!drawn.stillPng || !drawn.smallStillPng) throw new Error(`The renderer drew ${shader.id} but gave no still`);

  // Matched against known abuse material before anyone sees a frame. A match is kept for reporting, never shown.
  const pictures = [{ id: "still", pngBytes: drawn.smallStillPng }, ...drawn.framePngs.map((pngBytes, frameIndex) => ({ id: `frame-${frameIndex}`, pngBytes }))];
  const matched = await (deps.images ?? imageMatcher(env)).check([{ id: "still-full", pngBytes: drawn.stillPng }, ...pictures].map((picture) => ({ path: `shader ${shader.id} ${picture.id}`, type: "image/png", id: picture.id, body: async () => picture.pngBytes })));
  if (matched.findings.some((finding) => finding.code === KNOWN_IMAGE_CODE)) return holdKnownImage(env, game.slug, shader, drawn);

  await Promise.all([
    env.GAMES.put(shaderStillKey(shader.game_id, shader.id), drawn.stillPng, { httpMetadata: { contentType: "image/png" } }),
    ...drawn.framePngs.map((pngBytes, frameIndex) => env.GAMES.put(shaderFrameKey(shader.game_id, shader.id, frameIndex), pngBytes, { httpMetadata: { contentType: "image/png" } })),
  ]);
  const judged = await judgeShaderPictures(env, game, pictures, deps.judge);
  if (judged.outcome === "rejected" || judged.outcome === "off_lists") return reject(judged.reason, checkFrameMs, flashCount);
  const waitsForPerson = judged.outcome !== "fine";
  await settleShader(env.DB, shader, null, checkFrameMs, flashCount, waitsForPerson);
  await audit(env.DB, game.id, waitsForPerson ? "shader-checked" : "shader-approved", `${shader.screen} ${shader.id}: ${checkFrameMs} ms a frame${waitsForPerson ? ", waits for a person" : ""}`, "shader check");
}

/** A frame matched known abuse material: the frames are kept for reporting, never shown, and the shader is refused. */
async function holdKnownImage(env: Env, slug: string, shader: GameShader, drawn: ShaderRender): Promise<void> {
  const keptKey = (name: string) => heldImageKey(shader.game_id, `${shader.id}.${name}.png`);
  await Promise.all([drawn.stillPng!, ...drawn.framePngs].map((pngBytes, index) => env.GAMES.put(keptKey(index === 0 ? "still" : `frame-${index - 1}`), pngBytes, { httpMetadata: { contentType: "image/png" } })));
  const reason = reviewReason("image_rejected", "This shader can't be used.");
  await settleShader(env.DB, shader, reason, null, null);
  await audit(env.DB, shader.game_id, "image-held", `A ${shader.screen} shader's frames matched known abuse material. Kept at ${keptKey("still")} and beside it; never shown.`, "shader check");
  await sendAlert(env, `URGENT: known abuse image in a shader on ${slug}`, `${KNOWN_IMAGE_ALERT}\n\nShader ${shader.id}'s frames, kept at ${keptKey("still")} and beside it in the games bucket.\n\nGame: ${env.SITE_ORIGIN}/admin/games/${shader.game_id}`);
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
