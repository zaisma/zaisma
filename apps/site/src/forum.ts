import {
  FEEDBACK_AREAS,
  FEEDBACK_CLOSED,
  FEEDBACK_KINDS,
  FEEDBACK_LIMITS,
  FEEDBACK_PRIVATE_KINDS,
  FORUM_CATEGORIES,
  FORUM_TAGS,
  feedbackPictureKey,
  gameById,
  matchKnownIssues,
  newId,
  type Feedback,
  type FeedbackAuthor,
  type FeedbackKind,
  type FeedbackPost,
  type FeedbackStatus,
} from "@zaisma/core";
import { ApiError, ownGame, readJson, type Caller } from "./developer.ts";
import type { Env } from "./env.ts";
import { developersIn, feedbackById, hasNews, KNOWN, postsLeft, readPost, readTitle, storePost } from "./feedback.ts";

/**
 * The developer forum (docs/DECISIONS.md): every feedback item is a topic. Ideas, questions and
 * discussions are public, bugs and gaps start private to the developer and Zaisma, and known issues
 * are public topics of Zaisma's own. The forum pages, the MCP and API callers all use these:
 *
 *   GET  /api/dev/forum?q=&category=&kind=&tag=&tab=&page=   topics (tab: latest, top, unanswered, known, yours)
 *   GET  /api/dev/forum/similar?q=                          topics and known issues like a title, while writing one
 *   POST /api/dev/forum                                     a topic: { kind, title, text, category?, tags?, public?, game?, known_issue?, context?, author?, picture? }
 *   GET  /api/dev/forum/:id                                 a topic with its posts
 *   POST /api/dev/forum/:id/posts                           reply: { text, reply_to?, reopen?, context?, author?, picture? }
 *   POST /api/dev/forum/:id/vote                            a vote (affects me too, I want this, same question): { on }
 *   POST /api/dev/forum/:id/follow                          { on }
 *   POST /api/dev/forum/:id/answer                          your question's answer: { post } (null to clear)
 *   POST /api/dev/forum/:id/misplaced                       it's in the wrong category: Zaisma's AI moves it
 *   GET  /api/dev/forum/:id/pictures/:post                  a screenshot you attached
 *
 * Others see a public post once it passes the check (forum-check.ts). Screenshots and what an AI
 * attaches stay private to whoever posted them and Zaisma. Reading needs no account on the pages;
 * the API reads as the caller.
 */

/** Who's reading: an account, or nobody signed in (the pages only). */
export type Viewer = Caller | null;

export const FORUM_TABS = ["latest", "top", "unanswered", "known", "yours"] as const;
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
}

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
  /** Only for whoever posted it (and Zaisma). */
  context: unknown;
  picture_url: string | null;
  at: number;
}

export async function forumRoute(request: Request, env: Env, path: string, caller: Caller): Promise<[unknown, number?] | Response> {
  const method = request.method;
  const url = new URL(request.url);
  if (path === "/forum" && method === "GET") return [await listTopics(env, caller, queryFrom(url.searchParams))];
  if (path === "/forum/similar" && method === "GET") return [{ topics: await similarTopics(env, caller, url.searchParams.get("q") ?? "") }];
  if (path === "/forum" && method === "POST") return [await createTopic(env, caller, await readJson(request, 4 * 1024 * 1024)), 201];
  const m = path.match(/^\/forum\/([a-z0-9]{1,40})(?:\/(posts|vote|follow|answer|misplaced|pictures)(?:\/([a-z0-9]{1,40}))?)?$/);
  if (!m) throw new ApiError(404, "not_found", "No such API path.");
  const [, id, sub, postId] = m as unknown as [string, string, string | undefined, string | undefined];
  if (!sub && method === "GET") return [await getTopic(env, caller, id)];
  if (sub === "pictures" && postId && method === "GET") return topicPicture(env, caller, id, postId);
  if (method !== "POST" || postId) throw new ApiError(405, "bad_method", `${method} isn't used here.`);
  const body = await readJson(request, sub === "posts" ? 4 * 1024 * 1024 : 4096);
  if (sub === "posts") return [await replyTo(env, caller, id, body), 201];
  if (sub === "vote") return [await vote(env, caller, id, body.on !== false)];
  if (sub === "follow") return [await follow(env, caller, id, body.on !== false)];
  if (sub === "answer") return [await markAnswer(env, caller, id, typeof body.post === "string" ? body.post : null)];
  if (sub === "misplaced") return [await flagMisplaced(env, caller, id)];
  throw new ApiError(404, "not_found", "No such API path.");
}

export interface ForumQuery {
  q?: string;
  category?: string;
  kind?: string;
  tag?: string;
  tab?: string;
  page?: number;
}

