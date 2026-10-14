import { FEEDBACK_AREAS, FEEDBACK_STATUSES, feedbackPictureKey, type Feedback } from "@zaisma/core";
import type { Env } from "./env.ts";
import { adminFeedbackItem, adminFeedbackList, decideFeedback, FeedbackRefusal, type FeedbackDecision } from "./feedback.ts";
import { removePost, showPost } from "./forum-check.ts";
import { html, raw, type Raw } from "./html.ts";
import { adminPage, severityPill } from "./admin.ts";
import { KINDS as KIND_LABELS } from "./forum-pages.ts";

/**
 * The feedback queue on the admin pages: the same lists and decisions as list_feedback, get_feedback
 * and decide_feedback in the admin MCP, so a click here and a call there do exactly the same thing.
 */

type Row = Awaited<ReturnType<typeof adminFeedbackList>>["feedback"] extends (infer R)[] ? R : never;
type Item = NonNullable<Awaited<ReturnType<typeof adminFeedbackItem>>>["data"];
type Sorted = Row["sorted"];
type KnownOption = { id: string; known_title: string };

const STATUS_NAMES: Record<string, string> = { new: "New", investigating: "Investigating", known: "Confirmed", planned: "Planned", fixing: "Fixing", released: "Fix released", fixed: "Resolved", wont: "Won't fix", answered: "Answered" };
const SEVERITY_NUMBER: Record<string, number> = { urgent: 1, high: 2, normal: 3, low: 4 };
const FILTERS = ["new", "investigating", "known", "planned", "fixing", "released", "all"] as const;

export async function adminFeedbackPage(env: Env, path: string, url: URL): Promise<Response | null> {
  if (path === "/admin/feedback") return queue(env, url.searchParams.get("status") ?? "new");
  const pic = path.match(/^\/admin\/feedback\/pictures\/([a-z0-9]{1,40})$/);
  if (pic) return picture(env, pic[1]!);
  const m = path.match(/^\/admin\/feedback\/([a-z0-9]{1,40})$/);
  if (m) return itemPage(env, m[1]!, url.searchParams.get("error") ?? "");
  return null;
}

/** A decision from the queue or an item's page: only what the form changed goes to decideFeedback. */
export async function adminFeedbackAction(env: Env, path: string, form: FormData): Promise<Response | null> {
  // A forum post the check held: show it, or remove it (check_post in the admin MCP).
  const check = path.match(/^\/admin\/feedback\/posts\/([a-z0-9]{1,40})\/(show|remove)$/);
  if (check) {
    if (check[2] === "show") await showPost(env, check[1]!);
    else await removePost(env, check[1]!);
    const back = String(form.get("back") ?? "");
    return new Response(null, { status: 303, headers: { Location: /^\/admin\/feedback(\/[a-z0-9]{1,40})?$/.test(back) ? back : "/admin/feedback" } });
  }
  const m = path.match(/^\/admin\/feedback\/([a-z0-9]{1,40})\/decide$/);
  if (!m) return null;
  const id = m[1]!;
  const back = form.get("back") === "queue" ? `/admin/feedback?status=${encodeURIComponent(String(form.get("status_filter") ?? "new"))}#f-${id}` : `/admin/feedback/${id}`;
  const f = await env.DB.prepare("SELECT * FROM feedback WHERE id = ?").bind(id).first<Feedback>();
  if (!f) return new Response("Not found", { status: 404 });
  const field = (name: string) => String(form.get(name) ?? "").trim();
  const d: FeedbackDecision = {};
  if (field("reply")) d.reply = field("reply");
  if (field("status") && field("status") !== f.status) d.status = field("status");
  if (field("merge_into")) d.merge_into = field("merge_into");
  else if (form.get("known") === "1") {
    const k = { title: field("k_title"), workaround: field("k_workaround"), roadmap: field("k_roadmap") };
    if (k.title !== (f.known_title ?? "") || k.workaround !== (f.workaround ?? "") || k.roadmap !== (f.roadmap ?? "")) d.known_issue = k;
  } else if (f.known_title) d.known_issue = null;
  const severity = Number(field("severity"));
  if (severity && severity !== f.severity) d.severity = severity;
  if (form.has("area") && field("area") !== f.area) d.area = field("area");
  try {
    await decideFeedback(env, id, d);
  } catch (err) {
    if (!(err instanceof FeedbackRefusal)) throw err;
    return new Response(null, { status: 303, headers: { Location: `/admin/feedback/${id}?error=${encodeURIComponent(err.message)}` } });
  }
  return new Response(null, { status: 303, headers: { Location: back } });
}

