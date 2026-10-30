import { WorkerEntrypoint } from "cloudflare:workers";
import { GameServerError, ROOM_LIMITS, ROOM_MESSAGE_LIMITS, isRoomCode, type LiveRoom, type RoomMessage, type RoomMessageSenderKind, type RoomPlayer, type ServerRoomReach } from "@zaisma/game-server/internal";
import { checkRoomMessage, isHostingPaused, isRoomLabels, listLiveRooms, liveRoomOf, type LiveRoomRecord } from "@zaisma/core";
import type { Env } from "./index.ts";

/**
 * A game reaching its own live rooms on Zaisma (docs/DEVELOPER-API.md, "Reaching live rooms"): a room message to one
 * room by its code or to every room with someone in it, the game's live rooms and who's in one, and removing a player
 * or ending a room from outside. Each room takes its part itself (room.ts: /room-message, /players, /kick, /end), so
 * its game server hears it as it hears its own. Its game server reaches these through the room (built in) or
 * RoomReachBinding (in its sandbox), and the API and MCP through GameRoomsService (room-updates.ts).
 *
 * A room is asked only when live_rooms or kept_rooms has it, so a code that names nothing wakes no room. Each delivery
 * is one request to the room, on the game's meter with the room's own (room.ts counts its POSTs).
 */

/** A game as reaching its rooms needs it: its ID, and its slug, which names its rooms' objects. */
export interface ReachedGame {
  gameId: string;
  slug: string;
}

/** How many rooms are told at once, as updateMatches tells them. */
const TOLD_AT_ONCE_COUNT = 50;

/** What a room answered a room message: taken, no such room running, or busy (it took ROOM_MESSAGE_LIMITS.maximumReceivedRoomMessagesPerSec this second). */
export type RoomMessageOutcome = "delivered" | "no_room" | "room_busy";

/** The room's object, by its game's slug and its code. */
function roomObject(env: Env, game: ReachedGame, roomCode: string): DurableObjectStub {
  return env.ROOMS.get(env.ROOMS.idFromName(`${game.slug}:${roomCode}`));
}

/** Whether the game has a room by that code to ask: a live one, or a kept one asleep. */
async function hasRoom(env: Env, game: ReachedGame, roomCode: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT 1 AS found_count FROM live_rooms WHERE game_id = ?1 AND room_code = ?2 UNION ALL SELECT 1 FROM kept_rooms WHERE game_id = ?1 AND room_code = ?2 LIMIT 1").bind(game.gameId, roomCode).first<{ found_count: number }>();
  return row !== null;
}

/** A listed room as the game server sees it, without the record's createdAtMs. */
function liveRoomWithout(record: LiveRoomRecord): LiveRoom {
  const { createdAtMs, ...room } = record;
  void createdAtMs;
  return room;
}

/** Hand one room a room message. A kept room with nobody in it wakes for it. */
export async function sendRoomMessage(env: Env, game: ReachedGame, roomCode: string, roomMessage: RoomMessage): Promise<RoomMessageOutcome> {
  if (!isRoomCode(roomCode) || !(await hasRoom(env, game, roomCode))) return "no_room";
  return tell(env, game, roomCode, roomMessage);
}

async function tell(env: Env, game: ReachedGame, roomCode: string, roomMessage: RoomMessage): Promise<RoomMessageOutcome> {
  try {
    const response = await roomObject(env, game, roomCode).fetch("https://room/room-message", { method: "POST", headers: { "x-game-id": game.gameId }, body: JSON.stringify(roomMessage) });
    if (response.status === 429) return "room_busy";
    return response.ok ? "delivered" : "no_room";
  } catch (error) {
    console.error("Couldn't hand a room a room message:", error);
    return "room_busy";
  }
}

/**
 * Hand every live room of the game with someone in it a room message, or those holding every label given, never
 * exceptRoomCode (the room sending it). isCounted: it counts toward the game's sends to every room a minute
 * (ROOM_MESSAGE_LIMITS.maximumEveryRoomSendsPerMin); a scheduled send was counted when it was made. isLimited when
 * the game is past that, and nothing was sent.
 */
