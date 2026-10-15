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
export const FREE_PLAYER_HOURS = 1000;

/** A game's player time in Zaisma rooms this month (UTC), in seconds. Running rooms add theirs at least hourly. */
export async function monthPlayerSeconds(db: D1Database, gameId: string, now = Date.now()): Promise<number> {
  const row = await db
    .prepare("SELECT COALESCE(SUM(player_seconds), 0) AS seconds FROM room_usage WHERE game_id = ? AND day >= ?")
    .bind(gameId, `${new Date(now).toISOString().slice(0, 7)}-01`)
    .first<{ seconds: number }>();
  return row?.seconds ?? 0;
}

/** How long a room key gives passes, and how many: enough to rejoin, not to fill rooms. */
export const ROOM_KEY_MS = 6 * 3_600_000;
export const PASSES_PER_KEY = 5;

/**
 * A key to multiplayer for a browser Cloudflare's check on Play said is real: the game page hands it to
 * its game, which trades it for player passes (useRoomKey). Nothing about the player.
 */
export async function issueRoomKey(db: D1Database, gameId: string, now = Date.now()): Promise<string> {
  const id = newId("room_key");
  await db.prepare("INSERT INTO room_keys (id, game_id, issued_at) VALUES (?, ?, ?)").bind(id, gameId, now).run();
  return id;
}

/** Take one pass from a game's room key, if it's this game's, still good and not used up. */
export async function useRoomKey(db: D1Database, gameId: string, key: unknown, now = Date.now()): Promise<boolean> {
  if (!isIdOf("room_key", key)) return false;
  const row = await db
    .prepare("UPDATE room_keys SET passes = passes + 1 WHERE id = ? AND game_id = ? AND issued_at > ? AND passes < ? RETURNING id")
    .bind(key, gameId, now - ROOM_KEY_MS, PASSES_PER_KEY)
    .first();
  return row !== null;
}

/** Whether a game has used this month's free tier, so its new rooms don't open. */
export async function pastFreeTier(db: D1Database, gameId: string, now = Date.now()): Promise<boolean> {
  return (await monthPlayerSeconds(db, gameId, now)) >= FREE_PLAYER_HOURS * 3600;
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
const isCountry = (c: string | null): c is string => Boolean(c && /^[A-Z]{2}$/.test(c) && c !== "XX");

/** Room with space a new player could join. */
export const hasSpace = (room: Pick<ListedRoom, "isOpen" | "playerCount" | "heldSeatCount" | "maximumPlayerCount">) => room.isOpen && room.playerCount + room.heldSeatCount < room.maximumPlayerCount;

/**
 * A game's listed rooms, optionally in one region (a continent code), and how many are playing in
 * all its rooms. Pass where the asking player
 * is to put rooms in their country, then their continent, first. With cacheSeconds, each place
 * answers from a short-lived copy, so a busy game page reads the database a few times a minute,
 * not once per visitor.
 */
export async function listRooms(
  db: D1Database,
  gameId: string,
  opts: { country?: string | null; continent?: string | null; region?: string | null; labels?: Record<string, string> | null; cacheSeconds?: number; now?: number } = {},
): Promise<RoomList> {
  const near = opts.continent && CONTINENTS[opts.continent] ? opts.continent : null;
  const here = isCountry(opts.country ?? null) ? opts.country! : null;
  const region = opts.region && CONTINENTS[opts.region] ? opts.region : null;
  const wanted = Object.entries(opts.labels ?? {}).filter(([k, v]) => typeof k === "string" && typeof v === "string" && k && v).slice(0, 4);
  const seconds = opts.cacheSeconds ?? 0;
  const key = new Request(
    `https://rooms-list.zaisma.internal/v2/${encodeURIComponent(gameId)}/${here ?? "any"}/${near ?? "any"}/${region ?? "all"}?labels=${encodeURIComponent(JSON.stringify(wanted))}`,
  );
  const cache = seconds > 0 ? (caches as unknown as { default: Cache }).default : null;
  const hit = await cache?.match(key);
  if (hit) return hit.json();

  const { results } = await db
    .prepare("SELECT * FROM live_rooms WHERE game_id = ? AND updated_at > ?")
    .bind(gameId, (opts.now ?? Date.now()) - ROOM_STALE_MS)
    .all<LiveRoom>();
  const continent = (r: LiveRoom) => (r.continent && CONTINENTS[r.continent] ? r.continent : null);
  // Hidden rooms count toward "playing now"; only listed ones are ever shown.
  const all = results.filter((r) => r.listed === 1).map(
    (r): ListedRoom => ({
      roomCode: r.code,
      playerCount: r.players,
      heldSeatCount: r.held ?? 0,
      maximumPlayerCount: r.max_players,
      isOpen: r.open === 1,
      location: isCountry(r.country) ? { countryCode: r.country, countryName: countryName(r.country), region: continent(r) } : null,
      isNear: near !== null && r.continent === near,
      name: r.name_hidden ? null : r.name,
      labels: r.name_hidden ? {} : readLabels(r.labels),
    }),
  );
  const created = new Map(results.map((r) => [r.code, r.created_at]));
  const updated = new Map(results.map((r) => [r.code, r.updated_at]));
  const where = new Map(results.map((r) => [r.code, continent(r)]));
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
    playing: { playerCount: results.reduce((total, r) => total + r.players, 0), roomCount: results.length, closedRoomCount: all.filter((room) => !room.isOpen).length },
    joinableRoomCount: all.filter(hasSpace).length,
    openRoomCount: inRegion.filter((room) => room.isOpen).length,
    regions: [...regions.values()].sort((first, second) => second.playerCount - first.playerCount || second.roomCount - first.roomCount),
    region,
    moreOpenRoomCount: inRegion.filter((room) => room.isOpen).length - shown.filter((room) => room.isOpen).length,
    filters: labelFilters(all),
    changedAtMs: Object.fromEntries(shown.map((room) => [room.roomCode, updated.get(room.roomCode)!])),
  };
  if (cache) await cache.put(key, Response.json(list, { headers: { "Cache-Control": `max-age=${seconds}` } }));
  return list;
}

