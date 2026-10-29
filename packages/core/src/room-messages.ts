import { ROOM_LIMITS, ROOM_MESSAGE_LIMITS, ROOM_MESSAGE_SENDER_KINDS, checkRoomData, type LiveRoom } from "@zaisma/game-server/internal";
import { ROOM_STALE_MS } from "./types.ts";

/**
 * A game reaching its own live rooms: its game server (room.sendToRoom, room.sendToEveryRoom, room.listRooms and the
 * server's calls), its developer's scripts through the API and their AI through the MCP. The rooms Worker delivers
 * (apps/rooms/src/room-reach.ts); the site answers the API (apps/site/src/room-messages-api.ts). Both read the game's
 * live rooms from live_rooms here, so a list means the same wherever it's asked.
 */

export { ROOM_MESSAGE_LIMITS, ROOM_MESSAGE_SENDER_KINDS };

/** A room message's content as the API and the rooms take it: plain JSON within ROOM_MESSAGE_LIMITS.maximumRoomMessageSizeBytes, copied. Nothing (null) isn't a message. */
export function checkRoomMessage(message: unknown): { isValid: true; checkedMessage: unknown } | { isValid: false } {
  if (message === undefined || message === null) return { isValid: false };
  const checked = checkRoomData(message, ROOM_MESSAGE_LIMITS.maximumRoomMessageSizeBytes);
  return checked.isValid ? { isValid: true, checkedMessage: checked.checkedData } : { isValid: false };
}

/** Labels a room selection gives, as the rooms hold them: text by name, up to the room label count. Anything else isn't a selection. */
export function isRoomLabels(given: unknown): given is Record<string, string> {
  return typeof given === "object" && given !== null && !Array.isArray(given) && Object.keys(given).length <= ROOM_LIMITS.maximumLabelCount && Object.values(given).every((labelValue) => typeof labelValue === "string");
}

/** A live room as listed, with when it was made in epoch milliseconds, for a list that continues past it. */
export type LiveRoomRecord = LiveRoom & { createdAtMs: number };

interface LiveRoomRow {
  room_code: string;
  name: string | null;
  labels: string;
  player_count: number;
  maximum_player_count: number;
  spectator_count: number;
  is_listed: number;
  is_open: number;
  is_kept: number;
  version_id: string | null;
  continent: string | null;
  created_at_ms: number;
}

/**
 * The game's live rooms, newest first: rooms that checked in within ROOM_STALE_MS, and kept rooms asleep with their
 * row, holding every label given (null: every room). isSomeoneIn: only rooms with a player or spectator in them.
 * before: continue past that room. Up to roomCount, plus one more when there are more, so the caller knows.
 */
export async function listLiveRooms(database: D1Database, gameId: string, listing: { labels: Record<string, string> | null; roomCount: number; isSomeoneIn?: boolean; exceptRoomCode?: string | null; before?: { createdAtMs: number; roomCode: string } | null }, nowMs = Date.now()): Promise<LiveRoomRecord[]> {
  const conditions = ["game_id = ?", "(updated_at_ms >= ? OR is_kept = 1)"];
  const values: (string | number)[] = [gameId, nowMs - ROOM_STALE_MS];
  if (listing.isSomeoneIn) conditions.push("player_count + spectator_count > 0");
  if (listing.exceptRoomCode) {
    conditions.push("room_code != ?");
    values.push(listing.exceptRoomCode);
  }
  for (const [labelName, labelValue] of Object.entries(listing.labels ?? {})) {
    conditions.push("EXISTS (SELECT 1 FROM json_each(live_rooms.labels) WHERE json_each.key = ? AND json_each.value = ?)");
    values.push(labelName, labelValue);
  }
  if (listing.before) {
    conditions.push("(created_at_ms < ? OR (created_at_ms = ? AND room_code < ?))");
    values.push(listing.before.createdAtMs, listing.before.createdAtMs, listing.before.roomCode);
  }
  const { results } = await database
    .prepare(`SELECT ${LIVE_ROOM_COLUMNS} FROM live_rooms WHERE ${conditions.join(" AND ")} ORDER BY created_at_ms DESC, room_code DESC LIMIT ?`)
    .bind(...values, listing.roomCount + 1)
    .all<LiveRoomRow>();
  return results.map(listedRoomOf);
}

/** One live room of the game by its code (live as listLiveRooms means it), or null. */
export async function liveRoomOf(database: D1Database, gameId: string, roomCode: string, nowMs = Date.now()): Promise<LiveRoomRecord | null> {
  const row = await database
    .prepare(`SELECT ${LIVE_ROOM_COLUMNS} FROM live_rooms WHERE game_id = ? AND room_code = ? AND (updated_at_ms >= ? OR is_kept = 1)`)
    .bind(gameId, roomCode, nowMs - ROOM_STALE_MS)
    .first<LiveRoomRow>();
  return row ? listedRoomOf(row) : null;
}

const LIVE_ROOM_COLUMNS = "room_code, name, labels, player_count, maximum_player_count, spectator_count, is_listed, is_open, is_kept, version_id, continent, created_at_ms";

function listedRoomOf(row: LiveRoomRow): LiveRoomRecord {
  return {
    roomCode: row.room_code,
    name: row.name,
    labels: labelsOf(row.labels),
    playerCount: row.player_count,
    maximumPlayerCount: row.maximum_player_count,
    spectatorCount: row.spectator_count,
    isListed: row.is_listed === 1,
    isOpen: row.is_open === 1,
    isKept: row.is_kept === 1,
    versionId: row.version_id,
    continent: row.continent,
    createdAt: new Date(row.created_at_ms).toISOString(),
    createdAtMs: row.created_at_ms,
  };
}

function labelsOf(text: string): Record<string, string> {
  try {
    const labels = JSON.parse(text) as unknown;
    return isRoomLabels(labels) ? labels : {};
  } catch {
    return {};
  }
}
