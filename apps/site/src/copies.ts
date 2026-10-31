import { COPY_LIMITS, audit, decidedReason, gameById, manifestKey, saveScan, type Game, type Manifest, type ScanReport, type Version } from "@zaisma/core";
import type { StoredFile } from "./scan.ts";
import { authUserEmail, realEmail } from "./auth.ts";
import { noteRulingOnGame } from "./standing.ts";
import { copyStoppedEmail, deliverEmail } from "./email-codes.ts";
import { tellWebhooks } from "./webhooks.ts";
import type { Env } from "./env.ts";

/**
 * Re-uploads of another developer's game (docs/DECISIONS.md, "Copies never pay; history does"). A version is one
 * when at least COPY_LIMITS.minimumMatchedFilePct of its distinct files are files one other developer sent before
 * its owner did, and that developer has a game with them. Files COPY_LIMITS.commonFileOwnerCount or more developers
 * have sent (engines, libraries, asset packs) aren't compared. Own games and a team's games share an owner, so they
 * never count; a later update of the original never matches the copy, since the original sent its files first.
 */
export interface MatchedGame {
  gameId: string;
  matchedFileCount: number;
  comparedFileCount: number;
  /** The matched game's owner's account is banned (bans.ts): the upload waits for a person as matches_banned_account_files. */
  isBannedOwner: boolean;
}

/** The other developer's game most of these files come from, or null. Only file-by-file uploads have fingerprints. */
export async function findMatchedGame(env: Env, game: Game, files: StoredFile[]): Promise<MatchedGame | null> {
  const ownerId = game.owner_id;
  if (!ownerId) return null;
  const hashes = [...new Set(files.map((file) => file.sha256).filter((hash): hash is string => !!hash))];
  if (hashes.length === 0) return null;

  // Who sent each file, and when they first did.
  const sentAtMsByOwner = new Map<string, Map<string, number>>();
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < hashes.length; i += 45) {
    const chunk = hashes.slice(i, i + 45);
    const placeholders = chunk.map(() => "?").join(",");
    statements.push(
      env.DB.prepare(`SELECT owner_id, sha256, created_at_ms FROM blob_owners WHERE sha256 IN (${placeholders}) UNION ALL SELECT owner_id, sha256, created_at_ms FROM owned_blobs WHERE sha256 IN (${placeholders})`).bind(
        ...chunk,
        ...chunk,
      ),
    );
  }
  for (let i = 0; i < statements.length; i += 50) {
    for (const batch of await env.DB.batch<{ owner_id: string; sha256: string; created_at_ms: number }>(statements.slice(i, i + 50))) {
      for (const row of batch.results) {
        const byOwner = sentAtMsByOwner.get(row.sha256) ?? new Map<string, number>();
        byOwner.set(row.owner_id, Math.min(byOwner.get(row.owner_id) ?? Infinity, row.created_at_ms));
        sentAtMsByOwner.set(row.sha256, byOwner);
      }
    }
  }

  const compared = hashes.filter((hash) => (sentAtMsByOwner.get(hash)?.size ?? 0) < COPY_LIMITS.commonFileOwnerCount);
  if (compared.length === 0) return null;
  const isMostOf = (matchedFileCount: number) => matchedFileCount * 100 >= compared.length * COPY_LIMITS.minimumMatchedFilePct;

  // The files each other developer sent before this owner did.
  const firstHashesByOwner = new Map<string, Set<string>>();
  for (const hash of compared) {
    const byOwner = sentAtMsByOwner.get(hash);
    if (!byOwner) continue;
    const ownSentAtMs = byOwner.get(ownerId) ?? Infinity;
    for (const [otherOwnerId, sentAtMs] of byOwner) {
      if (otherOwnerId === ownerId || sentAtMs >= ownSentAtMs) continue;
      const first = firstHashesByOwner.get(otherOwnerId) ?? new Set<string>();
      first.add(hash);
      firstHashesByOwner.set(otherOwnerId, first);
    }
  }
  const candidates = [...firstHashesByOwner].filter(([, first]) => isMostOf(first.size)).sort((first, second) => second[1].size - first[1].size);

  for (const [otherOwnerId, firstHashes] of candidates) {
    // Their live versions first, then the newest: which of their games it is.
    const { results: versions } = await env.DB
      .prepare(
        `SELECT versions.id, versions.game_id FROM versions JOIN games ON games.id = versions.game_id
         WHERE games.owner_id = ? AND versions.kind = 'files' ORDER BY versions.id = games.live_version_id DESC, versions.created_at_ms DESC LIMIT ?`,
      )
      .bind(otherOwnerId, COPY_LIMITS.maximumComparedManifestCount)
      .all<{ id: string; game_id: string }>();
    let best: MatchedGame | null = null;
    for (const version of versions) {
      const stored = await env.GAMES.get(manifestKey(version.id));
      if (!stored) continue;
      const theirHashes = new Set(Object.values(((await stored.json()) as Manifest).files).map((file) => file.sha256));
      const matchedFileCount = [...firstHashes].filter((hash) => theirHashes.has(hash)).length;
      if (!best || matchedFileCount > best.matchedFileCount) best = { gameId: version.game_id, matchedFileCount, comparedFileCount: compared.length, isBannedOwner: false };
    }
    if (best && isMostOf(best.matchedFileCount)) return { ...best, isBannedOwner: await isBannedOwner(env, otherOwnerId) };
  }
  return null;
}

