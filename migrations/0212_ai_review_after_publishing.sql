-- "Fixed checks first, the AI review after publishing" in docs/DECISIONS.md (the ops repo): a version passes the
-- fixed checks by itself, and the AI review follows behind, in half-price batches for most. Deletes nothing.

-- not_started, waiting, reviewing, passed, stopped or skipped (past the review's monthly budget). Everything that
-- passed before this change had its AI review, so it counts as passed; createVersion starts each new one at not_started.
ALTER TABLE versions ADD COLUMN ai_review_status TEXT NOT NULL DEFAULT 'passed';
-- at_once (full price, a minute or so) or batch (half price); null until a review is asked for.
ALTER TABLE versions ADD COLUMN ai_review_speed TEXT;
ALTER TABLE versions ADD COLUMN ai_review_requested_at_ms INTEGER;
ALTER TABLE versions ADD COLUMN ai_review_queued_at_ms INTEGER;
ALTER TABLE versions ADD COLUMN ai_review_finished_at_ms INTEGER;
-- The daily review it waits for a free one of: daily_large_reviews_used or daily_small_reviews_used.
ALTER TABLE versions ADD COLUMN ai_review_waiting_reason TEXT;
-- 1 when other people may reach it before its review ends: its developer has earned that.
ALTER TABLE versions ADD COLUMN is_open_before_ai_review INTEGER NOT NULL DEFAULT 0;
-- 1 when its developer chose to go live only once the review passes.
ALTER TABLE versions ADD COLUMN publish_after_ai_review_enabled INTEGER NOT NULL DEFAULT 0;
UPDATE versions SET ai_review_status = 'not_started' WHERE scan_status != 'approved';

CREATE INDEX IF NOT EXISTS versions_ai_review_waiting ON versions (ai_review_status, ai_review_queued_at_ms) WHERE ai_review_status IN ('waiting', 'reviewing');
CREATE INDEX IF NOT EXISTS versions_ai_review_times ON versions (ai_review_speed, ai_review_finished_at_ms) WHERE ai_review_finished_at_ms IS NOT NULL;

-- The visibility a hidden game takes once its live version's review passes: listed, unlisted or null.
ALTER TABLE games ADD COLUMN visibility_after_ai_review TEXT;

-- One row per batch sent to Anthropic for a version's review.
CREATE TABLE IF NOT EXISTS review_batches (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL,
  anthropic_batch_id TEXT NOT NULL,
  request_count INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER,
  collected_at_ms INTEGER
);
CREATE INDEX IF NOT EXISTS review_batches_version ON review_batches (version_id);
CREATE INDEX IF NOT EXISTS review_batches_open ON review_batches (created_at_ms) WHERE ended_at_ms IS NULL;

-- What the readers found in a file any version that passed already had read, so no file is read twice, whoever
-- sends it. A new reader prompt or model is a new reader_prompt_sha256, and the file is read again.
CREATE TABLE IF NOT EXISTS read_files (
  file_sha256 TEXT NOT NULL,
  reader_prompt_sha256 TEXT NOT NULL,
  evidence_items TEXT NOT NULL,
  read_at_ms INTEGER NOT NULL,
  PRIMARY KEY (file_sha256, reader_prompt_sha256)
);
CREATE INDEX IF NOT EXISTS read_files_read_at ON read_files (read_at_ms);