export function queryFrom(p: URLSearchParams): ForumQuery {
  return { q: p.get("q") ?? "", category: p.get("category") ?? "", kind: p.get("kind") ?? "", tag: p.get("tag") ?? "", tab: p.get("tab") ?? "", page: Number(p.get("page") ?? 1) };
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
  if (tab === "yours" && !viewer) throw new ApiError(401, "signed_out", "Sign in to see your topics.");
  const page = Math.max(1, Math.min(1000, Math.floor(Number(query.page) || 1)));
  const where: string[] = [];
  const binds: unknown[] = [];
  if (tab === "yours") {
    where.push("(f.account_id = ? OR f.id IN (SELECT feedback_id FROM feedback_follows WHERE account_id = ?))");
    binds.push(viewer!.accountId, viewer!.accountId);
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
  const q = (query.q ?? "").trim().slice(0, 200);
  // Open known issues are pinned above the latest topics, so they aren't listed again below them.
  const pins = tab === "latest" && !q && !query.tag && (!query.kind || query.kind === "bug" || query.kind === "gap");
  if (pins) where.push("NOT (f.known_title IS NOT NULL AND f.status IN ('known', 'planned'))");
  // Every word, in the title or in a post others can see (or your own).
  for (const word of q.split(/\s+/).filter((w) => w.length >= 2).slice(0, 6)) {
    where.push("(f.title LIKE ? ESCAPE '\\' OR f.known_title LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM feedback_posts p WHERE p.feedback_id = f.id AND p.text LIKE ? ESCAPE '\\' AND (p.check_state = 'ok' OR p.account_id = ? OR f.account_id = ?)))");
    binds.push(like(word), like(word), like(word), viewer?.accountId ?? "", viewer?.accountId ?? "");
  }
  const order =
    tab === "top"
      ? "f.votes DESC, f.replies DESC, f.active_at DESC"
      : tab === "known"
        ? "CASE f.status WHEN 'known' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END, f.active_at DESC"
        : "COALESCE(f.active_at, f.updated_at) DESC";
  const { results } = await env.DB.prepare(`SELECT f.* FROM feedback f WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .bind(...binds, PAGE + 1, (page - 1) * PAGE)
    .all<Feedback>();
  const more = results.length > PAGE;
  const topics = await rowsJson(env, viewer, results.slice(0, PAGE));
  // Known issues in the category, pinned above the latest topics.
  let pinned: TopicRow[] = [];
  if (pins && page === 1) {
    const { results: known } = await env.DB.prepare(
      `SELECT * FROM feedback f WHERE f.shown = 1 AND f.group_id IS NULL AND f.known_title IS NOT NULL AND f.status IN ('known', 'planned')${areas.length ? ` AND f.area IN (${areas.map(() => "?").join(", ")})` : ""} ORDER BY f.votes DESC, f.active_at DESC LIMIT 5`,
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
  const { results } = await env.DB.prepare("SELECT * FROM feedback WHERE shown = 1 AND group_id IS NULL ORDER BY active_at DESC LIMIT 500").all<Feedback>();
  // Shared words: two are enough for a short title.
  return rowsJson(env, viewer, matchKnownIssues(q, results, 5));
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
  const [tags, posters, firsts, votes, follows, developers] = await Promise.all([
    env.DB.prepare(`SELECT feedback_id, tag FROM feedback_tags WHERE feedback_id IN (${marks})`).bind(...ids).all<{ feedback_id: string; tag: string }>(),
    env.DB.prepare(
      `SELECT feedback_id, account_id, author, MAX(created_at) AS at FROM feedback_posts WHERE feedback_id IN (${marks}) AND (check_state = 'ok' OR check_state IS NULL OR account_id = ?) GROUP BY feedback_id, account_id, author ORDER BY at DESC`,
    )
      .bind(...ids, me)
      .all<{ feedback_id: string; account_id: string | null; author: FeedbackAuthor }>(),
    env.DB.prepare(`SELECT p.feedback_id, p.author FROM feedback_posts p WHERE p.feedback_id IN (${marks}) AND p.rowid = (SELECT q.rowid FROM feedback_posts q WHERE q.feedback_id = p.feedback_id ORDER BY q.created_at, q.rowid LIMIT 1)`)
      .bind(...ids)
      .all<{ feedback_id: string; author: FeedbackAuthor }>(),
    me ? env.DB.prepare(`SELECT feedback_id FROM feedback_votes WHERE account_id = ? AND feedback_id IN (${marks})`).bind(me, ...ids).all<{ feedback_id: string }>() : { results: [] },
    me ? env.DB.prepare(`SELECT feedback_id, seen_at FROM feedback_follows WHERE account_id = ? AND feedback_id IN (${marks})`).bind(me, ...ids).all<{ feedback_id: string; seen_at: number }>() : { results: [] },
    developersIn(env, rows.filter((r) => r.known_title).map((r) => r.id)),
  ]);
  const names = await namesOf(env, [...rows.map((r) => r.account_id), ...posters.results.map((p) => p.account_id)]);
  const voted = new Set(votes.results.map((v) => v.feedback_id));
  const seen = new Map(follows.results.map((f) => [f.feedback_id, f.seen_at]));
  return rows.map((f) => {
    const firstBy = firsts.results.find((p) => p.feedback_id === f.id)?.author ?? (f.account_id ? "person" : "zaisma");
    const author = personOf(f.account_id, f.account_id ? firstBy : "zaisma", names, viewer);
    const people = posters.results
      .filter((p) => p.feedback_id === f.id && !(p.account_id === f.account_id && p.author === firstBy && f.account_id))
      .slice(0, 4)
      .map((p) => personOf(p.account_id, p.author, names, viewer));
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
      replies: f.replies,
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
export async function getTopic(env: Env, viewer: Viewer, id: string) {
  const f = await readable(env, viewer, id);
  const { results: all } = await env.DB.prepare("SELECT * FROM feedback_posts WHERE feedback_id = ? ORDER BY created_at, rowid LIMIT 1000").bind(f.id).all<FeedbackPost>();
  const posts = all.filter((p) => canSeePost(f, p, viewer));
  const names = await namesOf(env, posts.map((p) => p.account_id));
  const byId = new Map(posts.map((p) => [p.id, p]));
  const [row] = await rowsJson(env, viewer, [f]);
  const own = Boolean(viewer && f.account_id === viewer.accountId);
  const group = f.group_id ? await feedbackById(env, f.group_id) : null;
  const game = own && f.game_id ? await gameById(env.DB, f.game_id) : null;
  // Your own private report under a known issue.
  const yours = viewer && f.known_title ? await env.DB.prepare("SELECT id FROM feedback WHERE group_id = ? AND account_id = ? ORDER BY created_at LIMIT 1").bind(f.id, viewer.accountId).first<{ id: string }>() : null;
  const following = viewer ? await env.DB.prepare("SELECT seen_at FROM feedback_follows WHERE feedback_id = ? AND account_id = ?").bind(f.id, viewer.accountId).first<{ seen_at: number }>() : null;
  const flagged = viewer ? await env.DB.prepare("SELECT 1 AS y FROM feedback_misplaced WHERE feedback_id = ? AND account_id = ?").bind(f.id, viewer.accountId).first() : null;
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
        context: mine && p.context ? JSON.parse(p.context) : null,
        picture_url: mine && p.picture ? `${env.SITE_ORIGIN}/api/dev/forum/${f.id}/pictures/${p.id}` : null,
        at: p.created_at,
      } satisfies PostJson;
    }),
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
  if (!area && !group) throw new ApiError(400, "no_category", `Pick a category: one of ${FEEDBACK_AREAS.join(", ")} (other for anything else).`);
  const isPublic = group ? false : typeof body.public === "boolean" ? body.public : !FEEDBACK_PRIVATE_KINDS.includes(kind);
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
      group && (group.status === "known" || group.status === "planned") ? group.status : "new",
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

async function topicPicture(env: Env, caller: Caller, id: string, postId: string): Promise<Response> {
  const post = await env.DB.prepare("SELECT * FROM feedback_posts WHERE id = ? AND feedback_id = ?").bind(postId, id).first<FeedbackPost>();
  const object = post?.picture && post.account_id === caller.accountId ? await env.GAMES.get(feedbackPictureKey(post.id)) : null;
  if (!post?.picture || !object) throw new ApiError(404, "no_picture", "You have no screenshot there.");
  return new Response(object.body, {
    headers: { "Content-Type": post.picture, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" },
  });
}

/** How many topics the caller follows have something new since they last opened them. */
export async function unreadCount(env: Env, caller: Caller): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback_follows w JOIN feedback f ON f.id = w.feedback_id WHERE w.account_id = ? AND COALESCE(f.active_at, f.updated_at) > w.seen_at")
    .bind(caller.accountId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** For the pages: the known issues, newest first (the picker on a private report). */
export async function knownIssueTitles(env: Env): Promise<{ id: string; title: string }[]> {
  const { results } = await env.DB.prepare(`${KNOWN} AND shown = 1 ORDER BY active_at DESC LIMIT 200`).all<Feedback>();
  return results.map((k) => ({ id: k.id, title: k.known_title! }));
}
