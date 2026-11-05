import { isRoomCode } from "@zaisma/game-server";
import {
  ApiError,
  KEPT_ROOM_RESTORE_LIMITS,
  audit,
  earliestKeptRoomRestorableAtMs,
  isPastLevel,
  iso,
  keptRoomRestoreBatchById,
  newId,
  recentKeptRoomRestores,
  runningKeptRoomRestoreBatch,
  type Game,
  type KeptRoomRestore,
  type KeptRoomRestoreBatch,
} from "@zaisma/core";
import type { Caller, CheckedCall, NextStep } from "./developer.ts";
import type { KeptRoomRestoreOutcome } from "../../rooms/src/kept-room-restores.ts";
import type { Env } from "./env.ts";
import { readRestoreToAtMs } from "./game-database.ts";
import { logCallerEvent } from "./security-log.ts";

/**
 * Kept rooms' worlds back to a moment in the last 30 days, one world or every world of a game at once, and the undo of that. The
 * rooms do the restoring (apps/rooms/src/kept-room-restores.ts); a game's whole set of worlds goes a page at a time on the
 * zaisma-backup queue, since a game can have thousands. Free, like a database restore: what a room does counts as it always does.
 *
 *   GET  /api/dev/games/:slug/kept-rooms/:room_code/restores                                what the world can go back to, and its restores
 *   POST /api/dev/games/:slug/kept-rooms/:room_code/restores                                back to a moment: { "restore_to_at" }
 *   POST /api/dev/games/:slug/kept-rooms/:room_code/restores/:kept_room_restore_id/undo     back to just before a restore
 *   POST /api/dev/games/:slug/kept-room-restores                                            every world back to a moment: { "restore_to_at" }
 *   GET  /api/dev/games/:slug/kept-room-restores/:kept_room_restore_batch_id                how a batch went
 *   POST /api/dev/games/:slug/kept-room-restores/:kept_room_restore_batch_id/undo           every world in a batch back to just before it
 */

const DAY_MS = 86_400_000;

/** One page of a batch, as a message on the zaisma-backup queue: worlds after after_room_code. */
export interface KeptRoomRestorePagePart {
  part_kind: "kept_room_restore_page";
  game_id: string;
  slug: string;
  kept_room_restore_batch_id: string;
  after_room_code: string;
}

const restoreJson = (restore: KeptRoomRestore) => ({
  id: restore.id,
  room_code: restore.room_code,
  restore_to_at: iso(restore.restore_to_at_ms)!,
  restored_at: iso(restore.restored_at_ms)!,
  undoes_kept_room_restore_id: restore.undoes_kept_room_restore_id,
  kept_room_restore_batch_id: restore.kept_room_restore_batch_id,
  undo_expires_at: iso(restore.restored_at_ms + KEPT_ROOM_RESTORE_LIMITS.restorableDurationDays * DAY_MS)!,
});

const batchJson = (batch: KeptRoomRestoreBatch, failedRoomCodes: string[]) => ({
  id: batch.id,
  restore_to_at: iso(batch.restore_to_at_ms)!,
  started_at: iso(batch.started_at_ms)!,
  finished_at: iso(batch.finished_at_ms),
  undoes_kept_room_restore_batch_id: batch.undoes_kept_room_restore_batch_id,
  undo_expires_at: iso(batch.started_at_ms + KEPT_ROOM_RESTORE_LIMITS.restorableDurationDays * DAY_MS)!,
  kept_room_count: batch.kept_room_count,
  restored_room_count: batch.restored_room_count,
  skipped_room_count: batch.skipped_room_count,
  failed_room_count: batch.failed_room_count,
  failed_room_codes: failedRoomCodes,
});

const unavailable = () =>
  new ApiError("kept_room_restore_unavailable", {
    message: "This Zaisma's rooms keep no history to go back to, like a local preview's.",
    fix: "On zaisma.com it works. On the developer's own server, the Node runner's server.restoreKeptRoom does it from its own copies.",
  });

const noAnswer = () => new ApiError("internal_error", { message: "The kept room didn't answer, so nothing changed.", fix: "Try again in a moment; if it keeps happening, tell Zaisma with post_topic (kind bug, category servers).", retryAfterSec: 10 });

