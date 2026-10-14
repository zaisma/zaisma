/**
 * Feedback about Zaisma itself, from developers and their AI (migrations/0023_feedback.sql), and the
 * developer forum it lives in (migrations/0026_forum.sql): each item is a topic.
 */

/** talk: a discussion that isn't a bug, gap, idea or question. */
export const FEEDBACK_KINDS = ["bug", "gap", "feature", "question", "talk"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/**
 * new: open, or waiting for Zaisma. A known issue's phases: investigating (Zaisma is looking), known
 * (confirmed), planned (on the roadmap), fixing (being worked on), released (a fix is out and Zaisma
 * is watching that it holds), fixed (resolved) and wont (won't fix, with why). answered: a question
 * with an answer.
 */
export const FEEDBACK_STATUSES = ["new", "investigating", "known", "planned", "fixing", "released", "fixed", "wont", "answered"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
/** A known issue still open: pinned in its category, and what a new report under it joins. */
export const FEEDBACK_OPEN_PHASES: FeedbackStatus[] = ["investigating", "known", "planned", "fixing", "released"];
/** Statuses a developer can reopen from. */
export const FEEDBACK_CLOSED: FeedbackStatus[] = ["fixed", "wont", "answered"];

/** Kinds that start private to the developer and Zaisma unless they post them publicly: they carry logs, screenshots and unreleased games. */
export const FEEDBACK_PRIVATE_KINDS: FeedbackKind[] = ["bug", "gap"];

/**
 * The forum's categories, each with its sub-categories. A topic's area is one sub-category: chosen
 * when it's posted, or set when it's sorted.
 */
export const FORUM_CATEGORIES = [
  { id: "publish", name: "Publishing", areas: { publishing: "Uploads and versions", scans: "Scans and reviews", pages: "Game pages and links" } },
  { id: "multiplayer", name: "Multiplayer", areas: { rooms: "Rooms", servers: "Game servers", passes: "Player passes" } },
  { id: "build", name: "Building games", areas: { sdk: "SDK", saves: "Cloud saves", stats: "Stats and plays" } },
  { id: "tools", name: "MCP and API", areas: { mcp: "MCP", api: "API", cli: "Upload command" } },
  { id: "site", name: "Accounts and dashboard", areas: { accounts: "Accounts and sign-in", dashboard: "Dashboard" } },
  { id: "safety", name: "Safety", areas: { reports: "Reports and moderation", rules: "Content rules" } },
  { id: "general", name: "General", areas: { docs: "Docs", other: "Anything else" } },
] as const;

/** Where in Zaisma an item is about: a forum sub-category. */
type AreasOf = { [C in (typeof FORUM_CATEGORIES)[number] as C["id"]]: keyof C["areas"] };
export type FeedbackArea = AreasOf[keyof AreasOf] & string;
export const FEEDBACK_AREAS = FORUM_CATEGORIES.flatMap((c) => Object.keys(c.areas)) as FeedbackArea[];

/** The category an area is in. */
export function forumCategoryOf(area: string): (typeof FORUM_CATEGORIES)[number] | null {
  return FORUM_CATEGORIES.find((c) => area in c.areas) ?? null;
}

/** The name of an area, like "Rooms". */
export function forumAreaName(area: string): string | null {
  const c = forumCategoryOf(area);
  return c ? (c.areas as Record<string, string>)[area]! : null;
}

/** Tags a topic can have, up to FEEDBACK_LIMITS.tags: what it runs on and what it's built with. */
export const FORUM_TAGS = {
  mobile: "Mobile",
  desktop: "Desktop",
  performance: "Performance",
  audio: "Audio",
  controls: "Controls",
  godot: "Godot",
  unity: "Unity",
  phaser: "Phaser",
  threejs: "Three.js",
  construct: "Construct",
  gamemaker: "GameMaker",
  "ai-made": "Made with AI",
} as const;
export type ForumTag = keyof typeof FORUM_TAGS;

/** What AI sorting found (migrations/0024_feedback_sorting.sql), for the person deciding. Never shown to developers. */
export interface FeedbackTriage {
  /** false when it was sorted without the AI (no key, or the month's budget used up). */
  ai: boolean;
  summary: string;
  why: string;
  /** The item it was merged into as a duplicate. */
  merged_into?: string;
  /** A public topic that looks like the same thing, for a person to merge or not. */
  same_as?: string;
  /** A known issue the AI proposes for a person to approve: a title every developer can read and what to do until it's fixed. */
  draft?: { title: string; workaround: string };
}

export type FeedbackAuthor = "person" | "ai" | "zaisma";
export type FeedbackVia = "mcp" | "api" | "cli" | "dashboard" | "admin";

export const FEEDBACK_LIMITS = {
  /** Posts per account per day: new items, additions and reopens alike. */
  postsPerDay: 100,
  title: 120,
  text: 8000,
  /** The JSON an AI attaches: the tool, the error, what it sent. */
  context: 8000,
  pictureBytes: 2 * 1024 * 1024,
  /** Images a post can carry, and how big each can be. */
  media: 10,
  mediaBytes: 5 * 1024 * 1024,
  /** Images an account can upload in a day, posted or not. */
  mediaPerDay: 200,
  tags: 3,
} as const;

export interface Feedback {
  id: string;
  account_id: string | null;
  kind: FeedbackKind;
  title: string;
  game_id: string | null;
  status: FeedbackStatus;
  group_id: string | null;
  severity: number;
  area: string;
  known_title: string | null;
  workaround: string | null;
  roadmap: string | null;
  created_at: number;
  updated_at: number;
  news_at: number | null;
  seen_at: number | null;
  /** FeedbackTriage as JSON, once sorted. */
  triage: string | null;
  triaged_at: number | null;
  triage_tries: number;
  /** 1 when it's a public topic. */
  public: number;
  /** 1 once a public topic's first post has passed the check, so others see it. */
  shown: number;
  votes: number;
  replies: number;
  answer_post: string | null;
  active_at: number | null;
}

export interface FeedbackPost {
  id: string;
  feedback_id: string;
  account_id: string | null;
  author: FeedbackAuthor;
  via: FeedbackVia;
  kind: "post" | "reopen" | "status";
  text: string;
  context: string | null;
  picture: string | null;
  created_at: number;
  reply_to: string | null;
  /** On a public topic: pending, ok (others see it) or held (waits for a person). NULL on a private one. */
  check_state: "pending" | "ok" | "held" | null;
  check_tries: number;
  check_reason: string | null;
  /** How many developers marked it helpful. */
  helpful: number;
}

/** Why a forum post is reported. child_safety hides it at once; any three reports hide it until a person looks. */
export const FORUM_REPORT_REASONS = {
  personal_info: "Shares someone's personal details, or asks to talk somewhere else",
  harassment: "Harasses, insults or threatens someone",
  sexual: "Sexual content",
  hate: "Hateful",
  scam: "A scam, spam or malware",
  child_safety: "Puts a young person at risk",
  other: "Something else",
} as const;
export type ForumReportReason = keyof typeof FORUM_REPORT_REASONS;
/** Reports from this many developers hide a post until a person looks. */
export const FORUM_REPORTS_TO_HIDE = 3;

export const feedbackPictureKey = (postId: string) => `feedback-pictures/${postId}`;
/** Where an image in a forum post is kept (feedback_media). */
export const feedbackMediaKey = (mediaId: string) => `feedback-media/${mediaId}`;

const REMOVED = "[secret removed]";

/**
 * Secrets in feedback text, blanked before it's stored: an AI pasting a config or a failing request
 * can easily include a key. Errs toward blanking: known key shapes, private keys, tokens after
 * "Bearer" or a name like api_key=, passwords in connection strings and long mixed-case random
 * strings. Plain hex (file hashes, IDs) is kept, since feedback often needs it.
 */
const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bzsk_[A-Za-z0-9_-]{8,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\b(?:sk|rk|pk|whsec)_(?:live|test)_[A-Za-z0-9]{8,}/g,
  /\bwhsec_[A-Za-z0-9+/=]{16,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
];

export function blankSecrets(text: string): { text: string; blanked: number } {
  let blanked = 0;
  const hit = () => {
    blanked++;
    return REMOVED;
  };
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, hit);
  // A token after Bearer or Basic.
  out = out.replace(/\b(Bearer|Basic)(\s+)([A-Za-z0-9._~+/=-]{12,})/gi, (_m, word: string, space: string) => `${word}${space}${hit()}`);
  // name = value, name: "value", NAME=value for anything named like a secret.
  out = out.replace(
    /\b([A-Za-z0-9_.-]*(?:api[_-]?key|secret|token|passw(?:or)?d|pwd|private[_-]?key|access[_-]?key|authorization|credentials?)[A-Za-z0-9_.-]*)(["']?\s*[:=]\s*["']?)([^\s"',;}{)]{6,})/gi,
    (m, name: string, sep: string, value: string) => (/^(?:true|false|null|undefined|bearer|basic|\[secret)/i.test(value) || /^[0-9.]+$/.test(value) ? m : `${name}${sep}${hit()}`),
  );
  // user:password@host in connection strings.
  out = out.replace(/\b([a-z][a-z0-9+.-]*:\/\/[^:/\s@]+:)([^@\s]{3,})@/gi, (_m, start: string) => `${start}${hit()}@`);
  // Long random-looking strings with upper case, lower case and digits mixed (hex hashes are left alone).
  out = out.replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g, (m) => (/[A-Z]/.test(m) && /[a-z]/.test(m) && /[0-9]/.test(m) && !/^[0-9a-f]+$/i.test(m) && !m.includes("/") ? hit() : m));
  return { text: out, blanked };
}

const STOP = new Set(
  "the and for with that this from have when what does doesnt dont into your their them then than there were been being would could should about after before while which where just also only some more most very will cant isnt wont game games zaisma".split(" "),
);

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9_\s-]/g, " ")
      .split(/[\s-]+/)
      .filter((w) => w.length >= 4 && !STOP.has(w))
      // Roughly the same word: "uploads" and "upload", "failed" and "fail".
      .map((w) => w.replace(/(?:ing|ed|es|s)$/, (end, at: number) => (at >= 3 ? "" : end))),
  );
}

/**
 * Known issues that look like the same problem, best first: shared words between what was written
 * and each known issue. Cheap and instant, so every new item gets an answer at once; the closer
 * sorting happens later.
 */
export function matchKnownIssues<T extends { known_title: string | null; title: string; workaround: string | null; area: string }>(text: string, known: T[], max = 3): T[] {
  const asked = words(text);
  if (!asked.size) return [];
  return known
    .map((k) => {
      const theirs = words(`${k.known_title ?? k.title} ${k.title} ${k.workaround ?? ""} ${k.area}`);
      let score = 0;
      for (const w of asked) if (theirs.has(w)) score++;
      return { k, score };
    })
    .filter((m) => m.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((m) => m.k);
}
