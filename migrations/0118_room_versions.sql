-- The version a room's sandboxed game server runs, so the game domain serves that version's files to the
-- room's players while it runs it (a room on an older version after a next_match publish). NULL for built-in
-- game servers and rooms that haven't checked in since: those count as running the live version.
ALTER TABLE live_rooms ADD COLUMN version_id TEXT;
