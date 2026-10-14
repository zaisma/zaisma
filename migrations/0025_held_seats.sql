-- Seats a room holds for players out of the match for now (they walked away or lost their connection)
-- and players another room is sending there (docs/DECISIONS.md). They aren't counted as playing, but
-- a room is full once its players and held seats reach its most players.
ALTER TABLE live_rooms ADD COLUMN held INTEGER NOT NULL DEFAULT 0;
