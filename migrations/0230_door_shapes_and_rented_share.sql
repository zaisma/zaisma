-- Answers cut to what their doors declare, one row a door a day: only a field's path, never its value. The site's job says so once.
CREATE TABLE door_answer_cuts (
  door_id TEXT NOT NULL,
  date TEXT NOT NULL,
  field_paths TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  first_cut_at_ms INTEGER NOT NULL,
  alerted_at_ms INTEGER,
  PRIMARY KEY (door_id, date)
);

-- A game's hours by where its players came from, and what the traffic on rented networks used on the meter.
ALTER TABLE room_usage ADD COLUMN new_player_room_play_duration_sec INTEGER NOT NULL DEFAULT 0;
ALTER TABLE room_usage ADD COLUMN rented_network_room_play_duration_sec INTEGER NOT NULL DEFAULT 0;
ALTER TABLE room_usage ADD COLUMN rented_share_room_use_cents REAL NOT NULL DEFAULT 0;
ALTER TABLE room_usage ADD COLUMN rented_share_request_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE room_usage ADD COLUMN rented_share_relay_credential_count INTEGER NOT NULL DEFAULT 0;

-- The share's own use this month, and when it ran out.
ALTER TABLE game_hosting_months ADD COLUMN rented_share_used_cents REAL NOT NULL DEFAULT 0;
ALTER TABLE game_hosting_months ADD COLUMN rented_share_stopped_at_ms INTEGER;

-- A key made for a browser whose signed first play counts: 1 when it played this game before.
ALTER TABLE room_keys ADD COLUMN is_returning_browser INTEGER NOT NULL DEFAULT 0;
