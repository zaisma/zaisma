-- Recently played, for signed-in players, so Continue playing follows them to any device.
-- One row per account and game: when they last pressed Play. Guests keep theirs in their own browser.
CREATE TABLE played (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  game_id TEXT NOT NULL REFERENCES games(id),
  at INTEGER NOT NULL,
  PRIMARY KEY (account_id, game_id)
);
CREATE INDEX played_recent ON played(account_id, at);
