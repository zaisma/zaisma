import { creditOf } from "./credit.ts";
import { planFor } from "./plans.ts";
import { standingOf } from "./standing.ts";

/**
 * What an account stores and sends (docs/DECISIONS.md, "Storage is limited per account, not per game"): a game can be
 * any size, and cost sits in what an account keeps and how fast it adds to it. Each account has an allowance by its
 * standing and plan. Past it, an account with a monthly storage budget buys room from credit; without one, uploads
 * stop at the allowance. An account over its limit keeps everything it has: only new uploads must fit.
 */

const GIGABYTE_SIZE_BYTES = 1024 ** 3;

export const STORAGE_ALLOWANCE_KINDS = ["new", "established", "paid_by_card", "pro"] as const;
export type StorageAllowanceKind = (typeof STORAGE_ALLOWANCE_KINDS)[number];

export interface StorageAllowance {
  /** What the account stores with no budget. */
  includedSizeBytes: number;
  /** New data the account can send in a UTC day. */
  maximumNewDataSizeBytes: number;
}

export const STORAGE_ALLOWANCES: Record<StorageAllowanceKind, StorageAllowance> = {
  new: { includedSizeBytes: 10 * GIGABYTE_SIZE_BYTES, maximumNewDataSizeBytes: 10 * GIGABYTE_SIZE_BYTES },
  established: { includedSizeBytes: 50 * GIGABYTE_SIZE_BYTES, maximumNewDataSizeBytes: 25 * GIGABYTE_SIZE_BYTES },
  paid_by_card: { includedSizeBytes: 50 * GIGABYTE_SIZE_BYTES, maximumNewDataSizeBytes: 25 * GIGABYTE_SIZE_BYTES },
  pro: { includedSizeBytes: 500 * GIGABYTE_SIZE_BYTES, maximumNewDataSizeBytes: 100 * GIGABYTE_SIZE_BYTES },
};

/** What a GB past the allowance costs from credit each month. */
export const STORAGE_PRICE_PER_GIGABYTE_MONTH_CENTS = 12;

/** The highest monthly storage budget, in cents: $10,000, the credit plan's highest level. */
export const MAXIMUM_MONTHLY_STORAGE_BUDGET_CENTS = 1_000_000;

export const utcDateOf = (nowMs: number) => new Date(nowMs).toISOString().slice(0, 10);

/** What budget and balance buy past the allowance: a month of it is always already paid for. */
export const boughtSizeBytes = (monthlyStorageBudgetCents: number | null, balanceCents: number) =>
  monthlyStorageBudgetCents === null ? 0 : Math.floor((Math.max(0, Math.min(monthlyStorageBudgetCents, balanceCents)) / STORAGE_PRICE_PER_GIGABYTE_MONTH_CENTS) * GIGABYTE_SIZE_BYTES);

/** An account's storage now. */
export interface Storage {
  storedSizeBytes: number;
  allowanceKind: StorageAllowanceKind;
  includedSizeBytes: number;
  /** What the account can hold now: what's included, and what its budget and credit buy. */
  maximumStoredSizeBytes: number;
  newDataTodaySizeBytes: number;
  maximumNewDataSizeBytes: number;
  monthlyStorageBudgetCents: number | null;
}

export async function storageAllowanceKindOf(database: D1Database, ownerId: string, nowMs: number): Promise<StorageAllowanceKind> {
  if ((await planFor(database, ownerId, nowMs)) === "pro") return "pro";
  const standing = await standingOf(database, ownerId, nowMs);
  return standing.isEstablishedDeveloper ? "established" : standing.hasPaidByCard ? "paid_by_card" : "new";
}

export async function storageOf(database: D1Database, ownerId: string, nowMs = Date.now()): Promise<Storage> {
  const [allowanceKind, credit, row, today] = await Promise.all([
    storageAllowanceKindOf(database, ownerId, nowMs),
    creditOf(database, ownerId),
    database.prepare("SELECT stored_size_bytes, monthly_storage_budget_cents FROM owners WHERE id = ?").bind(ownerId).first<{ stored_size_bytes: number; monthly_storage_budget_cents: number | null }>(),
    database.prepare("SELECT new_data_size_bytes FROM owner_new_data_days WHERE owner_id = ? AND date = ?").bind(ownerId, utcDateOf(nowMs)).first<{ new_data_size_bytes: number }>(),
  ]);
  const allowance = STORAGE_ALLOWANCES[allowanceKind];
  const monthlyStorageBudgetCents = row?.monthly_storage_budget_cents ?? null;
  return {
    storedSizeBytes: row?.stored_size_bytes ?? 0,
    allowanceKind,
    includedSizeBytes: allowance.includedSizeBytes,
    maximumStoredSizeBytes: allowance.includedSizeBytes + boughtSizeBytes(monthlyStorageBudgetCents, credit.balanceCents),
    newDataTodaySizeBytes: today?.new_data_size_bytes ?? 0,
    maximumNewDataSizeBytes: allowance.maximumNewDataSizeBytes,
    monthlyStorageBudgetCents,
  };
}

