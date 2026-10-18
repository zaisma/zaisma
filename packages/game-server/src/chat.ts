/**
 * Zaisma's chat filter for your own server (docs/DECISIONS.md, "The text filter catches what matters and
 * leaves the rest alone"). Every chat message to or from an under-18 account is checked on Zaisma's side:
 * contact details in any disguise, moving to another app or meeting up, personal details, slurs and
 * sexual content are stopped. Swearing is only flagged (hasSwearing): blocking it is your call. The answer
 * is one verdict for the whole message, never per receiver, so it never says who's under 18.
 *
 * checkChat sends the players' passes (as your server received them) and the sender's last few messages to
 * Zaisma (POST <issuer>/v1/chat/check), so a phone number sent a few digits at a time is caught too.
 *
 * It's for your own server only. In Zaisma rooms the room filters the chat it delivers itself, so a game
 * server running there never sees passes, and checkChat throws a ChatCheckError (own_server_only).
 */

/** Why a message was stopped. The same reasons as Zaisma.filterText. */
export type ChatCheckReason = "contact_details" | "personal_details" | "slur" | "sexual" | "chat_paused" | "unchecked";

export interface ChatCheck {
  /** Whether to deliver it. */
  isAllowed: boolean;
  /** Why not; null when it's allowed. chat_paused: the sender's chat is paused or removed. unchecked: Zaisma couldn't check it, so don't deliver it (try again in a moment). */
  reason: ChatCheckReason | null;
  /** The words to show the sender when it's stopped (never mentions age or the other player); null when it's allowed. */
  message: string | null;
  /** Whether it swears. Zaisma allows it; block it yourself if your game doesn't. */
  hasSwearing: boolean;
}

export interface ChatCheckOptions {
  /** The message. */
  text: string;
  /** The sender's player pass, the signed token as your server received it. */
  sender: string;
  /** The passes of everyone it would reach, up to 50. */
  receivers: string[];
}

export const CHAT_CHECK_LIMITS = {
  /** The longest message checked, in characters; longer ones are cut. */
  maximumMessageCharacterCount: 500,
  maximumReceiverCount: 50,
  /** The sender's last messages sent along with each one, from the last 2 minutes. */
  recentTextCount: 5,
  recentTextWindowMs: 120_000,
  /** Senders whose last messages this server keeps in memory. */
  maximumSenderCount: 10_000,
  timeoutMs: 5_000,
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

const UNCHECKED: ChatCheck = { isAllowed: false, reason: "unchecked", message: "This message couldn't be checked. Try again in a moment.", hasSwearing: false };
const REASONS: readonly string[] = ["contact_details", "personal_details", "slur", "sexual", "chat_paused", "unchecked"];

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
  const recent = (recentBySender.get(senderPlayerId) ?? []).filter((sent) => nowMs - sent.sentAtMs < CHAT_CHECK_LIMITS.recentTextWindowMs);
  recent.push({ text, sentAtMs: nowMs });
  recentBySender.delete(senderPlayerId);
  // The oldest sender goes first when the map is full.
  if (recentBySender.size >= CHAT_CHECK_LIMITS.maximumSenderCount) recentBySender.delete(recentBySender.keys().next().value!);
  recentBySender.set(senderPlayerId, recent.slice(-CHAT_CHECK_LIMITS.recentTextCount));
}

/**
 * Check one chat message with Zaisma's filter. Call it on every chat message your server delivers, after
 * canChat says the players may chat, and deliver it only when isAllowed. It's free. When Zaisma can't be
 * reached it answers unchecked: don't deliver the message.
 *
 *   const check = await checkChat({ text, sender: senderPass, receivers: [receiverPass] });
 *   if (!check.isAllowed || check.hasSwearing) return reply(sender, check.message ?? "No swearing here.");
 */
export async function checkChat({ text, sender, receivers }: ChatCheckOptions): Promise<ChatCheck> {
  if ((globalThis as { isZaismaRoomsSandbox?: boolean }).isZaismaRoomsSandbox === true) {
    throw new ChatCheckError(
      "checkChat is for a game server on your own server. In Zaisma rooms the room runs Zaisma's chat filter on the chat it delivers.",
      "Send chat through Zaisma's chat hosting in rooms once it's out; until then, check what a player types in the game with Zaisma.filterText, or offer preset phrases and emotes.",
    );
  }
  const claims = readClaims(String(sender ?? ""));
  if (typeof claims.sub !== "string" || !isZaismaIssuer(claims.iss) || !Array.isArray(receivers)) return UNCHECKED;
  const nowMs = Date.now();
  const message = String(text ?? "").slice(0, CHAT_CHECK_LIMITS.maximumMessageCharacterCount);
  const recentTexts = (recentBySender.get(claims.sub) ?? []).filter((sent) => nowMs - sent.sentAtMs < CHAT_CHECK_LIMITS.recentTextWindowMs).map((sent) => sent.text);
  rememberText(claims.sub, message, nowMs);
  try {
    const response = await fetch(`${claims.iss}/v1/chat/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameSlug: claims.aud, senderPass: sender, receiverPasses: receivers.slice(0, CHAT_CHECK_LIMITS.maximumReceiverCount), text: message, recentTexts }),
      signal: AbortSignal.timeout(CHAT_CHECK_LIMITS.timeoutMs),
    });
    if (!response.ok) return UNCHECKED;
    const answer = (await response.json()) as Partial<ChatCheck>;
    if (typeof answer.isAllowed !== "boolean") return UNCHECKED;
    const reason = typeof answer.reason === "string" && REASONS.includes(answer.reason) ? (answer.reason as ChatCheckReason) : null;
    return { isAllowed: answer.isAllowed, reason, message: typeof answer.message === "string" ? answer.message : null, hasSwearing: answer.hasSwearing === true };
  } catch {
    return UNCHECKED;
  }
}
