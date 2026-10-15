import {
  CLOSED_TOPIC_STATUSES,
  DEBUG_CONTEXT_KEYS,
  FORUM_CATEGORIES,
  FORUM_LIMITS,
  FORUM_HIDING_REPORT_COUNT,
  FORUM_REPORT_REASONS,
  FORUM_SECTIONS,
  FORUM_TABS,
  FORUM_TAGS,
  OPEN_KNOWN_ISSUE_STATUSES,
  POST_SELECTIONS,
  TOPIC_KINDS,
  TOPIC_STATUSES,
  gameById,
  iso,
  newId,
  type AuthorKind,
  type DebugContext,
  type ForumPost,
  type ForumReportReason,
  type ForumTab,
  type ForumTopic,
  type PostSelection,
  type TopicKind,
  type TopicStatus,
} from "@zaisma/core";
import { ApiError, ownGame, readJson, type Caller } from "./developer.ts";
import type { Env } from "./env.ts";
import { affectedDeveloperCounts, decideTopic, hasNews, KNOWN_ISSUES, mediaOf, readPost, readTitle, remainingPostCount, storePost, topicById, uploadDraftMedia } from "./forum-posts.ts";
import { forumPeople, mentionsOf } from "./forum-mentions.ts";
import { searchTerms, searchTopics } from "./forum-search.ts";
import { hidePost } from "./forum-check.ts";
import { sendAlert } from "./email.ts";

/**
 * The developer forum (docs/DECISIONS.md). Topics are public; anything private is a message to Zaisma
 * (is_public: false), which only the developer and Zaisma see. Known issues are public topics of
 * Zaisma's own. The forum pages, the MCP and API callers all use these:
 *
 *   GET    /api/dev/forum?search_text=&section=&category=&kind=&tag=&tab=&topic_status=&is_answered=&cursor=&maximum_topic_count=&detail=brief
 *                                                              topics (tab: latest, top, unanswered, known, yours, messages); search_text ranks by relevance
 *   GET    /api/dev/forum/similar?search_text=                  topics and known issues like a title, while writing one
 *   POST   /api/dev/forum                                       a topic: { kind, title, text_markdown, category, tags?, debug_context?, author_kind?, images_base64? },
 *                                                              or with is_public: false (or known_issue_topic_id) a private message to Zaisma (game_slug?)
 *   GET    /api/dev/forum/:id?post_selection=all|answer|latest|none   a topic with its posts (or just the answer, the latest few, or none)
 *   POST   /api/dev/forum/:id/posts                             reply: { text_markdown, reply_to_post_id?, reopen?, debug_context?, author_kind?, images_base64? }
 *   POST   /api/dev/forum/:id/vote, DELETE to take it back     a vote (affects me too, I want this, same question)
 *   POST   /api/dev/forum/:id/follow, DELETE to stop
 *   POST   /api/dev/forum/:id/answer                            your question's answer: { answer_post_id } (null clears it)
 *   POST   /api/dev/forum/:id/misplaced                         it's in the wrong category: Zaisma's AI moves it
 *   POST   /api/dev/forum/:id/still-happening                   a known issue whose fix is out still happens: { text_markdown? }
 *   POST   /api/dev/forum/:id/posts/:post/helpful, DELETE       someone else's reply helped
 *   POST   /api/dev/forum/:id/posts/:post/report                it shouldn't be here: { reason, details? }
 *   POST   /api/dev/forum/media                                 upload an image (the bytes) to place in a post's text as ![image](/forum/media/ID)
 *   GET    /api/dev/forum/:id/media/:media                      an image in a post you can see
 *   GET    /api/dev/forum/people?name_prefix=&topic_id=         names to @mention: Zaisma, people in the topic, then anyone in the forum
 *
 * Others see a public post once it passes the check (forum-check.ts). What an AI attaches stays
 * private to whoever posted it and Zaisma. Reading needs no account on the pages; the API reads as
 * the caller.
 */

/** Who's reading: an account, or nobody signed in (the pages only). */
export type Viewer = Caller | null;

const PAGE_TOPIC_COUNT = 30;

export interface Person {
  name: string;
  /** developer: the developer wrote it; ai: their AI assistant; zaisma: the people who build Zaisma. */
  kind: AuthorKind;
  is_you: boolean;
}

export interface TopicRow {
  id: string;
  kind: TopicKind;
  title: string;
  category: string | null;
  tags: string[];
  topic_status: TopicStatus;
  is_public: boolean;
  /** Others can see it: public, and its first post passed the check. */
  is_shown: boolean;
  is_known_issue: boolean;
  author: Person;
  /** The latest few people in it, newest first, without the author. */
  recent_participants: Person[];
  /** Everyone in it besides the author, however many: recent_participants shows the latest few. */
  participant_count: number;
  reply_count: number;
  vote_count: number;
  has_voted: boolean;
  /** For a known issue: the developers it affects. */
  affected_developer_count: number | null;
  is_answered: boolean;
  /** The known issue your message was merged into (yours only). */
  merged_into_topic_id: string | null;
  /** Something new since you last opened it. */
  is_unread: boolean;
  created_at: string;
  last_activity_at: string;
  /** With a search: the words that matched, marked «like this». */
  search_match: string | null;
}

/** A topic in a few fields, for an AI scanning results: open one with get_topic for more. */
export interface BriefTopicRow {
  id: string;
  title: string;
  kind: TopicKind;
  topic_status: TopicStatus;
  is_known_issue: boolean;
  is_answered: boolean;
  vote_count: number;
  affected_developer_count: number | null;
  reply_count: number;
  category: string | null;
  search_match: string | null;
  is_unread: boolean;
  last_activity_at: string;
}

const brief = (topic: TopicRow): BriefTopicRow => ({
  id: topic.id,
  title: topic.title,
  kind: topic.kind,
  topic_status: topic.topic_status,
  is_known_issue: topic.is_known_issue,
  is_answered: topic.is_answered,
  vote_count: topic.vote_count,
  affected_developer_count: topic.affected_developer_count,
  reply_count: topic.reply_count,
  category: topic.category,
  search_match: topic.search_match,
  is_unread: topic.is_unread,
  last_activity_at: topic.last_activity_at,
});

export interface PostJson {
  id: string;
  author: Person;
  kind: ForumPost["kind"];
  text_markdown: string;
  reply_to_post: { id: string; author_name: string; excerpt: string } | null;
  is_answer: boolean;
  /** On a public topic: pending (being checked), passed (others see it) or held (waits for a person). null in a message to Zaisma. */
  check_status: ForumPost["check_status"];
  posted_via: ForumPost["posted_via"];
  helpful_count: number;
  has_marked_helpful: boolean;
  /** You reported it, and Zaisma hasn't looked yet. */
  has_reported: boolean;
  /** Only for whoever posted it (and Zaisma). */
  debug_context: DebugContext | null;
  /** Its images: public with the post, or private to you and Zaisma in a message. */
  media: { id: string; image_url: string }[];
  /** The people it @mentions, by name. */
  mentioned_names: string[];
  created_at: string;
}

