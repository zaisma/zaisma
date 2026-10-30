/**
 * Friends (docs/DECISIONS.md, "How friends work"): two accounts become friends when one accepts an
 * invite the other made, a link or an 8-character code given by hand, never by a stranger pressing
 * "Add friend" on its own: a request in a game (friend-requests.ts) is the other way. An invite works once, for a week. Friends are symmetric, at most MAXIMUM_FRIEND_COUNT
 * each, and both sides go when either removes the other or deletes their account. Passes carry an
 * account's friends as opaque tags, so canChat can let friends chat. A block between two accounts
 * (blocks.ts) ends their friendship and keeps them from becoming friends again until it's undone.
 */

import { MAXIMUM_OTHER_PLAYER_COUNT, hasBlocked } from "./blocks.ts";

/** Enough for anyone's real friends, and keeps a pass that lists them small (about 6 KB at the most). */
export const MAXIMUM_FRIEND_COUNT = 200;
/** Invites an account can have waiting at once. */
export const MAXIMUM_OPEN_FRIEND_INVITE_COUNT = 10;
export const FRIEND_INVITE_DURATION_DAYS = 7;

const DAY_MS = 86400_000;
// The room codes' letters: no 0, 1, I or O, so a code read out loud or typed from a screen comes out right.
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/;

const now = () => Date.now();

export interface FriendInvite {
  invite_code: string;
  account_id: string;
  created_at_ms: number;
  expires_at_ms: number;
}

/** A friend as their friends see them: their public profile and when they became friends. */
export interface Friend {
  player_id: string;
  name: string;
  created_at_ms: number;
}

/** An invite's code as people write it, "K7Q2-MX9P", for showing. */
export const friendInviteCodeInWords = (inviteCode: string) => `${inviteCode.slice(0, 4)}-${inviteCode.slice(4)}`;

/** A typed or linked code, tidied (any case, spaces and dashes), or null when it can't be one. */
export function readFriendInviteCode(given: unknown): string | null {
  if (typeof given !== "string") return null;
  const inviteCode = given.toUpperCase().replace(/[\s-]/g, "");
  return CODE_PATTERN.test(inviteCode) ? inviteCode : null;
}

export async function areFriends(database: D1Database, accountId: string, otherAccountId: string): Promise<boolean> {
  return (await database.prepare("SELECT 1 AS is_found FROM friendships WHERE account_id = ? AND friend_account_id = ?").bind(accountId, otherAccountId).first()) !== null;
}

export async function friendCountOf(database: D1Database, accountId: string): Promise<number> {
  return (await database.prepare("SELECT COUNT(*) AS friend_count FROM friendships WHERE account_id = ?").bind(accountId).first<{ friend_count: number }>())!.friend_count;
}

/** The invites an account has waiting, newest first. */
export async function friendInvitesOf(database: D1Database, accountId: string, nowMs = now()): Promise<FriendInvite[]> {
  const { results } = await database.prepare("SELECT * FROM friend_invites WHERE account_id = ? AND expires_at_ms > ? ORDER BY created_at_ms DESC").bind(accountId, nowMs).all<FriendInvite>();
  return results;
}

/** Whether a person turned the account's social side off after a report (stopSocial). */
async function isSocialStopped(database: D1Database, accountId: string): Promise<boolean> {
  return Boolean(await database.prepare("SELECT 1 FROM accounts WHERE id = ? AND social_stopped_at_ms IS NOT NULL").bind(accountId).first());
}

/** A new invite, or why there can't be one. */
export async function createFriendInvite(database: D1Database, accountId: string, nowMs = now()): Promise<{ invite: FriendInvite } | { error: "too_many_invites" | "too_many_friends" | "social_stopped" }> {
  if (await isSocialStopped(database, accountId)) return { error: "social_stopped" };
  if ((await friendCountOf(database, accountId)) >= MAXIMUM_FRIEND_COUNT) return { error: "too_many_friends" };
  if ((await friendInvitesOf(database, accountId, nowMs)).length >= MAXIMUM_OPEN_FRIEND_INVITE_COUNT) return { error: "too_many_invites" };
  const invite: FriendInvite = {
    invite_code: Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => CODE_ALPHABET[byte & 31]).join(""),
    account_id: accountId,
    created_at_ms: nowMs,
    expires_at_ms: nowMs + FRIEND_INVITE_DURATION_DAYS * DAY_MS,
  };
  // The count above is the quick answer; the insert counts again as it writes, so invites made at the same moment can't pass the cap together.
  const inserted = await database
    .prepare("INSERT INTO friend_invites (invite_code, account_id, created_at_ms, expires_at_ms) SELECT ?1, ?2, ?3, ?4 WHERE (SELECT COUNT(*) FROM friend_invites WHERE account_id = ?2 AND expires_at_ms > ?3) < ?5")
    .bind(invite.invite_code, invite.account_id, invite.created_at_ms, invite.expires_at_ms, MAXIMUM_OPEN_FRIEND_INVITE_COUNT)
    .run();
  if (!inserted.meta.changes) return { error: "too_many_invites" };
  return { invite };
}

