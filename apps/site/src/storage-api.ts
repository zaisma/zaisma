import {
  ApiError,
  MAXIMUM_MONTHLY_STORAGE_BUDGET_CENTS,
  REVIEW_CODES,
  STORAGE_ALLOWANCES,
  STORAGE_PRICE_PER_GIGABYTE_MONTH_CENTS,
  audit,
  iso,
  isKeptForChildSafety,
  manifestKey,
  monthStartDateOf,
  ownerStorageMonth,
  cancelGameDeletionWait,
  gameDeletionOf,
  isPlayedByOthers,
  readReviewReason,
  startGameDeletionWait,
  recountStoredSizeStatement,
  reserveNewData,
  reviewReason,
  storageOf,
  storageSizeText,
  versionKeptSql,
  type Game,
  type Manifest,
  type Storage,
  type Version,
} from "@zaisma/core";
import { checkSpendingConfirmed } from "./credit-api.ts";
import { askForGameDeletion } from "./game-deletion-requests.ts";
import { recordRestoreEvent } from "./restore-events.ts";
import { deleteVersion } from "./scan.ts";
import { logCallerEvent } from "./security-log.ts";
import { tellWebhooks } from "./webhooks.ts";
import type { Caller, NextStep } from "./developer.ts";
import type { Env } from "./env.ts";

/**
 * What an account stores, through the developer API (docs/DECISIONS.md, "Storage is limited per account, not per
 * game"), and the deletes that free it: what fills the account, the budget that buys more from credit, and the
 * refusals that say what to delete.
 *
 *   GET    /api/dev/storage                        what's stored, what can be, and the biggest versions that can go
 *   PATCH  /api/dev/storage                        { "monthly_storage_budget_cents" }; a first or higher one needs the passkey
 *   DELETE /api/dev/games/:slug/versions/:id       one version that isn't in use
 *   DELETE /api/dev/games/:slug                    { "confirm_slug" }; the game, for good
 */

const DELETABLE_VERSION_COUNT = 20;
const MINIMUM_MONTHLY_STORAGE_BUDGET_CENTS = 100;
const DAY_MS = 86_400_000;

interface DeletableVersion {
  game_slug: string;
  version_id: string;
  size_bytes: number;
  created_at_ms: number;
}

/** A version of the owner's games that can be deleted: not in use, and not kept for a person at Zaisma. */
export const DELETABLE_VERSION_SQL = `(games.live_version_id IS NULL OR games.live_version_id != versions.id) AND versions.scan_status != 'scanning' AND versions.scheduled_publish_at_ms IS NULL
       AND NOT EXISTS (SELECT 1 FROM tester_links WHERE tester_links.game_id = games.id AND tester_links.revoked_at_ms IS NULL AND tester_links.version_choice = 'picked' AND tester_links.picked_version_id = versions.id)
       AND NOT ${versionKeptSql("versions")}`;

/** The owner's biggest versions that can be deleted. */
async function deletableVersions(env: Env, ownerId: string, gameSlugs: string[] | null): Promise<DeletableVersion[]> {
  const inKeysGames = gameSlugs ? `AND games.slug IN (${gameSlugs.map(() => "?").join(",")})` : "";
  const { results } = await env.DB.prepare(
    `SELECT games.slug AS game_slug, versions.id AS version_id, versions.size_bytes, versions.created_at_ms
     FROM versions JOIN games ON games.id = versions.game_id
     WHERE games.owner_id = ? ${inKeysGames} AND ${DELETABLE_VERSION_SQL}
     ORDER BY versions.size_bytes DESC LIMIT ?`,
  )
    .bind(ownerId, ...(gameSlugs ?? []), DELETABLE_VERSION_COUNT)
    .all<DeletableVersion>();
  return results;
}

