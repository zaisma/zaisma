import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { accountForApiKey, createAccount, createApiKey, createGame, describePlayers, gameBySlug, imageKey, personOwner, sniffImage } from "@zaisma/core";

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

async function api(path: string, init: { method?: string; body?: unknown; raw?: Uint8Array; key?: string | null } = {}) {
  const key = init.key === undefined ? token : init.key;
  return SELF.fetch(`${SITE}/api/dev${path}`, {
    method: init.method ?? (init.body || init.raw ? "POST" : "GET"),
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.raw ?? (init.body ? JSON.stringify(init.body) : undefined),
  });
}

beforeEach(async () => {
  await env.DB.exec(
    "DELETE FROM game_images; DELETE FROM api_keys; DELETE FROM saves; DELETE FROM audit_log; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;",
  );
  await createAccount(env.DB, { id: "dev-1", name: "Pixel Smith", ageBand: "18+" });
  await createAccount(env.DB, { id: "dev-2", name: "Other Dev", ageBand: "13-17" });
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
    expect(JSON.stringify(stored)).not.toContain(token.split("_")[2]);
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
    const res = await api("/games", { body: { title: "Sky  Hopper", description: "Jump between clouds.", devices: ["phone", "computer"], controls: ["touch"], screen: "portrait" } });
    expect(res.status).toBe(201);
    const { game } = (await res.json()) as { game: Record<string, unknown> };
    expect(game).toMatchObject({ slug: "sky-hopper", title: "Sky Hopper", visibility: "draft", review: "pending", devices: ["phone", "computer"], controls: ["touch"], screen: "portrait" });

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
    expect((await api("/games", { body: { title: "Hop", screen: "sideways" } })).status).toBe(400);
    await api("/games", { body: { title: "Hop" } });
    expect((await api("/games", { body: { title: "Hop" } })).status).toBe(409);
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
    const res = await api("/games/draft-one", { method: "PATCH", body: { title: "Better Name", visibility: "unlisted", devices: ["computer"], controls: ["gamepad", "keyboard-mouse"] } });
    const { game, review } = (await res.json()) as { game: Record<string, unknown>; review: string | null };
    expect(review).toBeNull();
    // Labels come back in a fixed order.
    expect(game).toMatchObject({ title: "Better Name", visibility: "unlisted", devices: ["computer"], controls: ["keyboard-mouse", "gamepad"] });
  });

  it("holds new words on a game players can see until they're reviewed", async () => {
    await api("/games", { body: { title: "Live One", description: "Old words." } });
    await env.DB.prepare("UPDATE games SET status = 'live', current_version_id = 'v1', visibility = 'listed' WHERE slug = 'live-one'").run();
    const res = await api("/games/live-one", { method: "PATCH", body: { title: "Free Coins Now", screen: "landscape" } });
    const { game, review } = (await res.json()) as { game: Record<string, unknown>; review: string | null };
    expect(review).toContain("reviewed");
    expect(game).toMatchObject({ title: "Live One", screen: "landscape", waiting_for_review: { title: "Free Coins Now" } });

    // An admin rejects it; the old title stays.
    const g = (await gameBySlug(env.DB, "live-one"))!;
    await SELF.fetch(`http://localhost/admin/games/${g.id}/details/reject`, { method: "POST", body: new URLSearchParams({}) });
    expect((await gameBySlug(env.DB, "live-one"))!).toMatchObject({ title: "Live One", details_draft: null });

    await api("/games/live-one", { method: "PATCH", body: { description: "New words." } });
    await SELF.fetch(`http://localhost/admin/games/${g.id}/details/approve`, { method: "POST", body: new URLSearchParams({}) });
    expect((await gameBySlug(env.DB, "live-one"))!).toMatchObject({ title: "Live One", description: "New words.", details_draft: null });
  });

  it("keeps unlisted games out of the home page and search engines, and private ones closed", async () => {
    await api("/games", { body: { title: "Quiet Game" } });
    await env.DB.prepare("UPDATE games SET status = 'live', current_version_id = 'v1' WHERE slug = 'quiet-game'").run();
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
    expect(sniffImage(png(1280, 720))).toEqual({ type: "image/png", width: 1280, height: 720 });
    expect(sniffImage(jpeg(1920, 1080))).toEqual({ type: "image/jpeg", width: 1920, height: 1080 });
    expect(sniffImage(webp(800, 600))).toEqual({ type: "image/webp", width: 800, height: 600 });
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
    const { image } = (await res.json()) as { image: { id: string; status: string; url: string } };
    expect(image.status).toBe("pending");
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

  it("caps screenshots at eight", async () => {
    await api("/games", { body: { title: "Shots" } });
    for (let i = 0; i < 8; i++) expect((await api("/games/shots/images?kind=screenshot", { raw: webp(1280, 720) })).status).toBe(201);
    expect((await api("/games/shots/images?kind=screenshot", { raw: webp(1280, 720) })).status).toBe(400);
  });
});

describe("players", () => {
  it("stores how a game is played and refuses nonsense", async () => {
    await api("/games", { body: { title: "Cave Crew", players: { single: true, local: { min: 2, max: 4, style: "co-op" }, online: { min: 2, max: null, style: "co-op" } } } });
    const { game } = (await (await api("/games/cave-crew")).json()) as { game: { players: unknown } };
    expect(game.players).toEqual({ single: true, local: { min: 2, max: 4, style: "co-op" }, online: { min: 2, max: null, style: "co-op" } });

    for (const bad of [{ single: false }, { single: true, local: { min: 1, max: 4, style: "co-op" } }, { single: true, online: { min: 4, max: 2, style: "versus" } }, { single: true, online: { min: 2, max: 8, style: "party" } }]) {
      expect((await api("/games/cave-crew", { method: "PATCH", body: { players: bad } })).status).toBe(400);
    }
    expect(((await (await api("/games/cave-crew", { method: "PATCH", body: { players: null } })).json()) as { game: { players: unknown } }).game.players).toBeNull();
  });

  it("turns cloud saves off and on for games that keep their own", async () => {
    await api("/games", { body: { title: "Own Saves" } });
    expect(((await (await api("/games/own-saves")).json()) as { game: { cloud_saves: boolean } }).game.cloud_saves).toBe(true);
    const off = (await (await api("/games/own-saves", { method: "PATCH", body: { cloud_saves: false } })).json()) as { game: { cloud_saves: boolean } };
    expect(off.game.cloud_saves).toBe(false);
    expect((await gameBySlug(env.DB, "own-saves"))!.cloud_saves).toBe(0);
    expect((await api("/games/own-saves", { method: "PATCH", body: { cloud_saves: "yes" } })).status).toBe(400);
  });

  it("describes each way to play in plain words", () => {
    expect(describePlayers({ single: true, local: { min: 2, max: 4, style: "co-op" }, online: { min: 8, max: null, style: "both" } })).toEqual([
      { mode: "single", label: "Single-player", count: null },
      { mode: "local", label: "Local co-op", count: "2–4 players" },
      { mode: "online", label: "Online co-op and versus", count: "8+ players" },
    ]);
    expect(describePlayers({ single: false, local: null, online: { min: 2, max: 2, style: "versus" } })[0]!.count).toBe("2 players");
  });
});
