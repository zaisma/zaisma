-- A game server's logs live in the game files bucket under logs/<game_id>/, one file per write
-- (docs/DEVELOPER-API.md, "A game server's logs"). This records which UTC days a game has logs, so
-- the daily cleanup deletes the days past 30 and a deleted game's logs go with it.
CREATE TABLE game_log_days (
  game_id TEXT NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (game_id, day)
);

-- When someone last read the game's logs (get_logs, zaisma logs): its game servers write their lines
-- every 2 seconds for the next 10 minutes instead of every 30.
ALTER TABLE games ADD COLUMN logs_read_at_ms INTEGER;
