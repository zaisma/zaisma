import {
  ApiError,
  accountById,
  FORUM_CATEGORIES,
  FORUM_LIMITS,
  FORUM_REPORT_REASONS,
  FORUM_SECTIONS,
  FORUM_TAGS,
  TOPIC_KINDS,
  forumCategoryName,
  forumSectionOf,
  type Account,
  type DebugContext,
  type PostRating,
  type TopicKind,
  type TopicStatus,
} from "@zaisma/core";
import { currentSession } from "./auth.ts";
import { apiCall, callerFor, type Caller } from "./developer.ts";
import type { Env } from "./env.ts";
import { accountPicture, esc, html, layout, raw, scriptTags, securityHeaders, type Raw } from "./html.ts";
import { pageScript } from "./page-scripts.ts";
import { profilePath } from "./profiles.ts";
import { forumPeople, previewMentions } from "./forum-mentions.ts";
import { uploadDraftMedia } from "./forum-posts.ts";
import { renderMarkdown, VIDEO_FRAMES } from "./forum-markdown.ts";
import {
  createTopic,
  flagMisplaced,
  follow,
  bookmarkPost,
  ratePost,
  reportPost,
  serveMedia,
  stillHappening,
  getTopic,
  listTopics,
  markAnswer,
  replyTo,
  similarTopics,
  unreadCount,
  vote,
  type Person,
  type PostJson,
  type TopicRow,
  type Viewer,
} from "./forum.ts";

/**
 * The developer forum's pages (docs/DECISIONS.md): the topic list with its section rail, a topic,
 * and a new topic. Anyone can read what's public; posting needs an account. Every read and change is
 * the same function the API and MCP call (forum.ts), so a developer and their AI see the same forum.
 * Forms use the API's field names.
 */

type Topic = Awaited<ReturnType<typeof getTopic>>;
type TopicDetail = Topic["topic"];

export const KINDS: Record<TopicKind, { label: string; plural: string; hint: string }> = {
  bug: { label: "Bug", plural: "Bugs", hint: "Something in Zaisma doesn't work as it should." },
  gap: { label: "Missing", plural: "Missing", hint: "A limit, or a missing piece, blocks you." },
  feature: { label: "Idea", plural: "Ideas", hint: "Something that would make Zaisma better for you." },
  question: { label: "Question", plural: "Questions", hint: "How something works, or how to do something." },
  talk: { label: "Discussion", plural: "Discussions", hint: "Anything else about making games on Zaisma." },
};
const STATUS: Record<TopicStatus, { label: string; pill: string }> = {
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

const stroke = (paths: string, isFilled = false) =>
  raw(`<svg viewBox="0 0 20 20" fill="${isFilled ? "currentColor" : "none"}" stroke="${isFilled ? "none" : "currentColor"}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`);
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
  dislike: stroke('<path d="M6.4 10.6V2.8H3.4v7.8z"/><path d="M6.4 10.6l3 6.1c1.4 0 2.3-1.1 2-2.4l-.5-2.6h4.4a1.6 1.6 0 0 0 1.6-1.9L15.7 4a1.6 1.6 0 0 0-1.6-1.2H6.4"/>'),
  bookmark: stroke('<path d="M5.6 3h8.8v14L10 13.4 5.6 17z"/>'),
  flag: stroke('<path d="M4.6 17.6V3.4"/><path d="M4.6 4h9.6l-2 3.3 2 3.3H4.6"/>'),
  image: stroke('<rect x="2.6" y="3.6" width="14.8" height="12.8"/><circle cx="7" cy="8" r="1.5"/><path d="M17.4 13.2l-4.2-4.2-7.6 7.4"/>'),
  quote: stroke('<path d="M3.5 9.5h4v5h-4zM3.5 9.5c0-2.6 1.2-4.2 3.6-5M12.5 9.5h4v5h-4zM12.5 9.5c0-2.6 1.2-4.2 3.6-5"/>'),
  plus: stroke('<path d="M10 4v12M4 10h12"/>'),
  cross: stroke('<path d="M5 5l10 10M15 5L5 15"/>'),
};
/** What a vote means on each kind of topic. Discussions take replies, not votes. */
function voteOf(topic: { kind: TopicKind; is_known_issue: boolean }): { ask: string; done: string; icon: Raw; countLabel: (voteCount: number) => string } | null {
  if (topic.kind === "talk" && !topic.is_known_issue) return null;
  if (topic.kind === "feature" && !topic.is_known_issue) return { ask: "I want this", done: "You want this", icon: ICONS.want, countLabel: (voteCount) => (voteCount === 1 ? "developer wants this" : "developers want this") };
  if (topic.kind === "question" && !topic.is_known_issue) {
    return { ask: "Same question", done: "You have this question too", icon: ICONS.same, countLabel: (voteCount) => (voteCount === 1 ? "developer has this question" : "developers have this question") };
  }
  return { ask: "Affects me too", done: "It affects you too", icon: ICONS.affects, countLabel: (voteCount) => (voteCount === 1 ? "developer affected" : "developers affected") };
}
const kindIcon = (topic: { kind: TopicKind; is_known_issue: boolean }) => (topic.is_known_issue ? ICONS.known : ICONS[topic.kind]);
/** Your own post others can't see yet: still being checked, or held for a person. */
/** A bare status change reads as a line in the thread, not a post. */
const isEvent = (post: PostJson) => post.kind === "status" && post.text_markdown.length <= 60;
const isWaiting = (post: PostJson) => post.check_status === "pending" || post.check_status === "held";

export async function handleForum(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path !== "/forum" && !path.startsWith("/forum/")) return null;
  const isPost = request.method === "POST";
  if (isPost && request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return new Response("Bad origin", { status: 403 });
  const url = new URL(request.url);
  const session = await currentSession(request, env);
  const caller = session ? await callerFor(env, request, session.userId, session.cookies) : null;
  const done = (response: Response) => withCookies(response, session?.cookies ?? []);
  const signIn = () => done(redirect(`/signin?next=${encodeURIComponent(path + url.search)}`));
  const account = caller ? await accountById(env.DB, caller.accountId) : null;
  const ctx: Ctx = { env, viewer: caller, me: caller ? mePerson(account) : null, account, url };

  try {
    if (path === "/forum/similar") return done(await similarFragment(ctx, url.searchParams.get("search_text") ?? ""));
    const media = path.match(/^\/forum\/media\/(media_[a-z0-9]{1,40})$/);
    if (media && !isPost) return done(await serveMedia(env, caller, media[1]!));
    if (path === "/forum/people" && !isPost) {
      if (!caller) return new Response("[]", { status: 401, headers: { "Content-Type": "application/json" } });
      const people = await forumPeople(env, url.searchParams.get("name_prefix") ?? "", url.searchParams.get("topic_id") || null, caller.accountId);
      return done(new Response(JSON.stringify(people), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }));
    }
    if (path === "/forum/out" && !isPost) return done(outPage(ctx, url.searchParams.get("to") ?? ""));
    // An image to place in a post's text, uploaded while it's written.
    if (path === "/forum/media" && isPost) {
      if (!caller) return new Response(JSON.stringify({ error: "Sign in to add images." }), { status: 401, headers: { "Content-Type": "application/json" } });
      const file = (await request.formData()).get("file");
      try {
        if (!(file instanceof File)) throw new ApiError("no_file", { message: "No image was chosen.", field: "image", fix: "Choose an image." });
        const uploaded = await uploadDraftMedia(env, caller, new Uint8Array(await file.arrayBuffer()));
        return done(new Response(JSON.stringify(uploaded), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }));
      } catch (error) {
        if (error instanceof ApiError) return new Response(JSON.stringify({ error: error.messageWithFix }), { status: error.httpStatus, headers: { "Content-Type": "application/json" } });
        throw error;
      }
    }
    // What a draft will look like, rendered exactly as a post is.
    if (path === "/forum/preview" && isPost) {
      if (!caller) return new Response("", { status: 401 });
      const text = String((await request.formData()).get("text_markdown") ?? "").slice(0, FORUM_LIMITS.textCharacterCount);
      const body = text.trim() ? renderMarkdown(text, { siteOrigin: env.SITE_ORIGIN, mentions: await previewMentions(env, text) }) : `<p class="muted">Nothing to preview yet.</p>`;
      return done(new Response(body, { headers: securityHeaders(env, { "Cache-Control": "no-store" }) }));
    }
    if (path === "/forum" || path === "/forum/messages") {
      const query = pageQueryFrom(url.searchParams);
      if (path === "/forum/messages") query.tab = "messages";
      if ((query.tab === "yours" || query.tab === "messages" || query.tab === "bookmarks") && !caller) return signIn();
      return done(await listPage(ctx, query));
    }
    // A private message about a known issue is a message to Zaisma.
    if (path === "/forum/new" && !isPost && url.searchParams.get("known_issue_topic_id")) return done(redirect(`/forum/messages/new${url.search}`));
    if (path === "/forum/new" || path === "/forum/messages/new") {
      const isMessage = path === "/forum/messages/new";
      if (!caller) return signIn();
      if (!isPost) return done(await newPage(ctx, Object.fromEntries(url.searchParams), isMessage));
      const form = await request.formData();
      const field = (name: string) => String(form.get(name) ?? "").trim();
      try {
        const created = await createTopic(env, caller, {
          kind: field("kind"),
          title: field("title"),
          text_markdown: field("text_markdown"),
          ...(field("category") ? { category: field("category") } : {}),
          tags: isMessage ? [] : form.getAll("tags").map(String),
          is_public: !isMessage,
          ...(field("game_slug") ? { game_slug: field("game_slug") } : {}),
          ...(field("known_issue_topic_id") ? { known_issue_topic_id: field("known_issue_topic_id") } : {}),
          ...(await imagesFrom(form)),
        });
        const topic = created.topic;
        const state = !topic.is_public ? "posted-private" : topic.is_shown ? "posted" : created.posts[0]?.check_status === "held" ? "held" : "checking";
        return done(redirect(`/forum/${topic.id}?done=${state}`));
      } catch (error) {
        if (error instanceof ApiError) {
          const given = Object.fromEntries([...form].filter(([, entry]) => typeof entry === "string")) as Record<string, string>;
          return done(await newPage(ctx, given, isMessage, error.messageWithFix, error.httpStatus, form.getAll("tags").map(String)));
        }
        throw error;
      }
    }

    const topicPath = path.match(/^\/forum\/(topic_[a-z0-9]{1,40})(?:\/(reply|vote|follow|answer|misplaced|still-happening|rate|bookmark|report))?$/);
    if (!topicPath) return null;
    const [, id, action] = topicPath as unknown as [string, string, string | undefined];
    if (!action && !isPost) return done(await topicPage(ctx, id, { done: url.searchParams.get("done") ?? undefined, replyToPostId: url.searchParams.get("reply_to_post_id") ?? undefined }));
    if (!caller) return signIn();
    if (action === "report" && !isPost) return done(await reportPage(ctx, id, url.searchParams.get("post_id") ?? ""));
    if (!isPost) return done(redirect(`/forum/${id}`));
    const form = await request.formData();
    const field = (name: string) => String(form.get(name) ?? "").trim();
    // A toggle's form says undo when it takes back what's on.
    const isUndo = form.get("undo") === "1";
    if (action === "reply") {
      const reopen = form.get("reopen") === "1";
      try {
        const replied = await replyTo(env, caller, id, {
          text_markdown: field("text_markdown"),
          ...(field("reply_to_post_id") ? { reply_to_post_id: field("reply_to_post_id") } : {}),
          ...(reopen ? { reopen: true } : {}),
          ...(await imagesFrom(form)),
        });
        const state = reopen ? "reopened" : replied.post.check_status === "pending" ? "checking" : replied.post.check_status === "held" ? "held" : "replied";
        return done(redirect(`/forum/${id}?done=${state}#p-${replied.post.id}`));
      } catch (error) {
        if (error instanceof ApiError) return done(await topicPage(ctx, id, { error: error.messageWithFix, textMarkdown: field("text_markdown"), replyToPostId: field("reply_to_post_id") || undefined }, error.httpStatus));
        throw error;
      }
    }
    try {
      if (action === "vote") await vote(env, caller, id, !isUndo);
      if (action === "follow") await follow(env, caller, id, !isUndo);
      if (action === "answer") await markAnswer(env, caller, id, field("answer_post_id") || null);
      if (action === "rate") {
        await ratePost(env, caller, id, field("post_id"), isUndo ? null : (field("rating") as PostRating));
        return done(redirect(`/forum/${id}#p-${field("post_id")}`));
      }
      if (action === "bookmark") {
        await bookmarkPost(env, caller, id, field("post_id"), !isUndo);
        return done(redirect(`/forum/${id}#p-${field("post_id")}`));
      }
      if (action === "report") {
        const reported = await reportPost(env, caller, id, field("post_id"), { reason: field("reason"), details: field("details") });
        return done(redirect(`/forum/${id}?done=${reported.is_hidden ? "reported-hidden" : "reported"}`));
      }
      if (action === "still-happening") {
        await stillHappening(env, caller, id, {});
        return done(redirect(`/forum/${id}?done=still`));
      }
      if (action === "misplaced") {
        await flagMisplaced(env, caller, id);
        return done(redirect(`/forum/${id}?done=misplaced`));
      }
    } catch (error) {
      if (error instanceof ApiError) return done(await topicPage(ctx, id, { error: error.messageWithFix }, error.httpStatus));
      throw error;
    }
    return done(redirect(`/forum/${id}${action === "answer" && field("answer_post_id") ? `#p-${field("answer_post_id")}` : ""}`));
  } catch (error) {
    if (error instanceof ApiError && error.httpStatus === 404) {
      return done(
        forumPage(ctx, "Not found", html`<div class="gone"><h1>Not found</h1><p class="lead">There's no topic here you can see. It may be private, or still being checked.</p><a class="btn ghost" href="/forum">Back to the forum</a></div>`, {
          httpStatus: 404,
        }),
      );
    }
    throw error;
  }
}