/** For the admin home page: how many are waiting and the most serious few. */
export async function feedbackSummary(env: Env): Promise<Raw> {
  const [count, list] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM feedback WHERE group_id IS NULL AND status = 'new'").first<{ n: number }>(),
    adminFeedbackList(env, "new", 5),
  ]);
  const rows = list.feedback;
  return html`<h2>Feedback from developers (${count?.n ?? 0})</h2>
${rows.length
    ? html`<table><tr><th>How serious</th><th>What</th><th>Developers</th></tr>${rows.map(
        (r) => html`<tr><td>${severityPill(SEVERITY_NUMBER[r.severity] ?? 3)}</td><td><a href="/admin/feedback/${r.id}">${r.known_issue ?? r.title}</a>${typeof r.sorted === "object" && r.sorted ? html`<br><small class="muted">${r.sorted.summary}</small>` : ""}</td><td>${r.developers}</td></tr>`,
      )}</table>
<p><a class="btn ghost" href="/admin/feedback">Open the feedback queue</a></p>`
    : html`<p class="note">Nothing waiting.</p>`}`;
}

async function knownOptions(env: Env): Promise<KnownOption[]> {
  return (await env.DB.prepare("SELECT id, known_title FROM feedback WHERE known_title IS NOT NULL AND group_id IS NULL ORDER BY updated_at DESC LIMIT 200").all<KnownOption>()).results;
}

async function queue(env: Env, status: string): Promise<Response> {
  const filter = (FILTERS as readonly string[]).includes(status) || FEEDBACK_STATUSES.includes(status as never) ? status : "new";
  const [list, known, waiting] = await Promise.all([
    adminFeedbackList(env, filter, 50),
    knownOptions(env),
    env.DB.prepare("SELECT COUNT(*) AS n FROM feedback WHERE status = 'new' AND triaged_at IS NULL AND group_id IS NULL AND known_title IS NULL").first<{ n: number }>(),
  ]);
  const rows = list.feedback;
  const inside = (list.reopened_or_added ?? []) as { id: string; title: string; group_id: string; group_status: string }[];
  const toCheck = list.posts_to_check ?? [];
  // The full record of each card, for the reply form's known-issue fields.
  const full = new Map((await Promise.all(rows.map((r) => env.DB.prepare("SELECT * FROM feedback WHERE id = ?").bind(r.id).first<Feedback>()))).filter((f): f is Feedback => f !== null).map((f) => [f.id, f]));
  return adminPage(
    env,
    "Feedback",
    html`<h1>Feedback</h1>
<p class="lead">${rows.length ? `${rows.length} ${filter === "new" ? "waiting" : filter === "all" ? "items and known issues" : STATUS_NAMES[filter]!.toLowerCase()}, most serious first.` : filter === "new" ? "Nothing waiting." : "Nothing here."}${filter === "new" && waiting?.n ? ` ${waiting.n} still being sorted.` : ""}</p>
<nav class="seg" aria-label="Which feedback">${FILTERS.map((s) => html`<a href="/admin/feedback?status=${s}"${s === filter ? raw(' aria-current="page"') : ""}>${s === "all" ? "All" : s === "new" ? "Waiting" : STATUS_NAMES[s]}</a>`)}</nav>
${toCheck.length
      ? html`<h2>Forum posts to look at (${toCheck.length})</h2>
<p class="muted">Held by the check, not checked yet, or reported by developers. Show it keeps it up and clears its reports; Remove takes it down.</p>
<table><tr><th>Post</th><th>Why</th><th></th></tr>${toCheck.map(
          (p) => html`<tr><td><a href="/admin/feedback/${p.topic.id}">${p.topic.title}</a><br><span class="muted">${p.developer} (${p.by}), ${p.at}:</span> <span style="white-space:pre-wrap">${p.text.slice(0, 400)}</span></td><td>${p.reports.length ? html`<strong>Reported ${p.reports.length === 1 ? "once" : `${p.reports.length} times`}:</strong> ${p.reports.map((r) => `${r.reason.replace("_", " ")}${r.details ? ` (“${r.details}”)` : ""}`).join("; ")}<br>` : ""}${p.state === "held" ? p.why : p.state === "not checked yet" ? html`<span class="muted">Not checked yet</span>` : html`<span class="muted">Still shown</span>`}</td><td class="nowrap">${checkButtons(p.id, "/admin/feedback")}</td></tr>`,
        )}</table>`
      : ""}
${inside.length
      ? html`<h2>Added to or reopened inside a known issue (${inside.length})</h2>
<table>${inside.map((i) => html`<tr><td><a href="/admin/feedback/${i.id}">${i.title}</a></td><td class="muted">in <a href="/admin/feedback/${i.group_id}">a known issue</a> that's ${STATUS_NAMES[i.group_status]?.toLowerCase() ?? i.group_status}</td></tr>`)}</table>`
      : ""}
<div class="queue">${rows.map((r) => card(r, full.get(r.id) ?? null, known, filter))}</div>`,
  );
}

