-- What an account stores and sends, instead of how big a game is. owners.stored_size_bytes is the size of every file
-- the account holds, each counted once, kept beside the rows so a check never adds them up; the daily cleanup sets it
-- again. A file no version of the owner's uses is released (released_at_ms): it stops counting and must be sent again,
-- while a released blob_owners row keeps saying who sent the file first, for copies.
ALTER TABLE owners ADD COLUMN stored_size_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE owners ADD COLUMN monthly_storage_budget_cents INTEGER;
ALTER TABLE blob_owners ADD COLUMN released_at_ms INTEGER;
ALTER TABLE owned_blobs ADD COLUMN released_at_ms INTEGER;

UPDATE owners SET stored_size_bytes =
  COALESCE((SELECT SUM(blobs.size_bytes) FROM blob_owners JOIN blobs ON blobs.sha256 = blob_owners.sha256 WHERE blob_owners.owner_id = owners.id), 0)
  + COALESCE((SELECT SUM(owned_blobs.size_bytes) FROM owned_blobs WHERE owned_blobs.owner_id = owners.id), 0);

-- New data an account sent each UTC day, every file or part reserved as it comes, whether or not it becomes a version.
CREATE TABLE owner_new_data_days (
  owner_id TEXT NOT NULL,
  date TEXT NOT NULL,
  new_data_size_bytes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, date)
);

-- Each account's month of storage past its allowance, written by the hosting job: what it used (cents, fractions
-- kept), what was charged and written off (whole cents), and the last day counted, so a day counts once.
CREATE TABLE owner_storage_months (
  owner_id TEXT NOT NULL,
  month_start_date TEXT NOT NULL,
  used_cents REAL NOT NULL DEFAULT 0,
  charged_cents INTEGER NOT NULL DEFAULT 0,
  written_off_cents INTEGER NOT NULL DEFAULT 0,
  last_counted_date TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (owner_id, month_start_date)
);

-- A first or higher storage budget is a spending request, and a storage charge is a credit entry. SQLite can't change
-- a CHECK, so both tables are made again with the new kind, as 0187 made spending_requests, and every row copied over.
CREATE TABLE spending_requests_new (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  request_kind TEXT NOT NULL CHECK (request_kind IN ('game_budget', 'credit_plan_refill_level', 'storage_budget')),
  game_id TEXT,
  monthly_budget_cents INTEGER,
  refill_level_cents INTEGER,
  request_status TEXT NOT NULL DEFAULT 'waiting' CHECK (request_status IN ('waiting', 'approved', 'declined')),
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  answered_at_ms INTEGER
);
INSERT INTO spending_requests_new (id, account_id, request_kind, game_id, monthly_budget_cents, refill_level_cents, request_status, created_at_ms, expires_at_ms, answered_at_ms)
  SELECT id, account_id, request_kind, game_id, monthly_budget_cents, refill_level_cents, request_status, created_at_ms, expires_at_ms, answered_at_ms FROM spending_requests;
DROP TABLE spending_requests;
ALTER TABLE spending_requests_new RENAME TO spending_requests;
CREATE INDEX spending_requests_by_account ON spending_requests (account_id, request_status);

CREATE TABLE credit_entries_new (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id),
  entry_kind TEXT NOT NULL CHECK (entry_kind IN ('top_up', 'hosting_charge', 'storage_charge', 'refund', 'written_off')),
  amount_cents INTEGER NOT NULL,
  game_id TEXT,
  stripe_object_id TEXT UNIQUE,
  refundable_until_ms INTEGER,
  refunded_cents INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL
);
INSERT INTO credit_entries_new (id, owner_id, entry_kind, amount_cents, game_id, stripe_object_id, refundable_until_ms, refunded_cents, created_at_ms)
  SELECT id, owner_id, entry_kind, amount_cents, game_id, stripe_object_id, refundable_until_ms, refunded_cents, created_at_ms FROM credit_entries;
DROP TABLE credit_entries;
ALTER TABLE credit_entries_new RENAME TO credit_entries;
CREATE INDEX credit_entries_owner ON credit_entries(owner_id, created_at_ms);
