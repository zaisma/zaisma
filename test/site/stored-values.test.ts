import { env, SELF } from "cloudflare:test";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addTesterLink, blobKey, createAccount, createApiKey, createVersion, gameBySlug, newId, personOwner, sha256Hex } from "@zaisma/core";
import "../../apps/site/src/index.ts";
import { STORED_VALUES, type StoredValue, type StoredValueFormat } from "../../apps/site/src/stored-values.ts";
import { letPublish } from "../helpers.ts";

/**
 * Stored values safe where they show (docs/DECISIONS.md), at the doors and on the pages. Way in: every door an
 * entry in STORED_VALUES says saves it is sent a good value (which it keeps) and one outside its shape (which
 * it refuses, or tidies into shape). Way out: every entry is planted straight in the database with a hostile
 * value, as a door that skipped its check or a bug would leave it, and the pages anyone can reach are rendered:
 * no markup, CSS or live link may get through, and where each value shows must be exactly what its entry says.
 * test/node/stored-values.test.ts checks the list itself and the code.
 */

const SITE = "https://zaisma.test";
const LOCAL = "http://localhost";
const SUPABASE = "https://supabase.test";
const realFetch = globalThis.fetch;
let signingKeys: CryptoKeyPair;
let publicKey: JsonWebKey;
let token = "";
let nextNumber = 1;

const b64url = (given: ArrayBuffer | string) =>
  btoa(typeof given === "string" ? given : String.fromCharCode(...new Uint8Array(given)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** The session cookie of a signed-in account, as Supabase would sign it. */
async function sessionCookie(accountId: string): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "ES256", kid: "stored-values-key", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ sub: accountId, email: "", aud: "authenticated", iss: `${SUPABASE}/auth/v1`, exp: nowSec + 3600, iat: nowSec, amr: [{ method: "password", timestamp: nowSec }] }));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKeys.privateKey, new TextEncoder().encode(`${header}.${claims}`));
  return `__Host-zaisma=${header}.${claims}.${b64url(signature)}~r-${accountId}`;
}

async function api(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; answer: any }> {
  const response = await SELF.fetch(`${SITE}/api/dev${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  return { status: response.status, answer: await response.json() };
}

async function form(path: string, fields: Record<string, string | string[]>, cookie: string): Promise<Response> {
  const body = new URLSearchParams();
  for (const [name, given] of Object.entries(fields)) for (const each of [given].flat()) body.append(name, each);
  return SELF.fetch(`${SITE}${path}`, { method: "POST", body, headers: { cookie, origin: SITE }, redirect: "manual" });
}

// --- Shapes ---

const HIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u200b\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/;

/** Whether a stored value fits its shape, as the database holds it. */
function fitsFormat(format: StoredValueFormat, value: string): boolean {
  if (format === "hex_color") return /^#[0-9a-f]{6}$/.test(value);
  if (format === "web_address") return /^(https?|wss):\/\/[^\s"'<>]+$/.test(value);
  if (format === "pattern_name") return /^[A-Za-z0-9_.*-]+$/.test(value);
  if (format === "escaped_text") return true;
  return !HIDDEN.test(value);
}

/** A value just outside the shape, with a mark to find it by. */
function outsideShape(format: StoredValueFormat, mark: string): string {
  if (format === "hex_color") return `red;}</style><b>${mark}`;
  if (format === "web_address") return `javascript:alert('${mark}')`;
  if (format === "pattern_name") return `sv\u202e${mark}`;
  return `Sky ${mark}\u202eHopper`;
}

/** A value inside the shape, with a mark. */
function inShape(format: StoredValueFormat, mark: string): string {
  if (format === "hex_color") return `#${(nextNumber++ % 0xffffff).toString(16).padStart(6, "0")}`;
  if (format === "web_address") return `https://${mark}.example.com/`;
  if (format === "pattern_name") return mark;
  return `Sky ${mark} Hopper`;
}

/** Every value an entry names, from every row: a column, a field of its JSON object, or each item of its list. */
async function storedValuesOf(entry: StoredValue): Promise<string[]> {
  const [, table, column, isList, field] = entry.stored.match(/^([a-z_]+)\.([a-z_]+)(\[\])?(?:\.([a-z_]+))?$/)!;
  const { results } = await env.DB.prepare(`SELECT ${column} AS stored FROM ${table} WHERE ${column} IS NOT NULL AND ${column} != ''`).all<{ stored: string }>();
  return results.flatMap(({ stored }) => {
    if (!isList && !field) return [stored];
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      parsed = stored.split("\n");
    }
    const items = isList ? (parsed as unknown[]) : [parsed];
    return items.map((item) => (field ? (item as Record<string, unknown>)?.[field] : item)).filter((item): item is string => typeof item === "string");
  });
}

