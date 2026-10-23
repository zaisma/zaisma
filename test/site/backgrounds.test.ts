import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { AREA_ACCESS_BY_LEVEL, SHADER_LIMITS, createAccount, createApiKey, gameBySlug, personOwner, settleShader, shaderStillKey } from "@zaisma/core";
import { errorProblems, schemaProblems } from "../schema-check.ts";
import { BACKGROUND, GAME, IMAGE, SHADER, SHADER_CHECK } from "../../apps/site/src/schemas.ts";
import { letPublish } from "../helpers.ts";

/** Backgrounds through the developer API (Backgrounds in docs/DEVELOPER-API.md): shaders with their buffers and textures, checks before sending, choosing what each screen shows, and the glass tint. */

const SITE = "https://zaisma.test";
const SHADER_SOURCE = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n  vec2 uv = fragCoord / iResolution.xy;\n  fragColor = vec4(uv, 0.5 + 0.5 * sin(iTime), 1.0);\n}\n";

let token = "";
let other = "";

/** The smallest PNG header with a chosen size: enough for the API to take it. */
function png(widthPx: number, heightPx: number): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, widthPx);
  new DataView(bytes.buffer).setUint32(20, heightPx);
  return bytes;
}

async function api(path: string, init: { method?: string; body?: unknown; text?: string; raw?: Uint8Array; key?: string } = {}) {
  const response = await SELF.fetch(`${SITE}/api/dev${path}`, {
    method: init.method ?? (init.body || init.text !== undefined || init.raw ? "POST" : "GET"),
    headers: { authorization: `Bearer ${init.key ?? token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.raw ?? init.text ?? (init.body ? JSON.stringify(init.body) : undefined),
  });
  if (!response.ok) expect(errorProblems(await response.clone().json(), response.status)).toEqual([]);
  return response;
}
const refusal = async (response: Response) => ((await response.json()) as { error: { code: string; field: string | null; fix: string } }).error;
const sendShader = async (screen: string, text = SHADER_SOURCE) => api("/games/worlds/shaders", { body: { screen, image: { source: text } } });
const sendWhole = async (body: Record<string, unknown>, path = "shaders") => api(`/games/worlds/${path}`, { body });
type ShaderAnswer = { id: string; review_status: string; still_url: string | null; image: { source_url: string; channels: unknown[] }; buffers: { buffer_name: string; source_url: string; channels: unknown[] }[]; has_quality_levels: boolean; texture_image_ids: string[]; texture_count: number; buffer_count: number };
const shaderOf = async (response: Response) => ((await response.json()) as { shader: ShaderAnswer }).shader;
const choose = (screen: string, body: Record<string, unknown>, key?: string) => api(`/games/worlds/backgrounds/${screen}`, { method: "PUT", body, key });
const approve = async (shaderId: string) => settleShader(env.DB, { id: shaderId }, null, [{ quality_level: 0, check_frame_ms: 20, maximum_check_frame_ms: 75 }], 0);
const trail = (channels: unknown[] = [{ channel_index: 0, input_kind: "buffer", buffer_name: "a" }]) => ({
  screen: "wide",
  image: { source: "void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = texture(iChannel0, fragCoord / iResolution.xy); }", channels },
  buffers: [{ buffer_name: "a", source: "void mainImage(out vec4 fragColor, in vec2 fragCoord) { vec2 uv = fragCoord / iResolution.xy; fragColor = texture(iChannel0, uv) * pow(0.5, iTimeDelta) + vec4(step(distance(uv, vec2(0.5 + 0.3 * sin(iTime), 0.5)), 0.02)); }", channels: [{ channel_index: 0, input_kind: "buffer", buffer_name: "a" }] }],
});
/** A texture sent and approved, as image matching would approve it, by a person on /admin. */
const sendTexture = async (widthPx = 256, heightPx = 256) => {
  const response = await api("/games/worlds/images?kind=shader_texture", { raw: png(widthPx, heightPx) });
  return response;
};
const approveImage = (id: string) => SELF.fetch(`http://localhost/admin/images/${id}/approve`, { method: "POST", body: new URLSearchParams({}) });

beforeEach(async () => {
  await env.DB.exec("DELETE FROM game_backgrounds; DELETE FROM game_shaders; DELETE FROM game_images; DELETE FROM api_keys; DELETE FROM audit_log; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;");
  await createAccount(env.DB, { id: "dev-1", username: "Pixel_Smith", ageBand: "18+" });
  await letPublish(env.DB, "dev-1");
  await createAccount(env.DB, { id: "dev-2", username: "Other_Dev", ageBand: "18+" });
  token = (await createApiKey(env.DB, "dev-1", "laptop")).token;
  other = (await createApiKey(env.DB, "dev-2", "laptop")).token;
  await api("/games", { body: { title: "Worlds" } });
});

describe("sending a shader", () => {
  it("takes it pending, with get_game next", async () => {
    const response = await sendShader("wide");
    expect(response.status).toBe(201);
    const answer = (await response.json()) as { shader: unknown; next_steps: { tool: string; after_sec: number }[] };
    expect(schemaProblems(SHADER, answer.shader)).toEqual([]);
    expect(answer.shader).toMatchObject({ screen: "wide", review_status: "pending", quality_checks: [], has_quality_levels: false, flash_count: null, still_url: null, frame_urls: [], buffers: [], buffer_count: 0, texture_count: 0, texture_image_ids: [] });
    expect(answer.next_steps).toEqual([expect.objectContaining({ tool: "get_game", after_sec: 60 })]);
  });

  it("refuses what isn't a background shader", async () => {
    // Each pass is up to 64 KB, where 16 KB was the most before.
    expect((await sendShader("wide", `${SHADER_SOURCE}// ${"x".repeat(17 * 1024)}`)).status).toBe(201);
    expect(await refusal(await sendShader("wide", `${SHADER_SOURCE}// ${"x".repeat(SHADER_LIMITS.maximumPassSizeBytes)}`))).toMatchObject({ code: "shader_too_big", field: "image.source" });
    expect(await refusal(await sendShader("wide", `#extension GL_OES_standard_derivatives : enable\n${SHADER_SOURCE}`))).toMatchObject({ code: "not_a_shader", field: "image.source" });
    expect(await refusal(await sendShader("wide", "void main() { gl_FragColor = vec4(1.0); }"))).toMatchObject({ code: "not_a_shader" });
    expect(await refusal(await sendShader("wide", `${SHADER_SOURCE}void main() { }`))).toMatchObject({ code: "not_a_shader" });
    // WebGL2's GLSL: textures are read with texture(), and a message says so for WebGL1's texture2D.
    const webgl1 = await refusal(await sendShader("wide", SHADER_SOURCE.replace("vec4(uv", "texture2D(iChannel0, uv) + vec4(uv")));
    expect(webgl1).toMatchObject({ code: "not_a_shader" });
    expect(webgl1.fix).toContain("WebGL2");
    expect(await refusal(await sendShader("wide", SHADER_SOURCE.replace("iTime", "iMouse.x")))).toMatchObject({ code: "not_a_shader" });
    expect(await refusal(await sendShader("sideways"))).toMatchObject({ code: "bad_screen", field: "screen" });
    expect(await refusal(await sendWhole({ screen: "wide" }))).toMatchObject({ code: "missing_field", field: "image" });
    expect(await refusal(await sendWhole({ screen: "wide", source: SHADER_SOURCE }))).toMatchObject({ code: "unknown_field", field: "source" });
    expect(await refusal(await sendWhole({ screen: "wide", image: { source: SHADER_SOURCE, textures: [] } }))).toMatchObject({ code: "unknown_field", field: "image.textures" });
    // The old way, the GLSL as the whole body, isn't JSON.
    expect(await refusal(await api("/games/worlds/shaders", { text: SHADER_SOURCE }))).toMatchObject({ code: "bad_json" });
  });

  it("takes buffers that keep their picture between frames, each read through a channel, and serves each pass's source", async () => {
    const response = await sendWhole(trail());
    expect(response.status).toBe(201);
    const shader = await shaderOf(response);
    expect(schemaProblems(SHADER, shader)).toEqual([]);
    expect(shader).toMatchObject({ buffer_count: 1, texture_count: 0 });
    expect(shader.image.channels).toEqual([{ channel_index: 0, input_kind: "buffer", buffer_name: "a", image_id: null, filter: "linear", wrap: "clamp" }]);
    expect(shader.buffers).toEqual([{ buffer_name: "a", source_url: `${SITE}/shaders/${shader.id}/buffer-a.glsl`, channels: [{ channel_index: 0, input_kind: "buffer", buffer_name: "a", image_id: null, filter: "linear", wrap: "clamp" }] }]);
    // The developer's alone until it's approved, then anyone's.
    expect((await SELF.fetch(`${SITE}/shaders/${shader.id}/buffer-a.glsl`)).status).toBe(404);
    await approve(shader.id);
    const buffer = await SELF.fetch(`${SITE}/shaders/${shader.id}/buffer-a.glsl`);
    expect(await buffer.text()).toBe(trail().buffers[0]!.source);
    expect((await SELF.fetch(`${SITE}/shaders/${shader.id}/buffer-b.glsl`)).status).toBe(404);
    expect(await (await SELF.fetch(shader.image.source_url)).text()).toBe(trail().image.source);
  });

  it("refuses buffers and channels that don't hold together", async () => {
    const five = { ...trail(), buffers: ["a", "b", "c", "d", "a"].map((buffer_name) => ({ buffer_name, source: SHADER_SOURCE })) };
    expect(await refusal(await sendWhole(five))).toMatchObject({ code: "too_many_buffers", field: "buffers" });
    expect(await refusal(await sendWhole({ ...trail(), buffers: [{ buffer_name: "a", source: SHADER_SOURCE }, { buffer_name: "a", source: SHADER_SOURCE }] }))).toMatchObject({ code: "bad_buffers", field: "buffers[1].buffer_name" });
    expect(await refusal(await sendWhole({ ...trail(), buffers: [{ buffer_name: "e", source: SHADER_SOURCE }] }))).toMatchObject({ code: "bad_buffers", field: "buffers[0].buffer_name" });
    expect(await refusal(await sendWhole(trail([{ channel_index: 0, input_kind: "buffer", buffer_name: "b" }])))).toMatchObject({ code: "bad_shader_channel", field: "image.channels[0].buffer_name" });
    expect(await refusal(await sendWhole(trail([{ channel_index: 4, input_kind: "buffer", buffer_name: "a" }])))).toMatchObject({ code: "bad_shader_channel", field: "image.channels[0].channel_index" });
    expect(await refusal(await sendWhole(trail([{ channel_index: 0, input_kind: "buffer", buffer_name: "a" }, { channel_index: 0, input_kind: "buffer", buffer_name: "a" }])))).toMatchObject({ code: "bad_shader_channel", field: "image.channels[1].channel_index" });
    expect(await refusal(await sendWhole(trail([{ channel_index: 0, input_kind: "video" }])))).toMatchObject({ code: "bad_shader_channel", field: "image.channels[0].input_kind" });
    expect(await refusal(await sendWhole(trail([{ channel_index: 0, input_kind: "buffer", buffer_name: "a", mipmaps: true }])))).toMatchObject({ code: "unknown_field", field: "image.channels[0].mipmaps" });
    expect(await refusal(await sendWhole(trail([{ channel_index: 1, input_kind: "texture", image_id: "shader_8f3k2m9q1x7c4v6b0n5z" }])))).toMatchObject({ code: "wrong_id_kind", field: "image.channels[0].image_id" });
    expect(await refusal(await sendWhole(trail([{ channel_index: 1, input_kind: "texture", image_id: "image_8f3k2m9q1x7c4v6b0n5z" }])))).toMatchObject({ code: "bad_shader_channel", field: "image.channels[0].image_id" });
  });

  it("knows when it reads iQuality, and isn't fooled by a comment", async () => {
    expect((await shaderOf(await sendShader("wide", SHADER_SOURCE.replace("0.5 + 0.5", "0.25 * iQuality + 0.5")))).has_quality_levels).toBe(true);
    expect((await shaderOf(await sendShader("wide", `// iQuality could make this lighter\n${SHADER_SOURCE}`))).has_quality_levels).toBe(false);
  });

  it("keeps a screen's newest few besides the one it shows", async () => {
    const chosen = await shaderOf(await sendShader("wide"));
    await approve(chosen.id);
    expect((await choose("wide", { source: "shader", shader_id: chosen.id })).status).toBe(200);
    for (let index = 0; index < 6; index++) await sendShader("wide");
    await sendShader("phone");
    const { shaders } = (await (await api("/games/worlds")).json()) as { shaders: { id: string; screen: string }[] };
    expect(shaders.filter((shader) => shader.screen === "wide")).toHaveLength(5);
    expect(shaders.map((shader) => shader.id)).toContain(chosen.id);
    expect(shaders.filter((shader) => shader.screen === "phone")).toHaveLength(1);
  });
});

describe("choosing a background", () => {
  it("has both screens' defaults until one is chosen", async () => {
    const answer = (await (await api("/games/worlds")).json()) as { game: unknown; backgrounds: unknown[]; shaders: unknown[] };
    expect(schemaProblems(GAME, answer.game)).toEqual([]);
    for (const background of answer.backgrounds) expect(schemaProblems(BACKGROUND, background)).toEqual([]);
    expect(answer.backgrounds).toEqual([
      { screen: "wide", source: "zaisma", image_id: null, shader_id: null, still_url: null },
      { screen: "phone", source: "wide", image_id: null, shader_id: null, still_url: null },
    ]);
    expect(answer.shaders).toEqual([]);
  });

  it("shows a shader only once it passed, and only on the screen it was sent for", async () => {
    const shader = await shaderOf(await sendShader("wide"));
    expect(await refusal(await choose("wide", { source: "shader", shader_id: shader.id }))).toMatchObject({ code: "background_not_ready", field: "shader_id" });
    await approve(shader.id);
    expect(await refusal(await choose("phone", { source: "shader", shader_id: shader.id }))).toMatchObject({ code: "background_not_ready" });
    const chosen = await choose("wide", { source: "shader", shader_id: shader.id });
    expect(chosen.status).toBe(200);
    const { background } = (await chosen.json()) as { background: unknown };
    expect(schemaProblems(BACKGROUND, background)).toEqual([]);
    expect(background).toEqual({ screen: "wide", source: "shader", image_id: null, shader_id: shader.id, still_url: `${SITE}/shaders/${shader.id}/still.png` });
  });

  it("lets only phones follow wide, and keeps each ID with its own source", async () => {
    expect(await refusal(await choose("wide", { source: "wide" }))).toMatchObject({ code: "bad_background_source", field: "source" });
    expect(await refusal(await choose("wide", { source: "video" }))).toMatchObject({ code: "bad_background_source" });
    expect(await refusal(await choose("wide", { source: "zaisma", image_id: "image_8f3k2m9q1x7c4v6b0n5z" }))).toMatchObject({ code: "bad_background_source", field: "image_id" });
    expect(await refusal(await choose("sideways", { source: "zaisma" }))).toMatchObject({ code: "bad_screen" });
    expect((await choose("phone", { source: "wide" })).status).toBe(200);
    expect((await choose("phone", { source: "zaisma" })).status).toBe(200);
  });

  it("is the developer's own: a stranger finds no game, and a read-only key can't choose", async () => {
    expect(await refusal(await choose("wide", { source: "zaisma" }, other))).toMatchObject({ code: "no_game" });
    expect(await refusal(await api("/games/worlds/shaders", { body: { screen: "wide", image: { source: SHADER_SOURCE } }, key: other }))).toMatchObject({ code: "no_game" });
    const readOnly = (await createApiKey(env.DB, "dev-1", "read only", { accessLevel: "custom", areaAccess: { ...AREA_ACCESS_BY_LEVEL.read }, gameSlugs: null })).token;
    expect(await refusal(await choose("wide", { source: "zaisma" }, readOnly))).toMatchObject({ code: "key_not_allowed" });
  });

  it("goes back to the default when the shader it shows is removed", async () => {
    const shader = await shaderOf(await sendShader("phone"));
    await approve(shader.id);
    await choose("phone", { source: "shader", shader_id: shader.id });
    const removed = await api(`/games/worlds/shaders/${shader.id}`, { method: "DELETE" });
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as { backgrounds: { source: string }[] }).backgrounds.map((background) => background.source)).toEqual(["zaisma", "wide"]);
    expect(await refusal(await api(`/games/worlds/shaders/${shader.id}`, { method: "DELETE" }))).toMatchObject({ code: "no_shader" });
    expect(await refusal(await api("/games/worlds/shaders/image_8f3k2m9q1x7c4v6b0n5z", { method: "DELETE" }))).toMatchObject({ code: "wrong_id_kind" });
  });
});

describe("background pictures", () => {
  it("takes backgrounds in their screen's shape, and hands a chosen one's place to the one replacing it", async () => {
        const add = async (kind: string, widthPx: number, heightPx: number) => api(`/games/worlds/images?kind=${kind}`, { raw: png(widthPx, heightPx) });
    const approve = (id: string) => SELF.fetch(`http://localhost/admin/images/${id}/approve`, { method: "POST", body: new URLSearchParams({}) });
    const wide = await add("background", 2400, 1200);
    expect(wide.status).toBe(201);
    const portrait = await add("background", 1200, 2400);
    expect(portrait.status).toBe(400);
    expect(await refusal(portrait)).toMatchObject({ code: "bad_background_shape", field: "image_base64" });
    expect((await add("phone_background", 1200, 2400)).status).toBe(201);
    // At least 1600 px on the long side: 1600 is enough, 1500 isn't.
    expect((await add("phone_background", 900, 1600)).status).toBe(201);
    expect(await refusal(await add("phone_background", 800, 1500))).toMatchObject({ code: "bad_background_shape" });
    expect(await refusal(await add("background", 2400, 2300))).toMatchObject({ code: "bad_background_shape" });

    const first = ((await wide.json()) as { image: { id: string } }).image.id;
    await approve(first);
    expect((await api("/games/worlds/backgrounds/wide", { method: "PUT", body: { source: "image", image_id: first } })).status).toBe(200);
    const newer = ((await (await add("background", 2560, 1440)).json()) as { image: { id: string } }).image.id;
    await approve(newer);
    const { images, backgrounds } = (await (await api("/games/worlds")).json()) as { images: { id: string; kind: string }[]; backgrounds: { screen: string; source: string; image_id: string | null }[] };
    expect(images.filter((image) => image.kind === "background").map((image) => image.id)).toEqual([newer]);
    expect(backgrounds[0]).toMatchObject({ screen: "wide", source: "image", image_id: newer });
  });
});

describe("shader textures", () => {
  it("are pictures of their own size, up to 4096 px a side and 8 MB, with no shape to keep", async () => {
    const small = await sendTexture(64, 64);
    expect(small.status).toBe(201);
    const { image } = (await small.json()) as { image: { id: string; kind: string; review_status: string } };
    expect(schemaProblems(IMAGE, image)).toEqual([]);
    // Image matching can't run in tests, so a person approves it, as for any picture.
    expect(image).toMatchObject({ kind: "shader_texture", review_status: "pending" });
    expect((await sendTexture(4096, 1024)).status).toBe(201);
    expect(await refusal(await sendTexture(4097, 1024))).toMatchObject({ code: "shader_texture_too_big", field: "image_base64" });
    // Several wait at once: a new one never replaces another.
    const { images } = (await (await api("/games/worlds")).json()) as { images: { kind: string }[] };
    expect(images.filter((each) => each.kind === "shader_texture")).toHaveLength(2);
  });

  it("are up to 16 a game", async () => {
    const game = (await gameBySlug(env.DB, "worlds"))!;
    await env.DB.batch(Array.from({ length: SHADER_LIMITS.maximumGameTextureCount }, (_, index) => env.DB.prepare("INSERT INTO game_images (id, game_id, kind, content_type, width_px, height_px, size_bytes, review_status, created_at_ms) VALUES (?, ?, 'shader_texture', 'image/png', 64, 64, 64, 'approved', ?)").bind(`image_texture${index}aaaaaaaaaa`, game.id, index)));
    expect(await refusal(await sendTexture())).toMatchObject({ code: "too_many_shader_textures" });
  });

  it("are read by a channel once approved, and can't go while a shader reads them", async () => {
    const { image } = (await (await sendTexture()).json()) as { image: { id: string } };
    const withTexture = trail([{ channel_index: 0, input_kind: "buffer", buffer_name: "a" }, { channel_index: 1, input_kind: "texture", image_id: image.id }]);
    expect(await refusal(await sendWhole(withTexture))).toMatchObject({ code: "bad_shader_channel", field: "image.channels[1].image_id" });
    await approveImage(image.id);
    const shader = await shaderOf(await sendWhole(withTexture));
    expect(shader).toMatchObject({ texture_count: 1, texture_image_ids: [image.id] });
    expect(shader.image.channels[1]).toEqual({ channel_index: 1, input_kind: "texture", buffer_name: null, image_id: image.id, filter: "linear", wrap: "repeat" });
    expect(await refusal(await api(`/games/worlds/images/${image.id}`, { method: "DELETE" }))).toMatchObject({ code: "shader_texture_in_use", field: "image_id" });
    await api(`/games/worlds/shaders/${shader.id}`, { method: "DELETE" });
    expect((await api(`/games/worlds/images/${image.id}`, { method: "DELETE" })).status).toBe(200);
  });

  it("are never another game's, or a cover", async () => {
    const cover = ((await (await api("/games/worlds/images?kind=cover", { raw: png(1280, 720) })).json()) as { image: { id: string } }).image.id;
    await approveImage(cover);
    expect(await refusal(await sendWhole(trail([{ channel_index: 1, input_kind: "texture", image_id: cover }])))).toMatchObject({ code: "bad_shader_channel" });
  });
});

describe("checking a shader before sending it", () => {
  it("takes the same shader as add_shader, refused the same way", async () => {
    expect(await refusal(await sendWhole({ screen: "wide", image: { source: "void main() {}" } }, "shader-checks"))).toMatchObject({ code: "not_a_shader", field: "image.source" });
    expect(await refusal(await sendWhole(trail([{ channel_index: 0, input_kind: "buffer", buffer_name: "c" }]), "shader-checks"))).toMatchObject({ code: "bad_shader_channel" });
  });

  it("draws it as the check would, on the test's own Chromium, and counts it against the day", async () => {
    const response = await sendWhole({ ...trail(), image: { ...trail().image, source: trail().image.source.replace("fragColor = texture", "fragColor = (0.5 + 0.25 * iQuality) * texture") } }, "shader-checks");
    expect(response.status).toBe(200);
    const answer = (await response.json()) as { shader_check: { compile_error: string | null; quality_checks: { quality_level: number }[]; sheet_url: string | null }; remaining_shader_check_count: number; next_steps: { tool: string }[] };
    expect(schemaProblems(SHADER_CHECK, answer.shader_check)).toEqual([]);
    expect(answer.shader_check.compile_error).toBeNull();
    expect(answer.shader_check.quality_checks.map((qualityCheck) => qualityCheck.quality_level), JSON.stringify(answer.shader_check)).toEqual([0, 1, 2]);
    // Image matching can't run in tests, so no sheet is kept.
    expect(answer.shader_check.sheet_url).toBeNull();
    expect(answer.remaining_shader_check_count).toBe(SHADER_LIMITS.maximumShaderChecksPerDay - 1);
    expect(answer.next_steps.map((step) => step.tool)).toEqual(["add_shader"]);
    // A buffer that doesn't compile says which.
    const broken = await sendWhole({ ...trail(), buffers: [{ ...trail().buffers[0]!, source: trail().buffers[0]!.source.replace("iTimeDelta", "iTimeDeltaa") }] }, "shader-checks");
    expect(((await broken.json()) as { shader_check: { compile_error: string } }).shader_check.compile_error).toMatch(/^It didn't compile: buffer a: /);
    const owner = await personOwner(env.DB, "dev-1");
    const listed = await env.GAMES.list({ prefix: `shader-check-runs/${owner.id}/` });
    expect(listed.objects).toHaveLength(2);
    await env.GAMES.delete(listed.objects.map((object) => object.key));
  }, 120_000);

  it("runs up to 100 times a day for an account, then says when the oldest is a day old", async () => {
    const owner = await personOwner(env.DB, "dev-1");
    await Promise.all(Array.from({ length: SHADER_LIMITS.maximumShaderChecksPerDay }, (_, index) => env.GAMES.put(`shader-check-runs/${owner.id}/${Date.now()}-${index}`, new Uint8Array())));
    const response = await sendWhole(trail(), "shader-checks");
    expect(response.status).toBe(429);
    const error = ((await response.json()) as { error: { code: string; retry_after_sec: number; fix: string } }).error;
    expect(error).toMatchObject({ code: "daily_shader_checks_used" });
    expect(error.retry_after_sec).toBeGreaterThan(23 * 3600);
    expect(error.fix).toContain("npx @zaisma/cli check");
    const listed = await env.GAMES.list({ prefix: `shader-check-runs/${owner.id}/` });
    await env.GAMES.delete(listed.objects.map((object) => object.key));
  });

  it("is the developer's own: a stranger finds no game", async () => {
    expect(await refusal(await api("/games/worlds/shader-checks", { body: trail(), key: other }))).toMatchObject({ code: "no_game" });
  });
});

describe("the glass tint", () => {
  it("takes #RRGGBB or null, and nothing else", async () => {
    const saved = await api("/games/worlds", { method: "PATCH", body: { glass_tint_color: "#12ABEF" } });
    expect(((await saved.json()) as { game: { glass_tint_color: string } }).game.glass_tint_color).toBe("#12abef");
    expect(await refusal(await api("/games/worlds", { method: "PATCH", body: { glass_tint_color: "red" } }))).toMatchObject({ code: "bad_color", field: "glass_tint_color" });
    const cleared = await api("/games/worlds", { method: "PATCH", body: { glass_tint_color: null } });
    expect(((await cleared.json()) as { game: { glass_tint_color: string | null } }).game.glass_tint_color).toBeNull();
  });
});

describe("a shader's still, frames and source", () => {
  it("are the developer's alone until it's approved, then anyone's", async () => {
    const shader = await shaderOf(await sendShader("wide"));
    const game = (await gameBySlug(env.DB, "worlds"))!;
    // The check drew it and saved its still; it waits for a person.
    await settleShader(env.DB, { id: shader.id }, null, [{ quality_level: 0, check_frame_ms: 20, maximum_check_frame_ms: 75 }], 0, true);
    await env.GAMES.put(shaderStillKey(game.id, shader.id), new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    const guest = await SELF.fetch(`${SITE}/shaders/${shader.id}/still.png`);
    expect(guest.status).toBe(404);
    await guest.arrayBuffer();
    expect((await SELF.fetch(`${SITE}/shaders/${shader.id}/source.glsl`)).status).toBe(404);

    await approve(shader.id);
    const still = await SELF.fetch(`${SITE}/shaders/${shader.id}/still.png`);
    expect(still.status).toBe(200);
    expect(still.headers.get("content-type")).toBe("image/png");
    expect(still.headers.get("content-security-policy")).toContain("sandbox");
    await still.arrayBuffer();
    const source = await SELF.fetch(`${SITE}/shaders/${shader.id}/source.glsl`);
    expect(await source.text()).toBe(SHADER_SOURCE);
    // A frame the check never saved isn't there.
    expect((await SELF.fetch(`${SITE}/shaders/${shader.id}/frame-9.png`)).status).toBe(404);
  });
});
