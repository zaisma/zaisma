import {
  FORUM_CATEGORIES,
  TOPIC_SEVERITIES,
  TOPIC_STATUSES,
  ApiError,
  gameById,
  iso,
  type AuthorKind,
  type ForumPost,
  type ForumTopic,
  type TopicSeverity,
  type TopicTriage,
} from "@zaisma/core";
import type { Env } from "./env.ts";
import { affectedDeveloperCounts, decideTopic, mediaOf, topicById, type TopicDecision } from "./forum-posts.ts";
import { debugContextOf } from "./forum.ts";
import { removePost, showPost } from "./forum-check.ts";
import { html, raw, type Raw } from "./html.ts";
import { adminPage, severityPill } from "./admin.ts";
import { KINDS as KIND_LABELS } from "./forum-pages.ts";
import type { McpImage } from "./mcp.ts";

/**
 * The forum's queue for Zaisma: what list_topics, get_topic and decide_topic in the admin MCP answer
 * (TOPIC_QUEUE and TOPIC_FOR_ADMIN in schemas.ts), and the admin pages that show the same, so a click
 * here and a call there do exactly the same thing.
 */

const AUTHOR_NAMES: Record<AuthorKind, string> = { developer: "the developer", ai: "the developer's AI", zaisma: "Zaisma" };
/** The admin pages' severity pills, 1 (urgent) to 4 (low), as reports have them. */
export const SEVERITY_NUMBERS: Record<TopicSeverity, number> = { urgent: 1, high: 2, normal: 3, low: 4 };
const SEVERITY_ORDER = `CASE severity ${TOPIC_SEVERITIES.map((severity, i) => `WHEN '${severity}' THEN ${i}`).join(" ")} END`;
/** An ISO time as the admin pages show it: to the minute. */
const readableTime = (atIso: string | null) => (atIso ? `${atIso.slice(0, 16).replace("T", " ")} UTC` : "");
const accountNameOrDeleted = (name: string | null) => name ?? "(account deleted)";

async function accountName(env: Env, accountId: string | null): Promise<string | null> {
  return accountId ? ((await env.DB.prepare("SELECT username AS name FROM accounts WHERE id = ?").bind(accountId).first<{ name: string }>())?.name ?? null) : null;
}

async function latestPost(env: Env, topicId: string, maximumCharacterCount: number) {
  const post = await env.DB.prepare("SELECT author_kind, text_markdown FROM forum_posts WHERE topic_id = ? ORDER BY created_at_ms DESC, rowid DESC LIMIT 1").bind(topicId).first<{ author_kind: AuthorKind; text_markdown: string }>();
  return post ? { author_kind: post.author_kind, text_markdown: post.text_markdown.slice(0, maximumCharacterCount) } : null;
}

/**
 * The queue: topics on their own and known issues (with the messages merged into them) at a status,
 * or "all", most serious first; messages added to or reopened inside a known issue past new; the
 * public posts to check; and the posts that ask for @Zaisma.
 */
