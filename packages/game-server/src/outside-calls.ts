/**
 * Calls from a game server to other servers (game server reach): plain fetch(). On Zaisma every call
 * goes through the rooms Worker's gateway (apps/rooms/src/outbound.ts), which takes only https to the
 * hosts the game lists in game_server_allowed_hosts; a call it refuses throws an OutsideCallError in
 * the game server with one of these codes. On the developer's own server the Node runner calls out
 * freely, so the same code runs in both.
 */

export type OutsideCallErrorCode =
  /** Only https: addresses. */
  | "not_https"
  /** An IP address, this computer, or Zaisma's own domains. */
  | "unreachable_host"
  /** A host the game doesn't list in game_server_allowed_hosts. */
  | "host_not_allowed"
  /** More calls a minute than a game makes in one place (OUTSIDE_CALL_LIMITS.callsPerMin). */
  | "outside_call_limit"
  /** A body over OUTSIDE_CALL_LIMITS.maximumBodySizeBytes. */
  | "too_big"
  /** No answer within OUTSIDE_CALL_LIMITS.timeoutSec. */
  | "outside_call_timeout"
  /** The other server couldn't be reached, like a name that doesn't exist. */
  | "outside_call_failed";

export const OUTSIDE_CALL_LIMITS = {
  maximumBodySizeBytes: 5 * 1024 * 1024,
  timeoutSec: 10,
  callsPerMin: 600,
} as const;

/** What a refused call answers inside the sandbox, which its fetch() turns into an OutsideCallError. */
export interface OutsideCallRefusal {
  error: { code: OutsideCallErrorCode; message: string; fix: string };
}

/** The header a refusal comes back with, so the sandbox can tell it from a server's own answer. */
export const OUTSIDE_CALL_REFUSAL_HEADER = "zaisma-outside-call-refused";
