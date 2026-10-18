-- Social modes and age bands (docs/DECISIONS.md, "Social modes decide who can talk to whom"): three
-- age bands instead of two, and every account has a social mode that decides who it can chat with.
--   age_band: 13-15, 16-17 or 18+. An account made before the split (13-17) becomes 13-15, the
--     strictest, until the player gives their birth date again on the account page.
--   social_mode: solo_focused (no chat), friends_focused (friends only) or open_and_social (anyone in
--     the same band group). 13-15 start solo_focused and can only move to friends_focused; everyone
--     else starts friends_focused.
-- SQLite can't change a CHECK, and rebuilding accounts would trip the foreign keys of every table that
-- points at it, so the band moves to a new column with the new CHECK, which then takes the old name.
-- The defaults only fill existing rows; new accounts always say both.
ALTER TABLE accounts ADD COLUMN age_band_three TEXT NOT NULL DEFAULT '13-15' CHECK (age_band_three IN ('13-15', '16-17', '18+'));
UPDATE accounts SET age_band_three = CASE age_band WHEN '18+' THEN '18+' ELSE '13-15' END;
ALTER TABLE accounts DROP COLUMN age_band;
ALTER TABLE accounts RENAME COLUMN age_band_three TO age_band;

ALTER TABLE accounts ADD COLUMN social_mode TEXT NOT NULL DEFAULT 'solo_focused' CHECK (social_mode IN ('solo_focused', 'friends_focused', 'open_and_social'));
UPDATE accounts SET social_mode = 'friends_focused' WHERE age_band != '13-15';
