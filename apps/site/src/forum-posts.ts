import {
  DEBUG_CONTEXT_KEYS,
  FORUM_LIMITS,
  TOPIC_SEVERITIES,
  TOPIC_STATUSES,
  ApiError,
  apiKeyTokensIn,
  blankSecrets,
  secondsUntilDayPasses,
  forumMediaKey,
  newId,
  sniffImage,
  type AuthorKind,
  type ForumPost,
  type ForumTopic,
  type PostedVia,
  type TopicSeverity,
  type TopicStatus,
  checkShownText,
} from "@zaisma/core";
import type { Caller } from "./developer.ts";
import type { Env } from "./env.ts";
import { checkPost } from "./forum-check.ts";
import { notifyMentions, saveMentions } from "./forum-mentions.ts";
import { matchUpload, refuse } from "./forum-images.ts";
import { indexPost, indexTopic, unindexTopic } from "./forum-search.ts";
import { turnOffLeakedKeys } from "./leaked-keys.ts";

/**
 * Posting in the developer forum (forum.ts has the calls): reading and storing a post with its
 * images, the daily allowance, and what Zaisma decides about a topic, from the admin pages, the
 * admin MCP or AI sorting.
 */

const DAY_MS = 86400_000;
/** Known issues: Zaisma's own public topics, each with the private messages merged into it. */
export const KNOWN_ISSUES = "SELECT * FROM forum_topics WHERE known_issue_title IS NOT NULL AND merged_into_topic_id IS NULL";

/** Who wrote a post, from what the server knows: the MCP is always an AI, the dashboard and forum pages are the developer, and API callers say (AI unless told otherwise). */
export function authorOf(caller: Caller, body: Record<string, unknown>): { authorKind: AuthorKind; postedVia: PostedVia } {
  if (caller.via === "mcp") return { authorKind: "ai", postedVia: "mcp" };
  if (caller.via === "dashboard") return { authorKind: "developer", postedVia: "dashboard" };
  if (body.author_kind !== undefined && body.author_kind !== "developer" && body.author_kind !== "ai") {
    throw new ApiError("bad_author_kind", { message: `author_kind ${JSON.stringify(body.author_kind)} isn't developer or ai.`, field: "author_kind", fix: "Give developer (you wrote it yourself) or ai (your AI wrote it, the default), or leave it out." });
  }
  return { authorKind: body.author_kind === "developer" ? "developer" : "ai", postedVia: caller.client === "cli" ? "cli" : "api" };
}

export async function topicById(env: Env, topicId: string): Promise<ForumTopic | null> {
  return env.DB.prepare("SELECT * FROM forum_topics WHERE id = ?").bind(topicId).first<ForumTopic>();
}

/** How many developers each known issue affects: the people with a message merged into it, and those who said "Me too". */
export async function affectedDeveloperCounts(env: Env, topicIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  // D1 takes at most 100 values per query: three per id.
  for (let i = 0; i < topicIds.length; i += 30) {
    const chunk = topicIds.slice(i, i + 30);
    const marks = chunk.map(() => "?").join(", ");
    const { results } = await env.DB.prepare(
      `SELECT known_issue_id, COUNT(DISTINCT developer_id) AS developer_count FROM (
         SELECT COALESCE(merged_into_topic_id, id) AS known_issue_id, account_id AS developer_id FROM forum_topics WHERE account_id IS NOT NULL AND (id IN (${marks}) OR merged_into_topic_id IN (${marks}))
         UNION SELECT topic_id, account_id FROM forum_votes WHERE topic_id IN (${marks})
       ) GROUP BY known_issue_id`,
    )
      .bind(...chunk, ...chunk, ...chunk)
      .all<{ known_issue_id: string; developer_count: number }>();
    for (const row of results) counts.set(row.known_issue_id, row.developer_count);
  }
  return counts;
}

/** Zaisma replied to or changed the developer's own topic since they last opened it. */
export const hasNews = (topic: ForumTopic) => Boolean(topic.news_at_ms && topic.news_at_ms > (topic.seen_at_ms ?? 0));

