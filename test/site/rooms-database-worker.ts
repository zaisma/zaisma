// The rooms Worker's game databases and secrets, as the site's tests reach them through the GAME_DATABASES
// and GAME_SECRETS service bindings (vitest.config.ts bundles this as a second Worker named zaisma-rooms):
// the real code, without the rest of rooms.
import { WorkerEntrypoint } from "cloudflare:workers";

import { gameDatabaseObject } from "../../apps/rooms/src/database.ts";
import { gameSecretsObject } from "../../apps/rooms/src/secrets.ts";
import { GameDatabaseObject as RealGameDatabaseObject, GameDatabaseService as RealGameDatabaseService, type PointInTime } from "../../apps/rooms/src/database.ts";

// Local storage keeps no history, so restores reach a stand-in for Cloudflare's point-in-time recovery: it
// hands out bookmarks that say what they're for, keeps the ones restored to, and, as a real restore does,
// rolls the month's use back (here, to nothing). The rows themselves stay: tests put back what a restore would.
let restoredBookmarks: string[] = [];
let undoCount = 0;

export class GameDatabaseObject extends RealGameDatabaseObject {
  protected override pointInTime(): PointInTime {
    return {
      bookmarkForTime: async (atMs) => `bookmark-${atMs}`,
      restoreOnNextStart: async (bookmark) => {
        restoredBookmarks.push(bookmark);
        this.ctx.storage.kv.delete("usage");
        return `undo-${++undoCount}`;
      },
    };
  }
}

export class GameDatabaseService extends RealGameDatabaseService {
  /** For tests: the bookmarks restored to since the last call. */
  takeRestoredBookmarks() {
    const taken = restoredBookmarks;
    restoredBookmarks = [];
    return taken;
  }
}
export { GameSecretsObject, GameSecretsService } from "../../apps/rooms/src/secrets.ts";
// Receipts are signed with the tests' throwaway pass key (vitest.config.ts), the real code.
export { ReceiptSigningService } from "../../apps/rooms/src/receipts.ts";

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

// A version published "now" (GAME_ROOMS): rooms can't run here, so the calls are only recorded. The real one: test/rooms/room-updates.test.ts.
let matchUpdates: { gameId: string; slug: string; versionId: string; hasGameFileChanges: boolean }[] = [];

let keptRoomDeletes: { gameId: string; slug: string; roomCode: string }[] = [];
let isKeptRoomDeleted = true;

export class GameRoomsService extends WorkerEntrypoint {
  async updateMatches(update: { gameId: string; slug: string; versionId: string; hasGameFileChanges: boolean }) {
    matchUpdates.push(update);
    return { toldRoomCount: 0 };
  }
  /** For tests: the updates the site sent since the last call. */
  takeMatchUpdates() {
    const taken = matchUpdates;
    matchUpdates = [];
    return taken;
  }
  // A kept room deleted: recorded, and answered as the test asks. The real one: apps/rooms/src/room-updates.ts.
  async deleteKeptRoom(keptRoom: { gameId: string; slug: string; roomCode: string }) {
    keptRoomDeletes.push(keptRoom);
    return { isDeleted: isKeptRoomDeleted };
  }
  /** For tests: the kept rooms the site deleted since the last call, and how the next deletes are answered. */
  takeKeptRoomDeletes(nextIsDeleted: boolean) {
    const taken = keptRoomDeletes;
    keptRoomDeletes = [];
    isKeptRoomDeleted = nextIsDeleted;
    return taken;
  }
}

export default {
  fetch: () => new Response("Only the game databases and secrets are here.", { status: 404 }),
};
