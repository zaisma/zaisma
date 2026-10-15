import { FORUM_CATEGORIES, TOPIC_SEVERITIES, TOPIC_STATUSES, gameById, type AuthorKind, type ForumPost, type ForumTopic, type TopicSeverity, type TopicTriage } from "@zaisma/core";
import type { Env } from "./env.ts";
import { affectedDeveloperCounts, decideTopic, mediaOf, topicById, TopicRefusal, type TopicDecision } from "./forum-posts.ts";
import { debugContextOf } from "./forum.ts";
import { removePost, showPost } from "./forum-check.ts";
import { html, raw, type Raw } from "./html.ts";
import { adminPage, severityPill } from "./admin.ts";
import { KINDS as KIND_LABELS } from "./forum-pages.ts";
import type { McpImage } from "./mcp.ts";

/**
 * The forum's queue for Zaisma: what list_feedback, get_feedback and decide_feedback in the admin MCP
 * answer, and the admin pages that show the same, so a click here and a call there do exactly the
 * same thing. The admin MCP's own names move to docs/NAMING.md in its own slice.
 */

const ADMIN_AUTHOR_NAMES: Record<AuthorKind, string> = { developer: "the developer", ai: "the developer's AI", zaisma: "Zaisma" };
/** The admin MCP's severity numbers, 1 (urgent) to 4 (low), until its own names move over. */
export const SEVERITY_NUMBERS: Record<TopicSeverity, number> = { urgent: 1, high: 2, normal: 3, low: 4 };
const SEVERITY_ORDER = `CASE severity ${TOPIC_SEVERITIES.map((severity, i) => `WHEN '${severity}' THEN ${i}`).join(" ")} END`;
const readableTime = (atMs: number | null) => (atMs ? new Date(atMs).toISOString().slice(0, 16).replace("T", " ") + " UTC" : null);

async function accountName(env: Env, accountId: string | null): Promise<string> {
  const name = accountId ? (await env.DB.prepare("SELECT name FROM accounts WHERE id = ?").bind(accountId).first<{ name: string }>())?.name : null;
  return name ?? "(account deleted)";
}

async function latestPost(env: Env, topicId: string, maximumCharacterCount: number) {
  const post = await env.DB.prepare("SELECT author_kind, text_markdown FROM forum_posts WHERE topic_id = ? ORDER BY created_at_ms DESC, rowid DESC LIMIT 1").bind(topicId).first<{ author_kind: AuthorKind; text_markdown: string }>();
  return post ? { by: ADMIN_AUTHOR_NAMES[post.author_kind], text: post.text_markdown.slice(0, maximumCharacterCount) } : null;
}

/**
 * Topics on their own and known issues (with the messages merged into them), most serious first.
 * With status "new" (the default) it also lists messages someone added to or reopened inside a known
 * issue that isn't new any more.
 */
export async function adminFeedbackList(env: Env, status = "new", maximumTopicCount = 30) {
  const statement = env.DB.prepare(`SELECT * FROM forum_topics WHERE merged_into_topic_id IS NULL${status === "all" ? "" : " AND topic_status = ?"} ORDER BY ${SEVERITY_ORDER}, created_at_ms LIMIT ?`);
  const { results: leads } = await (status === "all" ? statement.bind(maximumTopicCount) : statement.bind(status, maximumTopicCount)).all<ForumTopic>();
  const affected = await affectedDeveloperCounts(env, leads.map((lead) => lead.id));
  const rows = await Promise.all(
    leads.map(async (topic) => {
      const posts = await env.DB.prepare("SELECT COUNT(*) AS post_count, MAX(created_at_ms) AS last_posted_at_ms FROM forum_posts WHERE topic_id IN (SELECT id FROM forum_topics WHERE id = ? OR merged_into_topic_id = ?)")
        .bind(topic.id, topic.id)
        .first<{ post_count: number; last_posted_at_ms: number | null }>();
      return {
        id: topic.id,
        kind: topic.kind,
        title: topic.title,
        known_issue: topic.known_issue_title,
        public: topic.is_public === 1,
        status: topic.topic_status,
        severity: topic.severity,
        area: topic.category || null,
        developers: affected.get(topic.id) ?? 0,
        posts: posts?.post_count ?? 0,
        game: topic.game_id ? ((await gameById(env.DB, topic.game_id))?.slug ?? null) : null,
        filed: readableTime(topic.created_at_ms),
        last_post: readableTime(posts?.last_posted_at_ms ?? null),
        latest: await latestPost(env, topic.id, 300),
        sorted: sortedJson(topic),
      };
    }),
  );
  const list: {
    feedback: typeof rows;
    reopened_or_added?: { id: string; title: string; group_id: string; group_status: string }[];
    posts_to_check?: Awaited<ReturnType<typeof postsToCheck>>;
    zaisma_mentioned?: Awaited<ReturnType<typeof zaismaMentioned>>;
  } = { feedback: rows };
  if (status === "new") {
    const { results } = await env.DB.prepare(
      "SELECT topic.id, topic.title, topic.merged_into_topic_id AS group_id, known.topic_status AS group_status FROM forum_topics topic JOIN forum_topics known ON known.id = topic.merged_into_topic_id WHERE topic.topic_status = 'new' AND known.topic_status != 'new' ORDER BY topic.updated_at_ms DESC LIMIT 50",
    ).all<{ id: string; title: string; group_id: string; group_status: string }>();
    list.reopened_or_added = results;
    list.posts_to_check = await postsToCheck(env, 50);
    list.zaisma_mentioned = await zaismaMentioned(env);
  }
  return list;
}

