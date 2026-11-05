import { deleteStaleDraftMedia } from "./forum-posts.ts";
import { deleteOldShaderChecks } from "./shader-check.ts";
import { recountStoredSizeStatement, utcDateOf, ANTIVIRUS_ANSWER_KEPT_DURATION_DAYS, CHECKED_FILE_KEPT_DURATION_DAYS, ROOM_STALE_MS, applyBirthdays, audit, deleteEndedAccessPasses, deleteExpiredFriendInvites, deleteOldFriendRequests, deleteStalePresences, deleteExpiredSignInCodes, deleteOldDatabaseRestores, deleteOldKeptRoomRestores, deleteOldDeliveries, LIFELIKE_GORE_MINIMUM_PLAYER_AGE_YEARS, blobKey, brotliKeyOf, gameById, manifestKey, needsLifelikeGoreAge, ownedBlobKey, reportPictureKey, type Manifest, type ScanReport, type Version } from "@zaisma/core";
import { authConfigured, deleteAuthUser, newestAuthUsers } from "./auth.ts";
import { deleteOldDeviceMarks } from "./device-marks.ts";
import { deleteOldEmailCodes } from "./email-codes.ts";
import { deleteOldPasskeyChallenges } from "./passkeys.ts";
import { deleteOldLogs } from "./logs-api.ts";
import { deleteOldSecurityEvents } from "./security-log.ts";
import type { Env } from "./env.ts";
import { deleteOldProofs } from "./session-proofs.ts";
import { deleteVersion, publishWithReview, routePublish } from "./scan.ts";
import { judgeUnpaidStorage } from "./unpaid-storage.ts";
import { tellWebhooks } from "./webhooks.ts";

/** Every few minutes: publish drafts whose time has come. */
export async function publishDue(env: Env, nowMs = Date.now()): Promise<number> {
  const { results } = await env.DB.prepare("SELECT * FROM versions WHERE scheduled_publish_at_ms IS NOT NULL AND scheduled_publish_at_ms <= ? AND game_id NOT IN (SELECT game_id FROM game_deletions) ORDER BY scheduled_publish_at_ms LIMIT 50").bind(nowMs).all<Version>();
  let publishedCount = 0;
  for (const version of results) {
    if (version.scan_status === "scanning") continue; // Goes live as soon as it passes.
    if (version.scan_status === "approved") {
      // A race the publish call already checks: the game was set back to everyone 13 and up after this was scheduled.
      const game = await gameById(env.DB, version.game_id);
      if (game && game.minimum_player_age_years < LIFELIKE_GORE_MINIMUM_PLAYER_AGE_YEARS && needsLifelikeGoreAge(version.scan_report ? (JSON.parse(version.scan_report) as ScanReport) : null)) {
        await env.DB.prepare("UPDATE versions SET scheduled_publish_at_ms = NULL WHERE id = ?").bind(version.id).run();
        await audit(env.DB, version.game_id, "publish-dropped", `${version.id} shows lifelike gore and the game is for everyone 13 and up, so it wasn't published at its scheduled time.`);
        continue;
      }
      if (!game) continue;
      // Still earning it and its review isn't done: it goes live on a later run, once that lets it through.
      if ((await routePublish(env, game, version)).route === "after_ai_review") continue;
      if ((await publishWithReview(env, game, version, "At its scheduled time")) === "now") publishedCount++;
    } else {
      await env.DB.prepare("UPDATE versions SET scheduled_publish_at_ms = NULL WHERE id = ?").bind(version.id).run();
      await audit(env.DB, version.game_id, "publish-dropped", `${version.id} didn't pass review, so it wasn't published at its scheduled time`);
    }
  }
  return publishedCount;
}

const DAY_MS = 86400_000;
const HOUR_MS = 3600_000;
/** How long a Supabase sign-in may go without a Zaisma account behind it: the join steps' hour. */
const ABANDONED_SIGN_IN_MS = HOUR_MS;
/** Users read from Supabase per call, and so account IDs per database lookup (D1 takes up to 100 values). */
const AUTH_USERS_PER_PAGE_COUNT = 50;
/** How far the sweeps look back past the hour: the few minutes' one a while, the daily one for whatever a missed run left. */
export const RECENT_SIGN_IN_SWEEP_MS = 30 * 60_000;
export const DAILY_SIGN_IN_SWEEP_MS = 3 * DAY_MS;

