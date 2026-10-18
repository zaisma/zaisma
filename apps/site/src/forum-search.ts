import type { ForumPost, ForumTopic } from "@zaisma/core";
import type { Env } from "./env.ts";

/**
 * Full-text search over the developer forum (migrations/0027_forum_search.sql). Only what others can
 * see is indexed: a public topic's title (with a known issue's workaround and roadmap item) and each
 * post that passed its check. Private messages to Zaisma never are.
 */

/** A topic's own row: its title, and what a known issue says to do. Gone when it stops being public. */
export async function indexTopic(env: Env, topicId: string): Promise<void> {
  const topic = await env.DB.prepare("SELECT * FROM forum_topics WHERE id = ?").bind(topicId).first<ForumTopic>();
  await env.DB.prepare("DELETE FROM forum_search WHERE topic_id = ? AND post_id = ''").bind(topicId).run();
  if (!topic?.is_shown) return;
  await env.DB.prepare("INSERT INTO forum_search (title, body, topic_id, post_id) VALUES (?, ?, ?, '')")
    .bind(topic.known_issue_title ?? topic.title, [topic.workaround, topic.roadmap_item].filter(Boolean).join(" "), topic.id)
    .run();
}

/** A post others can see now. Bare status lines ("Zaisma fixed this.") aren't worth finding. */
export async function indexPost(env: Env, post: Pick<ForumPost, "id" | "topic_id" | "text_markdown" | "kind">): Promise<void> {
  if (post.kind === "status" && post.text_markdown.length <= 60) return;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM forum_search WHERE post_id = ?").bind(post.id),
    env.DB.prepare("INSERT INTO forum_search (title, body, topic_id, post_id) VALUES ('', ?, ?, ?)").bind(post.text_markdown, post.topic_id, post.id),
  ]);
}

export async function unindexPost(env: Env, postId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM forum_search WHERE post_id = ?").bind(postId).run();
}

export async function unindexTopic(env: Env, topicId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM forum_search WHERE topic_id = ?").bind(topicId).run();
}

const STOP_WORDS = new Set(
  "a an and are as at be but by can do does for from has have how i if in into is it its my no not of on or our so than that the their them then there these they this to too was we were what when where which who why will with you your".split(" "),
);

/**
 * What was typed, as a full-text query: "quoted phrases" stay together, a trailing * matches the
 * start of a word, codes like too_big and upload_files stay whole, and small words are dropped.
 * Every term must match (all), or any of them (any) when all finds nothing.
 */
export function searchTerms(searchText: string): { all: string; any: string } | null {
  const terms: string[] = [];
  const phrases = [...searchText.matchAll(/"([^"]+)"/g)];
  for (const [, phrase] of phrases) {
    const words = phrase!.match(/[\p{L}\p{N}_]+/gu) ?? [];
    if (words.length) terms.push(`"${words.join(" ")}"`);
  }
  const rest = searchText.replace(/"[^"]*"/g, " ");
  for (const found of rest.matchAll(/([\p{L}\p{N}_]+)(\*)?/gu)) {
    const word = found[1]!.toLowerCase();
    if (STOP_WORDS.has(word) || (word.length < 2 && !/\d/.test(word))) continue;
    terms.push(`"${word}"${found[2] ? "*" : ""}`);
  }
  const unique = [...new Set(terms)].slice(0, 12);
  if (!unique.length) return null;
  return { all: unique.join(" "), any: unique.join(" OR ") };
}

/** The best match per topic: its score (lower is better, as bm25 gives it) and a snippet with the matching words marked «like this». */
export async function searchTopics(env: Env, match: string, filters: { where: string[]; binds: unknown[] }, maximumTopicCount: number, startIndex: number) {
  const { results } = await env.DB.prepare(
    // The matches are worked out first (MATERIALIZED), since bm25 can't run inside the grouping.
    `WITH hits AS MATERIALIZED (
       SELECT topic_id, bm25(forum_search, 4.0, 1.0) AS rank_score, snippet(forum_search, -1, '«', '»', '…', 14) AS snippet_text FROM forum_search WHERE forum_search MATCH ?
     ), best AS (SELECT topic_id, MIN(rank_score) AS rank_score, snippet_text FROM hits GROUP BY topic_id)
     SELECT topic.*, best.snippet_text AS search_match FROM best JOIN forum_topics topic ON topic.id = best.topic_id
     WHERE ${filters.where.join(" AND ")}
     ORDER BY best.rank_score * (1.0 + 0.4 * (topic.answer_post_id IS NOT NULL OR topic.topic_status = 'answered') + 0.4 * (topic.known_issue_title IS NOT NULL) + 0.03 * MIN(topic.vote_count, 20)) LIMIT ? OFFSET ?`,
  )
    .bind(match, ...filters.binds, maximumTopicCount, startIndex)
    .all<ForumTopic & { search_match: string }>();
  return results;
}
