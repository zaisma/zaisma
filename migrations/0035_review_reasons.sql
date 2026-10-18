-- Every hold, rejection and takedown says why (docs/DEVELOPER-API.md, Holds and takedowns): a code from
-- REVIEW_CODES, a plain message and the content rule it's about, stored as JSON (a ReviewReason). The
-- fix comes from the code. Scan findings name their problem with the same codes.

-- Why a game is held or removed (NULL while it's pending or live), why a person rejected a version or
-- an image, and what the developer reads about a hold, rejection or takedown in the game's history.
ALTER TABLE games ADD COLUMN review_reason TEXT;
ALTER TABLE versions ADD COLUMN review_reason TEXT;
ALTER TABLE game_images ADD COLUMN review_reason TEXT;
ALTER TABLE audit_log ADD COLUMN review_reason TEXT;

-- Scan findings: rule becomes code, snake_case and named for the problem; detail becomes message.
UPDATE versions SET scan_report = json_set(scan_report, '$.findings', (
  SELECT json_group_array(json(json_remove(json_set(finding.value,
    '$.code', CASE finding.value ->> '$.rule'
      WHEN 'virustotal' THEN 'antivirus_flag'
      WHEN 'virustotal-unavailable' THEN 'antivirus_unavailable'
      WHEN 'too-many-files' THEN 'too_many_files_to_check'
      WHEN 'too-many-images' THEN 'too_many_images_to_check'
      WHEN 'image-matching-not-connected' THEN 'image_matching_off'
      WHEN 'ai-not-configured' THEN 'ai_review_off'
      WHEN 'ai-budget' THEN 'ai_review_budget_used'
      WHEN 'ai-refused' THEN 'ai_review_declined'
      WHEN 'ai-unreadable' THEN 'ai_review_failed'
      WHEN 'ai-verdict' THEN 'ai_concern'
      ELSE replace(finding.value ->> '$.rule', '-', '_')
    END,
    '$.message', finding.value ->> '$.detail'), '$.rule', '$.detail')))
  FROM json_each(scan_report, '$.findings') AS finding))
WHERE json_type(scan_report, '$.findings') = 'array' AND json_type(scan_report, '$.findings[0].rule') IS NOT NULL;

-- A scan that never finished held its version with no report: it gets one that says so.
UPDATE versions SET scan_report = json_object(
    'finished_at_ms', created_at_ms, 'decision', 'held',
    'findings', json_array(json_object('stage', 'static', 'severity', 'hold', 'code', 'scan_failed', 'message', 'The scan didn''t finish.')),
    'outside_hosts', json_array(), 'images', json_object('provider', 'none', 'is_connected', json('false'), 'checked_media_count', 0),
    'ai', NULL, 'is_child_safety', json('false'))
WHERE scan_status = 'held' AND scan_report IS NULL;

-- Games already held or removed: taken down by a person, paused by a report, or (known abuse images,
-- never described) waiting for a person.
UPDATE games SET review_reason = CASE
    WHEN review_status = 'removed' THEN json_object('code', 'taken_down', 'message', 'A person at Zaisma took the game down.', 'content_rule', NULL)
    WHEN EXISTS (SELECT 1 FROM versions WHERE versions.id = games.live_version_id AND versions.report_held_at_ms IS NOT NULL)
      THEN json_object('code', 'report_paused_game', 'message', 'A player report paused the game while Zaisma checks it.', 'content_rule', NULL)
    ELSE json_object('code', 'needs_review', 'message', 'A person at Zaisma needs to look at it first.', 'content_rule', NULL)
  END
WHERE review_status IN ('held', 'removed');

-- Versions a person rejected (the scan didn't), and images a person didn't approve.
UPDATE versions SET review_reason = json_object('code', 'rejected_by_zaisma', 'message', 'A person at Zaisma rejected the version.', 'content_rule', NULL)
WHERE scan_status = 'rejected' AND (scan_report IS NULL OR scan_report ->> '$.decision' IS NOT 'rejected');
UPDATE game_images SET review_reason = json_object('code', 'image_rejected', 'message', 'A person at Zaisma didn''t approve the image.', 'content_rule', NULL)
WHERE review_status = 'rejected';

-- The history's holds, rejections and takedowns so far, in the same words.
UPDATE audit_log SET review_reason = CASE action
    WHEN 'takedown' THEN json_object('code', 'taken_down', 'message', 'A person at Zaisma took the game down.', 'content_rule', NULL)
    WHEN 'auto-hold' THEN json_object('code', 'report_paused_game', 'message', 'A player report paused the game while Zaisma checks it.', 'content_rule', NULL)
    WHEN 'report-paused-update' THEN json_object('code', 'report_paused_update', 'message', 'A player report paused this update while Zaisma checks it; players get the version before it.', 'content_rule', NULL)
    WHEN 'rejected' THEN json_object('code', 'rejected_by_zaisma', 'message', 'A person at Zaisma rejected the version.', 'content_rule', NULL)
    WHEN 'image-rejected' THEN json_object('code', 'image_rejected', 'message', 'A person at Zaisma didn''t approve the image.', 'content_rule', NULL)
    WHEN 'details-rejected' THEN json_object('code', 'details_rejected', 'message', 'A person at Zaisma didn''t approve the new title or description.', 'content_rule', NULL)
  END
WHERE action IN ('takedown', 'auto-hold', 'report-paused-update', 'rejected', 'image-rejected', 'details-rejected');
