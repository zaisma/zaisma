-- How a game's own game server (run in our sandbox) is doing, so its developer can see errors and
-- wasted work. Counts per day beside room use; nothing about players.
ALTER TABLE room_usage ADD COLUMN server_calls INTEGER NOT NULL DEFAULT 0;
-- Handlers that threw an error (that call lost, the room carried on).
ALTER TABLE room_usage ADD COLUMN server_crashes INTEGER NOT NULL DEFAULT 0;
-- Calls Cloudflare stopped for running too long (a loop that never ends, about 2 seconds of CPU each).
ALTER TABLE room_usage ADD COLUMN server_stops INTEGER NOT NULL DEFAULT 0;
-- Matches ended because the game server kept being stopped.
ALTER TABLE room_usage ADD COLUMN server_broken_rooms INTEGER NOT NULL DEFAULT 0;

-- The game server's distinct errors, per version, with how often and when. Kept 30 days.
CREATE TABLE game_server_errors (
  game_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('crash', 'stopped')),
  message TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, version_id, kind, message)
);
CREATE INDEX game_server_errors_recent ON game_server_errors(game_id, last_at);
