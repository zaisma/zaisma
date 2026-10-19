-- Share pictures: an optional picture a developer picks for their game's shared links, shown in place
-- of the cover wherever a game or room link unfolds into a card. Like the covers, a game has one and a
-- newly approved one replaces the old. SQLite can't change a CHECK, so the table is made again with the
-- new kind and the rows copied over.
CREATE TABLE game_images_new (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  kind TEXT NOT NULL CHECK (kind IN ('cover', 'square', 'screenshot', 'share')),
  content_type TEXT NOT NULL,
  width_px INTEGER NOT NULL,
  height_px INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected')),
  created_at_ms INTEGER NOT NULL,
  review_reason TEXT
);
INSERT INTO game_images_new (id, game_id, kind, content_type, width_px, height_px, size_bytes, review_status, created_at_ms, review_reason)
  SELECT id, game_id, kind, content_type, width_px, height_px, size_bytes, review_status, created_at_ms, review_reason FROM game_images;
DROP TABLE game_images;
ALTER TABLE game_images_new RENAME TO game_images;
CREATE INDEX game_images_game ON game_images(game_id, kind, created_at_ms);
CREATE INDEX game_images_status ON game_images(review_status, created_at_ms);
