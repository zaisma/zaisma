/**
 * The developer forum (migrations/0026_forum.sql, named as in 0031_forum_names.sql): topics from
 * developers and their AI about Zaisma itself, with posts, and Zaisma's known issues.
 */

/** talk: a discussion that isn't a bug, gap, idea or question. */
export const TOPIC_KINDS = ["bug", "gap", "feature", "question", "talk"] as const;
export type TopicKind = (typeof TOPIC_KINDS)[number];

/**
 * new: open, or waiting for Zaisma. A known issue's phases: investigating (Zaisma is looking), known
 * (confirmed), planned (on the roadmap), fixing (being worked on), released (a fix is out and Zaisma
 * is watching that it holds), fixed (resolved) and wont (won't fix, with why). answered: a question
 * with an answer.
 */
export const TOPIC_STATUSES = ["new", "investigating", "known", "planned", "fixing", "released", "fixed", "wont", "answered"] as const;
export type TopicStatus = (typeof TOPIC_STATUSES)[number];
/** A known issue still open: pinned in its category, and what a new message about it joins. */
export const OPEN_KNOWN_ISSUE_STATUSES: TopicStatus[] = ["investigating", "known", "planned", "fixing", "released"];
/** Statuses a developer can reopen their topic from. */
export const CLOSED_TOPIC_STATUSES: TopicStatus[] = ["fixed", "wont", "answered"];

/** How serious a topic is, set by AI sorting or a person at Zaisma, never by whoever posted it. */
export const TOPIC_SEVERITIES = ["urgent", "high", "normal", "low"] as const;
export type TopicSeverity = (typeof TOPIC_SEVERITIES)[number];

/**
 * The forum's sections, each with its categories. A topic is in one category: picked when it's
 * posted, or moved when someone flags it as misplaced.
 */
export const FORUM_SECTIONS = [
  { id: "publish", name: "Publishing", categories: { publishing: "Uploads and versions", scans: "Scans and reviews", pages: "Game pages and links" } },
  { id: "multiplayer", name: "Multiplayer", categories: { rooms: "Rooms", servers: "Game servers", passes: "Player passes" } },
  { id: "build", name: "Building games", categories: { sdk: "SDK", saves: "Cloud saves", stats: "Stats and plays" } },
  { id: "tools", name: "MCP and API", categories: { mcp: "MCP", api: "API", cli: "Upload command" } },
  { id: "site", name: "Accounts and dashboard", categories: { accounts: "Accounts and sign-in", dashboard: "Dashboard" } },
  { id: "safety", name: "Safety", categories: { reports: "Reports and moderation", rules: "Content rules" } },
  { id: "general", name: "General", categories: { docs: "Docs", other: "Anything else" } },
] as const;
export type ForumSection = (typeof FORUM_SECTIONS)[number];

type CategoriesOf = { [Section in ForumSection as Section["id"]]: keyof Section["categories"] };
/** The part of Zaisma a topic is about. */
export type ForumCategory = CategoriesOf[keyof CategoriesOf] & string;
export const FORUM_CATEGORIES = FORUM_SECTIONS.flatMap((section) => Object.keys(section.categories)) as ForumCategory[];

/** The section a category is in. */
export function forumSectionOf(category: string): ForumSection | null {
  return FORUM_SECTIONS.find((section) => category in section.categories) ?? null;
}

/** The name of a category, like "Rooms". */
export function forumCategoryName(category: string): string | null {
  const section = forumSectionOf(category);
  return section ? (section.categories as Record<string, string>)[category]! : null;
}

/** How the forum lists topics. yours: your public topics and the ones you follow. messages: your private messages to Zaisma. */
export const FORUM_TABS = ["latest", "top", "unanswered", "known", "yours", "messages", "bookmarks"] as const;
export type ForumTab = (typeof FORUM_TABS)[number];
/** What a developer (or their AI) says about a post, anonymously: one per account and post. */
export const POST_RATINGS = ["like", "dislike"] as const;
export type PostRating = (typeof POST_RATINGS)[number];
/** Which posts a topic comes with: all, the opening post and the marked answer, the opening post and the last five, or none. */
export const POST_SELECTIONS = ["all", "answer", "latest", "none"] as const;
export type PostSelection = (typeof POST_SELECTIONS)[number];

