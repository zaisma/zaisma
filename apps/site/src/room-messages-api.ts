import { ROOM_LIMITS, isRoomCode, type LiveRoom, type RoomPlayer } from "@zaisma/game-server";
import { ApiError, ROOM_MESSAGE_LIMITS, audit, checkRoomMessage, iso, isIdOf, isRoomLabels, listLiveRooms, newId, type Game } from "@zaisma/core";
import type { Caller, CheckedCall, NextStep } from "./developer.ts";
import type { Env } from "./env.ts";
import { logCallerEvent } from "./security-log.ts";

/**
 * A game reaching its own live rooms through the developer API, for its developer's scripts and their AI (the MCP),
 * like the game's own moderation page or a live event: the game's live rooms and who's in one, a room message to
 * one room or every room (now or at a set time), removing a player and ending a room. Rooms take each part
 * themselves, through the rooms Worker (GAME_ROOMS, apps/rooms/src/room-reach.ts); the list comes from live_rooms,
 * as the rooms read it (packages/core/src/room-messages.ts). Rooms on the developer's own servers are theirs: the
 * Node runner gives their game server the same calls, and these don't reach them.
 *
 *   GET    /api/dev/games/:slug/rooms                              the game's live rooms: ?labels={"Map":"Docks"}, ?cursor=
 *   GET    /api/dev/games/:slug/rooms/:room_code                   one, and who's in it
 *   POST   /api/dev/games/:slug/rooms/:room_code/messages          a room message to it: { "message" }
 *   POST   /api/dev/games/:slug/rooms/:room_code/kick              remove a player: { "player_id", "message", "is_kept_out" }
 *   POST   /api/dev/games/:slug/rooms/:room_code/end               end its match: { "message", "confirm": true }
 *   POST   /api/dev/games/:slug/room-messages                      a room message to every room: { "message", "labels", "send_at" }
 *   GET    /api/dev/games/:slug/room-messages                      scheduled ones waiting, and the last sent
 *   DELETE /api/dev/games/:slug/room-messages/:scheduled_room_message_id   cancel one waiting
 */

/** Sent scheduled sends listed after the waiting ones. */
const SENT_LISTED_COUNT = 20;
/** The soonest a send to every room can be scheduled: sooner, send it now. */
const MINIMUM_SCHEDULE_AHEAD_DURATION_SEC = 10;
const DAY_MS = 86_400_000;

/** A live room as the API answers it. */
function roomJson(room: LiveRoom) {
  return {
    room_code: room.roomCode,
    name: room.name,
    labels: room.labels,
    player_count: room.playerCount,
    maximum_player_count: room.maximumPlayerCount,
    spectator_count: room.spectatorCount,
    is_listed: room.isListed,
    is_open: room.isOpen,
    is_kept: room.isKept,
    version_id: room.versionId,
    continent: room.continent,
    created_at: room.createdAt,
  };
}

function playerJson(player: RoomPlayer) {
  return { player_id: player.playerId, name: player.name, kind: player.kind, is_away: player.isAway, away_reason: player.awayReason, joined_at: player.joinedAt, is_spectator: player.isSpectator };
}

interface ScheduledRoomMessageRow {
  id: string;
  room_message_json: string;
  labels_json: string | null;
  send_at_ms: number;
  created_at_ms: number;
  sent_at_ms: number | null;
  delivered_room_count: number | null;
}

function scheduledJson(row: ScheduledRoomMessageRow) {
  return {
    id: row.id,
    message: JSON.parse(row.room_message_json) as unknown,
    labels: row.labels_json ? (JSON.parse(row.labels_json) as Record<string, string>) : null,
    send_at: iso(row.send_at_ms),
    created_at: iso(row.created_at_ms),
    sent_at: iso(row.sent_at_ms),
    delivered_room_count: row.delivered_room_count,
  };
}

