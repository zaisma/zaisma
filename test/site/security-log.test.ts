import { createExecutionContext, env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { accountById, createAccount, createApiKey, createGame, createWebhook, personOwner, sha256Hex } from "@zaisma/core";
import worker from "../../apps/site/src/index.ts";
import { TOOLS } from "../../apps/site/src/mcp.ts";
import { ACTIVITY, HISTORY } from "../../apps/site/src/schemas.ts";
import { deleteOldSecurityEvents, setWhereUsedFrom } from "../../apps/site/src/security-log.ts";
import { errorProblems, schemaProblems } from "../schema-check.ts";
import { letPublish } from "../helpers.ts";

// The security log through the developer API and MCP (apps/site/src/security-log.ts): who did what from where,
// a key's new places, folded events, the Activity answer and a game's history. The account page's side is in
// accounts.test.ts ("the security log on the account page"), which has the sign-in stand-in.

const SITE = "https://zaisma.test";
const DAY_MS = 86400_000;
const MANCHESTER = { asn: 64500, asOrganization: "Vodafone", city: "Manchester", region: "England", country: "GB" };
const DES_MOINES = { asn: 8075, asOrganization: "Microsoft Corporation", city: "Des Moines", region: "Iowa", country: "US" };
const CLI = "zaisma-cli/0.9.1";

let nextId = 1;
let accountId = "dev-1";

interface Made {
  key?: string;
  method?: string;
  body?: unknown;
  bytes?: Uint8Array;
  cf?: Record<string, unknown>;
  userAgent?: string;
}

async function api(path: string, made: Made = {}) {
  const response = await worker.fetch(
    new Request(`${SITE}/api/dev${path}`, {
      method: made.method ?? (made.body ? "POST" : "GET"),
      headers: { authorization: `Bearer ${made.key}`, "cf-connecting-ip": "203.0.113.40", ...(made.userAgent ? { "user-agent": made.userAgent } : {}), ...(made.body ? { "content-type": "application/json" } : {}) },
      body: made.bytes ?? (made.body ? JSON.stringify(made.body) : undefined),
      ...(made.cf ? { cf: made.cf as unknown as IncomingRequestCfProperties } : {}),
    }),
    env,
    createExecutionContext(),
  );
  const answer = (await response.json()) as any;
  if (!response.ok) expect(errorProblems(answer, response.status)).toEqual([]);
  return { status: response.status, answer };
}

async function tool(name: string, key: string, toolArguments: Record<string, unknown> = {}, cf?: Record<string, unknown>): Promise<any> {
  const response = await worker.fetch(
    new Request(`${SITE}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${key}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: toolArguments } }),
      ...(cf ? { cf: cf as unknown as IncomingRequestCfProperties } : {}),
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

const eventsOf = (kind?: string) =>
  env.DB.prepare(`SELECT * FROM security_events WHERE account_id = ?${kind ? " AND kind = ?" : ""} ORDER BY id`)
    .bind(...(kind ? [accountId, kind] : [accountId]))
    .all<Record<string, any>>()
    .then(({ results }) => results);

const insertEvent = (kind: string, happenedAtMs: number, fields: Record<string, unknown> = {}) =>
  env.DB.prepare("INSERT INTO security_events (account_id, kind, done_by, device, city_name, country_code, connection_address, happened_at_ms, last_happened_at_ms) VALUES (?, ?, 'you', ?, ?, ?, ?, ?, ?)")
    .bind(accountId, kind, fields.device ?? null, fields.city ?? null, fields.country ?? null, fields.address ?? null, happenedAtMs, happenedAtMs)
    .run();

async function makeGame(slug: string) {
  const owner = await personOwner(env.DB, accountId);
  return createGame(env.DB, { slug, title: slug, description: "", ownerId: owner.id, visibility: "draft" });
}

beforeEach(async () => {
  await env.DB.exec(
    "DELETE FROM security_events; DELETE FROM security_places; DELETE FROM webhooks; DELETE FROM api_keys; DELETE FROM audit_log; DELETE FROM versions; DELETE FROM blobs; DELETE FROM blob_owners; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM owners; DELETE FROM accounts;",
  );
  accountId = `dev-${crypto.randomUUID()}`;
  await createAccount(env.DB, { id: accountId, username: `Pixel_${Math.floor(Math.random() * 1e6)}`, ageBand: "18+" });
  await letPublish(env.DB, accountId);
});

describe("GET /activity and get_activity", () => {
  it("answer the last 90 days, newest first, 50 a page", async () => {
    const full = (await createApiKey(env.DB, accountId, "full")).token;
    await insertEvent("signed_in_new_device", Date.now() - 91 * DAY_MS, { device: "Chrome on a Windows PC" });
    for (let i = 0; i < 60; i++) await insertEvent("password_changed", Date.now() - (60 - i) * 1000);
    const first = await api("/activity", { key: full });
    expect(first.status).toBe(200);
    expect(schemaProblems(ACTIVITY, first.answer)).toEqual([]);
    expect(first.answer.events).toHaveLength(50);
    expect(first.answer.events[0]).toMatchObject({ kind: "password_changed", description: "Changed your password", done_by: "you" });
    expect(first.answer.events.map((event: { happened_at: string }) => event.happened_at)).toEqual([...first.answer.events.map((event: { happened_at: string }) => event.happened_at)].sort().reverse());
    expect(first.answer.where_used_from_enabled).toBe(true);
    const second = await api(`/activity?cursor=${first.answer.next_cursor}`, { key: full });
    expect(second.answer.events).toHaveLength(10);
    expect(second.answer.next_cursor).toBeNull();
    // Not the sign-in from 91 days ago.
    expect([...first.answer.events, ...second.answer.events].map((event: { kind: string }) => event.kind)).not.toContain("signed_in_new_device");

    const bad = await api("/activity?cursor=nonsense", { key: full });
    expect(bad.status).toBe(400);
    expect(bad.answer.error).toMatchObject({ code: "bad_cursor", field: "cursor" });

    // The MCP answers the same.
    const viaMcp = await tool("get_activity", full);
    // Newest first: the AI's connection, from this very call, then the same events.
    expect(viaMcp.events[0]).toMatchObject({ kind: "ai_connected", done_by: "ai" });
    expect(viaMcp.events[1]).toMatchObject({ kind: "password_changed" });
    expect(viaMcp.events).toHaveLength(50);
  });

  it("need a full key for every game", async () => {
    for (const scope of [{ accessLevel: "read" as const, gameSlugs: null }, { accessLevel: "publish" as const, gameSlugs: null }, { accessLevel: "full" as const, gameSlugs: ["sky-hopper"] }]) {
      const key = (await createApiKey(env.DB, accountId, "limited", scope)).token;
      const refused = await api("/activity", { key });
      expect(refused.status).toBe(403);
      expect(refused.answer.error.code).toBe("key_not_allowed");
      expect((await tool("get_activity", key)).error.code).toBe("key_not_allowed");
    }
  });
});

describe("a key's places", () => {
  it("log a new place once for each network and country, and an AI's first call", async () => {
    const key = (await createApiKey(env.DB, accountId, "GitHub Actions")).token;
    await api("/games", { key, cf: MANCHESTER as unknown as IncomingRequestCfProperties });
    await api("/games", { key, cf: MANCHESTER as unknown as IncomingRequestCfProperties });
    expect(await eventsOf("api_key_new_place")).toHaveLength(1);
    await api("/games", { key, cf: DES_MOINES as unknown as IncomingRequestCfProperties });
    const places = await eventsOf("api_key_new_place");
    expect(places).toHaveLength(2);
    expect(places[1]).toMatchObject({ done_by: "api_key", api_key_name: "GitHub Actions", country_code: "US", network_name: "Microsoft Corporation", is_new_place: 1, connection_address: "203.0.113.40" });
    // Back to the first: known.
    await api("/games", { key, cf: MANCHESTER as unknown as IncomingRequestCfProperties });
    expect(await eventsOf("api_key_new_place")).toHaveLength(2);

    await tool("get_access", key, {}, MANCHESTER);
    expect(await eventsOf("ai_connected")).toMatchObject([{ done_by: "ai", api_key_name: "GitHub Actions", device: null }]);
    await tool("get_access", key, {}, MANCHESTER);
    expect(await eventsOf("ai_connected")).toHaveLength(1);
  });
});

describe("where a key was last used from", () => {
  const lastUsedWhere = async (key: string) => (await api("/api-keys", { key })).answer.api_keys.find((each: any) => each.is_this_key).last_used_where;

  it("shows what it was used with and from where while the account keeps where, and nothing once that's turned off", async () => {
    const key = (await createApiKey(env.DB, accountId, "GitHub Actions")).token;
    await api("/games", { key, userAgent: CLI, cf: MANCHESTER as unknown as IncomingRequestCfProperties });
    expect(await lastUsedWhere(key)).toBe("the upload command 0.9.1 · Vodafone, near Manchester, UK");
    // A new place replaces it.
    await api("/games", { key, userAgent: CLI, cf: DES_MOINES as unknown as IncomingRequestCfProperties });
    expect(await lastUsedWhere(key)).toBe("the upload command 0.9.1 · Microsoft Corporation, near Des Moines, US");

    // Turning Keep where my account is used from off wipes it, and later calls keep nothing.
    await setWhereUsedFrom(new Request(`${SITE}/account`), env as never, (await accountById(env.DB, accountId))!, false);
    expect(await lastUsedWhere(key)).toBeNull();
    await api("/games", { key, userAgent: CLI, cf: MANCHESTER as unknown as IncomingRequestCfProperties });
    expect(await lastUsedWhere(key)).toBeNull();
  });

  it("forgets the place 90 days after the last use, and keeps the time", async () => {
    const key = (await createApiKey(env.DB, accountId, "old")).key;
    await env.DB.prepare("UPDATE api_keys SET last_used_at_ms = ?, last_used_device = 'the upload command 0.9.1', last_used_city_name = 'Manchester', last_used_country_code = 'GB' WHERE id = ?")
      .bind(Date.now() - 91 * DAY_MS, key.id)
      .run();
    await deleteOldSecurityEvents(env as never);
    expect(await env.DB.prepare("SELECT last_used_device, last_used_city_name, last_used_country_code, last_used_at_ms FROM api_keys WHERE id = ?").bind(key.id).first()).toMatchObject({ last_used_device: null, last_used_city_name: null, last_used_country_code: null, last_used_at_ms: expect.any(Number) });
  });
});

describe("a game's history", () => {
  it("says who did a key's upload, from where, and marks the first change from a new place", async () => {
    const key = (await createApiKey(env.DB, accountId, "GitHub Actions")).token;
    await makeGame("sky-hopper");
    const bytes = new TextEncoder().encode("<!doctype html><p>hop</p>");
    const sha256 = await sha256Hex(bytes);
    const sent = await worker.fetch(
      new Request(`${SITE}/api/dev/files/${sha256}`, { method: "PUT", headers: { authorization: `Bearer ${key}`, "content-length": String(bytes.byteLength), "user-agent": CLI }, body: bytes, cf: DES_MOINES as unknown as IncomingRequestCfProperties }),
      env,
      createExecutionContext(),
    );
    expect(sent.status).toBe(200);
    const uploaded = await api("/games/sky-hopper/versions", { key, userAgent: CLI, cf: DES_MOINES, body: { files: [{ path: "index.html", sha256, size_bytes: bytes.byteLength }] } });
    expect(uploaded.status).toBe(201);
    const { answer } = await api("/games/sky-hopper/history", { key, userAgent: CLI, cf: DES_MOINES as unknown as IncomingRequestCfProperties });
    expect(schemaProblems(HISTORY, answer)).toEqual([]);
    expect(answer.events[0]).toMatchObject({
      description: "Uploaded a version",
      version_id: uploaded.answer.version.id,
      done_by: "api_key",
      api_key_name: "GitHub Actions",
      device: "the upload command 0.9.1",
      network_name: "Microsoft Corporation",
      country_code: "US",
      connection_address: "203.0.113.40",
      is_new_place: true,
      occurrence_count: 1,
    });
    // The next change from that place isn't new.
    await api("/games/sky-hopper", { key, method: "PATCH", userAgent: CLI, cf: DES_MOINES, body: { description: "Hop higher." } });
    const next = (await api("/games/sky-hopper/history", { key, cf: DES_MOINES as unknown as IncomingRequestCfProperties })).answer.events;
    expect(next[0]).toMatchObject({ description: "Changed the details", is_new_place: false });
    expect(next[1]).toMatchObject({ description: "Uploaded a version", is_new_place: true });
  });

  it("folds SQL writes in an hour into one event, and logs no read", async () => {
    const key = (await createApiKey(env.DB, accountId, "claude")).token;
    await makeGame("sky-hopper");
    const query = (sql: string) => api("/games/sky-hopper/database/query", { key, body: { sql } });
    expect((await query("CREATE TABLE scores (player_id TEXT PRIMARY KEY, best_score INTEGER)")).status).toBe(200);
    expect((await query("INSERT INTO scores VALUES ('a', 1)")).status).toBe(200);
    expect((await query("INSERT INTO scores VALUES ('b', 2)")).status).toBe(200);
    expect((await query("SELECT * FROM scores")).status).toBe(200);
    const written = (await eventsOf("database_written")).filter((event) => event.game_id !== null);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ occurrence_count: 3 });
    const { answer } = await api("/games/sky-hopper/history", { key });
    expect(schemaProblems(HISTORY, answer)).toEqual([]);
    expect(answer.events[0]).toMatchObject({ description: "Changed the database with SQL", occurrence_count: 3 });
  });

  it("shows webhooks and sign-in apps to a key that isn't limited to some games, and not to one that is", async () => {
    const full = (await createApiKey(env.DB, accountId, "full")).token;
    const owner = await personOwner(env.DB, accountId);
    await makeGame("sky-hopper");
    await createWebhook(env.DB, { ownerId: owner.id, destinationKind: "endpoint_url", endpointUrl: "https://hooks.example.test/zaisma", eventKinds: ["bug_reported"], gameSlugs: null });
    const made = await api("/webhooks", { key: full, body: { endpoint_url: "https://hooks.example.test/two", event_kinds: ["bug_reported"] } });
    expect(made.status).toBe(201);
    const limited = (await createApiKey(env.DB, accountId, "one game", { accessLevel: "publish", gameSlugs: ["sky-hopper"] })).token;
    const descriptions = async (key: string) => (await api("/games/sky-hopper/history", { key })).answer.events.map((event: { description: string }) => event.description);
    expect(await descriptions(full)).toContain("Made a webhook");
    expect(await descriptions(limited)).not.toContain("Made a webhook");
  });
});

describe("keeping the log", () => {
  it("deletes sign-ins after 90 days and takes the place and address off the rest, and old places", async () => {
    await insertEvent("signed_in_new_device", Date.now(), { device: "Chrome on a Windows PC", city: "Manchester", country: "GB" });
    await insertEvent("version_uploaded", Date.now(), { device: "the upload command 0.9.1", city: "Des Moines", country: "US", address: "203.0.113.40" });
    const key = (await createApiKey(env.DB, accountId, "k")).token;
    await api("/games", { key, cf: MANCHESTER as unknown as IncomingRequestCfProperties });
    expect((await env.DB.prepare("SELECT COUNT(*) AS place_count FROM security_places").first<{ place_count: number }>())!.place_count).toBe(1);
    await deleteOldSecurityEvents(env, Date.now() + 91 * DAY_MS);
    const left = await eventsOf();
    expect(left.map((event) => event.kind)).not.toContain("signed_in_new_device");
    const upload = left.find((event) => event.kind === "version_uploaded");
    expect(upload).toMatchObject({ city_name: null, country_code: null, connection_address: null, network_name: null });
    expect((await env.DB.prepare("SELECT COUNT(*) AS place_count FROM security_places").first<{ place_count: number }>())!.place_count).toBe(0);
  });
});
