import {
  FEEDBACK_AREAS,
  FEEDBACK_CLOSED,
  FEEDBACK_KINDS,
  FEEDBACK_LIMITS,
  FEEDBACK_OPEN_PHASES,
  FEEDBACK_STATUSES,
  FORUM_CATEGORIES,
  FORUM_REPORT_REASONS,
  FORUM_REPORTS_TO_HIDE,
  FORUM_TAGS,
  type ForumReportReason,
  feedbackMediaKey,
  feedbackPictureKey,
  gameById,
  newId,
  type Feedback,
  type FeedbackAuthor,
  type FeedbackKind,
  type FeedbackPost,
  type FeedbackStatus,
} from "@zaisma/core";
import { ApiError, ownGame, readJson, type Caller } from "./developer.ts";
import type { Env } from "./env.ts";
import { decideFeedback, developersIn, feedbackById, hasNews, KNOWN, mediaOf, postsLeft, readPost, readTitle, storePost, uploadDraftMedia } from "./feedback.ts";
import { forumPeople, mentionsOf } from "./forum-mentions.ts";
import { searchTerms, searchTopics } from "./forum-search.ts";
import { hidePost } from "./forum-check.ts";
import { sendAlert } from "./email.ts";

/**
 * The developer forum (docs/DECISIONS.md): every feedback item is a topic. Topics are public; anything
 * private is a message to Zaisma (public: false), which only the developer and Zaisma see. Known
 * issues are public topics of Zaisma's own. The forum pages, the MCP and API callers all use these:
 *
 *   GET  /api/dev/forum?q=&category=&kind=&tag=&tab=&status=&answered=&page=&limit=&fields=brief
 *                                                           topics (tab: latest, top, unanswered, known, yours, messages); q ranks by relevance
 *   GET  /api/dev/forum/similar?q=                          topics and known issues like a title, while writing one
 *   POST /api/dev/forum                                     a topic: { kind, title, text, category, tags?, game?, context?, author?, picture? }, or with
 *                                                           public: false (or known_issue) a private message to Zaisma
 *   GET  /api/dev/forum/:id?posts=all|answer|latest|none   a topic with its posts (or just the answer, the latest few, or none)
 *   POST /api/dev/forum/:id/posts                           reply: { text, reply_to?, reopen?, context?, author?, picture? }
 *   POST /api/dev/forum/:id/vote                            a vote (affects me too, I want this, same question): { on }
 *   POST /api/dev/forum/:id/follow                          { on }
 *   POST /api/dev/forum/:id/answer                          your question's answer: { post } (null to clear)
 *   POST /api/dev/forum/:id/misplaced                       it's in the wrong category: Zaisma's AI moves it
 *   POST /api/dev/forum/:id/still-happening                 a known issue whose fix is out still happens: { text? }
 *   POST /api/dev/forum/:id/posts/:post/helpful             someone else's reply helped: { on }
 *   POST /api/dev/forum/:id/posts/:post/report              it shouldn't be here: { reason, details? }
 *   GET  /api/dev/forum/:id/pictures/:post                  a screenshot you attached (the first calls)
 *   POST /api/dev/forum/media                               upload an image (the bytes) to place in a post's text as ![image](/forum/media/ID)
 *   GET  /api/dev/forum/:id/media/:media                    an image in a post you can see
 *   GET  /api/dev/forum/people?q=&topic=                    names to @mention: Zaisma, people in the topic, then anyone in the forum
 *
 * Others see a public post once it passes the check (forum-check.ts). Screenshots and what an AI
 * attaches stay private to whoever posted them and Zaisma. Reading needs no account on the pages;
 * the API reads as the caller.
 */

/** Who's reading: an account, or nobody signed in (the pages only). */
export type Viewer = Caller | null;

/** yours: your public topics and the ones you follow. messages: your private messages to Zaisma. */
export const FORUM_TABS = ["latest", "top", "unanswered", "known", "yours", "messages"] as const;
export type ForumTab = (typeof FORUM_TABS)[number];
const PAGE = 30;

export interface Person {
  name: string;
  /** developer: written by the developer; ai: by their AI assistant; zaisma: by Zaisma. */
  by: "developer" | "ai" | "zaisma";
  you: boolean;
}

export interface TopicRow {
  id: string;
  kind: FeedbackKind;
  title: string;
  category: string | null;
  tags: string[];
  status: FeedbackStatus;
  public: boolean;
  /** Others can see it: public, and its first post passed the check. */
  shown: boolean;
  known_issue: boolean;
  author: Person;
  /** The latest few people in it, newest first, without the author. */
  people: Person[];
  /** Everyone in it besides the author, however many: people shows the latest few. */
  people_count: number;
  replies: number;
  votes: number;
  voted: boolean;
  /** For a known issue: the developers it affects. */
  developers: number | null;
  answered: boolean;
  /** Merged into another topic (yours only). */
  merged_into: string | null;
  /** Something new since you last opened it. */
  unread: boolean;
  created_at: number;
  active_at: number;
  /** With a search: the words that matched, marked «like this». */
  match?: string;
}

/** A topic in a few fields, for an AI scanning results: open one with get_topic for more. */
export interface BriefRow {
  id: string;
  title: string;
  kind: FeedbackKind;
  status: FeedbackStatus;
  known_issue: boolean;
  answered: boolean;
  /** Votes, or for a known issue the developers it affects. */
  count: number;
  replies: number;
  category: string | null;
  match?: string;
  unread?: true;
  active_at: number;
}

const brief = (t: TopicRow): BriefRow => ({
  id: t.id,
  title: t.title,
  kind: t.kind,
  status: t.status,
  known_issue: t.known_issue,
  answered: t.answered,
  count: t.known_issue ? (t.developers ?? 0) : t.votes,
  replies: t.replies,
  category: t.category,
  ...(t.match ? { match: t.match } : {}),
  ...(t.unread ? { unread: true as const } : {}),
  active_at: t.active_at,
});

