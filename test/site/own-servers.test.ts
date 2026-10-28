import { env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccount, createApiKey, gameBySlug, ownServerUrlsOf } from "@zaisma/core";
import { TOOLS } from "../../apps/site/src/mcp.ts";
import { GAME } from "../../apps/site/src/schemas.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";
import { letPublish } from "../helpers.ts";

// A game's own servers (docs/DECISIONS.md, "Games can't load outside scripts, and connect only to Zaisma rooms
// and their own servers"): set by the developer through the API, MCP and dashboard, live at once, kept in the
// game's history and named in the game's ⋯ menu, never on the details players see before Play.

const SITE = "https://zaisma.test";
const SUPABASE = "https://supabase.test";
const realFetch = globalThis.fetch;
let token = "";
let nextId = 1;
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
  const header = b64url(JSON.stringify({ alg: "ES256", kid: "own-servers-test-key", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ sub: accountId, email: "", aud: "authenticated", iss: `${SUPABASE}/auth/v1`, exp: nowSec + 3600, iat: nowSec, amr: [{ method: "password", timestamp: nowSec }] }));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKeys.privateKey, new TextEncoder().encode(`${header}.${claims}`));
  return `__Host-zaisma=${header}.${claims}.${b64url(signature)}~r-${accountId}`;
}

async function api(path: string, init: { method?: string; body?: unknown; key?: string } = {}) {
  const response = await SELF.fetch(`${SITE}/api/dev${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { authorization: `Bearer ${init.key ?? token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
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

const history = async () => (await api("/games/sky-hopper/history")).answer.events.map((event: { description: string }) => event.description);
/** The column as stored (a JSON list; a game made before any change keeps the column's default, read as none). */
const storedText = async () => (await gameBySlug(env.DB, "sky-hopper"))!.own_server_urls;
const stored = async () => ownServerUrlsOf((await gameBySlug(env.DB, "sky-hopper"))!);
const gamePage = async () => (await SELF.fetch(`${SITE}/g/sky-hopper`)).text();
/** Where the game page says it: the ⋯ menu's lines, and nowhere else. */
const ownServerLines = async () => [...(await gamePage()).matchAll(/<div class="dropdown-head"><strong>[^<]*<\/strong><span>([^<]*own server[^<]*)<\/span>(?:<span id="save-line"[^>]*><\/span>)?<\/div>/g)].map((line) => ({ place: "menu", text: line[1] }));

beforeAll(async () => {
  signingKeys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  publicKey = (await crypto.subtle.exportKey("jwk", signingKeys.publicKey)) as JsonWebKey;
});

beforeEach(async () => {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.href === `${SUPABASE}/auth/v1/.well-known/jwks.json`) return Response.json({ keys: [{ ...publicKey, kid: "own-servers-test-key", alg: "ES256" }] });
    return realFetch(input, init);
  });
  await env.DB.exec("DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;");
  await createAccount(env.DB, { id: "dev-1", username: "Kit", ageBand: "18+" });
  await letPublish(env.DB, "dev-1");
  token = (await createApiKey(env.DB, "dev-1", "claude")).token;
  expect((await api("/games", { body: { title: "Sky Hopper", slug: "sky-hopper" } })).status).toBe(201);
  // Live and listed, as if a version had passed and been published.
  await env.DB.prepare("UPDATE games SET review_status = 'live', visibility = 'listed', live_version_id = 'version_live' WHERE slug = 'sky-hopper'").run();
});

afterEach(() => vi.unstubAllGlobals());

