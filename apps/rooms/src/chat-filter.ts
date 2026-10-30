import { CHAT_BLOCK_MESSAGES, CHAT_FILTER_LIMITS, checkChatText, isChatStopped, newId, tidyText, type Account, type ChatFilterReason, type ChatSource } from "@zaisma/core";
import type { UnclearChatCheck } from "../../site/src/chat-check.ts";
import type { Env } from "./index.ts";

/**
 * The chat filter (docs/DECISIONS.md, "The text filter catches what matters and leaves the rest alone"):
 * the one place its rules are applied to a message, for Zaisma's rooms and for developers' own servers
 * (POST /v1/chat/check). Every message to or from an under-18 account is checked here before anyone sees
 * it: the rules first (checkChatText), then the site's AI (CHAT_CHECK) for what they can't tell and for
 * every message from an adult to a teen. The AI is a narrow second look: when it can't check (down, or its
 * budget used up), the message goes after the rules, as when in doubt. Swearing and slurs are only
 * flagged, and the game decides. Between adults the floor stays out of the way unless the game turned it
 * on (isAdultFilterEnabled), when the same checks run and each AI look counts on its meter.
 *
 * Nothing about the message is kept, except a sexual one from an adult to a teen, kept for the AI's review
 * (chat_reviews). Contact and personal details sent toward teens are counted, never kept: the fifth in a day
 * pauses the sender's chat for an hour.
 */

export interface ChatMessage {
  gameId: string;
  text: string;
  /** Null for a sender from outside Zaisma, on a game's own server: a player with no pass, of unknown age. */
  senderPlayerId: string | null;
  /** The receivers with a pass; hasOutsideReceiver says whether players from outside Zaisma would read it too. */
  receiverPlayerIds: string[];
  hasOutsideReceiver?: boolean;
  /** The sender's last messages, oldest first: up to CHAT_FILTER_LIMITS.recentTextCount from the last recentTextDurationMs. */
  recentTexts: string[];
  source: ChatSource;
  /** Check chat between adults too: the game server's adultChatFilterEnabled, or checkChat's isAdultFilterEnabled. */
  isAdultFilterEnabled: boolean;
}

export interface ChatFilterAnswer {
  isAllowed: boolean;
  reason: ChatFilterReason | null;
  /** The words the sender sees when it's stopped. */
  message: string | null;
  hasSwearing: boolean;
  hasSlur: boolean;
}

type ChatFlags = Pick<ChatFilterAnswer, "hasSwearing" | "hasSlur">;
const NO_FLAGS: ChatFlags = { hasSwearing: false, hasSlur: false };

type ChatAccount = Pick<Account, "id" | "player_id" | "age_band" | "chat_stopped_reason" | "chat_stopped_until_ms" | "chat_repeat_block_count" | "chat_repeat_window_started_at_ms">;

const allowed = (flags: ChatFlags): ChatFilterAnswer => ({ isAllowed: true, reason: null, message: null, ...flags });
const stopped = (reason: ChatFilterReason, flags: ChatFlags = NO_FLAGS): ChatFilterAnswer => ({ isAllowed: false, reason, message: CHAT_BLOCK_MESSAGES[reason], hasSwearing: flags.hasSwearing, hasSlur: flags.hasSlur });
const today = (nowMs: number) => new Date(nowMs).toISOString().slice(0, 10);