export async function topicQueue(env: Env, topicStatus = "new", maximumTopicCount = 30) {
  const statement = env.DB.prepare(`SELECT * FROM forum_topics WHERE merged_into_topic_id IS NULL${topicStatus === "all" ? "" : " AND topic_status = ?"} ORDER BY ${SEVERITY_ORDER}, created_at_ms LIMIT ?`);
  const { results: leads } = await (topicStatus === "all" ? statement.bind(maximumTopicCount) : statement.bind(topicStatus, maximumTopicCount)).all<ForumTopic>();
  const affected = await affectedDeveloperCounts(env, leads.map((lead) => lead.id));
  const topics = await Promise.all(
    leads.map(async (topic) => {
      const posts = await env.DB.prepare("SELECT COUNT(*) AS post_count, MAX(created_at_ms) AS last_posted_at_ms FROM forum_posts WHERE topic_id IN (SELECT id FROM forum_topics WHERE id = ? OR merged_into_topic_id = ?)")
        .bind(topic.id, topic.id)
        .first<{ post_count: number; last_posted_at_ms: number | null }>();
      return {
        id: topic.id,
        kind: topic.kind,
        title: topic.title,
        known_issue_title: topic.known_issue_title,
        is_public: topic.is_public === 1,
        topic_status: topic.topic_status,
        severity: topic.severity,
        category: topic.category || null,
        affected_developer_count: affected.get(topic.id) ?? 0,
        post_count: posts?.post_count ?? 0,
        game_slug: topic.game_id ? ((await gameById(env.DB, topic.game_id))?.slug ?? null) : null,
        created_at: iso(topic.created_at_ms)!,
        last_posted_at: iso(posts?.last_posted_at_ms),
        latest_post: await latestPost(env, topic.id, 300),
        ...sortingOf(topic),
      };
    }),
  );
  const { results: insideKnownIssues } = await env.DB.prepare(
    "SELECT topic.id, topic.title, topic.merged_into_topic_id AS known_issue_topic_id, known.topic_status AS known_issue_topic_status FROM forum_topics topic JOIN forum_topics known ON known.id = topic.merged_into_topic_id WHERE topic.topic_status = 'new' AND known.topic_status != 'new' ORDER BY topic.updated_at_ms DESC LIMIT 50",
  ).all<{ id: string; title: string; known_issue_topic_id: string; known_issue_topic_status: string }>();
  return { topics, topics_in_known_issues: insideKnownIssues, waiting_posts: await postsToCheck(env, 50), zaisma_mentions: await zaismaMentions(env) };
}

/**
 * Forum posts others can't see yet: held by the check (with why), or not checked yet because the AI
 * couldn't, and posts developers reported. A person shows or removes each one (decide_post in the admin MCP).
 */
export async function postsToCheck(env: Env, maximumPostCount = 50) {
  const { results } = await env.DB.prepare(
    `SELECT post.*, topic.title AS topic_title, topic.known_issue_title AS topic_known_issue_title FROM forum_posts post JOIN forum_topics topic ON topic.id = post.topic_id
     WHERE post.check_status IN ('held', 'pending') OR post.id IN (SELECT post_id FROM forum_reports)
     ORDER BY post.id IN (SELECT post_id FROM forum_reports WHERE reason = 'child_safety') DESC, post.check_status = 'held' DESC, post.created_at_ms LIMIT ?`,
  )
    .bind(maximumPostCount)
    .all<ForumPost & { topic_title: string; topic_known_issue_title: string | null }>();
  return Promise.all(
    results.map(async (post) => ({
      id: post.id,
      topic: { id: post.topic_id, title: post.topic_known_issue_title ?? post.topic_title },
      check_status: post.check_status ?? "passed",
      held_reason: post.held_reason,
      // What developers reported it for; who reported it stays with Zaisma.
      reports: (await env.DB.prepare("SELECT reason, details FROM forum_reports WHERE post_id = ? ORDER BY created_at_ms").bind(post.id).all<{ reason: string; details: string | null }>()).results,
      developer_name: await accountName(env, post.account_id),
      author_kind: post.author_kind,
      text_markdown: post.text_markdown.slice(0, 2000),
      created_at: iso(post.created_at_ms)!,
    })),
  );
}

