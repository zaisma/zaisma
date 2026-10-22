-- Hosting billing (docs/DECISIONS.md, "Hosting is priced with a margin, with a free tier, and prepaid above it"):
-- one free allowance per game each month on one meter, and above it prepaid credit from one balance per developer,
-- spent only by games the developer gives a monthly budget. Adds only.

-- One balance per developer, with Stripe's customer and saved card, and the optional automatic top-up.
ALTER TABLE owners ADD COLUMN credit_balance_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE owners ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE owners ADD COLUMN stripe_payment_method_id TEXT;
ALTER TABLE owners ADD COLUMN automatic_top_up_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE owners ADD COLUMN top_up_below_cents INTEGER;
ALTER TABLE owners ADD COLUMN top_up_amount_cents INTEGER;
ALTER TABLE owners ADD COLUMN monthly_top_up_limit_cents INTEGER;
-- When the owner last heard their credit was low, so it's said once per top-up.
ALTER TABLE owners ADD COLUMN credit_low_told_at_ms INTEGER;

-- What a game may draw from credit in a month; NULL: no paid hosting, so it stops at its free allowance.
ALTER TABLE games ADD COLUMN monthly_budget_cents INTEGER;

-- Every change to a balance: top-ups add, hosting charges and refunds spend (negative). A written-off entry is what a
-- game used past its budget or the balance, which Zaisma takes on: its amount is positive and never touches the balance.
-- stripe_object_id is the Stripe object a top-up or refund came from, so an event Stripe sends twice counts once.
CREATE TABLE credit_entries (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id),
  entry_kind TEXT NOT NULL CHECK (entry_kind IN ('top_up', 'hosting_charge', 'refund', 'written_off')),
  amount_cents INTEGER NOT NULL,
  game_id TEXT,
  stripe_object_id TEXT UNIQUE,
  refundable_until_ms INTEGER,
  refunded_cents INTEGER NOT NULL DEFAULT 0,
  -- A top-up the automatic top-up made, which counts toward the owner's monthly_top_up_limit_cents.
  is_automatic INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX credit_entries_owner ON credit_entries(owner_id, created_at_ms);

-- Each game's month on the meter, written by the site's hosting job: what it used (in cents at Zaisma's prices,
-- fractions kept), what was charged and written off (whole cents), and the pause, the one place rooms, the relay,
-- requests and the database read it from.
CREATE TABLE game_hosting_months (
  game_id TEXT NOT NULL,
  month_start_date TEXT NOT NULL,
  used_cents REAL NOT NULL DEFAULT 0,
  charged_cents INTEGER NOT NULL DEFAULT 0,
  written_off_cents INTEGER NOT NULL DEFAULT 0,
  paused_at_ms INTEGER,
  paused_reason TEXT CHECK (paused_reason IN ('free_used', 'budget_used', 'credit_used')),
  PRIMARY KEY (game_id, month_start_date)
);

-- The game database's rows and storage (database and kept rooms), and game server CPU outside rooms (requests,
-- schedule runs and webhooks past the first 10 ms of each), per game per day, as the rest of room_usage.
ALTER TABLE room_usage ADD COLUMN database_written_row_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE room_usage ADD COLUMN database_read_row_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE room_usage ADD COLUMN database_size_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE room_usage ADD COLUMN outside_room_cpu_duration_ms INTEGER NOT NULL DEFAULT 0;

-- The meter's alerts in alert_notices. SQLite can't change a CHECK, so the table is made again with the new kinds and
-- every row copied over, as 0110 did; the old kinds stay allowed until their rows reach the 90-day cleanup.
CREATE TABLE alert_notices_new (
  game_id TEXT NOT NULL,
  alert_kind TEXT NOT NULL CHECK (alert_kind IN ('hosting_nearly_paused', 'hosting_budget_nearly_used', 'hosting_paused', 'database_nearly_full', 'database_full', 'rooms_nearly_paused', 'rooms_paused', 'requests_nearly_paused', 'requests_paused', 'database_nearly_paused', 'database_paused', 'database_writes_nearly_paused', 'database_writes_paused')),
  month_start_date TEXT NOT NULL,
  noticed_at_ms INTEGER NOT NULL,
  told_webhooks_at_ms INTEGER,
  PRIMARY KEY (game_id, alert_kind, month_start_date)
);
INSERT INTO alert_notices_new (game_id, alert_kind, month_start_date, noticed_at_ms, told_webhooks_at_ms)
  SELECT game_id, alert_kind, month_start_date, noticed_at_ms, told_webhooks_at_ms FROM alert_notices;
DROP TABLE alert_notices;
ALTER TABLE alert_notices_new RENAME TO alert_notices;
CREATE INDEX alert_notices_untold ON alert_notices(noticed_at_ms) WHERE told_webhooks_at_ms IS NULL;
