-- Whether Zaisma erases a player who deletes their account from the game's database (docs/DECISIONS.md, "Deleting an account reaches developers").
ALTER TABLE games ADD COLUMN deleted_account_erase_enabled INTEGER NOT NULL DEFAULT 1;

-- Every game an account has played, kept until the account is deleted, so deleting it reaches each one (played keeps only the newest 20).
CREATE TABLE games_ever_played (
  account_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  first_played_at_ms INTEGER NOT NULL,
  PRIMARY KEY (account_id, game_id)
);
INSERT OR IGNORE INTO games_ever_played (account_id, game_id, first_played_at_ms) SELECT account_id, game_id, played_at_ms FROM played;
INSERT OR IGNORE INTO games_ever_played (account_id, game_id, first_played_at_ms) SELECT account_id, game_id, updated_at_ms FROM saves;

-- Erasing a deleted player from a game's database, tried again on the webhook schedule while it doesn't answer.
CREATE TABLE player_erases (
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  erase_status TEXT NOT NULL,          -- pending, failed
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at_ms INTEGER NOT NULL,
  failure_message TEXT,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (game_id, player_id)
);
CREATE INDEX player_erases_due ON player_erases(erase_status, next_attempt_at_ms);