/** Public posts that mention @Zaisma, where Zaisma hasn't posted since. */
async function zaismaMentions(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT post.id, post.topic_id, post.text_markdown, post.created_at_ms, post.author_kind, post.account_id, COALESCE(topic.known_issue_title, topic.title) AS title FROM forum_mentions mention
     JOIN forum_posts post ON post.id = mention.post_id JOIN forum_topics topic ON topic.id = post.topic_id
     WHERE mention.account_id = 'zaisma' AND post.check_status = 'passed' AND topic.is_shown = 1
       AND NOT EXISTS (SELECT 1 FROM forum_posts later WHERE later.topic_id = post.topic_id AND later.author_kind = 'zaisma' AND later.created_at_ms > post.created_at_ms)
     ORDER BY post.created_at_ms DESC LIMIT 20`,
  ).all<{ id: string; topic_id: string; text_markdown: string; created_at_ms: number; author_kind: AuthorKind; account_id: string | null; title: string }>();
  return Promise.all(
    results.map(async (post) => ({
      id: post.id,
      topic: { id: post.topic_id, title: post.title },
      developer_name: await accountName(env, post.account_id),
      author_kind: post.author_kind,
      text_markdown: post.text_markdown.slice(0, 500),
      created_at: iso(post.created_at_ms)!,
    })),
  );
}

/** What AI sorting found (its summary, why and a drafted known issue to approve with decide_topic), and whether it's still to come. */
function sortingOf(topic: ForumTopic) {
  // Only new topics on their own are sorted; known issues and merged messages never wait for it.
  if (!topic.triage) return { is_waiting_for_sorting: !(topic.triaged_at_ms || topic.known_issue_title || topic.merged_into_topic_id || topic.topic_status !== "new"), sorting: null };
  const triage = JSON.parse(topic.triage) as TopicTriage;
  return {
    is_waiting_for_sorting: false,
    sorting: {
      is_by_ai: triage.is_by_ai,
      summary: triage.summary,
      why: triage.why,
      merged_into_topic_id: triage.merged_into_topic_id,
      same_as_topic_id: triage.same_as_topic_id,
      known_issue_draft: triage.known_issue_draft,
    },
  };
}

/** One topic in full: every post with who wrote it, the developer's name, the game and the messages merged into it. */
export async function topicForAdmin(env: Env, topicId: string) {
  const topic = await topicById(env, topicId);
  if (!topic) return null;
  const mergedInto = topic.merged_into_topic_id ? await topicById(env, topic.merged_into_topic_id) : null;
  const { results: posts } = await env.DB.prepare("SELECT * FROM forum_posts WHERE topic_id = ? ORDER BY created_at_ms, rowid").bind(topic.id).all<ForumPost>();
  const { results: merged } = await env.DB.prepare("SELECT * FROM forum_topics WHERE merged_into_topic_id = ? ORDER BY created_at_ms").bind(topic.id).all<ForumTopic>();
  const game = topic.game_id ? await gameById(env.DB, topic.game_id) : null;
  const media = await mediaOf(env, posts.map((post) => post.id));
  const latestImages = posts.flatMap((post) => media.get(post.id) ?? []).slice(-3);
  const pictures = await Promise.all(
    latestImages.map(async (image) => {
      const object = await env.GAMES.get(image.storage_key);
      return object ? { data: toBase64(new Uint8Array(await object.arrayBuffer())), mimeType: image.content_type } : null;
    }),
  );
  return {
    answer: {
      topic: {
        id: topic.id,
        kind: topic.kind,
        title: topic.title,
        topic_status: topic.topic_status,
        is_public: topic.is_public === 1,
        severity: topic.severity,
        category: topic.category || null,
        developer_name: await accountName(env, topic.account_id),
        game: game ? { slug: game.slug, title: game.title } : null,
        known_issue: topic.known_issue_title
          ? { title: topic.known_issue_title, workaround: topic.workaround, roadmap_item: topic.roadmap_item, affected_developer_count: (await affectedDeveloperCounts(env, [topic.id])).get(topic.id) ?? 0 }
          : null,
        merged_into_topic: mergedInto ? { id: mergedInto.id, title: mergedInto.known_issue_title ?? mergedInto.title, topic_status: mergedInto.topic_status } : null,
        ...sortingOf(topic),
      },
      posts: posts.map((post) => ({
        id: post.id,
        author_kind: post.author_kind,
        posted_via: post.posted_via,
        kind: post.kind,
        text_markdown: post.text_markdown,
        debug_context: debugContextOf(post.debug_context),
        media_ids: (media.get(post.id) ?? []).map((image) => image.id),
        check_status: post.check_status,
        held_reason: post.held_reason,
        reply_to_post_id: post.reply_to_post_id,
        created_at: iso(post.created_at_ms)!,
      })),
      merged_topics: await Promise.all(
        merged.map(async (message) => ({
          id: message.id,
          developer_name: await accountName(env, message.account_id),
          title: message.title,
          topic_status: message.topic_status,
          latest_post: await latestPost(env, message.id, 500),
        })),
      ),
    },
    pictures: pictures.filter((picture): picture is McpImage => picture !== null),
  };
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// --- The admin pages ---

type Row = Awaited<ReturnType<typeof topicQueue>>["topics"] extends (infer Element)[] ? Element : never;
type Sorting = Pick<Row, "is_waiting_for_sorting" | "sorting">;
type KnownOption = { id: string; known_issue_title: string };

const STATUS_NAMES: Record<string, string> = { new: "New", investigating: "Investigating", known: "Confirmed", planned: "Planned", fixing: "Fixing", released: "Fix released", fixed: "Resolved", wont: "Won't fix", answered: "Answered" };
const FILTERS = ["new", "investigating", "known", "planned", "fixing", "released", "all"] as const;

export async function adminFeedbackPage(env: Env, path: string, url: URL): Promise<Response | null> {
  if (path === "/admin/feedback") return queue(env, url.searchParams.get("status") ?? "new");
  const image = path.match(/^\/admin\/feedback\/pictures\/([a-z0-9_]{1,40})$/);
  if (image) return picture(env, image[1]!);
  const topicPath = path.match(/^\/admin\/feedback\/([a-z0-9_]{1,40})$/);
  if (topicPath) return itemPage(env, topicPath[1]!, url.searchParams.get("error") ?? "");
  return null;
}

/** A decision from the queue or a topic's page: only what the form changed goes to decideTopic. */
export async function adminFeedbackAction(env: Env, path: string, form: FormData): Promise<Response | null> {
  // A forum post the check held: show it, or remove it (decide_post in the admin MCP).
  const check = path.match(/^\/admin\/feedback\/posts\/([a-z0-9_]{1,40})\/(show|remove)$/);
  if (check) {
    if (check[2] === "show") await showPost(env, check[1]!);
    else await removePost(env, check[1]!);
    const back = String(form.get("back") ?? "");
    return new Response(null, { status: 303, headers: { Location: /^\/admin\/feedback(\/[a-z0-9_]{1,40})?$/.test(back) ? back : "/admin/feedback" } });
  }
  const decidePath = path.match(/^\/admin\/feedback\/([a-z0-9_]{1,40})\/decide$/);
  if (!decidePath) return null;
  const id = decidePath[1]!;
  const back = form.get("back") === "queue" ? `/admin/feedback?status=${encodeURIComponent(String(form.get("status_filter") ?? "new"))}#f-${id}` : `/admin/feedback/${id}`;
  const topic = await topicById(env, id);
  if (!topic) return new Response("Not found", { status: 404 });
  const field = (name: string) => String(form.get(name) ?? "").trim();
  const decision: TopicDecision = {};
  if (field("reply")) decision.reply = field("reply");
  if (field("topic_status") && field("topic_status") !== topic.topic_status) decision.topicStatus = field("topic_status");
  if (field("merge_into_topic_id")) decision.mergeIntoTopicId = field("merge_into_topic_id");
  else if (form.get("is_known_issue") === "1") {
    const knownIssue = { title: field("known_issue_title"), workaround: field("workaround"), roadmapItem: field("roadmap_item") };
    if (knownIssue.title !== (topic.known_issue_title ?? "") || knownIssue.workaround !== (topic.workaround ?? "") || knownIssue.roadmapItem !== (topic.roadmap_item ?? "")) decision.knownIssue = knownIssue;
  } else if (topic.known_issue_title) decision.knownIssue = null;
  const severity = field("severity") as TopicSeverity;
  if (TOPIC_SEVERITIES.includes(severity) && severity !== topic.severity) decision.severity = severity;
  if (form.has("category") && field("category") !== topic.category) decision.category = field("category");
  try {
    await decideTopic(env, id, decision);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return new Response(null, { status: 303, headers: { Location: `/admin/feedback/${id}?error=${encodeURIComponent(error.messageForPeople)}` } });
  }
  return new Response(null, { status: 303, headers: { Location: back } });
}