// --- The world ---

const DEVELOPER = "sv-dev";
const NEWCOMER = "sv-new";
let cookie = "";
let gameSlug = "";
let liveSlug = "";
let topicId = "";
let testerId = "";
let signInAppId = "";
let webhookId = "";
let storedFile = { sha256: "", sizeBytes: 0 };

beforeAll(async () => {
  signingKeys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  publicKey = (await crypto.subtle.exportKey("jwk", signingKeys.publicKey)) as JsonWebKey;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.href === `${SUPABASE}/auth/v1/.well-known/jwks.json`) return Response.json({ keys: [{ ...publicKey, kid: "stored-values-key", alg: "ES256" }] });
    if (url.href === `${SUPABASE}/auth/v1/settings`) return Response.json({ external: { google: true, discord: true } });
    if (url.origin === "https://challenges.cloudflare.com") return Response.json({ success: true, action: "join", hostname: "zaisma.test" });
    if (url.origin === "https://dns.zaisma.test") return Response.json({ Status: 0, Answer: [{ name: url.searchParams.get("name"), type: 1, TTL: 300, data: "93.184.216.34" }] });
    return realFetch(input, init);
  });
  await createAccount(env.DB, { id: DEVELOPER, username: "Sv_Dev", ageBand: "18+" });
  await letPublish(env.DB, DEVELOPER);
  cookie = await sessionCookie(DEVELOPER);
  token = (await createApiKey(env.DB, DEVELOPER, "stored values")).token;
  gameSlug = (await api("/games", { body: { title: "Stored Values", slug: "sv-game" } })).answer.game.slug;
  // A game players can see, so a new title waits for review in details_waiting_for_review.
  liveSlug = (await api("/games", { body: { title: "Stored Live", slug: "sv-live" } })).answer.game.slug;
  const live = (await gameBySlug(env.DB, liveSlug))!;
  const liveVersionId = newId("version");
  await createVersion(env.DB, { id: liveVersionId, gameId: live.id, r2Prefix: "games/sv/live", fileCount: 1, sizeBytes: 1 });
  await env.DB.prepare("UPDATE versions SET scan_status = 'approved', published_at_ms = ? WHERE id = ?").bind(Date.now(), liveVersionId).run();
  await env.DB.prepare("UPDATE games SET review_status = 'live', visibility = 'listed', live_version_id = ? WHERE id = ?").bind(liveVersionId, live.id).run();
  // A file the developer has sent, for new versions.
  const bytes = new TextEncoder().encode("<!doctype html><p>stored values</p>");
  storedFile = { sha256: await sha256Hex(bytes), sizeBytes: bytes.byteLength };
  const owner = await personOwner(env.DB, DEVELOPER);
  await env.GAMES.put(blobKey(storedFile.sha256), bytes);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO blobs (sha256, size_bytes, created_at_ms) VALUES (?, ?, ?)").bind(storedFile.sha256, storedFile.sizeBytes, Date.now()),
    env.DB.prepare("INSERT INTO blob_owners (owner_id, sha256, created_at_ms) VALUES (?, ?, ?)").bind(owner.id, storedFile.sha256, Date.now()),
  ]);
  topicId = (await api("/forum", { body: { is_public: true, kind: "question", category: "pages", title: "Stored values?", text_markdown: "Where do they show?", author_kind: "developer" } })).answer.topic.id;
  testerId = (await api(`/games/${gameSlug}/testers`, { body: { name: "Playtesters" } })).answer.tester.id;
  signInAppId = (await api("/sign-in-apps", { body: { name: "Stored Online", kind: "public", redirect_urls: ["https://stored.example.test/back"] } })).answer.sign_in_app.id;
  webhookId = (await api("/webhooks", { body: { endpoint_url: "https://hooks.example.test/stored", event_kinds: ["bug_reported"] } })).answer.webhook.id;
});

afterAll(() => vi.unstubAllGlobals());

// --- Way in ---

type Door = (value: string, mark: string) => Promise<unknown>;

const usernameOf = async (accountId: string) => (await env.DB.prepare("SELECT username FROM accounts WHERE id = ?").bind(accountId).first<{ username: string }>())!.username;


