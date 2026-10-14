import { esc } from "./html.ts";

/**
 * Markdown for forum posts, written by developers and their AI: headings, bold, italics,
 * strikethrough, lists, quotes, rules, links, `code` and fenced code blocks (with a language, Copy
 * and Wrap), and @mentions. Everything else is text: nothing a post contains becomes HTML on its own.
 *
 * Links to Zaisma open directly. Links elsewhere go through /forum/out, which says where they lead
 * (a viewer can trust a site once). A link on its own line to a video on YouTube, Vimeo or
 * Streamable shows the video's player in the post.
 */

export interface MarkdownContext {
  siteOrigin: string;
  /** Names this post mentions (lowercased), as they were saved when it was posted. */
  mentions: Set<string>;
}

/** Hosts whose players a video card can load, and how to embed one. */
export const VIDEO_FRAMES = ["https://www.youtube-nocookie.com", "https://player.vimeo.com", "https://streamable.com"];

export function videoOf(url: string): { host: string; embed: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  const id = (re: RegExp, s: string) => s.match(re)?.[1] ?? null;
  if (host === "youtube.com") {
    const v = u.searchParams.get("v") ?? id(/^\/(?:shorts|embed|live)\/([\w-]{6,20})/, u.pathname);
    return v && /^[\w-]{6,20}$/.test(v) ? { host: "YouTube", embed: `https://www.youtube-nocookie.com/embed/${v}` } : null;
  }
  if (host === "youtu.be") {
    const v = id(/^\/([\w-]{6,20})$/, u.pathname);
    return v ? { host: "YouTube", embed: `https://www.youtube-nocookie.com/embed/${v}` } : null;
  }
  if (host === "vimeo.com") {
    const v = id(/^\/(\d{5,12})$/, u.pathname);
    return v ? { host: "Vimeo", embed: `https://player.vimeo.com/video/${v}?dnt=1` } : null;
  }
  if (host === "streamable.com") {
    const v = id(/^\/(?:e\/)?([a-z0-9]{4,12})$/i, u.pathname);
    return v ? { host: "Streamable", embed: `https://streamable.com/e/${v}` } : null;
  }
  return null;
}

/** A mention as written: @[Two Words] or @Word. */
export const MENTION = /@\[([^\]\n]{1,60})\]|@([\p{L}\p{N}_]{2,40})/gu;

/** The names a post mentions, as written. */
export function mentionedNames(text: string): string[] {
  const names = new Set<string>();
  for (const m of stripCode(text).matchAll(MENTION)) names.add((m[1] ?? m[2])!.trim());
  return [...names].slice(0, 20);
}

/** Text without its code, so @ and links inside code mean nothing. */
function stripCode(text: string): string {
  return text.replace(/```[\s\S]*?(```|$)/g, " ").replace(/`[^`\n]*`/g, " ");
}

function linkHtml(url: string, label: string, ctx: MarkdownContext): string {
  // A post on the same page, as a quote's "wrote:" links to it.
  if (/^#p-[a-z0-9]{1,40}$/.test(url)) return `<a href="${url}">${label}</a>`;
  let u: URL;
  try {
    u = new URL(url, ctx.siteOrigin);
  } catch {
    return label;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return label;
  const site = new URL(ctx.siteOrigin);
  const ours = u.origin === site.origin || /(^|\.)zaisma\.com$/.test(u.hostname);
  if (ours) return `<a href="${esc(u.href)}">${label}</a>`;
  return `<a class="out" href="/forum/out?to=${encodeURIComponent(u.href)}" data-out="${esc(u.href)}" data-host="${esc(u.hostname)}" rel="nofollow ugc noopener">${label}</a>`;
}

/** Bold, italics, strikethrough, code, links and mentions within a line. */
function inline(text: string, ctx: MarkdownContext): string {
  const held: string[] = [];
  const hold = (html: string) => `\u0000${held.push(html) - 1}\u0000`;
  let s = text.replace(/\u0000/g, "");
  s = s.replace(/`([^`\n]+)`/g, (_m, code: string) => hold(`<code>${esc(code)}</code>`));
  s = s.replace(/\[([^\]\n]{1,200})\]\(([^)\s]{1,2000})\)/g, (_m, label: string, url: string) => hold(linkHtml(url, inlineText(label), ctx)));
  s = s.replace(/\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/g, (url) => hold(linkHtml(url, esc(url), ctx)));
  s = s.replace(MENTION, (m, bracketed: string | undefined, word: string | undefined) => {
    const name = (bracketed ?? word)!.trim();
    return ctx.mentions.has(name.toLowerCase()) ? hold(`<span class="mention">@${esc(name)}</span>`) : m;
  });
  return emphasis(esc(s)).replace(/\u0000(\d+)\u0000/g, (_m, i: string) => held[Number(i)]!);
}