/** For the admin home page: how many are waiting and the most serious few. */
export async function feedbackSummary(env: Env): Promise<Raw> {
  const [waiting, queue] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS topic_count FROM forum_topics WHERE merged_into_topic_id IS NULL AND topic_status = 'new'").first<{ topic_count: number }>(),
    topicQueue(env, "new", 5),
  ]);
  const rows = queue.topics;
  return html`<h2>Feedback from developers (${waiting?.topic_count ?? 0})</h2>
${rows.length
    ? html`<table><tr><th>How serious</th><th>What</th><th>Developers</th></tr>${rows.map(
        (row) =>
          html`<tr><td>${severityPill(SEVERITY_NUMBERS[row.severity])}</td><td><a href="/admin/feedback/${row.id}">${row.known_issue_title ?? row.title}</a>${row.sorting ? html`<br><small class="muted">${row.sorting.summary}</small>` : ""}</td><td>${row.affected_developer_count}</td></tr>`,
      )}</table>
<p><a class="btn ghost" href="/admin/feedback">Open the feedback queue</a></p>`
    : html`<p class="note">Nothing waiting.</p>`}`;
}

async function knownOptions(env: Env): Promise<KnownOption[]> {
  return (await env.DB.prepare("SELECT id, known_issue_title FROM forum_topics WHERE known_issue_title IS NOT NULL AND merged_into_topic_id IS NULL ORDER BY updated_at_ms DESC LIMIT 200").all<KnownOption>()).results;
}

