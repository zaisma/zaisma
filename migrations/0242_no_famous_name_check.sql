-- The listing check no longer looks for famous names: Zaisma acts on someone else's characters, logos and names only on a
-- notice. The check stopped at the first line a picture broke, so a picture stored with a famous name was never judged on
-- the lines after it. Each one comes off that reason at once and is checked again.

-- A game with one of these is checked again: the cron queues a check asked for over 10 minutes ago.
UPDATE games SET listing_check_requested_at_ms = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE json_extract(title_listing_reason, '$.code') = 'famous_name'
   OR id IN (
     SELECT game_id FROM game_images
     WHERE json_extract(listing_reason, '$.code') = 'famous_name'
        OR json_extract(review_reason, '$.code') = 'famous_name_on_background'
   );

-- A cover or title back on Zaisma's lists.
UPDATE games SET title_listing_reason = NULL WHERE json_extract(title_listing_reason, '$.code') = 'famous_name';
UPDATE game_images SET listing_reason = NULL WHERE json_extract(listing_reason, '$.code') = 'famous_name';

-- A background picture a newer one of its kind has since replaced stays turned down: approving it would replace the newer one.
UPDATE game_images
SET review_reason = json_object('code', 'image_rejected', 'message', 'A newer background replaced this one. Zaisma no longer checks backgrounds for famous names.', 'content_rule', NULL)
WHERE json_extract(review_reason, '$.code') = 'famous_name_on_background'
  AND EXISTS (
    SELECT 1 FROM game_images AS other
    WHERE other.game_id = game_images.game_id AND other.kind = game_images.kind AND other.id != game_images.id AND other.review_status IN ('approved', 'pending')
  );

-- Any other goes back to waiting for the check. It shows again once its developer chooses it.
UPDATE game_images SET review_status = 'pending', review_reason = NULL WHERE json_extract(review_reason, '$.code') = 'famous_name_on_background';

-- A shader is checked again too: the cron queues a waiting shader made between 10 minutes and 2 days ago, so it counts as new.
UPDATE game_shaders SET review_status = 'pending', review_reason = NULL, checked_at_ms = NULL, created_at_ms = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE json_extract(review_reason, '$.code') = 'famous_name_on_background';

-- The log keeps what happened in its words; only the code it can no longer answer goes.
UPDATE audit_log SET review_reason = NULL WHERE json_extract(review_reason, '$.code') IN ('famous_name', 'famous_name_on_background');
