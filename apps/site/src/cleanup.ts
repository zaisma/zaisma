import { ROOM_STALE_MS, audit, blobKey, manifestKey, ownedBlobKey, publishVersion, reportPictureKey, type Manifest, type Version } from "@zaisma/core";
import type { Env } from "./env.ts";
import { deleteVersion, pruneVersions } from "./scan.ts";

/** Every few minutes: publish drafts whose time has come. */
export async function publishDue(env: Env, now = Date.now()): Promise<number> {
  const { results } = await env.DB.prepare("SELECT * FROM versions WHERE publish_at IS NOT NULL AND publish_at <= ? ORDER BY publish_at LIMIT 50").bind(now).all<Version>();
  let published = 0;
  for (const v of results) {
    if (v.scan_status === "scanning") continue; // Goes live as soon as it passes.
    if (v.scan_status === "approved") {
      await publishVersion(env.DB, v);
      await audit(env.DB, v.game_id, "published", `Version ${v.id}, at its scheduled time`);
      await pruneVersions(env, v.game_id);
      published++;
    } else {
      await env.DB.prepare("UPDATE versions SET publish_at = NULL WHERE id = ?").bind(v.id).run();
      await audit(env.DB, v.game_id, "publish-dropped", `Version ${v.id} didn't pass review, so it wasn't published at its scheduled time`);
    }
  }
  return published;
}

const DAY = 86400_000;

/**
 * Once a day: delete drafts nobody published within 30 days, then files no version uses, then
 * pictures from reports closed more than 30 days ago, then rooms-list rows of rooms that stopped.
 * Held and rejected versions are kept: they may need a person, or a report to the authorities.
 */
export async function dailyCleanup(env: Env, now = Date.now()): Promise<{ drafts: number; files: number; pictures: number }> {
  const { results: drafts } = await env.DB
    .prepare(
      `SELECT versions.* FROM versions JOIN games ON games.id = versions.game_id
       WHERE versions.scan_status = 'approved' AND versions.published_at IS NULL AND versions.publish_at IS NULL
         AND versions.created_at < ? AND (games.current_version_id IS NULL OR games.current_version_id != versions.id)`,
    )
    .bind(now - 30 * DAY)
    .all<Version>();
  for (const v of drafts) {
    await deleteVersion(env, v);
    await audit(env.DB, v.game_id, "draft-deleted", `Version ${v.id} was never published, so it was deleted after 30 days`);
  }

  // Files any remaining version uses. A day's grace covers uploads still in progress.
  const used = new Set<string>();
  const { results: versions } = await env.DB.prepare("SELECT id FROM versions WHERE kind = 'files'").all<{ id: string }>();
  for (const v of versions) {
    const object = await env.GAMES.get(manifestKey(v.id));
    if (!object) continue;
    for (const f of Object.values(((await object.json()) as Manifest).files)) used.add(f.owner ? ownedBlobKey(f.owner, f.sha256) : blobKey(f.sha256));
  }
  const cutoff = now - DAY;
  const { results: shared } = await env.DB.prepare("SELECT sha256 FROM blobs WHERE created_at < ?").bind(cutoff).all<{ sha256: string }>();
  const { results: owned } = await env.DB.prepare("SELECT owner_id, sha256 FROM owned_blobs WHERE created_at < ?").bind(cutoff).all<{ owner_id: string; sha256: string }>();
  const unusedShared = shared.filter((b) => !used.has(blobKey(b.sha256)));
  const unusedOwned = owned.filter((b) => !used.has(ownedBlobKey(b.owner_id, b.sha256)));
  const keys = [...unusedShared.map((b) => blobKey(b.sha256)), ...unusedOwned.map((b) => ownedBlobKey(b.owner_id, b.sha256))];
  for (let i = 0; i < keys.length; i += 1000) await env.GAMES.delete(keys.slice(i, i + 1000));
  const statements = [
    ...unusedShared.map((b) => env.DB.prepare("DELETE FROM blobs WHERE sha256 = ?").bind(b.sha256)),
    ...unusedOwned.map((b) => env.DB.prepare("DELETE FROM owned_blobs WHERE owner_id = ? AND sha256 = ?").bind(b.owner_id, b.sha256)),
  ];
  for (let i = 0; i < statements.length; i += 100) await env.DB.batch(statements.slice(i, i + 100));

  const { results: pictures } = await env.DB.prepare("SELECT id FROM reports WHERE picture = 1 AND status != 'open' AND closed_at < ? LIMIT 1000").bind(now - 30 * DAY).all<{ id: string }>();
  if (pictures.length) {
    await env.GAMES.delete(pictures.map((p) => reportPictureKey(p.id)));
    await env.DB.batch(pictures.map((p) => env.DB.prepare("UPDATE reports SET picture = 0 WHERE id = ?").bind(p.id)));
  }
  // Lists already skip these; a room that stopped without saying so (a restart) leaves one behind.
  await env.DB.prepare("DELETE FROM live_rooms WHERE updated_at < ?").bind(now - ROOM_STALE_MS).run();
  // Game server errors are for fixing what's happening now: kept 30 days after they last happened.
  await env.DB.prepare("DELETE FROM game_server_errors WHERE last_at < ?").bind(now - 30 * DAY).run();
  return { drafts: drafts.length, files: keys.length, pictures: pictures.length };
}