export async function forumRoute(request: Request, env: Env, path: string, caller: Caller): Promise<[unknown, number?] | Response> {
  const method = request.method;
  const url = new URL(request.url);
  if (path === "/forum" && method === "GET") {
    const queryParameters = url.searchParams;
    closedQuery(queryParameters, ["search_text", "section", "category", "kind", "tag", "tab", "topic_status", "is_answered", "cursor", "maximum_topic_count", "detail"]);
    const list = await listTopics(env, caller, queryFrom(queryParameters));
    // detail=brief: a few fields per topic, so an AI scanning results spends few tokens.
    if (queryParameters.get("detail") === "brief") return [{ ...list, topics: list.topics.map(brief), pinned_topics: list.pinned_topics.map(brief) }];
    return [list];
  }
  if (path === "/forum/similar" && method === "GET") return [{ topics: await similarTopics(env, caller, url.searchParams.get("search_text") ?? "") }];
  if (path === "/forum/media" && method === "POST") {
    const bytes = new Uint8Array(await request.arrayBuffer());
    return [await uploadDraftMedia(env, caller, bytes), 201];
  }
  if (path === "/forum/people" && method === "GET") return [{ people: await forumPeople(env, url.searchParams.get("name_prefix") ?? "", url.searchParams.get("topic_id") || null, caller.accountId) }];
  const mediaPath = path.match(/^\/forum\/[a-z0-9]{1,40}\/media\/([a-z0-9]{1,40})$/);
  if (mediaPath && method === "GET") return serveMedia(env, caller, mediaPath[1]!);
  if (path === "/forum" && method === "POST") return [await createTopic(env, caller, await readJson(request, 72 * 1024 * 1024)), 201];
  const onPost = path.match(/^\/forum\/([a-z0-9]{1,40})\/posts\/([a-z0-9]{1,40})\/(helpful|report)$/);
  if (onPost) {
    const [, topicId, postId, action] = onPost as unknown as [string, string, string, string];
    if (action === "helpful" && (method === "POST" || method === "DELETE")) return [await markHelpful(env, caller, topicId, postId, method === "POST")];
    if (action === "report" && method === "POST") return [await reportPost(env, caller, topicId, postId, await readJson(request, 8192))];
    throw new ApiError(405, "bad_method", `${method} isn't used here.`);
  }
  const match = path.match(/^\/forum\/([a-z0-9]{1,40})(?:\/(posts|vote|follow|answer|misplaced|still-happening))?$/);
  if (!match) throw new ApiError(404, "not_found", "No such API path.");
  const [, id, action] = match as unknown as [string, string, string | undefined];
  if (!action && method === "GET") {
    closedQuery(url.searchParams, ["post_selection"]);
    return [await getTopic(env, caller, id, { postSelection: readPostSelection(url.searchParams.get("post_selection")) })];
  }
  if ((action === "vote" || action === "follow") && (method === "POST" || method === "DELETE")) {
    return [action === "vote" ? await vote(env, caller, id, method === "POST") : await follow(env, caller, id, method === "POST")];
  }
  if (method !== "POST" || !action) throw new ApiError(405, "bad_method", `${method} isn't used here.`);
  const body = await readJson(request, action === "posts" ? 72 * 1024 * 1024 : 16 * 1024);
  if (action === "posts") return [await replyTo(env, caller, id, body), 201];
  if (action === "answer") {
    closedBody(body, ["answer_post_id"]);
    if (body.answer_post_id !== null && typeof body.answer_post_id !== "string") throw new ApiError(400, "bad_answer", "answer_post_id is a post id in the topic, or null to clear the answer.");
    return [await markAnswer(env, caller, id, body.answer_post_id || null)];
  }
  if (action === "misplaced") return [await flagMisplaced(env, caller, id)];
  return [await stillHappening(env, caller, id, body)];
}

/** Inputs are closed: a field we don't take is an error, never quietly ignored (docs/NAMING.md). */
export function closedBody(body: Record<string, unknown>, fields: string[]): void {
  for (const key of Object.keys(body)) {
    if (!fields.includes(key)) throw new ApiError(400, "unknown_field", `${key} isn't a field here. The fields are: ${fields.join(", ")}.`);
  }
}

function closedQuery(queryParameters: URLSearchParams, fields: string[]): void {
  for (const key of queryParameters.keys()) {
    if (!fields.includes(key)) throw new ApiError(400, "unknown_field", `${key} isn't a query parameter here. The parameters are: ${fields.join(", ")}.`);
  }
}

function readPostSelection(given: string | null): PostSelection {
  if (given === null) return "all";
  if (!(POST_SELECTIONS as readonly string[]).includes(given)) throw new ApiError(400, "bad_post_selection", `post_selection is one of: ${POST_SELECTIONS.join(", ")}.`);
  return given as PostSelection;
}

export interface ForumQuery {
  searchText?: string;
  /** A section of the forum: every category in it. */
  section?: string;
  category?: string;
  kind?: string;
  tag?: string;
  tab?: string;
  /** A status or known-issue phase. */
  topicStatus?: string;
  /** Only questions with an answer (true), or without (false). */
  isAnswered?: boolean;
  /** Where to start: the cursor, or the page on the forum's pages. */
  startIndex?: number;
  maximumTopicCount?: number;
}

/** Where the next page starts, as an opaque cursor (docs/NAMING.md, rule 11). */
const cursorFor = (startIndex: number) => `cursor_${startIndex.toString(36)}`;
function readCursor(cursor: string | null): number {
  if (!cursor) return 0;
  if (!/^cursor_[0-9a-z]{1,6}$/.test(cursor)) throw new ApiError(400, "bad_cursor", "Pass the next_cursor from your last call as cursor, as it came.");
  return parseInt(cursor.slice(7), 36);
}

export function queryFrom(queryParameters: URLSearchParams): ForumQuery {
  const isAnswered = queryParameters.get("is_answered");
  if (isAnswered !== null && isAnswered !== "true" && isAnswered !== "false") throw new ApiError(400, "bad_is_answered", "is_answered is true or false.");
  const maximumTopicCount = queryParameters.get("maximum_topic_count");
  return {
    searchText: queryParameters.get("search_text") ?? "",
    section: queryParameters.get("section") ?? "",
    category: queryParameters.get("category") ?? "",
    kind: queryParameters.get("kind") ?? "",
    tag: queryParameters.get("tag") ?? "",
    tab: queryParameters.get("tab") ?? "",
    topicStatus: queryParameters.get("topic_status") ?? "",
    ...(isAnswered !== null ? { isAnswered: isAnswered === "true" } : {}),
    startIndex: readCursor(queryParameters.get("cursor")),
    ...(maximumTopicCount ? { maximumTopicCount: Number(maximumTopicCount) } : {}),
  };
}

