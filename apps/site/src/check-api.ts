import { ApiError, gameBySlug, ownServerUrlsOf } from "@zaisma/core";
import { CHECKED_TEXT_EXTENSIONS, checkGameFiles, extensionOf, type CheckedFile, type GameCheck } from "../../../packages/cli/check.mjs";
import type { CheckedCall } from "./developer.ts";
import type { Env } from "./env.ts";

/**
 * The game check through the developer API (docs/DECISIONS.md, "Fit any game; never make developers
 * rebuild for Zaisma."): the same check as `zaisma check` and the MCP's check_game, from packages/cli/check.mjs.
 *
 *   POST /api/dev/check   { "files": [{ "path", "size_bytes", "content_text" }], "slug" }   what Zaisma would refuse and what won't work
 *
 * It reads only what it's sent and keeps nothing. The router has checked that slug, when given, is a game
 * the key reaches; its own servers then count as addresses the code may connect to.
 */

const FILES_FIX = 'Give each file as { "path": "index.html", "size_bytes": 2048, "content_text": "<!doctype html>…" }, with content_text only for .html, .htm, .js, .mjs and .css files: { "path": "assets/hero.png", "size_bytes": 51200 } for the rest.';

export async function checkRoute(env: Env, checked: CheckedCall): Promise<GameCheck> {
  const given = checked.body.files;
  if (!Array.isArray(given) || given.length === 0) throw new ApiError("bad_files", { message: "files isn't a list with at least one file.", field: "files", fix: FILES_FIX });
  const files: CheckedFile[] = [];
  for (const [i, file] of (given as Record<string, unknown>[]).entries()) {
    const extraKey = file && typeof file === "object" ? Object.keys(file).find((key) => key !== "path" && key !== "size_bytes" && key !== "content_text") : undefined;
    if (extraKey) throw new ApiError("unknown_field", { message: `files[${i}].${extraKey} isn't a field of a file.`, field: `files[${i}].${extraKey}`, fix: FILES_FIX });
    if (typeof file?.path !== "string" || !file.path || !Number.isSafeInteger(file.size_bytes) || (file.size_bytes as number) < 0) {
      throw new ApiError("bad_files", { message: `files[${i}] needs a path and its size_bytes.`, field: `files[${i}]`, fix: FILES_FIX });
    }
    const isCheckedText = CHECKED_TEXT_EXTENSIONS.includes(extensionOf(file.path));
    if (isCheckedText && typeof file.content_text !== "string") {
      throw new ApiError("bad_files", { message: `${file.path} needs its content_text: the check reads every HTML, JavaScript and CSS file.`, field: `files[${i}].content_text`, fix: FILES_FIX });
    }
    if (!isCheckedText && file.content_text !== undefined && file.content_text !== null) {
      throw new ApiError("bad_files", { message: `${file.path} isn't an HTML, JavaScript or CSS file, so the check doesn't read its content_text.`, field: `files[${i}].content_text`, fix: FILES_FIX });
    }
    files.push({ path: file.path, sizeBytes: file.size_bytes as number, contentText: isCheckedText ? (file.content_text as string) : null });
  }
  const slug = typeof checked.body.slug === "string" && checked.body.slug ? checked.body.slug : null;
  const game = slug ? await gameBySlug(env.DB, slug) : null;
  return checkGameFiles(files, { slug, ownServerUrls: game ? ownServerUrlsOf(game) : null });
}