async function queue(env: Env, status: string): Promise<Response> {
  const filter = (FILTERS as readonly string[]).includes(status) || TOPIC_STATUSES.includes(status as never) ? status : "new";
  const [queue, known, sorting] = await Promise.all([
    topicQueue(env, filter, 50),
    knownOptions(env),
    env.DB.prepare("SELECT COUNT(*) AS topic_count FROM forum_topics WHERE topic_status = 'new' AND triaged_at_ms IS NULL AND merged_into_topic_id IS NULL AND known_issue_title IS NULL").first<{ topic_count: number }>(),
  ]);
  const rows = queue.topics;
  // What's waiting besides the topics shows with the waiting ones only.
  const isWaiting = filter === "new";
  const inside = isWaiting ? queue.topics_in_known_issues : [];
  const toCheck = isWaiting ? queue.waiting_posts : [];
  const asked = isWaiting ? queue.zaisma_mentions : [];
  // The full record of each card, for the reply form's known-issue fields.
  const full = new Map((await Promise.all(rows.map((row) => topicById(env, row.id)))).filter((topic): topic is ForumTopic => topic !== null).map((topic) => [topic.id, topic]));
  return adminPage(
    env,
    "Feedback",
    html`<h1>Feedback</h1>
<p class="lead">${rows.length ? `${rows.length} ${filter === "new" ? "waiting" : filter === "all" ? "topics and known issues" : STATUS_NAMES[filter]!.toLowerCase()}, most serious first.` : filter === "new" ? "Nothing waiting." : "Nothing here."}${filter === "new" && sorting?.topic_count ? ` ${sorting.topic_count} still being sorted.` : ""}</p>
<nav class="seg" aria-label="Which feedback">${FILTERS.map((option) => html`<a href="/admin/feedback?status=${option}"${option === filter ? raw(' aria-current="page"') : ""}>${option === "all" ? "All" : option === "new" ? "Waiting" : STATUS_NAMES[option]}</a>`)}</nav>
${asked.length
      ? html`<h2>Asked for Zaisma (${asked.length})</h2>
<p class="muted">Public posts that mention @Zaisma, with no reply from Zaisma since.</p>
<table>${asked.map((mention) => html`<tr><td><a href="/forum/${mention.topic.id}#p-${mention.id}">${mention.topic.title}</a><br><span class="muted">${accountNameOrDeleted(mention.developer_name)} (${AUTHOR_NAMES[mention.author_kind]}), ${readableTime(mention.created_at)}:</span> ${mention.text_markdown.slice(0, 300)}</td><td class="nowrap"><a class="btn ghost" href="/admin/feedback/${mention.topic.id}">Reply</a></td></tr>`)}</table>`
      : ""}
${toCheck.length
      ? html`<h2>Forum posts to look at (${toCheck.length})</h2>
<p class="muted">Held by the check, not checked yet, or reported by developers. Show it keeps it up and clears its reports; Remove takes it down.</p>
<table><tr><th>Post</th><th>Why</th><th></th></tr>${toCheck.map(
          (post) =>
            html`<tr><td><a href="/admin/feedback/${post.topic.id}">${post.topic.title}</a><br><span class="muted">${accountNameOrDeleted(post.developer_name)} (${AUTHOR_NAMES[post.author_kind]}), ${readableTime(post.created_at)}:</span> <span style="white-space:pre-wrap">${post.text_markdown.slice(0, 400)}</span></td><td>${post.reports.length ? html`<strong>Reported ${post.reports.length === 1 ? "once" : `${post.reports.length} times`}:</strong> ${post.reports.map((report) => `${report.reason.replace("_", " ")}${report.details ? ` (“${report.details}”)` : ""}`).join("; ")}<br>` : ""}${post.check_status === "held" ? post.held_reason : post.check_status === "pending" ? html`<span class="muted">Not checked yet</span>` : html`<span class="muted">Still shown</span>`}</td><td class="nowrap">${checkButtons(post.id, "/admin/feedback")}</td></tr>`,
        )}</table>`
      : ""}
${inside.length
      ? html`<h2>Added to or reopened inside a known issue (${inside.length})</h2>
<table>${inside.map((message) => html`<tr><td><a href="/admin/feedback/${message.id}">${message.title}</a></td><td class="muted">in <a href="/admin/feedback/${message.known_issue_topic_id}">a known issue</a> that's ${STATUS_NAMES[message.known_issue_topic_status]?.toLowerCase() ?? message.known_issue_topic_status}</td></tr>`)}</table>`
      : ""}
<div class="queue">${rows.map((row) => card(row, full.get(row.id) ?? null, known, filter))}</div>`,
  );
}

