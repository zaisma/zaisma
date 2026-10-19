-- Deleting an account deletes its games (docs/DECISIONS.md, "Making an account takes a birthday, a username and a password, nothing else").

-- A deleted game's link name, never given to another game: its page, its subdomain and its rooms stay its own.
CREATE TABLE retired_game_slugs (
  slug TEXT PRIMARY KEY,
  retired_at_ms INTEGER NOT NULL
);

-- A game whose files, database, secrets, game server storage and players' saves are being deleted, a step
-- at a time, tried again while something doesn't answer. The row goes with the game's last rows.
CREATE TABLE game_deletions (
  game_id TEXT PRIMARY KEY,
  requested_by_kind TEXT NOT NULL,     -- account_deleted, zaisma
  deletion_status TEXT NOT NULL,       -- pending
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at_ms INTEGER NOT NULL,
  failure_message TEXT,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX game_deletions_due ON game_deletions(deletion_status, next_attempt_at_ms);
