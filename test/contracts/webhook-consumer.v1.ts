import { runWebhook, verifyWebhook, WEBHOOK_LIMITS, type WebhookEvent, type WebhookHandler } from "../../packages/game-server/src/webhooks.ts";

/**
 * Code a developer's own server could have written against the v1 webhooks, never run: npm run typecheck
 * compiles it, so a change that would break it fails there. Only add to it; what's here stays.
 */

export async function takeWebhook(request: Request, signingSecret: string): Promise<Response> {
  if (Number(request.headers.get("content-length") ?? 0) > WEBHOOK_LIMITS.maximumEventSizeBytes) return new Response(null, { status: 413 });
  const headers = { webhookId: request.headers.get("webhook-id"), webhookTimestamp: request.headers.get("webhook-timestamp"), webhookSignature: request.headers.get("webhook-signature") };
  const checked = await verifyWebhook(signingSecret, headers, await request.text());
  if ("error" in checked) {
    const code: string = checked.error.code;
    return new Response(`${code}: ${checked.error.message} ${checked.error.fix}`, { status: 401 });
  }
  handle(checked.event);
  return new Response(null, { status: 204 });
}

function handle(event: WebhookEvent): void {
  const id: string = event.id;
  const createdAt: string = event.created_at;
  switch (event.kind) {
    case "account_deleted":
      if (event.account_deletion) {
        const playerId: string = event.account_deletion.player_id;
        const isErased: boolean = event.account_deletion.deleted_account_erase_enabled;
        void [playerId, isErased];
      }
      break;
    case "bug_reported":
      void event.bug_report?.["player_text"];
      break;
    case "alert_raised":
      void event.alert?.["kind"];
      break;
    default:
      // A kind added later: skip it.
      void [id, createdAt, event.game?.["slug"], event.version, event.player_report, event.game_server_error, event.sign_in_app, event.security_event];
  }
}

export const handler: WebhookHandler = { onWebhook: (event) => handle(event) };

export async function runOne(event: WebhookEvent, server: Parameters<typeof runWebhook>[2]): Promise<string> {
  const outcome = await runWebhook(handler, event, server);
  return "error" in outcome ? `${outcome.error.code}: ${outcome.error.message} ${outcome.error.fix}` : String(outcome.isDone);
}