interface Ctx {
  env: Env;
  viewer: Viewer;
  me: Person | null;
  /** The signed-in account, for the header. */
  account: Account | null;
  url: URL;
}

/** What a forum page's address asks for. search_text is the site header's search box. */
interface PageQuery {
  search_text?: string;
  section?: string;
  category?: string;
  kind?: string;
  tag?: string;
  tab?: string;
  topic_status?: string;
  page_number?: number;
}

const PAGE_TOPIC_COUNT = 30;

function pageQueryFrom(queryParameters: URLSearchParams): PageQuery {
  return {
    search_text: queryParameters.get("search_text") ?? "",
    section: queryParameters.get("section") ?? "",
    category: queryParameters.get("category") ?? "",
    kind: queryParameters.get("kind") ?? "",
    tag: queryParameters.get("tag") ?? "",
    tab: queryParameters.get("tab") ?? "",
    topic_status: queryParameters.get("topic_status") ?? "",
    page_number: Math.max(1, Math.min(1000, Math.floor(Number(queryParameters.get("page_number")) || 1))),
  };
}

function mePerson(account: Account | null): Person {
  return { name: account?.username ?? "You", kind: "developer", is_you: true };
}

function redirect(to: string): Response {
  return new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store" } });
}

function withCookies(response: Response, cookies: string[]): Response {
  if (!cookies.length) return response;
  const withSet = new Response(response.body, response);
  for (const cookie of cookies) withSet.headers.append("Set-Cookie", cookie);
  return withSet;
}

/** The images from a form, as the API takes them. */
async function imagesFrom(form: FormData): Promise<{ images_base64?: string[] }> {
  const files = form.getAll("images").filter((file): file is File => file instanceof File && file.size > 0);
  if (!files.length) return {};
  if (files.length > FORUM_LIMITS.imageCountPerPost) throw new ApiError("too_many_images", { message: `That's ${files.length} images, over ${FORUM_LIMITS.imageCountPerPost}.`, field: "images", fix: `Attach up to ${FORUM_LIMITS.imageCountPerPost} images a post; put the rest in a reply.` });
  const images: string[] = [];
  for (const file of files) {
    if (file.size > FORUM_LIMITS.imageSizeBytes) throw new ApiError("image_too_big", { message: `${file.name || "An image"} is over ${FORUM_LIMITS.imageSizeBytes / 1048576} MB.`, field: "images", fix: "Save it smaller (a JPEG or WebP, or fewer pixels) and attach it again." });
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    images.push(btoa(binary));
  }
  return { images_base64: images };
}

/** The site's page with the forum's search and New topic in the header. */
function forumPage(ctx: Ctx, title: string, body: Raw, options: { httpStatus?: number; searchText?: string; keep?: Record<string, string> } = {}): Response {
  const category = ctx.url.searchParams.get("category");
  const page = layout(ctx.env, {
    title: `${title} · Zaisma forum`,
    body: html`<style>${raw(FORUM_STYLES)}</style>${body}${scriptTags(FORUM_SCRIPT, POSTS_SCRIPT)}`,
    isPrivate: true,
    nav: "forum",
    viewer: { account: ctx.account },
    search: { action: "/forum", searchText: options.searchText ?? "", placeholder: "Search the forum", label: "Search the forum", keep: options.keep },
    frames: VIDEO_FRAMES,
    action: html`<a class="btn light new-topic" href="/forum/new${category ? `?category=${encodeURIComponent(category)}` : ""}">${ICONS.plus}<span>New topic</span></a>`,
  });
  return new Response(page.body, { status: options.httpStatus ?? 200, headers: page.headers });
}

// --- Bits every page uses ---

/** An account's picture (accountPicture). An AI's post shows its developer's, with the AI mark. */
export function avatar(person: Person, avatarSize: "xs" | "sm" | "md" = "md"): Raw {
  if (person.kind === "zaisma") return html`<span class="av ${avatarSize} z" title="Zaisma"><img src="/zaisma-mark-small-black.svg" alt=""></span>`;
  return accountPicture(person.name, avatarSize, { title: person.kind === "ai" ? `${person.name}'s AI` : person.name, mark: person.kind === "ai" ? html`<i class="ai-mark">${ICONS.ai}</i>` : "" });
}

/** A name as posts show it: the developer, an AI mark for their AI, a Team mark for Zaisma. */
/** A developer's name opens their profile; Zaisma's and a deleted account's open nothing. */
function nameOf(person: Person): Raw {
  const hasProfile = person.kind !== "zaisma" && /^[A-Za-z0-9_]+$/.test(person.name);
  return html`<span class="who"><strong>${hasProfile ? html`<a class="to-profile" href="${profilePath(person.name)}">${person.name}</a>` : person.name}</strong>${person.kind === "ai" ? html`<span class="mark ai" title="Written by ${person.is_you ? "your" : `${person.name}'s`} AI assistant">${ICONS.ai}AI</span>` : ""}${person.kind === "zaisma" ? html`<span class="mark team">Team</span>` : ""}${person.is_you ? html`<span class="you">you</span>` : ""}</span>`;
}

function ago(isoTime: string): Raw {
  const atMs = Date.parse(isoTime);
  const ageSec = Math.max(0, (Date.now() - atMs) / 1000);
  const text =
    ageSec < 60
      ? "now"
      : ageSec < 3600
        ? `${Math.floor(ageSec / 60)}m`
        : ageSec < 86400
          ? `${Math.floor(ageSec / 3600)}h`
          : ageSec < 86400 * 30
            ? `${Math.floor(ageSec / 86400)}d`
            : new Date(atMs).toLocaleDateString("en", { month: "short", day: "numeric", year: ageSec > 86400 * 300 ? "numeric" : undefined });
  return html`<time datetime="${isoTime}" title="${isoTime.slice(0, 16).replace("T", " ")} UTC">${text}</time>`;
}

const statusPill = (status: TopicStatus, isPublic: boolean) =>
  status === "new" ? (isPublic ? "" : html`<span class="pill pending">Waiting for Zaisma</span>`) : html`<span class="pill ${STATUS[status].pill}">${STATUS[status].label}</span>`;

function link(query: PageQuery, change: Partial<PageQuery>): string {
  const next = { ...query, ...change };
  const queryParameters = new URLSearchParams();
  for (const key of ["search_text", "section", "category", "kind", "tag", "tab", "topic_status"] as const) if (next[key]) queryParameters.set(key, String(next[key]));
  if (next.page_number && next.page_number > 1) queryParameters.set("page_number", String(next.page_number));
  const search = queryParameters.toString();
  return `/forum${search ? `?${search}` : ""}`;
}

/** Where a category sits: its section and its own name. */
function placeOf(category: string | null): { section: string; sectionName: string; categoryName: string } | null {
  if (!category) return null;
  const section = forumSectionOf(category);
  return section ? { section: section.id, sectionName: section.name, categoryName: forumCategoryName(category)! } : null;
}

const tagChip = (tag: string) => html`<a class="tag" href="/forum?tag=${tag}">${(FORUM_TAGS as Record<string, string>)[tag] ?? tag}</a>`;

