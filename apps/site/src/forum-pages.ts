import {
  FEEDBACK_KINDS,
  FEEDBACK_LIMITS,
  FEEDBACK_PRIVATE_KINDS,
  FORUM_CATEGORIES,
  FORUM_TAGS,
  forumAreaName,
  forumCategoryOf,
  type FeedbackKind,
  type FeedbackStatus,
} from "@zaisma/core";
import { currentSession } from "./auth.ts";
import { ApiError, apiCall, callerFor, route, type Caller } from "./developer.ts";
import type { Env } from "./env.ts";
import { esc, html, layout, raw, type Raw } from "./html.ts";
import {
  areasOf,
  createTopic,
  follow,
  getTopic,
  listTopics,
  markAnswer,
  queryFrom,
  replyTo,
  similarTopics,
  unreadCount,
  vote,
  type ForumQuery,
  type Person,
  type PostJson,
  type TopicRow,
  type Viewer,
} from "./forum.ts";

/**
 * The developer forum's pages (docs/DECISIONS.md): the topic list with its category rail, a topic,
 * and a new topic. Anyone can read what's public; posting needs an account. Every read and change is
 * the same function the API and MCP call (forum.ts), so a developer and their AI see the same forum.
 */

type Topic = Awaited<ReturnType<typeof getTopic>>;

export const KINDS: Record<FeedbackKind, { label: string; plural: string; hint: string }> = {
  bug: { label: "Bug", plural: "Bugs", hint: "Something in Zaisma doesn't work as it should." },
  gap: { label: "Missing", plural: "Missing", hint: "A limit, or a missing piece, blocks you." },
  feature: { label: "Idea", plural: "Ideas", hint: "Something that would make Zaisma better for you." },
  question: { label: "Question", plural: "Questions", hint: "How something works, or how to do something." },
  talk: { label: "Discussion", plural: "Discussions", hint: "Anything else about making games on Zaisma." },
};
const STATUS: Record<FeedbackStatus, { label: string; pill: string }> = {
  new: { label: "Open", pill: "" },
  known: { label: "Known", pill: "held" },
  planned: { label: "Planned", pill: "info" },
  fixed: { label: "Fixed", pill: "live" },
  wont: { label: "Won't change", pill: "removed" },
  answered: { label: "Answered", pill: "live" },
};
const DONE: Record<string, string> = {
  posted: "Posted.",
  "posted-private": "Sent to Zaisma. Its AI sorts it within minutes and a person reads it; replies show here and to your AI.",
  checking: "Posted. Others see it once it's checked, usually within minutes.",
  held: "Posted. A person at Zaisma checks it before others see it, usually within a day.",
  replied: "Replied.",
  reopened: "Reopened. A person at Zaisma looks at it again.",
};

const stroke = (paths: string, fill = false) =>
  raw(`<svg viewBox="0 0 20 20" fill="${fill ? "currentColor" : "none"}" stroke="${fill ? "none" : "currentColor"}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`);
const ICONS = {
  bug: stroke('<path d="M7.2 6.4a2.8 2.8 0 0 1 5.6 0"/><rect x="5.6" y="6.4" width="8.8" height="10.2" rx="4.4"/><path d="M10 9.2v7.2M2.8 9.6h2.8M14.4 9.6h2.8M2.8 14h2.8M14.4 14h2.8M5 3.6l2 2M15 3.6l-2 2"/>'),
  gap: stroke('<rect x="3.5" y="3.5" width="13" height="13" stroke-dasharray="3 2.6"/><path d="M10 7v6M7 10h6"/>'),
  feature: stroke('<path d="M7.2 13.4C5.6 12.4 4.6 10.8 4.6 9a5.4 5.4 0 0 1 10.8 0c0 1.8-1 3.4-2.6 4.4v2H7.2z"/><path d="M8 18h4"/>'),
  question: stroke('<circle cx="10" cy="10" r="7.4"/><path d="M7.9 7.9a2.2 2.2 0 1 1 3.1 2c-.6.3-1 .8-1 1.5v.5"/><path d="M10 14.4v.2"/>'),
  talk: stroke('<path d="M3 4h10.5v7.2H8.2l-3 2.6v-2.6H3z"/><path d="M13.5 7.6H17v6.6h-1.6v2.4l-2.8-2.4H9.2v-2"/>'),
  known: stroke('<path d="M7.2 3h5.6l-.9 5 3.1 3.2H5l3.1-3.2z"/><path d="M10 11.2V17.4"/>'),
  replies: stroke('<path d="M3.5 4.5h13v9h-7l-4 3v-3h-2z"/>'),
  vote: stroke('<path d="M10 3.5l6 6.8h-3.6v6.2H7.6v-6.2H4z"/>'),
  lock: stroke('<rect x="4.5" y="9" width="11" height="8"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/>'),
  check: stroke('<path d="M4 10.5l4 4 8-9"/>'),
  ai: stroke('<path d="M10 1.8l2 6.2 6.2 2-6.2 2-2 6.2-2-6.2-6.2-2 6.2-2z"/>', true),
  reply: stroke('<path d="M8 5L3.5 9.5 8 14"/><path d="M3.5 9.5H12a4.5 4.5 0 0 1 4.5 4.5v1"/>'),
  plus: stroke('<path d="M10 4v12M4 10h12"/>'),
  cross: stroke('<path d="M5 5l10 10M15 5L5 15"/>'),
};
const kindIcon = (t: { kind: FeedbackKind; known_issue: boolean }) => (t.known_issue ? ICONS.known : ICONS[t.kind]);