/** The storage answer: what the account stores, what it can, and what can go. */
export async function storageAnswer(env: Env, ownerId: string, gameSlugs: string[] | null, nowMs = Date.now()) {
  const [storage, month, versions] = await Promise.all([storageOf(env.DB, ownerId, nowMs), ownerStorageMonth(env.DB, ownerId, monthStartDateOf(nowMs)), deletableVersions(env, ownerId, gameSlugs)]);
  return {
    stored_size_bytes: storage.storedSizeBytes,
    included_size_bytes: storage.includedSizeBytes,
    maximum_stored_size_bytes: storage.maximumStoredSizeBytes,
    allowance_kind: storage.allowanceKind,
    new_data_today_size_bytes: storage.newDataTodaySizeBytes,
    maximum_new_data_size_bytes: storage.maximumNewDataSizeBytes,
    monthly_storage_budget_cents: storage.monthlyStorageBudgetCents,
    unpaid_files_delete_at: iso(storage.unpaidFilesDeleteAtMs),
    spent_this_month_cents: month.charged_cents,
    price_per_gigabyte_month_cents: STORAGE_PRICE_PER_GIGABYTE_MONTH_CENTS,
    deletable_versions: versions.map((version) => ({ game_slug: version.game_slug, version_id: version.version_id, size_bytes: version.size_bytes, created_at: iso(version.created_at_ms) })),
  };
}

/** GET and PATCH /storage, once the router (developer.ts, checkCall) has checked the key. */
export async function storageRoute(env: Env, method: string, body: Record<string, unknown>, caller: Caller): Promise<[unknown, number?]> {
  const gameSlugs = caller.access.gameSlugs ?? null;
  if (method === "GET") return [{ storage: await storageAnswer(env, caller.ownerId, gameSlugs) }];
  const given = body.monthly_storage_budget_cents;
  if (given !== null && (!Number.isInteger(given) || (given as number) < MINIMUM_MONTHLY_STORAGE_BUDGET_CENTS || (given as number) > MAXIMUM_MONTHLY_STORAGE_BUDGET_CENTS)) {
    throw new ApiError("bad_monthly_storage_budget_cents", {
      message: `monthly_storage_budget_cents ${JSON.stringify(given)} isn't a budget: whole cents from ${MINIMUM_MONTHLY_STORAGE_BUDGET_CENTS} to ${MAXIMUM_MONTHLY_STORAGE_BUDGET_CENTS}, or null.`,
      field: "monthly_storage_budget_cents",
      fix: `Give cents, not dollars: 1000 is $10, which buys about ${Math.floor(1000 / STORAGE_PRICE_PER_GIGABYTE_MONTH_CENTS)} GB. null turns it off.`,
    });
  }
  const budgetCents = given as number | null;
  const { monthlyStorageBudgetCents: currentCents } = await storageOf(env.DB, caller.ownerId);
  if (budgetCents !== null && (currentCents === null || budgetCents > currentCents)) {
    await checkSpendingConfirmed(env, caller, currentCents === null ? "Giving the account a storage budget" : "Raising the account's storage budget", { requestKind: "storage_budget", monthlyBudgetCents: budgetCents });
  }
  await env.DB.prepare("UPDATE owners SET monthly_storage_budget_cents = ? WHERE id = ?").bind(budgetCents, caller.ownerId).run();
  await logCallerEvent(env, caller, "storage_budget_changed");
  const answer = await storageAnswer(env, caller.ownerId, gameSlugs);
  const nextSteps: NextStep[] = budgetCents !== null && answer.maximum_stored_size_bytes === answer.included_size_bytes ? [{ tool: "top_up_credit", arguments: {}, after_sec: null, reason: "The budget buys storage from credit, and there's none yet. Ask the developer first, and add the amount." }] : [];
  return [{ storage: answer, next_steps: nextSteps }];
}

/** Refuses an upload that adds more than the account can hold, naming what it can delete. Adding nothing always fits. */
export async function checkStoredSizeFits(env: Env, caller: Caller, addedSizeBytes: number, storage: Storage, field: string | null = null): Promise<void> {
  if (addedSizeBytes <= 0 || storage.storedSizeBytes + addedSizeBytes <= storage.maximumStoredSizeBytes) return;
  const versions = await deletableVersions(env, caller.ownerId, caller.access.gameSlugs ?? null);
  const named = versions.slice(0, 3).map((version) => `${version.game_slug}'s ${version.version_id} (up to ${storageSizeText(version.size_bytes)})`);
  const canGrow = storage.allowanceKind === "pro" ? "" : ` start_pro includes ${storageSizeText(STORAGE_ALLOWANCES.pro.includedSizeBytes)}.`;
  const canPayByCard = storage.allowanceKind === "new" ? ` A top-up by card (top_up_credit) raises what's included to ${storageSizeText(STORAGE_ALLOWANCES.paid_by_card.includedSizeBytes)}.` : "";
  throw new ApiError("storage_full", {
    message: `The account stores ${storageSizeText(storage.storedSizeBytes)} of the ${storageSizeText(storage.maximumStoredSizeBytes)} it can, and this adds ${storageSizeText(addedSizeBytes)}.`,
    field,
    fix: `${named.length ? `Delete versions nobody needs with delete_version, biggest first: ${named.join(", ")}; get_storage lists more. ` : ""}delete_game deletes a whole game. Files no other version has stop counting at once. To keep everything, set_storage_budget buys room from credit at ${STORAGE_PRICE_PER_GIGABYTE_MONTH_CENTS}¢ per GB a month.${canPayByCard}${canGrow}`,
  });
}

