import { isRoomCode } from "@zaisma/game-server";
import { ApiError, KEPT_ROOM_ERASE_WAIT_DURATION_DAYS, MAXIMUM_GAME_STORAGE_SIZE_BYTES, audit, isPlayedByOthersOutsideKeptRooms, iso, type Game } from "@zaisma/core";
import type { Caller, NextStep } from "./developer.ts";
import type { Env } from "./env.ts";
import { askForGameDeletion } from "./game-deletion-requests.ts";
import { logCallerEvent } from "./security-log.ts";

/**
 * A game's kept rooms through the developer API: rooms its game server keeps (room.setKept), whose worlds
 * sleep with nobody in them and count towards the game's storage with its database. The rooms keep their
 * own rows (apps/rooms/src/room.ts); deleting one asks the room itself, through the GAME_ROOMS service binding.
 * A world other people may have played waits a week first, and only the developer's passkey tap erases it sooner.
 *
 *   GET    /api/dev/games/:slug/kept-rooms                         the game's kept rooms, and its storage
 *   DELETE /api/dev/games/:slug/kept-rooms/:room_code              players in it are sent out; its world waits its week
 *   POST   /api/dev/games/:slug/kept-rooms/:room_code/bring-back   a waiting world opens again as it was
 *   POST   /api/dev/games/:slug/kept-rooms/:room_code/erase-now    a waiting world erased at once, with a passkey tap
 */

interface KeptRoomRow {
  room_code: string;
  name: string | null;
  saved_size_bytes: number;
  saved_at_ms: number | null;
  last_played_at_ms: number | null;
  created_at_ms: number;
  erases_at_ms: number | null;
}

const DAY_MS = 86_400_000;

/** One call, once the router (developer.ts, checkCall) has checked the key and the game. */
export async function keptRoomsRoute(request: Request, env: Env, game: Game, roomCode: string | undefined, caller: Caller, nowMs = Date.now()): Promise<[unknown, number?]> {
  const method = request.method;
  if (roomCode === undefined) {
    if (method !== "GET") throw new ApiError("bad_method", { message: `${method} isn't a call at /games/${game.slug}/kept-rooms.`, fix: "GET lists the kept rooms; delete one with DELETE /games/:slug/kept-rooms/:room_code." });
    const { results } = await env.DB.prepare("SELECT room_code, name, saved_size_bytes, saved_at_ms, last_played_at_ms, created_at_ms, erases_at_ms FROM kept_rooms WHERE game_id = ? ORDER BY last_played_at_ms DESC, created_at_ms DESC")
      .bind(game.id)
      .all<KeptRoomRow>();
    const sizeBytesOf = (rows: KeptRoomRow[]) => rows.reduce((sizeBytes, row) => sizeBytes + row.saved_size_bytes, 0);
    const keptRoomsSizeBytes = sizeBytesOf(results.filter((row) => row.erases_at_ms === null));
    return [
      {
        kept_rooms: results.map((row) => ({ room_code: row.room_code, name: row.name, saved_size_bytes: row.saved_size_bytes, saved_at: iso(row.saved_at_ms), last_played_at: iso(row.last_played_at_ms), created_at: iso(row.created_at_ms), erases_at: iso(row.erases_at_ms) })),
        kept_rooms_size_bytes: keptRoomsSizeBytes,
        waiting_kept_rooms_size_bytes: sizeBytesOf(results.filter((row) => row.erases_at_ms !== null)),
        storage_size_bytes: (await databaseSizeBytes(env, game)) + keptRoomsSizeBytes,
        maximum_storage_size_bytes: MAXIMUM_GAME_STORAGE_SIZE_BYTES,
      },
    ];
  }

  const path = new URL(request.url).pathname;
  const isBringingBack = path.endsWith("/bring-back");
  const isErasingNow = path.endsWith("/erase-now");
  if (!isBringingBack && !isErasingNow && method !== "DELETE") throw new ApiError("bad_method", { message: `${method} isn't a call at /games/${game.slug}/kept-rooms/${roomCode}.`, fix: "DELETE deletes the kept room; GET /games/:slug/kept-rooms lists them." });
  const code = roomCode.toUpperCase();
  if (!isRoomCode(code)) throw new ApiError("bad_room_code", { message: `room_code ${JSON.stringify(roomCode.slice(0, 20))} isn't a room code.`, field: "room_code", fix: "Give a kept room's code from list_kept_rooms, like K7Q2MX." });
  const kept = await erasesAtOf(env, game, code);
  if (!kept) throw noKeptRoom(game, code);
  if (isBringingBack) return bringBack(env, game, code, kept.erases_at_ms, caller, nowMs);
  if (isErasingNow) return eraseNow(env, game, code, kept.erases_at_ms, caller, nowMs);

  if (kept.erases_at_ms !== null) return deletedAnswer(game, code, kept.erases_at_ms);
  const erasesAtMs = await startKeptRoomWait(env, game, code, null, caller, nowMs);
  if (erasesAtMs !== null) {
    await audit(env.DB, game.id, "kept-room-deleted", code, caller.actor);
    return deletedAnswer(game, code, erasesAtMs);
  }
  // Nobody else ever played the game, or a Zaisma of its own has no rooms to keep it in: there's nobody's world to wait for.
  await eraseKeptRoom(env, game, code);
  await audit(env.DB, game.id, "kept-room-deleted", code, caller.actor);
  await logCallerEvent(env, caller, "kept_room_deleted", { gameId: game.id, subjectName: code });
  return deletedAnswer(game, code, null);
}

