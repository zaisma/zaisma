import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { ID_KINDS, idKindInWords, idKindOf, isIdOf, newId } from "../../packages/core/src/ids.ts";
import { withOwnerIds } from "../../apps/site/src/file-moves.ts";

/** docs/NAMING.md, IDs: every ID Zaisma makes says its kind, and migration 0032 gave the existing ones theirs. */

const ROOT = join(import.meta.dirname, "../..");
const MIGRATIONS = join(ROOT, "migrations");

describe("IDs that say their kind", () => {
  it("are the kinds docs/NAMING.md lists", () => {
    const doc = readFileSync(join(ROOT, "docs/NAMING.md"), "utf8");
    const section = doc.slice(doc.indexOf("\n## IDs\n"), doc.indexOf("\n## Inputs\n"));
    expect([...section.matchAll(/^\| `([a-z_]+)`[^|]*\| `\1_…` \|$/gm)].map((row) => row[1])).toEqual([...ID_KINDS]);
  });

  it("are made as <kind>_<random>, and read back as their kind", () => {
    const id = newId("save_copy");
    expect(id).toMatch(/^save_copy_[a-z0-9]{20}$/);
    expect(idKindOf(id)).toBe("save_copy");
    expect(newId("version")).not.toBe(newId("version"));
    expect(idKindOf("play_ticket_8f3k2m9q1x7c4v6b0n5z")).toBe("play_ticket");
    // The first precedents were named by hand, and the first known issues start with k.
    expect(idKindOf("precedent_hard-or-boring")).toBe("precedent");
    expect(idKindOf("topic_k8f3k2m9q1x7c4v6b0n5z")).toBe("topic");
  });

  it("tell anything else apart", () => {
    for (const notAnId of ["8f3k2m9q1x7c4v6b0n5z", "cursor_1a", "g_8f3k2m9q1x7c4v6b0n5z", "version_", "_8f3k2m", "version_8F3K", "version_a_b", "zsk_8f3k2m9q1x7c4v6b0n5z_secret"]) {
      expect(idKindOf(notAnId), notAnId).toBeNull();
    }
    expect(isIdOf("image", "image_8f3k2m9q1x7c4v6b0n5z")).toBe(true);
    expect(isIdOf("image", "version_8f3k2m9q1x7c4v6b0n5z")).toBe(false);
    expect(isIdOf("image", 42)).toBe(false);
  });

  it("are named in words for messages", () => {
    expect(idKindInWords("image")).toBe("an image ID");
    expect(idKindInWords("save_copy")).toBe("a save copy ID");
  });
});

