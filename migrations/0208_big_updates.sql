-- "Search that can't be bought": a publish is a quiet patch unless the developer marks it a big update, and nothing but a marked big
-- update on a version that has never been live counts as news. A game's first release date never moves; publishing a version again used
-- to reset the only date there was. Nothing is deleted.
ALTER TABLE games ADD COLUMN first_published_at_ms INTEGER;
-- The last marked big update: the Updated tag, the game page's Updated fact and Continue playing's Recently updated.
ALTER TABLE games ADD COLUMN big_update_at_ms INTEGER;
-- Where Browse's Recently updated places the game: it moves at most once every 30 days. NULL is the first release date.
ALTER TABLE games ADD COLUMN recently_updated_at_ms INTEGER;
ALTER TABLE versions ADD COLUMN is_big_update INTEGER NOT NULL DEFAULT 0;
-- When this version first went live, for the Updates tab: published_at_ms moves on a rollback.
ALTER TABLE versions ADD COLUMN first_published_at_ms INTEGER;
UPDATE versions SET first_published_at_ms = published_at_ms WHERE published_at_ms IS NOT NULL;
UPDATE games SET first_published_at_ms = (SELECT MIN(published_at_ms) FROM versions WHERE versions.game_id = games.id);
