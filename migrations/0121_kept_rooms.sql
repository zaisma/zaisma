-- Rooms a game server keeps (room.setKept): when everyone leaves, the room sleeps with its world saved
-- instead of ending a day later, and wakes when someone joins. One row a kept room, so the developer
-- can list and delete them, and so their saved size counts towards the game's storage with its database.
-- saved_size_bytes is written as the room empties, and at most hourly while players are in it.
CREATE TABLE kept_rooms (
  game_id TEXT NOT NULL,
  room_code TEXT NOT NULL,
  name TEXT,
  saved_size_bytes INTEGER NOT NULL DEFAULT 0,
  saved_at_ms INTEGER,
  last_played_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (game_id, room_code)
);

-- A listed kept room keeps its row with nobody in it, so the Rooms tab shows it like a server waiting.
ALTER TABLE live_rooms ADD COLUMN is_kept INTEGER NOT NULL DEFAULT 0;