/** Every few minutes: deleted accounts' sign-ins Supabase didn't take at the time. A sign-in whose person has joined again is theirs now, and stays. */
export async function deleteWaitingSignIns(env: Env): Promise<void> {
  if (!authConfigured(env)) return;
  const { results } = await env.DB.prepare("SELECT account_id, EXISTS (SELECT 1 FROM accounts WHERE accounts.id = waiting_sign_in_deletions.account_id) AS is_account_back FROM waiting_sign_in_deletions ORDER BY created_at_ms LIMIT 50").all<{ account_id: string; is_account_back: number }>();
  for (const waiting of results) {
    if (waiting.is_account_back || (await deleteAuthUser(env, waiting.account_id).catch(() => false))) await env.DB.prepare("DELETE FROM waiting_sign_in_deletions WHERE account_id = ?").bind(waiting.account_id).run();
  }
}

/**
 * Supabase's Google and Discord start page has to stay open for the browser, so someone can make a Supabase
 * sign-in there around Zaisma's age question and checks (docs/DECISIONS.md, "Accounts open only through
 * Zaisma"). A sign-in with no Zaisma account behind it an hour on is deleted: those made in the lookBackMs
 * before that hour, newest first.
 */
export async function deleteAbandonedSignIns(env: Env, lookBackMs: number, nowMs = Date.now()): Promise<number> {
  if (!authConfigured(env)) return 0;
  const newestMs = nowMs - ABANDONED_SIGN_IN_MS;
  const oldestMs = newestMs - lookBackMs;
  let deletedCount = 0;
  for (let pageNumber = 1; pageNumber <= 200; pageNumber++) {
    const users = await newestAuthUsers(env, pageNumber, AUTH_USERS_PER_PAGE_COUNT);
    if (!users) break;
    const due = users.filter((user) => user.createdAtMs > oldestMs && user.createdAtMs <= newestMs);
    if (due.length) {
      const { results } = await env.DB.prepare(`SELECT id FROM accounts WHERE id IN (${due.map(() => "?").join(", ")})`)
        .bind(...due.map((user) => user.id))
        .all<{ id: string }>();
      const accountIds = new Set(results.map((account) => account.id));
      for (const user of due) if (!accountIds.has(user.id) && (await deleteAuthUser(env, user.id))) deletedCount++;
    }
    // Newest first: past the window, the rest is older still.
    if (users.length < AUTH_USERS_PER_PAGE_COUNT || users.some((user) => user.createdAtMs <= oldestMs)) break;
  }
  return deletedCount;
}

