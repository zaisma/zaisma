-- AI report triage (docs/DECISIONS.md). Every report is sorted by severity, merged with reports about
-- the same problem, summarized with a recommendation, and the safe outcomes are handled.
-- severity: 0 child safety, 1 urgent, 2 high, 3 normal, 4 low. Set from the reason when the report
-- arrives, then refined by triage.
ALTER TABLE reports ADD COLUMN severity INTEGER NOT NULL DEFAULT 3;
-- The first open report about the same problem; NULL for a report that starts its own group.
ALTER TABLE reports ADD COLUMN group_id TEXT;
-- What triage found (JSON): summary, recommendation, why, what it did and any re-check of the game.
ALTER TABLE reports ADD COLUMN triage TEXT;
ALTER TABLE reports ADD COLUMN triaged_at INTEGER;
ALTER TABLE reports ADD COLUMN triage_tries INTEGER NOT NULL DEFAULT 0;
-- 1 when the developer sees it as a bug report (in the dashboard and the MCP), and since when, so their
-- AI can ask for the ones that arrived since it last looked.
ALTER TABLE reports ADD COLUMN bug INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reports ADD COLUMN bug_at INTEGER;

UPDATE reports SET bug = 1, bug_at = created_at WHERE reason = 'broken';
UPDATE reports SET severity = CASE
  WHEN reason = 'child_safety' THEN 0
  WHEN reason = 'illegal' THEN 1
  WHEN reason IN ('malware', 'sexual', 'hate') OR player_reason IN ('sexual', 'hate') THEN 2
  WHEN reason = 'copyright' THEN 4
  ELSE 3 END;
-- Closed reports don't need sorting.
UPDATE reports SET triaged_at = COALESCE(closed_at, created_at) WHERE status != 'open';

-- A report can have the live version's files checked again once (a re-check); this is when.
ALTER TABLE versions ADD COLUMN rechecked_at INTEGER;

-- Triage uses the same monthly AI budget as scans.
ALTER TABLE ai_usage ADD COLUMN reports INTEGER NOT NULL DEFAULT 0;
