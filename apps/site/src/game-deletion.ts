import {
  audit,
  cancelGameDeletion,
  claimGameDeletion,
  dueGameDeletions,
  gameRowDeletions,
  heldImageKey,
  isKeptForChildSafety,
  KEPT_FOR_REVIEW_REASON,
  manifestKey,
  postponeGameDeletion,
  reportPictureKey,
  saveCopyKey,
  saveKey,
  type GameDeletion,
} from "@zaisma/core";
import type { Env } from "./env.ts";

/** Games taken a step further each run (every 5 minutes, and straight after an account is deleted). */
const GAME_COUNT_PER_RUN = 5;
/** R2 calls one game may make in a run; each deletes up to 1,000 files, so a big game finishes over a few runs. */
const MAXIMUM_R2_CALL_COUNT = 100;
/** Most keys one R2 delete takes. */
const R2_DELETE_KEY_COUNT = 1000;

class OutOfR2Calls extends Error {}

/**
 * Delete the games whose deletion is due (packages/core/src/game-deletion.ts), a step at a time: their
 * database, secrets and game server storage in rooms, every player's saves, their versions' files, images
 * and report pictures, then every row about them. Each step is safe to repeat, so a game that runs out of
 * calls carries on at the next run, and one whose storage doesn't answer is tried again later. Never throws.
 */
export async function deleteDueGames(env: Env): Promise<void> {
  const due = await dueGameDeletions(env.DB, GAME_COUNT_PER_RUN);
  for (const deletion of due) {
    if (!(await claimGameDeletion(env.DB, deletion))) continue;
    try {
      await deleteGame(env, deletion);
    } catch (error) {
      if (error instanceof OutOfR2Calls) {
        await postponeGameDeletion(env.DB, deletion, null);
        continue;
      }
      console.error("Couldn't delete a game", deletion.game_id, error);
      await postponeGameDeletion(env.DB, deletion, error instanceof Error ? error.message : String(error)).catch(() => {});
    }
  }
}

async function deleteGame(env: Env, deletion: GameDeletion): Promise<void> {
  const gameId = deletion.game_id;
  // The backstop for a scan or report that came after the account went: a game under a child-safety hold is kept.
  if (deletion.requested_by_kind === "account_deleted" && (await isKeptForChildSafety(env.DB, gameId))) {
    await cancelGameDeletion(env.DB, gameId);
    await audit(env.DB, gameId, "kept-for-review", KEPT_FOR_REVIEW_REASON);
    return;
  }
  // A scan still running could yet find something to keep.
  const scanning = await env.DB.prepare("SELECT 1 AS is_scanning FROM versions WHERE game_id = ? AND scan_status = 'scanning' LIMIT 1").bind(gameId).first();
  if (scanning) {
    await postponeGameDeletion(env.DB, deletion, "A version is still being scanned.");
    return;
  }

  const service = env.GAME_STORAGE;
  if (!service) {
    await postponeGameDeletion(env.DB, deletion, "The rooms Worker isn't reachable.");
    return;
  }
  const { failureMessage } = await service.deleteGameStorage(gameId);
  if (failureMessage) {
    await postponeGameDeletion(env.DB, deletion, failureMessage);
    return;
  }

  let r2CallCount = 0;
  const countR2Call = () => {
    if (++r2CallCount > MAXIMUM_R2_CALL_COUNT) throw new OutOfR2Calls();
  };
  const deleteKeys = async (bucket: R2Bucket, keys: string[]) => {
    for (let i = 0; i < keys.length; i += R2_DELETE_KEY_COUNT) {
      countR2Call();
      await bucket.delete(keys.slice(i, i + R2_DELETE_KEY_COUNT));
    }
  };
  const deleteUnder = async (bucket: R2Bucket, prefix: string) => {
    for (;;) {
      countR2Call();
      const list = await bucket.list({ prefix });
      if (list.objects.length) await deleteKeys(bucket, list.objects.map((object) => object.key));
      if (!list.truncated) return;
    }
  };

  // Every player's saves: earlier copies, then the saves, each row once its file is gone.
  for (;;) {
    const { results: copies } = await env.DB.prepare("SELECT id, account_id FROM save_history WHERE game_id = ? LIMIT ?").bind(gameId, R2_DELETE_KEY_COUNT).all<{ id: string; account_id: string }>();
    if (!copies.length) break;
    await deleteKeys(env.SAVES, copies.map((copy) => saveCopyKey(copy.account_id, gameId, copy.id)));
    await env.DB.prepare("DELETE FROM save_history WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(copies.map((copy) => copy.id))).run();
  }
  for (;;) {
    const { results: saves } = await env.DB.prepare("SELECT account_id FROM saves WHERE game_id = ? LIMIT ?").bind(gameId, R2_DELETE_KEY_COUNT).all<{ account_id: string }>();
    if (!saves.length) break;
    await deleteKeys(env.SAVES, saves.map((save) => saveKey(save.account_id, gameId)));
    await env.DB.prepare("DELETE FROM saves WHERE game_id = ? AND account_id IN (SELECT value FROM json_each(?))").bind(gameId, JSON.stringify(saves.map((save) => save.account_id))).run();
  }

  // Versions' own files (their rows go last, with what points at them). Shared files are left for the daily cleanup.
  const { results: fileVersions } = await env.DB.prepare("SELECT id FROM versions WHERE game_id = ? AND kind = 'files'").bind(gameId).all<{ id: string }>();
  await deleteKeys(env.GAMES, fileVersions.map((version) => manifestKey(version.id)));
  await deleteUnder(env.GAMES, `games/${gameId}/`);
  await deleteUnder(env.GAMES, `images/${gameId}/`);
  await deleteUnder(env.GAMES, heldImageKey(gameId, ""));
  const { results: reports } = await env.DB.prepare("SELECT id FROM reports WHERE game_id = ?").bind(gameId).all<{ id: string }>();
  await deleteKeys(env.GAMES, reports.map((report) => reportPictureKey(report.id)));

  await env.DB.batch(gameRowDeletions(env.DB, gameId));
}
