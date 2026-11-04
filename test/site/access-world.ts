import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { expect } from "vitest";
import {
  accountById,
  addCreditEntry,
  addDatabaseRestore,
  addImage,
  addPasskey,
  addShader,
  addTesterLink,
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
  manifestKey,
  newId,
  ownedBlobKey,
  personOwner,
  saveCopyKey,
  saveFromParts,
  saveHash,
  saveKey,
  settleShader,
  sha256Hex,
  shaderKey,
  type KeyScope,
  gameBySlug,
  startGameDeletionWait,
} from "@zaisma/core";
import type { ApiRoute } from "../../apps/site/src/developer.ts";
import { letPublish } from "../helpers.ts";

/**
 * One developer's things and a stranger's, and a call each API route takes, for the tests that try who gets through:
 * test/site/access-checks.test.ts and the contract test grid (test/grid/).
 */

/** The site's Worker as a file loaded it, so a call runs with that file's stand-ins. */
export interface SiteWorker {
  fetch: (request: Request, workerEnv: typeof env, context: ExecutionContext) => Promise<Response> | Response;
}

export const SITE = "https://zaisma.test";
export const HOOKS_HOST = "hooks.example.test";

/** One call to make: values for its path parts, and its query and body (JSON, or bytes). */
export interface Sample {
  pathValues?: Record<string, string>;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  bytes?: Uint8Array;
}

/** One developer's things, and a stranger's, made fresh for each call so no test sees another's. */
export interface World {
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
export const png = (widthPx: number, heightPx: number) => {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, widthPx);
  new DataView(bytes.buffer).setUint32(20, heightPx);
  return bytes;
};
export const text = (given: string) => new TextEncoder().encode(given);

/**
 * A call each route takes from the developer, as it goes through with a full key. The stranger and the
 * weaker keys send the same, so a refusal can only be the router's.
 */
