/**
 * Webhooks to the game server: a webhook can send Zaisma's events about a game to that game's own
 * game server, whose onWebhook(event, server) turns them into whatever it likes, like a Discord post
 * or a GitHub issue made with the developer's own tokens from server.secrets (docs/DECISIONS.md,
 * "Webhooks to the game server"). Zaisma runs it in the game's own object (apps/rooms/src/game-server.ts)
 * for a webhook whose destination_kind is game_server. On the developer's own server the Node runner
 * (bin/node.js) takes the same event as a signed POST at /v1/webhooks, checks it here with the
 * webhook's whsec_ signing secret (Standard Webhooks, standardwebhooks.com) and runs the same
 * onWebhook, so the code moves unchanged.
 */

import type { Server } from "./requests.ts";

/**
 * What a webhook is sent, as the developer API's get_game, get_version and get_reports answer each
 * part (snake_case, like all the API's JSON). The same event comes on every try, with the same id.
 */
export interface WebhookEvent {
  /** A webhook_event_… ID, the same on every try, so a game server can skip one it already handled. */
  id: string;
  /** bug_reported, scan_status_changed, live_version_changed, review_status_changed, game_server_error_found, alert_raised, account_deleted, security_alert (only to your own server, never a game server on Zaisma), or test (test_webhook). */
  kind: string;
  /** When it happened, an ISO time in UTC. */
  happened_at: string;
  /** The game as get_game answers it; null for a test event, a security_alert, or an account_deleted event about a sign-in app. */
  game: Record<string, unknown> | null;
  /** The version as get_version answers it; null when the event isn't about one. */
  version: Record<string, unknown> | null;
  /** The bug report as get_reports lists it; null unless kind is bug_reported. */
  bug_report: Record<string, unknown> | null;
  /** The error as get_stats lists it; null unless kind is game_server_error_found. */
  game_server_error: Record<string, unknown> | null;
  /** The alert as the game's alerts list it; null unless kind is alert_raised. */
  alert: Record<string, unknown> | null;
  /** The player who deleted their Zaisma account; null unless kind is account_deleted. */
  player_id: string | null;
  /** The sign-in app as list_sign_in_apps answers it; null unless an account_deleted event is about a site, not a game. */
  sign_in_app: Record<string, unknown> | null;
  /** The developer's own account event as get_activity lists it; null unless kind is security_alert. */
  security_event: Record<string, unknown> | null;
}

export const WEBHOOK_LIMITS = {
  /** How long onWebhook may take, awaiting the database and outside calls included, before the try fails and waits for the next. */
  answerTimeoutSec: 10,
  /** The most of a webhook's POST the Node runner reads. */
  maximumEventSizeBytes: 1024 * 1024,
  /** How far a POST's webhook-timestamp may be from the server's clock, so an old one can't be sent again. */
  timestampToleranceSec: 300,
} as const;

/** A game server that takes webhooks. */
export interface WebhookHandler {
  onWebhook?(event: WebhookEvent, server: Server): unknown;
}

/**
 * Run a game server's onWebhook for one event, with a time limit. failure says why the try failed,
 * for the game server's errors: it threw, or took longer than WEBHOOK_LIMITS.answerTimeoutSec.
 */
export async function runWebhook(handler: WebhookHandler, event: WebhookEvent, server: Server): Promise<{ isDone: true } | { failure: string }> {
  if (typeof handler.onWebhook !== "function") return { failure: "This game server has no onWebhook" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(() => handler.onWebhook!(event, server)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`onWebhook didn't finish within ${WEBHOOK_LIMITS.answerTimeoutSec} seconds`)), WEBHOOK_LIMITS.answerTimeoutSec * 1000);
      }),
    ]);
    return { isDone: true };
  } catch (error) {
    return { failure: String((error instanceof Error && error.stack) || error) };
  } finally {
    clearTimeout(timer);
  }
}

/** The Standard Webhooks headers a signed POST comes with. */
export interface WebhookHeaders {
  webhookId: string | null;
  webhookTimestamp: string | null;
  webhookSignature: string | null;
}

const bytesOfBase64 = (text: string) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

/**
 * Check a webhook POST the Standard Webhooks way: its webhook-signature holds a "v1,<base64>" HMAC-SHA256
 * of "<webhook-id>.<webhook-timestamp>.<body>" keyed by the signing secret's bytes, and its timestamp is
 * within WEBHOOK_LIMITS.timestampToleranceSec of now. Answers the event, or why it isn't one to trust.
 */
export async function verifyWebhook(signingSecret: string, headers: WebhookHeaders, body: string, nowMs = Date.now()): Promise<{ event: WebhookEvent } | { failure: string }> {
  const { webhookId, webhookTimestamp, webhookSignature } = headers;
  if (!webhookId || !webhookTimestamp || !webhookSignature) return { failure: "It has no webhook-id, webhook-timestamp or webhook-signature header." };
  const timestampSec = Number(webhookTimestamp);
  if (!Number.isInteger(timestampSec) || Math.abs(nowMs / 1000 - timestampSec) > WEBHOOK_LIMITS.timestampToleranceSec) {
    return { failure: `Its webhook-timestamp isn't within ${WEBHOOK_LIMITS.timestampToleranceSec} seconds of this server's clock.` };
  }
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("raw", bytesOfBase64(signingSecret.replace(/^whsec_/, "")), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  } catch {
    return { failure: "The signing secret isn't a whsec_ secret from create_webhook." };
  }
  const signed = new TextEncoder().encode(`${webhookId}.${webhookTimestamp}.${body}`);
  let isSigned = false;
  // Several signatures, space-separated, while a secret is replaced; any one that matches will do.
  for (const part of webhookSignature.split(" ")) {
    const [version, signature] = part.split(",");
    if (version !== "v1" || !signature) continue;
    let signatureBytes;
    try {
      signatureBytes = bytesOfBase64(signature);
    } catch {
      continue;
    }
    // crypto.subtle.verify compares in constant time.
    if (await crypto.subtle.verify("HMAC", key, signatureBytes, signed)) {
      isSigned = true;
      break;
    }
  }
  if (!isSigned) return { failure: "Its webhook-signature doesn't match the signing secret." };
  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    return { failure: "Its body isn't JSON." };
  }
  if (!event || typeof event !== "object" || Array.isArray(event) || (event as WebhookEvent).id !== webhookId) return { failure: "Its body isn't a webhook event with the webhook-id's id." };
  return { event: event as WebhookEvent };
}