/**
 * Forum posts others can't see yet: held by the check (with why), or not checked yet because the AI
 * couldn't, and posts developers reported. A person shows or removes each one (check_post in the admin MCP).
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
      state: post.check_status === "held" ? "held" : post.check_status === "pending" ? "not checked yet" : "shown, reported",
      why: post.held_reason,
      // What developers reported it for; who reported it stays with Zaisma.
      reports: (await env.DB.prepare("SELECT reason, details FROM forum_reports WHERE post_id = ? ORDER BY created_at_ms").bind(post.id).all<{ reason: string; details: string | null }>()).results,
      developer: await accountName(env, post.account_id),
      by: ADMIN_AUTHOR_NAMES[post.author_kind],
      text: post.text_markdown.slice(0, 2000),
      at: readableTime(post.created_at_ms),
    })),
  );
}

/** Public posts that mention @Zaisma, where Zaisma hasn't posted since. */
export async function zaismaMentioned(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT post.id, post.topic_id, post.text_markdown, post.created_at_ms, post.author_kind, post.account_id, COALESCE(topic.known_issue_title, topic.title) AS title FROM forum_mentions mention
     JOIN forum_posts post ON post.id = mention.post_id JOIN forum_topics topic ON topic.id = post.topic_id
     WHERE mention.account_id = 'zaisma' AND post.check_status = 'passed' AND topic.is_shown = 1
       AND NOT EXISTS (SELECT 1 FROM forum_posts later WHERE later.topic_id = post.topic_id AND later.author_kind = 'zaisma' AND later.created_at_ms > post.created_at_ms)
     ORDER BY post.created_at_ms DESC LIMIT 20`,
  ).all<{ id: string; topic_id: string; text_markdown: string; created_at_ms: number; author_kind: AuthorKind; account_id: string | null; title: string }>();
  return Promise.all(
    results.map(async (post) => ({
      post: post.id,
      topic: { id: post.topic_id, title: post.title },
      developer: await accountName(env, post.account_id),
      by: ADMIN_AUTHOR_NAMES[post.author_kind],
      text: post.text_markdown.slice(0, 500),
      at: readableTime(post.created_at_ms),
    })),
  );
}

/** What AI sorting found: its summary, why, and a drafted known issue to approve with decide_feedback. */
function sortedJson(topic: ForumTopic) {
  // Only new topics on their own are sorted; known issues and merged messages never wait for it.
  if (!topic.triage) return topic.triaged_at_ms || topic.known_issue_title || topic.merged_into_topic_id || topic.topic_status !== "new" ? null : "not yet";
  const triage = JSON.parse(topic.triage) as TopicTriage;
  return {
    by_ai: triage.is_by_ai,
    summary: triage.summary,
    why: triage.why,
    ...(triage.merged_into_topic_id ? { merged_into: triage.merged_into_topic_id } : {}),
    ...(triage.same_as_topic_id ? { looks_like: triage.same_as_topic_id } : {}),
    ...(triage.known_issue_draft ? { draft_known_issue: triage.known_issue_draft } : {}),
  };
}

/** One topic in full: every post with who wrote it, the developer's name, the game and the messages merged into it. */
export async function adminFeedbackItem(env: Env, topicId: string) {
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
    topicDetails: {
      id: topic.id,
      kind: topic.kind,
      title: topic.title,
      status: topic.topic_status,
      // A public forum topic every developer can read, or private to the developer and Zaisma.
      public: topic.is_public === 1,
      severity: topic.severity,
      area: topic.category || null,
      developer: topic.account_id ? await accountName(env, topic.account_id) : "Zaisma (a known issue)",
      game: game ? { slug: game.slug, title: game.title } : null,
      known_issue: topic.known_issue_title
        ? { title: topic.known_issue_title, workaround: topic.workaround, roadmap: topic.roadmap_item, developers: (await affectedDeveloperCounts(env, [topic.id])).get(topic.id) ?? 0 }
        : null,
      merged_into: mergedInto ? { id: mergedInto.id, title: mergedInto.known_issue_title ?? mergedInto.title, status: mergedInto.topic_status } : null,
      sorted: sortedJson(topic),
      posts: posts.map((post) => ({
        id: post.id,
        by: ADMIN_AUTHOR_NAMES[post.author_kind],
        via: post.posted_via,
        kind: post.kind,
        text: post.text_markdown,
        context: debugContextOf(post.debug_context),
        media: (media.get(post.id) ?? []).map((image) => image.id),
        // On a public topic: shown, held by the check (with why) or not checked yet.
        ...(post.check_status ? { check: post.check_status === "passed" ? "shown" : post.check_status === "held" ? `held: ${post.held_reason ?? ""}` : "not checked yet" } : {}),
        ...(post.reply_to_post_id ? { reply_to: post.reply_to_post_id } : {}),
        at: readableTime(post.created_at_ms),
      })),
      merged_here: await Promise.all(
        merged.map(async (message) => ({ id: message.id, developer: await accountName(env, message.account_id), title: message.title, status: message.topic_status, latest: await latestPost(env, message.id, 500) })),
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

type Row = Awaited<ReturnType<typeof adminFeedbackList>>["feedback"] extends (infer Element)[] ? Element : never;
type TopicDetails = NonNullable<Awaited<ReturnType<typeof adminFeedbackItem>>>["topicDetails"];
type Sorted = Row["sorted"];
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
  // A forum post the check held: show it, or remove it (check_post in the admin MCP).
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
    if (!(error instanceof TopicRefusal)) throw error;
    return new Response(null, { status: 303, headers: { Location: `/admin/feedback/${id}?error=${encodeURIComponent(error.message)}` } });
  }
  return new Response(null, { status: 303, headers: { Location: back } });
}

/** For the admin home page: how many are waiting and the most serious few. */
export async function feedbackSummary(env: Env): Promise<Raw> {
  const [waiting, list] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS topic_count FROM forum_topics WHERE merged_into_topic_id IS NULL AND topic_status = 'new'").first<{ topic_count: number }>(),
    adminFeedbackList(env, "new", 5),
  ]);
  const rows = list.feedback;
  return html`<h2>Feedback from developers (${waiting?.topic_count ?? 0})</h2>
${rows.length
    ? html`<table><tr><th>How serious</th><th>What</th><th>Developers</th></tr>${rows.map(
        (row) =>
          html`<tr><td>${severityPill(SEVERITY_NUMBERS[row.severity])}</td><td><a href="/admin/feedback/${row.id}">${row.known_issue ?? row.title}</a>${typeof row.sorted === "object" && row.sorted ? html`<br><small class="muted">${row.sorted.summary}</small>` : ""}</td><td>${row.developers}</td></tr>`,
      )}</table>
<p><a class="btn ghost" href="/admin/feedback">Open the feedback queue</a></p>`
    : html`<p class="note">Nothing waiting.</p>`}`;
}

async function knownOptions(env: Env): Promise<KnownOption[]> {
  return (await env.DB.prepare("SELECT id, known_issue_title FROM forum_topics WHERE known_issue_title IS NOT NULL AND merged_into_topic_id IS NULL ORDER BY updated_at_ms DESC LIMIT 200").all<KnownOption>()).results;
}

async function queue(env: Env, status: string): Promise<Response> {
  const filter = (FILTERS as readonly string[]).includes(status) || TOPIC_STATUSES.includes(status as never) ? status : "new";
  const [list, known, sorting] = await Promise.all([
    adminFeedbackList(env, filter, 50),
    knownOptions(env),
    env.DB.prepare("SELECT COUNT(*) AS topic_count FROM forum_topics WHERE topic_status = 'new' AND triaged_at_ms IS NULL AND merged_into_topic_id IS NULL AND known_issue_title IS NULL").first<{ topic_count: number }>(),
  ]);
  const rows = list.feedback;
  const inside = list.reopened_or_added ?? [];
  const toCheck = list.posts_to_check ?? [];
  const asked = list.zaisma_mentioned ?? [];
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
<table>${asked.map((mention) => html`<tr><td><a href="/forum/${mention.topic.id}#p-${mention.post}">${mention.topic.title}</a><br><span class="muted">${mention.developer} (${mention.by}), ${mention.at}:</span> ${mention.text.slice(0, 300)}</td><td class="nowrap"><a class="btn ghost" href="/admin/feedback/${mention.topic.id}">Reply</a></td></tr>`)}</table>`
      : ""}
