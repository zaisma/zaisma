import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { blobKey } from "@zaisma/core";
import { moveFiles } from "../../apps/site/src/file-moves.ts";
import { dailyCleanup } from "../../apps/site/src/cleanup.ts";

/** Files named by an ID move to their new names after migration 0032 gives the IDs their kind. */

const SHA = "cd".repeat(32);
const move = (bucketName: "games" | "saves", fromKey: string, toKey: string) =>
  env.DB.prepare("INSERT INTO file_moves (bucket_name, from_key, to_key) VALUES (?, ?, ?)").bind(bucketName, fromKey, toKey).run();

beforeEach(async () => {
  await env.DB.exec("DELETE FROM file_moves; DELETE FROM blobs;");
});

describe("file moves", () => {
  it("move each file to its new name with what it was stored with, and drop moves whose file is gone", async () => {
    const picture = new Uint8Array(70_000).map((_, i) => i % 251);
    await env.GAMES.put("images/game1/image1", picture, { httpMetadata: { contentType: "image/png" } });
    await env.GAMES.put("manifests/version1.json", JSON.stringify({ files: { "index.html": { sha256: "a1" }, "big.pck": { sha256: SHA, owner: "owner1" } } }), { httpMetadata: { contentType: "application/json" } });
    await env.SAVES.put("account-1/game1.json", '{"level":3}', { httpMetadata: { contentType: "application/json" }, customMetadata: { version: "4" } });
    await move("games", "images/game1/image1", "images/game_game1/image_image1");
    await move("games", "manifests/version1.json", "manifests/version_version1.json");
    await move("saves", "account-1/game1.json", "account-1/game_game1.json");
    await move("games", "report-pictures/gone.jpg", "report-pictures/report_gone.jpg");

    expect(await moveFiles(env)).toBe(3);
    const movedPicture = await env.GAMES.get("images/game_game1/image_image1");
    expect(new Uint8Array(await movedPicture!.arrayBuffer())).toEqual(picture);
    expect(movedPicture!.httpMetadata?.contentType).toBe("image/png");
    expect(await env.GAMES.head("images/game1/image1")).toBeNull();
    // A file list's big file is named by its owner's ID, which gets its kind too.
    expect(await (await env.GAMES.get("manifests/version_version1.json"))!.json()).toEqual({ files: { "index.html": { sha256: "a1" }, "big.pck": { sha256: SHA, owner_id: "owner_owner1" } } });
    const save = await env.SAVES.get("account-1/game_game1.json");
    expect(await save!.text()).toBe('{"level":3}');
    expect(save!.customMetadata).toEqual({ version: "4" });
    expect(await env.SAVES.head("account-1/game1.json")).toBeNull();
    expect(await env.DB.prepare("SELECT COUNT(*) AS move_count FROM file_moves").first("move_count")).toBe(0);
    // Nothing left: the next run does nothing.
    expect(await moveFiles(env)).toBe(0);
  });

  it("hold off the daily cleanup of unused files until every file has moved", async () => {
    const unused = new TextEncoder().encode("nothing uses this");
    await env.GAMES.put(blobKey(SHA), unused);
    await env.DB.prepare("INSERT INTO blobs (sha256, size_bytes, created_at_ms) VALUES (?, ?, 0)").bind(SHA, unused.byteLength).run();
    await move("games", "manifests/version2.json", "manifests/version_version2.json");
    await dailyCleanup(env);
    expect(await env.GAMES.head(blobKey(SHA))).not.toBeNull();
    await moveFiles(env);
    await dailyCleanup(env);
    expect(await env.GAMES.head(blobKey(SHA))).toBeNull();
  });
});
