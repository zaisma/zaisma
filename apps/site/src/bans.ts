import { ApiError, audit, bannedAccountOfMark, markSha256, personOwner, recordBanMatch, stopSocial, type Account, type BanMarkKind, type BanMatchDecision, type BanScope, type ContentRule } from "@zaisma/core";
import { takeDownGame } from "./admin.ts";
import { authUserEmail, endSessionsBefore, realEmail } from "./auth.ts";
import { sendAlert } from "./email.ts";
import { stripeCall } from "./stripe.ts";
import type { Env } from "./env.ts";

/**
 * Account bans from the admin MCP (docs/DECISIONS.md, "Bans follow what's costly to replace, never who someone is").
 * A developer ban takes down every game of the account's person owner and stops it making, uploading and publishing
 * (developer.ts, checkCall); it can still read get_access, list its games and export them. A whole-account ban (child
 * safety, illegal content) also ends its sign-in, its sessions and its API keys, and turns its social side off.
 * Either way the ban carries over, as banned marks, the cards that paid Zaisma, the connected Stripe account and the
 * email: a new account can't connect that Stripe account or add that email, and a banned card on another account goes
 * to a person (a ban match), since a family can share a card. Never a device, network or address.
 */

export interface Banned {
  bannedAtMs: number;
  takenDownGameSlugs: string[];
  bannedMarkCount: number;
}

export async function banAccount(env: Env, ban: { account: Account; banScope: BanScope; why: string; contentRule: ContentRule | null; actor: string; nowMs?: number }): Promise<Banned> {
  const { account, banScope, why, contentRule, actor } = ban;
  const nowMs = ban.nowMs ?? Date.now();
  // A developer ban widens to the whole account; anything else is a ban already made.
  if (account.banned_at_ms !== null && !(account.ban_scope === "developer" && banScope === "whole_account")) {
    throw new ApiError("already_banned", {
      message: `@${account.username} is banned already (${account.ban_scope}).`,
      field: "ban_scope",
      fix: account.ban_scope === "developer" ? "Only whole_account widens a developer ban." : "Nothing to do: a whole-account ban is the widest. unban_account lifts it.",
    });
  }
  const bannedAtMs = account.banned_at_ms ?? nowMs;
  await env.DB.prepare("UPDATE accounts SET banned_at_ms = ?, ban_scope = ?, ban_reason = ?, ban_content_rule = ?, updated_at_ms = ? WHERE id = ?").bind(bannedAtMs, banScope, why, contentRule, nowMs, account.id).run();

  // Every game of theirs still up comes down, as a takedown from the queue does.
  const owner = await personOwner(env.DB, account.id);
  const { results: games } = await env.DB.prepare("SELECT id, slug FROM games WHERE owner_id = ? AND review_status != 'removed' ORDER BY created_at_ms").bind(owner.id).all<{ id: string; slug: string }>();
  for (const game of games) await takeDownGame(env, game.id, contentRule, why, actor);

  // The marks: what a new account can't get for free.
  const ownerRow = await env.DB.prepare("SELECT stripe_account_id FROM owners WHERE id = ?").bind(owner.id).first<{ stripe_account_id: string | null }>();
  const email = realEmail((await authUserEmail(env, account.id)) ?? "");
  const { results: cards } = await env.DB.prepare("SELECT card_fingerprint_sha256 FROM owner_cards WHERE owner_id = ?").bind(owner.id).all<{ card_fingerprint_sha256: string }>();
  const marks: { kind: BanMarkKind; sha256: string }[] = [
    ...cards.map((card) => ({ kind: "card" as const, sha256: card.card_fingerprint_sha256 })),
    ...(ownerRow?.stripe_account_id ? [{ kind: "stripe_account" as const, sha256: await markSha256("stripe_account", ownerRow.stripe_account_id) }] : []),
    ...(email ? [{ kind: "email" as const, sha256: await markSha256("email", email) }] : []),
  ];
  const insertMark = env.DB.prepare("INSERT INTO banned_marks (mark_kind, mark_sha256, banned_account_id, banned_at_ms) VALUES (?, ?, ?, ?) ON CONFLICT (mark_kind, mark_sha256) DO NOTHING");
  if (marks.length) await env.DB.batch(marks.map((mark) => insertMark.bind(mark.kind, mark.sha256, account.id, nowMs)));

  if (banScope === "whole_account") {
    // Child safety and sexual content keep that label; anything else is the nearest: a threat to real people.
    await stopSocial(env.DB, account.id, contentRule === "child_safety" || contentRule === "sexual" ? "sexual" : "real_life_threat", nowMs);
    await endSessionsBefore(env, account.id, nowMs, "up");
    // Turned off with no place found: the API answers account_banned for them (developer.ts).
    await env.DB.prepare("UPDATE api_keys SET turned_off_at_ms = ?, found_in = NULL, found_at_url = NULL WHERE account_id = ? AND turned_off_at_ms IS NULL").bind(nowMs, account.id).run();
  }
  await audit(env.DB, null, "account_banned", `@${account.username} (${banScope}): ${why}`, actor);
  return { bannedAtMs, takenDownGameSlugs: games.map((game) => game.slug), bannedMarkCount: await bannedMarkCount(env, account.id) };
}

