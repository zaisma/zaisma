import { createExecutionContext, env } from "cloudflare:test";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_AREAS,
  AREA_ACCESS_BY_LEVEL,
  AREA_ACCESS_CHOICES,
  accountById,
  addCreditEntry,
  addDatabaseRestore,
  addImage,
  addTesterLink,
  allows,
  bumpSave,
  canonicalSave,
  createAccount,
  createApiKey,
  createGame,
  createSignInApp,
  createVersion,
  createWebhook,
  forumMediaKey,
  imageKey,
  addShader,
  settleShader,
  shaderKey,
  manifestKey,
  newId,
  ownedBlobKey,
  personOwner,
  saveCopyKey,
  saveFromParts,
  saveHash,
  saveKey,
  sha256Hex,
  type AccessArea,
  type AreaAccess,
  type KeyScope,
} from "@zaisma/core";
import { API_ROUTES, type ApiInput, type ApiRoute } from "../../apps/site/src/developer.ts";
import { errorProblems } from "../schema-check.ts";
import { letPublish } from "../helpers.ts";

// A shader check that goes through draws in a stand-in that answers a clean drawing at once: what this file checks is who gets
// through, and the real drawing (headless Chromium, whose start alone takes seconds on a busy runner) is test/site/shader-check.test.ts's.
const drawings = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../apps/site/src/shader-check.ts", async (original) => {
  const { SHADER_LIMITS } = await import("@zaisma/core");
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const frames = (value: number) => Array.from({ length: SHADER_LIMITS.checkFrameCount }, () => value);
  const render = async () => {
    drawings.count++;
    return {
      compileError: null,
      referenceFrameTimesMs: Array.from({ length: 30 }, () => SHADER_LIMITS.referenceFrameMs),
      levels: [{ qualityLevel: 0, frameTimesMs: frames(20), frameLuminances: frames(0.4) }],
      stillPng: PNG,
      smallStillPng: PNG,
      framePngs: Array.from({ length: SHADER_LIMITS.sampledFrameCount }, () => PNG),
      shimmerPngs: [],
      sheetPng: null,
    };
  };
  return { ...(await original<typeof import("../../apps/site/src/shader-check.ts")>()), shaderCheckDeps: () => ({ render }) };
});
// The site as loaded again with the stand-in: SELF's copy was loaded before this file's stand-ins.
vi.resetModules();
const worker = (await import("../../apps/site/src/index.ts")).default;

/**
 * Access checks in the router (docs/DECISIONS.md, "Access checks in the router"). Every call in
 * API_ROUTES, built from its own declarations:
 *
 * - as a stranger (another developer's full key) on the developer's things, and naming them in each input
 *   that names something, and naming them from inside the stranger's own game or topic,
 * - with each key level below what the call needs,
 * - with a key limited to the developer's other game,
 * - and with each input that needs more than the call.
 *
 * Each must be refused, a stranger exactly as if nothing were there, with nothing changed: the database,
 * both buckets and the game's own database and secrets. Then the same call by the developer with a full
 * key must go through, so each refusal was the router's, not a bad example. A call, path part or input
 * without its declarations, or without an example here, fails.
 */

const SITE = "https://zaisma.test";
const HOOKS_HOST = "hooks.example.test";

/** One call to make: values for its path parts, and its query and body (JSON, or bytes). */
interface Sample {
  pathValues?: Record<string, string>;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  bytes?: Uint8Array;
}

/** One developer's things, and a stranger's, made fresh for each call so no test sees another's. */
interface World {
  n: number;
  victimAccountId: string;
  victimOwnerId: string;
  strangerAccountId: string;
  /** The developer's things, by path part: what the stranger tries to reach. */
  values: Record<string, string>;
  /** The stranger's own game, topic, webhook and sign-in app, to name the developer's things from. */
  strangerValues: Record<string, string>;
  otherSlug: string;
  /** A helper's public known issue (released) and their checked post, which the developer can vote on, flag, mark and report. */
  publicTopicId: string;
  publicPostId: string;
  /** A file anyone could use (shared), one kept for the developer alone, and one nobody sent yet. */
  storedFile: { sha256: string; sizeBytes: number };
  ownedSha256: string;
  newFile: { sha256: string; bytes: Uint8Array };
  /** A big file the developer started sending in parts, with part 1 sent. */
  uploadId: string;
  partEtag: string;
  bigSha256: string;
}

/** A PNG's first bytes, which is all the image checks read: 400 by 300 for the forum, 1280 by 720 for a cover. */
const png = (widthPx: number, heightPx: number) => {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, widthPx);
  new DataView(bytes.buffer).setUint32(20, heightPx);
  return bytes;
};
const text = (given: string) => new TextEncoder().encode(given);

/**
 * A call each route takes from the developer, as it goes through with a full key. The stranger and the
 * weaker keys send the same, so a refusal can only be the router's.
 */