/**
 * Starts a kept world's week: players are sent out, hearing message or "This world was deleted.", and the world stays as it
 * was until erases_at. Answers when it's erased, or null when there's nothing to wait for: no such world or one waiting
 * already, a game nobody else played, or a Zaisma of its own with no rooms Worker.
 */
export async function startKeptRoomWait(env: Env, game: Game, code: string, message: string | null, caller: Caller, nowMs = Date.now()): Promise<number | null> {
  if (!env.GAME_ROOMS) return null;
  const kept = await erasesAtOf(env, game, code);
  if (!kept || kept.erases_at_ms !== null) return null;
  if (!(await isPlayedByOthersOutsideKeptRooms(env.DB, game.id))) return null;
  const erasesAtMs = nowMs + KEPT_ROOM_ERASE_WAIT_DURATION_DAYS * DAY_MS;
  const { holdOutcome } = await env.GAME_ROOMS.holdKeptRoom({ gameId: game.id, slug: game.slug, roomCode: code, erasesAtMs, message });
  if (holdOutcome === "failed") throw noAnswer();
  // The room holds no world, so its row is all there is.
  if (holdOutcome === "no_room") return null;
  await env.DB.prepare("UPDATE kept_rooms SET erases_at_ms = ? WHERE game_id = ? AND room_code = ?").bind(erasesAtMs, game.id, code).run();
  await logDeletedWorld(env, caller, game, code, nowMs);
  return erasesAtMs;
}

/** One event for a world's week starting: when a key or an AI app did it, the first in a day per game is the alert the developer hears, however many went. */
async function logDeletedWorld(env: Env, caller: Caller, game: Game, code: string, nowMs: number): Promise<void> {
  const alerted = caller.via === "dashboard" || (await env.DB.prepare("SELECT 1 AS is_alerted FROM security_events WHERE account_id = ? AND game_id = ? AND kind = 'kept_rooms_deleted' AND happened_at_ms > ? LIMIT 1").bind(caller.accountId, game.id, nowMs - DAY_MS).first());
  await logCallerEvent(env, caller, alerted ? "kept_room_deleted" : "kept_rooms_deleted", { gameId: game.id, subjectName: code });
}

async function bringBack(env: Env, game: Game, code: string, erasesAtMs: number | null, caller: Caller, nowMs: number): Promise<[unknown, number?]> {
  checkWaiting(game, code, erasesAtMs, nowMs);
  const { bringBackOutcome } = env.GAME_ROOMS ? await env.GAME_ROOMS.bringBackKeptRoom({ gameId: game.id, slug: game.slug, roomCode: code }) : { bringBackOutcome: "no_room" as const };
  if (bringBackOutcome === "failed") throw noAnswer();
  if (bringBackOutcome === "no_room") {
    await env.DB.prepare("DELETE FROM kept_rooms WHERE game_id = ? AND room_code = ?").bind(game.id, code).run();
    throw noKeptRoom(game, code);
  }
  await env.DB.prepare("UPDATE kept_rooms SET erases_at_ms = NULL WHERE game_id = ? AND room_code = ?").bind(game.id, code).run();
  await audit(env.DB, game.id, "kept-room-brought-back", code, caller.actor);
  await logCallerEvent(env, caller, "kept_room_brought_back", { gameId: game.id, subjectName: code });
  const nextSteps: NextStep[] = [{ tool: "list_kept_rooms", arguments: { slug: game.slug }, after_sec: null, reason: "The game's kept rooms and storage now." }];
  return [{ is_brought_back: true, next_steps: nextSteps }];
}

