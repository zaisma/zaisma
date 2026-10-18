import type { Env } from "./env.ts";
import { mentionedNames } from "./forum-markdown.ts";

/**
 * @mentions in forum posts. A mention is saved to the account it means when the post is made (the
 * people in the topic first, then anyone who has posted in the forum). Usernames are unique, so it's
 * one person. @Zaisma reaches the people who build Zaisma, on the admin pages.
 */

export async function saveMentions(env: Env, topicId: string, postId: string, text: string, posterId: string | null): Promise<void> {
  for (const written of mentionedNames(text)) {
    const lower = written.toLowerCase();
    let mentioned: { id: string; name: string } | null = null;
    if (lower === "zaisma") mentioned = { id: "zaisma", name: "Zaisma" };
    else {
      mentioned =
        (await env.DB.prepare("SELECT account.id, account.username AS name FROM accounts account WHERE account.username = ? COLLATE NOCASE AND account.id IN (SELECT account_id FROM forum_posts WHERE topic_id = ?) LIMIT 1")
          .bind(lower, topicId)
          .first<{ id: string; name: string }>()) ??
        (await env.DB.prepare(
          "SELECT account.id, account.username AS name FROM accounts account JOIN forum_posts post ON post.account_id = account.id AND post.check_status = 'passed' WHERE account.username = ? COLLATE NOCASE GROUP BY account.id ORDER BY MAX(post.created_at_ms) DESC LIMIT 1",
        )
          .bind(lower)
          .first<{ id: string; name: string }>());
    }
    if (mentioned && mentioned.id !== posterId) await env.DB.prepare("INSERT OR IGNORE INTO forum_mentions (post_id, account_id, name) VALUES (?, ?, ?)").bind(postId, mentioned.id, mentioned.name).run();
  }
}

/** For a preview: the names in a draft that would be saved as mentions if it were posted now. */
export async function previewMentions(env: Env, text: string): Promise<Set<string>> {
  const names = new Set<string>();
  for (const written of mentionedNames(text)) {
    const lower = written.toLowerCase();
    if (lower === "zaisma") names.add(lower);
    else if (
      await env.DB.prepare("SELECT 1 AS is_found FROM accounts account WHERE account.username = ? COLLATE NOCASE AND EXISTS (SELECT 1 FROM forum_posts post WHERE post.account_id = account.id AND post.check_status = 'passed') LIMIT 1")
        .bind(lower)
        .first()
    ) {
      names.add(lower);
    }
  }
  return names;
}

/** Once a post can be seen: everyone it mentions follows the topic, with it unread for them. */
export async function notifyMentions(env: Env, postId: string, topicId: string, postedAtMs: number): Promise<void> {
  const { results } = await env.DB.prepare("SELECT account_id FROM forum_mentions WHERE post_id = ? AND account_id != 'zaisma'").bind(postId).all<{ account_id: string }>();
  for (const mention of results) {
    await env.DB.prepare("INSERT INTO forum_follows (topic_id, account_id, seen_at_ms) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET seen_at_ms = MIN(seen_at_ms, excluded.seen_at_ms)")
      .bind(topicId, mention.account_id, postedAtMs - 1)
      .run();
  }
}

/** The names each post mentions, for showing them. */
export async function mentionsOf(env: Env, postIds: string[]): Promise<Map<string, string[]>> {
  const names = new Map<string, string[]>();
  for (let i = 0; i < postIds.length; i += 90) {
    const chunk = postIds.slice(i, i + 90);
    const { results } = await env.DB.prepare(`SELECT post_id, name FROM forum_mentions WHERE post_id IN (${chunk.map(() => "?").join(", ")})`).bind(...chunk).all<{ post_id: string; name: string }>();
    for (const mention of results) names.set(mention.post_id, [...(names.get(mention.post_id) ?? []), mention.name]);
  }
  return names;
}

/**
 * People to mention, for the @ suggestions: Zaisma, then whoever is in the topic, then anyone who
 * has posted in the forum, by the start of their name, never yourself. Only names already shown on the forum.
 */
export async function forumPeople(env: Env, namePrefix: string, topicId: string | null, viewerId: string | null = null): Promise<{ name: string; is_zaisma: boolean; is_in_topic: boolean }[]> {
  const start = namePrefix.trim().toLowerCase().slice(0, 40);
  const like = `${start.replace(/[\\%_]/g, (special) => `\\${special}`)}%`;
  const people: { name: string; is_zaisma: boolean; is_in_topic: boolean }[] = [];
  if ("zaisma".startsWith(start)) people.push({ name: "Zaisma", is_zaisma: true, is_in_topic: false });
  const seen = new Set<string>(["zaisma"]);
  const add = (name: string, isInTopic: boolean) => {
    if (people.length >= 8 || seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    people.push({ name, is_zaisma: false, is_in_topic: isInTopic });
  };
  if (topicId) {
    const { results } = await env.DB.prepare(
      "SELECT account.username AS name FROM accounts account JOIN forum_posts post ON post.account_id = account.id AND post.topic_id = ? AND post.check_status = 'passed' WHERE LOWER(account.username) LIKE ? ESCAPE '\\' AND account.id != ? GROUP BY account.id ORDER BY MAX(post.created_at_ms) DESC LIMIT 8",
    )
      .bind(topicId, like, viewerId ?? "")
      .all<{ name: string }>();
    for (const person of results) add(person.name, true);
  }
  if (people.length < 8 && start) {
    const { results } = await env.DB.prepare(
      "SELECT account.username AS name FROM accounts account JOIN forum_posts post ON post.account_id = account.id AND post.check_status = 'passed' WHERE LOWER(account.username) LIKE ? ESCAPE '\\' AND account.id != ? GROUP BY account.id ORDER BY MAX(post.created_at_ms) DESC LIMIT 12",
    )
      .bind(like, viewerId ?? "")
      .all<{ name: string }>();
    for (const person of results) add(person.name, false);
  }
  return people;
}