/** The images each post carries, in order. */
export async function mediaOf(env: Env, postIds: string[]): Promise<Map<string, { id: string; content_type: string; storage_key: string }[]>> {
  const images = new Map<string, { id: string; content_type: string; storage_key: string }[]>();
  for (let i = 0; i < postIds.length; i += 90) {
    const chunk = postIds.slice(i, i + 90);
    const { results } = await env.DB.prepare(`SELECT id, post_id, content_type, storage_key FROM forum_media WHERE post_id IN (${chunk.map(() => "?").join(", ")}) ORDER BY position_index`)
      .bind(...chunk)
      .all<{ id: string; post_id: string; content_type: string; storage_key: string }>();
    for (const image of results) images.set(image.post_id, [...(images.get(image.post_id) ?? []), { id: image.id, content_type: image.content_type, storage_key: image.storage_key }]);
  }
  return images;
}

/** How many more posts the account can make today (FORUM_LIMITS.postsPerDay over the last 24 hours). */
export async function remainingPostCount(env: Env, caller: Caller): Promise<number> {
  return (await postAllowance(env, caller)).remainingPostCount;
}

/** How many more posts the account can make today, and when the oldest post of the last day was made. */
async function postAllowance(env: Env, caller: Caller): Promise<{ remainingPostCount: number; oldestAtMs: number | null }> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS post_count, MIN(created_at_ms) AS oldest_at_ms FROM forum_posts WHERE account_id = ? AND created_at_ms > ?")
    .bind(caller.accountId, Date.now() - DAY_MS)
    .first<{ post_count: number; oldest_at_ms: number | null }>();
  return { remainingPostCount: Math.max(0, FORUM_LIMITS.postsPerDay - (row?.post_count ?? 0)), oldestAtMs: row?.oldest_at_ms ?? null };
}

/** A post as it was sent, checked and with its secrets blanked, ready to store. */
export interface PostDraft {
  textMarkdown: string;
  /** DebugContext as JSON, with every key. */
  debugContext: string | null;
  /** Up to FORUM_LIMITS.imageCountPerPost images. */
  images: { bytes: Uint8Array; contentType: string }[];
  authorKind: AuthorKind;
  postedVia: PostedVia;
  blankedCount: number;
}

/** An image someone sent: PNG, JPEG, WebP or GIF, up to FORUM_LIMITS.imageSizeBytes. */
export function readImage(bytes: Uint8Array): { bytes: Uint8Array; contentType: string } {
  if (bytes.byteLength > FORUM_LIMITS.imageSizeBytes) {
    throw new ApiError("image_too_big", { message: `An image is over ${FORUM_LIMITS.imageSizeBytes / 1048576} MB.`, field: "images_base64", fix: "Save it smaller (a JPEG or WebP, or fewer pixels) and send it again." });
  }
  const isGif = bytes.length > 6 && /^GIF8[79]a$/.test(String.fromCharCode(...bytes.subarray(0, 6)));
  const sniffed = isGif ? { type: "image/gif" } : sniffImage(bytes);
  if (!sniffed) throw new ApiError("not_an_image", { message: "An image isn't a PNG, JPEG, WebP or GIF.", field: "images_base64", fix: "Send PNG, JPEG, WebP or GIF images; take a screenshot of anything else." });
  return { bytes, contentType: sniffed.type };
}

/** The images placed in a post's text: ![…](/forum/media/ID). */
export const placedMedia = (text: string) => [...new Set([...text.matchAll(/\(\/forum\/media\/(media_[a-z0-9]{1,40})\)/g)].map((placed) => placed[1]!))];