/** A room code from the path, as the rooms take it. */
function readRoomCode(given: string): string {
  const code = given.toUpperCase();
  if (!isRoomCode(code)) throw new ApiError("bad_room_code", { message: `room_code ${JSON.stringify(given.slice(0, 20))} isn't a room code.`, field: "room_code", fix: "Give a live room's code from list_rooms, like K7Q2MX." });
  return code;
}

/** Labels a room must hold, as a JSON object of text: from the body, or the query as JSON. Null for every room. */
function readLabels(given: unknown): Record<string, string> | null {
  if (given === undefined || given === null) return null;
  if (!isRoomLabels(given)) throw new ApiError("bad_labels", { message: "labels isn't an object of up to 4 labels, each text.", field: "labels", fix: 'Give the labels the rooms hold, like {"Map": "Docks"}, or leave labels out for every room.' });
  return Object.keys(given).length ? given : null;
}

function readQueryLabels(given: string | null): Record<string, string> | null {
  if (given === null || given === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(given);
  } catch {
    parsed = undefined;
  }
  return readLabels(parsed === undefined ? "not json" : parsed);
}

/** A list cursor: where the last page ended, as the newest-first order goes (created_at_ms, then room_code). */
const roomCursorFor = (room: { createdAtMs: number; roomCode: string }) => `cursor_${room.createdAtMs.toString(36)}_${room.roomCode.toLowerCase()}`;
function readRoomCursor(given: string | null): { createdAtMs: number; roomCode: string } | null {
  if (!given) return null;
  const match = /^cursor_([0-9a-z]{1,12})_([0-9a-z]{6})$/.exec(given);
  if (!match || !isRoomCode(match[2]!.toUpperCase())) throw new ApiError("bad_cursor", { message: `cursor ${JSON.stringify(given.slice(0, 40))} isn't a next_cursor Zaisma gave.`, field: "cursor", fix: "Pass the next_cursor from your last answer as it came, or leave cursor out to start from the newest room." });
  return { createdAtMs: parseInt(match[1]!, 36), roomCode: match[2]!.toUpperCase() };
}

/** The message a kick or an end shows players: text up to ROOM_LIMITS.maximumKickMessageCharacterCount, or null to leave it out. */
function readShownMessage(given: unknown, code: "bad_kick_message" | "bad_end_message"): string | null {
  if (given === undefined || given === null) return null;
  if (typeof given !== "string" || given.length > ROOM_LIMITS.maximumKickMessageCharacterCount) {
    throw new ApiError(code, { message: `message isn't text of up to ${ROOM_LIMITS.maximumKickMessageCharacterCount} characters.`, field: "message", fix: "Give the words players see, within the content rules, or leave message out." });
  }
  return given;
}

function readRoomMessage(given: unknown): unknown {
  const checked = checkRoomMessage(given);
  if (!checked.isValid) {
    throw new ApiError("bad_room_message", {
      message: `message isn't plain JSON of up to ${ROOM_MESSAGE_LIMITS.maximumRoomMessageSizeBytes / 1024} KB.`,
      field: "message",
      fix: 'Give what the game server\'s onRoomMessage reads, as JSON, like {"kind": "blood_moon"}.',
    });
  }
  return checked.checkedMessage;
}

/** send_at: an ISO time from a few seconds to ROOM_MESSAGE_LIMITS.maximumScheduleAheadDurationDays ahead. */
function readSendAt(given: unknown, nowMs: number): number {
  const sendAtMs = typeof given === "string" && /\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(given) ? Date.parse(given) : NaN;
  if (Number.isNaN(sendAtMs) || sendAtMs < nowMs + MINIMUM_SCHEDULE_AHEAD_DURATION_SEC * 1000 || sendAtMs > nowMs + ROOM_MESSAGE_LIMITS.maximumScheduleAheadDurationDays * DAY_MS) {
    throw new ApiError("bad_time", {
      message: `send_at ${typeof given === "string" ? JSON.stringify(given.slice(0, 40)) : "isn't text"}: it must be an ISO time from ${MINIMUM_SCHEDULE_AHEAD_DURATION_SEC} seconds to ${ROOM_MESSAGE_LIMITS.maximumScheduleAheadDurationDays} days ahead.`,
      field: "send_at",
      fix: `Give an ISO time with Z or an offset, like "${new Date(nowMs + DAY_MS).toISOString().slice(0, 14)}00:00Z", or leave send_at out to send now.`,
    });
  }
  return sendAtMs;
}

