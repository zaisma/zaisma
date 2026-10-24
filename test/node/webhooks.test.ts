import { describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript runner without type declarations
import { localDatabase, startServer } from "../../packages/game-server/bin/node.js";
import { signatureFor, newSigningSecret } from "../../packages/core/src/webhooks.ts";
import { verifyWebhook, type Server, type WebhookEvent } from "../../packages/game-server/src/internal.ts";

// Webhooks on the developer's own server: the Node runner takes a webhook's signed POSTs at /v1/webhooks
// and runs the same onWebhook as Zaisma does for a webhook to the game server (test/rooms/webhooks.test.ts).
// Signed here with Zaisma's own signing code (packages/core/src/webhooks.ts), which matches Standard
// Webhooks' test vectors (test/site/webhooks.test.ts).

const SECRET = newSigningSecret();
const EVENT = { id: "webhook_event_8f3k2m9q1x7c4v6b0n5z", kind: "bug_reported", created_at: "2026-10-17T12:00:00.000Z", game: { slug: "sky-hopper" }, version: null, bug_report: { id: "report_4k2m", player_text: "Stuck on level 2" } };

async function serve(gameServer: object, webhookSigningSecret: string | undefined = SECRET, database: unknown = localDatabase(":memory:")) {
  const own = startServer({ server: gameServer, game: "sky-hopper", port: 0, origins: [], issuer: "https://rooms.zaisma.test", keys: async () => [], database, webhookSigningSecret });
  await new Promise((resolve) => own.wss.once("listening", resolve));
  const portNumber = (own.wss.address() as { port: number }).port;
  const post = async (event: object, options: { signingSecret?: string; timestampSec?: number; signature?: string } = {}) => {
    const body = JSON.stringify(event);
    const timestampSec = options.timestampSec ?? Math.floor(Date.now() / 1000);
    const signature = options.signature ?? (await signatureFor(options.signingSecret ?? SECRET, EVENT.id, timestampSec, body));
    const response = await fetch(`http://localhost:${portNumber}/v1/webhooks`, {
      method: "POST",
      headers: { "content-type": "application/json", "webhook-id": EVENT.id, "webhook-timestamp": String(timestampSec), "webhook-signature": signature },
      body,
    });
    return { httpStatus: response.status, text: await response.text() };
  };
  return { own, post };
}

describe("Node runner webhooks", () => {
  it("run onWebhook for a signed event, with server.database and server.secrets", async () => {
    process.env.ZAISMA_TEST_DISCORD_TOKEN = "Bot token-one";
    const handled: { event: WebhookEvent; token: string | undefined }[] = [];
    const { own, post } = await serve({
      async onWebhook(event: WebhookEvent, server: Server) {
        await server.database.query("CREATE TABLE IF NOT EXISTS posts (event_id TEXT PRIMARY KEY)");
        await server.database.query("INSERT INTO posts VALUES (?) ON CONFLICT DO NOTHING", [event.id]);
        handled.push({ event, token: server.secrets.ZAISMA_TEST_DISCORD_TOKEN });
      },
    });
    try {
      expect(await post(EVENT)).toEqual({ httpStatus: 204, text: "" });
      expect(handled).toEqual([{ event: EVENT, token: "Bot token-one" }]);
    } finally {
      delete process.env.ZAISMA_TEST_DISCORD_TOKEN;
      await own.close();
    }
  });

  it("refuse events that aren't signed with the webhook's secret, or are old", async () => {
    let handledCount = 0;
    const { own, post } = await serve({ onWebhook: () => void handledCount++ });
    try {
      expect((await post(EVENT, { signingSecret: newSigningSecret() })).httpStatus).toBe(401);
      expect((await post(EVENT, { signature: "v1,bm90IGEgc2lnbmF0dXJl" })).httpStatus).toBe(401);
      expect((await post(EVENT, { timestampSec: Math.floor(Date.now() / 1000) - 600 })).text).toContain("webhook-timestamp");
      // Signed, but not the event whose id it was signed with.
      expect((await post({ ...EVENT, id: "webhook_event_other" })).httpStatus).toBe(401);
      expect(handledCount).toBe(0);
      // Several signatures while a secret is replaced: any one that matches will do.
      const timestampSec = Math.floor(Date.now() / 1000);
      const good = await signatureFor(SECRET, EVENT.id, timestampSec, JSON.stringify(EVENT));
      expect((await post(EVENT, { timestampSec, signature: `v1,bm90IGEgc2lnbmF0dXJl ${good}` })).httpStatus).toBe(204);
      expect(handledCount).toBe(1);
    } finally {
      await own.close();
    }
  });

  it("answer 500 when onWebhook throws, so Zaisma tries again", async () => {
    const { own, post } = await serve({
      onWebhook() {
        throw new Error("Discord said no");
      },
    });
    try {
      expect((await post(EVENT)).httpStatus).toBe(500);
    } finally {
      await own.close();
    }
  });

  it("say what's missing without a secret or onWebhook", async () => {
    const withoutSecret = await serve({ onWebhook() {} }, "");
    const withoutHandler = await serve({ onRequest: () => 1 });
    try {
      expect(await withoutSecret.post(EVENT)).toEqual({ httpStatus: 503, text: expect.stringContaining("ZAISMA_WEBHOOK_SIGNING_SECRET") });
      expect((await withoutHandler.post(EVENT)).httpStatus).toBe(404);
    } finally {
      await withoutSecret.own.close();
      await withoutHandler.own.close();
    }
  });

  it("erase the player of an account_deleted event from the local database when the game says so, with no onWebhook needed", async () => {
    const database = localDatabase(":memory:");
    await database.query("CREATE TABLE scores (player_id TEXT PRIMARY KEY, best_score INTEGER NOT NULL)");
    await database.batch([{ sql: "INSERT INTO scores VALUES ('player_mia', 10)" }, { sql: "INSERT INTO scores VALUES ('player_kai', 20)" }]);
    const deleted = (isEraseEnabled: boolean, playerId: string) => ({ ...EVENT, kind: "account_deleted", game: { slug: "sky-hopper" }, bug_report: null, account_deletion: { player_id: playerId, deleted_account_erase_enabled: isEraseEnabled }, sign_in_app: null });
    const { own, post } = await serve({ onRequest: () => 1 }, SECRET, database);
    try {
      // Turned off: the developer erases their own way, so nothing changes, and the event is still taken.
      expect(await post(deleted(false, "player_kai"))).toEqual({ httpStatus: 204, text: "" });
      expect(await database.query("SELECT player_id FROM scores ORDER BY player_id")).toEqual([{ player_id: "player_kai" }, { player_id: "player_mia" }]);
      expect(await post(deleted(true, "player_mia"))).toEqual({ httpStatus: 204, text: "" });
      expect(await database.query("SELECT player_id FROM scores")).toEqual([{ player_id: "player_kai" }]);
      // An erase that fails is tried again later.
      expect((await post(deleted(true, "mia_plays"))).httpStatus).toBe(500);
      // Other events still need onWebhook.
      expect((await post(EVENT)).httpStatus).toBe(404);
      // An event about another game is taken and skipped: it never erases this game's rows or reaches onWebhook.
      expect(await post({ ...deleted(true, "player_kai"), game: { slug: "cave-crew" } })).toEqual({ httpStatus: 204, text: "" });
      expect(await post({ ...EVENT, game: { slug: "cave-crew" } })).toEqual({ httpStatus: 204, text: "" });
      expect(await database.query("SELECT player_id FROM scores")).toEqual([{ player_id: "player_kai" }]);
    } finally {
      await own.close();
    }
  });
});

describe("verifyWebhook", () => {
  it("checks the way Standard Webhooks' own test vector signs", async () => {
    // From the Standard Webhooks spec's test vectors (github.com/standard-webhooks/standard-webhooks).
    const headers = { webhookId: "msg_p5jXN8AQM9LWM0D4loKWxJek", webhookTimestamp: "1614265330", webhookSignature: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=" };
    const checked = await verifyWebhook("whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw", headers, '{"test": 2432232314}', 1614265330_000);
    // The signature matches; the body just isn't a Zaisma event.
    expect(checked).toEqual({ error: expect.objectContaining({ code: "not_an_event" }) });
    expect(await verifyWebhook("whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw", headers, '{"test": 2432232315}', 1614265330_000)).toEqual({ error: expect.objectContaining({ code: "bad_signature" }) });
  });
});
