-- The AI review gathers evidence first, then one stronger model judges ("The AI review gathers evidence first, then one
-- stronger model judges." in docs/DECISIONS.md). Reviews get their own monthly money budget, and judged_at_ms counts each
-- developer's judged reviews a day. Adds only; versions from before have no evidence, so a game's next upload is judged in full.
ALTER TABLE ai_usage ADD COLUMN review_cost_cents REAL NOT NULL DEFAULT 0;
ALTER TABLE ai_usage ADD COLUMN review_call_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_usage ADD COLUMN review_budget_alert_sent_at_ms INTEGER;
ALTER TABLE versions ADD COLUMN judged_at_ms INTEGER;
CREATE INDEX versions_judged_at_ms ON versions (judged_at_ms) WHERE judged_at_ms IS NOT NULL;
