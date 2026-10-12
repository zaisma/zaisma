-- Earlier versions of cloud saves, so lost progress can be brought back. The data is in R2
-- next to the save (zaisma-saves, <account>/<game>/<id>.json); this row says when and why.
CREATE TABLE save_history (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  game_id TEXT NOT NULL REFERENCES games(id),
  -- when this progress was saved, and why we kept a copy: hourly, replaced, smaller, restore or device
  at INTEGER NOT NULL,
  reason TEXT NOT NULL,
  hash TEXT NOT NULL,
  bytes INTEGER NOT NULL
);
CREATE INDEX save_history_by_game ON save_history (account_id, game_id, at);
