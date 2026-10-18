-- The chat filter (docs/DECISIONS.md, "The text filter catches what matters and leaves the rest alone"):
-- why an account's chat is stopped, the blocks that count toward a pause, and the messages kept for review.

-- Why the account's chat is stopped: paused_for_repeats (until chat_stopped_until_ms), in_review or removed; null when it isn't.
ALTER TABLE accounts ADD COLUMN chat_stopped_reason TEXT CHECK (chat_stopped_reason IN ('paused_for_repeats', 'in_review', 'removed'));
ALTER TABLE accounts ADD COLUMN chat_stopped_until_ms INTEGER;
-- Contact or personal details stopped toward an under-18 account within a day, counted without keeping any text.
ALTER TABLE accounts ADD COLUMN chat_repeat_block_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN chat_repeat_window_started_at_ms INTEGER;

-- A sexual message from an adult to a teen the filter stopped, kept for the AI's review: false alarms
-- are deleted at once, confirmed ones kept a year (kept_until_ms) for the report.
CREATE TABLE chat_reviews (
  id TEXT PRIMARY KEY,
  sender_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  game_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('rooms', 'own_server')),
  text TEXT NOT NULL,
  recent_texts_json TEXT NOT NULL DEFAULT '[]',
  chat_review_status TEXT NOT NULL DEFAULT 'pending' CHECK (chat_review_status IN ('pending', 'needs_person', 'confirmed')),
  ai_reason TEXT,
  check_attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL,
  decided_at_ms INTEGER,
  reported_at_ms INTEGER,
  kept_until_ms INTEGER
);
CREATE INDEX chat_reviews_by_status ON chat_reviews (chat_review_status, created_at_ms);

-- Chat's AI checks have their own monthly budget, so a flood of chat can't starve scans and reports.
ALTER TABLE ai_usage ADD COLUMN chat_input_token_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_usage ADD COLUMN chat_output_token_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_usage ADD COLUMN chat_call_count INTEGER NOT NULL DEFAULT 0;
-- When Julius was told this month's chat budget ran out, so he's told once a month.
ALTER TABLE ai_usage ADD COLUMN chat_budget_alert_sent_at_ms INTEGER;
