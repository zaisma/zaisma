import { newId } from "./ids.ts";

/**
 * Webhooks for developers (docs/DECISIONS.md, "Webhooks follow Standard Webhooks"): addresses a
 * developer sets, the events each takes, and every event on its way to one. Signed the way Standard
 * Webhooks (standardwebhooks.com) says, so its libraries check them in one call. What goes in an event
 * is the site's (apps/site/src/webhooks.ts); this is storing, signing and sending.
 */

const now = () => Date.now();

/**
 * The events a webhook can take:
 * - bug_reported: report triage sorted a player's report as a bug, the same ones get_reports lists;
 * - scan_status_changed: a version's scan finished, or Zaisma changed its scan_status later (a person
 *   approved or rejected it, a report paused it, image matching held it);
 * - live_version_changed: players get another version: published, rolled back, published at its set
 *   time, or put back while a report is checked;
 * - review_status_changed: Zaisma held or took down a game, or put it back;
 * - game_server_error_found: a new distinct error in the game's own game server (a handler threw or
 *   didn't start, or a call ran on too long), once per error per version;
 * - alert_raised: one of the game's alerts about its free use appeared (80% used, or used and
 *   paused), at most once a month per kind;
 * - account_deleted: a player who played the game, or signed in to the app, deleted their Zaisma
 *   account: player_id, and game or sign_in_app;
 * - security_alert: one of the developer's own security alerts (a sign-in from a new network, a key made or
 *   used from a new place, …): security_event, as get_activity lists it. About the account, so it reaches only
 *   webhooks for every game at an endpoint_url, like account_deleted for a sign-in app.
 */
export const WEBHOOK_EVENT_KINDS = ["bug_reported", "player_reported", "scan_status_changed", "live_version_changed", "review_status_changed", "game_server_error_found", "alert_raised", "account_deleted", "security_alert"] as const;
export type WebhookEventKind = (typeof WEBHOOK_EVENT_KINDS)[number];

/** game_server_error_found events per game per UTC day; past it, errors still show in get_stats. */
export const MAXIMUM_ERROR_EVENT_COUNT_PER_DAY = 20;

/** The alert kinds alert_raised is sent for, and the only values alert_notices.alert_kind holds. */
export const FREE_USE_ALERT_KINDS = [
  "rooms_nearly_paused",
  "rooms_paused",
  "requests_nearly_paused",
  "requests_paused",
  "database_nearly_paused",
  "database_paused",
  "database_writes_nearly_paused",
  "database_writes_paused",
  "database_nearly_full",
  "database_full",
] as const;
export type FreeUseAlertKind = (typeof FREE_USE_ALERT_KINDS)[number];
/** What test_webhook sends: no webhook takes it otherwise, so it's not in the list above. */
export const TEST_EVENT_KIND = "test";

/**
 * Where a webhook sends its events: endpoint_url, an https address the developer's server takes them
 * at, signed; or game_server, the game's own game server on Zaisma, whose onWebhook gets them
 * (docs/DECISIONS.md, "Webhooks to the game server"). A game server's webhook takes only its own
 * game's events: its game_slugs is that one slug.
 */
export const WEBHOOK_DESTINATION_KINDS = ["endpoint_url", "game_server"] as const;
export type WebhookDestinationKind = (typeof WEBHOOK_DESTINATION_KINDS)[number];

export const MAXIMUM_WEBHOOK_COUNT = 10;
/** How long an endpoint has to answer each try. */
export const WEBHOOK_TIMEOUT_SEC = 10;
/** The wait before each try after the first: 6 tries over about a day and a half. */
export const WEBHOOK_RETRY_DELAYS_MIN = [5, 30, 120, 480, 1440] as const;
export const MAXIMUM_WEBHOOK_ATTEMPT_COUNT = 1 + WEBHOOK_RETRY_DELAYS_MIN.length;
export const WEBHOOK_DELIVERY_KEPT_DURATION_DAYS = 30;
/** How long a try holds a delivery, so the cron and a send straight after the event never both send it. */
const CLAIM_DURATION_MS = 2 * 60_000;

export interface Webhook {
  id: string;
  owner_id: string;
  destination_kind: WebhookDestinationKind;
  /** Null when destination_kind is game_server. */
  endpoint_url: string | null;
  /** A JSON list of WebhookEventKind. */
  event_kinds: string;
  /** A JSON list of the owner's game slugs, or null for every game they have and will make. */
  game_slugs: string | null;
  signing_secret: string;
  created_at_ms: number;
  updated_at_ms: number;
}