const SAMPLES: Record<string, (world: World) => Sample> = {
  "GET /access": () => ({}),
  "GET /activity": () => ({}),
  "GET /api-keys": () => ({}),
  "GET /games": () => ({}),
  "POST /games": (world) => ({ body: { title: "Moon Base", slug: `made-${world.n}` } }),
  "GET /games/:slug": () => ({}),
  "PATCH /games/:slug": () => ({ body: { description: "Hop higher." } }),
  "POST /games/:slug/images": () => ({ query: { kind: "cover" }, bytes: png(1280, 720) }),
  "DELETE /games/:slug/images/:image_id": () => ({}),
  "POST /games/:slug/shaders": () => ({ body: { screen: "wide", image: { source: "void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(1.0); }" } } }),
  "POST /games/:slug/shader-checks": () => ({ body: { screen: "wide", image: { source: "void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(1.0); }" } } }),
  "DELETE /games/:slug/shaders/:shader_id": () => ({}),
  "PUT /games/:slug/backgrounds/:screen": (world) => ({ body: { source: "shader", shader_id: world.values.shader_id } }),
  "POST /check": (world) => ({ body: { files: [{ path: "index.html", size_bytes: 15, content_text: "<!doctype html>" }], slug: world.values.slug } }),
  "POST /games/:slug/uploads": (world) => ({ body: { files: [{ path: "index.html", sha256: world.storedFile.sha256, size_bytes: world.storedFile.sizeBytes }] } }),
  "PUT /files/:sha256": (world) => ({ pathValues: { sha256: world.newFile.sha256 }, bytes: world.newFile.bytes }),
  "POST /files/:sha256/parts": (world) => ({ pathValues: { sha256: world.newFile.sha256 }, body: { size_bytes: world.newFile.bytes.byteLength } }),
  "PUT /files/:sha256/parts/:part_number": (world) => ({ pathValues: { sha256: world.bigSha256, part_number: "1" }, query: { upload_id: world.uploadId }, bytes: text("<!doctype html><p>part one</p>") }),
  "POST /files/:sha256/parts/done": (world) => ({ pathValues: { sha256: world.bigSha256 }, body: { upload_id: world.uploadId, parts: [{ part_number: 1, etag: world.partEtag }] } }),
  "POST /games/:slug/versions": (world) => ({ body: { files: [{ path: "index.html", sha256: world.storedFile.sha256, size_bytes: world.storedFile.sizeBytes }], patch_notes: "Faster jumps." } }),
  "GET /games/:slug/versions/:version_id": () => ({}),
  "POST /games/:slug/versions/:version_id/publish": () => ({}),
  "DELETE /games/:slug/versions/:version_id/publish": () => ({}),
  "DELETE /games/:slug/versions/:version_id/preview-links": () => ({}),
  "GET /games/:slug/reports": () => ({}),
  "GET /games/:slug/stats": () => ({ query: { period_duration_days: "7" } }),
  "GET /games/:slug/history": () => ({}),
  "GET /games/:slug/qr-code": () => ({ query: { room_code: "K7PQ2M" } }),
  "GET /games/:slug/logs": () => ({ query: { minimum_level: "warn" } }),
  "GET /games/:slug/testers": () => ({}),
  "POST /games/:slug/testers": () => ({ body: { name: "Streamers", version_choice: "newest_passed" } }),
  "PATCH /games/:slug/testers/:tester_id": () => ({ body: { name: "Team", version_choice: "newest_passed" } }),
  "DELETE /games/:slug/testers/:tester_id": () => ({}),
  "GET /games/:slug/database": () => ({}),
  "POST /games/:slug/database/query": () => ({ body: { sql: "CREATE TABLE IF NOT EXISTS scores (player_id TEXT PRIMARY KEY, best_score INTEGER)" } }),
  "POST /games/:slug/database/batch": () => ({ body: { statements: [{ sql: "CREATE TABLE IF NOT EXISTS levels (level_number INTEGER PRIMARY KEY)", values: [] }] } }),
  "GET /games/:slug/database/export": () => ({}),
  "POST /games/:slug/database/import": () => ({ body: { dump_sql: "CREATE TABLE IF NOT EXISTS badges (badge_name TEXT);" } }),
  "POST /games/:slug/database/erase-player": () => ({ body: { player_id: "player_8f3k2m9q1x7c4v6b0n5z" } }),
  "POST /games/:slug/database/restores": () => ({ body: { restore_to_at: new Date().toISOString() } }),
  "POST /games/:slug/database/restores/:database_restore_id/undo": () => ({}),
  "GET /games/:slug/secrets": () => ({}),
  "GET /games/:slug/export": () => ({}),
  "GET /games/:slug/export/download": () => ({}),
  "PUT /games/:slug/secrets/:secret_name": () => ({ body: { secret_value: "sk_test_hop" } }),
  "DELETE /games/:slug/secrets/:secret_name": () => ({}),
  "GET /games/:slug/kept-rooms": () => ({}),
  "GET /games/:slug/items": () => ({}),
  "PUT /games/:slug/items/:item_name": () => ({ body: { title: "Revive", description: "", item_kind: "consumable", item_category: "gameplay", price_minor_units: 149, currency_code: "usd", local_prices: [] } }),
  // An item nobody owns: one players own stays (item_has_owners).
  "DELETE /games/:slug/items/:item_name": () => ({ pathValues: { item_name: "spare_cape" } }),
  "PATCH /games/:slug/purchase-settings": () => ({ body: { refund_policy: "within_14_days" } }),
  "GET /games/:slug/purchases": () => ({ query: { purchase_source: "grant" } }),
  "POST /games/:slug/purchases": (world) => ({ body: { player_id: world.values.player_id, item_name: "revive", item_count: 2 } }),
  "GET /games/:slug/purchases/:purchase_id": () => ({}),
  "POST /games/:slug/purchases/:purchase_id/refund": () => ({}),
  "GET /games/:slug/players/:player_id/items": () => ({}),
  "DELETE /games/:slug/kept-rooms/:room_code": () => ({}),
  "GET /games/:slug/saves": () => ({}),
  "GET /games/:slug/saves/:player_id": () => ({ query: { keys: "coins" } }),
  "PATCH /games/:slug/saves/:player_id": () => ({ body: { local_storage_items: { coins: "500" } } }),
  "PUT /games/:slug/saves/:player_id": () => ({ body: { local_storage_items: { coins: "1" }, indexeddb_databases: [] } }),
  "DELETE /games/:slug/saves/:player_id": () => ({}),
  "GET /games/:slug/saves/:player_id/copies": () => ({}),
  "GET /games/:slug/saves/:player_id/copies/:save_copy_id": () => ({}),
  "POST /games/:slug/saves/:player_id/copies/:save_copy_id/restore": () => ({}),
  "GET /forum": () => ({ query: { tab: "messages" } }),
  "POST /forum": (world) => ({ body: { kind: "bug", title: "Rooms drop after a minute", text_markdown: "Every match ends at 60 seconds.", is_public: false, game_slug: world.values.slug } }),
  "GET /forum/similar": () => ({ query: { search_text: "rooms drop" } }),
  "GET /forum/people": (world) => ({ query: { name_prefix: "H", topic_id: world.values.topic_id! } }),
  "POST /forum/media": () => ({ bytes: png(400, 300) }),
  "GET /forum/:topic_id": () => ({ query: { post_selection: "latest" } }),
  "POST /forum/:topic_id/posts": () => ({ body: { text_markdown: "It happens on phones too." } }),
  "POST /forum/:topic_id/vote": (world) => ({ pathValues: { topic_id: world.publicTopicId } }),
  "DELETE /forum/:topic_id/vote": (world) => ({ pathValues: { topic_id: world.publicTopicId } }),
  "POST /forum/:topic_id/follow": () => ({}),
  "DELETE /forum/:topic_id/follow": () => ({}),
  "POST /forum/:topic_id/answer": () => ({ body: { answer_post_id: null } }),
  "POST /forum/:topic_id/misplaced": (world) => ({ pathValues: { topic_id: world.publicTopicId }, body: {} }),
  "POST /forum/:topic_id/still-happening": (world) => ({ pathValues: { topic_id: world.publicTopicId }, body: {} }),
  "PUT /forum/:topic_id/posts/:post_id/rating": (world) => ({ pathValues: { topic_id: world.publicTopicId, post_id: world.publicPostId }, body: { rating: "like" } }),
  "DELETE /forum/:topic_id/posts/:post_id/rating": (world) => ({ pathValues: { topic_id: world.publicTopicId, post_id: world.publicPostId } }),
  "POST /forum/:topic_id/posts/:post_id/bookmark": (world) => ({ pathValues: { topic_id: world.publicTopicId, post_id: world.publicPostId } }),
  "DELETE /forum/:topic_id/posts/:post_id/bookmark": (world) => ({ pathValues: { topic_id: world.publicTopicId, post_id: world.publicPostId } }),
  "POST /forum/:topic_id/posts/:post_id/helpful": (world) => ({ pathValues: { topic_id: world.publicTopicId, post_id: world.publicPostId } }),
  "DELETE /forum/:topic_id/posts/:post_id/helpful": (world) => ({ pathValues: { topic_id: world.publicTopicId, post_id: world.publicPostId } }),
  "POST /forum/:topic_id/posts/:post_id/report": (world) => ({ pathValues: { topic_id: world.publicTopicId, post_id: world.publicPostId }, body: { reason: "scam" } }),
  "GET /forum/:topic_id/media/:media_id": () => ({}),
  "GET /players/:player_id": () => ({}),
  "GET /sign-in-apps": () => ({}),
  "POST /sign-in-apps": () => ({ body: { name: "Hop Online", kind: "public", redirect_urls: ["https://hop.example.test/back"] } }),
  "PATCH /sign-in-apps/:sign_in_app_id": () => ({ body: { name: "Hop Online 2" } }),
  "DELETE /sign-in-apps/:sign_in_app_id": () => ({}),
  "GET /credit": () => ({}),
  "POST /credit/top-ups": () => ({ body: { amount_cents: 2000 } }),
  "GET /pro": () => ({}),
  "POST /pro/checkout": () => ({}),
  "POST /pro/cancel": () => ({}),
  "POST /pro/resume": () => ({}),
  "POST /credit/refunds": (world) => ({ body: { top_up_id: world.values.top_up_id } }),
  "PATCH /credit/automatic-top-up": () => ({ body: { is_enabled: false } }),
  "GET /webhooks": () => ({}),
  "POST /webhooks": (world) => ({ body: { endpoint_url: `https://${HOOKS_HOST}/two`, event_kinds: ["bug_reported"], game_slugs: [world.values.slug] } }),
  "PATCH /webhooks/:webhook_id": (world) => ({ body: { game_slugs: [world.values.slug] } }),
  "DELETE /webhooks/:webhook_id": () => ({}),
  "POST /webhooks/:webhook_id/test": () => ({}),
  "GET /webhooks/:webhook_id/deliveries": () => ({}),
};

