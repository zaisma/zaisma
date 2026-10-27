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
  /** Spectators watching, and how many the room takes: 0 when its game server turns watching off. */
  spectatorCount: number;
  maximumSpectatorCount: number;
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
  /** Kept by its game server (room.setKept): a world that's still there with nobody in it, like a server waiting for players. */
  isKept: boolean;
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
 * One page of a game's rooms for zaisma.com's game page (listRoomPage): every listed room, a page at a time, in the order of the
 * list with matches in progress last, never cut at 50. Zaisma's own, not for games or the developer API.
 */
export interface RoomPage extends RoomList {
  /** Where the next page starts, to hand back as cursor; null on the last page. */
  nextCursor: string | null;
  /** The order the page's rooms are in, and whether open rooms with no space left are left out of it. */
  roomOrder: RoomOrder;
  isHidingFullRooms: boolean;
}

/**
 * The orders the game page's list can be in, each with matches in progress last: "best_to_join" is the order of listRooms (rooms with space
 * first, then the player's country and continent, then the busiest), "most_players" and "fewest_players" go by the players in each room, ties
 * keeping the best-to-join order.
 */
export const ROOM_ORDERS = ["best_to_join", "most_players", "fewest_players"] as const;
export type RoomOrder = (typeof ROOM_ORDERS)[number];

/** The order a list request asks for (room_order): anything that isn't one of ROOM_ORDERS is the default, best_to_join. */
export const readRoomOrderParameter = (given: string | null | undefined): RoomOrder => ROOM_ORDERS.find((roomOrder) => roomOrder === given) ?? "best_to_join";

/** Whether a list request leaves full rooms out (is_hiding_full_rooms): only "true" does. */
export const readIsHidingFullRoomsParameter = (given: string | null | undefined): boolean => given === "true";

/** The most rooms one page of the game page's room list holds. */
export const MAXIMUM_PAGE_ROOM_COUNT = 200;

/** Where a page of rooms starts, from a cursor it handed out: the first page for anything else. */
const roomPageStart = (cursor: string | null | undefined) => (cursor && /^\d{1,6}$/.test(cursor) ? Number(cursor) : 0);

/**
 * How long a running match gets to finish once its game's hosting pauses (hosting.ts), counted from the pause, so
 * every room of the game ends together (Julius, Oct 18, 2026).
 */
export const MATCH_FINISH_DURATION_SEC = 3600;

/** The share of a game's free allowance or budget, in percent, that raises its heads-up alert (Julius, Oct 18, 2026). */
export const NEARLY_USED_PCT = 80;

/**
 * A game's use of rooms and the relay this month (UTC): player time in Zaisma rooms (running rooms add theirs at
 * least hourly), the data Zaisma's relay sent its players (read from Cloudflare about once an hour) and the time its
 * own game server ran in its rooms. Facts for tuning; the meter prices them in hosting.ts.
 */
export async function roomUseThisMonth(database: D1Database, gameId: string, nowMs = Date.now()): Promise<{ roomPlayDurationSec: number; relayedSizeBytes: number; gameServerCpuDurationMs: number }> {
  const row = await database
    .prepare("SELECT COALESCE(SUM(room_play_duration_sec), 0) AS room_play_duration_sec, COALESCE(SUM(relayed_size_bytes), 0) AS relayed_size_bytes, COALESCE(SUM(game_server_cpu_duration_ms), 0) AS game_server_cpu_duration_ms FROM room_usage WHERE game_id = ? AND date >= ?")
    .bind(gameId, `${new Date(nowMs).toISOString().slice(0, 7)}-01`)
    .first<{ room_play_duration_sec: number; relayed_size_bytes: number; game_server_cpu_duration_ms: number }>();
  return { roomPlayDurationSec: row?.room_play_duration_sec ?? 0, relayedSizeBytes: row?.relayed_size_bytes ?? 0, gameServerCpuDurationMs: row?.game_server_cpu_duration_ms ?? 0 };
}

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

/**
 * A guest's room key, traded for a key to their account's passes when they sign in while the game runs
 * (Zaisma.player.signIn): the guest's key goes, and the new one runs out when it would have. Null when
 * the key isn't this game's, has run out, or is already an account's or traded.
 */