${toCheck.length
      ? html`<h2>Forum posts to look at (${toCheck.length})</h2>
<p class="muted">Held by the check, not checked yet, or reported by developers. Show it keeps it up and clears its reports; Remove takes it down.</p>
<table><tr><th>Post</th><th>Why</th><th></th></tr>${toCheck.map(
          (post) =>
            html`<tr><td><a href="/admin/feedback/${post.topic.id}">${post.topic.title}</a><br><span class="muted">${post.developer} (${post.by}), ${post.at}:</span> <span style="white-space:pre-wrap">${post.text.slice(0, 400)}</span></td><td>${post.reports.length ? html`<strong>Reported ${post.reports.length === 1 ? "once" : `${post.reports.length} times`}:</strong> ${post.reports.map((report) => `${report.reason.replace("_", " ")}${report.details ? ` (“${report.details}”)` : ""}`).join("; ")}<br>` : ""}${post.state === "held" ? post.why : post.state === "not checked yet" ? html`<span class="muted">Not checked yet</span>` : html`<span class="muted">Still shown</span>`}</td><td class="nowrap">${checkButtons(post.id, "/admin/feedback")}</td></tr>`,
        )}</table>`
      : ""}
${inside.length
      ? html`<h2>Added to or reopened inside a known issue (${inside.length})</h2>
<table>${inside.map((message) => html`<tr><td><a href="/admin/feedback/${message.id}">${message.title}</a></td><td class="muted">in <a href="/admin/feedback/${message.group_id}">a known issue</a> that's ${STATUS_NAMES[message.group_status]?.toLowerCase() ?? message.group_status}</td></tr>`)}</table>`
      : ""}