function checkButtons(postId: string, back: string): Raw {
  return html`<form method="post" action="/admin/feedback/posts/${postId}/show" style="display:inline"><input type="hidden" name="back" value="${back}"><button class="btn" type="submit">Show it</button></form>
<form method="post" action="/admin/feedback/posts/${postId}/remove" style="display:inline"><input type="hidden" name="back" value="${back}"><button class="btn ghost" type="submit">Remove</button></form>`;
}

function sortedLines(s: Sorted): Raw {
  if (s === "not yet") return html`<p class="muted">Waiting to be sorted.</p>`;
  if (!s || typeof s !== "object") return html``;
  return html`<p class="said">${s.summary}</p><p class="muted">${s.why}${s.by_ai ? "" : " (Not sorted by AI.)"}${"looks_like" in s && s.looks_like ? html` Looks like <a href="/admin/feedback/${s.looks_like}">another public topic</a>; merge it if it is.` : ""}</p>`;
}

function card(r: Row, f: Feedback | null, known: KnownOption[], filter: string): Raw {
  const sev = SEVERITY_NUMBER[r.severity] ?? 3;
  return html`<article class="note case sev${sev}" id="f-${r.id}">
  <div class="row">${severityPill(sev)} ${r.status !== "new" ? html`<span class="pill">${STATUS_NAMES[r.status]}</span> ` : ""}${r.public ? html`<span class="pill info">Public</span> ` : ""}<a href="/admin/feedback/${r.id}"><strong>${r.known_issue ?? r.title}</strong></a>
    <span class="muted">${KIND_LABELS[r.kind].label}${r.area ? ` · ${r.area}` : ""} · ${r.developers === 1 ? "1 developer" : `${r.developers} developers`} · ${r.posts === 1 ? "1 post" : `${r.posts} posts`}${r.game ? ` · ${r.game}` : ""}</span></div>
  ${r.known_issue ? html`<p class="muted">Known issue. First filed as “${r.title}”.</p>` : ""}
  ${sortedLines(r.sorted)}
  ${r.latest ? html`<p class="latest"><span class="muted">Latest, by ${r.latest.by}:</span> ${r.latest.text}</p>` : ""}
  ${f ? decideForm(f, r.sorted, known, "queue", filter) : ""}
</article>`;
}

