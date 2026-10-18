-- Profiles (docs/DECISIONS.md, "What a profile shows"): zaisma.com/@username, with a name, a short bio
-- and links the player chooses to show, behind a new social setting, who sees my profile.

-- What the owner wrote. Others see it only once profile_check_status is passed: names and bios are
-- checked like forum posts, so contact details and "add me on…" never show.
--   display_name: the name shown beside @username, or NULL to show the username
--   bio: a few lines about them, or NULL
--   link_urls: up to 3 https links, one per line ('' for none); shown only on 18+ profiles
ALTER TABLE accounts ADD COLUMN display_name TEXT;
ALTER TABLE accounts ADD COLUMN bio TEXT;
ALTER TABLE accounts ADD COLUMN link_urls TEXT NOT NULL DEFAULT '';
-- The check on what the owner wrote: pending until the AI (or a person) looks, passed, or held for a
-- person, with why. NULL while there's nothing to check.
ALTER TABLE accounts ADD COLUMN profile_check_status TEXT CHECK (profile_check_status IN ('pending', 'passed', 'held'));
ALTER TABLE accounts ADD COLUMN profile_held_reason TEXT;
ALTER TABLE accounts ADD COLUMN profile_check_attempt_count INTEGER NOT NULL DEFAULT 0;
CREATE INDEX accounts_profile_check ON accounts(profile_check_status) WHERE profile_check_status IN ('pending', 'held');

-- Who gets past a profile's header: friends, or anyone. Friends in the solo-focused and friends-focused
-- presets, anyone in open and social, so accounts on open and social keep their preset.
ALTER TABLE accounts ADD COLUMN who_sees_profile TEXT NOT NULL DEFAULT 'friends' CHECK (who_sees_profile IN ('friends', 'anyone'));
UPDATE accounts SET who_sees_profile = 'anyone'
WHERE who_can_chat = 'anyone' AND who_can_send_friend_requests = 'anyone' AND who_sees_online = 'friends'
  AND ((age_band = '18+' AND who_can_join = 'anyone' AND who_sees_playing_now = 'anyone' AND who_sees_played_games = 'anyone')
    OR (age_band = '16-17' AND who_can_join = 'friends' AND who_sees_playing_now = 'friends' AND who_sees_played_games = 'friends'));

-- A signed-in player's report of a profile: one per reporter, kept until a person decides. The profile's
-- words are hidden once a few players report them, or at once when it puts a young person at risk.
CREATE TABLE profile_reports (
  account_id TEXT NOT NULL,
  reporter_account_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  details TEXT,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (account_id, reporter_account_id)
);