/** How long after leaving a room a player's own lists leave them out of it, while room lists catch up. */
export const LEFT_FOR_MS = 30_000;

/**
 * A room list as the player who just left a room should see it: without themselves in it, so nobody
 * sees their own ghost while lists catch up (copies can be up to 10 seconds old). The room writes its
 * row as players come and go, so only a copy of its row written after they joined (joinedAt) and
 * before they left (leftAt) counts them: one from later already counts them out, and one from before
 * never counted them. Honest clients say which room they left (docs/DECISIONS.md); it only changes
 * what that player sees. The list sent to games leaves out changed.
 */
export function leaveOut(list: RoomList, left: { code: string; at: number; joined: number }, now = Date.now()): RoomList {
  const changedAtMs = list.changedAtMs?.[left.code];
  // A second's leeway each way: the room writes its row a moment before or after the player's game hears it.
  if (changedAtMs === undefined || now - left.at > LEFT_FOR_MS || changedAtMs >= left.at - 1000 || changedAtMs < left.joined - 1000) return list;
  const room = list.rooms.find((listed) => listed.roomCode === left.code);
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
export function readLeftParam(v: string | null, now = Date.now()): { code: string; at: number; joined: number } | null {
  const m = v?.match(/^([23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6})\.(\d{1,6})\.(\d{1,9})$/);
  return m && Number(m[3]) >= Number(m[2]) ? { code: m[1]!, at: now - Number(m[2]), joined: now - Number(m[3]) } : null;
}

function readLabels(json: string): Record<string, string> {
  try {
    const v = JSON.parse(json) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === "string")) : {};
  } catch {
    return {};
  }
}

/** Labels at least two rooms have, with 2 to 12 values: the ones worth a filter. Up to 3, most used first. */
function labelFilters(rooms: ListedRoom[]): { label: string; values: string[] }[] {
  // Values that differ only in capitals are one choice (filtering ignores them), spelled as first seen.
  const seen = new Map<string, Map<string, { value: string; rooms: number }>>();
  for (const r of rooms) {
    for (const [k, v] of Object.entries(r.labels)) {
      const values = seen.get(k) ?? new Map<string, { value: string; rooms: number }>();
      const entry = values.get(v.toLowerCase()) ?? { value: v, rooms: 0 };
      entry.rooms++;
      values.set(v.toLowerCase(), entry);
      seen.set(k, values);
    }
  }
  return [...seen.entries()]
    .map(([label, byValue]) => {
      const values = [...byValue.values()].sort((a, b) => b.rooms - a.rooms || a.value.localeCompare(b.value));
      return { label, values: values.map((v) => v.value), rooms: values.reduce((n, v) => n + v.rooms, 0) };
    })
    .filter((f) => f.rooms >= 2 && f.values.length >= 2 && f.values.length <= 12)
    .sort((a, b) => b.rooms - a.rooms)
    .slice(0, 3)
    .map(({ label, values }) => ({ label, values }));
}

/** Labels to filter by, as sent in a list request: JSON like {"Mode": "Classic"}. */
export function readLabelParam(v: string | null): Record<string, string> | null {
  if (!v || v.length > 500) return null;
  try {
    const parsed = JSON.parse(v) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.fromEntries(Object.entries(parsed).filter(([, x]) => typeof x === "string")) : null;
  } catch {
    return null;
  }
}