/** debug_context as it's stored: the template's keys only, each a string or null, secrets blanked. */
function readDebugContext(given: unknown): { json: string | null; blankedCount: number } {
  if (given === undefined || given === null) return { json: null, blankedCount: 0 };
  if (typeof given !== "object" || Array.isArray(given)) {
    throw new ApiError("bad_debug_context", {
      message: `debug_context is ${Array.isArray(given) ? "a list" : `a ${typeof given}`}, not an object.`,
      field: "debug_context",
      fix: `Send an object with any of: ${DEBUG_CONTEXT_KEYS.join(", ")}, each text, like { "call": "upload_files", "error_code": "too_big" }.`,
    });
  }
  const fields = given as Record<string, unknown>;
  let blankedCount = 0;
  const stored: Record<string, string | null> = {};
  for (const key of Object.keys(fields)) {
    if (!(DEBUG_CONTEXT_KEYS as readonly string[]).includes(key)) {
      throw new ApiError("bad_debug_context", { message: `debug_context.${key} isn't one of its fields.`, field: `debug_context.${key}`, fix: `Use only: ${DEBUG_CONTEXT_KEYS.join(", ")}; put anything else in notes.` });
    }
  }
  for (const key of DEBUG_CONTEXT_KEYS) {
    const field = fields[key];
    if (field !== undefined && field !== null && typeof field !== "string") {
      throw new ApiError("bad_debug_context", { message: `debug_context.${key} isn't text.`, field: `debug_context.${key}`, fix: "Send it as a string; JSON goes in request_json as text." });
    }
    const cleaned = typeof field === "string" && field.trim() ? blankSecrets(field.trim()) : null;
    blankedCount += cleaned?.blankedCount ?? 0;
    stored[key] = cleaned?.text ?? null;
  }
  const json = JSON.stringify(stored);
  if (json.length > FORUM_LIMITS.debugContextCharacterCount) {
    throw new ApiError("bad_debug_context", {
      message: `debug_context is over ${FORUM_LIMITS.debugContextCharacterCount} characters in all.`,
      field: "debug_context",
      fix: "Keep the call that failed and its error; leave out whole files and long logs.",
    });
  }
  return { json, blankedCount };
}

const tooManyImages = (imageCount: number) =>
  new ApiError("too_many_images", { message: `The post carries ${imageCount} images, over ${FORUM_LIMITS.imageCountPerPost}.`, field: "images_base64", fix: `Send up to ${FORUM_LIMITS.imageCountPerPost} images a post (4 through the MCP); put the rest in a reply.` });

/**
 * Turns off any API key in the texts a post carries, before they're blanked: a key written in a forum post is
 * out of the developer's hands. foundAtUrl is the topic's public address, or null for a private message to Zaisma.
 */
export async function turnOffKeysIn(env: Env, texts: unknown[], foundAtUrl: string | null): Promise<void> {
  const tokens = apiKeyTokensIn(texts.filter((each): each is string => typeof each === "string").join("\n"));
  if (tokens.length > 0) await turnOffLeakedKeys(env, tokens, { foundIn: "forum_post", foundAtUrl });
}

/** The address a public topic has on zaisma.com. */
export const topicAddress = (env: Env, topicId: string) => `${env.SITE_ORIGIN}/forum/${topicId}`;

/** Checks a post and blanks its secrets, before anything is stored. foundAtUrl: the topic's public address, or null when it's private. */
export async function readPost(env: Env, caller: Caller, body: Record<string, unknown>, foundAtUrl: string | null): Promise<PostDraft> {
  const allowance = await postAllowance(env, caller);
  if (allowance.remainingPostCount <= 0) {
    throw new ApiError("post_limit", {
      message: `The account has posted ${FORUM_LIMITS.postsPerDay} times in the last day, the most it can.`,
      fix: "Wait until the oldest of those posts is a day old; if something is urgent, write to Zaisma by email.",
      retryAfterSec: secondsUntilDayPasses(allowance.oldestAtMs),
    });
  }
  const given = typeof body.text_markdown === "string" ? body.text_markdown.trim() : "";
  const shown = checkShownText(given, { field: "text_markdown", maximumCharacterCount: FORUM_LIMITS.textCharacterCount, isMultiline: true });
  if (given && given.length <= FORUM_LIMITS.textCharacterCount && "problem" in shown) throw new ApiError("bad_text_markdown", { message: shown.problem.message, field: "text_markdown", fix: shown.problem.fix });
  if (!given || given.length > FORUM_LIMITS.textCharacterCount) {
    throw new ApiError("bad_text_markdown", {
      message: given ? `text_markdown is ${given.length} characters, over ${FORUM_LIMITS.textCharacterCount}.` : "text_markdown is empty or missing.",
      field: "text_markdown",
      fix: `Say what happened in 1 to ${FORUM_LIMITS.textCharacterCount} characters of markdown; long logs go in debug_context, shortened.`,
    });
  }
  const debugFields = body.debug_context && typeof body.debug_context === "object" && !Array.isArray(body.debug_context) ? Object.values(body.debug_context) : [];
  await turnOffKeysIn(env, [given, ...debugFields], foundAtUrl);
  const text = blankSecrets(given);
  const debugContext = readDebugContext(body.debug_context);
  // Images as base64: PNG, JPEG, WebP or GIF.
  const sent = body.images_base64 === undefined ? [] : body.images_base64;
  if (!Array.isArray(sent)) throw new ApiError("bad_images_base64", { message: "images_base64 isn't a list.", field: "images_base64", fix: 'Send a list of images, each base64-encoded, like ["iVBORw0KGgo…"].' });
  if (sent.length > FORUM_LIMITS.imageCountPerPost) throw tooManyImages(sent.length);
  const images: PostDraft["images"] = [];
  for (const [i, encoded] of sent.entries()) {
    const notBase64 = () => new ApiError("bad_base64", { message: `images_base64[${i}] isn't valid base64.`, field: `images_base64[${i}]`, fix: "Send the image file's bytes base64-encoded, nothing else around them." });
    if (typeof encoded !== "string" || !encoded) throw notBase64();
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(encoded.replace(/^data:[^,]*,/, "").replace(/\s+/g, "")), (character) => character.charCodeAt(0));
    } catch {
      throw notBase64();
    }
    images.push(readImage(bytes));
  }
  return { textMarkdown: text.text, debugContext: debugContext.json, images, blankedCount: text.blankedCount + debugContext.blankedCount, ...authorOf(caller, body) };
}