describe("a game's own servers through the API and MCP", () => {
  it("are none at first, set as a whole list, tidied, live at once and in the game's history", async () => {
    expect((await tool("get_game", { slug: "sky-hopper" })).game.own_server_urls).toEqual([]);
    expect(await ownServerLines()).toEqual([]);

    const changed = await tool("update_game", { slug: "sky-hopper", own_server_urls: ["WSS://Play.Example.com/", "https://play.example.com", " wss://eu.example.com:8443 "] });
    expect(schemaProblems(GAME, changed.game)).toEqual([]);
    expect(changed.game.own_server_urls).toEqual(["wss://play.example.com", "wss://eu.example.com:8443"]);
    expect(await storedText()).toBe('["wss://play.example.com","wss://eu.example.com:8443"]');
    expect((await api("/games/sky-hopper")).answer.game.own_server_urls).toEqual(["wss://play.example.com", "wss://eu.example.com:8443"]);
    expect(await ownServerLines()).toEqual([{ place: "menu", text: "Online play runs on the developer&#39;s own servers: play.example.com, eu.example.com:8443" }]);
    expect(await history()).toContain("Changed the game's own servers");

    await tool("update_game", { slug: "sky-hopper", own_server_urls: ["wss://play.example.com"] });
    expect(await ownServerLines()).toEqual([{ place: "menu", text: "Online play runs on the developer&#39;s own server: play.example.com" }]);
    // The menu doesn't repeat the description the details already show.
    await env.DB.prepare("UPDATE games SET description = 'Hop between floating islands.' WHERE slug = 'sky-hopper'").run();
    expect((await gamePage()).match(/<div class="dropdown glass shut" id="menu-dialog"[\s\S]*?All games/)![0]).not.toContain("Hop between floating islands.");

    expect((await tool("update_game", { slug: "sky-hopper", own_server_urls: [] })).game.own_server_urls).toEqual([]);
    expect(await storedText()).toBe("[]");
    expect(await ownServerLines()).toEqual([]);
  });

  it("are on the privacy page: they see the player's connection address", async () => {
    expect(await (await SELF.fetch(`${SITE}/legal/privacy`)).text()).toContain("Some games run online play on their developer's own servers");
  });

  it("refuses anything but up to 5 server addresses on names of the developer's own", async () => {
    const refusals: unknown[] = [
      "wss://play.example.com",
      Array.from({ length: 6 }, (_, i) => `wss://s${i}.example.com`),
      ["play.example.com"],
      ["ws://play.example.com"],
      ["http://play.example.com"],
      ["wss://play.example.com/rooms"],
      ["wss://play.example.com?room=1"],
      ["wss://kit:secret@play.example.com"],
      ["wss://192.168.1.1"],
      ["wss://[::1]:8080"],
      ["wss://localhost:8080"],
      ["wss://rooms.zaisma.com"],
      ["https://other-game.zaismausercontent.com"],
      [42],
    ];
    for (const ownServerUrls of refusals) {
      const refused = await api("/games/sky-hopper", { method: "PATCH", body: { own_server_urls: ownServerUrls } });
      expect(refused.status, JSON.stringify(ownServerUrls)).toBe(400);
      expect(refused.answer.error).toMatchObject({ code: "bad_own_server_urls", field: "own_server_urls" });
    }
    expect(await stored()).toEqual([]);
  });

  it("are changed only with game write access", async () => {
    const readKey = (await createApiKey(env.DB, "dev-1", "ci", { accessLevel: "read", gameSlugs: null })).token;
    expect((await api("/games/sky-hopper", { method: "PATCH", body: { own_server_urls: ["wss://play.example.com"] }, key: readKey })).answer.error).toMatchObject({ code: "key_not_allowed" });
    expect(await stored()).toEqual([]);
  });

  it("can come with a new game", async () => {
    const made = await api("/games", { body: { title: "Cave Crew", slug: "cave-crew", own_server_urls: ["wss://caves.example.com"] } });
    expect(made.status).toBe(201);
    expect(made.answer.game.own_server_urls).toEqual(["wss://caves.example.com"]);
  });
});

describe("a game's own servers on the dashboard", () => {
  it("saves the rows as the whole list, and says what's wrong with a bad one", async () => {
    const cookie = await sessionCookie("dev-1");
    const form = new URLSearchParams({ own_server_url_0: "wss://play.example.com", own_server_url_1: "", own_server_url_2: "wss://eu.example.com" });
    const saved = await SELF.fetch(`${SITE}/dashboard/sky-hopper/own-servers`, { method: "POST", body: form, headers: { cookie, origin: SITE }, redirect: "manual" });
    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe("/dashboard/sky-hopper/details?done=own-servers#own-servers");
    expect(await stored()).toEqual(["wss://play.example.com", "wss://eu.example.com"]);
    const page = await (await SELF.fetch(`${SITE}/dashboard/sky-hopper/details?done=own-servers`, { headers: { cookie } })).text();
    expect(page).toContain('id="own-servers"');
    expect(page).toContain('value="wss://eu.example.com"');

    const refused = await SELF.fetch(`${SITE}/dashboard/sky-hopper/own-servers`, { method: "POST", body: new URLSearchParams({ own_server_url_0: "wss://192.168.1.1" }), headers: { cookie, origin: SITE }, redirect: "manual" });
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain("IP address");
    expect(await stored()).toEqual(["wss://play.example.com", "wss://eu.example.com"]);
  });
});
