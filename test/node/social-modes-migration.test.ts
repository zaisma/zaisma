import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

/** Migration 0039: three age bands and a social mode on every account, in a table others point at. */

const MIGRATIONS = join(import.meta.dirname, "../../migrations");

describe("migration 0039", () => {
  /** A database with every migration before 0039, accounts with things pointing at them, and then 0039. */
  function migrated(): DatabaseSync {
    const database = new DatabaseSync(":memory:");
    // D1 checks foreign keys.
    database.exec("PRAGMA foreign_keys = ON");
    const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort();
    const at = files.findIndex((name) => name.startsWith("0039_"));
    for (const file of files.slice(0, at)) database.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
    database.exec(`
      INSERT INTO accounts (id, player_id, name, age_band, created_at_ms, updated_at_ms) VALUES ('adult-account', 'player_adult1aaaaaaaaaaaa', 'Night Owl', '18+', 1, 2);
      INSERT INTO accounts (id, player_id, name, age_band, created_at_ms, updated_at_ms) VALUES ('teen-account', 'player_teen1aaaaaaaaaaaaa', 'Quiet Comet', '13-17', 3, 4);
      INSERT INTO owners (id, kind, account_id, created_at_ms) VALUES ('owner_owner1aaaaaaaaaaaaaaa', 'person', 'adult-account', 1);
      INSERT INTO passkeys (id, account_id, public_key, algorithm_number, sign_count, name, created_at_ms) VALUES ('credential1', 'teen-account', 'key', -7, 0, 'iPhone', 1);
    `);
    // D1 runs a migration as one transaction.
    database.exec(`BEGIN; ${readFileSync(join(MIGRATIONS, files[at]!), "utf8")}\nCOMMIT;`);
    return database;
  }

  it("keeps every account, moving 13 to 17 to the strictest band with no chat, and 18+ to friends-focused", () => {
    const database = migrated();
    expect(database.prepare("SELECT * FROM accounts ORDER BY id").all()).toEqual([
      { id: "adult-account", name: "Night Owl", created_at_ms: 1, updated_at_ms: 2, player_id: "player_adult1aaaaaaaaaaaa", age_band: "18+", social_mode: "friends_focused" },
      { id: "teen-account", name: "Quiet Comet", created_at_ms: 3, updated_at_ms: 4, player_id: "player_teen1aaaaaaaaaaaaa", age_band: "13-15", social_mode: "solo_focused" },
    ]);
    // What pointed at accounts still does.
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("SELECT account_id FROM owners").get()).toEqual({ account_id: "adult-account" });
    expect(database.prepare("SELECT account_id FROM passkeys").get()).toEqual({ account_id: "teen-account" });
  });

  it("refuses bands and modes that don't exist, and keeps player IDs unique", () => {
    const database = migrated();
    const insert = (band: string, socialMode: string, playerId: string) =>
      database.prepare("INSERT INTO accounts (id, player_id, name, age_band, social_mode, created_at_ms, updated_at_ms) VALUES (?, ?, 'X', ?, ?, 1, 1)").run(`id-${playerId}`, playerId, band, socialMode);
    expect(() => insert("13-17", "solo_focused", "player_a")).toThrow(/CHECK/);
    expect(() => insert("16-17", "open", "player_b")).toThrow(/CHECK/);
    expect(() => insert("16-17", "open_and_social", "player_adult1aaaaaaaaaaaa")).toThrow(/UNIQUE/);
    insert("16-17", "open_and_social", "player_c");
  });
});
