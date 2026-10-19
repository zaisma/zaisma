-- "Julius hears within minutes when something is down" in docs/DECISIONS.md (the ops repo).
-- A scan's queue time, so a version put back to scanning later (rescanWaiting) isn't counted as waiting since it was made.
-- Null for versions queued before this: the check then counts from created_at_ms.
ALTER TABLE versions ADD COLUMN scan_queued_at_ms INTEGER;

-- One row while a half-broken condition holds (scans falling behind, errors spiking, the outside checker gone silent):
-- when it began and when Julius was last told, so he hears once, again every 2 hours, and once when it's over.
CREATE TABLE health_alerts (
  health_alert_kind TEXT PRIMARY KEY CHECK (health_alert_kind IN ('scans_behind', 'errors_spiking', 'watcher_silent')),
  started_at_ms INTEGER NOT NULL,
  last_told_at_ms INTEGER NOT NULL
);
