-- Files the scan already checked, by their SHA-256, so an update sends only what changed through image
-- matching and the sniff for hidden pictures. One row per fingerprint, whoever sent it: a file cleared by
-- matching is clean whoever uploads it. Only cleared files are kept (a known match is never recorded, so
-- it's always found again), and a row counts for 30 days, then the daily cleanup deletes it.
CREATE TABLE checked_files (
  sha256 TEXT PRIMARY KEY,
  -- 1: a picture or video, by its name or its first bytes; 0: neither, so it isn't matched.
  is_media INTEGER NOT NULL CHECK (is_media IN (0, 1)),
  -- The matchers that cleared it, as a scan report's images.provider says them ("arachnid-shield+photodna"); null when it isn't media.
  provider TEXT,
  checked_at_ms INTEGER NOT NULL
);
CREATE INDEX checked_files_checked_at_ms ON checked_files (checked_at_ms);