/**
 * Stores a post. On a private topic it's there at once for the developer and Zaisma; on a public one
 * it's checked first, and others see it once it passes (forum-check.ts).
 */
export async function storePost(
  env: Env,
  topic: ForumTopic,
  caller: Caller,
  post: PostDraft,
  kind: "post" | "reopen",
  replyToPostId: string | null = null,
): Promise<{ id: string; checkStatus: ForumPost["check_status"] }> {
  const id = newId("post");
  const nowMs = Date.now();
  // Images placed in the text were uploaded while it was written: the writer's own, not posted yet.
  const placed = placedMedia(post.textMarkdown);
  const drafts = placed.length
    ? (
        await env.DB.prepare(`SELECT id FROM forum_media WHERE account_id = ? AND post_id IS NULL AND id IN (${placed.map(() => "?").join(", ")})`)
          .bind(caller.accountId, ...placed)
          .all<{ id: string }>()
      ).results.map((draft) => draft.id)
    : [];
  if (drafts.length + post.images.length > FORUM_LIMITS.imageCountPerPost) throw tooManyImages(drafts.length + post.images.length);
  for (const [positionIndex, mediaId] of placed.filter((placedId) => drafts.includes(placedId)).entries()) {
    await env.DB.prepare("UPDATE forum_media SET post_id = ?, position_index = ? WHERE id = ? AND account_id = ? AND post_id IS NULL").bind(id, positionIndex, mediaId, caller.accountId).run();
  }
  // Every image is matched against known abuse material as it comes in; a match refuses the post.
  const matched: { mediaId: string; isClean: boolean }[] = [];
  for (const image of post.images) {
    const mediaId = newId("media");
    const outcome = await matchUpload(env, mediaId, image.bytes, image.contentType, caller.accountId);
    if (outcome === "match") refuse();
    matched.push({ mediaId, isClean: outcome === "clean" });
  }
  for (const [i, image] of post.images.entries()) {
    const { mediaId, isClean } = matched[i]!;
    await env.GAMES.put(forumMediaKey(mediaId), image.bytes, { httpMetadata: { contentType: image.contentType } });
    await env.DB.prepare("INSERT INTO forum_media (id, post_id, account_id, content_type, position_index, created_at_ms, has_passed_matching, storage_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(mediaId, id, caller.accountId, image.contentType, drafts.length + i, nowMs, isClean ? 1 : 0, forumMediaKey(mediaId))
      .run();
  }
  await env.DB.prepare(
    "INSERT INTO forum_posts (id, topic_id, account_id, author_kind, posted_via, kind, text_markdown, debug_context, created_at_ms, reply_to_post_id, check_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, topic.id, caller.accountId, post.authorKind, post.postedVia, kind, post.textMarkdown, post.debugContext, nowMs, replyToPostId, topic.is_public ? "pending" : null)
    .run();
  // Mentions mean someone only in public topics; they hear once others can see the post.
  if (topic.is_public) await saveMentions(env, topic.id, id, post.textMarkdown, caller.accountId);
  // Whoever posts follows the topic, and has seen it up to now.
  await env.DB.prepare("INSERT INTO forum_follows (topic_id, account_id, seen_at_ms) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET seen_at_ms = excluded.seen_at_ms").bind(topic.id, caller.accountId, nowMs).run();
  if (!topic.is_public) {
    await env.DB.prepare("UPDATE forum_topics SET last_activity_at_ms = ? WHERE id = ?").bind(nowMs, topic.id).run();
    return { id, checkStatus: null };
  }
  return { id, checkStatus: await checkPost(env, id) };
}

export function readTitle(body: Record<string, unknown>): string {
  const title = typeof body.title === "string" ? body.title.trim().replace(/\s+/g, " ") : "";
  const shown = checkShownText(title, { field: "title", maximumCharacterCount: FORUM_LIMITS.titleCharacterCount, isRequired: true });
  if (title && title.length <= FORUM_LIMITS.titleCharacterCount && "problem" in shown) throw new ApiError("bad_title", { message: shown.problem.message, field: "title", fix: shown.problem.fix });
  if (!title || title.length > FORUM_LIMITS.titleCharacterCount) {
    throw new ApiError("bad_title", { message: `title is empty or over ${FORUM_LIMITS.titleCharacterCount} characters.`, field: "title", fix: `Give one specific line of 1 to ${FORUM_LIMITS.titleCharacterCount} characters, like "upload_files fails with too_big for a 3 MB game".` });
  }
  return blankSecrets(title).text;
}

/**
 * An image uploaded while a post is written, to place in its text. Only its uploader sees it until
 * the post that places it is made; one never posted goes after a day (dailyCleanup).
 */
export async function uploadDraftMedia(env: Env, caller: Caller, bytes: Uint8Array) {
  const today = await env.DB.prepare("SELECT COUNT(*) AS image_count, MIN(created_at_ms) AS oldest_at_ms FROM forum_media WHERE account_id = ? AND created_at_ms > ?")
    .bind(caller.accountId, Date.now() - DAY_MS)
    .first<{ image_count: number; oldest_at_ms: number | null }>();
  if ((today?.image_count ?? 0) >= FORUM_LIMITS.imagesPerDay) {
    throw new ApiError("image_limit", {
      message: `The account has uploaded ${FORUM_LIMITS.imagesPerDay} forum images in the last day, the most it can.`,
      fix: "Wait until the oldest is a day old, or post without images meanwhile.",
      retryAfterSec: secondsUntilDayPasses(today?.oldest_at_ms),
    });
  }
  const image = readImage(bytes);
  const id = newId("media");
  const outcome = await matchUpload(env, id, image.bytes, image.contentType, caller.accountId);
  if (outcome === "match") refuse();
  await env.GAMES.put(forumMediaKey(id), image.bytes, { httpMetadata: { contentType: image.contentType } });
  await env.DB.prepare("INSERT INTO forum_media (id, post_id, account_id, content_type, position_index, created_at_ms, has_passed_matching, storage_key) VALUES (?, NULL, ?, ?, 0, ?, ?, ?)")
    .bind(id, caller.accountId, image.contentType, Date.now(), outcome === "clean" ? 1 : 0, forumMediaKey(id))
    .run();
  // The path is what a post's text carries; it works on the forum's pages and through the API.
  return { id, image_url: `${env.SITE_ORIGIN}/forum/media/${id}`, image_markdown: `![image](/forum/media/${id})` };
}

/** Draft images never posted, after a day. */
export async function deleteStaleDraftMedia(env: Env, nowMs = Date.now()): Promise<number> {
  const { results } = await env.DB.prepare("SELECT id, storage_key FROM forum_media WHERE post_id IS NULL AND created_at_ms < ? LIMIT 500").bind(nowMs - DAY_MS).all<{ id: string; storage_key: string }>();
  if (!results.length) return 0;
  await env.GAMES.delete(results.map((image) => image.storage_key));
  for (let i = 0; i < results.length; i += 90) {
    const chunk = results.slice(i, i + 90);
    await env.DB.prepare(`DELETE FROM forum_media WHERE id IN (${chunk.map(() => "?").join(", ")})`).bind(...chunk.map((image) => image.id)).run();
  }
  return results.length;
}

/** For account deletion: the files of the account's forum images, and of every image in its own topics (the rows go with deleteAccount). */
export async function deleteForumFiles(env: Env, accountId: string): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT media.storage_key FROM forum_media media LEFT JOIN forum_posts post ON post.id = media.post_id WHERE media.account_id = ? OR post.account_id = ? OR post.topic_id IN (SELECT id FROM forum_topics WHERE account_id = ? AND known_issue_title IS NULL)",
  )
    .bind(accountId, accountId, accountId)
    .all<{ storage_key: string }>();
  for (let i = 0; i < results.length; i += 500) await env.GAMES.delete(results.slice(i, i + 500).map((image) => image.storage_key));
}

