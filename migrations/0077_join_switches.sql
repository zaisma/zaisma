-- The game's say over Join ("How the game's Join switches work" in docs/DECISIONS.md): off for the whole game
-- (games.friend_joins_enabled) or for one room (live_rooms for Zaisma rooms, room_players for a room on the game's
-- own servers). And when a player last came into one of a game's rooms through quickJoin, so its Rooms tab says
-- "Press Play and the game finds you one" only when that's true. Adds only; every game and room keeps taking Join.
ALTER TABLE games ADD COLUMN friend_joins_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE games ADD COLUMN quick_joined_at_ms INTEGER;
ALTER TABLE live_rooms ADD COLUMN friend_joins_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE room_players ADD COLUMN friend_joins_enabled INTEGER NOT NULL DEFAULT 1;
