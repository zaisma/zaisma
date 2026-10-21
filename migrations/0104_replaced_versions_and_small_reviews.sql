-- A version a newer one of the same game replaced while it waited, and when a version's small review ran
-- (its reads called the reader model), for the 30 small reviews a day. The daily-review code is renamed in
-- stored reports now that there are two limits. Nothing is deleted.
ALTER TABLE versions ADD COLUMN replaced_by_version_id TEXT;
ALTER TABLE versions ADD COLUMN read_at_ms INTEGER;
CREATE INDEX versions_read_at_ms ON versions (read_at_ms) WHERE read_at_ms IS NOT NULL;
UPDATE versions SET scan_report = replace(scan_report, '"daily_reviews_used"', '"daily_large_reviews_used"') WHERE scan_report LIKE '%daily_reviews_used%';