/** A link's label: emphasis, but no links inside links. */
function inlineText(text: string): string {
  return emphasis(esc(text));
}

function emphasis(html: string): string {
  return html
    .replace(/\*\*(?=\S)([^*]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/~~(?=\S)([^~]+?)~~/g, "<del>$1</del>")
    .replace(/(^|[\s(])\*(?=\S)([^*\n]+?)\*(?=$|[\s).,;:!?])/g, "$1<em>$2</em>")
    .replace(/(^|[\s(])_(?=\S)([^_\n]+?)_(?=$|[\s).,;:!?])/g, "$1<em>$2</em>");
}

function codeBlock(lang: string, code: string): string {
  const label = lang ? esc(lang) : "Code";
  return `<figure class="code"><figcaption><span>${label}</span><button type="button" data-wrap aria-pressed="false">Wrap</button><button type="button" data-copy>Copy</button></figcaption><pre><code>${esc(code)}</code></pre></figure>`;
}

function videoCard(url: string, v: { host: string; embed: string }, ctx: MarkdownContext): string {
  return `<div class="video"><iframe src="${esc(v.embed)}" title="${v.host} video" loading="lazy" allow="fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"></iframe>${linkHtml(url, `Open on ${v.host}`, ctx)}</div>`;
}

/** A post's text as safe HTML. */
export function renderMarkdown(text: string, ctx: MarkdownContext): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${para.map((l) => inline(l, ctx)).join("<br>")}</p>`);
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = line.match(/^\s*```\s*([\w+#.-]{0,20})\s*$/);
    if (fence) {
      flush();
      const code: string[] = [];
      while (++i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) code.push(lines[i]!);
      out.push(codeBlock(fence[1] ?? "", code.join("\n")));
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flush();
      out.push(`<h${heading[1]!.length === 1 ? 3 : 4} class="md-h">${inline(heading[2]!, ctx)}</h${heading[1]!.length === 1 ? 3 : 4}>`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush();
      out.push("<hr>");
      continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) quoted.push(lines[i++]!.replace(/^\s*>\s?/, ""));
      i--;
      out.push(`<blockquote>${renderMarkdown(quoted.join("\n"), ctx)}</blockquote>`);
      continue;
    }
    const bullet = /^\s*[-*+]\s+/;
    const number = /^\s*\d{1,3}[.)]\s+/;
    if (bullet.test(line) || number.test(line)) {
      flush();
      const ordered = number.test(line);
      const re = ordered ? number : bullet;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i]!)) items.push(lines[i++]!.replace(re, ""));
      i--;
      out.push(`<${ordered ? "ol" : "ul"}>${items.map((it) => `<li>${inline(it, ctx)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    const bare = line.trim();
    const video = /^https?:\/\/\S+$/.test(bare) ? videoOf(bare) : null;
    if (video) {
      flush();
      out.push(videoCard(bare, video, ctx));
      continue;
    }
    para.push(line);
  }
  flush();
  return out.join("");
}
