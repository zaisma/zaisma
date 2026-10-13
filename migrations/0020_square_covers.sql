-- Square covers: a second, optional cover for phones, where a landscape one shows small. Like the
-- landscape cover, a game has one, and a newly approved one replaces the old. SQLite can't change a
-- CHECK, so the table is made again with the new kind and the rows copied over.
CREATE TABLE game_images_new (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  kind TEXT NOT NULL CHECK (kind IN ('cover', 'square', 'screenshot')),
  content_type TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at INTEGER NOT NULL
);
INSERT INTO game_images_new SELECT id, game_id, kind, content_type, width, height, bytes, status, created_at FROM game_images;
DROP TABLE game_images;
ALTER TABLE game_images_new RENAME TO game_images;
CREATE INDEX game_images_game ON game_images(game_id, kind, created_at);
CREATE INDEX game_images_status ON game_images(status, created_at);
