import { createExecutionContext, env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MAXIMUM_API_KEY_COUNT, apiKeyTokensIn, createAccount, createApiKey, liveApiKeyCount, personOwner, createGame } from "@zaisma/core";
import worker from "../../apps/site/src/index.ts";
import { TOOLS } from "../../apps/site/src/mcp.ts";
import { API_KEYS } from "../../apps/site/src/schemas.ts";
import { derToRawEcdsaSignature } from "../../apps/site/src/leaked-keys.ts";
import { scanVersion, type ScanDeps } from "../../apps/site/src/scan.ts";
import { judgeSays, readsNothing, seesNothing } from "./scan-stubs.ts";
import { deleteOldSecurityEvents } from "../../apps/site/src/security-log.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";
import { letPublish } from "../helpers.ts";

// Keys that turn off by themselves (apps/site/src/leaked-keys.ts): GitHub's secret scanning, a game's uploaded
// files and forum posts turn a found key off for good; keys can have an end date; list_api_keys shows them.

const SITE = "https://zaisma.test";
const DAY_MS = 86400_000;
const MANCHESTER = { asn: 64500, asOrganization: "Vodafone", city: "Manchester", region: "England", country: "GB" };
const testEnv = { ...env, ANTHROPIC_API_KEY: "test-key" };
const pass: ScanDeps = {
  images: { check: async (images) => ({ provider: "test", isConnected: true, checkedMediaCount: images.length, findings: [] }) },
  readCode: readsNothing,
  readPictures: seesNothing,
  judge: judgeSays("pass"),
};
const GITHUB_KEYS_URL = "https://api.github.com/meta/public_keys/secret_scanning";
const KEY_IDENTIFIER = "test-key-identifier";
const REPO_URL = "https://github.com/sam/space-game/blob/main/.mcp.json";

let nextId = 1;
let signingKey: CryptoKey;
let publicKeyPem = "";
let isGithubUp = true;
let githubKeyListCalls = 0;
const realFetch = globalThis.fetch;

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** r‖s as ASN.1 DER, the way GitHub sends a signature. */
function derFromRaw(raw: Uint8Array): Uint8Array {
  const integer = (bytes: Uint8Array) => {
    let trimmed = bytes;
    while (trimmed.length > 1 && trimmed[0] === 0) trimmed = trimmed.slice(1);
    const padded = trimmed[0]! >= 0x80 ? Uint8Array.from([0, ...trimmed]) : trimmed;
    return Uint8Array.from([0x02, padded.length, ...padded]);
  };
  const body = [...integer(raw.slice(0, 32)), ...integer(raw.slice(32))];
  return Uint8Array.from([0x30, body.length, ...body]);
}

async function signed(body: string, overrides: { identifier?: string | null; signature?: string | null } = {}): Promise<Request> {
  const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, new TextEncoder().encode(body)));
  const headers: Record<string, string> = { "content-type": "application/json" };
  const identifier = overrides.identifier === undefined ? KEY_IDENTIFIER : overrides.identifier;
  const signature = overrides.signature === undefined ? toBase64(derFromRaw(raw)) : overrides.signature;
  if (identifier !== null) headers["github-public-key-identifier"] = identifier;
  if (signature !== null) headers["github-public-key-signature"] = signature;
  return new Request(`${SITE}/github/secret-scanning`, { method: "POST", headers, body });
}

const send = (request: Request) => worker.fetch(request as never, env, createExecutionContext());

async function github(matches: unknown[], overrides: Parameters<typeof signed>[1] = {}) {
  const response = await send(await signed(JSON.stringify(matches), overrides));
  return { status: response.status, answer: response.headers.get("content-type")?.includes("json") ? ((await response.json()) as any) : await response.text() };
}

