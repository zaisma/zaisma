import {
  deleteAccount,
  imageById,
  queueGameDeletion,
  readQualityChecks,
  recordPlayerErased,
  setReviewStatus,
  settleImage,
  settleShader,
  shaderById,
  stopSocial,
  type GameDeletionRequestedByKind,
  type ReviewReason,
  type ZaismaPlayerReportReason,
} from "@zaisma/core";
import type { BackupStorage } from "./backup-storage.ts";
import type { Env } from "./env.ts";

/**
 * Takedowns and deletions kept outside Cloudflare as they happen (docs/DECISIONS.md, "A copy outside Cloudflare
 * that nobody can delete"): a restore loads the last night's main database, so without them a takedown, a
 * deletion or a report upheld since that night would come back with it. Each event goes on the zaisma-backup
 * queue (recordRestoreEvent), so a Backblaze outage never fails the takedown itself, and the queue writes it to
 * restore-events/<at_ms>-<random>.json in the Object-Locked backups bucket (backups.ts), where nobody can delete
 * it for 28 days. A restore replays every event since its night began, oldest first, before it copies anything
 * back (replayRestoreEvents), so the copy's owner rules (restore-rules.ts) then keep the deleted keys out. Every
 * replay is safe to do twice.
 */
export type RestoreEvent =
  | { event_kind: "game_held" | "game_removed"; at_ms: number; game_id: string; review_reason: ReviewReason }
  | { event_kind: "game_deletion_queued"; at_ms: number; game_id: string; requested_by_kind: GameDeletionRequestedByKind }
  | { event_kind: "account_deleted"; at_ms: number; account_id: string }
  | { event_kind: "image_rejected"; at_ms: number; image_id: string; review_reason: ReviewReason }
  | { event_kind: "shader_rejected"; at_ms: number; shader_id: string; review_reason: ReviewReason }
  | { event_kind: "social_stopped"; at_ms: number; account_id: string; social_stopped_reason: ZaismaPlayerReportReason }
  | { event_kind: "player_erased"; at_ms: number; game_id: string; player_id: string };

export const RESTORE_EVENT_PREFIX = "restore-events/";

/** An event's key in the backups bucket: by its time, so a restore lists the ones since its night in order. */
export const restoreEventKey = (event: RestoreEvent) => `${RESTORE_EVENT_PREFIX}${String(event.at_ms).padStart(15, "0")}-${Array.from(crypto.getRandomValues(new Uint8Array(4)), (byte) => byte.toString(16).padStart(2, "0")).join("")}.json`;

/**
 * Keeps a takedown or deletion for a restore, right after it's made. It never fails what it records: with no
 * queue or no backup key it says so in the log, and the queue tries the copy again (backups.ts).
 */
export async function recordRestoreEvent(env: Env, event: RestoreEvent): Promise<void> {
  if (!env.BACKUP_QUEUE || !env.BACKUP_ENDPOINT) {
    console.error("A restore event wasn't kept: no backup queue", event);
    return;
  }
  try {
    await env.BACKUP_QUEUE.send({ part_kind: "restore_event", event });
  } catch (error) {
    console.error("A restore event wasn't kept: the backup queue refused it", event, error);
  }
}

/**
 * Does again, oldest first, every event kept since sinceMs, in the restored database: what a restore runs
 * before it copies anything back. One whose game, account, image or shader isn't in the restored database
 * is skipped. Answers how many it replayed.
 */
export async function replayRestoreEvents(env: Env, storage: BackupStorage, sinceMs: number): Promise<number> {
  let replayedEventCount = 0;
  // Keys sort by time: listing starts just before the first that can count.
  let afterKey: string | null = `${RESTORE_EVENT_PREFIX}${String(Math.max(sinceMs - 1, 0)).padStart(15, "0")}`;
  do {
    const page = await storage.listVersionPage(RESTORE_EVENT_PREFIX, afterKey);
    for (const version of page.versions) {
      if (version.isHidden) continue;
      const object = await storage.getObject(version.key, version.versionId);
      const event = JSON.parse(await new Response(object.body).text()) as RestoreEvent;
      if (event.at_ms < sinceMs) continue;
      if (await replayRestoreEvent(env, event)) replayedEventCount++;
    }
    afterKey = page.nextAfterKey;
  } while (afterKey);
  return replayedEventCount;
}

/** One event done again; false when what it was about isn't in the restored database. */
export async function replayRestoreEvent(env: Env, event: RestoreEvent): Promise<boolean> {
  const exists = async (sql: string, id: string) => (await env.DB.prepare(sql).bind(id).first()) !== null;
  switch (event.event_kind) {
    case "game_held": {
      const game = await env.DB.prepare("SELECT review_status FROM games WHERE id = ?").bind(event.game_id).first<{ review_status: string }>();
      if (!game) return false;
      // A game taken down since stays down: a hold never brings it back.
      if (game.review_status !== "removed") await setReviewStatus(env.DB, event.game_id, "held", event.review_reason);
      return true;
    }
    case "game_removed":
      if (!(await exists("SELECT 1 FROM games WHERE id = ?", event.game_id))) return false;
      await setReviewStatus(env.DB, event.game_id, "removed", event.review_reason);
      return true;
    case "game_deletion_queued":
      if (!(await exists("SELECT 1 FROM games WHERE id = ?", event.game_id))) return false;
      await queueGameDeletion(env.DB, event.game_id, event.requested_by_kind, event.at_ms);
      return true;
    case "account_deleted":
      if (!(await exists("SELECT 1 FROM accounts WHERE id = ?", event.account_id))) return false;
      await deleteAccount(env.DB, event.account_id);
      return true;
    case "image_rejected": {
      const image = await imageById(env.DB, event.image_id);
      if (!image) return false;
      await settleImage(env.DB, image, event.review_reason);
      return true;
    }
    case "shader_rejected": {
      const shader = await shaderById(env.DB, event.shader_id);
      if (!shader) return false;
      await settleShader(env.DB, shader, event.review_reason, shader.quality_checks === null ? null : readQualityChecks(shader.quality_checks), shader.flash_count);
      return true;
    }
    case "social_stopped": {
      const account = await env.DB.prepare("SELECT social_stopped_at_ms FROM accounts WHERE id = ?").bind(event.account_id).first<{ social_stopped_at_ms: number | null }>();
      if (!account) return false;
      if (account.social_stopped_at_ms === null) await stopSocial(env.DB, event.account_id, event.social_stopped_reason, event.at_ms);
      return true;
    }
    case "player_erased":
      if (!(await exists("SELECT 1 FROM games WHERE id = ?", event.game_id))) return false;
      // The restore's copy of the game's database erases every player erased since (restore.ts).
      await recordPlayerErased(env.DB, event.game_id, event.player_id, event.at_ms);
      return true;
  }
}