export async function sendToEveryRoom(env: Env, game: ReachedGame, sending: { labels: Record<string, string> | null; roomMessage: RoomMessage; exceptRoomCode: string | null; isCounted: boolean }): Promise<{ roomCount: number; isLimited: boolean }> {
  if (sending.isCounted && env.EVERY_ROOM_SEND_LIMIT && !(await env.EVERY_ROOM_SEND_LIMIT.limit({ key: game.gameId })).success) return { roomCount: 0, isLimited: true };
  const rooms = await listLiveRooms(env.DB, game.gameId, { labels: sending.labels, roomCount: Number.MAX_SAFE_INTEGER - 1, isSomeoneIn: true, exceptRoomCode: sending.exceptRoomCode });
  let roomCount = 0;
  for (let index = 0; index < rooms.length; index += TOLD_AT_ONCE_COUNT) {
    const told = await Promise.all(rooms.slice(index, index + TOLD_AT_ONCE_COUNT).map((room) => tell(env, game, room.roomCode, sending.roomMessage)));
    roomCount += told.filter((outcome) => outcome === "delivered").length;
  }
  return { roomCount, isLimited: false };
}

/** The game's live rooms holding every label given, newest first, up to ROOM_MESSAGE_LIMITS.maximumListedRoomCount. */
export async function listRooms(env: Env, game: ReachedGame, labels: Record<string, string> | null): Promise<LiveRoom[]> {
  const rooms = await listLiveRooms(env.DB, game.gameId, { labels, roomCount: ROOM_MESSAGE_LIMITS.maximumListedRoomCount });
  return rooms.slice(0, ROOM_MESSAGE_LIMITS.maximumListedRoomCount).map(liveRoomWithout);
}

/** One live room and who's in it, players then spectators, or null when the game has no such room running. */
export async function getRoom(env: Env, game: ReachedGame, roomCode: string): Promise<{ room: LiveRoom; players: RoomPlayer[] } | null> {
  if (!isRoomCode(roomCode)) return null;
  const listed = await liveRoomOf(env.DB, game.gameId, roomCode);
  if (!listed) return null;
  const room = liveRoomWithout(listed);
  try {
    const response = await roomObject(env, game, roomCode).fetch("https://room/players", { method: "POST", headers: { "x-game-id": game.gameId } });
    if (!response.ok) return null;
    return { room, players: ((await response.json()) as { players: RoomPlayer[] }).players };
  } catch (error) {
    console.error("Couldn't ask a room who's in it:", error);
    return null;
  }
}

/** Remove a player or spectator from a live room, as its own room.kick would. */
export async function kickFromRoom(env: Env, game: ReachedGame, roomCode: string, kick: { playerId: string; message: string; isKeptOut: boolean }): Promise<"kicked" | "no_room" | "no_player_in_room"> {
  if (!isRoomCode(roomCode) || !(await hasRoom(env, game, roomCode))) return "no_room";
  const response = await roomObject(env, game, roomCode).fetch("https://room/kick", { method: "POST", headers: { "x-game-id": game.gameId }, body: JSON.stringify(kick) });
  if (response.status === 409) return "no_player_in_room";
  return response.ok ? "kicked" : "no_room";
}

/** End a live room's match, as its own room.end would: its players hear message. */
export async function endRoom(env: Env, game: ReachedGame, roomCode: string, message: string | null): Promise<"ended" | "no_room"> {
  if (!isRoomCode(roomCode) || !(await hasRoom(env, game, roomCode))) return "no_room";
  const response = await roomObject(env, game, roomCode).fetch("https://room/end", { method: "POST", headers: { "x-game-id": game.gameId }, body: JSON.stringify({ message }) });
  return response.ok ? "ended" : "no_room";
}

/** A room message as it leaves: from a room (fromRoomCode), the game server outside rooms or the developer. */
export function roomMessageOf(message: unknown, senderKind: RoomMessageSenderKind, fromRoomCode: string | null, sentAtMs = Date.now()): RoomMessage {
  return { message, senderKind, fromRoomCode: senderKind === "room" ? fromRoomCode : null, sentAt: new Date(sentAtMs).toISOString() };
}