/** Tags a topic can have, up to FORUM_LIMITS.tagCountPerTopic: what it runs on and what it's built with. */
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

/** What AI sorting found (forum_topics.triage), for the person deciding. Never shown to developers. */
export interface TopicTriage {
  /** false when it was sorted without the AI (no key, or the month's budget used up). */
  is_by_ai: boolean;
  summary: string;
  why: string;
  /** The topic it was merged into as a duplicate. */
  merged_into_topic_id: string | null;
  /** A public topic that looks like the same thing, for a person to merge or not. */
  same_as_topic_id: string | null;
  /** A known issue the AI proposes for a person to approve: a title every developer can read and what to do until it's fixed. */
  known_issue_draft: { title: string; workaround: string } | null;
}

/** developer: the developer wrote it; ai: their AI assistant; zaisma: the people who build Zaisma. */
export type AuthorKind = "developer" | "ai" | "zaisma";
/** How a post came in: the forum's pages count as the dashboard. */
export type PostedVia = "mcp" | "api" | "cli" | "dashboard" | "admin";

export const FORUM_LIMITS = {
  /** Posts per account per day: new topics and replies alike. */
  postsPerDay: 100,
  titleCharacterCount: 120,
  textCharacterCount: 8000,
  /** What an AI attaches for whoever fixes it, as JSON. */
  debugContextCharacterCount: 8000,
  /** Images a post can carry, and how big each can be. */
  imageCountPerPost: 10,
  imageSizeBytes: 5 * 1024 * 1024,
  /** Images through the MCP, which sends them as base64 inside one message. */
  mcpImageCountPerPost: 4,
  mcpImageSizeBytes: 2 * 1024 * 1024,
  /** Images an account can upload in a day, posted or not. */
  imagesPerDay: 200,
  tagCountPerTopic: 3,
} as const;

/** A row of forum_topics. */
export interface ForumTopic {
  id: string;
  account_id: string | null;
  kind: TopicKind;
  title: string;
  game_id: string | null;
  topic_status: TopicStatus;
  merged_into_topic_id: string | null;
  severity: TopicSeverity;
  category: string;
  known_issue_title: string | null;
  workaround: string | null;
  roadmap_item: string | null;
  created_at_ms: number;
  updated_at_ms: number;
  /** When Zaisma last replied or changed its status, and when its developer last read it. */
  news_at_ms: number | null;
  seen_at_ms: number | null;
  /** TopicTriage as JSON, once sorted. */
  triage: string | null;
  triaged_at_ms: number | null;
  triage_attempt_count: number;
  is_public: number;
  /** 1 once a public topic's first post has passed the check, so others see it. */
  is_shown: number;
  vote_count: number;
  reply_count: number;
  answer_post_id: string | null;
  last_activity_at_ms: number | null;
}

/** What an AI attaches to a post for whoever fixes the problem. Only its poster and Zaisma see it. */
export interface DebugContext {
  /** The tool, command or API call, like upload_files or POST /api/dev/games/sky-hopper/versions. */
  call: string | null;
  error_code: string | null;
  error_message: string | null;
  /** What was sent, as JSON, without secrets or whole files. */
  request_json: string | null;
  notes: string | null;
}
export const DEBUG_CONTEXT_KEYS = ["call", "error_code", "error_message", "request_json", "notes"] as const satisfies readonly (keyof DebugContext)[];

