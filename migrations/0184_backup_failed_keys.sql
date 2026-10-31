-- Keys a night's copy to Backblaze couldn't copy (apps/site/src/backups.ts): one bad key no longer stops the
-- copy of every key after it. Each is tried again every night by the failed_keys part until it's copied, and
-- the night alerts while any fail. backup_key: the key in the backups bucket; part_kind and bucket_name say how
-- to copy it again; failure_count: the nights it failed.
CREATE TABLE IF NOT EXISTS backup_failed_keys (
  backup_key TEXT PRIMARY KEY,
  part_kind TEXT NOT NULL,
  bucket_name TEXT,
  failure_count INTEGER NOT NULL DEFAULT 1,
  first_failed_at_ms INTEGER NOT NULL,
  last_failed_at_ms INTEGER NOT NULL,
  failure_message TEXT NOT NULL
);

-- A night whose only failures were single keys: it still counts as good for what the next night copies.
ALTER TABLE backup_runs ADD COLUMN is_key_failures_only INTEGER NOT NULL DEFAULT 0;

-- How many takedowns and deletions made after the restored night a restore replayed (apps/site/src/restore-events.ts).
ALTER TABLE restore_runs ADD COLUMN replayed_event_count INTEGER NOT NULL DEFAULT 0;