/** Takes one file or part from today's new data, or refuses until midnight UTC. Files already sent stay, so the upload carries on tomorrow. */
export async function reserveOrRefuse(env: Env, ownerId: string, sizeBytes: number, storage: Storage, nowMs = Date.now()): Promise<void> {
  if (await reserveNewData(env.DB, ownerId, sizeBytes, storage.maximumNewDataSizeBytes, nowMs)) return;
  throw new ApiError("new_data_limit", {
    message: `The account has sent ${storageSizeText(storage.newDataTodaySizeBytes)} of the ${storageSizeText(storage.maximumNewDataSizeBytes)} of new data it can today, and this is ${storageSizeText(sizeBytes)} more.`,
    fix: "Send the upload again after midnight UTC: what's sent stays, and only the rest goes up. Files already stored don't count.",
    retryAfterSec: Math.ceil((DAY_MS - (nowMs % DAY_MS)) / 1000),
  });
}

export interface OwnerFiles {
  shared: Set<string>;
  owned: Set<string>;
}

/** The files these versions' lists use, or null when one of the lists can't be read. */
export async function filesOfVersions(env: Env, versionIds: string[]): Promise<OwnerFiles | null> {
  const files: OwnerFiles = { shared: new Set(), owned: new Set() };
  for (const versionId of versionIds) {
    const stored = await env.GAMES.get(manifestKey(versionId));
    if (!stored) return null;
    for (const file of Object.values(((await stored.json()) as Manifest).files)) (file.owner_id ? files.owned : files.shared).add(file.sha256);
  }
  return files;
}

export const filesVersionIdsWhere = async (env: Env, where: string, id: string) =>
  (await env.DB.prepare(`SELECT versions.id FROM versions JOIN games ON games.id = versions.game_id WHERE versions.kind = 'files' AND ${where}`).bind(id).all<{ id: string }>()).results.map((row) => row.id);

/** Stops counting the given files once no version of the owner's uses them, then sets what the owner stores from its rows. */
export async function releaseFiles(env: Env, ownerId: string, dropped: OwnerFiles, nowMs = Date.now()): Promise<void> {
  const used = await filesOfVersions(env, await filesVersionIdsWhere(env, "games.owner_id = ?", ownerId));
  if (!used) return; // The daily cleanup sets it right once every list can be read.
  const statements: D1PreparedStatement[] = [];
  for (const sha256 of dropped.shared) if (!used.shared.has(sha256)) statements.push(env.DB.prepare("UPDATE blob_owners SET released_at_ms = ? WHERE owner_id = ? AND sha256 = ? AND released_at_ms IS NULL").bind(nowMs, ownerId, sha256));
  for (const sha256 of dropped.owned) if (!used.owned.has(sha256)) statements.push(env.DB.prepare("UPDATE owned_blobs SET released_at_ms = ? WHERE owner_id = ? AND sha256 = ? AND released_at_ms IS NULL").bind(nowMs, ownerId, sha256));
  statements.push(recountStoredSizeStatement(env.DB, ownerId));
  for (let i = 0; i < statements.length; i += 100) await env.DB.batch(statements.slice(i, i + 100));
}