describe("migration 0032", () => {
  /** A database with every migration before 0032, a little of everything in it, and then 0032. */
  function migrated(): DatabaseSync {
    const database = new DatabaseSync(":memory:");
    const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort();
    const at = files.findIndex((name) => name.startsWith("0032_"));
    for (const file of files.slice(0, at)) database.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
    database.exec(`
      INSERT INTO accounts (id, name, age_band, created_at, updated_at) VALUES ('5c9e1f2a-account', 'Night Owl', '18+', 1, 1);
      INSERT INTO owners (id, kind, account_id, created_at) VALUES ('owner1aaaaaaaaaaaaaaa', 'person', '5c9e1f2a-account', 1);
      INSERT INTO games (id, slug, title, review_status, live_version_id, owner_id, created_at_ms, updated_at_ms) VALUES ('game1aaaaaaaaaaaaaaaa', 'sky-hopper', 'Sky Hopper', 'live', 'version1aaaaaaaaaaaaa', 'owner1aaaaaaaaaaaaaaa', 1, 1);
      INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, kind, created_at_ms) VALUES ('version1aaaaaaaaaaaaa', 'game1aaaaaaaaaaaaaaaa', 'manifests/version1aaaaaaaaaaaaa', 2, 10, 'approved', 'files', 1);
      INSERT INTO versions (id, game_id, r2_prefix, file_count, size_bytes, scan_status, kind, created_at_ms) VALUES ('version2bbbbbbbbbbbbb', 'game1aaaaaaaaaaaaaaaa', 'games/game1aaaaaaaaaaaaaaaa/version2bbbbbbbbbbbbb', 1, 5, 'approved', 'zip', 1);
      INSERT INTO owned_blobs (owner_id, sha256, size_bytes, created_at_ms) VALUES ('owner1aaaaaaaaaaaaaaa', '${"ab".repeat(32)}', 5, 1);
      INSERT INTO game_images (id, game_id, kind, content_type, width_px, height_px, size_bytes, created_at_ms) VALUES ('image1aaaaaaaaaaaaaaa', 'game1aaaaaaaaaaaaaaaa', 'cover', 'image/png', 1280, 720, 9, 1);
      INSERT INTO tester_links (id, game_id, name, token, created_at_ms) VALUES ('tester1aaaaaaaaaaaaaa', 'game1aaaaaaaaaaaaaaaa', 'Sam', 'tokentokentokentoken', 1);
      INSERT INTO saves (account_id, game_id, version, hash, bytes, updated_at) VALUES ('5c9e1f2a-account', 'game1aaaaaaaaaaaaaaaa', 1, 'h', 2, 1);
      INSERT INTO save_history (id, account_id, game_id, at, reason, hash, bytes) VALUES ('copy1aaaaaaaaaaaaaaaa', '5c9e1f2a-account', 'game1aaaaaaaaaaaaaaaa', 1, 'hourly', 'h', 2);
      INSERT INTO reports (id, game_id, reason, created_at, version_id, picture, group_id, precedent_id, triage) VALUES ('report1aaaaaaaaaaaaaa', 'game1aaaaaaaaaaaaaaaa', 'broken', 1, 'version1aaaaaaaaaaaaa', 1, NULL, 'hard-or-boring', '{"ai":true,"precedent":{"id":"hard-or-boring","title":"Too hard","fit":"fits"}}');
      INSERT INTO reports (id, game_id, reason, created_at, group_id) VALUES ('report2bbbbbbbbbbbbbb', 'game1aaaaaaaaaaaaaaaa', 'broken', 2, 'report1aaaaaaaaaaaaaa');
      INSERT INTO audit_log (game_id, action, reason, happened_at_ms) VALUES ('game1aaaaaaaaaaaaaaaa', 'report-paused-update', 'Report: Broken. Version version1aaaaaaaaaaaaa held; players are back on version version2bbbbbbbbbbbbb', 1);
      INSERT INTO audit_log (game_id, action, reason, happened_at_ms) VALUES ('game1aaaaaaaaaaaaaaaa', 'draft-ready', 'Passed: the version is ready', 2);
      INSERT INTO forum_topics (id, account_id, kind, title, game_id, created_at_ms, updated_at_ms, answer_post_id, triage) VALUES ('topic1aaaaaaaaaaaaaaa', '5c9e1f2a-account', 'question', 'Uploads fail', 'game1aaaaaaaaaaaaaaaa', 1, 1, 'post2bbbbbbbbbbbbbbbb', '{"is_by_ai":true,"summary":"s","why":"w","merged_into_topic_id":null,"same_as_topic_id":"topic9zzzzzzzzzzzzzzz","known_issue_draft":null}');
      INSERT INTO forum_posts (id, topic_id, account_id, author_kind, posted_via, text_markdown, created_at_ms) VALUES ('post1aaaaaaaaaaaaaaaa', 'topic1aaaaaaaaaaaaaaa', '5c9e1f2a-account', 'ai', 'mcp', 'See ![image](/forum/media/media1aaaaaaaaaaaaaa)', 1);
      INSERT INTO forum_posts (id, topic_id, account_id, author_kind, posted_via, text_markdown, created_at_ms, reply_to_post_id) VALUES ('post2bbbbbbbbbbbbbbbb', 'topic1aaaaaaaaaaaaaaa', NULL, 'zaisma', 'admin', 'As [above](#p-post1aaaaaaaaaaaaaaaa)', 2, 'post1aaaaaaaaaaaaaaaa');
      INSERT INTO forum_media (id, post_id, account_id, content_type, position_index, created_at_ms, storage_key) VALUES ('media1aaaaaaaaaaaaaa', 'post1aaaaaaaaaaaaaaaa', '5c9e1f2a-account', 'image/png', 0, 1, 'feedback-media/media1aaaaaaaaaaaaaa');
      INSERT INTO forum_search (title, body, topic_id, post_id) VALUES ('Uploads fail', '', 'topic1aaaaaaaaaaaaaaa', ''), ('', 'See ![image](/forum/media/media1aaaaaaaaaaaaaa)', 'topic1aaaaaaaaaaaaaaa', 'post1aaaaaaaaaaaaaaaa');
    `);
    // D1 runs a migration as one transaction.
    database.exec(`BEGIN; ${readFileSync(join(MIGRATIONS, files[at]!), "utf8")}\nCOMMIT;`);
    return database;
  }
  const all = (database: DatabaseSync, sql: string) => database.prepare(sql).all();
  const one = (database: DatabaseSync, sql: string) => database.prepare(sql).get();

  it("gives every ID its kind, and everything pointing at it", () => {
    const database = migrated();
    expect(one(database, "SELECT id, live_version_id, owner_id FROM games")).toEqual({ id: "game_game1aaaaaaaaaaaaaaaa", live_version_id: "version_version1aaaaaaaaaaaaa", owner_id: "owner_owner1aaaaaaaaaaaaaaa" });
    expect(all(database, "SELECT id, game_id, r2_prefix FROM versions ORDER BY id")).toEqual([
      { id: "version_version1aaaaaaaaaaaaa", game_id: "game_game1aaaaaaaaaaaaaaaa", r2_prefix: "manifests/version_version1aaaaaaaaaaaaa" },
      // A zip version's files stay where its prefix says.
      { id: "version_version2bbbbbbbbbbbbb", game_id: "game_game1aaaaaaaaaaaaaaaa", r2_prefix: "games/game1aaaaaaaaaaaaaaaa/version2bbbbbbbbbbbbb" },
    ]);
    expect(one(database, "SELECT id, game_id FROM game_images")).toEqual({ id: "image_image1aaaaaaaaaaaaaaa", game_id: "game_game1aaaaaaaaaaaaaaaa" });
    expect(one(database, "SELECT id FROM tester_links")).toEqual({ id: "tester_tester1aaaaaaaaaaaaaa" });
    expect(one(database, "SELECT id, game_id FROM save_history")).toEqual({ id: "save_copy_copy1aaaaaaaaaaaaaaaa", game_id: "game_game1aaaaaaaaaaaaaaaa" });
    expect(all(database, "SELECT id, version_id, group_id, precedent_id, json_extract(triage, '$.precedent.id') AS triage_precedent_id FROM reports ORDER BY id")).toEqual([
      { id: "report_report1aaaaaaaaaaaaaa", version_id: "version_version1aaaaaaaaaaaaa", group_id: null, precedent_id: "precedent_hard-or-boring", triage_precedent_id: "precedent_hard-or-boring" },
      { id: "report_report2bbbbbbbbbbbbbb", version_id: null, group_id: "report_report1aaaaaaaaaaaaaa", precedent_id: null, triage_precedent_id: null },
    ]);
    expect(one(database, "SELECT id FROM precedents WHERE title = 'Too hard, boring or not fun'")).toEqual({ id: "precedent_hard-or-boring" });
    expect(one(database, "SELECT id, game_id, answer_post_id, json_extract(triage, '$.same_as_topic_id') AS same_as_topic_id, json_extract(triage, '$.merged_into_topic_id') AS merged_into_topic_id FROM forum_topics")).toEqual({
      id: "topic_topic1aaaaaaaaaaaaaaa",
      game_id: "game_game1aaaaaaaaaaaaaaaa",
      answer_post_id: "post_post2bbbbbbbbbbbbbbbb",
      same_as_topic_id: "topic_topic9zzzzzzzzzzzzzzz",
      merged_into_topic_id: null,
    });
    expect(all(database, "SELECT id, topic_id, reply_to_post_id, text_markdown FROM forum_posts ORDER BY id")).toEqual([
      { id: "post_post1aaaaaaaaaaaaaaaa", topic_id: "topic_topic1aaaaaaaaaaaaaaa", reply_to_post_id: null, text_markdown: "See ![image](/forum/media/media_media1aaaaaaaaaaaaaa)" },
      { id: "post_post2bbbbbbbbbbbbbbbb", topic_id: "topic_topic1aaaaaaaaaaaaaaa", reply_to_post_id: "post_post1aaaaaaaaaaaaaaaa", text_markdown: "As [above](#p-post_post1aaaaaaaaaaaaaaaa)" },
    ]);
    // A forum image's file stays where its row says.
    expect(one(database, "SELECT id, post_id, storage_key FROM forum_media")).toEqual({ id: "media_media1aaaaaaaaaaaaaa", post_id: "post_post1aaaaaaaaaaaaaaaa", storage_key: "feedback-media/media1aaaaaaaaaaaaaa" });
    expect(all(database, "SELECT topic_id, post_id, body FROM forum_search ORDER BY post_id")).toEqual([
      { topic_id: "topic_topic1aaaaaaaaaaaaaaa", post_id: "", body: "" },
      { topic_id: "topic_topic1aaaaaaaaaaaaaaa", post_id: "post_post1aaaaaaaaaaaaaaaa", body: "See ![image](/forum/media/media_media1aaaaaaaaaaaaaa)" },
    ]);
    expect(all(database, "PRAGMA foreign_key_check")).toEqual([]);
  });

  it("names versions in a game's history by their new ID", () => {
    expect(all(migrated(), "SELECT reason FROM audit_log ORDER BY happened_at_ms").map((row) => (row as { reason: string }).reason)).toEqual([
      "Report: Broken. version_version1aaaaaaaaaaaaa held; players are back on version_version2bbbbbbbbbbbbb",
      "Passed: the version is ready",
    ]);
  });

  it("lists the files named by an ID, to move to their new names", () => {
    expect(all(migrated(), "SELECT bucket_name, from_key, to_key FROM file_moves ORDER BY bucket_name, from_key")).toEqual([
      { bucket_name: "games", from_key: "images/game1aaaaaaaaaaaaaaaa/image1aaaaaaaaaaaaaaa", to_key: "images/game_game1aaaaaaaaaaaaaaaa/image_image1aaaaaaaaaaaaaaa" },
      { bucket_name: "games", from_key: "manifests/version1aaaaaaaaaaaaa.json", to_key: "manifests/version_version1aaaaaaaaaaaaa.json" },
      { bucket_name: "games", from_key: `owned/owner1aaaaaaaaaaaaaaa/${"ab".repeat(32)}`, to_key: `owned/owner_owner1aaaaaaaaaaaaaaa/${"ab".repeat(32)}` },
      { bucket_name: "games", from_key: "report-pictures/report1aaaaaaaaaaaaaa.jpg", to_key: "report-pictures/report_report1aaaaaaaaaaaaaa.jpg" },
      { bucket_name: "saves", from_key: "5c9e1f2a-account/game1aaaaaaaaaaaaaaaa.json", to_key: "5c9e1f2a-account/game_game1aaaaaaaaaaaaaaaa.json" },
      { bucket_name: "saves", from_key: "5c9e1f2a-account/game1aaaaaaaaaaaaaaaa/copy1aaaaaaaaaaaaaaaa.json", to_key: "5c9e1f2a-account/game_game1aaaaaaaaaaaaaaaa/save_copy_copy1aaaaaaaaaaaaaaaa.json" },
    ]);
  });

  it("names a file list's owner by owner_id, with its kind", () => {
    const before = JSON.stringify({ files: { "index.html": { sha256: "a1" }, "big.pck": { sha256: "b2", owner: "owner1aaaaaaaaaaaaaaa" } } });
    expect(JSON.parse(withOwnerIds(before))).toEqual({ files: { "index.html": { sha256: "a1" }, "big.pck": { sha256: "b2", owner_id: "owner_owner1aaaaaaaaaaaaaaa" } } });
    // Moving one again changes nothing.
    expect(withOwnerIds(withOwnerIds(before))).toBe(withOwnerIds(before));
  });
});