const noKeptRoom = (game: Game, code: string) => new ApiError("no_kept_room", { message: `${game.slug} has no kept room ${code} that isn't deleted.`, field: "room_code", fix: "list_kept_rooms gives this game's kept rooms and says which wait to be erased: bring_back_kept_room first." });

const tooMany = () => new ApiError("slow_down", { message: "Too many restores of this world in the last minute.", fix: "Wait a minute: up to 5 restores and undos a minute per world.", retryAfterSec: 60 });

/** One call, once the router (developer.ts, checkCall) has checked the key and the game. */
export async function keptRoomRestoresRoute(env: Env, game: Game, path: string, caller: Caller, checked: CheckedCall, method: string): Promise<[unknown, number?]> {
  if (path.startsWith("/games/:slug/kept-room-restores")) return batchRoute(env, game, path, caller, checked, method);
  const code = (checked.pathValues.room_code ?? "").toUpperCase();
  if (!isRoomCode(code)) throw new ApiError("bad_room_code", { message: `room_code ${JSON.stringify((checked.pathValues.room_code ?? "").slice(0, 20))} isn't a room code.`, field: "room_code", fix: "Give a kept room's code from list_kept_rooms, like K7Q2MX." });
  if (method === "GET") return listRestores(env, game, code);
  const service = env.GAME_ROOMS;
  if (!service) throw unavailable();
  const undoId = path.endsWith("/undo") ? (checked.pathValues.kept_room_restore_id ?? "") : null;
  const restoreToAtMs = undoId === null ? readRestoreToAtMs(game, checked.body.restore_to_at) : null;
  const outcome = (undoId === null
    ? await service.restoreKeptRoom({ gameId: game.id, slug: game.slug, roomCode: code, restoreToAtMs: restoreToAtMs! })
    : await service.undoKeptRoomRestore({ gameId: game.id, slug: game.slug, roomCode: code, keptRoomRestoreId: undoId })) as KeptRoomRestoreOutcome;
  if (outcome.outcome === "no_kept_room") throw noKeptRoom(game, code);
  if (outcome.outcome === "no_kept_room_restore") throw new ApiError("no_kept_room_restore", { message: `Kept room ${code} of ${game.slug} has no restore ${undoId} that can still be undone.`, field: "kept_room_restore_id", fix: `Use an id from list_kept_room_restores: an undo reaches back ${KEPT_ROOM_RESTORE_LIMITS.restorableDurationDays} days.` });
  if (outcome.outcome === "no_history") throw unavailable();
  if (outcome.outcome === "limited") throw tooMany();
  if (outcome.outcome === "bad_time") {
    throw new ApiError("bad_time", {
      message: `restore_to_at is before this world can go back to, ${iso(outcome.earliestRestoreToAtMs)}: that's when it was kept, or 30 days ago.`,
      field: "restore_to_at",
      fix: `Give a time from ${iso(outcome.earliestRestoreToAtMs)} to now. list_kept_room_restores says the earliest.`,
    });
  }
  if (outcome.outcome !== "restored") throw noAnswer();
  const restore = outcome.keptRoomRestore;
  await audit(env.DB, game.id, undoId === null ? "kept-room-restored" : "kept-room-restore-undone", `${code} to ${iso(restore.restore_to_at_ms)}`, caller.actor);
  await logRestoredWorld(env, caller, game, code);
  const liveVersion = await liveVersionPublishedSince(env, game, restore.restore_to_at_ms);
  const nextSteps: NextStep[] = [
    ...liveVersion.nextSteps,
    ...(undoId === null ? [{ tool: "undo_kept_room_restore", arguments: { slug: game.slug, room_code: code, kept_room_restore_id: restore.id }, after_sec: null, reason: `Undo it if it went back too far: within ${KEPT_ROOM_RESTORE_LIMITS.restorableDurationDays} days.` }] : []),
    { tool: "list_kept_room_restores", arguments: { slug: game.slug, room_code: code }, after_sec: null, reason: "This world's restores, and how far back it can go." },
  ];
  return [{ kept_room_restore: restoreJson(restore), live_version_published_since: liveVersion.published, next_steps: nextSteps }];
}

