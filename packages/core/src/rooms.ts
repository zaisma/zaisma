import { isIdOf, newId } from "./ids.ts";
import { CONTINENTS, ROOM_STALE_MS, type LiveRoom } from "./types.ts";

/**
 * A room as players see it in a room list, in the SDK's words (docs/NAMING.md): the SDK hands it to
 * games as it is (Zaisma.rooms.list). Never who's in it.
 */
export interface ListedRoom {
  roomCode: string;
  /** Players in the match, not counting players who walked away. */
  playerCount: number;
  /** Seats the room holds for players coming back or on their way: it has space while playerCount + heldSeatCount < maximumPlayerCount. */
  heldSeatCount: number;
  maximumPlayerCount: number;
  /** False: closed, only players who were already in it can come back. */
  isOpen: boolean;
  /** Where the room runs: the country its first player connected from (like DE and Germany), and its region (a continent, like EU). */
  location: { countryCode: string; countryName: string; region: string | null } | null;
  /** In the same region as the player asking. */
  isNear: boolean;
  /**
   * The room's name and labels as the game set them (gone if a person hid them after a report). Some
   * may be typed by players: zaisma.com shows them only if they pass checkText.
   */
  name: string | null;
  labels: Record<string, string>;
}

export interface RoomList {
  /** Rooms with space first (same country, then same continent, then the busiest), then full and closed ones. Up to 50, in the region asked for. */
  rooms: ListedRoom[];
  /** Everyone playing in the game's rooms everywhere, listed or not (for "playing now"), and how many listed rooms are closed. */
  playing: { playerCount: number; roomCount: number; closedRoomCount: number };
  /** Rooms a player could join right now, everywhere. */
  joinableRoomCount: number;
  /**
   * Listed rooms taking players, full ones too, in the region and with the labels asked for: the rooms
   * the list shows plus the ones past them (moreOpenRoomCount). The number on the game page's Rooms tab.
   */
  openRoomCount: number;
  /** The regions (continents, like EU) with listed rooms, busiest first, for a region filter. */
  regions: { region: string; name: string; roomCount: number; playerCount: number }[];
  /** The region the rooms are filtered to, or null for everywhere. */
  region: string | null;
  /** Open rooms in that region past the ones listed. */
  moreOpenRoomCount: number;
  /** Labels worth filtering by: ones that several rooms have, with a handful of values. */
  filters: { label: string; values: string[] }[];
  /** When each listed room's row last changed, by room code, for leaveOut. Zaisma's own, not for games. */
  changedAtMs?: Record<string, number>;
}

const MAXIMUM_SHOWN_ROOM_COUNT = 50;

/**
 * Until Hosting billing exists, each game's rooms stop at the free tier, 1,000 player-hours a month
 * (UTC): rooms already running carry on, new ones don't open until the month resets (docs/DECISIONS.md).
 */
export const FREE_ROOM_PLAY_DURATION_HOURS = 1000;

/** A game's player time in Zaisma rooms this month (UTC), in seconds. Running rooms add theirs at least hourly. */
export async function roomPlayDurationSecThisMonth(database: D1Database, gameId: string, nowMs = Date.now()): Promise<number> {
  const row = await database
    .prepare("SELECT COALESCE(SUM(room_play_duration_sec), 0) AS room_play_duration_sec FROM room_usage WHERE game_id = ? AND date >= ?")
    .bind(gameId, `${new Date(nowMs).toISOString().slice(0, 7)}-01`)
    .first<{ room_play_duration_sec: number }>();
  return row?.room_play_duration_sec ?? 0;
}

/**
 * Requests to a game's own game server (onRequest) free each month, per game (Julius, Oct 16, 2026):
 * at most about $0.80 a month at Cloudflare's prices. Until Hosting billing, a game past them gets
 * request_limit until the month resets (UTC).
 */
export const FREE_REQUEST_COUNT_PER_MONTH = 1_000_000;

/** A game's requests to its game server this month (UTC), as recorded: its object adds them about once a minute. */
export async function requestCountThisMonth(database: D1Database, gameId: string, nowMs = Date.now()): Promise<number> {
  const row = await database
    .prepare("SELECT COALESCE(SUM(game_server_request_count), 0) AS request_count FROM room_usage WHERE game_id = ? AND date >= ?")
    .bind(gameId, `${new Date(nowMs).toISOString().slice(0, 7)}-01`)
    .first<{ request_count: number }>();
  return row?.request_count ?? 0;
}

