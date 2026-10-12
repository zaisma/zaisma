import { CONTINENTS, OPEN_ROOM_STALE_MS, type OpenRoom } from "./types.ts";

/** A room as players see it in a room list. Never who's in it. */
export interface ListedRoom {
  code: string;
  players: number;
  max: number;
  /** False: closed, only players who were already in it can come back. */
  open: boolean;
  /** Where the room runs: the country its first player connected from (like DE), its name and continent (like EU). */
  location: { country: string; name: string; continent: string | null } | null;
  /** On the same continent as the player asking. */
  near: boolean;
}

export interface RoomList {
  /** Rooms with space first (same country, then same continent, then the busiest), then full and closed ones. Up to 50. */
  rooms: ListedRoom[];
  /** Everyone in listed rooms, open or closed, and how many of those rooms are closed. */
  playing: { players: number; rooms: number; closed: number };
}

const MAX_SHOWN = 50;

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
export const hasSpace = (r: ListedRoom) => r.open && r.players < r.max;

/**
 * A game's listed rooms. Pass where the asking player is to put rooms in their country, then their
 * continent, first. With cacheSeconds, each place answers from a short-lived copy, so a busy game
 * page reads the database a few times a minute, not once per visitor.
 */
export async function listRooms(
  db: D1Database,
  gameId: string,
  opts: { country?: string | null; continent?: string | null; cacheSeconds?: number; now?: number } = {},
): Promise<RoomList> {
  const near = opts.continent && CONTINENTS[opts.continent] ? opts.continent : null;
  const here = isCountry(opts.country ?? null) ? opts.country! : null;
  const seconds = opts.cacheSeconds ?? 0;
  const key = new Request(`https://rooms-list.zaisma.internal/${encodeURIComponent(gameId)}/${here ?? "any"}/${near ?? "any"}`);
  const cache = seconds > 0 ? (caches as unknown as { default: Cache }).default : null;
  const hit = await cache?.match(key);
  if (hit) return hit.json();

  const { results } = await db
    .prepare("SELECT * FROM open_rooms WHERE game_id = ? AND updated_at > ?")
    .bind(gameId, (opts.now ?? Date.now()) - OPEN_ROOM_STALE_MS)
    .all<OpenRoom>();
  const all = results.map(
    (r): ListedRoom => ({
      code: r.code,
      players: r.players,
      max: r.max_players,
      open: r.open === 1,
      location: isCountry(r.country) ? { country: r.country, name: countryName(r.country), continent: r.continent && CONTINENTS[r.continent] ? r.continent : null } : null,
      near: near !== null && r.continent === near,
    }),
  );
  const created = new Map(results.map((r) => [r.code, r.created_at]));
  const mine = (r: ListedRoom) => Number(here !== null && r.location?.country === here);
  all.sort((a, b) => Number(hasSpace(b)) - Number(hasSpace(a)) || mine(b) - mine(a) || Number(b.near) - Number(a.near) || b.players - a.players || created.get(b.code)! - created.get(a.code)!);
  const list: RoomList = {
    rooms: all.slice(0, MAX_SHOWN),
    playing: { players: all.reduce((n, r) => n + r.players, 0), rooms: all.length, closed: all.filter((r) => !r.open).length },
  };
  if (cache) await cache.put(key, Response.json(list, { headers: { "Cache-Control": `max-age=${seconds}` } }));
  return list;
}
