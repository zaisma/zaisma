import { WorkerEntrypoint } from "cloudflare:workers";
import { gameDatabaseObject } from "./database.ts";
import { gameSecretsObject } from "./secrets.ts";
import type { Env } from "./index.ts";

/** Kept rooms deleted at once, so a game with thousands of worlds goes in a few seconds without a burst. */
const DELETED_AT_ONCE_COUNT = 50;

/**
 * Deleting a game's storage in rooms, for the site (apps/site/src/game-deletion.ts) through a service
 * binding: only Zaisma's own Workers reach it. Its database, secrets, game server object (use, schedules,
 * alarm) and kept rooms' worlds go; its other rooms end once the game isn't live and wipe themselves when
 * they empty, and its link name is never given to another game, so nothing reaches them again. Safe to repeat.
 */
export class GameStorageService extends WorkerEntrypoint<Env> {
  async deleteGameStorage(gameId: string): Promise<{ failureMessage: string | null }> {
    try {
      await gameDatabaseObject(this.env, gameId).deleteStorage();
      await gameSecretsObject(this.env, gameId).deleteStorage();
      await this.env.GAME_SERVER_OBJECTS.get(this.env.GAME_SERVER_OBJECTS.idFromName(gameId)).deleteStorage();
      await this.deleteKeptRooms(gameId);
      return { failureMessage: null };
    } catch (error) {
      console.error("Couldn't delete a game's storage:", gameId, error);
      return { failureMessage: "The game's database, secrets, game server storage or kept rooms didn't answer." };
    }
  }

  /**
   * A kept room's storage as JSON lines, for Zaisma's nightly backup (apps/site/src/backups.ts), or null
   * when the room has no world (deleted since it was listed). Its object is named by the game's link name and its code.
   */
  async keptRoomBackup(gameId: string, slug: string, roomCode: string): Promise<ReadableStream<Uint8Array> | null> {
    const response = await this.env.ROOMS.get(this.env.ROOMS.idFromName(`${slug}:${roomCode}`)).fetch("https://room/backup", { method: "POST", headers: { "x-game-id": gameId } });
    if (response.status === 404) return null;
    if (!response.ok || !response.body) throw new Error(`kept room ${roomCode} said ${response.status}`);
    return response.body;
  }

  /**
   * Puts a kept room's world back from its backup's JSON lines, for a restore from Zaisma's backups
   * (apps/site/src/restore.ts). A room that already holds a world got it from an earlier try of the same
   * restore (a world's meta key goes in last), so it's left as it is.
   */
  async restoreKeptRoom(gameId: string, slug: string, roomCode: string, lines: ReadableStream<Uint8Array>): Promise<void> {
    const response = await this.env.ROOMS.get(this.env.ROOMS.idFromName(`${slug}:${roomCode}`)).fetch("https://room/restore", { method: "POST", headers: { "x-game-id": gameId }, body: lines });
    if (!response.ok && response.status !== 409) throw new Error(`kept room ${roomCode} said ${response.status}: ${await response.text()}`);
  }

  /** Each kept room deletes its own world (its object is named by the game's link name and its code), then the rows go. */
  private async deleteKeptRooms(gameId: string): Promise<void> {
    const game = await this.env.DB.prepare("SELECT slug FROM games WHERE id = ?").bind(gameId).first<{ slug: string }>();
    const { results } = await this.env.DB.prepare("SELECT room_code FROM kept_rooms WHERE game_id = ?").bind(gameId).all<{ room_code: string }>();
    if (game) {
      for (let index = 0; index < results.length; index += DELETED_AT_ONCE_COUNT) {
        await Promise.all(
          results.slice(index, index + DELETED_AT_ONCE_COUNT).map(async ({ room_code: roomCode }) => {
            const response = await this.env.ROOMS.get(this.env.ROOMS.idFromName(`${game.slug}:${roomCode}`)).fetch("https://room/delete", { method: "POST", headers: { "x-game-id": gameId } });
            if (!response.ok && response.status !== 404) throw new Error(`kept room ${roomCode} said ${response.status}`);
          }),
        );
      }
    }
    await this.env.DB.prepare("DELETE FROM kept_rooms WHERE game_id = ?").bind(gameId).run();
  }
}
