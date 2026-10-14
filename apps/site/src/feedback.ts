import {
  FEEDBACK_AREAS,
  FEEDBACK_CLOSED,
  FEEDBACK_KINDS,
  FEEDBACK_LIMITS,
  blankSecrets,
  feedbackPictureKey,
  gameById,
  matchKnownIssues,
  newId,
  sniffImage,
  type Feedback,
  type FeedbackAuthor,
  type FeedbackKind,
  type FeedbackPost,
  type FeedbackTriage,
  type FeedbackVia,
} from "@zaisma/core";
import { ApiError, ownGame, readJson, type Caller } from "./developer.ts";
import type { Env } from "./env.ts";
import { checkPost } from "./forum-check.ts";

/**
 * Feedback about Zaisma itself, from developers and their AI (docs/DECISIONS.md). These are the
 * first calls, kept as they were for the upload command and older clients; the developer forum's
 * calls (forum.ts) reach the same topics, public ones included. Part of the developer API, so the
 * MCP, the upload command and the forum see exactly the same thing:
 *
 *   GET  /api/dev/feedback?q=&since=           your items and the known issues (q: search, since: changed after)
 *   POST /api/dev/feedback                     file one: { kind, title, text, game?, context?, author?, picture? }
 *   GET  /api/dev/feedback/:id                 one of your items with every post, or a known issue
 *   POST /api/dev/feedback/:id/posts           add to it: { text, context?, author?, picture?, reopen? }
 *   GET  /api/dev/feedback/:id/pictures/:post  a screenshot you attached
 *
 * Adding to a known issue that isn't yours files your own item under it, so your case counts and
 * you hear when it's fixed, while your words stay private to you and Zaisma.
 */

const DAY = 86400_000;
export const KNOWN = "SELECT * FROM feedback WHERE known_title IS NOT NULL AND group_id IS NULL";

/** Who wrote a post, from what the server knows: the MCP is always an AI, the dashboard and forum pages are the developer, and API callers say (AI unless told otherwise). */
export function authorOf(caller: Caller, body: Record<string, unknown>): { author: FeedbackAuthor; via: FeedbackVia } {
  if (caller.via === "mcp") return { author: "ai", via: "mcp" };
  if (caller.via === "dashboard") return { author: "person", via: "dashboard" };
  return { author: body.author === "person" ? "person" : "ai", via: caller.client === "cli" ? "cli" : "api" };
}

export async function feedbackRoute(request: Request, env: Env, path: string, caller: Caller): Promise<[unknown, number?] | Response> {
  const method = request.method;
  if (path === "/feedback" && method === "GET") {
    const url = new URL(request.url);
    return [await feedbackList(env, caller, url.searchParams.get("q") ?? "", Number(url.searchParams.get("since") ?? 0))];
  }
  if (path === "/feedback" && method === "POST") return [await fileFeedback(env, caller, await readJson(request, 4 * 1024 * 1024)), 201];

  const m = path.match(/^\/feedback\/([a-z0-9]{1,40})(?:\/(posts|pictures)(?:\/([a-z0-9]{1,40}))?)?$/);
  if (!m) throw new ApiError(404, "not_found", "No such API path.");
  const [, id, sub, postId] = m as unknown as [string, string, string | undefined, string | undefined];
  if (!sub && method === "GET") return [await feedbackItem(env, caller, id)];
  if (sub === "posts" && !postId && method === "POST") return [await addToFeedback(env, caller, id, await readJson(request, 4 * 1024 * 1024)), 201];
  if (sub === "pictures" && postId && method === "GET") return feedbackPicture(env, caller, id, postId);
  throw new ApiError(405, "bad_method", `${method} isn't used here.`);
}

export async function feedbackById(env: Env, id: string): Promise<Feedback | null> {
  return env.DB.prepare("SELECT * FROM feedback WHERE id = ?").bind(id).first<Feedback>();
}

/** One of the caller's own items. Someone else's item looks the same as no item. */
async function ownFeedback(env: Env, caller: Caller, id: string): Promise<Feedback> {
  const f = await feedbackById(env, id);
  if (!f || f.account_id !== caller.accountId) throw new ApiError(404, "no_feedback", "You have no feedback with that id. GET /feedback (or search_forum) lists yours and the known issues.");
  return f;
}

