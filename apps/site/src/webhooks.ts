import {
  TEST_EVENT_KIND,
  attemptDelivery,
  dueDeliveries,
  gameById,
  iso,
  newId,
  queueDelivery,
  versionById,
  webhookById,
  webhooksFor,
  webhooksTaking,
  type Webhook,
  type WebhookDelivery,
  type WebhookEventKind,
} from "@zaisma/core";
import { bugReportJson, gameJson, versionJson } from "./developer.ts";
import type { Env } from "./env.ts";

/**
 * What goes in a webhook event, and when one is sent (docs/DECISIONS.md, "Webhooks follow Standard
 * Webhooks"). An event says what happened with the objects the API answers for it, so a developer's
 * server reads the same JSON as get_game, get_version and get_reports:
 *
 *   { "id": "webhook_event_…", "kind": "scan_status_changed", "happened_at": "…",
 *     "game": { …as get_game }, "version": { …as get_version } | null, "bug_report": { …as get_reports } | null }
 *
 * Each event is tried straight after it happens (in the background on API calls), then by the cron
 * every 5 minutes until it's delivered or has failed every try. Telling webhooks never fails the change
 * it's about: a problem here is logged and the delivery waits for the cron.
 */

export type WaitUntil = (promise: Promise<unknown>) => void;

/** The bug report a bug_reported event carries, as stored. */
export interface BugReportRow {
  id: string;
  player_text: string;
  triage: string | null;
  version_id: string | null;
  reported_at_ms: number;
}

/**
 * Something happened to a game: every webhook of its owner's that takes this kind gets the event. The
 * game and version are read as they are now. waitUntil sends in the background; without it, this
 * waits for the first try (the scan queue, the cron and admin can wait).
 */
export async function tellWebhooks(env: Env, kind: WebhookEventKind, gameId: string, parts: { versionId?: string | null; bugReport?: BugReportRow }, waitUntil?: WaitUntil): Promise<void> {
  try {
    const game = await gameById(env.DB, gameId);
    if (!game?.owner_id) return;
    const webhooks = webhooksTaking(await webhooksFor(env.DB, game.owner_id), kind, game.slug);
    if (!webhooks.length) return;
    const version = parts.versionId ? await versionById(env.DB, parts.versionId) : null;
    const webhookEventId = newId("webhook_event");
    const eventJson = JSON.stringify({
      id: webhookEventId,
      kind,
      happened_at: iso(Date.now()),
      game: gameJson(env, game),
      version: version ? versionJson(env, game, version) : null,
      bug_report: parts.bugReport ? bugReportJson(parts.bugReport) : null,
    });
    const deliveries = await Promise.all(webhooks.map((webhook) => queueDelivery(env.DB, webhook, webhookEventId, eventJson)));
    const sending = sendAll(env, webhooks, deliveries);
    if (waitUntil) waitUntil(sending);
    else await sending;
  } catch (error) {
    console.error("Couldn't tell webhooks", kind, gameId, error);
  }
}

/** A test event to one webhook, tried once and answered: the way to check an endpoint and its signature check. */
export async function sendTestEvent(env: Env, webhook: Webhook): Promise<WebhookDelivery> {
  const webhookEventId = newId("webhook_event");
  const eventJson = JSON.stringify({ id: webhookEventId, kind: TEST_EVENT_KIND, happened_at: iso(Date.now()), game: null, version: null, bug_report: null });
  const delivery = await queueDelivery(env.DB, webhook, webhookEventId, eventJson);
  return (await attemptDelivery(env.DB, webhook, delivery, { isOnlyAttempt: true })) ?? delivery;
}

/** Every 5 minutes: the deliveries whose next try is due, up to 100 at a time, 20 at once. */
export async function deliverDueWebhooks(env: Env): Promise<void> {
  const due = await dueDeliveries(env.DB, 100);
  const webhooks = new Map<string, Webhook>();
  for (const webhookId of new Set(due.map((delivery) => delivery.webhook_id))) {
    const webhook = await webhookById(env.DB, webhookId);
    if (webhook) webhooks.set(webhookId, webhook);
  }
  for (let i = 0; i < due.length; i += 20) {
    const batch = due.slice(i, i + 20).filter((delivery) => webhooks.has(delivery.webhook_id));
    await sendAll(env, batch.map((delivery) => webhooks.get(delivery.webhook_id)!), batch);
  }
}

/** One try at each delivery, to its webhook (the same place in both lists). */
async function sendAll(env: Env, webhooks: Webhook[], deliveries: WebhookDelivery[]): Promise<void> {
  const tries = await Promise.allSettled(deliveries.map((delivery, i) => attemptDelivery(env.DB, webhooks[i]!, delivery)));
  for (const attempt of tries) if (attempt.status === "rejected") console.error("A webhook delivery broke", attempt.reason);
}