/**
 * Calls that change something (or read something private) and write no security event, and why. Every other
 * call that changes something, and each of LOGGED_READS, must write one for the developer's account.
 */
const UNLOGGED_CHANGES: Record<string, string> = {
  "POST /check": "Changes nothing: it reads the files it's sent and keeps nothing.",
  "POST /games/:slug/uploads": "Only answers which files are missing.",
  "PUT /files/:sha256": "A piece of an upload: the version is the event.",
  "POST /files/:sha256/parts": "A piece of an upload: the version is the event.",
  "PUT /files/:sha256/parts/:part_number": "A piece of an upload: the version is the event.",
  "POST /files/:sha256/parts/done": "A piece of an upload: the version is the event.",
  "POST /webhooks/:webhook_id/test": "Changes nothing.",
  "POST /games/:slug/shader-checks": "Changes nothing of the game's: it draws the shader and keeps only a sheet picture for a day.",
};
/** Reads that are logged: what a player saved, and the whole database. */
const LOGGED_READS = ["GET /games/:slug/export/download", "GET /games/:slug/database/export", "GET /games/:slug/saves/:player_id", "GET /games/:slug/saves/:player_id/copies/:save_copy_id"];
/** Events a key's use writes even when the router refuses its call (like last_used_at_ms). */
const KEY_USE_EVENT_KINDS = ["api_key_new_place", "ai_connected"];
const isLogged = (apiRoute: ApiRoute) => (apiRoute.method !== "GET" && !(nameOf(apiRoute) in UNLOGGED_CHANGES) && !apiRoute.path.startsWith("/forum")) || LOGGED_READS.includes(nameOf(apiRoute));

/**
 * Path parts that name something inside the path's game or topic by its ID: from inside the stranger's own
 * game or topic, the developer's must be answered like nothing there.
 */
const IDS_INSIDE = ["image_id", "shader_id", "version_id", "tester_id", "save_copy_id", "database_restore_id", "post_id", "media_id", "purchase_id"];
/** Path parts inside a game that aren't IDs of the developer's things, and why a stranger may use them in their own game. */
const NAMES_INSIDE: Record<string, string> = {
  secret_name: "A name the developer picks: any game can have a secret of that name.",
  screen: "wide or phone: every game has a background for both.",
  room_code: "A room's code is only unique inside its game: any game can have a room with that code.",
  player_id: "A player's save or items in this game: a game's developer reads and changes its own players' saves and items, and a player has them in each game they play.",
  item_name: "A name the developer picks: any game can have an item of that name.",
};

/**
 * Inputs that do a higher choice's work, and the choice each needs (docs/DECISIONS.md, "Developers hold
 * the keys"). The declarations must say so, and an input declared to need more must be here: a new one is
 * a decision about access, so it's written down twice.
 */
const INPUTS_THAT_NEED_MORE: Record<string, [AccessArea, string]> = {
  "POST /games/:slug/versions publish_when_approved": ["version_access", "publish"],
  "PATCH /games/:slug monthly_budget_cents": ["credit_access", "write"],
};

/** What a stranger names in an input that names something: the developer's own. */
const NAMED: Record<Extract<ApiInput, { kind: "names" }>["what"], (world: World) => unknown> = {
  game: (world) => world.values.slug,
  game_list: (world) => [world.values.slug],
  files: (world) => [{ path: "index.html", sha256: world.ownedSha256, size_bytes: 20 }],
  forum_topic: (world) => world.values.topic_id,
};

const nameOf = (apiRoute: Pick<ApiRoute, "method" | "path">) => `${apiRoute.method} ${apiRoute.path}`;
const placeholders = (apiRoute: ApiRoute) => [...apiRoute.path.matchAll(/:([a-z0-9_]+)/g)].map((match) => match[1]!);
const OWNING_PARTS = ["game", "webhook", "sign_in_app", "forum_topic"];
const ownsSomething = (apiRoute: ApiRoute) => Object.values(apiRoute.pathParts).some((pathPart) => OWNING_PARTS.includes(pathPart));
const bodyInputs = (apiRoute: ApiRoute): Record<string, ApiInput> => (apiRoute.body && apiRoute.body !== "bytes" ? apiRoute.body.inputs : {});
const allInputs = (apiRoute: ApiRoute) => ({ ...apiRoute.query, ...bodyInputs(apiRoute) });

let worldCount = 0;
const realFetch = globalThis.fetch;
/** What a stand-in for Stripe answers each call that reaches it. */
const STRIPE_ANSWERS: Record<string, Record<string, unknown>> = {
  "/v1/customers": { id: "cus_test" },
  "/v1/checkout/sessions": { id: "cs_test", url: "https://checkout.stripe.com/c/pay/cs_test", expires_at: 1_900_000_000 },
  "/v1/refunds": { id: "re_test" },
};

