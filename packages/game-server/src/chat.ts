/**
 * Zaisma's chat filter for your own server (docs/DECISIONS.md, "The text filter catches what matters and
 * leaves the rest alone"). Every chat message to or from an under-18 account is checked on Zaisma's side:
 * contact details in any disguise, moving to another app or meeting up, personal details and sexual
 * content are stopped. Swearing and slurs are only flagged (hasSwearing, hasSlur): blocking them is your
 * call. Between adults it only flags, unless you turn the filter on for them too (isAdultFilterEnabled).
 * The answer is one verdict for the whole message, never per receiver, so it never says who's under 18.
 *
 * checkChat sends the players' passes (as your server received them) and the sender's last few messages to
 * Zaisma (POST <issuer>/v1/chat/check), so a phone number sent a few digits at a time is caught too.
 *
 * A player your server let in from outside Zaisma (kind outside_zaisma) has no pass: give null in their place.
 * Zaisma counts them as strangers of unknown age, so a message between one and an under-18 account is stopped
 * (not_allowed_to_chat); between them and adults it's checked as between adults. A message among players from
 * outside Zaisma only is allowed without asking Zaisma: none of its players is in it, so your own rules apply.
 *
 * It's for your own server only. In Zaisma rooms the room filters the chat it delivers itself, so a game
 * server running there never sees passes, and checkChat throws a ChatCheckError (own_server_only).
 */

import { OutsideCallError } from "./outside-calls.ts";

/**
 * Why a message was stopped. The same reasons as Zaisma.checkChat, plus chat_paused, not_allowed_to_chat and
 * unchecked (Zaisma couldn't be reached). slur is v1's and no longer given: slurs are flagged (hasSlur), never stopped.
 */
export type ChatCheckReason = "contact_details" | "personal_details" | "slur" | "sexual" | "chat_paused" | "unchecked" | "too_long" | "not_allowed_to_chat";

export interface ChatCheck {
  /** Whether to deliver it. */
  isAllowed: boolean;
  /**
   * Why not; null when it's allowed. chat_paused: the sender's chat is paused or removed. unchecked: your
   * server couldn't reach Zaisma, so don't deliver it (try again in a moment). too_long: over 2000 characters.
   * not_allowed_to_chat: canChat says the sender and a receiver may not chat (Zaisma checks it too).
   */
  reason: ChatCheckReason | null;
  /** The words to show the sender when it's stopped (never mentions age or the other player); null when it's allowed. */
  message: string | null;
  /** Whether it swears. Zaisma allows it; block it yourself if your game doesn't. */
  hasSwearing: boolean;
  /** Whether it has a slur. Zaisma allows it too, so your game and its moderators decide. */
  hasSlur: boolean;
}

export interface ChatCheckOptions {
  /** The message. */
  text: string;
  /** The sender's player pass, the signed token as your server received it; null for a player from outside Zaisma. */
  senderPass: string | null;
  /** The passes of everyone it would reach, up to 50; null for each player from outside Zaisma. */
  receiverPasses: (string | null)[];
  /** Check chat between adults too, as for under-18s; each message Zaisma's AI looks at counts on your hosting meter. False by default. */
  isAdultFilterEnabled?: boolean;
}

/** Chat in rooms (room.chat), for both Zaisma's rooms and your own server's runner: past any human's typing, so it only stops floods. */
export const CHAT_ROOM_LIMITS = {
  /** Chat messages one player may send in any chatWindowDurationMs; past it, chat_too_fast. */
  maximumChatMessageCount: 20,
  chatWindowDurationMs: 10_000,
} as const;

export const CHAT_CHECK_LIMITS = {
  /** The longest message checked, in characters: the whole text is checked, and a longer one is refused (too_long), never cut. */
  maximumMessageCharacterCount: 2000,
  maximumReceiverCount: 50,
  /** The sender's last messages sent along with each one, from the last 2 minutes. */
  recentTextCount: 5,
  recentTextDurationMs: 120_000,
  /** Senders whose last messages this server keeps in memory. */
  maximumSenderCount: 10_000,
  /** How long checkChat waits for Zaisma before answering unchecked. */
  checkTimeoutMs: 5_000,
} as const;

/** checkChat called where it can't run, with what to do instead (like the developer API's errors, docs/NAMING.md). */
export class ChatCheckError extends Error {
  readonly code = "own_server_only";
  readonly fix: string;
  constructor(message: string, fix: string) {
    super(`${message} ${fix} (own_server_only)`);
    this.name = "ChatCheckError";
    this.fix = fix;
  }
}

const UNCHECKED: ChatCheck = { isAllowed: false, reason: "unchecked", message: "This message couldn't be checked. Try again in a moment.", hasSwearing: false, hasSlur: false };
const TOO_LONG: ChatCheck = { isAllowed: false, reason: "too_long", message: "That message is too long to send.", hasSwearing: false, hasSlur: false };
const REASONS: readonly string[] = ["contact_details", "personal_details", "sexual", "chat_paused", "unchecked", "too_long", "not_allowed_to_chat"];

/** Each sender's last messages, by the sender's pass's player ID: only in this process's memory. */
const recentBySender = new Map<string, { text: string; sentAtMs: number }[]>();