const detailsByApi = (field: string, wrap: (value: string) => unknown = (value) => value): Record<string, Door> => ({
  "api:POST /games": (value, mark) => api("/games", { body: { title: field === "title" ? value : `Game ${mark}`, slug: `sv-${mark}`, ...(field === "title" ? {} : { [field]: wrap(value) }) } }),
  "api:PATCH /games/:slug": (value) => api(`/games/${gameSlug}`, { method: "PATCH", body: { [field]: wrap(value) } }),
});
/** A whole item that's only granted, for set_item, with its title and description. */
const ITEM = (title: string, description: string) => ({ title, description, item_kind: "permanent", item_category: "cosmetic", price_minor_units: null, currency_code: null, local_prices: [] });
const LINK = (value: string, part: "link_name" | "destination_url") => [{ link_name: part === "link_name" ? value : "store", destination_url: part === "destination_url" ? value : "https://store.example.com/", is_on_game_page: true }];

/** How each door saves each value, keyed "<stored> <door id>". */
const DOORS: Record<string, Door> = {
  ...Object.fromEntries(Object.entries(detailsByApi("title")).map(([door, save]) => [`games.title ${door}`, save])),
  "games.title page:POST /dashboard/new": (value) => form("/dashboard/new", { title: value }, cookie),
  "games.slug api:POST /games": (value, mark) => api("/games", { body: { title: `Game ${mark}`, slug: value } }),
  // The page makes the slug from the title.
  "games.slug page:POST /dashboard/new": (value) => form("/dashboard/new", { title: value }, cookie),
  ...Object.fromEntries(Object.entries(detailsByApi("description")).map(([door, save]) => [`games.description ${door}`, save])),
  "games.details_waiting_for_review.title api:PATCH /games/:slug": (value) => api(`/games/${liveSlug}`, { method: "PATCH", body: { title: value } }),
  "games.details_waiting_for_review.description api:PATCH /games/:slug": (value) => api(`/games/${liveSlug}`, { method: "PATCH", body: { description: value } }),
  ...Object.fromEntries(Object.entries(detailsByApi("glass_tint_color")).map(([door, save]) => [`games.glass_tint_color ${door}`, save])),
  "games.glass_tint_color page:/dashboard/([a-z0-9-]+)(/.*)?": (value) => form(`/dashboard/${gameSlug}/glass-tint`, { glass_tint_color: value }, cookie),
  ...Object.fromEntries(Object.entries(detailsByApi("links", (value) => LINK(value, "link_name"))).map(([door, save]) => [`games.links[].link_name ${door}`, save])),
  "games.links[].link_name page:/dashboard/([a-z0-9-]+)(/.*)?": (value) => form(`/dashboard/${gameSlug}/links`, { link_name_0: value, destination_url_0: "https://store.example.com/" }, cookie),
  ...Object.fromEntries(Object.entries(detailsByApi("links", (value) => LINK(value, "destination_url"))).map(([door, save]) => [`games.links[].destination_url ${door}`, save])),
  "games.links[].destination_url page:/dashboard/([a-z0-9-]+)(/.*)?": (value) => form(`/dashboard/${gameSlug}/links`, { link_name_0: "store", destination_url_0: value }, cookie),
  ...Object.fromEntries(Object.entries(detailsByApi("own_server_urls", (value) => [value.replace(/^https:/, "wss:")])).map(([door, save]) => [`games.own_server_urls[] ${door}`, save])),
  "games.own_server_urls[] page:/dashboard/([a-z0-9-]+)(/.*)?": (value) => form(`/dashboard/${gameSlug}/own-servers`, { own_server_url_0: value.replace(/^https:/, "wss:") }, cookie),
  ...Object.fromEntries(Object.entries(detailsByApi("game_server_allowed_hosts", (value) => [`${value}.example.com`])).map(([door, save]) => [`games.game_server_allowed_hosts[] ${door}`, save])),
  "game_items.item_name api:PUT /games/:slug/items/:item_name": (value) => api(`/games/${gameSlug}/items/${encodeURIComponent(value)}`, { method: "PUT", body: ITEM("Cape", "") }),
  "game_items.title api:PUT /games/:slug/items/:item_name": (value, mark) => api(`/games/${gameSlug}/items/item-${mark}`, { method: "PUT", body: ITEM(value, "") }),
  "game_items.description api:PUT /games/:slug/items/:item_name": (value, mark) => api(`/games/${gameSlug}/items/item-${mark}`, { method: "PUT", body: ITEM("Cape", value) }),
  "games.refund_policy_text api:PATCH /games/:slug/purchase-settings": (value) => api(`/games/${gameSlug}/purchase-settings`, { method: "PATCH", body: { refund_policy: "own_words", refund_policy_text: value } }),
  "versions.patch_notes api:POST /games/:slug/versions": (value) => api(`/games/${gameSlug}/versions`, { body: { files: [{ path: "index.html", sha256: storedFile.sha256, size_bytes: storedFile.sizeBytes }], patch_notes: value } }),
  "tester_links.name api:POST /games/:slug/testers": (value) => api(`/games/${gameSlug}/testers`, { body: { name: value } }),
  "tester_links.name api:PATCH /games/:slug/testers/:tester_id": (value) => api(`/games/${gameSlug}/testers/${testerId}`, { method: "PATCH", body: { name: value } }),
  "sign_in_apps.name api:POST /sign-in-apps": (value) => api("/sign-in-apps", { body: { name: value, kind: "public", redirect_urls: ["https://stored.example.test/back"] } }),
  "sign_in_apps.name api:PATCH /sign-in-apps/:sign_in_app_id": (value) => api(`/sign-in-apps/${signInAppId}`, { method: "PATCH", body: { name: value } }),
  "sign_in_apps.redirect_urls[] api:POST /sign-in-apps": (value, mark) => api("/sign-in-apps", { body: { name: `App ${mark}`, kind: "public", redirect_urls: [value] } }),
  "sign_in_apps.redirect_urls[] api:PATCH /sign-in-apps/:sign_in_app_id": (value) => api(`/sign-in-apps/${signInAppId}`, { method: "PATCH", body: { redirect_urls: [value] } }),
  "webhooks.endpoint_url api:POST /webhooks": (value) => api("/webhooks", { body: { endpoint_url: value, event_kinds: ["bug_reported"] } }),
  "webhooks.endpoint_url api:PATCH /webhooks/:webhook_id": (value) => api(`/webhooks/${webhookId}`, { method: "PATCH", body: { endpoint_url: value } }),
  "accounts.username page:POST /join/username": async (value) =>
    form("/join/username", { username: value, turnstile_token: "browser" }, `${await sessionCookie(`${NEWCOMER}-${nextNumber++}`)}; __Host-zaisma_join=${encodeURIComponent(JSON.stringify({ band: "18+" }))}`),
  "accounts.username page:POST /account/username": (value) => form("/account/username", { username: value }, cookie),
  "accounts.display_name page:/@([A-Za-z0-9_]{1,40})(/edit|/report)?": async (value) => form(`/@${await usernameOf(DEVELOPER)}/edit`, { display_name: value, bio: "" }, cookie),
  "accounts.bio page:/@([A-Za-z0-9_]{1,40})(/edit|/report)?": async (value) => form(`/@${await usernameOf(DEVELOPER)}/edit`, { display_name: "", bio: value }, cookie),
  "accounts.link_urls[] page:/@([A-Za-z0-9_]{1,40})(/edit|/report)?": async (value) => form(`/@${await usernameOf(DEVELOPER)}/edit`, { display_name: "", bio: "", link_url: value }, cookie),
  "forum_topics.title api:POST /forum": (value) => api("/forum", { body: { is_public: true, kind: "question", category: "pages", title: value, text_markdown: "Where do they show?", author_kind: "developer" } }),
  "forum_topics.title page:GET /forum/new": (value) => form("/forum/new", { kind: "question", category: "pages", title: value, text_markdown: "Where do they show?" }, cookie),
  "forum_topics.title page:/forum/messages/new": (value) => form("/forum/messages/new", { kind: "question", title: value, text_markdown: "Where do they show?" }, cookie),
  "forum_posts.text_markdown api:POST /forum": (value, mark) => api("/forum", { body: { is_public: true, kind: "question", category: "pages", title: `Question ${mark}`, text_markdown: value, author_kind: "developer" } }),
  "forum_posts.text_markdown api:POST /forum/:topic_id/posts": (value) => api(`/forum/${topicId}/posts`, { body: { text_markdown: value, author_kind: "developer" } }),
  "forum_posts.text_markdown page:GET /forum/new": (value, mark) => form("/forum/new", { kind: "question", category: "pages", title: `Question ${mark}`, text_markdown: value }, cookie),
  "forum_posts.text_markdown page:/forum/(topic_[a-z0-9]{1,40})(?:/(reply|vote|follow|answer|misplaced|still-happening|rate|bookmark|report))?": (value) => form(`/forum/${topicId}/reply`, { text_markdown: value }, cookie),
  "forum_posts.text_markdown page:/forum/messages/new": (value, mark) => form("/forum/messages/new", { kind: "question", title: `Message ${mark}`, text_markdown: value }, cookie),
};

