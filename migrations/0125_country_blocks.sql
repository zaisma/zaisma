-- Games blocked in one country on a notice under that country's law, never everywhere: a JSON list of
-- { country_code, review_reason, blocked_at_ms } (packages/core/src/country-blocks.ts). On the games row, so the
-- game files, the game page, rooms and lists check it without another query.
ALTER TABLE games ADD COLUMN country_blocks TEXT NOT NULL DEFAULT '[]';