/** How many developers a known issue affects: the people with an item in it, and those who said "Me too". */
export async function developersIn(env: Env, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  // D1 takes at most 100 values per query: three per id.
  for (let i = 0; i < ids.length; i += 30) {
    const chunk = ids.slice(i, i + 30);
    const marks = chunk.map(() => "?").join(", ");
    const { results } = await env.DB.prepare(
      `SELECT issue, COUNT(DISTINCT who) AS n FROM (
         SELECT COALESCE(group_id, id) AS issue, account_id AS who FROM feedback WHERE account_id IS NOT NULL AND (id IN (${marks}) OR group_id IN (${marks}))
         UNION SELECT feedback_id, account_id FROM feedback_votes WHERE feedback_id IN (${marks})
       ) GROUP BY issue`,
    )
      .bind(...chunk, ...chunk, ...chunk)
      .all<{ issue: string; n: number }>();
    for (const r of results) out.set(r.issue, r.n);
  }
  return out;
}

function knownJson(k: Feedback, developers: number, yours: string | null) {
  return {
    id: k.id,
    title: k.known_title,
    kind: k.kind,
    status: k.status,
    area: k.area || null,
    // What to do until it's fixed.
    workaround: k.workaround,
    // The roadmap item it belongs to (docs/ROADMAP.md), when there is one.
    roadmap: k.roadmap,
    developers,
    // Your own item about it, if you have one.
    yours,
    updated_at: k.updated_at,
  };
}

async function knownIssues(env: Env, caller: Caller, list: Feedback[]) {
  const counts = await developersIn(env, list.map((k) => k.id));
  const mine = list.length ? (await env.DB.prepare("SELECT id, group_id FROM feedback WHERE account_id = ?").bind(caller.accountId).all<{ id: string; group_id: string | null }>()).results : [];
  return list.map((k) => knownJson(k, counts.get(k.id) ?? 0, mine.find((f) => f.id === k.id || f.group_id === k.id)?.id ?? null));
}

async function feedbackList(env: Env, caller: Caller, q: string, since: number) {
  const after = Number.isFinite(since) && since > 0 ? since : 0;
  const [{ results: mine }, { results: known }] = await Promise.all([
    env.DB.prepare("SELECT * FROM feedback WHERE account_id = ? AND updated_at > ? ORDER BY updated_at DESC LIMIT 200").bind(caller.accountId, after).all<Feedback>(),
    env.DB.prepare(`${KNOWN} AND updated_at > ? ORDER BY updated_at DESC LIMIT 500`).bind(after).all<Feedback>(),
  ]);
  const query = q.trim().slice(0, 500);
  const shownKnown = query ? matchKnownIssues(query, known, 10) : known.slice(0, 100);
  const groups = new Map((await Promise.all([...new Set(mine.map((f) => f.group_id).filter((g): g is string => Boolean(g)))].map((g) => feedbackById(env, g)))).filter((g): g is Feedback => g !== null).map((g) => [g.id, g]));
  const shownMine = query ? mine.filter((f) => matchKnownIssues(query, [f], 1).length || f.title.toLowerCase().includes(query.toLowerCase())) : mine;
  return {
    mine: await Promise.all(shownMine.map(async (f) => summaryJson(env, f, f.group_id ? (groups.get(f.group_id) ?? null) : null))),
    known_issues: await knownIssues(env, caller, shownKnown),
    // Your items with a reply or change from Zaisma you haven't opened yet.
    news: mine.filter(hasNews).length,
    // Pass this as since next time to get only what changed after this call.
    next_since: Math.max(after, ...mine.map((f) => f.updated_at), ...known.map((k) => k.updated_at)),
  };
}

export const hasNews = (f: Feedback) => Boolean(f.news_at && f.news_at > (f.seen_at ?? 0));

async function summaryJson(env: Env, f: Feedback, group: Feedback | null) {
  const game = f.game_id ? await gameById(env.DB, f.game_id) : null;
  const known = f.known_title ? f : group?.known_title ? group : null;
  return {
    id: f.id,
    kind: f.kind,
    title: f.title,
    status: f.status,
    game: game?.slug ?? null,
    known_issue: known ? { id: known.id, title: known.known_title, status: known.status, workaround: known.workaround, roadmap: known.roadmap } : null,
    news: hasNews(f),
    created_at: f.created_at,
    updated_at: f.updated_at,
  };
}

const BY: Record<FeedbackAuthor, string> = { person: "you", ai: "your AI", zaisma: "Zaisma" };

function postJson(env: Env, f: Feedback, p: FeedbackPost) {
  return {
    id: p.id,
    // you (written by the developer), your AI, or Zaisma.
    by: BY[p.author],
    via: p.via,
    kind: p.kind,
    text: p.text,
    context: p.context ? JSON.parse(p.context) : null,
    picture_url: p.picture ? `${env.SITE_ORIGIN}/api/dev/feedback/${f.id}/pictures/${p.id}` : null,
    at: p.created_at,
  };
}

