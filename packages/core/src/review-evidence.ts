import { sha256Hex } from "./ids.ts";
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
  /**
   * Text a player types, by who reads it, never by route: shown_locally (only the typer sees it), checked_by_game
   * (the game compares it to a secret or a list and others see only the result), read_by_others (another player
   * reads it as written outside Zaisma's chat hosting, however it's entered: that's unfiltered chat),
   * sent_through_zaisma_chat (another player reads it, sent with room.chat or checked with canChat and checkChat)
   * and picked_phrases (whole phrases the developer wrote, chosen from a closed list).
   */
  player_text: ["shown_locally", "checked_by_game", "read_by_others", "sent_through_zaisma_chat", "picked_phrases"],
  /**
   * Code that tries to get around one of the beta's protections instead of just bumping into it, each a yes/no
   * test: page_outside_frame (reaches the page outside the game's frame by any route), peer_outside_relay (makes
   * a peer connection from a frame of its own or replaces the relay settings), link_without_tap (opens a site
   * with no tap by the player), link_built_from_pieces (a link assembled at runtime), address_built_from_pieces
   * (a host to connect to assembled at runtime).
   */
  protection_attempt: ["page_outside_frame", "peer_outside_relay", "link_without_tap", "link_built_from_pieces", "address_built_from_pieces"],
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
  /** Large reviews a day per developer, across all their games: a new game or a real change, read and judged. */
  maximumLargeReviewsPerDay: 5,
  /** Small reviews a day per developer, across all their games: versions whose reads called the reader model. */
  maximumSmallReviewsPerDay: 30,
  /** Share of the monthly review budget that sends Julius one email. */
  budgetAlertPct: 80,
  /** A changed file is compared with its earlier text in content-defined pieces of about this size (contentPieces). */
  changedPieceAverageCharacterCount: 8_000,
  changedPieceMinimumCharacterCount: 2_000,
  changedPieceMaximumCharacterCount: 32_000,
  /** Characters read on each side of a changed region, so the reader sees what the change sits in. */
  changedRegionContextCharacterCount: 2_000,
  /** Past this share of a file changed, it's read whole: regions and context would cost about as much. */
  wholeFileReadChangedShare: 0.5,
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

/** Characters the rolling hash looks back over: a boundary depends only on the text just before it. */
const PIECE_WINDOW_CHARACTER_COUNT = 48;
const PIECE_HASH_MULTIPLIER_NUMBER = 0x01000193;
/** The multiplier to the window's length, for taking the character that leaves the window out of the hash. */
const PIECE_HASH_LEAVING_MULTIPLIER_NUMBER = Array.from({ length: PIECE_WINDOW_CHARACTER_COUNT }).reduce<number>((powerNumber) => Math.imul(powerNumber, PIECE_HASH_MULTIPLIER_NUMBER), 1);

/** Spreads the rolling hash's bits, so its remainder doesn't lean on the characters' low bits. */
const mixed = (hashNumber: number): number => {
  let mixedNumber = Math.imul(hashNumber ^ (hashNumber >>> 16), 0x85ebca6b);
  mixedNumber = Math.imul(mixedNumber ^ (mixedNumber >>> 13), 0xc2b2ae35);
  return (mixedNumber ^ (mixedNumber >>> 16)) >>> 0;
};

/** A stretch of a text: from startIndex up to, not including, endIndex. */
export interface TextRegion {
  startIndex: number;
  endIndex: number;
}

/**
 * A text cut into pieces at content-defined boundaries: a boundary falls where a rolling hash of the last 48
 * characters hits a set remainder, within changedPieceMinimumCharacterCount and changedPieceMaximumCharacterCount.
 * The boundaries depend on the text around them, not on where they are, so an edit moves only the pieces
 * around it, even in a minified bundle that's one line. Each piece has its SHA-256.
 */
