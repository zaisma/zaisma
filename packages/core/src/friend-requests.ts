/**
 * Friend requests in games (docs/DECISIONS.md, "Friend requests in games"): a player sends one to someone
 * they met in a game, from the game page, and the other player accepts or turns it down without leaving the
 * game. Who can send one is the recipient's setting (who_can_send_friend_requests): Invites only takes none,
 * People I play with takes them from players in the same room now or within the last hour, and Anyone from
 * anyone; both reach only the recipient's own band. The sender is never told of a turn-down, a run-out, a block
 * or a pause: a request looks waiting until it would have run out.
 */

import type { Account, AgeBand } from "./accounts.ts";
import { hasBlockBetweenAccounts } from "./blocks.ts";
import { MAXIMUM_FRIEND_COUNT, areFriends, friendCountOf } from "./friends.ts";
import { OWN_SERVER_ROOM_FRESH_MS } from "./friends-now.ts";
import { ROOM_STALE_MS } from "./types.ts";
import { socialSettingsOf } from "./social-settings.ts";

const DAY_MS = 86400_000;

export const FRIEND_REQUEST_LIMITS = {
  /** Requests an account sends in 24 hours; enough for a great night of new friends. */
  dailyCount: 20,
  /** The same from a 13–15 account, the band an adult lying about their age would send from. */
  teenDailyCount: 10,
  /** How long a request waits for an answer. */
  durationDays: 7,
  /** After a turn-down, how long before the same sender can ask again. */
  turnedDownWaitDays: 30,
  /** How long requests go nowhere once most of an account's recent ones were turned down or left. */
  pauseDays: 7,
  /** The window the pause looks back over. */
  pauseLookBackDays: 30,
  /** A request left this long unanswered counts against its sender for the pause. */
  pauseLeftAfterDays: 3,
  /** Turned-down or left requests in the window before a pause can start. */
  pauseMinimumCount: 10,
  /** A pause starts when fewer than this share of the window's settled requests were accepted. */
  pauseAcceptedShare: 0.25,
  /** People I play with: how long after leaving a room its players still count. */
  playedWithMs: 3600_000,
  /** Answered and run-out requests are kept this long, for the turn-down wait and the pause. */
  keptDays: 37,
} as const;

/** Why a player can't send someone a friend request, as the page shows it: Add friend simply isn't there. */
export type FriendRequestRefusal = "not_taking_requests" | "already_friends" | "already_sent" | "not_an_account" | "own_player" | "account_needed";

export interface WaitingFriendRequest {
  /** Who sent it, as Zaisma knows them. */
  player_id: string;
  name: string;
  created_at_ms: number;
  /** The game it was sent from, when it's one a stranger could see; null otherwise. */
  game_slug: string | null;
}

const bandOf = (account: Pick<Account, "age_band">): AgeBand => account.age_band;

/**
 * Whether two players were in the same room now, or within the last hour: Zaisma rooms' own record, and rooms
 * on a game's own servers that the game told Zaisma of (room_players for now, room_visits for lately).
 */
export async function hasPlayedWith(database: D1Database, playerId: string, otherPlayerId: string, nowMs = Date.now()): Promise<boolean> {
  // Each player's rooms: the ones they're in now, and the ones they left within the hour; one of each is enough.
  const found = await database
    .prepare(
      `WITH places AS (
         SELECT game_id, room_code, server_url, player_id FROM room_players
         WHERE player_id IN (?1, ?2) AND updated_at_ms > CASE WHEN server_url IS NULL THEN ?3 ELSE ?4 END
         UNION
         SELECT game_id, room_code, server_url, player_id FROM room_visits WHERE player_id IN (?1, ?2) AND last_seen_at_ms > ?5
       )
       SELECT 1 AS is_found FROM places mine JOIN places theirs ON theirs.game_id = mine.game_id AND theirs.room_code = mine.room_code AND theirs.server_url IS mine.server_url
       WHERE mine.player_id = ?1 AND theirs.player_id = ?2 LIMIT 1`,
    )
    .bind(playerId, otherPlayerId, nowMs - ROOM_STALE_MS, nowMs - OWN_SERVER_ROOM_FRESH_MS, nowMs - FRIEND_REQUEST_LIMITS.playedWithMs)
    .first();
  return found !== null;
}

