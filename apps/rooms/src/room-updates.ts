import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "./index.ts";

/** Rooms told at once, so a game with thousands of live rooms is told in a few seconds without a burst. */
const TOLD_AT_ONCE_COUNT = 50;

/**
 * A version published with match_update_mode "now", for the site (apps/site/src/match-updates.ts) through a
 * service binding: only Zaisma's own Workers reach it. Every live room of the game (live_rooms) hears it
 * and starts moving to it. A room that doesn't hear it (asleep, or a failed call) finds the new version
 * itself the next time it checks the game, so a failure here only makes a room switch a minute later.
 */
export class GameRoomsService extends WorkerEntrypoint<Env> {
  async updateMatches(update: { gameId: string; slug: string; versionId: string; hasGameFileChanges: boolean }): Promise<{ toldRoomCount: number }> {
    const { results } = await this.env.DB.prepare("SELECT room_code FROM live_rooms WHERE game_id = ?").bind(update.gameId).all<{ room_code: string }>();
    let toldRoomCount = 0;
    for (let index = 0; index < results.length; index += TOLD_AT_ONCE_COUNT) {
      const told = await Promise.allSettled(
        results.slice(index, index + TOLD_AT_ONCE_COUNT).map(async ({ room_code: roomCode }) => {
          const response = await this.env.ROOMS.get(this.env.ROOMS.idFromName(`${update.slug}:${roomCode}`)).fetch("https://room/version-update", {
            method: "POST",
            headers: { "x-game-id": update.gameId },
            body: JSON.stringify({ versionId: update.versionId, hasGameFileChanges: update.hasGameFileChanges }),
          });
          if (!response.ok) throw new Error(`room ${roomCode} said ${response.status}`);
        }),
      );
      toldRoomCount += told.filter((outcome) => outcome.status === "fulfilled").length;
      for (const outcome of told) if (outcome.status === "rejected") console.error("Couldn't tell a room about the new version:", outcome.reason);
    }
    return { toldRoomCount };
  }
}
