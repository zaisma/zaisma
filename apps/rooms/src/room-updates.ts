import { WorkerEntrypoint } from "cloudflare:workers";
import type { LiveRoom, RoomPlayer } from "@zaisma/game-server/internal";
import { endRoom, getRoom, kickFromRoom, roomMessageOf, sendRoomMessage, sendToEveryRoom, type RoomMessageOutcome } from "./room-reach.ts";
import type { Env } from "./index.ts";

/** Rooms told at once, so a game with thousands of live rooms is told in a few seconds without a burst. */
const TOLD_AT_ONCE_COUNT = 50;

/**
 * Every game's rooms, for the site through a service binding: only Zaisma's own Workers reach it. A version
 * published with match_update_mode "now" (apps/site/src/match-updates.ts): every live room of the game
 * (live_rooms) hears it and starts moving to it, and a kept room asleep switches at once. A room that doesn't hear it (asleep, or a failed call) finds the new version
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

  /**
   * The developer deletes a kept room (DELETE /games/:slug/kept-rooms/:room_code): the room sends its players
   * out and deletes everything it keeps. False when the room didn't answer, so the site says to try again.
   */
  async deleteKeptRoom(keptRoom: { gameId: string; slug: string; roomCode: string }): Promise<{ isDeleted: boolean }> {
    try {
      const response = await this.env.ROOMS.get(this.env.ROOMS.idFromName(`${keptRoom.slug}:${keptRoom.roomCode}`)).fetch("https://room/delete", { method: "POST", headers: { "x-game-id": keptRoom.gameId } });
      // 404: the room keeps nothing (it never started, or it was deleted already), so its row is all there is.
      return { isDeleted: response.ok || response.status === 404 };
    } catch (error) {
      console.error("Couldn't delete a kept room:", error);
      return { isDeleted: false };
    }
  }

  /**
   * The developer's room message to one room (POST /games/:slug/rooms/:room_code/messages): delivered, no_room, or
   * room_busy. A kept room with nobody in it wakes for it.
   */
  async sendRoomMessage(sending: { gameId: string; slug: string; roomCode: string; message: unknown }): Promise<{ deliveryOutcome: RoomMessageOutcome }> {
    return { deliveryOutcome: await sendRoomMessage(this.env, sending, sending.roomCode, roomMessageOf(sending.message, "developer", null)) };
  }

  /** The developer's room message to every live room with someone in it, or those holding every label given (POST /games/:slug/room-messages). isLimited: past the game's sends a minute, and nothing went. */
  async sendToEveryRoom(sending: { gameId: string; slug: string; labels: Record<string, string> | null; message: unknown }): Promise<{ roomCount: number; isLimited: boolean }> {
    return sendToEveryRoom(this.env, sending, { labels: sending.labels, roomMessage: roomMessageOf(sending.message, "developer", null), exceptRoomCode: null, isCounted: true });
  }

  /** One live room and who's in it (GET /games/:slug/rooms/:room_code), or null when it isn't running. */
  async getRoom(asked: { gameId: string; slug: string; roomCode: string }): Promise<{ room: LiveRoom; players: RoomPlayer[] } | null> {
    return getRoom(this.env, asked, asked.roomCode);
  }

  /** Remove a player from a live room (POST /games/:slug/rooms/:room_code/kick): its onLeave hears reason "kicked". */
  async kickPlayer(kick: { gameId: string; slug: string; roomCode: string; playerId: string; message: string; isKeptOut: boolean }): Promise<{ kickOutcome: "kicked" | "no_room" | "no_player_in_room" }> {
    return { kickOutcome: await kickFromRoom(this.env, kick, kick.roomCode, kick) };
  }

  /** End a live room's match (POST /games/:slug/rooms/:room_code/end): its players hear message. */
  async endRoom(ending: { gameId: string; slug: string; roomCode: string; message: string | null }): Promise<{ endOutcome: "ended" | "no_room" }> {
    return { endOutcome: await endRoom(this.env, ending, ending.roomCode, ending.message) };
  }
}
