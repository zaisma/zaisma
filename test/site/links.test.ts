import { env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addTesterLink, createAccount, createApiKey, gameBySlug } from "@zaisma/core";
import { TOOLS } from "../../apps/site/src/mcp.ts";
import { GAME } from "../../apps/site/src/schemas.ts";
import { developerLinks, leavingCard, recheckLinks } from "../../apps/site/src/game-links.ts";
import { LINK_BRAND_ICON_PATHS } from "../../apps/site/src/link-icons.ts";
import { pageProblems } from "./page-rules.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";
import { pageDataOf, pageScriptNames, pageScriptText } from "../strict-scripts.ts";
import { letPublish } from "../helpers.ts";

// Registered links (docs/DECISIONS.md, "Games open outside links only through Zaisma"): the list on a
// game's details through the API, MCP and dashboard, the check of every site against Cloudflare's list
// (a stand-in here), and what the game page's server hands over for each player.

const SITE = "https://zaisma.test";
const SUPABASE = "https://supabase.test";
const realFetch = globalThis.fetch;
let token = "";
let nextId = 1;
/** Sites the stand-in for Cloudflare's DNS lists for malware or phishing. */
const listed = new Set<string>();
let signingKeys: CryptoKeyPair;
let publicKey: JsonWebKey;

const b64url = (given: ArrayBuffer | string) =>
  btoa(typeof given === "string" ? given : String.fromCharCode(...new Uint8Array(given)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** The session cookie of a signed-in account, as Supabase would sign it. */
async function sessionCookie(accountId: string): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "ES256", kid: "links-test-key", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ sub: accountId, email: "", aud: "authenticated", iss: `${SUPABASE}/auth/v1`, exp: nowSec + 3600, iat: nowSec, amr: [{ method: "password", timestamp: nowSec }] }));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKeys.privateKey, new TextEncoder().encode(`${header}.${claims}`));
  return `__Host-zaisma=${header}.${claims}.${b64url(signature)}~r-${accountId}`;
}

async function api(path: string, init: { method?: string; body?: unknown } = {}) {
  const response = await SELF.fetch(`${SITE}/api/dev${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
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

/** What the game page's server answers for a link, as a player (an account's cookie, or a guest). */
async function ask(body: Record<string, unknown>, options: { cookie?: string; slug?: string; origin?: string | null } = {}) {
  const response = await SELF.fetch(`${SITE}/api/links/${options.slug ?? "sky-hopper"}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "text/plain", "cf-connecting-ip": `10.9.${nextId++ % 250}.${Math.floor(Math.random() * 250)}`, ...(options.origin === null ? {} : { origin: options.origin ?? SITE }), ...(options.cookie ? { cookie: options.cookie } : {}) },
  });
  return { status: response.status, answer: response.status === 200 || response.headers.get("content-type")?.includes("json") ? ((await response.json()) as any) : null };
}

const LINKS = [
  { link_name: "store", destination_url: "https://kit.itch.io/sky-hopper", is_on_game_page: true },
  { link_name: "discord", destination_url: "https://discord.gg/skyhopper", is_on_game_page: false },
];
const history = async () => (await api("/games/sky-hopper/history")).answer.events.map((event: { description: string }) => event.description);

beforeAll(async () => {
  signingKeys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  publicKey = (await crypto.subtle.exportKey("jwk", signingKeys.publicKey)) as JsonWebKey;
});

