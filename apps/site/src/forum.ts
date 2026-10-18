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
  ApiError,
  checkIdKind,
  gameById,
  iso,
  newId,
  secondsUntilDayPasses,
  type AuthorKind,
  type DebugContext,
  type ForumPost,
  type ForumReportReason,
  type ForumTab,
  type ForumTopic,
  type PostSelection,
  type TopicKind,
  type TopicStatus,
  type ErrorCode,
} from "@zaisma/core";
import { closedBody, ownGame, type Caller, type CheckedCall, type NextStep } from "./developer.ts";
import type { Env } from "./env.ts";
import { affectedDeveloperCounts, decideTopic, hasNews, KNOWN_ISSUES, mediaOf, readPost, readTitle, remainingPostCount, storePost, topicAddress, topicById, turnOffKeysIn, uploadDraftMedia } from "./forum-posts.ts";
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

/** Forum changes: nothing usually follows them, and replies show as unread (search_forum, tab yours). */
const NO_NEXT_STEPS: NextStep[] = [];

/**
 * The forum's calls, once the router (developer.ts, checkCall) has checked the key, that the path's
 * topic is one the caller can see, and that the query and body hold only the call's inputs.
 * apiPath is the call's path in API_ROUTES, like /forum/:topic_id/vote.
 */
export async function forumRoute(request: Request, env: Env, apiPath: string, caller: Caller, checked: CheckedCall): Promise<[unknown, number?] | Response> {
  const method = request.method;
  const { body, query: queryParameters, pathValues } = checked;
  const topicId = pathValues.topic_id ?? "";
  if (apiPath === "/forum" && method === "GET") {
    const list = await listTopics(env, caller, queryFrom(queryParameters));
    // detail=brief: a few fields per topic, so an AI scanning results spends few tokens.
    if (queryParameters.get("detail") === "brief") return [{ ...list, topics: list.topics.map(brief), pinned_topics: list.pinned_topics.map(brief) }];
    return [list];
  }
  if (apiPath === "/forum/similar") return [{ topics: await similarTopics(env, caller, queryParameters.get("search_text") ?? "") }];
  if (apiPath === "/forum/media") {
    const bytes = new Uint8Array(await request.arrayBuffer());
    return [await uploadDraftMedia(env, caller, bytes), 201];
  }
  if (apiPath === "/forum/people") return [{ people: await forumPeople(env, queryParameters.get("name_prefix") ?? "", queryParameters.get("topic_id") || null, caller.accountId) }];
  if (apiPath === "/forum/:topic_id/media/:media_id") return serveMedia(env, caller, pathValues.media_id!);
  if (apiPath === "/forum" && method === "POST") return [await createTopic(env, caller, body), 201];
  if (apiPath === "/forum/:topic_id/posts/:post_id/helpful") return [await markHelpful(env, caller, topicId, pathValues.post_id!, method === "POST")];
  if (apiPath === "/forum/:topic_id/posts/:post_id/report") return [await reportPost(env, caller, topicId, pathValues.post_id!, body)];
  if (apiPath === "/forum/:topic_id") return [await getTopic(env, caller, topicId, { postSelection: readPostSelection(queryParameters.get("post_selection")) })];
  if (apiPath === "/forum/:topic_id/vote") return [await vote(env, caller, topicId, method === "POST")];
  if (apiPath === "/forum/:topic_id/follow") return [await follow(env, caller, topicId, method === "POST")];
  if (apiPath === "/forum/:topic_id/posts") return [await replyTo(env, caller, topicId, body), 201];
  if (apiPath === "/forum/:topic_id/answer") {
    if (body.answer_post_id !== null && typeof body.answer_post_id !== "string") {
      throw new ApiError("bad_answer_post_id", { message: "answer_post_id isn't a post ID or null.", field: "answer_post_id", fix: "Give the ID of the reply that answered it, from get_topic, or null to clear the answer." });
    }
    return [await markAnswer(env, caller, topicId, body.answer_post_id || null)];
  }
  if (apiPath === "/forum/:topic_id/misplaced") return [await flagMisplaced(env, caller, topicId)];
  if (apiPath === "/forum/:topic_id/still-happening") return [await stillHappening(env, caller, topicId, body)];
  throw new Error(`The forum has no code for ${method} ${apiPath}, which API_ROUTES lists.`);
}

