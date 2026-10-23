import { isRoomCode } from "@zaisma/game-server";
import { ApiError, MAXIMUM_GAME_STORAGE_SIZE_BYTES, audit, iso, type Game } from "@zaisma/core";
import type { Caller, NextStep } from "./developer.ts";
import type { Env } from "./env.ts";
import { logCallerEvent } from "./security-log.ts";

/**
 * A game's kept rooms through the developer API: rooms its game server keeps (room.setKept), whose worlds
 * sleep with nobody in them and count towards the game's storage with its database. The rooms keep their
 * own rows (apps/rooms/src/room.ts); deleting one asks the room itself, through the GAME_ROOMS service binding.
 *
 *   GET    /api/dev/games/:slug/kept-rooms              the game's kept rooms, and its storage
 *   DELETE /api/dev/games/:slug/kept-rooms/:room_code   delete one's world for good; players in it are sent out
 */

interface KeptRoomRow {
  room_code: string;
  name: string | null;
  saved_size_bytes: number;
  saved_at_ms: number | null;
  last_played_at_ms: number | null;
  created_at_ms: number;
}

/** One call, once the router (developer.ts, checkCall) has checked the key and the game. */
export async function keptRoomsRoute(request: Request, env: Env, game: Game, roomCode: string | undefined, caller: Caller): Promise<[unknown, number?]> {
  const method = request.method;
  if (roomCode === undefined) {
    if (method !== "GET") throw new ApiError("bad_method", { message: `${method} isn't a call at /games/${game.slug}/kept-rooms.`, fix: "GET lists the kept rooms; delete one with DELETE /games/:slug/kept-rooms/:room_code." });
    const { results } = await env.DB.prepare("SELECT room_code, name, saved_size_bytes, saved_at_ms, last_played_at_ms, created_at_ms FROM kept_rooms WHERE game_id = ? ORDER BY last_played_at_ms DESC, created_at_ms DESC")
      .bind(game.id)
      .all<KeptRoomRow>();
    const keptRoomsSizeBytes = results.reduce((sizeBytes, row) => sizeBytes + row.saved_size_bytes, 0);
    return [
      {
        kept_rooms: results.map((row) => ({ room_code: row.room_code, name: row.name, saved_size_bytes: row.saved_size_bytes, saved_at: iso(row.saved_at_ms), last_played_at: iso(row.last_played_at_ms), created_at: iso(row.created_at_ms) })),
        kept_rooms_size_bytes: keptRoomsSizeBytes,
        storage_size_bytes: (await databaseSizeBytes(env, game)) + keptRoomsSizeBytes,
        maximum_storage_size_bytes: MAXIMUM_GAME_STORAGE_SIZE_BYTES,
      },
    ];
  }

  if (method !== "DELETE") throw new ApiError("bad_method", { message: `${method} isn't a call at /games/${game.slug}/kept-rooms/${roomCode}.`, fix: "DELETE deletes the kept room; GET /games/:slug/kept-rooms lists them." });
  const code = roomCode.toUpperCase();
  if (!isRoomCode(code)) throw new ApiError("bad_room_code", { message: `room_code ${JSON.stringify(roomCode.slice(0, 20))} isn't a room code.`, field: "room_code", fix: "Give a kept room's code from list_kept_rooms, like K7Q2MX." });
  const kept = await env.DB.prepare("SELECT room_code FROM kept_rooms WHERE game_id = ? AND room_code = ?").bind(game.id, code).first<{ room_code: string }>();
  if (!kept) throw new ApiError("no_kept_room", { message: `${game.slug} has no kept room ${code}.`, field: "room_code", fix: "list_kept_rooms gives this game's kept rooms." });
  // Without the rooms Worker (a Zaisma of your own), there's no room to ask, only its row.
  const { isDeleted } = env.GAME_ROOMS ? await env.GAME_ROOMS.deleteKeptRoom({ gameId: game.id, slug: game.slug, roomCode: code }) : { isDeleted: true };
  if (!isDeleted) throw new ApiError("internal_error", { message: "The kept room didn't answer, so it wasn't deleted.", fix: "Try again in a moment; if it keeps happening, tell Zaisma with post_topic (kind bug, category servers).", retryAfterSec: 10 });
  await env.DB.prepare("DELETE FROM kept_rooms WHERE game_id = ? AND room_code = ?").bind(game.id, code).run();
  await audit(env.DB, game.id, "kept-room-deleted", code, caller.actor);
  await logCallerEvent(env, caller, "kept_room_deleted", { gameId: game.id, subjectName: code });
  const nextSteps: NextStep[] = [{ tool: "list_kept_rooms", arguments: { slug: game.slug }, after_sec: null, reason: "The game's kept rooms and storage now." }];
  return [{ is_deleted: true, next_steps: nextSteps }];
}

/** The game database's size, which counts with the kept rooms; 0 on a Zaisma without game databases. */
async function databaseSizeBytes(env: Env, game: Game): Promise<number> {
  if (!env.GAME_DATABASES) return 0;
  const answer = await env.GAME_DATABASES.usage(game.id);
  if ("error" in answer) throw new ApiError("database_unavailable", { message: "The game's database didn't answer, so its storage can't be counted.", fix: "Try again in a moment; if it keeps happening, tell Zaisma with post_topic (kind bug, category servers).", retryAfterSec: 10 });
  return answer.queryResult.storageSizeBytes;
}
