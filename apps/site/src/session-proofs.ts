import { approvingPasskeys, passkeysFor } from "@zaisma/core";
import type { Session } from "./auth.ts";
import type { Env } from "./env.ts";

/**
 * How each session last proved it's them, for "Confirm it's you" (docs/DECISIONS.md, "How usernames and
 * passwords work"). Supabase's own record can't do it: it says "otp" for both a passkey and an email code, so
 * Zaisma keeps the proof itself, by Supabase's session ID, for a day.
 *
 * Changing the password or email, removing a passkey and deleting the account need a proof in the last 10
 * minutes by the strongest way the account has: a passkey that can approve (passkeys.ts) when it has one,
 * even right after a password sign-in; otherwise any proof counts.
 */

export const PROOF_KINDS = ["passkey", "password", "email_code", "google", "discord"] as const;
export type ProofKind = (typeof PROOF_KINDS)[number];

/** How long a proof lets someone change how the account signs in. */
export const RECENT_PROOF_MS = 10 * 60_000;
/** How long a proof is kept, so the table only holds sessions still going. */
const PROOF_KEPT_MS = 24 * 3600_000;

/** Remember that this session just proved it's them. Does nothing for a session without an ID. */
export async function recordProof(env: Env, session: Session, proofKind: ProofKind, passkeyId: string | null = null, nowMs = Date.now()): Promise<void> {
  if (!session.sessionId) return;
  await env.DB.prepare(
    `INSERT INTO session_proofs (session_id, account_id, proof_kind, passkey_id, proved_at_ms) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (session_id) DO UPDATE SET account_id = excluded.account_id, proof_kind = excluded.proof_kind, passkey_id = excluded.passkey_id, proved_at_ms = excluded.proved_at_ms`,
  )
    .bind(session.sessionId, session.userId, proofKind, passkeyId, nowMs)
    .run();
}

/** Give a new session the proof an old one had, when this device is signed in again without proving anything new. */
export async function carryProof(env: Env, fromSessionId: string, toSession: Session): Promise<void> {
  if (!fromSessionId || !toSession.sessionId) return;
  await env.DB.prepare(
    `INSERT INTO session_proofs (session_id, account_id, proof_kind, passkey_id, proved_at_ms)
     SELECT ?, account_id, proof_kind, passkey_id, proved_at_ms FROM session_proofs WHERE session_id = ? AND account_id = ?
     ON CONFLICT (session_id) DO UPDATE SET account_id = excluded.account_id, proof_kind = excluded.proof_kind, passkey_id = excluded.passkey_id, proved_at_ms = excluded.proved_at_ms`,
  )
    .bind(toSession.sessionId, fromSessionId, toSession.userId)
    .run();
}

export interface Confirmation {
  /** The session proved it's them in the last 10 minutes, by any way. */
  isProven: boolean;
  /** Proven by the strongest way the account has: enough to change how it signs in or delete it. */
  isConfirmed: boolean;
  /** The account has a passkey that can approve, so only a tap on one of them confirms. */
  isPasskeyNeeded: boolean;
}

export async function confirmationOf(env: Env, session: Session, accountId: string, nowMs = Date.now()): Promise<Confirmation> {
  const approving = approvingPasskeys(await passkeysFor(env.DB, accountId), nowMs);
  const proof = session.sessionId
    ? await env.DB.prepare("SELECT proof_kind, passkey_id, proved_at_ms FROM session_proofs WHERE session_id = ? AND account_id = ?").bind(session.sessionId, accountId).first<{ proof_kind: ProofKind; passkey_id: string | null; proved_at_ms: number }>()
    : null;
  const isProven = Boolean(proof) && nowMs - proof!.proved_at_ms < RECENT_PROOF_MS;
  const isPasskeyNeeded = approving.length > 0;
  const isConfirmed = isProven && (!isPasskeyNeeded || (proof!.proof_kind === "passkey" && approving.some((passkey) => passkey.id === proof!.passkey_id)));
  return { isProven, isConfirmed, isPasskeyNeeded };
}

/** Once a day: proofs of sessions long gone. */
export async function deleteOldProofs(env: Env, nowMs = Date.now()): Promise<void> {
  await env.DB.prepare("DELETE FROM session_proofs WHERE proved_at_ms <= ?").bind(nowMs - PROOF_KEPT_MS).run();
}