/** One verdict per message for every receiver, so it never tells a game which of them is under 18. */
export async function filterChatMessage(env: Env, chat: ChatMessage, nowMs = Date.now()): Promise<ChatFilterAnswer> {
  // The whole message is checked or none of it: a longer one is refused, never cut.
  if (String(chat.text ?? "").length > CHAT_FILTER_LIMITS.maximumMessageCharacterCount) return stopped("too_long");
  const text = tidyText(chat.text, CHAT_FILTER_LIMITS.maximumMessageCharacterCount);
  const recentTexts = chat.recentTexts.slice(-CHAT_FILTER_LIMITS.recentTextCount).map((recentText) => tidyText(recentText, CHAT_FILTER_LIMITS.maximumMessageCharacterCount));
  const playerIds = [...new Set([chat.senderPlayerId, ...chat.receiverPlayerIds].filter((playerId): playerId is string => playerId !== null))];
  const { results } = await env.DB.prepare(
    "SELECT id, player_id, age_band, chat_stopped_reason, chat_stopped_until_ms, chat_repeat_block_count, chat_repeat_window_started_at_ms FROM accounts WHERE player_id IN (SELECT value FROM json_each(?))",
  )
    .bind(JSON.stringify(playerIds))
    .all<ChatAccount>();
  const byPlayerId = new Map(results.map((account) => [account.player_id, account]));
  const sender = chat.senderPlayerId === null ? null : byPlayerId.get(chat.senderPlayerId);
  // Guests have no chat (canChat keeps them out; this is the backstop), and neither does a deleted account.
  if (sender === undefined || playerIds.some((playerId) => !byPlayerId.has(playerId))) return stopped("chat_paused");
  if (sender && isChatStopped(sender, nowMs)) return stopped("chat_paused");
  if (!text) return allowed(NO_FLAGS);

  const receivers = chat.receiverPlayerIds.map((playerId) => byPlayerId.get(playerId)!).filter((account) => account.id !== sender?.id);
  const isSenderMinor = sender !== null && sender.age_band !== "18+";
  const hasMinorReceiver = receivers.some((account) => account.age_band !== "18+");
  // A player from outside Zaisma is a stranger of unknown age: never in chat with an under-18 account, either way.
  // Between them and adults it's checked as between adults.
  const hasOutsidePlayer = sender === null || chat.hasOutsideReceiver === true;
  if (hasOutsidePlayer && (isSenderMinor || hasMinorReceiver)) return stopped("not_allowed_to_chat");
  const rules = checkChatText(text, recentTexts);
  const flags: ChatFlags = { hasSwearing: rules.hasSwearing, hasSlur: rules.hasSlur };
  // Between adults the game decides: only flagged, unless it turned the filter on for them too.
  const isBetweenAdults = !isSenderMinor && !hasMinorReceiver;
  if (isBetweenAdults && !chat.isAdultFilterEnabled) return allowed(flags);

  let reason = rules.verdict === "blocked" ? rules.reason : null;
  // Chat stays in the sender's chat group, so this only comes from an own server that skipped canChat (answerChatCheck stops those first): the backstop.
  const isAdultToMinor = sender !== null && !isSenderMinor && hasMinorReceiver;
  if (!reason && (rules.verdict === "unclear" || isAdultToMinor)) {
    let checked: UnclearChatCheck;
    try {
      checked = env.CHAT_CHECK ? await env.CHAT_CHECK.checkUnclear({ text, recentTexts, isAdultToMinor }) : { verdict: "unchecked" };
    } catch (error) {
      console.error("chat check unavailable", error);
      checked = { verdict: "unchecked" };
    }
    // A narrow second look: one that can't check sends the message after the rules, as when in doubt (Julius, Oct 26, 2026).
    if (checked.verdict === "blocked") reason = checked.reason;
    // The game turned the filter on between adults: each look the AI made is on its meter.
    if (isBetweenAdults && checked.verdict !== "unchecked") await countAdultChatCheck(env, chat.gameId, nowMs);
  }
  if (!reason) return allowed(flags);

  if (sender && hasMinorReceiver && (reason === "contact_details" || reason === "personal_details")) await countRepeatBlock(env, sender, nowMs);
  if (sender && isAdultToMinor && reason === "sexual") await keepForReview(env, sender, chat, text, recentTexts, nowMs);
  return stopped(reason, flags);
}

/** One AI check of chat between adults, for the game's hosting meter (adult_chat_checks). */
async function countAdultChatCheck(env: Env, gameId: string, nowMs: number): Promise<void> {
  await env.DB.prepare("INSERT INTO room_usage (game_id, date, adult_chat_check_count) VALUES (?, ?, 1) ON CONFLICT(game_id, date) DO UPDATE SET adult_chat_check_count = adult_chat_check_count + 1").bind(gameId, today(nowMs)).run();
}

/** Counts a block toward a teen, keeping no text: the fifth within a day pauses the sender's chat for an hour. */
async function countRepeatBlock(env: Env, sender: ChatAccount, nowMs: number): Promise<void> {
  const isNewWindow = sender.chat_repeat_window_started_at_ms === null || nowMs - sender.chat_repeat_window_started_at_ms > CHAT_FILTER_LIMITS.repeatBlockWindowMs;
  const blockCount = (isNewWindow ? 0 : sender.chat_repeat_block_count) + 1;
  if (blockCount >= CHAT_FILTER_LIMITS.repeatBlockCount) {
    // Only a sender whose chat isn't stopped gets here, so a longer stop (in review, removed) is never shortened.
    await env.DB.prepare("UPDATE accounts SET chat_repeat_block_count = 0, chat_repeat_window_started_at_ms = NULL, chat_stopped_reason = 'paused_for_repeats', chat_stopped_until_ms = ? WHERE id = ? AND (chat_stopped_reason IS NULL OR chat_stopped_reason = 'paused_for_repeats')")
      .bind(nowMs + CHAT_FILTER_LIMITS.repeatPauseMs, sender.id)
      .run();
    return;
  }
  await env.DB.prepare("UPDATE accounts SET chat_repeat_block_count = ?, chat_repeat_window_started_at_ms = ? WHERE id = ?")
    .bind(blockCount, isNewWindow ? nowMs : sender.chat_repeat_window_started_at_ms, sender.id)
    .run();
}

/**
 * Keeps a sexual message from an adult to a teen for the AI's review (apps/site/src/chat-review.ts) and
 * pauses the sender's chat until it's done. One from a developer's own server is kept but pauses nothing:
 * the server could make a message up to frame a player, so only a person acts on it.
 */
async function keepForReview(env: Env, sender: ChatAccount, chat: ChatMessage, text: string, recentTexts: string[], nowMs: number): Promise<void> {
  const keep = env.DB.prepare("INSERT INTO chat_reviews (id, sender_account_id, game_id, source, text, recent_texts_json, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(newId("chat_review"), sender.id, chat.gameId, chat.source, text, JSON.stringify(recentTexts), nowMs);
  if (chat.source === "own_server") {
    await keep.run();
    return;
  }
  await env.DB.batch([keep, env.DB.prepare("UPDATE accounts SET chat_stopped_reason = 'in_review', chat_stopped_until_ms = NULL WHERE id = ? AND (chat_stopped_reason IS NULL OR chat_stopped_reason = 'paused_for_repeats')").bind(sender.id)]);
}