function checkButtons(postId: string, back: string): Raw {
  return html`<form method="post" action="/admin/feedback/posts/${postId}/show" style="display:inline"><input type="hidden" name="back" value="${back}"><button class="btn" type="submit">Show it</button></form>
<form method="post" action="/admin/feedback/posts/${postId}/remove" style="display:inline"><input type="hidden" name="back" value="${back}"><button class="btn ghost" type="submit">Remove</button></form>`;
}

function sortedLines(sorting: Sorting): Raw {
  if (sorting.is_waiting_for_sorting) return html`<p class="muted">Waiting to be sorted.</p>`;
  const found = sorting.sorting;
  if (!found) return html``;
  return html`<p class="said">${found.summary}</p><p class="muted">${found.why}${found.is_by_ai ? "" : " (Not sorted by AI.)"}${found.same_as_topic_id ? html` Looks like <a href="/admin/feedback/${found.same_as_topic_id}">another public topic</a>; merge it if it is.` : ""}</p>`;
}

function card(row: Row, topic: ForumTopic | null, known: KnownOption[], filter: string): Raw {
  const severityNumber = SEVERITY_NUMBERS[row.severity];
  return html`<article class="note case sev${severityNumber}" id="f-${row.id}">
  <div class="row">${severityPill(severityNumber)} ${row.topic_status !== "new" ? html`<span class="pill">${STATUS_NAMES[row.topic_status]}</span> ` : ""}${row.is_public ? html`<span class="pill info">Public</span> ` : ""}<a href="/admin/feedback/${row.id}"><strong>${row.known_issue_title ?? row.title}</strong></a>
    <span class="muted">${KIND_LABELS[row.kind].label}${row.category ? ` · ${row.category}` : ""} · ${row.affected_developer_count === 1 ? "1 developer" : `${row.affected_developer_count} developers`} · ${row.post_count === 1 ? "1 post" : `${row.post_count} posts`}${row.game_slug ? ` · ${row.game_slug}` : ""}</span></div>
  ${row.known_issue_title ? html`<p class="muted">Known issue. First posted as “${row.title}”.</p>` : ""}
  ${sortedLines(row)}
  ${row.latest_post ? html`<p class="latest"><span class="muted">Latest, by ${AUTHOR_NAMES[row.latest_post.author_kind]}:</span> ${row.latest_post.text_markdown}</p>` : ""}
  ${topic ? decideForm(topic, row, known, "queue", filter) : ""}
</article>`;
}

