import type { Account } from "./accounts.ts";
import { socialSettingsOf } from "./social-settings.ts";
import { ROOM_STALE_MS } from "./types.ts";

/**
 * What friends see of each other right now (docs/DECISIONS.md, "What friends see of each other"):
 * who has zaisma.com open, what they're playing and the room to join them in. Pages check in while
 * one is on screen (presences); Zaisma rooms keep which accounts are in them (room_players). Every part
 * follows the friend's social settings, and Appear offline hides them from both.
 */

/** A page on screen checks in this often. */
export const PRESENCE_CHECK_IN_MS = 2 * 60_000;
/** Check-ins closer together than this aren't written, so several tabs cost no more than one. */
const PRESENCE_WRITE_MS = 60_000;
/** Seen this recently, a player is online: a missed check-in or two doesn't drop them. */
export const ONLINE_MS = 5 * 60_000;
/** Presences are only of use for minutes; a day after the last check-in the row goes. */
export const PRESENCE_KEPT_MS = 24 * 3600_000;
/** A game page says again this often which room on the game's own servers its player is in (Zaisma.friends.setRoom). */
export const OWN_SERVER_ROOM_CHECK_IN_MS = 2 * 60_000;
/** Not said again for this long, a room on the game's own servers no longer counts: the page closed without saying. */
export const OWN_SERVER_ROOM_FRESH_MS = 5 * 60_000;

/**
 * Why Join won't work, for the grayed button's reason: the game turned Join off, none of the friends in
 * the room takes this player, the game turned Join off for the room, the room is closed, or it's full.
 */
export type JoinRefusal = "game_not_taking_joins" | "friend_not_taking_joins" | "private_room" | "match_in_progress" | "room_full";

export interface FriendNow {
  player_id: string;
  name: string;
}

export interface GameNow {
  slug: string;
  title: string;
  cover_image_id: string | null;
  square_image_id: string | null;
}

export interface FriendsInGame {
  /** Null for a game that isn't out yet (draft, private, in review or taken down): no name, no cover. */
  game: GameNow | null;
  /** The game's ID, for matching it on its own page; null with game. */
  game_id: string | null;
  friends: FriendNow[];
  /**
   * The room Join takes the player to: one of the friends' rooms, the first that would let them in.
   * Null when there's none (the friends aren't in a room the game told Zaisma of). server_url is the
   * game's own server the room is on, null for Zaisma rooms.
   */
  join: { room_code: string; server_url: string | null; refusal: JoinRefusal | null; refusing_friend_names: string[] } | null;
}

export interface FriendsNow {
  /** Friends with zaisma.com open, by name. */
  online: FriendNow[];
  /** Games friends are playing, most friends first; one for every game that isn't out yet, last. */
  playing: FriendsInGame[];
}

/**
 * A page checks in: the account is online, and on a game page where Play was pressed, playing that
 * game. A page without a game leaves the game a game page reported (another tab may be playing).
 */
export async function checkIn(database: D1Database, accountId: string, gameId: string | null, nowMs = Date.now()): Promise<void> {
  await database
    .prepare(
      `INSERT INTO presences (account_id, seen_at_ms, game_id, game_seen_at_ms) VALUES (?1, ?2, ?3, CASE WHEN ?3 IS NULL THEN NULL ELSE ?2 END)
       ON CONFLICT (account_id) DO UPDATE SET seen_at_ms = excluded.seen_at_ms, game_id = COALESCE(excluded.game_id, presences.game_id), game_seen_at_ms = COALESCE(excluded.game_seen_at_ms, presences.game_seen_at_ms)
       WHERE presences.seen_at_ms <= ?4 OR (excluded.game_id IS NOT NULL AND (presences.game_id IS NOT excluded.game_id OR presences.game_seen_at_ms <= ?4))`,
    )
    .bind(accountId, nowMs, gameId, nowMs - PRESENCE_WRITE_MS)
    .run();
}

/** The player left a game's page or closed it: no longer playing it (a room they're still in says otherwise). */
export async function leftGame(database: D1Database, accountId: string, gameId: string): Promise<void> {
  await database.prepare("UPDATE presences SET game_id = NULL, game_seen_at_ms = NULL WHERE account_id = ? AND game_id = ?").bind(accountId, gameId).run();
}

export async function setAppearingOffline(database: D1Database, accountId: string, isAppearingOffline: boolean): Promise<void> {
  await database.prepare("UPDATE accounts SET is_appearing_offline = ? WHERE id = ?").bind(isAppearingOffline ? 1 : 0, accountId).run();
}