/** The categories a query covers: one category, or every one in a section. */
export function categoriesOf(query: Pick<ForumQuery, "section" | "category">): string[] {
  if (query.category) return (FORUM_CATEGORIES as string[]).includes(query.category) ? [query.category] : [];
  const section = FORUM_SECTIONS.find((candidate) => candidate.id === query.section);
  return section ? Object.keys(section.categories) : [];
}

const like = (word: string) => `%${word.replace(/[\\%_]/g, (special) => `\\${special}`)}%`;

/**
 * Topics, a page at a time. Everyone sees public topics that passed their check; "yours" is the
 * caller's own topics, private ones included, and the ones they follow. Known issues for the
 * category come pinned on the first page of the latest topics.
 */
export async function listTopics(env: Env, viewer: Viewer, query: ForumQuery) {
  const tab: ForumTab = (FORUM_TABS as readonly string[]).includes(query.tab ?? "") ? (query.tab as ForumTab) : "latest";
  if ((tab === "yours" || tab === "messages") && !viewer) throw new ApiError(401, "signed_out", "Sign in to see your topics and messages.");
  const startIndex = Math.max(0, Math.min(30000, Math.floor(Number(query.startIndex) || 0)));
  const pageTopicCount = Math.max(1, Math.min(PAGE_TOPIC_COUNT, Math.floor(Number(query.maximumTopicCount) || PAGE_TOPIC_COUNT)));
  const where: string[] = [];
  const binds: unknown[] = [];
  if (tab === "yours") {
    where.push("topic.is_public = 1 AND (topic.account_id = ? OR topic.id IN (SELECT topic_id FROM forum_follows WHERE account_id = ?))");
    binds.push(viewer!.accountId, viewer!.accountId);
  } else if (tab === "messages") {
    where.push("topic.is_public = 0 AND topic.account_id = ?");
    binds.push(viewer!.accountId);
  } else where.push("topic.is_shown = 1 AND topic.merged_into_topic_id IS NULL");
  const categories = query.section || query.category ? categoriesOf(query) : [];
  if (categories.length) {
    where.push(`topic.category IN (${categories.map(() => "?").join(", ")})`);
    binds.push(...categories);
  }
  if (query.kind && (TOPIC_KINDS as readonly string[]).includes(query.kind)) {
    where.push("topic.kind = ?");
    binds.push(query.kind);
  }
  if (query.tag && query.tag in FORUM_TAGS) {
    where.push("topic.id IN (SELECT topic_id FROM forum_topic_tags WHERE tag = ?)");
    binds.push(query.tag);
  }
  if (tab === "unanswered") where.push("topic.kind = 'question' AND topic.answer_post_id IS NULL AND topic.topic_status NOT IN ('answered', 'fixed', 'wont') AND topic.known_issue_title IS NULL");
  if (tab === "known") where.push("topic.known_issue_title IS NOT NULL");
  if (query.topicStatus && (TOPIC_STATUSES as readonly string[]).includes(query.topicStatus)) {
    where.push("topic.topic_status = ?");
    binds.push(query.topicStatus);
  }
  if (query.isAnswered !== undefined) {
    where.push(query.isAnswered ? "(topic.answer_post_id IS NOT NULL OR topic.topic_status = 'answered')" : "topic.kind = 'question' AND topic.answer_post_id IS NULL AND topic.topic_status != 'answered'");
  }
  const searchText = (query.searchText ?? "").trim().slice(0, 200);
  // Open known issues are pinned above the latest topics, so they aren't listed again below them.
  const openStatuses = OPEN_KNOWN_ISSUE_STATUSES.map((status) => `'${status}'`).join(", ");
  const hasPins = tab === "latest" && !searchText && !query.tag && !query.topicStatus && query.isAnswered === undefined && (!query.kind || query.kind === "bug" || query.kind === "gap");
  if (hasPins) where.push(`NOT (topic.known_issue_title IS NOT NULL AND topic.topic_status IN (${openStatuses}))`);
  let rows: (ForumTopic & { search_match?: string })[];
  const terms = searchText ? searchTerms(searchText) : null;
  if (terms && tab !== "yours" && tab !== "messages") {
    // Ranked full-text search over what's public; all the words, or any of them when all finds nothing.
    rows = await searchTopics(env, terms.all, { where, binds }, pageTopicCount + 1, startIndex);
    if (!rows.length && startIndex === 0 && terms.any !== terms.all) rows = await searchTopics(env, terms.any, { where, binds }, pageTopicCount + 1, 0);
  } else {
    // Your own topics and messages: every word, in the title or a post.
    for (const word of searchText.split(/\s+/).filter((word) => word.length >= 2).slice(0, 6)) {
      where.push("(topic.title LIKE ? ESCAPE '\\' OR topic.known_issue_title LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM forum_posts post WHERE post.topic_id = topic.id AND post.text_markdown LIKE ? ESCAPE '\\'))");
      binds.push(like(word), like(word), like(word));
    }
    const order =
      tab === "top"
        ? "topic.vote_count DESC, topic.reply_count DESC, topic.last_activity_at_ms DESC"
        : tab === "known"
          ? `CASE topic.topic_status ${OPEN_KNOWN_ISSUE_STATUSES.map((status, i) => `WHEN '${status}' THEN ${i}`).join(" ")} ELSE 9 END, topic.last_activity_at_ms DESC`
          : "COALESCE(topic.last_activity_at_ms, topic.updated_at_ms) DESC";
    rows = (
      await env.DB.prepare(`SELECT topic.* FROM forum_topics topic WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ? OFFSET ?`)
        .bind(...binds, pageTopicCount + 1, startIndex)
        .all<ForumTopic>()
    ).results;
  }
  const hasMore = rows.length > pageTopicCount;
  const shown = rows.slice(0, pageTopicCount);
  // What matched, unless it's just the title again.
  const topics = (await rowsJson(env, viewer, shown)).map((topic, i) => {
    const searchMatch = shown[i]!.search_match;
    return searchMatch && searchMatch.replace(/[«»]/g, "") !== topic.title ? { ...topic, search_match: searchMatch } : topic;
  });
  // Known issues in the category, pinned above the latest topics.
  let pinnedTopics: TopicRow[] = [];
  if (hasPins && startIndex === 0) {
    const { results: known } = await env.DB.prepare(
      `SELECT * FROM forum_topics topic WHERE topic.is_shown = 1 AND topic.merged_into_topic_id IS NULL AND topic.known_issue_title IS NOT NULL AND topic.topic_status IN (${openStatuses})${categories.length ? ` AND topic.category IN (${categories.map(() => "?").join(", ")})` : ""} ORDER BY topic.vote_count DESC, topic.last_activity_at_ms DESC LIMIT 5`,
    )
      .bind(...categories)
      .all<ForumTopic>();
    pinnedTopics = await rowsJson(env, viewer, known);
  }
  return {
    topics,
    pinned_topics: pinnedTopics,
    tab,
    next_cursor: hasMore ? cursorFor(startIndex + pageTopicCount) : null,
    remaining_post_count: viewer ? await remainingPostCount(env, viewer) : null,
  };
}

