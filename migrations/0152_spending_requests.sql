-- Spending requests: when an API key or an AI app asks to turn spending on or up (a game's first or higher budget,
-- automatic top-up on or higher), Zaisma keeps the exact change so the developer approves or declines it on
-- zaisma.com with a passkey tap, and the AI can check the answer. Adds only; nothing is rebuilt or deleted.

CREATE TABLE spending_requests (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  request_kind TEXT NOT NULL CHECK (request_kind IN ('game_budget', 'automatic_top_up')),
  game_id TEXT,
  monthly_budget_cents INTEGER,
  is_automatic_top_up_enabled INTEGER,
  top_up_below_cents INTEGER,
  top_up_amount_cents INTEGER,
  monthly_top_up_limit_cents INTEGER,
  request_status TEXT NOT NULL DEFAULT 'waiting' CHECK (request_status IN ('waiting', 'approved', 'declined')),
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  answered_at_ms INTEGER
);
CREATE INDEX spending_requests_by_account ON spending_requests (account_id, request_status);

-- No foreign keys: deleting an account deletes its requests (deleteAccount), and a request for a game that is gone is just never waiting.
