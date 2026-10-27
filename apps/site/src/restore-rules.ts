// What a restore from Zaisma's backups brings back (apps/site/src/restore.ts): only what the restored
// database still holds, so nothing deleted or taken down before the copy comes back. No imports, so the
// node test that holds every key in the code to a rule can read it.

const JSON_TYPE = "application/json";

/** Whether a backup key comes back: what in the restored database owns it, and what R2 gets when its copy has no metadata. */
export type RestoreRule =
  | { kind: "owned"; ownerSql: string; ownerValues: string[]; contentType?: string }
  | { kind: "always"; contentType?: string }
  | { kind: "never"; reason: string };

/**
 * What owns each kind of key Zaisma writes to R2 (packages/core's *Key functions), so a restore brings
 * back only what the restored database still holds. ownerSql answers a row with has_owner, and may
 * answer content_type and version_number for copies made before the backup kept metadata.
 * test/node/restore-rules.test.ts holds every key function and prefix in the code to a rule here.
 */
export function restoreRuleOf(backupKey: string): RestoreRule {
  const [kind = "", ...rest] = backupKey.split("/");
  const key = rest.join("/");
  const parts = key.split("/");
  const suffixType = (name: string) => (name.endsWith(".json") ? JSON_TYPE : name.endsWith(".jpg") ? "image/jpeg" : name.endsWith(".webp") ? "image/webp" : name.endsWith(".png") ? "image/png" : name.endsWith(".glsl") ? "text/plain; charset=utf-8" : undefined);
  const owned = (ownerSql: string, ownerValues: string[], contentType?: string): RestoreRule => ({ kind: "owned", ownerSql, ownerValues, contentType });
  if (kind === "game-databases" && rest.length === 1 && key.endsWith(".sql")) return owned("SELECT 1 AS has_owner FROM games WHERE id = ?", [key.slice(0, -".sql".length)]);
  if (kind === "kept-rooms" && parts.length === 2 && parts[1]!.endsWith(".jsonl")) return owned("SELECT 1 AS has_owner FROM kept_rooms WHERE game_id = ? AND room_code = ?", [parts[0]!, parts[1]!.slice(0, -".jsonl".length)]);
  if (kind === "zaisma-saves") {
    // A save (saveKey) or one of its earlier copies (saveCopyKey).
    if (parts.length === 2 && parts[1]!.endsWith(".json")) return owned("SELECT 1 AS has_owner, version_number FROM saves WHERE account_id = ? AND game_id = ?", [parts[0]!, parts[1]!.slice(0, -".json".length)], JSON_TYPE);
    if (parts.length === 3 && parts[2]!.endsWith(".json")) return owned("SELECT 1 AS has_owner FROM save_history WHERE id = ? AND account_id = ? AND game_id = ?", [parts[2]!.slice(0, -".json".length), parts[0]!, parts[1]!], JSON_TYPE);
    return { kind: "never", reason: "not a save or a save's copy" };
  }
  if (kind !== "zaisma-games") return { kind: "never", reason: "not a kind of backup a restore brings back" };
  const [area = "", ...areaParts] = parts;
  const name = areaParts.at(-1) ?? "";
  if (area === "blobs" && areaParts.length === 1) return owned("SELECT 1 AS has_owner FROM blobs WHERE sha256 = ?", [name]);
  if (area === "owned" && areaParts.length === 2) return owned("SELECT 1 AS has_owner FROM owned_blobs WHERE owner_id = ? AND sha256 = ?", [areaParts[0]!, name]);
  if (area === "manifests" && areaParts.length === 1 && name.endsWith(".json")) return owned("SELECT 1 AS has_owner FROM versions WHERE id = ?", [name.slice(0, -".json".length)], JSON_TYPE);
  // Versions uploaded as a zip before files were stored by fingerprint: their files sit under the version's r2_prefix,
  // games/<game_id>/<a folder of its own>/<path> (games/<folder>/<path> in older rows).
  if (area === "games" && areaParts.length >= 2) return owned("SELECT 1 AS has_owner FROM versions WHERE r2_prefix IN (?, ?)", [`games/${areaParts[0]!}/${areaParts[1]!}`, `games/${areaParts[0]!}`]);
  // A game's image (imageKey), or its card and sized copies (cardImageKey, sizedImageKey): the id is before the first dot.
  if (area === "images" && areaParts.length === 2) {
    const imageId = name.split(".")[0]!;
    return owned("SELECT 1 AS has_owner, content_type FROM game_images WHERE id = ? AND game_id = ?", [imageId, areaParts[0]!], name === imageId ? undefined : suffixType(name));
  }
  // Known abuse material kept for reporting (heldImageKey, and a shader's held frames): kept while its game is.
  if (area === "held-images" && areaParts.length === 2) return owned("SELECT 1 AS has_owner FROM games WHERE id = ?", [areaParts[0]!], suffixType(name));
  if (area === "shaders" && areaParts.length === 2) return owned("SELECT 1 AS has_owner FROM game_shaders WHERE id = ? AND game_id = ?", [name.split(".")[0]!, areaParts[0]!], suffixType(name));
  if (area === "forum-media" && areaParts.length === 1) return owned("SELECT 1 AS has_owner, content_type FROM forum_media WHERE storage_key = ?", [key]);
  // Forum images that matched known abuse material: no row, kept for reporting until a person deals with them.
  if (area === "forum-held" && areaParts.length === 1) return { kind: "always" };
  if (area === "report-pictures" && areaParts.length === 1 && name.endsWith(".jpg")) return owned("SELECT 1 AS has_owner FROM reports WHERE id = ? AND has_picture = 1", [name.slice(0, -".jpg".length)], "image/jpeg");
  if (area === "logs") return { kind: "never", reason: "logs last days, and their listing reads metadata older copies lack" };
  if (area === "shader-checks") return { kind: "never", reason: "shader check sheets last a day" };
  if (area === "shader-check-runs") return { kind: "never", reason: "counts of shader checks before sending last a day" };
  if (area === "brotli") return { kind: "never", reason: "Brotli copies are made again from the files" };
  return { kind: "never", reason: "no rule for this kind of game file" };
}