/** Without the rooms Worker (a Zaisma of your own), no room is running. */
function rooms(env: Env): NonNullable<Env["GAME_ROOMS"]> | null {
  return env.GAME_ROOMS ?? null;
}

function noRoom(game: Game, roomCode: string): ApiError {
  return new ApiError("no_room", { message: `${game.slug} has no live room ${roomCode} on Zaisma.`, field: "room_code", fix: "list_rooms gives the game's live rooms. Rooms on your own servers are your game server's to reach." });
}

/** /games/:slug/rooms…, once the router (developer.ts, checkCall) has checked the key, the game and the inputs. */
export async function roomsRoute(request: Request, env: Env, game: Game, path: string, roomCode: string | undefined, caller: Caller, checked: CheckedCall, nowMs = Date.now()): Promise<[unknown, number?]> {
  const service = rooms(env);
  if (roomCode === undefined) {
    const before = readRoomCursor(checked.query.get("cursor"));
    const labels = readQueryLabels(checked.query.get("labels"));
    const listed = await listLiveRooms(env.DB, game.id, { labels, roomCount: ROOM_MESSAGE_LIMITS.maximumListedRoomCount, before }, nowMs);
    const page = listed.slice(0, ROOM_MESSAGE_LIMITS.maximumListedRoomCount);
    const roomCount = before ? page.length : listed.length <= ROOM_MESSAGE_LIMITS.maximumListedRoomCount ? listed.length : await countLiveRooms(env, game, labels, nowMs);
    return [{ rooms: page.map(roomJson), room_count: roomCount, next_cursor: listed.length > page.length ? roomCursorFor(page.at(-1)!) : null }];
  }
  const code = readRoomCode(roomCode);

  if (path.endsWith("/messages")) {
    const message = readRoomMessage(checked.body.message);
    const delivered = service ? await service.sendRoomMessage({ gameId: game.id, slug: game.slug, roomCode: code, message }) : { deliveryOutcome: "no_room" as const };
    if (delivered.deliveryOutcome === "no_room") throw noRoom(game, code);
    if (delivered.deliveryOutcome === "room_busy") throw new ApiError("room_busy", { message: `Room ${code} took ${ROOM_MESSAGE_LIMITS.maximumReceivedRoomMessagesPerSec} room messages in the last second.`, field: "room_code", fix: "Send it again in a second.", retryAfterSec: 1 });
    return [{ is_delivered: true, next_steps: [] satisfies NextStep[] }];
  }

  if (path.endsWith("/kick")) {
    const playerId = checked.body.player_id;
    if (!isIdOf("player", playerId)) throw new ApiError("bad_player_id", { message: "player_id isn't a player ID (player_…).", field: "player_id", fix: "Give a player_id from get_room's players." });
    const shownMessage = readShownMessage(checked.body.message, "bad_kick_message");
    const kicked = service ? await service.kickPlayer({ gameId: game.id, slug: game.slug, roomCode: code, playerId, message: shownMessage ?? "", isKeptOut: checked.body.is_kept_out === true }) : { kickOutcome: "no_room" as const };
    if (kicked.kickOutcome === "no_room") throw noRoom(game, code);
    if (kicked.kickOutcome === "no_player_in_room") throw new ApiError("no_player_in_room", { message: `${playerId} isn't in room ${code}.`, field: "player_id", fix: "get_room gives who's in the room now." });
    await audit(env.DB, game.id, "room-player-kicked", `${playerId} from ${code}`, caller.actor);
    await logCallerEvent(env, caller, "room_player_kicked", { gameId: game.id, subjectName: code });
    return [{ is_kicked: true, next_steps: [{ tool: "get_room", arguments: { slug: game.slug, room_code: code }, after_sec: null, reason: "Who's in the room now." }] satisfies NextStep[] }];
  }

  if (path.endsWith("/end")) {
    const shownMessage = readShownMessage(checked.body.message, "bad_end_message");
    if (checked.body.confirm !== true) {
      throw new ApiError("needs_confirm", { message: `Ending room ${code} ends the match for everyone in it, and a kept room's world for good.`, field: "confirm", fix: 'Ask the developer; if they agree, call again with "confirm": true.' });
    }
    const ended = service ? await service.endRoom({ gameId: game.id, slug: game.slug, roomCode: code, message: shownMessage }) : { endOutcome: "no_room" as const };
    if (ended.endOutcome === "no_room") throw noRoom(game, code);
    await audit(env.DB, game.id, "room-ended", code, caller.actor);
    await logCallerEvent(env, caller, "room_ended", { gameId: game.id, subjectName: code });
    return [{ is_ended: true, next_steps: [{ tool: "list_rooms", arguments: { slug: game.slug }, after_sec: null, reason: "The game's live rooms now." }] satisfies NextStep[] }];
  }

  if (request.method !== "GET") throw new ApiError("bad_method", { message: `${request.method} isn't a call at /games/${game.slug}/rooms/${code}.`, fix: "GET gives the room and who's in it." });
  const found = service ? await service.getRoom({ gameId: game.id, slug: game.slug, roomCode: code }) : null;
  if (!found) throw noRoom(game, code);
  return [{ room: roomJson(found.room), players: found.players.map(playerJson) }];
}

