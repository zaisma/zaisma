import { newId } from "./ids.ts";

/**
 * A developer's prepaid hosting credit (docs/DECISIONS.md, "Hosting is priced with a margin, with a free tier, and
 * prepaid above it"): one balance per owner, bought on Stripe's page or topped up by itself, spent only by games
 * with a monthly budget. It never expires, never goes below zero, refunds unused for 30 days and is never paid out
 * ("Credit is ours once spent, or once its 30 days pass").
 * Every change is a row in credit_entries; owners.credit_balance_cents is their sum, kept in the same batch.
 */
export const CREDIT_LIMITS = {
  minimumTopUpCents: 1000,
  /** Caps what one stolen card can charge in one go. */
  maximumTopUpCents: 100_000,
  refundableDurationDays: 30,
  /** The owner hears their credit is low once it's under this share of the balance right after their last top-up. */
  creditLowPct: 20,
  minimumAutomaticTopUpCents: 1000,
} as const;

export const CREDIT_ENTRY_KINDS = ["top_up", "hosting_charge", "refund", "written_off"] as const;
export type CreditEntryKind = (typeof CREDIT_ENTRY_KINDS)[number];

export interface CreditEntry {
  id: string;
  owner_id: string;
  entry_kind: CreditEntryKind;
  /** Positive adds, negative spends; a written-off entry's is what Zaisma took on, and never touches the balance. */
  amount_cents: number;
  game_id: string | null;
  stripe_object_id: string | null;
  refundable_until_ms: number | null;
  refunded_cents: number;
  is_automatic: number;
  created_at_ms: number;
}

/** An owner's balance, Stripe customer and automatic top-up. */
export interface Credit {
  balanceCents: number;
  stripeCustomerId: string | null;
  stripePaymentMethodId: string | null;
  automaticTopUp: { isEnabled: boolean; topUpBelowCents: number | null; topUpAmountCents: number | null; monthlyTopUpLimitCents: number | null; attemptCount: number; enabledAtMs: number | null };
  creditLowToldAtMs: number | null;
  /** Under this the credit is low: creditLowPct of the balance right after the last top-up; null before the first one. */
  creditLowLineCents: number | null;
}

export async function creditOf(database: D1Database, ownerId: string): Promise<Credit> {
  const row = await database
    .prepare(
      "SELECT credit_balance_cents, stripe_customer_id, stripe_payment_method_id, automatic_top_up_enabled, top_up_below_cents, top_up_amount_cents, monthly_top_up_limit_cents, automatic_top_up_attempt_count, automatic_top_up_enabled_at_ms, credit_low_told_at_ms, credit_low_line_cents FROM owners WHERE id = ?",
    )
    .bind(ownerId)
    .first<{
      credit_balance_cents: number;
      stripe_customer_id: string | null;
      stripe_payment_method_id: string | null;
      automatic_top_up_enabled: number;
      top_up_below_cents: number | null;
      top_up_amount_cents: number | null;
      monthly_top_up_limit_cents: number | null;
      automatic_top_up_attempt_count: number;
      automatic_top_up_enabled_at_ms: number | null;
      credit_low_told_at_ms: number | null;
      credit_low_line_cents: number | null;
    }>();
  return {
    balanceCents: row?.credit_balance_cents ?? 0,
    stripeCustomerId: row?.stripe_customer_id ?? null,
    stripePaymentMethodId: row?.stripe_payment_method_id ?? null,
    automaticTopUp: {
      isEnabled: row?.automatic_top_up_enabled === 1,
      topUpBelowCents: row?.top_up_below_cents ?? null,
      topUpAmountCents: row?.top_up_amount_cents ?? null,
      monthlyTopUpLimitCents: row?.monthly_top_up_limit_cents ?? null,
      attemptCount: row?.automatic_top_up_attempt_count ?? 0,
      enabledAtMs: row?.automatic_top_up_enabled_at_ms ?? null,
    },
    creditLowToldAtMs: row?.credit_low_told_at_ms ?? null,
    creditLowLineCents: row?.credit_low_line_cents ?? null,
  };
}

