-- Richer game shaders: a shader is an image pass, up to four buffers and up to four textures (its manifest, in the games bucket beside
-- its source), and one that reads iQuality is timed at each quality level. What the check measured at each level replaces
-- check_frame_ms, which is backfilled as level 0's (the one level a shader had) and no longer read; the column stays.
ALTER TABLE game_shaders ADD COLUMN quality_checks TEXT;
ALTER TABLE game_shaders ADD COLUMN buffer_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE game_shaders ADD COLUMN texture_count INTEGER NOT NULL DEFAULT 0;
UPDATE game_shaders SET quality_checks = json_array(json_object('quality_level', 0, 'check_frame_ms', check_frame_ms, 'maximum_check_frame_ms', 75)) WHERE check_frame_ms IS NOT NULL;

-- Textures are pictures of a new kind, shader_texture. SQLite can't change a CHECK, so game_images is made again with it and every row
-- copied over, as 0110 did. The old table is dropped once its rows are copied (a copy kept aside would hold deleted pictures' rows).
CREATE TABLE game_images_new (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  kind TEXT NOT NULL CHECK (kind IN ('cover', 'square', 'screenshot', 'share', 'background', 'phone_background', 'shader_texture')),
  content_type TEXT NOT NULL,
  width_px INTEGER NOT NULL,
  height_px INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected')),
  created_at_ms INTEGER NOT NULL,
  review_reason TEXT,
  listing_reason TEXT,
  cleared_at_ms INTEGER,
  average_color TEXT,
  is_glass_smoked INTEGER,
  glass_tint_pct INTEGER
);
INSERT INTO game_images_new (id, game_id, kind, content_type, width_px, height_px, size_bytes, review_status, created_at_ms, review_reason, listing_reason, cleared_at_ms, average_color, is_glass_smoked, glass_tint_pct)
  SELECT id, game_id, kind, content_type, width_px, height_px, size_bytes, review_status, created_at_ms, review_reason, listing_reason, cleared_at_ms, average_color, is_glass_smoked, glass_tint_pct FROM game_images;
DROP TABLE game_images;
ALTER TABLE game_images_new RENAME TO game_images;
CREATE INDEX game_images_game ON game_images(game_id, kind, created_at_ms);
CREATE INDEX game_images_status ON game_images(review_status, created_at_ms);