async function makeWorld(): Promise<World> {
  const n = ++worldCount;
  const accountIdOf = (name: string) => `${name}-${n}`;
  for (const [name, username] of [["victim", "Victim"], ["stranger", "Stranger"], ["helper", "Helper"], ["player", "Player"]] as const) {
    await createAccount(env.DB, { id: accountIdOf(name), username: `${username}_${n}`, ageBand: "18+" });
    await letPublish(env.DB, accountIdOf(name));
  }
  const [victimOwner, strangerOwner, player] = await Promise.all([personOwner(env.DB, accountIdOf("victim")), personOwner(env.DB, accountIdOf("stranger")), accountById(env.DB, accountIdOf("player"))]);
  const game = await createGame(env.DB, { slug: `hop-${n}`, title: "Hop", description: "", ownerId: victimOwner.id, visibility: "draft" });
  const otherGame = await createGame(env.DB, { slug: `cave-${n}`, title: "Cave", description: "", ownerId: victimOwner.id, visibility: "draft" });
  const strangerGame = await createGame(env.DB, { slug: `moon-${n}`, title: "Moon", description: "", ownerId: strangerOwner.id, visibility: "draft" });
  await env.DB.prepare("UPDATE games SET cloud_saves_enabled = 1 WHERE id IN (?, ?)").bind(game.id, strangerGame.id).run();
  const nowMs = Date.now();
  // A top-up of the developer's, still refundable, paid on Stripe (a stand-in here).
  const topUpId = (await addCreditEntry(env.DB, { ownerId: victimOwner.id, entryKind: "top_up", amountCents: 2000, stripeObjectId: `pi_test_${n}`, refundableUntilMs: nowMs + 86_400_000 }))!;

  // Files: one shared, one kept for the developer alone, one nobody sent, and a big one half sent.
  const storedBytes = text(`<!doctype html><p>hop ${n}</p>`);
  const storedFile = { sha256: await sha256Hex(storedBytes), sizeBytes: storedBytes.byteLength };
  const ownedSha256 = await sha256Hex(text(`owned ${n}`));
  const newBytes = text(`<!doctype html><p>new ${n}</p>`);
  const bigSha256 = await sha256Hex(text(`big ${n}`));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO blobs (sha256, size_bytes, created_at_ms) VALUES (?, ?, ?)").bind(storedFile.sha256, storedFile.sizeBytes, nowMs),
    // The developer sent it, so it's theirs to use (blob_owners); a stranger naming it gets nothing.
    env.DB.prepare("INSERT INTO blob_owners (owner_id, sha256, created_at_ms) VALUES (?, ?, ?)").bind(victimOwner.id, storedFile.sha256, nowMs),
    env.DB.prepare("INSERT INTO owned_blobs (owner_id, sha256, size_bytes, created_at_ms) VALUES (?, ?, ?, ?)").bind(victimOwner.id, ownedSha256, 20, nowMs),
  ]);
  const upload = await env.GAMES.createMultipartUpload(ownedBlobKey(victimOwner.id, bigSha256));
  const part = await upload.uploadPart(1, text("<!doctype html><p>part one</p>"));

  // A version that passed review, a cover, a tester link and a secret.
  const versionId = newId("version");
  await env.GAMES.put(manifestKey(versionId), JSON.stringify({ files: { "index.html": { sha256: storedFile.sha256 } } }));
  await createVersion(env.DB, { id: versionId, gameId: game.id, r2Prefix: `manifests/${versionId}`, fileCount: 1, sizeBytes: storedFile.sizeBytes, kind: "files" });
  await env.DB.prepare("UPDATE versions SET scan_status = 'approved', preview_link_key = ? WHERE id = ?").bind(`preview${n}`, versionId).run();
  const image = await addImage(env.DB, { id: newId("image"), game_id: game.id, kind: "cover", content_type: "image/png", width_px: 1280, height_px: 720, size_bytes: 64 });
  await env.GAMES.put(imageKey(image), png(1280, 720));
  const shader = await addShader(env.DB, { id: newId("shader"), game_id: game.id, screen: "wide", size_bytes: 80, buffer_count: 0, texture_count: 0 });
  await env.GAMES.put(shaderKey(game.id, shader.id), "void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(1.0); }");
  await settleShader(env.DB, shader, null, [{ quality_level: 0, check_frame_ms: 20, maximum_check_frame_ms: 75 }], 0);
  const tester = await addTesterLink(env.DB, game.id, "Playtesters");
  expect(await env.GAME_SECRETS!.set(game.id, "API_TOKEN", `secret ${n}`, nowMs)).toHaveProperty("secret");
  // A room its game server kept.
  await env.DB.prepare("INSERT INTO kept_rooms (game_id, room_code, name, saved_size_bytes, saved_at_ms, last_played_at_ms, created_at_ms) VALUES (?, 'K7Q2MX', 'Frostbound', 2048, ?, ?, ?)").bind(game.id, nowMs, nowMs, nowMs).run();

  // Items: one the player was granted (with the refund policy a price needs), and one nobody owns.
  await env.DB.prepare("UPDATE games SET refund_policy = 'unused_within_14_days' WHERE id = ?").bind(game.id).run();
  const purchaseId = newId("purchase");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO game_items (game_id, item_name, title, item_kind, item_category, price_minor_units, currency_code, created_at_ms, updated_at_ms) VALUES (?, 'revive', 'Revive', 'consumable', 'gameplay', 199, 'usd', ?, ?)").bind(game.id, nowMs, nowMs),
    env.DB.prepare("INSERT INTO game_items (game_id, item_name, title, item_kind, item_category, created_at_ms, updated_at_ms) VALUES (?, 'spare_cape', 'Spare Cape', 'permanent', 'cosmetic', ?, ?)").bind(game.id, nowMs, nowMs),
    env.DB.prepare("INSERT INTO purchases (id, game_id, item_name, item_kind, item_count, player_id, purchase_source, purchase_status, created_at_ms, purchased_at_ms) VALUES (?, ?, 'revive', 'consumable', 3, ?, 'grant', 'completed', ?, ?)").bind(purchaseId, game.id, player!.player_id, nowMs, nowMs),
  ]);

  // A player's save in the game, with an earlier copy.
  const saveText = canonicalSave(saveFromParts({ coins: "5" }, []));
  await bumpSave(env.DB, { accountId: player!.id, gameId: game.id, baseVersionNumber: 0, sha256: await saveHash(saveText), sizeBytes: saveText.length, changedByKind: "player", versionId: null });
  await env.SAVES.put(saveKey(player!.id, game.id), saveText);
  const saveCopyId = newId("save_copy");
  const copyText = canonicalSave(saveFromParts({ coins: "1" }, []));
  await env.DB.prepare("INSERT INTO save_history (id, account_id, game_id, saved_at_ms, copy_reason, sha256, size_bytes) VALUES (?, ?, ?, ?, 'hourly', ?, ?)")
    .bind(saveCopyId, player!.id, game.id, nowMs - 60_000, await saveHash(copyText), copyText.length)
    .run();
  await env.SAVES.put(saveCopyKey(player!.id, game.id, saveCopyId), copyText);
  // A restore of the game's database, to undo.
  const databaseRestoreId = newId("database_restore");
  await addDatabaseRestore(env.DB, { id: databaseRestoreId, game_id: game.id, restore_to_at_ms: nowMs - 60_000, undo_bookmark: "undo-access-checks", undoes_database_restore_id: null, restored_at_ms: nowMs });

  // A webhook and a sign-in app each.
  const webhook = await createWebhook(env.DB, { ownerId: victimOwner.id, destinationKind: "endpoint_url", endpointUrl: `https://${HOOKS_HOST}/zaisma`, eventKinds: ["bug_reported"], gameSlugs: null });
  const strangerWebhook = await createWebhook(env.DB, { ownerId: strangerOwner.id, destinationKind: "endpoint_url", endpointUrl: `https://${HOOKS_HOST}/moon`, eventKinds: ["bug_reported"], gameSlugs: null });
  const { app } = await createSignInApp(env.DB, { ownerId: victimOwner.id, name: "Hop Online", kind: "confidential", redirectUrls: ["https://hop.example.test/callback"] });
  const { app: strangerApp } = await createSignInApp(env.DB, { ownerId: strangerOwner.id, name: "Moon Online", kind: "confidential", redirectUrls: ["https://moon.example.test/callback"] });

  // The forum: the developer's and the stranger's private questions to Zaisma (the developer's with an
  // image), and a helper's public known issue whose fix is out.
  const topic = (id: string, accountId: string, fields: { kind: string; isPublic: boolean; knownIssueTitle?: string; topicStatus?: string }) =>
    env.DB.prepare(
      "INSERT INTO forum_topics (id, account_id, kind, title, category, topic_status, known_issue_title, is_public, is_shown, created_at_ms, updated_at_ms, last_activity_at_ms) VALUES (?, ?, ?, ?, 'servers', ?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, accountId, fields.kind, `Rooms ${id}`, fields.topicStatus ?? "new", fields.knownIssueTitle ?? null, fields.isPublic ? 1 : 0, fields.isPublic ? 1 : 0, nowMs, nowMs, nowMs);
  const post = (id: string, topicId: string, accountId: string, checkStatus: string | null) =>
    env.DB.prepare("INSERT INTO forum_posts (id, topic_id, account_id, author_kind, posted_via, kind, text_markdown, created_at_ms, check_status) VALUES (?, ?, ?, 'developer', 'api', 'post', 'Rooms drop.', ?, ?)").bind(
      id,
      topicId,
      accountId,
      nowMs,
      checkStatus,
    );
  const [topicId, postId, mediaId, strangerTopicId, strangerPostId, publicTopicId, publicPostId] = [newId("topic"), newId("post"), newId("media"), newId("topic"), newId("post"), newId("topic"), newId("post")];
  await env.DB.batch([
    topic(topicId, accountIdOf("victim"), { kind: "question", isPublic: false }),
    post(postId, topicId, accountIdOf("victim"), null),
    env.DB.prepare("INSERT INTO forum_media (id, post_id, account_id, content_type, position_index, created_at_ms, has_passed_matching, storage_key) VALUES (?, ?, ?, 'image/png', 0, ?, 1, ?)").bind(
      mediaId,
      postId,
      accountIdOf("victim"),
      nowMs,
      forumMediaKey(mediaId),
    ),
    topic(strangerTopicId, accountIdOf("stranger"), { kind: "question", isPublic: false }),
    post(strangerPostId, strangerTopicId, accountIdOf("stranger"), null),
    topic(publicTopicId, accountIdOf("helper"), { kind: "bug", isPublic: true, knownIssueTitle: "Rooms drop after a minute", topicStatus: "released" }),
    post(publicPostId, publicTopicId, accountIdOf("helper"), "passed"),
  ]);
  await env.GAMES.put(forumMediaKey(mediaId), png(400, 300));

  return {
    n,
    victimAccountId: accountIdOf("victim"),
    victimOwnerId: victimOwner.id,
    strangerAccountId: accountIdOf("stranger"),
    values: {
      top_up_id: topUpId,
      slug: game.slug,
      image_id: image.id,
      shader_id: shader.id,
      screen: "wide",
      version_id: versionId,
      tester_id: tester.id,
      secret_name: "API_TOKEN",
      room_code: "K7Q2MX",
      player_id: player!.player_id,
      save_copy_id: saveCopyId,
      database_restore_id: databaseRestoreId,
      item_name: "revive",
      purchase_id: purchaseId,
      topic_id: topicId,
      post_id: postId,
      media_id: mediaId,
      webhook_id: webhook.id,
      sign_in_app_id: app.id,
      sha256: storedFile.sha256,
      part_number: "1",
    },
    strangerValues: { slug: strangerGame.slug, topic_id: strangerTopicId, webhook_id: strangerWebhook.id, sign_in_app_id: strangerApp.id, player_id: player!.player_id, secret_name: "API_TOKEN", screen: "wide", item_name: "revive" },
    otherSlug: otherGame.slug,
    publicTopicId,
    publicPostId,
    storedFile,
    ownedSha256,
    newFile: { sha256: await sha256Hex(newBytes), bytes: newBytes },
    uploadId: upload.uploadId,
    partEtag: part.etag,
    bigSha256,
  };
}

