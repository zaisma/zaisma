-- Favorite games and the whole played history, for Your games (docs/DECISIONS.md "Your games is your games", "Favorites").
-- A player's favorites are their own: the developer reads only how many (stats' favorite_count), never who. Adds only;
-- safe to run twice (IF NOT EXISTS, INSERT OR IGNORE).
CREATE TABLE IF NOT EXISTS favorite_games (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  game_id TEXT NOT NULL REFERENCES games(id),
  favorited_at_ms INTEGER NOT NULL,
  PRIMARY KEY (account_id, game_id)
);
CREATE INDEX IF NOT EXISTS favorite_games_by_game ON favorite_games(game_id);

-- played now keeps every game an account played (All you've played), no longer the newest 20: games trimmed before come back
-- with the day they were first played.
INSERT OR IGNORE INTO played (account_id, game_id, played_at_ms)
  SELECT account_id, game_id, first_played_at_ms FROM games_ever_played;