async function itemJson(env: Env, caller: Caller, f: Feedback) {
  const group = f.group_id ? await feedbackById(env, f.group_id) : null;
  const { results: posts } = await env.DB.prepare("SELECT * FROM feedback_posts WHERE feedback_id = ? ORDER BY created_at, rowid").bind(f.id).all<FeedbackPost>();
  const known = f.known_title ? f : group?.known_title ? group : null;
  return {
    ...(await summaryJson(env, f, group)),
    known_issue: known ? (await knownIssues(env, caller, [known]))[0] : null,
    posts: posts.map((p) => postJson(env, f, p)),
    posts_left_today: await postsLeft(env, caller),
  };
}

/** One of your items in full (and it no longer counts as news), or a known issue anyone can see. */
async function feedbackItem(env: Env, caller: Caller, id: string) {
  const f = await feedbackById(env, id);
  if (f && f.account_id === caller.accountId) {
    if (hasNews(f)) await env.DB.prepare("UPDATE feedback SET seen_at = ? WHERE id = ?").bind(Date.now(), f.id).run();
    return { feedback: await itemJson(env, caller, f) };
  }
  if (f?.known_title) return { known_issue: (await knownIssues(env, caller, [f]))[0] };
  throw new ApiError(404, "no_feedback", "You have no feedback with that id, and it isn't a known issue. GET /feedback (or search_forum) lists yours and the known issues.");
}

export async function postsLeft(env: Env, caller: Caller): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback_posts WHERE account_id = ? AND created_at > ?").bind(caller.accountId, Date.now() - DAY).first<{ n: number }>();
  return Math.max(0, FEEDBACK_LIMITS.postsPerDay - (row?.n ?? 0));
}

export interface Post {
  text: string;
  context: string | null;
  picture: { bytes: Uint8Array; type: string } | null;
  author: FeedbackAuthor;
  via: FeedbackVia;
  blanked: number;
}

