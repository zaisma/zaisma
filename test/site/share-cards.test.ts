import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { addTesterLink, createAccount, createApiKey, gameBySlug, qrCodeSvg } from "@zaisma/core";
import { TOOLS } from "../../apps/site/src/mcp.ts";
import { IMAGE, QR_CODE } from "../../apps/site/src/schemas.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";
import { letPublish } from "../helpers.ts";
import { shareDialog } from "../../apps/site/src/share-cards.ts";
import { pageProblems } from "./page-rules.ts";

// Share cards, search and QR codes (docs/DECISIONS.md, "Share cards" and "QR codes"): what a game
// link and a room link unfold into, what search engines read, the sitemap, the QR code on the page and
// through the API and MCP, the share picture, and the screenshot a listed game needs.

const SITE = "https://zaisma.test";
let token = "";
let nextId = 1;

async function api(path: string, init: { method?: string; body?: unknown; bytes?: Uint8Array } = {}) {
  const response = await SELF.fetch(`${SITE}/api/dev${path}`, {
    method: init.method ?? (init.body || init.bytes ? "POST" : "GET"),
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.bytes ?? (init.body ? JSON.stringify(init.body) : undefined),
  });
  const answer = (await response.json()) as any;
  if (!response.ok) expect(errorProblems(answer, response.status)).toEqual([]);
  return { status: response.status, answer };
}

async function tool(name: string, toolArguments: Record<string, unknown>): Promise<any> {
  const response = await SELF.fetch(`${SITE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: toolArguments } }),
  });
  const { result } = (await response.json()) as any;
  if (result.isError) {
    expect(errorProblems(result.structuredContent)).toEqual([]);
    return result.structuredContent;
  }
  expect(schemaProblems(TOOLS.find((candidate) => candidate.name === name)!.outputSchema!, result.structuredContent, name)).toEqual([]);
  return result.structuredContent;
}

/** A PNG's first bytes with the given size: enough for the image check, which reads only the header. */
function png(widthPx: number, heightPx: number): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, widthPx);
  new DataView(bytes.buffer).setUint32(20, heightPx);
  return bytes;
}

/** Adds an approved image of a kind straight to the database and storage, as a review would leave it. */
async function approvedImage(kind: string, id: string, widthPx = 1920, heightPx = 1080) {
  const game = (await gameBySlug(env.DB, "sky-hopper"))!;
  await env.GAMES.put(`images/${game.id}/${id}`, png(widthPx, heightPx), { httpMetadata: { contentType: "image/png" } });
  await env.DB.prepare("INSERT INTO game_images (id, game_id, kind, content_type, width_px, height_px, size_bytes, review_status, created_at_ms) VALUES (?, ?, ?, 'image/png', ?, ?, 64, 'approved', ?)")
    .bind(id, game.id, kind, widthPx, heightPx, Date.now())
    .run();
}

const headOf = async (path: string) => {
  const page = await (await SELF.fetch(`${SITE}${path}`)).text();
  return page.slice(0, page.indexOf("</head>"));
};
const meta = (head: string, property: string) => head.match(new RegExp(`<meta (?:property|name)="${property}" content="([^"]*)">`))?.[1] ?? null;

beforeEach(async () => {
  await env.DB.exec("DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM tester_links; DELETE FROM game_images; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;");
  await createAccount(env.DB, { id: "dev-1", username: "Emma_Novak", ageBand: "18+" });
  await letPublish(env.DB, "dev-1");
  token = (await createApiKey(env.DB, "dev-1", "claude")).token;
  expect((await api("/games", { body: { title: "Sky Hopper", slug: "sky-hopper", description: "Hop between floating islands with up to eight friends. Every island falls a little faster than the last, so keep moving." } })).status).toBe(201);
  // Live and listed, as if a version had passed and been published.
  await env.DB.prepare("UPDATE games SET review_status = 'live', visibility = 'listed', live_version_id = 'version_live' WHERE slug = 'sky-hopper'").run();
  await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) SELECT 'version_live', id, 'games/sky/live', 1, 0, 'approved', 1792000000000 FROM games WHERE slug = 'sky-hopper'").run();
});

