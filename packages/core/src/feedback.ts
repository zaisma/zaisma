/**
 * Feedback about Zaisma itself, from developers and their AI (migrations/0023_feedback.sql).
 */

export const FEEDBACK_KINDS = ["bug", "gap", "feature", "question"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** new: waiting for Zaisma. known: Zaisma knows about it. planned: on the roadmap. fixed. wont: won't change, with why. answered: a question with an answer. */
export const FEEDBACK_STATUSES = ["new", "known", "planned", "fixed", "wont", "answered"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
/** Statuses a developer can reopen from. */
export const FEEDBACK_CLOSED: FeedbackStatus[] = ["fixed", "wont", "answered"];

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
}

export const feedbackPictureKey = (postId: string) => `feedback-pictures/${postId}`;

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