/** A size in words for messages: "9.8 GB", "640 MB", "12 KB". */
export function storageSizeText(sizeBytes: number): string {
  if (sizeBytes >= GIGABYTE_SIZE_BYTES) return `${Number((sizeBytes / GIGABYTE_SIZE_BYTES).toFixed(1))} GB`;
  return sizeBytes >= 1024 ** 2 ? `${Math.ceil(sizeBytes / 1024 ** 2)} MB` : `${Math.ceil(sizeBytes / 1024)} KB`;
}

/** Takes sizeBytes from today's new data, all or nothing, so parallel uploads can't pass the limit. Answers whether it fit. */
export async function reserveNewData(database: D1Database, ownerId: string, sizeBytes: number, maximumNewDataSizeBytes: number, nowMs = Date.now()): Promise<boolean> {
  const reserved = await database
    .prepare(
      `INSERT INTO owner_new_data_days (owner_id, date, new_data_size_bytes) SELECT ?1, ?2, ?3 WHERE ?3 <= ?4
       ON CONFLICT (owner_id, date) DO UPDATE SET new_data_size_bytes = new_data_size_bytes + excluded.new_data_size_bytes WHERE new_data_size_bytes + excluded.new_data_size_bytes <= ?4`,
    )
    .bind(ownerId, utcDateOf(nowMs), sizeBytes, maximumNewDataSizeBytes)
    .run();
  return reserved.meta.changes > 0;
}

/** Gives back what a store that failed had reserved. */
export async function releaseNewData(database: D1Database, ownerId: string, sizeBytes: number, nowMs = Date.now()): Promise<void> {
  await database.prepare("UPDATE owner_new_data_days SET new_data_size_bytes = MAX(0, new_data_size_bytes - ?) WHERE owner_id = ? AND date = ?").bind(sizeBytes, ownerId, utcDateOf(nowMs)).run();
}

/** Sets an owner's stored size again from its rows, or every owner's: what the counter should say. */
export function recountStoredSizeStatement(database: D1Database, ownerId?: string): D1PreparedStatement {
  const sql = `UPDATE owners SET stored_size_bytes =
    COALESCE((SELECT SUM(blobs.size_bytes) FROM blob_owners JOIN blobs ON blobs.sha256 = blob_owners.sha256 WHERE blob_owners.owner_id = owners.id AND blob_owners.released_at_ms IS NULL), 0)
    + COALESCE((SELECT SUM(owned_blobs.size_bytes) FROM owned_blobs WHERE owned_blobs.owner_id = owners.id AND owned_blobs.released_at_ms IS NULL), 0)`;
  return ownerId ? database.prepare(`${sql} WHERE id = ?`).bind(ownerId) : database.prepare(sql);
}

export interface OwnerStorageMonth {
  used_cents: number;
  charged_cents: number;
  written_off_cents: number;
  last_counted_date: string;
}

export async function ownerStorageMonth(database: D1Database, ownerId: string, monthStartDate: string): Promise<OwnerStorageMonth> {
  const row = await database.prepare("SELECT used_cents, charged_cents, written_off_cents, last_counted_date FROM owner_storage_months WHERE owner_id = ? AND month_start_date = ?").bind(ownerId, monthStartDate).first<OwnerStorageMonth>();
  return row ?? { used_cents: 0, charged_cents: 0, written_off_cents: 0, last_counted_date: "" };
}

/** A day's storage past the allowance, in cents with fractions: a month's price shared over the month's days. */
export function storageDayCents(pastAllowanceSizeBytes: number, nowMs: number): number {
  const now = new Date(nowMs);
  const dayCount = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  return ((pastAllowanceSizeBytes / GIGABYTE_SIZE_BYTES) * STORAGE_PRICE_PER_GIGABYTE_MONTH_CENTS) / dayCount;
}