async function countLiveRooms(env: Env, game: Game, labels: Record<string, string> | null, nowMs: number): Promise<number> {
  // Counting past a page lists the codes only: enough to count, and as cheap as the rows it reads.
  const listed = await listLiveRooms(env.DB, game.id, { labels, roomCount: Number.MAX_SAFE_INTEGER - 1 }, nowMs);
  return listed.length;
}

/** /games/:slug/room-messages…: sends to every room, now or scheduled, and the scheduled ones. */
export async function roomMessagesRoute(request: Request, env: Env, game: Game, scheduledRoomMessageId: string | undefined, caller: Caller, checked: CheckedCall, nowMs = Date.now()): Promise<[unknown, number?]> {
  if (scheduledRoomMessageId !== undefined) {
    if (!isIdOf("scheduled_room_message", scheduledRoomMessageId)) throw new ApiError("wrong_id_kind", { message: `${JSON.stringify(String(scheduledRoomMessageId).slice(0, 60))} isn't a scheduled_room_message_ ID.`, field: "scheduled_room_message_id", fix: "Give an id from list_room_messages." });
    const cancelled = await env.DB.prepare("DELETE FROM scheduled_room_messages WHERE id = ? AND game_id = ? AND sent_at_ms IS NULL").bind(scheduledRoomMessageId, game.id).run();
    if (cancelled.meta.changes) await logCallerEvent(env, caller, "room_message_cancelled", { gameId: game.id, subjectName: scheduledRoomMessageId });
    if (!cancelled.meta.changes) throw new ApiError("no_scheduled_room_message", { message: `${game.slug} has no scheduled room message ${scheduledRoomMessageId} waiting.`, field: "scheduled_room_message_id", fix: "list_room_messages gives the ones waiting; one that went out can't be cancelled." });
    return [{ is_cancelled: true, next_steps: [{ tool: "list_room_messages", arguments: { slug: game.slug }, after_sec: null, reason: "The scheduled room messages still waiting." }] satisfies NextStep[] }];
  }

  if (request.method === "GET") {
    const columns = "id, room_message_json, labels_json, send_at_ms, created_at_ms, sent_at_ms, delivered_room_count";
    const [waiting, sent] = await env.DB.batch<ScheduledRoomMessageRow>([
      env.DB.prepare(`SELECT ${columns} FROM scheduled_room_messages WHERE game_id = ? AND sent_at_ms IS NULL ORDER BY send_at_ms`).bind(game.id),
      env.DB.prepare(`SELECT ${columns} FROM scheduled_room_messages WHERE game_id = ? AND sent_at_ms IS NOT NULL ORDER BY sent_at_ms DESC LIMIT ?`).bind(game.id, SENT_LISTED_COUNT),
    ]);
    return [{ scheduled_room_messages: [...waiting!.results, ...sent!.results].map(scheduledJson) }];
  }

  const message = readRoomMessage(checked.body.message);
  const labels = readLabels(checked.body.labels);
  if (checked.body.send_at === undefined || checked.body.send_at === null) {
    const sent = rooms(env) ? await rooms(env)!.sendToEveryRoom({ gameId: game.id, slug: game.slug, labels, message }) : { roomCount: 0, isLimited: false };
    if (sent.isLimited) {
      throw new ApiError("every_room_send_limit", {
        message: `${game.slug} sent to every room ${ROOM_MESSAGE_LIMITS.maximumEveryRoomSendsPerMin} times in the last minute, from its game server, the API and the MCP together.`,
        fix: "Put what you send in one message, or wait a minute.",
        retryAfterSec: 60,
      });
    }
    return [{ room_count: sent.roomCount, scheduled_room_message: null, next_steps: [{ tool: "list_rooms", arguments: { slug: game.slug, ...(labels ? { labels } : {}) }, after_sec: null, reason: "The rooms it went to." }] satisfies NextStep[] }];
  }

  const sendAtMs = readSendAt(checked.body.send_at, nowMs);
  const waitingCount = await env.DB.prepare("SELECT count(*) AS waiting_count FROM scheduled_room_messages WHERE game_id = ? AND sent_at_ms IS NULL").bind(game.id).first<number>("waiting_count");
  if ((waitingCount ?? 0) >= ROOM_MESSAGE_LIMITS.maximumScheduledRoomMessageCount) {
    throw new ApiError("too_many_scheduled_room_messages", { message: `${game.slug} has ${ROOM_MESSAGE_LIMITS.maximumScheduledRoomMessageCount} scheduled room messages waiting, the most a game can have.`, fix: "cancel_room_message one that's waiting, or wait for some to go out." });
  }
  const row: ScheduledRoomMessageRow = { id: newId("scheduled_room_message"), room_message_json: JSON.stringify(message), labels_json: labels ? JSON.stringify(labels) : null, send_at_ms: sendAtMs, created_at_ms: nowMs, sent_at_ms: null, delivered_room_count: null };
  await env.DB.prepare("INSERT INTO scheduled_room_messages (id, game_id, room_message_json, labels_json, send_at_ms, created_at_ms) VALUES (?, ?, ?, ?, ?, ?)").bind(row.id, game.id, row.room_message_json, row.labels_json, row.send_at_ms, row.created_at_ms).run();
  await logCallerEvent(env, caller, "room_message_scheduled", { gameId: game.id, subjectName: row.id });
  const { id, send_at: sendAt, labels: scheduledLabels, created_at: createdAt } = scheduledJson(row);
  return [
    {
      room_count: null,
      scheduled_room_message: { id, send_at: sendAt, labels: scheduledLabels, created_at: createdAt },
      next_steps: [
        { tool: "list_room_messages", arguments: { slug: game.slug }, after_sec: Math.ceil((sendAtMs - nowMs) / 1000) + 60, reason: "To how many rooms it went, once it's out." },
        { tool: "cancel_room_message", arguments: { slug: game.slug, scheduled_room_message_id: id }, after_sec: null, reason: "To call it off before it goes." },
      ] satisfies NextStep[],
    },
  ];
}