/** A row of forum_posts. */
export interface ForumPost {
  id: string;
  topic_id: string;
  account_id: string | null;
  author_kind: AuthorKind;
  posted_via: PostedVia;
  kind: "post" | "reopen" | "status";
  text_markdown: string;
  /** DebugContext as JSON. */
  debug_context: string | null;
  created_at_ms: number;
  reply_to_post_id: string | null;
  /** On a public topic: pending, passed (others see it) or held (waits for a person). NULL on a private one. */
  check_status: "pending" | "passed" | "held" | null;
  check_attempt_count: number;
  held_reason: string | null;
  like_count: number;
  dislike_count: number;
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
export const FORUM_HIDING_REPORT_COUNT = 3;

/** Where a new image in a forum post is kept (forum_media.storage_key). */
export const forumMediaKey = (mediaId: string) => `forum-media/${mediaId}`;

const REMOVED = "[secret removed]";

/**
 * Secrets in forum text, blanked before it's stored: an AI pasting a config or a failing request
 * can easily include a key. Errs toward blanking: known key shapes, private keys, tokens after
 * "Bearer" or a name like api_key=, passwords in connection strings and long mixed-case random
 * strings. Plain hex (file hashes, IDs) is kept, since posts often need it.
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

export function blankSecrets(text: string): { text: string; blankedCount: number } {
  let blankedCount = 0;
  const blank = () => {
    blankedCount++;
    return REMOVED;
  };
  let cleaned = text;
  for (const pattern of SECRET_PATTERNS) cleaned = cleaned.replace(pattern, blank);
  // A token after Bearer or Basic.
  cleaned = cleaned.replace(/\b(Bearer|Basic)(\s+)([A-Za-z0-9._~+/=-]{12,})/gi, (_, word: string, space: string) => `${word}${space}${blank()}`);
  // name = value, name: "value", NAME=value for anything named like a secret.
  cleaned = cleaned.replace(
    /\b([A-Za-z0-9_.-]*(?:api[_-]?key|secret|token|passw(?:or)?d|pwd|private[_-]?key|access[_-]?key|authorization|credentials?)[A-Za-z0-9_.-]*)(["']?\s*[:=]\s*["']?)([^\s"',;}{)]{6,})/gi,
    (whole, name: string, separator: string, secret: string) => (/^(?:true|false|null|undefined|bearer|basic|\[secret)/i.test(secret) || /^[0-9.]+$/.test(secret) ? whole : `${name}${separator}${blank()}`),
  );
  // user:password@host in connection strings.
  cleaned = cleaned.replace(/\b([a-z][a-z0-9+.-]*:\/\/[^:/\s@]+:)([^@\s]{3,})@/gi, (_, start: string) => `${start}${blank()}@`);
  // Long random-looking strings with upper case, lower case and digits mixed (hex hashes are left alone).
  cleaned = cleaned.replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g, (found) => (/[A-Z]/.test(found) && /[a-z]/.test(found) && /[0-9]/.test(found) && !/^[0-9a-f]+$/i.test(found) && !found.includes("/") ? blank() : found));
  return { text: cleaned, blankedCount };
}

const STOP_WORDS = new Set(
  "the and for with that this from have when what does doesnt dont into your their them then than there were been being would could should about after before while which where just also only some more most very will cant isnt wont game games zaisma".split(" "),
);

function wordsOf(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9_\s-]/g, " ")
      .split(/[\s-]+/)
      .filter((word) => word.length >= 4 && !STOP_WORDS.has(word))
      // Roughly the same word: "uploads" and "upload", "failed" and "fail".
      .map((word) => word.replace(/(?:ing|ed|es|s)$/, (ending, endingIndex: number) => (endingIndex >= 3 ? "" : ending))),
  );
}

/**
 * Known issues that look like the same problem, best first: shared words between what was written
 * and each known issue. Cheap and instant, for AI sorting's candidates.
 */
export function matchKnownIssues<Topic extends { known_issue_title: string | null; title: string; workaround: string | null; category: string }>(text: string, known: Topic[], maximumCount = 3): Topic[] {
  const asked = wordsOf(text);
  if (!asked.size) return [];
  return known
    .map((topic) => {
      const theirs = wordsOf(`${topic.known_issue_title ?? topic.title} ${topic.title} ${topic.workaround ?? ""} ${topic.category}`);
      let sharedWordCount = 0;
      for (const word of asked) if (theirs.has(word)) sharedWordCount++;
      return { topic, sharedWordCount };
    })
    .filter((match) => match.sharedWordCount >= 2)
    .sort((first, second) => second.sharedWordCount - first.sharedWordCount)
    .slice(0, maximumCount)
    .map((match) => match.topic);
}
