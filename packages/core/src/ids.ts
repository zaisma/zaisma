import { ApiError } from "./errors.ts";

/**
 * IDs that say their kind (docs/NAMING.md, IDs): every ID Zaisma makes is <kind>_<random>, the kind
 * in whole words and the random part without underscores, so whoever holds one knows what it is.
 * The list matches the table in docs/NAMING.md; test/node/ids.test.ts keeps them in step. Guests'
 * player IDs take theirs with the SDK and game server's names (docs/ROADMAP.md); an account's is kept
 * with the account (accounts.player_id), the same in every game.
 */
export const ID_KINDS = ["game", "version", "image", "shader", "tester", "topic", "post", "report", "media", "precedent", "review_precedent", "player", "owner", "save_copy", "play_ticket", "room_key", "sign_in_app", "chat_group", "player_tag", "webhook", "webhook_event", "chat_review", "mcp_client", "database_restore", "announcement", "top_up", "credit_entry", "purchase", "spending_request", "pending_refund", "scheduled_room_message", "ban_match"] as const;
export type IdKind = (typeof ID_KINDS)[number];

/** 20 random lowercase letters and digits: the random part of an ID, and of an API key's own format (zsk_<random>_<secret>). */
export function newRandomPart(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 20);
}

export function newId(kind: IdKind): string {
  return `${kind}_${newRandomPart()}`;
}

/** The kind an ID says it is, or null when it isn't an ID Zaisma makes. */
export function idKindOf(given: string): IdKind | null {
  const underscoreIndex = given.lastIndexOf("_");
  const kind = given.slice(0, underscoreIndex);
  // The random part: lowercase letters and digits, and hyphens in IDs written by hand (precedents' first ones).
  return underscoreIndex > 0 && /^[a-z0-9-]{1,40}$/.test(given.slice(underscoreIndex + 1)) && (ID_KINDS as readonly string[]).includes(kind) ? (kind as IdKind) : null;
}

/** Whether a value is an ID of this kind. */
export function isIdOf(kind: IdKind, given: unknown): given is string {
  return typeof given === "string" && idKindOf(given) === kind;
}

/** A kind in words with its article, for messages: "a version ID", "an image ID", "a save copy ID". */
export function idKindInWords(kind: IdKind): string {
  const words = kind.replace(/_/g, " ");
  return `${/^[aeiou]/.test(words) ? "an" : "a"} ${words} ID`;
}

/**
 * Refuses an ID of another kind where this kind belongs, saying what was sent and where the right
 * one comes from (docs/NAMING.md, IDs). Anything else passes, for the call's own lookup to answer.
 */
export function checkIdKind(kind: IdKind, given: unknown, field: string, fix: string): void {
  const sentKind = typeof given === "string" ? idKindOf(given) : null;
  if (sentKind && sentKind !== kind) throw new ApiError("wrong_id_kind", { message: `That's ${idKindInWords(sentKind)}; ${field} takes ${idKindInWords(kind)}.`, field, fix });
}

export async function sha256Hex(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
