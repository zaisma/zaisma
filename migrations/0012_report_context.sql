-- Reports say what they're about, never who sent them: the version that was playing, the room, and
-- for a report about a player, that player's temporary ID and name and what they did.
ALTER TABLE reports ADD COLUMN version_id TEXT;
ALTER TABLE reports ADD COLUMN room_code TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN player_id TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN player_name TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN player_reason TEXT NOT NULL DEFAULT '';
