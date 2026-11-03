-- Secrets kept in the database, sealed with a key the database never holds (packages/core/src/sealed-secrets.ts).
-- A webhook's signing secret and a tester link's token get a sealed column, and a tester link a SHA-256 to find it
-- by from its URL. The plain columns can be null now: the site's cron seals each row and empties its plain value,
-- since only a Worker holds the key. SQLite can't make a column nullable in place, so both tables are made again
-- with every row.

CREATE TABLE webhooks_rebuilt (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  destination_kind TEXT NOT NULL CHECK (destination_kind IN ('endpoint_url', 'game_server')),
  endpoint_url TEXT,
  event_kinds TEXT NOT NULL,
  game_slugs TEXT,
  signing_secret TEXT,
  sealed_signing_secret TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CHECK ((destination_kind = 'endpoint_url') = (endpoint_url IS NOT NULL))
);
INSERT INTO webhooks_rebuilt (id, owner_id, destination_kind, endpoint_url, event_kinds, game_slugs, signing_secret, created_at_ms, updated_at_ms)
  SELECT id, owner_id, destination_kind, endpoint_url, event_kinds, game_slugs, signing_secret, created_at_ms, updated_at_ms FROM webhooks;
DROP TABLE webhooks;
ALTER TABLE webhooks_rebuilt RENAME TO webhooks;
CREATE INDEX webhooks_owner ON webhooks(owner_id);

CREATE TABLE tester_links_rebuilt (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  name TEXT NOT NULL,
  token TEXT UNIQUE,
  token_sha256 TEXT UNIQUE,
  sealed_token TEXT,
  created_at_ms INTEGER NOT NULL,
  last_opened_at_ms INTEGER,
  revoked_at_ms INTEGER,
  version_choice TEXT NOT NULL DEFAULT 'live' CHECK (version_choice IN ('live', 'newest_passed', 'picked')),
  picked_version_id TEXT,
  ends_at_ms INTEGER
);
INSERT INTO tester_links_rebuilt (id, game_id, name, token, created_at_ms, last_opened_at_ms, revoked_at_ms, version_choice, picked_version_id, ends_at_ms)
  SELECT id, game_id, name, token, created_at_ms, last_opened_at_ms, revoked_at_ms, version_choice, picked_version_id, ends_at_ms FROM tester_links;
DROP TABLE tester_links;
ALTER TABLE tester_links_rebuilt RENAME TO tester_links;
CREATE INDEX tester_links_game ON tester_links (game_id, revoked_at_ms);