/** Take back an invite before anyone uses it. */
export async function removeFriendInvite(database: D1Database, accountId: string, inviteCode: string): Promise<void> {
  await database.prepare("DELETE FROM friend_invites WHERE invite_code = ? AND account_id = ?").bind(inviteCode, accountId).run();
}

/** A waiting invite with who made it, for the page that asks "Add Night Owl as a friend?". */
export async function friendInviteByCode(database: D1Database, inviteCode: string, nowMs = now()): Promise<(FriendInvite & { name: string; player_id: string }) | null> {
  return database
    .prepare("SELECT friend_invites.*, accounts.username AS name, accounts.player_id FROM friend_invites JOIN accounts ON accounts.id = friend_invites.account_id WHERE friend_invites.invite_code = ? AND friend_invites.expires_at_ms > ?")
    .bind(inviteCode, nowMs)
    .first<FriendInvite & { name: string; player_id: string }>();
}

export type AcceptedFriendInvite =
  | { friend: Friend }
  | { error: "invite_not_found" | "own_invite" | "already_friends" | "too_many_friends" | "inviter_has_too_many_friends" | "inviter_is_blocked" | "social_stopped" };

/**
 * Use an invite: the two accounts become friends and the invite is gone. An invite for someone who's
 * already a friend stays, for whoever it was really meant for. Across a block it doesn't work: the
 * blocker hears why (inviter_is_blocked), and someone the inviter blocked hears only that it doesn't
 * work, so they're never told they're blocked. It's one batch whose friendship goes in only while both
 * have fewer than MAXIMUM_FRIEND_COUNT and the invite is still there, so invites used at the same moment
 * can't take either past it, and an invite goes only with the friendship it made.
 */
export async function acceptFriendInvite(database: D1Database, accountId: string, inviteCode: string, nowMs = now()): Promise<AcceptedFriendInvite> {
  const invite = await friendInviteByCode(database, inviteCode, nowMs);
  if (!invite) return { error: "invite_not_found" };
  if (invite.account_id === accountId) return { error: "own_invite" };
  if (await isSocialStopped(database, accountId)) return { error: "social_stopped" };
  // An invite from an account whose social side is off looks used, as across a block.
  if (await isSocialStopped(database, invite.account_id)) return { error: "invite_not_found" };
  if (await hasBlocked(database, invite.account_id, accountId)) return { error: "invite_not_found" };
  if (await hasBlocked(database, accountId, invite.account_id)) return { error: "inviter_is_blocked" };
  if (await areFriends(database, accountId, invite.account_id)) return { error: "already_friends" };
  if ((await friendCountOf(database, accountId)) >= MAXIMUM_FRIEND_COUNT) return { error: "too_many_friends" };
  if ((await friendCountOf(database, invite.account_id)) >= MAXIMUM_FRIEND_COUNT) return { error: "inviter_has_too_many_friends" };
  const isNewFriendship = "EXISTS (SELECT 1 FROM friendships WHERE account_id = ?1 AND friend_account_id = ?2 AND created_at_ms = ?3)";
  const [made] = await database.batch([
    database
      .prepare(
        `INSERT INTO friendships (account_id, friend_account_id, created_at_ms) SELECT ?1, ?2, ?3
         WHERE (SELECT COUNT(*) FROM friendships WHERE account_id = ?1) < ?5 AND (SELECT COUNT(*) FROM friendships WHERE account_id = ?2) < ?5
           AND EXISTS (SELECT 1 FROM friend_invites WHERE invite_code = ?4 AND expires_at_ms > ?3)
         ON CONFLICT DO NOTHING`,
      )
      .bind(accountId, invite.account_id, nowMs, inviteCode, MAXIMUM_FRIEND_COUNT),
    database.prepare(`INSERT INTO friendships (account_id, friend_account_id, created_at_ms) SELECT ?2, ?1, ?3 WHERE ${isNewFriendship} ON CONFLICT DO NOTHING`).bind(accountId, invite.account_id, nowMs),
    // Taking the invite decides who gets it, so two people with the same link can't both use it.
    database.prepare(`DELETE FROM friend_invites WHERE invite_code = ?4 AND ${isNewFriendship}`).bind(accountId, invite.account_id, nowMs, inviteCode),
  ]);
  if (!made!.meta.changes) {
    // Someone else took it in the same moment, or a friendship made in that moment filled a side.
    if (!(await friendInviteByCode(database, inviteCode, nowMs))) return { error: "invite_not_found" };
    if ((await friendCountOf(database, accountId)) >= MAXIMUM_FRIEND_COUNT) return { error: "too_many_friends" };
    if ((await friendCountOf(database, invite.account_id)) >= MAXIMUM_FRIEND_COUNT) return { error: "inviter_has_too_many_friends" };
    return { error: (await areFriends(database, accountId, invite.account_id)) ? "already_friends" : "invite_not_found" };
  }
  return { friend: { player_id: invite.player_id, name: invite.name, created_at_ms: nowMs } };
}