/** The every-room limit, as a game server hears it. */
function everyRoomSendLimit(call: string): GameServerError {
  return new GameServerError("room_call_limit", call, `A game can send to every room up to ${ROOM_MESSAGE_LIMITS.maximumEveryRoomSendsPerMin} times a minute.`, "Put what you send in one message, or wait a minute.");
}

/**
 * A built-in game server's way to its game's other rooms, from the room fromRoomCode or (null) its server outside
 * rooms. Calls come checked (RoomCore and newServer check them).
 */
export function roomReachOf(env: Env, game: ReachedGame, fromRoomCode: string | null): ServerRoomReach {
  const senderKind: RoomMessageSenderKind = fromRoomCode === null ? "server" : "room";
  return {
    sendToRoom: async (toRoomCode, message) => ({ isDelivered: (await sendRoomMessage(env, game, toRoomCode, roomMessageOf(message, senderKind, fromRoomCode))) === "delivered" }),
    sendToEveryRoom: async (message, labels) => {
      const sent = await sendToEveryRoom(env, game, { labels, roomMessage: roomMessageOf(message, senderKind, fromRoomCode), exceptRoomCode: fromRoomCode, isCounted: true });
      if (sent.isLimited) throw everyRoomSendLimit(`${senderKind}.sendToEveryRoom`);
      return { roomCount: sent.roomCount };
    },
    listRooms: async (labels) => ({ rooms: await listRooms(env, game, labels) }),
    getRoom: (roomCode) => getRoom(env, game, roomCode),
    kickFromRoom: async (roomCode, playerId, message, isKeptOut) => ({ isDone: (await kickFromRoom(env, game, roomCode, { playerId, message, isKeptOut })) === "kicked" }),
    endRoom: async (roomCode, message) => ({ isDone: (await endRoom(env, game, roomCode, message ?? null)) === "ended" }),
  };
}

/**
 * The same calls for a game server in its sandbox (sandbox.ts), for the game fixed by props it can't see. The sandbox
 * checks each call first, as a room on the developer's own server would; what comes here is checked again, since the
 * game's code can reach this binding itself. A send to every room past the limit answers isLimited, which the sandbox
 * throws as room_call_limit.
 */
export class RoomReachBinding extends WorkerEntrypoint<Env, { gameId: string }> {
  private async game(): Promise<ReachedGame | null> {
    const row = await this.env.DB.prepare("SELECT slug FROM games WHERE id = ?").bind(this.ctx.props.gameId).first<{ slug: string }>();
    return row ? { gameId: this.ctx.props.gameId, slug: row.slug } : null;
  }

  async sendToRoom(toRoomCode: unknown, message: unknown, fromRoomCode: unknown): Promise<{ isDelivered: boolean }> {
    const game = await this.game();
    const checked = checkRoomMessage(message);
    if (!game || typeof toRoomCode !== "string" || !checked.isValid || toRoomCode === fromRoomCode) return { isDelivered: false };
    const from = typeof fromRoomCode === "string" && isRoomCode(fromRoomCode) ? fromRoomCode : null;
    return { isDelivered: (await sendRoomMessage(this.env, game, toRoomCode, roomMessageOf(checked.checkedMessage, from ? "room" : "server", from))) === "delivered" };
  }

  async sendToEveryRoom(message: unknown, labels: unknown, fromRoomCode: unknown): Promise<{ roomCount: number; isLimited: boolean }> {
    const game = await this.game();
    const checked = checkRoomMessage(message);
    if (!game || !checked.isValid || (labels !== null && !isRoomLabels(labels))) return { roomCount: 0, isLimited: false };
    const from = typeof fromRoomCode === "string" && isRoomCode(fromRoomCode) ? fromRoomCode : null;
    return sendToEveryRoom(this.env, game, { labels: labels as Record<string, string> | null, roomMessage: roomMessageOf(checked.checkedMessage, from ? "room" : "server", from), exceptRoomCode: from, isCounted: true });
  }