const checkedAtTheDoor = STORED_VALUES.filter((entry) => entry.format !== "escaped_text" && (entry.source === "developer" || entry.source === "player"));

describe("the way in", () => {
  it("has a way to try every door that saves a value Zaisma checks", () => {
    const pairs = checkedAtTheDoor.flatMap((entry) => entry.saved_by_door_ids.map((doorId) => `${entry.stored} ${doorId}`));
    expect(pairs.filter((pair) => !DOORS[pair]), "Add how the test saves it through that door to DOORS").toEqual([]);
    expect(Object.keys(DOORS).filter((pair) => !pairs.includes(pair)), "A door in DOORS that the entry doesn't list").toEqual([]);
  });

  for (const entry of checkedAtTheDoor) {
    for (const doorId of entry.saved_by_door_ids) {
      it(`${entry.stored} through ${doorId}: keeps a value in shape, and never one outside it`, async () => {
        const save = DOORS[`${entry.stored} ${doorId}`];
        if (!save) return;
        const goodMark = `svok${nextNumber++}`;
        const good = inShape(entry.format, goodMark);
        await save(good, goodMark);
        expect(await storedValuesOf(entry), `the door didn't keep ${good}`).toContain(entry.format === "hex_color" ? good : entry.stored.startsWith("games.own_server_urls") ? good.replace(/^https:\/\/(.*)\/$/, "wss://$1") : entry.stored.startsWith("games.game_server_allowed_hosts") ? `${good}.example.com` : good);
        const badMark = `svbad${nextNumber++}`;
        await save(outsideShape(entry.format, badMark), badMark);
        expect((await storedValuesOf(entry)).filter((stored) => !fitsFormat(entry.format, stored))).toEqual([]);
      });
    }
  }
});