/** Whether an owner's account is banned (bans.ts). */
async function isBannedOwner(env: Env, ownerId: string | null): Promise<boolean> {
  if (!ownerId) return false;
  const row = await env.DB.prepare("SELECT accounts.banned_at_ms FROM owners JOIN accounts ON accounts.id = owners.account_id WHERE owners.id = ?").bind(ownerId).first<{ banned_at_ms: number | null }>();
  return row?.banned_at_ms != null;
}

/** An owner's public name: their account's username, or null for an owner with no account. */
export async function ownerUsername(env: Env, ownerId: string | null): Promise<string | null> {
  if (!ownerId) return null;
  const row = await env.DB.prepare("SELECT accounts.username FROM owners JOIN accounts ON accounts.id = owners.account_id WHERE owners.id = ?").bind(ownerId).first<{ username: string }>();
  return row?.username ?? null;
}

/**
 * A person at Zaisma decided a held version is a re-upload of the matched game: it's rejected under the copyright
 * rule, and the original developer hears once, with the uploader's public name, in their game's history and by
 * email (Julius, Oct 18, 2026). Nobody hears while it's only held, so a teammate or a second account of their own
 * raises no false alarm. Answers false when the version isn't a held match.
 */
export async function stopCopy(env: Env, version: Version, actor: string): Promise<boolean> {
  const report: ScanReport | null = version.scan_report ? JSON.parse(version.scan_report) : null;
  if (!report?.matched_game || version.scan_status === "rejected") return false;
  const rejectedReason = decidedReason("rejected_by_zaisma", "copyright", "A re-upload of another developer's game.");
  await saveScan(env.DB, version.id, "rejected", null);
  await env.DB.prepare("UPDATE versions SET review_reason = ? WHERE id = ?").bind(JSON.stringify(rejectedReason), version.id).run();
  await noteRulingOnGame(env, version.game_id);
  await audit(env.DB, version.game_id, "rejected", `${version.id}: a re-upload of another developer's game`, actor, rejectedReason);
  await tellWebhooks(env, "scan_status_changed", version.game_id, { versionId: version.id });

  const original = await gameById(env.DB, report.matched_game.game_id);
  // A banned original is never told: that would tell a banned person what Zaisma watches.
  if (!original || (await isBannedOwner(env, original.owner_id))) return true;
  const copy = await gameById(env.DB, version.game_id);
  const uploaderName = (await ownerUsername(env, copy?.owner_id ?? null)) ?? "another developer";
  // The reason is the name alone: history reads a version ID out of it, and the copy's isn't theirs to see.
  await audit(env.DB, original.id, "copy-stopped", uploaderName, actor);
  const accountId = original.owner_id ? (await env.DB.prepare("SELECT account_id FROM owners WHERE id = ?").bind(original.owner_id).first<{ account_id: string | null }>())?.account_id : null;
  const username = await ownerUsername(env, original.owner_id);
  const email = accountId ? realEmail((await authUserEmail(env, accountId)) ?? "") : null;
  if (email && username) await deliverEmail(env, email, copyStoppedEmail(env, { username, gameTitle: original.title, uploaderName }));
  return true;
}
