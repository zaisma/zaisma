-- Webhooks to the game server (docs/DECISIONS.md, "Webhooks to the game server"): a webhook can send
-- its events to the game's own game server on Zaisma (its onWebhook) instead of an https address.
-- destination_kind says which; endpoint_url is null for a game server, whose game is the one slug in
-- game_slugs. SQLite can't make a column nullable in place, so the table is made again with every row.

CREATE TABLE webhooks_rebuilt (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  destination_kind TEXT NOT NULL CHECK (destination_kind IN ('endpoint_url', 'game_server')),
  endpoint_url TEXT,
  event_kinds TEXT NOT NULL,
  game_slugs TEXT,
  signing_secret TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CHECK ((destination_kind = 'endpoint_url') = (endpoint_url IS NOT NULL))
);
INSERT INTO webhooks_rebuilt (id, owner_id, destination_kind, endpoint_url, event_kinds, game_slugs, signing_secret, created_at_ms, updated_at_ms)
  SELECT id, owner_id, 'endpoint_url', endpoint_url, event_kinds, game_slugs, signing_secret, created_at_ms, updated_at_ms FROM webhooks;
DROP TABLE webhooks;
ALTER TABLE webhooks_rebuilt RENAME TO webhooks;
CREATE INDEX webhooks_owner ON webhooks(owner_id);
