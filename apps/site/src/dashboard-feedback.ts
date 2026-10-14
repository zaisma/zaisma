import { FEEDBACK_CLOSED, FEEDBACK_KINDS, FEEDBACK_LIMITS, type FeedbackKind, type FeedbackStatus } from "@zaisma/core";
import { ApiError, route, type Caller } from "./developer.ts";
import type { Env } from "./env.ts";
import { html, raw, type Raw } from "./html.ts";
import { notice, page, redirect, when, type Call } from "./dashboard.ts";

/**
 * Feedback about Zaisma in the dashboard: your items and the known issues, a form to send one, and
 * each thread. Like the rest of the dashboard it's the developer API as the signed-in account, so it
 * shows exactly what your AI sees through the MCP, and what you write here is labelled as yours.
 */

interface KnownJson {
  id: string;
  title: string;
  kind: FeedbackKind;
  status: FeedbackStatus;
  workaround: string | null;
  roadmap: string | null;
  developers: number;
  yours: string | null;
  updated_at: number;
}
interface ItemJson {
  id: string;
  kind: FeedbackKind;
  title: string;
  status: FeedbackStatus;
  game: string | null;
  known_issue: (Partial<KnownJson> & { id: string; title: string; status: FeedbackStatus; workaround: string | null }) | null;
  news: boolean;
  created_at: number;
  updated_at: number;
}
interface PostJson {
  id: string;
  by: "you" | "your AI" | "Zaisma";
  via: string;
  kind: "post" | "reopen" | "status";
  text: string;
  context: unknown;
  picture_url: string | null;
  at: number;
}

export const KIND_LABELS: Record<FeedbackKind, { label: string; hint: string }> = {
  bug: { label: "Bug", hint: "Something in Zaisma doesn't work as it should." },
  gap: { label: "Something missing", hint: "A limit, or a missing piece, blocks you." },
  feature: { label: "Idea", hint: "Something that would make Zaisma better for you." },
  question: { label: "Question", hint: "Ask how something works." },
};
const STATUS_LABELS: Record<FeedbackStatus, string> = { new: "Waiting for Zaisma", known: "Known", planned: "Planned", fixed: "Fixed", wont: "Won't change", answered: "Answered" };
const STATUS_PILL: Record<FeedbackStatus, string> = { new: "pending", known: "held", planned: "info", fixed: "live", wont: "removed", answered: "live" };
const BY_LABELS: Record<PostJson["by"], string> = { you: "You", "your AI": "Your AI", Zaisma: "Zaisma" };
const DONE: Record<string, string> = {
  sent: "Sent. Zaisma's AI sorts it within minutes, and a person reads it. Replies show here and to your AI.",
  added: "Added.",
  reopened: "Reopened. A person will look at it again.",
};

const statusPill = (s: FeedbackStatus) => html`<span class="pill ${STATUS_PILL[s]}">${STATUS_LABELS[s]}</span>`;

