import { ApiError, iso, newId } from "@zaisma/core";
import { apiCall, type Caller } from "./developer.ts";
import { logCallerEvent } from "./security-log.ts";
import type { Env } from "./env.ts";

/**
 * Game deletion requests (DEVELOPER-API.md, DELETE /games/:slug): deleting a game other people played, or erasing a
 * waiting game at once, is the developer's own step. A key, an AI app or the dashboard asks; Zaisma keeps what was asked,
 * the developer approves it on Developer settings with a passkey tap or declines it, and get_game_deletion_request checks
 * the answer. A request is for that account alone and expires a day after it was asked.
 */

export type GameDeletionRequestKind = "delete_game" | "erase_game_now";

const REQUEST_DURATION_MS = 86_400_000;
const MAXIMUM_WAITING_COUNT = 20;

interface GameDeletionRequestRow {
  id: string;
  account_id: string;
  game_id: string;
  request_kind: GameDeletionRequestKind;
  is_asked_from_dashboard: number;
  request_status: "waiting" | "approved" | "declined";
  created_at_ms: number;
  expires_at_ms: number;
  answered_at_ms: number | null;
}

/** Where the developer answers one request: Developer settings, with its sheet open. */
const requestUrl = (env: Env, id: string) => `${env.SITE_ORIGIN}/dashboard/settings?game_deletion_request=${id}`;

/**
 * Keeps what was asked, replacing the account's waiting one for the same game and kind, and answers confirmation_needed.
 * It changes nothing about the game: players keep playing until the developer approves.
 */
export async function askForGameDeletion(env: Env, caller: Caller, game: { id: string; title: string }, requestKind: GameDeletionRequestKind, nowMs = Date.now()): Promise<ApiError> {
  const id = newId("game_deletion_request");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM game_deletion_requests WHERE account_id = ? AND request_status = 'waiting' AND game_id = ? AND request_kind = ?").bind(caller.accountId, game.id, requestKind),
    // The most waiting at once: the 21st replaces the oldest.
    env.DB.prepare("DELETE FROM game_deletion_requests WHERE account_id = ? AND request_status = 'waiting' AND id IN (SELECT id FROM game_deletion_requests WHERE account_id = ? AND request_status = 'waiting' ORDER BY created_at_ms DESC LIMIT -1 OFFSET ?)").bind(caller.accountId, caller.accountId, MAXIMUM_WAITING_COUNT - 1),
    env.DB.prepare("INSERT INTO game_deletion_requests (id, account_id, game_id, request_kind, is_asked_from_dashboard, created_at_ms, expires_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, caller.accountId, game.id, requestKind, caller.via === "dashboard" ? 1 : 0, nowMs, nowMs + REQUEST_DURATION_MS),
  ]);
  if (caller.via !== "dashboard") await logCallerEvent(env, caller, "game_deletion_asked", { gameId: game.id });
  return new ApiError("confirmation_needed", {
    message: requestKind === "delete_game" ? `Deleting ${game.title} needs the developer's passkey on zaisma.com, since other people played it. Nothing has changed: players keep playing.` : `Erasing ${game.title} before its week is over needs the developer's passkey on zaisma.com.`,
    fix: "Give the developer confirm_url: it opens a sheet naming the game and what goes with it, where they approve with a passkey tap or decline. Check the answer with get_game_deletion_request (game_deletion_request_id).",
    confirmUrl: requestUrl(env, id),
    gameDeletionRequestId: id,
  });
}

async function rowOf(env: Env, accountId: string, id: string): Promise<GameDeletionRequestRow | null> {
  return env.DB.prepare("SELECT * FROM game_deletion_requests WHERE id = ? AND account_id = ?").bind(id, accountId).first<GameDeletionRequestRow>();
}

const statusOf = (row: GameDeletionRequestRow, nowMs: number) => (row.request_status === "waiting" && nowMs >= row.expires_at_ms ? "expired" : row.request_status);

/** The game_deletion_request answer, or null when this account has no such request, or it's for another game than onlyGameId. */
export async function gameDeletionRequestAnswer(env: Env, accountId: string, id: string, onlyGameId: string | null = null, nowMs = Date.now()) {
  const row = await rowOf(env, accountId, id);
  if (!row || (onlyGameId !== null && row.game_id !== onlyGameId)) return null;
  const game = await env.DB.prepare(
    `SELECT games.slug, games.title,
       (SELECT COUNT(*) FROM saves WHERE saves.game_id = games.id AND saves.account_id IS NOT owners.account_id) AS player_with_save_count,
       (SELECT COUNT(*) FROM purchases WHERE purchases.game_id = games.id) AS purchase_count
     FROM games LEFT JOIN owners ON owners.id = games.owner_id WHERE games.id = ?`,
  )
    .bind(row.game_id)
    .first<{ slug: string; title: string; player_with_save_count: number; purchase_count: number }>();
  return {
    id: row.id,
    request_kind: row.request_kind,
    game_slug: game?.slug ?? null,
    game_title: game?.title ?? null,
    player_with_save_count: game?.player_with_save_count ?? 0,
    purchase_count: game?.purchase_count ?? 0,
    is_asked_from_dashboard: row.is_asked_from_dashboard === 1,
    request_status: statusOf(row, nowMs),
    created_at: iso(row.created_at_ms),
    expires_at: iso(row.expires_at_ms),
    answered_at: row.answered_at_ms === null ? null : iso(row.answered_at_ms),
  };
}

/**
 * The developer's answer, from Developer settings: approving makes the same API call a key made, so it checks everything
 * that call checks, with a caller whose passkey tap is fresh (isPasskeyConfirmed). Answers the game's slug once it's done.
 */
export async function answerGameDeletionRequest(env: Env, caller: Caller, id: string, answer: "approved" | "declined", nowMs = Date.now()): Promise<{ outcome: "answered" | "not_waiting"; gameSlug: string | null }> {
  const row = await rowOf(env, caller.accountId, id);
  if (!row || statusOf(row, nowMs) !== "waiting") return { outcome: "not_waiting", gameSlug: null };
  const game = await env.DB.prepare("SELECT slug FROM games WHERE id = ? AND owner_id IS NOT NULL").bind(row.game_id).first<{ slug: string }>();
  if (!game) return { outcome: "not_waiting", gameSlug: null };
  if (answer === "approved") {
    if (!caller.isPasskeyConfirmed) {
      throw new ApiError("confirmation_needed", { message: "Approving this needs the developer's passkey tap.", fix: "Tap the passkey, then approve.", confirmUrl: requestUrl(env, id) });
    }
    if (row.request_kind === "delete_game") await apiCall(env, caller, "DELETE", `/games/${game.slug}`, { confirm_slug: game.slug });
    else await apiCall(env, caller, "POST", `/games/${game.slug}/erase-now`, { confirm_slug: game.slug });
  }
  await env.DB.prepare("UPDATE game_deletion_requests SET request_status = ?, answered_at_ms = ? WHERE id = ? AND request_status = 'waiting'").bind(answer, nowMs, id).run();
  return { outcome: "answered", gameSlug: game.slug };
}
