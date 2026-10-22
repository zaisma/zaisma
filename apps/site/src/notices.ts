import { audit, countryName, gameById, isNoticeReason, readCountryBlocks, readReviewReason } from "@zaisma/core";
import { sendAlert } from "./email.ts";
import type { Env } from "./env.ts";

/**
 * A game held on a copyright or defamation notice stays hidden when it publishes a version (publishVersion),
 * and one blocked in a country stays blocked there: a person checks that what the notice names is gone and
 * shows it again, or lifts the block. Publishing tells Zaisma, so the
 * developer has nothing more to send. Call it after every publish.
 */
export async function alertIfNoticeFixPublished(env: Env, gameId: string, versionId: string): Promise<void> {
  const game = await gameById(env.DB, gameId);
  if (!game) return;
  // Blocked in a country on a notice under its law: a person lifts the block once what it names is gone.
  const blocks = readCountryBlocks(game);
  if (blocks.length) {
    const countries = blocks.map((block) => countryName(block.country_code)).join(", ");
    await audit(env.DB, game.id, "notice-fix-published", `${versionId} is live while the game is blocked in ${countries}`);
    await sendAlert(
      env,
      `${game.slug}: a fixed version after a country's notice`,
      `${game.title} is blocked in ${countries}:\n${blocks.map((block) => `${block.country_code}: ${block.review_reason.message}`).join("\n")}\n\nIts developer published ${versionId}. Check what the notice names is gone, then lift the block.\n\nGame: ${env.SITE_ORIGIN}/admin/games/${game.id}`,
    );
  }
  if (game.review_status !== "held") return;
  const reason = readReviewReason(game.review_reason);
  if (!reason || !isNoticeReason(reason)) return;
  await audit(env.DB, game.id, "notice-fix-published", `${versionId} is live while the game is held on ${reason.code}`);
  await sendAlert(
    env,
    `${game.slug}: a fixed version after a notice`,
    `${game.title} is held on ${reason.code}: ${reason.message}\n\nIts developer published ${versionId}. Check what the notice names is gone, then show the game again.\n\nGame: ${env.SITE_ORIGIN}/admin/games/${game.id}`,
  );
}
