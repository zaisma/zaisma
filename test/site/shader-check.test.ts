import puppeteer from "@cloudflare/puppeteer";
import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  BUFFER_PASS,
  GLASS_LIGHT_PASS,
  KNOWN_IMAGE_CODE,
  SHADER_HEAD,
  SHADER_LIMITS,
  addImage,
  addShader,
  createAccount,
  createGame,
  gameById,
  imageKey,
  personOwner,
  readQualityChecks,
  readReviewReason,
  settleImage,
  shaderById,
  shaderFrameKey,
  shaderKey,
  shaderManifestKey,
  shaderSourceProblem,
  shaderStillKey,
  wrapShader,
  type ImageMatcher,
  type ShaderManifest,
} from "@zaisma/core";
import { pngPixels } from "../../apps/site/src/background-tone.ts";
import type { Env } from "../../apps/site/src/env.ts";
import {
  CHECK_REFERENCE_SHADER,
  SHIMMER_LIMITS,
  THICK_GLASS_TINT_PCT,
  deleteOldShaderChecks,
  frameShimmer,
  mostFlashesInOneSecond,
  runShaderCheck,
  runShaderDraft,
  serveShaderCheckSheet,
  shaderCheckSheetKey,
  shaderRenderInput,
  type ShaderRender,
  type ShaderRenderer,
  type ShaderRenderInput,
} from "../../apps/site/src/shader-check.ts";
import { SHADER_HELPERS, STAND_IN_BACKGROUNDS, ZAISMA_SHADER } from "../../apps/site/src/components/shaders.ts";
import type { ListingJudge, PictureAnswer } from "../../apps/site/src/listing-judge.ts";
import { SHADER_CHECK } from "../../apps/site/src/schemas.ts";
import { schemaProblems } from "../schema-check.ts";
import { png } from "./png-stub.ts";
import { connectedImages } from "./scan-stubs.ts";

/** The shader check (apps/site/src/shader-check.ts), with a stand-in renderer and judge: what each result does to the shader. */

const testEnv = { ...env, ANTHROPIC_API_KEY: "test-key" } as unknown as Env;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const levelFrames = (qualityLevel: number, frameMs: number) => ({ qualityLevel, frameTimesMs: Array.from({ length: SHADER_LIMITS.checkFrameCount }, () => frameMs), frameLuminances: Array.from({ length: SHADER_LIMITS.checkFrameCount }, (_, frameIndex) => 0.4 + 0.05 * Math.sin(frameIndex / 10)) });

/** A clean drawing: steady light, quick frames, the reference drawn as fast as it should be. */
const drawn = (overrides: Partial<ShaderRender> = {}): ShaderRender => ({
  compileError: null,
  referenceFrameTimesMs: Array.from({ length: 30 }, () => SHADER_LIMITS.referenceFrameMs),
  levels: [levelFrames(0, 20)],
  stillPng: PNG,
  smallStillPng: PNG,
  framePngs: Array.from({ length: SHADER_LIMITS.sampledFrameCount }, () => PNG),
  shimmerPngs: [],
  sheetPng: null,
  ...overrides,
});
/** A renderer answering the same drawing, keeping what it was asked to draw. */
const renders = (render: ShaderRender, asked: ShaderRenderInput[] = []): ShaderRenderer => async (input) => {
  asked.push(input);
  return render;
};

const NO: PictureAnswer = { number: 0, extra_text: "", overlay: "", fake_reward: "", famous_name: "", main_subject: "", is_main_subject_in_screenshots: true, added_after_capture: "", background_text: "", has_safety_concern: false };
/** A judge answering every picture the same way. */
const judgeSays =
  (picture: Partial<PictureAnswer> = {}): ListingJudge =>
  async (_apiKey, _model, brief) => ({
    answer: { pictures: brief.pictures.map((_, index) => ({ ...NO, ...picture, number: index + 1 })), title_fake_reward: "", title_famous_name: "", title_tag: "", description_fake_reward: "", has_words_safety_concern: false },
    declinedAttemptCount: 0,
    costCents: 1,
  });

const ONE_PASS = "void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(1.0); }";
let gameId = "";
let shaderId = "";

