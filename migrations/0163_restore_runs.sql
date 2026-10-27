-- A restore from Zaisma's backups at Backblaze into this account (apps/site/src/restore.ts, scripts/restore.mjs):
-- one row a restore, which the script inserts after loading the main database and the site's cron starts
-- once the read key is set (started_at_ms). Its parts run on the zaisma-backup queue and bring back each
-- key's newest version uploaded before cutoff_at_ms, when the restored database still holds what owns it
-- (skipped_object_count counts the rest). finished_at_ms is set once every queued part has finished;
-- failure_message says what failed for good. Adds only.
CREATE TABLE restore_runs (
  id TEXT PRIMARY KEY,
  cutoff_at_ms INTEGER NOT NULL,
  requested_at_ms INTEGER NOT NULL,
  started_at_ms INTEGER,
  finished_at_ms INTEGER,
  queued_part_count INTEGER NOT NULL DEFAULT 0,
  finished_part_count INTEGER NOT NULL DEFAULT 0,
  restored_object_count INTEGER NOT NULL DEFAULT 0,
  restored_size_bytes INTEGER NOT NULL DEFAULT 0,
  skipped_object_count INTEGER NOT NULL DEFAULT 0,
  failure_message TEXT
);

-- What each restore brought back and left out, by kind of key (a game file's area like zaisma-games/logs, or zaisma-saves),
-- so a restore shows what it left out and a rule that leaves out too much is seen.
CREATE TABLE restore_kind_counts (
  restore_id TEXT NOT NULL,
  key_kind TEXT NOT NULL,
  restored_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (restore_id, key_kind)
);
