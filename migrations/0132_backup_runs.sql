-- Each night's copy to Zaisma's backups at Backblaze (apps/site/src/backups.ts): one row a night, written as
-- its parts finish on the zaisma-backup queue. A night copies what changed after changed_after_ms (the last
-- good night's start, less an hour), so a night that failed leaves the next one to copy what it missed.
-- finished_at_ms is set once every queued part has finished; failure_message says what failed for good,
-- and is_failure_told that Zaisma was alerted. Adds only.
CREATE TABLE backup_runs (
  run_date TEXT PRIMARY KEY,
  started_at_ms INTEGER NOT NULL,
  finished_at_ms INTEGER,
  changed_after_ms INTEGER NOT NULL,
  queued_part_count INTEGER NOT NULL DEFAULT 0,
  finished_part_count INTEGER NOT NULL DEFAULT 0,
  copied_object_count INTEGER NOT NULL DEFAULT 0,
  copied_size_bytes INTEGER NOT NULL DEFAULT 0,
  failure_message TEXT,
  is_failure_told INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX backup_runs_by_start ON backup_runs(started_at_ms);