type FriendRow = Account & { seen_at_ms: number | null; game_id: string | null; game_seen_at_ms: number | null };

interface RoomRow {
  player_id: string;
  game_id: string;
  room_code: string;
  /** The game's own server the room is on (Zaisma.friends.setRoom); null for a Zaisma room. */
  server_url: string | null;
  joined_at_ms: number;
  /** Null when the room has no live row (everyone in it walked away, or it stopped). */
  player_count: number | null;
  held_seat_count: number | null;
  maximum_player_count: number | null;
  is_open: number | null;
  /** The room's Join switch: live_rooms' for a Zaisma room, room_players' for one on the game's own servers. */
  friend_joins_enabled: number | null;
}

interface GameRow {
  id: string;
  slug: string;
  title: string;
  review_status: string;
  visibility: string;
  live_version_id: string | null;
  minimum_player_age_years: number;
  friend_joins_enabled: number;
  cover_image_id: string | null;
  square_image_id: string | null;
}

/** Whether a setting lets this viewer see or do it: anyone, or friends when they're friends. */
const lets = (choice: "nobody" | "friends" | "anyone", isFriend: boolean) => choice === "anyone" || (choice === "friends" && isFriend);

/** One person playing, as the viewer may see them. */
interface PlayingMember {
  friend: FriendNow;
  gameId: string;
  room: RoomRow | null;
  /** Their who_can_join lets this viewer in. */
  isTakingJoins: boolean;
}

/** What one person is playing as the viewer may see it, or null: Appear offline and who_sees_playing_now first. */
function playingMember(row: FriendRow, room: RoomRow | null, isFriend: boolean, nowMs: number): PlayingMember | null {
  const settings = socialSettingsOf(row);
  if (row.is_appearing_offline || !lets(settings.who_sees_playing_now, isFriend)) return null;
  // A room is the surest sign; otherwise the game page they pressed Play on.
  const pageGameId = row.game_id && row.game_seen_at_ms !== null && row.game_seen_at_ms > nowMs - ONLINE_MS ? row.game_id : null;
  const gameId = room?.game_id ?? pageGameId;
  return gameId ? { friend: { player_id: row.player_id, name: row.username }, gameId, room, isTakingJoins: lets(settings.who_can_join, isFriend) } : null;
}

const ROOM_COLUMNS = `room_players.player_id, room_players.game_id, room_players.room_code, room_players.server_url, room_players.joined_at_ms,
  live_rooms.player_count, live_rooms.held_seat_count, live_rooms.maximum_player_count, live_rooms.is_open,
  CASE WHEN room_players.server_url IS NULL THEN live_rooms.friend_joins_enabled ELSE room_players.friend_joins_enabled END AS friend_joins_enabled`;
// ?2 is when a Zaisma room's rows go stale, ?3 when an own server's do.
const LIVE_ROOM_JOIN = "LEFT JOIN live_rooms ON room_players.server_url IS NULL AND live_rooms.game_id = room_players.game_id AND live_rooms.room_code = room_players.room_code AND live_rooms.updated_at_ms > ?2";
const FRESH_ROOM = "room_players.updated_at_ms > CASE WHEN room_players.server_url IS NULL THEN ?2 ELSE ?3 END";

/**
 * What an account's friends are doing right now, as each friend's settings let them see it. A game for
 * players older than the account (viewerAgeFloorYears) is left out, as if the friend weren't playing.
 */
export async function friendsNowOf(database: D1Database, accountId: string, viewerAgeFloorYears: number, nowMs = Date.now()): Promise<FriendsNow> {
  const [friendRows, roomRows] = await database.batch([
    database
      .prepare(
        `SELECT accounts.*, presences.seen_at_ms, presences.game_id, presences.game_seen_at_ms FROM friendships
         JOIN accounts ON accounts.id = friendships.friend_account_id
         LEFT JOIN presences ON presences.account_id = accounts.id
         WHERE friendships.account_id = ? AND accounts.is_appearing_offline = 0
         ORDER BY accounts.username COLLATE NOCASE, accounts.player_id`,
      )
      .bind(accountId),
    database
      .prepare(
        `SELECT ${ROOM_COLUMNS} FROM friendships
         JOIN accounts ON accounts.id = friendships.friend_account_id
         JOIN room_players ON room_players.player_id = accounts.player_id
         ${LIVE_ROOM_JOIN}
         WHERE friendships.account_id = ?1 AND ${FRESH_ROOM}
         ORDER BY room_players.joined_at_ms DESC`,
      )
      .bind(accountId, nowMs - ROOM_STALE_MS, nowMs - OWN_SERVER_ROOM_FRESH_MS),
  ]);
  const roomByPlayerId = newestRooms(roomRows!.results as RoomRow[]);
  const online: FriendNow[] = [];
  const members: PlayingMember[] = [];
  for (const row of friendRows!.results as FriendRow[]) {
    const room = roomByPlayerId.get(row.player_id) ?? null;
    const isSeen = row.seen_at_ms !== null && row.seen_at_ms > nowMs - ONLINE_MS;
    if (socialSettingsOf(row).who_sees_online !== "nobody" && (isSeen || room)) online.push({ player_id: row.player_id, name: row.username });
    const member = playingMember(row, room, true, nowMs);
    if (member) members.push(member);
  }
  return { online, playing: await gamesOf(database, members, viewerAgeFloorYears) };
}

