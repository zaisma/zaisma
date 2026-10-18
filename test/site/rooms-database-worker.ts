// The rooms Worker's game databases and secrets, as the site's tests reach them through the GAME_DATABASES
// and GAME_SECRETS service bindings (vitest.config.ts bundles this as a second Worker named zaisma-rooms):
// the real code, without the rest of rooms.
import { WorkerEntrypoint } from "cloudflare:workers";

export { GameDatabaseObject, GameDatabaseService } from "../../apps/rooms/src/database.ts";
export { GameSecretsObject, GameSecretsService } from "../../apps/rooms/src/secrets.ts";

// Game servers can't run here (no sandbox), so webhooks to them (GAME_SERVER_WEBHOOKS) reach a stand-in
// that keeps what it was sent and answers as the test asks. The real one: test/rooms/webhooks.test.ts.
let sent: { gameId: string; eventJson: string }[] = [];
let failureMessage: string | null = null;

export class GameServerWebhookService extends WorkerEntrypoint {
  webhook(gameId: string, eventJson: string) {
    sent.push({ gameId, eventJson });
    return { failureMessage };
  }
  /** For tests: what was sent since the last call, and how the next ones are answered. */
  takeSent(nextFailureMessage: string | null) {
    const taken = sent;
    sent = [];
    failureMessage = nextFailureMessage;
    return taken;
  }
}

export default {
  fetch: () => new Response("Only the game databases and secrets are here.", { status: 404 }),
};
