-- The monthly spending stop and the one-time grace (spending.ts). Adds, and makes alert_notices again with the new kinds, every row copied.

-- The month a game had its second free allowance, the first time it filled one; NULL: it hasn't yet. Once, ever.
ALTER TABLE games ADD COLUMN second_free_allowance_month_start_date TEXT;

-- Zaisma's own month, as the spending job last measured it, in US cents of what Zaisma really pays. No row for a month
-- means no stop, so a new month starts with none. told_pct is the highest alert sent, the claim that each is sent once.
CREATE TABLE spending_months (
  month_start_date TEXT PRIMARY KEY,
  fixed_cost_cents INTEGER NOT NULL DEFAULT 0,
  ai_cost_cents INTEGER NOT NULL DEFAULT 0,
  storage_and_checks_cost_cents INTEGER NOT NULL DEFAULT 0,
  free_hosting_cost_cents INTEGER NOT NULL DEFAULT 0,
  spent_cents INTEGER NOT NULL DEFAULT 0,
  earned_last_month_cents INTEGER NOT NULL DEFAULT 0,
  limit_cents INTEGER NOT NULL DEFAULT 0,
  told_pct INTEGER NOT NULL DEFAULT 0,
  unplayed_games_cost_cents INTEGER NOT NULL DEFAULT 0,
  free_rooms_stopped_at_ms INTEGER,
  unplayed_games_stopped_at_ms INTEGER,
  free_hosting_ended_at_ms INTEGER,
  settings_missing_told_at_ms INTEGER,
  measured_at_ms INTEGER
);

-- Browsers with a counted play this month, off cloud networks, and whether that clears the game's bar as the job last
-- judged it (hasRealPlayers). Only counts: no ID, no address. play_tickets remembers whether a play is a browser's first
-- of the month, from what the browser says, as its other facts are.
-- SQLite can't change a CHECK, so the table is made again with the two new paused reasons and every row copied.
CREATE TABLE game_hosting_months_new (
  game_id TEXT NOT NULL,
  month_start_date TEXT NOT NULL,
  used_cents REAL NOT NULL DEFAULT 0,
  charged_cents INTEGER NOT NULL DEFAULT 0,
  written_off_cents INTEGER NOT NULL DEFAULT 0,
  paused_at_ms INTEGER,
  paused_reason TEXT CHECK (paused_reason IN ('free_used', 'budget_used', 'credit_used', 'no_real_players', 'free_hosting_ended')),
  real_player_count INTEGER NOT NULL DEFAULT 0,
  has_real_players INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (game_id, month_start_date)
);
INSERT INTO game_hosting_months_new (game_id, month_start_date, used_cents, charged_cents, written_off_cents, paused_at_ms, paused_reason)
  SELECT game_id, month_start_date, used_cents, charged_cents, written_off_cents, paused_at_ms, paused_reason FROM game_hosting_months;
DROP TABLE game_hosting_months;
ALTER TABLE game_hosting_months_new RENAME TO game_hosting_months;
ALTER TABLE play_tickets ADD COLUMN is_first_play_this_month INTEGER NOT NULL DEFAULT 0;

-- Money Zaisma earned that the credit ledger doesn't hold, after the card fee. A refund is a negative row. Nothing here
-- says whose it was: only the month's total is ever read. stripe_object_id keeps an event Stripe sends twice counted once.
CREATE TABLE earnings (
  stripe_object_id TEXT PRIMARY KEY,
  earning_kind TEXT NOT NULL CHECK (earning_kind IN ('pro')),
  amount_cents INTEGER NOT NULL,
  earned_at_ms INTEGER NOT NULL
);
CREATE INDEX earnings_by_time ON earnings (earned_at_ms);

-- For the job's reads every 5 minutes: last month's charges and this month's performance checks, whatever the account.
CREATE INDEX credit_entries_by_kind ON credit_entries (entry_kind, created_at_ms);
CREATE INDEX performance_checks_by_time ON performance_checks (queued_at_ms);

-- The two new alerts. SQLite can't change a CHECK, so the table is made again with every row copied, as 0166 did.
CREATE TABLE alert_notices_new (
  game_id TEXT NOT NULL,
  alert_kind TEXT NOT NULL CHECK (alert_kind IN ('hosting_nearly_paused', 'hosting_budget_nearly_used', 'hosting_paused', 'free_rooms_stopped', 'second_free_allowance_started', 'credit_low', 'database_nearly_full', 'database_full', 'rooms_nearly_paused', 'rooms_paused', 'requests_nearly_paused', 'requests_paused', 'database_nearly_paused', 'database_paused', 'database_writes_nearly_paused', 'database_writes_paused')),
  month_start_date TEXT NOT NULL,
  alert_subject TEXT NOT NULL DEFAULT '',
  noticed_at_ms INTEGER NOT NULL,
  told_webhooks_at_ms INTEGER,
  PRIMARY KEY (game_id, alert_kind, month_start_date, alert_subject)
);
INSERT INTO alert_notices_new (game_id, alert_kind, month_start_date, alert_subject, noticed_at_ms, told_webhooks_at_ms)
  SELECT game_id, alert_kind, month_start_date, alert_subject, noticed_at_ms, told_webhooks_at_ms FROM alert_notices;
DROP TABLE alert_notices;
ALTER TABLE alert_notices_new RENAME TO alert_notices;
CREATE INDEX alert_notices_untold ON alert_notices(noticed_at_ms) WHERE told_webhooks_at_ms IS NULL;
