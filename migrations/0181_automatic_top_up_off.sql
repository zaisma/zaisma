-- Automatic top-up is gone (docs/DECISIONS.md, "No automatic top-ups at launch; every sale stays Stripe's"): credit only
-- comes in through Stripe's page, so no card is kept and nothing charges one in the background. Deletes the saved
-- cards' IDs, the automatic top-up settings, the automatic flag on credit entries, the waiting or answered automatic
-- top-up spending requests and the security log's automatic_top_up_changed events; nothing else. spending_requests is
-- rebuilt the way 0128 rebuilt alert_notices.

ALTER TABLE owners DROP COLUMN stripe_payment_method_id;
ALTER TABLE owners DROP COLUMN automatic_top_up_enabled;
ALTER TABLE owners DROP COLUMN top_up_below_cents;
ALTER TABLE owners DROP COLUMN top_up_amount_cents;
ALTER TABLE owners DROP COLUMN monthly_top_up_limit_cents;
ALTER TABLE owners DROP COLUMN automatic_top_up_attempt_count;
ALTER TABLE owners DROP COLUMN automatic_top_up_enabled_at_ms;

ALTER TABLE credit_entries DROP COLUMN is_automatic;

-- Spending requests are only a game's budget now. SQLite can't change a CHECK, so the table is made again with the
-- budget's columns and every game_budget row copied over.
DELETE FROM spending_requests WHERE request_kind = 'automatic_top_up';
CREATE TABLE spending_requests_new (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  request_kind TEXT NOT NULL CHECK (request_kind IN ('game_budget')),
  game_id TEXT,
  monthly_budget_cents INTEGER,
  request_status TEXT NOT NULL DEFAULT 'waiting' CHECK (request_status IN ('waiting', 'approved', 'declined')),
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  answered_at_ms INTEGER
);
INSERT INTO spending_requests_new (id, account_id, request_kind, game_id, monthly_budget_cents, request_status, created_at_ms, expires_at_ms, answered_at_ms)
  SELECT id, account_id, request_kind, game_id, monthly_budget_cents, request_status, created_at_ms, expires_at_ms, answered_at_ms FROM spending_requests;
DROP TABLE spending_requests;
ALTER TABLE spending_requests_new RENAME TO spending_requests;
CREATE INDEX spending_requests_by_account ON spending_requests (account_id, request_status);

DELETE FROM security_events WHERE kind = 'automatic_top_up_changed';
