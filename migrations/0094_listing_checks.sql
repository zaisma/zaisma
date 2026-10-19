-- No slop: an AI check holds covers, screenshots and titles to strict lines ("No slop" in docs/DECISIONS.md).
-- A picture or title that breaks one carries why, and the game is kept off every list until it's fixed.

-- Why this picture keeps the game off lists (or, for fake_reward, held it), as JSON (a ReviewReason); NULL when none.
ALTER TABLE game_images ADD COLUMN listing_reason TEXT;
-- When a person cleared the picture: the check leaves it alone after.
ALTER TABLE game_images ADD COLUMN cleared_at_ms INTEGER;

-- Why the title keeps the game off lists, as JSON (a ReviewReason); NULL when none.
ALTER TABLE games ADD COLUMN title_listing_reason TEXT;
-- The title a person cleared: the check leaves the title alone while it's this.
ALTER TABLE games ADD COLUMN cleared_title TEXT;
-- When a change last asked for the check, and when it last ran.
ALTER TABLE games ADD COLUMN listing_check_requested_at_ms INTEGER;
ALTER TABLE games ADD COLUMN listing_checked_at_ms INTEGER;

-- Every game that isn't taken down is checked once. Pictures a person already approved stay approved, and only gain a listing_reason.
UPDATE games SET listing_check_requested_at_ms = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE review_status != 'removed';
CREATE INDEX games_listing_check ON games(listing_check_requested_at_ms);
