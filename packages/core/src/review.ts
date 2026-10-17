/**
 * Why Zaisma held, rejected or took something down ("Support, reports and moderation are designed
 * for AI first" in docs/DECISIONS.md): every hold, rejection and takedown has a stable code from one
 * list, a plain message, the content rule it's about and a fix, the same in the dashboard, the
 * developer API and the MCP. docs/DEVELOPER-API.md lists every code and rule, and
 * test/node/errors.test.ts keeps the two in step.
 */

/**
 * Zaisma's content rules (zaisma.com/legal/content-rules), in the page's order, by the name holds and
 * takedowns give them. The page's anchors are these names. Where a player's report reason means the
 * same thing (REPORT_REASONS), the name is the same.
 */
export const CONTENT_RULES = {
  child_safety: "Sexual content involving minors, in any form. We report it to the National Center for Missing & Exploited Children.",
  sexual: "Sexually explicit content.",
  malware: "Malware, crypto miners, phishing, scams or anything that tries to break out of the game.",
  illegal: "Content that's illegal in the United States, including real-money gambling.",
  hate: "Hate, harassment or threats against real people or groups.",
  copyright: "Other people's games, art, music or characters used without permission.",
  personal_data: "Collecting players' personal data.",
  free_text_chat: "Free-text chat between players. Preset phrases and emotes are fine.",
  faked_plays: "Faking plays or players, with bots, scripts or click farms.",
} as const;
export type ContentRule = keyof typeof CONTENT_RULES;
export const isContentRule = (candidate: unknown): candidate is ContentRule => typeof candidate === "string" && Object.hasOwn(CONTENT_RULES, candidate);

/** The fix for a hold a person decides: there's nothing for the developer to change. */
const PERSON_LOOKS = "Nothing to change: a person at Zaisma looks, usually within a day.";
/** What follows an AI review's concern, whatever the developer changes. */
const IF_THE_AI_IS_WRONG = "If the AI got it wrong: a person at Zaisma decides a held version, usually within a day; for a rejected one, message_zaisma with the version_id.";

interface ReviewCode {
  /** What it means, in one sentence: listed in docs/DEVELOPER-API.md, and the message when the code has no message of its own. */
  meaning: string;
  /** The content rule it's about, or null when it breaks none (a check that couldn't finish) or a person picks one each time. */
  contentRule: ContentRule | null;
  /** What to do about it, naming the call when there is one. */
  fix: string;
  /** The message is the case's own (the AI's words, a person's), not the meaning. */
  hasOwnMessage?: true;
  /** A person picks the content rule each time (or none). */
  isRulePicked?: true;
}

/**
 * Every code a hold, rejection or takedown can have, by what decided it. Codes are lowercase
 * snake_case, never reused for another problem, and never the same as an error code.
 */
