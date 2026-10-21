-- How each version started in headless Chrome once it passed the scan (apps/site/src/performance-check.ts):
-- check_status waiting, checking, checked, over_daily_limit or could_not_run; report is the answer's JSON, and
-- start_files the game's own files it downloaded before its first frame, in request order, which its game page
-- preloads and warms up. Counted per owner since UTC midnight for the daily limit. No backfill: older versions
-- have no row.
CREATE TABLE performance_checks (
  version_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  check_status TEXT NOT NULL,
  report TEXT,
  start_files TEXT,
  queued_at_ms INTEGER NOT NULL,
  checked_at_ms INTEGER
);
CREATE INDEX performance_checks_by_owner ON performance_checks (owner_id, queued_at_ms);
