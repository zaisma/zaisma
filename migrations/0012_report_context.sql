-- Reports say what they're about, never who sent them: the version that was playing, the room, and
-- for a report about a player, that player's temporary ID and name and what they did.
ALTER TABLE reports ADD COLUMN version_id TEXT;
ALTER TABLE reports ADD COLUMN room_code TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN player_id TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN player_name TEXT NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN player_reason TEXT NOT NULL DEFAULT '';
-- A picture of the game the player chose to include (kept in R2 at report-pictures/<id>.jpg), and when
-- the report was closed: pictures are deleted 30 days after that.
ALTER TABLE reports ADD COLUMN picture INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reports ADD COLUMN closed_at INTEGER;
-- Child-safety and illegal-content reports, before a person looks (docs/DECISIONS.md): report_held_at is
-- when a report paused this version (players went back to the version before it, or the new game was
-- hidden); cleared_at is when it stopped being touched by reports: a person checked it, or a report
-- already went back to it.
ALTER TABLE versions ADD COLUMN report_held_at INTEGER;
ALTER TABLE versions ADD COLUMN cleared_at INTEGER;
