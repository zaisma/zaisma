import type { Account } from "./accounts.ts";

/**
 * Account standing (docs/DECISIONS.md, "Standing, not identity."): what an account has earned, from plain facts
 * with exact numbers, never a hidden score or a ruling about who someone is. A developer is established once its
 * account is 14 days old, 20 different returning players have played its games, and nothing was ruled against it
 * in 30 days: that opens links to any site and search engines. A card that paid Zaisma, or a connected Stripe
 * account that can take payments, opens links to any site at once, never search engines: money never buys reach.
 * Players earn standing by playing, and it decides whose plays count toward a developer's.
 *
 * The daily check (apps/site/src/standing.ts, checkStanding) counts; the live check here rules, so a ruling or
 * a ban closes every power at once.
 */
export const STANDING_LIMITS = {
  minimumDeveloperAccountAgeDays: 14,
  minimumReturningPlayerCount: 20,
  /** Different days a player's plays counted on the developer's games, for the player to be a returning one. */
  minimumReturningPlayerCountedDayCount: 2,
  /** A returning player's own account: this old, with plays counted on this many different days on any game. */
  minimumPlayerAccountAgeDays: 7,
  minimumPlayerCountedDayCount: 3,
  /** After a version is rejected or a game taken down, the developer's powers wait this long. */
  rulingWaitDurationDays: 30,
  /** A new 16–17 account set to chat with anyone chats only with friends until it's this old, with plays counted on this many different days. */
  minimumStrangerChatAccountAgeHours: 24,
  minimumStrangerChatCountedDayCount: 2,
} as const;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** What a developer has earned, and what each power needs. */
export interface Standing {
  isEstablishedDeveloper: boolean;
  outsideLinksEnabled: boolean;
  searchEnginesEnabled: boolean;
  /** Returning players as the daily check last counted them. */
  returningPlayerCount: number;
  accountAgeDays: number;
  lastRulingAtMs: number | null;
  /** When the wait after the last ruling ends, while it's on; null when there's no wait. */
  rulingWaitEndsAtMs: number | null;
  hasCardOrStripeAccount: boolean;
  isBanned: boolean;
}

const NO_STANDING: Standing = {
  isEstablishedDeveloper: false,
  outsideLinksEnabled: false,
  searchEnginesEnabled: false,
  returningPlayerCount: 0,
  accountAgeDays: 0,
  lastRulingAtMs: null,
  rulingWaitEndsAtMs: null,
  hasCardOrStripeAccount: false,
  isBanned: false,
};

/** When the wait after a ruling made at rulingAtMs ends, or null when it already has (or there was none). */
export function rulingWaitEndsAt(lastRulingAtMs: number | null, nowMs: number): number | null {
  if (lastRulingAtMs === null) return null;
  const endsAtMs = lastRulingAtMs + STANDING_LIMITS.rulingWaitDurationDays * DAY_MS;
  return endsAtMs > nowMs ? endsAtMs : null;
}