/** Whether the recipient takes friend requests from the sender at all: their setting, their band, both social sides on and no block. */
async function takesRequestsFrom(database: D1Database, sender: Account, recipient: Account, nowMs: number): Promise<boolean> {
  if (sender.social_stopped_at_ms !== null || recipient.social_stopped_at_ms !== null) return false;
  const setting = socialSettingsOf(recipient).who_can_send_friend_requests;
  if (setting === "nobody") return false;
  // Anyone and People I play with reach only the recipient's own band.
  if (bandOf(sender) !== bandOf(recipient)) return false;
  if (await hasBlockBetweenAccounts(database, sender.id, recipient.id)) return false;
  if (setting === "played_with" && !(await hasPlayedWith(database, sender.player_id, recipient.player_id, nowMs))) return false;
  return true;
}

interface RequestRow {
  sender_account_id: string;
  recipient_account_id: string;
  created_at_ms: number;
  expires_at_ms: number;
  answer: "accepted" | "turned_down" | null;
}

async function requestBetween(database: D1Database, senderAccountId: string, recipientAccountId: string): Promise<RequestRow | null> {
  return database.prepare("SELECT * FROM friend_requests WHERE sender_account_id = ? AND recipient_account_id = ?").bind(senderAccountId, recipientAccountId).first<RequestRow>();
}

/**
 * Whether the sender's earlier request still stands in the way: one that looks waiting to the sender (waiting, or
 * turned down but not yet run out, so a turn-down looks like nothing happened), or a turn-down less than 30 days ago.
 */
function isInTheWay(row: RequestRow | null, nowMs: number): "already_sent" | "not_taking_requests" | null {
  if (!row || row.answer === "accepted") return null;
  if (row.expires_at_ms > nowMs) return "already_sent";
  if (row.answer === "turned_down" && row.created_at_ms + FRIEND_REQUEST_LIMITS.turnedDownWaitDays * DAY_MS > nowMs) return "not_taking_requests";
  return null;
}

/** Why the sender can't send this player a request now (null: Add friend shows), for the Players sheet and the confirm. */
export async function friendRequestRefusalFor(database: D1Database, sender: Account | null, recipientPlayerId: string, nowMs = Date.now()): Promise<FriendRequestRefusal | null> {
  if (!sender) return "account_needed";
  if (sender.player_id === recipientPlayerId) return "own_player";
  const recipient = await accountByPlayerId(database, recipientPlayerId);
  if (!recipient) return "not_an_account";
  if (await areFriends(database, sender.id, recipient.id)) return "already_friends";
  const inTheWay = isInTheWay(await requestBetween(database, sender.id, recipient.id), nowMs);
  if (inTheWay) return inTheWay;
  // A request waiting the other way can always be answered by sending one back.
  if (await isWaiting(database, recipient.id, sender.id, nowMs)) return null;
  return (await takesRequestsFrom(database, sender, recipient, nowMs)) ? null : "not_taking_requests";
}

async function isWaiting(database: D1Database, senderAccountId: string, recipientAccountId: string, nowMs: number): Promise<boolean> {
  const row = await requestBetween(database, senderAccountId, recipientAccountId);
  return Boolean(row && row.answer === null && row.expires_at_ms > nowMs);
}

async function accountByPlayerId(database: D1Database, playerId: string): Promise<Account | null> {
  return database.prepare("SELECT * FROM accounts WHERE player_id = ?").bind(playerId).first<Account>();
}