/** A value from a fixed list, or the error answer that names the list. */
function oneOf(field: string, given: string, allowed: readonly string[], fix?: string): void {
  if (given && !allowed.includes(given)) {
    throw new ApiError(`bad_${field}` as ErrorCode, { message: `${field} ${JSON.stringify(given.slice(0, 40))} isn't one of the choices.`, field, fix: fix ?? `Give one of: ${allowed.join(", ")}; or leave it out.` });
  }
}

function readPostSelection(given: string | null): PostSelection {
  if (given === null) return "all";
  oneOf("post_selection", given, POST_SELECTIONS, "Give all (the default), answer (the question and its answer), latest (the opening post and the last five) or none (the topic alone).");
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
  if (!/^cursor_[0-9a-z]{1,6}$/.test(cursor)) {
    throw new ApiError("bad_cursor", { message: `cursor ${JSON.stringify(cursor.slice(0, 40))} isn't a next_cursor Zaisma gave.`, field: "cursor", fix: "Pass the next_cursor from your last answer as it came, or leave cursor out for the first page." });
  }
  return parseInt(cursor.slice(7), 36);
}

/** A forum query from the API, checked: a value that isn't one of the choices is an error, never quietly ignored. */
export function queryFrom(queryParameters: URLSearchParams): ForumQuery {
  const get = (name: string) => queryParameters.get(name) ?? "";
  oneOf("tab", get("tab"), FORUM_TABS, "Give latest (the default), top (most votes), unanswered (questions), known (known issues), yours (your topics and the ones you follow) or messages (yours to Zaisma).");
  const sectionIds: string[] = FORUM_SECTIONS.map((section) => section.id);
  oneOf("section", get("section"), sectionIds, `Give one of: ${sectionIds.join(", ")}; or a single category with category.`);
  const isSection = sectionIds.includes(get("category"));
  oneOf("category", get("category"), FORUM_CATEGORIES, isSection ? `${get("category")} is a section: give section=${get("category")}, or one of its categories, like ${Object.keys(FORUM_SECTIONS.find((section) => section.id === get("category"))!.categories)[0]}.` : undefined);
  oneOf("kind", get("kind"), TOPIC_KINDS);
  oneOf("tag", get("tag"), Object.keys(FORUM_TAGS));
  oneOf("topic_status", get("topic_status"), TOPIC_STATUSES);
  oneOf("detail", get("detail"), ["brief"], "Give brief for a few fields per topic, or leave it out for every field.");
  const isAnswered = queryParameters.get("is_answered");
  if (isAnswered !== null && isAnswered !== "true" && isAnswered !== "false") {
    throw new ApiError("bad_is_answered", { message: `is_answered ${JSON.stringify(isAnswered.slice(0, 20))} isn't true or false.`, field: "is_answered", fix: "Give true (questions with a marked answer) or false (questions without one), or leave it out." });
  }
  const maximumTopicCount = queryParameters.get("maximum_topic_count");
  if (maximumTopicCount !== null && (!/^\d+$/.test(maximumTopicCount) || Number(maximumTopicCount) < 1 || Number(maximumTopicCount) > PAGE_TOPIC_COUNT)) {
    throw new ApiError("bad_maximum_topic_count", { message: `maximum_topic_count ${JSON.stringify(maximumTopicCount.slice(0, 20))} isn't a whole number from 1 to ${PAGE_TOPIC_COUNT}.`, field: "maximum_topic_count", fix: `Give 1 to ${PAGE_TOPIC_COUNT}, and use next_cursor for more.` });
  }
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
  if ((tab === "yours" || tab === "messages") && !viewer) throw new ApiError("signed_out", { message: "Your topics and messages need you signed in.", fix: "Sign in on zaisma.com, or call with an API key." });
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
    const { results } = await env.DB.prepare(`SELECT id, username AS name FROM accounts WHERE id IN (${chunk.map(() => "?").join(", ")})`).bind(...chunk).all<{ id: string; name: string }>();
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

/** A topic the viewer can see, by its ID (or the input named by `field`). Someone else's message looks the same as no topic. */
export async function readableTopic(env: Env, viewer: Viewer, topicId: string, field = "topic_id"): Promise<ForumTopic> {
  checkIdKind("topic", topicId, field, "search_forum (GET /forum) lists topics with their IDs.");
  const topic = await topicById(env, topicId);
  if (!topic || !canRead(topic, viewer)) throw new ApiError("no_topic", { message: `There's no topic with the ID ${topicId.slice(0, 60)} you can see.`, field, fix: "search_forum (GET /forum) lists topics with their IDs; a public topic shows to others once its first post is checked." });
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
  const topic = await readableTopic(env, viewer, topicId);
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
    throw new ApiError("bad_tags", { message: `tags isn't a list of up to ${FORUM_LIMITS.tagCountPerTopic} of the forum's tags.`, field: "tags", fix: `Give up to ${FORUM_LIMITS.tagCountPerTopic} of: ${Object.keys(FORUM_TAGS).join(", ")}, like ["godot"]; or leave tags out.` });
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
  if (!TOPIC_KINDS.includes(kind)) {
    throw new ApiError("bad_kind", { message: `kind ${JSON.stringify(body.kind)} isn't one of the choices.`, field: "kind", fix: "Give bug (something doesn't work), gap (a limit or missing piece blocks you), feature (an idea), question or talk (a discussion)." });
  }
  const title = readTitle(body);
  // Whoever posts picks the category; Zaisma only moves a topic someone flags as misplaced.
  const category = typeof body.category === "string" ? body.category : "";
  const section = FORUM_SECTIONS.find((candidate) => candidate.id === category);
  if (category && !(FORUM_CATEGORIES as string[]).includes(category)) {
    throw new ApiError("bad_category", {
      message: `category ${JSON.stringify(category.slice(0, 40))} isn't one of the forum's categories.`,
      field: "category",
      fix: section ? `${category} is a section; give one of its categories: ${Object.keys(section.categories).join(", ")}.` : `Give one of: ${FORUM_CATEGORIES.join(", ")} (other for anything else).`,
    });
  }
  const tags = readTags(body);
  if (body.is_public !== undefined && typeof body.is_public !== "boolean") {
    throw new ApiError("bad_is_public", { message: "is_public isn't true or false.", field: "is_public", fix: "Give true (a public topic, the default) or false (a private message to Zaisma)." });
  }
  let knownIssue: ForumTopic | null = null;
  if (typeof body.known_issue_topic_id === "string" && body.known_issue_topic_id) {
    checkIdKind("topic", body.known_issue_topic_id, "known_issue_topic_id", "search_forum with tab known (GET /forum?tab=known) lists the known issues with their IDs.");
    knownIssue = await topicById(env, body.known_issue_topic_id);
    if (!knownIssue?.known_issue_title || !knownIssue.is_shown) {
      throw new ApiError("no_known_issue", { message: `There's no known issue with the ID ${body.known_issue_topic_id.slice(0, 60)}.`, field: "known_issue_topic_id", fix: "search_forum with tab known (GET /forum?tab=known) lists the known issues with their IDs; leave it out for a message of your own." });
    }
  }
  // Every forum topic is public; is_public: false (or a known issue) makes it a private message to Zaisma instead.
  const isPublic = knownIssue ? false : body.is_public !== false;
  if (!category && isPublic) throw new ApiError("no_category", { message: "A public topic needs its category.", field: "category", fix: `Give one of: ${FORUM_CATEGORIES.join(", ")} (other for anything else).` });
  const game = typeof body.game_slug === "string" && body.game_slug ? await ownGame(env, body.game_slug, caller, "game_slug") : null;
  const id = newId("topic");
  const foundAtUrl = isPublic ? topicAddress(env, id) : null;
  await turnOffKeysIn(env, [body.title], foundAtUrl);
  const post = await readPost(env, caller, body, foundAtUrl);
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
    next_steps: NO_NEXT_STEPS,
  };
}

