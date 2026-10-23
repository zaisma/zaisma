// Deleting a game for good: when its developer deletes their account, or when Zaisma deletes a game an
// account left behind (docs/DECISIONS.md, "Making an account takes a birthday, a username and a password,
// nothing else"). The game stops being playable at once and its link name is retired; its storage is
// deleted a step at a time by apps/site/src/game-deletion.ts, tried again while something doesn't answer.
import { KNOWN_IMAGE_CODE } from "./scan/images.ts";
import { reviewReason } from "./review.ts";
import { WEBHOOK_RETRY_DELAYS_MIN } from "./webhooks.ts";

const now = () => Date.now();

/** Who asked for a game to be deleted: its developer, by deleting their account, or Zaisma, from the admin page. */
export type GameDeletionRequestedByKind = "account_deleted" | "zaisma";

export interface GameDeletion {
  game_id: string;
  requested_by_kind: GameDeletionRequestedByKind;
  deletion_status: "pending";
  attempt_count: number;
  next_attempt_at_ms: number;
  failure_message: string | null;
  created_at_ms: number;
}

/**
 * True for a game that has ever been under a child-safety hold no person cleared: a held, scanning or
 * rejected version an AI flagged for child safety, any version with known abuse material, a child-safety
 * report that wasn't dismissed, or an image held by matching. Such a game is never deleted with its
 * developer's account: it's kept whole for Zaisma, since the law may need it kept. `gameIdSql` names the
 * game's ID in the surrounding query (a column, or ?1).
 */
export function childSafetyKeptCondition(gameIdSql: string): string {
  return `(EXISTS (SELECT 1 FROM versions kept_version WHERE kept_version.game_id = ${gameIdSql} AND ((kept_version.scan_status IN ('held', 'scanning', 'rejected') AND json_extract(kept_version.scan_report, '$.is_child_safety') = 1) OR EXISTS (SELECT 1 FROM json_each(kept_version.scan_report, '$.findings') kept_finding WHERE json_extract(kept_finding.value, '$.code') = '${KNOWN_IMAGE_CODE}')))`
    + ` OR EXISTS (SELECT 1 FROM reports kept_report WHERE kept_report.game_id = ${gameIdSql} AND (kept_report.reason = 'child_safety' OR kept_report.severity_index = 0) AND kept_report.report_status != 'dismissed')`
    + ` OR EXISTS (SELECT 1 FROM audit_log kept_audit WHERE kept_audit.game_id = ${gameIdSql} AND kept_audit.action = 'image-held'))`;
}

export async function isKeptForChildSafety(database: D1Database, gameId: string): Promise<boolean> {
  return (await database.prepare(`SELECT ${childSafetyKeptCondition("?1")} AS is_kept`).bind(gameId).first<{ is_kept: number }>())?.is_kept === 1;
}

/** What the audit log says of a game kept when its developer deleted their account. */
export const KEPT_FOR_REVIEW_REASON = "Its developer deleted their account; kept because of a child-safety hold.";

/**
 * For deleteAccount's batch, before its owner goes: every game of this owner is taken down with no owner
 * and its link name retired; the ones not kept for child safety are queued for deletion, and the kept
 * ones get a kept-for-review line in the audit log.
 */
export function ownerGameDeletions(database: D1Database, ownerId: string, nowMs = now()): D1PreparedStatement[] {
  const kept = childSafetyKeptCondition("games.id");
  return [
    database.prepare("INSERT OR IGNORE INTO retired_game_slugs (slug, retired_at_ms) SELECT slug, ? FROM games WHERE owner_id = ?").bind(nowMs, ownerId),
    database.prepare(`INSERT INTO audit_log (game_id, action, reason, actor, happened_at_ms) SELECT id, 'kept-for-review', ?, 'system', ? FROM games WHERE owner_id = ? AND ${kept}`).bind(KEPT_FOR_REVIEW_REASON, nowMs, ownerId),
    database
      .prepare(`INSERT OR IGNORE INTO game_deletions (game_id, requested_by_kind, deletion_status, attempt_count, next_attempt_at_ms, created_at_ms) SELECT id, 'account_deleted', 'pending', 0, ?, ? FROM games WHERE owner_id = ? AND NOT ${kept}`)
      .bind(nowMs, nowMs, ownerId),
    database
      .prepare("UPDATE games SET review_status = 'removed', review_reason = ?, owner_id = NULL, updated_at_ms = ? WHERE owner_id = ?")
      .bind(JSON.stringify(reviewReason("developer_account_deleted")), nowMs, ownerId),
  ];
}

/** Zaisma deletes one game for good (one an account left behind): its link name is retired and its deletion queued. */
export async function queueGameDeletion(database: D1Database, gameId: string, requestedByKind: GameDeletionRequestedByKind, nowMs = now()): Promise<void> {
  await database.batch([
    database.prepare("INSERT OR IGNORE INTO retired_game_slugs (slug, retired_at_ms) SELECT slug, ? FROM games WHERE id = ?").bind(nowMs, gameId),
    database
      .prepare("INSERT OR IGNORE INTO game_deletions (game_id, requested_by_kind, deletion_status, attempt_count, next_attempt_at_ms, created_at_ms) VALUES (?, ?, 'pending', 0, ?, ?)")
      .bind(gameId, requestedByKind, nowMs, nowMs),
  ]);
}