export interface PostJson {
  id: string;
  by: Person;
  kind: FeedbackPost["kind"];
  text: string;
  reply_to: { id: string; name: string; excerpt: string } | null;
  answer: boolean;
  /** Your own post that others can't see yet: checking, or held for a person. */
  state: "checking" | "held" | null;
  via: FeedbackPost["via"];
  /** How many developers found it helpful, and whether you did. */
  helpful: number;
  helpful_by_you: boolean;
  /** You reported it, and Zaisma hasn't looked yet. */
  reported_by_you: boolean;
  /** Only for whoever posted it (and Zaisma). */
  context: unknown;
  /** The first calls' screenshot, for whoever posted it. */
  picture_url: string | null;
  /** Its images: public with the post, or private to you and Zaisma in a message. */
  media: { id: string; url: string }[];
  /** The people it @mentions, by name. */
  mentions: string[];
  at: number;
}

export async function forumRoute(request: Request, env: Env, path: string, caller: Caller): Promise<[unknown, number?] | Response> {
  const method = request.method;
  const url = new URL(request.url);
  if (path === "/forum" && method === "GET") {
    const list = await listTopics(env, caller, queryFrom(url.searchParams));
    // fields=brief: a few fields per topic, so an AI scanning results spends few tokens.
    if (url.searchParams.get("fields") === "brief") return [{ topics: list.topics.map(brief), pinned: list.pinned.map(brief), tab: list.tab, page: list.page, more: list.more }];
    return [list];
  }
  if (path === "/forum/similar" && method === "GET") return [{ topics: await similarTopics(env, caller, url.searchParams.get("q") ?? "") }];
  if (path === "/forum/media" && method === "POST") {
    const bytes = new Uint8Array(await request.arrayBuffer());
    return [await uploadDraftMedia(env, caller, bytes), 201];
  }
  if (path === "/forum/people" && method === "GET") return [{ people: await forumPeople(env, url.searchParams.get("q") ?? "", url.searchParams.get("topic") || null, caller.accountId) }];
  const mediaPath = path.match(/^\/forum\/[a-z0-9]{1,40}\/media\/([a-z0-9]{1,40})$/);
  if (mediaPath && method === "GET") return serveMedia(env, caller, mediaPath[1]!);
  if (path === "/forum" && method === "POST") return [await createTopic(env, caller, await readJson(request, 72 * 1024 * 1024)), 201];
  const onPost = path.match(/^\/forum\/([a-z0-9]{1,40})\/posts\/([a-z0-9]{1,40})\/(helpful|report)$/);
  if (onPost) {
    if (method !== "POST") throw new ApiError(405, "bad_method", `${method} isn't used here.`);
    const body = await readJson(request, 8192);
    if (onPost[3] === "helpful") return [await markHelpful(env, caller, onPost[1]!, onPost[2]!, body.on !== false)];
    return [await reportPost(env, caller, onPost[1]!, onPost[2]!, body)];
  }
  const m = path.match(/^\/forum\/([a-z0-9]{1,40})(?:\/(posts|vote|follow|answer|misplaced|still-happening|pictures)(?:\/([a-z0-9]{1,40}))?)?$/);
  if (!m) throw new ApiError(404, "not_found", "No such API path.");
  const [, id, sub, postId] = m as unknown as [string, string, string | undefined, string | undefined];
  if (!sub && method === "GET") return [await getTopic(env, caller, id, { posts: url.searchParams.get("posts") ?? "all" })];
  if (sub === "pictures" && postId && method === "GET") return topicPicture(env, caller, id, postId);
  if (method !== "POST" || postId) throw new ApiError(405, "bad_method", `${method} isn't used here.`);
  const body = await readJson(request, sub === "posts" ? 72 * 1024 * 1024 : 4096);
  if (sub === "posts") return [await replyTo(env, caller, id, body), 201];
  if (sub === "vote") return [await vote(env, caller, id, body.on !== false)];
  if (sub === "follow") return [await follow(env, caller, id, body.on !== false)];
  if (sub === "answer") return [await markAnswer(env, caller, id, typeof body.post === "string" ? body.post : null)];
  if (sub === "misplaced") return [await flagMisplaced(env, caller, id)];
  if (sub === "still-happening") return [await stillHappening(env, caller, id, body)];
  throw new ApiError(404, "not_found", "No such API path.");
}

export interface ForumQuery {
  q?: string;
  category?: string;
  kind?: string;
  tag?: string;
  tab?: string;
  /** A status or known-issue phase. */
  status?: string;
  /** Only questions with an answer (true), or without (false). */
  answered?: boolean;
  page?: number;
  limit?: number;
}

export function queryFrom(p: URLSearchParams): ForumQuery {
  const answered = p.get("answered");
  return {
    q: p.get("q") ?? "",
    category: p.get("category") ?? "",
    kind: p.get("kind") ?? "",
    tag: p.get("tag") ?? "",
    tab: p.get("tab") ?? "",
    status: p.get("status") ?? "",
    ...(answered === "true" || answered === "false" ? { answered: answered === "true" } : {}),
    page: Number(p.get("page") ?? 1),
    ...(p.get("limit") ? { limit: Number(p.get("limit")) } : {}),
  };
}

/** The areas a category id stands for: a sub-category, or every one in a category. */
export function areasOf(category: string): string[] {
  if ((FEEDBACK_AREAS as string[]).includes(category)) return [category];
  const c = FORUM_CATEGORIES.find((c) => c.id === category);
  return c ? Object.keys(c.areas) : [];
}