/** A reply to the topic, or to one post in it (reply_to_post_id). reopen: true reopens your own closed topic. */
export async function replyTo(env: Env, caller: Caller, topicId: string, body: Record<string, unknown>) {
  closedBody(body, ["reply_to_post_id", "reopen", ...POST_FIELDS]);
  const topic = await readableTopic(env, caller, topicId);
  if (body.reopen !== undefined && typeof body.reopen !== "boolean") throw new ApiError("bad_reopen", { message: "reopen isn't true or false.", field: "reopen", fix: "Give true to reopen your own closed topic, or leave it out." });
  const reopen = body.reopen === true;
  if (reopen && topic.account_id !== caller.accountId) {
    throw new ApiError("not_yours", { message: "Only the developer who started a topic can reopen it.", field: "reopen", fix: "Leave reopen out and reply, or vote (it affects you too); still_happening is for a known issue whose fix is out." });
  }
  if (reopen && !CLOSED_TOPIC_STATUSES.includes(topic.topic_status)) {
    throw new ApiError("not_closed", { message: `The topic is ${topic.topic_status}, not closed, so there's nothing to reopen.`, field: "reopen", fix: "Leave reopen out and just reply." });
  }
  let replyToPostId: string | null = null;
  if (typeof body.reply_to_post_id === "string" && body.reply_to_post_id) {
    checkIdKind("post", body.reply_to_post_id, "reply_to_post_id", "get_topic lists the topic's posts with their IDs; leave reply_to_post_id out to reply to the topic.");
    const repliedTo = await env.DB.prepare("SELECT * FROM forum_posts WHERE id = ? AND topic_id = ?").bind(body.reply_to_post_id, topic.id).first<ForumPost>();
    if (!repliedTo || !canSeePost(topic, repliedTo, caller)) {
      throw new ApiError("no_post", { message: `There's no post with the ID ${body.reply_to_post_id.slice(0, 60)} you can see in this topic.`, field: "reply_to_post_id", fix: "get_topic lists the topic's posts with their IDs; leave reply_to_post_id out to reply to the topic." });
    }
    replyToPostId = repliedTo.id;
  }
  const post = await readPost(env, caller, body, topic.is_public ? topicAddress(env, topic.id) : null);
  const stored = await storePost(env, topic, caller, post, reopen ? "reopen" : "post", replyToPostId);
  await env.DB.prepare(`UPDATE forum_topics SET updated_at_ms = ?${reopen ? ", topic_status = 'new'" : ""} WHERE id = ?`).bind(Date.now(), topic.id).run();
  const { posts } = await getTopic(env, caller, topic.id);
  const reply = posts.find((candidate) => candidate.id === stored.id);
  if (!reply) throw new Error(`The reply ${stored.id} isn't in its topic.`);
  return { post: reply, check_note: checkNote(stored.checkStatus), removed_secret_count: post.blankedCount, next_steps: NO_NEXT_STEPS };
}