export async function tradeRoomKey(database: D1Database, gameId: string, key: unknown, accountId: string, nowMs = Date.now()): Promise<string | null> {
  if (!isIdOf("room_key", key)) return null;
  const row = await database
    .prepare("DELETE FROM room_keys WHERE id = ? AND game_id = ? AND account_id IS NULL AND issued_at_ms > ? RETURNING issued_at_ms")
    .bind(key, gameId, nowMs - ROOM_KEY_MS)
    .first<{ issued_at_ms: number }>();
  return row ? issueRoomKey(database, gameId, accountId, row.issued_at_ms) : null;
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
export const isCountry = (countryCode: string | null): countryCode is string => Boolean(countryCode && /^[A-Z]{2}$/.test(countryCode) && countryCode !== "XX");

/** A game joins players automatically (its Rooms tab says Play finds you one) for this long after a player last came in through quickJoin. */
export const QUICK_JOIN_KEPT_MS = 30 * 24 * 3600_000;
/** A game's last quick join is written at most this often. */
const QUICK_JOIN_WRITE_MS = 24 * 3600_000;

/** A player came into one of the game's rooms through Zaisma.rooms.quickJoin: written at most once a day a game. */
export async function noteQuickJoin(database: D1Database, gameId: string, nowMs = Date.now()): Promise<void> {
  await database
    .prepare("UPDATE games SET quick_joined_at_ms = ?1 WHERE id = ?2 AND (quick_joined_at_ms IS NULL OR quick_joined_at_ms < ?3)")
    .bind(nowMs, gameId, nowMs - QUICK_JOIN_WRITE_MS)
    .run();
}

/** Whether the game joins players automatically: one of its players came in through quickJoin lately. */
export const isQuickJoining = (game: { quick_joined_at_ms: number | null }, nowMs = Date.now()) => game.quick_joined_at_ms !== null && game.quick_joined_at_ms > nowMs - QUICK_JOIN_KEPT_MS;

/** Room with space a new player could join. */
export const hasSpace = (room: Pick<ListedRoom, "isOpen" | "playerCount" | "heldSeatCount" | "maximumPlayerCount">) => room.isOpen && room.playerCount + room.heldSeatCount < room.maximumPlayerCount;

/** Room to watch: the room takes spectators and has space for another. A closed or full room can still be watched. */
export const hasWatchSpace = (room: Pick<ListedRoom, "spectatorCount" | "maximumSpectatorCount">) => room.maximumSpectatorCount > 0 && room.spectatorCount < room.maximumSpectatorCount;

/**
 * A game's listed rooms, optionally in one region (a continent code), and how many are playing in
 * all its rooms. Pass where the asking player
 * is to put rooms in their country, then their continent, first. With cacheDurationSec, each place
 * answers from a short-lived copy, so a busy game page reads the database a few times a minute,
 * not once per visitor.
 */
export async function listRooms(database: D1Database, gameId: string, options: RoomListOptions = {}): Promise<RoomList> {
  return readRooms(database, gameId, options, null);
}

type RoomListOptions = { country?: string | null; continent?: string | null; region?: string | null; labels?: Record<string, string> | null; cacheDurationSec?: number; nowMs?: number };

/**
 * A page of a game's listed rooms, for the game page: the same rooms and order as listRooms, with matches in progress (closed rooms) after
 * the open ones, full or not, and no cut at 50. cursor says where the page starts (the nextCursor of the page before; left out, the first
 * page) and pageRoomCount how many rooms it holds (up to MAXIMUM_PAGE_ROOM_COUNT). A game with thousands of rooms is sent a page at a time.
 */
export async function listRoomPage(
  database: D1Database,
  gameId: string,
  options: RoomListOptions & { cursor?: string | null; pageRoomCount: number; roomOrder?: RoomOrder | null; isHidingFullRooms?: boolean },
): Promise<RoomPage> {
  const pageRoomCount = Math.max(1, Math.min(MAXIMUM_PAGE_ROOM_COUNT, Math.floor(options.pageRoomCount)));
  const page: RoomPageRequest = { startIndex: roomPageStart(options.cursor), pageRoomCount, roomOrder: readRoomOrderParameter(options.roomOrder), isHidingFullRooms: options.isHidingFullRooms === true };
  return (await readRooms(database, gameId, options, page)) as RoomPage;
}

type RoomPageRequest = { startIndex: number; pageRoomCount: number; roomOrder: RoomOrder; isHidingFullRooms: boolean };

async function readRooms(database: D1Database, gameId: string, options: RoomListOptions, page: RoomPageRequest | null): Promise<RoomList> {
  const near = options.continent && CONTINENTS[options.continent] ? options.continent : null;
  const here = isCountry(options.country ?? null) ? options.country! : null;
  const region = options.region && CONTINENTS[options.region] ? options.region : null;
  const wanted = Object.entries(options.labels ?? {}).filter(([labelName, labelValue]) => typeof labelName === "string" && typeof labelValue === "string" && labelName && labelValue).slice(0, 4);
  const cacheDurationSec = options.cacheDurationSec ?? 0;
  const key = new Request(
    `https://rooms-list.zaisma.internal/v4/${encodeURIComponent(gameId)}/${here ?? "any"}/${near ?? "any"}/${region ?? "all"}${page ? `/page-${page.startIndex}-${page.pageRoomCount}-${page.roomOrder}-${page.isHidingFullRooms ? "no-full" : "all-rooms"}` : ""}?labels=${encodeURIComponent(JSON.stringify(wanted))}`,
  );
  const cache = cacheDurationSec > 0 ? (caches as unknown as { default: Cache }).default : null;
  const hit = await cache?.match(key);
  if (hit) return hit.json();

  // A kept room with nobody in it sleeps without checking in, so its row never goes stale.
  const nowMs = options.nowMs ?? Date.now();
  // The game's count of distinct players comes with its rooms: a player in two rooms (a game that allows it) counts once.
  const [roomRows, gameRows] = await database.batch([
    database.prepare("SELECT * FROM live_rooms WHERE game_id = ? AND (updated_at_ms > ? OR (is_kept = 1 AND player_count = 0))").bind(gameId, nowMs - ROOM_STALE_MS),
    database.prepare("SELECT playing_player_count, updated_at_ms FROM live_games WHERE game_id = ?").bind(gameId),
  ]);
  const results = roomRows!.results as unknown as LiveRoom[];
  const liveGame = (gameRows!.results[0] ?? null) as { playing_player_count: number; updated_at_ms: number } | null;
  // Rooms someone is in, for "playing now": an empty kept room isn't playing.
  const playingRows = results.filter((row) => row.player_count > 0 || row.is_kept !== 1);
  const continent = (row: LiveRoom) => (row.continent && CONTINENTS[row.continent] ? row.continent : null);
  // Hidden rooms count toward "playing now"; only listed ones are ever shown.
  const all = results.filter((row) => row.is_listed === 1).map(
    (row): ListedRoom => ({
      roomCode: row.room_code,
      playerCount: row.player_count,
      heldSeatCount: row.held_seat_count ?? 0,
      maximumPlayerCount: row.maximum_player_count,
      spectatorCount: row.spectator_count ?? 0,
      maximumSpectatorCount: row.maximum_spectator_count ?? 0,
      isOpen: row.is_open === 1,
      location: isCountry(row.country) ? { countryCode: row.country, countryName: countryName(row.country), region: continent(row) } : null,
      isNear: near !== null && row.continent === near,
      name: row.is_name_hidden ? null : row.name,
      labels: row.is_name_hidden ? {} : readLabels(row.labels),
      isKept: row.is_kept === 1,
    }),
  );
  const created = new Map(results.map((row) => [row.room_code, row.created_at_ms]));
  const updated = new Map(results.map((row) => [row.room_code, row.updated_at_ms]));
  const where = new Map(results.map((row) => [row.room_code, continent(row)]));
  const mine = (room: ListedRoom) => Number(here !== null && room.location?.countryCode === here);
  // Kept rooms with nobody in them go after rooms with players, by name.
  const waiting = (room: ListedRoom) => Number(room.isKept && room.playerCount === 0);
  all.sort(
    (first, second) =>
      Number(hasSpace(second)) - Number(hasSpace(first)) ||
      // A page lists matches in progress after every open room, full ones too.
      (page ? Number(second.isOpen) - Number(first.isOpen) : 0) ||
      waiting(first) - waiting(second) ||
      (waiting(first) && waiting(second) ? (first.name ?? "\uffff").localeCompare(second.name ?? "\uffff", "en") || first.roomCode.localeCompare(second.roomCode) : 0) ||
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
  const matching = all.filter((room) => (!region || where.get(room.roomCode) === region) && fits(room));
  // The page can leave out open rooms with no space (matches in progress aren't full rooms: they stay), and order the rest by players. The
  // sort is stable, so matches in progress stay last and ties keep the best-to-join order.
  const inRegion = page?.isHidingFullRooms ? matching.filter((room) => !room.isOpen || hasSpace(room)) : matching;
  if (page && page.roomOrder !== "best_to_join") {
    const isMostFirst = page.roomOrder === "most_players";
    inRegion.sort((first, second) => Number(second.isOpen) - Number(first.isOpen) || (isMostFirst ? second.playerCount - first.playerCount : first.playerCount - second.playerCount));
  }
  const shown = page ? inRegion.slice(page.startIndex, page.startIndex + page.pageRoomCount) : inRegion.slice(0, MAXIMUM_SHOWN_ROOM_COUNT);
  const list: RoomList = {
    rooms: shown,
    // The game's distinct players while its record is fresh; otherwise the rooms' counts added up.
    playing: {
      playerCount: liveGame && liveGame.updated_at_ms > nowMs - ROOM_STALE_MS ? liveGame.playing_player_count : results.reduce((totalPlayerCount, row) => totalPlayerCount + row.player_count, 0),
      roomCount: playingRows.length,
      closedRoomCount: all.filter((room) => !room.isOpen).length,
    },
    joinableRoomCount: all.filter(hasSpace).length,
    openRoomCount: matching.filter((room) => room.isOpen).length,
    regions: [...regions.values()].sort((first, second) => second.playerCount - first.playerCount || second.roomCount - first.roomCount),
    region,
    moreOpenRoomCount: page ? inRegion.slice(page.startIndex + page.pageRoomCount).filter((room) => room.isOpen).length : inRegion.filter((room) => room.isOpen).length - shown.filter((room) => room.isOpen).length,
    filters: labelFilters(all),
    changedAtMs: Object.fromEntries(shown.map((room) => [room.roomCode, updated.get(room.roomCode)!])),
    ...(page ? { nextCursor: page.startIndex + page.pageRoomCount < inRegion.length ? String(page.startIndex + page.pageRoomCount) : null, roomOrder: page.roomOrder, isHidingFullRooms: page.isHidingFullRooms } : {}),
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
export function leaveOut<TheList extends RoomList>(list: TheList, left: { roomCode: string; leftAtMs: number; joinedAtMs: number }, nowMs = Date.now()): TheList {
  const changedAtMs = list.changedAtMs?.[left.roomCode];
  // A second's leeway each way: the room writes its row a moment before or after the player's game hears it.
  if (changedAtMs === undefined || nowMs - left.leftAtMs > LEFT_FOR_MS || changedAtMs >= left.leftAtMs - 1000 || changedAtMs < left.joinedAtMs - 1000) return list;
  const room = list.rooms.find((listed) => listed.roomCode === left.roomCode);
  if (!room || room.playerCount < 1) return list;
  // A kept room they were last in stays listed with nobody in it, but nobody's playing there.
  const isEmptied = room.playerCount === 1;
  const isGone = isEmptied && !room.isKept;
  const next: ListedRoom = { ...room, playerCount: room.playerCount - 1 };
  const regionCode = room.location?.region ?? null;
  return {
    ...list,
    rooms: isGone ? list.rooms.filter((listed) => listed !== room) : list.rooms.map((listed) => (listed === room ? next : listed)),
    playing: {
      playerCount: Math.max(0, list.playing.playerCount - 1),
      roomCount: list.playing.roomCount - Number(isEmptied),
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