/** How long a room key gives passes, and how many: enough to rejoin, not to fill rooms. */
export const ROOM_KEY_MS = 6 * 3_600_000;
export const PASS_COUNT_PER_KEY = 5;

/**
 * A key to multiplayer for a browser Cloudflare's check on Play said is real: the game page hands it to
 * its game, which trades it for player passes (useRoomKey). For a signed-in player it names their
 * account, so the passes are for it; otherwise nothing about the player.
 */
export async function issueRoomKey(database: D1Database, gameId: string, accountId: string | null = null, nowMs = Date.now()): Promise<string> {
  const id = newId("room_key");
  await database.prepare("INSERT INTO room_keys (id, game_id, account_id, issued_at_ms) VALUES (?, ?, ?, ?)").bind(id, gameId, accountId, nowMs).run();
  return id;
}

/**
 * Take one pass from a game's room key, if it's this game's, still good and not used up: whose pass it
 * is (the account, or null for a guest), or null when the key gives none.
 */
export async function useRoomKey(database: D1Database, gameId: string, key: unknown, nowMs = Date.now()): Promise<{ accountId: string | null } | null> {
  if (!isIdOf("room_key", key)) return null;
  const row = await database
    .prepare("UPDATE room_keys SET pass_count = pass_count + 1 WHERE id = ? AND game_id = ? AND issued_at_ms > ? AND pass_count < ? RETURNING account_id")
    .bind(key, gameId, nowMs - ROOM_KEY_MS, PASS_COUNT_PER_KEY)
    .first<{ account_id: string | null }>();
  return row ? { accountId: row.account_id } : null;
}

/** Whether a game has used this month's free tier, so its new rooms don't open. */
export async function pastFreeTier(database: D1Database, gameId: string, nowMs = Date.now()): Promise<boolean> {
  return (await roomPlayDurationSecThisMonth(database, gameId, nowMs)) >= FREE_ROOM_PLAY_DURATION_HOURS * 3600;
}

/** A country's name in English, like Germany for DE. */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Countries Cloudflare names by a real two-letter code: not XX (unknown) or T1 (Tor). */
const isCountry = (countryCode: string | null): countryCode is string => Boolean(countryCode && /^[A-Z]{2}$/.test(countryCode) && countryCode !== "XX");

/** Room with space a new player could join. */
export const hasSpace = (room: Pick<ListedRoom, "isOpen" | "playerCount" | "heldSeatCount" | "maximumPlayerCount">) => room.isOpen && room.playerCount + room.heldSeatCount < room.maximumPlayerCount;

/**
 * A game's listed rooms, optionally in one region (a continent code), and how many are playing in
 * all its rooms. Pass where the asking player
 * is to put rooms in their country, then their continent, first. With cacheDurationSec, each place
 * answers from a short-lived copy, so a busy game page reads the database a few times a minute,
 * not once per visitor.
 */
