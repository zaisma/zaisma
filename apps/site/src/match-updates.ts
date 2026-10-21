import { isServerPath, type Game, type Version } from "@zaisma/core";
import { fileChanges } from "./scan.ts";
import type { Env } from "./env.ts";
import type { WaitUntil } from "./webhooks.ts";

/**
 * A version went live with match_update_mode "now": say whether it changed the game's own files (so rooms
 * reload their players' games rather than only reconnecting them), then tell the game's live rooms on Zaisma
 * to switch, through the rooms Worker. A room that misses this (asleep, or the call failed) switches when it
 * next checks the game (its gameStillLive), so this never fails the publish.
 */
export async function updateLiveMatches(env: Env, game: Game, version: Version, wasLiveVersion: Version | null, waitUntil?: WaitUntil): Promise<void> {
  const hasGameFileChanges = await gameFilesChanged(env, wasLiveVersion, version);
  await env.DB.prepare("UPDATE games SET has_live_version_game_file_changes = ? WHERE id = ?").bind(hasGameFileChanges ? 1 : 0, game.id).run();
  const telling = (async () => {
    try {
      await env.GAME_ROOMS?.updateMatches({ gameId: game.id, slug: game.slug, versionId: version.id, hasGameFileChanges });
    } catch (error) {
      console.error("Couldn't tell the game's rooms about its new version:", game.slug, error);
    }
  })();
  if (waitUntil) waitUntil(telling);
  else await telling;
}

/** Whether a version changed anything players' browsers load (anything but its game server), against the one players had. */
async function gameFilesChanged(env: Env, wasLiveVersion: Version | null, version: Version): Promise<boolean> {
  if (!wasLiveVersion || wasLiveVersion.id === version.id) return wasLiveVersion === null;
  const changes = await fileChanges(env, wasLiveVersion, version).catch(() => null);
  // A zip upload has no hashes to compare: count it as changed.
  if (!changes) return true;
  return [...changes.addedPaths, ...changes.changedPaths, ...changes.removedPaths].some((path) => !isServerPath(path));
}