  async listRooms(labels: unknown): Promise<{ rooms: LiveRoom[] }> {
    const game = await this.game();
    if (!game || (labels !== null && !isRoomLabels(labels))) return { rooms: [] };
    return { rooms: await listRooms(this.env, game, labels as Record<string, string> | null) };
  }

  async getRoom(roomCode: unknown): Promise<{ room: LiveRoom; players: RoomPlayer[] } | null> {
    const game = await this.game();
    return game && typeof roomCode === "string" ? getRoom(this.env, game, roomCode) : null;
  }

  async kickFromRoom(roomCode: unknown, playerId: unknown, message: unknown, isKeptOut: unknown): Promise<{ isDone: boolean }> {
    const game = await this.game();
    if (!game || typeof roomCode !== "string" || typeof playerId !== "string" || !playerId) return { isDone: false };
    const shownMessage = typeof message === "string" ? message.slice(0, ROOM_LIMITS.maximumKickMessageCharacterCount) : "";
    return { isDone: (await kickFromRoom(this.env, game, roomCode, { playerId, message: shownMessage, isKeptOut: isKeptOut === true })) === "kicked" };
  }

  async endRoom(roomCode: unknown, message: unknown): Promise<{ isDone: boolean }> {
    const game = await this.game();
    if (!game || typeof roomCode !== "string") return { isDone: false };
    return { isDone: (await endRoom(this.env, game, roomCode, typeof message === "string" ? message.slice(0, ROOM_LIMITS.maximumKickMessageCharacterCount) : null)) === "ended" };
  }
}

/** Scheduled sends handed out a run, oldest due first; the rest go the next minute. */
const DUE_SEND_COUNT = 50;

/**
 * Every minute (index.ts): hand out the scheduled sends to every room that are due, through sendToEveryRoom, and
 * record when and to how many rooms. Each is claimed before it goes, so a run that overlaps the next never sends one
 * twice. A game that can't be played then (no live version, held, taken down, its hosting paused, or deleted) has its
 * send recorded with delivered_room_count 0.
 */
export async function sendDueRoomMessages(env: Env, nowMs = Date.now()): Promise<number> {
  const { results } = await env.DB.prepare(
    "SELECT s.id, s.game_id, s.room_message_json, s.labels_json, g.slug, g.review_status, g.live_version_id FROM scheduled_room_messages s LEFT JOIN games g ON g.id = s.game_id WHERE s.sent_at_ms IS NULL AND s.send_at_ms <= ? ORDER BY s.send_at_ms LIMIT ?",
  )
    .bind(nowMs, DUE_SEND_COUNT)
    .all<{ id: string; game_id: string; room_message_json: string; labels_json: string | null; slug: string | null; review_status: string | null; live_version_id: string | null }>();
  let sentCount = 0;
  for (const row of results) {
    const claimed = await env.DB.prepare("UPDATE scheduled_room_messages SET sent_at_ms = ? WHERE id = ? AND sent_at_ms IS NULL").bind(nowMs, row.id).run();
    if (!claimed.meta.changes) continue;
    const isPlayable = row.slug !== null && row.review_status === "live" && row.live_version_id !== null && !(await isHostingPaused(env.DB, row.game_id, nowMs)).isPaused;
    let deliveredRoomCount = 0;
    if (isPlayable) {
      try {
        const sent = await sendToEveryRoom(env, { gameId: row.game_id, slug: row.slug! }, { labels: row.labels_json ? (JSON.parse(row.labels_json) as Record<string, string>) : null, roomMessage: roomMessageOf(JSON.parse(row.room_message_json), "developer", null, nowMs), exceptRoomCode: null, isCounted: false });
        deliveredRoomCount = sent.roomCount;
      } catch (error) {
        console.error("Couldn't hand out a scheduled room message:", row.id, error);
      }
    }
    await env.DB.prepare("UPDATE scheduled_room_messages SET delivered_room_count = ? WHERE id = ?").bind(deliveredRoomCount, row.id).run();
    sentCount++;
  }
  return sentCount;
}