export async function handleFeedbackPages(request: Request, env: Env, path: string, call: Call, caller: Caller): Promise<Response | null> {
  const post = request.method === "POST";
  const url = new URL(request.url);
  if (path === "/dashboard/feedback") {
    if (!post) return listPage(env, call, url.searchParams.get("q") ?? "");
    const form = await request.formData();
    const field = (name: string) => String(form.get(name) ?? "").trim();
    try {
      const { feedback } = (await call("POST", "/feedback", {
        kind: field("kind"),
        title: field("title"),
        text: field("text"),
        ...(field("game") ? { game: field("game") } : {}),
        ...(await picture(form)),
      })) as { feedback: ItemJson };
      return redirect(`/dashboard/feedback/${feedback.id}?done=sent`);
    } catch (err) {
      if (err instanceof ApiError) return listPage(env, call, "", { error: err.message, form: Object.fromEntries([...form].filter(([, v]) => typeof v === "string")) as Record<string, string> }, err.status);
      throw err;
    }
  }

  const m = path.match(/^\/dashboard\/feedback\/([a-z0-9]{1,40})(?:\/(posts|pictures\/([a-z0-9]{1,40})))?$/);
  if (!m) return null;
  const [, id, sub, postId] = m as unknown as [string, string, string | undefined, string | undefined];
  // Screenshots come straight from the API, which checks they're yours.
  if (postId && !post) {
    try {
      return await route(new Request(`${env.SITE_ORIGIN}/api/dev/feedback/${id}/pictures/${postId}`), env, `/feedback/${id}/pictures/${postId}`, caller);
    } catch (err) {
      if (err instanceof ApiError) return new Response(err.message, { status: err.status });
      throw err;
    }
  }
  if (sub === "posts" && post) {
    const form = await request.formData();
    const reopen = form.get("reopen") === "1";
    try {
      const { feedback } = (await call("POST", `/feedback/${id}/posts`, { text: String(form.get("text") ?? "").trim(), ...(reopen ? { reopen: true } : {}), ...(await picture(form)) })) as { feedback: ItemJson };
      // Adding to a known issue files your own item under it: go to that.
      return redirect(`/dashboard/feedback/${feedback.id}?done=${feedback.id === id ? (reopen ? "reopened" : "added") : "sent"}#latest`);
    } catch (err) {
      if (err instanceof ApiError) return itemPage(env, call, id, { error: err.message, text: String(form.get("text") ?? "") }, err.status);
      throw err;
    }
  }
  if (!sub && !post) return itemPage(env, call, id, { done: url.searchParams.get("done") ?? undefined });
  return redirect(`/dashboard/feedback/${id}`);
}

