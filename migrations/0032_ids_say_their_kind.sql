-- IDs that say their kind (docs/NAMING.md, IDs): every ID Zaisma makes is <kind>_<random>, so an
-- existing ID becomes its kind, an underscore and the ID it was. Everything that points at an ID
-- moves with it: columns, IDs inside stored JSON, links in forum posts and version IDs in a game's
-- history. API keys keep their own format (zsk_…), and players' IDs move with the SDK and game server.
-- Files named by an ID are listed in file_moves, and the cron moves them within minutes.

-- Every row's ID and the IDs pointing at it change together, so foreign keys are checked at the end.
PRAGMA defer_foreign_keys = true;

-- Files named by an ID, waiting to move to their new name (moveFiles in apps/site/src/file-moves.ts).
CREATE TABLE file_moves (
  -- The bucket the file is in: games or saves.
  bucket_name TEXT NOT NULL,
  from_key TEXT NOT NULL,
  to_key TEXT NOT NULL,
  PRIMARY KEY (bucket_name, from_key)
);
-- Covers and screenshots, players' pictures of a reported game, versions' file lists (with the
-- owner IDs in them) and big files kept for one owner, in the games bucket.
INSERT INTO file_moves (bucket_name, from_key, to_key)
  SELECT 'games', 'images/' || game_id || '/' || id, 'images/game_' || game_id || '/image_' || id FROM game_images;
INSERT INTO file_moves (bucket_name, from_key, to_key)
  SELECT 'games', 'report-pictures/' || id || '.jpg', 'report-pictures/report_' || id || '.jpg' FROM reports WHERE picture = 1;
INSERT INTO file_moves (bucket_name, from_key, to_key)
  SELECT 'games', 'manifests/' || id || '.json', 'manifests/version_' || id || '.json' FROM versions WHERE kind = 'files';
INSERT INTO file_moves (bucket_name, from_key, to_key)
  SELECT 'games', 'owned/' || owner_id || '/' || sha256, 'owned/owner_' || owner_id || '/' || sha256 FROM owned_blobs;
-- Cloud saves and their earlier copies, in the saves bucket.
INSERT INTO file_moves (bucket_name, from_key, to_key)
  SELECT 'saves', account_id || '/' || game_id || '.json', account_id || '/game_' || game_id || '.json' FROM saves;
INSERT INTO file_moves (bucket_name, from_key, to_key)
  SELECT 'saves', account_id || '/' || game_id || '/' || id || '.json', account_id || '/game_' || game_id || '/save_copy_' || id || '.json' FROM save_history;

-- A game's history names versions by their ID ("Version 8f3k…" becomes "version_8f3k…"), and the
-- developer API finds them there. A reason names at most one in each spelling. (D1 refuses long GLOB
-- patterns, so "20 letters and digits" is "20 characters, none of them anything else".)
UPDATE audit_log SET reason = substr(reason, 1, instr(reason, 'Version ') - 1) || 'version_' || substr(reason, instr(reason, 'Version ') + 8)
  WHERE instr(reason, 'Version ') > 0
    AND length(substr(reason, instr(reason, 'Version ') + 8, 20)) = 20 AND substr(reason, instr(reason, 'Version ') + 8, 20) NOT GLOB '*[^a-z0-9]*';
UPDATE audit_log SET reason = substr(reason, 1, instr(reason, 'version ') - 1) || 'version_' || substr(reason, instr(reason, 'version ') + 8)
  WHERE instr(reason, 'version ') > 0
    AND length(substr(reason, instr(reason, 'version ') + 8, 20)) = 20 AND substr(reason, instr(reason, 'version ') + 8, 20) NOT GLOB '*[^a-z0-9]*';

