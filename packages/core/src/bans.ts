import { newId, sha256Hex } from "./ids.ts";
import type { Account } from "./accounts.ts";

/**
 * Account bans (docs/DECISIONS.md, "Bans follow what's costly to replace, never who someone is"). A developer ban
 * takes the account's games down and stops it making, uploading and publishing; a whole-account ban also ends its
 * sign-in. A ban carries over what a new account can't get for free, as banned marks: the cards that paid Zaisma,
 * the connected Stripe account and the email. Never a device, network or address.
 */
export const BAN_SCOPES = ["developer", "whole_account"] as const;
export type BanScope = (typeof BAN_SCOPES)[number];

export const BAN_MARK_KINDS = ["card", "stripe_account", "email"] as const;
export type BanMarkKind = (typeof BAN_MARK_KINDS)[number];

/** What a person decided about another account that used a banned card: the same person (banned), or a family sharing it. */
export const BAN_MATCH_DECISIONS = ["banned", "not_the_same_person"] as const;
export type BanMatchDecision = (typeof BAN_MATCH_DECISIONS)[number];

/** A mark as it's kept: SHA-256 hex of what's given, an email lowercased and trimmed first. */
export function markSha256(kind: BanMarkKind, given: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(kind === "email" ? given.trim().toLowerCase() : given));
}

/** Whether a card fingerprint, Stripe account ID or email is one a ban carries. */
export async function isBannedMark(database: D1Database, kind: BanMarkKind, given: string): Promise<boolean> {
  return (await database.prepare("SELECT 1 FROM banned_marks WHERE mark_kind = ? AND mark_sha256 = ?").bind(kind, await markSha256(kind, given)).first()) !== null;
}

/** The banned account a mark came from, or null when it's no banned mark. */
export async function bannedAccountOfMark(database: D1Database, kind: BanMarkKind, given: string): Promise<string | null> {
  const row = await database.prepare("SELECT banned_account_id FROM banned_marks WHERE mark_kind = ? AND mark_sha256 = ?").bind(kind, await markSha256(kind, given)).first<{ banned_account_id: string }>();
  return row?.banned_account_id ?? null;
}

/** A match for a person to decide, unless one for this account and kind is still undecided: answers the new match's ID, or null. */
export async function recordBanMatch(database: D1Database, accountId: string, kind: BanMarkKind, bannedAccountId: string, nowMs: number): Promise<string | null> {
  const id = newId("ban_match");
  const made = await database
    .prepare("INSERT INTO ban_matches (id, account_id, mark_kind, banned_account_id, found_at_ms) SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM ban_matches WHERE account_id = ? AND mark_kind = ? AND decided_at_ms IS NULL)")
    .bind(id, accountId, kind, bannedAccountId, nowMs, accountId, kind)
    .run();
  return made.meta.changes ? id : null;
}

export const isBanned = (account: Pick<Account, "banned_at_ms">): boolean => account.banned_at_ms !== null;
export const banScopeOf = (account: Pick<Account, "banned_at_ms" | "ban_scope">): BanScope | null => (account.banned_at_ms === null ? null : account.ban_scope);