beforeEach(async () => {
  await env.DB.exec("DELETE FROM game_backgrounds; DELETE FROM game_shaders; DELETE FROM game_images; DELETE FROM audit_log; DELETE FROM ai_usage; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;");
  await createAccount(env.DB, { id: "dev-1", username: "Pixel_Smith", ageBand: "18+" });
  const game = await createGame(env.DB, { slug: "worlds", title: "Worlds", description: "", ownerId: (await personOwner(env.DB, "dev-1")).id });
  gameId = game.id;
  shaderId = (await addShader(env.DB, { id: `shader_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`, game_id: game.id, screen: "wide", size_bytes: 120, buffer_count: 0, texture_count: 0 })).id;
  // Sent before buffers: only its source, no manifest.
  await env.GAMES.put(shaderKey(game.id, shaderId), ONE_PASS);
});

const check = (render: ShaderRender, judge: ListingJudge = judgeSays(), images: ImageMatcher = connectedImages) => runShaderCheck(testEnv, shaderId, { render: renders(render), judge, images });
const shaderNow = async () => (await shaderById(env.DB, shaderId))!;
const reasonNow = async () => readReviewReason((await shaderNow()).review_reason);
const qualityChecksNow = async () => readQualityChecks((await shaderNow()).quality_checks);

describe("the shader check", () => {
  it("keeps the still's tone, so pages open on its color with its glass right", async () => {
    await check(drawn({ smallStillPng: await png(32, 18, () => [14, 10, 40]) }));
    expect(await shaderNow()).toMatchObject({ review_status: "approved", average_color: "#0E0A28", is_glass_smoked: 1 });
  });

  it("rejects a shader that doesn't compile, with the compiler's first line", async () => {
    await check(drawn({ compileError: "ERROR: 0:7: 'colour' : undeclared identifier" }));
    expect((await shaderNow()).review_status).toBe("rejected");
    expect(await reasonNow()).toEqual({ code: "shader_does_not_compile", message: "It didn't compile: ERROR: 0:7: 'colour' : undeclared identifier.", content_rule: null });
  });

  it("rejects a shader too slow for the limit, measured against the reference drawn in the same browser", async () => {
    await check(drawn({ levels: [levelFrames(0, 100)] }));
    expect(await shaderNow()).toMatchObject({ review_status: "rejected" });
    expect(await qualityChecksNow()).toEqual([{ quality_level: 0, check_frame_ms: 100, maximum_check_frame_ms: 75 }]);
    expect(await reasonNow()).toMatchObject({ code: "shader_too_slow", message: "It took 100 ms a frame in the check; the most is 75." });
  });

  it("scales a slow renderer away: the same shader on a renderer twice as slow passes the same", async () => {
    await check(drawn({ referenceFrameTimesMs: Array.from({ length: 30 }, () => 50), levels: [levelFrames(0, 100)] }));
    expect(await shaderNow()).toMatchObject({ review_status: "approved" });
    expect(await qualityChecksNow()).toEqual([{ quality_level: 0, check_frame_ms: 50, maximum_check_frame_ms: 75 }]);
  });

  it("times a shader that reads iQuality at each level, each against its own most, and says which level was too slow", async () => {
    await env.GAMES.put(shaderManifestKey(gameId, shaderId), JSON.stringify({ image: { source: "void mainImage(out vec4 c, in vec2 f) { c = vec4(iQuality / 2.0); }", channels: [] }, buffers: [] } satisfies ShaderManifest));
    const asked: ShaderRenderInput[] = [];
    await runShaderCheck(testEnv, shaderId, { render: renders(drawn({ levels: [levelFrames(0, 60), levelFrames(1, 140), levelFrames(2, 280)] }), asked), judge: judgeSays(), images: connectedImages });
    expect(asked[0]!.qualityLevels).toEqual([0, 1, 2]);
    expect(await shaderNow()).toMatchObject({ review_status: "approved" });
    expect((await qualityChecksNow()).map((qualityCheck) => [qualityCheck.quality_level, qualityCheck.maximum_check_frame_ms])).toEqual([[0, 75], [1, 150], [2, 300]]);

    await env.DB.prepare("UPDATE game_shaders SET review_status = 'pending', checked_at_ms = NULL WHERE id = ?").bind(shaderId).run();
    await check(drawn({ levels: [levelFrames(0, 60), levelFrames(1, 140), levelFrames(2, 320)] }));
    expect(await reasonNow()).toMatchObject({ code: "shader_too_slow", message: "At quality level 2 it took 320 ms a frame in the check; the most is 300." });
  });

  it("calls a level cut short too slow, with its slowest frame", async () => {
    await check(drawn({ levels: [{ qualityLevel: 0, frameTimesMs: [30, 400, 420], frameLuminances: [0.4, 0.4, 0.4] }] }));
    expect(await reasonNow()).toMatchObject({ code: "shader_too_slow", message: "It took 420 ms a frame in the check; the most is 75." });
  });

  it("rejects a shader that flashes more than 3 times a second at any level, and passes one that flashes twice", async () => {
    // Light and dark in turn, a flash every 6 frames at 30 frames a second: 5 a second.
    const flashing = Array.from({ length: SHADER_LIMITS.checkFrameCount }, (_, frameIndex) => (frameIndex % 6 < 3 ? 0.05 : 0.6));
    await check(drawn({ levels: [{ ...levelFrames(0, 20), frameLuminances: flashing }] }));
    expect(await shaderNow()).toMatchObject({ review_status: "rejected", flash_count: 5 });
    expect(await reasonNow()).toMatchObject({ code: "shader_flashes", message: "It flashes more than 3 times a second, which can cause seizures." });

    const twice = Array.from({ length: SHADER_LIMITS.checkFrameCount }, (_, frameIndex) => (frameIndex % 15 < 2 ? 0.6 : 0.05));
    expect(mostFlashesInOneSecond(twice)).toBe(2);
  });

  it("counts flashes as WCAG 2.3.1 does: slow changes and small ones aren't flashes", () => {
    // A slow pulse, light to dark over a second.
    expect(mostFlashesInOneSecond(Array.from({ length: 90 }, (_, frameIndex) => 0.3 + 0.3 * Math.sin((frameIndex / 30) * Math.PI * 2)))).toBe(0);
    // Flicker smaller than a tenth.
    expect(mostFlashesInOneSecond(Array.from({ length: 90 }, (_, frameIndex) => (frameIndex % 2 ? 0.4 : 0.45)))).toBe(0);
    // Every other frame from black to white: fifteen a second.
    expect(mostFlashesInOneSecond(Array.from({ length: 90 }, (_, frameIndex) => (frameIndex % 2 ? 1 : 0)))).toBe(15);
  });

  it("refuses a shader whose frames match known abuse material, keeping them for reporting and never showing them", async () => {
    const matching: ImageMatcher = { check: async (media) => ({ provider: "test", isConnected: true, checkedMediaCount: media.length, findings: [{ stage: "images", severity: "hold", code: KNOWN_IMAGE_CODE, message: "Matched.", path: media[0]!.path }] }) };
    await check(drawn(), judgeSays(), matching);
    expect(await shaderNow()).toMatchObject({ review_status: "rejected" });
    expect(await env.GAMES.head(shaderStillKey(gameId, shaderId))).toBeNull();
    expect(await env.GAMES.head(`held-images/${gameId}/${shaderId}.still.png`)).not.toBeNull();
  });

  it("rejects a shader with words in its frames, and holds the game for a fake reward", async () => {
    await check(drawn(), judgeSays({ background_text: "WORLDS" }));
    expect(await reasonNow()).toMatchObject({ code: "text_on_background" });

    await env.DB.prepare("UPDATE game_shaders SET review_status = 'pending', review_reason = NULL, checked_at_ms = NULL WHERE id = ?").bind(shaderId).run();
    await check(drawn(), judgeSays({ fake_reward: "FREE ROBUX" }));
    expect(await shaderNow()).toMatchObject({ review_status: "pending" });
    expect((await gameById(env.DB, gameId))!.review_status).toBe("held");
  });

  it("leaves a safety concern for a person", async () => {
    await check(drawn(), judgeSays({ has_safety_concern: true }));
    const shader = await shaderNow();
    expect(shader).toMatchObject({ review_status: "pending" });
    expect(await qualityChecksNow()).toEqual([{ quality_level: 0, check_frame_ms: 20, maximum_check_frame_ms: 75 }]);
    expect(shader.checked_at_ms).not.toBeNull();
  });

  it("approves a clean one with what it measured, its still and its frames", async () => {
    await check(drawn());
    expect(await shaderNow()).toMatchObject({ review_status: "approved", review_reason: null, flash_count: 0 });
    expect(await env.GAMES.head(shaderStillKey(gameId, shaderId))).not.toBeNull();
    for (let frameIndex = 0; frameIndex < SHADER_LIMITS.sampledFrameCount; frameIndex++) expect(await env.GAMES.head(shaderFrameKey(gameId, shaderId, frameIndex))).not.toBeNull();
    // Checked once: a second message for it changes nothing.
    await check(drawn({ compileError: "nope" }));
    expect((await shaderNow()).review_status).toBe("approved");
  });
});