beforeEach(async () => {
  listed.clear();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === "https://dns.zaisma.test") {
      const host = url.searchParams.get("name")!;
      return Response.json({ Status: 0, Answer: [{ name: host, type: 1, TTL: 300, data: listed.has(host) ? "0.0.0.0" : "93.184.216.34" }] });
    }
    if (url.href === `${SUPABASE}/auth/v1/.well-known/jwks.json`) return Response.json({ keys: [{ ...publicKey, kid: "links-test-key", alg: "ES256" }] });
    return realFetch(input, init);
  });
  await env.DB.exec("DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM tester_links; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;");
  await createAccount(env.DB, { id: "dev-1", username: "Kit", ageBand: "18+" });
  await letPublish(env.DB, "dev-1");
  await createAccount(env.DB, { id: "adult-1", username: "Ana", ageBand: "18+" });
  await letPublish(env.DB, "adult-1");
  await createAccount(env.DB, { id: "teen-1", username: "Bo", ageBand: "16-17", birthDate: `${new Date().getUTCFullYear() - 16}-01-01` });
  await letPublish(env.DB, "teen-1");
  token = (await createApiKey(env.DB, "dev-1", "claude")).token;
  expect((await api("/games", { body: { title: "Sky Hopper", slug: "sky-hopper" } })).status).toBe(201);
  // Live and listed, as if a version had passed and been published.
  await env.DB.prepare("UPDATE games SET review_status = 'live', visibility = 'listed', live_version_id = 'version_live' WHERE slug = 'sky-hopper'").run();
  await env.DB.prepare("INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, created_at_ms) SELECT 'version_live', id, 'games/sky/live', 1, 0, 'approved', 1792000000000 FROM games WHERE slug = 'sky-hopper'").run();
});

afterEach(() => vi.unstubAllGlobals());

describe("a game's links through the API and MCP", () => {
  it("are part of the game: set as a whole list, tidied, with who each opens for, and in its history", async () => {
    expect((await tool("get_game", { slug: "sky-hopper" })).game.links).toEqual([]);
    const changed = await tool("update_game", { slug: "sky-hopper", links: [{ ...LINKS[0], destination_url: "https://Kit.itch.io/sky-hopper" }, LINKS[1]] });
    expect(schemaProblems(GAME, changed.game)).toEqual([]);
    expect(changed.game.links).toEqual([
      { ...LINKS[0], who_can_open: "everyone", review_reason: null },
      { ...LINKS[1], who_can_open: "signed_in_adults", review_reason: null },
    ]);
    const stored = (await gameBySlug(env.DB, "sky-hopper"))!;
    expect(JSON.parse(stored.links)[0]).toMatchObject({ link_name: "store", checked_at_ms: expect.any(Number) });
    expect(stored.links_checked_at_ms).toEqual(expect.any(Number));
    expect(await history()).toContain("Changed the game's links");
    // list_games shows the same game.
    expect((await tool("list_games", {})).games[0].links).toHaveLength(2);
    expect((await tool("update_game", { slug: "sky-hopper", links: [] })).game.links).toEqual([]);
  });

  it("refuses what isn't a list of links, saying which link and what to give", async () => {
    for (const [links, field] of [
      [{ store: "https://kit.itch.io/" }, "links"],
      [[{ link_name: "store", destination_url: "https://bit.ly/abc", is_on_game_page: true }], "links[0].destination_url"],
      [[LINKS[0], { ...LINKS[1], link_name: "store" }], "links[1].link_name"],
      [[{ link_name: "store", destination_url: "http://kit.itch.io/", is_on_game_page: true }], "links[0].destination_url"],
    ] as const) {
      const refused = await api("/games/sky-hopper", { method: "PATCH", body: { links } });
      expect(refused.status, JSON.stringify(links)).toBe(400);
      expect(refused.answer.error).toMatchObject({ code: "bad_links", field });
    }
    expect((await gameBySlug(env.DB, "sky-hopper"))!.links).toBe("[]");
  });

  it("a site Cloudflare lists opens for nobody, says why and shows as an alert", async () => {
    listed.add("evil.example");
    const changed = await tool("update_game", { slug: "sky-hopper", links: [...LINKS, { link_name: "prize", destination_url: "https://evil.example/claim", is_on_game_page: false }] });
    const prize = changed.game.links.find((link: { link_name: string }) => link.link_name === "prize");
    expect(prize).toMatchObject({ who_can_open: "nobody", review_reason: { code: "link_flagged", content_rule: "malware" } });
    const { alerts } = await tool("get_game", { slug: "sky-hopper" });
    expect(alerts).toEqual([expect.objectContaining({ kind: "link_flagged", version_id: null })]);
    expect((await ask({ link_name: "prize" }, { cookie: await sessionCookie("adult-1") })).answer).toEqual({ destination_url: null });
  });

  it("are checked again a day later: a site listed since stops opening, and opens again once it's off the list", async () => {
    await api("/games/sky-hopper", { method: "PATCH", body: { links: LINKS } });
    await env.DB.prepare("UPDATE games SET links_checked_at_ms = ? WHERE slug = 'sky-hopper'").bind(Date.now() - 2 * 86_400_000).run();
    listed.add("discord.gg");
    await recheckLinks(env);
    expect((await tool("get_game", { slug: "sky-hopper" })).game.links[1]).toMatchObject({ link_name: "discord", who_can_open: "nobody" });
    expect(await history()).toContain("A link stopped opening: Cloudflare lists its site for malware or phishing");
    // Checked just now: not again until tomorrow.
    listed.clear();
    await recheckLinks(env);
    expect((await tool("get_game", { slug: "sky-hopper" })).game.links[1].who_can_open).toBe("nobody");
    await env.DB.prepare("UPDATE games SET links_checked_at_ms = ? WHERE slug = 'sky-hopper'").bind(Date.now() - 2 * 86_400_000).run();
    await recheckLinks(env);
    expect((await tool("get_game", { slug: "sky-hopper" })).game.links[1].who_can_open).toBe("signed_in_adults");
    expect(await history()).toContain("A link opens again: its site is off Cloudflare's malware and phishing list");
  });
});