/** Whether the owner's credit is under the line their last top-up set (never before the first top-up that set one). */
export function isCreditLow(credit: Pick<Credit, "balanceCents" | "creditLowLineCents">): boolean {
  return credit.creditLowLineCents !== null && credit.balanceCents < credit.creditLowLineCents;
}

/** One change to an owner's credit. */
export interface NewCreditEntry {
  ownerId: string;
  entryKind: CreditEntryKind;
  amountCents: number;
  gameId?: string | null;
  /** The Stripe object it came from: an entry with one already counted is ignored. */
  stripeObjectId?: string | null;
  refundableUntilMs?: number | null;
  isAutomatic?: boolean;
  createdAtMs?: number;
}

/**
 * Adds an entry and changes the balance by it, in one batch. A spend that would take the balance below zero, or a
 * Stripe object already counted, changes nothing. Answers the entry's ID, or null when nothing changed.
 */
export async function addCreditEntry(database: D1Database, entry: NewCreditEntry): Promise<string | null> {
  const id = newId(entry.entryKind === "top_up" ? "top_up" : "credit_entry");
  const balanceChangeCents = entry.entryKind === "written_off" ? 0 : entry.amountCents;
  // The same check on the balance before either statement, so both happen or neither.
  const isAffordable = "(SELECT credit_balance_cents FROM owners WHERE id = ?) + ? >= 0";
  await database.batch([
    database
      .prepare(
        `INSERT INTO credit_entries (id, owner_id, entry_kind, amount_cents, game_id, stripe_object_id, refundable_until_ms, is_automatic, created_at_ms) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${isAffordable} ON CONFLICT DO NOTHING`,
      )
      .bind(id, entry.ownerId, entry.entryKind, entry.amountCents, entry.gameId ?? null, entry.stripeObjectId ?? null, entry.refundableUntilMs ?? null, entry.isAutomatic ? 1 : 0, entry.createdAtMs ?? Date.now(), entry.ownerId, balanceChangeCents),
    database.prepare("UPDATE owners SET credit_balance_cents = credit_balance_cents + ? WHERE id = ? AND EXISTS (SELECT 1 FROM credit_entries WHERE id = ?)").bind(balanceChangeCents, entry.ownerId, id),
  ]);
  const added = await database.prepare("SELECT id FROM credit_entries WHERE id = ?").bind(id).first<{ id: string }>();
  return added ? id : null;
}

/**
 * Charges a game's hosting to its owner's credit: one hosting_charge entry per game per UTC day, grown in place, so
 * the list stays readable. Never takes the balance below zero; answers whether it charged.
 *
 * The month's row is the claim: the charge moves its charged_cents on from monthChargedCents, what the caller read,
 * so two runs of the hosting job that read the same month charge it once. In one transaction, the entry and the
 * balance change only when the statement before them changed a row (changes()).
 */
export async function addHostingCharge(
  database: D1Database,
  charge: { ownerId: string; gameId: string; amountCents: number; monthStartDate: string; monthChargedCents: number; nowMs?: number },
): Promise<boolean> {
  const nowMs = charge.nowMs ?? Date.now();
  if (charge.amountCents <= 0) return false;
  await database.prepare("INSERT OR IGNORE INTO game_hosting_months (game_id, month_start_date) VALUES (?, ?)").bind(charge.gameId, charge.monthStartDate).run();
  const dayStartMs = Math.floor(nowMs / 86_400_000) * 86_400_000;
  const today = await database
    .prepare("SELECT id FROM credit_entries WHERE owner_id = ? AND game_id = ? AND entry_kind = 'hosting_charge' AND created_at_ms >= ? ORDER BY created_at_ms DESC LIMIT 1")
    .bind(charge.ownerId, charge.gameId, dayStartMs)
    .first<{ id: string }>();
  const [claimed] = await database.batch([
    database
      .prepare("UPDATE game_hosting_months SET charged_cents = charged_cents + ? WHERE game_id = ? AND month_start_date = ? AND charged_cents = ? AND (SELECT credit_balance_cents FROM owners WHERE id = ?) >= ?")
      .bind(charge.amountCents, charge.gameId, charge.monthStartDate, charge.monthChargedCents, charge.ownerId, charge.amountCents),
    today
      ? database.prepare("UPDATE credit_entries SET amount_cents = amount_cents - ? WHERE id = ? AND changes() > 0").bind(charge.amountCents, today.id)
      : database
          .prepare("INSERT INTO credit_entries (id, owner_id, entry_kind, amount_cents, game_id, created_at_ms) SELECT ?, ?, 'hosting_charge', ?, ?, ? WHERE changes() > 0")
          .bind(newId("credit_entry"), charge.ownerId, -charge.amountCents, charge.gameId, nowMs),
    database.prepare("UPDATE owners SET credit_balance_cents = credit_balance_cents - ? WHERE id = ? AND changes() > 0").bind(charge.amountCents, charge.ownerId),
  ]);
  return (claimed?.meta.changes ?? 0) > 0;
}