describe("what the renderer is asked to draw", () => {
  it("is the passes in order, buffers a to d then the image pass, each wrapped, with the textures its channels read", async () => {
    const texture = await addImage(env.DB, { id: "image_nebula000000000000", game_id: gameId, kind: "shader_texture", content_type: "image/png", width_px: 256, height_px: 256, size_bytes: 8 });
    await settleImage(env.DB, texture, null, "check");
    await env.GAMES.put(imageKey(texture), PNG);
    const manifest: ShaderManifest = {
      image: { source: "void mainImage(out vec4 c, in vec2 f) { c = texture(iChannel0, f / iResolution.xy) + texture(iChannel1, f / iResolution.xy); }", channels: [{ channel_index: 0, input_kind: "buffer", buffer_name: "a", image_id: null, filter: "linear", wrap: "clamp" }, { channel_index: 1, input_kind: "texture", buffer_name: null, image_id: texture.id, filter: "linear", wrap: "repeat" }] },
      buffers: [
        { buffer_name: "b", source: "void mainImage(out vec4 c, in vec2 f) { c = vec4(0.5); }", channels: [] },
        { buffer_name: "a", source: "void mainImage(out vec4 c, in vec2 f) { c = texture(iChannel0, f / iResolution.xy) * 0.9; }", channels: [{ channel_index: 0, input_kind: "buffer", buffer_name: "a", image_id: null, filter: "linear", wrap: "clamp" }] },
      ],
    };
    const input = await shaderRenderInput(testEnv, gameId, "wide", manifest, false);
    expect(input.passes.map((pass) => pass.bufferName)).toEqual(["a", "b", null]);
    expect(input.passes[0]!.fragmentSource).toBe(SHADER_HEAD + manifest.buffers[1]!.source + "\n" + BUFFER_PASS);
    expect(input.passes[2]!.fragmentSource).toBe(SHADER_HEAD + manifest.image.source + "\n" + GLASS_LIGHT_PASS);
    expect(input.textures).toEqual([{ imageId: texture.id, bytes: PNG }]);
    expect(input.qualityLevels).toEqual([0]);
    expect(input.referenceSource).toBe(CHECK_REFERENCE_SHADER);
  });

  it("times the frozen reference, today's Zaisma's own as the levels were set, never the gallery's newest", () => {
    // A new Zaisma's own background never moves every game's limit: the reference is a copy (CHECK_REFERENCE_SHADER).
    expect(CHECK_REFERENCE_SHADER).toContain("void mainImage(out vec4 o, in vec2 f)");
    expect(CHECK_REFERENCE_SHADER.startsWith("#version 300 es\n")).toBe(true);
    expect(CHECK_REFERENCE_SHADER).toContain("uniform float iDark;");
  });
});