/** A waiting world erased before its week is over: only ever with the developer's passkey tap, never a key or an AI alone. */
async function eraseNow(env: Env, game: Game, code: string, erasesAtMs: number | null, caller: Caller, nowMs: number): Promise<[unknown, number?]> {
  checkWaiting(game, code, erasesAtMs, nowMs);
  if (!caller.isPasskeyConfirmed) throw await askForGameDeletion(env, caller, game, "erase_kept_room_now", nowMs, code);
  await eraseKeptRoom(env, game, code);
  await audit(env.DB, game.id, "kept-room-erased-now", code, caller.actor);
  await logCallerEvent(env, caller, "kept_room_erased_now", { gameId: game.id, subjectName: code });
  const nextSteps: NextStep[] = [{ tool: "list_kept_rooms", arguments: { slug: game.slug }, after_sec: null, reason: "The game's kept rooms and storage now." }];
  return [{ is_erased: true, next_steps: nextSteps }];
}

async function eraseKeptRoom(env: Env, game: Game, code: string): Promise<void> {
  // Without the rooms Worker (a Zaisma of your own), there's no room to ask, only its row.
  const { isDeleted } = env.GAME_ROOMS ? await env.GAME_ROOMS.deleteKeptRoom({ gameId: game.id, slug: game.slug, roomCode: code }) : { isDeleted: true };
  if (!isDeleted) throw noAnswer();
  await env.DB.prepare("DELETE FROM kept_rooms WHERE game_id = ? AND room_code = ?").bind(game.id, code).run();
}

function checkWaiting(game: Game, code: string, erasesAtMs: number | null, nowMs: number): void {
  if (erasesAtMs === null) throw new ApiError("kept_room_not_waiting", { message: `Kept room ${code} of ${game.slug} isn't deleted and waiting to be erased.`, field: "room_code", fix: "list_kept_rooms says erases_at for a world that's waiting." });
  if (erasesAtMs <= nowMs) throw new ApiError("kept_room_erasing", { message: `Kept room ${code}'s week is over and its erasing has started.`, field: "room_code", fix: "Nothing brings it back now." });
}

function deletedAnswer(game: Game, code: string, erasesAtMs: number | null): [unknown, number?] {
  const nextSteps: NextStep[] = [
    ...(erasesAtMs === null ? [] : [{ tool: "bring_back_kept_room", arguments: { slug: game.slug, room_code: code }, after_sec: null, reason: "Brings the world back until erases_at, as it was." }]),
    { tool: "list_kept_rooms", arguments: { slug: game.slug }, after_sec: null, reason: "The game's kept rooms and storage now." },
  ];
  return [{ is_deleted: true, erases_at: iso(erasesAtMs), next_steps: nextSteps }];
}

const erasesAtOf = (env: Env, game: Game, code: string) => env.DB.prepare("SELECT erases_at_ms FROM kept_rooms WHERE game_id = ? AND room_code = ?").bind(game.id, code).first<{ erases_at_ms: number | null }>();

const noKeptRoom = (game: Game, code: string) => new ApiError("no_kept_room", { message: `${game.slug} has no kept room ${code}.`, field: "room_code", fix: "list_kept_rooms gives this game's kept rooms." });

const noAnswer = () => new ApiError("internal_error", { message: "The kept room didn't answer, so nothing changed.", fix: "Try again in a moment; if it keeps happening, tell Zaisma with post_topic (kind bug, category servers).", retryAfterSec: 10 });

/** The game database's size, which counts with the kept rooms; 0 on a Zaisma without game databases. */
async function databaseSizeBytes(env: Env, game: Game): Promise<number> {
  if (!env.GAME_DATABASES) return 0;
  const answer = await env.GAME_DATABASES.usage(game.id);
  if ("error" in answer) throw new ApiError("database_unavailable", { message: "The game's database didn't answer, so its storage can't be counted.", fix: "Try again in a moment; if it keeps happening, tell Zaisma with post_topic (kind bug, category servers).", retryAfterSec: 10 });
  return answer.queryResult.storageSizeBytes;
}