/**
 * Once a day: delete drafts nobody published within 30 days, then files no version uses, then
 * pictures from reports closed more than 30 days ago, then rooms-list rows of rooms that stopped,
 * and apply the day's birthdays.
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

  // New data's days: only today's and yesterday's matter.
  await env.DB.prepare("DELETE FROM owner_new_data_days WHERE date < ?").bind(utcDateOf(nowMs - DAY_MS)).run();
  // Files no version uses, after a day's grace for uploads still in progress. While files are still
  // moving to new names (file_moves), a version's file list may not be where it looks, so they wait.
  const isMovingFiles = (await env.DB.prepare("SELECT 1 AS is_found FROM file_moves LIMIT 1").first()) !== null;
  if (!isMovingFiles) await judgeUnpaidStorage(env, nowMs);
  const unusedKeys = isMovingFiles ? [] : await deleteUnusedFiles(env, nowMs - DAY_MS, nowMs);

  const { results: pictures } = await env.DB.prepare("SELECT id FROM reports WHERE has_picture = 1 AND report_status != 'open' AND closed_at_ms < ? LIMIT 1000").bind(nowMs - 30 * DAY_MS).all<{ id: string }>();
  if (pictures.length) {
    await env.GAMES.delete(pictures.map((picture) => reportPictureKey(picture.id)));
    await env.DB.batch(pictures.map((picture) => env.DB.prepare("UPDATE reports SET has_picture = 0 WHERE id = ?").bind(picture.id)));
  }
  // Lists already skip these; a room that stopped without saying so (a restart) leaves one behind. A kept room waiting with nobody in it never checks in, and stays.
  await env.DB.prepare("DELETE FROM live_rooms WHERE updated_at_ms < ? AND NOT (is_kept = 1 AND player_count = 0)").bind(nowMs - ROOM_STALE_MS).run();
  await deleteStalePresences(env.DB, nowMs);
  await deleteOldFriendRequests(env.DB, nowMs);
  // Game server errors are for fixing what's happening now: kept 30 days after they last happened.
  await env.DB.prepare("DELETE FROM game_server_errors WHERE last_at_ms < ?").bind(nowMs - 30 * DAY_MS).run();
  // So are its logs: days past the 30 kept (logs-api.ts).
  await deleteOldLogs(env, nowMs);
  // Free-use alerts already told, kept a while so a month never tells one twice.
  await env.DB.prepare("DELETE FROM alert_notices WHERE noticed_at_ms < ?").bind(nowMs - 90 * DAY_MS).run();
  // When the relay's use was last read for a game (relay.ts): only games whose players got relay credentials in two days are read.
  await env.DB.prepare("DELETE FROM relay_reads WHERE read_at_ms < ?").bind(nowMs - 3 * DAY_MS).run();
  // Chat kept for a report: a year from when it was confirmed (chat-review.ts).
  await env.DB.prepare("DELETE FROM chat_reviews WHERE kept_until_ms IS NOT NULL AND kept_until_ms < ?").bind(nowMs).run();
  // A play's ticket is only needed while it's going on.
  await env.DB.prepare("DELETE FROM play_tickets WHERE issued_at_ms < ?").bind(nowMs - DAY_MS).run();
  // So is its key to multiplayer passes.
  await env.DB.prepare("DELETE FROM room_keys WHERE issued_at_ms < ?").bind(nowMs - DAY_MS).run();
  await env.DB.prepare("DELETE FROM door_answer_cuts WHERE first_cut_at_ms < ?").bind(nowMs - 90 * DAY_MS).run();
  // Sign in with Zaisma codes nobody swapped: each only works for 2 minutes.
  await deleteExpiredSignInCodes(env.DB, nowMs);
  // Connected apps (mcp-sign-in.ts): codes nobody swapped, access tokens past their hour, refresh tokens swapped a day
  // ago (one used again after that is refused, not a theft to act on), and registered apps nobody connected in a week.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM connected_app_codes WHERE expires_at_ms <= ?").bind(nowMs),
    env.DB.prepare("DELETE FROM connected_app_tokens WHERE token_kind = 'access' AND expires_at_ms <= ?").bind(nowMs),
    env.DB.prepare("DELETE FROM connected_app_tokens WHERE token_kind = 'refresh' AND rotated_at_ms <= ?").bind(nowMs - DAY_MS),
    env.DB.prepare("DELETE FROM mcp_clients WHERE registration_kind = 'registration' AND created_at_ms <= ? AND id NOT IN (SELECT mcp_client_id FROM api_keys WHERE mcp_client_id IS NOT NULL)").bind(nowMs - 7 * DAY_MS),
  ]);
  // Friend invites nobody used: each works for a week.
  await deleteExpiredFriendInvites(env.DB, nowMs);
  // Birthdays of players who weren't on today: teens move up a band, and at 18 the birth date goes.
  await applyBirthdays(env.DB, nowMs);
  // What was sent to webhooks: kept 30 days, so the developer can see what went and why it failed.
  await deleteOldDeliveries(env.DB, nowMs);
  // Game database restores whose undo Cloudflare no longer keeps (30 days).
  await deleteOldDatabaseRestores(env.DB, nowMs);
  await deleteOldKeptRoomRestores(env.DB, nowMs);
  // Email codes past their 10 minutes and the day of requests their limits count; wrong passwords older than a
  // day, and device marks a year past their last sign-in.
  await deleteOldEmailCodes(env, nowMs);
  await deleteOldPasskeyChallenges(env, nowMs);
  await deleteOldDeviceMarks(env, nowMs);
  // How sessions last proved it's them: only the day's matter (session-proofs.ts).
  await deleteOldProofs(env, nowMs);
  // The security log: sign-ins past 90 days, and every other event's place and address, and places no key has used since.
  await deleteOldSecurityEvents(env, nowMs);
  // Openings of tester links and previews that ended, and grants nobody swapped in time.
  await deleteEndedAccessPasses(env.DB, nowMs);
  // Files the scan cleared more than 30 days ago: they're matched again when they next come up (scan.ts, matchMedia).
  await env.DB.prepare("DELETE FROM checked_files WHERE checked_at_ms <= ?").bind(nowMs - CHECKED_FILE_KEPT_DURATION_DAYS * DAY_MS).run();
  // VirusTotal's answers past their week: looked up again when the file next comes up (scan.ts, virusTotal).
  await env.DB.prepare("DELETE FROM antivirus_lookups WHERE looked_up_at_ms <= ?").bind(nowMs - ANTIVIRUS_ANSWER_KEPT_DURATION_DAYS * DAY_MS).run();
  // Shader checks before sending: their sheets keep a day, and so do their counts (shader-check.ts).
  await deleteOldShaderChecks(env, nowMs);
  // Images uploaded for a forum post that was never posted.
  const deletedForumDraftCount = await deleteStaleDraftMedia(env, nowMs);
  return { deletedDraftCount: drafts.length, deletedFileCount: unusedKeys.length, deletedPictureCount: pictures.length, deletedForumDraftCount };
}

/**
 * Stops counting the files no version of their owner's uses, then deletes the ones nobody holds any more, and answers
 * their keys. A file sent in the last day stays, and an owner who sent anything since yesterday keeps all theirs, so
 * a game too big for one day's new data goes up over several days. A shared file's row stays once released: it still
 * says who sent the file first, for copies.
 */
