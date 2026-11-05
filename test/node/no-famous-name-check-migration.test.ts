import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

/** Migration 0242: what the listing check stored for a famous name comes off, and is checked again. */

const MIGRATIONS = join(import.meta.dirname, "../../migrations");
const reason = (code: string, message = "The cover shows Mario.") => JSON.stringify({ code, message, content_rule: null });

describe("migration 0242", () => {
  /** A database with every migration before 0242, and then the given rows and 0242. */
  function migrated(rows: string): DatabaseSync {
    const database = new DatabaseSync(":memory:");
    const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort();
    const at = files.findIndex((name) => name.startsWith("0242_"));
    for (const file of files.slice(0, at)) database.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
    database.exec("PRAGMA foreign_keys = OFF");
    database.exec(rows);
    database.exec(`BEGIN; ${readFileSync(join(MIGRATIONS, files[at]!), "utf8")}\nCOMMIT;`);
    return database;
  }
  const game = (id: string, titleReason: string | null = null) =>
    `INSERT INTO games (id, slug, title, review_status, created_at_ms, updated_at_ms, title_listing_reason) VALUES ('${id}', '${id}', '${id}', 'live', 1, 1, ${titleReason ? `'${titleReason}'` : "NULL"});`;
  const image = (id: string, gameId: string, kind: string, status: string, listingReason: string | null, reviewReason: string | null = null) =>
    `INSERT INTO game_images (id, game_id, kind, content_type, width_px, height_px, size_bytes, review_status, created_at_ms, listing_reason, review_reason) VALUES ('${id}', '${gameId}', '${kind}', 'image/png', 1, 1, 1, '${status}', 1, ${listingReason ? `'${listingReason}'` : "NULL"}, ${reviewReason ? `'${reviewReason}'` : "NULL"});`;

  it("puts a cover and a title back on the lists and checks them again, leaving every other reason", () => {
    const database = migrated(`
      ${game("famous-title", reason("famous_name", "The title names Minecraft."))}
      ${game("famous-cover")}
      ${game("tag-title", reason("tag_in_title", "The title carries a tag."))}
      ${image("cover-famous", "famous-cover", "cover", "approved", reason("famous_name"))}
      ${image("cover-overlay", "tag-title", "cover", "approved", reason("overlay_on_cover"))}
    `);
    const games = database.prepare("SELECT id, title_listing_reason, listing_check_requested_at_ms FROM games ORDER BY id").all() as { id: string; title_listing_reason: string | null; listing_check_requested_at_ms: number | null }[];
    expect(games.map((row) => [row.id, row.title_listing_reason === null, row.listing_check_requested_at_ms !== null])).toEqual([
      ["famous-cover", true, true],
      ["famous-title", true, true],
      ["tag-title", false, false],
    ]);
    expect(database.prepare("SELECT id, listing_reason FROM game_images ORDER BY id").all()).toEqual([
      { id: "cover-famous", listing_reason: null },
      { id: "cover-overlay", listing_reason: reason("overlay_on_cover") },
    ]);
  });

  it("sends a turned-down background back to the check, unless a newer one has replaced it", () => {
    const database = migrated(`
      ${game("alone")}
      ${game("replaced")}
      ${image("old-alone", "alone", "background", "rejected", null, reason("famous_name_on_background"))}
      ${image("old-replaced", "replaced", "background", "rejected", null, reason("famous_name_on_background"))}
      ${image("new-replaced", "replaced", "background", "approved", null)}
    `);
    const rows = database.prepare("SELECT id, review_status, json_extract(review_reason, '$.code') AS code FROM game_images ORDER BY id").all();
    expect(rows).toEqual([
      { id: "new-replaced", review_status: "approved", code: null },
      { id: "old-alone", review_status: "pending", code: null },
      { id: "old-replaced", review_status: "rejected", code: "image_rejected" },
    ]);
  });

  it("sends a shader back to the check as new, and takes the code out of the log but not the words", () => {
    const database = migrated(`
      ${game("shader-game")}
      INSERT INTO game_shaders (id, game_id, screen, size_bytes, review_status, review_reason, checked_at_ms, created_at_ms) VALUES ('shader', 'shader-game', 'wide', 1, 'rejected', '${reason("famous_name_on_background")}', 5, 1);
      INSERT INTO audit_log (game_id, action, reason, happened_at_ms, review_reason) VALUES ('shader-game', 'shader-rejected', 'wide shader: The background shows Mario.', 1, '${reason("famous_name_on_background")}');
    `);
    const shader = database.prepare("SELECT review_status, review_reason, checked_at_ms, created_at_ms FROM game_shaders").get() as { review_status: string; review_reason: string | null; checked_at_ms: number | null; created_at_ms: number };
    expect([shader.review_status, shader.review_reason, shader.checked_at_ms]).toEqual(["pending", null, null]);
    expect(shader.created_at_ms).toBeGreaterThan(1);
    expect(database.prepare("SELECT reason, review_reason FROM audit_log").get()).toEqual({ reason: "wide shader: The background shows Mario.", review_reason: null });
  });
});