async function listRestores(env: Env, game: Game, code: string): Promise<[unknown, number?]> {
  const row = await env.DB.prepare("SELECT created_at_ms, erases_at_ms FROM kept_rooms WHERE game_id = ? AND room_code = ?").bind(game.id, code).first<{ created_at_ms: number; erases_at_ms: number | null }>();
  if (!row || row.erases_at_ms !== null) throw noKeptRoom(game, code);
  return [{ earliest_restore_to_at: iso(Math.max(row.created_at_ms, earliestKeptRoomRestorableAtMs()))!, restores: (await recentKeptRoomRestores(env.DB, game.id, code)).map(restoreJson) }];
}

/** One event per restore: when a key or an AI app did it, the first in a day per game is the alert the developer hears, as for deleted worlds. */
async function logRestoredWorld(env: Env, caller: Caller, game: Game, subjectName: string): Promise<void> {
  const alerted = caller.via === "dashboard" || (await env.DB.prepare("SELECT 1 AS is_alerted FROM security_events WHERE account_id = ? AND game_id = ? AND kind = 'kept_rooms_restored' AND happened_at_ms > ? LIMIT 1").bind(caller.accountId, game.id, Date.now() - DAY_MS).first());
  await logCallerEvent(env, caller, alerted ? "kept_room_restored" : "kept_rooms_restored", { gameId: game.id, subjectName });
}

/**
 * The live version when it went live after the moment, since it could damage the world again, and the call that goes back to the
 * version live at the moment. A rollback moves a version's published_at_ms, so that's the newest published by then.
 */
async function liveVersionPublishedSince(env: Env, game: Game, restoreToAtMs: number): Promise<{ published: { version_id: string; published_at: string; message: string } | null; nextSteps: NextStep[] }> {
  if (!game.live_version_id || game.live_version_published_at_ms === null || game.live_version_published_at_ms <= restoreToAtMs) return { published: null, nextSteps: [] };
  const earlier = await env.DB.prepare("SELECT id FROM versions WHERE game_id = ? AND id != ? AND published_at_ms IS NOT NULL AND published_at_ms <= ? ORDER BY published_at_ms DESC LIMIT 1").bind(game.id, game.live_version_id, restoreToAtMs).first<{ id: string }>();
  return {
    published: {
      version_id: game.live_version_id,
      published_at: iso(game.live_version_published_at_ms)!,
      message: "The live version went live after this moment. If it did the damage, it can do it again: publish an earlier version too.",
    },
    nextSteps: earlier ? [{ tool: "publish_version", arguments: { slug: game.slug, version_id: earlier.id }, after_sec: null, reason: "The version live at that moment, if the live one did the damage." }] : [],
  };
}