/** An account's friends, by name. */
export async function friendsOf(database: D1Database, accountId: string): Promise<Friend[]> {
  const { results } = await database
    .prepare("SELECT accounts.player_id, accounts.username AS name, friendships.created_at_ms FROM friendships JOIN accounts ON accounts.id = friendships.friend_account_id WHERE friendships.account_id = ? ORDER BY accounts.username COLLATE NOCASE, accounts.player_id")
    .bind(accountId)
    .all<Friend>();
  return results;
}

/**
 * Which of these players are the given player's friends, by player ID, for a room's areFriends: the
 * room asks as a player joins, about the others it remembers.
 */
export async function friendsAmong(database: D1Database, playerId: string, otherPlayerIds: readonly string[]): Promise<string[]> {
  const others = [...new Set(otherPlayerIds)].filter((otherPlayerId) => otherPlayerId !== playerId).slice(0, MAXIMUM_OTHER_PLAYER_COUNT);
  if (!others.length) return [];
  // The others as one JSON list: D1 takes at most 100 values per query.
  const { results } = await database
    .prepare(
      `SELECT friend.player_id FROM friendships JOIN accounts AS mine ON mine.id = friendships.account_id JOIN accounts AS friend ON friend.id = friendships.friend_account_id
       WHERE mine.player_id = ? AND friend.player_id IN (SELECT value FROM json_each(?))`,
    )
    .bind(playerId, JSON.stringify(others))
    .all<{ player_id: string }>();
  return results.map((row) => row.player_id);
}

/** An account's friends' player IDs, for its passes (as tags, friend_player_tag_ids): never more than MAXIMUM_FRIEND_COUNT, so a pass stays small. */
export async function friendPlayerIdsOf(database: D1Database, accountId: string): Promise<string[]> {
  const { results } = await database
    .prepare("SELECT accounts.player_id FROM friendships JOIN accounts ON accounts.id = friendships.friend_account_id WHERE friendships.account_id = ? ORDER BY friendships.created_at_ms, accounts.player_id LIMIT ?")
    .bind(accountId, MAXIMUM_FRIEND_COUNT)
    .all<{ player_id: string }>();
  return results.map((row) => row.player_id);
}

/** No longer friends, on both sides. */
export async function removeFriend(database: D1Database, accountId: string, friendPlayerId: string): Promise<void> {
  const friend = await database.prepare("SELECT id FROM accounts WHERE player_id = ?").bind(friendPlayerId).first<{ id: string }>();
  if (!friend) return;
  await database.batch([
    database.prepare("DELETE FROM friendships WHERE account_id = ? AND friend_account_id = ?").bind(accountId, friend.id),
    database.prepare("DELETE FROM friendships WHERE account_id = ? AND friend_account_id = ?").bind(friend.id, accountId),
  ]);
}

export async function deleteExpiredFriendInvites(database: D1Database, nowMs = now()): Promise<void> {
  await database.prepare("DELETE FROM friend_invites WHERE expires_at_ms <= ?").bind(nowMs).run();
}