/** The claims of a pass, unchecked: Zaisma checks the signature. Only to find whose it is and where it's from. */
function readClaims(pass: string): { sub?: unknown; iss?: unknown; aud?: unknown } {
  try {
    const payload = pass.split(".")[1] ?? "";
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=")));
  } catch {
    return {};
  }
}

/** Zaisma's rooms, or a local preview of Zaisma: never anywhere a made-up pass could send players' messages. */
function isZaismaIssuer(issuer: unknown): issuer is string {
  if (issuer === "https://rooms.zaisma.com") return true;
  return typeof issuer === "string" && /^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}$/.test(issuer);
}

function rememberText(senderPlayerId: string, text: string, nowMs: number): void {
  const recent = (recentBySender.get(senderPlayerId) ?? []).filter((sent) => nowMs - sent.sentAtMs < CHAT_CHECK_LIMITS.recentTextDurationMs);
  recent.push({ text, sentAtMs: nowMs });
  recentBySender.delete(senderPlayerId);
  // The oldest sender goes first when the map is full.
  if (recentBySender.size >= CHAT_CHECK_LIMITS.maximumSenderCount) recentBySender.delete(recentBySender.keys().next().value!);
  recentBySender.set(senderPlayerId, recent.slice(-CHAT_CHECK_LIMITS.recentTextCount));
}

/**
 * Check one chat message with Zaisma's filter. Call it on every chat message your server delivers, after
 * canChat says the players may chat, and deliver it only when isAllowed (Zaisma applies canChat's rule
 * too, so a message to anyone who may not chat is stopped). It's free, except the checks of chat between
 * adults when isAdultFilterEnabled. When Zaisma can't be reached it answers unchecked: don't deliver the message.
 * The runner (zaisma-game-server) does all this for room.chat in its rooms.
 *
 *   const check = await checkChat({ text, senderPass, receiverPasses: [receiverPass] });
 *   if (!check.isAllowed || check.hasSwearing) return reply(sender, check.message ?? "No swearing here.");
 */
export async function checkChat({ text, senderPass, receiverPasses }: ChatCheckOptions): Promise<ChatCheck> {
  // Read apart from the destructuring, which is v1's signature as it's locked (test/contracts).
  const isAdultFilterEnabled = (arguments[0] as ChatCheckOptions | undefined)?.isAdultFilterEnabled === true;
  if (!Array.isArray(receiverPasses) || !receiverPasses.every((pass) => pass === null || typeof pass === "string") || !(senderPass === null || typeof senderPass === "string")) return UNCHECKED;
  const message = String(text ?? "");
  if (message.length > CHAT_CHECK_LIMITS.maximumMessageCharacterCount) return TOO_LONG;
  // Among players from outside Zaisma only: no Zaisma player is in it, so the server's own rules apply, and Zaisma never hears of it.
  const firstPass = [senderPass, ...receiverPasses].find((pass): pass is string => typeof pass === "string");
  if (firstPass === undefined) return { isAllowed: true, reason: null, message: null, hasSwearing: false, hasSlur: false };
  // Where to ask comes from a pass, the sender's when they have one: they all come from the same issuer for the same game.
  const claims = readClaims(firstPass);
  const senderClaims = senderPass === null ? null : readClaims(senderPass);
  if (typeof claims.sub !== "string" || !isZaismaIssuer(claims.iss) || (senderClaims && typeof senderClaims.sub !== "string")) return UNCHECKED;
  const nowMs = Date.now();
  // A sender from outside Zaisma has no player ID Zaisma knows, so their last messages aren't sent along.
  const senderPlayerId = senderClaims ? (senderClaims.sub as string) : null;
  const recentTexts = senderPlayerId ? (recentBySender.get(senderPlayerId) ?? []).filter((sent) => nowMs - sent.sentAtMs < CHAT_CHECK_LIMITS.recentTextDurationMs).map((sent) => sent.text) : [];
  if (senderPlayerId) rememberText(senderPlayerId, message, nowMs);
  try {
    const response = await fetch(`${claims.iss}/v1/chat/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameSlug: claims.aud, senderPass, receiverPasses: receiverPasses.slice(0, CHAT_CHECK_LIMITS.maximumReceiverCount), text: message, recentTexts, isAdultFilterEnabled }),
      signal: AbortSignal.timeout(CHAT_CHECK_LIMITS.checkTimeoutMs),
    });
    if (!response.ok) return UNCHECKED;
    const answer = (await response.json()) as Partial<ChatCheck>;
    if (typeof answer.isAllowed !== "boolean") return UNCHECKED;
    const reason = typeof answer.reason === "string" && REASONS.includes(answer.reason) ? (answer.reason as ChatCheckReason) : null;
    return { isAllowed: answer.isAllowed, reason, message: typeof answer.message === "string" ? answer.message : null, hasSwearing: answer.hasSwearing === true, hasSlur: answer.hasSlur === true };
  } catch (error) {
    // In Zaisma rooms the gateway refuses the call to Zaisma's own address: checkChat is for a game server on your own server.
    if (error instanceof OutsideCallError && ["unreachable_host", "not_https", "host_not_allowed"].includes(error.code)) {
      throw new ChatCheckError(
        "checkChat is for a game server on your own server. In Zaisma rooms the room runs Zaisma's chat filter on the chat it delivers.",
        "In Zaisma rooms, send chat with room.chat in the game; the room filters it.",
      );
    }
    return UNCHECKED;
  }
}