export type SentFriendRequest =
  | { status: "sent"; is_paused_now: boolean }
  | { status: "friends" }
  | { error: FriendRequestRefusal | "too_many_friend_requests" | "too_many_friends" | "recipient_has_too_many_friends" };

/**
 * Send a friend request, from a game (gameId) or not. A request back to someone whose request is waiting makes
 * the two friends at once. While the sender is paused it looks sent and goes nowhere; is_paused_now says a pause
 * started with this one, so the caller can flag a 13–15 sender to a person.
 */
export async function sendFriendRequest(database: D1Database, sender: Account, recipientPlayerId: string, gameId: string | null, nowMs = Date.now()): Promise<SentFriendRequest> {
  const refusal = await friendRequestRefusalFor(database, sender, recipientPlayerId, nowMs);
  if (refusal) return { error: refusal };
  const recipient = (await accountByPlayerId(database, recipientPlayerId))!;
  if (await isWaiting(database, recipient.id, sender.id, nowMs)) {
    const answered = await answerFriendRequest(database, sender, recipient.player_id, "accepted", nowMs);
    return "error" in answered ? { error: answered.error === "too_many_friends" ? "too_many_friends" : "recipient_has_too_many_friends" } : { status: "friends" };
  }
  const dailyCount = bandOf(sender) === "13-15" ? FRIEND_REQUEST_LIMITS.teenDailyCount : FRIEND_REQUEST_LIMITS.dailyCount;
  const sentToday = (await database.prepare("SELECT COUNT(*) AS request_count FROM friend_requests WHERE sender_account_id = ? AND created_at_ms > ?").bind(sender.id, nowMs - DAY_MS).first<{ request_count: number }>())!.request_count;
  if (sentToday >= dailyCount) return { error: "too_many_friend_requests" };
  if ((await friendCountOf(database, sender.id)) >= MAXIMUM_FRIEND_COUNT) return { error: "too_many_friends" };

  // While paused, a request is kept as turned down at once: the recipient never sees it, and to the sender it
  // looks waiting until it would have run out, like any turn-down.
  const pausedUntilMs = sender.friend_requests_paused_until_ms;
  const isPausedNow = !(pausedUntilMs !== null && pausedUntilMs > nowMs) && (await shouldPause(database, sender.id, nowMs));
  if (isPausedNow) await database.prepare("UPDATE accounts SET friend_requests_paused_until_ms = ? WHERE id = ?").bind(nowMs + FRIEND_REQUEST_LIMITS.pauseDays * DAY_MS, sender.id).run();
  const isPaused = isPausedNow || (pausedUntilMs !== null && pausedUntilMs > nowMs);
  await database
    .prepare(
      `INSERT INTO friend_requests (sender_account_id, recipient_account_id, game_id, created_at_ms, expires_at_ms, answer, answered_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT (sender_account_id, recipient_account_id) DO UPDATE SET game_id = excluded.game_id, created_at_ms = excluded.created_at_ms, expires_at_ms = excluded.expires_at_ms, answer = excluded.answer, answered_at_ms = excluded.answered_at_ms`,
    )
    .bind(sender.id, recipient.id, gameId, nowMs, nowMs + FRIEND_REQUEST_LIMITS.durationDays * DAY_MS, isPaused ? "turned_down" : null, isPaused ? nowMs : null)
    .run();
  return { status: "sent", is_paused_now: isPausedNow };
}

/** Whether most of the sender's recent requests were turned down or left: a pattern no honest player meets. */
async function shouldPause(database: D1Database, senderAccountId: string, nowMs: number): Promise<boolean> {
  const counts = await database
    .prepare(
      `SELECT COUNT(CASE WHEN answer = 'accepted' THEN 1 END) AS accepted_count,
              COUNT(CASE WHEN answer = 'turned_down' OR (answer IS NULL AND created_at_ms < ?3) THEN 1 END) AS refused_count
       FROM friend_requests WHERE sender_account_id = ?1 AND created_at_ms > ?2`,
    )
    .bind(senderAccountId, nowMs - FRIEND_REQUEST_LIMITS.pauseLookBackDays * DAY_MS, nowMs - FRIEND_REQUEST_LIMITS.pauseLeftAfterDays * DAY_MS)
    .first<{ accepted_count: number; refused_count: number }>();
  const { accepted_count: acceptedCount, refused_count: refusedCount } = counts!;
  if (refusedCount < FRIEND_REQUEST_LIMITS.pauseMinimumCount) return false;
  return acceptedCount < FRIEND_REQUEST_LIMITS.pauseAcceptedShare * (acceptedCount + refusedCount);
}

