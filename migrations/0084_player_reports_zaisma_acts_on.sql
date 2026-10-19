-- A player report Zaisma passed to the game's developer (get_reports' player_reports and the player_reported event), and when.
ALTER TABLE reports ADD COLUMN is_passed_to_developer INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reports ADD COLUMN passed_to_developer_at_ms INTEGER;
-- 1 when the signed-in reporter and the reported account had a block between them when it was sent. Nothing else about the reporter is kept.
ALTER TABLE reports ADD COLUMN has_block_between INTEGER NOT NULL DEFAULT 0;
CREATE INDEX reports_passed_to_developer ON reports(game_id, passed_to_developer_at_ms) WHERE is_passed_to_developer = 1;

-- When a person turned off the account's social side for good after a report, and which kind of report (a PLAYER_REPORT_REASONS key).
ALTER TABLE accounts ADD COLUMN social_stopped_at_ms INTEGER;
ALTER TABLE accounts ADD COLUMN social_stopped_reason TEXT;

-- The old reason, split in two: what was reported under it was threats.
UPDATE reports SET player_reason = 'real_life_threat' WHERE player_reason = 'threats_or_private_details';
