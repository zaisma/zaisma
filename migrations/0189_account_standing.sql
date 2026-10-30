-- Account standing (packages/core/src/standing.ts): what an account has earned, from plain facts.
-- game_returning_players: each signed-in player whose play counted on a game, and on how many different days.
CREATE TABLE IF NOT EXISTS game_returning_players (
  game_id TEXT NOT NULL REFERENCES games(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  first_counted_date TEXT NOT NULL,
  last_counted_date TEXT NOT NULL,
  counted_day_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (game_id, account_id)
);
CREATE INDEX IF NOT EXISTS game_returning_players_by_account ON game_returning_players(account_id);

-- The days a player's plays counted on any game, so a player earns standing by playing.
ALTER TABLE accounts ADD COLUMN counted_play_day_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN last_counted_play_date TEXT;

-- A developer's standing: the last ruling against it (a rejected version or a game taken down), its returning
-- players and whether it's established, as the daily check (apps/site/src/standing.ts) counted them, and whether
-- it's one of Zaisma's own accounts, established by a flag.
ALTER TABLE owners ADD COLUMN last_ruling_at_ms INTEGER;
ALTER TABLE owners ADD COLUMN returning_player_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE owners ADD COLUMN is_established INTEGER NOT NULL DEFAULT 0;
ALTER TABLE owners ADD COLUMN standing_checked_at_ms INTEGER;
ALTER TABLE owners ADD COLUMN is_zaisma_account INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS owners_by_standing_checked ON owners(standing_checked_at_ms);
