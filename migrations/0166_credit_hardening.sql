-- The hosting meter and credit keep their promises. Owners keep the credit-low line set at each top-up (20% of the
-- balance right after it; null until the first top-up after this), and their automatic top-up attempts and when it
-- was last turned on, for a Stripe key that's new with every attempt. A refund that fails when an account is deleted
-- waits in pending_refunds, holding no account, until Stripe takes it; relay_reads rotates the relay's reads so every
-- game's is read hourly. alert_notices gains the credit_low kind and alert_subject (what a notice is about: a pause's
-- moment, a budget, a credit-low warning), so a second pause in a month is told too; health_alerts gains
-- refunds_stuck. SQLite can't change a CHECK, so those two are made again with every row copied over, as 0128 did.

ALTER TABLE owners ADD COLUMN credit_low_line_cents INTEGER;
ALTER TABLE owners ADD COLUMN automatic_top_up_attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE owners ADD COLUMN automatic_top_up_enabled_at_ms INTEGER;

CREATE TABLE IF NOT EXISTS pending_refunds (
  id TEXT PRIMARY KEY,
  stripe_payment_intent_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  last_tried_at_ms INTEGER,
  try_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS relay_reads (
  game_id TEXT PRIMARY KEY,
  read_at_ms INTEGER NOT NULL
);

CREATE TABLE alert_notices_new (
  game_id TEXT NOT NULL,
  alert_kind TEXT NOT NULL CHECK (alert_kind IN ('hosting_nearly_paused', 'hosting_budget_nearly_used', 'hosting_paused', 'credit_low', 'database_nearly_full', 'database_full', 'rooms_nearly_paused', 'rooms_paused', 'requests_nearly_paused', 'requests_paused', 'database_nearly_paused', 'database_paused', 'database_writes_nearly_paused', 'database_writes_paused')),
  month_start_date TEXT NOT NULL,
  alert_subject TEXT NOT NULL DEFAULT '',
  noticed_at_ms INTEGER NOT NULL,
  told_webhooks_at_ms INTEGER,
  PRIMARY KEY (game_id, alert_kind, month_start_date, alert_subject)
);
INSERT INTO alert_notices_new (game_id, alert_kind, month_start_date, noticed_at_ms, told_webhooks_at_ms)
  SELECT game_id, alert_kind, month_start_date, noticed_at_ms, told_webhooks_at_ms FROM alert_notices;
DROP TABLE alert_notices;
ALTER TABLE alert_notices_new RENAME TO alert_notices;
CREATE INDEX alert_notices_untold ON alert_notices(noticed_at_ms) WHERE told_webhooks_at_ms IS NULL;

CREATE TABLE health_alerts_new (
  health_alert_kind TEXT PRIMARY KEY CHECK (health_alert_kind IN ('scans_behind', 'errors_spiking', 'watcher_silent', 'refunds_stuck')),
  started_at_ms INTEGER NOT NULL,
  last_told_at_ms INTEGER NOT NULL
);
INSERT INTO health_alerts_new (health_alert_kind, started_at_ms, last_told_at_ms) SELECT health_alert_kind, started_at_ms, last_told_at_ms FROM health_alerts;
DROP TABLE health_alerts;
ALTER TABLE health_alerts_new RENAME TO health_alerts;