/** The developer's things a stranger must never see in an answer: their account, games and IDs. */
function privateValues(world: World): string[] {
  const { values } = world;
  return [world.victimAccountId, world.victimOwnerId, values.slug!, world.otherSlug, values.image_id!, values.shader_id!, values.version_id!, values.tester_id!, values.save_copy_id!, values.database_restore_id!, values.purchase_id!, values.topic_id!, values.post_id!, values.media_id!, values.webhook_id!, values.sign_in_app_id!, world.ownedSha256];
}

/** The same request with each of the developer's things swapped for one that doesn't exist, and how to swap them back in an answer. */
function withNothingThere(world: World, sample: Required<Pick<Sample, "pathValues">> & Sample): { sample: typeof sample; swapBack: (answerText: string) => string } {
  const kinds: Record<string, Parameters<typeof newId>[0]> = { image_id: "image", shader_id: "shader", version_id: "version", tester_id: "tester", save_copy_id: "save_copy", database_restore_id: "database_restore", purchase_id: "purchase", topic_id: "topic", post_id: "post", media_id: "media", webhook_id: "webhook", sign_in_app_id: "sign_in_app" };
  const swaps: [string, string][] = [
    [world.values.slug!, `gone-${world.n}`],
    [world.otherSlug, `gone-other-${world.n}`],
    [world.ownedSha256, "f".repeat(64)],
    ...Object.entries(kinds).map(([name, kind]): [string, string] => [world.values[name]!, newId(kind)]),
  ];
  let swapped = JSON.stringify({ ...sample, bytes: undefined });
  for (const [real, gone] of swaps) swapped = swapped.replaceAll(real, gone);
  return {
    sample: { ...JSON.parse(swapped), bytes: sample.bytes },
    swapBack: (answerText) => swaps.reduce((answer, [real, gone]) => answer.replaceAll(gone, real), answerText),
  };
}