export async function listRooms(
  database: D1Database,
  gameId: string,
  options: { country?: string | null; continent?: string | null; region?: string | null; labels?: Record<string, string> | null; cacheDurationSec?: number; nowMs?: number } = {},
): Promise<RoomList> {
  const near = options.continent && CONTINENTS[options.continent] ? options.continent : null;
  const here = isCountry(options.country ?? null) ? options.country! : null;
  const region = options.region && CONTINENTS[options.region] ? options.region : null;
  const wanted = Object.entries(options.labels ?? {}).filter(([labelName, labelValue]) => typeof labelName === "string" && typeof labelValue === "string" && labelName && labelValue).slice(0, 4);
  const cacheDurationSec = options.cacheDurationSec ?? 0;
  const key = new Request(
    `https://rooms-list.zaisma.internal/v2/${encodeURIComponent(gameId)}/${here ?? "any"}/${near ?? "any"}/${region ?? "all"}?labels=${encodeURIComponent(JSON.stringify(wanted))}`,
  );
  const cache = cacheDurationSec > 0 ? (caches as unknown as { default: Cache }).default : null;
  const hit = await cache?.match(key);
  if (hit) return hit.json();

  const { results } = await database
    .prepare("SELECT * FROM live_rooms WHERE game_id = ? AND updated_at_ms > ?")
    .bind(gameId, (options.nowMs ?? Date.now()) - ROOM_STALE_MS)
    .all<LiveRoom>();
  const continent = (row: LiveRoom) => (row.continent && CONTINENTS[row.continent] ? row.continent : null);
  // Hidden rooms count toward "playing now"; only listed ones are ever shown.
  const all = results.filter((row) => row.is_listed === 1).map(
    (row): ListedRoom => ({
      roomCode: row.room_code,
      playerCount: row.player_count,
      heldSeatCount: row.held_seat_count ?? 0,
      maximumPlayerCount: row.maximum_player_count,
      isOpen: row.is_open === 1,
      location: isCountry(row.country) ? { countryCode: row.country, countryName: countryName(row.country), region: continent(row) } : null,
      isNear: near !== null && row.continent === near,
      name: row.is_name_hidden ? null : row.name,
      labels: row.is_name_hidden ? {} : readLabels(row.labels),
    }),
  );
  const created = new Map(results.map((row) => [row.room_code, row.created_at_ms]));
  const updated = new Map(results.map((row) => [row.room_code, row.updated_at_ms]));
  const where = new Map(results.map((row) => [row.room_code, continent(row)]));
  const mine = (room: ListedRoom) => Number(here !== null && room.location?.countryCode === here);
  all.sort(
    (first, second) =>
      Number(hasSpace(second)) - Number(hasSpace(first)) ||
      mine(second) - mine(first) ||
      Number(second.isNear) - Number(first.isNear) ||
      second.playerCount - first.playerCount ||
      created.get(second.roomCode)! - created.get(first.roomCode)!,
  );

  const regions = new Map<string, RoomList["regions"][number]>();
  for (const room of all) {
    const regionCode = where.get(room.roomCode);
    if (!regionCode) continue;
    const entry = regions.get(regionCode) ?? { region: regionCode, name: CONTINENTS[regionCode]!, roomCount: 0, playerCount: 0 };
    entry.roomCount++;
    entry.playerCount += room.playerCount;
    regions.set(regionCode, entry);
  }
  const same = (first: string, second: string) => first.localeCompare(second, "en", { sensitivity: "base" }) === 0;
  const fits = (room: ListedRoom) => wanted.every(([labelName, labelValue]) => Object.entries(room.labels).some(([roomLabelName, roomLabelValue]) => same(roomLabelName, labelName) && same(roomLabelValue, labelValue)));
  const inRegion = all.filter((room) => (!region || where.get(room.roomCode) === region) && fits(room));
  const shown = inRegion.slice(0, MAXIMUM_SHOWN_ROOM_COUNT);
  const list: RoomList = {
    rooms: shown,
    playing: { playerCount: results.reduce((totalPlayerCount, row) => totalPlayerCount + row.player_count, 0), roomCount: results.length, closedRoomCount: all.filter((room) => !room.isOpen).length },
    joinableRoomCount: all.filter(hasSpace).length,
    openRoomCount: inRegion.filter((room) => room.isOpen).length,
    regions: [...regions.values()].sort((first, second) => second.playerCount - first.playerCount || second.roomCount - first.roomCount),
    region,
    moreOpenRoomCount: inRegion.filter((room) => room.isOpen).length - shown.filter((room) => room.isOpen).length,
    filters: labelFilters(all),
    changedAtMs: Object.fromEntries(shown.map((room) => [room.roomCode, updated.get(room.roomCode)!])),
  };
  if (cache) await cache.put(key, Response.json(list, { headers: { "Cache-Control": `max-age=${cacheDurationSec}` } }));
  return list;
}

/** How long after leaving a room a player's own lists leave them out of it, while room lists catch up. */
export const LEFT_FOR_MS = 30_000;

/**
 * A room list as the player who just left a room should see it: without themselves in it, so nobody
 * sees their own ghost while lists catch up (copies can be up to 10 seconds old). The room writes its
 * row as players come and go, so only a copy of its row written after they joined (joinedAtMs) and
 * before they left (leftAtMs) counts them: one from later already counts them out, and one from before
 * never counted them. Honest clients say which room they left (docs/DECISIONS.md); it only changes
 * what that player sees. The list sent to games leaves out changedAtMs.
 */
