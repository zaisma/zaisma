-- Zaisma Pro (docs/DECISIONS.md, "Zaisma Pro raises the daily limits."): a $10 a month subscription on Stripe, apart
-- from credit, that raises a developer's daily review, performance check and version limits and their game size.
-- Pro lasts until the end of the period Stripe last said was paid. Adds only.
ALTER TABLE owners ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE owners ADD COLUMN pro_until_ms INTEGER;
ALTER TABLE owners ADD COLUMN is_pro_cancelled INTEGER NOT NULL DEFAULT 0;
-- When (Stripe's clock) the last subscription event applied happened: an older one that arrives late is ignored.
ALTER TABLE owners ADD COLUMN pro_event_at_ms INTEGER;
