import { KNOWN_IMAGE_RULE, feedbackMediaKey, type ImageMatcher } from "@zaisma/core";
import { ApiError } from "./developer.ts";
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
export const forumHeldKey = (id: string) => `forum-held/${id}`;

export type MatchOutcome = "clean" | "match" | "unmatched";

/** Match one image's bytes. On a match the file is kept for reporting and Julius is alerted. */
export async function matchUpload(env: Env, id: string, bytes: Uint8Array, type: string, by: string, matcher: ImageMatcher = imageMatcher(env)): Promise<MatchOutcome> {
  const result = await matcher.check([{ path: "forum image", type, id, body: async () => bytes }]).catch(() => null);
  if (!result?.connected) return "unmatched";
  if (!result.findings.some((f) => f.rule === KNOWN_IMAGE_RULE)) return "clean";
  await env.GAMES.put(forumHeldKey(id), bytes, { httpMetadata: { contentType: type } });
  await sendAlert(env, "URGENT: known abuse material uploaded to the forum", `Image matching found known abuse material in an image uploaded to the forum by account ${by}. It wasn't posted; the file is kept for reporting at ${forumHeldKey(id)}. Report it to NCMEC and deal with the account.`);
  return "match";
}

/** Refuse an upload that matched. */
export function refuse(): never {
  throw new ApiError(422, "image_refused", "This image can't be posted. A person at Zaisma will look at it.");
}

/**
 * Images not matched yet (a post's, or all waiting): match them now. A match takes that image down
 * (its file is kept for reporting) and alerts Julius. Answers what happened to the post's images:
 * clean when all are matched clean, unmatched when matching isn't connected, match when one matched.
 */
export async function matchWaiting(env: Env, where: { postId?: string; limit?: number }, matcher: ImageMatcher = imageMatcher(env)): Promise<MatchOutcome> {
  const { results } = where.postId
    ? await env.DB.prepare("SELECT m.id, m.type, m.account_id FROM feedback_media m WHERE m.post_id = ? AND m.matched = 0").bind(where.postId).all<{ id: string; type: string; account_id: string | null }>()
    : await env.DB.prepare("SELECT m.id, m.type, m.account_id FROM feedback_media m WHERE m.matched = 0 ORDER BY m.created_at LIMIT ?").bind(where.limit ?? 50).all<{ id: string; type: string; account_id: string | null }>();
  let outcome: MatchOutcome = "clean";
  for (const m of results) {
    const object = await env.GAMES.get(feedbackMediaKey(m.id));
    if (!object) continue;
    const bytes = new Uint8Array(await object.arrayBuffer());
    const result = await matchUpload(env, m.id, bytes, m.type, m.account_id ?? "unknown", matcher);
    if (result === "unmatched") return "unmatched";
    if (result === "match") {
      // That one image comes down; its file is kept for reporting under forumHeldKey.
      await env.DB.prepare("DELETE FROM feedback_media WHERE id = ?").bind(m.id).run();
      await env.GAMES.delete(feedbackMediaKey(m.id));
      outcome = "match";
    } else await env.DB.prepare("UPDATE feedback_media SET matched = 1 WHERE id = ?").bind(m.id).run();
  }
  return outcome;
}
