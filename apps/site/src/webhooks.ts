import {
  FREE_REQUEST_COUNT_PER_MONTH,
  FREE_ROOM_PLAY_DURATION_HOURS,
  FREE_USE_ALERT_KINDS,
  MAXIMUM_ERROR_EVENT_COUNT_PER_DAY,
  NEARLY_USED_PCT,
  TEST_EVENT_KIND,
  countedPlayDurationSec,
  attemptDelivery,
  dueDeliveries,
  duePlayerErases,
  gameById,
  gameBySlug,
  gameSlugsOf,
  iso,
  newId,
  queueDelivery,
  queuePlayerErase,
  recordPlayerEraseAttempt,
  signInAppById,
  versionById,
  webhookById,
  webhooksFor,
  webhooksTaking,
  webhooksTakingSignInAppEvent,
  type SendToGameServer,
  type Webhook,
  type WebhookDelivery,
  type FreeUseAlertKind,
  type Game,
  type WebhookEventKind,
} from "@zaisma/core";
import { bugReportJson, gameAlerts, playerReportJson, gameJson, gameServerErrorJson, signInAppJson, versionJson, type GameAlert, type GameServerErrorRow } from "./developer.ts";
import type { Env } from "./env.ts";

/**
 * What goes in a webhook event, and when one is sent (docs/DECISIONS.md, "Webhooks follow Standard
 * Webhooks"). An event says what happened with the objects the API answers for it, so a developer's
 * server reads the same JSON as get_game, get_version and get_reports:
 *
 *   { "id": "webhook_event_…", "kind": "scan_status_changed", "happened_at": "…",
 *     "game": { …as get_game }, "version": { …as get_version } | null, "bug_report": { …as get_reports } | null,
 *     "player_report": { …as get_reports } | null,
 *     "game_server_error": { …as get_stats lists it } | null, "alert": { …as the game's alerts list it } | null,
 *     "player_id": "player_…" | null, "sign_in_app": { …as list_sign_in_apps } | null }
 *
 * Each event is tried straight after it happens (in the background on API calls), then by the cron
 * every 5 minutes until it's delivered or has failed every try. Telling webhooks never fails the change
 * it's about: a problem here is logged and the delivery waits for the cron.
 *
 * A webhook whose destination_kind is game_server sends the same JSON to the game's own game server
 * in the rooms Worker, whose onWebhook gets it (docs/DECISIONS.md, "Webhooks to the game server").
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

/** The player report a player_reported event carries, as stored. */
export interface PlayerReportRow {
  id: string;
  player_reason: string;
  player_text: string;
  player_id: string;
  player_name: string;
  room_code: string;
  version_id: string | null;
  reported_at_ms: number;
}

/**
 * Something happened to a game: every webhook of its owner's that takes this kind gets the event. The
 * game and version are read as they are now. waitUntil sends in the background; without it, this
 * waits for the first try (the scan queue, the cron and admin can wait).
 */
