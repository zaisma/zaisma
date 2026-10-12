-- Multiplayer. game_server: NULL (single-player), 'relay' or a built-in game server name.
-- connect_hosts: the game's own servers, one origin per line, set by an admin and listed on the game page.
ALTER TABLE games ADD COLUMN game_server TEXT;
ALTER TABLE games ADD COLUMN connect_hosts TEXT NOT NULL DEFAULT '';

-- Room usage per game per day, for cost targets and at-cost billing later. Nothing about players.
CREATE TABLE room_usage (
  game_id TEXT NOT NULL,
  day TEXT NOT NULL,
  rooms INTEGER NOT NULL DEFAULT 0,
  player_seconds INTEGER NOT NULL DEFAULT 0,
  messages INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, day)
);
