-- Every Cloudflare charge on the meter: room_usage gains a column for each thing Cloudflare bills a game that it
-- didn't count yet, and loaded_versions keeps which game server versions were loaded on which day (one row each,
-- so a version loaded in many rooms counts once). Adds only; nothing is rebuilt, backfilled or deleted.

ALTER TABLE room_usage ADD COLUMN room_awake_duration_sec INTEGER NOT NULL DEFAULT 0;
ALTER TABLE room_usage ADD COLUMN room_connection_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE room_usage ADD COLUMN object_request_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE room_usage ADD COLUMN bookkeeping_written_row_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE room_usage ADD COLUMN game_server_startup_cpu_duration_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE room_usage ADD COLUMN outside_call_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE room_usage ADD COLUMN game_server_session_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE room_usage ADD COLUMN log_file_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE room_usage ADD COLUMN object_awake_duration_sec INTEGER NOT NULL DEFAULT 0;
ALTER TABLE room_usage ADD COLUMN database_call_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE room_usage ADD COLUMN database_awake_duration_sec INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS loaded_versions (
  game_id TEXT NOT NULL,
  date TEXT NOT NULL,
  version_id TEXT NOT NULL,
  PRIMARY KEY (game_id, date, version_id)
);
