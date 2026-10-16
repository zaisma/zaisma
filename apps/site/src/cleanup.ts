import { deleteStaleDraftMedia } from "./forum-posts.ts";
import { ROOM_STALE_MS, audit, deleteExpiredFriendInvites, deleteExpiredSignInCodes, blobKey, manifestKey, ownedBlobKey, publishVersion, reportPictureKey, type Manifest, type Version } from "@zaisma/core";
import type { Env } from "./env.ts";
import { deleteVersion, pruneVersions } from "./scan.ts";

/** Every few minutes: publish drafts whose time has come. */
export async function publishDue(env: Env, nowMs = Date.now()): Promise<number> {
  const { results } = await env.DB.prepare("SELECT * FROM versions WHERE scheduled_publish_at_ms IS NOT NULL AND scheduled_publish_at_ms <= ? ORDER BY scheduled_publish_at_ms LIMIT 50").bind(nowMs).all<Version>();
  let publishedCount = 0;
  for (const version of results) {
    if (version.scan_status === "scanning") continue; // Goes live as soon as it passes.
    if (version.scan_status === "approved") {
      await publishVersion(env.DB, version);
      await audit(env.DB, version.game_id, "published", `${version.id}, at its scheduled time`);
      await pruneVersions(env, version.game_id);
      publishedCount++;
    } else {
      await env.DB.prepare("UPDATE versions SET scheduled_publish_at_ms = NULL WHERE id = ?").bind(version.id).run();
      await audit(env.DB, version.game_id, "publish-dropped", `${version.id} didn't pass review, so it wasn't published at its scheduled time`);
    }
  }
  return publishedCount;
}

const DAY_MS = 86400_000;

/**
 * Once a day: delete drafts nobody published within 30 days, then files no version uses, then
 * pictures from reports closed more than 30 days ago, then rooms-list rows of rooms that stopped.
 * Held and rejected versions are kept: they may need a person, or a report to the authorities.
 */
export async function dailyCleanup(env: Env, nowMs = Date.now()): Promise<{ deletedDraftCount: number; deletedFileCount: number; deletedPictureCount: number; deletedForumDraftCount: number }> {
  const { results: drafts } = await env.DB
    .prepare(
      `SELECT versions.* FROM versions JOIN games ON games.id = versions.game_id
       WHERE versions.scan_status = 'approved' AND versions.published_at_ms IS NULL AND versions.scheduled_publish_at_ms IS NULL
         AND versions.created_at_ms < ? AND (games.live_version_id IS NULL OR games.live_version_id != versions.id)`,
    )
    .bind(nowMs - 30 * DAY_MS)
    .all<Version>();
  for (const draft of drafts) {
    await deleteVersion(env, draft);
    await audit(env.DB, draft.game_id, "draft-deleted", `${draft.id} was never published, so it was deleted after 30 days`);
  }

  // Files no version uses, after a day's grace for uploads still in progress. While files are still
  // moving to new names (file_moves), a version's file list may not be where it looks, so they wait.
  const isMovingFiles = (await env.DB.prepare("SELECT 1 AS is_found FROM file_moves LIMIT 1").first()) !== null;
  const unusedKeys = isMovingFiles ? [] : await deleteUnusedFiles(env, nowMs - DAY_MS);

  const { results: pictures } = await env.DB.prepare("SELECT id FROM reports WHERE has_picture = 1 AND report_status != 'open' AND closed_at_ms < ? LIMIT 1000").bind(nowMs - 30 * DAY_MS).all<{ id: string }>();
  if (pictures.length) {
    await env.GAMES.delete(pictures.map((picture) => reportPictureKey(picture.id)));
    await env.DB.batch(pictures.map((picture) => env.DB.prepare("UPDATE reports SET has_picture = 0 WHERE id = ?").bind(picture.id)));
  }
  // Lists already skip these; a room that stopped without saying so (a restart) leaves one behind.
  await env.DB.prepare("DELETE FROM live_rooms WHERE updated_at_ms < ?").bind(nowMs - ROOM_STALE_MS).run();
  // Game server errors are for fixing what's happening now: kept 30 days after they last happened.
  await env.DB.prepare("DELETE FROM game_server_errors WHERE last_at_ms < ?").bind(nowMs - 30 * DAY_MS).run();
  // A play's ticket is only needed while it's going on.
  await env.DB.prepare("DELETE FROM play_tickets WHERE issued_at_ms < ?").bind(nowMs - DAY_MS).run();
  // So is its key to multiplayer passes.
  await env.DB.prepare("DELETE FROM room_keys WHERE issued_at_ms < ?").bind(nowMs - DAY_MS).run();
  // Sign in with Zaisma codes nobody swapped: each only works for 2 minutes.
  await deleteExpiredSignInCodes(env.DB, nowMs);
  // Friend invites nobody used: each works for a week.
  await deleteExpiredFriendInvites(env.DB, nowMs);
  // Images uploaded for a forum post that was never posted.
  const deletedForumDraftCount = await deleteStaleDraftMedia(env, nowMs);
  return { deletedDraftCount: drafts.length, deletedFileCount: unusedKeys.length, deletedPictureCount: pictures.length, deletedForumDraftCount };
}

/** Deletes shared and owned files older than the cutoff that no version's file list uses, and answers their keys. */
async function deleteUnusedFiles(env: Env, cutoffMs: number): Promise<string[]> {
  const used = new Set<string>();
  const { results: versions } = await env.DB.prepare("SELECT id FROM versions WHERE kind = 'files'").all<{ id: string }>();
  for (const version of versions) {
    const stored = await env.GAMES.get(manifestKey(version.id));
    if (!stored) continue;
    for (const file of Object.values(((await stored.json()) as Manifest).files)) used.add(file.owner_id ? ownedBlobKey(file.owner_id, file.sha256) : blobKey(file.sha256));
  }
  const { results: shared } = await env.DB.prepare("SELECT sha256 FROM blobs WHERE created_at_ms < ?").bind(cutoffMs).all<{ sha256: string }>();
  const { results: owned } = await env.DB.prepare("SELECT owner_id, sha256 FROM owned_blobs WHERE created_at_ms < ?").bind(cutoffMs).all<{ owner_id: string; sha256: string }>();
  const unusedShared = shared.filter((blob) => !used.has(blobKey(blob.sha256)));
  const unusedOwned = owned.filter((blob) => !used.has(ownedBlobKey(blob.owner_id, blob.sha256)));
  const keys = [...unusedShared.map((blob) => blobKey(blob.sha256)), ...unusedOwned.map((blob) => ownedBlobKey(blob.owner_id, blob.sha256))];
  for (let i = 0; i < keys.length; i += 1000) await env.GAMES.delete(keys.slice(i, i + 1000));
  const statements = [
    ...unusedShared.map((blob) => env.DB.prepare("DELETE FROM blobs WHERE sha256 = ?").bind(blob.sha256)),
    ...unusedOwned.map((blob) => env.DB.prepare("DELETE FROM owned_blobs WHERE owner_id = ? AND sha256 = ?").bind(blob.owner_id, blob.sha256)),
  ];
  for (let i = 0; i < statements.length; i += 100) await env.DB.batch(statements.slice(i, i + 100));
  return keys;
}
