-- Rooms with players in them, kept up to date by each room as players come and go: for "playing
-- now" on game pages, and for room browsing (docs/DECISIONS.md), which shows only the listed ones.
-- Nothing about players: only how many there are.
CREATE TABLE live_rooms (
  game_id TEXT NOT NULL,
  code TEXT NOT NULL,
  players INTEGER NOT NULL,
  max_players INTEGER NOT NULL,
  -- 0: hidden by the game, or the game lists no rooms. Counted in "playing now", never listed.
  listed INTEGER NOT NULL DEFAULT 1,
  -- 0: closed, only players who were already in it can come back.
  open INTEGER NOT NULL DEFAULT 1,
  -- Where the room runs: the country and continent its first player connected from, like DE and EU.
  country TEXT,
  continent TEXT,
  created_at INTEGER NOT NULL,
  -- A room checks in every hour; rows older than two hours belong to rooms that stopped.
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, code)
);
CREATE INDEX live_rooms_updated ON live_rooms (updated_at);

-- Where a game's rooms are listed: page (the game page and inside the game), game (only inside the
-- game, through Zaisma.rooms.list) or off.
ALTER TABLE games ADD COLUMN room_browsing TEXT NOT NULL DEFAULT 'page';