const like = (word: string) => `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Topics, a page at a time. Everyone sees public topics that passed their check; "yours" is the
 * caller's own topics, private ones included, and the ones they follow. Known issues for the
 * category come pinned on the first page of the latest topics.
 */
export async function listTopics(env: Env, viewer: Viewer, query: ForumQuery) {
  const tab: ForumTab = (FORUM_TABS as readonly string[]).includes(query.tab ?? "") ? (query.tab as ForumTab) : "latest";
  if ((tab === "yours" || tab === "messages") && !viewer) throw new ApiError(401, "signed_out", "Sign in to see your topics and messages.");
  const page = Math.max(1, Math.min(1000, Math.floor(Number(query.page) || 1)));
  const size = Math.max(1, Math.min(PAGE, Math.floor(Number(query.limit) || PAGE)));
  const where: string[] = [];
  const binds: unknown[] = [];
  if (tab === "yours") {
    where.push("f.public = 1 AND (f.account_id = ? OR f.id IN (SELECT feedback_id FROM feedback_follows WHERE account_id = ?))");
    binds.push(viewer!.accountId, viewer!.accountId);
  } else if (tab === "messages") {
    where.push("f.public = 0 AND f.account_id = ?");
    binds.push(viewer!.accountId);
  } else where.push("f.shown = 1 AND f.group_id IS NULL");
  const areas = query.category ? areasOf(query.category) : [];
  if (areas.length) {
    where.push(`f.area IN (${areas.map(() => "?").join(", ")})`);
    binds.push(...areas);
  }
  if (query.kind && (FEEDBACK_KINDS as readonly string[]).includes(query.kind)) {
    where.push("f.kind = ?");
    binds.push(query.kind);
  }
  if (query.tag && query.tag in FORUM_TAGS) {
    where.push("f.id IN (SELECT feedback_id FROM feedback_tags WHERE tag = ?)");
    binds.push(query.tag);
  }
  if (tab === "unanswered") where.push("f.kind = 'question' AND f.answer_post IS NULL AND f.status NOT IN ('answered', 'fixed', 'wont') AND f.known_title IS NULL");
  if (tab === "known") where.push("f.known_title IS NOT NULL");
  if (query.status && (FEEDBACK_STATUSES as readonly string[]).includes(query.status)) {
    where.push("f.status = ?");
    binds.push(query.status);
  }
  if (query.answered !== undefined) where.push(query.answered ? "(f.answer_post IS NOT NULL OR f.status = 'answered')" : "f.kind = 'question' AND f.answer_post IS NULL AND f.status != 'answered'");
  const q = (query.q ?? "").trim().slice(0, 200);
  // Open known issues are pinned above the latest topics, so they aren't listed again below them.
  const open = FEEDBACK_OPEN_PHASES.map((s) => `'${s}'`).join(", ");
  const pins = tab === "latest" && !q && !query.tag && !query.status && query.answered === undefined && (!query.kind || query.kind === "bug" || query.kind === "gap");
  if (pins) where.push(`NOT (f.known_title IS NOT NULL AND f.status IN (${open}))`);
  let rows: (Feedback & { search_match?: string })[];
  const terms = q ? searchTerms(q) : null;
  if (terms && tab !== "yours" && tab !== "messages") {
    // Ranked full-text search over what's public; all the words, or any of them when all finds nothing.
    rows = await searchTopics(env, terms.all, { where, binds }, size + 1, (page - 1) * size);
    if (!rows.length && page === 1 && terms.any !== terms.all) rows = await searchTopics(env, terms.any, { where, binds }, size + 1, 0);
  } else {
    // Your own topics and messages: every word, in the title or a post.
    for (const word of q.split(/\s+/).filter((w) => w.length >= 2).slice(0, 6)) {
      where.push("(f.title LIKE ? ESCAPE '\\' OR f.known_title LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM feedback_posts p WHERE p.feedback_id = f.id AND p.text LIKE ? ESCAPE '\\'))");
      binds.push(like(word), like(word), like(word));
    }
    const order =
      tab === "top"
        ? "f.votes DESC, f.replies DESC, f.active_at DESC"
        : tab === "known"
          ? `CASE f.status ${FEEDBACK_OPEN_PHASES.map((s, i) => `WHEN '${s}' THEN ${i}`).join(" ")} ELSE 9 END, f.active_at DESC`
          : "COALESCE(f.active_at, f.updated_at) DESC";
    rows = (await env.DB.prepare(`SELECT f.* FROM feedback f WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...binds, size + 1, (page - 1) * size).all<Feedback>()).results;
  }
  const more = rows.length > size;
  const shown = rows.slice(0, size);
  // What matched, unless it's just the title again.
  const topics = (await rowsJson(env, viewer, shown)).map((t, i) => {
    const match = shown[i]!.search_match;
    return match && match.replace(/[«»]/g, "") !== t.title ? { ...t, match } : t;
  });
  // Known issues in the category, pinned above the latest topics.
  let pinned: TopicRow[] = [];
  if (pins && page === 1) {
    const { results: known } = await env.DB.prepare(
      `SELECT * FROM feedback f WHERE f.shown = 1 AND f.group_id IS NULL AND f.known_title IS NOT NULL AND f.status IN (${open})${areas.length ? ` AND f.area IN (${areas.map(() => "?").join(", ")})` : ""} ORDER BY f.votes DESC, f.active_at DESC LIMIT 5`,
    )
      .bind(...areas)
      .all<Feedback>();
    pinned = await rowsJson(env, viewer, known);
  }
  return { topics, pinned, tab, page, more, posts_left_today: viewer ? await postsLeft(env, viewer) : null };
}

/** Topics and known issues that look like the same thing, while a title is being written. */
export async function similarTopics(env: Env, viewer: Viewer, text: string): Promise<TopicRow[]> {
  const q = text.trim().slice(0, 500);
  if (q.length < 4) return [];
  const terms = searchTerms(q);
  if (!terms) return [];
  const found = await searchTopics(env, terms.any, { where: ["f.shown = 1", "f.group_id IS NULL"], binds: [] }, 5, 0);
  return rowsJson(env, viewer, found);
}

const BY: Record<FeedbackAuthor, Person["by"]> = { person: "developer", ai: "ai", zaisma: "zaisma" };

