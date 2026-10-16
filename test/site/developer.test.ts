import { createExecutionContext, env, SELF } from "cloudflare:test";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountForApiKey, createAccount, createApiKey, createGame, describePlayModes, gameBySlug, imageKey, personOwner, sniffImage } from "@zaisma/core";
import worker from "../../apps/site/src/index.ts";
import { errorProblems } from "../schema-check.ts";

const SITE = "https://zaisma.test";

// Smallest real images of each kind, with a chosen size written into the header.
function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}
function jpeg(w: number, h: number): Uint8Array {
  // SOI, an APP0 segment, then SOF0 with height and width.
  const b = new Uint8Array(64);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08]);
  new DataView(b.buffer).setUint16(13, h);
  new DataView(b.buffer).setUint16(15, w);
  return b;
}
function webp(w: number, h: number): Uint8Array {
  const b = new Uint8Array(64);
  b.set(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8X"));
  b.set([(w - 1) & 0xff, ((w - 1) >> 8) & 0xff, ((w - 1) >> 16) & 0xff, (h - 1) & 0xff, ((h - 1) >> 8) & 0xff, ((h - 1) >> 16) & 0xff], 24);
  return b;
}

let token = "";
let other = "";

/** Call the developer API; every refusal must have the error's shape, a listed code and that code's HTTP status. */
async function api(path: string, init: { method?: string; body?: unknown; raw?: Uint8Array; key?: string | null } = {}) {
  const key = init.key === undefined ? token : init.key;
  const res = await SELF.fetch(`${SITE}/api/dev${path}`, {
    method: init.method ?? (init.body || init.raw ? "POST" : "GET"),
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.raw ?? (init.body ? JSON.stringify(init.body) : undefined),
  });
  if (!res.ok) expect(errorProblems(await res.clone().json(), res.status)).toEqual([]);
  return res;
}

/** An error answer's error object. */
const refusal = async (res: Response) => ((await res.json()) as { error: { code: string; field: string | null; fix: string } }).error;

beforeEach(async () => {
  await env.DB.exec(
    "DELETE FROM tester_links; DELETE FROM game_images; DELETE FROM api_keys; DELETE FROM passkeys; DELETE FROM save_history; DELETE FROM saves; DELETE FROM audit_log; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;",
  );
  await createAccount(env.DB, { id: "dev-1", name: "Pixel Smith", ageBand: "18+" });
  await createAccount(env.DB, { id: "dev-2", name: "Other Dev", ageBand: "16-17" });
  token = (await createApiKey(env.DB, "dev-1", "laptop")).token;
  other = (await createApiKey(env.DB, "dev-2", "laptop")).token;
});

describe("API keys", () => {
  it("accepts the real key and nothing close to it", async () => {
    expect(token).toMatch(/^zsk_[a-z0-9]{20}_[A-Za-z0-9_-]{43}$/);
    expect(await accountForApiKey(env.DB, token)).toBe("dev-1");
    expect(await accountForApiKey(env.DB, token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"))).toBeNull();
    expect(await accountForApiKey(env.DB, "zsk_nope")).toBeNull();
    const stored = await env.DB.prepare("SELECT * FROM api_keys WHERE account_id = 'dev-1'").first<Record<string, string>>();
    // The secret is base64url and can itself contain "_", so take everything after the second underscore.
    const secret = token.slice(token.indexOf("_", 4) + 1);
    expect(secret).toHaveLength(43);
    expect(JSON.stringify(stored)).not.toContain(secret);
  });

  it("refuses requests without a key or with a bad one", async () => {
    expect((await api("/games", { key: null })).status).toBe(401);
    const bad = await api("/games", { key: "zsk_bad" });
    expect(bad.status).toBe(401);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("bad_key");
  });
});

describe("games", () => {
  it("makes a draft game owned by the caller, hidden from players", async () => {
    const res = await api("/games", { body: { title: "Sky  Hopper", description: "Jump between clouds.", devices: ["phone", "computer"], controls: ["touch"], screen_orientation: "portrait" } });
    expect(res.status).toBe(201);
    const { game } = (await res.json()) as { game: Record<string, unknown> };
    expect(game).toMatchObject({ slug: "sky-hopper", title: "Sky Hopper", visibility: "draft", review_status: "pending", devices: ["phone", "computer"], controls: ["touch"], screen_orientation: "portrait" });

    const row = (await gameBySlug(env.DB, "sky-hopper"))!;
    expect(row.owner_id).toBe((await personOwner(env.DB, "dev-1")).id);
    expect((await SELF.fetch(`${SITE}/g/sky-hopper`)).status).toBe(404);

    const list = (await (await api("/games")).json()) as { games: { slug: string }[] };
    expect(list.games.map((g) => g.slug)).toEqual(["sky-hopper"]);
    expect(((await (await api("/games", { key: other })).json()) as { games: unknown[] }).games).toEqual([]);
  });

  it("checks titles, link names and labels", async () => {
    expect((await api("/games", { body: { title: "" } })).status).toBe(400);
    expect((await api("/games", { body: { title: "Admin", slug: "admin" } })).status).toBe(400);
    expect((await api("/games", { body: { title: "Hop", devices: ["toaster"] } })).status).toBe(400);
    expect((await api("/games", { body: { title: "Hop", screen_orientation: "sideways" } })).status).toBe(400);
    await api("/games", { body: { title: "Hop" } });
    expect((await api("/games", { body: { title: "Hop" } })).status).toBe(409);
  });

  it("says which input is wrong and what to do, with one code per problem", async () => {
    expect(await refusal(await api("/games", { body: { title: "" } }))).toMatchObject({ code: "bad_title", field: "title" });
    expect(await refusal(await api("/games", { body: { title: "Hop", devices: ["toaster"] } }))).toMatchObject({ code: "bad_devices", field: "devices", fix: expect.stringContaining("phone, tablet, computer") });
    expect(await refusal(await api("/games", { body: { title: "Hop", screen_orientation: "sideways" } }))).toMatchObject({ code: "bad_screen_orientation", field: "screen_orientation" });
    // Inputs are closed: a field the call doesn't take is an error, never quietly ignored.
    expect(await refusal(await api("/games", { body: { title: "Hop", players: 4 } }))).toMatchObject({ code: "unknown_field", field: "players" });
    const made = (await (await api("/games", { body: { title: "Hop" } })).json()) as { next_steps: { tool: string }[] };
    expect(made.next_steps.map((step) => step.tool)).toEqual(["upload_files"]);
    expect(await refusal(await api("/games/hop", { method: "PATCH", body: { visibility: "public" } }))).toMatchObject({ code: "bad_visibility", field: "visibility", fix: expect.stringContaining("listed") });
    expect(await refusal(await api("/games/hop", { method: "PATCH", body: { play_modes: [{ mode: "online", minimum_player_count: 1, play_style: "co-op" }] } }))).toMatchObject({
      code: "bad_play_modes",
      field: "play_modes[0].minimum_player_count",
    });
    expect(await refusal(await api("/games/hop/stats?period_duration_days=120"))).toMatchObject({ code: "bad_period_duration_days", field: "period_duration_days" });
    expect(await refusal(await api("/games/hop/reports?since=yesterday"))).toMatchObject({ code: "unknown_field", field: "since" });
    expect(await refusal(await api("/games/hop/versions/version_8f3k2m"))).toMatchObject({ code: "no_version", field: "version_id" });
    expect(await refusal(await api("/games/hop/versions", { body: { files: [{ path: "game/index.html", sha256: "a".repeat(64), size_bytes: 10 }] } }))).toMatchObject({ code: "no_index_html", field: "files" });
    expect(await refusal(await api("/nowhere"))).toMatchObject({ code: "not_found" });
  });

  it("keeps other people's games out of reach", async () => {
    await api("/games", { body: { title: "Mine" } });
    expect((await api("/games/mine", { key: other })).status).toBe(404);
    expect((await api("/games/mine", { key: other, method: "PATCH", body: { title: "Stolen" } })).status).toBe(404);
    // Games without an owner (uploaded by an admin) aren't anyone's through the API.
    await createGame(env.DB, { slug: "house-game", title: "House", description: "" });
    expect((await api("/games/house-game")).status).toBe(404);
  });

  it("changes details straight away until players can see the game", async () => {
    await api("/games", { body: { title: "Draft One" } });
    const res = await api("/games/draft-one", { method: "PATCH", body: { title: "Better Name", visibility: "unlisted", devices: ["computer"], controls: ["gamepad", "keyboard_mouse"] } });
    const { game, review_message: review } = (await res.json()) as { game: Record<string, unknown>; review_message: string | null };
    expect(review).toBeNull();
    // Labels come back in a fixed order.
    expect(game).toMatchObject({ title: "Better Name", visibility: "unlisted", devices: ["computer"], controls: ["keyboard_mouse", "gamepad"] });
  });

  it("sets where a game's rooms are listed, and turning it off takes them off lists at once", async () => {
    await api("/games", { body: { title: "Party Game" } });
    const g = (await gameBySlug(env.DB, "party-game"))!;
    expect((await (await api("/games/party-game")).json<{ game: Record<string, unknown> }>()).game).toMatchObject({ multiplayer_mode: "none", room_browsing: "page" });
    expect((await api("/games/party-game", { method: "PATCH", body: { room_browsing: "everywhere" } })).status).toBe(400);
    await env.DB.prepare("INSERT INTO live_rooms (game_id, room_code, player_count, maximum_player_count, is_open, created_at_ms, updated_at_ms) VALUES (?, 'BCDFGH', 2, 8, 1, 0, 0)").bind(g.id).run();
    const res = await api("/games/party-game", { method: "PATCH", body: { room_browsing: "off" } });
    expect((await res.json<{ game: Record<string, unknown> }>()).game.room_browsing).toBe("off");
    expect(await env.DB.prepare("SELECT is_listed FROM live_rooms WHERE game_id = ?").bind(g.id).first("is_listed")).toBe(0);
  });

  it("sets what a game needs an account for: nothing by default, multiplayer or the whole game", async () => {
    await api("/games", { body: { title: "Members Club" } });
    expect((await (await api("/games/members-club")).json<{ game: Record<string, unknown> }>()).game.account_requirement).toBe("none");
    const wrong = await api("/games/members-club", { method: "PATCH", body: { account_requirement: "accounts" } });
    expect(wrong.status).toBe(400);
    expect((await wrong.json<{ error: { code: string; field: string } }>()).error).toMatchObject({ code: "bad_account_requirement", field: "account_requirement" });
    const res = await api("/games/members-club", { method: "PATCH", body: { account_requirement: "whole_game" } });
    expect((await res.json<{ game: Record<string, unknown> }>()).game.account_requirement).toBe("whole_game");
    await api("/games", { body: { title: "Online Only", account_requirement: "multiplayer" } });
    expect((await gameBySlug(env.DB, "online-only"))!.account_requirement).toBe("multiplayer");
  });

  it("lets developers pick multiplayer: none, the relay or their own game server", async () => {
    await api("/games", { body: { title: "Own Server", multiplayer_mode: "relay" } });
    const g = (await gameBySlug(env.DB, "own-server"))!;
    expect(g.multiplayer_mode).toBe("relay");
    expect((await api("/games/own-server", { method: "PATCH", body: { multiplayer_mode: "arena" } })).status).toBe(400);

    // A live version without zaisma-server.js: saved, with a note saying rooms wait for one.
    await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES ('vown', ?, 'games/vown', 1, 0, 'approved', 0)").bind(g.id).run();
    await env.DB.prepare("UPDATE games SET review_status = 'live', live_version_id = 'vown' WHERE id = ?").bind(g.id).run();
    let res = await (await api("/games/own-server", { method: "PATCH", body: { multiplayer_mode: "own" } })).json<{ game: Record<string, unknown>; game_server_problem: string | null }>();
    expect(res.game).toMatchObject({ multiplayer_mode: "own" });
    expect(res.game_server_problem).toContain("no game server");
    expect((await gameBySlug(env.DB, "own-server"))!.multiplayer_mode).toBe("own");
    await env.GAMES.put("games/vown/zaisma-server.js", "export default { setup: () => ({}) }");
    res = await (await api("/games/own-server", { method: "PATCH", body: { multiplayer_mode: "own" } })).json();
    expect(res.game_server_problem).toBeNull();

    res = await (await api("/games/own-server", { method: "PATCH", body: { multiplayer_mode: "none" } })).json();
    expect(res.game).toMatchObject({ multiplayer_mode: "none" });
    const { events } = await (await api("/games/own-server/history")).json<{ events: { description: string }[] }>();
    expect(events.filter((e) => e.description === "Multiplayer settings changed")).toHaveLength(2);
  });

  it("keeps a game server built into Zaisma for us to change", async () => {
    await api("/games", { body: { title: "Built In" } });
    await env.DB.prepare("UPDATE games SET multiplayer_mode = 'built-in', built_in_server = 'arena' WHERE slug = 'built-in'").run();
    expect((await (await api("/games/built-in")).json<{ game: Record<string, unknown> }>()).game.multiplayer_mode).toBe("built-in");
    expect((await api("/games/built-in", { method: "PATCH", body: { multiplayer_mode: "relay" } })).status).toBe(403);
    // Saving other details (the dashboard sends everything) leaves it alone.
    expect((await api("/games/built-in", { method: "PATCH", body: { screen_orientation: "landscape" } })).status).toBe(200);
    expect(await gameBySlug(env.DB, "built-in")).toMatchObject({ multiplayer_mode: "built-in", built_in_server: "arena" });
  });

  it("holds new words on a game players can see until they're reviewed", async () => {
    await api("/games", { body: { title: "Live One", description: "Old words." } });
    await env.DB.prepare("UPDATE games SET review_status = 'live', live_version_id = 'v1', visibility = 'listed' WHERE slug = 'live-one'").run();
    const res = await api("/games/live-one", { method: "PATCH", body: { title: "Free Coins Now", screen_orientation: "landscape" } });
    const { game, review_message: review } = (await res.json()) as { game: Record<string, unknown>; review_message: string | null };
    expect(review).toContain("reviewed");
    expect(game).toMatchObject({ title: "Live One", screen_orientation: "landscape", details_waiting_for_review: { title: "Free Coins Now", description: null } });

    // An admin rejects it; the old title stays.
    const g = (await gameBySlug(env.DB, "live-one"))!;
    await SELF.fetch(`http://localhost/admin/games/${g.id}/details/reject`, { method: "POST", body: new URLSearchParams({}) });
    expect((await gameBySlug(env.DB, "live-one"))!).toMatchObject({ title: "Live One", details_waiting_for_review: null });

    await api("/games/live-one", { method: "PATCH", body: { description: "New words." } });
    await SELF.fetch(`http://localhost/admin/games/${g.id}/details/approve`, { method: "POST", body: new URLSearchParams({}) });
    expect((await gameBySlug(env.DB, "live-one"))!).toMatchObject({ title: "Live One", description: "New words.", details_waiting_for_review: null });
  });

  it("keeps unlisted games out of the home page and search engines, and private ones closed", async () => {
    await api("/games", { body: { title: "Quiet Game" } });
    await env.DB.prepare("UPDATE games SET review_status = 'live', live_version_id = 'v1' WHERE slug = 'quiet-game'").run();
    await api("/games/quiet-game", { method: "PATCH", body: { visibility: "unlisted" } });
    const page = await SELF.fetch(`${SITE}/g/quiet-game`);
    expect(page.status).toBe(200);
    expect(page.headers.get("x-robots-tag")).toBe("noindex");
    expect(await (await SELF.fetch(`${SITE}/`)).text()).not.toContain("Quiet Game");

    await api("/games/quiet-game", { method: "PATCH", body: { visibility: "listed" } });
    expect(await (await SELF.fetch(`${SITE}/`)).text()).toContain("Quiet Game");
    await api("/games/quiet-game", { method: "PATCH", body: { visibility: "private" } });
    expect((await SELF.fetch(`${SITE}/g/quiet-game`)).status).toBe(404);
  });
});

describe("covers and screenshots", () => {
  it("reads the real type and size from the bytes", () => {
    expect(sniffImage(png(1280, 720))).toEqual({ type: "image/png", widthPx: 1280, heightPx: 720 });
    expect(sniffImage(jpeg(1920, 1080))).toEqual({ type: "image/jpeg", widthPx: 1920, heightPx: 1080 });
    expect(sniffImage(webp(800, 600))).toEqual({ type: "image/webp", widthPx: 800, heightPx: 600 });
    expect(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("GIF89a" + " ".repeat(40)))).toBeNull();
  });

  it("stores images for review and shows them only after approval", async () => {
    await api("/games", { body: { title: "Pics" } });
    expect((await api("/games/pics/images?kind=cover", { raw: new TextEncoder().encode("<svg>" + " ".repeat(40) + "</svg>") })).status).toBe(415);
    expect((await api("/games/pics/images?kind=cover", { raw: png(100, 100) })).status).toBe(400);
    expect((await api("/games/pics/images?kind=poster", { raw: png(1280, 720) })).status).toBe(400);

    const res = await api("/games/pics/images?kind=cover", { raw: png(1280, 720) });
    expect(res.status).toBe(201);
    const { image } = (await res.json()) as { image: { id: string; review_status: string; image_url: string; width_px: number } };
    expect(image).toMatchObject({ review_status: "pending", width_px: 1280 });
    expect(await env.GAMES.head(imageKey({ game_id: (await gameBySlug(env.DB, "pics"))!.id, id: image.id }))).not.toBeNull();

    // Nobody else sees it before review, and other developers can't remove it.
    expect((await SELF.fetch(`${SITE}/img/${image.id}`)).status).toBe(404);
    expect((await api(`/games/pics/images/${image.id}`, { key: other, method: "DELETE" })).status).toBe(404);

    await SELF.fetch(`http://localhost/admin/images/${image.id}/approve`, { method: "POST", body: new URLSearchParams({}) });
    const served = await SELF.fetch(`${SITE}/img/${image.id}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect(served.headers.get("content-security-policy")).toContain("sandbox");
    await served.arrayBuffer();

    // A newer approved cover replaces the old one, file and all.
    const second = ((await (await api("/games/pics/images?kind=cover", { raw: jpeg(1920, 1080) })).json()) as { image: { id: string } }).image;
    await SELF.fetch(`http://localhost/admin/images/${second.id}/approve`, { method: "POST", body: new URLSearchParams({}) });
    const { images } = (await (await api("/games/pics")).json()) as { images: { id: string; kind: string }[] };
    expect(images.filter((i) => i.kind === "cover").map((i) => i.id)).toEqual([second.id]);
    expect((await SELF.fetch(`${SITE}/img/${image.id}`)).status).toBe(404);

    expect((await api(`/games/pics/images/${second.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await SELF.fetch(`${SITE}/img/${second.id}`)).status).toBe(404);
  });

  it("takes a square cover beside the landscape one, and replaces only its own kind", async () => {
    await api("/games", { body: { title: "Squares" } });
    expect((await api("/games/squares/images?kind=square", { raw: png(1280, 720) })).status).toBe(400);
    expect((await api("/games/squares/images?kind=square", { raw: png(400, 400) })).status).toBe(400);
    const add = async (kind: string, w: number, h: number) => ((await (await api(`/games/squares/images?kind=${kind}`, { raw: png(w, h) })).json()) as { image: { id: string } }).image.id;
    const approve = (id: string) => SELF.fetch(`http://localhost/admin/images/${id}/approve`, { method: "POST", body: new URLSearchParams({}) });
    const cover = await add("cover", 1280, 720);
    const square = await add("square", 1024, 1030);
    await approve(cover);
    await approve(square);
    const newer = await add("square", 512, 512);
    await approve(newer);
    const { images } = (await (await api("/games/squares")).json()) as { images: { id: string; kind: string }[] };
    expect(images.filter((i) => i.kind === "cover").map((i) => i.id)).toEqual([cover]);
    expect(images.filter((i) => i.kind === "square").map((i) => i.id)).toEqual([newer]);
  });

  it("caps screenshots at eight", async () => {
    await api("/games", { body: { title: "Shots" } });
    for (let i = 0; i < 8; i++) expect((await api("/games/shots/images?kind=screenshot", { raw: webp(1280, 720) })).status).toBe(201);
    expect((await api("/games/shots/images?kind=screenshot", { raw: webp(1280, 720) })).status).toBe(400);
  });
});

describe("image matching on covers and screenshots", () => {
  // The site with Arachnid Shield connected, pointed at a stand-in that matches pictures whose last byte is 0x42.
  const shieldEnv = { ...env, ARACHNID_SHIELD_KEY: "user:pass", ARACHNID_SHIELD_URL: "https://shield.test" };
  const shielded = (path: string, raw: Uint8Array) =>
    worker.fetch(new Request(`${SITE}/api/dev${path}`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: raw }), shieldEnv, createExecutionContext());
  let asked: string[] = [];
  beforeEach(() => {
    asked = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      asked.push(String(input));
      const bytes = new Uint8Array(await new Response(init!.body).arrayBuffer());
      const bad = bytes[bytes.length - 1] === 0x42;
      return new Response(JSON.stringify({ classification: bad ? "csam" : "no-known-match", match_type: bad ? "near" : null }));
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("lets clean pictures through to review", async () => {
    await api("/games", { body: { title: "Pics" } });
    const res = await shielded("/games/pics/images?kind=cover", png(1280, 720));
    expect(res.status).toBe(201);
    expect(asked).toEqual(["https://shield.test/v1/media/"]);
  });

  it("keeps a matching picture out of sight, for reporting, and alerts", async () => {
    await api("/games", { body: { title: "Pics" } });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const bad = png(1280, 720);
    bad[63] = 0x42;
    const res = await shielded("/games/pics/images?kind=screenshot", bad);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string; message: string } }).error).toMatchObject({ code: "image_refused", message: "This image can't be used." });
    const game = (await gameBySlug(env.DB, "pics"))!;
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM game_images WHERE game_id = ?").bind(game.id).first<{ n: number }>())!.n).toBe(0);
    expect((await env.GAMES.list({ prefix: `held-images/${game.id}/` })).objects).toHaveLength(1);
    expect(await env.DB.prepare("SELECT reason FROM audit_log WHERE game_id = ? AND action = 'image-held'").bind(game.id).first()).not.toBeNull();
    expect(log.mock.calls.flat().join("\n")).toContain("[alert] URGENT: known abuse image uploaded to pics");
  });
});

describe("players", () => {
  it("stores how a game is played and refuses nonsense", async () => {
    await api("/games", { body: { title: "Cave Crew", play_modes: [{ mode: "single" }, { mode: "local", minimum_player_count: 2, maximum_player_count: 4, play_style: "co-op" }, { mode: "online", minimum_player_count: 2, maximum_player_count: null, play_style: "co-op" }] } });
    const { game } = (await (await api("/games/cave-crew")).json()) as { game: { play_modes: unknown } };
    expect(game.play_modes).toEqual([{ mode: "single", minimum_player_count: null, maximum_player_count: null, play_style: null }, { mode: "local", minimum_player_count: 2, maximum_player_count: 4, play_style: "co-op" }, { mode: "online", minimum_player_count: 2, maximum_player_count: null, play_style: "co-op" }]);

    for (const bad of [[], [{ mode: "solo" }], [{ mode: "single" }, { mode: "single" }], [{ mode: "local", minimum_player_count: 1, maximum_player_count: 4, play_style: "co-op" }], [{ mode: "online", minimum_player_count: 4, maximum_player_count: 2, play_style: "versus" }], [{ mode: "online", minimum_player_count: 2, maximum_player_count: 8, play_style: "party" }], { single: true }]) {
      expect((await api("/games/cave-crew", { method: "PATCH", body: { play_modes: bad } })).status).toBe(400);
    }
    expect(((await (await api("/games/cave-crew", { method: "PATCH", body: { play_modes: null } })).json()) as { game: { play_modes: unknown } }).game.play_modes).toBeNull();
  });

  it("turns cloud saves off and on for games that keep their own", async () => {
    await api("/games", { body: { title: "Own Saves" } });
    expect(((await (await api("/games/own-saves")).json()) as { game: { cloud_saves_enabled: boolean } }).game.cloud_saves_enabled).toBe(true);
    const off = (await (await api("/games/own-saves", { method: "PATCH", body: { cloud_saves_enabled: false } })).json()) as { game: { cloud_saves_enabled: boolean } };
    expect(off.game.cloud_saves_enabled).toBe(false);
    expect((await gameBySlug(env.DB, "own-saves"))!.cloud_saves_enabled).toBe(0);
    expect((await api("/games/own-saves", { method: "PATCH", body: { cloud_saves_enabled: "yes" } })).status).toBe(400);
  });

  it("describes each way to play in plain words", () => {
    expect(
      describePlayModes([
        { mode: "single", minimum_player_count: null, maximum_player_count: null, play_style: null },
        { mode: "local", minimum_player_count: 2, maximum_player_count: 4, play_style: "co-op" },
        { mode: "online", minimum_player_count: 8, maximum_player_count: null, play_style: "both" },
      ]),
    ).toEqual([
      { mode: "single", label: "Single-player", playerCount: null },
      { mode: "local", label: "Local co-op", playerCount: "2–4 players" },
      { mode: "online", label: "Online co-op and versus", playerCount: "8+ players" },
    ]);
    expect(describePlayModes([{ mode: "online", minimum_player_count: 2, maximum_player_count: 2, play_style: "versus" }])[0]!.playerCount).toBe("2 players");
  });
});

describe("tester links", () => {
  afterAll(async () => {
    await env.DB.exec("DELETE FROM tester_links;");
  });

  it("open a private game for anyone with the link, until it's turned off", async () => {
    await api("/games", { body: { title: "Secret Hop" } });
    const game = (await gameBySlug(env.DB, "secret-hop"))!;
    await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) VALUES ('vsh', ?, 'games/sh/vsh', 1, 0, 'approved', 0)").bind(game.id).run();

    // Nothing published yet: the link works but there's nothing to play.
    const made = await api("/games/secret-hop/testers", { body: { name: "  Play   testers " } });
    expect(made.status).toBe(201);
    const { tester } = (await made.json()) as { tester: { id: string; name: string; link_url: string; last_opened_at: string | null } };
    expect(tester.name).toBe("Play testers");
    expect(tester.link_url).toMatch(/^https:\/\/zaisma\.test\/t\/[a-z0-9]{20}$/);
    const path = new URL(tester.link_url).pathname;
    expect(await (await SELF.fetch(`${SITE}${path}`)).text()).toContain("Nothing to play yet");

    await env.DB.prepare("UPDATE games SET review_status = 'live', live_version_id = 'vsh', visibility = 'private' WHERE id = ?").bind(game.id).run();
    expect((await SELF.fetch(`${SITE}/g/secret-hop`)).status).toBe(404);
    const page = await SELF.fetch(`${SITE}${path}`);
    expect(page.status).toBe(200);
    expect(page.headers.get("x-robots-tag")).toBe("noindex");
    const body = await page.text();
    expect(body).toContain(`secret-hop--${path.slice(3)}/`);
    expect(body).toContain("It isn&#39;t public yet");
    // Private games stay off Continue playing.
    expect(body).not.toMatch(/if \(frame\) return;\s*remember\(\);/);
    expect(((await (await api("/games/secret-hop")).json()) as { testers: { last_opened_at: string | null }[] }).testers[0]!.last_opened_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Checks, and other people can't see or turn off the links.
    expect((await api("/games/secret-hop/testers", { body: { name: "" } })).status).toBe(400);
    expect((await api("/games/secret-hop/testers", { body: { name: "x".repeat(61) } })).status).toBe(400);
    expect((await api("/games/secret-hop/testers", { key: other })).status).toBe(404);
    expect((await api(`/games/secret-hop/testers/${tester.id}`, { key: other, method: "DELETE" })).status).toBe(404);

    expect((await api(`/games/secret-hop/testers/${tester.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await api(`/games/secret-hop/testers/${tester.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await SELF.fetch(`${SITE}${path}`)).status).toBe(404);
    expect(((await (await api("/games/secret-hop/testers")).json()) as { testers: unknown[] }).testers).toEqual([]);
    const history = (await (await api("/games/secret-hop/history")).json()) as { events: { description: string }[] };
    expect(history.events.map((e) => e.description)).toEqual(expect.arrayContaining(["Made a tester link", "Turned off a tester link"]));
  });
});