/** A post as one line of plain words, for quoting it: code, links and markdown's marks taken out. */
function plain(text: string, maximumCharacterCount = 140): string {
  const words = text
    .replace(/```[\s\S]*?(```|$)/g, " [code] ")
    .replace(/!?\[([^\]\n]*)\]\([^)\s]*\)/g, "$1")
    .replace(/@\[([^\]\n]{1,60})\]/g, "@$1")
    .replace(/^\s{0,3}(#{1,3}|>|[-*+]|\d{1,3}[.)])\s+/gm, "")
    .replace(/(\*\*|__|~~|`|\*|_(?=\S)|(?<=\S)_)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return words.length > maximumCharacterCount ? `${words.slice(0, maximumCharacterCount - 1).trimEnd()}…` : words;
}

/** Post text: markdown, with the people it mentions (forum-markdown.ts). */
function richText(ctx: Ctx, post: PostJson): Raw {
  return raw(renderMarkdown(post.text_markdown, { siteOrigin: ctx.env.SITE_ORIGIN, mentions: new Set(post.mentioned_names.map((name) => name.toLowerCase())) }));
}

/** A post's images, opening full size. */
function mediaGrid(post: PostJson): Raw {
  const rest = post.media.filter((image) => !post.text_markdown.includes(`/forum/media/${image.id}`));
  if (!rest.length) return html``;
  return html`<div class="p-media${rest.length === 1 ? " one" : ""}">${rest.map(
    (image, i) => html`<a href="/forum/media/${image.id}" target="_blank" rel="noopener"><img src="/forum/media/${image.id}" alt="Image ${i + 1} from ${post.author.name}" loading="lazy"></a>`,
  )}</div>`;
}

const DEBUG_CONTEXT_LABELS: Record<keyof DebugContext, string> = { call: "Call", error_code: "Error code", error_message: "Error", request_json: "What was sent", notes: "Notes" };

/** What the poster's AI attached for whoever fixes it: only they and Zaisma see it. */
function attached(post: PostJson): Raw {
  const debugContext = post.debug_context;
  if (!debugContext) return html``;
  const fields = (Object.keys(DEBUG_CONTEXT_LABELS) as (keyof DebugContext)[]).filter((key) => debugContext[key]);
  return html`<details class="p-att"><summary>What ${post.author.kind === "ai" ? "your AI" : "you"} attached (only you and Zaisma see it)</summary><dl>${fields.map(
    (key) => html`<dt>${DEBUG_CONTEXT_LABELS[key]}</dt><dd><pre>${debugContext[key]}</pre></dd>`,
  )}</dl></details>`;
}

/** Formatting, in the bar and over a selection in the text (the script wires them up). */
const FORMAT_TOOLS: [string, string, string][] = [
  ["bold", "<b>B</b>", "Bold (⌘B)"],
  ["italic", "<i>I</i>", "Italic (⌘I)"],
  ["strike", "<s>S</s>", "Strikethrough"],
  ["code", "&lt;/&gt;", "Code"],
  ["link", '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M8.5 11.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M11.5 8.5a3.5 3.5 0 0 0-5 0L4 11a3.5 3.5 0 0 0 5 5l1-1"/></svg>', "Link (⌘K)"],
  ["heading", "H", "Heading"],
  ["bullets", "•", "Bulleted list"],
  ["dashes", "–", "Dashed list"],
  ["numbers", "1.", "Numbered list"],
  ["quote", "“”", "Quote"],
];

/** Write and Preview, Insert (images, a link, a video, code) and formatting, over a text box. */
function editorBar(): Raw {
  return html`<div class="ed-bar" role="toolbar" aria-label="Writing tools">
  <span class="ed-tabs"><button type="button" data-tab="write" aria-pressed="true">Write</button><button type="button" data-tab="preview" aria-pressed="false">Preview</button></span>
  <span class="ed-tools"><button type="button" class="ed-insert" data-insert-menu aria-haspopup="menu" aria-expanded="false">${ICONS.plus}Insert</button><span class="ed-format">${raw(FORMAT_TOOLS.map(([command, label, title]) => `<button type="button" data-md="${command}" title="${title}" aria-label="${title}">${label}</button>`).join(""))}</span></span>
  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden data-upload>
</div><p class="ed-error error" hidden></p>`;
}

// --- The topic list ---

async function listPage(ctx: Ctx, query: PageQuery): Promise<Response> {
  const pageNumber = query.page_number ?? 1;
  const listing = await listTopics(ctx.env, ctx.viewer, {
    searchText: query.search_text,
    section: query.section,
    category: query.category,
    kind: query.kind,
    tag: query.tag,
    tab: query.tab,
    topicStatus: query.topic_status,
    startIndex: (pageNumber - 1) * PAGE_TOPIC_COUNT,
  });
  const unread = ctx.viewer ? { topicCount: await unreadCount(ctx.env, ctx.viewer), messageCount: await unreadCount(ctx.env, ctx.viewer, true) } : { topicCount: 0, messageCount: 0 };
  const isMessages = listing.tab === "messages";
  const section = query.section && !query.category ? FORUM_SECTIONS.find((candidate) => candidate.id === query.section) : undefined;
  const place = query.category ? placeOf(query.category) : null;
  const isBookmarks = listing.tab === "bookmarks";
  const heading = isMessages ? "Messages to Zaisma" : isBookmarks ? "Bookmarks" : listing.tab === "yours" ? "Your topics" : listing.tab === "known" && !section && !place ? "Known issues" : place ? place.categoryName : section ? section.name : "All topics";
  const tabs = [
    ["latest", "Latest"],
    ["top", "Top"],
    ["unanswered", "Unanswered"],
    ["known", "Known issues"],
  ] as const;
  const filters = [["", "Everything"], ...TOPIC_KINDS.filter((kind) => !(isMessages && kind === "talk")).map((kind) => [kind, KINDS[kind].plural])] as const;
  const keep: Record<string, string> = {};
  for (const key of ["section", "category", "kind", "tag", "tab", "topic_status"] as const) if (query[key]) keep[key] = String(query[key]);
  const phases = [["", "Every phase"], ...(["investigating", "known", "planned", "fixing", "released", "fixed", "wont"] as const).map((status) => [status, STATUS[status].label])] as const;
  const hasMore = listing.next_cursor !== null;
  return forumPage(
    ctx,
    heading,
    html`<div class="forum">
${rail(ctx, query, listing.tab, unread)}
<section class="board" aria-labelledby="board-h">
  <div class="board-head">
    <h1 id="board-h">${place ? html`<a class="up" href="${link(query, { section: place.section, category: "", page_number: 1 })}">${place.sectionName}</a><span class="sep">/</span>` : ""}${heading}</h1>
    ${isMessages ? html`<a class="btn ghost" href="/forum/messages/new">New message</a>` : ""}
    ${listing.tab === "yours" || isMessages || isBookmarks ? "" : html`<nav class="seg tabs" aria-label="Sort">${tabs.map(([tab, label]) => html`<a href="${link(query, { tab: tab === "latest" ? "" : tab, page_number: 1 })}"${listing.tab === tab ? raw(' aria-current="page"') : ""}>${label}</a>`)}</nav>`}
  </div>
  ${isMessages ? html`<p class="board-note muted">Private conversations with the people who build Zaisma: logs, unreleased games, anything you'd rather not post. Only you and Zaisma see them. When others hit the same problem, Zaisma posts a public known issue, without your words.</p>` : ""}
  <div class="filters">
    ${listing.tab === "known"
      ? html`<nav class="chips" aria-label="Which phase">${phases.map(([status, label]) => html`<a href="${link(query, { topic_status: status, page_number: 1 })}"${(query.topic_status ?? "") === status ? raw(' aria-current="true"') : ""}>${label}</a>`)}</nav>`
      : html`<nav class="chips" aria-label="What kind">${filters.map(([kind, label]) => html`<a href="${link(query, { kind, page_number: 1 })}"${(query.kind ?? "") === kind ? raw(' aria-current="true"') : ""}>${label}</a>`)}</nav>`}
    ${query.tag ? html`<a class="tag on" href="${link(query, { tag: "", page_number: 1 })}" title="Show every tag">${(FORUM_TAGS as Record<string, string>)[query.tag] ?? query.tag} ×</a>` : ""}
    ${query.search_text ? html`<span class="muted">Matching “${query.search_text}” · <a href="${link(query, { search_text: "", page_number: 1 })}">Clear</a></span>` : ""}
  </div>
  ${listing.pinned_topics.length
    ? html`<details class="pinned" open><summary>${ICONS.known}<span>Known issues${section || place ? " here" : ""}</span><small>${listing.pinned_topics.length}</small></summary>
  <ol class="topics">${listing.pinned_topics.map((topic) => topicRow(topic, query))}</ol></details>`
    : ""}
  ${listing.topics.length
    ? html`<div class="topics-head" aria-hidden="true"><span>Topic</span><span>People</span><span>Replies</span><span>Votes</span><span>Active</span></div>
  <ol class="topics">${listing.topics.map((topic) => topicRow(topic, query))}</ol>`
    : html`<div class="empty-board"><p>${query.search_text ? "Nothing matches that." : isMessages ? "No messages yet. Message Zaisma about anything you'd rather not post in public." : isBookmarks ? "Posts you bookmark show up here." : listing.tab === "yours" ? "You haven't posted yet. Topics you post, reply to or vote on show here." : listing.tab === "unanswered" ? "Every question here has an answer." : "No topics here yet."}</p>${ctx.viewer ? (isMessages ? html`<a class="btn ghost" href="/forum/messages/new">Message Zaisma</a>` : html`<a class="btn ghost" href="/forum/new${query.category ? `?category=${query.category}` : ""}">Start a topic</a>`) : ""}</div>`}
  ${pageNumber > 1 || hasMore
    ? html`<nav class="pager" aria-label="Pages">${pageNumber > 1 ? html`<a class="btn ghost" href="${link(query, { page_number: pageNumber - 1 })}">Newer</a>` : ""}<span class="muted">Page ${pageNumber}</span>${hasMore ? html`<a class="btn ghost" href="${link(query, { page_number: pageNumber + 1 })}">Older</a>` : ""}</nav>`
    : ""}
</section>
</div>`,
    { searchText: query.search_text, keep: isMessages ? {} : keep },
  );
}

function rail(ctx: Ctx, query: PageQuery, tab: string, unread: { topicCount: number; messageCount: number }): Raw {
  const category = query.category ?? "";
  const openSection = category ? forumSectionOf(category)?.id : query.section;
  const here = (isHere: boolean) => (isHere ? raw(' aria-current="page"') : "");
  const isAll = !category && !query.section && tab !== "yours" && tab !== "known" && tab !== "messages" && tab !== "bookmarks";
  const summary = category
    ? (placeOf(category)?.categoryName ?? category)
    : query.section
      ? (FORUM_SECTIONS.find((section) => section.id === query.section)?.name ?? "All topics")
      : tab === "yours"
        ? "Your topics"
        : tab === "messages"
          ? "Messages to Zaisma"
          : tab === "bookmarks"
            ? "Bookmarks"
            : "All topics";
  return html`<details class="rail" open>
<summary>${summary}</summary>
<nav aria-label="Forum">
  <a class="r-top" href="/forum"${here(isAll)}>All topics</a>
  ${ctx.viewer
    ? html`<a class="r-top" href="/forum?tab=yours"${here(tab === "yours")}>Your topics${unread.topicCount ? html`<span class="count" title="Topics with something new">${unread.topicCount}</span>` : ""}</a>
  <a class="r-top" href="/forum?tab=bookmarks"${here(tab === "bookmarks")}>Bookmarks</a>
  <a class="r-top" href="/forum/messages"${here(tab === "messages")}>Messages to Zaisma${unread.messageCount ? html`<span class="count" title="Messages with a reply">${unread.messageCount}</span>` : ""}</a>`
    : ""}
  <a class="r-top" href="/forum?tab=known"${here(tab === "known" && !category && !query.section)}>Known issues</a>
  <p class="r-head">Categories</p>
  ${FORUM_SECTIONS.map(
    (section) => html`<div class="r-cat${openSection === section.id ? " open" : ""}"><a href="/forum?section=${section.id}"${here(!category && query.section === section.id)}>${section.name}</a>${openSection === section.id
      ? html`<div class="r-subs">${Object.entries(section.categories).map(([categoryId, name]) => html`<a href="/forum?category=${categoryId}"${here(category === categoryId)}>${name}</a>`)}</div>`
      : ""}</div>`,
  )}
  <p class="r-head">Tags</p>
  <div class="r-tags">${Object.entries(FORUM_TAGS).map(([tag, name]) => html`<a class="tag${query.tag === tag ? " on" : ""}" href="${link({ ...query, page_number: 1 }, { tag: query.tag === tag ? "" : tag })}">${name}</a>`)}</div>
  ${ctx.viewer ? "" : html`<p class="r-note">Anyone can read the forum. <a href="/signin?next=/forum">Sign in</a> to post, reply and vote.</p>`}
  <p class="r-note">Your AI reads and posts here too, through the Zaisma MCP. Its posts carry an ${ICONS.ai} AI mark.</p>
</nav>
</details>`;
}

function topicRow(topic: TopicRow, query: PageQuery): Raw {
  const place = placeOf(topic.category);
  const kindLabel = topic.is_known_issue ? "Known issue" : KINDS[topic.kind].label;
  const pill =
    topic.topic_status !== "new" && topic.topic_status !== "answered" ? statusPill(topic.topic_status, topic.is_public) : topic.topic_status === "new" && !topic.is_public ? statusPill(topic.topic_status, false) : "";
  const voteMeaning = topic.is_public ? voteOf(topic) : null;
  const voteCount = topic.is_known_issue ? (topic.affected_developer_count ?? 0) : topic.vote_count;
  return html`<li class="trow${topic.is_unread ? " unread" : ""}${topic.is_known_issue ? " known" : ""}">
  <span class="ticon k-${topic.is_known_issue ? "known" : topic.kind}" title="${kindLabel}">${kindIcon(topic)}<span class="sr">${kindLabel}</span></span>
  <div class="tmain">
    <p class="tline"><a class="ttitle" href="/forum/${topic.id}${topic.bookmarked_post_ids[0] ? `#p-${topic.bookmarked_post_ids[0]}` : ""}">${topic.title}</a>${topic.is_answered && !topic.is_known_issue ? html`<span class="flag ok" title="Answered">${ICONS.check}Answered</span>` : ""}${topic.is_public || query.tab === "messages" ? "" : html`<span class="flag" title="Only you and Zaisma can see it">${ICONS.lock}Message to Zaisma</span>`}${topic.is_public && !topic.is_shown ? html`<span class="flag warn">Being checked</span>` : ""}${pill}${topic.merged_into_topic_id ? html`<a class="flag" href="/forum/${topic.merged_into_topic_id}">Part of a known issue</a>` : ""}</p>
    ${topic.search_match ? html`<p class="tmatch">${raw(esc(topic.search_match).replace(/«/g, "<mark>").replace(/»/g, "</mark>"))}</p>` : ""}
    <p class="tmeta">${place ? html`<a class="cat" href="${link({}, { category: topic.category ?? "" })}">${place.sectionName} · ${place.categoryName}</a>` : ""}${topic.tags.map(tagChip)}<span class="by">${avatar(topic.author, "xs")}${topic.author.name}${topic.author.kind === "ai" ? html`<span class="mark ai">${ICONS.ai}AI</span>` : ""}${topic.author.kind === "zaisma" ? html`<span class="mark team">Team</span>` : ""}</span><span class="when">${ago(topic.created_at)}</span></p>
  </div>
  <div class="tpeople">${topic.recent_participants.slice(0, 3).map((person) => avatar(person, "sm"))}${topic.participant_count > 3 ? html`<span class="more" title="${topic.participant_count} people in it">+${topic.participant_count - 3 > 99 ? "99" : topic.participant_count - 3}</span>` : ""}</div>
  <div class="tstat" title="${topic.reply_count === 1 ? "1 reply" : `${topic.reply_count} replies`}">${ICONS.replies}<span>${topic.reply_count}</span></div>
  ${voteMeaning ? html`<div class="tstat${topic.has_voted ? " mine" : ""}" title="${voteCount} ${voteMeaning.countLabel(voteCount)}">${voteMeaning.icon}<span>${voteCount}</span></div>` : html`<div class="tstat none" aria-hidden="true"></div>`}
  <div class="tage">${ago(topic.last_activity_at)}</div>
</li>`;
}

async function similarFragment(ctx: Ctx, searchText: string): Promise<Response> {
  const found = await similarTopics(ctx.env, ctx.viewer, searchText);
  const body = found.length ? html`<p><strong>Already here?</strong> If one of these is the same, vote or reply there instead.</p><ol class="topics">${found.map((topic) => topicRow(topic, {}))}</ol>` : html``;
  return new Response(body.html, { headers: securityHeaders(ctx.env, { "Cache-Control": "no-store" }) });
}

// --- A topic ---

async function topicPage(ctx: Ctx, id: string, options: { done?: string; error?: string; textMarkdown?: string; replyToPostId?: string }, httpStatus = 200): Promise<Response> {
  const thread = await getTopic(ctx.env, ctx.viewer, id);
  const topic = thread.topic;
  const place = placeOf(topic.category);
  const first = thread.posts[0];
  const opening = topic.author.kind !== "zaisma" && first && !topic.is_known_issue ? first : null;
  const rest = opening ? thread.posts.slice(1) : thread.posts;
  const answer = thread.posts.find((post) => post.is_answer);
  // The reply most people liked, when at least two did and there's a choice (and it isn't the answer already).
  const best = rest.length > 1 ? rest.reduce<PostJson | null>((leader, post) => (post.like_count >= 2 && !post.is_answer && (!leader || post.like_count > leader.like_count) ? post : leader), null) : null;
  const mostLikedId = best?.id ?? "";
  const repliedTo = options.replyToPostId ? thread.posts.find((post) => post.id === options.replyToPostId) : undefined;
  const notice = options.error ? html`<p class="error" role="alert">${options.error}</p>` : options.done && DONE[options.done] ? html`<p class="done" role="status">${DONE[options.done]}</p>` : "";
  const replyCount = rest.filter((post) => post.kind !== "status" || post.text_markdown.length > 60).length;
  return forumPage(
    ctx,
    topic.title,
    html`<div class="topic">
<article class="t-main">
  <p class="crumbs"><a href="/forum">Forum</a>${!topic.is_public ? html`<span>/</span><a href="/forum/messages">Messages to Zaisma</a>` : place ? html`<span>/</span><a href="/forum?section=${place.section}">${place.sectionName}</a><span>/</span><a href="/forum?category=${topic.category}">${place.categoryName}</a>` : ""}</p>
  ${notice}
  ${topic.is_public && !topic.is_shown ? html`<p class="note warn-note">Others see this topic once its first post is checked${first?.check_status === "held" ? ": a person at Zaisma looks at it, usually within a day" : ", usually within minutes"}.</p>` : ""}
  ${opPost(ctx, topic, opening, answer)}
  ${rest.length
    ? html`<h2 class="replies-h">${replyCount === 1 ? "1 reply" : `${replyCount} replies`}</h2>
  <ol class="posts">${rest.map((post) => postItem(ctx, topic, post, thread.posts, false, post.id === mostLikedId))}</ol>`
    : html`<p class="no-replies muted">No replies yet.</p>`}
  ${composer(ctx, topic, options.textMarkdown ?? "", repliedTo)}
</article>
${sidePanel(ctx, topic, thread.posts)}
</div>`,
    { httpStatus },
  );
}

/** Where a known issue stands, in a sentence. */
const PHASE_WORDS: Partial<Record<TopicStatus, string>> = {
  investigating: "Zaisma is looking into this.",
  known: "Zaisma has confirmed this.",
  planned: "This is on Zaisma's roadmap.",
  fixing: "Zaisma is working on a fix.",
  released: "A fix is out, and Zaisma is watching that it holds. If it still happens to you, say so.",
  fixed: "This is fixed.",
  wont: "Zaisma won't fix this.",
};
const TRACK: TopicStatus[] = ["investigating", "known", "planned", "fixing", "released", "fixed"];

/** A known issue's phases as a track, the current one lit; won't fix stands alone. */
function phaseTrack(status: TopicStatus): Raw {
  if (status === "wont" || !TRACK.includes(status)) return html``;
  const currentIndex = TRACK.indexOf(status);
  return html`<ol class="phases" aria-label="Phase">${TRACK.map((phase, i) => html`<li class="${i < currentIndex ? "past" : i === currentIndex ? "now" : ""}"${i === currentIndex ? raw(' aria-current="step"') : ""}>${STATUS[phase].label}</li>`)}</ol>`;
}

/** A label for your own post others can't see yet. */
const waitingFlag = (post: PostJson | null | undefined) =>
  post?.check_status === "pending" ? html`<span class="flag warn">Being checked: only you see it yet</span>` : post?.check_status === "held" ? html`<span class="flag warn">Waiting for a person at Zaisma: only you see it yet</span>` : "";

/**
 * The opening post is the topic: its title, who started it and when, what it is, the post itself in
 * larger type, and the topic's actions. A known issue opens with Zaisma's summary instead.
 */
function opPost(ctx: Ctx, topic: TopicDetail, post: PostJson | null, answer: PostJson | undefined): Raw {
  const voteMeaning = voteOf(topic);
  const voteCount = topic.is_known_issue ? (topic.affected_developer_count ?? 0) : topic.vote_count;
  const developerCount = topic.affected_developer_count ?? 0;
  return html`<article class="op plate bevel-s"${post ? raw(` id="p-${post.id}"`) : ""} data-by="${topic.author.name}">
  <h1 class="t-title"><span class="ticon k-${topic.is_known_issue ? "known" : topic.kind}" title="${topic.is_known_issue ? "Known issue" : KINDS[topic.kind].label}">${kindIcon(topic)}</span>${topic.title}</h1>
  <p class="t-meta"><span class="kind">${topic.is_known_issue ? "Known issue" : KINDS[topic.kind].label}</span>${statusPill(topic.topic_status, topic.is_public)}${topic.tags.map(tagChip)}${topic.is_public ? "" : html`<span class="flag">${ICONS.lock}A message to Zaisma: only you and Zaisma see it</span>`}${topic.game_slug ? html`<span class="muted">About <a href="/dashboard/${topic.game_slug}">${topic.game_slug}</a>, which only you and Zaisma see</span>` : ""}</p>
  <div class="op-by">${avatar(topic.author, "md")}<div><p class="op-name">${nameOf(topic.author)}${waitingFlag(post)}</p><p class="muted">${topic.is_known_issue ? "Known issue" : topic.is_public ? "Started this" : "Sent this"} ${ago(topic.created_at)}</p></div>${post ? html`<span class="op-report">${reportLink(ctx, topic, post)}</span>` : ""}</div>
  ${topic.is_known_issue
    ? html`${phaseTrack(topic.topic_status)}<div class="op-text"><p>${PHASE_WORDS[topic.topic_status] ?? "Zaisma knows about this."} ${developerCount === 1 ? "1 developer has" : `${developerCount} developers have`} hit it${topic.roadmap_item ? html`; it's part of <strong>${topic.roadmap_item}</strong> on the roadmap` : ""}.</p>${topic.workaround && topic.topic_status !== "fixed" ? html`<p class="kb-work"><strong>Until it's fixed:</strong> ${topic.workaround}</p>` : ""}</div>`
    : post
      ? html`<div class="op-text p-text">${richText(ctx, post)}</div>
  ${mediaGrid(post)}
  ${attached(post)}`
      : ""}
  ${topic.merged_into_topic ? html`<div class="known-box"><p class="kb-head">${ICONS.known}<span>Part of the known issue <a href="/forum/${topic.merged_into_topic.id}"><strong>${topic.merged_into_topic.title}</strong></a>.</span></p>${topic.merged_into_topic.workaround ? html`<p class="kb-work"><strong>Until it's fixed:</strong> ${topic.merged_into_topic.workaround}</p>` : ""}</div>` : ""}
  ${answer ? html`<p class="jump">${ICONS.check}<a href="#p-${answer.id}">Answered by ${answer.author.name}${answer.author.kind === "ai" ? "'s AI" : ""}</a></p>` : ""}
  <div class="op-actions">
    <div class="reactions">
    ${post ? ratings(ctx, topic, post) : ""}
    ${voteMeaning && topic.can_vote
      ? html`<form method="post" action="/forum/${topic.id}/vote">${topic.has_voted ? html`<input type="hidden" name="undo" value="1">` : ""}<button class="btn${topic.has_voted ? " ghost" : " light"} vote" type="submit" aria-pressed="${topic.has_voted ? "true" : "false"}" title="${topic.has_voted ? "Press to take it back" : ""}">${voteMeaning.icon}<span>${topic.has_voted ? voteMeaning.done : voteMeaning.ask}</span></button></form>`
      : ""}
    ${voteMeaning && topic.is_public && topic.is_shown && voteCount > 0 ? html`<span class="op-count"><strong>${voteCount}</strong> ${voteMeaning.countLabel(voteCount)}</span>` : ""}
    ${post ? bookmarkButton(ctx, topic, post) : ""}
    </div>
    ${topic.is_known_issue && topic.topic_status === "released" && ctx.viewer
      ? html`<form method="post" action="/forum/${topic.id}/still-happening"><button class="btn ghost" type="submit" title="Puts it back to fixing and tells Zaisma">${ICONS.again}It still happens</button></form>`
      : ""}
    <span class="op-gap"></span>
    ${topic.can_reply && !(post && isWaiting(post)) ? html`<a class="btn ghost" href="#reply" data-reply-top>${ICONS.reply}Reply</a>` : ""}
    ${ctx.viewer
      ? html`<form method="post" action="/forum/${topic.id}/follow">${topic.is_following ? html`<input type="hidden" name="undo" value="1">` : ""}<button class="btn ghost" type="submit" title="${topic.is_following ? "New replies show in Your topics. Press to stop." : "Hear about new replies in Your topics."}">${topic.is_following ? "Following" : "Follow"}</button></form>`
      : ""}
  </div>
</article>`;
}

/** Like and Dislike on a public post, anonymous: both counts show, never who. Signed out they link to sign-in; on your own post they only count. */
function ratings(ctx: Ctx, topic: TopicDetail, post: PostJson): Raw {
  if (!topic.is_public || isWaiting(post) || isEvent(post)) return html``;
  const canRate = Boolean(ctx.viewer) && !post.author.is_you;
  const button = (rating: PostRating, icon: Raw, label: string, ratingCount: number) => {
    const body = html`${icon}<span class="sr">${label}</span><span class="n">${ratingCount}</span>`;
    if (canRate) {
      const isMine = post.your_rating === rating;
      return html`<form method="post" action="/forum/${topic.id}/rate" data-react><input type="hidden" name="post_id" value="${post.id}"><input type="hidden" name="rating" value="${rating}">${isMine ? html`<input type="hidden" name="undo" value="1">` : ""}<button type="submit" class="react${isMine ? " on" : ""}" aria-pressed="${isMine ? "true" : "false"}" title="${isMine ? `You ${rating}d this. Press to take it back.` : label}">${body}</button></form>`;
    }
    if (!ctx.viewer) return html`<a class="react" href="/signin?next=/forum/${topic.id}%23p-${post.id}" title="Sign in to ${label.toLowerCase()}">${body}</a>`;
    return html`<span class="react" title="${ratingCount} ${ratingCount === 1 ? "person" : "people"} ${rating}d this">${body}</span>`;
  };
  return html`${button("like", ICONS.helpful, "Like", post.like_count)}${button("dislike", ICONS.dislike, "Dislike", post.dislike_count)}`;
}

/** A private bookmark on any post you can see: it sends nothing, and shows under Bookmarks. */
function bookmarkButton(ctx: Ctx, topic: TopicDetail, post: PostJson): Raw {
  if (!ctx.viewer || isEvent(post)) return html``;
  return html`<form method="post" action="/forum/${topic.id}/bookmark" data-react><input type="hidden" name="post_id" value="${post.id}">${post.is_bookmarked ? html`<input type="hidden" name="undo" value="1">` : ""}<button type="submit" class="react${post.is_bookmarked ? " on" : ""}" aria-pressed="${post.is_bookmarked ? "true" : "false"}" aria-label="${post.is_bookmarked ? "Bookmarked" : "Bookmark"}" title="${post.is_bookmarked ? "Bookmarked, only you see it. Press to remove." : "Bookmark: only you and your AI see it"}">${ICONS.bookmark}</button></form>`;
}

/** Report a post, for anyone signed in who didn't write it. */
function reportLink(ctx: Ctx, topic: TopicDetail, post: PostJson): Raw {
  if (!ctx.viewer || !topic.is_public || post.author.is_you || post.author.kind === "zaisma" || isWaiting(post)) return html``;
  return post.has_reported ? html`<span class="muted reported">${ICONS.flag}Reported</span>` : html`<a class="report" href="/forum/${topic.id}/report?post_id=${post.id}" rel="nofollow">${ICONS.flag}Report</a>`;
}

function postItem(ctx: Ctx, topic: TopicDetail, post: PostJson, all: PostJson[], isOpening: boolean, isMostLiked = false): Raw {
  // A bare status change reads as a line in the thread; one with Zaisma's words is a post.
  if (isEvent(post)) {
    return html`<li class="event" id="p-${post.id}">${avatar(post.author, "xs")}<p>${post.text_markdown}</p>${ago(post.created_at)}</li>`;
  }
  const canMarkAnswer = topic.can_mark_answer && !isOpening && !isWaiting(post) && !post.author.is_you;
  const isByAuthor = post.author.kind !== "zaisma" && topic.author.kind !== "zaisma" && post.author.name === topic.author.name;
  return html`<li data-by="${post.author.name}" class="post${post.author.kind === "zaisma" ? " z" : ""}${post.is_answer ? " answer" : ""}${isOpening ? " opening" : ""}${isWaiting(post) ? " pending" : ""}" id="p-${post.id}">
  <div class="p-side">${avatar(post.author, "md")}</div>
  <div class="p-body">
    <header class="p-head">${nameOf(post.author)}${isByAuthor ? html`<span class="mark op-mark" title="Started this topic">Author</span>` : ""}${post.kind === "reopen" ? html`<span class="pill pending">Reopened</span>` : ""}${post.is_answer ? html`<span class="flag ok">${ICONS.check}Answer</span>` : ""}${isMostLiked ? html`<span class="flag">${ICONS.helpful}Most liked</span>` : ""}${waitingFlag(post)}<a class="p-when" href="#p-${post.id}">${ago(post.created_at)}</a></header>
    ${post.reply_to_post ? html`<a class="quote" href="#p-${post.reply_to_post.id}">${ICONS.reply}<span><strong>${post.reply_to_post.author_name}</strong> ${plain(post.reply_to_post.excerpt)}${post.reply_to_post.excerpt.length >= 140 ? "…" : ""}</span></a>` : ""}
    <div class="p-text">${richText(ctx, post)}</div>
    ${mediaGrid(post)}
    ${attached(post)}
    <div class="p-foot">
      ${topic.can_reply && !isWaiting(post) ? html`<a href="?reply_to_post_id=${post.id}#reply" data-reply="${post.id}" data-name="${post.author.name}" data-excerpt="${plain(post.text_markdown)}">${ICONS.reply}Reply</a><button type="button" data-quote-post="${post.id}">${ICONS.quote}Quote</button>` : ""}
      ${canMarkAnswer ? html`<form method="post" action="/forum/${topic.id}/answer"><input type="hidden" name="answer_post_id" value="${post.is_answer ? "" : post.id}"><button type="submit">${post.is_answer ? ICONS.cross : ICONS.check}${post.is_answer ? "Not the answer" : "Mark as the answer"}</button></form>` : ""}
      ${isOpening && all.length > 1 ? html`<span class="muted">${all.length === 2 ? "1 reply" : `${all.length - 1} replies`}</span>` : ""}
      ${ratings(ctx, topic, post)}${bookmarkButton(ctx, topic, post)}
      <span class="p-gap"></span>
      ${reportLink(ctx, topic, post)}
    </div>
  </div>
</li>`;
}

function composer(ctx: Ctx, topic: TopicDetail, textMarkdown: string, repliedTo: PostJson | undefined): Raw {
  if (!ctx.viewer || !ctx.me) return html`<div class="composer plate bevel-s signed-out" id="reply"><p>Sign in to reply, vote or follow this topic.</p><a class="btn light" href="/signin?next=/forum/${topic.id}">Sign in</a></div>`;
  return html`<form class="composer plate bevel-s" id="reply" method="post" action="/forum/${topic.id}/reply" enctype="multipart/form-data">
  <input type="hidden" name="reply_to_post_id" value="${repliedTo?.id ?? ""}">
  <p class="replying"${repliedTo ? "" : raw(" hidden")}>${ICONS.reply}<span>Replying to <strong data-to-name>${repliedTo?.author.name ?? ""}</strong>: <span data-to-excerpt>${repliedTo ? plain(repliedTo.text_markdown) : ""}</span></span><button type="button" class="x" data-unreply aria-label="Reply to the whole topic instead">×</button></p>
  <div class="c-row">${avatar(ctx.me, "md")}<label class="c-text editor"><span class="sr">Your reply</span>${editorBar()}<textarea data-editor name="text_markdown" required maxlength="${FORUM_LIMITS.textCharacterCount}" rows="4" data-mentions data-topic="${topic.is_public ? topic.id : ""}" placeholder="${topic.is_public ? "Write a reply. Markdown works; @ mentions someone; put code between ``` lines." : "Add what you found since, another case, or reply to Zaisma."}">${textMarkdown}</textarea></label></div>
  <div class="c-foot">
    ${topic.can_reopen ? html`<label class="check"><input type="checkbox" name="reopen" value="1"> It's back: reopen it</label>` : ""}
    <button class="btn light" type="submit">Post reply</button>
  </div>
</form>`;
}

function sidePanel(ctx: Ctx, topic: TopicDetail, posts: PostJson[]): Raw {
  const place = placeOf(topic.category);
  const seen = new Set<string>();
  const people = posts.map((post) => post.author).filter((person) => (seen.has(`${person.name}:${person.kind}`) ? false : (seen.add(`${person.name}:${person.kind}`), true)));
  return html`<aside class="t-side">
  <dl class="facts plate bevel-s">
    <dt>Status</dt><dd>${topic.topic_status === "new" ? (topic.is_public ? "Open" : "Waiting for Zaisma") : STATUS[topic.topic_status].label}</dd>
    ${place
      ? html`<dt>Category</dt><dd><a href="/forum?section=${place.section}">${place.sectionName}</a> · <a href="/forum?category=${topic.category}">${place.categoryName}</a>${topic.can_flag_misplaced
          ? topic.has_flagged_misplaced
            ? html`<p class="hint flagged">You flagged it as in the wrong category. Zaisma's AI moves it if it is.</p>`
            : html`<form method="post" action="/forum/${topic.id}/misplaced"><button class="link-btn" type="submit">Wrong category?</button></form>`
          : ""}</dd>`
      : ""}
    ${topic.tags.length ? html`<dt>Tags</dt><dd class="tags">${topic.tags.map(tagChip)}</dd>` : ""}
    ${people.length > 1 ? html`<dt>In this topic</dt><dd class="people">${people.slice(0, 8).map((person) => html`<span class="person">${avatar(person, "sm")}${nameOf(person)}</span>`)}${people.length > 8 ? html`<span class="muted">and ${people.length - 8} more</span>` : ""}</dd>` : ""}
    <dt>Who can see it</dt><dd>${topic.is_public ? "Every developer and their AI" : "Only you and Zaisma"}</dd>
  </dl>
  ${topic.is_known_issue && ctx.viewer
    ? html`<div class="side plate bevel-s"><p>${topic.your_message_topic_id ? html`You've messaged Zaisma about this. <a href="/forum/${topic.your_message_topic_id}">Open your message</a>` : html`Have logs, a screenshot or a game to point at? <a href="/forum/messages/new?known_issue_topic_id=${topic.id}&kind=${topic.kind}">Message Zaisma about your case</a>: only Zaisma sees it, and it counts here.`}</p></div>`
    : ""}
</aside>`;
}

// --- Leaving Zaisma ---

/** A link out of Zaisma says where it goes first; a viewer can trust a site in their browser. */
function outPage(ctx: Ctx, to: string): Response {
  let destination: URL | null = null;
  try {
    destination = new URL(to);
  } catch {}
  if (!destination || (destination.protocol !== "https:" && destination.protocol !== "http:")) {
    return forumPage(ctx, "Not a link", html`<div class="gone"><h1>That isn't a link we can open</h1><a class="btn ghost" href="/forum">Back to the forum</a></div>`, { httpStatus: 400 });
  }
  return forumPage(
    ctx,
    "Leaving Zaisma",
    html`<div class="leaving plate bevel-s">
  <h1>You're leaving Zaisma</h1>
  <p class="lead">This link goes to <strong>${destination.hostname}</strong>, a site Zaisma doesn't run.</p>
  <p class="out-url">${destination.href}</p>
  <label class="check"><input type="checkbox" id="trust" data-host="${destination.hostname}"> Open links to ${destination.hostname} straight away from now on, in this browser</label>
  <div class="row"><a class="btn light" id="go" href="${destination.href}" rel="noopener noreferrer nofollow">Continue to ${destination.hostname}</a><a class="btn ghost" href="/forum" data-go-back>Go back</a></div>
</div>`,
  );
}

// --- Reporting a post ---

async function reportPage(ctx: Ctx, topicId: string, postId: string): Promise<Response> {
  const thread = await getTopic(ctx.env, ctx.viewer, topicId);
  const post = thread.posts.find((candidate) => candidate.id === postId);
  if (!post || post.author.kind === "zaisma" || post.author.is_you) throw new ApiError("no_post", { message: "There's no post here you can report.", field: "post_id", fix: "Open the topic again and report a post someone else wrote." });
  return forumPage(
    ctx,
    "Report a post",
    html`<div class="newtopic">
<form class="np plate bevel-s" method="post" action="/forum/${topicId}/report">
  <h1>Report a post</h1>
  <input type="hidden" name="post_id" value="${post.id}">
  <blockquote class="quote">${avatar(post.author, "xs")}<span><strong>${post.author.name}</strong> ${plain(post.text_markdown, 300)}</span></blockquote>
  <fieldset class="seen"><legend>What's wrong with it?</legend>
    ${Object.entries(FORUM_REPORT_REASONS).map(([reason, label]) => html`<label class="check"><input type="radio" name="reason" value="${reason}" required><span><strong>${label}</strong>${reason === "child_safety" ? html`<small>It's hidden straight away while a person looks.</small>` : ""}</span></label>`)}
  </fieldset>
  <label>Anything else Zaisma should know (optional) <textarea name="details" maxlength="1000" rows="3"></textarea></label>
  <div class="np-foot"><button class="btn light" type="submit">Send report</button><a class="btn ghost" href="/forum/${topicId}#p-${post.id}">Cancel</a></div>
</form>
<aside class="np-side"><div class="side plate bevel-s"><h2>What happens</h2><p>A person at Zaisma looks at it. Whoever wrote it isn't told who reported it. Posts that put a young person at risk are hidden straight away, and any post three developers report is hidden until Zaisma looks.</p><p>If it's just wrong, a reply that says why helps everyone more.</p></div></aside>
</div>`,
  );
}

// --- A new topic ---

async function newPage(ctx: Ctx, given: Record<string, string>, isMessage: boolean, error = "", httpStatus = 200, tags: string[] = []): Promise<Response> {
  const { games } = (await apiCall(ctx.env, ctx.viewer!, "GET", "/games")) as { games: { slug: string; title: string }[] };
  const kinds = isMessage ? TOPIC_KINDS.filter((kind) => kind !== "talk") : TOPIC_KINDS;
  const kind = (kinds as readonly string[]).includes(given.kind ?? "") ? (given.kind as TopicKind) : isMessage ? "bug" : "question";
  const known = given.known_issue_topic_id ? await getTopic(ctx.env, ctx.viewer, given.known_issue_topic_id).catch(() => null) : null;
  const sectionCategories = given.section ? Object.keys(FORUM_SECTIONS.find((section) => section.id === given.section)?.categories ?? {}) : [];
  const category = (given.category && (FORUM_CATEGORIES as string[]).includes(given.category) ? given.category : sectionCategories[0]) || known?.topic.category || "";
  return forumPage(
    ctx,
    isMessage ? "Message Zaisma" : "New topic",
    html`<div class="newtopic">
<form class="np plate bevel-s" method="post" action="${isMessage ? "/forum/messages/new" : "/forum/new"}" enctype="multipart/form-data">
  <h1>${isMessage ? "Message Zaisma" : "New topic"}</h1>
  ${isMessage && !known ? html`<p class="note">Only you and the people who build Zaisma see this: share logs, an unreleased game, anything private. If others hit the same problem, Zaisma posts a public known issue without your words.</p>` : ""}
  ${error ? html`<p class="error" role="alert">${error}</p>` : ""}
  ${known
    ? html`<input type="hidden" name="known_issue_topic_id" value="${known.topic.id}"><input type="hidden" name="kind" value="${kind}"><p class="note">About the known issue <a href="/forum/${known.topic.id}"><strong>${known.topic.title}</strong></a>. Only you and Zaisma see what you write here; it counts toward the developers affected, and you hear when it's fixed.</p>`
    : html`<fieldset class="kinds"><legend>What is it?</legend>${kinds.map(
        (option) => html`<label class="kind-opt"><input type="radio" name="kind" value="${option}"${option === kind ? raw(" checked") : ""}><span class="ticon k-${option}">${ICONS[option]}</span><span><strong>${KINDS[option].label}</strong><small>${KINDS[option].hint}</small></span></label>`,
      )}</fieldset>`}
  <label>Title <input name="title" required maxlength="${FORUM_LIMITS.titleCharacterCount}" value="${given.title ?? known?.topic.title ?? ""}" placeholder="Upload stops at 99% for a 300 MB build" autocomplete="off"></label>
  <div id="similar" class="similar" aria-live="polite"></div>
  <label class="editor">What happened, or what you'd like ${editorBar()}<textarea data-editor name="text_markdown" required maxlength="${FORUM_LIMITS.textCharacterCount}" rows="9"${isMessage ? "" : raw(" data-mentions")} placeholder="What you did, what you expected and what happened instead. Markdown works: **bold**, lists, links, and code and errors between \`\`\` lines.">${given.text_markdown ?? ""}</textarea></label>
  <div class="np-row">
    <label>Category${isMessage ? " (optional)" : ""} <select name="category"${isMessage ? "" : raw(" required")}><option value=""${category ? "" : raw(" selected")}${isMessage ? "" : raw(" disabled")}>${isMessage ? "Not sure" : "Pick where it belongs"}</option>${FORUM_SECTIONS.map(
      (section) => html`<optgroup label="${section.name}">${Object.entries(section.categories).map(([categoryId, name]) => html`<option value="${categoryId}"${categoryId === category ? raw(" selected") : ""}>${name}</option>`)}</optgroup>`,
    )}</select></label>
    ${games.length ? html`<label>Which game (optional) <select name="game_slug"><option value="">None</option>${games.map((game) => html`<option value="${game.slug}"${game.slug === given.game_slug ? raw(" selected") : ""}>${game.title}</option>`)}</select><small class="hint">Only you and Zaisma see which game.</small></label>` : ""}
  </div>
  ${known || isMessage
    ? ""
    : html`<fieldset class="np-tags"><legend>Tags (up to ${FORUM_LIMITS.tagCountPerTopic})</legend><div class="r-tags">${Object.entries(FORUM_TAGS).map(
        ([tag, name]) => html`<label class="tag pick"><input type="checkbox" name="tags" value="${tag}"${tags.includes(tag) ? raw(" checked") : ""}><span>${name}</span></label>`,
      )}</div></fieldset>`}
  <div class="np-foot"><button class="btn light" type="submit">${isMessage ? "Send to Zaisma" : "Post topic"}</button><span class="hint">Keys and passwords are blanked before anything is saved.</span></div>
</form>
<aside class="np-side">
  ${isMessage
    ? html`<div class="side plate bevel-s"><h2>Private</h2><p>Messages are only between you and Zaisma. To ask other developers too, <a href="/forum/new">start a public topic</a> instead.</p></div>`
    : html`<div class="side plate bevel-s"><h2>Before you post</h2><p>Search first: if someone has posted it, vote there. It counts, and you hear when it changes.</p><p>For logs, an unreleased game or anything private, <a href="/forum/messages/new">message Zaisma</a> instead.</p></div>`}
  <div class="side plate bevel-s"><h2>From your AI</h2><p>With the Zaisma MCP, your AI searches the forum, posts what it hits with the exact error, and replies. Its posts show your name with an ${ICONS.ai} AI mark.</p></div>
</aside>
</div>`,
    { httpStatus },
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
.who strong a{color:inherit;text-decoration:none}
.who strong a:hover{text-decoration:underline;text-underline-offset:3px}
.you{color:var(--muted);font-size:12px}

/* The AI mark on an account's picture (.av, in the site's styles). */
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
.reactions{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px}
.reactions form{display:contents}
.react{display:inline-flex;align-items:center;gap:5px;min-height:32px;padding:0;border:0;background:none;color:var(--muted);font:inherit;font-family:var(--display);font-weight:500;text-decoration:none;cursor:pointer}
span.react{cursor:default}
.react:hover{color:var(--text)}
.react svg{width:17px;height:17px}
.react.on{color:var(--text)}
.react.on svg{fill:currentColor;fill-opacity:.25}
.react .n{font-weight:600;color:var(--text-2)}
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
.p-text{color:var(--text-2);overflow-wrap:anywhere;line-height:1.6;min-width:0}
/* Grid items don't shrink below their content by default: a long line of code would widen the post. */
.p-body>*,.op>*,.np>*{min-width:0}
.p-text>:first-child{margin-top:0}
.p-text>:last-child{margin-bottom:0}
.p-text p{margin:0 0 10px}
.p-text ul,.p-text ol{margin:0 0 10px;padding-left:22px}
.p-text li{margin:2px 0}
.p-text .md-h{font-size:17px;margin:14px 0 6px;text-shadow:none}
.p-text h4.md-h{font-size:15px}
.p-text blockquote{margin:0 0 10px;padding:6px 12px;color:var(--muted);box-shadow:inset 3px 0 0 var(--line-2);background:rgba(0,0,0,.15)}
.p-text hr{border:0;height:2px;margin:14px 0;background:linear-gradient(#000,#000) top/100% 1px no-repeat,linear-gradient(rgba(255,255,255,.06),rgba(255,255,255,.06)) bottom/100% 1px no-repeat}
.p-text del{color:var(--muted)}
.p-text a.out::after{content:"↗";margin-left:2px;font-size:.8em;color:var(--muted)}
.editor{display:grid !important;gap:0 !important;position:relative}
.ed-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:4px 12px;padding:4px 6px;background:#14161a;box-shadow:inset 0 1px 0 rgba(255,255,255,.05)}
.ed-bar button{min-height:28px;padding:0 9px;border:0;background:none;color:var(--muted);font:inherit;font-family:var(--display);font-size:13px;cursor:pointer}
.ed-bar button:hover{color:var(--text)}
.ed-tabs button[aria-pressed=true]{color:var(--text);box-shadow:inset 0 -2px 0 #dfe2e6}
.ed-tools{display:flex;flex-wrap:wrap;align-items:center;gap:2px}
.ed-format{display:flex;flex-wrap:wrap}
.ed-bar svg{width:15px;height:15px;vertical-align:-3px}
.ed-insert{display:inline-flex;align-items:center;gap:5px;margin-right:6px;color:var(--text-2) !important;box-shadow:inset 0 0 0 1px #3a3e46}
.ed-insert:hover{box-shadow:inset 0 0 0 1px #6a6f78}
.editor.previewing .ed-tools{visibility:hidden}
.ed-error{margin:6px 0 0;font-size:13px}
.ed-bar [data-md=bullets],.ed-bar [data-md=dashes],.ed-float [data-md=bullets],.ed-float [data-md=dashes]{font-size:17px}
.p-text .p-img{display:inline-block;max-width:100%;vertical-align:top;margin:4px 0}
.p-text .p-img img{display:block;max-width:100%;max-height:520px;background:var(--pic)}
.p-text ul.dashes{list-style:none;padding-left:18px}
.p-text ul.dashes li::before{content:"–";display:inline-block;width:16px;margin-left:-16px;color:var(--muted)}
.ed-pop{position:fixed;z-index:60;background:var(--brush) 0 0/320px 320px,var(--face-hi);box-shadow:var(--rim),0 14px 32px rgba(0,0,0,.55)}
.ed-pop[hidden]{display:none}
.ed-menu{display:grid;min-width:200px;padding:4px}
.ed-menu button,.ed-float button{display:flex;align-items:center;gap:10px;min-height:34px;padding:0 10px;border:0;background:none;color:var(--text-2);font:inherit;font-size:14px;cursor:pointer;text-align:left}
.ed-menu button:hover,.ed-menu button:focus-visible,.ed-float button:hover{color:var(--text);background:rgba(255,255,255,.07)}
.ed-menu svg{width:16px;height:16px;flex:none}
.ed-menu small{margin-left:auto;color:var(--muted);font-size:12px}
.ed-float{display:flex;padding:2px}
.ed-float button{min-height:30px;padding:0 8px;font-family:var(--display);font-size:13px}
.ed-float svg{width:15px;height:15px}
.ed-panel{display:grid;gap:10px;width:min(360px,calc(100vw - 32px));padding:14px}
.ed-panel label{display:grid;gap:4px;font-size:13px;color:var(--muted)}
.ed-panel input{min-height:38px}
.ed-panel .row{gap:8px}
.ed-panel .btn{min-height:36px;padding:0 14px;font-size:14px}
.ed-panel .hint{margin:0}
/* The box grows with what's written, up to most of the screen, then scrolls: no handle to drag it out of shape. */
textarea[data-editor]{resize:none;overflow-y:hidden;max-height:min(60vh,640px)}
textarea[data-editor].full{overflow-y:auto}
textarea[data-editor].over{box-shadow:inset 0 2px 5px rgba(0,0,0,.65),0 0 0 2px rgba(230,233,238,.55)}
.ed-preview{min-height:110px;padding:12px;background:#0d0f12;box-shadow:inset 0 2px 5px rgba(0,0,0,.65)}
.ed-preview[hidden]{display:none}
.quote-pop{position:fixed;z-index:50;display:inline-flex;align-items:center;gap:6px;min-height:34px;padding:0 12px;border:0;cursor:pointer;color:#0b0b0c;background:var(--chrome);font-family:var(--display);font-weight:600;font-size:13px;box-shadow:0 6px 18px rgba(0,0,0,.5)}
.quote-pop svg{width:14px;height:14px}
.quote-pop[hidden]{display:none}
.mention{font-family:var(--display);font-weight:600;color:var(--text);padding:0 4px;background:rgba(160,190,255,.12);box-shadow:inset 0 0 0 1px rgba(160,190,255,.25)}
figure.code{margin:8px 0 12px;background:#0d0f12;box-shadow:inset 0 2px 5px rgba(0,0,0,.65),0 1px 0 rgba(255,255,255,.06)}
figure.code figcaption{display:flex;align-items:center;gap:12px;padding:6px 10px;font-family:var(--display);font-size:12px;color:var(--muted);background:linear-gradient(#000,#000) bottom/100% 1px no-repeat}
figure.code figcaption span{flex:1}
figure.code figcaption button{border:0;padding:0;background:none;color:var(--muted);font:inherit;cursor:pointer}
figure.code figcaption button:hover,figure.code figcaption button[aria-pressed=true]{color:var(--text)}
figure.code pre{margin:0;padding:10px 12px;background:none;box-shadow:none;white-space:pre;overflow:auto;max-height:460px;font-size:13px}
figure.code.wrap pre{white-space:pre-wrap;word-break:break-word}
.video{margin:8px 0 12px;display:grid;gap:6px;justify-items:start}
.video iframe{width:min(100%,640px);aspect-ratio:16/9;border:0;display:block;background:#000;box-shadow:0 0 0 1px #000,var(--drop)}
.video>a{font-size:13px;color:var(--muted)}
.p-media{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;max-width:640px}
.p-media.one{grid-template-columns:minmax(0,480px)}
.p-media a{display:block;background:var(--pic)}
.p-media img{width:100%;height:100%;max-height:360px;object-fit:cover;display:block}
.p-media.one img{object-fit:contain;height:auto}

.mention-list{position:fixed;z-index:50;list-style:none;margin:4px 0 0;padding:4px;min-width:220px;background:var(--brush) 0 0/320px 320px,var(--face-hi);box-shadow:var(--rim),var(--drop)}
.mention-list li{display:flex;align-items:center;gap:8px;padding:6px 8px;cursor:pointer;font-size:14px}
.mention-list li small{margin-left:auto;color:var(--muted);font-size:11px}
.mention-list li[aria-selected=true],.mention-list li:hover{background:rgba(255,255,255,.07)}
.c-text,.np label:has(textarea[data-mentions]){position:relative}
.leaving{max-width:620px;padding:26px 28px;display:grid;gap:14px}
.leaving h1{font-size:28px;margin:0}
.leaving .lead{margin:0}
.out-url{margin:0;padding:10px 12px;font-size:13px;color:var(--text-2);word-break:break-all;background:#0d0f12;box-shadow:inset 0 2px 5px rgba(0,0,0,.65)}
.p-text a{color:var(--text)}
.p-text code{font-size:13px;padding:1px 5px;background:#0d0f12;box-shadow:inset 0 1px 2px rgba(0,0,0,.7)}
.p-text pre{margin:8px 0;white-space:pre;overflow:auto;max-height:420px}
.p-text pre code{padding:0;background:none;box-shadow:none}
.quote{display:flex;gap:8px;align-items:flex-start;padding:8px 10px;font-size:13px;color:var(--muted);text-decoration:none;background:rgba(0,0,0,.22);box-shadow:inset 2px 0 0 var(--line-2)}
.quote:hover{color:var(--text-2)}
.quote svg{width:14px;height:14px;flex:none;margin-top:2px}
.quote span{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.quote strong{color:var(--text-2)}
.p-att pre{margin:6px 0 0;max-height:300px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}
.p-att dl{margin:4px 0 0}
.p-att dt{margin-top:10px;font-size:12px;color:var(--muted)}
.p-att dd{margin:0}
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
.replying>span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.composer>*{min-width:0}
.replying strong{color:var(--text-2)}
.x{border:0;background:none;color:var(--muted);font-size:18px;line-height:1;cursor:pointer;padding:0 4px}
.x:hover{color:var(--text)}
.c-row{display:grid;grid-template-columns:40px minmax(0,1fr);gap:14px}
.c-text textarea{width:100%;min-height:110px}
.c-foot{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;padding-left:54px}
.c-foot .btn{margin-left:auto}

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

// Posts: images to add (choose, drop, paste), Copy and Wrap on code, links out that say where they go (unless the site is trusted in this
// browser), and @ suggestions while writing.
const POSTS_SCRIPT = pageScript("forum-posts", String.raw`(()=>{
const TRUST="zaisma-trusted-sites",trusted=()=>{try{return JSON.parse(localStorage.getItem(TRUST)||"[]")}catch{return[]}};
document.addEventListener("click",e=>{
const out=e.target.closest("a.out");if(out&&!e.metaKey&&!e.ctrlKey&&trusted().includes(out.dataset.host)){e.preventDefault();window.open(out.dataset.out,"_blank","noopener,noreferrer");return}
const copy=e.target.closest("figure.code [data-copy]");if(copy){const code=copy.closest("figure").querySelector("code").textContent;navigator.clipboard.writeText(code).then(()=>{copy.textContent="Copied";setTimeout(()=>copy.textContent="Copy",1600)}).catch(()=>{});return}
const wrap=e.target.closest("figure.code [data-wrap]");if(wrap){const f=wrap.closest("figure"),on=f.classList.toggle("wrap");wrap.setAttribute("aria-pressed",on?"true":"false");return}
});
const go=document.getElementById("go"),trust=document.getElementById("trust");if(go&&trust)go.addEventListener("click",()=>{if(trust.checked){const t=trusted();if(!t.includes(trust.dataset.host))t.push(trust.dataset.host);try{localStorage.setItem(TRUST,JSON.stringify(t))}catch{}}});
// Go back on the leaving page: back where they came from, or to the forum when there's nowhere to go back to.
const back=document.querySelector("a[data-go-back]");if(back)back.addEventListener("click",e=>{if(history.length>1){e.preventDefault();history.back()}});
// The editor: Write and Preview, Insert (images uploaded as you go and placed at the cursor, a link,
// a video, a code block), formatting in the bar and over a selection, and a link panel to add or
// edit a link. Images can also be dropped or pasted into the text.
const wrapSel=(ta,before,after,ph)=>{const a=ta.selectionStart,b=ta.selectionEnd,sel=ta.value.slice(a,b)||ph;ta.setRangeText(before+sel+after,a,b,"select");ta.setSelectionRange(a+before.length,a+before.length+sel.length);ta.focus();ta.dispatchEvent(new Event("input"))};
const lines=(ta,prefix,test)=>{const v=ta.value,a=v.lastIndexOf("\n",ta.selectionStart-1)+1,e=v.indexOf("\n",Math.max(ta.selectionEnd-1,a)),b=e<0?v.length:e,block=v.slice(a,b).split("\n"),on=block.every(l=>test.test(l));const out=block.map((l,i)=>on?l.replace(test,""):(typeof prefix==="function"?prefix(i):prefix)+l.replace(/^\s*([*+-]|\d{1,3}[.)]|>|#{1,3})\s+/,"")).join("\n");ta.setRangeText(out,a,b,"select");ta.focus();ta.dispatchEvent(new Event("input"))};
const insertAt=(ta,text,own)=>{const a=ta.selectionStart,b=ta.selectionEnd,pre=ta.value.slice(0,a),lead=own&&pre&&!pre.endsWith("\n")?"\n":"",trail=own?"\n":"";ta.setRangeText(lead+text+trail,a,b,"end");ta.focus();ta.dispatchEvent(new Event("input"))};
const pop=cls=>{const d=document.createElement("div");d.className="ed-pop "+cls;d.hidden=true;document.body.append(d);return d};
const near=(el,x,y)=>{el.hidden=false;const w=el.offsetWidth,h=el.offsetHeight;el.style.left=Math.max(8,Math.min(x,innerWidth-w-8))+"px";el.style.top=(y+h+8>innerHeight?Math.max(8,y-h-36):y)+"px"};
const caretXY=(ta,pos)=>{const cs=getComputedStyle(ta),d=document.createElement("div");for(const k of ["boxSizing","width","fontFamily","fontSize","fontWeight","lineHeight","letterSpacing","paddingTop","paddingRight","paddingBottom","paddingLeft","borderTopWidth","borderRightWidth","borderBottomWidth","borderLeftWidth","tabSize"])d.style[k]=cs[k];Object.assign(d.style,{position:"absolute",visibility:"hidden",whiteSpace:"pre-wrap",overflowWrap:"break-word",top:"0",left:"0"});d.textContent=ta.value.slice(0,pos);const m=document.createElement("span");m.textContent="​";d.append(m);document.body.append(d);const r=ta.getBoundingClientRect(),out={x:r.left+m.offsetLeft-ta.scrollLeft,y:r.top+m.offsetTop-ta.scrollTop,h:parseFloat(cs.lineHeight)||22};d.remove();return out};
const menu=pop("ed-menu"),float=pop("ed-float"),panel=pop("ed-panel");menu.setAttribute("role","menu");
menu.innerHTML='<button type="button" role="menuitem" data-insert="image"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2.6" y="3.6" width="14.8" height="12.8"/><circle cx="7" cy="8" r="1.5"/><path d="M17.4 13.2l-4.2-4.2-7.6 7.4"/></svg>Images<small>or drop, paste</small></button><button type="button" role="menuitem" data-insert="link"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M8.5 11.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M11.5 8.5a3.5 3.5 0 0 0-5 0L4 11a3.5 3.5 0 0 0 5 5l1-1"/></svg>Link<small>⌘K</small></button><button type="button" role="menuitem" data-insert="video"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2.5" y="4.5" width="15" height="11"/><path d="M8.5 7.8v4.4l3.6-2.2z" fill="currentColor"/></svg>Video<small>YouTube, Vimeo, Streamable</small></button><button type="button" role="menuitem" data-insert="code"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 6l-4 4 4 4M13 6l4 4-4 4"/></svg>Code block</button>';
let active=null,menuFor=null;
const MAX=+(document.body.dataset.mediaMax||10),BYTES=+(document.body.dataset.mediaBytes||5242880);
const err=(ta,msg)=>{const e=ta.closest(".editor").parentElement.querySelector(".ed-error")||ta.closest(".editor").querySelector(".ed-error");if(!e)return;e.textContent=msg;e.hidden=!msg};
const upload=(ta,file)=>{if(!/^image\/(png|jpeg|webp|gif)$/.test(file.type)){err(ta,file.name+" isn't a PNG, JPEG, WebP or GIF.");return}if(file.size>BYTES){err(ta,file.name+" is over "+Math.round(BYTES/1048576)+" MB.");return}if((ta.value.match(/\(\/forum\/media\/media_[a-z0-9]+\)/g)||[]).length>=MAX){err(ta,"A post can carry up to "+MAX+" images.");return}err(ta,"");
const tag="![Uploading "+file.name.replace(/[\[\]\n]/g,"")+"…]()";insertAt(ta,tag,true);const fd=new FormData();fd.set("file",file);
fetch("/forum/media",{method:"POST",body:fd}).then(r=>r.json().then(j=>({ok:r.ok,j}))).then(({ok,j})=>{const at=ta.value.indexOf(tag);if(at<0)return;if(ok){ta.setRangeText(j.image_markdown,at,at+tag.length,"preserve")}else{ta.setRangeText("",at,at+tag.length,"preserve");err(ta,j.error||"That image didn't upload.")}ta.dispatchEvent(new Event("input"))}).catch(()=>{const at=ta.value.indexOf(tag);if(at>=0)ta.setRangeText("",at,at+tag.length,"preserve");err(ta,"That image didn't upload. Try again.")})};
// The link panel: add a link, or edit or remove the one the cursor is in. Video: a link on its own line.
const linkAt=ta=>{const re=/\[([^\]\n]*)\]\(([^)\s]*)\)/g;let m;while((m=re.exec(ta.value))){const a=m.index,b=a+m[0].length;if(ta.selectionStart>=a&&ta.selectionEnd<=b&&ta.value[a-1]!=="!")return{a,b,text:m[1],url:m[2]}}return null};
const openPanel=(ta,kind)=>{active=ta;const found=kind==="link"?linkAt(ta):null,sel=ta.value.slice(ta.selectionStart,ta.selectionEnd);
panel.innerHTML=kind==="video"?'<label>Video link<input name="u" type="url" placeholder="https://www.youtube.com/watch?v=…"></label><p class="hint">YouTube, Vimeo or Streamable. It plays in the post.</p><div class="row"><button type="button" class="btn light" data-apply>Add video</button><button type="button" class="btn ghost" data-cancel>Cancel</button></div>':'<label>Text<input name="t" placeholder="What the link says"></label><label>Link<input name="u" type="url" placeholder="https://"></label><div class="row"><button type="button" class="btn light" data-apply>'+(found?"Save link":"Add link")+'</button>'+(found?'<button type="button" class="btn ghost" data-remove>Remove link</button>':'')+'<button type="button" class="btn ghost" data-cancel>Cancel</button></div>';
const t=panel.querySelector("[name=t]"),u=panel.querySelector("[name=u]");if(t)t.value=found?found.text:sel;if(found)u.value=found.url;
const c=caretXY(ta,ta.selectionStart);near(panel,c.x,c.y+c.h+6);(t&&!t.value?t:u).focus();
panel.onkeydown=e=>{if(e.key==="Escape"){panel.hidden=true;ta.focus()}if(e.key==="Enter"){e.preventDefault();panel.querySelector("[data-apply]").click()}};
panel.onclick=e=>{const b=e.target.closest("button");if(!b)return;if(b.dataset.cancel!==undefined){panel.hidden=true;ta.focus();return}
if(b.dataset.remove!==undefined&&found){ta.setRangeText(found.text,found.a,found.b,"end");panel.hidden=true;ta.focus();ta.dispatchEvent(new Event("input"));return}
let url=u.value.trim();if(!url){u.focus();return}if(!/^(https?:\/\/|\/)/.test(url))url="https://"+url;
if(kind==="video"){insertAt(ta,url,true)}else{const text=(t.value.trim()||url).replace(/[\[\]]/g,"");const md="["+text+"]("+url+")";if(found)ta.setRangeText(md,found.a,found.b,"end");else ta.setRangeText(md,ta.selectionStart,ta.selectionEnd,"end");ta.focus();ta.dispatchEvent(new Event("input"))}panel.hidden=true}};
const run=(ta,cmd)=>{active=ta;if(cmd==="bold")wrapSel(ta,"**","**","bold");else if(cmd==="italic")wrapSel(ta,"*","*","italic");else if(cmd==="strike")wrapSel(ta,"~~","~~","text");
else if(cmd==="code"){const sel=ta.value.slice(ta.selectionStart,ta.selectionEnd);sel.includes("\n")?wrapSel(ta,"\n\x60\x60\x60\n","\n\x60\x60\x60\n","code"):wrapSel(ta,"\x60","\x60","code")}
else if(cmd==="link")openPanel(ta,"link");else if(cmd==="heading")lines(ta,"# ",/^#{1,3}\s+/);else if(cmd==="bullets")lines(ta,"* ",/^\s*[*+]\s+/);else if(cmd==="dashes")lines(ta,"- ",/^\s*-\s+/);
else if(cmd==="numbers")lines(ta,i=>(i+1)+". ",/^\s*\d{1,3}[.)]\s+/);else if(cmd==="quote")lines(ta,"> ",/^>\s?/);float.hidden=true};
document.querySelectorAll("textarea[data-editor]").forEach(ta=>{
const min=ta.offsetHeight||110,grow=()=>{if(ta.hidden)return;ta.style.height="auto";const max=parseFloat(getComputedStyle(ta).maxHeight)||640,h=Math.max(min,ta.scrollHeight+2);ta.style.height=Math.min(h,max)+"px";ta.classList.toggle("full",h>max)};
ta.addEventListener("input",grow);addEventListener("resize",grow);grow();
const ed=ta.closest(".editor"),bar=ed.querySelector(".ed-bar"),file=bar.querySelector("[data-upload]"),pv=document.createElement("div");pv.className="ed-preview p-text";pv.hidden=true;ta.after(pv);
if(!float.childElementCount)float.innerHTML=bar.querySelector(".ed-format").innerHTML;
bar.addEventListener("mousedown",e=>{if(e.target.closest("[data-md]"))e.preventDefault()});
bar.addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;e.preventDefault();
if(b.dataset.md)run(ta,b.dataset.md);
if(b.hasAttribute("data-insert-menu")){if(!menu.hidden&&menuFor===ta){menu.hidden=true;b.setAttribute("aria-expanded","false");return}menuFor=ta;active=ta;const r=b.getBoundingClientRect();near(menu,r.left,r.bottom+4);b.setAttribute("aria-expanded","true");menu.querySelector("button").focus()}
if(b.dataset.tab){const show=b.dataset.tab==="preview";bar.querySelectorAll("[data-tab]").forEach(x=>x.setAttribute("aria-pressed",x===b?"true":"false"));ed.classList.toggle("previewing",show);ta.hidden=show;pv.hidden=!show;
if(!show)setTimeout(grow,0);if(show){pv.innerHTML='<p class="muted">Loading the preview…</p>';const fd=new FormData();fd.set("text_markdown",ta.value);fetch("/forum/preview",{method:"POST",body:fd}).then(r=>r.text()).then(h=>pv.innerHTML=h).catch(()=>pv.innerHTML='<p class="muted">The preview didn\'t load.</p>')}else ta.focus()}});
file.addEventListener("change",()=>{[...file.files].forEach(f=>upload(ta,f));file.value=""});
ta.addEventListener("dragover",e=>{if([...e.dataTransfer.items].some(i=>i.kind==="file")){e.preventDefault();ta.classList.add("over")}});ta.addEventListener("dragleave",()=>ta.classList.remove("over"));
ta.addEventListener("drop",e=>{const files=[...e.dataTransfer.files].filter(f=>f.type.startsWith("image/"));ta.classList.remove("over");if(!files.length)return;e.preventDefault();files.forEach(f=>upload(ta,f))});
ta.addEventListener("paste",e=>{const files=[...(e.clipboardData?.files||[])].filter(f=>f.type.startsWith("image/"));if(files.length){e.preventDefault();files.forEach(f=>upload(ta,f))}});
ta.addEventListener("keydown",e=>{if(!(e.metaKey||e.ctrlKey)||e.altKey)return;const k=e.key.toLowerCase();if(k==="b"||k==="i"||k==="k"){e.preventDefault();run(ta,k==="b"?"bold":k==="i"?"italic":"link")}});
// Formatting over a selection in the text.
const showFloat=()=>{if(ta.selectionStart===ta.selectionEnd||ta.hidden){float.hidden=true;return}active=ta;const c=caretXY(ta,ta.selectionStart),r=ta.getBoundingClientRect();near(float,Math.max(r.left,c.x-20),Math.max(r.top-44,c.y-44))};
ta.addEventListener("mouseup",()=>setTimeout(showFloat,0));ta.addEventListener("keyup",e=>{if(e.shiftKey||e.key==="Shift")showFloat()});ta.addEventListener("input",()=>float.hidden=true);ta.addEventListener("blur",()=>setTimeout(()=>{if(!float.matches(":hover"))float.hidden=true},150));
});
float.addEventListener("mousedown",e=>e.preventDefault());float.addEventListener("click",e=>{const b=e.target.closest("[data-md]");if(b&&active)run(active,b.dataset.md)});
menu.addEventListener("click",e=>{const b=e.target.closest("[data-insert]");if(!b||!menuFor)return;menu.hidden=true;const ta=menuFor,kind=b.dataset.insert;document.querySelectorAll("[data-insert-menu]").forEach(x=>x.setAttribute("aria-expanded","false"));
if(kind==="image")ta.closest(".editor").querySelector("[data-upload]").click();else if(kind==="code"){ta.focus();wrapSel(ta,"\n\x60\x60\x60\n","\n\x60\x60\x60\n","code")}else{ta.focus();openPanel(ta,kind)}});
document.addEventListener("mousedown",e=>{if(!menu.hidden&&!menu.contains(e.target)&&!e.target.closest("[data-insert-menu]")){menu.hidden=true;document.querySelectorAll("[data-insert-menu]").forEach(x=>x.setAttribute("aria-expanded","false"))}if(!panel.hidden&&!panel.contains(e.target))panel.hidden=true});
addEventListener("scroll",()=>{menu.hidden=true;float.hidden=true},{passive:true});
// Quote: select words in a post and press Quote, or Quote a whole post from its footer. Each quote
// goes in where the cursor is, linked back to the post, as many as you like.
const reply=document.querySelector("form#reply textarea");
if(reply){const pop=document.createElement("button");pop.type="button";pop.className="quote-pop";pop.hidden=true;pop.innerHTML='<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3.5 9.5h4v5h-4zM3.5 9.5c0-2.6 1.2-4.2 3.6-5M12.5 9.5h4v5h-4zM12.5 9.5c0-2.6 1.2-4.2 3.6-5"/></svg>Quote';document.body.append(pop);let pending=null;
// Quotes go where you last left the cursor in the reply, or after what's there; each one after the last.
let caret=null;["keyup","click","input"].forEach(ev=>reply.addEventListener(ev,()=>{caret=reply.selectionStart}));
const quote=(post,text)=>{const name=post.dataset.by||"Someone",body=text.trim().split("\n").map(l=>("> "+l).trimEnd()).join("\n");const q="> ["+name+"](#"+post.id+") wrote:\n"+body+"\n\n";const at=caret??reply.value.length,pre=reply.value.slice(0,at),lead=pre&&!pre.endsWith("\n\n")?(pre.endsWith("\n")?"\n":"\n\n"):"";reply.setRangeText(lead+q,at,at,"end");caret=at+lead.length+q.length;reply.dispatchEvent(new Event("input"));reply.closest("form").scrollIntoView({behavior:"smooth",block:"center"});reply.focus({preventScroll:true});reply.setSelectionRange(caret,caret)};
// A whole post as markdown again: its words, lists and code, a video as its link, without the quotes inside it.
const asText=el=>[...el.children].map(b=>{if(b.matches("figure.code"))return "\x60\x60\x60\n"+b.querySelector("code").textContent+"\n\x60\x60\x60";if(b.matches(".video"))return b.querySelector("a")?.dataset.out||"";if(b.matches("blockquote,hr"))return "";if(b.matches("ul,ol"))return [...b.children].map((li,i)=>(b.tagName==="OL"?(i+1)+". ":"- ")+li.innerText).join("\n");return b.innerText}).filter(Boolean).join("\n\n");
document.addEventListener("selectionchange",()=>{const s=getSelection();if(!s||s.isCollapsed||!s.rangeCount){pop.hidden=true;return}const r=s.getRangeAt(0),host=r.commonAncestorContainer.nodeType===1?r.commonAncestorContainer:r.commonAncestorContainer.parentElement,text=host&&host.closest(".p-text:not(.ed-preview)"),post=text&&text.closest(".post,.op");if(!post||!s.toString().trim()){pop.hidden=true;return}pending={post,text:s.toString()};const box=r.getBoundingClientRect();pop.hidden=false;pop.style.left=Math.max(8,box.left+box.width/2-40)+"px";pop.style.top=Math.max(70,box.top-42)+"px"});
pop.addEventListener("mousedown",e=>e.preventDefault());pop.addEventListener("click",()=>{if(pending)quote(pending.post,pending.text);pop.hidden=true;getSelection().removeAllRanges()});
document.addEventListener("click",e=>{const b=e.target.closest("[data-quote-post]");if(!b)return;const post=document.getElementById("p-"+b.dataset.quotePost),t=post&&post.querySelector(".p-text");if(t)quote(post,asText(t))});
addEventListener("scroll",()=>{pop.hidden=true},{passive:true})}
document.querySelectorAll("textarea[data-mentions]").forEach(ta=>{
// The list sits on the page itself, placed under the box: plates with the cut corner clip what's inside them.
const list=document.createElement("ul");list.className="mention-list";list.hidden=true;list.setAttribute("role","listbox");document.body.append(list);let items=[],at=-1,timer=0,token=null;
const place=()=>{const r=ta.getBoundingClientRect(),h=list.offsetHeight,below=innerHeight-r.bottom>h+8;list.style.left=Math.max(8,r.left)+"px";list.style.top=(below?r.bottom+4:Math.max(8,r.top-h-4))+"px"};
addEventListener("scroll",()=>{if(!list.hidden)place()},{passive:true});addEventListener("resize",()=>{if(!list.hidden)place()});
const close=()=>{list.hidden=true;items=[];at=-1};
const pick=p=>{const before=ta.value.slice(0,ta.selectionStart),after=ta.value.slice(ta.selectionStart),start=before.length-token.length-1,text=/^[\p{L}\p{N}_]+$/u.test(p.name)?"@"+p.name+" ":"@["+p.name+"] ";ta.value=before.slice(0,start)+text+after;const c=start+text.length;ta.setSelectionRange(c,c);ta.focus();close()};
const show=()=>{list.textContent="";items.forEach((p,i)=>{const li=document.createElement("li");li.setAttribute("role","option");li.setAttribute("aria-selected",i===at?"true":"false");li.textContent="@"+p.name;if(p.is_in_topic||p.is_zaisma){const s=document.createElement("small");s.textContent=p.is_zaisma?"the team":"in this topic";li.append(s)}li.onmousedown=e=>{e.preventDefault();pick(p)};list.append(li)});list.hidden=!items.length;if(!list.hidden)place()};
ta.addEventListener("input",()=>{const m=ta.value.slice(0,ta.selectionStart).match(/(?:^|\s)@(\[[^\]\n]{0,40}|[\p{L}\p{N}_]{0,40})$/u);if(!m){close();return}token=m[1];const q=token.replace(/^\[/,"");clearTimeout(timer);timer=setTimeout(()=>fetch("/forum/people?name_prefix="+encodeURIComponent(q)+"&topic_id="+encodeURIComponent(ta.dataset.topic||"")).then(r=>r.ok?r.json():[]).then(p=>{items=p;at=items.length?0:-1;show()}).catch(close),120)});
ta.addEventListener("keydown",e=>{if(list.hidden)return;if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();at=(at+(e.key==="ArrowDown"?1:items.length-1))%items.length;show()}else if((e.key==="Enter"||e.key==="Tab")&&at>=0){e.preventDefault();pick(items[at])}else if(e.key==="Escape")close()});
ta.addEventListener("blur",()=>setTimeout(close,150));
});
})();`);

// Reply to one post without reloading, keep the rail closed on phones, suggest similar topics while
// a title is typed, and keep tags to three.
const FORUM_SCRIPT = pageScript("forum", `(()=>{
const rail=document.querySelector(".rail");if(rail&&matchMedia("(max-width:900px)").matches)rail.open=false;
const c=document.getElementById("reply");
if(c&&c.tagName==="FORM"){const box=c.querySelector(".replying"),to=c.elements.reply_to_post_id;
document.addEventListener("click",e=>{const a=e.target.closest("[data-reply]");if(a){e.preventDefault();to.value=a.dataset.reply;box.querySelector("[data-to-name]").textContent=a.dataset.name;box.querySelector("[data-to-excerpt]").textContent=a.dataset.excerpt;box.hidden=false;c.scrollIntoView({behavior:"smooth",block:"center"});c.elements.text_markdown.focus({preventScroll:true})}
if(e.target.closest("[data-unreply]")||e.target.closest("[data-reply-top]")){to.value="";box.hidden=true;if(e.target.closest("[data-reply-top]")){e.preventDefault();c.scrollIntoView({behavior:"smooth",block:"center"});c.elements.text_markdown.focus({preventScroll:true})}}})}
// Like, Dislike and Bookmark change in place: the same form posts without leaving the page, and the post's row is swapped for the answer's. Without scripts the form still posts and reloads.
document.addEventListener("submit",e=>{const form=e.target;if(!form.matches||!form.matches("form[data-react]"))return;e.preventDefault();
const post=form.closest("[id^=p-]"),buttons=()=>[...post.querySelectorAll("form[data-react] button")],place=buttons().indexOf(form.querySelector("button")),row=post.querySelector(".reactions")?".reactions":".p-foot";
fetch(form.action,{method:"POST",body:new URLSearchParams(new FormData(form)),credentials:"same-origin"}).then(r=>r.text()).then(h=>{const fresh=new DOMParser().parseFromString(h,"text/html").getElementById(post.id),next=fresh&&fresh.querySelector(row);if(!next)return form.submit();post.querySelector(row).replaceWith(next);const again=buttons()[place];if(again)again.focus({preventScroll:true})}).catch(()=>form.submit())});
const f=document.querySelector("form.np");if(!f||!f.elements.title)return;
const t=f.elements.title,sim=document.getElementById("similar");let timer=0,last="";
const look=()=>{const q=t.value.trim();if(q===last)return;last=q;if(q.length<6){sim.innerHTML="";return}fetch("/forum/similar?search_text="+encodeURIComponent(q)).then(r=>r.text()).then(h=>{if(t.value.trim()===q)sim.innerHTML=h}).catch(()=>{})};
t.addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(look,350)});
const tags=[...f.querySelectorAll("input[name=tags]")],cap=()=>{const n=tags.filter(x=>x.checked).length;tags.forEach(x=>x.disabled=!x.checked&&n>=${FORUM_LIMITS.tagCountPerTopic})};tags.forEach(x=>x.addEventListener("change",cap));cap();
})();`);