function personOf(accountId: string | null, author: FeedbackAuthor, names: Map<string, string>, viewer: Viewer): Person {
  if (author === "zaisma") return { name: "Zaisma", by: "zaisma", you: false };
  return { name: (accountId && names.get(accountId)) || "Deleted account", by: BY[author], you: Boolean(viewer && accountId === viewer.accountId) };
}

async function namesOf(env: Env, ids: Iterable<string | null>): Promise<Map<string, string>> {
  const all = [...new Set([...ids].filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  for (let i = 0; i < all.length; i += 90) {
    const chunk = all.slice(i, i + 90);
    const { results } = await env.DB.prepare(`SELECT id, name FROM accounts WHERE id IN (${chunk.map(() => "?").join(", ")})`).bind(...chunk).all<{ id: string; name: string }>();
    for (const r of results) names.set(r.id, r.name);
  }
  return names;
}

/** Topics as lists show them, with everything each row needs fetched in a few queries. */
async function rowsJson(env: Env, viewer: Viewer, rows: Feedback[]): Promise<TopicRow[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => "?").join(", ");
  const me = viewer?.accountId ?? "";
  const [tags, posters, firsts, votes, follows, developers, counts] = await Promise.all([
    env.DB.prepare(`SELECT feedback_id, tag FROM feedback_tags WHERE feedback_id IN (${marks})`).bind(...ids).all<{ feedback_id: string; tag: string }>(),
    env.DB.prepare(
      `SELECT feedback_id, account_id, author, at, everyone FROM (
         SELECT feedback_id, account_id, author, MAX(created_at) AS at,
           ROW_NUMBER() OVER (PARTITION BY feedback_id ORDER BY MAX(created_at) DESC) AS place,
           COUNT(*) OVER (PARTITION BY feedback_id) AS everyone
         FROM feedback_posts WHERE feedback_id IN (${marks}) AND (check_state = 'ok' OR check_state IS NULL OR account_id = ?) GROUP BY feedback_id, account_id, author
       ) WHERE place <= 6 ORDER BY at DESC`,
    )
      .bind(...ids, me)
      .all<{ feedback_id: string; account_id: string | null; author: FeedbackAuthor; everyone: number }>(),
    env.DB.prepare(`SELECT p.feedback_id, p.author FROM feedback_posts p WHERE p.feedback_id IN (${marks}) AND p.rowid = (SELECT q.rowid FROM feedback_posts q WHERE q.feedback_id = p.feedback_id ORDER BY q.created_at, q.rowid LIMIT 1)`)
      .bind(...ids)
      .all<{ feedback_id: string; author: FeedbackAuthor }>(),
    me ? env.DB.prepare(`SELECT feedback_id FROM feedback_votes WHERE account_id = ? AND feedback_id IN (${marks})`).bind(me, ...ids).all<{ feedback_id: string }>() : { results: [] },
    me ? env.DB.prepare(`SELECT feedback_id, seen_at FROM feedback_follows WHERE account_id = ? AND feedback_id IN (${marks})`).bind(me, ...ids).all<{ feedback_id: string; seen_at: number }>() : { results: [] },
    developersIn(env, rows.filter((r) => r.known_title).map((r) => r.id)),
    // A private message's replies aren't counted as it goes (only public ones are): count them here.
    rows.some((r) => !r.public)
      ? env.DB.prepare(`SELECT feedback_id, COUNT(*) AS n FROM feedback_posts WHERE feedback_id IN (${marks}) GROUP BY feedback_id`).bind(...ids).all<{ feedback_id: string; n: number }>()
      : { results: [] as { feedback_id: string; n: number }[] },
  ]);
  const names = await namesOf(env, [...rows.map((r) => r.account_id), ...posters.results.map((p) => p.account_id)]);
  const voted = new Set(votes.results.map((v) => v.feedback_id));
  const seen = new Map(follows.results.map((f) => [f.feedback_id, f.seen_at]));
  return rows.map((f) => {
    const firstBy = firsts.results.find((p) => p.feedback_id === f.id)?.author ?? (f.account_id ? "person" : "zaisma");
    const author = personOf(f.account_id, f.account_id ? firstBy : "zaisma", names, viewer);
    const mine = posters.results.filter((p) => p.feedback_id === f.id);
    const isAuthor = (p: { account_id: string | null; author: FeedbackAuthor }) => Boolean(f.account_id && p.account_id === f.account_id && p.author === firstBy);
    const people = mine
      .filter((p) => !isAuthor(p))
      .slice(0, 4)
      .map((p) => personOf(p.account_id, p.author, names, viewer));
    // Everyone who posted, less the author (whose opening post is always there).
    const peopleCount = Math.max(people.length, (mine[0]?.everyone ?? 0) - (f.account_id ? 1 : 0));
    const active = f.active_at ?? f.updated_at;
    const lastSeen = seen.get(f.id);
    return {
      id: f.id,
      kind: f.kind,
      title: f.known_title ?? f.title,
      category: f.area || null,
      tags: tags.results.filter((t) => t.feedback_id === f.id).map((t) => t.tag),
      status: f.status,
      public: f.public === 1,
      shown: f.shown === 1,
      known_issue: Boolean(f.known_title),
      author,
      people,
      people_count: peopleCount,
      replies: f.public ? f.replies : Math.max(0, (counts.results.find((c) => c.feedback_id === f.id)?.n ?? 1) - 1),
      votes: f.votes,
      voted: voted.has(f.id),
      developers: f.known_title ? (developers.get(f.id) ?? 0) : null,
      answered: Boolean(f.answer_post) || f.status === "answered",
      merged_into: viewer && f.account_id === viewer.accountId ? f.group_id : null,
      unread: (lastSeen !== undefined && active > lastSeen) || Boolean(viewer && f.account_id === viewer.accountId && hasNews(f)),
      created_at: f.created_at,
      active_at: active,
    };
  });
}

/** Whether the viewer may read the topic: it's public and checked, or it's theirs. */
function canRead(f: Feedback, viewer: Viewer): boolean {
  return f.shown === 1 || Boolean(viewer && f.account_id === viewer.accountId);
}

async function readable(env: Env, viewer: Viewer, id: string): Promise<Feedback> {
  const f = await feedbackById(env, id);
  if (!f || !canRead(f, viewer)) throw new ApiError(404, "no_topic", "There's no topic with that id you can see. GET /forum lists them.");
  return f;
}

/** A post others can see, or the viewer's own (still being checked, or held). */
function canSeePost(f: Feedback, p: FeedbackPost, viewer: Viewer): boolean {
  if (p.check_state === "ok" || p.author === "zaisma") return true;
  if (viewer && p.account_id === viewer.accountId) return true;
  // A private topic's posts, for its developer.
  return p.check_state === null && Boolean(viewer && f.account_id === viewer.accountId);
}

/** A topic with its posts. Opening it counts as having seen what's in it. */
export async function getTopic(env: Env, viewer: Viewer, id: string, opts: { posts?: string } = {}) {
  const f = await readable(env, viewer, id);
  const { results: all } = await env.DB.prepare("SELECT * FROM feedback_posts WHERE feedback_id = ? ORDER BY created_at, rowid LIMIT 1000").bind(f.id).all<FeedbackPost>();
  const visible = all.filter((p) => canSeePost(f, p, viewer));
  // To save an AI's tokens: answer is the opening post and the marked answer; latest is the opening
  // post and the last five; none is the topic alone (a known issue's phase and workaround).
  const opening = f.account_id ? visible.slice(0, 1) : [];
  const which = opts.posts ?? "all";
  const posts =
    which === "none"
      ? []
      : which === "answer"
        ? [...opening, ...visible.filter((p) => p.id === f.answer_post && !opening.includes(p))]
        : which === "latest"
          ? [...opening, ...visible.slice(-5).filter((p) => !opening.includes(p))]
          : visible;
  const names = await namesOf(env, posts.map((p) => p.account_id));
  const byId = new Map(posts.map((p) => [p.id, p]));
  const [media, mentions] = await Promise.all([mediaOf(env, posts.map((p) => p.id)), mentionsOf(env, posts.map((p) => p.id))]);
  const [row] = await rowsJson(env, viewer, [f]);
  const own = Boolean(viewer && f.account_id === viewer.accountId);
  const group = f.group_id ? await feedbackById(env, f.group_id) : null;
  const game = own && f.game_id ? await gameById(env.DB, f.game_id) : null;
  // Your own private report under a known issue.
  const yours = viewer && f.known_title ? await env.DB.prepare("SELECT id FROM feedback WHERE group_id = ? AND account_id = ? ORDER BY created_at LIMIT 1").bind(f.id, viewer.accountId).first<{ id: string }>() : null;
  const following = viewer ? await env.DB.prepare("SELECT seen_at FROM feedback_follows WHERE feedback_id = ? AND account_id = ?").bind(f.id, viewer.accountId).first<{ seen_at: number }>() : null;
  const flagged = viewer ? await env.DB.prepare("SELECT 1 AS y FROM feedback_misplaced WHERE feedback_id = ? AND account_id = ?").bind(f.id, viewer.accountId).first() : null;
  const [helped, reported]: [Set<string>, Set<string>] = viewer
    ? await Promise.all([
        env.DB.prepare("SELECT post_id FROM feedback_helpful WHERE account_id = ? AND post_id IN (SELECT id FROM feedback_posts WHERE feedback_id = ?)").bind(viewer.accountId, f.id).all<{ post_id: string }>(),
        env.DB.prepare("SELECT post_id FROM forum_reports WHERE account_id = ? AND post_id IN (SELECT id FROM feedback_posts WHERE feedback_id = ?)").bind(viewer.accountId, f.id).all<{ post_id: string }>(),
      ]).then(([h, r]) => [new Set(h.results.map((x) => x.post_id)), new Set(r.results.map((x) => x.post_id))] as [Set<string>, Set<string>])
    : [new Set<string>(), new Set<string>()];
  if (viewer) {
    const now = Date.now();
    if (following) await env.DB.prepare("UPDATE feedback_follows SET seen_at = ? WHERE feedback_id = ? AND account_id = ?").bind(now, f.id, viewer.accountId).run();
    if (own && hasNews(f)) await env.DB.prepare("UPDATE feedback SET seen_at = ? WHERE id = ?").bind(now, f.id).run();
  }
  return {
    topic: {
      ...row!,
      unread: false,
      workaround: f.workaround,
      roadmap: f.roadmap,
      game: game ? game.slug : null,
      merged_into: group ? { id: group.id, title: group.known_title ?? group.title, status: group.status, workaround: group.workaround } : null,
      yours: yours?.id ?? null,
      following: Boolean(following),
      // You flagged it as in the wrong category, and Zaisma hasn't looked yet.
      flagged_misplaced: Boolean(flagged),
      can: {
        reply: Boolean(viewer),
        vote: Boolean(viewer && f.public && !own && f.kind !== "talk"),
        flag: Boolean(viewer && f.shown && !f.group_id),
        answer: own && f.kind === "question",
        reopen: own && FEEDBACK_CLOSED.includes(f.status),
      },
    },
    posts: posts.map((p) => {
      const mine = Boolean(viewer && p.account_id === viewer.accountId && p.author !== "zaisma");
      const to = p.reply_to ? byId.get(p.reply_to) : undefined;
      return {
        id: p.id,
        by: personOf(p.account_id, p.author, names, viewer),
        kind: p.kind,
        text: p.text,
        reply_to: to ? { id: to.id, name: personOf(to.account_id, to.author, names, viewer).name, excerpt: to.text.slice(0, 140) } : null,
        answer: f.answer_post === p.id,
        state: mine && p.check_state === "pending" ? "checking" : mine && p.check_state === "held" ? "held" : null,
        via: p.via,
        helpful: p.helpful,
        helpful_by_you: helped.has(p.id),
        reported_by_you: reported.has(p.id),
        context: mine && p.context ? JSON.parse(p.context) : null,
        picture_url: mine && p.picture ? `${env.SITE_ORIGIN}/api/dev/forum/${f.id}/pictures/${p.id}` : null,
        media: (media.get(p.id) ?? []).map((m) => ({ id: m.id, url: `${env.SITE_ORIGIN}/api/dev/forum/${f.id}/media/${m.id}` })),
        mentions: mentions.get(p.id) ?? [],
        at: p.created_at,
      } satisfies PostJson;
    }),
    // How many posts you can see in all, whichever were sent.
    posts_total: visible.length,
    posts_left_today: viewer ? await postsLeft(env, viewer) : null,
  };
}

function readTags(body: Record<string, unknown>): string[] {
  if (body.tags === undefined || body.tags === null) return [];
  const tags = Array.isArray(body.tags) ? [...new Set(body.tags.map(String))] : null;
  if (!tags || tags.length > FEEDBACK_LIMITS.tags || tags.some((t) => !(t in FORUM_TAGS))) {
    throw new ApiError(400, "bad_tags", `tags: up to ${FEEDBACK_LIMITS.tags} of ${Object.keys(FORUM_TAGS).join(", ")}.`);
  }
  return tags;
}

/**
 * A new topic. Ideas, questions and discussions are public unless public: false; bugs and gaps are
 * private unless public: true. With known_issue it's your own private report under that known issue.
 * Answers with topics and known issues that look like the same thing.
 */
export async function createTopic(env: Env, caller: Caller, body: Record<string, unknown>) {
  const kind = body.kind as FeedbackKind;
  if (!FEEDBACK_KINDS.includes(kind)) throw new ApiError(400, "bad_kind", `kind is one of: ${FEEDBACK_KINDS.join(", ")}.`);
  const title = readTitle(body);
  // Whoever posts picks the sub-category; Zaisma only moves a topic someone flags as misplaced.
  const area = typeof body.category === "string" ? body.category : "";
  if (area && !(FEEDBACK_AREAS as string[]).includes(area)) throw new ApiError(400, "bad_category", `category is a sub-category: ${FEEDBACK_AREAS.join(", ")}.`);
  const tags = readTags(body);
  let group: Feedback | null = null;
  if (typeof body.known_issue === "string" && body.known_issue) {
    group = await feedbackById(env, body.known_issue);
    if (!group?.known_title || !group.shown) throw new ApiError(404, "no_known_issue", "There's no known issue with that id. GET /forum?tab=known lists them.");
  }
  // Every forum topic is public; public: false (or a known_issue) makes it a private message to Zaisma instead.
  const isPublic = group ? false : body.public !== false;
  if (!area && isPublic) throw new ApiError(400, "no_category", `Pick a category: one of ${FEEDBACK_AREAS.join(", ")} (other for anything else).`);
  const game = typeof body.game === "string" && body.game ? await ownGame(env, body.game, caller) : null;
  const post = await readPost(env, caller, body);
  const id = newId();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO feedback (id, account_id, kind, title, game_id, status, group_id, area, public, created_at, updated_at, active_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(
      id,
      caller.accountId,
      kind,
      title,
      game?.id ?? null,
      group && FEEDBACK_OPEN_PHASES.includes(group.status) ? group.status : "new",
      group?.id ?? null,
      area || group?.area || "",
      isPublic ? 1 : 0,
      now,
      now,
      now,
    ),
    ...tags.map((t) => env.DB.prepare("INSERT INTO feedback_tags (feedback_id, tag) VALUES (?, ?)").bind(id, t)),
  ]);
  const stored = await storePost(env, (await feedbackById(env, id))!, caller, post, "post");
  const similar = group ? [] : (await similarTopics(env, caller, `${title} ${post.text}`)).filter((t) => t.id !== id);
  return {
    ...(await getTopic(env, caller, id)),
    // Topics and known issues that look like the same thing: if one is, vote there or reply.
    similar,
    ...(stored.check === "pending" ? { note: "Others see it once it's checked, usually within minutes." } : stored.check === "held" ? { note: "A person at Zaisma checks it before others see it, usually within a day." } : {}),
    ...(post.blanked ? { secrets_removed: post.blanked } : {}),
  };
}