// --- Way out ---

/** The mark a planted value carries, to find where it shows: zsv<entry index>z. */
const markOf = (entryIndex: number) => `zsv${entryIndex}z`;

/** A hostile value for an entry, as a door that skipped its check would leave it. */
function planted(entryIndex: number): string | null {
  const mark = markOf(entryIndex);
  const { format, stored } = STORED_VALUES[entryIndex]!;
  // A game's slug and an account's username are what Zaisma finds them by; they're planted only in shape (plantedInShape).
  if (stored === "games.slug" || stored === "accounts.username") return null;
  if (format === "hex_color") return `red;}</style><b class=zsv-breakout>${mark}`;
  if (format === "web_address") return `javascript:alert('${mark}')`;
  return `${mark} "'><b class=zsv-breakout>x</b>\u202e</style></script>`;
}

/** A value in shape that still says which entry it is, for the shapes a mark can't hide in as text: a color, an address, a name. */
function plantedInShape(entryIndex: number): string | null {
  const { format, stored } = STORED_VALUES[entryIndex]!;
  if (format === "hex_color") return `#0e5${entryIndex.toString(16).padStart(3, "0")}`;
  if (format === "web_address") return stored.startsWith("games.own_server_urls") ? `wss://${markOf(entryIndex)}.example.com` : `https://${markOf(entryIndex)}.example.com/`;
  if (format === "pattern_name") return stored.endsWith("allowed_hosts[]") ? `${markOf(entryIndex)}.example.com` : markOf(entryIndex);
  return null;
}

/** Columns that hold JSON, built around the hostile values so the pages that read them still can. field "" is the whole column's entry. */
const JSON_COLUMNS: Record<string, (hostile: (field: string) => string) => unknown> = {
  "games.links": (hostile) => [{ link_name: hostile("link_name"), destination_url: hostile("destination_url"), is_on_game_page: true, review_reason: null, checked_at_ms: null }],
  "games.country_blocks": (hostile) => [{ country_code: "GB", review_reason: { code: "needs_review", message: hostile("review_reason"), content_rule: null }, blocked_at_ms: 1 }],
  "games.details_waiting_for_review": (hostile) => ({ title: hostile("title"), description: hostile("description") }),
  "games.own_server_urls": (hostile) => [hostile("")],
  "games.game_server_allowed_hosts": (hostile) => [hostile("")],
  "sign_in_apps.redirect_urls": (hostile) => [hostile("")],
  "mcp_clients.redirect_urls": (hostile) => [hostile("")],
  "live_rooms.labels": (hostile) => ({ mode: hostile("") }),
  "chat_reviews.recent_texts_json": (hostile) => [hostile("")],
  "forum_posts.debug_context": (hostile) => ({ error_text: hostile("") }),
  // A review reason: its code is one of Zaisma's, its message the stored words.
  ...Object.fromEntries(["games.review_reason", "games.title_listing_reason", "versions.review_reason", "game_images.review_reason", "game_images.listing_reason", "game_shaders.review_reason", "audit_log.review_reason"].map((column) => [column, (hostile: (field: string) => string) => ({ code: "needs_review", message: hostile(""), content_rule: null })])),
  "versions.scan_report": (hostile) => ({ finished_at_ms: 1, decision: "held", findings: [{ stage: "static", severity: "hold", code: "remote_script", message: hostile(""), path: hostile("") }], outside_hosts: [hostile("")], images: { provider: hostile(""), is_connected: true, checked_media_count: 0 }, ai: null }),
  "performance_checks.report": (hostile) => ({ browser_description: hostile(""), loading_duration_sec: 1, start_download_size_bytes: 1, start_file_count: 1, start_memory_size_bytes: 1, longest_start_task_duration_ms: 1, notes: [], start_files: [] }),
  "performance_checks.start_files": (hostile) => [{ path: hostile(""), downloaded_size_bytes: 1, is_cors_request: false }],
  "reports.triage": (hostile) => ({ is_by_ai: true, category: "bug", summary: hostile(""), recommendation: "person", why: hostile(""), ai_actions: [hostile("")] }),
  "forum_topics.triage": (hostile) => ({ is_by_ai: true, summary: hostile(""), why: hostile(""), merged_into_topic_id: null, same_as_topic_id: null, known_issue_draft: null }),
};