export const SAMPLES: Record<string, (world: World) => Sample> = {
  "GET /access": () => ({}),
  "GET /playing-now": () => ({}),
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
  "POST /games/:slug/versions/:version_id/ai-review": () => ({}),
  "GET /storage": () => ({}),
  "PATCH /storage": () => ({ body: { monthly_storage_budget_cents: null } }),
  "DELETE /games/:slug": (world) => ({ body: { confirm_slug: world.values.slug } }),
  "POST /games/:slug/bring-back": () => ({}),
  "POST /games/:slug/erase-now": (world) => ({ body: { confirm_slug: world.values.slug } }),
  "GET /games/:slug/deletion-requests/:game_deletion_request_id": () => ({}),
  "DELETE /games/:slug/versions/:version_id": () => ({}),
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
  "PUT /games/:slug/items/:item_name": () => ({ body: { title: "Revive", description: "", item_kind: "consumable", item_category: "gameplay", price_minor_units: 149, currency_code: "usd", local_prices: [], is_on_game_page: false } }),
  // An item nobody owns: one players own stays (item_has_owners).
  "DELETE /games/:slug/items/:item_name": () => ({ pathValues: { item_name: "spare_cape" } }),
  "PATCH /games/:slug/purchase-settings": () => ({ body: { refund_policy: "within_14_days" } }),
  "GET /games/:slug/purchases": () => ({ query: { purchase_source: "grant" } }),
  "POST /games/:slug/purchases": (world) => ({ body: { player_id: world.values.player_id, item_name: "revive", item_count: 2 } }),
  "GET /games/:slug/purchases/:purchase_id": () => ({}),
  "POST /games/:slug/purchases/:purchase_id/refund": () => ({}),
  "POST /games/:slug/purchases/:purchase_id/handled": () => ({}),
  "GET /games/:slug/players/:player_id/items": () => ({}),
  "DELETE /games/:slug/kept-rooms/:room_code": () => ({}),
  "POST /games/:slug/kept-rooms/:room_code/bring-back": () => ({}),
  "POST /games/:slug/kept-rooms/:room_code/erase-now": () => ({}),
  "GET /games/:slug/rooms": () => ({ query: { labels: '[{"label_name":"Region","label_value":"North"}]' } }),
  "GET /games/:slug/rooms/:room_code": () => ({}),
  "POST /games/:slug/rooms/:room_code/messages": () => ({ body: { message: { kind: "freeze" } } }),
  "POST /games/:slug/rooms/:room_code/kick": (world) => ({ body: { player_id: world.values.player_id, message: "Removed for griefing." } }),
  "POST /games/:slug/rooms/:room_code/end": () => ({ body: { message: "Closing for maintenance.", confirm: true } }),
  "POST /games/:slug/room-messages": () => ({ body: { message: { kind: "blood_moon" }, send_at: new Date(Date.now() + 3_600_000).toISOString() } }),
  "GET /games/:slug/room-messages": () => ({}),
  "DELETE /games/:slug/room-messages/:scheduled_room_message_id": () => ({}),
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
  "GET /spending-requests/:spending_request_id": () => ({}),
  "POST /pro/checkout": () => ({}),
  "POST /pro/cancel": () => ({}),
  "POST /pro/resume": () => ({}),
  "POST /pro/refund": () => ({}),
  "POST /credit/refunds": (world) => ({ body: { top_up_id: world.values.top_up_id } }),
  "POST /credit/plan/checkout": () => ({ body: { refill_level_cents: 4000 } }),
  "PATCH /credit/plan": () => ({ body: { refill_level_cents: 3000 } }),
  "POST /credit/plan/stop": () => ({}),
  "GET /stripe-account": () => ({}),
  "POST /stripe-account/connection-links": () => ({}),
  "PATCH /stripe-account": () => ({ body: { is_stripe_tax_used: true } }),
  "DELETE /stripe-account": () => ({}),
  "GET /webhooks": () => ({}),
  "POST /webhooks": (world) => ({ body: { endpoint_url: `https://${HOOKS_HOST}/two`, event_kinds: ["bug_reported"], game_slugs: [world.values.slug] } }),
  "PATCH /webhooks/:webhook_id": (world) => ({ body: { game_slugs: [world.values.slug] } }),
  "DELETE /webhooks/:webhook_id": () => ({}),
  "POST /webhooks/:webhook_id/test": () => ({}),
  "GET /webhooks/:webhook_id/deliveries": () => ({}),
};

/** Events a key's use writes even when the router refuses its call (like last_used_at_ms). */
export const KEY_USE_EVENT_KINDS = ["api_key_new_place", "ai_connected"];

export const nameOf = (apiRoute: Pick<ApiRoute, "method" | "path">) => `${apiRoute.method} ${apiRoute.path}`;

let worldCount = 0;
const realFetch = globalThis.fetch;
/** What a stand-in for Stripe answers each call that reaches it. */
export const STRIPE_ANSWERS: Record<string, Record<string, unknown>> = {
  "/v1/customers": { id: "cus_test" },
  "/v1/checkout/sessions": { id: "cs_test", url: "https://checkout.stripe.com/c/pay/cs_test", expires_at: 1_900_000_000 },
  "/v1/refunds": { id: "re_test" },
  // Zaisma Pro's first payment, paid a minute ago: the one refund_pro refunds.
  "/v1/invoices": { data: [{ id: "in_test", amount_paid: 1000, status_transitions: { paid_at: Math.floor(Date.now() / 1000) - 60 }, parent: { subscription_details: { subscription: "sub_test" } }, payments: { data: [{ status: "paid", payment: { payment_intent: "pi_pro_test" } }] } }] },
};