/** A reply to the topic, or to one post in it (reply_to). reopen: true reopens your own closed topic. */
export async function replyTo(env: Env, caller: Caller, id: string, body: Record<string, unknown>) {
  const f = await readable(env, caller, id);
  const reopen = body.reopen === true;
  if (reopen && f.account_id !== caller.accountId) throw new ApiError(403, "not_yours", "Only the developer who posted a topic can reopen it. Reply, or vote.");
  if (reopen && !FEEDBACK_CLOSED.includes(f.status)) throw new ApiError(400, "not_closed", `It's ${f.status}, not closed, so there's nothing to reopen. Just reply.`);
  let replyTo: string | null = null;
  if (typeof body.reply_to === "string" && body.reply_to) {
    const to = await env.DB.prepare("SELECT * FROM feedback_posts WHERE id = ? AND feedback_id = ?").bind(body.reply_to, f.id).first<FeedbackPost>();
    if (!to || !canSeePost(f, to, caller)) throw new ApiError(404, "no_post", "reply_to is a post in this topic.");
    replyTo = to.id;
  }
  const post = await readPost(env, caller, body);
  const stored = await storePost(env, f, caller, post, reopen ? "reopen" : "post", replyTo);
  await env.DB.prepare(`UPDATE feedback SET updated_at = ?${reopen ? ", status = 'new'" : ""} WHERE id = ?`).bind(Date.now(), f.id).run();
  const { posts } = await getTopic(env, caller, f.id);
  return {
    post: posts.find((p) => p.id === stored.id) ?? null,
    ...(stored.check === "pending" ? { note: "Others see it once it's checked, usually within minutes." } : stored.check === "held" ? { note: "A person at Zaisma checks it before others see it, usually within a day." } : {}),
    ...(post.blanked ? { secrets_removed: post.blanked } : {}),
  };
}

