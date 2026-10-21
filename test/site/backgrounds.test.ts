import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { AREA_ACCESS_BY_LEVEL, createAccount, createApiKey, gameBySlug, settleShader, shaderStillKey } from "@zaisma/core";
import { errorProblems, schemaProblems } from "../schema-check.ts";
import { BACKGROUND, GAME, SHADER } from "../../apps/site/src/schemas.ts";
import { letPublish } from "../helpers.ts";

/** Backgrounds through the developer API (Backgrounds in docs/DEVELOPER-API.md): shaders, choosing what each screen shows, and the glass tint. */

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
const sendShader = async (screen: string, text = SHADER_SOURCE) => api(`/games/worlds/shaders?screen=${screen}`, { text });
const shaderOf = async (response: Response) => ((await response.json()) as { shader: { id: string; review_status: string; still_url: string | null; source_url: string } }).shader;
const choose = (screen: string, body: Record<string, unknown>, key?: string) => api(`/games/worlds/backgrounds/${screen}`, { method: "PUT", body, key });
const approve = async (shaderId: string) => settleShader(env.DB, { id: shaderId }, null, 20, 0);

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
    expect(answer.shader).toMatchObject({ screen: "wide", review_status: "pending", check_frame_ms: null, flash_count: null, still_url: null, frame_urls: [] });
    expect(answer.next_steps).toEqual([expect.objectContaining({ tool: "get_game", after_sec: 60 })]);
  });

  it("refuses what isn't a background shader", async () => {
    expect(await refusal(await sendShader("wide", `${SHADER_SOURCE}// ${"x".repeat(17 * 1024)}`))).toMatchObject({ code: "shader_too_big" });
    expect(await refusal(await sendShader("wide", `#extension GL_OES_standard_derivatives : enable\n${SHADER_SOURCE}`))).toMatchObject({ code: "not_a_shader", field: "source" });
    expect(await refusal(await sendShader("wide", "void main() { gl_FragColor = vec4(1.0); }"))).toMatchObject({ code: "not_a_shader" });
    expect(await refusal(await sendShader("wide", SHADER_SOURCE.replace("vec4(uv", "texture2D(iChannel0, uv) + vec4(uv")))).toMatchObject({ code: "not_a_shader" });
    expect(await refusal(await sendShader("sideways"))).toMatchObject({ code: "bad_screen", field: "screen" });
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
    expect(await refusal(await api("/games/worlds/shaders?screen=wide", { text: SHADER_SOURCE, key: other }))).toMatchObject({ code: "no_game" });
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
    await settleShader(env.DB, { id: shader.id }, null, 20, 0, true);
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
