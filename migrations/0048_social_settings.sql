-- Social settings (docs/DECISIONS.md, "Social settings, with the social modes as presets"): who can do
-- what is six separate settings, and the three social modes are presets over them. The preset an account
-- is on is read from its settings (Custom when they match none), so social_mode goes.
--   who_can_chat, who_can_join, who_sees_playing_now, who_sees_played_games: nobody, friends or anyone
--   who_sees_online: nobody or friends (never anyone)
--   who_can_send_friend_requests: nobody (the page says "Invites only") or anyone
-- New columns start at the strictest preset, solo-focused; age limits are checked in packages/core.
ALTER TABLE accounts ADD COLUMN who_can_chat TEXT NOT NULL DEFAULT 'nobody' CHECK (who_can_chat IN ('nobody', 'friends', 'anyone'));
ALTER TABLE accounts ADD COLUMN who_can_join TEXT NOT NULL DEFAULT 'friends' CHECK (who_can_join IN ('nobody', 'friends', 'anyone'));
ALTER TABLE accounts ADD COLUMN who_sees_playing_now TEXT NOT NULL DEFAULT 'friends' CHECK (who_sees_playing_now IN ('nobody', 'friends', 'anyone'));
ALTER TABLE accounts ADD COLUMN who_sees_played_games TEXT NOT NULL DEFAULT 'friends' CHECK (who_sees_played_games IN ('nobody', 'friends', 'anyone'));
ALTER TABLE accounts ADD COLUMN who_sees_online TEXT NOT NULL DEFAULT 'friends' CHECK (who_sees_online IN ('nobody', 'friends'));
ALTER TABLE accounts ADD COLUMN who_can_send_friend_requests TEXT NOT NULL DEFAULT 'nobody' CHECK (who_can_send_friend_requests IN ('nobody', 'anyone'));

-- Each account keeps the preset it was on. Open and social opens joining and what they play to anyone only at 18+.
UPDATE accounts SET who_can_chat = 'friends' WHERE social_mode = 'friends_focused';
UPDATE accounts SET who_can_chat = 'anyone', who_can_send_friend_requests = 'anyone' WHERE social_mode = 'open_and_social' AND age_band != '13-15';
UPDATE accounts SET who_can_join = 'anyone', who_sees_playing_now = 'anyone', who_sees_played_games = 'anyone' WHERE social_mode = 'open_and_social' AND age_band = '18+';

ALTER TABLE accounts DROP COLUMN social_mode;
