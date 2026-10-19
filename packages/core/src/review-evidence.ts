import { REVIEWED_CONTENT_RULES } from "./review.ts";

/**
 * The AI review's evidence ("The AI review gathers evidence first, then one stronger model judges." in
 * docs/DECISIONS.md): Zaisma's own checks and the readers list what a version's files do as items of a
 * fixed kind and subject, each pointing at an exact quote, and one judge decides from that list alone.
 * Stored in the scan report (ScanReport.evidence) for Zaisma's eyes; developers get findings, as before.
 */

/**
 * Every kind of evidence and the closed list of subjects it takes; null means the subject is a host or a
 * link's name, which no list can hold.
 */
export const EVIDENCE_KINDS = {
  /** What the game connects to or loads from: the subject is the host. */
  connects_to: null,
  /** A site the game opens: the registered link's name, or the host of a raw URL. */
  opens_link: null,
  /** How text typed by one player reaches another. */
  player_text: ["zaisma_chat", "own_server", "peer_connection", "shown_locally", "unknown"],
  /** A personal detail the game asks players for. */
  asks_player: ["email", "real_name", "birthday", "location", "phone", "password", "other_personal_detail"],
  /**
   * Content near a rule, by the rule's name; lifelike_gore, which plays only in games for 16 and up; and
   * allowed_content, what ALLOWED_CONTENT covers, recorded so a tweak can be compared.
   */
  content: [...REVIEWED_CONTENT_RULES, "lifelike_gore", "allowed_content"],
  /** Code that hides what it does. */
  hidden_code: ["eval_of_encoded", "obfuscated", "downloads_code"],
  /** Text in the game that addresses the reviewer. */
  talks_to_reviewer: ["present"],
} as const;
export type EvidenceKind = keyof typeof EVIDENCE_KINDS;

/** One thing the review found in a version's files, stored JSON (snake_case). */
export interface EvidenceItem {
  kind: EvidenceKind;
  /** From the kind's list in EVIDENCE_KINDS, or a host or link name for connects_to and opens_link. */
  subject: string;
  /** One plain sentence: what the file does. */
  detail: string;
  path: string;
  /** An exact piece of the file, at most 300 characters; "" for a picture. */
  quote: string;
  file_sha256: string;
  /** Zaisma's own rule-based checks, or a reader model. */
  source: "check" | "reader";
}

export const REVIEW_LIMITS = {
  /** About 60k tokens: under Haiku 5.5's price step at 100k tokens of prompt. */
  readerChunkCharacterCount: 240_000,
  /** Characters each chunk repeats from the one before, so nothing is cut in half unseen. */
  readerChunkOverlapCharacterCount: 2_000,
  /** About 19 MB of text: past it, a person looks (too_much_code). */
  maximumReaderChunkCount: 80,
  /** Reader calls at a time. */
  maximumParallelReaderCount: 6,
  /** The largest pictures between 2 KB and 1 MB are read, up to this many. */
  maximumReadImageCount: 200,
  readImageCountPerCall: 10,
  minimumReadImageSizeBytes: 2048,
  maximumReadImageSizeBytes: 1_048_576,
  /** Pictures the judge sees: only ones a reader flagged. */
  maximumJudgedImageCount: 8,
  maximumEvidenceItemCount: 400,
  maximumQuoteCharacterCount: 300,
  maximumJudgedReviewsPerDay: 5,
  /** Share of the monthly review budget that sends Julius one email. */
  budgetAlertPct: 80,
} as const;

/** Every piece of a text the readers see: chunks of readerChunkCharacterCount, each overlapping the one before. */
export function chunkText(text: string): string[] {
  const { readerChunkCharacterCount: chunkCharacterCount, readerChunkOverlapCharacterCount: overlapCharacterCount } = REVIEW_LIMITS;
  if (text.length <= chunkCharacterCount) return [text];
  const pieces: string[] = [];
  for (let startIndex = 0; startIndex < text.length; startIndex += chunkCharacterCount - overlapCharacterCount) {
    pieces.push(text.slice(startIndex, startIndex + chunkCharacterCount));
    if (startIndex + chunkCharacterCount >= text.length) break;
  }
  return pieces;
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * The items whose quotes really are in their files, so a reader that makes a line up can't hold an honest
 * game. Whitespace is compared loosely, as a re-check does (triage.ts). Check items are kept as they are; a
 * reader item about a picture (a path with no text) needs no quote, and one about code needs a real one.
 */
export function keepQuotedItems(items: EvidenceItem[], fileTextByPath: Map<string, string>): EvidenceItem[] {
  const squashedByPath = new Map<string, string>();
  return items.filter((evidenceItem) => {
    if (evidenceItem.source === "check") return true;
    const text = fileTextByPath.get(evidenceItem.path);
    if (text === undefined) return evidenceItem.quote === "";
    const quote = squash(evidenceItem.quote);
    if (quote.length === 0) return false;
    if (!squashedByPath.has(evidenceItem.path)) squashedByPath.set(evidenceItem.path, squash(text));
    return squashedByPath.get(evidenceItem.path)!.includes(quote);
  });
}

const itemKey = (evidenceItem: Pick<EvidenceItem, "kind" | "subject">) => `${evidenceItem.kind}\n${evidenceItem.subject.toLowerCase()}`;

/** A tweak: every kind and subject in the new evidence was already in the last judged version's. */
export function isTweak(newItems: EvidenceItem[], judgedItems: EvidenceItem[]): boolean {
  const judged = new Set(judgedItems.map(itemKey));
  return newItems.every((evidenceItem) => judged.has(itemKey(evidenceItem)));
}

/** Prices in US cents per million tokens. Cache writes cost a quarter more than input. */
export const MODEL_PRICES_PER_MILLION_TOKENS: Record<string, { inputCents: number; outputCents: number; cacheReadCents: number }> = {
  "claude-haiku-5-5": { inputCents: 10, outputCents: 50, cacheReadCents: 1 },
  "claude-sonnet-5-5": { inputCents: 200, outputCents: 1000, cacheReadCents: 20 },
  "claude-opus-5-5": { inputCents: 400, outputCents: 2000, cacheReadCents: 20 },
};

/** What one model call used, in tokens. */
export interface ModelUsage {
  inputTokenCount: number;
  outputTokenCount: number;
  cacheReadTokenCount: number;
  cacheWriteTokenCount: number;
}

/** What a call cost in US cents. A model not in the table is priced as Opus, so a new one never looks cheap. */
export function reviewCostCents(model: string, usage: ModelUsage): number {
  const prices = MODEL_PRICES_PER_MILLION_TOKENS[model] ?? MODEL_PRICES_PER_MILLION_TOKENS["claude-opus-5-5"]!;
  return (
    (usage.inputTokenCount * prices.inputCents + usage.cacheWriteTokenCount * prices.inputCents * 1.25 + usage.cacheReadTokenCount * prices.cacheReadCents + usage.outputTokenCount * prices.outputCents) /
    1_000_000
  );
}