async function batchRoute(env: Env, game: Game, path: string, caller: Caller, checked: CheckedCall, method: string): Promise<[unknown, number?]> {
  const nowMs = Date.now();
  const batchId = checked.pathValues.kept_room_restore_batch_id ?? null;
  const named = batchId === null ? null : await keptRoomRestoreBatchById(env.DB, game.id, batchId, nowMs);
  if (batchId !== null && !named) throw new ApiError("no_kept_room_restore_batch", { message: `${game.slug} has no batch ${batchId} from the last ${KEPT_ROOM_RESTORE_LIMITS.restorableDurationDays} days.`, field: "kept_room_restore_batch_id", fix: "Use the id restore_every_kept_room answered." });
  if (method === "GET") return [{ kept_room_restore_batch: await batchAnswer(env, named!) }];
  if (!env.GAME_ROOMS || !env.BACKUP_QUEUE) throw unavailable();
  const running = await runningKeptRoomRestoreBatch(env.DB, game.id);
  if (running) throw new ApiError("kept_room_restore_batch_running", { message: `${game.slug}'s worlds are going back to ${iso(running.restore_to_at_ms)} now.`, fix: "Wait for it to finish: get_kept_room_restore_batch says how it's going.", retryAfterSec: 30 });
  if (await isPastLevel(env, "guess", "kept_room_restore_batch", game.id)) throw new ApiError("slow_down", { message: "Too many restores of this game's worlds in the last minute.", fix: "Wait a minute: up to 5 a minute per game.", retryAfterSec: 60 });
  const isUndo = path.endsWith("/undo");
  const restoreToAtMs = isUndo ? named!.started_at_ms : readRestoreToAtMs(game, checked.body.restore_to_at, nowMs);
  const countRow = isUndo
    ? await env.DB.prepare("SELECT COUNT(*) AS found_count FROM kept_room_restores WHERE kept_room_restore_batch_id = ?").bind(named!.id).first<{ found_count: number }>()
    : await env.DB.prepare("SELECT COUNT(*) AS found_count FROM kept_rooms WHERE game_id = ?").bind(game.id).first<{ found_count: number }>();
  const batch: KeptRoomRestoreBatch = {
    id: newId("kept_room_restore_batch"),
    game_id: game.id,
    restore_to_at_ms: restoreToAtMs,
    undoes_kept_room_restore_batch_id: named?.id ?? null,
    started_at_ms: nowMs,
    finished_at_ms: countRow?.found_count ? null : nowMs,
    kept_room_count: countRow?.found_count ?? 0,
    restored_room_count: 0,
    skipped_room_count: 0,
    failed_room_count: 0,
  };
  await env.DB.prepare("INSERT INTO kept_room_restore_batches (id, game_id, restore_to_at_ms, undoes_kept_room_restore_batch_id, started_at_ms, finished_at_ms, kept_room_count) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(batch.id, batch.game_id, batch.restore_to_at_ms, batch.undoes_kept_room_restore_batch_id, batch.started_at_ms, batch.finished_at_ms, batch.kept_room_count)
    .run();
  if (batch.finished_at_ms === null) await env.BACKUP_QUEUE.send({ part_kind: "kept_room_restore_page", game_id: game.id, slug: game.slug, kept_room_restore_batch_id: batch.id, after_room_code: "" });
  await audit(env.DB, game.id, isUndo ? "kept-rooms-restore-undone" : "kept-rooms-restored", `every world to ${iso(restoreToAtMs)}`, caller.actor);
  await logRestoredWorld(env, caller, game, "every world");
  const liveVersion = await liveVersionPublishedSince(env, game, restoreToAtMs);
  const nextSteps: NextStep[] = [
    { tool: "get_kept_room_restore_batch", arguments: { slug: game.slug, kept_room_restore_batch_id: batch.id }, after_sec: 30, reason: "How it's going: a few hundred worlds a minute." },
    ...liveVersion.nextSteps,
    ...(isUndo
      ? []
      : [
          { tool: "restore_database", arguments: { slug: game.slug, restore_to_at: iso(restoreToAtMs)! }, after_sec: null, reason: "The game's database to the same moment, if a bad update damaged it too. It's a separate call on purpose." },
          { tool: "undo_every_kept_room_restore", arguments: { slug: game.slug, kept_room_restore_batch_id: batch.id }, after_sec: null, reason: `Undo it if it went back too far: within ${KEPT_ROOM_RESTORE_LIMITS.restorableDurationDays} days.` },
        ]),
  ];
  return [{ kept_room_restore_batch: batchJson(batch, []), live_version_published_since: liveVersion.published, next_steps: nextSteps }, 202];
}

async function batchAnswer(env: Env, batch: KeptRoomRestoreBatch) {
  const { results } = await env.DB.prepare("SELECT room_code FROM kept_room_restore_failures WHERE kept_room_restore_batch_id = ? ORDER BY room_code LIMIT ?").bind(batch.id, KEPT_ROOM_RESTORE_LIMITS.listedFailedRoomCount).all<{ room_code: string }>();
  return batchJson(batch, results.map((row) => row.room_code));
}

/**
 * One page of a batch: each world goes back through the rooms' one flow, 50 at once. Worlds waiting to be erased and worlds kept after
 * the moment have nothing to go back to, so they're skipped. A world already done (the message tried again) is left alone. The batch's
 * counts are read from what happened, so a page tried again never counts twice.
 */
export async function restoreKeptRoomPage(env: Env, part: KeptRoomRestorePagePart): Promise<void> {
  const batch = await env.DB.prepare("SELECT * FROM kept_room_restore_batches WHERE id = ?").bind(part.kept_room_restore_batch_id).first<KeptRoomRestoreBatch>();
  if (!batch || batch.finished_at_ms !== null || !env.GAME_ROOMS) return;
  const service = env.GAME_ROOMS;
  const game = { gameId: part.game_id, slug: part.slug };
  const undone = batch.undoes_kept_room_restore_batch_id;
  const { results: rooms } = undone
    ? await env.DB.prepare("SELECT kept_room_restores.room_code, kept_room_restores.id AS kept_room_restore_id, kept_rooms.created_at_ms, kept_rooms.erases_at_ms FROM kept_room_restores LEFT JOIN kept_rooms ON kept_rooms.game_id = kept_room_restores.game_id AND kept_rooms.room_code = kept_room_restores.room_code WHERE kept_room_restores.kept_room_restore_batch_id = ? AND kept_room_restores.room_code > ? ORDER BY kept_room_restores.room_code LIMIT ?")
        .bind(undone, part.after_room_code, KEPT_ROOM_RESTORE_LIMITS.batchPageRoomCount)
        .all<{ room_code: string; kept_room_restore_id: string; created_at_ms: number | null; erases_at_ms: number | null }>()
    : await env.DB.prepare("SELECT room_code, NULL AS kept_room_restore_id, created_at_ms, erases_at_ms FROM kept_rooms WHERE game_id = ? AND room_code > ? ORDER BY room_code LIMIT ?")
        .bind(part.game_id, part.after_room_code, KEPT_ROOM_RESTORE_LIMITS.batchPageRoomCount)
        .all<{ room_code: string; kept_room_restore_id: string | null; created_at_ms: number | null; erases_at_ms: number | null }>();
  const { results: done } = await env.DB.prepare("SELECT room_code FROM kept_room_restores WHERE kept_room_restore_batch_id = ? AND room_code > ? ORDER BY room_code LIMIT ?").bind(batch.id, part.after_room_code, KEPT_ROOM_RESTORE_LIMITS.batchPageRoomCount).all<{ room_code: string }>();
  const doneCodes = new Set(done.map((row) => row.room_code));
  const due = rooms.filter((room) => !doneCodes.has(room.room_code) && room.created_at_ms !== null && room.erases_at_ms === null && (undone !== null || room.created_at_ms <= batch.restore_to_at_ms));
  for (let index = 0; index < due.length; index += KEPT_ROOM_RESTORE_LIMITS.restoredAtOnceCount) {
    await Promise.all(
      due.slice(index, index + KEPT_ROOM_RESTORE_LIMITS.restoredAtOnceCount).map(async (room) => {
        const outcome = await (room.kept_room_restore_id
          ? service.undoKeptRoomRestore({ ...game, roomCode: room.room_code, keptRoomRestoreId: room.kept_room_restore_id, batchId: batch.id })
          : service.restoreKeptRoom({ ...game, roomCode: room.room_code, restoreToAtMs: batch.restore_to_at_ms, batchId: batch.id })
        ).catch((error) => {
          console.error("A kept room's part of a batch failed:", room.room_code, error);
          return { outcome: "failed" as const };
        });
        if (outcome.outcome === "failed" || outcome.outcome === "no_history") {
          await env.DB.prepare("INSERT OR IGNORE INTO kept_room_restore_failures (kept_room_restore_batch_id, room_code, failed_at_ms) VALUES (?, ?, ?)").bind(batch.id, room.room_code, Date.now()).run();
        }
      }),
    );
  }
  const isLastPage = rooms.length < KEPT_ROOM_RESTORE_LIMITS.batchPageRoomCount;
  await env.DB.prepare(
    `UPDATE kept_room_restore_batches SET
       restored_room_count = (SELECT COUNT(*) FROM kept_room_restores WHERE kept_room_restore_batch_id = ?1),
       failed_room_count = (SELECT COUNT(*) FROM kept_room_restore_failures WHERE kept_room_restore_batch_id = ?1),
       skipped_room_count = CASE WHEN ?2 THEN kept_room_count - (SELECT COUNT(*) FROM kept_room_restores WHERE kept_room_restore_batch_id = ?1) - (SELECT COUNT(*) FROM kept_room_restore_failures WHERE kept_room_restore_batch_id = ?1) ELSE skipped_room_count END,
       finished_at_ms = CASE WHEN ?2 THEN ?3 ELSE NULL END
     WHERE id = ?1`,
  )
    .bind(batch.id, isLastPage ? 1 : 0, Date.now())
    .run();
  if (!isLastPage) await env.BACKUP_QUEUE!.send({ ...part, after_room_code: rooms.at(-1)!.room_code });
}
