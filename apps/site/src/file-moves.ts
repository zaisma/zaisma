import { isIdOf, type Manifest } from "@zaisma/core";
import type { Env } from "./env.ts";

/**
 * Files named by an ID move to their new name after a migration renames the ID (file_moves, made by
 * migrations/0032_ids_say_their_kind.sql). Each cron run moves a batch: the new copy is written
 * before the old one goes, so a run cut short never loses a file, and a move whose file is gone is
 * simply dropped. Once file_moves is empty, a run costs one query.
 */

const BATCH_FILE_COUNT = 100;

interface FileMove {
  bucket_name: "games" | "saves";
  from_key: string;
  to_key: string;
}

export async function moveFiles(env: Env): Promise<number> {
  const { results: moves } = await env.DB.prepare("SELECT bucket_name, from_key, to_key FROM file_moves LIMIT ?").bind(BATCH_FILE_COUNT).all<FileMove>();
  let movedCount = 0;
  for (const move of moves) {
    const bucket = move.bucket_name === "saves" ? env.SAVES : env.GAMES;
    const stored = await bucket.get(move.from_key);
    if (stored) {
      const options = { httpMetadata: stored.httpMetadata, customMetadata: stored.customMetadata };
      if (move.to_key.startsWith("manifests/")) {
        await bucket.put(move.to_key, withOwnerIds(await stored.text()), options);
      } else {
        // Streamed with its length, so big files never sit in memory.
        const { readable, writable } = new FixedLengthStream(stored.size);
        await Promise.all([stored.body.pipeTo(writable), bucket.put(move.to_key, readable, options)]);
      }
      await bucket.delete(move.from_key);
      movedCount++;
    }
    await env.DB.prepare("DELETE FROM file_moves WHERE bucket_name = ? AND from_key = ?").bind(move.bucket_name, move.from_key).run();
  }
  return movedCount;
}

/**
 * A version's file list names a big file kept for one owner by that owner's ID. Lists written before
 * IDs said their kind called it owner and held the bare ID; it becomes owner_id with its kind.
 */
export function withOwnerIds(manifestText: string): string {
  const manifest = JSON.parse(manifestText) as { files: Record<string, { sha256: string; owner?: string; owner_id?: string }> };
  const files: Manifest["files"] = {};
  for (const [path, file] of Object.entries(manifest.files)) {
    const ownerId = file.owner_id ?? file.owner;
    files[path] = { sha256: file.sha256, ...(ownerId ? { owner_id: isIdOf("owner", ownerId) ? ownerId : `owner_${ownerId}` } : {}) };
  }
  return JSON.stringify({ files } satisfies Manifest);
}
