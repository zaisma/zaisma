import { ApiError, iso, newId } from "@zaisma/core";
import { apiCall, type Caller } from "./developer.ts";
import { creditAnswer, confirmUrlOf } from "./credit-api.ts";
import type { Env } from "./env.ts";

/**
 * Spending requests (docs/DECISIONS.md, "The dashboard is three kinds of page", Developer settings): when an API key or an
 * AI app asks to turn spending on or up, Zaisma keeps the exact change. The developer approves it on Developer settings with
 * a passkey tap, or declines it; the AI checks the answer with get_spending_request. A request is for that account alone,
 * and expires a day after it was asked, so a stolen key can ask but never approve.
 */

export type SpendingRequestKind = "game_budget" | "automatic_top_up";

/** The change asked for: a game's monthly budget, or the automatic top-up as it would be. */
export type SpendingChange =
  | { requestKind: "game_budget"; gameId: string; monthlyBudgetCents: number }
  | { requestKind: "automatic_top_up"; isEnabled: boolean; topUpBelowCents: number; topUpAmountCents: number; monthlyTopUpLimitCents: number };

const REQUEST_DURATION_MS = 86_400_000;
const MAXIMUM_WAITING_COUNT = 20;

interface SpendingRequestRow {
  id: string;
  account_id: string;
  request_kind: SpendingRequestKind;
  game_id: string | null;
  monthly_budget_cents: number | null;
  is_automatic_top_up_enabled: number | null;
  top_up_below_cents: number | null;
  top_up_amount_cents: number | null;
  monthly_top_up_limit_cents: number | null;
  request_status: "waiting" | "approved" | "declined";
  created_at_ms: number;
  expires_at_ms: number;
  answered_at_ms: number | null;
}

/** Keeps a change for the developer to approve, replacing the account's waiting one for the same game and kind; answers its ID. */
export async function askForSpending(env: Env, accountId: string, change: SpendingChange, nowMs = Date.now()): Promise<string> {
  const id = newId("spending_request");
  const gameId = change.requestKind === "game_budget" ? change.gameId : null;
  const statements = [
    env.DB.prepare("DELETE FROM spending_requests WHERE account_id = ? AND request_status = 'waiting' AND request_kind = ? AND game_id IS ?").bind(accountId, change.requestKind, gameId),
    // The most waiting at once: the 21st replaces the oldest.
    env.DB.prepare("DELETE FROM spending_requests WHERE account_id = ? AND request_status = 'waiting' AND id IN (SELECT id FROM spending_requests WHERE account_id = ? AND request_status = 'waiting' ORDER BY created_at_ms DESC LIMIT -1 OFFSET ?)").bind(accountId, accountId, MAXIMUM_WAITING_COUNT - 1),
    env.DB.prepare(
      "INSERT INTO spending_requests (id, account_id, request_kind, game_id, monthly_budget_cents, is_automatic_top_up_enabled, top_up_below_cents, top_up_amount_cents, monthly_top_up_limit_cents, created_at_ms, expires_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      id,
      accountId,
      change.requestKind,
      gameId,
      change.requestKind === "game_budget" ? change.monthlyBudgetCents : null,
      change.requestKind === "automatic_top_up" ? (change.isEnabled ? 1 : 0) : null,
      change.requestKind === "automatic_top_up" ? change.topUpBelowCents : null,
      change.requestKind === "automatic_top_up" ? change.topUpAmountCents : null,
      change.requestKind === "automatic_top_up" ? change.monthlyTopUpLimitCents : null,
      nowMs,
      nowMs + REQUEST_DURATION_MS,
    ),
  ];
  await env.DB.batch(statements);
  return id;
}

/** Where the developer answers one request: Developer settings, over the Hosting pane. */
export const spendingRequestUrl = (env: Env, id: string) => `${confirmUrlOf(env).split("#")[0]}?spending_request=${id}`;

async function rowOf(env: Env, accountId: string, id: string): Promise<SpendingRequestRow | null> {
  return env.DB.prepare("SELECT * FROM spending_requests WHERE id = ? AND account_id = ?").bind(id, accountId).first<SpendingRequestRow>();
}

