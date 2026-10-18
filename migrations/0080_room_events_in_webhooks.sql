-- When a game server error's game_server_error_found event went to webhooks (or was skipped past the day's cap); NULL until then.
ALTER TABLE game_server_errors ADD COLUMN told_webhooks_at_ms INTEGER;
-- Errors from before this are old news: never sent.
UPDATE game_server_errors SET told_webhooks_at_ms = last_at_ms;
CREATE INDEX game_server_errors_untold ON game_server_errors(first_at_ms) WHERE told_webhooks_at_ms IS NULL;
CREATE INDEX game_server_errors_told ON game_server_errors(game_id, told_webhooks_at_ms);

-- A free-use alert a game reached this month, once per kind, for its alert_raised event. Kept 90 days.
CREATE TABLE alert_notices (
  game_id TEXT NOT NULL,
  alert_kind TEXT NOT NULL CHECK (alert_kind IN ('rooms_nearly_paused', 'rooms_paused', 'requests_nearly_paused', 'requests_paused', 'database_nearly_paused', 'database_paused', 'database_writes_nearly_paused', 'database_writes_paused', 'database_nearly_full', 'database_full')),
  month_start_date TEXT NOT NULL,
  noticed_at_ms INTEGER NOT NULL,
  told_webhooks_at_ms INTEGER,
  PRIMARY KEY (game_id, alert_kind, month_start_date)
);
CREATE INDEX alert_notices_untold ON alert_notices(noticed_at_ms) WHERE told_webhooks_at_ms IS NULL;