<div class="queue">${rows.map((row) => card(row, full.get(row.id) ?? null, known, filter))}</div>`,
  );
}

function checkButtons(postId: string, back: string): Raw {
  return html`<form method="post" action="/admin/feedback/posts/${postId}/show" style="display:inline"><input type="hidden" name="back" value="${back}"><button class="btn" type="submit">Show it</button></form>
<form method="post" action="/admin/feedback/posts/${postId}/remove" style="display:inline"><input type="hidden" name="back" value="${back}"><button class="btn ghost" type="submit">Remove</button></form>`;
}

function sortedLines(sorted: Sorted): Raw {
  if (sorted === "not yet") return html`<p class="muted">Waiting to be sorted.</p>`;
  if (!sorted || typeof sorted !== "object") return html``;
  return html`<p class="said">${sorted.summary}</p><p class="muted">${sorted.why}${sorted.by_ai ? "" : " (Not sorted by AI.)"}${"looks_like" in sorted && sorted.looks_like ? html` Looks like <a href="/admin/feedback/${sorted.looks_like}">another public topic</a>; merge it if it is.` : ""}</p>`;
}

function card(row: Row, topic: ForumTopic | null, known: KnownOption[], filter: string): Raw {
  const severityNumber = SEVERITY_NUMBERS[row.severity];
  return html`<article class="note case sev${severityNumber}" id="f-${row.id}">
  <div class="row">${severityPill(severityNumber)} ${row.status !== "new" ? html`<span class="pill">${STATUS_NAMES[row.status]}</span> ` : ""}${row.public ? html`<span class="pill info">Public</span> ` : ""}<a href="/admin/feedback/${row.id}"><strong>${row.known_issue ?? row.title}</strong></a>
    <span class="muted">${KIND_LABELS[row.kind].label}${row.area ? ` · ${row.area}` : ""} · ${row.developers === 1 ? "1 developer" : `${row.developers} developers`} · ${row.posts === 1 ? "1 post" : `${row.posts} posts`}${row.game ? ` · ${row.game}` : ""}</span></div>
  ${row.known_issue ? html`<p class="muted">Known issue. First posted as “${row.title}”.</p>` : ""}
  ${sortedLines(row.sorted)}
  ${row.latest ? html`<p class="latest"><span class="muted">Latest, by ${row.latest.by}:</span> ${row.latest.text}</p>` : ""}
  ${topic ? decideForm(topic, row.sorted, known, "queue", filter) : ""}
