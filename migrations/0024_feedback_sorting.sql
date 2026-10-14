-- AI sorting of feedback (docs/DECISIONS.md), like report triage: every few minutes new items get a
-- severity and area, duplicates are merged, and a person gets a summary and a drafted known issue.
-- triage is JSON (FeedbackTriage in packages/core/src/feedback.ts); triaged_at is when it was sorted.
ALTER TABLE feedback ADD COLUMN triage TEXT;
ALTER TABLE feedback ADD COLUMN triaged_at INTEGER;
ALTER TABLE feedback ADD COLUMN triage_tries INTEGER NOT NULL DEFAULT 0;

-- Scans, report triage and feedback sorting share one monthly AI budget.
ALTER TABLE ai_usage ADD COLUMN feedback INTEGER NOT NULL DEFAULT 0;
