import { STANDING_LIMITS, noteRuling, rulingWaitEndsAt, type Standing } from "@zaisma/core";
import type { Env } from "./env.ts";

/**
 * Account standing's counting (packages/core/src/standing.ts rules on it live). Every five minutes, the owners
 * with a game whose standing was last counted over a day ago, a few hundred at a time, so each is counted once
 * a day and a run stays inside a Worker's limits.
 */

const DAY_MS = 86_400_000;
/** Owners counted in one run of the cron. */
const CHECKED_OWNER_COUNT = 200;

/** Count each owner's returning players and whether it's established, for owners last counted over a day ago. */
export async function checkStanding(env: Env, nowMs = Date.now()): Promise<void> {
  const { results: owners } = await env.DB
    .prepare(
      `SELECT owners.id, owners.is_zaisma_account, owners.last_ruling_at_ms, COALESCE(accounts.created_at_ms, owners.created_at_ms) AS account_created_at_ms, accounts.banned_at_ms,
        (SELECT COUNT(DISTINCT returning.account_id) FROM game_returning_players returning JOIN games ON games.id = returning.game_id JOIN accounts player ON player.id = returning.account_id
          WHERE games.owner_id = owners.id AND returning.counted_day_count >= ?1 AND player.created_at_ms <= ?2 AND player.counted_play_day_count >= ?3
            AND player.social_stopped_reason IS NULL AND player.banned_at_ms IS NULL AND player.id IS NOT owners.account_id) AS returning_player_count
      FROM owners LEFT JOIN accounts ON accounts.id = owners.account_id
      WHERE EXISTS (SELECT 1 FROM games WHERE games.owner_id = owners.id) AND (owners.standing_checked_at_ms IS NULL OR owners.standing_checked_at_ms <= ?4)
      ORDER BY owners.standing_checked_at_ms IS NOT NULL, owners.standing_checked_at_ms LIMIT ?5`,
    )
    .bind(STANDING_LIMITS.minimumReturningPlayerCountedDayCount, nowMs - STANDING_LIMITS.minimumPlayerAccountAgeDays * DAY_MS, STANDING_LIMITS.minimumPlayerCountedDayCount, nowMs - DAY_MS, CHECKED_OWNER_COUNT)
    .all<{ id: string; is_zaisma_account: number; last_ruling_at_ms: number | null; account_created_at_ms: number; banned_at_ms: number | null; returning_player_count: number }>();
  if (owners.length === 0) return;
  await env.DB.batch(
    owners.map((owner) => {
      const isEstablished =
        owner.banned_at_ms === null &&
        rulingWaitEndsAt(owner.last_ruling_at_ms, nowMs) === null &&
        (owner.is_zaisma_account === 1 || (nowMs - owner.account_created_at_ms >= STANDING_LIMITS.minimumDeveloperAccountAgeDays * DAY_MS && owner.returning_player_count >= STANDING_LIMITS.minimumReturningPlayerCount));
      return env.DB.prepare("UPDATE owners SET returning_player_count = ?, is_established = ?, standing_checked_at_ms = ? WHERE id = ?").bind(owner.returning_player_count, isEstablished ? 1 : 0, nowMs, owner.id);
    }),
  );
}

/** A ruling on one of a game's versions or the game itself: its owner's powers wait from now (an ownerless game has none). */
export async function noteRulingOnGame(env: Env, gameId: string, nowMs = Date.now()): Promise<void> {
  const game = await env.DB.prepare("SELECT owner_id FROM games WHERE id = ?").bind(gameId).first<{ owner_id: string | null }>();
  if (game?.owner_id) await noteRuling(env.DB, game.owner_id, nowMs);
}

const shortDate = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** The facts the words need, from a Standing or from GET /access's answer (the dashboard). */
type StandingFacts = Pick<Standing, "outsideLinksEnabled" | "isBanned" | "rulingWaitEndsAtMs" | "returningPlayerCount" | "accountAgeDays">;

/** What's still missing to be established, as the end of a sentence ("20 different players have come back… 12 so far."), or null when nothing is. */
function establishedNeeds(standing: StandingFacts): string | null {
  const isShortOfPlayers = standing.returningPlayerCount < STANDING_LIMITS.minimumReturningPlayerCount;
  const remainingDayCount = STANDING_LIMITS.minimumDeveloperAccountAgeDays - standing.accountAgeDays;
  const players = `${STANDING_LIMITS.minimumReturningPlayerCount} different players have come back to your games`;
  const age = `your account is ${STANDING_LIMITS.minimumDeveloperAccountAgeDays} days old`;
  const daysToGo = `${remainingDayCount} ${remainingDayCount === 1 ? "day" : "days"} to go`;
  if (isShortOfPlayers && remainingDayCount > 0) return `${players} and ${age}. ${standing.returningPlayerCount} so far, and ${daysToGo}.`;
  if (isShortOfPlayers) return `${players}. ${standing.returningPlayerCount} so far.`;
  if (remainingDayCount > 0) return `${age}: ${daysToGo}.`;
  return null;
}

/** Why links to other sites don't open yet and what opens them, in a sentence; null when they open. */
export function outsideLinksWaitWords(standing: StandingFacts): string | null {
  if (standing.outsideLinksEnabled) return null;
  if (standing.isBanned) return "Links to other sites stay closed while Zaisma has this account banned.";
  if (standing.rulingWaitEndsAtMs !== null) return `Links to other sites open again on ${shortDate(standing.rulingWaitEndsAtMs)}, ${STANDING_LIMITS.rulingWaitDurationDays} days after Zaisma rejected a version or took a game down.`;
  const needs = establishedNeeds(standing);
  return needs ? `Links to other sites open once ${needs}` : "Links to other sites open at the next daily count, within a day.";
}

/** What's open and what opens next, in one or two sentences: the access answer's standing.message_for_people. */
export function standingWords(standing: Standing): string {
  if (standing.searchEnginesEnabled) return "Links to other sites and search engines are open.";
  const linksWait = outsideLinksWaitWords(standing);
  if (linksWait) return standing.isBanned || standing.rulingWaitEndsAtMs !== null ? `${linksWait} Search engines wait too.` : `${linksWait} A card on your account opens them now.`;
  const needs = establishedNeeds(standing);
  return `Links to other sites are open. Search engines find your games once ${needs ?? "the next daily count says you're established, within a day."}`;
}