/**
 * What one account is playing right now, as a viewer may see it (a profile's Playing now): null when
 * they appear offline, aren't playing, or their who_sees_playing_now doesn't reach the viewer (a
 * signed-out viewer is nobody's friend). Join follows their who_can_join the same way.
 */
export async function playingNowOf(database: D1Database, accountId: string, viewerAccountId: string | null, viewerAgeFloorYears: number, nowMs = Date.now()): Promise<FriendsInGame | null> {
  const [ownerRows, roomRows, friendRows] = await database.batch([
    database.prepare("SELECT accounts.*, presences.seen_at_ms, presences.game_id, presences.game_seen_at_ms FROM accounts LEFT JOIN presences ON presences.account_id = accounts.id WHERE accounts.id = ?1").bind(accountId),
    database
      .prepare(`SELECT ${ROOM_COLUMNS} FROM accounts JOIN room_players ON room_players.player_id = accounts.player_id ${LIVE_ROOM_JOIN} WHERE accounts.id = ?1 AND ${FRESH_ROOM} ORDER BY room_players.joined_at_ms DESC`)
      .bind(accountId, nowMs - ROOM_STALE_MS, nowMs - OWN_SERVER_ROOM_FRESH_MS),
    database.prepare("SELECT 1 AS is_found FROM friendships WHERE account_id = ? AND friend_account_id = ?").bind(accountId, viewerAccountId ?? ""),
  ]);
  const row = ownerRows!.results[0] as FriendRow | undefined;
  if (!row) return null;
  // The owner sees their own as a friend would.
  const isFriend = viewerAccountId === accountId || friendRows!.results.length > 0;
  const member = playingMember(row, newestRooms(roomRows!.results as RoomRow[]).get(row.player_id) ?? null, isFriend, nowMs);
  return member ? ((await gamesOf(database, [member], viewerAgeFloorYears))[0] ?? null) : null;
}

/** Each player's newest room, if they're in more than one (two tabs); rows come newest first. */
function newestRooms(rooms: RoomRow[]): Map<string, RoomRow> {
  const roomByPlayerId = new Map<string, RoomRow>();
  for (const room of rooms) if (!roomByPlayerId.has(room.player_id)) roomByPlayerId.set(room.player_id, room);
  return roomByPlayerId;
}

/**
 * The games these people are playing, with their faces and Join; every game that isn't out yet as one,
 * last. Games for players older than the viewer are left out altogether, never counted among those.
 */
async function gamesOf(database: D1Database, allMembers: PlayingMember[], viewerAgeFloorYears: number): Promise<FriendsInGame[]> {
  if (!allMembers.length) return [];
  const gameIds = [...new Set(allMembers.map((member) => member.gameId))];
  const { results: gameRows } = await database
    .prepare(
      `SELECT games.id, games.slug, games.title, games.review_status, games.visibility, games.live_version_id, games.minimum_player_age_years, games.friend_joins_enabled,
         (SELECT id FROM game_images WHERE game_id = games.id AND kind = 'cover' AND review_status = 'approved' ORDER BY created_at_ms DESC LIMIT 1) AS cover_image_id,
         (SELECT id FROM game_images WHERE game_id = games.id AND kind = 'square' AND review_status = 'approved' ORDER BY created_at_ms DESC LIMIT 1) AS square_image_id
       FROM games WHERE id IN (${gameIds.map(() => "?").join(", ")})`,
    )
    .bind(...gameIds)
    .all<GameRow>();
  const gameById = new Map(gameRows.map((game) => [game.id, game]));
  const members = allMembers.filter((member) => (gameById.get(member.gameId)?.minimum_player_age_years ?? 13) <= viewerAgeFloorYears);
  const isOut = (game: GameRow | undefined) => Boolean(game && game.review_status === "live" && game.live_version_id && (game.visibility === "listed" || game.visibility === "unlisted"));

  const groups = new Map<string, PlayingMember[]>();
  for (const member of members) {
    // Every game that isn't out yet is one "a game that isn't out yet", so nothing says how many or which.
    const key = isOut(gameById.get(member.gameId)) ? member.gameId : "";
    groups.set(key, [...(groups.get(key) ?? []), member]);
  }
  const playing: FriendsInGame[] = [...groups].map(([gameId, inGame]) => {
    const game = gameId ? gameById.get(gameId)! : null;
    return {
      game: game ? { slug: game.slug, title: game.title, cover_image_id: game.cover_image_id, square_image_id: game.square_image_id } : null,
      game_id: game ? game.id : null,
      friends: inGame.map((member) => member.friend),
      join: game ? joinFor(inGame, game.friend_joins_enabled === 1) : null,
    };
  });
  // Most friends first; games that aren't out yet last.
  playing.sort((first, second) => Number(!first.game) - Number(!second.game) || second.friends.length - first.friends.length);
  return playing;
}