// --- What Zaisma decides about a topic ---

/** What a person (or AI sorting) decided; only what's given changes. */
export interface TopicDecision {
  topicStatus?: string;
  reply?: string;
  mergeIntoTopicId?: string;
  knownIssue?: { title: string; workaround?: string; roadmapItem?: string } | null;
  severity?: TopicSeverity;
  category?: string;
  /** Marks a post in the topic as its answer (null clears it). */
  answerPostId?: string | null;
  /** Decided by AI sorting, not a person: the developer is told so. */
  isByAi?: boolean;
}

/** Zaisma's own posts need no check: on a public topic everyone sees them at once. */
export async function zaismaPost(env: Env, topicId: string, kind: "post" | "status", text: string, atMs: number) {
  const id = newId("post");
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO forum_posts (id, topic_id, account_id, author_kind, posted_via, kind, text_markdown, created_at_ms, check_status) SELECT ?, id, NULL, 'zaisma', 'admin', ?, ?, ?, CASE WHEN is_public = 1 THEN 'passed' END FROM forum_topics WHERE id = ?",
    ).bind(id, kind, text, atMs, topicId),
    env.DB.prepare("UPDATE forum_topics SET updated_at_ms = ?, news_at_ms = ?, last_activity_at_ms = ?, reply_count = reply_count + is_public WHERE id = ?").bind(atMs, atMs, atMs, topicId),
  ]);
  const topic = await env.DB.prepare("SELECT is_shown FROM forum_topics WHERE id = ?").bind(topicId).first<{ is_shown: number }>();
  if (topic?.is_shown) {
    await indexPost(env, { id, topic_id: topicId, text_markdown: text, kind });
    await saveMentions(env, topicId, id, text, null);
    await notifyMentions(env, id, topicId, atMs);
  }
}