</article>`;
}

function decideForm(topic: ForumTopic, sorted: Sorted, known: KnownOption[], back: "queue" | "item", filter = "new"): Raw {
  const draft = typeof sorted === "object" && sorted && "draft_known_issue" in sorted ? sorted.draft_known_issue : undefined;
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
  const [found, known, topic] = await Promise.all([adminFeedbackItem(env, id), knownOptions(env), topicById(env, id)]);
  if (!found || !topic) return new Response("Not found", { status: 404 });
  const details: TopicDetails = found.topicDetails;
  const severityNumber = SEVERITY_NUMBERS[details.severity];
  return adminPage(
    env,
    details.title,
    html`<p><a href="/admin/feedback">Feedback</a></p>
<h1>${details.known_issue?.title ?? details.title}</h1>
<p class="row">${severityPill(severityNumber)} <span class="pill">${STATUS_NAMES[details.status]}</span> ${details.public ? html`<span class="pill info">Public</span> <a href="/forum/${details.id}">Open in the forum</a>` : html`<span class="pill">Private</span>`} <span class="muted">${KIND_LABELS[details.kind].label}${details.area ? ` · ${details.area}` : ""} · from ${details.developer}${details.game ? html` · <a href="/g/${details.game.slug}">${details.game.title}</a>` : ""}</span></p>
${error ? html`<p class="note" style="color:var(--danger)">${error}</p>` : ""}
${details.known_issue ? html`<div class="note"><p><strong>Known issue</strong> · ${details.known_issue.developers === 1 ? "1 developer" : `${details.known_issue.developers} developers`}${details.known_issue.roadmap ? ` · roadmap: ${details.known_issue.roadmap}` : ""}. First posted as “${details.title}”.</p>${details.known_issue.workaround ? html`<p>Until it's fixed: ${details.known_issue.workaround}</p>` : ""}</div>` : ""}
${details.merged_into ? html`<p class="note">Merged into <a href="/admin/feedback/${details.merged_into.id}">${details.merged_into.title}</a> (${STATUS_NAMES[details.merged_into.status]?.toLowerCase()}).</p>` : ""}
<div class="case">${sortedLines(details.sorted)}</div>
<h2>Posts (${details.posts.length})</h2>
<div class="queue">${details.posts.map(
      (post) => html`<article class="note case">
  <div class="row"><strong>${post.by}</strong> <span class="muted">${post.via}${post.kind === "reopen" ? " · reopened it" : ""} · ${post.at}</span>${"check" in post && post.check && post.check !== "shown" ? html` <span class="pill pending">${post.check}</span> ${checkButtons(post.id, `/admin/feedback/${details.id}`)}` : ""}</div>
  <p class="said" style="white-space:pre-wrap">${post.text}</p>
  ${post.context ? html`<details><summary>What was attached</summary><pre>${JSON.stringify(post.context, null, 2)}</pre></details>` : ""}
  ${post.media.length ? html`<p class="row">${post.media.map((mediaId, i) => html`<a href="/admin/feedback/pictures/${mediaId}" target="_blank">Image ${i + 1}</a>`)}</p>` : ""}
</article>`,
    )}</div>
${details.merged_here.length
      ? html`<h2>Merged into this (${details.merged_here.length})</h2>
<table><tr><th>Message</th><th>Developer</th><th>Status</th><th>Latest</th></tr>${details.merged_here.map(
          (message) =>
            html`<tr><td><a href="/admin/feedback/${message.id}">${message.title}</a></td><td>${message.developer}</td><td>${STATUS_NAMES[message.status]}</td><td>${message.latest ? html`<span class="muted">${message.latest.by}:</span> ${message.latest.text}` : ""}</td></tr>`,
        )}</table>`
      : ""}
<h2>Decide</h2>
<div class="note case">${decideForm(topic, details.sorted, known, "item")}</div>`,
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
