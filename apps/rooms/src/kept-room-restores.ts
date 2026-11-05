import { addKeptRoomRestore, earliestKeptRoomRestorableAtMs, isPastLevel, keptRoomRestoreById, newId, playersErasedSince, recentKeptRoomRestores, type KeptRoomRestore } from "@zaisma/core";
import type { Env } from "./index.ts";

/**
 * A kept room's world going back to a moment in the last 30 days, and the undo of that: one flow for the developer API
 * (GameRoomsService) and game servers (roomReachOf, RoomReachBinding), so they behave the same. Cloudflare's point-in-time
 * recovery does the restoring, as for a game's database (database.ts). The room saves and records its use, sets the restore for
 * its next start and answers the bookmark that undoes it; the record goes in D1 before anything can't be taken back; then the
 * room restarts, its players drop and reconnect, and the restored room takes what must not go back with it (room.ts, carrying).
 */

/** Tries for the restored object to take what's carried: the old one refuses it for a moment as it goes. */
const CARRY_ATTEMPT_COUNT = 10;

/** A game as restoring its worlds needs it: its ID, and its slug, which names its rooms' objects. */
export interface RestoredGame {
  gameId: string;
  slug: string;
}

/** Why a restore wasn't made, or the restore. */
export type KeptRoomRestoreOutcome =
  | { outcome: "restored"; keptRoomRestore: KeptRoomRestore }
  | { outcome: "no_kept_room" | "no_kept_room_restore" | "no_history" | "limited" | "failed" }
  | { outcome: "bad_time"; earliestRestoreToAtMs: number };

/** What the room hands back to the restored room: who sits in it now and what they own, which are about now, not the moment. */
export interface CarriedOverRestore {
  seatedPlayerIds: string[] | null;
  ownedItemNamesByPlayerId: Record<string, string[]>;
}

/** What a restored room tells its game server, once. */
export interface ToldKeptRoomRestore {
  /** Null for a deleted world brought back from its last copy, which has no undo. */
  id: string | null;
  restoreToAtMs: number;
  restoredAtMs: number;
  undoesKeptRoomRestoreId: string | null;
  erasedPlayerIds: string[];
}

const roomObject = (env: Env, game: RestoredGame, roomCode: string) => env.ROOMS.get(env.ROOMS.idFromName(`${game.slug}:${roomCode}`));

const post = (env: Env, game: RestoredGame, roomCode: string, path: string, body: unknown) => roomObject(env, game, roomCode).fetch(`https://room/kept-room-restore/${path}`, { method: "POST", headers: { "x-game-id": game.gameId }, body: JSON.stringify(body) });

/** The earliest moment this world can go back to now: the last 30 days, and not before it was kept. */
export const earliestRestoreToAtMs = (createdAtMs: number, nowMs = Date.now()) => Math.max(createdAtMs, earliestKeptRoomRestorableAtMs(nowMs));

/** Puts one world back as it was at a moment. isLimited: counted toward a world's 5 a minute (a batch asks each world once). */
export async function restoreKeptRoom(env: Env, game: RestoredGame, roomCode: string, restoreToAtMs: number, options: { batchId?: string | null; isLimited?: boolean } = {}): Promise<KeptRoomRestoreOutcome> {
  const row = await env.DB.prepare("SELECT created_at_ms, erases_at_ms FROM kept_rooms WHERE game_id = ? AND room_code = ?").bind(game.gameId, roomCode).first<{ created_at_ms: number; erases_at_ms: number | null }>();
  if (!row || row.erases_at_ms !== null) return { outcome: "no_kept_room" };
  const nowMs = Date.now();
  const earliestAtMs = earliestRestoreToAtMs(row.created_at_ms, nowMs);
  if (restoreToAtMs < earliestAtMs || restoreToAtMs > nowMs) return { outcome: "bad_time", earliestRestoreToAtMs: earliestAtMs };
  if (options.isLimited !== false && (await isPastLevel(env, "guess", "kept_room_restore", `${game.gameId}:${roomCode}`))) return { outcome: "limited" };
  return restart(env, game, roomCode, { restoreToAtMs }, { restoreToAtMs, undone: null, batchId: options.batchId ?? null });
}

/** Puts one world back as it was just before an earlier restore. */
export async function undoKeptRoomRestore(env: Env, game: RestoredGame, roomCode: string, keptRoomRestoreId: string, options: { batchId?: string | null; isLimited?: boolean } = {}): Promise<KeptRoomRestoreOutcome> {
  const undone = await keptRoomRestoreById(env.DB, game.gameId, roomCode, keptRoomRestoreId);
  if (!undone) return { outcome: "no_kept_room_restore" };
  const row = await env.DB.prepare("SELECT erases_at_ms FROM kept_rooms WHERE game_id = ? AND room_code = ?").bind(game.gameId, roomCode).first<{ erases_at_ms: number | null }>();
  if (!row || row.erases_at_ms !== null) return { outcome: "no_kept_room" };
  if (options.isLimited !== false && (await isPastLevel(env, "guess", "kept_room_restore", `${game.gameId}:${roomCode}`))) return { outcome: "limited" };
  return restart(env, game, roomCode, { bookmark: undone.undo_bookmark }, { restoreToAtMs: undone.restored_at_ms, undone, batchId: options.batchId ?? null });
}

