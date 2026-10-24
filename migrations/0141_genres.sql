-- A game's genres, up to 3 from GENRES (packages/core/src/developers.ts), comma-separated like devices; players filter
-- Browse (/games) by them. Adds a column and changes no rows: existing games have none and show under All.
ALTER TABLE games ADD COLUMN genres TEXT NOT NULL DEFAULT '';