/**
 * Whether a room lets the player in through these friends: the game's Join switch first, then the
 * friends' own setting (when none of them takes this player, they learn nothing of the room), then the
 * room's Join switch, then a closed room, then a full one. A room on the game's own servers says nothing
 * of space, so its own door decides the rest.
 */
function refusalOf(room: RoomRow, inRoom: PlayingMember[], isGameTakingJoins: boolean): JoinRefusal | null {
  if (!isGameTakingJoins) return "game_not_taking_joins";
  if (inRoom.every((member) => !member.isTakingJoins)) return "friend_not_taking_joins";
  if (room.friend_joins_enabled === 0) return "private_room";
  if (room.server_url !== null) return null;
  return !room.is_open ? "match_in_progress" : room.player_count! + room.held_seat_count! >= room.maximum_player_count! ? "room_full" : null;
}

/** Whether Join can say anything of a room: a Zaisma room without a live row can't say whether it has space. */
const isJoinable = (room: RoomRow | null): room is RoomRow => Boolean(room && (room.server_url !== null || room.maximum_player_count !== null));

/** Join for one game: the friends' rooms, most friends first, and the first that would let the player in; else the busiest one's reason. */
function joinFor(members: PlayingMember[], isGameTakingJoins: boolean): FriendsInGame["join"] {
  const rooms = new Map<string, { room: RoomRow; members: PlayingMember[] }>();
  for (const member of members) {
    if (!isJoinable(member.room)) continue;
    const key = `${member.room.server_url ?? ""} ${member.room.room_code}`;
    const entry = rooms.get(key) ?? { room: member.room, members: [] };
    entry.members.push(member);
    rooms.set(key, entry);
  }
  const joins = [...rooms.values()]
    .sort((first, second) => second.members.length - first.members.length)
    .map(({ room, members: inRoom }) => {
      const refusal = refusalOf(room, inRoom, isGameTakingJoins);
      const refusingFriendNames = refusal === "friend_not_taking_joins" ? inRoom.map((member) => member.friend.name) : [];
      return { room_code: room.room_code, server_url: room.server_url, refusal, refusing_friend_names: refusingFriendNames };
    });
  return joins.find((join) => !join.refusal) ?? joins[0] ?? null;
}

/** Why a game's own list can't take the player to a friend: Join's reasons, or no room the game told Zaisma of. */
export type FriendJoinRefusal = JoinRefusal | "no_room";

/** A friend playing this game, for the game itself (Zaisma.friends.list). */
export interface FriendInGame {
  player_id: string;
  username: string;
  /** The room to join them in, when the player could join it; else null with join_refusal. */
  room_code: string | null;
  /** The game's own server that room is on; null for a Zaisma room, or with no room. */
  server_url: string | null;
  join_refusal: FriendJoinRefusal | null;
}

/**
 * An account's friends playing this game right now, in any of its rooms or none, as each friend's
 * settings let them see it: the game's own list of friends to join, watch or invite (docs/DECISIONS.md,
 * "Friends in games"). Friends playing anything else never reach the game, and neither does who's online.
 */
