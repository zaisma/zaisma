-- Game backgrounds: a game's own background behind Zaisma's glass on the home and its game page, one for wide
-- screens and one for phones, each a picture, a shader or Zaisma's own. Pictures are two new image kinds; SQLite
-- can't change a CHECK, so game_images is made again with them and every row copied over, as 0091 did.
CREATE TABLE game_images_new (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  kind TEXT NOT NULL CHECK (kind IN ('cover', 'square', 'screenshot', 'share', 'background', 'phone_background')),
  content_type TEXT NOT NULL,
  width_px INTEGER NOT NULL,
  height_px INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected')),
  created_at_ms INTEGER NOT NULL,
  review_reason TEXT,
  listing_reason TEXT,
  cleared_at_ms INTEGER
);
INSERT INTO game_images_new (id, game_id, kind, content_type, width_px, height_px, size_bytes, review_status, created_at_ms, review_reason, listing_reason, cleared_at_ms)
  SELECT id, game_id, kind, content_type, width_px, height_px, size_bytes, review_status, created_at_ms, review_reason, listing_reason, cleared_at_ms FROM game_images;
DROP TABLE game_images;
ALTER TABLE game_images_new RENAME TO game_images;
CREATE INDEX game_images_game ON game_images(game_id, kind, created_at_ms);
CREATE INDEX game_images_status ON game_images(review_status, created_at_ms);

-- Shaders a game sent for its backgrounds: the source is in the games bucket (shaders/<game_id>/<id>.glsl), with the
-- check's still and sampled frames beside it. The check measures how long a frame takes and counts flashes.
CREATE TABLE game_shaders (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  screen TEXT NOT NULL CHECK (screen IN ('wide', 'phone')),
  size_bytes INTEGER NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected')),
  -- Why it wasn't approved, as JSON (a ReviewReason); NULL otherwise.
  review_reason TEXT,
  -- The check's median time to draw one frame, in milliseconds; NULL until it ran.
  check_frame_ms REAL,
  -- The most flashes the check counted in any one second; NULL until it ran.
  flash_count INTEGER,
  checked_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX game_shaders_game ON game_shaders(game_id, screen, created_at_ms);

-- What each screen shows. No row means wide shows Zaisma's own and phone follows wide.
CREATE TABLE game_backgrounds (
  game_id TEXT NOT NULL REFERENCES games(id),
  screen TEXT NOT NULL CHECK (screen IN ('wide', 'phone')),
  source TEXT NOT NULL CHECK (source IN ('zaisma', 'image', 'shader', 'wide')),
  image_id TEXT,
  shader_id TEXT,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (game_id, screen)
);

-- The color Zaisma tints its glass with over the game's background, as #RRGGBB; NULL for none.
ALTER TABLE games ADD COLUMN glass_tint_color TEXT;
