// The rooms Worker's game databases and secrets, as the site's tests reach them through the GAME_DATABASES
// and GAME_SECRETS service bindings (vitest.config.ts bundles this as a second Worker named zaisma-rooms):
// the real code, without the rest of rooms.
import { WorkerEntrypoint } from "cloudflare:workers";

import { gameDatabaseObject } from "../../apps/rooms/src/database.ts";
import { gameSecretsObject } from "../../apps/rooms/src/secrets.ts";
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

// Deleting a game's storage (GAME_STORAGE): the real database and secrets objects are wiped; the game
// server object can't run here, so its wipe is only recorded. The real one: test/rooms/game-storage.test.ts.
let wipedGameServerIds: string[] = [];
let storageFailureMessage: string | null = null;

export class GameStorageService extends WorkerEntrypoint<{ GAME_DATABASES: DurableObjectNamespace; GAME_SECRETS: DurableObjectNamespace }> {
  async deleteGameStorage(gameId: string) {
    if (storageFailureMessage) return { failureMessage: storageFailureMessage };
    await (gameDatabaseObject(this.env as never, gameId) as unknown as { deleteStorage(): Promise<void> }).deleteStorage();
    await (gameSecretsObject(this.env as never, gameId) as unknown as { deleteStorage(): Promise<void> }).deleteStorage();
    wipedGameServerIds.push(gameId);
    return { failureMessage: null };
  }
  /** For tests: the games whose game server storage was wiped since the last call, and how the next wipes are answered. */
  takeWiped(nextFailureMessage: string | null) {
    const taken = wipedGameServerIds;
    wipedGameServerIds = [];
    storageFailureMessage = nextFailureMessage;
    return taken;
  }
}

export default {
  fetch: () => new Response("Only the game databases and secrets are here.", { status: 404 }),
};
