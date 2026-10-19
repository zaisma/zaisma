import { WorkerEntrypoint } from "cloudflare:workers";
import { gameDatabaseObject } from "./database.ts";
import { gameSecretsObject } from "./secrets.ts";
import type { Env } from "./index.ts";

/**
 * Deleting a game's storage in rooms, for the site (apps/site/src/game-deletion.ts) through a service
 * binding: only Zaisma's own Workers reach it. Its database, secrets and game server object (use,
 * schedules, alarm) go; its rooms end once the game isn't live and wipe themselves when they empty, and
 * its link name is never given to another game, so nothing reaches them again. Safe to repeat.
 */
export class GameStorageService extends WorkerEntrypoint<Env> {
  async deleteGameStorage(gameId: string): Promise<{ failureMessage: string | null }> {
    try {
      await gameDatabaseObject(this.env, gameId).deleteStorage();
      await gameSecretsObject(this.env, gameId).deleteStorage();
      await this.env.GAME_SERVER_OBJECTS.get(this.env.GAME_SERVER_OBJECTS.idFromName(gameId)).deleteStorage();
      return { failureMessage: null };
    } catch (error) {
      console.error("Couldn't delete a game's storage:", gameId, error);
      return { failureMessage: "The game's database, secrets or game server storage didn't answer." };
    }
  }
}