/** A vote on someone else's public topic: it affects you too, you want it, or you have the question too. You follow it. */
export async function vote(env: Env, caller: Caller, id: string, on: boolean) {
  const f = await readable(env, caller, id);
  if (!f.public || f.account_id === caller.accountId) throw new ApiError(400, "cant_vote", "Votes are for public topics someone else started.");
  if (f.kind === "talk") throw new ApiError(400, "cant_vote", "Discussions take replies, not votes.");
  const now = Date.now();
  const change = on
    ? await env.DB.prepare("INSERT OR IGNORE INTO feedback_votes (feedback_id, account_id, created_at) VALUES (?, ?, ?)").bind(f.id, caller.accountId, now).run()
    : await env.DB.prepare("DELETE FROM feedback_votes WHERE feedback_id = ? AND account_id = ?").bind(f.id, caller.accountId).run();
  if (change.meta.changes) await env.DB.prepare(`UPDATE feedback SET votes = MAX(0, votes ${on ? "+" : "-"} 1) WHERE id = ?`).bind(f.id).run();
  if (on) await env.DB.prepare("INSERT OR IGNORE INTO feedback_follows (feedback_id, account_id, seen_at) VALUES (?, ?, ?)").bind(f.id, caller.accountId, now).run();
  const row = await env.DB.prepare("SELECT votes FROM feedback WHERE id = ?").bind(f.id).first<{ votes: number }>();
  return { votes: row?.votes ?? 0, voted: on };
}