/** The requests waiting for an account, newest first. */
export async function waitingFriendRequestsTo(database: D1Database, accountId: string, nowMs = Date.now()): Promise<WaitingFriendRequest[]> {
  const { results } = await database
    .prepare(
      `SELECT accounts.player_id, accounts.username AS name, friend_requests.created_at_ms,
              CASE WHEN games.review_status = 'live' AND games.visibility IN ('listed', 'unlisted') AND games.live_version_id IS NOT NULL THEN games.slug END AS game_slug
       FROM friend_requests JOIN accounts ON accounts.id = friend_requests.sender_account_id
       LEFT JOIN games ON games.id = friend_requests.game_id
       WHERE friend_requests.recipient_account_id = ? AND friend_requests.answer IS NULL AND friend_requests.expires_at_ms > ?
         AND accounts.social_stopped_at_ms IS NULL
         AND NOT EXISTS (SELECT 1 FROM blocks WHERE (blocks.account_id = friend_requests.sender_account_id AND blocks.blocked_account_id = friend_requests.recipient_account_id) OR (blocks.account_id = friend_requests.recipient_account_id AND blocks.blocked_account_id = friend_requests.sender_account_id))
       ORDER BY friend_requests.created_at_ms DESC LIMIT 50`,
    )
    .bind(accountId, nowMs)
    .all<WaitingFriendRequest>();
  return results;
}

/** A request this account sent that was accepted lately: the sender hears of an accept, never of a turn-down. */
export interface AcceptedFriendRequest {
  player_id: string;
  name: string;
  answered_at_ms: number;
}

/** How long after an accept its sender's game pages still bring the news. */
const ACCEPTED_SHOWN_MS = DAY_MS;

/** The account's requests accepted in the last day, newest first, while they're still friends. */
export async function acceptedFriendRequestsFrom(database: D1Database, accountId: string, nowMs = Date.now()): Promise<AcceptedFriendRequest[]> {
  const { results } = await database
    .prepare(
      `SELECT accounts.player_id, accounts.username AS name, friend_requests.answered_at_ms FROM friend_requests
       JOIN accounts ON accounts.id = friend_requests.recipient_account_id
       JOIN friendships ON friendships.account_id = friend_requests.sender_account_id AND friendships.friend_account_id = friend_requests.recipient_account_id
       WHERE friend_requests.sender_account_id = ? AND friend_requests.answer = 'accepted' AND friend_requests.answered_at_ms > ?
       ORDER BY friend_requests.answered_at_ms DESC LIMIT 20`,
    )
    .bind(accountId, nowMs - ACCEPTED_SHOWN_MS)
    .all<AcceptedFriendRequest>();
  return results;
}

/** How many requests wait for an account, and how many it sent were accepted in the last day, for the game page's check-in. */
export async function friendRequestCountsOf(database: D1Database, accountId: string, nowMs = Date.now()): Promise<{ waiting_friend_request_count: number; accepted_friend_request_count: number }> {
  return {
    waiting_friend_request_count: await waitingFriendRequestCountOf(database, accountId, nowMs),
    accepted_friend_request_count: (await acceptedFriendRequestsFrom(database, accountId, nowMs)).length,
  };
}