/** Lift a ban and its marks. Its games stay down: each comes back with its own restore and its own reason. */
export async function unbanAccount(env: Env, unban: { account: Account; why: string; actor: string; nowMs?: number }): Promise<void> {
  const { account, why, actor } = unban;
  if (account.banned_at_ms === null) throw new ApiError("not_banned", { message: `@${account.username} isn't banned.`, field: "username", fix: "Nothing to lift. Check the username on their profile page (zaisma.com/@<username>)." });
  await env.DB.batch([
    env.DB.prepare("UPDATE accounts SET banned_at_ms = NULL, ban_scope = NULL, ban_reason = NULL, ban_content_rule = NULL, updated_at_ms = ? WHERE id = ?").bind(unban.nowMs ?? Date.now(), account.id),
    env.DB.prepare("DELETE FROM banned_marks WHERE banned_account_id = ?").bind(account.id),
  ]);
  await audit(env.DB, null, "account_unbanned", `@${account.username}: ${why}`, actor);
}

export interface BanMatch {
  id: string;
  account_id: string;
  mark_kind: BanMarkKind;
  banned_account_id: string;
  found_at_ms: number;
  decided_at_ms: number | null;
  decision: BanMatchDecision | null;
}

/** A person decides a ban match: banned bans that account's developer side; either way the match closes. */
export async function decideBanMatch(env: Env, decided: { banMatch: BanMatch; account: Account | null; decision: BanMatchDecision; why: string; actor: string; nowMs?: number }): Promise<void> {
  const nowMs = decided.nowMs ?? Date.now();
  const closed = await env.DB.prepare("UPDATE ban_matches SET decided_at_ms = ?, decision = ? WHERE id = ? AND decided_at_ms IS NULL").bind(nowMs, decided.decision, decided.banMatch.id).run();
  if (!closed.meta.changes) throw new ApiError("ban_match_decided", { message: `${decided.banMatch.id} was decided already.`, field: "ban_match_id", fix: "list_ban_matches lists the ones still waiting." });
  if (decided.decision === "banned" && decided.account && decided.account.banned_at_ms === null) {
    // The same person: the rule the first account broke.
    const first = await env.DB.prepare("SELECT ban_content_rule FROM accounts WHERE id = ?").bind(decided.banMatch.banned_account_id).first<{ ban_content_rule: ContentRule | null }>();
    await banAccount(env, { account: decided.account, banScope: "developer", why: decided.why, contentRule: first?.ban_content_rule ?? null, actor: decided.actor, nowMs });
  }
  await audit(env.DB, null, "ban_match_decided", `${decided.banMatch.id} ${decided.decision}: ${decided.why}`, decided.actor);
}

export async function bannedMarkCount(env: Env, accountId: string): Promise<number> {
  return (await env.DB.prepare("SELECT COUNT(*) AS mark_count FROM banned_marks WHERE banned_account_id = ?").bind(accountId).first<{ mark_count: number }>())?.mark_count ?? 0;
}

/**
 * A card paid Zaisma for this owner (a top-up's payment intent, pi_…, or Pro's payment method, pm_…): its fingerprint
 * is kept, and a card banned with another account opens a ban match and alerts the admin. A Stripe failure is logged
 * and skipped: the payment itself never waits on it.
 */
export async function recordPaidCard(env: Env, ownerId: string, paymentId: string, nowMs = Date.now()): Promise<void> {
  let fingerprint: string | null = null;
  try {
    const paymentMethod = paymentId.startsWith("pi_") ? (await stripeCall(env, "GET", `/payment_intents/${encodeURIComponent(paymentId)}`, { expand: ["payment_method"] })).payment_method : await stripeCall(env, "GET", `/payment_methods/${encodeURIComponent(paymentId)}`);
    const card = (paymentMethod as { card?: { fingerprint?: unknown } } | null)?.card;
    fingerprint = typeof card?.fingerprint === "string" ? card.fingerprint : null;
  } catch (error) {
    console.error(`Reading the card of ${paymentId} failed:`, error);
    return;
  }
  if (!fingerprint) return;
  await env.DB.prepare("INSERT INTO owner_cards (owner_id, card_fingerprint_sha256, first_paid_at_ms) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").bind(ownerId, await markSha256("card", fingerprint), nowMs).run();
  const bannedAccountId = await bannedAccountOfMark(env.DB, "card", fingerprint);
  const payer = await env.DB.prepare("SELECT accounts.id, accounts.username FROM owners JOIN accounts ON accounts.id = owners.account_id WHERE owners.id = ?").bind(ownerId).first<{ id: string; username: string }>();
  if (!bannedAccountId || !payer || payer.id === bannedAccountId) return;
  if (!(await recordBanMatch(env.DB, payer.id, "card", bannedAccountId, nowMs))) return;
  const banned = await env.DB.prepare("SELECT username FROM accounts WHERE id = ?").bind(bannedAccountId).first<{ username: string }>();
  await sendAlert(env, `A card banned with @${banned?.username ?? "a deleted account"} paid on @${payer.username}`, "A person decides whether it's the same person: list_ban_matches on the admin MCP. A family can share a card.");
}

/** Where a banned account appeals, until the appeals queue: a person at Zaisma reads each one. */
export const APPEAL_EMAIL = "safety@zaisma.com";

/** A content rule in a sentence's words: "the content rules on illegal content". */
export const CONTENT_RULE_WORDS: Record<ContentRule, string> = {
  child_safety: "child safety",
  sexual: "sexual content",
  malware: "malware",
  illegal: "illegal content",
  real_people: "real people",
  copyright: "copyright",
  defamation: "defamation",
  personal_details: "personal details",
  chat: "chat",
  crypto: "cryptocurrency",
  purchases: "paid random rewards",
  faked_plays: "faked plays",
};

/** The email_banned refusal, for a page or the API. */
export const emailBanned = () => new ApiError("email_banned", { message: "This email was banned from Zaisma with the account it was on.", field: "email", fix: "Use another email. Tell the person this email can't be used on Zaisma." });