/** A vote on someone else's public topic: it affects you too, you want it, or you have the question too. You follow it. */
export async function vote(env: Env, caller: Caller, topicId: string, isVoting: boolean) {
  const topic = await readableTopic(env, caller, topicId);
  if (!topic.is_public || topic.account_id === caller.accountId) {
    throw new ApiError("cant_vote", { message: topic.is_public ? "That's your own topic, so it takes no vote from you." : "That's a private message, which takes no votes.", field: "topic_id", fix: "Reply to it instead (reply_to_topic)." });
  }
  if (topic.kind === "talk") throw new ApiError("cant_vote", { message: "Discussions take replies, not votes.", field: "topic_id", fix: "Reply to it instead (reply_to_topic)." });
  const nowMs = Date.now();
  const change = isVoting
    ? await env.DB.prepare("INSERT OR IGNORE INTO forum_votes (topic_id, account_id, created_at_ms) VALUES (?, ?, ?)").bind(topic.id, caller.accountId, nowMs).run()
    : await env.DB.prepare("DELETE FROM forum_votes WHERE topic_id = ? AND account_id = ?").bind(topic.id, caller.accountId).run();
  if (change.meta.changes) await env.DB.prepare(`UPDATE forum_topics SET vote_count = MAX(0, vote_count ${isVoting ? "+" : "-"} 1) WHERE id = ?`).bind(topic.id).run();
  if (isVoting) await env.DB.prepare("INSERT OR IGNORE INTO forum_follows (topic_id, account_id, seen_at_ms) VALUES (?, ?, ?)").bind(topic.id, caller.accountId, nowMs).run();
  const row = await env.DB.prepare("SELECT vote_count FROM forum_topics WHERE id = ?").bind(topic.id).first<{ vote_count: number }>();
  return { vote_count: row?.vote_count ?? 0, has_voted: isVoting, next_steps: NO_NEXT_STEPS };
}

/** It's in the wrong category: Zaisma's AI looks at where it belongs on its next run and moves it, saying so in the topic. */
export async function flagMisplaced(env: Env, caller: Caller, topicId: string) {
  const topic = await readableTopic(env, caller, topicId);
  if (!topic.is_shown || topic.merged_into_topic_id) {
    throw new ApiError("cant_flag", { message: "Only public topics others can see can be flagged as misplaced.", field: "topic_id", fix: "Wait until it passes its check (get_topic shows check_status), or leave it: private messages aren't sorted into categories." });
  }
  await env.DB.prepare("INSERT OR IGNORE INTO forum_misplaced_flags (topic_id, account_id, created_at_ms) VALUES (?, ?, ?)").bind(topic.id, caller.accountId, Date.now()).run();
  return { has_flagged_misplaced: true, next_steps: NO_NEXT_STEPS };
}