export async function makeWorld(routeName = ""): Promise<World> {
  const n = ++worldCount;
  const accountIdOf = (name: string) => `${name}-${n}`;
  for (const [name, username] of [["victim", "Victim"], ["stranger", "Stranger"], ["helper", "Helper"], ["player", "Player"]] as const) {
    await createAccount(env.DB, { id: accountIdOf(name), username: `${username}_${n}`, ageBand: "18+" });
    await letPublish(env.DB, accountIdOf(name));
  }
  // A top-up keeps a card, so the developer's account has a passkey (an account with neither a passkey nor an email is refused).
  await addPasskey(env.DB, { id: `passkey-${n}`, account_id: accountIdOf("victim"), public_key: "key", algorithm_number: -7, sign_count: 0, name: "Phone" }, 0);
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
  const tester = await addTesterLink(env.DB, env, game.id, "Playtesters");
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
  await env.SAVES.put(saveKey(player!.id, game.id, 1, await saveHash(saveText)), saveText);
  const saveCopyId = newId("save_copy");
  const copyText = canonicalSave(saveFromParts({ coins: "1" }, []));
  await env.DB.prepare("INSERT INTO save_history (id, account_id, game_id, saved_at_ms, copy_reason, sha256, size_bytes) VALUES (?, ?, ?, ?, 'hourly', ?, ?)")
    .bind(saveCopyId, player!.id, game.id, nowMs - 60_000, await saveHash(copyText), copyText.length)
    .run();
  await env.SAVES.put(saveCopyKey(player!.id, game.id, saveCopyId), copyText);
  // A send to every room scheduled for later, to cancel.
  const scheduledRoomMessageId = newId("scheduled_room_message");
  await env.DB.prepare("INSERT INTO scheduled_room_messages (id, game_id, room_message_json, labels_json, send_at_ms, created_at_ms) VALUES (?, ?, '{\"kind\":\"blood_moon\"}', NULL, ?, ?)").bind(scheduledRoomMessageId, game.id, nowMs + 3_600_000, nowMs).run();
  // A restore of the game's database, to undo.
  const databaseRestoreId = newId("database_restore");
  await addDatabaseRestore(env.DB, { id: databaseRestoreId, game_id: game.id, restore_to_at_ms: nowMs - 60_000, undo_bookmark: "undo-access-checks", undoes_database_restore_id: null, restored_at_ms: nowMs });

  // A webhook and a sign-in app each.
  const { webhook } = await createWebhook(env.DB, env, { ownerId: victimOwner.id, destinationKind: "endpoint_url", endpointUrl: `https://${HOOKS_HOST}/zaisma`, eventKinds: ["bug_reported"], gameSlugs: null });
  const { webhook: strangerWebhook } = await createWebhook(env.DB, env, { ownerId: strangerOwner.id, destinationKind: "endpoint_url", endpointUrl: `https://${HOOKS_HOST}/moon`, eventKinds: ["bug_reported"], gameSlugs: null });
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
  // A running monthly credit plan, so changing and stopping it have one to reach; starting one needs none yet.
  if (routeName !== "POST /credit/plan/checkout") await env.DB.prepare("UPDATE owners SET credit_plan_subscription_id = ?, credit_plan_refill_level_cents = 4000, credit_plan_status = 'running', credit_plan_started_at_ms = ?, credit_plan_event_at_ms = ? WHERE id = ?").bind(`sub_plan_${n}`, nowMs, nowMs, victimOwner.id).run();
  const gameDeletionRequestId = newId("game_deletion_request");
  await env.DB.prepare("INSERT INTO game_deletion_requests (id, account_id, game_id, request_kind, created_at_ms, expires_at_ms) VALUES (?, ?, ?, 'delete_game', ?, ?)").bind(gameDeletionRequestId, accountIdOf("victim"), game.id, nowMs, nowMs + 86_400_000).run();
  const spendingRequestId = newId("spending_request");
  await env.DB.prepare("INSERT INTO spending_requests (id, account_id, request_kind, game_id, monthly_budget_cents, created_at_ms, expires_at_ms) VALUES (?, ?, 'game_budget', ?, 4000, ?, ?)").bind(spendingRequestId, accountIdOf("victim"), game.id, nowMs, nowMs + 86_400_000).run();

  return {
    n,
    victimAccountId: accountIdOf("victim"),
    victimOwnerId: victimOwner.id,
    strangerAccountId: accountIdOf("stranger"),
    values: {
      top_up_id: topUpId,
      spending_request_id: spendingRequestId,
      game_deletion_request_id: gameDeletionRequestId,
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
      scheduled_room_message_id: scheduledRoomMessageId,
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
export function privateValues(world: World): string[] {
  const { values } = world;
  return [world.victimAccountId, world.victimOwnerId, values.slug!, world.otherSlug, values.image_id!, values.shader_id!, values.version_id!, values.tester_id!, values.save_copy_id!, values.database_restore_id!, values.scheduled_room_message_id!, values.purchase_id!, values.topic_id!, values.post_id!, values.media_id!, values.webhook_id!, values.sign_in_app_id!, world.ownedSha256];
}

/** The same request with each of the developer's things swapped for one that doesn't exist, and how to swap them back in an answer. */
export function withNothingThere(world: World, sample: Required<Pick<Sample, "pathValues">> & Sample): { sample: typeof sample; swapBack: (answerText: string) => string } {
  const kinds: Record<string, Parameters<typeof newId>[0]> = { image_id: "image", shader_id: "shader", version_id: "version", tester_id: "tester", save_copy_id: "save_copy", database_restore_id: "database_restore", scheduled_room_message_id: "scheduled_room_message", purchase_id: "purchase", topic_id: "topic", post_id: "post", media_id: "media", webhook_id: "webhook", sign_in_app_id: "sign_in_app" };
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

export const makeCall = (worker: SiteWorker, workerEnv = env) => async function call(apiRoute: ApiRoute, key: string | null, sample: Sample & { pathValues: Record<string, string> }, moreHeaders: Record<string, string> = {}) {
  const path = apiRoute.path.replace(/:([a-z0-9_]+)/g, (_, name: string) => encodeURIComponent(sample.pathValues[name]!));
  const query = sample.query ? `?${new URLSearchParams(sample.query)}` : "";
  const isJson = sample.body !== undefined;
  // The site's own fetch, not SELF's, so it runs with this file's stand-in shader renderer.
  const context = createExecutionContext();
  const response = await worker.fetch(
    new Request(`${SITE}/api/dev${path}${query}`, {
      method: apiRoute.method,
      // Each call its own address, since rate limits are live and one file makes thousands.
      headers: { "cf-connecting-ip": `198.18.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`, ...moreHeaders, ...(key ? { authorization: `Bearer ${key}` } : {}), ...(isJson ? { "content-type": "application/json" } : {}), ...(sample.bytes ? { "content-length": String(sample.bytes.byteLength) } : {}) },
      body: sample.bytes ?? (isJson ? JSON.stringify(sample.body) : undefined),
    }),
    workerEnv,
    context,
  );
  // Bytes, then text: a served image is an answer too.
  const answerText = new TextDecoder().decode(await response.arrayBuffer());
  await waitOnExecutionContext(context);
  let answer: { error?: { code: string; field: string | null } } = {};
  try {
    answer = JSON.parse(answerText);
  } catch {}
  return { httpStatus: response.status, answerText, answer };
};

/** Everything a call could change: every table but API keys and places (a key's use), the security log but a key's use, both buckets, and the developer's games' own databases and secrets. */
export async function everything(world: World): Promise<string> {
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

/** The stand-in Stripe account a developer has connected, with the owner's ID after it (each is on one owner only). */
export const CONNECTED_ACCOUNT_ID = "acct_test_access";
/** Calls a key can't make alone: connecting Stripe decides where players' money goes, so it needs the owner's passkey on a page first. */
export const CONFIRMED_ON_A_PAGE = new Set(["POST /stripe-account/connection-links", "POST /games/:slug/erase-now", "POST /games/:slug/kept-rooms/:room_code/erase-now"]);

export const keyFor = async (accountId: string, scope?: KeyScope) => (await createApiKey(env.DB, accountId, `key ${Math.random()}`, scope)).token;

/** Stand-ins for the servers a call reaches: Stripe, and the developer's server for webhooks (a stand-in that says yes). */
export function useStandInServers(): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "api.stripe.com") return Response.json(STRIPE_ANSWERS[url.pathname] ?? {});
    if (url.hostname === "connect.stripe.com") return Response.json({ stripe_user_id: CONNECTED_ACCOUNT_ID });
    return url.hostname === HOOKS_HOST ? new Response("ok") : realFetch(input, init);
  }) as typeof fetch;
}

export const useRealServers = (): void => {
  globalThis.fetch = realFetch;
};

/** What a call needs in place first, for the developer's own: Zaisma Pro paid (and cancelled, to resume), a Stripe account connected. */
export async function setUpOwnersCall(routeName: string, world: World): Promise<void> {
  // Deleting a game nobody else played starts its week with a key; what comes after needs it waiting (test/site/game-deletion.test.ts has the rest).
  if (routeName === "DELETE /games/:slug" || routeName === "POST /games/:slug/bring-back" || routeName === "POST /games/:slug/erase-now") {
    const deletedGame = (await gameBySlug(env.DB, world.values.slug!))!;
    for (const table of ["purchases", "saves", "games_ever_played", "kept_rooms", "play_days"]) await env.DB.prepare(`DELETE FROM ${table} WHERE game_id = ?`).bind(deletedGame.id).run();
    if (routeName !== "DELETE /games/:slug") await startGameDeletionWait(env.DB, deletedGame.id);
  }
  // Bringing a kept room's world back or erasing it needs it waiting.
  if (routeName === "POST /games/:slug/kept-rooms/:room_code/bring-back" || routeName === "POST /games/:slug/kept-rooms/:room_code/erase-now") {
    await env.DB.prepare("UPDATE kept_rooms SET erases_at_ms = ? WHERE game_id = ? AND room_code = 'K7Q2MX'").bind(Date.now() + 86_400_000, (await gameBySlug(env.DB, world.values.slug!))!.id).run();
  }
  // Cancelling, resuming and refunding need Zaisma Pro, paid on Stripe (a stand-in here), and resuming needs it cancelled.
  if (routeName === "POST /pro/cancel" || routeName === "POST /pro/resume" || routeName === "POST /pro/refund") {
    await env.DB.prepare("UPDATE owners SET pro_until_ms = ?, stripe_subscription_id = 'sub_test', stripe_customer_id = 'cus_test', is_pro_cancelled = ? WHERE id = ?").bind(Date.now() + 30 * 86_400_000, routeName === "POST /pro/resume" ? 1 : 0, world.victimOwnerId).run();
  }
  // Changing or disconnecting a Stripe account needs one connected.
  if (routeName === "PATCH /stripe-account" || routeName === "DELETE /stripe-account") {
    await env.DB.prepare("UPDATE owners SET stripe_account_id = ?, can_take_stripe_payments = 1, stripe_connected_at_ms = ? WHERE id = ?").bind(`${CONNECTED_ACCOUNT_ID}_${world.victimOwnerId}`, Date.now(), world.victimOwnerId).run();
  }
}

/** Every world's rows, as a file leaves them. */
export async function clearWorlds(): Promise<void> {
  await env.DB.exec(
    "DELETE FROM scheduled_room_messages; DELETE FROM kept_rooms; DELETE FROM passkeys; DELETE FROM purchases; DELETE FROM game_items; DELETE FROM forum_media; DELETE FROM forum_follows; DELETE FROM forum_votes; DELETE FROM forum_post_ratings; DELETE FROM forum_bookmarks; DELETE FROM forum_reports; DELETE FROM forum_misplaced_flags; DELETE FROM forum_posts; DELETE FROM forum_topic_tags; DELETE FROM forum_topics; DELETE FROM webhook_deliveries; DELETE FROM webhooks; DELETE FROM sign_in_apps; DELETE FROM save_history; DELETE FROM saves; DELETE FROM tester_links; DELETE FROM game_backgrounds; DELETE FROM game_shaders; DELETE FROM game_images; DELETE FROM owned_blobs; DELETE FROM blobs; DELETE FROM api_keys; DELETE FROM security_events; DELETE FROM security_places; DELETE FROM audit_log; DELETE FROM versions; UPDATE games SET owner_id = NULL; DELETE FROM games; DELETE FROM credit_entries; DELETE FROM spending_requests; DELETE FROM owners; DELETE FROM accounts;",
  );
}
