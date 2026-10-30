/**
 * Requests: plain calls from a game to its game server's onRequest, outside any room, for a
 * leaderboard, a shop or a daily reward in any game, single-player ones too. Zaisma rooms answer them
 * at rooms.zaisma.com (apps/rooms/src/game-server.ts) and the Node runner on the developer's own
 * server (@zaisma/game-server/node), both at POST /v1/requests/<game>, both checked here so a request that works
 * in one works the same in the other.
 *
 * The game sends { pass, request } as text/plain JSON (so the browser needs no preflight): its player
 * pass, so onRequest knows who's asking, and its request, plain JSON. It gets back { answer }, what
 * onRequest answered, or { error: { code, message } }.
 */

import type { GameDatabase } from "./database.ts";
import type { ReceiptClaims } from "./pass.ts";
import type { KickOptions, LiveRoom, Player, RoomPlayer, RoomSelection } from "./room.ts";

/**
 * What onRequest, onSchedule and onWebhook reach besides what they're given: the game's own database, the
 * same one its rooms use, its secrets, receipt checks, and the game's live rooms. Room messages sent from here
 * reach rooms with senderKind "server"; on your own server they reach the Node runner's own rooms.
 */
export interface Server {
  database: GameDatabase;
  /**
   * The game's secrets, by name, like server.secrets.DISCORD_WEBHOOK_URL: set per game on Zaisma
   * (set_secret) and never shown again, or the environment variables on your own server.
   */
  secrets: Readonly<Record<string, string>>;
  /** Check a purchase's receipt, as room.verifyReceipt does: the runtime fills in Zaisma's keys and this game. */
  verifyReceipt(receipt: string): Promise<ReceiptClaims>;
  /** Send a message to one of the game's live rooms by its code, as room.sendToRoom does. isDelivered is false when no such room is running or it's busy. */
  sendToRoom(roomCode: string, message: unknown): Promise<{ isDelivered: boolean }>;
  /** Send a message to every live room of the game with someone in it, or those holding every label given, as room.sendToEveryRoom does. */
  sendToEveryRoom(message: unknown, roomSelection?: RoomSelection): Promise<{ roomCount: number }>;
  /** The game's live rooms, or those holding every label given, newest first, up to 500. */
  listRooms(roomSelection?: RoomSelection): Promise<{ rooms: LiveRoom[] }>;
  /** One live room and who's in it, players then spectators, or null when no such room is running. */
  getRoom(roomCode: string): Promise<{ room: LiveRoom; players: RoomPlayer[] } | null>;
  /** Remove a player from a live room, as room.kick does there: its onLeave hears reason "kicked". isDone is false when the room or the player isn't there. */
  kickFromRoom(roomCode: string, playerId: string, kickOptions?: KickOptions): Promise<{ isDone: boolean }>;
  /** End a live room's match, as room.end does there: its players hear message. isDone is false when no such room is running. */
  endRoom(roomCode: string, message?: string): Promise<{ isDone: boolean }>;
}

export const REQUEST_LIMITS = {
  /** A request, as JSON. */
  maximumRequestSizeBytes: 16 * 1024,
  /**
   * The player pass that comes with it, or with a room's hello: the fullest pass Zaisma makes (1,000 owned
   * items with 40-character names, 200 friends and 100 blocks) is about 70 KB, with room to spare.
   */
  maximumPassSizeBytes: 96 * 1024,
  /** A game played off Zaisma sends a playerToken in place of a pass (Zaisma.setUpOffZaisma), to a game server on your own server. */
  maximumPlayerTokenSizeBytes: 8 * 1024,
  /** What onRequest answers, as JSON. */
  maximumAnswerSizeBytes: 1024 * 1024,
  /** How long onRequest may take, awaiting the database included, before the request fails. */
  answerTimeoutSec: 10,
} as const;

export type RequestErrorCode =
  | "bad_request"
  | "too_big"
  | "bad_pass"
  | "bad_player_token"
  | "account_needed"
  | "game_not_open_to_player"
  | "game_unavailable"
  | "no_request_handler"
  | "game_server_error"
  | "hosting_paused"
  | "slow_down"
  | "bad_origin"
  | "busy";

export const REQUEST_ERROR_TEXT: Record<RequestErrorCode, string> = {
  bad_request: "Requests are JSON with the player's pass and the game's request: { pass, request }.",
  too_big: `Requests are up to ${REQUEST_LIMITS.maximumRequestSizeBytes / 1024} KB.`,
  bad_pass: "Your player pass isn't valid for this game.",
  bad_player_token: "This server doesn't know this player. Sign in again.",
  account_needed: "Playing online needs a Zaisma account. Sign in on the game's page to play.",
  game_not_open_to_player: "This game isn't open to this account.",
  game_unavailable: "This game isn't available right now.",
  no_request_handler: "This game's server doesn't take requests.",
  game_server_error: "The game's server couldn't answer this request.",
  hosting_paused: "This game's hosting is paused. It starts again when the month resets or its developer adds credit.",
  slow_down: "Too many requests. Try again in a minute.",
  bad_origin: "Not allowed from here.",
  busy: "Zaisma is busy. Try again soon.",
};

/** The HTTP status each request error answers with. */
export const REQUEST_ERROR_HTTP_STATUS: Record<RequestErrorCode, number> = {
  bad_request: 400,
  too_big: 413,
  bad_pass: 401,
  bad_player_token: 401,
  account_needed: 403,
  game_not_open_to_player: 403,
  game_unavailable: 404,
  no_request_handler: 404,
  game_server_error: 500,
  hosting_paused: 403,
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
 * (nothing is null). The pass's own size doesn't count. A game server on its developer's own server
 * (isPlayerTokenTaken) also takes { playerToken, request } from a game played off Zaisma: its token as text,
 * or null for a guest. Zaisma's rooms never do.
 */
export function readRequestBody(text: string): { pass: string; request: unknown } | { code: "bad_request" | "too_big" };
export function readRequestBody(text: string, isPlayerTokenTaken: boolean): { pass: string; request: unknown } | { playerToken: string | null; request: unknown } | { code: "bad_request" | "too_big" };
export function readRequestBody(text: string, isPlayerTokenTaken = false): { pass: string; request: unknown } | { playerToken: string | null; request: unknown } | { code: "bad_request" | "too_big" } {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { code: "bad_request" };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { code: "bad_request" };
  const { pass, playerToken, request } = body as { pass?: unknown; playerToken?: unknown; request?: unknown };
  const isOutside = isPlayerTokenTaken && pass === undefined && isPlayerToken(playerToken);
  if (!isOutside && (typeof pass !== "string" || pass.length > REQUEST_LIMITS.maximumPassSizeBytes)) return { code: "bad_request" };
  const requestText = request === undefined ? "null" : JSON.stringify(request);
  if (new TextEncoder().encode(requestText).length > REQUEST_LIMITS.maximumRequestSizeBytes) return { code: "too_big" };
  if (isOutside) return { playerToken: playerToken as string | null, request: request === undefined ? null : request };
  return { pass: pass as string, request: request === undefined ? null : request };
}

/** A playerToken as a game off Zaisma sends it: text up to REQUEST_LIMITS.maximumPlayerTokenSizeBytes, or null for a guest. */
export function isPlayerToken(given: unknown): given is string | null {
  return given === null || (typeof given === "string" && given.length > 0 && new TextEncoder().encode(given).length <= REQUEST_LIMITS.maximumPlayerTokenSizeBytes);
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
