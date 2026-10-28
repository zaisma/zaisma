-- A review precedent's decision is pass or reject ("Clear breaks are rejected without a person" in docs/DECISIONS.md):
-- a ruling that games like this break a rule now rejects them without a person, so 'hold' becomes 'reject'. SQLite
-- can't change a CHECK, so the table is made again with every row copied; nothing is deleted.
CREATE TABLE review_precedents_next (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  -- What games like this look like.
  applies_when TEXT NOT NULL,
  -- pass: the review was wrong to stop games like this. reject: it was wrong to pass or hold them.
  decision TEXT NOT NULL CHECK (decision IN ('pass', 'reject')),
  -- The content rule the ruling is about: the one the review wrongly invoked (pass) or the game broke (reject); NULL when none.
  content_rule TEXT,
  why TEXT NOT NULL,
  -- proposed (drafted, waiting for a person), testing (waiting for the test set), active (the judge reads it), failed (the test set didn't hold) or retired.
  review_precedent_status TEXT NOT NULL DEFAULT 'proposed' CHECK (review_precedent_status IN ('proposed', 'testing', 'active', 'failed', 'retired')),
  -- The version or report group the miss came from, and the ruling this one replaces.
  from_version_id TEXT,
  from_report_group_id TEXT,
  replaces_review_precedent_id TEXT,
  -- The stand-in test case: empty when drafting it failed (a person writes it by hand).
  case_title TEXT NOT NULL DEFAULT '',
  case_description TEXT NOT NULL DEFAULT '',
  case_index_html TEXT NOT NULL DEFAULT '',
  -- What the test run found, as JSON, and when it finished.
  test_result TEXT,
  tested_at_ms INTEGER,
  created_by TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
INSERT INTO review_precedents_next (id, title, applies_when, decision, content_rule, why, review_precedent_status, from_version_id, from_report_group_id, replaces_review_precedent_id, case_title, case_description, case_index_html, test_result, tested_at_ms, created_by, created_at_ms, updated_at_ms)
  SELECT id, title, applies_when, CASE decision WHEN 'hold' THEN 'reject' ELSE decision END, content_rule, why, review_precedent_status, from_version_id, from_report_group_id, replaces_review_precedent_id, case_title, case_description, case_index_html, test_result, tested_at_ms, created_by, created_at_ms, updated_at_ms
  FROM review_precedents;
DROP TABLE review_precedents;
ALTER TABLE review_precedents_next RENAME TO review_precedents;
CREATE INDEX review_precedents_by_status ON review_precedents (review_precedent_status);
CREATE INDEX review_precedents_by_version ON review_precedents (from_version_id) WHERE from_version_id IS NOT NULL;
CREATE INDEX review_precedents_by_report_group ON review_precedents (from_report_group_id) WHERE from_report_group_id IS NOT NULL;
