-- Review precedents: the AI review learns from its misses ("The AI review learns from its misses." in docs/DECISIONS.md).
-- A ruling a person made when the review was wrong: what games like this look like, pass or hold, and why. The judge
-- reads the active ones with every brief, and each carries a stand-in test case written to show the pattern, never a
-- copy of a developer's game.
CREATE TABLE review_precedents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  -- What games like this look like.
  applies_when TEXT NOT NULL,
  -- pass: the review was wrong to hold games like this. hold: it was wrong to pass them.
  decision TEXT NOT NULL CHECK (decision IN ('pass', 'hold')),
  -- The content rule the ruling is about: the one the review wrongly invoked (pass) or the game broke (hold); NULL when none.
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
CREATE INDEX review_precedents_by_status ON review_precedents (review_precedent_status);
CREATE INDEX review_precedents_by_version ON review_precedents (from_version_id) WHERE from_version_id IS NOT NULL;
CREATE INDEX review_precedents_by_report_group ON review_precedents (from_report_group_id) WHERE from_report_group_id IS NOT NULL;

-- A hold a person released because the review was wrong doesn't count as one of the owner's judged reviews for the day.
-- A flag, not a cleared judged_at_ms, since that column is also how a tweak finds the game's last judged version.
ALTER TABLE versions ADD COLUMN is_review_refunded INTEGER NOT NULL DEFAULT 0;
