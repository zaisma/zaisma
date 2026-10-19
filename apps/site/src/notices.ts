import { audit, gameById, isNoticeReason, readReviewReason } from "@zaisma/core";
import { sendAlert } from "./email.ts";
import type { Env } from "./env.ts";

/**
 * A game held on a copyright or defamation notice stays hidden when it publishes a version (publishVersion):
 * a person checks that what the notice names is gone and shows it again. Publishing tells Zaisma, so the
 * developer has nothing more to send. Call it after every publish.
 */
export async function alertIfNoticeFixPublished(env: Env, gameId: string, versionId: string): Promise<void> {
  const game = await gameById(env.DB, gameId);
  if (!game || game.review_status !== "held") return;
  const reason = readReviewReason(game.review_reason);
  if (!reason || !isNoticeReason(reason)) return;
  await audit(env.DB, game.id, "notice-fix-published", `${versionId} is live while the game is held on ${reason.code}`);
  await sendAlert(
    env,
    `${game.slug}: a fixed version after a notice`,
    `${game.title} is held on ${reason.code}: ${reason.message}\n\nIts developer published ${versionId}. Check what the notice names is gone, then show the game again.\n\nGame: ${env.SITE_ORIGIN}/admin/games/${game.id}`,
  );
}