async function call(apiRoute: ApiRoute, key: string, sample: Sample & { pathValues: Record<string, string> }) {
  const path = apiRoute.path.replace(/:([a-z0-9_]+)/g, (_, name: string) => encodeURIComponent(sample.pathValues[name]!));
  const query = sample.query ? `?${new URLSearchParams(sample.query)}` : "";
  const isJson = sample.body !== undefined;
  // The site's own fetch, not SELF's, so it runs with this file's stand-in shader renderer.
  const response = await worker.fetch(
    new Request(`${SITE}/api/dev${path}${query}`, {
      method: apiRoute.method,
      headers: { authorization: `Bearer ${key}`, ...(isJson ? { "content-type": "application/json" } : {}), ...(sample.bytes ? { "content-length": String(sample.bytes.byteLength) } : {}) },
      body: sample.bytes ?? (isJson ? JSON.stringify(sample.body) : undefined),
    }),
    env,
    createExecutionContext(),
  );
  // Bytes, then text: a served image is an answer too.
  const answerText = new TextDecoder().decode(await response.arrayBuffer());
  let answer: { error?: { code: string; field: string | null } } = {};
  try {
    answer = JSON.parse(answerText);
  } catch {}
  return { httpStatus: response.status, answerText, answer };
}

/** Everything a call could change: every table but API keys and places (a key's use), the security log but a key's use, both buckets, and the developer's games' own databases and secrets. */
async function everything(world: World): Promise<string> {
  const { results: tables } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' AND name NOT LIKE 'forum_search%' AND name NOT IN ('api_keys', 'security_places') ORDER BY name",
  ).all<{ name: string }>();
  const rows = await env.DB.batch(
    tables.map(({ name }) => env.DB.prepare(name === "security_events" ? `SELECT * FROM security_events WHERE kind NOT IN (${KEY_USE_EVENT_KINDS.map((kind) => `'${kind}'`).join(", ")})` : `SELECT * FROM "${name}"`)),
  );
  const parts = tables.map(({ name }, i) => `${name}: ${rows[i]!.results.map((row) => JSON.stringify(row)).sort().join("\n")}`);
  for (const bucket of [env.GAMES, env.SAVES]) {
    let cursor: string | undefined;
    do {
      const listed = await bucket.list({ limit: 1000, cursor });
      parts.push(listed.objects.map((object) => `${object.key} ${object.etag}`).join("\n"));
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
  }
  for (const slug of [world.values.slug!, world.otherSlug]) {
    const game = await env.DB.prepare("SELECT id FROM games WHERE slug = ?").bind(slug).first<{ id: string }>();
    parts.push(JSON.stringify(await env.GAME_DATABASES!.exportDump(game!.id, null)), JSON.stringify(await env.GAME_SECRETS!.list(game!.id)));
  }
  return parts.join("\n\n");
}

const keyFor = async (accountId: string, scope?: KeyScope) => (await createApiKey(env.DB, accountId, `key ${Math.random()}`, scope)).token;

beforeAll(async () => {
  // Webhook tests reach the developer's server: a stand-in that says yes.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "api.stripe.com") return Response.json(STRIPE_ANSWERS[url.pathname] ?? {});
    return url.hostname === HOOKS_HOST ? new Response("ok") : realFetch(input, init);
  }) as typeof fetch;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await env.DB.exec(
    "DELETE FROM kept_rooms; DELETE FROM purchases; DELETE FROM game_items; DELETE FROM forum_media; DELETE FROM forum_follows; DELETE FROM forum_votes; DELETE FROM forum_post_ratings; DELETE FROM forum_bookmarks; DELETE FROM forum_reports; DELETE FROM forum_misplaced_flags; DELETE FROM forum_posts; DELETE FROM forum_topic_tags; DELETE FROM forum_topics; DELETE FROM webhook_deliveries; DELETE FROM webhooks; DELETE FROM sign_in_apps; DELETE FROM save_history; DELETE FROM saves; DELETE FROM tester_links; DELETE FROM game_backgrounds; DELETE FROM game_shaders; DELETE FROM game_images; DELETE FROM owned_blobs; DELETE FROM blobs; DELETE FROM api_keys; DELETE FROM security_events; DELETE FROM security_places; DELETE FROM audit_log; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM credit_entries; DELETE FROM owners; DELETE FROM accounts;",
  );
});

describe("the declarations", () => {
  it("name every path part, and only those", () => {
    for (const apiRoute of API_ROUTES) expect(Object.keys(apiRoute.pathParts).sort(), nameOf(apiRoute)).toEqual(placeholders(apiRoute).sort());
  });

  it("say what each path reaches, as its parts do", () => {
    for (const apiRoute of API_ROUTES) {
      const parts = Object.values(apiRoute.pathParts);
      const expected = parts.includes("webhook")
        ? ["webhook"]
        : parts.includes("sign_in_app")
          ? ["sign_in_app"]
          : parts.includes("forum_topic")
            ? ["forum_topic"]
            : parts.includes("game")
              ? [apiRoute.pathParts.player_id && apiRoute.path.includes("/saves/") ? "player_save" : "game"]
              : ["account", "nothing_private"];
      expect(expected, nameOf(apiRoute)).toContain(apiRoute.reaches);
    }
  });

  it("sort every part inside a game or topic", () => {
    for (const apiRoute of API_ROUTES) {
      for (const [name, pathPart] of Object.entries(apiRoute.pathParts)) {
        if (pathPart !== "in_game" && pathPart !== "in_forum_topic") continue;
        expect(IDS_INSIDE.includes(name) || name in NAMES_INSIDE, `${nameOf(apiRoute)}: :${name} is inside its game or topic; add it to IDS_INSIDE (another's ID, refused from inside the stranger's own) or NAMES_INSIDE with why a stranger may use it.`).toBe(true);
      }
    }
  });

  it("need more than reading for a call that changes something, and no more for one that reads", () => {
    // Calls that only read but take a body, so they can't be a GET: the game check reads the files it's sent and keeps nothing.
    const READS_WITH_A_BODY = new Set(["POST /check"]);
    for (const apiRoute of API_ROUTES) {
      if (apiRoute.method === "GET" || READS_WITH_A_BODY.has(nameOf(apiRoute))) expect(["", "read"], `${nameOf(apiRoute)} only reads`).toContain(apiRoute.choice);
      else expect(["none", "read", ""], `${nameOf(apiRoute)} changes something, so it needs write, upload or publish`).not.toContain(apiRoute.choice);
    }
  });

  it("hold the inputs that do a higher choice's work to that choice", () => {
    for (const [inputName, [area, choice]] of Object.entries(INPUTS_THAT_NEED_MORE)) {
      const apiRoute = API_ROUTES.find((candidate) => inputName.startsWith(`${nameOf(candidate)} `));
      expect(apiRoute ? allInputs(apiRoute)[inputName.split(" ").at(-1)!] : undefined, inputName).toMatchObject({ kind: "needs", area, choice });
    }
    for (const apiRoute of API_ROUTES) {
      for (const [name, input] of Object.entries(allInputs(apiRoute))) {
        if (input.kind === "needs") expect(INPUTS_THAT_NEED_MORE, `${nameOf(apiRoute)} ${name} needs more than its call: add it to INPUTS_THAT_NEED_MORE`).toHaveProperty([`${nameOf(apiRoute)} ${name}`]);
      }
    }
  });

  it("take no body on a GET, and give an input its own access only when it needs more than the call", () => {
    for (const apiRoute of API_ROUTES) {
      if (apiRoute.method === "GET") expect(apiRoute.body, nameOf(apiRoute)).toBeNull();
      for (const [name, input] of Object.entries(allInputs(apiRoute))) {
        if (input.kind !== "needs") continue;
        expect(AREA_ACCESS_CHOICES[input.area] as readonly string[], `${nameOf(apiRoute)} ${name}`).toContain(input.choice);
        const isMore = input.area !== apiRoute.area || !allows({ ...AREA_ACCESS_BY_LEVEL.read, [input.area]: apiRoute.choice } as AreaAccess, input.area, input.choice);
        expect(isMore, `${nameOf(apiRoute)} ${name} needs no more than the call itself`).toBe(true);
      }
    }
  });

  it("have an example here for every call, and none for a call that isn't one", () => {
    expect(API_ROUTES.map(nameOf).filter((routeName) => !(routeName in SAMPLES)), "Add an example of each new call to SAMPLES in this file, as it goes through with a full key.").toEqual([]);
    expect(Object.keys(SAMPLES).filter((routeName) => !API_ROUTES.some((apiRoute) => nameOf(apiRoute) === routeName))).toEqual([]);
  });
});