/** WebGL2's GLSL reserves and builds in names WebGL1's didn't: a shader that uses one as its own doesn't compile there. */
const ES3_ONLY_NAMES = ["texture", "textureSize", "textureLod", "texelFetch", "round", "roundEven", "trunc", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh", "isnan", "isinf", "modf", "determinant", "inverse", "outerProduct", "transpose", "floatBitsToInt", "intBitsToFloat"];
const ES3_RESERVED_WORDS = ["layout", "centroid", "flat", "smooth", "uint", "uvec2", "uvec3", "uvec4", "switch", "case", "default", "sample", "patch", "filter", "input", "output", "common", "partition", "active", "superp", "resource", "subroutine", "noperspective", "coherent", "readonly", "writeonly"];

/** What would keep a pass from compiling under SHADER_HEAD that a text check can see: WebGL1's names, and ES 3.00's own names used as a shader's. */
function webgl2Problems(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
  const problems: string[] = [];
  const sourceProblem = shaderSourceProblem(code);
  if (sourceProblem) problems.push(sourceProblem);
  for (const old of ["texture2D", "textureCube", "gl_FragColor", "gl_FragData", "varying", "attribute"]) if (new RegExp(`\\b${old}\\b`).test(code)) problems.push(`uses ${old}, WebGL1's`);
  for (const name of ES3_ONLY_NAMES) if (new RegExp(`\\b(float|int|vec[234]|mat[234]|bool|void)\\s+${name}\\b`).test(code)) problems.push(`declares ${name}, which WebGL2 builds in`);
  for (const word of ES3_RESERVED_WORDS) if (new RegExp(`\\b${word}\\b`).test(code)) problems.push(`uses ${word}, a word WebGL2 reserves`);
  // Every uniform a pass may read comes from the head; one of its own of the same name is declared twice.
  for (const name of ["iResolution", "iTime", "iTimeDelta", "iFrame", "iQuality", "iChannel0", "iChannelResolution", "iGlassPanes", "iGlassPaneCount"]) if (new RegExp(`uniform\\s+\\w+\\s+${name}\\b`).test(code)) problems.push(`declares ${name} again`);
  return problems;
}

/** A page that compiles fragment shaders in WebGL2 and answers each one's first error, or null. */
const COMPILE_PAGE = `<!doctype html><body><script>
window.compileAll = function (sources) {
  var gl = document.createElement("canvas").getContext("webgl2");
  return sources.map(function (source) { var shader = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(shader, source); gl.compileShader(shader); return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? null : gl.getShaderInfoLog(shader); });
};
</script>`;

describe("WebGL2's GLSL", () => {
  it("compiles every stand-in world and Zaisma's own in the check's Chromium", async (context) => {
    const binding = (env as unknown as { BROWSER?: Fetcher }).BROWSER;
    if (!binding) return context.skip();
    const shaders = [...STAND_IN_BACKGROUNDS.map((standIn) => wrapShader(`${SHADER_HELPERS}${standIn.shader}`)), wrapShader(`uniform float iDark;\n${SHADER_HELPERS}${ZAISMA_SHADER}`), CHECK_REFERENCE_SHADER];
    const browser = await puppeteer.launch(binding);
    try {
      const page = await browser.newPage();
      await page.setContent(COMPILE_PAGE);
      const errors = (await page.evaluate(`window.compileAll(${JSON.stringify(shaders)})`)) as (string | null)[];
      expect(Object.fromEntries(errors.map((error, index) => [STAND_IN_BACKGROUNDS[index]?.slug ?? (index === STAND_IN_BACKGROUNDS.length ? "zaisma" : "reference"), error]))).toEqual(Object.fromEntries([...STAND_IN_BACKGROUNDS.map((standIn) => [standIn.slug, null]), ["zaisma", null], ["reference", null]]));
    } finally {
      await browser.close();
    }
  }, 120_000);

  it("takes every stand-in world and Zaisma's own: nothing WebGL1-only, and no name WebGL2 keeps for itself", () => {
    expect(STAND_IN_BACKGROUNDS).toHaveLength(10);
    for (const standIn of STAND_IN_BACKGROUNDS) expect(webgl2Problems(`${SHADER_HELPERS}${standIn.shader}`), standIn.slug).toEqual([]);
    expect(webgl2Problems(`uniform float iDark;\n${SHADER_HELPERS}${ZAISMA_SHADER}`)).toEqual([]);
  });

  it("is what every pass compiles: #version 300 es first, every input declared once, line numbers the developer's own", () => {
    const wrapped = wrapShader(ONE_PASS);
    expect(wrapped.startsWith("#version 300 es\n")).toBe(true);
    for (const input of ["uniform vec3 iResolution;", "uniform float iTime;", "uniform float iTimeDelta;", "uniform int iFrame;", "uniform float iQuality;", "uniform sampler2D iChannel3;", "uniform vec3 iChannelResolution[4];", "uniform vec4 iGlassPanes[16];", "uniform int iGlassPaneCount;"]) expect(wrapped.split(input)).toHaveLength(2);
    expect(wrapped).toContain(`#line 1\n${ONE_PASS}\n`);
    // The image pass writes one colour, and reads the glass from the inputs a shader can read too.
    expect(GLASS_LIGHT_PASS).toContain("out vec4 zaismaFragColor;");
    expect(GLASS_LIGHT_PASS).toContain("iGlassPanes[i]");
    expect(GLASS_LIGHT_PASS).not.toContain("gl_FragColor");
    expect(BUFFER_PASS).toContain("zaismaFragColor = color;");
  });

  it("is caught as WebGL1 when a pass still speaks it", () => {
    expect(webgl2Problems("void mainImage(out vec4 c, in vec2 f) { c = texture2D(iChannel0, f); }").join()).toContain("texture2D");
    expect(webgl2Problems("float round(float x) { return floor(x + 0.5); }\nvoid mainImage(out vec4 c, in vec2 f) { c = vec4(round(0.4)); }").join()).toContain("round");
    expect(webgl2Problems("void mainImage(out vec4 c, in vec2 f) { float smooth = 1.0; c = vec4(smooth); }").join()).toContain("smooth");
  });
});

/** Two frames that move smoothly: a gradient sliding by a pixel. */
async function framePair(colorAt: (x: number, y: number, frameIndex: number) => [number, number, number]) {
  return [await png(160, 90, (x, y) => colorAt(x, y, 0)), await png(160, 90, (x, y) => colorAt(x, y, 1))];
}
const pixelsOf = async (pngBytes: Uint8Array) => (await pngPixels(pngBytes))!;
const hash = (x: number, y: number, seed: number) => Math.abs(Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453) % 1;

describe("the notes a check before sending gives", () => {
  it("call smooth motion calm, and noise picked anew every frame shimmer", async () => {
    const [slideFirst, slideSecond] = await framePair((x, y, frameIndex) => [((x + frameIndex) * 2) % 256, y * 2, 120]);
    const smooth = frameShimmer(await pixelsOf(slideFirst!), await pixelsOf(slideSecond!), 160, 90);
    expect(smooth.speckledTilePct).toBeLessThan(SHIMMER_LIMITS.shimmeringTilePct);
    const [noiseFirst, noiseSecond] = await framePair((x, y, frameIndex) => { const value = Math.round(hash(x, y, frameIndex) * 255); return [value, value, value]; });
    const noisy = frameShimmer(await pixelsOf(noiseFirst!), await pixelsOf(noiseSecond!), 160, 90);
    expect(noisy.speckledTilePct).toBeGreaterThanOrEqual(SHIMMER_LIMITS.shimmeringTilePct);
    // A frame that doesn't move doesn't shimmer either.
    expect(frameShimmer(await pixelsOf(noiseFirst!), await pixelsOf(noiseFirst!), 160, 90).speckledTilePct).toBe(0);
  });

  it("answers what the check would measure, the notes and a sheet kept a day, matched first like every picture", async () => {
    const game = (await gameById(env.DB, gameId))!;
    const [noiseFirst, noiseSecond] = await Promise.all([0, 1].map((frameIndex) => png(SHADER_LIMITS.checkWidthPx, SHADER_LIMITS.checkHeightPx, (x, y) => { const value = Math.round(hash(x, y, frameIndex) * 255); return [value, value, value]; })));
    // A still of hard white highlights over black: words over it need thick glass.
    const harsh = await png(64, 36, (x) => (x % 2 ? [255, 255, 255] : [0, 0, 0]));
    const asked: ShaderRenderInput[] = [];
    const answer = await runShaderDraft(testEnv, game, "wide", { image: { source: ONE_PASS, channels: [] }, buffers: [] }, { render: renders(drawn({ smallStillPng: harsh, shimmerPngs: [noiseFirst!, noiseSecond!], sheetPng: PNG }), asked), images: connectedImages });
    expect(asked[0]!.isSheetWanted).toBe(true);
    expect(schemaProblems(SHADER_CHECK, answer)).toEqual([]);
    expect(answer).toMatchObject({ compile_error: null, quality_checks: [{ quality_level: 0, check_frame_ms: 20, maximum_check_frame_ms: 75 }], flash_count: 0 });
    expect(answer.glass_tint_pct).toBeGreaterThanOrEqual(THICK_GLASS_TINT_PCT);
    expect(answer.notes.map((note) => note.code)).toEqual(["shimmers_when_small", "forces_thick_glass"]);
    expect(answer.sheet_url).toMatch(/^https:\/\/zaisma\.test\/shader-checks\/[a-f0-9]{32}\.png$/);
    expect(Date.parse(answer.sheet_expires_at!) - Date.now()).toBeGreaterThan(23 * 3600_000);

    // The sheet is anyone's with its link, for a day, never cached in public.
    const sheet = await SELF.fetch(answer.sheet_url!);
    expect(sheet.status).toBe(200);
    expect(sheet.headers.get("content-type")).toBe("image/png");
    expect(sheet.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(sheet.headers.get("x-robots-tag")).toBe("noindex");
    await sheet.arrayBuffer();
    const sheetPath = new URL(answer.sheet_url!).pathname.slice("/shader-checks/".length);
    expect((await serveShaderCheckSheet(new Request(answer.sheet_url!), testEnv, sheetPath, Date.now() + 2 * 24 * 3600_000)).status).toBe(404);
    expect(await deleteOldShaderChecks(testEnv, Date.now() + 2 * 24 * 3600_000)).toBeGreaterThanOrEqual(1);
    expect(await env.GAMES.head(shaderCheckSheetKey(sheetPath.replace(".png", "")))).toBeNull();
  });

  it("keeps no sheet image matching couldn't clear, and holds one that matches known abuse material", async () => {
    const game = (await gameById(env.DB, gameId))!;
    const manifest: ShaderManifest = { image: { source: ONE_PASS, channels: [] }, buffers: [] };
    const notConnected: ImageMatcher = { check: async (media) => ({ provider: "test", isConnected: false, checkedMediaCount: media.length, findings: [] }) };
    expect((await runShaderDraft(testEnv, game, "wide", manifest, { render: renders(drawn({ sheetPng: PNG })), images: notConnected })).sheet_url).toBeNull();
    const matching: ImageMatcher = { check: async (media) => ({ provider: "test", isConnected: true, checkedMediaCount: media.length, findings: [{ stage: "images", severity: "hold", code: KNOWN_IMAGE_CODE, message: "Matched.", path: media[0]!.path }] }) };
    expect((await runShaderDraft(testEnv, game, "wide", manifest, { render: renders(drawn({ sheetPng: PNG })), images: matching })).sheet_url).toBeNull();
    expect((await env.GAMES.list({ prefix: `held-images/${gameId}/shader-check-` })).objects).toHaveLength(1);
  });

  it("answers a compiler's error alone, and no notes for a calm shader that keeps thin glass", async () => {
    const game = (await gameById(env.DB, gameId))!;
    const manifest: ShaderManifest = { image: { source: ONE_PASS, channels: [] }, buffers: [] };
    const failed = await runShaderDraft(testEnv, game, "phone", manifest, { render: renders(drawn({ compileError: "buffer a: ERROR: 0:3: 'x' : undeclared identifier" })), images: connectedImages });
    expect(failed).toEqual({ compile_error: "It didn't compile: buffer a: ERROR: 0:3: 'x' : undeclared identifier.", quality_checks: [], flash_count: null, is_glass_smoked: null, glass_tint_pct: null, notes: [], sheet_url: null, sheet_expires_at: null });
    const calm = await runShaderDraft(testEnv, game, "phone", manifest, { render: renders(drawn({ smallStillPng: await png(32, 18, () => [70, 90, 140]) })), images: connectedImages });
    expect(calm.notes).toEqual([]);
    expect(calm.is_glass_smoked).toBe(true);
  });
});