/** Topics and known issues that look like the same thing, while a title is being written. */
export async function similarTopics(env: Env, viewer: Viewer, text: string): Promise<TopicRow[]> {
  const searchText = text.trim().slice(0, 500);
  if (searchText.length < 4) return [];
  const terms = searchTerms(searchText);
  if (!terms) return [];
  const found = await searchTopics(env, terms.any, { where: ["topic.is_shown = 1", "topic.merged_into_topic_id IS NULL"], binds: [] }, 5, 0);
  return rowsJson(env, viewer, found);
}

function personOf(accountId: string | null, authorKind: AuthorKind, names: Map<string, string>, viewer: Viewer): Person {
  if (authorKind === "zaisma") return { name: "Zaisma", kind: "zaisma", is_you: false };
  return { name: (accountId && names.get(accountId)) || "Deleted account", kind: authorKind, is_you: Boolean(viewer && accountId === viewer.accountId) };
}

async function namesOf(env: Env, accountIds: Iterable<string | null>): Promise<Map<string, string>> {
  const all = [...new Set([...accountIds].filter((accountId): accountId is string => Boolean(accountId)))];
  const names = new Map<string, string>();
  for (let i = 0; i < all.length; i += 90) {
    const chunk = all.slice(i, i + 90);
    const { results } = await env.DB.prepare(`SELECT id, name FROM accounts WHERE id IN (${chunk.map(() => "?").join(", ")})`).bind(...chunk).all<{ id: string; name: string }>();
    for (const account of results) names.set(account.id, account.name);
  }
  return names;
}

/** Topics as lists show them, with everything each row needs fetched in a few queries. */
async function rowsJson(env: Env, viewer: Viewer, rows: ForumTopic[]): Promise<TopicRow[]> {
  if (!rows.length) return [];
  const topicIds = rows.map((row) => row.id);
  const marks = topicIds.map(() => "?").join(", ");
  const viewerId = viewer?.accountId ?? "";
  const mergedIntoIds = [...new Set(rows.map((row) => row.merged_into_topic_id).filter((mergedId): mergedId is string => Boolean(mergedId)))];
  const [tags, posters, openers, votes, follows, affected, postCounts, knownIssues] = await Promise.all([
    env.DB.prepare(`SELECT topic_id, tag FROM forum_topic_tags WHERE topic_id IN (${marks})`).bind(...topicIds).all<{ topic_id: string; tag: string }>(),
    env.DB.prepare(
      `SELECT topic_id, account_id, author_kind, last_posted_at_ms, poster_count FROM (
         SELECT topic_id, account_id, author_kind, MAX(created_at_ms) AS last_posted_at_ms,
           ROW_NUMBER() OVER (PARTITION BY topic_id ORDER BY MAX(created_at_ms) DESC) AS place_number,
           COUNT(*) OVER (PARTITION BY topic_id) AS poster_count
         FROM forum_posts WHERE topic_id IN (${marks}) AND (check_status = 'passed' OR check_status IS NULL OR account_id = ?) GROUP BY topic_id, account_id, author_kind
       ) WHERE place_number <= 6 ORDER BY last_posted_at_ms DESC`,
    )
      .bind(...topicIds, viewerId)
      .all<{ topic_id: string; account_id: string | null; author_kind: AuthorKind; poster_count: number }>(),
    env.DB.prepare(
      `SELECT post.topic_id, post.author_kind FROM forum_posts post WHERE post.topic_id IN (${marks}) AND post.rowid = (SELECT earliest.rowid FROM forum_posts earliest WHERE earliest.topic_id = post.topic_id ORDER BY earliest.created_at_ms, earliest.rowid LIMIT 1)`,
    )
      .bind(...topicIds)
      .all<{ topic_id: string; author_kind: AuthorKind }>(),
    viewerId ? env.DB.prepare(`SELECT topic_id FROM forum_votes WHERE account_id = ? AND topic_id IN (${marks})`).bind(viewerId, ...topicIds).all<{ topic_id: string }>() : { results: [] },
    viewerId ? env.DB.prepare(`SELECT topic_id, seen_at_ms FROM forum_follows WHERE account_id = ? AND topic_id IN (${marks})`).bind(viewerId, ...topicIds).all<{ topic_id: string; seen_at_ms: number }>() : { results: [] },
    affectedDeveloperCounts(env, rows.filter((row) => row.known_issue_title).map((row) => row.id)),
    // A private message's replies aren't counted as it goes (only public ones are): count them here.
    rows.some((row) => !row.is_public)
      ? env.DB.prepare(`SELECT topic_id, COUNT(*) AS post_count FROM forum_posts WHERE topic_id IN (${marks}) GROUP BY topic_id`).bind(...topicIds).all<{ topic_id: string; post_count: number }>()
      : { results: [] as { topic_id: string; post_count: number }[] },
    // Only a merge into a known issue is shown: another developer's private message stays theirs.
    mergedIntoIds.length
      ? env.DB.prepare(`SELECT id FROM forum_topics WHERE known_issue_title IS NOT NULL AND id IN (${mergedIntoIds.map(() => "?").join(", ")})`).bind(...mergedIntoIds).all<{ id: string }>()
      : { results: [] as { id: string }[] },
  ]);
  const knownIssueIds = new Set(knownIssues.results.map((knownIssue) => knownIssue.id));
  const names = await namesOf(env, [...rows.map((row) => row.account_id), ...posters.results.map((poster) => poster.account_id)]);
  const voted = new Set(votes.results.map((voteRow) => voteRow.topic_id));
  const seenAtMs = new Map(follows.results.map((followRow) => [followRow.topic_id, followRow.seen_at_ms]));
  return rows.map((topic) => {
    const openerKind = openers.results.find((opener) => opener.topic_id === topic.id)?.author_kind ?? (topic.account_id ? "developer" : "zaisma");
    const author = personOf(topic.account_id, topic.account_id ? openerKind : "zaisma", names, viewer);
    const topicPosters = posters.results.filter((poster) => poster.topic_id === topic.id);
    const isAuthor = (poster: { account_id: string | null; author_kind: AuthorKind }) => Boolean(topic.account_id && poster.account_id === topic.account_id && poster.author_kind === openerKind);
    const recentParticipants = topicPosters
      .filter((poster) => !isAuthor(poster))
      .slice(0, 4)
      .map((poster) => personOf(poster.account_id, poster.author_kind, names, viewer));
    // Everyone who posted, less the author (whose opening post is always there).
    const participantCount = Math.max(recentParticipants.length, (topicPosters[0]?.poster_count ?? 0) - (topic.account_id ? 1 : 0));
    const lastActivityAtMs = topic.last_activity_at_ms ?? topic.updated_at_ms;
    const lastSeenAtMs = seenAtMs.get(topic.id);
    const isOwn = Boolean(viewer && topic.account_id === viewer.accountId);
    return {
      id: topic.id,
      kind: topic.kind,
      title: topic.known_issue_title ?? topic.title,
      category: topic.category || null,
      tags: tags.results.filter((tag) => tag.topic_id === topic.id).map((tag) => tag.tag),
      topic_status: topic.topic_status,
      is_public: topic.is_public === 1,
      is_shown: topic.is_shown === 1,
      is_known_issue: Boolean(topic.known_issue_title),
      author,
      recent_participants: recentParticipants,
      participant_count: participantCount,
      reply_count: topic.is_public ? topic.reply_count : Math.max(0, (postCounts.results.find((postCountRow) => postCountRow.topic_id === topic.id)?.post_count ?? 1) - 1),
      vote_count: topic.vote_count,
      has_voted: voted.has(topic.id),
      affected_developer_count: topic.known_issue_title ? (affected.get(topic.id) ?? 0) : null,
      is_answered: Boolean(topic.answer_post_id) || topic.topic_status === "answered",
      merged_into_topic_id: isOwn && topic.merged_into_topic_id && knownIssueIds.has(topic.merged_into_topic_id) ? topic.merged_into_topic_id : null,
      is_unread: (lastSeenAtMs !== undefined && lastActivityAtMs > lastSeenAtMs) || (isOwn && hasNews(topic)),
      created_at: iso(topic.created_at_ms)!,
      last_activity_at: iso(lastActivityAtMs)!,
      search_match: null,
    };
  });
}

