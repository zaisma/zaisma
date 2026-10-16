-- Webhooks for developers (docs/DECISIONS.md, "Developers hold the keys" and "Webhooks follow Standard
-- Webhooks"): a developer's address that Zaisma sends signed events to, and each event sent to it.

-- One address and the events it takes. event_kinds is a JSON list of kinds; game_slugs a JSON list of
-- the owner's games, or NULL for every game they have and will make. The signing secret has to be kept
-- as it is to sign with, so it's answered only when made or replaced, never listed.
CREATE TABLE webhooks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  event_kinds TEXT NOT NULL,
  game_slugs TEXT,
  signing_secret TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX webhooks_owner ON webhooks(owner_id);

-- An event on its way to one webhook, and how it went: pending until it's delivered (a 2xx answer) or
-- has failed every try. event_json is the body exactly as sent, so every try signs the same bytes.
-- Kept 30 days, so the developer and their AI can see what was sent and why it failed.
CREATE TABLE webhook_deliveries (
  webhook_id TEXT NOT NULL,
  webhook_event_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  event_json TEXT NOT NULL,
  delivery_status TEXT NOT NULL CHECK (delivery_status IN ('pending', 'delivered', 'failed')),
  attempt_count INTEGER NOT NULL,
  next_attempt_at_ms INTEGER,
  last_attempt_at_ms INTEGER,
  last_http_status_code INTEGER,
  failure_message TEXT,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (webhook_id, webhook_event_id)
);
CREATE INDEX webhook_deliveries_due ON webhook_deliveries(delivery_status, next_attempt_at_ms);
CREATE INDEX webhook_deliveries_webhook ON webhook_deliveries(webhook_id, created_at_ms);