/** The world's restores and the earliest moment it can go back to, or null when it isn't a kept world that's there now. */
export async function listKeptRoomRestores(env: Env, game: RestoredGame, roomCode: string): Promise<{ earliestRestoreToAtMs: number; restores: KeptRoomRestore[] } | null> {
  const row = await env.DB.prepare("SELECT created_at_ms, erases_at_ms FROM kept_rooms WHERE game_id = ? AND room_code = ?").bind(game.gameId, roomCode).first<{ created_at_ms: number; erases_at_ms: number | null }>();
  if (!row || row.erases_at_ms !== null) return null;
  return { earliestRestoreToAtMs: earliestRestoreToAtMs(row.created_at_ms), restores: await recentKeptRoomRestores(env.DB, game.gameId, roomCode) };
}

async function restart(env: Env, game: RestoredGame, roomCode: string, target: { restoreToAtMs: number } | { bookmark: string }, restoring: { restoreToAtMs: number; undone: KeptRoomRestore | null; batchId: string | null }): Promise<KeptRoomRestoreOutcome> {
  const restoredAtMs = Date.now();
  let prepared: Response;
  try {
    prepared = await post(env, game, roomCode, "prepare", target);
  } catch (error) {
    console.error("A kept room didn't take a restore:", roomCode, error);
    return { outcome: "failed" };
  }
  if (prepared.status === 404) return { outcome: "no_kept_room" };
  if (prepared.status === 501) return { outcome: "no_history" };
  if (!prepared.ok) return { outcome: "failed" };
  const { undoBookmark, carried } = (await prepared.json()) as { undoBookmark: string; carried: CarriedOverRestore };
  const keptRoomRestore: KeptRoomRestore = {
    id: newId("kept_room_restore"),
    game_id: game.gameId,
    room_code: roomCode,
    restore_to_at_ms: restoring.restoreToAtMs,
    undo_bookmark: undoBookmark,
    undoes_kept_room_restore_id: restoring.undone?.id ?? null,
    kept_room_restore_batch_id: restoring.batchId,
    restored_at_ms: restoredAtMs,
  };
  // The record and who to tell are read before it happens: it can't be taken back, so if D1 refuses, the world goes back to now.
  let erasedPlayerIds: string[];
  try {
    await addKeptRoomRestore(env.DB, keptRoomRestore);
    erasedPlayerIds = await playersErasedSince(env.DB, game.gameId, restoring.restoreToAtMs);
  } catch (error) {
    console.error("Couldn't keep a kept room's restore, so it didn't happen:", error);
    await post(env, game, roomCode, "abandon", { undoBookmark }).catch((abandonError) => console.error("Couldn't take a prepared kept room restore back:", abandonError));
    await restartAndCarry(env, game, roomCode, { carried, told: null });
    return { outcome: "failed" };
  }
  await restartAndCarry(env, game, roomCode, {
    carried,
    told: { id: keptRoomRestore.id, restoreToAtMs: keptRoomRestore.restore_to_at_ms, restoredAtMs, undoesKeptRoomRestoreId: keptRoomRestore.undoes_kept_room_restore_id, erasedPlayerIds } satisfies ToldKeptRoomRestore,
  });
  return { outcome: "restored", keptRoomRestore };
}

async function restartAndCarry(env: Env, game: RestoredGame, roomCode: string, carrying: { carried: CarriedOverRestore; told: ToldKeptRoomRestore | null }): Promise<void> {
  await post(env, game, roomCode, "restart", {}).catch(() => {
    // The restart ends the call: that's the restore happening.
  });
  // Until the restored object takes it (the old one refuses), nothing else should reach it first.
  for (let attemptNumber = 1; attemptNumber <= CARRY_ATTEMPT_COUNT; attemptNumber++) {
    try {
      const carriedAnswer = await post(env, game, roomCode, "carry", carrying);
      if (carriedAnswer.ok) return;
    } catch {
      // The object going away: the next try reaches the restored one.
    }
    if (attemptNumber === CARRY_ATTEMPT_COUNT) console.error("Couldn't carry what a kept room's restore keeps:", roomCode);
    else await new Promise((resolve) => setTimeout(resolve, attemptNumber * 50));
  }
}
