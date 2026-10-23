/**
 * Blocks (docs/DECISIONS.md, "Players can mute, block and report other players" and "How blocks
 * work"): one account blocks another until it unblocks them on its friends page. A block is a wall
 * both ways in every game: nothing either one sends reaches the other, they can't be friends, and
 * Zaisma never helps either one find the other. Blocking a friend ends the friendship, and the
 * blocked player is never told. Games only ever learn that two of their players have a block between
 * them, never anyone's list of blocks. Guests' blocks last for their session and never come here.
 */

/** How many other players a room looks up blocks and friends among as one player joins: everyone a full room holds (ROOM_LIMITS.maximumPlayerCount in the game server, which test/node/blocks.test.ts keeps in step). */
export const MAXIMUM_OTHER_PLAYER_COUNT = 100;

/** Passes carry up to this many of an account's blocks, made and received, newest first (about 3 KB at the most). */
export const MAXIMUM_PASS_BLOCK_COUNT = 100;

/** A player an account blocked, as its friends page lists them. */
export interface BlockedPlayer {
  player_id: string;
  name: string;
  created_at_ms: number;
}

export type BlockOutcome = { blocked: BlockedPlayer } | { error: "player_not_found" | "own_player" };

const now = () => Date.now();

/**
 * Block an account by its player ID: from now on there's a wall between them, and if they were
 * friends they aren't any more, on both sides. Blocking someone already blocked keeps the first block.
 */
export async function blockPlayer(database: D1Database, accountId: string, blockedPlayerId: string, nowMs = now()): Promise<BlockOutcome> {
  const blocked = await database.prepare("SELECT id, player_id, username FROM accounts WHERE player_id = ?").bind(blockedPlayerId).first<{ id: string; player_id: string; username: string }>();
  if (!blocked) return { error: "player_not_found" };
  if (blocked.id === accountId) return { error: "own_player" };
  await database.batch([
    database.prepare("INSERT INTO blocks (account_id, blocked_account_id, created_at_ms) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(accountId, blocked.id, nowMs),
    database.prepare("DELETE FROM friendships WHERE (account_id = ? AND friend_account_id = ?) OR (account_id = ? AND friend_account_id = ?)").bind(accountId, blocked.id, blocked.id, accountId),
  ]);
  return { blocked: { player_id: blocked.player_id, name: blocked.username, created_at_ms: nowMs } };
}

/** Take a block back. The wall stays if the other account blocked this one too; a friendship it ended doesn't come back. */
export async function unblockPlayer(database: D1Database, accountId: string, blockedPlayerId: string): Promise<void> {
  await database.prepare("DELETE FROM blocks WHERE account_id = ? AND blocked_account_id = (SELECT id FROM accounts WHERE player_id = ?)").bind(accountId, blockedPlayerId).run();
}

/** The players an account blocked, newest first, for its friends page. Only the account itself ever sees this. */
export async function blocksOf(database: D1Database, accountId: string): Promise<BlockedPlayer[]> {
  const { results } = await database
    .prepare("SELECT accounts.player_id, accounts.username AS name, blocks.created_at_ms FROM blocks JOIN accounts ON accounts.id = blocks.blocked_account_id WHERE blocks.account_id = ? ORDER BY blocks.created_at_ms DESC, accounts.player_id")
    .bind(accountId)
    .all<BlockedPlayer>();
  return results;
}

/** Whether one account blocked the other: only for what the blocker sees, never for what the blocked one is told. */
export async function hasBlocked(database: D1Database, accountId: string, otherAccountId: string): Promise<boolean> {
  return (await database.prepare("SELECT 1 AS is_found FROM blocks WHERE account_id = ? AND blocked_account_id = ?").bind(accountId, otherAccountId).first()) !== null;
}

/** Whether there's a block between two accounts, either way: the wall that keeps them apart everywhere on Zaisma. */
export async function hasBlockBetweenAccounts(database: D1Database, accountId: string, otherAccountId: string): Promise<boolean> {
  return (
    (await database
      .prepare("SELECT 1 AS is_found FROM blocks WHERE (account_id = ? AND blocked_account_id = ?) OR (account_id = ? AND blocked_account_id = ?)")
      .bind(accountId, otherAccountId, otherAccountId, accountId)
      .first()) !== null
  );
}

/** A block between one player and another, by player ID: who made it and who it's of. */
export interface PlayerBlock {
  blocker_player_id: string;
  blocked_player_id: string;
}

/**
 * The blocks between one player and some others (the players in a room), either way, by player ID.
 * Rooms use it to put the walls up as a player joins; it never leaves Zaisma as it is.
 */
export async function blocksAmong(database: D1Database, playerId: string, otherPlayerIds: readonly string[]): Promise<PlayerBlock[]> {
  const others = [...new Set(otherPlayerIds)].filter((otherPlayerId) => otherPlayerId !== playerId).slice(0, MAXIMUM_OTHER_PLAYER_COUNT);
  if (!others.length) return [];
  // The others as one JSON list: D1 takes at most 100 values per query.
  const othersJson = JSON.stringify(others);
  const { results } = await database
    .prepare(
      `SELECT blocker.player_id AS blocker_player_id, blocked.player_id AS blocked_player_id FROM blocks
       JOIN accounts AS blocker ON blocker.id = blocks.account_id JOIN accounts AS blocked ON blocked.id = blocks.blocked_account_id
       WHERE (blocker.player_id = ? AND blocked.player_id IN (SELECT value FROM json_each(?))) OR (blocked.player_id = ? AND blocker.player_id IN (SELECT value FROM json_each(?)))`,
    )
    .bind(playerId, othersJson, playerId, othersJson)
    .all<PlayerBlock>();
  return results;
}

/**
 * The player IDs of the accounts this one has a block with, either way, newest first and at most
 * MAXIMUM_PASS_BLOCK_COUNT: what its passes carry, as opaque tags (block_tag_ids), so a developer's own
 * server can keep the walls up too. Both ways, so a pass never says which side made a block.
 */
export async function blockPlayerIdsOf(database: D1Database, accountId: string, maximumCount = MAXIMUM_PASS_BLOCK_COUNT): Promise<string[]> {
  const { results } = await database
    .prepare(
      `SELECT accounts.player_id, MAX(walls.created_at_ms) AS created_at_ms FROM (
         SELECT blocked_account_id AS other_account_id, created_at_ms FROM blocks WHERE account_id = ?
         UNION ALL SELECT account_id AS other_account_id, created_at_ms FROM blocks WHERE blocked_account_id = ?
       ) AS walls JOIN accounts ON accounts.id = walls.other_account_id
       GROUP BY accounts.player_id ORDER BY created_at_ms DESC, accounts.player_id LIMIT ?`,
    )
    .bind(accountId, accountId, maximumCount)
    .all<{ player_id: string }>();
  return results.map((row) => row.player_id);
}
