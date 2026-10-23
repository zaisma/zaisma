-- Spectators (maximumSpectatorCount): how many are watching each live room, and how many it takes (0: watching is off).
-- The game page's Rooms tab and friends' Watch read them.
ALTER TABLE live_rooms ADD COLUMN spectator_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE live_rooms ADD COLUMN maximum_spectator_count INTEGER NOT NULL DEFAULT 0;