/** Checks a post and blanks its secrets, before anything is stored. */
export async function readPost(env: Env, caller: Caller, body: Record<string, unknown>): Promise<Post> {
  if ((await postsLeft(env, caller)) <= 0) {
    throw new ApiError(429, "feedback_limit", `You've posted ${FEEDBACK_LIMITS.postsPerDay} times in the last day, the most for one account. Add to an existing item tomorrow, or write to us if something is urgent.`);
  }
  const raw = typeof body.text === "string" ? body.text.trim() : "";
  if (!raw || raw.length > FEEDBACK_LIMITS.text) throw new ApiError(400, "bad_text", `Say what happened in 1 to ${FEEDBACK_LIMITS.text} characters.`);
  const text = blankSecrets(raw);
  let context: string | null = null;
  let blanked = text.blanked;
  if (body.context !== undefined && body.context !== null) {
    const json = JSON.stringify(body.context);
    if (json.length > FEEDBACK_LIMITS.context) throw new ApiError(400, "bad_context", `Context can be up to ${FEEDBACK_LIMITS.context} characters of JSON. Keep the error and the call that failed; leave out whole files.`);
    const clean = blankSecrets(json);
    blanked += clean.blanked;
    try {
      context = JSON.stringify(JSON.parse(clean.text));
    } catch {
      // Blanking can split a JSON string; keep it as text then.
      context = JSON.stringify({ text: clean.text });
    }
  }
  let picture: Post["picture"] = null;
  if (typeof body.picture === "string" && body.picture) {
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(body.picture.replace(/^data:[^,]*,/, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
    } catch {
      throw new ApiError(400, "bad_picture", "Send the screenshot as base64.");
    }
    if (bytes.byteLength > FEEDBACK_LIMITS.pictureBytes) throw new ApiError(413, "picture_too_big", `Screenshots can be up to ${FEEDBACK_LIMITS.pictureBytes / 1048576} MB.`);
    const kind = sniffImage(bytes);
    if (!kind) throw new ApiError(415, "not_an_image", "Screenshots can be PNG, JPEG or WebP.");
    picture = { bytes, type: kind.type };
  }
  return { text: text.text, context, picture, blanked, ...authorOf(caller, body) };
}

/**
 * Stores a post. On a private topic it's there at once for the developer and Zaisma; on a public one
 * it's checked first, and others see it once it passes (forum-check.ts).
 */
export async function storePost(env: Env, f: Feedback, caller: Caller, post: Post, kind: "post" | "reopen", replyTo: string | null = null): Promise<{ id: string; check: FeedbackPost["check_state"] }> {
  const id = newId();
  const now = Date.now();
  if (post.picture) await env.GAMES.put(feedbackPictureKey(id), post.picture.bytes, { httpMetadata: { contentType: post.picture.type } });
  await env.DB.prepare("INSERT INTO feedback_posts (id, feedback_id, account_id, author, via, kind, text, context, picture, created_at, reply_to, check_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, f.id, caller.accountId, post.author, post.via, kind, post.text, post.context, post.picture?.type ?? null, now, replyTo, f.public ? "pending" : null)
    .run();
  // Whoever posts follows the topic, and has seen it up to now.
  await env.DB.prepare("INSERT INTO feedback_follows (feedback_id, account_id, seen_at) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET seen_at = excluded.seen_at").bind(f.id, caller.accountId, now).run();
  if (!f.public) {
    await env.DB.prepare("UPDATE feedback SET active_at = ? WHERE id = ?").bind(now, f.id).run();
    return { id, check: null };
  }
  return { id, check: await checkPost(env, id) };
}

export function readTitle(body: Record<string, unknown>): string {
  const title = typeof body.title === "string" ? body.title.trim().replace(/\s+/g, " ") : "";
  if (!title || title.length > FEEDBACK_LIMITS.title) throw new ApiError(400, "bad_title", `Give it a title of 1 to ${FEEDBACK_LIMITS.title} characters.`);
  return blankSecrets(title).text;
}

/** A new item, answered at once with the known issues that look like the same problem. */
async function fileFeedback(env: Env, caller: Caller, body: Record<string, unknown>) {
  const kind = body.kind as FeedbackKind;
  if (!FEEDBACK_KINDS.includes(kind)) throw new ApiError(400, "bad_kind", `kind is one of: ${FEEDBACK_KINDS.join(", ")}.`);
  const title = readTitle(body);
  const game = typeof body.game === "string" && body.game ? await ownGame(env, body.game, caller) : null;
  let group: Feedback | null = null;
  if (typeof body.known_issue === "string" && body.known_issue) {
    group = await feedbackById(env, body.known_issue);
    if (!group?.known_title) throw new ApiError(404, "no_known_issue", "There's no known issue with that id. GET /feedback (or search_forum) lists them.");
  }
  const post = await readPost(env, caller, body);
  const id = newId();
  const now = Date.now();
  const area = typeof body.category === "string" && (FEEDBACK_AREAS as string[]).includes(body.category) ? body.category : (group?.area ?? "");
  await env.DB.prepare("INSERT INTO feedback (id, account_id, kind, title, game_id, status, group_id, area, created_at, updated_at, active_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, caller.accountId, kind, title, game?.id ?? null, group && (group.status === "known" || group.status === "planned") ? group.status : "new", group?.id ?? null, area, now, now, now)
    .run();
  await storePost(env, (await feedbackById(env, id))!, caller, post, "post");
  const { results: known } = group ? { results: [] } : await env.DB.prepare(`${KNOWN} ORDER BY updated_at DESC LIMIT 500`).all<Feedback>();
  const matches = matchKnownIssues(`${title} ${post.text}`, known);
  return {
    feedback: await itemJson(env, caller, (await feedbackById(env, id))!),
    // Known issues that look like the same problem, with what to do until they're fixed. If one is
    // yours, Zaisma merges them; you can also add to it straight away.
    matches: await knownIssues(env, caller, matches),
    ...(post.blanked ? { secrets_removed: post.blanked } : {}),
  };
}

/**
 * Add to one of your items (reopen: true reopens a fixed, answered or won't-change one), or add your
 * case to a known issue: that files your own item under it, or adds to the one you already have.
 */
async function addToFeedback(env: Env, caller: Caller, id: string, body: Record<string, unknown>) {
  let f = await feedbackById(env, id);
  if (f && f.account_id !== caller.accountId) {
    if (!f.known_title) f = null;
    else {
      const yours = await env.DB.prepare("SELECT * FROM feedback WHERE account_id = ? AND (group_id = ? OR id = ?) ORDER BY created_at LIMIT 1").bind(caller.accountId, f.id, f.id).first<Feedback>();
      if (!yours) return fileFeedback(env, caller, { ...body, kind: f.kind, title: f.known_title, known_issue: f.id });
      f = yours;
    }
  }
  if (!f) throw new ApiError(404, "no_feedback", "You have no feedback with that id, and it isn't a known issue. GET /feedback (or search_forum) lists yours and the known issues.");
  const reopen = body.reopen === true;
  if (reopen && !FEEDBACK_CLOSED.includes(f.status)) throw new ApiError(400, "not_closed", `It's ${f.status}, not closed, so there's nothing to reopen. Just add to it.`);
  const post = await readPost(env, caller, body);
  await storePost(env, f, caller, post, reopen ? "reopen" : "post");
  await env.DB.prepare(`UPDATE feedback SET updated_at = ?${reopen ? ", status = 'new'" : ""} WHERE id = ?`).bind(Date.now(), f.id).run();
  return { feedback: await itemJson(env, caller, (await feedbackById(env, f.id))!), ...(post.blanked ? { secrets_removed: post.blanked } : {}) };
}

async function feedbackPicture(env: Env, caller: Caller, id: string, postId: string): Promise<Response> {
  const f = await ownFeedback(env, caller, id);
  const post = await env.DB.prepare("SELECT * FROM feedback_posts WHERE id = ? AND feedback_id = ?").bind(postId, f.id).first<FeedbackPost>();
  const object = post?.picture ? await env.GAMES.get(feedbackPictureKey(post.id)) : null;
  if (!post?.picture || !object) throw new ApiError(404, "no_picture", "That post has no screenshot.");
  return new Response(object.body, {
    headers: {
      "Content-Type": post.picture,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

/** For account deletion: the files of the account's screenshots (the rows go with deleteAccount). */
export async function deleteFeedbackPictures(env: Env, accountId: string): Promise<void> {
  const { results } = await env.DB.prepare("SELECT id FROM feedback_posts WHERE account_id = ? AND picture IS NOT NULL").bind(accountId).all<{ id: string }>();
  for (let i = 0; i < results.length; i += 500) await env.GAMES.delete(results.slice(i, i + 500).map((p) => feedbackPictureKey(p.id)));
}

// --- Admin: the feedback queue in the admin MCP ---

const ADMIN_BY: Record<FeedbackAuthor, string> = { person: "the developer", ai: "the developer's AI", zaisma: "Zaisma" };
const SEVERITY_NAMES = ["", "urgent", "high", "normal", "low"];
const iso = (ms: number | null) => (ms ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC" : null);

async function accountName(env: Env, id: string | null): Promise<string> {
  const name = id ? (await env.DB.prepare("SELECT name FROM accounts WHERE id = ?").bind(id).first<{ name: string }>())?.name : null;
  return name ?? "(account deleted)";
}

async function latestPost(env: Env, feedbackId: string, max: number) {
  const p = await env.DB.prepare("SELECT author, text FROM feedback_posts WHERE feedback_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").bind(feedbackId).first<{ author: FeedbackAuthor; text: string }>();
  return p ? { by: ADMIN_BY[p.author], text: p.text.slice(0, max) } : null;
}

/**
 * Items on their own and known issues (the first item of a merged group), most serious first. With
 * status "new" (the default) it also lists items someone added to or reopened inside a group that
 * isn't new any more.
 */
export async function adminFeedbackList(env: Env, status = "new", limit = 30) {
  const stmt = env.DB.prepare(`SELECT * FROM feedback WHERE group_id IS NULL${status === "all" ? "" : " AND status = ?"} ORDER BY severity, created_at LIMIT ?`);
  const { results: leads } = await (status === "all" ? stmt.bind(limit) : stmt.bind(status, limit)).all<Feedback>();
  const counts = await developersIn(env, leads.map((l) => l.id));
  const rows = await Promise.all(
    leads.map(async (f) => {
      const stats = await env.DB
        .prepare("SELECT COUNT(*) AS posts, MAX(created_at) AS last FROM feedback_posts WHERE feedback_id IN (SELECT id FROM feedback WHERE id = ? OR group_id = ?)")
        .bind(f.id, f.id)
        .first<{ posts: number; last: number | null }>();
      return {
        id: f.id,
        kind: f.kind,
        title: f.title,
        known_issue: f.known_title,
        public: f.public === 1,
        status: f.status,
        severity: SEVERITY_NAMES[f.severity] ?? "normal",
        area: f.area || null,
        developers: counts.get(f.id) ?? 0,
        posts: stats?.posts ?? 0,
        game: f.game_id ? ((await gameById(env.DB, f.game_id))?.slug ?? null) : null,
        filed: iso(f.created_at),
        last_post: iso(stats?.last ?? null),
        latest: await latestPost(env, f.id, 300),
        sorted: sortedJson(f),
      };
    }),
  );
  const out: { feedback: typeof rows; reopened_or_added?: { id: string; title: string; group_id: string; group_status: string }[]; posts_to_check?: Awaited<ReturnType<typeof postsToCheck>> } = { feedback: rows };
  if (status === "new") {
    const { results } = await env.DB
      .prepare("SELECT f.id, f.title, f.group_id, g.status AS group_status FROM feedback f JOIN feedback g ON g.id = f.group_id WHERE f.status = 'new' AND g.status != 'new' ORDER BY f.updated_at DESC LIMIT 50")
      .all<{ id: string; title: string; group_id: string; group_status: string }>();
    out.reopened_or_added = results;
    out.posts_to_check = await postsToCheck(env, 50);
  }
  return out;
}

/**
 * Forum posts others can't see yet: held by the check (with why), or not checked yet because the AI
 * couldn't. A person shows or removes each one (check_post in the admin MCP).
 */
export async function postsToCheck(env: Env, limit = 50) {
  const { results } = await env.DB.prepare(
    "SELECT p.*, f.title AS topic_title, f.known_title AS topic_known FROM feedback_posts p JOIN feedback f ON f.id = p.feedback_id WHERE p.check_state IN ('held', 'pending') ORDER BY p.check_state = 'held' DESC, p.created_at LIMIT ?",
  )
    .bind(limit)
    .all<FeedbackPost & { topic_title: string; topic_known: string | null }>();
  return Promise.all(
    results.map(async (p) => ({
      id: p.id,
      topic: { id: p.feedback_id, title: p.topic_known ?? p.topic_title },
      state: p.check_state === "held" ? "held" : "not checked yet",
      why: p.check_reason,
      developer: await accountName(env, p.account_id),
      by: ADMIN_BY[p.author],
      text: p.text.slice(0, 2000),
      at: iso(p.created_at),
    })),
  );
}

/** What AI sorting found: its summary, why, and a drafted known issue to approve with decide_feedback. */
function sortedJson(f: Feedback) {
  // Only new items on their own are sorted; known issues and grouped items never wait for it.
  if (!f.triage) return f.triaged_at || f.known_title || f.group_id || f.status !== "new" ? null : "not yet";
  const t = JSON.parse(f.triage) as FeedbackTriage;
  return { by_ai: t.ai, summary: t.summary, why: t.why, ...(t.merged_into ? { merged_into: t.merged_into } : {}), ...(t.same_as ? { looks_like: t.same_as } : {}), ...(t.draft ? { draft_known_issue: t.draft } : {}) };
}

/** One item in full: every post with who wrote it, the developer's name, the game and the rest of its group. */
export async function adminFeedbackItem(env: Env, id: string) {
  const f = await feedbackById(env, id);
  if (!f) return null;
  const lead = f.group_id ? await feedbackById(env, f.group_id) : null;
  const { results: posts } = await env.DB.prepare("SELECT * FROM feedback_posts WHERE feedback_id = ? ORDER BY created_at, rowid").bind(f.id).all<FeedbackPost>();
  const { results: members } = await env.DB.prepare("SELECT * FROM feedback WHERE group_id = ? ORDER BY created_at").bind(f.id).all<Feedback>();
  const game = f.game_id ? await gameById(env.DB, f.game_id) : null;
  const pictures = await Promise.all(
    posts
      .filter((p) => p.picture)
      .slice(-3)
      .map(async (p) => {
        const object = await env.GAMES.get(feedbackPictureKey(p.id));
        return object ? { data: toBase64(new Uint8Array(await object.arrayBuffer())), mimeType: p.picture! } : null;
      }),
  );
  return {
    data: {
      id: f.id,
      kind: f.kind,
      title: f.title,
      status: f.status,
      // A public forum topic every developer can read, or private to the developer and Zaisma.
      public: f.public === 1,
      severity: SEVERITY_NAMES[f.severity] ?? "normal",
      area: f.area || null,
      developer: f.account_id ? await accountName(env, f.account_id) : "Zaisma (a known issue)",
      game: game ? { slug: game.slug, title: game.title } : null,
      known_issue: f.known_title ? { title: f.known_title, workaround: f.workaround, roadmap: f.roadmap, developers: (await developersIn(env, [f.id])).get(f.id) ?? 0 } : null,
      merged_into: lead ? { id: lead.id, title: lead.known_title ?? lead.title, status: lead.status } : null,
      sorted: sortedJson(f),
      posts: posts.map((p) => ({
        id: p.id,
        by: ADMIN_BY[p.author],
        via: p.via,
        kind: p.kind,
        text: p.text,
        context: p.context ? JSON.parse(p.context) : null,
        picture: Boolean(p.picture),
        // On a public topic: shown, held by the check (with why) or not checked yet.
        ...(p.check_state ? { check: p.check_state === "ok" ? "shown" : p.check_state === "held" ? `held: ${p.check_reason ?? ""}` : "not checked yet" } : {}),
        ...(p.reply_to ? { reply_to: p.reply_to } : {}),
        at: iso(p.created_at),
      })),
      merged_here: await Promise.all(members.map(async (m) => ({ id: m.id, developer: await accountName(env, m.account_id), title: m.title, status: m.status, latest: await latestPost(env, m.id, 500) }))),
    },
    pictures: pictures.filter((p): p is { data: string; mimeType: string } => p !== null),
  };
}

export interface FeedbackDecision {
  status?: string;
  reply?: string;
  merge_into?: string;
  known_issue?: { title: string; workaround?: string; roadmap?: string } | null;
  severity?: number;
  area?: string;
  /** Marks a post in the topic as its answer (null clears it). */
  answer?: string | null;
  /** Decided by AI sorting, not a person: the developer is told so. */
  by_ai?: boolean;
}

export class FeedbackRefusal extends Error {}

/** Zaisma's own posts need no check: on a public topic everyone sees them at once. */
export async function zaismaPost(env: Env, feedbackId: string, kind: "post" | "status", text: string, at: number) {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO feedback_posts (id, feedback_id, account_id, author, via, kind, text, created_at, check_state) SELECT ?, id, NULL, 'zaisma', 'admin', ?, ?, ?, CASE WHEN public = 1 THEN 'ok' END FROM feedback WHERE id = ?").bind(newId(), kind, text, at, feedbackId),
    env.DB.prepare("UPDATE feedback SET updated_at = ?, news_at = ?, active_at = ?, replies = replies + public WHERE id = ?").bind(at, at, at, feedbackId),
  ]);
}

const STATUS_WORDS: Record<string, string> = {
  new: "Zaisma opened this again.",
  known: "Zaisma knows about this.",
  planned: "This is on Zaisma's roadmap.",
  fixed: "Zaisma fixed this.",
  wont: "Zaisma won't change this.",
  answered: "Zaisma answered this.",
};

/**
 * What the admin decided, in one call: a reply, a status (for a known issue, every item merged into
 * it too, and each developer hears), merging into a known issue, making an item a known issue (its
 * cleaned-up title, workaround and roadmap item, which every developer sees), severity, area and the
 * answer. A private report made a known issue becomes a public topic of Zaisma's own with the report
 * under it, so nothing the developer wrote in private is shown; the reply still goes to them alone.
 */
export async function decideFeedback(env: Env, id: string, d: FeedbackDecision): Promise<void> {
  let f = await feedbackById(env, id);
  if (!f) throw new FeedbackRefusal("No feedback with that id.");
  const at = Date.now();
  const status = d.status?.trim();
  if (status && !(status in STATUS_WORDS)) throw new FeedbackRefusal(`Status is one of: ${Object.keys(STATUS_WORDS).join(", ")}.`);
  const reply = d.reply?.trim().slice(0, FEEDBACK_LIMITS.text) ?? "";
  const group = async (leadId: string) => (await env.DB.prepare("SELECT id FROM feedback WHERE id = ? OR group_id = ?").bind(leadId, leadId).all<{ id: string }>()).results.map((r) => r.id);

  if (d.merge_into) {
    let target = await feedbackById(env, d.merge_into);
    if (target?.group_id) target = await feedbackById(env, target.group_id);
    if (!target || target.id === f.id) throw new FeedbackRefusal("Merge into another item: a known issue or the first item of a group.");
    // The item and everything already merged into it move under the target.
    await env.DB.batch([
      env.DB.prepare("UPDATE feedback SET group_id = ?, known_title = NULL, workaround = NULL, roadmap = NULL, updated_at = ? WHERE id = ?").bind(target.id, at, f.id),
      env.DB.prepare("UPDATE feedback SET group_id = ?, updated_at = ? WHERE group_id = ?").bind(target.id, at, f.id),
    ]);
    if (target.status !== "new" && f.status === "new") await env.DB.prepare("UPDATE feedback SET status = ? WHERE id = ?").bind(target.status, f.id).run();
    if (target.known_title) {
      const matched = d.by_ai ? `Zaisma's AI matched this to a known issue: ${target.known_title}.` : `Zaisma added this to a known issue: ${target.known_title}.`;
      const after = d.by_ai ? " If it's a different problem, add that here and a person will look." : "";
      await zaismaPost(env, f.id, "status", `${matched}${target.workaround ? ` Until it's fixed: ${target.workaround}` : ""}${after}`, at);
    }
    f = (await feedbackById(env, f.id))!;
  }

  // The developer the reply is for, when the decision moves on to a new known issue.
  let replyFirst: string | null = null;
  if (d.known_issue !== undefined) {
    if (f.group_id) throw new FeedbackRefusal("This item is merged into another; make that one the known issue.");
    const k = d.known_issue;
    const title = k?.title?.trim().replace(/\s+/g, " ").slice(0, FEEDBACK_LIMITS.title) ?? "";
    if (k && !title) throw new FeedbackRefusal("A known issue needs a title every developer can read.");
    const workaround = k?.workaround?.trim().slice(0, 2000) || null;
    const roadmap = k?.roadmap?.trim().slice(0, 200) || null;
    if (k && !f.public) {
      const kid = newId();
      const kStatus = status && status !== "new" ? status : f.status === "new" ? "known" : f.status;
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO feedback (id, account_id, kind, title, status, severity, area, known_title, workaround, roadmap, created_at, updated_at, triaged_at, public, shown, active_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)",
        ).bind(kid, f.kind, title, kStatus, f.severity, f.area, title, workaround, roadmap, at, at, at, at),
        env.DB.prepare("UPDATE feedback SET group_id = ?, status = ?, updated_at = ? WHERE id = ? OR group_id = ?").bind(kid, kStatus, at, f.id, f.id),
      ]);
      for (const itemId of await group(kid)) {
        if (itemId !== kid) await zaismaPost(env, itemId, "status", `Zaisma made this a known issue every developer can see, without anything you wrote: ${title}.${workaround ? ` Until it's fixed: ${workaround}` : ""}`, at);
      }
      replyFirst = f.id;
      f = (await feedbackById(env, kid))!;
    } else {
      await env.DB.prepare("UPDATE feedback SET known_title = ?, workaround = ?, roadmap = ?, updated_at = ? WHERE id = ?").bind(k ? title : null, workaround, roadmap, at, f.id).run();
      // Zaisma's own known issue, taken back: its reports stand on their own again, and the topic goes.
      if (!k && f.account_id === null) await env.DB.batch([env.DB.prepare("UPDATE feedback SET group_id = NULL WHERE group_id = ?").bind(f.id), env.DB.prepare("UPDATE feedback SET public = 0, shown = 0 WHERE id = ?").bind(f.id)]);
      // A new or changed workaround is news for everyone in the group.
      if (workaround && workaround !== f.workaround) for (const itemId of await group(f.id)) await zaismaPost(env, itemId, "status", `Until it's fixed: ${workaround}`, at);
      f = (await feedbackById(env, f.id))!;
    }
  }

  if (replyFirst && reply) await zaismaPost(env, replyFirst, "post", reply, at);
  const shared = replyFirst ? "" : reply;
  if (status && status !== f.status) {
    for (const itemId of f.group_id ? [f.id] : await group(f.id)) {
      await env.DB.prepare("UPDATE feedback SET status = ? WHERE id = ?").bind(status, itemId).run();
      await zaismaPost(env, itemId, "status", shared ? `${STATUS_WORDS[status]} ${shared}` : STATUS_WORDS[status]!, at);
    }
  } else if (shared) {
    await zaismaPost(env, f.id, "post", shared, at);
  }

  if (d.answer !== undefined) {
    if (d.answer) {
      const post = await env.DB.prepare("SELECT id FROM feedback_posts WHERE id = ? AND feedback_id = ?").bind(d.answer, f.id).first();
      if (!post) throw new FeedbackRefusal("That post isn't in this topic.");
    }
    await env.DB.prepare("UPDATE feedback SET answer_post = ?, status = CASE WHEN ? IS NOT NULL THEN 'answered' WHEN status = 'answered' THEN 'new' ELSE status END, updated_at = ? WHERE id = ?").bind(d.answer, d.answer, at, f.id).run();
  }

  if (d.severity !== undefined || d.area !== undefined) {
    const severity = d.severity !== undefined ? Math.min(4, Math.max(1, Math.round(d.severity))) : f.severity;
    await env.DB.prepare("UPDATE feedback SET severity = ?, area = ? WHERE id = ?").bind(severity, d.area !== undefined ? d.area.trim().slice(0, 40) : f.area, f.id).run();
    if (d.area !== undefined) await env.DB.prepare("DELETE FROM feedback_misplaced WHERE feedback_id = ?").bind(f.id).run();
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