describe("the game page asks for a link's address", () => {
  beforeEach(async () => {
    await api("/games/sky-hopper", { method: "PATCH", body: { links: LINKS } });
  });

  it("hands it over only when this player may open it: guests and teens on trusted sites, adults anywhere", async () => {
    const store = { link_name: "store", path: "/buy", query_parameters: { item: "sword" } };
    const discord = { link_name: "discord" };
    expect((await ask(store)).answer).toEqual({ destination_url: "https://kit.itch.io/sky-hopper/buy?item=sword" });
    expect((await ask(discord)).answer).toEqual({ destination_url: null });
    const teen = await sessionCookie("teen-1");
    expect((await ask(store, { cookie: teen })).answer.destination_url).toBe("https://kit.itch.io/sky-hopper/buy?item=sword");
    expect((await ask(discord, { cookie: teen })).answer).toEqual({ destination_url: null });
    expect((await ask(discord, { cookie: await sessionCookie("adult-1") })).answer).toEqual({ destination_url: "https://discord.gg/skyhopper" });
  });

  it("says what the game got wrong, the same for every player", async () => {
    expect(await ask({ link_name: "patreon" })).toMatchObject({ status: 404, answer: { error: { code: "unknown_link" } } });
    expect(await ask({ link_name: "store", path: "/../other" })).toMatchObject({ status: 400, answer: { error: { code: "bad_link_path" } } });
    expect(await ask({ link_name: "store", query_parameters: { count: 3 } })).toMatchObject({ status: 400, answer: { error: { code: "bad_link_query" } } });
  });

  it("answers only the game page, and only for a game it plays: a private one through a tester link", async () => {
    expect((await ask({ link_name: "store" }, { origin: "https://elsewhere.example" })).status).toBe(403);
    expect((await ask({ link_name: "store" }, { origin: null })).status).toBe(403);
    await env.DB.prepare("UPDATE games SET visibility = 'private' WHERE slug = 'sky-hopper'").run();
    expect((await ask({ link_name: "store" })).status).toBe(404);
    const game = (await gameBySlug(env.DB, "sky-hopper"))!;
    const tester = await addTesterLink(env.DB, game.id, "Playtesters");
    expect((await ask({ link_name: "store", tester_token: tester.token })).answer).toEqual({ destination_url: "https://kit.itch.io/sky-hopper" });
    expect((await ask({ link_name: "store", tester_token: "a".repeat(20) })).status).toBe(404);
  });

  it("puts the leaving card on the game page, which opens links only after the player's tap", async () => {
    const page = await (await SELF.fetch(`${SITE}/g/sky-hopper`)).text();
    expect(page).toContain('id="link-ask"');
    expect(page).toContain('id="link-closed"');
    expect(page).toContain("You&#39;re leaving Zaisma");
    expect(page).toContain("This link can&#39;t be opened here.");
    expect(page).toContain("Back to the game");
    expect(pageScriptNames(page)).toContain("game-links");
    const scripts = await pageScriptText(page, (path) => SELF.fetch(`${SITE}${path}`));
    expect(scripts).toContain('d.type === "zaisma:link"');
    expect(scripts).toContain("navigator.userActivation.isActive");
    expect(scripts).toContain('fetch("/api/links/" + gamePage.slug');
    // The links script sends the tester link's token along, from a tester link's page only.
    expect(pageDataOf(page, "game-page-data")).toMatchObject({ slug: "sky-hopper", tester_token: null });
    const game = (await gameBySlug(env.DB, "sky-hopper"))!;
    const tester = await addTesterLink(env.DB, game.id, "Playtesters");
    expect(pageDataOf(await (await SELF.fetch(`${SITE}/t/${tester.token}`)).text(), "game-page-data").tester_token).toBe(tester.token);
  });
});