export async function contentPieces(text: string): Promise<(TextRegion & { sha256: string })[]> {
  const { changedPieceAverageCharacterCount: averageCharacterCount, changedPieceMinimumCharacterCount: minimumCharacterCount, changedPieceMaximumCharacterCount: maximumCharacterCount } = REVIEW_LIMITS;
  const endIndexes: number[] = [];
  let startIndex = 0;
  let hashNumber = 0;
  for (let index = 0; index < text.length; index++) {
    hashNumber = (Math.imul(hashNumber, PIECE_HASH_MULTIPLIER_NUMBER) + text.charCodeAt(index)) | 0;
    if (index >= PIECE_WINDOW_CHARACTER_COUNT) hashNumber = (hashNumber - Math.imul(text.charCodeAt(index - PIECE_WINDOW_CHARACTER_COUNT), PIECE_HASH_LEAVING_MULTIPLIER_NUMBER)) | 0;
    const pieceCharacterCount = index + 1 - startIndex;
    if (pieceCharacterCount >= maximumCharacterCount || (pieceCharacterCount >= minimumCharacterCount && mixed(hashNumber) % averageCharacterCount === 0)) {
      endIndexes.push(index + 1);
      startIndex = index + 1;
    }
  }
  if (startIndex < text.length) endIndexes.push(text.length);
  const encoder = new TextEncoder();
  return Promise.all(
    endIndexes.map(async (endIndex, pieceIndex) => {
      const pieceStartIndex = pieceIndex === 0 ? 0 : endIndexes[pieceIndex - 1]!;
      return { startIndex: pieceStartIndex, endIndex, sha256: await sha256Hex(encoder.encode(text.slice(pieceStartIndex, endIndex))) };
    }),
  );
}

/**
 * Where a text changed since its earlier text: its pieces that the earlier text doesn't have, next ones joined,
 * each widened by changedRegionContextCharacterCount on both sides, and overlaps joined. In order; none when
 * nothing changed.
 */
export async function changedRegions(earlierText: string, text: string): Promise<TextRegion[]> {
  const earlierShas = new Set((await contentPieces(earlierText)).map((piece) => piece.sha256));
  const contextCharacterCount = REVIEW_LIMITS.changedRegionContextCharacterCount;
  const regions: TextRegion[] = [];
  for (const piece of await contentPieces(text)) {
    if (earlierShas.has(piece.sha256)) continue;
    const startIndex = Math.max(0, piece.startIndex - contextCharacterCount);
    const endIndex = Math.min(text.length, piece.endIndex + contextCharacterCount);
    const last = regions.at(-1);
    if (last && startIndex <= last.endIndex) last.endIndex = Math.max(last.endIndex, endIndex);
    else regions.push({ startIndex, endIndex });
  }
  return regions;
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

/**
 * Links and addresses compare by kind alone: the sandbox, the security headers and the link check already
 * cover them, so a new one never costs a judged review (and swapping a plain window.open for a registered
 * link, the fix for a note, adds a new subject).
 */
const COMPARED_BY_KIND = new Set<EvidenceItem["kind"]>(["opens_link", "connects_to"]);

export const itemKey = (evidenceItem: Pick<EvidenceItem, "kind" | "subject">) => (COMPARED_BY_KIND.has(evidenceItem.kind) ? evidenceItem.kind : `${evidenceItem.kind}\n${evidenceItem.subject.toLowerCase()}`);

/** The same item in two versions' evidence: the same kind, subject, path and quote. */
export const isSameItem = (first: Pick<EvidenceItem, "kind" | "subject" | "path" | "quote">, second: Pick<EvidenceItem, "kind" | "subject" | "path" | "quote">): boolean =>
  first.kind === second.kind && first.subject === second.subject && first.path === second.path && first.quote === second.quote;

/** Findings a fix's review always keeps, new in the evidence or not: the review's floor, never its judgement calls. */
export const NEVER_NARROWED_FINDING_CODES: readonly string[] = ["ai_minors_sexualized", "ai_malware", "ai_phishing_or_scam"];

/** What a fixable hold stands on: a dodged protection, typed text others read as written, or personal details asked of players. */
export const isFixableProblem = (evidenceItem: Pick<EvidenceItem, "kind" | "subject">): boolean =>
  evidenceItem.kind === "protection_attempt" || evidenceItem.kind === "asks_player" || (evidenceItem.kind === "player_text" && evidenceItem.subject === "read_by_others");

/** The holds a new version can fix by removing what they stand on, and so be reviewed by comparing its evidence alone. */
export const FIXABLE_FINDING_CODES: readonly string[] = ["ai_protection_dodged", "ai_free_text_chat", "ai_data_collection", "top_navigation", "relay_bypass", "password_field", "external_form", "packed_code"];

/**
 * A tweak: every kind and subject in the new evidence was already in the last judged version's. When that
 * version was held (for fixable findings only), the new evidence must also be free of what those holds stand on.
 */
export function isTweak(newItems: EvidenceItem[], judgedItems: EvidenceItem[], isJudgedHeld = false): boolean {
  if (isJudgedHeld && newItems.some(isFixableProblem)) return false;
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