export type DeliveryStatus = "pending" | "delivered" | "failed";

export interface WebhookDelivery {
  webhook_id: string;
  webhook_event_id: string;
  owner_id: string;
  /** The body exactly as sent, so every try signs the same bytes. */
  event_json: string;
  delivery_status: DeliveryStatus;
  attempt_count: number;
  next_attempt_at_ms: number | null;
  last_attempt_at_ms: number | null;
  last_http_status_code: number | null;
  failure_message: string | null;
  created_at_ms: number;
}

export const eventKindsOf = (webhook: { event_kinds: string }): WebhookEventKind[] => JSON.parse(webhook.event_kinds) as WebhookEventKind[];
export const gameSlugsOf = (webhook: { game_slugs: string | null }): string[] | null => (webhook.game_slugs ? (JSON.parse(webhook.game_slugs) as string[]) : null);

/**
 * An endpoint URL, checked and in its standard form, or why it can't be one: https on a name (no IP
 * addresses, no user name, no #fragment), and never Zaisma's own domains, so an event can't be sent
 * back at Zaisma. http://localhost only when isLocalAllowed (the local preview).
 */
export function checkEndpointUrl(given: unknown, blockedDomains: string[], isLocalAllowed = false): { endpointUrl: string } | { error: string } {
  if (typeof given !== "string" || !given || given.length > 500) return { error: "endpoint_url is text of up to 500 characters." };
  let url: URL;
  try {
    url = new URL(given);
  } catch {
    return { error: `${JSON.stringify(given)} isn't a whole URL.` };
  }
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (isLocal && isLocalAllowed && (url.protocol === "http:" || url.protocol === "https:")) return { endpointUrl: url.href };
  if (url.protocol !== "https:") return { error: `${given} isn't https.` };
  if (url.username || url.password) return { error: `${given} has a user name or password in it.` };
  if (url.hash || given.includes("#")) return { error: `${given} has a #fragment, which is never sent.` };
  if (isLocal || /^[\d.]+$/.test(url.hostname) || url.hostname.startsWith("[")) return { error: `${given} is an IP address or this computer; give your server's name, like https://hooks.skyhopper.io/zaisma.` };
  if (!url.hostname.includes(".")) return { error: `${given} isn't a name on the internet.` };
  const blocked = blockedDomains.find((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  if (blocked) return { error: `${given} is on ${blocked}, Zaisma's own domain.` };
  return { endpointUrl: url.href };
}

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** A new signing secret in Standard Webhooks' form: whsec_ and 24 random bytes in base64. */
export const newSigningSecret = () => `whsec_${base64(crypto.getRandomValues(new Uint8Array(24)))}`;

/**
 * The webhook-signature header for a body: "v1," and the base64 HMAC-SHA256 of
 * "<webhook-id>.<webhook-timestamp>.<body>", keyed by the secret's bytes (Standard Webhooks).
 */
export async function signatureFor(signingSecret: string, webhookEventId: string, timestampSec: number, body: string): Promise<string> {
  const secretBytes = Uint8Array.from(atob(signingSecret.replace(/^whsec_/, "")), (character) => character.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${webhookEventId}.${timestampSec}.${body}`));
  return `v1,${base64(new Uint8Array(signature))}`;
}

// --- Webhooks ------------------------------------------------------------------

export async function webhooksFor(database: D1Database, ownerId: string): Promise<Webhook[]> {
  const { results } = await database.prepare("SELECT * FROM webhooks WHERE owner_id = ? ORDER BY created_at_ms").bind(ownerId).all<Webhook>();
  return results;
}

export async function webhookById(database: D1Database, id: string): Promise<Webhook | null> {
  return database.prepare("SELECT * FROM webhooks WHERE id = ?").bind(id).first<Webhook>();
}

export async function createWebhook(
  database: D1Database,
  input: { ownerId: string; destinationKind: WebhookDestinationKind; endpointUrl: string | null; eventKinds: WebhookEventKind[]; gameSlugs: string[] | null },
): Promise<Webhook> {
  const createdAtMs = now();
  const webhook: Webhook = {
    id: newId("webhook"),
    owner_id: input.ownerId,
    destination_kind: input.destinationKind,
    endpoint_url: input.endpointUrl,
    event_kinds: JSON.stringify(input.eventKinds),
    game_slugs: input.gameSlugs ? JSON.stringify(input.gameSlugs) : null,
    signing_secret: newSigningSecret(),
    created_at_ms: createdAtMs,
    updated_at_ms: createdAtMs,
  };
  await database
    .prepare("INSERT INTO webhooks (id, owner_id, destination_kind, endpoint_url, event_kinds, game_slugs, signing_secret, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(webhook.id, webhook.owner_id, webhook.destination_kind, webhook.endpoint_url, webhook.event_kinds, webhook.game_slugs, webhook.signing_secret, webhook.created_at_ms, webhook.updated_at_ms)
    .run();
  return webhook;
}

/**
 * What an update changes; endpointUrl and gameSlugs can be null, so leaving one out is undefined.
 * The caller checks the result fits destinationKind. replaceSigningSecret asks for a new secret.
 */
export interface WebhookChange {
  destinationKind?: WebhookDestinationKind;
  endpointUrl?: string | null;
  eventKinds?: WebhookEventKind[];
  gameSlugs?: string[] | null;
  replaceSigningSecret?: boolean;
}

export async function updateWebhook(database: D1Database, webhook: Webhook, change: WebhookChange): Promise<Webhook> {
  const updated: Webhook = {
    ...webhook,
    destination_kind: change.destinationKind ?? webhook.destination_kind,
    endpoint_url: change.endpointUrl === undefined ? webhook.endpoint_url : change.endpointUrl,
    event_kinds: change.eventKinds ? JSON.stringify(change.eventKinds) : webhook.event_kinds,
    game_slugs: change.gameSlugs === undefined ? webhook.game_slugs : change.gameSlugs ? JSON.stringify(change.gameSlugs) : null,
    signing_secret: change.replaceSigningSecret ? newSigningSecret() : webhook.signing_secret,
    updated_at_ms: now(),
  };
  await database
    .prepare("UPDATE webhooks SET destination_kind = ?, endpoint_url = ?, event_kinds = ?, game_slugs = ?, signing_secret = ?, updated_at_ms = ? WHERE id = ?")
    .bind(updated.destination_kind, updated.endpoint_url, updated.event_kinds, updated.game_slugs, updated.signing_secret, updated.updated_at_ms, webhook.id)
    .run();
  return updated;
}

/** A webhook goes for good, with what was on its way to it. */
export async function deleteWebhook(database: D1Database, id: string): Promise<void> {
  await database.batch([database.prepare("DELETE FROM webhook_deliveries WHERE webhook_id = ?").bind(id), database.prepare("DELETE FROM webhooks WHERE id = ?").bind(id)]);
}

// --- Deliveries ----------------------------------------------------------------

/** The webhooks that take an event of this kind about this game. */
export function webhooksTaking(webhooks: Webhook[], kind: WebhookEventKind, gameSlug: string): Webhook[] {
  return webhooks.filter((webhook) => {
    const gameSlugs = gameSlugsOf(webhook);
    return eventKindsOf(webhook).includes(kind) && (!gameSlugs || gameSlugs.includes(gameSlug));
  });
}

/**
 * The webhooks that take an event of this kind about one of the owner's sign-in apps: only ones for
 * every game (game_slugs null) and at an endpoint_url. A webhook limited to games, or a game server,
 * is about games, never a site.
 */
export function webhooksTakingSignInAppEvent(webhooks: Webhook[], kind: WebhookEventKind): Webhook[] {
  return webhooks.filter((webhook) => eventKindsOf(webhook).includes(kind) && webhook.destination_kind === "endpoint_url" && webhook.game_slugs === null);
}

/** One event on its way to one webhook, due now. */
export async function queueDelivery(database: D1Database, webhook: Webhook, webhookEventId: string, eventJson: string): Promise<WebhookDelivery> {
  const createdAtMs = now();
  const delivery: WebhookDelivery = {
    webhook_id: webhook.id,
    webhook_event_id: webhookEventId,
    owner_id: webhook.owner_id,
    event_json: eventJson,
    delivery_status: "pending",
    attempt_count: 0,
    next_attempt_at_ms: createdAtMs,
    last_attempt_at_ms: null,
    last_http_status_code: null,
    failure_message: null,
    created_at_ms: createdAtMs,
  };
  await database
    .prepare("INSERT INTO webhook_deliveries (webhook_id, webhook_event_id, owner_id, event_json, delivery_status, attempt_count, next_attempt_at_ms, created_at_ms) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)")
    .bind(delivery.webhook_id, delivery.webhook_event_id, delivery.owner_id, delivery.event_json, delivery.next_attempt_at_ms, delivery.created_at_ms)
    .run();
  return delivery;
}

/** Pending deliveries whose next try is due, oldest first. */
export async function dueDeliveries(database: D1Database, maximumDeliveryCount: number, nowMs = now()): Promise<WebhookDelivery[]> {
  const { results } = await database
    .prepare("SELECT * FROM webhook_deliveries WHERE delivery_status = 'pending' AND next_attempt_at_ms <= ? ORDER BY next_attempt_at_ms LIMIT ?")
    .bind(nowMs, maximumDeliveryCount)
    .all<WebhookDelivery>();
  return results;
}

/** A webhook's deliveries, newest first, made before beforeMs when it's given (for paging). */
export async function deliveriesFor(database: D1Database, webhookId: string, maximumDeliveryCount: number, beforeMs: number | null): Promise<WebhookDelivery[]> {
  const { results } = await database
    .prepare("SELECT * FROM webhook_deliveries WHERE webhook_id = ? AND created_at_ms < ? ORDER BY created_at_ms DESC, webhook_event_id DESC LIMIT ?")
    .bind(webhookId, beforeMs ?? Number.MAX_SAFE_INTEGER, maximumDeliveryCount)
    .all<WebhookDelivery>();
  return results;
}

/** How many of each webhook's deliveries (of the last 30 days) are still being tried, and how many failed. */
export async function deliveryCountsFor(database: D1Database, ownerId: string): Promise<Map<string, { pendingCount: number; failedCount: number }>> {
  const { results } = await database
    .prepare("SELECT webhook_id, SUM(delivery_status = 'pending') AS pending_count, SUM(delivery_status = 'failed') AS failed_count FROM webhook_deliveries WHERE owner_id = ? GROUP BY webhook_id")
    .bind(ownerId)
    .all<{ webhook_id: string; pending_count: number; failed_count: number }>();
  return new Map(results.map((row) => [row.webhook_id, { pendingCount: row.pending_count, failedCount: row.failed_count }]));
}

export async function deleteOldDeliveries(database: D1Database, nowMs = now()): Promise<void> {
  const keptSinceMs = nowMs - WEBHOOK_DELIVERY_KEPT_DURATION_DAYS * 86_400_000;
  await database.batch([
    database.prepare("DELETE FROM webhook_deliveries WHERE created_at_ms < ?").bind(keptSinceMs),
    database.prepare("DELETE FROM player_erases WHERE erase_status = 'failed' AND created_at_ms < ?").bind(keptSinceMs),
    database.prepare("DELETE FROM player_erases WHERE erase_status = 'erased' AND erased_at_ms < ?").bind(nowMs - ERASED_PLAYER_KEPT_DURATION_DAYS * 86_400_000),
  ]);
}

// --- Erasing deleted players ---------------------------------------------------

/**
 * Erasing a player who deleted their account from one game's database (docs/DECISIONS.md, "Deleting an
 * account reaches developers"), tried again on the webhook schedule while the database doesn't answer.
 * One that failed every try stays 30 days as the game's player_erase_failed alert. Once a player is
 * erased (this way, by erase_player or by a game server), the row stays erased for
 * ERASED_PLAYER_KEPT_DURATION_DAYS, so restoring the database to a time before erases them again.
 */
export interface PlayerErase {
  game_id: string;
  player_id: string;
  erase_status: "pending" | "failed" | "erased";
  attempt_count: number;
  next_attempt_at_ms: number;
  failure_message: string | null;
  created_at_ms: number;
  erased_at_ms: number | null;
}

/** A day past the 30 a restore or its undo reaches back. */
const ERASED_PLAYER_KEPT_DURATION_DAYS = 31;

/** Queues an erase; a player erased before is queued again. */
export async function queuePlayerErase(database: D1Database, gameId: string, playerId: string, nowMs = now()): Promise<void> {
  await database
    .prepare(
      "INSERT INTO player_erases (game_id, player_id, erase_status, attempt_count, next_attempt_at_ms, created_at_ms) VALUES (?, ?, 'pending', 0, ?, ?) ON CONFLICT (game_id, player_id) DO UPDATE SET erase_status = 'pending', attempt_count = 0, next_attempt_at_ms = excluded.next_attempt_at_ms, failure_message = NULL WHERE player_erases.erase_status = 'erased'",
    )
    .bind(gameId, playerId, nowMs, nowMs)
    .run();
}

/** A player erased from a game's database, by any way: kept so a restore to a time before erases them again. */
export async function recordPlayerErased(database: D1Database, gameId: string, playerId: string, nowMs = now()): Promise<void> {
  await database
    .prepare(
      "INSERT INTO player_erases (game_id, player_id, erase_status, attempt_count, next_attempt_at_ms, created_at_ms, erased_at_ms) VALUES (?, ?, 'erased', 0, ?, ?, ?) ON CONFLICT (game_id, player_id) DO UPDATE SET erase_status = 'erased', erased_at_ms = excluded.erased_at_ms, failure_message = NULL",
    )
    .bind(gameId, playerId, nowMs, nowMs, nowMs)
    .run();
}

/** The players erased from a game's database since a moment: the ones a restore to it would bring back. */
export async function playersErasedSince(database: D1Database, gameId: string, sinceMs: number): Promise<string[]> {
  const { results } = await database.prepare("SELECT player_id FROM player_erases WHERE game_id = ? AND erase_status = 'erased' AND erased_at_ms >= ?").bind(gameId, sinceMs).all<{ player_id: string }>();
  return results.map((row) => row.player_id);
}

/** Pending erases whose next try is due, oldest first. */
export async function duePlayerErases(database: D1Database, maximumCount: number, nowMs = now()): Promise<PlayerErase[]> {
  const { results } = await database
    .prepare("SELECT * FROM player_erases WHERE erase_status = 'pending' AND next_attempt_at_ms <= ? ORDER BY next_attempt_at_ms LIMIT ?")
    .bind(nowMs, maximumCount)
    .all<PlayerErase>();
  return results;
}

/** How a try went: null failureMessage means it worked and the player is erased; otherwise the next try waits, or after the last it has failed. */
export async function recordPlayerEraseAttempt(database: D1Database, erase: PlayerErase, failureMessage: string | null, nowMs = now()): Promise<void> {
  if (failureMessage === null) {
    await recordPlayerErased(database, erase.game_id, erase.player_id, nowMs);
    return;
  }
  const attemptCount = erase.attempt_count + 1;
  const isFailed = attemptCount >= MAXIMUM_WEBHOOK_ATTEMPT_COUNT;
  await database
    .prepare("UPDATE player_erases SET erase_status = ?, attempt_count = ?, next_attempt_at_ms = ?, failure_message = ? WHERE game_id = ? AND player_id = ?")
    .bind(isFailed ? "failed" : "pending", attemptCount, isFailed ? nowMs : nowMs + WEBHOOK_RETRY_DELAYS_MIN[attemptCount - 1]! * 60_000, failureMessage.slice(0, 300), erase.game_id, erase.player_id)
    .run();
}

/** The erases that failed every try, for these games, newest first. */
export async function failedPlayerErases(database: D1Database, gameIds: string[]): Promise<PlayerErase[]> {
  if (!gameIds.length) return [];
  const { results } = await database
    .prepare(`SELECT * FROM player_erases WHERE erase_status = 'failed' AND game_id IN (${gameIds.map(() => "?").join(", ")}) ORDER BY created_at_ms DESC`)
    .bind(...gameIds)
    .all<PlayerErase>();
  return results;
}

/**
 * Hands an event to a webhook's game server (destination_kind game_server) and says how it went: null
 * when onWebhook finished without an error, else why not. The site's goes to the rooms Worker.
 */
export type SendToGameServer = (webhook: Webhook, eventJson: string) => Promise<{ failureMessage: string | null }>;

/**
 * One try at a delivery: claims it first, so only one sender tries it at a time, then sends it and
 * records how it went. To an endpoint_url it's a signed POST, with no redirects followed, and a 2xx
 * answer delivers it; to a game server, sendToGameServer runs its onWebhook, and finishing without an
 * error delivers it. Anything else waits for the next try, and after the last one the delivery has
 * failed; isOnlyAttempt (a test event) makes this try the last. Answers the delivery as it is now, or
 * null when someone else is trying it (or it's no longer pending).
 */
export async function attemptDelivery(
  database: D1Database,
  webhook: Webhook,
  due: { webhook_id: string; webhook_event_id: string },
  options: { send?: typeof fetch; sendToGameServer?: SendToGameServer; isOnlyAttempt?: boolean } = {},
): Promise<WebhookDelivery | null> {
  const attemptAtMs = now();
  const delivery = await database
    .prepare("UPDATE webhook_deliveries SET next_attempt_at_ms = ? WHERE webhook_id = ? AND webhook_event_id = ? AND delivery_status = 'pending' AND next_attempt_at_ms <= ? RETURNING *")
    .bind(attemptAtMs + CLAIM_DURATION_MS, due.webhook_id, due.webhook_event_id, attemptAtMs)
    .first<WebhookDelivery>();
  if (!delivery) return null;

  const { httpStatusCode, failureMessage } =
    webhook.destination_kind === "game_server" || webhook.endpoint_url === null
      ? { httpStatusCode: null, failureMessage: await tryGameServer(webhook, delivery, options.sendToGameServer) }
      : await tryEndpoint(webhook.endpoint_url, webhook.signing_secret, delivery, attemptAtMs, options.send ?? fetch);

  const attemptCount = delivery.attempt_count + 1;
  const deliveryStatus: DeliveryStatus = failureMessage === null ? "delivered" : options.isOnlyAttempt || attemptCount >= MAXIMUM_WEBHOOK_ATTEMPT_COUNT ? "failed" : "pending";
  const nextAttemptAtMs = deliveryStatus === "pending" ? attemptAtMs + WEBHOOK_RETRY_DELAYS_MIN[attemptCount - 1]! * 60_000 : null;
  const updated: WebhookDelivery = {
    ...delivery,
    delivery_status: deliveryStatus,
    attempt_count: attemptCount,
    next_attempt_at_ms: nextAttemptAtMs,
    last_attempt_at_ms: attemptAtMs,
    last_http_status_code: httpStatusCode,
    failure_message: failureMessage,
  };
  await database
    .prepare("UPDATE webhook_deliveries SET delivery_status = ?, attempt_count = ?, next_attempt_at_ms = ?, last_attempt_at_ms = ?, last_http_status_code = ?, failure_message = ? WHERE webhook_id = ? AND webhook_event_id = ?")
    .bind(updated.delivery_status, updated.attempt_count, updated.next_attempt_at_ms, updated.last_attempt_at_ms, updated.last_http_status_code, updated.failure_message, delivery.webhook_id, delivery.webhook_event_id)
    .run();
  return updated;
}

/** One signed POST to an endpoint: its HTTP status, and why it didn't count as delivered (null when it did). */
async function tryEndpoint(endpointUrl: string, signingSecret: string, delivery: WebhookDelivery, attemptAtMs: number, send: typeof fetch): Promise<{ httpStatusCode: number | null; failureMessage: string | null }> {
  const timestampSec = Math.floor(attemptAtMs / 1000);
  let httpStatusCode: number | null = null;
  let failureMessage: string | null = null;
  try {
    const response = await send(endpointUrl, {
      method: "POST",
      body: delivery.event_json,
      redirect: "manual",
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_SEC * 1000),
      headers: {
        "content-type": "application/json",
        "user-agent": "Zaisma-Webhooks/1",
        "webhook-id": delivery.webhook_event_id,
        "webhook-timestamp": String(timestampSec),
        "webhook-signature": await signatureFor(signingSecret, delivery.webhook_event_id, timestampSec, delivery.event_json),
      },
    });
    await response.body?.cancel();
    httpStatusCode = response.status;
    if (response.status >= 300 && response.status < 400) failureMessage = `Answered ${response.status}, a redirect: webhooks don't follow redirects, so set endpoint_url to the address it points to.`;
    else if (response.status < 200 || response.status >= 300) failureMessage = `Answered ${response.status}; only a 2xx answer counts as delivered.`;
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    failureMessage = name === "TimeoutError" || name === "AbortError" ? `Didn't answer within ${WEBHOOK_TIMEOUT_SEC} seconds.` : `Couldn't reach it: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300);
  }
  return { httpStatusCode, failureMessage };
}

/** One try at handing an event to the game's own game server: why it didn't count as delivered, or null. Never throws. */
async function tryGameServer(webhook: Webhook, delivery: WebhookDelivery, sendToGameServer: SendToGameServer | undefined): Promise<string | null> {
  if (!sendToGameServer) return "This Zaisma has no game servers connected, so events can't reach one.";
  try {
    const { failureMessage } = await sendToGameServer(webhook, delivery.event_json);
    return failureMessage === null ? null : failureMessage.slice(0, 300);
  } catch (error) {
    return `Couldn't reach the game server: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300);
  }
}