const statusOf = (row: SpendingRequestRow, nowMs: number) => (row.request_status === "waiting" && nowMs >= row.expires_at_ms ? "expired" : row.request_status);

/** The spending_request answer, or null when this account has no such request. */
export async function spendingRequestAnswer(env: Env, accountId: string, ownerId: string, id: string, nowMs = Date.now()) {
  const row = await rowOf(env, accountId, id);
  if (!row) return null;
  const game = row.game_id ? await env.DB.prepare("SELECT slug, title, monthly_budget_cents FROM games WHERE id = ?").bind(row.game_id).first<{ slug: string; title: string; monthly_budget_cents: number | null }>() : null;
  const automatic = row.request_kind === "automatic_top_up" ? (await creditAnswer(env, ownerId, nowMs)).automatic_top_up : null;
  return {
    id: row.id,
    request_kind: row.request_kind,
    game_slug: game?.slug ?? null,
    game_title: game?.title ?? null,
    // Every field of both kinds, the other kind's null.
    requested_change: {
      monthly_budget_cents: row.request_kind === "game_budget" ? row.monthly_budget_cents : null,
      is_enabled: row.request_kind === "automatic_top_up" ? row.is_automatic_top_up_enabled === 1 : null,
      top_up_below_cents: row.top_up_below_cents,
      top_up_amount_cents: row.top_up_amount_cents,
      monthly_top_up_limit_cents: row.monthly_top_up_limit_cents,
    },
    current_setting: {
      monthly_budget_cents: row.request_kind === "game_budget" ? game?.monthly_budget_cents ?? null : null,
      is_enabled: automatic ? automatic.is_enabled : null,
      top_up_below_cents: automatic?.top_up_below_cents ?? null,
      top_up_amount_cents: automatic?.top_up_amount_cents ?? null,
      monthly_top_up_limit_cents: automatic?.monthly_top_up_limit_cents ?? null,
    },
    request_status: statusOf(row, nowMs),
    created_at: iso(row.created_at_ms),
    expires_at: iso(row.expires_at_ms),
    answered_at: row.answered_at_ms === null ? null : iso(row.answered_at_ms),
  };
}

/**
 * The developer's answer, from Developer settings: approving makes the change through the same API call that a confirmed
 * raise makes, so it checks everything that call checks. It needs a caller whose passkey tap is fresh (isSpendingConfirmed).
 */
export async function answerSpendingRequest(env: Env, caller: Caller, id: string, answer: "approved" | "declined", nowMs = Date.now()): Promise<"answered" | "not_waiting"> {
  const row = await rowOf(env, caller.accountId, id);
  if (!row || statusOf(row, nowMs) !== "waiting") return "not_waiting";
  if (answer === "approved") {
    if (!caller.isSpendingConfirmed) {
      throw new ApiError("confirmation_needed", { message: "Approving spending needs the developer's passkey tap.", fix: "Tap the passkey, then approve.", confirmUrl: spendingRequestUrl(env, id) });
    }
    if (row.request_kind === "game_budget") {
      const game = await env.DB.prepare("SELECT slug FROM games WHERE id = ?").bind(row.game_id).first<{ slug: string }>();
      if (!game) return "not_waiting";
      await apiCall(env, caller, "PATCH", `/games/${game.slug}`, { monthly_budget_cents: row.monthly_budget_cents });
    } else {
      await apiCall(env, caller, "PATCH", "/credit/automatic-top-up", {
        is_enabled: row.is_automatic_top_up_enabled === 1,
        top_up_below_cents: row.top_up_below_cents,
        top_up_amount_cents: row.top_up_amount_cents,
        monthly_top_up_limit_cents: row.monthly_top_up_limit_cents,
      });
    }
  }
  await env.DB.prepare("UPDATE spending_requests SET request_status = ?, answered_at_ms = ? WHERE id = ? AND request_status = 'waiting'").bind(answer, nowMs, id).run();
  return "answered";
}