/** DELETE /games/:slug/versions/:version_id: one version, and the files only it had. */
export async function deleteOwnVersion(env: Env, game: Game, version: Version, caller: Caller): Promise<[unknown, number?]> {
  const fix = "get_storage lists the versions that can be deleted now.";
  if (version.scan_status === "scanning") throw new ApiError("still_scanning", { message: "This version is still being scanned.", field: "version_id", fix: "Wait for its scan to end (get_version), then delete it.", retryAfterSec: 30 });
  if (game.live_version_id === version.id) throw new ApiError("version_in_use", { message: "This version is live.", field: "version_id", fix: `Publish another version first, or delete the whole game with delete_game. ${fix}` });
  if (version.scheduled_publish_at_ms !== null) throw new ApiError("version_in_use", { message: "This version is set to publish.", field: "version_id", fix: `cancel_scheduled_publish takes that back, then delete it. ${fix}` });
  const isPicked = await env.DB.prepare("SELECT 1 AS is_picked FROM tester_links WHERE game_id = ? AND revoked_at_ms IS NULL AND version_choice = 'picked' AND picked_version_id = ? LIMIT 1").bind(game.id, version.id).first();
  if (isPicked) throw new ApiError("version_in_use", { message: "A tester link opens this version.", field: "version_id", fix: `update_tester_link or remove_tester_link moves the link off it, then delete it. ${fix}` });
  const kept = await env.DB.prepare(`SELECT ${versionKeptSql("versions")} AS is_kept FROM versions WHERE id = ?`).bind(version.id).first<{ is_kept: number }>();
  if (kept?.is_kept) throw new ApiError("kept_for_review", { message: "This version is kept for a person at Zaisma, so it can't be deleted.", field: "version_id", fix: `message_zaisma with the game_slug to ask about it. ${fix}` });

  const dropped = version.kind === "files" ? await filesOfVersions(env, [version.id]) : null;
  await deleteVersion(env, version);
  if (dropped) await releaseFiles(env, caller.ownerId, dropped);
  await audit(env.DB, game.id, "version-deleted", version.id, caller.actor);
  await logCallerEvent(env, caller, "version_deleted", { gameId: game.id, versionId: version.id });
  return [{ is_deleted: true, storage: await storageAnswer(env, caller.ownerId, caller.access.gameSlugs ?? null), next_steps: [] satisfies NextStep[] }];
}

/**
 * DELETE /games/:slug: a game other people played takes the developer's passkey tap, so anyone else only asks and it keeps
 * running (game-deletion-requests.ts). Then it's off for players at once and waits a week, still theirs, for a bring-back;
 * after that it goes a step at a time (game-deletion.ts). A game kept for a child-safety hold can't be deleted.
 */
export async function deleteOwnGame(env: Env, game: Game, body: Record<string, unknown>, caller: Caller, nowMs = Date.now()): Promise<[unknown, number?]> {
  if (body.confirm_slug !== game.slug) {
    throw new ApiError("bad_confirm_slug", { message: `confirm_slug ${JSON.stringify(body.confirm_slug)} isn't this game's link name, ${game.slug}.`, field: "confirm_slug", fix: `Ask the developer first: the game goes off for every player, and a week later its saves, purchases and link go for good. Then send { "confirm_slug": "${game.slug}" }.` });
  }
  if (await isKeptForChildSafety(env.DB, game.id)) {
    throw new ApiError("kept_for_review", { message: "This game is kept for a person at Zaisma, so it can't be deleted.", field: "slug", fix: "message_zaisma with the game_slug to ask about it." });
  }
  const isScanning = await env.DB.prepare("SELECT 1 AS is_scanning FROM versions WHERE game_id = ? AND scan_status = 'scanning' LIMIT 1").bind(game.id).first();
  if (isScanning) throw new ApiError("still_scanning", { message: "A version of this game is still being scanned.", field: "slug", fix: "Wait for its scan to end (get_game lists its versions), then delete the game.", retryAfterSec: 30 });

  const waiting = await gameDeletionOf(env.DB, game.id);
  const deletedAnswer = async (erasesAtMs: number): Promise<[unknown, number?]> => {
    const nextSteps: NextStep[] = [{ tool: "bring_back_game", arguments: { slug: game.slug }, after_sec: null, reason: "Brings the game back until erases_at, as it was before." }];
    return [{ is_deleted: true, erases_at: iso(erasesAtMs), storage: await storageAnswer(env, caller.ownerId, caller.access.gameSlugs ?? null, nowMs), next_steps: nextSteps }];
  };
  if (waiting?.erases_at_ms != null) return deletedAnswer(waiting.erases_at_ms);
  if (!caller.isPasskeyConfirmed && (await isPlayedByOthers(env.DB, game.id))) throw await askForGameDeletion(env, caller, game, "delete_game", nowMs);

  const erasesAtMs = await startGameDeletionWait(env.DB, game.id, nowMs);
  await recordRestoreEvent(env, { event_kind: "game_deletion_queued", at_ms: nowMs, game_id: game.id, requested_by_kind: "developer", erases_at_ms: erasesAtMs });
  await audit(env.DB, game.id, "deleted", REVIEW_CODES.developer_deleted_game.meaning, caller.actor);
  await logCallerEvent(env, caller, "game_deleted", { gameId: game.id });
  await tellWebhooks(env, "review_status_changed", game.id, {});
  return deletedAnswer(erasesAtMs);
}