describe("the developer's links on the game page", () => {
  const ON_PAGE = [
    { link_name: "steam", destination_url: "https://store.steampowered.com/app/480/Sky_Hopper/", is_on_game_page: true },
    { link_name: "store", destination_url: "https://kit.itch.io/sky-hopper", is_on_game_page: true },
    { link_name: "discord", destination_url: "https://discord.gg/skyhopper", is_on_game_page: true },
    { link_name: "site", destination_url: "https://www.skyhopper.dev/", is_on_game_page: true },
    { link_name: "patreon", destination_url: "https://www.patreon.com/kit", is_on_game_page: false },
  ];
  const linksOnPage = async (cookie?: string) => {
    const page = await (await SELF.fetch(`${SITE}/g/sky-hopper`, { headers: cookie ? { cookie: `${cookie}; __Host-zaisma_in=1` } : {} })).text();
    return [...developerLinksOf(page).matchAll(/<a class="list-row is-link" href="([^"]+)" target="_blank" rel="noopener noreferrer"[^>]*>.*?<span class="list-row-lead">(.*?)<\/span><span class="list-row-words"><span class="list-row-title">([^<]+)<\/span>/g)].map((match) => [brandOf(match[2]!), match[1], match[3]]);
  };
  /** The developer's links list on a page, or "" when it has none. */
  const developerLinksOf = (page: string) => /<ul class="list-rows" aria-label="The developer&#39;s links">[\s\S]*?<\/ul>/.exec(page)?.[0] ?? "";
  /** Which site's mark a row leads with: a known site's own, else the globe (any other site). */
  const brandOf = (lead: string) => Object.entries(LINK_BRAND_ICON_PATHS).find(([, path]) => lead.includes(`d="${path}"`))?.[0] ?? "website";

  it("shows the links marked for the page, each in its site's look, only to players they open for", async () => {
    await api("/games/sky-hopper", { method: "PATCH", body: { links: ON_PAGE } });
    const forEveryone = [
      ["steam", "https://store.steampowered.com/app/480/Sky_Hopper/", "Wishlist on Steam"],
      ["itch", "https://kit.itch.io/sky-hopper", "itch.io"],
    ];
    // Guests and teens: trusted sites only, so Discord and the developer's own site never reach their page.
    expect(await linksOnPage()).toEqual(forEveryone);
    expect(await linksOnPage(await sessionCookie("teen-1"))).toEqual(forEveryone);
    expect(await linksOnPage(await sessionCookie("adult-1"))).toEqual([...forEveryone, ["discord", "https://discord.gg/skyhopper", "Discord"], ["website", "https://www.skyhopper.dev/", "skyhopper.dev"]]);
    // A flagged site opens for nobody, so it leaves the page too.
    listed.add("kit.itch.io");
    await env.DB.prepare("UPDATE games SET links_checked_at_ms = 0 WHERE slug = 'sky-hopper'").run();
    await recheckLinks(env, Date.now());
    expect((await linksOnPage()).map((link) => link[0])).toEqual(["steam"]);
  });

  it("opens them straight in a new tab, and leaves the page without any when none are marked", async () => {
    await api("/games/sky-hopper", { method: "PATCH", body: { links: ON_PAGE.slice(0, 1) } });
    expect(await (await SELF.fetch(`${SITE}/g/sky-hopper`)).text()).toContain('target="_blank" rel="noopener noreferrer"');
    await api("/games/sky-hopper", { method: "PATCH", body: { links: LINKS.slice(1) } });
    expect(developerLinksOf(await (await SELF.fetch(`${SITE}/g/sky-hopper`)).text())).toBe("");
  });

  it("are only gallery components, as the leaving sheets are", () => {
    expect(pageProblems(developerLinks(ON_PAGE.slice(0, 4).map((link) => ({ ...link, review_reason: null, checked_at_ms: null }))).toString())).toEqual([]);
    expect(pageProblems(leavingCard("Sky Hopper").html)).toEqual([]);
  });
});