export async function gameDeletionOf(database: D1Database, gameId: string): Promise<GameDeletion | null> {
  return database.prepare("SELECT * FROM game_deletions WHERE game_id = ?").bind(gameId).first<GameDeletion>();
}

/** Deletions whose next step is due, oldest first. */
export async function dueGameDeletions(database: D1Database, maximumCount: number, nowMs = now()): Promise<GameDeletion[]> {
  const { results } = await database
    .prepare("SELECT * FROM game_deletions WHERE deletion_status = 'pending' AND next_attempt_at_ms <= ? ORDER BY next_attempt_at_ms LIMIT ?")
    .bind(nowMs, maximumCount)
    .all<GameDeletion>();
  return results;
}

/** How long a run holds a deletion it took, so the cron and an account's own run don't do the same game at once. */
export const GAME_DELETION_CLAIM_DURATION_MS = 10 * 60_000;

/** Take a due deletion for this run; false when another run took it first. */
export async function claimGameDeletion(database: D1Database, deletion: GameDeletion, nowMs = now()): Promise<boolean> {
  const claimed = await database
    .prepare("UPDATE game_deletions SET next_attempt_at_ms = ? WHERE game_id = ? AND next_attempt_at_ms = ?")
    .bind(nowMs + GAME_DELETION_CLAIM_DURATION_MS, deletion.game_id, deletion.next_attempt_at_ms)
    .run();
  return claimed.meta.changes === 1;
}

/**
 * A deletion that didn't finish this time. With no failure, there's simply more to delete: due again at
 * once, no attempt counted. With one, tried again on the webhook schedule, then every day, never given up.
 */
export async function postponeGameDeletion(database: D1Database, deletion: GameDeletion, failureMessage: string | null, nowMs = now()): Promise<void> {
  if (failureMessage === null) {
    await database.prepare("UPDATE game_deletions SET next_attempt_at_ms = ? WHERE game_id = ?").bind(nowMs, deletion.game_id).run();
    return;
  }
  const attemptCount = deletion.attempt_count + 1;
  const delayMin = WEBHOOK_RETRY_DELAYS_MIN[Math.min(attemptCount, WEBHOOK_RETRY_DELAYS_MIN.length) - 1]!;
  await database
    .prepare("UPDATE game_deletions SET attempt_count = ?, next_attempt_at_ms = ?, failure_message = ? WHERE game_id = ?")
    .bind(attemptCount, nowMs + delayMin * 60_000, failureMessage.slice(0, 300), deletion.game_id)
    .run();
}

/** A deletion that won't happen: the game turned out to be kept. */
export async function cancelGameDeletion(database: D1Database, gameId: string): Promise<void> {
  await database.prepare("DELETE FROM game_deletions WHERE game_id = ?").bind(gameId).run();
}

/** True when a game once had this link name and was deleted: it never goes to another game. */
export async function isSlugRetired(database: D1Database, slug: string): Promise<boolean> {
  return (await database.prepare("SELECT 1 AS is_retired FROM retired_game_slugs WHERE slug = ?").bind(slug).first()) !== null;
}

/**
 * The last step, once the game's files, saves and storage are gone: every row about the game, children
 * before what they point at, then the game and its deletion. Confirmed chat is kept for its report until
 * its own expiry, and security events are an account's own log, so neither goes; forum topics stay
 * without their game.
 */
export function gameRowDeletions(database: D1Database, gameId: string): D1PreparedStatement[] {
  const deleteFrom = (table: string) => database.prepare(`DELETE FROM ${table} WHERE game_id = ?`).bind(gameId);
  return [
    database.prepare("UPDATE games SET live_version_id = NULL, game_server_schedules_version_id = NULL WHERE id = ?").bind(gameId),
    database.prepare("UPDATE forum_topics SET game_id = NULL WHERE game_id = ?").bind(gameId),
    database.prepare("UPDATE presences SET game_id = NULL, game_seen_at_ms = NULL WHERE game_id = ?").bind(gameId),
    database.prepare("DELETE FROM performance_checks WHERE version_id IN (SELECT id FROM versions WHERE game_id = ?)").bind(gameId),
    ...[
      "play_days", "play_returns", "play_tickets", "play_networks", "performance_days", "room_usage", "room_message_types", "live_rooms", "kept_rooms", "room_players", "room_keys", "game_access_passes", "tester_links",
      "game_server_errors", "game_server_schedules", "game_log_days", "alert_notices", "game_hosting_months", "player_erases", "database_restores", "games_ever_played", "played", "saves", "save_history", "game_images", "game_shaders", "game_backgrounds", "domains",
      "game_items", "purchases", "audit_log", "reports", "versions",
    ].map(deleteFrom),
    database.prepare("DELETE FROM games WHERE id = ?").bind(gameId),
    deleteFrom("game_deletions"),
  ];
}
