/**
 * Requests: plain calls from a game to its game server's onRequest, outside any room, for a
 * leaderboard, a shop or a daily reward in any game, single-player ones too. Zaisma rooms answer them
 * at rooms.zaisma.com (apps/rooms/src/game-server.ts) and the Node runner on the developer's own
 * server (bin/node.js), both at POST /v1/requests/<game>, both checked here so a request that works
 * in one works the same in the other.
 *
 * The game sends { pass, request } as text/plain JSON (so the browser needs no preflight): its player
 * pass, so onRequest knows who's asking, and its request, plain JSON. It gets back { answer }, what
 * onRequest answered, or { error: { code, message } }.
 */

import type { GameDatabase } from "./database.ts";
import type { Player } from "./room.ts";

/**
 * What onRequest and onSchedule reach besides what they're given: the game's own database, the same
 * one its rooms use, and its secrets.
 */
export interface Server {
  database: GameDatabase;
  /**
   * The game's secrets, by name, like server.secrets.DISCORD_WEBHOOK_URL: set per game on Zaisma
   * (set_secret) and never shown again, or the environment variables on your own server.
   */
  secrets: Readonly<Record<string, string>>;
}

export const REQUEST_LIMITS = {
  /** A request, as JSON. */
  maximumRequestSizeBytes: 16 * 1024,
  /** What onRequest answers, as JSON. */
  maximumAnswerSizeBytes: 1024 * 1024,
  /** How long onRequest may take, awaiting the database included, before the request fails. */
  answerTimeoutSec: 10,
} as const;

export type RequestErrorCode =
  | "bad_request"
  | "too_big"
  | "bad_pass"
  | "account_needed"
  | "game_unavailable"
  | "no_request_handler"
  | "game_server_error"
  | "request_limit"
  | "slow_down"
  | "bad_origin"
  | "busy";

export const REQUEST_ERROR_TEXT: Record<RequestErrorCode, string> = {
  bad_request: "Requests are JSON with the player's pass and the game's request: { pass, request }.",
  too_big: `Requests are up to ${REQUEST_LIMITS.maximumRequestSizeBytes / 1024} KB.`,
  bad_pass: "Your player pass isn't valid for this game.",
  account_needed: "Playing online needs a Zaisma account. Sign in on the game's page to play.",
  game_unavailable: "This game isn't available right now.",
  no_request_handler: "This game's server doesn't take requests.",
  game_server_error: "The game's server couldn't answer this request.",
  request_limit: "This game has used this month's requests. They work again next month.",
  slow_down: "Too many requests. Try again in a minute.",
  bad_origin: "Not allowed from here.",
  busy: "Zaisma is busy. Try again soon.",
};

/** The HTTP status each request error answers with. */
export const REQUEST_ERROR_HTTP_STATUS: Record<RequestErrorCode, number> = {
  bad_request: 400,
  too_big: 413,
  bad_pass: 401,
  account_needed: 403,
  game_unavailable: 404,
  no_request_handler: 404,
  game_server_error: 500,
  request_limit: 429,
  slow_down: 429,
  bad_origin: 403,
  busy: 503,
};

/** The body of an error answer. message replaces the usual text. */
export function requestError(code: RequestErrorCode, message?: string): { error: { code: RequestErrorCode; message: string } } {
  return { error: { code, message: message || REQUEST_ERROR_TEXT[code] } };
}

/**
 * Read what a game sent: its pass and its request, plain JSON within REQUEST_LIMITS.maximumRequestSizeBytes
 * (nothing is null). The pass's own size doesn't count.
 */
export function readRequestBody(text: string): { pass: string; request: unknown } | { code: "bad_request" | "too_big" } {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { code: "bad_request" };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { code: "bad_request" };
  const { pass, request } = body as { pass?: unknown; request?: unknown };
  if (typeof pass !== "string" || pass.length > 4096) return { code: "bad_request" };
  const requestText = request === undefined ? "null" : JSON.stringify(request);
  if (new TextEncoder().encode(requestText).length > REQUEST_LIMITS.maximumRequestSizeBytes) return { code: "too_big" };
  return { pass, request: request === undefined ? null : request };
}

/**
 * What onRequest answered, as the game gets it: plain JSON (nothing is null), within
 * REQUEST_LIMITS.maximumAnswerSizeBytes, or a mistake for the game server's errors.
 */
export function readRequestAnswer(answer: unknown): { answer: unknown } | { mistake: string } {
  if (answer === undefined || answer === null) return { answer: null };
  let text: string | undefined;
  try {
    text = JSON.stringify(answer);
  } catch {
    text = undefined;
  }
  if (text === undefined) return { mistake: "onRequest answered something that isn't plain JSON, like a function or an object that refers to itself. Answer numbers, text, true or false, null, lists and plain objects." };
  if (new TextEncoder().encode(text).length > REQUEST_LIMITS.maximumAnswerSizeBytes) {
    return { mistake: `onRequest answered over ${REQUEST_LIMITS.maximumAnswerSizeBytes / 1024 / 1024} MB. Answer less, like one page of a leaderboard at a time.` };
  }
  return { answer: JSON.parse(text) };
}

/** A game server that answers requests. */
export interface RequestHandler {
  onRequest?(player: Player, request: unknown, server: Server): unknown;
}

/**
 * Run a game server's onRequest for one request, with a time limit, and say what the game gets. A
 * game server without onRequest answers no_request_handler. When it throws, answers something that
 * isn't plain JSON or takes too long, the game gets game_server_error, and failure says why for the
 * game server's errors.
 */
export async function answerRequest(
  handler: RequestHandler,
  player: Player,
  request: unknown,
  server: Server,
): Promise<{ answer: unknown } | { code: "no_request_handler" } | { code: "game_server_error"; failure: string }> {
  if (typeof handler.onRequest !== "function") return { code: "no_request_handler" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answer = await Promise.race([
      Promise.resolve().then(() => handler.onRequest!(player, request, server)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`onRequest didn't answer within ${REQUEST_LIMITS.answerTimeoutSec} seconds`)), REQUEST_LIMITS.answerTimeoutSec * 1000);
      }),
    ]);
    const read = readRequestAnswer(answer);
    return "mistake" in read ? { code: "game_server_error", failure: read.mistake } : read;
  } catch (error) {
    return { code: "game_server_error", failure: String((error instanceof Error && error.stack) || error) };
  } finally {
    clearTimeout(timer);
  }
}