/**
 * A known issue whose fix is out (released) still happens: it goes back to fixing, everyone in it
 * hears, and Zaisma gets an alert. Once per fix, however many say so; with text, it's also a reply.
 */
export async function stillHappening(env: Env, caller: Caller, topicId: string, body: Record<string, unknown>) {
  closedBody(body, ["text_markdown"]);
  const topic = await readableTopic(env, caller, topicId);
  if (!topic.known_issue_title || topic.topic_status !== "released") {
    throw new ApiError("not_released", {
      message: topic.known_issue_title ? `This known issue is ${topic.topic_status}, not released, so there's no fix out to say it still happens after.` : "This isn't a known issue.",
      field: "topic_id",
      fix: "Reply to it with what you saw (reply_to_topic), or send your own case privately (message_zaisma with known_issue_topic_id).",
    });
  }
  const reply = typeof body.text_markdown === "string" && body.text_markdown.trim() ? await replyTo(env, caller, topic.id, { text_markdown: body.text_markdown }) : null;
  await decideTopic(env, topic.id, { topicStatus: "fixing", reply: "A developer says it still happens after the fix, so Zaisma is working on it again." });
  await sendAlert(env, `Still happening after the fix: ${topic.known_issue_title}`, `A developer says the known issue still happens after its fix was released. It's back to fixing.\n\nOpen: ${env.SITE_ORIGIN}/admin/feedback/${topic.id}`);
  return { topic_status: "fixing" as const, post: reply?.post ?? null, next_steps: NO_NEXT_STEPS };
}

async function visiblePost(env: Env, caller: Caller, topicId: string, postId: string): Promise<ForumPost> {
  const topic = await readableTopic(env, caller, topicId);
  checkIdKind("post", postId, "post_id", "get_topic lists the topic's posts with their IDs.");
  const post = await env.DB.prepare("SELECT * FROM forum_posts WHERE id = ? AND topic_id = ?").bind(postId, topic.id).first<ForumPost>();
  if (!post || post.check_status !== "passed") {
    throw new ApiError("no_post", { message: `There's no post with the ID ${postId.slice(0, 60)} others can see in this topic.`, field: "post_id", fix: "get_topic lists the topic's posts with their IDs; posts still being checked can't be marked or reported yet." });
  }
  return post;
}

/** Someone else's reply helped: it shows how many found it helpful. No dislikes: a wrong reply gets a better one, a harmful one a report. */
export async function markHelpful(env: Env, caller: Caller, topicId: string, postId: string, isMarking: boolean) {
  const post = await visiblePost(env, caller, topicId, postId);
  if (post.account_id === caller.accountId && post.author_kind !== "zaisma") {
    throw new ApiError("cant_mark_helpful", { message: "That's the developer's own post, and helpful is for other people's.", field: "post_id", fix: "Mark a reply someone else wrote." });
  }
  const change = isMarking
    ? await env.DB.prepare("INSERT OR IGNORE INTO forum_helpful_marks (post_id, account_id, created_at_ms) VALUES (?, ?, ?)").bind(post.id, caller.accountId, Date.now()).run()
    : await env.DB.prepare("DELETE FROM forum_helpful_marks WHERE post_id = ? AND account_id = ?").bind(post.id, caller.accountId).run();
  if (change.meta.changes) await env.DB.prepare(`UPDATE forum_posts SET helpful_count = MAX(0, helpful_count ${isMarking ? "+" : "-"} 1) WHERE id = ?`).bind(post.id).run();
  const row = await env.DB.prepare("SELECT helpful_count FROM forum_posts WHERE id = ?").bind(post.id).first<{ helpful_count: number }>();
  return { helpful_count: row?.helpful_count ?? 0, has_marked_helpful: isMarking, next_steps: NO_NEXT_STEPS };
}

/**
 * A post that shouldn't be here. A person at Zaisma looks; it's hidden at once when it puts a young
 * person at risk (and Zaisma is alerted), or once FORUM_HIDING_REPORT_COUNT developers have reported it.
 */
