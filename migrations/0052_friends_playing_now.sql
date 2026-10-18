-- Friends playing now (docs/DECISIONS.md, "What friends see of each other"): which friends have
-- zaisma.com open, what they're playing, and the room to join them in.

-- An account with zaisma.com open: its pages check in every couple of minutes while one is on screen
-- (seen_at_ms), and a game page where Play was pressed says which game (game_id, and game_seen_at_ms
-- when it last said so; both null once the player leaves the game). One row per account, overwritten,
-- so nothing older is kept; deleted with the account, and after a day without a check-in.
CREATE TABLE presences (
  account_id TEXT PRIMARY KEY,
  seen_at_ms INTEGER NOT NULL,
  game_id TEXT,
  game_seen_at_ms INTEGER
);

-- Accounts in Zaisma rooms, kept by each room as they come and go, so Join can take a friend to
-- the room they're in. Guests are never here. A room checks in every hour (updated_at_ms), like its
-- live_rooms row; rows of rooms that stopped without saying so are skipped and cleared daily.
CREATE TABLE room_players (
  game_id TEXT NOT NULL,
  room_code TEXT NOT NULL,
  player_id TEXT NOT NULL,
  joined_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (game_id, room_code, player_id)
);
CREATE INDEX room_players_player ON room_players(player_id);

-- Appear offline on /friends: hides the player from Online and Playing now for everyone.
ALTER TABLE accounts ADD COLUMN is_appearing_offline INTEGER NOT NULL DEFAULT 0;