function decideForm(f: Feedback, sorted: Sorted, known: KnownOption[], back: "queue" | "item", filter = "new"): Raw {
  const draft = typeof sorted === "object" && sorted && "draft_known_issue" in sorted ? sorted.draft_known_issue : undefined;
  const isKnown = Boolean(f.known_title);
  const title = f.known_title ?? draft?.title ?? "";
  const merged = Boolean(f.group_id);
  return html`<form method="post" action="/admin/feedback/${f.id}/decide" class="decide">
  <input type="hidden" name="back" value="${back}"><input type="hidden" name="status_filter" value="${filter}">
  <label>Reply${f.public ? " in the public topic (every developer sees it)" : merged ? " to the developer" : isKnown ? " (with a status change, every developer in it gets it)" : " to the developer (if you make it a known issue, only they get this)"} <textarea name="reply" rows="2" maxlength="8000" placeholder="From Zaisma"></textarea></label>
  ${merged
    ? ""
    : html`<div class="precedent">
    <label class="check"><input type="checkbox" name="known" value="1"${isKnown ? raw(" checked") : ""}> ${isKnown ? html`A known issue every developer sees` : draft ? html`Make it a known issue every developer sees: <strong>${draft.title}</strong> <span class="muted">(the AI's draft${f.public ? "" : "; a new public topic of Zaisma's own, without the developer's words"})</span>` : f.public ? "Make this public topic a known issue" : "Make it a known issue: a new public topic of Zaisma's own, without the developer's words"}</label>
    <details><summary>${isKnown ? "Edit the known issue" : draft ? "Edit it first" : "Write the known issue"}</summary>
      <label>Title: general, with no names, games or anything said in private <input name="k_title" maxlength="120" value="${title}"></label>
      <label>Until it's fixed (optional) <textarea name="k_workaround" rows="2" maxlength="2000">${f.workaround ?? draft?.workaround ?? ""}</textarea></label>
      <label>Roadmap item (optional, as in docs/ROADMAP.md) <input name="k_roadmap" maxlength="200" value="${f.roadmap ?? ""}"></label>
    </details>
  </div>`}
  <div class="row">
    <select name="status" aria-label="Status">${FEEDBACK_STATUSES.map((s) => html`<option value="${s}"${s === f.status ? raw(" selected") : ""}>${STATUS_NAMES[s]}</option>`)}</select>
    <select name="severity" aria-label="How serious">${[1, 2, 3, 4].map((n) => html`<option value="${n}"${n === f.severity ? raw(" selected") : ""}>${["", "Urgent", "High", "Normal", "Low"][n]}</option>`)}</select>
    <select name="area" aria-label="Area"><option value="">No area</option>${FEEDBACK_AREAS.map((a) => html`<option${a === f.area ? raw(" selected") : ""}>${a}</option>`)}</select>
    ${merged
      ? ""
      : html`<select name="merge_into" aria-label="Merge into a known issue"><option value="">Don't merge</option>${known.filter((k) => k.id !== f.id).map((k) => html`<option value="${k.id}">Merge into: ${k.known_title}</option>`)}</select>`}
    <button class="btn" type="submit">Save</button>
  </div>
</form>`;
}

async function itemPage(env: Env, id: string, error: string): Promise<Response> {
  const [found, known, f] = await Promise.all([adminFeedbackItem(env, id), knownOptions(env), env.DB.prepare("SELECT * FROM feedback WHERE id = ?").bind(id).first<Feedback>()]);
  if (!found || !f) return new Response("Not found", { status: 404 });
  const d: Item = found.data;
  const sev = SEVERITY_NUMBER[d.severity] ?? 3;
  return adminPage(
    env,
    d.title,
    html`<p><a href="/admin/feedback">Feedback</a></p>
<h1>${d.known_issue?.title ?? d.title}</h1>
<p class="row">${severityPill(sev)} <span class="pill">${STATUS_NAMES[d.status]}</span> ${d.public ? html`<span class="pill info">Public</span> <a href="/forum/${d.id}">Open in the forum</a>` : html`<span class="pill">Private</span>`} <span class="muted">${KIND_LABELS[d.kind].label}${d.area ? ` · ${d.area}` : ""} · from ${d.developer}${d.game ? html` · <a href="/g/${d.game.slug}">${d.game.title}</a>` : ""}</span></p>
${error ? html`<p class="note" style="color:var(--danger)">${error}</p>` : ""}
${d.known_issue ? html`<div class="note"><p><strong>Known issue</strong> · ${d.known_issue.developers === 1 ? "1 developer" : `${d.known_issue.developers} developers`}${d.known_issue.roadmap ? ` · roadmap: ${d.known_issue.roadmap}` : ""}. First filed as “${d.title}”.</p>${d.known_issue.workaround ? html`<p>Until it's fixed: ${d.known_issue.workaround}</p>` : ""}</div>` : ""}
${d.merged_into ? html`<p class="note">Merged into <a href="/admin/feedback/${d.merged_into.id}">${d.merged_into.title}</a> (${STATUS_NAMES[d.merged_into.status]?.toLowerCase()}).</p>` : ""}
<div class="case">${sortedLines(d.sorted)}</div>
<h2>Posts (${d.posts.length})</h2>
<div class="queue">${d.posts.map(
      (p) => html`<article class="note case">
  <div class="row"><strong>${p.by}</strong> <span class="muted">${p.via}${p.kind === "reopen" ? " · reopened it" : ""} · ${p.at}</span>${"check" in p && p.check && p.check !== "shown" ? html` <span class="pill pending">${p.check}</span> ${checkButtons(p.id, `/admin/feedback/${d.id}`)}` : ""}</div>
  <p class="said" style="white-space:pre-wrap">${p.text}</p>
  ${p.context ? html`<details><summary>What was attached</summary><pre>${JSON.stringify(p.context, null, 2)}</pre></details>` : ""}
  ${p.picture ? html`<p><a href="/admin/feedback/pictures/${p.id}" target="_blank">Screenshot</a></p>` : ""}
</article>`,
    )}</div>
${d.merged_here.length
      ? html`<h2>Merged into this (${d.merged_here.length})</h2>
<table><tr><th>Item</th><th>Developer</th><th>Status</th><th>Latest</th></tr>${d.merged_here.map(
          (m) => html`<tr><td><a href="/admin/feedback/${m.id}">${m.title}</a></td><td>${m.developer}</td><td>${STATUS_NAMES[m.status]}</td><td>${m.latest ? html`<span class="muted">${m.latest.by}:</span> ${m.latest.text}` : ""}</td></tr>`,
        )}</table>`
      : ""}
<h2>Decide</h2>
<div class="note case">${decideForm(f, d.sorted, known, "item")}</div>`,
  );
}

/** A screenshot a developer or their AI attached. */
async function picture(env: Env, postId: string): Promise<Response> {
  const post = await env.DB.prepare("SELECT picture FROM feedback_posts WHERE id = ?").bind(postId).first<{ picture: string | null }>();
  const object = post?.picture ? await env.GAMES.get(feedbackPictureKey(postId)) : null;
  if (!post?.picture || !object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: { "Content-Type": post.picture, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" },
  });
}
