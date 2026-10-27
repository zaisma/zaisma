-- Save hardening: when each earlier version was kept, so the 30 days a copy kept before progress was lost stays
-- protected count from then (saved_at_ms stays when that progress was played). Copies kept before this count from
-- when their progress was stored, as they did. Adds only; deletes nothing.
ALTER TABLE save_history ADD COLUMN kept_at_ms INTEGER;
UPDATE save_history SET kept_at_ms = saved_at_ms WHERE kept_at_ms IS NULL;