export const REVIEW_CODES = {
  // The scan's rule-based checks
  crypto_miner: { meaning: "The code mines cryptocurrency.", contentRule: "malware", fix: "Take the mining code out and upload a new version." },
  packed_code: {
    meaning: "Code is packed or decoded at runtime (eval of encoded text), which hides what it does.",
    contentRule: "malware",
    fix: "A person at Zaisma looks, usually within a day. To pass by itself next time, upload the code without eval of encoded text; an ordinary minified build is fine.",
  },
  top_navigation: {
    meaning: "The code tries to change the page outside the game (the top or parent window's location).",
    contentRule: "malware",
    fix: 'Take out code that sets top.location or parent.location, and upload a new version; open links with window.open or a link with target="_blank". A person also looks at the held one, usually within a day.',
  },
  password_field: {
    meaning: "The game has a password field. Games don't need one, and phishing pages do.",
    contentRule: "malware",
    fix: "Take the password field out and upload a new version: players sign in with Zaisma, so games never ask for passwords. A person also looks at the held one, usually within a day.",
  },
  external_form: {
    meaning: "The game has a form that sends what players type to another site.",
    contentRule: "personal_data",
    fix: "Take the form out and upload a new version. A person also looks at the held one, usually within a day.",
  },
  antivirus_flag: {
    meaning: "Antivirus engines flag a file: three or more reject the version, fewer hold it for a person.",
    contentRule: "malware",
    fix: "Build the file again from clean sources and upload a new version. If it's a false alarm: a person at Zaisma decides a held version, usually within a day; for a rejected one, message_zaisma with the version_id.",
    hasOwnMessage: true,
  },

  // Checks that couldn't finish: no rule is broken, and a person looks instead
  too_much_code: { meaning: "The game has more code than the automatic checks read (40 MB), so a person at Zaisma looks first.", contentRule: null, fix: `${PERSON_LOOKS} Leaving unused files out keeps the next version under the limit.` },
  too_many_files_to_check: { meaning: "The game has more files than the scan checks for hidden pictures (5,000), so a person at Zaisma looks at the rest.", contentRule: null, fix: PERSON_LOOKS },
  too_many_images_to_check: { meaning: "The game has more pictures and videos than image matching checks (5,000), so a person at Zaisma looks at the rest.", contentRule: null, fix: PERSON_LOOKS },
  image_matching_off: { meaning: "Image matching isn't connected, so a person at Zaisma approves each version.", contentRule: null, fix: PERSON_LOOKS },
  image_matching_failed: { meaning: "Image matching couldn't check every picture and video, so a person at Zaisma looks first.", contentRule: null, fix: PERSON_LOOKS },
  ai_review_off: { meaning: "AI review isn't set up, so a person at Zaisma approves each version.", contentRule: null, fix: PERSON_LOOKS },
  ai_review_budget_used: { meaning: "This month's AI reviews are used up, so a person at Zaisma approves each version.", contentRule: null, fix: PERSON_LOOKS },
  ai_review_declined: { meaning: "The AI reviewer wouldn't review the game, so a person at Zaisma looks.", contentRule: null, fix: PERSON_LOOKS },
  ai_review_failed: { meaning: "The AI review didn't finish, so a person at Zaisma looks.", contentRule: null, fix: PERSON_LOOKS },
  scan_failed: { meaning: "The scan didn't finish after three tries, so a person at Zaisma looks.", contentRule: null, fix: `${PERSON_LOOKS} Uploading the version again scans it again.` },

  // The AI review's concerns, in the AI's words
  ai_malware: { meaning: "The AI review found what looks like malware.", contentRule: "malware", fix: `If the game does that, take it out and upload a new version. ${IF_THE_AI_IS_WRONG}`, hasOwnMessage: true },
  ai_phishing_or_scam: { meaning: "The AI review found what looks like phishing or a scam.", contentRule: "malware", fix: `If the game does that, take it out and upload a new version. ${IF_THE_AI_IS_WRONG}`, hasOwnMessage: true },
  ai_data_collection: {
    meaning: "The AI review found the game collecting players' personal data, like names, emails, birthdays or location.",
    contentRule: "personal_data",
    fix: `Stop asking players for personal details (Zaisma gives each player an ID and a name) and upload a new version. ${IF_THE_AI_IS_WRONG}`,
    hasOwnMessage: true,
  },
  ai_sexual_content: { meaning: "The AI review found sexual content or nudity.", contentRule: "sexual", fix: `If the game has it, take it out and upload a new version. ${IF_THE_AI_IS_WRONG}`, hasOwnMessage: true },
  ai_hate_or_harassment: { meaning: "The AI review found hate or harassment.", contentRule: "hate", fix: `If the game has it, take it out and upload a new version. ${IF_THE_AI_IS_WRONG}`, hasOwnMessage: true },
  ai_extreme_violence: { meaning: "The AI review found extreme violence or gore, for a person at Zaisma to judge.", contentRule: null, fix: PERSON_LOOKS, hasOwnMessage: true },
  ai_real_money_gambling: { meaning: "The AI review found real-money gambling.", contentRule: "illegal", fix: `Take out betting with real money or anything bought with it, and upload a new version. ${IF_THE_AI_IS_WRONG}`, hasOwnMessage: true },
  ai_likely_copyright: {
    meaning: "The AI review found characters, art or music that look like someone else's.",
    contentRule: "copyright",
    fix: `Replace what isn't yours, unless you may use it, and upload a new version. ${IF_THE_AI_IS_WRONG}`,
    hasOwnMessage: true,
  },
  ai_free_text_chat: { meaning: "The AI review found free-text chat between players.", contentRule: "free_text_chat", fix: `Swap typed chat for preset phrases or emotes, and upload a new version. ${IF_THE_AI_IS_WRONG}`, hasOwnMessage: true },
  ai_other: { meaning: "The AI review found something else for a person at Zaisma to look at.", contentRule: null, fix: `If the message is right, change it and upload a new version. ${IF_THE_AI_IS_WRONG}`, hasOwnMessage: true },
  ai_concern: { meaning: "The AI review held or rejected the version without naming one concern; the message is its summary.", contentRule: null, fix: `If the message is right, change it and upload a new version. ${IF_THE_AI_IS_WRONG}`, hasOwnMessage: true },

  // People and reports
  needs_review: { meaning: "A person at Zaisma needs to look at it first.", contentRule: null, fix: "Nothing to change: a person at Zaisma looks." },
  report_paused_game: {
    meaning: "A player report paused the game while Zaisma checks it.",
    contentRule: null,
    fix: "Nothing to change: a person at Zaisma checks it, usually within a day. Until then players and tester links can't open the game.",
  },
  report_paused_update: {
    meaning: "A player report paused this update while Zaisma checks it; players get the version before it.",
    contentRule: null,
    fix: "Nothing to change: a person at Zaisma checks it, usually within a day, and puts it back if the report was wrong.",
  },
  rejected_by_zaisma: {
    meaning: "A person at Zaisma rejected the version; the message says why.",
    contentRule: null,
    fix: "Change what the message says and upload a new version. If it's a mistake, message_zaisma with the version_id.",
    hasOwnMessage: true,
    isRulePicked: true,
  },
  taken_down: {
    meaning: "A person at Zaisma took the game down; the message says why.",
    contentRule: null,
    fix: "If it's a mistake, or to say what you'll change, message_zaisma with the game_slug. Until Zaisma restores it, the game can't get new versions or change who can play it.",
    hasOwnMessage: true,
    isRulePicked: true,
  },
  copyright_notice: {
    meaning: "The game was taken down on a copyright (DMCA) notice.",
    contentRule: "copyright",
    fix: "If you own the work or may use it, send a counter-notice to dmca@zaisma.com; zaisma.com/legal/dmca says what to put in it.",
    hasOwnMessage: true,
  },
  image_rejected: {
    meaning: "A person at Zaisma didn't approve the image; the message says why.",
    contentRule: null,
    fix: "Send a different one with add_image. Covers and screenshots show the actual game, with no fake rewards and no characters or brands you don't own.",
    hasOwnMessage: true,
    isRulePicked: true,
  },
  details_rejected: {
    meaning: "A person at Zaisma didn't approve the new title or description; the message says why.",
    contentRule: null,
    fix: "Send new words with update_game; players see the old ones meanwhile.",
    hasOwnMessage: true,
    isRulePicked: true,
  },
} as const satisfies Record<string, ReviewCode>;
export type ReviewCodeName = keyof typeof REVIEW_CODES;