/** Writes off what a game used past its budget or the balance this month: one written_off entry per game per month, grown in place. */
export async function addWrittenOff(database: D1Database, writtenOff: { ownerId: string; gameId: string; amountCents: number; nowMs?: number }): Promise<void> {
  const nowMs = writtenOff.nowMs ?? Date.now();
  if (writtenOff.amountCents <= 0) return;
  const now = new Date(nowMs);
  const monthStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const grown = await database
    .prepare("UPDATE credit_entries SET amount_cents = amount_cents + ? WHERE id = (SELECT id FROM credit_entries WHERE owner_id = ? AND game_id = ? AND entry_kind = 'written_off' AND created_at_ms >= ? LIMIT 1)")
    .bind(writtenOff.amountCents, writtenOff.ownerId, writtenOff.gameId, monthStartMs)
    .run();
  if (!grown.meta.changes) await addCreditEntry(database, { ownerId: writtenOff.ownerId, entryKind: "written_off", amountCents: writtenOff.amountCents, gameId: writtenOff.gameId, createdAtMs: nowMs });
}

/** One top-up and what of it is still unspent and refundable. */
export interface RefundableTopUp {
  id: string;
  amountCents: number;
  unspentCents: number;
  /** What a refund gives back now: the unspent part, until refundable_until. */
  refundableCents: number;
  refundableUntilMs: number | null;
  stripeObjectId: string | null;
  createdAtMs: number;
}

/**
 * An owner's top-ups, newest first, with what of each is unspent: credit is spent oldest first, so the balance
 * belongs to the newest top-ups. Only the unspent part refunds, and only until refundable_until.
 */
export async function refundableTopUps(database: D1Database, ownerId: string, nowMs = Date.now()): Promise<RefundableTopUp[]> {
  const [{ results: topUps }, credit] = await Promise.all([
    database.prepare("SELECT * FROM credit_entries WHERE owner_id = ? AND entry_kind = 'top_up' ORDER BY created_at_ms DESC").bind(ownerId).all<CreditEntry>(),
    creditOf(database, ownerId),
  ]);
  let unspentPoolCents = Math.max(0, credit.balanceCents);
  return topUps.map((topUp) => {
    const unspentCents = Math.min(Math.max(0, topUp.amount_cents - topUp.refunded_cents), unspentPoolCents);
    unspentPoolCents -= unspentCents;
    const isRefundable = topUp.refundable_until_ms !== null && nowMs < topUp.refundable_until_ms;
    return { id: topUp.id, amountCents: topUp.amount_cents, unspentCents, refundableCents: isRefundable ? unspentCents : 0, refundableUntilMs: topUp.refundable_until_ms, stripeObjectId: topUp.stripe_object_id, createdAtMs: topUp.created_at_ms };
  });
}

/** What the automatic top-up added this month (UTC). */
export async function automaticTopUpsThisMonth(database: D1Database, ownerId: string, nowMs = Date.now()): Promise<{ toppedUpCents: number; topUpCount: number }> {
  const now = new Date(nowMs);
  const row = await database
    .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS topped_up_cents, COUNT(*) AS top_up_count FROM credit_entries WHERE owner_id = ? AND entry_kind = 'top_up' AND is_automatic = 1 AND created_at_ms >= ?")
    .bind(ownerId, Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .first<{ topped_up_cents: number; top_up_count: number }>();
  return { toppedUpCents: row?.topped_up_cents ?? 0, topUpCount: row?.top_up_count ?? 0 };
}