/** Whether the viewer may read the topic: it's public and checked, or it's theirs. */
function canRead(topic: ForumTopic, viewer: Viewer): boolean {
  return topic.is_shown === 1 || Boolean(viewer && topic.account_id === viewer.accountId);
}

async function readable(env: Env, viewer: Viewer, topicId: string): Promise<ForumTopic> {
  const topic = await topicById(env, topicId);
  if (!topic || !canRead(topic, viewer)) throw new ApiError(404, "no_topic", "There's no topic with that id you can see. GET /forum lists them.");
  return topic;
}

/** A post others can see, or the viewer's own (still being checked, or held). */
function canSeePost(topic: ForumTopic, post: ForumPost, viewer: Viewer): boolean {
  if (post.check_status === "passed" || post.author_kind === "zaisma") return true;
  if (viewer && post.account_id === viewer.accountId) return true;
  // A private topic's posts, for its developer.
  return post.check_status === null && Boolean(viewer && topic.account_id === viewer.accountId);
}

/** What an AI attached, with every key there, as an answer gives it. */
export function debugContextOf(stored: string | null): DebugContext | null {
  if (!stored) return null;
  const parsed = JSON.parse(stored) as Partial<DebugContext>;
  return Object.fromEntries(DEBUG_CONTEXT_KEYS.map((key) => [key, typeof parsed[key] === "string" ? parsed[key] : null])) as unknown as DebugContext;
}

/** A topic with its posts. Opening it counts as having seen what's in it. */
export async function getTopic(env: Env, viewer: Viewer, topicId: string, options: { postSelection?: PostSelection } = {}) {
  const topic = await readable(env, viewer, topicId);
  const { results: all } = await env.DB.prepare("SELECT * FROM forum_posts WHERE topic_id = ? ORDER BY created_at_ms, rowid LIMIT 1000").bind(topic.id).all<ForumPost>();
  const visible = all.filter((post) => canSeePost(topic, post, viewer));
  // To save an AI's tokens: answer is the opening post and the marked answer; latest is the opening
  // post and the last five; none is the topic alone (a known issue's phase and workaround).
  const opening = topic.account_id ? visible.slice(0, 1) : [];
  const postSelection = options.postSelection ?? "all";
  const posts =
    postSelection === "none"
      ? []
      : postSelection === "answer"
        ? [...opening, ...visible.filter((post) => post.id === topic.answer_post_id && !opening.includes(post))]
        : postSelection === "latest"
          ? [...opening, ...visible.slice(-5).filter((post) => !opening.includes(post))]
          : visible;
  const names = await namesOf(env, posts.map((post) => post.account_id));
  const postsById = new Map(posts.map((post) => [post.id, post]));
  const [media, mentions] = await Promise.all([mediaOf(env, posts.map((post) => post.id)), mentionsOf(env, posts.map((post) => post.id))]);
  const [row] = await rowsJson(env, viewer, [topic]);
  const isOwn = Boolean(viewer && topic.account_id === viewer.accountId);
  const mergedInto = row!.merged_into_topic_id ? await topicById(env, row!.merged_into_topic_id) : null;
  const game = isOwn && topic.game_id ? await gameById(env.DB, topic.game_id) : null;
  // Your own private message about a known issue.
  const yourMessage = viewer && topic.known_issue_title ? await env.DB.prepare("SELECT id FROM forum_topics WHERE merged_into_topic_id = ? AND account_id = ? ORDER BY created_at_ms LIMIT 1").bind(topic.id, viewer.accountId).first<{ id: string }>() : null;
  const following = viewer ? await env.DB.prepare("SELECT seen_at_ms FROM forum_follows WHERE topic_id = ? AND account_id = ?").bind(topic.id, viewer.accountId).first<{ seen_at_ms: number }>() : null;
  const flagged = viewer ? await env.DB.prepare("SELECT 1 AS is_flagged FROM forum_misplaced_flags WHERE topic_id = ? AND account_id = ?").bind(topic.id, viewer.accountId).first() : null;
  const [markedHelpful, reported]: [Set<string>, Set<string>] = viewer
    ? await Promise.all([
        env.DB.prepare("SELECT post_id FROM forum_helpful_marks WHERE account_id = ? AND post_id IN (SELECT id FROM forum_posts WHERE topic_id = ?)").bind(viewer.accountId, topic.id).all<{ post_id: string }>(),
        env.DB.prepare("SELECT post_id FROM forum_reports WHERE account_id = ? AND post_id IN (SELECT id FROM forum_posts WHERE topic_id = ?)").bind(viewer.accountId, topic.id).all<{ post_id: string }>(),
      ]).then(([helpfulRows, reportRows]) => [new Set(helpfulRows.results.map((mark) => mark.post_id)), new Set(reportRows.results.map((report) => report.post_id))] as [Set<string>, Set<string>])
    : [new Set<string>(), new Set<string>()];
  if (viewer) {
    const nowMs = Date.now();
    if (following) await env.DB.prepare("UPDATE forum_follows SET seen_at_ms = ? WHERE topic_id = ? AND account_id = ?").bind(nowMs, topic.id, viewer.accountId).run();
    if (isOwn && hasNews(topic)) await env.DB.prepare("UPDATE forum_topics SET seen_at_ms = ? WHERE id = ?").bind(nowMs, topic.id).run();
  }
  return {
    topic: {
      ...row!,
      is_unread: false,
      workaround: topic.workaround,
      roadmap_item: topic.roadmap_item,
      game_slug: game ? game.slug : null,
      merged_into_topic: mergedInto ? { id: mergedInto.id, title: mergedInto.known_issue_title ?? mergedInto.title, topic_status: mergedInto.topic_status, workaround: mergedInto.workaround } : null,
      your_message_topic_id: yourMessage?.id ?? null,
      is_following: Boolean(following),
      // You flagged it as in the wrong category, and Zaisma hasn't looked yet.
      has_flagged_misplaced: Boolean(flagged),
      can_reply: Boolean(viewer),
      can_vote: Boolean(viewer && topic.is_public && !isOwn && topic.kind !== "talk"),
      can_flag_misplaced: Boolean(viewer && topic.is_shown && !topic.merged_into_topic_id),
      can_mark_answer: isOwn && topic.kind === "question",
      can_reopen: isOwn && CLOSED_TOPIC_STATUSES.includes(topic.topic_status),
    },
    posts: posts.map((post) => {
      const isMine = Boolean(viewer && post.account_id === viewer.accountId && post.author_kind !== "zaisma");
      const repliedTo = post.reply_to_post_id ? postsById.get(post.reply_to_post_id) : undefined;
      return {
        id: post.id,
        author: personOf(post.account_id, post.author_kind, names, viewer),
        kind: post.kind,
        text_markdown: post.text_markdown,
        reply_to_post: repliedTo ? { id: repliedTo.id, author_name: personOf(repliedTo.account_id, repliedTo.author_kind, names, viewer).name, excerpt: repliedTo.text_markdown.slice(0, 140) } : null,
        is_answer: topic.answer_post_id === post.id,
        check_status: post.check_status,
        posted_via: post.posted_via,
        helpful_count: post.helpful_count,
        has_marked_helpful: markedHelpful.has(post.id),
        has_reported: reported.has(post.id),
        debug_context: isMine ? debugContextOf(post.debug_context) : null,
        media: (media.get(post.id) ?? []).map((image) => ({ id: image.id, image_url: `${env.SITE_ORIGIN}/api/dev/forum/${topic.id}/media/${image.id}` })),
        mentioned_names: mentions.get(post.id) ?? [],
        created_at: iso(post.created_at_ms)!,
      } satisfies PostJson;
    }),
    // How many posts you can see in all, whichever were sent.
    post_count: visible.length,
    remaining_post_count: viewer ? await remainingPostCount(env, viewer) : null,
  };
}