function decideForm(topic: ForumTopic, sorting: Sorting, known: KnownOption[], back: "queue" | "item", filter = "new"): Raw {
  const draft = sorting.sorting?.known_issue_draft ?? null;
  const isKnownIssue = Boolean(topic.known_issue_title);
  const title = topic.known_issue_title ?? draft?.title ?? "";
  const isMerged = Boolean(topic.merged_into_topic_id);
  const isPublic = topic.is_public === 1;
  return html`<form method="post" action="/admin/feedback/${topic.id}/decide" class="decide">
  <input type="hidden" name="back" value="${back}"><input type="hidden" name="status_filter" value="${filter}">
  <label>Reply${isPublic ? " in the public topic (every developer sees it)" : isMerged ? " to the developer" : isKnownIssue ? " (with a status change, every developer in it gets it)" : " to the developer (if you make it a known issue, only they get this)"} <textarea name="reply" rows="2" maxlength="8000" placeholder="From Zaisma"></textarea></label>
  ${isMerged
    ? ""
    : html`<div class="precedent">
    <label class="check"><input type="checkbox" name="is_known_issue" value="1"${isKnownIssue ? raw(" checked") : ""}> ${isKnownIssue ? html`A known issue every developer sees` : draft ? html`Make it a known issue every developer sees: <strong>${draft.title}</strong> <span class="muted">(the AI's draft${isPublic ? "" : "; a new public topic of Zaisma's own, without the developer's words"})</span>` : isPublic ? "Make this public topic a known issue" : "Make it a known issue: a new public topic of Zaisma's own, without the developer's words"}</label>
    <details><summary>${isKnownIssue ? "Edit the known issue" : draft ? "Edit it first" : "Write the known issue"}</summary>
      <label>Title: general, with no names, games or anything said in private <input name="known_issue_title" maxlength="120" value="${title}"></label>
      <label>Until it's fixed (optional) <textarea name="workaround" rows="2" maxlength="2000">${topic.workaround ?? draft?.workaround ?? ""}</textarea></label>
      <label>Roadmap item (optional, as in docs/ROADMAP.md) <input name="roadmap_item" maxlength="200" value="${topic.roadmap_item ?? ""}"></label>
    </details>
  </div>`}
  <div class="row">
    <select name="topic_status" aria-label="Status">${TOPIC_STATUSES.map((status) => html`<option value="${status}"${status === topic.topic_status ? raw(" selected") : ""}>${STATUS_NAMES[status]}</option>`)}</select>
    <select name="severity" aria-label="How serious">${TOPIC_SEVERITIES.map((severity) => html`<option value="${severity}"${severity === topic.severity ? raw(" selected") : ""}>${severity[0]!.toUpperCase()}${severity.slice(1)}</option>`)}</select>
    <select name="category" aria-label="Category"><option value="">No category</option>${FORUM_CATEGORIES.map((category) => html`<option${category === topic.category ? raw(" selected") : ""}>${category}</option>`)}</select>
    ${isMerged
      ? ""
      : html`<select name="merge_into_topic_id" aria-label="Merge into a known issue"><option value="">Don't merge</option>${known.filter((option) => option.id !== topic.id).map((option) => html`<option value="${option.id}">Merge into: ${option.known_issue_title}</option>`)}</select>`}
    <button class="btn" type="submit">Save</button>
  </div>
</form>`;
}

async function itemPage(env: Env, id: string, error: string): Promise<Response> {
  const [found, known, topic] = await Promise.all([topicForAdmin(env, id), knownOptions(env), topicById(env, id)]);
  if (!found || !topic) return new Response("Not found", { status: 404 });
  const { topic: details, posts, merged_topics: mergedTopics } = found.answer;
  const severityNumber = SEVERITY_NUMBERS[details.severity];
  const checkLabel = (checkStatus: string | null, heldReason: string | null) => (checkStatus === "held" ? `held: ${heldReason ?? ""}` : checkStatus === "pending" ? "not checked yet" : null);
  return adminPage(
    env,
    details.title,
    html`<p><a href="/admin/feedback">Feedback</a></p>
<h1>${details.known_issue?.title ?? details.title}</h1>
<p class="row">${severityPill(severityNumber)} <span class="pill">${STATUS_NAMES[details.topic_status]}</span> ${details.is_public ? html`<span class="pill info">Public</span> <a href="/forum/${details.id}">Open in the forum</a>` : html`<span class="pill">Private</span>`} <span class="muted">${KIND_LABELS[details.kind].label}${details.category ? ` · ${details.category}` : ""} · from ${topic.account_id ? accountNameOrDeleted(details.developer_name) : "Zaisma (a known issue)"}${details.game ? html` · <a href="/g/${details.game.slug}">${details.game.title}</a>` : ""}</span></p>
${error ? html`<p class="note" style="color:var(--danger)">${error}</p>` : ""}
${details.known_issue ? html`<div class="note"><p><strong>Known issue</strong> · ${details.known_issue.affected_developer_count === 1 ? "1 developer" : `${details.known_issue.affected_developer_count} developers`}${details.known_issue.roadmap_item ? ` · roadmap: ${details.known_issue.roadmap_item}` : ""}. First posted as “${details.title}”.</p>${details.known_issue.workaround ? html`<p>Until it's fixed: ${details.known_issue.workaround}</p>` : ""}</div>` : ""}
${details.merged_into_topic ? html`<p class="note">Merged into <a href="/admin/feedback/${details.merged_into_topic.id}">${details.merged_into_topic.title}</a> (${STATUS_NAMES[details.merged_into_topic.topic_status]?.toLowerCase()}).</p>` : ""}
<div class="case">${sortedLines(details)}</div>
<h2>Posts (${posts.length})</h2>
<div class="queue">${posts.map((post) => {
      const label = checkLabel(post.check_status, post.held_reason);
      return html`<article class="note case">
  <div class="row"><strong>${AUTHOR_NAMES[post.author_kind]}</strong> <span class="muted">${post.posted_via}${post.kind === "reopen" ? " · reopened it" : ""} · ${readableTime(post.created_at)}</span>${label ? html` <span class="pill pending">${label}</span> ${checkButtons(post.id, `/admin/feedback/${details.id}`)}` : ""}</div>
  <p class="said" style="white-space:pre-wrap">${post.text_markdown}</p>
  ${post.debug_context ? html`<details><summary>What was attached</summary><pre>${JSON.stringify(post.debug_context, null, 2)}</pre></details>` : ""}
  ${post.media_ids.length ? html`<p class="row">${post.media_ids.map((mediaId, i) => html`<a href="/admin/feedback/pictures/${mediaId}" target="_blank">Image ${i + 1}</a>`)}</p>` : ""}
</article>`;
    })}</div>
${mergedTopics.length
      ? html`<h2>Merged into this (${mergedTopics.length})</h2>
<table><tr><th>Message</th><th>Developer</th><th>Status</th><th>Latest</th></tr>${mergedTopics.map(
          (message) =>
            html`<tr><td><a href="/admin/feedback/${message.id}">${message.title}</a></td><td>${accountNameOrDeleted(message.developer_name)}</td><td>${STATUS_NAMES[message.topic_status]}</td><td>${message.latest_post ? html`<span class="muted">${AUTHOR_NAMES[message.latest_post.author_kind]}:</span> ${message.latest_post.text_markdown}` : ""}</td></tr>`,
        )}</table>`
      : ""}
<h2>Decide</h2>
<div class="note case">${decideForm(topic, details, known, "item")}</div>`,
  );
}

/** An image a developer or their AI attached to a post, by its id. */
async function picture(env: Env, mediaId: string): Promise<Response> {
  const image = await env.DB.prepare("SELECT content_type, storage_key FROM forum_media WHERE id = ?").bind(mediaId).first<{ content_type: string; storage_key: string }>();
  const object = image ? await env.GAMES.get(image.storage_key) : null;
  if (!image || !object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: { "Content-Type": image.content_type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" },
  });
}