/** A waiting game's deletion, or a refusal when it isn't waiting or its week is over. */
async function waitingDeletionOf(env: Env, game: Game, nowMs: number) {
  const deletion = await gameDeletionOf(env.DB, game.id);
  if (deletion?.erases_at_ms == null) throw new ApiError("not_waiting_to_erase", { message: `${game.slug} isn't deleted and waiting to be erased.`, field: "slug", fix: "get_game says erases_at for a game that is." });
  if (deletion.erases_at_ms <= nowMs) throw new ApiError("already_erasing", { message: `${game.slug}'s week is over and its erasing has started.`, field: "slug", fix: "Nothing brings it back now." });
  return deletion;
}

/** POST /games/:slug/bring-back: the game is what it was before its developer deleted it. A takedown since then stays. */
export async function bringBackGame(env: Env, game: Game, caller: Caller, nowMs = Date.now()): Promise<[unknown, number?]> {
  await waitingDeletionOf(env, game, nowMs);
  if (readReviewReason(game.review_reason)?.code !== "developer_deleted_game") {
    throw new ApiError("game_removed", { message: "Zaisma took this game down since it was deleted, so it can't be brought back.", field: "slug", fix: "message_zaisma with the game_slug to ask about it." });
  }
  await cancelGameDeletionWait(env.DB, game.id, nowMs);
  await recordRestoreEvent(env, { event_kind: "game_deletion_cancelled", at_ms: nowMs, game_id: game.id });
  await audit(env.DB, game.id, "brought-back", "The game's developer brought it back.", caller.actor);
  await logCallerEvent(env, caller, "game_brought_back", { gameId: game.id });
  await tellWebhooks(env, "review_status_changed", game.id, {});
  return [{ is_brought_back: true, next_steps: [{ tool: "get_game", arguments: { slug: game.slug }, after_sec: null, reason: "Shows the game as it is again." }] satisfies NextStep[] }];
}

/** POST /games/:slug/erase-now: a waiting game nobody but its developer played, erased at once, with their passkey tap. */
export async function eraseGameNow(env: Env, game: Game, body: Record<string, unknown>, caller: Caller, nowMs = Date.now()): Promise<[unknown, number?]> {
  if (body.confirm_slug !== game.slug) {
    throw new ApiError("bad_confirm_slug", { message: `confirm_slug ${JSON.stringify(body.confirm_slug)} isn't this game's link name, ${game.slug}.`, field: "confirm_slug", fix: `Ask the developer first: nothing brings it back after this. Then send { "confirm_slug": "${game.slug}" }.` });
  }
  const deletion = await waitingDeletionOf(env, game, nowMs);
  if (await isPlayedByOthers(env.DB, game.id)) {
    throw new ApiError("played_by_others", { message: `Other people played ${game.slug}, so it waits until ${iso(deletion.erases_at_ms!)}.`, field: "slug", fix: "Nothing to do: it's erased then, or bring_back_game brings it back." });
  }
  if (!caller.isPasskeyConfirmed) throw await askForGameDeletion(env, caller, game, "erase_game_now", nowMs);
  await startGameDeletionWait(env.DB, game.id, nowMs, nowMs);
  await recordRestoreEvent(env, { event_kind: "game_deletion_queued", at_ms: nowMs, game_id: game.id, requested_by_kind: "developer", erases_at_ms: nowMs });
  await audit(env.DB, game.id, "erased-now", "The game's developer erased it at once.", caller.actor);
  await logCallerEvent(env, caller, "game_erased_now", { gameId: game.id });
  return [{ erases_at: iso(nowMs), next_steps: [] satisfies NextStep[] }];
}