/** A developer's standing now, live: a ban or a ruling inside the wait closes everything. An ownerless game's is none. */
export async function standingOf(database: D1Database, ownerId: string | null, nowMs: number): Promise<Standing> {
  if (!ownerId) return NO_STANDING;
  const row = await database
    .prepare(
      `SELECT owners.is_established, owners.is_zaisma_account, owners.returning_player_count, owners.last_ruling_at_ms, owners.created_at_ms AS owner_created_at_ms,
        owners.stripe_account_id, owners.can_take_stripe_payments, accounts.created_at_ms AS account_created_at_ms, accounts.banned_at_ms,
        EXISTS (SELECT 1 FROM owner_cards WHERE owner_cards.owner_id = owners.id AND NOT EXISTS (SELECT 1 FROM banned_marks WHERE banned_marks.mark_kind = 'card' AND banned_marks.mark_sha256 = owner_cards.card_fingerprint_sha256)) AS has_card
      FROM owners LEFT JOIN accounts ON accounts.id = owners.account_id WHERE owners.id = ?`,
    )
    .bind(ownerId)
    .first<{
      is_established: number;
      is_zaisma_account: number;
      returning_player_count: number;
      last_ruling_at_ms: number | null;
      owner_created_at_ms: number;
      stripe_account_id: string | null;
      can_take_stripe_payments: number;
      account_created_at_ms: number | null;
      banned_at_ms: number | null;
      has_card: number;
    }>();
  if (!row) return NO_STANDING;
  const accountAgeDays = Math.max(0, Math.floor((nowMs - (row.account_created_at_ms ?? row.owner_created_at_ms)) / DAY_MS));
  const rulingWaitEndsAtMs = rulingWaitEndsAt(row.last_ruling_at_ms, nowMs);
  const hasCardOrStripeAccount = row.has_card === 1 || (row.stripe_account_id !== null && row.can_take_stripe_payments === 1);
  const isBanned = row.banned_at_ms !== null;
  const facts = { returningPlayerCount: row.returning_player_count, accountAgeDays, lastRulingAtMs: row.last_ruling_at_ms, rulingWaitEndsAtMs, hasCardOrStripeAccount, isBanned };
  if (isBanned || rulingWaitEndsAtMs !== null) return { ...NO_STANDING, ...facts };
  const isEstablishedDeveloper = row.is_established === 1 || row.is_zaisma_account === 1;
  return { ...facts, isEstablishedDeveloper, outsideLinksEnabled: isEstablishedDeveloper || hasCardOrStripeAccount, searchEnginesEnabled: isEstablishedDeveloper };
}

/**
 * The same rule as searchEnginesEnabled, as a WHERE fragment on games (through games.owner_id), for the sitemap.
 * It reads is_established, which noteRuling and a ban clear at once and the daily check sets again after the wait.
 */
export const SEARCH_ENGINES_ENABLED_SQL =
  "EXISTS (SELECT 1 FROM owners LEFT JOIN accounts ON accounts.id = owners.account_id WHERE owners.id = games.owner_id AND owners.is_established = 1 AND accounts.banned_at_ms IS NULL)";

/** A counted play by a signed-in player: one more counted day for the game and the account when it's a new date. */
export async function recordReturningPlay(database: D1Database, gameId: string, accountId: string, date: string): Promise<void> {
  await database.batch([
    database
      .prepare(
        `INSERT INTO game_returning_players (game_id, account_id, first_counted_date, last_counted_date, counted_day_count) VALUES (?1, ?2, ?3, ?3, 1)
        ON CONFLICT (game_id, account_id) DO UPDATE SET counted_day_count = counted_day_count + 1, last_counted_date = excluded.last_counted_date WHERE excluded.last_counted_date > last_counted_date`,
      )
      .bind(gameId, accountId, date),
    database
      .prepare("UPDATE accounts SET counted_play_day_count = counted_play_day_count + 1, last_counted_play_date = ?1 WHERE id = ?2 AND (last_counted_play_date IS NULL OR last_counted_play_date < ?1)")
      .bind(date, accountId),
  ]);
}

/** A ruling against the developer (a rejected version, a game taken down): its powers wait from now, and search engines stop at once. */
export async function noteRuling(database: D1Database, ownerId: string, nowMs: number): Promise<void> {
  await database.prepare("UPDATE owners SET last_ruling_at_ms = ?, is_established = 0 WHERE id = ?").bind(nowMs, ownerId).run();
}

/**
 * Whether a 16–17 account set to chat with anyone still chats only with friends: until it's 24 hours old and has
 * played on a second day, so a banned player can't come back and type to teen strangers that evening. 13–15
 * accounts never chat beyond friends and adults never reach teens, so only 16–17 accounts wait.
 */
export function isStrangerChatWaiting(account: Pick<Account, "age_band" | "created_at_ms" | "counted_play_day_count">, nowMs: number): boolean {
  if (account.age_band !== "16-17") return false;
  return nowMs - account.created_at_ms < STANDING_LIMITS.minimumStrangerChatAccountAgeHours * HOUR_MS || account.counted_play_day_count < STANDING_LIMITS.minimumStrangerChatCountedDayCount;
}
