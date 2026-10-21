import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { KNOWN_IMAGE_CODE, SHADER_LIMITS, addShader, createAccount, createGame, gameById, personOwner, readReviewReason, shaderById, shaderFrameKey, shaderKey, shaderStillKey, type ImageMatcher } from "@zaisma/core";
import type { Env } from "../../apps/site/src/env.ts";
import { mostFlashesInOneSecond, runShaderCheck, type ShaderRender, type ShaderRenderer } from "../../apps/site/src/shader-check.ts";
import type { ListingJudge, PictureAnswer } from "../../apps/site/src/listing-judge.ts";
import { png } from "./png-stub.ts";
import { connectedImages } from "./scan-stubs.ts";

/** The shader check (apps/site/src/shader-check.ts), with a stand-in renderer and judge: what each result does to the shader. */

const testEnv = { ...env, ANTHROPIC_API_KEY: "test-key" } as unknown as Env;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A clean drawing: steady light, quick frames, Zaisma's own drawn as fast. */
const drawn = (overrides: Partial<ShaderRender> = {}): ShaderRender => ({
  compileError: null,
  referenceFrameTimesMs: Array.from({ length: 30 }, () => SHADER_LIMITS.referenceFrameMs),
  frameTimesMs: Array.from({ length: SHADER_LIMITS.checkFrameCount }, () => 20),
  frameLuminances: Array.from({ length: SHADER_LIMITS.checkFrameCount }, (_, frameIndex) => 0.4 + 0.05 * Math.sin(frameIndex / 10)),
  stillPng: PNG,
  smallStillPng: PNG,
  framePngs: Array.from({ length: SHADER_LIMITS.sampledFrameCount }, () => PNG),
  ...overrides,
});
const renders = (render: ShaderRender): ShaderRenderer => async () => render;

const NO: PictureAnswer = { number: 0, extra_text: "", overlay: "", fake_reward: "", famous_name: "", main_subject: "", is_main_subject_in_screenshots: true, added_after_capture: "", background_text: "", has_safety_concern: false };
/** A judge answering every picture the same way. */
const judgeSays =
  (picture: Partial<PictureAnswer> = {}): ListingJudge =>
  async (_apiKey, _model, brief) => ({
    answer: { pictures: brief.pictures.map((_, index) => ({ ...NO, ...picture, number: index + 1 })), title_fake_reward: "", title_famous_name: "", title_tag: "", description_fake_reward: "", has_words_safety_concern: false },
    declinedAttemptCount: 0,
    costCents: 1,
  });

let gameId = "";
let shaderId = "";

beforeEach(async () => {
  await env.DB.exec("DELETE FROM game_backgrounds; DELETE FROM game_shaders; DELETE FROM audit_log; DELETE FROM ai_usage; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;");
  await createAccount(env.DB, { id: "dev-1", username: "Pixel_Smith", ageBand: "18+" });
  const game = await createGame(env.DB, { slug: "worlds", title: "Worlds", description: "", ownerId: (await personOwner(env.DB, "dev-1")).id });
  gameId = game.id;
  shaderId = (await addShader(env.DB, { id: `shader_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`, game_id: game.id, screen: "wide", size_bytes: 120 })).id;
  await env.GAMES.put(shaderKey(game.id, shaderId), "void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(1.0); }");
});

const check = (render: ShaderRender, judge: ListingJudge = judgeSays(), images: ImageMatcher = connectedImages) => runShaderCheck(testEnv, shaderId, { render: renders(render), judge, images });
const shaderNow = async () => (await shaderById(env.DB, shaderId))!;
const reasonNow = async () => readReviewReason((await shaderNow()).review_reason);

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

  it("rejects a shader too slow for the limit, measured against Zaisma's own drawn in the same browser", async () => {
    await check(drawn({ frameTimesMs: Array.from({ length: SHADER_LIMITS.checkFrameCount }, () => 100) }));
    expect(await shaderNow()).toMatchObject({ review_status: "rejected", check_frame_ms: 100 });
    expect(await reasonNow()).toMatchObject({ code: "shader_too_slow", message: `It took 100 ms a frame in the check; the most is ${SHADER_LIMITS.maximumCheckFrameMs}.` });
  });

  it("scales a slow renderer away: the same shader on a renderer twice as slow passes the same", async () => {
    await check(drawn({ referenceFrameTimesMs: Array.from({ length: 30 }, () => 50), frameTimesMs: Array.from({ length: SHADER_LIMITS.checkFrameCount }, () => 100) }));
    expect(await shaderNow()).toMatchObject({ review_status: "approved", check_frame_ms: 50 });
  });

  it("rejects a shader that flashes more than 3 times a second, and passes one that flashes twice", async () => {
    // Light and dark in turn, a flash every 6 frames at 30 frames a second: 5 a second.
    const flashing = Array.from({ length: SHADER_LIMITS.checkFrameCount }, (_, frameIndex) => (frameIndex % 6 < 3 ? 0.05 : 0.6));
    await check(drawn({ frameLuminances: flashing }));
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
    expect(shader).toMatchObject({ review_status: "pending", check_frame_ms: 20 });
    expect(shader.checked_at_ms).not.toBeNull();
  });

  it("approves a clean one with what it measured, its still and its frames", async () => {
    await check(drawn());
    expect(await shaderNow()).toMatchObject({ review_status: "approved", review_reason: null, check_frame_ms: 20, flash_count: 0 });
    expect(await env.GAMES.head(shaderStillKey(gameId, shaderId))).not.toBeNull();
    for (let frameIndex = 0; frameIndex < SHADER_LIMITS.sampledFrameCount; frameIndex++) expect(await env.GAMES.head(shaderFrameKey(gameId, shaderId, frameIndex))).not.toBeNull();
    // Checked once: a second message for it changes nothing.
    await check(drawn({ compileError: "nope" }));
    expect((await shaderNow()).review_status).toBe("approved");
  });
});