function readTags(body: Record<string, unknown>): string[] {
  if (body.tags === undefined || body.tags === null) return [];
  const tags = Array.isArray(body.tags) ? [...new Set(body.tags.map(String))] : null;
  if (!tags || tags.length > FORUM_LIMITS.tagCountPerTopic || tags.some((tag) => !(tag in FORUM_TAGS))) {
    throw new ApiError(400, "bad_tags", `tags: up to ${FORUM_LIMITS.tagCountPerTopic} of ${Object.keys(FORUM_TAGS).join(", ")}.`);
  }
  return tags;
}

/** What it says while a post waits for its check, or null once others can see it. */
const checkNote = (checkStatus: ForumPost["check_status"]) =>
  checkStatus === "pending" ? "Others see it once it's checked, usually within minutes." : checkStatus === "held" ? "A person at Zaisma checks it before others see it, usually within a day." : null;

const POST_FIELDS = ["text_markdown", "debug_context", "author_kind", "images_base64"];

/**
 * A new topic: public, or with is_public: false (or a known_issue_topic_id) a private message to
 * Zaisma. Answers with topics and known issues that look like the same thing.
 */
export async function createTopic(env: Env, caller: Caller, body: Record<string, unknown>) {
  closedBody(body, ["kind", "title", "category", "tags", "is_public", "game_slug", "known_issue_topic_id", ...POST_FIELDS]);
  const kind = body.kind as TopicKind;
  if (!TOPIC_KINDS.includes(kind)) throw new ApiError(400, "bad_kind", `kind is one of: ${TOPIC_KINDS.join(", ")}.`);
  const title = readTitle(body);
  // Whoever posts picks the category; Zaisma only moves a topic someone flags as misplaced.
  const category = typeof body.category === "string" ? body.category : "";
  if (category && !(FORUM_CATEGORIES as string[]).includes(category)) throw new ApiError(400, "bad_category", `category is one of: ${FORUM_CATEGORIES.join(", ")}.`);
  const tags = readTags(body);
  if (body.is_public !== undefined && typeof body.is_public !== "boolean") throw new ApiError(400, "bad_is_public", "is_public is true (a public topic, the default) or false (a private message to Zaisma).");
  let knownIssue: ForumTopic | null = null;
  if (typeof body.known_issue_topic_id === "string" && body.known_issue_topic_id) {
    knownIssue = await topicById(env, body.known_issue_topic_id);
    if (!knownIssue?.known_issue_title || !knownIssue.is_shown) throw new ApiError(404, "no_known_issue", "There's no known issue with that id. GET /forum?tab=known lists them.");
  }
  // Every forum topic is public; is_public: false (or a known issue) makes it a private message to Zaisma instead.
  const isPublic = knownIssue ? false : body.is_public !== false;
  if (!category && isPublic) throw new ApiError(400, "no_category", `Pick a category: one of ${FORUM_CATEGORIES.join(", ")} (other for anything else).`);
  const game = typeof body.game_slug === "string" && body.game_slug ? await ownGame(env, body.game_slug, caller) : null;
  const post = await readPost(env, caller, body);
  const id = newId();
  const nowMs = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO forum_topics (id, account_id, kind, title, game_id, topic_status, merged_into_topic_id, category, is_public, created_at_ms, updated_at_ms, last_activity_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      id,
      caller.accountId,
      kind,
      title,
      game?.id ?? null,
      knownIssue && OPEN_KNOWN_ISSUE_STATUSES.includes(knownIssue.topic_status) ? knownIssue.topic_status : "new",
      knownIssue?.id ?? null,
      category || knownIssue?.category || "",
      isPublic ? 1 : 0,
      nowMs,
      nowMs,
      nowMs,
    ),
    ...tags.map((tag) => env.DB.prepare("INSERT INTO forum_topic_tags (topic_id, tag) VALUES (?, ?)").bind(id, tag)),
  ]);
  const stored = await storePost(env, (await topicById(env, id))!, caller, post, "post");
  const similar = knownIssue ? [] : (await similarTopics(env, caller, `${title} ${post.textMarkdown}`)).filter((topic) => topic.id !== id);
  return {
    ...(await getTopic(env, caller, id)),
    // Topics and known issues that look like the same thing: if one is, vote there or reply.
    similar_topics: similar,
    check_note: checkNote(stored.checkStatus),
    removed_secret_count: post.blankedCount,
  };
}