/** It's in the wrong category: Zaisma's AI looks at where it belongs on its next run and moves it, saying so in the topic. */
export async function flagMisplaced(env: Env, caller: Caller, id: string) {
  const f = await readable(env, caller, id);
  if (!f.shown || f.group_id) throw new ApiError(400, "cant_flag", "Only public topics others can see can be flagged as misplaced.");
  await env.DB.prepare("INSERT OR IGNORE INTO feedback_misplaced (feedback_id, account_id, created_at) VALUES (?, ?, ?)").bind(f.id, caller.accountId, Date.now()).run();
  return { flagged: true };
}

/**
 * A known issue whose fix is out (released) still happens: it goes back to fixing, everyone in it
 * hears, and Zaisma gets an alert. Once per fix, however many say so; with text, it's also a reply.
 */
export async function stillHappening(env: Env, caller: Caller, id: string, body: Record<string, unknown>) {
  const f = await readable(env, caller, id);
  if (!f.known_title || f.status !== "released") throw new ApiError(400, "not_released", "Only a known issue whose fix is out (released) can be reported as still happening. Reply, or message Zaisma.");
  const reply = typeof body.text === "string" && body.text.trim() ? await replyTo(env, caller, f.id, { text: body.text, ...(body.context ? { context: body.context } : {}) }) : null;
  await decideFeedback(env, f.id, { status: "fixing", reply: "A developer says it still happens after the fix, so Zaisma is working on it again." });
  await sendAlert(env, `Still happening after the fix: ${f.known_title}`, `A developer says the known issue still happens after its fix was released. It's back to fixing.\n\nOpen: ${env.SITE_ORIGIN}/admin/feedback/${f.id}`);
  return { status: "fixing", ...(reply?.post ? { post: reply.post } : {}) };
}

async function visiblePost(env: Env, caller: Caller, topicId: string, postId: string): Promise<{ f: Feedback; p: FeedbackPost }> {
  const f = await readable(env, caller, topicId);
  const p = await env.DB.prepare("SELECT * FROM feedback_posts WHERE id = ? AND feedback_id = ?").bind(postId, f.id).first<FeedbackPost>();
  if (!p || p.check_state !== "ok") throw new ApiError(404, "no_post", "There's no post with that id others can see in this topic.");
  return { f, p };
}

/** Someone else's reply helped: it shows how many found it helpful. No dislikes: a wrong reply gets a better one, a harmful one a report. */
export async function markHelpful(env: Env, caller: Caller, topicId: string, postId: string, on: boolean) {
  const { p } = await visiblePost(env, caller, topicId, postId);
  if (p.account_id === caller.accountId && p.author !== "zaisma") throw new ApiError(400, "cant_mark", "Helpful is for other people's posts.");
  const change = on
    ? await env.DB.prepare("INSERT OR IGNORE INTO feedback_helpful (post_id, account_id, created_at) VALUES (?, ?, ?)").bind(p.id, caller.accountId, Date.now()).run()
    : await env.DB.prepare("DELETE FROM feedback_helpful WHERE post_id = ? AND account_id = ?").bind(p.id, caller.accountId).run();
  if (change.meta.changes) await env.DB.prepare(`UPDATE feedback_posts SET helpful = MAX(0, helpful ${on ? "+" : "-"} 1) WHERE id = ?`).bind(p.id).run();
  const row = await env.DB.prepare("SELECT helpful FROM feedback_posts WHERE id = ?").bind(p.id).first<{ helpful: number }>();
  return { helpful: row?.helpful ?? 0, helpful_by_you: on };
}

/**
 * A post that shouldn't be here. A person at Zaisma looks; it's hidden at once when it puts a young
 * person at risk (and Zaisma is alerted), or once FORUM_REPORTS_TO_HIDE developers have reported it.
 */
