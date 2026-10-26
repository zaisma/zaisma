-- How many different players are playing a game now, for "playing now": a player who sits in two of
-- the game's rooms (maximumRoomCountPerPlayer above 1) counts once. The game's object keeps it from the
-- rooms' seats and writes it when it changes, and at least hourly while it's not zero. A missing or
-- older-than-two-hours row means listRooms adds up the rooms' counts as before.
CREATE TABLE live_games (
  game_id TEXT PRIMARY KEY,
  playing_player_count INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
