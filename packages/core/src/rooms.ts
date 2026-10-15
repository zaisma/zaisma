import { isIdOf, newId } from "./ids.ts";
import { CONTINENTS, ROOM_STALE_MS, type LiveRoom } from "./types.ts";

/** A room as players see it in a room list. Never who's in it. */
export interface ListedRoom {
  code: string;
  /** Players in the match, not counting players who walked away. */
  players: number;
  /** Seats the room holds for players coming back or on their way: it has space while players + held < max. */
  held: number;
  max: number;
  /** False: closed, only players who were already in it can come back. */
  open: boolean;
  /** Where the room runs: the country its first player connected from (like DE), its name and continent (like EU). */
  location: { country: string; name: string; continent: string | null } | null;
  /** On the same continent as the player asking. */
  near: boolean;
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
  playing: { players: number; rooms: number; closed: number };
  /** Rooms a player could join right now, everywhere. */
  joinable: number;
  /**
   * Listed rooms taking players, full ones too, in the region and with the labels asked for: the rooms
   * the list shows plus the ones past them (more). The number on the game page's Rooms tab.
   */
  open: number;
  /** The regions (continents, like EU) with listed rooms, busiest first, for a region filter. */
  regions: { code: string; name: string; rooms: number; players: number }[];
  /** The region the rooms are filtered to, or null for everywhere. */
  region: string | null;
  /** Open rooms in that region past the ones listed. */
  more: number;
  /** Labels worth filtering by: ones that several rooms have, with a handful of values. */
  filters: { label: string; values: string[] }[];
  /** When each listed room's row last changed, for leaveOut. Zaisma's own, not for games. */
  changed?: Record<string, number>;
}

const MAX_SHOWN = 50;

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
export const hasSpace = (r: Pick<ListedRoom, "open" | "players" | "held" | "max">) => r.open && r.players + (r.held ?? 0) < r.max;

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
    `https://rooms-list.zaisma.internal/${encodeURIComponent(gameId)}/${here ?? "any"}/${near ?? "any"}/${region ?? "all"}?labels=${encodeURIComponent(JSON.stringify(wanted))}`,
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
      code: r.code,
      players: r.players,
      held: r.held ?? 0,
      max: r.max_players,
      open: r.open === 1,
      location: isCountry(r.country) ? { country: r.country, name: countryName(r.country), continent: continent(r) } : null,
      near: near !== null && r.continent === near,
      name: r.name_hidden ? null : r.name,
      labels: r.name_hidden ? {} : readLabels(r.labels),
    }),
  );
  const created = new Map(results.map((r) => [r.code, r.created_at]));
  const updated = new Map(results.map((r) => [r.code, r.updated_at]));
  const where = new Map(results.map((r) => [r.code, continent(r)]));
  const mine = (r: ListedRoom) => Number(here !== null && r.location?.country === here);
  all.sort((a, b) => Number(hasSpace(b)) - Number(hasSpace(a)) || mine(b) - mine(a) || Number(b.near) - Number(a.near) || b.players - a.players || created.get(b.code)! - created.get(a.code)!);

  const regions = new Map<string, { code: string; name: string; rooms: number; players: number }>();
  for (const r of all) {
    const code = where.get(r.code);
    if (!code) continue;
    const entry = regions.get(code) ?? { code, name: CONTINENTS[code]!, rooms: 0, players: 0 };
    entry.rooms++;
    entry.players += r.players;
    regions.set(code, entry);
  }
  const same = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" }) === 0;
  const fits = (r: ListedRoom) => wanted.every(([k, v]) => Object.entries(r.labels).some(([rk, rv]) => same(rk, k) && same(rv, v)));
  const inRegion = all.filter((r) => (!region || where.get(r.code) === region) && fits(r));
  const shown = inRegion.slice(0, MAX_SHOWN);
  const list: RoomList = {
    rooms: shown,
    playing: { players: results.reduce((n, r) => n + r.players, 0), rooms: results.length, closed: all.filter((r) => !r.open).length },
    joinable: all.filter(hasSpace).length,
    open: inRegion.filter((r) => r.open).length,
    regions: [...regions.values()].sort((a, b) => b.players - a.players || b.rooms - a.rooms),
    region,
    more: inRegion.filter((r) => r.open).length - shown.filter((r) => r.open).length,
    filters: labelFilters(all),
    changed: Object.fromEntries(shown.map((r) => [r.code, updated.get(r.code)!])),
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
  const changed = list.changed?.[left.code];
  // A second's leeway each way: the room writes its row a moment before or after the player's game hears it.
  if (changed === undefined || now - left.at > LEFT_FOR_MS || changed >= left.at - 1000 || changed < left.joined - 1000) return list;
  const code = left.code;
  const room = list.rooms.find((r) => r.code === code);
  if (!room || room.players < 1) return list;
  const gone = room.players === 1;
  const next: ListedRoom = { ...room, players: room.players - 1 };
  const continent = room.location?.continent ?? null;
  return {
    ...list,
    rooms: gone ? list.rooms.filter((r) => r !== room) : list.rooms.map((r) => (r === room ? next : r)),
    playing: { players: Math.max(0, list.playing.players - 1), rooms: list.playing.rooms - Number(gone), closed: list.playing.closed - Number(gone && !room.open) },
    joinable: list.joinable - Number(hasSpace(room)) + Number(!gone && hasSpace(next)),
    open: list.open - Number(gone && room.open),
    regions: list.regions.map((g) => (g.code === continent ? { ...g, players: g.players - 1, rooms: g.rooms - Number(gone) } : g)).filter((g) => g.rooms > 0),
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
