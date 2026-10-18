-- Precedents take the names the admin MCP uses (docs/NAMING.md): a stored time is <event>_at_ms, a
-- yes/no column reads like a boolean, and an ID that points at another says what it points at.

DROP INDEX precedents_status;

-- proposed (waiting for a person), active or retired.
ALTER TABLE precedents RENAME COLUMN status TO precedent_status;
-- 1: the AI may apply it by itself (dismissals only).
ALTER TABLE precedents RENAME COLUMN ai_alone TO can_ai_apply_alone;
-- The precedent this one changed, and the report group (its first report's ID) it was set while deciding.
ALTER TABLE precedents RENAME COLUMN replaces TO replaces_precedent_id;
ALTER TABLE precedents RENAME COLUMN from_report TO from_report_group_id;
ALTER TABLE precedents RENAME COLUMN created_at TO created_at_ms;
ALTER TABLE precedents RENAME COLUMN updated_at TO updated_at_ms;

CREATE INDEX precedents_status ON precedents (precedent_status);