describe("streamer mode", () => {
  it("is an account setting that game pages read, hiding room codes until the player shows them", async () => {
    const cookie = await sessionCookie("adult-1");
    const streamerModeOf = async (withCookie?: string) =>
      pageDataOf(await (await SELF.fetch(`${SITE}/g/sky-hopper`, { headers: withCookie ? { cookie: `${withCookie}; __Host-zaisma_in=1` } : {} })).text(), "game-page-data").is_streamer_mode_on;
    expect(await streamerModeOf(cookie)).toBe(false);
    const saved = await SELF.fetch(`${SITE}/account/streamer-mode`, { method: "POST", body: new URLSearchParams({ is_streamer_mode_on: "1" }), headers: { cookie, origin: SITE }, redirect: "manual" });
    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe("/account?streamer-mode-saved#streamer-mode");
    expect(await streamerModeOf(cookie)).toBe(true);
    const account = await (await SELF.fetch(`${SITE}/account`, { headers: { cookie } })).text();
    expect(account).toMatch(/name="is_streamer_mode_on" value="1" aria-pressed="true"/);
    // Guests have no account to turn it on in: their codes always show.
    expect(await streamerModeOf()).toBe(false);
    await SELF.fetch(`${SITE}/account/streamer-mode`, { method: "POST", body: new URLSearchParams({ is_streamer_mode_on: "0" }), headers: { cookie, origin: SITE }, redirect: "manual" });
    expect(await streamerModeOf(cookie)).toBe(false);
  });
});

describe("a game's links on the dashboard", () => {
  it("shows each link with who it opens for, and saves the rows as the whole list", async () => {
    const cookie = await sessionCookie("dev-1");
    const form = new URLSearchParams({ link_name_0: "store", destination_url_0: "https://kit.itch.io/sky-hopper", is_on_game_page_0: "on", link_name_1: "discord", destination_url_1: "https://discord.gg/skyhopper", link_name_2: "", destination_url_2: "" });
    const saved = await SELF.fetch(`${SITE}/dashboard/sky-hopper/links`, { method: "POST", body: form, headers: { cookie, origin: SITE }, redirect: "manual" });
    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe("/dashboard/sky-hopper/details?done=links#links");
    expect((await tool("get_game", { slug: "sky-hopper" })).game.links).toEqual([
      { ...LINKS[0], who_can_open: "everyone", review_reason: null },
      { ...LINKS[1], who_can_open: "signed_in_adults", review_reason: null },
    ]);
    const page = await (await SELF.fetch(`${SITE}/dashboard/sky-hopper/details?done=links`, { headers: { cookie } })).text();
    expect(page).toContain("Links saved.");
    expect(page).toContain('value="https://discord.gg/skyhopper"');
    expect(page).toContain("Opens for signed-in adults.");
    // The details also carry the game's QR code, with downloads.
    expect(page).toContain('id="qr-code"');
    expect(page).toContain('download="sky-hopper-qr-code.svg"');
    // A row that isn't a link says why, on the same page.
    const refused = await SELF.fetch(`${SITE}/dashboard/sky-hopper/links`, { method: "POST", body: new URLSearchParams({ link_name_0: "store", destination_url_0: "https://bit.ly/abc" }), headers: { cookie, origin: SITE }, redirect: "manual" });
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain("link shortener");
  });
});
