-- Cloud saves: a signed-in player's copy of a game's browser saves. The data itself is
-- in R2 (zaisma-saves); this row is the version used to catch saves from two devices at once.
CREATE TABLE saves (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  game_id TEXT NOT NULL REFERENCES games(id),
  version INTEGER NOT NULL,
  hash TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, game_id)
);

-- Games that keep their own saves can turn cloud saves off.
ALTER TABLE games ADD COLUMN cloud_saves INTEGER NOT NULL DEFAULT 1;