const STATUS_WORDS: Record<TopicStatus, string> = {
  new: "Zaisma opened this again.",
  investigating: "Zaisma is looking into this.",
  known: "Zaisma knows about this.",
  planned: "This is on Zaisma's roadmap.",
  fixing: "Zaisma is working on a fix.",
  released: "A fix is out. Zaisma is watching that it holds; if it still happens, say so here.",
  fixed: "Zaisma fixed this.",
  wont: "Zaisma won't change this.",
  answered: "Zaisma answered this.",
};

/**
 * What Zaisma decided, in one call: a reply, a status (for a known issue, every message merged into
 * it too, and each developer hears), merging into a known issue, making a topic a known issue (its
 * cleaned-up title, workaround and roadmap item, which every developer sees), severity, category and
 * the answer. A private message made a known issue becomes a public topic of Zaisma's own with the
 * message under it, so nothing the developer wrote in private is shown; the reply still goes to them alone.
 * Everything is checked before anything changes, so a refused decision (an ApiError, in the admin MCP's
 * names) changes nothing.
 */
export async function decideTopic(env: Env, topicId: string, decision: TopicDecision): Promise<void> {
  let topic = await topicById(env, topicId);
  const listFix = "list_topics in the admin MCP lists the topics with their IDs.";
  if (!topic) throw new ApiError("no_topic", { message: `There's no topic with the ID ${topicId}.`, field: "topic_id", fix: listFix });
  const atMs = Date.now();
  const topicStatus = decision.topicStatus?.trim() as TopicStatus | undefined;
  if (topicStatus && !TOPIC_STATUSES.includes(topicStatus)) {
    throw new ApiError("bad_topic_status", { message: `${topicStatus} isn't a topic status.`, field: "topic_status", fix: `Give one of: ${TOPIC_STATUSES.join(", ")}.` });
  }
  if (decision.severity !== undefined && !TOPIC_SEVERITIES.includes(decision.severity)) {
    throw new ApiError("bad_severity", { message: `${decision.severity} isn't a severity.`, field: "severity", fix: `Give one of: ${TOPIC_SEVERITIES.join(", ")}.` });
  }
  let target = decision.mergeIntoTopicId ? await topicById(env, decision.mergeIntoTopicId) : null;
  if (target?.merged_into_topic_id) target = await topicById(env, target.merged_into_topic_id);
  if (decision.mergeIntoTopicId && !target) throw new ApiError("no_topic", { message: `There's no topic with the ID ${decision.mergeIntoTopicId}.`, field: "merge_into_topic_id", fix: listFix });
  if (target && target.id === topic.id) {
    throw new ApiError("cant_merge", { message: "A topic can't be merged into itself.", field: "merge_into_topic_id", fix: "Give another topic: a known issue or the first message of a group." });
  }
  const mergedIntoTopicId = target?.id ?? topic.merged_into_topic_id;
  if (decision.knownIssue !== undefined && mergedIntoTopicId) {
    throw new ApiError("already_merged", {
      message: target ? "A topic being merged into another can't be made a known issue too." : "This topic is merged into another.",
      field: "known_issue",
      fix: `Make that one the known issue: decide_topic with topic_id ${mergedIntoTopicId}.`,
    });
  }
  if (decision.knownIssue && !decision.knownIssue.title?.trim()) {
    throw new ApiError("bad_known_issue", { message: "A known issue needs a title every developer can read.", field: "known_issue.title", fix: "Give a general title, with no names, games or anything said in private." });
  }
  if (decision.answerPostId && !(await env.DB.prepare("SELECT id FROM forum_posts WHERE id = ? AND topic_id = ?").bind(decision.answerPostId, topic.id).first())) {
    throw new ApiError("no_post", { message: `${decision.answerPostId} isn't a post in this topic.`, field: "answer_post_id", fix: "get_topic in the admin MCP lists the topic's posts with their IDs." });
  }
  const answerTopicId = topic.id;
  const reply = decision.reply?.trim().slice(0, FORUM_LIMITS.textCharacterCount) ?? "";
  const withMerged = async (knownIssueId: string) =>
    (await env.DB.prepare("SELECT id FROM forum_topics WHERE id = ? OR merged_into_topic_id = ?").bind(knownIssueId, knownIssueId).all<{ id: string }>()).results.map((row) => row.id);

  if (target) {
    // The topic and everything already merged into it move under the target.
    await env.DB.batch([
      env.DB.prepare("UPDATE forum_topics SET merged_into_topic_id = ?, known_issue_title = NULL, workaround = NULL, roadmap_item = NULL, updated_at_ms = ? WHERE id = ?").bind(target.id, atMs, topic.id),
      env.DB.prepare("UPDATE forum_topics SET merged_into_topic_id = ?, updated_at_ms = ? WHERE merged_into_topic_id = ?").bind(target.id, atMs, topic.id),
    ]);
    if (target.topic_status !== "new" && topic.topic_status === "new") await env.DB.prepare("UPDATE forum_topics SET topic_status = ? WHERE id = ?").bind(target.topic_status, topic.id).run();
    if (target.known_issue_title) {
      const matched = decision.isByAi ? `Zaisma's AI matched this to a known issue: ${target.known_issue_title}.` : `Zaisma added this to a known issue: ${target.known_issue_title}.`;
      const after = decision.isByAi ? " If it's a different problem, add that here and a person will look." : "";
      await zaismaPost(env, topic.id, "status", `${matched}${target.workaround ? ` Until it's fixed: ${target.workaround}` : ""}${after}`, atMs);
    }
    topic = (await topicById(env, topic.id))!;
  }

  // The developer the reply is for, when the decision moves on to a new known issue.
  let replyFirstTo: string | null = null;
  if (decision.knownIssue !== undefined) {
    const knownIssue = decision.knownIssue;
    // Checked above: a known issue has a title.
    const title = knownIssue?.title?.trim().replace(/\s+/g, " ").slice(0, FORUM_LIMITS.titleCharacterCount) ?? "";
    const workaround = knownIssue?.workaround?.trim().slice(0, 2000) || null;
    const roadmapItem = knownIssue?.roadmapItem?.trim().slice(0, 200) || null;
    if (knownIssue && !topic.is_public) {
      const knownIssueId = newId("topic");
      const knownIssueStatus = topicStatus && topicStatus !== "new" ? topicStatus : topic.topic_status === "new" ? "known" : topic.topic_status;
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO forum_topics (id, account_id, kind, title, topic_status, severity, category, known_issue_title, workaround, roadmap_item, created_at_ms, updated_at_ms, triaged_at_ms, is_public, is_shown, last_activity_at_ms) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)",
        ).bind(knownIssueId, topic.kind, title, knownIssueStatus, topic.severity, topic.category, title, workaround, roadmapItem, atMs, atMs, atMs, atMs),
        env.DB.prepare("UPDATE forum_topics SET merged_into_topic_id = ?, topic_status = ?, updated_at_ms = ? WHERE id = ? OR merged_into_topic_id = ?").bind(knownIssueId, knownIssueStatus, atMs, topic.id, topic.id),
      ]);
      for (const mergedId of await withMerged(knownIssueId)) {
        if (mergedId !== knownIssueId) await zaismaPost(env, mergedId, "status", `Zaisma made this a known issue every developer can see, without anything you wrote: ${title}.${workaround ? ` Until it's fixed: ${workaround}` : ""}`, atMs);
      }
      replyFirstTo = topic.id;
      topic = (await topicById(env, knownIssueId))!;
      await indexTopic(env, knownIssueId);
    } else {
      await env.DB.prepare("UPDATE forum_topics SET known_issue_title = ?, workaround = ?, roadmap_item = ?, updated_at_ms = ? WHERE id = ?").bind(knownIssue ? title : null, workaround, roadmapItem, atMs, topic.id).run();
      // Zaisma's own known issue, taken back: its messages stand on their own again, and the topic goes.
      if (!knownIssue && topic.account_id === null) {
        await env.DB.batch([
          env.DB.prepare("UPDATE forum_topics SET merged_into_topic_id = NULL WHERE merged_into_topic_id = ?").bind(topic.id),
          env.DB.prepare("UPDATE forum_topics SET is_public = 0, is_shown = 0 WHERE id = ?").bind(topic.id),
        ]);
        await unindexTopic(env, topic.id);
      } else await indexTopic(env, topic.id);
      // A new or changed workaround is news for everyone in it.
      if (workaround && workaround !== topic.workaround) for (const mergedId of await withMerged(topic.id)) await zaismaPost(env, mergedId, "status", `Until it's fixed: ${workaround}`, atMs);
      topic = (await topicById(env, topic.id))!;
    }
  }

  if (replyFirstTo && reply) await zaismaPost(env, replyFirstTo, "post", reply, atMs);
  const shared = replyFirstTo ? "" : reply;
  if (topicStatus && topicStatus !== topic.topic_status) {
    for (const mergedId of topic.merged_into_topic_id ? [topic.id] : await withMerged(topic.id)) {
      await env.DB.prepare("UPDATE forum_topics SET topic_status = ? WHERE id = ?").bind(topicStatus, mergedId).run();
      await zaismaPost(env, mergedId, "status", shared ? `${STATUS_WORDS[topicStatus]} ${shared}` : STATUS_WORDS[topicStatus], atMs);
    }
  } else if (shared) {
    await zaismaPost(env, topic.id, "post", shared, atMs);
  }

  if (decision.answerPostId !== undefined) {
    // The answer is a post in the topic it was asked in.
    await env.DB.prepare(
      "UPDATE forum_topics SET answer_post_id = ?, topic_status = CASE WHEN ? IS NOT NULL THEN 'answered' WHEN topic_status = 'answered' THEN 'new' ELSE topic_status END, updated_at_ms = ? WHERE id = ?",
    )
      .bind(decision.answerPostId, decision.answerPostId, atMs, answerTopicId)
      .run();
  }

  if (decision.severity !== undefined || decision.category !== undefined) {
    await env.DB.prepare("UPDATE forum_topics SET severity = ?, category = ? WHERE id = ?")
      .bind(decision.severity ?? topic.severity, decision.category !== undefined ? decision.category.trim().slice(0, 40) : topic.category, topic.id)
      .run();
    if (decision.category !== undefined) await env.DB.prepare("DELETE FROM forum_misplaced_flags WHERE topic_id = ?").bind(topic.id).run();
  }
}
