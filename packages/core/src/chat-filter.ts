import type { ChatBlockReason } from "./text-filter.ts";

/**
 * The chat filter's limits and the words a sender sees (docs/DECISIONS.md, "The text filter catches what
 * matters and leaves the rest alone"). The rules are checkChatText (text-filter.ts); the rooms Worker
 * applies them (apps/rooms/src/chat-filter.ts).
 */
export const CHAT_FILTER_LIMITS = {
  /** The longest message checked, in characters: the whole text is checked, and a longer one is refused (too_long), never cut. */
  maximumMessageCharacterCount: 2000,
  /** The sender's last messages sent along with each one, so pieces of a phone number are caught. */
  recentTextCount: 5,
  recentTextDurationMs: 120_000,
  /** Contact or personal details stopped toward a teen this often within a day pause the sender's chat. */
  repeatBlockCount: 5,
  repeatBlockWindowMs: 86_400_000,
  repeatPauseMs: 3_600_000,
  /** How long a confirmed review is kept for the report. */
  reviewKeptMs: 31_536_000_000,
} as const;

/** Why the filter stopped a message: what checkChatText blocks, a paused sender, one too long to check, or (own servers' chat check) players who may not chat with each other. */
export type ChatFilterReason = ChatBlockReason | "chat_paused" | "too_long" | "not_allowed_to_chat";

/** The words the sender sees for each reason. None mentions age or the other player. */
export const CHAT_BLOCK_MESSAGES: Record<ChatFilterReason, string> = {
  contact_details: "Contact details can't be sent here.",
  personal_details: "Personal details can't be sent here.",
  sexual: "That can't be sent here.",
  chat_paused: "Your chat is paused for now.",
  too_long: "That message is too long to send.",
  not_allowed_to_chat: "Chat isn't open for this message.",
};

/** Why an account's chat is stopped (accounts.chat_stopped_reason). */
export type ChatStoppedReason = "paused_for_repeats" | "in_review" | "removed";

/** Whether an account's chat is stopped now: a pause for repeats ends by itself. */
export function isChatStopped(account: { chat_stopped_reason: ChatStoppedReason | null; chat_stopped_until_ms: number | null }, nowMs = Date.now()): boolean {
  if (!account.chat_stopped_reason) return false;
  return account.chat_stopped_reason !== "paused_for_repeats" || (account.chat_stopped_until_ms ?? 0) > nowMs;
}

/** pending: waiting for the AI's review. needs_person: the AI was unsure, or it came from a developer's own server. confirmed: chat removed, kept for the report. */
export type ChatReviewStatus = "pending" | "needs_person" | "confirmed";
export const CHAT_REVIEW_STATUSES: readonly ChatReviewStatus[] = ["pending", "needs_person", "confirmed"];

/** Where a stopped message came from: Zaisma's rooms, or a developer's own server through checkChat. */
export type ChatSource = "rooms" | "own_server";

/** A message the filter stopped and kept for review (the chat_reviews table). */
export interface ChatReview {
  id: string;
  sender_account_id: string | null;
  game_id: string;
  source: ChatSource;
  text: string;
  recent_texts_json: string;
  chat_review_status: ChatReviewStatus;
  ai_reason: string | null;
  check_attempt_count: number;
  created_at_ms: number;
  decided_at_ms: number | null;
  reported_at_ms: number | null;
  kept_until_ms: number | null;
}