async function api(path: string, key: string, init: { body?: unknown; cf?: Record<string, unknown>; userAgent?: string } = {}) {
  const response = await worker.fetch(
    new Request(`${SITE}/api/dev${path}`, {
      method: init.body ? "POST" : "GET",
      headers: { authorization: `Bearer ${key}`, "cf-connecting-ip": "203.0.113.40", ...(init.userAgent ? { "user-agent": init.userAgent } : {}), ...(init.body ? { "content-type": "application/json" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      ...(init.cf ? { cf: init.cf as unknown as IncomingRequestCfProperties } : {}),
    }),
    env,
    createExecutionContext(),
  );
  const answer = (await response.json()) as any;
  if (!response.ok) expect(errorProblems(answer, response.status)).toEqual([]);
  return { status: response.status, answer };
}

async function tool(name: string, key: string, toolArguments: Record<string, unknown> = {}): Promise<any> {
  const response = await worker.fetch(
    new Request(`${SITE}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${key}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: toolArguments } }),
    }),
    env,
    createExecutionContext(),
  );
  const { result } = (await response.json()) as any;
  if (result.isError) {
    expect(errorProblems(result.structuredContent)).toEqual([]);
    return result.structuredContent;
  }
  expect(schemaProblems(TOOLS.find((candidate) => candidate.name === name)!.outputSchema!, result.structuredContent, name)).toEqual([]);
  return result.structuredContent;
}

/** A call through the MCP the key isn't allowed to make at all: refused before any tool runs, with the API's error. */
async function toolRefused(key: string): Promise<{ status: number; error: any }> {
  const response = await worker.fetch(
    new Request(`${SITE}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${key}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name: "list_games", arguments: {} } }),
    }),
    env,
    createExecutionContext(),
  );
  const answer = (await response.json()) as any;
  return { status: response.status, error: answer.error ?? answer.result?.structuredContent?.error };
}

const rowOf = async (token: string) => (await env.DB.prepare("SELECT * FROM api_keys WHERE id = ?").bind(token.split("_")[1]).first<Record<string, any>>())!;
const eventsOf = (kind: string) =>
  env.DB.prepare("SELECT * FROM security_events WHERE kind = ? ORDER BY id")
    .bind(kind)
    .all<Record<string, any>>()
    .then(({ results }) => results);