export async function tellWebhooks(
  env: Env,
  kind: WebhookEventKind,
  gameId: string,
  parts: { versionId?: string | null; bugReport?: BugReportRow; playerReport?: PlayerReportRow; gameServerError?: GameServerErrorRow; alert?: GameAlert; isSkippingGameServer?: boolean },
  waitUntil?: WaitUntil,
): Promise<void> {
  try {
    const game = await gameById(env.DB, gameId);
    if (!game?.owner_id) return;
    // isSkippingGameServer: an event the game's own game server can't take, or mustn't (it would feed itself).
    const webhooks = webhooksTaking(await webhooksFor(env.DB, game.owner_id), kind, game.slug).filter((webhook) => !(parts.isSkippingGameServer && webhook.destination_kind === "game_server"));
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
      player_report: parts.playerReport ? playerReportJson(parts.playerReport) : null,
      game_server_error: parts.gameServerError ? gameServerErrorJson(parts.gameServerError) : null,
      alert: parts.alert ?? null,
      player_id: null,
      sign_in_app: null,
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
  const eventJson = JSON.stringify({ id: webhookEventId, kind: TEST_EVENT_KIND, happened_at: iso(Date.now()), game: null, version: null, bug_report: null, player_report: null, game_server_error: null, alert: null, player_id: null, sign_in_app: null });
  const delivery = await queueDelivery(env.DB, webhook, webhookEventId, eventJson);
  return (await attemptDelivery(env.DB, webhook, delivery, { isOnlyAttempt: true, sendToGameServer: gameServerSender(env) })) ?? delivery;
}

/**
 * A player deleted their account (docs/DECISIONS.md, "Deleting an account reaches developers"). Each
 * game they played gets an account_deleted event to its owner's webhooks (game servers included) and,
 * unless its deleted_account_erase_enabled is off, an erase of their rows from its database; each
 * sign-in app they said yes to gets the event with sign_in_app instead of game. The first tries run in
 * waitUntil, or are waited for without it. Never throws: a problem is logged and the cron picks it up.
 */
export async function tellAccountDeleted(env: Env, reach: { playerId: string; gameIds: string[]; signInAppIds: string[] }, waitUntil?: WaitUntil): Promise<void> {
  const sendingWebhooks: Webhook[] = [];
  const deliveries: WebhookDelivery[] = [];
  const webhooksOf = new Map<string, Webhook[]>();
  const ownerWebhooks = async (ownerId: string) => {
    if (!webhooksOf.has(ownerId)) webhooksOf.set(ownerId, await webhooksFor(env.DB, ownerId));
    return webhooksOf.get(ownerId)!;
  };
  const queueEvent = async (webhooks: Webhook[], parts: { game: unknown; signInApp: unknown }) => {
    if (!webhooks.length) return;
    const webhookEventId = newId("webhook_event");
    const eventJson = JSON.stringify({ id: webhookEventId, kind: "account_deleted", happened_at: iso(Date.now()), game: parts.game, version: null, bug_report: null, player_report: null, game_server_error: null, alert: null, player_id: reach.playerId, sign_in_app: parts.signInApp });
    for (const webhook of webhooks) {
      sendingWebhooks.push(webhook);
      deliveries.push(await queueDelivery(env.DB, webhook, webhookEventId, eventJson));
    }
  };
  if (!reach.playerId) return;
  for (const gameId of reach.gameIds) {
    try {
      const game = await gameById(env.DB, gameId);
      if (!game) continue;
      if (game.deleted_account_erase_enabled) await queuePlayerErase(env.DB, game.id, reach.playerId);
      if (game.owner_id) await queueEvent(webhooksTaking(await ownerWebhooks(game.owner_id), "account_deleted", game.slug), { game: gameJson(env, game), signInApp: null });
    } catch (error) {
      console.error("Couldn't tell a game an account was deleted", gameId, error);
    }
  }
  for (const signInAppId of reach.signInAppIds) {
    try {
      const app = await signInAppById(env.DB, signInAppId);
      if (app) await queueEvent(webhooksTakingSignInAppEvent(await ownerWebhooks(app.owner_id), "account_deleted"), { game: null, signInApp: signInAppJson(env, app) });
    } catch (error) {
      console.error("Couldn't tell a sign-in app an account was deleted", signInAppId, error);
    }
  }
  const working = Promise.allSettled([eraseDuePlayers(env), sendAll(env, sendingWebhooks, deliveries)]).then((results) => {
    for (const attempt of results) if (attempt.status === "rejected") console.error("Telling about a deleted account broke", attempt.reason);
  });
  if (waitUntil) waitUntil(working);
  else await working;
}

/** Every 5 minutes, and straight after an account is deleted: up to 100 due erases of deleted players from game databases, 20 at once. */
export async function eraseDuePlayers(env: Env): Promise<void> {
  const service = env.GAME_DATABASES;
  if (!service) return;
  const due = await duePlayerErases(env.DB, 100);
  for (let i = 0; i < due.length; i += 20) {
    await Promise.allSettled(
      due.slice(i, i + 20).map(async (erase) => {
        let failureMessage: string | null;
        try {
          const answer = (await service.erasePlayer(erase.game_id, erase.player_id)) as { error?: { message: string } };
          failureMessage = answer.error ? answer.error.message : null;
        } catch (error) {
          failureMessage = `Couldn't reach the game database: ${error instanceof Error ? error.message : String(error)}`;
        }
        await recordPlayerEraseAttempt(env.DB, erase, failureMessage);
      }),
    );
  }
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

const DAY_MS = 24 * 3600 * 1000;
const monthStartDate = (nowMs: number) => `${new Date(nowMs).toISOString().slice(0, 7)}-01`;

/**
 * Every 5 minutes: the room and request lines games reached this month (NEARLY_USED_PCT and all
 * of their free player-hours and requests), noted once a month per kind in alert_notices for
 * tellAlertNotices. Only games with use today, so it reads a month of rows for active games alone.
 * The game database notes its own lines (apps/rooms/src/database.ts).
 */
export async function noticeFreeUseAlerts(env: Env, nowMs = Date.now()): Promise<void> {
  const monthStart = monthStartDate(nowMs);
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare(
    "SELECT game_id, SUM(room_play_duration_sec) AS room_play_duration_sec, SUM(relayed_size_bytes) AS relayed_size_bytes, SUM(game_server_request_count) AS request_count FROM room_usage WHERE date >= ? AND game_id IN (SELECT game_id FROM room_usage WHERE date = ?) GROUP BY game_id",
  )
    .bind(monthStart, today)
    .all<{ game_id: string; room_play_duration_sec: number; relayed_size_bytes: number; request_count: number }>();
    const freeRoomSec = FREE_ROOM_PLAY_DURATION_HOURS * 3600;
  const insert = env.DB.prepare("INSERT OR IGNORE INTO alert_notices (game_id, alert_kind, month_start_date, noticed_at_ms) VALUES (?, ?, ?, ?)");
  const notices = results.flatMap((use) => {
    const countedSec = countedPlayDurationSec(use.room_play_duration_sec, use.relayed_size_bytes);
    const reached: [FreeUseAlertKind, boolean][] = [
      ["rooms_nearly_paused", countedSec >= freeRoomSec * NEARLY_USED_PCT / 100],
      ["rooms_paused", countedSec >= freeRoomSec],
      ["requests_nearly_paused", use.request_count >= FREE_REQUEST_COUNT_PER_MONTH * NEARLY_USED_PCT / 100],
      ["requests_paused", use.request_count >= FREE_REQUEST_COUNT_PER_MONTH],
    ];
    return reached.filter(([, isReached]) => isReached).map(([kind]) => insert.bind(use.game_id, kind, monthStart, nowMs));
  });
  if (notices.length) await env.DB.batch(notices);
}

/**
 * Every 5 minutes: an alert_raised event for each free-use alert noted and not told yet, up to 100,
 * with the alert as the game's alerts list it now. One the game no longer has (the month reset, or it
 * went straight past its heads-up to paused) is marked told and not sent. Marking first means two
 * crons never both send one.
 */
export async function tellAlertNotices(env: Env, nowMs = Date.now()): Promise<void> {
  const { results: notices } = await env.DB.prepare("SELECT game_id, alert_kind, month_start_date FROM alert_notices WHERE told_webhooks_at_ms IS NULL ORDER BY noticed_at_ms LIMIT 100").all<{
    game_id: string;
    alert_kind: FreeUseAlertKind;
    month_start_date: string;
  }>();
  const claimed: typeof notices = [];
  for (const notice of notices) {
    const marked = await env.DB.prepare("UPDATE alert_notices SET told_webhooks_at_ms = ? WHERE game_id = ? AND alert_kind = ? AND month_start_date = ? AND told_webhooks_at_ms IS NULL")
      .bind(nowMs, notice.game_id, notice.alert_kind, notice.month_start_date)
      .run();
    if (marked.meta.changes) claimed.push(notice);
  }
  const current = claimed.filter((notice) => notice.month_start_date === monthStartDate(nowMs) && (FREE_USE_ALERT_KINDS as readonly string[]).includes(notice.alert_kind));
  if (!current.length) return;
  const games = (await Promise.all([...new Set(current.map((notice) => notice.game_id))].map((gameId) => gameById(env.DB, gameId)))).filter((game): game is Game => Boolean(game));
  const alertsByGameId = await gameAlerts(env, games);
  for (const notice of current) {
    const alert = alertsByGameId.get(notice.game_id)?.find((each) => each.kind === notice.alert_kind);
    // A game server's webhook can't hear that requests paused: each of its events is a request.
    if (alert) await tellWebhooks(env, "alert_raised", notice.game_id, { alert, isSkippingGameServer: alert.kind === "requests_paused" });
  }
}

/**
 * Every 5 minutes: a game_server_error_found event for each new distinct error in a game's game
 * server (once per error per version), up to 100, oldest first. At most
 * MAXIMUM_ERROR_EVENT_COUNT_PER_DAY a game a UTC day; past it, errors are marked told and only show in
 * get_stats. An error onWebhook threw never goes back to the game's own game server, so a broken
 * onWebhook can't feed itself.
 */
export async function tellGameServerErrors(env: Env, nowMs = Date.now()): Promise<void> {
  const { results: errors } = await env.DB.prepare(
    "SELECT game_id, version_id, kind, message, occurrence_count, first_at_ms, last_at_ms FROM game_server_errors WHERE told_webhooks_at_ms IS NULL ORDER BY first_at_ms LIMIT 100",
  ).all<GameServerErrorRow & { game_id: string }>();
  const dayStartMs = Math.floor(nowMs / DAY_MS) * DAY_MS;
  for (const error of errors) {
    const toldCount = await env.DB.prepare("SELECT COUNT(*) AS told_count FROM game_server_errors WHERE game_id = ? AND told_webhooks_at_ms >= ?").bind(error.game_id, dayStartMs).first<number>("told_count");
    const marked = await env.DB.prepare("UPDATE game_server_errors SET told_webhooks_at_ms = ? WHERE game_id = ? AND version_id = ? AND kind = ? AND message = ? AND told_webhooks_at_ms IS NULL")
      .bind(nowMs, error.game_id, error.version_id, error.kind, error.message)
      .run();
    if (!marked.meta.changes || (toldCount ?? 0) >= MAXIMUM_ERROR_EVENT_COUNT_PER_DAY) continue;
    await tellWebhooks(env, "game_server_error_found", error.game_id, { versionId: error.version_id || null, gameServerError: error, isSkippingGameServer: error.message.startsWith("onWebhook") });
  }
}

/** One try at each delivery, to its webhook (the same place in both lists). */
async function sendAll(env: Env, webhooks: Webhook[], deliveries: WebhookDelivery[]): Promise<void> {
  const sendToGameServer = gameServerSender(env);
  const tries = await Promise.allSettled(deliveries.map((delivery, i) => attemptDelivery(env.DB, webhooks[i]!, delivery, { sendToGameServer })));
  for (const attempt of tries) if (attempt.status === "rejected") console.error("A webhook delivery broke", attempt.reason);
}

/**
 * How an event reaches a webhook's game server: the game named by its one slug, checked again to be
 * the webhook owner's (a game can be deleted or change hands after the webhook was made), then its
 * object in the rooms Worker runs onWebhook. Undefined when this Zaisma has no rooms Worker bound.
 */
function gameServerSender(env: Env): SendToGameServer | undefined {
  const service = env.GAME_SERVER_WEBHOOKS;
  if (!service) return undefined;
  return async (webhook, eventJson) => {
    const gameSlug = gameSlugsOf(webhook)?.[0];
    const game = gameSlug ? await gameBySlug(env.DB, gameSlug) : null;
    if (!game || game.owner_id !== webhook.owner_id) return { failureMessage: `You have no game ${gameSlug ?? ""} any more: change game_slugs with update_webhook, or delete this webhook.` };
    return (await service.webhook(game.id, eventJson)) as { failureMessage: string | null };
  };
}