-- Games, versions and what's made for them.
UPDATE games SET id = 'game_' || id, live_version_id = 'version_' || live_version_id, owner_id = 'owner_' || owner_id;
UPDATE versions SET id = 'version_' || id, game_id = 'game_' || game_id;
UPDATE versions SET r2_prefix = 'manifests/' || id WHERE kind = 'files';
UPDATE game_images SET id = 'image_' || id, game_id = 'game_' || game_id;
UPDATE tester_links SET id = 'tester_' || id, game_id = 'game_' || game_id;
UPDATE owners SET id = 'owner_' || id;
UPDATE owned_blobs SET owner_id = 'owner_' || owner_id;
UPDATE domains SET game_id = 'game_' || game_id;
UPDATE audit_log SET game_id = 'game_' || game_id;

-- Plays, rooms and saves.
UPDATE play_tickets SET id = 'play_ticket_' || id, game_id = 'game_' || game_id;
UPDATE play_days SET game_id = 'game_' || game_id;
UPDATE play_returns SET game_id = 'game_' || game_id;
UPDATE play_networks SET game_id = 'game_' || game_id;
UPDATE played SET game_id = 'game_' || game_id;
UPDATE room_keys SET id = 'room_key_' || id, game_id = 'game_' || game_id;
UPDATE room_usage SET game_id = 'game_' || game_id;
UPDATE live_rooms SET game_id = 'game_' || game_id;
UPDATE game_server_errors SET game_id = 'game_' || game_id, version_id = 'version_' || version_id;
UPDATE saves SET game_id = 'game_' || game_id;
UPDATE save_history SET id = 'save_copy_' || id, game_id = 'game_' || game_id;

-- Reports and the rulings that decide them. A report group is named by its first report.
UPDATE reports SET id = 'report_' || id, game_id = 'game_' || game_id, version_id = 'version_' || version_id, group_id = 'report_' || group_id, precedent_id = 'precedent_' || precedent_id;
UPDATE reports SET triage = json_set(triage, '$.precedent.id', 'precedent_' || json_extract(triage, '$.precedent.id'))
  WHERE json_type(triage, '$.precedent.id') = 'text';
UPDATE precedents SET id = 'precedent_' || id, replaces = 'precedent_' || replaces, from_report = 'report_' || from_report;

-- The developer forum.
UPDATE forum_topics SET id = 'topic_' || id, game_id = 'game_' || game_id, merged_into_topic_id = 'topic_' || merged_into_topic_id, answer_post_id = 'post_' || answer_post_id;
UPDATE forum_topics SET triage = json_set(triage,
    '$.merged_into_topic_id', CASE WHEN json_type(triage, '$.merged_into_topic_id') = 'text' THEN 'topic_' || json_extract(triage, '$.merged_into_topic_id') END,
    '$.same_as_topic_id', CASE WHEN json_type(triage, '$.same_as_topic_id') = 'text' THEN 'topic_' || json_extract(triage, '$.same_as_topic_id') END
  )
  WHERE triage IS NOT NULL;
-- Posts place images as ![image](/forum/media/<id>) and link to other posts as (#p-<id>).
UPDATE forum_posts SET id = 'post_' || id, topic_id = 'topic_' || topic_id, reply_to_post_id = 'post_' || reply_to_post_id,
  text_markdown = REPLACE(REPLACE(text_markdown, '/forum/media/', '/forum/media/media_'), '](#p-', '](#p-post_');
UPDATE forum_media SET id = 'media_' || id, post_id = 'post_' || post_id;
UPDATE forum_topic_tags SET topic_id = 'topic_' || topic_id;
UPDATE forum_votes SET topic_id = 'topic_' || topic_id;
UPDATE forum_misplaced_flags SET topic_id = 'topic_' || topic_id;
UPDATE forum_follows SET topic_id = 'topic_' || topic_id;
UPDATE forum_helpful_marks SET post_id = 'post_' || post_id;
UPDATE forum_reports SET post_id = 'post_' || post_id;
UPDATE forum_mentions SET post_id = 'post_' || post_id;
-- A topic's own row in the search has no post ID.
UPDATE forum_search SET topic_id = 'topic_' || topic_id, post_id = CASE WHEN post_id = '' THEN '' ELSE 'post_' || post_id END,
  body = REPLACE(body, '/forum/media/', '/forum/media/media_');