/** A reply to the topic, or to one post in it (reply_to_post_id). reopen: true reopens your own closed topic. */
export async function replyTo(env: Env, caller: Caller, topicId: string, body: Record<string, unknown>) {
  closedBody(body, ["reply_to_post_id", "reopen", ...POST_FIELDS]);
  const topic = await readable(env, caller, topicId);
  if (body.reopen !== undefined && typeof body.reopen !== "boolean") throw new ApiError(400, "bad_reopen", "reopen is true or false.");
  const reopen = body.reopen === true;
  if (reopen && topic.account_id !== caller.accountId) throw new ApiError(403, "not_yours", "Only the developer who posted a topic can reopen it. Reply, or vote.");
  if (reopen && !CLOSED_TOPIC_STATUSES.includes(topic.topic_status)) throw new ApiError(400, "not_closed", `It's ${topic.topic_status}, not closed, so there's nothing to reopen. Just reply.`);
  let replyToPostId: string | null = null;
  if (typeof body.reply_to_post_id === "string" && body.reply_to_post_id) {
    const repliedTo = await env.DB.prepare("SELECT * FROM forum_posts WHERE id = ? AND topic_id = ?").bind(body.reply_to_post_id, topic.id).first<ForumPost>();
    if (!repliedTo || !canSeePost(topic, repliedTo, caller)) throw new ApiError(404, "no_post", "reply_to_post_id is a post in this topic, from get_topic.");
    replyToPostId = repliedTo.id;
  }
  const post = await readPost(env, caller, body);
  const stored = await storePost(env, topic, caller, post, reopen ? "reopen" : "post", replyToPostId);
  await env.DB.prepare(`UPDATE forum_topics SET updated_at_ms = ?${reopen ? ", topic_status = 'new'" : ""} WHERE id = ?`).bind(Date.now(), topic.id).run();
  const { posts } = await getTopic(env, caller, topic.id);
  const reply = posts.find((candidate) => candidate.id === stored.id);
  if (!reply) throw new Error(`The reply ${stored.id} isn't in its topic.`);
  return { post: reply, check_note: checkNote(stored.checkStatus), removed_secret_count: post.blankedCount };
}

/** A vote on someone else's public topic: it affects you too, you want it, or you have the question too. You follow it. */
export async function vote(env: Env, caller: Caller, topicId: string, isVoting: boolean) {
  const topic = await readable(env, caller, topicId);
  if (!topic.is_public || topic.account_id === caller.accountId) throw new ApiError(400, "cant_vote", "Votes are for public topics someone else started.");
  if (topic.kind === "talk") throw new ApiError(400, "cant_vote", "Discussions take replies, not votes.");
  const nowMs = Date.now();
  const change = isVoting
    ? await env.DB.prepare("INSERT OR IGNORE INTO forum_votes (topic_id, account_id, created_at_ms) VALUES (?, ?, ?)").bind(topic.id, caller.accountId, nowMs).run()
    : await env.DB.prepare("DELETE FROM forum_votes WHERE topic_id = ? AND account_id = ?").bind(topic.id, caller.accountId).run();
  if (change.meta.changes) await env.DB.prepare(`UPDATE forum_topics SET vote_count = MAX(0, vote_count ${isVoting ? "+" : "-"} 1) WHERE id = ?`).bind(topic.id).run();
  if (isVoting) await env.DB.prepare("INSERT OR IGNORE INTO forum_follows (topic_id, account_id, seen_at_ms) VALUES (?, ?, ?)").bind(topic.id, caller.accountId, nowMs).run();
  const row = await env.DB.prepare("SELECT vote_count FROM forum_topics WHERE id = ?").bind(topic.id).first<{ vote_count: number }>();
  return { vote_count: row?.vote_count ?? 0, has_voted: isVoting };
}

/** It's in the wrong category: Zaisma's AI looks at where it belongs on its next run and moves it, saying so in the topic. */
export async function flagMisplaced(env: Env, caller: Caller, topicId: string) {
  const topic = await readable(env, caller, topicId);
  if (!topic.is_shown || topic.merged_into_topic_id) throw new ApiError(400, "cant_flag", "Only public topics others can see can be flagged as misplaced.");
  await env.DB.prepare("INSERT OR IGNORE INTO forum_misplaced_flags (topic_id, account_id, created_at_ms) VALUES (?, ?, ?)").bind(topic.id, caller.accountId, Date.now()).run();
  return { has_flagged_misplaced: true };
}

/**
 * A known issue whose fix is out (released) still happens: it goes back to fixing, everyone in it
 * hears, and Zaisma gets an alert. Once per fix, however many say so; with text, it's also a reply.
 */
export async function stillHappening(env: Env, caller: Caller, topicId: string, body: Record<string, unknown>) {
  closedBody(body, ["text_markdown"]);
  const topic = await readable(env, caller, topicId);
  if (!topic.known_issue_title || topic.topic_status !== "released") {
    throw new ApiError(400, "not_released", "Only a known issue whose fix is out (released) can be reported as still happening. Reply, or message Zaisma.");
  }
  const reply = typeof body.text_markdown === "string" && body.text_markdown.trim() ? await replyTo(env, caller, topic.id, { text_markdown: body.text_markdown }) : null;
  await decideTopic(env, topic.id, { topicStatus: "fixing", reply: "A developer says it still happens after the fix, so Zaisma is working on it again." });
  await sendAlert(env, `Still happening after the fix: ${topic.known_issue_title}`, `A developer says the known issue still happens after its fix was released. It's back to fixing.\n\nOpen: ${env.SITE_ORIGIN}/admin/feedback/${topic.id}`);
  return { topic_status: "fixing" as const, post: reply?.post ?? null };
}

async function visiblePost(env: Env, caller: Caller, topicId: string, postId: string): Promise<ForumPost> {
  const topic = await readable(env, caller, topicId);
  const post = await env.DB.prepare("SELECT * FROM forum_posts WHERE id = ? AND topic_id = ?").bind(postId, topic.id).first<ForumPost>();
  if (!post || post.check_status !== "passed") throw new ApiError(404, "no_post", "There's no post with that id others can see in this topic.");
  return post;
}

/** Someone else's reply helped: it shows how many found it helpful. No dislikes: a wrong reply gets a better one, a harmful one a report. */
export async function markHelpful(env: Env, caller: Caller, topicId: string, postId: string, isMarking: boolean) {
  const post = await visiblePost(env, caller, topicId, postId);
  if (post.account_id === caller.accountId && post.author_kind !== "zaisma") throw new ApiError(400, "cant_mark", "Helpful is for other people's posts.");
  const change = isMarking
    ? await env.DB.prepare("INSERT OR IGNORE INTO forum_helpful_marks (post_id, account_id, created_at_ms) VALUES (?, ?, ?)").bind(post.id, caller.accountId, Date.now()).run()
    : await env.DB.prepare("DELETE FROM forum_helpful_marks WHERE post_id = ? AND account_id = ?").bind(post.id, caller.accountId).run();
  if (change.meta.changes) await env.DB.prepare(`UPDATE forum_posts SET helpful_count = MAX(0, helpful_count ${isMarking ? "+" : "-"} 1) WHERE id = ?`).bind(post.id).run();
  const row = await env.DB.prepare("SELECT helpful_count FROM forum_posts WHERE id = ?").bind(post.id).first<{ helpful_count: number }>();
  return { helpful_count: row?.helpful_count ?? 0, has_marked_helpful: isMarking };
}