/** Fill a row's required columns that weren't given: IDs from the world, times now, text "x". */
async function insertRow(table: string, given: Record<string, unknown>): Promise<void> {
  const { results } = await env.DB.prepare(`SELECT name, type, "notnull" AS is_required, dflt_value AS default_value, pk AS key_index FROM pragma_table_info('${table}')`).all<{ name: string; type: string; is_required: number; default_value: string | null; key_index: number }>();
  // A column with a CHECK takes its first choice.
  const tableSql = (await env.DB.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").bind(table).first<{ sql: string }>())!.sql;
  const choices = Object.fromEntries([...tableSql.matchAll(/(\w+)[^,(]*CHECK \(\1 IN \('([^']*)'/g)].map((found) => [found[1], found[2]]));
  const row: Record<string, unknown> = { ...choices, ...given };
  for (const column of results) {
    if (column.name in row || (!column.is_required && !column.key_index) || column.default_value !== null) continue;
    row[column.name] = column.name in world ? world[column.name] : /INT|REAL|NUM/i.test(column.type) ? Date.now() : column.name === "id" || column.name.endsWith("_sha256") ? `${table}_${crypto.randomUUID().replace(/-/g, "")}` : "x";
  }
  const names = Object.keys(row);
  await env.DB.prepare(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`).bind(...names.map((name) => row[name])).run();
}

/** What a new row of these tables needs besides its CHECKs' first choices. */
const ROW_CHOICES: Record<string, Record<string, unknown>> = {
  // The live game's cover, so the home lists it.
  game_images: { content_type: "image/png", kind: "cover", review_status: "approved", width_px: 1200, height_px: 1600 },
  // Zaisma's news, current, so the home shows it.
  announcements: { starts_at_ms: 0, ends_at_ms: 9_999_999_999_999 },
};

/** IDs of the world's own rows, by the column names that point at them. */
const world: Record<string, unknown> = {};

/** The pages that show stored values, as the security map's door ids, with how to open each. */
async function pagesToOpen(): Promise<{ doorId: string; url: string; cookie?: string }[]> {
  const live = (await gameBySlug(env.DB, liveSlug))!;
  const game = (await gameBySlug(env.DB, gameSlug))!;
  const tester = await env.DB.prepare("SELECT token FROM tester_links LIMIT 1").first<{ token: string }>();
  const authorize = (clientId: string, redirect: string) => `/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirect, scope: "openid mcp", code_challenge: "x".repeat(43), code_challenge_method: "S256", state: "s" })}`;
  return [
    { doorId: "page:GET /", url: `${SITE}/` },
    ...["", "/rooms", "/report"].map((sub) => ({ doorId: "page:/g/([a-z0-9-]+)(/report|/rooms|/qr-code\\.svg|/live-version)?", url: `${SITE}/g/${liveSlug}${sub}` })),
    { doorId: "page:/t/([a-z0-9]{20})(/enter)?", url: `${SITE}/t/${tester!.token}` },
    { doorId: "page:/@([A-Za-z0-9_]{1,40})(/edit|/report)?", url: `${SITE}/@${await usernameOf(DEVELOPER)}` },
    { doorId: "page:/@([A-Za-z0-9_]{1,40})(/edit|/report)?", url: `${SITE}/@${await usernameOf(DEVELOPER)}?edit`, cookie },
    { doorId: "page:/forum", url: `${SITE}/forum` },
    { doorId: "page:/forum", url: `${SITE}/forum?search_text=Sky`, cookie },
    { doorId: "page:/forum/(topic_[a-z0-9]{1,40})(?:/(reply|vote|follow|answer|misplaced|still-happening|rate|bookmark|report))?", url: `${SITE}/forum/${topicId}`, cookie },
    { doorId: "page:/forum/messages", url: `${SITE}/forum/messages`, cookie },
    { doorId: "page:GET /forum/people", url: `${SITE}/forum/people` },
    { doorId: "page:/dashboard/feedback", url: `${SITE}/dashboard/feedback`, cookie },
    { doorId: "page:GET /dashboard", url: `${SITE}/dashboard`, cookie },
    ...[gameSlug, liveSlug].flatMap((slug) => ["", "/versions", "/details", "/players", "/database"].map((sub) => ({ doorId: "page:/dashboard/([a-z0-9-]+)(/.*)?", url: `${SITE}/dashboard/${slug}${sub}`, cookie }))),
    { doorId: "page:GET /account", url: `${SITE}/account`, cookie },
    { doorId: "page:/dashboard/settings", url: `${SITE}/dashboard/settings`, cookie },
    { doorId: "page:GET /friends", url: `${SITE}/friends`, cookie },
    { doorId: "page:/oauth/authorize", url: `${SITE}${authorize(signInAppId, "https://stored.example.test/back")}`, cookie },
    { doorId: "page:/oauth/authorize", url: `${SITE}${authorize(String(world.mcp_client_id), "https://claude.ai/api/mcp/auth_callback")}`, cookie },
    ...["", "/reports", "/profiles", "/chat-reviews", "/publishing", "/precedents", "/review-precedents", "/feedback", "/audit"].map((sub) => ({ doorId: `page:/admin${sub}`, url: `${LOCAL}/admin${sub}` })),
    ...[game.id, live.id].map((id) => ({ doorId: "page:/admin/games/([a-z0-9_]+)", url: `${LOCAL}/admin/games/${id}` })),
  ];
}

/** What's wrong with a page that shows hostile stored values: anything that acts instead of showing as text. */
function pageProblems(page: string): string[] {
  const problems: string[] = [];
  if (/<b class=zsv-breakout/i.test(page)) problems.push(`markup got through: ${page.slice(Math.max(0, page.search(/<b class=zsv-breakout/i) - 120), page.search(/<b class=zsv-breakout/i) + 40)}`);
  if (/[\u202a-\u202e\u2066-\u2069]/.test(page)) problems.push("a direction control got through");
  for (const found of page.matchAll(/\sstyle="[^"]*"|<style[^>]*>[\s\S]*?<\/style>/gi)) if (/zsv\d+z|zsv-breakout/.test(found[0])) problems.push(`a stored value in CSS: ${found[0].slice(0, 160)}`);
  // Pictures the server drew (a QR code) are data: images; nothing else may be anything but a web address.
  for (const found of page.matchAll(/\s(href|src|action|formaction|poster|srcset|data-out)="\s*(javascript:|vbscript:|data:(?!image\/))[^"]*"/gi)) problems.push(`a live ${found[2]} address: ${found[0].slice(0, 160)}`);
  return problems;
}

/** Rows a column is left alone in: the slug and username the pages are opened by, and the live game's listing, so the home still lists it. */
const KEEP: Record<string, () => string> = {
  "games.slug": () => ` WHERE slug NOT IN ('${gameSlug}', '${liveSlug}')`,
  "accounts.username": () => ` WHERE id != '${DEVELOPER}'`,
  "games.title_listing_reason": () => ` WHERE slug != '${liveSlug}'`,
  "games.review_reason": () => ` WHERE slug != '${liveSlug}'`,
  "game_images.listing_reason": () => ` WHERE game_id != '${world.game_id}'`,
  "game_images.review_reason": () => ` WHERE game_id != '${world.game_id}'`,
};

/** Put a value from valueOf in every stored value's column, in every row but KEEP's; null leaves it. */
async function plant(valueOf: (entryIndex: number) => string | null): Promise<void> {
  const columns = new Map<string, number[]>();
  STORED_VALUES.forEach((entry, entryIndex) => {
    const column = entry.stored.split(/[.[]/).slice(0, 2).join(".");
    columns.set(column, [...(columns.get(column) ?? []), entryIndex]);
  });
  for (const [column, entryIndexes] of columns) {
    const [table, name] = column.split(".") as [string, string];
    const entryFor = (field: string) => entryIndexes.find((entryIndex) => STORED_VALUES[entryIndex]!.stored.replace(/\[\]/, "").split(".")[2] === (field || undefined)) ?? entryIndexes[0]!;
    const values = new Map(entryIndexes.map((entryIndex) => [entryIndex, valueOf(entryIndex)]));
    if ([...values.values()].every((value) => value === null)) continue;
    const hostile = (field: string) => values.get(entryFor(field)) ?? planted(entryFor(field)) ?? "";
    const value = JSON_COLUMNS[column] ? JSON.stringify(JSON_COLUMNS[column](hostile)) : hostile("");
    const keep = KEEP[column]?.() ?? "";
    try {
      await env.DB.prepare(`UPDATE ${table} SET ${name} = ?${keep}`).bind(value).run();
    } catch {
      // A unique column (a slug, a username) takes the value with each row's own ending.
      await env.DB.prepare(`UPDATE ${table} SET ${name} = ? || '-' || rowid${keep}`).bind(value).run();
    }
  }
}

/** Open every page, adding where each entry's mark shows to shownOn; answers what's wrong. */
async function openPages(shownOn: Map<number, Set<string>>, entryIndexes: Set<number>): Promise<string[]> {
  const problems: string[] = [];
  for (const { doorId, url, cookie: withCookie } of await pagesToOpen()) {
    let response: Response;
    try {
      response = await SELF.fetch(url, { headers: withCookie ? { cookie: withCookie } : {}, redirect: "manual" });
    } catch (error) {
      problems.push(`${url}: ${(error as Error).message}`);
      continue;
    }
    const page = await response.text();
    if (response.status >= 500) problems.push(`${url}: ${response.status}`);
    problems.push(...pageProblems(page).map((problem) => `${url}: ${problem}`));
    const found = [...page.matchAll(/zsv(\d+)z/g)].map((match) => Number(match[1])).concat([...page.matchAll(/#0e5([0-9a-f]{3})\b/gi)].map((match) => parseInt(match[1]!, 16)));
    for (const entryIndex of found) if (entryIndexes.has(entryIndex)) shownOn.set(entryIndex, (shownOn.get(entryIndex) ?? new Set()).add(doorId));
  }
  return problems;
}

describe("the way out", () => {
  const shownOn = new Map<number, Set<string>>();
  const allEntries = new Set(STORED_VALUES.keys());

  beforeAll(async () => {
    const live = (await gameBySlug(env.DB, liveSlug))!;
    const owner = await personOwner(env.DB, DEVELOPER);
    const post = await env.DB.prepare("SELECT id FROM forum_posts WHERE topic_id = ? LIMIT 1").bind(topicId).first<{ id: string }>();
    Object.assign(world, { game_id: live.id, account_id: DEVELOPER, owner_id: owner.id, version_id: live.live_version_id, topic_id: topicId, post_id: post!.id, webhook_id: webhookId, sign_in_app_id: signInAppId, reporter_account_id: DEVELOPER, sender_account_id: DEVELOPER, player_id: (await env.DB.prepare("SELECT player_id FROM accounts WHERE id = ?").bind(DEVELOPER).first<{ player_id: string }>())!.player_id });
    world.mcp_client_id = newId("mcp_client");
    await insertRow("mcp_clients", { id: world.mcp_client_id, client_name: "x", redirect_urls: JSON.stringify(["https://claude.ai/api/mcp/auth_callback"]), registration_kind: "registration", token_endpoint_auth_method: "none" });
    world.api_key_id = (await env.DB.prepare("SELECT id FROM api_keys WHERE account_id = ? LIMIT 1").bind(DEVELOPER).first<{ id: string }>())!.id;
    // A row for each stored value's table that the world doesn't have yet.
    for (const table of new Set(STORED_VALUES.map((entry) => entry.stored.split(".")[0]!))) {
      if (await env.DB.prepare(`SELECT 1 FROM ${table} LIMIT 1`).first()) continue;
      await insertRow(table, ROW_CHOICES[table] ?? {});
    }
    await plant(planted);
  });

  it("shows every hostile value only as text, on every page", async () => {
    expect(await openPages(shownOn, new Set([...allEntries].filter((entryIndex) => plantedInShape(entryIndex) === null)))).toEqual([]);
  });

  it("shows colors, addresses and names in shape where they belong", async () => {
    await plant(plantedInShape);
    expect(await openPages(shownOn, new Set([...allEntries].filter((entryIndex) => plantedInShape(entryIndex) !== null)))).toEqual([]);
  });

  it("shows each value on exactly the pages its entry lists", () => {
    const wrong = STORED_VALUES.flatMap((entry, entryIndex) => {
      const found = [...(shownOn.get(entryIndex) ?? [])].sort();
      return JSON.stringify(found) === JSON.stringify([...entry.shown_on_door_ids].sort()) ? [] : [`${entry.stored}: shows on ${JSON.stringify(found)}`];
    });
    expect(wrong, "Change the entry's shown_on_door_ids to where it shows").toEqual([]);
  });
});
