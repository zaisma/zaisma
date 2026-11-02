import { UNPAID_STORAGE_KEPT_DURATION_DAYS, UNPAID_STORAGE_WARNING_DURATION_DAYS, audit, standingOf, storageOf, storageSizeText, type Version } from "@zaisma/core";
import { emailOwner } from "./hosting-job.ts";
import { deleteVersion } from "./scan.ts";
import { DELETABLE_VERSION_SQL, filesOfVersions, releaseFiles } from "./storage-api.ts";
import type { Env } from "./env.ts";

/**
 * Once a day, what's past an account's limit when nothing pays for it (docs/DECISIONS.md, "Storage is limited per
 * account, not per game"). The clock starts when the money has stopped: Pro has ended or credit can't cover it. A
 * renewal Stripe is still trying isn't that, nor is the wait after a ruling, whose limit comes back by itself, and a
 * banned developer keeps everything to export. The account hears when it starts and days before the end. At the end,
 * files no version uses go, then drafts, then the oldest versions, only until it fits; live versions stay, and so does
 * anything a tester link opens, set to publish or kept for a person at Zaisma. Fitting again stops the clock.
 */
const DAY_MS = 86_400_000;

interface OwnerRow {
  id: string;
  pro_until_ms: number | null;
  stripe_subscription_id: string | null;
  credit_plan_status: string | null;
  storage_unpaid_since_ms: number | null;
  storage_unpaid_warned_at_ms: number | null;
}

const shownDay = (ms: number) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export async function judgeUnpaidStorage(env: Env, nowMs: number): Promise<void> {
  const { results: owners } = await env.DB.prepare(
    `SELECT id, pro_until_ms, stripe_subscription_id, credit_plan_status, storage_unpaid_since_ms, storage_unpaid_warned_at_ms FROM owners
     WHERE is_zaisma_account = 0 AND (stored_size_bytes > 0 OR storage_unpaid_since_ms IS NOT NULL)`,
  ).all<OwnerRow>();
  for (const owner of owners) {
    try {
      await judgeOwner(env, owner, nowMs);
    } catch (error) {
      console.error("Unpaid storage: an account failed", owner.id, error);
    }
  }
}

async function judgeOwner(env: Env, owner: OwnerRow, nowMs: number): Promise<void> {
  const storage = await storageOf(env.DB, owner.id, nowMs);
  const standing = await standingOf(env.DB, owner.id, nowMs);
  const isRenewalBeingTried = owner.stripe_subscription_id !== null && (owner.pro_until_ms ?? 0) <= nowMs;
  const isUnpaid = storage.storedSizeBytes > storage.maximumStoredSizeBytes && !isRenewalBeingTried && owner.credit_plan_status !== "payment_failing" && standing.rulingWaitEndsAtMs === null && !standing.isBanned;
  if (!isUnpaid) {
    if (owner.storage_unpaid_since_ms !== null) await env.DB.prepare("UPDATE owners SET storage_unpaid_since_ms = NULL, storage_unpaid_warned_at_ms = NULL WHERE id = ?").bind(owner.id).run();
    return;
  }
  const details = { storedText: storageSizeText(storage.storedSizeBytes), maximumStoredText: storageSizeText(storage.maximumStoredSizeBytes) };
  if (owner.storage_unpaid_since_ms === null) {
    await env.DB.prepare("UPDATE owners SET storage_unpaid_since_ms = ?, storage_unpaid_warned_at_ms = NULL WHERE id = ?").bind(nowMs, owner.id).run();
    await emailOwner(env, owner.id, "storage_unpaid", { ...details, deletesOnText: shownDay(nowMs + UNPAID_STORAGE_KEPT_DURATION_DAYS * DAY_MS) });
    return;
  }
  const deleteAtMs = owner.storage_unpaid_since_ms + UNPAID_STORAGE_KEPT_DURATION_DAYS * DAY_MS;
  if (nowMs >= deleteAtMs) return deleteUntilItFits(env, owner.id, nowMs);
  if (owner.storage_unpaid_warned_at_ms === null && nowMs >= deleteAtMs - UNPAID_STORAGE_WARNING_DURATION_DAYS * DAY_MS) {
    await env.DB.prepare("UPDATE owners SET storage_unpaid_warned_at_ms = ? WHERE id = ?").bind(nowMs, owner.id).run();
    await emailOwner(env, owner.id, "storage_deleting_soon", { ...details, deletesOnText: shownDay(deleteAtMs) });
  }
}

async function deleteUntilItFits(env: Env, ownerId: string, nowMs: number): Promise<void> {
  const fits = async () => {
    const storage = await storageOf(env.DB, ownerId, nowMs);
    return storage.storedSizeBytes <= storage.maximumStoredSizeBytes;
  };
  const [{ results: shared }, { results: owned }] = await Promise.all([
    env.DB.prepare("SELECT sha256 FROM blob_owners WHERE owner_id = ? AND released_at_ms IS NULL").bind(ownerId).all<{ sha256: string }>(),
    env.DB.prepare("SELECT sha256 FROM owned_blobs WHERE owner_id = ? AND released_at_ms IS NULL").bind(ownerId).all<{ sha256: string }>(),
  ]);
  await releaseFiles(env, ownerId, { shared: new Set(shared.map((row) => row.sha256)), owned: new Set(owned.map((row) => row.sha256)) }, nowMs);
  if (await fits()) return;
  const { results: versions } = await env.DB.prepare(
    `SELECT versions.* FROM versions JOIN games ON games.id = versions.game_id WHERE games.owner_id = ? AND ${DELETABLE_VERSION_SQL}
     ORDER BY versions.published_at_ms IS NOT NULL, versions.created_at_ms`,
  )
    .bind(ownerId)
    .all<Version>();
  for (const version of versions) {
    const dropped = version.kind === "files" ? await filesOfVersions(env, [version.id]) : null;
    await deleteVersion(env, version);
    if (dropped) await releaseFiles(env, ownerId, dropped, nowMs);
    await audit(env.DB, version.game_id, "version-deleted", `${version.id}: the account's storage past its limit went unpaid for ${UNPAID_STORAGE_KEPT_DURATION_DAYS} days`);
    if (await fits()) return;
  }
}
