import { describe, expect, it } from "vitest";
import { verifyWebhook, type WebhookErrorCode } from "../../packages/game-server/src/webhooks.ts";
import { lockSurface } from "./surface.ts";

/**
 * The webhooks' v1 contract: the event's shape, the Standard Webhooks signing, and the coded errors
 * verifyWebhook and runWebhook answer. webhook-consumer.v1.ts is code a developer's server could have
 * written against v1, and typecheck keeps it compiling.
 */

describe("webhooks v1", () => {
  lockSurface("webhooks", "packages/game-server/src/webhooks.ts", [
    "WebhookEvent",
    "WebhookEventKind",
    "AccountDeletion",
    "WebhookHeaders",
    "WebhookError",
    "WebhookErrorCode",
    "WEBHOOK_LIMITS",
    "verifyWebhook",
    "runWebhook",
  ]);

  // A v1 account_deleted POST, signed once with Standard Webhooks' own test secret and kept as it was sent.
  const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
  const HEADERS = { webhookId: "webhook_event_4m8k2q9x1c7v3b6n0z5p", webhookTimestamp: "1792800000", webhookSignature: "v1,jLyGHNSTRtmyT/upn51VhRU8ZhBniXqnnfhPmu4oZSw=" };
  const BODY =
    '{"id":"webhook_event_4m8k2q9x1c7v3b6n0z5p","kind":"account_deleted","created_at":"2026-10-23T05:20:00.000Z","game":{"slug":"sky-hopper","deleted_account_erase_enabled":true},"version":null,"bug_report":null,"player_report":null,"game_server_error":null,"alert":null,"account_deletion":{"player_id":"player_7h2k9m4q","deleted_account_erase_enabled":true},"sign_in_app":null,"security_event":null}';
  const SENT_AT_MS = 1792800000_000;

  it("takes a v1 POST as it was signed, with its event as sent", async () => {
    expect(await verifyWebhook(SECRET, HEADERS, BODY, SENT_AT_MS)).toEqual({ event: JSON.parse(BODY) });
    // While a secret is replaced, several signatures come space-separated; any one that matches will do.
    expect(await verifyWebhook(SECRET, { ...HEADERS, webhookSignature: `v1,AAAA ${HEADERS.webhookSignature}` }, BODY, SENT_AT_MS)).toHaveProperty("event");
  });

  it("refuses with v1's coded errors, each with a message and a fix", async () => {
    const codeOf = async (...args: Parameters<typeof verifyWebhook>) => {
      const checked = await verifyWebhook(...args);
      if (!("error" in checked)) return null;
      expect(checked.error).toEqual({ code: checked.error.code, message: expect.any(String), fix: expect.any(String) });
      return checked.error.code;
    };
    const refusals: [WebhookErrorCode, Parameters<typeof verifyWebhook>][] = [
      ["missing_headers", [SECRET, { ...HEADERS, webhookSignature: null }, BODY, SENT_AT_MS]],
      ["too_large", [SECRET, HEADERS, BODY + " ".repeat(16 * 1024 * 1024), SENT_AT_MS]],
      ["old_timestamp", [SECRET, HEADERS, BODY, SENT_AT_MS + 301_000]],
      ["bad_signing_secret", [SECRET.replace("Mf", "M%"), HEADERS, BODY, SENT_AT_MS]],
      ["bad_signature", [SECRET, HEADERS, BODY.replace("sky-hopper", "cave-crew"), SENT_AT_MS]],
      ["not_an_event", [SECRET, { ...HEADERS, webhookId: "msg_p5jXN8AQM9LWM0D4loKWxJek", webhookTimestamp: "1614265330", webhookSignature: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=" }, '{"test": 2432232314}', 1614265330_000]],
    ];
    for (const [code, args] of refusals) expect(await codeOf(...args), code).toBe(code);
    // Five minutes either way is still taken.
    expect(await codeOf(SECRET, HEADERS, BODY, SENT_AT_MS + 300_000)).toBeNull();
  });
});