/**
 * A post that shouldn't be here. A person at Zaisma looks; it's hidden at once when it puts a young
 * person at risk (and Zaisma is alerted), or once FORUM_HIDING_REPORT_COUNT developers have reported it.
 */
export async function reportPost(env: Env, caller: Caller, topicId: string, postId: string, body: Record<string, unknown>) {
  closedBody(body, ["reason", "details"]);
  const post = await visiblePost(env, caller, topicId, postId);
  const reason = String(body.reason ?? "") as ForumReportReason;
  if (!(reason in FORUM_REPORT_REASONS)) throw new ApiError(400, "bad_reason", `reason is one of: ${Object.keys(FORUM_REPORT_REASONS).join(", ")}.`);
  if (post.author_kind === "zaisma") throw new ApiError(400, "cant_report", "Zaisma's own posts can't be reported here. Message Zaisma instead.");
  if (post.account_id === caller.accountId) throw new ApiError(400, "cant_report", "That's your own post.");
  const details = typeof body.details === "string" ? body.details.trim().slice(0, 1000) : "";
  await env.DB.prepare("INSERT OR REPLACE INTO forum_reports (post_id, account_id, reason, details, created_at_ms) VALUES (?, ?, ?, ?, ?)").bind(post.id, caller.accountId, reason, details || null, Date.now()).run();
  const reportCount = (await env.DB.prepare("SELECT COUNT(*) AS report_count FROM forum_reports WHERE post_id = ?").bind(post.id).first<{ report_count: number }>())?.report_count ?? 0;
  const isHidden = reason === "child_safety" || reportCount >= FORUM_HIDING_REPORT_COUNT;
  if (isHidden) await hidePost(env, post.id, `Reported: ${FORUM_REPORT_REASONS[reason]}${reportCount > 1 ? ` (${reportCount} reports)` : ""}`);
  if (reason === "child_safety") {
    await sendAlert(env, "Forum post reported: puts a young person at risk", `A forum post was reported as putting a young person at risk. It's hidden until you look.\n\nOpen: ${env.SITE_ORIGIN}/admin/feedback/${post.topic_id}`);
  }
  return { has_reported: true, is_hidden: isHidden };
}

/** Follow a topic to hear about what's new in it (yours, ones you replied to and voted on are followed already). */
export async function follow(env: Env, caller: Caller, topicId: string, isFollowing: boolean) {
  const topic = await readable(env, caller, topicId);
  if (isFollowing) await env.DB.prepare("INSERT OR IGNORE INTO forum_follows (topic_id, account_id, seen_at_ms) VALUES (?, ?, ?)").bind(topic.id, caller.accountId, Date.now()).run();
  else await env.DB.prepare("DELETE FROM forum_follows WHERE topic_id = ? AND account_id = ?").bind(topic.id, caller.accountId).run();
  return { is_following: isFollowing };
}

/** The developer who asked marks the reply that answered their question (null clears it). */
export async function markAnswer(env: Env, caller: Caller, topicId: string, postId: string | null) {
  const topic = await readable(env, caller, topicId);
  if (topic.account_id !== caller.accountId || topic.kind !== "question") throw new ApiError(403, "not_yours", "Only the developer who asked a question marks its answer.");
  if (postId) {
    const post = await env.DB.prepare("SELECT * FROM forum_posts WHERE id = ? AND topic_id = ?").bind(postId, topic.id).first<ForumPost>();
    if (!post || post.check_status !== "passed") throw new ApiError(404, "no_post", "answer_post_id is a reply in this topic that others can see.");
  }
  await env.DB.prepare(
    "UPDATE forum_topics SET answer_post_id = ?, topic_status = CASE WHEN ? IS NOT NULL THEN 'answered' WHEN topic_status = 'answered' THEN 'new' ELSE topic_status END, updated_at_ms = ? WHERE id = ?",
  )
    .bind(postId, postId, Date.now(), topic.id)
    .run();
  return { answer_post_id: postId };
}

/**
 * An image in a post. Anyone who can see the post can see it: on a public topic once the post
 * passed its check, in a message only the developer (and Zaisma, on the admin pages).
 */
export async function serveMedia(env: Env, viewer: Viewer, mediaId: string): Promise<Response> {
  const image = await env.DB.prepare(
    "SELECT media.id, media.content_type, media.storage_key, media.post_id, media.account_id AS uploader_id, post.check_status, post.account_id AS poster_id, topic.is_shown, topic.account_id AS owner_id FROM forum_media media LEFT JOIN forum_posts post ON post.id = media.post_id LEFT JOIN forum_topics topic ON topic.id = post.topic_id WHERE media.id = ?",
  )
    .bind(mediaId)
    .first<{ id: string; content_type: string; storage_key: string; post_id: string | null; uploader_id: string | null; check_status: string | null; poster_id: string | null; is_shown: number; owner_id: string | null }>();
  const isOpen = Boolean(image?.post_id && image.check_status === "passed" && image.is_shown);
  // Not posted yet: its uploader's alone.
  const isOwn = Boolean(
    image && viewer && (image.post_id ? image.poster_id === viewer.accountId || (image.check_status === null && image.owner_id === viewer.accountId) : image.uploader_id === viewer.accountId),
  );
  const object = image && (isOpen || isOwn) ? await env.GAMES.get(image.storage_key) : null;
  if (!image || !object) throw new ApiError(404, "no_media", "There's no image there you can see.");
  return new Response(object.body, {
    headers: {
      "Content-Type": image.content_type,
      // Public images are cached briefly, so one taken down stops showing soon after.
      "Cache-Control": isOpen ? "public, max-age=300" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

/** How many topics the caller follows have something new since they last opened them. */
export async function unreadCount(env: Env, caller: Caller, isMessages = false): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS topic_count FROM forum_follows followed JOIN forum_topics topic ON topic.id = followed.topic_id WHERE followed.account_id = ? AND topic.is_public = ${isMessages ? 0 : 1} AND COALESCE(topic.last_activity_at_ms, topic.updated_at_ms) > followed.seen_at_ms`,
  )
    .bind(caller.accountId)
    .first<{ topic_count: number }>();
  return row?.topic_count ?? 0;
}

/** For the pages: the known issues, newest first (the picker on a private message). */
export async function knownIssueTitles(env: Env): Promise<{ id: string; title: string }[]> {
  const { results } = await env.DB.prepare(`${KNOWN_ISSUES} AND is_shown = 1 ORDER BY last_activity_at_ms DESC LIMIT 200`).all<ForumTopic>();
  return results.map((knownIssue) => ({ id: knownIssue.id, title: knownIssue.known_issue_title! }));
}