/** How many requests wait for an account, for the game page's check-in. */
export async function waitingFriendRequestCountOf(database: D1Database, accountId: string, nowMs = Date.now()): Promise<number> {
  return (await database.prepare("SELECT COUNT(*) AS request_count FROM friend_requests WHERE recipient_account_id = ? AND answer IS NULL AND expires_at_ms > ?").bind(accountId, nowMs).first<{ request_count: number }>())!.request_count;
}

export type AnsweredFriendRequest = { answer: "accepted" | "turned_down" } | { error: "request_not_found" | "too_many_friends" | "sender_has_too_many_friends" | "social_stopped" };

/** Accept or turn down a waiting request. Accepting makes them friends on both sides; turning down tells the sender nothing. */
export async function answerFriendRequest(database: D1Database, recipient: Account, senderPlayerId: string, answer: "accepted" | "turned_down", nowMs = Date.now()): Promise<AnsweredFriendRequest> {
  const sender = await accountByPlayerId(database, senderPlayerId);
  if (!sender || !(await isWaiting(database, sender.id, recipient.id, nowMs))) return { error: "request_not_found" };
  if (answer === "accepted") {
    if (recipient.social_stopped_at_ms !== null) return { error: "social_stopped" };
    if (sender.social_stopped_at_ms !== null || (await hasBlockBetweenAccounts(database, sender.id, recipient.id))) return { error: "request_not_found" };
    if ((await friendCountOf(database, recipient.id)) >= MAXIMUM_FRIEND_COUNT) return { error: "too_many_friends" };
    if ((await friendCountOf(database, sender.id)) >= MAXIMUM_FRIEND_COUNT) return { error: "sender_has_too_many_friends" };
  }
  // Answering decides it, so two tabs can't both answer.
  const taken = await database
    .prepare("UPDATE friend_requests SET answer = ?, answered_at_ms = ? WHERE sender_account_id = ? AND recipient_account_id = ? AND answer IS NULL AND expires_at_ms > ? RETURNING sender_account_id")
    .bind(answer, nowMs, sender.id, recipient.id, nowMs)
    .first();
  if (!taken) return { error: "request_not_found" };
  if (answer === "accepted") {
    await database.batch([
      database.prepare("INSERT INTO friendships (account_id, friend_account_id, created_at_ms) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(recipient.id, sender.id, nowMs),
      database.prepare("INSERT INTO friendships (account_id, friend_account_id, created_at_ms) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(sender.id, recipient.id, nowMs),
      // A request the other way is answered too.
      database.prepare("UPDATE friend_requests SET answer = 'accepted', answered_at_ms = ? WHERE sender_account_id = ? AND recipient_account_id = ? AND answer IS NULL").bind(nowMs, recipient.id, sender.id),
    ]);
  }
  return { answer };
}

/**
 * Who was in which rooms lately, for People I play with: a visit per player and room, seen now. Rooms call it as
 * players join, leave and hourly while they stay; setOwnServerRoom as a game's own room is said or left.
 */
export function roomVisitStatements(database: D1Database, gameId: string, roomCode: string, serverUrl: string | null, playerIds: readonly string[], nowMs = Date.now()): D1PreparedStatement[] {
  return playerIds.map((playerId) =>
    database.prepare("INSERT OR REPLACE INTO room_visits (game_id, room_code, server_url, player_id, last_seen_at_ms) VALUES (?, ?, ?, ?, ?)").bind(gameId, roomCode, serverUrl, playerId, nowMs),
  );
}

/** Visits too old to count, and requests kept past the turn-down wait and the pause's window. */
export async function deleteOldFriendRequests(database: D1Database, nowMs = Date.now()): Promise<void> {
  await database.batch([
    database.prepare("DELETE FROM room_visits WHERE last_seen_at_ms < ?").bind(nowMs - FRIEND_REQUEST_LIMITS.playedWithMs),
    database.prepare("DELETE FROM friend_requests WHERE created_at_ms < ?").bind(nowMs - FRIEND_REQUEST_LIMITS.keptDays * DAY_MS),
  ]);
}
