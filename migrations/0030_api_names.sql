-- Names that say what they hold (docs/NAMING.md): the games, versions, images and tester links columns
-- take the API's names, so the API passes them through. Stored times are <event>_at_ms; yes/no columns
-- are named like booleans; choice values are snake_case.

-- Games.
ALTER TABLE games RENAME COLUMN status TO review_status;
ALTER TABLE games RENAME COLUMN current_version_id TO live_version_id;
ALTER TABLE games RENAME COLUMN cloud_saves TO cloud_saves_enabled;
ALTER TABLE games RENAME COLUMN screen TO screen_orientation;
ALTER TABLE games RENAME COLUMN details_draft TO details_waiting_for_review;
ALTER TABLE games RENAME COLUMN off_shelves TO is_off_shelves;
ALTER TABLE games RENAME COLUMN created_at TO created_at_ms;
ALTER TABLE games RENAME COLUMN updated_at TO updated_at_ms;
UPDATE games SET controls = REPLACE(controls, 'keyboard-mouse', 'keyboard_mouse') WHERE controls LIKE '%keyboard-mouse%';

-- How a game is played: the API's list of play modes, in place of { single, local, online }.
ALTER TABLE games RENAME COLUMN players TO play_modes;
UPDATE games SET play_modes = (
  SELECT json_group_array(json(mode)) FROM (
    SELECT 1 AS position, json_object('mode', 'single', 'minimum_player_count', NULL, 'maximum_player_count', NULL, 'play_style', NULL) AS mode
      WHERE json_extract(games.play_modes, '$.single') = 1
    UNION ALL
    SELECT 2, json_object('mode', 'local', 'minimum_player_count', json_extract(games.play_modes, '$.local.min'), 'maximum_player_count', json_extract(games.play_modes, '$.local.max'), 'play_style', json_extract(games.play_modes, '$.local.style'))
      WHERE json_type(games.play_modes, '$.local') = 'object'
    UNION ALL
    SELECT 3, json_object('mode', 'online', 'minimum_player_count', json_extract(games.play_modes, '$.online.min'), 'maximum_player_count', json_extract(games.play_modes, '$.online.max'), 'play_style', json_extract(games.play_modes, '$.online.style'))
      WHERE json_type(games.play_modes, '$.online') = 'object'
    ORDER BY position
  )
)
WHERE play_modes != '';

-- game_server held two things: the multiplayer mode, and for one of Zaisma's own, which one.
ALTER TABLE games ADD COLUMN multiplayer_mode TEXT NOT NULL DEFAULT 'none';
ALTER TABLE games ADD COLUMN built_in_server TEXT;
UPDATE games SET
  multiplayer_mode = CASE WHEN game_server IS NULL THEN 'none' WHEN game_server = 'relay' THEN 'relay' WHEN game_server = 'sandbox' THEN 'own' ELSE 'built-in' END,
  built_in_server = CASE WHEN game_server NOT IN ('relay', 'sandbox') THEN game_server END;
ALTER TABLE games DROP COLUMN game_server;

-- Versions.
ALTER TABLE versions RENAME COLUMN bytes TO size_bytes;
ALTER TABLE versions RENAME COLUMN notes TO patch_notes;
ALTER TABLE versions RENAME COLUMN publish_when_approved TO publish_when_approved_enabled;
ALTER TABLE versions RENAME COLUMN publish_at TO scheduled_publish_at_ms;
ALTER TABLE versions RENAME COLUMN published_at TO published_at_ms;
ALTER TABLE versions RENAME COLUMN created_at TO created_at_ms;
ALTER TABLE versions RENAME COLUMN report_held_at TO report_held_at_ms;
ALTER TABLE versions RENAME COLUMN cleared_at TO cleared_at_ms;
ALTER TABLE versions RENAME COLUMN rechecked_at TO rechecked_at_ms;

-- Files stored once by their hash, for versions.
ALTER TABLE blobs RENAME COLUMN bytes TO size_bytes;
ALTER TABLE blobs RENAME COLUMN created_at TO created_at_ms;
ALTER TABLE owned_blobs RENAME COLUMN bytes TO size_bytes;
ALTER TABLE owned_blobs RENAME COLUMN created_at TO created_at_ms;

-- Covers and screenshots.
ALTER TABLE game_images RENAME COLUMN width TO width_px;
ALTER TABLE game_images RENAME COLUMN height TO height_px;
ALTER TABLE game_images RENAME COLUMN bytes TO size_bytes;
ALTER TABLE game_images RENAME COLUMN status TO review_status;
ALTER TABLE game_images RENAME COLUMN created_at TO created_at_ms;

-- Tester links.
ALTER TABLE tester_links RENAME COLUMN created_at TO created_at_ms;
ALTER TABLE tester_links RENAME COLUMN opened_at TO last_opened_at_ms;
ALTER TABLE tester_links RENAME COLUMN revoked_at TO revoked_at_ms;

-- A game's history.
ALTER TABLE audit_log RENAME COLUMN at TO happened_at_ms;