export async function reportPost(env: Env, caller: Caller, topicId: string, postId: string, body: Record<string, unknown>) {
  const { p } = await visiblePost(env, caller, topicId, postId);
  const reason = String(body.reason ?? "") as ForumReportReason;
  if (!(reason in FORUM_REPORT_REASONS)) throw new ApiError(400, "bad_reason", `reason is one of: ${Object.keys(FORUM_REPORT_REASONS).join(", ")}.`);
  if (p.author === "zaisma") throw new ApiError(400, "cant_report", "Zaisma's own posts can't be reported here. Message Zaisma instead.");
  if (p.account_id === caller.accountId) throw new ApiError(400, "cant_report", "That's your own post.");
  const details = typeof body.details === "string" ? body.details.trim().slice(0, 1000) : "";
  await env.DB.prepare("INSERT OR REPLACE INTO forum_reports (post_id, account_id, reason, details, created_at) VALUES (?, ?, ?, ?, ?)").bind(p.id, caller.accountId, reason, details || null, Date.now()).run();
  const count = (await env.DB.prepare("SELECT COUNT(*) AS n FROM forum_reports WHERE post_id = ?").bind(p.id).first<{ n: number }>())?.n ?? 0;
  const hidden = reason === "child_safety" || count >= FORUM_REPORTS_TO_HIDE;
  if (hidden) await hidePost(env, p.id, `Reported: ${FORUM_REPORT_REASONS[reason]}${count > 1 ? ` (${count} reports)` : ""}`);
  if (reason === "child_safety") await sendAlert(env, "Forum post reported: puts a young person at risk", `A forum post was reported as putting a young person at risk. It's hidden until you look.\n\nOpen: ${env.SITE_ORIGIN}/admin/feedback/${p.feedback_id}`);
  return { reported: true, hidden };
}

/** Follow a topic to hear about what's new in it (yours, ones you replied to and voted on are followed already). */
export async function follow(env: Env, caller: Caller, id: string, on: boolean) {
  const f = await readable(env, caller, id);
  if (on) await env.DB.prepare("INSERT OR IGNORE INTO feedback_follows (feedback_id, account_id, seen_at) VALUES (?, ?, ?)").bind(f.id, caller.accountId, Date.now()).run();
  else await env.DB.prepare("DELETE FROM feedback_follows WHERE feedback_id = ? AND account_id = ?").bind(f.id, caller.accountId).run();
  return { following: on };
}

/** The developer who asked marks the reply that answered their question (null clears it). */
export async function markAnswer(env: Env, caller: Caller, id: string, postId: string | null) {
  const f = await readable(env, caller, id);
  if (f.account_id !== caller.accountId || f.kind !== "question") throw new ApiError(403, "not_yours", "Only the developer who asked a question marks its answer.");
  if (postId) {
    const p = await env.DB.prepare("SELECT * FROM feedback_posts WHERE id = ? AND feedback_id = ?").bind(postId, f.id).first<FeedbackPost>();
    if (!p || p.check_state !== "ok") throw new ApiError(404, "no_post", "post is a reply in this topic that others can see.");
  }
  await env.DB.prepare("UPDATE feedback SET answer_post = ?, status = CASE WHEN ? IS NOT NULL THEN 'answered' WHEN status = 'answered' THEN 'new' ELSE status END, updated_at = ? WHERE id = ?")
    .bind(postId, postId, Date.now(), f.id)
    .run();
  return { answer: postId };
}

/**
 * An image in a post. Anyone who can see the post can see it: on a public topic once the post
 * passed its check, in a message only the developer (and Zaisma, on the admin pages).
 */
export async function serveMedia(env: Env, viewer: Viewer, mediaId: string): Promise<Response> {
  const m = await env.DB.prepare(
    "SELECT m.id, m.type, m.post_id, m.account_id AS uploader, p.check_state, p.account_id AS poster, f.shown, f.account_id AS owner FROM feedback_media m LEFT JOIN feedback_posts p ON p.id = m.post_id LEFT JOIN feedback f ON f.id = p.feedback_id WHERE m.id = ?",
  )
    .bind(mediaId)
    .first<{ id: string; type: string; post_id: string | null; uploader: string | null; check_state: string | null; poster: string | null; shown: number; owner: string | null }>();
  const open = Boolean(m?.post_id && m.check_state === "ok" && m.shown);
  // Not posted yet: its uploader's alone.
  const own = Boolean(m && viewer && (m.post_id ? m.poster === viewer.accountId || (m.check_state === null && m.owner === viewer.accountId) : m.uploader === viewer.accountId));
  const object = m && (open || own) ? await env.GAMES.get(feedbackMediaKey(m.id)) : null;
  if (!m || !object) throw new ApiError(404, "no_media", "There's no image there you can see.");
  return new Response(object.body, {
    headers: {
      "Content-Type": m.type,
      // Public images are cached briefly, so one taken down stops showing soon after.
      "Cache-Control": open ? "public, max-age=300" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

async function topicPicture(env: Env, caller: Caller, id: string, postId: string): Promise<Response> {
  const post = await env.DB.prepare("SELECT * FROM feedback_posts WHERE id = ? AND feedback_id = ?").bind(postId, id).first<FeedbackPost>();
  const object = post?.picture && post.account_id === caller.accountId ? await env.GAMES.get(feedbackPictureKey(post.id)) : null;
  if (!post?.picture || !object) throw new ApiError(404, "no_picture", "You have no screenshot there.");
  return new Response(object.body, {
    headers: { "Content-Type": post.picture, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" },
  });
}

/** How many topics the caller follows have something new since they last opened them. */
export async function unreadCount(env: Env, caller: Caller, messages = false): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM feedback_follows w JOIN feedback f ON f.id = w.feedback_id WHERE w.account_id = ? AND f.public = ${messages ? 0 : 1} AND COALESCE(f.active_at, f.updated_at) > w.seen_at`)
    .bind(caller.accountId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** For the pages: the known issues, newest first (the picker on a private report). */
export async function knownIssueTitles(env: Env): Promise<{ id: string; title: string }[]> {
  const { results } = await env.DB.prepare(`${KNOWN} AND shown = 1 ORDER BY active_at DESC LIMIT 200`).all<Feedback>();
  return results.map((k) => ({ id: k.id, title: k.known_title! }));
}
