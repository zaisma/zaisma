-- The monthly credit plan: a developer's credit filled back to a level they pick on the 1st of every month, a
-- subscription they start once on Stripe's page, so Stripe stays the seller of every payment. One plan per owner, apart
-- from Zaisma Pro. Every column is null with no plan; an ended plan keeps credit_plan_event_at_ms, so a late event of
-- the ended subscription can't start it again. Deletes nothing.

ALTER TABLE owners ADD COLUMN credit_plan_subscription_id TEXT;
ALTER TABLE owners ADD COLUMN credit_plan_refill_level_cents INTEGER;
ALTER TABLE owners ADD COLUMN credit_plan_status TEXT CHECK (credit_plan_status IN ('running', 'payment_failing'));
ALTER TABLE owners ADD COLUMN credit_plan_started_at_ms INTEGER;
ALTER TABLE owners ADD COLUMN credit_plan_event_at_ms INTEGER;

-- A raise of the plan's level is a spending request too. SQLite can't change a CHECK, so the table is made again, as
-- 0181 made it, with the new kind and its column, and every row copied over.
CREATE TABLE spending_requests_new (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  request_kind TEXT NOT NULL CHECK (request_kind IN ('game_budget', 'credit_plan_refill_level')),
  game_id TEXT,
  monthly_budget_cents INTEGER,
  refill_level_cents INTEGER,
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