describe("every call", () => {
  it.each(API_ROUTES.map((apiRoute) => [nameOf(apiRoute), apiRoute] as const))("%s refuses whoever it should, with nothing changed", async (routeName, apiRoute) => {
    const world = await makeWorld();
    const sample = SAMPLES[routeName]!(world);
    const asDeveloper = { ...sample, pathValues: { ...world.values, ...sample.pathValues } };
    const strangerKey = await keyFor(world.strangerAccountId);
    const before = await everything(world);
    const refusals: string[] = [];

    /** A refusal: the error's shape, the code if one is expected, and nothing changed anywhere. */
    const refused = async (caseName: string, made: Awaited<ReturnType<typeof call>>, code?: string, field?: string) => {
      refusals.push(caseName);
      expect(made.httpStatus, `${caseName}: ${made.answerText.slice(0, 300)}`).toBeGreaterThanOrEqual(400);
      expect(made.httpStatus, `${caseName}: ${made.answerText.slice(0, 300)}`).toBeLessThan(500);
      expect(errorProblems(made.answer, made.httpStatus), caseName).toEqual([]);
      if (code) expect(made.answer.error?.code, `${caseName}: ${made.answerText.slice(0, 300)}`).toBe(code);
      if (field) expect(made.answer.error?.field, caseName).toBe(field);
      expect(await everything(world), `${caseName} changed something`).toBe(before);
    };
    /** A stranger's refusal must be the same answer as for something that isn't there. */
    const refusedLikeNothing = async (caseName: string, strangerSample: Sample & { pathValues: Record<string, string> }) => {
      const made = await call(apiRoute, strangerKey, strangerSample);
      await refused(caseName, made);
      expect(made.answer.error?.code, caseName).not.toBe("key_not_allowed");
      const nothing = withNothingThere(world, strangerSample);
      const madeOnNothing = await call(apiRoute, strangerKey, nothing.sample);
      expect({ httpStatus: madeOnNothing.httpStatus, answer: nothing.swapBack(madeOnNothing.answerText) }, `${caseName}: not the same as nothing there`).toEqual({ httpStatus: made.httpStatus, answer: made.answerText });
    };

    // A stranger on the developer's game, webhook, sign-in app or private topic.
    if (ownsSomething(apiRoute)) await refusedLikeNothing("a stranger on the developer's", { ...sample, pathValues: { ...world.values, ...sample.pathValues, ...pickOwning(apiRoute, world.values) } });
    // A stranger naming the developer's things in an input, from their own game or topic.
    const strangerPath = { ...world.values, ...sample.pathValues, ...world.strangerValues };
    for (const [name, input] of Object.entries(allInputs(apiRoute))) {
      if (input.kind !== "names") continue;
      const query = { ...sample.query };
      const body = { ...sample.body };
      for (const [otherName, other] of Object.entries(allInputs(apiRoute))) if (other.kind === "names") delete (otherName in apiRoute.query ? query : body)[otherName];
      const named = NAMED[input.what](world);
      if (name in apiRoute.query) query[name] = named as string;
      else body[name] = named;
      const hasJsonBody = apiRoute.body !== null && apiRoute.body !== "bytes";
      await refusedLikeNothing(`a stranger naming the developer's in ${name}`, { pathValues: strangerPath, query, body: hasJsonBody ? body : undefined, bytes: sample.bytes });
    }
    // A stranger reaching an ID of the developer's from inside their own game or topic.
    for (const name of Object.keys(apiRoute.pathParts).filter((part) => IDS_INSIDE.includes(part))) {
      await refusedLikeNothing(`a stranger on the developer's ${name} from their own`, { ...sample, pathValues: { ...strangerPath, [name]: world.values[name]! } });
    }
    // A stranger's own account: nothing of the developer's in what they read.
    if (!ownsSomething(apiRoute) && apiRoute.method === "GET" && !Object.values(allInputs(apiRoute)).some((input) => input.kind === "names")) {
      const made = await call(apiRoute, strangerKey, asDeveloper);
      for (const value of privateValues(world)) expect(made.answerText, `a stranger's ${routeName} answers the developer's ${value}`).not.toContain(value);
      expect(await everything(world), `a stranger's ${routeName} changed something`).toBe(before);
    }

    // Each key level below what the call needs, and a custom key one choice short.
    if (apiRoute.area) {
      const area = apiRoute.area;
      for (const level of ["read", "upload", "publish", "full"] as const) {
        if (allows(AREA_ACCESS_BY_LEVEL[level], area, apiRoute.choice)) continue;
        await refused(`a${level === "upload" ? "n" : ""} ${level} key`, await call(apiRoute, await keyFor(world.victimAccountId, { accessLevel: level, gameSlugs: null }), asDeveloper), "key_not_allowed");
      }
      const choices: readonly string[] = AREA_ACCESS_CHOICES[area];
      for (const choice of choices.slice(0, choices.indexOf(apiRoute.choice))) {
        const areaAccess = { ...AREA_ACCESS_BY_LEVEL.full, [area]: choice } as AreaAccess;
        await refused(`a custom key with ${area} ${choice}`, await call(apiRoute, await keyFor(world.victimAccountId, { accessLevel: "custom", areaAccess, gameSlugs: null }), asDeveloper), "key_not_allowed");
      }
    }

    // A call that reads more areas (an export) needs each: a custom key one choice short in any of them is refused.
    for (const more of apiRoute.alsoNeeds) {
      const choices: readonly string[] = AREA_ACCESS_CHOICES[more.area];
      for (const choice of choices.slice(0, choices.indexOf(more.choice))) {
        const areaAccess = { ...AREA_ACCESS_BY_LEVEL.full, [more.area]: choice } as AreaAccess;
        await refused(`a custom key with ${more.area} ${choice}`, await call(apiRoute, await keyFor(world.victimAccountId, { accessLevel: "custom", areaAccess, gameSlugs: null }), asDeveloper), "key_not_allowed");
      }
    }

    // A call that shows where the account is used from takes only a full key for every game.
    if (apiRoute.isFullKeyOnly) {
      for (const level of ["read", "upload", "publish"] as const) {
        await refused(`a${level === "upload" ? "n" : ""} ${level} key`, await call(apiRoute, await keyFor(world.victimAccountId, { accessLevel: level, gameSlugs: null }), asDeveloper), "key_not_allowed");
      }
      await refused("a full key for one game", await call(apiRoute, await keyFor(world.victimAccountId, { accessLevel: "full", gameSlugs: [world.values.slug!] }), asDeveloper), "key_not_allowed");
    }

    // A key for the developer's other game.
    const limitedKey = () => keyFor(world.victimAccountId, { accessLevel: "custom", areaAccess: { ...AREA_ACCESS_BY_LEVEL.full, sign_in_app_access: "none", webhook_access: "none" }, gameSlugs: [world.otherSlug] });
    const gameField = Object.entries(apiRoute.pathParts).find(([, pathPart]) => pathPart === "game")?.[0];
    if (gameField || apiRoute.isAccountWide || (apiRoute.area && ACCOUNT_AREAS.includes(apiRoute.area))) {
      await refused("a key for the developer's other game", await call(apiRoute, await limitedKey(), asDeveloper), "key_not_allowed", gameField && !apiRoute.isAccountWide && !(apiRoute.area && ACCOUNT_AREAS.includes(apiRoute.area)) ? gameField : undefined);
    }
    for (const [name, input] of Object.entries(allInputs(apiRoute))) {
      if (input.kind !== "names" || (input.what !== "game" && input.what !== "game_list") || gameField || (apiRoute.area && ACCOUNT_AREAS.includes(apiRoute.area))) continue;
      const named = NAMED[input.what](world);
      const limitedSample = name in apiRoute.query ? { ...asDeveloper, query: { ...asDeveloper.query, [name]: named as string } } : { ...asDeveloper, body: { ...asDeveloper.body, [name]: named } };
      await refused(`a key for the developer's other game naming this one in ${name}`, await call(apiRoute, await limitedKey(), limitedSample), "key_not_allowed", name);
    }

    // Each input that needs more than the call, from a key that has just what the call needs.
    for (const [name, input] of Object.entries(allInputs(apiRoute))) {
      if (input.kind !== "needs") continue;
      const choices: readonly string[] = AREA_ACCESS_CHOICES[input.area];
      const areaAccess = { ...AREA_ACCESS_BY_LEVEL.full, [input.area]: choices[choices.indexOf(input.choice) - 1] } as AreaAccess;
      expect(allows(areaAccess, apiRoute.area as AccessArea, apiRoute.choice), `${routeName}: a key short of ${name}'s access can't make the call at all`).toBe(true);
      const withInput = name in apiRoute.query ? { ...asDeveloper, query: { ...asDeveloper.query, [name]: "true" } } : { ...asDeveloper, body: { ...asDeveloper.body, [name]: true } };
      await refused(`a key without ${input.area} ${input.choice} sending ${name}`, await call(apiRoute, await keyFor(world.victimAccountId, { accessLevel: "custom", areaAccess, gameSlugs: null }), withInput), "key_not_allowed", name);
    }

    // An input the call doesn't declare, in the query and in a JSON body.
    const developerKey = await keyFor(world.victimAccountId);
    await refused("an input in the query it doesn't take", await call(apiRoute, developerKey, { ...asDeveloper, query: { ...asDeveloper.query, not_an_input: "1" } }), "unknown_field", "not_an_input");
    if (apiRoute.body && apiRoute.body !== "bytes") await refused("an input in the body it doesn't take", await call(apiRoute, developerKey, { ...asDeveloper, body: { ...asDeveloper.body, not_an_input: 1 } }), "unknown_field", "not_an_input");

    // And the developer, with a full key, gets through.
    const eventCount = async () => (await env.DB.prepare(`SELECT COUNT(*) AS event_count FROM security_events WHERE account_id = ? AND kind NOT IN (${KEY_USE_EVENT_KINDS.map((kind) => `'${kind}'`).join(", ")})`).bind(world.victimAccountId).first<{ event_count: number }>())!.event_count;
    const eventCountBefore = await eventCount();
    // Cancelling and resuming need Zaisma Pro, paid on Stripe (a stand-in here), and resuming needs it cancelled.
    if (routeName === "POST /pro/cancel" || routeName === "POST /pro/resume") {
      await env.DB.prepare("UPDATE owners SET pro_until_ms = ?, stripe_subscription_id = 'sub_test', is_pro_cancelled = ? WHERE id = ?").bind(Date.now() + 86_400_000, routeName === "POST /pro/resume" ? 1 : 0, world.victimOwnerId).run();
    }
    const made = await call(apiRoute, developerKey, asDeveloper);
    expect(made.httpStatus, `The developer's own ${routeName} with a full key: ${made.answerText.slice(0, 400)}`).toBeLessThan(300);
    // A call that changes something says so in the security log; no other call writes to it.
    expect((await eventCount()) - eventCountBefore, isLogged(apiRoute) ? `${routeName} changed something and wrote no security event: log it with logCallerEvent, or add it to UNLOGGED_CHANGES with why.` : `${routeName} wrote a security event it shouldn't`).toBe(isLogged(apiRoute) ? 1 : 0);
    // A call that reaches or names something of the developer's refused someone.
    if (ownsSomething(apiRoute) || Object.values(allInputs(apiRoute)).some((input) => input.kind === "names")) expect(refusals.length, routeName).toBeGreaterThan(0);
    // A shader check that went through drew in the stand-in.
    if (routeName === "POST /games/:slug/shader-checks") expect(drawings.count).toBe(1);
  });
});

/** The developer's values for the parts that own something (their game, webhook, sign-in app, private topic), over an example's own. */
function pickOwning(apiRoute: ApiRoute, values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(apiRoute.pathParts).filter(([, pathPart]) => OWNING_PARTS.includes(pathPart)).map(([name]) => [name, values[name]!]));
}