/**
 * Codes on scan findings that only Zaisma sees: notes for a person (severity info), and child-safety
 * signals, which are never described to the developer (they get needs_review).
 */
export const INTERNAL_FINDING_CODES = ["wallet_words", "svg_script", "outside_hosts", "antivirus_unavailable", "known_illegal_image", "image_matching_later", "ai_minors_sexualized"] as const;
export type FindingCode = ReviewCodeName | (typeof INTERNAL_FINDING_CODES)[number];

/** A person's or a report's decision, as stored (games, versions, game_images and audit_log .review_reason): JSON, snake_case. */
export interface ReviewReason {
  code: ReviewCodeName;
  /** What the developer reads: the code's meaning, or a person's own words for codes that have them. */
  message: string;
  content_rule: ContentRule | null;
}

/** A decision with no words of its own: the code's meaning and rule. */
export function reviewReason(code: ReviewCodeName, message?: string, contentRule?: ContentRule | null): ReviewReason {
  const known: ReviewCode = REVIEW_CODES[code];
  return { code, message: message?.trim() || known.meaning, content_rule: contentRule === undefined ? known.contentRule : contentRule };
}

/**
 * A person's decision, from what they picked and wrote. Child safety is never described to the
 * developer (telling them could warn someone abusing a child): they get the plain code alone.
 */
export function decidedReason(code: ReviewCodeName, contentRule: ContentRule | null, words: string): ReviewReason {
  if (contentRule === "child_safety") return { code, message: REVIEW_CODES[code].meaning, content_rule: null };
  return reviewReason(code, words, code === "copyright_notice" ? "copyright" : contentRule);
}

/** A review reason as the developer API answers it: { code, message, content_rule, fix }. */
export function reviewReasonAnswer(reason: ReviewReason): { code: ReviewCodeName; message: string; content_rule: ContentRule | null; fix: string } {
  const known: ReviewCode = REVIEW_CODES[reason.code] ?? REVIEW_CODES.needs_review;
  return { code: reason.code, message: known.hasOwnMessage ? reason.message : known.meaning, content_rule: reason.content_rule, fix: known.fix };
}

export const readReviewReason = (stored: string | null | undefined): ReviewReason | null => (stored ? (JSON.parse(stored) as ReviewReason) : null);