export function leaveOut(list: RoomList, left: { roomCode: string; leftAtMs: number; joinedAtMs: number }, nowMs = Date.now()): RoomList {
  const changedAtMs = list.changedAtMs?.[left.roomCode];
  // A second's leeway each way: the room writes its row a moment before or after the player's game hears it.
  if (changedAtMs === undefined || nowMs - left.leftAtMs > LEFT_FOR_MS || changedAtMs >= left.leftAtMs - 1000 || changedAtMs < left.joinedAtMs - 1000) return list;
  const room = list.rooms.find((listed) => listed.roomCode === left.roomCode);
  if (!room || room.playerCount < 1) return list;
  const isGone = room.playerCount === 1;
  const next: ListedRoom = { ...room, playerCount: room.playerCount - 1 };
  const regionCode = room.location?.region ?? null;
  return {
    ...list,
    rooms: isGone ? list.rooms.filter((listed) => listed !== room) : list.rooms.map((listed) => (listed === room ? next : listed)),
    playing: {
      playerCount: Math.max(0, list.playing.playerCount - 1),
      roomCount: list.playing.roomCount - Number(isGone),
      closedRoomCount: list.playing.closedRoomCount - Number(isGone && !room.isOpen),
    },
    joinableRoomCount: list.joinableRoomCount - Number(hasSpace(room)) + Number(!isGone && hasSpace(next)),
    openRoomCount: list.openRoomCount - Number(isGone && room.isOpen),
    regions: list.regions
      .map((entry) => (entry.region === regionCode ? { ...entry, playerCount: entry.playerCount - 1, roomCount: entry.roomCount - Number(isGone) } : entry))
      .filter((entry) => entry.roomCount > 0),
  };
}

/**
 * The room a player just left, as their lists send it (left=CODE.LEFT.JOINED: its code, and how many
 * milliseconds ago they left it and joined it), or null.
 */
export function readLeftParameter(given: string | null, nowMs = Date.now()): { roomCode: string; leftAtMs: number; joinedAtMs: number } | null {
  const match = given?.match(/^([23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6})\.(\d{1,6})\.(\d{1,9})$/);
  return match && Number(match[3]) >= Number(match[2]) ? { roomCode: match[1]!, leftAtMs: nowMs - Number(match[2]), joinedAtMs: nowMs - Number(match[3]) } : null;
}

function readLabels(json: string): Record<string, string> {
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.fromEntries(Object.entries(parsed).filter(([, labelValue]) => typeof labelValue === "string")) : {};
  } catch {
    return {};
  }
}

/** Labels at least two rooms have, with 2 to 12 values: the ones worth a filter. Up to 3, most used first. */
function labelFilters(rooms: ListedRoom[]): { label: string; values: string[] }[] {
  // Values that differ only in capitals are one choice (filtering ignores them), spelled as first seen.
  const seen = new Map<string, Map<string, { labelValue: string; roomCount: number }>>();
  for (const room of rooms) {
    for (const [labelName, labelValue] of Object.entries(room.labels)) {
      const values = seen.get(labelName) ?? new Map<string, { labelValue: string; roomCount: number }>();
      const entry = values.get(labelValue.toLowerCase()) ?? { labelValue, roomCount: 0 };
      entry.roomCount++;
      values.set(labelValue.toLowerCase(), entry);
      seen.set(labelName, values);
    }
  }
  return [...seen.entries()]
    .map(([label, byValue]) => {
      const values = [...byValue.values()].sort((first, second) => second.roomCount - first.roomCount || first.labelValue.localeCompare(second.labelValue));
      return { label, values: values.map((entry) => entry.labelValue), roomCount: values.reduce((totalRoomCount, entry) => totalRoomCount + entry.roomCount, 0) };
    })
    .filter((labelFilter) => labelFilter.roomCount >= 2 && labelFilter.values.length >= 2 && labelFilter.values.length <= 12)
    .sort((first, second) => second.roomCount - first.roomCount)
    .slice(0, 3)
    .map(({ label, values }) => ({ label, values }));
}

/** Labels to filter by, as sent in a list request: JSON like {"Mode": "Classic"}. */
export function readLabelParameter(given: string | null): Record<string, string> | null {
  if (!given || given.length > 500) return null;
  try {
    const parsed = JSON.parse(given) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.fromEntries(Object.entries(parsed).filter(([, labelValue]) => typeof labelValue === "string")) : null;
  } catch {
    return null;
  }
}