/** A screenshot from the form, as the API takes it. */
async function picture(form: FormData): Promise<{ picture?: string }> {
  const file = form.get("picture");
  if (!(file instanceof File) || file.size === 0) return {};
  if (file.size > FEEDBACK_LIMITS.pictureBytes) throw new ApiError(413, "picture_too_big", `Screenshots can be up to ${FEEDBACK_LIMITS.pictureBytes / 1048576} MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { picture: btoa(s) };
}

// --- Your feedback and the known issues ---

async function listPage(env: Env, call: Call, q: string, opts: { error?: string; form?: Record<string, string> } = {}, status = 200): Promise<Response> {
  const [data, { games }] = (await Promise.all([call("GET", `/feedback${q ? `?q=${encodeURIComponent(q)}` : ""}`), call("GET", "/games")])) as unknown as [
    { mine: ItemJson[]; known_issues: KnownJson[]; news: number },
    { games: { slug: string; title: string }[] },
  ];
  const f = opts.form ?? {};
  const kind = (FEEDBACK_KINDS as readonly string[]).includes(f.kind ?? "") ? f.kind : "bug";
  return page(
    env,
    "Feedback",
    html`<div class="dash-head"><h1>Feedback</h1>
<form class="find" method="get" action="/dashboard/feedback" role="search"><input type="search" name="q" value="${q}" maxlength="500" placeholder="Search, like an error or what failed" aria-label="Search your feedback and the known issues"><button class="btn ghost" type="submit">Search</button></form></div>
<p class="lead">Tell the people who build Zaisma what's broken, what's missing and what you'd like. What you send is private to you and Zaisma; known issues are for every developer.</p>
${notice(opts)}
<div class="manage">
<section class="main">
${q ? html`<p class="muted">Matching “${q}”. <a href="/dashboard/feedback">Show everything</a></p>` : ""}
<h2 class="rule-h" id="yours">Yours${data.news ? html` <span class="badge">${data.news === 1 ? "1 reply" : `${data.news} replies`}</span>` : ""}</h2>
${data.mine.length
      ? html`<ul class="items">${data.mine.map((i) => itemRow(i))}</ul>`
      : html`<p class="muted">${q ? "Nothing of yours matches." : "Nothing sent yet."}</p>`}
<h2 class="rule-h" id="known">Known issues</h2>
${data.known_issues.length
      ? html`<p class="hint">Problems Zaisma knows about, with what to do until they're fixed. If one is yours too, add your case so it counts and you hear when it's fixed.</p>
<ul class="items">${data.known_issues.map((k) => knownRow(k))}</ul>`
      : html`<p class="muted">${q ? "No known issue matches." : "None right now."}</p>`}
</section>
<aside>
<h2 id="send">Send feedback</h2>
<form class="stack" method="post" action="/dashboard/feedback" enctype="multipart/form-data">
<fieldset class="choices"><legend>What is it?</legend>${FEEDBACK_KINDS.map(
      (k) => html`<label class="check"><input type="radio" name="kind" value="${k}"${k === kind ? raw(" checked") : ""}><span>${KIND_LABELS[k].label}<small class="muted">${KIND_LABELS[k].hint}</small></span></label>`,
    )}</fieldset>
<label>Title <input name="title" required maxlength="${FEEDBACK_LIMITS.title}" value="${f.title ?? ""}" placeholder="Upload stops at 99% for a 300 MB build"></label>
<label>What happened <textarea name="text" required maxlength="${FEEDBACK_LIMITS.text}" rows="6" placeholder="What you did, what you expected and what happened instead.">${f.text ?? ""}</textarea></label>
${games.length
      ? html`<label>Which game (optional) <select name="game"><option value="">None</option>${games.map((g) => html`<option value="${g.slug}"${g.slug === f.game ? raw(" selected") : ""}>${g.title}</option>`)}</select></label>`
      : ""}
<label>Screenshot (optional, PNG, JPEG or WebP up to ${FEEDBACK_LIMITS.pictureBytes / 1048576} MB) <input type="file" name="picture" accept="image/png,image/jpeg,image/webp"></label>
<button class="btn light" type="submit">Send</button>
<p class="hint">Don't paste keys or passwords: anything that looks like one is blanked before it's saved. Up to ${FEEDBACK_LIMITS.postsPerDay} posts a day.</p>
</form>
<div class="way plate bevel-s"><h3>From your AI</h3><p class="muted">With the Zaisma MCP, your AI can check the known issues and send feedback when something fails, with the exact error. Its posts are labelled as your AI's, and you see them here.</p></div>
</aside>
</div>`,
    status,
    null,
    "feedback",
  );
}

function itemRow(i: ItemJson): Raw {
  return html`<li class="plate${i.news ? " news" : ""}"><a class="i-title" href="/dashboard/feedback/${i.id}">${i.title}</a>
<div class="i-meta">${statusPill(i.status)}<span>${KIND_LABELS[i.kind].label}</span>${i.game ? html`<span>${i.game}</span>` : ""}${i.known_issue ? html`<span>${i.known_issue.id === i.id ? "Every developer sees it as" : "In the known issue"} “${i.known_issue.title}”</span>` : ""}<span>${when(i.updated_at)}</span>${i.news ? html`<span class="badge">Zaisma replied</span>` : ""}</div></li>`;
}

function knownRow(k: KnownJson): Raw {
  return html`<li class="plate"><a class="i-title" href="/dashboard/feedback/${k.id}">${k.title}</a>
<div class="i-meta">${statusPill(k.status)}<span>${k.developers === 1 ? "1 developer" : `${k.developers} developers`}</span>${k.roadmap ? html`<span>On the roadmap: ${k.roadmap}</span>` : ""}${k.yours ? html`<span class="badge">Yours too</span>` : ""}</div>
${k.workaround ? html`<p class="i-work"><strong>Until it's fixed:</strong> ${k.workaround}</p>` : ""}</li>`;
}

// --- One item, or a known issue ---

async function itemPage(env: Env, call: Call, id: string, opts: { done?: string; error?: string; text?: string }, status = 200): Promise<Response> {
  let data: { feedback?: ItemJson & { known_issue: KnownJson | null; posts: PostJson[]; posts_left_today: number }; known_issue?: KnownJson };
  try {
    data = (await call("GET", `/feedback/${id}`)) as typeof data;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return page(env, "Not found", html`<h1>Not found</h1><p class="lead">You have no feedback with that link, and it isn't a known issue.</p><a class="btn ghost" href="/dashboard/feedback">Feedback</a>`, 404, null, "feedback");
    throw err;
  }
  const crumbs = html`<p class="crumbs"><a href="/dashboard/feedback">Feedback</a></p>`;
  const msg = notice({ done: opts.done ? DONE[opts.done] : undefined, error: opts.error });

  if (data.known_issue) {
    const k = data.known_issue;
    return page(
      env,
      k.title,
      html`${crumbs}<h1>${k.title}</h1>
<p class="i-meta">${statusPill(k.status)}<span>Known issue</span><span>${k.developers === 1 ? "1 developer" : `${k.developers} developers`}</span>${k.roadmap ? html`<span>On the roadmap: ${k.roadmap}</span>` : ""}</p>
${msg}
${k.workaround ? html`<div class="note work"><p><strong>Until it's fixed:</strong> ${k.workaround}</p></div>` : ""}
${k.yours
        ? html`<p>You've told Zaisma about this too. <a href="/dashboard/feedback/${k.yours}">Open yours</a></p>`
        : html`<h2 class="rule-h">Does it happen to you?</h2>
<p class="hint">Add your case: it counts toward how many developers this affects, and you hear when it's fixed. What you write is private to you and Zaisma.</p>
${addForm(id, false, opts.text, "Add my case")}`}`,
      status,
      null,
      "feedback",
    );
  }

  const f = data.feedback!;
  const closed = FEEDBACK_CLOSED.includes(f.status);
  const known = f.known_issue;
  return page(
    env,
    f.title,
    html`${crumbs}<h1>${f.title}</h1>
<p class="i-meta">${statusPill(f.status)}<span>${KIND_LABELS[f.kind].label}</span>${f.game ? html`<a href="/dashboard/${f.game}">${f.game}</a>` : ""}<span>Sent ${when(f.created_at)}</span></p>
${msg}
${known && known.id !== f.id
      ? html`<div class="note work"><p>Part of the known issue <a href="/dashboard/feedback/${known.id}"><strong>${known.title}</strong></a> · ${known.developers === 1 ? "1 developer" : `${known.developers} developers`}${known.roadmap ? ` · on the roadmap: ${known.roadmap}` : ""}</p>${known.workaround ? html`<p><strong>Until it's fixed:</strong> ${known.workaround}</p>` : ""}</div>`
      : known
        ? html`<div class="note work"><p>Every developer sees this as a known issue: <strong>${known.title}</strong>${known.developers > 1 ? ` · ${known.developers} developers` : ""}</p>${known.workaround ? html`<p><strong>Until it's fixed:</strong> ${known.workaround}</p>` : ""}</div>`
        : ""}
${opts.done === "sent" ? await matches(call, f) : ""}
<ol class="thread">${f.posts.map((p, n) => postRow(f.id, p, n === f.posts.length - 1))}</ol>
<h2 class="rule-h" id="add">${closed ? "Back again?" : "Add to it"}</h2>
<p class="hint">${closed ? "If it's happening again or the answer didn't help, reopen it and a person looks again. " : "What you found since, another case, a screenshot. "}${f.posts_left_today} of ${FEEDBACK_LIMITS.postsPerDay} posts left today.</p>
${addForm(f.id, closed, opts.text, closed ? "Reopen it" : "Add")}`,
    status,
    null,
    "feedback",
  );
}

/** Right after sending: known issues that look like the same problem, so the workaround is there at once. */
async function matches(call: Call, f: ItemJson & { posts: PostJson[] }): Promise<Raw | string> {
  if (f.known_issue) return "";
  const q = `${f.title} ${f.posts[0]?.text ?? ""}`.slice(0, 500);
  const { known_issues } = (await call("GET", `/feedback?q=${encodeURIComponent(q)}`)) as { known_issues: KnownJson[] };
  const found = known_issues.filter((k) => k.yours !== f.id).slice(0, 3);
  if (!found.length) return "";
  return html`<div class="note"><p><strong>These known issues look similar.</strong> If one is the same problem, there's nothing more to do: Zaisma adds yours to it, and you hear when it's fixed.</p>
<ul class="items">${found.map((k) => knownRow(k))}</ul></div>`;
}

function postRow(itemId: string, p: PostJson, last: boolean): Raw {
  const picture = p.picture_url ? `/dashboard/feedback/${itemId}/pictures/${p.id}` : null;
  return html`<li class="plate post ${p.by === "Zaisma" ? "zaisma" : ""}"${last ? raw(' id="latest"') : ""}>
<div class="p-head"><strong>${BY_LABELS[p.by]}</strong>${p.kind === "reopen" ? html`<span class="pill pending">Reopened</span>` : ""}${p.by === "your AI" ? html`<span class="muted">through the ${p.via === "mcp" ? "MCP" : p.via === "cli" ? "upload command" : "API"}</span>` : ""}<span class="muted">${when(p.at)}</span></div>
<p class="p-text">${p.text}</p>
${p.context ? html`<details><summary>What ${p.by === "you" ? "you" : "your AI"} attached</summary><pre>${JSON.stringify(p.context, null, 2)}</pre></details>` : ""}
${picture ? html`<a class="p-pic" href="${picture}" target="_blank" rel="noopener"><img src="${picture}" alt="Screenshot" loading="lazy"></a>` : ""}
</li>`;
}

function addForm(id: string, reopen: boolean, text = "", label: string): Raw {
  return html`<form class="stack" method="post" action="/dashboard/feedback/${id}/posts" enctype="multipart/form-data">
${reopen ? html`<input type="hidden" name="reopen" value="1">` : ""}
<label>${reopen ? "What's happening now" : "What to add"} <textarea name="text" required maxlength="${FEEDBACK_LIMITS.text}" rows="4">${text}</textarea></label>
<label>Screenshot (optional) <input type="file" name="picture" accept="image/png,image/jpeg,image/webp"></label>
<button class="btn light" type="submit">${label}</button>
</form>`;
}

export const FEEDBACK_STYLES = `
.find{display:flex;gap:8px;flex-wrap:wrap}
.find input{width:300px;max-width:100%}
.items{list-style:none;padding:0;margin:0 0 12px;display:grid;gap:10px}
.items>li{padding:12px 16px;display:grid;gap:6px}
.items>li.news{box-shadow:inset 3px 0 0 var(--ok),var(--rim),var(--drop)}
.i-title{font-family:var(--display);font-size:17px;font-weight:600;text-decoration:none}
.i-title:hover{text-decoration:underline;text-underline-offset:3px}
.i-meta{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;margin:0;color:var(--muted);font-size:13px}
h1+.i-meta{margin:0 0 20px}
.i-work{margin:0;color:var(--text-2);font-size:14px}
.work{margin-bottom:20px;display:grid;gap:6px}
.work p{margin:0}
.thread{list-style:none;padding:0;margin:0 0 12px;display:grid;gap:12px;max-width:760px}
.post{padding:14px 16px;display:grid;gap:8px}
.post.zaisma{box-shadow:inset 3px 0 0 #c9cace,var(--rim),var(--drop)}
.p-head{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center}
.p-text{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--text-2)}
.post details pre{margin:0;max-height:320px;overflow:auto}
.p-pic img{max-width:100%;max-height:320px;display:block;background:var(--pic)}
.manage aside .way{margin-top:20px;padding:16px}
.manage aside .way p{margin:0}
@media (max-width:520px){.find{width:100%}.find input{flex:1;width:auto}}
`;