export async function handleForum(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path !== "/forum" && !path.startsWith("/forum/")) return null;
  const post = request.method === "POST";
  if (post && request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return new Response("Bad origin", { status: 403 });
  const url = new URL(request.url);
  const session = await currentSession(request, env);
  const caller = session ? await callerFor(env, session.userId, session.cookies) : null;
  const done = (res: Response) => withCookies(res, session?.cookies ?? []);
  const signIn = () => done(redirect(`/signin?next=${encodeURIComponent(path + url.search)}`));
  const ctx: Ctx = { env, viewer: caller, me: caller ? await mePerson(env, caller) : null, url };

  try {
    if (path === "/forum/similar") return done(await similarFragment(ctx, url.searchParams.get("q") ?? ""));
    if (path === "/forum") {
      const query = queryFrom(url.searchParams);
      if (query.tab === "yours" && !caller) return signIn();
      return done(await listPage(ctx, query));
    }
    if (path === "/forum/new") {
      if (!caller) return signIn();
      if (!post) return done(await newPage(ctx, Object.fromEntries(url.searchParams)));
      const form = await request.formData();
      const field = (name: string) => String(form.get(name) ?? "").trim();
      try {
        const res = (await createTopic(env, caller, {
          kind: field("kind"),
          title: field("title"),
          text: field("text"),
          ...(field("category") ? { category: field("category") } : {}),
          tags: form.getAll("tags").map(String),
          public: field("visibility") !== "private",
          ...(field("game") ? { game: field("game") } : {}),
          ...(field("known_issue") ? { known_issue: field("known_issue") } : {}),
          ...(await picture(form)),
        })) as Topic & { note?: string };
        const t = res.topic;
        const state = !t.public ? "posted-private" : t.shown ? "posted" : res.posts[0]?.state === "held" ? "held" : "checking";
        return done(redirect(`/forum/${t.id}?done=${state}`));
      } catch (err) {
        if (err instanceof ApiError) return done(await newPage(ctx, Object.fromEntries([...form].filter(([, v]) => typeof v === "string")) as Record<string, string>, err.message, err.status, form.getAll("tags").map(String)));
        throw err;
      }
    }

    const m = path.match(/^\/forum\/([a-z0-9]{1,40})(?:\/(reply|vote|follow|answer|pictures\/([a-z0-9]{1,40})))?$/);
    if (!m) return null;
    const [, id, sub, postId] = m as unknown as [string, string, string | undefined, string | undefined];
    if (!sub && !post) return done(await topicPage(ctx, id, { done: url.searchParams.get("done") ?? undefined, to: url.searchParams.get("to") ?? undefined }));
    if (!caller) return signIn();
    if (postId && !post) {
      try {
        return done(await route(new Request(`${env.SITE_ORIGIN}/api/dev/forum/${id}/pictures/${postId}`), env, `/forum/${id}/pictures/${postId}`, caller));
      } catch (err) {
        if (err instanceof ApiError) return new Response(err.message, { status: err.status });
        throw err;
      }
    }
    if (!post) return done(redirect(`/forum/${id}`));
    const form = await request.formData();
    const field = (name: string) => String(form.get(name) ?? "").trim();
    if (sub === "reply") {
      const reopen = form.get("reopen") === "1";
      try {
        const res = await replyTo(env, caller, id, { text: field("text"), ...(field("reply_to") ? { reply_to: field("reply_to") } : {}), ...(reopen ? { reopen: true } : {}), ...(await picture(form)) });
        const state = reopen ? "reopened" : res.post?.state === "checking" ? "checking" : res.post?.state === "held" ? "held" : "replied";
        return done(redirect(`/forum/${id}?done=${state}#${res.post ? `p-${res.post.id}` : "reply"}`));
      } catch (err) {
        if (err instanceof ApiError) return done(await topicPage(ctx, id, { error: err.message, text: field("text"), to: field("reply_to") || undefined }, err.status));
        throw err;
      }
    }
    try {
      if (sub === "vote") await vote(env, caller, id, form.get("on") === "1");
      if (sub === "follow") await follow(env, caller, id, form.get("on") === "1");
      if (sub === "answer") await markAnswer(env, caller, id, field("post") || null);
    } catch (err) {
      if (err instanceof ApiError) return done(await topicPage(ctx, id, { error: err.message }, err.status));
      throw err;
    }
    return done(redirect(`/forum/${id}${sub === "answer" && field("post") ? `#p-${field("post")}` : ""}`));
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return done(forumPage(ctx, "Not found", html`<div class="gone"><h1>Not found</h1><p class="lead">There's no topic here you can see. It may be private, or still being checked.</p><a class="btn ghost" href="/forum">Back to the forum</a></div>`, { status: 404 }));
    throw err;
  }
}

interface Ctx {
  env: Env;
  viewer: Viewer;
  me: Person | null;
  url: URL;
}

async function mePerson(env: Env, caller: Caller): Promise<Person> {
  const row = await env.DB.prepare("SELECT name FROM accounts WHERE id = ?").bind(caller.accountId).first<{ name: string }>();
  return { name: row?.name ?? "You", by: "developer", you: true };
}

function redirect(to: string): Response {
  return new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store" } });
}

function withCookies(res: Response, cookies: string[]): Response {
  if (!cookies.length) return res;
  const out = new Response(res.body, res);
  for (const c of cookies) out.headers.append("Set-Cookie", c);
  return out;
}

/** A screenshot from a form, as the API takes it. */
async function picture(form: FormData): Promise<{ picture?: string }> {
  const file = form.get("picture");
  if (!(file instanceof File) || file.size === 0) return {};
  if (file.size > FEEDBACK_LIMITS.pictureBytes) throw new ApiError(413, "picture_too_big", `Screenshots can be up to ${FEEDBACK_LIMITS.pictureBytes / 1048576} MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { picture: btoa(s) };
}

/** The site's page with the forum's search and New topic in the header. */
function forumPage(ctx: Ctx, title: string, body: Raw, opts: { status?: number; q?: string; keep?: Record<string, string> } = {}): Response {
  const res = layout(ctx.env, {
    title: `${title} · Zaisma forum`,
    body: html`<style>${raw(FORUM_STYLES)}</style>${body}<script>${raw(FORUM_SCRIPT)}</script>`,
    private: true,
    nav: "forum",
    search: { action: "/forum", q: opts.q ?? "", placeholder: "Search the forum", label: "Search the forum", keep: opts.keep },
    action: html`<a class="btn light new-topic" href="/forum/new${ctx.url.searchParams.get("category") ? `?category=${encodeURIComponent(ctx.url.searchParams.get("category")!)}` : ""}">${ICONS.plus}<span>New topic</span></a>`,
  });
  return new Response(res.body, { status: opts.status ?? 200, headers: res.headers });
}

// --- Bits every page uses ---

function hue(name: string): number {
  let h = 7;
  for (const c of name) h = (h * 31 + c.codePointAt(0)!) % 360;
  return h;
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [Array.from(words[0]!)[0], Array.from(words[1]!)[0]] : Array.from(words[0] ?? "?").slice(0, 2);
  return letters.join("").toUpperCase();
}

/** An account's picture: for now its initials on a plate in its own color. An AI's post shows its developer's, with the AI mark. */
export function avatar(p: Person, size: "xs" | "sm" | "md" = "md"): Raw {
  if (p.by === "zaisma") return html`<span class="av ${size} z" title="Zaisma"><img src="/zaisma-mark-small-black.svg" alt=""></span>`;
  return html`<span class="av ${size}" style="--h:${hue(p.name)}" title="${p.by === "ai" ? `${p.name}'s AI` : p.name}" aria-hidden="true">${initials(p.name)}${p.by === "ai" ? html`<i class="ai-mark">${ICONS.ai}</i>` : ""}</span>`;
}

/** A name as posts show it: the developer, an AI mark for their AI, a Team mark for Zaisma. */
function nameOf(p: Person): Raw {
  return html`<span class="who"><strong>${p.name}</strong>${p.by === "ai" ? html`<span class="mark ai" title="Written by ${p.you ? "your" : `${p.name}'s`} AI assistant">${ICONS.ai}AI</span>` : ""}${p.by === "zaisma" ? html`<span class="mark team">Team</span>` : ""}${p.you ? html`<span class="you">you</span>` : ""}</span>`;
}

function ago(ms: number): Raw {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  const text = s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : s < 86400 * 30 ? `${Math.floor(s / 86400)}d` : new Date(ms).toLocaleDateString("en", { month: "short", day: "numeric", year: s > 86400 * 300 ? "numeric" : undefined });
  return html`<time datetime="${new Date(ms).toISOString()}" title="${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC">${text}</time>`;
}

const statusPill = (s: FeedbackStatus, isPublic: boolean) => (s === "new" ? (isPublic ? "" : html`<span class="pill pending">Waiting for Zaisma</span>`) : html`<span class="pill ${STATUS[s].pill}">${STATUS[s].label}</span>`);

function link(q: ForumQuery, change: Partial<ForumQuery>): string {
  const next = { ...q, ...change };
  const p = new URLSearchParams();
  for (const k of ["q", "category", "kind", "tag", "tab"] as const) if (next[k]) p.set(k, String(next[k]));
  if (next.page && next.page > 1) p.set("page", String(next.page));
  const s = p.toString();
  return `/forum${s ? `?${s}` : ""}`;
}

function placeOf(area: string | null): { category: string; name: string; sub: string } | null {
  if (!area) return null;
  const c = forumCategoryOf(area);
  return c ? { category: c.id, name: c.name, sub: forumAreaName(area)! } : null;
}

const tagChip = (t: string) => html`<a class="tag" href="/forum?tag=${t}">${(FORUM_TAGS as Record<string, string>)[t] ?? t}</a>`;

/** Post text: plain words, with ``` code blocks, `code` and links. */
function richText(text: string): Raw {
  const parts = text.split("```");
  return raw(
    parts
      .map((part, i) => {
        if (i % 2 === 1) return `<pre><code>${esc(part.replace(/^[a-z0-9+-]*\n/i, ""))}</code></pre>`;
        return esc(part)
          .replace(/`([^`\n]+)`/g, "<code>$1</code>")
          .replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)'&]/g, (u) => `<a href="${u}" rel="nofollow ugc noopener" target="_blank">${u}</a>`);
      })
      .join(""),
  );
}

// --- The topic list ---

async function listPage(ctx: Ctx, query: ForumQuery): Promise<Response> {
  const data = await listTopics(ctx.env, ctx.viewer, query);
  const unread = ctx.viewer ? await unreadCount(ctx.env, ctx.viewer) : 0;
  const cat = query.category ? FORUM_CATEGORIES.find((c) => c.id === query.category) : undefined;
  const area = query.category && !cat ? placeOf(query.category) : null;
  const heading = data.tab === "yours" ? "Your topics" : data.tab === "known" && !query.category ? "Known issues" : area ? area.sub : cat ? cat.name : "All topics";
  const tabs = [
    ["latest", "Latest"],
    ["top", "Top"],
    ["unanswered", "Unanswered"],
    ["known", "Known issues"],
  ] as const;
  const filters = [["", "Everything"], ...FEEDBACK_KINDS.map((k) => [k, KINDS[k].plural])] as const;
  const keep: Record<string, string> = {};
  for (const k of ["category", "kind", "tag", "tab"] as const) if (query[k]) keep[k] = String(query[k]);
  return forumPage(
    ctx,
    heading,
    html`<div class="forum">
${rail(ctx, query, data.tab, unread)}
<section class="board" aria-labelledby="board-h">
  <div class="board-head">
    <h1 id="board-h">${area ? html`<a class="up" href="${link(query, { category: area.category, page: 1 })}">${area.name}</a><span class="sep">/</span>` : ""}${heading}</h1>
    ${data.tab === "yours" ? "" : html`<nav class="seg tabs" aria-label="Sort">${tabs.map(([t, label]) => html`<a href="${link(query, { tab: t === "latest" ? "" : t, page: 1 })}"${data.tab === t ? raw(' aria-current="page"') : ""}>${label}</a>`)}</nav>`}
  </div>
  <div class="filters">
    <nav class="chips" aria-label="What kind">${filters.map(([k, label]) => html`<a href="${link(query, { kind: k, page: 1 })}"${(query.kind ?? "") === k ? raw(' aria-current="true"') : ""}>${label}</a>`)}</nav>
    ${query.tag ? html`<a class="tag on" href="${link(query, { tag: "", page: 1 })}" title="Show every tag">${(FORUM_TAGS as Record<string, string>)[query.tag] ?? query.tag} ×</a>` : ""}
    ${query.q ? html`<span class="muted">Matching “${query.q}” · <a href="${link(query, { q: "", page: 1 })}">Clear</a></span>` : ""}
  </div>
  ${data.pinned.length
    ? html`<details class="pinned" open><summary>${ICONS.known}<span>Known issues${cat || area ? " here" : ""}</span><small>${data.pinned.length}</small></summary>
  <ol class="topics">${data.pinned.map((t) => topicRow(t, query))}</ol></details>`
    : ""}
  ${data.topics.length
    ? html`<div class="topics-head" aria-hidden="true"><span>Topic</span><span>People</span><span>Replies</span><span>Me too</span><span>Active</span></div>
  <ol class="topics">${data.topics.map((t) => topicRow(t, query))}</ol>`
    : html`<div class="empty-board"><p>${query.q ? "Nothing matches that." : data.tab === "yours" ? "You haven't posted yet. Topics you post, reply to or say Me too on show here." : data.tab === "unanswered" ? "Every question here has an answer." : "No topics here yet."}</p>${ctx.viewer ? html`<a class="btn ghost" href="/forum/new${query.category ? `?category=${query.category}` : ""}">Start a topic</a>` : ""}</div>`}
  ${data.page > 1 || data.more
    ? html`<nav class="pager" aria-label="Pages">${data.page > 1 ? html`<a class="btn ghost" href="${link(query, { page: data.page - 1 })}">Newer</a>` : ""}<span class="muted">Page ${data.page}</span>${data.more ? html`<a class="btn ghost" href="${link(query, { page: data.page + 1 })}">Older</a>` : ""}</nav>`
    : ""}
</section>
</div>`,
    { q: query.q, keep },
  );
}

function rail(ctx: Ctx, query: ForumQuery, tab: string, unread: number): Raw {
  const current = query.category ?? "";
  const openCat = FORUM_CATEGORIES.find((c) => c.id === current || current in c.areas)?.id;
  const here = (on: boolean) => (on ? raw(' aria-current="page"') : "");
  const all = !current && tab !== "yours" && tab !== "known";
  return html`<details class="rail" open>
<summary>${current ? (placeOf(current)?.sub ?? FORUM_CATEGORIES.find((c) => c.id === current)?.name) : tab === "yours" ? "Your topics" : "All topics"}</summary>
<nav aria-label="Forum">
  <a class="r-top" href="/forum"${here(all)}>All topics</a>
  ${ctx.viewer ? html`<a class="r-top" href="/forum?tab=yours"${here(tab === "yours")}>Your topics${unread ? html`<span class="count" title="Topics with something new">${unread}</span>` : ""}</a>` : ""}
  <a class="r-top" href="/forum?tab=known"${here(tab === "known" && !current)}>Known issues</a>
  <p class="r-head">Categories</p>
  ${FORUM_CATEGORIES.map(
    (c) => html`<div class="r-cat${openCat === c.id ? " open" : ""}"><a href="/forum?category=${c.id}"${here(current === c.id)}>${c.name}</a>${openCat === c.id
      ? html`<div class="r-subs">${Object.entries(c.areas).map(([a, name]) => html`<a href="/forum?category=${a}"${here(current === a)}>${name}</a>`)}</div>`
      : ""}</div>`,
  )}
  <p class="r-head">Tags</p>
  <div class="r-tags">${Object.entries(FORUM_TAGS).map(([t, name]) => html`<a class="tag${query.tag === t ? " on" : ""}" href="${link({ ...query, page: 1 }, { tag: query.tag === t ? "" : t })}">${name}</a>`)}</div>
  ${ctx.viewer ? "" : html`<p class="r-note">Anyone can read the forum. <a href="/signin?next=/forum">Sign in</a> to post, reply and say Me too.</p>`}
  <p class="r-note">Your AI reads and posts here too, through the Zaisma MCP. Its posts carry an ${ICONS.ai} AI mark.</p>
</nav>
</details>`;
}

function topicRow(t: TopicRow, q: ForumQuery): Raw {
  const place = placeOf(t.category);
  const kindLabel = t.known_issue ? "Known issue" : KINDS[t.kind].label;
  return html`<li class="trow${t.unread ? " unread" : ""}${t.known_issue ? " known" : ""}">
  <span class="ticon k-${t.known_issue ? "known" : t.kind}" title="${kindLabel}">${kindIcon(t)}<span class="sr">${kindLabel}</span></span>
  <div class="tmain">
    <p class="tline"><a class="ttitle" href="/forum/${t.id}">${t.title}</a>${t.answered && !t.known_issue ? html`<span class="flag ok" title="Answered">${ICONS.check}Answered</span>` : ""}${t.public ? "" : html`<span class="flag" title="Only you and Zaisma can see it">${ICONS.lock}Private</span>`}${t.public && !t.shown ? html`<span class="flag warn">Being checked</span>` : ""}${t.status !== "new" && t.status !== "answered" ? statusPill(t.status, t.public) : t.status === "new" && !t.public ? statusPill(t.status, false) : ""}${t.merged_into ? html`<a class="flag" href="/forum/${t.merged_into}">Part of a known issue</a>` : ""}</p>
    <p class="tmeta">${place ? html`<a class="cat" href="${link({}, { category: t.category ?? "" })}">${place.name} · ${place.sub}</a>` : ""}${t.tags.map(tagChip)}<span class="by">${avatar(t.author, "xs")}${t.author.name}${t.author.by === "ai" ? html`<span class="mark ai">${ICONS.ai}AI</span>` : ""}${t.author.by === "zaisma" ? html`<span class="mark team">Team</span>` : ""}</span><span class="when">${ago(t.created_at)}</span></p>
  </div>
  <div class="tpeople">${t.people.map((p) => avatar(p, "sm"))}</div>
  <div class="tstat" title="${t.replies === 1 ? "1 reply" : `${t.replies} replies`}">${ICONS.replies}<span>${t.replies}</span></div>
  <div class="tstat${t.voted ? " mine" : ""}" title="${t.known_issue ? `${t.developers} developers affected` : `${t.votes} said Me too`}">${ICONS.vote}<span>${t.known_issue ? t.developers : t.votes}</span></div>
  <div class="tage">${ago(t.active_at)}</div>
</li>`;
}

async function similarFragment(ctx: Ctx, q: string): Promise<Response> {
  const found = await similarTopics(ctx.env, ctx.viewer, q);
  const body = found.length
    ? html`<p><strong>Already here?</strong> If one of these is the same, say Me too or reply there instead.</p><ol class="topics">${found.map((t) => topicRow(t, {}))}</ol>`
    : html``;
  return new Response(body.html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

// --- A topic ---

async function topicPage(ctx: Ctx, id: string, opts: { done?: string; error?: string; text?: string; to?: string }, status = 200): Promise<Response> {
  const data = await getTopic(ctx.env, ctx.viewer, id);
  const t = data.topic;
  const place = placeOf(t.category);
  const first = data.posts[0];
  const opening = t.author.by !== "zaisma" && first && !t.known_issue ? first : null;
  const rest = opening ? data.posts.slice(1) : data.posts;
  const answer = data.posts.find((p) => p.answer);
  const to = opts.to ? data.posts.find((p) => p.id === opts.to) : undefined;
  const notice = opts.error ? html`<p class="error" role="alert">${opts.error}</p>` : opts.done && DONE[opts.done] ? html`<p class="done" role="status">${DONE[opts.done]}</p>` : "";
  return forumPage(
    ctx,
    t.title,
    html`<div class="topic">
<article class="t-main">
  <p class="crumbs"><a href="/forum">Forum</a>${place ? html`<span>/</span><a href="/forum?category=${place.category}">${place.name}</a><span>/</span><a href="/forum?category=${t.category}">${place.sub}</a>` : ""}</p>
  <h1 class="t-title"><span class="ticon k-${t.known_issue ? "known" : t.kind}" title="${t.known_issue ? "Known issue" : KINDS[t.kind].label}">${kindIcon(t)}</span>${t.title}</h1>
  <p class="t-meta"><span class="kind">${t.known_issue ? "Known issue" : KINDS[t.kind].label}</span>${statusPill(t.status, t.public)}${t.tags.map(tagChip)}${t.public ? "" : html`<span class="flag">${ICONS.lock}Only you and Zaisma can see this</span>`}${t.game ? html`<span class="muted">About <a href="/dashboard/${t.game}">${t.game}</a>, which only you and Zaisma see</span>` : ""}</p>
  ${notice}
  ${t.public && !t.shown ? html`<p class="note warn-note">Others see this topic once its first post is checked${first?.state === "held" ? ": a person at Zaisma looks at it, usually within a day" : ", usually within minutes"}.</p>` : ""}
  ${t.known_issue
    ? html`<div class="known-box plate bevel-s"><p class="kb-head">${ICONS.known}<strong>A known issue</strong><span class="muted">Zaisma knows about this. ${t.developers === 1 ? "1 developer has" : `${t.developers} developers have`} hit it${t.roadmap ? html`; it's part of <strong>${t.roadmap}</strong> on the roadmap` : ""}.</span></p>
      ${t.workaround ? html`<p class="kb-work"><strong>Until it's fixed:</strong> ${t.workaround}</p>` : ""}</div>`
    : ""}
  ${t.merged_into ? html`<div class="known-box plate bevel-s"><p class="kb-head">${ICONS.known}<span>Part of the known issue <a href="/forum/${t.merged_into.id}"><strong>${t.merged_into.title}</strong></a>.</span></p>${t.merged_into.workaround ? html`<p class="kb-work"><strong>Until it's fixed:</strong> ${t.merged_into.workaround}</p>` : ""}</div>` : ""}
  ${answer && opening ? html`<p class="jump">${ICONS.check}<a href="#p-${answer.id}">Answered by ${answer.by.name}${answer.by.by === "ai" ? "'s AI" : ""}</a></p>` : ""}
  <ol class="posts">${opening ? postItem(t, opening, data.posts, true) : ""}${rest.map((p) => postItem(t, p, data.posts, false))}</ol>
  ${composer(ctx, t, data.posts_left_today, opts.text ?? "", to)}
</article>
${sidePanel(ctx, t, data.posts)}
</div>`,
    { status },
  );
}

function postItem(t: Topic["topic"], p: PostJson, all: PostJson[], opening: boolean): Raw {
  // A bare status change reads as a line in the thread; one with Zaisma's words is a post.
  if (p.kind === "status" && p.text.length <= 60) {
    return html`<li class="event" id="p-${p.id}">${avatar(p.by, "xs")}<p>${p.text}</p>${ago(p.at)}</li>`;
  }
  const canAnswer = t.can.answer && !opening && p.state === null && !p.by.you;
  return html`<li class="post${p.by.by === "zaisma" ? " z" : ""}${p.answer ? " answer" : ""}${opening ? " opening" : ""}${p.state ? " pending" : ""}" id="p-${p.id}">
  <div class="p-side">${avatar(p.by, "md")}</div>
  <div class="p-body">
    <header class="p-head">${nameOf(p.by)}${p.kind === "reopen" ? html`<span class="pill pending">Reopened</span>` : ""}${p.answer ? html`<span class="flag ok">${ICONS.check}Answer</span>` : ""}${p.state === "checking" ? html`<span class="flag warn">Being checked: only you see it yet</span>` : p.state === "held" ? html`<span class="flag warn">Waiting for a person at Zaisma: only you see it yet</span>` : ""}<a class="p-when" href="#p-${p.id}">${ago(p.at)}</a></header>
    ${p.reply_to ? html`<a class="quote" href="#p-${p.reply_to.id}">${ICONS.reply}<span><strong>${p.reply_to.name}</strong> ${p.reply_to.excerpt}${p.reply_to.excerpt.length >= 140 ? "…" : ""}</span></a>` : ""}
    <div class="p-text">${richText(p.text)}</div>
    ${p.context ? html`<details class="p-att"><summary>What ${p.by.by === "ai" ? "your AI" : "you"} attached (only you and Zaisma see it)</summary><pre>${JSON.stringify(p.context, null, 2)}</pre></details>` : ""}
    ${p.picture_url ? html`<a class="p-pic" href="/forum/${t.id}/pictures/${p.id}" target="_blank" rel="noopener"><img src="/forum/${t.id}/pictures/${p.id}" alt="Your screenshot" loading="lazy"><small>Only you and Zaisma see your screenshot</small></a>` : ""}
    <div class="p-foot">
      ${t.can.reply && p.state === null ? html`<a href="?to=${p.id}#reply" data-reply="${p.id}" data-name="${p.by.name}" data-excerpt="${p.text.slice(0, 140)}">${ICONS.reply}Reply</a>` : ""}
      ${canAnswer ? html`<form method="post" action="/forum/${t.id}/answer"><input type="hidden" name="post" value="${p.answer ? "" : p.id}"><button type="submit">${p.answer ? ICONS.cross : ICONS.check}${p.answer ? "Not the answer" : "Mark as the answer"}</button></form>` : ""}
      ${opening && all.length > 1 ? html`<span class="muted">${all.length === 2 ? "1 reply" : `${all.length - 1} replies`}</span>` : ""}
    </div>
  </div>
</li>`;
}

function composer(ctx: Ctx, t: Topic["topic"], left: number | null, text: string, to: PostJson | undefined): Raw {
  if (!ctx.viewer || !ctx.me) return html`<div class="composer plate bevel-s signed-out" id="reply"><p>Sign in to reply, say Me too or follow this topic.</p><a class="btn light" href="/signin?next=/forum/${t.id}">Sign in</a></div>`;
  return html`<form class="composer plate bevel-s" id="reply" method="post" action="/forum/${t.id}/reply" enctype="multipart/form-data">
  <input type="hidden" name="reply_to" value="${to?.id ?? ""}">
  <p class="replying"${to ? "" : raw(" hidden")}>${ICONS.reply}<span>Replying to <strong data-to-name>${to?.by.name ?? ""}</strong>: <span data-to-excerpt>${to?.text.slice(0, 140) ?? ""}</span></span><button type="button" class="x" data-unreply aria-label="Reply to the whole topic instead">×</button></p>
  <div class="c-row">${avatar(ctx.me, "md")}<label class="c-text"><span class="sr">Your reply</span><textarea name="text" required maxlength="${FEEDBACK_LIMITS.text}" rows="4" placeholder="${t.public ? "Write a reply. Put code between ``` lines." : "Add what you found since, another case, or reply to Zaisma."}">${text}</textarea></label></div>
  <div class="c-foot">
    <label class="c-file">Screenshot <small>(only you and Zaisma see it)</small><input type="file" name="picture" accept="image/png,image/jpeg,image/webp"></label>
    ${t.can.reopen ? html`<label class="check"><input type="checkbox" name="reopen" value="1"> It's back: reopen it</label>` : ""}
    <span class="hint">${t.public ? "Checked before others see it. " : ""}${left !== null ? `${left} of ${FEEDBACK_LIMITS.postsPerDay} posts left today.` : ""}</span>
    <button class="btn light" type="submit">Post reply</button>
  </div>
</form>`;
}

function sidePanel(ctx: Ctx, t: Topic["topic"], posts: PostJson[]): Raw {
  const place = placeOf(t.category);
  const seen = new Set<string>();
  const people = posts.map((p) => p.by).filter((p) => (seen.has(`${p.name}:${p.by}`) ? false : (seen.add(`${p.name}:${p.by}`), true)));
  const voteWords = t.known_issue ? "This happens to me too" : t.kind === "feature" ? "I want this too" : t.kind === "question" ? "I have this question too" : t.kind === "talk" ? "Me too" : "This happens to me too";
  return html`<aside class="t-side">
  ${t.public && t.shown
    ? html`<div class="side plate bevel-s">
    ${t.can.vote
      ? html`<form method="post" action="/forum/${t.id}/vote"><input type="hidden" name="on" value="${t.voted ? "0" : "1"}"><button class="btn${t.voted ? " ghost" : " light"} vote" type="submit" aria-pressed="${t.voted ? "true" : "false"}">${ICONS.vote}<span>${t.voted ? "You said Me too" : voteWords}</span></button></form>`
      : ""}
    <p class="count-line"><strong>${t.known_issue ? t.developers : t.votes}</strong> ${t.known_issue ? (t.developers === 1 ? "developer affected" : "developers affected") : t.votes === 1 ? "developer said Me too" : "developers said Me too"}</p>
    ${ctx.viewer ? html`<form method="post" action="/forum/${t.id}/follow"><input type="hidden" name="on" value="${t.following ? "0" : "1"}"><button class="btn ghost follow" type="submit">${t.following ? "Following: stop" : "Follow"}</button></form><p class="hint">${t.following ? "New replies show in Your topics." : "Hear about new replies in Your topics."}</p>` : ""}
  </div>`
    : ""}
  <dl class="facts plate bevel-s">
    <dt>Status</dt><dd>${t.status === "new" ? (t.public ? "Open" : "Waiting for Zaisma") : STATUS[t.status].label}</dd>
    ${place ? html`<dt>Category</dt><dd><a href="/forum?category=${place.category}">${place.name}</a> · <a href="/forum?category=${t.category}">${place.sub}</a></dd>` : ""}
    ${t.tags.length ? html`<dt>Tags</dt><dd class="tags">${t.tags.map(tagChip)}</dd>` : ""}
    <dt>Started by</dt><dd class="person">${avatar(t.author, "sm")}${nameOf(t.author)}<span class="muted">${ago(t.created_at)}</span></dd>
    ${people.length > 1 ? html`<dt>In this topic</dt><dd class="people">${people.slice(0, 12).map((p) => html`<span class="person">${avatar(p, "sm")}${nameOf(p)}</span>`)}</dd>` : ""}
    <dt>Who can see it</dt><dd>${t.public ? "Every developer and their AI" : "Only you and Zaisma"}</dd>
  </dl>
  ${t.known_issue && ctx.viewer
    ? html`<div class="side plate bevel-s"><p>${t.yours ? html`You've sent Zaisma a private report about this. <a href="/forum/${t.yours}">Open it</a>` : html`Have logs, a screenshot or a game to point at? <a href="/forum/new?known_issue=${t.id}&kind=${t.kind}">Report your case privately</a>: only Zaisma sees it, and it counts here.`}</p></div>`
    : ""}
</aside>`;
}

// --- A new topic ---

async function newPage(ctx: Ctx, f: Record<string, string>, error = "", status = 200, tags: string[] = []): Promise<Response> {
  const { games } = (await apiCall(ctx.env, ctx.viewer!, "GET", "/games")) as { games: { slug: string; title: string }[] };
  const kind = (FEEDBACK_KINDS as readonly string[]).includes(f.kind ?? "") ? (f.kind as FeedbackKind) : "question";
  const known = f.known_issue ? await getTopic(ctx.env, ctx.viewer, f.known_issue).catch(() => null) : null;
  const isPrivate = known ? true : f.visibility ? f.visibility === "private" : FEEDBACK_PRIVATE_KINDS.includes(kind);
  const category = f.category && !FORUM_CATEGORIES.some((c) => c.id === f.category) ? f.category : (f.category ? areasOf(f.category)[0] : "") || known?.topic.category || "";
  return forumPage(
    ctx,
    "New topic",
    html`<div class="newtopic">
<form class="np plate bevel-s" method="post" action="/forum/new" enctype="multipart/form-data">
  <h1>${known ? "Report your case privately" : "New topic"}</h1>
  ${error ? html`<p class="error" role="alert">${error}</p>` : ""}
  ${known
    ? html`<input type="hidden" name="known_issue" value="${known.topic.id}"><input type="hidden" name="kind" value="${kind}"><p class="note">About the known issue <a href="/forum/${known.topic.id}"><strong>${known.topic.title}</strong></a>. Only you and Zaisma see what you write here; it counts toward the developers affected, and you hear when it's fixed.</p>`
    : html`<fieldset class="kinds"><legend>What is it?</legend>${FEEDBACK_KINDS.map(
        (k) => html`<label class="kind-opt"><input type="radio" name="kind" value="${k}"${k === kind ? raw(" checked") : ""}><span class="ticon k-${k}">${ICONS[k]}</span><span><strong>${KINDS[k].label}</strong><small>${KINDS[k].hint}</small></span></label>`,
      )}</fieldset>`}
  <label>Title <input name="title" required maxlength="${FEEDBACK_LIMITS.title}" value="${f.title ?? known?.topic.title ?? ""}" placeholder="Upload stops at 99% for a 300 MB build" autocomplete="off"></label>
  <div id="similar" class="similar" aria-live="polite"></div>
  <label>What happened, or what you'd like <textarea name="text" required maxlength="${FEEDBACK_LIMITS.text}" rows="9" placeholder="What you did, what you expected and what happened instead. Put code and errors between \`\`\` lines.">${f.text ?? ""}</textarea></label>
  <div class="np-row">
    <label>Category <select name="category"><option value="">Not sure: Zaisma sorts it</option>${FORUM_CATEGORIES.map(
      (c) => html`<optgroup label="${c.name}">${Object.entries(c.areas).map(([a, name]) => html`<option value="${a}"${a === category ? raw(" selected") : ""}>${name}</option>`)}</optgroup>`,
    )}</select></label>
    ${games.length ? html`<label>Which game (optional) <select name="game"><option value="">None</option>${games.map((g) => html`<option value="${g.slug}"${g.slug === f.game ? raw(" selected") : ""}>${g.title}</option>`)}</select><small class="hint">Only you and Zaisma see which game.</small></label>` : ""}
  </div>
  ${known
    ? ""
    : html`<fieldset class="np-tags"><legend>Tags (up to ${FEEDBACK_LIMITS.tags})</legend><div class="r-tags">${Object.entries(FORUM_TAGS).map(
        ([t, name]) => html`<label class="tag pick"><input type="checkbox" name="tags" value="${t}"${tags.includes(t) ? raw(" checked") : ""}><span>${name}</span></label>`,
      )}</div></fieldset>
  <fieldset class="seen"><legend>Who can see it</legend>
    <label class="check"><input type="radio" name="visibility" value="public"${isPrivate ? "" : raw(" checked")}><span><strong>Every developer and their AI</strong><small>Others can reply and say Me too. Checked before it shows.</small></span></label>
    <label class="check"><input type="radio" name="visibility" value="private"${isPrivate ? raw(" checked") : ""}><span><strong>Only Zaisma</strong><small>For logs, unreleased games or anything private. If others hit it too, Zaisma makes it a public known issue without your words.</small></span></label>
  </fieldset>`}
  <label>Screenshot (optional) <input type="file" name="picture" accept="image/png,image/jpeg,image/webp"><small class="hint">PNG, JPEG or WebP up to ${FEEDBACK_LIMITS.pictureBytes / 1048576} MB. Only you and Zaisma see it.</small></label>
  <div class="np-foot"><button class="btn light" type="submit">${known ? "Send to Zaisma" : "Post topic"}</button><span class="hint">Keys and passwords are blanked before anything is saved.</span></div>
</form>
<aside class="np-side">
  <div class="side plate bevel-s"><h2>Before you post</h2><p>Search first: if someone has posted it, say Me too there. It counts, and you hear when it changes.</p><p>Bugs and missing pieces go to Zaisma privately by default. Ideas, questions and discussions are public.</p></div>
  <div class="side plate bevel-s"><h2>From your AI</h2><p>With the Zaisma MCP, your AI searches the forum, posts what it hits with the exact error, and replies. Its posts show your name with an ${ICONS.ai} AI mark.</p></div>
</aside>
</div>`,
    { status },
  );
}

// --- Styles and the little script ---

const FORUM_STYLES = `
main{max-width:1320px;padding-top:20px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.done{color:var(--ok-text);margin:0 0 14px}
.btn.new-topic{min-height:40px;padding:0 16px}
.btn.new-topic svg{width:14px;height:14px}
.forum{display:grid;grid-template-columns:230px minmax(0,1fr);gap:28px;align-items:start}

/* The rail: where you are in the forum. */
.rail{position:sticky;top:84px;font-size:14px}
.rail>summary{display:none}
.rail nav{display:grid;gap:2px}
.rail a{text-decoration:none;color:var(--muted)}
.rail a:hover{color:var(--text)}
.rail .r-top,.rail .r-cat>a{position:relative;display:flex;align-items:center;justify-content:space-between;min-height:32px;padding:0 10px;font-family:var(--display);font-weight:500;font-size:15px}
.rail [aria-current]{color:var(--text);background:linear-gradient(90deg,rgba(255,255,255,.07),rgba(255,255,255,0))}
.rail [aria-current]::before{content:"";position:absolute;left:0;top:6px;bottom:6px;width:3px;background:var(--chrome);box-shadow:0 0 10px rgba(225,230,240,.35)}
.rail .count{min-width:20px;height:20px;padding:0 6px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;color:#0b0b0c;background:var(--chrome)}
.rail .r-head{margin:16px 10px 4px;color:var(--muted);font-size:12px;font-family:var(--display);font-weight:600}
.rail .r-subs{display:grid;margin:0 0 4px 12px;padding-left:8px;box-shadow:inset 1px 0 0 var(--line-2)}
.rail .r-subs a{position:relative;display:flex;align-items:center;min-height:28px;padding:0 10px;font-size:14px}
.r-tags{display:flex;flex-wrap:wrap;gap:6px;padding:2px 10px}
.rail .r-note{margin:16px 10px 0;color:var(--muted);font-size:12px;line-height:1.45}
.rail .r-note a{color:var(--text)}
.rail .r-note svg,.np-side svg{width:11px;height:11px;vertical-align:-1px}

/* Tags and small flags. */
.tag{display:inline-flex;align-items:center;gap:4px;min-height:22px;padding:0 8px;font-size:12px;font-family:var(--display);font-weight:500;color:var(--text-2);text-decoration:none;background:rgba(0,0,0,.32);box-shadow:inset 0 1px 2px rgba(0,0,0,.6),0 1px 0 rgba(255,255,255,.05)}
a.tag:hover,.tag.on{color:#0b0b0c;background:var(--chrome);box-shadow:none}
.tag.pick{cursor:pointer;color:var(--text-2)}
.tag.pick input{position:absolute;opacity:0;pointer-events:none}
.tag.pick:has(input:checked){color:#0b0b0c;background:var(--chrome);box-shadow:none}
.tag.pick:has(input:focus-visible){outline:2px solid #e6e8eb;outline-offset:2px}
.tag.pick:has(input:disabled){opacity:.45;cursor:default}
.flag{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-family:var(--display);font-weight:600;color:var(--muted);text-decoration:none;white-space:nowrap}
.flag svg{width:13px;height:13px}
.flag.ok{color:var(--ok-text)}
.flag.warn{color:var(--warn)}
.mark{display:inline-flex;align-items:center;gap:3px;height:18px;padding:0 6px;font-size:11px;font-family:var(--display);font-weight:600;letter-spacing:.02em;vertical-align:1px}
.mark svg{width:10px;height:10px}
.mark.ai{color:#cfe0ff;background:linear-gradient(180deg,#2b3550,#1d2438);box-shadow:inset 0 0 0 1px rgba(160,190,255,.25)}
.mark.team{color:#0b0b0c;background:var(--chrome)}
.who{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}
.who strong{font-family:var(--display);font-weight:600;color:var(--text)}
.you{color:var(--muted);font-size:12px}

/* Pictures: initials on a plate in the account's own color, the Z's cut corner, and the AI mark. */
.av{--s:36px;position:relative;flex:none;display:inline-flex;align-items:center;justify-content:center;width:var(--s);height:var(--s);font-family:var(--display);font-weight:600;font-size:calc(var(--s) * .38);letter-spacing:.02em;color:hsl(var(--h) 40% 92%);
  background:linear-gradient(to top right,transparent calc(50% - 1px),rgba(255,255,255,.35) calc(50% - 1px),rgba(255,255,255,.35) 50%,transparent 50%) top right/6px 6px no-repeat,linear-gradient(180deg,hsl(var(--h) 32% 38%),hsl(var(--h) 34% 22%));
  clip-path:polygon(0 0,calc(100% - 6px) 0,100% 6px,100% 100%,0 100%);box-shadow:inset 1px 1px 0 rgba(255,255,255,.18),inset -1px -1px 0 rgba(0,0,0,.6);text-shadow:0 1px 0 rgba(0,0,0,.5)}
.av.xs{--s:20px}
.av.sm{--s:26px}
.av.md{--s:40px}
.av.z{background:var(--chrome)}
.av.z img{width:62%;height:auto;display:block}
.av .ai-mark{position:absolute;right:-1px;bottom:-1px;width:calc(var(--s) * .45);height:calc(var(--s) * .45);min-width:11px;min-height:11px;display:flex;align-items:center;justify-content:center;color:#cfe0ff;background:#1d2438;box-shadow:inset 0 0 0 1px rgba(160,190,255,.4)}
.av .ai-mark svg{width:70%;height:70%}
.av:has(.ai-mark){clip-path:none}

/* The board: the topic list. */
.board-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 16px;margin:0 0 12px}
.board-head h1{font-size:26px;margin:0;display:flex;align-items:center;gap:10px}
.board-head h1 .up{color:var(--muted);text-decoration:none;font-weight:500}
.board-head h1 .up:hover{color:var(--text)}
.board-head h1 .sep{color:var(--line-2)}
.tabs a,.tabs button{min-height:34px;padding:0 13px;font-size:13px}
.filters{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin:0 0 14px;font-size:13px}
.chips{display:flex;flex-wrap:wrap;gap:4px}
.chips a{min-height:28px;padding:0 11px;display:inline-flex;align-items:center;font-family:var(--display);font-weight:500;font-size:13px;color:var(--muted);text-decoration:none;box-shadow:inset 0 0 0 1px var(--line-2)}
.chips a:hover{color:var(--text);box-shadow:inset 0 0 0 1px #6a6f78}
.chips a[aria-current]{color:#0b0b0c;background:var(--chrome);box-shadow:none}
.topics{list-style:none;margin:0;padding:0;background:var(--brush) 0 0/320px 320px,var(--face);box-shadow:var(--rim),var(--drop)}
.topics-head,.trow{display:grid;grid-template-columns:34px minmax(0,1fr) 112px 62px 62px 52px;gap:0 12px;align-items:center}
.topics-head{padding:0 14px 6px;color:var(--muted);font-family:var(--display);font-size:12px;font-weight:500}
.topics-head span:first-child{grid-column:1 / 3}
.topics-head span:nth-child(n+3){text-align:center}
.topics-head span:last-child{text-align:right}
.trow{position:relative;min-height:62px;padding:9px 14px;background:linear-gradient(#000,#000) bottom/100% 1px no-repeat}
.trow:last-child{background:none}
.trow:not(:last-child){box-shadow:0 1px 0 rgba(255,255,255,.035)}
.trow:hover{background-color:rgba(255,255,255,.025)}
.trow.unread::before{content:"";position:absolute;left:0;top:12px;bottom:12px;width:3px;background:var(--chrome)}
.trow.unread .ttitle{color:#fff}
.ticon{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;color:var(--text-2);background:rgba(0,0,0,.28);box-shadow:inset 0 1px 2px rgba(0,0,0,.6),0 1px 0 rgba(255,255,255,.05)}
.ticon svg{width:17px;height:17px}
.ticon.k-bug{color:#ff9b8f}
.ticon.k-gap{color:var(--warn)}
.ticon.k-feature{color:#ffd77a}
.ticon.k-question{color:#9cc8ff}
.ticon.k-talk{color:#c9b6ff}
.ticon.k-known{color:#0b0b0c;background:var(--chrome);box-shadow:none}
.tmain{min-width:0;display:grid;gap:3px}
.tline,.tmeta{margin:0;display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;min-width:0}
.ttitle{font-family:var(--display);font-weight:600;font-size:16px;line-height:1.3;color:var(--text);text-decoration:none;overflow-wrap:anywhere}
.ttitle:hover{text-decoration:underline;text-underline-offset:3px}
.tmeta{font-size:12px;color:var(--muted)}
.tmeta .cat{color:var(--text-2);text-decoration:none;font-family:var(--display);font-weight:500}
.tmeta .cat:hover{color:var(--text)}
.tmeta .by{display:inline-flex;align-items:center;gap:6px;color:var(--text-2)}
.tpeople{display:flex;justify-content:center}
.tpeople .av{margin-left:-6px;box-shadow:0 0 0 2px #1d2026,inset 1px 1px 0 rgba(255,255,255,.18)}
.tpeople .av:first-child{margin-left:0}
.tstat{display:flex;align-items:center;justify-content:center;gap:5px;color:var(--muted);font-family:var(--display);font-weight:600;font-size:14px}
.tstat svg{width:15px;height:15px}
.tstat.mine{color:var(--text)}
.tage{text-align:right;color:var(--muted);font-size:13px}
.pinned{margin:0 0 16px}
.pinned>summary{display:flex;align-items:center;gap:8px;margin:0 0 8px;font-family:var(--display);font-weight:600;color:var(--text);list-style:none}
.pinned>summary::-webkit-details-marker{display:none}
.pinned>summary svg{width:16px;height:16px}
.pinned>summary small{color:var(--muted);font-weight:500}
.pinned>summary::after{content:"Hide";margin-left:auto;color:var(--muted);font-size:12px;font-weight:500}
.pinned:not([open])>summary::after{content:"Show"}
.pinned .topics{box-shadow:inset 3px 0 0 #c9cace,var(--rim),var(--drop)}
.empty-board{padding:40px 24px;text-align:center;color:var(--muted);background:var(--brush) 0 0/320px 320px,var(--face);box-shadow:var(--rim),var(--drop)}
.pager{display:flex;align-items:center;justify-content:center;gap:16px;margin:18px 0 0}

/* A topic. */
.topic{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:32px;align-items:start}
.crumbs{margin:0 0 10px;display:flex;flex-wrap:wrap;gap:8px;font-size:14px;color:var(--muted)}
.crumbs a{color:var(--muted);text-decoration:none}
.crumbs a:hover{color:var(--text)}
.t-title{display:flex;align-items:flex-start;gap:12px;font-size:clamp(26px,3.4vw,34px);margin:0 0 10px}
.t-title .ticon{margin-top:4px;flex:none}
.t-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;margin:0 0 18px;font-size:13px}
.t-meta .kind{font-family:var(--display);font-weight:600;color:var(--text-2)}
.known-box{padding:14px 16px;margin:0 0 18px;display:grid;gap:8px;box-shadow:inset 3px 0 0 #c9cace,var(--rim),var(--drop)}
.known-box p{margin:0}
.kb-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}
.kb-head svg{width:16px;height:16px}
.kb-work{color:var(--text-2)}
.warn-note{color:var(--warn);margin:0 0 16px}
.jump{display:flex;align-items:center;gap:6px;margin:0 0 14px;font-size:14px;color:var(--ok-text)}
.jump svg{width:15px;height:15px}
.posts{list-style:none;margin:0 0 20px;padding:0;display:grid;gap:12px}
.post{display:grid;grid-template-columns:40px minmax(0,1fr);gap:14px;padding:16px 18px;background:var(--brush) 0 0/320px 320px,var(--face);box-shadow:var(--rim),var(--drop)}
.post.z{box-shadow:inset 3px 0 0 #dfe2e6,var(--rim),var(--drop);background:var(--brush) 0 0/320px 320px,linear-gradient(180deg,#2b3038,#1d2026)}
.post.answer{box-shadow:inset 3px 0 0 var(--ok),var(--rim),var(--drop)}
.post.pending{opacity:.8}
.p-body{min-width:0;display:grid;gap:8px}
.p-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;font-size:14px}
.p-when{margin-left:auto;color:var(--muted);font-size:13px;text-decoration:none}
.p-when:hover{color:var(--text)}
.p-text{color:var(--text-2);white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6}
.p-text a{color:var(--text)}
.p-text code{font-size:13px;padding:1px 5px;background:#0d0f12;box-shadow:inset 0 1px 2px rgba(0,0,0,.7)}
.p-text pre{margin:8px 0;white-space:pre;overflow:auto;max-height:420px}
.p-text pre code{padding:0;background:none;box-shadow:none}
.quote{display:flex;gap:8px;align-items:flex-start;padding:8px 10px;font-size:13px;color:var(--muted);text-decoration:none;background:rgba(0,0,0,.22);box-shadow:inset 2px 0 0 var(--line-2)}
.quote:hover{color:var(--text-2)}
.quote svg{width:14px;height:14px;flex:none;margin-top:2px}
.quote span{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.quote strong{color:var(--text-2)}
.p-att pre{margin:6px 0 0;max-height:300px;overflow:auto}
.p-pic{display:grid;gap:4px;justify-items:start;text-decoration:none;color:var(--muted)}
.p-pic img{max-width:100%;max-height:300px;display:block;background:var(--pic)}
.p-foot{display:flex;flex-wrap:wrap;align-items:center;gap:4px 16px;font-size:13px}
.p-foot a,.p-foot button{display:inline-flex;align-items:center;gap:5px;padding:0;border:0;background:none;color:var(--muted);font:inherit;font-family:var(--display);font-weight:500;text-decoration:none;cursor:pointer}
.p-foot a:hover,.p-foot button:hover{color:var(--text)}
.p-foot svg{width:14px;height:14px}
.p-foot form{display:inline}
.event{display:flex;align-items:center;gap:10px;padding:2px 18px 2px 30px;font-size:14px;color:var(--muted)}
.event p{margin:0;flex:1}
.event time{font-size:12px}
.composer{padding:16px 18px;display:grid;gap:12px;scroll-margin-top:90px}
.composer.signed-out{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
.composer.signed-out p{margin:0;color:var(--muted)}
.replying{display:flex;align-items:center;gap:8px;margin:0;font-size:13px;color:var(--muted)}
.replying[hidden]{display:none}
.replying svg{width:14px;height:14px;flex:none}
.replying>span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.replying strong{color:var(--text-2)}
.x{border:0;background:none;color:var(--muted);font-size:18px;line-height:1;cursor:pointer;padding:0 4px}
.x:hover{color:var(--text)}
.c-row{display:grid;grid-template-columns:40px minmax(0,1fr);gap:14px}
.c-text textarea{width:100%;min-height:110px}
.c-foot{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;padding-left:54px}
.c-foot .btn{margin-left:auto}
.c-file{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;font-size:13px}
.c-file input{min-height:0;padding:4px;font-size:12px;max-width:220px;box-shadow:none;border:0;background:none}
label.check{display:flex;gap:8px;align-items:center;color:var(--text);font-size:14px}
.t-side{position:sticky;top:84px;display:grid;gap:14px}
.side{padding:14px 16px;display:grid;gap:10px}
.side h2{font-size:17px;margin:0}
.side p{margin:0;color:var(--muted);font-size:14px}
.side p a{color:var(--text)}
.side .btn.vote{width:100%}
.side .btn.vote svg{width:15px;height:15px}
.side .btn.follow{width:100%;min-height:38px}
.count-line{text-align:center}
.count-line strong{color:var(--text);font-family:var(--display);font-size:18px}
.facts{margin:0;padding:4px 16px;display:grid;font-size:14px}
.facts dt{padding:10px 0 4px;margin:0;color:var(--muted);font-family:var(--display);font-weight:500;font-size:12px}
.facts dd{padding:0 0 10px;margin:0;background:linear-gradient(#000,#000) bottom/100% 1px no-repeat}
.facts dd:last-of-type{background:none}
.facts dd{color:var(--text-2);min-width:0}
.facts dd a{color:var(--text-2)}
.facts .tags{display:flex;flex-wrap:wrap;gap:4px}
.facts .person{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.facts .people{display:grid;gap:8px}
.facts .people .person{flex-wrap:nowrap}
.gone{max-width:560px}

/* A new topic. */
.newtopic{display:grid;grid-template-columns:minmax(0,760px) 300px;gap:32px;align-items:start}
.np{padding:22px 24px;display:grid;gap:16px}
.np h1{font-size:28px;margin:0}
.np label{display:grid;gap:6px}
.kinds{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px}
.kinds legend{margin-bottom:8px}
.kind-opt{position:relative;display:flex!important;align-items:flex-start;gap:10px;padding:10px 12px;cursor:pointer;background:rgba(0,0,0,.2);box-shadow:inset 0 0 0 1px var(--line-2)}
.kind-opt:hover{box-shadow:inset 0 0 0 1px #6a6f78}
.kind-opt input{position:absolute;opacity:0}
.kind-opt:has(input:checked){background:var(--brush) 0 0/320px 320px,var(--face-hi);box-shadow:inset 0 -2px 0 #dfe2e6,inset 1px 1px 0 rgba(255,255,255,.13)}
.kind-opt:has(input:focus-visible){outline:2px solid #e6e8eb;outline-offset:2px}
.kind-opt strong{display:block;font-family:var(--display);color:var(--text)}
.kind-opt small{display:block;font-size:12px;color:var(--muted);line-height:1.35}
.similar:empty{display:none}
.similar{display:grid;gap:8px;margin-top:-6px}
.similar p{margin:0;font-size:14px;color:var(--text-2)}
.similar .trow{grid-template-columns:34px minmax(0,1fr) 62px 62px}
.similar .tpeople,.similar .tage{display:none}
.np-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
.np-tags legend,.seen legend{margin-bottom:8px}
.np-tags .r-tags{padding:0}
.seen{display:grid;gap:10px}
.np label.check{display:flex}
.np input[type=radio],.np input[type=checkbox]{min-height:0;padding:0;width:auto;box-shadow:none}
.seen label.check{align-items:flex-start}
.seen label.check input{margin-top:4px}
.seen strong{display:block;font-family:var(--display)}
.seen small{display:block;color:var(--muted);font-size:13px}
.np-foot{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px}
.np-side{display:grid;gap:14px;position:sticky;top:84px}

@media (max-width:1080px){
  .topic,.newtopic{grid-template-columns:minmax(0,1fr)}
  .t-side,.np-side{position:static}
}
@media (max-width:900px){
  .forum{grid-template-columns:minmax(0,1fr);gap:14px}
  .rail{position:static;background:var(--brush) 0 0/320px 320px,var(--face);box-shadow:var(--rim)}
  .rail>summary{display:flex;align-items:center;justify-content:space-between;min-height:44px;padding:0 14px;font-family:var(--display);font-weight:600;color:var(--text);list-style:none}
  .rail>summary::-webkit-details-marker{display:none}
  .rail>summary::after{content:"Categories";color:var(--muted);font-weight:500;font-size:13px}
  .rail[open]>summary::after{content:"Close"}
  .rail nav{padding:0 4px 12px}
  .topics-head{display:none}
  .trow{grid-template-columns:30px minmax(0,1fr) auto;gap:4px 10px;padding:10px 12px}
  .tpeople{display:none}
  .tstat{grid-row:2;justify-content:flex-start;font-size:12px}
  .trow .tstat:nth-of-type(1){grid-column:2}
  .tmain{grid-row:1 / 2;grid-column:2 / 4}
  .trow{grid-template-areas:none}
  .tage{grid-column:3;grid-row:2}
}
@media (max-width:640px){
  .btn.new-topic{padding:0 12px}
  .btn.new-topic span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
  .board-head h1{font-size:22px}
  .post{grid-template-columns:28px minmax(0,1fr);gap:10px;padding:14px}
  .post .av.md,.c-row .av.md{--s:28px}
  .c-row{grid-template-columns:minmax(0,1fr)}
  .c-row .av{display:none}
  .c-foot{padding-left:0}
  .np{padding:18px 16px}
  .event{padding-left:8px}
}
`;

// Reply to one post without reloading, keep the rail closed on phones, suggest similar topics while
// a title is typed, keep tags to three, and match who sees a new topic to its kind until it's chosen.
const FORUM_SCRIPT = `(()=>{
const rail=document.querySelector(".rail");if(rail&&matchMedia("(max-width:900px)").matches)rail.open=false;
const c=document.getElementById("reply");
if(c&&c.tagName==="FORM"){const box=c.querySelector(".replying"),to=c.elements.reply_to;
document.addEventListener("click",e=>{const a=e.target.closest("[data-reply]");if(a){e.preventDefault();to.value=a.dataset.reply;box.querySelector("[data-to-name]").textContent=a.dataset.name;box.querySelector("[data-to-excerpt]").textContent=a.dataset.excerpt;box.hidden=false;c.scrollIntoView({behavior:"smooth",block:"center"});c.elements.text.focus({preventScroll:true})}
if(e.target.closest("[data-unreply]")){to.value="";box.hidden=true}})}
const f=document.querySelector("form.np");if(!f)return;
const t=f.elements.title,sim=document.getElementById("similar");let timer=0,last="";
const look=()=>{const q=t.value.trim();if(q===last)return;last=q;if(q.length<6){sim.innerHTML="";return}fetch("/forum/similar?q="+encodeURIComponent(q)).then(r=>r.text()).then(h=>{if(t.value.trim()===q)sim.innerHTML=h}).catch(()=>{})};
t.addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(look,350)});
const tags=[...f.querySelectorAll("input[name=tags]")],cap=()=>{const n=tags.filter(x=>x.checked).length;tags.forEach(x=>x.disabled=!x.checked&&n>=${FEEDBACK_LIMITS.tags})};tags.forEach(x=>x.addEventListener("change",cap));cap();
let chosen=false;f.querySelectorAll("input[name=visibility]").forEach(r=>r.addEventListener("change",()=>chosen=true));
f.querySelectorAll("input[name=kind]").forEach(r=>r.addEventListener("change",()=>{if(chosen)return;const v=["bug","gap"].includes(r.value)?"private":"public",o=f.querySelector("input[name=visibility][value="+v+"]");if(o)o.checked=true}));
})();`;
