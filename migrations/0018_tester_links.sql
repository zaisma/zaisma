-- Tester links (docs/DECISIONS.md): secret links a developer makes, names and can turn off, one per
-- group (team, playtesters, a streamer). Each opens the game's live version whatever its
-- visibility, for guests too. A turned-off link keeps its row, so its token is never reused.
CREATE TABLE tester_links (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  name TEXT NOT NULL,
  -- 20 lowercase letters and digits: the game opens at <slug>--<token> on the game domain.
  token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  -- When someone last opened it, at most once an hour.
  opened_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX tester_links_game ON tester_links (game_id, revoked_at);
