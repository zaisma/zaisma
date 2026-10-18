-- The security log (docs/DECISIONS.md, "The security log says who did what from where"): the account's sign-ins on
-- new devices and changes to how it signs in, and what developers and their keys do to their games, each with
-- who did it and from where. Places are fingerprints of a key's network and country, so "new place" works
-- without keeping where a key went. Nothing is copied from audit_log.
CREATE TABLE security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  game_id TEXT,
  kind TEXT NOT NULL,
  done_by TEXT NOT NULL,
  api_key_id TEXT,
  api_key_name TEXT,
  sign_in_kind TEXT,
  version_id TEXT,
  subject_name TEXT,
  device TEXT,
  network_name TEXT,
  city_name TEXT,
  region_name TEXT,
  country_code TEXT,
  connection_address TEXT,
  is_new_place INTEGER NOT NULL DEFAULT 0,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  fold_key TEXT UNIQUE,
  happened_at_ms INTEGER NOT NULL,
  last_happened_at_ms INTEGER NOT NULL
);
CREATE INDEX security_events_by_account ON security_events (account_id, happened_at_ms);
CREATE INDEX security_events_by_game ON security_events (game_id, happened_at_ms);
CREATE INDEX security_events_by_time ON security_events (happened_at_ms);
CREATE TABLE security_places (
  account_id TEXT NOT NULL,
  api_key_id TEXT NOT NULL,
  place_sha256 TEXT NOT NULL,
  first_seen_at_ms INTEGER NOT NULL,
  last_seen_at_ms INTEGER NOT NULL,
  game_event_logged_at_ms INTEGER,
  PRIMARY KEY (api_key_id, place_sha256)
);
CREATE INDEX security_places_by_account ON security_places (account_id);
ALTER TABLE accounts ADD COLUMN where_used_from_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE api_keys ADD COLUMN last_place_sha256 TEXT;
ALTER TABLE api_keys ADD COLUMN mcp_first_used_at_ms INTEGER;