/** A shape that looks like a key but isn't one. */
const lookAlike = () => `zsk_${"a".repeat(20)}_${"B".repeat(43)}`;

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  signingKey = pair.privateKey;
  const spki = new Uint8Array((await crypto.subtle.exportKey("spki", pair.publicKey)) as ArrayBuffer);
  publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${toBase64(spki).replace(/(.{64})/g, "$1\n")}\n-----END PUBLIC KEY-----\n`;
});

beforeEach(async () => {
  isGithubUp = true;
  githubKeyListCalls = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url !== GITHUB_KEYS_URL) return realFetch(input, init);
    githubKeyListCalls++;
    if (!isGithubUp) return new Response("down", { status: 502 });
    return Response.json({ public_keys: [{ key_identifier: KEY_IDENTIFIER, key: publicKeyPem, is_current: true }] });
  });
  await env.DB.exec(
    "DELETE FROM security_events; DELETE FROM security_places; DELETE FROM forum_posts; DELETE FROM forum_topic_tags; DELETE FROM forum_votes; DELETE FROM forum_follows; DELETE FROM forum_search; DELETE FROM forum_mentions; DELETE FROM forum_topics; DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM versions; DELETE FROM blobs; DELETE FROM blob_owners; DELETE FROM owned_blobs; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;",
  );
  await createAccount(env.DB, { id: "dev-1", username: "Pixel_Smith", ageBand: "18+" });
  await letPublish(env.DB, "dev-1");
  await createAccount(env.DB, { id: "dev-2", username: "Other_Dev", ageBand: "18+" });
  await letPublish(env.DB, "dev-2");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHub's secret scanning", () => {
  it("turns off a key it found, answers true_positive, and logs it; the same token again changes nothing", async () => {
    const { token } = await createApiKey(env.DB, "dev-1", "space-game CI");
    const found = await github([{ token, type: "zaisma_api_key", url: REPO_URL, source: "content" }]);
    expect(found).toEqual({ status: 200, answer: [{ token_raw: token, token_type: "zaisma_api_key", label: "true_positive" }] });
    const row = await rowOf(token);
    expect(row).toMatchObject({ found_in: "github", found_at_url: REPO_URL });
    expect(row.turned_off_at_ms).toBeGreaterThan(Date.now() - 5000);
    expect(await eventsOf("api_key_turned_off")).toMatchObject([{ account_id: "dev-1", done_by: "zaisma", api_key_name: "space-game CI", subject_name: "space-game CI", city_name: null, connection_address: null }]);

    const again = await github([{ token, type: "zaisma_api_key", url: "https://github.com/other/place", source: "commit" }]);
    expect(again.answer).toEqual([{ token_raw: token, token_type: "zaisma_api_key", label: "true_positive" }]);
    expect(await rowOf(token)).toMatchObject({ found_at_url: REPO_URL, turned_off_at_ms: row.turned_off_at_ms });
    expect(await eventsOf("api_key_turned_off")).toHaveLength(1);
  });

  it("answers false_positive for a token that isn't a key, and a key with the wrong secret stays on", async () => {
    const { token } = await createApiKey(env.DB, "dev-1", "laptop");
    const wrongSecret = `${token.slice(0, 25)}${"x".repeat(43)}`;
    const answer = await github([{ token: lookAlike(), type: "zaisma_api_key", url: "", source: "content" }, { token: wrongSecret, type: "zaisma_api_key", url: "", source: "content" }, { token: "nothing", type: "zaisma_api_key" }]);
    expect(answer.answer.map((each: any) => each.label)).toEqual(["false_positive", "false_positive", "false_positive"]);
    expect(await rowOf(token)).toMatchObject({ turned_off_at_ms: null, found_in: null });
    expect(await eventsOf("api_key_turned_off")).toEqual([]);
  });

  it("refuses a bad signature, an unknown key identifier and missing headers, and changes nothing", async () => {
    const { token } = await createApiKey(env.DB, "dev-1", "laptop");
    const matches = [{ token, type: "zaisma_api_key", url: REPO_URL, source: "content" }];
    expect((await github(matches, { signature: toBase64(derFromRaw(new Uint8Array(64).fill(7))) })).status).toBe(401);
    expect((await github(matches, { signature: "not base64 at all!" })).status).toBe(401);
    expect((await github(matches, { identifier: "someone-else" })).status).toBe(401);
    expect((await github(matches, { identifier: null })).status).toBe(401);
    expect((await github(matches, { signature: null })).status).toBe(401);
    // Signed for another body.
    const other = await signed(JSON.stringify([{ token: "different" }]));
    const swapped = new Request(other.url, { method: "POST", headers: other.headers, body: JSON.stringify(matches) });
    expect((await send(swapped)).status).toBe(401);
    expect(await rowOf(token)).toMatchObject({ turned_off_at_ms: null });
    // An unknown identifier asks GitHub for its list once more before refusing.
    const before = githubKeyListCalls;
    await github(matches, { identifier: "someone-else" });
    expect(githubKeyListCalls).toBe(before + 1);
  });

  it("answers 503 when GitHub's keys can't be fetched, so GitHub tries again, and 405 for anything but POST", async () => {
    const { token } = await createApiKey(env.DB, "dev-1", "laptop");
    // An identifier the cached list doesn't have, with GitHub down.
    isGithubUp = false;
    expect((await github([{ token }], { identifier: "fresh-identifier" })).status).toBe(503);
    expect(await rowOf(token)).toMatchObject({ turned_off_at_ms: null });
    const get = await send(new Request(`${SITE}/github/secret-scanning`));
    expect(get.status).toBe(405);
  });

  it("refuses a body over 1 MB", async () => {
    const big = new Request(`${SITE}/github/secret-scanning`, { method: "POST", headers: { "github-public-key-identifier": KEY_IDENTIFIER, "github-public-key-signature": "AA==", "content-length": "2000000" }, body: "[]" });
    expect((await send(big)).status).toBe(413);
  });

  it("makes the turned-off key answer key_turned_off to the API and the MCP, without marking a use", async () => {
    const { token } = await createApiKey(env.DB, "dev-1", "space-game CI");
    expect((await api("/access", token)).status).toBe(200);
    const usedAtMs = (await rowOf(token)).last_used_at_ms;
    await github([{ token, type: "zaisma_api_key", url: REPO_URL, source: "content" }]);
    const refused = await api("/games", token);
    expect(refused.status).toBe(401);
    expect(refused.answer.error).toMatchObject({
      code: "key_turned_off",
      field: "Authorization",
      message: expect.stringContaining("found in public at github.com/sam/space-game/blob/main/.mcp.json and turned off on "),
      fix: expect.stringContaining("Make a new key on zaisma.com/dashboard/settings"),
    });
    const viaTool = await toolRefused(token);
    expect(viaTool.error.data.error.code).toBe("key_turned_off");
    expect((await rowOf(token)).last_used_at_ms).toBe(usedAtMs);
  });
});

describe("keys in text", () => {
  it("finds whole keys and nothing shorter or longer", async () => {
    const { token } = await createApiKey(env.DB, "dev-1", "laptop");
    expect(apiKeyTokensIn(`before ${token}, again ${token}; after`)).toEqual([token]);
    expect(apiKeyTokensIn(`${token}extra`)).toEqual([]);
    expect(apiKeyTokensIn("zsk_short_abc")).toEqual([]);
    expect(apiKeyTokensIn(lookAlike())).toEqual([lookAlike()]);
  });

  it("turns DER signatures into the 64 bytes WebCrypto takes", () => {
    const raw = Uint8Array.from({ length: 64 }, (_, i) => (i === 0 ? 0 : i === 32 ? 0xff : i + 1));
    expect(derToRawEcdsaSignature(derFromRaw(raw))).toEqual(raw);
    expect(derToRawEcdsaSignature(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(derToRawEcdsaSignature(new Uint8Array(0))).toBeNull();
  });
});

describe("keys in a game's files", () => {
  it("turns a live key off, shows the finding with its path, and still passes", async () => {
    const { token } = await createApiKey(env.DB, "dev-1", "space-game CI");
    const owner = await personOwner(env.DB, "dev-1");
    await createGame(env.DB, { slug: "hop", title: "Hop", description: "", ownerId: owner.id, visibility: "draft" });
    const live = (await createApiKey(env.DB, "dev-1", "uploader")).token;
    const files = { "index.html": "<!doctype html><script src='game.js'></script>", "game.js": `const KEY = "${token}"; const decoy = "${lookAlike()}";` };
    const list = await Promise.all(
      Object.entries(files).map(async ([path, text]) => {
        const bytes = new TextEncoder().encode(text);
        const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
        return { path, sha256, size_bytes: bytes.byteLength, bytes };
      }),
    );
    for (const file of list) {
      const put = await SELF.fetch(`${SITE}/api/dev/files/${file.sha256}`, { method: "PUT", headers: { authorization: `Bearer ${live}` }, body: file.bytes });
      expect(put.status).toBe(200);
    }
    const made = await api("/games/hop/versions", live, { body: { files: list.map(({ bytes: _, ...file }) => file) } });
    expect(made.status).toBe(201);
    await scanVersion(testEnv, made.answer.version.id, pass);

    expect(await rowOf(token)).toMatchObject({ found_in: "game_files", found_at_url: null });
    // The look-alike is no key, and the key that sent the upload is untouched.
    expect(await rowOf(live)).toMatchObject({ turned_off_at_ms: null });
    const version = (await api(`/games/hop/versions/${made.answer.version.id}`, live)).answer.version;
    expect(version.scan_status).toBe("approved");
    expect(version.findings).toMatchObject([{ code: "api_key_in_files", severity: "info", path: "game.js", content_rule: null, fix: expect.stringContaining("Take the key out of the file") }]);
    expect(await eventsOf("api_key_turned_off")).toHaveLength(1);
  });
});

describe("keys in forum posts", () => {
  it("turns a key off in a public topic and a reply, with the topic's address, and stores them blanked", async () => {
    const poster = (await createApiKey(env.DB, "dev-2", "claude")).token;
    const inTopic = (await createApiKey(env.DB, "dev-1", "in the topic")).token;
    const inReply = (await createApiKey(env.DB, "dev-1", "in the reply")).token;
    const inTitle = (await createApiKey(env.DB, "dev-1", "in the title")).token;
    const topic = await api("/forum", poster, { body: { kind: "bug", title: `Why ${inTitle} fails`, category: "other", text_markdown: `My key ${inTopic} fails`, author_kind: "developer" } });
    expect(topic.status).toBe(201);
    const topicId = topic.answer.topic.id as string;
    expect(topic.answer.posts[0].text_markdown).toBe("My key [secret removed] fails");
    expect(await rowOf(inTopic)).toMatchObject({ found_in: "forum_post", found_at_url: `${SITE}/forum/${topicId}` });
    expect(await rowOf(inTitle)).toMatchObject({ found_in: "forum_post", found_at_url: `${SITE}/forum/${topicId}` });

    const reply = await api(`/forum/${topicId}/posts`, poster, { body: { text_markdown: `And ${inReply}` } });
    expect(reply.status).toBe(201);
    expect(reply.answer.post.text_markdown).toBe("And [secret removed]");
    expect(await rowOf(inReply)).toMatchObject({ found_in: "forum_post", found_at_url: `${SITE}/forum/${topicId}` });
  });

  it("turns a key off in a private message to Zaisma, and in its debug_context, with no address", async () => {
    const poster = (await createApiKey(env.DB, "dev-2", "claude")).token;
    const inText = (await createApiKey(env.DB, "dev-1", "in the text")).token;
    const inContext = (await createApiKey(env.DB, "dev-1", "in the context")).token;
    const message = await api("/forum", poster, { body: { is_public: false, kind: "bug", title: "Upload fails", text_markdown: `Key ${inText}`, debug_context: { notes: `header ${inContext}` } } });
    expect(message.status).toBe(201);
    expect(await rowOf(inText)).toMatchObject({ found_in: "forum_post", found_at_url: null });
    expect(await rowOf(inContext)).toMatchObject({ found_in: "forum_post", found_at_url: null });
    expect(message.answer.posts[0].text_markdown).toBe("Key [secret removed]");
  });
});

describe("end dates", () => {
  it("lets a key made for 7 days work, then answers key_ended; get_access shows the end", async () => {
    const { token, key } = await createApiKey(env.DB, "dev-1", "short", { accessLevel: "full", gameSlugs: null, endsAfterDays: 7 });
    expect(key.ends_at_ms! - Date.now()).toBeGreaterThan(7 * DAY_MS - 5000);
    const access = await tool("get_access", token);
    expect(Date.parse(access.access.api_key_ends_at) - Date.now()).toBeGreaterThan(7 * DAY_MS - 5000);
    // No end date: null.
    const forever = (await createApiKey(env.DB, "dev-1", "forever")).token;
    expect((await tool("get_access", forever)).access.api_key_ends_at).toBeNull();

    // Seven days on.
    await env.DB.prepare("UPDATE api_keys SET ends_at_ms = ? WHERE id = ?").bind(Date.now() - 1000, key.id).run();
    const ended = await api("/access", token);
    expect(ended.status).toBe(401);
    expect(ended.answer.error).toMatchObject({ code: "key_ended", message: expect.stringMatching(/^This API key's end date was \d{4}-\d{2}-\d{2}\.$/), fix: expect.stringContaining("Make a new key") });
    const viaTool = await toolRefused(token);
    expect(viaTool.error.data.error.code).toBe("key_ended");
  });

  it("refuses an end date that isn't one of the choices, and doesn't count dead keys toward the limit", async () => {
    const { checkKeyScope } = await import("@zaisma/core");
    expect(checkKeyScope({ accessLevel: "full", gameSlugs: null, endsAfterDays: 8 })).toMatch(/when the key ends/);
    for (const days of [null, 7, 30, 90, 365]) expect(checkKeyScope({ accessLevel: "full", gameSlugs: null, endsAfterDays: days })).toBeNull();
    for (let i = 0; i < MAXIMUM_API_KEY_COUNT; i++) await createApiKey(env.DB, "dev-1", `key ${i}`);
    expect(await liveApiKeyCount(env.DB, "dev-1")).toBe(MAXIMUM_API_KEY_COUNT);
    const keys = await env.DB.prepare("SELECT id FROM api_keys WHERE account_id = 'dev-1' ORDER BY created_at_ms").all<{ id: string }>();
    await env.DB.prepare("UPDATE api_keys SET turned_off_at_ms = ?, found_in = 'github' WHERE id = ?").bind(Date.now(), keys.results[0]!.id).run();
    await env.DB.prepare("UPDATE api_keys SET ends_at_ms = ? WHERE id = ?").bind(Date.now() - 1000, keys.results[1]!.id).run();
    expect(await liveApiKeyCount(env.DB, "dev-1")).toBe(MAXIMUM_API_KEY_COUNT - 2);
  });

  it("deletes a key 90 days after it stopped working, and keeps a live unused one", async () => {
    const turnedOff = (await createApiKey(env.DB, "dev-1", "leaked")).key;
    const ended = (await createApiKey(env.DB, "dev-1", "ended")).key;
    const recent = (await createApiKey(env.DB, "dev-1", "recent")).key;
    const live = (await createApiKey(env.DB, "dev-1", "live")).key;
    const nowMs = Date.now();
    await env.DB.prepare("UPDATE api_keys SET turned_off_at_ms = ?, found_in = 'github' WHERE id = ?").bind(nowMs - 91 * DAY_MS, turnedOff.id).run();
    await env.DB.prepare("UPDATE api_keys SET ends_at_ms = ? WHERE id = ?").bind(nowMs - 91 * DAY_MS, ended.id).run();
    await env.DB.prepare("UPDATE api_keys SET turned_off_at_ms = ?, found_in = 'github' WHERE id = ?").bind(nowMs - 10 * DAY_MS, recent.id).run();
    await env.DB.prepare("INSERT INTO security_places (account_id, api_key_id, place_sha256, first_seen_at_ms, last_seen_at_ms) VALUES ('dev-1', ?, 'abc', ?, ?)").bind(turnedOff.id, nowMs, nowMs).run();
    await deleteOldSecurityEvents(env as never, nowMs);
    const left = (await env.DB.prepare("SELECT name FROM api_keys WHERE account_id = 'dev-1' ORDER BY name").all<{ name: string }>()).results.map((row) => row.name);
    expect(left).toEqual(["live", "recent"]);
    expect((await env.DB.prepare("SELECT COUNT(*) AS place_count FROM security_places WHERE api_key_id = ?").bind(turnedOff.id).first<{ place_count: number }>())!.place_count).toBe(0);
  });
});

describe("GET /api-keys and list_api_keys", () => {
  it("answers every key, newest first, with where each was used and is_this_key only for the caller's", async () => {
    const first = await createApiKey(env.DB, "dev-1", "Claude Desktop");
    const second = await createApiKey(env.DB, "dev-1", "space-game CI", { accessLevel: "upload", gameSlugs: ["hop"], endsAfterDays: 30 });
    await createApiKey(env.DB, "dev-2", "someone else's");
    await api("/access", first.token, { cf: MANCHESTER, userAgent: "zaisma-cli/1.4.0" });
    await github([{ token: second.token, type: "zaisma_api_key", url: REPO_URL, source: "content" }]);

    const listed = await tool("list_api_keys", first.token);
    expect(listed.api_keys.map((key: any) => key.api_key_name)).toEqual(["space-game CI", "Claude Desktop"]);
    const [off, on] = listed.api_keys;
    expect(on).toMatchObject({ is_this_key: true, access_level: "full", game_slugs: null, ends_at: null, turned_off_at: null, found_in: null, found_at_url: null });
    expect(on.last_used_where).toContain("Vodafone, near Manchester, UK");
    expect(on.last_used_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(off).toMatchObject({ is_this_key: false, access_level: "upload", game_slugs: ["hop"], found_in: "github", found_at_url: REPO_URL, last_used_at: null, last_used_where: null });
    expect(Date.parse(off.ends_at)).toBeGreaterThan(Date.now() + 29 * DAY_MS);
    expect(Object.keys(on)).not.toContain("id");
    expect((await api("/api-keys", first.token)).answer).toEqual(listed);
    expect(schemaProblems(API_KEYS, listed, "api keys")).toEqual([]);
  });

  it("is for full keys only", async () => {
    const read = (await createApiKey(env.DB, "dev-1", "reader", { accessLevel: "read", gameSlugs: null })).token;
    const limited = (await createApiKey(env.DB, "dev-1", "one game", { accessLevel: "full", gameSlugs: ["hop"] })).token;
    const refusedRead = await api("/api-keys", read);
    expect(refusedRead.status).toBe(403);
    expect(refusedRead.answer.error).toMatchObject({ code: "key_not_allowed", message: expect.stringContaining("GET /api-keys needs one") });
    const refusedLimited = await api("/api-keys", limited);
    expect(refusedLimited.status).toBe(403);
    expect(refusedLimited.answer.error).toMatchObject({ code: "key_not_allowed", message: expect.stringContaining("acts for the whole account") });
  });
});
