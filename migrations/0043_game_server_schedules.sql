-- Game server schedules (docs/DECISIONS.md, "Game servers are full building blocks"): a game's own game
-- server runs on schedules, each a name and a cron in UTC, outside rooms and requests. Nothing about players.

-- The live version's schedules, as the game's object in the rooms Worker last read them, with when each
-- runs next and last ran, for the developer's stats. Written by that object only.
CREATE TABLE game_server_schedules (
  game_id TEXT NOT NULL,
  schedule_name TEXT NOT NULL,
  cron TEXT NOT NULL,
  version_id TEXT NOT NULL,
  next_run_at_ms INTEGER NOT NULL,
  last_run_at_ms INTEGER,
  PRIMARY KEY (game_id, schedule_name)
);

-- The live version whose schedules that object has read (NULL: none yet, or the game stopped being
-- playable). The rooms Worker's cron asks the object to read them again when the live version differs.
ALTER TABLE games ADD COLUMN game_server_schedules_version_id TEXT;

-- Scheduled runs a day, beside requests, for the developer's stats.
ALTER TABLE room_usage ADD COLUMN game_server_scheduled_run_count INTEGER NOT NULL DEFAULT 0;
