-- Friend requests in games (docs/DECISIONS.md, "Friend requests in games"): players send, accept and turn
-- down friend requests without leaving the game.

-- Friend requests gain a middle choice, People I play with (played_with): players who were in the same room
-- now or within the last hour. A CHECK can't widen in place, so the column is made again with three choices.
ALTER TABLE accounts ADD COLUMN who_can_send_friend_requests_choice TEXT NOT NULL DEFAULT 'nobody' CHECK (who_can_send_friend_requests_choice IN ('nobody', 'played_with', 'anyone'));
UPDATE accounts SET who_can_send_friend_requests_choice = who_can_send_friend_requests;
ALTER TABLE accounts DROP COLUMN who_can_send_friend_requests;
ALTER TABLE accounts RENAME COLUMN who_can_send_friend_requests_choice TO who_can_send_friend_requests;

-- Friends-focused takes friend requests from anyone at 16 and up: accounts on it keep the preset.
UPDATE accounts SET who_can_send_friend_requests = 'anyone'
WHERE age_band != '13-15' AND who_can_chat = 'friends' AND who_can_join = 'friends' AND who_sees_playing_now = 'friends'
  AND who_sees_played_games = 'friends' AND who_sees_online = 'friends' AND who_can_send_friend_requests = 'nobody' AND who_sees_profile = 'friends';

-- Until when an account's requests go nowhere, after most of its recent ones were turned down or left (null: they go).
ALTER TABLE accounts ADD COLUMN friend_requests_paused_until_ms INTEGER;

-- One request between two accounts at a time. Answered and run-out ones stay 37 days, for the 30 days after a
-- turn-down and for the pause, then go in the daily cleanup; all go with either account.
CREATE TABLE IF NOT EXISTS friend_requests (
  sender_account_id TEXT NOT NULL,
  recipient_account_id TEXT NOT NULL,
  -- The game it was sent from, null outside one.
  game_id TEXT,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  answer TEXT CHECK (answer IN ('accepted', 'turned_down')),
  answered_at_ms INTEGER,
  PRIMARY KEY (sender_account_id, recipient_account_id)
);
CREATE INDEX IF NOT EXISTS friend_requests_recipient ON friend_requests(recipient_account_id, expires_at_ms);
CREATE INDEX IF NOT EXISTS friend_requests_sender ON friend_requests(sender_account_id, created_at_ms);

-- Who was in which room lately, for People I play with: written beside room_players as players join and leave
-- (and hourly while they stay), kept an hour after they were last seen. server_url is null for a Zaisma room.
CREATE TABLE IF NOT EXISTS room_visits (
  game_id TEXT NOT NULL,
  room_code TEXT NOT NULL,
  server_url TEXT,
  player_id TEXT NOT NULL,
  last_seen_at_ms INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS room_visits_visit ON room_visits(game_id, room_code, player_id, coalesce(server_url, ''));
CREATE INDEX IF NOT EXISTS room_visits_player ON room_visits(player_id, last_seen_at_ms);