export async function friendsInGameOf(database: D1Database, accountId: string, gameId: string, nowMs = Date.now()): Promise<FriendInGame[]> {
  const [friendRows, roomRows, gameRows] = await database.batch([
    database
      .prepare(
        `SELECT accounts.*, presences.seen_at_ms, presences.game_id, presences.game_seen_at_ms FROM friendships
         JOIN accounts ON accounts.id = friendships.friend_account_id
         LEFT JOIN presences ON presences.account_id = accounts.id
         WHERE friendships.account_id = ? AND accounts.is_appearing_offline = 0
         ORDER BY accounts.username COLLATE NOCASE, accounts.player_id`,
      )
      .bind(accountId),
    database
      .prepare(
        `SELECT ${ROOM_COLUMNS} FROM friendships
         JOIN accounts ON accounts.id = friendships.friend_account_id
         JOIN room_players ON room_players.player_id = accounts.player_id
         ${LIVE_ROOM_JOIN}
         WHERE friendships.account_id = ?1 AND ${FRESH_ROOM}
         ORDER BY room_players.joined_at_ms DESC`,
      )
      .bind(accountId, nowMs - ROOM_STALE_MS, nowMs - OWN_SERVER_ROOM_FRESH_MS),
    database.prepare("SELECT friend_joins_enabled FROM games WHERE id = ?").bind(gameId),
  ]);
  const isGameTakingJoins = (gameRows!.results[0] as { friend_joins_enabled: number } | undefined)?.friend_joins_enabled !== 0;
  const roomByPlayerId = newestRooms(roomRows!.results as RoomRow[]);
  const members = (friendRows!.results as FriendRow[])
    .map((row) => playingMember(row, roomByPlayerId.get(row.player_id) ?? null, true, nowMs))
    .filter((member): member is PlayingMember => member?.gameId === gameId);
  return members.map((member) => {
    const room = isJoinable(member.room) ? member.room : null;
    // Each friend's own room, as Join would say it with them alone in it.
    const refusal: FriendJoinRefusal | null = room ? refusalOf(room, [member], isGameTakingJoins) : "no_room";
    const isJoinOpen = room !== null && refusal === null;
    return { player_id: member.friend.player_id, username: member.friend.name, room_code: isJoinOpen ? room.room_code : null, server_url: isJoinOpen ? room.server_url : null, join_refusal: refusal };
  });
}

/**
 * Which room on the game's own servers a signed-in player is in (Zaisma.friends.setRoom), or none, so a
 * friend's Join works there too, with the room's Join switch. It stays only as long as the game's page
 * keeps saying it (OWN_SERVER_ROOM_FRESH_MS); the server is one the game lists as its own, checked by the caller.
 */
export async function setOwnServerRoom(
  database: D1Database,
  gameId: string,
  playerId: string,
  room: { server_url: string; room_code: string; friend_joins_enabled: boolean } | null,
  nowMs = Date.now(),
): Promise<void> {
  await database.batch([
    database
      .prepare("DELETE FROM room_players WHERE game_id = ?1 AND player_id = ?2 AND server_url IS NOT NULL AND NOT (room_code IS ?3 AND server_url IS ?4)")
      .bind(gameId, playerId, room?.room_code ?? null, room?.server_url ?? null),
    ...(room
      ? [
          database
            .prepare(
              `INSERT INTO room_players (game_id, room_code, player_id, server_url, friend_joins_enabled, joined_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
               ON CONFLICT (game_id, room_code, player_id) DO UPDATE SET updated_at_ms = excluded.updated_at_ms, friend_joins_enabled = excluded.friend_joins_enabled WHERE room_players.server_url IS excluded.server_url`,
            )
            .bind(gameId, room.room_code, playerId, room.server_url, room.friend_joins_enabled ? 1 : 0, nowMs),
        ]
      : []),
  ]);
}

/** What a Join refusal says, on the grayed button's hover or tap. */
export function joinRefusalText(join: NonNullable<FriendsInGame["join"]>): string {
  if (join.refusal === "game_not_taking_joins") return "This game doesn't take joins";
  if (join.refusal === "private_room") return "Private room";
  if (join.refusal === "room_full") return "Room full";
  if (join.refusal === "match_in_progress") return "Match in progress";
  const names = join.refusing_friend_names;
  return names.length === 1 ? `${names[0]} isn't taking joins` : `${names.slice(0, -1).join(", ")} and ${names.at(-1)} aren't taking joins`;
}

/** Presences nobody has checked in to for a day, and rows of rooms that stopped without saying so. */
export async function deleteStalePresences(database: D1Database, nowMs = Date.now()): Promise<void> {
  await database.batch([
    database.prepare("DELETE FROM presences WHERE seen_at_ms < ?").bind(nowMs - PRESENCE_KEPT_MS),
    database.prepare("DELETE FROM room_players WHERE updated_at_ms < ?").bind(nowMs - ROOM_STALE_MS),
  ]);
}
