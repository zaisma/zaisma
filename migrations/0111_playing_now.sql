-- How many people play each game right now: a checked play's ticket now says when its page last reported
-- and whether the tab is hidden. Existing tickets keep nulls and aren't counted (they're deleted within a day).
ALTER TABLE play_tickets ADD COLUMN reported_at_ms INTEGER;
ALTER TABLE play_tickets ADD COLUMN away_at_ms INTEGER;
CREATE INDEX play_tickets_reported ON play_tickets (reported_at_ms);
