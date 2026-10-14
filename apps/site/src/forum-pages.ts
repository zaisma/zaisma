import {
  FEEDBACK_KINDS,
  FEEDBACK_LIMITS,
  FORUM_CATEGORIES,
  FORUM_REPORT_REASONS,
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
  flagMisplaced,
  follow,
  markHelpful,
  reportPost,
  stillHappening,
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
  investigating: { label: "Investigating", pill: "pending" },
  known: { label: "Confirmed", pill: "held" },
  planned: { label: "Planned", pill: "info" },
  fixing: { label: "Fixing", pill: "info" },
  released: { label: "Fix released", pill: "live" },
  fixed: { label: "Resolved", pill: "live" },
  wont: { label: "Won't fix", pill: "removed" },
  answered: { label: "Answered", pill: "live" },
};
const DONE: Record<string, string> = {
  posted: "Posted.",
  "posted-private": "Sent to Zaisma. Only you and Zaisma see this; a person reads it, and replies show here and to your AI.",
  checking: "Posted. Others see it once it's checked, usually within minutes.",
  held: "Posted. A person at Zaisma checks it before others see it, usually within a day.",
  replied: "Replied.",
  reported: "Thanks. A person at Zaisma looks at it; whoever wrote it isn't told who reported it.",
  "reported-hidden": "Thanks. It's hidden until a person at Zaisma looks at it.",
  still: "Thanks. It's back to fixing, Zaisma has been alerted, and everyone in it hears.",
  misplaced: "Thanks. Zaisma's AI looks at where it belongs within a few minutes, and moves it if it's in the wrong place.",
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
  want: stroke('<path d="M4.5 12.8L10 7.2l5.5 5.6"/>'),
  affects: stroke('<path d="M7 10.2V4.6a1.2 1.2 0 0 1 2.4 0V9"/><path d="M9.4 9V3.4a1.2 1.2 0 0 1 2.4 0V9"/><path d="M11.8 9V4.4a1.2 1.2 0 0 1 2.4 0V10"/><path d="M14.2 10V7a1.2 1.2 0 0 1 2.4 0v4.6c0 3.4-2.4 6-5.6 6-2.3 0-3.7-1-4.9-2.8l-2.5-4.1a1.2 1.2 0 0 1 2-1.3L7 11.2"/>'),
  same: stroke('<path d="M7.4 6.4V3.4h10.2v7H16v2.6l-3.1-2.6h-.6"/><path d="M2.4 6.4h9.8v7.2H7l-3.1 2.6v-2.6H2.4z"/><path d="M5.9 8.7a1.4 1.4 0 1 1 1.9 1.3c-.4.2-.6.5-.6.9v.2"/><path d="M7.2 12.4v.1"/>'),
  lock: stroke('<rect x="4.5" y="9" width="11" height="8"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/>'),
  check: stroke('<path d="M4 10.5l4 4 8-9"/>'),
  ai: stroke('<path fill-rule="evenodd" d="M9 1.8h2v3.6h4.2a1.8 1.8 0 0 1 1.8 1.8v8a1.8 1.8 0 0 1-1.8 1.8H4.8A1.8 1.8 0 0 1 3 15.2v-8a1.8 1.8 0 0 1 1.8-1.8H9zM6.6 9.2v2.8h2.2V9.2zm4.6 0v2.8h2.2V9.2zM7.4 13.6v1.3h5.2v-1.3z"/><path d="M.8 9h1.5v4.4H.8zM17.7 9h1.5v4.4h-1.5z"/>', true),
  reply: stroke('<path d="M8 5L3.5 9.5 8 14"/><path d="M3.5 9.5H12a4.5 4.5 0 0 1 4.5 4.5v1"/>'),
  again: stroke('<path d="M4.2 10.2a5.9 5.9 0 1 0 1.9-4.6"/><path d="M4.4 3.2v3.4h3.4"/>'),
  helpful: stroke('<path d="M6.4 9.4v7.8H3.4V9.4z"/><path d="M6.4 9.4l3-6.1c1.4 0 2.3 1.1 2 2.4l-.5 2.6h4.4a1.6 1.6 0 0 1 1.6 1.9l-1.2 5.7a1.6 1.6 0 0 1-1.6 1.3H6.4"/>'),
  flag: stroke('<path d="M4.6 17.6V3.4"/><path d="M4.6 4h9.6l-2 3.3 2 3.3H4.6"/>'),
  plus: stroke('<path d="M10 4v12M4 10h12"/>'),
  cross: stroke('<path d="M5 5l10 10M15 5L5 15"/>'),
};
/** What a vote means on each kind of topic. Discussions take replies, not votes. */
function voteOf(t: { kind: FeedbackKind; known_issue: boolean }): { ask: string; done: string; icon: Raw; count: (n: number) => string } | null {
  if (t.kind === "talk" && !t.known_issue) return null;
  if (t.kind === "feature" && !t.known_issue) return { ask: "I want this", done: "You want this", icon: ICONS.want, count: (n) => (n === 1 ? "developer wants this" : "developers want this") };
  if (t.kind === "question" && !t.known_issue) return { ask: "Same question", done: "You have this question too", icon: ICONS.same, count: (n) => (n === 1 ? "developer has this question" : "developers have this question") };
  return { ask: "Affects me too", done: "It affects you too", icon: ICONS.affects, count: (n) => (n === 1 ? "developer affected" : "developers affected") };
}
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
    if (path === "/forum" || path === "/forum/messages") {
      const query = queryFrom(url.searchParams);
      if (path === "/forum/messages") query.tab = "messages";
      if ((query.tab === "yours" || query.tab === "messages") && !caller) return signIn();
      return done(await listPage(ctx, query));
    }
    // A private report under a known issue is a message to Zaisma now.
    if (path === "/forum/new" && !post && url.searchParams.get("known_issue")) return done(redirect(`/forum/messages/new${url.search}`));
    if (path === "/forum/new" || path === "/forum/messages/new") {
      const message = path === "/forum/messages/new";
      if (!caller) return signIn();
      if (!post) return done(await newPage(ctx, Object.fromEntries(url.searchParams), message));
      const form = await request.formData();
      const field = (name: string) => String(form.get(name) ?? "").trim();
      try {
        const res = (await createTopic(env, caller, {
          kind: field("kind"),
          title: field("title"),
          text: field("text"),
          ...(field("category") ? { category: field("category") } : {}),
          tags: message ? [] : form.getAll("tags").map(String),
          public: !message,
          ...(field("game") ? { game: field("game") } : {}),
          ...(field("known_issue") ? { known_issue: field("known_issue") } : {}),
          ...(await picture(form)),
        })) as Topic & { note?: string };
        const t = res.topic;
        const state = !t.public ? "posted-private" : t.shown ? "posted" : res.posts[0]?.state === "held" ? "held" : "checking";
        return done(redirect(`/forum/${t.id}?done=${state}`));
      } catch (err) {
        if (err instanceof ApiError) return done(await newPage(ctx, Object.fromEntries([...form].filter(([, v]) => typeof v === "string")) as Record<string, string>, message, err.message, err.status, form.getAll("tags").map(String)));
        throw err;
      }
    }

    const m = path.match(/^\/forum\/([a-z0-9]{1,40})(?:\/(reply|vote|follow|answer|misplaced|still-happening|helpful|report|pictures\/([a-z0-9]{1,40})))?$/);
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
    if (sub === "report" && !post) return done(await reportPage(ctx, id, url.searchParams.get("post") ?? ""));
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
      if (sub === "helpful") {
        await markHelpful(env, caller, id, field("post"), form.get("on") === "1");
        return done(redirect(`/forum/${id}#p-${field("post")}`));
      }
      if (sub === "report") {
        const res = await reportPost(env, caller, id, field("post"), { reason: field("reason"), details: field("details") });
        return done(redirect(`/forum/${id}?done=${res.hidden ? "reported-hidden" : "reported"}`));
      }
      if (sub === "still-happening") {
        await stillHappening(env, caller, id, { text: field("text") });
        return done(redirect(`/forum/${id}?done=still`));
      }
      if (sub === "misplaced") {
        await flagMisplaced(env, caller, id);
        return done(redirect(`/forum/${id}?done=misplaced`));
      }
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
  for (const k of ["q", "category", "kind", "tag", "tab", "status"] as const) if (next[k]) p.set(k, String(next[k]));
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
  const unread = ctx.viewer ? { topics: await unreadCount(ctx.env, ctx.viewer), messages: await unreadCount(ctx.env, ctx.viewer, true) } : { topics: 0, messages: 0 };
  const messages = data.tab === "messages";
  const cat = query.category ? FORUM_CATEGORIES.find((c) => c.id === query.category) : undefined;
  const area = query.category && !cat ? placeOf(query.category) : null;
  const heading = messages ? "Messages to Zaisma" : data.tab === "yours" ? "Your topics" : data.tab === "known" && !query.category ? "Known issues" : area ? area.sub : cat ? cat.name : "All topics";
  const tabs = [
    ["latest", "Latest"],
    ["top", "Top"],
    ["unanswered", "Unanswered"],
    ["known", "Known issues"],
  ] as const;
  const filters = [["", "Everything"], ...FEEDBACK_KINDS.filter((k) => !(messages && k === "talk")).map((k) => [k, KINDS[k].plural])] as const;
  const keep: Record<string, string> = {};
  for (const k of ["category", "kind", "tag", "tab", "status"] as const) if (query[k]) keep[k] = String(query[k]);
  const phases = [["", "Every phase"], ...(["investigating", "known", "planned", "fixing", "released", "fixed", "wont"] as const).map((st) => [st, STATUS[st].label])] as const;
  return forumPage(
    ctx,
    heading,
    html`<div class="forum">
${rail(ctx, query, data.tab, unread)}
<section class="board" aria-labelledby="board-h">
  <div class="board-head">
    <h1 id="board-h">${area ? html`<a class="up" href="${link(query, { category: area.category, page: 1 })}">${area.name}</a><span class="sep">/</span>` : ""}${heading}</h1>
    ${messages ? html`<a class="btn ghost" href="/forum/messages/new">New message</a>` : ""}
    ${data.tab === "yours" || messages ? "" : html`<nav class="seg tabs" aria-label="Sort">${tabs.map(([t, label]) => html`<a href="${link(query, { tab: t === "latest" ? "" : t, page: 1 })}"${data.tab === t ? raw(' aria-current="page"') : ""}>${label}</a>`)}</nav>`}
  </div>
  ${messages ? html`<p class="board-note muted">Private conversations with the people who build Zaisma: logs, unreleased games, anything you'd rather not post. Only you and Zaisma see them. When others hit the same problem, Zaisma posts a public known issue, without your words.</p>` : ""}
  <div class="filters">
    ${data.tab === "known"
      ? html`<nav class="chips" aria-label="Which phase">${phases.map(([st, label]) => html`<a href="${link(query, { status: st, page: 1 })}"${(query.status ?? "") === st ? raw(' aria-current="true"') : ""}>${label}</a>`)}</nav>`
      : html`<nav class="chips" aria-label="What kind">${filters.map(([k, label]) => html`<a href="${link(query, { kind: k, page: 1 })}"${(query.kind ?? "") === k ? raw(' aria-current="true"') : ""}>${label}</a>`)}</nav>`}
    ${query.tag ? html`<a class="tag on" href="${link(query, { tag: "", page: 1 })}" title="Show every tag">${(FORUM_TAGS as Record<string, string>)[query.tag] ?? query.tag} ×</a>` : ""}
    ${query.q ? html`<span class="muted">Matching “${query.q}” · <a href="${link(query, { q: "", page: 1 })}">Clear</a></span>` : ""}
  </div>
  ${data.pinned.length
    ? html`<details class="pinned" open><summary>${ICONS.known}<span>Known issues${cat || area ? " here" : ""}</span><small>${data.pinned.length}</small></summary>
  <ol class="topics">${data.pinned.map((t) => topicRow(t, query))}</ol></details>`
    : ""}
  ${data.topics.length
    ? html`<div class="topics-head" aria-hidden="true"><span>Topic</span><span>People</span><span>Replies</span><span>Votes</span><span>Active</span></div>
  <ol class="topics">${data.topics.map((t) => topicRow(t, query))}</ol>`
    : html`<div class="empty-board"><p>${query.q ? "Nothing matches that." : messages ? "No messages yet. Message Zaisma about anything you'd rather not post in public." : data.tab === "yours" ? "You haven't posted yet. Topics you post, reply to or vote on show here." : data.tab === "unanswered" ? "Every question here has an answer." : "No topics here yet."}</p>${ctx.viewer ? (messages ? html`<a class="btn ghost" href="/forum/messages/new">Message Zaisma</a>` : html`<a class="btn ghost" href="/forum/new${query.category ? `?category=${query.category}` : ""}">Start a topic</a>`) : ""}</div>`}
  ${data.page > 1 || data.more
    ? html`<nav class="pager" aria-label="Pages">${data.page > 1 ? html`<a class="btn ghost" href="${link(query, { page: data.page - 1 })}">Newer</a>` : ""}<span class="muted">Page ${data.page}</span>${data.more ? html`<a class="btn ghost" href="${link(query, { page: data.page + 1 })}">Older</a>` : ""}</nav>`
    : ""}
</section>
</div>`,
    { q: query.q, keep: messages ? {} : keep },
  );
}

function rail(ctx: Ctx, query: ForumQuery, tab: string, unread: { topics: number; messages: number }): Raw {
  const current = query.category ?? "";
  const openCat = FORUM_CATEGORIES.find((c) => c.id === current || current in c.areas)?.id;
  const here = (on: boolean) => (on ? raw(' aria-current="page"') : "");
  const all = !current && tab !== "yours" && tab !== "known" && tab !== "messages";
  return html`<details class="rail" open>
<summary>${current ? (placeOf(current)?.sub ?? FORUM_CATEGORIES.find((c) => c.id === current)?.name) : tab === "yours" ? "Your topics" : tab === "messages" ? "Messages to Zaisma" : "All topics"}</summary>
<nav aria-label="Forum">
  <a class="r-top" href="/forum"${here(all)}>All topics</a>
  ${ctx.viewer
    ? html`<a class="r-top" href="/forum?tab=yours"${here(tab === "yours")}>Your topics${unread.topics ? html`<span class="count" title="Topics with something new">${unread.topics}</span>` : ""}</a>
  <a class="r-top" href="/forum/messages"${here(tab === "messages")}>Messages to Zaisma${unread.messages ? html`<span class="count" title="Messages with a reply">${unread.messages}</span>` : ""}</a>`
    : ""}
  <a class="r-top" href="/forum?tab=known"${here(tab === "known" && !current)}>Known issues</a>
  <p class="r-head">Categories</p>
  ${FORUM_CATEGORIES.map(
    (c) => html`<div class="r-cat${openCat === c.id ? " open" : ""}"><a href="/forum?category=${c.id}"${here(current === c.id)}>${c.name}</a>${openCat === c.id
      ? html`<div class="r-subs">${Object.entries(c.areas).map(([a, name]) => html`<a href="/forum?category=${a}"${here(current === a)}>${name}</a>`)}</div>`
      : ""}</div>`,
  )}
  <p class="r-head">Tags</p>
  <div class="r-tags">${Object.entries(FORUM_TAGS).map(([t, name]) => html`<a class="tag${query.tag === t ? " on" : ""}" href="${link({ ...query, page: 1 }, { tag: query.tag === t ? "" : t })}">${name}</a>`)}</div>
  ${ctx.viewer ? "" : html`<p class="r-note">Anyone can read the forum. <a href="/signin?next=/forum">Sign in</a> to post, reply and vote.</p>`}
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
    <p class="tline"><a class="ttitle" href="/forum/${t.id}">${t.title}</a>${t.answered && !t.known_issue ? html`<span class="flag ok" title="Answered">${ICONS.check}Answered</span>` : ""}${t.public || q.tab === "messages" ? "" : html`<span class="flag" title="Only you and Zaisma can see it">${ICONS.lock}Message to Zaisma</span>`}${t.public && !t.shown ? html`<span class="flag warn">Being checked</span>` : ""}${t.status !== "new" && t.status !== "answered" ? statusPill(t.status, t.public) : t.status === "new" && !t.public ? statusPill(t.status, false) : ""}${t.merged_into ? html`<a class="flag" href="/forum/${t.merged_into}">Part of a known issue</a>` : ""}</p>
    ${t.match ? html`<p class="tmatch">${raw(esc(t.match).replace(/«/g, "<mark>").replace(/»/g, "</mark>"))}</p>` : ""}
    <p class="tmeta">${place ? html`<a class="cat" href="${link({}, { category: t.category ?? "" })}">${place.name} · ${place.sub}</a>` : ""}${t.tags.map(tagChip)}<span class="by">${avatar(t.author, "xs")}${t.author.name}${t.author.by === "ai" ? html`<span class="mark ai">${ICONS.ai}AI</span>` : ""}${t.author.by === "zaisma" ? html`<span class="mark team">Team</span>` : ""}</span><span class="when">${ago(t.created_at)}</span></p>
  </div>
  <div class="tpeople">${t.people.slice(0, 3).map((p) => avatar(p, "sm"))}${t.people_count > 3 ? html`<span class="more" title="${t.people_count} people in it">+${t.people_count - 3 > 99 ? "99" : t.people_count - 3}</span>` : ""}</div>
  <div class="tstat" title="${t.replies === 1 ? "1 reply" : `${t.replies} replies`}">${ICONS.replies}<span>${t.replies}</span></div>
  ${(() => {
    const v = t.public ? voteOf(t) : null;
    const n = t.known_issue ? (t.developers ?? 0) : t.votes;
    return v ? html`<div class="tstat${t.voted ? " mine" : ""}" title="${n} ${v.count(n)}">${v.icon}<span>${n}</span></div>` : html`<div class="tstat none" aria-hidden="true"></div>`;
  })()}
  <div class="tage">${ago(t.active_at)}</div>
</li>`;
}

async function similarFragment(ctx: Ctx, q: string): Promise<Response> {
  const found = await similarTopics(ctx.env, ctx.viewer, q);
  const body = found.length
    ? html`<p><strong>Already here?</strong> If one of these is the same, vote or reply there instead.</p><ol class="topics">${found.map((t) => topicRow(t, {}))}</ol>`
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
  // The reply most people found helpful, when at least two did and there's a choice (and it isn't the answer already).
  const best = rest.length > 1 ? rest.reduce<PostJson | null>((b, p) => (p.helpful >= 2 && !p.answer && (!b || p.helpful > b.helpful) ? p : b), null) : null;
  const mostHelpful = best?.id ?? "";
  const to = opts.to ? data.posts.find((p) => p.id === opts.to) : undefined;
  const notice = opts.error ? html`<p class="error" role="alert">${opts.error}</p>` : opts.done && DONE[opts.done] ? html`<p class="done" role="status">${DONE[opts.done]}</p>` : "";
  return forumPage(
    ctx,
    t.title,
    html`<div class="topic">
<article class="t-main">
  <p class="crumbs"><a href="/forum">Forum</a>${!t.public ? html`<span>/</span><a href="/forum/messages">Messages to Zaisma</a>` : place ? html`<span>/</span><a href="/forum?category=${place.category}">${place.name}</a><span>/</span><a href="/forum?category=${t.category}">${place.sub}</a>` : ""}</p>
  ${notice}
  ${t.public && !t.shown ? html`<p class="note warn-note">Others see this topic once its first post is checked${first?.state === "held" ? ": a person at Zaisma looks at it, usually within a day" : ", usually within minutes"}.</p>` : ""}
  ${opPost(ctx, t, opening, answer)}
  ${rest.length
    ? html`<h2 class="replies-h">${rest.filter((p) => p.kind !== "status" || p.text.length > 60).length === 1 ? "1 reply" : `${rest.filter((p) => p.kind !== "status" || p.text.length > 60).length} replies`}</h2>
  <ol class="posts">${rest.map((p) => postItem(ctx, t, p, data.posts, false, p.id === mostHelpful))}</ol>`
    : html`<p class="no-replies muted">No replies yet.</p>`}
  ${composer(ctx, t, data.posts_left_today, opts.text ?? "", to)}
</article>
${sidePanel(ctx, t, data.posts)}
</div>`,
    { status },
  );
}

/** Where a known issue stands, in a sentence. */
const PHASE_WORDS: Partial<Record<FeedbackStatus, string>> = {
  investigating: "Zaisma is looking into this.",
  known: "Zaisma has confirmed this.",
  planned: "This is on Zaisma's roadmap.",
  fixing: "Zaisma is working on a fix.",
  released: "A fix is out, and Zaisma is watching that it holds. If it still happens to you, say so.",
  fixed: "This is fixed.",
  wont: "Zaisma won't fix this.",
};
const TRACK: FeedbackStatus[] = ["investigating", "known", "planned", "fixing", "released", "fixed"];

/** A known issue's phases as a track, the current one lit; won't fix stands alone. */
function phaseTrack(status: FeedbackStatus): Raw {
  if (status === "wont" || !TRACK.includes(status)) return html``;
  const at = TRACK.indexOf(status);
  return html`<ol class="phases" aria-label="Phase">${TRACK.map((st, i) => html`<li class="${i < at ? "past" : i === at ? "now" : ""}"${i === at ? raw(' aria-current="step"') : ""}>${STATUS[st].label}</li>`)}</ol>`;
}

/**
 * The opening post is the topic: its title, who started it and when, what it is, the post itself in
 * larger type, and the topic's actions. A known issue opens with Zaisma's summary instead.
 */
function opPost(ctx: Ctx, t: Topic["topic"], p: PostJson | null, answer: PostJson | undefined): Raw {
  const v = voteOf(t);
  const count = t.known_issue ? (t.developers ?? 0) : t.votes;
  return html`<article class="op plate bevel-s"${p ? raw(` id="p-${p.id}"`) : ""}>
  <h1 class="t-title"><span class="ticon k-${t.known_issue ? "known" : t.kind}" title="${t.known_issue ? "Known issue" : KINDS[t.kind].label}">${kindIcon(t)}</span>${t.title}</h1>
  <p class="t-meta"><span class="kind">${t.known_issue ? "Known issue" : KINDS[t.kind].label}</span>${statusPill(t.status, t.public)}${t.tags.map(tagChip)}${t.public ? "" : html`<span class="flag">${ICONS.lock}A message to Zaisma: only you and Zaisma see it</span>`}${t.game ? html`<span class="muted">About <a href="/dashboard/${t.game}">${t.game}</a>, which only you and Zaisma see</span>` : ""}</p>
  <div class="op-by">${avatar(t.author, "md")}<div><p class="op-name">${nameOf(t.author)}${p?.state === "checking" ? html`<span class="flag warn">Being checked: only you see it yet</span>` : p?.state === "held" ? html`<span class="flag warn">Waiting for a person at Zaisma: only you see it yet</span>` : ""}</p><p class="muted">${t.known_issue ? "Known issue" : t.public ? "Started this" : "Sent this"} ${ago(t.created_at)}</p></div>${p ? html`<span class="op-report">${reportLink(ctx, t, p)}</span>` : ""}</div>
  ${t.known_issue
    ? html`${phaseTrack(t.status)}<div class="op-text"><p>${PHASE_WORDS[t.status] ?? "Zaisma knows about this."} ${t.developers === 1 ? "1 developer has" : `${t.developers} developers have`} hit it${t.roadmap ? html`; it's part of <strong>${t.roadmap}</strong> on the roadmap` : ""}.</p>${t.workaround && t.status !== "fixed" ? html`<p class="kb-work"><strong>Until it's fixed:</strong> ${t.workaround}</p>` : ""}</div>`
    : p
      ? html`<div class="op-text p-text">${richText(p.text)}</div>
  ${p.context ? html`<details class="p-att"><summary>What ${p.by.by === "ai" ? "your AI" : "you"} attached (only you and Zaisma see it)</summary><pre>${JSON.stringify(p.context, null, 2)}</pre></details>` : ""}
  ${p.picture_url ? html`<a class="p-pic" href="/forum/${t.id}/pictures/${p.id}" target="_blank" rel="noopener"><img src="/forum/${t.id}/pictures/${p.id}" alt="Your screenshot" loading="lazy"><small>Only you and Zaisma see your screenshot</small></a>` : ""}`
      : ""}
  ${t.merged_into ? html`<div class="known-box"><p class="kb-head">${ICONS.known}<span>Part of the known issue <a href="/forum/${t.merged_into.id}"><strong>${t.merged_into.title}</strong></a>.</span></p>${t.merged_into.workaround ? html`<p class="kb-work"><strong>Until it's fixed:</strong> ${t.merged_into.workaround}</p>` : ""}</div>` : ""}
  ${answer ? html`<p class="jump">${ICONS.check}<a href="#p-${answer.id}">Answered by ${answer.by.name}${answer.by.by === "ai" ? "'s AI" : ""}</a></p>` : ""}
  <div class="op-actions">
    ${v && t.can.vote
      ? html`<form method="post" action="/forum/${t.id}/vote"><input type="hidden" name="on" value="${t.voted ? "0" : "1"}"><button class="btn${t.voted ? " ghost" : " light"} vote" type="submit" aria-pressed="${t.voted ? "true" : "false"}" title="${t.voted ? "Press to take it back" : ""}">${v.icon}<span>${t.voted ? v.done : v.ask}</span></button></form>`
      : ""}
    ${v && t.public && t.shown && count > 0 ? html`<span class="op-count"><strong>${count}</strong> ${v.count(count)}</span>` : ""}
    ${t.known_issue && t.status === "released" && ctx.viewer
      ? html`<form method="post" action="/forum/${t.id}/still-happening"><button class="btn ghost" type="submit" title="Puts it back to fixing and tells Zaisma">${ICONS.again}It still happens</button></form>`
      : ""}
    <span class="op-gap"></span>
    ${t.can.reply && p?.state !== "checking" && p?.state !== "held" ? html`<a class="btn ghost" href="#reply" data-reply-top>${ICONS.reply}Reply</a>` : ""}
    ${ctx.viewer ? html`<form method="post" action="/forum/${t.id}/follow"><input type="hidden" name="on" value="${t.following ? "0" : "1"}"><button class="btn ghost" type="submit" title="${t.following ? "New replies show in Your topics. Press to stop." : "Hear about new replies in Your topics."}">${t.following ? "Following" : "Follow"}</button></form>` : ""}
  </div>
</article>`;
}

/** Report a post, for anyone signed in who didn't write it. */
function reportLink(ctx: Ctx, t: Topic["topic"], p: PostJson): Raw {
  if (!ctx.viewer || !t.public || p.by.you || p.by.by === "zaisma" || p.state !== null) return html``;
  return p.reported_by_you ? html`<span class="muted reported">${ICONS.flag}Reported</span>` : html`<a class="report" href="/forum/${t.id}/report?post=${p.id}" rel="nofollow">${ICONS.flag}Report</a>`;
}

function postItem(ctx: Ctx, t: Topic["topic"], p: PostJson, all: PostJson[], opening: boolean, mostHelpful = false): Raw {
  // A bare status change reads as a line in the thread; one with Zaisma's words is a post.
  if (p.kind === "status" && p.text.length <= 60) {
    return html`<li class="event" id="p-${p.id}">${avatar(p.by, "xs")}<p>${p.text}</p>${ago(p.at)}</li>`;
  }
  const canAnswer = t.can.answer && !opening && p.state === null && !p.by.you;
  return html`<li class="post${p.by.by === "zaisma" ? " z" : ""}${p.answer ? " answer" : ""}${opening ? " opening" : ""}${p.state ? " pending" : ""}" id="p-${p.id}">
  <div class="p-side">${avatar(p.by, "md")}</div>
  <div class="p-body">
    <header class="p-head">${nameOf(p.by)}${p.by.by !== "zaisma" && t.author.by !== "zaisma" && p.by.name === t.author.name ? html`<span class="mark op-mark" title="Started this topic">Author</span>` : ""}${p.kind === "reopen" ? html`<span class="pill pending">Reopened</span>` : ""}${p.answer ? html`<span class="flag ok">${ICONS.check}Answer</span>` : ""}${mostHelpful ? html`<span class="flag">${ICONS.helpful}Most helpful</span>` : ""}${p.state === "checking" ? html`<span class="flag warn">Being checked: only you see it yet</span>` : p.state === "held" ? html`<span class="flag warn">Waiting for a person at Zaisma: only you see it yet</span>` : ""}<a class="p-when" href="#p-${p.id}">${ago(p.at)}</a></header>
    ${p.reply_to ? html`<a class="quote" href="#p-${p.reply_to.id}">${ICONS.reply}<span><strong>${p.reply_to.name}</strong> ${p.reply_to.excerpt}${p.reply_to.excerpt.length >= 140 ? "…" : ""}</span></a>` : ""}
    <div class="p-text">${richText(p.text)}</div>
    ${p.context ? html`<details class="p-att"><summary>What ${p.by.by === "ai" ? "your AI" : "you"} attached (only you and Zaisma see it)</summary><pre>${JSON.stringify(p.context, null, 2)}</pre></details>` : ""}
    ${p.picture_url ? html`<a class="p-pic" href="/forum/${t.id}/pictures/${p.id}" target="_blank" rel="noopener"><img src="/forum/${t.id}/pictures/${p.id}" alt="Your screenshot" loading="lazy"><small>Only you and Zaisma see your screenshot</small></a>` : ""}
    <div class="p-foot">
      ${t.can.reply && p.state === null ? html`<a href="?to=${p.id}#reply" data-reply="${p.id}" data-name="${p.by.name}" data-excerpt="${p.text.slice(0, 140)}">${ICONS.reply}Reply</a>` : ""}
      ${canAnswer ? html`<form method="post" action="/forum/${t.id}/answer"><input type="hidden" name="post" value="${p.answer ? "" : p.id}"><button type="submit">${p.answer ? ICONS.cross : ICONS.check}${p.answer ? "Not the answer" : "Mark as the answer"}</button></form>` : ""}
      ${opening && all.length > 1 ? html`<span class="muted">${all.length === 2 ? "1 reply" : `${all.length - 1} replies`}</span>` : ""}
      ${t.public && p.state === null && p.kind !== "status"
        ? t.can.reply && !p.by.you
          ? html`<form method="post" action="/forum/${t.id}/helpful"><input type="hidden" name="post" value="${p.id}"><input type="hidden" name="on" value="${p.helpful_by_you ? "0" : "1"}"><button type="submit" class="${p.helpful_by_you ? "on" : ""}" aria-pressed="${p.helpful_by_you ? "true" : "false"}">${ICONS.helpful}Helpful${p.helpful ? html` <span class="n">${p.helpful}</span>` : ""}</button></form>`
          : p.helpful
            ? html`<span class="muted">${ICONS.helpful}${p.helpful} found it helpful</span>`
            : ""
        : ""}
      <span class="p-gap"></span>
      ${reportLink(ctx, t, p)}
    </div>
  </div>
</li>`;
}

function composer(ctx: Ctx, t: Topic["topic"], left: number | null, text: string, to: PostJson | undefined): Raw {
  if (!ctx.viewer || !ctx.me) return html`<div class="composer plate bevel-s signed-out" id="reply"><p>Sign in to reply, vote or follow this topic.</p><a class="btn light" href="/signin?next=/forum/${t.id}">Sign in</a></div>`;
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
  return html`<aside class="t-side">
  <dl class="facts plate bevel-s">
    <dt>Status</dt><dd>${t.status === "new" ? (t.public ? "Open" : "Waiting for Zaisma") : STATUS[t.status].label}</dd>
    ${place
      ? html`<dt>Category</dt><dd><a href="/forum?category=${place.category}">${place.name}</a> · <a href="/forum?category=${t.category}">${place.sub}</a>${t.can.flag
          ? t.flagged_misplaced
            ? html`<p class="hint flagged">You flagged it as in the wrong category. Zaisma's AI moves it if it is.</p>`
            : html`<form method="post" action="/forum/${t.id}/misplaced"><button class="link-btn" type="submit">Wrong category?</button></form>`
          : ""}</dd>`
      : ""}
    ${t.tags.length ? html`<dt>Tags</dt><dd class="tags">${t.tags.map(tagChip)}</dd>` : ""}
    ${people.length > 1 ? html`<dt>In this topic</dt><dd class="people">${people.slice(0, 8).map((p) => html`<span class="person">${avatar(p, "sm")}${nameOf(p)}</span>`)}${people.length > 8 ? html`<span class="muted">and ${people.length - 8} more</span>` : ""}</dd>` : ""}
    <dt>Who can see it</dt><dd>${t.public ? "Every developer and their AI" : "Only you and Zaisma"}</dd>
  </dl>
  ${t.known_issue && ctx.viewer
    ? html`<div class="side plate bevel-s"><p>${t.yours ? html`You've messaged Zaisma about this. <a href="/forum/${t.yours}">Open your message</a>` : html`Have logs, a screenshot or a game to point at? <a href="/forum/messages/new?known_issue=${t.id}&kind=${t.kind}">Message Zaisma about your case</a>: only Zaisma sees it, and it counts here.`}</p></div>`
    : ""}
</aside>`;
}

// --- Reporting a post ---

async function reportPage(ctx: Ctx, topicId: string, postId: string): Promise<Response> {
  const data = await getTopic(ctx.env, ctx.viewer, topicId);
  const post = data.posts.find((p) => p.id === postId);
  if (!post || post.by.by === "zaisma" || post.by.you) throw new ApiError(404, "no_post", "There's no post here you can report.");
  return forumPage(
    ctx,
    "Report a post",
    html`<div class="newtopic">
<form class="np plate bevel-s" method="post" action="/forum/${topicId}/report">
  <h1>Report a post</h1>
  <input type="hidden" name="post" value="${post.id}">
  <blockquote class="quote">${avatar(post.by, "xs")}<span><strong>${post.by.name}</strong> ${post.text.slice(0, 300)}${post.text.length > 300 ? "…" : ""}</span></blockquote>
  <fieldset class="seen"><legend>What's wrong with it?</legend>
    ${Object.entries(FORUM_REPORT_REASONS).map(([k, label], i) => html`<label class="check"><input type="radio" name="reason" value="${k}" required${i === 0 ? "" : ""}><span><strong>${label}</strong>${k === "child_safety" ? html`<small>It's hidden straight away while a person looks.</small>` : ""}</span></label>`)}
  </fieldset>
  <label>Anything else Zaisma should know (optional) <textarea name="details" maxlength="1000" rows="3"></textarea></label>
  <div class="np-foot"><button class="btn light" type="submit">Send report</button><a class="btn ghost" href="/forum/${topicId}#p-${post.id}">Cancel</a></div>
</form>
<aside class="np-side"><div class="side plate bevel-s"><h2>What happens</h2><p>A person at Zaisma looks at it. Whoever wrote it isn't told who reported it. Posts that put a young person at risk are hidden straight away, and any post three developers report is hidden until Zaisma looks.</p><p>If it's just wrong, a reply that says why helps everyone more.</p></div></aside>
</div>`,
  );
}

// --- A new topic ---

async function newPage(ctx: Ctx, f: Record<string, string>, message: boolean, error = "", status = 200, tags: string[] = []): Promise<Response> {
  const { games } = (await apiCall(ctx.env, ctx.viewer!, "GET", "/games")) as { games: { slug: string; title: string }[] };
  const kinds = message ? FEEDBACK_KINDS.filter((k) => k !== "talk") : FEEDBACK_KINDS;
  const kind = (kinds as readonly string[]).includes(f.kind ?? "") ? (f.kind as FeedbackKind) : message ? "bug" : "question";
  const known = f.known_issue ? await getTopic(ctx.env, ctx.viewer, f.known_issue).catch(() => null) : null;
  const category = f.category && !FORUM_CATEGORIES.some((c) => c.id === f.category) ? f.category : (f.category ? areasOf(f.category)[0] : "") || known?.topic.category || "";
  return forumPage(
    ctx,
    message ? "Message Zaisma" : "New topic",
    html`<div class="newtopic">
<form class="np plate bevel-s" method="post" action="${message ? "/forum/messages/new" : "/forum/new"}" enctype="multipart/form-data">
  <h1>${message ? "Message Zaisma" : "New topic"}</h1>
  ${message && !known ? html`<p class="note">Only you and the people who build Zaisma see this: share logs, an unreleased game, anything private. If others hit the same problem, Zaisma posts a public known issue without your words.</p>` : ""}
  ${error ? html`<p class="error" role="alert">${error}</p>` : ""}
  ${known
    ? html`<input type="hidden" name="known_issue" value="${known.topic.id}"><input type="hidden" name="kind" value="${kind}"><p class="note">About the known issue <a href="/forum/${known.topic.id}"><strong>${known.topic.title}</strong></a>. Only you and Zaisma see what you write here; it counts toward the developers affected, and you hear when it's fixed.</p>`
    : html`<fieldset class="kinds"><legend>What is it?</legend>${kinds.map(
        (k) => html`<label class="kind-opt"><input type="radio" name="kind" value="${k}"${k === kind ? raw(" checked") : ""}><span class="ticon k-${k}">${ICONS[k]}</span><span><strong>${KINDS[k].label}</strong><small>${KINDS[k].hint}</small></span></label>`,
      )}</fieldset>`}
  <label>Title <input name="title" required maxlength="${FEEDBACK_LIMITS.title}" value="${f.title ?? known?.topic.title ?? ""}" placeholder="Upload stops at 99% for a 300 MB build" autocomplete="off"></label>
  <div id="similar" class="similar" aria-live="polite"></div>
  <label>What happened, or what you'd like <textarea name="text" required maxlength="${FEEDBACK_LIMITS.text}" rows="9" placeholder="What you did, what you expected and what happened instead. Put code and errors between \`\`\` lines.">${f.text ?? ""}</textarea></label>
  <div class="np-row">
    <label>Category${message ? " (optional)" : ""} <select name="category"${message ? "" : raw(" required")}><option value=""${category ? "" : raw(" selected")}${message ? "" : raw(" disabled")}>${message ? "Not sure" : "Pick where it belongs"}</option>${FORUM_CATEGORIES.map(
      (c) => html`<optgroup label="${c.name}">${Object.entries(c.areas).map(([a, name]) => html`<option value="${a}"${a === category ? raw(" selected") : ""}>${name}</option>`)}</optgroup>`,
    )}</select></label>
    ${games.length ? html`<label>Which game (optional) <select name="game"><option value="">None</option>${games.map((g) => html`<option value="${g.slug}"${g.slug === f.game ? raw(" selected") : ""}>${g.title}</option>`)}</select><small class="hint">Only you and Zaisma see which game.</small></label>` : ""}
  </div>
  ${known || message
    ? ""
    : html`<fieldset class="np-tags"><legend>Tags (up to ${FEEDBACK_LIMITS.tags})</legend><div class="r-tags">${Object.entries(FORUM_TAGS).map(
        ([t, name]) => html`<label class="tag pick"><input type="checkbox" name="tags" value="${t}"${tags.includes(t) ? raw(" checked") : ""}><span>${name}</span></label>`,
      )}</div></fieldset>`}
  <label>Screenshot (optional) <input type="file" name="picture" accept="image/png,image/jpeg,image/webp"><small class="hint">PNG, JPEG or WebP up to ${FEEDBACK_LIMITS.pictureBytes / 1048576} MB. Only you and Zaisma see it.</small></label>
  <div class="np-foot"><button class="btn light" type="submit">${message ? "Send to Zaisma" : "Post topic"}</button><span class="hint">Keys and passwords are blanked before anything is saved.</span></div>
</form>
<aside class="np-side">
  ${message
    ? html`<div class="side plate bevel-s"><h2>Private</h2><p>Messages are only between you and Zaisma. To ask other developers too, <a href="/forum/new">start a public topic</a> instead.</p></div>`
    : html`<div class="side plate bevel-s"><h2>Before you post</h2><p>Search first: if someone has posted it, vote there. It counts, and you hear when it changes.</p><p>Everything here is public, checked before it shows. For logs, an unreleased game or anything private, <a href="/forum/messages/new">message Zaisma</a> instead.</p></div>`}
  <div class="side plate bevel-s"><h2>From your AI</h2><p>With the Zaisma MCP, your AI searches the forum, posts what it hits with the exact error, and replies. Its posts show your name with an ${ICONS.ai} AI mark.</p></div>
</aside>
</div>`,
    { status },
  );
}

// --- Styles and the little script ---

const FORUM_STYLES = `
main{max-width:1320px;padding-top:20px}
/* Room for the scrollbar is always kept, so pages don't shift sideways as they load. */
html{scrollbar-gutter:stable}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
.op,.post,.event,.composer{scroll-margin-top:96px}
.op:target,.post:target{box-shadow:inset 0 0 0 2px #dfe2e6,var(--rim),var(--drop)}
.link-btn{display:block;margin-top:6px;padding:0;border:0;background:none;color:var(--muted);font:inherit;font-size:13px;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.link-btn:hover{color:var(--text)}
.facts .flagged{margin:6px 0 0}
.tstat.none{visibility:hidden}
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
.tpeople .more{margin-left:-6px;min-width:26px;height:26px;padding:0 5px;display:inline-flex;align-items:center;justify-content:center;font-family:var(--display);font-size:11px;font-weight:600;color:var(--text-2);background:#2a2e35;box-shadow:0 0 0 2px #1d2026,inset 1px 1px 0 rgba(255,255,255,.1)}
.tmatch{margin:0;font-size:13px;color:var(--text-2);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.tmatch mark{background:none;color:var(--text);font-weight:600;box-shadow:inset 0 -2px 0 rgba(230,233,238,.45)}
.tstat{display:flex;align-items:center;justify-content:center;gap:5px;color:var(--muted);font-family:var(--display);font-weight:600;font-size:14px}
.tstat svg{width:16px;height:16px}
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
.op{padding:22px 24px 18px;margin:0 0 8px;display:grid;gap:14px}
.op .t-title,.op .t-meta{margin:0}
.op-by{display:flex;align-items:center;gap:12px}
.op-by p{margin:0}
.op-name{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}
.op-by .muted{font-size:13px}
.op-text{font-size:17px;line-height:1.65;color:var(--text)}
.op-text>p{margin:0 0 8px}
.op .jump{margin:0}
.phases{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:4px 0;counter-reset:phase}
.phases li{position:relative;display:flex;align-items:center;gap:8px;padding-right:22px;font-family:var(--display);font-size:13px;font-weight:500;color:var(--muted)}
.phases li::before{content:"";width:9px;height:9px;flex:none;box-shadow:inset 0 0 0 2px #4a4f58}
.phases li:not(:last-child)::after{content:"";position:absolute;right:6px;top:50%;width:10px;height:1px;background:#4a4f58}
.phases li.past{color:var(--text-2)}
.phases li.past::before{background:#8a8f98;box-shadow:none}
.phases li.now{color:var(--text);font-weight:600}
.phases li.now::before{background:var(--chrome);box-shadow:0 0 10px rgba(225,230,240,.45)}
.op .known-box{margin:0;padding:12px 14px;background:rgba(0,0,0,.2);box-shadow:inset 3px 0 0 #c9cace}
.op-actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding-top:14px;background:linear-gradient(#000,#000) top/100% 1px no-repeat;box-shadow:inset 0 1px 0 rgba(255,255,255,.04)}
.op-actions form{display:contents}
.op-actions .btn{min-height:40px}
.op-actions .btn svg{width:19px;height:19px}
.op-actions .btn.vote{padding:0 18px 0 14px}
.op-count{color:var(--muted);font-size:14px}
.op-count strong{color:var(--text);font-family:var(--display);font-size:17px}
.op-gap{flex:1}
.replies-h{font-size:18px;margin:26px 0 12px;display:flex;align-items:center;gap:14px}
.replies-h::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,rgba(230,233,238,.25),rgba(230,233,238,0))}
.no-replies{margin:18px 0}
.mark.op-mark{color:var(--text);box-shadow:inset 0 0 0 1px #8a8f98}
.posts{list-style:none;margin:0 0 20px;padding:0;display:grid;gap:10px}
.post{display:grid;grid-template-columns:40px minmax(0,1fr);gap:14px;padding:14px 18px;background:var(--brush) 0 0/320px 320px,linear-gradient(180deg,#202329,#191b20);box-shadow:var(--rim)}
.post.z{box-shadow:inset 3px 0 0 #dfe2e6,var(--rim);background:var(--brush) 0 0/320px 320px,linear-gradient(180deg,#2b3038,#1d2026)}
.post.answer{box-shadow:inset 3px 0 0 var(--ok),var(--rim)}
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
.p-foot button.on{color:var(--text)}
.p-foot .n{font-family:var(--display);font-weight:600;color:var(--text-2)}
.p-gap{flex:1}
.p-foot .report,.op-report .report,.reported{opacity:.75;font-size:12px}
.p-foot .report:hover,.op-report .report:hover{opacity:1}
.op-report{margin-left:auto;align-self:flex-start}
.op-report a,.op-report span{display:inline-flex;align-items:center;gap:5px;color:var(--muted);text-decoration:none;font-family:var(--display)}
.op-report svg,.reported svg{width:13px;height:13px}
blockquote.quote{margin:0}
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
  .op{padding:18px 16px 14px}
  .op-text{font-size:16px}
  .post .av.md,.c-row .av.md{--s:28px}
  .c-row{grid-template-columns:minmax(0,1fr)}
  .c-row .av{display:none}
  .c-foot{padding-left:0}
  .np{padding:18px 16px}
  .event{padding-left:8px}
}
`;

// Reply to one post without reloading, keep the rail closed on phones, suggest similar topics while
// a title is typed, and keep tags to three.
const FORUM_SCRIPT = `(()=>{
const rail=document.querySelector(".rail");if(rail&&matchMedia("(max-width:900px)").matches)rail.open=false;
const c=document.getElementById("reply");
if(c&&c.tagName==="FORM"){const box=c.querySelector(".replying"),to=c.elements.reply_to;
document.addEventListener("click",e=>{const a=e.target.closest("[data-reply]");if(a){e.preventDefault();to.value=a.dataset.reply;box.querySelector("[data-to-name]").textContent=a.dataset.name;box.querySelector("[data-to-excerpt]").textContent=a.dataset.excerpt;box.hidden=false;c.scrollIntoView({behavior:"smooth",block:"center"});c.elements.text.focus({preventScroll:true})}
if(e.target.closest("[data-unreply]")||e.target.closest("[data-reply-top]")){to.value="";box.hidden=true;if(e.target.closest("[data-reply-top]")){e.preventDefault();c.scrollIntoView({behavior:"smooth",block:"center"});c.elements.text.focus({preventScroll:true})}}})}
const f=document.querySelector("form.np");if(!f)return;
const t=f.elements.title,sim=document.getElementById("similar");let timer=0,last="";
const look=()=>{const q=t.value.trim();if(q===last)return;last=q;if(q.length<6){sim.innerHTML="";return}fetch("/forum/similar?q="+encodeURIComponent(q)).then(r=>r.text()).then(h=>{if(t.value.trim()===q)sim.innerHTML=h}).catch(()=>{})};
t.addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(look,350)});
const tags=[...f.querySelectorAll("input[name=tags]")],cap=()=>{const n=tags.filter(x=>x.checked).length;tags.forEach(x=>x.disabled=!x.checked&&n>=${FEEDBACK_LIMITS.tags})};tags.forEach(x=>x.addEventListener("change",cap));cap();
})();`;
