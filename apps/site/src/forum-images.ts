import { ApiError, KNOWN_IMAGE_CODE, type ImageMatcher } from "@zaisma/core";
import { sendAlert } from "./email.ts";
import type { Env } from "./env.ts";
import { imageMatcher } from "./scan.ts";

/**
 * Image matching for forum images (docs/DECISIONS.md: a match in player content takes down only that
 * item). Every image is matched when it's uploaded; a match refuses it, keeps the file for reporting
 * (forumHeldKey) and alerts Julius at once. An image that couldn't be matched then (matching not
 * connected, or down) is matched before a public post with it shows, and on the 5-minute run.
 */

/** Where an image that matched known abuse material is kept for reporting. Never served. */
export const forumHeldKey = (mediaId: string) => `forum-held/${mediaId}`;

export type MatchOutcome = "clean" | "match" | "unmatched";

/** Match one image's bytes. On a match the file is kept for reporting and Julius is alerted. */
export async function matchUpload(env: Env, mediaId: string, bytes: Uint8Array, contentType: string, uploaderId: string, matcher: ImageMatcher = imageMatcher(env)): Promise<MatchOutcome> {
  const checked = await matcher.check([{ path: "forum image", type: contentType, id: mediaId, body: async () => bytes }]).catch(() => null);
  if (!checked?.isConnected) return "unmatched";
  if (!checked.findings.some((finding) => finding.code === KNOWN_IMAGE_CODE)) return "clean";
  await env.GAMES.put(forumHeldKey(mediaId), bytes, { httpMetadata: { contentType } });
  await sendAlert(
    env,
    "URGENT: known abuse material uploaded to the forum",
    `Image matching found known abuse material in an image uploaded to the forum by account ${uploaderId}. It wasn't posted; the file is kept for reporting at ${forumHeldKey(mediaId)}. Report it to NCMEC and deal with the account.`,
  );
  return "match";
}

/** Refuse an upload that matched. */
export function refuse(): never {
  throw new ApiError("image_refused", { message: "An image can't be posted.", field: "images_base64", fix: "Post without it, or with a different image. A person at Zaisma will look at it." });
}

/**
 * Images not matched yet (a post's, or all waiting): match them now. A match takes that image down
 * (its file is kept for reporting) and alerts Julius. Answers what happened to the post's images:
 * clean when all are matched clean, unmatched when matching isn't connected, match when one matched.
 */
export async function matchWaiting(env: Env, which: { postId?: string; maximumImageCount?: number }, matcher: ImageMatcher = imageMatcher(env)): Promise<MatchOutcome> {
  type Waiting = { id: string; content_type: string; storage_key: string; account_id: string | null };
  const { results } = which.postId
    ? await env.DB.prepare("SELECT id, content_type, storage_key, account_id FROM forum_media WHERE post_id = ? AND has_passed_matching = 0").bind(which.postId).all<Waiting>()
    : await env.DB.prepare("SELECT id, content_type, storage_key, account_id FROM forum_media WHERE has_passed_matching = 0 ORDER BY created_at_ms LIMIT ?").bind(which.maximumImageCount ?? 50).all<Waiting>();
  let outcome: MatchOutcome = "clean";
  for (const image of results) {
    const object = await env.GAMES.get(image.storage_key);
    if (!object) continue;
    const bytes = new Uint8Array(await object.arrayBuffer());
    const matched = await matchUpload(env, image.id, bytes, image.content_type, image.account_id ?? "unknown", matcher);
    if (matched === "unmatched") return "unmatched";
    if (matched === "match") {
      // That one image comes down; its file is kept for reporting under forumHeldKey.
      await env.DB.prepare("DELETE FROM forum_media WHERE id = ?").bind(image.id).run();
      await env.GAMES.delete(image.storage_key);
      outcome = "match";
    } else await env.DB.prepare("UPDATE forum_media SET has_passed_matching = 1 WHERE id = ?").bind(image.id).run();
  }
  return outcome;
}
