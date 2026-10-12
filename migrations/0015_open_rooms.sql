-- Room browsing (docs/DECISIONS.md): the rooms players can find on a game's page and inside the game.
-- One row per listed room with players in it, kept up to date by the room itself as players come and
-- go. Hidden rooms have no row. Nothing about players: only how many there are.
CREATE TABLE open_rooms (
  game_id TEXT NOT NULL,
  code TEXT NOT NULL,
  players INTEGER NOT NULL,
  max_players INTEGER NOT NULL,
  -- 0: closed, only players who were already in it can come back.
  open INTEGER NOT NULL DEFAULT 1,
  -- The continent the room runs in (where its first player connected from), like EU.
  location TEXT,
  created_at INTEGER NOT NULL,
  -- A listed room checks in every hour; rows older than two hours belong to rooms that stopped.
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, code)
);
CREATE INDEX open_rooms_updated ON open_rooms (updated_at);

-- Where a game's rooms are listed: page (the game page and inside the game), game (only inside the
-- game, through Zaisma.rooms.list) or off.
ALTER TABLE games ADD COLUMN room_browsing TEXT NOT NULL DEFAULT 'page';