describe("a shared game link", () => {
  it("unfolds into the share picture, the title and one line, and points search engines at the game page", async () => {
    await approvedImage("cover", "image_cover1");
    await approvedImage("share", "image_share1", 2400, 1260);
    const head = await headOf("/g/sky-hopper");
    expect(meta(head, "og:title")).toBe("Sky Hopper");
    expect(meta(head, "og:description")).toBe("Play now in your browser.");
    expect(meta(head, "og:image")).toBe(`${SITE}/img/image_share1/card.jpg`);
    expect([meta(head, "og:image:width"), meta(head, "og:image:height")]).toEqual(["1200", "630"]);
    expect(meta(head, "og:url")).toBe(`${SITE}/g/sky-hopper`);
    expect(meta(head, "twitter:card")).toBe("summary_large_image");
    expect(head).toContain(`<link rel="canonical" href="${SITE}/g/sky-hopper">`);
    // Search engines get the developer's description, cut to what they show.
    expect(meta(head, "description")).toBe("Hop between floating islands with up to eight friends. Every island falls a little faster than the last, so keep moving.");
    const structured = JSON.parse(head.match(/<script type="application\/ld\+json">(.*?)<\/script>/)![1]!);
    expect(structured).toMatchObject({ "@type": "VideoGame", name: "Sky Hopper", url: `${SITE}/g/sky-hopper`, gamePlatform: "Web browser", author: { name: "Emma_Novak" } });
  });

  it("uses the cover when there's no share picture, then a screenshot, then Zaisma's icon as a small card", async () => {
    expect(meta(await headOf("/g/sky-hopper"), "og:image")).toBe(`${SITE}/app-icon-512.png`);
    expect(meta(await headOf("/g/sky-hopper"), "twitter:card")).toBe("summary");
    await approvedImage("screenshot", "image_shot1");
    expect(meta(await headOf("/g/sky-hopper"), "og:image")).toBe(`${SITE}/img/image_shot1/card.jpg`);
    await approvedImage("cover", "image_cover1");
    expect(meta(await headOf("/g/sky-hopper"), "og:image")).toBe(`${SITE}/img/image_cover1/card.jpg`);
  });

  it("invites into the match from a room link, with the game page as its canonical address", async () => {
    const head = await headOf("/g/sky-hopper?room=K7PQ2M");
    expect(meta(head, "og:title")).toBe("Join my match in Sky Hopper");
    expect(meta(head, "og:description")).toBe("Tap to join in your browser.");
    expect(meta(head, "og:url")).toBe(`${SITE}/g/sky-hopper?room=K7PQ2M`);
    expect(head).toContain(`<link rel="canonical" href="${SITE}/g/sky-hopper">`);
    expect(meta(await headOf("/g/sky-hopper?room=nope"), "og:title")).toBe("Sky Hopper");
  });

  it("gives tester links nothing to unfold, since their address is a secret", async () => {
    await env.DB.prepare("UPDATE games SET visibility = 'private' WHERE slug = 'sky-hopper'").run();
    const tester = await addTesterLink(env.DB, (await gameBySlug(env.DB, "sky-hopper"))!.id, "Playtesters");
    const head = await headOf(`/t/${tester.token}`);
    expect(meta(head, "og:title")).toBeNull();
    expect(head).not.toContain("canonical");
  });

  it("serves the card picture for an approved image, and nothing for one that isn't", async () => {
    await approvedImage("cover", "image_cover1");
    const card = await SELF.fetch(`${SITE}/img/image_cover1/card.jpg`);
    expect(card.status).toBe(200);
    expect(card.headers.get("content-type")).toMatch(/^image\/(jpeg|png)$/);
    await card.arrayBuffer();
    expect((await SELF.fetch(`${SITE}/img/image_cover1/other.jpg`)).status).toBe(404);
    expect((await SELF.fetch(`${SITE}/img/image_missing/card.jpg`)).status).toBe(404);
  });

  it("serves an approved picture at its kept sizes (the picture itself where they can't be made), and answers a browser holding it with 304", async () => {
    await approvedImage("cover", "image_cover1");
    const sized = await SELF.fetch(`${SITE}/img/image_cover1/w640.webp`);
    expect(sized.status).toBe(200);
    expect(sized.headers.get("content-type")).toMatch(/^image\/(webp|png|jpeg)$/);
    const etag = sized.headers.get("etag");
    expect(etag).toBeTruthy();
    await sized.arrayBuffer();
    const again = await SELF.fetch(`${SITE}/img/image_cover1/w640.webp`, { headers: { "If-None-Match": etag! } });
    expect(again.status).toBe(304);
    await again.arrayBuffer();
    for (const wrong of ["w641.webp", "w640.png", "w.webp"]) expect((await SELF.fetch(`${SITE}/img/image_cover1/${wrong}`)).status, wrong).toBe(404);
  });
});