export async function reportPost(env: Env, caller: Caller, topicId: string, postId: string, body: Record<string, unknown>) {
  closedBody(body, ["reason", "details"]);
  const post = await visiblePost(env, caller, topicId, postId);
  const reason = String(body.reason ?? "") as ForumReportReason;
  if (!(reason in FORUM_REPORT_REASONS)) {
    throw new ApiError("bad_reason", { message: `reason ${JSON.stringify(String(body.reason ?? "").slice(0, 40))} isn't one of the report reasons.`, field: "reason", fix: `Give one of: ${Object.keys(FORUM_REPORT_REASONS).join(", ")}.` });
  }
  if (post.author_kind === "zaisma") throw new ApiError("cant_report", { message: "Zaisma's own posts can't be reported.", field: "post_id", fix: "Tell Zaisma what's wrong with message_zaisma instead." });
  if (post.account_id === caller.accountId) throw new ApiError("cant_report", { message: "That's the developer's own post.", field: "post_id", fix: "Reply to correct it instead." });
  const details = typeof body.details === "string" ? body.details.trim().slice(0, 1000) : "";
  await env.DB.prepare("INSERT OR REPLACE INTO forum_reports (post_id, account_id, reason, details, created_at_ms) VALUES (?, ?, ?, ?, ?)").bind(post.id, caller.accountId, reason, details || null, Date.now()).run();
  const reportCount = (await env.DB.prepare("SELECT COUNT(*) AS report_count FROM forum_reports WHERE post_id = ?").bind(post.id).first<{ report_count: number }>())?.report_count ?? 0;
  const isHidden = reason === "child_safety" || reportCount >= FORUM_HIDING_REPORT_COUNT;
  if (isHidden) await hidePost(env, post.id, `Reported: ${FORUM_REPORT_REASONS[reason]}${reportCount > 1 ? ` (${reportCount} reports)` : ""}`);
  if (reason === "child_safety") {
    await sendAlert(env, "Forum post reported: puts a young person at risk", `A forum post was reported as putting a young person at risk. It's hidden until you look.\n\nOpen: ${env.SITE_ORIGIN}/admin/feedback/${post.topic_id}`);
  }
  return { has_reported: true, is_hidden: isHidden, next_steps: NO_NEXT_STEPS };
}

/** Follow a topic to hear about what's new in it (yours, ones you replied to and voted on are followed already). */
export async function follow(env: Env, caller: Caller, topicId: string, isFollowing: boolean) {
  const topic = await readableTopic(env, caller, topicId);
  if (isFollowing) await env.DB.prepare("INSERT OR IGNORE INTO forum_follows (topic_id, account_id, seen_at_ms) VALUES (?, ?, ?)").bind(topic.id, caller.accountId, Date.now()).run();
  else await env.DB.prepare("DELETE FROM forum_follows WHERE topic_id = ? AND account_id = ?").bind(topic.id, caller.accountId).run();
  return { is_following: isFollowing, next_steps: NO_NEXT_STEPS };
}

/** The developer who asked marks the reply that answered their question (null clears it). */
export async function markAnswer(env: Env, caller: Caller, topicId: string, postId: string | null) {
  const topic = await readableTopic(env, caller, topicId);
  if (topic.account_id !== caller.accountId) throw new ApiError("not_yours", { message: "Only the developer who asked a question marks its answer.", field: "topic_id", fix: "Mark the reply helpful instead (mark_helpful)." });
  if (topic.kind !== "question") throw new ApiError("not_a_question", { message: `This topic is a ${topic.kind}, not a question, so it has no answer to mark.`, field: "topic_id", fix: "Reply to say what solved it; reopen or a reply keeps everyone posted." });
  if (postId) {
    checkIdKind("post", postId, "answer_post_id", "get_topic lists the topic's posts with their IDs.");
    const post = await env.DB.prepare("SELECT * FROM forum_posts WHERE id = ? AND topic_id = ?").bind(postId, topic.id).first<ForumPost>();
    if (!post || post.check_status !== "passed") {
      throw new ApiError("no_post", { message: `There's no reply with the ID ${postId.slice(0, 60)} others can see in this topic.`, field: "answer_post_id", fix: "get_topic lists the topic's posts with their IDs; a reply still being checked can't be the answer yet." });
    }
  }
  await env.DB.prepare(
    "UPDATE forum_topics SET answer_post_id = ?, topic_status = CASE WHEN ? IS NOT NULL THEN 'answered' WHEN topic_status = 'answered' THEN 'new' ELSE topic_status END, updated_at_ms = ? WHERE id = ?",
  )
    .bind(postId, postId, Date.now(), topic.id)
    .run();
  return { answer_post_id: postId, next_steps: NO_NEXT_STEPS };
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
  if (!image || !object) throw new ApiError("no_media", { message: "There's no image there you can see.", fix: "Use the image_url a post's media gives, while you can see the post." });
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