async function deleteUnusedFiles(env: Env, cutoffMs: number, nowMs: number): Promise<string[]> {
  const used = new Set<string>();
  const usedByOwner = new Set<string>();
  const { results: versions } = await env.DB.prepare("SELECT versions.id, games.owner_id FROM versions JOIN games ON games.id = versions.game_id WHERE versions.kind = 'files'").all<{ id: string; owner_id: string | null }>();
  for (const version of versions) {
    const stored = await env.GAMES.get(manifestKey(version.id));
    if (!stored) continue;
    for (const file of Object.values(((await stored.json()) as Manifest).files)) {
      used.add(file.owner_id ? ownedBlobKey(file.owner_id, file.sha256) : blobKey(file.sha256));
      if (version.owner_id) usedByOwner.add(file.owner_id ? ownedBlobKey(file.owner_id, file.sha256) : `${version.owner_id}/${file.sha256}`);
    }
  }
  const yesterday = utcDateOf(nowMs - DAY_MS);
  const isSending = "EXISTS (SELECT 1 FROM owner_new_data_days WHERE owner_new_data_days.owner_id = held.owner_id AND owner_new_data_days.date >= ?)";
  const { results: heldShared } = await env.DB.prepare(`SELECT owner_id, sha256 FROM blob_owners held WHERE released_at_ms IS NULL AND created_at_ms < ? AND NOT ${isSending}`).bind(cutoffMs, yesterday).all<{ owner_id: string; sha256: string }>();
  const { results: heldOwned } = await env.DB.prepare(`SELECT owner_id, sha256 FROM owned_blobs held WHERE released_at_ms IS NULL AND created_at_ms < ? AND NOT ${isSending}`).bind(cutoffMs, yesterday).all<{ owner_id: string; sha256: string }>();
  const releases = [
    ...heldShared.filter((blob) => !usedByOwner.has(`${blob.owner_id}/${blob.sha256}`)).map((blob) => env.DB.prepare("UPDATE blob_owners SET released_at_ms = ? WHERE owner_id = ? AND sha256 = ?").bind(nowMs, blob.owner_id, blob.sha256)),
    ...heldOwned.filter((blob) => !usedByOwner.has(ownedBlobKey(blob.owner_id, blob.sha256))).map((blob) => env.DB.prepare("UPDATE owned_blobs SET released_at_ms = ? WHERE owner_id = ? AND sha256 = ?").bind(nowMs, blob.owner_id, blob.sha256)),
    recountStoredSizeStatement(env.DB),
  ];
  for (let i = 0; i < releases.length; i += 100) await env.DB.batch(releases.slice(i, i + 100));

  const { results: shared } = await env.DB.prepare("SELECT sha256 FROM blobs WHERE created_at_ms < ? AND NOT EXISTS (SELECT 1 FROM blob_owners WHERE blob_owners.sha256 = blobs.sha256 AND blob_owners.released_at_ms IS NULL)").bind(cutoffMs).all<{ sha256: string }>();
  const { results: owned } = await env.DB.prepare("SELECT owner_id, sha256 FROM owned_blobs WHERE released_at_ms IS NOT NULL").all<{ owner_id: string; sha256: string }>();
  const unusedShared = shared.filter((blob) => !used.has(blobKey(blob.sha256)));
  const unusedOwned = owned.filter((blob) => !used.has(ownedBlobKey(blob.owner_id, blob.sha256)));
  const keys = [...unusedShared.map((blob) => blobKey(blob.sha256)), ...unusedOwned.map((blob) => ownedBlobKey(blob.owner_id, blob.sha256))];
  // With their Brotli copies (compress.ts).
  const allKeys = [...keys, ...keys.map(brotliKeyOf)];
  for (let i = 0; i < allKeys.length; i += 1000) await env.GAMES.delete(allKeys.slice(i, i + 1000));
  const statements = [
    ...keys.map((key) => env.DB.prepare("DELETE FROM compressed_blobs WHERE storage_key = ?").bind(key)),
    ...unusedShared.map((blob) => env.DB.prepare("DELETE FROM blobs WHERE sha256 = ?").bind(blob.sha256)),
    ...unusedShared.map((blob) => env.DB.prepare("DELETE FROM blob_owners WHERE sha256 = ?").bind(blob.sha256)),
    ...unusedOwned.map((blob) => env.DB.prepare("DELETE FROM owned_blobs WHERE owner_id = ? AND sha256 = ?").bind(blob.owner_id, blob.sha256)),
  ];
  for (let i = 0; i < statements.length; i += 100) await env.DB.batch(statements.slice(i, i + 100));
  return keys;
}