describe("search engines", () => {
  it("find every listed live game in the sitemap, which robots.txt names, and never an unlisted one", async () => {
    const robots = await (await SELF.fetch(`${SITE}/robots.txt`)).text();
    expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    const sitemap = await SELF.fetch(`${SITE}/sitemap.xml`);
    expect(sitemap.headers.get("content-type")).toContain("application/xml");
    const listedMap = await sitemap.text();
    expect(listedMap).toContain(`<loc>${SITE}/g/sky-hopper</loc>`);
    expect(listedMap).toContain(`<loc>${SITE}/</loc>`);
    await env.DB.prepare("UPDATE games SET visibility = 'unlisted' WHERE slug = 'sky-hopper'").run();
    expect(await (await SELF.fetch(`${SITE}/sitemap.xml`)).text()).not.toContain("sky-hopper");
    expect((await SELF.fetch(`${SITE}/g/sky-hopper`)).headers.get("x-robots-tag")).toBe("noindex");
  });
});

describe("QR codes", () => {
  it("come from Share on the game page, for the game's link or a room's", async () => {
    const page = await (await SELF.fetch(`${SITE}/g/sky-hopper`)).text();
    expect(page).toContain('id="share-dialog"');
    expect(page).toContain('id="share-qr"');
    expect(page).toContain('id="share-link"');
    const code = await SELF.fetch(`${SITE}/g/sky-hopper/qr-code.svg?room=K7PQ2M`);
    expect(code.headers.get("content-type")).toBe("image/svg+xml");
    expect(code.headers.get("content-security-policy")).toContain("sandbox");
    expect(await code.text()).toBe(qrCodeSvg(`${SITE}/g/sky-hopper?room=K7PQ2M`));
    // A room code that isn't one is left out, so the code only ever opens this game.
    expect(await (await SELF.fetch(`${SITE}/g/sky-hopper/qr-code.svg?room=https://elsewhere`)).text()).toBe(qrCodeSvg(`${SITE}/g/sky-hopper`));
    await env.DB.prepare("UPDATE games SET visibility = 'draft' WHERE slug = 'sky-hopper'").run();
    expect((await SELF.fetch(`${SITE}/g/sky-hopper/qr-code.svg`)).status).toBe(404);
  });

  it("sit in a Share sheet made only of gallery components, with none on a tester link's", () => {
    const withCode = shareDialog("Sky Hopper", true).html;
    expect(withCode).toMatch(/^<dialog class="sheet glass( is-compact)?" id="share-dialog"/);
    for (const id of ["share-qr", "share-qr-caption", "share-reveal", "share-room", "share-room-code", "share-link", "share-more"]) expect(withCode).toContain(`id="${id}"`);
    expect(pageProblems(withCode)).toEqual([]);
    const tester = shareDialog("Sky Hopper", false).html;
    expect(tester).not.toContain('id="share-qr"');
    expect(pageProblems(tester)).toEqual([]);
  });

  it("come through the API and MCP for developers, with the same code", async () => {
    const game = await api("/games/sky-hopper/qr-code");
    expect(game.status).toBe(200);
    expect(schemaProblems(QR_CODE, game.answer)).toEqual([]);
    expect(game.answer).toEqual({ link_url: `${SITE}/g/sky-hopper`, qr_code_svg: qrCodeSvg(`${SITE}/g/sky-hopper`) });
    const room = await tool("get_qr_code", { slug: "sky-hopper", room_code: "K7PQ2M" });
    expect(room.link_url).toBe(`${SITE}/g/sky-hopper?room=K7PQ2M`);
    const refused = await api("/games/sky-hopper/qr-code?room_code=k7", {});
    expect(refused.status).toBe(400);
    expect(refused.answer.error).toMatchObject({ code: "bad_room_code", field: "room_code" });
  });
});

