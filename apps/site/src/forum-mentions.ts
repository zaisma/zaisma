import type { Env } from "./env.ts";
import { mentionedNames } from "./forum-markdown.ts";

/**
 * @mentions in forum posts. A mention is saved to the account it means when the post is made (the
 * people in the topic first, then anyone who has posted in the forum), so the right person hears
 * even when two share a name. @Zaisma reaches the people who build Zaisma, on the admin pages.
 */

export async function saveMentions(env: Env, topicId: string, postId: string, text: string, by: string | null): Promise<void> {
  for (const written of mentionedNames(text)) {
    const lower = written.toLowerCase();
    let who: { id: string; name: string } | null = null;
    if (lower === "zaisma") who = { id: "zaisma", name: "Zaisma" };
    else {
      who =
        (await env.DB.prepare("SELECT a.id, a.name FROM accounts a WHERE LOWER(a.name) = ? AND a.id IN (SELECT account_id FROM feedback_posts WHERE feedback_id = ?) LIMIT 1")
          .bind(lower, topicId)
          .first<{ id: string; name: string }>()) ??
        (await env.DB.prepare(
          "SELECT a.id, a.name FROM accounts a JOIN feedback_posts p ON p.account_id = a.id AND p.check_state = 'ok' WHERE LOWER(a.name) = ? GROUP BY a.id ORDER BY MAX(p.created_at) DESC LIMIT 1",
        )
          .bind(lower)
          .first<{ id: string; name: string }>());
    }
    if (who && who.id !== by) await env.DB.prepare("INSERT OR IGNORE INTO feedback_mentions (post_id, account_id, name) VALUES (?, ?, ?)").bind(postId, who.id, who.name).run();
  }
}

/** Once a post can be seen: everyone it mentions follows the topic, with it unread for them. */
export async function notifyMentions(env: Env, postId: string, topicId: string, at: number): Promise<void> {
  const { results } = await env.DB.prepare("SELECT account_id FROM feedback_mentions WHERE post_id = ? AND account_id != 'zaisma'").bind(postId).all<{ account_id: string }>();
  for (const m of results) {
    await env.DB.prepare("INSERT INTO feedback_follows (feedback_id, account_id, seen_at) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET seen_at = MIN(seen_at, excluded.seen_at)").bind(topicId, m.account_id, at - 1).run();
  }
}

/** The names each post mentions, lowercased, for showing them. */
export async function mentionsOf(env: Env, postIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (let i = 0; i < postIds.length; i += 90) {
    const chunk = postIds.slice(i, i + 90);
    const { results } = await env.DB.prepare(`SELECT post_id, name FROM feedback_mentions WHERE post_id IN (${chunk.map(() => "?").join(", ")})`).bind(...chunk).all<{ post_id: string; name: string }>();
    for (const r of results) out.set(r.post_id, [...(out.get(r.post_id) ?? []), r.name]);
  }
  return out;
}

/**
 * People to mention, for the @ suggestions: Zaisma, then whoever is in the topic, then anyone who
 * has posted in the forum, by the start of their name, never yourself. Only names already shown on the forum.
 */
export async function forumPeople(env: Env, q: string, topicId: string | null, me: string | null = null): Promise<{ name: string; zaisma: boolean; in_topic: boolean }[]> {
  const start = q.trim().toLowerCase().slice(0, 40);
  const like = `${start.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const out: { name: string; zaisma: boolean; in_topic: boolean }[] = [];
  if ("zaisma".startsWith(start)) out.push({ name: "Zaisma", zaisma: true, in_topic: false });
  const seen = new Set<string>(["zaisma"]);
  if (topicId) {
    const { results } = await env.DB.prepare(
      "SELECT a.name FROM accounts a JOIN feedback_posts p ON p.account_id = a.id AND p.feedback_id = ? AND p.check_state = 'ok' WHERE LOWER(a.name) LIKE ? ESCAPE '\\' AND a.id != ? GROUP BY a.id ORDER BY MAX(p.created_at) DESC LIMIT 8",
    )
      .bind(topicId, like, me ?? "")
      .all<{ name: string }>();
    for (const r of results) if (!seen.has(r.name.toLowerCase())) (seen.add(r.name.toLowerCase()), out.push({ name: r.name, zaisma: false, in_topic: true }));
  }
  if (out.length < 8 && start) {
    const { results } = await env.DB.prepare(
      "SELECT a.name FROM accounts a JOIN feedback_posts p ON p.account_id = a.id AND p.check_state = 'ok' WHERE LOWER(a.name) LIKE ? ESCAPE '\\' AND a.id != ? GROUP BY a.id ORDER BY MAX(p.created_at) DESC LIMIT 12",
    )
      .bind(like, me ?? "")
      .all<{ name: string }>();
    for (const r of results) if (out.length < 8 && !seen.has(r.name.toLowerCase())) (seen.add(r.name.toLowerCase()), out.push({ name: r.name, zaisma: false, in_topic: false }));
  }
  return out.slice(0, 8);
}
