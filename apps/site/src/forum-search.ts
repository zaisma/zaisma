import type { Feedback, FeedbackPost } from "@zaisma/core";
import type { Env } from "./env.ts";

/**
 * Full-text search over the developer forum (migrations/0026_forum_search.sql). Only what others can
 * see is indexed: a public topic's title (with a known issue's workaround and roadmap item) and each
 * post that passed its check. Private messages to Zaisma never are.
 */

/** A topic's own row: its title, and what a known issue says to do. Gone when it stops being public. */
export async function indexTopic(env: Env, topicId: string): Promise<void> {
  const f = await env.DB.prepare("SELECT * FROM feedback WHERE id = ?").bind(topicId).first<Feedback>();
  await env.DB.prepare("DELETE FROM forum_search WHERE topic_id = ? AND post_id = ''").bind(topicId).run();
  if (!f?.shown) return;
  await env.DB.prepare("INSERT INTO forum_search (title, body, topic_id, post_id) VALUES (?, ?, ?, '')")
    .bind(f.known_title ?? f.title, [f.workaround, f.roadmap].filter(Boolean).join(" "), f.id)
    .run();
}

/** A post others can see now. Bare status lines ("Zaisma fixed this.") aren't worth finding. */
export async function indexPost(env: Env, post: Pick<FeedbackPost, "id" | "feedback_id" | "text" | "kind">): Promise<void> {
  if (post.kind === "status" && post.text.length <= 60) return;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM forum_search WHERE post_id = ?").bind(post.id),
    env.DB.prepare("INSERT INTO forum_search (title, body, topic_id, post_id) VALUES ('', ?, ?, ?)").bind(post.text, post.feedback_id, post.id),
  ]);
}

export async function unindexPost(env: Env, postId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM forum_search WHERE post_id = ?").bind(postId).run();
}

export async function unindexTopic(env: Env, topicId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM forum_search WHERE topic_id = ?").bind(topicId).run();
}

const STOP = new Set(
  "a an and are as at be but by can do does for from has have how i if in into is it its my no not of on or our so than that the their them then there these they this to too was we were what when where which who why will with you your".split(" "),
);

/**
 * What was typed, as a full-text query: "quoted phrases" stay together, a trailing * matches the
 * start of a word, codes like too_big and upload_files stay whole, and small words are dropped.
 * Every term must match (all), or any of them (any) when all finds nothing.
 */
export function searchTerms(q: string): { all: string; any: string } | null {
  const terms: string[] = [];
  const phrases = [...q.matchAll(/"([^"]+)"/g)];
  for (const [, phrase] of phrases) {
    const words = phrase!.match(/[\p{L}\p{N}_]+/gu) ?? [];
    if (words.length) terms.push(`"${words.join(" ")}"`);
  }
  const rest = q.replace(/"[^"]*"/g, " ");
  for (const m of rest.matchAll(/([\p{L}\p{N}_]+)(\*)?/gu)) {
    const word = m[1]!.toLowerCase();
    if (STOP.has(word) || (word.length < 2 && !/\d/.test(word))) continue;
    terms.push(`"${word}"${m[2] ? "*" : ""}`);
  }
  const unique = [...new Set(terms)].slice(0, 12);
  if (!unique.length) return null;
  return { all: unique.join(" "), any: unique.join(" OR ") };
}

/** The best match per topic: its score (lower is better, as bm25 gives it) and a snippet with the matching words marked «like this». */
export async function searchTopics(env: Env, match: string, filters: { where: string[]; binds: unknown[] }, limit: number, offset: number) {
  const { results } = await env.DB.prepare(
    // The matches are worked out first (MATERIALIZED), since bm25 can't run inside the grouping.
    `WITH hits AS MATERIALIZED (
       SELECT topic_id, bm25(forum_search, 4.0, 1.0) AS score, snippet(forum_search, -1, '«', '»', '…', 14) AS snip FROM forum_search WHERE forum_search MATCH ?
     ), best AS (SELECT topic_id, MIN(score) AS score, snip FROM hits GROUP BY topic_id)
     SELECT f.*, s.score AS search_score, s.snip AS search_match FROM best s JOIN feedback f ON f.id = s.topic_id
     WHERE ${filters.where.join(" AND ")}
     ORDER BY s.score * (1.0 + 0.4 * (f.answer_post IS NOT NULL OR f.status = 'answered') + 0.4 * (f.known_title IS NOT NULL) + 0.03 * MIN(f.votes, 20)) LIMIT ? OFFSET ?`,
  )
    .bind(match, ...filters.binds, limit, offset)
    .all<Feedback & { search_score: number; search_match: string }>();
  return results;
}
