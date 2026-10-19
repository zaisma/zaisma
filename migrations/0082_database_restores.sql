-- Restores of a game's database to an earlier time (docs/DECISIONS.md, "Every game gets a real database"):
-- each keeps Cloudflare's bookmark for the moment just before it, so it can be undone for 30 days.
CREATE TABLE database_restores (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  restore_to_at_ms INTEGER NOT NULL,
  undo_bookmark TEXT NOT NULL,          -- Cloudflare's bookmark for the moment just before this restore
  undoes_database_restore_id TEXT,      -- the restore this one undid; NULL for a restore to a time
  restored_at_ms INTEGER NOT NULL
);
CREATE INDEX database_restores_by_game ON database_restores(game_id, restored_at_ms);

-- erase_status gains erased: a player erased from a game's database, kept 31 days so a restore erases them again.
ALTER TABLE player_erases ADD COLUMN erased_at_ms INTEGER;