describe("room codes in the game bar", () => {
  it("come in one room control with Join by code, in games on Zaisma rooms only", async () => {
    const single = await (await SELF.fetch(`${SITE}/g/sky-hopper`)).text();
    expect(single).not.toContain('id="room-open"');
    expect(single).not.toContain('id="room-dialog"');
    await env.DB.prepare("UPDATE games SET multiplayer_mode = 'relay' WHERE slug = 'sky-hopper'").run();
    const rooms = await (await SELF.fetch(`${SITE}/g/sky-hopper`)).text();
    expect(rooms).toMatch(/id="room-open"[^>]*aria-controls="room-dialog"/);
    // The sheet shows this room's code (filled in once the game says it's in one) and joins another by its code.
    expect(rooms).toMatch(/<dialog class="sheet glass placement-foot" id="room-dialog"/);
    expect(rooms).toContain('id="room-here" hidden');
    expect(rooms).toMatch(/id="room-code-shown"[\s\S]*?id="room-code-text"/);
    expect(rooms).toContain('<label for="bar-join-code">Join a room by its code</label>');
    expect(rooms).toMatch(/<input id="bar-join-code" name="room" type="text"/);
    expect(rooms).toMatch(/<button class="shell [^"]*" id="room-join" type="submit"/);
  });
});

describe("the share picture", () => {
  it("is an image kind of its own, one per game, through the API and MCP", async () => {
    const added = await api("/games/sky-hopper/images?kind=share", { bytes: png(1200, 630) });
    expect(added.status).toBe(201);
    expect(schemaProblems(IMAGE, added.answer.image)).toEqual([]);
    expect(added.answer.image.kind).toBe("share");
    const second = await tool("add_image", { slug: "sky-hopper", kind: "share", image_base64: btoa(String.fromCharCode(...png(1200, 630))) });
    expect(second.image.kind).toBe("share");
    // Only the newest one waits for review.
    const { results } = await env.DB.prepare("SELECT id FROM game_images WHERE kind = 'share'").all();
    expect(results).toHaveLength(1);
  });

  it("never shows among the game page's pictures", async () => {
    await approvedImage("share", "image_share1");
    expect(await (await SELF.fetch(`${SITE}/g/sky-hopper`)).text()).not.toContain('src="/img/image_share1"');
  });
});

describe("listing a game", () => {
  it("needs a screenshot, sent or approved, and says how to add one", async () => {
    await env.DB.prepare("UPDATE games SET visibility = 'unlisted' WHERE slug = 'sky-hopper'").run();
    const refused = await api("/games/sky-hopper", { method: "PATCH", body: { visibility: "listed" } });
    expect(refused.status).toBe(409);
    expect(refused.answer.error).toMatchObject({ code: "screenshot_needed", field: "visibility" });
    expect(refused.answer.error.fix).toContain("add_image");
    expect((await api("/games/sky-hopper/images?kind=screenshot", { bytes: png(1920, 1080) })).status).toBe(201);
    expect((await api("/games/sky-hopper", { method: "PATCH", body: { visibility: "listed" } })).answer.game.visibility).toBe("listed");
  });
});
